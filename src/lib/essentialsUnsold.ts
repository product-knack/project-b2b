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
