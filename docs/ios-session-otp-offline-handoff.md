# iOS handoff: Session OTP offline verification (21 Oct 2026)

For the iOS Expo repo. The Android app (`product-knack/project-b2b`, commit "Session OTP offline" of 21 Oct 2026) lets a trainer type the member's 4-digit code with no network; the code waits in the offline queue and is verified by the server before the queued workout is inserted. Owner decisions: trust now and verify at sync; a code typed offline counts only on the session's IST day; the typed code sits in the normal offline queue. Feature doc: `docs/features/android/trainer/session-otp.md` (sections 3, 4, 5, 6, 8).

## Files, byte for byte (pure TypeScript)
- `src/lib/sessionOtp.ts` (replace): `SavedOtp`, `otpGateNeeded(flag, status, savedLocally)`, `savedOtpCovers`, `verifyFailureReason`, `workoutOtpErrorText`, `istDayOf`, the new copy constants, the `expired` reason.
- `src/lib/sessionOtpQueries.ts` (replace): `verifySessionOtp(scheduleId, code, offline?)`, `saveSessionOtpOffline`, `submitSavedOtp`, `savedOtpsFrom`, `failedVerifyReasonFor`, `discardSavedOtps`; the status rows carry `coupleGroupId`.
- `tests/rules/session_otp_test.js` (replace, 40 checks).

## Edits
- `src/lib/offline.ts`: kind union gains `'session-otp-verify'`; `flushSavedOtps()` (verifies every pending saved code, in order, before any workout log; a refusal marks that item failed, a connection failure throws); `processItem` gets the `session-otp-verify` branch and calls `flushSavedOtps()` first thing in the `workout-log` branch; `uiVisible` hides the kind; new hook `useOutboxAll()` (every item of the user, hidden kinds included).
- `src/components/SessionOtpSheet.tsx` (replace): `onSave?(code)` prop; save mode when offline or after a call that never reached the server; the button reads Save code; no auto-submit in save mode.
- `src/screens/trainer.tsx` and `src/screens/doctor.tsx`: `useOutboxAll()` + `savedOtpsFrom`, the roster day in IST (`istDayOf(Date.now() + rosterDay * 864e5)` / today), `otpFor` state gains `clientId` and `coupleGroupId`, the gate passes `savedOtpCovers(...)`, `saveOtpOffline(code)` enqueues then proceeds, the sheet gets `onSave`. Trainer only: the Waiting to Sync card shows `OTP_SAVED_HINT` for a queued workout with a saved code and `workoutOtpErrorText(failedVerifyReasonFor(...))` on a gate failure; Retry's `proceed` runs `discardSavedOtps` before `submitItem`; the workout form's sync error uses the same text.

## Server (done, nothing to port)
Migration `20261021150000_session_otp_offline.sql` in hub-track. The queue replay sends `p_entered_at` and `p_source = 'offline_sync'`; it needs that migration live.

## Verify on an iPhone
Airplane mode, Log Workout on an OTP member: the sheet shows the gold offline line and Save code; the form opens; save the log; Waiting to Sync shows the saved hint; back online both sync and `session_otps.verified_source = 'offline_sync'`. Wrong code offline: back online the log stays with "The code was wrong…", Retry opens the sheet.
