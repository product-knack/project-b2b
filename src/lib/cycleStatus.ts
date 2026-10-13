/* ============ Menstrual cycle status (trainer label, 25 Sep 2026) ============
   Pure port of the client app's rule (the spec the user pasted, section 3).
   Input: the client's period logs (start / end, any order) and today's IST
   calendar date, both 'YYYY-MM-DD'. No stored phase exists anywhere; it is
   worked out from the logs every time. Data comes from the definer RPC
   get_clients_cycle_status (see cycleQueries.ts). No React in this file so it
   can be tested with plain node.

   Steps:
   1. Cycle lengths = days between consecutive start dates, kept only when
      1..59 (a gap of 60+ means she missed logging).
   2. L = weighted average of those, newest cycle heaviest (weights n..1),
      rounded; 28 when none is counted.
   3. P = plain average of (end - start + 1) for periods of 1..14 days,
      rounded; 5 when none.
   4. Cycle day = today - last start + 1 (her last period's first day = day 1).
   5. State: paused when cycle day > 60; late when cycle day - L > 7 (late by
      cycle day - L); else tracking.
   6. Phase: ovulation day = L - 14, window max(ov - 1, P + 1) .. ov + 2;
      menstrual 1..P, follicular up to the window, ovulation the window,
      luteal after it (days past L, not yet late, stay luteal: period due).
   7. Latest period correction: no end date = menstrual up to day
      min(10, max(7, P + 2)), then step 6 with an "end date not logged" flag;
      end date logged = menstrual through that day, and a step-6 "menstrual"
      after it reads follicular.
   8. Next period = last start + L, +/- one standard deviation of the counted
      cycles (at least 1 day; 3 when fewer than 2 cycles). Confidence high
      when sd <= 3, medium <= 5, low above; fewer than 3 cycles = always low,
      shown as an estimate ("around"). Only while tracking.
   The client app counts from midnight UTC, so before 05:30 IST it can show
   one day less than this calendar count. */

export type PeriodLog = { start_date: string; end_date: string | null };
export type FeelLog = { date: string; energy_level: number | null; symptoms: string[] | null };
export type CyclePhase = 'menstrual' | 'follicular' | 'ovulation' | 'luteal';
export type CycleState = 'tracking' | 'late' | 'paused';
export type CycleConfidence = 'high' | 'medium' | 'low';

export type CycleStatus = {
  state: CycleState;
  /** null when late or paused */
  phase: CyclePhase | null;
  cycleDay: number;
  /** late only: cycle day - L */
  lateBy: number | null;
  /** tracking and past day L (up to 7 days): still luteal, period due */
  periodDue: boolean;
  /** latest period has no end date and she is past the assumed bleed days */
  endDateMissing: boolean;
  avgCycle: number;
  avgPeriod: number;
  countedCycles: number;
  lastStart: string;
  /** tracking only */
  nextPeriod: { date: string; plusMinus: number; confidence: CycleConfidence; estimate: boolean } | null;
};

const YMD = /^(\d{4})-(\d{2})-(\d{2})/;
/** Days since the epoch for a plain calendar date (no timezone shifting). */
export const dayNum = (ymd: string): number => {
  const m = YMD.exec(ymd || '');
  if (!m) return NaN;
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000);
};
export const ymdOf = (n: number): string => new Date(n * 86_400_000).toISOString().slice(0, 10);

export function computeCycleStatus(periods: PeriodLog[], today: string): CycleStatus | null {
  const t = dayNum(today);
  if (!Number.isFinite(t)) return null;
  // Valid, not in the future, one row per start date, newest first.
  const seen = new Set<number>();
  const rows = (periods ?? [])
    .map((p) => ({ s: dayNum(p?.start_date), e: p?.end_date ? dayNum(p.end_date) : NaN }))
    .filter((p) => Number.isFinite(p.s) && p.s <= t)
    .sort((a, b) => b.s - a.s)
    .filter((p) => (seen.has(p.s) ? false : (seen.add(p.s), true)));
  if (!rows.length) return null;

  // 1-2. Counted cycle lengths (newest first) and the weighted average L.
  const gaps: number[] = [];
  for (let i = 0; i < rows.length - 1; i++) {
    const g = rows[i].s - rows[i + 1].s;
    if (g >= 1 && g <= 59) gaps.push(g);
  }
  let L = 28;
  if (gaps.length) {
    const n = gaps.length;
    let num = 0, den = 0;
    gaps.forEach((g, i) => { const w = n - i; num += g * w; den += w; });
    L = Math.round(num / den);
  }

  // 3. Average period length P.
  const lens = rows
    .filter((p) => Number.isFinite(p.e))
    .map((p) => p.e - p.s + 1)
    .filter((d) => d >= 1 && d <= 14);
  const P = lens.length ? Math.round(lens.reduce((a, b) => a + b, 0) / lens.length) : 5;

  // 4. Cycle day.
  const last = rows[0];
  const cycleDay = t - last.s + 1;

  const base = { cycleDay, avgCycle: L, avgPeriod: P, countedCycles: gaps.length, lastStart: ymdOf(last.s) };

  // 5. State.
  if (cycleDay > 60) {
    return { ...base, state: 'paused', phase: null, lateBy: null, periodDue: false, endDateMissing: false, nextPeriod: null };
  }
  if (cycleDay - L > 7) {
    return { ...base, state: 'late', phase: null, lateBy: cycleDay - L, periodDue: false, endDateMissing: false, nextPeriod: null };
  }

  // 6. Phase from the averages.
  const ov = L - 14;
  const winStart = Math.max(ov - 1, P + 1);
  const winEnd = ov + 2;
  let phase: CyclePhase =
    cycleDay <= P ? 'menstrual'
      : cycleDay < winStart ? 'follicular'
        : cycleDay <= winEnd ? 'ovulation'
          : 'luteal';

  // 7. What she logged about her latest period wins.
  let endDateMissing = false;
  const endDay = Number.isFinite(last.e) ? last.e - last.s + 1 : NaN;
  if (!Number.isFinite(endDay) || endDay < 1) {
    const cap = Math.min(10, Math.max(7, P + 2));
    if (cycleDay <= cap) phase = 'menstrual';
    else endDateMissing = true;
  } else if (cycleDay <= endDay) {
    phase = 'menstrual';
  } else if (phase === 'menstrual') {
    phase = 'follicular';
  }

  // 8. Next period.
  let sd = 3;
  if (gaps.length >= 2) {
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    sd = Math.sqrt(gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length);
  }
  const plusMinus = Math.max(1, Math.round(sd));
  const estimate = gaps.length < 3;
  const confidence: CycleConfidence = estimate ? 'low' : sd <= 3 ? 'high' : sd <= 5 ? 'medium' : 'low';

  return {
    ...base,
    state: 'tracking',
    phase,
    lateBy: null,
    periodDue: phase === 'luteal' && cycleDay > L,
    endDateMissing,
    nextPeriod: { date: ymdOf(last.s + L), plusMinus, confidence, estimate },
  };
}

/* ---------- labels ---------- */
// "Luteal" alone reads as jargon on a card, so the phases carry the word "phase"
// (user request 25 Sep 2026); the period itself stays plain.
export const PHASE_LABEL: Record<CyclePhase, string> = {
  menstrual: 'On her period',
  follicular: 'Follicular phase',
  ovulation: 'Ovulation phase',
  luteal: 'Luteal phase',
};

/** Card status line: "Luteal phase, day 22", "On her period, day 2", "Period late, 9 days", "Not tracking recently". */
export function cycleStatusLine(s: CycleStatus): string {
  if (s.state === 'paused') return 'Not tracking recently';
  if (s.state === 'late') return `Period late, ${s.lateBy} day${s.lateBy === 1 ? '' : 's'}`;
  const base = `${PHASE_LABEL[s.phase as CyclePhase]}, day ${s.cycleDay}`;
  return s.periodDue ? `${base}, period due` : base;
}

/** Short chip text: "PERIOD · D2", "LUTEAL PHASE · D22", "LATE · 9D", "CYCLE · NOT TRACKING". */
export function cycleChipText(s: CycleStatus): string {
  if (s.state === 'paused') return 'CYCLE · NOT TRACKING';
  if (s.state === 'late') return `LATE · ${s.lateBy}D`;
  const p = s.phase === 'menstrual' ? 'PERIOD' : `${(s.phase as string).toUpperCase()} PHASE`;
  return `${p} · D${s.cycleDay}`;
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Tue, 7 Oct" for a plain date. */
export function fmtCycleDate(ymd: string): string {
  const n = dayNum(ymd);
  if (!Number.isFinite(n)) return ymd;
  const d = new Date(n * 86_400_000);
  return `${DOW[d.getUTCDay()]}, ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
}

/** "Tue, 7 Oct ± 2 days · high confidence" or "Around Tue, 7 Oct (estimate)". */
export function nextPeriodLine(s: CycleStatus): string | null {
  const np = s.nextPeriod;
  if (!np) return null;
  if (np.estimate) return `Around ${fmtCycleDate(np.date)} (estimate)`;
  return `${fmtCycleDate(np.date)} ± ${np.plusMinus} day${np.plusMinus === 1 ? '' : 's'} · ${np.confidence} confidence`;
}

/* ---------- "How I feel" (last 3 days) ---------- */
const KEY_SYMPTOMS: Record<string, string> = {
  cramps: 'Cramps', fatigue: 'Fatigue', back_pain: 'Back pain', headache: 'Headache', bloating: 'Bloating',
};
export const symptomLabel = (id: string): string => {
  const k = String(id || '').trim().toLowerCase();
  if (KEY_SYMPTOMS[k]) return KEY_SYMPTOMS[k];
  const s = k.replace(/[_-]+/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : '';
};
export type FeelDay = { date: string; energy: number | null; symptoms: string[] };
/** One entry per logged day, newest first; key symptoms (cramps, fatigue, back pain, headache, bloating) listed first. */
export function summariseFeel(feel: FeelLog[], today: string): FeelDay[] {
  const t = dayNum(today);
  const order = Object.keys(KEY_SYMPTOMS);
  return (feel ?? [])
    .filter((f) => { const n = dayNum(f?.date); return Number.isFinite(n) && n <= t && n >= t - 2; })
    .sort((a, b) => dayNum(b.date) - dayNum(a.date))
    .map((f) => {
      const ids = [...new Set((Array.isArray(f.symptoms) ? f.symptoms : []).map((x) => String(x).trim().toLowerCase()).filter(Boolean))];
      ids.sort((a, b) => {
        const ia = order.indexOf(a), ib = order.indexOf(b);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      });
      const e = Number(f.energy_level);
      return { date: f.date.slice(0, 10), energy: Number.isFinite(e) && e >= 1 && e <= 5 ? e : null, symptoms: ids.map(symptomLabel).filter(Boolean) };
    });
}
/** "Today" / "Yesterday" / "Tue, 23 Sep". */
export function feelDayLabel(ymd: string, today: string): string {
  const diff = dayNum(today) - dayNum(ymd);
  return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : fmtCycleDate(ymd);
}

/* ---------- training guidance (the client app's own advice) ---------- */
export const CYCLE_GUIDANCE: Record<CyclePhase | 'late' | 'paused', string[]> = {
  menstrual: [
    'Strength is mostly kept; days 1 and 2 are usually the hardest.',
    'Offer lighter options: mobility, technique, moderate strength or a walk. Gentle movement can ease cramps.',
    'Never force intensity. A heavy flow can mean more fatigue.',
  ],
  follicular: [
    'Energy and recovery are rising.',
    'Best window for progressive overload, higher intensity, new skills and PR attempts.',
  ],
  ovulation: [
    'Often her peak strength and power: max efforts and HIIT are fine.',
    'Warm up well and keep landing and change-of-direction technique tight.',
  ],
  luteal: [
    'Effort feels harder, and sleep and recovery often dip, especially in the last 5 to 7 days.',
    'Go for moderate intensity; favour technique and volume over max loads.',
    'Use longer warm-ups and keep her hydrated. Do not chase PRs late in this phase.',
  ],
  late: [
    'Coach as late luteal: moderate intensity, technique and volume over max loads, longer warm-ups, hydration.',
    'Do not speculate about why.',
  ],
  paused: [
    'She has not logged a period recently, so there is no phase. Plan from how she feels on the day.',
  ],
};
export const CYCLE_ALWAYS =
  'How she feels and recovers today wins over the phase; the phase is only an estimate from her logged dates. Adjust training quietly and do not bring up her period unless she does.';

export function cycleGuidance(s: CycleStatus): string[] {
  if (s.state === 'paused') return CYCLE_GUIDANCE.paused;
  if (s.state === 'late') return CYCLE_GUIDANCE.late;
  return CYCLE_GUIDANCE[s.phase as CyclePhase];
}
