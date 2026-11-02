// Rule test for the Odds staff app. ROOT = the repo root; point it at the iOS repo and run: node tests/rules/approval_requests_test.js
const ROOT = require("path").resolve(__dirname, "../..");
// node test of src/lib/approvalRequests.ts (approval requests, Session code off, 2 Nov 2026) and of how
// friendlyError shows the new server messages (they must read as the server's sentence, not a generic line).
const ts = require(ROOT + '/node_modules/typescript');
const fs = require('fs');
const load = (rel) => {
  const src = fs.readFileSync(ROOT + rel, 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const m = { exports: {} };
  new Function('module', 'exports', 'require', js)(m, m.exports, (n) => { throw new Error('unexpected require ' + n); });
  return m.exports;
};
const A = load('/src/lib/approvalRequests.ts');
const FE = load('/src/lib/friendlyError.ts');
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };

const base = {
  id: 'r1', request_type: 'session_code_off', client_id: 'c1', subject_id: null, reason: 'Client travels a lot this month',
  payload: {}, status: 'pending', auto_approved: false, requested_by: 'u1', requested_by_name: 'Pallavi Mishra', requested_by_role: 'crm',
  requested_at: '2026-11-02T10:40:00Z', reviewed_by: null, reviewed_by_name: null, reviewed_by_role: null, reviewed_at: null,
  review_note: null, withdrawn_at: null, applied_at: null, result: {},
};
const R = (o) => Object.assign({}, base, o);

// time words (IST)
eq('fmtWhen IST', A.fmtWhen('2026-11-02T10:40:00Z'), '2 Nov, 4:10 PM');
eq('fmtWhen empty', A.fmtWhen(null), '');
eq('fmtWhen bad', A.fmtWhen('nope'), '');

// requester words
eq('requester crm', A.requesterText(base), 'Pallavi Mishra (CRM)');
eq('requester super admin', A.requesterText(R({ requested_by_name: 'Admin', requested_by_role: 'super_admin' })), 'Admin (Super admin)');
eq('requester no name', A.requesterText(R({ requested_by_name: null, requested_by_role: null })), 'Someone');

// which request gets a line under the switch
eq('line: pending always', A.lineRequest([base], true)?.id, 'r1');
eq('line: rejected always', A.lineRequest([R({ status: 'rejected' })], true)?.id, 'r1');
eq('line: approved while off', A.lineRequest([R({ status: 'approved' })], false)?.id, 'r1');
eq('line: approved but on again', A.lineRequest([R({ status: 'approved' })], true), null);
eq('line: withdrawn is history', A.lineRequest([R({ status: 'withdrawn' })], true), null);
eq('line: none', A.lineRequest([], true), null);

// the status line itself
eq('status pending', A.sessionCodeStatusLine(base), { tone: 'amber', text: "Off request pending since 2 Nov, 4:10 PM (asked by Pallavi Mishra), waiting for the doctors' manager." });
eq('status approved', A.sessionCodeStatusLine(R({ status: 'approved', reviewed_by_name: 'Anjana Odds', reviewed_at: '2026-11-02T11:00:00Z' })),
  { tone: 'green', text: 'Turned off on 2 Nov, 4:30 PM by Anjana Odds (asked by Pallavi Mishra: Client travels a lot this month)' });
eq('status admin auto', A.sessionCodeStatusLine(R({ status: 'approved', auto_approved: true, reviewed_by_name: 'Admin', reviewed_at: '2026-11-02T11:00:00Z' })),
  { tone: 'green', text: 'Turned off on 2 Nov, 4:30 PM by Admin: Client travels a lot this month' });
eq('status rejected with note', A.sessionCodeStatusLine(R({ status: 'rejected', reviewed_by_name: 'Anjana Odds', reviewed_at: '2026-11-02T11:00:00Z', review_note: 'Keep it on' })),
  { tone: 'red', text: 'Off request rejected by Anjana Odds on 2 Nov, 4:30 PM: Keep it on' });
eq('status cancelled', A.sessionCodeStatusLine(R({ status: 'cancelled', review_note: 'The Session code was turned off another way before this request was reviewed.' })).text,
  'The Session code was turned off another way before this request was reviewed.');
eq('status none', A.sessionCodeStatusLine(null), null);

// reason / note checks (the server makes the same ones)
eq('reason short', A.reasonProblem('too short'), 'Write the reason (at least 10 characters).');
eq('reason ok', A.reasonProblem('  long enough reason  '), null);
eq('reject note short', A.rejectNoteProblem('no'), 'Write why it is rejected (at least 5 characters).');
eq('reject note ok', A.rejectNoteProblem('Keep it on'), null);

// type titles
eq('title known', A.typeTitle('session_code_off'), 'Session code off approvals');
eq('title future', A.typeTitle('plan_override', 'Plan override'), 'Plan override approvals');

// The server's sentences reach the person. friendlyError turns the 42501 ("not allowed") ones into its generic line,
// so the approval screens read codedSentence first (what the screens show = codedSentence ?? friendlyError).
const E = (message, code) => Object.assign(new Error(message), code ? { code } : {});
const shown = (e) => A.codedSentence(e) ?? FE.friendlyError(e, 'Try again.');
eq('needs approval (42501)', shown(E("OTP_OFF_NEEDS_APPROVAL: Turning off the Session code needs the doctors manager's approval. Send a request from the client page.", '42501')),
  "Turning off the Session code needs the doctors manager's approval. Send a request from the client page.");
eq('own request (42501)', shown(E('APPROVAL_OWN_REQUEST: You cannot review your own request.', '42501')), 'You cannot review your own request.');
eq('pending', shown(E('APPROVAL_PENDING: A request for this is already waiting for approval.', 'P0001')), 'A request for this is already waiting for approval.');
eq('reject note', shown(E('APPROVAL_NOTE: Write why it is rejected (at least 5 characters).', 'P0001')), 'Write why it is rejected (at least 5 characters).');
eq('already decided', shown(E('APPROVAL_DONE: This request is already approved. Refresh the page.', 'P0001')), 'This request is already approved. Refresh the page.');
eq('client location refusal (42501, 2 Nov 2026)', shown(E('LOCATION_FORBIDDEN: Only ops, CRM, admin or a QHP manager can save a client location.', '42501')), 'Only ops, CRM, admin or a QHP manager can save a client location.');
eq('other errors still friendly', shown(E('Failed to fetch')), FE.NO_CONNECTION);
eq('a plain 42501 still generic', shown(E('new row violates row-level security policy for table "x"', '42501')), FE.NOT_ALLOWED);

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
