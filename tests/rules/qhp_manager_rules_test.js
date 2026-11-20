// Rule test for the Odds staff app. ROOT = the repo root; point it at the iOS repo and run: node tests/rules/qhp_manager_rules_test.js
const ROOT = require("path").resolve(__dirname, "../..");
// QHP Manager (20 Nov 2026): the "not scheduled yet" alert rule (qhpNotScheduled.ts, the web file byte for byte) and
// the rules of the split page (qhpManagerRules.ts): has-data filter text, Task Pending with cancelled bookings,
// the three lists, booking rows, the 45-day overdue mark, QHP Review, reschedules, tile counts, id batches, copy.
const ts = require(ROOT + '/node_modules/typescript');
const fs = require('fs');
const load = (rel) => {
  const js = ts.transpileModule(fs.readFileSync(ROOT + rel, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const m = { exports: {} }; new Function('module', 'exports', 'require', js)(m, m.exports, require); return m.exports;
};
const N = load('/src/lib/qhpNotScheduled.ts');
const R = load('/src/lib/qhpManagerRules.ts');
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };

// ---------------- the alert rule (web file)
const FROM = N.QHP_NOT_SCHEDULED_ALERT_FROM;
eq('the alert starts 20 Nov 2026 7:00 AM India time', [FROM, new Date(FROM).toISOString()], ['2026-11-20T07:00:00+05:30', '2026-11-20T01:30:00.000Z']);
const cl = (id, at) => ({ id, first_name: id.toUpperCase(), last_name: 'X', created_at: at });
const clients = [cl('late', '2026-11-20T12:00:00+05:30'), cl('early', '2026-11-20T07:00:00+05:30'), cl('before', '2026-11-20T06:59:00+05:30'), cl('booked', '2026-11-20T08:00:00+05:30'), cl('cancelled', '2026-11-20T09:00:00+05:30'), cl('hold', '2026-11-20T10:00:00+05:30'), cl('early', '2026-11-20T07:00:00+05:30')];
const bookings = [{ client_id: 'booked', cancelled: null }, { client_id: 'cancelled', cancelled: { at: 'x' } }, { client_id: null }];
eq('who is still waiting, longest first, no doubles', N.qhpNotScheduledSince(clients, bookings, ['hold', null]).map((c) => c.id), ['early', 'cancelled', 'late']);
eq('a card from before the start is left out', N.qhpNotScheduledSince([cl('before', '2026-11-20T06:59:59+05:30')], [], []).length, 0);
eq('a booking takes the client out', N.qhpNotScheduledSince([cl('a', '2026-11-21T08:00:00+05:30')], [{ client_id: 'a' }], []).length, 0);
eq('a cancelled booking brings the client back', N.qhpNotScheduledSince([cl('a', '2026-11-21T08:00:00+05:30')], [{ client_id: 'a', cancelled: true }], []).length, 1);
eq('on hold takes the client out', N.qhpNotScheduledSince([cl('a', '2026-11-21T08:00:00+05:30')], [], ['a']).length, 0);
eq('nothing given', N.qhpNotScheduledSince(null, null, null), []);
eq('title one', N.qhpNotScheduledTitle(1), '1 QHP is not scheduled yet');
eq('title many', N.qhpNotScheduledTitle(4), '4 QHPs are not scheduled yet');
const now = new Date('2026-11-20T10:00:00+05:30');
eq('waiting minutes', N.waitingLabel('2026-11-20T09:35:00+05:30', now), '25m');
eq('waiting hours', N.waitingLabel('2026-11-20T06:55:00+05:30', now), '3h 5m');
eq('waiting days', N.waitingLabel('2026-11-18T06:00:00+05:30', now), '2d 4h');

// ---------------- has data
eq('has-data filter is the web text', R.QHP_HAS_DATA_FILTER,
  'and(new_client_assessment_data.not.is.null,new_client_assessment_data.neq.{},new_client_assessment_data.neq.null),and(existing_client_assessment_data.not.is.null,existing_client_assessment_data.neq.{},existing_client_assessment_data.neq.null),and(qhp_data.not.is.null,qhp_data.neq.{},qhp_data.neq.null)');
eq('no assessment blob in the booking columns', /assessment_data|qhp_data/.test(R.QHP_BOOKING_COLUMNS), false);
eq('a report file counts as data', R.bookingHasData({ id: 'x', assessment_file_url: 'f.pdf' }, new Set()), true);
eq('an id with data counts', R.bookingHasData({ id: 'x' }, new Set(['x'])), true);
eq('neither: no data', R.bookingHasData({ id: 'x', assessment_file_url: null }, new Set(['y'])), false);

// ---------------- Task Pending
const tb = R.taskPendingBookings([
  { id: 'b1', client_id: 'c1', assessment_date: '2026-11-22', assessment_time: '09:00:00', cancelled: null },
  { id: 'b2', client_id: 'c2', assessment_date: '2026-11-21', cancelled: { reason: 'x' } },
  { id: 'b3', client_id: 'c3', assessment_date: '2026-11-10', cancelled: null },
  { id: 'b4', client_id: 'c4', assessment_date: '2026-11-10', cancelled: true },
  { id: 'b5', client_id: null },
], ['b3', 'b4']);
eq('a live booking is kept with its date and time', tb.bookingOf.c1, { id: 'b1', date: '2026-11-22', time: '09:00:00' });
eq('a cancelled booking is not a booking', tb.bookingOf.c2, undefined);
eq('a booking with data makes the client done', tb.doneClientIds, ['c3']);
eq('a CANCELLED booking with data does not make the client done', tb.doneClientIds.includes('c4'), false);
const pend = [{ clientId: 'c1', hasQHP: true }, { clientId: 'c2', hasQHP: false }, { clientId: 'c5', hasQHP: false }, { clientId: 'c6', hasQHP: true }];
const bk = R.bucketTaskPending(pend, ['c5', 'c6']);
eq('scheduled: has a live booking (even when on hold)', bk.taskScheduled.map((c) => c.clientId), ['c1', 'c6']);
eq('on hold: no booking and on hold', bk.taskOnHold.map((c) => c.clientId), ['c5']);
eq('not scheduled: the cancelled one is back here', bk.taskNotScheduled.map((c) => c.clientId), ['c2']);

// ---------------- booking rows
const NOW = Date.parse('2026-11-20T12:00:00Z');
const days = (n) => new Date(NOW - n * 86400000).toISOString();
const rowsIn = [
  { id: 'r1', client_id: 'a', client_name: 'Asha', coach_id: 'p1', assessment_date: '2026-09-01', assessment_time: '10:00:00', assessment_scheduled: true, completed: days(60), qhp_manager: 'approved' },
  { id: 'r2', client_id: 'a', client_name: 'Asha', coach_id: 'p1', assessment_date: '2026-10-25', assessment_scheduled: true, completed: days(20), qhp_manager: null },
  { id: 'r3', client_id: 'b', client_name: 'Ben', coach_id: null, assessment_date: '2026-11-25', assessment_scheduled: true, completed: null, sla_deadline_at: days(1) },
  { id: 'r4', client_id: 'c', client_name: '', coach_id: 'p2', assessment_date: '2026-09-01', assessment_scheduled: false, completed: days(50), qhp_manager: 'not_approved' },
  { id: 'r5', client_id: 'd', client_name: 'Dia', coach_id: 'p1', assessment_date: '2026-09-01', assessment_scheduled: true, completed: days(70), assessment_file_url: 'x.pdf' },
];
const A = R.toQhpAssessments(rowsIn, ['r1', 'r2'], { p1: 'Sagar K' }, NOW);
eq('with data: completed', [A[0].status, A[0].completed, A[0].stage], ['completed', true, 'completed']);
eq('no data, not conducted: pending, scheduled stage, SLA overdue', [A[2].status, A[2].stage, A[2].overdue, A[2].assessorName], ['pending', 'scheduled', true, 'Unassigned']);
eq('no data, conducted 50 days ago: overdue; unknown assessor', [A[3].status, A[3].assessorName, A[3].managerReview], ['overdue', 'Unassigned', 'not_approved']);
eq('a report file makes it completed', A[4].status, 'completed');
eq('scheduledAt joins date and time', [A[0].scheduledAt, A[1].scheduledAt], ['2026-09-01T10:00:00', '2026-10-25T00:00:00']);
eq('validity overdue is not marked before the recent list arrives', R.markValidityOverdue(A, null, NOW).some((a) => a.validityOverdue), false);
const V = R.markValidityOverdue(A, ['a', 'd'], NOW);
eq('only the LATEST done QHP of an active client is judged: Asha latest is 20 days old', V.filter((a) => a.clientId === 'a').map((a) => a.validityOverdue), [false, false]);
eq('Dia: latest done 70 days ago and active: overdue', V.find((a) => a.id === 'r5').validityOverdue, true);
eq('a client who is not in the recent list is never overdue', R.markValidityOverdue(A, [], NOW).some((a) => a.validityOverdue), false);
eq('tile counts', R.qhpBookingCounts(V), { assessScheduled: 1, completed: 3, overdue: 1, total: 5 });

// ---------------- review and reschedules
const rv = R.qhpReviewLists(R.toQhpAssessments([
  { id: 'v1', client_id: 'a', completed: '2026-05-01T00:00:00+05:30', qhp_manager: null },
  { id: 'v2', client_id: 'b', completed: '2026-04-30T23:59:00+05:30', qhp_manager: null },
  { id: 'v3', client_id: 'c', completed: '2026-11-01T10:00:00+05:30', qhp_manager: 'approved' },
  { id: 'v4', client_id: 'd', completed: '2026-11-10T10:00:00+05:30', qhp_manager: 'not_approved' },
  { id: 'v5', client_id: 'e', completed: null },
], [], {}, NOW));
eq('review: from 1 May 2026, newest first', rv.all.map((a) => a.id), ['v4', 'v3', 'v1']);
eq('review: pending and the two counts', [rv.pending.map((a) => a.id), rv.approvedCount, rv.notApprovedCount], [['v1'], 1, 1]);
const rs = R.qhpReschedulesOf([
  { id: 'q1', client_name: 'Asha', coach_id: 'p1', assessment_date: '2026-11-22', assessment_time: '09:00:00', reschedule_status: 'pending', reschedule_data: { proposed_date: '2026-11-24', proposed_time: '11:00:00', requested_at: 'T', remark: 'travel' } },
  { id: 'q2', client_name: 'Ben', reschedule_status: 'approved' },
], { p1: 'Sagar K' });
eq('reschedules: only pending, with both times', rs, [{ id: 'q1', clientName: 'Asha', assessorName: 'Sagar K', currentAt: '2026-11-22T09:00:00', proposedAt: '2026-11-24T11:00:00', requestedAt: 'T', remark: 'travel' }]);

// ---------------- small things
eq('id batches', R.idChunks([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
eq('created label in India time', R.qhpCardCreatedLabel('2026-11-20T12:40:00Z'), '20-Nov-2026 6:10 PM');
eq('created label at noon and midnight', [R.qhpCardCreatedLabel('2026-11-20T06:30:00Z'), R.qhpCardCreatedLabel('2026-11-20T18:30:00Z')], ['20-Nov-2026 12:00 PM', '21-Nov-2026 12:00 AM']);
eq('created label of nothing', R.qhpCardCreatedLabel(null), '');
eq('more line', R.qhpNotScheduledMore(3), '+3 more in Task Pending');
const copy = [R.QHP_NOT_SCHEDULED_SUB, R.qhpNotScheduledMore(2), N.qhpNotScheduledTitle(2)].join(' ');
eq('no dashes in the copy', /[–—]/.test(copy), false);

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
