# iOS update prompt — My Crew "Add Session" replace rule (24 Aug 2026, part 2)

Paste this to the iOS Claude. It is a follow-up to the earlier
"crew updates of 24 Aug" prompt (trainer-scoped outcome, crew_sched_rows /
crew_plan_outcome RPCs, plan-share replace rule, protocol v2) — apply that one
first if it hasn't been. The backend change below is ALREADY LIVE on the shared
Supabase; this is a client-behavior/expectations update only. No SQL to run.

## What changed server-side (RPC `plan_manager_add_session` — same signature)

The manager/HOD "Add Session" flow now follows the same replace philosophy as
plan sharing. Old behavior refused with `result: 'exists'` when the member had
ANY non-cancelled session with that client that day — including stale legacy
rows that are not on the plan card (dead-end advice), and already-logged
morning sessions (blocking a legitimate second session). New behavior:

1. A CREW-created session already exists for member+client+day
   → `{ result: 'exists' }` (unchanged). This is now the ONLY case that
   returns 'exists', and that session IS on the plan card — so the alert copy
   "already has a session with this member that day, use RESCHEDULE on the
   plan card" is now always accurate. Keep it.
2. Stale NON-crew UNLOGGED session(s) that day → silently DELETED server-side,
   and the new session is created: `{ result: 'created', schedule_id: uuid,
   replaced_prev: <int> }`. No client handling needed beyond the normal
   success path; `replaced_prev` may be > 0 — tolerate/ignore the extra key.
3. An already-LOGGED/completed session that day no longer blocks: it is kept
   as history and the new session is created alongside (same-day second
   session — e.g. client trained at 9 AM, manager adds a 6 PM session).
4. `{ result: 'conflict' }` unchanged: exact-datetime collision with ANOTHER
   member's session. Keep the existing "not added" alert.

## iOS changes to make

- Ensure the Add Session client picker does NOT pre-block clients merely
  because they have some roster session that day. The only locked clients are
  those already in that member's plan card for the date (plan entries +
  manager adds) — same rule as before. If any extra "already has a session"
  pre-check was added client-side, remove it: the RPC is the authority now.
- Handle `result: 'created'` with a non-zero `replaced_prev` exactly like a
  plain create (optionally you may show a subtle note that a stale booking was
  replaced — Android does not).
- Do not treat unknown extra keys in the RPC response as errors.

## Context (no action): conflict backfill already ran
Old plan entries stored as `roster: 'conflict'` with `schedule_id: null` (from
before the replace rule) were repaired server-side: blocking stale sessions
deleted or already-logged ones adopted, crew rows created, and the MESSAGE
PAYLOADS patched in place to `roster: 'created'` + real `schedule_id`. iOS just
re-reads the messages — verify conflict badges disappeared from today's cards
and adopted entries show LOGGED via the crew_sched_rows / crew_plan_outcome
readers.

## Definition of done
1. Manager adds a session for a client who already TRAINED with that member
   this morning (logged row) → succeeds, both sessions visible, logged state
   intact on the morning one.
2. Manager adds a session for a client with a stale unlogged legacy booking
   that day → succeeds; the stale booking is gone from the roster.
3. Adding for a client already on that member's plan card → still refused with
   the "use RESCHEDULE" alert.
4. Cross-check with Android on the same team: identical results.
