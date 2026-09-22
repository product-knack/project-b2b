# iOS handoff — Trainer "Today's Roster" session-log linking (stop the logged-also-pending duplicate)

Paste this whole doc to the iOS app's coding assistant. Goal: when a trainer logs a workout
from **Today's Roster**, the logged workout is reliably linked to its scheduled slot, so the
same session never shows as both a **pending** card and a separate **logged** card.

---

## 1. The problem
Today's Roster is built from two tables merged in the app:
- `session_schedule` (the scheduled slot) — renders as **pending** until its
  `workout_session_id` is set.
- `training_sessions` (the logged workout, created DB-side by an auto-create trigger) —
  renders as its own **logged** card unless it's recognized as belonging to a slot.

The link was written by the app as **two best-effort post-insert UPDATEs** that **raced the
auto-create trigger** and were **swallowed silently**. Measured live on Android: ~**20-27% of
recent logs** never got the back-link (`training_sessions.schedule_session_id` stayed NULL),
and when the whole post-insert step was interrupted (offline sync flap, app killed, late sync
on a different day) the slot stayed pending AND the log showed separately = the duplicate.

## 2. The DB side (shared backend — already exists, no DB work on iOS)
The web team shipped an RPC that does the whole link in ONE transaction:

```
public.link_workout_to_schedule(p_workout_session_id text, p_schedule_session_id uuid) RETURNS jsonb
```
- Part 1: direct link when the auto-created `training_sessions` row exists.
- Part 2: dedupe branch — if no row was created yet, attaches the pre-scheduled empty row by
  client + trainer + same IST day.
- Part 3: flips `session_schedule.workout_session_id`.
- **Idempotent** (re-running on an already-linked pair does zero writes).
- `EXECUTE` is granted to the `authenticated` role (a signed-in trainer can call it).
- Two fallback triggers reconcile anything missed server-side:
  `trg_autolink_training_session_to_schedule`, `trg_sync_session_schedule_workout_id`.

### Return shape (this drives the retry — get the key name right)
```json
{ "linked": true|false,
  "training_sessions_updated": int,
  "session_schedule_updated": int,
  "attached_existing": int }
```
**The single source of truth is `linked` (boolean)** — NOT `already_linked`. It is `true` on
both a fresh link and an idempotent re-run; `false` means the pair is not linked yet (the
auto-create row hasn't committed). (Verify against the live function; the key is `linked`.)

## 3. What the iOS app must do (mirror the shipped RN change)
Replace the two post-insert UPDATEs in the workout-log submit path with ONE call to the RPC,
wrapped so it is **non-throwing**, with a **single 500 ms retry** on `linked !== true`.

### Exact RN reference (from the shipped Android fix — `src/lib/clientQueries.ts`)
```ts
export type LinkOutcome = { status: 'skipped' | 'linked' | 'unresolved'; attempts: number };
const LINK_RETRY_MS = 500;

async function linkWorkoutToSchedule(workoutSessionId: string, scheduleSessionId: string): Promise<LinkOutcome> {
  const confirmLinked = async (): Promise<boolean> => {
    const { data, error } = await supabase.rpc('link_workout_to_schedule', {
      p_workout_session_id: workoutSessionId,   // TEXT param — pass the session id string
      p_schedule_session_id: scheduleSessionId, // UUID param — the roster slot id
    });
    if (error) throw new Error(error.message);
    return (data as any)?.linked === true;      // <-- key is `linked`
  };
  let attempts = 0;
  try {
    attempts = 1;
    if (await confirmLinked()) return { status: 'linked', attempts };
    // Not linked yet — the training_sessions row likely hasn't committed. One retry.
    await new Promise((r) => setTimeout(r, LINK_RETRY_MS));
    attempts = 2;
    if (await confirmLinked()) return { status: 'linked', attempts };
  } catch (e) {
    console.error('[schedule_link] RPC error', e);
  }
  // Unresolved after retry (or RPC error). Record for ops, fire-and-forget so it can never
  // throw or block, then leave it to the fallback trigger.
  console.error('[schedule_link] unresolved', { workoutSessionId, scheduleSessionId, attempts });
  void supabase.from('ops_alerts').insert({
    source: 'schedule_link',
    severity: 'warning',
    title: 'Roster link not completed',
    message: 'link_workout_to_schedule did not confirm a link after one retry',
    context: { workout_session_id: workoutSessionId, schedule_session_id: scheduleSessionId, attempts },
  }).then(() => {}, () => {});
  return { status: 'unresolved', attempts };
}
```
Call it in the submit fn, after the workout insert, replacing the old two UPDATEs:
```ts
let link: LinkOutcome = { status: 'skipped', attempts: 0 };
if (scheduleSessionId) link = await linkWorkoutToSchedule(sessionId, scheduleSessionId);
// ...keep RPE / partner-group updates...
return { sessionId, link };
```

## 4. Hard rules (these are what make it correct — do not skip)
1. **Non-throwing.** The workout insert already succeeded; a failed link must NEVER fail the
   log or mark it failed. Wrap ONLY the RPC + alert (not the workout insert). On Android the
   offline drainer `break`s the whole queue on a transient throw, so a throwing link would
   block every other queued item — keep it non-throwing.
2. **`ops_alerts` insert is fire-and-forget** — not awaited, both success/failure swallowed;
   a failed alert must not touch the log. It also only ever runs online (see #5).
3. **Retry once, only on `linked !== true`**, 500 ms. The happy path (and idempotent re-run)
   returns `linked: true` and does NOT retry, so there's no added latency there. 500 ms clears
   the create-trigger commit race; anything still missing is left to `trg_autolink`.
4. **Runs at drain/sync time incl. re-drain.** If iOS has a local-first outbox, the RPC must
   run when the item is drained (synced), NOT when it's queued, and MUST also run on a re-drain
   of an already-inserted-but-unlinked log (place the link call after the "already inserted"
   idempotency guard). The RPC's idempotency makes a re-run safe.
5. **Offline.** The slot id must ride the offline payload. When offline, the whole submit is
   deferred, so the RPC + alert never attempt until the next online drain — the item just stays
   queued and links then. Confirm this on iOS.
6. **Partner / second-client leg:** that leg has no slot → `scheduleSessionId` is null →
   `status: 'skipped'`, no RPC. Correct as-is.
7. **User-facing notice** on `status === 'unresolved'` — a non-blocking confirmation, NOT an
   error (the workout saved). Use exactly: **"Workout saved. Roster sync is still finishing,
   nothing needed from you."** (No em dashes in user copy.)

## 5. `ops_alerts` insert contract (confirmed live)
- Required columns: `source` (text), `severity` (text), `title` (text).
- `severity` CHECK allows at least `info` / `warning` / `error` — use **`warning`** (the miss
  self-heals via the trigger).
- Optional: `message` (text), `context` (**jsonb** — pass a JSON object).
- INSERT policy: any `authenticated` user with `source = 'schedule_link'` passes (trainers
  included). `id` / `delivered` / `created_at` are defaulted.

## 6. Swift / native analog (if the iOS app is not React Native)
Same shape via the Supabase Swift SDK:
- `try await supabase.rpc("link_workout_to_schedule", params: ["p_workout_session_id": .string(id), "p_schedule_session_id": .string(slotId)])`, decode the jsonb, read `linked`.
- Wrap in a non-throwing function (`do/catch`, return an outcome enum) so a failure never
  propagates to the log save.
- One retry after 500 ms (`try? await Task.sleep(nanoseconds: 500_000_000)`) when `linked` is
  false.
- Fire-and-forget the `ops_alerts` insert in a detached `Task { try? await ... }` so it can't
  block or throw into the save.
- If there's an offline queue, call the RPC in the sync/drain worker, not at enqueue.

## 7. How to verify
1. Log from Today's Roster (online) → the slot flips to **Logged**, exactly **one** card; in
   the DB `training_sessions.schedule_session_id` = the slot AND
   `session_schedule.workout_session_id` is set.
2. **Airplane mode** → log → re-enable network → after sync, both columns set, one card.
3. Kill the app right after saving → on relaunch/sync it still links (re-drain path).
4. No double `training_sessions` per log:
   `SELECT workout_session_id, count(*) FROM training_sessions WHERE scheduled_at >= now()-interval '2 days' GROUP BY 1 HAVING count(*)>1;` → expect 0 rows.
5. Partner second-leg log creates one logged card, no phantom pending twin.

## 8. Separate follow-up (do NOT bundle here)
The **RPE** write in the same submit path (`training_sessions.rpe`) has the *same* create-trigger
race and can silently drop RPE ~20-27% of the time. It has no RPC/trigger fallback yet. Fix it
separately (fold into the trigger/an RPC, or a similar retry).
