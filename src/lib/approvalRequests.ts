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

/** The plain sentence of an approval / Session code / client location server error ("APPROVAL_OWN_REQUEST: You
    cannot review your own request."). Some of them carry the 42501 "not allowed" code, which friendlyError turns
    into its generic line; these screens show the server's own sentence first and fall back to friendlyError
    otherwise. LOCATION_ added 2 Nov 2026 (set_client_brb_location); WALLET_ the same day (Team Wallet). */
export const codedSentence = (e: unknown): string | null => {
  const msg = String((e as { message?: unknown } | null)?.message ?? '').trim();
  const m = msg.match(/^(?:OTP|APPROVAL|LOCATION|WALLET|COMPLAINT)_[A-Z_]+:\s*(.+)$/s);
  return m && m[1].trim() ? m[1].trim() : null;
};

/** Reason / note checks the server also makes (so the button can say why it is not ready). */
export const reasonProblem = (reason: string): string | null =>
  reason.trim().length >= MIN_REASON ? null : `Write the reason (at least ${MIN_REASON} characters).`;
export const rejectNoteProblem = (note: string): string | null =>
  note.trim().length >= MIN_REJECT_NOTE ? null : `Write why it is rejected (at least ${MIN_REJECT_NOTE} characters).`;
