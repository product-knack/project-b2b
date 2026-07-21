import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';

/* ============================================================================
   Client Threads — dedicated backend (client_threads / client_thread_messages /
   client_thread_reads), fully separated from the messenger. Membership is
   derived live: anyone assigned to the client via trainer_clients
   (actively_training) + admins. Internal only — clients can never read these
   (RLS can_access_client_thread is assignment+admin, and a client's uid is
   never on the trainer side of trainer_clients).
   ========================================================================== */

const fullName = (p: any) => `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.replace(/\s+/g, ' ').trim();
const isAdminRole = (r: string | null | undefined) => r === 'admin' || r === 'super_admin';

/* ---------- Thread list: my accessible clients + previews + unread ---------- */
export type ClientThreadListRow = {
  clientId: string;
  name: string;
  threadId: string | null;
  lastMessage: string | null;
  lastMessageAt: string | null;
  unread: number;
};

export function useClientThreadList(meId: string | null | undefined, dbRole: string | null | undefined) {
  return useQuery({
    queryKey: ['client-thread-list', meId, dbRole],
    enabled: !!meId && !!dbRole,
    staleTime: 15_000,
    queryFn: async (): Promise<ClientThreadListRow[]> => {
      // 1. My client universe: assigned clients, or all non-inactive clients for admins.
      let clients: { id: string; name: string }[] = [];
      if (isAdminRole(dbRole)) {
        const { data, error } = await supabase
          .from('clients').select('id, first_name, last_name, status')
          .not('status', 'in', '(inactive,discontinued)')
          .limit(1000);
        if (error) throw new Error(error.message);
        clients = (data ?? []).map((c: any) => ({ id: c.id, name: fullName(c) || 'Client' }));
      } else {
        const { data, error } = await supabase
          .from('trainer_clients')
          .select('client_id, clients:client_id(id, first_name, last_name, status)')
          .eq('trainer_id', meId).eq('actively_training', true);
        if (error) throw new Error(error.message);
        clients = (data ?? [])
          .filter((r: any) => r.clients && !['inactive', 'discontinued'].includes((r.clients.status ?? '').toLowerCase()))
          .map((r: any) => ({ id: r.client_id, name: fullName(r.clients) || 'Client' }));
      }

      // 2. Existing threads (RLS already filters to accessible ones) + my read marks.
      const [thrR, readR] = await Promise.all([
        supabase.from('client_threads').select('id, client_id, last_message_at'),
        supabase.from('client_thread_reads').select('thread_id, last_read_at').eq('user_id', meId),
      ]);
      if (thrR.error) throw new Error(thrR.error.message);
      const threadByClient = new Map<string, { id: string; last_message_at: string | null }>();
      (thrR.data ?? []).forEach((t: any) => threadByClient.set(t.client_id, t));
      const readByThread = new Map<string, string>();
      (readR.data ?? []).forEach((r: any) => readByThread.set(r.thread_id, r.last_read_at));

      // 3. Recent messages in one query → previews + unread counts client-side.
      const threadIds = (thrR.data ?? []).map((t: any) => t.id);
      const preview = new Map<string, { body: string | null; at: string; attachment: string | null }>();
      const unread = new Map<string, number>();
      if (threadIds.length) {
        const { data: msgs } = await supabase
          .from('client_thread_messages')
          .select('thread_id, body, attachment_type, sender_id, created_at')
          .in('thread_id', threadIds)
          .order('created_at', { ascending: false })
          .limit(600);
        (msgs ?? []).forEach((m: any) => {
          if (!preview.has(m.thread_id)) preview.set(m.thread_id, { body: m.body, at: m.created_at, attachment: m.attachment_type });
          const lastRead = readByThread.get(m.thread_id);
          if (m.sender_id !== meId && (!lastRead || m.created_at > lastRead)) {
            unread.set(m.thread_id, (unread.get(m.thread_id) ?? 0) + 1);
          }
        });
      }

      return clients
        .map((c) => {
          const t = threadByClient.get(c.id);
          const p = t ? preview.get(t.id) : undefined;
          return {
            clientId: c.id,
            name: c.name,
            threadId: t?.id ?? null,
            lastMessage: p ? (p.body || (p.attachment ? '📎 Attachment' : null)) : null,
            lastMessageAt: t?.last_message_at ?? p?.at ?? null,
            unread: t ? (unread.get(t.id) ?? 0) : 0,
          };
        })
        .sort((a, b) => {
          const ta = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
          const tb = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
          return tb - ta || a.name.localeCompare(b.name);
        });
    },
  });
}

/* Total unread across my threads — dashboard card badge. */
export function useClientThreadsUnread(meId: string | null | undefined, dbRole: string | null | undefined) {
  const listQ = useClientThreadList(meId, dbRole);
  return { unread: (listQ.data ?? []).reduce((n, r) => n + r.unread, 0), isLoading: listQ.isLoading };
}

/* ---------- Open (get-or-create) a thread ---------- */
export function useOpenClientThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (clientId: string) => {
      const { data, error } = await supabase.rpc('open_client_thread', { p_client_id: clientId });
      if (error) throw new Error(error.message);
      return data as string; // thread id
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['client-thread-list'] }),
  });
}

/* ---------- Messages in a thread (ascending for display) ---------- */
export type ClientThreadMessage = {
  id: string; senderId: string; senderName: string; senderRole: string | null;
  body: string | null; attachmentUrl: string | null; attachmentType: string | null; createdAt: string;
  replyToId: string | null;
};

export function useClientThreadMessages(threadId: string | null) {
  return useQuery({
    queryKey: ['client-thread-messages', threadId],
    enabled: !!threadId,
    staleTime: 5_000,
    queryFn: async (): Promise<ClientThreadMessage[]> => {
      const { data, error } = await supabase
        .from('client_thread_messages')
        .select('id, sender_id, body, attachment_url, attachment_type, created_at, reply_to_id')
        .eq('thread_id', threadId)
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message);
      const rows = (data ?? []).reverse();
      const senderIds = [...new Set(rows.map((m: any) => m.sender_id))];
      const profById = new Map<string, any>();
      if (senderIds.length) {
        const { data: profs } = await supabase.from('profiles').select('id, first_name, last_name, role').in('id', senderIds);
        (profs ?? []).forEach((p: any) => profById.set(p.id, p));
      }
      return rows.map((m: any) => {
        const p = profById.get(m.sender_id);
        return {
          id: m.id, senderId: m.sender_id,
          senderName: fullName(p) || 'Team member',
          senderRole: p?.role ?? null,
          body: m.body ?? null,
          attachmentUrl: m.attachment_url ?? null, attachmentType: m.attachment_type ?? null,
          createdAt: m.created_at,
          replyToId: m.reply_to_id ?? null,
        };
      });
    },
  });
}

/* Realtime: refetch messages + list whenever a new message lands in this thread. */
export function useClientThreadRealtime(threadId: string | null) {
  const qc = useQueryClient();
  React.useEffect(() => {
    if (!threadId) return;
    const channel = supabase
      .channel(`client-thread-${threadId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'client_thread_messages', filter: `thread_id=eq.${threadId}` }, () => {
        qc.invalidateQueries({ queryKey: ['client-thread-messages', threadId] });
        qc.invalidateQueries({ queryKey: ['client-thread-list'] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [threadId]);
}

/* ---------- Send (optimistic: message appears instantly) ---------- */
export function useSendClientThreadMessage(meId: string | null | undefined, meName: string, meRole: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ threadId, body, replyToId }: { threadId: string; body: string; replyToId?: string | null }) => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) throw new Error('Not signed in');
      if (!body.trim()) throw new Error('Message is empty');
      const { error } = await supabase
        .from('client_thread_messages')
        .insert({ thread_id: threadId, sender_id: uid, body: body.trim(), reply_to_id: replyToId ?? null });
      if (error) throw new Error(error.message);
    },
    onMutate: async ({ threadId, body, replyToId }) => {
      const key = ['client-thread-messages', threadId];
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<ClientThreadMessage[]>(key);
      const temp: ClientThreadMessage = {
        id: `temp-${Date.now()}`,
        senderId: meId ?? '',
        senderName: meName || 'You',
        senderRole: meRole,
        body: body.trim(),
        attachmentUrl: null, attachmentType: null,
        createdAt: new Date().toISOString(),
        replyToId: replyToId ?? null,
      };
      qc.setQueryData<ClientThreadMessage[]>(key, (old) => [...(old ?? []), temp]);
      return { prev, key };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev); },
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: ['client-thread-messages', v.threadId] });
      qc.invalidateQueries({ queryKey: ['client-thread-list'] });
    },
  });
}

/* ---------- Mark read ---------- */
export function useMarkClientThreadRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ threadId }: { threadId: string }) => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) return;
      await supabase
        .from('client_thread_reads')
        .upsert({ thread_id: threadId, user_id: uid, last_read_at: new Date().toISOString() }, { onConflict: 'thread_id,user_id' });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['client-thread-list'] }),
  });
}

/* ---------- The client's team (derived live, never stored) ---------- */
export type ClientThreadTeamMember = { userId: string; name: string; role: string | null; roleLabel: string };
const ROLE_LABEL: Record<string, string> = { crm: 'CRM', trainer: 'Trainer', doctor: 'Doctor', coach: 'Coach', admin: 'Admin', super_admin: 'Admin' };
const ROLE_ORDER: Record<string, number> = { crm: 0, trainer: 1, coach: 2, doctor: 3, admin: 4, super_admin: 4 };

export function useClientThreadTeam(clientId: string | null) {
  return useQuery({
    queryKey: ['client-thread-team', clientId],
    enabled: !!clientId,
    staleTime: 60_000,
    queryFn: async (): Promise<ClientThreadTeamMember[]> => {
      const { data, error } = await supabase
        .from('trainer_clients')
        .select('trainer_id, profiles:trainer_id(id, first_name, last_name, role)')
        .eq('client_id', clientId)
        .eq('actively_training', true);
      if (error) throw new Error(error.message);
      const seen = new Set<string>();
      const out: ClientThreadTeamMember[] = [];
      (data ?? []).forEach((r: any) => {
        const p = r.profiles;
        if (!p || seen.has(p.id)) return;
        seen.add(p.id);
        out.push({
          userId: p.id,
          name: fullName(p) || 'Member',
          role: p.role ?? null,
          roleLabel: ROLE_LABEL[p.role ?? ''] ?? (p.role ? p.role.charAt(0).toUpperCase() + p.role.slice(1) : 'Team'),
        });
      });
      out.sort((a, b) => (ROLE_ORDER[a.role ?? ''] ?? 9) - (ROLE_ORDER[b.role ?? ''] ?? 9) || a.name.localeCompare(b.name));
      return out;
    },
  });
}
