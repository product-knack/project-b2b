/* Managers Leaderboard competition months (2 Nov 2026). The month tabs were fixed at three (month1..month3 carved
   from team_start); the competition running since 1 Aug 2026 lasts six months (to 31 Jan 2027), so November and the
   months after it had no tab. The tabs now follow the period: one per month from team_start to team_end (an ongoing
   period with no end: to the current month). Same rule as the web hook useManagerLeaderboard.ts; fix together.
   Pure: no React, no network; tested in node (tests/rules/manager_months_test.js); copied byte for byte to iOS. */

export type MgrMonthFilter = 'overall' | `month${number}`;
export const MAX_COMPETITION_MONTHS = 12;

const fmtDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const firstOf = (iso: string) => { const d = new Date(iso + 'T00:00:00'); return new Date(d.getFullYear(), d.getMonth(), 1); };

/** 'month3' → 2 (0-based competition month); 'overall' or anything else → null. */
export const monthIndexOf = (filter: string | null | undefined): number | null => {
  const m = String(filter ?? '').match(/^month(\d{1,2})$/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= MAX_COMPETITION_MONTHS ? n - 1 : null;
};
export const monthFilterOf = (index: number): MgrMonthFilter => `month${index + 1}` as MgrMonthFilter;

/** How many calendar months the competition spans: team_start to team_end inclusive; with no end, to today's month
    (at least 1, at most MAX_COMPETITION_MONTHS). */
export const competitionMonthCount = (periodStart: string, periodEnd: string | null, todayIso: string = fmtDay(new Date())): number => {
  const s = firstOf(periodStart);
  const e = firstOf(periodEnd ?? todayIso);
  const n = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()) + 1;
  return Math.max(1, Math.min(MAX_COMPETITION_MONTHS, n));
};

/** Fixed names: the runtime's en-GB short month is "Sept" on some engines and "Sep" on others. */
export const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Aug", "Sep", ... ; a month in a later year than the start carries the year: "Jan 27". */
export const competitionMonthLabels = (periodStart: string, periodEnd: string | null, todayIso?: string): string[] => {
  const s = firstOf(periodStart);
  const n = competitionMonthCount(periodStart, periodEnd, todayIso);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(s.getFullYear(), s.getMonth() + i, 1);
    const label = MONTH_SHORT[d.getMonth()];
    return d.getFullYear() === s.getFullYear() ? label : `${label} ${String(d.getFullYear()).slice(-2)}`;
  });
};

/** The date range the counts RPC gets: the whole period for 'overall', else that competition month clipped to the
    period (unchanged maths from the three-tab version, the offset now comes from the filter's number). */
export const competitionMonthRange = (periodStart: string, periodEnd: string | null, filter: MgrMonthFilter | string): { start: string; end: string | null } => {
  const idx = monthIndexOf(filter);
  if (idx == null) return { start: periodStart, end: periodEnd };
  const s = firstOf(periodStart);
  const rangeStart = new Date(s.getFullYear(), s.getMonth() + idx, 1);
  const rangeEnd = new Date(rangeStart.getFullYear(), rangeStart.getMonth() + 1, 0);
  const startStr = fmtDay(rangeStart);
  let endStr = fmtDay(rangeEnd);
  if (periodEnd && endStr > periodEnd) endStr = periodEnd;
  if (startStr < periodStart) return { start: periodStart, end: endStr };
  return { start: startStr, end: endStr };
};

/** A stored tab that no longer exists for this period (shorter competition, or a cache from another one) falls back
    to 'overall'. */
export const effectiveMonthFilter = (stored: string | null | undefined, monthCount: number): MgrMonthFilter => {
  const idx = monthIndexOf(stored);
  return idx != null && idx < monthCount ? (stored as MgrMonthFilter) : 'overall';
};
