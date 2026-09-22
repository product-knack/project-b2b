# My Crew ↔ roster sync — CONSOLIDATED iOS context (24 Aug 2026, final)

Paste this whole file to the iOS Claude. It consolidates and SUPERSEDES the two
earlier prompts from today ("crew updates" and "add session replace rule") —
apply this one document and the iOS app will match Android exactly.

All backend pieces are ALREADY LIVE on the shared Supabase (`agtjszjedaenclbzgjvi`).
Build client-side only. Both apps read each other's data — payload shapes and
RPC contracts below are exact and must not be altered.

---

## A. The core principle that changed

**The crew day plan is now the source of truth for a member's roster day.**
Sharing a plan or manager-adding a session actively reconciles the real
`session_schedule` table: stale bookings get replaced, already-done sessions
get adopted, and the card always reflects live roster state (not frozen
message payloads). All rules are scoped to ONE member + ONE client + ONE IST
day — another member's sessions with the same client are never touched (a
client can legitimately have a trainer session AND a doctor session the same
day).

## B. Reading card state — two definer RPCs (REQUIRED)

Direct selects on `session_schedule` / `training_sessions` are RLS-scoped to
the caller's own clients: a manager viewing a teammate's section gets ZERO
rows and everything looks pending/missed. The card must read through these
RPCs (guarded to team participants + physio HOD; surface errors, never render
silently-wrong data):

1. `rpc('crew_sched_rows', { p_ids: [schedule uuids] })` → object keyed by id:
   `{ "<id>": { scheduled_datetime: ISO, modality, status, logged: bool,
                missed_remarks: [{at, by, by_name, by_role, category, remark}] | null } }`
   Drives: live row time (IST), modality, cancelled state, the strongest
   "done" signal (`logged`), and the LAST missed-remark for display.
2. `rpc('crew_plan_outcome', { p_date: 'YYYY-MM-DD', p_clients: [uuids] })` →
   `[ { client_id, trainer_id, at: ISO } ]` — completed, non-cancelled
   sessions on that IST date for those clients.

**Done-state rule (trainer-scoped, per entry):**
- DONE if the entry's linked schedule row has `logged == true`, OR
- the outcome array has a row whose `trainer_id` equals the SECTION OWNER and
  `client_id` equals the entry's client (earliest `at` that day feeds the
  green logged-time pill).
- Another member's log NEVER marks this member's row done.
Apply to: row ticks, logged pills, LOGGED/MISSED tiles, section progress,
awaiting-remark counts. Keep the outcome map keyed `"{trainerId}:{clientId}"`.
Version/purge any persisted caches from older client-keyed shapes.

## C. Writing — plan share (`plan_sync_roster`, unchanged signature)

`rpc('plan_sync_roster', { p_score, p_date, p_entries: [{client_id, time:'HH:mm', modality}] })`
returns per entry: `{ client_id, schedule_id, result, replaced_prev }`.

Server decision order per entry (member+client+IST day):
1. Stale NON-crew UNLOGGED session(s) → deleted server-side
   (`replaced_prev` = count). Never deleted: logged/completed, cancelled,
   other members' rows.
2. A crew row this feature created earlier → updated in place →
   result `updated` (same time) or `moved` (time changed).
3. An already-LOGGED/completed non-crew session exists → **`adopted`**: its
   real id comes back as `schedule_id`, nothing is created or modified. The
   card will show that session's real time + LOGGED state via crew_sched_rows.
4. Else insert → `created`; unique-datetime collision with ANOTHER member →
   `conflict` (schedule_id null).

iOS handling: store `schedule_id` + `result` into the tomorrow_plan payload
entry as `schedule_id` / `roster` (exact keys, interop-critical). Treat
`adopted` like `created` everywhere in UI logic; only `conflict` gets the red
"ROSTER CONFLICT · NOT BOOKED" tag and the (new-conflicts-only) alert.
Tolerate the extra `replaced_prev` key.

## D. Writing — manager/HOD Add Session (`plan_manager_add_session`)

Same args as before. Returns `{ schedule_id, result, replaced_prev? }`:
- `exists` — ONLY when a crew row is already on the card for that
  member+client+day. Alert "already has a session with this member that day,
  use RESCHEDULE on the plan card" (now always accurate). Do NOT pre-block
  clients client-side for having unrelated roster sessions — the RPC is the
  authority; the picker locks only clients already on that member's card
  (plan entries + adds).
- `adopted` — the client already TRAINED with that member that day (logged
  session); its id is returned. Proceed exactly like a successful create:
  post the `plan_add` message with that `schedule_id` — the card shows the
  done session with its real time and LOGGED state. Nothing was created.
- `created` — normal path; stale unlogged bookings may have been silently
  replaced (`replaced_prev` > 0) — no special UI needed.
- `conflict` — exact-datetime collision with another member; "not added" alert.

## E. Weekly Protocol v2 (PROTOCOL chip + popup)

`clients.weekly_protocol` (jsonb, sometimes a JSON string — parse both):
```json
{ "entries": [
    { "days": ["Thu","Sun"], "modality": "Strength", "frequency": "weekly",
      "trainer_id": "...", "trainer_name": "...", "sessions_per_week": 2 },
    { "days": [], "modality": "Recovery", "frequency": "monthly",
      "trainer_id": "...", "trainer_name": "...", "monthly_session_count": 4 }
  ],
  "total_per_week": 7, "total_per_month": 4 }
```
- Entry count = monthly ? (`monthly_session_count` ?? `sessions_per_week`) :
  `sessions_per_week` (a transitional shape stored monthly counts in
  sessions_per_week — support both). Filter entries with count 0 — but NEVER
  filter on `sessions_per_week > 0` alone (that silently dropped monthly
  entries; live bug).
- Missing `frequency` = weekly. Monthly exists only for doctor-led
  Rehab/Recovery.
- Modalities: Strength, Yoga, Boxing, Pilates, Aerobics, Aqua Aerobics,
  Rehab, Recovery. Legacy `"Rehab / Recovery"` DISPLAYS as `Rehab`
  (everywhere, including team-flags cards).
- Popup entry: `<modality> · <n>x/week|month` + WEEKLY/MONTHLY badge
  (monthly = purple). Monthly shows "Any day of the month" (no day chips);
  weekly shows days or "Any day".
- Header totals are separate pools: `WEEKLY PROTOCOL · 7/WEEK + 4/MONTH`
  (omit an absent/zero side; older fractional totals print exactly, e.g. 7.75).
- Team Flags cron flags WEEKLY entries only (2-14/week); monthly never flags —
  cards simply arrive that way, no client logic.

## F. Data repairs already done server-side (context, no code)

- Old `roster:'conflict'` plan entries (pre-replace-rule) were backfilled:
  blocking stale sessions deleted or logged ones adopted, crew rows created,
  and MESSAGE PAYLOADS patched in place to `roster:'created'` + real
  `schedule_id`. iOS just re-reads messages.
- Verify on a real team: former conflict badges are gone, adopted entries
  show LOGGED via the RPC readers.

## G. Definition of done (cross-check with Android on the same team)

1. Manager sees a teammate's logged session as LOGGED ✓ with the green
   logged-time pill (previously showed pending — RLS).
2. A trainer's workout never marks a doctor's same-day session (same client)
   as logged, and vice versa.
3. Sharing a plan over a stale CRM booking replaces it (client sees one
   session); sharing over an already-trained client links the done session
   (`adopted`) instead of duplicating.
4. Manager Add Session: blocked ONLY for clients already on that member's
   card; adding a client who already trained that day maps the done session
   onto the card as LOGGED; stale bookings are replaced silently.
5. PROTOCOL popup renders monthly entries (`4x/month`, MONTHLY badge, no
   days) and dual totals; legacy `Rehab / Recovery` displays as `Rehab`.
6. No direct `session_schedule`/`training_sessions` selects remain anywhere
   in the crew card path — RPC readers only.
7. Both apps show identical card states for the same team, same day.
