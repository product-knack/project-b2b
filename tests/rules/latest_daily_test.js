// Rule test for the Odds staff app. ROOT = the repo root; point it at the iOS repo and run: node tests/rules/latest_daily_test.js
const ROOT = require("path").resolve(__dirname, "../..");
// node test of src/lib/latestDaily.ts (latest health data with its date: Today's Roster strip + Log Health Data popup, 22 Oct 2026).
const ts = require(ROOT + '/node_modules/typescript');
const fs = require('fs');
const src = fs.readFileSync(ROOT + '/src/lib/latestDaily.ts', 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const m = { exports: {} };
new Function('module', 'exports', 'require', js)(m, m.exports, require);
const R = m.exports;
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };
const TODAY = '2026-10-22';

// rows as PostgREST returns them (live shapes from the 22 Oct probe)
eq('datedOf recovery', R.datedOf({ metric_date: '2026-09-07', recovery_score: 29 }, 'metric_date', 'recovery_score'), { value: 29, date: '2026-09-07' });
eq('datedOf minutes to hours', R.datedOf({ metric_date: '2026-10-22', sleep_duration_minutes: 450 }, 'metric_date', 'sleep_duration_minutes', 1 / 60), { value: 7.5, date: '2026-10-22' });
eq('datedOf numeric string', R.datedOf({ rating_date: '2026-10-21', hydration_inputs: '2.5' }, 'rating_date', 'hydration_inputs'), { value: 2.5, date: '2026-10-21' });
eq('datedOf null value', R.datedOf({ rating_date: '2026-10-21', nutrition_rating: null }, 'rating_date', 'nutrition_rating'), null);
eq('datedOf no row', R.datedOf(null, 'rating_date', 'nutrition_rating'), null);
eq('datedOf bad date', R.datedOf({ rating_date: null, nutrition_rating: 7 }, 'rating_date', 'nutrition_rating'), null);
eq('datedOf a timestamp date is cut to the day', R.datedOf({ log_date: '2026-10-20T00:00:00', hours_slept: 8 }, 'log_date', 'hours_slept'), { value: 8, date: '2026-10-20' });

// newer wins, wearable (first) wins the tie
const w = { value: 6.2, date: '2026-10-21' }, l = { value: 7, date: '2026-10-22' };
eq('newerOf newer logged beats older wearable', R.newerOf(w, l), l);
eq('newerOf same day: wearable first wins', R.newerOf({ value: 6.2, date: '2026-10-22' }, l), { value: 6.2, date: '2026-10-22' });
eq('newerOf one side missing', [R.newerOf(null, l), R.newerOf(w, null), R.newerOf(null, null)], [l, w, null]);

// the live case from the probe: recovery on 7 Sep only, logged sleep newer than the wearable
const live = R.pickLatestDaily({
  recovery: { metric_date: '2026-09-07', recovery_score: 29 },
  wearSleep: { metric_date: '2026-09-07', sleep_duration_minutes: 188 },
  wearSteps: { metric_date: '2026-07-11', steps_count: 607 },
  logSleep: { log_date: '2026-10-20', hours_slept: 7.5 },
  nutRating: { rating_date: '2026-10-21', nutrition_rating: 8 },
  nutSteps: { rating_date: '2026-10-20', steps_by_trainer: 10000 },
  nutHydration: { rating_date: '2026-10-20', hydration_inputs: 8 },
  hydrationSupported: true,
});
eq('pick: recovery 7 Sep', live.recovery, { value: 29, date: '2026-09-07' });
eq('pick: sleep is the logged 20 Oct one', live.sleep, { value: 7.5, date: '2026-10-20' });
eq('pick: steps is the trainer 20 Oct one', live.steps, { value: 10000, date: '2026-10-20' });
eq('pick: nutrition + hydration', [live.nutrition, live.hydration], [{ value: 8, date: '2026-10-21' }, { value: 8, date: '2026-10-20' }]);
const bare = R.pickLatestDaily({ hydrationSupported: false, nutHydration: { rating_date: '2026-10-22', hydration_inputs: 2 } });
eq('pick: nothing at all', [bare.recovery, bare.sleep, bare.nutrition, bare.steps], [null, null, null, null]);
eq('pick: hydration column not live: left out', [bare.hydration, bare.hydrationSupported], [null, false]);
eq('pick: hydrationSupported defaults to true', R.pickLatestDaily({}).hydrationSupported, true);

// dates
eq('daysBetween', [R.daysBetween('2026-10-22', TODAY), R.daysBetween('2026-10-21', TODAY), R.daysBetween('2026-09-07', TODAY), R.daysBetween('2026-10-23', TODAY)], [0, 1, 45, -1]);
eq('daysBetween across a month and a year', [R.daysBetween('2026-09-30', '2026-10-01'), R.daysBetween('2025-12-31', '2026-01-01')], [1, 1]);
eq('dayMonth', [R.dayMonth('2026-10-22', TODAY), R.dayMonth('2026-09-07', TODAY), R.dayMonth('2025-09-07', TODAY), R.dayMonth('bad', TODAY)], ['22 Oct', '7 Sep', '7 Sep 2025', '']);
eq('agoText', [R.agoText('2026-10-22', TODAY), R.agoText('2026-10-21', TODAY), R.agoText('2026-10-17', TODAY), R.agoText('2026-10-23', TODAY)], ['today', 'yesterday', '5 days ago', 'today']);
eq('datedLabel', [R.datedLabel('2026-10-22', TODAY), R.datedLabel('2026-09-07', TODAY)], ['22 Oct · today', '7 Sep · 45 days ago']);
eq('isStale: 2 days is fresh, 3 is old', [R.isStale('2026-10-20', TODAY), R.isStale('2026-10-19', TODAY), R.isStale('2026-10-22', TODAY)], [false, true, false]);
eq('dayBefore', [R.dayBefore(TODAY), R.dayBefore('2026-10-01'), R.dayBefore('2026-01-01'), R.dayBefore('2028-03-01')], ['2026-10-21', '2026-09-30', '2025-12-31', '2028-02-29']);

// values
eq('recoveryZone (WHOOP bands)', [R.recoveryZone(98), R.recoveryZone(67), R.recoveryZone(66), R.recoveryZone(34), R.recoveryZone(33), R.recoveryZone(1)], ['green', 'green', 'yellow', 'yellow', 'red', 'red']);
eq('valueText', [R.valueText('recovery', 48.6), R.valueText('sleep', 188 / 60), R.valueText('nutrition', 8), R.valueText('steps', 11857), R.valueText('steps', 100000), R.valueText('hydration', 2.5)], ['49%', '3.1 h', '8/10', '11,857', '100,000', '2.5 L']);

// the lines the roster strip renders
const lines = R.latestLines(live, TODAY);
eq('lines: order and labels', lines.map((x) => x.label), ['WHOOP recovery', 'Sleep', 'Nutrition', 'Steps', 'Hydration']);
eq('lines: recovery row', lines[0], { key: 'recovery', label: 'WHOOP recovery', text: '29%', has: true, date: '7 Sep · 45 days ago', stale: true, zone: 'red' });
eq('lines: nutrition row is fresh', [lines[2].text, lines[2].date, lines[2].stale, lines[2].zone], ['8/10', '21 Oct · yesterday', false, null]);
const none = R.latestLines(R.pickLatestDaily({}), TODAY);
eq('lines: nothing logged texts', none.map((x) => [x.text, x.has, x.date]), [['No WHOOP data', false, ''], ['Not logged', false, ''], ['Not logged', false, ''], ['Not logged', false, ''], ['Not logged', false, '']]);
eq('lines: no hydration row before the column is live', R.latestLines(bare, TODAY).map((x) => x.key), ['recovery', 'sleep', 'nutrition', 'steps']);
eq('no dashes in any user text', JSON.stringify([...lines, ...none]).includes('—') || JSON.stringify([...lines, ...none]).includes(' - '), false);
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
