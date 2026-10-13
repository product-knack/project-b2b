# Essentials Auction, Android build brief (paste for the odds-app session)

You are working in the Odds B2B Android app (`C:\Users\ADMIN\Desktop\b2b\odds-app`, Expo / React Native, React Query, Supabase). The web app (hub-track) just gained a trainer page called **Essentials Auction**. Build the same screen in the trainer area of the app, wired to the same backend. Everything the screen needs is behind three database functions, so this is a UI build plus one feature doc; no new SQL. Read this whole brief before writing anything.

## 0. What it is, in one paragraph

Clients on the **Essentials by Odds** plan (`clients.subscription_type = 'Essentials'`, a 30-day pass, one training a day, no package or cycle) save their own week in the client app: `clients.weekly_protocol.slots[]`, one training per weekday at a fixed IST time. The day before each training, the auction offers it to trainers. The first trainer to press **Book my session** (after a warning confirmation) gets it: one `session_schedule` row is created for tomorrow at the slot time (the only record of the grab) and the client's care-team chat gets an automatic note. From then on every trainer sees that lot as **Grabbed by <trainer name>**. The auction is open **1:00 PM to 4:00 PM IST on the day before the training** and only ever shows **tomorrow** (Asia/Kolkata). The trainer the CRM set on that training (if any) has the **first 30 minutes** of the window to themselves.

## 1. Work this way

- Feature docs are mandatory: before building, read `docs/features/README.md` (the index) and `docs/features/web/trainer/essentials-auction.md` (the web file, full contract and verify recipe). Create `docs/features/android/trainer/essentials-auction.md` from `docs/features/_template.md`, fill every section, add the index line, add a dated change-log line in the same turn.
- Standing app rules: wrap every network call in `withTimeout`; register per-user caches with `registerTeardown`; use `invalidateDebounced` for any realtime; new sheets follow the scroll/touch rules (`useKeyboardHeight` padding, sibling backdrop, `keyboardShouldPersistTaps`, hitSlop at least 10, never sibling modals; `Page` already adds the keyboard height); no em dashes anywhere in user-facing copy; no phone numbers on dashboards.
- Never write `session_schedule`, `clients` or `messages` directly from the app. The only writes go through `grab_essentials_session`. Never change the RPC names, parameters or return shapes.
- Test trainer account: Sagar (`sagaroddsfitness@gmail.com`). Admin: `oddsfitnessapp@gmail.com`.

## 2. The rules the screen must follow

- **Day.** Always tomorrow in India time. Compute "today" with `Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' })` and add one day. Re-evaluate every 15 s and when the app comes to the foreground.
- **Window.** Open from `open` to `close` IST (read them from `essentials_auction_config()`, defaults 13:00 and 16:00; one place to tune, do not hard-code elsewhere). Three phases: `before` (preview, buttons disabled, "Opens at 1:00 PM · in 1h 30m"), `open` ("LIVE · closes in 1h 55m"), `after` ("Closed for today · reopens 1:00 PM"; the intro says the open lots go to the care team to fill). The device clock only decides whether the button looks live; the database checks the window again on every grab.
- **Lots.** A lot is one row of `get_essentials_auction`. Status `open` (bookable), `reserved` (the CRM-set trainer's head start; bookable only by `preferred_trainer_id`), `grabbed` (someone's `session_schedule` row exists that day; show "Grabbed by <trainer_name> · <time>"; when `trainer_id` is me, show "Grabbed by you" and a YOURS stamp).
- **One a day.** The database counts every non-cancelled `session_schedule` row that India day, any modality; the screen never needs to compute it.
- **Copy.** Client-facing words are set by the plan: "Essentials by Odds", "training" (not "session") for trainings, commas instead of dashes. The confirmation's three warnings (verbatim): "This is a commitment. The training goes on your roster for tomorrow and the client's care team is told it is yours." / "It cannot be cancelled or moved inside 10 hours of its start, so be sure you can make it." / "Essentials by Odds clients have one training a day. Once you book, nobody else can take this lot."
- **The window assumption.** The owner wrote "11:30pm to 2 pm"; the web reads it as 11:30 AM. If the owner changes it, only the config function changes; the app must read the config, not assume.

## 3. Backend contract (hub-track migration `supabase/migrations/20261001120000_essentials_auction.sql`)

Status on 1 Oct 2026: written and verified in a fixture; **not yet run on the live project**. Probe before relying on it (section 6). Nothing in it changes any existing Essentials function, trigger or column, and it creates no table: three functions only.

### 3.1 `essentials_auction_config()` -> jsonb
`{ "open": "13:00", "close": "16:00", "reserve_minutes": 30, "tz": "Asia/Kolkata" }`. IMMUTABLE. Call once per app session (staleTime Infinity), fall back to these values if it fails.

### 3.2 `get_essentials_auction(p_date date default null)` -> rows
STABLE, SECURITY DEFINER. Roles allowed: trainer, coach, admin, super_admin, ops, crm; anyone else gets no rows. **Trainers and coaches: pass nothing** (null = tomorrow); any other date returns no rows for them. Staff may pass a date.

Columns, in order:

| column | type | meaning |
|---|---|---|
| `auction_date` | date `YYYY-MM-DD` | the training's day (tomorrow) |
| `client_id` | uuid | |
| `client_name` | text | first + last, "Client" when blank |
| `modality` | text | the slot's training, e.g. Strength, Yoga, Rehab |
| `slot_time` | text `HH:MM` | IST (PostgREST may send `HH:MM:SS`; take the first 5 chars) |
| `scheduled_for` | timestamptz | the slot as an instant |
| `status` | text | `open` / `reserved` / `grabbed` |
| `trainer_id` | uuid or null | the booking's trainer when grabbed |
| `trainer_name` | text or null | |
| `grabbed_at` | timestamptz or null | the booking row's created_at |
| `session_id` | uuid or null | the `session_schedule` id |
| `preferred_trainer_id` | uuid or null | the trainer the CRM set on this training (`weekly_protocol.entries[].trainer_id`) |
| `preferred_trainer_name` | text or null | |
| `reserved_until` | timestamptz or null | window open + 30 min on the day before, while the lot is not grabbed and a preferred trainer exists |

Sorted by `slot_time`, then `client_name`. A lot exists when: the client is active and on Essentials (`essentials_is_plan`), the current pass (`essentials_current_pass(essentials_extensions)`, the newest entry) covers the day, the day is not inside a vacation (the pass entry of kind `vacation` with `vacation_start..vacation_end`, or an active `client_pause_history` row), and `weekly_protocol.slots` has that weekday with a time. `grabbed` when any non-cancelled `session_schedule` row exists that India day (first by created_at).

### 3.3 `grab_essentials_session(p_client_id uuid, p_date date default null)` -> jsonb
SECURITY DEFINER. Roles allowed to book: trainer, coach, admin, super_admin. For non-admins the date must be tomorrow and the clock inside the window. Locks the client row, re-checks everything, then inserts `session_schedule {client_id, trainer_id = caller, scheduled_datetime = date + slot time in Asia/Kolkata, modality = the slot's, status 'scheduled', notes 'Essentials by Odds, booked in the trainer auction'}` (the existing trigger `enforce_essentials_session_rules` runs on it too) and posts the care-team note through `essentials_client_note` ("Automatic note: Strength on Fri 2 Oct at 7:00 am is booked with Sagar Rao, from the trainer auction.").

Returns `{ session_id, auction_date, scheduled_for, slot_time, modality, client_id, client_name, trainer_id, trainer_name }`.

Refusals are plain sentences in `error.message`, show them as they are (strip a legacy `ESSENTIALS_EXPIRED:` / `ESSENTIALS_DAILY_LIMIT:` / `ESSENTIALS_VACATION:` prefix if one appears):
- "Sign in to book." / "Only trainers can book from the auction."
- "The auction is for tomorrow's trainings only." / "The auction is open from 1:00 pm to 4:00 pm IST."
- "Client not found." / "This client is not on Essentials by Odds." / "This client is not active."
- "Essentials by Odds does not cover 2 Oct." / "The client is away on 2 Oct." / "The client is on vacation on 2 Oct."
- "The client has no training set for Fri."
- "Someone already booked this training."  (another trainer was first; refetch the lots)
- "This training is reserved for Riya Sen until 1:30 pm."
- "You already have a session at 7:00 am on 2 Oct."
- the trigger's own: "Essentials clients can have only 1 session per day (02-Oct-2026 already has one).", "This client's Essentials pass does not cover 02-Oct-2026. Ask an admin to extend it.", "This client is on vacation on 02-Oct-2026. Sessions can't be booked during vacation."
- `PGRST202` / "could not find the function": the migration is not run yet; show "The auction is not set up on the server yet."

### 3.4 No log table
There is no auction table. The `session_schedule` row is the only record of a grab (client, trainer, time, modality, `created_at`; its `notes` say "Essentials by Odds, booked in the trainer auction"). The lots carry "grabbed by" from that row, so the screen needs nothing else.

### 3.5 Grants
All three functions: `REVOKE ALL FROM public, anon`, `GRANT EXECUTE TO authenticated`; the role check is inside. Anon probes answer 401 / 42501 once the migration is live.

### 3.6 Data the functions read (already live, for reference only; the app does not read these for this screen)
- `clients.essentials_extensions` jsonb array, newest entry = current pass: `{kind: start | extension | vacation | vacation_ended | cleared, start_date, end_date, vacation_start?, vacation_end?, ...}` (`YYYY-MM-DD` IST).
- `clients.weekly_protocol` jsonb: `{ entries: [{modality, days[], times{day: 'HH:MM'}, frequency, sessions_per_week, trainer_id?, trainer_name?}], slots: [{day: 'Mon'..'Sun', time: 'HH:MM', modality}], total_per_week, source: 'client', plan: 'Essentials by Odds', updated_at, updated_by }`. `slots` is what the auction reads; `entries[].trainer_id` is the preferred trainer.

## 4. Screen spec (mirror the web page `src/pages/trainer/EssentialsAuction.tsx`)

- **Entry.** Trainer drawer item "Essentials Auction" (gavel icon) after Events. Screen key `essentials-auction`. Every trainer sees it.
- **Hero** (dark navy to indigo gradient, amber gavel tile): title "Essentials Auction", line "Tomorrow's Essentials by Odds trainings. First trainer to book takes the lot.", chips: "Tomorrow · Fri 2 Oct", the window pill (green pulsing dot "LIVE · closes in 1h 55m" / amber "Opens at 1:00 PM · in 1h 30m" / grey "Closed for today · reopens 1:00 PM"), "Window 1:00 PM to 4:00 PM IST"; three counters Open / Grabbed / Yours.
- **Intro line** by phase: open "Each lot is one training. Book it and it goes straight on your roster; the client's care team is told automatically." / before "Preview of tomorrow's lots. Booking opens at 1:00 PM IST." / after "Booking closed at 4:00 PM IST. Lots still open go to the care team to fill." Plus a Refresh action.
- **Lot card** (one per row, auction look): "LOT 01" tag; top-right OPEN (flame) or RESERVED / RESERVED FOR YOU (user-check); grabbed lots get a rotated stamp GRABBED (rose) or YOURS (amber) and a tinted frame; the time large ("7:00 AM"), modality chip, client initials and name, "Essentials by Odds · Fri 2 Oct"; a sky line when a preferred trainer exists: "Usual trainer: Riya Sen", or during the head start "Riya Sen goes first until 1:30 PM" / "Yours first until 1:30 PM"; then the **Book my session** button (black, gavel) or the result line "Grabbed by Karan Mehta · 11:41 AM" / "Grabbed by you".
- **Button rule** (pure, port it): grabbed -> disabled ("Yours" or "Grabbed by <name>"); window not open -> disabled ("Opens at 1:00 PM" / "Closed at 4:00 PM"); reserved for another trainer -> disabled ("Reserved for Riya Sen until 1:30 PM"); else enabled. Show the reason as small text under a disabled button.
- **Confirmation** (a sheet, not a sibling modal): "Book this training?", a box with the client, "Strength · tomorrow, Fri 2 Oct at 7:00 AM", the three warnings from section 2, buttons "Not now" / "Yes, book my session" (amber). While booking: "Booking…", both buttons disabled.
- **After a grab**: toast "Booked. Aarav Mehra, Strength tomorrow at 7:00 AM is on your roster."; invalidate the auction query and the roster / sessions queries (the booking is on tomorrow's roster); the card flips to YOURS. On error: toast the sentence and refetch the lots.
- **Polling**: `['essentials-auction', date]`, staleTime 10 s, refetchInterval 20 s while the screen is focused, refetch on foreground. Config `['essentials-auction-config']` staleTime Infinity.
- **Empty**: "No lots for tomorrow" with "No Essentials by Odds client has a training set for Fri 2 Oct that is still unbooked. Lots appear as clients save their week in the app." **Error**: "Could not load the auction." plus the message.
- No health data on this screen, so no replay-shield route entry is needed.

## 5. The pure rules, copy as `src/lib/essentialsAuction.ts` (they are the web file minus React)

```ts
export const IST = "Asia/Kolkata";
export interface AuctionConfig { open: string; close: string; reserve_minutes: number }
export const DEFAULT_AUCTION_CONFIG: AuctionConfig = { open: "11:30", close: "14:00", reserve_minutes: 30 };
export type LotStatus = "open" | "reserved" | "grabbed";
export interface AuctionLot {
  auction_date: string; client_id: string; client_name: string; modality: string; slot_time: string; scheduled_for: string;
  status: LotStatus; trainer_id: string | null; trainer_name: string | null; grabbed_at: string | null; session_id: string | null;
  preferred_trainer_id: string | null; preferred_trainer_name: string | null; reserved_until: string | null;
}
export interface GrabResult { session_id: string; auction_date: string; scheduled_for: string; slot_time: string; modality: string; client_id: string; client_name: string; trainer_id: string; trainer_name: string | null }

let clock: () => Date = () => new Date();
export const setAuctionClock = (fn: (() => Date) | null) => { clock = fn ?? (() => new Date()); };
export const auctionNow = (): Date => clock();

export interface IstParts { date: string; time: string; minutes: number; weekday: string }
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const istParts = (d: Date = auctionNow()): IstParts => {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: IST, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const hh = Number(get("hour")) % 24; const mm = Number(get("minute"));
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`, minutes: hh * 60 + mm, weekday: get("weekday").slice(0, 3) };
};
export const addDays = (ymd: string, n: number): string => { const dt = new Date(`${ymd}T00:00:00Z`); dt.setUTCDate(dt.getUTCDate() + n); return dt.toISOString().slice(0, 10); };
export const weekdayOf = (ymd: string): string => WEEKDAYS[new Date(`${ymd}T00:00:00Z`).getUTCDay()];
export const auctionTargetDate = (now: Date = auctionNow()): string => addDays(istParts(now).date, 1);
export const toMinutes = (hhmm: string): number => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
export type WindowPhase = "before" | "open" | "after";
export interface WindowState { phase: WindowPhase; open: boolean; minutesLeft: number; opensAt: string; closesAt: string }
export const windowState = (cfg: AuctionConfig, now: Date = auctionNow()): WindowState => {
  const nowMin = istParts(now).minutes; const openMin = toMinutes(cfg.open); const closeMin = toMinutes(cfg.close);
  const opensAt = formatTime12(cfg.open); const closesAt = formatTime12(cfg.close);
  if (nowMin < openMin) return { phase: "before", open: false, minutesLeft: openMin - nowMin, opensAt, closesAt };
  if (nowMin < closeMin) return { phase: "open", open: true, minutesLeft: closeMin - nowMin, opensAt, closesAt };
  return { phase: "after", open: false, minutesLeft: 0, opensAt, closesAt };
};
export const formatTime12 = (hhmm: string): string => { const [h, m] = hhmm.split(":").map(Number); if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm; const suffix = h >= 12 ? "PM" : "AM"; const h12 = h % 12 === 0 ? 12 : h % 12; return `${h12}:${String(m).padStart(2, "0")} ${suffix}`; };
export const formatCountdown = (minutes: number): string => { if (minutes <= 0) return "under a minute"; const h = Math.floor(minutes / 60); const m = minutes % 60; if (h === 0) return `${m}m`; return m === 0 ? `${h}h` : `${h}h ${m}m`; };
export const formatLotDate = (ymd: string): string => { const d = new Date(`${ymd}T00:00:00Z`); return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getUTCMonth()]}`; };
export const lotNumber = (index: number): string => `LOT ${String(index + 1).padStart(2, "0")}`;
export const istClock = (iso: string): string => formatTime12(istParts(new Date(iso)).time);
export const canGrab = (lot: AuctionLot, me: string | null, win: WindowState): { ok: boolean; why: string | null } => {
  if (lot.status === "grabbed") return { ok: false, why: lot.trainer_id === me ? "Yours" : `Grabbed by ${lot.trainer_name ?? "a trainer"}` };
  if (!win.open) return { ok: false, why: win.phase === "before" ? `Opens at ${win.opensAt}` : `Closed at ${win.closesAt}` };
  if (lot.status === "reserved" && lot.preferred_trainer_id && lot.preferred_trainer_id !== me) return { ok: false, why: `Reserved for ${lot.preferred_trainer_name ?? "the client's trainer"} until ${lot.reserved_until ? istClock(lot.reserved_until) : "later"}` };
  return { ok: true, why: null };
};
export const describeGrabError = (e: unknown): string => {
  const raw = (e as { message?: string } | undefined)?.message ?? String(e ?? "");
  const m = raw.match(/ESSENTIALS_(?:EXPIRED|DAILY_LIMIT|VACATION):\s*(.*)/); const clean = m ? m[1] : raw;
  if (/failed to fetch|network/i.test(clean)) return "Network problem. Check your connection and try again.";
  if (/PGRST202|could not find the function/i.test(clean)) return "The auction is not set up on the server yet.";
  return clean || "Could not book this training.";
};
```

Calls, with the app's Supabase client: `supabase.rpc("essentials_auction_config")`, `supabase.rpc("get_essentials_auction", { p_date: date })` (trainers may also pass nothing), `supabase.rpc("grab_essentials_session", { p_client_id: clientId, p_date: date })`. Wrap each in `withTimeout`.

## 6. Verify

- **Is the migration live?** Anon probe with the publishable key `sb_publishable_ikJxky7zQFeIUtxWRsgbJw_i7pNq9cf` at `https://agtjszjedaenclbzgjvi.supabase.co`: `POST /rest/v1/rpc/get_essentials_auction` with `{}`. Calibration: 404 `PGRST202` = function missing (migration not run, build against the contract and say so); 401 `42501` = live and locked to signed-in users (what we want); 200 = open (wrong, tell the owner).
- **Read-only live check as Sagar** (trainer): `get_essentials_auction()` returns tomorrow's lots or an empty array, never an error. The window and reserve values come from `essentials_auction_config()`.
- **Grab test**: only inside the window, only on a real Essentials client with a slot for tomorrow, and only when the owner says so; it creates a real booking and posts a real chat note. Prefer a throw-away test client the admin puts on Essentials with a saved week (`essentials_client_set_week` is for the client or an admin). After the test the admin cancels the session row (status cancelled) so the lot opens again.
- **Offline**: port the web's `essentialsAuction.test.ts` cases (India clock across midnight, target day, phases at 11:00 / 11:30 / 13:59 / 14:00 / 23:30 / 00:10, texts, the button rule for open / before / grabbed / reserved lots).
- tsc and a Metro bundle clean; device test; then the feature doc with a dated change-log line.

## 7. Do not

- Do not insert into `session_schedule` or any other table from the app; do not read `clients` to rebuild the lots yourself; do not compute "one a day" locally.
- Do not rename or re-shape the RPCs; the web page and the iOS client app depend on them.
- Do not show `paid_cancellation` to anyone; do not use em dashes; do not say "session" for a training in client-facing copy.
