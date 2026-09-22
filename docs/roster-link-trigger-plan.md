# Plan: Persist the `session_schedule` ↔ `training_sessions` link (remove/replace the auto‑create trigger)

## Goal
Stop the "logged session also shows as pending" roster duplicate for good, by making the
link between a scheduled slot (`session_schedule`) and its logged workout
(`training_sessions`) **saved atomically at creation time** instead of by two best‑effort
`UPDATE`s that run after the fact.

## Why the duplicate happens today (recap)
- The app inserts only `workout_exercises`. A **DB trigger** on `workout_exercises` then
  auto‑creates the `training_sessions` row (`workout_session_id = session_id`) — but the
  trigger does **not** know which schedule slot it belongs to, so the link is empty.
- The app then patches the link with two guarded, non‑fatal writes
  ([clientQueries.ts:352‑359](../src/lib/clientQueries.ts#L352)):
  1. `training_sessions.schedule_session_id = scheduleSessionId`
  2. `session_schedule.workout_session_id = sessionId`  → flips the slot to "Logged"
- Both run **only when `scheduleSessionId` is passed**. On any ad‑hoc / non‑roster log path
  it is null, so neither link is written: the slot stays `pending` and the logged workout
  shows as its own row. Live scan found 13 such orphans in the last 7 days (12 with
  `schedule_session_id = NULL`).

---

## ⚠️ The one constraint that drives everything
**The trigger is shared by web AND native.** Both apps insert only `workout_exercises` and
rely on the trigger to create `training_sessions`. Therefore:
- You **cannot** just drop the trigger — web (and native, until it ships) would stop
  creating `training_sessions` at all, breaking rosters, stats, acknowledgements and QHP.
- If you add an RPC that inserts `training_sessions` **while the trigger still fires**, you
  get **two** `training_sessions` rows per log (one from the RPC, one from the trigger).

So the trigger and any explicit insert are **mutually exclusive**, and the cutover must be
coordinated. Two clean designs below — pick one.

---

## Step 0 (do this FIRST regardless of option): capture the current objects
Run in the Supabase SQL editor and **save the output** — you need the exact trigger body and
the `training_sessions` column defaults before changing anything.

```sql
-- 0a. Every trigger on workout_exercises + the function source
SELECT t.tgname, pg_get_triggerdef(t.oid) AS trigger_def, p.proname, pg_get_functiondef(p.oid) AS function_src
FROM pg_trigger t
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE t.tgrelid = 'public.workout_exercises'::regclass
  AND NOT t.tgisinternal;

-- 0b. training_sessions columns + defaults + not-null (so a manual insert matches the trigger)
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public' AND table_name='training_sessions'
ORDER BY ordinal_position;

-- 0c. Confirm the link columns exist and their types
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema='public'
  AND ((table_name='training_sessions' AND column_name='schedule_session_id')
    OR (table_name='session_schedule'  AND column_name='workout_session_id'));
```

---

## Option B — Keep the trigger, make it CARRY the link  ✅ Recommended
Lowest risk, no write‑path rewrite, works for both platforms with a one‑line additive change,
no double‑create window.

Idea: pass the schedule slot id **on the `workout_exercises` insert**, and let the existing
trigger copy it onto `training_sessions` and flip the slot — all in the same transaction.

**B1. DB — add a carrier column (additive, safe):**
```sql
ALTER TABLE public.workout_exercises
  ADD COLUMN IF NOT EXISTS schedule_session_id uuid REFERENCES public.session_schedule(id);
```

**B2. DB — edit the trigger function** (start from the 0a source; add the two links). The
function already creates `training_sessions`; add `schedule_session_id` to that insert and a
guarded slot update. Sketch:
```sql
-- inside the existing trigger fn, where it INSERTs training_sessions:
--   ... existing columns ...,
--   schedule_session_id = NEW.schedule_session_id      -- carry the link
-- and after creating/《ensuring》the training_sessions row:
IF NEW.schedule_session_id IS NOT NULL THEN
  UPDATE public.session_schedule
     SET workout_session_id = NEW.session_id
   WHERE id = NEW.schedule_session_id
     AND workout_session_id IS NULL;    -- never clobber an existing link
END IF;
```
Keep the trigger's existing "create once per session_id" guard so multiple exercise rows
don't create multiple `training_sessions`.

**B3. App (native) — write the id, drop the two post‑hoc updates.**
In `submitWorkoutLog` ([clientQueries.ts](../src/lib/clientQueries.ts)):
- Add `schedule_session_id: scheduleSessionId ?? null` to **every** row pushed into
  `workout_exercises`.
- Delete the `if (scheduleSessionId) { …354/357… }` block — the trigger now does it atomically.
- Keep the RPE / partner‑group updates (they key on `workout_session_id`, still fine).

**B4. App (web) — same one‑line change:** add `schedule_session_id` to the
`workout_exercises` insert in `useWorkoutSession` / `useWorkoutFormSubmission`. No other web
change needed; the trigger handles the rest.

**B5. Backfill existing orphans** (see the shared Backfill section below).

**B6. Rollback:** revert the trigger function to the 0a source; the extra column and the
app's `schedule_session_id` value are harmless if unused. No data loss.

> Net: the trigger stays, but the link is now saved at creation for both platforms. This
> satisfies "reliably save the linked id" without the coordinated‑cutover risk of removing
> the trigger.

---

## Option A — Remove the trigger, create `training_sessions` in one atomic RPC
Choose this only if you specifically want **no trigger**. It requires a coordinated cutover
because web + native both currently depend on the trigger.

**A1. Build the RPC** `log_workout_session(...)` (SECURITY DEFINER). In one transaction:
1. Auth/authorization check (trainer assigned to the client — mirror the RLS the tables use).
2. `INSERT training_sessions` first, with every column the old trigger set (from Step 0b)
   **plus** `schedule_session_id = p_schedule_session_id`.
3. `INSERT workout_exercises` rows (from a `jsonb` array param).
4. If `p_schedule_session_id` not null: `UPDATE session_schedule SET workout_session_id =
   p_session_id WHERE id = p_schedule_session_id AND workout_session_id IS NULL`.
Return `p_session_id`. Because `training_sessions` is created here, step 3's insert must NOT
re‑trigger a second creation — see A2.

**A2. Make the trigger idempotent BEFORE anything calls the RPC** (prevents double‑create
during rollout):
```sql
-- at the top of the trigger fn, bail if the row already exists:
IF EXISTS (SELECT 1 FROM public.training_sessions
            WHERE workout_session_id = NEW.session_id) THEN
  RETURN NEW;
END IF;
```

**A3. Ship order (must be this sequence):**
1. Deploy A2 (idempotent trigger) — safe, no behavior change.
2. Deploy the RPC (A1) — additive.
3. Migrate **native** `submitWorkoutLog` to call the RPC instead of insert+updates; ship.
4. Migrate **web** logging to the RPC; ship.
5. Only after BOTH are live and verified: `DROP TRIGGER <name> ON public.workout_exercises;`
   (optionally `DROP FUNCTION` too). Now `training_sessions` is created solely by the RPC.

**A4. Backfill** (shared section). **A5. Rollback:** re‑create the trigger from the 0a source
and revert the apps to the insert path; the RPC can stay dormant.

---

## Backfill existing orphans (both options)
Link already‑logged sessions whose slot is still stuck pending. **Conservative 1:1 only** —
skip client/trainer/days that have more than one pending slot or more than one orphan log
(review those by hand) so you never mis‑link a genuine second session.

```sql
WITH orphan AS (   -- logged sessions with no link
  SELECT id AS ts_id, client_id, trainer_id, workout_session_id,
         (scheduled_at AT TIME ZONE 'Asia/Kolkata')::date AS ist_day
  FROM public.training_sessions
  WHERE schedule_session_id IS NULL
    AND workout_session_id IS NOT NULL
    AND status = 'completed'
    AND scheduled_at >= now() - interval '30 days'
),
slot AS (          -- pending slots
  SELECT id AS slot_id, client_id, trainer_id,
         (scheduled_datetime AT TIME ZONE 'Asia/Kolkata')::date AS ist_day
  FROM public.session_schedule
  WHERE workout_session_id IS NULL
    AND status <> 'cancelled'
    AND scheduled_datetime >= now() - interval '30 days'
),
pair AS (
  SELECT o.ts_id, o.workout_session_id, s.slot_id, o.client_id, o.trainer_id, o.ist_day
  FROM orphan o
  JOIN slot s
    ON s.client_id = o.client_id AND s.trainer_id = o.trainer_id AND s.ist_day = o.ist_day
),
unique_pairs AS (  -- keep only client/trainer/day buckets with exactly one slot AND one log
  SELECT * FROM pair
  WHERE (client_id, trainer_id, ist_day) IN (
    SELECT client_id, trainer_id, ist_day FROM pair
    GROUP BY client_id, trainer_id, ist_day
    HAVING count(DISTINCT ts_id)=1 AND count(DISTINCT slot_id)=1
  )
)
-- 1) preview first (SELECT * FROM unique_pairs;) then run the two updates:
UPDATE public.training_sessions t
   SET schedule_session_id = u.slot_id
  FROM unique_pairs u WHERE t.id = u.ts_id;

UPDATE public.session_schedule s
   SET workout_session_id = u.workout_session_id
  FROM unique_pairs u WHERE s.id = u.slot_id AND s.workout_session_id IS NULL;
```

---

## Verification (after either option)
1. **No new orphans:** re‑run the orphan/pair query above for the last 3 days → expect ~0.
2. **Happy path, roster log:** log a session from Today's Roster → the slot flips to "Logged"
   and there is exactly **one** card. Check: `session_schedule.workout_session_id` set AND
   `training_sessions.schedule_session_id` = that slot.
3. **Exactly one `training_sessions` per log** (catches Option A double‑create):
   ```sql
   SELECT workout_session_id, count(*) FROM public.training_sessions
   WHERE scheduled_at >= now() - interval '2 days'
   GROUP BY 1 HAVING count(*) > 1;   -- expect 0 rows
   ```
4. **Ad‑hoc log (no slot):** logging a trial/ad‑hoc session creates one logged row, no phantom
   pending twin.
5. Native `tsc --noEmit` clean; live smoke as a trainer for an assigned client.

## Rollback summary
- Option B: revert trigger fn to the Step 0a source. Column + app value are inert.
- Option A: re‑create the original trigger from 0a; revert both apps to the insert path.

---

## Recommendation
Go with **Option B**. It reliably persists the link at creation for both platforms, needs no
coordinated multi‑app cutover, and carries zero double‑create risk. Only pick Option A if a
hard requirement is "no triggers on `workout_exercises`," and then follow the A3 order exactly.

**Decisions I need from you before generating the exact SQL/patches:**
1. Option B (keep+enhance trigger) or Option A (remove trigger + RPC)?
2. Paste the Step 0a/0b output (the real trigger name, body, and `training_sessions` columns)
   so the SQL is exact rather than templated.
3. Confirm the web app can ship the matching change (only strictly required for Option A).
