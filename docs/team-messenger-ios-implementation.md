# Team Messenger — end-to-end iOS implementation guide

Everything needed to replicate the staff app's Team Messenger (managers' team chat)
in a native iOS app. **The entire backend is already live in production Supabase**
(project `agtjszjedaenclbzgjvi`) — iOS only consumes it. Nothing in this document
requires new tables, policies, functions, or cron jobs.

Recommended stack: Swift + SwiftUI + [supabase-swift](https://github.com/supabase/supabase-swift)
(auth, PostgREST, Realtime) + Firebase Messaging (push arrives via FCM v1, not raw APNs).

---

## 1. What the feature is

One chat thread per competition team. Anyone in a current team sees an entry card on
their home screen; tapping opens the team chat. The thread is scoped to a
`manager_score` row (the team-for-a-batch record) and its competition window.
When the window ends, the chat becomes read-only automatically (server-enforced).
When a new batch row is created, the app re-points to the new thread automatically.

On top of plain chat the thread carries **template messages**:

- **Tomorrow's Plan** — each trainer posts tomorrow's session plan; all plans for a
  date merge into ONE card; entries create real roster rows.
- **Manager actions** — remarks on missed sessions, rescheduling a member's entry,
  adding a session into a member's day.
- **Member reschedule requests** — pending until the manager approves/rejects.
- **Team Flags** (7 PM daily, cron-posted) — clients off pace vs their weekly
  protocol; the manager must close each trainer's flag with a mandatory remark;
  each member sees only their own flag block.

---

## 2. Backend ground truth (live — consume as-is)

### 2.1 `manager_score` — the team registry
`{ id uuid, manager_id uuid, team_name text, team_json jsonb (array of member
profile ids as strings), team_start date, team_end date|null, ... }`
One row per team per batch.

**Current-team resolution (MUST match exactly — the leaderboard uses the same rule):**
1. Fetch all rows ordered by `created_at desc`.
2. Keep rows where `team_end` is null OR `team_end >= today(IST)`.
3. If none, keep the rows whose `team_start` equals the maximum `team_start`.
4. My team = the row where `manager_id == myUid` OR `team_json` contains `myUid`.
5. `active` (can post) = `team_start <= today(IST) <= coalesce(team_end, infinity)`.

`today(IST)` everywhere = the calendar date in Asia/Kolkata, never the device zone.

### 2.2 `manager_team_messages` — the one message table
```
id uuid pk · team_id uuid (fk manager_score.id) · sender_id uuid ·
kind text default 'text' · payload jsonb · body text · created_at timestamptz
```
`body` ALWAYS holds a plain-text fallback rendering, whatever the kind — an
unknown-kind message must render as a text bubble using `body`.

### 2.3 RLS contract (what the iOS client may assume)
- **SELECT**: current team member (manager or in `team_json`) OR anyone who ever
  posted in the thread (`was_participant`). Mid-competition joiners see FULL history;
  leavers keep read access only if they ever posted.
- **INSERT**: only as yourself (`sender_id = auth.uid()`), only while a current
  member, only inside the window (IST). Manager-only kinds (`plan_remark`,
  `plan_time_edit`, `plan_reschedule_decision`, `plan_add`) additionally require
  `manager_id = auth.uid()`. Post-window inserts fail server-side — the UI should
  ALSO hide the input and show a "Competition ended <date> — read-only" banner.
- **UPDATE**: ONLY the manager, ONLY on `kind = 'team_flags'` rows (this is how flag
  close-remarks are stored). Every other kind is immutable. No DELETE for anyone.
- Do not re-implement these rules as client security; mirror them as UI states only.

### 2.4 Sender identity
Messages store only `sender_id`. Resolve names/roles at READ time from
`profiles (id, first_name, last_name, role)`; missing profile → "Team member".

### 2.5 Roster-sync RPCs (called around plan messages)
- `plan_sync_roster(...)` — invoked when a plan is shared: every entry creates a NEW
  `session_schedule` row (provenance note "Created from Team Messenger day plan");
  re-sharing updates the plan's OWN rows; returns per-entry
  `{schedule_id, roster: 'created'|'linked'|'moved'|'conflict'}` which the app stores
  in the message payload entries.
- `plan_manager_reschedule(...)` — manager edit: moves the real `session_schedule`
  row, stamps approval fields, appends the remark; guarded to plan-created rows.
Read both function signatures from `supabase/plan_roster_sync_migration.sql` in this
repo before wiring — pass-through, no client logic.

---

## 3. Message kinds and exact payload schemas

TypeScript-ish; all fields are in `payload` (jsonb). Times `'HH:mm'` are IST.

| kind | posted by | rendered as |
|---|---|---|
| `text` | any member | chat bubble (`body`) |
| `tomorrow_plan` | any member | merged per-date plan card |
| `plan_remark` | manager only | attaches to plan card row (no bubble) |
| `plan_time_edit` | manager only | updates plan card row (no bubble) |
| `plan_reschedule_request` | member | pending request card |
| `plan_reschedule_decision` | manager only | flips request status (no bubble) |
| `plan_add` | manager only | "SESSION ADDED BY MANAGER" bubble |
| `team_flags` | cron (sender = manager) | Team Flags card |

### 3.1 `tomorrow_plan`
```jsonc
{ "date": "YYYY-MM-DD",
  "entries": [ { "client_id": "uuid|null", "name": "Client Name", "time": "HH:mm",
                 "modality": "Strength|…|null",
                 "schedule_id": "uuid|null",   // linked session_schedule row
                 "roster": "created|linked|moved|conflict|null" } ] }
```
Rules: ONE merged card per date, rendered at the slot of the LAST plan message for
that date; within a date, each sender's LATEST plan message wins (earlier ones are
absorbed). "Tomorrow" is IST-anchored.

### 3.2 `plan_remark` (manager, missed-session remark)
`{ "date", "client_id", "name", "trainer_id", "remark" }` — latest per
(date, client) wins; only render remarks whose sender is the CURRENT manager.
Shown on the plan card in FINAL mode only (after that day).

### 3.3 `plan_time_edit` (manager reschedule of a member's entry)
`{ "date", "client_id", "name", "trainer_id", "time", "modality", "schedule_id",
   "request_id"?: "uuid",       // present when it approves a member request
   "history": [ { "from_time", "to_time", "from_modality", "to_modality",
                  "remark", "by", "at" } ] }`
`history` is CUMULATIVE (the roster row keeps only the latest state — the immutable
message payload is the durable trail). Remark is REQUIRED on every hop.

### 3.4 `plan_reschedule_request` (member) + `plan_reschedule_decision` (manager)
Request: `{ "date", "client_id", "name", "trainer_id", "schedule_id", "from_time",
"to_time", "from_modality", "to_modality", "reason" }` — renders as a pending card.
Status resolution: a later `plan_time_edit` carrying the same `request_id` =
approved; a `plan_reschedule_decision` `{ "request_id", "approved": false }` =
rejected; otherwise pending. Approve/reject buttons: manager only.

### 3.5 `plan_add` (manager adds a session into a member's day)
`{ "date", "client_id", "name", "trainer_id", "time", "modality", "schedule_id" }`

### 3.6 `team_flags` (cron 19:00 IST; see §6)
```jsonc
{ "date": "YYYY-MM-DD",
  "flags": [
    { "trainer_id": "uuid", "trainer_name": "Name",
      "clients": [ { "client_id": "uuid|null", "name": "Client",
                     "sessions_per_week": 3, "modality": "Strength|null",
                     "gap_days": 2 } ],
      // written by the MANAGER via payload UPDATE when closing:
      "remark": "text|null", "remark_by": "uuid|null", "remark_at": "iso|null",
      "remark_history": [ { "remark", "by", "at" } ],   // prior versions on edit
      "closed": true } ] }
```

---

## 4. Reading, sending, realtime, unread

### 4.1 Read
`manager_team_messages` where `team_id = <scoreId>` order `created_at desc` limit
200, then reverse. Collect sender ids → one `profiles` fetch → map names/roles.
Poll every 60 s as a fallback; realtime is the fast path.

### 4.2 Send (text + templates)
Plain INSERT `{team_id, sender_id: myUid, kind, payload, body}`. Optimistic append
with a temp id; on error, roll back and surface the message. `body` for templates:
human-readable summary (e.g. ``Tomorrow's plan (Thu 21 Aug): Asha 7:00 AM · …``).

### 4.3 Realtime
One channel per consumer (unique names — e.g. `manager-chat-screen-<scoreId>` and
`manager-chat-card-<scoreId>` can both exist): `postgres_changes` on
`manager_team_messages`, events INSERT **and UPDATE** (UPDATE carries team-flags
remark saves), filter `team_id=eq.<scoreId>`. WALRUS enforces the subscriber's
SELECT policy server-side — the filter is convenience, not security. On plan-kind
inserts also refresh any roster surfaces the app has.

### 4.4 Unread badge (no server table)
Store per-thread `lastRead` in local storage (UserDefaults), keyed
`mgr-chat:last-read:<scoreId>`. CRITICAL, learned the hard way:
- Store the SERVER `created_at` of the newest message seen — never the device
  clock (fast device clock silently swallows unreads).
- Compare as parsed dates, not strings (`+00:00` vs `Z` formats break string order).
Unread = messages where `sender != me` and `created_at > lastRead`.

### 4.5 Derived plan outcome (ticks on plan cards)
A plan entry counts DONE when the client has ANY completed, non-cancelled
`training_sessions` row on the plan's IST date — time-flexible and
trainer-agnostic by design. Query: `training_sessions` select
`client_id, status, cancelled, scheduled_at` in client ids, scheduled_at within the
IST day; done map = clientId → earliest completed 'HH:mm'. Refresh every 2 min
while the plan date is today. Live row state (time/modality/status/missed remark)
comes from `session_schedule` by the entries' `schedule_id`s — the payload copy is
only the fallback.

---

## 5. Visibility rules (UI-level, per kind)

- **Plan cards**: the MANAGER sees every member's section; a MEMBER sees only their
  own section ("MY DAY PLAN"). This is UI scoping only — RLS lets all members read
  all messages (single-thread design); do the same on iOS.
- **Team Flags**: manager sees the full card (all trainers, OPEN/CLOSED pills);
  a member sees ONLY their own trainer block, auto-expanded, titled "YOUR FLAG",
  plus the manager's remark once given ("AWAITING MANAGER REMARK" until then).
  A member with no block in a card sees nothing for that message.
- Manager-only controls (edit time, add session, approve/reject, close flag,
  edit remark) render only for `team.isManager`; the server enforces it anyway.

---

## 6. Team Flags — full loop

**Producer (already live, no iOS work):** pg_cron `manager-team-flags-7pm-ist`
(19:00 IST daily) runs `enqueue_manager_team_flags()`: for each active team and
each member trainer, clients from `clients.weekly_protocol` (jsonb set by the CRM
web app: `entries[{trainer_id, trainer_name, sessions_per_week, modality}]`) are
flagged when the FULL allowed gap passed with no completed session AND nothing on
today's roster. Gap: 2/wk→3 days, 3/wk→2, 4–6/wk→1; Mon–Sun IST week clipping so
early weekdays can't false-flag. If flags exist it inserts the `team_flags`
message and pings the push edge function.

**iOS consumer work:**
1. Render the card (§3.6 payload) with state: header OPEN (red) / CLOSED (green)
   counts; per-trainer row = avatar, name, "N CLIENTS FLAGGED", OPEN/CLOSED chip,
   expandable client list ("3/WK · STRENGTH · NO SESSION 2+ DAYS").
2. **Mandatory close remark (manager)**: open block → multiline input + "CLOSE
   FLAG" button disabled until text. Saving = UPDATE the message row's payload in
   place: set that block's `remark`, `remark_by = myUid`, `remark_at = now ISO`,
   `closed = true`. (RLS permits this update for the manager on team_flags only.)
3. **Editable remarks with history**: EDIT button on a closed block → input
   prefilled; on save, push the PREVIOUS `{remark, by, at}` onto `remark_history`,
   then overwrite `remark/remark_by/remark_at`. UI shows ONLY the latest remark,
   with an "EDITED" tag when `remark_history` is non-empty. Save disabled if the
   text is unchanged.
4. Concurrency note: read-modify-write of the payload; single manager makes races
   unlikely — re-read the row before writing if you want to be strict.
5. Realtime UPDATE events deliver remark changes to members live.

---

## 7. Push notifications + deep links

- Token registry: table `odds_device_tokens (user_id, token, platform, updated_at)`,
  upsert on conflict `(user_id, platform)`. iOS: integrate **Firebase Messaging**,
  save the FCM registration token with `platform: 'ios'` after login (retry while
  the auth session settles; re-save on token refresh). Server fans out via FCM v1
  and deletes tokens FCM reports UNREGISTERED.
- Team flags push (edge fn `notify-manager-team-flags`, fired by the cron): title
  "Team flags · sessions off pace", body "N clients across M trainers…",
  `data: { route: "manager-chat", type: "manager_team_flags" }`.
- Deep link handling: on notification tap (foreground, background, AND cold start),
  read `data.type == "manager_team_flags"` or `data.route == "manager-chat"` →
  navigate straight to the team chat screen.

---

## 8. UI inventory (parity checklist)

1. **Home entry card**: team name, member avatar stack, competition countdown
   ("Ends 31 Jan · Nd left" + progress bar), unread pill (live via its own
   realtime subscription), tap → chat.
2. **Chat screen**: date-separated bubbles (day separators, "TODAY"), sender name
   + crown for the manager, own messages right-aligned accent gradient, optimistic
   send, keyboard-safe input, @mention suggestions (first-name match against
   members), sealed read-only banner replacing the input after the window ends.
   Mark the screen sensitive (block screenshots/replay if the app does elsewhere).
3. **Tomorrow's Plan compose sheet**: my actively-training clients
   (`trainer_clients` → `clients`, skip inactive/discontinued) — no pre-selection;
   a tomorrow `session_schedule` slot only seeds the default time; per-client time
   + modality pickers (modality prefilled from my latest `training_sessions.
   session_type` per client, 90-day lookback, normalize mixed case); reopening
   restores my submitted plan for editing (Update replaces).
4. **Merged plan card**: per-date, collapsible per-trainer sections,
   NOT-SUBMITTED roll-call, PROJECTED / LOGGED / MISSED tiles, planned(gold) +
   logged(green) time pills, modality sub-labels, missed-session remark display,
   manager reschedule trail ("MGR" box with hops + reasons).
5. **Request card**: from/to time + modality + reason; pending/approved/rejected
   states; approve → `plan_time_edit` (+ `plan_manager_reschedule` RPC), reject →
   `plan_reschedule_decision`.
6. **Team Flags card**: §6.
7. Colors (staff-app identity, optional to match): card ink `#1A140F`-ish dark,
   manager gold, flags red `#E85D5D` / green `#57C98A`, messenger identity blue.

---

## 9. Gotchas (each cost real debugging time)

1. All date logic in IST (`Asia/Kolkata`) — "today", "tomorrow", day separators,
   week windows. Never the device zone.
2. Unread marker: server timestamps + date parsing (§4.4).
3. Merged plan card: per-sender LATEST plan per date wins; card renders at the
   LAST plan message slot for the date.
4. `plan_remark` / `plan_time_edit` / `plan_reschedule_decision` NEVER render as
   bubbles — they attach to cards / flip statuses. `plan_add` DOES render.
5. Unknown kinds → plain text bubble from `body` (forward compatibility; this is
   exactly how old builds render `team_flags`).
6. `session_schedule.status` cancelled spellings: filter both
   `cancelled`/`canceled` (+ `deleted`) when reading roster.
7. Reschedule history lives in message payloads, not the roster row (roster keeps
   only the latest state).
8. Team resolution must be byte-identical to the leaderboard rule (§2.1) or the
   card and chat point at different teams.
9. Names resolve at read time; never freeze sender names into messages (except
   inside template payload entries where names ARE intentionally frozen).
10. Realtime channel names must be unique per consumer (screen + home card can be
    mounted simultaneously during navigation).

---

## 10. Verification checklist

1. As a manager of an active team: send / read / realtime live update.
2. Non-member: no rows, no realtime events, INSERT rejected (RLS).
3. Post-window: input hidden AND server rejects a forced INSERT.
4. Tomorrow's Plan: compose, send, re-send replaces mine, roster rows created
   (check `session_schedule` provenance note), outcome ticks appear after logging
   a session, manager reschedule moves the real row + shows the trail.
5. Member reschedule request → manager approve and reject paths.
6. Team flags: seed a card (or wait for 19:00 IST), manager closes each block with
   a remark (button disabled while empty), pills flip OPEN→CLOSED, EDIT produces
   the EDITED tag and archives to `remark_history`; the member account sees only
   its own block + the remark, live.
7. Push: 7 PM (or manual edge-fn invoke) delivers to the manager's iOS device;
   tap opens the chat from foreground, background, and cold start.
8. New batch row created → card and chat switch threads automatically.
