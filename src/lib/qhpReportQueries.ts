import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';

/* ============ QHP report-generator workspace ============
   Ports the web TrainerAssessments tabs used by report creators / view-all
   trainers (e.g. Furqan Saifi — can_view_all_assessments + qhp_report_creator):
   - All QHPs             → coach_assessment (all trainers) + assessor names
   - Without QHP Report   → useAssessmentsWithoutReport (latest per client,
                            completed, no qhp_details row) + last workout date
   - QHP Data Missing     → useAssessmentsDataMissing (date passed, no data)
   - My Report Tasks      → coach_assessment.report_assigned_to = me
   - Report PDFs          → qhp_details grouped per client; PDFs live in the
                            PUBLIC 'qhp-images' bucket (verified live). */

const nm = (p: any) => `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || '—';
const hasData = (v: any) => v && typeof v === 'object' && Object.keys(v).length > 0;
const todayIST = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const CHUNK = 200;

async function reportedAssessmentIds(ids: string[]): Promise<Set<string>> {
  const withReport = new Set<string>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await supabase.from('qhp_details').select('coach_assessment_id').in('coach_assessment_id', ids.slice(i, i + CHUNK));
    if (error) throw new Error(error.message);
    (data ?? []).forEach((d: any) => { if (d.coach_assessment_id) withReport.add(d.coach_assessment_id); });
  }
  return withReport;
}

/* ---------------- All QHPs (all trainers) ---------------- */
export type AllQhpRow = { id: string; clientName: string; assessorName: string; date: string | null; time: string | null; scheduled: boolean; done: boolean; hasReport: boolean };
export function useAllQhps(enabled: boolean) {
  return useQuery({
    queryKey: ['qhp-reports-all'],
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<AllQhpRow[]> => {
      const { data, error } = await supabase
        .from('coach_assessment')
        .select('id, client_name, assessment_date, assessment_time, assessment_scheduled, new_client_assessment_data, existing_client_assessment_data, qhp_data, profiles!coach_assessment_coach_id_fkey(first_name, last_name)')
        .order('assessment_date', { ascending: false, nullsFirst: false })
        .limit(500);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as any[];
      const withReport = await reportedAssessmentIds(rows.map((r) => r.id));
      return rows.map((r) => ({
        id: r.id, clientName: r.client_name || '—', assessorName: r.profiles ? nm(r.profiles) : 'Unassigned',
        date: r.assessment_date ?? null, time: r.assessment_time ?? null,
        scheduled: r.assessment_scheduled === true,
        done: hasData(r.new_client_assessment_data) || hasData(r.existing_client_assessment_data) || hasData(r.qhp_data),
        hasReport: withReport.has(r.id),
      }));
    },
  });
}

/* ---------------- Without QHP Report (latest per client, completed, unreported) ---------------- */
export type NoReportRow = { id: string; clientId: string; clientName: string; trainerName: string; date: string; time: string | null; mechanicalScore: number | null; lastWorkoutAt: string | null };
/* Web scope rule: OWN assessments unless the user can schedule for others (QHP manager)
   or is a restricted progression-only trainer. */
export function useWithoutReport(uid: string | null, allScope: boolean, enabled: boolean) {
  return useQuery({
    queryKey: ['assessments-without-report', allScope ? 'all' : 'own', uid],
    enabled: enabled && !!uid,
    staleTime: 60_000,
    queryFn: async (): Promise<NoReportRow[]> => {
      let query = supabase
        .from('coach_assessment')
        .select('id, client_id, client_name, assessment_date, assessment_time, mechanical_score, new_client_assessment_data, existing_client_assessment_data, qhp_data, profiles!coach_assessment_coach_id_fkey(first_name, last_name)')
        .not('client_id', 'is', null)
        .order('assessment_date', { ascending: false })
        .order('assessment_time', { ascending: false, nullsFirst: false });
      if (!allScope) query = query.eq('coach_id', uid!);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      // latest per client → keep completed only → drop ones that already have a report
      const latest = new Map<string, any>();
      ((data ?? []) as any[]).forEach((a) => { if (a.client_id && !latest.has(a.client_id)) latest.set(a.client_id, a); });
      const completed = [...latest.values()].filter((a) => (hasData(a.new_client_assessment_data) || hasData(a.existing_client_assessment_data) || hasData(a.qhp_data)) && a.assessment_date);
      if (!completed.length) return [];
      const withReport = await reportedAssessmentIds(completed.map((a) => a.id));
      const remaining = completed.filter((a) => !withReport.has(a.id));
      // last workout date per client
      const lastWorkout = new Map<string, string>();
      const cids = remaining.map((a) => a.client_id);
      for (let i = 0; i < cids.length; i += CHUNK) {
        const { data: wx } = await supabase.from('workout_exercises').select('client_id, session_date').in('client_id', cids.slice(i, i + CHUNK)).not('session_date', 'is', null).order('session_date', { ascending: false });
        (wx ?? []).forEach((r: any) => { if (r.client_id && !lastWorkout.has(r.client_id)) lastWorkout.set(r.client_id, r.session_date); });
      }
      return remaining.map((a) => ({
        id: a.id, clientId: a.client_id, clientName: a.client_name || '—',
        trainerName: a.profiles ? nm(a.profiles) : 'Unknown Trainer',
        date: a.assessment_date, time: a.assessment_time ?? null,
        mechanicalScore: a.mechanical_score ?? null,
        lastWorkoutAt: lastWorkout.get(a.client_id) ?? null,
      }));
    },
  });
}

/* ---------------- QHP Data Missing (date passed, nothing captured) ---------------- */
export type DataMissingRow = { id: string; clientName: string; trainerName: string; date: string; time: string | null };
export function useDataMissing(uid: string | null, allScope: boolean, enabled: boolean) {
  return useQuery({
    queryKey: ['assessments-data-missing', allScope ? 'all' : 'own', uid],
    enabled: enabled && !!uid,
    staleTime: 60_000,
    queryFn: async (): Promise<DataMissingRow[]> => {
      let query = supabase
        .from('coach_assessment')
        .select('id, client_id, client_name, assessment_date, assessment_time, new_client_assessment_data, existing_client_assessment_data, qhp_data, profiles!coach_assessment_coach_id_fkey(first_name, last_name)')
        .not('client_id', 'is', null)
        .lt('assessment_date', todayIST())
        .order('assessment_date', { ascending: false })
        .order('assessment_time', { ascending: false, nullsFirst: false });
      if (!allScope) query = query.eq('coach_id', uid!);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      const latest = new Map<string, any>();
      ((data ?? []) as any[]).forEach((a) => { if (a.client_id && !latest.has(a.client_id)) latest.set(a.client_id, a); });
      const missing = [...latest.values()].filter((a) => !hasData(a.new_client_assessment_data) && !hasData(a.existing_client_assessment_data) && !hasData(a.qhp_data));
      if (!missing.length) return [];
      const withReport = await reportedAssessmentIds(missing.map((a) => a.id));
      return missing.filter((a) => !withReport.has(a.id)).map((a) => ({
        id: a.id, clientName: a.client_name || '—', trainerName: a.profiles ? nm(a.profiles) : 'Unknown Trainer',
        date: a.assessment_date, time: a.assessment_time ?? null,
      }));
    },
  });
}

/* ---------------- My Report Tasks (report_assigned_to = me) ---------------- */
export type ReportTaskRow = { id: string; clientName: string; date: string | null; mechanicalScore: number | null; status: string; assignedAt: string | null; assignerName: string | null };
export function useMyReportTasks(uid: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['my-assigned-qhp-reports', uid],
    enabled: enabled && !!uid,
    staleTime: 60_000,
    queryFn: async (): Promise<ReportTaskRow[]> => {
      const { data, error } = await supabase
        .from('coach_assessment')
        .select('id, client_name, assessment_date, mechanical_score, report_assignment_status, report_assigned_at, assigner:report_assigned_by(first_name, last_name)')
        .eq('report_assigned_to', uid!)
        .in('report_assignment_status', ['assigned', 'in_progress'])
        .order('report_assigned_at', { ascending: false });
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map((r) => ({
        id: r.id, clientName: r.client_name || 'Client', date: r.assessment_date ?? null,
        mechanicalScore: r.mechanical_score ?? null, status: r.report_assignment_status,
        assignedAt: r.report_assigned_at ?? null, assignerName: r.assigner ? nm(r.assigner) : null,
      }));
    },
  });
}

/* ---------------- Report PDFs (qhp_details per client) ---------------- */
export type PdfClientRow = { clientId: string; name: string; reportCount: number; latestAt: string | null };
export function useQhpPdfClients(enabled: boolean) {
  return useQuery({
    queryKey: ['qhp-details-pdf-clients'],
    enabled,
    staleTime: 120_000,
    queryFn: async (): Promise<PdfClientRow[]> => {
      const { data, error } = await supabase
        .from('qhp_details')
        .select('client_id, created_at, clients:client_id(first_name, last_name)')
        .not('client_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(5000);
      if (error) throw new Error(error.message);
      const byClient = new Map<string, PdfClientRow>();
      ((data ?? []) as any[]).forEach((r) => {
        const cur = byClient.get(r.client_id);
        if (cur) { cur.reportCount += 1; if (!cur.latestAt || r.created_at > cur.latestAt) cur.latestAt = r.created_at; }
        else byClient.set(r.client_id, { clientId: r.client_id, name: nm(r.clients) === '—' ? 'Unnamed client' : nm(r.clients), reportCount: 1, latestAt: r.created_at });
      });
      return [...byClient.values()].sort((a, b) => a.name.localeCompare(b.name));
    },
  });
}
export type PdfReportRow = { id: string; createdAt: string; pdfUrl: string | null; fileName: string; approved: boolean; stage: 'on_hold' | 'fully_signed' | 'pending_hod' | 'pending_senior' };
export function useQhpPdfReports(clientId: string | null) {
  return useQuery({
    queryKey: ['qhp-details-pdf-reports', clientId],
    enabled: !!clientId,
    staleTime: 120_000,
    queryFn: async (): Promise<PdfReportRow[]> => {
      const { data, error } = await supabase
        .from('qhp_details')
        .select('id, created_at, pdf_storage_path, pdf_filename, approved, review_status, signed_by_senior_researcher, signed_by_hod')
        .eq('client_id', clientId!)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map((r) => ({
        id: r.id, createdAt: r.created_at,
        pdfUrl: r.pdf_storage_path ? supabase.storage.from('qhp-images').getPublicUrl(r.pdf_storage_path).data.publicUrl : null,
        fileName: r.pdf_filename || 'QHP Report',
        approved: r.approved === true,
        stage: r.review_status === 'on_hold' ? 'on_hold' : r.signed_by_hod ? 'fully_signed' : r.signed_by_senior_researcher ? 'pending_hod' : 'pending_senior',
      }));
    },
  });
}
