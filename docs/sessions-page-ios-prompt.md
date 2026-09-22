# iOS update prompt — Trainer "Sessions" page changes (23 Aug 2026)

Paste this to the iOS Claude. Mirror these Android changes on the trainer
dashboard's Sessions page (the Training / Roster / Missed screen). Backend is
the shared Supabase — read-only queries, no SQL to run. Match behavior exactly.

---

## Context: what the page is

Trainer dashboard → Sessions. Three tabs over ONE month-scoped dataset:
- **Training** (default): the selected day's session list with statuses.
- **Roster**: month calendar grid (modality-colored dots per day) + selected
  day's compact list.
- **Missed**: month stats strip (miss rate / missed / scheduled) + missed list.

Data per month = two queries merged:
1. `session_schedule` rows for the trainer in the month's IST window
   (`id, scheduled_datetime, modality, session_type, status,
   workout_session_id, client_id`, + client name join).
2. Ad-hoc LOGGED `training_sessions` (workout_session_id not null, status !=
   'parked') in the same window — a session shows on the day it was LOGGED.
   Dedup: skip a training_sessions row only when its schedule slot
   (workout_session_id match) is on the SAME IST day; a late-logged old slot
   still appears on the log day while the old slot shows on its own day.

All dates/days are IST (Asia/Kolkata) calendar days.

## Change 1 — previous months reachable + a tap-to-open calendar picker

Old bugs to avoid: day arrows clamped inside the current month (from day 1 you
could never reach the previous month), and month navigation existed only
inside the Roster tab's grid.

Build:
1. **Header date is tappable** (add a small calendar icon next to it): tap
   toggles an inline month-calendar picker directly under the header — same
   grid as the Roster tab (weekday row, modality-colored dots under days,
   selected-day highlight, today outlined). It has month arrows (any past or
   future month) and tapping a date selects it and closes the picker.
2. **TODAY pill** in the grid header (shown whenever the selection isn't
   today): jumps back to the current month + today. Add it to the Roster
   tab's grid too.
3. **Day arrows cross month boundaries**: back from the 1st lands on the last
   day of the previous month; forward from the last day lands on the 1st of
   the next month (the month dataset reloads for the new month).
4. The picker shows on the Training and Missed tabs; the Roster tab keeps its
   own always-visible grid (hide the picker there — redundant). Because the
   Missed tab's stats are month-scoped, this gives it past-month review too.
5. Reuse ONE calendar grid component for both places.
6. Header label: `TODAY · N SESSIONS` when the selection is today, else
   `SELECTED · N SESSIONS`, with the full date underneath.

## Change 2 — past unlogged sessions show MISSED (was "Upcoming")

Per session row on the Training tab:
- `Cancelled` (red) when status == 'cancelled'
- `Logged` (green) when workout_session_id set OR status == 'completed'
- **`Missed` (red)** when neither of the above AND the session's datetime is
  in the past — the new state; previously these forever said "Upcoming"
- `Upcoming` (blue) only for genuinely future sessions

Details:
- The "past" comparison must use a SERVER-anchored clock (fetch any Supabase
  REST response's Date header once per session, keep the offset) — a device
  with a wrong clock must not mark today's future sessions missed.
- Day summary line: `✓ N logged · N missed · N upcoming` — missed in red and
  only shown when > 0; cancelled sessions are excluded from all three counts.
- The Missed TAB's list/stats already used this definition (past + unlogged +
  not cancelled/completed) — keep both consistent.

## Change 3 — per-session ACKNOWLEDGED status (client ack)

Every LOGGED session row gets a second small line under its status:
- green `✓ ACKNOWLEDGED` when the client acknowledged the session
- gold/amber `NOT ACKNOWLEDGED` when not yet
- nothing on unlogged/cancelled/missed rows (nothing to acknowledge)

Source of truth: `training_sessions.session_acknowledged_at` (timestamp,
non-null = acknowledged) — the SAME source the Today's Roster and the home
acknowledgement card use, so all surfaces agree.

Resolution for schedule rows (they don't carry the flag):
1. From the month's ad-hoc training_sessions query, build two lookup maps:
   `workout_session_id -> acked` and `schedule_session_id -> acked`.
2. A schedule row's ack = lookup by its `workout_session_id`, else by its own
   id via `schedule_session_id`, else unknown.
3. Sessions logged LATE in a DIFFERENT month miss those maps — backfill with
   one extra query: `training_sessions.select('workout_session_id,
   session_acknowledged_at').in('workout_session_id', [missing ids])`.
4. Ad-hoc logged rows use their own `session_acknowledged_at` directly.

## Definition of done
1. From any tab, tap the header date → calendar opens → jump to a date in a
   previous month → that month's data loads, sessions render.
2. Day arrows walk seamlessly across month boundaries in both directions.
3. A yesterday session that was never logged shows red "Missed", not
   "Upcoming"; the summary line shows the red missed count.
4. Logged sessions show ✓ ACKNOWLEDGED / NOT ACKNOWLEDGED matching the
   Acknowledge Sessions card's numbers for the same clients.
5. Cross-check one month against Android: same statuses, same counts.
