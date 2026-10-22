// Rule test for the Odds staff app. ROOT = the repo root; point it at the iOS repo and run: node tests/rules/session_otp_test.js
const ROOT = require("path").resolve(__dirname, "../..");
// Session OTP pure rules (20 Oct 2026; offline 21 Oct 2026): the gate decision incl. a code saved on the phone,
// the couple cover of a saved code, the reason copy incl. expired, the gate error check, the refused-sync
// reason parser, the workout error line, the parser, the IST day.
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
eq('gate: flag on, pending, code saved on this phone = no step', O.otpGateNeeded(true, { status: 'pending', verified_at: null, couple: false }, true), false);
eq('gate: flag on, pending, saved false = step', O.otpGateNeeded(true, { status: 'pending', verified_at: null, couple: false }, false), true);

const saved = [{ scheduleId: 'A', clientId: 'c1', coupleGroupId: 'g1', day: '2026-10-21', enteredAt: '2026-10-21T13:02:00.000Z' }];
eq('saved covers its own slot', O.savedOtpCovers(saved, 'A', { status: 'pending', verified_at: null, couple: true, coupleGroupId: 'g1' }, '2026-10-21'), true);
eq('saved covers the partner slot, same couple, same day', O.savedOtpCovers(saved, 'B', { status: 'pending', verified_at: null, couple: true, coupleGroupId: 'g1' }, '2026-10-21'), true);
eq('saved does not cover another couple', O.savedOtpCovers(saved, 'B', { status: 'pending', verified_at: null, couple: true, coupleGroupId: 'g2' }, '2026-10-21'), false);
eq('saved does not cover the partner on another day', O.savedOtpCovers(saved, 'B', { status: 'pending', verified_at: null, couple: true, coupleGroupId: 'g1' }, '2026-10-22'), false);
eq('saved does not cover an unrelated slot', O.savedOtpCovers(saved, 'C', { status: 'pending', verified_at: null, couple: false, coupleGroupId: null }, '2026-10-21'), false);
eq('a single saved code never covers through a null group', O.savedOtpCovers([{ scheduleId: 'A', clientId: 'c1', coupleGroupId: null, day: '2026-10-21', enteredAt: 'x' }], 'B', { status: 'pending', verified_at: null, couple: false, coupleGroupId: null }, '2026-10-21'), false);
eq('nothing saved', O.savedOtpCovers([], 'A', undefined, '2026-10-21'), false);

eq('reason invalid', O.otpReasonText('invalid'), 'Session code not valid. Ask the member for the code again.');
eq('reason cancelled', O.otpReasonText('cancelled'), 'This session is cancelled, so its code cannot be used.');
eq('reason no_otp', O.otpReasonText('no_otp'), "No code exists for this session yet. Ask CRM to check the member's Session code setting.");
eq('reason not_your_session', O.otpReasonText('not_your_session'), 'This session belongs to another trainer.');
eq('reason not_authenticated', O.otpReasonText('not_authenticated'), 'You are signed out. Sign in again and retry.');
eq('reason expired', O.otpReasonText('expired'), 'The code was typed on a different day than the session, so it cannot be used.');
eq('reason unknown', O.otpReasonText('something'), 'The code could not be verified.');
// 2-hour validity (22 Oct 2026)
eq('reason code_expired', O.otpReasonText('code_expired'), 'This code has expired. A code works until 2 hours after the session, and the member has been sent a new one. Ask them for it.');
eq('workout line: code ran out before it was typed offline', O.workoutOtpErrorText('code_expired'), 'The code had already expired when it was typed. The member has been sent a new code. Verify it now, then Retry.');
eq('queued failure reason code_expired is read back', O.verifyFailureReason(new Error('OTP_VERIFY_FAILED:code_expired')), 'code_expired');
eq('sheet body names the 2 hours', O.otpSheetBody('Asha', false).endsWith('A code works until 2 hours after the session.'), true);
eq('sheet body couple keeps both lines', O.otpSheetBody('Asha', true).includes('One code covers both partners today. A code works until 2 hours'), true);
// Paid cancellation code (22 Oct 2026)
eq('ask line with number', O.askCrmLine({ name: 'Priya Sharma', phone: '98765 43210' }), 'Ask Priya Sharma (98765 43210)');
eq('ask line without number', O.askCrmLine({ name: 'Priya Sharma', phone: null }), 'Ask Priya Sharma (no number on file)');
eq('ask line no CRM', O.askCrmLine(null), 'This member has no CRM assigned. Ask the admin for the code.');
eq('paid reasons', ['invalid', 'already_used', 'cancelled', 'no_code', 'x'].map(O.paidCancelReasonText), ['Paid cancellation code not valid. Ask CRM for the code again.', 'This code was already used for a paid cancellation of this session.', 'This session is already cancelled.', 'No paid cancellation code exists for this session. Ask CRM to check the member’s Session code setting.', 'The code could not be verified.']);
eq('gate error detected', [O.isPaidCancelGateError(new Error('PAID_CANCEL_CODE_REQUIRED: enter the code')), O.isPaidCancelGateError(new Error('other'))], [true, false]);
eq('intro names the member', O.PAID_CANCEL_INTRO('Asha').startsWith('If you want a paid cancellation for Asha, get the 4-digit paid cancellation code from CRM first.'), true);
eq('no dashes in the paid copy', /[–—]| - /.test(O.PAID_CANCEL_GATE_MESSAGE + O.PAID_CANCEL_NOTICE + O.PAID_CANCEL_INTRO('A') + O.askCrmLine(null)), false);
eq('no dashes in the new copy', /[–—]| - /.test(O.OTP_CODE_EXPIRED_MESSAGE + O.OTP_CODE_EXPIRED_AT_SYNC_MESSAGE + O.otpSheetBody('A', true)), false);
eq('gate error: raw server text', O.isOtpGateError(new Error("OTP_NOT_VERIFIED: this member's session code has not been verified for this session")), true);
eq('gate error: friendly text', O.isOtpGateError(O.OTP_GATE_MESSAGE), true);
eq('gate error: other', O.isOtpGateError(new Error('DUPLICATE_SLOT: already logged')), false);
eq('refused sync reason parsed', O.verifyFailureReason(new Error('OTP_VERIFY_FAILED:invalid')), 'invalid');
eq('refused sync reason expired', O.verifyFailureReason('OTP_VERIFY_FAILED:expired'), 'expired');
eq('refused sync reason absent', O.verifyFailureReason(new Error('network request failed')), null);
eq('workout line: wrong code at sync', O.workoutOtpErrorText('invalid'), O.OTP_WRONG_AT_SYNC_MESSAGE);
eq('workout line: expired at sync', O.workoutOtpErrorText('expired'), O.OTP_EXPIRED_AT_SYNC_MESSAGE);
eq('workout line: other reason', O.workoutOtpErrorText('cancelled'), 'This session is cancelled, so its code cannot be used. Then Retry.');
eq('workout line: no saved failure = gate copy', O.workoutOtpErrorText(null), O.OTP_GATE_MESSAGE);
eq('parse ok', O.parseVerifyAnswer({ ok: true, already_verified: false, verified_at: '2026-10-20T10:00:00Z', verified_count: 2 }), { ok: true, already_verified: false, verified_at: '2026-10-20T10:00:00Z', verified_count: 2 });
eq('parse not ok', O.parseVerifyAnswer({ ok: false, reason: 'invalid' }), { ok: false, reason: 'invalid' });
eq('parse junk', O.parseVerifyAnswer(null).ok, false);
eq('digits only, max four', O.otpDigits('12a3-45'), '1234');
eq('body copy single', O.otpSheetBody('Vashist', false), 'Ask Vashist for the 4-digit code CRM sent them. The workout opens once it is verified. A code works until 2 hours after the session.');
eq('body copy couple', O.otpSheetBody('Vashist', true).includes(' One code covers both partners today.'), true);
eq('IST day: 21 Oct 23:30 IST is 21 Oct', O.istDayOf(Date.UTC(2026, 9, 21, 18, 0)), '2026-10-21');
eq('IST day: 21 Oct 18:31 UTC is 22 Oct IST', O.istDayOf(Date.UTC(2026, 9, 21, 18, 31)), '2026-10-22');
eq('no dashes in any copy', [O.OTP_GATE_MESSAGE, O.OTP_OFFLINE_MESSAGE, O.OTP_NETWORK_MESSAGE, O.OTP_SAVED_HINT, O.OTP_WRONG_AT_SYNC_MESSAGE, O.OTP_EXPIRED_AT_SYNC_MESSAGE, O.otpReasonText('invalid'), O.otpReasonText('expired'), O.otpSheetBody('A', true)].some((s) => s.includes('—')), false);
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
