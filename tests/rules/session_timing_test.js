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
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
