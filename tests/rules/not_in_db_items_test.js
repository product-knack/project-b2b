// Rule test for the Odds staff app. ROOT = the repo root; point it at the iOS repo and run: node tests/rules/not_in_db_items_test.js
const ROOT = require("path").resolve(__dirname, "../..");
// node test of notInDbItems (clientQueries.ts) with every import stubbed.
const ts = require(ROOT + '/node_modules/typescript');
const fs = require('fs');
const src = fs.readFileSync(ROOT + '/src/lib/clientQueries.ts', 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const stub = new Proxy({}, { get: (_t, k) => (k === '__esModule' ? true : (() => ({}))) });
const m = { exports: {} };
new Function('module', 'exports', 'require', js)(m, m.exports, () => stub);
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };
const bp = [
  { body_part: 'Push', exercises: [
    { name: 'Pallof Press', measurement: 'reps', sets: [], notInDb: { muscle_group: 'Core', equipment: 'Cable', modality: 'Strength' } },
    { name: 'Chest Press Machine', measurement: 'reps', sets: [] },
  ] },
  { body_part: 'Pull', exercises: [{ name: ' pallof press ', measurement: 'reps', sets: [], notInDb: { muscle_group: 'Core', equipment: 'Cable', modality: 'Strength' } }] },
  { body_part: 'Conditioning', exercises: [{ name: 'Sled Push', measurement: 'duration', sets: [], notInDb: { muscle_group: 'Full Body', equipment: 'Sled', modality: 'Cardio' } }] },
];
eq('items: only NOT IN DB, deduped by name, measurement kept', m.exports.notInDbItems(bp), [
  { name: 'Pallof Press', modality: 'Strength', muscle_group: 'Core', equipment: 'Cable', measurement: 'reps' },
  { name: 'Sled Push', modality: 'Cardio', muscle_group: 'Full Body', equipment: 'Sled', measurement: 'duration' },
]);
eq('no NOT IN DB -> no items', m.exports.notInDbItems([{ body_part: 'A', exercises: [{ name: 'X', measurement: 'reps', sets: [] }] }]), []);
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
