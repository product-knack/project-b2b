import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { useAuth } from '../auth';

/* ============ QHP Report Review (two-stage sign-off) ============
   Web contracts (useQHPReportReviewQueue / qhpReportReview.ts / QHPReportReview.tsx):
   - Roles: profiles.junior_researcher = FIRST signer ("Sign as Senior Researcher");
     role_specialization includes 'hod' = FINAL signer. (Web's naming, kept exactly.)
   - Queue: qhp_details created_at >= 2026-05-19 IST where senior OR hod signature missing.
   - Sign senior → {signed_by_senior_researcher, senior_signed_at}; sign HOD →
     {signed_by_hod, hod_signed_at}; hold → rpc qhp_hold_report(_id,_message);
     creator resubmit → rpc qhp_resubmit_report(_id,_message).
   - review_notes jsonb = [{type: 'hold'|'hod_hold'|'resubmit', by_name, at, message}]. */

export const QHP_REVIEW_CUTOFF_ISO = '2026-05-19T00:00:00+05:30';
const MISSING_CUTOFF_ISO = '2026-05-20T00:00:00+05:30';
const nm = (p: any) => `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || '—';
const hasObj = (v: any) => v && typeof v === 'object' && Object.keys(v).length > 0;

export type ReviewNote = { type: 'hold' | 'hod_hold' | 'resubmit'; by_name?: string; at: string; message: string };
export type ReviewStage = 'pending_senior' | 'pending_hod' | 'fully_signed';
export type QhpReviewRow = {
  id: string; clientId: string; clientName: string; creatorName: string; createdAt: string;
  pdfPath: string | null; pdfFilename: string | null;
  seniorSigned: boolean; seniorName: string | null; seniorAt: string | null;
  hodSigned: boolean; hodName: string | null; hodAt: string | null;
  held: boolean; heldAt: string | null; notes: ReviewNote[];
};
export const stageOf = (r: QhpReviewRow): ReviewStage => (!r.seniorSigned ? 'pending_senior' : !r.hodSigned ? 'pending_hod' : 'fully_signed');

const SELECT = `
  id, client_id, coach_assessment_id, created_at, pdf_storage_path, pdf_filename,
  report_created_by, signed_by_senior_researcher, signed_by_hod,
  senior_signed_at, hod_signed_at, review_status, held_at, held_by, review_notes,
  clients:client_id ( first_name, last_name ),
  creator:report_created_by ( first_name, last_name ),
  senior:signed_by_senior_researcher ( first_name, last_name ),
  hod:signed_by_hod ( first_name, last_name )
`;
const QK = ['qhp-report-review-queue'];

export function useQhpReviewQueue(enabled: boolean) {
  // User-scoped key: prevents a reviewer's persisted-cache queue from hydrating (and
  // showing the dashboard review alert) for non-reviewer accounts on the same device.
  const { session } = useAuth();
  return useQuery({
    queryKey: [...QK, session?.user?.id ?? 'anon'],
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<QhpReviewRow[]> => {
      const { data, error } = await supabase
        .from('qhp_details')
        .select(SELECT)
        .gte('created_at', QHP_REVIEW_CUTOFF_ISO)
        .or('signed_by_senior_researcher.is.null,signed_by_hod.is.null')
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map((r) => ({
        id: r.id, clientId: r.client_id, clientName: nm(r.clients), creatorName: nm(r.creator), createdAt: r.created_at,
        pdfPath: r.pdf_storage_path ?? null, pdfFilename: r.pdf_filename ?? null,
        seniorSigned: !!r.signed_by_senior_researcher, seniorName: r.senior ? nm(r.senior) : null, seniorAt: r.senior_signed_at ?? null,
        hodSigned: !!r.signed_by_hod, hodName: r.hod ? nm(r.hod) : null, hodAt: r.hod_signed_at ?? null,
        held: r.review_status === 'on_hold', heldAt: r.held_at ?? null,
        notes: Array.isArray(r.review_notes) ? (r.review_notes as ReviewNote[]) : [],
      }));
    },
  });
}

/* Signed URL (private-first, public fallback) for the report PDF — web parity. */
export async function reviewPdfUrl(path: string): Promise<string | null> {
  const { data: signed } = await supabase.storage.from('qhp-images').createSignedUrl(path, 3600);
  if (signed?.signedUrl) return signed.signedUrl;
  return supabase.storage.from('qhp-images').getPublicUrl(path).data.publicUrl ?? null;
}

const invalidateReview = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: QK });
  qc.invalidateQueries({ queryKey: ['held-own-qhp-reports'] });
  qc.invalidateQueries({ queryKey: ['qhp-details-pdf-clients'] });
};

export function useSignAsSenior() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; uid: string }) => {
      const { error } = await supabase.from('qhp_details').update({ signed_by_senior_researcher: input.uid, senior_signed_at: new Date().toISOString() }).eq('id', input.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => invalidateReview(qc),
  });
}
export function useSignAsHod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; uid: string }) => {
      const { error } = await supabase.from('qhp_details').update({ signed_by_hod: input.uid, hod_signed_at: new Date().toISOString() }).eq('id', input.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => invalidateReview(qc),
  });
}
export function useHoldReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; message: string }) => {
      const { error } = await supabase.rpc('qhp_hold_report', { _id: input.id, _message: input.message });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => invalidateReview(qc),
  });
}

/* ---------------- Creator side: my held reports + resubmit ---------------- */
export type HeldOwnRow = { id: string; clientId: string; clientName: string; heldAt: string | null; notes: ReviewNote[]; coachAssessmentId: string | null };
export function useHeldOwnReports(uid: string | null, enabled = true) {
  return useQuery({
    queryKey: ['held-own-qhp-reports', uid],
    enabled: enabled && !!uid,
    staleTime: 30_000,
    queryFn: async (): Promise<HeldOwnRow[]> => {
      const { data, error } = await supabase
        .from('qhp_details')
        .select('id, client_id, coach_assessment_id, held_at, review_notes, clients:client_id(first_name, last_name)')
        .eq('report_created_by', uid!)
        .eq('review_status', 'on_hold')
        .order('held_at', { ascending: false });
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map((r) => ({
        id: r.id, clientId: r.client_id, clientName: nm(r.clients), heldAt: r.held_at ?? null,
        notes: Array.isArray(r.review_notes) ? (r.review_notes as ReviewNote[]) : [],
        coachAssessmentId: r.coach_assessment_id ?? null,
      }));
    },
  });
}
export function useResubmitReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; message: string }) => {
      const { error } = await supabase.rpc('qhp_resubmit_report', { _id: input.id, _message: input.message });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => invalidateReview(qc),
  });
}

/* ---------------- Missing reports (post-cutoff, data captured, no report) ---------------- */
export type MissingReportRow = { id: string; clientName: string; trainerName: string; completedAt: string };
export function useQhpReportMissing(enabled: boolean) {
  return useQuery({
    queryKey: ['qhp-report-missing'],
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<MissingReportRow[]> => {
      const { data, error } = await supabase
        .from('coach_assessment')
        .select('id, client_id, coach_id, completed, client_name, new_client_assessment_data, existing_client_assessment_data, qhp_data, clients:client_id(first_name, last_name), profiles:coach_id(first_name, last_name)')
        .gte('completed', MISSING_CUTOFF_ISO)
        .not('client_id', 'is', null)
        .not('completed', 'is', null)
        .order('completed', { ascending: false });
      if (error) throw new Error(error.message);
      const withData = ((data ?? []) as any[]).filter((a) => hasObj(a.qhp_data) || hasObj(a.new_client_assessment_data) || hasObj(a.existing_client_assessment_data));
      if (!withData.length) return [];
      const withReport = new Set<string>();
      const ids = withData.map((a) => a.id);
      for (let i = 0; i < ids.length; i += 200) {
        const { data: details } = await supabase.from('qhp_details').select('coach_assessment_id').in('coach_assessment_id', ids.slice(i, i + 200));
        (details ?? []).forEach((d: any) => { if (d.coach_assessment_id) withReport.add(d.coach_assessment_id); });
      }
      return withData.filter((a) => !withReport.has(a.id)).map((a) => ({
        id: a.id,
        clientName: nm(a.clients) !== '—' ? nm(a.clients) : a.client_name || 'Unknown client',
        trainerName: nm(a.profiles) !== '—' ? nm(a.profiles) : 'Unknown trainer',
        completedAt: a.completed,
      }));
    },
  });
}
