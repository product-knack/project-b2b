import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchMyReimbursements, fetchAllReimbursements, submitReimbursement, reviewReimbursement,
  SubmitReimbursementInput,
} from './reimbursements';

/* ============ react-query wrappers for the reimbursement lib ============
   Keys are per user and cheap: NOT in PERSIST_PREFIXES (nothing persisted),
   no realtime, no polling. */

/** The signed-in doctor's own requests, newest first (limit 100). */
export function useMyReimbursements(uid: string | null) {
  return useQuery({
    queryKey: ['my-reimbursements', uid],
    enabled: !!uid,
    staleTime: 30_000,
    queryFn: () => fetchMyReimbursements(uid as string),
  });
}

/** Every request, for reviewers (physio HOD / admin); RLS decides what comes back. */
export function useReimbursementsReview(enabled: boolean) {
  return useQuery({
    queryKey: ['reimbursements-review'],
    enabled,
    staleTime: 30_000,
    queryFn: fetchAllReimbursements,
  });
}

export function useSubmitReimbursement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SubmitReimbursementInput) => submitReimbursement(input),
    onSuccess: (_row, v) => {
      qc.invalidateQueries({ queryKey: ['my-reimbursements', v.requesterId] });
      qc.invalidateQueries({ queryKey: ['reimbursements-review'] });
    },
  });
}

export function useReviewReimbursement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; decision: 'approved' | 'rejected'; note?: string | null }) => reviewReimbursement(v.id, v.decision, v.note),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reimbursements-review'] });
      qc.invalidateQueries({ queryKey: ['my-reimbursements'] });
    },
  });
}
