/* Latest health data with its date (22 Oct 2026, Android only).
   Owner: "in Today's Roster, after the two Play buttons, show recovery with date and the sleep, nutrition, steps
   etc; the log popup also shows recovery with a date label". Approved reading: WHOOP recovery, the latest entry of
   each item with the date it belongs to. Nothing on the server changes and nothing is written.

   Sources (the same tables the workout health check-in reads and writes):
   - Recovery: daily_health_metrics.recovery_score (WHOOP, 0 to 100 %), dated by metric_date (the wake day).
   - Sleep: the newer of daily_health_metrics.sleep_duration_minutes (wearable, metric_date) and
     daily_sleep_logs.hours_slept (logged, log_date). On the same day the wearable wins, as in the check-in gate.
   - Nutrition: nutrition_tracker.nutrition_rating (1 to 10), dated by rating_date.
   - Steps: the newer of daily_health_metrics.steps_count and nutrition_tracker.steps_by_trainer. Wearable first on
     the same day, as in the Trends daily list.
   - Hydration: nutrition_tracker.hydration_inputs (litres), dated by rating_date.
   The check-in stores what the trainer enters ("last night", "yesterday") on the WORKOUT day (24 Sep 2026 rule), so
   the date shown is the stored date, never shifted. Pure functions only: the node test in tests/rules runs them. */

export type DatedValue = { value: number; date: string };

export type LatestDaily = {
  recovery: DatedValue | null;
  /** hours */
  sleep: DatedValue | null;
  /** 1 to 10 */
  nutrition: DatedValue | null;
  steps: DatedValue | null;
  /** litres */
  hydration: DatedValue | null;
  /** false until nutrition_tracker.hydration_inputs is live (then the row is left out) */
  hydrationSupported: boolean;
};

type Row = Record<string, unknown> | null | undefined;

const YMD = /^\d{4}-\d{2}-\d{2}/;
const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** One row into { value, date }; null when the value or the date is missing. `scale` turns minutes into hours. */
export const datedOf = (row: Row, dateKey: string, valueKey: string, scale = 1): DatedValue | null => {
  if (!row) return null;
  const v = num(row[valueKey]);
  const d = String(row[dateKey] ?? '');
  if (v == null || !YMD.test(d)) return null;
  return { value: v * scale, date: d.slice(0, 10) };
};

/** The newer of two; on the same day the FIRST one wins (pass the wearable first). */
export const newerOf = (a: DatedValue | null, b: DatedValue | null): DatedValue | null =>
  !a ? b : !b ? a : b.date > a.date ? b : a;

export type LatestRows = {
  recovery?: Row;
  wearSleep?: Row;
  wearSteps?: Row;
  logSleep?: Row;
  nutRating?: Row;
  nutSteps?: Row;
  nutHydration?: Row;
  hydrationSupported?: boolean;
};

/** The newest row of each kind (each query is "not null, newest first, limit 1") into the five items. */
export const pickLatestDaily = (r: LatestRows): LatestDaily => ({
  recovery: datedOf(r.recovery, 'metric_date', 'recovery_score'),
  sleep: newerOf(datedOf(r.wearSleep, 'metric_date', 'sleep_duration_minutes', 1 / 60), datedOf(r.logSleep, 'log_date', 'hours_slept')),
  nutrition: datedOf(r.nutRating, 'rating_date', 'nutrition_rating'),
  steps: newerOf(datedOf(r.wearSteps, 'metric_date', 'steps_count'), datedOf(r.nutSteps, 'rating_date', 'steps_by_trainer')),
  hydration: r.hydrationSupported === false ? null : datedOf(r.nutHydration, 'rating_date', 'hydration_inputs'),
  hydrationSupported: r.hydrationSupported !== false,
});

/* ---------- dates ---------- */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const utcOf = (ymd: string) => Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10)));

/** Whole days from `ymd` to `todayYmd` (0 = today, 1 = yesterday; negative = a future date). */
export const daysBetween = (ymd: string, todayYmd: string): number => Math.round((utcOf(todayYmd) - utcOf(ymd)) / 864e5);

/** "22 Oct"; the year is added when it is not the current year ("7 Sep 2025"). */
export const dayMonth = (ymd: string, todayYmd?: string): string => {
  if (!YMD.test(ymd)) return '';
  const d = Number(ymd.slice(8, 10)), m = MONTHS[Number(ymd.slice(5, 7)) - 1] ?? '';
  const sameYear = !todayYmd || ymd.slice(0, 4) === todayYmd.slice(0, 4);
  return sameYear ? `${d} ${m}` : `${d} ${m} ${ymd.slice(0, 4)}`;
};

/** "today", "yesterday", "5 days ago". */
export const agoText = (ymd: string, todayYmd: string): string => {
  const n = daysBetween(ymd, todayYmd);
  if (n <= 0) return 'today';
  if (n === 1) return 'yesterday';
  return `${n} days ago`;
};

/** "22 Oct · today", "7 Sep · 45 days ago". */
export const datedLabel = (ymd: string, todayYmd: string): string => `${dayMonth(ymd, todayYmd)} · ${agoText(ymd, todayYmd)}`;

/** Older than this many days reads as old (muted, amber date) so a trainer never takes it for today's. */
export const STALE_AFTER_DAYS = 2;
export const isStale = (ymd: string, todayYmd: string): boolean => daysBetween(ymd, todayYmd) > STALE_AFTER_DAYS;

/** The day before `todayYmd` (YYYY-MM-DD). */
export const dayBefore = (todayYmd: string): string => {
  const t = new Date(utcOf(todayYmd) - 864e5);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`;
};

/* ---------- values ---------- */
/** WHOOP zones: 67 to 100 green, 34 to 66 yellow, 0 to 33 red. */
export type RecoveryZone = 'green' | 'yellow' | 'red';
export const recoveryZone = (score: number): RecoveryZone => (score >= 67 ? 'green' : score >= 34 ? 'yellow' : 'red');

const round1 = (n: number) => Math.round(n * 10) / 10;
const groupThousands = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export type LatestKey = 'recovery' | 'sleep' | 'nutrition' | 'steps' | 'hydration';
export const LATEST_LABELS: Record<LatestKey, string> = {
  recovery: 'WHOOP recovery', sleep: 'Sleep', nutrition: 'Nutrition', steps: 'Steps', hydration: 'Hydration',
};
const NONE_TEXT: Record<LatestKey, string> = {
  recovery: 'No WHOOP data', sleep: 'Not logged', nutrition: 'Not logged', steps: 'Not logged', hydration: 'Not logged',
};

export const valueText = (key: LatestKey, value: number): string => {
  switch (key) {
    case 'recovery': return `${Math.round(value)}%`;
    case 'sleep': return `${round1(value)} h`;
    case 'nutrition': return `${round1(value)}/10`;
    case 'steps': return groupThousands(value);
    case 'hydration': return `${round1(value)} L`;
  }
};

export type LatestLine = {
  key: LatestKey;
  label: string;
  /** "48%", or the "No WHOOP data" / "Not logged" text */
  text: string;
  has: boolean;
  /** "22 Oct · today"; '' when nothing is logged */
  date: string;
  stale: boolean;
  /** recovery only */
  zone: RecoveryZone | null;
};

/** The rows the roster strip shows, in order. Hydration is left out until its column is live. */
export const latestLines = (l: LatestDaily, todayYmd: string): LatestLine[] => {
  const keys: LatestKey[] = ['recovery', 'sleep', 'nutrition', 'steps', ...(l.hydrationSupported ? (['hydration'] as LatestKey[]) : [])];
  return keys.map((key) => {
    const v = l[key];
    return {
      key,
      label: LATEST_LABELS[key],
      text: v ? valueText(key, v.value) : NONE_TEXT[key],
      has: !!v,
      date: v ? datedLabel(v.date, todayYmd) : '',
      stale: v ? isStale(v.date, todayYmd) : false,
      zone: key === 'recovery' && v ? recoveryZone(v.value) : null,
    };
  });
};
