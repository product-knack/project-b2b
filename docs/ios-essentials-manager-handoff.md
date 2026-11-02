# iOS handoff: Essentials Manager page and the unsold-session crew alerts (Android since 22 Oct 2026)

Android commits 624beb6 (22 Oct 2026: the Essentials Manager page and the unsold crew alerts), 6ab9de5 (22 Oct: the
page for the `essential_manager` specialization, capability gating) and f4ce4ab (23 Oct: assign a still-unsold
session after the close). The feature files are unchanged since then at HEAD (2aa0a9d, 2 Nov 2026); the only later
edit inside this feature is the `pageRef` type on the auction page (Expo SDK 58 strict refs, 75d7fe8), shown below as
it is today. Feature doc for background: `b2b/docs/features/android/trainer/essentials-manager.md`.

What the user sees: an **Essentials manager** gets a drawer item **Essentials Manager**. From 4:30 PM IST, one hour
before the Essentials Auction closes at 5:30 PM, the page lists tomorrow's auction sessions that have no bid. Each
one can be pushed into any running My Crew, once per crew: every member and the crew manager get a push, a gold card
in the My Crew stream and a gold alert on their home, and a tap opens the auction page scrolled to that client's
card. After the close, a session still unsold can be assigned to anyone free one hour either side of it: that person
gets the roster row, a My Crew entry and a push.

Why: owner request of 22 Oct 2026 (unsold sessions shown to the Essentials manager one hour before the close, with a
push into any crew), and the second step the same evening (after the close, assign someone whose schedule is free one
hour before and after).

Server state: **everything is live**; iOS runs no SQL. Migrations `20261022200000` (role enum), `20261022200100`
(window, unsold list, crews, push, cron), `20261022210000` (manager by specialization) and `20261022220000`
(free staff, assign) were run on 22 Oct 2026 (assignment probe 11 of 11 on 23 Oct); the edge function
`notify-essentials-unsold` is deployed; the cron `essentials-unsold-alert` runs daily. Later live migrations
(`20261023100000`, `20261023120000`, `20261026100000`, `20261027100000`) changed which client days are listed
(the `essentials_weeks` plan, days the client cancelled or tagged), not the shapes the app reads. No new package.

Related iOS handoffs (port with this one):
- `ios-crew-assigned-card-handoff.md`: an assigned session showing on the My Crew day card as ASSIGNED (28 Oct 2026).
  Without it, assignments made from this page never appear on the assignee's day card. Not repeated here.
- `ios-essentials-auction-handoff.md` and `ios-8-to-16oct-handoff.md`: the auction page itself (required).
- `ios-essentials-cancellation-handoff.md`: `EssentialsCancelledAlert`, mounted right after the unsold alert.

## 1. What the user sees (Android)

### 1.1 Who gets the page
- Anyone whose `profiles.role_specialization` contains `essential_manager` keeps their own role and home and gets the
  drawer item **Essentials Manager** (gavel icon) right after **Essentials Auction**, in the trainer drawer and in the
  doctor drawer. Live today: Sagar Sharma (a trainer) and Anjana Odds (a doctor, physio HOD).
- An account whose `profiles.role` is `essential_manager` (only this job; nobody has it today) lands on the page as
  its home and gets a two-group drawer: Workspace > **Essentials Manager**, Learn > **Odds Nucleus**.
- Admins and super admins may call the functions on the server, but the admin drawer has no item.
- Everyone else: no item. The server returns no rows to them and refuses their pushes.

### 1.2 The page
Hero card (indigo gradient `#2A1E55` to `#120E2A`, gold border, gold gavel tile):
- eyebrow **ESSENTIALS MANAGER**, title **Unsold sessions**, then the phase line, a pill and
  "AUCTION CLOSES 5:30 PM IST".

| Phase (server clock, IST) | Phase line | Pill |
|---|---|---|
| before 4:30 PM | Unsold sessions appear here from 4:30 PM, one hour before the auction closes at 5:30 PM. | OPENS 4:30 PM (gold) |
| 4:30 to 5:30 PM | Sessions with no bid yet. Push one to a crew and every member gets an alert. | countdown, e.g. 1 H 0 MIN TO THE CLOSE, 18 MIN TO THE CLOSE (green) |
| after 5:30 PM | The auction closed at 5:30 PM. Sessions with no bid can be assigned to anyone free one hour either side. | CLOSED · ASSIGN (gold) |

The times come from the server (`essentials_unsold_window`); the clock re-reads every 15 s and when the app returns
to the foreground.

Notice line under the hero (gold box, tap to dismiss):
- after a push: "Pushed Ishita Sheoran to Team Alpha. 6 members alerted." ("1 member alerted." for one);
- after an assignment: "Ishita Sheoran at 7:00 AM is assigned to Riya Sen. They have been told and it is on their
  roster.";
- after a refusal: the server's sentence (section 2.3), else "Could not push the session." / "Could not assign the
  session.".

The list:
- loading: spinner and "Checking tomorrow's sessions…";
- error: "Could not load the sessions.", the error message, and a red **Try again** pill;
- empty: green check, **Nothing unsold**, "Every session in tomorrow's auction has a bid, a decision or someone
  assigned.";
- otherwise "3 UNSOLD · TOMORROW", then one card per session, ordered by time then client name.

Each card: a gold initials tile, the client name, "7:00 AM · Strength · usually Riya Sen" (the "usually" part only
when the client has a usual trainer), a red pill **0 BIDS** (or **NO BIDS** once the round was decided with no bids),
one green line per earlier push ("Pushed to Team Alpha at 4:41 PM (6 members)"), then one button:
- before 4:30 PM: **Push to a crew**, greyed and disabled, with "Pushing opens at 4:30 PM." under it;
- 4:30 to 5:30 PM: **Push to a crew**, or **Push to another crew** once it was pushed somewhere;
- after 5:30 PM: **Assign someone free** (person-plus icon); greyed and disabled with "This session has already
  started." once the session time has passed.

The cards show before 4:30 PM too (the list is read live); only the button waits for the window.

### 1.3 Pushing a session to a crew (4:30 to 5:30 PM)
A bottom sheet (one Modal, two steps inside it; backdrop tap or Back closes it unless a push is running):
1. **Push Ishita Sheoran to a crew**, "7:00 AM · Strength tomorrow. Pick the crew whose members should bid. A session
   can go to several crews, once each.", then one row per running crew: purple people tile, team name,
   "Aman Verma · 6 members" (the crew manager's name, member count), and **PICK** on the right. A crew this session
   was already pushed to is greyed, reads **PUSHED** in green and cannot be picked. Loading: spinner. No crew: "No
   crew is running right now.". Button **Cancel**.
2. **Push to Team Alpha?**, "6 members and Aman Verma get this push and a card in their My Crew:", a gold box with
   the push text "Ishita Sheoran at 7:00 AM · Strength tomorrow is still unsold in the Essentials Auction. Answer and
   bid before 5:30 PM.", then **Back** and **Push now** (spinner and "Pushing…" while it runs).

Success: haptic, the sheet closes, the notice reads "Pushed ... alerted.", the card gains its "Pushed to ..." line and
the button turns into **Push to another crew**. A refusal: the sheet goes back to step 1 and the server's sentence is
in the notice on the page.

### 1.4 Assigning after the close
**Assign someone free** opens a second sheet (same frame, two steps):
1. **Assign Ishita Sheoran**, "7:00 AM · Strength tomorrow. Everyone below has nothing within an hour either side of
   it that day. Fewest sessions first.", then one row per free person: initials tile (blue for a physio, green
   otherwise), name, "Trainer · 3 sessions that day · nearest 9:00 AM" or "Coach · Free all day" (the role reads
   Trainer, Coach, Doctor or Physio), a gold **TRAINED THIS CLIENT YESTERDAY** mark when it applies (marked, not
   blocked), and **PICK**. Loading: spinner. Error: the message in red. Nobody: "Nobody is free an hour either side of
   this session.". Button **Cancel**.
2. **Assign to Riya Sen?**, "Trainer · 3 sessions that day · nearest 9:00 AM · trained this client yesterday. The
   session goes on their roster and they get this push:", a gold box "Riya Sen: Ishita Sheoran, 7:00 AM Strength
   tomorrow, has been assigned to you by the Essentials manager. It is on your Today's Roster.", then **Back** and
   **Assign now** ("Assigning…").

Success: haptic, the sheet closes, the notice reads "... is assigned to ...", and the card leaves the list (the
session is booked). A refusal (for example the person just got busy): back to step 1, the free list reloads, and the
server's sentence is in the notice.

### 1.5 Crew members
- **Home alert** (trainer home; the Doctor Dashboard for physios only): a gold card, eyebrow
  **ESSENTIALS AUCTION · STILL UNSOLD**, title **A session pushed to your crew** (or **3 sessions pushed to your
  crew**), then up to three rows: "Ishita Sheoran · 7:00 AM · Strength" over "Pushed by Sagar Sharma · bid before
  5:30 PM" ("Pushed by the Essentials manager" when the name is missing), with an **Answer and bid** pill. A tap opens
  the auction page on that client's card. The card shows only while the auction for that session is still open; after
  the 5:30 PM close of the day before the session it disappears. Nothing renders otherwise.
- **My Crew stream card** (everyone in the crew, the manager too): gold card, eyebrow
  **UNSOLD IN THE ESSENTIALS AUCTION** with the post time on the right ("4:41 PM"), the line
  "Ishita Sheoran · 7:00 AM · Strength", the text "Sagar Sharma pushed this session to the crew. No bid yet. Answer the
  client's questions before 5:30 PM to win it." and an **Open in the auction** pill. After the close: "... pushed this
  session to the crew. This auction has closed.", the card dims and the pill reads **Closed** (disabled).
- **Auction page**: opened from the alert, the crew card or the push, the page scrolls to that client's card and
  outlines it in gold (2 pt, radius 22). The focus clears when the page is left, so the next visit opens at the top.
  The rest is the normal auction (Answer and bid, the questions, the close).

### 1.6 Pushes
| Who | When | Title | Body | Tap on Android |
|---|---|---|---|---|
| every Essentials manager | 4:30 PM IST, when tomorrow has unsold sessions | Essentials sessions still unsold | 3 sessions for tomorrow have no bids. The auction closes at 5:30 PM. Push them to a crew. | the Essentials Manager page |
| every crew member + the crew manager | on Push now | Essentials session still unsold | Ishita Sheoran at 7:00 AM · Strength tomorrow (23 Oct) is still unsold in the Essentials Auction. Answer and bid before 5:30 PM. | the auction page on that card |
| the assignee | on Assign now | Essentials session assigned to you | Ishita Sheoran, 7:00 AM Strength tomorrow, has been assigned to you by Sagar Sharma. It is on your Today's Roster. | no route (see Not confirmed) |

## 2. Data / server contract

### 2.1 Who counts as a manager
`essentials_is_unsold_manager(uid)` (server only): `role_specialization` contains `essential_manager`, or
`profiles.role` is `essential_manager`, `admin` or `super_admin`. Every function below checks it inside. All are
granted to `authenticated` (anon revoked). The app calls them with the arguments below only; `p_date` is left to its
default (tomorrow, IST).

### 2.2 The calls
| Call | Arguments sent | Answer the app reads |
|---|---|---|
| `rpc('essentials_unsold_window')` | none | jsonb `{alert_from: '16:30', close: '17:30', assign_buffer_minutes: 60, tz: 'Asia/Kolkata'}`. `alert_from` is the auction close minus 60 minutes, so moving the close moves both. The app reads `alert_from` and `close` (`parseWindow`, falls back to 16:30 / 17:30). |
| `rpc('get_essentials_unsold')` | none (`p_date` default tomorrow) | rows `{auction_date, client_id, client_name, modality, slot_time 'HH:MM', scheduled_for timestamptz, preferred_trainer_id, preferred_trainer_name, bids_count, pushes jsonb [{score_id, team_name, pushed_at, member_count}] oldest first, round_result null or 'no_bids', mode}`. Open sessions with 0 bids, plus after the close the ones decided `no_bids` until someone is booked. `mode` (home / virtual) is not read. A non-manager gets zero rows, not an error. |
| `rpc('essentials_manager_crews')` | none | rows `{score_id, team_name, manager_id, manager_name, member_count, team_start, team_end}`: the `manager_score` teams running today (IST), by team name. `member_count` counts `team_json` (the manager is extra). |
| `rpc('push_essentials_unsold_to_crew', {p_client_id, p_slot_time, p_score_id})` | client uuid, 'HH:MM', crew `score_id` | jsonb `{ok: true, message_id, member_count, team_name}`; `member_count` includes the crew manager. |
| `rpc('get_essentials_free_staff', {p_client_id, p_slot_time})` | client uuid, 'HH:MM' | rows `{id, name, role ('trainer' / 'coach' / 'doctor'), is_physio, sessions_that_day, nearest_session timestamptz or null, trained_yesterday}`, fewest sessions first, then by name. A training lists active trainers and coaches; a rehab session lists physios. Busy (left out): a non-cancelled roster row, a doctor consultation or a QHP assessment within 60 minutes either side. |
| `rpc('assign_essentials_unsold', {p_client_id, p_slot_time, p_trainer_id})` | client uuid, 'HH:MM', staff uuid | jsonb `{ok: true, session_id, trainer_name, client_name}` |
| `from('manager_team_messages').select('id, payload, created_at').eq('team_id', scoreId).eq('kind', 'auction_unsold').order('created_at', {ascending: false}).limit(20)` | my crew's `scoreId` (`useMyManagerTeam`) | the member home alert; existing crew read policies. |

### 2.3 Refusals (plain sentences; the app shows `error.message` as it comes)
Push:
- "Only the Essentials manager can push sessions to a crew."
- "Unsold sessions can be pushed from 04:30 PM IST, one hour before the auction closes." (the SQL formats this time
  with `HH12:MI AM`, so it has the leading zero; the page button is disabled before 4:30 PM, so it is rarely seen)
- "The auction has closed."
- "This session is no longer unsold."
- "That crew is not running right now."
- "Already pushed to this crew."

Assign:
- "Only the Essentials manager can assign a session."
- "Sessions can be assigned after the auction closes at 5:30 PM IST."
- "This session is no longer unsold."
- "This session has already started."
- "Riya Sen now has something within an hour of 7:00 AM. Pick someone else."
- from the booking step (`essentials_book_session`, live text of `20261026100000`): "This session is already
  booked.", "Riya Sen already has a session at 7:00 am on 23 Oct.", "The client cancelled this session.", "The client
  has no session set for Fri.", "Client not found."

Time-outs: every call goes through `withTimeout(..., NET_MS, label)` with the labels 'Auction window',
'Unsold sessions', 'Crews', 'Push to crew', 'Free staff', 'Assign session', 'Crew alerts'.

### 2.4 What the server writes
- **Push to a crew**: one `manager_team_messages` row `{team_id: score_id, sender_id: the manager, kind:
  'auction_unsold', payload: {date 'YYYY-MM-DD' (the session day), client_id, name, time 'HH:MM', modality, score_id,
  pushed_by, pushed_by_name, close 'HH:MM', source: 'essentials_unsold'}, body: the member push text}`; one
  `essentials_unsold_pushes` row (definer functions only, unique per date + session + crew); a push to every uuid in
  the crew's `team_json` plus its manager through pg_net, the edge function `notify-essentials-unsold` and
  `pushToStaff` (the same `odds_device_tokens` the other staff pushes use). Push data:
  `{type: 'essentials_unsold', route: 'essentials-auction', client_id, date}`. The live `crew_message_push` trigger
  does not push `auction_unsold`, so members get one push, not two.
- **Manager alert**: cron `essentials-unsold-alert`, `0 11 * * *` UTC (4:30 PM IST), pushes every active manager when
  tomorrow has unsold sessions. Push data: `{type: 'essentials_unsold_manager', route: 'essentials-manager'}`.
- **Assign**: books through `essentials_book_session(..., 'assigned')`: a `session_schedule` row (note "Essentials by
  Odds, assigned by the Essentials manager after the auction"), a care-team note, a My Crew `plan_add` row sent as the
  assignee with `payload.source = 'essentials_assigned'` (the day card part is `ios-crew-assigned-card-handoff.md`),
  one `essentials_unsold_assignments` row, and the push to the assignee with data
  `{type: 'essentials_assigned', date, client_id}` (no `route`).

### 2.5 Cache and store
| Key | Stale | Poll | Invalidated by |
|---|---|---|---|
| `['essentials-unsold-window']` | 10 min | none | |
| `['essentials-unsold']` | 20 s | 60 s | push, assign |
| `['essentials-manager-crews']` | 5 min | none | |
| `['essentials-free-staff', clientId, slotTime]` | 15 s | none | assign (and a refetch after a refused assign) |
| `['unsold-crew-alerts', scoreId]` | 30 s | 60 s | |

A push also invalidates `['manager-chat']`; an assignment invalidates `['essentials-auction']`, `['manager-chat']` and
`['trainer-roster']`. All query data are plain objects (safe for the persisted cache). The My Crew stream already
refreshes through its realtime channel.

Store key (new): `auctionFocusClientId: string | null`, set by the home alert, the crew card and the member push;
read and cleared by the auction page.

## 3. Code to port

### 3.0 What the iOS repo must already have (same codebase)
`serverNow` and `useMyManagerTeam` (returning `scoreId`) in `src/lib/managerChatQueries.ts`; `withTimeout` and
`NET_MS` in `src/lib/withTimeout.ts`; `Page` forwarding its ref to the ScrollView and taking `pb`
(`src/screens/common.tsx`); `Card` (with `radius`), `Serif`, `Body`, `Mono` in `src/components/primitives`; icons
`gavel`, `checks`, `users`, `userPlus`, `send`, `chevRight`, `nucleus`; theme `C.gold`, `C.green`, `C.red`,
`C.purple`, `C.blue`, `C.ink`, `C.ink3`, `C.muted2`, `C.muted3` and `hexA`; `expo-linear-gradient`, `expo-haptics`,
`react-native-safe-area-context`; the Essentials Auction screen. If a name differs on iOS, change the import only.

### 3.1 `src/lib/essentialsUnsold.ts` (new, pure: no React Native imports; copy byte for byte)
sha256 of the Android file: `49f475acd9e8254ac747f161027b469a30cff0b8aa37d57fc3e787e79d7a24e0` (9,199 bytes, LF).
```ts
/* Essentials Auction: unsold sessions and the Essentials manager (22 Oct 2026). Pure rules, no native imports.
   Owner: "one hour before the auction ends, show the unsold session cards to the essential manager (profiles.role
   = essential_manager, whose dashboard is only this page) with the option to push a card into any My Crew; every
   member of that crew gets an alert and a push; tapping the card in My Crew opens that card on the auction page".
   Backend: hub-track migration 20261022200100 (get_essentials_unsold, essentials_manager_crews,
   push_essentials_unsold_to_crew, essentials_unsold_window, cron essentials-unsold-alert). */

export type UnsoldPush = { score_id: string; team_name: string | null; pushed_at: string; member_count: number };
export type UnsoldLot = {
  auction_date: string;
  client_id: string;
  client_name: string;
  modality: string;
  slot_time: string; // "07:00" IST
  scheduled_for: string;
  preferred_trainer_id: string | null;
  preferred_trainer_name: string | null;
  bids_count: number;
  pushes: UnsoldPush[];
  /** null while the auction runs; 'no_bids' after the close (assignable) */
  round_result?: string | null;
};
export type Crew = { score_id: string; team_name: string; manager_id: string; manager_name: string | null; member_count: number; team_start: string; team_end: string | null };
export type UnsoldWindow = { alert_from: string; close: string }; // "16:30", "17:30" IST

export const DEFAULT_UNSOLD_WINDOW: UnsoldWindow = { alert_from: '16:30', close: '17:30' };

const IST_OFFSET_MS = 330 * 60_000;
/** IST "HH:MM" and "YYYY-MM-DD" of an instant. */
export const istParts = (ms: number): { ymd: string; hm: string } => {
  const d = new Date(ms + IST_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, '0');
  return { ymd: `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`, hm: `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}` };
};

/** The IST minute of day of "HH:MM". */
const minutesOf = (hm: string): number => { const [h, m] = hm.split(':').map(Number); return (h || 0) * 60 + (m || 0); };

export type UnsoldPhase = 'before' | 'open' | 'closed';
/** before: the alert window has not opened; open: alert_from <= now < close; closed: after the close. */
export const unsoldPhase = (nowMs: number, w: UnsoldWindow = DEFAULT_UNSOLD_WINDOW): UnsoldPhase => {
  const m = minutesOf(istParts(nowMs).hm);
  if (m < minutesOf(w.alert_from)) return 'before';
  if (m < minutesOf(w.close)) return 'open';
  return 'closed';
};

/** "4:30 PM" from "16:30". */
export const hm12 = (hm: string): string => {
  const [h, m] = hm.split(':').map(Number);
  const hh = ((h || 0) % 12) || 12;
  return `${hh}:${String(m || 0).padStart(2, '0')} ${(h || 0) < 12 ? 'AM' : 'PM'}`;
};

/** Whole minutes left until the close today (0 when past). */
export const minutesToClose = (nowMs: number, w: UnsoldWindow = DEFAULT_UNSOLD_WINDOW): number =>
  Math.max(0, minutesOf(w.close) - minutesOf(istParts(nowMs).hm));

export const countdownText = (nowMs: number, w: UnsoldWindow = DEFAULT_UNSOLD_WINDOW): string => {
  const m = minutesToClose(nowMs, w);
  if (m <= 0) return 'Auction closed';
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min to the close` : `${m} min to the close`;
};

export const phaseText = (phase: UnsoldPhase, w: UnsoldWindow = DEFAULT_UNSOLD_WINDOW): string => {
  if (phase === 'before') return `Unsold sessions appear here from ${hm12(w.alert_from)}, one hour before the auction closes at ${hm12(w.close)}.`;
  if (phase === 'closed') return `The auction closed at ${hm12(w.close)}. Sessions with no bid can be assigned to anyone free one hour either side.`;
  return `Sessions with no bid yet. Push one to a crew and every member gets an alert.`;
};

/** The crew card line in My Crew and the home alert: "Ishita Sheoran · 7:00 AM · Strength". */
export const unsoldLine = (name: string, slotTime: string, modality: string | null | undefined): string =>
  `${name} · ${hm12(slotTime)}${modality ? ` · ${modality}` : ''}`;

/** The push body, mirrored from the server for the preview in the picker sheet. */
export const pushPreview = (lot: Pick<UnsoldLot, 'client_name' | 'slot_time' | 'modality'>, closeHm: string): string =>
  `${lot.client_name} at ${hm12(lot.slot_time)} · ${lot.modality} tomorrow is still unsold in the Essentials Auction. Answer and bid before ${hm12(closeHm)}.`;

export const alreadyPushedTo = (lot: UnsoldLot, scoreId: string): boolean => lot.pushes.some((p) => p.score_id === scoreId);

/** "Pushed to Team Alpha at 4:41 PM" lines, oldest first. */
export const pushedLines = (lot: UnsoldLot): string[] =>
  lot.pushes.map((p) => `Pushed to ${p.team_name ?? 'a crew'} at ${hm12(istParts(Date.parse(p.pushed_at)).hm)} (${p.member_count} member${p.member_count === 1 ? '' : 's'})`);

/** A My Crew auction_unsold message is still worth an alert while its auction day is today or later and the
    window on the day before has not closed. */
export const unsoldAlertLive = (payloadDate: string | null | undefined, nowMs: number, w: UnsoldWindow = DEFAULT_UNSOLD_WINDOW): boolean => {
  if (!payloadDate) return false;
  const today = istParts(nowMs).ymd;
  if (payloadDate > today) {
    // the auction for tomorrow runs today; after the close the card is stale
    const dayBefore = istParts(Date.parse(payloadDate + 'T00:00:00+05:30') - 864e5).ymd;
    return dayBefore > today || unsoldPhase(nowMs, w) !== 'closed';
  }
  return false;
};

/* ---------- after the close: assign someone free (22 Oct 2026, owner's second step) ----------
   A session still unsold after the close (round_result 'no_bids') can be given by the Essentials manager to any
   active trainer, coach or physio who has nothing within one hour either side of it that day (roster rows,
   consultations and QHP assessments count as busy; migration 20261022220000). Someone who trained the client the
   day before is marked, not blocked (owner decision). */
export type FreeStaff = {
  id: string;
  name: string;
  role: string;             // trainer | coach | doctor
  is_physio: boolean;
  sessions_that_day: number;
  nearest_session: string | null; // timestamptz of their nearest roster row that day
  trained_yesterday: boolean;
};

export const parseFreeStaff = (r: any): FreeStaff => ({
  id: String(r?.id ?? ''), name: String(r?.name ?? 'Staff'), role: String(r?.role ?? ''), is_physio: r?.is_physio === true,
  sessions_that_day: Number(r?.sessions_that_day ?? 0) || 0, nearest_session: r?.nearest_session ?? null, trained_yesterday: r?.trained_yesterday === true,
});

/** The card can be assigned after the close and before the session starts. */
export const assignOpen = (lot: Pick<UnsoldLot, 'scheduled_for'>, nowMs: number, w: UnsoldWindow = DEFAULT_UNSOLD_WINDOW): boolean =>
  unsoldPhase(nowMs, w) === 'closed' && Date.parse(lot.scheduled_for) > nowMs;

export const roleLabel = (s: Pick<FreeStaff, 'role' | 'is_physio'>): string =>
  s.is_physio ? 'Physio' : s.role === 'coach' ? 'Coach' : s.role === 'doctor' ? 'Doctor' : 'Trainer';

/** "3 sessions that day · next 9:00 AM", "Free all day". */
export const staffDayLine = (s: Pick<FreeStaff, 'sessions_that_day' | 'nearest_session'>): string => {
  if (!s.sessions_that_day) return 'Free all day';
  const next = s.nearest_session ? hm12(istParts(Date.parse(s.nearest_session)).hm) : null;
  return `${s.sessions_that_day} session${s.sessions_that_day === 1 ? '' : 's'} that day${next ? ` · nearest ${next}` : ''}`;
};

export const assignPhaseText = (w: UnsoldWindow = DEFAULT_UNSOLD_WINDOW): string =>
  `The auction closed at ${hm12(w.close)}. Sessions with no bid can be assigned to anyone free one hour either side.`;

/** The push the assignee gets, mirrored from the server for the confirm step. */
export const assignPreview = (lot: Pick<UnsoldLot, 'client_name' | 'slot_time' | 'modality'>, staffName: string, byName: string | null): string =>
  `${staffName}: ${lot.client_name}, ${hm12(lot.slot_time)} ${lot.modality} tomorrow, has been assigned to you${byName ? ` by ${byName}` : ' by the Essentials manager'}. It is on your Today's Roster.`;

/** Tolerant parsers for the RPC rows. */
export const parseUnsoldLot = (r: any): UnsoldLot => ({
  auction_date: String(r?.auction_date ?? ''),
  client_id: String(r?.client_id ?? ''),
  client_name: String(r?.client_name ?? 'Client'),
  modality: String(r?.modality ?? ''),
  slot_time: String(r?.slot_time ?? '').slice(0, 5),
  scheduled_for: String(r?.scheduled_for ?? ''),
  preferred_trainer_id: r?.preferred_trainer_id ?? null,
  preferred_trainer_name: r?.preferred_trainer_name ?? null,
  bids_count: Number(r?.bids_count ?? 0) || 0,
  round_result: r?.round_result ?? null,
  pushes: Array.isArray(r?.pushes) ? r.pushes.map((p: any) => ({ score_id: String(p?.score_id ?? ''), team_name: p?.team_name ?? null, pushed_at: String(p?.pushed_at ?? ''), member_count: Number(p?.member_count ?? 0) || 0 })) : [],
});

export const parseWindow = (d: any): UnsoldWindow =>
  d && typeof d.alert_from === 'string' && typeof d.close === 'string' ? { alert_from: d.alert_from.slice(0, 5), close: d.close.slice(0, 5) } : DEFAULT_UNSOLD_WINDOW;
```

### 3.2 `tests/rules/essentials_unsold_test.js` (new, in full; 32 checks)
One difference from Android's bytes: this document may not contain en or em dashes, so the two "no dashes" checks
(lines 39 and 50) are printed with the escapes `[\u2013\u2014]`. Android's file has the two literal characters (en
dash, em dash) inside those brackets. The regex matches the same two characters either way, so the test behaves
the same.
```js
// Rule test for the Odds staff app. ROOT = the repo root; point it at the iOS repo and run: node tests/rules/essentials_unsold_test.js
const ROOT = require("path").resolve(__dirname, "../..");
// node test of src/lib/essentialsUnsold.ts (Essentials manager: unsold sessions, window, copy; 22 Oct 2026).
const ts = require(ROOT + '/node_modules/typescript');
const fs = require('fs');
const src = fs.readFileSync(ROOT + '/src/lib/essentialsUnsold.ts', 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const m = { exports: {} };
new Function('module', 'exports', 'require', js)(m, m.exports, require);
const R = m.exports;
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };
const at = (ist) => Date.parse(`2026-10-22T${ist}:00+05:30`);

eq('istParts', R.istParts(at('16:30')), { ymd: '2026-10-22', hm: '16:30' });
eq('istParts across midnight', R.istParts(Date.parse('2026-10-22T19:00:00Z')), { ymd: '2026-10-23', hm: '00:30' });
eq('phase before', R.unsoldPhase(at('16:29')), 'before');
eq('phase open at alert_from', R.unsoldPhase(at('16:30')), 'open');
eq('phase open before close', R.unsoldPhase(at('17:29')), 'open');
eq('phase closed at close', R.unsoldPhase(at('17:30')), 'closed');
eq('phase follows a changed window', R.unsoldPhase(at('15:05'), { alert_from: '15:00', close: '16:00' }), 'open');
eq('hm12', [R.hm12('16:30'), R.hm12('07:00'), R.hm12('00:15'), R.hm12('12:00')], ['4:30 PM', '7:00 AM', '12:15 AM', '12:00 PM']);
eq('minutesToClose', [R.minutesToClose(at('16:30')), R.minutesToClose(at('17:31'))], [60, 0]);
eq('countdown', [R.countdownText(at('16:30')), R.countdownText(at('17:12')), R.countdownText(at('18:00'))], ['1 h 0 min to the close', '18 min to the close', 'Auction closed']);
eq('phaseText before', R.phaseText('before'), 'Unsold sessions appear here from 4:30 PM, one hour before the auction closes at 5:30 PM.');
eq('phaseText closed', R.phaseText('closed'), 'The auction closed at 5:30 PM. Sessions with no bid can be assigned to anyone free one hour either side.');
eq('unsoldLine', R.unsoldLine('Ishita Sheoran', '07:00', 'Strength'), 'Ishita Sheoran · 7:00 AM · Strength');
eq('pushPreview', R.pushPreview({ client_name: 'Ishita Sheoran', slot_time: '07:00', modality: 'Strength' }, '17:30'), 'Ishita Sheoran at 7:00 AM · Strength tomorrow is still unsold in the Essentials Auction. Answer and bid before 5:30 PM.');
const lot = R.parseUnsoldLot({ auction_date: '2026-10-23', client_id: 'c1', client_name: 'Ishita Sheoran', modality: 'Strength', slot_time: '07:00:00', scheduled_for: '2026-10-23T01:30:00Z', preferred_trainer_id: null, preferred_trainer_name: null, bids_count: 0, pushes: [{ score_id: 's1', team_name: 'Team Alpha', pushed_at: '2026-10-22T11:11:00Z', member_count: 6 }] });
eq('parse slot_time cut to HH:MM', lot.slot_time, '07:00');
eq('alreadyPushedTo', [R.alreadyPushedTo(lot, 's1'), R.alreadyPushedTo(lot, 's2')], [true, false]);
eq('pushedLines', R.pushedLines(lot), ['Pushed to Team Alpha at 4:41 PM (6 members)']);
eq('parse empty pushes', R.parseUnsoldLot({ pushes: null }).pushes, []);
eq('parseWindow', [R.parseWindow({ alert_from: '16:30:00', close: '17:30' }), R.parseWindow(null)], [{ alert_from: '16:30', close: '17:30' }, { alert_from: '16:30', close: '17:30' }]);
eq('alert live during the window', R.unsoldAlertLive('2026-10-23', at('16:45')), true);
eq('alert stale after the close', R.unsoldAlertLive('2026-10-23', at('17:45')), false);
eq('alert stale on the training day', R.unsoldAlertLive('2026-10-22', at('09:00')), false);
eq('alert live the day before yesterday... a later date', R.unsoldAlertLive('2026-10-24', at('18:00')), true);
eq('no dashes in copy', /[\u2013\u2014]| - /.test([R.phaseText('before'), R.phaseText('open'), R.phaseText('closed'), R.pushPreview({ client_name: 'A', slot_time: '07:00', modality: 'S' }, '17:30')].join(' ')), false);
// after the close: assign someone free (22 Oct 2026)
const lotT = { scheduled_for: '2026-10-23T01:30:00Z' }; // 7:00 AM IST on the 23rd
eq('assignOpen after the close, before the session', R.assignOpen(lotT, at('18:00')), true);
eq('assignOpen during the window: no', R.assignOpen(lotT, at('17:00')), false);
eq('assignOpen after the session started: no', R.assignOpen(lotT, Date.parse('2026-10-23T07:01:00+05:30')), false);
const st = R.parseFreeStaff({ id: 't1', name: 'Riya Sen', role: 'trainer', is_physio: false, sessions_that_day: 3, nearest_session: '2026-10-23T03:30:00Z', trained_yesterday: true });
eq('parseFreeStaff', [st.name, st.sessions_that_day, st.trained_yesterday], ['Riya Sen', 3, true]);
eq('staffDayLine', [R.staffDayLine(st), R.staffDayLine({ sessions_that_day: 0, nearest_session: null }), R.staffDayLine({ sessions_that_day: 1, nearest_session: null })], ['3 sessions that day · nearest 9:00 AM', 'Free all day', '1 session that day']);
eq('roleLabel', [R.roleLabel({ role: 'doctor', is_physio: true }), R.roleLabel({ role: 'coach', is_physio: false }), R.roleLabel({ role: 'trainer', is_physio: false })], ['Physio', 'Coach', 'Trainer']);
eq('assignPreview', R.assignPreview({ client_name: 'Ishita Sheoran', slot_time: '07:00', modality: 'Strength' }, 'Riya Sen', 'Sagar Sharma'), 'Riya Sen: Ishita Sheoran, 7:00 AM Strength tomorrow, has been assigned to you by Sagar Sharma. It is on your Today’s Roster.'.replace('’', '\x27'));
eq('no dashes in the assign copy', /[\u2013\u2014]| - /.test(R.assignPhaseText() + R.assignPreview({ client_name: 'A', slot_time: '07:00', modality: 'S' }, 'B', null)), false);
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
```
To make it byte-identical to Android after pasting (optional), run in the iOS repo root:
```sh
node -e "const fs=require('fs'),f='tests/rules/essentials_unsold_test.js',b=String.fromCharCode(92);fs.writeFileSync(f,fs.readFileSync(f,'utf8').split('['+b+'u2013'+b+'u2014]').join('['+String.fromCharCode(0x2013,0x2014)+']'))"
```
sha256 as printed here: `8f4d65aa1a3d7d9e410c56740253fd540f1724eb66a16224d09d8f1bb03dc8f3`; after the command (Android's file):
`66478061093ab0b46b876733be8fce264044dcf306a47760b2e1df1c8cc34644`.

### 3.3 `src/lib/essentialsManagerQueries.ts` (new, in full)
```ts
/* Essentials manager and the unsold crew alerts (22 Oct 2026). RPCs from hub-track migration 20261022200100.
   Plain-object query data (persisted cache). Rules in ./essentialsUnsold.ts. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { withTimeout, NET_MS } from './withTimeout';
import { parseUnsoldLot, parseWindow, parseFreeStaff, type Crew, type FreeStaff, type UnsoldLot, type UnsoldWindow } from './essentialsUnsold';
import { useMyManagerTeam, type ManagerChatMessage } from './managerChatQueries';

export function useUnsoldWindow() {
  return useQuery({
    queryKey: ['essentials-unsold-window'],
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<UnsoldWindow> => {
      const { data, error } = await withTimeout(Promise.resolve(supabase.rpc('essentials_unsold_window')), NET_MS, 'Auction window');
      if (error) throw new Error(error.message);
      return parseWindow(data);
    },
  });
}

/** The unsold sessions of tomorrow's auction (essential_manager / admin only; others get no rows). */
export function useEssentialsUnsold(enabled = true) {
  return useQuery({
    queryKey: ['essentials-unsold'],
    enabled,
    staleTime: 20_000,
    refetchInterval: 60_000,
    queryFn: async (): Promise<UnsoldLot[]> => {
      const { data, error } = await withTimeout(Promise.resolve(supabase.rpc('get_essentials_unsold')), NET_MS, 'Unsold sessions');
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map(parseUnsoldLot);
    },
  });
}

export function useEssentialsCrews(enabled = true) {
  return useQuery({
    queryKey: ['essentials-manager-crews'],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Crew[]> => {
      const { data, error } = await withTimeout(Promise.resolve(supabase.rpc('essentials_manager_crews')), NET_MS, 'Crews');
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map((r) => ({
        score_id: String(r.score_id), team_name: String(r.team_name ?? 'Team'), manager_id: String(r.manager_id ?? ''),
        manager_name: r.manager_name ?? null, member_count: Number(r.member_count ?? 0) || 0, team_start: String(r.team_start ?? ''), team_end: r.team_end ?? null,
      }));
    },
  });
}

export function usePushUnsoldToCrew() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { clientId: string; slotTime: string; scoreId: string }): Promise<{ memberCount: number; teamName: string }> => {
      const { data, error } = await withTimeout(Promise.resolve(supabase.rpc('push_essentials_unsold_to_crew', {
        p_client_id: input.clientId, p_slot_time: input.slotTime, p_score_id: input.scoreId,
      })), NET_MS, 'Push to crew');
      if (error) throw new Error(error.message);
      const d = (data ?? {}) as any;
      return { memberCount: Number(d.member_count ?? 0) || 0, teamName: String(d.team_name ?? 'the crew') };
    },
    onSettled: () => { qc.invalidateQueries({ queryKey: ['essentials-unsold'] }); qc.invalidateQueries({ queryKey: ['manager-chat'] }); },
  });
}

/* ---------- after the close: assign someone free (22 Oct 2026) ---------- */
export function useEssentialsFreeStaff(clientId: string | null, slotTime: string | null) {
  return useQuery({
    queryKey: ['essentials-free-staff', clientId, slotTime],
    enabled: !!clientId && !!slotTime,
    staleTime: 15_000,
    queryFn: async (): Promise<FreeStaff[]> => {
      const { data, error } = await withTimeout(Promise.resolve(supabase.rpc('get_essentials_free_staff', { p_client_id: clientId, p_slot_time: slotTime })), NET_MS, 'Free staff');
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map(parseFreeStaff);
    },
  });
}

export function useAssignUnsold() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { clientId: string; slotTime: string; trainerId: string }): Promise<{ trainerName: string; clientName: string }> => {
      const { data, error } = await withTimeout(Promise.resolve(supabase.rpc('assign_essentials_unsold', {
        p_client_id: input.clientId, p_slot_time: input.slotTime, p_trainer_id: input.trainerId,
      })), NET_MS, 'Assign session');
      if (error) throw new Error(error.message);
      const d = (data ?? {}) as any;
      return { trainerName: String(d.trainer_name ?? 'the trainer'), clientName: String(d.client_name ?? 'the client') };
    },
    onSettled: () => { ['essentials-unsold', 'essentials-free-staff', 'essentials-auction', 'manager-chat', 'trainer-roster'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); },
  });
}

/* ---------- members: the unsold cards pushed into my current crew ---------- */
export type UnsoldCrewAlert = { messageId: string; clientId: string; name: string; time: string; modality: string | null; date: string; pushedByName: string | null; createdAt: string };

/** The auction_unsold cards of my current crew, newest first (the home alert reads these). */
export function useUnsoldCrewAlerts() {
  const teamQ = useMyManagerTeam();
  const scoreId = teamQ.data?.scoreId ?? null;
  return useQuery({
    queryKey: ['unsold-crew-alerts', scoreId],
    enabled: !!scoreId,
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async (): Promise<UnsoldCrewAlert[]> => {
      const { data, error } = await withTimeout(Promise.resolve(
        supabase.from('manager_team_messages').select('id, payload, created_at').eq('team_id', scoreId as string).eq('kind', 'auction_unsold')
          .order('created_at', { ascending: false }).limit(20)), NET_MS, 'Crew alerts');
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map((m) => ({
        messageId: String(m.id), clientId: String(m.payload?.client_id ?? ''), name: String(m.payload?.name ?? 'Client'), time: String(m.payload?.time ?? '').slice(0, 5),
        modality: m.payload?.modality ?? null, date: String(m.payload?.date ?? ''), pushedByName: m.payload?.pushed_by_name ?? null, createdAt: String(m.created_at),
      })).filter((a) => a.clientId);
    },
  });
}

export type { ManagerChatMessage };
```

### 3.4 `src/components/essentialsUnsoldAlert.tsx` (new, in full)
`EssentialsUnsoldAlert` (home) and `EssentialsUnsoldCrewCard` (My Crew stream).
```tsx
/* Essentials Auction unsold alerts for crew members (22 Oct 2026).
   - EssentialsUnsoldAlert: the trainer / physio home banner while an unsold session pushed into my crew is still
     open for bids; a tap opens the auction page scrolled to that card.
   - EssentialsUnsoldCrewCard: the same session as a card in the My Crew stream (kind auction_unsold).
   Rules in src/lib/essentialsUnsold.ts. */
import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono } from './primitives';
import { useStore } from '../store';
import { serverNow } from '../lib/managerChatQueries';
import { useUnsoldCrewAlerts, useUnsoldWindow } from '../lib/essentialsManagerQueries';
import { unsoldAlertLive, unsoldLine, hm12, DEFAULT_UNSOLD_WINDOW } from '../lib/essentialsUnsold';

const GOLD = C.gold;

export function EssentialsUnsoldAlert() {
  const { go, set } = useStore();
  const alertsQ = useUnsoldCrewAlerts();
  const winQ = useUnsoldWindow();
  const w = winQ.data ?? DEFAULT_UNSOLD_WINDOW;
  const now = serverNow().getTime();
  const live = (alertsQ.data ?? []).filter((a) => unsoldAlertLive(a.date, now, w));
  if (!live.length) return null;
  const open = (clientId: string) => { set({ auctionFocusClientId: clientId }); go('essentials-auction'); };
  return (
    <View style={{ borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: hexA(GOLD, 0.45) }}>
      <LinearGradient colors={['rgba(72,52,10,0.75)', 'rgba(26,18,8,0.9)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: 14, gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
          <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: hexA(GOLD, 0.16), alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="gavel" size={15} color={GOLD} strokeWidth={2.1} />
          </View>
          <View style={{ flex: 1 }}>
            <Mono style={{ fontSize: 8.5, letterSpacing: 0.9, color: GOLD }}>ESSENTIALS AUCTION · STILL UNSOLD</Mono>
            <Serif style={{ fontSize: 16, marginTop: 1 }}>{live.length === 1 ? 'A session pushed to your crew' : `${live.length} sessions pushed to your crew`}</Serif>
          </View>
        </View>
        {live.slice(0, 3).map((a) => (
          <Pressable key={a.messageId} onPress={() => open(a.clientId)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Open ${a.name} in the auction`}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 9, paddingHorizontal: 11, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: hexA(GOLD, 0.22) }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: '#fff' }} numberOfLines={1}>{unsoldLine(a.name, a.time, a.modality)}</Text>
              <Body style={{ fontSize: 10.5, color: C.muted2, marginTop: 1 }}>{a.pushedByName ? `Pushed by ${a.pushedByName}` : 'Pushed by the Essentials manager'} · bid before {hm12(w.close)}</Body>
            </View>
            <View style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, backgroundColor: hexA(GOLD, 0.16), borderWidth: 1, borderColor: hexA(GOLD, 0.45) }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: GOLD }}>Answer and bid</Text>
            </View>
          </Pressable>
        ))}
      </LinearGradient>
    </View>
  );
}

/** The My Crew stream card for one auction_unsold message. */
export function EssentialsUnsoldCrewCard({ payload, createdAt }: { payload: any; createdAt: string }) {
  const { go, set } = useStore();
  const winQ = useUnsoldWindow();
  const w = winQ.data ?? DEFAULT_UNSOLD_WINDOW;
  const live = unsoldAlertLive(payload?.date, serverNow().getTime(), w);
  const clientId = payload?.client_id ? String(payload.client_id) : null;
  const closeHm = typeof payload?.close === 'string' ? payload.close.slice(0, 5) : w.close;
  return (
    <View style={{ borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: hexA(GOLD, live ? 0.45 : 0.2), opacity: live ? 1 : 0.75 }}>
      <LinearGradient colors={['rgba(72,52,10,0.7)', 'rgba(26,18,8,0.9)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: 13, gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Icon name="gavel" size={14} color={GOLD} strokeWidth={2.1} />
          <Mono style={{ flex: 1, fontSize: 8.5, letterSpacing: 0.9, color: GOLD }}>UNSOLD IN THE ESSENTIALS AUCTION</Mono>
          <Mono style={{ fontSize: 8.5, color: C.muted3 }}>{new Date(createdAt).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase()}</Mono>
        </View>
        <Text style={{ fontFamily: F.bodyBold, fontSize: 14.5, color: '#fff' }}>{unsoldLine(String(payload?.name ?? 'Client'), String(payload?.time ?? '').slice(0, 5), payload?.modality)}</Text>
        <Body style={{ fontSize: 11.5, color: C.ink3, lineHeight: 16 }}>
          {payload?.pushed_by_name ? `${payload.pushed_by_name} pushed this session to the crew. ` : ''}
          {live ? `No bid yet. Answer the client's questions before ${hm12(closeHm)} to win it.` : 'This auction has closed.'}
        </Body>
        {clientId ? (
          <Pressable onPress={() => { set({ auctionFocusClientId: clientId }); go('essentials-auction'); }} disabled={!live} hitSlop={8} accessibilityRole="button"
            style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 13, borderRadius: 999, backgroundColor: hexA(GOLD, live ? 0.18 : 0.08), borderWidth: 1, borderColor: hexA(GOLD, live ? 0.5 : 0.2) }}>
            <Icon name="chevRight" size={12} color={GOLD} strokeWidth={2.4} />
            <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: GOLD }}>{live ? 'Open in the auction' : 'Closed'}</Text>
          </Pressable>
        ) : null}
      </LinearGradient>
    </View>
  );
}
```

### 3.5 `src/screens/essentialsManager.tsx` (new screen, in full)
Sheet rules kept: sibling backdrop, `hitSlop` 10 on the buttons, one Modal open at a time (the two sheets never open
together; each has its two steps inside it).
```tsx
/* Essentials Manager (22 Oct 2026): the page of the essential_manager specialization (or role; admins too).
   - One hour before the Essentials Auction closes: the sessions with no bid, each pushable into any current My Crew
     (once per crew): the crew gets a card in its stream, every member a push, and the card opens that session on
     the auction page.
   - After the close: the sessions still unsold can be assigned to anyone free one hour either side of them that
     day (trainers and coaches for trainings, physios for rehab); the person gets the roster row, a crew entry and
     a push. Backend: hub-track migrations 20261022200100 / 210000 / 220000. Rules: src/lib/essentialsUnsold.ts.
   Sheet rules: sibling backdrop, hitSlop >= 10, one Modal at a time (the two pickers never open together). */
import React from 'react';
import { View, Text, Pressable, Modal, ScrollView, ActivityIndicator, AppState } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono, Card } from '../components/primitives';
import { Page } from './common';
import { useAuth } from '../auth';
import { serverNow } from '../lib/managerChatQueries';
import { useAssignUnsold, useEssentialsCrews, useEssentialsFreeStaff, useEssentialsUnsold, usePushUnsoldToCrew, useUnsoldWindow } from '../lib/essentialsManagerQueries';
import {
  DEFAULT_UNSOLD_WINDOW, alreadyPushedTo, assignOpen, assignPreview, countdownText, hm12, phaseText, pushPreview, pushedLines,
  roleLabel, staffDayLine, unsoldPhase, type Crew, type FreeStaff, type UnsoldLot,
} from '../lib/essentialsUnsold';

const GOLD = C.gold;

const SheetFrame = ({ visible, onClose, busy, bottom, children }: { visible: boolean; onClose: () => void; busy: boolean; bottom: number; children: React.ReactNode }) => (
  <Modal visible={visible} transparent animationType="slide" onRequestClose={() => { if (!busy) onClose(); }}>
    <View style={{ flex: 1, justifyContent: 'flex-end' }}>
      <Pressable onPress={() => { if (!busy) onClose(); }} accessibilityRole="button" accessibilityLabel="Close" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.65)' }} />
      <View style={{ maxHeight: '85%', backgroundColor: '#0E0A09', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: hexA(GOLD, 0.25), paddingHorizontal: 18, paddingTop: 14, paddingBottom: bottom + 18, gap: 12 }}>
        <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center' }} />
        {children}
      </View>
    </View>
  </Modal>
);

const GhostButton = ({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) => (
  <Pressable onPress={onPress} disabled={disabled} hitSlop={10} style={{ flex: 1, alignItems: 'center', paddingVertical: 13, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
    <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: C.ink }}>{label}</Text>
  </Pressable>
);

export function EssentialsManager() {
  const insets = useSafeAreaInsets();
  const { profile } = useAuth() as any;
  const myName: string | null = profile ? `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || null : null;
  const winQ = useUnsoldWindow();
  const w = winQ.data ?? DEFAULT_UNSOLD_WINDOW;
  const [now, setNow] = React.useState(() => serverNow().getTime());
  React.useEffect(() => {
    const id = setInterval(() => setNow(serverNow().getTime()), 15_000);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') setNow(serverNow().getTime()); });
    return () => { clearInterval(id); sub.remove(); };
  }, []);
  const phase = unsoldPhase(now, w);
  const lotsQ = useEssentialsUnsold();
  const crewsQ = useEssentialsCrews();
  const pushM = usePushUnsoldToCrew();
  const assignM = useAssignUnsold();
  const [pickFor, setPickFor] = React.useState<UnsoldLot | null>(null);
  const [confirm, setConfirm] = React.useState<Crew | null>(null);
  const [assignFor, setAssignFor] = React.useState<UnsoldLot | null>(null);
  const [assignPick, setAssignPick] = React.useState<FreeStaff | null>(null);
  const staffQ = useEssentialsFreeStaff(assignFor?.client_id ?? null, assignFor?.slot_time ?? null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const lots = lotsQ.data ?? [];
  const closeAll = () => { setConfirm(null); setPickFor(null); setAssignPick(null); setAssignFor(null); };

  const doPush = async () => {
    if (!pickFor || !confirm) return;
    try {
      const r = await pushM.mutateAsync({ clientId: pickFor.client_id, slotTime: pickFor.slot_time, scoreId: confirm.score_id });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setNotice(`Pushed ${pickFor.client_name} to ${r.teamName}. ${r.memberCount} member${r.memberCount === 1 ? '' : 's'} alerted.`);
      closeAll();
    } catch (e: any) { setNotice(e?.message || 'Could not push the session.'); setConfirm(null); }
  };
  const doAssign = async () => {
    if (!assignFor || !assignPick) return;
    try {
      const r = await assignM.mutateAsync({ clientId: assignFor.client_id, slotTime: assignFor.slot_time, trainerId: assignPick.id });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setNotice(`${r.clientName} at ${hm12(assignFor.slot_time)} is assigned to ${r.trainerName}. They have been told and it is on their roster.`);
      closeAll();
    } catch (e: any) { setNotice(e?.message || 'Could not assign the session.'); setAssignPick(null); staffQ.refetch(); }
  };

  const pillLabel = phase === 'open' ? countdownText(now, w).toUpperCase() : phase === 'before' ? `OPENS ${hm12(w.alert_from).toUpperCase()}` : 'CLOSED · ASSIGN';
  return (
    <Page gap={14} pt={6} pb={40 + insets.bottom}>
      <View style={{ borderRadius: 22, overflow: 'hidden', borderWidth: 1, borderColor: hexA(GOLD, 0.35) }}>
        <LinearGradient colors={['#2A1E55', '#120E2A']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: 18, gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: hexA(GOLD, 0.18), alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="gavel" size={20} color={GOLD} strokeWidth={2} />
            </View>
            <View style={{ flex: 1 }}>
              <Mono style={{ fontSize: 8.5, letterSpacing: 1, color: GOLD }}>ESSENTIALS MANAGER</Mono>
              <Serif style={{ fontSize: 22, marginTop: 1 }}>Unsold sessions</Serif>
            </View>
          </View>
          <Body style={{ fontSize: 12.5, color: C.ink3, lineHeight: 18 }}>{phaseText(phase, w)}</Body>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <View style={{ paddingVertical: 5, paddingHorizontal: 11, borderRadius: 999, backgroundColor: hexA(phase === 'open' ? C.green : GOLD, 0.16), borderWidth: 1, borderColor: hexA(phase === 'open' ? C.green : GOLD, 0.45) }}>
              <Mono style={{ fontSize: 9, letterSpacing: 0.6, color: phase === 'open' ? C.green : GOLD }}>{pillLabel}</Mono>
            </View>
            <Mono style={{ fontSize: 9, color: C.muted2 }}>AUCTION CLOSES {hm12(w.close).toUpperCase()} IST</Mono>
          </View>
        </LinearGradient>
      </View>

      {notice ? (
        <Pressable onPress={() => setNotice(null)} style={{ padding: 12, borderRadius: 14, backgroundColor: hexA(GOLD, 0.08), borderWidth: 1, borderColor: hexA(GOLD, 0.3) }}>
          <Body style={{ fontSize: 12.5, color: '#fff' }}>{notice}</Body>
        </Pressable>
      ) : null}

      {lotsQ.isLoading ? (
        <View style={{ alignItems: 'center', gap: 10, paddingVertical: 40 }}>
          <ActivityIndicator color={GOLD} />
          <Body style={{ fontSize: 12.5, color: C.muted3 }}>Checking tomorrow's sessions…</Body>
        </View>
      ) : lotsQ.isError ? (
        <Card radius={20} style={{ padding: 16, gap: 10 }}>
          <Serif style={{ fontSize: 17 }}>Could not load the sessions.</Serif>
          <Body style={{ fontSize: 12.5, color: C.ink3 }}>{(lotsQ.error as Error).message}</Body>
          <Pressable onPress={() => lotsQ.refetch()} hitSlop={10} style={{ alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: hexA(C.red, 0.12), borderWidth: 1, borderColor: hexA(C.red, 0.4) }}>
            <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: C.red }}>Try again</Text>
          </Pressable>
        </Card>
      ) : lots.length === 0 ? (
        <Card radius={20} style={{ padding: 22, alignItems: 'center', gap: 8 }}>
          <Icon name="checks" size={26} color={C.green} strokeWidth={2} />
          <Serif style={{ fontSize: 18 }}>Nothing unsold</Serif>
          <Body style={{ fontSize: 12.5, color: C.muted2, textAlign: 'center', lineHeight: 18 }}>Every session in tomorrow's auction has a bid, a decision or someone assigned.</Body>
        </Card>
      ) : (
        <View style={{ gap: 12 }}>
          <Mono style={{ fontSize: 9, letterSpacing: 1, color: C.muted2 }}>{lots.length} UNSOLD · TOMORROW</Mono>
          {lots.map((lot) => {
            const canAssign = assignOpen(lot, now, w);
            return (
              <Card key={`${lot.client_id}-${lot.slot_time}`} radius={20} style={{ padding: 15, gap: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: hexA(GOLD, 0.12), borderWidth: 1, borderColor: hexA(GOLD, 0.3), alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: GOLD }}>{lot.client_name.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('')}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: '#fff' }} numberOfLines={1}>{lot.client_name}</Text>
                    <Body style={{ fontSize: 12, color: C.muted2, marginTop: 1 }}>{hm12(lot.slot_time)} · {lot.modality}{lot.preferred_trainer_name ? ` · usually ${lot.preferred_trainer_name}` : ''}</Body>
                  </View>
                  <View style={{ paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999, backgroundColor: hexA(C.red, 0.12), borderWidth: 1, borderColor: hexA(C.red, 0.4) }}>
                    <Mono style={{ fontSize: 9, letterSpacing: 0.5, color: C.red }}>{lot.round_result === 'no_bids' ? 'NO BIDS' : '0 BIDS'}</Mono>
                  </View>
                </View>
                {pushedLines(lot).map((l) => (
                  <View key={l} style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                    <Icon name="checks" size={12} color={C.green} strokeWidth={2.4} />
                    <Body style={{ flex: 1, fontSize: 11.5, color: C.green }}>{l}</Body>
                  </View>
                ))}
                {phase === 'closed' ? (
                  <>
                    <Pressable onPress={() => setAssignFor(lot)} disabled={!canAssign} hitSlop={10} accessibilityRole="button"
                      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 12, borderRadius: 13, backgroundColor: hexA(GOLD, canAssign ? 0.16 : 0.06), borderWidth: 1, borderColor: hexA(GOLD, canAssign ? 0.5 : 0.2), opacity: canAssign ? 1 : 0.6 }}>
                      <Icon name="userPlus" size={14} color={GOLD} strokeWidth={2.2} />
                      <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: GOLD }}>Assign someone free</Text>
                    </Pressable>
                    {!canAssign ? <Body style={{ fontSize: 10.5, color: C.muted3 }}>This session has already started.</Body> : null}
                  </>
                ) : (
                  <>
                    <Pressable onPress={() => setPickFor(lot)} disabled={phase !== 'open'} hitSlop={10} accessibilityRole="button"
                      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 12, borderRadius: 13, backgroundColor: hexA(GOLD, phase === 'open' ? 0.16 : 0.06), borderWidth: 1, borderColor: hexA(GOLD, phase === 'open' ? 0.5 : 0.2), opacity: phase === 'open' ? 1 : 0.6 }}>
                      <Icon name="users" size={14} color={GOLD} strokeWidth={2.2} />
                      <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: GOLD }}>{lot.pushes.length ? 'Push to another crew' : 'Push to a crew'}</Text>
                    </Pressable>
                    {phase === 'before' ? <Body style={{ fontSize: 10.5, color: C.muted3 }}>Pushing opens at {hm12(w.alert_from)}.</Body> : null}
                  </>
                )}
              </Card>
            );
          })}
        </View>
      )}

      {/* Crew picker (window open): two steps inside one Modal. */}
      <SheetFrame visible={!!pickFor} onClose={closeAll} busy={pushM.isPending} bottom={insets.bottom}>
        {pickFor ? (
          confirm ? (
            <>
              <Serif style={{ fontSize: 20 }}>Push to {confirm.team_name}?</Serif>
              <Body style={{ fontSize: 12.5, color: C.muted2, lineHeight: 18 }}>{confirm.member_count} member{confirm.member_count === 1 ? '' : 's'}{confirm.manager_name ? ` and ${confirm.manager_name}` : ''} get this push and a card in their My Crew:</Body>
              <View style={{ padding: 12, borderRadius: 14, backgroundColor: hexA(GOLD, 0.08), borderWidth: 1, borderColor: hexA(GOLD, 0.3) }}>
                <Body style={{ fontSize: 12.5, color: '#fff', lineHeight: 18 }}>{pushPreview(pickFor, w.close)}</Body>
              </View>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <GhostButton label="Back" onPress={() => setConfirm(null)} disabled={pushM.isPending} />
                <Pressable onPress={doPush} disabled={pushM.isPending} hitSlop={10} style={{ flex: 1.3, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 13, borderRadius: 13, backgroundColor: hexA(GOLD, 0.18), borderWidth: 1, borderColor: hexA(GOLD, 0.5) }}>
                  {pushM.isPending ? <ActivityIndicator size="small" color={GOLD} /> : <Icon name="send" size={13} color={GOLD} strokeWidth={2.3} />}
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: GOLD }}>{pushM.isPending ? 'Pushing…' : 'Push now'}</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <Serif style={{ fontSize: 20 }}>Push {pickFor.client_name} to a crew</Serif>
              <Body style={{ fontSize: 12.5, color: C.muted2, lineHeight: 18 }}>{hm12(pickFor.slot_time)} · {pickFor.modality} tomorrow. Pick the crew whose members should bid. A session can go to several crews, once each.</Body>
              <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 6 }}>
                {crewsQ.isLoading ? (
                  <ActivityIndicator color={GOLD} style={{ paddingVertical: 20 }} />
                ) : (crewsQ.data ?? []).length === 0 ? (
                  <Body style={{ fontSize: 12.5, color: C.muted2, paddingVertical: 12 }}>No crew is running right now.</Body>
                ) : (crewsQ.data ?? []).map((c) => {
                  const done = alreadyPushedTo(pickFor, c.score_id);
                  return (
                    <Pressable key={c.score_id} onPress={() => !done && setConfirm(c)} disabled={done} hitSlop={6} accessibilityRole="button"
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 14, backgroundColor: done ? 'rgba(255,255,255,0.03)' : hexA(GOLD, 0.06), borderWidth: 1, borderColor: done ? 'rgba(255,255,255,0.08)' : hexA(GOLD, 0.3), opacity: done ? 0.6 : 1 }}>
                      <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: hexA(C.purple, 0.16), alignItems: 'center', justifyContent: 'center' }}>
                        <Icon name="users" size={15} color={C.purple} strokeWidth={2.1} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: '#fff' }} numberOfLines={1}>{c.team_name}</Text>
                        <Body style={{ fontSize: 11, color: C.muted2, marginTop: 1 }}>{c.manager_name ? `${c.manager_name} · ` : ''}{c.member_count} member{c.member_count === 1 ? '' : 's'}</Body>
                      </View>
                      <Mono style={{ fontSize: 8.5, letterSpacing: 0.5, color: done ? C.green : GOLD }}>{done ? 'PUSHED' : 'PICK'}</Mono>
                    </Pressable>
                  );
                })}
              </ScrollView>
              <GhostButton label="Cancel" onPress={closeAll} />
            </>
          )
        ) : null}
      </SheetFrame>

      {/* Free-staff picker (after the close): two steps inside one Modal. */}
      <SheetFrame visible={!!assignFor} onClose={closeAll} busy={assignM.isPending} bottom={insets.bottom}>
        {assignFor ? (
          assignPick ? (
            <>
              <Serif style={{ fontSize: 20 }}>Assign to {assignPick.name}?</Serif>
              <Body style={{ fontSize: 12.5, color: C.muted2, lineHeight: 18 }}>{roleLabel(assignPick)} · {staffDayLine(assignPick)}{assignPick.trained_yesterday ? ' · trained this client yesterday' : ''}. The session goes on their roster and they get this push:</Body>
              <View style={{ padding: 12, borderRadius: 14, backgroundColor: hexA(GOLD, 0.08), borderWidth: 1, borderColor: hexA(GOLD, 0.3) }}>
                <Body style={{ fontSize: 12.5, color: '#fff', lineHeight: 18 }}>{assignPreview(assignFor, assignPick.name, myName)}</Body>
              </View>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <GhostButton label="Back" onPress={() => setAssignPick(null)} disabled={assignM.isPending} />
                <Pressable onPress={doAssign} disabled={assignM.isPending} hitSlop={10} style={{ flex: 1.3, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 13, borderRadius: 13, backgroundColor: hexA(GOLD, 0.18), borderWidth: 1, borderColor: hexA(GOLD, 0.5) }}>
                  {assignM.isPending ? <ActivityIndicator size="small" color={GOLD} /> : <Icon name="checks" size={13} color={GOLD} strokeWidth={2.4} />}
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: GOLD }}>{assignM.isPending ? 'Assigning…' : 'Assign now'}</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <Serif style={{ fontSize: 20 }}>Assign {assignFor.client_name}</Serif>
              <Body style={{ fontSize: 12.5, color: C.muted2, lineHeight: 18 }}>{hm12(assignFor.slot_time)} · {assignFor.modality} tomorrow. Everyone below has nothing within an hour either side of it that day. Fewest sessions first.</Body>
              <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 6 }}>
                {staffQ.isLoading ? (
                  <ActivityIndicator color={GOLD} style={{ paddingVertical: 20 }} />
                ) : staffQ.isError ? (
                  <Body style={{ fontSize: 12.5, color: C.red, paddingVertical: 12 }}>{(staffQ.error as Error).message}</Body>
                ) : (staffQ.data ?? []).length === 0 ? (
                  <Body style={{ fontSize: 12.5, color: C.muted2, paddingVertical: 12 }}>Nobody is free an hour either side of this session.</Body>
                ) : (staffQ.data ?? []).map((s) => (
                  <Pressable key={s.id} onPress={() => setAssignPick(s)} hitSlop={6} accessibilityRole="button"
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 14, backgroundColor: hexA(GOLD, 0.06), borderWidth: 1, borderColor: hexA(GOLD, 0.3) }}>
                    <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: hexA(s.is_physio ? C.blue : C.green, 0.16), alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: s.is_physio ? C.blue : C.green }}>{s.name.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('')}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: '#fff' }} numberOfLines={1}>{s.name}</Text>
                      <Body style={{ fontSize: 11, color: C.muted2, marginTop: 1 }}>{roleLabel(s)} · {staffDayLine(s)}</Body>
                      {s.trained_yesterday ? <Mono style={{ fontSize: 8, letterSpacing: 0.5, color: GOLD, marginTop: 2 }}>TRAINED THIS CLIENT YESTERDAY</Mono> : null}
                    </View>
                    <Mono style={{ fontSize: 8.5, letterSpacing: 0.5, color: GOLD }}>PICK</Mono>
                  </Pressable>
                ))}
              </ScrollView>
              <GhostButton label="Cancel" onPress={closeAll} />
            </>
          )
        ) : null}
      </SheetFrame>
    </Page>
  );
}
```
Note on `myName`: Android's `AuthCtx` has no `profile` field (`session, loading, role, dbRole, signIn, signOut`), so
`myName` is always null there and the confirm box always reads "by the Essentials manager", while the real push
carries the manager's name. Port it as it is for parity (see Not confirmed).

### 3.6 Role plumbing: `src/store.tsx` and `src/auth.tsx`
`src/store.tsx`, `homeRouteFor`, before the final `: 'dashboard'`:
```ts
  : role === 'essential_manager' ? 'essentials-manager'
```
`Role` type:
```ts
export type Role = 'trainer' | 'crm' | 'coach' | 'ops' | 'admin' | 'doctor' | 'therapist' | 'marketing' | 'academy' | 'tech' | 'essential_manager';
```
`Store` type, next to `selectedTicketId`:
```ts
  /** Essentials Auction (22 Oct 2026): the client card to scroll to and highlight on the auction page (a crew card or push tap). */
  auctionFocusClientId: string | null;
```
initial state in `StoreProvider`, next to `selectedTicketId: null as string | null,`:
```ts
    auctionFocusClientId: null as string | null,
```
and in `resetSession`, add `auctionFocusClientId: null,` to the object (Android: right after
`selectedTicketId: null,`).

`src/auth.tsx`, `appRoleOf` (the new branch is `dbRole === 'essential_manager' ? 'essential_manager'` before the final
`'trainer'`):
```ts
const appRoleOf = (dbRole: string | null | undefined): Role | null =>
  dbRole === 'client' || !dbRole ? null : dbRole === 'crm' ? 'crm' : dbRole === 'coach' ? 'coach' : dbRole === 'ops' ? 'ops' : dbRole === 'admin' ? 'admin' : dbRole === 'doctor' ? 'doctor' : dbRole === 'therapist' ? 'therapist' : dbRole === 'marketing' ? 'marketing' : dbRole === 'academy' ? 'academy' : dbRole === 'tech' ? 'tech' : dbRole === 'essential_manager' ? 'essential_manager' : 'trainer';
```

### 3.7 Capability: `src/lib/capabilities.ts`
`Capabilities` type, after `isPilatesHead`:
```ts
  /* Essentials Manager page (role_specialization includes 'essential_manager'; 22 Oct 2026) */
  isEssentialManager: boolean;
```
`EMPTY`, after `isPilatesHead: false,`:
```ts
  isEssentialManager: false,
```
`useMyCapabilities` query function, last field of the returned object (`spec` is the `role_specialization` already
selected there):
```ts
        isEssentialManager: Array.isArray(spec) ? spec.includes('essential_manager') : typeof spec === 'string' && spec.includes('essential_manager'),
```

### 3.8 Drawer: `src/data.ts` and `src/components/chrome.tsx`
`src/data.ts`, `trainerNav` (Workspace group), the new item right after Essentials Auction:
```ts
    { label: 'Essentials Auction', icon: 'gavel', route: 'essentials-auction' },
    { label: 'Essentials Manager', icon: 'gavel', route: 'essentials-manager' },
```
`doctorNav`, the same:
```ts
    { label: 'Essentials Auction', icon: 'gavel', route: 'essentials-auction' },
    { label: 'Essentials Manager', icon: 'gavel', route: 'essentials-manager' },
```
New export after `therapistNav`, before `techNav`:
```ts
/* Essentials manager (22 Oct 2026): profiles.role = essential_manager sees only this page (plus Learn). */
export const essentialManagerNav: NavGroup[] = [
  { label: 'Workspace', items: [
    { label: 'Essentials Manager', icon: 'gavel', route: 'essentials-manager' },
  ] },
  { label: 'Learn', items: [
    { label: 'Odds Nucleus', icon: 'nucleus', route: 'nucleus' },
  ] },
];
```
`src/components/chrome.tsx`: add `essentialManagerNav` to the `../data` import:
```ts
import { trainerNav, crmNav, coachNav, opsNav, adminNav, doctorNav, consultantNav, therapistNav, marketingNav, academyNav, techNav, essentialManagerNav, bottomTabs, tabMap } from '../data';
```
`Drawer()`, `baseGroups` (the new branch is second):
```ts
  const baseGroups = role === 'tech' ? techNav : role === 'essential_manager' ? essentialManagerNav : role === 'crm' ? crmNav : role === 'coach' ? coachNav : role === 'ops' ? opsNav : role === 'admin' ? adminNav : role === 'doctor' ? (doctorIdent.data.isConsultant ? consultantNav : doctorNav) : role === 'therapist' ? therapistNav : role === 'marketing' ? marketingNav : role === 'academy' ? academyNav : trainerNav;
```
`Drawer()`, `itemVisible`, right before the `essentials-auction` line:
```ts
    if (it.route === 'essentials-manager') return caps.data.isEssentialManager || role === 'essential_manager'; // specialization (the two managers), or the dedicated role
    if (it.route === 'essentials-auction') return role !== 'doctor' || !!doctorIdent.data?.isPhysio; // rehab sessions of the auction go to physios
```

### 3.9 Route: `src/Router.tsx`
```ts
import { EssentialsManager } from './screens/essentialsManager';
```
In `SCREENS`, after `'essentials-auction'`:
```ts
  'essentials-auction': EssentialsAuction,
  'essentials-manager': EssentialsManager,
```

### 3.10 Push taps: `src/components/PushTokenManager.tsx`
In `routeFromNotification`, after the revenue-forecast line (`priority_assigned` / `/crm/revenue-forecast`) and
before the QHP cancellation lines (`set` and `go` come from `useStore()` already):
```ts
    // Essentials Auction unsold (22 Oct 2026): a crew member lands on that client's card; the manager on their page.
    if (t === 'essentials_unsold' || data.route === 'essentials-auction') { if (data.client_id) set({ auctionFocusClientId: String(data.client_id) }); go('essentials-auction'); return; }
    if (t === 'essentials_unsold_manager' || data.route === 'essentials-manager') { go('essentials-manager'); return; }
```
The member push carries both `type` and `route`, so either test catches it; the focus id must be set before `go`.
There is no branch for `essentials_assigned` (the assignee's push).

### 3.11 The focused card: `src/screens/essentialsAuction.tsx`
Imports (`type ScrollView` added to the react-native import, `useStore` new):
```ts
import { View, Text, Pressable, Animated, Easing, ActivityIndicator, AppState, Modal, Image, Dimensions, Alert, type ScrollView } from 'react-native';
import { useStore } from '../store';
```
Top of `EssentialsAuction()`, after `const me = ...`:
```ts
  // Focus (22 Oct 2026): a crew card or an unsold push names a client; the page scrolls to that card and outlines
  // it in gold. Cleared on leave so the next visit opens at the top.
  const { auctionFocusClientId: focusId, set: setStore } = useStore();
  const pageRef = React.useRef<React.ComponentRef<typeof ScrollView>>(null);
  React.useEffect(() => () => { setStore({ auctionFocusClientId: null }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
```
The page root:
```tsx
    <Page ref={pageRef} gap={14} pt={6}>
```
The lots list: each `LotCard` is wrapped in a View that measures itself, scrolls the page to it and draws the outline
when it is the focused client (the `key` moves from `LotCard` to the wrapper):
```tsx
          {lots.map((lot, i) => (
            <View key={`${lot.client_id}-${lot.slot_time}`} onLayout={focusId === lot.client_id ? (e) => { const y = e.nativeEvent.layout.y; setTimeout(() => pageRef.current?.scrollTo({ y: Math.max(0, y + 140), animated: true }), 250); } : undefined}
              style={focusId === lot.client_id ? { borderRadius: 22, borderWidth: 2, borderColor: C.gold, padding: 2 } : undefined}>
            <LotCard lot={lot} index={i} me={me} win={win} now={now} reduceMotion={reduceMotion}
              photo={photos[lot.client_id] ?? null} onPhoto={photos[lot.client_id] ? () => setPhotoFor({ url: photos[lot.client_id], name: lot.client_name }) : undefined}
              eta={etaOf(lot)}
              onBid={() => openQuiz(lot)} />
            </View>
          ))}
```

### 3.12 My Crew stream card: `src/lib/managerChatQueries.ts` and `src/screens/managerChat.tsx`
`ManagerChatMessage.kind` gains `'auction_unsold'`:
```ts
  kind: 'text' | 'tomorrow_plan' | 'plan_remark' | 'plan_time_edit' | 'plan_reschedule_request' | 'plan_reschedule_decision' | 'plan_add' | 'team_flags' | 'session_update' | 'auction_unsold';
  // auction_unsold (Essentials manager, 22 Oct 2026): {date, client_id, name, time, modality, score_id, pushed_by, pushed_by_name, close, source}.
```
`src/screens/managerChat.tsx`, import (Android puts it on line 2):
```ts
import { EssentialsUnsoldCrewCard } from '../components/essentialsUnsoldAlert';
```
In `ManagerChat()` > `renderMessage`, right after `const daySep = ...` and before `if (m.kind === 'team_flags')`:
```tsx
    if (m.kind === 'auction_unsold') {
      // Essentials Auction unsold session pushed by the Essentials manager (22 Oct 2026): everyone sees the card.
      return (
        <>
          {daySep}
          <View style={[{ marginTop: 8 }, flashStyle]}>
            <EssentialsUnsoldCrewCard payload={m.payload} createdAt={m.createdAt} />
          </View>
        </>
      );
    }
```

### 3.13 Home mounts: `src/screens/trainer.tsx` and `src/screens/doctor.tsx`
`src/screens/trainer.tsx` import:
```ts
import { EssentialsUnsoldAlert } from '../components/essentialsUnsoldAlert';
```
`Dashboard()`, in the Essentials block, first of the Essentials cards (Android order: `EssentialsUnsoldAlert`,
`EssentialsCancelledAlert`, `AuctionResultsCards`, `EssentialsPlanAlertCard`, `EssentialsAuctionHomeCard`):
```tsx
      {/* Essentials Auction unsold sessions pushed into my crew (22 Oct 2026): nothing otherwise. */}
      <EssentialsUnsoldAlert />
```
`src/screens/doctor.tsx` import:
```ts
import { EssentialsUnsoldAlert } from '../components/essentialsUnsoldAlert';
```
`PhysioDoctorDashboard()`, after `<ManagerTeamChatCard />`, before the `EssentialsCancelledAlert` line:
```tsx
      {identity.data.isPhysio ? <EssentialsUnsoldAlert /> : null}
```

### 3.14 Checks before the device
- `npx tsc --noEmit` exit 0.
- `node tests/rules/essentials_unsold_test.js`: 32 PASS lines and "ALL PASS".
- `src/lib/essentialsUnsold.ts` sha256 matches 3.1.

## 4. Check on the iPhone
Use an Essentials manager account (section 1.1), a trainer in a running crew, and a physio. Steps 5 and 9 send real
pushes and step 9 books a real session: pick a crew and a person you can check with.
1. Sign in as a trainer without the specialization: the drawer has Essentials Auction and no Essentials Manager.
2. Sign in as an Essentials manager who is a trainer: Essentials Manager sits right after Essentials Auction; the home
   is the usual trainer home. As the physio HOD: the same item in the doctor drawer.
3. Before 4:30 PM IST open the page: "Unsold sessions appear here from 4:30 PM, ...", pill OPENS 4:30 PM; any card's
   button is greyed with "Pushing opens at 4:30 PM.".
4. At 4:30 PM (when tomorrow has a session with no bid) the manager's iPhone gets "Essentials sessions still
   unsold"; a tap, from the background and from a killed app, opens the page. The pill is green and counts down
   ("1 H 0 MIN TO THE CLOSE"); lock and unlock the phone a few minutes later: it has moved on.
5. Push to a crew, pick a crew: the confirm box reads "NAME at TIME · MODALITY tomorrow is still unsold in the
   Essentials Auction. Answer and bid before 5:30 PM.". Push now: the notice "Pushed NAME to TEAM. N members
   alerted.", the card gains "Pushed to TEAM at TIME (N members)" and the button reads Push to another crew; opening
   the sheet again shows that crew greyed with PUSHED.
6. On a crew member's iPhone: the push arrives; a tap opens the auction page scrolled to that client's card with a
   gold outline. Go back and open Essentials Auction from the drawer: no outline, page at the top.
7. Same member, home: the gold card "ESSENTIALS AUCTION · STILL UNSOLD / A session pushed to your crew"; Answer and
   bid opens the outlined card. My Crew: the gold "UNSOLD IN THE ESSENTIALS AUCTION" card; Open in the auction does
   the same. A physio in that crew sees the home card on the Doctor Dashboard; a non-physio doctor does not.
8. After 5:30 PM: the member's home card is gone, the My Crew card reads "This auction has closed." with a greyed
   Closed pill. The manager's page: pill CLOSED · ASSIGN, the closed phase line, the session's pill NO BIDS once the
   round is decided, and the button Assign someone free.
9. Assign someone free: the list is fewest sessions first with role and day lines; TRAINED THIS CLIENT YESTERDAY
   shows where it applies. Pick, check the confirm box, Assign now: the notice "NAME at TIME is assigned to PERSON.
   They have been told and it is on their roster." and the card leaves the list. The assignee gets "Essentials
   session assigned to you", sees the session on Today's Roster, and (with `ios-crew-assigned-card-handoff.md`
   ported) the My Crew day card shows it as ASSIGNED.
10. Refusal path: open Assign someone free for a session, assign it from another device first, then press Assign now
    on the iPhone: the sheet returns to the list and the notice (behind the sheet, visible after Cancel) reads
    "This session is no longer unsold.".

## Not confirmed
- The assignee's push (`type essentials_assigned`, no `route`) has no tap branch on Android: a tap just opens the app
  where it was (home on a cold start). The feature doc says it lands on home / roster; the code does not route it.
- The assign confirm box on Android always reads "by the Essentials manager" (`useAuth()` has no `profile`), while the
  real push names the manager; whether the owner wants the name there is not decided. Fix on both apps or neither.
- The confirm box for a crew push omits the date that the real push carries ("tomorrow (23 Oct)"); same on Android.
- No Android device run of every step above is recorded in the feature doc ("device test pending" on 22 Oct); the
  page has been used live since (the 28 Oct change log fixes the day card for a real assignment).
