// Rule test for the Odds staff app. ROOT = the repo root; point it at the iOS repo and run: node tests/rules/plan_cover_test.js
const ROOT = require("path").resolve(__dirname, "../..");
// Expired-plan gate on My Crew roster making (27 Oct 2026): the server answer reader, the verdict per row, the
// copy, the Create Plan modality mapping.
const ts = require(ROOT + '/node_modules/typescript');
const fs = require('fs');
const src = fs.readFileSync(ROOT + '/src/lib/planCover.ts', 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const m = { exports: {} }; new Function('module', 'exports', 'require', js)(m, m.exports, require);
const P = m.exports;
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };

// 1. modality keys match the SQL
eq('key Strength Training', P.modalityKey('Strength Training'), 'strength');
eq('key Aqua Aerobics', P.modalityKey('Aqua Aerobics'), 'aquaaerobics');
eq('key null', P.modalityKey(null), '');

// 2. parse
const rows = [
  { client_id: 'c1', modality_key: 'strength', modality_label: 'Strength', state: 'expired', enforced: true, blocked: true, expires_at: '2026-10-20T04:30:00+00:00', last_approved_at: '2026-09-08T04:30:00+00:00', review_state: null, review_plan_id: null },
  { client_id: 'c1', modality_key: 'yoga', modality_label: 'Yoga', state: 'valid', enforced: true, blocked: false, expires_at: '2026-12-01T04:30:00+00:00', last_approved_at: null, review_state: 'in_review', review_plan_id: 'p9' },
  { client_id: 'c2', modality_key: 'strength', modality_label: 'Strength', state: 'expired', enforced: false, blocked: false, expires_at: null, last_approved_at: null, review_state: 'bogus', review_plan_id: null },
  { client_id: null, modality_key: 'strength' },
];
const map = P.parsePlanCover(rows);
eq('parse: two clients', Object.keys(map).sort(), ['c1', 'c2']);
eq('parse: c1 strength blocked', map.c1.strength.blocked, true);
eq('parse: bogus review state is null', map.c2.strength.reviewState, null);
eq('parse: not an array', P.parsePlanCover(null), {});

// 3. verdicts
eq('verdict: expired Strength blocks', P.coverFor(map, 'c1', 'Strength').blocked, true);
eq('verdict: the label form also matches', P.coverFor(map, 'c1', 'Strength Training').blocked, true);
eq('verdict: valid Yoga passes', P.coverFor(map, 'c1', 'Yoga').blocked, false);
eq('verdict: never planned Pilates passes', P.coverFor(map, 'c1', 'Pilates').blocked, false);
eq('verdict: Essentials (not enforced) passes', P.coverFor(map, 'c2', 'Strength').blocked, false);
eq('verdict: no modality yet passes', P.coverFor(map, 'c1', null).blocked, false);
eq('verdict: no map passes', P.coverFor(null, 'c1', 'Strength').blocked, false);

// 4. copy
const now = Date.parse('2026-10-27T10:00:00+05:30');
eq('line: already expired', P.coverBlockedLine({ clientFirst: 'Aarav', modalityLabel: 'Strength', expiresAt: '2026-10-20T04:30:00+00:00', nowMs: now }),
  "Aarav's Strength plan expired on 20 Oct 2026. Make a new plan and get it approved before you add this session.");
eq('line: expires before the session', P.coverBlockedLine({ clientFirst: 'Aarav', modalityLabel: 'Strength', expiresAt: '2026-10-28T16:30:00+00:00', nowMs: now }),
  "Aarav's Strength plan expires on 28 Oct 2026, before this session. Make a new plan and get it approved before you add this session.");
eq('review line: in review', P.coverReviewLine('Strength', 'in_review'), 'A new Strength plan is waiting for approval. The session can be added once it is approved.');
eq('review line: none', P.coverReviewLine('Strength', null), null);
eq('kicker', [P.coverKicker(null), P.coverKicker('in_review'), P.coverKicker('needs_revision')], ['PLAN EXPIRED', 'PLAN WAITING FOR APPROVAL', 'PLAN NEEDS CHANGES']);
eq('action', [P.coverAction(null), P.coverAction('in_review'), P.coverAction('needs_revision')], ['create', null, 'revise']);
eq('send blocked', P.coverSendBlockedText(['Aarav', 'Meera']), 'Aarav, Meera: the plan has expired for that day. Make a new plan and get it approved first, or pick a modality that has a valid plan.');
eq('server refused', P.coverServerRefusedText({ clientFirst: 'Aarav', modality: 'Strength', expiresAt: '2026-10-28T16:30:00+00:00' }),
  "Aarav's Strength plan expires on 28 Oct 2026. The session was not added to the roster. Make a new plan and get it approved, then retry.");
eq('result flag', [P.isPlanExpiredResult({ result: 'plan_expired' }), P.isPlanExpiredResult({ result: 'created' }), P.isPlanExpiredResult(null)], [true, false, false]);
eq('missing function', [P.isPlanCoverMissing('PGRST202: Could not find the function public.get_plan_cover'), P.isPlanCoverMissing('permission denied')], [true, false]);

// 5. Create Plan modality
eq('plan modality: Strength', P.planModalityFor('Strength'), 'Strength Training');
eq('plan modality: Aqua Aerobics', P.planModalityFor('Aqua Aerobics'), 'Aqua Aerobics');
eq('plan modality: Rehabilitation', P.planModalityFor('Rehabilitation'), null);

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
