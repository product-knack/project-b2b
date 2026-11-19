// Rule test for the Odds staff app. ROOT = the repo root; point it at the iOS repo and run: node tests/rules/crm_session_logs_test.js
const ROOT = require("path").resolve(__dirname, "../..");
// CRM Session Logs (19 Nov 2026): parsing crm_daily_sessions, counts, progress, filter and search, the paid
// cancellation code rule, IST dates, the copy.
const ts = require(ROOT + '/node_modules/typescript');
const fs = require('fs');
const src = fs.readFileSync(ROOT + '/src/lib/crmSessionLogs.ts', 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const m = { exports: {} }; new Function('module', 'exports', 'require', js)(m, m.exports, require);
const S = m.exports;
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };

const raw = (o) => ({ id: 'x', scheduled_at: '2026-11-19T01:00:00+00:00', client_name: 'Nidhi Arora', trainer_name: 'Ziaur Rehman', modality: 'Strength', row_status: 'completed', unlinked: false, logged_at: '2026-11-19T02:43:00+00:00', otp: true, paid_cancellation_code: '4821', paid_cancel_verified_at: null, ...o });
const rows = S.parseSessionLogs([
  raw({ id: 'c', scheduled_at: '2026-11-19T03:00:00Z', row_status: 'scheduled', logged_at: null, client_name: 'Nitibha Kaul', modality: 'Pilates', trainer_name: 'Shivam' }),
  raw({ id: 'a' }),
  raw({ id: 'b', scheduled_at: '2026-11-19T02:00:00Z', row_status: 'cancelled', otp: false, paid_cancellation_code: null }),
  raw({ id: 'd', scheduled_at: '2026-11-19T04:00:00Z', row_status: 'odd', client_name: ' ', trainer_name: null, modality: '' }),
]);
eq('not an array', S.parseSessionLogs(null), []);
eq('ordered by time', rows.map((r) => r.id), ['a', 'b', 'c', 'd']);
eq('unknown status is scheduled, blank names get words', [rows[3].status, rows[3].clientName, rows[3].trainerName, rows[3].modality], ['scheduled', 'Client', 'Trainer', 'Session']);
eq('counts', S.sessionLogCounts(rows), { total: 4, completed: 1, cancelled: 1, scheduled: 2 });
eq('progress', [S.donePercent(18, 22), S.donePercent(0, 0)], [82, 0]);
eq('filter completed', S.filterSessionLogs(rows, 'completed', '').map((r) => r.id), ['a']);
eq('search trainer', S.filterSessionLogs(rows, 'all', 'shivam').map((r) => r.id), ['c']);
eq('search modality', S.filterSessionLogs(rows, 'all', 'pilates').map((r) => r.id), ['c']);
eq('filter + search', S.filterSessionLogs(rows, 'cancelled', 'pilates'), []);
eq('tap the active card again = all', S.nextFilter('scheduled', 'scheduled'), 'all');
eq('tap another card', S.nextFilter('all', 'cancelled'), 'cancelled');
eq('total stays', S.nextFilter('all', 'all'), 'all');
eq('code shown for a Session-code member', S.showsPaidCancelCode(rows[0]), true);
eq('no code when the switch is off', S.showsPaidCancelCode(rows[1]), false);
eq('no code when it did not reach us (trainer, or none made)', S.showsPaidCancelCode({ otp: true, paidCancelCode: null }), false);
eq('initials', [S.initialsOf('Nidhi Arora'), S.initialsOf('inder jeet singh'), S.initialsOf('')], ['NA', 'IJ', '?']);

// IST: 19 Nov 2026 20:00 IST = 14:30 UTC; 20 Nov 01:00 IST = 19 Nov 19:30 UTC
eq('today in IST', S.istDateKey(Date.parse('2026-11-19T14:30:00Z')), '2026-11-19');
eq('after IST midnight', S.istDateKey(Date.parse('2026-11-19T19:30:00Z')), '2026-11-20');
eq('shift back over a month', S.shiftDateKey('2026-12-01', -1), '2026-11-30');
eq('shift forward', S.shiftDateKey('2026-11-19', 1), '2026-11-20');
eq('day label', S.dateKeyLabel('2026-11-19'), 'Thu, 19 Nov 2026');
eq('time', S.istTime('2026-11-19T01:00:00Z'), '6:30 AM');
eq('time of nothing', S.istTime(null), '--');
eq('logged line', S.loggedLine(rows[0]), 'Logged 8:13 AM');
eq('cancelled line', S.loggedLine(rows[1]), 'Cancelled 8:13 AM');
eq('no line while scheduled', S.loggedLine(rows[2]), null);
eq('used code line', S.usedCodeLine('2026-11-19T10:00:00Z'), 'Code used by the trainer at 3:30 PM');
eq('empty day', S.emptyDayLine('2026-11-19'), 'No sessions scheduled for Thu, 19 Nov 2026.');
const copy = [S.SESSION_LOGS_TITLE, S.SESSION_LOGS_SUB, S.PAID_CANCEL_HINT, S.NO_MATCH_LINE, S.emptyDayLine('2026-11-19')].join(' ');
eq('no dashes or OTP in the copy', /[–—]|OTP/.test(copy), false);

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
