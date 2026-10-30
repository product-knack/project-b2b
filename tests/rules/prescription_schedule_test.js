// Rule test for the Odds staff app. ROOT = the repo root; point it at the iOS repo and run: node tests/rules/prescription_schedule_test.js
const ROOT = require("path").resolve(__dirname, "../..");
// node test of src/lib/prescriptionSheet.ts (30 Oct 2026): the SCHEDULE column printed DAILY for every
// frequency it did not know, so a weekly Mounjaro or a monthly vitamin D read DAILY on the app's PDF.
// The expo modules and consultantQueries are stubbed; only the pure wording functions are exercised.
const ts = require(ROOT + '/node_modules/typescript');
const fs = require('fs');
const src = fs.readFileSync(ROOT + '/src/lib/prescriptionSheet.ts', 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const stub = (name) => {
  if (name === './consultantQueries') return { istYmdOf: (s) => String(s).slice(0, 10), MONTHS_LONG: [], pad2: (n) => String(n).padStart(2, '0') };
  return {};
};
const m = { exports: {} };
new Function('module', 'exports', 'require', js)(m, m.exports, stub);
const M = m.exports;
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };
const line = (frequency, instruction = '', dv = null, du = 'days', timing = 'Any time') => ({ frequency, instruction, duration_value: dv, duration_unit: du, timing, dose_amount: '1' });

// SCHEDULE column
eq('Weekly is WEEKLY, not DAILY', M.scheduleLabel(line('Weekly')), 'WEEKLY');
eq('Monthly is MONTHLY', M.scheduleLabel(line('Monthly')), 'MONTHLY');
eq('Alternate days', M.scheduleLabel(line('Alternate days')), 'ALTERNATE DAYS');
eq('daily codes stay DAILY', ['OD', 'BD', 'TDS', 'QID'].map((f) => M.scheduleLabel(line(f))), ['DAILY', 'DAILY', 'DAILY', 'DAILY']);
eq('HS and SOS unchanged', [M.scheduleLabel(line('HS')), M.scheduleLabel(line('SOS'))], ['NIGHTLY', 'AS NEEDED']);
eq('unknown words print themselves, never DAILY', M.scheduleLabel(line('Every 3 days')), 'EVERY 3 DAYS');
eq('empty stays empty', M.scheduleLabel(line('')), '');

// INSTRUCTIONS column, no instruction written
eq('monthly with no instruction', M.instructionText(line('Monthly')), 'Once a month');
eq('weekly with duration, no instruction', M.instructionText(line('Weekly', '', 3, 'weeks')), 'Once a week for 3 weeks');
eq('own instruction still wins', M.instructionText(line('Weekly', 'Subcutaneous injection', 3, 'weeks')), 'Subcutaneous injection');

// popup fields
const freq = (f) => M.medicineFields(line(f)).find((x) => x.label === 'Frequency');
eq('popup weekly', freq('Weekly').value, 'Once a week');
eq('popup monthly', freq('Monthly').value, 'Once a month');
eq('popup OD unchanged', freq('OD').value, 'Once daily');

console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
