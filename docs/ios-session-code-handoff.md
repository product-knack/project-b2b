# iOS handoff: the Session code system, end to end (state on 22 Oct 2026 evening)

For the iOS Expo repo (separate Claude session). Self-contained: what the feature is, every server contract, what
the Android app does screen by screen, which files to copy byte for byte, which files to edit, and how to verify.
It supersedes `session-otp-handoff.md` (13 Oct), `session-otp-trainer-context.md` (20 Oct) and
`ios-session-otp-offline-handoff.md` (21 Oct); those stay valid but this file is the current state.
Android commits (product-knack/project-b2b): "Session OTP trainer side" 20 Oct, "Session OTP offline" 21 Oct, and on
22 Oct: "Session OTP: copy for codes that expired 2 hours after the session", "Session code: refusal copy says
Session code, never OTP", "Paid cancellation code step before a paid cancellation". Feature docs:
`b2b/docs/features/web/crm/session-otp.md` (backend, canonical) and `b2b/docs/features/android/trainer/session-otp.md`.
Wording rule (owner, 22 Oct 2026): every label a person sees says **Session code**, never OTP. Identifiers
(`session_otps`, `clients.otp`, `OTP_NOT_VERIFIED`) stay.

## 1. The feature in one page

A member whose client card has **Session code** switched on (`clients.otp = true`, CRM / admin / ops only) gets, for
every scheduled session, **two 4-digit codes** on one `session_otps` row:

1. the **session code**: the trainer must verify it before Add Workout can be logged. The member receives it by push
   ("Your session code", live since 22 Oct 2026 evening; before that CRM handed codes out) and reads it in the member
   app; CRM sees it on the Roster Management calendar. The server refuses a trainer's, doctor's or therapist's log for
   such a member without a verified code (`OTP_NOT_VERIFIED`).
2. the **paid cancellation code** (22 Oct 2026): CRM reads it on Session Logs; a trainer, doctor or therapist marking
   a **paid** cancellation must verify it first, else the server refuses (`PAID_CANCEL_CODE_REQUIRED`). A standard
   cancellation needs no code.

Rules on the server (nothing to port, all live):
- **Validity (22 Oct)**: a session code works until **2 hours after the session ends** (a slot counts as 60 minutes:
  9 to 10 AM is valid till 12 PM). A code made after the session ended (late slot, renewal) gets 2 hours from when it
  was made. Expired pending codes of today's open sessions are replaced every 5 minutes (silent); a trainer who types
  an expired code triggers an immediate renewal + push, and gets `code_expired`. The old code stays in
  `code_history` with timestamps. **Verified codes never expire.**
- **Reschedule (22 Oct)**: a time change on an unlogged slot replaces BOTH codes, resets the row to pending (a verified
  but unlogged slot must be verified again), pushes the new session code to the member. The new session code is
  **hidden from CRM** (CRM cannot resend it; the member has it). The paid cancellation code stays visible to CRM.
- **Couples**: one session code per couple, trainer and IST day; one verification covers the partner's row; a second
  leg without its own slot logs against the partner's verified row.
- **Offline (21 Oct)**: the app never checks a code locally. A code typed with no network is queued with the time
  typed and verified at sync before the workout; it counts when it was the code in force at that time, on the
  session's IST day.
- The app never reads any code. It reads flags, statuses, and calls verify RPCs.

## 2. Server contracts the app uses (all live on project agtjszjedaenclbzgjvi)

| Call | Arguments | Returns | Notes |
|---|---|---|---|
| `clients` select `id, otp` | `.in('id', ids)` | the flag per client | RLS: the trainer's own clients |
| `get_my_session_otp_status(p_schedule_ids uuid[])` | the roster slot ids | rows `{schedule_session_id, status: pending/verified/cancelled, verified_at, couple, couple_group_id, verified_source, expires_at, expired}` | own slots only, never the code; `expired` = pending and past `expires_at` |
| `verify_session_otp(p_schedule_id, p_code, p_entered_at default null, p_source default 'online')` | online: 2 args; queue replay: `p_entered_at` = time typed, `p_source = 'offline_sync'` | `{ok:true, already_verified, verified_at, verified_count, source}` or `{ok:false, reason}` | reasons: `not_authenticated`, `no_otp`, `not_your_session`, `cancelled`, `invalid`, `expired` (offline: typed on another IST day), `code_expired` (the 2-hour rule; the server already renewed and pushed; `renewed` boolean) |
| `verify_paid_cancellation_code(p_schedule_id, p_code)` | | `{ok:true, already_verified?, verified_at}` or `{ok:false, reason}` | reasons: `not_authenticated`, `no_code`, `not_your_session`, `already_used`, `cancelled`, `invalid` |
| `get_client_crm_contact(p_client_id)` | | `{crm_id, name, phone, source}` or `null` | the client's latest active CRM (distribution row first, else the newest CRM assignment); `phone` may be null |
| `session_schedule` update (the existing cancel write) | `paid_cancellation: true` | | refused with `PAID_CANCEL_CODE_REQUIRED: ...` for a Session-code member without a verified paid code |
| `workout_exercises` insert (the existing log) | | | refused with `OTP_NOT_VERIFIED: ...` for a Session-code member without a verified session code; the queue surfaces `OTP_VERIFY_FAILED:<reason>` on a saved code the server refused |

## 3. Files to copy byte for byte (pure TypeScript, no native imports)

- `src/lib/sessionOtp.ts` (142 lines): types, every copy string, `otpGateNeeded`, `savedOtpCovers`,
  `verifyFailureReason`, `workoutOtpErrorText`, `parseVerifyAnswer`, `otpDigits`, `otpSheetBody`, `istDayOf`, and
  the 22 Oct additions: `code_expired` in `VerifyReason`, `OTP_CODE_EXPIRED_MESSAGE`, `OTP_CODE_EXPIRED_AT_SYNC_MESSAGE`,
  the "Session code" wording, the paid cancellation block (`CrmContact`, `PaidCancelReason`,
  `PAID_CANCEL_GATE_PREFIX`, `PAID_CANCEL_GATE_MESSAGE`, `PAID_CANCEL_INTRO`, `PAID_CANCEL_NOTICE`,
  `isPaidCancelGateError`, `askCrmLine`, `paidCancelReasonText`).
- `src/lib/sessionOtpQueries.ts` (137 lines): `useClientsOtpFlags`, `useMySessionOtpStatus`, `verifySessionOtp`,
  `useVerifySessionOtp`, `useClientCrmContact`, `verifyPaidCancellationCode`, `useVerifyPaidCancellationCode`,
  `saveSessionOtpOffline`, `submitSavedOtp`, `savedOtpsFrom`, `failedVerifyReasonFor`, `discardSavedOtps`. Needs the
  iOS copies of `./supabase`, `./withTimeout` (`withTimeout`, `NET_MS`) and `./offline` (`enqueueOutbox`,
  `removeOutboxItem`, `OutboxItem`).
- `tests/rules/session_otp_test.js` (74 lines, 53 checks). Run `node tests/rules/session_otp_test.js` after copying;
  `ROOT` resolves to the repo root, so it works unchanged in the iOS repo.
- `src/components/SessionOtpSheet.tsx` (150 lines) and `src/components/PaidCancelCodeStep.tsx` (119 lines) are React
  Native and copy as they are too; they import only `../theme`, `../icons` (`lock`, `phone`, `close`), `./primitives`
  (`Serif`, `Body`, `Mono`), `../lib/useKeyboardHeight`, `../lib/offline` (`useIsOnline`) and the two libs above.
  iOS: the sheet uses `keyboardWillShow` through `useKeyboardHeight`; keep `hitSlop` 10; one Modal at a time.

## 4. The queue (edit `src/lib/offline.ts`)

Same as the 21 Oct handoff, restated:
- kind union gains `'session-otp-verify'`; the payload is `SavedOtpPayload` (`scheduleId, clientId, coupleGroupId,
  day (IST YYYY-MM-DD of the roster day), enteredAt (ISO), code, clientName`).
- `flushSavedOtps()`: before ANY `workout-log` item is submitted (drain or single Retry), every pending
  `session-otp-verify` item of the signed-in user is replayed in order through `submitSavedOtp`. Success removes the
  item and invalidates `['session-otp-status']`. A server refusal (`{ok:false}` thrown as
  `OTP_VERIFY_FAILED:<reason>`) marks that item `failed` with the message and continues; a transient error (network,
  timeout) throws so the caller stops and retries later. Runs inside the drain lock.
- `processItem` for a bare `session-otp-verify` item calls `submitSavedOtp` directly.
- The Waiting to Sync list hides `session-otp-verify` items (`uiVisible`); `useOutboxAll()` exposes everything so the
  roster can read saved codes.

## 5. Screens

### 5a. Today's Roster (trainer: `Dashboard` in `trainer.tsx`; doctor and therapist: `DoctorTodayRoster` in `doctor.tsx`)
```ts
const otpFlagsQ = useClientsOtpFlags(rows.map((r) => r.client_id));
const otpStatusQ = useMySessionOtpStatus(rows.map((r) => r.id));
const outboxAll = useOutboxAll();
const savedOtps = React.useMemo(() => savedOtpsFrom(outboxAll), [outboxAll]);
const rosterDayIst = istDayOf(Date.now() + rosterDay * 864e5);   // today's IST day on the doctor roster
const [otpFor, setOtpFor] = React.useState<{ scheduleId; clientId; clientName; couple; coupleGroupId; proceed } | null>(null);
const withOtpGate = (clientId, scheduleId, clientName, proceed) => {
  const st = otpStatusQ.data?.[scheduleId];
  if (otpGateNeeded(otpFlagsQ.data?.[clientId], st, savedOtpCovers(savedOtps, scheduleId, st, rosterDayIst))) {
    setOtpFor({ scheduleId, clientId, clientName, couple: st?.couple === true, coupleGroupId: st?.coupleGroupId ?? null, proceed });
  } else proceed();
};
const saveOtpOffline = (code) => { const f = otpFor; if (!f) return; setOtpFor(null);
  void saveSessionOtpOffline({ scheduleId: f.scheduleId, clientId: f.clientId, coupleGroupId: f.coupleGroupId, day: rosterDayIst, enteredAt: new Date().toISOString(), code, clientName: f.clientName }).then(() => f.proceed()); };
```
- Every Log Workout / Log Session / physio sheet entry on a roster card goes through `withOtpGate(...)`; the gate
  opens when the flag is on, the slot is not `verified` on the server, and no saved code covers it (its own slot, or
  the partner's slot of the same couple on the same IST day).
- Mount once per screen, next to the other sheets: `<SessionOtpSheet visible={!!otpFor} scheduleId clientName couple
  onClose={() => setOtpFor(null)} onVerified={() => { const p = otpFor?.proceed; setOtpFor(null); p?.(); }}
  onSave={saveOtpOffline} />` (the doctor roster wraps `p()` in a 250 ms timeout so the next Modal opens after this one
  closed; iOS needs that everywhere, stacked Modals wedge the presentation stack).
- The sheet: title **Session code**, body `otpSheetBody(clientName, couple)` ("Ask NAME for the 4-digit code CRM sent
  them. The workout opens once it is verified. One code covers both partners today. A code works until 2 hours after
  the session."), four boxes from one hidden number input, auto-submit on the 4th digit online. `{ok:true}` →
  `onVerified`; `{ok:false}` → `otpReasonText(reason)` inline and the boxes clear (`code_expired` reads "This code
  has expired. A code works until 2 hours after the session, and the member has been sent a new one. Ask them for
  it."). Offline, or after a call that never reached the server: the gold line `OTP_OFFLINE_MESSAGE` /
  `OTP_NETWORK_MESSAGE`, the button reads **Save code**, `onSave(code)`. No code is ever displayed.

### 5b. The workout form and Waiting to Sync (`trainer.tsx`)
- A log the server refused on the gate: `isOtpGateError(res.error)` → the banner reads
  `workoutOtpErrorText(failedVerifyReasonFor(outboxAll, workoutScheduleId))`: the saved code's own failure when there
  was one (`invalid` → "The code was wrong. Ask the member for the code again, then Retry."; `expired` → the
  other-day text; `code_expired` → "The code had already expired when it was typed. The member has been sent a new
  code. Verify it now, then Retry."), else `OTP_GATE_MESSAGE` ("Session code not verified. Verify the member's 4-digit
  code from Today's Roster, then save again."). The log is never dropped from the queue.
- Waiting to Sync card of a queued workout whose slot has a saved code: the gold line `OTP_SAVED_HINT`. Its **Retry
  now** on a gate-refused log opens the session code sheet for that slot first; `proceed` runs
  `discardSavedOtps(outboxAll, scheduleId)` then `submitItem(id)` (a refused saved code is dropped once a new one is
  verified or saved).
- The physio sheet and the therapist sheet show the same gate copy when their insert / RPC is refused.

### 5c. The cancel flows (paid cancellation code, 22 Oct 2026)
Two places share one component: the trainer roster card's inline cancel picker (`RosterCard` in `trainer.tsx`,
state `pickerOpen` / `paidStep`) and the shared `CancelSessionFlow` (`src/components/cancelSessionFlow.tsx`, used by
the doctor roster and the HOD roster; the therapist dashboard reuses the doctor roster). `CancelSessionRow` gained
`client_id?: string | null`; every caller passes it.
- The picker's **Paid Cancellation** branch renders `<PaidCancelCodeStep clientId scheduleId clientName
  onBack={() => back to the picker} onContinue={() => { setPaid(true); open the remark form; }} />` instead of the old
  "Paid Cancellation?" confirm. The step reads the member's flag itself (`useClientsOtpFlags([clientId])`):
  - flag off (or no client id): it renders the OLD confirm (title "Paid Cancellation?", "This marks the session as a
    last-moment paid cancellation and raises a claim that goes to admin for approval. Continue?", Back / Yes,
    continue), so nothing changes for those members;
  - flag on: title **Paid cancellation code**, `PAID_CANCEL_INTRO(clientName)` ("If you want a paid cancellation for
    NAME, get the 4-digit paid cancellation code from CRM first. CRM sees it on Session Logs."), an **ASK CRM** box
    with `askCrmLine(contact)` from `useClientCrmContact(clientId)` ("Ask Priya Sharma (98765 43210)", "(no number on
    file)", or "This member has no CRM assigned. Ask the admin for the code.") and a **Call** button
    (`Linking.openURL('tel:...')`) when a number exists, `PAID_CANCEL_NOTICE`, four boxes, Back / **Verify and
    continue** (`useVerifyPaidCancellationCode`; `{ok:false}` → `paidCancelReasonText(reason)` and the boxes clear).
- The cancel write (`useCancelScheduledSession` in `trainerQueries.ts`) maps the server refusal:
  `if (error) throw new Error(isPaidCancelGateError(error.message) ? PAID_CANCEL_GATE_MESSAGE : error.message)`.
- Online only (the cancel itself already is).

### 5d. Nothing else changes in the app
The hidden-from-CRM rule, the 2-hour renewal, the member push and the Session Logs badge are server and web only.

## 6. Verify on an iPhone
Use a member with Session code on (CRM client page switch; live on 22 Oct: 3 members). CRM reads both codes: the
session code on Roster Management, the paid cancellation code on Session Logs (click the amber badge).
1. Today's Roster > Log Workout on that member: the **Session code** sheet; a wrong code reads "Session code not valid.
   Ask the member for the code again."; the right code opens the form; the slot reads verified on reopen.
2. Airplane mode on another slot: the gold offline line, **Save code**, the form opens; save the log; Waiting to Sync
   shows "Session code saved on this phone, checked when back online."; online again, both sync in order.
3. A code older than 2 hours after the session: "This code has expired... the member has been sent a new one"; the
   member's phone gets the push; the new code works.
4. Cancel > Paid Cancellation on that member: the paid cancellation code step with "Ask <CRM> (<number>)"; the session
   code typed there reads "Paid cancellation code not valid."; the paid code from Session Logs passes, the remark form
   opens, Confirm saves; the Session Logs badge turns green VERIFIED. Cancel > Cancel Session needs no code. A member
   with the flag off still sees the old "Paid Cancellation?" confirm.
5. `node tests/rules/session_otp_test.js`: 53 checks, ALL PASS.
