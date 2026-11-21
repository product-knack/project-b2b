// Rule test for the Odds staff app. ROOT = the repo root; point it at the iOS repo and run: node tests/rules/pause_dates_test.js
const ROOT = require("path").resolve(__dirname, "../..");
// node test of src/lib/pauseDates.ts: a pause a CRM starts must have an end date (21 Nov 2026).
const ts = require(ROOT + '/node_modules/typescript');
const fs = require('fs');
const load = (rel) => {
  const js = ts.transpileModule(fs.readFileSync(ROOT + rel, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const m = { exports: {} };
  new Function('module', 'exports', 'require', js)(m, m.exports, (n) => { throw new Error('unexpected require ' + n); });
  return m.exports;
};
const P = load('/src/lib/pauseDates.ts');
const F = load('/src/lib/friendlyError.ts');
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };

eq('a real day', [P.isYmd('2026-11-21'), P.isYmd(' 2026-11-21 '), P.isYmd('2026-02-30'), P.isYmd('2026-13-01'), P.isYmd('21-11-2026'), P.isYmd('2026-11-2'), P.isYmd(''), P.isYmd(null), P.isYmd(undefined)], [true, true, false, false, false, false, false, false, false]);
eq('both dates given, end after start', P.pauseDatesProblem('2026-11-21', '2026-11-28'), null);
eq('a one-day pause is allowed', P.pauseDatesProblem('2026-11-21', '2026-11-21'), null);
eq('no end date', P.pauseDatesProblem('2026-11-21', ''), 'Pick the pause end date.');
eq('end date of spaces only', P.pauseDatesProblem('2026-11-21', '   '), 'Pick the pause end date.');
eq('end date missing altogether', [P.pauseDatesProblem('2026-11-21', null), P.pauseDatesProblem('2026-11-21', undefined)], ['Pick the pause end date.', 'Pick the pause end date.']);
eq('no start date', P.pauseDatesProblem('', '2026-11-28'), 'Pick the pause start date.');
eq('a start that is not a date', P.pauseDatesProblem('2026-02-30', '2026-03-05'), 'The pause start date is not a real date.');
eq('an end that is not a date', [P.pauseDatesProblem('2026-11-21', '2026-11-31'), P.pauseDatesProblem('2026-11-21', '2026-11')], ['The pause end date is not a real date.', 'The pause end date is not a real date.']);
eq('end before start', P.pauseDatesProblem('2026-11-21', '2026-11-20'), 'The pause end date is before the start date.');
eq('the quick choices', [P.pauseEndAfter('2026-11-21', 7), P.pauseEndAfter('2026-11-21', 14), P.pauseEndAfter('2026-11-21', 30), P.pauseEndAfter('2026-12-25', 7), P.pauseEndAfter('2028-02-22', 7)], ['2026-11-28', '2026-12-05', '2026-12-21', '2027-01-01', '2028-02-29']);
eq('a quick choice without a start gives nothing', [P.pauseEndAfter('', 7), P.pauseEndAfter('junk', 7), P.pauseEndAfter(null, 7)], ['', '', '']);
eq('every quick choice passes the rule', [7, 14, 30].map((d) => P.pauseDatesProblem('2026-11-21', P.pauseEndAfter('2026-11-21', d))), [null, null, null]);
const sentences = ['Pick the pause end date.', 'Pick the pause start date.', 'The pause end date is not a real date.', 'The pause start date is not a real date.', 'The pause end date is before the start date.'];
eq('the sentences reach the person as written', sentences.map((s) => F.friendlyError(new Error(s), 'Try again.')), sentences);
eq('no long dash in the sentences', sentences.some((s) => s.includes(String.fromCharCode(8212))), false);

// the form and the save step both use the rule, and no open-ended choice is left
const sheet = fs.readFileSync(ROOT + '/src/screens/crmClientDetail.tsx', 'utf8');
const save = fs.readFileSync(ROOT + '/src/lib/crmClientDetailQueries.ts', 'utf8');
const sheetBody = sheet.slice(sheet.indexOf('function PauseSheet('), sheet.indexOf('function DiscontinueSheet('));
eq('the sheet asks the rule', /pauseDatesProblem\(startDate, endDate\)/.test(sheetBody), true);
eq('the sheet marks the end date as required', [/PAUSE END DATE \* \(YYYY-MM-DD\)/.test(sheetBody), /OPTIONAL/.test(sheetBody), /Leave empty/.test(sheetBody)], [true, false, false]);
eq('no Open-ended quick choice', /'Open-ended'\]/.test(sheetBody), false);
eq('an old open-ended pause is still shown as such', /'Open-ended'/.test(sheetBody), true);
eq('the save step refuses a pause without an end date', /const datesProblem = pauseDatesProblem\(input\.pauseStart, input\.pauseEnd\);\s*if \(datesProblem\) throw new Error\(datesProblem\);/.test(save), true);
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
