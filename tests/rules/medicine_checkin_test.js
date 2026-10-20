// Rule test for the Odds staff app. ROOT = the repo root; point it at the iOS repo and run: node tests/rules/medicine_checkin_test.js
const ROOT = require("path").resolve(__dirname, "../..");
// node test of src/lib/medicineCheckin.ts: the RPC json parser, the pre-ticked set, the item
// builder (order, dedupe, cap, none), duplicate detection and the labels.
const ts = require(ROOT + '/node_modules/typescript');
const fs = require('fs');
const src = fs.readFileSync(ROOT + '/src/lib/medicineCheckin.ts', 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const m = { exports: {} };
new Function('module', 'exports', 'require', js)(m, m.exports, require);
const M = m.exports;
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };

const rpc = {
  due: true, last_checkin_at: '2026-10-04T05:00:00Z', interval_days: 10,
  prescription: { id: 'rx1', date: '2026-10-04T02:22:37Z', doctor: 'Jasjeet Wasir' },
  qhp: { id: 'q1', date: '2026-10-06' },
  candidates: [
    { name: 'Allegra 120', strength: '120mg', dose_text: '1 BD After food', source: 'doctor', source_date: '2026-10-04T02:22:37Z', origin: { kind: 'consultation', id: 'rx1', line_id: 'm1' }, selected: true },
    { name: 'Thyronorm 125mcg', strength: null, dose_text: null, source: 'qhp', source_date: '2026-10-06', origin: { kind: 'qhp', id: 'q1' }, selected: false },
    { name: 'Vitamin D3', strength: null, dose_text: null, source: 'trainer', source_date: '2026-10-04T05:00:00Z', origin: { kind: 'trainer' }, selected: true },
    { name: '   ', source: 'qhp' },
    null,
  ],
};
const info = M.parseCheckinInfo(rpc);
eq('parse: due', info.due, true);
eq('parse: 3 usable candidates', info.candidates.length, 3);
eq('parse: doctor candidate', [info.candidates[0].name, info.candidates[0].strength, info.candidates[0].dose_text, info.candidates[0].source, info.candidates[0].selected], ['Allegra 120', '120mg', '1 BD After food', 'doctor', true]);
eq('parse: unknown source -> trainer', M.parseCheckinInfo({ candidates: [{ name: 'X', source: 'weird' }] }).candidates[0].source, 'trainer');
eq('parse: prescription + qhp', [info.prescription.doctor, info.qhp.date], ['Jasjeet Wasir', '2026-10-06']);
eq('parse: junk -> null', M.parseCheckinInfo('nope'), null);
eq('parse: placeholders dropped ("Other", "none")', M.parseCheckinInfo({ candidates: [{ name: 'Other', source: 'qhp' }, { name: 'none', source: 'qhp' }, { name: 'Thyronorm 75mcg', source: 'qhp' }] }).candidates.map((c) => c.name), ['Thyronorm 75mcg']);
eq('items: added placeholder ignored', M.buildCheckinItems([], {}, ['Other', 'Dolo 650', 'N/A']).map((i) => i.name), ['Dolo 650']);
eq('placeholder: real name passes', M.isPlaceholderName('Other medicine X'), false);
eq('parse: missing fields default', M.parseCheckinInfo({}), { due: false, last_checkin_at: null, interval_days: 10, prescription: null, qhp: null, candidates: [] });

const ticked = M.initialTicked(info.candidates);
eq('initial ticked = selected', ticked, { 'allegra 120': true, 'thyronorm 125mcg': false, 'vitamin d3': true });

// tick the QHP one too, untick vitamin, add two names (one a duplicate of a candidate, case-insensitive)
const t2 = { ...ticked, 'thyronorm 125mcg': true, 'vitamin d3': false };
const items = M.buildCheckinItems(info.candidates, t2, ['  Dolo  650 ', 'ALLEGRA 120', 'dolo 650', '']);
eq('items: ticked candidates then added, deduped', items.map((i) => `${i.source}:${i.name}`), ['doctor:Allegra 120', 'qhp:Thyronorm 125mcg', 'trainer:Dolo 650']);
eq('items: doctor origin kept', items[0].origin.line_id, 'm1');
eq('items: added has trainer origin', items[2].origin, { kind: 'trainer' });
eq('items: nothing ticked, nothing added -> []', M.buildCheckinItems(info.candidates, {}, []), []);
eq('items: cap 30', M.buildCheckinItems([], {}, Array.from({ length: 40 }, (_, i) => `Med ${i}`)).length, 30);
eq('items: name cut at 120', M.buildCheckinItems([], {}, ['x'.repeat(200)])[0].name.length, 120);

eq('duplicate: candidate', M.isDuplicateName('allegra 120', info.candidates, []), true);
eq('duplicate: added', M.isDuplicateName('Dolo 650', info.candidates, ['dolo  650']), true);
eq('duplicate: fresh', M.isDuplicateName('Crocin', info.candidates, []), false);
eq('duplicate: blank', M.isDuplicateName('  ', info.candidates, []), false);

eq('label doctor', M.sourceLabel(info.candidates[0]), 'DOCTOR · 4 OCT');
eq('label qhp', M.sourceLabel(info.candidates[1]), 'QHP · 6 OCT');
eq('label ticked', M.sourceLabel(info.candidates[2]), 'TICKED · 4 OCT');
eq('label no date', M.sourceLabel({ source: 'qhp', source_date: null }), 'QHP');
eq('last check-in line', M.lastCheckinLine(info), 'Last check-in 4 Oct');
eq('first check-in line', M.lastCheckinLine({ last_checkin_at: null }), 'First check-in');

console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
