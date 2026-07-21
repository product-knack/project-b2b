import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { useCrmClients } from './crmQueries';

/* ============ CRM Workspace tabs — mirrors the old web CRM dashboard's 15 tabs ============
   Every hook is read-only and scoped exactly like the web app (verified live under the
   crm role's RLS). Heavy pipelines share the useCrmClients base (clients+paused sets). */

const fullName = (p: any) => `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || null;

/* ---------- 1. Clients overview: inactive ≥7d (excludes paused) ---------- */
export type InactiveRow = { id: string; name: string; lastSession: string | null; trainerName: string | null; days: number | null };
export function useCrmInactiveOverview(crmId: string | null) {
  const base = useCrmClients(crmId);
  return useQuery({
    queryKey: ['crm-inactive-overview', crmId, base.data?.ids.length ?? -1],
    enabled: !!crmId && !!base.data,
    staleTime: 120_000,
    queryFn: async (): Promise<InactiveRow[]> => {
      const { clients, paused } = base.data!;
      // Paying clients only — exclude paused, no-subscription (null) and Staff
      // accounts (same eligibility rule the escalation engine uses).
      const eligible = clients.filter((c) =>
        !paused.has(c.id) &&
        !!c.subscription &&
        c.subscription.trim().toLowerCase() !== 'staff'
      );
      if (!eligible.length) return [];
      const { data: sess } = await supabase
        .from('training_sessions')
        .select('client_id, scheduled_at, profiles:trainer_id(first_name, last_name)')
        .in('client_id', eligible.map((c) => c.id))
        .order('scheduled_at', { ascending: false })
        .limit(1000);
      const last = new Map<string, any>();
      (sess ?? []).forEach((s: any) => { if (!last.has(s.client_id)) last.set(s.client_id, s); });
      const now = Date.now();
      const rows: InactiveRow[] = [];
      for (const c of eligible) {
        const s = last.get(c.id);
        const days = s ? Math.floor((now - new Date(s.scheduled_at).getTime()) / 864e5) : null;
        if (s && (days as number) < 7) continue; // active in the last week
        rows.push({ id: c.id, name: c.name, lastSession: s?.scheduled_at ?? null, trainerName: s ? fullName(s.profiles) : null, days });
      }
      // No-session-ever first, then most-idle first (mirrors web sort).
      return rows.sort((a, b) => (b.days ?? Number.MAX_SAFE_INTEGER) - (a.days ?? Number.MAX_SAFE_INTEGER));
    },
  });
}

/* ---------- 2. Missing session logs (7d window, 3h grace, hard floor) ---------- */
const MISSING_FLOOR_ISO = '2026-05-27T18:30:00Z'; // web's hard floor (28 May 2026 IST)
export type MissingLogRow = { id: string; clientName: string; trainerName: string; when: string; modality: string | null; hoursAgo: number };
export function useCrmMissingLogRows(crmId: string | null) {
  const base = useCrmClients(crmId);
  return useQuery({
    queryKey: ['crm-missing-log-rows', crmId, base.data?.ids.length ?? -1],
    enabled: !!crmId && !!base.data,
    staleTime: 120_000,
    queryFn: async (): Promise<MissingLogRow[]> => {
      const { ids, paused } = base.data!;
      const eligible = ids.filter((id) => !paused.has(id));
      if (!eligible.length) return [];
      const now = Date.now();
      const from = new Date(Math.max(now - 7 * 864e5, new Date(MISSING_FLOOR_ISO).getTime())).toISOString();
      const to = new Date(now - 3 * 3600e3).toISOString();
      const [schedR, logsR] = await Promise.all([
        supabase.from('session_schedule')
          .select('id, client_id, trainer_id, scheduled_datetime, modality, session_type, clients:client_id(first_name, last_name), profiles:trainer_id(first_name, last_name)')
          .in('client_id', eligible).gte('scheduled_datetime', from).lte('scheduled_datetime', to)
          .neq('status', 'cancelled').order('scheduled_datetime', { ascending: false }),
        supabase.from('training_sessions')
          .select('client_id, trainer_id, scheduled_at')
          .in('client_id', eligible)
          .gte('scheduled_at', new Date(now - (7 * 864e5 + 3 * 3600e3)).toISOString())
          .lte('scheduled_at', new Date(now).toISOString()),
      ]);
      const logs = (logsR.data ?? []) as any[];
      return ((schedR.data ?? []) as any[])
        .filter((r) => {
          const t = new Date(r.scheduled_datetime).getTime();
          return !logs.some((l) => l.client_id === r.client_id && l.trainer_id === r.trainer_id && Math.abs(new Date(l.scheduled_at).getTime() - t) <= 3 * 3600e3);
        })
        .map((r) => ({
          id: r.id,
          clientName: fullName(r.clients) ?? 'Unknown Client',
          trainerName: fullName(r.profiles) ?? 'Unknown Trainer',
          when: r.scheduled_datetime,
          modality: r.modality || r.session_type || null,
          hoursAgo: Math.max(1, Math.floor((now - new Date(r.scheduled_datetime).getTime()) / 3600e3)),
        }));
    },
  });
}

/* ---------- 3. Leave requests (all trainers; classified active/upcoming/previous) ---------- */
export type LeaveRow = { id: string; trainerId: string | null; trainerName: string; startDate: string; startTime: string; endDate: string; endTime: string; reason: string | null; status: 'active' | 'upcoming' | 'completed' };
export function useCrmLeaves() {
  return useQuery({
    queryKey: ['crm-leaves'],
    staleTime: 120_000,
    queryFn: async (): Promise<LeaveRow[]> => {
      const { data, error } = await supabase
        .from('leave_request')
        .select('id, trainer_id, start_date, start_time, end_date, end_time, reason, created_at, profiles:trainer_id(first_name, last_name)')
        .order('start_date', { ascending: false });
      if (error) throw new Error(error.message);
      const now = Date.now();
      return ((data ?? []) as any[]).map((l) => {
        const start = new Date(`${l.start_date}T${l.start_time || '00:00:00'}+05:30`).getTime();
        const end = new Date(`${l.end_date}T${l.end_time || '23:59:59'}+05:30`).getTime();
        const status: LeaveRow['status'] = now > end ? 'completed' : now >= start ? 'active' : 'upcoming';
        return { id: l.id, trainerId: l.trainer_id ?? null, trainerName: fullName(l.profiles) ?? 'Trainer', startDate: l.start_date, startTime: (l.start_time || '').slice(0, 5), endDate: l.end_date, endTime: (l.end_time || '').slice(0, 5), reason: l.reason ?? null, status };
      });
    },
  });
}

/* ---------- 3b. Sessions affected by a trainer's leave (web useLeaveAffectedSessions):
   that trainer's session_schedule rows inside the leave window, for MY clients. ---------- */
export type AffectedSession = { id: string; clientId: string; clientName: string; when: string; modality: string | null; status: string };
export function useLeaveAffectedSessions(crmId: string | null, leave: { id: string; trainerId: string | null; startDate: string; startTime: string; endDate: string; endTime: string } | null) {
  return useQuery({
    queryKey: ['crm-leave-affected', crmId, leave?.id ?? null],
    enabled: !!crmId && !!leave?.trainerId,
    staleTime: 30_000,
    queryFn: async (): Promise<AffectedSession[]> => {
      const { data: book } = await supabase
        .from('trainer_clients').select('client_id').eq('trainer_id', crmId).eq('actively_training', true);
      const ids = [...new Set((book ?? []).map((r: any) => r.client_id))];
      if (!ids.length) return [];
      const start = `${leave!.startDate}T${leave!.startTime || '00:00'}:00+05:30`;
      const end = `${leave!.endDate}T${leave!.endTime || '23:59'}:59+05:30`;
      const { data, error } = await supabase
        .from('session_schedule')
        .select('id, client_id, scheduled_datetime, modality, status, clients:client_id(first_name, last_name)')
        .eq('trainer_id', leave!.trainerId)
        .gte('scheduled_datetime', start)
        .lte('scheduled_datetime', end)
        .in('client_id', ids)
        .order('scheduled_datetime', { ascending: true });
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map((s) => ({
        id: s.id, clientId: s.client_id, clientName: fullName(s.clients) ?? 'Client',
        when: s.scheduled_datetime, modality: s.modality ?? null, status: s.status ?? 'scheduled',
      }));
    },
  });
}

/* ---------- 4. Pending tasks (mine or admin-assigned) ---------- */
export type TaskRow = { id: string; title: string; description: string | null; priority: string; status: string; category: string | null; dueDate: string | null; byAdmin: boolean; pingCount: number; overdue: boolean; createdAt: string };
export function useCrmTasks(crmId: string | null) {
  return useQuery({
    queryKey: ['crm-tasks', crmId],
    enabled: !!crmId,
    staleTime: 120_000,
    queryFn: async (): Promise<TaskRow[]> => {
      const { data, error } = await supabase
        .from('crm_tasks')
        .select('id, title, description, priority, status, category, due_date, by_admin, ping_count, is_completed, created_at')
        .or(`crm_id.eq.${crmId},assigned_crm_by_admin.eq.${crmId}`)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      const now = Date.now();
      return ((data ?? []) as any[])
        .filter((t) => t.status !== 'done' && !t.is_completed)
        .map((t) => ({
          id: t.id, title: t.title || 'Task', description: t.description || null, priority: t.priority || 'medium',
          status: t.status || 'pending', category: t.category ?? null, dueDate: t.due_date ?? null,
          byAdmin: !!t.by_admin, pingCount: t.ping_count ?? 0,
          overdue: !!t.due_date && new Date(t.due_date).getTime() < now, createdAt: t.created_at,
        }));
    },
  });
}

/* ---------- 5. Trainer tickets (open/closed; names enriched) ---------- */
export type TicketRow = { id: string; clientName: string; raisedBy: string; category: string; description: string | null; createdAt: string; closedAt: string | null; closeRemark: string | null };
export function useCrmTickets(status: 'open' | 'closed') {
  return useQuery({
    queryKey: ['crm-tickets', status],
    staleTime: 120_000,
    queryFn: async (): Promise<TicketRow[]> => {
      const { data, error } = await supabase
        .from('trainer_tickets')
        .select('id, client_id, raised_by, category, custom_category, description, status, close_remark, closed_at, created_at')
        .eq('status', status)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as any[];
      const cIds = [...new Set(rows.map((r) => r.client_id).filter(Boolean))];
      const pIds = [...new Set(rows.flatMap((r) => [r.raised_by, r.closed_by]).filter(Boolean))];
      const [cR, pR] = await Promise.all([
        cIds.length ? supabase.from('clients').select('id, first_name, last_name').in('id', cIds) : Promise.resolve({ data: [] as any[] }),
        pIds.length ? supabase.from('profiles').select('id, first_name, last_name').in('id', pIds) : Promise.resolve({ data: [] as any[] }),
      ]);
      const cMap = new Map((cR.data ?? []).map((c: any) => [c.id, fullName(c)]));
      const pMap = new Map((pR.data ?? []).map((p: any) => [p.id, fullName(p)]));
      return rows.map((r) => ({
        id: r.id,
        clientName: cMap.get(r.client_id) ?? 'Unknown Client',
        raisedBy: pMap.get(r.raised_by) ?? 'Unknown Trainer',
        category: r.category === 'other' ? (r.custom_category || 'Other') : String(r.category || 'other').replace(/_/g, ' '),
        description: r.description ?? null,
        createdAt: r.created_at, closedAt: r.closed_at ?? null, closeRemark: r.close_remark ?? null,
      }));
    },
  });
}
export function useCrmOpenTicketsCount() {
  return useQuery({
    queryKey: ['crm-tickets-open-count'],
    staleTime: 60_000,
    queryFn: async () => {
      const { count } = await supabase.from('trainer_tickets').select('id', { count: 'exact', head: true }).eq('status', 'open');
      return count ?? 0;
    },
  });
}

/* ---------- 6. Pending communications (latest per client = Follow-up Required) ---------- */
export type CommRow = { id: string; clientId: string; clientName: string; phone: string | null; callDate: string; medium: string | null; followUpDate: string | null; overdue: boolean };
export function useCrmPendingComms(crmId: string | null) {
  return useQuery({
    queryKey: ['crm-pending-comms', crmId],
    enabled: !!crmId,
    staleTime: 120_000,
    queryFn: async (): Promise<CommRow[]> => {
      const { data, error } = await supabase
        .from('crm_communications')
        .select('id, client_id, call_date, call_status, call_medium, next_follow_up_date, clients(first_name, last_name, phone)')
        .eq('crm_id', crmId)
        .order('call_date', { ascending: false });
      if (error) throw new Error(error.message);
      const latest = new Map<string, any>();
      ((data ?? []) as any[]).forEach((r) => { if (r.client_id && !latest.has(r.client_id)) latest.set(r.client_id, r); });
      const now = Date.now();
      return [...latest.values()]
        .filter((r) => r.call_status === 'Follow-up Required')
        .map((r) => ({
          id: r.id, clientId: r.client_id, clientName: fullName(r.clients) ?? 'Client', phone: r.clients?.phone ?? null,
          callDate: r.call_date, medium: r.call_medium ?? null, followUpDate: r.next_follow_up_date ?? null,
          overdue: !!r.next_follow_up_date && new Date(r.next_follow_up_date).getTime() < now,
        }));
    },
  });
}

/* ---------- 6b. Stale communications: no comm logged in 7+ days (mirrors the web banner) ----------
   For each active, non-paused client: latest crm_communications.call_date (any CRM).
   Included when never logged OR last comm ≥ 7 days ago. Never-logged first, then oldest. */
export type StaleCommRow = { id: string; name: string; phone: string | null; lastComm: string | null; days: number | null };
export function useCrmStaleComms(crmId: string | null) {
  const base = useCrmClients(crmId);
  return useQuery({
    queryKey: ['crm-stale-comms', crmId, base.data?.ids.length ?? -1],
    enabled: !!crmId && !!base.data,
    staleTime: 120_000,
    queryFn: async (): Promise<StaleCommRow[]> => {
      const { clients, paused } = base.data!;
      const eligible = clients.filter((c) => !paused.has(c.id));
      if (!eligible.length) return [];
      const { data: comms, error } = await supabase
        .from('crm_communications')
        .select('client_id, call_date')
        .in('client_id', eligible.map((c) => c.id))
        .order('call_date', { ascending: false });
      if (error) throw new Error(error.message);
      const latest = new Map<string, string>();
      ((comms ?? []) as any[]).forEach((r) => { if (r.client_id && !latest.has(r.client_id)) latest.set(r.client_id, r.call_date); });
      const now = Date.now();
      const rows: StaleCommRow[] = [];
      for (const c of eligible) {
        const last = latest.get(c.id) ?? null;
        const days = last ? Math.floor((now - new Date(last).getTime()) / 864e5) : null;
        if (last && (days as number) < 7) continue;
        rows.push({ id: c.id, name: c.name, phone: c.phone ?? null, lastComm: last, days });
      }
      return rows.sort((a, b) => (b.days ?? Number.MAX_SAFE_INTEGER) - (a.days ?? Number.MAX_SAFE_INTEGER));
    },
  });
}

/* ---------- 7. Upcoming sessions (today → +2 days; RLS-scoped like the web) ---------- */
export type UpcomingRow = { id: string; clientName: string; trainerName: string; when: string; modality: string | null };
export function useCrmUpcoming() {
  return useQuery({
    queryKey: ['crm-upcoming-sessions'],
    staleTime: 120_000,
    queryFn: async (): Promise<UpcomingRow[]> => {
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const end = new Date(Date.now() + 2 * 864e5); end.setHours(23, 59, 59, 999);
      const { data, error } = await supabase
        .from('session_schedule')
        .select('id, scheduled_datetime, modality, session_type, clients:client_id!inner(first_name, last_name, status), profiles:trainer_id(first_name, last_name)')
        .eq('clients.status', 'active')
        .eq('status', 'scheduled')
        .gte('scheduled_datetime', start.toISOString())
        .lte('scheduled_datetime', end.toISOString())
        .order('scheduled_datetime', { ascending: true });
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map((r) => ({
        id: r.id, clientName: fullName(r.clients) ?? 'Unknown Client', trainerName: fullName(r.profiles) ?? 'Unknown Trainer',
        when: r.scheduled_datetime, modality: r.modality || r.session_type || null,
      }));
    },
  });
}

/* ---------- 8. Recent QHP completions (last 7d; Baseline/Refresh N; explained state) ---------- */
const hasQhpData = (a: any) =>
  !!a.assessment_file_url ||
  (a.qhp_data && typeof a.qhp_data === 'object' && Object.keys(a.qhp_data).length > 0) ||
  (a.new_client_assessment_data && typeof a.new_client_assessment_data === 'object' && Object.keys(a.new_client_assessment_data).length > 0) ||
  (a.existing_client_assessment_data && typeof a.existing_client_assessment_data === 'object' && Object.keys(a.existing_client_assessment_data).length > 0);

export type QhpRow = { id: string; clientName: string; assessorName: string | null; label: string; completedAt: string; explainedAt: string | null; explainedBy: string | null };
export function useCrmQhpCompletions(crmId: string | null) {
  const base = useCrmClients(crmId);
  return useQuery({
    queryKey: ['crm-qhp-completions', crmId, base.data?.ids.length ?? -1],
    enabled: !!crmId && !!base.data,
    staleTime: 300_000,
    queryFn: async (): Promise<QhpRow[]> => {
      const { clients, ids, paused } = base.data!;
      const eligible = ids.filter((id) => !paused.has(id));
      if (!eligible.length) return [];
      const nameOf = new Map(clients.map((c) => [c.id, c.name]));
      const { data: assess } = await supabase
        .from('coach_assessment')
        .select('id, client_id, coach_id, assessment_date, completed, assessment_file_url, qhp_data, new_client_assessment_data, existing_client_assessment_data')
        .in('client_id', eligible)
        .order('assessment_date', { ascending: true });
      const cut = Date.now() - 7 * 864e5;
      const chrono = new Map<string, number>();
      const recents: any[] = [];
      for (const a of (assess ?? []) as any[]) {
        if (!hasQhpData(a)) continue;
        const n = (chrono.get(a.client_id) ?? 0) + 1;
        chrono.set(a.client_id, n);
        const completedAt = a.completed || a.assessment_date;
        if (completedAt && new Date(completedAt).getTime() >= cut) recents.push({ ...a, chrono: n, completedAt });
      }
      if (!recents.length) return [];
      // Explained state (latest qhp_details per assessment) + names.
      const aIds = recents.map((r) => r.id);
      const { data: det } = await supabase
        .from('qhp_details')
        .select('coach_assessment_id, qhp_explained_to_client_at, qhp_explained_by, created_at')
        .in('coach_assessment_id', aIds)
        .order('created_at', { ascending: false });
      const detMap = new Map<string, any>();
      ((det ?? []) as any[]).forEach((d) => { if (!detMap.has(d.coach_assessment_id)) detMap.set(d.coach_assessment_id, d); });
      const pIds = [...new Set([...recents.map((r) => r.coach_id), ...[...detMap.values()].map((d) => d.qhp_explained_by)].filter(Boolean))];
      const pMap = new Map<string, string | null>();
      if (pIds.length) {
        const { data: profs } = await supabase.from('profiles').select('id, first_name, last_name').in('id', pIds);
        (profs ?? []).forEach((p: any) => pMap.set(p.id, fullName(p)));
      }
      return recents
        .map((r) => {
          const d = detMap.get(r.id);
          return {
            id: r.id,
            clientName: nameOf.get(r.client_id) ?? 'Client',
            assessorName: r.coach_id ? pMap.get(r.coach_id) ?? null : null,
            label: r.chrono === 1 ? 'Baseline' : `Refresh ${r.chrono - 1}`,
            completedAt: r.completedAt,
            explainedAt: d?.qhp_explained_to_client_at ?? null,
            explainedBy: d?.qhp_explained_by ? pMap.get(d.qhp_explained_by) ?? null : null,
          };
        })
        .sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());
    },
  });
}

/* ---------- 9. Trainer incidents (all trainers + my authored counts) ---------- */
export type IncidentTrainer = { id: string; name: string; myCount: number };
export function useCrmIncidentTrainers(crmId: string | null) {
  return useQuery({
    queryKey: ['crm-incident-trainers', crmId],
    enabled: !!crmId,
    staleTime: 300_000,
    queryFn: async (): Promise<IncidentTrainer[]> => {
      const [tR, iR] = await Promise.all([
        supabase.from('profiles').select('id, first_name, last_name').eq('role', 'trainer').order('first_name', { ascending: true }).limit(300),
        supabase.from('trainers_incidents').select('trainer_id').eq('author_id', crmId),
      ]);
      const counts = new Map<string, number>();
      ((iR.data ?? []) as any[]).forEach((i) => counts.set(i.trainer_id, (counts.get(i.trainer_id) ?? 0) + 1));
      return ((tR.data ?? []) as any[]).map((t) => ({ id: t.id, name: fullName(t) ?? 'Trainer', myCount: counts.get(t.id) ?? 0 }));
    },
  });
}
export function useCrmTrainerIncidentHistory(trainerId: string | null) {
  return useQuery({
    queryKey: ['crm-trainer-incident-history', trainerId],
    enabled: !!trainerId,
    staleTime: 120_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trainers_incidents')
        .select('id, message, created_at, author_role, author:profiles!trainers_incidents_author_id_fkey(first_name, last_name)')
        .eq('trainer_id', trainerId)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map((r) => ({ id: r.id, message: r.message, createdAt: r.created_at, authorRole: r.author_role, authorName: fullName(r.author) ?? 'Unknown' }));
    },
  });
}

/* ---------- 10. Incentives (my events + referral/upgrade metrics) ---------- */
export type IncentiveData = {
  approvedReferrals: number; pendingReferrals: number; crossSells: number; packageUpgrades: number; subscriptionUpgrades: number;
  events: { id: string; type: string; date: string; clientName: string | null; detail: string | null }[];
};
export function useCrmIncentives(crmId: string | null) {
  return useQuery({
    queryKey: ['crm-incentives', crmId],
    enabled: !!crmId,
    staleTime: 300_000,
    queryFn: async (): Promise<IncentiveData> => {
      const [evR, refR] = await Promise.all([
        supabase.from('incentive_events').select('id, event_type, event_date, new_value, reference_id, reference_table, client:client_id(first_name, last_name)').eq('user_id', crmId).order('event_date', { ascending: false }).limit(30),
        supabase.from('referrals').select('id, status, referred_client_name').eq('referrer_id', crmId),
      ]);
      const refs = (refR.data ?? []) as any[];
      const events = (evR.data ?? []) as any[];
      const refName = new Map(refs.map((r) => [r.id, r.referred_client_name]));
      return {
        approvedReferrals: refs.filter((r) => r.status === 'approved').length,
        pendingReferrals: refs.filter((r) => r.status === 'pending').length,
        crossSells: events.filter((e) => e.event_type === 'cross_sell').length,
        packageUpgrades: events.filter((e) => e.event_type === 'package_upgrade').length,
        subscriptionUpgrades: events.filter((e) => e.event_type === 'subscription_upgrade').length,
        events: events.map((e) => ({
          id: e.id, type: String(e.event_type || 'event').replace(/_/g, ' '), date: e.event_date,
          clientName: fullName(e.client) ?? (e.reference_table === 'referrals' ? refName.get(e.reference_id) ?? null : null),
          detail: e.new_value ?? null,
        })),
      };
    },
  });
}

/* ---------- Close a trainer ticket (web useCRMTrainerTickets close mutation) ---------- */
export function useCloseTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { ticketId: string; closeRemark: string; closedBy: string }) => {
      const { error } = await supabase.from('trainer_tickets').update({
        status: 'closed',
        close_remark: input.closeRemark.trim() || null,
        closed_by: input.closedBy,
        closed_at: new Date().toISOString(),
      }).eq('id', input.ticketId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['crm-tickets'] });
      qc.invalidateQueries({ queryKey: ['crm-tickets-open-count'] });
    },
  });
}
