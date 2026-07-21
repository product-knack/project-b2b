import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';

/* ============ CRM Clients list + Client Details — mirrors the web CRMClients /
   CRMClientDetails contracts (useCRMClients, useCRMClientDetails,
   useClientPackageCycle, useClientAllSessions, useCRMCommunications). ============ */

const fullName = (p: any) => `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || 'Client';

/* ---------- A. Clients list ---------- */
export type CrmClientRow = {
  id: string; name: string; status: string; subscription: string | null;
  package: string | null; packageDuration: string | null; monthly: boolean; hasPackage: boolean;
  phone: string | null;
  appUser: boolean; renewalPending: boolean; paused: boolean;
};
export function useCrmClientList(crmId: string | null, status: 'active' | 'inactive') {
  return useQuery({
    queryKey: ['crm-client-list', crmId, status],
    enabled: !!crmId,
    staleTime: 60_000,
    queryFn: async (): Promise<CrmClientRow[]> => {
      const { data: assigned, error: aErr } = await supabase
        .from('trainer_clients').select('client_id').eq('trainer_id', crmId).eq('actively_training', true);
      if (aErr) throw new Error(aErr.message);
      const ids = [...new Set((assigned ?? []).map((r: any) => r.client_id))];
      if (!ids.length) return [];
      const { data: clients, error: cErr } = await supabase
        .from('clients')
        .select('id, first_name, last_name, status, subscription_type, session_package, package_duration, is_monthly_subscription, created_at, phone, profile_id')
        .in('id', ids).eq('status', status).order('created_at', { ascending: false });
      if (cErr) throw new Error(cErr.message);
      const rows = (clients ?? []) as any[];
      if (!rows.length) return [];
      const cIds = rows.map((r) => r.id);
      const pIds = [...new Set(rows.map((r) => r.profile_id).filter(Boolean))];

      const [profR, renR, sessR, pauseR] = await Promise.all([
        pIds.length ? supabase.from('profiles').select('id, health_data_consent, subscription_type').in('id', pIds) : Promise.resolve({ data: [] as any[] }),
        supabase.from('client_renewals').select('client_id, package_sessions, renewed_at').in('client_id', cIds).order('renewed_at', { ascending: false }),
        supabase.from('training_sessions').select('client_id, scheduled_at').in('client_id', cIds).eq('status', 'completed'),
        supabase.from('client_pause_history').select('client_id').in('client_id', cIds).eq('is_active', true),
      ]);
      const prof = new Map((profR.data ?? []).map((p: any) => [p.id, p]));
      const latestRen = new Map<string, any>();
      (renR.data ?? []).forEach((r: any) => { if (!latestRen.has(r.client_id)) latestRen.set(r.client_id, r); });
      const paused = new Set((pauseR.data ?? []).map((p: any) => p.client_id));

      return rows.map((c) => {
        const p = c.profile_id ? prof.get(c.profile_id) : null;
        const ren = latestRen.get(c.id);
        const pkg = Number(ren?.package_sessions) || parseInt(c.session_package) || 0;
        const from = ren?.renewed_at || c.created_at;
        const done = (sessR.data ?? []).filter((s: any) => s.client_id === c.id && s.scheduled_at >= from).length;
        return {
          id: c.id, name: fullName(c), status: c.status ?? 'active',
          subscription: p?.subscription_type ?? c.subscription_type ?? null,
          package: c.session_package ?? null,
          packageDuration: c.package_duration ?? null,
          monthly: c.is_monthly_subscription === true,
          // Web hasNoPackage rule: no monthly flag, no session package, no duration.
          hasPackage: !!(c.is_monthly_subscription || c.session_package || c.package_duration),
          phone: c.phone ?? null,
          appUser: p?.health_data_consent === true,
          renewalPending: pkg > 0 && done >= pkg,
          paused: paused.has(c.id),
        };
      });
    },
  });
}

/* ---------- B. Client detail (header + basic details) ---------- */
export type CrmClientDetail = {
  client: any;
  subscription: string | null;
  appUser: boolean;
  trainers: { id: string; name: string; role: string | null }[]; // active only
  crms: { id: string; name: string }[];
  basicInfo: { clientAge?: any; clientGender?: any; clientHeight?: any; clientWeight?: any; clientDob?: any } | null;
  journeyPct: number;
  journeyDone: number;
  journeyTotal: number;
};
export function useCrmClientDetail(clientId: string | null) {
  return useQuery({
    queryKey: ['crm-client-detail', clientId],
    enabled: !!clientId,
    staleTime: 60_000,
    queryFn: async (): Promise<CrmClientDetail> => {
      const { data: client, error } = await supabase.from('clients').select('*').eq('id', clientId).single();
      if (error) throw new Error(error.message);
      let subscription = client.subscription_type ?? null;
      let appUser = false;
      if (client.profile_id) {
        const { data: p } = await supabase.from('profiles').select('subscription_type, health_data_consent').eq('id', client.profile_id).maybeSingle();
        if (p?.subscription_type) subscription = p.subscription_type;
        appUser = p?.health_data_consent === true;
      }
      // Assigned team — trainer_clients + profile roles (active assignments).
      const { data: tc } = await supabase
        .from('trainer_clients')
        .select('trainer_id, actively_training, profiles:trainer_id(id, first_name, last_name, role)')
        .eq('client_id', clientId);
      const active = ((tc ?? []) as any[]).filter((t) => t.actively_training && t.profiles);
      const trainers = active.filter((t) => t.profiles.role === 'trainer').map((t) => ({ id: t.profiles.id, name: fullName(t.profiles), role: t.profiles.role }));
      const crms = active.filter((t) => t.profiles.role === 'crm').map((t) => ({ id: t.profiles.id, name: fullName(t.profiles) }));
      // Latest assessment → basicInfo (age/gender/height/weight/dob).
      const { data: assess } = await supabase
        .from('coach_assessment')
        .select('qhp_data, new_client_assessment_data, existing_client_assessment_data')
        .eq('client_id', clientId).order('assessment_date', { ascending: false }).limit(1);
      const raw: any = assess?.[0]?.qhp_data ?? assess?.[0]?.new_client_assessment_data ?? assess?.[0]?.existing_client_assessment_data ?? null;
      const basicInfo = raw?.['Standardized Assessment']?.clientProfile?.basicInfo ?? raw?.clientProfile?.basicInfo ?? null;
      // Onboarding journey % (17 boolean steps on clients.client_onboard_journey).
      const j = client.client_onboard_journey ?? {};
      const flags = Object.values(j).filter((v) => typeof v === 'boolean') as boolean[];
      const journeyTotal = Math.max(flags.length, 17);
      const journeyDone = flags.filter(Boolean).length;
      return {
        client, subscription, appUser, trainers, crms, basicInfo,
        journeyPct: journeyTotal ? Math.round((journeyDone / journeyTotal) * 100) : 0,
        journeyDone, journeyTotal,
      };
    },
  });
}

/* ---------- C. Package & cycle (mirrors useClientPackageCycle, incl. generation pooling) ---------- */
export type PackageCycle = {
  packageStart: string | null; totalSessions: number; completed: number;
  renewalPending: boolean; currentCycle: number; sessionsPerCycle: number;
  inCycle: number; remainingInCycle: number; monthly: boolean;
};
export function usePackageCycle(clientId: string | null) {
  return useQuery({
    queryKey: ['crm-package-cycle', clientId],
    enabled: !!clientId,
    staleTime: 120_000,
    queryFn: async (): Promise<PackageCycle> => {
      const { data: client, error } = await supabase
        .from('clients').select('id, session_package, sessions_per_cycle, created_at, is_monthly_subscription').eq('id', clientId).single();
      if (error) throw new Error(error.message);
      const { data: ren } = await supabase
        .from('client_renewals').select('renewed_at, package_sessions, cycle_sessions')
        .eq('client_id', clientId).order('renewed_at', { ascending: false }).limit(1);
      const latest = ren?.[0];
      const monthly = client.is_monthly_subscription === true;
      const packageStart = latest?.renewed_at || client.created_at || null;
      let totalSessions = Number(latest?.package_sessions) || parseInt(client.session_package) || 0;
      const sessionsPerCycle = Number(latest?.cycle_sessions) || Number(client.sessions_per_cycle) || 0;
      let from = packageStart ?? '1970-01-01';
      if (monthly) {
        const now = new Date();
        from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      }
      // Generation pooling (same RPCs as the web).
      let extra = 0;
      try {
        const { data: adminId } = await supabase.rpc('get_generation_admin_for_client', { p_client_id: clientId });
        if (adminId && adminId !== clientId && !totalSessions) {
          const { data: adminClient } = await supabase.from('clients').select('session_package').eq('id', adminId).maybeSingle();
          totalSessions = parseInt(adminClient?.session_package) || totalSessions;
        }
        if (adminId === clientId) {
          const { data: memberCount } = await supabase.rpc('get_generation_member_sessions_count', { p_admin_client_id: clientId, p_since: from });
          extra = Number(memberCount) || 0;
        }
      } catch { /* RPCs optional */ }
      const { data: sess } = await supabase
        .from('training_sessions').select('id, scheduled_at')
        .eq('client_id', clientId).neq('status', 'parked').eq('complimentary_session', false)
        .gte('scheduled_at', from);
      const completed = (sess?.length ?? 0) + extra;
      const inCycle = sessionsPerCycle > 0 ? completed % sessionsPerCycle : completed;
      const currentCycle = sessionsPerCycle > 0 ? Math.floor(completed / sessionsPerCycle) + 1 : 1;
      return {
        packageStart, totalSessions, completed,
        renewalPending: totalSessions > 0 && completed >= totalSessions,
        currentCycle, sessionsPerCycle,
        inCycle, remainingInCycle: sessionsPerCycle > 0 ? sessionsPerCycle - inCycle : 0,
        monthly,
      };
    },
  });
}

/* ---------- D. All sessions — mirrors web useClientAllSessions exactly:
   unified training_sessions + cancelled session_schedule, categorized
   workout/rehab/cancelled/other, cancelled rows deduped by trainer+minute. ---------- */
export type SessionCategory = 'workout' | 'rehab' | 'cancelled' | 'other';
const REHAB_SESSION_TYPES = new Set([
  'physiotherapy', 'rehabilitation', 'massage_therapy', 'red_light_therapy',
  'cold_bath_therapy', 'pneumatic_therapy', 'cupping_therapy', 'dry_needling', 'cryotherapy',
]);
const categorize = (sessionType: string | null, status: string): SessionCategory => {
  if (status === 'cancelled') return 'cancelled';
  if (sessionType && REHAB_SESSION_TYPES.has(sessionType)) return 'rehab';
  if (sessionType === 'personal_training' || sessionType === 'workout') return 'workout';
  return 'other';
};
export type CrmSessionRow = { id: string; when: string; type: string; category: SessionCategory; status: string; trainerName: string; notes: string | null; cancelled: boolean };
export function useCrmClientSessions(clientId: string | null) {
  return useQuery({
    queryKey: ['crm-client-sessions', clientId],
    enabled: !!clientId,
    staleTime: 30_000,
    queryFn: async (): Promise<CrmSessionRow[]> => {
      const [tsR, ssR] = await Promise.all([
        supabase.from('training_sessions').select('id, scheduled_at, session_type, status, trainer_id, notes').eq('client_id', clientId).neq('status', 'parked').order('scheduled_at', { ascending: false }),
        supabase.from('session_schedule').select('id, scheduled_datetime, session_type, modality, status, trainer_id, cancellation_remark').eq('client_id', clientId).eq('status', 'cancelled').order('scheduled_datetime', { ascending: false }),
      ]);
      if (tsR.error) throw new Error(tsR.error.message);
      const tIds = [...new Set([...(tsR.data ?? []), ...(ssR.data ?? [])].map((r: any) => r.trainer_id).filter(Boolean))];
      const names = new Map<string, string>();
      if (tIds.length) {
        const { data: profs } = await supabase.from('profiles').select('id, first_name, last_name').in('id', tIds);
        (profs ?? []).forEach((p: any) => names.set(p.id, fullName(p)));
      }
      const pretty = (t: string | null) => (t || 'session').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      const a: CrmSessionRow[] = (tsR.data ?? []).map((r: any) => ({
        id: r.id, when: r.scheduled_at, type: pretty(r.session_type),
        category: categorize(r.session_type, r.status ?? 'scheduled'), status: r.status ?? 'scheduled',
        trainerName: r.trainer_id ? names.get(r.trainer_id) ?? 'Trainer' : 'N/A', notes: r.notes ?? null,
        cancelled: r.status === 'cancelled',
      }));
      // Dedupe: cancelled schedule rows matching a training_sessions cancellation by trainer + minute.
      const tsCancelledKeys = new Set(a.filter((s) => s.cancelled).map((s) => `${s.trainerName}|${(s.when ?? '').slice(0, 16)}`));
      const b: CrmSessionRow[] = (ssR.data ?? [])
        .map((r: any): CrmSessionRow | null => {
          const trainerName = r.trainer_id ? names.get(r.trainer_id) ?? 'Trainer' : 'N/A';
          if (tsCancelledKeys.has(`${trainerName}|${(r.scheduled_datetime ?? '').slice(0, 16)}`)) return null;
          return {
            id: `ss-${r.id}`, when: r.scheduled_datetime, type: pretty(r.session_type || r.modality),
            category: 'cancelled', status: 'cancelled', trainerName, notes: r.cancellation_remark ?? null, cancelled: true,
          };
        })
        .filter((x): x is CrmSessionRow => x !== null);
      return [...a, ...b].sort((x, y) => (y.when ?? '').localeCompare(x.when ?? ''));
    },
  });
}

/* ---------- D1b. Logged workouts (mirrors web ClientWorkoutSessions):
   workout_exercises grouped into sessions with per-exercise set summaries. ---------- */
export type WorkoutLogSession = {
  id: string; name: string | null; date: string | null; trainerName: string; remark: string | null;
  exercises: { name: string; sets: number; topReps: number | null; topLoad: number | null }[];
};
export function useClientWorkoutLog(clientId: string | null) {
  return useQuery({
    queryKey: ['crm-client-workout-log', clientId],
    enabled: !!clientId,
    staleTime: 60_000,
    queryFn: async (): Promise<WorkoutLogSession[]> => {
      const { data, error } = await supabase
        .from('workout_exercises')
        .select('session_id, session_name, session_date, created_at, trainer_id, remark, exercise_name, set_number, reps_performed, load_performed')
        .eq('client_id', clientId)
        .order('session_date', { ascending: false })
        .limit(800);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as any[];
      const names = new Map<string, string>();
      const tIds = [...new Set(rows.map((r) => r.trainer_id).filter(Boolean))];
      if (tIds.length) {
        const { data: profs } = await supabase.from('profiles').select('id, first_name, last_name').in('id', tIds);
        (profs ?? []).forEach((p: any) => names.set(p.id, fullName(p)));
      }
      const sessions = new Map<string, { meta: any; ex: Map<string, { sets: number; topReps: number | null; topLoad: number | null }> }>();
      rows.forEach((r) => {
        if (!sessions.has(r.session_id)) sessions.set(r.session_id, { meta: r, ex: new Map() });
        const s = sessions.get(r.session_id)!;
        const name = r.exercise_name || 'Exercise';
        const cur = s.ex.get(name) ?? { sets: 0, topReps: null, topLoad: null };
        cur.sets += 1;
        const reps = Number(r.reps_performed), load = Number(r.load_performed);
        if (isFinite(reps) && reps > 0 && (cur.topReps == null || reps > cur.topReps)) cur.topReps = reps;
        if (isFinite(load) && load > 0 && (cur.topLoad == null || load > cur.topLoad)) cur.topLoad = load;
        s.ex.set(name, cur);
      });
      return [...sessions.values()]
        .map(({ meta, ex }) => ({
          id: meta.session_id,
          name: meta.session_name ?? null,
          date: meta.session_date ?? meta.created_at ?? null,
          trainerName: meta.trainer_id ? names.get(meta.trainer_id) ?? 'Trainer' : 'N/A',
          remark: meta.remark ?? null,
          exercises: [...ex.entries()].map(([name, v]) => ({ name, ...v })),
        }))
        .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
    },
  });
}

/* ---------- D2. Training frequency by modality (mirrors useClientTrainingFrequency):
   unique workout_exercises sessions in a period, grouped by modality. ---------- */
export const FREQ_PERIODS = [
  ['week', 'This Week'], ['15days', '15 Days'], ['monthly', 'This Month'],
  ['quarterly', 'Quarter'], ['6months', '6 Months'],
] as const;
export type FreqPeriod = typeof FREQ_PERIODS[number][0];
export function useTrainingFrequency(clientId: string | null, period: FreqPeriod) {
  return useQuery({
    queryKey: ['crm-training-frequency', clientId, period],
    enabled: !!clientId,
    staleTime: 60_000,
    queryFn: async () => {
      const end = new Date();
      let start: Date;
      if (period === 'week') {
        start = new Date(end);
        const day = (end.getDay() + 6) % 7; // Monday start
        start.setDate(end.getDate() - day); start.setHours(0, 0, 0, 0);
      } else if (period === '15days') start = new Date(end.getTime() - 15 * 864e5);
      else if (period === 'monthly') start = new Date(end.getFullYear(), end.getMonth(), 1);
      else if (period === 'quarterly') start = new Date(end.getFullYear(), Math.floor(end.getMonth() / 3) * 3, 1);
      else { start = new Date(end); start.setMonth(end.getMonth() - 6); }
      const totalWeeks = ((end.getTime() - start.getTime()) / 864e5 + 1) / 7;

      const { data, error } = await supabase
        .from('workout_exercises')
        .select('session_id, session_date, session_name, modality, body_part')
        .eq('client_id', clientId)
        .gte('session_date', start.toISOString().slice(0, 10))
        .lte('session_date', end.toISOString().slice(0, 10))
        .order('session_date', { ascending: false });
      if (error) throw new Error(error.message);

      const sessions = new Map<string, { modality: string; date: string | null }>();
      (data ?? []).forEach((ex: any) => {
        if (!sessions.has(ex.session_id)) sessions.set(ex.session_id, { modality: ex.modality || ex.body_part || 'Other', date: ex.session_date });
      });
      const byModality = new Map<string, number>();
      sessions.forEach((s) => byModality.set(s.modality, (byModality.get(s.modality) ?? 0) + 1));
      const frequencies = [...byModality.entries()]
        .map(([modality, count]) => ({ modality, count, weekly: totalWeeks > 0 ? count / totalWeeks : 0 }))
        .sort((x, y) => y.count - x.count);
      return { frequencies, totalSessions: sessions.size, totalWeeks };
    },
  });
}

/* ---------- E. Communications (list + log + mark done) ---------- */
export const COMM_CATEGORIES = ['Regular Touch Point', 'After 3 Session Feedback', 'After 6 Session Feedback', 'Renewal', 'Upsell'] as const;
export const COMM_STATUSES = ['Follow Up Done', 'Follow-up Required', 'Not Responding', 'Counselling Done', 'Call Rescheduled', 'Client Not Available'] as const;
export const COMM_MEDIUMS = ['phone', 'whatsapp', 'email'] as const;
export type CommEntry = { id: string; callDate: string; status: string | null; category: string | null; medium: string | null; remarks: string | null; followUp: string | null; overdue: boolean };
export function useClientComms(clientId: string | null) {
  return useQuery({
    queryKey: ['crm-client-comms', clientId],
    enabled: !!clientId,
    staleTime: 30_000,
    queryFn: async (): Promise<CommEntry[]> => {
      const { data, error } = await supabase
        .from('crm_communications')
        .select('id, call_date, call_status, call_medium, category, remarks, next_follow_up_date')
        .eq('client_id', clientId).order('call_date', { ascending: false }).limit(50);
      if (error) throw new Error(error.message);
      const now = Date.now();
      return ((data ?? []) as any[]).map((r) => ({
        id: r.id, callDate: r.call_date, status: r.call_status ?? null, category: r.category ?? null,
        medium: r.call_medium ?? null, remarks: r.remarks ?? null, followUp: r.next_follow_up_date ?? null,
        overdue: r.call_status !== 'Follow Up Done' && !!r.next_follow_up_date && new Date(r.next_follow_up_date).getTime() < now,
      }));
    },
  });
}
/* ---------- E2. Communications book (all clients, dashboard page) ----------
   Mirrors web useCRMCommunicationsList + useCRMCommunicationsAnalytics:
   latest comm per client + 30-day KPIs from crm_communications by crm_id. ---------- */
export type CommsBookRow = {
  clientId: string; clientName: string; phone: string | null;
  commId: string; callDate: string; status: string | null; medium: string | null;
  category: string | null; remarks: string | null; followUp: string | null; overdue: boolean;
};
/* One entry in the full chronological log (every communication, not deduped). */
export type CommLogRow = {
  id: string; clientId: string; clientName: string; phone: string | null;
  callDate: string; status: string | null; medium: string | null;
  category: string | null; remarks: string | null; followUp: string | null; overdue: boolean;
};
export type CommsBook = {
  rows: CommsBookRow[];   // latest touch point per client
  log: CommLogRow[];      // full chronological history — every entry
  outcomes: { status: string; count: number; pct: number }[]; // distribution over the window
  totalEntries: number;
  totalAttempts30d: number; pendingFollowUps: number; successRate: number; clientsContacted30d: number;
};
export function useCrmCommsBook(crmId: string | null) {
  return useQuery({
    queryKey: ['crm-comms-book', crmId],
    enabled: !!crmId,
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async (): Promise<CommsBook> => {
      const { data, error } = await supabase
        .from('crm_communications')
        .select('id, client_id, call_date, call_status, call_medium, category, remarks, next_follow_up_date, clients(id, first_name, last_name, phone)')
        .eq('crm_id', crmId)
        .order('call_date', { ascending: false })
        .limit(5000);
      if (error) throw new Error(error.message);
      const comms = (data ?? []) as any[];
      const now = Date.now();
      const overdueOf = (cm: any) => cm.call_status !== 'Follow Up Done' && !!cm.next_follow_up_date && new Date(cm.next_follow_up_date).getTime() < now;
      // Full chronological log — every entry with its client name (newest first).
      const log: CommLogRow[] = comms.map((cm) => {
        const cl = cm.clients;
        return {
          id: cm.id, clientId: cm.client_id, clientName: cl ? fullName(cl) : 'Client', phone: cl?.phone ?? null,
          callDate: cm.call_date, status: cm.call_status ?? null, medium: cm.call_medium ?? null,
          category: cm.category ?? null, remarks: cm.remarks ?? null, followUp: cm.next_follow_up_date ?? null,
          overdue: overdueOf(cm),
        };
      });
      // Latest comm per client (rows come newest-first).
      const byClient = new Map<string, CommsBookRow>();
      comms.forEach((cm) => {
        const cl = cm.clients;
        if (!cl || byClient.has(cl.id)) return;
        byClient.set(cl.id, {
          clientId: cl.id, clientName: fullName(cl), phone: cl.phone ?? null,
          commId: cm.id, callDate: cm.call_date, status: cm.call_status ?? null,
          medium: cm.call_medium ?? null, category: cm.category ?? null, remarks: cm.remarks ?? null,
          followUp: cm.next_follow_up_date ?? null,
          overdue: overdueOf(cm),
        });
      });
      // 30-day analytics (same window + formulas as the web).
      const cutoff = now - 30 * 864e5;
      const recent = comms.filter((cm) => new Date(cm.call_date).getTime() >= cutoff);
      const pendingFollowUps = comms.filter((cm) => cm.next_follow_up_date && new Date(cm.next_follow_up_date).getTime() >= now).length;
      const success = recent.filter((cm) => cm.call_status === 'Counselling Done').length;
      // Outcome distribution over the window (mirrors the web analytics chart).
      const outMap = new Map<string, number>();
      recent.forEach((cm) => { const s = cm.call_status ?? 'Unknown'; outMap.set(s, (outMap.get(s) ?? 0) + 1); });
      const outcomes = [...outMap.entries()]
        .map(([status, count]) => ({ status, count, pct: recent.length ? Math.round((count / recent.length) * 100) : 0 }))
        .sort((a, b) => b.count - a.count);
      return {
        rows: [...byClient.values()],
        log,
        outcomes,
        totalEntries: comms.length,
        totalAttempts30d: recent.length,
        pendingFollowUps,
        successRate: recent.length ? Math.round((success / recent.length) * 100) : 0,
        clientsContacted30d: new Set(recent.map((cm) => cm.client_id)).size,
      };
    },
  });
}

export function useLogCommunication() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { crmId: string; clientId: string; category: string; status: string; medium: string | null; remarks: string; followUpDate: string | null }) => {
      if (!input.remarks.trim()) throw new Error('Remarks are required');
      const { error } = await supabase.from('crm_communications').insert({
        crm_id: input.crmId,
        client_id: input.clientId,
        call_date: new Date().toISOString(),
        call_status: input.status,
        call_medium: input.medium,
        category: input.category,
        remarks: input.remarks.trim(),
        next_follow_up_date: input.followUpDate,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ['crm-client-comms', v.clientId] });
      qc.invalidateQueries({ queryKey: ['crm-comms-book'] });
      qc.invalidateQueries({ queryKey: ['crm-stale-comms'] });
      qc.invalidateQueries({ queryKey: ['crm-pending-comms'] });
    },
  });
}
export function useMarkCommDone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; clientId: string }) => {
      const { error } = await supabase.from('crm_communications').update({ call_status: 'Follow Up Done' }).eq('id', input.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ['crm-client-comms', v.clientId] });
      qc.invalidateQueries({ queryKey: ['crm-comms-book'] });
      qc.invalidateQueries({ queryKey: ['crm-pending-comms'] });
      qc.invalidateQueries({ queryKey: ['crm-stale-comms'] });
    },
  });
}

/* ---------- F. Status toggle (active ↔ inactive with reason + auto comm log) ---------- */
export function useSetClientStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { clientId: string; crmId: string; toStatus: 'active' | 'inactive'; reason?: string; crmName?: string }) => {
      const patch: any = { status: input.toStatus };
      if (input.toStatus === 'inactive') {
        const { data: cur } = await supabase.from('clients').select('inactive_reason').eq('id', input.clientId).maybeSingle();
        const prev = Array.isArray(cur?.inactive_reason) ? cur!.inactive_reason : [];
        patch.inactive_reason = [...prev, {
          reason: input.reason ?? 'Marked inactive from mobile app',
          marked_at: new Date().toISOString(),
          marked_by: input.crmId,
          marked_by_name: input.crmName ?? null,
          previous_status: 'active',
        }];
      }
      const { error } = await supabase.from('clients').update(patch).eq('id', input.clientId);
      if (error) throw new Error(error.message);
      // Mirrors the web logClientStatusChange (auto communication entry).
      await supabase.from('crm_communications').insert({
        crm_id: input.crmId,
        client_id: input.clientId,
        call_date: new Date().toISOString(),
        call_status: 'Follow Up Done',
        category: 'Regular Touch Point',
        remarks: `Status changed to ${input.toStatus}${input.reason ? ` — ${input.reason}` : ''}`,
      });
    },
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ['crm-client-detail', v.clientId] });
      qc.invalidateQueries({ queryKey: ['crm-client-list'] });
    },
  });
}
