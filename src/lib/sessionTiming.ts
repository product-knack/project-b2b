/* Session timer (13 Oct 2026, owner: "when a trainer, physio or therapist taps Add
   Workout from Today's Roster, the missing-health-data sheet opens; when they save
   it to start logging, a timer starts in the background; when they log the session,
   save the detail (duration, start, end, date) on the training_sessions row").
   Backend: training_sessions.session_timing jsonb (hub-track migration
   20261013100000) and therapist_log_session(..., p_timing) (20261013110000).

   The start lives in AsyncStorage under session-timer:<clientId>:<IST day>, so a
   backgrounded or killed app still knows when the session started, and backing
   out of the form and returning keeps the same start. The json is built at
   submit time and travels with the outbox payload; nothing recomputes it later. */
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

export type TimerGate = 'saved' | 'skipped';

export type SessionTiming = {
  started_at: string;        // ISO UTC: the health check-in Save, or the form entry when no sheet was needed
  ended_at: string;          // ISO UTC: the log submit
  date: string;              // IST yyyy-MM-dd of started_at
  duration_minutes: number;  // Math.max(1, Math.round((ended - started) / 60000))
  source: 'android' | 'ios';
  role: string;              // profile.role: trainer | doctor | therapist
  schedule_id: string | null;
  app_version: string | null;
  gate: TimerGate;
};

/** What the storage holds between the start and the submit. */
export type TimerStart = { started_at: string; schedule_id: string | null; gate: TimerGate };

export const TIMER_PREFIX = 'session-timer:';
export const TIMER_KEY = (clientId: string, istDay: string) => `${TIMER_PREFIX}${clientId}:${istDay}`;

/** A start before midnight is still found the next morning for this long (late sessions). */
export const CROSS_MIDNIGHT_MS = 12 * 60 * 60 * 1000;

const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
export const istDayOf = (iso: string | number | Date): string => dayFmt.format(new Date(iso));

/** At least 1 minute, rounded to the nearest minute. */
export const durationMinutes = (startedIso: string, endedIso: string): number =>
  Math.max(1, Math.round((Date.parse(endedIso) - Date.parse(startedIso)) / 60000));

/** "5.0 (32)" from the native config; null when unknown. */
export const appVersionLabel = (): string | null => {
  const cfg: any = (Constants as any)?.expoConfig ?? {};
  const v = cfg.version;
  if (!v) return null;
  const build = Platform.OS === 'ios' ? cfg.ios?.buildNumber : cfg.android?.versionCode;
  return build != null && build !== '' ? `${v} (${build})` : String(v);
};

/** The json exactly as the column stores it. Pure: everything comes in as arguments. */
export const buildTiming = (
  start: TimerStart,
  endedIso: string,
  role: string,
  opts?: { source?: 'android' | 'ios'; appVersion?: string | null },
): SessionTiming => ({
  started_at: start.started_at,
  ended_at: endedIso,
  date: istDayOf(start.started_at),
  duration_minutes: durationMinutes(start.started_at, endedIso),
  source: opts?.source ?? (Platform.OS === 'ios' ? 'ios' : 'android'),
  role,
  schedule_id: start.schedule_id ?? null,
  app_version: opts && 'appVersion' in opts ? (opts.appVersion ?? null) : appVersionLabel(),
  gate: start.gate,
});

const parseStart = (raw: string | null): TimerStart | null => {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    if (!o || typeof o.started_at !== 'string' || !isFinite(Date.parse(o.started_at))) return null;
    return { started_at: o.started_at, schedule_id: typeof o.schedule_id === 'string' ? o.schedule_id : null, gate: o.gate === 'saved' ? 'saved' : 'skipped' };
  } catch { return null; }
};

const dayBefore = (istDay: string): string => {
  const d = new Date(`${istDay}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

/** Drop this client's keys from other days (a start that was never submitted). Best effort. */
async function sweepOtherDays(clientId: string, keepDays: string[]): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const mine = `${TIMER_PREFIX}${clientId}:`;
    const stale = keys.filter((k) => k.startsWith(mine) && !keepDays.some((d) => k === TIMER_KEY(clientId, d)));
    if (stale.length) await AsyncStorage.multiRemove(stale);
  } catch { /* storage unavailable: nothing to sweep */ }
}

/** Start the timer for a client. An existing start for the same client and IST day is
    kept (backing out and returning never restarts it). `startedAt` lets the partner
    leg share the first leg's start. Returns the entry in force. */
export async function startTimer(clientId: string, scheduleId: string | null, gate: TimerGate, startedAt?: string, nowIso: string = new Date().toISOString()): Promise<TimerStart> {
  const at = startedAt && isFinite(Date.parse(startedAt)) ? startedAt : nowIso;
  const day = istDayOf(at);
  const key = TIMER_KEY(clientId, day);
  const existing = parseStart(await AsyncStorage.getItem(key).catch(() => null));
  if (existing) return existing;
  const entry: TimerStart = { started_at: at, schedule_id: scheduleId ?? null, gate };
  await AsyncStorage.setItem(key, JSON.stringify(entry)).catch(() => {});
  void sweepOtherDays(clientId, [day, dayBefore(day)]);
  return entry;
}

/** Today's start, else yesterday's when it began within the last 12 hours (a session
    across IST midnight), else null. */
export async function readTimer(clientId: string, nowIso: string = new Date().toISOString()): Promise<{ start: TimerStart; key: string } | null> {
  const today = istDayOf(nowIso);
  const todayKey = TIMER_KEY(clientId, today);
  const t = parseStart(await AsyncStorage.getItem(todayKey).catch(() => null));
  if (t) return { start: t, key: todayKey };
  const yKey = TIMER_KEY(clientId, dayBefore(today));
  const y = parseStart(await AsyncStorage.getItem(yKey).catch(() => null));
  if (y && Date.parse(nowIso) - Date.parse(y.started_at) <= CROSS_MIDNIGHT_MS) return { start: y, key: yKey };
  return null;
}

/** Build the json at submit time (ended_at = now). Does NOT clear the start: the
    caller clears it once the log is synced or queued. Null when no timer exists. */
export async function finishTimer(clientId: string, role: string, nowIso: string = new Date().toISOString()): Promise<{ timing: SessionTiming; minutes: number } | null> {
  const found = await readTimer(clientId, nowIso);
  if (!found) return null;
  const timing = buildTiming(found.start, nowIso, role);
  return { timing, minutes: timing.duration_minutes };
}

/* ---------- The visible clock (22 Oct 2026) ----------
   Owner: "show the timer clock when we log a session; the trainer should see the timer we save in duration".
   The Add Workout form shows the running time since the stored start and the minutes a submit now would save
   (the same durationMinutes rule as the json, so the number shown is the number written). Pure: the form passes
   the clock's now. */
const p2 = (n: number) => String(n).padStart(2, '0');

/** "0:42", "12:34", "1:02:05": the time since the start. A start in the future (device clock moved) reads 0:00. */
export const elapsedClock = (startedIso: string, nowMs: number): string => {
  const t = Date.parse(startedIso);
  const s = isFinite(t) ? Math.max(0, Math.floor((nowMs - t) / 1000)) : 0;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0 ? `${h}:${p2(m)}:${p2(sec)}` : `${m}:${p2(sec)}`;
};

/** The minutes a submit at `nowMs` would save as duration_minutes (at least 1). */
export const minutesIfSubmitted = (startedIso: string, nowMs: number): number =>
  isFinite(Date.parse(startedIso)) ? durationMinutes(startedIso, new Date(Math.max(nowMs, Date.parse(startedIso))).toISOString()) : 1;

const clockFmt = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true });
/** "3:05 pm" in IST; '' when unparsable. */
export const clockOf = (iso: string | null | undefined): string => {
  const t = iso ? Date.parse(iso) : NaN;
  return isFinite(t) ? clockFmt.format(new Date(t)).replace(/\s?(am|pm)$/i, (x) => ` ${x.trim().toLowerCase()}`) : '';
};

/** "1 min", "57 min", "1 h 5 min". */
export const minutesText = (min: number): string =>
  min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`;

/** Remove the client's start (today's and yesterday's keys). */
export async function clearTimer(clientId: string, nowIso: string = new Date().toISOString()): Promise<void> {
  const today = istDayOf(nowIso);
  await AsyncStorage.multiRemove([TIMER_KEY(clientId, today), TIMER_KEY(clientId, dayBefore(today))]).catch(() => {});
}
