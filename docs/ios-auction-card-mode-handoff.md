# iOS handoff: Essentials auction card says at home or virtual (Android since 23 Oct 2026)

Each session card on the Essentials Auction page says where the session happens: the modality pill next to the time
reads "Strength · at home" or "Strength · virtual". The client plans every day in the Essentials (client) app as home
or virtual; since 23 Oct 2026 that plan lives in `public.essentials_weeks`, and the auction RPC returns the day's
`mode` on every lot.

- Android commit 7708160 (23 Oct 2026): `src/lib/essentialsAuction.ts` (the lot type gains `mode`) and
  `src/screens/essentialsAuction.tsx` (the pill text, plus the header comment's note on where the week plan comes
  from). Four lines. No new package, no new query.
- Server: live, nothing to run. The column arrived with hub-track migration `20261023100000_essentials_weeks_b2b.sql`
  (run live 23 Oct 2026 morning), the old-plan fallback with `20261023120000_essentials_weeks_fallback.sql` (live
  23 Oct 2026 afternoon); the current text of the RPC is `20261026100000_essentials_client_cancellations.sql`, which
  keeps the column.
- Feature doc: `b2b/docs/features/android/trainer/essentials-auction.md` (section 1, "The plan lives in
  essentials_weeks", and the 2026-10-23 change log line).

**Android gap found while writing this.** Android's lots hook `useEssentialsAuction`
(`src/lib/essentialsAuctionQueries.ts`) builds each lot field by field and does not copy `mode`, so on Android
`lot.mode` is always undefined and the pill still shows the modality alone. The web auction page maps it
(`mode: r.mode ?? null` in hub-track `src/hooks/useEssentialsAuction.ts`) and shows the suffix. Port 3.3 as well,
or iOS will copy Android's blank pill. Android itself has not been changed by this handoff.

## 1. What the user sees (Android)
- Drawer > Essentials Auction, every session card: the large time ("7:00 AM") and, to its right, the modality pill.
- Pill text: `{modality} · at home` or `{modality} · virtual`, for example "Strength · at home", "Cardio · virtual".
  A lot without a modality: "Training · at home".
- Any value other than `virtual` reads "at home". No value at all (a server older than 23 Oct) shows the modality
  alone, as before.
- Pill colour, size and place are unchanged; the client row, the summaries strip, bids and results are unchanged.
- On Android today the suffix does not appear (the gap above); the web auction page shows it with the same words.

## 2. Data / server contract
- RPC `get_essentials_auction(p_date date DEFAULT NULL, p_as_manager boolean DEFAULT false)`, called by the app with
  no arguments (tomorrow, IST). Its last output column is `mode text`:
```sql
CREATE FUNCTION public.get_essentials_auction(p_date date DEFAULT NULL, p_as_manager boolean DEFAULT false)
RETURNS TABLE (
  ...
  round_result           text,
  evaluated_at           timestamptz,
  mode                   text
)
```
- Where the value comes from, in the same function (`s` is the day returned by `essentials_day_of(client, date)`):
```sql
    SELECT e.id, e.client_name, e.wp,
           left(s->>'time', 5) AS slot_time,
           trim(s->>'modality') AS modality,
           COALESCE(NULLIF(s->>'mode', ''), 'home') AS mode
      FROM eligible e
      CROSS JOIN LATERAL (SELECT public.essentials_day_of(e.id, v_date) AS s) x
```
  So the live RPC always answers `home` or `virtual`, never null.
- `essentials_day_of` reads `public.essentials_weeks` (one row per client per Monday to Sunday week,
  `days = [{date, time, modality, mode}]`, `mode` `home` | `virtual`, written only by the client app through
  `essentials_set_days`). For a client who has never planned in the app (no `essentials_weeks` row at all) it falls
  back to the old `clients.weekly_protocol.slots` weekday entry, with the slot's `mode` or `home`.
- Related rule, server side only: a vacation (pause) day is offered in the auction only when it was planned as
  virtual.
- `get_essentials_unsold` returns `mode` too; nothing on this card uses it.
- No new call, key or invalidation: the existing `['essentials-auction', date]` query (20 s poll) carries it.

## 3. Code to port

### 3.1 `src/lib/essentialsAuction.ts` (pure: copy byte for byte, whole file, 410 lines)
The 7708160 change is two lines in `AuctionLot`, after `scheduled_for`. Before:
```ts
export type AuctionLot = {
  auction_date: string;
  client_id: string;
  client_name: string;
  modality: string;
  slot_time: string; // "07:00" IST
  scheduled_for: string; // timestamptz
  status: LotStatus;
```
After:
```ts
export type AuctionLot = {
  auction_date: string;
  client_id: string;
  client_name: string;
  modality: string;
  slot_time: string; // "07:00" IST
  scheduled_for: string; // timestamptz
  /** home or virtual (23 Oct 2026, from essentials_weeks.days[].mode); older rows have no value */
  mode?: string | null;
  status: LotStatus;
```
Copy the whole current file below rather than only these lines. It also carries what the later handoffs added
(`ios-essentials-cancellation-handoff.md` 26 Oct, `ios-essentials-cancellations-handoff.md` 27 Oct: `cancelled`
rounds, `ESSENTIALS_LOCKED`, `clientCancelLine`, `markedLine`), so iOS ends identical to Android. Line 1 imports
`friendlyError` from `./friendlyError` without using it; the node tests do not need that file (the unused import is
dropped when they transpile), but `tsc` does: `src/lib/friendlyError.ts` comes from the plain-English errors port
(its latest fix is in `ios-plan-cover-handoff.md` 8.3). Git stores the Android file with LF line endings.
```ts
import { friendlyError } from './friendlyError';
/* Essentials by Odds trainer auction (1 Oct 2026): the pure half, ported from the
   web's src/lib/essentialsAuction.ts so both apps read the clock the same way.
   Every rule about "which day" and "is the window open" lives here, in India
   time, with no app imports (node-testable). The database decides the same
   things again in get_essentials_auction / grab_essentials_session; this file
   only shapes what the screen shows and when its buttons are live. */

export const IST = 'Asia/Kolkata';

export type AuctionConfig = {
  /** Window open and close, IST "HH:MM", on the day before the training. */
  open: string;
  close: string;
  /** Minutes after opening that the CRM-set trainer has the lot to themselves. */
  reserve_minutes: number;
};

/** Mirrors essentials_auction_config() in the database (1:00 PM to 4:00 PM IST since 1 Oct 2026, owner
    request); the hook reads the live one and falls back to this. */
export const DEFAULT_AUCTION_CONFIG: AuctionConfig = { open: '13:00', close: '17:30', reserve_minutes: 30 }; // 1:00 PM to 5:30 PM IST since 15 Oct 2026 evening (5:00 PM earlier that day, 4:00 PM before)

export type LotStatus = 'open' | 'reserved' | 'grabbed';

/** 'cancelled' since 26 Oct 2026: the client (or the care team for the client) cancelled the day; the session leaves the auction. */
export type RoundResult = 'won' | 'booked_elsewhere' | 'no_bids' | 'no_winner' | 'cancelled' | null;

/* Nobody on the staff side cancels a session booked through the auction (owner, 26 Oct 2026): the server
   refuses with ESSENTIALS_LOCKED; only the client cancels it, as a rest day in the Essentials app. */
export const ESSENTIALS_LOCKED_PREFIX = 'ESSENTIALS_LOCKED';
export const ESSENTIALS_LOCKED_MESSAGE = 'This Essentials session was booked through the auction. Only the client can cancel it, in the Essentials app.';
export const isEssentialsLockedError = (message: string | null | undefined): boolean => (message ?? '').includes(ESSENTIALS_LOCKED_PREFIX);

/** One row of get_my_essentials_cancellations: a session of mine the client cancelled in the app (26 Oct 2026). */
export type EssentialsCancellation = {
  round_key: string;
  client_id: string;
  client_name: string;
  training_date: string;
  slot_time: string;
  modality: string;
  cancelled_at: string;
  session_id: string | null;
  was_winner: boolean;
  /* The client app's verdict (27 Oct 2026): a training on today's or tomorrow's date is TAGGED (the roster row
     stays until the trainer marks it); kind paid = one of the client's 20, free = not counted. */
  tagged: boolean;
  kind: 'paid' | 'free';
  hours_before: number | null;
  schedule_status: string | null;
  marked: boolean;
};

/** The dashboard alert line: "Aarav Mehra cancelled Strength on Tue 27 Oct at 7:00 PM". */
export const cancellationLine = (c: Pick<EssentialsCancellation, 'client_name' | 'modality' | 'training_date' | 'slot_time'>): string =>
  `${c.client_name} cancelled ${c.modality || 'the training'} on ${formatLotDate(c.training_date)}${c.slot_time ? ` at ${formatTime12(c.slot_time)}` : ''}`;

/** The whole card line: the client app's own words for a tagged day, the plain line otherwise. */
export const clientCancelLine = (c: Pick<EssentialsCancellation, 'client_name' | 'modality' | 'training_date' | 'slot_time' | 'tagged' | 'kind' | 'hours_before'>, todayYmd: string): string => {
  const when = c.training_date === todayYmd ? "today's" : c.training_date === addDays(todayYmd, 1) ? "tomorrow's" : `${formatLotDate(c.training_date)}'s`;
  const what = `${when}${c.slot_time ? ` ${formatTime12(c.slot_time)}` : ''} ${c.modality || 'training'}`;
  if (!c.tagged) return `${c.client_name} cancelled ${what} in the app. It is off your roster.`;
  const hours = c.hours_before != null ? `, ${Math.round(c.hours_before * 10) / 10} hours before` : '';
  return `${c.client_name} cancelled ${what} in the app${hours}: ${c.kind === 'paid' ? 'a paid cancellation, one of their 20' : 'a free cancellation'}. Mark it on your roster.`;
};

/** The second line under a tagged card once the trainer marked it. */
export const markedLine = (kind: 'paid' | 'free'): string => (kind === 'paid' ? 'Marked as a paid cancellation. The care team approves the payout.' : 'Marked as a free cancellation. Nothing counts.');

/** One row of get_essentials_auction (the bid fields since 10 Oct 2026, migration 20261010120000). */
export type AuctionLot = {
  auction_date: string;
  client_id: string;
  client_name: string;
  modality: string;
  slot_time: string; // "07:00" IST
  scheduled_for: string; // timestamptz
  /** home or virtual (23 Oct 2026, from essentials_weeks.days[].mode); older rows have no value */
  mode?: string | null;
  status: LotStatus;
  trainer_id: string | null;
  trainer_name: string | null;
  grabbed_at: string | null;
  session_id: string | null;
  preferred_trainer_id: string | null;
  preferred_trainer_name: string | null;
  reserved_until: string | null;
  /** Bids so far on this session for tomorrow. */
  bids_count: number;
  /** Questions in the client's questionnaire; 0 when none is on file (then every bid scores 0 and the earliest wins). */
  question_count: number;
  my_points: number | null;
  my_submitted_at: string | null;
  winner_trainer_id: string | null;
  winner_name: string | null;
  winner_points: number | null;
  round_result: RoundResult;
  evaluated_at: string | null;
};

/** get_essentials_auction_quiz: the questions without their answers. */
export type AuctionQuizQuestion = { n: number; source: 'weekly' | 'context'; question: string; options: string[] };
export type AuctionQuiz = {
  client_id: string;
  training_date: string;
  /** The database's plain sentence when the caller may not bid on this session right now. */
  blocked: string | null;
  questionnaire_version: number | null;
  question_count: number;
  questions: AuctionQuizQuestion[];
  already_bid: boolean;
  my_bid: { points: number; submitted_at: string; correct: boolean[] } | null;
  bids_count: number;
};

/** What submit_essentials_bid returns. */
export type BidResult = {
  client_id: string;
  client_name: string;
  training_date: string;
  slot_time: string;
  modality: string;
  points: number;
  question_count: number;
  correct: boolean[];
  submitted_at: string;
  bids_count: number;
  /** Since 15 Oct 2026: a perfect score on an open round books the session at once and closes the round. */
  instant_win: boolean;
  session_id: string | null;
  winner_name: string | null;
  /** A perfect score whose instant booking the server refused (clash, two days in a row, already booked): the bid waits for the close. */
  instant_blocked: string | null;
};

/** The banner after a bid: won on the spot, perfect but not bookable now, or the ordinary "decided at" line. */
export const bidBannerText = (r: BidResult, closesAt: string): string => {
  const when = `${formatLotDate(r.training_date)} at ${formatTime12(r.slot_time)}`;
  if (r.instant_win) return `Perfect score! ${r.client_name}'s ${r.modality || 'session'} on ${when} is yours. It is on your roster.`;
  if (r.instant_blocked) return `${pointsText(r.points, r.question_count)} correct, but the session could not be booked at once (${r.instant_blocked}). Decided at ${closesAt}.`;
  return `Bid placed for ${r.client_name}: ${pointsText(r.points, r.question_count)} correct. Decided at ${closesAt}.`;
};

/** One row of get_my_auction_results: a decided round the caller bid in. */
export type AuctionResult = {
  round_key: string;
  client_id: string;
  client_name: string;
  training_date: string;
  slot_time: string;
  modality: string;
  won: boolean;
  result: RoundResult;
  my_points: number;
  question_count: number;
  my_submitted_at: string;
  winner_trainer_id: string | null;
  winner_name: string | null;
  winner_points: number | null;
  bids_count: number;
  session_id: string | null;
  evaluated_at: string;
};

/** A bid as the round stores it; rankBids mirrors the SQL order of essentials_auction_evaluate. */
export type RoundBid = { trainer_id: string; points: number; submitted_at: string };

/** Highest points, then the earliest submission, then the client's usual trainer. (Texts and tests only: the server decides.) */
export const rankBids = <T extends RoundBid>(bids: T[], preferredTrainerId: string | null = null): T[] =>
  [...bids].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    const ta = new Date(a.submitted_at).getTime();
    const tb = new Date(b.submitted_at).getTime();
    if (ta !== tb) return ta - tb;
    const pa = a.trainer_id === preferredTrainerId ? 1 : 0;
    const pb = b.trainer_id === preferredTrainerId ? 1 : 0;
    return pb - pa;
  });

/** "4 of 5" style points text; "no questions" when the client has no questionnaire. */
export const pointsText = (points: number | null | undefined, total: number): string =>
  total > 0 ? `${points ?? 0} of ${total}` : 'no questions';

/** The one-line verdict on a won / lost card. */
export const resultHeadline = (r: AuctionResult): string => {
  const when = `${formatLotDate(r.training_date)} at ${formatTime12(r.slot_time)}`;
  if (r.won) return `You won ${r.client_name}, ${r.modality} on ${when}`;
  if (r.result === 'booked_elsewhere') return `${r.client_name}'s ${r.modality} on ${when} was booked outside the auction`;
  if (r.result === 'no_winner') return `No one could be booked for ${r.client_name}'s ${r.modality} on ${when}`;
  if (r.result === 'cancelled') return `${r.client_name}'s ${r.modality} on ${when} was cancelled`;
  return `${r.winner_name ?? 'Another trainer'} won ${r.client_name}'s ${r.modality} on ${when}`;
};

/** The second line of a won / lost card: the scores. */
export const resultDetail = (r: AuctionResult): string => {
  const mine = pointsText(r.my_points, r.question_count);
  if (r.won) return `${mine} correct · ${r.bids_count} bid${r.bids_count === 1 ? '' : 's'} · the session is on your roster`;
  if (r.result === 'won') {
    const theirs = pointsText(r.winner_points, r.question_count);
    return r.winner_points === r.my_points ? `${theirs} each · they answered earlier` : `${theirs} against your ${mine}`;
  }
  return `Your bid: ${mine} correct`;
};

/** The session card's result line once a session_schedule row exists. */
export const lotResultLine = (lot: AuctionLot, me: string | null): string => {
  const mine = lot.status === 'grabbed' && lot.trainer_id === me;
  const decided = lot.round_result === 'won';
  const score = decided && lot.question_count > 0 && lot.winner_points != null ? ` · ${pointsText(lot.winner_points, lot.question_count)}` : '';
  if (mine) return `Won by you${score}`;
  if (decided) {
    const you = lot.my_points != null && lot.question_count > 0 ? ` · you ${pointsText(lot.my_points, lot.question_count)}` : '';
    return `Won by ${lot.winner_name ?? lot.trainer_name ?? 'a trainer'}${score}${you}`;
  }
  return `Booked by ${lot.trainer_name ?? 'a trainer'}`;
};

/** "2 bids · 5 questions" or "2 bids · no questions yet, earliest bid wins". */
export const bidsLine = (lot: AuctionLot): string =>
  `${lot.bids_count} bid${lot.bids_count === 1 ? '' : 's'} · ${lot.question_count > 0 ? `${lot.question_count} questions` : 'no questions yet, earliest bid wins'}`;

export type IstParts = { date: string; time: string; minutes: number; weekday: string };

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The date, clock time and weekday in India for an instant. */
export const istParts = (d: Date = new Date()): IstParts => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: IST, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const hh = Number(get('hour')) % 24;
  const mm = Number(get('minute'));
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`,
    minutes: hh * 60 + mm,
    weekday: get('weekday').slice(0, 3),
  };
};

export const addDays = (ymd: string, n: number): string => {
  const dt = new Date(`${ymd}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
};

/** Weekday ("Mon") of a YYYY-MM-DD date. */
export const weekdayOf = (ymd: string): string => WEEKDAYS[new Date(`${ymd}T00:00:00Z`).getUTCDay()];

/** The auction always sells tomorrow, India time. */
export const auctionTargetDate = (now: Date = new Date()): string => addDays(istParts(now).date, 1);

export const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

export type WindowPhase = 'before' | 'open' | 'after';
export type WindowState = {
  phase: WindowPhase;
  open: boolean;
  /** Minutes until the window opens (before) or closes (open); 0 after it closed. */
  minutesLeft: number;
  opensAt: string; // "11:30 AM"
  closesAt: string; // "2:00 PM"
};

/** Where the clock sits against the daily window. */
export const windowState = (cfg: AuctionConfig, now: Date = new Date()): WindowState => {
  const nowMin = istParts(now).minutes;
  const openMin = toMinutes(cfg.open);
  const closeMin = toMinutes(cfg.close);
  const opensAt = formatTime12(cfg.open);
  const closesAt = formatTime12(cfg.close);
  if (nowMin < openMin) return { phase: 'before', open: false, minutesLeft: openMin - nowMin, opensAt, closesAt };
  if (nowMin < closeMin) return { phase: 'open', open: true, minutesLeft: closeMin - nowMin, opensAt, closesAt };
  return { phase: 'after', open: false, minutesLeft: 0, opensAt, closesAt };
};

/** "07:00" -> "7:00 AM". */
export const formatTime12 = (hhmm: string): string => {
  const [h, m] = hhmm.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
};

/** "1h 12m" / "45m" / "under a minute". */
export const formatCountdown = (minutes: number): string => {
  if (minutes <= 0) return 'under a minute';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
};

/** "Thu 2 Oct" for a YYYY-MM-DD. */
export const formatLotDate = (ymd: string): string => {
  const d = new Date(`${ymd}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
};

/** The card tag: "SESSION 01" (the user prefers "session" to "lot" in the app, 1 Oct 2026). */
export const lotNumber = (index: number): string => `SESSION ${String(index + 1).padStart(2, '0')}`;

/** Time of a timestamptz in IST, "12:00 PM". */
export const istClock = (iso: string): string => formatTime12(istParts(new Date(iso)).time);

/** Can this trainer press "Answer and bid" right now? (Named canGrab since the first-come days; the rule is the bid rule.) */
export const canGrab = (lot: AuctionLot, me: string | null, win: WindowState): { ok: boolean; why: string | null } => {
  if (lot.status === 'grabbed') {
    if (lot.trainer_id === me) return { ok: false, why: 'Yours' };
    return { ok: false, why: lot.round_result === 'won' ? `Won by ${lot.winner_name ?? lot.trainer_name ?? 'a trainer'}` : `Booked by ${lot.trainer_name ?? 'a trainer'}` };
  }
  if (lot.my_points != null) return { ok: false, why: `You answered · ${pointsText(lot.my_points, lot.question_count)} · result at ${win.closesAt}` };
  if (!win.open) return { ok: false, why: win.phase === 'before' ? `Opens at ${win.opensAt}` : `Closed at ${win.closesAt}` };
  if (lot.status === 'reserved' && lot.preferred_trainer_id && lot.preferred_trainer_id !== me) {
    return { ok: false, why: `Reserved for ${lot.preferred_trainer_name ?? "the client's trainer"} until ${lot.reserved_until ? istClock(lot.reserved_until) : 'later'}` };
  }
  return { ok: true, why: null };
};
export const canBid = canGrab;

/** Human text for a refused grab: the booking trigger's legacy ESSENTIALS_* prefix is stripped, missing setup and network problems get plain words. */
export const describeGrabError = (e: unknown): string => {
  const err = e as { message?: string; code?: string } | undefined;
  const raw = err?.message ?? String(e ?? '');
  const m = raw.match(/ESSENTIALS_(?:EXPIRED|DAILY_LIMIT|VACATION):\s*(.*)/);
  const clean = m ? m[1] : raw;
  if (err?.code === 'PGRST202' || /PGRST202|could not find the function/i.test(clean)) return 'The auction is not set up on the server yet.';
  // A half-run migration (a function without its table): say so in plain words, never leak the SQL object name.
  if (err?.code === '42P01' || /relation .* does not exist/i.test(clean)) return 'The auction is not fully set up on the server yet. Ask the tech team to finish the auction setup.';
  // Two trainers in the same instant: the one behind waits on the client row lock; a
  // lock wait past 5 s, or the unique index on (client, time), both read as "taken".
  if (err?.code === '55P03' || /lock timeout/i.test(clean)) return 'Another trainer is booking this training right now. Give it a moment, then pull to refresh.';
  if (err?.code === '23505' || /duplicate key|unique/i.test(clean)) return 'Someone already booked this training.';
  if (/failed to fetch|network request failed|network/i.test(clean)) return 'Network problem. Check your connection and try again.';
  if (/timed out|timeout|took too long/i.test(clean)) return 'The bid took too long. Pull to refresh to see whether it went through, then try again.';
  return clean || 'Could not place this bid.';
};

/** True when a refused bid means the session is no longer open (booked, decided, or already answered). */
export const isTakenError = (message: string) => /already booked|already has one|only 1 session per day|already answered|has been decided|already won by/i.test(message);

/* ---------- ETA between the trainer's neighbouring sessions and the lot (1 Oct 2026) ----------
   Straight-line ≈ road distance (×1.35) + metro drive time (~22 km/h): the same instant,
   offline estimate the roster card uses (trainer.tsx approxTravel). Sessions are taken as
   60 minutes; neighbours are the trainer's own sessions within 3 hours either side. */
export type GeoPoint = { lat: number; lng: number };
export const SESSION_LEN_MIN = 60;
export const ETA_WINDOW_MIN = 180;

export const approxTravel = (a: GeoPoint, b: GeoPoint): { km: number; min: number } => {
  const R = 6371, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  const km = +(2 * R * Math.asin(Math.sqrt(h)) * 1.35).toFixed(1);
  return { km, min: Math.max(1, Math.round((km / 22) * 60)) };
};

/** clients.brb_location → a point, or null when the pin is missing or malformed. */
export const geoFromBrb = (v: unknown): GeoPoint | null => {
  const o = v as { lat?: unknown; lng?: unknown } | null;
  const lat = Number(o?.lat), lng = Number(o?.lng);
  return o && Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0) ? { lat, lng } : null;
};

export type EtaSession = { id: string; start: string; name: string; modality: string | null; loc: GeoPoint | null; locText: string | null };
export type EtaNeighbour = {
  session: EtaSession;
  /** Minutes between the end of the earlier session and the start of the later one (negative = overlap). */
  gapMin: number;
  /** Road estimate between the two clients; null when either side has no map pin. */
  etaMin: number | null;
  km: number | null;
  /** The trainer cannot make it in time: the drive is longer than the gap (or the sessions overlap). */
  tight: boolean;
};
export type LotEta = { loc: GeoPoint | null; locText: string | null; prev: EtaNeighbour | null; next: EtaNeighbour | null; tight: boolean };

/** The lot's ETA picture from the trainer's sessions of that day (any order). */
export function computeLotEta(lotStartIso: string, lotLoc: GeoPoint | null, lotLocText: string | null, sessions: EtaSession[]): LotEta {
  const t = Date.parse(lotStartIso);
  const win = ETA_WINDOW_MIN * 60_000;
  const before = sessions.filter((s) => { const st = Date.parse(s.start); return st < t && st >= t - win; }).sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
  const after = sessions.filter((s) => { const st = Date.parse(s.start); return st > t && st <= t + win; }).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const mk = (s: EtaSession | undefined, side: 'prev' | 'next'): EtaNeighbour | null => {
    if (!s) return null;
    const st = Date.parse(s.start);
    const gapMin = Math.round(side === 'prev' ? (t - (st + SESSION_LEN_MIN * 60_000)) / 60_000 : (st - (t + SESSION_LEN_MIN * 60_000)) / 60_000);
    const travel = lotLoc && s.loc ? approxTravel(s.loc, lotLoc) : null;
    const etaMin = travel ? travel.min : null;
    const tight = etaMin != null ? etaMin > gapMin : gapMin < 0;
    return { session: s, gapMin, etaMin, km: travel ? travel.km : null, tight };
  };
  const prev = mk(before[0], 'prev');
  const next = mk(after[0], 'next');
  return { loc: lotLoc, locText: lotLocText, prev, next, tight: !!(prev?.tight || next?.tight) };
}

/** "25 min" / "1 hr 10 min". */
export const formatMinutes = (min: number): string => {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} hr ${r} min` : `${h} hr`;
};
```

### 3.2 Tests (whole files; neither checks `mode`, which is a type field only)
`tests/rules/auction_rules_test.js` (123 lines, 76 checks):
```js
// Rule test for the Odds staff app. ROOT = the repo root; point it at the iOS repo and run: node tests/rules/auction_rules_test.js
const ROOT = require("path").resolve(__dirname, "../..");
// node test of the auction's pure rules (India clock, target day, window, button rule, texts, bids since 10 Oct 2026).
const ts = require(ROOT + '/node_modules/typescript');
const fs = require('fs');
const src = fs.readFileSync(ROOT + '/src/lib/essentialsAuction.ts', 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const m = { exports: {} };
new Function('module', 'exports', 'require', js)(m, m.exports, require);
const A = m.exports;

let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };
const ist = (ymd, hhmm) => new Date(`${ymd}T${hhmm}:00+05:30`);
const cfg = A.DEFAULT_AUCTION_CONFIG;

eq('istParts across midnight (23:50 UTC = 05:20 IST next day)', A.istParts(new Date('2026-10-01T23:50:00Z')), { date: '2026-10-02', time: '05:20', minutes: 320, weekday: 'Fri' });
eq('target day is tomorrow IST', A.auctionTargetDate(ist('2026-10-01', '12:00')), '2026-10-02');
eq('target day flips at IST midnight', A.auctionTargetDate(ist('2026-10-01', '23:59')), '2026-10-02');
eq('target day after IST midnight', A.auctionTargetDate(ist('2026-10-02', '00:10')), '2026-10-03');
eq('window 11:00 before', [A.windowState(cfg, ist('2026-10-01', '11:00')).phase, A.windowState(cfg, ist('2026-10-01', '11:00')).minutesLeft], ['before', 120]);
eq('window 12:59 before', A.windowState(cfg, ist('2026-10-01', '12:59')).phase, 'before');
eq('window 13:00 open', [A.windowState(cfg, ist('2026-10-01', '13:00')).phase, A.windowState(cfg, ist('2026-10-01', '13:00')).minutesLeft], ['open', 270]);
eq('window 17:29 open', A.windowState(cfg, ist('2026-10-01', '17:29')).minutesLeft, 1);
eq('window 17:30 after', A.windowState(cfg, ist('2026-10-01', '17:30')).phase, 'after');
eq('window 23:30 after', A.windowState(cfg, ist('2026-10-01', '23:30')).phase, 'after');
eq('window 00:10 before', A.windowState(cfg, ist('2026-10-02', '00:10')).minutesLeft, 770);
eq('opensAt / closesAt text', [A.windowState(cfg, ist('2026-10-01', '12:00')).opensAt, A.windowState(cfg, ist('2026-10-01', '12:00')).closesAt], ['1:00 PM', '5:30 PM']);
eq('formatTime12', [A.formatTime12('07:00'), A.formatTime12('12:00'), A.formatTime12('00:30'), A.formatTime12('18:05')], ['7:00 AM', '12:00 PM', '12:30 AM', '6:05 PM']);
eq('countdown', [A.formatCountdown(0), A.formatCountdown(45), A.formatCountdown(60), A.formatCountdown(115)], ['under a minute', '45m', '1h', '1h 55m']);
eq('lot date', A.formatLotDate('2026-10-02'), 'Fri 2 Oct');
eq('weekdayOf', A.weekdayOf('2026-10-05'), 'Mon');
eq('lotNumber', A.lotNumber(0), 'SESSION 01');
eq('istClock', A.istClock('2026-10-01T06:30:00Z'), '12:00 PM');

const open = A.windowState(cfg, ist('2026-10-01', '14:00'));
const early = A.windowState(cfg, ist('2026-10-01', '13:10'));
const before = A.windowState(cfg, ist('2026-10-01', '10:00'));
const after = A.windowState(cfg, ist('2026-10-01', '18:00'));
const bidFields = { bids_count: 0, question_count: 5, my_points: null, my_submitted_at: null, winner_trainer_id: null, winner_name: null, winner_points: null, round_result: null, evaluated_at: null };
const base = { auction_date: '2026-10-02', client_id: 'c1', client_name: 'Aarav Mehra', modality: 'Strength', slot_time: '07:00', scheduled_for: '2026-10-02T01:30:00Z', status: 'open', trainer_id: null, trainer_name: null, grabbed_at: null, session_id: null, preferred_trainer_id: null, preferred_trainer_name: null, reserved_until: null, ...bidFields };
// ---- the button rule (canGrab, kept name; the bid rule since 10 Oct)
eq('open lot in window', A.canGrab(base, 'me', open), { ok: true, why: null });
eq('open lot before window', A.canGrab(base, 'me', before), { ok: false, why: 'Opens at 1:00 PM' });
eq('open lot after window', A.canGrab(base, 'me', after), { ok: false, why: 'Closed at 5:30 PM' });
eq('grabbed by me', A.canGrab({ ...base, status: 'grabbed', trainer_id: 'me' }, 'me', open).why, 'Yours');
eq('booked elsewhere by other', A.canGrab({ ...base, status: 'grabbed', trainer_id: 't2', trainer_name: 'Karan Mehta' }, 'me', open), { ok: false, why: 'Booked by Karan Mehta' });
eq('won by other', A.canGrab({ ...base, status: 'grabbed', trainer_id: 't2', trainer_name: 'Karan Mehta', round_result: 'won', winner_name: 'Karan Mehta', winner_points: 5 }, 'me', open), { ok: false, why: 'Won by Karan Mehta' });
eq('already answered', A.canGrab({ ...base, my_points: 4, my_submitted_at: '2026-10-01T08:12:00Z' }, 'me', open), { ok: false, why: 'You answered · 4 of 5 · result at 5:30 PM' });
eq('already answered beats the window text', A.canGrab({ ...base, my_points: 4 }, 'me', after).why, 'You answered · 4 of 5 · result at 5:30 PM');
const reserved = { ...base, status: 'reserved', preferred_trainer_id: 't9', preferred_trainer_name: 'Riya Sen', reserved_until: '2026-10-01T08:00:00Z' };
eq('reserved for another', A.canGrab(reserved, 'me', early), { ok: false, why: 'Reserved for Riya Sen until 1:30 PM' });
eq('reserved for me', A.canGrab(reserved, 't9', early), { ok: true, why: null });
eq('canBid is canGrab', A.canBid === A.canGrab, true);
// ---- bids: ranking, points text, card lines
const bids = [
  { trainer_id: 'a', points: 4, submitted_at: '2026-10-01T08:00:00Z' },
  { trainer_id: 'b', points: 5, submitted_at: '2026-10-01T08:30:00Z' },
  { trainer_id: 'c', points: 5, submitted_at: '2026-10-01T08:10:00Z' },
  { trainer_id: 'd', points: 5, submitted_at: '2026-10-01T08:10:00Z' },
];
eq('rankBids: points desc, then earlier, then usual trainer', A.rankBids(bids, 'd').map((b) => b.trainer_id), ['d', 'c', 'b', 'a']);
eq('rankBids: without a usual trainer the tie keeps input order', A.rankBids(bids, null).map((b) => b.trainer_id), ['c', 'd', 'b', 'a']);
eq('rankBids does not mutate', bids[0].trainer_id, 'a');
eq('pointsText', [A.pointsText(4, 5), A.pointsText(0, 5), A.pointsText(null, 5), A.pointsText(3, 0)], ['4 of 5', '0 of 5', '0 of 5', 'no questions']);
eq('bidsLine', [A.bidsLine({ ...base, bids_count: 2 }), A.bidsLine({ ...base, bids_count: 1, question_count: 0 })], ['2 bids · 5 questions', '1 bid · no questions yet, earliest bid wins']);
eq('lotResultLine won by other, I bid', A.lotResultLine({ ...base, status: 'grabbed', trainer_id: 't2', trainer_name: 'Karan Mehta', round_result: 'won', winner_name: 'Karan Mehta', winner_points: 5, my_points: 4 }, 'me'), 'Won by Karan Mehta · 5 of 5 · you 4 of 5');
eq('lotResultLine won by me', A.lotResultLine({ ...base, status: 'grabbed', trainer_id: 'me', round_result: 'won', winner_name: 'Me', winner_points: 5, my_points: 5 }, 'me'), 'Won by you · 5 of 5');
eq('lotResultLine booked elsewhere', A.lotResultLine({ ...base, status: 'grabbed', trainer_id: 't2', trainer_name: 'Karan Mehta' }, 'me'), 'Booked by Karan Mehta');
eq('lotResultLine won, no questions', A.lotResultLine({ ...base, status: 'grabbed', trainer_id: 't2', trainer_name: 'Karan Mehta', round_result: 'won', winner_name: 'Karan Mehta', winner_points: 0, question_count: 0 }, 'me'), 'Won by Karan Mehta');
// ---- results cards
const res = { round_key: 'c1:2026-10-02', client_id: 'c1', client_name: 'Aarav Mehra', training_date: '2026-10-02', slot_time: '07:00', modality: 'Strength', won: false, result: 'won', my_points: 4, question_count: 5, my_submitted_at: '2026-10-01T08:00:00Z', winner_trainer_id: 't2', winner_name: 'Karan Mehta', winner_points: 5, bids_count: 3, session_id: 's', evaluated_at: '2026-10-01T10:30:00Z' };
eq('headline won', A.resultHeadline({ ...res, won: true }), 'You won Aarav Mehra, Strength on Fri 2 Oct at 7:00 AM');
eq('headline lost', A.resultHeadline(res), "Karan Mehta won Aarav Mehra's Strength on Fri 2 Oct at 7:00 AM");
eq('headline booked elsewhere', A.resultHeadline({ ...res, result: 'booked_elsewhere' }), "Aarav Mehra's Strength on Fri 2 Oct at 7:00 AM was booked outside the auction");
eq('headline no winner', A.resultHeadline({ ...res, result: 'no_winner' }), "No one could be booked for Aarav Mehra's Strength on Fri 2 Oct at 7:00 AM");
// 26 Oct 2026: a cancelled day (the server reports won = false to everyone, the ex-winner included)
eq('headline cancelled', A.resultHeadline({ ...res, result: 'cancelled' }), "Aarav Mehra's Strength on Fri 2 Oct at 7:00 AM was cancelled");
eq('detail cancelled is the bid only', A.resultDetail({ ...res, result: 'cancelled' }), 'Your bid: 4 of 5 correct');
eq('cancellation line', A.cancellationLine({ client_name: 'Aarav Mehra', modality: 'Strength', training_date: '2026-10-02', slot_time: '07:00' }), 'Aarav Mehra cancelled Strength on Fri 2 Oct at 7:00 AM');
// 27 Oct 2026: the client app's cancel rule on the card (tagged today / tomorrow, paid or free; normal otherwise)
const cc = { client_name: 'Aarav Mehra', modality: 'Strength', training_date: '2026-10-28', slot_time: '19:00', tagged: true, kind: 'paid', hours_before: 4.2 };
eq('client cancel line, tagged paid tomorrow', A.clientCancelLine(cc, '2026-10-27'), "Aarav Mehra cancelled tomorrow's 7:00 PM Strength in the app, 4.2 hours before: a paid cancellation, one of their 20. Mark it on your roster.");
eq('client cancel line, tagged free today', A.clientCancelLine({ ...cc, training_date: '2026-10-27', kind: 'free', hours_before: 14.1 }, '2026-10-27'), "Aarav Mehra cancelled today's 7:00 PM Strength in the app, 14.1 hours before: a free cancellation. Mark it on your roster.");
eq('client cancel line, normal', A.clientCancelLine({ ...cc, training_date: '2026-10-30', tagged: false, kind: 'free', hours_before: null }, '2026-10-27'), "Aarav Mehra cancelled Fri 30 Oct's 7:00 PM Strength in the app. It is off your roster.");
eq('marked lines', [A.markedLine('paid'), A.markedLine('free')], ['Marked as a paid cancellation. The care team approves the payout.', 'Marked as a free cancellation. Nothing counts.']);
eq('locked error', [A.isEssentialsLockedError('ESSENTIALS_LOCKED: this Essentials session was booked through the auction.'), A.isEssentialsLockedError('PAID_CANCEL_CODE_REQUIRED: x'), A.isEssentialsLockedError(null)], [true, false, false]);
eq('detail won', A.resultDetail({ ...res, won: true, my_points: 5 }), '5 of 5 correct · 3 bids · the session is on your roster');
eq('detail won, one bid', A.resultDetail({ ...res, won: true, my_points: 5, bids_count: 1 }), '5 of 5 correct · 1 bid · the session is on your roster');
eq('detail lost on points', A.resultDetail(res), '5 of 5 against your 4 of 5');
eq('detail lost on time', A.resultDetail({ ...res, my_points: 5 }), '5 of 5 each · they answered earlier');
eq('detail other result', A.resultDetail({ ...res, result: 'booked_elsewhere' }), 'Your bid: 4 of 5 correct');
// ---- errors
eq('error prefix stripped', A.describeGrabError({ message: 'ESSENTIALS_DAILY_LIMIT: This client already has a session on 2 Oct.' }), 'This client already has a session on 2 Oct.');
eq('error PGRST202', A.describeGrabError({ code: 'PGRST202', message: 'Could not find the function public.submit_essentials_bid' }).startsWith('The auction is not set up on the server yet'), true);
eq('error network', A.describeGrabError({ message: 'Network request failed' }), 'Network problem. Check your connection and try again.');
eq('error timeout', A.describeGrabError({ message: 'Place my bid timed out' }).startsWith('The bid took too long'), true);
eq('error plain', A.describeGrabError({ message: 'You have already answered for this session. One attempt only.' }), 'You have already answered for this session. One attempt only.');
eq('error missing table', A.describeGrabError({ code: '42P01', message: 'relation "public.essentials_auction_log" does not exist' }).startsWith('The auction is not fully set up'), true);
eq('error lock timeout (code)', A.describeGrabError({ code: '55P03', message: 'canceling statement due to lock timeout' }).startsWith('Another trainer is booking'), true);
eq('error unique index', A.describeGrabError({ code: '23505', message: 'duplicate key value violates unique constraint "uniq_session_schedule_client_datetime_active"' }), 'Someone already booked this training.');
eq('error empty', A.describeGrabError({ message: '' }), 'Could not place this bid.');
eq('isTakenError', [A.isTakenError('Someone already booked this training.'), A.isTakenError('You have already answered for this session. One attempt only.'), A.isTakenError('This auction has been decided.'), A.isTakenError('The client is away on 2 Oct.')], [true, true, true, false]);
// ---- ETA (lot at 09:00 IST on 2 Oct; Hauz Khas vs Pitampura style distances)
const HK = { lat: 28.5494, lng: 77.2001 }, PIT = { lat: 28.7041, lng: 77.1325 }, NEAR = { lat: 28.5520, lng: 77.2050 };
const lotAt = '2026-10-02T03:30:00Z'; // 09:00 IST
const sess = (hhmmIST, loc, name, id) => ({ id, start: `2026-10-02T${hhmmIST}:00+05:30`, name, modality: 'Strength', loc, locText: null });
eq('approxTravel far', A.approxTravel(HK, PIT).min > 40, true);
eq('approxTravel near', A.approxTravel(HK, NEAR).min <= 5, true);
eq('eta: no sessions', A.computeLotEta(lotAt, HK, null, []), { loc: HK, locText: null, prev: null, next: null, tight: false });
let e = A.computeLotEta(lotAt, HK, 'Hauz Khas', [sess('07:00', NEAR, 'Riya', 'a'), sess('10:30', PIT, 'Karan', 'b'), sess('13:00', PIT, 'Far', 'c'), sess('05:30', PIT, 'Early', 'd')]);
eq('eta: prev is the 07:00 (within 3 h), 05:30 excluded', e.prev.session.id, 'a');
eq('eta: prev gap 60 min, near, ok', [e.prev.gapMin, e.prev.tight], [60, false]);
eq('eta: next is 10:30, gap 30 min, far drive, tight', [e.next.session.id, e.next.gapMin, e.next.tight, e.next.etaMin > 30], ['b', 30, true, true]);
eq('eta: tight overall', e.tight, true);
e = A.computeLotEta(lotAt, null, 'Pitampura', [sess('10:30', PIT, 'Karan', 'b')]);
eq('eta: no lot pin -> no drive, not tight, text kept', [e.loc, e.locText, e.next.etaMin, e.next.tight], [null, 'Pitampura', null, false]);
e = A.computeLotEta(lotAt, HK, null, [sess('09:30', NEAR, 'Overlap', 'o')]);
eq('eta: overlap without pins counts as tight', [e.next.gapMin, e.next.tight], [-30, true]);
eq('formatMinutes', [A.formatMinutes(25), A.formatMinutes(60), A.formatMinutes(70)], ['25 min', '1 hr', '1 hr 10 min']);
eq('geoFromBrb', [A.geoFromBrb({ lat: 28.5, lng: 77.2, method: 'x' }), A.geoFromBrb(null), A.geoFromBrb({ lat: 0, lng: 0 })], [{ lat: 28.5, lng: 77.2 }, null, null]);
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
```
`tests/rules/instant_win_test.js` (29 lines, 7 checks; its web half runs only when `WEB_AUCTION_LIB` points at
hub-track's `src/lib/essentialsAuction.ts`):
```js
// Rule test for the Odds staff app. ROOT = the repo root; point it at the iOS repo and run: node tests/rules/instant_win_test.js
const ROOT = require("path").resolve(__dirname, "../..");
// node test: the bid banner / result texts for the instant win (android + web libs) and the taken-error match.
const ts = require(ROOT + '/node_modules/typescript');
const fs = require('fs');
const load = (file) => {
  const src = fs.readFileSync(file, 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const m = { exports: {} };
  new Function('module', 'exports', 'require', js)(m, m.exports, (n) => { throw new Error('unexpected require ' + n); });
  return m.exports;
};
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };
const base = { client_id: 'c', client_name: 'Preeti Ch.', training_date: '2026-10-16', slot_time: '17:00', modality: 'Strength', points: 5, question_count: 5, correct: [true, true, true, true, true], submitted_at: '2026-10-15T11:40:00Z', bids_count: 1, instant_win: false, session_id: null, winner_name: null, instant_blocked: null };
for (const [label, file] of [['android', ROOT + '/src/lib/essentialsAuction.ts'], ['web', process.env.WEB_AUCTION_LIB || '']].filter(([, p]) => p && require('fs').existsSync(p))) { // web half runs only when WEB_AUCTION_LIB points at hub-track's src/lib/essentialsAuction.ts
  const L = load(file);
  eq(`${label} instant win banner`, L.bidBannerText({ ...base, instant_win: true, session_id: 's1', winner_name: 'Aditi' }, '5:30 PM'), "Perfect score! Preeti Ch.'s Strength on Fri 16 Oct at 5:00 PM is yours. It is on your roster.");
  eq(`${label} perfect but blocked`, L.bidBannerText({ ...base, instant_blocked: 'Aditi already has a session at 5:00 pm on 16 Oct.' }, '5:30 PM'), '5 of 5 correct, but the session could not be booked at once (Aditi already has a session at 5:00 pm on 16 Oct.). Decided at 5:30 PM.');
  eq(`${label} ordinary bid`, L.bidBannerText({ ...base, points: 3, correct: [true, true, true, false, false] }, '5:30 PM'), 'Bid placed for Preeti Ch.: 3 of 5 correct. Decided at 5:30 PM.');
  eq(`${label} old server (no flags) = ordinary`, L.bidBannerText({ ...base, instant_win: undefined, instant_blocked: undefined }, '5:30 PM'), 'Bid placed for Preeti Ch.: 5 of 5 correct. Decided at 5:30 PM.');
  if (L.isTakenError) {
    eq(`${label} 'Already won by' is a taken error`, L.isTakenError('Already won by Aditi Odds with a perfect score.'), true);
    eq(`${label} 'already booked' still taken`, L.isTakenError('This session is already booked.'), true);
    eq(`${label} other refusal not taken`, L.isTakenError('Answer all 5 questions.'), false);
  }
}
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
```

### 3.3 `src/lib/essentialsAuctionQueries.ts`, `useEssentialsAuction` (needed on iOS; NOT in Android, see the gap)
The lot mapping on Android today:
```ts
    queryFn: async (): Promise<AuctionLot[]> => {
      const { data, error } = await withTimeout(Promise.resolve(supabase.rpc('get_essentials_auction')) as Promise<RpcResult>, NET_MS, 'Auction');
      if (error) throw new Error(describeGrabError(error));
      return ((data ?? []) as any[]).map((r) => ({
        auction_date: r.auction_date,
        client_id: r.client_id,
        client_name: r.client_name ?? 'Client',
        modality: r.modality ?? '',
        slot_time: String(r.slot_time ?? '').slice(0, 5),
        scheduled_for: r.scheduled_for,
        status: (r.status ?? 'open') as AuctionLot['status'],
```
Add one line after `scheduled_for`. The line is the web's, word for word (hub-track
`src/hooks/useEssentialsAuction.ts` line 57):
```ts
    queryFn: async (): Promise<AuctionLot[]> => {
      const { data, error } = await withTimeout(Promise.resolve(supabase.rpc('get_essentials_auction')) as Promise<RpcResult>, NET_MS, 'Auction');
      if (error) throw new Error(describeGrabError(error));
      return ((data ?? []) as any[]).map((r) => ({
        auction_date: r.auction_date,
        client_id: r.client_id,
        client_name: r.client_name ?? 'Client',
        modality: r.modality ?? '',
        slot_time: String(r.slot_time ?? '').slice(0, 5),
        scheduled_for: r.scheduled_for,
        mode: r.mode ?? null, // home or virtual (23 Oct 2026, essentials_weeks)
        status: (r.status ?? 'open') as AuctionLot['status'],
```
The rest of the mapping (bids, winner, round result) is unchanged.

### 3.4 `src/screens/essentialsAuction.tsx`, `LotCard`: the pill
Before:
```tsx
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10 }}>
          <Serif style={{ fontSize: 34, lineHeight: 38, color: grabbed && !mine ? C.muted : '#fff' }}>{formatTime12(lot.slot_time)}</Serif>
          <View style={{ paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999, backgroundColor: hexA(col, 0.14), borderWidth: 1, borderColor: hexA(col, 0.4), marginBottom: 6 }}>
            <Text style={{ fontFamily: F.bodySemi, fontSize: 11.5, color: col }}>{lot.modality || 'Training'}</Text>
          </View>
        </View>
```
After (only the `<Text>` line changed):
```tsx
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10 }}>
          <Serif style={{ fontSize: 34, lineHeight: 38, color: grabbed && !mine ? C.muted : '#fff' }}>{formatTime12(lot.slot_time)}</Serif>
          <View style={{ paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999, backgroundColor: hexA(col, 0.14), borderWidth: 1, borderColor: hexA(col, 0.4), marginBottom: 6 }}>
            <Text style={{ fontFamily: F.bodySemi, fontSize: 11.5, color: col }}>{lot.modality || 'Training'}{lot.mode ? ` · ${lot.mode === 'virtual' ? 'virtual' : 'at home'}` : ''}</Text>
          </View>
        </View>
```

### 3.5 `src/screens/essentialsAuction.tsx`: the header comment (the plan source note; comment only)
Before:
```ts
/* ============ Essentials Auction (trainer sidebar page, 1 Oct 2026) ============
   Every Essentials by Odds client saves their own week in the client app
   (clients.weekly_protocol.slots). The day before each training the auction
   offers it to trainers. Since 10 Oct 2026 (hub-track migration 20261010120000)
```
After:
```ts
/* ============ Essentials Auction (trainer sidebar page, 1 Oct 2026) ============
   Every Essentials by Odds client saves their own week in the client app
   (public.essentials_weeks since 23 Oct 2026; weekly_protocol.slots before). The day before each training the auction
   offers it to trainers. Since 10 Oct 2026 (hub-track migration 20261010120000)
```

### 3.6 Checks
- `npx tsc --noEmit` exit 0.
- `node tests/rules/auction_rules_test.js` and `node tests/rules/instant_win_test.js` print ALL PASS.

## 4. Check on the iPhone
Use a trainer test account. The page lists tomorrow's sessions at any time of day; bidding is open 1:00 PM to 5:30
PM IST. Nothing in these steps places a bid.
1. Drawer > Essentials Auction. Expected: every card's pill reads "(modality) · at home" or "(modality) · virtual".
2. In SQL, tomorrow's planned days:
   `select w.client_id, d->>'time' as time, d->>'modality' as modality, d->>'mode' as mode from essentials_weeks w,
   jsonb_array_elements(w.days) d where (d->>'date')::date = (now() at time zone 'Asia/Kolkata')::date + 1;`
   Expected: each card of those clients shows "· virtual" where `mode` is `virtual` and "· at home" otherwise. (Some
   rows may have no card: rehab modalities, a client you trained today, no current pass or no trainings left.)
3. Open the same day on the web auction page (hub-track, trainer Essentials Auction). Expected: the same suffix on
   the same cards.
4. A client who never planned in the app (old weekly slots) shows "· at home" unless their slot says virtual.
5. Tap a card's photo and open its summaries strip (do not open Answer and bid unless you mean to bid). Expected:
   all as before; the pill does not wrap or push the time.
6. Optional, with a test Essentials client: before 12:30 PM IST, set tomorrow's day to virtual in the Essentials
   app. Within 20 s (the poll) the card reads "· virtual".

Not confirmed: on a phone. From the code, the Android card shows the modality alone because the hook drops `mode`;
this was not checked on a device, and the owner has not decided whether Android gets the 3.3 line too.
Not confirmed: how many of tomorrow's live lots are virtual (not queried for this handoff).
