/* Session OTP, the pure rules (20 Oct 2026; offline since 21 Oct 2026). A member whose client card has
   Session OTP on gets a 4-digit code per scheduled session; the trainer verifies it before Add Workout and
   the server refuses an unverified log. The app never sees the code: it reads flags and statuses, and calls
   the verify RPC.
   Offline (owner decisions 21 Oct 2026: trust now and verify at sync; a code typed offline counts only on the
   session's IST day; the typed code waits in the normal offline queue): with no network the trainer types the
   code, the app saves it in the queue (kind session-otp-verify) BEFORE the workout, the form opens, and when
   the phone is back the queue verifies the code first, then inserts the log. Nothing is pre-downloaded: a
   4-digit code kept on a phone in any form can be cracked in milliseconds.
   Expiry (22 Oct 2026, owner: "a code is valid only 2 hours after the session; after that a new code is generated,
   history saved with the timestamp"; hub-track migration 20261022140000): a code works until 2 hours after its
   session ends (a slot counts as 60 minutes). A trainer who types it later gets reason 'code_expired'; the server
   has made a new code and pushed it to the member, so the trainer asks for the new one. A verified code does not
   expire. Offline, the code in force at the time typed counts.
   Web reference: hub-track src/hooks/useSessionOtp.ts, SessionOtpDialog.tsx. No native imports here. */

export type OtpStatus = 'pending' | 'verified' | 'cancelled';
export type OtpSlotStatus = { status: OtpStatus | string; verified_at: string | null; couple: boolean; coupleGroupId?: string | null };
export type VerifyReason = 'not_authenticated' | 'no_otp' | 'not_your_session' | 'cancelled' | 'invalid' | 'expired' | 'code_expired' | string;
export type VerifyAnswer =
  | { ok: true; already_verified?: boolean; verified_at?: string | null; verified_count?: number }
  | { ok: false; reason?: VerifyReason };

/** A code typed with no network, waiting in the offline queue (never the code itself in this type). */
export type SavedOtp = { scheduleId: string; clientId: string; coupleGroupId: string | null; day: string; enteredAt: string };

/** The server's refusal starts with this; the app's friendly text is OTP_GATE_MESSAGE. */
export const OTP_GATE_PREFIX = 'OTP_NOT_VERIFIED';
export const OTP_GATE_MESSAGE = "Session code not verified. Verify the member's 4-digit code from Today's Roster, then save again.";
export const OTP_GATE_SHORT = 'Session code not verified';
/** A queued offline verification the server refused at sync: 'OTP_VERIFY_FAILED:<reason>'. */
export const OTP_VERIFY_FAILED_PREFIX = 'OTP_VERIFY_FAILED';
export const OTP_OFFLINE_MESSAGE = 'You are offline. The code is saved on this phone and checked when you are back online. The workout waits in Waiting to Sync until then.';
export const OTP_NETWORK_MESSAGE = 'The code could not be verified right now. Save it and it is checked when the connection is back, or retry.';
export const OTP_SAVED_HINT = 'Session code saved on this phone, checked when back online.';
export const OTP_WRONG_AT_SYNC_MESSAGE = 'The code was wrong. Ask the member for the code again, then Retry.';
export const OTP_EXPIRED_AT_SYNC_MESSAGE = 'The code was typed on a different day than the session, so it could not be used. Verify the code again now, then Retry.';
/** The 2-hour validity (22 Oct 2026): the code ran out; the server sent the member a new one. */
export const OTP_CODE_EXPIRED_MESSAGE = 'This code has expired. A code works until 2 hours after the session, and the member has been sent a new one. Ask them for it.';
export const OTP_CODE_EXPIRED_AT_SYNC_MESSAGE = 'The code had already expired when it was typed. The member has been sent a new code. Verify it now, then Retry.';

/** True for the server's refusal (raw) and for the app's friendly copy of it. */
export const isOtpGateError = (e: unknown): boolean => {
  const msg = String((e as any)?.message ?? e ?? '');
  return msg.includes(OTP_GATE_PREFIX) || msg.startsWith(OTP_GATE_SHORT);
};

/** The reason inside a refused offline verification ('OTP_VERIFY_FAILED:invalid'), else null. */
export const verifyFailureReason = (e: unknown): VerifyReason | null => {
  const msg = String((e as any)?.message ?? e ?? '');
  const i = msg.indexOf(OTP_VERIFY_FAILED_PREFIX + ':');
  if (i < 0) return null;
  const r = msg.slice(i + OTP_VERIFY_FAILED_PREFIX.length + 1).trim().split(/\s/)[0];
  return r || 'unknown';
};

/** The sheet opens when the member's flag is on, the slot is not verified on the server, and no code for it
    is saved on this phone. Unknown flag = no step (the server still refuses an unverified log). */
export const otpGateNeeded = (flag: boolean | undefined, status: OtpSlotStatus | undefined, savedLocally?: boolean): boolean =>
  flag === true && status?.status !== 'verified' && savedLocally !== true;

/** A saved code covers its own slot, and the partner's slot of the same couple on the same IST day
    (the server verifies both rows from one entry). */
export const savedOtpCovers = (saved: SavedOtp[], scheduleId: string, status: OtpSlotStatus | undefined, day: string): boolean =>
  saved.some((s) => s.scheduleId === scheduleId || (!!s.coupleGroupId && s.coupleGroupId === (status?.coupleGroupId ?? null) && s.day === day));

/** Reason copy, mirrored from the web dialog word for word (no dashes). */
export const otpReasonText = (reason: VerifyReason | undefined | null): string => {
  switch (reason) {
    case 'invalid': return 'Session code not valid. Ask the member for the code again.';
    case 'cancelled': return 'This session is cancelled, so its code cannot be used.';
    case 'no_otp': return "No code exists for this session yet. Ask CRM to check the member's Session code setting.";
    case 'not_your_session': return 'This session belongs to another trainer.';
    case 'not_authenticated': return 'You are signed out. Sign in again and retry.';
    case 'expired': return 'The code was typed on a different day than the session, so it cannot be used.';
    case 'code_expired': return OTP_CODE_EXPIRED_MESSAGE;
    default: return 'The code could not be verified.';
  }
};

/** The line under a refused workout log: the saved code's own failure when there was one, else the gate copy. */
export const workoutOtpErrorText = (failedVerifyReason: VerifyReason | null | undefined): string => {
  if (failedVerifyReason === 'invalid') return OTP_WRONG_AT_SYNC_MESSAGE;
  if (failedVerifyReason === 'expired') return OTP_EXPIRED_AT_SYNC_MESSAGE;
  if (failedVerifyReason === 'code_expired') return OTP_CODE_EXPIRED_AT_SYNC_MESSAGE;
  if (failedVerifyReason) return `${otpReasonText(failedVerifyReason)} Then Retry.`;
  return OTP_GATE_MESSAGE;
};

/** Tolerant parser for the verify RPC's json. Anything unreadable counts as not ok. */
export const parseVerifyAnswer = (data: unknown): VerifyAnswer => {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  if (d.ok === true) {
    return { ok: true, already_verified: d.already_verified === true, verified_at: typeof d.verified_at === 'string' ? d.verified_at : null, verified_count: typeof d.verified_count === 'number' ? d.verified_count : undefined };
  }
  return { ok: false, reason: typeof d.reason === 'string' ? d.reason : undefined };
};

/** Four boxes from one input value: digits only, at most four. */
export const otpDigits = (raw: string): string => raw.replace(/\D/g, '').slice(0, 4);

/** Sheet body copy. */
export const otpSheetBody = (clientName: string, couple: boolean): string =>
  `Ask ${clientName || 'the member'} for the 4-digit code CRM sent them. The workout opens once it is verified.` + (couple ? ' One code covers both partners today.' : '')
  + ' A code works until 2 hours after the session.';

/** The IST calendar day (YYYY-MM-DD) of a time, for the same-day rule. */
export const istDayOf = (ms: number): string => new Date(ms + 330 * 60_000).toISOString().slice(0, 10);
