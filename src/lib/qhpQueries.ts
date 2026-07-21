import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { useAuth } from '../auth';

/* ============ QHP (assessments) — mirrors the web TrainerAssessments page ============
   Core table: coach_assessment (the assessor id lives in coach_id).
   "Completed" = any of new_client_assessment_data / existing_client_assessment_data /
   qhp_data is a non-empty object. "Has report" = a qhp_details row exists with
   coach_assessment_id = assessment id. */

const nonEmpty = (v: any) => !!v && typeof v === 'object' && Object.keys(v).length > 0;
export const isQhpCompleted = (r: any) =>
  nonEmpty(r.new_client_assessment_data) || nonEmpty(r.existing_client_assessment_data) || nonEmpty(r.qhp_data);

const todayIST = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export type QhpRow = {
  id: string;
  coach_id: string | null;
  client_id: string | null;
  client_name: string | null;
  assessment_date: string | null; // YYYY-MM-DD
  assessment_time: string | null; // HH:MM:SS
  location: string | null;
  notes: string | null;
  created_at: string | null;
  completed: string | null;
  reschedule_status: string | null;
  assessment_scheduled: boolean | null;
  is_completed: boolean;
  has_ai: boolean;
  label: string; // QHP Baseline / QHP Refresh N / New Prospect
  client_type: 'New Client' | 'Existing Client' | 'New Prospect';
  client_phone: string | null;
  client_created_at: string | null;
  /** clients.brb_location captured → hide the location-capture pin on QHP cards */
  home_captured: boolean;
  mechanical_score: number | null;
  heartmath_missing: boolean; // Standardized Assessment present but heartMathReport empty/absent
  health_briefing: string | null;
};

/* Web heartMathUtils.isHeartMathMissing — checks Standardized Assessment.heartMathReport. */
function isHeartMathMissing(a: any): boolean {
  for (const source of [a.new_client_assessment_data, a.existing_client_assessment_data, a.qhp_data]) {
    if (source && typeof source === 'object') {
      const sa = source['Standardized Assessment'];
      if (sa && typeof sa === 'object') {
        const hm = sa.heartMathReport;
        if (hm && typeof hm === 'object') {
          const { MHRR, SDNN, RMSSD, normalizedCoherence } = hm;
          return (!MHRR || MHRR === '') && (!SDNN || SDNN === '') && (!RMSSD || RMSSD === '') && (!normalizedCoherence || normalizedCoherence === '');
        }
        return true; // heartMathReport key missing entirely
      }
    }
  }
  return false;
}

export type QhpLists = {
  upcoming: QhpRow[];
  completedList: QhpRow[];
  withoutReport: QhpRow[];
  dataMissing: QhpRow[];
};

export function useQhpAssessments(trainerId: string) {
  return useQuery({
    queryKey: ['qhp-assessments', trainerId],
    enabled: !!trainerId,
    staleTime: 120_000,
    queryFn: async (): Promise<QhpLists> => {
      // Same core query as the web (own scope): all my assessments, newest first.
      const { data, error } = await supabase
        .from('coach_assessment')
        .select('*, clients!coach_assessment_client_id_fkey (phone, subscription_type, created_at, brb_location)')
        .eq('coach_id', trainerId)
        .order('assessment_date', { ascending: false })
        .order('assessment_time', { ascending: false, nullsFirst: false });
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as any[];

      // Phone fallback from leads.contact_no for clients missing clients.phone (web parity).
      const missingPhoneIds = [...new Set(rows.filter((r) => r.client_id && !r.clients?.phone).map((r) => r.client_id))];
      const leadPhone = new Map<string, string>();
      if (missingPhoneIds.length) {
        const { data: leadRows } = await supabase.from('leads').select('client_id, contact_no').in('client_id', missingPhoneIds);
        (leadRows ?? []).forEach((l: any) => { if (l.client_id && l.contact_no && !leadPhone.has(l.client_id)) leadPhone.set(l.client_id, l.contact_no); });
      }

      // Baseline / Refresh N — index of the assessment within the client's history (date asc).
      const byClient = new Map<string, any[]>();
      rows.forEach((r) => {
        if (!r.client_id) return;
        if (!byClient.has(r.client_id)) byClient.set(r.client_id, []);
        byClient.get(r.client_id)!.push(r);
      });
      const labelOf = (r: any) => {
        if (!r.client_id) return 'New Prospect';
        const hist = [...(byClient.get(r.client_id) ?? [])].sort((a, b) => (a.assessment_date ?? '').localeCompare(b.assessment_date ?? ''));
        const idx = hist.findIndex((h) => h.id === r.id);
        return idx <= 0 ? 'QHP Baseline' : `QHP Refresh ${idx}`;
      };

      const mapped: QhpRow[] = rows.map((r) => ({
        id: r.id,
        coach_id: r.coach_id ?? null,
        client_id: r.client_id ?? null,
        client_name: r.client_name ?? null,
        assessment_date: r.assessment_date ?? null,
        assessment_time: r.assessment_time ?? null,
        location: r.location ?? null,
        notes: r.notes ?? null,
        created_at: r.created_at ?? null,
        completed: r.completed ?? null,
        reschedule_status: r.reschedule_status ?? null,
        assessment_scheduled: r.assessment_scheduled ?? null,
        is_completed: isQhpCompleted(r),
        has_ai: nonEmpty(r.ai_biomechanical),
        label: labelOf(r),
        client_type: !r.client_id ? 'New Prospect' : r.clients?.subscription_type ? 'Existing Client' : 'New Client',
        client_phone: r.clients?.phone ?? (r.client_id ? leadPhone.get(r.client_id) ?? null : null),
        client_created_at: r.clients?.created_at ?? null,
        home_captured: r.clients?.brb_location != null,
        mechanical_score: r.mechanical_score ?? null,
        heartmath_missing: isQhpCompleted(r) ? isHeartMathMissing(r) : false,
        health_briefing: r.health_briefing ?? null,
      }));

      // Which assessments already have a generated report (qhp_details), chunked.
      const withReport = new Set<string>();
      const ids = mapped.map((m) => m.id);
      for (let i = 0; i < ids.length; i += 200) {
        const { data: qd, error: e2 } = await supabase
          .from('qhp_details')
          .select('coach_assessment_id')
          .in('coach_assessment_id', ids.slice(i, i + 200));
        if (e2) throw new Error(e2.message);
        (qd ?? []).forEach((q: any) => q.coach_assessment_id && withReport.add(q.coach_assessment_id));
      }

      // Upcoming: scheduled and not yet completed. Nearest-from-today on top:
      // today/future ascending first, then overdue (past-dated) below, most recent first.
      const todayYmd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      const sortKey = (r: any) => `${r.assessment_date ?? '9999-12-31'} ${r.assessment_time ?? '23:59'}`;
      const scheduled = mapped.filter((r) => r.assessment_scheduled === true && !r.is_completed);
      const future = scheduled.filter((r) => (r.assessment_date ?? '9999-12-31') >= todayYmd).sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
      const past = scheduled.filter((r) => (r.assessment_date ?? '9999-12-31') < todayYmd).sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
      const upcoming = [...future, ...past];

      // My QHPs: completed, newest first (as fetched).
      const completedList = mapped.filter((r) => r.is_completed);

      // Latest assessment per client (rows are date desc, so first wins).
      const latestByClient: QhpRow[] = [];
      const seen = new Set<string>();
      for (const r of mapped) {
        if (!r.client_id || seen.has(r.client_id)) continue;
        seen.add(r.client_id);
        latestByClient.push(r);
      }

      // Without report: latest per client, completed, no qhp_details row.
      const withoutReport = latestByClient.filter((r) => r.is_completed && !withReport.has(r.id));

      // Data missing: latest per client, past-dated, nothing captured, no report.
      const today = todayIST();
      const dataMissing = latestByClient.filter(
        (r) => !r.is_completed && !!r.assessment_date && r.assessment_date < today && !withReport.has(r.id)
      );

      return { upcoming, completedList, withoutReport, dataMissing };
    },
  });
}

/* ---------- Assessment permissions (profiles flags) ---------- */
export function useQhpPermissions(trainerId: string) {
  return useQuery({
    queryKey: ['qhp-permissions', trainerId],
    enabled: !!trainerId,
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('can_conduct_assessments, can_view_all_trainers, can_schedule_assessments_for_others, can_view_all_assessments')
        .eq('id', trainerId)
        .single();
      if (error) throw new Error(error.message);
      return {
        canConductAssessments: !!data?.can_conduct_assessments,
        canScheduleForOthers: !!data?.can_schedule_assessments_for_others,
        canViewAllAssessments: !!data?.can_view_all_assessments,
      };
    },
  });
}

/* ---------- "Have you connected with the client?" alerts ---------- */
export type QhpConnectRow = {
  id: string;
  client_name: string;
  assessment_date: string | null;
  assessment_time: string | null;
  location: string | null;
  phone: string | null;
};
export function useQhpConnectAlerts(trainerId: string) {
  return useQuery({
    queryKey: ['qhp-connect-alerts', trainerId],
    enabled: !!trainerId,
    staleTime: 60_000,
    queryFn: async (): Promise<QhpConnectRow[]> => {
      const { data, error } = await supabase
        .from('coach_assessment')
        .select('id, client_id, client_name, assessment_date, assessment_time, location, completed, qhp_assessor_connected')
        .eq('coach_id', trainerId)
        .is('completed', null)
        .or('qhp_assessor_connected.is.null,qhp_assessor_connected.eq.false')
        .order('assessment_date', { ascending: true, nullsFirst: false });
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as any[];
      const clientIds = [...new Set(rows.map((r) => r.client_id).filter(Boolean))];
      const nameByClient = new Map<string, string>();
      const phoneByClient = new Map<string, string>();
      if (clientIds.length) {
        const [{ data: leads }, { data: clients }] = await Promise.all([
          supabase.from('leads').select('client_id, name, contact_no').in('client_id', clientIds),
          supabase.from('clients').select('id, first_name, last_name, phone').in('id', clientIds),
        ]);
        (clients ?? []).forEach((c: any) => {
          const nm = `${c.first_name ?? ''} ${c.last_name ?? ''}`.replace(/\s+/g, ' ').trim();
          if (nm) nameByClient.set(c.id, nm);
          if (c.phone) phoneByClient.set(c.id, c.phone);
        });
        (leads ?? []).forEach((l: any) => {
          if (l.name) nameByClient.set(l.client_id, l.name);
          if (l.contact_no) phoneByClient.set(l.client_id, l.contact_no);
        });
      }
      return rows.map((r) => ({
        id: r.id,
        client_name: (r.client_id && nameByClient.get(r.client_id)) || r.client_name || 'Client',
        assessment_date: r.assessment_date ?? null,
        assessment_time: r.assessment_time ?? null,
        location: r.location ?? null,
        phone: (r.client_id && phoneByClient.get(r.client_id)) || null,
      }));
    },
  });
}

export function useMarkQhpConnected() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (assessmentId: string) => {
      const { error } = await supabase
        .from('coach_assessment')
        .update({ qhp_assessor_connected: true, qhp_assessor_connected_at: new Date().toISOString() })
        .eq('id', assessmentId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['qhp-connect-alerts'] }),
  });
}

/* ---------- Schedule a QHP (exact web insert contract) ---------- */
export function useQhpAssessors() {
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;
  return useQuery({
    queryKey: ['qhp-assessors', uid],
    staleTime: 600_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, role')
        .in('role', ['trainer', 'doctor'])
        .eq('can_conduct_assessments', true)
        .order('role', { ascending: false })
        .order('first_name');
      if (error) throw new Error(error.message);
      let rows = (data ?? []) as any[];
      // web QHPRequestsSection: a coach-role manager only sees their coach_trainers subset.
      if (uid) {
        const { data: me } = await supabase.from('profiles').select('role').eq('id', uid).maybeSingle();
        if ((me as any)?.role === 'coach') {
          const { data: ct } = await supabase.from('coach_trainers').select('trainer_id').eq('coach_id', uid);
          const allowed = new Set(((ct ?? []) as any[]).map((r) => r.trainer_id));
          rows = rows.filter((p) => allowed.has(p.id));
        }
      }
      return rows.map((p: any) => ({
        id: p.id,
        name: `${p.first_name ?? ''} ${p.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || 'Assessor',
        role: p.role as string,
      }));
    },
  });
}

export function useQhpClients() {
  return useQuery({
    queryKey: ['qhp-clients'],
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('id, first_name, last_name')
        .eq('status', 'active')
        .order('first_name');
      if (error) throw new Error(error.message);
      return (data ?? []).map((c: any) => ({
        id: c.id,
        name: `${c.first_name ?? ''} ${c.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || 'Client',
      }));
    },
  });
}

export function useScheduleQhp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      assessorId: string;      // stored in coach_id
      scheduledBy: string;     // the signed-in scheduler
      clientId: string | null; // null for new prospects
      clientName: string;
      date: string;            // YYYY-MM-DD
      time: string;            // HH:MM:SS (24h)
      location: string;
      notes: string;
      // SLA fields (web CoachAssessmentSchedulingForm parity) — pass the SLA
      // deadline ISO when scheduling from Task Pending; delay reason required
      // when breached (≥10 chars, enforced by the form).
      slaDeadlineIso?: string | null;
      delayReason?: string | null;
      // web QHPTaskPendingTab.handleScheduleSuccess: when the client was on hold,
      // scheduling clears the lead hold.
      clearHoldForClient?: boolean;
    }) => {
      if (!input.assessorId) throw new Error('Pick an assessor');
      if (!input.clientName.trim()) throw new Error('Pick a client');
      if (!input.date) throw new Error('Pick a date');
      if (!input.location.trim()) throw new Error('Enter a location');
      const insert: Record<string, any> = {
        coach_id: input.assessorId,
        client_id: input.clientId,
        client_name: input.clientName.trim(),
        assessment_date: input.date,
        assessment_time: input.time,
        location: input.location.trim(),
        notes: input.notes.trim() || null,
        assessment_scheduled: true,
        scheduled_by: input.scheduledBy,
      };
      if (input.slaDeadlineIso) {
        // isLate re-evaluated at insert time (matches web).
        const deadline = new Date(input.slaDeadlineIso).getTime();
        const now = Date.now();
        const isLate = now > deadline;
        insert.sla_deadline_at = input.slaDeadlineIso;
        insert.assigned_late = isLate;
        insert.delay_minutes = isLate ? Math.max(0, Math.round((now - deadline) / 60000)) : 0;
        if (isLate) insert.assignment_delay_reason = input.delayReason ?? null;
      }
      const { data, error } = await supabase
        .from('coach_assessment')
        .insert(insert)
        .select()
        .single();
      if (error) throw new Error(error.message);
      if (input.clearHoldForClient && input.clientId) {
        try { await supabase.rpc('clear_lead_qhp_hold_for_client', { _client_id: input.clientId }); } catch { /* hold clear best-effort (web parity) */ }
      }
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['qhp-assessments'] });
      qc.invalidateQueries({ queryKey: ['qhp-connect-alerts'] });
      qc.invalidateQueries({ queryKey: ['qhp-manager'] });
    },
  });
}

/* ---------- Web ClientAssessmentsTab timing helpers (36h target + urgency) ---------- */
export const QHP_TARGET_MINS = 36 * 60;
export function qhpFormatDuration(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 36) return `${hours}h ${mins % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}
export function qhpUrgency(assignedMins: number): { level: 'green' | 'amber' | 'red'; warning: string | null } {
  const hours = assignedMins / 60;
  if (hours <= 2) return { level: 'green', warning: null };
  if (hours <= 4) return { level: 'amber', warning: '⏳ Approaching delay' };
  return { level: 'red', warning: '⚠️ Delayed — prioritize this QHP' };
}

/* ---------- Assessor reschedule request (web RequestQHPRescheduleDialog) ----------
   Sets reschedule_status='pending' + reschedule_data {proposed_*, remark ≥10 chars,
   requested_by/at}, then fire-and-forget notify to the QHP Manager. */
export function useRequestQhpReschedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { assessmentId: string; clientName: string; requestedBy: string; proposedDate: string; proposedTime: string; remark: string }) => {
      if (input.remark.trim().length < 10) throw new Error('Remark must be at least 10 characters');
      const payload = {
        proposed_date: input.proposedDate,
        proposed_time: input.proposedTime,
        remark: input.remark.trim(),
        requested_by: input.requestedBy,
        requested_at: new Date().toISOString(),
      };
      const { error } = await supabase
        .from('coach_assessment')
        .update({ reschedule_status: 'pending', reschedule_data: payload })
        .eq('id', input.assessmentId);
      if (error) throw new Error(error.message);
      supabase.functions
        .invoke('notify-qhp-reschedule', { body: { kind: 'request', assessment_id: input.assessmentId, client_name: input.clientName } })
        .catch(() => {});
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['qhp-assessments'] }); qc.invalidateQueries({ queryKey: ['qhp-manager', 'v3'] }); },
  });
}

/* ---------- Client medical history (web MedicalHistoryViewerDialog) ---------- */
export type MedicalEntry = {
  id: string; event_date: string | null; title: string | null; description: string | null;
  category: string | null; severity: string | null; isOngoing: boolean;
  diagnosis: string | null; treatment: string | null; doctorName: string | null;
};
export function useClientMedicalHistory(clientId: string | null) {
  return useQuery({
    queryKey: ['client-medical-history', clientId],
    enabled: !!clientId,
    staleTime: 300_000,
    queryFn: async (): Promise<MedicalEntry[]> => {
      const { data, error } = await supabase
        .from('client_medical_history')
        .select('id, event_date, title, description, category, severity, is_ongoing, diagnosis, treatment_given, doctor:profiles!client_medical_history_doctor_id_fkey(first_name, last_name)')
        .eq('client_id', clientId)
        .order('event_date', { ascending: false });
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map((r) => ({
        id: r.id,
        event_date: r.event_date ?? null,
        title: r.title ?? null,
        description: r.description ?? null,
        category: r.category ?? null,
        severity: r.severity ?? null,
        isOngoing: r.is_ongoing === true,
        diagnosis: r.diagnosis ?? null,
        treatment: r.treatment_given ?? null,
        doctorName: r.doctor ? `${r.doctor.first_name ?? ''} ${r.doctor.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || null : null,
      }));
    },
  });
}

/* ---------- Uploaded health reports (web useClientHealthReports + MedicalHistoryViewerDialog) ----------
   health_reports: client_id + is_active=true, newest upload first. file_url is normally a full
   public URL (client-documents bucket); bare storage paths fall back to the health-reports bucket
   public URL — same resolution as the web's getReportPreviewUrl. RLS note: rows are visible to
   trainer-side sessions (verified live), the admin role sees none. */
export type HealthReportItem = {
  id: string;
  reportName: string;
  reportType: string | null;
  date: string | null; // test_date || upload_date || created_at (web precedence)
  fileUrl: string | null;
};
export function useClientHealthReports(clientId: string | null) {
  return useQuery({
    queryKey: ['client-health-reports', clientId],
    enabled: !!clientId,
    staleTime: 300_000,
    queryFn: async (): Promise<HealthReportItem[]> => {
      const { data, error } = await supabase
        .from('health_reports')
        .select('id, report_name, report_type, test_date, upload_date, file_url, created_at')
        .eq('client_id', clientId)
        .eq('is_active', true)
        .order('upload_date', { ascending: false });
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map((r) => {
        let url: string | null = r.file_url ?? null;
        if (url && !/^https?:\/\//i.test(url)) url = supabase.storage.from('health-reports').getPublicUrl(url).data.publicUrl;
        return {
          id: r.id,
          reportName: r.report_name || 'Health Report',
          reportType: r.report_type ?? null,
          date: r.test_date ?? r.upload_date ?? r.created_at ?? null,
          fileUrl: url,
        };
      });
    },
  });
}

/* ---------- PAR-Q+ links (web QHPListView contracts) ---------- */
const PARQ_BASE_URL = 'https://passport.oddsfitness.com';
export type ParqInfo = {
  linkByAssessment: Record<string, string>;
  statusByAssessment: Record<string, string | null>;
  signedByClient: Record<string, string>; // clientId -> consent_given_at
};
export function useParqLinks(rows: { id: string; client_id: string | null }[]) {
  const ids = rows.map((r) => r.id).sort();
  return useQuery({
    queryKey: ['parq-links', ids.join(',')],
    enabled: ids.length > 0,
    staleTime: 120_000,
    queryFn: async (): Promise<ParqInfo> => {
      const clientIds = [...new Set(rows.map((r) => r.client_id).filter(Boolean))] as string[];
      const [linksR, signedR] = await Promise.all([
        supabase.from('parq_forms').select('coach_assessment_id, token, status').in('coach_assessment_id', ids),
        clientIds.length
          ? supabase.from('parq_forms').select('client_id, consent_given_at, status').in('client_id', clientIds).eq('status', 'completed').order('consent_given_at', { ascending: false })
          : Promise.resolve({ data: [] as any[] }),
      ]);
      const linkByAssessment: Record<string, string> = {};
      const statusByAssessment: Record<string, string | null> = {};
      ((linksR.data ?? []) as any[]).forEach((row) => {
        if (!row.coach_assessment_id) return;
        linkByAssessment[row.coach_assessment_id] = `${PARQ_BASE_URL}/parq/${row.token}`;
        statusByAssessment[row.coach_assessment_id] = row.status ?? null;
      });
      const signedByClient: Record<string, string> = {};
      ((signedR.data ?? []) as any[]).forEach((row) => {
        if (row.client_id && !signedByClient[row.client_id]) signedByClient[row.client_id] = row.consent_given_at;
      });
      return { linkByAssessment, statusByAssessment, signedByClient };
    },
  });
}
export function useGenerateParqLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { assessmentId: string; clientId: string | null; clientName: string; witnessId: string }) => {
      // Witness = the assessor's profile name (mirrors web).
      let witnessName = 'Trainer';
      if (input.witnessId) {
        const { data: p } = await supabase.from('profiles').select('first_name, last_name').eq('id', input.witnessId).maybeSingle();
        if (p) witnessName = `${p.first_name ?? ''} ${p.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || 'Trainer';
      }
      const { data, error } = await supabase
        .from('parq_forms')
        .insert({ client_id: input.clientId, client_name: input.clientName, witness_name: witnessName, coach_assessment_id: input.assessmentId })
        .select('token')
        .single();
      if (error) throw new Error(error.message);
      return `${PARQ_BASE_URL}/parq/${(data as any).token}`;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['parq-links'] }),
  });
}
