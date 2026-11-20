import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { useAuth } from '../auth';
import { withTimeout, NET_MS } from './withTimeout';
import {
  QHP_BOOKING_COLUMNS, QHP_CLIENT_CUTOFF, QHP_HAS_DATA_FILTER, QHP_REVIEW_CUTOFF, bucketTaskPending, idChunks, markValidityOverdue, qhpBookingCounts,
  qhpReschedulesOf, qhpReviewLists, taskPendingBookings, toQhpAssessments, type QhpAssessment, type QhpReschedule,
} from './qhpManagerRules';
import { QHP_NOT_SCHEDULED_ALERT_FROM, qhpNotScheduledSince, type PendingQhpBooking, type PendingQhpClient } from './qhpNotScheduled';
export type { QhpAssessment, QhpReschedule } from './qhpManagerRules';

/* ============ QHP Manager — live oversight (mirrors the web QHPManager page) ============
   Task Pending is CLIENT-centric (booked leads), exactly like the web:
     get_qhp_booked_client_ids → clients(active, created >= 2026-03-04) → coach_assessment
     drop clients whose QHP data is filled (completed); then bucket:
       hasQHP row      → Scheduled
       on hold (lead)  → On Hold
       else            → Not Scheduled
   SLA is recomputed from clients.created_at (3 working hours, 07:00–22:00 IST).
   Manager / Review / Reschedule / Requests come from coach_assessment / qhp_schedule. */

const fullName = (p: any) => `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || '—';

/* ---- SLA (3 working hours within 07:00–22:00 IST from created_at) ---- */
const IST_OFFSET = 5.5 * 3600 * 1000;
const WORK_START = 7, WORK_END = 22, SLA_MINUTES = 180;
export function computeQhpSlaDeadline(createdIso: string): Date {
  const MIN = 60000;
  let t = new Date(new Date(createdIso).getTime() + IST_OFFSET); // UTC getters now read IST wall clock
  let remaining = SLA_MINUTES;
  const h0 = t.getUTCHours() + t.getUTCMinutes() / 60;
  if (h0 < WORK_START) t.setUTCHours(WORK_START, 0, 0, 0);
  else if (h0 >= WORK_END) { t.setUTCDate(t.getUTCDate() + 1); t.setUTCHours(WORK_START, 0, 0, 0); }
  while (remaining > 0) {
    const eod = new Date(t); eod.setUTCHours(WORK_END, 0, 0, 0);
    const avail = (eod.getTime() - t.getTime()) / MIN;
    if (remaining <= avail) { t = new Date(t.getTime() + remaining * MIN); remaining = 0; }
    else { remaining -= avail; t.setUTCDate(t.getUTCDate() + 1); t.setUTCHours(WORK_START, 0, 0, 0); }
  }
  return new Date(t.getTime() - IST_OFFSET);
}
const durMins = (m: number) => (m <= 0 ? '0m' : m < 60 ? `${m}m` : Math.floor(m / 60) < 36 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`);
export type Sla = { text: string; level: 'red' | 'amber' | 'green'; overdue: boolean };
export function formatSlaRemaining(deadline: Date): Sla {
  const diff = Math.round((deadline.getTime() - Date.now()) / 60000);
  const f = (m: number) => (Math.floor(Math.abs(m) / 60) <= 0 ? `${Math.abs(m) % 60}m` : `${Math.floor(Math.abs(m) / 60)}h ${Math.abs(m) % 60}m`);
  if (diff < 0) return { text: `Overdue by ${f(diff)}`, level: 'red', overdue: true };
  if (diff <= 30) return { text: `${f(diff)} left`, level: 'amber', overdue: false };
  return { text: `${f(diff)} left`, level: 'green', overdue: false };
}
export const formatWaiting = (fromIso: string) => durMins(Math.max(0, Math.round((Date.now() - new Date(fromIso).getTime()) / 60000)));
export function waitUrgency(fromIso: string): { level: 'red' | 'amber' | 'green'; warning: string | null } {
  const h = (Date.now() - new Date(fromIso).getTime()) / 3600000;
  if (h <= 2) return { level: 'green', warning: null };
  if (h <= 4) return { level: 'amber', warning: '⏳ Approaching delay — please prioritize this task' };
  return { level: 'red', warning: '⚠️ Delayed — this is slowing down the onboarding process' };
}

/* ---- Types ---- */
export type OpsPrefs = {
  date: string | null; timeFrom: string | null; location: string | null; notes: string | null;
  /* Optional 2nd slot the Ops team captured (leads.qhp_pref_alt). Arrives from a
     SEPARATE additive RPC — the primary prefs RPC does not return it. */
  altDate?: string | null; altTime?: string | null;
};
export type PendingClient = {
  clientId: string;
  name: string;
  phone: string | null;
  joinedAt: string;              // clients.created_at
  hasQHP: boolean;               // a coach_assessment row exists (data not yet filled)
  assessmentId: string | null;
  assessmentDate: string | null; // YYYY-MM-DD
  assessmentTime: string | null;
  holdReason: string | null;
  holdOverdue: boolean;
  holdResolvingAt: string | null;
  opsPrefs: OpsPrefs | null;     // lead QHP preferences ("Notes from Ops")
  // WHO booked the QHP stage on the lead (ops attribution — leads.qhp_booked_by
  // via the get_lead_qhp_booked_by definer RPC; creator fallback for old leads).
  bookedByName: string | null;
  bookedByRole: string | null;
};
export type QhpRequest = { id: string; clientId: string | null; clientName: string; date: string | null; time: string | null; address: string | null; notes: string | null; scheduledByName: string | null };

export type QhpManagerData = {
  taskNotScheduled: PendingClient[];
  taskScheduled: PendingClient[];
  taskOnHold: PendingClient[];
  assessments: QhpAssessment[];          // Manager tab (all)
  reschedules: QhpReschedule[];
  requests: QhpRequest[];
  review: { pending: QhpAssessment[]; all: QhpAssessment[]; approvedCount: number; notApprovedCount: number };
  counts: { taskPending: number; notScheduled: number; scheduled: number; assessScheduled: number; holds: number; reschedules: number; requests: number; reviewPending: number; total: number; completed: number; overdue: number };
};

/* ---- the page's data, in four parts (20 Nov 2026; see lib/qhpManagerRules.ts for why) ---- */

/** One network call with the app's time limit. */
const net = <T,>(p: PromiseLike<T>, label: string): Promise<T> => withTimeout(Promise.resolve(p), NET_MS, label);
/** Every page of a list (1000 rows a page). */
const pageAll = async (build: (page: number) => PromiseLike<{ data: any; error: any }>, label: string, maxPages = 20): Promise<any[]> => {
  const out: any[] = [];
  for (let p = 0; p < maxPages; p++) {
    const { data, error } = await net(build(p), label);
    if (error) throw error;
    const chunk = (data ?? []) as any[];
    out.push(...chunk);
    if (chunk.length < 1000) break;
  }
  return out;
};
/** Profile names by id (a plain object: query data is cached, so never a Map). */
const profileNames = async (ids: string[]): Promise<Record<string, string>> => {
  const names: Record<string, string> = {};
  for (const part of idChunks(ids, 200)) {
    const { data, error } = await net(supabase.from('profiles').select('id, first_name, last_name').in('id', part), 'Names');
    if (error) throw error;
    (data ?? []).forEach((p: any) => { names[p.id] = fullName(p); });
  }
  return names;
};
/** Cache keys carry the signed-in person's id: the app keeps its query cache between sign-ins on one phone. */
const useUid = (): string => useAuth().session?.user?.id ?? 'anon';

/* 1. Task Pending: the first tab on screen. Small, and refreshed every 30 seconds. */
export type QhpTaskPendingData = { taskNotScheduled: PendingClient[]; taskScheduled: PendingClient[]; taskOnHold: PendingClient[]; taskPending: number };
export function useQhpTaskPending(enabled: boolean) {
  const uid = useUid();
  return useQuery({
    queryKey: ['qhp-manager', 'task', uid],
    enabled,
    staleTime: 30_000,
    refetchInterval: 30_000,
    queryFn: async (): Promise<QhpTaskPendingData> => {
      const empty: QhpTaskPendingData = { taskNotScheduled: [], taskScheduled: [], taskOnHold: [], taskPending: 0 };
      const { data: leadRows, error: leadErr } = await net(supabase.rpc('get_qhp_booked_client_ids'), 'QHP booked clients');
      if (leadErr) throw leadErr;
      const leadIds = [...new Set(((leadRows ?? []) as any[]).map((r) => (typeof r === 'string' ? r : r?.client_id)).filter(Boolean))] as string[];
      if (!leadIds.length) return empty;

      const cls: any[] = [];
      for (const part of idChunks(leadIds)) {
        const { data, error } = await net(
          supabase.from('clients').select('id, first_name, last_name, phone, status, created_at').in('id', part).or('status.eq.active,status.is.null').gte('created_at', QHP_CLIENT_CUTOFF),
          'QHP clients',
        );
        if (error) throw error;
        cls.push(...((data ?? []) as any[]));
      }
      cls.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      const cIds = cls.map((c) => c.id);
      if (!cIds.length) return empty;

      // The bookings of these clients WITHOUT the assessment blobs, and the ids of the bookings that have data.
      const bookings: any[] = [];
      const idsWithData: string[] = [];
      for (const part of idChunks(cIds)) {
        const [b, d] = await Promise.all([
          net(supabase.from('coach_assessment').select('id, client_id, assessment_date, assessment_time, cancelled').in('client_id', part), 'QHP bookings'),
          net(supabase.from('coach_assessment').select('id').in('client_id', part).or(QHP_HAS_DATA_FILTER), 'QHP bookings with data'),
        ]);
        if (b.error) throw b.error;
        if (d.error) throw d.error;
        bookings.push(...((b.data ?? []) as any[]));
        idsWithData.push(...((d.data ?? []) as any[]).map((r) => r.id));
      }
      const { bookingOf, doneClientIds } = taskPendingBookings(bookings, idsWithData);
      const done = new Set(doneClientIds);

      // holds (keep resolving_at: the card shows "Resolving by ...")
      const holdMap = new Map<string, { reason: string | null; overdue: boolean; resolvingAt: string | null }>();
      try {
        const { data: holds } = await net(supabase.rpc('get_qhp_holds'), 'QHP holds');
        ((holds ?? []) as any[]).forEach((h: any) => { if (h.client_id) holdMap.set(h.client_id, { reason: h.reason ?? null, overdue: h.is_overdue === true, resolvingAt: h.resolving_at ?? null }); });
      } catch { /* no holds */ }
      // Ops preferences (web "Notes from Ops" + scheduling-form prefill)
      const prefsMap = new Map<string, OpsPrefs>();
      try {
        const { data: prefs } = await net(supabase.rpc('get_lead_qhp_prefs_for_clients', { _client_ids: cIds }), 'QHP preferences');
        ((prefs ?? []) as any[]).forEach((row: any) => {
          if (!row?.client_id) return;
          prefsMap.set(row.client_id, {
            date: row.qhp_pref_date ?? null, timeFrom: row.qhp_pref_time_from ?? null,
            location: row.qhp_pref_location ?? null, notes: row.qhp_pref_notes ?? null,
          });
        });
      } catch { /* prefs RPC unavailable */ }
      /* 2nd preference: a separate additive RPC, in its own try/catch so a failure here can never hide the
         primary preferences above. */
      try {
        const { data: alts } = await net(supabase.rpc('get_lead_qhp_pref_alt_for_clients', { _client_ids: cIds }), 'QHP second preference');
        ((alts ?? []) as any[]).forEach((row: any) => {
          const alt = row?.qhp_pref_alt;
          if (!row?.client_id || !alt || typeof alt !== 'object' || !alt.date) return;
          const cur = prefsMap.get(row.client_id) ?? { date: null, timeFrom: null, location: null, notes: null };
          prefsMap.set(row.client_id, { ...cur, altDate: alt.date ?? null, altTime: alt.time ?? null });
        });
      } catch { /* alt RPC not deployed: cards just omit the 2nd slot */ }
      // Ops attribution: who booked the QHP stage on the lead.
      const bookedMap = new Map<string, { name: string | null; role: string | null }>();
      try {
        const { data: bb } = await net(supabase.rpc('get_lead_qhp_booked_by', { _client_ids: cIds }), 'QHP booked by');
        ((bb ?? []) as any[]).forEach((row: any) => {
          if (row?.client_id) bookedMap.set(row.client_id, { name: row.booked_by_name || null, role: row.booked_by_role ?? null });
        });
      } catch { /* RPC not deployed yet: cards just omit the line */ }

      const pending: PendingClient[] = cls
        .filter((c) => !done.has(c.id)) // drop completed QHPs
        .map((c) => {
          const rec = bookingOf[c.id];
          const hold = holdMap.get(c.id);
          return {
            clientId: c.id, name: fullName(c), phone: c.phone ?? null, joinedAt: c.created_at,
            hasQHP: !!rec, assessmentId: rec?.id ?? null, assessmentDate: rec?.date ?? null, assessmentTime: rec?.time ?? null,
            holdReason: hold?.reason ?? null, holdOverdue: hold?.overdue ?? false, holdResolvingAt: hold?.resolvingAt ?? null,
            opsPrefs: prefsMap.get(c.id) ?? null,
            bookedByName: bookedMap.get(c.id)?.name ?? null,
            bookedByRole: bookedMap.get(c.id)?.role ?? null,
          };
        });
      return { ...bucketTaskPending(pending, [...holdMap.keys()]), taskPending: pending.length };
    },
  });
}

/* 2. The inbox: reschedule requests, scheduling requests and the two numbers on the tab buttons. Small, refreshed
      every 30 seconds (the web polls the reschedule requests at 30 seconds). */
export type QhpInboxData = { reschedules: QhpReschedule[]; requests: QhpRequest[]; totalBookings: number | null; reviewPending: number | null };
export function useQhpManagerInbox(enabled: boolean) {
  const uid = useUid();
  return useQuery({
    queryKey: ['qhp-manager', 'inbox', uid],
    enabled,
    staleTime: 30_000,
    refetchInterval: 30_000,
    queryFn: async (): Promise<QhpInboxData> => {
      const { data: rr, error: rrErr } = await net(
        supabase.from('coach_assessment').select('id, client_name, coach_id, assessment_date, assessment_time, reschedule_status, reschedule_data').eq('reschedule_status', 'pending').limit(300),
        'QHP reschedule requests',
      );
      if (rrErr) throw rrErr;
      const resRows = (rr ?? []) as any[];
      const names = await profileNames([...new Set(resRows.map((r) => r.coach_id).filter(Boolean))] as string[]);
      const reschedules = qhpReschedulesOf(resRows, names);

      let requests: QhpRequest[] = [];
      const { data: qs, error: qsErr } = await net(
        supabase.from('qhp_schedule').select('id, client_id, scheduled_by, date, time, address, notes').eq('status', 'pending').order('date', { ascending: true }).limit(200),
        'QHP scheduling requests',
      );
      if (qsErr) throw qsErr;
      const reqRows = (qs ?? []) as any[];
      if (reqRows.length) {
        const cids = [...new Set(reqRows.map((r) => r.client_id).filter(Boolean))] as string[];
        const sids = [...new Set(reqRows.map((r) => r.scheduled_by).filter(Boolean))] as string[];
        const cn: Record<string, string> = {};
        for (const part of idChunks(cids, 200)) {
          const { data: cl } = await net(supabase.from('clients').select('id, first_name, last_name').in('id', part), 'QHP request clients');
          (cl ?? []).forEach((c: any) => { cn[c.id] = fullName(c); });
        }
        const sn = sids.length ? await profileNames(sids) : {};
        requests = reqRows.map((r) => ({ id: r.id, clientId: r.client_id ?? null, clientName: (r.client_id && cn[r.client_id]) || '—', date: r.date ?? null, time: r.time ?? null, address: r.address ?? null, notes: r.notes ?? null, scheduledByName: (r.scheduled_by && sn[r.scheduled_by]) || null }));
      }

      // The numbers on the Manager and QHP Review buttons, as counts only (the rows load when a tab is opened).
      let totalBookings: number | null = null;
      let reviewPending: number | null = null;
      try {
        const [t, v] = await Promise.all([
          net(supabase.from('coach_assessment').select('id', { count: 'exact', head: true }), 'QHP count'),
          net(supabase.from('coach_assessment').select('id', { count: 'exact', head: true }).gte('completed', new Date(QHP_REVIEW_CUTOFF).toISOString()).or('qhp_manager.is.null,qhp_manager.not.in.(approved,not_approved)'), 'QHP review count'),
        ]);
        if (!t.error) totalBookings = t.count ?? null;
        if (!v.error) reviewPending = v.count ?? null;
      } catch { /* the buttons then show no number until their tab is opened */ }
      return { reschedules, requests, totalBookings, reviewPending };
    },
  });
}

/* 3. Every booking, for the Manager list / calendar and QHP Review. Asked only when one of those tabs is open and
      NOT repeated on a timer (it is thousands of rows); any change made on this phone refreshes it. Short rows
      only, plus the ids of the bookings that have data. */
export type QhpAllBookingsData = { assessments: QhpAssessment[] };
export function useQhpAllBookings(enabled: boolean) {
  const uid = useUid();
  return useQuery({
    queryKey: ['qhp-manager', 'bookings', uid],
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<QhpAllBookingsData> => {
      const [rows, dataIdRows] = await Promise.all([
        pageAll((p) => supabase.from('coach_assessment').select(QHP_BOOKING_COLUMNS).order('assessment_date', { ascending: false, nullsFirst: false }).range(p * 1000, p * 1000 + 999), 'QHP bookings'),
        pageAll((p) => supabase.from('coach_assessment').select('id').or(QHP_HAS_DATA_FILTER).range(p * 1000, p * 1000 + 999), 'QHP bookings with data'),
      ]);
      const names = await profileNames([...new Set(rows.map((r: any) => r.coach_id).filter(Boolean))] as string[]);
      return { assessments: toQhpAssessments(rows, dataIdRows.map((r: any) => r.id), names) };
    },
  });
}

/* 4. Active clients who had a session in the last 45 days: only the "Overdue" tile and filter of the Manager tab
      use it, so it is asked only while that tab is open, and kept for five minutes. */
export function useQhpRecentActiveClients(enabled: boolean) {
  const uid = useUid();
  return useQuery({
    queryKey: ['qhp-manager', 'recent-clients', uid],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<string[]> => {
      const cutoff45 = new Date(Date.now() - 45 * 86_400_000).toISOString();
      const [activeRows, sessionRows] = await Promise.all([
        pageAll((p) => supabase.from('clients').select('id').or('status.eq.active,status.is.null').range(p * 1000, p * 1000 + 999), 'Active clients'),
        pageAll((p) => supabase.from('training_sessions').select('client_id').gte('scheduled_at', cutoff45).neq('status', 'cancelled').range(p * 1000, p * 1000 + 999), 'Recent sessions', 12),
      ]);
      const recent = new Set(sessionRows.map((r: any) => r.client_id).filter(Boolean));
      return activeRows.map((r: any) => r.id).filter((id: string) => recent.has(id));
    },
  });
}

/** The page's data put together, in the shape the screen has always read. Every part that has not arrived yet is
    empty, so the page is on screen at once and each tab shows its own loading line. */
export function useQhpManagerView(enabled: boolean, tab: string) {
  const taskQ = useQhpTaskPending(enabled);
  const inboxQ = useQhpManagerInbox(enabled);
  const allQ = useQhpAllBookings(enabled && (tab === 'manager' || tab === 'review'));
  const recentQ = useQhpRecentActiveClients(enabled && tab === 'manager');
  const d = React.useMemo((): QhpManagerData => {
    const task = taskQ.data;
    const inbox = inboxQ.data;
    const assessments = markValidityOverdue(allQ.data?.assessments ?? [], recentQ.data ?? null);
    const review = qhpReviewLists(assessments);
    const tiles = qhpBookingCounts(assessments);
    const reschedules = inbox?.reschedules ?? [];
    const requests = inbox?.requests ?? [];
    return {
      taskNotScheduled: task?.taskNotScheduled ?? [], taskScheduled: task?.taskScheduled ?? [], taskOnHold: task?.taskOnHold ?? [],
      assessments, reschedules, requests, review,
      counts: {
        taskPending: task?.taskPending ?? 0,
        notScheduled: task?.taskNotScheduled.length ?? 0,
        scheduled: task?.taskScheduled.length ?? 0,
        assessScheduled: tiles.assessScheduled,
        holds: task?.taskOnHold.length ?? 0,
        reschedules: reschedules.length,
        requests: requests.length,
        reviewPending: allQ.data ? review.pending.length : inbox?.reviewPending ?? 0,
        total: allQ.data ? tiles.total : inbox?.totalBookings ?? 0,
        completed: tiles.completed,
        overdue: tiles.overdue,
      },
    };
  }, [taskQ.data, inboxQ.data, allQ.data, recentQ.data]);
  return { d, taskQ, inboxQ, allQ, recentQ };
}

/* Quick-add HeartMath to a completed QHP (web AddHeartMathDialog): find the FIRST data
   column that already holds a "Standardized Assessment" object, deep-clone it, set
   heartMathReport = { MHRR, SDNN, RMSSD, normalizedCoherence }, update only that column. */
export function useAddHeartMath() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { assessmentId: string; MHRR: string; SDNN: string; RMSSD: string; normalizedCoherence: string }) => {
      const { data: row, error } = await supabase
        .from('coach_assessment')
        .select('id, new_client_assessment_data, existing_client_assessment_data, qhp_data')
        .eq('id', input.assessmentId).single();
      if (error) throw new Error(error.message);
      const cols = ['new_client_assessment_data', 'existing_client_assessment_data', 'qhp_data'] as const;
      const col = cols.find((c) => (row as any)[c] && typeof (row as any)[c] === 'object' && (row as any)[c]['Standardized Assessment']);
      if (!col) throw new Error('No Standardized Assessment data found on this QHP');
      const clone = JSON.parse(JSON.stringify((row as any)[col]));
      clone['Standardized Assessment'].heartMathReport = {
        MHRR: input.MHRR.trim(), SDNN: input.SDNN.trim(), RMSSD: input.RMSSD.trim(), normalizedCoherence: input.normalizedCoherence.trim(),
      };
      const { error: uErr } = await supabase.from('coach_assessment').update({ [col]: clone } as any).eq('id', input.assessmentId);
      if (uErr) throw new Error(uErr.message);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['qhp-manager'] }); qc.invalidateQueries({ queryKey: ['qhp-assessments'] }); },
  });
}

/* Delete a QHP from the Manager calendar (web QHPCalendar onDeleteQHP → delete coach_assessment). */
export function useDeleteQhp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('coach_assessment').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['qhp-manager'] }); qc.invalidateQueries({ queryKey: ['qhp-assessments'] }); },
  });
}

/* Reschedule review — approve/reject; DB trigger applies proposed_* to the assessment on approve. */
export function useResolveQhpReschedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; approve: boolean }) => {
      const { error } = await supabase.from('coach_assessment').update({ reschedule_status: input.approve ? 'approved' : 'rejected', updated_at: new Date().toISOString() }).eq('id', input.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['qhp-manager'] }),
  });
}

/* QHP Manager sign-off on a completed assessment (coach_assessment.qhp_manager). */
export function useSetQhpManagerReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; approve: boolean }) => {
      const { error } = await supabase.from('coach_assessment').update({ qhp_manager: input.approve ? 'approved' : 'not_approved', updated_at: new Date().toISOString() }).eq('id', input.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['qhp-manager'] }),
  });
}

/* Manager reschedule of a scheduled QHP — web ManagerRescheduleQHPDialog contract:
   reason required (≥10 chars), merges reschedule_data.manager_reschedule history,
   updates assessment_date/time, then fire-and-forget notify-qhp-reschedule. */
export function useRescheduleQhpAssessment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; date: string; time: string; reason: string; managerId: string; clientName?: string; currentDate?: string | null; currentTime?: string | null }) => {
      if (input.reason.trim().length < 10) throw new Error('Reason must be at least 10 characters');
      const { data: existing, error: fetchErr } = await supabase
        .from('coach_assessment')
        .select('reschedule_data')
        .eq('id', input.id)
        .maybeSingle();
      if (fetchErr) throw new Error(fetchErr.message);
      const prevData: any = (existing as any)?.reschedule_data || {};
      const merged = {
        ...prevData,
        manager_reschedule: {
          previous_date: input.currentDate ?? null,
          previous_time: input.currentTime ?? null,
          new_date: input.date,
          new_time: input.time,
          reason: input.reason.trim(),
          rescheduled_by: input.managerId,
          rescheduled_at: new Date().toISOString(),
          seen_by_assessor: false,
        },
      };
      const { error } = await supabase
        .from('coach_assessment')
        .update({ assessment_date: input.date, assessment_time: input.time, reschedule_data: merged })
        .eq('id', input.id);
      if (error) throw new Error(error.message);
      // Fire-and-forget assessor notification (matches web).
      supabase.functions
        .invoke('notify-qhp-reschedule', { body: { kind: 'manager_reschedule', assessment_id: input.id, client_name: input.clientName ?? '' } })
        .catch(() => {});
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['qhp-manager'] }); qc.invalidateQueries({ queryKey: ['qhp-assessments'] }); },
  });
}

/* Approve a qhp_schedule request — web QHPRequestsSection contract:
   insert coach_assessment (approver = scheduled_by, chosen assessor = coach_id),
   then mark the request approved. */
export function useApproveQhpRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { request: QhpRequest; assessorId: string; approverId: string }) => {
      const { request } = input;
      const { error: insErr } = await supabase
        .from('coach_assessment')
        .insert({
          client_id: request.clientId,
          client_name: request.clientName || 'Unknown Client',
          assessment_date: request.date,
          assessment_time: request.time,
          location: request.address,
          notes: request.notes ?? null,
          assessment_scheduled: true,
          scheduled_by: input.approverId,
          coach_id: input.assessorId,
        })
        .select()
        .single();
      if (insErr) throw new Error(insErr.message);
      const { error: updErr } = await supabase.from('qhp_schedule').update({ status: 'approved' }).eq('id', request.id);
      if (updErr) throw new Error(updErr.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['qhp-manager'] }),
  });
}

/* Put a client's QHP on hold (leads.qhp_hold via RPC). */
export function useHoldQhp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { clientId: string; reason: string; resolvingAt: string }) => {
      const { error } = await supabase.rpc('set_lead_qhp_hold', { _client_id: input.clientId, _reason: input.reason.trim(), _resolving_at: input.resolvingAt });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['qhp-manager'] }),
  });
}

/* ============ QHP review detail — heavy fields fetched on demand (web QHPReviewTab dialog) ============ */
export type QhpReviewDetail = {
  id: string; clientName: string; assessorName: string;
  completed: string | null; assessmentDate: string | null; mechanicalScore: number | null;
  managerReview: 'approved' | 'not_approved' | null;
  qhpData: any; newClientData: any; existingClientData: any; aiBiomechanical: any;
};
export function useQhpReviewDetail(assessmentId: string | null) {
  return useQuery({
    queryKey: ['qhp-review-detail', assessmentId],
    enabled: !!assessmentId,
    staleTime: 120_000,
    queryFn: async (): Promise<QhpReviewDetail> => {
      const { data, error } = await supabase
        .from('coach_assessment')
        .select('id, client_name, completed, assessment_date, mechanical_score, qhp_manager, qhp_data, new_client_assessment_data, existing_client_assessment_data, ai_biomechanical, assessor:coach_id(first_name, last_name)')
        .eq('id', assessmentId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      const r: any = data;
      if (!r) throw new Error('Assessment not found');
      return {
        id: r.id,
        clientName: r.client_name ?? 'Client',
        assessorName: fullName(r.assessor),
        completed: r.completed ?? null,
        assessmentDate: r.assessment_date ?? null,
        mechanicalScore: r.mechanical_score ?? null,
        managerReview: r.qhp_manager ?? null,
        qhpData: r.qhp_data ?? null,
        newClientData: r.new_client_assessment_data ?? null,
        existingClientData: r.existing_client_assessment_data ?? null,
        aiBiomechanical: r.ai_biomechanical ?? null,
      };
    },
  });
}

/* ============ Edit a qhp_schedule request (web QHPRequestsSection edit contract) ============ */
export function useEditQhpRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; date: string; time: string; address: string; notes: string | null }) => {
      const { error } = await supabase
        .from('qhp_schedule')
        .update({ date: input.date, time: input.time, address: input.address, notes: input.notes, updated_at: new Date().toISOString() })
        .eq('id', input.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['qhp-manager'] }),
  });
}

/* ============ B2C login credentials (web CopyCredentialsButton + generateClientCredentials) ============
   Email: profiles.email via clients.profile_id, else clients.email; if the
   resolved email ends with @oddsapp.com (or none resolved → web aborts with an
   error), the DISPLAYED email is regenerated as first.last@oddsapp.com.
   Password: FirstName (capitalized) + '@' + first 4 chars of the client id.
   Read-only — no writes anywhere. */
export function useClientCredentials(client: { clientId: string; name: string } | null) {
  return useQuery({
    queryKey: ['client-credentials', client?.clientId ?? null],
    enabled: !!client,
    staleTime: 600_000,
    retry: false,
    queryFn: async (): Promise<{ email: string; password: string }> => {
      const { clientId, name } = client!;
      const { data: c } = await supabase.from('clients').select('profile_id, email, first_name, last_name').eq('id', clientId).maybeSingle();
      let authEmail: string | null = null;
      if (c?.profile_id) {
        const { data: p } = await supabase.from('profiles').select('email').eq('id', c.profile_id).maybeSingle();
        authEmail = p?.email ?? null;
      }
      const resolved = authEmail || c?.email || '';
      if (!resolved) throw new Error('No login email found for this client');
      const first = (c?.first_name || name.split(/\s+/)[0] || '').trim();
      const last = (c?.last_name || name.split(/\s+/).slice(1).join(' ') || '').trim();
      const generated = `${(first + (last ? '.' + last : '')).toLowerCase().replace(/\s+/g, '')}@oddsapp.com`;
      const email = resolved.toLowerCase().endsWith('@oddsapp.com') ? generated : resolved;
      const password = `${first.charAt(0).toUpperCase()}${first.slice(1)}@${clientId.substring(0, 4)}`;
      return { email, password };
    },
  });
}

/* ============ QHP Stats (web useQHPStats — IST week/month window) ============ */
export type QhpStatsPeriod = 'week' | 'month';
export type QhpStatsPlanned = { id: string; clientName: string; bookedByName: string; date: string; time: string | null };
export type QhpStatsPending = { id: string; clientName: string; assessorId: string | null; assessorName: string; assessmentDate: string | null };
export type QhpStatsCompleted = { id: string; clientName: string; assessorId: string | null; assessorName: string; completed: string };
export type QhpStatsAssessor = { assessorId: string; assessorName: string; pending: number; completed: number; pendingRows: QhpStatsPending[]; completedRows: QhpStatsCompleted[] };
export type QhpStats = {
  rangeStart: string; rangeEnd: string;
  planned: number; pending: number; completed: number;
  plannedRows: QhpStatsPlanned[]; pendingRows: QhpStatsPending[]; completedRows: QhpStatsCompleted[];
  byAssessor: QhpStatsAssessor[];
};
const istYmd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
export function useQhpStats(period: QhpStatsPeriod, enabled: boolean) {
  return useQuery({
    queryKey: ['qhp-stats', period],
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<QhpStats> => {
      // Range in IST — week starts Monday (web weekStartsOn: 1) / calendar month.
      // Hermes can't parse `new Date(toLocaleString(...))`, so derive the IST
      // calendar date via Intl (YYYY-MM-DD) and do all math in UTC fields.
      const [ty, tm, td] = istYmd(new Date()).split('-').map(Number);
      const anchor = new Date(Date.UTC(ty, tm - 1, td, 12)); // noon UTC — DST-proof day anchor
      let start: Date, end: Date;
      if (period === 'week') {
        const dow = (anchor.getUTCDay() + 6) % 7; // Mon=0
        start = new Date(Date.UTC(ty, tm - 1, td - dow, 12));
        end = new Date(Date.UTC(ty, tm - 1, td - dow + 6, 12));
      } else {
        start = new Date(Date.UTC(ty, tm - 1, 1, 12));
        end = new Date(Date.UTC(ty, tm, 0, 12));
      }
      const p2 = (n: number) => String(n).padStart(2, '0');
      const ymd = (d: Date) => `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
      const startStr = ymd(start), endStr = ymd(end);
      const startIso = `${startStr}T00:00:00+05:30`, endIso = `${endStr}T23:59:59+05:30`;

      const [schedRes, assessRes] = await Promise.all([
        supabase
          .from('qhp_schedule')
          .select('id, client_id, scheduled_by, date, time, status, clients:client_id(first_name, last_name), profiles:scheduled_by(first_name, last_name)')
          .gte('date', startStr).lte('date', endStr)
          .order('date', { ascending: true }),
        supabase
          .from('coach_assessment')
          .select('id, client_id, coach_id, completed, created_at, assessment_date, clients:client_id(first_name, last_name), profiles:coach_id(first_name, last_name)')
          .or(`and(created_at.gte.${startIso},created_at.lte.${endIso}),and(completed.gte.${startIso},completed.lte.${endIso})`),
      ]);
      if (schedRes.error) throw new Error(schedRes.error.message);
      if (assessRes.error) throw new Error(assessRes.error.message);
      const schedule = (schedRes.data ?? []) as any[];
      const assessments = (assessRes.data ?? []) as any[];

      const assignedClientIds = new Set<string>();
      for (const a of assessments) if (a.client_id && a.coach_id) assignedClientIds.add(a.client_id);

      const plannedRows: QhpStatsPlanned[] = schedule
        .filter((s) => !s.client_id || !assignedClientIds.has(s.client_id))
        .map((s) => ({ id: s.id, clientName: fullName(s.clients) === '—' ? 'Unknown' : fullName(s.clients), bookedByName: fullName(s.profiles) === '—' ? 'Unknown' : fullName(s.profiles), date: s.date, time: s.time ?? null }));

      const pendingRows: QhpStatsPending[] = assessments
        .filter((a) => a.coach_id && !a.completed)
        .map((a) => ({ id: a.id, clientName: a.clients ? fullName(a.clients) : 'Unassigned client', assessorId: a.coach_id ?? null, assessorName: fullName(a.profiles) === '—' ? 'Unknown' : fullName(a.profiles), assessmentDate: a.assessment_date ?? null }));

      const completedRows: QhpStatsCompleted[] = assessments
        .filter((a) => !!a.completed)
        .map((a) => ({ id: a.id, clientName: a.clients ? fullName(a.clients) : 'Unassigned client', assessorId: a.coach_id ?? null, assessorName: fullName(a.profiles) === '—' ? 'Unknown' : fullName(a.profiles), completed: a.completed }))
        .sort((x, y) => (x.completed < y.completed ? 1 : -1));

      const byMap = new Map<string, QhpStatsAssessor>();
      const ensure = (id: string | null, name: string) => {
        const key = id ?? `__${name}`;
        if (!byMap.has(key)) byMap.set(key, { assessorId: key, assessorName: name, pending: 0, completed: 0, pendingRows: [], completedRows: [] });
        return byMap.get(key)!;
      };
      for (const r of pendingRows) { const e = ensure(r.assessorId, r.assessorName); e.pending += 1; e.pendingRows.push(r); }
      for (const r of completedRows) { const e = ensure(r.assessorId, r.assessorName); e.completed += 1; e.completedRows.push(r); }
      const byAssessor = [...byMap.values()].sort((a, b) => b.completed - a.completed || b.pending - a.pending || a.assessorName.localeCompare(b.assessorName));

      return { rangeStart: startStr, rangeEnd: endStr, planned: plannedRows.length, pending: pendingRows.length, completed: completedRows.length, plannedRows, pendingRows, completedRows, byAssessor };
    },
  });
}

/* ============ QHPs (home card) — assigned, SUBSCRIBED clients only ============
   • completed → QHPs completed THIS IST month (has data: file or any assessment JSON)
   • pending   → scheduled THIS month, no data yet ("scheduled but not completed")
   • overdue   → ACTIVE clients (≥1 logged session in last 30d) whose latest
                 completed QHP is >45 days old — i.e. the refresh never happened.
   Data-presence is checked at the DB level (column non-null) so the heavy JSON never
   downloads; rows with a non-null-but-empty {} are rare and count as completed. */
export type QhpTotalsRow = { id: string; clientName: string; subscription: string | null; assessorName: string; date: string | null };
export type QhpTotals = {
  pending: number; completed: number; overdue: number;
  pendingRows: QhpTotalsRow[]; completedRows: QhpTotalsRow[]; overdueRows: QhpTotalsRow[];
};
export function useQhpTotals(enabled: boolean) {
  const { session } = useAuth();
  return useQuery({
    queryKey: ['qhp-totals', session?.user?.id ?? 'anon'],
    enabled,
    staleTime: 120_000,
    queryFn: async (): Promise<QhpTotals> => {
      const LIGHT = 'id, client_id, coach_id, completed, assessment_date, clients:client_id!inner(first_name, last_name, subscription_type), profiles:coach_id(first_name, last_name)';
      const pageAll = async (build: (q: any) => any) => {
        const out: any[] = [];
        for (let fromIdx = 0; ; fromIdx += 1000) {
          let q = supabase
            .from('coach_assessment')
            .select(LIGHT)
            .not('coach_id', 'is', null)
            .not('clients.subscription_type', 'is', null)
            .order('assessment_date', { ascending: false })
            .range(fromIdx, fromIdx + 999);
          q = build(q);
          const { data, error } = await q;
          if (error) throw new Error(error.message);
          const rows = (data ?? []) as any[];
          out.push(...rows);
          if (rows.length < 1000) break;
        }
        return out;
      };
      const [withData, withoutData] = await Promise.all([
        pageAll((q) => q.or('assessment_file_url.not.is.null,new_client_assessment_data.not.is.null,existing_client_assessment_data.not.is.null,qhp_data.not.is.null')),
        pageAll((q) => q.is('assessment_file_url', null).is('new_client_assessment_data', null).is('existing_client_assessment_data', null).is('qhp_data', null)),
      ]);
      const mk = (a: any): QhpTotalsRow => ({
        id: a.id,
        clientName: fullName(a.clients) === '—' ? 'Unknown' : fullName(a.clients),
        subscription: a.clients?.subscription_type ?? null,
        assessorName: fullName(a.profiles) === '—' ? 'Unassigned' : fullName(a.profiles),
        date: a.completed ?? a.assessment_date ?? null,
      });

      // Current IST month key, e.g. "2026-07".
      const istYm = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).format(d);
      const thisMonth = istYm(new Date());
      const inThisMonth = (iso: string | null) => !!iso && istYm(new Date(iso)) === thisMonth;

      // 1. Completed THIS MONTH — has data, effective date in the current IST month.
      const completedRows = withData
        .filter((a) => inThisMonth(a.completed ?? a.assessment_date))
        .map(mk)
        .sort((x, y) => (y.date ?? '').localeCompare(x.date ?? ''));

      // 2. Scheduled THIS MONTH but not completed — no data yet, scheduled date in month.
      const pendingRows = withoutData
        .filter((a) => inThisMonth(a.assessment_date ?? a.completed))
        .map(mk)
        .sort((x, y) => (x.date ?? '').localeCompare(y.date ?? ''));

      // 3. Overdue — ACTIVE clients (≥1 logged session in the last 30 days) whose
      //    LATEST completed QHP is older than 45 days (no refresh since).
      const activeIds = new Set<string>();
      {
        const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
        for (let fromIdx = 0; ; fromIdx += 1000) {
          const { data, error } = await supabase
            .from('training_sessions')
            .select('client_id')
            .gte('scheduled_at', since)
            .not('workout_session_id', 'is', null)
            .neq('status', 'cancelled')
            .range(fromIdx, fromIdx + 999);
          if (error) throw new Error(error.message);
          (data ?? []).forEach((r: any) => { if (r.client_id) activeIds.add(r.client_id); });
          if ((data ?? []).length < 1000) break;
        }
      }
      // Latest completed QHP per client (withData is ordered newest-first already).
      const latestByClient = new Map<string, any>();
      for (const a of withData) {
        const cid = a.client_id;
        if (!cid || latestByClient.has(cid)) continue;
        latestByClient.set(cid, a);
      }
      const now = Date.now();
      const overdueRows: QhpTotalsRow[] = [];
      for (const [cid, a] of latestByClient) {
        if (!activeIds.has(cid)) continue; // only currently-active clients
        const last = a.completed ?? a.assessment_date;
        if (!last) continue;
        const daysAgo = (now - new Date(last).getTime()) / 86_400_000;
        if (daysAgo > 45) overdueRows.push(mk(a));
      }
      overdueRows.sort((x, y) => (x.date ?? '').localeCompare(y.date ?? '')); // oldest QHP first

      return {
        pending: pendingRows.length, completed: completedRows.length, overdue: overdueRows.length,
        pendingRows, completedRows, overdueRows,
      };
    },
  });
}

/* ============ Dashboard alerts (web OnboardingAlertBanner + TrainerQHPInProgressAlert) ============ */

/* QHP manager: QHPs that are not scheduled yet (20 Nov 2026, owner: "any QHP which is not scheduled yet, from
   today 7 am, show its notification alert"). The same rule and the same four requests as the web card
   (hub-track src/components/notifications/QHPNotScheduledAlert.tsx; the rule itself is lib/qhpNotScheduled.ts, the
   web file byte for byte): the lead is in "QHP Booked" (get_qhp_booked_client_ids, because a QHP manager cannot
   read leads directly), the client is active, the card was created from QHP_NOT_SCHEDULED_ALERT_FROM, there is no
   booking (a cancelled one does not count) and the QHP is not on hold. Only two small columns of the bookings are
   read: the assessment data is never downloaded.
   It replaces useQhpAssignAssessorAlert, whose rule was older and different (start 4 Mar 2026, a cancelled booking
   still counted, holds were not left out, the three assessment blobs were downloaded just to test for data). */
export function useQhpNotScheduledAlert(enabled: boolean) {
  // The key MUST carry the signed-in person's id: the persisted cache otherwise hydrates one QHP manager's alert
  // for every account that later signs in on the same phone (a disabled query still returns cached data).
  const uid = useUid();
  return useQuery({
    queryKey: ['qhp-not-scheduled-alert', uid, QHP_NOT_SCHEDULED_ALERT_FROM],
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnMount: 'always',
    queryFn: async (): Promise<PendingQhpClient[]> => {
      const { data: leadRows, error: leadErr } = await net(supabase.rpc('get_qhp_booked_client_ids'), 'QHP booked clients');
      if (leadErr) throw leadErr;
      const leadIds = [...new Set(((leadRows ?? []) as any[]).map((r) => (typeof r === 'string' ? r : r?.client_id)).filter(Boolean))] as string[];
      if (!leadIds.length) return [];

      const clients: PendingQhpClient[] = [];
      for (const part of idChunks(leadIds)) {
        const { data, error } = await net(
          supabase.from('clients').select('id, first_name, last_name, created_at').in('id', part).or('status.eq.active,status.is.null').gte('created_at', new Date(QHP_NOT_SCHEDULED_ALERT_FROM).toISOString()),
          'QHP clients',
        );
        if (error) throw error;
        clients.push(...((data ?? []) as PendingQhpClient[]));
      }
      if (!clients.length) return [];

      const bookings: PendingQhpBooking[] = [];
      for (const part of idChunks(clients.map((c) => c.id))) {
        const { data, error } = await net(supabase.from('coach_assessment').select('client_id, cancelled').in('client_id', part), 'QHP bookings');
        if (error) throw error;
        bookings.push(...((data ?? []) as PendingQhpBooking[]));
      }

      const { data: holds, error: holdErr } = await net(supabase.rpc('get_qhp_holds'), 'QHP holds');
      if (holdErr) throw holdErr;

      return qhpNotScheduledSince(clients, bookings, ((holds ?? []) as any[]).map((h) => h?.client_id));
    },
  });
}

/* Assessor: my scheduled QHPs with no data captured yet ("Your N new clients QHP is due"). */
export function useAssessorPendingCount(assessorId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['assessor-pending-qhp-count', assessorId],
    enabled: enabled && !!assessorId,
    staleTime: 60_000,
    queryFn: async (): Promise<number> => {
      const { count } = await supabase
        .from('coach_assessment')
        .select('id', { count: 'exact', head: true })
        .eq('coach_id', assessorId)
        .eq('assessment_scheduled', true)
        .is('new_client_assessment_data', null)
        .is('existing_client_assessment_data', null)
        .is('qhp_data', null);
      return count ?? 0;
    },
  });
}

/* Any trainer: my clients with a QHP in progress (assessor assigned, not completed). */
export type QhpInProgressClient = { clientId: string; clientName: string; assessorName: string; assessmentDate: string | null };
export function useQhpInProgress(trainerId: string) {
  return useQuery({
    queryKey: ['qhp-in-progress', trainerId],
    enabled: !!trainerId,
    staleTime: 60_000,
    refetchInterval: 60_000,
    queryFn: async (): Promise<QhpInProgressClient[]> => {
      const { data: assignments } = await supabase
        .from('trainer_clients')
        .select('client_id')
        .eq('trainer_id', trainerId)
        .eq('actively_training', true);
      const ids = [...new Set((assignments ?? []).map((a: any) => a.client_id).filter(Boolean))];
      if (!ids.length) return [];
      const { data: assessments } = await supabase
        .from('coach_assessment')
        .select('client_id, coach_id, completed, assessment_date, clients:client_id(first_name, last_name), profiles:coach_id(first_name, last_name)')
        .in('client_id', ids)
        .not('coach_id', 'is', null)
        .is('completed', null)
        .order('assessment_date', { ascending: false });
      const seen = new Set<string>();
      const out: QhpInProgressClient[] = [];
      for (const a of (assessments ?? []) as any[]) {
        if (!a.client_id || seen.has(a.client_id)) continue;
        seen.add(a.client_id);
        out.push({
          clientId: a.client_id,
          clientName: fullName(a.clients) === '—' ? 'Client' : fullName(a.clients),
          assessorName: fullName(a.profiles) === '—' ? 'Assessor' : fullName(a.profiles),
          assessmentDate: a.assessment_date ?? null,
        });
      }
      return out;
    },
  });
}

/* ============ Tracker tab (web QHPTrackerTab / useQHPTrackerData) ============
   Per-client QHP compliance: last workout, last done QHP, next due (+45d), status. */
const QHP_VALIDITY_DAYS = 45;
const QHP_WARNING_DAYS = 7;
export type TrackerRow = {
  clientId: string; name: string; subscription: string | null;
  trainers: string[]; crm: string | null;
  lastWorkout: string | null; lastQhp: string | null; qhpBy: string | null;
  nextDue: string | null; daysUntilDue: number | null;
  status: 'not-done' | 'overdue' | 'due-soon' | 'completed';
  isRehabOnly: boolean;
};
const nonEmptyObj = (v: any) => v && typeof v === 'object' && Object.keys(v).length > 0;
// Session types that are pure rehab/recovery — a client whose last-45-day
// sessions are ALL of these (and has a QHP) is forced On Track (web parity).
const REHAB_SESSION_TYPES = new Set(['rehabilitation', 'recovery', 'physiotherapy', 'red_light_therapy', 'mayo_facial_release', 'neural_check']);
const trkChunk = <T,>(a: T[], n = 200): T[][] => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
export function useQhpTracker(enabled: boolean, workoutFilter: boolean) {
  return useQuery({
    queryKey: ['qhp-tracker', workoutFilter],
    enabled,
    staleTime: 300_000,
    queryFn: async (): Promise<TrackerRow[]> => {
      // 1. Eligible clients: status 'active'/'Active' ONLY (null/inactive/
      //    discontinued/merged/paused dropped), enrolled, not Staff/Trial.
      const { data: cls, error } = await supabase
        .from('clients')
        .select('id, first_name, last_name, status, coach_id, subscription_type')
        .or('status.eq.active,status.eq.Active')
        .not('subscription_type', 'is', null)
        .neq('subscription_type', 'Staff')
        .neq('subscription_type', 'Trial')
        .order('first_name', { ascending: true });
      if (error) throw new Error(error.message);
      let clients = (cls ?? []) as any[];
      if (!clients.length) return [];

      // 1b. Drop clients currently paused: an active client_pause_history row
      //     whose [pause_start, pause_end] window (null end = open-ended)
      //     contains today (IST). Chunked by 200 (web parity).
      const todayIst = istYmd(new Date());
      const pausedIds = new Set<string>();
      for (const part of trkChunk(clients.map((c) => c.id))) {
        const { data: pauses } = await supabase
          .from('client_pause_history')
          .select('client_id, pause_start, pause_end')
          .eq('is_active', true)
          .in('client_id', part);
        (pauses ?? []).forEach((p: any) => {
          // Web parity: null start = open-ended (already started), null end = ongoing.
          const started = p.pause_start == null || p.pause_start <= todayIst;
          const notEnded = p.pause_end == null || p.pause_end >= todayIst;
          if (started && notEnded) pausedIds.add(p.client_id);
        });
      }
      if (pausedIds.size) clients = clients.filter((c) => !pausedIds.has(c.id));
      if (!clients.length) return [];

      // 2. ALL completed sessions (web fetchAllRows) — three uses: last-workout
      //    date, the 45d filter, and rehab-only detection. The 45d cutoff is a
      //    DATE-ONLY string, compared lexically against the scheduled_at string
      //    (exactly what the web does — a timestamp string is >= 'YYYY-MM-DD'
      //    when its date is on/after the cutoff).
      const cutoffStr = new Date(Date.now() - QHP_VALIDITY_DAYS * 864e5).toISOString().split('T')[0];
      const lastWorkout = new Map<string, string>();
      const recentTypes = new Map<string, string[]>(); // client -> session_types within last 45d
      for (let page = 0; page < 40; page++) {
        const { data: sess } = await supabase
          .from('training_sessions')
          .select('client_id, scheduled_at, session_type')
          .eq('status', 'completed')
          .not('client_id', 'is', null)
          .order('scheduled_at', { ascending: false })
          .range(page * 1000, page * 1000 + 999);
        (sess ?? []).forEach((s: any) => {
          if (!s.client_id) return;
          if (!lastWorkout.has(s.client_id)) lastWorkout.set(s.client_id, s.scheduled_at);
          if (s.scheduled_at && String(s.scheduled_at) >= cutoffStr) {
            const arr = recentTypes.get(s.client_id) ?? [];
            arr.push(String(s.session_type ?? '').toLowerCase());
            recentTypes.set(s.client_id, arr);
          }
        });
        if (!sess || sess.length < 1000) break;
      }
      // Workout filter: keep clients whose LATEST completed session is within
      // the last 45 days (date-only string compare — web parity).
      const eligible = workoutFilter
        ? clients.filter((c) => { const d = lastWorkout.get(c.id); return !!d && String(d) >= cutoffStr; })
        : clients;
      if (!eligible.length) return [];
      const eligibleIds = eligible.map((c) => c.id);

      // Rehab-only: every last-45-day session is a rehab type, and there is
      // at least one (web parity — baseline QHP still compulsory).
      const rehabOnly = new Map<string, boolean>();
      recentTypes.forEach((types, cid) => {
        rehabOnly.set(cid, types.length > 0 && types.every((t) => REHAB_SESSION_TYPES.has(t)));
      });

      // 3+4. Names/roles + assignments + assessments.
      const [profsR, tcR, assessR] = await Promise.all([
        supabase.from('profiles').select('id, first_name, last_name, role').limit(3000),
        supabase.from('trainer_clients').select('client_id, trainer_id, actively_training').in('client_id', eligibleIds).eq('actively_training', true),
        supabase.from('coach_assessment')
          .select('id, client_id, assessment_date, completed, assessment_file_url, new_client_assessment_data, existing_client_assessment_data, qhp_data, coach_id')
          .not('client_id', 'is', null)
          .in('client_id', eligibleIds)
          .order('assessment_date', { ascending: false }),
      ]);
      const pName = new Map<string, { name: string; role: string | null }>();
      ((profsR.data ?? []) as any[]).forEach((p) => pName.set(p.id, { name: `${p.first_name ?? ''} ${p.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || 'Unknown', role: p.role ?? null }));
      const trainersOf = new Map<string, string[]>();
      const crmOf = new Map<string, string>();
      ((tcR.data ?? []) as any[]).forEach((r) => {
        const p = pName.get(r.trainer_id);
        if (!p) return;
        if (p.role === 'trainer') { const arr = trainersOf.get(r.client_id) ?? []; arr.push(p.name); trainersOf.set(r.client_id, arr); }
        else if (p.role === 'crm' && !crmOf.has(r.client_id)) crmOf.set(r.client_id, p.name);
      });
      // Latest DONE assessment per client, keyed by effective date
      // (completed ?? assessment_date). The 45-day validity clock now starts at
      // the completion timestamp, not the scheduled assessment_date — matching
      // the QHP home card (useQhpTotals) and the Manager validity check. When a
      // done QHP has no completed timestamp we fall back to assessment_date.
      const qhpRef = (a: any) => a?.completed ?? a?.assessment_date ?? null;
      const lastQhp = new Map<string, any>();
      ((assessR.data ?? []) as any[]).forEach((a) => {
        const done = !!a.assessment_file_url || nonEmptyObj(a.qhp_data) || nonEmptyObj(a.new_client_assessment_data) || nonEmptyObj(a.existing_client_assessment_data);
        if (!done) return;
        const ref = qhpRef(a);
        if (!ref) return;
        const prev = lastQhp.get(a.client_id);
        const prevRef = prev ? qhpRef(prev) : null;
        if (!prev || (prevRef && new Date(ref).getTime() > new Date(prevRef).getTime())) lastQhp.set(a.client_id, a);
      });

      // Web computes daysUntilDue = differenceInDays(nextDue, new Date()) — i.e.
      // against NOW (with the current time), truncated toward zero. Using
      // midnight-today here made every future due-date off by one, shifting
      // clients across the due-soon / on-track / overdue boundaries.
      const now = new Date();
      const rows: TrackerRow[] = eligible.map((c) => {
        const q = lastQhp.get(c.id);
        const isRehabOnly = rehabOnly.get(c.id) ?? false;
        let nextDue: string | null = null, days: number | null = null;
        let status: TrackerRow['status'] = 'not-done';
        const refIso = q ? qhpRef(q) : null;
        if (refIso) {
          // completed is a full timestamp; assessment_date is date-only (parse at
          // local midnight so a date string is not read as the previous UTC day).
          const due = String(refIso).length <= 10 ? new Date(refIso + 'T00:00:00') : new Date(refIso);
          due.setDate(due.getDate() + QHP_VALIDITY_DAYS);
          nextDue = due.toISOString();
          const raw = (due.getTime() - now.getTime()) / 864e5;
          days = raw >= 0 ? Math.floor(raw) : Math.ceil(raw); // truncate toward zero (date-fns differenceInDays)
          // Rehab-only clients WITH a QHP are never Overdue/Due Soon — the
          // dates still show, but they are forced On Track (web parity).
          status = isRehabOnly ? 'completed'
            : days < 0 ? 'overdue'
            : days <= QHP_WARNING_DAYS ? 'due-soon'
            : 'completed';
        }
        // No qualifying QHP → Not Done, even for rehab-only (baseline compulsory).
        const by = q?.coach_id ? pName.get(q.coach_id)?.name ?? null : c.coach_id ? pName.get(c.coach_id)?.name ?? null : null;
        return {
          clientId: c.id,
          name: `${c.first_name ?? ''} ${c.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || 'Client',
          subscription: c.subscription_type ?? null,
          trainers: trainersOf.get(c.id) ?? [], crm: crmOf.get(c.id) ?? null,
          lastWorkout: lastWorkout.get(c.id) ?? null,
          lastQhp: q ? qhpRef(q) : null, qhpBy: by,
          nextDue, daysUntilDue: days, status, isRehabOnly,
        };
      });
      const prio: Record<TrackerRow['status'], number> = { 'not-done': 0, overdue: 1, 'due-soon': 2, completed: 3 };
      return rows.sort((a, b) => prio[a.status] - prio[b.status] || (a.daysUntilDue ?? -9999) - (b.daysUntilDue ?? -9999));
    },
  });
}

/* ============ Client Linked tab (web ClientLinkedTab) ============ */
export type LinkedClient = { id: string; name: string; status: string | null };
export function useClientLinked(enabled: boolean) {
  return useQuery({
    queryKey: ['qhp-client-linked'],
    enabled,
    staleTime: 300_000,
    queryFn: async (): Promise<LinkedClient[]> => {
      const { data, error } = await supabase
        .from('clients')
        .select('id, first_name, last_name, status, client_type')
        .eq('client_type', 'B2C')
        .order('first_name', { ascending: true });
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map((c) => ({ id: c.id, name: `${c.first_name ?? ''} ${c.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || 'Client', status: c.status ?? null }));
    },
  });
}
export type LinkedStaff = { id: string; name: string; role: string | null; specializations: string[] };
export function useClientAssignedStaff(clientId: string | null) {
  return useQuery({
    queryKey: ['qhp-client-staff', clientId],
    enabled: !!clientId,
    staleTime: 120_000,
    queryFn: async (): Promise<LinkedStaff[]> => {
      const { data: tc } = await supabase.from('trainer_clients').select('trainer_id').eq('client_id', clientId);
      const ids = [...new Set((tc ?? []).map((r: any) => r.trainer_id).filter(Boolean))];
      if (!ids.length) return [];
      const { data: profs, error } = await supabase.from('profiles').select('id, first_name, last_name, specializations, role').in('id', ids);
      if (error) throw new Error(error.message);
      return ((profs ?? []) as any[]).map((p) => ({
        id: p.id,
        name: `${p.first_name ?? ''} ${p.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || 'Staff',
        role: p.role ?? null,
        specializations: Array.isArray(p.specializations) ? p.specializations : typeof p.specializations === 'string' && p.specializations ? p.specializations.split(',').map((s: string) => s.trim()).filter(Boolean) : [],
      }));
    },
  });
}

/* ============ Assessor Retention (web AssessorRetention page) ============
   Per assessor: enrolled clients whose latest completed QHP is theirs; a client
   counts "active" when their last completed session is within 40 days. */
const RETENTION_INACTIVE_DAYS = 40;
export type RetentionClient = { clientId: string; clientName: string; lastSessionDate: string | null; lastQhpDate: string; daysSinceSession: number | null };
export type AssessorRetentionRow = { assessorId: string; assessorName: string; totalClients: number; activeClients: number; retentionRate: number; clients: RetentionClient[] };
export function useAssessorRetention(enabled: boolean, range: '3months' | 'all') {
  return useQuery({
    queryKey: ['assessor-retention', range],
    enabled,
    staleTime: 300_000,
    queryFn: async (): Promise<AssessorRetentionRow[]> => {
      const { data: assessors, error } = await supabase
        .from('profiles')
        .select('id, first_name, last_name')
        .eq('can_conduct_assessments', true);
      if (error) throw new Error(error.message);
      const aRows = (assessors ?? []) as any[];
      if (!aRows.length) return [];
      const aName = new Map(aRows.map((a) => [a.id, `${a.first_name ?? ''} ${a.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || 'Assessor']));

      let q = supabase
        .from('coach_assessment')
        .select('id, client_id, client_name, assessment_date, coach_id')
        .in('coach_id', aRows.map((a) => a.id))
        .not('completed', 'is', null)
        .not('client_id', 'is', null);
      if (range === '3months') {
        const d = new Date(); d.setMonth(d.getMonth() - 3);
        q = q.gte('assessment_date', d.toISOString().split('T')[0]);
      }
      const { data: assess } = await q;
      const assessRows = (assess ?? []) as any[];
      if (!assessRows.length) return aRows.map((a) => ({ assessorId: a.id, assessorName: aName.get(a.id)!, totalClients: 0, activeClients: 0, retentionRate: 100, clients: [] }));

      // Latest QHP per client (string-compare on assessment_date, mirrors web).
      const latest = new Map<string, any>();
      assessRows.forEach((a) => {
        const cur = latest.get(a.client_id);
        if (!cur || String(a.assessment_date) > String(cur.assessment_date)) latest.set(a.client_id, a);
      });
      const clientIds = [...latest.keys()];
      const { data: cls } = await supabase.from('clients').select('id, subscription_type').in('id', clientIds).not('subscription_type', 'is', null);
      const enrolled = new Set(((cls ?? []) as any[]).map((c) => c.id));
      const filtered = [...latest.values()].filter((a) => enrolled.has(a.client_id));
      if (!filtered.length) return [];

      const { data: sess } = await supabase
        .from('training_sessions')
        .select('client_id, scheduled_at')
        .in('client_id', filtered.map((a) => a.client_id))
        .eq('status', 'completed')
        .order('scheduled_at', { ascending: false })
        .limit(10000);
      const lastSession = new Map<string, string>();
      ((sess ?? []) as any[]).forEach((s) => { if (!lastSession.has(s.client_id)) lastSession.set(s.client_id, s.scheduled_at); });

      const now = Date.now();
      const byAssessor = new Map<string, RetentionClient[]>();
      filtered.forEach((a) => {
        const ls = lastSession.get(a.client_id) ?? null;
        const days = ls ? Math.floor((now - new Date(ls).getTime()) / 864e5) : null;
        const arr = byAssessor.get(a.coach_id) ?? [];
        arr.push({ clientId: a.client_id, clientName: a.client_name || 'Client', lastSessionDate: ls, lastQhpDate: a.assessment_date, daysSinceSession: days });
        byAssessor.set(a.coach_id, arr);
      });
      return aRows.map((a) => {
        const clients = (byAssessor.get(a.id) ?? []).sort((x, y) => (y.daysSinceSession ?? 9999) - (x.daysSinceSession ?? 9999));
        const active = clients.filter((c) => c.daysSinceSession != null && c.daysSinceSession <= RETENTION_INACTIVE_DAYS).length;
        return {
          assessorId: a.id, assessorName: aName.get(a.id)!,
          totalClients: clients.length, activeClients: active,
          retentionRate: clients.length ? Math.round((active / clients.length) * 100) : 100,
          clients,
        };
      }).sort((x, y) => y.totalClients - x.totalClients);
    },
  });
}
