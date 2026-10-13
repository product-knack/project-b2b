# Paste-ready prompt: session timer from the health check-in to the log (Android, 2026-10-13)

Paste everything below this line into the odds-app session.

---

Build the session timer end to end in `C:\Users\ADMIN\Desktop\b2b\odds-app`. Read `docs/session-timing-handoff.md` first; this prompt is the step list. The backend is already live: `training_sessions.session_timing jsonb` (migration `20261013100000`) and `therapist_log_session(p_client, p_duration, p_note, p_therapy_type, p_timing jsonb default null)` (migration `20261013110000`). Do NOT change `duration_minutes`'s type: it stays an integer and receives the timer's minutes.

## 1. One pure helper: `src/lib/sessionTiming.ts`
```ts
export type SessionTiming = {
  started_at: string;   // ISO UTC
  ended_at: string;     // ISO UTC
  date: string;         // IST yyyy-MM-dd of started_at
  duration_minutes: number; // Math.max(1, Math.round((ended - started) / 60000))
  source: 'android' | 'ios';
  role: string;         // profile.role: trainer | doctor | therapist
  schedule_id: string | null;
  app_version: string | null;
  gate: 'saved' | 'skipped';
};
export const TIMER_KEY = (clientId: string, istDay: string) => `session-timer:${clientId}:${istDay}`;
export const istDayOf = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
export const startTimer = async (clientId: string, scheduleId: string | null, gate: 'saved' | 'skipped') => { /* AsyncStorage: keep an existing start for the same client + IST day, else write { started_at: new Date().toISOString(), schedule_id, gate } */ };
export const readTimer = async (clientId: string) => { /* today's entry or null */ };
export const finishTimer = async (clientId: string, role: string): Promise<{ timing: SessionTiming; minutes: number } | null> => { /* read, build the json with ended_at = now, duration_minutes as above, source from Platform.OS, app_version from expo-application; return null when no start exists; do NOT clear yet */ };
export const clearTimer = async (clientId: string) => { /* remove the key */ };
```
Write `src/lib/__tests__/sessionTiming.test.ts` (or the repo's existing offline-test pattern): 60 s rounds to 1, 90 s to 2, 25 s to 1 (never 0), `date` is the IST day across midnight UTC, an existing start is kept by `startTimer`.

## 2. Start the timer in `Workout()` (`src/screens/trainer.tsx`, the screen opened from Today's Roster)
- After `await saveHealthM.mutateAsync(payload); closeHealthSheet();` call `startTimer(selectedClientId, workoutScheduleId ?? null, 'saved')`. Do the same in the two offline branches that call `setOfflineHealth(payload); closeHealthSheet();`.
- When the screen is entered from a roster slot and the health gate does not open because the data is complete, call `startTimer(selectedClientId, workoutScheduleId ?? null, 'skipped')` once on entry (the effect keyed on `selectedClientId, workoutScheduleId`). Ad-hoc / trial logs (no `workoutScheduleId`) also start a timer on entry with `schedule_id: null`.
- Backing out and returning keeps the existing start (that is what `startTimer` guarantees). Switching to the partner's leg (the `set({ selectedClientId: next.id, ... })` around line 6990) starts the partner's own timer with the same `started_at` as the first leg: pass it through `startTimer` with an optional `startedAt` argument.

## 3. Stop it on submit
- In the submit block that builds the `WorkoutLogInput` (around line 7065: `scheduleSessionId: workoutScheduleId, sessionId: uuidv4(), sessionDate: ...`), call `const t = await finishTimer(selectedClientId, profile.role)` and add `sessionTiming: t?.timing ?? null` to the input. On a successful submit (online, or when the item is queued offline) call `clearTimer(selectedClientId)`.
- `src/lib/clientQueries.ts`: add `sessionTiming?: SessionTiming | null` to `WorkoutLogInput`. In `submitWorkoutLog`, in the post-insert steps after the RPE update (step 2), add: `if (sessionTiming) await supabase.from('training_sessions').update({ duration_minutes: sessionTiming.duration_minutes, session_timing: sessionTiming }).eq('workout_session_id', sessionId);` Non-fatal like the RPE update. Keep it idempotent: the same payload on a retry writes the same values.
- `src/lib/offline.ts`: the `workout-log` outbox payload carries `sessionTiming` as captured at submit time; the drainer passes it through unchanged (never recompute at drain time).

## 4. Therapists (`src/lib/therapistQueries.ts`, the `therapist_log_session` call around line 188)
- The therapist sheet has no health gate: start the timer when the sheet opens for a client (`startTimer(clientId, scheduleId ?? null, 'skipped')`).
- On submit: `const t = await finishTimer(clientId, 'therapist')`; pass `p_timing: t?.timing ?? null` and keep `p_duration` as before (the timer's minutes when a timer exists, else the typed duration), then `clearTimer`.

## 5. Physios (`src/screens/doctor.tsx` + `doctorSessions.tsx`, `submitPhysioSession` in `src/lib/doctorQueries.ts`)
- A workout-modality slot already opens the trainer's `Workout()` (`openWorkout(...)` near line 467): covered by steps 2 and 3.
- Other slots open `PhysioSessionSheet`: start the timer when the sheet opens from the roster (`'skipped'`), finish it in `submitPhysioSession` and write `duration_minutes` + `session_timing` on the `training_sessions` row it inserts (same values as step 3).

## 6. Types and parity
- Add `session_timing: Json | null` to the `training_sessions` Row / Insert / Update in `src/integrations/supabase/types.ts` (hand-added, as other columns were).
- iOS: same code, `source: 'ios'`; nothing platform-specific beyond `Platform.OS`.

## 7. Verify
- Log a session from Today's Roster after saving the health sheet, wait a minute, then in the SQL editor: `select scheduled_at, duration_minutes, session_timing from training_sessions where session_timing is not null order by scheduled_at desc limit 5;` Expect `duration_minutes = session_timing->>'duration_minutes'`, `started_at < ended_at`, `gate = 'saved'`.
- Repeat with a client whose data was complete (no sheet): `gate = 'skipped'`.
- Log offline, bring the device back online: the drained row keeps the original `started_at` / `ended_at`.
- A therapist log shows the json through the RPC; a physio sheet log shows it through the insert.

## 8. Docs (mandatory)
Create `C:\Users\ADMIN\Desktop\b2b\docs\features\android\trainer\session-timing.md` from `docs/features/_template.md` (sections 4, 5, 6 with the json, the start and stop points per role, the offline rule) and add its line to `docs/features/README.md`. Add a dated line to `docs/features/web/trainer/todays-roster.md`'s change log saying the app now writes the column. Copy nothing else; the web does not set the column.
