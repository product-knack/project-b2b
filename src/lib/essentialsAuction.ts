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
