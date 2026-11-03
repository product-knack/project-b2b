/* Team Wallet rules (2 Nov 2026). Pure: no React, no network; tested in node (tests/rules/team_wallet_test.js) and
   copied byte for byte to iOS. The server (hub-track migrations 20261102160000 to 20261103120000) holds every limit;
   these are the same numbers for the sheet's live hints and the copy of every row, chip and line.
   Owner: Rs 500 minimum, Rs 5,000 per person per IST day. The Odds AI plan (trainers only), final rule 3 Nov 2026:
   generating is free any number of times; ONE fixed charge (Rs 50, the server constant wins) when the plan is
   created, the first 3 plans free, Essentials free, manual plans free; only a negative balance blocks.
   Plans: docs/team-wallet-plan.md, docs/ai-plan-charge-on-create-plan.md. */

export const MIN_TOPUP_PAISE = 50000;
/** Exactly Rs 1 is accepted as a test top-up (owner, 2 Nov 2026, while the wallet is being tested). */
export const TEST_TOPUP_PAISE = 100;
export const DAILY_CAP_PAISE = 500000;
export const AI_FLOOR_PAISE = 5000;
/** The fixed price of an Odds AI plan (3 Nov 2026); the server's price_paise replaces it when present. */
export const AI_PLAN_PRICE_PAISE = 5000;
export const TOPUP_PICKS = [50000, 100000, 200000, 500000] as const;
export const TOPUP_EXPIRY_MS = 30 * 60_000;
export const BILL_EXPIRY_MS = 24 * 60 * 60_000;

export type WalletKind = 'topup' | 'ai_plan' | 'reversal' | 'refund' | 'adjustment';
export type WalletStatus = 'pending' | 'paid' | 'failed' | 'expired' | 'cancelled';
export type WalletRow = {
  id: string;
  seq: number;
  kind: WalletKind;
  amount_paise: number;
  status: WalletStatus;
  balance_after_paise: number | null;
  created_at: string;
  paid_at: string | null;
  razorpay: { order_id?: string; payment_id?: string; method?: string; refund_id?: string } | null;
  meta: Record<string, any>;
};
export type BillPreview = { sections: string[]; exercise_count: number; split_label?: string | null };
export type PendingBill = { tx_id: string; bill_paise: number; client_id: string | null; client_name: string | null; created_at: string | null; preview: BillPreview | null };
export type TeamWalletRead = {
  balance_paise: number;
  today_topup_paise: number;
  today_room_paise: number;
  min_topup_paise: number;
  daily_cap_paise: number;
  ai_floor_paise: number;
  /** 3 Nov 2026: the balance is below zero (an AI plan took it there); the owner's sentence for the screen. */
  negative: boolean;
  negative_line: string | null;
  /** The fixed price of an Odds AI plan, charged once when the plan is created (3 Nov 2026). */
  ai_plan_price_paise: number;
  charges_ai: boolean;
  free_total: number;
  free_used: number;
  free_left: number;
  pending_bill: PendingBill | null;
  rows: WalletRow[];
};
/** What ai-plan-draft's preview says about the caller's wallet (null while the wallet is not on the server).
    Free plans (owner, 2 Nov 2026): a trainer's first 3 AI plans for non-Essentials clients are free (free_left), an
    Essentials client is always free; free_this = this plan costs nothing, billed = the plan will be charged. */
export type WalletGate = {
  charges: boolean; balance_paise: number; floor_paise: number;
  /** 3 Nov 2026: the balance is below zero (only this blocks), the price (bill_paise = the same fixed figure). */
  negative: boolean; bill_paise: number | null; line: string | null;
  /** 3 Nov 2026 (final): the fixed price and when the money moves ('plan_create' = once, when Create Plan succeeds). */
  price_paise: number; charge_at: 'plan_create' | 'draft';
  free_total: number; free_used: number; free_left: number; essentials: boolean; free_this: boolean; billed: boolean;
  pending_bill: PendingBill | null; ok: boolean; reason: 'WALLET_FLOOR' | 'WALLET_BILL_PENDING' | 'WALLET_NEGATIVE' | null;
};
export const FREE_DRAFTS = 3;
export type AiBill = { tx_id: string; bill_paise: number; balance_paise: number; blocks: string[] };
export type Tone = 'green' | 'amber' | 'red' | 'grey';

const num = (v: unknown, d = 0): number => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const str = (v: unknown): string | null => (v == null ? null : String(v));

/* ---------- money ---------- */
/** "Rs 1,00,000" with Indian grouping, whole rupees from paise; negative as "- Rs 40"; 0 as "Rs 0". */
export const rupees = (paise: number): string => {
  const n = Math.round(Math.abs(num(paise)) / 100);
  const s = String(n);
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  const grouped = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3 : last3;
  return `${num(paise) < 0 ? '- ' : ''}Rs ${grouped}`;
};
/** "+ Rs 2,000" for a credit, "- Rs 40" for a debit. */
export const signedRupees = (paise: number): string => (num(paise) >= 0 ? `+ ${rupees(paise)}` : rupees(paise));

/** Whole rupees typed in the box, as paise; null for empty, decimals or letters. "2,000" and "2 000" are fine. */
export const parseRupeeInput = (text: string): number | null => {
  const t = String(text ?? '').replace(/[,\s]/g, '').replace(/^rs\.?/i, '');
  if (!/^\d{1,7}$/.test(t)) return null;
  const n = Number(t);
  return n > 0 ? n * 100 : null;
};

/** The sheet's live line under the box; null when the amount can go. */
export const topupProblem = (amountPaise: number | null, roomPaise: number): string | null => {
  if (roomPaise <= 0) return `You have added ${rupees(DAILY_CAP_PAISE)} today. Try again tomorrow.`;
  if (amountPaise == null) return null;
  if (amountPaise === TEST_TOPUP_PAISE) return null;
  if (amountPaise < MIN_TOPUP_PAISE) return `The minimum is ${rupees(MIN_TOPUP_PAISE)}.`;
  if (amountPaise > roomPaise) return `You can add ${rupees(roomPaise)} more today.`;
  return null;
};
/** The neutral hint while the amount is fine. */
export const topupRoomLine = (roomPaise: number): string => (roomPaise <= 0 ? `You have added ${rupees(DAILY_CAP_PAISE)} today. Try again tomorrow.` : `You can add ${rupees(roomPaise)} more today.`);

/* ---------- rows ---------- */
export const parseWalletRow = (r: any): WalletRow | null => {
  if (!r || typeof r !== 'object' || !r.id) return null;
  const kind = String(r.kind ?? '') as WalletKind;
  const status = String(r.status ?? '') as WalletStatus;
  if (!['topup', 'ai_plan', 'reversal', 'refund', 'adjustment'].includes(kind)) return null;
  if (!['pending', 'paid', 'failed', 'expired', 'cancelled'].includes(status)) return null;
  const rz = r.razorpay && typeof r.razorpay === 'object' ? r.razorpay : null;
  return {
    id: String(r.id), seq: num(r.seq), kind, amount_paise: num(r.amount_paise), status,
    balance_after_paise: r.balance_after_paise == null ? null : num(r.balance_after_paise),
    created_at: String(r.created_at ?? ''), paid_at: str(r.paid_at),
    razorpay: rz ? { order_id: str(rz.order_id) ?? undefined, payment_id: str(rz.payment_id) ?? undefined, method: str(rz.method) ?? undefined, refund_id: str(rz.refund_id) ?? undefined } : null,
    meta: r.meta && typeof r.meta === 'object' ? r.meta : {},
  };
};
export const parsePendingBill = (b: any): PendingBill | null => {
  if (!b || typeof b !== 'object' || !b.tx_id) return null;
  const p = b.preview && typeof b.preview === 'object' ? b.preview : null;
  return {
    tx_id: String(b.tx_id), bill_paise: num(b.bill_paise), client_id: str(b.client_id), client_name: str(b.client_name), created_at: str(b.created_at),
    preview: p ? { sections: Array.isArray(p.sections) ? p.sections.map(String) : [], exercise_count: num(p.exercise_count), split_label: str(p.split_label) } : null,
  };
};
export const parseWalletRead = (d: any): TeamWalletRead => ({
  balance_paise: num(d?.balance_paise),
  today_topup_paise: num(d?.today_topup_paise),
  today_room_paise: num(d?.today_room_paise, DAILY_CAP_PAISE),
  min_topup_paise: num(d?.min_topup_paise, MIN_TOPUP_PAISE),
  daily_cap_paise: num(d?.daily_cap_paise, DAILY_CAP_PAISE),
  ai_floor_paise: num(d?.ai_floor_paise, 0),
  negative: d?.negative === true || num(d?.balance_paise) < 0,
  negative_line: d?.negative_line ? String(d.negative_line) : num(d?.balance_paise) < 0 ? negativeBalanceLine(num(d?.balance_paise)) : null,
  ai_plan_price_paise: num(d?.ai_plan_price_paise, AI_PLAN_PRICE_PAISE) || AI_PLAN_PRICE_PAISE,
  charges_ai: d?.charges_ai === true,
  free_total: num(d?.free_total, FREE_DRAFTS),
  free_used: num(d?.free_used),
  free_left: num(d?.free_left),
  pending_bill: parsePendingBill(d?.pending_bill),
  rows: (Array.isArray(d?.rows) ? d.rows : []).map(parseWalletRow).filter(Boolean) as WalletRow[],
});
export const parseWalletGate = (w: any): WalletGate | null => {
  if (!w || typeof w !== 'object') return null;
  const reason = w.reason === 'WALLET_FLOOR' || w.reason === 'WALLET_BILL_PENDING' || w.reason === 'WALLET_NEGATIVE' ? w.reason : null;
  const charges = w.charges === true;
  const free_left = num(w.free_left);
  const essentials = w.essentials === true;
  const free_this = typeof w.free_this === 'boolean' ? w.free_this : !charges || essentials || free_left > 0;
  const balance_paise = num(w.balance_paise);
  const price_paise = num(w.price_paise, 0) > 0 ? num(w.price_paise) : num(w.bill_paise, 0) > 0 ? num(w.bill_paise) : AI_PLAN_PRICE_PAISE;
  return {
    charges, balance_paise, floor_paise: num(w.floor_paise, 0),
    negative: w.negative === true || balance_paise < 0, bill_paise: w.bill_paise == null ? null : num(w.bill_paise), line: w.line == null ? null : String(w.line),
    price_paise, charge_at: w.charge_at === 'draft' ? 'draft' : 'plan_create',
    free_total: num(w.free_total, FREE_DRAFTS), free_used: num(w.free_used), free_left, essentials, free_this,
    billed: typeof w.billed === 'boolean' ? w.billed : charges && !free_this,
    pending_bill: parsePendingBill(w.pending_bill), ok: w.ok !== false && !reason, reason,
  };
};
export const isFreeRow = (r: WalletRow): boolean => r.kind === 'ai_plan' && r.meta?.free === true;

export const isPendingTopup = (r: WalletRow): boolean => r.kind === 'topup' && r.status === 'pending';
export const isPendingBill = (r: WalletRow): boolean => r.kind === 'ai_plan' && r.status === 'pending';
/** A pending top-up older than 30 minutes is as good as expired (the sweep runs every 15 minutes). */
export const topupExpired = (r: WalletRow, nowMs: number = Date.now()): boolean =>
  isPendingTopup(r) && nowMs - new Date(r.created_at).getTime() > TOPUP_EXPIRY_MS;

export const methodLabel = (m: string | null | undefined): string | null => {
  switch (String(m ?? '').toLowerCase()) {
    case 'upi': return 'UPI';
    case 'card': return 'Card';
    case 'netbanking': return 'Net banking';
    case 'wallet': return 'Wallet';
    case 'emi': return 'EMI';
    case '': return null;
    default: return String(m);
  }
};

const IST = 'Asia/Kolkata';
/** "2 Nov, 3:08 PM" in IST. */
export const fmtWhen = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = d.toLocaleDateString('en-IN', { timeZone: IST, day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('en-IN', { timeZone: IST, hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\s*(am|pm)$/i, (m) => ' ' + m.trim().toUpperCase());
  return `${day}, ${time}`;
};
/** "NOVEMBER 2026" (IST). */
export const monthHeader = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { timeZone: IST, month: 'long', year: 'numeric' }).toUpperCase();
};
export const groupByMonth = (rows: WalletRow[]): { header: string; rows: WalletRow[] }[] => {
  const out: { header: string; rows: WalletRow[] }[] = [];
  for (const r of [...rows].sort((a, b) => b.seq - a.seq)) {
    const h = monthHeader(r.created_at);
    const last = out[out.length - 1];
    if (last && last.header === h) last.rows.push(r); else out.push({ header: h, rows: [r] });
  }
  return out;
};

const firstName = (s: unknown): string => String(s ?? '').trim().split(/\s+/)[0] || 'client';
export const rowTitle = (r: WalletRow): string => {
  switch (r.kind) {
    case 'topup': return 'Added money';
    case 'ai_plan': return `Odds AI plan, ${firstName(r.meta?.client_name)}`;
    case 'reversal': return 'Returned';
    case 'refund': return 'Refunded to your bank';
    case 'adjustment': return 'Adjustment by Odds';
    default: return 'Wallet';
  }
};
/** "Free" for a free draft row (0 rupees), else the signed amount. */
export const rowAmountText = (r: WalletRow): string => (isFreeRow(r) ? 'Free' : signedRupees(r.amount_paise));
export const rowStatusLine = (r: WalletRow, nowMs: number = Date.now()): string => {
  if (isFreeRow(r)) return r.meta?.essentials === true ? 'Free for Essentials clients' : 'Free plan, not charged';
  if (r.status === 'paid') return r.balance_after_paise == null ? 'Paid' : `Balance ${rupees(r.balance_after_paise)}`;
  if (r.status === 'pending') {
    if (r.kind === 'topup') return topupExpired(r, nowMs) ? 'Expired, not charged' : 'Waiting for payment';
    if (r.kind === 'ai_plan') return 'Bill waiting: deduct or discard';
    return 'Waiting';
  }
  if (r.status === 'failed') return `Failed: ${String(r.meta?.failure_reason ?? 'the payment did not go through')}`;
  if (r.status === 'expired') return 'Expired, not charged';
  if (r.status === 'cancelled') return r.meta?.cancel_reason === 'expired' ? 'Expired, not charged' : 'Discarded';
  return '';
};
/** "2 Nov, 3:08 PM · Balance Rs 2,500" */
export const rowSecondLine = (r: WalletRow, nowMs: number = Date.now()): string => {
  const when = fmtWhen(r.paid_at ?? r.created_at);
  const line = rowStatusLine(r, nowMs);
  return when && line ? `${when} · ${line}` : when || line;
};
export const rowChip = (r: WalletRow, nowMs: number = Date.now()): { text: string; tone: Tone } => {
  if (isFreeRow(r)) return { text: 'FREE', tone: 'green' };
  if (r.status === 'paid') return { text: 'PAID', tone: 'green' };
  if (r.status === 'pending') return r.kind === 'topup' && topupExpired(r, nowMs) ? { text: 'EXPIRED', tone: 'grey' } : { text: 'WAITING', tone: 'amber' };
  if (r.status === 'failed') return { text: 'FAILED', tone: 'red' };
  if (r.status === 'expired') return { text: 'EXPIRED', tone: 'grey' };
  return r.meta?.cancel_reason === 'expired' ? { text: 'EXPIRED', tone: 'grey' } : { text: 'DISCARDED', tone: 'grey' };
};

/* ---------- the AI plan bill ---------- */
export const billLines = (billPaise: number, balancePaise: number): { bill: string; after: string } => ({
  bill: `Your bill is ${rupees(billPaise)}.`,
  after: `Wallet ${rupees(balancePaise)}, after this ${rupees(balancePaise - billPaise)}`,
});
export const billPreviewLine = (p: BillPreview | null | undefined): string => {
  if (!p) return '';
  const n = p.sections.length;
  return `${n} section${n === 1 ? '' : 's'}, ${p.exercise_count} exercise${p.exercise_count === 1 ? '' : 's'}`;
};
export type WalletCardState = 'free' | 'essentials' | 'free_left' | 'ok' | 'negative' | 'bill_pending' | 'unknown';
/** "3 free AI plans left" / "1 free AI plan left" */
export const freeLeftLine = (n: number): string => `${n} free AI plan${n === 1 ? '' : 's'} left`;
/** "Rs -5" in the owner's form for a balance (rupees() prints "- Rs 5" for amounts). */
export const balanceText = (paise: number): string => (num(paise) < 0 ? `Rs -${rupees(-num(paise)).slice(3)}` : rupees(paise));
/** The owner's sentence for a wallet below zero (3 Nov 2026). */
export const negativeBalanceLine = (balancePaise: number): string => `Your wallet is at ${balanceText(balancePaise)}. Add funds to make the next plan with Odds AI.`;
/** The price the gate names (the server's constant; the local figure only while the server does not say). */
export const planPrice = (w: WalletGate | null | undefined): number => (w && w.price_paise > 0 ? w.price_paise : AI_PLAN_PRICE_PAISE);
/** The Create Plan AI card: what the wallet allows and the line to show. Only a negative balance blocks (3 Nov 2026);
    a balance below the price does not. The money moves once, when the plan is created (rule final 3 Nov 2026). */
export const walletCardState = (w: WalletGate | null | undefined): { state: WalletCardState; line: string | null; action: 'wallet' | 'bill' | null } => {
  if (!w) return { state: 'unknown', line: null, action: null };
  if (!w.charges) return { state: 'free', line: null, action: null };
  if (w.essentials) return { state: 'essentials', line: 'Free for Essentials clients.', action: null };
  if (w.free_left > 0) return { state: 'free_left', line: `${freeLeftLine(w.free_left)}, then ${rupees(planPrice(w))} a plan from your wallet when you create it.`, action: null };
  if (w.pending_bill) return { state: 'bill_pending', line: 'Settle or discard your last draft first.', action: 'bill' };
  if (w.negative) return { state: 'negative', line: w.line ?? negativeBalanceLine(w.balance_paise), action: 'wallet' };
  return { state: 'ok', line: `${rupees(planPrice(w))} from your wallet when you create the plan · balance ${balanceText(w.balance_paise)}`, action: null };
};
/** The chooser card's chip (3 Nov 2026): "2 FREE LEFT" / "FREE FOR ESSENTIALS" / "RS 50" / "ADD FUNDS". */
export const aiOptionChip = (w: WalletGate | null | undefined): { text: string; tone: Tone } | null => {
  if (!w || !w.charges) return null;
  if (w.essentials) return { text: 'FREE FOR ESSENTIALS', tone: 'green' };
  if (w.free_left > 0) return { text: `${w.free_left} FREE LEFT`, tone: 'green' };
  if (w.pending_bill) return { text: 'BILL WAITING', tone: 'amber' };
  if (w.negative) return { text: 'ADD FUNDS', tone: 'red' };
  return { text: rupees(planPrice(w)).toUpperCase(), tone: 'amber' };
};
/** "Rs 50 deducted. Wallet Rs 417." (red when negative). */
export const afterChargeLine = (chargedPaise: number, balancePaise: number): { text: string; tone: 'red' | 'green' } =>
  chargedPaise > 0 ? { text: `${rupees(chargedPaise)} deducted. Wallet ${balanceText(balancePaise)}.`, tone: balancePaise < 0 ? 'red' : 'green' } : { text: `Wallet ${balanceText(balancePaise)}.`, tone: balancePaise < 0 ? 'red' : 'green' };
/** The assistant panel's hint under Generate (generating is free; what Create Plan will do). Null when nothing is charged. */
export const generateHint = (w: WalletGate | null | undefined): string | null => {
  if (!w || !w.charges) return null;
  if (w.essentials) return 'Generating is free. Essentials plans are free.';
  if (w.free_left > 0) return `Generating is free. This plan uses 1 of your ${w.free_left} free AI plan${w.free_left === 1 ? '' : 's'}.`;
  return `Generating is free. ${rupees(planPrice(w))} is deducted once, when you tap Create Plan.`;
};
/** The Create Plan button for an AI plan: "Create Plan · Rs 50" / "Create Plan · free"; plain for manual plans and free roles. */
export const createButtonLabel = (w: WalletGate | null | undefined, aiPlan: boolean): string => {
  if (!aiPlan || !w || !w.charges) return 'Create Plan';
  if (w.essentials || w.free_left > 0) return 'Create Plan · free';
  return `Create Plan · ${rupees(planPrice(w))}`;
};
/** The line after an AI plan is saved: what the wallet did (the server charged inside the save; the phone knows the
    price and the last balance). queued = saved on the device, the charge lands with the sync. */
export const createDoneLine = (w: WalletGate | null | undefined, aiPlan: boolean, queued: boolean): { text: string; tone: 'red' | 'green' | 'grey' } | null => {
  if (!aiPlan || !w || !w.charges) return null;
  if (w.essentials) return { text: 'Free for Essentials clients. Nothing deducted.', tone: 'green' };
  if (w.free_left > 0) return { text: `Free AI plan used. ${freeLeftLine(w.free_left - 1)}.`, tone: 'green' };
  if (queued) return { text: `${rupees(planPrice(w))} will be deducted when it syncs.`, tone: 'grey' };
  return afterChargeLine(planPrice(w), w.balance_paise - planPrice(w));
};

/** The sentence after "WALLET_CODE:" of a server refusal, else null. */
export const codedWalletSentence = (e: unknown): string | null => {
  const msg = String((e as { message?: unknown } | null)?.message ?? '').trim();
  const m = msg.match(/^WALLET_[A-Z_]+:\s*(.+)$/s);
  return m && m[1].trim() ? m[1].trim() : null;
};
export const walletCodeOf = (e: unknown): string | null => String((e as { message?: unknown } | null)?.message ?? '').match(/^(WALLET_[A-Z_]+):/)?.[1] ?? null;
