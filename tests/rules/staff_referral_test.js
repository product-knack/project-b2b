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
eq('the form needs a name and a phone', [P.referralFormProblem({ name: '', phone: '' }), P.referralFormProblem({ name: 'Rohan Mehta', phone: '' }), P.referralFormProblem({ name: 'Rohan Mehta', phone: '12345' }), P.referralFormProblem({ name: 'Rohan Mehta', phone: '+91 98765 43210' })], ["Enter the person's name.", "Enter the person's phone number.", 'Enter a valid phone number.', null]);
eq("the server's yes", [P.referralSaveResult({ ok: true, case: 'new_lead' }).message, P.referralSaveResult({ ok: true, case: 'added_to_lead', reopened: true }).message, P.referralSaveResult({ ok: true, case: 'already_yours' }).message], ['Referral sent to the leads team.', 'This person is already a lead. Your referral was added to it. The lead was Lost and is open again.', 'You have already referred this person.']);
eq("the server's no", ['member', 'limit', 'not_staff', 'weird'].map((r) => P.referralSaveResult({ ok: false, reason: r }).message), ['This person is already a member, so a referral cannot be added.', 'You have added many referrals today. Try again tomorrow.', 'Only team members can add a referral here.', 'The referral could not be saved. Try again.']);
eq('an empty answer is a plain not saved', P.referralSaveResult(null).ok, false);
const first = { kind: 'staff_referral', author_name: 'Raj Thakur', referrer_role: 'trainer' };
const again = { kind: 'staff_referral', author_name: 'Pallavi Mishra', referrer_role: 'crm', last_referred_on: '2026-11-21' };
eq('the lead tag', [P.leadReferredTag(P.leadReferralInfo([{ text: 'typed' }])), P.leadReferredTag(P.leadReferralInfo([first])), P.leadReferredTag(P.leadReferralInfo([first, again]))], ['', 'Referred', 'Referred again 21 Nov 2026']);
eq('a day in words', [P.referralDay('2026-11-21'), P.referralDay(''), P.referralDay(null)], ['21 Nov 2026', '', '']);
eq('a database sentence is shown, a raw error never', [P.referralErrorText({ message: 'REFERRAL_DECIDED: This referral has already been decided.' }), P.referralErrorText({ message: 'permission denied' })], ['This referral has already been decided.', 'The referral could not be saved. Check your connection and try again.']);
eq('no long dash in the rule file', src.includes(String.fromCharCode(8212)), false);

// the screen and the data layer, behind the switch
const screen = read('/src/screens/referrals.tsx');
eq('the old list is not asked for while the new flow is on, and the reverse', [/useMyReferrals\(STAFF_REFERRAL_FLOW_ON \? null : userId\)/.test(screen), /useMyStaffReferrals\(STAFF_REFERRAL_FLOW_ON \? userId : null\)/.test(screen)], [true, true]);
eq('the sheet asks for a phone only in the new flow', /\{STAFF_REFERRAL_FLOW_ON \? \(\s*<View style=\{\{ gap: 6 \}\}>\s*\{label\('PHONE \*'\)\}/.test(screen), true);
eq('the new save is used only in the new flow, one id per opening of the sheet', [/if \(STAFF_REFERRAL_FLOW_ON\) \{\s*staffM\.mutate\(\{ id: saveIdRef\.current, name, phone, note: notes, clientId: linkedId, source \}/.test(screen), /setPhone\(''\); saveIdRef\.current = newSaveId\(\); staffM\.reset\(\);/.test(screen)], [true, true]);
eq('a refusal is shown in words and the sheet stays open', /if \(!res\.ok\) \{ sentRef\.current = false; Alert\.alert\('Referral not added', res\.message\); return; \}/.test(screen), true);
const data = read('/src/lib/staffReferralQueries.ts');
eq('the list key carries the user id; both calls have a timeout', [/queryKey: \['staff-referrals', 'mine', userId\]/.test(data), (data.match(/withTimeout<any>\(/g) || []).length], [true, 2]);
eq("the admin's approval list leaves out referrals that belong to a lead", /\.is\('lead_id', null\)/.test(read('/src/lib/adminRequestQueries.ts')), true);
eq("the tap on 'Your referral converted' opens My Referrals for trainers and doctors", /if \(t === 'referral_converted'\) \{ go\(dbRoleRef\.current === 'trainer' \|\| dbRoleRef\.current === 'doctor' \? 'referrals' : homeRouteFor\(roleRef\.current\)\); return; \}/.test(read('/src/components/PushTokenManager.tsx')), true);
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
