# iOS handoff 8 to 20: every remaining Android feature and fix since 19 Aug 2026 (one document)

Paste this whole doc to the iOS app's coding assistant. It covers what the Android app (odds-app) gained
between 19 Aug and 23 Sep 2026 that is not in handoffs 1 to 7 (Daily Quiz, My Crew Force create, Incentive UGC,
Managers Leaderboard member status, QHP Refresh Pending, QHP voice memo, plan-expiry push). Sections: 8 Today's
Roster own-session add + 8b roster link fix, 9 My Crew end to end, 10 Consultant workspace, 11 Reimbursement,
12 Doctor paid / unpaid cancel, 13 Therapist workspace, 14 CRM voice memo, 15 Irregular client flag, 16 Ops Leads
second QHP slot, 20 app-wide fix rules. Tech Desk, Referrals approvals and the Odds AI chat cache (17 to 19) are
not in this document.

## How to work through this document
1. **Build one section at a time, in the order given**, and report after each one: what already existed in iOS,
   what you changed, what you verified. Do not start the next section until the current one type-checks.
2. **The backend is LIVE and SHARED** (Supabase project `agtjszjedaenclbzgjvi`). Do NOT create, alter or run any
   SQL, policy, bucket, cron or edge function. If a section says something is missing on the server, stop that
   section and tell the user.
3. **First check what iOS already has** for each section (search the code for the tables, RPCs and screen names
   the section lists). Several of these were handed to iOS earlier (My Crew, Tech Desk, therapist role); in that
   case treat the section as the current source of truth and fix any difference.
4. **Reference implementation**: the Android React Native repo `odds-app` (file and function names are given in
   each section). When this document and live behaviour disagree, the live database wins: probe read-only first.
5. Standing rules for every section: the signed-in user's id is `session.user.id` (never a dev / test id);
   every network call goes through the app's `withTimeout`; IST for every date shown or keyed; no em dashes in
   user-facing copy; sheets follow section 20.1; new health screens go into the replay-shield sensitive routes.
6. Never write test rows into production from a script. Use read-only probes; the first real use on a device is
   the end-to-end test unless a section gives a safe recipe.

---

## 8. Today's Roster card: own-session add for teamless trainers, Request Roster and Reschedule removed (5 to 7 Sep 2026)

**What and who**
- Purpose: a trainer who is in no current manager team has no day plan to put sessions on their roster. The Today's Roster card gives that trainer an "Add Session" / "Add Tomorrow" button, which creates a `session_schedule` row through RPC `trainer_add_own_session`. Android built this on 5 Sep 2026; web copied it on 7 Sep 2026.
- Gate: `teamless = !myTeamQ.isPending && !myTeamQ.data`. `myTeamQ` uses the Managers Leaderboard rule over `messenger_teams()` (see Client logic). Managers and team members never see the button. The button is enabled only when the viewed day offset is 0 or 1.
- Removed for every trainer: the "Request Roster" button (and its sheet "Request Roster from CRM") and the per-row "Reschedule" button. The reschedule STATUS chips stay.
- Test: a real trainer who is in no live `manager_score` team (probe 2). A team member's login is the negative test.

**Backend contract (live; never create or run SQL)**
- `public.trainer_add_own_session(_client_id uuid, _date date, _time text, _modality text) returns jsonb`, SECURITY DEFINER, EXECUTE to authenticated. Probed live 7 Sep 2026 (anon returns 28000).
- Call: `supabase.rpc('trainer_add_own_session', { _client_id, _date: 'YYYY-MM-DD', _time: 'HH:mm', _modality })`.
- Success reply: `{ "id": "<new session_schedule uuid>", "at": "<scheduled timestamptz ISO>" }` (Android does not read it).
- Row inserted into `session_schedule`: `trainer_id = auth.uid()`, `client_id`, `scheduled_datetime = (_date || ' ' || _time || ':00')::timestamp AT TIME ZONE 'Asia/Kolkata'`, `modality = btrim(_modality)`, `status = 'scheduled'`, `notes = 'Added by trainer from Today''s Roster'` (byte-identical on web and Android; it is how these rows are found later).
- Guards, in order; show the message verbatim (`error.code` = SQLSTATE):
  1. `28000` "Not authenticated"
  2. `P0001` "You can only add sessions for today or tomorrow" (server IST today or today + 1)
  3. `P0001` "Pick a modality" (blank only; no list check)
  4. `42501` "That client is not assigned to you" (needs `trainer_clients` trainer_id = me, client_id, `actively_training IS TRUE`)
  5. Timestamp cast: send exactly `HH:mm`; anything else raises a raw Postgres cast error, shown verbatim.
  6. `P0001` "You already have a session around that time" (any of my non-cancelled rows, any client, strictly inside ±60 min)
  7. `P0001` "That client already has a session around that time" (same window, any trainer)
- Client-side mapping: `PGRST202` → "Adding sessions is not enabled yet. Ask the tech team to finish the setup."; the 20 s timeout → "Add session timed out. Check your connection and try again." (Android joins these with an em dash).
- `messenger_teams()` (SECURITY DEFINER, no args) → JSON array of every `manager_score` row `{id, team_name, manager_id, team_start, team_end, team_json}`; `team_json` is a jsonb array of member uuids.
- RLS: plain trainers get `[]` when they read `manager_score` directly, so never read the table (everyone would look teamless). Trainers have no direct INSERT on `session_schedule`; only the RPC adds. The client picker reads own `trainer_clients` (`actively_training = true`) joined to `clients`.

**Screens and exact copy**
- Action row inside the expanded roster card, below the day navigator:
  - Slot 1 "Trial Workout" (sparkle icon, orange #F47A2A outline). Unchanged.
  - Slot 2, teamless trainers only: "Add Tomorrow" when the day offset is 1, else "Add Session"; icon calendar-plus; neutral style (text #EDE8E2, border rgba(255,255,255,0.08)).
  - On any other offset the button is disabled at 0.45 opacity and the caption "SESSIONS CAN ONLY BE ADDED FOR TODAY OR TOMORROW" shows under the row (8.5 pt, letterSpacing 0.6, #6E6862).
  - While membership loads, and for team members, slot 2 is not rendered and Trial Workout fills the row.
- Bottom sheet (max height 88%, bg #0E0A09, top radius 26, backdrop rgba(0,0,0,0.62)): title "Add a session", close X, subline "Today or tomorrow only. It appears on your roster straight away, ready to log." (#8A847E). Section labels 9 pt, letterSpacing 0.8, #7C766F; selected = orange text, 14% orange fill, 40% orange border.
  - "DAY": segments "Today" / "Tomorrow", each with an uppercased date line (`en-IN`, `{weekday:'short', day:'numeric', month:'short'}`).
  - "CLIENT": search "Search your clients" (case-insensitive substring), list capped at 190 pt, orange spinner while loading, "No clients match." when empty; the selected row turns orange bold with a check.
  - "TIME (HH:MM · IST)": free text, default and placeholder "09:00", numbers-and-punctuation keyboard; red border (#E76A52 at 50%) when non-empty and failing `/^([01]\d|2[0-3]):[0-5]\d$/`.
  - "MODALITY": chips Strength, Aerobics, Aqua Aerobics, Boxing, Yoga, Pilates, Other; none preselected.
  - Error line: the thrown message, red, 11.5 pt.
  - Save: full width, orange gradient #FB8B3A to #EE5E16, "Add to my roster" / "Adding…", disabled at 0.5 until client, modality and a valid time are set.
  - Success: success haptic, the sheet closes. No alert, no toast.
- Row actions now (no "Reschedule" button any more):
  - Open-past rows: "Missed Remark" / "Remark Logged" (gold #E0A53C), hint "Missed session · add a remark" or "Remark saved".
  - Other rows not logged or cancelled: "Log Workout" (green #57C98A) + "Cancel" (red). Before the window: Log Workout disabled, hint "Logging opens at h:mm AM". Inside: "Log window open until h:mm AM". After: only "Cancel", primary chip "Window closed" (red), hint "Closed at h:mm AM".
  - Status chips that stay: "Reschedule pending" (gold; hint "Proposed <slot> · awaiting approval, you can still log" or "Awaiting approval · you can still log this workout"), "Resched approved" (green), "Resched rejected" (red).
- If the iOS feature tour still has a "Request Roster" step, remove it (Android's tour copy is stale there).

**Client logic**
```ts
await syncServerClock();                         // offset from the Supabase REST Date header
const today = istYmd(serverNow());               // en-CA + timeZone 'Asia/Kolkata'
const all = (await supabase.rpc('messenger_teams')).data ?? [];
let pool = all.filter((t) => !t.team_end || t.team_end >= today);
if (!pool.length) { const latest = all.reduce((m, t) => (t.team_start > m ? t.team_start : m), ''); pool = all.filter((t) => t.team_start === latest); }
const mine = pool.find((t) => t.manager_id === uid || (Array.isArray(t.team_json) && t.team_json.includes(uid)));
// query returns null when !mine; teamless = !q.isPending && !q.data
```
- Membership key `['my-manager-team', uid]`, staleTime 120 s, `uid` = the session user.
- Roster day runs -14 to +14; `canAdd = day === 0 || day === 1`; the sheet opens on Tomorrow when viewing +1. Every open resets: client null, search '', time '09:00', modality null.
- Send `_date` as the IST calendar date (Android sends the device-local date; the server checks IST, so an IST key is safer).
- Client list: own `trainer_clients` rows (`actively_training = true`) joined to `clients`. The roster hides inactive / discontinued clients, so an add for one of them succeeds but never shows.
- Wrap the RPC in `withTimeout` (20 s). On success invalidate `trainer-roster`, `trainer-month-sessions-v2`, `mgr-plan-sched`, `crm-month-roster` (prefixes). The added row then behaves like any slot: log window 1 h before to 2 h after; "Log Workout" passes the row id as the slot id (see 8b).

**Reference implementation (Android)**
`src/screens/trainer.tsx` (`AddOwnSessionSheet`, `Dashboard` teamless gate and action row, `RosterCard` row actions; `RequestRosterSheet` and `RescheduleSheet` are no longer mounted), `src/lib/trainerQueries.ts` (`useAddOwnSession`, `useTodayRoster`), `src/lib/managerChatQueries.ts` (`useMyManagerTeam`, `TRAINER_MODALITIES`, `serverNow`, `syncServerClock`), `src/lib/clientQueries.ts` (`useMyClients`).

**Probe (read-only; ask the user to run)**
```sql
select pg_get_functiondef('public.trainer_add_own_session(uuid,date,text,text)'::regprocedure);
with t as (select * from public.manager_score),
live as (select * from t where team_end is null or team_end >= (now() at time zone 'Asia/Kolkata')::date),
pool as (select * from live union all
         select * from t where not exists (select 1 from live) and team_start = (select max(team_start) from t))
select exists (select 1 from pool where manager_id = '<TRAINER_UUID>' or team_json ? '<TRAINER_UUID>') as in_team;
```

**Acceptance test**
1. Team-member trainer: the expanded roster shows only "Trial Workout"; no Request Roster, no Reschedule button on any row.
2. Teamless trainer, today: "Add Session" opens on Today, 09:00, nothing selected, button dimmed.
3. "9:5" → red border, disabled; "10:30" → normal.
4. Pick client, free time, modality → "Add to my roster": haptic, sheet closes, the row appears on today's card; logging it works.
5. Tomorrow: "Add Tomorrow", sheet opens on Tomorrow, row appears on tomorrow's view.
6. +2 or -1: dimmed with the caption.
7. Within 60 min of one of your sessions: "You already have a session around that time".
8. A row with a pending reschedule raised from CRM still shows "Reschedule pending".
9. SQL: `select trainer_id, client_id, scheduled_datetime at time zone 'Asia/Kolkata' as ist, modality, status, notes from public.session_schedule where notes = 'Added by trainer from Today''s Roster' order by scheduled_datetime desc limit 10;`

## 8b. Roster link race fix (a logged session also showing as pending)

**What and who**
- Today's Roster merges `session_schedule` slots with the day's logged `training_sessions`. A slot shows pending until its `workout_session_id` is set; a logged row that no slot matches shows as an extra "Logged" row. The old code linked them with two swallowed UPDATEs that raced the DB trigger creating `training_sessions`; about 20 to 27% of logs lost the back-link (measured Aug 2026), giving a pending slot plus a separate logged card.
- Fix: one RPC after the insert, one retry after 500 ms, never throws, writes an `ops_alerts` row on failure, and shows a gold notice. Applies to every trainer workout log that carries a roster slot id.

**Backend contract (live; never create or run SQL)**
- `public.link_workout_to_schedule(p_workout_session_id text, p_schedule_session_id uuid) returns jsonb`, SECURITY DEFINER, EXECUTE to authenticated. In one transaction: sets `training_sessions.schedule_session_id = slot` where `workout_session_id = p_workout`; if none, attaches the closest unlinked row with the slot's client and trainer on the same IST day; sets `session_schedule.workout_session_id = p_workout` where `id = slot and workout_session_id is null`.
- Reply (live-verified; the key is `linked`, NOT `already_linked`):
```json
{ "training_sessions_updated": 1, "attached_existing": 0, "session_schedule_updated": 1, "linked": true }
```
  `linked` = a `training_sessions` row exists with that workout id AND `schedule_session_id = slot` (true on a fresh link and on an idempotent re-run). No `linked` key = not linked.
- Server fallback triggers (no client work): `trg_autolink_training_session_to_schedule` (BEFORE INSERT/UPDATE on `training_sessions`) and `trg_sync_session_schedule_workout_id` (AFTER INSERT/UPDATE).
- `ops_alerts`: required `source`, `severity` (info | warning | error | critical), `title`; optional `message`, `context` jsonb. INSERT allowed to authenticated WITH CHECK `source = 'schedule_link'`; SELECT is admin-only, so never chain `.select()` onto the insert.
```json
{ "source": "schedule_link", "severity": "warning", "title": "Roster link not completed",
  "message": "link_workout_to_schedule did not confirm a link after one retry",
  "context": { "workout_session_id": "<id>", "schedule_session_id": "<slot uuid>", "attempts": 2 } }
```

**Screens and exact copy**
- No new screen; a failed link never shows an error (the save result stays "synced").
- Unresolved link: the dashboard synced-log notice turns gold (#E0A53C) with a clock icon: line 1 "<Client name> · <Modality> workout", line 2 "Workout saved. Roster sync is still finishing, nothing needed from you." Dismiss X; auto-hides after 3 hours.
- Linked or skipped: green (#57C98A) with a check: "<label>, saved to server ✓" (Android uses an em dash there) and "Synced h:mm AM · kept its original log time".
- The workout form subheader: "From today's roster" with a slot id, else "Trial / ad-hoc session".

**Client logic**
```ts
type LinkOutcome = { status: 'skipped' | 'linked' | 'unresolved'; attempts: number };
async function linkWorkoutToSchedule(wid: string, slot: string): Promise<LinkOutcome> {
  const once = async () => {
    const { data, error } = await supabase.rpc('link_workout_to_schedule', { p_workout_session_id: wid, p_schedule_session_id: slot });
    if (error) throw new Error(error.message);
    return (data as any)?.linked === true;
  };
  let attempts = 0;
  try {
    attempts = 1; if (await once()) return { status: 'linked', attempts };
    await new Promise((r) => setTimeout(r, 500));
    attempts = 2; if (await once()) return { status: 'linked', attempts };
  } catch (e) { console.error('[schedule_link] RPC error', e); }
  void supabase.from('ops_alerts').insert({ /* the row above, with attempts */ }).then(() => {}, () => {});
  return { status: 'unresolved', attempts };
}
```
- Order inside the workout submit: (1) idempotency check on `workout_exercises.session_id`, insert only if absent; (2) if a slot id is set, call the link (it runs even when the rows already existed, so a re-drain re-links); (3) RPE update; (4) partner group id update; (5) return `{ sessionId, link }`. `link.status === 'unresolved'` picks the gold notice.
- Offline: nothing runs until the outbox drains (45 s per item); the link happens at drain time. After each item invalidate `trainer-roster`, `client-sessions`, `trainer-month-sessions-v2`, `mgr-plan-outcome-v5`.
- The slot id comes from the roster "Log Workout" button (`row.id`). A partner's second leg has no slot (link skipped). Trial / ad-hoc logs must pass `null` explicitly.

**Reference implementation (Android)**
`src/lib/clientQueries.ts` (`LinkOutcome`, `LINK_RETRY_MS`, `linkWorkoutToSchedule`, `submitWorkoutLog`), `src/lib/offline.ts` (`processItem`, `drainOutbox`, `submitItem`, `SyncedNotice`, `SYNC_MS`), `src/screens/trainer.tsx` (notice render, Workout submit, roster `onAddWorkout`), `src/store.tsx` (`openWorkout`).

**Probe (read-only; ask the user to run)**
```sql
select pg_get_functiondef('public.link_workout_to_schedule(text,uuid)'::regprocedure);
select ss.id slot, ts.id ts_id from public.session_schedule ss join public.training_sessions ts
  on ts.client_id = ss.client_id and ts.trainer_id = ss.trainer_id
 and (ts.scheduled_at at time zone 'Asia/Kolkata')::date = (ss.scheduled_datetime at time zone 'Asia/Kolkata')::date
where ss.workout_session_id is null and coalesce(ss.status,'') <> 'cancelled'
  and ts.workout_session_id is not null and ts.schedule_session_id is null
  and ss.scheduled_datetime >= now() - interval '7 days';   -- expect 0 rows
select created_at, severity, context from public.ops_alerts where source = 'schedule_link' order by created_at desc limit 20;
```

**Acceptance test**
1. Online: log from a roster row inside the window → exactly one "Logged" row, green notice.
2. Airplane mode: log, reconnect → after the drain the row is linked, one card.
3. Offline: save, kill the app, relaunch online → drains and links.
4. Partner pair: the second leg adds one logged row for the partner only, no pending twin.
5. SQL for the slot: `workout_session_id` set and `schedule_session_id` = the slot.
6. No duplicate `training_sessions` per log in the last 2 days.
7. A normal log adds no `schedule_link` row in `ops_alerts`.

---

## 9. My Crew (Managers Messenger / Team Messenger), end to end (20 Aug to 23 Sep 2026)

**Source of truth:** the Android React Native app `odds-app`: `src/screens/managerChat.tsx` (about 2,700 lines) and `src/lib/managerChatQueries.ts`. The backend is **live and shared**. **Never create, alter or run SQL.** Every date is an IST (`Asia/Kolkata`) `YYYY-MM-DD`. Every "today" or "tomorrow" comes from a server-anchored clock (9.6). Where an older iOS doc disagrees with the current Android code, the code wins; 9.4 lists the known gaps. The Force create part is also in handoff 2.

### 9.1 What and who
- **Team** = one `manager_score` row `{id, team_name, manager_id, team_json (jsonb array of uuid strings), team_start, team_end (null = ongoing)}`. One thread per row, keyed `manager_team_messages.team_id = manager_score.id`.
- **Members** = `manager_id` plus the `team_json` ids. The manager is listed first, with a crown. Member roles are `trainer`, `doctor` or `therapist`. **HOD-managed** means role `doctor` or `therapist` (`isHodManagedRole`).
- **Manager** (`manager_id = me`) sees every section; reschedules, adds, approves or rejects, and closes flags on TRAINER sections (own included); is **view-only** on doctor and therapist sections.
- **Physio HOD**: a `profiles` row with `role='doctor'` and `role_specialization` containing `physio_hod` (case-insensitive on the stringified value). Today that is Anjana Odds, id `30df5c2b...`. She belongs to NO team and sees every current team that contains a doctor or therapist. Default view **All Physios**. Manager-grade authority on doctor and therapist sections only; she can also share her own tomorrow plan.
- **Universal gate** (time-pill tap, `+ ADD`, request Approve/Reject, flag close, missed-remark): `canAct(sectionOwnerId) = hodManaged(owner) ? meIsHod : team.isManager`.
- **Plain member** (UI-level scoping only; RLS lets them read the whole thread): only their own section (`MY DAY PLAN`), no tiles, no roll-call; only their own reschedule requests; `plan_add` and `session_update` bubbles only when they are the sender or `payload.trainer_id == me`; only their own Team Flags block.
- **Window:** `active = team_start <= today <= (team_end ?? infinity)`. Inserts outside it fail server-side; the UI replaces the composer with a read-only banner.

### 9.2 Status check for iOS (build order; search the iOS code for the quoted names)
1. [ ] **Server clock + team resolution.** One `HEAD {SUPABASE_URL}/rest/v1/` with an `apikey` header per session gives `offset = Date(header) - now`. Teams come from `rpc('messenger_teams')`, never a direct `manager_score` select (doctors cannot read that table). Ongoing-else-latest rule (9.6). Member profiles `profiles(id, first_name, last_name, role, avatar_url)`. The entry card shows on trainer, doctor and therapist homes; hidden when there is no team and the user is not the HOD.
2. [ ] **Thread + messages + realtime.** Last 200 by `team_id`, newest first, then reversed. Sender names resolved at read time from `profiles`. Unknown kind renders as `text` using `body`. Realtime on INSERT and UPDATE (9.3). Inverted list pinned to the newest message, day separators, sender runs.
3. [ ] **Tomorrow's Plan share.** Call `plan_sync_roster` FIRST (if it fails the plan still posts, unlinked, with an alert). Merge each `schedule_id` / `result` into the entries as `schedule_id` / `roster`, then insert the `tomorrow_plan` message. Modality mandatory. Entries 1 to 29 minutes apart are blocked; exact same-time entries need a confirmation. Members are add-only after sharing; the manager is not. Alert only NEW conflicts (skip clients already `conflict` in the previous share).
4. [ ] **Merged day card.** One card per date, rendered at the slot of the LAST plan message for that date. Live rows from `rpc('crew_sched_rows', {p_ids})`; outcome from `rpc('crew_plan_outcome', {p_date, p_clients})` (trainer-scoped). No direct `session_schedule` / `training_sessions` reads in the card path.
5. [ ] **Reschedule.** Member: the `RESCHEDULE` chip on own linked, not-logged, not-cancelled, non-final rows posts a `plan_reschedule_request` (reason and modality required). Manager direct: `plan_manager_reschedule`, then post `plan_time_edit` with a cumulative `history`. Manager approve: one tap when the request has `schedule_id` and `to_time`, else the prefilled dialog carrying `request_id`. Manager reject: post `plan_reschedule_decision`.
6. [ ] **Manager Add Session incl. Force create** (handoff 2). RPC first, then exactly one `plan_add` on `created` / `adopted`. `exists` → alert. `conflict` → warning overlay inside the modal with **Go back** / **Force create** (re-call with `p_force: true`, sent only on that path). `force_blocked:'logged'` → alert, nothing written.
7. [ ] **Missed remarks.** On final-day, not-done rows show the LAST entry of `missed_remarks` (from `crew_sched_rows`). Trainers write theirs from Today's Roster (`append_missed_session_remark`). The HOD gets `ADD REMARK` on doctor / therapist rows → `hod_doctor_missed_remark`.
8. [ ] **Acknowledgements.** Each `crew_plan_outcome` row carries `acked`. Done rows show `✓ ACKNOWLEDGED` (green) or `NOT ACKNOWLEDGED` (gold). Missing `acked` → no label.
9. [ ] **Team Flags (19:00 IST cron card).** Manager and HOD see every block with OPEN / CLOSED pills; a member sees only their own block, expanded. A remark is mandatory to close; stored by UPDATING the message `payload` in place; edits append to `remark_history`.
10. [ ] **HOD.** `hod_doctor_reschedule`, `hod_act_on_request`, `hod_doctor_missed_remark` post their own messages (the app posts nothing after them). HOD screen: team switcher `All Physios` + one chip per team; the All Physios feed (9.4); her own plan via the gold calendar button; HOD adds via `plan_manager_add_session` (HOD arm).
11. [ ] **@mentions.** A chip strip suggests members by first-name prefix; picking inserts `@First `. The server sends the push; the client only highlights.
12. [ ] **Quoted replies.** `text` payload `{reply_to:{id, name, body (up to 120 chars + "…")}}`. Long-press 300 ms on text bubbles, or right-swipe any bubble or card (52 px). Tapping a quote jumps to the original (plans jump to that date's day card) and flashes 1.6 s.
13. [ ] **Send retries.** Network-class errors only: 1.5 / 3 / 6 / 10 / 10 s (5 retries). Offline fails fast; RLS and other server errors fail at once. A failed text stays as a `NOT SENT` bubble with `TAP TO RETRY` / `DISCARD`.
14. [ ] **Unread marker.** Per team in local storage: the SERVER `created_at` of the newest message seen. Compare with `Date.parse`, never as strings.
15. [ ] **Pushes + deep link.** FCM token in `odds_device_tokens {user_id, token, platform:'ios'}`. Any push with `data.route == 'manager-chat'` (or `data.type == 'manager_team_flags'`) opens My Crew from foreground, background and cold start (verified on an iOS device on 25 Aug 2026; confirm the token upsert).
16. [ ] **15 Sep selection-wipe fix.** The compose sheet seeds its selection ONCE per open (keyed on `existing?.id ?? 'fresh'`, reset when closed). Background refetches may refresh rows but never re-seed the selection.
17. [ ] **Also in current code:** `RETRY BOOKING` on `ROSTER CONFLICT · NOT BOOKED` entries (9.4 note c); the blue `PROTOCOL` chip + popup from `clients.weekly_protocol`; the green `session_update` card (posted by the AI chat-reschedule accept flow).

### 9.3 Backend contract (live; never create or run SQL)
**Table `manager_team_messages`:** `id uuid pk, team_id uuid (fk manager_score, cascade), sender_id uuid, kind text default 'text', payload jsonb, body text not null (always write one), created_at timestamptz`. Times `'HH:mm'` IST, dates `'YYYY-MM-DD'` IST.

| kind | writer | payload |
|---|---|---|
| `text` | any member / HOD | `null`, or `{reply_to:{id,name,body}}` |
| `tomorrow_plan` | member / HOD | `{date, entries:[{client_id, name, time, modality, schedule_id\|null, roster:'created'\|'updated'\|'moved'\|'adopted'\|'conflict'}]}` |
| `plan_time_edit` | manager / HOD | `{date, client_id, name, trainer_id (section owner), time, modality, schedule_id, remark, request_id?, history:[{from_time,to_time,from_modality,to_modality,remark,by,at}]}`; HOD RPC rows add `by_hod:true`, no `history` |
| `plan_reschedule_request` | member | `{date, client_id, name, trainer_id (sender), schedule_id, from_time, to_time, from_modality, to_modality, reason}` |
| `plan_reschedule_decision` | manager / HOD | `{request_id, approved:false, date, client_id, name, trainer_id}` (HOD adds `by_hod`) |
| `plan_add` | manager / HOD | `{date, client_id, name, trainer_id (member), time, modality, schedule_id}`; forced adds also `forced:true, replaced_schedule_id, replaced_trainer_id, replaced_trainer_name` |
| `team_flags` | cron (sender = manager) | `{date, flags:[{trainer_id, trainer_name, clients:[{client_id,name,sessions_per_week,modality,gap_days}], remark?, remark_by?, remark_at?, closed?, remark_history?:[{remark,by,at}]}]}` |
| `session_update` | `chat_accept_reschedule` RPC | `{date, client_id, name, trainer_id, schedule_id, from_time, to_time, source:'client_chat'}` |
| `plan_remark` | legacy | never write; never render |

**RLS (final policies from `physio_hod_migration.sql`):**
- SELECT: `is_team_member_any(team_id, uid) OR was_participant(team_id, uid) OR is_physio_hod(uid)` (super admins read everything too).
- INSERT: `sender_id = auth.uid()` AND (`is_current_team_member` inside the window OR HOD) AND (kind NOT IN `plan_remark`, `plan_time_edit`, `plan_reschedule_decision`, `plan_add` OR `is_team_manager` OR HOD).
- UPDATE: ONLY `kind='team_flags'`, by the team manager or the HOD. No DELETE.

**RPCs** (show `error.message` verbatim):
- `messenger_teams()` → every `manager_score` row `[{id, team_name, manager_id, team_json, team_start, team_end}]`, `created_at desc`. The client filters.
- `plan_sync_roster(p_score uuid, p_date date, p_entries jsonb [{client_id,time,modality}])` → `[{client_id, schedule_id, result, replaced_prev}]`. Guard: current member of `p_score` in the window, or HOD. The row's `trainer_id` is ALWAYS the caller. Per entry: delete the caller's stale unlogged non-crew rows for that client and day; if a crew row exists (notes LIKE `Created from Team Messenger%`) update it (`moved` / `updated`); else a logged non-crew row → `adopted`; else insert with notes `Created from Team Messenger day plan` (`created`). A unique client+datetime violation → `conflict`, `schedule_id` null.
- `plan_manager_reschedule(p_score, p_schedule, p_date, p_time, p_modality, p_remark)` → `{schedule_id, old_datetime, new_datetime}`. Guard: manager of `p_score` inside the window; row's trainer in the team. Refuses cancelled or logged rows and any slot within 60 min of another crew row for that client. Stamps `reschedule_status='approved'`, `reschedule_processed_at`, `reschedule_approved_by`; the remark goes to `notes` and `reschedule_request`.
- `plan_manager_add_session(p_score, p_trainer, p_client, p_date, p_time, p_modality, p_force boolean default false)` (the only overload since 23 Sep): see handoff 2.
- `hod_doctor_reschedule(p_schedule, p_date, p_time, p_modality, p_remark)` → `{schedule_id, new_datetime}`; posts `plan_time_edit` into the owner's current team.
- `hod_act_on_request(p_request uuid (request message id), p_approve bool)` → `{approved}`. Approve moves the row and posts `plan_time_edit`; reject posts the decision.
- `hod_doctor_missed_remark(p_schedule, p_category, p_remark)` → `{at, by, by_name, by_role:'physio_hod', category, remark}`. All three HOD RPCs reject non-HOD callers ("only the physio HOD can do this") and non-doctor / therapist rows.
- `crew_sched_rows(p_ids uuid[])` → `{"<id>": {scheduled_datetime, modality, status, logged (workout_session_id set), missed_remarks}}`.
- `crew_plan_outcome(p_date, p_clients uuid[])` → `[{client_id, trainer_id, at, acked}]` (completed, not cancelled, that IST day). Both readers raise `not a team participant` unless the caller is in any `manager_score` row or is the HOD.

**Realtime:** `postgres_changes` on `public.manager_team_messages`, INSERT and UPDATE, filter `team_id=eq.<scoreId>`.

**Push trigger** (`trg_crew_message_push` on INSERT; the sender is never notified; errors swallowed): `plan_time_edit`, `plan_add`, `plan_reschedule_decision` → `payload.trainer_id`; a request → the manager, or the HOD when the requester is a doctor or therapist; `tomorrow_plan` → the manager (+ the HOD for doctor / therapist senders); `session_update` → the manager; `team_flags` → each flagged member (+ the HOD for doctor blocks); `text` → members whose `@firstname` is in the body. Crons (IST): 06:00 member digest, 20:00 member nudge + manager roll-call, 21:00 missed sweep, 19:00 Team Flags. Every push carries `data:{route:'manager-chat', type:'crew_*'|'manager_team_flags'}`.

### 9.4 Rendering rules that are easy to get wrong
- **Stream filter:** hide `plan_remark`, `plan_time_edit`, `plan_reschedule_decision`, and every `tomorrow_plan` except the LAST one per date (that one renders the whole day card).
- **Card sources:** bySender = latest `tomorrow_plan` per sender for the date; adds = latest `plan_add` per `(date, trainer_id, client_id)`; edits = latest `plan_time_edit` per `trainer_id:client_id`. Accept adds and edits only from the **team manager OR the HOD**.
- **Adds create sections;** adds append after plan entries; the member's own entry wins over an add for the same client.
- **Live roster over frozen payload:** (1) `crew_sched_rows` time and modality; else (2) a `plan_time_edit` NEWER than that member's plan message; else (3) the payload. The time pill shows "edited" (pencil) when live differs from payload. `status 'cancelled'` → `CANCELLED IN ROSTER`.
- **Trainer-scoped done:** `sched.logged` OR outcome key `${sectionOwnerId}:${clientId}`. Another member's log never ticks this row.
- **Modes:** `upcoming` (date > today), `live` (= today), `final` (< today). Status and ticks show only when not upcoming and the outcome query succeeded.
- **Stat tiles** (manager and HOD only): `PROJECTED` (gold), `LOGGED` (green), third tile `PENDING` (pink, live) or `MISSED` (red when > 0, final).
- **Roll-call** (MANAGER only): members with no plan → `NOT SUBMITTED:` first-name chips (tapping opens Add Session, except on final cards or for doctor / therapist members). Everyone shared → `ALL {N} MEMBERS SUBMITTED · {total} SESSIONS`.
- **Section headers** (privileged viewers): collapsed unless single; first name, crown for the manager, `DOCTOR` (blue) / `THERAPIST` (purple) tag, `x/n` or `N SESSIONS`, `+ ADD` when not final and `canAct`. A member's own rows render flat.
- **Member scoping:** header `MY DAY PLAN`, footer `FULL TEAM PLAN IS VISIBLE TO THE MANAGER`; with no own section, the `PLAN TOMORROW'S SESSIONS` button (team active and date today or later).
- **MGR trail:** `from_time → to_time → ...`, `· N MOVES` when more than one hop, plus the latest remark.
- **Team Flags:** header collapsed for manager / HOD, expanded for members. Doctor blocks are closed by the HOD: the manager sees `AWAITING PHYSIO HOD REMARK`; the bubble label is `PHYSIO HOD REMARK`.
- **HOD All Physios feed:** one query across her team ids (kinds `tomorrow_plan, plan_add, plan_time_edit, plan_reschedule_request, plan_reschedule_decision`, last 3 days) + one realtime channel `hod-feed-all` (event `*`). Quick chips `+ {First}` ask Today or Tomorrow then open Add Session with that physio's team `scoreId`; green team chips open that team's chat. Then `RESCHEDULE REQUESTS · N` (pending), a TODAY card and a TOMORROW card over a synthetic team of all physios.
- **Android gaps (decide, do not copy blindly):** (a) in the team thread the flag filter uses `team.isManager` only, so the HOD sees just her own block there; (b) in the HOD's team view, adds / edits / request status read `managerId` from the viewer's own team query (null for the HOD): use the displayed team's `managerId`; (c) Retry booking calls `plan_sync_roster`, which books under the CALLER, yet Android offers it to the manager and HOD on other members' rows, and its payload rewrite is blocked by RLS (only `team_flags` may be updated); (d) re-fetch the flag payload before a close update.
- **Older docs vs code:** `SHEET_TIMES` runs to **22:30**; outcome is trainer-scoped via the RPCs; there is no manager RESCHEDULE pill (tap the time pill); compose rows sort alphabetically; the HOD plan button is the gold calendar icon; the body day label is `DD MON` (e.g. `23 SEP`); a failed send leaves a NOT SENT bubble (the draft is not restored).

### 9.5 Exact copy (Android has three em dashes here; shown with a full stop and marked)
- **Entry card:** `My Crew`; `{Manager|Member} · {team} · {n}d left|ongoing|ended`; HOD `{N} teams · physio oversight`; unread pill `99+` / `UNREAD`.
- **Header:** `My Crew`; `{TEAM} · {n} MEMBERS · {n}D LEFT · YOU MANAGE|PHYSIO OVERSIGHT`; HOD `ALL PHYSIOS · {n} TEAMS · PHYSIO OVERSIGHT`; `{n} DAYS LEFT` / `COMPETITION OVER`; members strip `(you)`; switcher `All Physios`.
- **Composer:** `Message the team…`; HOD `Message team {name}…`, `TO {TEAM}`; reply bar `Replying to {name}`; mention chip `@{First}` with tag `MGR` or the role.
- **Chat states:** empty `Say hello to your team` / `Everyone in Team {name} sees this chat. Use the gold calendar button to share tomorrow's session plan.`; no team `No competition team` / `You are not part of a current manager competition team.` / `Back`; read-only `Competition ended {DD MON}. This chat is read-only. A new team chat starts with the next competition.` (em dash replaced); failed send `NOT SENT`, `TAP TO RETRY` / `SENDING…`, `DISCARD`, alert `Still not sent`; day separator `TODAY`; under the plan card `UPDATED {h:mm AM}`.
- **Day card:** `TEAM DAY PLAN` / `MY DAY PLAN`; `TOMORROW · ` / `TODAY · ` + day label; tiles `PROJECTED`, `LOGGED`, `PENDING`, `MISSED`; `NOT SUBMITTED:`; `You haven't shared your plan for this day.`; rows `{MODALITY}` or `{MODALITY} · ADDED`, else `ADDED BY MANAGER`; `ROSTER CONFLICT · NOT BOOKED`, `RETRY BOOKING` / `BOOKING…`; `CANCELLED IN ROSTER`; `✓ ACKNOWLEDGED` / `NOT ACKNOWLEDGED`; `PROTOCOL`, `RESCHEDULE` (pink, swap icon); `MGR`; `ADD REMARK`; `REMARK PENDING · ADD IT FROM TODAY'S ROSTER` (own row) / `MISSED REMARK PENDING`; footer `{d} OF {t} LOGGED SO FAR` / `ALL SESSIONS LOGGED` / `{m} OF {t} NOT LOGGED`; `{n} MISSED SESSION(S) AWAITING TRAINER REMARK`.
- **Bubbles:** `SESSION ADDED BY MANAGER` (`{DD MON} · {time}  ·  {modality} · for {First}`); `SESSION UPDATED · CLIENT CHAT` (`… · agreed with the client`); `RESCHEDULE REQUEST` + `PENDING|APPROVED|REJECTED`, `HANDLED BY THE PHYSIO HOD`, buttons `Reject` / `Approve`.
- **Edit dialog:** `Change session` / `Request reschedule · {name}` / `Approve reschedule · {name}`; placeholders `Reason (required), e.g. trainer double-booked` / `Reason (required), e.g. clash with another client`; `Cancel`; alerts `Reason required` (member: `Write why you need this session moved before picking the new time.`; manager: `Write why this session is moving before picking the new time. The team and the roster record both keep it.`), `Modality required` (`Pick the session modality before sending.` / `...before saving.`), `Not linked` (`This entry has no roster session to move.`), `Reschedule failed`, `Request not sent`, `Reschedule message not sent`.
- **Add session:** handoff 2.
- **Tomorrow's Plan sheet:** `Tomorrow's Plan`, `{DD MON} · share your day with the team|editing your shared plan|adding to your shared plan`; `ROSTER {time}`, `LOCKED · ASK YOUR MANAGER TO EDIT`, `Modality`, `Pick time`; `Send · N clients` / `Update · N clients` / `Add · N clients` / `Sending…`; `Couldn't load your roster. Check your connection and reopen.` (em dash replaced); alerts `Modality required` / `Set the modality for: {names}`, `Sessions too close`, `Same-time sessions` (`Cancel` / `Add anyway`), `Roster sync failed` (`...The plan still posts to the chat, but NO roster sessions were saved.`), `Not added to roster`; retry booking `Still double-booked`, `Booked`, `Couldn't book`.
- **Team Flags:** `TEAM FLAGS · {DD MON}` / `YOUR FLAG · ...`, `{n} OPEN`, `{n} CLOSED`; `{n} trainers · {n} clients flagged. Tap to review.` (em dash replaced); manager intro `Sessions off pace vs the weekly protocol. Add a remark under every trainer to close their flag.`; member intro `Your clients flagged off pace, with the manager's remark.`; `{n} CLIENTS FLAGGED`, `{n}/WK · {MODALITY} · NO SESSION {g}+ DAYS`; `MANAGER REMARK` / `PHYSIO HOD REMARK`, `EDITED`, `EDIT`; placeholders `Remark to close this flag (required)...` / `Edit the remark...`; `CANCEL`, `CLOSE FLAG` / `SAVE EDIT`; `AWAITING MANAGER REMARK` / `AWAITING PHYSIO HOD REMARK`; alert `Could not save remark`.
- **HOD:** `ADD A SESSION FOR A PHYSIO · TODAY OR TOMORROW`, `OPEN A TEAM CHAT`, `RESCHEDULE REQUESTS · N`; alert `Add session · {First}` / `Which day?`; `Session remark`, `What happened?`, `Save remark`; alert `Incomplete` / `Pick a category and write the remark.`
- **Message bodies (must match exactly for interop):** `Tomorrow's plan ({day}): Name 7:00 AM · Name 8:30 AM`; `Reschedule request: {name} {h:mm AM} to {h:mm AM} ({DD MON})`; `Manager moved {name}'s session to {time}{ · Mod} ({DD MON}){ · remark}`; `Rescheduled {name} to {time} ({DD MON})`; `Rejected · reschedule request for {name} ({DD MON})`; `Manager added {Client} at {time}{ · Mod} to {First}'s plan ({DD MON}){ · replaced {Trainer}'s booking at that time}`.

### 9.6 Client logic
- **Clock:** `serverNow = now + offset`; `today` / `tomorrow` via `Intl` `en-CA` + `Asia/Kolkata` on `serverNow` (tomorrow = +86400000 ms).
- **Team rule:** keep rows with `team_end` null or `>= today`; if none, the rows with the max `team_start`. Mine = `manager_id == me` or `team_json` contains me. HOD teams: current rows containing a doctor or therapist, sorted by name, `isManager:false`.
- **Query keys:** `['my-manager-team', uid]` (120 s); `['manager-chat', scoreId]` (stale 15 s, poll 60 s); `['mgr-chat-tomorrow-v2', uid, tomorrow]`; `['mgr-plan-sched','v3', ids]` (poll 120 s, 300 s on final cards); `['mgr-plan-outcome-v5', date, clientIds]` (poll 120 s live); `['mgr-member-clients', trainerId]`; `['physio-hod-identity', uid]`; `['mgr-client-protocols-v3', ids]`; `['hod-teams']`; `['hod-feed-msgs', ids]`. Plain JSON only (no Map / Set); version keys when a shape changes.
- **Invalidations:** after a roster write `mgr-plan-sched`, `trainer-roster`, `doctor-roster` (+ `crm-month-roster` after a forced add). A realtime INSERT of `tomorrow_plan` or `plan_time_edit` also refreshes `crm-month-roster` and `crm-client-roster` (debounced 400 ms).
- **Realtime channels:** `manager-chat-{screen|card}-{scoreId}` (unique per consumer); HOD `hod-feed-all`.
- **Unread:** key `mgr-chat:last-read:{scoreId}` = newest message's server `created_at`; written on thread open and when the count changes; `unread = count(sender != me && Date.parse(created_at) > Date.parse(marker))`.
- **Send:** optimistic temp id, rolled back on error; network regex `/network|fetch|timeout|connection|socket|abort/i`; backoff `[1500, 3000, 6000, 10000, 10000]`; offline error `You're offline. Reconnect and tap the message to retry.`
- **SHEET_TIMES:** 30-minute grid `05:00` to `22:30` (36 slots), shown `5:00 AM` to `10:30 PM`.
- **Compose data:** my `session_schedule` rows in tomorrow's IST window, not cancelled (earliest slot per client seeds the time); the actively-training book (`trainer_clients` + `clients`, skipping inactive / discontinued); my `training_sessions.session_type` newest first over 90 days to prefill modality. Nothing preselected; picking a row seeds `slot ?? '07:00'`.
- **Modalities:** `TRAINER = Strength, Aerobics, Aqua Aerobics, Boxing, Yoga, Pilates, Other`; `DOCTOR = Rehabilitation, Recovery, Physiotherapy`; `THERAPIST = Therapy`. Compose uses the viewer's role; Add Session uses `Therapy` (preselected) for a therapist target, else TRAINER ∪ DOCTOR; the edit dialog uses TRAINER ∪ DOCTOR plus the current value when off-list. Normalizer: lowercase map, else Title Case.
- **Missed categories:** `client_no_show` Client No-show, `trainer_no_show` Trainer No-show, `venue_issue` Venue Issue, `emergency` Emergency, `miscommunication` Miscommunication, `forgot_to_log` Forgot to Log, `other` Other.
- **Colors:** identity pink `#F06A9B` / soft `#F5B8CE`, own bubbles `#F06A9B` to `#D14E80`; gold = plans and times, green = done, red = missed or open, protocol blue `#7C8FE8`.

### 9.7 Reference implementation (Android)
- `managerChat.tsx`: `ManagerTeamChatCard`, `ManagerChat`, `MergedPlanCard`, `TeamFlagsCard`, `RequestCard`, `AddSessionModal` (+ `AddClash`), `TomorrowPlanSheet`, `HodAllFeed`, `SwipeReply`, `QuoteBlock`, `MsgBody`, `ProtocolChip` / `ProtocolPopup`; handlers `sendPlan`, `saveTimeEdit`, `approveRequest`, `rejectRequest`, `saveAdd`, `hodActRequest`, `saveHodRemark`, `saveFlagRemark`, `retryBooking`.
- `managerChatQueries.ts`: `syncServerClock` / `serverNow`, `useMyManagerTeam`, `useManagerTeamMessages`, `useManagerChatRealtime`, `useSendManagerTeamMessage`, `useManagerChatUnread` / `markManagerChatRead`, `useTomorrowCompose`, `usePlanOutcome`, `usePlanScheduleRows`, `useMemberClients`, `usePhysioHod`, `useHodTeams`, `useHodFeedMessages`, `useClientProtocols`, `tomorrowPlanBody`, `fmt12h`, `normalizeModality`.
- Route `manager-chat` is in the replay-shield list; the deep link is in `components/PushTokenManager.tsx`.

### 9.8 Probe (read-only; a signed-in manager, e.g. Sagar Sharma, team "Sagar"; ask the user for the login)
1. `HEAD /rest/v1/`: log `Date` minus device time.
2. `rpc('messenger_teams')`: team "Sagar" present; `team_json` is an array of strings.
3. `from('manager_team_messages').select('id,sender_id,kind,payload,body,created_at').eq('team_id', id).order('created_at',{ascending:false}).limit(200)`: tally kinds; payload keys match 9.3.
4. Latest `tomorrow_plan` for today: its `schedule_id`s → `rpc('crew_sched_rows',{p_ids})`; its client ids + date → `rpc('crew_plan_outcome',{p_date, p_clients})`; `logged` and `acked` present; keys build as `${trainer_id}:${client_id}`.
5. `from('profiles').select('id,role_specialization').eq('role','doctor').not('role_specialization','is',null)`: exactly one `physio_hod`.
6. Compare the same team's today card against an Android device: same sections, ticks, pills, labels.

### 9.9 Acceptance test (never write test data without the user's OK)
1. Entry card subtitle right; unread rises live when a teammate posts from Android; opening the thread clears it.
2. Text, @mention chip, the mention push reaches only that member; a quoted reply renders on Android; tapping the quote jumps and flashes.
3. Airplane mode: `NOT SENT`; `TAP TO RETRY` succeeds after reconnect; `DISCARD` removes it.
4. Compose: nothing preselected; roster slot seeds the time; modality mandatory; a 15-minute gap blocked; same time asks; backgrounding >30 s mid-pick keeps the selection.
5. Share: roster rows created / adopted; body format exact; reopen is add-only for a member; a re-share alerts only NEW conflicts.
6. Day card once per date at the last plan slot; the manager sees all sections, tiles, roll-call; a member sees only `MY DAY PLAN`.
7. A teammate's logged session shows LOGGED for the manager; a trainer's log never ticks a doctor's row for the same client.
8. Member request → manager one-tap Approve moves the roster and posts `Rescheduled ...`; the chip flips to APPROVED; Reject shows REJECTED.
9. Manager time-pill reschedule: reason required; roster moves; MGR trail shows the hops; the member gets a push.
10. Add Session incl. Force create per handoff 2.
11. Final-day missed row: the trainer's remark or the pending caption; HOD `ADD REMARK` saves with `by_role` `physio_hod`.
12. Team Flags: `CLOSE FLAG` disabled until text; OPEN → CLOSED live on Android; EDIT adds `EDITED` and a `remark_history` entry; a member sees only their block.
13. HOD (user-assisted): All Physios feed; `+ {First}` asks Today / Tomorrow; approve / reject posts nothing extra from the app; the manager stays view-only on doctor / therapist sections.
14. Push taps from foreground, background and cold start open My Crew; `odds_device_tokens` has `platform 'ios'`.

---

## 10. Consultant doctor workspace (22 to 23 Sep 2026)

Status: Android built 22 Sep, chrome / profile / call-fit changes 23 Sep; backend cycle checked live on 22 Sep on a throw-away booking; device test pending. **Known gaps:** only one consultant exists (Dr. Wasir, whose `first_name` is literally "Dr."); no consultant password on file, so no consultant has signed in to either app yet.

**What and who**
- A consultant is decided like this (profiles row of `auth.uid()`):
```ts
// tag = doctor_specialization_tag, spec = role_specialization (text[]), free = specializations (text)
const consultantTagMatch = (tag: string | null, spec: string[], free: string | null) =>
  (tag ?? '').toLowerCase() === 'consultant' || spec.some((t) => (t ?? '').toLowerCase() === 'consultant') || (free ?? '').toLowerCase().includes('consultant');
const isConsultant = profilesRole === 'doctor' && consultantTagMatch(tag, spec, free);
```
- Identity query: key `['doctor-identity-v3', uid]`, staleTime 600 000; `profiles.select('doctor_specialization_tag, role_specialization, specializations, first_name, last_name, email').eq('id', uid).maybeSingle()`; also returns `firstName`, `lastName`, `fullName`, `email`, `specializations`. (v3 because a cached v2 had no fields and hid the fork: version your key.)
- A consultant gets: the home route forked to the **Consultant Dashboard**; **All Calls** with a record popup per call (Prescription with after-call editing, Meeting Summary, AI Notes, Download PDF); **Join** (the 100ms room in a WebView); a light **Consultant Profile**; a light header and drawer. Every other doctor keeps the physio / nutrition dashboard and the dark chrome. RLS limits rows to `doctor_id = auth.uid()`.

**Backend contract (live; never create or run SQL)**
- **Table `doctor_consultation_details`:** `id, client_id, doctor_id, booked_by, consultation_date (date), start_time, end_time (time, end > start), description, meet_url, status 'scheduled'|'completed'|'cancelled', created_at, next_follow_up, prescription, prescription_approval, edit_history (jsonb array), ai_notes, meeting_summary, transcript, ai_autogen_at`. The CRM books on the web; the app never inserts.
```ts
const SLOT_SELECT = 'id, client_id, doctor_id, booked_by, consultation_date, start_time, end_time, description, meet_url, status, created_at, next_follow_up, prescription, prescription_approval, doctor:profiles!doctor_consultation_details_doctor_id_fkey(first_name, last_name), client:clients!doctor_consultation_details_client_id_fkey(first_name, last_name)';
```
- **Reads** (20 s timeout each): Dashboard `.select(SLOT_SELECT).eq('doctor_id', uid).order('consultation_date',{ascending:true}).order('start_time',{ascending:true})`; All Calls `` .select(`${SLOT_SELECT}, ai_notes, meeting_summary, edit_history`) `` same filter, both orders descending.
- **Older consultation requests (`medical_diagnosis`):** `.select('id, client_id, problem_statement, status, scheduled_at, completed_at, assigned_doctor, created_at').not('assigned_doctor','is',null).order('scheduled_at',{ascending:true})`; matched on the client: `strip = s => s.toLowerCase().replace(/\bdr\.?(?:\s+|$)/g,'').trim()`; keep a row if `strip(assigned_doctor)` contains `strip(fullName)`, or the surname when it has 3+ letters. Client names from `clients.select('id, first_name, last_name').in('id', …)` in batches of 100 (fallback "Client"). Statuses `pending | scheduled | completed | cancelled`.
- **Catalog and DOB:** `medicines.select('*').eq('is_active', true).order('name')` (`item_type` `medicine | blood_test`); `clients.select('date_of_birth').eq('id', clientId).maybeSingle()`.
- **The only direct write is Complete:** `update({ status: 'completed' }).eq('id', id)`. `prescription`, `edit_history`, `prescription_approval`, `next_follow_up`, `ai_notes`, `meeting_summary` are kept up by RPCs / edge functions behind guard triggers: never write them. Trigger `trg_consultation_completed_ai` runs `consultation_autogenerate_ai(id)` on Complete; since `20260921160000` a failure there only logs and never blocks Complete.
- **`consultation_call_ended(p_slot_id uuid) -> jsonb`** (SECURITY DEFINER; the slot's doctor, the booker, or crm / admin / super_admin; else "Not allowed for this consultation"; unknown id "Booking not found"). Returns `{posted: string[], reason}`, reason `no_transcript` | `already_generated` | `requested_recently` (under 10 min) | `no_key` | `posted`. A phone call records no transcript, so expect `no_transcript` unless a CRM was in the web room (since 23 Sep the CRM's web room records when no doctor web room is recording).
- **`amend_prescription(p_slot_id uuid, p_payload jsonb, p_note text default null) -> {prescription, edit_history}`** (the slot's doctor, or crm / admin / super_admin). Needs at least one medicine, every line named, every non-null `medicine_id` in the active catalog. A finalized Rx is copied into `history[]` and `version` goes up by one; a draft / empty Rx becomes v1 `finalized`. Named parameters only (`{}` returns PGRST202). Once approved every write raises "approved and locked".
- **`prescription_approval`** is written only by the CRM's `approve_prescription` on the web: `{approved: true, approved_at, approved_by, approved_by_name, approved_by_role, version, note}` or null. Approved = locked.
- **`prescription`:** `schema_version, status 'draft'|'finalized', version, date, finalized_at, finalized_by, updated_at, doctor{id,name}, patient{name,dob,age}, medicines[], lab_tests[], advice[], follow_up{after_value, after_unit, note}, history[], client_id, consultation_id, last_edited_by, last_edited_at`. Medicine `{line_id 'm<order>-<5 chars>', medicine_id|null, name, strength|null, dose_amount, frequency, timing, duration_value|null, duration_unit, is_sos, instruction, sort_order}`; lab test `{line_id 'l<n>', name, test_id|null, sort_order}`; advice `{line_id 'a<n>', text, sort_order}`.
- **`edit_history[]`:** `{id, at, editor_id, editor_name, editor_role, action 'finalize'|'amend'|'approve', from_version, to_version, note, medicines_before[], medicines_after[], tests_before[], tests_after[]}`.
- **`next_follow_up`** (CRM-set, read-only): `{status 'date'|'not_decided', date, note, by, by_name, by_role, at, history[]}`.
- **`ai_notes`:** `short_summary, summary_points[], clinical_impression, red_flags[], tests_suggested[], recommendations[], medications[{name, reason, dosage_note}], generated_at`. **`meeting_summary`:** `key_takeaways[{title,text}], sections[{heading, overview, timestamp, points[{text, subpoints[]}]}], action_items[{person, items[{text, timestamp}]}], generated_at`. Treat every field as optional.
- **Edge function `provision-consultation-room`:** body `{slotId}` → `{meet_url, already?}` or `{ok:false, error}`. Offered only for a scheduled booking with no `meet_url`. Send the live token (`getSession()`, if none wait 450 ms and try once more; header `Authorization: Bearer <access_token>`); on `{ok:false}` "Unauthorized", `refreshSession()` and retry once.
- **Avatar:** public bucket `avatars`, `${uid}/avatar.${ext}` (ArrayBuffer, `contentType` = mime, upsert true), then `profiles.update({ avatar_url: publicUrl }).eq('id', uid)`. Show `avatar_url + '?v=' + dataUpdatedAt`.

**Screens and exact copy**
- **Colours:** canvas gradient `#f6f7fc` → `#f2f3fa` → `#eceef8`; indigo `#5b6cf5` / `#6e7cf8` / `#8a97ff`; white cards radius 24; status: indigo scheduled, amber `#f59e0b` elapsed, emerald `#10b981` done, slate `#94a3b8` cancelled.
- **Chrome (consultant only):** header background `#f6f7fc`, dark status bar, a 42 px white round menu button (glyph `#334155`, accent `#5b6cf5`), the white Odds wordmark (height 22) on an indigo pill (`#5b6cf5` → `#7d8bfd`). Drawer: backdrop `rgba(15,23,42,0.45)`, white 300 px panel with a `#e0e7ff` right border, wordmark pill height 20, close button `#f1f5f9`; profile strip `#eef2ff` / border `#e0e7ff`, avatar gradient `#5b6cf5` → `#8a97ff`, role label "Doctor", tap opens `profile`; group labels indigo; group cards `#f8fafc` / `#e2e8f0`; active row `#eef2ff` / `#c7d2fe` / indigo text; inactive `#334155`; footer "Log out" in rose `#e11d48`.
- **Drawer items for a consultant:** one group "Workspace": "Consultant Dashboard" (`doctor-dashboard`) and "All Calls" (`doctor-consultant-calls`). The Odds Academy group is still added if the account is linked. **Hidden for consultants:** the floating Odds AI centre button and its Home launcher on every route, Reimbursement, Client Threads, Referrals, Tech Desk, Sessions, My Clients, Messenger.
- **Bottom pill** (Dashboard, All Calls, Profile; indigo gradient; bottom = safe area + 14): "Dashboard", "All calls", "Sign out" (Alert "Sign out?" / "You will need to sign in again to see your consultations.", "Cancel" / "Sign out" destructive). Pull to refresh refetches every active query.
- **Dashboard:** search "Search events, patients etc." (filters the day list by patient or description); bell with a rose dot when pending > 0 (a11y "{n} pending" / "Nothing pending"); banner clock "MMM d, yyyy · h:mm a" (ticks every 60 s), "Good Day, {fullName or firstName}!", "Have a nice {Weekday}!"; error "Could not load your bookings. Pull down to retry."; stat "Scheduled" (sub "upcoming · {n} elapsed, not completed" or "upcoming consultations"); stat "Consultations Done" (sub "this month"); card "My Scheduled Events" chip "Today" (donut "{n}%" over "busy", "Consultations today", "Completed today"); card "My Plans Done" chip "Overall" (bars "Consultations completed", "Scheduled", "Elapsed, not completed" if > 0, "Pending requests" if > 0); card "MY PROFILE" (initials, name or "Doctor", `specializations` or "Consultant", email, "{n} total consultations"); card "MY CALENDAR" + month (tap → month sheet, a11y "Open the month view"), a Sunday-first 7-day strip, day header "{Month} {d}".
- **Day list:** slot card with accent bar, "{h:mm AM} to {h:mm PM}", pill "Elapsed" (amber) / "Done" (emerald), client, description; buttons "Join Meet" (scheduled with `meet_url`), "Generate link" (scheduled without), "Complete" (scheduled), "View Reports" (always). Request rows show time or "--", status dot, client, problem statement, no actions. Empty: "No consultations this day." / "No consultations match your search."
- **Month sheet:** "My Calendar", arrows, "Today"; summary "{n} consultation(s) · {n} done · {n} upcoming · {n} elapsed" (zero parts dropped) or "No consultations this month"; Sunday-first grid with a count pill per day (amber if any elapsed, emerald if all done, else indigo); legend "Upcoming", "All done", "Elapsed, not completed"; selected day "{Weekday}, {d} {Mon}" + list.
- **Complete:** Alert "Mark as complete?" / "{client} · {EEE, d MMM yyyy} · {h:mm AM} to {h:mm PM}", "Cancel" / "Complete"; error title "Couldn't mark complete". Generate link error title "Couldn't create the video link" (fallback "Could not create the video link"). Error body mapping: "malformed array literal" → "Marking complete failed inside the autogenerate trigger. Ask the admin to run migration 20260921160000_consult_autogen_fix.sql in the SQL editor, then retry."; "Booking not found" → "This booking no longer exists. Pull to refresh."; 42501 / RLS → "You are not allowed to do this. Sign in again and retry."; timeout → "The network is slow right now. Check your connection and try again."; else the raw message or "Something went wrong. Please try again."
- **View Reports / Reports:** open the doctor client record on its Medical tab (a one-shot hint).
- **All Calls:** search "Search by patient name"; eyebrow "CONSULTATIONS"; title "All Calls"; sub "{Dr. Name} · every consultation, latest first. Select a patient to focus, open Prescription for the Rx and the AI summary." (a leading "Dr." stripped then re-added; fallback "Doctor"); range chips "All time", "Today", "This week", "This month", "Custom" ("From (yyyy-mm-dd)" placeholder "2026-09-01", "To (yyyy-mm-dd)" placeholder today); error "Could not load your calls. Pull down to retry."; KPI tiles "Total calls", "Scheduled", "Elapsed", "Completed", "With Rx", "Cancelled"; card "Patients" ("All patients" with "{n} calls"; per client: initials, name, "{n} call(s) · {n} Rx", "Last {d Mon}" or "Not seen yet", pill "Next {d Mon}" (indigo) or "{n} elapsed" (amber); tap focuses, tap again clears; empty "No calls booked yet." / "No patients match your search." / "No calls in this date range."); card "Calls" / "{name} · calls" (count, "{a} to {b} of {n}" when > 10 else "Latest first", month groups "September 2026", rows: date block, name, status chip, Rx badge "Rx v{n}" / "Rx draft", "{Weekday} · {time} to {time} · {description}"; buttons "Prescription" (muted "Empty prescription" when none), "Meeting Summary" and "AI Notes" (completed only, muted when empty), "Reports", "Complete", "Join", "Generate link"; cancelled rows 60% opacity; empty "Nothing here for this filter."); pager "Page {x} of {y}".
- **Record popup** (bottom sheet, 94% max height, keyboard-aware): client, status chip, Rx badge, close; "{EEE, d MMM yyyy} · {time} to {time} · {description}"; "Download PDF" when any Rx content; tabs "Prescription", "Meeting Summary", "AI Notes".
- **Prescription tab:** approved → badge "Approved v{n} and locked · {approved_by_name}", no edit button; else "Write prescription" (no content) / "Edit prescription". Card "Prescription" with the IST `finalized_at`; patient strip "{age} yrs · DOB {dd-Mon-yyyy} · by {doctor}"; pills "Finalized v{n}" / "Draft · not finalized", "{n} earlier version(s) kept"; block "Medicines" (DOSE; FREQUENCY "Once daily" / "Twice daily" / "Three times daily" / "Four times daily" / "At bedtime", SOS "When needed"; TIMING hidden when "Any time"; DURATION "{n} {unit}"; instruction); "Tests advised", "Recommendations", "Follow up after {n} {unit}"; empty "No prescription was written in this call."; "Edit history · {n}" newest first with headlines "Approved v{n} for the client and locked" / "Finalized v{n} in the call" / "Edited after the call: v{a} to v{b}" / "Written after the call as v{n}" + " · {IST stamp} · {editor_name or Someone} ({role})", a change line "added …; removed …; tests added …; tests removed …", the note in quotes; last line "CRM follow-up plan: {05 Sep 2026 | Not decided yet} · {note}".
- **Meeting Summary tab:** card "Meeting notes" + IST stamp; "Key takeaways" ("{title} · {text}"), one block per section heading (overview + "({timestamp})", points, subpoints "– {text}"), "Action items" by person. Empty: "No meeting notes for this call. They are written from the consultation room once the call has a transcript."
- **AI Notes tab:** card "AI summary": short summary, "Summary", "Clinical impression", "Red flags", "Medications discussed", "Recommendations", "Tests suggested". Empty: "No AI summary for this call. It is generated from the consultation room once the call has a transcript."
- **Prescription editor:** title "Edit prescription (v{n} to v{n+1})" (finalized) else "Write prescription"; sub "For {client}, {age} yrs. Saved through the edit trail; the CRM sees the new version at once."; "Medicines · {n}" (collapsed "{name}" or "Untitled medicine (tap to pick)", "{dose} · {freq} · {timing} · {n} {unit}"); open line: search "Search medicine or type your own" (up to 8 catalog matches by name / generic), 'Use "{text}" as typed', "Change"; fields "Dose" (placeholder "1"), "Duration" (digits, "5"), "Frequency" OD / BD / TDS / QID / HS / SOS, "Timing" "After food" / "Before food" / "With food" / "Empty stomach" / "Early morning" / "Before bed" / "Any time", "Duration unit" days / weeks / months, "Instruction (optional)" ("Written on the sheet instead of the built sentence"); "Remove", "Done", "Add medicine"; "Tests advised · {n}" chips, search "Search a blood test or type your own", 'Add "{text}"'; "Recommendations · one per line" (placeholder "Walk 30 minutes daily" newline "Avoid fried food"); "Follow up after" (digits, "Not set") + days / weeks / months; "Reason for the change (optional)" ("Recorded on the edit trail"); "Cancel" / "Save changes as v{next}" ("Saving"). Alerts: "Add a medicine" / "Add at least one medicine before saving."; "Check the follow-up" / "The follow-up must be a number of days, weeks or months."; "Saved" / "Prescription saved as v{n}"; "Couldn't save the prescription". Closing mid-edit: "Discard the edits?" / "The prescription has not been saved.", "Keep editing" / "Discard".
- **PDF errors:** "Couldn't build the prescription PDF" / message or "Try again."; "Sharing is not available on this device."
- **Join screen** (`doctor-consultation-join`): white bar: phone icon, client name, "Consultation room", a round "Open in browser" button, a rose "Leave" (a11y "Leave the call"). Asking: "Allow the camera and microphone to join." Denied: "The call needs the camera and the microphone. Allow both in the phone's app settings, then open the call again." + "Open app settings". Load failed: "The room did not load. Check the connection and retry, or open it in the browser." + "Retry" / "Open in browser". Leave: Alert "Leave the call?" / "The AI notes and the meeting summary start generating once you leave.", "Stay" / "Leave" (destructive).
- **Consultant Profile** (route `profile` forks to it for a consultant): photo 88 px with a `#c7d2fe` ring or initials on the indigo gradient, a "+" badge, chip "Add photo" / "Change photo" / "Uploading"; name (fallbacks: sidebar name, "Doctor"); chip "CONSULTANT"; a chip with `specializations`; email; two tiles "Total consultations" (caption "{n} completed") and "This month" (caption "{Month} · {n} completed"), plain integers; footnote "Consultant bookings plus consultation requests assigned to you; cancelled ones are left out."; alerts "Permission needed" / "Allow photo access to change your profile picture.", "Profile photo updated", "Upload failed" / {message}. No certifications, bio or client counts.

**Client logic**
- **Keys:** `['doctor-consultation-slots', uid]` (30 s, refetch 60 s); `['doctor-consultation-slots', uid, 'with-rx']` (30 s); `['consultant-dashboard', fullName]` (60 s, enabled when the name is not blank); `['medicines-catalog']` (5 min); `['consult-client-dob', clientId]` (10 min). No realtime; the 60 s poll covers it.
- **After Complete, Generate link and Leave:** invalidate prefixes `consultation-slots`, `doctor-consultation-slots`, `consultation-slots-for-clients`, `consultation-room-slot`, `consultant-dashboard`. **After an amend:** invalidate `doctor-consultation-slots` and patch the open popup with the returned `{prescription, edit_history}`.
- **Counting rules** (drop cancelled slots and requests first; "now" is the device clock):
```ts
const elapsed = (s) => s.status === 'scheduled' && new Date(`${s.consultation_date}T${s.end_time}`).getTime() < Date.now();
scheduledCard = slots(scheduled && !elapsed) + diag(scheduled && !(scheduled_at < now))
elapsedCount  = slots(elapsed) + diag(scheduled && scheduled_at < now);  pendingRequests = diag(pending)
bellDot       = pendingRequests + elapsedCount > 0;  completedCount = slots(completed) + diag(completed)
doneThisMonth = slots(completed && consultation_date in local month) + diag(completed && local month of (completed_at ?? scheduled_at))
todayTotal    = slots(consultation_date == local today) + ALL requests whose scheduled_at is today
donutPct      = todayDone / todayTotal * 100 (0 if none);  "{n} total consultations" = activeTotal
profile.total = activeTotal; profile.thisMonth = slots(consultation_date month) + diag(local month of (scheduled_at ?? completed_at))
```
- **All Calls filters:** date window compares `consultation_date` strings (Today; This week Monday to Sunday; This month; Custom only for valid `yyyy-mm-dd`); search on the patient name; client cards count non-cancelled calls ("Last" = latest date on or before today, "Next" = earliest scheduled on or after today, sorted by (Last ?? Next) desc then name); KPIs over the focused set (Scheduled = scheduled and not elapsed, With Rx = `prescription.status === 'finalized'`); 10 rows a page, any filter change resets to page 1.
- **Rx state:** "none" when no `medicines` array, or a draft with no named medicine / test / advice; "finalized" when `status === 'finalized'`; else "draft".
- **Editor payload** (the RPC decides the version):
```ts
const payload = { schema_version: 1, status: 'draft', version: rx?.version ?? 1, date: rx?.date ?? new Date().toISOString(),
  doctor: { id: slot.doctor_id, name: identity.fullName }, patient: { name: clientName, dob: dobYmdOrNull, age },
  medicines: lines.filter((m) => m.name.trim()).map((m, i) => ({ ...m, is_sos: m.frequency === 'SOS', sort_order: i + 1 })),
  lab_tests: tests.map((name, i) => ({ line_id: `l${i + 1}`, name, test_id: bloodTests.find((t) => t.name === name)?.id ?? null, sort_order: i + 1 })),
  advice: text.split('\n').map((s) => s.trim()).filter(Boolean).map((t, i) => ({ line_id: `a${i + 1}`, text: t, sort_order: i + 1 })),
  follow_up: { after_value: fu === '' ? null : Number(fu), after_unit: unit, note: '' }, history: rx?.history ?? [] };
await supabase.rpc('amend_prescription', { p_slot_id: slot.id, p_payload: payload, p_note: note.trim() || null });
```
  New line defaults: `line_id m{n}-{5 random}`, dose "1", BD, "After food", 5 days; `medicine_id` only from a catalog pick; a follow-up of 0 is refused; DOB accepts ISO or `dd/mm/yyyy`.
- **PDF** (expo-print, expo-sharing, expo-file-system):
```ts
const res = await Print.printToFileAsync({ html, width: 595, height: 842, base64: false }); // A4 in points
const dst = new File(Paths.cache, fileName); if (dst.exists) dst.delete(); await new File(res.uri).move(dst);
if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
await Sharing.shareAsync(dst.uri, { mimeType: 'application/pdf', dialogTitle: fileName, UTI: 'com.adobe.pdf' });
```
  File name `Prescription_<client>_<yyyy-MM-dd>.pdf` (client without a Mr / Ms / Mrs / Dr prefix, non-alphanumeric runs → "-", fallback "client"; the IST day of `finalized_at || date`). Dark A4 sheet (794 x 1123 CSS px, `#080808`); header logo `https://passport.oddsfitness.com/lovable-uploads/5a7e1bb8-4d58-454a-87e1-d784fec7d3f6.png` (offline: text only), "ODDS LONGEVITY", "Prescription"; NAME, DATE (e.g. "09-September-2026", IST), AGE, SEX (blank); table "Medication Schedule" (S.NO / MEDICINE / SCHEDULE / INSTRUCTIONS: "DAILY", "NIGHTLY" for HS, "AS NEEDED" for SOS; the instruction or a built sentence like "Two times a day after food for 5 days"; "No medicines prescribed."); "Additional Instructions" (advice, tests, "Follow up after {n} {unit}"); footer "DR. {NAME}", "7735582679", "enquire@oddsfitness.com", "www.oddslongevity.com". Copy the sheet CSS from the Android `src/lib/prescriptionSheet.ts` (or web `components/doctor/prescriptionPdf.ts`).
- **Join handoff:** set `{ slotId, url: meet_url, clientName }` before navigating (missing on mount → go back). Leave runs once: fire `consultation_call_ended(slotId)` (errors ignored), clear the handoff, pop. Hardware / gesture back goes to the Leave alert; in-app edge swipe disabled on this route. Close the drawer on this screen (navigating away through it would skip Leave).
- **FIT_SCRIPT** (inject both before and after load):
```js
(function () { try {
  if (window.__oddsFit) return; window.__oddsFit = true;
  var css = 'div:has(> div > [data-testid="leave_room_btn"]){gap:8px !important;justify-content:space-between !important;padding:8px 10px !important;width:100% !important;box-sizing:border-box !important}'
    + 'div:has(> [data-testid="leave_room_btn"]),div:has(> [data-testid="more_settings_btn"]){gap:6px !important;flex-shrink:1 !important;min-width:0 !important}'
    + 'html,body{overflow-x:hidden !important;overscroll-behavior:none !important;-webkit-tap-highlight-color:transparent}';
  var style = document.createElement('style'); style.id = 'odds-app-fit'; style.textContent = css;
  (document.head || document.documentElement).appendChild(style);
  function fit() {
    var leave = document.querySelector('[data-testid="leave_room_btn"]'); if (!leave) return;
    var footer = leave.parentElement && leave.parentElement.parentElement; if (!footer) return;
    footer.style.zoom = '';
    var need = 20, kids = footer.children, visible = 0;
    for (var i = 0; i < kids.length; i++) { var r = kids[i].getBoundingClientRect(); if (r.width > 0) { need += r.width; visible++; } }
    need += 8 * Math.max(0, visible - 1);
    var w = window.innerWidth; if (need > w) footer.style.zoom = String(Math.max(0.7, w / need));
  }
  var t = null; function schedule() { clearTimeout(t); t = setTimeout(fit, 150); }
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('resize', schedule); window.addEventListener('orientationchange', schedule); schedule();
} catch (e) {} })();
true;
```
- **WebView** (react-native-webview):
```tsx
<View style={{ flex: 1, paddingBottom: insets.bottom, backgroundColor: '#000' }}>
  <WebView key={attempt} source={{ uri: meetUrl }} style={{ flex: 1, backgroundColor: '#000' }} javaScriptEnabled domStorageEnabled
    mediaPlaybackRequiresUserAction={false} allowsInlineMediaPlayback allowsFullscreenVideo originWhitelist={['*']} setSupportMultipleWindows={false}
    injectedJavaScriptBeforeContentLoaded={FIT_SCRIPT} injectedJavaScript={FIT_SCRIPT} bounces={false} overScrollMode="never"
    pullToRefreshEnabled={false} allowsBackForwardNavigationGestures={false} contentInsetAdjustmentBehavior="never"
    automaticallyAdjustContentInsets={false} textZoom={100} setBuiltInZoomControls={false} startInLoadingState
    renderLoading={() => <BlackSpinner />} onError={() => setFailed(true)}
    onHttpError={(e) => { if (e.nativeEvent.statusCode >= 500) setFailed(true); }} />
</View>
```
- **iOS permissions:** declare `NSCameraUsageDescription` and `NSMicrophoneUsageDescription` (otherwise the first getUserMedia fails; have the user approve the wording). Consider `mediaCapturePermissionGrantType="grantIfSameHostElsePrompt"` so WKWebView does not prompt on every page. `NSPhotoLibraryUsageDescription` also covers the avatar.
- **Time zones:** consultation date / times are IST wall-clock values; Elapsed / today / week / month use device-local time like the web. Popup stamps are IST ("dd-Mon-yyyy h:mm AM").
- **Routes and replay shield:** `doctor-dashboard` (home, forks), `doctor-consultant-dashboard` (alias), `doctor-consultant-calls`, `doctor-consultation-join`, `profile` (forks). Shield the three consultant routes AND the consultant's home `doctor-dashboard` (it shows client names and problem statements).

**Reference implementation (Android)**
`src/lib/consultantQueries.ts`, `src/lib/prescriptionSheet.ts`, `src/components/consultantUi.tsx`, `src/screens/consultantDashboard.tsx`, `consultantCalls.tsx`, `consultationJoin.tsx`, `consultantProfile.tsx`, `src/Router.tsx` (`ProfileFork`, routes, launcher hidden for consultants), `src/data.ts` (`consultantNav`), `src/components/chrome.tsx` (`useConsultantChrome`), `src/lib/doctorQueries.ts` (identity v3), `src/screens/doctor.tsx` (`DoctorDashboard` fork).

**Probe (read-only)**
1. `profiles?select=role,doctor_specialization_tag,role_specialization,specializations&id=eq.<uid>` gives the consultant-rule inputs.
2. `doctor_consultation_details?select=<SLOT_SELECT>,ai_notes,meeting_summary,edit_history&doctor_id=eq.<uid>&order=consultation_date.desc,start_time.desc` → 200 (a non-consultant gets `[]`).
3. `medicines?select=id,name,item_type&is_active=eq.true` → 200.
4. `rpc/consultation_call_ended {"p_slot_id":"00000000-0000-0000-0000-000000000000"}` → "Booking not found"; `amend_prescription` with the zero uuid → "Booking not found". Never Complete, amend or leave a real booking as a probe.

**Acceptance test**
1. A non-consultant doctor: physio dashboard, dark chrome, full drawer, Odds AI launcher visible.
2. A consultant (Wasir, or a test doctor tagged by the user; the app never edits a profile): light dashboard, dark status icons; drawer shows only Consultant Dashboard and All Calls; no Odds AI / Home button anywhere.
3. Dashboard counts, bell, donut, bars match the rules; initials "DW" for Wasir.
4. Day-list buttons follow status; Elapsed after end time; month sheet summary and pill colours right.
5. Complete asks first; the row shows Done; lists refresh; no trigger error.
6. All Calls: every range filters; invalid custom dates ignored; patient focus narrows KPIs; 11+ rows paginate; cancelled rows faded.
7. On a completed call all three tabs render; empty states match exactly.
8. Edit prescription → "Save changes as v{n+1}": "Saved", an "Edited after the call" entry, the badge updates, the web CRM sees the new version. An approved call shows "Approved v{n} and locked" with no edit button. No medicine or follow-up 0 → the exact alert.
9. Download PDF opens the share sheet with `Prescription_<client>_<yyyy-MM-dd>.pdf`.
10. Join: iOS asks for camera and mic; the room loads with every toolbar button inside a 375 px screen above the home indicator; Leave → "Leave" sends exactly one `consultation_call_ended` and pops. A failed load offers Retry and Open in browser.
11. Profile tiles equal the rules; a photo upload updates the drawer avatar. Every consultant screen, home included, is blank in session replay.

---

## 11. Doctor Reimbursement: raise and HOD review (21 Sep 2026)

**What and who**
- A doctor raises a reimbursement request (type Cab, the only type today) with an expense date, an optional amount, an optional note and 1 to 10 payment screenshots (images or PDFs), then follows its status. The doctors' manager (physio HOD) approves or rejects each request once. After sending, the doctor cannot edit or withdraw it.
- **Who raises:** a `profiles.role = 'doctor'` user who is NOT a consultant (consultant rule in section 10). Entry points: a dashboard card on the physio / nutrition doctor dashboard, and drawer Workspace > Reimbursement (last Workspace item). Consultants and therapists have no entry point (user decision 23 Sep 2026). RLS lets any authenticated user insert a row, but only with `requester_id = auth.uid()`.
- **Who reviews:** drawer Workspace > Reimbursements (second item, after Rehab Recommendation) only when `profiles.role_specialization` (text[]) contains `'physio_hod'`. The review screen admits `isPhysioHod || role === 'admin' || role === 'super_admin'`. The RPC re-checks server-side with `is_reimbursement_reviewer(auth.uid())` (admin / super_admin, the head-doctor id `30df5c2b-0f40-4736-9f41-7cbc830a191a`, or `'physio_hod' = ANY(role_specialization)`).
- Test login: Anjana Odds (doctor + `physio_hod`, the head-doctor id) can both raise and decide; ask the user for the password.

**Backend contract (live; never create or run SQL)**
- **Table `public.reimbursements`:** `id uuid pk`, `requester_id uuid` (FK profiles, cascade), `expense_details jsonb not null`, `screenshots jsonb not null`, `status text default 'pending'` (CHECK pending | approved | rejected; nothing writes `approved` today), `approved_by jsonb null`, `paid_by jsonb null`, `created_at`, `updated_at`. Removed on 21 Sep, never send them: `requester_role`, `screenshot_path`, `from_location` / `to_location`.
- **`expense_details`** = `{"type":"cab","expense_date":"YYYY-MM-DD","amount":number|null,"note":string|null}` (CHECK: object, type in ('cab'), date castable, amount absent / null / >= 0).
- **`screenshots`** = array of 1 to 10 `{"path":"<requester_id>/<uuid>-<safe name>","name":string,"size":number|null,"type":mime|null}` (CHECK `reimbursement_screenshots_ok`).
- **`approved_by`** (RPC only): `{"id","name","role","at","decision":"approved"|"rejected","note"}`; it also records rejections, so always read `decision`. **`paid_by`** (Plutus, read-only): `{"id","name","at","amount","payout_batch_id","source":"plutus"|"manual","note"}`.
- Guard trigger errors: an insert must be pending with `approved_by` null ("A reimbursement starts as pending; use review_reimbursement to decide it"); any change to `status` / `approved_by` outside the RPC fails ("Reimbursement status can only be changed through review_reimbursement").
- RLS: insert own, select own, reviewers select all, admin all; no UPDATE / DELETE for the requester.
- **Storage:** private bucket `reimbursements`, 10 MB per object, MIME `image/*` and `application/pdf`; upload only into your own folder (`auth.uid()` first); read own folder or any reviewer via signed URL; delete own folder (rollback only).
- **RPC `review_reimbursement(p_id uuid, p_decision text, p_note text default null) returns jsonb`.** Errors verbatim, in order: "Decision must be approved or rejected"; "Only an admin or the doctors manager can review reimbursements"; "Reimbursement not found"; "This reimbursement is already approved" / "This reimbursement is already rejected". **approved** sets `approved_by` only (`status` stays `pending`); **rejected** sets `approved_by` and `status = 'rejected'`. Blank note → null. Reply = the stamp.
- Reviewer list embed: `*, requester:profiles!reimbursements_requester_id_fkey(first_name,last_name)`.

**Screens and exact copy**
- **Dashboard card** (between Emergency Leave and the HOD protocol banner): blue `#7C8FE8`, rupee icon, "Reimbursement", sub "Cab expenses with payment screenshots, reviewed by your manager", chevron.
- **Doctor screen:** back "Back"; title "Reimbursement"; same sub; pill tabs "New request" | "My requests · N pending" (gold when N > 0) else "My requests · <total>".
- **New request form** (mono caps labels): "TYPE" one chip "Cab" (preselected); "EXPENSE DATE · SWIPE FOR EARLIER" (30 IST days, today first, default today; chips "TODAY" / "YDAY" / weekday caps, day number, month caps); "AMOUNT PAID (RUPEES, OPTIONAL)" (placeholder "e.g. 450", decimal pad; invalid → red border + "Enter a number of rupees, 0 or more."); "NOTE (OPTIONAL)" (multiline, "What was the trip for?"); "PAYMENT SCREENSHOTS *" with counter "N OF 10": an 84 pt thumbnail grid (PDFs show a file icon), remove X (a11y "Remove <name>"), caption "<name> · 1.2 MB" / "340 KB"; buttons "Add screenshots" ("Add more screenshots" once there is a file) and "PDF", hidden at 10; helper "Images or PDFs, up to 10 MB each, 1 to 10 files."; submit "Submit request" (send icon), while sending "Uploading N files…" / "Uploading 1 file…"; disabled hint "A DATE AND AT LEAST ONE SCREENSHOT ARE REQUIRED".
- **My requests:** filter pills All / Pending / Approved / Rejected with counts (default All); empty "No requests yet." / "No pending requests." / "No approved requests." / "No rejected requests." each with the link "Raise one"; load error in red.
- **Request card:** "<Type> · <expense date> · ₹1,250" (no amount → drop it and show "NO AMOUNT GIVEN"); badge "Pending" (gold `#E0A53C`) / "Approved" (green `#57C98A`) / "Rejected" (red `#E76A52`) with the same colour on the left rail; the note; chips "Screenshot 1", "Screenshot 2", …; "RAISED <IST STAMP>"; decision line "Approved <stamp> by <name> · <note>" (green) or "Rejected <stamp> by <name> · <note>" (red); when `paid_by`: "Paid <stamp> ₹<amount> by <name> · <note>" (green). On the review screen the requester name is line 1.
- **Review screen:** back "Back"; title "Reimbursements"; sub "Every doctor's request. Approve or reject the pending ones."; pills Pending / Approved / Rejected / All (default Pending); search "Doctor, note or amount" with clear X; pending cards carry "Reject" (red outline) and "Approve" (green); empty "No requests waiting on you." (Pending) else "Nothing here."; not allowed: "Reimbursements" / "Doctors' manager" / "This page is for the doctors' manager only."
- **Decision sheet:** "Approve this request?" / "Reject this request?"; body "Approving saves your name and the time on the request; it stays open until it is paid out." / "Rejecting closes the request as rejected and the doctor sees your note."; summary (requester, "<Type> · <date> · ₹x" or "· no amount given", note, "N SCREENSHOTS · RAISED <STAMP>" / "1 SCREENSHOT"); note label "NOTE (OPTIONAL)" / "NOTE · TELL THE DOCTOR WHY (OPTIONAL)", placeholder "Anything to add" / "Why is it rejected?"; "Cancel" and "Approve" / "Reject" ("Saving…").
- **Alerts:** "Request sent" / "Reimbursement request sent. It is pending review."; "Couldn't send the request" / <mapped error>; "Some files were skipped" / one line per file "<name>: only images or PDFs." / "<name>: larger than 10 MB." / "<name>: at most 10 screenshots."; "Permission needed" / "Allow photo access to attach screenshots."; "Couldn't open the screenshot" / <mapped error>; "Approved" / "Approved the request from <name>."; "Rejected" / "Rejected the request from <name>."; "Couldn't approve" / "Couldn't reject" / <mapped error>.

**Client logic**
- Keys (30 s each, no realtime, not persisted): `['my-reimbursements', uid]` = `select('*').eq('requester_id', uid).order('created_at',{ascending:false}).limit(100)`; `['reimbursements-review']` = the embed, same order, `.limit(500)`, enabled only when the gate allows. Treat a non-array `screenshots` as `[]`; requester name = first + last or "Unknown". After a submit invalidate both; after a decision invalidate `['reimbursements-review']` and the `['my-reimbursements']` prefix.
- **Status for display** (never filter approved by the status column):
```ts
export const effectiveStatus = (r: { status: string; approved_by: { decision: 'approved' | 'rejected' } | null }) =>
  r.status === 'rejected' || r.approved_by?.decision === 'rejected' ? 'rejected'
  : r.approved_by?.decision === 'approved' ? 'approved' : 'pending';
```
- Validation: `canSubmit = !!uid && !!expenseDate && files.length > 0 && amountOk && !isPending`; `amountOk = t === '' || (Number.isFinite(Number(t)) && Number(t) >= 0)`; amount as number or null, note trimmed or null; a ref blocks double submits.
- File intake: only `image/*` or `application/pdf`, at most 10 MB when known, max 10 files, skip duplicates silently (same uri, or same name + size), one alert for all refused files (after 50 ms).
```ts
const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: Math.max(1, 10 - files.length), quality: 0.85 });
// name = fileName || `screenshot-${Date.now()}.jpg`; mime = mimeType || 'image/jpeg'; size = fileSize ?? null
const doc = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/*'], multiple: true, copyToCacheDirectory: true });
// name = name || 'document.pdf'; mime = mimeType || (/\.pdf$/i.test(name) ? 'application/pdf' : 'image/jpeg')
```
- iOS: `NSPhotoLibraryUsageDescription` via the expo-image-picker plugin; no camera capture here. Check on a device that HEIC picks upload as JPEG / PNG (the web reviewer must open them).
- **Submit: upload first, then insert, with rollback on any failure:**
```ts
const uploaded: ScreenshotRef[] = [];
for (const f of files) {
  const path = `${uid}/${uuidv4()}-${f.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80) || 'screenshot'}`;
  const body = await (await fetch(f.uri)).arrayBuffer();
  if (body.byteLength > 10 * 1024 * 1024) { await rollback(uploaded); throw new Error(`${f.name}: larger than 10 MB.`); }
  const { error } = await withTimeout(supabase.storage.from('reimbursements').upload(path, body, { contentType: f.mime || undefined, upsert: false }), 60_000);
  if (error) { await rollback(uploaded); throw error; }
  uploaded.push({ path, name: f.name, size: f.size ?? body.byteLength, type: f.mime || null });
}
const { data, error } = await withTimeout(supabase.from('reimbursements').insert({ requester_id: uid,
  expense_details: { type: 'cab', expense_date, amount, note }, screenshots: uploaded }).select('*').single(), 20_000);
if (error) { await rollback(uploaded); throw error; } // rollback = storage.remove(paths), 20 s, errors swallowed
```
- On success: haptic, reset the form (date back to today), filter All, switch to My requests, show the alert.
- Screenshot chips: tap → `createSignedUrl(path, 300)` (never store it); PDFs open with `Linking.openURL`, images in an in-app full-screen viewer with pinch zoom; one tap handled at a time.
- Dates and money: `expense_date` is date-only (format from its parts with `timeZone: 'UTC'` on `Date.UTC(y, m-1, d)`, en-GB "d MMM yyyy"); stamps `en-IN` IST with am / pm upper-cased; money `₹` + `toLocaleString('en-IN')`.
- Error mapping (first match wins): 42P01 / relation missing → "The reimbursements table is not set up yet. Run migration 20260921090000_reimbursements.sql in the SQL editor."; missing `screenshots` / `screenshot_path` / PGRST204 → "The reimbursements table still has the single-screenshot column. Run migration 20260921110000_reimbursements_screenshots.sql in the SQL editor."; "Bucket not found" / 404 → "The reimbursements storage bucket is not set up yet. Run migration 20260921090000_reimbursements.sql in the SQL editor."; 42501 / RLS / not authorized → "You are not allowed to do this. Sign in again and retry."; payload too large → "A screenshot is larger than 10 MB."; timeout → "The network is slow right now. Check your connection and try again."; else the server message, else "Something went wrong. Please try again."
- Both routes show payment screenshots: add them to the replay-shield sensitive routes. The decision sheet follows section 20.1 and cannot close while saving.

**Reference implementation (Android)**
`src/lib/reimbursements.ts`, `src/lib/reimbursementQueries.ts`, `src/screens/doctorReimbursements.tsx` (`DoctorReimbursements`, `DoctorReimbursementReview`, `RequestCard`, `ScreenshotChips`, `DecisionSheet`), the card in `src/screens/doctor.tsx`, nav in `src/data.ts`, the gate in `src/components/chrome.tsx`.

**Probe (read-only)**
1. `reimbursements?select=expense_details,screenshots,status,approved_by,paid_by&limit=1` → 200.
2. `...?select=requester_role&limit=1` and `...?select=screenshot_path&limit=1` → 42703 (columns gone).
3. `rpc/is_reimbursement_reviewer {"p_uid":"30df5c2b-0f40-4736-9f41-7cbc830a191a"}` → `true`.
4. Anon `rpc/review_reimbursement {"p_id":"00000000-0000-0000-0000-000000000000","p_decision":"approved"}` → "Only an admin or the doctors manager can review reimbursements" (raises before any write).

**Acceptance test**
1. A physio / nutritionist doctor sees the card and Workspace > Reimbursement; a consultant and a therapist see neither.
2. Workspace > Reimbursements appears only with `physio_hod`; a plain doctor opening the route sees "This page is for the doctors' manager only."
3. Submit disabled with no file; "-5" and "abc" show the red hint.
4. 3 images + 1 PDF; a 12 MB file and an 11th file listed under "Some files were skipped"; re-picking the same image skipped silently.
5. Submit: "Uploading 4 files…" → "Request sent" → a Pending row; `screenshots` has 4 paths under `<uid>/`, `approved_by` null.
6. Network cut mid-upload: a mapped error and no leftover objects.
7. "Screenshot 1" opens the viewer; the PDF chip opens the browser.
8. HOD Approve with a note: "Approved the request from <name>."; the row keeps `status = pending` with `approved_by.decision = approved`; the doctor sees the green line and it counts under Approved.
9. HOD Reject: `status = rejected`; a second decision alerts "This reimbursement is already approved" / "...rejected".
10. Stamps in IST on a device in another zone; the expense date never shifts. Neither screen appears in session replay.

---

## 12. Doctor cancel with paid / unpaid flow (16 to 22 Sep 2026)

**What and who**
- A doctor (and a therapist, since 16 Sep) cancels a ROSTER session (`session_schedule`, not a consultant booking) from the Today's Roster card in two ways: "Cancel Session" (no charge) or "Paid Cancellation" (a last-moment cancel, counted as paid after admin approval). The UI never says "unpaid". It is the trainer roster's two-step cancel, reused (`CancelSessionFlow`).
- Where: the Today's Roster card on the physio / nutrition doctor dashboard and the therapist dashboard (Cancel shows on rows neither cancelled nor completed; completed = `workout_session_id` set), and the Head Doctor Roster page (only uid `30df5c2b-0f40-4736-9f41-7cbc830a191a`; Cancel while `status !== 'cancelled'`; adds a "Cancelled by" toggle). Consultants have no cancel.

**Backend contract (live; never create or run SQL)**
```ts
if (!remark.trim()) throw new Error('Cancellation remark is required');
const updates: Record<string, any> = { status: 'cancelled', cancellation_remark: remark.trim(), canceled_by: canceledBy }; // 'Trainer' | 'Client'
if (attachmentUrl) updates.cancellation_attachment_url = attachmentUrl;
if (paid) { updates.paid_cancellation = true; updates.admin_approval = 'pending'; }
const { data, error } = await supabase.from('session_schedule').update(updates).eq('id', id).select().maybeSingle();
if (error) throw new Error(error.message); if (!data) throw new Error('Session not found or could not be cancelled');
```
- Photo (optional): bucket `session-attachments`, file `` `roster-cancel-${Date.now()}-${Math.random().toString(36).substring(2, 10)}-${name.replace(/[^a-zA-Z0-9.-]/g, '_')}` ``, ArrayBuffer, upsert false, store the public URL; failure "Attachment upload failed: {message}".
- After success (fire and forget, only when the row has `client_id` and `trainer_id`): `supabase.functions.invoke('notify-session-cancelled', { body: { client_id, trainer_id, scheduled_datetime, remark: cancellation_remark, session_id: id } })` (pushes the client's CRMs; errors ignored).
- CHECKs: `status IN ('scheduled','confirmed','cancelled')`; `canceled_by IN ('Client','Trainer')`; `admin_approval IS NULL OR IN ('pending','approved','rejected')`; `paid_cancellation boolean NOT NULL DEFAULT false`. **A doctor's cancel stores `canceled_by = 'Trainer'`** (the HOD's "Doctor" choice also stores `'Trainer'`); never send `'Doctor'`.
- RLS: a doctor may update only rows with `trainer_id = auth.uid()`; the head doctor has her own policies; therapists use the trainer policy.
- Admin side (context): the queue is `session_schedule` with `paid_cancellation = true` and `admin_approval = 'pending'`. Approve inserts a billable `training_sessions` row (`status 'cancelled'`, `cancelled true`, `paid_cancellation true`, `schedule_session_id = id`) and sets `approved`; reject sets `rejected`. Payouts read only `training_sessions`, so a paid cancel is paid only after approval.

**Screens and exact copy (dark theme, three steps)**
- Step 1 "Cancel Session": "How should {client_name}'s {time} session be cancelled?"; option "Cancel Session" / "Standard cancellation, no charge"; option "Paid Cancellation" / "Last-moment cancel, counted as paid after admin approval"; "Dismiss".
- Step 2 (paid only) "Paid Cancellation?": "This marks the session as a last-moment paid cancellation and raises a claim that goes to admin for approval. Continue?"; "Back" / "Yes, continue".
- Step 3 "Paid Cancellation" / "Cancel Session" (backdrop does nothing): paid "Add a remark for {client_name}'s paid cancellation, sent to admin for approval." / unpaid "Add a cancellation remark for {client_name}'s session."; HOD page only "CANCELLED BY *" with "Client" / "Doctor"; remark placeholder "Remark…" (multiline); "Attach photo (optional)" or a thumbnail with remove; the error line; "Dismiss" / "Confirm" ("Saving…"). Photo permission alert "Permission needed" / "Allow photo access to attach an image."
- Use ONE modal whose content switches between the three steps (never stack modals).

**Client logic**
- `{time}` = `new Date(scheduled_datetime).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true })`.
- Opening resets everything; Confirm is disabled until the remark is non-blank (and, on the HOD page, "Cancelled by" is chosen). `canceledBy` = the toggle value on the HOD page, else `'Trainer'`.
- Success: haptic, keyboard dismissed, close; invalidate `trainer-roster`, `doctor-today-roster`, `head-doctor-month-sessions`, `mgr-plan-sched`.
- Today's Roster query: `['doctor-today-roster', uid]` (60 s, refetch 120 s), `session_schedule` for `trainer_id = uid` in today's window (use IST bounds on iOS), hide unlogged rows before `2026-08-31T18:30:00Z`, show `workout_session_id` rows as completed.
- Optional (web has it, Android does not): a paid-cancel chip "Paid cancel, pending admin" / "Paid cancel approved" / "Paid cancel rejected" on cancelled rows.

**Reference implementation (Android)**
`src/components/cancelSessionFlow.tsx`, `src/lib/trainerQueries.ts` (`useCancelScheduledSession`), `src/screens/doctor.tsx` (`DoctorTodayRoster`, `DoctorRoster`), `src/lib/doctorQueries.ts`, `src/lib/adminRequestQueries.ts`.

**Probe (read-only)**
- As the doctor: `session_schedule?select=id,status,canceled_by,cancellation_remark,cancellation_attachment_url,paid_cancellation,admin_approval&trainer_id=eq.<uid>&status=eq.cancelled&order=updated_at.desc&limit=5`.

**Acceptance test** (only on a throw-away roster row made for the test; never cancel a real client's session)
1. Cancel shows on an open row, not on cancelled or logged rows.
2. Cancel Session: empty remark keeps Confirm disabled; with a remark the row gets `status 'cancelled'`, `canceled_by 'Trainer'`, `paid_cancellation false`, `admin_approval null`.
3. Paid Cancellation → "Yes, continue" → remark + photo: `paid_cancellation true`, `admin_approval 'pending'`, the photo URL in `session-attachments`; the admin queue grows by one.
4. HOD page: "Doctor" stores `'Trainer'`, "Client" stores `'Client'`.
5. Step 2 "Back" returns to step 1; "Dismiss" writes nothing.
6. Reject the test claim in the admin queue (do not approve: approval creates a billable row).

---

## 13. Therapist role workspace and therapy logging (24 Aug to 16 Sep 2026)

**What and who**
- `profiles.role = 'therapist'` (a `user_role` enum value) is a staff role with its own workspace. Data is trainer-shaped: assignments in `trainer_clients` (`trainer_id` = the therapist, `actively_training = true`), sessions in `training_sessions` (`session_type = 'therapy'`), roster rows in `session_schedule`. In My Crew a therapist is treated like a doctor (physio HOD authority, manager view-only). Identity colour purple `#9A7BEA`, with a purple outline "THERAPY" chip.
- Test account "Shiv Therapist" (in team Sagar, one client Vashist Dev); ask the user for the password.
- Older iOS notes (`therapist-and-push-ios-context.md`, 24 to 25 Aug) describe two client inserts, `therapist_notes`, a fixed "Therapy" modality, `session_schedule.status 'completed'` and a Recent Clients card: all superseded. Current: one RPC, a required therapy type, notes in `notes`, never 'completed' on `session_schedule`, no Recent Clients card.
- **Role plumbing:** after sign-in map `profiles.role` `'therapist'` → workspace `'therapist'`. A client account or a null role is not staff: sign out and show "This app is for Odds staff. Please use the client app to sign in." The login role picker has "Therapist"; a mismatch signs out with "These credentials belong to a Therapist account. Select "Therapist" as your role and try again." (Android has an em dash after "account").
- **Home and navigation:** one role → home map (`therapist` → `therapist-dashboard`) for the post-login redirect, back fallback, Home button and unknown routes. Drawer: Workspace: Dashboard (`therapist-dashboard`), My Clients (`therapist-clients`), Sessions (`therapist-sessions`, the shared month Sessions screen), Messenger, Client Threads; Support: Tech Desk; "Odds Academy" entries only when linked. `therapist-client-detail` goes into the replay-shield list.

**Backend contract (live; never create or run SQL)**
- **Only write path:** `therapist_log_session(p_client uuid, p_duration integer, p_note text, p_therapy_type text DEFAULT NULL) returns jsonb` (SECURITY DEFINER). Always pass all four arguments.
- Server checks (verbatim, in order): `not authenticated`; `only therapists can log therapy sessions`; `session note is required`; `duration must be greater than 0`; `client is not assigned to you`; `invalid therapy type: <value>`. Accepted types (case-insensitive): `massage_therapy` / "massage therapy", `lymphatic_drainage` / "lymphatic drainage". The app always sends a type.
- Training row inserted: `client_id`, `trainer_id = auth.uid()`, `session_type 'therapy'`, `session_name` = "Massage Therapy" or "Lymphatic Drainage" (frozen text), `scheduled_at = now()` (no backdating), `duration_minutes`, `status 'completed'`, `attendance_marked true`, `location 'Therapy'`, the note. **`workout_session_id` stays NULL on therapy rows.**
- Note column: read `notes` only (`therapist_notes` was dropped and backfilled on 25 Aug). Run probe 2 to confirm which function version is live.
- **Roster step** (best effort, today's IST day): (1) adopt today's unlogged, non-cancelled row for this therapist and client (`workout_session_id = <training id>::text`, `adopted`); else (2) link to a row already logged today (`existing_logged`); else (3) insert `{trainer_id, client_id, scheduled_datetime: now(), modality 'Therapy', session_type 'therapy', status 'scheduled', notes, workout_session_id}` (`created`). It back-links `training_sessions.schedule_session_id`; failures go to `ops_alerts` (`source 'schedule_link'`) and `roster_error`.
- `session_schedule.status` CHECK allows only scheduled / confirmed / cancelled; a roster row counts as logged when `workout_session_id IS NOT NULL`.
- **Reply:** `{ session_id, schedule_id, linked_scheduled, roster_result: 'adopted'|'existing_logged'|'created'|'failed', roster_error, detail_error }`. A non-null `roster_error` still means the session was saved.
- **AI analysis:** `functions.invoke('generate-rehab-ai-analysis', { body: { sessionId } })`, fire and forget; fills `training_sessions.rehab_ai_analysis`.
- **Crew RPCs** accept doctor OR therapist targets: `hod_doctor_reschedule`, `hod_act_on_request`, `hod_doctor_missed_remark`, `plan_manager_add_session` (HOD arm) (section 9). Errors include `only the physio HOD can do this`, `session does not belong to a doctor or therapist`, `request does not belong to a doctor or therapist`, `reason is required`, `remark is required`, `session is already logged`, `session is cancelled`.
- **RLS in place:** `get_current_user_role()` returns 'doctor' for a therapist; SELECT on assigned `clients`, all `trainer_clients`, own `session_schedule` (full access to own rows), and the clinical tables (health_reports, health_questionnaires, workout_ai_summaries, workout_exercises, workout_plan_exercises, neural_check, biological_age_history, qhp_details, client_medical_history, client_nutrition_targets, feedback). Therapists cannot write medical history.
- **Pushes:** no therapist-only push; as crew members they get the standard My Crew pushes (`data.route = 'manager-chat'`); their requests, shared plans, flag blocks and the 9 PM missed digest also go to the physio HOD.

**Screens and exact copy**
- **Dashboard:** title "Therapy Desk", sub "Your clients and today's sessions"; (1) card "ASSIGNED CLIENTS" with the count ("…" while loading) → My Clients; (2) the shared My Crew card (renders nothing outside a current team); (3) Today's Roster.
- **Today's Roster** (the doctor's card with a purple accent): header "Today's Roster" + the IST day label upper-cased (`weekday: 'long', day: '2-digit', month: 'short'`, en-IN); "<done>/<active>" + "DONE", a progress bar, pills "N Upcoming" / "N Completed" / "N Cancelled"; empty "A clear day" / "No roster sessions scheduled for today."; row: IST time with AM / PM, client, "NEXT" on the first open row at or after now minus 30 min, modality chip ("Therapy"), status chip "Scheduled" / "Confirmed" / "Completed" / "Cancelled"; distance strip "<km> km · ~<min> min drive" + "FROM YOUR LOCATION · TAP FOR LIVE ROUTE", or "Distance to client's home" + "TAP FOR ROUTE & DRIVE TIME"; open rows: "Log Session" (therapy sheet locked to that client) and "Cancel" (the flow in section 12).
- **My Clients:** back "Dashboard"; "My Clients", sub "N assigned clients" / "1 assigned client"; button "Add Session"; rows: initials, name, "<subscription_type or 'No subscription'> · N sessions" (N = sum of `sessions_total`, dropped when no packages); empty "No clients are assigned to you yet."
- **Client Detail:** back "My Clients"; name + "<subscription or 'No subscription'> · N package sessions", the "THERAPY" chip, "Add Session"; header "THERAPY SESSIONS" + count; rows newest first: "23-Sep-2026 4:05 PM" (IST), label badge, "60 MIN", status badge (green when completed), "By <therapist>", the note; empty "No therapy sessions logged yet."
- **Add Session sheet:** "Add Session", sub "Logged at the current time, marked completed."; "CLIENT" dropdown ("Pick a client…", locked when opened from detail or a roster row; empty "No assigned clients."); "THERAPY TYPE · REQUIRED" (red until picked) with cards "Massage Therapy" / "Lymphatic Drainage" (no default); "DURATION · MINUTES" stepper "−" / "+" / "MINUTES" (default 60, min 5, step 5); "SESSION NOTE · REQUIRED" (red while blank; placeholder "What happened in this session?"); "Save Session" ("Saving…"); no date / time field. Error alert "Could not save session" / <message> (fallback "Please try again.").

**Client logic**
- Assigned clients `['therapist-clients', uid]` (60 s): `trainer_clients.select('client_id, client:clients(id, first_name, last_name, status, subscription_type, client_packages(sessions_total, sessions_used))').eq('trainer_id', uid).eq('actively_training', true)`, sorted by name.
- History `['therapy-sessions', clientId]` (30 s): `training_sessions.select('id, scheduled_at, duration_minutes, status, session_name, notes, trainer:trainer_id(first_name, last_name)').eq('client_id', id).eq('session_type', 'therapy').order('scheduled_at', { ascending: false })`.
- Today's roster `['doctor-today-roster', uid]` (60 s, refetch 120 s): `session_schedule.select('id, scheduled_datetime, modality, session_type, status, workout_session_id, client_id, clients:client_id(first_name, last_name, brb_location)').eq('trainer_id', uid)` over today (use IST bounds), ascending. Embed by column (the FK-name hint does not exist). Row status `workout_session_id ? 'completed' : status`. Hide unlogged rows before `2026-08-31T18:30:00Z`.
- Save:
```ts
if (!THERAPY_MODALITIES.some((m) => m.value === type)) throw new Error('Pick a therapy type');
if (!note.trim()) throw new Error('Session note is required');
if (!(duration > 0)) throw new Error('Duration must be greater than 0');
const { data, error } = await withTimeout(supabase.rpc('therapist_log_session', { p_client: clientId, p_duration: duration, p_note: note.trim(), p_therapy_type: type }), 20_000);
if (error) throw new Error(error.message);
```
  Save is enabled only with a client, a type, a non-blank note and duration > 0. On success invalidate `['therapy-sessions', clientId]`, `['therapist-roster-today']`, `['doctor-today-roster']`, `['mgr-plan-sched']`, `['mgr-plan-outcome-v5']`, close, then fire the AI call with `data.session_id`. On `roster_error` never retry and never write your own ops alert.
- **Sessions page:** therapy rows carry no `workout_session_id`; for the therapist role read logged rows with `.or('workout_session_id.not.is.null,status.eq.completed').neq('status', 'parked')` (put the therapist flag in the query key). A roster slot whose `workout_session_id` equals a training row's `id` on the same IST day is that session: show it once.
- **My Crew:** `isHodManagedRole = (r) => r === 'doctor' || r === 'therapist'` everywhere a doctor check existed; role tag "THERAPIST" purple, "DOCTOR" blue; a therapist's compose / add-session modality is exactly `['Therapy']`, preselected; `normalizeModality('therapy')` → `'Therapy'`.
- Realtime on `training_sessions` / `session_schedule` invalidates `doctor-today-roster`, `mgr-plan-sched`, `mgr-plan-outcome-v5` and the month sessions.

**Reference implementation (Android)**
`src/lib/therapistQueries.ts`, `src/screens/therapist.tsx`, `src/screens/doctor.tsx` (`DoctorTodayRoster`), `src/lib/doctorQueries.ts` (`useDoctorTodayRoster`), `src/lib/trainerQueries.ts` (`useTrainerMonthSessions`), `src/lib/managerChatQueries.ts`, `src/screens/managerChat.tsx`; role plumbing in `src/auth.tsx` (`appRoleOf`), `src/store.tsx` (`homeRouteFor`), `src/data.ts` (`therapistNav`), `src/components/chrome.tsx`, `src/Router.tsx`.

**Probe (read-only)**
1. As Shiv: `trainer_clients?select=client_id&trainer_id=eq.<uid>&actively_training=eq.true` → at least 1 row.
2. `training_sessions?select=therapist_notes&limit=1` → expect 42703 (dropped; a 200 means it still exists: tell the user). `...?select=id,notes,session_name&session_type=eq.therapy&order=scheduled_at.desc&limit=3` → recent rows have `notes` filled.
3. Anon `rpc/therapist_log_session {"p_client":"00000000-0000-0000-0000-000000000000","p_duration":60,"p_note":"x","p_therapy_type":"massage_therapy"}` → "not authenticated" (raised before any insert). PGRST202 = signature drift: stop.

**Acceptance test**
1. Sign in as Shiv with "Therapist": Therapy Desk. With "Trainer": the wrong-role message and a sign-out.
2. Drawer: Dashboard, My Clients, Sessions, Messenger, Client Threads, Tech Desk.
3. Save disabled until a type and a note are set; no date field; the stepper never goes below 5.
4. Log from My Clients: the row at the current IST time with its label, "60 MIN", "By Shiv Therapist" and the note.
5. The DB row: type therapy, label in `session_name`, status completed, location Therapy, null `workout_session_id`, note in `notes`; one `session_schedule` row today with `workout_session_id` = the training id and status `scheduled`.
6. A second log for the same client the same IST day: still one roster row (`existing_logged`).
7. An HOD-booked roster row flips to "Completed" after "Log Session" from that row.
8. Empty note, zero duration or an unassigned client show the server text under "Could not save session".
9. The Sessions page lists every logged therapy session once.
10. My Crew: the manager sees the therapist's section read-only with a purple "THERAPIST" tag; the HOD can reschedule and add a remark; the therapist's modality offers only "Therapy".
11. `rehab_ai_analysis` fills within about 20 s; the save never waits for it. Client Detail is blank in session replay.

---

## 14. CRM communication voice memo (15 Sep 2026)

**What and who**
- A CRM logging a call can record a voice memo on Client Detail > Comms > Log Communication instead of typing. The memo uploads to storage and an edge function transcribes it; the transcript is appended to Remarks (still editable). Save writes the storage path and the length on the new `crm_communications` row. The memo plays back later on Client Detail and on the Communications page.
- Access: storage RLS and the edge function both check `profiles.role` in `crm`, `admin`, `super_admin`, `ops`. Other roles get a storage 403 on upload and "Voice memo unavailable." on playback. The row insert follows `crm_communications` RLS (crm role, actively assigned clients only).
- Web records 16 kHz mono WAV; Android records AAC `.m4a`. Both transcribe. iOS should record m4a like Android.

**Backend contract (live; never create or run SQL)**
- `crm_communications.voice_note_path text NULL` (the storage object path, never a URL) and `voice_note_duration_sec integer NULL`. Both NULL on rows without a memo.
- Bucket `crm-voice-notes`, private; INSERT, SELECT, UPDATE, DELETE for authenticated users with role crm, admin, super_admin or ops. The app enforces 25 MB itself.
- Upload: path `<client_id>/<auth_user_id>-<epoch_ms>.m4a`, body an ArrayBuffer, `{ contentType: 'audio/m4a', upsert: false }`.
- Edge function `transcribe-crm-voice-note` (POST, user JWT): body `{ "path": string, "mimeType": string }` → 200 `{ "text": string }` (trimmed; empty = no clear speech). The function reads the object with the service role, so the upload MUST finish first. Transcript is verbatim; Hindi / Hinglish stays in Latin script.
- Errors `{ "error": string }`: 401 "Not signed in"; 403 "You do not have access to voice notes"; 400 "path is required"; 404 "Could not read the recording: <storage message or 'not found'>"; 400 "That recording was empty. please record again." (file under 2048 bytes; the server string has an em dash before "please"); 500 "GEMINI_API_KEY is not configured" / the thrown message / "Unexpected error"; 502 "Transcription failed: <first 200 chars>".
- Playback: `storage.from('crm-voice-notes').createSignedUrl(path, 3600)`.
- Delete: `storage.from('crm-voice-notes').remove([path])`, best effort, only for memos discarded before Save.

**Screens and exact copy**
- Tab card "Communications" with meta "N LOGGED". "Log Communication" opens an inline form "NEW COMMUNICATION": CATEGORY, STATUS, MEDIUM, "REMARKS *" (placeholder "What was discussed?"), "VOICE MEMO", "FOLLOW-UP" (chips None, +1 day, +3 days, +7 days).
- Idle: mic button "RECORD VOICE MEMO" (a11y "Record voice memo") and the helper "Speak the note. It is transcribed into Remarks and saved with the entry so the team can listen later."
- Recording: pulsing red dot, `m:ss / 5:00`, "RECORDING", stop pill "STOP" (a11y "Stop recording").
- After stop, a memo card: a local player "MEMO" (plays the local file before the upload finishes), a trash button (a11y "Remove voice memo") and one status line:
  - "UPLOADING…" / "TRANSCRIBING…" with a spinner
  - "Upload failed: {error}" + "Retry"
  - "Memo saved, transcription failed: {error}. Type the remark, or retry." + "Retry"
  - "Transcribed into Remarks. Edit the text if anything was misheard."
  - "No clear speech detected. The memo is still attached; type the remark."
- Save button: "Save with Voice Memo" once an uploaded path exists, else "Save Communication". Disabled when Remarks is empty, while recording, while uploading or transcribing, and after a failed upload.
- Closing the form (x) with a memo attached: "Discard this communication?" / "The recorded voice memo will be deleted." with "Keep editing" (cancel) and "Discard" (destructive).
- Alerts: "Microphone needed" / "Allow microphone access to record a voice memo."; "Too short" / "Hold on a moment longer before stopping." (under 800 ms); "Could not start recording" / {message}; "Recording failed" / {message}; "Playback failed" / "Could not play this voice memo."; "Couldn't log" / {message} or "Try again.".
- Thrown errors: "The recording is empty. Try again." (under 4 KB); "The recording is over 25 MB."; "Remarks are required"; timeouts "Upload timed out. Check your connection and try again." and "transcribe-crm-voice-note timed out. Check your connection and try again." (Android has an em dash in the last two).
- Saved-memo player (history rows and each Communications page row): play / pause (a11y "Play voice memo" / "Pause voice memo"), thin progress bar, "m:ss / m:ss · VOICE MEMO"; spinner until the signed URL resolves; "Voice memo unavailable." if signing fails.
- iOS microphone string: set `["expo-audio", { "microphonePermission": "<text>" }]` in the app config and have the user approve the wording (Android sets none, so the plugin default would show).

**Client logic**
- Limit 5:00 (`VOICE_MAX_MS = 300000`); a 250 ms ticker auto-stops at the limit and keeps the take; takes under 800 ms are dropped. Duration = wall-clock elapsed, saved as `Math.max(1, Math.round(ms / 1000))`.
- Recorder: expo-audio `useAudioRecorder(RecordingPresets.HIGH_QUALITY)` (iOS: MPEG4AAC, 44.1 kHz, 128 kbps, `.m4a`). `setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })` before `prepareToRecordAsync()` and `record()`; `allowsRecording: false` after stop and before playback.
- On stop: upload (60 s timeout), keep the path, transcribe (90 s timeout), append. A `seq` counter throws away results from a take already discarded; an upload that lands after a discard is deleted.
- Append rule: `remarks.trim() ? remarks.trimEnd() + '\n' + text : text` (never replace typed text).
- Retry: path exists → transcribe again; no path → upload again. Remarks stay mandatory; a memo whose transcription failed is still saved with the row.
- Insert: `{ crm_id, client_id, call_date: new Date().toISOString(), call_status, call_medium, category, remarks: trimmed, next_follow_up_date: (now + N*24h).toISOString() | null, voice_note_path, voice_note_duration_sec }`. After success drop the path from local state so cleanup does not delete it.
- Cleanup: any uploaded but unsaved memo is deleted on trash, on Discard and on unmount.
- Keys: `['crm-client-comms', clientId]` (30 s, limit 50, select adds `voice_note_path, voice_note_duration_sec`); `['crm-comms-book', crmId]` (30 s, refetch 60 s, select adds `voice_note_path`); `['crm-voice-url', path]` (50 min, never persisted). Save invalidates `crm-client-comms`, `crm-comms-book`, `crm-stale-comms`, `crm-pending-comms`; realtime on `crm_communications` maps to the same four.
- History rows show `call_date` in IST as "dd Mon · h:mm AM".
- Edge-function error text: `JSON.parse(await error.context.text()).error`, else `error.message`.
```ts
const path = `${clientId}/${userId}-${Date.now()}.m4a`;
const body = await (await fetch(fileUri)).arrayBuffer();
if (body.byteLength < 4096) throw new Error('The recording is empty. Try again.');
if (body.byteLength > 25 * 1024 * 1024) throw new Error('The recording is over 25 MB.');
const up = await supabase.storage.from('crm-voice-notes').upload(path, body, { contentType: 'audio/m4a', upsert: false });
if (up.error) throw new Error(up.error.message);
const { data, error } = await supabase.functions.invoke('transcribe-crm-voice-note', { body: { path, mimeType: 'audio/m4a' } });
const text = typeof data?.text === 'string' ? data.text.trim() : '';
```

**Reference implementation (Android)**
`src/components/VoiceNote.tsx` (`useVoiceRecorder`, `VoiceTapButton`, `VoicePlayer`), `src/screens/crmClientDetail.tsx` (`CommsTab`, `CrmVoicePlayer`), `src/screens/crm.tsx` (`CrmComms`, route `crm-comms`), `src/lib/crmClientQueries.ts`, `src/lib/withTimeout.ts`.

**Probe (read-only)**
- `from('crm_communications').select('id, client_id, voice_note_path, voice_note_duration_sec').not('voice_note_path', 'is', null).order('call_date', { ascending: false }).limit(5)`; sign one path and GET it (200, audio bytes).
- `invoke('transcribe-crm-voice-note', { body: { path: '_probe/none.m4a', mimeType: 'audio/m4a' } })` → 404 "Could not read the recording: ..." (no AI call made); body `{}` → 400 "path is required".

**Acceptance test**
1. First tap on "RECORD VOICE MEMO" shows the iOS mic prompt; denying shows "Microphone needed".
2. Record about 10 s, STOP: "UPLOADING…" → "TRANSCRIBING…" → transcript appended under typed Remarks → "Transcribed into Remarks. …".
3. The local MEMO player plays during the upload.
4. "Save with Voice Memo" creates a row with path `<client>/<uid>-<ms>.m4a` and a duration near 10.
5. The history row plays through a signed URL; the same memo plays on the Communications page.
6. Under 1 s: "Too short", nothing uploaded. Silence: "No clear speech detected. …", Save stays disabled until text is typed.
7. Network off during upload: "Upload failed: …", Save disabled, Retry works.
8. Trash, Discard or a tab switch before Save deletes the object. At 5:00 the recorder auto-stops and keeps the take.
9. A role outside crm / admin / super_admin / ops sees "Voice memo unavailable.".

## 15. Irregular Client flag (4 Sep 2026)

**What and who**
- A CRM flags a client as "Irregular client" from Client Detail. The server stamps the flag, who set it and when on `clients.irregular_client` and keeps a history of every toggle.
- Who can toggle (enforced in the RPC): role `crm` for a client with an active `trainer_clients` row (`trainer_id = auth.uid()`, `actively_training = true`); `admin` and `super_admin` for any client; everyone else gets 42501. Android shows the toggle only on the CRM client detail screen (route `crm-client`).

**Backend contract (live; never create or run SQL)**
- `clients.irregular_client jsonb NULL` (NULL until the first toggle):
```json
{"marked":true,"at":"2026-09-04T10:15:30.123Z","by":"<uuid>","by_name":"First Last","note":null,
 "history":[{"marked":true,"at":"...","by":"<uuid>","by_name":"...","note":null}]}
```
  `at` is UTC ISO with ms and `Z`; `by_name` falls back to "CRM"; `history` keeps the last 50 toggles, oldest first.
- Only write path: `rpc('toggle_irregular_client', { _client_id: uuid, _note: string | null })` → the new jsonb. SECURITY DEFINER, locks the row, strictly flips `marked`. Never update the column directly.
- Errors: 'Not authenticated' (28000), 'Not allowed to mark this client as irregular' (42501), 'Client not found' (P0002). The role check runs first (a CRM passing a bogus id gets 42501; an admin gets P0002).

**Screens and exact copy**
- Hero card, a full-width toggle row under the status badges: pill knob (red when marked); label "Mark as irregular client" when unmarked, "Irregular client" when marked; when marked a mono line "SINCE {DD MON YYYY}" + " · BY {BY_NAME}" (uppercased).
- Tap → Alert. Mark: "Mark as irregular client?" / "{name} will be flagged as an irregular client. The time and your name are recorded." with "Cancel" and "Mark irregular" (destructive). Unmark: "Remove irregular mark?" / "{name} will no longer be flagged as irregular." with "Cancel" and "Remove mark".
- Failure: "Couldn't update" / {RPC message} or "Try again.".
- A11y role `switch`, `checked` = marked, hitSlop 10; disabled at 0.6 opacity while pending.
- Other views of the flag exist on the web only (QHP page "Irregular Clients" tab, QHP Manager "Irregular" card); Android has none.

**Client logic**
- `readIrregularMark(raw)` → null unless `raw` is an object; `marked: raw.marked === true`; null-safe for clients never toggled.
- Detail key `['crm-client-detail', clientId]` (select `*`, 60 s). Success invalidates it and `['crm-client-list']`; realtime on `clients` maps to both.
- Pass `_note: null` (no note input). Show `at` in IST: `toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()`.

**Reference implementation (Android)**
`src/lib/crmClientQueries.ts` (`IrregularMark`, `readIrregularMark`, `useToggleIrregularClient`), `src/screens/crmClientDetail.tsx` (confirm alert and toggle row).

**Probe (read-only)**
- `from('clients').select('id, irregular_client').eq('irregular_client->>marked', 'true').limit(5)` → 200.
- As admin, `rpc('toggle_irregular_client', { _client_id: '00000000-0000-0000-0000-000000000000', _note: null })` → P0002 with nothing written.

**Acceptance test**
1. CRM on an assigned client: "Mark as irregular client", grey knob.
2. Tap → "Mark irregular": red row, "Irregular client", "SINCE {today IST} · BY {YOUR NAME}"; the column shows `marked: true` and one more history entry.
3. Tap → "Remove mark": grey, `marked` false, history grew again. "Cancel" changes nothing.
4. An RPC rejection shows "Couldn't update" with the server message. A web toggle appears after realtime or a refetch. A NULL column renders unmarked.

## 16. Ops Leads: second QHP slot preference (4 Sep 2026)

**What and who**
- When Ops books or reschedules a QHP on a lead, they can add an optional second date and time. The QHP Manager sees both slots and picks one; the assessor only ever receives the chosen slot.
- Who: anyone allowed by `canEditLead` (admin, compliance_analyst, ops, plus the marketing admin id for marketing-created leads). Android: Ops Leads screen, route `ops-leads`.

**Backend contract (live; never create or run SQL)**
- `leads.qhp_pref_alt jsonb NULL` = `{ "date": "YYYY-MM-DD", "time": "HH:mm:ss" }` or NULL. The primary slot is unchanged (`qhp_pref_date`, `qhp_pref_time_from` = `qhp_pref_time_to` as `HH:mm:ss`, `qhp_pref_location`, `qhp_pref_notes`).
- Write: a direct `leads` update in the SAME patch as the other `qhp_pref_*` fields (`.update(patch).eq('id', id).select(LEAD_SELECT).single()`); add `qhp_pref_alt` to the lead select list.
- Readers: `get_lead_qhp_pref_alt_for_clients(_client_ids uuid[])` → rows `{ client_id, qhp_pref_alt }` (latest matching lead per client); `get_lead_qhp_pref_alt_for_client(_client_id uuid, _phone text default null)` → jsonb or null (client_id first, then last 10 phone digits). Both return empty / null unless the caller has `profiles.can_schedule_assessments_for_others` or is the client's assessor. The older `get_lead_qhp_prefs_for_client(s)` RPCs do NOT return the second slot. No trigger copies it onto `coach_assessment`.

**Screens and exact copy**
- In two stage sheets: `qhp_booking` ("Book QHP") and `qhp_reschedule` ("Reschedule QHP"), opened from the LeadSheet "MOVE TO STAGE" chips. Picking QHP Booked opens the sheet only when the lead lacks `qhp_pref_date` or `qhp_pref_location`; otherwise it updates the stage directly and leaves the second slot untouched.
- Under LOCATION: a collapsed link "+ Add a 2nd date & time preference (optional)". Opened, a dashed gold block: header "2ND PREFERENCE (OPTIONAL)" with a red "Remove" link; "2ND DATE (YYYY-MM-DD)" (placeholder "2026-09-05"); "2ND TIME (HH:MM · IST)" (placeholder "10:00"); an inline red error; helper "Used by the QHP Manager if the first slot can not be given.".
- Errors (identical to web): "Pick a date for the 2nd preference, or remove it"; "Pick a time for the 2nd preference, or remove it"; "2nd preference is in the past"; "Same as the first preference". Any error disables "Save & Mark QHP Booked" / "Save & Mark Reschedule QHP".

**Client logic**
```ts
const altError = !altOpen || (!altDate && !altTime) ? null
  : !/^\d{4}-\d{2}-\d{2}$/.test(altDate) ? 'Pick a date for the 2nd preference, or remove it'
  : !/^\d{2}:\d{2}$/.test(altTime) ? 'Pick a time for the 2nd preference, or remove it'
  : !isFinite(new Date(`${altDate}T${altTime}:00`).getTime()) ? 'Pick a date for the 2nd preference, or remove it'
  : new Date(`${altDate}T${altTime}:00`).getTime() < Date.now() ? '2nd preference is in the past'
  : altDate === qDate && altTime === qTime ? 'Same as the first preference' : null;
const qhp_pref_alt = altOpen && (altDate || altTime) && !altError ? { date: altDate, time: `${altTime}:00` } : null;
```
- The block starts open and pre-filled whenever `lead.qhp_pref_alt` exists (time sliced to HH:MM). A save with the block closed, removed or untouched writes `null` (clears it).
- After saving invalidate `['leads']`, `['leads-stats']`, `['leads-cold-count']`, `['leads-dump-count']`, `['leads-monthly-serials']`, `['ops-followup-reminders']`.
- Display afterwards:
  - LeadSheet (stage QHP Booked or Reschedule QHP): "QHP {dd Mon yyyy IST} · {HH:MM} · {location}" (+ " · rescheduled ×N"), then a gold chip "2ND 05-SEP · 10:00 AM" (`fmtAltSlotShort`: en-IN `{ day: '2-digit', month: 'short' }`, first space → '-', " · " + en-IN 12 h time, uppercased).
  - QHP Manager pending card, "NOTES FROM OPS": "Preferred: {YYYY-MM-DD} · {HH:MM}", a gold line "2nd: 05-Sep-2026 10:00 am", then "Location: …".
  - Schedule QHP sheet: heading "CLIENT'S PREFERRED SLOTS" (singular with one), tappable cards "1ST CHOICE" (orange) and "2ND CHOICE" (gold) that fill the date and time; helper one of "Tap a slot to use it, or set your own date and time below. Only the one you pick is sent to the assessor." / "Tap to use it, or set your own date and time below." / "You are scheduling a different slot. The assessor sees only what you set below.". The second-slot RPC runs in its own try / catch so a failure never hides the primary preferences.

**Reference implementation (Android)**
`src/screens/opsLeads.tsx` (state, validation, both sheets, stage interception, display), `src/lib/opsLeadQueries.ts` (`LEAD_SELECT`, `readQhpPrefAlt`, `fmtAltSlotShort`, `fmtSlotLong`, `useUpdateLead`), `src/lib/qhpManagerQueries.ts`, `src/screens/trainer.tsx` (Schedule QHP sheet, QHP Manager pending card).

**Probe (read-only)**
- `from('leads').select('id, stage, qhp_pref_date, qhp_pref_time_from, qhp_pref_alt').not('qhp_pref_alt', 'is', null).order('updated_at', { ascending: false }).limit(5)`
- `rpc('get_lead_qhp_pref_alt_for_clients', { _client_ids: ['00000000-0000-0000-0000-000000000000'] })` → `[]`.

**Acceptance test**
1. Book QHP without touching the link → `qhp_pref_alt` null. Open the block, fill nothing, save → null.
2. Date only → the time error, Save disabled; time only → the date error.
3. A past slot → "2nd preference is in the past"; equal to the first → "Same as the first preference".
4. A valid save writes `{date, time: 'HH:MM:00'}`; the LeadSheet shows the gold 2ND chip.
5. Reschedule opens pre-filled; "Remove" + save writes null and the chip disappears.
6. A QHP Manager sees the "2nd:" line and the 2ND CHOICE card; only the chosen slot reaches the assessor.
7. Moving to QHP Booked when date and location exist updates the stage only.

---

## 17 to 19. Not included in this document

Tech Desk (17), Referrals admin approvals (18) and the Odds AI chat cache (19) were not extracted in this pass.
Skip them for now; the user will send a separate handoff for them.

---

## 20. App-wide fix passes to mirror (2 to 7 Sep 2026)

Three Android passes: the 2 Sep scroll / touch pass, the 2 Sep UX-blocker pass, and the 7 Sep Play photo-permission fix. Copy the behaviour even where your names differ.

### 20.1 Scroll and touch rules for every sheet / modal
1. **Pad for the keyboard.** Any sheet or modal with a `TextInput` pads its bottom by `useKeyboardHeight()` (listens to `keyboardWillShow` / `keyboardWillHide` on iOS). Use ONE lift per sheet: either this padding on both platforms, or `KeyboardAvoidingView behavior="padding"` on iOS with the padding only on Android. Both at once lifts the sheet twice.
2. **Let the body shrink.** A `maxHeight` on the sheet (82% default) and a ScrollView body whose wrapper has `flexShrink: 1, minHeight: 0` (without it the inner ScrollView is clipped instead of scrolling).
3. **The backdrop is a sibling, never a parent.** Never wrap sheet content in `<Pressable onPress={() => {}}>` to swallow taps; lists and wheels inside feel sticky.
4. **`keyboardShouldPersistTaps="handled"`** on every ScrollView / FlatList near an input, including horizontal chip rows and dropdown lists (otherwise the first tap only closes the keyboard).
5. **Never mount a Modal as a sibling of an open Modal** (stacked RN Modals lock up iOS when the top one closes). Prefer an inline sub-view inside the open Modal; if unavoidable, mount the second one inside the first one's tree. Never auto-open a popup while another Modal is showing.
6. **Touch targets.** Icon-only buttons get `hitSlop` >= 10. A delete / remove icon inside a tappable row gets an explicit 28 to 32 px box and NO hitSlop (overlapping slop triggered deletes from row taps). Dropdown lists get `maxHeight` >= 300. Primary CTAs and tappable cards dim while pressed.
7. **The page wrapper already handles the keyboard** (iOS: `automaticallyAdjustKeyboardInsets`). Never add the keyboard height again in a page's bottom padding.
8. Drag grips lock scrolling on touch but only lift and buzz after 4 px of movement.
```tsx
// SheetShell pattern
const insets = useSafeAreaInsets(); const kb = useKeyboardHeight();
<Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
  <View style={{ flex: 1, justifyContent: 'flex-end' }}>
    <Pressable onPress={onClose} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)' }} />
    <Animated.View style={[styles.sheet, { maxHeight: '82%', paddingBottom: kb > 0 ? kb + 16 : insets.bottom + 20, transform: [{ translateY }] }]}>
      <View {...pan.panHandlers} style={{ alignItems: 'center', paddingVertical: 8 }}><View style={styles.grabber} /></View>
      <View style={{ flexShrink: 1, minHeight: 0 }}>{children /* ScrollView keyboardShouldPersistTaps="handled" */}</View>
    </Animated.View>
  </View>
</Modal>
// Swipe-down only on the grabber zone: start when dy > 4 && |dy| > |dx|; close when dy > 110 || vy > 0.6.
```
**Verify:** with the keyboard up the field and its primary button stay visible in every form sheet; with the keyboard up one tap on a chip / date / list row selects it; every sheet list scrolls on the first drag; a picker nested in a sheet opens and the parent still responds after it closes; tapping slightly off an icon still triggers it; tapping the far end of a row near its ✕ opens the row (no delete alert); forms show their last card above the submit bar without a large gap.

### 20.2 UX blocker rules
**A. A timeout on every network call** (sign-in, edge functions, storage upload / remove / signed URL, GPS, any heavy RPC); reset busy flags in `finally`. Prevents sign-in stuck on "Signing in…", endless "Verifying…" spinners, endless GPS spinners indoors, and dead submit bars.
```ts
export class TimeoutError extends Error { constructor(m = 'The request timed out. Check your connection and try again.') { super(m); this.name = 'TimeoutError'; } }
export const NET_MS = 20_000, SLOW_FN_MS = 90_000, UPLOAD_MS = 60_000, GPS_MS = 15_000;
export function withTimeout<T>(p: Promise<T>, ms: number, label?: string): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, rej) => { t = setTimeout(() => rej(new TimeoutError(label ? `${label} timed out. Check your connection and try again.` : undefined)), ms); });
  return Promise.race([p, timeout]).finally(() => { if (t) clearTimeout(t); }) as Promise<T>;
}
// Postgrest builders are thenables, not Promises: wrap them.
await withTimeout(Promise.resolve(supabase.rpc('trainer_add_own_session', args)) as Promise<{ data: any; error: any }>, NET_MS, 'Add session');
```
(Android's two messages join their halves with an em dash; use the period form above.) Outbox items get 45 s; quiz RPCs 6 to 8 s.

**B. Register a wipe for every per-user cache** (prevents user B seeing user A's data after an account switch, and A's queued items being sent as B).
```ts
const fns = new Set<() => Promise<void> | void>();
export function registerTeardown(fn: () => Promise<void> | void) { fns.add(fn); return () => { fns.delete(fn); }; }
const DOOMED_KEY = /^(parallel_workout_session|location:|offline-warmup:|crm-group-autojoin:|mgr-chat:last-read:)/;
let running: Promise<void> | null = null;
export function runSessionTeardown(): Promise<void> {
  if (running) return running;
  running = (async () => {
    for (const f of [...fns]) { try { await f(); } catch {} }
    try { const k = (await AsyncStorage.getAllKeys()).filter((x) => DOOMED_KEY.test(x)); if (k.length) await AsyncStorage.multiRemove(k); } catch {}
  })().finally(() => { running = null; });
  return running;
}
```
Run it from sign-out, from `onAuthStateChange` when the session goes to null after one existed, and before an account switch. Cleaners today: the react-query cache + its persisted copy, the offline outbox, the AI cache, the push-token cache, the Tech Desk last route, the quiz last-good state. Outbox items carry a `userId`; drain and UI only touch items where `!i.userId || i.userId === currentUid`.

**C. Debounce realtime invalidations** (a bulk roster create caused 50 to 100 refetches and buzzes).
```ts
const pending = new Map<string, ReturnType<typeof setTimeout>>();
export function invalidateDebounced(qc: QueryClient, queryKey: unknown[], ms = 800) {
  const k = JSON.stringify(queryKey); if (pending.has(k)) return;
  pending.set(k, setTimeout(() => { pending.delete(k); qc.invalidateQueries({ queryKey }); }, ms)); }
```
800 ms default, 400 ms for chat and ticket lists, 300 ms for ticket messages; never a haptic per event.

**D. Show an access-pending state until access is known.** Gate on `isPending` (not `isLoading`, which is false while a query is paused offline):
```tsx
if (caps.isPending || caps.isError) return <AccessPending paused={caps.isPaused} error={caps.isError} onRetry={caps.refetch} />;
```
Copy: "Checking access…" / "Waiting for connection…"; on error "Couldn't verify access", "Check your connection and try again.", Retry (hitSlop 10). Prevents a false "Manager only" denial when offline.

**E. Workout set inputs commit locally.** Each set field keeps its text in local state and commits on blur, on end-editing, or after 250 ms idle; the exercise card is a memoised component with stable callbacks; flush pending commits before add / remove / reorder / submit. Digit-only fields: `t.replace(/[^0-9]/g, '') || (t.trim() ? latest : '')`. Prevents about 1,300 re-renders per keystroke and commits landing on the wrong set.
```tsx
const SET_COMMIT_MS = 250; const pendingSetCommits = new Map<number, () => void>();
function flushPendingSetCommits() { const f = [...pendingSetCommits.values()]; pendingSetCommits.clear(); f.forEach((x) => x()); }
const setExercises = React.useCallback((u) => { flushPendingSetCommits(); setExercisesRaw(u); }, []);
```

**F. A back override for sub-views.**
```ts
export const backOverride: { handler: (() => void) | null } = { handler: null };
// screen: React.useEffect(() => { backOverride.handler = sel ? () => setSel(null) : null; return () => { backOverride.handler = null; }; }, [!!sel]);
```
The edge-swipe handler and the hardware back call the override before popping the route. Used by Messenger and Client Threads (close the open thread), Create Plan (discard guard), Workout (cleanup), the Tech Desk ticket, and the consultation call (asks before leaving). Swipe-back disabled on `workout`, `create-plan`, `doctor-consultation-join`. Every swipe-lock writer releases on unmount; the lock resets on every route change; post-save `setTimeout(goBack)` timers live in a ref and are cleared on back and unmount. Prevents losing a thread / draft / plan to a swipe, a dead swipe-back for the rest of the session, and going back two screens.

### 20.3 Persisted cache rules
```tsx
const PERSIST_PREFIXES = ['trainer-', 'my-', 'client-', 'exercise-db', 'plan-', 'approved-plans', 'modality-gate', 'sidebar-profile', 'nav-badges', 'chat-overview',
  'physio-hod-identity', 'doctor-', 'therapist-', 'therapy-', 'manager-', 'mgr-', 'hod-teams', 'app-version-requirement', 'play-store-version',
  'crm-client-list', 'crm-client-detail', 'crm-metrics', 'crm-journey-clients', 'crm-tasks', 'crm-my-tasks', 'coach-clients-overview', 'coach-overview-client', 'academy-', 'admin-', 'ops-'];
const NEVER_PERSIST = new Set(['client-sessions', 'client-reports', 'prev-exercise-data', 'session-exercises', 'crm-month-roster', 'head-doctor-month-sessions', 'hod-feed-msgs', 'doctor-day-sessions',
  'trainer-quiz-score', 'trainer-quiz-score-nav', 'trainer-quiz-question']);
shouldDehydrateQuery: (query) => {
  const d = query.state.data;
  if (d instanceof Map || d instanceof Set) return false;                 // JSON.stringify(new Map()) === '{}'
  const k0 = String(query.queryKey[0] ?? '');
  if (NEVER_PERSIST.has(k0)) return false;
  if (!PERSIST_PREFIXES.some((p) => k0 === p || k0.startsWith(p))) return false;
  if (Array.isArray(d) && d.length > 400) return false;                    // never persist a silently 1000-row-capped list
  return defaultShouldDehydrateQuery(query);
}
```
- Never persist a Map or Set (it comes back as `{}` and `data?.get(id)` throws "undefined is not a function"); also double-optional every consumer: `data?.get?.(id) ?? 0`.
- Persistence is an allow-list; `NEVER_PERSIST` overrides a matching prefix. Map these lists onto your own key names.
- Bump the persister `buster` whenever a cached shape or the allow-list changes. Keep `gcTime === maxAge` (7 days). Pull-to-refresh refetches active queries only.

### 20.4 Photo permission policy
- Android-only mechanics (the `READ_MEDIA_IMAGES` Play rejection came from `expo-screen-capture`) do not apply to iOS.
- iOS: pick photos only through `expo-image-picker` `launchImageLibraryAsync` (chat images / videos, session-cancel attachments, avatars with `allowsEditing` + `aspect [1, 1]`, reimbursements with `allowsMultipleSelection`, Tech Desk up to 5). Call `requestMediaLibraryPermissionsAsync()` first; on denial "Permission needed" / "Allow photo access to attach an image.". No camera capture anywhere.
- Info.plist: `NSPhotoLibraryUsageDescription` ("Allow Odds to access your photos to send them in chats."), location when-in-use ("Odds uses your location to log your work check-in when you open the app."). Set camera and microphone strings explicitly if you ship the voice memos (sections 14, handoff 6) and the consultant call (section 10); have the user approve the wording.

### 20.5 Standing rules
- **Health screens go into the replay-shield sensitive routes** in the same change, and you tell the user. Current Android list: Tech Desk (`tech-desk`, `tech-desk-ticket`, `tech-desk-inbox`, `tech-desk-inbox-ticket`); trainer / QHP (`client`, `workout`, `qhp`, `qhp-manager`, `qhp-stats`, `qhp-assessment-detail`, `qhp-review`); CRM (`crm-client`, `crm-qhp`, `crm-blood`, `crm-health`, `crm-assessment`, `crm-ai`); doctor and reimbursements (`doctor-client-detail`, `doctor-sessions`, `doctor-protocol-approvals`, `doctor-rehab-recommendation`, `doctor-reimbursements`, `doctor-reimbursement-review`); consultant (`doctor-consultant-dashboard`, `doctor-consultant-calls`, `doctor-consultation-join`); therapist and coach (`therapist-client-detail`, `coach-assessments`, `coach-client-overview`, `coach-progression`); ops / admin / marketing (`ops-qhp-hold`, `admin-client-detail`, `marketing-client-detail`, `b2c-reports`); academy (`academy-dashboard`, `academy-management`, `academy-qhp-analyser`, `academy-daily-goals`, `academy-weekly-summary`, `academy-senior-analyst`, `academy-teacher`, `academy-student`); chats (`messenger`, `client-threads`, `manager-chat`). Amplitude: EU server zone, session replay `sampleRate: 1`, `enableRemoteConfig: false`, mask level medium. Event properties carry only ids, screen names, roles and dimensions, never message text or form values.
- **No em or en dashes in user-facing copy** (tours, onboarding, alerts, empty states, errors). Use commas, periods or colons; "·" separators are fine.
- **IST stamps:** display every time in `Asia/Kolkata`; date keys are IST `YYYY-MM-DD` (`en-CA` + `timeZone`). Never `new Date(x.toLocaleString(...))` (Invalid Date on Hermes); use `formatToParts` with `hourCycle: 'h23'`. Split am / pm on `/\s+/` (device ICU uses U+202F). Record stamps `dd-MMM-yyyy h:mm a` in IST. Cross-device "today" comes from a server clock (offset from the Supabase REST `Date` header), not the device clock.

---
