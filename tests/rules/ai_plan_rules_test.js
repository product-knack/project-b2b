// Rule test for the Odds staff app. ROOT = the repo root; point it at the iOS repo and run: node tests/rules/ai_plan_rules_test.js
const ROOT = require("path").resolve(__dirname, "../..");
// node test of src/lib/aiPlanDraft.ts: splits, draft -> builder state, source line, alert copy.
const ts = require(ROOT + '/node_modules/typescript');
const fs = require('fs');
const src = fs.readFileSync(ROOT + '/src/lib/aiPlanDraft.ts', 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const m = { exports: {} };
new Function('module', 'exports', 'require', js)(m, m.exports, (n) => { throw new Error('unexpected require ' + n); });
const A = m.exports;
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };

eq('three splits in the owner order', A.SPLITS.map((s) => s.key), ['ppl', 'upper_lower', 'bro']);
eq('ppl sections', A.splitOf('ppl').sections, ['Push', 'Pull', 'Legs']);
eq('upper/lower label and sections', [A.splitOf('upper_lower').label, A.splitOf('upper_lower').sections], ['Full Body (Upper / Lower)', ['Upper Body', 'Lower Body']]);
eq('bro sections', A.splitOf('bro').sections, ['Chest', 'Back', 'Shoulders', 'Arms', 'Legs']);
eq('unknown split', A.splitOf('x'), null);

const draft = {
  plan_name: 'Preeti · Push / Pull / Legs · Oct 2026', description: 'Low-impact plan.', split: 'ppl', split_label: 'Push / Pull / Legs', sessions_per_week: 2,
  sections: [
    { name: 'Push', exercises: [
      { name: 'Arm Circles', measurement: 'reps', sets: [{ reps: 12, duration: null, rest: 45, tempo: null, rir: 0, note: 'Easy' }, { reps: 12, duration: null, rest: 45, tempo: null, rir: 0, note: null }] },
      { name: 'Chest Press Machine', measurement: 'reps', sets: [{ reps: 12, duration: null, rest: 60, tempo: '3-1-1-0', rir: 3, note: null }] },
    ] },
    { name: 'Pull', exercises: [] },
    { name: 'Conditioning', exercises: [{ name: 'Elliptical Training', measurement: 'duration', sets: [{ reps: 99, duration: '5 min', rest: 60, tempo: null, rir: 2, note: null }] }] },
  ],
  rationale: ['QHP 16 Jul: knee pain'], avoided: ['Barbell Squats'],
};
const bp = A.draftToBodyParts(draft);
eq('sections kept in order, empty ones too', bp.map((b) => [b.body_part, b.exercises.length]), [['Push', 2], ['Pull', 0], ['Conditioning', 1]]);
eq('reps set as form strings, load empty', bp[0].exercises[1].sets[0], { load: '', reps: '12', duration: '', rest: '60', tempo: '3-1-1-0', rm: '', rir: '3', ss: '', notes: '' });
eq('note goes to notes', bp[0].exercises[0].sets[0].notes, 'Easy');
eq('duration exercise: duration kept, reps and rir blank', bp[2].exercises[0].sets[0], { load: '', reps: '', duration: '5 min', rest: '60', tempo: '', rm: '', rir: '', ss: '', notes: '' });
eq('measurement carried', bp[2].exercises[0].measurement, 'duration');
eq('exercise with no sets gets one empty set', A.draftToBodyParts({ ...draft, sections: [{ name: 'Legs', exercises: [{ name: 'Leg Curl', measurement: 'reps', sets: [] }] }] })[0].exercises[0].sets.length, 1);
eq('empty draft keeps one blank section', A.draftToBodyParts({ ...draft, sections: [] }), [{ body_part: '', exercises: [] }]);
eq('exercise count', A.draftExerciseCount(draft), 3);

eq('source line full', A.sourcesLine({ qhp_date: '2026-07-16', blood_date: '2026-06-29', blood_flags: 34, medical_items: 2, health_context: true }), 'QHP of 16 Jul · blood report of 29 Jun (34 out of range) · 2 medical records · health context');
eq('source line no QHP', A.sourcesLine({ qhp_date: null, blood_date: null, blood_flags: 0, medical_items: 0, health_context: false }), 'no QHP on file');
eq('shouldFill empty', A.shouldFill('  ', null), true);
eq('shouldFill own text', A.shouldFill('My plan', 'AI name'), false);
eq('shouldFill previous AI text', A.shouldFill('AI name', 'AI name'), true);

const NOW = Date.parse('2026-10-16T09:00:00Z'); // 2:30 PM IST, 16 Oct
eq('when today', A.whenLabel('2026-10-16T11:30:00Z', NOW), 'today 5:00 PM');
eq('when tomorrow', A.whenLabel('2026-10-17T11:30:00Z', NOW), 'tomorrow 5:00 PM');
eq('when later', A.whenLabel('2026-10-18T11:00:00Z', NOW), 'Sun 18 Oct, 4:30 PM');
const gap = { client_id: 'c', client_name: 'Preeti Ch.', next_session_at: '2026-10-17T11:30:00Z', next_modality: 'Strength', sessions_upcoming: 1, plan_state: 'none', review_plan_id: null, review_plan_name: null, review_since: null, review_by_me: null, last_approved_at: null };
eq('alert none', A.gapCopy(gap, NOW), { title: "Make Preeti's workout plan", line: 'Essentials Strength tomorrow 5:00 PM · no valid plan · Odds AI can draft it', action: 'Create with AI', tone: 'red' });
eq('alert expired plan', A.gapCopy({ ...gap, last_approved_at: '2026-08-20T06:00:00Z' }, NOW).line, 'Essentials Strength tomorrow 5:00 PM · last plan expired 1 Oct · Odds AI can draft it');
eq('alert in review by me', A.gapCopy({ ...gap, plan_state: 'in_review', review_plan_name: 'Preeti · PPL', review_by_me: true }, NOW), { title: "Preeti's plan is waiting for approval", line: 'Preeti · PPL · Essentials Strength tomorrow 5:00 PM', action: null, tone: 'amber' });
eq('alert in review by another trainer', A.gapCopy({ ...gap, plan_state: 'in_review', review_plan_name: 'X', review_by_me: false }, NOW).line, 'X · sent by another trainer · Essentials Strength tomorrow 5:00 PM');
eq('alert needs changes', A.gapCopy({ ...gap, plan_state: 'needs_revision', review_plan_name: 'X' }, NOW), { title: "Preeti's plan needs changes", line: 'The coach sent X back · Essentials Strength tomorrow 5:00 PM', action: 'Open the plan', tone: 'red' });


/* NOT IN DB exercises (16 Oct 2026) */
const draft2 = { ...draft, sections: [
  { name: 'Push', exercises: [
    { name: 'Pallof Press', measurement: 'reps', group: 'Core', in_db: false, equipment: 'Cable', modality: 'Strength', sets: [{ reps: 12, duration: null, rest: 60, tempo: null, rir: 2, note: null }] },
    { name: 'Chest Press Machine', measurement: 'reps', group: 'Chest', in_db: true, sets: [{ reps: 10, duration: null, rest: 90, tempo: null, rir: 2, note: null }] },
  ] },
  { name: 'Conditioning', exercises: [{ name: 'Sled Push', measurement: 'duration', group: 'Full Body', in_db: false, equipment: 'Sled', sets: [{ reps: null, duration: '30 sec', rest: 60, tempo: null, rir: null, note: null }] }] },
] };
const bp2 = A.draftToBodyParts(draft2);
eq('new exercise carries notInDb', bp2[0].exercises[0].notInDb, { muscle_group: 'Core', equipment: 'Cable', modality: 'Strength' });
eq('library exercise has no notInDb key', 'notInDb' in bp2[0].exercises[1], false);
eq('conditioning new exercise defaults to Cardio', bp2[1].exercises[0].notInDb.modality, 'Cardio');
eq('draftNewExercises', A.draftNewExercises(draft2), ['Pallof Press', 'Sled Push']);
eq('draftNewExercises none', A.draftNewExercises(draft), []);

// Build mode and the registry marker (21 Oct 2026)
eq('ai prompt line: split and note, whitespace squeezed', A.aiPromptLine('Push / Pull / Legs', '  no machines at home,  wants to focus on posture '), 'Push / Pull / Legs · no machines at home, wants to focus on posture');
eq('ai prompt line: split only', A.aiPromptLine('Bro split', ''), 'Bro split');
eq('ai prompt line: null note', A.aiPromptLine('Full Body (Upper / Lower)', null), 'Full Body (Upper / Lower)');
eq('ai choice: needs a client', A.aiChoice({ online: true, clientId: null, modality: null, allowed: null }), { enabled: false, reason: 'Pick the client first' });
eq('ai choice: offline', A.aiChoice({ online: false, clientId: 'c', modality: null, allowed: true }), { enabled: false, reason: 'Needs a connection' });
eq('ai choice: yoga stays manual', A.aiChoice({ online: true, clientId: 'c', modality: 'Yoga', allowed: true }), { enabled: false, reason: 'Strength Training plans only for now' });
eq('ai choice: refused by the server', A.aiChoice({ online: true, clientId: 'c', modality: null, allowed: false }), { enabled: false, reason: 'Not available for this client' });
eq('ai choice: open while the preview loads', A.aiChoice({ online: true, clientId: 'c', modality: null, allowed: null }), { enabled: true, reason: null });
eq('ai choice: ok', A.aiChoice({ online: true, clientId: 'c', modality: 'Strength Training', allowed: true }), { enabled: true, reason: null });
eq('source: a draft applied then edited is still ai', A.planSource(true), 'ai');
eq('source: hand built', A.planSource(false), 'human');
eq('no dashes in the choice copy', ['Pick the client first', 'Needs a connection', 'Strength Training plans only for now', 'Not available for this client'].some((s) => s.includes('—')), false);
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
