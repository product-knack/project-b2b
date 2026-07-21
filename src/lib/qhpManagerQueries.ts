import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { useAuth } from '../auth';

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
const nonEmpty = (v: any) => !!v && typeof v === 'object' && Object.keys(v).length > 0;
const QHP_CLIENT_CUTOFF = '2026-03-04T00:00:00+00:00';

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
export type OpsPrefs = { date: string | null; timeFrom: string | null; location: string | null; notes: string | null };
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
};
export type QhpAssessment = {
  id: string; clientId: string | null; clientName: string; assessorName: string;
  scheduledAt: string | null; completed: boolean; overdue: boolean;
  completedAt: string | null;                       // conducted timestamp
  status: 'completed' | 'pending' | 'overdue';      // web calculateQHPStatus (documentation status)
  validityOverdue: boolean;                         // web isValidityOverdue (45d cycle, active client, latest completed)
  managerReview: 'approved' | 'not_approved' | null; stage: 'not_scheduled' | 'scheduled' | 'completed';
};
export type QhpReschedule = { id: string; clientName: string; assessorName: string; currentAt: string | null; proposedAt: string | null; requestedAt: string | null; remark: string | null };
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

export function useQhpManager(enabled: boolean) {
  return useQuery({
    queryKey: ['qhp-manager', 'v4'],
    enabled,
    staleTime: 30_000,
    refetchInterval: 30_000, // web polls the reschedule requests at 30s
    queryFn: async (): Promise<QhpManagerData> => {
      // ---- Task Pending (client-centric) ----
      let pending: PendingClient[] = [];
      let holdMap = new Map<string, { reason: string | null; overdue: boolean; resolvingAt: string | null }>();
      try {
        const { data: leadRows } = await supabase.rpc('get_qhp_booked_client_ids');
        const leadIds = [...new Set(((leadRows ?? []) as any[]).map((r) => (typeof r === 'string' ? r : r?.client_id)).filter(Boolean))] as string[];
        if (leadIds.length) {
          const { data: clients } = await supabase
            .from('clients')
            .select('id, first_name, last_name, phone, status, created_at')
            .in('id', leadIds)
            .or('status.eq.active,status.is.null')
            .gte('created_at', QHP_CLIENT_CUTOFF)
            .order('created_at', { ascending: false });
          const cls = (clients ?? []) as any[];
          const cIds = cls.map((c) => c.id);
          const hasData = new Map<string, boolean>();
          const asmt = new Map<string, { id: string; date: string | null; time: string | null }>();
          if (cIds.length) {
            const { data: as } = await supabase
              .from('coach_assessment')
              .select('id, client_id, assessment_date, assessment_time, new_client_assessment_data, existing_client_assessment_data, qhp_data')
              .in('client_id', cIds);
            (as ?? []).forEach((a: any) => {
              if (!a.client_id) return;
              asmt.set(a.client_id, { id: a.id, date: a.assessment_date ?? null, time: a.assessment_time ?? null });
              if (nonEmpty(a.new_client_assessment_data) || nonEmpty(a.existing_client_assessment_data) || nonEmpty(a.qhp_data)) hasData.set(a.client_id, true);
            });
          }
          // holds (keep resolving_at — the card shows "Resolving by …")
          try {
            const { data: holds } = await supabase.rpc('get_qhp_holds');
            (holds ?? []).forEach((h: any) => { if (h.client_id) holdMap.set(h.client_id, { reason: h.reason ?? null, overdue: h.is_overdue === true, resolvingAt: h.resolving_at ?? null }); });
          } catch { /* no holds */ }
          // Ops preferences (web "Notes from Ops" + scheduling-form prefill)
          const prefsMap = new Map<string, OpsPrefs>();
          if (cIds.length) {
            try {
              const { data: prefs } = await supabase.rpc('get_lead_qhp_prefs_for_clients', { _client_ids: cIds });
              (prefs ?? []).forEach((row: any) => {
                if (!row?.client_id) return;
                prefsMap.set(row.client_id, {
                  date: row.qhp_pref_date ?? null, timeFrom: row.qhp_pref_time_from ?? null,
                  location: row.qhp_pref_location ?? null, notes: row.qhp_pref_notes ?? null,
                });
              });
            } catch { /* prefs RPC unavailable */ }
          }
          pending = cls
            .filter((c) => !hasData.get(c.id)) // drop completed QHPs
            .map((c) => {
              const rec = asmt.get(c.id);
              return {
                clientId: c.id, name: fullName(c), phone: c.phone ?? null, joinedAt: c.created_at,
                hasQHP: !!rec, assessmentId: rec?.id ?? null, assessmentDate: rec?.date ?? null, assessmentTime: rec?.time ?? null,
                holdReason: holdMap.get(c.id)?.reason ?? null, holdOverdue: holdMap.get(c.id)?.overdue ?? false,
                holdResolvingAt: holdMap.get(c.id)?.resolvingAt ?? null,
                opsPrefs: prefsMap.get(c.id) ?? null,
              };
            });
        }
      } catch { /* booked RPC unavailable */ }

      const taskScheduled = pending.filter((c) => c.hasQHP);
      const taskOnHold = pending.filter((c) => !c.hasQHP && holdMap.has(c.clientId));
      const taskNotScheduled = pending.filter((c) => !c.hasQHP && !holdMap.has(c.clientId));

      // ---- Manager list + Review + Reschedules (all coach_assessment, fully paged) ----
      const pageAll = async (build: (q: any) => any, maxPages = 20) => {
        const out: any[] = [];
        for (let p = 0; p < maxPages; p++) {
          const { data, error } = await build(p);
          if (error) throw new Error(error.message);
          const chunk = (data ?? []) as any[];
          out.push(...chunk);
          if (chunk.length < 1000) break;
        }
        return out;
      };
      const CA_LIGHT = 'id, client_id, client_name, coach_id, assessment_date, assessment_time, assessment_scheduled, completed, qhp_manager, sla_deadline_at, reschedule_status, reschedule_data';
      const cutoff45 = new Date(Date.now() - 45 * 86_400_000).toISOString();
      const [rows, dataIdRows, activeClientRows, recentSessionRows] = await Promise.all([
        pageAll((p) => supabase.from('coach_assessment').select(CA_LIGHT).order('assessment_date', { ascending: false, nullsFirst: false }).range(p * 1000, p * 1000 + 999)),
        // ids of assessments that actually contain data (web isAssessmentCompleted, checked at the DB level)
        pageAll((p) => supabase.from('coach_assessment').select('id').or('assessment_file_url.not.is.null,new_client_assessment_data.not.is.null,existing_client_assessment_data.not.is.null,qhp_data.not.is.null').range(p * 1000, p * 1000 + 999)),
        // active clients ∩ recent training sessions (web activeClientIds — powers isValidityOverdue)
        pageAll((p) => supabase.from('clients').select('id').or('status.eq.active,status.is.null').range(p * 1000, p * 1000 + 999)),
        pageAll((p) => supabase.from('training_sessions').select('client_id').gte('scheduled_at', cutoff45).neq('status', 'cancelled').range(p * 1000, p * 1000 + 999), 12),
      ]);
      const hasDataSet = new Set(dataIdRows.map((r: any) => r.id));
      const activeIds = new Set(activeClientRows.map((r: any) => r.id));
      const recentIds = new Set(recentSessionRows.map((r: any) => r.client_id).filter(Boolean));
      const activeClientSet = new Set([...activeIds].filter((id) => recentIds.has(id)));

      const coachIds = [...new Set(rows.map((r: any) => r.coach_id).filter(Boolean))];
      const names = new Map<string, string>();
      if (coachIds.length) {
        const { data: profs } = await supabase.from('profiles').select('id, first_name, last_name').in('id', coachIds);
        (profs ?? []).forEach((p: any) => names.set(p.id, fullName(p)));
      }
      const now = Date.now();
      const atOf = (r: any) => (r.assessment_date ? `${String(r.assessment_date).slice(0, 10)}T${r.assessment_time ? String(r.assessment_time) : '00:00:00'}` : null);
      // Latest completed-with-data assessment per client (web: validity checked on the latest only)
      const latestDonePerClient = new Map<string, any>();
      for (const r of rows) {
        if (!r.client_id || !hasDataSet.has(r.id) || r.completed == null) continue;
        const prev = latestDonePerClient.get(r.client_id);
        if (!prev || new Date(r.completed).getTime() > new Date(prev.completed).getTime()) latestDonePerClient.set(r.client_id, r);
      }
      const assessments: QhpAssessment[] = rows.map((r: any) => {
        const hasData = hasDataSet.has(r.id);
        const completedAt = r.completed ?? null;
        // web calculateQHPStatus: data → completed; no data + not conducted → pending;
        // conducted >45d without data → overdue; else pending.
        const status: 'completed' | 'pending' | 'overdue' = hasData
          ? 'completed'
          : !completedAt
            ? 'pending'
            : (now - new Date(completedAt).getTime()) / 86_400_000 > 45 ? 'overdue' : 'pending';
        // web isValidityOverdue: latest completed QHP per ACTIVE client, cycle older than 45d
        const isLatestDone = !!r.client_id && latestDonePerClient.get(r.client_id)?.id === r.id;
        const validityRef = completedAt ?? r.assessment_date;
        const validityOverdue = isLatestDone && !!r.client_id && activeClientSet.has(r.client_id)
          && !!validityRef && (now - new Date(validityRef).getTime()) / 86_400_000 > 45;
        const slaOverdue = !completedAt && !!r.sla_deadline_at && new Date(r.sla_deadline_at).getTime() < now;
        return {
          id: r.id, clientId: r.client_id ?? null, clientName: r.client_name || '—',
          assessorName: r.coach_id ? names.get(r.coach_id) ?? 'Unassigned' : 'Unassigned',
          scheduledAt: atOf(r), completed: hasData, overdue: slaOverdue,
          completedAt, status, validityOverdue,
          managerReview: r.qhp_manager === 'approved' ? 'approved' : r.qhp_manager === 'not_approved' ? 'not_approved' : null,
          stage: hasData ? 'completed' : r.assessment_scheduled === true ? 'scheduled' : 'not_scheduled',
        };
      });
      // web QHPReviewTab: completed >= 2026-05-01 IST, order completed desc (timestamp-based)
      const REVIEW_CUTOFF = new Date('2026-05-01T00:00:00+05:30').getTime();
      const completedList = assessments
        .filter((a) => a.completedAt && new Date(a.completedAt).getTime() >= REVIEW_CUTOFF)
        .sort((a, b) => new Date(b.completedAt!).getTime() - new Date(a.completedAt!).getTime());
      const reschedules: QhpReschedule[] = rows.filter((r) => r.reschedule_status === 'pending').map((r) => {
        const rd = r.reschedule_data || {};
        return {
          id: r.id, clientName: r.client_name || '—', assessorName: r.coach_id ? names.get(r.coach_id) ?? '—' : '—',
          currentAt: atOf(r), proposedAt: rd.proposed_date ? `${String(rd.proposed_date).slice(0, 10)}T${rd.proposed_time || '00:00:00'}` : null,
          requestedAt: rd.requested_at ?? null, remark: rd.remark ?? null,
        };
      });

      // ---- Requests (qhp_schedule pending) ----
      let requests: QhpRequest[] = [];
      const { data: qs } = await supabase.from('qhp_schedule').select('id, client_id, scheduled_by, date, time, address, notes').eq('status', 'pending').order('date', { ascending: true }).limit(200);
      const reqRows = (qs ?? []) as any[];
      if (reqRows.length) {
        const cids = [...new Set(reqRows.map((r) => r.client_id).filter(Boolean))];
        const sids = [...new Set(reqRows.map((r) => r.scheduled_by).filter(Boolean))];
        const cn = new Map<string, string>();
        const sn = new Map<string, string>();
        if (cids.length) { const { data: cl } = await supabase.from('clients').select('id, first_name, last_name').in('id', cids); (cl ?? []).forEach((c: any) => cn.set(c.id, fullName(c))); }
        if (sids.length) { const { data: sp } = await supabase.from('profiles').select('id, first_name, last_name').in('id', sids); (sp ?? []).forEach((p: any) => sn.set(p.id, fullName(p))); }
        requests = reqRows.map((r) => ({ id: r.id, clientId: r.client_id ?? null, clientName: (r.client_id && cn.get(r.client_id)) || '—', date: r.date ?? null, time: r.time ?? null, address: r.address ?? null, notes: r.notes ?? null, scheduledByName: (r.scheduled_by && sn.get(r.scheduled_by)) || null }));
      }

      const docCompleted = assessments.filter((a) => a.status === 'completed');
      const reviewPending = completedList.filter((a) => a.managerReview === null);
      return {
        taskNotScheduled, taskScheduled, taskOnHold, assessments, reschedules, requests,
        review: { pending: reviewPending, all: completedList, approvedCount: completedList.filter((a) => a.managerReview === 'approved').length, notApprovedCount: completedList.filter((a) => a.managerReview === 'not_approved').length },
        counts: {
          taskPending: pending.length,
          notScheduled: taskNotScheduled.length,
          scheduled: taskScheduled.length,
          assessScheduled: assessments.filter((a) => a.stage === 'scheduled').length,
          holds: taskOnHold.length,
          reschedules: reschedules.length,
          requests: requests.length,
          reviewPending: reviewPending.length,
          total: assessments.length,
          completed: docCompleted.length,
          overdue: assessments.filter((a) => a.validityOverdue).length,
        },
      };
    },
  });
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

/* QHP Manager: booked clients with no assessor assigned yet (assign asap).
   leads 'QHP Booked' (gated RPC) → active clients since cutoff → drop clients
   whose assessment has data OR already has a coach_id. */
export type AssignAssessorAlert = { count: number; names: string[] };
export function useQhpAssignAssessorAlert(enabled: boolean) {
  // Key MUST be user-scoped: the persisted cache otherwise hydrates a QHP manager's
  // cached alert for every account that later signs in on the same device (the
  // disabled query still returns cached data).
  const { session } = useAuth();
  return useQuery({
    queryKey: ['qhp-assign-assessor-alert', session?.user?.id ?? 'anon'],
    enabled,
    staleTime: 60_000,
    refetchInterval: 60_000,
    queryFn: async (): Promise<AssignAssessorAlert> => {
      const { data: leadRows } = await supabase.rpc('get_qhp_booked_client_ids');
      const leadIds = [...new Set(((leadRows ?? []) as any[]).map((r) => (typeof r === 'string' ? r : r?.client_id)).filter(Boolean))] as string[];
      if (!leadIds.length) return { count: 0, names: [] };
      const { data: clients } = await supabase
        .from('clients')
        .select('id, first_name, last_name, created_at')
        .in('id', leadIds)
        .or('status.eq.active,status.is.null')
        .gte('created_at', QHP_CLIENT_CUTOFF)
        .order('created_at', { ascending: true });
      const cls = (clients ?? []) as any[];
      if (!cls.length) return { count: 0, names: [] };
      const { data: assessments } = await supabase
        .from('coach_assessment')
        .select('client_id, coach_id, new_client_assessment_data, existing_client_assessment_data, qhp_data')
        .in('client_id', cls.map((c) => c.id));
      const excluded = new Set<string>();
      ((assessments ?? []) as any[]).forEach((a) => {
        if (!a.client_id) return;
        if (a.coach_id) excluded.add(a.client_id);
        if (nonEmpty(a.new_client_assessment_data) || nonEmpty(a.existing_client_assessment_data) || nonEmpty(a.qhp_data)) excluded.add(a.client_id);
      });
      const pending = cls.filter((c) => !excluded.has(c.id));
      return { count: pending.length, names: pending.map((c) => fullName(c)).filter((n) => n !== '—') };
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
};
const nonEmptyObj = (v: any) => v && typeof v === 'object' && Object.keys(v).length > 0;
export function useQhpTracker(enabled: boolean, workoutFilter: boolean) {
  return useQuery({
    queryKey: ['qhp-tracker', workoutFilter],
    enabled,
    staleTime: 300_000,
    queryFn: async (): Promise<TrackerRow[]> => {
      // 1. Eligible clients (active-ish, enrolled, not Staff/Trial).
      const { data: cls, error } = await supabase
        .from('clients')
        .select('id, first_name, last_name, status, coach_id, subscription_type')
        .or('status.eq.active,status.eq.Active,status.is.null')
        .not('subscription_type', 'is', null)
        .neq('subscription_type', 'Staff')
        .neq('subscription_type', 'Trial')
        .order('first_name', { ascending: true });
      if (error) throw new Error(error.message);
      const clients = (cls ?? []) as any[];
      if (!clients.length) return [];

      // 2. Last completed workout per client. When the 45d filter is on we can
      //    bound the query; otherwise paginate (web fetchAllRows equivalent).
      const lastWorkout = new Map<string, string>();
      if (workoutFilter) {
        const cut = new Date(Date.now() - QHP_VALIDITY_DAYS * 864e5).toISOString();
        const { data: sess } = await supabase
          .from('training_sessions')
          .select('client_id, scheduled_at')
          .eq('status', 'completed')
          .not('client_id', 'is', null)
          .gte('scheduled_at', cut)
          .order('scheduled_at', { ascending: false })
          .limit(10000);
        (sess ?? []).forEach((s: any) => { if (!lastWorkout.has(s.client_id)) lastWorkout.set(s.client_id, s.scheduled_at); });
      } else {
        for (let page = 0; page < 10; page++) {
          const { data: sess } = await supabase
            .from('training_sessions')
            .select('client_id, scheduled_at')
            .eq('status', 'completed')
            .not('client_id', 'is', null)
            .order('scheduled_at', { ascending: false })
            .range(page * 1000, page * 1000 + 999);
          (sess ?? []).forEach((s: any) => { if (!lastWorkout.has(s.client_id)) lastWorkout.set(s.client_id, s.scheduled_at); });
          if (!sess || sess.length < 1000) break;
        }
      }
      const eligible = workoutFilter ? clients.filter((c) => lastWorkout.has(c.id)) : clients;
      if (!eligible.length) return [];
      const eligibleIds = eligible.map((c) => c.id);

      // 3+4. Names/roles + assignments + assessments.
      const [profsR, tcR, assessR] = await Promise.all([
        supabase.from('profiles').select('id, first_name, last_name, role').limit(3000),
        supabase.from('trainer_clients').select('client_id, trainer_id, actively_training').in('client_id', eligibleIds).eq('actively_training', true),
        supabase.from('coach_assessment')
          .select('id, client_id, assessment_date, assessment_file_url, new_client_assessment_data, existing_client_assessment_data, qhp_data, coach_id')
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
      // Latest DONE assessment per client.
      const lastQhp = new Map<string, any>();
      ((assessR.data ?? []) as any[]).forEach((a) => {
        if (lastQhp.has(a.client_id)) return;
        const done = !!a.assessment_file_url || nonEmptyObj(a.qhp_data) || nonEmptyObj(a.new_client_assessment_data) || nonEmptyObj(a.existing_client_assessment_data);
        if (done) lastQhp.set(a.client_id, a);
      });

      const today = new Date(); today.setHours(0, 0, 0, 0);
      const rows: TrackerRow[] = eligible.map((c) => {
        const q = lastQhp.get(c.id);
        let nextDue: string | null = null, days: number | null = null;
        let status: TrackerRow['status'] = 'not-done';
        if (q?.assessment_date) {
          const due = new Date(q.assessment_date + 'T00:00:00');
          due.setDate(due.getDate() + QHP_VALIDITY_DAYS);
          nextDue = due.toISOString();
          days = Math.floor((due.getTime() - today.getTime()) / 864e5);
          status = days < 0 ? 'overdue' : days <= QHP_WARNING_DAYS ? 'due-soon' : 'completed';
        }
        const by = q?.coach_id ? pName.get(q.coach_id)?.name ?? null : c.coach_id ? pName.get(c.coach_id)?.name ?? null : null;
        return {
          clientId: c.id,
          name: `${c.first_name ?? ''} ${c.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || 'Client',
          subscription: c.subscription_type ?? null,
          trainers: trainersOf.get(c.id) ?? [], crm: crmOf.get(c.id) ?? null,
          lastWorkout: lastWorkout.get(c.id) ?? null,
          lastQhp: q?.assessment_date ?? null, qhpBy: by,
          nextDue, daysUntilDue: days, status,
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
