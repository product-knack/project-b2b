/* Approval requests: queries and mutations (2 Nov 2026; hub-track migration 20261102130000).
   Every write is an RPC (the table has no write policies); reads use the RPCs too, so the app never needs a
   clients policy. Keys start with 'approval-'; every write invalidates them plus the CRM client page and the
   Session code flags. Rules and words: approvalRequests.ts. */
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { withTimeout, NET_MS } from './withTimeout';
import type { ApprovalCount, ApprovalListRow, ApprovalRequest, ApprovalStatus } from './approvalRequests';

const rpc = async <T,>(name: string, args: Record<string, unknown>, label: string): Promise<T> => {
  const { data, error } = await withTimeout((supabase.rpc as any)(name, args) as Promise<{ data: T; error: any }>, NET_MS, label);
  if (error) throw error;
  return data;
};

const invalidate = (qc: QueryClient, clientId?: string | null) => {
  qc.invalidateQueries({ queryKey: ['approval-requests'] });
  qc.invalidateQueries({ queryKey: ['approval-counts'] });
  qc.invalidateQueries({ queryKey: ['approval-client'] });
  qc.invalidateQueries({ queryKey: ['clients-otp-flags'] });
  if (clientId) qc.invalidateQueries({ queryKey: ['crm-client-detail', clientId] });
  else qc.invalidateQueries({ queryKey: ['crm-client-detail'] });
};

/** The reviewer list: the types the signed-in person may review (admin: all). */
export function useApprovalRequests(type: string | null, status: ApprovalStatus | 'all', enabled = true) {
  return useQuery({
    queryKey: ['approval-requests', type, status],
    enabled,
    queryFn: () => rpc<ApprovalListRow[]>('get_approval_requests', { p_type: type, p_status: status, p_limit: 200 }, 'Loading requests').then((d) => d ?? []),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

/** Pending count per type the signed-in person may review (drawer badge). Empty for everyone else. */
export function useApprovalCounts(enabled = true) {
  return useQuery({
    queryKey: ['approval-counts'],
    enabled,
    queryFn: () => rpc<ApprovalCount[]>('get_approval_counts', {}, 'Loading approvals').then((d) => d ?? []),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

/** The latest requests about one client (the CRM client page's status line and history). */
export function useClientApprovalRequests(clientId: string | null | undefined, type: string | null, limit = 5) {
  return useQuery({
    queryKey: ['approval-client', clientId, type, limit],
    enabled: !!clientId,
    queryFn: () => rpc<ApprovalRequest[]>('get_client_approval_requests', { p_client_id: clientId, p_type: type, p_limit: limit }, 'Loading requests').then((d) => d ?? []),
    staleTime: 30_000,
  });
}

export function useCreateApprovalRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { type: string; clientId: string; reason: string }) =>
      rpc<ApprovalRequest>('create_approval_request', { p_type: v.type, p_client_id: v.clientId, p_reason: v.reason, p_subject_id: null }, 'Sending the request'),
    onSuccess: (_d, v) => invalidate(qc, v.clientId),
  });
}

export function useReviewApprovalRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; decision: 'approve' | 'reject'; note?: string; clientId?: string | null }) =>
      rpc<ApprovalRequest>('review_approval_request', { p_id: v.id, p_decision: v.decision, p_note: v.note?.trim() || null }, 'Saving the decision'),
    onSuccess: (_d, v) => invalidate(qc, v.clientId),
  });
}

export function useWithdrawApprovalRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; clientId?: string | null }) =>
      rpc<ApprovalRequest>('withdraw_approval_request', { p_id: v.id }, 'Withdrawing the request'),
    onSuccess: (_d, v) => invalidate(qc, v.clientId),
  });
}

/** Turning the Session code ON stays a direct change (crm / ops / admin; the database guard decides). */
export function useTurnSessionCodeOn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { clientId: string }) => {
      const { error } = await withTimeout(
        supabase.from('clients').update({ otp: true } as any).eq('id', v.clientId) as unknown as Promise<{ error: any }>,
        NET_MS, 'Turning on the Session code');
      if (error) throw error;
    },
    onSuccess: (_d, v) => invalidate(qc, v.clientId),
  });
}
