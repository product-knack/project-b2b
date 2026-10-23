// Rule test for the Odds staff app. ROOT = the repo root; point it at the iOS repo and run: node tests/rules/essentials_unsold_test.js
const ROOT = require("path").resolve(__dirname, "../..");
// node test of src/lib/essentialsUnsold.ts (Essentials manager: unsold sessions, window, copy; 22 Oct 2026).
const ts = require(ROOT + '/node_modules/typescript');
const fs = require('fs');
const src = fs.readFileSync(ROOT + '/src/lib/essentialsUnsold.ts', 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const m = { exports: {} };
new Function('module', 'exports', 'require', js)(m, m.exports, require);
const R = m.exports;
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };
const at = (ist) => Date.parse(`2026-10-22T${ist}:00+05:30`);

eq('istParts', R.istParts(at('16:30')), { ymd: '2026-10-22', hm: '16:30' });
eq('istParts across midnight', R.istParts(Date.parse('2026-10-22T19:00:00Z')), { ymd: '2026-10-23', hm: '00:30' });
eq('phase before', R.unsoldPhase(at('16:29')), 'before');
eq('phase open at alert_from', R.unsoldPhase(at('16:30')), 'open');
eq('phase open before close', R.unsoldPhase(at('17:29')), 'open');
eq('phase closed at close', R.unsoldPhase(at('17:30')), 'closed');
eq('phase follows a changed window', R.unsoldPhase(at('15:05'), { alert_from: '15:00', close: '16:00' }), 'open');
eq('hm12', [R.hm12('16:30'), R.hm12('07:00'), R.hm12('00:15'), R.hm12('12:00')], ['4:30 PM', '7:00 AM', '12:15 AM', '12:00 PM']);
eq('minutesToClose', [R.minutesToClose(at('16:30')), R.minutesToClose(at('17:31'))], [60, 0]);
eq('countdown', [R.countdownText(at('16:30')), R.countdownText(at('17:12')), R.countdownText(at('18:00'))], ['1 h 0 min to the close', '18 min to the close', 'Auction closed']);
eq('phaseText before', R.phaseText('before'), 'Unsold sessions appear here from 4:30 PM, one hour before the auction closes at 5:30 PM.');
eq('phaseText closed', R.phaseText('closed'), 'The auction closed at 5:30 PM. Sessions with no bid can be assigned to anyone free one hour either side.');
eq('unsoldLine', R.unsoldLine('Ishita Sheoran', '07:00', 'Strength'), 'Ishita Sheoran · 7:00 AM · Strength');
eq('pushPreview', R.pushPreview({ client_name: 'Ishita Sheoran', slot_time: '07:00', modality: 'Strength' }, '17:30'), 'Ishita Sheoran at 7:00 AM · Strength tomorrow is still unsold in the Essentials Auction. Answer and bid before 5:30 PM.');
const lot = R.parseUnsoldLot({ auction_date: '2026-10-23', client_id: 'c1', client_name: 'Ishita Sheoran', modality: 'Strength', slot_time: '07:00:00', scheduled_for: '2026-10-23T01:30:00Z', preferred_trainer_id: null, preferred_trainer_name: null, bids_count: 0, pushes: [{ score_id: 's1', team_name: 'Team Alpha', pushed_at: '2026-10-22T11:11:00Z', member_count: 6 }] });
eq('parse slot_time cut to HH:MM', lot.slot_time, '07:00');
eq('alreadyPushedTo', [R.alreadyPushedTo(lot, 's1'), R.alreadyPushedTo(lot, 's2')], [true, false]);
eq('pushedLines', R.pushedLines(lot), ['Pushed to Team Alpha at 4:41 PM (6 members)']);
eq('parse empty pushes', R.parseUnsoldLot({ pushes: null }).pushes, []);
eq('parseWindow', [R.parseWindow({ alert_from: '16:30:00', close: '17:30' }), R.parseWindow(null)], [{ alert_from: '16:30', close: '17:30' }, { alert_from: '16:30', close: '17:30' }]);
eq('alert live during the window', R.unsoldAlertLive('2026-10-23', at('16:45')), true);
eq('alert stale after the close', R.unsoldAlertLive('2026-10-23', at('17:45')), false);
eq('alert stale on the training day', R.unsoldAlertLive('2026-10-22', at('09:00')), false);
eq('alert live the day before yesterday... a later date', R.unsoldAlertLive('2026-10-24', at('18:00')), true);
eq('no dashes in copy', /[–—]| - /.test([R.phaseText('before'), R.phaseText('open'), R.phaseText('closed'), R.pushPreview({ client_name: 'A', slot_time: '07:00', modality: 'S' }, '17:30')].join(' ')), false);
// after the close: assign someone free (22 Oct 2026)
const lotT = { scheduled_for: '2026-10-23T01:30:00Z' }; // 7:00 AM IST on the 23rd
eq('assignOpen after the close, before the session', R.assignOpen(lotT, at('18:00')), true);
eq('assignOpen during the window: no', R.assignOpen(lotT, at('17:00')), false);
eq('assignOpen after the session started: no', R.assignOpen(lotT, Date.parse('2026-10-23T07:01:00+05:30')), false);
const st = R.parseFreeStaff({ id: 't1', name: 'Riya Sen', role: 'trainer', is_physio: false, sessions_that_day: 3, nearest_session: '2026-10-23T03:30:00Z', trained_yesterday: true });
eq('parseFreeStaff', [st.name, st.sessions_that_day, st.trained_yesterday], ['Riya Sen', 3, true]);
eq('staffDayLine', [R.staffDayLine(st), R.staffDayLine({ sessions_that_day: 0, nearest_session: null }), R.staffDayLine({ sessions_that_day: 1, nearest_session: null })], ['3 sessions that day · nearest 9:00 AM', 'Free all day', '1 session that day']);
eq('roleLabel', [R.roleLabel({ role: 'doctor', is_physio: true }), R.roleLabel({ role: 'coach', is_physio: false }), R.roleLabel({ role: 'trainer', is_physio: false })], ['Physio', 'Coach', 'Trainer']);
eq('assignPreview', R.assignPreview({ client_name: 'Ishita Sheoran', slot_time: '07:00', modality: 'Strength' }, 'Riya Sen', 'Sagar Sharma'), 'Riya Sen: Ishita Sheoran, 7:00 AM Strength tomorrow, has been assigned to you by Sagar Sharma. It is on your Today’s Roster.'.replace('’', '\x27'));
eq('no dashes in the assign copy', /[–—]| - /.test(R.assignPhaseText() + R.assignPreview({ client_name: 'A', slot_time: '07:00', modality: 'S' }, 'B', null)), false);
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
