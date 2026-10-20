/* Session OTP, the pure rules (20 Oct 2026). A member whose client card has Session OTP on gets a 4-digit
   code per scheduled session; the trainer verifies it before Add Workout and the server refuses an
   unverified log. The app never sees the code: it reads flags and statuses, and calls the verify RPC.
   Web reference: hub-track src/hooks/useSessionOtp.ts, SessionOtpDialog.tsx. No native imports here. */

export type OtpStatus = 'pending' | 'verified' | 'cancelled';
export type OtpSlotStatus = { status: OtpStatus | string; verified_at: string | null; couple: boolean };
export type VerifyReason = 'not_authenticated' | 'no_otp' | 'not_your_session' | 'cancelled' | 'invalid' | string;
export type VerifyAnswer =
  | { ok: true; already_verified?: boolean; verified_at?: string | null; verified_count?: number }
  | { ok: false; reason?: VerifyReason };

/** The server's refusal starts with this; the app's friendly text is OTP_GATE_MESSAGE. */
export const OTP_GATE_PREFIX = 'OTP_NOT_VERIFIED';
export const OTP_GATE_MESSAGE = "Session code not verified. Verify the member's 4-digit code from Today's Roster, then save again.";
export const OTP_GATE_SHORT = 'Session code not verified';
export const OTP_OFFLINE_MESSAGE = 'You are offline. The session code can only be verified online.';
export const OTP_NETWORK_MESSAGE = 'The code could not be verified. Check your connection and retry.';

/** True for the server's refusal (raw) and for the app's friendly copy of it. */
export const isOtpGateError = (e: unknown): boolean => {
  const msg = String((e as any)?.message ?? e ?? '');
  return msg.includes(OTP_GATE_PREFIX) || msg.startsWith(OTP_GATE_SHORT);
};

/** The sheet opens when the member's flag is on and the slot is not verified yet. Unknown flag = no step
    (the server still refuses an unverified log; the error path explains it). */
export const otpGateNeeded = (flag: boolean | undefined, status: OtpSlotStatus | undefined): boolean =>
  flag === true && status?.status !== 'verified';

/** Reason copy, mirrored from the web dialog word for word (no dashes). */
export const otpReasonText = (reason: VerifyReason | undefined | null): string => {
  switch (reason) {
    case 'invalid': return 'OTP not valid. Ask the member for the code again.';
    case 'cancelled': return 'This session is cancelled, so its code cannot be used.';
    case 'no_otp': return "No code exists for this session yet. Ask CRM to check the member's OTP setting.";
    case 'not_your_session': return 'This session belongs to another trainer.';
    case 'not_authenticated': return 'You are signed out. Sign in again and retry.';
    default: return 'The code could not be verified.';
  }
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
  `Ask ${clientName || 'the member'} for the 4-digit code CRM sent them. The workout opens once it is verified.` + (couple ? ' One code covers both partners today.' : '');
