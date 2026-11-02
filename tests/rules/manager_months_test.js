// Rule test for the Odds staff app. ROOT = the repo root; point it at the iOS repo and run: node tests/rules/manager_months_test.js
const ROOT = require("path").resolve(__dirname, "../..");
// Managers Leaderboard competition months (2 Nov 2026): tabs follow the period length, ranges clip to the period.
const ts = require(ROOT + '/node_modules/typescript');
const fs = require('fs');
const src = fs.readFileSync(ROOT + '/src/lib/managerMonths.ts', 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const m = { exports: {} }; new Function('module', 'exports', 'require', js)(m, m.exports, (n) => { throw new Error('unexpected require ' + n); });
const M = m.exports;
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };

// the live competition: 1 Aug 2026 to 31 Jan 2027
eq('six months Aug to Jan', M.competitionMonthCount('2026-08-01', '2027-01-31'), 6);
eq('labels carry the year after the turn', M.competitionMonthLabels('2026-08-01', '2027-01-31'), ['Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan 27']);
eq('three-month competition unchanged', M.competitionMonthLabels('2026-05-01', '2026-07-31'), ['May', 'Jun', 'Jul']);
eq('ongoing with no end: to this month', M.competitionMonthCount('2026-08-01', null, '2026-11-02'), 4);
eq('ongoing labels', M.competitionMonthLabels('2026-08-01', null, '2026-11-02'), ['Aug', 'Sep', 'Oct', 'Nov']);
eq('end before start still gives one month', M.competitionMonthCount('2026-08-01', '2026-07-01'), 1);
eq('cap at 12', M.competitionMonthCount('2025-01-01', '2027-12-31'), 12);
eq('mid-month start counts that month', M.competitionMonthCount('2026-08-15', '2026-10-02'), 3);

// filters
eq('index of month4', M.monthIndexOf('month4'), 3);
eq('index of overall', M.monthIndexOf('overall'), null);
eq('index of junk', [M.monthIndexOf('month0'), M.monthIndexOf('month13'), M.monthIndexOf(''), M.monthIndexOf(null)], [null, null, null, null]);
eq('filter of index', M.monthFilterOf(3), 'month4');
eq('stored month7 on a 6-month period falls back', M.effectiveMonthFilter('month7', 6), 'overall');
eq('stored month4 on a 6-month period stays', M.effectiveMonthFilter('month4', 6), 'month4');
eq('stored month3 on a 3-month period stays', M.effectiveMonthFilter('month3', 3), 'month3');

// ranges (the same maths as the three-tab version)
eq('overall = the period', M.competitionMonthRange('2026-08-01', '2027-01-31', 'overall'), { start: '2026-08-01', end: '2027-01-31' });
eq('month1 = August', M.competitionMonthRange('2026-08-01', '2027-01-31', 'month1'), { start: '2026-08-01', end: '2026-08-31' });
eq('month4 = November', M.competitionMonthRange('2026-08-01', '2027-01-31', 'month4'), { start: '2026-11-01', end: '2026-11-30' });
eq('month6 = January, clipped to the end', M.competitionMonthRange('2026-08-01', '2027-01-15', 'month6'), { start: '2027-01-01', end: '2027-01-15' });
eq('month1 of a mid-month start begins at the start', M.competitionMonthRange('2026-08-15', '2027-01-31', 'month1'), { start: '2026-08-15', end: '2026-08-31' });
eq('ongoing month with no end stays open to the month end', M.competitionMonthRange('2026-08-01', null, 'month4'), { start: '2026-11-01', end: '2026-11-30' });

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
