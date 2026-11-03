// Rule test for the Odds staff app. ROOT = the repo root; point it at the iOS repo and run: node tests/rules/health_summary_rules_test.js
const ROOT = require("path").resolve(__dirname, "../..");
// node test of src/lib/clientHealthSummary.ts (pure rules: gate, new-since, duration, split).
const ts = require(ROOT + '/node_modules/typescript');
const fs = require('fs');
const src = fs.readFileSync(ROOT + '/src/lib/clientHealthSummary.ts', 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const m = { exports: {} };
new Function('module', 'exports', 'require', js)(m, m.exports, require);
const R = m.exports;
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };
const ME = 'me', OTHER = 'other';
const row = (over = {}) => ({
  client_id: 'c',
  weekly_summary: { script: 'Over the last seven days the client did three sessions. Sleep averaged seven hours.', highlights: ['3 sessions'] },
  weekly_generated_at: '2026-10-08T18:29:00Z', // 11:59 PM IST on 8 Oct
  context_summary: { script: 'Blood pressure improved. For anything clinical, please check the doctor consultation notes.', improved: [{}], worsened: [], watch: [{}, {}] },
  context_generated_at: '2026-10-05T04:00:00Z',
  context_dirty: false,
  listen_history: [],
  ...over,
});
const NOW = new Date('2026-10-09T05:00:00Z').getTime(); // 10:30 AM IST, 9 Oct
// gate: never listened
eq('never listened -> both due', R.listenGate(row(), ME, NOW), { weekly: 'due', context: 'due' });
// weekly heard today after the build, context heard after its build
const okHist = [{ at: '2026-10-09T02:00:00Z', by: ME, which: 'weekly' }, { at: '2026-10-06T02:00:00Z', by: ME, which: 'context' }];
eq('heard today + context up to date -> done', R.listenGate(row({ listen_history: okHist }), ME, NOW), { weekly: 'done', context: 'done' });
eq('gateDue false when done', R.gateDue({ weekly: 'done', context: 'done' }), false);
// weekly heard yesterday (before the nightly build) -> due
eq('weekly heard before nightly build -> due', R.gateStateFor(row({ listen_history: [{ at: '2026-10-08T10:00:00Z', by: ME, which: 'weekly' }] }), 'weekly', ME, NOW), 'due');
// weekly heard yesterday 11:59:30 PM IST (after build) but not today -> due (daily rule)
eq('weekly heard after build but yesterday -> due', R.gateStateFor(row({ listen_history: [{ at: '2026-10-08T18:29:30Z', by: ME, which: 'weekly' }] }), 'weekly', ME, NOW), 'due');
// context heard before its rebuild -> due; another person's listen never counts
eq('context heard before rebuild -> due', R.gateStateFor(row({ listen_history: [{ at: '2026-10-04T10:00:00Z', by: ME, which: 'context' }] }), 'context', ME, NOW), 'due');
eq('someone else heard -> still due for me', R.gateStateFor(row({ listen_history: [{ at: '2026-10-09T02:00:00Z', by: OTHER, which: 'weekly' }] }), 'weekly', ME, NOW), 'due');
// nothing to hear
// 24 Oct 2026: the server carries a context listen from an earlier day (carried: true) and the
// nightly build keeps the context's generated_at until a real update.
const carried = { at: '2026-10-06T02:00:00Z', by: ME, which: 'context', carried: true, briefing_date: '2026-10-06' };
eq('carried context listen after the build -> done', R.gateStateFor(row({ listen_history: [carried] }), 'context', ME, NOW), 'done');
eq('carried listen never satisfies the weekly', R.gateStateFor(row({ listen_history: [carried] }), 'weekly', ME, NOW), 'due');
eq('context rebuilt after the carried listen -> due', R.gateStateFor(row({ listen_history: [carried], context_generated_at: '2026-10-08T10:00:00Z' }), 'context', ME, NOW), 'due');
// 27 Oct 2026: the rule written once, shown everywhere
eq('rule line context due', R.listenRuleLine('context', 'due', 'Aarav Mehra'), 'Listen to this at least once. It changed since you last heard it. You cannot log a workout for Aarav until you do.');
eq('rule line weekly due', R.listenRuleLine('weekly', 'due', null), "Listen to this at least once today. You cannot log this client's workout until you do.");
eq('rule line done / none', [R.listenRuleLine('weekly', 'done', 'A'), R.listenRuleLine('context', 'none', 'A')], ['Heard after the latest update. You can log.', null]);
eq('header text', [R.listenHeaderText({ weekly: 'due', context: 'done' }), R.listenHeaderText({ weekly: 'done', context: 'none' })], ['NOT HEARD · LISTEN NOW', 'CLIENT SUMMARIES']);
eq('listen now line', R.listenNowLine('Aarav Mehra'), "You have not heard Aarav's summaries. You cannot log tomorrow's session without this. Listen now.");
const st = { client_id: 'c', has_weekly: true, has_context: true, weekly_generated_at: '2026-10-08T18:29:00Z', context_generated_at: '2026-10-05T04:00:00Z', my_last_weekly_at: '2026-10-09T02:00:00Z', my_last_context_at: '2026-10-06T02:00:00Z' };
eq('gate from status: both done', R.gateFromStatus(st, NOW), { weekly: 'done', context: 'done' });
eq('gate from status: weekly heard yesterday -> due, context never -> due', R.gateFromStatus({ ...st, my_last_weekly_at: '2026-10-08T18:29:30Z', my_last_context_at: null }, NOW), { weekly: 'due', context: 'due' });
eq('gate from status: nothing built -> none', R.gateFromStatus({ ...st, has_weekly: false, has_context: false }, NOW), { weekly: 'none', context: 'none' });
eq('gate from status: missing row -> none', R.gateFromStatus(null, NOW), { weekly: 'none', context: 'none' });
eq('no weekly script -> none', R.gateStateFor(row({ weekly_summary: null, weekly_generated_at: null }), 'weekly', ME, NOW), 'none');
eq('empty script -> none', R.gateStateFor(row({ context_summary: { script: '  ' } }), 'context', ME, NOW), 'none');
eq('no row -> none/none', R.listenGate(null, ME, NOW), { weekly: 'none', context: 'none' });
eq('gateDue with one due', R.gateDue({ weekly: 'none', context: 'due' }), true);
// generated_at falls back to the json
eq('generatedAt falls back to json', R.generatedAtOf(row({ weekly_generated_at: null, weekly_summary: { script: 'x', generated_at: '2026-10-01T00:00:00Z' } }), 'weekly'), '2026-10-01T00:00:00Z');
// new since you listened
eq('isNewSince never listened', R.isNewSince(row(), 'weekly', ME), true);
eq('isNewSince heard after build', R.isNewSince(row({ listen_history: okHist }), 'weekly', ME), false);
eq('isNewSince no uid', R.isNewSince(row({ listen_history: okHist }), 'weekly', null), true);
// last listens
eq('lastListen newest of kind', R.lastListen([{ at: '1', by: 'a', which: 'weekly' }, { at: '2', by: 'b', which: 'context' }, { at: '3', by: 'c', which: 'weekly' }], 'weekly').by, 'c');
eq('myLastListen mine only', R.myLastListen([{ at: '1', by: ME, which: 'weekly' }, { at: '3', by: OTHER, which: 'weekly' }], 'weekly', ME).at, '1');
// duration + words
eq('durationText 67 words', R.durationText(Array(67).fill('w').join(' ')), '28 sec');
eq('durationText 283 words', R.durationText(Array(283).fill('w').join(' ')), '1 min 58 sec');
eq('scriptWords empty', R.scriptWords('  '), 0);
// IST day + stamp
eq('istDayOf 18:29Z is 8 Oct IST', R.istDayOf('2026-10-08T18:29:00Z'), '2026-10-08');
eq('istDayOf 18:31Z is 9 Oct IST', R.istDayOf('2026-10-08T18:31:00Z'), '2026-10-09');
eq('fmtStamp', R.fmtStamp('2026-10-09T09:46:14Z'), '9 Oct, 3:16 pm');
eq('fmtStamp empty', R.fmtStamp(null), '');
// split for speech
const long = Array(12).fill('This is a sentence that is fairly long and ends properly.').join(' ');
const parts = R.splitForSpeech(long, 200);
eq('split: every part within max', parts.every((p) => p.length <= 200), true);
eq('split: joins back to the text', parts.join(' ').replace(/\s+/g, ' '), long.replace(/\s+/g, ' '));
eq('split: short text untouched', R.splitForSpeech('Hello there.', 200), ['Hello there.']);
eq('split: empty', R.splitForSpeech('   ', 200), []);
eq('split: one over-long sentence is cut', R.splitForSpeech('a'.repeat(450), 200).map((p) => p.length), [200, 200, 50]);

// The Add Workout listen sheet (22 Oct 2026): the second Play no longer closes the sheet, only a play to the end counts.
const both = { weekly: 'due', context: 'due' };
const none = { weekly: false, context: false };
eq('sheet: due, not armed yet', R.listenSheetUp({ done: false, armed: false, eligible: true, due: true }), true);
eq('sheet: the refreshed row reads done after Play, but armed keeps it up', R.listenSheetUp({ done: false, armed: true, eligible: true, due: false }), true);
eq('sheet: armed stays up through a network blip', R.listenSheetUp({ done: false, armed: true, eligible: false, due: false }), true);
eq('sheet: Proceed tapped closes it', R.listenSheetUp({ done: true, armed: true, eligible: true, due: true }), false);
eq('sheet: nothing due, never armed', R.listenSheetUp({ done: false, armed: false, eligible: true, due: false }), false);
eq('sheet: not eligible (editing a queued log, offline at open)', R.listenSheetUp({ done: false, armed: false, eligible: false, due: true }), false);
eq('heard: nothing heard, both due', R.listenAllHeard(both, none), false);
eq('heard: first heard to the end only', R.listenAllHeard(both, { weekly: true, context: false }), false);
eq('heard: Play tapped on the second (row now says done) is not enough: atOpen still says due', R.listenStillNeeded(both, { weekly: true, context: false }, 'context'), true);
eq('heard: both heard to the end', R.listenAllHeard(both, { weekly: true, context: true }), true);
eq('heard: only the weekly was due at open', R.listenAllHeard({ weekly: 'due', context: 'done' }, { weekly: true, context: false }), true);
eq('heard: a missing summary is never required', R.listenAllHeard({ weekly: 'none', context: 'due' }, { weekly: false, context: true }), true);
eq('button copy', [R.LISTEN_PROCEED, R.LISTEN_WAIT], ['Proceed to workout', 'Listen first']);
// Tomorrow's Plan row chips (30 Oct 2026): the chip shows when any summary exists; the short label for crowded rows
eq('listen chip shown: both built', R.listenChipShown(st, NOW), true);
eq('listen chip hidden: nothing built', R.listenChipShown({ ...st, has_weekly: false, has_context: false }, NOW), false);
eq('listen chip shown: only the context built', R.listenChipShown({ ...st, has_weekly: false }, NOW), true);
eq('short label', R.LISTEN_CHIP_DUE_SHORT, 'NOT HEARD');

/* ---- listen progress (3 Nov 2026): heard only from 95 percent; legacy plays count; offline record merges ---- */
eq('legacy entry (no percent) is heard at 100', [R.entryHeard({ at: 'x', by: ME, which: 'weekly' }), R.entryPercent({ at: 'x', by: ME, which: 'weekly' })], [true, 100]);
eq('94 is not heard, 95 is', [R.entryHeard({ at: 'x', by: ME, which: 'weekly', percent: 94 }), R.entryHeard({ at: 'x', by: ME, which: 'weekly', percent: 95 })], [false, true]);
const playedToday = [{ at: '2026-10-09T02:00:00Z', by: ME, which: 'weekly', percent: 40, heard: false }, { at: '2026-10-06T02:00:00Z', by: ME, which: 'context', percent: 30, heard: false }];
eq('a Play stopped at 40 and 30 percent leaves both due', R.listenGate(row({ listen_history: playedToday }), ME, NOW), { weekly: 'due', context: 'due' });
const heardToday = [{ at: '2026-10-09T02:00:00Z', by: ME, which: 'weekly', percent: 97, heard: true, heard_at: '2026-10-09T02:05:00Z' }, { at: '2026-10-06T02:00:00Z', by: ME, which: 'context', percent: 100, heard: true }];
eq('97 percent today and 100 percent context are done', R.listenGate(row({ listen_history: heardToday }), ME, NOW), { weekly: 'done', context: 'done' });
eq('my progress: best percent of the current build', R.myProgress(row({ listen_history: [{ at: '2026-10-09T01:00:00Z', by: ME, which: 'weekly', percent: 20 }, { at: '2026-10-09T02:00:00Z', by: ME, which: 'weekly', percent: 60 }, { at: '2026-10-07T02:00:00Z', by: ME, which: 'weekly', percent: 100 }] }), 'weekly', ME), 60);
eq('my progress: someone else does not count', R.myProgress(row({ listen_history: [{ at: '2026-10-09T02:00:00Z', by: OTHER, which: 'weekly', percent: 100 }] }), 'weekly', ME), 0);
const localHeard = { clientId: 'c', which: 'weekly', version: null, generatedAt: '2026-10-08T18:29:00Z', briefingDate: null, percent: 96, heard: true, heardAt: '2026-10-09T03:00:00Z', at: '2026-10-09T02:50:00Z', synced: false };
eq('offline record heard today clears the weekly gate', R.listenGate(row(), ME, NOW, { weekly: localHeard }).weekly, 'done');
eq('offline record for another build does not', R.listenGate(row(), ME, NOW, { weekly: { ...localHeard, generatedAt: '2026-10-07T18:29:00Z' } }).weekly, 'due');
eq('offline record at 50 does not', R.listenGate(row(), ME, NOW, { weekly: { ...localHeard, percent: 50, heard: false, heardAt: null } }).weekly, 'due');
eq('merged progress takes the higher of server and phone', R.mergedProgress(row({ listen_history: [{ at: '2026-10-09T02:00:00Z', by: ME, which: 'weekly', percent: 40 }] }), 'weekly', ME, { ...localHeard, percent: 70, heard: false }), 70);
eq('progress lines', [R.progressLine(60), R.progressLine(95), R.progressLine(100)], ['You: 60 percent heard', 'Heard 100 percent, you can log.', 'Heard 100 percent, you can log.']);
eq('alert sentence', R.LISTEN_100_ALERT, 'Listen to 100 percent now, so you do not have to listen again when you log the session.');
// the batched status with the new columns
const stNew = { ...st, my_last_weekly_at: '2026-10-09T02:00:00Z', my_weekly_percent: 40, my_weekly_heard: false, my_weekly_heard_at: null, my_context_percent: 100, my_context_heard: true, my_context_heard_at: '2026-10-06T02:00:00Z', my_last_context_at: '2026-10-06T02:00:00Z' };
eq('status: a 40 percent play today is due, the heard context is done', R.gateFromStatus(stNew, NOW), { weekly: 'due', context: 'done' });
eq('status: old server without heard columns falls back to the last play', R.gateFromStatus({ ...st, my_last_weekly_at: '2026-10-09T02:00:00Z', my_last_context_at: '2026-10-06T02:00:00Z' }, NOW), { weekly: 'done', context: 'done' });
eq('status: the phone record clears it', R.gateFromStatus(stNew, NOW, { weekly: localHeard }).weekly, 'done');
eq('chip: 40 percent due reads FINISH', R.listenChipText({ weekly: 'due', context: 'done' }, { weekly: 40, context: 100 }), { text: '40 PERCENT · FINISH', tone: 'amber' });
eq('chip: nothing played reads NOT HEARD', R.listenChipText({ weekly: 'due', context: 'due' }, { weekly: 0, context: 0 }, true), { text: 'NOT HEARD', tone: 'red' });
eq('chip: all heard', R.listenChipText({ weekly: 'done', context: 'done' }, { weekly: 100, context: 100 }), { text: 'HEARD 100', tone: 'green' });
eq('status percent merges the phone record', R.statusPercent(stNew, 'weekly', { weekly: { ...localHeard, percent: 80, heard: false } }), 80);
// the crew block
const crewRows = [
  { client_id: 'c', which: 'weekly', by: 'm1', by_name: 'Sagar Sharma', role: 'trainer', percent: 100, heard: true, at: null, version: 5 },
  { client_id: 'c', which: 'context', by: 'm1', by_name: 'Sagar Sharma', role: 'trainer', percent: 40, heard: false, at: null, version: 2 },
  { client_id: 'c', which: 'weekly', by: 'x9', by_name: 'Dr Who', role: 'doctor', percent: 97, heard: true, at: null, version: 5 },
  { client_id: 'other', which: 'weekly', by: 'm2', by_name: 'Priya', role: 'trainer', percent: 100, heard: true, at: null, version: 5 },
];
const lines = R.crewListenLines(crewRows, 'c', [{ id: 'm1', name: 'Sagar Sharma' }, { id: 'm2', name: 'Priya Singh' }]);
eq('crew lines: every member listed, others separate', [lines.crew.map((l) => l.name), lines.others.map((l) => l.name)], [['Priya Singh', 'Sagar Sharma'], ['Dr Who']]);
eq('crew line text: Sagar', R.crewLineText(lines.crew[1]), 'This week 100 percent · Health context 40 percent');
eq('crew line text: Priya never played this client', R.crewLineText(lines.crew[0]), 'This week 0 percent · Health context 0 percent');
eq('crew line text: 97 reads as 100 (heard)', R.crewLineText(lines.others[0]), 'This week 100 percent · Health context 0 percent');
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
