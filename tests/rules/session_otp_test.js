// Rule test for the Odds staff app. ROOT = the repo root; point it at the iOS repo and run: node tests/rules/session_otp_test.js
const ROOT = require("path").resolve(__dirname, "../..");
// Session OTP pure rules (20 Oct 2026): the gate decision, the reason copy, the gate error check, the parser.
const ts = require(ROOT + '/node_modules/typescript');
const fs = require('fs');
const src = fs.readFileSync(ROOT + '/src/lib/sessionOtp.ts', 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const m = { exports: {} }; new Function('module', 'exports', 'require', js)(m, m.exports, require);
const O = m.exports;
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };

eq('gate: flag on, no status', O.otpGateNeeded(true, undefined), true);
eq('gate: flag on, pending', O.otpGateNeeded(true, { status: 'pending', verified_at: null, couple: false }), true);
eq('gate: flag on, verified', O.otpGateNeeded(true, { status: 'verified', verified_at: 'x', couple: false }), false);
eq('gate: flag off', O.otpGateNeeded(false, { status: 'pending', verified_at: null, couple: false }), false);
eq('gate: flag unknown (row not readable) = no step', O.otpGateNeeded(undefined, undefined), false);
eq('reason invalid', O.otpReasonText('invalid'), 'OTP not valid. Ask the member for the code again.');
eq('reason cancelled', O.otpReasonText('cancelled'), 'This session is cancelled, so its code cannot be used.');
eq('reason no_otp', O.otpReasonText('no_otp'), "No code exists for this session yet. Ask CRM to check the member's OTP setting.");
eq('reason not_your_session', O.otpReasonText('not_your_session'), 'This session belongs to another trainer.');
eq('reason not_authenticated', O.otpReasonText('not_authenticated'), 'You are signed out. Sign in again and retry.');
eq('reason unknown', O.otpReasonText('something'), 'The code could not be verified.');
eq('gate error: raw server text', O.isOtpGateError(new Error("OTP_NOT_VERIFIED: this member's session code has not been verified for this session")), true);
eq('gate error: friendly text', O.isOtpGateError(O.OTP_GATE_MESSAGE), true);
eq('gate error: other', O.isOtpGateError(new Error('DUPLICATE_SLOT: already logged')), false);
eq('parse ok', O.parseVerifyAnswer({ ok: true, already_verified: false, verified_at: '2026-10-20T10:00:00Z', verified_count: 2 }), { ok: true, already_verified: false, verified_at: '2026-10-20T10:00:00Z', verified_count: 2 });
eq('parse not ok', O.parseVerifyAnswer({ ok: false, reason: 'invalid' }), { ok: false, reason: 'invalid' });
eq('parse junk', O.parseVerifyAnswer(null).ok, false);
eq('digits only, max four', O.otpDigits('12a3-45'), '1234');
eq('body copy single', O.otpSheetBody('Vashist', false), 'Ask Vashist for the 4-digit code CRM sent them. The workout opens once it is verified.');
eq('body copy couple', O.otpSheetBody('Vashist', true).endsWith(' One code covers both partners today.'), true);
eq('no dashes in any copy', [O.OTP_GATE_MESSAGE, O.OTP_OFFLINE_MESSAGE, O.OTP_NETWORK_MESSAGE, O.otpReasonText('invalid'), O.otpSheetBody('A', true)].some((s) => s.includes('—')), false);
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
