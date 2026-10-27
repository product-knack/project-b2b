// Rule test for the Odds staff app. ROOT = the repo root; point it at the iOS repo and run: node tests/rules/qhp_cancellation_test.js
const ROOT = require("path").resolve(__dirname, "../..");
// node test of src/lib/qhpCancellation.ts: the one status per QHP row, chips, lines, counting, filters, error codes.
const ts = require(ROOT + '/node_modules/typescript');
const fs = require('fs');
const src = fs.readFileSync(ROOT + '/src/lib/qhpCancellation.ts', 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const m = { exports: {} };
new Function('module', 'exports', 'require', js)(m, m.exports, (n) => { throw new Error('unexpected require ' + n); });
const Q = m.exports;
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };

const pendingPaid = { cancellation_request: { status: 'pending', payment: 'paid', reason: 'Client travelling', requested_by_name: 'Divya', requested_at: '2026-10-26T04:30:00Z' }, cancelled: null };
const approvedPaid = { cancellation_request: { status: 'approved', payment: 'paid', final_payment: 'paid' }, cancelled: { at: '2026-10-23T06:40:14Z', payment: 'paid', requested_by: 'u1', requested_payment: 'paid', cancelled_by_name: 'Rohit', reason: 'Client not available', decision_note: null } };
const approvedChanged = { cancellation_request: { status: 'approved', payment: 'paid' }, cancelled: { at: '2026-10-23T06:40:14Z', payment: 'unpaid', requested_by: 'u1', requested_payment: 'paid', cancelled_by_name: 'Rohit', reason: 'x', decision_note: 'Client was told late' } };
const declined = { cancellation_request: { status: 'declined', payment: 'unpaid', reason: 'Sick', decision_note: 'Please go, the client is waiting', decided_by_name: 'Rohit', decided_at: '2026-10-25T10:00:00Z' }, cancelled: null };
const direct = { cancellation_request: null, cancelled: { at: '2026-10-20T06:00:00Z', payment: 'paid', cancelled_by_name: 'Ops Team', cancelled_by_role: 'ops', reason: 'Lead dropped' } };
const legacy = { cancellation_request: null, cancelled: { at: '2026-09-01T06:00:00Z', cancelled_by_name: 'Ops' } };
const withdrawn = { cancellation_request: { status: 'withdrawn', payment: 'paid' }, cancelled: null };

eq('pending', Q.cancelViewOf(pendingPaid).kind, 'pending');
eq('pending chip', Q.cancelChip(Q.cancelViewOf(pendingPaid)), { text: 'Cancellation pending · Paid', tone: 'amber' });
eq('approved paid', Q.cancelViewOf(approvedPaid), { kind: 'approved', payment: 'paid', claim: 'paid', decidedByName: 'Rohit', note: null, at: '2026-10-23T06:40:14Z', reason: 'Client not available' });
eq('approved paid chip', Q.cancelChip(Q.cancelViewOf(approvedPaid)), { text: 'Paid cancellation', tone: 'green' });
eq('approved changed to unpaid chip', Q.cancelChip(Q.cancelViewOf(approvedChanged)), { text: 'Cancelled · Unpaid', tone: 'grey' });
eq('approved changed detail (assessor)', Q.cancelDetail(Q.cancelViewOf(approvedChanged), true), 'Approved by Rohit on 23 Oct. You asked for paid. Note: Client was told late');
eq('approved changed detail (manager)', Q.cancelDetail(Q.cancelViewOf(approvedChanged), false), 'Approved by Rohit on 23 Oct. The assessor asked for paid. Note: Client was told late');
eq('declined', Q.cancelChip(Q.cancelViewOf(declined)), { text: 'Cancellation not approved', tone: 'red' });
eq('declined detail', Q.cancelDetail(Q.cancelViewOf(declined), true), 'Rohit did not approve on 25 Oct. The QHP stays scheduled. Note: Please go, the client is waiting');
eq('direct ops cancel', Q.cancelChip(Q.cancelViewOf(direct)), { text: 'Cancelled · Paid', tone: 'green' });
eq('legacy cancel reads unpaid', Q.cancelViewOf(legacy).payment, 'unpaid');
eq('withdrawn is none', Q.cancelViewOf(withdrawn), { kind: 'none' });
eq('null row is none', Q.cancelViewOf(null), { kind: 'none' });
eq('pending detail', Q.cancelDetail(Q.cancelViewOf(pendingPaid), true), 'Asked on 26 Oct. Waiting for the QHP Manager. Reason: Client travelling');
eq('paid counting', [Q.isPaidCancellation(Q.cancelViewOf(pendingPaid)), Q.isPaidCancellation(Q.cancelViewOf(approvedPaid)), Q.isPaidCancellation(Q.cancelViewOf(approvedChanged)), Q.isPaidCancellation(Q.cancelViewOf(direct))], [false, true, false, true]);
eq('filters', [Q.matchesFilter(Q.cancelViewOf(pendingPaid), 'pending'), Q.matchesFilter(Q.cancelViewOf(pendingPaid), 'approved'), Q.matchesFilter(Q.cancelViewOf(approvedChanged), 'approved'), Q.matchesFilter(Q.cancelViewOf(direct), 'approved'), Q.matchesFilter(Q.cancelViewOf(declined), 'all'), Q.matchesFilter(Q.cancelViewOf(withdrawn), 'all')], [true, false, true, true, true, false]);
eq('can request', [Q.canRequestCancellation({ is_completed: false }, Q.cancelViewOf(withdrawn)), Q.canRequestCancellation({ is_completed: false }, Q.cancelViewOf(declined)), Q.canRequestCancellation({ is_completed: false }, Q.cancelViewOf(pendingPaid)), Q.canRequestCancellation({ is_completed: true }, Q.cancelViewOf(withdrawn)), Q.canRequestCancellation({ is_completed: false }, Q.cancelViewOf(approvedPaid))], [true, true, false, false, false]);
eq('sort key', [Q.cancelSortKey(Q.cancelViewOf(pendingPaid)), Q.cancelSortKey(Q.cancelViewOf(approvedPaid))], ['2026-10-26T04:30:00Z', '2026-10-23T06:40:14Z']);
eq('error codes', [Q.qhpCancelCodeText('QHP_CANCEL_PENDING: pending request exists'), Q.qhpCancelCodeText('QHP_CANCEL_NOTE_REQUIRED'), Q.qhpCancelCodeText('duplicate key'), Q.isNotPendingError('QHP_CANCEL_NOT_PENDING: x')], ['A cancellation request is already waiting for the QHP Manager.', 'Add a note saying why the request is declined.', null, true]);
eq('ist day', [Q.istDay('2026-10-26'), Q.istDay('2026-10-23T06:40:14Z'), Q.istDay(null)], ['26 Oct', '23 Oct', '']);
const copy = Object.values(Q).filter((v) => typeof v === 'string').join(' ') + Q.cancelDetail(Q.cancelViewOf(declined), true);
eq('no dashes in the copy', /[–—]|\s-\s/.test(copy), false);
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
