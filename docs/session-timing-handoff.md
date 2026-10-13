# Session timing from the workout timer (Android + iOS handoff, 2026-10-13)

Owner's request: "when a trainer, physio or therapist taps Add Workout from Today's Roster, the missing-health-data sheet opens; when they save it to start logging, a timer starts in the background; when they log the session, save the detail (duration, start, end, date) on the training_sessions row." The backend side is live once the owner runs the two migrations below; the app side is yours.

## Backend (hub-track, run by the owner in the SQL editor)
- `20261013100000_training_sessions_session_timing.sql`: new column `training_sessions.session_timing jsonb` (CHECK: null or an object). `duration_minutes` stays an **integer** (58 web files, ten edge functions, three RPCs, Plutus and the app read it as a number); the app writes the timer's minutes into it and the detail into the json.
- `20261013110000_therapist_log_session_timing.sql`: `therapist_log_session(p_client, p_duration, p_note, p_therapy_type, p_timing jsonb default null)`; when `p_timing` is given it is stored and `p_duration` may be null (the RPC takes `duration_minutes` from the json). The four-argument call keeps working.

## The json, exactly
```json
{
  "started_at": "2026-10-13T04:31:12.000Z",
  "ended_at": "2026-10-13T05:28:40.000Z",
  "date": "2026-10-13",
  "duration_minutes": 57,
  "source": "android",
  "role": "trainer",
  "schedule_id": "6f0c...-or-null",
  "app_version": "5.1 (34)"
}
```
- `started_at`: the moment the health check-in sheet's Save succeeds (the `saveHealthM.mutateAsync(payload)` in `Workout()` of `screens/trainer.tsx`, the gate that opens from Today's Roster). ISO UTC.
- `ended_at`: the moment the workout log is submitted (`submitWorkoutLog` in `lib/clientQueries.ts`), ISO UTC.
- `date`: the IST calendar day of `started_at` (`yyyy-MM-dd`).
- `duration_minutes`: `Math.max(1, Math.round((ended - started) / 60000))`.
- `source`: `"android"` or `"ios"`. `role`: the signed-in profile's role (`trainer`, `doctor` for physios, `therapist`). `schedule_id`: the roster slot's `session_schedule.id` when the log came from a slot, else null. `app_version`: `Application.nativeApplicationVersion (buildNumber)`, optional.

## Where to start the timer
1. In `Workout()`, right after the health check-in save resolves (the sheet closes and logging begins), write `{ started_at: new Date().toISOString(), schedule_id }` to AsyncStorage under `session-timer:{clientId}:{istDay}` (and keep it in a ref). Persisting it means a backgrounded or killed app still knows when the session started.
2. If the sheet is skipped because the data is already complete (no gate), start the timer at the moment the Workout screen is entered from the roster slot, so every roster log has a start. Record `"gate": "saved" | "skipped"` in the json if you want the distinction; the backend ignores extra keys.
3. Entering the Workout screen for a client who already has a timer for today (the trainer backed out and came back) keeps the existing start; it is not restarted.

## Where to stop it and write
- **Trainers and physios** (the Workout screen): `submitWorkoutLog` inserts `workout_sessions` and a trigger creates the `training_sessions` row; the app then updates that row by `workout_session_id` (it already does so for `rpe` and `partner_session_group_id`). Add `duration_minutes` and `session_timing` to that same update: `supabase.from('training_sessions').update({ duration_minutes, session_timing }).eq('workout_session_id', sessionId)`. Then clear the AsyncStorage key.
- **Therapists**: `lib/therapistQueries.ts` calls `rpc('therapist_log_session', { p_client, p_duration, p_note, p_therapy_type })`. Add `p_timing` with the same json; keep passing `p_duration` as the timer's minutes so an app on the old backend still works.
- **Offline outbox** (`lib/offline.ts`): the queued `submitWorkoutLog` payload must carry the json captured at submit time, not recomputed at drain time, so a late sync keeps the real duration. Put `sessionTiming` on `WorkoutLogInput` and pass it through.
- A partner (couple) leg logged from the same screen gets the same `started_at`; its `ended_at` is its own submit.

## What not to do
- Do not change `duration_minutes` to anything but an integer.
- Do not write `session_timing` from the roster's planned slot time: it is the measured timer, nothing else.
- No change to the health check-in writes (`submitHealthData`), the listen gate, or the roster adoption logic.

## Verify
```sql
select client_id, scheduled_at, duration_minutes, session_timing
  from training_sessions where session_timing is not null order by scheduled_at desc limit 10;
```
Expect `duration_minutes = session_timing->>'duration_minutes'` and `started_at < ended_at` on every row.

## Docs rule
Add the timing to `docs/features/android/trainer/session-voice-notes.md`'s sibling or a new `docs/features/android/trainer/session-timing.md` (sections 4, 5 and the change log) and a dated line in this file's web sibling `docs/features/web/trainer/todays-roster.md`.
