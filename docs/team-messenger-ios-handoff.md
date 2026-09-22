# Team Messenger (Managers Messenger) — Complete iOS Handoff Spec

**Mission: rebuild the Team Messenger feature in the iOS app, pixel-for-pixel in behavior, against the SAME live Supabase backend.** The Android/React Native implementation is complete and live-verified. This document contains every contract, rule, payload shape, and UI behavior you need. You are building a CLIENT ONLY.

**Reference implementation (source of truth when in doubt):** `odds-app/src/screens/managerChat.tsx` (~2100 lines) and `odds-app/src/lib/managerChatQueries.ts` in the React Native repo.

---

## 0. HARD RULES — read first

1. **The backend is LIVE and SHARED. Do NOT create, alter, or re-run any SQL.** All tables, RLS policies, RPCs, the 7 PM cron, and edge functions already exist in production (Supabase project `agtjszjedaenclbzgjvi`, `https://agtjszjedaenclbzgjvi.supabase.co`). Use the same URL + anon key the iOS app already uses for everything else.
2. **Every date in this feature is an IST (Asia/Kolkata) calendar date** formatted `YYYY-MM-DD`. Never use the device's local calendar.
3. **Never trust the device clock.** Fetch the server time ONCE per app session (any Supabase REST response's `Date` header, e.g. a `HEAD` on `/rest/v1/`), compute `serverOffsetMs = serverDate - deviceNow`, and derive ALL messenger dates (`today`, `tomorrow`, compose dates, unread comparisons) from `serverNow = deviceNow + offset`. A test device running one day fast silently broke the add-only lock and unread counts before this fix.
4. **Interoperability is mandatory.** Android and iOS users share the same threads. Payload field names, body-text formats, and write flows below must match EXACTLY — a message written by iOS must render perfectly on Android and vice versa.
5. **RLS lesson that shaped this design:** policy subqueries run AS THE CALLER. Doctors cannot read `manager_score` directly — team resolution MUST go through the `messenger_teams()` RPC (SECURITY DEFINER), never a direct `manager_score` select.
6. **PostgREST caps responses at 1000 rows.** Any query that could exceed it must paginate or scope down.
7. **Copy style: NO em dashes anywhere in user-facing text.** Micro-labels are UPPERCASE, monospace, letter-spaced.

---

## 1. Concept

One chat thread per **competition team** = one row in `manager_score` (`{id, team_name, manager_id, team_json (jsonb array of member uuids), team_start, team_end}`; `team_end` null = ongoing). The thread carries:

- free **text** messages (with @mentions)
- each member's **Tomorrow's Plan** (their client sessions for tomorrow), merged into ONE "team day plan" card per date
- **real roster writes**: every plan entry creates/updates an actual `session_schedule` row via RPC
- manager **reschedules**, member **reschedule requests** with approve/reject, manager **adds** sessions into members' days
- nightly **Team Flags** cards (cron-posted, off-pace clients) that the manager must close with remarks
- **session_update** notices posted by the AI chat-reschedule accept flow

**Roles:**

| Role | Experience |
|---|---|
| **Member** (trainer or doctor in `team_json`) | Sees chat + own plan section ("MY DAY PLAN" scoping), composes own tomorrow plan, locked after sharing (add-only), can request reschedules, sees own flag block |
| **Manager** (`manager_id`) | Sees ALL sections, reschedules members' sessions (reason mandatory), adds sessions, approves/rejects requests, closes flag blocks with remarks. **EXCEPT doctor sections: view-only** |
| **Physio HOD** (profile `role='doctor'` AND `role_specialization` contains `'physio_hod'`; currently Anjana, `30df5c2b…`) | NOT a team member. Sees every doctor-containing team. Default view = "All Physios" combined feed. Has manager-grade authority over DOCTOR sections only (reschedule, add, approve/reject requests, missed remarks, close doctor flag blocks) across all teams, plus her own tomorrow plan |
| **Doctor** (member with `role='doctor'`) | Same as member, but their manager is view-only on them; their requests/reschedules are handled by the HOD |

**The universal authority gate** (apply everywhere: RESCHEDULE pill, + ADD button, time-pill tap, flag-block close, request approve/reject):

```
canAct(section) = doctorIds.contains(section.trainerId) ? meIsHod : isManager
```

where `doctorIds` = team members with `role='doctor'` (in the HOD feed: all physios).

---

## 2. Table: `manager_team_messages`

`{id uuid pk, team_id uuid → manager_score.id, sender_id uuid, kind text, payload jsonb, body text, created_at timestamptz}`

`kind` values: `text` | `tomorrow_plan` | `plan_remark` (LEGACY, never write, may exist in history) | `plan_time_edit` | `plan_reschedule_request` | `plan_reschedule_decision` | `plan_add` | `team_flags` | `session_update`. Unknown kinds render as `text`.

**Live RLS (final versions, already deployed — for your understanding only):**

- SELECT: `is_team_member_any(team_id, uid) OR was_participant(team_id, uid) OR is_physio_hod(uid)` — members (past + present) read their team; the HOD reads everything.
- INSERT: `sender_id = auth.uid()` AND (`is_current_team_member` OR `is_physio_hod`) AND (kind NOT IN (`plan_remark`,`plan_time_edit`,`plan_reschedule_decision`,`plan_add`) OR `is_team_manager` OR `is_physio_hod`). So members can post `text`, `tomorrow_plan`, `plan_reschedule_request`, `session_update`; manager-grade kinds need manager or HOD.
- UPDATE: ONLY `kind='team_flags'`, by team manager or HOD (close-remarks are payload updates in place). Everything else is immutable. No DELETE.
- Realtime publication includes this table; subscription events are RLS-filtered server-side (WALRUS).

---

## 3. RPC catalog (all live; call with `supabase.rpc(name, args)`)

### `messenger_teams()` → jsonb array
Returns every `manager_score` row the caller may see: `[{id, team_name, manager_id, team_json, team_start, team_end}]` ordered `created_at desc`. **The ONLY way to resolve teams for all roles.** For members it returns their teams; for the HOD it returns all teams.

### `plan_sync_roster(p_score uuid, p_date date, p_entries jsonb)` → jsonb array
`p_entries = [{client_id, time: 'HH:mm', modality}]`. Caller must be a current member of `p_score` OR the HOD. For each entry: finds a row THIS FEATURE created for that client+caller+day (`notes LIKE 'Created from Team Messenger%'`, not cancelled) and updates it, else INSERTs a new `session_schedule` row (`trainer_id = caller`, `status='scheduled'`, `notes='Created from Team Messenger day plan'`). **Never links pre-existing/legacy sessions** (they are being deleted at go-live). Returns `[{client_id, schedule_id, result: 'created'|'updated'|'moved'|'conflict'}]` — `conflict` = exact duplicate client+datetime exists elsewhere (`schedule_id` null).

### `plan_manager_reschedule(p_score, p_schedule, p_date, p_time 'HH:mm', p_modality, p_remark)` → jsonb
Manager-only (of `p_score`). Moves the real row, stamps `reschedule_approved_by/status='approved'/processed_at`, writes remark into `notes` + `reschedule_request`. Guards: session not cancelled, not already logged (`workout_session_id`), target row's trainer must belong to the team, 60-minute double-booking guard scoped to plan-created rows. **The app then posts the `plan_time_edit` message itself** (see §5).

### `plan_manager_add_session(p_score, p_trainer, p_client, p_date, p_time, p_modality)` → jsonb
Manager of `p_score`, OR HOD when `p_trainer` is a doctor. Returns `{schedule_id, result: 'created'|'conflict'|'exists'}`. `exists` = that trainer+client already has ANY non-cancelled session that IST day → show "already scheduled, reschedule instead" and do NOT post a message. On `created`, **the app posts the `plan_add` message itself**.

### `hod_doctor_reschedule(p_schedule, p_date, p_time, p_modality, p_remark)` → jsonb
HOD-only, doctor sessions only. Moves the row AND **posts its own `plan_time_edit` message — the app must NOT post one** (skip your send call in the HOD branch).

### `hod_act_on_request(p_request uuid, p_approve boolean)` → jsonb
HOD-only. `p_request` = the `plan_reschedule_request` message id. Approves (moves the roster row) or rejects, and **posts its own decision/edit message** — app posts nothing.

### `hod_doctor_missed_remark(p_schedule, p_category, p_remark)` → jsonb
HOD-only. Appends to `session_schedule.missed_remarks` with `by_role='physio_hod'`. (Trainers/doctors log their own missed remarks from Today's Roster via `append_missed_session_remark(p_schedule, p_category, p_remark)` — that flow lives outside Team Messenger, but the messenger DISPLAYS the results.)

### `chat_accept_reschedule(...)` — AI chat-reschedule accept (see §10).

`is_physio_hod(p_user uuid)` → boolean also exists but the client detects the HOD by reading profiles (§4).

---

## 4. Identity & team resolution (client logic)

**Who am I:** from `profiles` — `role` (trainer/doctor/…), and HOD detection: query `profiles` where `role='doctor'` and `role_specialization not null`, find the row whose `role_specialization` (stringified) contains `'physio_hod'` case-insensitively → `{hodId, meIsHod}`. **Every client needs `hodId`** (not just the HOD) to attribute HOD-sent messages in edit/request-status logic.

**My team (members + managers):** call `messenger_teams()`, then apply the ongoing-else-latest rule: keep rows with `team_end null or >= today`; if none, keep the rows sharing the latest `team_start`. Find the row where I am `manager_id` or in `team_json`. Resolve member names/roles via one `profiles` select `.in(id, ids)`. Build:

```
ManagerTeamInfo { scoreId, teamName, managerId, isManager, start, end,
                  active (start<=today<=end), daysLeft, pctElapsed (0-100),
                  members: [{id, name, role, isManager}] sorted manager-first then name }
```

**HOD teams:** same RPC, keep CURRENT teams (`team_end null or >= today`) that contain at least one `role='doctor'` member; `isManager:false`; sorted by team name. The HOD is typically in none of them → her `team` = `hodTeams[selectedIndex]`.

**Entry card visibility:** no current team AND not HOD → card hidden entirely.

---

## 5. Message payload contracts (EXACT field names — interop-critical)

All times `'HH:mm'` 24h IST. All dates `'YYYY-MM-DD'` IST.

### `text`
`payload: null`. `body` = the message. @mentions are plain text (chips above the input insert `@FirstName `; matching is first-name based, display only).

### `tomorrow_plan`
```json
{ "date": "2026-08-24",
  "entries": [ { "client_id": "uuid", "name": "Full Name", "time": "07:00",
                 "modality": "Strength", "schedule_id": "uuid|null",
                 "roster": "created|updated|moved|conflict" } ] }
```
`schedule_id`/`roster` come from `plan_sync_roster`'s return, merged per client. `body` (fallback text, generate exactly):
`Tomorrow's plan (Mon 24 Aug): Name 7:00 AM · Name 8:30 AM` — day label from the date, 12h times, entries joined with ` · `.
**One plan message per member per date; re-shares INSERT a new message (latest wins).**

### `plan_time_edit` (manager/HOD reschedule of one entry; also = request approval when it carries `request_id`)
```json
{ "date": "...", "client_id": "...", "name": "...", "trainer_id": "uuid of the section owner",
  "time": "08:00", "modality": "Strength|null", "remark": "reason (required)",
  "schedule_id": "uuid", "request_id": "request message id (only when approving)",
  "history": [ { "from_time": "07:00", "to_time": "08:00",
                 "from_modality": "Strength", "to_modality": "Boxing",
                 "remark": "...", "by": "manager uuid", "at": "ISO timestamp" } ] }
```
**`history` is CUMULATIVE**: read the previous latest `plan_time_edit` for that `trainer_id:client_id` on that date, append the new hop. The immutable message chain is the durable reschedule history (`session_schedule` keeps only the latest approval). Manager flow: RPC first, then post this message. HOD flow: RPC only (it posts).

### `plan_reschedule_request` (member asks)
```json
{ "date": "...", "client_id": "...", "name": "...", "trainer_id": "sender uuid",
  "schedule_id": "uuid", "from_time": "07:00", "to_time": "09:00",
  "from_modality": "Strength|null", "to_modality": "Boxing|null", "reason": "required" }
```

### `plan_reschedule_decision` (rejection only)
```json
{ "request_id": "request message id", "approved": false,
  "client_id": "...", "name": "...", "date": "..." }
```
Manager rejection: post this directly. HOD rejection: `hod_act_on_request(id, false)` posts it.

**Request status derivation (client-side):** scan messages; any `plan_time_edit` whose `payload.request_id = R` → R approved; any `plan_reschedule_decision` with `request_id = R, approved:false` → rejected (approved wins if both). Honor senders who are the team manager OR the HOD. Otherwise pending.

### `plan_add` (manager/HOD inserted a session into a member's day)
```json
{ "date": "...", "client_id": "...", "name": "...", "trainer_id": "member uuid",
  "time": "07:00", "modality": "Strength", "schedule_id": "uuid" }
```

### `team_flags` (cron-posted; clients only UPDATE payload in place to close blocks)
```json
{ "date": "2026-08-22",
  "flags": [ { "trainer_id": "uuid", "trainer_name": "Name",
               "clients": [ { "client_id": "...", "name": "...", "sessions_per_week": 3,
                              "modality": "Strength", "gap_days": 2 } ],
               "remark": "manager/HOD closing remark", "remark_by": "uuid",
               "remark_at": "ISO", "closed": true,
               "remark_history": [ { "remark": "...", "by": "...", "at": "..." } ] } ] }
```
Close flow: **refetch the message fresh**, modify ONLY your block (set `remark/remark_by/remark_at/closed:true`, push previous remark into `remark_history` when editing), then `update({payload}).eq('id', messageId)`. Fresh-refetch-before-update prevents clobbering a concurrent close of another block.

### `session_update` (posted by `chat_accept_reschedule`; render-only)
Green notice card: render `body` text (+ any `payload.name/date/time` present). Never written directly by the app UI.

---

## 6. Chat screen — message stream composition

Fetch: last 200 messages for `team_id`, ascending render. Resolve sender names via a second `profiles .in(senderIds)` query (names are read-time, never stored).

**Stream filter (exact):** hide `plan_remark`, `plan_time_edit`, `plan_reschedule_decision`, and every `tomorrow_plan` EXCEPT the latest one per date. Rendered items:

- `text` → bubble (sender name label; own messages right-aligned accent)
- latest `tomorrow_plan` per date → **MergedPlanCard** (§7) rendered at that slot
- `plan_reschedule_request` → **RequestCard**: shows client, from→to time/modality, reason, sender; status chip PENDING/APPROVED/REJECTED (derivation §5). Buttons (Approve/Reject) only for `canAct(request.trainer_id)`; for doctor requests, non-HOD viewers see the label `HANDLED BY THE PHYSIO HOD` (pink). Approve opens the reschedule dialog pre-filled with the requested target (manager path: `plan_manager_reschedule` + post `plan_time_edit` w/ `request_id`; HOD path: `hod_act_on_request`)
- `plan_add` → small pink notice card ("MANAGER ADDED" style: name, time, modality, target member)
- `session_update` → small green notice card
- `team_flags` → **TeamFlagsCard** (§8)

**Composer:** text input + send (plain INSERT, kind `text`). Optimistic append, rollback on error. @mention chips strip above input. On iOS hide any global AI bar overlaying the input if the app has one.

**Header:** team name, member count, competition progress (daysLeft + pctElapsed bar), pink identity.

**Unread badge (entry card):** store per-team marker `mgr-chat:last-read:{scoreId}` in UserDefaults = the **server `created_at` of the newest message seen** (never device now). Unread = messages with `senderId != me` AND `Date.parse(createdAt) > Date.parse(marker)` (numeric compare — the DB emits `+00:00`, JS emits `Z`; string compare fails). Write the marker on screen open/close with the newest visible message's timestamp.

---

## 7. MergedPlanCard — ONE card per date (the feature's heart)

Merges, for its date: every member's latest `tomorrow_plan` entries + all `plan_add` entries (keyed per trainer, deduped per client, add wins over stale plan copy) + `plan_time_edit` overlays (latest per `trainer_id:client_id`, manager/HOD senders only).

**Layout top-to-bottom:**
1. Header: `TEAM DAY PLAN` style title + date label (e.g. `TOMORROW · MON 24 AUG` / `TODAY · …` / weekday for past), gold accent.
2. **Roll call**: members with no section → red `NOT SUBMITTED:` + first names. When everyone submitted: green `ALL {N} MEMBERS SUBMITTED · {total} SESSIONS`.
3. **Stat tiles**: `PROJECTED` (total planned sessions), `LOGGED` (green), `MISSED` (red). Logged/missed derive from §9.
4. **Per-member collapsible sections** (avatar color-coded left rail): section header = member name + count + (for the viewing member's own section, label it `MY DAY PLAN`). **Visibility: manager and HOD see all sections; a plain member sees ONLY their own section.** (UI-level scoping; data is readable by all — deliberate.)
5. **Rows** (per client): name; **planned time pill (gold)**; **logged time pill (green, actual logged time)** when done; modality sub-label; status: done ✓ green / missed red (past + not logged) / pending. Missed rows show the latest `missed_remarks` entry (remark + category label + by_name/by_role) and, for `canAct` viewers, an `ADD REMARK` red chip (HOD-only on doctor rows → `hod_doctor_missed_remark` category dialog, categories §12).
6. **Time pill tap / RESCHEDULE** (only `canAct(section)`): opens the edit dialog (§7a).
7. **+ ADD** per section (only `canAct`): opens AddSessionModal (§7b).
8. **MGR trail box**: for rows with `plan_time_edit` history, a small box listing each hop `from → to (modality) · remark · by · when`.

**Row truth: LIVE data beats payload.** For all entries with `schedule_id`, batch-fetch `session_schedule` rows (`id, scheduled_datetime, modality, status, missed_remarks`) and display THOSE times/modalities/statuses; the frozen payload is only the fallback for unlinked entries. Refetch every ~30-60s while the card's date is today/tomorrow.

### 7a. Edit dialog (manager/HOD reschedule)
Fields: time grid (`SHEET_TIMES` = 05:00…21:30 in 30-min steps), modality chips (role-appropriate list, §12), **reason text REQUIRED** (disabled save until non-empty). Needs `schedule_id` — unlinked rows show "Not linked" alert. Manager path vs HOD path per §3/§5. After success invalidate/refresh plan-schedule + roster + chat data.

### 7b. AddSessionModal
Client picker = that member's actively-training book (`trainer_clients` where `trainer_id=member, actively_training=true`, exclude client status inactive/discontinued, alpha-sorted; trainers CAN read other trainers' rows). Clients already in that day's plan/adds are LOCKED with padlock + `ALREADY SCHEDULED · RESCHEDULE TO EDIT` (gold). Pick client + time + modality (mandatory) → `plan_manager_add_session`; on `exists` show the same already-scheduled explanation; on `created` post `plan_add`.

---

## 8. TeamFlagsCard

Title: `TEAM FLAGS · {DATE}` for manager/HOD, `YOUR FLAG · {DATE}` for a member. Manager/HOD see ALL trainer blocks with OPEN (red) / CLOSED (green) pills; a member sees ONLY their own block, auto-expanded. Each block: trainer name + flagged clients (name, `{n}/wk`, modality, gap days).

**Closing (mandatory remark per block):** input + save visible only to `canAct(block.trainer_id)` — i.e. doctor blocks are HOD-only; the manager sees `AWAITING PHYSIO HOD REMARK` on open doctor blocks (members see `AWAITING MANAGER REMARK` on their own). Closed blocks show the remark bubble labeled `MANAGER REMARK` / `PHYSIO HOD REMARK` (+ `EDITED` tag when `remark_history` exists; EDIT allowed for the same authority). Write path per §5 team_flags (fresh refetch → payload update). Realtime UPDATE events must refresh the card live.

Backend context (no client work): cron `manager-team-flags-7pm-ist` runs daily 19:00 IST; flags clients from `clients.weekly_protocol.entries` off-pace (gap 3d for 2/wk, 2d for 3/wk, 1d for 4-6/wk; Mon-Sun IST week clipping; skipped if completed session in window or any roster today); posts the card as the MANAGER (`sender_id = manager_id`) + FCM push to the manager with `data.route='manager-chat'` (iOS: handle this deep link, including cold start).

---

## 9. Compose: Tomorrow's Plan sheet (member + HOD's own plan)

Opened from the chat (and the HOD's `MY TOMORROW PLAN` button). Data for the sheet:

- **Rows** = my tomorrow `session_schedule` slots (non-cancelled, earliest per client, seeded with real time, marked `scheduled`) FIRST, then my actively-training book clients without slots (alpha). NOTHING is preselected — the trainer picks every client manually; a roster slot only seeds the default time.
- **Modality prefill**: my most recent `training_sessions.session_type` per client (90 days, normalized §12) seeds the modality; **modality is MANDATORY per selected row** (block share until set).
- Time picker per row: 05:00-21:30 half-hour grid.
- **30-minute gap rule (hard block)**: two selected entries within <30 min → error, cannot share. Same-time entries → confirmation ("same time for N clients?") then allowed.
- **Share flow**: `plan_sync_roster(scoreId, date, entries)` → merge returned `schedule_id`/`result` into entries as `schedule_id`/`roster` → INSERT the `tomorrow_plan` message with body from §5. **Alert conflicts, but only NEW ones**: compare against the previous share's conflicted client_ids (from my last plan message payload) so re-shares don't re-alert.
- **Add-only lock after sharing**: reopening the sheet on a date I already shared restores my submitted plan; previously shared rows are LOCKED (padlock icon, `LOCKED · ASK YOUR MANAGER TO EDIT` gold caption, shake animation on tap). I can only ADD clients and re-share (which updates my own roster rows idempotently). Edits/removals of locked rows go through manager/HOD reschedule or a reschedule request.
- **Request change** (member, on a locked row): dialog with target time/modality + reason (required) → post `plan_reschedule_request` (§5).

---

## 10. HOD "All Physios" combined feed (her default view)

The HOD's screen has two modes: `all` (default) and `team` (a selected team's normal chat via green team-switcher chips).

**All Physios feed** (one cross-team query: messages from ALL her team ids, kinds `tomorrow_plan, plan_add, plan_time_edit, plan_reschedule_request, plan_reschedule_decision`, last 3 days, ascending; ONE unfiltered realtime channel — RLS scopes delivery):

1. Top chip row: gold `MY TOMORROW PLAN` button (opens her own compose sheet; her plan syncs via `plan_sync_roster` with any of her team ids — the RPC allows the HOD) + gold `+ {FirstName}` chip per physio (opens AddSessionModal targeted at that physio, carrying that physio's team `scoreId`).
2. Green `CHAT` chips per team → switch to that team's thread.
3. `RESCHEDULE REQUESTS · N` section: pending doctor requests across all teams as RequestCards with Approve/Reject (`hod_act_on_request`).
4. ONE MergedPlanCard for TOMORROW + one for TODAY, built from a synthetic team whose members are ALL physios (HOD included) across teams; `doctorIds` = all physios; `meIsHod` true → she can reschedule/add/remark on every row. plan_add entries are keyed by `payload.trainer_id`; cross-team adds resolve their target team from the physio→team map.

Entry-card subtitle for the HOD: `{N} teams · physio oversight`.

---

## 11. Outcome + realtime

**Outcome derivation (drives LOGGED/MISSED tiles and row ticks):** a plan entry is DONE when the client has ANY completed, non-cancelled `training_sessions` row on the plan's IST date — **trainer-agnostic and time-flexible by design** (the manager cares that it happened). Value = earliest completed time that day (`'HH:mm'` IST) → shown in the green logged pill. MISSED = planned date is past (or time passed today) and not done. Poll every ~2 min while viewing today's card.

**Realtime:** subscribe per `team_id` (INSERT + UPDATE on `manager_team_messages`, unique channel per consumer — home card and screen can both be live). On INSERT of `tomorrow_plan`/`plan_time_edit`, also refresh every roster surface in the app (dashboard Today's Sessions, roster sheets, CRM/doctor calendars) — these messages always ride along a `session_schedule` write, and the message event is the cross-device signal. Poll fallback ~60s.

---

## 12. Shared constants

**Modalities** — trainers: `Strength, Aerobics, Aqua Aerobics, Boxing, Yoga, Pilates, Other`; doctors: `Rehabilitation, Recovery, Physiotherapy`. Normalizer (DB values are mixed-case): lowercase-trim → map {strength→Strength, boxing→Boxing, yoga→Yoga, pilates→Pilates, aerobics→Aerobics, aqua aerobics→Aqua Aerobics, recovery→Recovery, rehabilitation→Rehabilitation, physiotherapy→Physiotherapy, other→Other}, else Title Case.

**Missed-remark categories** (value → label): `client_no_show` Client No-show, `trainer_no_show` Trainer No-show, `venue_issue` Venue Issue, `emergency` Emergency, `miscommunication` Miscommunication, `forgot_to_log` Forgot to Log, `other` Other.

**`missed_remarks` entry shape** (jsonb array on `session_schedule`): `{at, by, by_name, by_role, category, remark}` — display the LAST entry.

**Visual identity:** obsidian/ember dark theme. Feature accent PINK `#F06A9B`, soft `#F5B8CE` (card borders, header chrome, plan-add notices, HOD labels). Semantic colors stay: gold = plans/times/locks, green = done/approved/logged/chat chips, red = missed/rejected/flags open. Dark card base `rgba(26,20,15,0.92-0.94)`, hairline borders, monospace uppercase micro-labels.

---

## 13. AI chat-agreed reschedules (adjacent integration)

In the CLIENT messenger ("My Longevity Team" thread), a DB trigger + edge function (Gemini) writes rows into `chat_reschedule_suggestions` when trainer+client agree a new time in chat (same-IST-day rule, confidence ≥ 0.75). RLS: only the session's trainer sees their suggestions; table is in the realtime publication.

iOS port: in the client-chat thread view, show a gold chip above the composer — `RESCHEDULE DETECTED IN CHAT` + evidence quote + suggested time — with Dismiss (update suggestion status) and Reschedule (call `chat_accept_reschedule` RPC with the suggestion id; it moves the roster row AND posts the green `session_update` notice into the trainer's team thread). **AI never writes; the trainer's tap is the only write path.** (Backend deploy of the edge fn may still be pending — build the UI; it degrades to simply never showing a chip.)

---

## 14. Verified facts, gotchas, test recipes

- **HOD RPCs reject non-HOD callers** with "only the physio HOD can do this" (live-verified). Doctor sections' write guards are enforced server-side too, not just in UI.
- **plan repeats**: re-sharing a plan updates the SAME roster rows (provenance `notes LIKE 'Created from Team Messenger%'`) — never duplicates; `conflict` only for exact-duplicate datetime rows created elsewhere.
- Embedded relations from PostgREST can arrive as object OR single-element array depending on FK metadata — normalize both.
- Cache values must be plain JSON-serializable structures if you persist query caches (the RN app was bitten by persisted Maps becoming `{}`).
- `plan_remark` messages may exist in old history — ignore them (superseded by roster missed-remarks).
- Push: FCM data message `route:'manager-chat'` deep-links into the thread (handle cold start).
- **Test accounts** (production data — be careful): manager Sagar `sagaroddsfitness@gmail.com` / `Sagar07` (team "Sagar"); admin `oddsfitnessapp@gmail.com` / `Oddsfitness@11` (NOT a team member — sees no threads; useful for data probes). No doctor/HOD passwords are known — HOD flows need user-assisted testing.
- Quick sanity probe after wiring: sign in as Sagar → `messenger_teams()` returns team "Sagar" (`d6e51ad8…`), thread loads, send/read a text message, compose sheet lists his book with roster-seeded times.

## 15. Definition of done

1. Entry card (trainer + doctor + HOD variants) with live unread badge.
2. Chat: text + mentions + optimistic send + realtime + unread marker semantics.
3. Compose sheet with every rule in §9, writing `plan_sync_roster` + exact `tomorrow_plan` payload/body.
4. MergedPlanCard with roll call, tiles, live rows, per-role scoping, authority gates, trails, missed remarks.
5. Manager reschedule + add flows; member request flow; approve/reject (manager AND HOD paths, HOD skips message posting).
6. TeamFlagsCard with close-remark flow, history, doctor-block HOD gating, realtime UPDATE refresh.
7. HOD All Physios feed + team switcher + her own plan.
8. session_update + plan_add notice cards.
9. Server-clock anchoring + IST dates everywhere; interop verified against an Android device in the same thread.
