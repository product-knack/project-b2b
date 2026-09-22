# My Crew — Manager "Add Session for a Team Member" (iOS Implementation Prompt)

Build the manager add-session feature in the iOS My Crew (Team Messenger) screen, matching the shipped Android app exactly. Today the iOS manager cannot add a session into a team member's day — this document specifies the whole flow end to end: entry points, the picker modal, the two-step write (RPC + message), result handling, and how added sessions render on the day-plan cards.

Backend is LIVE and shared with Android — the RPC, RLS policies, and push triggers all exist. iOS only calls them.

---

## 1. What the feature is

On the merged **TEAM DAY PLAN** card (one card per date in the team thread), the **manager** can add a session into any member's section: pick one of that member's clients, a modality, and a time. The add:
1. Creates (or adopts) a real `session_schedule` roster row for that member — so it lands on the member's own Today's Roster and counts on the card, and
2. Posts a `plan_add` message into the team thread — so everyone sees it in chat and the card merges it into the member's section.

The physio **HOD** has the same power over doctor/therapist members (she is not the team manager, but the same RPC and rendering accept her).

## 2. Entry points & gating

- The add affordance (an "ADD SESSION" pill / "+" on a member's section header) appears ONLY for:
  - the **team manager** (`team.isManager`) — on TRAINER member sections. NOT on doctor/therapist sections: those are HOD territory and the manager is view-only there (`isHodManagedRole(role)` = role is `doctor` or `therapist`).
  - the **physio HOD** — on doctor/therapist sections (her feed and the team cards), with a Today/Tomorrow day chooser on her quick-action chips.
- Only on cards whose date is **today (live) or tomorrow (upcoming)** — never on past (final) cards.
- Dates are IST `YYYY-MM-DD` strings; compute "today" from a server-anchored clock, not the device clock.

## 3. The Add Session modal

Opened with context `{date, trainerId (member), trainerName, scheduledIds, scoreId, targetRole}`.

**Client list** — the target member's book:
```
trainer_clients where trainer_id = <member> and actively_training = true
  join clients (id, first_name, last_name, status)
```
Filter out clients whose `status` is `inactive` or `discontinued` (case-insensitive). Sort by name.

**Locked clients**: `scheduledIds` = client ids already in that member's day — the member's own plan entries for the date PLUS any prior manager/HOD adds for that (date, member). Locked rows render dimmed with a lock icon and the caption "ALREADY SCHEDULED · RESCHEDULE TO EDIT"; tapping shows an alert: *"{Client} already has a session with {First} that day. Use RESCHEDULE on the plan card to change it."* — they cannot be selected.

**Modality chips** — follow the TARGET member's role:
- therapist → `['Therapy']` (single option, PRE-SELECTED)
- otherwise → the union of trainer + doctor modalities: `['Strength', 'Aerobics', 'Aqua Aerobics', 'Boxing', 'Yoga', 'Pilates', 'Other']` ∪ `['Rehabilitation', 'Recovery', 'Physiotherapy']`
Resolve `targetRole` by finding the member in the team (or the HOD's teams) member lists.

**Time grid** — the standard crew 30-minute grid: `05:00` through `22:30` (36 slots), displayed as 12-hour labels ("5:00 AM" … "10:30 PM"). Single select.

Save enabled when client + modality + time are all chosen.

## 4. Write path — two steps, in order

### Step 1 — the roster RPC (must succeed first)
```
POST /rest/v1/rpc/plan_manager_add_session
{
  "p_score":    "<manager_score.id of the team>",
  "p_trainer":  "<member uuid>",
  "p_client":   "<client uuid>",
  "p_date":     "YYYY-MM-DD",        // IST date
  "p_time":     "HH:mm",             // IST, from the grid
  "p_modality": "Strength"
}
```
Server-side guards (raise → show the message): caller must be the team's current manager, OR the physio HOD when the target member's role is `doctor` or `therapist`; the target must be a member of that team.

Response: `{ "schedule_id": "<uuid|null>", "result": "created" | "adopted" | "exists" | "conflict", "replaced_prev": <int> }`

What the deployed RPC does (context — never reimplement client-side):
- **exists** — the member already has a crew-created session with that client that day → nothing written. Show: *"{Client} already has a session with this member that day. Use RESCHEDULE on the plan card to change it."* and STOP (no message).
- **Replace** — stale non-crew UNLOGGED rows for that member+client+day are deleted first (`replaced_prev` counts them); the crew booking supersedes them.
- **adopted** — an already-LOGGED session with that client today exists → it becomes the card entry (its `schedule_id` is returned); no duplicate row is created. Proceed like success.
- **created** — a fresh `session_schedule` row: `status 'scheduled'`, notes `Created from Team Messenger day plan (added by manager)`, the picked IST datetime/modality.
- **conflict** — unique violation on the exact datetime → show *"{Client} already has a session at that exact time."* and STOP (no message).
- Any thrown error → alert with the server message, STOP.

### Step 2 — the `plan_add` chat message
Only after `created`/`adopted`, insert into `manager_team_messages` through the normal send path (with the same retry/backoff used for text messages):
```json
{
  "team_id": "<scoreId>",
  "kind": "plan_add",
  "payload": {
    "date": "YYYY-MM-DD",
    "client_id": "<uuid>",
    "name": "<client full name>",
    "trainer_id": "<member uuid>",
    "time": "HH:mm",
    "modality": "Strength",
    "schedule_id": "<uuid from step 1>"
  },
  "body": "Manager added {Client} at {h:mm AM/PM}{ · Modality} to {MemberFirstName}'s plan ({Today|Tomorrow|day label})"
}
```
RLS: `plan_add` inserts are permitted only for the team manager or the physio HOD (already enforced by policy — a plain member's attempt is rejected).

On success: close the modal, haptic success, refresh the plan-card roster reads and the member's roster queries. If step 2 fails after step 1 succeeded, the roster row still exists (the card's live-roster read will surface it on refresh) — surface the send failure like any failed message.

## 5. Rendering rules (the part iOS most likely has wrong)

- **Merge into the card**: `plan_add` messages merge into the target member's section of the merged day card — keep the LATEST per `(date, trainer_id, client_id)`. Accepted senders are the **team manager OR the physio HOD** (do not filter to manager-only — HOD-sent adds for doctors/therapists arrive in manager-team threads from outside the team; manager-only filtering was a real Android bug).
- **Section creation**: a member with NO shared plan but with adds still gets a card section (adds alone create it).
- Added entries append after the member's own plan entries; if the member's own plan already covers that client, the member's entry wins (skip the add).
- Entries with a `schedule_id` display **live** time/modality/status from `session_schedule` (the shared definer reader RPC `crew_sched_rows(p_ids uuid[])`) — the frozen payload is only a fallback. Logged = the row's `workout_session_id` link; acknowledged/missed chips behave like every other entry.
- **Chat bubble**: `plan_add` also renders as a bubble in the stream. Plain members see only bubbles where they are the sender or the target (`payload.trainer_id == me`); managers/HOD see all.
- The targeted member sees the added session on their own MY DAY PLAN section and on their Today's Roster (the roster row is real).

## 6. Push notifications

Nothing to build: a DB trigger on `manager_team_messages` INSERT already sends the push for `plan_add` (deep-link route `manager-chat`). iOS just needs its existing crew push route handling.

## 7. Acceptance checklist

1. Manager sees the add affordance on trainer sections of today/tomorrow cards only — never on past cards, never on doctor/therapist sections.
2. HOD sees it on doctor/therapist sections (with Today/Tomorrow choice), and her adds work in manager-owned teams.
3. Client picker shows only the member's actively-training, non-inactive clients; already-scheduled clients are locked with the reschedule guidance.
4. Therapist target → modality is exactly "Therapy", pre-selected; other targets get the full union list.
5. `exists` / `conflict` results show their messages and post NO chat message; `created`/`adopted` post exactly one `plan_add`.
6. Adding for a client whose member already logged a session that day returns `adopted` and the card shows that session as LOGGED — never a duplicate row.
7. The added entry appears: in the team thread (bubble), on the member's section of the day card (for everyone), on the member's own MY DAY PLAN, and on the member's Today's Roster.
8. HOD-sent adds merge into the card for ALL viewers (member included) — the merge accepts manager AND HOD senders.
9. A second add for the same client+member+day is blocked in the picker (locked) and by the RPC (`exists`).
10. The member gets the push (server-side trigger) and tapping it opens My Crew.
