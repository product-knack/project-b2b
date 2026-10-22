# Handoff: the server refuses a second session of the same client, trainer and modality on one day (22 Oct 2026)

For the app session (Android, and the iOS repo after it). Nothing here is built yet. The server side is hub-track
migration `20261022100000_duplicate_session_same_day_guard.sql` (the owner runs it). Feature doc:
`docs/features/android/trainer/workout-log-sync.md` sections 5, 6, 8 and the change log.

## 1. What the server does now
- A new session is refused when the same client already has a non-cancelled session with the same trainer and the
  same modality on the same IST day (or within 2 hours, so two logs either side of midnight count as one day).
  "Strength", "strength" and "Strength Training" are the same modality.
- Exception: the new log lands on a different booked slot of that client and trainer, for that modality, with no
  session yet (a genuine second booking). The server works out the slot itself (the slot the log names, else the
  closest unlinked slot of that day), so the app does not need to send anything new.
- Admin, super admin, CRM and ops entries pass. Essentials clients keep their own one-a-day rule, which fires first.
- Where it fires: the `workout_exercises` insert of `submitWorkoutLog` (first row of a new workout, before any row
  lands), the doctor physio inserts (`doctorQueries.ts`, both `training_sessions` inserts), the therapist's
  `therapist_log_session` RPC, and any other insert into `training_sessions`.

## 2. The error
- SQLSTATE `23505`, message:
  `DUPLICATE_SESSION: Jasmeet already has a Strength session with this trainer on 15 Oct 2026, 10:16 AM IST.`
- It replaces the old 10-minute guard's "Duplicate session log detected within 10 minutes …" (that trigger is gone).
- `DUPLICATE_SLOT` (the slot guard of 15 Oct) still exists; a repeat log of an already-logged slot may now come back
  as either code, whichever trigger fires first. Treat both as "already logged".

## 3. App changes to make
1. `src/lib/clientQueries.ts`, `submitWorkoutLog`: next to the `DUPLICATE_SLOT` mapping, map `/DUPLICATE_SESSION/` to
   a new constant `DUPLICATE_SESSION_MESSAGE = 'This session is already logged. Delete this draft or contact your CRM.'`
   and throw it. Do the same in `doctorQueries.ts` (both inserts) and `therapistQueries.ts`.
2. A real rejection, never retried on its own: classify it BEFORE `isTransientError` in `offline.ts` (drain and
   `submitItem`). The server message carries the client's name, and a name could in theory contain one of the
   transient words the regex looks for (`socket`, `abort`, …). Simplest: in `isTransientError`, return false first
   when the message matches `/DUPLICATE_SESSION|DUPLICATE_SLOT/`.
3. Waiting to Sync card (`trainer.tsx`, the failed outbox line): show `DUPLICATE_SESSION_MESSAGE` for such items; the
   buttons stay Edit / Retry / Discard, and Discard is the expected action. Retry would fail again unless CRM
   cancelled the other session.
4. Workout form sync banner (`setSyncError`), physio sheet and therapy sheet: the same sentence.
5. Copy rules: no dashes; the sentence above is final (owner).
6. Rule test: add cases to `tests/rules/` for the mapping and for the transient check refusing to retry a
   `DUPLICATE_SESSION` message that contains the word "socket".

## 4. Web (hub-track), for whoever builds it
`useWorkoutFormSubmission.ts`: map `DUPLICATE_SESSION` to a toast "This session is already logged" with the server's
date and time in the description. The web saves online only, so there is no queue to handle.

## 5. Verify on a phone (after the migration)
- Online: log a Strength workout for a test client, then log another Strength workout for the same client the same
  day: the form shows the sentence, nothing is saved (`select count(*) from training_sessions where client_id = …`
  unchanged).
- Offline: airplane mode, log twice for the same client, back online: the first syncs, the second fails once with
  the sentence in Waiting to Sync and is not retried; Discard removes it.
- A second booked slot the same day: logging it passes.
