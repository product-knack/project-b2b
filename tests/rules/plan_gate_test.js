// Rule test for the Odds staff app. ROOT = the repo root; point it at the iOS repo and run: node tests/rules/plan_gate_test.js
const ROOT = require("path").resolve(__dirname, "../..");
// Plan-less session limit (22 Oct 2026): the server answer reader, the missing-function fallback, the PLAN_LIMIT
// refusal and its sentence, the IST day label, the blocked card copy.
const ts = require(ROOT + '/node_modules/typescript');
const fs = require('fs');
const src = fs.readFileSync(ROOT + '/src/lib/planGate.ts', 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const m = { exports: {} }; new Function('module', 'exports', 'require', js)(m, m.exports, require);
const P = m.exports;
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };

const server = { modality_key: 'strength', gated: true, essentials: false, enforced: true, has_valid_plan: false, plan_kind: 'none', last_approved_at: '2026-09-10T10:00:00+00:00', plan_expires_at: '2026-10-22T10:00:00+00:00', plan_expired: true, logged_count: 5, limit: 3, remaining: 0, blocked: true, client_name: 'Jasmeet', staff_exempt: false };
const g = P.parsePlanGate(server);
eq('parse: blocked and enforced', [g.blocked, g.enforced, g.gated], [true, true, true]);
eq('parse: counts', [g.loggedCount, g.limit, g.remaining], [5, 3, 0]);
eq('parse: expiry', [g.planExpired, g.planExpiresAt], [true, '2026-10-22T10:00:00+00:00']);
eq('parse: plan kind', g.planKind, 'none');
eq('parse: Essentials flag', P.parsePlanGate({ ...server, essentials: true, enforced: false }).enforced, false);
eq('parse: junk is null', P.parsePlanGate({ ok: true }), null);
eq('parse: null is null', P.parsePlanGate(null), null);
eq('parse: remaining falls back to limit minus count', P.parsePlanGate({ gated: true, logged_count: 1, limit: 3 }).remaining, 2);
eq('missing function (PostgREST)', P.isPlanGateMissing('PGRST202 Could not find the function public.get_workout_plan_gate'), true);
eq('missing function (plain)', P.isPlanGateMissing('Could not find the function public.get_workout_plan_gate(p_client_id, p_modality)'), true);
eq('other errors are not "missing"', P.isPlanGateMissing('PLAN_GATE_FORBIDDEN: staff only'), false);
const refusal = new Error("PLAN_LIMIT: Jasmeet has no approved Strength plan and 5 Strength sessions are already logged with this trainer (3 are allowed without a plan). Get the Strength plan approved, then log again.");
eq('refusal recognised', P.isPlanLimitError(refusal), true);
eq('refusal recognised as text', P.isPlanLimitError(refusal.message), true);
eq('other errors are not the refusal', P.isPlanLimitError(new Error('DUPLICATE_SESSION: Jasmeet already has a Strength session')), false);
eq('sentence without the code', P.planLimitText(refusal), 'Jasmeet has no approved Strength plan and 5 Strength sessions are already logged with this trainer (3 are allowed without a plan). Get the Strength plan approved, then log again.');
eq('sentence fallback', P.planLimitText('PLAN_LIMIT:'), P.PLAN_LIMIT_FALLBACK);
eq('IST day label', P.planDayLabel('2026-10-21T20:00:00Z'), '22 Oct 2026');
eq('IST day label, none', P.planDayLabel(null), null);
eq('blocked card, no plan', P.planBlockedText({ clientName: 'Jasmeet', modality: 'Strength', loggedCount: 5, planExpired: false, planExpiresAt: null }), "You've logged 5 Strength sessions for Jasmeet without an approved training plan. An approved Strength plan is required to log more.");
eq('blocked card, expired plan', P.planBlockedText({ clientName: 'Meenu Peshawari', modality: 'Strength', loggedCount: 100, planExpired: true, planExpiresAt: '2026-10-22T10:00:00+00:00' }), "Meenu Peshawari's Strength plan expired on 22 Oct 2026 and 100 Strength sessions are logged with you. A new approved Strength plan is required to log more.");
eq('no dashes in any copy', [P.PLAN_LIMIT_FALLBACK, P.planBlockedText({ clientName: 'A', modality: 'Yoga', loggedCount: 3, planExpired: true, planExpiresAt: '2026-10-22T10:00:00Z' })].some((s) => /—|–/.test(s)), false);
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
