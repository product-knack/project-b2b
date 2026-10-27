/* QHP cancellation requests, the network side (26 Oct 2026). Three SECURITY DEFINER RPCs on the server
   (request / withdraw by the assessor, decide by the QHP Manager); the app never writes
   coach_assessment.cancellation_request or .cancelled (a trigger refuses it). Online only: a decision is not
   something to replay later, so there is no outbox item. The pushes go through the existing
   notify-qhp-reschedule edge function, best effort, never blocking. Rules: src/lib/qhpCancellation.ts. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { withTimeout, NET_MS } from './withTimeout';
import { friendlyError } from './friendlyError';
import { getIsOnline } from './offline';
import { cancelViewOf, qhpCancelCodeText, type CancelView, type Payment } from './qhpCancellation';

const OFFLINE = 'You are offline. Try again when you are back online.';

const fail = (e: unknown): never => {
  const msg = (e as any)?.message ?? String(e ?? '');
  throw new Error(qhpCancelCodeText(msg) ?? friendlyError(e, 'Could not send this. Try again.'));
};

const notify = (body: Record<string, unknown>) => {
  try {
    supabase.functions.invoke('notify-qhp-reschedule', { body }).catch(() => undefined);
  } catch { /* best effort */ }
};

const invalidateAll = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: ['qhp-assessments'] });
  qc.invalidateQueries({ queryKey: ['qhp-cancellation-requests'] });
  qc.invalidateQueries({ queryKey: ['qhp-manager'] });
};

/** The assessor asks: reason + a paid / unpaid claim. The QHP stays scheduled. */
export function useRequestQhpCancellation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { assessmentId: string; clientName: string | null; reason: string; payment: Payment }) => {
      if (!getIsOnline()) throw new Error(OFFLINE);
      const { data, error } = await withTimeout(
        Promise.resolve(supabase.rpc('request_qhp_cancellation', { p_assessment_id: input.assessmentId, p_reason: input.reason.trim(), p_payment: input.payment })) as Promise<{ data: any; error: any }>,
        NET_MS, 'Cancellation request');
      if (error) fail(error);
      notify({ kind: 'cancel_requested', assessment_id: input.assessmentId, client_name: input.clientName ?? 'Client', reason: input.reason.trim() });
      return data;
    },
    onSettled: () => invalidateAll(qc),
  });
}

/** The assessor withdraws a pending request. */
export function useWithdrawQhpCancellation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (assessmentId: string) => {
      if (!getIsOnline()) throw new Error(OFFLINE);
      const { data, error } = await withTimeout(
        Promise.resolve(supabase.rpc('withdraw_qhp_cancellation', { p_assessment_id: assessmentId })) as Promise<{ data: any; error: any }>,
        NET_MS, 'Withdraw');
      if (error) fail(error);
      return data;
    },
    onSettled: () => invalidateAll(qc),
  });
}

/** The QHP Manager decides. Approve with the final paid / unpaid (null keeps the assessor's claim); decline needs a note. */
export function useDecideQhpCancellation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { assessmentId: string; clientName: string | null; approve: boolean; payment: Payment | null; note: string }) => {
      if (!getIsOnline()) throw new Error(OFFLINE);
      const note = input.note.trim() || null;
      const { data, error } = await withTimeout(
        Promise.resolve(supabase.rpc('decide_qhp_cancellation', { p_assessment_id: input.assessmentId, p_approve: input.approve, p_payment: input.payment, p_note: note })) as Promise<{ data: any; error: any }>,
        NET_MS, 'Decision');
      if (error) fail(error);
      notify(input.approve
        ? { kind: 'cancelled', assessment_id: input.assessmentId, client_name: input.clientName ?? 'Client' }
        : { kind: 'cancel_declined', assessment_id: input.assessmentId, client_name: input.clientName ?? 'Client', reason: note ?? '' });
      return data;
    },
    onSettled: () => invalidateAll(qc),
  });
}

/* ---------- the QHP Manager's lists ---------- */
export type CancellationRequestRow = {
  id: string;
  client_id: string | null;
  client_name: string | null;
  coach_id: string | null;
  assessor_name: string | null;
  assessment_date: string | null;
  assessment_time: string | null;
  cancelled: any;
  cancellation_request: any;
  view: CancelView;
};

/** Pending: soonest slot first. Decided: latest decision first. RLS already lets managers read these rows. */
export function useQhpCancellationRequests(status: 'pending' | 'decided', enabled: boolean) {
  return useQuery({
    queryKey: ['qhp-cancellation-requests', status],
    enabled,
    staleTime: 30_000,
    refetchInterval: enabled ? 60_000 : false,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<CancellationRequestRow[]> => {
      let q = supabase
        .from('coach_assessment')
        .select('id, client_id, client_name, coach_id, assessment_date, assessment_time, cancelled, cancellation_request, assessor:profiles!coach_assessment_coach_id_fkey(first_name, last_name)')
        .not('cancellation_request', 'is', null);
      q = status === 'decided' ? q.in('cancellation_request->>status', ['approved', 'declined']) : q.eq('cancellation_request->>status', 'pending');
      const { data, error } = await withTimeout(Promise.resolve(q.order('assessment_date', { ascending: true }).limit(200)) as Promise<{ data: any; error: any }>, NET_MS, 'Cancellation requests');
      if (error) throw new Error(friendlyError(error, 'Could not load the requests. Pull to refresh.'));
      const rows: CancellationRequestRow[] = ((data ?? []) as any[]).map((r) => ({
        id: String(r.id), client_id: r.client_id ?? null, client_name: r.client_name ?? null, coach_id: r.coach_id ?? null,
        assessor_name: [r.assessor?.first_name, r.assessor?.last_name].filter(Boolean).join(' ').trim() || null,
        assessment_date: r.assessment_date ?? null, assessment_time: r.assessment_time ?? null,
        cancelled: r.cancelled ?? null, cancellation_request: r.cancellation_request ?? null, view: cancelViewOf(r),
      }));
      if (status === 'decided') rows.sort((a, b) => String(b.cancellation_request?.decided_at ?? '').localeCompare(String(a.cancellation_request?.decided_at ?? '')));
      return rows;
    },
  });
}
