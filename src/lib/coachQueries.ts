import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';

/* ============ COACH workspace (head-of-trainers) — mirrors the web /coach pages ============
   Universal scope everywhere:
     coach_trainers(coach_id = me) → trainerIds
     trainer_clients(trainer_id IN trainerIds, actively_training = true) → clientIds (unique)
   Then join clients / training_sessions / workout_plan_exercises / coach_assessment.
   RPCs (SECURITY DEFINER, verified live): get_pending_workout_plans_for_coach,
   get_pending_training_plans_for_coach, get_unique_client_plans. */

const nm = (p: any) => `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || '—';
const initialsOf = (s: string) => (s.trim()[0] ?? '?').toUpperCase();
const chunk = <T,>(arr: T[], n = 100): T[][] => { const out: T[][] = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

/* PostgREST caps a single response at 1000 rows. For raw-row aggregations (counting
   sessions/plan-exercises), page through with .range() until a short page. */
const PAGE = 1000;
async function fetchAll<T = any>(make: (from: number, to: number) => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 200_000; from += PAGE) {
    const { data, error } = await make(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/* Shared scope fetch. Returns the coach's trainer ids and unique active client ids. */
async function coachScope(uid: string): Promise<{ trainerIds: string[]; clientIds: string[] }> {
  const { data: ct, error } = await supabase.from('coach_trainers').select('trainer_id').eq('coach_id', uid);
  if (error) throw new Error(error.message);
  const trainerIds = [...new Set(((ct ?? []) as any[]).map((r) => r.trainer_id).filter(Boolean))] as string[];
  if (!trainerIds.length) return { trainerIds: [], clientIds: [] };
  const clientIds = new Set<string>();
  for (const part of chunk(trainerIds)) {
    const { data: tc } = await supabase.from('trainer_clients').select('client_id').in('trainer_id', part).eq('actively_training', true);
    (tc ?? []).forEach((r: any) => r.client_id && clientIds.add(r.client_id));
  }
  return { trainerIds, clientIds: [...clientIds] };
}

/* ---------------- 1. Dashboard ---------------- */
export type CoachTrainerPerf = { id: string; name: string; initial: string; count: number; prev: number; diffPct: number };
export type CoachDashboard = {
  totalTrainers: number; totalClients: number; newAssessments: number; reAssessments: number;
  trainers: CoachTrainerPerf[];
};
export function useCoachDashboard(uid: string | null) {
  return useQuery({
    queryKey: ['coach-dashboard-stats', uid],
    enabled: !!uid,
    staleTime: 120_000,
    queryFn: async (): Promise<CoachDashboard> => {
      const { trainerIds, clientIds } = await coachScope(uid!);
      const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
      const { data: ca } = await supabase.from('coach_assessment').select('id, client_id, created_at').eq('coach_id', uid!).gte('created_at', weekAgo);
      const newAssessments = (ca ?? []).filter((a: any) => a.client_id == null).length;
      const reAssessments = (ca ?? []).filter((a: any) => a.client_id != null).length;

      // Trainer performance: completed+marked sessions, this week vs previous week.
      const names = new Map<string, string>();
      for (const part of chunk(trainerIds)) {
        const { data: profs } = await supabase.from('profiles').select('id, first_name, last_name').in('id', part);
        (profs ?? []).forEach((p: any) => names.set(p.id, nm(p)));
      }
      const curStart = new Date(Date.now() - 7 * 864e5).toISOString();
      const prevStart = new Date(Date.now() - 14 * 864e5).toISOString();
      const cur = new Map<string, number>(), prev = new Map<string, number>();
      for (const part of chunk(trainerIds)) {
        const [c1, c2] = await Promise.all([
          fetchAll((f, t) => supabase.from('training_sessions').select('trainer_id').in('trainer_id', part).gte('scheduled_at', curStart).eq('status', 'completed').eq('attendance_marked', true).range(f, t)),
          fetchAll((f, t) => supabase.from('training_sessions').select('trainer_id').in('trainer_id', part).gte('scheduled_at', prevStart).lt('scheduled_at', curStart).eq('status', 'completed').eq('attendance_marked', true).range(f, t)),
        ]);
        c1.forEach((r: any) => cur.set(r.trainer_id, (cur.get(r.trainer_id) ?? 0) + 1));
        c2.forEach((r: any) => prev.set(r.trainer_id, (prev.get(r.trainer_id) ?? 0) + 1));
      }
      const trainers: CoachTrainerPerf[] = trainerIds.map((id) => {
        const count = cur.get(id) ?? 0, p = prev.get(id) ?? 0;
        const diffPct = p > 0 ? Math.round(((count - p) / p) * 100) : count > 0 ? 100 : 0;
        const name = names.get(id) ?? '—';
        return { id, name, initial: initialsOf(name), count, prev: p, diffPct };
      }).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

      return { totalTrainers: trainerIds.length, totalClients: clientIds.length, newAssessments, reAssessments, trainers };
    },
  });
}

/* ---------------- 2. My Clients ---------------- */
export type CoachClient = { id: string; name: string; initial: string; email: string | null; phone: string | null; status: string; sessions: number; subscription: string | null };
export function useCoachClients(uid: string | null) {
  return useQuery({
    queryKey: ['coach-clients', uid],
    enabled: !!uid,
    staleTime: 120_000,
    refetchInterval: false,
    queryFn: async (): Promise<CoachClient[]> => {
      const { clientIds } = await coachScope(uid!);
      if (!clientIds.length) return [];
      const clients: any[] = [];
      for (const part of chunk(clientIds)) {
        const { data } = await supabase.from('clients').select('id, first_name, last_name, email, phone, status, subscription_type').in('id', part);
        clients.push(...(data ?? []));
      }
      // conducted sessions per client (completed + attendance marked)
      const sessCount = new Map<string, number>();
      for (const part of chunk(clientIds)) {
        const rows = await fetchAll((f, t) => supabase.from('training_sessions').select('client_id').in('client_id', part).eq('status', 'completed').eq('attendance_marked', true).range(f, t));
        rows.forEach((r: any) => r.client_id && sessCount.set(r.client_id, (sessCount.get(r.client_id) ?? 0) + 1));
      }
      return clients.map((c) => {
        const name = nm(c);
        return { id: c.id, name, initial: initialsOf(name), email: c.email ?? null, phone: c.phone ?? null, status: c.status || 'Active', sessions: sessCount.get(c.id) ?? 0, subscription: c.subscription_type ?? null };
      }).sort((a, b) => a.name.localeCompare(b.name));
    },
  });
}

/* ---------------- 3. Clients Overview ----------------
   Mirrors web CoachClientsOverview.tsx EXACTLY: trainer_clients!inner(clients) join with
   subscription_type NOT NULL, dedupe by client id, then latest qhp_details per client.
   Query key carries a 'v2' version — the data shape changed and a stale persisted
   SQLite cache of the old shape crashes the screen (same failure QHP Manager had).
   If you change the returned shape again, bump to 'v3'. */
export type Improvement = 'good' | 'average' | 'poor' | 'unrated';
export type OverviewClient = { id: string; name: string; initial: string; email: string | null; phone: string | null; subscription: string; status: string; improvement: Improvement; latestQhpAt: number | null };
export type CoachClientsOverview = {
  clients: OverviewClient[];
  counts: { total: number; good: number; average: number; poor: number; unrated: number; qhpWeek: number; qhpMonth: number; noQhp: number };
};
const istWeekStartMs = () => { const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); d.setHours(0, 0, 0, 0); return d.getTime() - 5.5 * 3600e3 + d.getTimezoneOffset() * -60e3; };
const istMonthStartMs = () => { const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })); d.setDate(1); d.setHours(0, 0, 0, 0); return d.getTime() - 5.5 * 3600e3 + d.getTimezoneOffset() * -60e3; };
/* Same IST week/month starts the Overview counts use — so the screen filter matches the chip counts. */
export const qhpWindows = () => ({ week: istWeekStartMs(), month: istMonthStartMs() });
const VALID_IMP = new Set(['good', 'average', 'poor']);
export function useCoachClientsOverview(uid: string | null) {
  return useQuery({
    queryKey: ['coach-clients-overview', 'v2', uid],
    enabled: !!uid,
    staleTime: 120_000,
    refetchInterval: false,
    queryFn: async (): Promise<CoachClientsOverview> => {
      const { data: ct, error: tErr } = await supabase.from('coach_trainers').select('trainer_id').eq('coach_id', uid!);
      if (tErr) throw new Error(tErr.message);
      const trainerIds = [...new Set(((ct ?? []) as any[]).map((r) => r.trainer_id).filter(Boolean))] as string[];
      const empty: CoachClientsOverview = { clients: [], counts: { total: 0, good: 0, average: 0, poor: 0, unrated: 0, qhpWeek: 0, qhpMonth: 0, noQhp: 0 } };
      if (!trainerIds.length) return empty;

      // Active subscribed clients, one join query per trainer chunk (web parity).
      const byId = new Map<string, any>();
      for (const part of chunk(trainerIds)) {
        const rows = await fetchAll((f, t) => supabase
          .from('trainer_clients')
          .select('client_id, clients!inner(id, first_name, last_name, email, phone, subscription_type, status, improvement_status)')
          .eq('actively_training', true).in('trainer_id', part)
          .not('clients.subscription_type', 'is', null)
          .range(f, t));
        rows.forEach((r: any) => { const c = r.clients; if (c && c.subscription_type && !byId.has(c.id)) byId.set(c.id, c); });
      }
      if (!byId.size) return empty;

      // Latest QHP per client (qhp_details, newest first).
      const latest = new Map<string, number>();
      for (const part of chunk([...byId.keys()])) {
        const rows = await fetchAll((f, t) => supabase.from('qhp_details').select('client_id, created_at').in('client_id', part).order('created_at', { ascending: false }).range(f, t));
        rows.forEach((r: any) => { if (r.client_id && r.created_at && !latest.has(r.client_id)) latest.set(r.client_id, new Date(r.created_at).getTime()); });
      }

      const wk = istWeekStartMs(), mo = istMonthStartMs();
      const clients: OverviewClient[] = [...byId.values()].map((c) => {
        const name = nm(c);
        const imp = (VALID_IMP.has(c.improvement_status) ? c.improvement_status : 'unrated') as Improvement;
        return { id: c.id, name, initial: initialsOf(name), email: c.email ?? null, phone: c.phone ?? null, subscription: c.subscription_type, status: c.status || 'active', improvement: imp, latestQhpAt: latest.get(c.id) ?? null };
      }).sort((a, b) => a.name.localeCompare(b.name));
      const counts = {
        total: clients.length,
        good: clients.filter((c) => c.improvement === 'good').length,
        average: clients.filter((c) => c.improvement === 'average').length,
        poor: clients.filter((c) => c.improvement === 'poor').length,
        unrated: clients.filter((c) => c.improvement === 'unrated').length,
        qhpWeek: clients.filter((c) => c.latestQhpAt != null && c.latestQhpAt >= wk).length,
        qhpMonth: clients.filter((c) => c.latestQhpAt != null && c.latestQhpAt >= mo).length,
        noQhp: clients.filter((c) => c.latestQhpAt == null).length,
      };
      return { clients, counts };
    },
  });
}

/* Single client for the overview detail screen (fresh fetch + latest QHP date). */
export type OverviewClientDetail = OverviewClient & { avatarUrl: string | null };
export function useOverviewClientDetail(clientId: string | null) {
  return useQuery({
    queryKey: ['coach-overview-client', clientId],
    enabled: !!clientId,
    staleTime: 60_000,
    queryFn: async (): Promise<OverviewClientDetail | null> => {
      const [{ data: c, error }, { data: qhp }] = await Promise.all([
        supabase.from('clients').select('id, first_name, last_name, email, phone, avatar_url, subscription_type, status, improvement_status').eq('id', clientId!).maybeSingle(),
        supabase.from('qhp_details').select('created_at').eq('client_id', clientId!).order('created_at', { ascending: false }).limit(1),
      ]);
      if (error) throw new Error(error.message);
      if (!c) return null;
      const name = nm(c);
      const imp = (VALID_IMP.has((c as any).improvement_status) ? (c as any).improvement_status : 'unrated') as Improvement;
      const latestIso = (qhp ?? [])[0]?.created_at ?? null;
      return { id: c.id, name, initial: initialsOf(name), email: c.email ?? null, phone: c.phone ?? null, avatarUrl: (c as any).avatar_url ?? null, subscription: (c as any).subscription_type ?? '—', status: (c as any).status || 'active', improvement: imp, latestQhpAt: latestIso ? new Date(latestIso).getTime() : null };
    },
  });
}

/* Coach performance rating — web ImprovementStatusSelector contract: direct UPDATE
   clients.improvement_status ('good'|'average'|'poor'|null to clear). RLS verified live. */
export function useSetImprovementStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { clientId: string; next: 'good' | 'average' | 'poor' | null }) => {
      const { error } = await supabase.from('clients').update({ improvement_status: input.next }).eq('id', input.clientId);
      if (error) throw new Error(error.message);
      return input.next;
    },
    onSuccess: (_next, input) => {
      qc.invalidateQueries({ queryKey: ['coach-overview-client', input.clientId] });
      qc.invalidateQueries({ queryKey: ['coach-clients-overview'] });
    },
  });
}

/* ---------------- 4. Trainers ---------------- */
export type CoachTrainer = { id: string; name: string; initial: string; email: string | null; phone: string | null; clients: number; sessions: number; attendanceRate: number };
export function useCoachTrainers(uid: string | null) {
  return useQuery({
    queryKey: ['coach-trainers', uid],
    enabled: !!uid,
    staleTime: 300_000,
    refetchInterval: false,
    queryFn: async (): Promise<CoachTrainer[]> => {
      const { data: ct, error } = await supabase.from('coach_trainers').select('trainer_id').eq('coach_id', uid!);
      if (error) throw new Error(error.message);
      const trainerIds = [...new Set(((ct ?? []) as any[]).map((r) => r.trainer_id).filter(Boolean))] as string[];
      if (!trainerIds.length) return [];
      const profMap = new Map<string, any>();
      const sess = new Map<string, { total: number; marked: number }>();
      const clientsPer = new Map<string, Set<string>>();
      for (const part of chunk(trainerIds)) {
        const [{ data: profs }, ts, { data: tc }] = await Promise.all([
          supabase.from('profiles').select('id, first_name, last_name, email, phone').in('id', part),
          fetchAll((f, t) => supabase.from('training_sessions').select('trainer_id, attendance_marked').in('trainer_id', part).range(f, t)),
          supabase.from('trainer_clients').select('trainer_id, client_id').in('trainer_id', part).eq('actively_training', true),
        ]);
        (profs ?? []).forEach((p: any) => profMap.set(p.id, p));
        ts.forEach((r: any) => { const s = sess.get(r.trainer_id) ?? { total: 0, marked: 0 }; s.total++; if (r.attendance_marked) s.marked++; sess.set(r.trainer_id, s); });
        (tc ?? []).forEach((r: any) => { const set = clientsPer.get(r.trainer_id) ?? new Set(); if (r.client_id) set.add(r.client_id); clientsPer.set(r.trainer_id, set); });
      }
      return trainerIds.map((id) => {
        const p = profMap.get(id); const s = sess.get(id) ?? { total: 0, marked: 0 };
        const name = p ? nm(p) : '—';
        return { id, name, initial: initialsOf(name), email: p?.email ?? null, phone: p?.phone ?? null, clients: clientsPer.get(id)?.size ?? 0, sessions: s.total, attendanceRate: s.total ? Math.round((s.marked / s.total) * 100) : 0 };
      }).sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name));
    },
  });
}

/* ---------------- 4b. Trainer detail (web /coach/trainers/:id — TrainerDetails.tsx) ---------------- */
const TRAINER_PLAN_EXPIRY_DAYS = 42;
export type TrainerClientRow = { id: string; name: string; initial: string; phone: string | null; status: string; plan: { modality: string; approvedAt: string; expired: boolean } | null };
export type TrainerDetail = {
  id: string; name: string; initial: string; email: string | null; phone: string | null;
  totalSessions: number; monthSessions: number; attendanceRate: number;
  clients: TrainerClientRow[];
};
export function useTrainerDetail(trainerId: string | null) {
  return useQuery({
    queryKey: ['coach-trainer-detail', trainerId],
    enabled: !!trainerId,
    staleTime: 120_000,
    refetchInterval: false,
    queryFn: async (): Promise<TrainerDetail> => {
      const monthStartIso = new Date(istMonthStartMs()).toISOString();
      const [profRes, tcRes, totalRes, markedRes, monthRes] = await Promise.all([
        supabase.from('profiles').select('id, first_name, last_name, email, phone').eq('id', trainerId!).single(),
        supabase.from('trainer_clients').select('client_id, clients(id, first_name, last_name, phone, status)').eq('trainer_id', trainerId!),
        supabase.from('training_sessions').select('*', { count: 'exact', head: true }).eq('trainer_id', trainerId!),
        supabase.from('training_sessions').select('*', { count: 'exact', head: true }).eq('trainer_id', trainerId!).eq('attendance_marked', true),
        supabase.from('training_sessions').select('*', { count: 'exact', head: true }).eq('trainer_id', trainerId!).gte('scheduled_at', monthStartIso),
      ]);
      if (profRes.error) throw new Error(profRes.error.message);
      if (tcRes.error) throw new Error(tcRes.error.message);
      const p = profRes.data as any;
      const clientRows = ((tcRes.data ?? []) as any[]).map((r) => r.clients).filter(Boolean);
      const clientIds = clientRows.map((c: any) => c.id);

      // Latest approved workout plan per client (modality) with training-doc fallback (web rule).
      const planByClient = new Map<string, { modality: string; approvedAt: string }>();
      if (clientIds.length) {
        const wp = await fetchAll((f, t) => supabase.from('workout_plan_exercises')
          .select('client_id, modality, approved_at')
          .eq('trainer_id', trainerId!).eq('status', 'approved').not('approved_at', 'is', null)
          .in('client_id', clientIds).order('approved_at', { ascending: false }).range(f, t));
        (wp as any[]).forEach((r) => { if (r.client_id && !planByClient.has(r.client_id)) planByClient.set(r.client_id, { modality: r.modality || 'Manual', approvedAt: r.approved_at }); });
        for (const part of chunk(clientIds)) {
          const { data: tp } = await supabase.from('client_training_plans').select('client_id, approved_at').eq('trainer_id', trainerId!).eq('status', 'approved').in('client_id', part).order('approved_at', { ascending: false });
          (tp ?? []).forEach((r: any) => { if (r.client_id && r.approved_at && !planByClient.has(r.client_id)) planByClient.set(r.client_id, { modality: 'Training Plan', approvedAt: r.approved_at }); });
        }
      }
      const now = Date.now();
      const clients: TrainerClientRow[] = clientRows.map((c: any) => {
        const name = nm(c);
        const pl = planByClient.get(c.id) ?? null;
        return {
          id: c.id, name, initial: initialsOf(name), phone: c.phone ?? null, status: c.status || 'active',
          plan: pl ? { ...pl, expired: now > new Date(pl.approvedAt).getTime() + TRAINER_PLAN_EXPIRY_DAYS * 864e5 } : null,
        };
      }).sort((a, b) => a.name.localeCompare(b.name));

      const total = totalRes.count ?? 0;
      const marked = markedRes.count ?? 0;
      const name = nm(p);
      return {
        id: p.id, name, initial: initialsOf(name), email: p.email ?? null, phone: p.phone ?? null,
        totalSessions: total, monthSessions: monthRes.count ?? 0,
        attendanceRate: total ? Math.round((marked / total) * 100) : 0,
        clients,
      };
    },
  });
}
export type TrainerSessionRow = { id: string; clientName: string; at: string; marked: boolean; type: string | null };
const TRAINER_SESSIONS_PAGE = 5;
export function useTrainerSessions(trainerId: string | null, page: number) {
  return useQuery({
    queryKey: ['coach-trainer-sessions', trainerId, page],
    enabled: !!trainerId,
    staleTime: 60_000,
    queryFn: async (): Promise<TrainerSessionRow[]> => {
      const from = (page - 1) * TRAINER_SESSIONS_PAGE;
      const { data, error } = await supabase.from('training_sessions')
        .select('id, scheduled_at, attendance_marked, session_type, clients(first_name, last_name)')
        .eq('trainer_id', trainerId!).order('scheduled_at', { ascending: false })
        .range(from, from + TRAINER_SESSIONS_PAGE - 1);
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map((s) => ({ id: s.id, clientName: nm(s.clients), at: s.scheduled_at, marked: s.attendance_marked === true, type: s.session_type ?? null }));
    },
  });
}

/* ---------------- 5. Assessments ---------------- */
export type CoachAssessment = { id: string; clientName: string; assessorName: string; date: string | null; time: string | null; scheduled: boolean; completed: boolean };
export function useCoachAssessments(uid: string | null) {
  return useQuery({
    queryKey: ['coach-assessments', uid],
    enabled: !!uid,
    staleTime: 120_000,
    queryFn: async (): Promise<CoachAssessment[]> => {
      const { data: ct } = await supabase.from('coach_trainers').select('trainer_id').eq('coach_id', uid!);
      const trainerIds = [...new Set(((ct ?? []) as any[]).map((r) => r.trainer_id).filter(Boolean))] as string[];
      const allIds = [...new Set([...trainerIds, uid!])];
      const { data, error } = await supabase
        .from('coach_assessment')
        .select('id, client_name, coach_id, assessment_date, assessment_time, assessment_scheduled, completed')
        .or(`coach_id.in.(${allIds.join(',')}),scheduled_by.eq.${uid}`)
        .order('assessment_date', { ascending: false, nullsFirst: false })
        .limit(500);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as any[];
      const coachIds = [...new Set(rows.map((r) => r.coach_id).filter(Boolean))];
      const names = new Map<string, string>();
      for (const part of chunk(coachIds)) {
        const { data: profs } = await supabase.from('profiles').select('id, first_name, last_name').in('id', part);
        (profs ?? []).forEach((p: any) => names.set(p.id, nm(p)));
      }
      return rows.map((r) => ({
        id: r.id, clientName: r.client_name || '—',
        assessorName: r.coach_id ? names.get(r.coach_id) ?? 'Unassigned' : 'Unassigned',
        date: r.assessment_date ?? null, time: r.assessment_time ?? null,
        scheduled: r.assessment_scheduled === true, completed: r.completed != null,
      }));
    },
  });
}

/* ---------------- 6. Programs (approval inbox) ---------------- */
export type CoachPlan = { id: string; title: string; clientName: string; trainerName: string; modality: string | null; status: string | null; createdAt: string | null; kind: 'workout' | 'training'; fileUrl?: string | null };
async function hydrateNames(trainerIds: string[], clientIds: string[]) {
  const t = new Map<string, string>(), c = new Map<string, string>();
  for (const part of chunk([...new Set(trainerIds)].filter(Boolean))) { const { data } = await supabase.from('profiles').select('id, first_name, last_name').in('id', part); (data ?? []).forEach((p: any) => t.set(p.id, nm(p))); }
  for (const part of chunk([...new Set(clientIds)].filter(Boolean))) { const { data } = await supabase.from('clients').select('id, first_name, last_name').in('id', part); (data ?? []).forEach((p: any) => c.set(p.id, nm(p))); }
  return { t, c };
}
/* Pending-plans count for the dashboard alert (web useCoachPendingPlansCount port). */
export function useCoachPendingPlanCount(uid: string | null) {
  return useQuery({
    queryKey: ['coach-pending-plans-count', uid],
    enabled: !!uid,
    staleTime: 60_000,
    refetchInterval: 120_000,
    queryFn: async (): Promise<number> => {
      const [tr, wr] = await Promise.all([
        supabase.rpc('get_pending_training_plans_for_coach', { p_coach_id: uid }),
        supabase.rpc('get_pending_workout_plans_for_coach', { p_coach_id: uid, p_limit: 500 }),
      ]);
      const unique = new Set<string>();
      ((wr.data ?? []) as any[]).forEach((r) => { if (r.plan_id) unique.add(r.plan_id); });
      return ((tr.data ?? []) as any[]).length + unique.size;
    },
  });
}

/* ---------------- 6b. Programs v2 (redesigned screen) ----------------
   Web parity (CoachPrograms.tsx + UnifiedPendingPlansCard + useProcessedTrainingPlans):
   - pending = get_pending_workout_plans_for_coach (dedupe by plan_id) merged with
     get_pending_training_plans_for_coach, sorted newest first.
   - processed = client_training_plans in approved/rejected/needs_revision + exact count.
   - file_path / document_url are full public storage URLs → open with Linking.
   All reads + the workout UPDATE RLS verified live as coach 2026-07-15. */
export type ProgramPlan = {
  id: string; kind: 'workout' | 'training';
  title: string; clientName: string; trainerName: string;
  clientId: string | null; trainerId: string | null;
  modality: string | null; status: string; createdAt: string | null;
  description: string | null; weeks: number | null;
  fileUrl: string | null; fileName: string | null;
  feedback: string | null;
};
export type CoachProgramsV2 = { pending: ProgramPlan[]; processed: ProgramPlan[]; processedTotal: number };
export function useCoachProgramsV2(uid: string | null) {
  return useQuery({
    queryKey: ['coach-programs', 'v2', uid],
    enabled: !!uid,
    staleTime: 60_000,
    refetchOnMount: 'always', // web invalidates its caches on every mount — keep review queue fresh
    queryFn: async (): Promise<CoachProgramsV2> => {
      const [wpRes, tpRes, procRes, cntRes] = await Promise.all([
        supabase.rpc('get_pending_workout_plans_for_coach', { p_coach_id: uid, p_limit: 500 }),
        supabase.rpc('get_pending_training_plans_for_coach', { p_coach_id: uid }),
        supabase.from('client_training_plans')
          .select('id, file_name, file_path, status, coach_feedback, approved_at, uploaded_at, trainer_id, client_id, clients!inner(first_name, last_name)')
          .in('status', ['approved', 'rejected', 'needs_revision'])
          .order('approved_at', { ascending: false, nullsFirst: false })
          .order('uploaded_at', { ascending: false })
          .limit(20),
        supabase.from('client_training_plans').select('*', { count: 'exact', head: true }).in('status', ['approved', 'rejected', 'needs_revision']),
      ]);
      for (const r of [wpRes, tpRes, procRes]) if ((r as any).error) throw new Error((r as any).error.message);
      const wpMap = new Map<string, any>();
      ((wpRes.data ?? []) as any[]).forEach((r) => { if (r.plan_id && !wpMap.has(r.plan_id)) wpMap.set(r.plan_id, r); });
      const wpRows = [...wpMap.values()];
      const tpRows = (tpRes.data ?? []) as any[];
      const procRows = (procRes.data ?? []) as any[];
      const { t, c } = await hydrateNames(
        [...wpRows, ...tpRows, ...procRows].map((r) => r.trainer_id),
        wpRows.map((r) => r.client_id)
      );
      const pending: ProgramPlan[] = [
        ...wpRows.map((r): ProgramPlan => ({
          id: r.plan_id, kind: 'workout',
          title: r.plan_name || 'Workout plan', clientName: c.get(r.client_id) ?? '—', trainerName: t.get(r.trainer_id) ?? '—',
          clientId: r.client_id ?? null, trainerId: r.trainer_id ?? null,
          modality: r.modality ?? null, status: r.status ?? 'pending', createdAt: r.created_at ?? null,
          description: r.plan_description ?? null, weeks: r.plan_duration_weeks ?? null,
          fileUrl: r.document_url ?? null, fileName: r.document_filename ?? null, feedback: null,
        })),
        ...tpRows.map((r): ProgramPlan => ({
          id: r.id, kind: 'training',
          title: r.file_name || 'Training plan',
          clientName: `${r.client_first_name ?? ''} ${r.client_last_name ?? ''}`.trim() || '—',
          trainerName: t.get(r.trainer_id) ?? '—',
          clientId: r.client_id ?? null, trainerId: r.trainer_id ?? null,
          modality: null, status: r.status ?? 'pending_review', createdAt: r.uploaded_at ?? null,
          description: null, weeks: null,
          fileUrl: r.file_path ?? null, fileName: r.file_name ?? null, feedback: null,
        })),
      ].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
      const processed: ProgramPlan[] = procRows.map((r): ProgramPlan => ({
        id: r.id, kind: 'training',
        title: r.file_name || 'Training plan', clientName: nm(r.clients), trainerName: t.get(r.trainer_id) ?? '—',
        clientId: r.client_id ?? null, trainerId: r.trainer_id ?? null,
        modality: null, status: r.status ?? 'approved', createdAt: r.approved_at ?? r.uploaded_at ?? null,
        description: null, weeks: null,
        fileUrl: r.file_path ?? null, fileName: r.file_name ?? null, feedback: r.coach_feedback ?? null,
      }));
      return { pending, processed, processedTotal: cntRes.count ?? processed.length };
    },
  });
}

/* Full exercise list for one workout plan (the web WorkoutPlanView query). */
export type PlanExercise = {
  id: string; bodyPart: string; name: string; sets: string | null; reps: number | null;
  rmPct: number | null; load: number | null; tempo: string | null; rest: number | null;
  rir: number | null; duration: number | null; notes: string | null; superSet: string | null;
  subActivity: string | null; activityType: string | null;
};
export function usePlanExercises(planId: string | null) {
  return useQuery({
    queryKey: ['coach-plan-exercises', planId],
    enabled: !!planId,
    staleTime: 120_000,
    queryFn: async (): Promise<PlanExercise[]> => {
      const rows = await fetchAll((f, t) => supabase.from('workout_plan_exercises').select('*').eq('plan_id', planId!).order('order_index', { ascending: true, nullsFirst: false }).order('created_at', { ascending: true }).range(f, t));
      return (rows as any[]).map((r) => ({
        id: r.id, bodyPart: (r.body_part || 'General').trim(), name: r.exercise_name || 'Exercise',
        sets: r.set_number != null ? String(r.set_number) : null, reps: r.reps_target ?? null,
        rmPct: r.rm_percentage ?? null, load: r.load_target ?? null, tempo: r.tempo ?? null,
        rest: r.rest_period ?? null, rir: r.rir_target ?? null, duration: r.duration ?? null,
        notes: r.exercise_notes ?? null, superSet: r.super_set_group ?? null,
        subActivity: r.sub_activity ?? null, activityType: r.activity_type ?? null,
      }));
    },
  });
}

/* ---------------- 7. Progression (client picker) ---------------- */
export type ProgressionClient = { id: string; name: string; initial: string; email: string | null; modality: 'Hybrid' | 'In-Person'; subscription: string | null };
export function useCoachProgression(uid: string | null) {
  return useQuery({
    queryKey: ['coach-progression', uid],
    enabled: !!uid,
    staleTime: 300_000,
    refetchInterval: false,
    queryFn: async (): Promise<ProgressionClient[]> => {
      const { clientIds } = await coachScope(uid!);
      if (!clientIds.length) return [];
      const out: ProgressionClient[] = [];
      for (const part of chunk(clientIds)) {
        const { data } = await supabase.from('clients').select('id, first_name, last_name, email, is_hybrid, subscription_type').in('id', part);
        (data ?? []).forEach((c: any) => { const name = nm(c); out.push({ id: c.id, name, initial: initialsOf(name), email: c.email ?? null, modality: c.is_hybrid ? 'Hybrid' : 'In-Person', subscription: c.subscription_type ?? null }); });
      }
      return out.sort((a, b) => a.name.localeCompare(b.name));
    },
  });
}

/* ---------------- 8. Approved Plans ---------------- */
export function useCoachApprovedPlans(uid: string | null) {
  return useQuery({
    queryKey: ['coach-approved-plans', uid],
    enabled: !!uid,
    staleTime: 300_000,
    refetchInterval: false,
    queryFn: async (): Promise<CoachPlan[]> => {
      const { data: ct } = await supabase.from('coach_trainers').select('trainer_id').eq('coach_id', uid!);
      const trainerIds = [...new Set(((ct ?? []) as any[]).map((r) => r.trainer_id).filter(Boolean))] as string[];
      if (!trainerIds.length) return [];
      const wpMap = new Map<string, any>(); const tpRows: any[] = [];
      for (const part of chunk(trainerIds)) {
        const [wp, { data: tp }] = await Promise.all([
          fetchAll((f, t) => supabase.from('workout_plan_exercises').select('plan_id, plan_name, modality, status, approved_at, trainer_id, client_id').eq('status', 'approved').in('trainer_id', part).order('approved_at', { ascending: false, nullsFirst: false }).range(f, t)),
          supabase.from('client_training_plans').select('id, file_name, file_path, status, approved_at, trainer_id, client_id, clients(first_name, last_name)').eq('status', 'approved').in('trainer_id', part).order('approved_at', { ascending: false, nullsFirst: false }),
        ]);
        wp.forEach((r: any) => { if (r.plan_id && !wpMap.has(r.plan_id)) wpMap.set(r.plan_id, r); });
        tpRows.push(...(tp ?? []));
      }
      const wpRows = [...wpMap.values()];
      const { t, c } = await hydrateNames([...wpRows, ...tpRows].map((r) => r.trainer_id), wpRows.map((r) => r.client_id));
      const merged: CoachPlan[] = [
        ...wpRows.map((r) => ({ id: r.plan_id, title: r.plan_name || 'Workout plan', clientName: c.get(r.client_id) ?? '—', trainerName: t.get(r.trainer_id) ?? '—', modality: r.modality || 'Manual', status: 'approved', createdAt: r.approved_at ?? null, kind: 'workout' as const, fileUrl: null })),
        ...tpRows.map((r) => ({ id: r.id, title: r.file_name || 'Training plan', clientName: nm(r.clients), trainerName: t.get(r.trainer_id) ?? '—', modality: 'Document', status: 'approved', createdAt: r.approved_at ?? null, kind: 'training' as const, fileUrl: r.file_path ?? null })),
      ];
      return merged.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
    },
  });
}

/* ---------------- 9. Client Plans Overview ---------------- */
const PLAN_EXPIRY_DAYS = 42;
const normModality = (m: string | null) => {
  if (!m) return '—';
  return m.toLowerCase().includes('strength') ? 'Strength' : m.trim();
};
export type PlanChip = { modality: string; status: 'active' | 'expiring_soon' | 'expired'; daysLeft: number | null };
export type PlanOverviewRow = { clientId: string; name: string; initial: string; trainers: { id: string; name: string }[]; plans: PlanChip[] };
export type PlansOverview = { rows: PlanOverviewRow[]; allTrainers: { id: string; name: string }[]; allModalities: string[] };
export function useCoachPlansOverview(uid: string | null) {
  return useQuery({
    queryKey: ['coach-plans-overview', uid],
    enabled: !!uid,
    staleTime: 120_000,
    refetchInterval: false,
    queryFn: async (): Promise<PlansOverview> => {
      const { trainerIds, clientIds } = await coachScope(uid!);
      if (!clientIds.length) return { rows: [], allTrainers: [], allModalities: [] };
      // plans per client (latest per modality, from the DISTINCT-ON RPC)
      const plansByClient = new Map<string, any[]>();
      for (const part of chunk(clientIds, 50)) {
        const { data } = await supabase.rpc('get_unique_client_plans', { p_client_ids: part });
        (data ?? []).forEach((r: any) => { const arr = plansByClient.get(r.client_id) ?? []; arr.push(r); plansByClient.set(r.client_id, arr); });
      }
      // client names
      const cName = new Map<string, string>();
      for (const part of chunk(clientIds)) { const { data } = await supabase.from('clients').select('id, first_name, last_name').in('id', part); (data ?? []).forEach((c: any) => cName.set(c.id, nm(c))); }
      // trainer names (all coach trainers → filter dropdown)
      const tName = new Map<string, string>();
      for (const part of chunk(trainerIds)) { const { data } = await supabase.from('profiles').select('id, first_name, last_name').in('id', part); (data ?? []).forEach((p: any) => tName.set(p.id, nm(p))); }
      // ALL active trainers per client (not just the first)
      const trainersByClient = new Map<string, Set<string>>();
      for (const part of chunk(trainerIds)) {
        const { data } = await supabase.from('trainer_clients').select('client_id, trainer_id').in('trainer_id', part).eq('actively_training', true);
        (data ?? []).forEach((r: any) => { if (!r.client_id) return; const set = trainersByClient.get(r.client_id) ?? new Set<string>(); set.add(r.trainer_id); trainersByClient.set(r.client_id, set); });
      }
      const now = Date.now();
      const modalitySet = new Set<string>();
      const rows: PlanOverviewRow[] = clientIds.map((id) => {
        const raw = plansByClient.get(id) ?? [];
        const plans: PlanChip[] = raw.map((p: any) => {
          const appr = p.approved_at ? new Date(p.approved_at).getTime() : null;
          const expiry = appr != null ? appr + PLAN_EXPIRY_DAYS * 864e5 : null;
          const expired = expiry != null ? now > expiry : false;
          const daysLeft = expiry != null ? Math.ceil((expiry - now) / 864e5) : null;
          const modality = normModality(p.modality);
          modalitySet.add(modality);
          const status: PlanChip['status'] = expired ? 'expired' : (daysLeft ?? 99) <= 5 ? 'expiring_soon' : 'active';
          return { modality, status, daysLeft };
        });
        const trainers = [...(trainersByClient.get(id) ?? [])].map((tid) => ({ id: tid, name: tName.get(tid) ?? '—' })).sort((a, b) => a.name.localeCompare(b.name));
        const name = cName.get(id) ?? '—';
        return { clientId: id, name, initial: initialsOf(name), trainers, plans };
      }).sort((a, b) => a.name.localeCompare(b.name));
      const allTrainers = trainerIds.map((tid) => ({ id: tid, name: tName.get(tid) ?? '—' })).filter((t) => t.name !== '—').sort((a, b) => a.name.localeCompare(b.name));
      const allModalities = [...modalitySet].filter((m) => m !== '—').sort();
      return { rows, allTrainers, allModalities };
    },
  });
}

/* ---------------- 10. Calendar (team sessions for a day) ---------------- */
export type CoachSession = { id: string; clientName: string; trainerName: string; at: string; status: string; done: boolean; type: string | null };
export function useCoachCalendar(uid: string | null, dayOffset: number) {
  return useQuery({
    queryKey: ['coach-calendar', uid, dayOffset],
    enabled: !!uid,
    staleTime: 60_000,
    queryFn: async (): Promise<CoachSession[]> => {
      const { data: ct } = await supabase.from('coach_trainers').select('trainer_id').eq('coach_id', uid!);
      const trainerIds = [...new Set(((ct ?? []) as any[]).map((r) => r.trainer_id).filter(Boolean))] as string[];
      if (!trainerIds.length) return [];
      // IST day window → UTC
      const base = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      base.setDate(base.getDate() + dayOffset); base.setHours(0, 0, 0, 0);
      const startUtc = new Date(base.getTime() - 5.5 * 3600e3 + base.getTimezoneOffset() * -60e3);
      const endUtc = new Date(startUtc.getTime() + 864e5);
      const rows: any[] = [];
      for (const part of chunk(trainerIds)) {
        const part2 = await fetchAll((f, t) => supabase.from('training_sessions').select('id, client_id, trainer_id, scheduled_at, status, attendance_marked, session_type').in('trainer_id', part).gte('scheduled_at', startUtc.toISOString()).lt('scheduled_at', endUtc.toISOString()).order('scheduled_at').range(f, t));
        rows.push(...part2);
      }
      const clientIds = [...new Set(rows.map((r) => r.client_id).filter(Boolean))];
      const cName = new Map<string, string>(); const tName = new Map<string, string>();
      for (const part of chunk(clientIds)) { const { data } = await supabase.from('clients').select('id, first_name, last_name').in('id', part); (data ?? []).forEach((c: any) => cName.set(c.id, nm(c))); }
      for (const part of chunk(trainerIds)) { const { data } = await supabase.from('profiles').select('id, first_name, last_name').in('id', part); (data ?? []).forEach((p: any) => tName.set(p.id, nm(p))); }
      return rows.map((r) => ({
        id: r.id, clientName: (r.client_id && cName.get(r.client_id)) || '—', trainerName: tName.get(r.trainer_id) ?? '—',
        at: r.scheduled_at, status: r.status || 'scheduled', done: r.status === 'completed' && r.attendance_marked === true, type: r.session_type ?? null,
      })).sort((a, b) => a.at.localeCompare(b.at));
    },
  });
}

/* ---------------- Programs: approve / reject / needs-revision ----------------
   No approval RPC exists — the web coach writes status directly (RLS-authorized).
   Workout plans: update ALL workout_plan_exercises rows by plan_id.
   Training plans: update the single client_training_plans row by id.
   approve → status 'approved' + approved_by/approved_at; reject/needs_revision
   set status + coach_feedback only (feedback required). */
export type PlanAction = 'approve' | 'reject' | 'needs_revision';
export function useProcessCoachPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { kind: 'workout' | 'training'; id: string; action: PlanAction; feedback: string; coachId: string }) => {
      const fb = input.feedback.trim();
      if ((input.action === 'reject' || input.action === 'needs_revision') && !fb) throw new Error('Please add feedback for the trainer.');
      const status = input.action === 'approve' ? 'approved' : input.action === 'reject' ? 'rejected' : 'needs_revision';
      const patch: any = { status, coach_feedback: fb || null };
      if (input.action === 'approve') { patch.approved_by = input.coachId; patch.approved_at = new Date().toISOString(); }
      const table = input.kind === 'workout' ? 'workout_plan_exercises' : 'client_training_plans';
      const col = input.kind === 'workout' ? 'plan_id' : 'id';
      const { error } = await supabase.from(table).update(patch).eq(col, input.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['coach-programs'] }); qc.invalidateQueries({ queryKey: ['coach-approved-plans'] }); qc.invalidateQueries({ queryKey: ['coach-pending-plans-count'] }); },
  });
}

/* ---------------- Critical biomarkers (latest active health_reports) ----------------
   Ports the web extractConcerningMarkers: extracted_data.tests[].markers[]; a marker
   is "concerning" when its resolved status is not normal. status ∈ normal|low|high|
   abnormal|critical → mapped to low|high|critical. */
export type ConcerningMarker = { name: string; value: string; unit: string; referenceRange: string; status: 'low' | 'high' | 'critical' };
function parseRefRange(ref: string): { min?: number; max?: number } {
  if (!ref || ref === 'NA') return {};
  const t = ref.trim();
  let m = t.match(/^<\s*([\d.]+)$/); if (m) return { max: parseFloat(m[1]) };
  m = t.match(/^>\s*([\d.]+)$/); if (m) return { min: parseFloat(m[1]) };
  m = t.match(/^([\d.]+)\s*[-–]\s*([\d.]+)$/); if (m) return { min: parseFloat(m[1]), max: parseFloat(m[2]) };
  return {};
}
function computeStatus(value: any, ref: string): 'normal' | 'low' | 'high' {
  if (value == null) return 'normal';
  const n = parseFloat(String(value).replace(/,/g, ''));
  if (Number.isNaN(n)) return 'normal';
  const { min, max } = parseRefRange(ref || '');
  if (min === undefined && max === undefined) return 'normal';
  if (min !== undefined && n < min) return 'low';
  if (max !== undefined && n > max) return 'high';
  return 'normal';
}
export function extractConcerningMarkers(extracted: any): ConcerningMarker[] {
  const out: ConcerningMarker[] = [];
  if (!extracted?.tests) return out;
  for (const test of extracted.tests) {
    if (!test?.markers) continue;
    for (const mk of test.markers) {
      if (!mk || mk.value == null || mk.value === '') continue;
      const raw = (mk.status as string) || computeStatus(mk.value, mk.reference_range);
      if (raw === 'normal' || !raw) continue;
      const status: ConcerningMarker['status'] = raw === 'critical' ? 'critical' : raw === 'low' ? 'low' : 'high';
      out.push({ name: mk.name, value: String(mk.value), unit: mk.unit || '', referenceRange: mk.reference_range || '', status });
    }
  }
  const order = { critical: 0, high: 1, low: 2 } as const;
  return out.sort((a, b) => order[a.status] - order[b.status]);
}
export function useClientCriticalMarkers(clientId: string | null) {
  return useQuery({
    queryKey: ['coach-client-markers', clientId],
    enabled: !!clientId,
    staleTime: 300_000,
    queryFn: async (): Promise<{ markers: ConcerningMarker[]; reportDate: string | null }> => {
      const { data, error } = await supabase.from('health_reports').select('extracted_data, created_at').eq('client_id', clientId).eq('is_active', true).not('extracted_data', 'is', null).order('created_at', { ascending: false }).limit(1);
      if (error) throw new Error(error.message);
      if (!data || !data.length) return { markers: [], reportDate: null };
      return { markers: extractConcerningMarkers(data[0].extracted_data), reportDate: data[0].created_at };
    },
  });
}

/* Compact progression summary from workout_analysis (full charts live in ClientDetail). */
export type ProgressionSummary = { count: number; latestLoad: number | null; latest1RM: number | null; loadSeries: number[]; recent: { date: string; load: number | null; oneRm: number | null; type: string | null }[] };
export function useClientProgressionSummary(clientId: string | null) {
  return useQuery({
    queryKey: ['coach-client-progression', clientId],
    enabled: !!clientId,
    staleTime: 120_000,
    queryFn: async (): Promise<ProgressionSummary> => {
      const { data, error } = await supabase.from('workout_analysis').select('created_at, session_load, max_1rm, workout_type').eq('client_id', clientId).order('created_at', { ascending: true });
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as any[];
      const last = rows[rows.length - 1];
      const loadSeries = rows.slice(-14).map((r) => Number(r.session_load) || 0);
      const recent = rows.slice(-8).reverse().map((r) => ({ date: r.created_at, load: r.session_load != null ? Number(r.session_load) : null, oneRm: r.max_1rm != null ? Number(r.max_1rm) : null, type: r.workout_type ?? null }));
      return { count: rows.length, latestLoad: last?.session_load != null ? Number(last.session_load) : null, latest1RM: last?.max_1rm != null ? Number(last.max_1rm) : null, loadSeries, recent };
    },
  });
}
