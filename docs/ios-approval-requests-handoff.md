# iOS handoff: Session code approval requests and Pending Approvals (Android since 2 Nov 2026)

Owner request (2 Nov 2026): when a CRM turns a client's Session code off, ask for a reason and send a request to the
doctors' manager; the code goes off only after she approves, and the CRM client page shows where the request stands.
Android commit 2aa0a9d (2 Nov 2026) adds two things:
- the **Session code** switch row on the CRM client page (turning on is direct; turning off is a request with a
  reason; a status line with Withdraw; a history fold). The Android CRM page had no Session code switch before; the
  web has had one since 13 Oct.
- a new **Pending Approvals** screen for the doctors' manager: drawer item, pending count badge, session replay masked.

Server: **live**. Hub-track migration `20261102130000_approval_requests.sql` was run live on 2 Nov 2026 (probe 14/14
plus grants, registry, manager; feature docs `b2b/docs/features/web/shared/approval-requests.md` and
`b2b/docs/features/android/shared/approval-requests.md`, both "Last verified: 2026-11-02"). Since then the database
refuses any signed-in "off" of `clients.otp` that does not come through an approval (`OTP_OFF_NEEDS_APPROVAL`).
No new package. 10 files: 5 new (pasted whole below), 5 small edits.

Related iOS handoffs: `ios-session-code-handoff.md` (the Session code system this builds on: `clients.otp`, the
`clients-otp-flags` key, and the wording rule "Session code", never OTP) and `ios-plan-cover-handoff.md` section 8.3
(the 30 Oct `friendlyError.ts` fix; the rule test below loads `friendlyError.ts`). No earlier approval handoff exists
in `odds-app/docs`; the web session did not write one.

## 1. What the user sees (Android)

### 1.1 Who sees what
| Person | Where | What |
|---|---|---|
| CRM (anyone on the CRM client page, route `crm-client`) | Client page, hero card, right under the "Irregular client" switch | Session code row, status line, Withdraw, history fold |
| Doctors' manager | Drawer, group "Workspace", right after "Reimbursements" | "Pending Approvals" with a count badge |
| Other doctors, consultant doctors, trainers, everyone else | | Nothing new |

How the app decides who the doctors' manager is (the same rule as the server's `is_doctors_manager`):
- the signed-in profile's `role_specialization` contains `physio_hod` (`useMyCapabilities().data.isPhysioHod`), **or**
- the user id is the head-doctor id `30df5c2b-0f40-4736-9f41-7cbc830a191a` (Anjana Odds; `HEAD_DOCTOR_ID` in
  `src/lib/doctorQueries.ts`). `isPhysioHod` alone is not enough: it reads only the tag.

The drawer item is in `doctorNav`, so it appears only for app role `doctor` with the normal (not consultant) drawer.
The screen itself also lets in `dbRole` admin / super_admin (the server's backup reviewers), but Android has no admin
drawer item for it. On the CRM page, an admin (`dbRole` admin or super_admin) gets "Turn off" instead of "Send
request", and the server approves it at once.

### 1.2 CRM client page: the Session code row
The row is a pill shaped like the irregular-client switch above it.
- **On:** green, "Session code on", small caps line "TURNING OFF NEEDS THE DOCTORS' MANAGER", or "OFF REQUEST WAITING
  FOR APPROVAL" while a request is pending. Shield icon on the right (a spinner while busy).
- **Off:** grey, "Session code off", small caps line "TAP TO TURN ON".

Tapping the row:
- **While off:** alert "Turn on the Session code?" / "Every scheduled session of <name> will need the member's 4-digit
  code before the trainer can log it." Buttons "Cancel" / "Turn on". Turning on is a direct write. On failure:
  "Couldn't turn it on" + the sentence.
- **While on, a request pending:** alert "Request already sent" / "The off request is waiting for the doctors'
  manager. You can withdraw it below."
- **While on:** the off sheet (bottom sheet, keyboard aware):
  - title "Turn off the Session code?";
  - text, not admin: "The doctors' manager must approve this. The Session code stays on for <name> (and the training
    partner) until then."; admin: "As an admin your request is approved at once and the Session code goes off for
    <name> (and the training partner).";
  - label "REASON (AT LEAST 10 CHARACTERS)", placeholder "Why should the Session code be turned off for this client?",
    at most 600 characters, helper "The reason is shown to the reviewer and kept in the history.";
  - buttons "Keep it on" and "Send request" (admin: "Turn off"). The second stays dim until the trimmed reason has 10+
    characters, and reads "Sending…" while sending;
  - sent: alert "Request sent" / "The doctors' manager will approve or reject it. The Session code stays on for <name>
    until then."; admin: "Session code turned off" / "The Session code is off for <name>.";
  - failure: "Couldn't send the request" + the sentence.

The status line under the row (latest request only, `lineRequest`):
- pending, amber, with a **Withdraw** button: "Off request pending since 2 Nov, 4:10 PM (asked by Pallavi Mishra),
  waiting for the doctors' manager."
- approved, green, only while the switch is still off: "Turned off on 2 Nov, 4:30 PM by Anjana Odds (asked by Pallavi
  Mishra: Client travels a lot this month)". An admin's own: "Turned off on 2 Nov, 4:30 PM by Admin: Client travels a
  lot this month"
- rejected, red: "Off request rejected by Anjana Odds on 2 Nov, 4:30 PM: Keep it on" (ends with "." when there is
  no note).
- withdrawn, cancelled, or approved but turned on again: no line.
- Times are IST, written "2 Nov, 4:10 PM".

Withdraw: alert "Withdraw the request?" / "The Session code stays on and the request is closed." Buttons "Keep it" /
"Withdraw" (destructive). On failure: "Couldn't withdraw" + the sentence.

History fold: "Session code requests (n)" with a chevron, shown when there is at least one request; it opens the last
5 requests. Each shows:
- the status word: "Waiting for approval", "Approved", "Rejected", "Withdrawn" or "Closed", plus " (admin)" for an
  admin's own approval;
- the request time in capitals ("2 NOV, 4:10 PM");
- "Asked by <name>: <reason>";
- after a decision: "<reviewer>, <time>: <note>".

### 1.3 Doctors' manager: Pending Approvals
- Drawer item "Pending Approvals" (icon `checks`) with the pending count badge ("99+" above 99).
- Screen: back link "Back" (to the doctor dashboard when there is no history), title "Pending Approvals", sub
  "Requests that wait for your decision. Nothing changes until you approve."
- One type today, so a gold label "SESSION CODE OFF APPROVALS · 2 WAITING" (the " · n WAITING" part only when n > 0).
  With 2+ types the label becomes horizontal chips "<Type> approvals" with a count badge each.
- Filter pills "Pending" (default), "Approved", "Rejected", "All".
- Empty: "Nothing waiting for you." (Pending) or "No requests here." Load error: the server sentence or "Couldn't load
  the requests. Pull to refresh."
- One card per request:
  - the client name (or "Client");
  - for a couple, "Also turns off for <partner> (training partner)";
  - a status badge;
  - "<name> (CRM) asked on 2 Nov, 4:10 PM";
  - the reason in a quote box;
  - "Session code is on now" or "Session code is off now";
  - after a decision, "<reviewer>, <time>: <note>" or "Withdrawn on <time>";
  - while pending, the buttons "Reject" and "Approve".
- The decision sheet (keyboard aware):
  - Approve: "Approve and turn off the Session code?" / "The Session code goes off for <client> and <partner> now,
    and the CRM is told." Label "NOTE (OPTIONAL)", placeholder "Anything to add".
  - Reject: "Reject this request?" / "The Session code stays on and the CRM sees your note." Label "WHY (REQUIRED)",
    placeholder "Why is it rejected?". Once typing starts and until it has 5+ characters, the line "Write why it is
    rejected (at least 5 characters)." shows and the button stays dim.
  - A box with the client name and "<requester>: <reason>". Buttons "Back" and "Yes, approve" / "Yes, reject"
    ("Saving…" while saving).
  - Done: "Approved" / "The Session code is off now and the CRM is told."; "Rejected" / "The Session code stays on and
    the CRM sees your note."; "Closed" / the server's note (for example "The Session code was already off.") or
    "Nothing was left to do for this request."
  - Failure: "Couldn't approve" / "Couldn't reject" + the sentence.
- Opened by someone else (direct navigation): title "Pending Approvals", sub "Doctors' manager", text "This page is
  for the doctors' manager only."

### 1.4 Pushes (sent by the server; nothing to build)
- New request: the doctors' manager(s) get "Approval needed" / "<CRM name> asks: Session code off for <client>.
  Reason: <first 140 characters>". An admin's own request sends none.
- Decision: the requester gets "Request approved" / "Request rejected" / "Request closed", body like "Session code off
  for <client>: approved by <name>." Data `type` is `approval_request` / `approval_decision`. Android has no tap
  routing for these types; a tap just opens the app.

## 2. Data / server contract

### 2.1 Tables (hub-track `20261102130000_approval_requests.sql`)
- `approval_request_types`: the registry, one row per kind of approval. The only row is `session_code_off`
  (label "Session code off", reviewer_scope `doctors_manager`, admin backup and admin auto-approve on, min reason 10,
  reject note required). Changed by migrations only.
- `approval_requests`: every request, kept as history.
  - Columns: `id`, `request_type`, `client_id`, `subject_id`, `reason`, `payload`, `status` (pending | approved |
    rejected | withdrawn | cancelled), `auto_approved`, `requested_by` / `_name` / `_role` / `_at`, `reviewed_by` /
    `_name` / `_role` / `_at`, `review_note`, `withdrawn_by` / `_at`, `applied_at`, `result`, `created_at`,
    `updated_at`.
  - `payload` for Session code off: `{otp_was, partner_client_id, partner_name}`; `result` after approval:
    `{otp_off: [client ids]}`.
  - One pending request per type and client (unique index).
  - RLS: SELECT only (the requester, reviewers of the type, crm / ops / admin / super_admin on client rows). No write
    policies; INSERT / UPDATE / DELETE are revoked from `authenticated`. **The app writes this table only through the
    RPCs.**
- `clients.otp` is unchanged. The only direct table write in this feature is turning it ON:
  `supabase.from('clients').update({ otp: true }).eq('id', clientId)`.
- The roster request inbox (`all_requests`, `approvalQueries.ts`, CRM "Approvals") is a different thing. Do not touch it.

### 2.2 RPCs (all SECURITY DEFINER, `authenticated` only, anon none)
Every refusal is `CODE: sentence`. Codes marked (42501) carry the 42501 "not allowed" error code; the rest are plain
`RAISE` (P0001).

1. `create_approval_request(p_type text, p_client_id uuid, p_reason text, p_subject_id uuid default null)`
   - The app sends `{ p_type: 'session_code_off', p_client_id, p_reason: reason.trim(), p_subject_id: null }`.
   - Answer: the new `approval_requests` row as json. Normally `status: 'pending'`, and the reviewers are pushed.
     For an admin or super_admin it is applied at once: `status: 'approved'`, `auto_approved: true`, `review_note:
     'Approved at once (admin)'` (or `cancelled` when the code was already off).
   - Refusals:
     - `APPROVAL_SIGN_IN: Sign in to send a request.` (42501)
     - `APPROVAL_FORBIDDEN: Only staff can send a request.` (42501)
     - `APPROVAL_BAD_TYPE: This kind of request is not available.`
     - `APPROVAL_NOT_FOUND: Say which client the request is about.`
     - `APPROVAL_REASON: Write the reason (at least 10 characters).`
     - `APPROVAL_PENDING: A request for this is already waiting for approval.`
     - `APPROVAL_FORBIDDEN: Only CRM, ops or admin can ask to turn off the Session code.` (42501)
     - `APPROVAL_NOT_FOUND: This client could not be found.`
     - `APPROVAL_NOT_NEEDED: The Session code is already off for this client.`
     - `APPROVAL_PENDING: A request to turn off the Session code is already waiting for the training partner.`
2. `review_approval_request(p_id uuid, p_decision text, p_note text default null)`
   - The app sends `{ p_id, p_decision: 'approve' | 'reject', p_note: note.trim() || null }`.
   - Answer: the updated row. Approve turns `clients.otp` off for the client, and the training partner follows through
     the existing partner trigger. The result is `approved`, or `cancelled` with `review_note` "The Session code was
     already off." when nothing was left to do. Reject gives `rejected` with the note. The requester is pushed.
   - Refusals:
     - `APPROVAL_SIGN_IN: Sign in to review requests.` (42501)
     - `APPROVAL_BAD_DECISION: Choose approve or reject.`
     - `APPROVAL_NOT_FOUND: This request could not be found. Refresh the page.`
     - `APPROVAL_FORBIDDEN: You cannot review this kind of request.` (42501)
     - `APPROVAL_OWN_REQUEST: You cannot review your own request.` (42501)
     - `APPROVAL_DONE: This request is already <status>. Refresh the page.` (for example "already approved")
     - `APPROVAL_NOTE: Write why it is rejected (at least 5 characters).`
3. `withdraw_approval_request(p_id uuid)`
   - Who: the requester, or any crm / admin / super_admin; pending only.
   - Answer: the row with `status: 'withdrawn'`.
   - Refusals:
     - `APPROVAL_SIGN_IN: Sign in to withdraw a request.` (42501)
     - `APPROVAL_NOT_FOUND: This request could not be found. Refresh the page.`
     - `APPROVAL_FORBIDDEN: Only the person who asked, a CRM or an admin can withdraw this request.` (42501)
     - `APPROVAL_DONE: This request is already <status>. Refresh the page.`
4. `get_approval_requests(p_type text default null, p_status text default 'pending', p_limit integer default 200)`
   - The app sends `{ p_type, p_status: 'pending' | 'approved' | 'rejected' | 'all', p_limit: 200 }`.
   - Answer: rows of the `approval_requests` columns (without `withdrawn_by`, `created_at`, `updated_at`) plus
     `type_label`, `client_name`, `client_status`, `current_state` (`{otp}` for Session code off).
   - Only types the caller may review; anyone else gets 0 rows. Order: pending first, then the newest decision. The
     limit is clamped to 1..500.
   - Refusal: `APPROVAL_SIGN_IN: Sign in to see requests.` (42501)
5. `get_approval_counts()`
   - Answer: `{request_type, label, pending}` per active type the caller may review; a type with nothing pending is
     listed with 0. Everyone else gets 0 rows (this is what keeps the badge at 0 for other doctors).
6. `get_client_approval_requests(p_client_id uuid, p_type text default null, p_limit integer default 5)`
   - The app sends `{ p_client_id, p_type: 'session_code_off', p_limit: 5 }`.
   - Answer: whole `approval_requests` rows for the client, newest first. The limit is clamped to 1..50.
   - Who: crm / ops / admin / super_admin or the doctors' manager.
   - Refusals:
     - `APPROVAL_SIGN_IN: Sign in to see requests.` (42501)
     - `APPROVAL_FORBIDDEN: Only CRM, ops, admin or the doctors manager can see these requests.` (42501)

Who reviews (`can_review_approval`): the doctors' manager (`is_doctors_manager`: the head-doctor id or the
`physio_hod` tag), with admin / super_admin as backup. Nobody reviews their own request.

### 2.3 The Session code guard on `clients` (trigger `clients_otp_guard`, replaced by this migration)
- Any change of `otp` by a signed-in user whose role is not crm / admin / ops, outside an approval:
  `OTP_FORBIDDEN: only CRM, admin or ops can change the session OTP setting` (the 13 Oct text, P0001).
- Turning it **off** while signed in, outside an approval:
  `OTP_OFF_NEEDS_APPROVAL: Turning off the Session code needs the doctors manager's approval. Send a request from the client page.` (42501)
- An approval sets a transaction flag, which skips both checks; that is how the doctors' manager (role doctor) can
  apply it. The SQL editor and server jobs are not checked.
- `trg_clients_otp_off_close_requests`: when the code goes off another way (the SQL editor), a pending request becomes
  `cancelled` with the note "The Session code was turned off another way before this request was reviewed."

### 2.4 How errors are shown: `codedSentence` before `friendlyError`
Every alert and error line in this feature shows `codedSentence(e) ?? friendlyError(e, '<fallback>')`.
- `friendlyError` turns any 42501 error into its generic "You are not allowed to do this. Sign in again, or ask the
  tech team if you think you should be." That would hide sentences like "You cannot review your own request."
- `codedSentence` (in `approvalRequests.ts`) returns the sentence after an `OTP_...:` or `APPROVAL_...:` prefix, and
  null for anything else. Network errors and plain RLS errors therefore still go through `friendlyError`.
- The rule test found this. Keep the order exactly.

### 2.5 Cache keys (React Query)
- `['approval-requests', type, status]`: stale 30 s, polls every 60 s (the reviewer list).
- `['approval-counts']`: stale 30 s, polls every 60 s (the drawer badge).
- `['approval-client', clientId, type, limit]`: stale 30 s, no poll (the CRM row). The page's pull to refresh
  refetches it.
- Every write invalidates all three, plus `['clients-otp-flags']` and `['crm-client-detail', clientId]`.
- Not in `PERSIST_PREFIXES` (always fresh); do not add them. No realtime.

## 3. Code to port

### 3.1 `src/lib/approvalRequests.ts` (NEW, pure, copy byte for byte)
No imports at all; `codedSentence` lives here too. Node-tested by 3.2.
```ts
/* Approval requests (2 Nov 2026; hub-track migration 20261102130000, web src/lib/approvalRequests.ts).
   One table for every kind of approval (request_type); the first kind is "session_code_off": a CRM asks the
   doctors' manager to turn off a client's Session code, and it goes off only when approved.
   Pure: no imports, node-tested in tests/rules/approval_requests_test.js. */

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn' | 'cancelled';

export interface ApprovalRequest {
  id: string;
  request_type: string;
  client_id: string | null;
  subject_id: string | null;
  reason: string;
  payload: Record<string, any>;
  status: ApprovalStatus;
  auto_approved: boolean;
  requested_by: string;
  requested_by_name: string | null;
  requested_by_role: string | null;
  requested_at: string;
  reviewed_by: string | null;
  reviewed_by_name: string | null;
  reviewed_by_role: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  withdrawn_at: string | null;
  applied_at: string | null;
  result: Record<string, any>;
}

/** A row of the reviewer list (get_approval_requests). */
export interface ApprovalListRow extends ApprovalRequest {
  type_label: string;
  client_name: string | null;
  client_status: string | null;
  current_state: Record<string, any>;
}

export interface ApprovalCount { request_type: string; label: string; pending: number }

export const SESSION_CODE_OFF = 'session_code_off';
export const MIN_REASON = 10;
export const MIN_REJECT_NOTE = 5;

export const STATUS_WORD: Record<ApprovalStatus, string> = {
  pending: 'Waiting for approval',
  approved: 'Approved',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  cancelled: 'Closed',
};

/** Section title per type on the reviewer screen; a new type adds a row here and in the database registry. */
export const TYPE_TITLE: Record<string, string> = { [SESSION_CODE_OFF]: 'Session code off approvals' };
export const typeTitle = (type: string, label?: string) => TYPE_TITLE[type] ?? `${label ?? type} approvals`;

/** "2 Nov, 4:10 PM" in IST. */
export const fmtWhen = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const day = d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase();
  return `${day}, ${time}`;
};

const roleWord = (role: string | null | undefined): string => {
  const r = (role ?? '').toLowerCase();
  if (r === 'crm') return 'CRM';
  if (r === 'ops') return 'Ops';
  if (r === 'super_admin') return 'Super admin';
  return r ? r.charAt(0).toUpperCase() + r.slice(1) : '';
};
export const requesterText = (r: Pick<ApprovalRequest, 'requested_by_name' | 'requested_by_role'>): string =>
  [r.requested_by_name || 'Someone', r.requested_by_role ? `(${roleWord(r.requested_by_role)})` : ''].filter(Boolean).join(' ');

export type Tone = 'amber' | 'green' | 'red' | 'muted';

/** Which request (if any) gets a line under the CRM's switch: a pending or rejected one always, an approval only
    while the switch is still off (after it is turned on again the old approval is history, not news). */
export const lineRequest = (requests: ApprovalRequest[], otpOn: boolean): ApprovalRequest | null => {
  const r = requests[0] ?? null;
  if (!r) return null;
  if (r.status === 'pending' || r.status === 'rejected') return r;
  if (r.status === 'approved' && !otpOn) return r;
  return null;
};

/** The line under the CRM's Session code switch. */
export const sessionCodeStatusLine = (r: ApprovalRequest | null | undefined): { tone: Tone; text: string } | null => {
  if (!r) return null;
  const who = r.requested_by_name || 'a CRM';
  switch (r.status) {
    case 'pending':
      return { tone: 'amber', text: `Off request pending since ${fmtWhen(r.requested_at)} (asked by ${who}), waiting for the doctors' manager.` };
    case 'approved':
      return r.auto_approved
        ? { tone: 'green', text: `Turned off on ${fmtWhen(r.reviewed_at)} by ${r.reviewed_by_name || 'an admin'}: ${r.reason}` }
        : { tone: 'green', text: `Turned off on ${fmtWhen(r.reviewed_at)} by ${r.reviewed_by_name || "the doctors' manager"} (asked by ${who}: ${r.reason})` };
    case 'rejected':
      return { tone: 'red', text: `Off request rejected by ${r.reviewed_by_name || "the doctors' manager"} on ${fmtWhen(r.reviewed_at)}${r.review_note ? `: ${r.review_note}` : '.'}` };
    case 'withdrawn':
      return { tone: 'muted', text: `Off request withdrawn on ${fmtWhen(r.withdrawn_at)}.` };
    case 'cancelled':
      return { tone: 'muted', text: r.review_note || 'Off request closed.' };
    default:
      return null;
  }
};

/** The plain sentence of an approval / Session code server error ("APPROVAL_OWN_REQUEST: You cannot review your
    own request."). Some of them carry the 42501 "not allowed" code, which friendlyError turns into its generic
    line; these screens show the server's own sentence first and fall back to friendlyError otherwise. */
export const codedSentence = (e: unknown): string | null => {
  const msg = String((e as { message?: unknown } | null)?.message ?? '').trim();
  const m = msg.match(/^(?:OTP|APPROVAL)_[A-Z_]+:\s*(.+)$/s);
  return m && m[1].trim() ? m[1].trim() : null;
};

/** Reason / note checks the server also makes (so the button can say why it is not ready). */
export const reasonProblem = (reason: string): string | null =>
  reason.trim().length >= MIN_REASON ? null : `Write the reason (at least ${MIN_REASON} characters).`;
export const rejectNoteProblem = (note: string): string | null =>
  note.trim().length >= MIN_REJECT_NOTE ? null : `Write why it is rejected (at least ${MIN_REJECT_NOTE} characters).`;
```

### 3.2 `tests/rules/approval_requests_test.js` (NEW, copy byte for byte)
It also loads `src/lib/friendlyError.ts` (the iOS copy must export `friendlyError`, `NO_CONNECTION` and
`NOT_ALLOWED`; see `ios-plan-cover-handoff.md` section 8.3). Run: `node tests/rules/approval_requests_test.js`.
On Android it prints 31 PASS lines and "ALL PASS".
```js
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
eq('other errors still friendly', shown(E('Failed to fetch')), FE.NO_CONNECTION);
eq('a plain 42501 still generic', shown(E('new row violates row-level security policy for table "x"', '42501')), FE.NOT_ALLOWED);

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
```

### 3.3 `src/lib/approvalRequestQueries.ts` (NEW, paste whole)
```ts
/* Approval requests: queries and mutations (2 Nov 2026; hub-track migration 20261102130000).
   Every write is an RPC (the table has no write policies); reads use the RPCs too, so the app never needs a
   clients policy. Keys start with 'approval-'; every write invalidates them plus the CRM client page and the
   Session code flags. Rules and words: approvalRequests.ts. */
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { withTimeout, NET_MS } from './withTimeout';
import type { ApprovalCount, ApprovalListRow, ApprovalRequest, ApprovalStatus } from './approvalRequests';

const rpc = async <T,>(name: string, args: Record<string, unknown>, label: string): Promise<T> => {
  const { data, error } = await withTimeout((supabase.rpc as any)(name, args) as Promise<{ data: T; error: any }>, NET_MS, label);
  if (error) throw error;
  return data;
};

const invalidate = (qc: QueryClient, clientId?: string | null) => {
  qc.invalidateQueries({ queryKey: ['approval-requests'] });
  qc.invalidateQueries({ queryKey: ['approval-counts'] });
  qc.invalidateQueries({ queryKey: ['approval-client'] });
  qc.invalidateQueries({ queryKey: ['clients-otp-flags'] });
  if (clientId) qc.invalidateQueries({ queryKey: ['crm-client-detail', clientId] });
  else qc.invalidateQueries({ queryKey: ['crm-client-detail'] });
};

/** The reviewer list: the types the signed-in person may review (admin: all). */
export function useApprovalRequests(type: string | null, status: ApprovalStatus | 'all', enabled = true) {
  return useQuery({
    queryKey: ['approval-requests', type, status],
    enabled,
    queryFn: () => rpc<ApprovalListRow[]>('get_approval_requests', { p_type: type, p_status: status, p_limit: 200 }, 'Loading requests').then((d) => d ?? []),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

/** Pending count per type the signed-in person may review (drawer badge). Empty for everyone else. */
export function useApprovalCounts(enabled = true) {
  return useQuery({
    queryKey: ['approval-counts'],
    enabled,
    queryFn: () => rpc<ApprovalCount[]>('get_approval_counts', {}, 'Loading approvals').then((d) => d ?? []),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

/** The latest requests about one client (the CRM client page's status line and history). */
export function useClientApprovalRequests(clientId: string | null | undefined, type: string | null, limit = 5) {
  return useQuery({
    queryKey: ['approval-client', clientId, type, limit],
    enabled: !!clientId,
    queryFn: () => rpc<ApprovalRequest[]>('get_client_approval_requests', { p_client_id: clientId, p_type: type, p_limit: limit }, 'Loading requests').then((d) => d ?? []),
    staleTime: 30_000,
  });
}

export function useCreateApprovalRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { type: string; clientId: string; reason: string }) =>
      rpc<ApprovalRequest>('create_approval_request', { p_type: v.type, p_client_id: v.clientId, p_reason: v.reason, p_subject_id: null }, 'Sending the request'),
    onSuccess: (_d, v) => invalidate(qc, v.clientId),
  });
}

export function useReviewApprovalRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; decision: 'approve' | 'reject'; note?: string; clientId?: string | null }) =>
      rpc<ApprovalRequest>('review_approval_request', { p_id: v.id, p_decision: v.decision, p_note: v.note?.trim() || null }, 'Saving the decision'),
    onSuccess: (_d, v) => invalidate(qc, v.clientId),
  });
}

export function useWithdrawApprovalRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; clientId?: string | null }) =>
      rpc<ApprovalRequest>('withdraw_approval_request', { p_id: v.id }, 'Withdrawing the request'),
    onSuccess: (_d, v) => invalidate(qc, v.clientId),
  });
}

/** Turning the Session code ON stays a direct change (crm / ops / admin; the database guard decides). */
export function useTurnSessionCodeOn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { clientId: string }) => {
      const { error } = await withTimeout(
        supabase.from('clients').update({ otp: true } as any).eq('id', v.clientId) as unknown as Promise<{ error: any }>,
        NET_MS, 'Turning on the Session code');
      if (error) throw error;
    },
    onSuccess: (_d, v) => invalidate(qc, v.clientId),
  });
}
```

### 3.4 `src/components/sessionCodeApproval.tsx` (NEW, paste whole)
`SessionCodeRow` (the row, status line, Withdraw, history) and `SessionCodeOffSheet` (the reason sheet).
```tsx
import React from 'react';
import { View, Text, Pressable, TextInput, Modal, ScrollView, ActivityIndicator, Alert, Keyboard } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Body, Mono, Serif } from './primitives';
import { useAuth } from '../auth';
import { useKeyboardHeight } from '../lib/useKeyboardHeight';
import { friendlyError } from '../lib/friendlyError';
import {
  SESSION_CODE_OFF, MIN_REASON, STATUS_WORD, codedSentence, fmtWhen, lineRequest, reasonProblem, sessionCodeStatusLine, type Tone,
} from '../lib/approvalRequests';
import {
  useClientApprovalRequests, useCreateApprovalRequest, useTurnSessionCodeOn, useWithdrawApprovalRequest,
} from '../lib/approvalRequestQueries';

/* CRM client page: the Session code switch (2 Nov 2026, approval requests). Turning it ON is direct; turning it
   OFF asks for a reason and sends a request to the doctors' manager, and it goes off only when approved (the
   database refuses a direct "off" with OTP_OFF_NEEDS_APPROVAL). An admin's request is approved at once.
   Web twin: hub-track src/components/approvals/SessionCodeOffRequest.tsx. */

const TONE: Record<Tone, string> = { amber: C.gold, green: C.green, red: C.red, muted: C.muted2 };

export function SessionCodeRow({ clientId, clientName, otpOn }: { clientId: string; clientName: string; otpOn: boolean }) {
  const { dbRole } = useAuth();
  const isAdmin = dbRole === 'admin' || dbRole === 'super_admin';
  const reqQ = useClientApprovalRequests(clientId, SESSION_CODE_OFF, 5);
  const onM = useTurnSessionCodeOn();
  const withdrawM = useWithdrawApprovalRequest();
  const [sheet, setSheet] = React.useState(false);
  const [history, setHistory] = React.useState(false);
  const requests = reqQ.data ?? [];
  const pending = requests.find((r) => r.status === 'pending') ?? null;
  const line = sessionCodeStatusLine(lineRequest(requests, otpOn));
  const busy = onM.isPending || withdrawM.isPending;

  const press = () => {
    if (busy) return;
    if (!otpOn) {
      Alert.alert('Turn on the Session code?', `Every scheduled session of ${clientName} will need the member's 4-digit code before the trainer can log it.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Turn on', onPress: () => onM.mutate({ clientId }, { onError: (e) => Alert.alert("Couldn't turn it on", (codedSentence(e) ?? friendlyError(e, 'Try again.'))) }) },
      ]);
      return;
    }
    if (pending) {
      Alert.alert('Request already sent', "The off request is waiting for the doctors' manager. You can withdraw it below.");
      return;
    }
    setSheet(true);
  };
  const withdraw = () => {
    if (!pending) return;
    Alert.alert('Withdraw the request?', 'The Session code stays on and the request is closed.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Withdraw', style: 'destructive', onPress: () => withdrawM.mutate({ id: pending.id, clientId }, { onError: (e) => Alert.alert("Couldn't withdraw", (codedSentence(e) ?? friendlyError(e, 'Try again.'))) }) },
    ]);
  };

  return (
    <View style={{ gap: 6 }}>
      <Pressable onPress={press} disabled={busy} accessibilityRole="switch" accessibilityState={{ checked: otpOn }} accessibilityLabel="Session code" hitSlop={10}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 11, borderRadius: 12, backgroundColor: otpOn ? hexA(C.green, 0.1) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: otpOn ? hexA(C.green, 0.4) : 'rgba(255,255,255,0.09)', opacity: busy ? 0.6 : 1 }}>
        <View style={{ width: 38, height: 22, borderRadius: 11, padding: 3, backgroundColor: otpOn ? hexA(C.green, 0.35) : 'rgba(255,255,255,0.1)', alignItems: otpOn ? 'flex-end' : 'flex-start' }}>
          <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: otpOn ? C.green : C.muted2 }} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: otpOn ? C.green : C.muted }}>{otpOn ? 'Session code on' : 'Session code off'}</Text>
          <Mono style={{ fontSize: 7.5, letterSpacing: 0.5, color: C.muted3, marginTop: 2 }}>
            {otpOn ? (pending ? 'OFF REQUEST WAITING FOR APPROVAL' : "TURNING OFF NEEDS THE DOCTORS' MANAGER") : 'TAP TO TURN ON'}
          </Mono>
        </View>
        {busy ? <ActivityIndicator size="small" color={C.green} /> : <Icon name="shield" size={14} color={otpOn ? C.green : C.muted3} strokeWidth={2.2} />}
      </Pressable>

      {line ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 11, borderRadius: 11, backgroundColor: hexA(TONE[line.tone], 0.09), borderWidth: 1, borderColor: hexA(TONE[line.tone], 0.35) }}>
          <Body style={{ flex: 1, fontSize: 11.5, lineHeight: 16, color: TONE[line.tone] }}>{line.text}</Body>
          {pending ? (
            <Pressable onPress={withdraw} hitSlop={10} accessibilityRole="button" accessibilityLabel="Withdraw the request"
              style={{ paddingVertical: 5, paddingHorizontal: 9, borderRadius: 9, borderWidth: 1, borderColor: hexA(C.gold, 0.45) }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: C.gold }}>Withdraw</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {requests.length > 0 ? (
        <Pressable onPress={() => setHistory((h) => !h)} hitSlop={10} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 2 }}>
          <Icon name={history ? 'chevUp' : 'chevDown'} size={11} color={C.muted2} strokeWidth={2.3} />
          <Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: C.muted2 }}>Session code requests ({requests.length})</Text>
        </Pressable>
      ) : null}
      {history ? (
        <View style={{ gap: 6 }}>
          {requests.map((r) => (
            <View key={r.id} style={{ padding: 10, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', gap: 3 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                <Text style={{ fontFamily: F.bodySemi, fontSize: 11.5, color: '#fff' }}>{STATUS_WORD[r.status]}{r.auto_approved ? ' (admin)' : ''}</Text>
                <Mono style={{ fontSize: 8.5, color: C.muted3 }}>{fmtWhen(r.requested_at).toUpperCase()}</Mono>
              </View>
              <Body style={{ fontSize: 11, color: C.muted2 }}>Asked by {r.requested_by_name || 'staff'}: {r.reason}</Body>
              {r.reviewed_at && r.status !== 'pending' ? (
                <Body style={{ fontSize: 11, color: C.muted3 }}>{r.reviewed_by_name ? `${r.reviewed_by_name}, ` : ''}{fmtWhen(r.reviewed_at)}{r.review_note ? `: ${r.review_note}` : ''}</Body>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

      <SessionCodeOffSheet visible={sheet} onClose={() => setSheet(false)} clientId={clientId} clientName={clientName} isAdmin={isAdmin} />
    </View>
  );
}

export function SessionCodeOffSheet({ visible, onClose, clientId, clientName, isAdmin }: { visible: boolean; onClose: () => void; clientId: string; clientName: string; isAdmin: boolean }) {
  const insets = useSafeAreaInsets();
  const kbH = useKeyboardHeight();
  const createM = useCreateApprovalRequest();
  const [reason, setReason] = React.useState('');
  React.useEffect(() => { if (visible) { setReason(''); createM.reset(); } }, [visible]);
  const problem = reasonProblem(reason);
  const send = () => {
    if (problem || createM.isPending) return;
    Keyboard.dismiss();
    createM.mutate({ type: SESSION_CODE_OFF, clientId, reason: reason.trim() }, {
      onSuccess: (r) => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        onClose();
        Alert.alert(r.status === 'approved' ? 'Session code turned off' : 'Request sent',
          r.status === 'approved' ? `The Session code is off for ${clientName}.` : `The doctors' manager will approve or reject it. The Session code stays on for ${clientName} until then.`);
      },
      onError: (e) => Alert.alert("Couldn't send the request", (codedSentence(e) ?? friendlyError(e, 'Try again.'))),
    });
  };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => { if (!createM.isPending) onClose(); }}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable onPress={() => !createM.isPending && onClose()} accessibilityRole="button" accessibilityLabel="Close" importantForAccessibility="no-hide-descendants"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.64)' }} />
        <View accessibilityViewIsModal style={{ maxHeight: '88%', backgroundColor: C.sheetBg, borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: hexA(C.gold, 0.3), paddingHorizontal: 18, paddingTop: 14, paddingBottom: 14 + insets.bottom + kbH }}>
          <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 12 }} />
          <Serif style={{ fontSize: 19 }}>Turn off the Session code?</Serif>
          <Body style={{ fontSize: 12, color: C.muted2, lineHeight: 17, marginTop: 4, marginBottom: 12 }}>
            {isAdmin
              ? `As an admin your request is approved at once and the Session code goes off for ${clientName} (and the training partner).`
              : `The doctors' manager must approve this. The Session code stays on for ${clientName} (and the training partner) until then.`}
          </Body>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 8, paddingBottom: 8 }}>
            <Mono style={{ fontSize: 9, letterSpacing: 0.8, color: C.muted3 }}>REASON (AT LEAST {MIN_REASON} CHARACTERS)</Mono>
            <TextInput value={reason} onChangeText={setReason} multiline maxLength={600} placeholder="Why should the Session code be turned off for this client?" placeholderTextColor={C.muted3}
              accessibilityLabel="Reason"
              style={{ minHeight: 90, textAlignVertical: 'top', fontFamily: F.body, fontSize: 14, color: '#fff', paddingVertical: 11, paddingHorizontal: 12, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }} />
            <Body style={{ fontSize: 11, color: C.muted3 }}>The reason is shown to the reviewer and kept in the history.</Body>
          </ScrollView>
          <View style={{ flexDirection: 'row', gap: 10, paddingTop: 12 }}>
            <Pressable onPress={onClose} disabled={createM.isPending} accessibilityRole="button"
              style={{ flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: C.muted }}>Keep it on</Text>
            </Pressable>
            <Pressable onPress={send} disabled={!!problem || createM.isPending} accessibilityRole="button" accessibilityLabel={isAdmin ? 'Turn off' : 'Send request'}
              style={{ flex: 1.4, minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 12, backgroundColor: hexA(C.gold, problem ? 0.06 : 0.16), borderWidth: 1, borderColor: hexA(C.gold, problem ? 0.2 : 0.5), opacity: createM.isPending ? 0.6 : 1 }}>
              {createM.isPending ? <ActivityIndicator size="small" color={C.gold} /> : null}
              <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: problem ? C.muted3 : C.gold }}>{createM.isPending ? 'Sending…' : isAdmin ? 'Turn off' : 'Send request'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
```

### 3.5 `src/screens/doctorApprovals.tsx` (NEW, paste whole)
`DoctorPendingApprovals` (route `doctor-pending-approvals`) and its `ApprovalDecisionSheet`.
```tsx
import React from 'react';
import { View, Text, Pressable, TextInput, Modal, ScrollView, ActivityIndicator, Alert, Keyboard } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono, Card } from '../components/primitives';
import { Page, TitleBlock, BackLink, AccessPending, Badge } from './common';
import { useStore } from '../store';
import { useAuth } from '../auth';
import { useMyCapabilities } from '../lib/capabilities';
import { useKeyboardHeight } from '../lib/useKeyboardHeight';
import { friendlyError } from '../lib/friendlyError';
import { HEAD_DOCTOR_ID } from '../lib/doctorQueries';
import {
  SESSION_CODE_OFF, STATUS_WORD, codedSentence, fmtWhen, rejectNoteProblem, requesterText, typeTitle,
  type ApprovalListRow, type ApprovalStatus,
} from '../lib/approvalRequests';
import { useApprovalCounts, useApprovalRequests, useReviewApprovalRequest } from '../lib/approvalRequestQueries';

/* ============ Pending Approvals (doctors' manager) ============
   Port of hub-track src/pages/shared/ApprovalRequests.tsx (2 Nov 2026). One section per request type the signed-in
   person may review (get_approval_counts); the first type is "Session code off": a CRM asks to turn off a client's
   Session code and it goes off only when approved here. The RPCs re-check everything on the server. */

type Filter = ApprovalStatus | 'all';
const FILTERS: [Filter, string][] = [['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['all', 'All']];
const STATUS_COLOR: Record<ApprovalStatus, string> = { pending: C.gold, approved: C.green, rejected: C.red, withdrawn: C.muted2, cancelled: C.muted2 };

export function DoctorPendingApprovals() {
  const { back, canGoBack, go } = useStore();
  const { session, dbRole } = useAuth();
  const caps = useMyCapabilities();
  const uid = session?.user?.id ?? null;
  const allowed = caps.data.isPhysioHod || uid === HEAD_DOCTOR_ID || dbRole === 'admin' || dbRole === 'super_admin';
  const countsQ = useApprovalCounts(allowed);
  const types = (countsQ.data ?? []).length ? countsQ.data! : [{ request_type: SESSION_CODE_OFF, label: 'Session code off', pending: 0 }];
  const [type, setType] = React.useState<string>(SESSION_CODE_OFF);
  React.useEffect(() => { if (!types.some((t) => t.request_type === type)) setType(types[0].request_type); }, [types.map((t) => t.request_type).join(',')]);
  const [filter, setFilter] = React.useState<Filter>('pending');
  const q = useApprovalRequests(type, filter, allowed);
  const [decide, setDecide] = React.useState<{ row: ApprovalListRow; decision: 'approve' | 'reject' } | null>(null);

  if (caps.isPending || caps.isError) return <AccessPending paused={caps.isPaused} error={caps.isError} onRetry={caps.refetch} />;
  if (!allowed) {
    return (
      <Page gap={14} pt={6}>
        <TitleBlock title="Pending Approvals" sub="Doctors' manager" />
        <Body style={{ fontSize: 12.5, color: C.muted2, textAlign: 'center', paddingVertical: 30 }}>This page is for the doctors' manager only.</Body>
      </Page>
    );
  }

  const rows = q.data ?? [];
  return (
    <Page gap={12} pt={6}>
      <BackLink label="Back" onPress={() => (canGoBack ? back() : go('doctor-dashboard'))} />
      <TitleBlock title="Pending Approvals" sub="Requests that wait for your decision. Nothing changes until you approve." />

      {types.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {types.map((t) => {
            const on = t.request_type === type;
            return (
              <Pressable key={t.request_type} onPress={() => setType(t.request_type)} hitSlop={10}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: on ? hexA(C.gold, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: on ? hexA(C.gold, 0.5) : 'rgba(255,255,255,0.1)' }}>
                <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: on ? C.gold : C.muted }}>{typeTitle(t.request_type, t.label)}</Text>
                {t.pending > 0 ? <Badge text={String(t.pending)} color={C.gold} /> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      ) : (
        <Mono style={{ fontSize: 9.5, letterSpacing: 0.8, color: C.gold }}>{typeTitle(types[0].request_type, types[0].label).toUpperCase()}{types[0].pending ? ` · ${types[0].pending} WAITING` : ''}</Mono>
      )}

      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
        {FILTERS.map(([f, lab]) => {
          const on = f === filter;
          return (
            <Pressable key={f} onPress={() => setFilter(f)} hitSlop={10} accessibilityRole="button" accessibilityState={{ selected: on }}
              style={{ paddingVertical: 7, paddingHorizontal: 13, borderRadius: 999, backgroundColor: on ? '#fff' : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: on ? '#fff' : 'rgba(255,255,255,0.1)' }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: on ? '#111' : C.muted }}>{lab}</Text>
            </Pressable>
          );
        })}
      </View>

      {q.isPending ? <ActivityIndicator color={C.gold} style={{ paddingVertical: 30 }} />
        : q.isError ? <Body style={{ fontSize: 12, color: C.red, textAlign: 'center', paddingVertical: 20 }}>{(codedSentence(q.error) ?? friendlyError(q.error, "Couldn't load the requests. Pull to refresh."))}</Body>
        : rows.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: 34, gap: 8 }}>
            <Icon name="checks" size={24} color={filter === 'pending' ? C.green : C.muted3} strokeWidth={2} />
            <Body style={{ fontSize: 12.5, color: C.muted3 }}>{filter === 'pending' ? 'Nothing waiting for you.' : 'No requests here.'}</Body>
          </View>
        ) : rows.map((r) => {
          const partner = r.payload?.partner_name as string | undefined;
          const otpNow = r.current_state?.otp;
          return (
            <Card key={r.id} colors={['rgba(46,28,18,0.42)', 'rgba(18,14,14,0.5)']} border={hexA(STATUS_COLOR[r.status], 0.28)} radius={17} style={{ padding: 14, gap: 9, borderLeftWidth: 3, borderLeftColor: STATUS_COLOR[r.status] }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Body style={{ fontSize: 14.5, fontFamily: F.bodyBold, color: '#fff' }} numberOfLines={1}>{r.client_name || 'Client'}</Body>
                  {partner ? <Body style={{ fontSize: 10.5, color: C.muted2, marginTop: 1 }}>Also turns off for {partner} (training partner)</Body> : null}
                </View>
                <Badge text={`${STATUS_WORD[r.status]}${r.auto_approved ? ' (admin)' : ''}`} color={STATUS_COLOR[r.status]} />
              </View>
              <Body style={{ fontSize: 10.5, color: C.muted2 }}>{requesterText(r)} asked on {fmtWhen(r.requested_at)}</Body>
              <View style={{ padding: 10, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.25)', borderLeftWidth: 3, borderLeftColor: hexA(C.gold, 0.7) }}>
                <Body style={{ fontSize: 12.5, color: C.ink3, lineHeight: 18 }}>{r.reason}</Body>
              </View>
              {r.request_type === SESSION_CODE_OFF ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Icon name="shield" size={12} color={otpNow ? C.green : C.muted3} strokeWidth={2.2} />
                  <Body style={{ fontSize: 11.5, color: C.muted2 }}>Session code is <Text style={{ fontFamily: F.bodyBold, color: otpNow ? C.green : C.muted }}>{otpNow ? 'on' : 'off'}</Text> now</Body>
                </View>
              ) : null}
              {r.status !== 'pending' && (r.reviewed_at || r.withdrawn_at) ? (
                <Body style={{ fontSize: 11, color: C.muted3 }}>
                  {r.status === 'withdrawn' ? `Withdrawn on ${fmtWhen(r.withdrawn_at)}` : `${r.reviewed_by_name ? `${r.reviewed_by_name}, ` : ''}${fmtWhen(r.reviewed_at)}${r.review_note ? `: ${r.review_note}` : ''}`}
                </Body>
              ) : null}
              {r.status === 'pending' ? (
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 2 }}>
                  <Pressable onPress={() => setDecide({ row: r, decision: 'reject' })} accessibilityRole="button" accessibilityLabel={`Reject the request for ${r.client_name}`}
                    style={{ flex: 1, minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: hexA(C.red, 0.4) }}>
                    <Icon name="close" size={12} color={C.red} strokeWidth={2.5} />
                    <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: C.red }}>Reject</Text>
                  </Pressable>
                  <Pressable onPress={() => setDecide({ row: r, decision: 'approve' })} accessibilityRole="button" accessibilityLabel={`Approve the request for ${r.client_name}`}
                    style={{ flex: 1.3, minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 11, backgroundColor: hexA(C.green, 0.14), borderWidth: 1, borderColor: hexA(C.green, 0.45) }}>
                    <Icon name="checks" size={13} color={C.green} strokeWidth={2.6} />
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: C.green }}>Approve</Text>
                  </Pressable>
                </View>
              ) : null}
            </Card>
          );
        })}

      <ApprovalDecisionSheet row={decide?.row ?? null} decision={decide?.decision ?? 'approve'} onClose={() => setDecide(null)} />
    </Page>
  );
}

function ApprovalDecisionSheet({ row, decision, onClose }: { row: ApprovalListRow | null; decision: 'approve' | 'reject'; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const kbH = useKeyboardHeight();
  const reviewM = useReviewApprovalRequest();
  const [note, setNote] = React.useState('');
  const visible = !!row;
  React.useEffect(() => { if (visible) { setNote(''); reviewM.reset(); } }, [visible]);
  const reject = decision === 'reject';
  const col = reject ? C.red : C.green;
  const problem = reject ? rejectNoteProblem(note) : null;
  const partner = row?.payload?.partner_name as string | undefined;
  const confirm = () => {
    if (!row || reviewM.isPending || problem) return;
    Keyboard.dismiss();
    reviewM.mutate({ id: row.id, decision, note, clientId: row.client_id }, {
      onSuccess: (r) => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        onClose();
        Alert.alert(r.status === 'approved' ? 'Approved' : r.status === 'rejected' ? 'Rejected' : 'Closed',
          r.status === 'approved' ? 'The Session code is off now and the CRM is told.'
            : r.status === 'rejected' ? 'The Session code stays on and the CRM sees your note.'
            : r.review_note || 'Nothing was left to do for this request.');
      },
      onError: (e) => Alert.alert(reject ? "Couldn't reject" : "Couldn't approve", (codedSentence(e) ?? friendlyError(e, 'Try again.'))),
    });
  };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => { if (!reviewM.isPending) onClose(); }}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable onPress={() => !reviewM.isPending && onClose()} accessibilityRole="button" accessibilityLabel="Close" importantForAccessibility="no-hide-descendants"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.64)' }} />
        <View accessibilityViewIsModal style={{ maxHeight: '88%', backgroundColor: C.sheetBg, borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: hexA(col, 0.3), paddingHorizontal: 18, paddingTop: 14, paddingBottom: 14 + insets.bottom + kbH }}>
          <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 12 }} />
          <Serif style={{ fontSize: 19 }}>{reject ? 'Reject this request?' : 'Approve and turn off the Session code?'}</Serif>
          <Body style={{ fontSize: 12, color: C.muted2, lineHeight: 17, marginTop: 4, marginBottom: 12 }}>
            {reject
              ? 'The Session code stays on and the CRM sees your note.'
              : `The Session code goes off for ${row?.client_name || 'this client'}${partner ? ` and ${partner}` : ''} now, and the CRM is told.`}
          </Body>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 8, paddingBottom: 8 }}>
            <View style={{ padding: 11, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', gap: 3 }}>
              <Body style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{row?.client_name}</Body>
              <Body style={{ fontSize: 11.5, color: C.muted2 }}>{row ? requesterText(row) : ''}: {row?.reason}</Body>
            </View>
            <Mono style={{ fontSize: 9, letterSpacing: 0.8, color: C.muted3 }}>{reject ? 'WHY (REQUIRED)' : 'NOTE (OPTIONAL)'}</Mono>
            <TextInput value={note} onChangeText={setNote} multiline maxLength={500} placeholder={reject ? 'Why is it rejected?' : 'Anything to add'} placeholderTextColor={C.muted3}
              accessibilityLabel="Decision note"
              style={{ minHeight: 70, textAlignVertical: 'top', fontFamily: F.body, fontSize: 14, color: '#fff', paddingVertical: 11, paddingHorizontal: 12, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }} />
            {reject && problem && note.length > 0 ? <Body style={{ fontSize: 11, color: C.muted3 }}>{problem}</Body> : null}
          </ScrollView>
          <View style={{ flexDirection: 'row', gap: 10, paddingTop: 12 }}>
            <Pressable onPress={onClose} disabled={reviewM.isPending} accessibilityRole="button"
              style={{ flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: C.muted }}>Back</Text>
            </Pressable>
            <Pressable onPress={confirm} disabled={reviewM.isPending || !!problem} accessibilityRole="button" accessibilityLabel={reject ? 'Reject' : 'Approve'}
              style={{ flex: 1.4, minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 12, backgroundColor: hexA(col, problem ? 0.06 : 0.16), borderWidth: 1, borderColor: hexA(col, problem ? 0.2 : 0.5), opacity: reviewM.isPending ? 0.6 : 1 }}>
              {reviewM.isPending ? <ActivityIndicator size="small" color={col} /> : <Icon name={reject ? 'close' : 'checks'} size={13} color={problem ? C.muted3 : col} strokeWidth={2.6} />}
              <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: problem ? C.muted3 : col }}>{reviewM.isPending ? 'Saving…' : reject ? 'Yes, reject' : 'Yes, approve'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
```

### 3.6 `src/screens/crmClientDetail.tsx` (`CrmClientDetail`): import + one line
Import, next to the `friendlyError` import:
```ts
import { friendlyError } from '../lib/friendlyError';
import { SessionCodeRow } from '../components/sessionCodeApproval';
```
In the hero card, right after the irregular-client switch's closing `</Pressable>` and before the Call client /
location chips:
```tsx
            {/* Irregular client toggle: red when marked, shows since-date + who marked it. */}
            <Pressable onPress={toggleIrregular} disabled={irregularM.isPending} accessibilityRole="switch" ...>
              ...unchanged...
            </Pressable>
            {/* Session code (clients.otp): on is direct; off goes to the doctors' manager for approval (2 Nov 2026). */}
            <SessionCodeRow clientId={client.id} clientName={name} otpOn={client.otp === true} />
            {(client.phone || client.location) ? (
```
`client` is `useCrmClientDetail(clientId).data?.client`, which reads `clients.select('*')`, so `otp` is already there.
`name` is the page's existing display name (`selectedClientName ?? first + last`).

### 3.7 `src/data.ts`: `doctorNav`, group "Workspace"
```ts
    { label: 'Reimbursements', icon: 'checks', route: 'doctor-reimbursement-review' },
    { label: 'Pending Approvals', icon: 'checks', route: 'doctor-pending-approvals' },
    { label: 'Dashboard', icon: 'grid', route: 'doctor-dashboard' },
```
Only the middle line is new. `consultantNav` and `adminNav` are unchanged.

### 3.8 `src/components/chrome.tsx`: `Drawer`, `itemVisible`
Right after the `doctor-reimbursement-review` line and before the head-doctor-only block
(`doctor-all-clients` / `doctor-roster` / `doctor-protocol-approvals`):
```ts
    if (it.route === 'doctor-reimbursement-review') return caps.data.isPhysioHod; // doctors' manager reviews reimbursements
    // Approval requests (Session code off, 2 Nov 2026): the doctors' manager by tag or the head-doctor id, as the server rule
    if (it.route === 'doctor-pending-approvals') return caps.data.isPhysioHod || session?.user?.id === '30df5c2b-0f40-4736-9f41-7cbc830a191a';
```
The badge needs no change here. The drawer already shows `badges[item.route]` for every item (`99+` above 99), and
3.9 adds the `doctor-pending-approvals` key.

### 3.9 `src/lib/navQueries.ts`: `useNavBadges`
Import, after the `useChatOverview` import:
```ts
import { useChatOverview } from './chatQueries';
import { useApprovalCounts } from './approvalRequestQueries';
```
Inside `useNavBadges`, after `const chatQ = useChatOverview(uid);`:
```ts
  const chatQ = useChatOverview(uid);
  // Approval requests waiting for the doctors' manager (the RPC answers only for reviewers; 0 rows for everyone else)
  const approvalQ = useApprovalCounts(role === 'doctor' || role === 'admin');
```
And the last key of the returned object:
```ts
  return {
    'crm-approvals': approvals,
    'crm-service': service,
    'crm-esc': escalations,
    'messenger': messenger,
    'doctor-pending-approvals': (approvalQ.data ?? []).reduce((n, c) => n + (c.pending || 0), 0),
  };
```
(`role` here is `useAuth().role`, the app role.) The badge is the sum of `pending` over the rows of
`get_approval_counts()`.

### 3.10 `src/Router.tsx`: import, route, replay mask
Import, after the `doctorReimbursements` import:
```ts
import { DoctorReimbursements, DoctorReimbursementReview } from './screens/doctorReimbursements';
import { DoctorPendingApprovals } from './screens/doctorApprovals';
```
In `SCREENS`, after `'doctor-reimbursement-review'`:
```ts
  'doctor-reimbursement-review': DoctorReimbursementReview,
  // Approval requests (2 Nov 2026): the doctors' manager approves or rejects (first type: Session code off)
  'doctor-pending-approvals': DoctorPendingApprovals,
```
In `SENSITIVE_ROUTES`, right after the Reimbursements pair and before the Consultant routes:
```ts
  'doctor-reimbursements', 'doctor-reimbursement-review',
  // Approval requests: a CRM's reason can mention the client's health
  'doctor-pending-approvals',
```
**Replay mask (required).** This is the standing rule for Amplitude Session Replay (EU): screens with health content go
in `SENSITIVE_ROUTES`, and `RouteScreen` wraps them in `ReplayShield`, so replay records them as a blank region.
A CRM's reason can mention the client's health. The CRM page route `crm-client` is already in the set, which covers
the status line and history there; check that it is on iOS too.

### 3.11 What the new files expect to exist already
These were all on Android before this change (most since July 2026); none is new:
- `../theme`: `C` (`gold`, `green`, `red`, `muted`, `muted2`, `muted3`, `ink3`, `sheetBg`), `F` (`body`, `bodySemi`,
  `bodyBold`), `hexA`.
- `../icons`: `Icon` names `shield`, `chevUp`, `chevDown`, `checks`, `close`.
- `components/primitives`: `Body`, `Mono`, `Serif`, `Card`.
- `screens/common`: `Page`, `TitleBlock`, `BackLink`, `AccessPending`, `Badge`.
- `store`: `useStore` (`back`, `canGoBack`, `go`).
- `auth`: `useAuth` (`session`, `role`, `dbRole`).
- `lib`:
  - `capabilities`: `useMyCapabilities` (`isPhysioHod`);
  - `useKeyboardHeight`;
  - `friendlyError`;
  - `doctorQueries`: `HEAD_DOCTOR_ID`;
  - `withTimeout`: `withTimeout`, `NET_MS`;
  - `supabase`.
- Packages: `expo-haptics`, `react-native-safe-area-context`, `@tanstack/react-query`.

### 3.12 Checks before the phone
- `node tests/rules/approval_requests_test.js` prints ALL PASS. All other `node tests/rules/*_test.js` still pass.
- `npx tsc --noEmit` exits with code 0.

## 4. Check on the iPhone
A real approval turns a real client's Session code off. Use a client the owner agrees to test on, and turn the code
back on at the end.
1. As a **CRM**, open a client whose Session code is on (My Clients, then the client). Under the irregular-client
   switch you see the green row "Session code on" with "TURNING OFF NEEDS THE DOCTORS' MANAGER". There is no status
   line and no history fold yet.
2. Tap the row. The sheet "Turn off the Session code?" opens. Type 9 characters: "Send request" stays dim. Type
   10+: it lights up. The keyboard does not cover the box or the buttons.
3. Send. You see the alert "Request sent". The row now reads "OFF REQUEST WAITING FOR APPROVAL", with the amber line
   "Off request pending since <IST time> (asked by <you>), waiting for the doctors' manager." and a Withdraw button.
   "Session code requests (1)" appears below.
4. Tap the row again: you see the alert "Request already sent". Tap Withdraw, then "Withdraw": the amber line goes
   away, and the history shows "Withdrawn".
5. Send a new request with a reason. Sign in as the **doctors' manager** (the head-doctor account or a `physio_hod`
   doctor) and open the drawer. Under Workspace, "Pending Approvals" shows badge 1 (it can take up to 60 s).
   Another doctor's drawer has no such item.
6. Open it. You see "SESSION CODE OFF APPROVALS · 1 WAITING" and the card: client name, "<CRM> (CRM) asked on
   <time>", the reason, "Session code is on now", Reject / Approve. For a couple, the card also shows "Also turns off
   for <partner> (training partner)".
7. Tap Reject and type "no": the line "Write why it is rejected (at least 5 characters)." shows and "Yes, reject"
   stays dim. Type a longer note and reject. You see the alert "Rejected", the card leaves Pending and shows under
   Rejected, and the badge goes to 0.
8. Back on the CRM's phone, pull to refresh the client page: the red line "Off request rejected by <name> on <time>:
   <note>" shows. The switch is still on.
9. Send another request, and approve it as the manager. You see the alert "Approved". On the CRM page (pull to
   refresh), the row reads "Session code off" with "TAP TO TURN ON" and the green line "Turned off on <time> by <name>
   (asked by <CRM>: <reason>)". For a couple, the partner's page is off too.
10. In SQL: `select status, auto_approved, requested_by_name, reviewed_by_name, review_note from approval_requests
    where client_id = '<client>' order by requested_at desc limit 4;` shows approved, rejected, withdrawn, and the
    rest.
11. As the CRM, tap the off row, then "Turn on": the row turns green and the green line goes away (an approval is
    only news while the code is off).
12. Error sentences: leave a pending card open on the manager's iPhone, approve the same request on the web, then tap
    Approve, then "Yes, approve" on the iPhone. The alert reads "Couldn't approve" / "This request is already
    approved. Refresh the page." Not a generic line.
13. Airplane mode on the CRM's phone, then try to send: "Couldn't send the request" / "No connection. Check your
    internet and try again."
14. Amplitude Session Replay of a Pending Approvals visit shows the screen as a blank region (Screen Viewed still
    fires).

Not confirmed:
- The iOS drawer badge lookup (`badges[item.route]`), `useNavBadges`, `SENSITIVE_ROUTES` and `ReplayShield` are
  assumed to match Android; this was written without the iOS repo.
- The Android feature doc says "rule tests 32/32", but the test file has 31 checks (31 PASS lines on 2 Nov 2026).
- Not yet tried on an Android device; the feature doc lists the device test as pending.
