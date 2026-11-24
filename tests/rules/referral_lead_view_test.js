// Rule test for the Odds staff app. ROOT = the repo root; point it at the iOS repo and run: node tests/rules/referral_lead_view_test.js
const ROOT = require("path").resolve(__dirname, "../..");
// node test of what the leads team and the client's CRM see of a staff referral in the app (24 Nov 2026):
// src/lib/referralLeadView.ts (the hot leads list, the flash card words, the lines of one submission),
// src/lib/referralWins.ts (the CRM celebration; the web's file), the screens switch, and the wiring.
const ts = require(ROOT + '/node_modules/typescript');
const fs = require('fs');
const read = (rel) => fs.readFileSync(ROOT + rel, 'utf8');
const cache = {};
const load = (name, globals = {}) => {
  const key = name + JSON.stringify(globals);
  if (cache[key]) return cache[key];
  const js = ts.transpileModule(read(`/src/lib/${name}.ts`), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const m = { exports: {} };
  const names = Object.keys(globals);
  new Function('module', 'exports', 'require', ...names, js)(m, m.exports, (n) => {
    if (n.startsWith('./')) return load(n.slice(2));
    throw new Error('unexpected require ' + n);
  }, ...names.map((k) => globals[k]));
  return (cache[key] = m.exports);
};
const V = load('referralLeadView');
const W = load('referralWins');
const R = load('staffReferral');
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };

const TODAY = '2026-11-24';
const first = { kind: 'staff_referral', author_name: 'Raj Thakur', referrer_role: 'trainer', date: '2026-11-20T06:00:00Z', through_client: 'Asha Verma', relation: 'Friend', referred_name: 'Kabir Shah', note: 'Wants evening slots' };
const dup = { kind: 'staff_referral', author_name: 'Pallavi Mishra', referrer_role: 'crm', date: '2026-11-24T09:30:00Z', duplicate: true, last_referred_on: '2026-11-24', through_client: 'Neha Rao', relation: 'Sibling', referred_name: 'Kabir S', previous_lead_date: '2026-10-03', first_lead_date: '2026-10-03', previous_stage: 'Lost', previous_source: 'Instagram' };
const dupOld = { ...dup, last_referred_on: '2026-11-10', date: '2026-11-10T09:30:00Z' };
const plain = { text: 'Called, no answer', date: '2026-11-21T06:00:00Z', author_name: 'Preeti' };

// ---- the hot leads list
eq('days back from a day', [V.daysAgoYmd('2026-11-24', 7), V.daysAgoYmd('2026-03-02', 7), V.hotLeadsSince('2026-11-24')], ['2026-11-17', '2026-02-23', '2026-11-17']);
const rows = [
  { id: 'a', name: 'Kabir Shah', contact_no: ' 9876543210 ', stage: 'New', remarks: [first, dup] },
  { id: 'b', name: 'Old One', contact_no: null, stage: 'New', remarks: [dupOld] },            // referred again 14 days ago
  { id: 'c', name: 'Closed One', contact_no: '1', stage: 'Converted', remarks: [dup] },        // already converted
  { id: 'd', name: 'New Number', contact_no: '2', stage: 'New', remarks: [first] },            // a new number, not a duplicate
  { id: 'e', name: 'Aarav', contact_no: '3', stage: 'Follow Up', remarks: [{ ...dup, last_referred_on: '2026-11-23' }] },
  { id: 'a', name: 'Kabir Shah', contact_no: '9876543210', stage: 'New', remarks: [first, dup] }, // the same lead twice
  null, 'x', { name: 'no id', remarks: [dup] },
];
const hot = V.hotLeadsFrom(rows, TODAY);
eq('hot = referred again in the last 7 days and still open, newest referral first, no repeats', hot.map((l) => [l.id, l.on, l.when]), [['a', '2026-11-24', 'today'], ['e', '2026-11-23', 'yesterday']]);
eq('the line on the card says who referred again, whose referral, and when the lead first came', hot[0].line, 'Referred again today by Pallavi Mishra (CRM), referral of Neha Rao (Sibling). First came on 3 Oct 2026, source Instagram.');
eq('the phone is tidied, an empty one is left out', [hot[0].phone, V.hotLeadsFrom([{ id: 'z', name: 'Z', contact_no: '  ', stage: 'New', remarks: [dup] }], TODAY)[0].phone], ['9876543210', null]);
eq('nothing hot from nothing', [V.hotLeadsFrom(null, TODAY), V.hotLeadsFrom([], TODAY), V.hotLeadsFrom([{ id: 'p', name: 'P', stage: 'New', remarks: [plain] }], TODAY)], [[], [], []]);
eq('the same rule as the tag on the row', hot.map((l) => R.leadHotReferral(rows.find((r) => r && r.id === l.id).remarks, l.stage, TODAY).hot), [true, true]);

// ---- the words
eq('the flash card title', [V.hotFlashTitle(1), V.hotFlashTitle(4)], ['1 hot lead: referred again by the team', '4 hot leads: referred again by the team']);
eq('the flash card line', [V.hotFlashSub(1), V.hotFlashSub(2)], ['We had this person as a lead before and they did not convert. Call first.', 'We had these people as a lead before and they did not convert. Call first.']);
eq('the line while the hot view is on', [V.hotActiveLine(1), V.hotActiveLine(3)], ['Showing 1 hot lead, referred again in the last 7 days', 'Showing 3 hot leads, referred again in the last 7 days']);
eq('the short day on the dashboard banner', [V.hotWhenShort(hot[0]), V.hotWhenShort(hot[1]), V.hotWhenShort({ when: 'on 20 Nov 2026', on: '2026-11-20' })], ['TODAY', 'YESTERDAY', '20 NOV 2026']);

// ---- the lead's sheet
eq('no referral part for a lead no member referred', [V.leadReferralView([plain]), V.leadReferralView(null)], [null, null]);
const one = V.leadReferralView([plain, first]);
eq('one submission of a new number', [one.title, one.sub, one.info.times, one.info.duplicate], ['Referral', 'Submitted by a team member.', 1, false]);
const two = V.leadReferralView([first, plain, dup]);
eq('the same number submitted twice: both are listed', [two.title, two.sub, two.info.entries.map((e) => e.member)], ['Duplicate referral', 'This number was submitted 2 times. Every submission is listed.', ['Raj Thakur (Trainer)', 'Pallavi Mishra (CRM)']]);
const onLead = V.leadReferralView([dup]);
eq('a number that was already a lead', [onLead.title, onLead.sub], ['Duplicate referral', 'This number was already a lead when it was referred.']);
eq('the lines of the first submission', V.referralEntryLines(two.info.entries[0]), [
  { label: 'Client who referred', value: 'Asha Verma' }, { label: 'Relation', value: 'Friend' }, { label: 'Name given', value: 'Kabir Shah' }, { label: 'Note', value: 'Wants evening slots' },
]);
eq('the lines of a duplicate keep what the lead was before it was moved to today', V.referralEntryLines(two.info.entries[1]), [
  { label: 'Client who referred', value: 'Neha Rao' }, { label: 'Relation', value: 'Sibling' }, { label: 'Name given', value: 'Kabir S' },
  { label: 'Before this referral', value: 'lead date 3 Oct 2026, stage Lost, source Instagram' },
]);
const moved = R.leadReferralInfo([{ ...dup, previous_lead_date: '2026-11-10', first_lead_date: '2026-10-03' }]).entries[0];
eq('a lead moved more than once also says when it first came', V.referralEntryLines(moved).slice(-2), [{ label: 'Before this referral', value: 'lead date 10 Nov 2026, stage Lost, source Instagram' }, { label: 'First came on', value: '3 Oct 2026' }]);
eq('a submission with nothing else says so', V.referralEntryLines(R.leadReferralInfo([{ kind: 'staff_referral', author_name: 'A' }]).entries[0]), [{ label: '', value: 'No other details were given.' }]);

// ---- the Ops decision card
eq('the day of a moment, in India', [V.creditDay('2026-11-23T20:00:00Z'), V.creditDay('2026-11-23T10:00:00Z'), V.creditDay(null), V.creditDay('x')], ['24 Nov 2026', '23 Nov 2026', '', '']);
eq('the decision card title', [V.creditQueueTitle(1), V.creditQueueTitle(3)], ['1 converted lead needs a referral decision', '3 converted leads need a referral decision']);

// ---- the CRM celebration (the web's rules file)
const wins = W.readReferralWins([
  { lead_id: 'L1', client_id: 'C1', client_name: 'Asha Verma', joined_name: 'Kabir Shah', joined_on: '2026-12-02', relation: 'Friend', submitted_by: 'Raj Thakur (Trainer)' },
  { lead_id: 'L1', client_id: 'C1', client_name: 'Asha Verma', joined_name: 'Kabir Shah', joined_on: '2026-12-02' },
  { lead_id: 'L2', client_id: 'C1', joined_name: 'Meera' }, { lead_id: 'L3', joined_name: 'No client' }, null,
]);
eq('one card per client per person who joined', wins.map((w) => w.key), ['L1:C1', 'L2:C1']);
eq('the words on the card', [W.winHeadline(wins[0]), W.winLine(wins[0]), W.winAsk(wins[0]), W.winLine(wins[1])], [
  "Asha Verma's referral has joined Odds!", 'Kabir Shah (Friend) became a member on 2 Dec 2026.',
  'Congratulate Asha Verma and tell them about their free week of training (sessions as per their current package).', 'Meera became a member.',
]);
eq("the rules file is the web's, line for line", read('/src/lib/referralWins.ts').includes('get_my_client_referral_wins') && !read('/src/lib/referralWins.ts').includes('\r'), true);

// ---- the screens switch: the release switch, or a development run
eq('THE RELEASE SWITCH IS OFF', R.STAFF_REFERRAL_FLOW_ON, false);
eq('the new screens are off in a build people install, on in a development run', [load('staffReferralSwitch').REFERRAL_SCREENS_ON, load('staffReferralSwitch', { __DEV__: false }).REFERRAL_SCREENS_ON, load('staffReferralSwitch', { __DEV__: true }).REFERRAL_SCREENS_ON], [false, false, true]);

// ---- the wiring
const leads = read('/src/screens/opsLeads.tsx');
const ops = read('/src/screens/ops.tsx');
const crm = read('/src/screens/crm.tsx');
const bits = read('/src/components/referralLeadBits.tsx');
const q = read('/src/lib/referralLeadQueries.ts');
const nav = read('/src/data.ts');
const chrome = read('/src/components/chrome.tsx');
const screen = read('/src/screens/referrals.tsx');
eq('the Leads screen: flash card, the hot view, both tags on the row and in the sheet, every submission in the sheet', [
  /<HotReferralFlash/.test(leads), /quick === 'hot'\) \{ f\.onlyIds = hotIds \? hotIds\.split\(','\) : \[\];/.test(leads),
  (leads.match(/<HotLeadTag remarks=/g) || []).length, (leads.match(/<LeadReferredTag remarks=/g) || []).length, /<LeadReferralDetails remarks=\{lead\.remarks\} stage=\{lead\.stage\} \/>/.test(leads),
], [true, true, 2, 2, true]);
eq('the hot view ends by itself when no hot lead is left', /if \(quick === 'hot' && hotQ\.isSuccess && !hotIds\) setQuick\('all'\)/.test(leads), true);
eq('the tags and the flash card are NOT behind the release switch (they draw only for a referred lead)', [/REFERRAL_SCREENS_ON|STAFF_REFERRAL_FLOW_ON/.test(leads), /enabled = REFERRAL_SCREENS_ON/.test(bits)], [false, true]);
eq('the hot list reads only leads of the last days that carry a duplicate referral, refreshes with the Leads screen, and has a timeout', [
  /queryKey: \['leads', 'hot-referrals'\]/.test(q), /\.gte\('lead_date', hotLeadsSince\(today\)\)/.test(q), /\.contains\('remarks', JSON\.stringify\(\[\{ kind: 'staff_referral', duplicate: true \}\]\)\)/.test(q),
  (q.match(/withTimeout<any>\(/g) || []).length,
], [true, true, true, 5]);
eq('the Ops dashboard: the hot leads banner opens the hot view, and the referral decision card', [/cta="View" onPress=\{\(\) => goLeads\('hot'\)\}/.test(ops), /<ReferralCreditAlert \/>/.test(ops), /'potential', 'converted', 'hot'\]\.includes\(crmSection\)/.test(leads)], [true, true, true]);
eq('the CRM dashboard: the celebration, for a CRM only, saved on the server', [/<ClientReferralCelebration \/>/.test(crm), /enabled && dbRole === 'crm' && !!userId/.test(bits), /rpc\('mark_referral_congratulated', \{ p_lead: input\.leadId, p_client: input\.clientId \}\)/.test(q)], [true, true, true]);
eq('My Referrals is in the CRM and the Ops menus, shown with the new screens', [(nav.match(/\{ label: 'My Referrals', icon: 'userPlus', route: 'referrals' \}/g) || []).length, /if \(it\.route === 'referrals' && it\.label === 'My Referrals'\) return REFERRAL_SCREENS_ON;/.test(chrome)], [2, true]);
eq('the Referrals screen follows the screens switch', [/STAFF_REFERRAL_FLOW_ON/.test(screen), /from '\.\.\/lib\/staffReferralSwitch'/.test(screen)], [false, true]);
eq('no long dash in the words people read', [bits, read('/src/lib/referralLeadView.ts')].map((s) => new RegExp('[' + String.fromCharCode(0x2013, 0x2014) + ']').test(s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''))), [false, false]);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
