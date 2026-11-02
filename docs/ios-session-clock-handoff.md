# iOS handoff: Session timer clock in the Add Workout form (Android since 22 Oct 2026)

Android commit acfedfb (22 Oct 2026, build 5.1 (40)). Owner: "show the timer clock when we log a session; the
trainer should see the timer we save in duration". The session timer itself (13 Oct 2026: the start at the health
check-in Save or at the form entry, the `training_sessions.session_timing` json, the outbox field, step 2b of
`submitWorkoutLog`, the therapist and physio sheets) was handed off in `ios-8-to-16oct-handoff.md`, section B2. It
ran silently. This file covers only what 22 Oct added: a visible clock in the Add Workout form's sticky Submit bar,
the `timerStart` / `savedTiming` state that feeds it, and the stored minutes when a queued log is edited.
No server change: the column is live since 13 Oct 2026 (hub-track migration `20261013100000`); start points, the
json, the outbox and the server are unchanged. If the iOS repo has no `src/lib/sessionTiming.ts` with `startTimer`,
`readTimer`, `finishTimer` and `clearTimer`, port B2 first.

## 1. What the user sees (Android)
- **Where**: Add Workout (Today's Roster → Log Workout, a client page, or Home → Waiting to Sync → Edit). One row at
  the top of the sticky Submit bar, above the hint line and the Cancel / Submit Workout buttons. It stays on screen
  while the form scrolls.
- **Running** (from the timer's start until Submit):
  - a small teal dot (`#2DD4BF`) that blinks once a second;
  - "SESSION TIMER" in teal, and under it, grey, one line (cut with "…" when too long):
    "FROM 3:05 PM · SAVES 13 MIN";
  - on the right, the live clock in white: "0:42", "12:34", "1:02:05" past an hour. It ticks every second and
    catches up at once when the app returns from the background.
  - SAVES is exactly what a submit at that second writes to `duration_minutes`: rounded to the nearest minute, at
    least 1. Under a minute it reads "SAVES 1 MIN"; at 12:29 "SAVES 12 MIN"; at 12:34 "SAVES 13 MIN"; at 65 minutes
    "SAVES 1 H 5 MIN".
- **Saved** (once Submit captured the timing): a green row with a clock icon, "SESSION TIME · SAVED AS DURATION",
  under it "3:05 PM TO 4:02 PM", and on the right "57 min" ("1 h 5 min" past an hour). It no longer ticks.
  - It shows while the button reads "Synced to server ✓" or "Saved on device ✓ syncs later" (the form then leaves
    after 700 / 900 ms), and also after a server rejection (the log stays queued with this timing).
  - Editing a queued log (Home → Waiting to Sync → Edit) shows the same green row with the minutes stored in that
    item. Nothing shows when the item has no timing (queued by a build without the timer).
- **Hidden**: while the health check-in is still required (the form is locked; the timer starts at the check-in's
  Save), and when this phone has no timer start for the client.
- **Couple log**: after the first client's save the form switches to the partner, and the clock runs on from the
  shared start.
- **Accessibility** (the row is one element): running "Session timer 12:34, started 3:05 pm. Submitting now saves
  13 min as the duration."; saved "Session time 57 min, saved as the duration".
- The page's bottom padding grows by 52 while the row shows, so the last card is never under the bar.
- All times are IST (Asia/Kolkata), like the json's `date`.

## 2. Data / server contract
- Nothing new on the server (no migration, column, RPC or policy), and no new query key, storage key or package.
- **The running clock** reads the start that B2 stores on the phone: AsyncStorage key
  `session-timer:<clientId>:<IST day>` holding `{ started_at, schedule_id, gate }`. It is read with
  `readTimer(clientId)` when the form opens for a client (today's key, else yesterday's when that start is within
  12 hours), and taken from the return value of every `startTimer` call (the entry in force: an existing start for
  the same client and IST day is returned untouched, so the clock never jumps back to 0:00).
- **The saved row** shows the `SessionTiming` json that `finishTimer` builds at Submit: the same object that goes
  into the outbox payload as `sessionTiming` and lands on `training_sessions.session_timing`, with
  `training_sessions.duration_minutes` = its `duration_minutes`. Shape (unchanged since 13 Oct; `source` is "ios"
  on iOS):
```json
{
  "started_at": "2026-10-22T09:35:00.000Z",
  "ended_at": "2026-10-22T10:32:00.000Z",
  "date": "2026-10-22",
  "duration_minutes": 57,
  "source": "ios",
  "role": "trainer",
  "schedule_id": "6f0c...-or-null",
  "app_version": "<expoConfig.version> (<ios.buildNumber>)",
  "gate": "saved"
}
```
- **A queued log being edited** shows `sessionTiming` of that outbox item's payload (`WorkoutLogOutboxPayload`).
- **The rule**: `minutesIfSubmitted(start, now)` = `durationMinutes(start, max(now, start))` =
  `Math.max(1, Math.round((now - start) / 60000))`, the json's own rule, so the number shown is the number written.
  A start in the future (device clock moved back) reads "0:00" and saves 1.
- Owner's check (read only):
```sql
select client_id, scheduled_at, duration_minutes, session_timing
  from training_sessions where session_timing->>'source' = 'ios' order by scheduled_at desc limit 10;
```

## 3. Code to port
Copy rule: `sessionTiming.ts`, its test and `SessionClock.tsx` are copied whole, byte for byte. The `trainer.tsx`
blocks are the exact Android code at HEAD (2 Nov 2026), with enough around them to place them; only the lines named
under each block are new.

### 3.1 `src/lib/sessionTiming.ts` (whole file, 169 lines; replaces the B2 copy)
Lines 1 to 134 and 165 to 169 are the 13 Oct file from B2, unchanged. Lines 135 to 164 are new: `elapsedClock`,
`minutesIfSubmitted`, `clockOf`, `minutesText`. The file imports `Platform` from react-native, AsyncStorage and
expo-constants (the test stubs all three).
```ts
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
```

### 3.2 `tests/rules/session_timing_test.js` (whole file, 93 lines, 37 checks)
Lines 75 to 90 are new (13 checks). It reads the source through `node_modules/typescript` from the repo root.
```js
// Rule test for the Odds staff app. ROOT = the repo root; point it at the iOS repo and run: node tests/rules/session_timing_test.js
const ROOT = require("path").resolve(__dirname, "../..");
// node test of src/lib/sessionTiming.ts (TS transpiled; AsyncStorage, Platform and expo-constants stubbed).
const ts = require(ROOT + '/node_modules/typescript');
const fs = require('fs');
const src = fs.readFileSync(ROOT + '/src/lib/sessionTiming.ts', 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
const store = new Map();
const AsyncStorage = {
  getItem: async (k) => (store.has(k) ? store.get(k) : null),
  setItem: async (k, v) => { store.set(k, v); },
  getAllKeys: async () => [...store.keys()],
  multiRemove: async (ks) => { ks.forEach((k) => store.delete(k)); },
};
const stubs = {
  'react-native': { Platform: { OS: 'android' } },
  '@react-native-async-storage/async-storage': { __esModule: true, default: AsyncStorage },
  'expo-constants': { __esModule: true, default: { expoConfig: { version: '5.0', android: { versionCode: 32 } } } },
};
const m = { exports: {} };
new Function('module', 'exports', 'require', js)(m, m.exports, (n) => stubs[n] ?? require(n));
const T = m.exports;
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };
(async () => {
  // minutes
  eq('60 s rounds to 1', T.durationMinutes('2026-10-13T04:00:00Z', '2026-10-13T04:01:00Z'), 1);
  eq('90 s rounds to 2', T.durationMinutes('2026-10-13T04:00:00Z', '2026-10-13T04:01:30Z'), 2);
  eq('25 s is 1, never 0', T.durationMinutes('2026-10-13T04:00:00Z', '2026-10-13T04:00:25Z'), 1);
  eq('57 min 28 s rounds to 57', T.durationMinutes('2026-10-13T04:31:12Z', '2026-10-13T05:28:40Z'), 57);
  eq('ended before started still 1', T.durationMinutes('2026-10-13T04:00:00Z', '2026-10-13T03:59:00Z'), 1);
  // IST day
  eq('istDayOf across UTC midnight (19:30Z = 01:00 IST next day)', T.istDayOf('2026-10-12T19:30:00Z'), '2026-10-13');
  eq('istDayOf before IST midnight (18:29Z = 23:59 IST)', T.istDayOf('2026-10-12T18:29:00Z'), '2026-10-12');
  eq('TIMER_KEY', T.TIMER_KEY('c1', '2026-10-13'), 'session-timer:c1:2026-10-13');
  eq('appVersionLabel', T.appVersionLabel(), '5.0 (32)');
  // the json
  const start = { started_at: '2026-10-13T04:31:12.000Z', schedule_id: 's1', gate: 'saved' };
  eq('buildTiming', T.buildTiming(start, '2026-10-13T05:28:40.000Z', 'trainer'), { started_at: '2026-10-13T04:31:12.000Z', ended_at: '2026-10-13T05:28:40.000Z', date: '2026-10-13', duration_minutes: 57, source: 'android', role: 'trainer', schedule_id: 's1', app_version: '5.0 (32)', gate: 'saved' });
  eq('buildTiming ios + no version', T.buildTiming({ ...start, schedule_id: null, gate: 'skipped' }, '2026-10-13T04:32:00.000Z', 'doctor', { source: 'ios', appVersion: null }).source + '|' + T.buildTiming(start, '2026-10-13T04:32:00.000Z', 'doctor', { source: 'ios', appVersion: null }).app_version, 'ios|null');
  // storage: start keeps an existing start
  const now1 = '2026-10-13T04:31:12.000Z';
  const a = await T.startTimer('c1', 's1', 'saved', undefined, now1);
  eq('startTimer writes', a, { started_at: now1, schedule_id: 's1', gate: 'saved' });
  const b = await T.startTimer('c1', null, 'skipped', undefined, '2026-10-13T04:40:00.000Z');
  eq('startTimer keeps the existing start for the same client + day', b, { started_at: now1, schedule_id: 's1', gate: 'saved' });
  eq('stored once', store.size, 1);
  // finish uses the stored start, does not clear
  const f = await T.finishTimer('c1', 'trainer', '2026-10-13T05:28:40.000Z');
  eq('finishTimer minutes', [f.minutes, f.timing.duration_minutes, f.timing.gate, f.timing.schedule_id], [57, 57, 'saved', 's1']);
  eq('finishTimer does not clear', store.size, 1);
  // partner leg copies the first leg's start
  const p = await T.startTimer('c2', null, 'saved', now1, '2026-10-13T05:29:00.000Z');
  eq('partner start copied', p.started_at, now1);
  // clear
  await T.clearTimer('c1', '2026-10-13T05:30:00.000Z');
  eq('clearTimer removes today', store.has('session-timer:c1:2026-10-13'), false);
  eq('finish after clear is null', await T.finishTimer('c1', 'trainer', '2026-10-13T05:31:00.000Z'), null);
  // across IST midnight: started 23:30 IST, submitted 00:40 IST next day -> yesterday's key within 12 h
  store.clear();
  await T.startTimer('c3', 's3', 'saved', undefined, '2026-10-12T18:00:00.000Z'); // 23:30 IST on 12 Oct
  const late = await T.finishTimer('c3', 'trainer', '2026-10-12T19:10:00.000Z'); // 00:40 IST on 13 Oct
  eq('cross-midnight: yesterday start found', [late.timing.date, late.timing.duration_minutes], ['2026-10-12', 70]);
  eq('cross-midnight: beyond 12 h ignored', await T.finishTimer('c3', 'trainer', '2026-10-13T07:00:00.000Z'), null);
  // sweep: an abandoned start from another day disappears when a new one starts
  store.clear();
  store.set('session-timer:c4:2026-10-01', JSON.stringify({ started_at: '2026-10-01T04:00:00.000Z', schedule_id: null, gate: 'skipped' }));
  await T.startTimer('c4', null, 'skipped', undefined, '2026-10-13T04:00:00.000Z');
  await new Promise((r) => setTimeout(r, 10));
  eq('sweep removed the old day', store.has('session-timer:c4:2026-10-01'), false);
  eq('sweep kept today', store.has('session-timer:c4:2026-10-13'), true);
  // a corrupt entry is ignored
  store.set('session-timer:c5:2026-10-13', '{not json');
  eq('corrupt start reads as none', await T.finishTimer('c5', 'trainer', '2026-10-13T04:00:00.000Z'), null);
  // The visible clock (22 Oct 2026): the number shown is the number saved.
  const S = '2026-10-22T09:35:00.000Z'; // 3:05 pm IST
  const at = (sec) => Date.parse(S) + sec * 1000;
  eq('clock 0 s', T.elapsedClock(S, at(0)), '0:00');
  eq('clock 42 s', T.elapsedClock(S, at(42)), '0:42');
  eq('clock 12 min 34 s', T.elapsedClock(S, at(12 * 60 + 34)), '12:34');
  eq('clock past an hour', T.elapsedClock(S, at(3725)), '1:02:05');
  eq('clock start in the future reads 0:00', T.elapsedClock(S, at(-90)), '0:00');
  eq('clock bad start reads 0:00', T.elapsedClock('nope', at(10)), '0:00');
  eq('saves 1 min under a minute', T.minutesIfSubmitted(S, at(20)), 1);
  eq('saves 13 min at 12:34 (rounded, as the json)', T.minutesIfSubmitted(S, at(12 * 60 + 34)), 13);
  eq('saves 12 min at 12:29', T.minutesIfSubmitted(S, at(12 * 60 + 29)), 12);
  eq('saved minutes equal the json rule', T.minutesIfSubmitted(S, at(3448)), T.durationMinutes(S, new Date(at(3448)).toISOString()));
  eq('saves 1 min when the start is in the future', T.minutesIfSubmitted(S, at(-300)), 1);
  eq('clockOf IST', [T.clockOf(S), T.clockOf('2026-10-22T03:30:00Z'), T.clockOf(null)], ['3:05 pm', '9:00 am', '']);
  eq('minutesText', [T.minutesText(1), T.minutesText(57), T.minutesText(60), T.minutesText(65)], ['1 min', '57 min', '1 h', '1 h 5 min']);
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
```
Run `node tests/rules/session_timing_test.js` from the repo root: 37 `PASS` lines, then `ALL PASS`.

### 3.3 `src/components/SessionClock.tsx` (new file, 64 lines)
Uses `C`, `F`, `hexA` from `../theme`, `Icon` (name `clock`) from `../icons` and `Mono` from `./primitives`, all
already in the app. The clock ticks inside this component only, so the form never re-renders every second.
```tsx
/* The visible session timer (22 Oct 2026, owner: "show the timer clock when we log a session; the trainer should
   see the timer we save in duration"). One row in the Add Workout form's sticky Submit bar:
   - running: a live clock since the stored start (health check-in Save, or the form entry), the start time and the
     minutes a submit now would save (the same rule as training_sessions.duration_minutes);
   - final: once the log is captured, the saved minutes with the start and end times (a queued log being edited
     shows the minutes stored in it).
   The clock ticks inside this component only, so the form itself never re-renders every second. Rules and
   formatting in src/lib/sessionTiming.ts. */
import React from 'react';
import { View, Text, AppState } from 'react-native';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Mono } from './primitives';
import { elapsedClock, minutesIfSubmitted, clockOf, minutesText } from '../lib/sessionTiming';

const TEAL = '#2DD4BF';

export function SessionClock({ startedAt, final }: {
  /** the running start (ISO); null when the timer has not started */
  startedAt: string | null;
  /** set once the log captured its timing (or a queued log carries one): the clock stops on these numbers */
  final: { started_at: string; ended_at: string; duration_minutes: number } | null;
}) {
  const [now, setNow] = React.useState(() => Date.now());
  const running = !!startedAt && !final;
  React.useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    // Back from the background: catch up at once instead of on the next tick.
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') setNow(Date.now()); });
    return () => { clearInterval(id); sub.remove(); };
  }, [running]);

  if (final) {
    const range = [clockOf(final.started_at), clockOf(final.ended_at)].filter(Boolean).join(' to ');
    return (
      <View accessible accessibilityLabel={`Session time ${minutesText(final.duration_minutes)}, saved as the duration`}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 10, paddingVertical: 8, paddingHorizontal: 11, borderRadius: 12, backgroundColor: hexA(C.green, 0.08), borderWidth: 1, borderColor: hexA(C.green, 0.3) }}>
        <Icon name="clock" size={14} color={C.green} strokeWidth={2.2} />
        <View style={{ flex: 1 }}>
          <Mono style={{ fontSize: 8.5, letterSpacing: 0.8, color: C.green }}>SESSION TIME · SAVED AS DURATION</Mono>
          {range ? <Mono style={{ fontSize: 8.5, color: C.muted2, marginTop: 2 }}>{range.toUpperCase()}</Mono> : null}
        </View>
        <Text style={{ fontFamily: F.bodyBold, fontSize: 17, color: C.green }}>{minutesText(final.duration_minutes)}</Text>
      </View>
    );
  }
  if (!startedAt) return null;
  const clock = elapsedClock(startedAt, now);
  const saves = minutesIfSubmitted(startedAt, now);
  const from = clockOf(startedAt);
  return (
    <View accessible accessibilityLabel={`Session timer ${clock}, started ${from}. Submitting now saves ${minutesText(saves)} as the duration.`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 10, paddingVertical: 8, paddingHorizontal: 11, borderRadius: 12, backgroundColor: hexA(TEAL, 0.07), borderWidth: 1, borderColor: hexA(TEAL, 0.28) }}>
      <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: now % 2000 < 1000 ? TEAL : hexA(TEAL, 0.35) }} />
      <View style={{ flex: 1 }}>
        <Mono style={{ fontSize: 8.5, letterSpacing: 0.8, color: TEAL }}>SESSION TIMER</Mono>
        <Mono style={{ fontSize: 8.5, color: C.muted2, marginTop: 2 }} numberOfLines={1}>{`FROM ${from.toUpperCase()} · SAVES ${minutesText(saves).toUpperCase()}`}</Mono>
      </View>
      <Text style={{ fontFamily: F.bodyBold, fontSize: 19, color: '#fff', fontVariant: ['tabular-nums'] }}>{clock}</Text>
    </View>
  );
}
```

### 3.4 `src/screens/trainer.tsx`, `Workout`

**(a) Imports** (top of the file). New: `readTimer` and `type TimerStart` on the first line; the second line.
```ts
import { startTimer, finishTimer, clearTimer, readTimer, SessionTiming, type TimerStart } from '../lib/sessionTiming';
import { SessionClock } from '../components/SessionClock';
```

**(b) The timer state**, in `Workout` right after `listenRequired` (the B2 refs and entry effect, now with the
clock). New: everything from the `// The visible clock` comment to the end of the effect that reads the start back.
Changed in the entry effect (the last effect): the start call is wrapped in `showStart(...)` (it was
`startTimer(...).catch(() => {})`) and `showStart` joined its dependencies.
```tsx
  // Session timer (13 Oct 2026): a log whose health data is already complete starts its
  // timer on entry (gate 'skipped'); when the check-in sheet has to open, its Save starts
  // it instead (gate 'saved'). An existing start for the same client and IST day is kept,
  // so backing out and returning never restarts it. Editing a queued log has no timer.
  const timerEntryRef = React.useRef<string | null>(null);
  const lastTimingRef = React.useRef<SessionTiming | null>(null);
  // The visible clock (22 Oct 2026, owner: "the trainer should see the timer we save in duration"): the start in
  // force for this client (read back from storage, or as a start call returns it) and, once the submit captured
  // it, the timing the log carries. SessionClock in the sticky bar shows them.
  const [timerStart, setTimerStart] = React.useState<TimerStart | null>(null);
  const [savedTiming, setSavedTiming] = React.useState<SessionTiming | null>(null);
  const clockClientRef = React.useRef<string | null>(null);
  clockClientRef.current = selectedClientId ?? null;
  const showStart = React.useCallback((clientId: string, p: Promise<TimerStart | null>) => {
    p.then((e) => { if (e && clockClientRef.current === clientId) setTimerStart(e); }).catch(() => {});
  }, []);
  React.useEffect(() => {
    setTimerStart(null);
    setSavedTiming(null);
    if (!selectedClientId || editingOutboxId) return;
    const c = selectedClientId;
    readTimer(c).then((r) => { if (r && clockClientRef.current === c) setTimerStart((cur) => cur ?? r.start); }).catch(() => {});
  }, [selectedClientId, editingOutboxId]);
  React.useEffect(() => {
    if (!selectedClientId || editingOutboxId || !healthQ.isSuccess) return;
    const key = `${selectedClientId}:${workoutScheduleId ?? ''}`;
    if (timerEntryRef.current === key) return;
    timerEntryRef.current = key;
    if (serverGateOk) showStart(selectedClientId, startTimer(selectedClientId, workoutScheduleId ?? null, 'skipped'));
  }, [selectedClientId, workoutScheduleId, editingOutboxId, healthQ.isSuccess, serverGateOk, showStart]);
```
- `authRole` used later is `dbRole` from `useAuth()` (`const { session: authSession, dbRole: authRole } = useAuth();`).
- `clockClientRef` stops a late answer for the previous client (couple switch, quick client change) from landing
  on the new one.
- `setTimerStart((cur) => cur ?? r.start)`: a start call that answered first wins over the read-back.
- Editing a queued log never reads or starts a timer (both effects return early on `editingOutboxId`).

**(c) The check-in Save**, in `saveHealth`. Only `startNow` changed (it called `startTimer(...).catch(() => {})`);
its three calls (offline, after the online save, the network-error fallback) are B2 and unchanged.
```tsx
    // The check-in Save is the session's start (session timer, 13 Oct 2026).
    const startNow = () => { if (selectedClientId) showStart(selectedClientId, startTimer(selectedClientId, workoutScheduleId ?? null, 'saved')); };
    if (!getIsOnline()) {
      // Same required fields as online; the data rides along in the outbox
      // payload and syncs right before the workout log.
      setOfflineHealth(payload);
      closeHealthSheet();
      startNow();
      return;
    }
    try {
      await saveHealthM.mutateAsync(payload);
      closeHealthSheet();
      startNow();
    } catch (e: any) {
      if (/network request failed|network error|failed to fetch|fetch failed|timeout/i.test(String(e?.message))) {
        setOfflineHealth(payload);
        closeHealthSheet();
        startNow();
      }
      /* other errors shown in dialog */
    }
```

**(d) What the bar shows**, right after `missingHint` and before `finishAfterSave`. All new. `gateBlocking` is the
existing health check-in lock; `getOutboxItem` and `WorkoutLogOutboxPayload` come from `../lib/offline` (already
imported for the edit path).
```tsx
  // The visible session timer (22 Oct 2026): a queued log being edited shows the minutes it already carries.
  const queuedTiming: SessionTiming | null = editingOutboxId
    ? ((getOutboxItem(editingOutboxId)?.payload as WorkoutLogOutboxPayload | undefined)?.sessionTiming ?? null)
    : null;
  const clockShown = !gateBlocking && !!(timerStart || savedTiming || queuedTiming);
```

**(e) The partner leg**, in `finishAfterSave` inside the `setTimeout` (B2). Only the `showStart(...)` wrapper is new.
```tsx
        // The partner's leg shares the first leg's start; its end is its own submit.
        const firstLeg = lastTimingRef.current;
        showStart(next.id, startTimer(next.id, null, firstLeg?.gate ?? 'skipped', firstLeg?.started_at));
```

**(f) Submit, the new-log branch** (the `else` after the edit-in-place branch). New: the last two lines
(`// The clock stops ...` and `setSavedTiming(...)`). The rest is B2 plus the 2 Nov form refs (`sessionNameRef`,
`remarkRef`, from `ios-workout-form-smooth-handoff.md`); keep the iOS payload lines as they are. The edit-in-place
branch above it sets no `savedTiming`, so an edited queued log keeps showing `queuedTiming`.
```tsx
      } else {
        // Original device timestamp + pre-generated id: a late sync keeps THIS
        // moment as the log time, and retries can never duplicate the session.
        // The session timer ends here; the json rides in the payload as captured.
        const timed = await finishTimer(selectedClientId as string, authRole ?? 'trainer');
        lastTimingRef.current = timed?.timing ?? null;
        const payload = {
          trainerId,
          clientId: selectedClientId as string,
          clientName,
          sessionName: sessionNameRef.current.trim() || modLabel,
          modality: effectiveModality,
          exercises: submitExercises,
          remark: remarkRef.current,
          rpe,
          scheduleSessionId: workoutScheduleId,
          partnerSessionGroupId: partnerPlan?.groupId ?? null,
          sessionId: uuidv4(),
          sessionDate: new Date().toISOString().slice(0, 10),
          health: offlineHealth,
          medicines: pendingMedicines, // the 10-day medicine check-in, recorded with this session id (14 Oct 2026)
          sessionTiming: timed?.timing ?? null,
        };
        const item = await enqueueOutbox('workout-log', label, payload, { autoDrain: false });
        itemId = item.id;
        notesSessionId = payload.sessionId;
        // The clock stops on the minutes this log now carries (22 Oct 2026).
        setSavedTiming(timed?.timing ?? null);
      }
```
Unchanged and must stay (B2), after `submitItem`:
```tsx
      // Synced or queued: the log is durable with its timing, so the start is spent.
      if (res.status !== 'failed' && selectedClientId) clearTimer(selectedClientId).catch(() => {});
```

**(g) The page's bottom padding**. New: `+ (clockShown ? 52 : 0)`.
```tsx
      {/* pb clears the sticky Submit bar (+ home indicator); Page adds the keyboard height itself. */}
      <Page ref={dragPageRef} scrollEnabled={pageScrollOk} scrollOffsetRef={dragOffsetRef} gap={14} pt={6} pb={160 + insets.bottom + (clockShown ? 52 : 0)} kbAware>
```

**(h) The sticky Submit bar**. New: the two lines after the bar's opening `View`. The hint row and the Cancel /
Submit buttons follow, unchanged.
```tsx
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 18, paddingTop: 12, paddingBottom: insets.bottom + 14, backgroundColor: 'rgba(8,6,6,0.96)', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' }}>
        {/* The session timer, visible (22 Oct 2026): live while logging, then the minutes saved as the duration. */}
        {clockShown ? <SessionClock startedAt={timerStart?.started_at ?? null} final={savedTiming ?? queuedTiming} /> : null}
```

### 3.5 Not to port
`app.json` (Android versionCode 40). Nothing in `clientQueries.ts`, `offline.ts` or the therapist and physio sheets
changed: they still have no clock (their `duration_minutes` keeps the typed value).

## 4. Check on the iPhone
1. `node tests/rules/session_timing_test.js`: 37 PASS, then ALL PASS. `npx tsc --noEmit`: exit 0.
2. Today's Roster → a client with no health check-in today → Log Workout. While the Log Health Data popup is
   required, the sticky bar has no timer row.
3. Save Health Data. The row appears: blinking teal dot, "SESSION TIMER", "FROM <now, e.g. 3:05 PM> · SAVES 1 MIN",
   clock "0:00" ticking every second.
4. Wait: at 1:29 it reads "SAVES 1 MIN", at 1:30 "SAVES 2 MIN" (90 s rounds to 2).
5. Scroll the form to the end: the row stays in the bar and the last card is fully above the bar.
6. Go back, open Log Workout for the same client again: the clock goes on from the first start (not 0:00).
7. Lock the phone for a minute and unlock: the clock shows the right time at once, without a jump a second later.
8. A client whose check-in is already complete: the row appears on entry, "FROM" = the time you opened the form.
9. Online, fill the form and Submit: the row turns green, "SESSION TIME · SAVED AS DURATION", "<start> TO <end>",
   "<n> min" (briefly: the form leaves 0.7 s after "Synced to server ✓"). The SQL in section 2 shows that session with `duration_minutes` = n and
   `session_timing->>'duration_minutes'` = n.
10. Airplane mode, log another client: green row with the minutes; Home → Waiting to Sync → Edit that item: the
    same green row and minutes, not ticking. Back online it syncs with the same minutes.
11. Couple log (Add Client in the form): after the first client's save, the partner's form shows the clock running
    from the same start.
12. VoiceOver on the row: "Session timer 2:15, started 3:05 pm. Submitting now saves 2 min as the duration."
13. Settings → Display & Brightness → Display Zoom → Larger Text: the second line ends with "…" when it does not
    fit, and the clock stays fully visible on the right.

Not confirmed: whether the iOS repo already has B2 (rows with `source = 'ios'` were not checked). Hermes on
iOS was not checked for the "3:05 pm" format of `clockOf` (Intl `en-IN`); step 3 shows it. The Android device test
of 22 Oct is still recorded as pending in the feature doc.
