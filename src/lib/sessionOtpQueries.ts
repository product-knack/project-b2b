import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { withTimeout, NET_MS } from './withTimeout';
import { parseVerifyAnswer, type OtpSlotStatus, type VerifyAnswer } from './sessionOtp';

/* Session OTP, the server reads and the one write (20 Oct 2026). Contract (live since 13 Oct 2026):
   - clients.otp boolean: the member's switch (crm / admin / ops change it; the app reads it).
   - get_my_session_otp_status(p_schedule_ids uuid[]) -> rows {schedule_session_id, status, verified_at,
     couple}: the status, never the code, for the caller's own slots.
   - verify_session_otp(p_schedule_id uuid, p_code text) -> {ok:true, already_verified, verified_at,
     verified_count} | {ok:false, reason}. Caller must be the slot's trainer. Couples: one call verifies
     both partners' rows for that day and trainer.
   session_otps itself is never read here (RLS gives trainers nothing). */

const sortedKey = (ids: (string | null | undefined)[]) => Array.from(new Set(ids.filter((x): x is string => !!x))).sort();

/** clients.id -> otp flag for the roster's clients. Rows the trainer cannot read are simply absent. */
export function useClientsOtpFlags(clientIds: (string | null | undefined)[]) {
  const ids = sortedKey(clientIds);
  return useQuery({
    queryKey: ['clients-otp-flags', ids.join(',')],
    enabled: ids.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<Record<string, boolean>> => {
      const { data, error } = await withTimeout(Promise.resolve(supabase.from('clients').select('id, otp').in('id', ids)), NET_MS, 'Session OTP flags');
      if (error) throw new Error(error.message);
      const out: Record<string, boolean> = {};
      for (const r of (data ?? []) as any[]) out[r.id] = r.otp === true;
      return out;
    },
  });
}

/** schedule_session_id -> status for the caller's own slots. */
export function useMySessionOtpStatus(scheduleIds: (string | null | undefined)[]) {
  const ids = sortedKey(scheduleIds);
  return useQuery({
    queryKey: ['session-otp-status', ids.join(',')],
    enabled: ids.length > 0,
    staleTime: 30_000,
    queryFn: async (): Promise<Record<string, OtpSlotStatus>> => {
      const { data, error } = await withTimeout(Promise.resolve(supabase.rpc('get_my_session_otp_status', { p_schedule_ids: ids })), NET_MS, 'Session OTP status');
      if (error) throw new Error(error.message);
      const out: Record<string, OtpSlotStatus> = {};
      for (const r of (data ?? []) as any[]) {
        if (r?.schedule_session_id) out[r.schedule_session_id] = { status: String(r.status ?? 'pending'), verified_at: r.verified_at ?? null, couple: r.couple === true };
      }
      return out;
    },
  });
}

/** The trainer's only write: verify the member's code for a roster slot. Throws on network / timeout. */
export async function verifySessionOtp(scheduleId: string, code: string): Promise<VerifyAnswer> {
  const { data, error } = await withTimeout(Promise.resolve(supabase.rpc('verify_session_otp', { p_schedule_id: scheduleId, p_code: code })), NET_MS, 'Session code');
  if (error) throw new Error(error.message);
  return parseVerifyAnswer(data);
}

export function useVerifySessionOtp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { scheduleId: string; code: string }) => verifySessionOtp(input.scheduleId, input.code),
    onSuccess: (answer) => { if (answer.ok) qc.invalidateQueries({ queryKey: ['session-otp-status'] }); },
  });
}
