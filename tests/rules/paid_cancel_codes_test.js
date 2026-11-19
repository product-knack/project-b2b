// Rule test for the Odds staff app. ROOT = the repo root; point it at the iOS repo and run: node tests/rules/paid_cancel_codes_test.js
const ROOT = require("path").resolve(__dirname, "../..");
// Paid cancellation codes on the CRM dashboard (19 Nov 2026): which rows of crm_daily_sessions are shown, their
// order, the IST day key and time, the copy.
const ts = require(ROOT + '/node_modules/typescript');
const fs = require('fs');
const src = fs.readFileSync(ROOT + '/src/lib/paidCancelCodes.ts', 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const m = { exports: {} }; new Function('module', 'exports', 'require', js)(m, m.exports, require);
const P = m.exports;
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };

const row = (o) => ({ id: 'x', scheduled_at: '2026-11-19T11:00:00+00:00', client_name: 'Asha Rao', trainer_name: 'Sagar K', modality: 'Strength', row_status: 'scheduled', otp: true, paid_cancellation_code: '4821', paid_cancel_verified_at: null, ...o });

eq('not an array', P.paidCancelCodeRows(null), []);
eq('scheduled Session-code member is shown', P.paidCancelCodeRows([row({})]).map((r) => r.code), ['4821']);
eq('switch off: hidden', P.paidCancelCodeRows([row({ otp: false })]), []);
eq('no code (rescheduled or not made): hidden', P.paidCancelCodeRows([row({ paid_cancellation_code: null })]), []);
eq('blank code: hidden', P.paidCancelCodeRows([row({ paid_cancellation_code: '  ' })]), []);
eq('logged session: hidden', P.paidCancelCodeRows([row({ row_status: 'completed' })]), []);
eq('cancelled without the code: hidden', P.paidCancelCodeRows([row({ row_status: 'cancelled' })]), []);
eq('cancelled with the code used: shown as used', P.paidCancelCodeRows([row({ row_status: 'cancelled', paid_cancel_verified_at: '2026-11-19T10:00:00+00:00' })]).map((r) => [r.status, !!r.verifiedAt]), [['cancelled', true]]);
eq('unknown status counts as scheduled', P.paidCancelCodeRows([row({ row_status: 'odd' })]).map((r) => r.status), ['scheduled']);
eq('ordered by time', P.paidCancelCodeRows([row({ id: 'b', scheduled_at: '2026-11-19T12:00:00Z' }), row({ id: 'a', scheduled_at: '2026-11-19T03:00:00Z' })]).map((r) => r.id), ['a', 'b']);
eq('blank names get plain words', P.paidCancelCodeRows([row({ client_name: ' ', trainer_name: null, modality: '' })]).map((r) => [r.clientName, r.trainerName, r.modality]), [['Client', 'Trainer', 'Session']]);

// 19 Nov 2026 20:00 IST = 14:30 UTC; 20 Nov 2026 01:00 IST = 19 Nov 19:30 UTC
eq('IST today in the evening', P.istDateKey(Date.parse('2026-11-19T14:30:00Z')), '2026-11-19');
eq('IST tomorrow', P.istDateKey(Date.parse('2026-11-19T14:30:00Z'), 1), '2026-11-20');
eq('IST day after midnight IST while UTC is still the day before', P.istDateKey(Date.parse('2026-11-19T19:30:00Z')), '2026-11-20');
eq('IST time afternoon', P.istTime('2026-11-19T11:00:00Z'), '4:30 PM');
eq('IST time noon', P.istTime('2026-11-19T06:30:00Z'), '12:00 PM');
eq('IST time just after midnight', P.istTime('2026-11-19T18:35:00Z'), '12:05 AM');
eq('IST time of nothing', P.istTime(null), '');
eq('empty line', P.paidCancelEmptyLine('tomorrow'), 'No session tomorrow needs a paid cancellation code.');
eq('used line', P.paidCancelVerifiedLine('2026-11-19T10:00:00Z'), 'Used by the trainer at 3:30 PM');
const copy = [P.PAID_CANCEL_CARD_TITLE, P.PAID_CANCEL_CARD_NOTE, P.paidCancelEmptyLine('today'), P.paidCancelVerifiedLine('2026-11-19T10:00:00Z')].join(' ');
eq('no dashes or OTP in the copy', /[–—]|OTP/.test(copy), false);

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
