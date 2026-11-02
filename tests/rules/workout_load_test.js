// Rule test for the Odds staff app. ROOT = the repo root; point it at the iOS repo and run: node tests/rules/workout_load_test.js
const ROOT = require("path").resolve(__dirname, "../..");
// node test of src/lib/workoutLoad.ts: the load box's bodyweight split and join, and the decimal filter (2 Nov 2026).
const ts = require(ROOT + '/node_modules/typescript');
const fs = require('fs');
const src = fs.readFileSync(ROOT + '/src/lib/workoutLoad.ts', 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const m = { exports: {} };
new Function('module', 'exports', 'require', js)(m, m.exports, (n) => { throw new Error('unexpected require ' + n); });
const L = m.exports;
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };

// split
eq('plain number', L.splitBodyweightLoad('20'), { bw: false, extra: '20' });
eq('decimal number', L.splitBodyweightLoad('22.5'), { bw: false, extra: '22.5' });
eq('bodyweight only', L.splitBodyweightLoad('BW'), { bw: true, extra: '' });
eq('bodyweight plus', L.splitBodyweightLoad('BW+5'), { bw: true, extra: '5' });
eq('lower case and spaces', L.splitBodyweightLoad(' bw + 2.5 '), { bw: true, extra: '2.5' });
eq('no plus sign', L.splitBodyweightLoad('BW5'), { bw: true, extra: '5' });
eq('a word starting with bw is not bodyweight', L.splitBodyweightLoad('BWT bar'), { bw: false, extra: 'BWT bar' });
eq('other text stays', L.splitBodyweightLoad('Red band'), { bw: false, extra: 'Red band' });
eq('empty and null', [L.splitBodyweightLoad(''), L.splitBodyweightLoad(null)], [{ bw: false, extra: '' }, { bw: false, extra: '' }]);

// join
eq('join number', L.joinBodyweightLoad(false, '20'), '20');
eq('join bodyweight', L.joinBodyweightLoad(true, ''), 'BW');
eq('join bodyweight plus', L.joinBodyweightLoad(true, ' 7.5 '), 'BW+7.5');
eq('join empty', L.joinBodyweightLoad(false, ''), '');

// round trip: the stored text never changes shape
for (const v of ['20', 'BW', 'BW+5', 'BW+12.5', '']) eq(`round trip ${JSON.stringify(v)}`, L.joinBodyweightLoad(L.splitBodyweightLoad(v).bw, L.splitBodyweightLoad(v).extra), v);

// decimal filter
eq('decimal keeps one point', L.decimalOnly('2.5.1'), '2.51');
eq('decimal drops letters', L.decimalOnly('7h'), '7');
eq('decimal digits only', L.decimalOnly('12'), '12');

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
