# iOS handoff: Plan-less session limit from the server (Android since 22 Oct 2026)

Android commit 4763636 (22 Oct 2026, build 5.1 (37)). Owner: "except the Essentials subscription type, if a client
does not have an approved plan for that modality, only 3 sessions may be logged; after that it must not allow it".
Until 22 Oct the rule lived only in the apps, counted on the device, and an offline queue or a stale cached answer
walked past it (a 4th and 5th Strength log with no plan ever approved, 15 Oct). Since hub-track migration
`20261022120000_workout_plan_session_limit.sql` the server holds the rule and refuses the 4th session on every path,
the iOS offline queue included. Android now: reads the server's answer to show the counter and stop the form early,
asks the server again at Submit, and shows a `PLAN_LIMIT` refusal as the server's own sentence, never retried.
Essentials clients are not enforced on the server; the app keeps blocking them on the device as before, now with
the server's numbers.

Server state: LIVE. Probed read only on 2 Nov 2026: an anon call to `get_workout_plan_gate` answers
`42501 permission denied for function get_workout_plan_gate` (the function exists; `PGRST202` would mean missing).
Nothing to run on the server. Without this port, iOS still cannot log the 4th session (the server refuses it), but
its counter is the device's own count, which can differ from the server's, and nothing turns the refusal into its
sentence.

## 1. What the user sees (Android)
In Add Workout, at the top of the form, for a modality that has plans (Strength, Yoga, Pilates, Boxing, Aerobics,
Aqua Aerobics) and a client without a valid plan of it. The texts use the form's modality label (`modLabel`, e.g.
"Strength") and the client's name.
- **Blue card** (2 or more sessions left): "No approved Strength plan", under it "3 plan-less sessions left before
  a plan is required." (or "2 plan-less sessions left before a plan is required.").
- **Gold card** (1 left): "Approaching limit · 2/3", under it "1 plan-less session left before a plan is required."
- **Red card** (blocked), title "Session limit reached", then one sentence, then the button "Create Training Plan"
  (opens the plan builder). Submit Workout is disabled.
  - No plan of this modality was ever approved: "You've logged 3 Strength sessions for Jasmeet without an approved
    training plan. An approved Strength plan is required to log more."
  - An exercise plan that lapsed: "Meenu Peshawari's Strength plan expired on 22 Oct 2026 and 100 Strength sessions
    are logged with you. A new approved Strength plan is required to log more." (the date is the plan's expiry in
    IST).
- **At Submit**, online and not editing a queued log, the form asks the server again. If the answer is now blocked
  (a session was logged elsewhere, or the plan was sent back, since the form opened): an alert titled "Session limit
  reached" with the red card's sentence followed by " Create and get a Strength plan approved to continue." Nothing
  is saved. Offline, the cached answer stands and the server decides at sync.
- **The server refused the log** (it was queued offline, or the cached answer was out of date): the server's
  sentence without its "PLAN_LIMIT: " code, for example "Jasmeet has no approved Strength plan and 3 Strength
  sessions are already logged with this trainer (3 are allowed without a plan). Get the Strength plan approved, then
  log again." or "Meenu Peshawari's Strength plan expired on 22 Oct 2026 and 3 Strength sessions are already logged
  with this trainer (3 are allowed without a plan). Get a new Strength plan approved, then log again."
  - in the form's red "Sync failed" card (when the refusal comes back to the form's own Submit);
  - on Home → Waiting to Sync: badge "Sync failed" and the same sentence. The item is never retried by itself;
    Retry, Edit and Discard work as for any failed item.
  - When the server sends the code with no sentence: "Plan limit reached: 3 sessions are logged without an approved
    plan. Get the plan approved, then Retry."
- **No card**: a client with a valid plan for the modality, and modalities without plans (custom, other,
  rehabilitation, recovery, therapy).
- **Essentials clients**: the same cards and the same block on the phone. The server accepts their logs.
- Unchanged: the hint line above the Submit button for the blocked state keeps iOS's existing text.

## 2. Data / server contract
### 2.1 The read: `get_workout_plan_gate(p_client_id uuid, p_modality text) returns jsonb`
- `SECURITY DEFINER`, `STABLE`, `search_path = public`. EXECUTE granted to `authenticated`, revoked from `PUBLIC`
  and `anon`. Read only.
- The trainer is the caller (`auth.uid()`); there is no trainer argument. `p_modality` is any spelling ("strength",
  "Strength Training", "Aqua Aerobics"); the server reduces it with `session_modality_key`.
- Refusals: `PLAN_GATE_FORBIDDEN: not signed in` (no session) and `PLAN_GATE_FORBIDDEN: staff only` (no profile,
  or role `client`), both SQLSTATE `42501`.
- App call: `supabase.rpc('get_workout_plan_gate', { p_client_id: clientId, p_modality: modality })`.

Answer fields (the body is `workout_plan_gate_eval(p_client_id, auth.uid(), p_modality, null)` plus
`staff_exempt`):

| Field | Type | Meaning |
|---|---|---|
| `modality_key` | text | the reduced key, e.g. `strength`, `aquaaerobics` |
| `gated` | boolean | the modality has plans: key in `strength`, `yoga`, `pilates`, `boxing`, `aerobics`, `aquaaerobics` |
| `essentials` | boolean | `essentials_is_plan(clients.subscription_type)` |
| `enforced` | boolean | `gated and not essentials`: the server refuses the 4th session |
| `has_valid_plan` | boolean | an approved `workout_plan_exercises` plan of this modality for the client (any trainer) still inside its validity, or any approved `client_training_plans` row |
| `plan_kind` | text | `exercise`, `document` or `none`: what made it valid |
| `last_approved_at` | timestamptz or null | newest `approved_at` of an approved plan of this modality |
| `plan_expires_at` | timestamptz or null | `last_approved_at` + `workout_plan_validity_days(subscription_type)` days (42 for every tier today; 42 when that returns null) |
| `plan_expired` | boolean | an exercise plan existed and has lapsed, and no approved uploaded plan |
| `logged_count` | integer | non-cancelled `training_sessions` of this client + the calling trainer + this modality key, all time |
| `limit` | integer | 3 |
| `remaining` | integer | `greatest(0, 3 - logged_count)` |
| `blocked` | boolean | `gated and not has_valid_plan and logged_count >= 3` (true for Essentials too) |
| `client_name` | text or null | first and last name |
| `staff_exempt` | boolean | caller is `admin`, `super_admin`, `crm` or `ops` (the insert check lets them pass) |

The app reads every field except `modality_key`, `client_name` and `staff_exempt`. Example (the test's fixture):
```json
{ "modality_key": "strength", "gated": true, "essentials": false, "enforced": true, "has_valid_plan": false,
  "plan_kind": "none", "last_approved_at": "2026-09-10T10:00:00+00:00", "plan_expires_at": "2026-10-22T10:00:00+00:00",
  "plan_expired": true, "logged_count": 5, "limit": 3, "remaining": 0, "blocked": true,
  "client_name": "Jasmeet", "staff_exempt": false }
```

### 2.2 The refusal at insert: `PLAN_LIMIT`
- Trigger `trg_zz_workout_plan_limit`, `BEFORE INSERT ON training_sessions FOR EACH ROW`, function
  `enforce_workout_plan_limit()`. It runs after the same-day duplicate guard (`trg_zz_prevent_duplicate_session_log`,
  name order), so a second session the same day is refused as `DUPLICATE_SESSION` first.
- Passes without a check: a cancelled row, a row without client or trainer, a modality without plans, staff
  (`admin`, `super_admin`, `crm`, `ops`) and service-role writes. Takes the per client + trainer advisory lock that
  the other session guards use, so two queued logs syncing at once cannot both be the 3rd.
- Refuses when `enforced and blocked` (counted without the new row), so never for Essentials. `RAISE EXCEPTION`
  without an ERRCODE (SQLSTATE `P0001`), one of two sentences:
```sql
-- the client had an exercise plan of this modality and it lapsed
'PLAN_LIMIT: %''s % plan expired on % and % % sessions are already logged with this trainer (3 are allowed without a plan). Get a new % plan approved, then log again.'
--   name, label, plan_expires_at in IST as 'FMDD Mon YYYY' (22 Oct 2026), logged_count, label, label
-- otherwise
'PLAN_LIMIT: % has no approved % plan and % % sessions are already logged with this trainer (3 are allowed without a plan). Get the % plan approved, then log again.'
--   name, label, logged_count, label, label
```
  The label is `Strength`, `Aqua Aerobics`, else `initcap(key)` (`Yoga`, `Pilates`, `Boxing`, `Aerobics`); the name
  is the client's first and last name, else "This client".
- A workout log reaches it through `auto_create_training_session` (the trigger on `workout_exercises` that creates
  the session), so the whole `workout_exercises` insert fails with this message and no exercise row lands.
  `submitWorkoutLog` already ends its insert error handling with `throw new Error(error.message)`, so the outbox
  sees the full message, "PLAN_LIMIT: ..." included. Health check-in values that ride in the same outbox item are
  written before the workout insert and stay written.

### 2.3 App cache
- Query key `['modality-gate', 'v2', clientId, trainerId, normModality(modality)]` (v2 so persisted device answers
  are not reused), `staleTime` 30 s, persisted with the rest (the `modality-gate` prefix is in `App.tsx`
  `PERSIST_PREFIXES`). No invalidation was added.
- While the function is missing (PGRST202) the old device count is the fallback (`source: 'device'`); other read
  errors fail the query, so no card shows and the server still decides at insert.

## 3. Code to port
Copy rule: `planGate.ts` and its test are copied whole, byte for byte (one noted exception in the test, below).
The other blocks are the exact Android code at HEAD (2 Nov 2026); the lines that are new are named under each block.

### 3.1 `src/lib/planGate.ts` (new file, 90 lines, no native imports)
```ts
/* Plan-less session limit, the pure rules (22 Oct 2026). Owner: "except the Essentials subscription type, if a
   client does not have an approved plan for that modality, only 3 sessions may be logged; after that it must not
   allow it". Since hub-track migration 20261022120000 the server holds the rule (workout_plan_gate_eval) and
   refuses the 4th session with PLAN_LIMIT on every path, the offline queue included; the app reads the same
   answer through get_workout_plan_gate to show the counter and to stop the form early. Essentials clients are not
   enforced on the server (owner: leave them as they are); the app keeps blocking them on the device, as before,
   with the server's numbers. No native imports here. */

export const PLAN_LIMIT_PREFIX = 'PLAN_LIMIT';
export const PLANLESS_LIMIT = 3;
export const PLAN_LIMIT_FALLBACK = 'Plan limit reached: 3 sessions are logged without an approved plan. Get the plan approved, then Retry.';

export type PlanGateAnswer = {
  /** A modality that has workout plans (Strength, Yoga, Pilates, Boxing, Aerobics, Aqua Aerobics). */
  gated: boolean;
  essentials: boolean;
  /** The server refuses the 4th session (gated and not Essentials). */
  enforced: boolean;
  hasValidPlan: boolean;
  planKind: 'exercise' | 'document' | 'none';
  lastApprovedAt: string | null;
  planExpiresAt: string | null;
  planExpired: boolean;
  loggedCount: number;
  limit: number;
  remaining: number;
  blocked: boolean;
};

const bool = (v: unknown) => v === true;
const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown) => (typeof v === 'string' && v ? v : null);

/** Tolerant reader of get_workout_plan_gate's json. Null when the answer is unreadable. */
export const parsePlanGate = (data: unknown): PlanGateAnswer | null => {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (typeof d.gated !== 'boolean' || typeof d.logged_count !== 'number') return null;
  const limit = num(d.limit, PLANLESS_LIMIT);
  const loggedCount = num(d.logged_count);
  const kind = d.plan_kind === 'exercise' || d.plan_kind === 'document' ? d.plan_kind : 'none';
  return {
    gated: bool(d.gated),
    essentials: bool(d.essentials),
    enforced: bool(d.enforced),
    hasValidPlan: bool(d.has_valid_plan),
    planKind: kind,
    lastApprovedAt: str(d.last_approved_at),
    planExpiresAt: str(d.plan_expires_at),
    planExpired: bool(d.plan_expired),
    loggedCount,
    limit,
    remaining: Math.max(0, num(d.remaining, limit - loggedCount)),
    blocked: bool(d.blocked),
  };
};

/** The server function is not installed yet (before the migration runs): use the device's own count. */
export const isPlanGateMissing = (message: unknown): boolean =>
  /PGRST202|could not find the function|get_workout_plan_gate.*(does not exist|not found)/i.test(String(message ?? ''));

/** True for the server's refusal of the 4th plan-less session. */
export const isPlanLimitError = (e: unknown): boolean => String((e as any)?.message ?? e ?? '').includes(PLAN_LIMIT_PREFIX);

/** The server's sentence without its code ("Jasmeet has no approved Strength plan and 5 Strength sessions ..."). */
export const planLimitText = (e: unknown): string => {
  const msg = String((e as any)?.message ?? e ?? '');
  const i = msg.indexOf(PLAN_LIMIT_PREFIX);
  if (i < 0) return PLAN_LIMIT_FALLBACK;
  const rest = msg.slice(i + PLAN_LIMIT_PREFIX.length).replace(/^\s*:\s*/, '').trim();
  return rest || PLAN_LIMIT_FALLBACK;
};

/** "22 Oct 2026" in IST for the expired-plan line. */
export const planDayLabel = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const d = new Date(t + 330 * 60_000);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

/** The red card's sentence when the form is blocked. */
export const planBlockedText = (o: { clientName: string; modality: string; loggedCount: number; planExpired: boolean; planExpiresAt: string | null }): string => {
  const day = planDayLabel(o.planExpiresAt);
  return o.planExpired && day
    ? `${o.clientName}'s ${o.modality} plan expired on ${day} and ${o.loggedCount} ${o.modality} sessions are logged with you. A new approved ${o.modality} plan is required to log more.`
    : `You've logged ${o.loggedCount} ${o.modality} sessions for ${o.clientName} without an approved training plan. An approved ${o.modality} plan is required to log more.`;
};
```

### 3.2 `tests/rules/plan_gate_test.js` (new file, 39 lines, 21 checks)
```js
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
eq('no dashes in any copy', [P.PLAN_LIMIT_FALLBACK, P.planBlockedText({ clientName: 'A', modality: 'Yoga', loggedCount: 3, planExpired: true, planExpiresAt: '2026-10-22T10:00:00Z' })].some((s) => /\u2014|\u2013/.test(s)), false);
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
```
One difference from the Android file: in the last check (`'no dashes in any copy'`, line 37) the regex is written
here as `/\u2014|\u2013/` because this document carries no dash characters. Android's file has the two literal
characters there (em dash U+2014, en dash U+2013). Both forms match the same text and the test passes either way.
Run `node tests/rules/plan_gate_test.js` from the repo root: 21 `PASS` lines, then `ALL PASS`.

### 3.3 `src/lib/clientQueries.ts`
Import, next to the session code import:
```ts
import { OTP_GATE_MESSAGE } from './sessionOtp';
import { parsePlanGate, isPlanGateMissing } from './planGate';
```
The whole plan gate section as it is now. Unchanged: the top comment, `PLAN_VALID_DAYS`, `PLANLESS_LIMIT`,
`normModality` and the first six `ModalityGate` fields. New: the five optional `ModalityGate` fields,
`serverModalityGate`, the body and the `'v2'` key of `useModalityGate`. `deviceModalityGate` is the old `queryFn`
body moved unchanged into its own function. `withTimeout` and `NET_MS` are already imported from `./withTimeout`.
```ts
/* ---------- Plan gate for logging (mirrors the web "3 plan-less sessions" rule) ----------
   Without an approved, non-expired plan for the selected modality (or an approved
   document plan), a trainer may log at most 3 sessions of that modality for the
   client. Count = distinct workout_exercises.session_id for client+trainer+modality
   (Strength also counts legacy rows: null modality + a body_part). Plan validity =
   workout_plan_exercises status 'approved' and approved_at within 42 days. */
export const PLAN_VALID_DAYS = 42;
const PLANLESS_LIMIT = 3;
const normModality = (m?: string | null) => (m || '').toLowerCase().replace(/training/g, '').replace(/[^a-z]/g, '');

export type ModalityGate = {
  hasValidPlan: boolean;
  loggedCount: number;
  limit: number;
  remaining: number;
  blocked: boolean;
  warning: boolean;
  /** 22 Oct 2026: where the answer came from ('server' = get_workout_plan_gate, 'device' = the old count). */
  source?: 'server' | 'device';
  /** The server refuses the 4th session (a plan modality and not an Essentials client). */
  enforced?: boolean;
  essentials?: boolean;
  planExpired?: boolean;
  planExpiresAt?: string | null;
};

/* Since 22 Oct 2026 the server holds the rule (hub-track migration 20261022120000: get_workout_plan_gate, and
   trg_zz_workout_plan_limit refusing the 4th plan-less session with PLAN_LIMIT on every path). The form reads the
   server's answer; the device count below is the fallback while the function is not installed. Modalities without
   plans (custom, other) are never gated: hasValidPlan reads true for them so no banner shows. */
async function serverModalityGate(clientId: string, modality: string): Promise<ModalityGate | null> {
  const { data, error } = await withTimeout(
    Promise.resolve((supabase.rpc as any)('get_workout_plan_gate', { p_client_id: clientId, p_modality: modality })) as Promise<{ data: any; error: any }>,
    NET_MS, 'Plan check',
  );
  if (error) {
    if (isPlanGateMissing(error.message ?? error)) return null;
    throw new Error(error.message);
  }
  const g = parsePlanGate(data);
  if (!g) return null;
  return {
    hasValidPlan: g.gated ? g.hasValidPlan : true,
    loggedCount: g.loggedCount,
    limit: g.limit,
    remaining: g.remaining,
    blocked: g.gated && g.blocked,
    warning: g.gated && !g.hasValidPlan && g.loggedCount === g.limit - 1,
    source: 'server',
    enforced: g.enforced,
    essentials: g.essentials,
    planExpired: g.planExpired,
    planExpiresAt: g.planExpiresAt,
  };
}

export function useModalityGate(clientId: string | null, trainerId: string | null, modality: string | null) {
  return useQuery({
    queryKey: ['modality-gate', 'v2', clientId, trainerId, normModality(modality)],
    enabled: !!clientId && !!trainerId && !!modality,
    staleTime: 30_000,
    queryFn: async (): Promise<ModalityGate> => {
      const fromServer = await serverModalityGate(clientId as string, modality as string);
      if (fromServer) return fromServer;
      return { ...(await deviceModalityGate(clientId as string, trainerId as string, modality as string)), source: 'device' };
    },
  });
}

/* The pre-22 Oct count, kept as the fallback: distinct workout_exercises sessions of this client + trainer +
   modality, plans of the client (any trainer) approved within 42 days, or an approved document plan. */
async function deviceModalityGate(clientId: string, trainerId: string, modality: string): Promise<ModalityGate> {
  const target = normModality(modality);
  const isStrength = target === 'strength';
  // 1. Distinct logged sessions for this modality (plan-less grace counter).
  //    Paged past the 1000-row cap: undercounting would wrongly reopen the gate.
  const exRows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error: exErr } = await supabase
      .from('workout_exercises')
      .select('session_id, modality, body_part')
      .eq('client_id', clientId)
      .eq('trainer_id', trainerId)
      .not('session_id', 'is', null)
      .range(from, from + 999);
    if (exErr) throw new Error(exErr.message);
    exRows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const sessions = new Set<string>();
  for (const r of (exRows ?? []) as any[]) {
    const rm = normModality(r.modality);
    if (rm === target || (isStrength && !r.modality && r.body_part)) sessions.add(r.session_id);
  }
  const loggedCount = sessions.size;
  // 2. Approved, non-expired exercise plan for this modality.
  const { data: planRows } = await supabase
    .from('workout_plan_exercises')
    .select('modality, approved_at')
    .eq('client_id', clientId)
    .eq('status', 'approved');
  const now = Date.now();
  const hasExercisePlan = (planRows ?? []).some(
    (p: any) => normModality(p.modality) === target && p.approved_at && new Date(p.approved_at).getTime() + PLAN_VALID_DAYS * 864e5 > now
  );
  // 3. Approved document plan (any modality) also counts as "has plan".
  const { data: docRows } = await supabase
    .from('client_training_plans')
    .select('id')
    .eq('client_id', clientId)
    .eq('status', 'approved')
    .limit(1);
  const hasValidPlan = hasExercisePlan || (docRows?.length ?? 0) > 0;
  return {
    hasValidPlan,
    loggedCount,
    limit: PLANLESS_LIMIT,
    remaining: Math.max(0, PLANLESS_LIMIT - loggedCount),
    blocked: !hasValidPlan && loggedCount >= PLANLESS_LIMIT,
    warning: !hasValidPlan && loggedCount === PLANLESS_LIMIT - 1,
  };
}
```
One comment in `deviceModalityGate` ("Paged past the 1000-row cap: ...") has a dash instead of the colon on Android;
only the punctuation differs.
- `hasValidPlan` reads true for a modality without plans, so no card shows for it.
- `blocked: g.gated && g.blocked` is also true for Essentials: that is the device-only block for them.

### 3.4 `src/lib/offline.ts`, `isTransientError`
New: the comment and the `PLAN_LIMIT` line. It must come before the network-word test: the sentence carries the
client's name, which must never be read as a network word (a retry loop).
```ts
/* True for connectivity failures (retry later); false for real server rejections. */
function isTransientError(e: any): boolean {
  if (isTimeoutError(e)) return true; // a stalled request is retried, never marked failed
  const msg = String(e?.message ?? e ?? '');
  // The server's plan limit (22 Oct 2026) is a real refusal. Its sentence carries the client's name, which must
  // never be read as a network word below, so it is settled first.
  if (/PLAN_LIMIT/.test(msg)) return false;
  return /network request failed|network error|failed to fetch|fetch failed|timeout|timed out|abort|socket|ENOTFOUND|ECONN/i.test(msg);
}
```

### 3.5 `src/screens/trainer.tsx`

**(a) Import**, next to the session code imports:
```ts
import { isPlanLimitError, planLimitText, planBlockedText } from '../lib/planGate';
```

**(b) `Workout`, the gate** (unchanged, for context; `useTrainerId()` gives `trainerId`):
```tsx
  const gateQ = useModalityGate(selectedClientId, trainerId, modality || 'strength');
  const gate = gateQ.data;
  const gateBlocked = !!gate?.blocked;
```
`canSubmit` (unchanged) already includes `!gateBlocked`.

**(c) `Workout`, the plan card** (between the couple picker modal and the "Session setup" card). Changed: the red
card's sentence is `planBlockedText(...)` (it was a fixed "You've logged ..." sentence); the blue and gold cards are
unchanged and now show the server's numbers.
```tsx
        {/* Plan gate: without an approved valid plan for this modality, only 3 sessions may be logged. */}
        {gate && !gate.hasValidPlan ? (
          gate.blocked ? (
            <View style={{ borderRadius: 16, backgroundColor: hexA(C.red, 0.1), borderWidth: 1, borderColor: hexA(C.red, 0.4), padding: 14, gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                <Icon name="alert" size={18} color={C.red} strokeWidth={2} />
                <Text style={{ flex: 1, fontFamily: F.bodyBold, fontSize: 14.5, color: C.red }}>Session limit reached</Text>
              </View>
              <Body style={{ fontSize: 12.5, color: C.ink3, lineHeight: 18 }}>
                {planBlockedText({ clientName, modality: modLabel, loggedCount: gate.loggedCount, planExpired: !!gate.planExpired, planExpiresAt: gate.planExpiresAt ?? null })}
              </Body>
              <Pressable onPress={() => { set({ editingPlan: null }); go('create-plan'); }}>
                <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 11, borderRadius: 12 }}>
                  <Icon name="plus" size={14} color="#fff" strokeWidth={2.8} />
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: '#fff' }}>Create Training Plan</Text>
                </LinearGradient>
              </Pressable>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, backgroundColor: hexA(gate.warning ? C.gold : C.blue, 0.09), borderWidth: 1, borderColor: hexA(gate.warning ? C.gold : C.blue, 0.28), padding: 12 }}>
              <Icon name={gate.warning ? 'alert' : 'file'} size={16} color={gate.warning ? C.gold : C.blue} strokeWidth={2} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: gate.warning ? C.gold : C.blue }}>
                  {gate.warning ? `Approaching limit · ${gate.loggedCount}/${gate.limit}` : `No approved ${modLabel} plan`}
                </Text>
                <Body style={{ fontSize: 11, color: C.muted2, marginTop: 2 }}>
                  {gate.remaining} plan-less session{gate.remaining === 1 ? '' : 's'} left before a plan is required.
                </Body>
              </View>
            </View>
          )
        ) : null}
```

**(d) `Workout`, `submit`, the re-ask**. New: the comment, `gateNow` and the refetch; the alert now uses
`planBlockedText(...)` with `gateNow`. It runs before `if (!canSubmit || saving) return;`.
```tsx
  const submit = async (skipDupCheck = false) => {
    // Debounced set edits land in state first; the tick lets React apply them so
    // exercisesRef (mirrored at render) is fresh below.
    flushPendingSetCommits();
    await new Promise((r) => setTimeout(r, 0));
    // Plan limit (22 Oct 2026): online, ask the server again right before saving (a plan approved or a session
    // logged since the form opened changes the answer); offline, the cached answer stands and the server decides
    // at sync (a refusal there comes back as PLAN_LIMIT on the queued item).
    let gateNow = gate;
    if (!editingOutboxId && getIsOnline()) {
      try { const r = await gateQ.refetch(); if (r.data) gateNow = r.data; } catch { /* the server checks again at insert */ }
    }
    if (gateNow?.blocked) {
      Alert.alert('Session limit reached', `${planBlockedText({ clientName, modality: modLabel, loggedCount: gateNow.loggedCount, planExpired: !!gateNow.planExpired, planExpiresAt: gateNow.planExpiresAt ?? null })} Create and get a ${modLabel} plan approved to continue.`);
      return;
    }
    if (!canSubmit || saving) return;
```

**(e) `Workout`, `submit`, a server rejection** (the last branch after `submitItem`). New: the
`isPlanLimitError(res.error) ? planLimitText(res.error) :` step. `friendlyError` (26 Oct) and `getOutboxMine()`
(2 Nov) come from later handoffs; if iOS does not have them yet, keep its own fallback and list, but keep the
`PLAN_LIMIT` step before the fallback.
```tsx
      } else {
        // Server rejection: stays safely queued on this device, shown on Home.
        setSyncError(isOtpGateError(res.error) ? workoutOtpErrorText(failedVerifyReasonFor(getOutboxMine(), workoutScheduleId)) : isPlanLimitError(res.error) ? planLimitText(res.error) : friendlyError(res.error, 'This log was not accepted. Check it and try again.'));
        if (editingOutboxId) set({ editingOutboxId: null });
      }
```

**(f) `Dashboard`, Waiting to Sync sheet, the failed item's reason**. New: the same `PLAN_LIMIT` step
(`outboxAll` is the dashboard's `useOutboxAll()`).
```tsx
                      {failed && o.error ? (
                        <Body style={{ fontSize: 11, color: '#E0A090' }} numberOfLines={3}>{isOtpGateError(o.error) ? workoutOtpErrorText(failedVerifyReasonFor(outboxAll, (o.payload as WorkoutLogOutboxPayload)?.scheduleSessionId)) : isPlanLimitError(o.error) ? planLimitText(o.error) : friendlyError(o.error)}</Body>
                      ) : null}
```

### 3.6 Not to port
`app.json` (Android version 5.1 (37)). No SQL: the server side is live.

## 4. Check on the iPhone
Use test clients only. Steps 2 to 6 write nothing. Step 7 creates no session but writes the check-in values and may
upload the voice note's audio. Step 8 writes one real session.
1. `node tests/rules/plan_gate_test.js`: 21 PASS, then ALL PASS. `npx tsc --noEmit`: exit 0. Every other
   `node tests/rules/*_test.js` still passes.
2. Open Log Workout for any client (Strength). With a temporary `console.log(gateQ.data)`: `source: 'server'` and
   the server's numbers (`'device'` would mean the function was not found). Remove the log.
3. A client with a Strength plan approved in the last 42 days: no plan card. Same client, a custom modality: no card.
4. A client without a Strength plan and 0 or 1 Strength sessions with you: blue card, "No approved Strength plan",
   "3 plan-less sessions left before a plan is required." (or 2). With 2 sessions: gold card, "Approaching limit ·
   2/3", "1 plan-less session left before a plan is required."
5. A client with 3 or more Strength sessions with you and no valid plan: red card with "You've logged <n> Strength
   sessions for <name> without an approved training plan. ..."; Submit Workout disabled; Create Training Plan
   opens the plan builder. A client whose Strength plan lapsed: "<name>'s Strength plan expired on <date> and ...",
   the date matching `plan_expires_at` in IST.
6. An Essentials client with 3 plan-less Strength sessions: the same red card and Submit disabled.
7. Server refusal: a test client at 3 or more plan-less Strength sessions with you, none of them today, not opened
   in Add Workout on this phone since the port (no cached answer). Airplane mode on, open Log Workout from the
   client's page, fill the check-in if asked, fill the form as usual (exercise, RPE, voice note), Submit: "Saved on
   device". Airplane mode off: Home → Waiting to Sync shows "Sync failed" and "<name> has no approved Strength plan
   and <n> Strength sessions are already logged with this trainer (3 are allowed without a plan). Get the Strength
   plan approved, then log again.", with no "PLAN_LIMIT:" in front. Airplane mode on and off again: still "Sync
   failed" (not retried). Discard it, and the voice note item behind it if it shows. No session was created.
8. Re-ask at Submit (writes one real session; ask the owner first): on the iPhone open Log Workout for a test
   client at 2 plan-less Strength sessions, none of them today (gold card), and leave it open. On the web, from
   another device, log a Strength session for the same client with the same trainer account. On the iPhone fill
   the form (exercise, RPE, voice note), Submit and confirm: the alert "Session limit reached" with the red card's
   sentence and " Create and get a Strength plan approved to continue."; nothing is queued. If the card has
   already turned red on its own (the read refreshed), that passes too.

Not confirmed: whether the iOS repo has `friendlyError` (26 Oct) and `getOutboxMine` (2 Nov), used in 3.5 (e) and
(f). The Android device test of 22 Oct is recorded as pending in the feature doc. Whether the voice note item of
step 7 fails or uploads its audio was not checked.
