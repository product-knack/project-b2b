import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { withTimeout, NET_MS } from './withTimeout';
import { enqueueOutbox, removeOutboxItem, type OutboxItem } from './offline';
import { parseVerifyAnswer, OTP_VERIFY_FAILED_PREFIX, verifyFailureReason, type OtpSlotStatus, type VerifyAnswer, type SavedOtp, type VerifyReason, type CrmContact, type PaidCancelReason } from './sessionOtp';

/* Session OTP, the server reads and the writes (20 Oct 2026; offline 21 Oct 2026). Contract (live since
   13 Oct 2026, offline arguments since migration 20261021150000):
   - clients.otp boolean: the member's switch (crm / admin / ops change it; the app reads it).
   - get_my_session_otp_status(p_schedule_ids uuid[]) -> rows {schedule_session_id, status, verified_at,
     couple, couple_group_id, verified_source}: the status, never the code, for the caller's own slots.
   - verify_session_otp(p_schedule_id uuid, p_code text, p_entered_at timestamptz, p_source text) ->
     {ok:true, already_verified, verified_at, verified_count} | {ok:false, reason}. Caller must be the slot's
     trainer. Couples: one call verifies both partners' rows for that day and trainer. The online path sends
     the first two arguments; the queue replay sends all four (source offline_sync, the time typed).
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
        if (r?.schedule_session_id) out[r.schedule_session_id] = { status: String(r.status ?? 'pending'), verified_at: r.verified_at ?? null, couple: r.couple === true, coupleGroupId: r.couple_group_id ?? null };
      }
      return out;
    },
  });
}

/** The trainer's online write: verify the member's code for a roster slot. Throws on network / timeout. */
export async function verifySessionOtp(scheduleId: string, code: string, offline?: { enteredAt: string }): Promise<VerifyAnswer> {
  const args: Record<string, unknown> = { p_schedule_id: scheduleId, p_code: code };
  if (offline) { args.p_entered_at = offline.enteredAt; args.p_source = 'offline_sync'; }
  const { data, error } = await withTimeout(Promise.resolve(supabase.rpc('verify_session_otp', args)), NET_MS, 'Session code');
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

/* ---------- paid cancellation code (22 Oct 2026) ---------- */

/** The client's latest active CRM (name and number), for "Ask <CRM> for the paid cancellation code". */
export function useClientCrmContact(clientId: string | null) {
  return useQuery({
    queryKey: ['client-crm-contact', clientId],
    enabled: !!clientId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<CrmContact | null> => {
      const { data, error } = await withTimeout(Promise.resolve(supabase.rpc('get_client_crm_contact', { p_client_id: clientId })), NET_MS, 'CRM contact');
      if (error) throw new Error(error.message);
      const d = (data && typeof data === 'object' ? data : null) as Record<string, unknown> | null;
      if (!d || !d.name) return null;
      return { crm_id: typeof d.crm_id === 'string' ? d.crm_id : null, name: String(d.name), phone: typeof d.phone === 'string' ? d.phone : null, source: typeof d.source === 'string' ? d.source : null };
    },
  });
}

export async function verifyPaidCancellationCode(scheduleId: string, code: string): Promise<{ ok: boolean; reason?: PaidCancelReason }> {
  const { data, error } = await withTimeout(Promise.resolve(supabase.rpc('verify_paid_cancellation_code', { p_schedule_id: scheduleId, p_code: code })), NET_MS, 'Paid cancellation code');
  if (error) throw new Error(error.message);
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  return d.ok === true ? { ok: true } : { ok: false, reason: typeof d.reason === 'string' ? d.reason : undefined };
}

export function useVerifyPaidCancellationCode() {
  return useMutation({ mutationFn: (input: { scheduleId: string; code: string }) => verifyPaidCancellationCode(input.scheduleId, input.code) });
}

/* ---------- offline: the saved code in the queue ---------- */

export type SavedOtpPayload = SavedOtp & { code: string; clientName: string };

/** Save a code typed with no network. Queued BEFORE the workout that follows it, so the drain verifies first. */
export async function saveSessionOtpOffline(p: SavedOtpPayload): Promise<OutboxItem> {
  return enqueueOutbox('session-otp-verify', `Session code · ${p.clientName}`, p);
}

/** The queue replay (offline.ts): the server answer decides. {ok:false} throws a real refusal (never retried);
    a network failure throws as it is (retried later). */
export async function submitSavedOtp(p: SavedOtpPayload): Promise<void> {
  const answer = await verifySessionOtp(p.scheduleId, p.code, { enteredAt: p.enteredAt });
  if (!answer.ok) throw new Error(`${OTP_VERIFY_FAILED_PREFIX}:${answer.reason ?? 'unknown'}`);
}

/** Codes saved on this phone and still waiting (pending or syncing). Failed ones no longer cover the slot. */
export const savedOtpsFrom = (items: OutboxItem[]): SavedOtp[] =>
  items.filter((i) => i.kind === 'session-otp-verify' && i.status !== 'failed').map((i) => {
    const p = i.payload as SavedOtpPayload;
    return { scheduleId: p.scheduleId, clientId: p.clientId, coupleGroupId: p.coupleGroupId ?? null, day: p.day, enteredAt: p.enteredAt };
  });

/** Why the saved code for a slot was refused at sync, when it was. */
export const failedVerifyReasonFor = (items: OutboxItem[], scheduleId: string | null | undefined): VerifyReason | null => {
  if (!scheduleId) return null;
  const f = items.find((i) => i.kind === 'session-otp-verify' && i.status === 'failed' && (i.payload as SavedOtpPayload)?.scheduleId === scheduleId);
  return f ? verifyFailureReason(f.error) : null;
};

/** After a successful online verification: the stale saved codes for that slot are discarded. */
export async function discardSavedOtps(items: OutboxItem[], scheduleId: string): Promise<void> {
  for (const i of items) {
    if (i.kind === 'session-otp-verify' && (i.payload as SavedOtpPayload)?.scheduleId === scheduleId && i.status !== 'syncing') await removeOutboxItem(i.id);
  }
}
