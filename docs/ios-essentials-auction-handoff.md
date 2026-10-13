# iOS handoff: Essentials Auction, end to end (1 Oct 2026)

Paste this whole document to the iOS app's coding assistant. It clones the **Essentials Auction** exactly as it
shipped on Android (odds-app) on 1 Oct 2026: the auction page, the LIVE home card, the drawer entries for trainers
and physiotherapists, the My Crew integration, and the race-safe booking. Everything on the server is already LIVE
on the shared Supabase project `agtjszjedaenclbzgjvi` (four migrations, listed in section 1). The iOS work is UI +
hooks only. Reference implementation: Android files named per section.

## How to work through this document
1. Build in the order of the sections and report after each: what iOS already had, what you changed, what you
   verified. Type-check before starting the next section.
2. Do NOT create, alter or run any SQL, policy, trigger or function. Every RPC and table below is live (probed on
   1 Oct 2026). Never rename or re-shape an RPC (the web page, Android and this app share them).
3. Probe read-only before building (section 7). Never write test rows into production: a grab creates a real
   booking, a chat note and a crew message. The first real grab is the owner's own test, inside the window, on a
   throw-away client.
4. Standing rules: the signed-in user's id is `session.user.id`; every network call goes through the app's
   `withTimeout`; everything in India time (Asia/Kolkata); no em dashes in user-facing copy; the word is
   **"session"**, never "lot", in anything a user reads; "training" for trainers, "rehab session" for physios;
   one `Modal` at a time (a confirmation dialog mounts with a sibling backdrop, never beside another open Modal);
   hitSlop >= 10 on icon buttons; every animation loop stops under Reduce Motion.
5. Test accounts: trainer Sagar `sagaroddsfitness@gmail.com` / `Sagar07`; admin `oddsfitnessapp@gmail.com` /
   `Oddsfitness@11`. No physio password is on file (physios: Anjana Odds `30df5c2b-0f40-4736-9f41-7cbc830a191a`
   is the physio HOD; the others carry `doctor_specialization_tag = 'physiotherapist'`).

---

## 0. What it is

Clients on **Essentials by Odds** (`clients.subscription_type = 'Essentials'`, a 30-day pass, one session a day,
no package or cycle) save their own week in the client app: `clients.weekly_protocol.slots[]`, one session per
weekday at a fixed IST time, e.g. `{ "day": "Fri", "time": "07:00", "modality": "Strength" }`. The day before
each session, the auction offers it: **trainings to trainers, rehab sessions to physiotherapists**. The first one
to press **Book my session** (after a confirmation) gets it: one `session_schedule` row for tomorrow at the slot
time, a log row, an automatic note in the client's care-team chat, and a `plan_add` entry in the booker's My Crew
thread. From then on everyone sees that session as **Grabbed by <name>**. The auction is open **1:00 PM to
4:00 PM IST on the day before** and only ever shows **tomorrow**. The trainer the CRM set on that session (if any)
has the **first 30 minutes** to themselves. Two people pressing in the same instant: the database queues them on
the client row lock, the first one books, the second one is told it is taken.

Android reference: `src/lib/essentialsAuction.ts` (pure rules), `src/lib/essentialsAuctionQueries.ts` (the three
RPC hooks), `src/screens/essentialsAuction.tsx` (page + confirmation), `src/components/essentialsAuctionCard.tsx`
(home card), `src/screens/managerChat.tsx` (`addsByDate`, My Crew merge), `src/data.ts` (drawer items),
`src/components/chrome.tsx` (drawer gating), `src/icons.tsx` (`gavel`, `flame`). Feature doc:
`docs/features/android/trainer/essentials-auction.md`.

---

## 1. Backend contract (all LIVE; read only from the app)

Migrations in hub-track `supabase/migrations/`, all run on 1 Oct 2026: `20261001120000_essentials_auction.sql`
(auction), `20261001150000_essentials_auction_crew.sql` (My Crew entry), `20261001170000_essentials_auction_race.sql`
(row locks, lock_timeout), `20261001190000_essentials_auction_physio.sql` (rehab to physios),
`20261001210000_essentials_auction_no_log.sql` (no audit table), `20261001220000_essentials_auction_window.sql`
(window 1:00 PM to 4:00 PM IST).

### 1.1 `essentials_auction_config()` -> jsonb
`{ "open": "13:00", "close": "16:00", "reserve_minutes": 30, "tz": "Asia/Kolkata" }`. Read on load and every 10 minutes
(`staleTime` and `refetchInterval` 10 min, so a window change in the database reaches open apps); on any error
fall back to exactly these values. **Never hard-code the window anywhere
else**: this function is the one place it is tuned.

### 1.2 `get_essentials_auction(p_date date default null)` -> rows
Call with **no arguments** (`supabase.rpc('get_essentials_auction')`): the database takes tomorrow in India time
itself, so a phone on the wrong day still gets the right rows. Trainers, coaches and physios get tomorrow only
(any other date returns no rows); admin / super_admin / ops / crm may pass a date.

Who gets which rows (decided in the database, the app never filters by modality):
- `trainer`, `coach`: the training slots only (everything that is not rehab).
- `doctor` with `doctor_specialization_tag = 'physiotherapist'` (or the physio HOD): the rehab slots only
  (`essentials_is_rehab_modality`: modality matching rehab, rehabilitation, physio, physiotherapy, manual release).
- `admin`, `super_admin`, `ops`, `crm`: everything.
- Other doctors (nutritionists, consultants), therapists, anyone else: no rows, no error.

Columns, one row per session of tomorrow: `auction_date` (date, `YYYY-MM-DD`), `client_id` uuid, `client_name`
text, `modality` text, `slot_time` text (`HH:MM` IST, take the first 5 characters), `scheduled_for` timestamptz,
`status` text (`open` | `reserved` | `grabbed`), `trainer_id` uuid|null, `trainer_name` text|null, `grabbed_at`
timestamptz|null, `session_id` uuid|null, `preferred_trainer_id` uuid|null, `preferred_trainer_name` text|null,
`reserved_until` timestamptz|null. Sorted by `slot_time`, then `client_name`.

A row exists when the client is active and on Essentials, the current pass (last entry of
`clients.essentials_extensions`) covers the day, the day is not inside a vacation (a pass entry of kind `vacation`
with `vacation_start..vacation_end`, or an active `client_pause_history` row), and `weekly_protocol.slots` has that
weekday with a time. `grabbed` = any non-cancelled `session_schedule` row exists for that client that India day
(first by `created_at`; its trainer is "grabbed by", so a booking made elsewhere shows as grabbed too).
`reserved` = `entries[]` names a trainer for that modality and now is before `reserved_until` (window open +
`reserve_minutes` on the day before). Poll every 20 s while the screen is open.

### 1.3 `grab_essentials_session(p_client_id uuid, p_date date default null)` -> jsonb
Call with **only `p_client_id`**. Returns `{ session_id, auction_date, scheduled_for, slot_time, modality,
client_id, client_name, trainer_id, trainer_name }`.

What it does, in order: role check; for non-admins the date must be tomorrow and the clock inside the window;
`lock_timeout = 5 s`; **locks the client row** (`SELECT ... FOR UPDATE`, the queue that decides who was first);
client exists, is Essentials, is active; the pass covers the day; not away (pass vacation or pause row); the slot
for that weekday exists; rehab goes to physios only, trainings to trainers only (admins either); **re-reads the
day after the lock**: no non-cancelled booking that day; the preferred trainer's head start; the caller's own
session at the same minute; then INSERT `session_schedule {client_id, trainer_id = caller, scheduled_datetime =
date + slot time in Asia/Kolkata, modality, status 'scheduled', notes 'Essentials by Odds, booked in the trainer
auction'}` (the Essentials booking trigger runs on it too and now takes the same client row lock, so every booking
path serialises per client; the unique index on `(client_id, scheduled_datetime)` is mapped to the same sentence),
the care-team note through `essentials_client_note` ("Automatic note: Strength on Fri 2 Oct at 7:00 am is booked
with Sagar Sharma, from the auction."), and ONE `manager_team_messages` row of kind `plan_add` in the booker's
current team (section 5.7; no team: no note; the note never fails the grab). There is **no audit table**: the
`session_schedule` row (its `notes`, `trainer_id`, `created_at`) is the record (owner decision 1 Oct 2026,
migration `20261001210000_essentials_auction_no_log.sql`).

Refusals are plain sentences in `error.message`; show them as they are (after stripping a legacy
`ESSENTIALS_EXPIRED:` / `ESSENTIALS_DAILY_LIMIT:` / `ESSENTIALS_VACATION:` prefix if one appears):
"Sign in to book.", "Only trainers and physios can book from the auction.", "The auction is for tomorrow's
sessions only.", "The auction is open from 1:00 pm to 4:00 pm IST.", "Client not found.", "This client is not on
Essentials by Odds.", "This client is not active.", "Essentials by Odds does not cover 2 Oct.", "The client is away
on 2 Oct.", "The client is on vacation on 2 Oct.", "The client has no session set for Fri.", "This is a rehab
session. Only physios can book it from the auction.", "This is a training. Only trainers can book it from the
auction.", "Someone already booked this session." (also for the unique index), "This session is reserved for Riya
Sen until 1:30 pm.", "You already have a session at 7:00 am on 2 Oct.", plus the trigger's own sentences
("Essentials clients can have only 1 session per day (02-Oct-2026 already has one).", the pass / vacation ones).
Special codes: `PGRST202` = the function is missing ("The auction is not set up on the server yet."); `55P03` or
"lock timeout" = waited 5 s behind another booking ("Another trainer is booking this session right now. Give it a
moment, then pull to refresh."); `23505` / "duplicate key" = "Someone already booked this session.".

### 1.4 No log table
`essentials_auction_log` was declared by the first migration but never created, and the owner decided against it:
nothing in the app reads or expects it. "Grabbed by" and the time come from `session_schedule` through the list
RPC.

### 1.5 Grants
All functions revoked from anon; authenticated may execute; roles checked inside. An anon probe answers
401 / 42501.

---

## 2. Rules the screens follow

- **Day**: always tomorrow in India time. `istParts(now)` through `Intl.DateTimeFormat('en-US', { timeZone:
  'Asia/Kolkata', hourCycle: 'h23', ... })`, then `addDays(date, 1)`. Re-evaluate every 15 s and on foreground
  (`AppState` active). Once rows are in, the chip "Tomorrow · Fri 2 Oct" shows the server's `auction_date`.
- **Window**: `open` to `close` IST from the config (defaults 13:00 and 16:00). Phases: `before` (preview,
  buttons disabled, "Opens at 1:00 PM · in 1h 30m"), `open` ("LIVE · closes in 1h 55m"), `after` ("Closed for
  today · reopens 1:00 PM"). The device clock only decides how the buttons look; the database re-checks on every
  grab, so a wrong phone clock cannot book outside the window.
- **Status**: `open` (bookable), `reserved` (head start; bookable only by `preferred_trainer_id`), `grabbed`
  ("Grabbed by <trainer_name> · <time>"; when `trainer_id` is me, "Grabbed by you" with a YOURS stamp).
- **Button rule** (`canGrab(lot, me, win)`): grabbed -> disabled ("Yours" / "Grabbed by <name>"); window not open
  -> disabled ("Opens at 1:00 PM" / "Closed at 4:00 PM"); reserved for another trainer -> disabled ("Reserved for
  Riya Sen until 1:30 PM"); else enabled. Reason in small caps text under a disabled button.
- **One a day** is counted by the database; the screen never computes it.
- **Roles and wording**: `dbRole === 'doctor'` means a physio is looking (the database already gave them rehab
  rows only): hero subtitle and the confirmation say "rehab session" / "physio"; everyone else reads "training" /
  "trainer". Copy says "Essentials by Odds", "session" (never "lot"), commas not dashes.

---

## 3. Pure rules module (port `src/lib/essentialsAuction.ts` 1:1; no app imports; unit-test it)

```ts
export const IST = 'Asia/Kolkata';
export type AuctionConfig = { open: string; close: string; reserve_minutes: number };
export const DEFAULT_AUCTION_CONFIG: AuctionConfig = { open: '13:00', close: '16:00', reserve_minutes: 30 };
export type LotStatus = 'open' | 'reserved' | 'grabbed';
export type AuctionLot = { auction_date: string; client_id: string; client_name: string; modality: string; slot_time: string;
  scheduled_for: string; status: LotStatus; trainer_id: string | null; trainer_name: string | null; grabbed_at: string | null;
  session_id: string | null; preferred_trainer_id: string | null; preferred_trainer_name: string | null; reserved_until: string | null };
export type GrabResult = { session_id: string; auction_date: string; scheduled_for: string; slot_time: string; modality: string;
  client_id: string; client_name: string; trainer_id: string; trainer_name: string | null };

istParts(d = new Date()) -> { date: 'YYYY-MM-DD', time: 'HH:MM', minutes, weekday: 'Mon'..'Sun' }   // India time
addDays(ymd, n); weekdayOf(ymd) (UTC parse of the date string, never the device locale)
auctionTargetDate(now) = addDays(istParts(now).date, 1)
toMinutes('HH:MM'); windowState(cfg, now) -> { phase: 'before'|'open'|'after', open, minutesLeft, opensAt: '1:00 PM', closesAt: '4:00 PM' }
formatTime12('07:00') = '7:00 AM'; formatCountdown(115) = '1h 55m' (0 -> 'under a minute', 45 -> '45m', 60 -> '1h')
formatLotDate('2026-10-02') = 'Fri 2 Oct'; lotNumber(0) = 'SESSION 01'; istClock(iso) = '12:00 PM'
canGrab(lot, me, win) -> { ok, why }                         // section 2's button rule
describeGrabError(e) -> string                               // prefix strip, PGRST202, 55P03/lock timeout, 23505/duplicate, network, timeout, else the sentence
isTakenError(msg) = /already booked|already has one|only 1 session per day/i.test(msg)
```

Expected test values (Android's `auction_rules_test.js`, 34 cases, all green): `istParts(2026-10-01T23:50:00Z)` ->
`{ date: '2026-10-02', time: '05:20', minutes: 320, weekday: 'Fri' }`; target day at 23:59 IST on 1 Oct ->
`2026-10-02`, at 00:10 on 2 Oct -> `2026-10-03`; window at 11:00 -> before with 120 min, 12:59 -> before, 13:00 -> open
with 180 min left, 15:59 -> open 1 min, 16:00 -> after, 23:30 -> after, 00:10 -> before with 770 min; `canGrab` open lot in window ->
ok; before window -> "Opens at 1:00 PM"; grabbed by other -> "Grabbed by Karan Mehta"; grabbed by me -> "Yours";
reserved for t9 with me -> "Reserved for Riya Sen until 1:30 PM", with t9 -> ok.

---

## 4. Data hooks (port `src/lib/essentialsAuctionQueries.ts`)

- `useAuctionConfig()`: key `['essentials-auction-config']`, `staleTime` and `refetchInterval` 10 min, falls back to the defaults on
  any error or odd shape.
- `useEssentialsAuction(date, enabled)`: key `['essentials-auction', date]` (the app's own tomorrow only keys the
  cache so it rolls at IST midnight), `staleTime 10 s`, `refetchInterval 20 s` while enabled, RPC with **no
  arguments**; on error throw `describeGrabError(error)`; map rows as in section 1.2 (`slot_time.slice(0, 5)`,
  nulls for missing fields, `status` default `'open'`).
- `useGrabEssentialsSession()`: mutation, RPC `grab_essentials_session` with `{ p_client_id }` only; on error throw
  `describeGrabError(error)`; `onSettled` invalidate `essentials-auction`, the trainer roster / month sessions
  keys, the crew plan key (`mgr-plan-sched`), the CRM month roster, and the doctor roster / sessions keys (whatever
  this app names them).
- Neither key is persisted to disk: the auction is always read fresh.

---

## 5. Screens

### 5.1 Auction page (route `essentials-auction`; port `src/screens/essentialsAuction.tsx`)
Hero (indigo gradient `#232058 -> #3E2B7E`, soft gold disc top right, gold gavel tile `#F2C14E -> #D98B1C`):
- gold mono eyebrow **FIRST COME, FIRST SERVED**; title **Essentials Auction**; subtitle, trainers: "Tomorrow's
  Essentials by Odds trainings go to the first trainer who books them. No bidding, no waiting: tap first and the
  session is yours."; physios: "Tomorrow's Essentials by Odds rehab sessions go to the first physio who books
  them. No bidding, no waiting: tap first and the session is yours."
- chip row: "Tomorrow · Fri 2 Oct" (calendar icon) + the window pill: open = green with a pulsing ring around a
  dot, "LIVE · closes in 1h 55m"; before = gold, clock icon, "Opens at 1:00 PM · in 1h 30m"; after = grey, close
  icon, "Closed for today · reopens 1:00 PM". Mono line "WINDOW 1:00 PM TO 4:00 PM IST".
- counters OPEN (gold) / GRABBED (rose `#F06A8A`) / YOURS (green): open = rows not grabbed; grabbed = the rest;
  yours = grabbed with `trainer_id === me`.
Intro line by phase: open "Each card is one session. Book it and it goes straight on your roster; the client's
care team is told automatically."; before "Preview of tomorrow's sessions. Booking opens at 1:00 PM IST.";
after "Booking closed at 4:00 PM IST. Sessions still open go to the care team to fill." Plus a Refresh pill
(spinner while fetching). Pull to refresh works too.
Green / red banner slot under it (section 5.3).
Session cards (one per row, staggered fade-and-rise entrance 420 ms, 70 ms per card, max 8 delays):
- header: mono tag **SESSION 01**; right side: OPEN pill (flame icon, gold) or RESERVED / RESERVED FOR YOU (shield,
  blue) for status reserved; grabbed rows get a rotated (-8°) **stamp** that springs in (scale 1.7 -> 1): GRABBED
  (rose) or YOURS (gold); grabbed-by-other cards use a dimmer frame and muted time.
- the time large (Serif 34, "7:00 AM") with the modality chip beside it (colour by modality: strength orange,
  yoga / pilates purple, boxing / HIIT red, cardio / aerobics blue, rehab / physio green, else gold);
- client initials avatar + name, "Essentials by Odds · Fri 2 Oct";
- sky line (`#8FC6F0`, user icon): "Usual trainer: Riya Sen", or during the head start "Riya Sen goes first until
  1:30 PM" / "Yours first until 1:30 PM" (head start = `preferred_trainer_id && reserved_until && now <
  reserved_until && status !== 'grabbed'`);
- footer: grabbed -> result line with a check icon "Grabbed by Karan Mehta · 11:41 AM" / "Grabbed by you · 11:41
  AM"; else the **Book my session** button: gold gradient with a travelling light sweep while `canGrab.ok`
  (1.5 s sweep + 0.9 s pause), grey when disabled with the reason under it in small caps (OPENS AT 1:00 PM /
  CLOSED AT 4:00 PM / RESERVED FOR RIYA SEN UNTIL 1:30 PM).
Footer line: "India time. The server checks the window again when you book, so a wrong phone clock cannot book
outside it."
Clock: `serverNow()` (server offset applied) re-read every 15 s and on foreground, which also refetches the rows.

### 5.2 Confirmation: a centred ticket dialog (one `Modal`, fade, sibling backdrop, springs in scale 0.9 -> 1)
Header band (indigo, gold gavel tile, close button top right): eyebrow **BOOK THIS TRAINING?**, title "One tap and
the session is yours".
The ticket (gold outline, gold tint): left column mono TOMORROW, the time large (Serif 30), the date in mono
(FRI 2 OCT); a vertical divider; right column the modality chip, initials avatar, client name, "Essentials by
Odds"; a perforation row (two notches at the edges, 22 short dashes); footer mono "ESSENTIALS AUCTION" and, with
a flame icon, "FIRST COME, FIRST SERVED".
**BEFORE YOU BOOK**: three rows (gold icon tile 30x30: calendar, clock, users; bold lead; muted sentence):
- trainers: "A commitment." / "This is a commitment. The training goes on your roster for tomorrow and the
  client's care team is told it is yours."; "Fixed inside 10 hours." / "It cannot be cancelled or moved inside
  10 hours of its start, so be sure you can make it."; "One training a day." / "Essentials by Odds clients have one
  training a day. Once you book, nobody else can take this session."
- physios: the same with "rehab session" for "training" in the first, and "One session a day." / "Essentials by
  Odds clients have one session a day. Once you book, nobody else can take this session." in the third.
Buttons: ghost **Not now** and gold **Yes, book my session** (same sweep button; "Booking…" with a spinner while
pending; both disabled while pending; the backdrop and the close button do nothing while pending). Small mono
footer "THE SERVER CHECKS THE WINDOW AND THE SESSION AGAIN WHEN YOU TAP". Body scrolls on small phones
(`maxHeight 90%`).

### 5.3 After a tap
- Success: success haptic, close the dialog, green banner (spring in, slides from -10) for 7 s: "Booked. Aarav
  Mehra, Strength tomorrow at 7:00 AM is on your roster." (names from the RPC result, fall back to the row). The
  card flips to YOURS and the counters move after the invalidation.
- Refused: error haptic, close the dialog, red banner for 9 s with the sentence; when `isTakenError(msg)`, append
  " Another trainer was a moment ahead of you; the card shows who got it."; refetch the rows so the card flips to
  Grabbed by at once.
- While the dialog is open and not pending, if a poll shows that session `grabbed` by someone else: close the
  dialog, warning haptic, red banner "Taken a moment ago by <name>. The card shows who got it."
- `book()` ignores a second tap while a request is pending (one tap, one request).

### 5.4 Loading / empty / error
- Loading: spinner + "Opening tomorrow's sessions…".
- Empty: gavel tile, "No sessions for tomorrow", "No Essentials by Odds client has a training set for Fri 2 Oct
  that is still unbooked. Sessions appear as clients save their week in the app." (physios: "a rehab session").
- Error: red card, "Could not load the auction.", the message, "Try again".

### 5.5 Home card (port `src/components/essentialsAuctionCard.tsx`)
Mounted on the **trainer dashboard** right after the Sessions This Month card, before My Crew, and on the
**doctor dashboard** right after My Crew **for physiotherapists only** (`useDoctorIdentity().isPhysio`).
Renders **only while the window is open and tomorrow has at least one row**; hidden otherwise and on any error.
Look (same bones as the My Crew card, 18 radius, 1 px gold border): indigo gradient, a 3 px top strip with a
travelling gold light band (2.4 s sweep, 1.4 s pause), gold gavel tile with a breathing glow ring (1.4 s), title
"Essentials Auction" + LIVE pill (green, heartbeat ring around the dot), subtitle "3 sessions open for tomorrow ·
1 yours · closes in 1h 12m" ("Every session is taken · 1 yours" once nothing is open), chevron; a chip row with
the first three open sessions "7:00 AM · Maya" (flame for open, shield for reserved) and "+N more"; with no open
sessions a mono "TOMORROW · FRI 2 OCT". Tap anywhere -> the auction page. Clock every 30 s + foreground; the rows
poll every 20 s only while the card is shown; loops off under Reduce Motion.

### 5.6 Drawer entries and gating
- Trainer drawer: "Essentials Auction" (gavel icon) under My Work after Sessions.
- Doctor drawer: "Essentials Auction" after Sessions, visible **only when the doctor is a physiotherapist**
  (`doctor_specialization_tag = 'physiotherapist'`, or the physio HOD); the RPC returns nothing to other doctors
  anyway, so the gate is cosmetic but keep it.
- The route is the same screen for both roles; only the wording changes (section 2).
- Icons to add (24-box strokes): gavel `M14 13l-7.5 7.5a2.12 2.12 0 0 1-3-3L11 10M16 16l6-6M8 8l6-6M9 7l8 8M21 11l-8-8`;
  flame `M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5Z`.

### 5.7 My Crew integration (the Team Messenger day card; port the change in `managerChat.tsx` `addsByDate`)
The grab RPC posts one `manager_team_messages` row into the booker's current team (an ongoing `manager_score` row
that lists them as manager or in `team_json`, else the latest batch; no team: nothing): `kind = 'plan_add'`,
`sender_id = the booker`, `payload = { date: 'YYYY-MM-DD', client_id, name, trainer_id: the booker, time: 'HH:MM',
modality, schedule_id, source: 'essentials_auction' }`, body "Sagar Sharma booked Maya Rao Tech at 7:00 AM ·
Strength from the Essentials Auction (2 Oct)".
Today the day card merges `plan_add` messages only when the sender is the team manager or the physio HOD. Extend
that rule: **also accept a `plan_add` whose `payload.source === 'essentials_auction'` and whose sender equals
`payload.trainer_id`** (the booker's own auction entry). Carry `auction: true` on that entry. On the card the
entry reads "STRENGTH · AUCTION" (gold) instead of "STRENGTH · ADDED", and with no modality "BOOKED FROM THE
ESSENTIALS AUCTION" instead of "ADDED BY MANAGER"; the stream bubble's label reads "BOOKED FROM THE ESSENTIALS
AUCTION" (gold) instead of "SESSION ADDED BY MANAGER". The entry carries `schedule_id`, so the usual LOGGED /
MISSED ticks work. Manager and HOD adds are unchanged. Realtime on the thread delivers the message; the day card
re-reads the row through the existing crew queries after the grab's invalidation.

---

## 6. Edge cases already covered (keep them)
- Two bookers in the same instant: the database's client row lock queues them in arrival order; the first books,
  the second gets "Someone already booked this session." The booking trigger takes the same lock for Essentials
  clients, so no path (CRM roster, Add session, crew plan, iOS client app) can create a second row for that day.
- A wait longer than 5 s behind another transaction: `55P03`, "Another trainer is booking this session right now.
  Give it a moment, then pull to refresh."
- Double tap: blocked in the app; the server would refuse the second anyway.
- The dialog open while someone else books: closed by the poll with "Taken a moment ago by <name>."
- Vacation: a client away tomorrow (pass entry of kind `vacation`, or an active pause) has no row; the grab refuses
  it too. Example on 1 Oct 2026: Maya Rao Tech (`fa2af0c8-cab8-444a-94e7-e59113cd9d36`) has a saved week (Mon /
  Wed / Fri 07:00 Strength, Tue / Thu 19:00 Cardio, Sat 20:00 Rehab) but a vacation 2 to 5 Oct, so she reappears
  on Mon 5 Oct for Tue 6 Oct. Sunita Verma tech (`80cf8ac8-ac9c-49aa-a528-1038459b75c0`) is on Essentials with no
  week yet.
- No current team: the grab succeeds without a crew entry.
- Migration missing (`PGRST202`): "The auction is not set up on the server yet." in the error card; nothing else
  changes.
- Rehab slots never show to trainers; training slots never show to physios; a cross-role grab is refused with the
  plain sentence.

---

## 7. Verify
- Anon probe: `POST https://agtjszjedaenclbzgjvi.supabase.co/rest/v1/rpc/get_essentials_auction` with `{}` and only
  the publishable key -> 401 / `42501`. `essentials_auction_config` the same.
- As Sagar (trainer): `essentials_auction_config` -> `{open '13:00', close '16:00', reserve_minutes 30, tz}`;
  `get_essentials_auction` -> `[]` or tomorrow's training rows, never an error. As admin:
  `get_essentials_auction({ p_date: '2026-10-02' })` -> rows of any role.
- Offline tests: port the 34 cases of section 3 (clock across midnight, target day, window phases, texts, button
  rule, error mapping, `isTakenError`).
- Device, inside 1:00 PM to 4:00 PM IST with a client whose week has tomorrow's weekday: the home card lights up
  (trainer dashboard; physio dashboard for a rehab slot); the page shows the LIVE pill and the session cards; Book
  my session -> the ticket dialog -> Yes -> green banner, YOURS stamp, counters move; a second phone shows "Grabbed
  by <name>" within 20 s; tomorrow the session is on Today's Roster; the crew thread has the bubble and the day
  card shows "STRENGTH · AUCTION" under the booker. Only with the owner's go-ahead: it creates a real booking, a
  care-team note and a crew message; the admin cancels the `session_schedule` row afterwards so the session
  reopens.
- SQL after a grab (owner): `select id, client_id, trainer_id, scheduled_datetime, modality, created_at from
  session_schedule where notes like 'Essentials by Odds, booked%' order by created_at desc limit 5;`.

## 7b. Addendum (1 Oct 2026, later the same day): three more things to build

**A. QHP front-view photo on the session card** (Android: `useAuctionClientPhotos` in
`src/lib/essentialsAuctionQueries.ts`, `ClientFace` + `PhotoLightbox` in `src/screens/essentialsAuction.tsx`).
- Data: `qhp_details` is readable by trainers and physios (probed as Sagar for an unassigned client). For the
  listed `client_id`s select `client_id, created_at, ref: qhp_json->postural_assessment->front_view->>photo_reference,
  url: qhp_json->postural_assessment->front_view->>photo_url`, newest first, `limit ids.length * 6`. Per client
  take the first value that starts with `http` (recent reports hold a public `qhp-images` URL like
  `https://agtjszjedaenclbzgjvi.supabase.co/storage/v1/object/public/qhp-images/<client_id>/postural_front_<ts>.jpeg`;
  older reports hold the placeholder word `front_view_image`, skip it). Key `['essentials-auction-photos', ids]`,
  `staleTime 5 min`; on any error return `{}` (the photo is a nicety, never break the page).
- Card: when a photo exists, replace the initials avatar with a 56 px rounded photo (gold 1.5 px edge, a small
  QHP tag strip at its bottom), the line "TAP THE PHOTO FOR THE QHP FRONT VIEW" under the client name; tap opens
  a full-screen lightbox (own Modal, black 94% backdrop, the image `contain`, caption "<NAME> · QHP FRONT VIEW",
  Close). The ticket dialog shows the same photo (44 px) beside the name. No photo: initials, exactly as before.
  An image that fails to load falls back to the initials.

**B. My Crew: no reschedule for Essentials sessions.** On the day card, rows whose client is on Essentials by Odds
(any entry, not only auction ones) get: the manager's time pill disabled (no reschedule from My Crew; the plan
moves only through its own rules) and the member's RESCHEDULE request chip hidden. Data: `useClientsEssentials`
(select `id, subscription_type, essentials_extensions` from `clients` for the card's client ids, key
`['mgr-client-essentials', ids]`, `staleTime 5 min`, status through the same `computeEssentials` the Essentials
badge uses: Essentials = `subscription_type` equals "essentials" case-insensitively; the newest
`essentials_extensions` entry is the pass).

**C. ESSENTIALS badge in My Crew.** The compact ESSENTIALS pill (gold gradient, award icon; state suffix 2D LEFT /
LAST DAY / VACATION / ENDED / SOON as on the client cards) on every day-card row and every Tomorrow's Plan compose
row whose client is on Essentials, placed before the PROTOCOL chip.

## 8. Do not
- No direct writes to `session_schedule`, `clients`, `manager_team_messages` or `messages`; the only write is
  `grab_essentials_session`. Do not create an audit table.
- Do not rebuild the rows from `clients` yourself, do not filter by modality or role in the app, do not compute
  one-a-day locally.
- Do not pass a date to the RPCs as a trainer or physio.
- Do not show `paid_cancellation`; no em dashes; "session" not "lot"; "training" for trainers, "rehab session"
  for physios.
