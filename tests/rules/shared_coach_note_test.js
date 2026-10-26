// Rule test for the Odds staff app. ROOT = the repo root; point it at the iOS repo and run: node tests/rules/shared_coach_note_test.js
const ROOT = require("path").resolve(__dirname, "../..");
// node test of src/lib/sharedCoachNote.ts (the shared coach note copy, 26 Oct 2026).
const ts = require(ROOT + '/node_modules/typescript');
const fs = require('fs');
const src = fs.readFileSync(ROOT + '/src/lib/sharedCoachNote.ts', 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const m = { exports: {} };
new Function('module', 'exports', 'require', js)(m, m.exports, (n) => { throw new Error('unexpected require ' + n); });
const S = m.exports;
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };

eq('chip none', S.sharedNoteChip(0), 'Shared coach note');
eq('chip one', S.sharedNoteChip(1), '1 shared coach note');
eq('chip many', S.sharedNoteChip(3), '3 shared coach notes');
eq('record line names the client', S.recordLine('Aarav'), 'Injury, pain, discomfort, a movement to avoid, what worked. Every coach who trains Aarav hears this before the session.');
eq('record line without a name', S.recordLine(''), 'Injury, pain, discomfort, a movement to avoid, what worked. Every coach who trains this client hears this before the session.');
eq('listen button', [S.listenButton(1), S.listenButton(2)], ['Listen', 'Listen · 2']);
eq('check-in line', [S.checkinLine('Aarav'), S.checkinLine(null)], ["Listen before you start Aarav session.", 'Listen before you start the session.']);
eq('hints', [S.recordHint('roster'), S.recordHint('sessions')], [
  "Up to 5 notes, 5 minutes each. Shared with every coach of this client; you can add more from Today's Roster.",
  'Up to 5 notes, 5 minutes each. Shared with every coach of this client; you can add more from the Sessions list.']);
// no dashes anywhere in the user-facing copy (standing rule)
const all = Object.values(S).filter((v) => typeof v === 'string').join(' ') + S.recordLine('A') + S.checkinLine('A') + S.recordHint('roster');
eq('no dashes in the copy', /[–—]|\s-\s/.test(all), false);
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
