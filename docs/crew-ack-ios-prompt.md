# iOS update prompt — My Crew: client ACKNOWLEDGED labels (24 Aug 2026)

Paste this to the iOS Claude. Small follow-up to the consolidated crew/roster
context doc — apply that one first. Backend is the shared Supabase; no SQL to
run from iOS.

## What it is

On the My Crew day-plan card, every LOGGED session row shows whether the
CLIENT has acknowledged that session:
- green `✓ ACKNOWLEDGED` when acknowledged
- gold/amber `NOT ACKNOWLEDGED` when not yet
- nothing on unlogged / missed / cancelled rows (nothing to acknowledge)

Visible to every viewer of the section (manager, HOD, the member). Source of
truth is `training_sessions.session_acknowledged_at` — the same field the
trainer Sessions page and the home Acknowledge Sessions card use, so all
surfaces agree.

## Data contract

The card's outcome reader RPC now returns the flag. `crew_plan_outcome`
(same call: `{ p_date: 'YYYY-MM-DD', p_clients: [uuids] }`) rows became:

```json
[ { "client_id": uuid, "trainer_id": uuid, "at": ISO, "acked": true|false } ]
```

- Build the outcome map exactly as before, keyed `"{trainerId}:{clientId}"`,
  but store BOTH the earliest completed time (green logged pill) and its
  `acked` flag.
- **Graceful degradation is required**: if `acked` is missing from a row
  (migration not yet applied server-side), treat it as unknown → render NO
  label. Never show "NOT ACKNOWLEDGED" just because the field is absent.
- Version/purge any persisted cache of the old outcome-map shape (Android
  bumped its query key for this).

## Rendering rules

1. Label renders only when the row is DONE (per the existing trainer-scoped
   done rule) AND the outcome map has a non-null `acked` for
   `"{sectionOwnerId}:{clientId}"`.
2. Placement: on the row's second/meta line (modality line), right-aligned
   next to the PROTOCOL chip — small mono caps, ~8pt equivalent.
3. Colors: acknowledged = the app's semantic green; not acknowledged = gold.
   Do not use red — unacknowledged is a nudge, not a failure state.
4. Rows that are done ONLY via the linked-schedule signal (no owner outcome
   row, rare) have no ack info → no label.

## Definition of done
1. A logged session whose client acknowledged it shows ✓ ACKNOWLEDGED in
   green on the crew card; an unacknowledged logged one shows NOT
   ACKNOWLEDGED in gold.
2. Upcoming/missed/cancelled rows show no ack label.
3. The label matches the trainer Sessions page's ack status for the same
   session.
4. With the flag absent from the RPC response, no labels render and nothing
   errors.
5. Cross-check one team's today card against Android: identical labels.
