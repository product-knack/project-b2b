// Rule test for the Odds staff app. ROOT = the repo root; point it at the iOS repo and run: node tests/rules/crew_plan_message_test.js
const ROOT = require("path").resolve(__dirname, "../..");
// My Crew "Add session" (21 Nov 2026): the chat message that could not be sent is kept in the offline outbox.
// The label, what is safe to queue, the words said to the manager.
const ts = require(ROOT + '/node_modules/typescript');
const fs = require('fs');
const src = fs.readFileSync(ROOT + '/src/lib/crewPlanMessage.ts', 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const m = { exports: {} }; new Function('module', 'exports', 'require', js)(m, m.exports, require);
const P = m.exports;
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };

const payload = { date: '2026-11-21', client_id: 'c1', name: 'Asad Hussain', trainer_id: 't1', time: '12:30', modality: 'Strength', schedule_id: 's1' };
const body = "Manager added Asad Hussain at 12:30 PM · Strength to Sagar's plan (21 NOV)";

eq('label', P.crewPlanMessageLabel(payload), 'My Crew: Asad Hussain at 12:30 PM');
eq('label in the morning', P.crewPlanMessageLabel({ name: 'A', time: '08:05' }), 'My Crew: A at 8:05 AM');
eq('label at midnight and noon', [P.crewPlanMessageLabel({ name: 'A', time: '00:15' }), P.crewPlanMessageLabel({ name: 'A', time: '12:00' })], ['My Crew: A at 12:15 AM', 'My Crew: A at 12:00 PM']);
eq('label without a name', P.crewPlanMessageLabel({ name: ' ', time: '12:30' }), 'My Crew: Client at 12:30 PM');
eq('label with an odd time keeps it as written', P.crewPlanMessageLabel({ name: 'A', time: 'noon' }), 'My Crew: A at noon');

eq('the item kept on the phone', P.crewPlanMessageItem('team1', 'me1', payload, `  ${body}  `), { teamId: 'team1', senderId: 'me1', kind: 'plan_add', payload, body });
eq('nothing is queued without a team', P.crewPlanMessageItem(null, 'me1', payload, body), null);
eq('nothing is queued without a sender', P.crewPlanMessageItem('team1', '', payload, body), null);
eq('nothing is queued without the roster row id (a later send could not be told from a second one)', P.crewPlanMessageItem('team1', 'me1', { ...payload, schedule_id: null }, body), null);
eq('nothing is queued without words', P.crewPlanMessageItem('team1', 'me1', payload, '  '), null);

eq('title', P.CREW_ADD_SAVED_TITLE, 'Session added');
eq('queued words name the client and say what happens next', /^Asad Hussain's session is on the roster\./.test(P.crewAddQueuedText('Asad Hussain')) && /sent by itself/.test(P.crewAddQueuedText('Asad Hussain')), true);
eq('not queued words say to tell the tech team', /Tell the tech team\.$/.test(P.crewAddNotQueuedText('Asad Hussain')), true);
const copy = [P.CREW_ADD_SAVED_TITLE, P.crewAddQueuedText('A'), P.crewAddNotQueuedText('A'), P.crewPlanMessageLabel(payload)].join(' ');
eq('no dashes in the copy', /[–—]/.test(copy), false);

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
