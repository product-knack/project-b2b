// Rule test for the Odds staff app. ROOT = the repo root; point it at the iOS repo and run: node tests/rules/client_complaints_test.js
const ROOT = require("path").resolve(__dirname, "../..");
// Client complaints (3 Nov 2026): parsing, labels, card lines, filters, counts.
const ts = require(ROOT + '/node_modules/typescript');
const fs = require('fs');
const src = fs.readFileSync(ROOT + '/src/lib/clientComplaints.ts', 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const m = { exports: {} }; new Function('module', 'exports', 'require', js)(m, m.exports, require);
const X = m.exports;
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };

const raw = { session_id: 's1', scheduled_at: '2026-10-28T09:23:37.285Z', session_type: 'Strength', session_name: 'Full body',
  expert: { id: 'e1', name: 'aarti Gupta', role: 'trainer' }, team_manager: { id: 'm1', name: 'Priyanshu Arya' }, client: { id: 'c1', name: 'Anjana Rawat' },
  issues: ['reps', 'bogus'], note: 'I did only 2 sets of each exercise except goblet squats', at: '2026-10-28T13:23:12.169Z', staff: null,
  logged: [{ exercise: 'Goblet Squat', sets: 3, reps: [12, 12, 10], loads: ['20', '20', '20'], duration_seconds: null, notes: null }, { exercise: 'Plank', sets: 2, reps: [null, null], loads: [null, null], duration_seconds: 40, notes: 'hold' }],
  session_notes: null };
const log = X.parseInaccurateLog(raw);
// 1. parsing
eq('log: unknown issues dropped', log.issues, ['reps']);
eq('log: people', [log.expert.name, log.team_manager.name, log.client.name], ['aarti Gupta', 'Priyanshu Arya', 'Anjana Rawat']);
eq('log: bad row', X.parseInaccurateLog({ nope: 1 }), null);
eq('log: missing manager', X.parseInaccurateLog({ ...raw, team_manager: null }).team_manager, null);
const handled = X.parseInaccurateLog({ ...raw, staff: { reviewed_at: '2026-11-03T06:00:00Z', reviewed_by: 'm1', reviewed_by_name: 'Priyanshu Arya', note: 'Spoke to aarti', log_fixed: true } });
eq('log: staff parsed', [handled.staff.log_fixed, handled.staff.reviewed_by_name], [true, 'Priyanshu Arya']);
const rep = X.parseSpecialistReport({ id: 'r1', created_at: '2026-11-01T15:42:00Z', source: 'session_code', client: { id: 'c1', name: 'Riya S' }, expert: { id: 'e2', name: 'Jyoti Sharma', role: 'doctor' }, trainer_name: 'Jyoti Sharma', team_manager: null, session: { id: 'ss', at: '2026-10-28T12:30:00Z', modality: 'Strength' }, note: 'asked me to pay outside', status: 'new', staff: null });
eq('report: parsed', [rep.status, rep.expert.role, rep.session.modality], ['new', 'doctor', 'Strength']);
eq('report: unknown status is new', X.parseSpecialistReport({ id: 'r2', status: 'weird' }).status, 'new');
eq('counts parse', X.parseComplaintCounts({ viewer: 'manager', logs_open: '2', reports_open: 1 }), { viewer: 'manager', logs_open: 2, reports_open: 1 });
eq('counts parse: nobody', X.parseComplaintCounts(null), { viewer: null, logs_open: 0, reports_open: 0 });

// 2. lines
eq('session line', X.sessionLine(log), '28 Oct, 2:53 PM · Strength · Full body');
eq('session line: rehab', X.sessionLine({ scheduled_at: '2026-10-29T08:30:10Z', session_type: 'rehabilitation', session_name: 'Rehab Session' }), '29 Oct, 2:00 PM · Rehabilitation · Rehab Session');
eq('issue chips', X.issueChips(['exercises', 'reps', 'loads', 'duration']), ['EXERCISES', 'REPS', 'LOADS', 'DURATION']);
eq('flagged line', X.flaggedLine('2026-11-02T06:17:52.306Z'), 'Flagged 2 Nov, 11:47 AM');
eq('logged line: reps and one load', X.loggedLine(log.logged[0]), 'Goblet Squat · 3 sets · 12, 12, 10 reps · 20 kg');
eq('logged line: duration', X.loggedLine(log.logged[1]), 'Plank · 2 sets · 40 sec');
eq('logged line: loads per set', X.loggedLine({ exercise: 'Bench Press', sets: 2, reps: [10, 8], loads: ['40', '45'], duration_seconds: null, notes: null }), 'Bench Press · 2 sets · 10, 8 reps · 40, 45 kg');
eq('logged line: no load, missing rep', X.loggedLine({ exercise: 'Push Up', sets: 2, reps: [15, null], loads: ['0', null], duration_seconds: null, notes: null }), 'Push Up · 2 sets · 15, - reps');
eq('logged line: minutes', X.loggedLine({ exercise: 'Bike', sets: 1, reps: [], loads: [], duration_seconds: 600, notes: null }), 'Bike · 1 set · 10 min');
eq('logged block: lines', X.loggedBlock(log).lines.length, 2);
eq('logged block: notes', X.loggedBlock({ logged: [], session_notes: 'Category: Rehab' }), { lines: [], notes: 'Category: Rehab', empty: null });
eq('logged block: empty', X.loggedBlock({ logged: [], session_notes: null }).empty, 'Nothing was logged for this session.');
eq('handled line', X.handledLine(handled.staff), 'Handled by Priyanshu, 3 Nov · log corrected · Spoke to aarti');
eq('handled line: open', X.handledLine(null), null);
eq('handled line: no note, not fixed', X.handledLine({ reviewed_at: '2026-11-03T06:00:00Z', reviewed_by: 'm1', reviewed_by_name: 'Priyanshu Arya', note: null, log_fixed: false }), 'Handled by Priyanshu, 3 Nov');
eq('report status chips', [X.reportStatusChip('new'), X.reportStatusChip('in_review'), X.reportStatusChip('confirmed'), X.reportStatusChip('dismissed')],
  [{ text: 'NEW', tone: 'red' }, { text: 'IN REVIEW', tone: 'amber' }, { text: 'CONFIRMED, MONTH FREE', tone: 'green' }, { text: 'DISMISSED', tone: 'grey' }]);
eq('report expert', X.reportExpert(rep), { name: 'Jyoti Sharma', chip: 'DOCTOR', unmatched: false });
eq('report expert: unmatched', X.reportExpert({ expert: null, trainer_name: 'Some Guy' }), { name: 'Some Guy', chip: 'UNMATCHED', unmatched: true });
eq('report session line: code', X.reportSessionLine(rep), 'Session code line of 28 Oct, 6:00 PM · Strength');
eq('report session line: none', X.reportSessionLine({ session: null, source: 'home' }), null);
eq('report handled line', X.reportHandledLine({ status: 'confirmed', staff: { handled_at: '2026-11-03T06:00:00Z', handled_by: 'h', handled_by_name: 'Anjana Odds', note: 'Verified' } }), 'Confirmed by Anjana, 3 Nov · Verified');
eq('report handled line: new', X.reportHandledLine({ status: 'new', staff: null }), null);
eq('source labels', [X.sourceLabel('session_code'), X.sourceLabel('home'), X.sourceLabel('profile'), X.sourceLabel('page'), X.sourceLabel('x')], ['SESSION CODE', 'HOME', 'PROFILE', 'PAGE', 'APP']);
eq('role chips', [X.roleChip('trainer'), X.roleChip('doctor'), X.roleChip('therapist'), X.roleChip(null)], ['TRAINER', 'DOCTOR', 'THERAPIST', 'EXPERT']);
eq('empty lines', [X.emptyLine('logs', false, 'open'), X.emptyLine('logs', true, 'open'), X.emptyLine('logs', false, 'handled'), X.emptyLine('reports', true, 'open')],
  ['No flagged logs about your team. Nothing flagged since 21 Oct 2026.', 'No flagged logs. Nothing flagged since 21 Oct 2026.', 'No handled flags yet.', 'No reports.']);

// 3. filters and counts
const logs = [log, handled, X.parseInaccurateLog({ ...raw, session_id: 's3', expert: { id: 'e3', name: 'Other', role: 'doctor' }, team_manager: { id: 'm2', name: 'Zed Manager' } })];
const reps = [rep, X.parseSpecialistReport({ id: 'r3', status: 'dismissed', client: { id: 'c', name: 'C' }, expert: null, trainer_name: 'Typed', team_manager: null, staff: { handled_at: null, handled_by: null, handled_by_name: null, note: null } })];
eq('open log / report', [X.isOpenLog(log), X.isOpenLog(handled), X.isOpenReport(rep), X.isOpenReport(reps[1])], [true, false, true, false]);
eq('filter by team', X.filterByTeam(logs, ['e1']).map((l) => l.session_id), ['s1', 's1']);
eq('filter by team: null = all', X.filterByTeam(logs, null).length, 3);
eq('filter by team: no expert', X.filterByTeam(reps, ['e2']).map((r) => r.id), ['r1']);
eq('manager chips', X.managerChips([...logs, ...reps]), [{ id: null, label: 'All managers' }, { id: 'm1', label: 'Priyanshu' }, { id: 'm2', label: 'Zed' }, { id: X.NO_TEAM_ID, label: 'No team' }]);
eq('manager chips: none', X.managerChips([]), [{ id: null, label: 'All managers' }]);
eq('counts', X.countsOf(logs, reps), { logsOpen: 2, reportsOpen: 1, total: 3 });
eq('open line', [X.openLine({ viewer: 'manager', logs_open: 2, reports_open: 1 }), X.openLine(null)], ['3 open', '0 open']);
eq('coded sentence', X.codedComplaintSentence(new Error('COMPLAINT_FORBIDDEN: Only managers can see client complaints.')), 'Only managers can see client complaints.');
eq('coded sentence: other', X.codedComplaintSentence(new Error('Network request failed')), null);

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
