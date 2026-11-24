// Rule test for the Odds staff app. ROOT = the repo root; point it at the iOS repo and run: node tests/rules/staff_referral_test.js
const ROOT = require("path").resolve(__dirname, "../..");
// node test of src/lib/staffReferral.ts (staff referrals that go straight to the Leads page, 21 Nov 2026) and of
// the wiring behind the release switch.
const ts = require(ROOT + '/node_modules/typescript');
const fs = require('fs');
const src = fs.readFileSync(ROOT + '/src/lib/staffReferral.ts', 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const m = { exports: {} };
new Function('module', 'exports', 'require', js)(m, m.exports, (n) => { throw new Error('unexpected require ' + n); });
const P = m.exports;
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };
const read = (rel) => fs.readFileSync(ROOT + rel, 'utf8');

eq('THE RELEASE SWITCH IS OFF', P.STAFF_REFERRAL_FLOW_ON, false);
eq('status words', ['in_progress', 'qhp_booked', 'qhp_done', 'payment_awaited', 'credit_deciding', 'converted', 'credited_other', 'no_credit', 'not_converted', 'waiting_admin', 'approved', 'rejected'].map((k) => P.referralStatus(k).label),
  ['In progress', 'QHP booked', 'QHP done', 'Enrolled, payment awaited', 'Converted, credit being decided', 'Converted', 'Converted, credited to another member', 'Converted, no referral credit', 'Not converted', 'Waiting for admin', 'Approved', 'Rejected']);
eq('an unknown status reads as In progress', [P.referralStatus('new_one').label, P.referralStatus(null).key], ['In progress', 'in_progress']);
eq('the three numbers', P.referralCounts([{ status_key: 'converted' }, { status_key: 'in_progress' }, { status_key: 'qhp_done' }, { status_key: 'not_converted' }, { status_key: 'credited_other' }]), { total: 5, converted: 1, inProgress: 2, notConverted: 2 });
const FULL = { name: 'Rohan Mehta', phone: '+91 98765 43210', clientId: 'c1', relation: 'Friend' };
eq('the form needs a name and a phone', [P.referralFormProblem({ ...FULL, name: '', phone: '' }), P.referralFormProblem({ ...FULL, phone: '' }), P.referralFormProblem({ ...FULL, phone: '12345' }), P.referralFormProblem(FULL)], ["Enter the person's name.", "Enter the person's phone number.", 'Enter a valid phone number.', null]);
eq('the form needs the client and the relation (24 Nov 2026)', [P.referralFormProblem({ ...FULL, clientId: null }), P.referralFormProblem({ ...FULL, relation: '' }), P.referralFormProblem({ ...FULL, relation: 'Other' }), P.referralFormProblem({ ...FULL, relation: 'Other', relationOther: 'gym friend' }), P.relationText('Other', ' gym  friend ')], ['Choose the client whose referral this is.', 'Choose how this person is related to the client.', 'Write how this person is related to the client.', null, 'Other: gym friend']);
eq("the server's yes", [P.referralSaveResult({ ok: true, case: 'new_lead' }).message, P.referralSaveResult({ ok: true, case: 'added_to_lead', reopened: true }).message, P.referralSaveResult({ ok: true, case: 'already_yours' }).message], ['Referral sent to the leads team.', 'This number is already with the leads team. Your referral was added to it and marked as a duplicate. The lead was Lost and is open again.', 'You have already referred this person.']);
eq("the server's no", ['member', 'limit', 'not_staff', 'client', 'relation', 'weird'].map((r) => P.referralSaveResult({ ok: false, reason: r }).message), ['This person is already a member, so a referral cannot be added.', 'You have added many referrals today. Try again tomorrow.', 'Only team members can add a referral here.', 'Choose the client whose referral this is.', 'Choose how this person is related to the client.', 'The referral could not be saved. Try again.']);
eq('an empty answer is a plain not saved', P.referralSaveResult(null).ok, false);
const first = { kind: 'staff_referral', author_name: 'Raj Thakur', referrer_role: 'trainer' };
const again = { kind: 'staff_referral', author_name: 'Pallavi Mishra', referrer_role: 'crm', last_referred_on: '2026-11-21' };
eq('the lead tag', [P.leadReferredTag(P.leadReferralInfo([{ text: 'typed' }])), P.leadReferredTag(P.leadReferralInfo([first])), P.leadReferredTag(P.leadReferralInfo([first, again])), P.leadReferredTag(P.leadReferralInfo([again]))], ['', 'Referred', 'Duplicate referral (2)', 'Duplicate referral']);
const ref = (o) => ({ id: 'r', referred_name: 'Kabir Shah', referred_phone: '9876543210', created_at: '2026-11-24T05:00:00.000Z', through_client: 'Asha Verma', status_key: 'in_progress', converted_on: null, note: null, on_existing_lead: false, relation: 'Friend', lead_stage: 'New', qhp_booked_on: null, qhp_done_on: null, paid_on: null, others: 0, ...o });
const shape = (t) => t.steps.map((s) => s.label + ':' + s.state + ':' + s.day);
eq('the tracker: submitted, then converted on the payment day', [shape(P.referralTracker(ref())), shape(P.referralTracker(ref({ status_key: 'converted', qhp_booked_on: '2026-11-26', qhp_done_on: '2026-11-29', paid_on: '2026-12-02', converted_on: '2026-12-03' })))],
  [['Lead submitted:now:24 Nov 2026', 'QHP booked:todo:', 'QHP done:todo:', 'Converted:todo:'], ['Lead submitted:done:24 Nov 2026', 'QHP booked:done:26 Nov 2026', 'QHP done:done:29 Nov 2026', 'Converted:now:2 Dec 2026']]);
eq('the tracker: not converted keeps its steps; the duplicate line', [P.referralTracker(ref({ status_key: 'not_converted', qhp_booked_on: '2026-11-26' })).reached, P.referralTracker(ref({ status_key: 'not_converted' })).closed, P.referralDuplicateLine(ref({ others: 2 })), P.referralDuplicateLine(ref({ on_existing_lead: true })), P.referralDuplicateLine(ref())], [2, true, 'Also referred by 2 other members', 'Already a lead when you referred', '']);
eq('a day in words', [P.referralDay('2026-11-21'), P.referralDay(''), P.referralDay(null)], ['21 Nov 2026', '', '']);
eq('a database sentence is shown, a raw error never', [P.referralErrorText({ message: 'REFERRAL_DECIDED: This referral has already been decided.' }), P.referralErrorText({ message: 'permission denied' })], ['This referral has already been decided.', 'The referral could not be saved. Check your connection and try again.']);
eq('no long dash in the rule file', src.includes(String.fromCharCode(8212)), false);

// the screen and the data layer, behind the switch
const screen = read('/src/screens/referrals.tsx');
eq('the old list is not asked for while the new flow is on, and the reverse', [/useMyReferrals\(STAFF_REFERRAL_FLOW_ON \? null : userId\)/.test(screen), /useMyStaffReferrals\(STAFF_REFERRAL_FLOW_ON \? userId : null\)/.test(screen)], [true, true]);
eq('the sheet asks for a phone only in the new flow', /\{STAFF_REFERRAL_FLOW_ON \? \(\s*<View style=\{\{ gap: 6 \}\}>\s*\{label\('PHONE \*'\)\}/.test(screen), true);
eq('the new save is used only in the new flow, one id per opening of the sheet, and it sends the client and the relation', [/if \(STAFF_REFERRAL_FLOW_ON\) \{\s*staffM\.mutate\(\{ id: saveIdRef\.current, name, phone, note: notes, clientId: linkedId, source: relationText\(relation, relationOther\) \}/.test(screen), /setPhone\(''\); saveIdRef\.current = newSaveId\(\); staffM\.reset\(\);/.test(screen)], [true, true]);
eq('the sheet checks the client and the relation, and asks the server for the client list only in the new flow', [/referralFormProblem\(\{ name, phone, clientId: linkedId, relation, relationOther \}\)/.test(screen), /useReferralClientChoices\(visible && STAFF_REFERRAL_FLOW_ON \? referrerId : null, clientTerm\)/.test(screen), /useMyReferralClients\(visible && !STAFF_REFERRAL_FLOW_ON \? referrerId : null\)/.test(screen)], [true, true, true]);
eq('no long dash in the new-flow rows', /function ReferralSteps[\s\S]*?function StaffReferralRow[\s\S]*?\n}\n/.exec(screen.split('\r\n').join('\n'))[0].includes(String.fromCharCode(8212)), false);
eq('a refusal is shown in words and the sheet stays open', /if \(!res\.ok\) \{ sentRef\.current = false; Alert\.alert\('Referral not added', res\.message\); return; \}/.test(screen), true);
const data = read('/src/lib/staffReferralQueries.ts');
eq('the list key carries the user id; all three calls have a timeout', [/queryKey: \['staff-referrals', 'mine', userId\]/.test(data), (data.match(/withTimeout<any>\(/g) || []).length, /rpc\('get_referral_client_choices', \{ p_q: term \|\| null \}\)/.test(data)], [true, 3, true]);
eq("the admin's approval list leaves out referrals that belong to a lead", /\.is\('lead_id', null\)/.test(read('/src/lib/adminRequestQueries.ts')), true);
eq("the tap on 'Your referral converted' opens My Referrals for trainers and doctors", /if \(t === 'referral_converted'\) \{ go\(dbRoleRef\.current === 'trainer' \|\| dbRoleRef\.current === 'doctor' \? 'referrals' : homeRouteFor\(roleRef\.current\)\); return; \}/.test(read('/src/components/PushTokenManager.tsx')), true);
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
