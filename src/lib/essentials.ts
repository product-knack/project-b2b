/* Essentials (30-day pass) status, derived client-side from the two columns the
   web keeps as the single source of truth (30 Sep 2026 spec):
     clients.subscription_type = 'Essentials'   (checked first, like the trigger)
     clients.essentials_extensions jsonb[]      (newest entry = the current pass)
   Entry kinds: start | extension | vacation | vacation_end | cleared. Every entry
   carries the pass window as start_date / end_date (IST YYYY-MM-DD); vacation
   entries add vacation_start / vacation_end. Nothing here is written by the app.
   Leaf module (no app imports) so every query file can use it and node can test it. */

const istTodayYmd = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export type EssentialsPassEntry = {
  kind?: string;
  start_date?: string | null;
  end_date?: string | null;
  vacation_start?: string | null;
  vacation_end?: string | null;
  vacation_days?: number | null;
  vacation_reason?: string | null;
  saved_at?: string | null;
};

export type EssentialsStatus = {
  /** 'active' inside the window, 'expiring' with 0..3 days left, 'vacation' on a paused day, 'expired', 'upcoming' before start, 'unknown' when the history is empty. */
  state: 'active' | 'expiring' | 'vacation' | 'expired' | 'upcoming' | 'unknown';
  startDate: string | null;
  validTill: string | null;
  /** Whole days from today to the valid-till date (0 = last day today); null when unknown. */
  daysLeft: number | null;
  vacationStart: string | null;
  vacationEnd: string | null;
};

export const isEssentialsType = (subscription: string | null | undefined) =>
  String(subscription ?? '').trim().toLowerCase() === 'essentials';

export const currentPassFromHistory = (history: unknown): EssentialsPassEntry | null => {
  const arr = Array.isArray(history) ? history : [];
  for (let i = arr.length - 1; i >= 0; i--) {
    const e = arr[i];
    if (e && typeof e === 'object') return e as EssentialsPassEntry;
  }
  return null;
};

const DAY_MS = 864e5;
const isYmd = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const dayDiff = (to: string, from: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/** Returns null unless the client is on Essentials. `today` is an IST YYYY-MM-DD (defaults to now). */
export function computeEssentials(subscription: string | null | undefined, history: unknown, today: string = istTodayYmd()): EssentialsStatus | null {
  if (!isEssentialsType(subscription)) return null;
  const cur = currentPassFromHistory(history);
  const startDate = isYmd(cur?.start_date) ? cur!.start_date! : null;
  const validTill = isYmd(cur?.end_date) ? cur!.end_date! : null;
  const vacationStart = cur?.kind === 'vacation' && isYmd(cur.vacation_start) ? cur.vacation_start : null;
  const vacationEnd = cur?.kind === 'vacation' && isYmd(cur.vacation_end) ? cur.vacation_end : null;
  const base = { startDate, validTill, vacationStart, vacationEnd };
  if (!validTill) return { state: 'unknown', daysLeft: null, ...base };
  const daysLeft = dayDiff(validTill, today);
  if (vacationStart && vacationEnd && today >= vacationStart && today <= vacationEnd) return { state: 'vacation', daysLeft, ...base };
  if (startDate && today < startDate) return { state: 'upcoming', daysLeft, ...base };
  if (daysLeft < 0) return { state: 'expired', daysLeft, ...base };
  if (daysLeft <= 3) return { state: 'expiring', daysLeft, ...base };
  return { state: 'active', daysLeft, ...base };
}

/** "29 Oct" from an IST YYYY-MM-DD. */
export const essentialsDate = (ymd: string | null) => {
  if (!ymd) return '';
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short' });
};
