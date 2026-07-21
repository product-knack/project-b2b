import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { useAuth } from '../auth';
import { useRescheduleRequests, useRosterRequests } from './approvalQueries';
import { useServiceBookings } from './serviceQueries';
import { useEscalations } from './escalationQueries';
import { useChatOverview } from './chatQueries';

/* ============ Sidebar / drawer: real signed-in account, not hardcoded ============
   The drawer used to show a fixed demo name ("Ananya Rao"/"CRM · Client Success").
   This resolves the actual profile of the logged-in user so the header, role and
   avatar initial always reflect who's really signed in. */

const ROLE_LABELS: Record<string, string> = {
  crm: 'CRM · Client Success',
  trainer: 'Trainer',
  coach: 'Coach · Head of Trainers',
  ops: 'Operations',
  super_admin: 'Super Admin',
  admin: 'Admin',
  manager: 'Manager',
  doctor: 'Doctor',
};

export type SidebarProfile = { fullName: string; roleLabel: string; initial: string; email: string | null; avatarUrl: string | null };

export function useSidebarProfile(): SidebarProfile {
  const { session, dbRole } = useAuth();
  const uid = session?.user?.id ?? null;
  const email = session?.user?.email ?? null;
  const q = useQuery({
    queryKey: ['sidebar-profile', uid],
    enabled: !!uid,
    staleTime: 600_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('first_name, last_name, role, avatar_url').eq('id', uid).single();
      if (error) throw new Error(error.message);
      return data;
    },
  });
  const first = (q.data?.first_name ?? '').trim();
  const last = (q.data?.last_name ?? '').trim();
  const fullName = `${first} ${last}`.replace(/\s+/g, ' ').trim() || email || 'Account';
  const role = String(q.data?.role ?? dbRole ?? '').toLowerCase();
  const roleLabel = ROLE_LABELS[role] ?? (role ? role.charAt(0).toUpperCase() + role.slice(1) : 'Staff');
  const initial = (first[0] ?? fullName[0] ?? '?').toUpperCase();
  // Cache-bust with the query's fetch time: the storage path is stable (avatar.{ext}
  // upserted), so after an upload+invalidate the suffix changes and the Image refetches.
  const avatarUrl = (q.data as any)?.avatar_url ? `${(q.data as any).avatar_url}?v=${q.dataUpdatedAt}` : null;
  return { fullName, roleLabel, initial, email, avatarUrl };
}

/* ============ Avatar upload (web utils/fileUpload.uploadAvatar contract) ============
   Upload to the public `avatars` bucket at `{uid}/avatar.{ext}` with upsert, then
   store the resolved public URL on profiles.avatar_url. */
export function useUploadAvatar() {
  const { session } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (asset: { uri: string; mime: string; fileName?: string | null }) => {
      const uid = session?.user?.id;
      if (!uid) throw new Error('Not signed in');
      const ext = (asset.fileName?.split('.').pop() || asset.mime.split('/')[1] || 'jpg').toLowerCase();
      const path = `${uid}/avatar.${ext}`;
      // RN-safe upload: fetch the local uri → ArrayBuffer (blob() unreliable on Hermes).
      const res = await fetch(asset.uri);
      const buf = await res.arrayBuffer();
      const { error } = await supabase.storage.from('avatars').upload(path, buf, { contentType: asset.mime, upsert: true });
      if (error) throw new Error(error.message);
      const url = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
      const { error: uErr } = await supabase.from('profiles').update({ avatar_url: url } as any).eq('id', uid);
      if (uErr) throw new Error(uErr.message);
      return url;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sidebar-profile'] }),
  });
}

/* ============ Live nav badges ============
   Replaces the static demo badges in the drawer/bottom-bar with real counts.
   CRM-scoped queries stay disabled for non-CRM accounts; messenger unread
   applies to everyone. Keyed by route so the chrome can look them up directly. */
export function useNavBadges(): Record<string, number> {
  const { session, role } = useAuth();
  const uid = session?.user?.id ?? null;
  const crmId = role === 'crm' ? uid : null;

  const reschedQ = useRescheduleRequests(crmId);
  const rosterQ = useRosterRequests(crmId);
  const serviceQ = useServiceBookings();
  const escQ = useEscalations(crmId, 'open');
  const chatQ = useChatOverview(uid);

  const approvals = (reschedQ.data?.pending.length ?? 0) + ((rosterQ.data ?? []).filter((r) => r.status === 'pending').length);
  const service = role === 'crm' ? (serviceQ.data ?? []).filter((s) => s.status === 'pending').length : 0;
  const escalations = (escQ.data ?? []).filter((e) => e.mine).length;
  const messenger = (chatQ.data ?? []).reduce((n, c) => n + (c.unreadCount || 0), 0);

  return {
    'crm-approvals': approvals,
    'crm-service': service,
    'crm-esc': escalations,
    'messenger': messenger,
  };
}
