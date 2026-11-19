/* Paid cancellation codes on the CRM dashboard (19 Nov 2026, owner: "build this in crm dashboard").
   The web CRM reads them on Daily Task (hub-track src/pages/crm/DailyTask.tsx, PaidCancelCodeBadge) from the
   definer function crm_daily_sessions(_date), which lists the sessions of the clients the signed-in CRM is actively
   assigned to. The app reads the same function. Pure rules only (no native imports), tested by
   tests/rules/paid_cancel_codes_test.js. A trainer types the code in PaidCancelCodeStep; the server gate
   (trg_zz_paid_cancel_code_gate) refuses a paid cancellation without it. */

export type CrmDailyStatus = 'scheduled' | 'completed' | 'cancelled';

export interface PaidCancelCodeRow {
  id: string;
  scheduledAt: string;
  clientName: string;
  trainerName: string;
  modality: string;
  status: CrmDailyStatus;
  code: string;
  verifiedAt: string | null;
}

const statusOf = (v: unknown): CrmDailyStatus => (v === 'completed' || v === 'cancelled' ? v : 'scheduled');

/** The rows a CRM needs a code for: a Session-code member's session that can still be cancelled (not logged, not
    cancelled), plus the ones whose code the trainer already used (shown as verified). Ordered by time. */
export const paidCancelCodeRows = (data: unknown): PaidCancelCodeRow[] => {
  if (!Array.isArray(data)) return [];
  const out: PaidCancelCodeRow[] = [];
  for (const r of data as any[]) {
    if (!r || r.otp !== true) continue;
    const code = typeof r.paid_cancellation_code === 'string' ? r.paid_cancellation_code.trim() : '';
    if (!code) continue;
    const status = statusOf(r.row_status);
    const verifiedAt = typeof r.paid_cancel_verified_at === 'string' && r.paid_cancel_verified_at ? r.paid_cancel_verified_at : null;
    if (status !== 'scheduled' && !verifiedAt) continue;
    out.push({
      id: String(r.id ?? ''),
      scheduledAt: String(r.scheduled_at ?? ''),
      clientName: String(r.client_name ?? '').trim() || 'Client',
      trainerName: String(r.trainer_name ?? '').trim() || 'Trainer',
      modality: String(r.modality ?? '').trim() || 'Session',
      status,
      code,
      verifiedAt,
    });
  }
  return out.sort((a, b) => (Date.parse(a.scheduledAt) || 0) - (Date.parse(b.scheduledAt) || 0));
};

/** YYYY-MM-DD of today (offset 0) or tomorrow (offset 1) in IST. */
export const istDateKey = (nowMs: number, offsetDays = 0): string =>
  new Date(nowMs + 330 * 60_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);

/** "4:30 PM" in IST. */
export const istTime = (iso: string | null | undefined): string => {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return '';
  const d = new Date(t + 330 * 60_000);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

export const PAID_CANCEL_CARD_TITLE = 'Paid cancellation codes';
export const PAID_CANCEL_CARD_NOTE = 'Give a code to the trainer only when the paid cancellation is agreed with the client.';
export const paidCancelEmptyLine = (day: 'today' | 'tomorrow'): string =>
  `No session ${day} needs a paid cancellation code.`;
export const paidCancelVerifiedLine = (verifiedAt: string): string => {
  const t = istTime(verifiedAt);
  return t ? `Used by the trainer at ${t}` : 'Used by the trainer';
};
