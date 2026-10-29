// Rule test for the Odds staff app. ROOT = the repo root; point it at the iOS repo and run: node tests/rules/crew_names_test.js
const ROOT = require("path").resolve(__dirname, "../..");
// My Crew short names (28 Oct 2026): first name, surname initial only when two members share the first name.
const ts = require(ROOT + '/node_modules/typescript');
const fs = require('fs');
const src = fs.readFileSync(ROOT + '/src/lib/crewNames.ts', 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const m = { exports: {} }; new Function('module', 'exports', 'require', js)(m, m.exports, require);
const N = m.exports;
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };

const team = [
  { id: 'a', name: 'Sagar Sharma' },
  { id: 'b', name: 'Faizan odds' },
  { id: 'c', name: 'faizaan ashraf' },
  { id: 'd', name: 'Faizan Khan' },
  { id: 'e', name: 'Balbir' },
  { id: 'f', name: '  Anjana   Odds ' },
];
const map = N.shortNames(team);
eq('unique first name stays bare', map.a, 'Sagar');
eq('shared first name gets the surname initial', map.b, 'Faizan O.');
eq('and the other one too', map.d, 'Faizan K.');
eq('different spelling is a different name', map.c, 'faizaan');
eq('single-word name stays', map.e, 'Balbir');
eq('extra spaces are ignored', map.f, 'Anjana');
eq('first word helper', [N.firstWord('Dr . Divya Sakhalkar'), N.firstWord(''), N.firstWord(null)], ['Dr', 'Member', 'Member']);
eq('sender outside the team falls back to the first name', N.shortNameFor(map, 'zz', 'Priyanshu Arya'), 'Priyanshu');
eq('member id wins over the name passed', N.shortNameFor(map, 'b', 'Faizan odds'), 'Faizan O.');

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
