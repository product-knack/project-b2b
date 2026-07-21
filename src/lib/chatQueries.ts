import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { uuidv4 } from './clientQueries';
import { enqueueOutbox, getIsOnline } from './offline';
import { uploadChatMedia, PickedAsset } from './chatMedia';

/* ============ Messenger data layer (Phase 2 — read path) ============
   Backed by the Phase 1 RPCs:
   - get_conversation_overview()  → list + last message + unread (one round-trip)
   - get_messages_page(conv, before_at, before_id, limit) → keyset history page
   All reads are RLS-scoped to the signed-in user (participant-only). */

export const displayGroupName = (n: string | null | undefined) => (n === 'My Care Team' ? 'My Longevity Team' : n ?? '');
const fullName = (p: any) => `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.replace(/\s+/g, ' ').trim();
export const chatInitials = (name: string) =>
  name.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?';
const AV: [string, string][] = [['#9A7BEA', '#6E5BD0'], ['#7C8FE8', '#5B6FD0'], ['#57C98A', '#3A9E6E'], ['#E0A53C', '#B57F1E'], ['#E75A9B', '#B03A6E'], ['#FB8B3A', '#EE5E16'], ['#4FB8C9', '#2E8A9E']];
export const avatarColors = (seed: string): [string, string] => AV[(seed?.length || 0) % AV.length];

export type ChatConversation = {
  conversationId: string;
  type: 'direct' | 'group' | 'team' | string;
  title: string;
  subtitle: string | null;          // other role (direct) / "N members" (group)
  otherUserId: string | null;       // direct counterpart
  isAnnouncements: boolean;
  memberCount: number;
  lastMessage: string | null;
  lastMessageType: string | null;
  lastMessageAt: string | null;
  lastSenderId: string | null;
  unreadCount: number;
  myLastReadAt: string | null;
};

const previewFor = (msg: string | null, type: string | null) => {
  if (type && type !== 'text') {
    return { image: '📷 Photo', video: '🎥 Video', voice: '🎤 Voice message', document: '📄 Document' }[type] ?? (msg || '');
  }
  return msg || '';
};

export function useChatOverview(meId: string | null | undefined) {
  return useQuery({
    queryKey: ['chat-overview', meId],
    enabled: !!meId,
    staleTime: 15_000,
    queryFn: async (): Promise<ChatConversation[]> => {
      const { data: rows, error } = await supabase.rpc('get_conversation_overview');
      if (error) throw new Error(error.message);
      const list = (rows ?? []) as any[];
      if (!list.length) return [];

      const convIds = list.map((r) => r.conversation_id);
      // Other participants (for direct titles + group member counts) — 1 batched query.
      const { data: parts } = await supabase
        .from('conversation_participants')
        .select('conversation_id, user_id')
        .in('conversation_id', convIds)
        .neq('user_id', meId)
        .eq('is_active', true);
      const otherByConv = new Map<string, string>();
      const memberCount = new Map<string, number>();
      const userIds = new Set<string>();
      (parts ?? []).forEach((p: any) => {
        userIds.add(p.user_id);
        if (!otherByConv.has(p.conversation_id)) otherByConv.set(p.conversation_id, p.user_id);
        memberCount.set(p.conversation_id, (memberCount.get(p.conversation_id) || 0) + 1);
      });
      // Profiles for names/avatars — 1 batched query.
      const profById = new Map<string, any>();
      if (userIds.size) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('id, first_name, last_name, avatar_url, role')
          .in('id', [...userIds]);
        (profs ?? []).forEach((p: any) => profById.set(p.id, p));
      }

      return list.map((r) => {
        const isAnnouncements = r.name === 'Odds Announcements';
        let title: string;
        let subtitle: string | null = null;
        let otherUserId: string | null = null;
        if (r.type === 'direct') {
          otherUserId = otherByConv.get(r.conversation_id) ?? null;
          const o = otherUserId ? profById.get(otherUserId) : null;
          title = o ? fullName(o) || 'Direct message' : 'Direct message';
          subtitle = o?.role ? o.role.charAt(0).toUpperCase() + o.role.slice(1) : null;
        } else if (r.type === 'team' && (memberCount.get(r.conversation_id) || 0) === 1) {
          // 1:1 team (staff↔staff) DM — resolve the counterpart so it maps to the roster row.
          otherUserId = otherByConv.get(r.conversation_id) ?? null;
          const o = otherUserId ? profById.get(otherUserId) : null;
          title = o ? fullName(o) || 'Team chat' : 'Team chat';
          subtitle = o?.role ? o.role.charAt(0).toUpperCase() + o.role.slice(1) : null;
        } else {
          title = displayGroupName(r.name) || (r.type === 'team' ? 'Team chat' : 'Group');
          const n = (memberCount.get(r.conversation_id) || 0) + 1;
          subtitle = isAnnouncements ? 'Announcements' : `${n} member${n === 1 ? '' : 's'}`;
        }
        return {
          conversationId: r.conversation_id,
          type: r.type,
          title,
          subtitle,
          otherUserId,
          isAnnouncements,
          memberCount: (memberCount.get(r.conversation_id) || 0) + 1,
          lastMessage: previewFor(r.last_message, r.last_message_type),
          lastMessageType: r.last_message_type ?? null,
          lastMessageAt: r.last_message_at ?? null,
          lastSenderId: r.last_sender_id ?? null,
          unreadCount: Number(r.unread_count || 0),
          myLastReadAt: r.my_last_read_at ?? null,
        } as ChatConversation;
      });
    },
  });
}

/* ---------- Team roster (all staff, with role labels — mirrors old useTeamMessenger) ---------- */
export type TeamMember = { userId: string; name: string; role: string | null; roleLabel: string };
const roleLabelOf = (role: string | null, ca: boolean) => {
  if (ca && (!role || role === 'others')) return 'Compliance';
  const m: Record<string, string> = { admin: 'Admin', trainer: 'Trainer', coach: 'Coach', doctor: 'Doctor', crm: 'CRM', others: 'Team', academy: 'Academy' };
  return m[role ?? ''] ?? (role ? role.charAt(0).toUpperCase() + role.slice(1) : 'Team');
};
export function useTeamRoster(meId: string | null | undefined) {
  return useQuery({
    queryKey: ['team-roster', meId],
    enabled: !!meId,
    staleTime: 120_000,
    queryFn: async (): Promise<TeamMember[]> => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, role, compliance_analyst')
        .neq('id', meId)
        .or('role.in.(admin,trainer,coach,doctor,crm,others,academy),compliance_analyst.eq.true')
        .order('first_name', { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []).map((p: any) => ({
        userId: p.id,
        name: fullName(p) || 'Unknown',
        role: p.role ?? null,
        roleLabel: roleLabelOf(p.role ?? null, !!p.compliance_analyst),
      }));
    },
  });
}

/* ---------- Messenger "Clients" tab: my active clients + their app-account id
   (profile_id → enables a direct DM; group thread works regardless). ---------- */
export type MessengerClient = { clientId: string; name: string; profileId: string | null; status: string };
export function useCrmMessengerClients(crmId: string | null | undefined) {
  return useQuery({
    queryKey: ['crm-messenger-clients', crmId],
    enabled: !!crmId,
    staleTime: 60_000,
    queryFn: async (): Promise<MessengerClient[]> => {
      const { data, error } = await supabase
        .from('trainer_clients')
        .select('client:clients(id, first_name, last_name, status, profile_id)')
        .eq('trainer_id', crmId)
        .eq('actively_training', true);
      if (error) throw new Error(error.message);
      const seen = new Set<string>();
      const out: MessengerClient[] = [];
      (data ?? []).forEach((r: any) => {
        const c = r.client;
        if (!c || seen.has(c.id)) return;
        const st = (c.status ?? 'active').toLowerCase();
        if (st === 'inactive' || st === 'discontinued') return;
        seen.add(c.id);
        out.push({ clientId: c.id, name: fullName(c) || 'Client', profileId: c.profile_id ?? null, status: c.status ?? 'active' });
      });
      return out.sort((a, b) => a.name.localeCompare(b.name));
    },
  });
}

export type ChatMessage = {
  id: string;
  conversation_id: string;
  sender_id: string;
  message: string;
  message_type: string;
  attachment_url: string | null;
  attachment_type: string | null;
  created_at: string;
  is_deleted: boolean;
  reply_to_id?: string | null; // WhatsApp-style reply reference
};

const PAGE = 30;

export function useMessageThread(conversationId: string | null) {
  return useInfiniteQuery({
    queryKey: ['chat-thread', conversationId],
    enabled: !!conversationId,
    initialPageParam: null as { at: string; id: string } | null,
    queryFn: async ({ pageParam }): Promise<ChatMessage[]> => {
      const { data, error } = await supabase.rpc('get_messages_page', {
        p_conversation_id: conversationId,
        p_before_at: pageParam?.at ?? null,
        p_before_id: pageParam?.id ?? null,
        p_limit: PAGE,
      });
      if (error) throw new Error(error.message);
      return (data ?? []) as ChatMessage[]; // newest-first
    },
    getNextPageParam: (last) =>
      last.length === PAGE ? { at: last[last.length - 1].created_at, id: last[last.length - 1].id } : undefined,
    staleTime: 10_000,
  });
}

/* Batched sender profiles for a thread (names/avatars in group chats). */
export function useChatProfiles(ids: string[]) {
  const key = [...new Set(ids)].sort();
  return useQuery({
    queryKey: ['chat-profiles', key],
    enabled: key.length > 0,
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('id, first_name, last_name, role').in('id', key);
      if (error) throw new Error(error.message);
      const map: Record<string, { name: string; role: string | null }> = {};
      (data ?? []).forEach((p: any) => { map[p.id] = { name: fullName(p) || 'Unknown', role: p.role ?? null }; });
      return map;
    },
  });
}

/* Plain send fn — used by the mutation AND the offline outbox drainer.
   Client-generated id makes retries idempotent (skip if it already landed). */
export async function submitChatMessage(input: {
  id: string; conversationId: string; senderId: string; text: string;
  attachmentUrl?: string | null; attachmentType?: string | null; attachmentSize?: number | null;
  replyToId?: string | null;
}) {
  const { data: existing, error: exErr } = await supabase.from('messages').select('id').eq('id', input.id).limit(1);
  if (exErr) throw new Error(exErr.message);
  if ((existing?.length ?? 0) > 0) return;
  const { error } = await supabase.from('messages').insert({
    id: input.id,
    conversation_id: input.conversationId,
    sender_id: input.senderId,
    message: input.text,
    message_type: input.attachmentType || 'text',
    attachment_url: input.attachmentUrl ?? null,
    attachment_type: input.attachmentType ?? null,
    attachment_size: input.attachmentSize ?? null,
    reply_to_id: input.replyToId ?? null,
  });
  if (error) throw new Error(error.message);
  await supabase.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', input.conversationId);
}

/* Optimistic send: bubble appears instantly; queues to the offline outbox when
   disconnected (idempotent by id), reconciles on refetch/realtime. */
export function useSendMessage(conversationId: string, meId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: string | { text: string; replyToId?: string | null }) => {
      const text = typeof vars === 'string' ? vars : vars.text;
      const replyToId = typeof vars === 'string' ? null : vars.replyToId ?? null;
      const body = text.trim();
      if (!body) return;
      const id = uuidv4();
      const optimistic: ChatMessage & { _pending?: boolean } = {
        id, conversation_id: conversationId, sender_id: meId, message: body,
        message_type: 'text', attachment_url: null, attachment_type: null,
        created_at: new Date().toISOString(), is_deleted: false, reply_to_id: replyToId, _pending: true,
      };
      qc.setQueryData(['chat-thread', conversationId], (old: any) => {
        if (!old) return { pageParams: [null], pages: [[optimistic]] };
        const pages = [...old.pages];
        pages[0] = [optimistic, ...pages[0]];
        return { ...old, pages };
      });
      if (!getIsOnline()) {
        await enqueueOutbox('chat-message', body.slice(0, 40), { id, conversationId, senderId: meId, text: body, replyToId });
        return; // keep the pending bubble; outbox drains on reconnect
      }
      try {
        await submitChatMessage({ id, conversationId, senderId: meId, text: body, replyToId });
        qc.invalidateQueries({ queryKey: ['chat-thread', conversationId] });
        qc.invalidateQueries({ queryKey: ['chat-overview', meId] });
      } catch (e: any) {
        if (/network request failed|network error|failed to fetch|fetch failed|timeout/i.test(String(e?.message))) {
          await enqueueOutbox('chat-message', body.slice(0, 40), { id, conversationId, senderId: meId, text: body, replyToId });
          return;
        }
        throw e;
      }
    },
  });
}

/* Send a media attachment (photo/video/PDF). Optimistic bubble shows the local
   file while it uploads; requires a connection (uploads can't be queued offline). */
export function useSendMedia(conversationId: string, meId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (asset: PickedAsset) => {
      if (!getIsOnline()) throw new Error('You need a connection to send photos, videos or files.');
      const id = uuidv4();
      const kind = asset.mime.startsWith('image/') ? 'image' : asset.mime.startsWith('video/') ? 'video' : asset.mime.startsWith('audio/') ? 'voice' : 'document';
      const optimistic: ChatMessage & { _pending?: boolean } = {
        id, conversation_id: conversationId, sender_id: meId, message: '',
        message_type: kind, attachment_url: asset.uri, attachment_type: kind,
        created_at: new Date().toISOString(), is_deleted: false, _pending: true,
      };
      qc.setQueryData(['chat-thread', conversationId], (old: any) => {
        if (!old) return { pageParams: [null], pages: [[optimistic]] };
        const pages = [...old.pages];
        pages[0] = [optimistic, ...pages[0]];
        return { ...old, pages };
      });
      const up = await uploadChatMedia(asset, conversationId, id);
      await submitChatMessage({ id, conversationId, senderId: meId, text: '', attachmentUrl: up.url, attachmentType: up.kind, attachmentSize: up.size });
      qc.invalidateQueries({ queryKey: ['chat-thread', conversationId] });
      qc.invalidateQueries({ queryKey: ['chat-overview', meId] });
    },
    onError: () => {
      // Drop the optimistic bubble on failure so it doesn't linger as "sending".
      qc.invalidateQueries({ queryKey: ['chat-thread', conversationId] });
    },
  });
}

/* Start (or reuse) a 1:1 conversation with someone — team or direct. */
export function useOpenOrCreateDm() {
  return useMutation({
    mutationFn: async ({ otherUserId, type }: { otherUserId: string; type: 'direct' | 'team' }) => {
      const { data, error } = await supabase.rpc('get_or_create_dm', { p_other: otherUserId, p_type: type });
      if (error) throw new Error(error.message);
      return data as string; // conversation id
    },
  });
}

/* Active members of a conversation with names + roles — for group headers. */
export type ThreadMember = { userId: string; name: string; role: string | null; roleLabel: string };
const THREAD_ROLE_LABEL: Record<string, string> = { crm: 'CRM', trainer: 'Trainer', doctor: 'Doctor', admin: 'Admin', super_admin: 'Admin', coach: 'Coach' };
const THREAD_ROLE_ORDER: Record<string, number> = { crm: 0, trainer: 1, doctor: 2, admin: 3, super_admin: 3 };
export function useThreadMembers(conversationId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['thread-members', conversationId],
    enabled: !!conversationId && enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<ThreadMember[]> => {
      const { data: parts, error } = await supabase
        .from('conversation_participants')
        .select('user_id')
        .eq('conversation_id', conversationId)
        .eq('is_active', true);
      if (error) throw new Error(error.message);
      const ids = [...new Set((parts ?? []).map((p: any) => p.user_id))];
      if (!ids.length) return [];
      const { data: profs } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, role')
        .in('id', ids);
      const out: ThreadMember[] = (profs ?? []).map((p: any) => ({
        userId: p.id,
        name: fullName(p) || 'Member',
        role: p.role ?? null,
        roleLabel: THREAD_ROLE_LABEL[p.role ?? ''] ?? (p.role ? p.role.charAt(0).toUpperCase() + p.role.slice(1) : 'Team'),
      }));
      out.sort((a, b) => (THREAD_ROLE_ORDER[a.role ?? ''] ?? 9) - (THREAD_ROLE_ORDER[b.role ?? ''] ?? 9) || a.name.localeCompare(b.name));
      return out;
    },
  });
}

/* ---------- Client care-team GROUP (client-inclusive) ----------
   Distinct from the staff-only client thread (type 'client'): this is the
   type='group' "My Care Team" conversation that contains the CLIENT plus their
   assigned staff. Resolved from the client's profile participation (RLS returns
   only groups the caller is also in). Returns null if none is visible. */
export async function getClientGroupConversationId(clientProfileId: string): Promise<string | null> {
  const { data: parts, error } = await supabase
    .from('conversation_participants')
    .select('conversation_id')
    .eq('user_id', clientProfileId)
    .eq('is_active', true);
  if (error) throw new Error(error.message);
  const ids = [...new Set((parts ?? []).map((p: any) => p.conversation_id))];
  if (!ids.length) return null;
  const { data: convs, error: cErr } = await supabase
    .from('conversations')
    .select('id, name')
    .in('id', ids)
    .eq('type', 'group');
  if (cErr) throw new Error(cErr.message);
  const groups = (convs ?? []).filter((c: any) => c.name !== 'Odds Announcements');
  if (!groups.length) return null;
  const pick = groups.find((c: any) => c.name === 'My Care Team') ?? groups[0];
  return pick.id as string;
}

/* Resolve the client's care-team group AND ensure the caller is a member.
   Assigned staff aren't always participants of the client's group, and RLS then
   hides it — so the client-side lookup can't find it. The get_or_join RPC
   (SECURITY DEFINER) locates the group and adds the caller, then returns its id.
   Falls back to the direct lookup if the RPC isn't deployed yet (older backend). */
export async function resolveClientGroup(clientId: string, clientProfileId: string | null): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc('get_or_join_client_group', { p_client_id: clientId });
    if (error) throw error;
    if (data) return data as string;
    // RPC ran but returned null (no group / not authorized) — try the direct lookup below.
  } catch {
    // RPC missing on an older backend — fall back to the member-only lookup.
  }
  if (clientProfileId) return getClientGroupConversationId(clientProfileId);
  return null;
}

/* ---------- Clients → Groups sub-tab (mirrors web useClientGroups) ----------
   Lists every type='group' conversation the CLIENT belongs to (their care-team
   groups, e.g. "My Care Team"), with member chips, for the Groups list screen.
   RLS-scoped: returns the groups the caller can see (i.e. is a member of). */
export type ClientGroupMember = { userId: string; name: string; role: string | null };
export type ClientGroup = { conversationId: string; name: string; members: ClientGroupMember[] };
export function useClientGroups(clientProfileId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ['client-groups', clientProfileId],
    enabled: !!clientProfileId && enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<ClientGroup[]> => {
      const { data: parts, error } = await supabase
        .from('conversation_participants')
        .select('conversation_id')
        .eq('user_id', clientProfileId)
        .eq('is_active', true);
      if (error) throw new Error(error.message);
      const ids = [...new Set((parts ?? []).map((p: any) => p.conversation_id))];
      if (!ids.length) return [];
      const { data: convs } = await supabase
        .from('conversations')
        .select('id, name')
        .in('id', ids)
        .eq('type', 'group');
      const groups = (convs ?? []).filter((c: any) => c.name !== 'Odds Announcements');
      if (!groups.length) return [];
      const gids = groups.map((g: any) => g.id);
      const { data: allParts } = await supabase
        .from('conversation_participants')
        .select('conversation_id, user_id')
        .in('conversation_id', gids)
        .eq('is_active', true);
      const uids = [...new Set((allParts ?? []).map((p: any) => p.user_id))];
      const { data: profs } = uids.length
        ? await supabase.from('profiles').select('id, first_name, last_name, role').in('id', uids)
        : { data: [] as any[] };
      const pById = new Map((profs ?? []).map((p: any) => [p.id, p]));
      const byConv = new Map<string, ClientGroupMember[]>();
      (allParts ?? []).forEach((p: any) => {
        const pr = pById.get(p.user_id);
        const arr = byConv.get(p.conversation_id) ?? [];
        arr.push({ userId: p.user_id, name: pr ? fullName(pr) || 'Member' : 'Member', role: pr?.role ?? null });
        byConv.set(p.conversation_id, arr);
      });
      return groups.map((g: any) => ({ conversationId: g.id, name: displayGroupName(g.name) || 'Group', members: byConv.get(g.id) ?? [] }));
    },
  });
}

/* ---------- Read receipts (group "seen by") ----------
   Each participant's last_read_at; a member has "seen" a message when their
   last_read_at >= the message's created_at. RLS returns all participant rows of
   conversations the caller is in, so the client's read state is included. */
export type ConversationRead = { userId: string; name: string; role: string | null; lastReadAt: string | null };
export function useConversationReads(conversationId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['conversation-reads', conversationId],
    enabled: !!conversationId && enabled,
    staleTime: 8_000,
    refetchInterval: 20_000,
    queryFn: async (): Promise<ConversationRead[]> => {
      const { data: parts, error } = await supabase
        .from('conversation_participants')
        .select('user_id, last_read_at')
        .eq('conversation_id', conversationId)
        .eq('is_active', true);
      if (error) throw new Error(error.message);
      const ids = [...new Set((parts ?? []).map((p: any) => p.user_id))];
      if (!ids.length) return [];
      const { data: profs } = await supabase.from('profiles').select('id, first_name, last_name, role').in('id', ids);
      const pById = new Map((profs ?? []).map((p: any) => [p.id, p]));
      return (parts ?? []).map((p: any) => {
        const pr = pById.get(p.user_id);
        return { userId: p.user_id, name: pr ? fullName(pr) || 'Member' : 'Member', role: pr?.role ?? null, lastReadAt: p.last_read_at ?? null };
      });
    },
  });
}

/* Mark a conversation read (clears unread) — participant's own row only. */
export function useMarkConversationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ conversationId, meId }: { conversationId: string; meId: string }) => {
      const { error } = await supabase
        .from('conversation_participants')
        .update({ last_read_at: new Date().toISOString() })
        .eq('conversation_id', conversationId)
        .eq('user_id', meId);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_r, v) => qc.invalidateQueries({ queryKey: ['chat-overview', v.meId] }),
  });
}
