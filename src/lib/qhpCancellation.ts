/* QHP cancellation requests, pure rules (26 Oct 2026). Owner, 14 Oct 2026: the assessor never cancels a QHP,
   they request it with a reason and a paid / unpaid claim; the QHP Manager approves (confirming paid or
   unpaid, which Plutus pays and QHP Stats counts) or declines with a note. Backend live since 14 Oct 2026
   (hub-track migration 20261014140000); the app only reads coach_assessment.cancelled and
   coach_assessment.cancellation_request and calls the three RPCs. Context: docs/qhp-paid-cancellation-context.md.
   Copy rules: no dashes, "QHP Manager", "paid cancellation", "unpaid". */

export type Payment = 'paid' | 'unpaid';

export type CancelView =
  | { kind: 'none' }
  | { kind: 'pending'; claim: Payment; reason: string; requestedByName: string | null; requestedAt: string | null }
  | { kind: 'approved'; payment: Payment; claim: Payment | null; decidedByName: string | null; note: string | null; at: string | null; reason: string }
  | { kind: 'declined'; note: string; decidedByName: string | null; claim: Payment; reason: string; at: string | null }
  | { kind: 'cancelled_direct'; payment: Payment; byName: string | null; at: string | null; reason: string };

const pay = (v: unknown): Payment => (v === 'paid' ? 'paid' : 'unpaid');
const obj = (v: unknown): Record<string, any> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : null);

/** One display status per QHP row from its two jsonb columns. Older rows without `payment` read as unpaid. */
export function cancelViewOf(row: { cancelled?: unknown; cancellation_request?: unknown } | null | undefined): CancelView {
  const c = obj(row?.cancelled);
  const r = obj(row?.cancellation_request);
  if (c) {
    if (r?.status === 'approved' || c.requested_by) {
      return { kind: 'approved', payment: pay(c.payment), claim: c.requested_payment ? pay(c.requested_payment) : r?.payment ? pay(r.payment) : null,
               decidedByName: c.cancelled_by_name ?? r?.decided_by_name ?? null, note: c.decision_note ?? r?.decision_note ?? null, at: c.at ?? null, reason: String(c.reason ?? r?.reason ?? '') };
    }
    return { kind: 'cancelled_direct', payment: pay(c.payment), byName: c.cancelled_by_name ?? null, at: c.at ?? null, reason: String(c.reason ?? '') };
  }
  if (r?.status === 'pending') return { kind: 'pending', claim: pay(r.payment), reason: String(r.reason ?? ''), requestedByName: r.requested_by_name ?? null, requestedAt: r.requested_at ?? null };
  if (r?.status === 'declined') return { kind: 'declined', note: String(r.decision_note ?? ''), decidedByName: r.decided_by_name ?? null, claim: pay(r.payment), reason: String(r.reason ?? ''), at: r.decided_at ?? null };
  return { kind: 'none' }; // null or withdrawn
}

export type ChipTone = 'amber' | 'green' | 'grey' | 'red';
/** The chip on a card: text and tone. Nothing for `none`. */
export function cancelChip(v: CancelView): { text: string; tone: ChipTone } | null {
  if (v.kind === 'pending') return { text: `Cancellation pending · ${v.claim === 'paid' ? 'Paid' : 'Unpaid'}`, tone: 'amber' };
  if (v.kind === 'approved') return v.payment === 'paid' ? { text: 'Paid cancellation', tone: 'green' } : { text: 'Cancelled · Unpaid', tone: 'grey' };
  if (v.kind === 'declined') return { text: 'Cancellation not approved', tone: 'red' };
  if (v.kind === 'cancelled_direct') return { text: v.payment === 'paid' ? 'Cancelled · Paid' : 'Cancelled · Unpaid', tone: v.payment === 'paid' ? 'green' : 'grey' };
  return null;
}

/** "26 Oct" in India time from an ISO instant or a YYYY-MM-DD date. */
export const istDay = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00+05:30`) : new Date(iso);
  if (!isFinite(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' });
};

/** The line under the chip. `forAssessor` says "You asked for…" instead of "Assessor asked for…". */
export function cancelDetail(v: CancelView, forAssessor: boolean): string {
  const who = forAssessor ? 'You' : 'The assessor';
  if (v.kind === 'pending') return `Asked${v.requestedByName && !forAssessor ? ` by ${v.requestedByName}` : ''}${v.requestedAt ? ` on ${istDay(v.requestedAt)}` : ''}. Waiting for the QHP Manager.${v.reason ? ` Reason: ${v.reason}` : ''}`;
  if (v.kind === 'approved') {
    const parts = [`Approved${v.decidedByName ? ` by ${v.decidedByName}` : ''}${v.at ? ` on ${istDay(v.at)}` : ''}.`];
    if (v.claim && v.claim !== v.payment) parts.push(`${who} asked for ${v.claim}.`);
    if (v.note) parts.push(`Note: ${v.note}`);
    return parts.join(' ');
  }
  if (v.kind === 'declined') return `${v.decidedByName ? `${v.decidedByName} did not approve` : 'Not approved'}${v.at ? ` on ${istDay(v.at)}` : ''}. The QHP stays scheduled.${v.note ? ` Note: ${v.note}` : ''}`;
  if (v.kind === 'cancelled_direct') return `Cancelled${v.byName ? ` by ${v.byName}` : ''}${v.at ? ` on ${istDay(v.at)}` : ''}.${v.reason ? ` Reason: ${v.reason}` : ''}`;
  return '';
}

/** Counted as a paid cancellation everywhere (Plutus, QHP Stats): only a cancelled row whose final payment is paid. */
export const isPaidCancellation = (v: CancelView): boolean => (v.kind === 'approved' || v.kind === 'cancelled_direct') && v.payment === 'paid';

export type CancelFilter = 'all' | 'pending' | 'approved';
/** The Cancellations tab filter: Approved means any cancelled row (approved or direct), paid or unpaid. */
export const matchesFilter = (v: CancelView, f: CancelFilter): boolean =>
  v.kind !== 'none' && (f === 'all' || (f === 'pending' ? v.kind === 'pending' : v.kind === 'approved' || v.kind === 'cancelled_direct'));

/** Sort key for the Cancellations tab: the latest event first. */
export const cancelSortKey = (v: CancelView): string =>
  v.kind === 'pending' ? v.requestedAt ?? '' : v.kind === 'none' ? '' : v.at ?? '';

/** The assessor may ask when nothing is pending and the QHP is neither completed nor cancelled. */
export const canRequestCancellation = (row: { is_completed?: boolean }, v: CancelView): boolean =>
  !row.is_completed && (v.kind === 'none' || v.kind === 'declined');

/* ---------- copy ---------- */
export const REQUEST_TITLE = 'Request cancellation';
export const REQUEST_LINE = 'The QHP Manager decides. The QHP stays scheduled until they approve.';
export const REQUEST_CHARGE = 'Should the client be charged for this cancellation?';
export const REQUEST_HINT = 'This is your claim. The QHP Manager confirms the final choice.';
export const REQUEST_AGAIN = 'Request again';
export const WITHDRAW = 'Withdraw request';
export const APPROVE_TITLE = 'Approve cancellation';
export const APPROVE_CHARGE = 'Charge the client?';
export const APPROVE_BUTTON = 'Cancel the QHP';
export const DECLINE_TITLE = 'Decline request';
export const DECLINE_LINE = 'Tell the assessor why. The QHP stays scheduled.';
export const REASON_MAX = 500;

/** Server error codes (message starts with the code) → plain copy. Anything else goes to friendlyError. */
const CODES: Record<string, string> = {
  QHP_CANCEL_PENDING: 'A cancellation request is already waiting for the QHP Manager.',
  QHP_CANCEL_COMPLETED: 'This QHP is already completed.',
  QHP_CANCEL_ALREADY: 'This QHP is already cancelled.',
  QHP_CANCEL_FORBIDDEN: 'You cannot do this for this QHP.',
  QHP_CANCEL_NOT_PENDING: 'This request was already decided or withdrawn. Pull to refresh.',
  QHP_CANCEL_REASON_REQUIRED: 'Add a reason.',
  QHP_CANCEL_PAYMENT_REQUIRED: 'Choose paid or unpaid.',
  QHP_CANCEL_NOTE_REQUIRED: 'Add a note saying why the request is declined.',
  QHP_CANCEL_NO_QHP: 'This QHP no longer exists.',
  QHP_CANCEL_VIA_REQUEST: 'Assessors cancel through a request.',
  QHP_CANCEL_REQUEST_RPC_ONLY: 'This cannot be changed from the app.',
};
export const qhpCancelCodeText = (message: string | null | undefined): string | null => {
  const m = (message ?? '').match(/QHP_CANCEL_[A-Z_]+/);
  return m && CODES[m[0]] ? CODES[m[0]] : null;
};
export const isNotPendingError = (message: string | null | undefined): boolean => /QHP_CANCEL_NOT_PENDING/.test(message ?? '');
