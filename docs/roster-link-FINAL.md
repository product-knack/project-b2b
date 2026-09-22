# FINAL plan — guarantee the `session_schedule` ↔ `training_sessions` link on every logged session

## What's actually broken (proven on live data, trainer Sagar)
Logging is **local‑first**: the payload (which **does** carry the slot id `scheduleSessionId`)
is written to the SQLite outbox, then drained by `submitWorkoutLog`. That function writes the
link with **two separate best‑effort `UPDATE`s AFTER the workout insert**, both wrapped in
swallow‑all `try/catch` ([clientQueries.ts:352‑359](../src/lib/clientQueries.ts#L352)):

1. `training_sessions.schedule_session_id = scheduleSessionId`  (the back‑link)
2. `session_schedule.workout_session_id  = sessionId`           (flips the slot to "Logged")

Evidence gathered live:
- The slot id **reaches the payload** from Today's Roster (the only log entry passes `r.id`
  at [trainer.tsx:2069/2086](../src/screens/trainer.tsx#L2069)) and **survives the offline
  outbox** (drainer calls `submitWorkoutLog(p)` with the full payload).
- A trainer **can** write both columns for their **own** rows (RLS is not the blocker).
- **But write #1 races the DB trigger.** The `training_sessions` row is created by a trigger
  on the `workout_exercises` insert; write #1 runs immediately after and matches by
  `workout_session_id`. When the trigger row isn't visible yet, it updates **0 rows** and the
  back‑link is silently lost. Measured on Sagar's logs:
  - last 3 d: **1 / 5 missing** · last 7 d: **3 / 11 missing** · last 21 d: **6 / 30 missing**
    (~20‑27% of *recent* logs have `schedule_session_id = NULL`), 379 / 438 NULL all‑time.
- Write #2 (slot flip) usually succeeds, which is why **most** logs don't visibly duplicate.
  The **visible duplicate** (slot stuck "pending" + a separate "Logged" card) happens when the
  whole post‑insert step is cut off — see the cases table.

**Root cause:** the link is stitched by two after‑the‑fact app writes, one of which races the
trigger and both of which are silently swallowed. The fix is to set the link **inside the
same transaction that creates `training_sessions`** — i.e. in the trigger — so it can never
race, never be half‑applied, and never be interrupted.

## Every case, and why it fails today

| # | Case | Today | After fix |
|---|------|-------|-----------|
| 1 | Online, single roster log | Link usually set; ~20‑27% miss the back‑link (write #1 races trigger) | Link always set (in‑txn) |
| 2 | **Offline → outbox → later sync** | Payload keeps the slot id; but on drain the same race applies, and a network flap **between** the insert and the two updates leaves both links unset → duplicate | Atomic at sync: insert carries the id, trigger links in one txn — nothing to interrupt |
| 3 | App killed / crash right after the insert | training_sessions exists, both link writes never ran → duplicate | Link already written by the trigger before the insert returns |
| 4 | Training‑partner 2nd leg | `scheduleSessionId` intentionally null → no link (correct: no slot) | Same (null id → trigger skips linking) |
| 5 | Editing a queued log | Slot id preserved via payload spread | Unchanged |
| 6 | Late sync lands on a different IST day than the slot | Slot flip by id still works, but with the back‑link missing the roster's day‑scoped de‑dupe can show the log on one day and the slot "pending" on another | Back‑link always present → de‑dupe matches regardless of day |

## The fix (single approach — do this)
Move the linkage into the trigger; the app just **passes the slot id on the insert** and
**stops doing the two post‑hoc updates**.

### Step 0 — capture the live objects first (SQL editor)
```sql
-- trigger + function source on workout_exercises
SELECT t.tgname, pg_get_triggerdef(t.oid), pg_get_functiondef(p.oid)
FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
WHERE t.tgrelid='public.workout_exercises'::regclass AND NOT t.tgisinternal;
-- confirm link columns
SELECT table_name, column_name FROM information_schema.columns
WHERE (table_name='training_sessions' AND column_name='schedule_session_id')
   OR (table_name='session_schedule'  AND column_name='workout_session_id');
```

### Step 1 — DB: carrier column (additive, safe)
```sql
ALTER TABLE public.workout_exercises
  ADD COLUMN IF NOT EXISTS schedule_session_id uuid REFERENCES public.session_schedule(id);
```

### Step 2 — DB: edit the trigger fn (start from the Step 0 source)
Inside the existing block that INSERTs `training_sessions`, add the back‑link and, right
after, flip the slot — all in the trigger's own transaction:
```sql
-- when building the training_sessions row, also set:
--    schedule_session_id => NEW.schedule_session_id
-- then:
IF NEW.schedule_session_id IS NOT NULL THEN
  UPDATE public.session_schedule
     SET workout_session_id = NEW.session_id
   WHERE id = NEW.schedule_session_id
     AND workout_session_id IS NULL;     -- never clobber an existing link
END IF;
```
Keep the trigger's existing "create training_sessions once per `session_id`" guard so the
per‑exercise rows don't create duplicates.

### Step 3 — App (native): pass the id, delete the two updates
In `submitWorkoutLog` ([clientQueries.ts](../src/lib/clientQueries.ts)):
- Add `schedule_session_id: scheduleSessionId ?? null` to **every** row pushed into the
  `workout_exercises` insert.
- **Delete** the whole `if (scheduleSessionId) { …354/357… }` block — the trigger does it now.
- Keep the RPE and `partner_session_group_id` updates (they key on `workout_session_id`).
No screen/store/outbox changes needed — the payload already carries `scheduleSessionId`.

### Step 4 — App (web): same one line
Add `schedule_session_id` to the `workout_exercises` insert in the web
`useWorkoutSession` / `useWorkoutFormSubmission`. The web uses the same trigger, so it is
fixed automatically and no double‑write cutover is required.

### Step 5 — Backfill existing orphans (conservative 1:1 only)
```sql
WITH orphan AS (
  SELECT id ts_id, client_id, trainer_id, workout_session_id,
         (scheduled_at AT TIME ZONE 'Asia/Kolkata')::date d
  FROM public.training_sessions
  WHERE schedule_session_id IS NULL AND workout_session_id IS NOT NULL
    AND status='completed' AND scheduled_at >= now()-interval '30 days'),
slot AS (
  SELECT id slot_id, client_id, trainer_id,
         (scheduled_datetime AT TIME ZONE 'Asia/Kolkata')::date d
  FROM public.session_schedule
  WHERE workout_session_id IS NULL AND status<>'cancelled'
    AND scheduled_datetime >= now()-interval '30 days'),
pair AS (
  SELECT o.ts_id,o.workout_session_id,s.slot_id,o.client_id,o.trainer_id,o.d
  FROM orphan o JOIN slot s
    ON s.client_id=o.client_id AND s.trainer_id=o.trainer_id AND s.d=o.d),
uniq AS (SELECT * FROM pair WHERE (client_id,trainer_id,d) IN (
  SELECT client_id,trainer_id,d FROM pair GROUP BY 1,2,3
  HAVING count(DISTINCT ts_id)=1 AND count(DISTINCT slot_id)=1))
-- preview: SELECT * FROM uniq;   then:
;UPDATE public.training_sessions t SET schedule_session_id=u.slot_id
   FROM uniq u WHERE t.id=u.ts_id;
UPDATE public.session_schedule s SET workout_session_id=u.workout_session_id
   FROM uniq u WHERE s.id=u.slot_id AND s.workout_session_id IS NULL;
```
Days with more than one pending slot or more than one orphan log are left for manual review
(so a genuine 2nd session is never mis‑linked).

## Verify
1. Log from Today's Roster (online) → slot flips to "Logged", exactly one card; check
   `training_sessions.schedule_session_id` = the slot AND `session_schedule.workout_session_id`
   set.
2. **Airplane mode** → log → re‑enable network → after sync, same two columns set, one card.
3. No double `training_sessions` per log:
   ```sql
   SELECT workout_session_id, count(*) FROM public.training_sessions
   WHERE scheduled_at >= now()-interval '2 days' GROUP BY 1 HAVING count(*)>1;  -- expect 0
   ```
4. Re‑run the back‑link temporal check → recent NULL rate ≈ 0%.
5. Native `tsc --noEmit` clean.

## Rollback
Revert the trigger fn to the Step 0 source; re‑add the two app updates. The carrier column
and the app's `schedule_session_id` value are inert if unused — no data loss.

## Why not the "remove trigger + RPC" route
Removing the trigger forces a coordinated web+native cutover and risks double‑creating
`training_sessions` during rollout. It buys nothing here: the trigger is exactly where the
link should be set (same transaction, definer privileges, no race). Keep it; make it carry
the link.

---
### What I need from you to produce the exact SQL/patch
Paste the Step 0 output (real trigger name + function body + the `training_sessions` insert it
performs). Then I'll return the precise `CREATE OR REPLACE FUNCTION`, the app diff, and run
the backfill/verification.
