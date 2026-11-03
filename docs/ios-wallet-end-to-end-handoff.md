# iOS handoff, END TO END: Team Wallet and the Odds AI plan charging, final rules of 3 Nov 2026

Supersedes cards 10 (Team Wallet) and 13 (Create Plan entry), and the earlier version of this card. Everything below is
the state of the Android app and the server after the owner's FINAL charging rule of 3 Nov 2026 (one fixed charge per
plan at Create Plan, generating free). Build iOS from this file alone; section 4 is generated from the finished Android
files. Copy rule: no dashes in user-facing text (the few literal dashes inside copied code are written as
\u2014 / \u2013 text; restore them when pasting).

## 1. The rules (owner decisions, final)
1. **Wallet in every staff account.** Add money through Razorpay (whole rupees, minimum Rs 500, up to Rs 5,000 per
   person per IST day, at most 2 top-ups waiting, a waiting top-up expires after 30 minutes). Exactly Rs 1 is accepted
   as a test top-up while the wallet is being tested. Everyone sees only their own history. A receipt push after a paid
   top-up ("Rs 2,000 added to your wallet", data `{type: wallet_topup, route: wallet}`) opens the Wallet screen.
2. **The wallet pays for one thing: the Odds AI workout plan.** Trainers only (admins, super admins and coaches draft
   free). The price is FIXED per plan: one server constant, Rs 50 for now (`price_paise` in every answer; the app's
   `AI_PLAN_PRICE_PAISE` is only the fallback). No per-client data blocks, the price never moves.
3. **3 free AI plans per trainer** (lifetime) for non-Essentials clients; an Essentials client is always free and never
   counts. The count = the ledger's free rows plus the AI plans the trainer saved before 3 Nov 2026 (server side).
4. **Generating is free, any number of times.** Generate and Generate again never touch the wallet or the free count.
5. **Charged ONCE per plan, when Create Plan succeeds.** The SERVER does it: a trigger on the plan rows writes one
   wallet row per plan id (a free 0-row while free plans last or for an Essentials client, else the Rs 50 charge) the
   moment the plan is inserted, online, from the offline outbox when it syncs, or from iOS alike. iOS inserts the plan
   exactly as Android does (`source: 'ai'` on the rows when a draft was applied) and nothing else. Never twice for the
   same plan (Save & Resubmit, a retried sync, a double tap). Manual plans never charge; a draft applied and then
   rebuilt by hand is still an AI plan and is charged. The plan always lands: a wallet problem is a server warning.
6. **The balance may go negative** (Rs 28 wallet, Rs 50 plan: the wallet shows Rs -22), never below minus one plan's
   price (server constraint at -5000 paise). **Only a negative balance blocks**: at the chooser's AI card and again at
   the Create Plan button (popup; nothing saved). A balance below the price never blocks. The next top-up clears the
   negative first (Rs 500 at Rs -22 shows Rs 478).
7. **Create Plan from the Plan tab opens two options, AI generated and Manual plan.** The AI card shows the standing
   for this client before anything is generated (chip + line). With a negative balance, tapping it shows the popup
   "Your wallet is at Rs -22. Add funds to make the next plan with Odds AI." with Build manually / Add money.
8. Refunds: none from the app; a refund made in the Razorpay dashboard is recorded by the webhook. Admin adjustments
   (note mandatory) exist on the server, no screen. No refund on a rejected or deleted plan.
9. Offline: the Wallet screen shows the cached balance and history read-only; money moves online only. Create Plan's
   AI option needs a connection to generate; an AI plan saved offline is queued and charged by the server when it syncs
   (the footer says so). The negative check at the button uses the last known balance.

## 2. What the user sees (exact texts)

### 2.1 Wallet (drawer item "Wallet", every role, route `wallet`)
- Title "Wallet", sub "Add money, see your history".
- Balance card: big "Rs 2,500" (Indian grouping). Negative: "Rs -5" in red and under it "Your wallet is at Rs -5. Add
  funds to make the next plan with Odds AI." Below: "Updated 2 Nov, 3:10 PM" / "Offline, last known balance". Trainers
  (not negative): "N free AI plans left. After that an Odds AI plan costs Rs 50, deducted here when you create the plan.
  Generating is free." or "An Odds AI plan costs Rs 50, deducted here when you create the plan. Generating is free.
  Essentials clients stay free." (Rs 50 = `ai_plan_price_paise` from the read.)
- Button **Add money** (red **Add funds** while negative); off offline with "No connection. Money can only be added
  online." (one sheet for both).
- History grouped by IST month ("NOVEMBER 2026"), newest first: title ("Added money" / "Odds AI plan, <first name>" /
  "Returned" / "Refunded to your bank" / "Adjustment by Odds"), second line "2 Nov, 3:08 PM · Balance Rs 2,500" (or
  "Waiting for payment" / "Bill waiting: deduct or discard" (legacy) / "Failed: <reason>" / "Expired, not charged" /
  "Discarded" / "Free plan, not charged" / "Free for Essentials clients"), amount "+ Rs 2,000" green, "- Rs 40" white,
  "Free" for a free draft; chips PAID / WAITING / FAILED / EXPIRED / DISCARDED / FREE. "Load older" after 50; "THAT IS
  EVERYTHING". Empty: "No movements yet. Add money to start." Pull to refresh.
- Tap a row: the detail sheet (STATUS, WHEN, PAID AT, BALANCE AFTER, PAYMENT ID with copy, ORDER ID, REFUND ID, METHOD,
  CLIENT, NOTE); a waiting top-up gets "Pay Rs N now" (reopens the checkout); a legacy pending bill gets "Open in Create Plan".

### 2.2 Add money sheet
- "Add money" / "Minimum Rs 500. Up to Rs 5,000 a day."; chips Rs 500 / 1,000 / 2,000 / 5,000 (off above today's
  room); box "Amount in rupees" (digits only); live line: "You can add Rs 3,000 more today." / "The minimum is Rs 500."
  / "You have added Rs 5,000 today. Try again tomorrow." / "Adds Rs 2,000 to your wallet." / "Rs 1 test top-up (testing
  only)."; Cancel / "Continue, Rs 2,000" (on only when valid and online). While the wallet read has no data the sheet
  assumes the full day's room (the server decides).

### 2.3 Checkout (full-screen WebView)
- Header "Pay Rs 2,000 / Razorpay secure checkout", Close; the WebView loads INLINE HTML built in the app
  (`walletCheckoutHtml`) with an https `baseUrl` (the Supabase origin); the page opens Razorpay Standard Checkout at
  once and posts ONE message: `{ok, razorpay_order_id, razorpay_payment_id, razorpay_signature}` / `{dismissed}` /
  `{failed, reason}` (a failed attempt does not close the sheet; Razorpay retries inside). `upi://`, `intent://`,
  `tez://`, `phonepe://`, `paytmmp://` go to the system (`Linking.openURL`). On ok the app calls
  wallet-verify-payment and shows "Rs 2,000 added / Balance Rs 2,500."; on close the row stays WAITING for 30 minutes.
  A webhook credit after the sheet closed shows the same alert once (realtime on the user's rows while something is pending).

### 2.4 Create Plan chooser (client page > Plan tab > Create Plan; new plans only)
- Card **AI generated** (purple): title + chip, sub "Drafts a Strength Training plan from the QHP, medical and blood
  reports. You edit everything before it goes for review.", then the line.
  - chip **"2 FREE LEFT"** (green) + "2 free AI plans left, then Rs 50 a plan from your wallet when you create it."
  - chip **"FREE FOR ESSENTIALS"** (green) + "Free for Essentials clients."
  - chip **"RS 50"** (gold) + "Rs 50 from your wallet when you create the plan · balance Rs 467"
  - chip **"ADD FUNDS"** (red, red border) + "Your wallet is at Rs -22. Add funds to make the next plan with Odds AI."
  - chip **"BILL WAITING"** (gold) + "Settle or discard your last draft first." (legacy bill only)
  Tap: the AI builder; with a negative balance the popup "Add funds" with that sentence and **Build manually** / **Add money**.
- Card **Manual plan** (orange): "The plan builder as it is today: modality, sections, exercises and sets."
- Footer "Either way the plan goes to the CRM for review before it reaches the client."

### 2.5 The Odds AI panel (inside Create Plan, AI mode) and the Create Plan button
- The standing box (same texts as the card; "Add money in Wallet" button when negative, "Open bill, Rs 40" for a
  legacy bill). Generate button: "Generate workout plan" / "Generate again" (never a price). Hint under it
  (`generateHint`): "Generating is free. Rs 50 is deducted once, when you tap Create Plan." (billed) / "Generating is
  free. This plan uses 1 of your 2 free AI plans." / "Generating is free. Essentials plans are free."; nothing for
  roles that are not charged. After the draft: the green "Draft added below" box as before, no charge line.
- The sticky **Create Plan** button (`createButtonLabel`): "Create Plan · Rs 50" once a draft is applied and the plan
  is billed, "Create Plan · free" for a free or Essentials plan, plain "Create Plan" for manual plans and uncharged
  roles. Pressing it with a negative balance (the preview's latest wallet): popup "Add funds" with the owner's
  sentence, buttons **Keep editing** / **Add money**, nothing saved. After the save the footer line (`createDoneLine`)
  reads "Rs 50 deducted. Wallet Rs 417." (red when the result is negative, green otherwise) / "Rs 50 will be deducted
  when it syncs." (queued offline) / "Free AI plan used. 1 free AI plan left." / "Free for Essentials clients. Nothing
  deducted."; the screen waits 2.2 s (0.9 s when there is no line) before going back. The save then refreshes
  `['my-team-wallet']` and `['ai-plan-preview']` (also after a queued plan syncs).

## 3. Server contract (live)
Edge functions (bearer = the session token; refusals `{error: 'WALLET_CODE: sentence'}`, 400 / 402 WALLET_INSUFFICIENT /
403 WALLET_FORBIDDEN, WALLET_SIGN_IN / 503 WALLET_NOT_SET_UP). The app shows the sentence after the colon
(`codedSentence` with `WALLET` in its pattern), else `friendlyError`.
| call | request | answer |
|---|---|---|
| `wallet-create-order` | `{amount_inr}` or `{reopen_tx_id}` | `{tx_id, order_id, amount_paise, currency, key_id, checkout_url (unused), prefill{name,email,contact}, row}`; WALLET_MIN_AMOUNT / WALLET_DAILY_CAP / WALLET_PENDING_LIMIT / WALLET_PROVIDER |
| `wallet-verify-payment` | `{tx_id, razorpay_order_id, razorpay_payment_id, razorpay_signature}` | `{ok, credited_now, row, balance_paise}`; WALLET_SIGNATURE / WALLET_NOT_CAPTURED / WALLET_AMOUNT / WALLET_NOT_FOUND |
| `wallet-settle-ai-plan`, `wallet-discard-ai-plan` | `{tx_id}` | legacy bills only |
| `ai-plan-draft` preview | `{client_id, preview: true}` | `wallet: {charges, balance_paise, negative, bill_paise (= the price when billed, else null), blocks null, price_paise 5000, charge_at 'plan_create', free_total, free_used, free_left, essentials, free_this, billed, pending_bill, ok, reason, line}` (null while the wallet is not on the server) |
| `ai-plan-draft` draft | `{client_id, split, note?}` | the draft plus `wallet: {charged: false, charged_paise: 0, charge_at: 'plan_create', price_paise, balance_paise, negative, essentials, free_this, free_left, free_total, free}` (informational: nothing is charged for a draft; no wallet refusal before the model runs) |
RPCs (authenticated): `get_my_team_wallet(p_limit, p_before)` → `{balance_paise, negative, negative_line, today_topup_paise,
today_room_paise, min_topup_paise 50000, daily_cap_paise 500000, ai_plan_price_paise 5000, ai_bill_min_paise 5000, ai_bill_max_paise 5000,
ai_floor_paise 0, charges_ai, free_total, free_used, free_left, pending_bill, rows[]}`; rows `{id, seq, user_id, role, kind, amount_paise,
status, balance_after_paise, created_at, paid_at, razorpay{order_id, payment_id, method, refund_id}, meta}` (never the signature or
the payment entity; an AI plan row's meta carries `plan_id`, `charge_at`, `client_name`, `preview`, `free` / `essentials`).
The charge itself: trigger `trg_team_wallet_plan_created` on `workout_plan_exercises` (statement level) writes ONE row per new
AI plan id of a trainer (`team_wallet_record_free_draft` or `team_wallet_charge_ai_plan`, both keyed by the plan id, unique
index on `meta.plan_id`); plans that existed before the rule (`team_wallet_legacy_plans`) are never charged. iOS just inserts
the plan rows as Android does. Realtime: `postgres_changes` UPDATE on `public.team_wallet` filtered by `user_id`.
Cache keys: `['my-team-wallet']` (persisted), `['team-wallet-page', before]`, `['ai-plan-preview', clientId]`.

## 4. Code (generated from the Android tree)

### 4.1 New files in full

#### `src/lib/teamWallet.ts`
Pure rules (money text, the sheet hints, row copy, chips, the AI card standing, negative wallet). Copy byte for byte.

```ts
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
```

#### `tests/rules/team_wallet_test.js`
Rule test for teamWallet.ts. Copy as is.

```js
// Rule test for the Odds staff app. ROOT = the repo root; point it at the iOS repo and run: node tests/rules/team_wallet_test.js
const ROOT = require("path").resolve(__dirname, "../..");
// Team Wallet (2 Nov 2026): rupee text, the amount box, the sheet's hints, row copy and chips, grouping, the AI bill lines, the card state.
const ts = require(ROOT + '/node_modules/typescript');
const fs = require('fs');
const src = fs.readFileSync(ROOT + '/src/lib/teamWallet.ts', 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const m = { exports: {} }; new Function('module', 'exports', 'require', js)(m, m.exports, require);
const W = m.exports;
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };

// 1. money
eq('rupees 0', W.rupees(0), 'Rs 0');
eq('rupees 500', W.rupees(50000), 'Rs 500');
eq('rupees 2,000', W.rupees(200000), 'Rs 2,000');
eq('rupees 1,00,000', W.rupees(10000000), 'Rs 1,00,000');
eq('rupees 12,34,567', W.rupees(123456700), 'Rs 12,34,567');
eq('rupees rounds paise', W.rupees(250050), 'Rs 2,501');
eq('rupees negative', W.rupees(-4000), '- Rs 40');
eq('signed credit', W.signedRupees(200000), '+ Rs 2,000');
eq('signed debit', W.signedRupees(-4000), '- Rs 40');

// 2. the amount box
eq('parse 2,000', W.parseRupeeInput('2,000'), 200000);
eq('parse 500', W.parseRupeeInput('500'), 50000);
eq('parse Rs 500', W.parseRupeeInput('Rs 500'), 50000);
eq('parse 20.5', W.parseRupeeInput('20.5'), null);
eq('parse empty', W.parseRupeeInput(''), null);
eq('parse abc', W.parseRupeeInput('abc'), null);
eq('parse 0', W.parseRupeeInput('0'), null);

// 3. the sheet's hints
eq('problem: below the minimum', W.topupProblem(40000, 300000), 'The minimum is Rs 500.');
eq('problem: exactly the minimum', W.topupProblem(50000, 300000), null);
eq('problem: Rs 1 test top-up passes', W.topupProblem(100, 300000), null);
eq('problem: Rs 2 does not', W.topupProblem(200, 300000), 'The minimum is Rs 500.');
eq('problem: over the room', W.topupProblem(350000, 300000), 'You can add Rs 3,000 more today.');
eq('problem: no room at all', W.topupProblem(50000, 0), 'You have added Rs 5,000 today. Try again tomorrow.');
eq('problem: nothing typed', W.topupProblem(null, 300000), null);
eq('room line', W.topupRoomLine(300000), 'You can add Rs 3,000 more today.');

// 4. rows
const t0 = '2026-11-02T09:38:00Z';
const paid = W.parseWalletRow({ id: 'a', seq: 3, kind: 'topup', amount_paise: 200000, status: 'paid', balance_after_paise: 250000, created_at: t0, paid_at: '2026-11-02T09:40:11Z', razorpay: { order_id: 'o', payment_id: 'pay_x', method: 'upi' }, meta: { note: 'Add money' } });
const pendingTop = W.parseWalletRow({ id: 'b', seq: 4, kind: 'topup', amount_paise: 50000, status: 'pending', balance_after_paise: null, created_at: t0, paid_at: null, razorpay: { order_id: 'o2' }, meta: {} });
const bill = W.parseWalletRow({ id: 'c', seq: 5, kind: 'ai_plan', amount_paise: -4000, status: 'pending', balance_after_paise: null, created_at: '2026-12-01T05:00:00Z', paid_at: null, razorpay: null, meta: { client_name: 'Aarav Mehta' } });
const failed = W.parseWalletRow({ id: 'd', seq: 6, kind: 'topup', amount_paise: 50000, status: 'failed', created_at: t0, meta: { failure_reason: 'Bank declined' } });
const discarded = W.parseWalletRow({ id: 'e', seq: 7, kind: 'ai_plan', amount_paise: -3000, status: 'cancelled', created_at: t0, meta: { cancel_reason: 'discarded', client_name: 'Riya' } });
const lapsed = W.parseWalletRow({ id: 'f', seq: 8, kind: 'ai_plan', amount_paise: -3000, status: 'cancelled', created_at: t0, meta: { cancel_reason: 'expired' } });
const refund = W.parseWalletRow({ id: 'g', seq: 9, kind: 'refund', amount_paise: -200000, status: 'paid', balance_after_paise: 50000, created_at: t0, paid_at: t0, razorpay: { refund_id: 'rf' }, meta: {} });
eq('parse: bad kind dropped', W.parseWalletRow({ id: 'z', kind: 'merch', status: 'paid' }), null);
eq('title topup', W.rowTitle(paid), 'Added money');
eq('title AI plan uses the first name', W.rowTitle(bill), 'Odds AI plan, Aarav');
eq('title refund', W.rowTitle(refund), 'Refunded to your bank');
eq('title reversal', W.rowTitle({ ...paid, kind: 'reversal' }), 'Returned');
eq('title adjustment', W.rowTitle({ ...paid, kind: 'adjustment' }), 'Adjustment by Odds');
const now = new Date('2026-11-02T10:00:00Z').getTime();
eq('second line paid', W.rowSecondLine(paid, now), '2 Nov, 3:10 PM · Balance Rs 2,500');
eq('second line pending (22 min)', W.rowStatusLine(pendingTop, now), 'Waiting for payment');
eq('second line pending (31 min)', W.rowStatusLine(pendingTop, now + 9 * 60_000), 'Expired, not charged');
eq('second line bill', W.rowStatusLine(bill, now), 'Bill waiting: deduct or discard');
eq('second line failed', W.rowStatusLine(failed, now), 'Failed: Bank declined');
eq('second line discarded', W.rowStatusLine(discarded, now), 'Discarded');
eq('second line lapsed bill', W.rowStatusLine(lapsed, now), 'Expired, not charged');
eq('chip paid', W.rowChip(paid, now), { text: 'PAID', tone: 'green' });
eq('chip waiting', W.rowChip(pendingTop, now), { text: 'WAITING', tone: 'amber' });
eq('chip expired at 31 min', W.rowChip(pendingTop, now + 9 * 60_000), { text: 'EXPIRED', tone: 'grey' });
eq('chip still waiting at 29 min', W.rowChip(pendingTop, now + 7 * 60_000), { text: 'WAITING', tone: 'amber' });
eq('chip failed', W.rowChip(failed, now), { text: 'FAILED', tone: 'red' });
eq('chip discarded', W.rowChip(discarded, now), { text: 'DISCARDED', tone: 'grey' });
eq('chip lapsed', W.rowChip(lapsed, now), { text: 'EXPIRED', tone: 'grey' });
eq('method labels', [W.methodLabel('upi'), W.methodLabel('card'), W.methodLabel('netbanking'), W.methodLabel(null)], ['UPI', 'Card', 'Net banking', null]);
eq('pending helpers', [W.isPendingTopup(pendingTop), W.isPendingBill(bill), W.isPendingBill(paid)], [true, true, false]);

// 5. grouping (newest first, by IST month)
const groups = W.groupByMonth([paid, pendingTop, bill]);
eq('groups: two months, December first', groups.map((g) => g.header), ['DECEMBER 2026', 'NOVEMBER 2026']);
eq('groups: November rows newest first', groups[1].rows.map((r) => r.id), ['b', 'a']);
eq('month header', W.monthHeader('2026-11-30T20:00:00Z'), 'DECEMBER 2026');   // 1:30 AM IST on 1 Dec

// 6. the read
const read = W.parseWalletRead({ balance_paise: '250000', today_room_paise: 300000, charges_ai: true, pending_bill: { tx_id: 't1', bill_paise: 4000, client_name: 'Aarav', preview: { sections: ['Push', 'Pull'], exercise_count: 18 } }, rows: [paid, { id: 'bad' }] });
eq('read: numbers and rows', [read.balance_paise, read.today_room_paise, read.charges_ai, read.rows.length], [250000, 300000, true, 1]);
eq('read: pending bill', [read.pending_bill.tx_id, read.pending_bill.preview.sections], ['t1', ['Push', 'Pull']]);
eq('read: empty', W.parseWalletRead(null).rows, []);

// 7. the AI bill
eq('bill lines', W.billLines(4000, 200000), { bill: 'Your bill is Rs 40.', after: 'Wallet Rs 2,000, after this Rs 1,960' });
eq('preview line', W.billPreviewLine({ sections: ['Push', 'Pull', 'Legs', 'Conditioning'], exercise_count: 27 }), '4 sections, 27 exercises');
// The gate since 3 Nov 2026 (final): a fixed price (price_paise, bill_paise the same figure), charge_at plan_create.
const gate = (o) => W.parseWalletGate({ charges: true, balance_paise: 200000, floor_paise: 0, bill_paise: 5000, price_paise: 5000, charge_at: 'plan_create', negative: false, free_total: 3, free_used: 3, free_left: 0, essentials: false, free_this: false, billed: true, pending_bill: null, ok: true, reason: null, ...o });
eq('card: not charged', W.walletCardState(gate({ charges: false, free_this: true, billed: false })).state, 'free');
eq('card: ok (free used up): the fixed price, charged when the plan is created', W.walletCardState(gate({})), { state: 'ok', line: 'Rs 50 from your wallet when you create the plan · balance Rs 2,000', action: null });
eq('card: an old server answer without the price falls back to Rs 50', W.walletCardState(gate({ bill_paise: null, price_paise: null })).line, 'Rs 50 from your wallet when you create the plan · balance Rs 2,000');
eq('card: the server price wins', W.walletCardState(gate({ price_paise: 6000, bill_paise: 6000 })).line, 'Rs 60 from your wallet when you create the plan · balance Rs 2,000');
eq('card: balance below the price is NOT a block (3 Nov 2026)', W.walletCardState(gate({ balance_paise: 2800 })), { state: 'ok', line: 'Rs 50 from your wallet when you create the plan · balance Rs 28', action: null });
eq('card: 3 free left', W.walletCardState(gate({ free_used: 0, free_left: 3, free_this: true, billed: false })), { state: 'free_left', line: '3 free AI plans left, then Rs 50 a plan from your wallet when you create it.', action: null });
eq('card: 1 free left (singular)', W.walletCardState(gate({ free_used: 2, free_left: 1, free_this: true, billed: false })).line, '1 free AI plan left, then Rs 50 a plan from your wallet when you create it.');
eq('gate parse: price and charge_at', [gate({}).price_paise, gate({}).charge_at, W.parseWalletGate({ charges: true, balance_paise: 0 }).charge_at], [5000, 'plan_create', 'plan_create']);
// the hint under Generate, the Create Plan button, the line after the save (3 Nov 2026 final rule)
eq('hint: billed', W.generateHint(gate({})), 'Generating is free. Rs 50 is deducted once, when you tap Create Plan.');
eq('hint: free left', W.generateHint(gate({ free_left: 2, free_this: true, billed: false })), 'Generating is free. This plan uses 1 of your 2 free AI plans.');
eq('hint: 1 free left (singular)', W.generateHint(gate({ free_left: 1, free_this: true, billed: false })), 'Generating is free. This plan uses 1 of your 1 free AI plan.');
eq('hint: essentials', W.generateHint(gate({ essentials: true, free_this: true, billed: false })), 'Generating is free. Essentials plans are free.');
eq('hint: not charged', [W.generateHint(gate({ charges: false })), W.generateHint(null)], [null, null]);
eq('button: billed AI plan', W.createButtonLabel(gate({}), true), 'Create Plan · Rs 50');
eq('button: free AI plan', [W.createButtonLabel(gate({ free_left: 2, free_this: true }), true), W.createButtonLabel(gate({ essentials: true }), true)], ['Create Plan · free', 'Create Plan · free']);
eq('button: manual plan, free role, no wallet', [W.createButtonLabel(gate({}), false), W.createButtonLabel(gate({ charges: false }), true), W.createButtonLabel(null, true)], ['Create Plan', 'Create Plan', 'Create Plan']);
eq('done: charged online', W.createDoneLine(gate({ balance_paise: 46700 }), true, false), { text: 'Rs 50 deducted. Wallet Rs 417.', tone: 'green' });
eq('done: charged into the negative', W.createDoneLine(gate({ balance_paise: 2800 }), true, false), { text: 'Rs 50 deducted. Wallet Rs -22.', tone: 'red' });
eq('done: queued offline', W.createDoneLine(gate({}), true, true), { text: 'Rs 50 will be deducted when it syncs.', tone: 'grey' });
eq('done: free plan used', W.createDoneLine(gate({ free_left: 2, free_this: true }), true, false), { text: 'Free AI plan used. 1 free AI plan left.', tone: 'green' });
eq('done: last free plan used', W.createDoneLine(gate({ free_left: 1, free_this: true }), true, false).text, 'Free AI plan used. 0 free AI plans left.');
eq('done: essentials', W.createDoneLine(gate({ essentials: true }), true, true), { text: 'Free for Essentials clients. Nothing deducted.', tone: 'green' });
eq('done: manual or free role', [W.createDoneLine(gate({}), false, false), W.createDoneLine(gate({ charges: false }), true, false)], [null, null]);
eq('read: the price', [W.parseWalletRead({ ai_plan_price_paise: 5000 }).ai_plan_price_paise, W.parseWalletRead({}).ai_plan_price_paise], [5000, 5000]);
eq('card: Essentials client is free even with 0 left', W.walletCardState(gate({ essentials: true, free_this: true, billed: false, balance_paise: 0 })), { state: 'essentials', line: 'Free for Essentials clients.', action: null });
eq('card: negative balance blocks with the owner sentence', W.walletCardState(gate({ balance_paise: -500, negative: true, ok: false, reason: 'WALLET_NEGATIVE', line: 'Your wallet is at Rs -5. Add funds to make the next plan with Odds AI.' })), { state: 'negative', line: 'Your wallet is at Rs -5. Add funds to make the next plan with Odds AI.', action: 'wallet' });
eq('card: negative without a server line builds it', W.walletCardState(gate({ balance_paise: -500, negative: true, ok: false, reason: 'WALLET_NEGATIVE' })).line, 'Your wallet is at Rs -5. Add funds to make the next plan with Odds AI.');
eq('card: bill pending', W.walletCardState(gate({ pending_bill: read.pending_bill, ok: false, reason: 'WALLET_BILL_PENDING' })), { state: 'bill_pending', line: 'Settle or discard your last draft first.', action: 'bill' });
eq('card: unknown', W.walletCardState(null).state, 'unknown');
eq('gate parse', W.parseWalletGate({ charges: true, balance_paise: -3000, floor_paise: 0, pending_bill: null, ok: false, reason: 'WALLET_NEGATIVE' }).reason, 'WALLET_NEGATIVE');
eq('gate parse: negative inferred from the balance', W.parseWalletGate({ charges: true, balance_paise: -100 }).negative, true);
eq('balance text', [W.balanceText(-500), W.balanceText(46700), W.balanceText(0)], ['Rs -5', 'Rs 467', 'Rs 0']);
eq('negative line', W.negativeBalanceLine(-500), 'Your wallet is at Rs -5. Add funds to make the next plan with Odds AI.');
eq('option chip: free left', W.aiOptionChip(gate({ free_left: 2, free_this: true, billed: false })), { text: '2 FREE LEFT', tone: 'green' });
eq('option chip: essentials', W.aiOptionChip(gate({ essentials: true, free_this: true, billed: false })), { text: 'FREE FOR ESSENTIALS', tone: 'green' });
eq('option chip: price', W.aiOptionChip(gate({})), { text: 'RS 50', tone: 'amber' });
eq('option chip: negative', W.aiOptionChip(gate({ negative: true, balance_paise: -500 })), { text: 'ADD FUNDS', tone: 'red' });
eq('option chip: not charged', W.aiOptionChip(gate({ charges: false })), null);
eq('after charge: negative is red', W.afterChargeLine(5000, -500), { text: 'Rs 50 deducted. Wallet Rs -5.', tone: 'red' });
eq('after charge: positive is green', W.afterChargeLine(5000, 46700), { text: 'Rs 50 deducted. Wallet Rs 467.', tone: 'green' });
eq('read: negative flag and line', [W.parseWalletRead({ balance_paise: -700 }).negative, W.parseWalletRead({ balance_paise: -700 }).negative_line], [true, 'Your wallet is at Rs -7. Add funds to make the next plan with Odds AI.']);
eq('gate parse: old server answer without free fields is billed', [gate({}).billed, W.parseWalletGate({ charges: true, balance_paise: 3000 }).free_this], [true, false]);
eq('free left line', [W.freeLeftLine(3), W.freeLeftLine(1)], ['3 free AI plans left', '1 free AI plan left']);
const freeRow = W.parseWalletRow({ id: 'h', seq: 10, kind: 'ai_plan', amount_paise: 0, status: 'paid', balance_after_paise: 50000, created_at: t0, paid_at: t0, razorpay: null, meta: { free: true, essentials: false, client_name: 'Riya S' } });
eq('free row: amount, line, chip', [W.rowAmountText(freeRow), W.rowStatusLine(freeRow, now), W.rowChip(freeRow, now), W.rowTitle(freeRow)], ['Free', 'Free plan, not charged', { text: 'FREE', tone: 'green' }, 'Odds AI plan, Riya']);
eq('free Essentials row line', W.rowStatusLine({ ...freeRow, meta: { free: true, essentials: true } }, now), 'Free for Essentials clients');
eq('paid row amount text unchanged', W.rowAmountText(paid), '+ Rs 2,000');

// 8. errors
eq('coded sentence', W.codedWalletSentence(new Error('WALLET_DAILY_CAP: You can add Rs 3000 more today. The limit is Rs 5000 a day.')), 'You can add Rs 3000 more today. The limit is Rs 5000 a day.');
eq('coded sentence: other error', W.codedWalletSentence(new Error('Network request failed')), null);
eq('code of', W.walletCodeOf({ message: 'WALLET_INSUFFICIENT: Your wallet has Rs 30.' }), 'WALLET_INSUFFICIENT');

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
```

#### `src/lib/walletCheckoutHtml.ts`
Pure: the inline Razorpay checkout page (the gateway cannot serve HTML). Copy byte for byte.

```ts
/* The Team Wallet checkout page the WebView loads as inline HTML (2 Nov 2026). It cannot come from the server: the
   Supabase functions gateway rewrites every HTML answer to text/plain with a sandbox CSP, so a WebView given that URL
   shows a blank page. The page holds only what wallet-create-order answered (public key id, order id, amount, prefill,
   the row id in the notes), never a secret; it loads Razorpay Standard Checkout, opens it at once and posts ONE message
   to the app through window.ReactNativeWebView.postMessage:
     { ok: true, razorpay_order_id, razorpay_payment_id, razorpay_signature }   the app then calls wallet-verify-payment
     { dismissed: true }                                                       the sheet was closed (row stays pending 30 min)
     { failed: true, reason }                                                  an attempt failed (Razorpay offers a retry)
   Pure: no React, no network; tested in node (tests/rules/wallet_checkout_html_test.js); copied byte for byte to iOS. */

export type CheckoutPageInput = {
  key_id: string;
  order_id: string;
  amount_paise: number;
  tx_id: string;
  name: string;
  email: string;
  contact: string;
};

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** JSON for a <script>: no "</" sequence can close the tag. */
const LS = String.fromCharCode(0x2028), PS = String.fromCharCode(0x2029);
const jsonForScript = (v: unknown) => JSON.stringify(v).replace(/<\//g, '<\\/').split(LS).join('\\u2028').split(PS).join('\\u2029');

/** "Rs 1,00,000" with Indian grouping (the same rule as teamWallet.ts; repeated so this file has no imports). */
const rupees = (paise: number): string => {
  const n = Math.round(Math.abs(Number(paise) || 0) / 100);
  const s = String(n);
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  return `Rs ${rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3 : last3}`;
};

export const CHECKOUT_JS = 'https://checkout.razorpay.com/v1/checkout.js';

export const walletCheckoutHtml = (o: CheckoutPageInput): string => {
  const amount = rupees(o.amount_paise);
  const options = {
    key: o.key_id,
    amount: Math.round(Number(o.amount_paise) || 0),
    currency: 'INR',
    name: 'Odds Fitness',
    description: 'Team Wallet top-up',
    order_id: o.order_id,
    prefill: { name: o.name || '', email: o.email || '', contact: o.contact || '' },
    notes: { purpose: 'team_wallet_topup', wallet_tx_id: o.tx_id },
    theme: { color: '#F08A3C', backdrop_color: '#0e0a09' },
    retry: { enabled: true, max_count: 3 },
    remember_customer: false,
  };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"><title>Pay ${esc(amount)}</title><style>
  html,body{margin:0;height:100%;background:#0e0a09;color:#fff;font-family:-apple-system,system-ui,"Segoe UI",Roboto,sans-serif}
  .box{min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px;text-align:center;box-sizing:border-box}
  .t{font-size:22px;font-weight:700}.s{font-size:14px;color:#a8a09a;line-height:1.5;max-width:320px}
  button{margin-top:8px;padding:12px 22px;border-radius:12px;border:1px solid #f08a3c;background:rgba(240,138,60,0.14);color:#f08a3c;font-weight:700;font-size:15px}
  .spin{width:28px;height:28px;border-radius:50%;border:3px solid rgba(255,255,255,0.15);border-top-color:#f08a3c;animation:r 0.9s linear infinite}@keyframes r{to{transform:rotate(360deg)}}
</style></head><body><div class="box"><div class="spin" id="spin"></div><div class="t">Paying ${esc(amount)}</div><div class="s" id="s">Opening the Razorpay checkout. Choose UPI, a card or net banking.</div><button id="again" style="display:none">Open the checkout again</button></div><script>
  window.__post = function (m) { var s = JSON.stringify(m); try { if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) { window.ReactNativeWebView.postMessage(s); return true; } } catch (e) {} return false; };
  var opts = ${jsonForScript(options)};
  var s = document.getElementById('s'), again = document.getElementById('again'), spin = document.getElementById('spin');
  function status(t) { s.textContent = t; }
  opts.handler = function (r) {
    spin.style.display = 'none'; status('Payment received. Adding it to your wallet...');
    if (!window.__post({ ok: true, razorpay_order_id: r.razorpay_order_id, razorpay_payment_id: r.razorpay_payment_id, razorpay_signature: r.razorpay_signature })) status('Payment received. Go back to the Odds app: your wallet updates in a moment.');
  };
  opts.modal = { ondismiss: function () { spin.style.display = 'none'; status('Checkout closed. Nothing was charged yet.'); again.style.display = 'inline-block'; window.__post({ dismissed: true }); }, escape: true, backdropclose: false, confirm_close: false };
  var rzp = null;
  function openCheckout() {
    try {
      if (!rzp) { rzp = new Razorpay(opts); rzp.on('payment.failed', function (e) { var why = (e && e.error && e.error.description) || 'The payment did not go through'; status('Payment failed: ' + why + '. You can try again.'); window.__post({ failed: true, reason: why }); }); }
      spin.style.display = 'block'; again.style.display = 'none'; status('Opening the Razorpay checkout...');
      rzp.open();
    } catch (e) { spin.style.display = 'none'; status('The checkout could not open. Close this page and try again.'); again.style.display = 'inline-block'; }
  }
  again.onclick = openCheckout;
  var tag = document.createElement('script'); tag.src = ${jsonForScript(CHECKOUT_JS)}; tag.onload = openCheckout;
  tag.onerror = function () { spin.style.display = 'none'; status('Razorpay could not load. Check your connection, then open the checkout again.'); again.style.display = 'inline-block'; };
  document.head.appendChild(tag);
</script></body></html>`;
};
```

#### `tests/rules/wallet_checkout_html_test.js`
Rule test for the page. Copy as is.

```js
// Rule test for the Odds staff app. ROOT = the repo root; point it at the iOS repo and run: node tests/rules/wallet_checkout_html_test.js
const ROOT = require("path").resolve(__dirname, "../..");
// Team Wallet checkout page (2 Nov 2026): the inline HTML the WebView loads carries exactly the order fields, escapes
// what came from the server, and posts the three messages.
const ts = require(ROOT + '/node_modules/typescript');
const fs = require('fs');
const src = fs.readFileSync(ROOT + '/src/lib/walletCheckoutHtml.ts', 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const m = { exports: {} }; new Function('module', 'exports', 'require', js)(m, m.exports, (n) => { throw new Error('unexpected require ' + n); });
const H = m.exports;
let fails = 0;
const ok = (name, cond, extra) => { if (!cond) fails++; console.log(cond ? 'PASS' : 'FAIL', name, cond ? '' : extra ?? ''); };

const html = H.walletCheckoutHtml({ key_id: 'rzp_live_x', order_id: 'order_1', amount_paise: 200000, tx_id: 'tx-1', name: 'Sagar <b>', email: 'a@b.c', contact: '9999' });
ok('title shows the amount', html.includes('<title>Pay Rs 2,000</title>'));
ok('options carry key, order, amount, notes', /"key":"rzp_live_x"/.test(html) && /"order_id":"order_1"/.test(html) && /"amount":200000/.test(html) && /"wallet_tx_id":"tx-1"/.test(html));
ok('prefill name is JSON, not injected', html.includes('"name":"Sagar <b>"') && !html.includes('<b>Paying'));
ok('no secret key', !/key_secret|rzp_live_[A-Za-z0-9]+:/.test(html));
ok('posts ok, dismissed and failed', html.includes('{ ok: true, razorpay_order_id') && html.includes('{ dismissed: true }') && html.includes('{ failed: true, reason: why }'));
ok('loads checkout.js from Razorpay', html.includes('https://checkout.razorpay.com/v1/checkout.js'));
const sneaky = H.walletCheckoutHtml({ key_id: 'k', order_id: 'o</script><script>alert(1)</script>', amount_paise: 100, tx_id: 't', name: '', email: '', contact: '' });
ok('a closing script tag in a value cannot break out', !sneaky.includes('o</script>'));
ok('Rs 1 title', H.walletCheckoutHtml({ key_id: 'k', order_id: 'o', amount_paise: 100, tx_id: 't', name: '', email: '', contact: '' }).includes('<title>Pay Rs 1</title>'));
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
```

#### `src/lib/teamWalletQueries.ts`
Data: the read, the four edge-function mutations, realtime.

```ts
/* Team Wallet data (2 Nov 2026). The read is the definer RPC get_my_team_wallet (own rows only); money moves only
   through the edge functions wallet-create-order / wallet-verify-payment (top-ups) and wallet-settle-ai-plan /
   wallet-discard-ai-plan (the Odds AI plan bill). Server refusals arrive as 'WALLET_CODE: sentence' and are shown
   through walletErrorText. Key 'my-team-wallet' persists (the balance shows offline, read-only). */
import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { invokeWithTimeout, withTimeout, NET_MS } from './withTimeout';
import { invalidateDebounced } from './invalidateDebounced';
import { friendlyError } from './friendlyError';
import { codedWalletSentence, parseWalletRead, parseWalletRow, type TeamWalletRead, type WalletRow } from './teamWallet';
import type { AiPlanResult } from './aiPlanDraft';

export const WALLET_KEY = ['my-team-wallet'] as const;
export const walletErrorText = (e: unknown, fallback: string): string => codedWalletSentence(e) ?? friendlyError(e, fallback);

/* functions.invoke can keep the anon-key Authorization header when the session was restored from storage, so the
   live access token is attached (same as aiPlanQueries.callPlanFn). A refusal becomes an Error carrying the server's
   'WALLET_CODE: sentence' so the screens can show the sentence. */
export async function callWalletFn(name: string, body: Record<string, unknown>, ms: number = NET_MS): Promise<any> {
  let { data } = await supabase.auth.getSession();
  if (!data.session) {
    await new Promise((r) => setTimeout(r, 450));
    ({ data } = await supabase.auth.getSession());
  }
  const token = data.session?.access_token;
  const { data: out, error } = await invokeWithTimeout(name, { body, ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}) }, ms);
  if (error) {
    let m = error?.message ?? 'The wallet is not reachable right now.';
    try {
      const ctx = (error as any).context;
      if (ctx && typeof ctx.json === 'function') m = (await ctx.json())?.error ?? m;
    } catch { /* keep the generic message */ }
    if (/PGRST202|not found|404/i.test(m) && /function/i.test(m)) m = 'WALLET_NOT_SET_UP: The wallet is not set up on the server yet.';
    throw new Error(m);
  }
  if (out?.error) throw new Error(out.error);
  return out;
}

/** My balance, today's room and my newest 50 rows. staleTime 15 s, refetch on focus; persisted under 'my-'. */
export function useTeamWallet(enabled = true) {
  return useQuery({
    queryKey: [...WALLET_KEY],
    enabled,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    queryFn: async (): Promise<TeamWalletRead> => {
      const { data, error } = await withTimeout(
        Promise.resolve((supabase.rpc as any)('get_my_team_wallet', { p_limit: 50 })) as Promise<{ data: any; error: any }>,
        NET_MS, 'Wallet');
      if (error) {
        if (error.code === 'PGRST202' || /could not find the function/i.test(String(error.message ?? ''))) throw new Error('WALLET_NOT_SET_UP: The wallet is not set up on the server yet.');
        throw new Error(error.message);
      }
      return parseWalletRead(data);
    },
  });
}

/** The next page: rows older than `before` (the last row's created_at). Not persisted (key prefix differs). */
export function useTeamWalletPage(before: string | null) {
  return useQuery({
    queryKey: ['team-wallet-page', before],
    enabled: !!before,
    staleTime: 60_000,
    queryFn: async (): Promise<WalletRow[]> => {
      const { data, error } = await withTimeout(
        Promise.resolve((supabase.rpc as any)('get_my_team_wallet', { p_limit: 50, p_before: before })) as Promise<{ data: any; error: any }>,
        NET_MS, 'Wallet');
      if (error) throw new Error(error.message);
      return parseWalletRead(data).rows;
    },
  });
}

/** Everything the inline checkout page needs (walletCheckoutHtml); checkout_url is the server page, which the gateway
    serves as sandboxed text/plain, so the app no longer loads it. */
export type TopupOrder = { tx_id: string; order_id: string; amount_paise: number; checkout_url: string; key_id: string; name: string; email: string; contact: string };
const parseOrder = (d: any): TopupOrder => {
  if (!d?.tx_id || !d?.order_id || !d?.key_id) throw new Error('The checkout could not be prepared. Try again.');
  const p = d.prefill && typeof d.prefill === 'object' ? d.prefill : {};
  return {
    tx_id: String(d.tx_id), order_id: String(d.order_id), amount_paise: Number(d.amount_paise) || 0, checkout_url: String(d.checkout_url ?? ''), key_id: String(d.key_id),
    name: String(p.name ?? ''), email: String(p.email ?? ''), contact: String(p.contact ?? ''),
  };
};
/** Add money: the pending row and the Razorpay order. { amount_inr } for a new top-up, { reopen_tx_id } to reopen a
    pending one from the history. */
export function useCreateTopup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (r: { amount_inr: number } | { reopen_tx_id: string }): Promise<TopupOrder> => parseOrder(await callWalletFn('wallet-create-order', r)),
    onSettled: () => { qc.invalidateQueries({ queryKey: [...WALLET_KEY] }); },
  });
}

export type VerifyInput = { tx_id: string; razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string };
/** After the checkout's message: credit the top-up (the webhook may already have; both land on the same locked function). */
export function useVerifyTopup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (r: VerifyInput): Promise<{ row: WalletRow | null; balance_paise: number; credited_now: boolean }> => {
      const d = await callWalletFn('wallet-verify-payment', r);
      return { row: parseWalletRow(d?.row), balance_paise: Number(d?.balance_paise) || 0, credited_now: d?.credited_now === true };
    },
    onSettled: () => { qc.invalidateQueries({ queryKey: [...WALLET_KEY] }); },
  });
}

/** The ai-plan-draft answer shape, also what the settle call returns. */
export const parseAiPlanResult = (d: any): AiPlanResult => {
  if (!d?.draft || !Array.isArray(d.draft.sections)) throw new Error('Odds AI returned no plan. Try Generate again.');
  const w = d.wallet && typeof d.wallet === 'object' ? d.wallet : null;
  return {
    draft: d.draft,
    dropped: Array.isArray(d.dropped) ? d.dropped : [],
    sources: d.sources ?? null,
    model: String(d.model ?? ''),
    generated_at: String(d.generated_at ?? new Date().toISOString()),
    // 3 Nov 2026 (final rule): the standing for this plan; charge_at 'plan_create' = nothing charged for the draft
    wallet: w ? {
      charged: w.charged === true, charged_paise: Number(w.charged_paise) || 0,
      charge_at: w.charge_at === 'draft' ? 'draft' : 'plan_create', price_paise: w.price_paise == null ? null : Number(w.price_paise),
      balance_paise: Number(w.balance_paise) || 0, negative: w.negative === true, essentials: w.essentials === true,
      free_this: w.free_this === true || w.free === true, free_left: w.free_left == null ? null : Number(w.free_left), error: w.error ? String(w.error) : null,
    } : null,
  };
};
/** Deduct from wallet: the bill becomes paid and the held draft comes back. */
export function useSettleAiBill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (r: { tx_id: string }): Promise<{ result: AiPlanResult; balance_paise: number; already: boolean }> => {
      const d = await callWalletFn('wallet-settle-ai-plan', r);
      return { result: parseAiPlanResult(d?.result), balance_paise: Number(d?.balance_paise) || 0, already: d?.already === true };
    },
    onSettled: () => { qc.invalidateQueries({ queryKey: [...WALLET_KEY] }); qc.invalidateQueries({ queryKey: ['ai-plan-preview'] }); },
  });
}
/** Discard the draft: nothing charged (at most 3 a day). */
export function useDiscardAiBill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (r: { tx_id: string }): Promise<{ already: boolean }> => {
      const d = await callWalletFn('wallet-discard-ai-plan', r);
      return { already: d?.already === true };
    },
    onSettled: () => { qc.invalidateQueries({ queryKey: [...WALLET_KEY] }); qc.invalidateQueries({ queryKey: ['ai-plan-preview'] }); },
  });
}

/** While a row of mine is pending: my team_wallet rows stream (RLS scopes them); any change refreshes the read and a
    top-up that turned paid is reported once (the webhook may credit after the checkout sheet was closed). */
export function useWalletRealtime(uid: string | null | undefined, enabled: boolean, onTopupPaid?: (row: WalletRow) => void) {
  const qc = useQueryClient();
  const cbRef = React.useRef(onTopupPaid);
  cbRef.current = onTopupPaid;
  const seen = React.useRef(new Set<string>());
  React.useEffect(() => {
    if (!uid || !enabled) return;
    const ch = supabase
      .channel(`team-wallet-${uid}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'team_wallet', filter: `user_id=eq.${uid}` }, (p: any) => {
        invalidateDebounced(qc, [...WALLET_KEY], 300);
        const row = parseWalletRow(p?.new);
        if (row && row.kind === 'topup' && row.status === 'paid' && !seen.current.has(row.id)) { seen.current.add(row.id); cbRef.current?.(row); }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [uid, enabled]);
}
```

#### `src/screens/wallet.tsx`
The Wallet screen (balance card with the negative state, Add money / Add funds, history, detail sheet, checkout hand-off).

```tsx
import React from 'react';
import { View, Text, Pressable, TextInput, Modal, ScrollView, ActivityIndicator, Alert, Keyboard } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import { C, F, hexA, ORANGE_GRAD } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono, Card } from '../components/primitives';
import { Page, TitleBlock, AccessPending } from './common';
import { useAuth } from '../auth';
import { useStore } from '../store';
import { useKeyboardHeight } from '../lib/useKeyboardHeight';
import { useIsOnline } from '../lib/offline';
import { useTeamWallet, useTeamWalletPage, useCreateTopup, useVerifyTopup, useWalletRealtime, walletErrorText, type TopupOrder } from '../lib/teamWalletQueries';
import {
  DAILY_CAP_PAISE, TEST_TOPUP_PAISE, TOPUP_PICKS, balanceText, negativeBalanceLine, fmtWhen, freeLeftLine, groupByMonth, isPendingBill, isPendingTopup, methodLabel, parseRupeeInput, rowAmountText, rowChip, rowSecondLine, rowTitle, rupees,
  signedRupees, topupExpired, topupProblem, topupRoomLine, type Tone, type WalletRow,
} from '../lib/teamWallet';
import { WalletCheckout, type CheckoutMessage } from '../components/WalletCheckout';
import { trackEvent } from '../lib/amplitude';

/* ============ Wallet (Team Wallet, 2 Nov 2026) ============
   Every staff role: add money through Razorpay (Rs 500 to Rs 5,000 a day), see the balance and the own history.
   The ledger is the definer RPC get_my_team_wallet; money moves only through the edge functions. The Odds AI plan
   bill (trainers) is settled from Create Plan, where the draft lands; from here a waiting bill can only be opened
   there. Offline: the cached balance and history, read-only. Plan: docs/team-wallet-plan.md. */

const TONE: Record<Tone, string> = { green: C.green, amber: C.gold, red: C.red, grey: C.muted3 };
const OFFLINE_LINE = 'No connection. Money can only be added online.';

function Chip({ text, tone }: { text: string; tone: Tone }) {
  const color = TONE[tone];
  return (
    <View style={{ paddingVertical: 3, paddingHorizontal: 8, borderRadius: 999, backgroundColor: hexA(color, 0.14), borderWidth: 1, borderColor: hexA(color, 0.4) }}>
      <Text style={{ fontFamily: F.bodyBold, fontSize: 9.5, color }}>{text}</Text>
    </View>
  );
}

function RowCard({ r, now, onPress }: { r: WalletRow; now: number; onPress: () => void }) {
  const chip = rowChip(r, now);
  const credit = r.amount_paise >= 0;
  return (
    <Pressable onPress={onPress} hitSlop={4} accessibilityRole="button" accessibilityLabel={`${rowTitle(r)}, ${rowAmountText(r)}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 13, borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: hexA(TONE[chip.tone], 0.22) }}>
      <View style={{ flex: 1, gap: 3 }}>
        <Body numberOfLines={1} style={{ fontSize: 14.5, fontFamily: F.bodySemi, color: '#fff' }}>{rowTitle(r)}</Body>
        <Body numberOfLines={2} style={{ fontSize: 11.5, color: C.muted2, lineHeight: 15 }}>{rowSecondLine(r, now)}</Body>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 5 }}>
        <Text style={{ fontFamily: F.bodyBold, fontSize: 14.5, color: credit ? C.green : '#fff' }}>{rowAmountText(r)}</Text>
        <Chip text={chip.text} tone={chip.tone} />
      </View>
    </Pressable>
  );
}

/* ---------- Add money sheet ---------- */
function AddMoneySheet({ visible, roomPaise, busy, error, onClose, onContinue }: {
  visible: boolean; roomPaise: number; busy: boolean; error: string | null; onClose: () => void; onContinue: (amountPaise: number) => void;
}) {
  const insets = useSafeAreaInsets();
  const kbH = useKeyboardHeight();
  const online = useIsOnline();
  const [text, setText] = React.useState('');
  React.useEffect(() => { if (visible) setText(''); else Keyboard.dismiss(); }, [visible]);
  const amount = parseRupeeInput(text);
  const problem = topupProblem(amount, roomPaise);
  const ready = amount != null && !problem && online && !busy;
  const hint = problem ?? (amount == null ? topupRoomLine(roomPaise) : amount === TEST_TOPUP_PAISE ? 'Rs 1 test top-up (testing only).' : `Adds ${rupees(amount)} to your wallet.`);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" importantForAccessibility="no-hide-descendants"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.64)' }} />
        <View accessibilityViewIsModal style={{ backgroundColor: C.sheetBg, borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.16)', paddingHorizontal: 18, paddingTop: 14, paddingBottom: 14 + insets.bottom + kbH, gap: 12 }}>
          <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center' }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
            <View style={{ flex: 1 }}>
              <Serif style={{ fontSize: 19 }}>Add money</Serif>
              <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 2 }}>Minimum Rs 500. Up to Rs 5,000 a day.</Body>
            </View>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close"
              style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)' }}>
              <Icon name="close" size={14} color={C.muted} strokeWidth={2.2} />
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 12 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {TOPUP_PICKS.map((p) => {
                const on = amount === p;
                const off = roomPaise <= 0 || p > roomPaise;
                return (
                  <Pressable key={p} onPress={() => setText(String(p / 100))} disabled={off} hitSlop={6} accessibilityRole="button" accessibilityState={{ selected: on, disabled: off }}
                    style={{ flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 12, backgroundColor: on ? hexA(C.orange, 0.18) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: on ? hexA(C.orange, 0.7) : 'rgba(255,255,255,0.1)', opacity: off ? 0.4 : 1 }}>
                    <Text style={{ fontFamily: on ? F.bodyBold : F.bodySemi, fontSize: 12.5, color: on ? C.orange : C.ink }}>{rupees(p)}</Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={{ gap: 6 }}>
              <Mono style={{ fontSize: 9, letterSpacing: 0.8, color: C.muted3 }}>AMOUNT IN RUPEES</Mono>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: problem ? hexA(C.red, 0.5) : 'rgba(255,255,255,0.12)' }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 18, color: C.muted }}>Rs</Text>
                <TextInput value={text} onChangeText={(t) => setText(t.replace(/[^\d]/g, '').slice(0, 5))} keyboardType="number-pad" placeholder="500" placeholderTextColor={C.muted3}
                  accessibilityLabel="Amount in rupees" style={{ flex: 1, fontFamily: F.bodyBold, fontSize: 22, color: '#fff', paddingVertical: 12 }} />
              </View>
              <Body style={{ fontSize: 11.5, color: problem ? '#F0A0A0' : C.muted2 }}>{hint}</Body>
            </View>
            {error ? <Body style={{ fontSize: 12, color: '#F0A0A0', lineHeight: 16 }}>{error}</Body> : null}
            {!online ? <Body style={{ fontSize: 11.5, color: C.gold }}>{OFFLINE_LINE}</Body> : null}
          </ScrollView>
          <View style={{ flexDirection: 'row', gap: 10, paddingTop: 4 }}>
            <Pressable onPress={onClose} accessibilityRole="button" style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: C.muted }}>Cancel</Text>
            </Pressable>
            <Pressable onPress={() => amount != null && onContinue(amount)} disabled={!ready} accessibilityRole="button" accessibilityLabel="Continue to pay"
              style={{ flex: 1.4, borderRadius: 12, overflow: 'hidden', opacity: ready ? 1 : 0.5 }}>
              <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ minHeight: 46, alignItems: 'center', justifyContent: 'center' }}>
                {busy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: '#fff' }}>{amount != null && !problem ? `Continue, ${rupees(amount)}` : 'Continue'}</Text>}
              </LinearGradient>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/* ---------- Detail sheet ---------- */
function DetailSheet({ row, now, onClose, onReopen, onOpenBill }: { row: WalletRow | null; now: number; onClose: () => void; onReopen: (r: WalletRow) => void; onOpenBill: (r: WalletRow) => void }) {
  const insets = useSafeAreaInsets();
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => { if (row) setCopied(false); }, [row?.id]);
  const line = (k: string, v: string | null | undefined, copy?: string) => (!v ? null : (
    <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' }}>
      <Mono style={{ width: 92, fontSize: 8.5, letterSpacing: 0.8, color: C.muted3 }}>{k}</Mono>
      <Body numberOfLines={2} style={{ flex: 1, fontSize: 13, color: C.ink }}>{v}</Body>
      {copy ? (
        <Pressable onPress={async () => { await Clipboard.setStringAsync(copy); setCopied(true); }} hitSlop={10} accessibilityRole="button" accessibilityLabel="Copy">
          <Icon name={copied ? 'checks' : 'copy'} size={14} color={copied ? C.green : C.muted} strokeWidth={2.2} />
        </Pressable>
      ) : null}
    </View>
  ));
  const chip = row ? rowChip(row, now) : null;
  const reopenable = !!row && isPendingTopup(row) && !topupExpired(row, now);
  const pendingBill = !!row && isPendingBill(row);
  return (
    <Modal visible={!!row} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" importantForAccessibility="no-hide-descendants"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.64)' }} />
        <View accessibilityViewIsModal style={{ backgroundColor: C.sheetBg, borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.16)', paddingHorizontal: 18, paddingTop: 14, paddingBottom: 16 + insets.bottom, gap: 10 }}>
          <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center' }} />
          {row ? (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                <View style={{ flex: 1 }}>
                  <Serif style={{ fontSize: 19 }}>{rowTitle(row)}</Serif>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 20, color: row.amount_paise >= 0 ? C.green : '#fff', marginTop: 4 }}>{rowAmountText(row)}</Text>
                </View>
                {chip ? <Chip text={chip.text} tone={chip.tone} /> : null}
                <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close"
                  style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)' }}>
                  <Icon name="close" size={14} color={C.muted} strokeWidth={2.2} />
                </Pressable>
              </View>
              <View>
                {line('STATUS', rowSecondLine(row, now).split(' · ').slice(1).join(' · ') || row.status)}
                {line('WHEN', fmtWhen(row.created_at))}
                {line('PAID AT', row.paid_at ? fmtWhen(row.paid_at) : null)}
                {line('BALANCE AFTER', row.balance_after_paise == null ? null : rupees(row.balance_after_paise))}
                {line('PAYMENT ID', row.razorpay?.payment_id ?? null, row.razorpay?.payment_id ?? undefined)}
                {line('ORDER ID', row.razorpay?.order_id ?? null)}
                {line('REFUND ID', row.razorpay?.refund_id ?? null)}
                {line('METHOD', methodLabel(row.razorpay?.method))}
                {line('CLIENT', row.kind === 'ai_plan' ? row.meta?.client_name ?? null : null)}
                {line('NOTE', row.kind === 'adjustment' || row.kind === 'reversal' || row.kind === 'refund' ? row.meta?.note ?? null : null)}
              </View>
              {reopenable ? (
                <Pressable onPress={() => onReopen(row)} accessibilityRole="button" accessibilityLabel="Open the checkout again" style={{ borderRadius: 12, overflow: 'hidden' }}>
                  <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ minHeight: 46, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: '#fff' }}>Pay {rupees(row.amount_paise)} now</Text>
                  </LinearGradient>
                </Pressable>
              ) : null}
              {pendingBill ? (
                <View style={{ gap: 8 }}>
                  <Body style={{ fontSize: 11.5, color: C.muted2, lineHeight: 16 }}>Deduct or discard this bill from Create Plan, where the draft opens. It lapses after 24 hours, uncharged.</Body>
                  <Pressable onPress={() => onOpenBill(row)} accessibilityRole="button" accessibilityLabel="Open in Create Plan" style={{ borderRadius: 12, overflow: 'hidden' }}>
                    <LinearGradient colors={['#8B5CF6', '#6D28D9']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ minHeight: 46, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: '#fff' }}>Open in Create Plan</Text>
                    </LinearGradient>
                  </Pressable>
                </View>
              ) : null}
            </>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

/* ================= SCREEN ================= */
export function Wallet() {
  const { session } = useAuth();
  const { go, set } = useStore();
  const uid = session?.user?.id ?? null;
  const online = useIsOnline();
  const q = useTeamWallet(!!uid);
  const createM = useCreateTopup();
  const verifyM = useVerifyTopup();
  const [addOpen, setAddOpen] = React.useState(false);
  const [addErr, setAddErr] = React.useState<string | null>(null);
  const [checkout, setCheckout] = React.useState<TopupOrder | null>(null);
  const failedRef = React.useRef<string | null>(null);
  const announcedRef = React.useRef(new Set<string>());
  const [detail, setDetail] = React.useState<WalletRow | null>(null);
  const [before, setBefore] = React.useState<string | null>(null);
  const [extra, setExtra] = React.useState<WalletRow[]>([]);
  const pageQ = useTeamWalletPage(before);
  const [now, setNow] = React.useState(Date.now());
  const [updatedAt, setUpdatedAt] = React.useState<number | null>(null);
  React.useEffect(() => { if (q.dataUpdatedAt) setUpdatedAt(q.dataUpdatedAt); }, [q.dataUpdatedAt]);
  React.useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  React.useEffect(() => { if (pageQ.data) setExtra((e) => [...e, ...pageQ.data!.filter((r) => !e.some((x) => x.id === r.id))]); }, [pageQ.data]);

  const data = q.data;
  const rows = React.useMemo(() => {
    const base = data?.rows ?? [];
    const ids = new Set(base.map((r) => r.id));
    return [...base, ...extra.filter((r) => !ids.has(r.id))];
  }, [data?.rows, extra]);
  const hasPending = rows.some((r) => (isPendingTopup(r) && !topupExpired(r, now)) || isPendingBill(r));

  const announce = (row: WalletRow) => {
    if (announcedRef.current.has(row.id)) return;
    announcedRef.current.add(row.id);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    Alert.alert(`${rupees(row.amount_paise)} added`, `Balance ${rupees(row.balance_after_paise ?? 0)}.`);
  };
  useWalletRealtime(uid, hasPending || !!checkout, announce);

  const openCheckout = (r: { amount_inr: number } | { reopen_tx_id: string }) => {
    setAddErr(null);
    createM.mutate(r, {
      onSuccess: (o) => {
        setAddOpen(false); setDetail(null); failedRef.current = null;
        setCheckout(o);
        trackEvent('Wallet Checkout Opened', { amount_paise: o.amount_paise, reopened: 'reopen_tx_id' in r });
      },
      onError: (e) => {
        const text = walletErrorText(e, 'Could not start the payment. Try again.');
        if (addOpen) setAddErr(text); else Alert.alert("Couldn't open the checkout", text);
      },
    });
  };

  const onCheckoutMessage = (m: CheckoutMessage) => {
    if (!checkout) return;
    if ('ok' in m && m.ok) {
      const c = checkout;
      setCheckout(null);
      verifyM.mutate({ tx_id: c.tx_id, razorpay_order_id: m.razorpay_order_id, razorpay_payment_id: m.razorpay_payment_id, razorpay_signature: m.razorpay_signature }, {
        onSuccess: (r) => { trackEvent('Wallet Topup Paid', { amount_paise: c.amount_paise }); if (r.row) announce({ ...r.row, balance_after_paise: r.row.balance_after_paise ?? r.balance_paise }); else Alert.alert(`${rupees(c.amount_paise)} added`, `Balance ${rupees(r.balance_paise)}.`); },
        onError: (e) => Alert.alert('Payment check', walletErrorText(e, 'The payment could not be confirmed yet. If money left your account it is added within a few minutes.')),
      });
      return;
    }
    if ('failed' in m && m.failed) { failedRef.current = String(m.reason ?? 'The payment did not go through'); return; }
    if ('dismissed' in m) {
      setCheckout(null);
      q.refetch();
      if ((m as any).paid) Alert.alert('Already added', 'This top-up is already in your wallet.');
      else if ((m as any).expired) Alert.alert('Checkout expired', 'Tap Add money to start again.');
      else if (failedRef.current) Alert.alert('Payment failed', `${failedRef.current}. Nothing was charged. Tap the waiting row to try again.`);
      failedRef.current = null;
    }
  };

  const openBill = (r: WalletRow) => {
    const clientId = r.meta?.client_id ? String(r.meta.client_id) : null;
    if (!clientId) { Alert.alert('Open Create Plan', 'Open the client and tap Create Plan: the waiting bill shows there.'); return; }
    setDetail(null);
    set({ selectedClientId: clientId, selectedClientName: String(r.meta?.client_name ?? 'Client'), editingPlan: null });
    go('create-plan');
  };

  if (!session) return <AccessPending />;
  const groups = groupByMonth(rows);
  const notSetUp = q.isError && /not set up/i.test(String((q.error as Error)?.message ?? ''));
  const negative = !!data && (data.negative || data.balance_paise < 0);

  return (
    <Page gap={16} pt={6}>
      <TitleBlock title="Wallet" sub="Add money, see your history" />

      <Card colors={['rgba(60,38,24,0.5)', 'rgba(18,14,14,0.55)']} radius={20} style={{ padding: 18, gap: 6 }}>
        <Mono style={{ fontSize: 9, letterSpacing: 1.2, color: C.muted3 }}>BALANCE</Mono>
        {q.isPending ? <ActivityIndicator color={C.orange} style={{ alignSelf: 'flex-start', marginVertical: 8 }} /> : (
          <Serif style={{ fontSize: 38, color: negative ? C.red : '#fff' }}>{balanceText(data?.balance_paise ?? 0)}</Serif>
        )}
        {/* Below zero (3 Nov 2026): an AI plan took the wallet negative; the next top-up clears it first. */}
        {negative ? <Body style={{ fontSize: 12, color: '#FF9B8F', lineHeight: 16 }}>{data?.negative_line ?? negativeBalanceLine(data?.balance_paise ?? 0)}</Body> : null}
        <Body style={{ fontSize: 11.5, color: C.muted2 }}>
          {!online ? 'Offline, last known balance' : updatedAt ? `Updated ${fmtWhen(new Date(updatedAt).toISOString())}` : notSetUp ? 'The wallet is not set up on the server yet.' : q.isError ? walletErrorText(q.error, 'Could not load the wallet. Pull to refresh.') : ''}
        </Body>
        {data?.charges_ai && !negative ? <Body style={{ fontSize: 11, color: C.muted3, marginTop: 2 }}>{data.free_left > 0 ? `${freeLeftLine(data.free_left)}. After that an Odds AI plan costs ${rupees(data.ai_plan_price_paise)}, deducted here when you create the plan. Generating is free.` : `An Odds AI plan costs ${rupees(data.ai_plan_price_paise)}, deducted here when you create the plan. Generating is free. Essentials clients stay free.`}</Body> : null}
      </Card>

      <Pressable onPress={() => { setAddErr(null); setAddOpen(true); }} disabled={!online || notSetUp} accessibilityRole="button" accessibilityLabel={negative ? 'Add funds' : 'Add money'} style={{ borderRadius: 13, overflow: 'hidden', opacity: online && !notSetUp ? 1 : 0.5 }}>
        <LinearGradient colors={negative ? [C.red, '#B2402E'] : ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 13 }}>
          <Icon name="plus" size={15} color="#fff" strokeWidth={2.6} />
          <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: '#fff' }}>{negative ? 'Add funds' : 'Add money'}</Text>
        </LinearGradient>
      </Pressable>
      {!online ? <Body style={{ fontSize: 11.5, color: C.gold, marginTop: -8 }}>{OFFLINE_LINE}</Body> : null}
      {verifyM.isPending ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 11, borderRadius: 12, backgroundColor: hexA(C.green, 0.08), borderWidth: 1, borderColor: hexA(C.green, 0.3) }}>
          <ActivityIndicator size="small" color={C.green} />
          <Body style={{ fontSize: 12, color: C.ink }}>Confirming the payment with Razorpay</Body>
        </View>
      ) : null}

      <View style={{ gap: 10 }}>
        <Mono style={{ fontSize: 9, letterSpacing: 1.2, color: C.muted3 }}>HISTORY</Mono>
        {q.isPending ? <ActivityIndicator color={C.orange} style={{ marginVertical: 20 }} /> : !rows.length ? (
          <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 24 }}>{q.isError ? 'Could not load the history. Pull to refresh.' : 'No movements yet. Add money to start.'}</Body>
        ) : groups.map((g) => (
          <View key={g.header} style={{ gap: 8 }}>
            <Mono style={{ fontSize: 8.5, letterSpacing: 1, color: C.mono, marginTop: 4 }}>{g.header}</Mono>
            {g.rows.map((r) => <RowCard key={r.id} r={r} now={now} onPress={() => setDetail(r)} />)}
          </View>
        ))}
        {rows.length >= 50 && (!pageQ.data || pageQ.data.length === 50) ? (
          <Pressable onPress={() => setBefore(rows[rows.length - 1]?.created_at ?? null)} disabled={pageQ.isFetching} hitSlop={8} accessibilityRole="button"
            style={{ alignSelf: 'center', paddingVertical: 9, paddingHorizontal: 16, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
            {pageQ.isFetching ? <ActivityIndicator size="small" color={C.muted} /> : <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: C.muted }}>Load older</Text>}
          </Pressable>
        ) : rows.length ? <Mono style={{ fontSize: 8.5, color: C.faint, textAlign: 'center', marginTop: 6 }}>THAT IS EVERYTHING</Mono> : null}
      </View>

      {/* One Modal at a time: the sheets are siblings and only one is ever open. */}
      {/* No wallet read yet (loading, offline cache empty, migration not run): the sheet assumes the full day's room and
          lets the server decide; a room of 0 here used to lock Continue before the first read landed. */}
      <AddMoneySheet visible={addOpen && !checkout} roomPaise={data?.today_room_paise ?? DAILY_CAP_PAISE} busy={createM.isPending} error={addErr}
        onClose={() => setAddOpen(false)} onContinue={(p) => openCheckout({ amount_inr: Math.round(p / 100) })} />
      <DetailSheet row={!addOpen && !checkout ? detail : null} now={now} onClose={() => setDetail(null)}
        onReopen={(r) => openCheckout({ reopen_tx_id: r.id })} onOpenBill={openBill} />
      <WalletCheckout visible={!!checkout} order={checkout}
        onMessage={onCheckoutMessage} onClose={() => onCheckoutMessage({ dismissed: true })} />
    </Page>
  );
}
```

#### `src/components/WalletCheckout.tsx`
The full-screen WebView checkout (inline html, https baseUrl, UPI intents to the system).

```tsx
/* Team Wallet checkout (2 Nov 2026): a full-screen WebView on the checkout page built IN the app (walletCheckoutHtml,
   inline html: the Supabase functions gateway serves any HTML answer as sandboxed text/plain, so the server page shows
   blank), which opens Razorpay Standard Checkout at once and posts ONE message back: { ok, razorpay_order_id,
   razorpay_payment_id, razorpay_signature } | { dismissed } | { failed, reason }. UPI and app intents (upi://, intent://,
   tez://, phonepe://, paytmmp://) are handed to the system so GPay, PhonePe and Paytm open; Razorpay polls the payment
   when the user comes back. Close = dismissed: the row stays "Waiting for payment" for 30 minutes and can be reopened. */
import React from 'react';
import { View, Text, Pressable, Modal, ActivityIndicator, Linking, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { C, F } from '../theme';
import { Icon } from '../icons';
import { Body } from './primitives';
import { rupees } from '../lib/teamWallet';
import { walletCheckoutHtml } from '../lib/walletCheckoutHtml';
import type { TopupOrder } from '../lib/teamWalletQueries';

/* The page's origin for the WebView (an https origin, so Razorpay's iframe and checkout.js load as from a site). */
const PAGE_ORIGIN = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://odds.local').replace(/\/+$/, '') + '/';

export type CheckoutMessage =
  | { ok: true; razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }
  | { dismissed: true; paid?: boolean; expired?: boolean; error?: boolean }
  | { failed: true; reason: string };

const EXTERNAL = /^(upi|intent|tez|phonepe|paytmmp|gpay|bhim|credpay|cred|market):/i;

export function WalletCheckout({ visible, order, onMessage, onClose }: {
  visible: boolean;
  order: TopupOrder | null;
  onMessage: (m: CheckoutMessage) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = React.useState(true);
  const [note, setNote] = React.useState<string | null>(null);
  const amountPaise = order?.amount_paise ?? 0;
  const html = React.useMemo(() => (order ? walletCheckoutHtml({ key_id: order.key_id, order_id: order.order_id, amount_paise: order.amount_paise, tx_id: order.tx_id, name: order.name, email: order.email, contact: order.contact }) : null), [order?.tx_id, order?.order_id]);
  React.useEffect(() => { if (visible) { setLoading(true); setNote(null); } }, [visible, order?.tx_id]);

  const handle = (raw: string) => {
    let m: any = null;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return;
    if (m.failed) setNote(`Payment failed: ${String(m.reason ?? 'the payment did not go through')}. You can try again.`);
    onMessage(m as CheckoutMessage);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: '#0e0a09', paddingTop: insets.top }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 16, color: '#fff' }}>Pay {rupees(amountPaise)}</Text>
            <Body style={{ fontSize: 11, color: C.muted2, marginTop: 1 }}>Razorpay secure checkout</Body>
          </View>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close the checkout"
            style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.07)' }}>
            <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: '#fff' }}>Close</Text>
          </Pressable>
        </View>
        {note ? (
          <View style={{ paddingHorizontal: 14, paddingVertical: 8, backgroundColor: 'rgba(224,90,90,0.14)' }}>
            <Body style={{ fontSize: 12, color: '#F0A0A0' }}>{note}</Body>
          </View>
        ) : null}
        <View style={{ flex: 1 }}>
          {html ? (
            <WebView
              key={order?.tx_id}
              source={{ html, baseUrl: PAGE_ORIGIN }}
              style={{ flex: 1, backgroundColor: '#0e0a09' }}
              javaScriptEnabled
              domStorageEnabled
              originWhitelist={['*']}
              setSupportMultipleWindows={false}
              mixedContentMode="always"
              onLoadEnd={() => setLoading(false)}
              onMessage={(e) => handle(e.nativeEvent.data)}
              onShouldStartLoadWithRequest={(req) => {
                if (EXTERNAL.test(req.url)) {
                  Linking.openURL(req.url).catch(() => setNote('No UPI app could open. Pay with a card or net banking instead.'));
                  return false;
                }
                return true;
              }}
              {...(Platform.OS === 'android' ? { onOpenWindow: (e: any) => { const u = String(e?.nativeEvent?.targetUrl ?? ''); if (u) Linking.openURL(u).catch(() => {}); } } : {})}
            />
          ) : null}
          {loading ? (
            <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 10 }}>
              <ActivityIndicator color={C.orange} />
              <Body style={{ fontSize: 12, color: C.muted2 }}>Opening the checkout</Body>
            </View>
          ) : null}
        </View>
        <View style={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 10, paddingTop: 8, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon name="lock" size={11} color={C.muted3} strokeWidth={2} />
          <Body style={{ fontSize: 10.5, color: C.muted3 }}>Card and UPI details stay with Razorpay. Odds never sees them.</Body>
        </View>
      </View>
    </Modal>
  );
}
```

#### `src/components/AiBillSheet.tsx`
Legacy: the Deduct / Discard sheet, used only for a bill written before 3 Nov 2026 (the server reports it as pending). Port it or leave it out; new drafts never open it.

```tsx
/* Odds AI plan bill (Team Wallet, 2 Nov 2026): after a trainer's draft the server holds it behind a bill of Rs 30 to
   50. One tap Deduct from wallet pays it and returns the draft to Create Plan; Discard throws it away (nothing
   charged, at most 3 a day). A short balance keeps the bill waiting: the sheet says so and opens the Wallet.
   Sheet rules: sibling backdrop, hitSlop >= 10, one Modal at a time (Create Plan mounts it alone). */
import React from 'react';
import { View, Text, Pressable, Modal, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Body, Serif, Mono } from './primitives';
import { useStore } from '../store';
import { useIsOnline } from '../lib/offline';
import { useSettleAiBill, useDiscardAiBill, walletErrorText } from '../lib/teamWalletQueries';
import { billLines, billPreviewLine, rupees, walletCodeOf, type BillPreview } from '../lib/teamWallet';
import type { AiPlanResult } from '../lib/aiPlanDraft';
import { trackEvent } from '../lib/amplitude';

export type AiBillTarget = { tx_id: string; bill_paise: number; balance_paise: number; preview: BillPreview | null; clientName: string } | null;

export function AiBillSheet({ bill, onDeducted, onDiscarded, onClose }: {
  bill: AiBillTarget;
  /** The paid draft, applied to the builder exactly as a free draft is. */
  onDeducted: (r: AiPlanResult) => void;
  onDiscarded: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { go } = useStore();
  const online = useIsOnline();
  const settleM = useSettleAiBill();
  const discardM = useDiscardAiBill();
  const [err, setErr] = React.useState<{ text: string; short: boolean } | null>(null);
  const visible = !!bill;
  const busy = settleM.isPending || discardM.isPending;
  React.useEffect(() => { if (visible) { setErr(null); settleM.reset(); discardM.reset(); } }, [visible, bill?.tx_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const deduct = () => {
    if (!bill || busy || !online) return;
    setErr(null);
    settleM.mutate({ tx_id: bill.tx_id }, {
      onSuccess: (r) => { trackEvent('AI Plan Bill Deducted', { bill_paise: bill.bill_paise, already: r.already }); onDeducted(r.result); },
      onError: (e) => { const code = walletCodeOf(e); setErr({ text: walletErrorText(e, 'Could not deduct the bill. Try again.'), short: code === 'WALLET_INSUFFICIENT' }); },
    });
  };
  const discard = () => {
    if (!bill || busy || !online) return;
    setErr(null);
    discardM.mutate({ tx_id: bill.tx_id }, {
      onSuccess: () => { trackEvent('AI Plan Bill Discarded', { bill_paise: bill.bill_paise }); onDiscarded(); },
      onError: (e) => setErr({ text: walletErrorText(e, 'Could not discard the draft. Try again.'), short: false }),
    });
  };

  const lines = bill ? billLines(bill.bill_paise, bill.balance_paise) : null;
  const preview = bill ? billPreviewLine(bill.preview) : '';
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={busy ? () => {} : onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable onPress={busy ? undefined : onClose} accessibilityRole="button" accessibilityLabel="Close" importantForAccessibility="no-hide-descendants"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.64)' }} />
        <View accessibilityViewIsModal style={{ backgroundColor: C.sheetBg, borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: hexA('#A78BFA', 0.3), paddingHorizontal: 18, paddingTop: 14, paddingBottom: 16 + insets.bottom, gap: 12 }}>
          <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center' }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: hexA('#A78BFA', 0.16), borderWidth: 1, borderColor: hexA('#A78BFA', 0.45), alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="sparkle" size={17} color="#A78BFA" strokeWidth={2} />
            </View>
            <View style={{ flex: 1 }}>
              <Serif style={{ fontSize: 19 }}>Your plan is ready</Serif>
              <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 1 }}>{bill?.clientName ? `For ${bill.clientName.split(' ')[0]}` : 'Odds AI draft'}{preview ? ` · ${preview}` : ''}</Body>
            </View>
            <Pressable onPress={onClose} disabled={busy} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close"
              style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)' }}>
              <Icon name="close" size={14} color={C.muted} strokeWidth={2.2} />
            </Pressable>
          </View>

          <View style={{ padding: 14, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.3)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', gap: 6 }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 22, color: '#fff' }}>{lines?.bill}</Text>
            <Body style={{ fontSize: 12.5, color: C.ink3 }}>{lines?.after}</Body>
            <Body style={{ fontSize: 11, color: C.muted3, lineHeight: 15 }}>The draft opens in the builder once the bill is deducted. Discarding charges nothing.</Body>
          </View>

          {err ? (
            <View style={{ padding: 11, borderRadius: 12, backgroundColor: hexA(C.red, 0.1), borderWidth: 1, borderColor: hexA(C.red, 0.3), gap: 8 }}>
              <Body style={{ fontSize: 12, color: '#F0A0A0', lineHeight: 16 }}>{err.text}</Body>
              {err.short ? (
                <Pressable onPress={() => { onClose(); go('wallet'); }} hitSlop={10} accessibilityRole="button"
                  style={{ alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10, backgroundColor: hexA(C.orange, 0.16), borderWidth: 1, borderColor: hexA(C.orange, 0.5) }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: C.orange }}>Add money in Wallet</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {!online ? <Body style={{ fontSize: 11.5, color: C.gold }}>No connection. The bill can only be settled online.</Body> : null}

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable onPress={discard} disabled={busy || !online} hitSlop={6} accessibilityRole="button" accessibilityLabel="Discard the draft"
              style={{ flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', opacity: busy || !online ? 0.5 : 1 }}>
              {discardM.isPending ? <ActivityIndicator size="small" color={C.muted} /> : <Text style={{ fontFamily: F.bodySemi, fontSize: 13.5, color: C.muted }}>Discard</Text>}
            </Pressable>
            <Pressable onPress={deduct} disabled={busy || !online} hitSlop={6} accessibilityRole="button" accessibilityLabel="Deduct from wallet"
              style={{ flex: 1.6, borderRadius: 13, overflow: 'hidden', opacity: busy || !online ? 0.6 : 1 }}>
              <LinearGradient colors={['#2FBF71', '#1E8E53']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                {settleM.isPending ? <ActivityIndicator size="small" color="#fff" /> : <Icon name="checks" size={15} color="#fff" strokeWidth={2.4} />}
                <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: '#fff' }}>{settleM.isPending ? 'Deducting' : `Deduct ${bill ? rupees(bill.bill_paise) : ''}`}</Text>
              </LinearGradient>
            </Pressable>
          </View>
          <Mono style={{ fontSize: 8.5, color: C.faint, textAlign: 'center' }}>ONE TAP · THE BILL SHOWS IN YOUR WALLET HISTORY</Mono>
        </View>
      </View>
    </Modal>
  );
}
```

#### `src/components/AiPlanAssistant.tsx`
The Odds AI panel: the standing box, "Generate workout plan" (free, any number of times), the hint under it saying what Create Plan will do.

```tsx
/* Odds AI plan assistant panel (16 Oct 2026), shown at the top of Create Plan for an Essentials client
   the trainer may plan for: pick a split (sessions a week = the client's weekly slots, no picker since 16 Oct 2026),
   an optional note, then "Generate workout plan": the edge function ai-plan-draft drafts the plan from
   the client's latest QHP, medical and blood reports and from our exercises; the parent drops the
   draft into the normal builder, where the trainer edits, adds and deletes anything before submitting.
   Nothing is saved until the trainer submits. */
import React from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Body, Mono, Serif } from './primitives';
import { trackEvent } from '../lib/amplitude';
import { useAiPlanDraft } from '../lib/aiPlanQueries';
import { SPLITS, splitOf, aiPromptLine, sourcesLine, draftExerciseCount, draftNewExercises, type AiPlanPreview, type AiPlanResult, type SplitKey } from '../lib/aiPlanDraft';
import { useStore } from '../store';
import { walletCardState, rupees, generateHint } from '../lib/teamWallet';
import { AiBillSheet, type AiBillTarget } from './AiBillSheet';

const AI = '#A78BFA';
const STEPS = ['Reading the QHP', 'Checking blood markers and medical history', 'Picking exercises from the Odds library', 'Setting sets, reps and rest', 'Checking every exercise against the library'];

export function AiPlanAssistant({ clientId, clientName, preview, onApply }: {
  clientId: string;
  clientName: string;
  preview: AiPlanPreview;
  /** Drop the draft into the builder (the parent asks before replacing exercises already in the form).
      `prompt` is the registry's ai_prompt for this draft: the split label and the note as one line. */
  onApply: (r: AiPlanResult, prompt: string) => void;
}) {
  const draftM = useAiPlanDraft();
  const { go } = useStore();
  const [open, setOpen] = React.useState(true);
  /* Team Wallet (2 Nov 2026; rule final 3 Nov 2026): generating is FREE, any number of times. After the 3 free plans a
     trainer's AI plan is charged ONCE, a fixed price (Rs 50), when Create Plan succeeds (the server does it as the
     plan's rows land); the balance may go negative, and only a negative balance blocks. The panel shows the standing
     line and a hint under Generate saying what Create Plan will do. The bill sheet survives only for a bill from
     before the rule change (the server still reports it as pending). */
  const [bill, setBill] = React.useState<AiBillTarget>(null);
  const [billNote, setBillNote] = React.useState<string | null>(null);
  const wallet = walletCardState(preview.wallet);
  const pendingBill = preview.wallet?.pending_bill ?? null;
  const openPendingBill = () => {
    if (!pendingBill || !preview.wallet) return;
    setBill({ tx_id: pendingBill.tx_id, bill_paise: pendingBill.bill_paise, balance_paise: preview.wallet.balance_paise, preview: pendingBill.preview, clientName: pendingBill.client_name ?? clientName });
  };
  const walletBlocks = wallet.state === 'negative' || wallet.state === 'bill_pending';
  const hint = generateHint(preview.wallet);
  const [split, setSplit] = React.useState<SplitKey | null>(null);
  const [note, setNote] = React.useState('');
  const [result, setResult] = React.useState<AiPlanResult | null>(null);
  const [step, setStep] = React.useState(0);
  const [secs, setSecs] = React.useState(0);

  // The waiting line: a step every 6 s and a seconds counter (a draft takes 20 to 40 s).
  React.useEffect(() => {
    if (!draftM.isPending) { setStep(0); setSecs(0); return; }
    const t0 = Date.now();
    const t = setInterval(() => {
      const s = Math.round((Date.now() - t0) / 1000);
      setSecs(s);
      setStep(Math.min(STEPS.length - 1, Math.floor(s / 6)));
    }, 1000);
    return () => clearInterval(t);
  }, [draftM.isPending]);

  const generate = async () => {
    if (!split || draftM.isPending) return;
    trackEvent('AI Plan Generate Tapped', { client_id: clientId, split, has_note: !!note.trim() });
    try {
      // Sessions a week: the server takes the client's weekly slot count (owner, 16 Oct 2026: no picker).
      const a = await draftM.mutateAsync({ clientId, split, note });
      if (a.kind === 'bill') {
        setBillNote(null);
        trackEvent('AI Plan Bill Shown', { client_id: clientId, split, bill_paise: a.bill.bill_paise, blocks: a.bill.blocks.length });
        setBill({ tx_id: a.bill.tx_id, bill_paise: a.bill.bill_paise, balance_paise: a.bill.balance_paise, preview: a.preview, clientName });
        return;
      }
      const r = a.result;
      setResult(r);
      trackEvent('AI Plan Generated', { client_id: clientId, split, model: r.model, exercises: draftExerciseCount(r.draft), not_in_db: draftNewExercises(r.draft).length, dropped: r.dropped.length, free_this: r.wallet?.free_this ?? null, price_paise: r.wallet?.price_paise ?? null });
      onApply(r, aiPromptLine(r.draft.split_label || splitOf(split)?.label || split, note));
    } catch (e: any) {
      trackEvent('AI Plan Generate Failed', { client_id: clientId, split, error: String(e?.message ?? e).slice(0, 120) });
    }
  };

  const src = sourcesLine(preview.sources);
  const applyPaid = (r: AiPlanResult) => {
    setBill(null);
    setResult(r);
    setBillNote(null);
    trackEvent('AI Plan Generated', { client_id: clientId, split: r.draft.split, model: r.model, exercises: draftExerciseCount(r.draft), not_in_db: draftNewExercises(r.draft).length, dropped: r.dropped.length, paid: true });
    onApply(r, aiPromptLine(r.draft.split_label || splitOf(r.draft.split)?.label || r.draft.split, note));
  };

  return (
    <LinearGradient colors={['rgba(76,52,140,0.42)', 'rgba(18,14,22,0.6)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={{ borderRadius: 20, borderWidth: 1, borderColor: hexA(AI, 0.4), padding: 15, gap: 13 }}>
      <Pressable onPress={() => setOpen((o) => !o)} hitSlop={10} accessibilityRole="button" accessibilityState={{ expanded: open }} style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
        <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: hexA(AI, 0.16), borderWidth: 1, borderColor: hexA(AI, 0.45), alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="sparkle" size={18} color={AI} strokeWidth={2} />
        </View>
        <View style={{ flex: 1 }}>
          <Serif style={{ fontSize: 17 }}>Odds AI plan assistant</Serif>
          <Body style={{ fontSize: 11, color: C.muted2, marginTop: 2, lineHeight: 15 }}>{preview.essentials ? 'Essentials client · ' : ''}Drafts {clientName.split(' ')[0]}'s Strength Training plan from the QHP, medical and blood reports</Body>
        </View>
        <Icon name={open ? 'chevUp' : 'chevDown'} size={15} color={AI} strokeWidth={2.4} />
      </Pressable>

      {open ? (
        <>
          {src ? (
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 7, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.25)' }}>
              <Icon name="file" size={12} color={C.muted} strokeWidth={2.1} />
              <Body style={{ flex: 1, fontSize: 11, color: C.ink3, lineHeight: 15 }}>Reads {src}</Body>
            </View>
          ) : null}

          {wallet.state !== 'free' && wallet.state !== 'unknown' ? (
            <View style={{ gap: 8, padding: 11, borderRadius: 12, backgroundColor: walletBlocks ? hexA(C.gold, 0.08) : 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: walletBlocks ? hexA(C.gold, 0.35) : 'rgba(255,255,255,0.06)' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                <Icon name="rupee" size={12} color={walletBlocks ? C.gold : C.muted} strokeWidth={2.2} />
                <Body style={{ flex: 1, fontSize: 11.5, color: walletBlocks ? C.gold : C.ink3, lineHeight: 15 }}>{wallet.line}</Body>
              </View>
              {wallet.action === 'wallet' ? (
                <Pressable onPress={() => go('wallet')} hitSlop={10} accessibilityRole="button" style={{ alignSelf: 'flex-start', paddingVertical: 7, paddingHorizontal: 12, borderRadius: 9, backgroundColor: hexA(C.orange, 0.16), borderWidth: 1, borderColor: hexA(C.orange, 0.5) }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: C.orange }}>Add money in Wallet</Text>
                </Pressable>
              ) : wallet.action === 'bill' ? (
                <Pressable onPress={openPendingBill} hitSlop={10} accessibilityRole="button" style={{ alignSelf: 'flex-start', paddingVertical: 7, paddingHorizontal: 12, borderRadius: 9, backgroundColor: hexA(AI, 0.18), borderWidth: 1, borderColor: hexA(AI, 0.55) }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: AI }}>Open bill{pendingBill ? `, ${rupees(pendingBill.bill_paise)}` : ''}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {billNote ? <Body style={{ fontSize: 11.5, color: C.green }}>{billNote}</Body> : null}

          {/* 1 · split */}
          <View style={{ gap: 8 }}>
            <Mono style={{ fontSize: 9.5, letterSpacing: 1.3, color: AI }}>CHOOSE A SPLIT</Mono>
            {SPLITS.map((s) => {
              const active = split === s.key;
              return (
                <Pressable key={s.key} onPress={() => setSplit(s.key)} hitSlop={4} accessibilityRole="radio" accessibilityState={{ selected: active }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: 11, borderRadius: 14, backgroundColor: active ? hexA(AI, 0.16) : 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: active ? hexA(AI, 0.6) : 'rgba(255,255,255,0.08)' }}>
                  <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: active ? AI : C.muted3, alignItems: 'center', justifyContent: 'center' }}>
                    {active ? <View style={{ width: 9, height: 9, borderRadius: 4.5, backgroundColor: AI }} /> : null}
                  </View>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: active ? '#fff' : C.ink }}>{s.label}</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
                      {s.sections.map((n) => (
                        <View key={n} style={{ paddingVertical: 2, paddingHorizontal: 7, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.06)' }}>
                          <Text style={{ fontFamily: F.bodySemi, fontSize: 9.5, color: C.ink3 }}>{n}</Text>
                        </View>
                      ))}
                    </View>
                    <Body style={{ fontSize: 10.5, color: C.muted2 }}>{s.blurb}</Body>
                  </View>
                </Pressable>
              );
            })}
          </View>


          <View style={{ gap: 6 }}>
            <Mono style={{ fontSize: 9.5, letterSpacing: 1.3, color: C.muted2 }}>NOTE FOR ODDS AI (OPTIONAL)</Mono>
            <TextInput value={note} onChangeText={(t) => setNote(t.slice(0, 300))} placeholder="e.g. no machines at home, wants to focus on posture" placeholderTextColor={C.muted3} multiline
              style={{ minHeight: 48, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.03)', color: '#fff', fontFamily: F.body, fontSize: 13, textAlignVertical: 'top' }} />
          </View>

          <Pressable onPress={generate} disabled={!split || draftM.isPending || walletBlocks} hitSlop={6} accessibilityRole="button" accessibilityState={{ disabled: !split || draftM.isPending || walletBlocks }}
            style={{ borderRadius: 14, overflow: 'hidden', opacity: !split || walletBlocks ? 0.5 : 1 }}>
            <LinearGradient colors={['#8B5CF6', '#6D28D9']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14 }}>
              {draftM.isPending ? <ActivityIndicator size="small" color="#fff" /> : <Icon name="sparkle" size={15} color="#fff" strokeWidth={2.2} />}
              <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: '#fff' }}>
                {draftM.isPending ? `Drafting… ${secs}s` : !split ? 'Choose a split first' : result ? 'Generate again' : 'Generate workout plan'}
              </Text>
            </LinearGradient>
          </Pressable>
          {draftM.isPending ? <Body style={{ fontSize: 11, color: AI, textAlign: 'center' }}>{STEPS[step]}…</Body> : null}
          {draftM.error && !draftM.isPending ? <Body style={{ fontSize: 11.5, color: C.red }}>{(draftM.error as Error).message.replace(/^WALLET_[A-Z_]+:\s*/, '')}</Body> : null}
          {hint && !walletBlocks && !draftM.isPending ? <Body style={{ fontSize: 10.5, color: C.muted3, textAlign: 'center' }}>{hint}</Body> : null}

          {result && !draftM.isPending ? (
            <View style={{ gap: 9, padding: 12, borderRadius: 14, backgroundColor: hexA(C.green, 0.07), borderWidth: 1, borderColor: hexA(C.green, 0.3) }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                <Icon name="checks" size={14} color={C.green} strokeWidth={2.4} />
                <Text style={{ flex: 1, fontFamily: F.bodySemi, fontSize: 12.5, color: '#fff' }}>
                  Draft added below: {draftExerciseCount(result.draft)} exercises in {result.draft.sections.map((s) => s.name).join(', ')}
                </Text>
              </View>
              <Body style={{ fontSize: 11, color: C.muted2, lineHeight: 15 }}>Change, add or delete anything, then submit. It goes for approval like any plan.</Body>
              {draftNewExercises(result.draft).length ? (
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6, padding: 9, borderRadius: 11, backgroundColor: hexA(C.gold, 0.08), borderWidth: 1, borderColor: hexA(C.gold, 0.35) }}>
                  <Icon name="plus" size={11} color={C.gold} strokeWidth={2.6} />
                  <Body style={{ flex: 1, fontSize: 11, color: C.gold, lineHeight: 15 }}>
                    Not in our library yet: {draftNewExercises(result.draft).join(', ')}. They are marked NOT IN DB below and join the library when you submit; delete any you do not want.
                  </Body>
                </View>
              ) : null}
              {result.draft.rationale.length ? (
                <View style={{ gap: 4 }}>
                  <Mono style={{ fontSize: 8.5, letterSpacing: 1.2, color: C.green }}>WHY THIS PLAN</Mono>
                  {result.draft.rationale.map((l, i) => <Body key={i} style={{ fontSize: 11.5, color: C.ink, lineHeight: 16 }}>· {l}</Body>)}
                </View>
              ) : null}
              {result.draft.avoided.length ? (
                <View style={{ gap: 4 }}>
                  <Mono style={{ fontSize: 8.5, letterSpacing: 1.2, color: C.gold }}>AVOIDED</Mono>
                  {result.draft.avoided.map((l, i) => <Body key={i} style={{ fontSize: 11.5, color: C.ink3, lineHeight: 16 }}>· {l}</Body>)}
                </View>
              ) : null}
              {result.dropped.length ? (
                <Body style={{ fontSize: 10.5, color: C.muted3 }}>Left out (not in the Odds library): {result.dropped.join(', ')}</Body>
              ) : null}
            </View>
          ) : null}
        </>
      ) : null}
      <AiBillSheet bill={bill} onDeducted={applyPaid} onClose={() => setBill(null)}
        onDiscarded={() => { setBill(null); setBillNote('Draft discarded. Nothing was charged.'); trackEvent('AI Plan Draft Discarded', { client_id: clientId }); }} />
    </LinearGradient>
  );
}
```

### 4.2 Edited files: `git diff -U4` against 755512e (the tree before any wallet work)

```diff
diff --git a/src/Router.tsx b/src/Router.tsx
index d41c465..53af08b 100644
--- a/src/Router.tsx
+++ b/src/Router.tsx
@@ -23,8 +23,9 @@ import { Referrals } from './screens/referrals';
 import { Incentives } from './screens/incentives';
 import { EssentialsAuction } from './screens/essentialsAuction';
 import { EssentialsManager } from './screens/essentialsManager';
 import { Nucleus, NucleusPiece } from './screens/nucleus';
+import { Wallet } from './screens/wallet';
 import { QhpNavigation } from './screens/qhpNavigation';
 import { WorkoutAnalyst } from './screens/workoutAnalyst';
 import { Messenger, ChatNotifications } from './screens/messenger';
 import { ClientThreads } from './screens/clientThreads';
@@ -128,8 +129,10 @@ const SCREENS: Record<string, React.ComponentType> = {
   'essentials-manager': EssentialsManager,
   // Odds Nucleus (16 Oct 2026): published education pieces, every role; NOT in SENSITIVE_ROUTES (no client data).
   nucleus: Nucleus,
   'nucleus-piece': NucleusPiece,
+  // Team Wallet (2 Nov 2026): every role; money on screen, so it is in SENSITIVE_ROUTES.
+  wallet: Wallet,
   'qhp-navigate': QhpNavigation,
   qhp: Qhp,
   'qhp-manager': QhpManager,
   'qhp-stats': QhpStats,
@@ -281,8 +284,10 @@ const SENSITIVE_ROUTES = new Set([
   'academy-dashboard', 'academy-management', 'academy-qhp-analyser', 'academy-daily-goals', 'academy-weekly-summary', 'academy-senior-analyst',
   'academy-teacher', 'academy-student',
   // Chats \u2014 client health details are routinely discussed in messages
   'messenger', 'client-threads', 'manager-chat',
+  // Team Wallet (2 Nov 2026): balances, payment ids and the Razorpay checkout
+  'wallet',
 ]);
 
 /* Memoised on (route, role): ScreenHost re-renders on every transition frame
    end, swipe offset reset and store change, and each of those used to re-create
diff --git a/src/components/PushTokenManager.tsx b/src/components/PushTokenManager.tsx
index 2e70d1f..4f9b5d8 100644
--- a/src/components/PushTokenManager.tsx
+++ b/src/components/PushTokenManager.tsx
@@ -84,8 +84,10 @@ export function PushTokenManager() {
     // QHP client location (2 Nov 2026): "no client location" lands ops on the Leads page and a QHP manager on their
     // page; "location added" lands the assessor on the QHP page (Start navigation), anyone else on home.
     if (t === 'qhp_location_missing') { go(dbRoleRef.current === 'ops' ? 'ops-leads' : 'qhp-manager'); return; }
     if (t === 'qhp_location_added') { go(dbRoleRef.current === 'trainer' ? 'qhp' : homeRouteFor(roleRef.current)); return; }
+    // Team Wallet (2 Nov 2026): the top-up receipt opens the Wallet screen.
+    if (t === 'wallet_topup' || data.route === 'wallet') { go('wallet'); return; }
     // 7 PM team-flags push → straight into the manager chat.
     if (t === 'manager_team_flags' || data.route === 'manager-chat') { go('manager-chat'); return; }
     // Anything else that names a route/session (unknown web routes included) → home.
     // plan_expiry lands on the trainer's home too: the roster cards there carry the
diff --git a/src/data.ts b/src/data.ts
index b0a71a4..16d9d49 100644
--- a/src/data.ts
+++ b/src/data.ts
@@ -309,8 +309,9 @@ export const trainerNav: NavGroup[] = [
     { label: 'Sessions', icon: 'dumbbell', route: 'sessions' },
     { label: 'Essentials Auction', icon: 'gavel', route: 'essentials-auction' },
     { label: 'Essentials Manager', icon: 'gavel', route: 'essentials-manager' },
     { label: 'Payouts', icon: 'rupee', route: 'payouts' },
+    { label: 'Wallet', icon: 'rupee', route: 'wallet' },
     { label: 'Referrals', icon: 'userPlus', route: 'referrals' },
     { label: 'Incentive', icon: 'gift', route: 'incentives' },
   ] },
   { label: 'QHP', items: [
@@ -340,8 +341,9 @@ export const crmNav: NavGroup[] = [
     { label: 'Dashboard', icon: 'grid', route: 'crm-dashboard' },
     { label: 'Odds AI', icon: 'sparkle', route: 'crm-ai' },
     { label: 'My Clients', icon: 'users', route: 'crm-clients' },
     { label: 'Revenue Forecast', icon: 'rupee', route: 'crm-revenue-forecast' },
+    { label: 'Wallet', icon: 'rupee', route: 'wallet' },
     { label: 'Messenger', icon: 'chat', route: 'messenger' },
     { label: 'Client Threads', icon: 'atSign', route: 'client-threads' },
   ] },
   { label: 'Client Insights', items: [
@@ -371,8 +373,9 @@ export const coachNav: NavGroup[] = [
   { label: 'Overview', items: [
     { label: 'Dashboard', icon: 'grid', route: 'coach-dashboard' },
     { label: 'Trainers', icon: 'crown', route: 'coach-trainers' },
     { label: 'Assessments', icon: 'heart', route: 'coach-assessments' },
+    { label: 'Wallet', icon: 'rupee', route: 'wallet' },
   ] },
   { label: 'Clients', items: [
     { label: 'My Clients', icon: 'users', route: 'coach-clients' },
     { label: 'Client Threads', icon: 'atSign', route: 'client-threads' },
@@ -403,8 +406,9 @@ export const opsNav: NavGroup[] = [
   { label: 'Workspace', items: [
     { label: 'Dashboard', icon: 'grid', route: 'ops-dashboard' },
     { label: 'Leads', icon: 'users', route: 'ops-leads' },
     { label: 'Clients', icon: 'layers', route: 'ops-clients' },
+    { label: 'Wallet', icon: 'rupee', route: 'wallet' },
     { label: 'Messenger', icon: 'chat', route: 'messenger' },
     { label: 'Client Threads', icon: 'atSign', route: 'client-threads' },
   ] },
   { label: 'Sales', items: [
@@ -432,8 +436,9 @@ export const adminNav: NavGroup[] = [
     { label: 'Dashboard', icon: 'grid', route: 'admin-dashboard' },
     { label: 'Clients', icon: 'users', route: 'admin-clients' },
     { label: 'Renewals', icon: 'swap', route: 'admin-renewals' },
     { label: 'Revenue Forecast', icon: 'rupee', route: 'admin-revenue-forecast' },
+    { label: 'Wallet', icon: 'rupee', route: 'wallet' },
     { label: 'Requests', icon: 'inbox', route: 'admin-requests' },
     { label: 'Incidents', icon: 'alert', route: 'admin-incidents' },
     { label: 'Users', icon: 'userCircle', route: 'admin-users' },
     { label: 'Performance', icon: 'trend', route: 'admin-performance' },
@@ -458,8 +463,9 @@ export const marketingNav: NavGroup[] = [
     { label: 'Dashboard', icon: 'grid', route: 'marketing-dashboard' },
     { label: 'Influencer Clients', icon: 'users', route: 'marketing-clients' },
     { label: 'Leads', icon: 'userPlus', route: 'marketing-leads' },
     { label: 'Lead Analytics', icon: 'chart', route: 'marketing-lead-analytics' },
+    { label: 'Wallet', icon: 'rupee', route: 'wallet' },
     { label: 'Messenger', icon: 'chat', route: 'messenger' },
   ] },
   { label: 'Learn', items: [
     { label: 'Odds Nucleus', icon: 'nucleus', route: 'nucleus' },
@@ -480,8 +486,9 @@ export const academyNav: NavGroup[] = [
     { label: 'Workout Plans Analyst', icon: 'activity', route: 'plans-analyst' },
     { label: 'Progression', icon: 'chart', route: 'coach-progression' },
     { label: 'Academy Management', icon: 'award', route: 'academy-management' },
     { label: 'B2C Reports', icon: 'file', route: 'b2c-reports' },
+    { label: 'Wallet', icon: 'rupee', route: 'wallet' },
     { label: 'Messenger', icon: 'chat', route: 'messenger' },
     { label: 'Client Threads', icon: 'atSign', route: 'client-threads' },
   ] },
   { label: 'Learn', items: [
@@ -505,8 +512,9 @@ export const doctorNav: NavGroup[] = [
     { label: 'Messenger', icon: 'chat', route: 'messenger' },
     { label: 'Client Threads', icon: 'atSign', route: 'client-threads' },
     { label: 'Referrals', icon: 'userPlus', route: 'referrals' },
     { label: 'Reimbursement', icon: 'rupee', route: 'doctor-reimbursements' },
+    { label: 'Wallet', icon: 'rupee', route: 'wallet' },
   ] },
   { label: 'Head Doctor', items: [
     { label: 'All Clients', icon: 'layers', route: 'doctor-all-clients' },
     { label: 'Roster', icon: 'calendar', route: 'doctor-roster' },
@@ -527,8 +535,9 @@ export const doctorNav: NavGroup[] = [
 export const consultantNav: NavGroup[] = [
   { label: 'Workspace', items: [
     { label: 'Consultant Dashboard', icon: 'home', route: 'doctor-dashboard' },
     { label: 'All Calls', icon: 'calendar', route: 'doctor-consultant-calls' },
+    { label: 'Wallet', icon: 'rupee', route: 'wallet' },
   ] },
   { label: 'Learn', items: [
     { label: 'Odds Nucleus', icon: 'nucleus', route: 'nucleus' },
   ] },
@@ -538,8 +547,9 @@ export const therapistNav: NavGroup[] = [
   { label: 'Workspace', items: [
     { label: 'Dashboard', icon: 'grid', route: 'therapist-dashboard' },
     { label: 'My Clients', icon: 'users', route: 'therapist-clients' },
     { label: 'Sessions', icon: 'calendar', route: 'therapist-sessions' },
+    { label: 'Wallet', icon: 'rupee', route: 'wallet' },
     { label: 'Messenger', icon: 'chat', route: 'messenger' },
     { label: 'Client Threads', icon: 'atSign', route: 'client-threads' },
   ] },
   { label: 'Learn', items: [
@@ -553,8 +563,9 @@ export const therapistNav: NavGroup[] = [
 /* Essentials manager (22 Oct 2026): profiles.role = essential_manager sees only this page (plus Learn). */
 export const essentialManagerNav: NavGroup[] = [
   { label: 'Workspace', items: [
     { label: 'Essentials Manager', icon: 'gavel', route: 'essentials-manager' },
+    { label: 'Wallet', icon: 'rupee', route: 'wallet' },
   ] },
   { label: 'Learn', items: [
     { label: 'Odds Nucleus', icon: 'nucleus', route: 'nucleus' },
   ] },
@@ -562,8 +573,9 @@ export const essentialManagerNav: NavGroup[] = [
 
 export const techNav: NavGroup[] = [
   { label: 'Workspace', items: [
     { label: 'Tech Desk', icon: 'activity', route: 'tech-desk-inbox' },
+    { label: 'Wallet', icon: 'rupee', route: 'wallet' },
   ] },
   { label: 'Learn', items: [
     { label: 'Odds Nucleus', icon: 'nucleus', route: 'nucleus' },
   ] },
diff --git a/src/lib/aiPlanDraft.ts b/src/lib/aiPlanDraft.ts
index 290d543..7d5defd 100644
--- a/src/lib/aiPlanDraft.ts
+++ b/src/lib/aiPlanDraft.ts
@@ -4,8 +4,9 @@
    Pure rules: the edge function's draft to the Create Plan builder state, the source line, the alert
    copy. No React, no network: tested in node. The server (hub-track ai-plan-draft) already checks every
    exercise against exercises_db; this file only shapes what it returns. */
 import type { PlanBodyPartInput, PlanSetInput } from './clientQueries';
+import type { WalletGate } from './teamWallet';
 
 export type SplitKey = 'ppl' | 'upper_lower' | 'bro';
 export type SplitOption = { key: SplitKey; label: string; sections: string[]; blurb: string };
 
@@ -42,10 +43,16 @@ export type AiPlanSources = {
   sessions_last_30_days: number;
   weekly_slots: { day: string | null; time: string | null; modality: string | null }[];
   suggested_sessions_per_week: number;
 };
-export type AiPlanPreview = { eligible: boolean; allowed: boolean; essentials: boolean; client_name: string; sources: AiPlanSources; model: string };
-export type AiPlanResult = { draft: AiPlanDraft; dropped: string[]; sources: AiPlanSources; model: string; generated_at: string };
+/** wallet (Team Wallet, 2 Nov 2026): does the caller pay for drafts (trainers), the balance and a waiting bill;
+    null while the wallet is not on the server. */
+export type AiPlanPreview = { eligible: boolean; allowed: boolean; essentials: boolean; client_name: string; sources: AiPlanSources; model: string; wallet: WalletGate | null };
+/** wallet (3 Nov 2026, final rule): the standing that travels with a trainer's draft. Nothing is charged for a draft
+    (charge_at 'plan_create': the fixed price moves once, when Create Plan succeeds; free_this = that plan is free). The
+    older fields (charged, charged_paise, error) stay for a server still charging at the draft. */
+export type AiDraftCharge = { charged: boolean; charged_paise: number; charge_at: 'plan_create' | 'draft'; price_paise: number | null; balance_paise: number; negative: boolean; essentials: boolean; free_this: boolean; free_left: number | null; error: string | null };
+export type AiPlanResult = { draft: AiPlanDraft; dropped: string[]; sources: AiPlanSources; model: string; generated_at: string; wallet?: AiDraftCharge | null };
 
 const str = (v: unknown) => (v == null ? '' : String(v));
 
 /** One draft set as the form's strings (load stays empty: the trainer sets kilograms in the session). */
diff --git a/src/lib/aiPlanQueries.ts b/src/lib/aiPlanQueries.ts
index 843c5f8..57c4523 100644
--- a/src/lib/aiPlanQueries.ts
+++ b/src/lib/aiPlanQueries.ts
@@ -1,12 +1,14 @@
 /* Odds AI plan assistant data (16 Oct 2026). The edge function ai-plan-draft (hub-track) reads the
    client's latest QHP, medical history, blood markers and health context and drafts a plan from
    exercises_db; it writes nothing. The plan is saved by Create Plan exactly as before. The home alert
    list is the definer RPC get_my_essentials_plan_gaps (migration 20261016150000). */
-import { useMutation, useQuery } from '@tanstack/react-query';
+import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
 import { supabase } from './supabase';
 import { invokeWithTimeout, withTimeout, NET_MS } from './withTimeout';
 import type { AiPlanPreview, AiPlanResult, EssentialsPlanGap, SplitKey } from './aiPlanDraft';
+import { parseWalletGate, type AiBill, type BillPreview } from './teamWallet';
+import { parseAiPlanResult } from './teamWalletQueries';
 
 /** Generating takes 20 to 40 seconds (Gemini reads the QHP and picks from about 230 exercises). */
 export const AI_PLAN_MS = 100_000;
 export const PLAN_GAPS_KEY = ['trainer-essentials-plan-gaps'] as const;
@@ -50,28 +52,36 @@ export function useAiPlanPreview(clientId: string | null | undefined, enabled =
         essentials: d?.essentials === true,
         client_name: String(d?.client_name ?? ''),
         sources: d?.sources ?? null,
         model: String(d?.model ?? ''),
+        wallet: parseWalletGate(d?.wallet),
       };
     },
   });
 }
 
 /** sessionsPerWeek is optional: without it the server uses the client's weekly slot count (the app sends none since 16 Oct 2026). */
 export type AiPlanRequest = { clientId: string; split: SplitKey; sessionsPerWeek?: number; note?: string };
+/** The draft call's answer: the draft itself, or (a trainer, Team Wallet 2 Nov 2026) a bill holding it until
+    Deduct from wallet (wallet-settle-ai-plan returns the same AiPlanResult). */
+export type AiPlanAnswer = { kind: 'draft'; result: AiPlanResult } | { kind: 'bill'; bill: AiBill; preview: BillPreview | null };
 /** One draft (20 to 40 s). Throws the server's sentence on refusal. */
 export function useAiPlanDraft() {
+  const qc = useQueryClient();
   return useMutation({
-    mutationFn: async (r: AiPlanRequest): Promise<AiPlanResult> => {
+    // A free draft or a bill changes the preview's wallet line and the Wallet history.
+    onSettled: () => { qc.invalidateQueries({ queryKey: ['ai-plan-preview'] }); qc.invalidateQueries({ queryKey: ['my-team-wallet'] }); },
+    mutationFn: async (r: AiPlanRequest): Promise<AiPlanAnswer> => {
       const d = await callPlanFn({ client_id: r.clientId, split: r.split, sessions_per_week: r.sessionsPerWeek ?? undefined, note: r.note?.trim() || undefined }, AI_PLAN_MS);
-      if (!d?.draft || !Array.isArray(d.draft.sections)) throw new Error('Odds AI returned no plan. Try Generate again.');
-      return {
-        draft: d.draft,
-        dropped: Array.isArray(d.dropped) ? d.dropped : [],
-        sources: d.sources ?? null,
-        model: String(d.model ?? ''),
-        generated_at: String(d.generated_at ?? new Date().toISOString()),
-      };
+      if (d?.bill?.tx_id) {
+        const p = d.preview && typeof d.preview === 'object' ? d.preview : null;
+        return {
+          kind: 'bill',
+          bill: { tx_id: String(d.bill.tx_id), bill_paise: Number(d.bill.bill_paise) || 0, balance_paise: Number(d.bill.balance_paise) || 0, blocks: Array.isArray(d.bill.blocks) ? d.bill.blocks.map(String) : [] },
+          preview: p ? { sections: Array.isArray(p.sections) ? p.sections.map(String) : [], exercise_count: Number(p.exercise_count) || 0, split_label: p.split_label ?? null } : null,
+        };
+      }
+      return { kind: 'draft', result: parseAiPlanResult(d) };
     },
   });
 }
 
diff --git a/src/lib/approvalRequests.ts b/src/lib/approvalRequests.ts
index ad4945b..c6758f9 100644
--- a/src/lib/approvalRequests.ts
+++ b/src/lib/approvalRequests.ts
@@ -110,12 +110,12 @@ export const sessionCodeStatusLine = (r: ApprovalRequest | null | undefined): {
 
 /** The plain sentence of an approval / Session code / client location server error ("APPROVAL_OWN_REQUEST: You
     cannot review your own request."). Some of them carry the 42501 "not allowed" code, which friendlyError turns
     into its generic line; these screens show the server's own sentence first and fall back to friendlyError
-    otherwise. LOCATION_ added 2 Nov 2026 (set_client_brb_location). */
+    otherwise. LOCATION_ added 2 Nov 2026 (set_client_brb_location); WALLET_ the same day (Team Wallet). */
 export const codedSentence = (e: unknown): string | null => {
   const msg = String((e as { message?: unknown } | null)?.message ?? '').trim();
-  const m = msg.match(/^(?:OTP|APPROVAL|LOCATION)_[A-Z_]+:\s*(.+)$/s);
+  const m = msg.match(/^(?:OTP|APPROVAL|LOCATION|WALLET)_[A-Z_]+:\s*(.+)$/s);
   return m && m[1].trim() ? m[1].trim() : null;
 };
 
 /** Reason / note checks the server also makes (so the button can say why it is not ready). */
diff --git a/src/screens/createPlan.tsx b/src/screens/createPlan.tsx
index fafb0e5..3b5e9e5 100644
--- a/src/screens/createPlan.tsx
+++ b/src/screens/createPlan.tsx
@@ -18,8 +18,9 @@ import { enqueueOutbox, getIsOnline, useIsOnline, getOutbox, updateOutboxItem }
 import { useDragReorder } from '../lib/useDragReorder';
 import { AiPlanAssistant } from '../components/AiPlanAssistant';
 import { useAiPlanPreview } from '../lib/aiPlanQueries';
 import { draftToBodyParts, shouldFill, draftExerciseCount, aiChoice, planSource, type AiPlanResult, type PlanBuildMode } from '../lib/aiPlanDraft';
+import { walletCardState, aiOptionChip, negativeBalanceLine, createButtonLabel, createDoneLine } from '../lib/teamWallet';
 import { trackEvent } from '../lib/amplitude';
 
 /* ============ CREATE WORKOUT PLAN ============
    Mirrors the web app's Create Workout Plan form end-to-end (client, plan meta,
@@ -222,9 +223,11 @@ export function CreatePlan() {
   // Post-save "Saved ✓" navigation timer: kept in a ref so leaving early (back
   // tap inside the 900 ms window) or unmounting cancels it \u2014 an orphaned
   // goBack() used to pop a SECOND screen.
   const navTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
-  const scheduleGoBack = () => { if (navTimer.current) clearTimeout(navTimer.current); navTimer.current = setTimeout(() => goBack(), 900); };
+  const scheduleGoBack = (ms = 900) => { if (navTimer.current) clearTimeout(navTimer.current); navTimer.current = setTimeout(() => goBack(), ms); };
+  // Team Wallet (3 Nov 2026): what the wallet did when an AI plan was saved (shown in the footer before leaving).
+  const [walletDone, setWalletDone] = React.useState<{ text: string; tone: 'red' | 'green' | 'grey' } | null>(null);
   React.useEffect(() => () => { if (navTimer.current) clearTimeout(navTimer.current); }, []);
   const goBack = () => {
     if (navTimer.current) { clearTimeout(navTimer.current); navTimer.current = null; }
     canGoBack ? back() : go('client');
@@ -250,8 +253,27 @@ export function CreatePlan() {
   const aiPreviewQ = useAiPlanPreview(selectedClientId, !isEdit && isOnline);
   const aiAllowed = !isEdit && aiPreviewQ.data?.allowed === true;
   const [mode, setMode] = React.useState<PlanBuildMode | null>(isEdit ? 'manual' : null);
   const aiPick = aiChoice({ online: isOnline, clientId: selectedClientId, modality, allowed: isEdit ? false : aiPreviewQ.data ? aiPreviewQ.data.allowed : null });
+  // Team Wallet (2 Nov 2026, rule final 3 Nov 2026): generating is free; after the 3 free plans an AI plan is charged
+  // once, a fixed price (Rs 50), when Create Plan succeeds (the server does it as the rows land). The card shows the
+  // standing (free count, the price and balance, or ADD FUNDS); only a NEGATIVE balance blocks, with the owner's popup
+  // and a button to the Wallet, here and again at the Create Plan button. A balance below the price never blocks.
+  const walletCard = walletCardState(aiPreviewQ.data?.wallet ?? null);
+  const aiChip = aiOptionChip(aiPreviewQ.data?.wallet ?? null);
+  const aiChipColor = aiChip?.tone === 'red' ? C.red : aiChip?.tone === 'amber' ? C.gold : C.green;
+  const chooseAi = () => {
+    if (!aiPick.enabled) return;
+    if (walletCard.state === 'negative') {
+      trackEvent('AI Plan Blocked Negative Wallet', { client_id: selectedClientId, balance_paise: aiPreviewQ.data?.wallet?.balance_paise ?? null });
+      Alert.alert('Add funds', walletCard.line ?? negativeBalanceLine(aiPreviewQ.data?.wallet?.balance_paise ?? 0), [
+        { text: 'Build manually', onPress: () => chooseMode('manual') },
+        { text: 'Add money', onPress: () => go('wallet') },
+      ]);
+      return;
+    }
+    chooseMode('ai');
+  };
   const chooseMode = (m: PlanBuildMode) => {
     setMode(m);
     // An AI draft is a Strength Training plan (it covers the Strength and Cardio days).
     if (m === 'ai' && !modality) setModality('Strength Training');
@@ -359,8 +381,24 @@ export function CreatePlan() {
         /* server rejections (incl. "Plan locked") surface below */
       }
       return;
     }
+    // Team Wallet (3 Nov 2026): an AI plan is charged once, a fixed price, by the server when its rows land. Only a
+    // negative balance blocks (the owner's popup); a balance below the price does not.
+    const aiPlan = !!lastAi.current;
+    if (aiPlan && walletCard.state === 'negative') {
+      trackEvent('AI Plan Blocked Negative Wallet', { client_id: selectedClientId, balance_paise: aiPreviewQ.data?.wallet?.balance_paise ?? null, at: 'create' });
+      Alert.alert('Add funds', walletCard.line ?? negativeBalanceLine(aiPreviewQ.data?.wallet?.balance_paise ?? 0), [
+        { text: 'Keep editing', style: 'cancel' },
+        { text: 'Add money', onPress: () => go('wallet') },
+      ]);
+      return;
+    }
+    const finishWallet = (queued: boolean) => {
+      const line = createDoneLine(aiPreviewQ.data?.wallet ?? null, aiPlan, queued);
+      setWalletDone(line);
+      scheduleGoBack(line ? 2200 : 900);
+    };
     // planId is generated on-device so an offline retry can never duplicate the plan.
     const input: WorkoutPlanCreateInput = {
       trainerId,
       clientId: selectedClientId as string,
@@ -383,18 +421,18 @@ export function CreatePlan() {
     const finishOffline = async () => {
       await enqueueOutbox('create-plan', `${planName.trim()} · ${clientName}`, input);
       setSavedOffline(true);
       setDone(true);
-      scheduleGoBack();
+      finishWallet(true);
     };
     if (!getIsOnline()) {
       await finishOffline();
       return;
     }
     try {
       await createM.mutateAsync(input);
       setDone(true);
-      scheduleGoBack();
+      finishWallet(false);
     } catch (e: any) {
       if (/network request failed|network error|failed to fetch|fetch failed|timeout/i.test(String(e?.message))) {
         await finishOffline();
       }
@@ -499,30 +537,38 @@ export function CreatePlan() {
               <Serif style={{ fontSize: 24 }}>Create Plan</Serif>
               <Body style={{ fontSize: 12.5, color: C.muted, marginTop: 1 }}>How do you want to build {first}'s plan?</Body>
             </View>
           </View>
-          <Pressable onPress={() => chooseMode('ai')} disabled={!aiPick.enabled} hitSlop={6} accessibilityRole="button" accessibilityState={{ disabled: !aiPick.enabled }}
-            style={{ padding: 16, borderRadius: 20, backgroundColor: 'rgba(76,52,140,0.32)', borderWidth: 1, borderColor: hexA('#A78BFA', aiPick.enabled ? 0.55 : 0.25), opacity: aiPick.enabled ? 1 : 0.6, gap: 10 }}>
+          <Pressable onPress={chooseAi} disabled={!aiPick.enabled} hitSlop={6} accessibilityRole="button" accessibilityState={{ disabled: !aiPick.enabled }}
+            style={{ padding: 16, borderRadius: 20, backgroundColor: 'rgba(76,52,140,0.32)', borderWidth: 1, borderColor: hexA(walletCard.state === 'negative' ? C.red : '#A78BFA', aiPick.enabled ? 0.55 : 0.25), opacity: aiPick.enabled ? 1 : 0.6, gap: 10 }}>
             <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
               <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: hexA('#A78BFA', 0.16), borderWidth: 1, borderColor: hexA('#A78BFA', 0.45), alignItems: 'center', justifyContent: 'center' }}>
                 <Icon name="sparkle" size={19} color="#A78BFA" strokeWidth={2} />
               </View>
               <View style={{ flex: 1 }}>
-                <Text style={{ fontFamily: F.bodyBold, fontSize: 16, color: '#fff' }}>Generate with Odds AI</Text>
+                <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 7 }}>
+                  <Text style={{ fontFamily: F.bodyBold, fontSize: 16, color: '#fff' }}>AI generated</Text>
+                  {aiChip ? (
+                    <View style={{ paddingVertical: 2.5, paddingHorizontal: 8, borderRadius: 999, backgroundColor: hexA(aiChipColor, 0.14), borderWidth: 1, borderColor: hexA(aiChipColor, 0.45) }}>
+                      <Text style={{ fontFamily: F.bodyBold, fontSize: 9.5, color: aiChipColor }}>{aiChip.text}</Text>
+                    </View>
+                  ) : null}
+                </View>
                 <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 2, lineHeight: 16 }}>Drafts a Strength Training plan from the QHP, medical and blood reports. You edit everything before it goes for review.</Body>
               </View>
               <Icon name="chevRight" size={16} color="#A78BFA" strokeWidth={2.4} />
             </View>
             {aiPick.reason ? <Body style={{ fontSize: 11, color: C.gold }}>{aiPick.reason}</Body> : null}
+            {!aiPick.reason && walletCard.line ? <Body style={{ fontSize: 11, color: walletCard.state === 'negative' ? '#FF9B8F' : walletCard.state === 'ok' ? C.ink3 : C.gold }}>{walletCard.line}</Body> : null}
           </Pressable>
           <Pressable onPress={() => chooseMode('manual')} hitSlop={6} accessibilityRole="button"
             style={{ padding: 16, borderRadius: 20, backgroundColor: 'rgba(50,30,19,0.45)', borderWidth: 1, borderColor: hexA(C.orange, 0.4), gap: 10 }}>
             <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
               <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: hexA(C.orange, 0.14), borderWidth: 1, borderColor: hexA(C.orange, 0.4), alignItems: 'center', justifyContent: 'center' }}>
                 <Icon name="dumbbell" size={19} color={C.orange} strokeWidth={2} />
               </View>
               <View style={{ flex: 1 }}>
-                <Text style={{ fontFamily: F.bodyBold, fontSize: 16, color: '#fff' }}>Build it manually</Text>
+                <Text style={{ fontFamily: F.bodyBold, fontSize: 16, color: '#fff' }}>Manual plan</Text>
                 <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 2, lineHeight: 16 }}>The plan builder as it is today: modality, sections, exercises and sets.</Body>
               </View>
               <Icon name="chevRight" size={16} color={C.orange} strokeWidth={2.4} />
             </View>
@@ -909,9 +955,14 @@ export function CreatePlan() {
       </Page>
 
       {/* Sticky footer */}
       <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 18, paddingTop: 12, paddingBottom: insets.bottom + 14, backgroundColor: 'rgba(8,6,6,0.96)', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' }}>
-        {missingHint ? (
+        {done && walletDone ? (
+          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 9 }}>
+            <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: walletDone.tone === 'red' ? C.red : walletDone.tone === 'green' ? C.green : C.gold }} />
+            <Body style={{ flex: 1, fontSize: 11.5, color: walletDone.tone === 'red' ? '#FF9B8F' : walletDone.tone === 'green' ? C.green : C.muted2 }}>{walletDone.text}</Body>
+          </View>
+        ) : missingHint ? (
           <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 9 }}>
             <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: C.gold }} />
             <Body style={{ flex: 1, fontSize: 11.5, color: C.muted2 }}>{missingHint}</Body>
           </View>
@@ -934,9 +985,9 @@ export function CreatePlan() {
               <Icon name="checks" path={done ? 'M20 6 9 17l-5-5' : undefined} size={16} color="#fff" strokeWidth={2.6} />
               <Text style={{ fontFamily: F.bodyBold, fontSize: 14.5, color: '#fff' }}>
                 {busy ? (isEdit ? 'Saving…' : 'Creating…')
                   : done ? (savedOffline ? 'Saved on device ✓' : isEdit ? 'Resubmitted for review!' : 'Sent for review!')
-                  : isEdit ? 'Save & Resubmit' : 'Create Plan'}
+                  : isEdit ? 'Save & Resubmit' : createButtonLabel(aiPreviewQ.data?.wallet ?? null, aiApplied)}
               </Text>
             </LinearGradient>
           </Pressable>
         </View>
```

## 5. Server files for reference (nothing to build on iOS)

#### `supabase/migrations/20261102160000_team_wallet.sql`

```sql
-- ============================================================================
-- Team Wallet: one ledger table for every staff account (2 Nov 2026)
-- Owner: a wallet in every staff account; add money through Razorpay (whole rupees, minimum Rs 500, at most
-- Rs 5,000 per person per IST day); see the balance and the history; the wallet pays only for the Odds AI
-- workout plan (Rs 30 to Rs 50 by the client's data blocks, trainers only, the draft held until the one-tap
-- deduction); each person sees only their own rows. Plan: odds-app/docs/team-wallet-plan.md.
-- iOS / Android spec: odds-app/docs/ios-team-wallet-handoff.md.
--
-- 1. public.team_wallet: 12 columns, append-only. Signed amount_paise (credit > 0, debit < 0); seq (identity)
--    is the ledger order and the balance is the balance_after_paise of the user's highest paid seq (several rows
--    written in one transaction share a timestamp, so paid_at cannot order them). razorpay jsonb holds the
--    order / payment / signature / method / event / trimmed payment entity / refund id; meta jsonb holds the
--    note, reference, created_by, failure fields and, for an AI bill, draft_ref / client_id / client_name /
--    blocks / preview / draft.
-- 2. A trigger keeps a paid row fixed and the status moving one way: pending to paid / failed / expired /
--    cancelled, failed or expired to paid (a late success is real money).
-- 3. Functions, SECURITY DEFINER; every write runs under pg_advisory_xact_lock('team_wallet:<user>'):
--      readers (authenticated): get_my_team_wallet(limit, before), team_wallet_adjust (admin check inside)
--      service role only:        team_wallet_create_topup, team_wallet_set_order, team_wallet_mark_paid,
--                                team_wallet_mark_failed, team_wallet_refund, team_wallet_reverse,
--                                team_wallet_ai_plan_bill, team_wallet_ai_plan_gate, team_wallet_create_ai_bill,
--                                team_wallet_settle, team_wallet_discard, team_wallet_expire_pending (cron)
--    Refusals are 'CODE: sentence' (WALLET_MIN_AMOUNT, WALLET_DAILY_CAP, WALLET_PENDING_LIMIT, WALLET_FORBIDDEN,
--    WALLET_INSUFFICIENT, WALLET_CANCELLED, WALLET_DISCARD_LIMIT, WALLET_FLOOR, WALLET_BILL_PENDING,
--    WALLET_PAID_ROW_FIXED, WALLET_BAD_TRANSITION, WALLET_PAYMENT_REUSED, WALLET_NOT_FOUND); the apps show the
--    sentence after the colon.
-- 4. pg_cron team-wallet-expire every 15 minutes: pending top-ups older than 30 minutes expire; pending AI bills
--    older than 24 hours are cancelled (draft removed).
-- 5. A rolled-back probe (24 checks) on Sagar's profile; nothing is left behind.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.team_wallet (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq                 bigint GENERATED ALWAYS AS IDENTITY,              -- ledger order; the balance is the highest paid seq
  user_id             uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  role                text NOT NULL,                                   -- profiles.role when the row was made
  kind                text NOT NULL CHECK (kind IN ('topup', 'ai_plan', 'reversal', 'refund', 'adjustment')),
  amount_paise        bigint NOT NULL,                                  -- signed: credit > 0, debit < 0; 0 only for a free AI draft; always paise
  status              text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'paid', 'failed', 'expired', 'cancelled')),
  balance_after_paise bigint,                                          -- set when the row becomes paid
  razorpay            jsonb,                                           -- NULL for non-Razorpay rows
  meta                jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  paid_at             timestamptz,
  CONSTRAINT team_wallet_sign CHECK (
       (kind IN ('topup', 'reversal') AND amount_paise > 0)
    OR (kind = 'refund' AND amount_paise < 0)
    OR (kind = 'ai_plan' AND (amount_paise < 0 OR (amount_paise = 0 AND meta->>'free' = 'true')))   -- a free draft is a 0 row
    OR (kind = 'adjustment' AND amount_paise <> 0)),
  -- Rs 500 to Rs 5,000; exactly Rs 1 as a test top-up (owner, 2 Nov 2026)
  CONSTRAINT team_wallet_topup_limits CHECK (kind <> 'topup' OR amount_paise = 100 OR amount_paise BETWEEN 50000 AND 500000),
  CONSTRAINT team_wallet_paid_has_balance CHECK (status <> 'paid' OR balance_after_paise IS NOT NULL),
  CONSTRAINT team_wallet_json_shapes CHECK ((razorpay IS NULL OR jsonb_typeof(razorpay) = 'object') AND jsonb_typeof(meta) = 'object')
);
CREATE UNIQUE INDEX IF NOT EXISTS team_wallet_payment_uidx ON public.team_wallet ((razorpay->>'payment_id')) WHERE razorpay->>'payment_id' IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS team_wallet_order_uidx   ON public.team_wallet ((razorpay->>'order_id'))   WHERE razorpay->>'order_id'   IS NOT NULL;
CREATE INDEX IF NOT EXISTS team_wallet_user_idx    ON public.team_wallet (user_id, seq DESC);
CREATE INDEX IF NOT EXISTS team_wallet_pending_idx ON public.team_wallet (created_at) WHERE status = 'pending';
ALTER TABLE public.team_wallet ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.team_wallet FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.team_wallet TO authenticated;
GRANT ALL ON TABLE public.team_wallet TO service_role;
DROP POLICY IF EXISTS team_wallet_own_read ON public.team_wallet;
CREATE POLICY team_wallet_own_read ON public.team_wallet FOR SELECT TO authenticated USING (user_id = auth.uid());
-- no insert / update / delete policy: every write goes through the functions below (service role)
COMMENT ON TABLE public.team_wallet IS
  'Staff wallet ledger (2 Nov 2026): one row per movement of money, signed paise; balance = the user''s highest paid seq balance_after_paise. Writes only through the team_wallet_* functions.';
-- The app subscribes to its own rows while a top-up or a bill is pending (RLS scopes the stream).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'team_wallet') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.team_wallet;
  END IF;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'team_wallet: realtime publication not changed (%)', SQLERRM;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Rules: a paid row never changes; status moves one way
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.team_wallet_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.amount_paise <> OLD.amount_paise OR NEW.user_id <> OLD.user_id OR NEW.kind <> OLD.kind OR NEW.seq <> OLD.seq THEN
    RAISE EXCEPTION 'WALLET_PAID_ROW_FIXED: The amount, user and kind of a wallet row cannot be changed.';
  END IF;
  IF OLD.status = 'paid' THEN
    IF NEW.status <> 'paid' OR NEW.balance_after_paise IS DISTINCT FROM OLD.balance_after_paise
       OR NEW.paid_at IS DISTINCT FROM OLD.paid_at
       OR (NEW.razorpay->>'payment_id') IS DISTINCT FROM (OLD.razorpay->>'payment_id') THEN
      RAISE EXCEPTION 'WALLET_PAID_ROW_FIXED: A paid wallet row cannot be changed.';
    END IF;
    RETURN NEW;                                   -- only the Razorpay event / payment and meta notes may still be added
  END IF;
  IF NEW.status <> OLD.status THEN
    IF NOT ((OLD.status = 'pending' AND NEW.status IN ('paid', 'failed', 'expired', 'cancelled'))
         OR (OLD.status IN ('failed', 'expired') AND NEW.status = 'paid')) THEN
      RAISE EXCEPTION 'WALLET_BAD_TRANSITION: A wallet row cannot go from % to %.', OLD.status, NEW.status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_team_wallet_guard ON public.team_wallet;
CREATE TRIGGER trg_team_wallet_guard BEFORE UPDATE ON public.team_wallet FOR EACH ROW EXECUTE FUNCTION public.team_wallet_guard();

-- ---------------------------------------------------------------------------
-- 3. Config, the public row shape, the balance
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.team_wallet_daily_cap_paise()
RETURNS bigint LANGUAGE sql IMMUTABLE AS $$ SELECT 500000::bigint $$;   -- Rs 5,000 per person per IST day (owner)
CREATE OR REPLACE FUNCTION public.team_wallet_min_topup_paise()
RETURNS bigint LANGUAGE sql IMMUTABLE AS $$ SELECT 50000::bigint $$;    -- Rs 500 (owner)
CREATE OR REPLACE FUNCTION public.team_wallet_ai_floor_paise()
RETURNS bigint LANGUAGE sql IMMUTABLE AS $$ SELECT 5000::bigint $$;     -- Rs 50: the highest AI plan bill
GRANT EXECUTE ON FUNCTION public.team_wallet_daily_cap_paise(), public.team_wallet_min_topup_paise(), public.team_wallet_ai_floor_paise() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.team_wallet_lock(p_user uuid)
RETURNS void LANGUAGE sql AS $$ SELECT pg_advisory_xact_lock(hashtext('team_wallet:' || p_user::text)) $$;
REVOKE ALL ON FUNCTION public.team_wallet_lock(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_wallet_lock(uuid) TO service_role;

/** What the apps see of a row: never the signature, the payment entity or the held draft. */
CREATE OR REPLACE FUNCTION public.team_wallet_public(w public.team_wallet)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'id', w.id, 'seq', w.seq, 'user_id', w.user_id, 'role', w.role, 'kind', w.kind, 'amount_paise', w.amount_paise, 'status', w.status,
    'balance_after_paise', w.balance_after_paise, 'created_at', w.created_at, 'paid_at', w.paid_at,
    'razorpay', CASE WHEN w.razorpay IS NULL THEN NULL ELSE jsonb_strip_nulls(jsonb_build_object(
        'order_id', w.razorpay->>'order_id', 'payment_id', w.razorpay->>'payment_id', 'method', w.razorpay->>'method', 'refund_id', w.razorpay->>'refund_id')) END,
    'meta', w.meta - 'draft');
$$;
GRANT EXECUTE ON FUNCTION public.team_wallet_public(public.team_wallet) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.team_wallet_balance(p_user uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT w.balance_after_paise FROM public.team_wallet w
                    WHERE w.user_id = p_user AND w.status = 'paid'
                    ORDER BY w.seq DESC LIMIT 1), 0);
$$;
REVOKE ALL ON FUNCTION public.team_wallet_balance(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_wallet_balance(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. The AI plan bill: Rs 30 + Rs 5 per data block the draft read, at most Rs 50 (owner, 2 Nov 2026)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.team_wallet_ai_plan_bill(p_client uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_blocks text[] := '{}';
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  IF EXISTS (SELECT 1 FROM public.coach_assessment a WHERE a.client_id = p_client AND a.completed IS NOT NULL AND a.cancelled IS NULL) THEN v_blocks := v_blocks || 'qhp'::text; END IF;
  IF EXISTS (SELECT 1 FROM public.client_medical_history m WHERE m.client_id = p_client) THEN v_blocks := v_blocks || 'medical'::text; END IF;
  IF EXISTS (SELECT 1 FROM public.blood_report_markers b WHERE b.client_id = p_client) THEN v_blocks := v_blocks || 'blood'::text; END IF;
  IF EXISTS (SELECT 1 FROM public.client_health_summary s WHERE s.client_id = p_client AND s.context_summary IS NOT NULL AND s.briefing_date <= v_today) THEN v_blocks := v_blocks || 'context'::text; END IF;
  RETURN jsonb_build_object('bill_paise', LEAST(3000 + 500 * COALESCE(array_length(v_blocks, 1), 0), 5000), 'blocks', to_jsonb(v_blocks));
END;
$$;
CREATE OR REPLACE FUNCTION public.team_wallet_ai_plan_bill_paise(p_client uuid)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT (public.team_wallet_ai_plan_bill(p_client)->>'bill_paise')::bigint $$;
REVOKE ALL ON FUNCTION public.team_wallet_ai_plan_bill(uuid), public.team_wallet_ai_plan_bill_paise(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_wallet_ai_plan_bill(uuid), public.team_wallet_ai_plan_bill_paise(uuid) TO service_role;

-- Free AI drafts (owner, 2 Nov 2026 evening): a trainer's first 3 AI plans for NON-Essentials clients are free; from
-- the 4th the bill applies. Essentials clients' plans are always free and never count. "Used" = the free 0-rows this
-- ledger records from now on, plus the AI plans the trainer saved before the wallet existed (the registry's log:
-- workout_plan_exercises.source = 'ai', one per plan_id, non-Essentials clients, made before the cutover day).
CREATE OR REPLACE FUNCTION public.team_wallet_free_total()
RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT 3 $$;
CREATE OR REPLACE FUNCTION public.team_wallet_free_cutover()
RETURNS timestamptz LANGUAGE sql IMMUTABLE AS $$ SELECT '2026-11-03 00:00:00+05:30'::timestamptz $$;
CREATE OR REPLACE FUNCTION public.team_wallet_is_essentials(p_sub text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT COALESCE(regexp_replace(btrim(p_sub), '\s+', ' ', 'g') ~* '^(odds )?essentials?( by odds)?$', false) $$;
GRANT EXECUTE ON FUNCTION public.team_wallet_free_total(), public.team_wallet_free_cutover(), public.team_wallet_is_essentials(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.team_wallet_free_used(p_user uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (SELECT count(*)::integer FROM public.team_wallet w
           WHERE w.user_id = p_user AND w.kind = 'ai_plan' AND w.status = 'paid' AND w.meta->>'free' = 'true' AND COALESCE(w.meta->>'essentials', 'false') <> 'true')
       + (SELECT count(DISTINCT e.plan_id)::integer FROM public.workout_plan_exercises e
           JOIN public.clients c ON c.id = e.client_id
           WHERE e.trainer_id = p_user AND e.source = 'ai' AND e.plan_id IS NOT NULL
             AND e.created_at < public.team_wallet_free_cutover() AND NOT public.team_wallet_is_essentials(c.subscription_type));
$$;
REVOKE ALL ON FUNCTION public.team_wallet_free_used(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_wallet_free_used(uuid) TO service_role;

/** Before Generate: does this user pay (trainers only), the free drafts left, the balance, the waiting bill if any,
    whether THIS draft is free (Essentials client, or a free one left) and whether it may start. The preview and the
    draft call both ask. */
CREATE OR REPLACE FUNCTION public.team_wallet_ai_plan_gate(p_user uuid, p_essentials boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_charges boolean;
  v_bal bigint;
  v_used integer := 0;
  v_left integer := 0;
  v_free_this boolean;
  v_pending public.team_wallet;
  v_pending_json jsonb := NULL;
  v_reason text := NULL;
BEGIN
  SELECT p.role::text INTO v_role FROM public.profiles p WHERE p.id = p_user;
  v_charges := (v_role = 'trainer');
  v_bal := public.team_wallet_balance(p_user);
  IF v_charges THEN
    v_used := public.team_wallet_free_used(p_user);
    v_left := GREATEST(public.team_wallet_free_total() - v_used, 0);
  END IF;
  v_free_this := NOT v_charges OR COALESCE(p_essentials, false) OR v_left > 0;
  SELECT * INTO v_pending FROM public.team_wallet w
   WHERE w.user_id = p_user AND w.kind = 'ai_plan' AND w.status = 'pending' ORDER BY w.seq DESC LIMIT 1;
  IF v_pending.id IS NOT NULL THEN
    v_pending_json := jsonb_build_object('tx_id', v_pending.id, 'bill_paise', -v_pending.amount_paise,
      'client_id', v_pending.meta->>'client_id', 'client_name', v_pending.meta->>'client_name',
      'created_at', v_pending.created_at, 'preview', v_pending.meta->'preview');
  END IF;
  IF v_charges AND NOT v_free_this THEN
    IF v_pending.id IS NOT NULL THEN v_reason := 'WALLET_BILL_PENDING';
    ELSIF v_bal < public.team_wallet_ai_floor_paise() THEN v_reason := 'WALLET_FLOOR';
    END IF;
  END IF;
  RETURN jsonb_build_object('charges', v_charges, 'balance_paise', v_bal, 'floor_paise', public.team_wallet_ai_floor_paise(),
    'free_total', public.team_wallet_free_total(), 'free_used', v_used, 'free_left', v_left,
    'essentials', COALESCE(p_essentials, false), 'free_this', v_free_this, 'billed', v_charges AND NOT v_free_this,
    'pending_bill', v_pending_json, 'ok', v_reason IS NULL, 'reason', v_reason);
END;
$$;
REVOKE ALL ON FUNCTION public.team_wallet_ai_plan_gate(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_wallet_ai_plan_gate(uuid, boolean) TO service_role;

/** ai-plan-draft, after a free draft for a trainer: one paid 0-row so the count and the history show it. An Essentials
    draft is recorded too (meta.essentials true) but never counts. Answers the counts after it. */
CREATE OR REPLACE FUNCTION public.team_wallet_record_free_draft(p_user uuid, p_client uuid, p_client_name text, p_essentials boolean, p_draft_ref text, p_preview jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_row public.team_wallet;
  v_used integer;
BEGIN
  SELECT p.role::text INTO v_role FROM public.profiles p WHERE p.id = p_user;
  IF v_role IS DISTINCT FROM 'trainer' THEN RETURN jsonb_build_object('recorded', false, 'free_left', NULL); END IF;
  PERFORM public.team_wallet_lock(p_user);
  INSERT INTO public.team_wallet (user_id, role, kind, amount_paise, status, balance_after_paise, paid_at, meta)
  VALUES (p_user, v_role, 'ai_plan', 0, 'paid', public.team_wallet_balance(p_user), now(),
          jsonb_build_object('free', true, 'essentials', COALESCE(p_essentials, false), 'note', CASE WHEN COALESCE(p_essentials, false) THEN 'Odds AI plan, free for Essentials' ELSE 'Odds AI plan, free' END,
                             'created_by', p_user, 'draft_ref', p_draft_ref, 'client_id', p_client, 'client_name', p_client_name, 'preview', COALESCE(p_preview, '{}'::jsonb)))
  RETURNING * INTO v_row;
  v_used := public.team_wallet_free_used(p_user);
  RETURN jsonb_build_object('recorded', true, 'free_total', public.team_wallet_free_total(), 'free_used', v_used,
                            'free_left', GREATEST(public.team_wallet_free_total() - v_used, 0), 'row', public.team_wallet_public(v_row));
END;
$$;
REVOKE ALL ON FUNCTION public.team_wallet_record_free_draft(uuid, uuid, text, boolean, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_wallet_record_free_draft(uuid, uuid, text, boolean, text, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Top-ups (service role: the edge functions)
-- ---------------------------------------------------------------------------
/** The pending top-up row after the limit checks (whole rupees, min Rs 500, the day's cap, at most 2 pending).
    The edge function then creates the Razorpay order and stores it with team_wallet_set_order. */
CREATE OR REPLACE FUNCTION public.team_wallet_create_topup(p_user uuid, p_amount_paise bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_status text;
  v_day date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_today bigint;
  v_room bigint;
  v_pending integer;
  v_row public.team_wallet;
BEGIN
  SELECT p.role::text, lower(COALESCE(p.status, 'active')) INTO v_role, v_status FROM public.profiles p WHERE p.id = p_user;
  IF v_role IS NULL THEN RAISE EXCEPTION 'WALLET_FORBIDDEN: Only staff accounts have a wallet.' USING ERRCODE = '42501'; END IF;
  IF v_status <> 'active' THEN RAISE EXCEPTION 'WALLET_FORBIDDEN: This account is not active, so money cannot be added.' USING ERRCODE = '42501'; END IF;
  IF p_amount_paise IS NULL OR p_amount_paise % 100 <> 0 THEN RAISE EXCEPTION 'WALLET_MIN_AMOUNT: Enter whole rupees, at least Rs 500.'; END IF;
  -- Exactly Rs 1 is allowed as a test top-up for every account while the wallet is being tested (owner, 2 Nov 2026);
  -- tighten to admin / super_admin here when the testing is over.
  IF p_amount_paise < public.team_wallet_min_topup_paise() AND p_amount_paise <> 100 THEN
    RAISE EXCEPTION 'WALLET_MIN_AMOUNT: The minimum top-up is Rs 500.';
  END IF;
  PERFORM public.team_wallet_lock(p_user);
  -- older pending top-ups that ran out make room
  UPDATE public.team_wallet SET status = 'expired', meta = meta || jsonb_build_object('failure_reason', 'Payment was not completed in 30 minutes', 'failed_at', now())
   WHERE user_id = p_user AND kind = 'topup' AND status = 'pending' AND created_at < now() - interval '30 minutes';
  SELECT COALESCE(SUM(w.amount_paise), 0), count(*) FILTER (WHERE w.status = 'pending') INTO v_today, v_pending
    FROM public.team_wallet w
   WHERE w.user_id = p_user AND w.kind = 'topup' AND w.status IN ('pending', 'paid')
     AND (w.created_at AT TIME ZONE 'Asia/Kolkata')::date = v_day;
  v_room := public.team_wallet_daily_cap_paise() - v_today;
  IF v_room <= 0 THEN
    RAISE EXCEPTION 'WALLET_DAILY_CAP: You have added Rs % today. The limit is Rs % a day. Try again tomorrow.', (v_today / 100), (public.team_wallet_daily_cap_paise() / 100);
  END IF;
  IF p_amount_paise > v_room THEN
    RAISE EXCEPTION 'WALLET_DAILY_CAP: You can add Rs % more today. The limit is Rs % a day.', (v_room / 100), (public.team_wallet_daily_cap_paise() / 100);
  END IF;
  IF v_pending >= 2 THEN
    RAISE EXCEPTION 'WALLET_PENDING_LIMIT: Two top-ups are already waiting for payment. Finish or cancel one first.';
  END IF;
  INSERT INTO public.team_wallet (user_id, role, kind, amount_paise, status, meta)
  VALUES (p_user, v_role, 'topup', p_amount_paise, 'pending', jsonb_build_object('note', 'Add money', 'created_by', p_user))
  RETURNING * INTO v_row;
  RETURN public.team_wallet_public(v_row);
END;
$$;
REVOKE ALL ON FUNCTION public.team_wallet_create_topup(uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_wallet_create_topup(uuid, bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.team_wallet_set_order(p_tx uuid, p_order_id text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$ UPDATE public.team_wallet SET razorpay = COALESCE(razorpay, '{}'::jsonb) || jsonb_build_object('order_id', p_order_id)
       WHERE id = p_tx AND status = 'pending' AND razorpay->>'order_id' IS NULL $$;
REVOKE ALL ON FUNCTION public.team_wallet_set_order(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_wallet_set_order(uuid, text) TO service_role;

/** The one place a top-up becomes money. Idempotent: the app's verify call and the webhook both land here, in any
    order, any number of times; credited_now is true only for the call that made the transition (that caller sends
    the receipt push). failed or expired rows may still be paid (a late success is real money). */
CREATE OR REPLACE FUNCTION public.team_wallet_mark_paid(p_tx uuid, p_payment_id text, p_signature text, p_method text, p_payment jsonb, p_event text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.team_wallet;
  v_bal bigint;
BEGIN
  SELECT * INTO v_row FROM public.team_wallet WHERE id = p_tx;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'WALLET_NOT_FOUND: This top-up was not found.'; END IF;
  IF v_row.kind <> 'topup' THEN RAISE EXCEPTION 'WALLET_NOT_FOUND: This row is not a top-up.'; END IF;
  PERFORM public.team_wallet_lock(v_row.user_id);
  SELECT * INTO v_row FROM public.team_wallet WHERE id = p_tx;                      -- re-read under the lock
  IF v_row.status = 'paid' THEN
    IF p_event IS NOT NULL THEN
      UPDATE public.team_wallet SET razorpay = COALESCE(razorpay, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object('event', p_event, 'payment', p_payment)) WHERE id = p_tx RETURNING * INTO v_row;
    END IF;
    RETURN public.team_wallet_public(v_row) || jsonb_build_object('credited_now', false);
  END IF;
  IF v_row.status = 'cancelled' THEN RAISE EXCEPTION 'WALLET_CANCELLED: This top-up was cancelled.'; END IF;
  IF p_payment_id IS NULL OR p_payment_id = '' THEN RAISE EXCEPTION 'WALLET_NOT_FOUND: The payment id is missing.'; END IF;
  IF EXISTS (SELECT 1 FROM public.team_wallet w WHERE w.razorpay->>'payment_id' = p_payment_id AND w.id <> p_tx) THEN
    RAISE EXCEPTION 'WALLET_PAYMENT_REUSED: This payment is already on another wallet row.';
  END IF;
  v_bal := public.team_wallet_balance(v_row.user_id) + v_row.amount_paise;
  UPDATE public.team_wallet
     SET status = 'paid', paid_at = now(), balance_after_paise = v_bal,
         razorpay = COALESCE(razorpay, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
           'payment_id', p_payment_id, 'signature', p_signature, 'method', p_method, 'payment', p_payment, 'event', p_event)),
         meta = (meta - 'failed_at' - 'failure_reason') || jsonb_build_object('note', 'Add money')
   WHERE id = p_tx
   RETURNING * INTO v_row;
  RETURN public.team_wallet_public(v_row) || jsonb_build_object('credited_now', true);
END;
$$;
REVOKE ALL ON FUNCTION public.team_wallet_mark_paid(uuid, text, text, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_wallet_mark_paid(uuid, text, text, text, jsonb, text) TO service_role;

CREATE OR REPLACE FUNCTION public.team_wallet_mark_failed(p_tx uuid, p_reason text, p_payment jsonb, p_event text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.team_wallet;
BEGIN
  SELECT * INTO v_row FROM public.team_wallet WHERE id = p_tx;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'WALLET_NOT_FOUND: This top-up was not found.'; END IF;
  PERFORM public.team_wallet_lock(v_row.user_id);
  UPDATE public.team_wallet
     SET status = 'failed',
         meta = meta || jsonb_build_object('failed_at', now(), 'failure_reason', COALESCE(NULLIF(trim(p_reason), ''), 'Payment failed')),
         razorpay = COALESCE(razorpay, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object('payment', p_payment, 'event', p_event))
   WHERE id = p_tx AND status = 'pending'                                           -- never a paid row
   RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN SELECT * INTO v_row FROM public.team_wallet WHERE id = p_tx; END IF;
  RETURN public.team_wallet_public(v_row);
END;
$$;
REVOKE ALL ON FUNCTION public.team_wallet_mark_failed(uuid, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_wallet_mark_failed(uuid, text, jsonb, text) TO service_role;

/** A refund made in the Razorpay dashboard (webhook refund.processed): the money left the wallet. Once per refund.
    The balance may go negative here by design (finance sees it in the ledger). */
CREATE OR REPLACE FUNCTION public.team_wallet_refund(p_payment_id text, p_refund_id text, p_amount_paise bigint, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_topup public.team_wallet;
  v_row public.team_wallet;
BEGIN
  SELECT * INTO v_topup FROM public.team_wallet WHERE razorpay->>'payment_id' = p_payment_id AND status = 'paid';
  IF v_topup.id IS NULL THEN RAISE EXCEPTION 'WALLET_NOT_FOUND: No paid top-up for this payment.'; END IF;
  IF p_amount_paise IS NULL OR p_amount_paise <= 0 THEN RAISE EXCEPTION 'WALLET_NOT_FOUND: The refund amount is missing.'; END IF;
  PERFORM public.team_wallet_lock(v_topup.user_id);
  SELECT * INTO v_row FROM public.team_wallet WHERE kind = 'refund' AND razorpay->>'refund_id' = p_refund_id LIMIT 1;
  IF v_row.id IS NOT NULL THEN RETURN public.team_wallet_public(v_row) || jsonb_build_object('credited_now', false); END IF;
  INSERT INTO public.team_wallet (user_id, role, kind, amount_paise, status, balance_after_paise, razorpay, meta, paid_at)
  VALUES (v_topup.user_id, v_topup.role, 'refund', -p_amount_paise, 'paid',
          public.team_wallet_balance(v_topup.user_id) - p_amount_paise,
          jsonb_strip_nulls(jsonb_build_object('refund_id', p_refund_id, 'event', 'refund.processed', 'payment', p_payload)),
          jsonb_build_object('note', 'Refunded by Odds to your bank', 'reference', v_topup.id),
          now())
  RETURNING * INTO v_row;
  RETURN public.team_wallet_public(v_row) || jsonb_build_object('credited_now', true);
END;
$$;
REVOKE ALL ON FUNCTION public.team_wallet_refund(text, text, bigint, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_wallet_refund(text, text, bigint, jsonb) TO service_role;

/** Returns a paid charge (support use). Once per charged row: a second call returns the existing reversal. */
CREATE OR REPLACE FUNCTION public.team_wallet_reverse(p_tx uuid, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_charge public.team_wallet;
  v_row public.team_wallet;
BEGIN
  SELECT * INTO v_charge FROM public.team_wallet WHERE id = p_tx;
  IF v_charge.id IS NULL OR v_charge.amount_paise >= 0 OR v_charge.status <> 'paid' THEN
    RAISE EXCEPTION 'WALLET_NOT_FOUND: No paid charge to return.';
  END IF;
  PERFORM public.team_wallet_lock(v_charge.user_id);
  SELECT * INTO v_row FROM public.team_wallet WHERE kind = 'reversal' AND meta->>'reference' = p_tx::text LIMIT 1;
  IF v_row.id IS NOT NULL THEN RETURN public.team_wallet_public(v_row); END IF;
  INSERT INTO public.team_wallet (user_id, role, kind, amount_paise, status, balance_after_paise, meta, paid_at)
  VALUES (v_charge.user_id, v_charge.role, 'reversal', -v_charge.amount_paise, 'paid',
          public.team_wallet_balance(v_charge.user_id) - v_charge.amount_paise,
          jsonb_build_object('reference', p_tx, 'note', COALESCE(NULLIF(trim(p_note), ''), 'Returned')), now())
  RETURNING * INTO v_row;
  RETURN public.team_wallet_public(v_row);
END;
$$;
REVOKE ALL ON FUNCTION public.team_wallet_reverse(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_wallet_reverse(uuid, text) TO service_role;

/** Admin and super_admin only (the caller's own account): a signed correction with a mandatory note. */
CREATE OR REPLACE FUNCTION public.team_wallet_adjust(p_user uuid, p_amount_paise bigint, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_admin boolean;
  v_role text;
  v_row public.team_wallet;
BEGIN
  SELECT p.role::text IN ('admin', 'super_admin') INTO v_admin FROM public.profiles p WHERE p.id = v_uid;
  IF NOT COALESCE(v_admin, false) THEN RAISE EXCEPTION 'WALLET_FORBIDDEN: Only an admin can adjust a wallet.' USING ERRCODE = '42501'; END IF;
  IF p_amount_paise IS NULL OR p_amount_paise = 0 THEN RAISE EXCEPTION 'WALLET_NOT_FOUND: The amount cannot be zero.'; END IF;
  IF length(trim(COALESCE(p_note, ''))) < 10 THEN RAISE EXCEPTION 'WALLET_NOT_FOUND: Write why (at least 10 characters).'; END IF;
  SELECT p.role::text INTO v_role FROM public.profiles p WHERE p.id = p_user;
  IF v_role IS NULL THEN RAISE EXCEPTION 'WALLET_NOT_FOUND: This staff account was not found.'; END IF;
  PERFORM public.team_wallet_lock(p_user);
  INSERT INTO public.team_wallet (user_id, role, kind, amount_paise, status, balance_after_paise, meta, paid_at)
  VALUES (p_user, v_role, 'adjustment', p_amount_paise, 'paid', public.team_wallet_balance(p_user) + p_amount_paise,
          jsonb_build_object('note', trim(p_note), 'created_by', v_uid), now())
  RETURNING * INTO v_row;
  RETURN public.team_wallet_public(v_row);
END;
$$;
REVOKE ALL ON FUNCTION public.team_wallet_adjust(uuid, bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_wallet_adjust(uuid, bigint, text) TO authenticated, service_role;   -- the role check is inside

-- ---------------------------------------------------------------------------
-- 6. The AI plan bill: created after the draft, settled or discarded in one tap
-- ---------------------------------------------------------------------------
/** ai-plan-draft, after a successful draft for a trainer: ONE pending bill row holding the draft. Re-checks the
    gate under the lock (the preview check happened before the model ran). */
CREATE OR REPLACE FUNCTION public.team_wallet_create_ai_bill(p_user uuid, p_client uuid, p_client_name text, p_draft jsonb, p_draft_ref text, p_preview jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_gate jsonb;
  v_bill jsonb;
  v_row public.team_wallet;
BEGIN
  SELECT p.role::text INTO v_role FROM public.profiles p WHERE p.id = p_user;
  IF v_role IS DISTINCT FROM 'trainer' THEN RAISE EXCEPTION 'WALLET_FORBIDDEN: Only trainers are billed for AI plans.' USING ERRCODE = '42501'; END IF;
  IF p_draft IS NULL OR jsonb_typeof(p_draft) <> 'object' THEN RAISE EXCEPTION 'WALLET_NOT_FOUND: The draft is missing.'; END IF;
  PERFORM public.team_wallet_lock(p_user);
  v_gate := public.team_wallet_ai_plan_gate(p_user, (SELECT public.team_wallet_is_essentials(c.subscription_type) FROM public.clients c WHERE c.id = p_client));
  IF (v_gate->>'free_this')::boolean THEN RAISE EXCEPTION 'WALLET_FREE: This draft is free, nothing to bill.'; END IF;
  IF v_gate->>'reason' = 'WALLET_BILL_PENDING' THEN RAISE EXCEPTION 'WALLET_BILL_PENDING: Settle or discard your last draft first.'; END IF;
  IF v_gate->>'reason' = 'WALLET_FLOOR' THEN RAISE EXCEPTION 'WALLET_FLOOR: You need at least Rs 50 in your wallet to make an AI plan.'; END IF;
  v_bill := public.team_wallet_ai_plan_bill(p_client);
  INSERT INTO public.team_wallet (user_id, role, kind, amount_paise, status, meta)
  VALUES (p_user, v_role, 'ai_plan', -((v_bill->>'bill_paise')::bigint), 'pending',
          jsonb_build_object('note', 'Odds AI plan', 'created_by', p_user, 'draft_ref', p_draft_ref, 'client_id', p_client,
                             'client_name', p_client_name, 'blocks', v_bill->'blocks', 'preview', COALESCE(p_preview, '{}'::jsonb), 'draft', p_draft))
  RETURNING * INTO v_row;
  RETURN jsonb_build_object('tx_id', v_row.id, 'bill_paise', (v_bill->>'bill_paise')::bigint, 'blocks', v_bill->'blocks',
                            'balance_paise', (v_gate->>'balance_paise')::bigint, 'row', public.team_wallet_public(v_row));
END;
$$;
REVOKE ALL ON FUNCTION public.team_wallet_create_ai_bill(uuid, uuid, text, jsonb, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_wallet_create_ai_bill(uuid, uuid, text, jsonb, text, jsonb) TO service_role;

/** Deduct from wallet (one tap): the bill becomes paid and the held draft is returned. Idempotent: a paid bill
    returns its draft again (a lost answer must not lose a paid draft); a discarded or lapsed bill refuses. */
CREATE OR REPLACE FUNCTION public.team_wallet_settle(p_tx uuid, p_user uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.team_wallet;
  v_bal bigint;
  v_bill bigint;
BEGIN
  SELECT * INTO v_row FROM public.team_wallet WHERE id = p_tx AND user_id = p_user AND kind = 'ai_plan';
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'WALLET_NOT_FOUND: This bill was not found.'; END IF;
  PERFORM public.team_wallet_lock(p_user);
  SELECT * INTO v_row FROM public.team_wallet WHERE id = p_tx;
  IF v_row.status = 'paid' THEN
    RETURN jsonb_build_object('ok', true, 'already', true, 'draft', v_row.meta->'draft', 'balance_paise', public.team_wallet_balance(p_user), 'row', public.team_wallet_public(v_row));
  END IF;
  IF v_row.status <> 'pending' THEN RAISE EXCEPTION 'WALLET_CANCELLED: This draft was discarded.'; END IF;
  v_bal := public.team_wallet_balance(p_user);
  v_bill := -v_row.amount_paise;
  IF v_bal < v_bill THEN
    RAISE EXCEPTION 'WALLET_INSUFFICIENT: Your wallet has Rs %. This needs Rs %. Add money in Wallet.', (v_bal / 100), (v_bill / 100);
  END IF;
  UPDATE public.team_wallet SET status = 'paid', paid_at = now(), balance_after_paise = v_bal - v_bill
   WHERE id = p_tx RETURNING * INTO v_row;
  RETURN jsonb_build_object('ok', true, 'already', false, 'draft', v_row.meta->'draft', 'balance_paise', v_bal - v_bill, 'row', public.team_wallet_public(v_row));
END;
$$;
REVOKE ALL ON FUNCTION public.team_wallet_settle(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_wallet_settle(uuid, uuid) TO service_role;

/** Discard: the bill is cancelled, the draft removed, nothing charged. At most 3 discards per trainer per IST day. */
CREATE OR REPLACE FUNCTION public.team_wallet_discard(p_tx uuid, p_user uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.team_wallet;
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_n integer;
BEGIN
  SELECT * INTO v_row FROM public.team_wallet WHERE id = p_tx AND user_id = p_user AND kind = 'ai_plan';
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'WALLET_NOT_FOUND: This bill was not found.'; END IF;
  PERFORM public.team_wallet_lock(p_user);
  SELECT * INTO v_row FROM public.team_wallet WHERE id = p_tx;
  IF v_row.status = 'cancelled' THEN RETURN jsonb_build_object('ok', true, 'already', true); END IF;
  IF v_row.status = 'paid' THEN RAISE EXCEPTION 'WALLET_PAID_ROW_FIXED: This bill is already paid.'; END IF;
  SELECT count(*) INTO v_n FROM public.team_wallet w
   WHERE w.user_id = p_user AND w.kind = 'ai_plan' AND w.status = 'cancelled' AND w.meta->>'cancel_reason' = 'discarded'
     AND ((w.meta->>'cancelled_at')::timestamptz AT TIME ZONE 'Asia/Kolkata')::date = v_today;
  IF v_n >= 3 THEN RAISE EXCEPTION 'WALLET_DISCARD_LIMIT: You have discarded 3 drafts today. Try again tomorrow.'; END IF;
  UPDATE public.team_wallet SET status = 'cancelled', meta = (meta - 'draft') || jsonb_build_object('cancel_reason', 'discarded', 'cancelled_at', now())
   WHERE id = p_tx RETURNING * INTO v_row;
  RETURN jsonb_build_object('ok', true, 'already', false, 'row', public.team_wallet_public(v_row));
END;
$$;
REVOKE ALL ON FUNCTION public.team_wallet_discard(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_wallet_discard(uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 7. The sweep (cron every 15 minutes)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.team_wallet_expire_pending()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_topups integer; v_bills integer;
BEGIN
  UPDATE public.team_wallet SET status = 'expired', meta = meta || jsonb_build_object('failure_reason', 'Payment was not completed in 30 minutes', 'failed_at', now())
   WHERE kind = 'topup' AND status = 'pending' AND created_at < now() - interval '30 minutes';
  GET DIAGNOSTICS v_topups = ROW_COUNT;
  UPDATE public.team_wallet SET status = 'cancelled', meta = (meta - 'draft') || jsonb_build_object('cancel_reason', 'expired', 'cancelled_at', now())
   WHERE kind = 'ai_plan' AND status = 'pending' AND created_at < now() - interval '24 hours';
  GET DIAGNOSTICS v_bills = ROW_COUNT;
  RETURN jsonb_build_object('topups_expired', v_topups, 'bills_cancelled', v_bills);
END;
$$;
REVOKE ALL ON FUNCTION public.team_wallet_expire_pending() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_wallet_expire_pending() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'team-wallet-expire') THEN PERFORM cron.unschedule('team-wallet-expire'); END IF;
END $$;
SELECT cron.schedule('team-wallet-expire', '*/15 * * * *', $$SELECT public.team_wallet_expire_pending();$$);

-- ---------------------------------------------------------------------------
-- 8. The app's read (authenticated, own rows)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_team_wallet(p_limit integer DEFAULT 50, p_before timestamptz DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_day date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_today bigint;
  v_gate jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'WALLET_SIGN_IN: Sign in to see your wallet.' USING ERRCODE = '42501'; END IF;
  SELECT COALESCE(SUM(w.amount_paise), 0) INTO v_today FROM public.team_wallet w
   WHERE w.user_id = v_uid AND w.kind = 'topup' AND w.status IN ('pending', 'paid')
     AND (w.created_at AT TIME ZONE 'Asia/Kolkata')::date = v_day;
  v_gate := public.team_wallet_ai_plan_gate(v_uid);
  RETURN jsonb_build_object(
    'balance_paise', public.team_wallet_balance(v_uid),
    'today_topup_paise', v_today,
    'today_room_paise', GREATEST(public.team_wallet_daily_cap_paise() - v_today, 0),
    'min_topup_paise', public.team_wallet_min_topup_paise(),
    'daily_cap_paise', public.team_wallet_daily_cap_paise(),
    'ai_bill_min_paise', 3000,
    'ai_bill_max_paise', 5000,
    'ai_floor_paise', public.team_wallet_ai_floor_paise(),
    'charges_ai', v_gate->'charges',
    'free_total', v_gate->'free_total',
    'free_used', v_gate->'free_used',
    'free_left', v_gate->'free_left',
    'pending_bill', v_gate->'pending_bill',
    'rows', COALESCE((SELECT jsonb_agg(public.team_wallet_public(w) ORDER BY w.seq DESC)
      FROM (SELECT * FROM public.team_wallet w2 WHERE w2.user_id = v_uid AND (p_before IS NULL OR w2.created_at < p_before)
             ORDER BY w2.seq DESC LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))) w), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_team_wallet(integer, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_team_wallet(integer, timestamptz) TO authenticated, service_role;

COMMIT;

-- ---------------------------------------------------------------------------
-- Probe: Sagar's profile and the first client with data, inside a block that is always rolled back. 24 checks.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE IF NOT EXISTS team_wallet_probe (step int, check_name text, expected text, result text);
TRUNCATE team_wallet_probe;

DO $probe$
DECLARE
  v_user uuid; v_admin uuid; v_client uuid; v_client_name text;
  t1 jsonb; t2 jsonb; t3 jsonb; x jsonb; b1 jsonb; b2 jsonb; s1 jsonb; g jsonb;
  v_res text; v_j jsonb; v_bill bigint; v_blocks int; v_bal bigint; v_free0 int; v_n int;
  v_names text[] := '{}'; v_expected text[] := '{}'; v_results text[] := '{}';
BEGIN
  SELECT p.id INTO v_user FROM public.profiles p WHERE p.role::text = 'trainer' AND p.email = 'sagaroddsfitness@gmail.com' LIMIT 1;
  IF v_user IS NULL THEN SELECT p.id INTO v_user FROM public.profiles p WHERE p.role::text = 'trainer' AND lower(COALESCE(p.status, 'active')) = 'active' LIMIT 1; END IF;
  SELECT p.id INTO v_admin FROM public.profiles p WHERE p.role::text IN ('admin', 'super_admin') LIMIT 1;
  SELECT c.id, COALESCE(c.first_name, 'Client') INTO v_client, v_client_name FROM public.clients c ORDER BY c.created_at DESC NULLS LAST LIMIT 1;
  BEGIN
    -- 1. a Rs 2,000 top-up: pending, then paid; verify and webhook both call, credited once
    t1 := public.team_wallet_create_topup(v_user, 200000);
    PERFORM public.team_wallet_set_order((t1->>'id')::uuid, 'order_probe_1');
    v_names := array_append(v_names, 'top-up Rs 2,000 created'); v_expected := array_append(v_expected, 'pending, order set');
    v_results := array_append(v_results, (SELECT status || ', ' || CASE WHEN razorpay->>'order_id' = 'order_probe_1' THEN 'order set' ELSE 'no order' END FROM public.team_wallet WHERE id = (t1->>'id')::uuid));
    x := public.team_wallet_mark_paid((t1->>'id')::uuid, 'pay_probe_1', 'sig', 'upi', '{"id":"pay_probe_1","status":"captured"}'::jsonb, 'app_verify');
    v_res := (x->>'credited_now');
    x := public.team_wallet_mark_paid((t1->>'id')::uuid, 'pay_probe_1', NULL, 'upi', NULL, 'payment.captured');   -- the webhook, later
    v_names := array_append(v_names, 'paid once: verify credits, webhook does not'); v_expected := array_append(v_expected, 'true then false, paid, balance 2000, 1 row');
    v_results := array_append(v_results, v_res || ' then ' || (x->>'credited_now') || ', ' || (x->>'status') || ', balance ' || (public.team_wallet_balance(v_user) / 100) || ', ' || (SELECT count(*) FROM public.team_wallet WHERE razorpay->>'payment_id' = 'pay_probe_1') || ' row');
    v_names := array_append(v_names, 'public row hides the signature'); v_expected := array_append(v_expected, 'no signature, method upi');
    v_results := array_append(v_results, CASE WHEN x->'razorpay' ? 'signature' THEN 'signature leaked' ELSE 'no signature' END || ', method ' || (x->'razorpay'->>'method'));

    -- 2. the day's cap: Rs 3,500 more would pass Rs 5,000
    BEGIN t2 := public.team_wallet_create_topup(v_user, 350000); v_res := 'allowed'; EXCEPTION WHEN others THEN v_res := SQLERRM; END;
    v_names := array_append(v_names, 'Rs 3,500 more today (cap Rs 5,000)'); v_expected := array_append(v_expected, 'WALLET_DAILY_CAP: You can add Rs 3000 more today. The limit is Rs 5000 a day.');
    v_results := array_append(v_results, v_res);

    -- 3. below the minimum, and paise
    BEGIN t2 := public.team_wallet_create_topup(v_user, 40000); v_res := 'allowed'; EXCEPTION WHEN others THEN v_res := SQLERRM; END;
    v_names := array_append(v_names, 'Rs 400'); v_expected := array_append(v_expected, 'WALLET_MIN_AMOUNT: The minimum top-up is Rs 500.');
    v_results := array_append(v_results, v_res);
    BEGIN t2 := public.team_wallet_create_topup(v_user, 50050); v_res := 'allowed'; EXCEPTION WHEN others THEN v_res := SQLERRM; END;
    v_names := array_append(v_names, 'Rs 500.50'); v_expected := array_append(v_expected, 'WALLET_MIN_AMOUNT: Enter whole rupees, at least Rs 500.');
    v_results := array_append(v_results, v_res);

    -- 4. at most two pending top-ups
    t2 := public.team_wallet_create_topup(v_user, 50000);
    t3 := public.team_wallet_create_topup(v_user, 50000);
    BEGIN x := public.team_wallet_create_topup(v_user, 50000); v_res := 'allowed'; EXCEPTION WHEN others THEN v_res := SQLERRM; END;
    v_names := array_append(v_names, 'a third pending top-up'); v_expected := array_append(v_expected, 'WALLET_PENDING_LIMIT: Two top-ups are already waiting for payment. Finish or cancel one first.');
    v_results := array_append(v_results, v_res);

    -- 5. the sweep expires them after 30 minutes; a late payment still credits one (expired to paid)
    UPDATE public.team_wallet SET created_at = now() - interval '31 minutes' WHERE id IN ((t2->>'id')::uuid, (t3->>'id')::uuid);
    x := public.team_wallet_expire_pending();
    v_res := (x->>'topups_expired');
    x := public.team_wallet_mark_paid((t2->>'id')::uuid, 'pay_probe_2', NULL, 'card', NULL, 'payment.captured');
    v_names := array_append(v_names, 'sweep expires 2, one paid late'); v_expected := array_append(v_expected, '2 expired, paid, balance 2500');
    v_results := array_append(v_results, v_res || ' expired, ' || (x->>'status') || ', balance ' || (public.team_wallet_balance(v_user) / 100));

    -- 6. failed, then a late success on the same order
    t3 := public.team_wallet_create_topup(v_user, 100000);
    x := public.team_wallet_mark_failed((t3->>'id')::uuid, 'Bank declined', NULL, 'payment.failed');
    v_res := (x->>'status');
    x := public.team_wallet_mark_paid((t3->>'id')::uuid, 'pay_probe_3', NULL, 'netbanking', NULL, 'payment.captured');
    v_names := array_append(v_names, 'failed then paid late'); v_expected := array_append(v_expected, 'failed then paid, balance 3500');
    v_results := array_append(v_results, v_res || ' then ' || (x->>'status') || ', balance ' || (public.team_wallet_balance(v_user) / 100));

    -- 7. a paid row cannot be changed; a payment id cannot be reused
    BEGIN UPDATE public.team_wallet SET amount_paise = 1 WHERE id = (t1->>'id')::uuid; v_res := 'changed'; EXCEPTION WHEN others THEN v_res := SQLERRM; END;
    v_names := array_append(v_names, 'edit a paid row'); v_expected := array_append(v_expected, 'WALLET_PAID_ROW_FIXED: The amount, user and kind of a wallet row cannot be changed.');
    v_results := array_append(v_results, v_res);
    t2 := public.team_wallet_create_topup(v_user, 50000);
    BEGIN x := public.team_wallet_mark_paid((t2->>'id')::uuid, 'pay_probe_1', NULL, NULL, NULL, NULL); v_res := 'allowed'; EXCEPTION WHEN others THEN v_res := SQLERRM; END;
    v_names := array_append(v_names, 'reuse a payment id'); v_expected := array_append(v_expected, 'WALLET_PAYMENT_REUSED: This payment is already on another wallet row.');
    v_results := array_append(v_results, v_res);

    -- 8. the free drafts: 3 per trainer for non-Essentials clients (the registry's old AI plans count), Essentials never counts
    g := public.team_wallet_ai_plan_gate(v_user, false);
    v_free0 := (g->>'free_used')::int;
    v_names := array_append(v_names, 'gate: free drafts read from the ledger + the plan registry'); v_expected := array_append(v_expected, 'charges true, left = 3 - used, free_this when any left');
    v_results := array_append(v_results, CASE WHEN (g->>'charges')::boolean AND (g->>'free_left')::int = GREATEST(3 - v_free0, 0) AND (g->>'free_this')::boolean = ((g->>'free_left')::int > 0) THEN 'charges true, left = 3 - used, free_this when any left' ELSE 'got ' || g::text END);
    x := public.team_wallet_record_free_draft(v_user, v_client, v_client_name, true, 'probe-ess', NULL);
    v_names := array_append(v_names, 'an Essentials draft is recorded but never counts'); v_expected := array_append(v_expected, 'recorded, used unchanged, balance unchanged');
    v_results := array_append(v_results, CASE WHEN (x->>'recorded')::boolean AND (x->>'free_used')::int = v_free0 AND public.team_wallet_balance(v_user) = 350000 THEN 'recorded, used unchanged, balance unchanged' ELSE 'got ' || x::text END);
    v_n := 0;
    WHILE (public.team_wallet_ai_plan_gate(v_user, false)->>'free_left')::int > 0 AND v_n < 5 LOOP
      x := public.team_wallet_record_free_draft(v_user, v_client, v_client_name, false, 'probe-free-' || v_n, NULL); v_n := v_n + 1;
    END LOOP;
    g := public.team_wallet_ai_plan_gate(v_user, false);
    v_names := array_append(v_names, 'free drafts used up one by one, then billed'); v_expected := array_append(v_expected, 'used ' || GREATEST(3 - v_free0, 0) || ', left 0, billed true, ok true (Rs 3500)');
    v_results := array_append(v_results, 'used ' || v_n || ', left ' || (g->>'free_left') || ', billed ' || (g->>'billed') || ', ok ' || (g->>'ok') || ' (Rs ' || ((g->>'balance_paise')::bigint / 100) || ')');
    g := public.team_wallet_ai_plan_gate(v_user, true);
    v_names := array_append(v_names, 'an Essentials client stays free after the 3'); v_expected := array_append(v_expected, 'free_this true, billed false');
    v_results := array_append(v_results, 'free_this ' || (g->>'free_this') || ', billed ' || (g->>'billed'));
    v_names := array_append(v_names, 'gate: trainer with Rs 3,500 may generate'); v_expected := array_append(v_expected, 'charges true, ok true');
    v_results := array_append(v_results, 'charges ' || (g->>'charges') || ', ok ' || (g->>'ok'));
    v_j := public.team_wallet_ai_plan_bill(v_client);
    v_bill := (v_j->>'bill_paise')::bigint; v_blocks := jsonb_array_length(v_j->'blocks');
    v_names := array_append(v_names, 'bill = Rs 30 + Rs 5 per block, at most Rs 50'); v_expected := array_append(v_expected, 'yes');
    v_results := array_append(v_results, CASE WHEN v_bill = LEAST(3000 + 500 * v_blocks, 5000) AND v_bill BETWEEN 3000 AND 5000 THEN 'yes' ELSE 'no: ' || v_bill || ' for ' || v_blocks || ' blocks' END);
    b1 := public.team_wallet_create_ai_bill(v_user, v_client, v_client_name, '{"draft":{"plan_name":"probe","sections":[]}}'::jsonb, 'probe-1', '{"sections":["Push"],"exercise_count":9}'::jsonb);
    g := public.team_wallet_ai_plan_gate(v_user);
    v_names := array_append(v_names, 'bill pending blocks a new draft'); v_expected := array_append(v_expected, 'pending, reason WALLET_BILL_PENDING, tx matches');
    v_results := array_append(v_results, (b1->'row'->>'status') || ', reason ' || COALESCE(g->>'reason', 'none') || ', ' || CASE WHEN g->'pending_bill'->>'tx_id' = b1->>'tx_id' THEN 'tx matches' ELSE 'tx differs' END);
    BEGIN x := public.team_wallet_create_ai_bill(v_user, v_client, v_client_name, '{"draft":{}}'::jsonb, 'probe-2', NULL); v_res := 'allowed'; EXCEPTION WHEN others THEN v_res := SQLERRM; END;
    v_names := array_append(v_names, 'second Generate while a bill waits'); v_expected := array_append(v_expected, 'WALLET_BILL_PENDING: Settle or discard your last draft first.');
    v_results := array_append(v_results, v_res);

    -- 9. deduct: paid, the draft comes back, twice
    v_bal := public.team_wallet_balance(v_user);
    s1 := public.team_wallet_settle((b1->>'tx_id')::uuid, v_user);
    x := public.team_wallet_settle((b1->>'tx_id')::uuid, v_user);
    v_names := array_append(v_names, 'deduct once, draft returned both times'); v_expected := array_append(v_expected, 'balance drops by the bill, draft probe, again draft probe');
    v_results := array_append(v_results, CASE WHEN (s1->>'balance_paise')::bigint = v_bal - v_bill AND public.team_wallet_balance(v_user) = v_bal - v_bill THEN 'balance drops by the bill' ELSE 'balance wrong' END
      || ', draft ' || COALESCE(s1->'draft'->'draft'->>'plan_name', 'missing') || ', again draft ' || COALESCE(x->'draft'->'draft'->>'plan_name', 'missing') || CASE WHEN (x->>'already')::boolean THEN '' ELSE ' (not flagged already)' END);
    PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
    v_j := public.get_my_team_wallet(5, NULL);
    PERFORM set_config('request.jwt.claim.sub', '', true);
    v_names := array_append(v_names, 'the app read never carries the draft'); v_expected := array_append(v_expected, 'no draft, charges_ai true, 5 rows');
    v_results := array_append(v_results, CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_j->'rows') r WHERE r->'meta' ? 'draft') THEN 'draft leaked' ELSE 'no draft' END || ', charges_ai ' || (v_j->>'charges_ai') || ', ' || jsonb_array_length(v_j->'rows') || ' rows');

    -- 10. discard: cancelled, nothing charged; a settle after it refuses; three a day
    b2 := public.team_wallet_create_ai_bill(v_user, v_client, v_client_name, '{"draft":{}}'::jsonb, 'probe-3', NULL);
    x := public.team_wallet_discard((b2->>'tx_id')::uuid, v_user);
    v_res := (x->'row'->>'status') || ', balance ' || (public.team_wallet_balance(v_user) / 100);
    BEGIN x := public.team_wallet_settle((b2->>'tx_id')::uuid, v_user); v_res := v_res || ', settled'; EXCEPTION WHEN others THEN v_res := v_res || ', ' || SQLERRM; END;
    v_names := array_append(v_names, 'discard, then settle the discarded bill'); v_expected := array_append(v_expected, 'cancelled, balance ' || ((v_bal - v_bill) / 100) || ', WALLET_CANCELLED: This draft was discarded.');
    v_results := array_append(v_results, v_res);
    b2 := public.team_wallet_create_ai_bill(v_user, v_client, v_client_name, '{"draft":{}}'::jsonb, 'probe-4', NULL); x := public.team_wallet_discard((b2->>'tx_id')::uuid, v_user);
    b2 := public.team_wallet_create_ai_bill(v_user, v_client, v_client_name, '{"draft":{}}'::jsonb, 'probe-5', NULL); x := public.team_wallet_discard((b2->>'tx_id')::uuid, v_user);
    b2 := public.team_wallet_create_ai_bill(v_user, v_client, v_client_name, '{"draft":{}}'::jsonb, 'probe-6', NULL);
    BEGIN x := public.team_wallet_discard((b2->>'tx_id')::uuid, v_user); v_res := 'allowed'; EXCEPTION WHEN others THEN v_res := SQLERRM; END;
    v_names := array_append(v_names, 'a fourth discard today'); v_expected := array_append(v_expected, 'WALLET_DISCARD_LIMIT: You have discarded 3 drafts today. Try again tomorrow.');
    v_results := array_append(v_results, v_res);

    -- 11. a bill the balance cannot cover (an admin took the money out in between), then the sweep cancels it after a day
    PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
    BEGIN x := public.team_wallet_adjust(v_user, 10000, 'probe: a trainer may not adjust'); v_res := 'allowed'; EXCEPTION WHEN others THEN v_res := SQLERRM; END;
    v_names := array_append(v_names, 'trainer adjusts'); v_expected := array_append(v_expected, 'WALLET_FORBIDDEN: Only an admin can adjust a wallet.');
    v_results := array_append(v_results, v_res);
    IF v_admin IS NOT NULL THEN
      PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
      x := public.team_wallet_adjust(v_user, -(public.team_wallet_balance(v_user) - 1000), 'probe: leave Rs 10 in the wallet');
      PERFORM set_config('request.jwt.claim.sub', '', true);
      BEGIN x := public.team_wallet_settle((b2->>'tx_id')::uuid, v_user); v_res := 'allowed'; EXCEPTION WHEN others THEN v_res := SQLERRM; END;
      v_names := array_append(v_names, 'deduct with Rs 10 in the wallet'); v_expected := array_append(v_expected, 'WALLET_INSUFFICIENT: Your wallet has Rs 10. This needs Rs ' || (v_bill / 100) || '. Add money in Wallet.');
      v_results := array_append(v_results, v_res);
    END IF;
    PERFORM set_config('request.jwt.claim.sub', '', true);
    UPDATE public.team_wallet SET created_at = now() - interval '25 hours' WHERE id = (b2->>'tx_id')::uuid;
    x := public.team_wallet_expire_pending();
    v_names := array_append(v_names, 'sweep cancels a day-old bill, draft removed'); v_expected := array_append(v_expected, '1 cancelled, expired, no draft');
    v_results := array_append(v_results, (x->>'bills_cancelled') || ' cancelled, ' || (SELECT (meta->>'cancel_reason') || ', ' || CASE WHEN meta ? 'draft' THEN 'draft kept' ELSE 'no draft' END FROM public.team_wallet WHERE id = (b2->>'tx_id')::uuid));

    -- 12. a Razorpay dashboard refund of the first top-up, recorded once
    v_bal := public.team_wallet_balance(v_user);
    x := public.team_wallet_refund('pay_probe_1', 'rfnd_probe', 200000, '{"id":"rfnd_probe"}'::jsonb);
    x := public.team_wallet_refund('pay_probe_1', 'rfnd_probe', 200000, NULL);
    v_names := array_append(v_names, 'dashboard refund, once'); v_expected := array_append(v_expected, 'balance ' || ((v_bal - 200000) / 100) || ', 1 refund row');
    v_results := array_append(v_results, 'balance ' || (public.team_wallet_balance(v_user) / 100) || ', ' || (SELECT count(*) FROM public.team_wallet WHERE kind = 'refund' AND razorpay->>'refund_id' = 'rfnd_probe') || ' refund row');

    -- 13. Rs 1 test top-up: any account; Rs 2 still refused
    BEGIN x := public.team_wallet_create_topup(v_user, 100); v_res := (x->>'status') || ', ' || (x->>'amount_paise'); EXCEPTION WHEN others THEN v_res := SQLERRM; END;
    v_names := array_append(v_names, 'trainer adds Rs 1 (test top-up)'); v_expected := array_append(v_expected, 'pending, 100');
    v_results := array_append(v_results, v_res);
    BEGIN x := public.team_wallet_create_topup(v_user, 200); v_res := 'allowed'; EXCEPTION WHEN others THEN v_res := SQLERRM; END;
    v_names := array_append(v_names, 'trainer adds Rs 2'); v_expected := array_append(v_expected, 'WALLET_MIN_AMOUNT: The minimum top-up is Rs 500.');
    v_results := array_append(v_results, v_res);
    IF v_admin IS NOT NULL THEN
      BEGIN x := public.team_wallet_create_topup(v_admin, 100); v_res := (x->>'status') || ', ' || (x->>'amount_paise'); EXCEPTION WHEN others THEN v_res := SQLERRM; END;
      v_names := array_append(v_names, 'admin adds Rs 1 (test top-up)'); v_expected := array_append(v_expected, 'pending, 100');
      v_results := array_append(v_results, v_res);
    END IF;

    -- 14. anon cannot read
    PERFORM set_config('request.jwt.claim.sub', '', true);
    BEGIN v_j := public.get_my_team_wallet(5, NULL); v_res := 'allowed'; EXCEPTION WHEN others THEN v_res := SQLERRM; END;
    v_names := array_append(v_names, 'get_my_team_wallet without a user'); v_expected := array_append(v_expected, 'WALLET_SIGN_IN: Sign in to see your wallet.');
    v_results := array_append(v_results, v_res);

    RAISE EXCEPTION 'PROBE_DONE';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'PROBE_DONE' THEN
      v_names := array_append(v_names, 'probe stopped'); v_expected := array_append(v_expected, 'ran'); v_results := array_append(v_results, 'could not run: ' || SQLERRM);
    END IF;
  END;
  INSERT INTO team_wallet_probe (step, check_name, expected, result)
  SELECT n, v_names[n], v_expected[n], v_results[n] FROM generate_subscripts(v_names, 1) AS n;
END
$probe$;

INSERT INTO team_wallet_probe (step, check_name, expected, result)
SELECT 30, 'cron team-wallet-expire every 15 minutes', 'yes', CASE WHEN EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'team-wallet-expire') THEN 'yes' ELSE 'NO' END
UNION ALL
SELECT 31, 'team_wallet in the realtime publication', 'yes', CASE WHEN EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'team_wallet') THEN 'yes' ELSE 'NO' END
UNION ALL
SELECT 32, 'probe rows left behind', '0', (SELECT count(*)::text FROM public.team_wallet WHERE razorpay->>'order_id' LIKE 'order_probe_%' OR meta->>'draft_ref' LIKE 'probe-%' OR amount_paise = 100);

SELECT step, check_name, expected, result FROM team_wallet_probe ORDER BY step;
```

#### `supabase/migrations/20261103110000_ai_plan_auto_charge.sql`

```sql
-- ============================================================================
-- Team Wallet: the Odds AI plan is charged automatically after the draft; the balance may go negative (3 Nov 2026)
-- Owner (3 Nov 2026, replacing the 2 Nov "bill sheet with Deduct"): deduct AFTER the draft is made, automatically, no
-- Deduct tap, the draft always lands; the balance may go negative (Rs 28 wallet, Rs 33 plan: the wallet shows Rs -5),
-- never below minus one plan's price (the maximum bill, Rs 50); only a NEGATIVE balance blocks the next AI plan; the
-- next top-up clears the negative first. Plan: odds-app/docs/create-plan-entry-plan.md.
--
-- 1. Constraint team_wallet_ai_floor: an ai_plan row may leave balance_after_paise negative, never below -5000.
-- 2. team_wallet_charge_ai_plan(user, client, name, draft_ref, preview): ONE paid ai_plan row written after the draft,
--    refused only while the balance is already negative (WALLET_NEGATIVE). No held draft, nothing to settle.
-- 3. team_wallet_ai_plan_gate(user, essentials, client): the Rs 50 floor is gone; for a billed draft the gate answers
--    bill_paise for the client and blocks only when negative (reason WALLET_NEGATIVE, with the figure) or while a bill
--    from the old design is still pending (WALLET_BILL_PENDING). The 2-argument version is dropped (one signature).
-- 4. get_my_team_wallet adds 'negative' and 'negative_line' for the Wallet screen.
-- The old create_ai_bill / settle / discard functions stay for bills written before this change (the sweep cancels
-- them after 24 hours). A rolled-back probe (9 checks) at the end.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. The table's checks, re-applied (found live 3 Nov 2026: the table had been created by the first run of
--    20261102160000, whose inline CHECK (amount_paise <> 0) forbids the free 0-rows and whose sign check predates
--    them; CREATE TABLE IF NOT EXISTS never changes an existing table, so the later runs left both in place and
--    team_wallet_record_free_draft failed silently, which also kept the free count from moving).
-- ---------------------------------------------------------------------------
ALTER TABLE public.team_wallet DROP CONSTRAINT IF EXISTS team_wallet_amount_paise_check;
ALTER TABLE public.team_wallet DROP CONSTRAINT IF EXISTS team_wallet_amount_nonzero;
ALTER TABLE public.team_wallet ADD CONSTRAINT team_wallet_amount_nonzero
  CHECK (amount_paise <> 0 OR (kind = 'ai_plan' AND meta->>'free' = 'true'));
ALTER TABLE public.team_wallet DROP CONSTRAINT IF EXISTS team_wallet_sign;
ALTER TABLE public.team_wallet ADD CONSTRAINT team_wallet_sign CHECK (
     (kind IN ('topup', 'reversal') AND amount_paise > 0)
  OR (kind = 'refund' AND amount_paise < 0)
  OR (kind = 'ai_plan' AND (amount_paise < 0 OR (amount_paise = 0 AND meta->>'free' = 'true')))
  OR (kind = 'adjustment' AND amount_paise <> 0));
ALTER TABLE public.team_wallet DROP CONSTRAINT IF EXISTS team_wallet_topup_limits;
ALTER TABLE public.team_wallet ADD CONSTRAINT team_wallet_topup_limits
  CHECK (kind <> 'topup' OR amount_paise = 100 OR amount_paise BETWEEN 50000 AND 500000);

-- ---------------------------------------------------------------------------
-- 1. The floor: minus one plan's price
-- ---------------------------------------------------------------------------
ALTER TABLE public.team_wallet DROP CONSTRAINT IF EXISTS team_wallet_ai_floor;
ALTER TABLE public.team_wallet ADD CONSTRAINT team_wallet_ai_floor
  CHECK (kind <> 'ai_plan' OR balance_after_paise IS NULL OR balance_after_paise >= -5000);

/** "Rs -5" for the owner's sentences (the apps print the same). */
CREATE OR REPLACE FUNCTION public.team_wallet_rs(p_paise bigint)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_paise < 0 THEN 'Rs -' || (abs(p_paise) / 100)::text ELSE 'Rs ' || (p_paise / 100)::text END
$$;
GRANT EXECUTE ON FUNCTION public.team_wallet_rs(bigint) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The gate, now with the client's bill and the negative rule
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.team_wallet_ai_plan_gate(uuid, boolean);
DROP FUNCTION IF EXISTS public.team_wallet_ai_plan_gate(uuid);
CREATE OR REPLACE FUNCTION public.team_wallet_ai_plan_gate(p_user uuid, p_essentials boolean DEFAULT false, p_client uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_charges boolean;
  v_bal bigint;
  v_used integer := 0;
  v_left integer := 0;
  v_free_this boolean;
  v_bill bigint := NULL;
  v_blocks jsonb := NULL;
  v_pending public.team_wallet;
  v_pending_json jsonb := NULL;
  v_reason text := NULL;
  v_line text := NULL;
BEGIN
  SELECT p.role::text INTO v_role FROM public.profiles p WHERE p.id = p_user;
  v_charges := (v_role = 'trainer');
  v_bal := public.team_wallet_balance(p_user);
  IF v_charges THEN
    v_used := public.team_wallet_free_used(p_user);
    v_left := GREATEST(public.team_wallet_free_total() - v_used, 0);
  END IF;
  v_free_this := NOT v_charges OR COALESCE(p_essentials, false) OR v_left > 0;
  IF v_charges AND NOT v_free_this AND p_client IS NOT NULL THEN
    SELECT (b->>'bill_paise')::bigint, b->'blocks' INTO v_bill, v_blocks FROM public.team_wallet_ai_plan_bill(p_client) b;
  END IF;
  SELECT * INTO v_pending FROM public.team_wallet w
   WHERE w.user_id = p_user AND w.kind = 'ai_plan' AND w.status = 'pending' ORDER BY w.seq DESC LIMIT 1;
  IF v_pending.id IS NOT NULL THEN
    v_pending_json := jsonb_build_object('tx_id', v_pending.id, 'bill_paise', -v_pending.amount_paise,
      'client_id', v_pending.meta->>'client_id', 'client_name', v_pending.meta->>'client_name',
      'created_at', v_pending.created_at, 'preview', v_pending.meta->'preview');
  END IF;
  IF v_charges AND NOT v_free_this THEN
    IF v_pending.id IS NOT NULL THEN
      v_reason := 'WALLET_BILL_PENDING'; v_line := 'Settle or discard your last draft first.';
    ELSIF v_bal < 0 THEN
      v_reason := 'WALLET_NEGATIVE'; v_line := 'Your wallet is at ' || public.team_wallet_rs(v_bal) || '. Add funds to make the next plan with Odds AI.';
    END IF;
  END IF;
  RETURN jsonb_build_object('charges', v_charges, 'balance_paise', v_bal, 'negative', v_bal < 0,
    'floor_paise', 0, 'bill_paise', v_bill, 'blocks', v_blocks,
    'free_total', public.team_wallet_free_total(), 'free_used', v_used, 'free_left', v_left,
    'essentials', COALESCE(p_essentials, false), 'free_this', v_free_this, 'billed', v_charges AND NOT v_free_this,
    'pending_bill', v_pending_json, 'ok', v_reason IS NULL, 'reason', v_reason, 'line', v_line);
END;
$$;
REVOKE ALL ON FUNCTION public.team_wallet_ai_plan_gate(uuid, boolean, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_wallet_ai_plan_gate(uuid, boolean, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. The charge, written after the draft
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.team_wallet_charge_ai_plan(p_user uuid, p_client uuid, p_client_name text, p_draft_ref text, p_preview jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_bal bigint;
  v_bill jsonb;
  v_amount bigint;
  v_row public.team_wallet;
BEGIN
  SELECT p.role::text INTO v_role FROM public.profiles p WHERE p.id = p_user;
  IF v_role IS DISTINCT FROM 'trainer' THEN RAISE EXCEPTION 'WALLET_FORBIDDEN: Only trainers are billed for AI plans.' USING ERRCODE = '42501'; END IF;
  PERFORM public.team_wallet_lock(p_user);
  v_bal := public.team_wallet_balance(p_user);
  IF v_bal < 0 THEN
    RAISE EXCEPTION 'WALLET_NEGATIVE: Your wallet is at %. Add funds to make the next plan with Odds AI.', public.team_wallet_rs(v_bal);
  END IF;
  v_bill := public.team_wallet_ai_plan_bill(p_client);
  v_amount := (v_bill->>'bill_paise')::bigint;
  IF v_bal - v_amount < -5000 THEN
    RAISE EXCEPTION 'WALLET_NEGATIVE: The wallet cannot go further below zero. Add funds first.';
  END IF;
  INSERT INTO public.team_wallet (user_id, role, kind, amount_paise, status, balance_after_paise, paid_at, meta)
  VALUES (p_user, v_role, 'ai_plan', -v_amount, 'paid', v_bal - v_amount, now(),
          jsonb_build_object('note', 'Odds AI plan', 'created_by', p_user, 'draft_ref', p_draft_ref, 'client_id', p_client,
                             'client_name', p_client_name, 'blocks', v_bill->'blocks', 'preview', COALESCE(p_preview, '{}'::jsonb), 'auto', true))
  RETURNING * INTO v_row;
  RETURN jsonb_build_object('tx_id', v_row.id, 'bill_paise', v_amount, 'blocks', v_bill->'blocks', 'balance_paise', v_bal - v_amount,
                            'negative', v_bal - v_amount < 0, 'row', public.team_wallet_public(v_row));
END;
$$;
REVOKE ALL ON FUNCTION public.team_wallet_charge_ai_plan(uuid, uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_wallet_charge_ai_plan(uuid, uuid, text, text, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. The app's read: the negative state
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_team_wallet(p_limit integer DEFAULT 50, p_before timestamptz DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_day date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_today bigint;
  v_gate jsonb;
  v_bal bigint;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'WALLET_SIGN_IN: Sign in to see your wallet.' USING ERRCODE = '42501'; END IF;
  SELECT COALESCE(SUM(w.amount_paise), 0) INTO v_today FROM public.team_wallet w
   WHERE w.user_id = v_uid AND w.kind = 'topup' AND w.status IN ('pending', 'paid')
     AND (w.created_at AT TIME ZONE 'Asia/Kolkata')::date = v_day;
  v_gate := public.team_wallet_ai_plan_gate(v_uid, false, NULL);
  v_bal := public.team_wallet_balance(v_uid);
  RETURN jsonb_build_object(
    'balance_paise', v_bal,
    'negative', v_bal < 0,
    'negative_line', CASE WHEN v_bal < 0 THEN 'Your wallet is at ' || public.team_wallet_rs(v_bal) || '. Add funds to make the next plan with Odds AI.' ELSE NULL END,
    'today_topup_paise', v_today,
    'today_room_paise', GREATEST(public.team_wallet_daily_cap_paise() - v_today, 0),
    'min_topup_paise', public.team_wallet_min_topup_paise(),
    'daily_cap_paise', public.team_wallet_daily_cap_paise(),
    'ai_bill_min_paise', 3000,
    'ai_bill_max_paise', 5000,
    'ai_floor_paise', 0,
    'charges_ai', v_gate->'charges',
    'free_total', v_gate->'free_total',
    'free_used', v_gate->'free_used',
    'free_left', v_gate->'free_left',
    'pending_bill', v_gate->'pending_bill',
    'rows', COALESCE((SELECT jsonb_agg(public.team_wallet_public(w) ORDER BY w.seq DESC)
      FROM (SELECT * FROM public.team_wallet w2 WHERE w2.user_id = v_uid AND (p_before IS NULL OR w2.created_at < p_before)
             ORDER BY w2.seq DESC LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))) w), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_team_wallet(integer, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_team_wallet(integer, timestamptz) TO authenticated, service_role;

COMMIT;

-- ---------------------------------------------------------------------------
-- Probe: Sagar and a client, inside a block that is always rolled back. 9 checks.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE IF NOT EXISTS charge_probe (step int, check_name text, expected text, result text);
TRUNCATE charge_probe;

DO $probe$
DECLARE
  v_user uuid; v_admin uuid; v_client uuid; v_client_name text; v_bill bigint;
  x jsonb; g jsonb; v_res text; v_n int;
  v_names text[] := '{}'; v_expected text[] := '{}'; v_results text[] := '{}';
BEGIN
  SELECT p.id INTO v_user FROM public.profiles p WHERE p.role::text = 'trainer' AND p.email = 'sagaroddsfitness@gmail.com' LIMIT 1;
  IF v_user IS NULL THEN SELECT p.id INTO v_user FROM public.profiles p WHERE p.role::text = 'trainer' LIMIT 1; END IF;
  SELECT p.id INTO v_admin FROM public.profiles p WHERE p.role::text IN ('admin', 'super_admin') LIMIT 1;
  SELECT c.id, COALESCE(c.first_name, 'Client') INTO v_client, v_client_name FROM public.clients c ORDER BY c.created_at DESC NULLS LAST LIMIT 1;
  BEGIN
    v_bill := public.team_wallet_ai_plan_bill_paise(v_client);
    -- use up the free drafts so the charge path is exercised
    v_n := 0;
    WHILE (public.team_wallet_ai_plan_gate(v_user, false, v_client)->>'free_left')::int > 0 AND v_n < 5 LOOP
      x := public.team_wallet_record_free_draft(v_user, v_client, v_client_name, false, 'probe-free-' || v_n, NULL); v_n := v_n + 1;
    END LOOP;
    -- 1. a balance below the price is NOT a block; the gate names the bill
    g := public.team_wallet_ai_plan_gate(v_user, false, v_client);
    v_names := array_append(v_names, 'gate at Rs 0: billed, ok, bill named, not negative'); v_expected := array_append(v_expected, 'billed true, ok true, bill ' || v_bill || ', negative false');
    v_results := array_append(v_results, 'billed ' || (g->>'billed') || ', ok ' || (g->>'ok') || ', bill ' || (g->>'bill_paise') || ', negative ' || (g->>'negative'));
    -- 2. charge on Rs 0: the balance goes negative by the bill
    x := public.team_wallet_charge_ai_plan(v_user, v_client, v_client_name, 'probe-charge-1', '{"sections":["Push"],"exercise_count":9}'::jsonb);
    v_names := array_append(v_names, 'charge on Rs 0 goes negative by the bill'); v_expected := array_append(v_expected, 'balance ' || (-v_bill) || ', negative true');
    v_results := array_append(v_results, 'balance ' || (x->>'balance_paise') || ', negative ' || (x->>'negative'));
    -- 3. the next plan is blocked with the owner's sentence
    g := public.team_wallet_ai_plan_gate(v_user, false, v_client);
    v_names := array_append(v_names, 'negative balance blocks the next plan'); v_expected := array_append(v_expected, 'WALLET_NEGATIVE | Your wallet is at Rs -' || (v_bill / 100) || '. Add funds to make the next plan with Odds AI.');
    v_results := array_append(v_results, (g->>'reason') || ' | ' || (g->>'line'));
    BEGIN x := public.team_wallet_charge_ai_plan(v_user, v_client, v_client_name, 'probe-charge-2', NULL); v_res := 'charged'; EXCEPTION WHEN others THEN v_res := SQLERRM; END;
    v_names := array_append(v_names, 'a charge while negative is refused'); v_expected := array_append(v_expected, 'WALLET_NEGATIVE: Your wallet is at Rs -' || (v_bill / 100) || '. Add funds to make the next plan with Odds AI.');
    v_results := array_append(v_results, v_res);
    -- 4. an Essentials draft is still free while negative
    g := public.team_wallet_ai_plan_gate(v_user, true, v_client);
    v_names := array_append(v_names, 'Essentials stays free while negative'); v_expected := array_append(v_expected, 'free_this true, ok true');
    v_results := array_append(v_results, 'free_this ' || (g->>'free_this') || ', ok ' || (g->>'ok'));
    -- 5. a Rs 500 top-up clears the negative first
    x := public.team_wallet_create_topup(v_user, 50000);
    PERFORM public.team_wallet_set_order((x->>'id')::uuid, 'order_probe_neg');
    x := public.team_wallet_mark_paid((x->>'id')::uuid, 'pay_probe_neg', NULL, 'upi', NULL, 'app_verify');
    v_names := array_append(v_names, 'Rs 500 top-up at a negative balance'); v_expected := array_append(v_expected, 'balance ' || (50000 - v_bill) || ', gate ok');
    v_results := array_append(v_results, 'balance ' || (x->>'balance_after_paise') || ', gate ' || CASE WHEN (public.team_wallet_ai_plan_gate(v_user, false, v_client)->>'ok')::boolean THEN 'ok' ELSE 'blocked' END);
    -- 6. the floor constraint: a row that would land below -5000 is refused
    BEGIN
      INSERT INTO public.team_wallet (user_id, role, kind, amount_paise, status, balance_after_paise, paid_at, meta)
      VALUES (v_user, 'trainer', 'ai_plan', -5000, 'paid', -5100, now(), '{"note":"probe"}'::jsonb);
      v_res := 'inserted';
    EXCEPTION WHEN others THEN v_res := CASE WHEN SQLERRM LIKE '%team_wallet_ai_floor%' THEN 'refused by team_wallet_ai_floor' ELSE SQLERRM END; END;
    v_names := array_append(v_names, 'a balance below -5000 is refused by the constraint'); v_expected := array_append(v_expected, 'refused by team_wallet_ai_floor');
    v_results := array_append(v_results, v_res);
    -- 7. the app read says negative after an adjustment below zero
    IF v_admin IS NOT NULL THEN
      PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
      x := public.team_wallet_adjust(v_user, -(public.team_wallet_balance(v_user) + 700), 'probe: push the wallet to Rs -7');
      PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
      x := public.get_my_team_wallet(5, NULL);
      PERFORM set_config('request.jwt.claim.sub', '', true);
      v_names := array_append(v_names, 'get_my_team_wallet at Rs -7'); v_expected := array_append(v_expected, 'true | Your wallet is at Rs -7. Add funds to make the next plan with Odds AI.');
      v_results := array_append(v_results, (x->>'negative') || ' | ' || (x->>'negative_line'));
    END IF;
    -- 8. the free count is untouched by charged plans
    g := public.team_wallet_ai_plan_gate(v_user, false, v_client);
    v_names := array_append(v_names, 'free_left stays 0 after charges'); v_expected := array_append(v_expected, '0');
    v_results := array_append(v_results, (g->>'free_left'));
    RAISE EXCEPTION 'PROBE_DONE';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'PROBE_DONE' THEN
      v_names := array_append(v_names, 'probe stopped'); v_expected := array_append(v_expected, 'ran'); v_results := array_append(v_results, 'could not run: ' || SQLERRM);
    END IF;
  END;
  INSERT INTO charge_probe (step, check_name, expected, result)
  SELECT n, v_names[n], v_expected[n], v_results[n] FROM generate_subscripts(v_names, 1) AS n;
END
$probe$;

INSERT INTO charge_probe (step, check_name, expected, result)
SELECT 20, 'Rs text', 'Rs -5 | Rs 467', public.team_wallet_rs(-500) || ' | ' || public.team_wallet_rs(46700)
UNION ALL
SELECT 21, 'probe rows left behind', '0', (SELECT count(*)::text FROM public.team_wallet WHERE meta->>'draft_ref' LIKE 'probe-%' OR razorpay->>'order_id' = 'order_probe_neg');

SELECT step, check_name, expected, result FROM charge_probe ORDER BY step;
```

#### `supabase/migrations/20261103120000_ai_plan_charge_on_create.sql`

```sql
-- ============================================================================
-- Team Wallet: the Odds AI plan is charged ONCE, at a FIXED price, when the plan is created (3 Nov 2026)
-- Owner (3 Nov 2026, replacing the morning's "charged after every draft"): "money is deducted only once per plan,
-- when the trainer clicks the Create Plan button; before that generating is free, any time. The price is fixed per
-- plan, not computed from the client's data blocks: one server constant, Rs 50 for now." Free plans first (3 per
-- trainer, non-Essentials), Essentials free, manual plans free; a draft applied and then rebuilt by hand is still an
-- AI plan and is charged. Plan: odds-app/docs/ai-plan-charge-on-create-plan.md.
--
-- 1. team_wallet_ai_plan_price_paise() = 5000: the ONE price constant. The gate's bill_paise is this figure.
-- 2. One ledger row per plan: ai_plan rows carry meta.plan_id (unique partial index team_wallet_plan_uidx).
-- 3. team_wallet_charge_ai_plan(user, client, name, plan_id, preview) and team_wallet_record_free_draft(user, client,
--    name, essentials, plan_id, preview) take the plan id and answer the existing row (already true) on a repeat.
-- 4. Trigger trg_team_wallet_plan_created AFTER INSERT ON workout_plan_exercises (statement level): for each NEW AI
--    plan of a trainer, one free row or one charge. A wallet problem is a WARNING: the plan always lands.
--    Plans that already existed when this ran (team_wallet_legacy_plans) are never charged, so Save & Resubmit
--    (which re-inserts the rows) of an older plan costs nothing.
-- 5. ai-plan-draft stops charging and stops recording free rows (redeployed); generating is free.
-- 6. get_my_team_wallet adds ai_plan_price_paise. A rolled-back probe (12 checks) at the end.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The price
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.team_wallet_ai_plan_price_paise()
RETURNS bigint LANGUAGE sql IMMUTABLE AS $$ SELECT 5000::bigint $$;
GRANT EXECUTE ON FUNCTION public.team_wallet_ai_plan_price_paise() TO authenticated, service_role;

-- The floor stays minus one plan's price.
ALTER TABLE public.team_wallet DROP CONSTRAINT IF EXISTS team_wallet_ai_floor;
ALTER TABLE public.team_wallet ADD CONSTRAINT team_wallet_ai_floor
  CHECK (kind <> 'ai_plan' OR balance_after_paise IS NULL OR balance_after_paise >= -5000);

-- ---------------------------------------------------------------------------
-- 2. One row per plan
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS team_wallet_plan_uidx ON public.team_wallet ((meta->>'plan_id'))
  WHERE kind = 'ai_plan' AND meta->>'plan_id' IS NOT NULL;

/** The ai_plan row already written for a plan, if any. */
CREATE OR REPLACE FUNCTION public.team_wallet_plan_row(p_plan_id uuid)
RETURNS public.team_wallet LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT w.* FROM public.team_wallet w WHERE w.kind = 'ai_plan' AND w.meta->>'plan_id' = p_plan_id::text ORDER BY w.seq DESC LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.team_wallet_plan_row(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_wallet_plan_row(uuid) TO service_role;

-- Plans that exist before this change are never charged by the trigger (their drafts were charged, or free, at
-- Generate time under the earlier rule; an edit re-inserts their rows and must cost nothing).
-- The snapshot also freezes the free count's history: an edit re-inserts a plan's rows with a new created_at, which
-- used to drop the plan out of "AI plans saved before the cutover" and hand the trainer a free plan back.
CREATE TABLE IF NOT EXISTS public.team_wallet_legacy_plans (
  plan_id uuid PRIMARY KEY,
  trainer_id uuid,
  client_id uuid,
  essentials boolean NOT NULL DEFAULT false,
  created_at timestamptz,
  noted_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.team_wallet_legacy_plans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.team_wallet_legacy_plans FROM PUBLIC, anon, authenticated;
INSERT INTO public.team_wallet_legacy_plans (plan_id, trainer_id, client_id, essentials, created_at)
SELECT e.plan_id, MIN(e.trainer_id::text)::uuid, MIN(e.client_id::text)::uuid,
       COALESCE(bool_or(public.team_wallet_is_essentials(c.subscription_type)), false), MIN(e.created_at)
  FROM public.workout_plan_exercises e
  LEFT JOIN public.clients c ON c.id = e.client_id
 WHERE e.plan_id IS NOT NULL AND e.source = 'ai'
 GROUP BY e.plan_id
ON CONFLICT (plan_id) DO NOTHING;

/** Free plans used: the free 0-rows this ledger holds (non-Essentials) plus the AI plans saved before the cutover
    (from the snapshot, so a later edit never changes the count). */
CREATE OR REPLACE FUNCTION public.team_wallet_free_used(p_user uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (SELECT count(*)::integer FROM public.team_wallet w
           WHERE w.user_id = p_user AND w.kind = 'ai_plan' AND w.status = 'paid' AND w.meta->>'free' = 'true' AND COALESCE(w.meta->>'essentials', 'false') <> 'true')
       + (SELECT count(*)::integer FROM public.team_wallet_legacy_plans l
           WHERE l.trainer_id = p_user AND NOT l.essentials AND l.created_at < public.team_wallet_free_cutover());
$$;
REVOKE ALL ON FUNCTION public.team_wallet_free_used(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_wallet_free_used(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. The free row and the charge, keyed by the plan
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.team_wallet_record_free_draft(uuid, uuid, text, boolean, text, jsonb);
CREATE OR REPLACE FUNCTION public.team_wallet_record_free_draft(p_user uuid, p_client uuid, p_client_name text, p_essentials boolean, p_plan_id uuid, p_preview jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_row public.team_wallet;
  v_used integer;
BEGIN
  SELECT p.role::text INTO v_role FROM public.profiles p WHERE p.id = p_user;
  IF v_role IS DISTINCT FROM 'trainer' THEN RETURN jsonb_build_object('recorded', false, 'already', false, 'free_left', NULL); END IF;
  PERFORM public.team_wallet_lock(p_user);
  v_row := public.team_wallet_plan_row(p_plan_id);
  IF v_row.id IS NOT NULL THEN
    v_used := public.team_wallet_free_used(p_user);
    RETURN jsonb_build_object('recorded', false, 'already', true, 'free_total', public.team_wallet_free_total(), 'free_used', v_used,
                              'free_left', GREATEST(public.team_wallet_free_total() - v_used, 0), 'row', public.team_wallet_public(v_row));
  END IF;
  INSERT INTO public.team_wallet (user_id, role, kind, amount_paise, status, balance_after_paise, paid_at, meta)
  VALUES (p_user, v_role, 'ai_plan', 0, 'paid', public.team_wallet_balance(p_user), now(),
          jsonb_build_object('free', true, 'essentials', COALESCE(p_essentials, false), 'note', CASE WHEN COALESCE(p_essentials, false) THEN 'Odds AI plan, free for Essentials' ELSE 'Odds AI plan, free' END,
                             'created_by', p_user, 'plan_id', p_plan_id, 'client_id', p_client, 'client_name', p_client_name, 'preview', COALESCE(p_preview, '{}'::jsonb), 'charge_at', 'plan_create'))
  RETURNING * INTO v_row;
  v_used := public.team_wallet_free_used(p_user);
  RETURN jsonb_build_object('recorded', true, 'already', false, 'free_total', public.team_wallet_free_total(), 'free_used', v_used,
                            'free_left', GREATEST(public.team_wallet_free_total() - v_used, 0), 'row', public.team_wallet_public(v_row));
END;
$$;
REVOKE ALL ON FUNCTION public.team_wallet_record_free_draft(uuid, uuid, text, boolean, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_wallet_record_free_draft(uuid, uuid, text, boolean, uuid, jsonb) TO service_role;

DROP FUNCTION IF EXISTS public.team_wallet_charge_ai_plan(uuid, uuid, text, text, jsonb);
CREATE OR REPLACE FUNCTION public.team_wallet_charge_ai_plan(p_user uuid, p_client uuid, p_client_name text, p_plan_id uuid, p_preview jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_bal bigint;
  v_amount bigint := public.team_wallet_ai_plan_price_paise();
  v_row public.team_wallet;
BEGIN
  SELECT p.role::text INTO v_role FROM public.profiles p WHERE p.id = p_user;
  IF v_role IS DISTINCT FROM 'trainer' THEN RAISE EXCEPTION 'WALLET_FORBIDDEN: Only trainers are billed for AI plans.' USING ERRCODE = '42501'; END IF;
  PERFORM public.team_wallet_lock(p_user);
  v_row := public.team_wallet_plan_row(p_plan_id);
  IF v_row.id IS NOT NULL THEN
    RETURN jsonb_build_object('already', true, 'tx_id', v_row.id, 'bill_paise', -v_row.amount_paise, 'balance_paise', public.team_wallet_balance(p_user),
                              'negative', public.team_wallet_balance(p_user) < 0, 'row', public.team_wallet_public(v_row));
  END IF;
  v_bal := public.team_wallet_balance(p_user);
  IF v_bal < 0 THEN
    RAISE EXCEPTION 'WALLET_NEGATIVE: Your wallet is at %. Add funds to make the next plan with Odds AI.', public.team_wallet_rs(v_bal);
  END IF;
  IF v_bal - v_amount < -5000 THEN
    RAISE EXCEPTION 'WALLET_NEGATIVE: The wallet cannot go further below zero. Add funds first.';
  END IF;
  INSERT INTO public.team_wallet (user_id, role, kind, amount_paise, status, balance_after_paise, paid_at, meta)
  VALUES (p_user, v_role, 'ai_plan', -v_amount, 'paid', v_bal - v_amount, now(),
          jsonb_build_object('note', 'Odds AI plan', 'created_by', p_user, 'plan_id', p_plan_id, 'client_id', p_client,
                             'client_name', p_client_name, 'preview', COALESCE(p_preview, '{}'::jsonb), 'auto', true, 'charge_at', 'plan_create'))
  RETURNING * INTO v_row;
  RETURN jsonb_build_object('already', false, 'tx_id', v_row.id, 'bill_paise', v_amount, 'balance_paise', v_bal - v_amount,
                            'negative', v_bal - v_amount < 0, 'row', public.team_wallet_public(v_row));
END;
$$;
REVOKE ALL ON FUNCTION public.team_wallet_charge_ai_plan(uuid, uuid, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_wallet_charge_ai_plan(uuid, uuid, text, uuid, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. The gate: the fixed price, no blocks; charge_at tells the apps when the money moves
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.team_wallet_ai_plan_gate(p_user uuid, p_essentials boolean DEFAULT false, p_client uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_charges boolean;
  v_bal bigint;
  v_used integer := 0;
  v_left integer := 0;
  v_free_this boolean;
  v_bill bigint := NULL;
  v_pending public.team_wallet;
  v_pending_json jsonb := NULL;
  v_reason text := NULL;
  v_line text := NULL;
BEGIN
  SELECT p.role::text INTO v_role FROM public.profiles p WHERE p.id = p_user;
  v_charges := (v_role = 'trainer');
  v_bal := public.team_wallet_balance(p_user);
  IF v_charges THEN
    v_used := public.team_wallet_free_used(p_user);
    v_left := GREATEST(public.team_wallet_free_total() - v_used, 0);
  END IF;
  v_free_this := NOT v_charges OR COALESCE(p_essentials, false) OR v_left > 0;
  IF v_charges AND NOT v_free_this THEN v_bill := public.team_wallet_ai_plan_price_paise(); END IF;
  SELECT * INTO v_pending FROM public.team_wallet w
   WHERE w.user_id = p_user AND w.kind = 'ai_plan' AND w.status = 'pending' ORDER BY w.seq DESC LIMIT 1;
  IF v_pending.id IS NOT NULL THEN
    v_pending_json := jsonb_build_object('tx_id', v_pending.id, 'bill_paise', -v_pending.amount_paise,
      'client_id', v_pending.meta->>'client_id', 'client_name', v_pending.meta->>'client_name',
      'created_at', v_pending.created_at, 'preview', v_pending.meta->'preview');
  END IF;
  IF v_charges AND NOT v_free_this THEN
    IF v_pending.id IS NOT NULL THEN
      v_reason := 'WALLET_BILL_PENDING'; v_line := 'Settle or discard your last draft first.';
    ELSIF v_bal < 0 THEN
      v_reason := 'WALLET_NEGATIVE'; v_line := 'Your wallet is at ' || public.team_wallet_rs(v_bal) || '. Add funds to make the next plan with Odds AI.';
    END IF;
  END IF;
  RETURN jsonb_build_object('charges', v_charges, 'balance_paise', v_bal, 'negative', v_bal < 0,
    'floor_paise', 0, 'bill_paise', v_bill, 'blocks', NULL, 'price_paise', public.team_wallet_ai_plan_price_paise(), 'charge_at', 'plan_create',
    'free_total', public.team_wallet_free_total(), 'free_used', v_used, 'free_left', v_left,
    'essentials', COALESCE(p_essentials, false), 'free_this', v_free_this, 'billed', v_charges AND NOT v_free_this,
    'pending_bill', v_pending_json, 'ok', v_reason IS NULL, 'reason', v_reason, 'line', v_line);
END;
$$;
REVOKE ALL ON FUNCTION public.team_wallet_ai_plan_gate(uuid, boolean, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_wallet_ai_plan_gate(uuid, boolean, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. The trigger: one row per new AI plan, when the plan's rows are inserted
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.team_wallet_plan_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_role text;
  v_sub text;
  v_name text;
  v_left integer;
  v_preview jsonb;
  x jsonb;
BEGIN
  FOR r IN
    SELECT n.plan_id, n.trainer_id, n.client_id,
           MIN(n.plan_name) AS plan_name, MIN(n.modality) AS modality,
           COUNT(DISTINCT n.exercise_name) AS exercise_count,
           array_agg(DISTINCT n.body_part) AS sections
      FROM new_rows n
     WHERE n.plan_id IS NOT NULL AND n.trainer_id IS NOT NULL AND n.source = 'ai'
     GROUP BY n.plan_id, n.trainer_id, n.client_id
  LOOP
    BEGIN
      -- not a plan that existed before this rule (an edit re-inserts the rows of an older plan)
      CONTINUE WHEN EXISTS (SELECT 1 FROM public.team_wallet_legacy_plans l WHERE l.plan_id = r.plan_id);
      -- never twice for the same plan (a retried sync, Save & Resubmit, a double tap)
      CONTINUE WHEN (public.team_wallet_plan_row(r.plan_id)).id IS NOT NULL;
      SELECT p.role::text INTO v_role FROM public.profiles p WHERE p.id = r.trainer_id;
      CONTINUE WHEN v_role IS DISTINCT FROM 'trainer';
      SELECT c.subscription_type, COALESCE(NULLIF(btrim(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')), ''), 'Client')
        INTO v_sub, v_name FROM public.clients c WHERE c.id = r.client_id;
      v_preview := jsonb_build_object('plan_name', r.plan_name, 'modality', r.modality, 'exercise_count', r.exercise_count,
                                      'sections', to_jsonb(r.sections), 'split_label', NULL);
      IF public.team_wallet_is_essentials(v_sub) THEN
        x := public.team_wallet_record_free_draft(r.trainer_id, r.client_id, v_name, true, r.plan_id, v_preview);
      ELSE
        v_left := GREATEST(public.team_wallet_free_total() - public.team_wallet_free_used(r.trainer_id), 0);
        IF v_left > 0 THEN
          x := public.team_wallet_record_free_draft(r.trainer_id, r.client_id, v_name, false, r.plan_id, v_preview);
        ELSE
          x := public.team_wallet_charge_ai_plan(r.trainer_id, r.client_id, v_name, r.plan_id, v_preview);
        END IF;
      END IF;
    EXCEPTION WHEN others THEN
      -- The plan always lands: a wallet problem (the floor, a missing profile) is logged, never raised.
      RAISE WARNING 'team_wallet_plan_created: plan % of % not charged: %', r.plan_id, r.trainer_id, SQLERRM;
    END;
  END LOOP;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.team_wallet_plan_created() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_team_wallet_plan_created ON public.workout_plan_exercises;
CREATE TRIGGER trg_team_wallet_plan_created
  AFTER INSERT ON public.workout_plan_exercises
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.team_wallet_plan_created();

-- ---------------------------------------------------------------------------
-- 6. The app's read: the price
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_team_wallet(p_limit integer DEFAULT 50, p_before timestamptz DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_day date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_today bigint;
  v_gate jsonb;
  v_bal bigint;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'WALLET_SIGN_IN: Sign in to see your wallet.' USING ERRCODE = '42501'; END IF;
  SELECT COALESCE(SUM(w.amount_paise), 0) INTO v_today FROM public.team_wallet w
   WHERE w.user_id = v_uid AND w.kind = 'topup' AND w.status IN ('pending', 'paid')
     AND (w.created_at AT TIME ZONE 'Asia/Kolkata')::date = v_day;
  v_gate := public.team_wallet_ai_plan_gate(v_uid, false, NULL);
  v_bal := public.team_wallet_balance(v_uid);
  RETURN jsonb_build_object(
    'balance_paise', v_bal,
    'negative', v_bal < 0,
    'negative_line', CASE WHEN v_bal < 0 THEN 'Your wallet is at ' || public.team_wallet_rs(v_bal) || '. Add funds to make the next plan with Odds AI.' ELSE NULL END,
    'today_topup_paise', v_today,
    'today_room_paise', GREATEST(public.team_wallet_daily_cap_paise() - v_today, 0),
    'min_topup_paise', public.team_wallet_min_topup_paise(),
    'daily_cap_paise', public.team_wallet_daily_cap_paise(),
    'ai_plan_price_paise', public.team_wallet_ai_plan_price_paise(),
    'ai_bill_min_paise', public.team_wallet_ai_plan_price_paise(),
    'ai_bill_max_paise', public.team_wallet_ai_plan_price_paise(),
    'ai_floor_paise', 0,
    'charges_ai', v_gate->'charges',
    'free_total', v_gate->'free_total',
    'free_used', v_gate->'free_used',
    'free_left', v_gate->'free_left',
    'pending_bill', v_gate->'pending_bill',
    'rows', COALESCE((SELECT jsonb_agg(public.team_wallet_public(w) ORDER BY w.seq DESC)
      FROM (SELECT * FROM public.team_wallet w2 WHERE w2.user_id = v_uid AND (p_before IS NULL OR w2.created_at < p_before)
             ORDER BY w2.seq DESC LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))) w), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_team_wallet(integer, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_team_wallet(integer, timestamptz) TO authenticated, service_role;

COMMIT;

-- ---------------------------------------------------------------------------
-- Probe: Sagar and a client, inside a block that is always rolled back. 12 checks.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE IF NOT EXISTS plan_charge_probe (step int, check_name text, expected text, result text);
TRUNCATE plan_charge_probe;

DO $probe$
DECLARE
  v_user uuid; v_client uuid; v_ess uuid; v_bal0 bigint; v_free0 integer;
  p1 uuid := gen_random_uuid(); p2 uuid := gen_random_uuid(); p3 uuid := gen_random_uuid(); p4 uuid := gen_random_uuid(); p5 uuid := gen_random_uuid();
  g jsonb; w public.team_wallet; v_n int; v_neg boolean; v_b7 bigint;
  v_names text[] := '{}'; v_expected text[] := '{}'; v_results text[] := '{}';
BEGIN
  SELECT p.id INTO v_user FROM public.profiles p WHERE p.role::text = 'trainer' AND p.email = 'sagaroddsfitness@gmail.com' LIMIT 1;
  IF v_user IS NULL THEN SELECT p.id INTO v_user FROM public.profiles p WHERE p.role::text = 'trainer' LIMIT 1; END IF;
  SELECT c.id INTO v_client FROM public.clients c WHERE NOT public.team_wallet_is_essentials(c.subscription_type) ORDER BY c.created_at DESC NULLS LAST LIMIT 1;
  SELECT c.id INTO v_ess FROM public.clients c WHERE public.team_wallet_is_essentials(c.subscription_type) ORDER BY c.created_at DESC NULLS LAST LIMIT 1;
  BEGIN
    v_bal0 := public.team_wallet_balance(v_user);
    v_free0 := GREATEST(public.team_wallet_free_total() - public.team_wallet_free_used(v_user), 0);
    -- 1. the gate names the fixed price, charge_at plan_create
    g := public.team_wallet_ai_plan_gate(v_user, false, v_client);
    v_names := array_append(v_names, 'gate: fixed price, charge_at plan_create, no blocks'); v_expected := array_append(v_expected, 'price 5000, charge_at plan_create, blocks null, bill ' || CASE WHEN v_free0 > 0 THEN 'null' ELSE '5000' END);
    v_results := array_append(v_results, 'price ' || (g->>'price_paise') || ', charge_at ' || (g->>'charge_at') || ', blocks ' || COALESCE(g->>'blocks', 'null') || ', bill ' || COALESCE(g->>'bill_paise', 'null'));
    -- use up the free plans with free rows (so the charge path is exercised): one plan each
    v_n := 0;
    WHILE GREATEST(public.team_wallet_free_total() - public.team_wallet_free_used(v_user), 0) > 0 AND v_n < 5 LOOP
      g := public.team_wallet_record_free_draft(v_user, v_client, 'Probe', false, gen_random_uuid(), NULL); v_n := v_n + 1;
    END LOOP;
    -- 2. three AI rows of one plan -> ONE charge row of -5000 keyed by the plan
    INSERT INTO public.workout_plan_exercises (plan_id, trainer_id, client_id, modality, plan_name, body_part, exercise_name, set_number, order_index, source)
    VALUES (p1, v_user, v_client, 'Strength Training', 'Probe plan 1', 'Push', 'Bench Press', 1, 1, 'ai'),
           (p1, v_user, v_client, 'Strength Training', 'Probe plan 1', 'Push', 'Bench Press', 2, 2, 'ai'),
           (p1, v_user, v_client, 'Strength Training', 'Probe plan 1', 'Pull', 'Barbell Row', 1, 3, 'ai');
    w := public.team_wallet_plan_row(p1);
    v_names := array_append(v_names, 'a new AI plan: one charge row of the fixed price'); v_expected := array_append(v_expected, 'rows 1, amount -5000, balance ' || (v_bal0 - 5000) || ', preview 2 exercises');
    v_results := array_append(v_results, 'rows ' || (SELECT count(*) FROM public.team_wallet x WHERE x.meta->>'plan_id' = p1::text) || ', amount ' || w.amount_paise || ', balance ' || w.balance_after_paise || ', preview ' || (w.meta->'preview'->>'exercise_count') || ' exercises');
    -- 3. more rows of the same plan (an edit, a retried sync) -> still one row
    INSERT INTO public.workout_plan_exercises (plan_id, trainer_id, client_id, modality, plan_name, body_part, exercise_name, set_number, order_index, source)
    VALUES (p1, v_user, v_client, 'Strength Training', 'Probe plan 1', 'Legs', 'Squat', 1, 4, 'ai');
    v_names := array_append(v_names, 'the same plan again: no second row'); v_expected := array_append(v_expected, '1');
    v_results := array_append(v_results, (SELECT count(*)::text FROM public.team_wallet x WHERE x.meta->>'plan_id' = p1::text));
    -- 4. a direct second charge call for the plan answers already
    g := public.team_wallet_charge_ai_plan(v_user, v_client, 'Probe', p1, NULL);
    v_names := array_append(v_names, 'charge called twice for one plan: already'); v_expected := array_append(v_expected, 'already true, bill 5000');
    v_results := array_append(v_results, 'already ' || (g->>'already') || ', bill ' || (g->>'bill_paise'));
    -- 5. a manual plan -> nothing
    INSERT INTO public.workout_plan_exercises (plan_id, trainer_id, client_id, modality, plan_name, body_part, exercise_name, set_number, order_index, source)
    VALUES (p2, v_user, v_client, 'Strength Training', 'Probe manual', 'Push', 'Bench Press', 1, 1, 'human');
    v_names := array_append(v_names, 'a manual plan: no wallet row'); v_expected := array_append(v_expected, '0');
    v_results := array_append(v_results, (SELECT count(*)::text FROM public.team_wallet x WHERE x.meta->>'plan_id' = p2::text));
    -- 6. an Essentials client's AI plan -> a free row, balance unchanged
    IF v_ess IS NOT NULL THEN
      INSERT INTO public.workout_plan_exercises (plan_id, trainer_id, client_id, modality, plan_name, body_part, exercise_name, set_number, order_index, source)
      VALUES (p3, v_user, v_ess, 'Strength Training', 'Probe essentials', 'Push', 'Bench Press', 1, 1, 'ai');
      w := public.team_wallet_plan_row(p3);
      v_names := array_append(v_names, 'an Essentials AI plan: free row, nothing charged'); v_expected := array_append(v_expected, 'free true, essentials true, amount 0, balance ' || (v_bal0 - 5000));
      v_results := array_append(v_results, 'free ' || (w.meta->>'free') || ', essentials ' || (w.meta->>'essentials') || ', amount ' || w.amount_paise || ', balance ' || public.team_wallet_balance(v_user));
    END IF;
    -- 7. the second billed plan: while the balance is negative the plan lands, a warning, no charge row;
    --    with money still in the wallet it is charged like any plan
    v_neg := public.team_wallet_balance(v_user) < 0;
    INSERT INTO public.workout_plan_exercises (plan_id, trainer_id, client_id, modality, plan_name, body_part, exercise_name, set_number, order_index, source)
    VALUES (p4, v_user, v_client, 'Strength Training', 'Probe plan 4', 'Push', 'Bench Press', 1, 1, 'ai');
    v_names := array_append(v_names, CASE WHEN v_neg THEN 'a billed plan while negative: rows stay, no charge row' ELSE 'a billed plan with money left: charged' END);
    v_expected := array_append(v_expected, CASE WHEN v_neg THEN 'plan rows 1, wallet rows 0, gate WALLET_NEGATIVE' ELSE 'plan rows 1, wallet rows 1, gate ' || CASE WHEN public.team_wallet_balance(v_user) < 0 THEN 'WALLET_NEGATIVE' ELSE 'ok' END END);
    v_results := array_append(v_results, 'plan rows ' || (SELECT count(*) FROM public.workout_plan_exercises e WHERE e.plan_id = p4) || ', wallet rows ' || (SELECT count(*) FROM public.team_wallet x WHERE x.meta->>'plan_id' = p4::text) || ', gate ' || COALESCE(public.team_wallet_ai_plan_gate(v_user, false, v_client)->>'reason', 'ok'));
    -- 8. a Rs 500 top-up (clears any negative first), the next plan is charged Rs 50
    v_b7 := public.team_wallet_balance(v_user);
    g := public.team_wallet_create_topup(v_user, 50000);
    PERFORM public.team_wallet_set_order((g->>'id')::uuid, 'order_probe_plan');
    g := public.team_wallet_mark_paid((g->>'id')::uuid, 'pay_probe_plan', NULL, 'upi', NULL, 'app_verify');
    INSERT INTO public.workout_plan_exercises (plan_id, trainer_id, client_id, modality, plan_name, body_part, exercise_name, set_number, order_index, source)
    VALUES (p5, v_user, v_client, 'Strength Training', 'Probe plan 5', 'Push', 'Bench Press', 1, 1, 'ai');
    v_names := array_append(v_names, 'after a Rs 500 top-up the next plan is charged Rs 50'); v_expected := array_append(v_expected, 'balance ' || (v_b7 + 50000 - 5000));
    v_results := array_append(v_results, 'balance ' || public.team_wallet_balance(v_user));
    -- 9. a legacy plan (existed before this rule) edited: no charge
    INSERT INTO public.team_wallet_legacy_plans (plan_id, trainer_id, client_id, essentials, created_at) VALUES (p2, v_user, v_client, false, now()) ON CONFLICT DO NOTHING;
    UPDATE public.workout_plan_exercises SET source = 'ai' WHERE plan_id = p2;
    INSERT INTO public.workout_plan_exercises (plan_id, trainer_id, client_id, modality, plan_name, body_part, exercise_name, set_number, order_index, source)
    VALUES (p2, v_user, v_client, 'Strength Training', 'Probe manual', 'Push', 'Incline Press', 1, 2, 'ai');
    v_names := array_append(v_names, 'a plan from before the rule, re-inserted as AI: no charge'); v_expected := array_append(v_expected, '0');
    v_results := array_append(v_results, (SELECT count(*)::text FROM public.team_wallet x WHERE x.meta->>'plan_id' = p2::text));
    -- 10. the free count is untouched by charged plans; the Wallet read names the price
    PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
    g := public.get_my_team_wallet(5, NULL);
    PERFORM set_config('request.jwt.claim.sub', '', true);
    v_names := array_append(v_names, 'get_my_team_wallet: price 5000, free_left 0'); v_expected := array_append(v_expected, 'price 5000, free_left 0');
    v_results := array_append(v_results, 'price ' || (g->>'ai_plan_price_paise') || ', free_left ' || (g->>'free_left'));
    RAISE EXCEPTION 'PROBE_DONE';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'PROBE_DONE' THEN
      v_names := array_append(v_names, 'probe stopped'); v_expected := array_append(v_expected, 'ran'); v_results := array_append(v_results, 'could not run: ' || SQLERRM);
    END IF;
  END;
  INSERT INTO plan_charge_probe (step, check_name, expected, result)
  SELECT n, v_names[n], v_expected[n], v_results[n] FROM generate_subscripts(v_names, 1) AS n;
END
$probe$;

INSERT INTO plan_charge_probe (step, check_name, expected, result)
SELECT 20, 'price constant', '5000', public.team_wallet_ai_plan_price_paise()::text
UNION ALL
SELECT 21, 'trigger in place', 'trg_team_wallet_plan_created', (SELECT tgname FROM pg_trigger WHERE tgname = 'trg_team_wallet_plan_created' LIMIT 1)
UNION ALL
SELECT 22, 'probe rows left behind', '0', (SELECT count(*)::text FROM public.team_wallet WHERE razorpay->>'order_id' = 'order_probe_plan' OR meta->>'plan_name' = 'Probe plan 1' OR meta->'preview'->>'plan_name' LIKE 'Probe %');

SELECT step, check_name, expected, result FROM plan_charge_probe ORDER BY step;
```

#### `supabase/functions/_shared/teamWallet.ts`

```ts
// Team Wallet helpers shared by wallet-create-order, wallet-verify-payment, wallet-checkout-page,
// wallet-settle-ai-plan, wallet-discard-ai-plan, ai-plan-draft and the razorpay-webhook branch (2 Nov 2026).
// Every write goes through the team_wallet_* SQL functions (migration 20261102160000); these helpers only
// authenticate the caller, map the SQL refusals ('WALLET_CODE: sentence') to HTTP answers, sign the checkout
// page token, trim the Razorpay payment entity and send the top-up receipt push.
// Plan: odds-app/docs/team-wallet-plan.md. Spec: odds-app/docs/ios-team-wallet-handoff.md.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { pushToStaff } from "./assistantPush.ts";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/** The signed-in staff member behind the bearer token, with a service-role client. */
export async function walletCaller(req: Request): Promise<{ svc: SupabaseClient; uid: string } | Response> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "WALLET_SIGN_IN: Sign in to use your wallet." }, 401);
  const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data, error } = await svc.auth.getUser(token);
  const uid = data?.user?.id;
  if (error || !uid) return json({ error: "WALLET_SIGN_IN: Sign in to use your wallet." }, 401);
  return { svc, uid };
}

/** 'WALLET_CODE: sentence' from the SQL functions becomes { error } with the matching status; anything else is
    a plain 500 with a plain sentence (the apps translate through friendlyError). */
export function walletErrorResponse(e: unknown, fallback = "The wallet is not reachable right now. Try again."): Response {
  const msg = String((e as { message?: unknown } | null)?.message ?? e ?? "").trim();
  const code = msg.match(/^(WALLET_[A-Z_]+):/)?.[1];
  if (code) return json({ error: msg, code }, code === "WALLET_FORBIDDEN" || code === "WALLET_SIGN_IN" ? 403 : code === "WALLET_INSUFFICIENT" ? 402 : 400);
  if (/PGRST202|could not find the function/i.test(msg)) return json({ error: "WALLET_NOT_SET_UP: The wallet is not set up on the server yet.", code: "WALLET_NOT_SET_UP" }, 503);
  console.error("[team-wallet]", msg);
  return json({ error: fallback, detail: msg.slice(0, 200) }, 500);
}

export const walletCode = (e: unknown): string | null => String((e as { message?: unknown } | null)?.message ?? "").match(/^(WALLET_[A-Z_]+):/)?.[1] ?? null;

/** "Rs 1,00,000" with Indian grouping, whole rupees from paise; the same rule as the app's teamWallet.ts. */
export function rupees(paise: number): string {
  const n = Math.round(Math.abs(paise) / 100);
  const s = String(n);
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  const grouped = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3 : last3;
  return `${paise < 0 ? "- " : ""}Rs ${grouped}`;
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The checkout page is public (the WebView sends no headers), so it is reached with a short-lived token that
    only the order function can mint: tx id, expiry and an HMAC with the Razorpay key secret (never on the page). */
export async function signCheckoutToken(tx: string, ttlSec = 35 * 60): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const mac = (await hmacHex(Deno.env.get("RAZORPAY_KEY_SECRET")!, `checkout:${tx}:${exp}`)).slice(0, 40);
  return `${tx}.${exp}.${mac}`;
}
export async function verifyCheckoutToken(token: string): Promise<string | null> {
  const [tx, expS, mac] = String(token ?? "").split(".");
  if (!/^[0-9a-f-]{36}$/i.test(tx ?? "") || !/^\d+$/.test(expS ?? "") || !mac) return null;
  if (Number(expS) < Math.floor(Date.now() / 1000)) return null;
  const want = (await hmacHex(Deno.env.get("RAZORPAY_KEY_SECRET")!, `checkout:${tx}:${expS}`)).slice(0, 40);
  return timingSafeEqual(want, mac) ? tx : null;
}

/** The part of a Razorpay payment entity worth keeping on the row (no card data, no raw notes). */
export function trimPayment(p: any): Record<string, unknown> | null {
  if (!p || typeof p !== "object") return null;
  const out: Record<string, unknown> = {};
  for (const k of ["id", "entity", "status", "amount", "currency", "method", "order_id", "email", "contact", "vpa", "bank", "wallet", "error_code", "error_description", "error_reason", "created_at", "captured", "fee", "tax"]) {
    if (p[k] != null) out[k] = p[k];
  }
  return out;
}

/** "Rs 2,000 added to your wallet" to the person's phones, logged in staff_push_log. Never throws. */
export async function sendTopupReceipt(svc: SupabaseClient, row: any, source: string): Promise<void> {
  try {
    const userId = String(row?.user_id ?? "");
    if (!userId) return;
    const title = `${rupees(Number(row.amount_paise))} added to your wallet`;
    const body = `Balance ${rupees(Number(row.balance_after_paise ?? 0))}.${row.role === "trainer" ? " An Odds AI plan costs Rs 50, deducted when you create it." : ""}`;
    const data = { type: "wallet_topup", route: "wallet", tx_id: String(row.id) };
    let r: { success: number; failure: number; errors?: string[] } = { success: 0, failure: 0 };
    try { r = await pushToStaff({ supabase: svc, userId, title, body, data, channelId: "default" }); } catch (e) { r = { success: 0, failure: 1, errors: [String(e)] }; }
    const { error } = await svc.from("staff_push_log").insert({ source, user_id: userId, title, body, push_type: "wallet_topup", data, success: r.success, failure: r.failure, errors: r.errors?.length ? r.errors : null });
    if (error) console.warn("[team-wallet] push log not written:", error.message);
  } catch (e) {
    console.warn("[team-wallet] receipt push failed:", String(e));
  }
}

/** The razorpay-webhook branch: payment.captured credits (idempotent), payment.failed notes the failure while the
    row is still pending, refund.processed records a dashboard refund once. Always answers 200 so Razorpay stops
    retrying; the SQL functions are the source of truth for what already happened. */
export async function handleWalletWebhook(svc: SupabaseClient, event: string, payload: any, walletTx: string): Promise<Response> {
  const payment = payload?.payload?.payment?.entity;
  const refund = payload?.payload?.refund?.entity;
  try {
    if (event === "payment.captured" || event === "order.paid") {
      if (!payment?.id) return json({ ok: true, ignored: "no payment id" });
      const { data, error } = await svc.rpc("team_wallet_mark_paid", { p_tx: walletTx, p_payment_id: payment.id, p_signature: null, p_method: payment.method ?? null, p_payment: trimPayment(payment), p_event: event });
      if (error) { console.warn("[razorpay-webhook] wallet mark_paid:", error.message); return json({ ok: true, wallet: "refused", reason: error.message }); }
      if (data?.credited_now === true) await sendTopupReceipt(svc, data, "razorpay-webhook");
      return json({ ok: true, wallet: data?.credited_now ? "credited" : "already_paid", tx_id: walletTx });
    }
    if (event === "payment.failed") {
      const reason = payment?.error_description || payment?.error_reason || "Payment failed";
      const { error } = await svc.rpc("team_wallet_mark_failed", { p_tx: walletTx, p_reason: String(reason).slice(0, 200), p_payment: trimPayment(payment), p_event: event });
      if (error) console.warn("[razorpay-webhook] wallet mark_failed:", error.message);
      return json({ ok: true, wallet: "failed_noted", tx_id: walletTx });
    }
    if (event === "refund.processed") {
      const paymentId = refund?.payment_id || payment?.id;
      if (!refund?.id || !paymentId) return json({ ok: true, ignored: "no refund id" });
      const { data, error } = await svc.rpc("team_wallet_refund", { p_payment_id: paymentId, p_refund_id: refund.id, p_amount_paise: Number(refund.amount) || 0, p_payload: trimPayment(refund) });
      if (error) { console.warn("[razorpay-webhook] wallet refund:", error.message); return json({ ok: true, wallet: "refund_refused", reason: error.message }); }
      return json({ ok: true, wallet: data?.credited_now ? "refund_recorded" : "refund_already_recorded", tx_id: walletTx });
    }
    return json({ ok: true, ignored: event, wallet: true });
  } catch (e) {
    console.error("[razorpay-webhook] wallet branch:", e);
    return json({ ok: true, wallet: "error", reason: String((e as Error)?.message ?? e) });
  }
}
```

#### `supabase/functions/wallet-create-order/index.ts`

```ts
// wallet-create-order (Team Wallet, 2 Nov 2026): the signed-in staff member asks to add money.
// Body: { amount_inr: whole rupees }. The limits (min Rs 500, Rs 5,000 per IST day, at most 2 pending) are
// checked by team_wallet_create_topup under the user's lock; the Razorpay order (primary account, amount from
// the row, never from a second call) is stored on the row with team_wallet_set_order.
// Answer: { tx_id, order_id, amount_paise, currency, key_id, checkout_url, prefill }.
// Refusals: { error: 'WALLET_CODE: sentence' } (400 / 403), WALLET_PROVIDER (502) when Razorpay refuses the order.
// Spec: odds-app/docs/ios-team-wallet-handoff.md section 2.3.

import { corsHeaders, json, rupees, signCheckoutToken, walletCaller, walletErrorResponse } from "../_shared/teamWallet.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const keyId = Deno.env.get("RAZORPAY_KEY_ID");
    const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET");
    if (!keyId || !keySecret) return json({ error: "WALLET_PROVIDER: Razorpay is not configured on the server." }, 500);

    const caller = await walletCaller(req);
    if (caller instanceof Response) return caller;
    const { svc, uid } = caller;

    const body = await req.json().catch(() => ({}));

    // Reopen: a pending top-up tapped in the history gets a fresh checkout link for its existing order (no new row).
    if (body?.reopen_tx_id) {
      const txId = String(body.reopen_tx_id);
      if (!/^[0-9a-f-]{36}$/i.test(txId)) return json({ error: "WALLET_NOT_FOUND: This top-up was not found." }, 404);
      const { data: row } = await svc.from("team_wallet").select("id, user_id, kind, status, amount_paise, created_at, razorpay").eq("id", txId).maybeSingle();
      if (!row || row.user_id !== uid || row.kind !== "topup" || !row.razorpay?.order_id) return json({ error: "WALLET_NOT_FOUND: This top-up was not found." }, 404);
      if (row.status === "paid") return json({ error: "WALLET_NOT_FOUND: This top-up is already in your wallet." }, 400);
      if (row.status !== "pending" || Date.now() - new Date(row.created_at).getTime() > 30 * 60_000) return json({ error: "WALLET_NOT_FOUND: This top-up ran out. Tap Add money again." }, 410);
      const token = await signCheckoutToken(txId);
      const { data: prof } = await svc.from("profiles").select("first_name, last_name, email, phone").eq("id", uid).maybeSingle();
      return json({
        tx_id: txId, order_id: row.razorpay.order_id, amount_paise: Number(row.amount_paise), currency: "INR", key_id: keyId,
        checkout_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/wallet-checkout-page?tx=${encodeURIComponent(txId)}&t=${encodeURIComponent(token)}`,
        prefill: { name: [prof?.first_name, prof?.last_name].filter(Boolean).join(" ").trim() || "Odds staff", email: prof?.email ?? "", contact: prof?.phone ?? "" },
        reopened: true,
      });
    }

    const amountInr = Number(body?.amount_inr);
    if (!Number.isInteger(amountInr) || amountInr <= 0) return json({ error: "WALLET_MIN_AMOUNT: Enter whole rupees, at least Rs 500." }, 400);
    const amountPaise = amountInr * 100;

    // 1. the pending row (all the limit checks live in SQL)
    const { data: row, error: rowErr } = await svc.rpc("team_wallet_create_topup", { p_user: uid, p_amount_paise: amountPaise });
    if (rowErr) return walletErrorResponse(rowErr);
    const txId = String(row.id);

    // 2. the Razorpay order on the primary account
    const { data: prof } = await svc.from("profiles").select("first_name, last_name, email, phone").eq("id", uid).maybeSingle();
    const name = [prof?.first_name, prof?.last_name].filter(Boolean).join(" ").trim() || "Odds staff";
    const auth = btoa(`${keyId}:${keySecret}`);
    const rpRes = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: amountPaise,
        currency: "INR",
        receipt: `tw_${txId}`.slice(0, 40),
        payment_capture: 1,
        notes: { purpose: "team_wallet_topup", wallet_tx_id: txId, user_id: uid },
      }),
    });
    const rp = await rpRes.json().catch(() => ({}));
    if (!rpRes.ok || !rp?.id) {
      const why = String(rp?.error?.description ?? "Razorpay did not accept the order").slice(0, 200);
      console.error("[wallet-create-order] Razorpay refused:", rp);
      await svc.rpc("team_wallet_mark_failed", { p_tx: txId, p_reason: why, p_payment: null, p_event: "order_refused" });
      return json({ error: `WALLET_PROVIDER: Razorpay did not accept the order. Try again. (${why})` }, 502);
    }
    const { error: setErr } = await svc.rpc("team_wallet_set_order", { p_tx: txId, p_order_id: rp.id });
    if (setErr) { console.error("[wallet-create-order] set_order:", setErr.message); return walletErrorResponse(setErr); }

    const token = await signCheckoutToken(txId);
    const checkoutUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/wallet-checkout-page?tx=${encodeURIComponent(txId)}&t=${encodeURIComponent(token)}`;
    console.log(`[wallet-create-order] ${uid} ${rupees(amountPaise)} tx ${txId} order ${rp.id}`);
    return json({
      tx_id: txId,
      order_id: rp.id,
      amount_paise: amountPaise,
      currency: "INR",
      key_id: keyId,
      checkout_url: checkoutUrl,
      prefill: { name, email: prof?.email ?? "", contact: prof?.phone ?? "" },
      row,
    });
  } catch (e) {
    console.error("[wallet-create-order]", e);
    return walletErrorResponse(e);
  }
});
```

#### `supabase/functions/wallet-verify-payment/index.ts`

```ts
// wallet-verify-payment (Team Wallet, 2 Nov 2026): the checkout page handed the app a payment; credit it.
// Body: { tx_id, razorpay_order_id, razorpay_payment_id, razorpay_signature }.
// Checks: the row is the caller's own pending (or failed / expired: a late success is real money) top-up carrying
// that order id; HMAC-SHA256(order_id|payment_id, key secret) with a timing-safe compare; then the payment is
// fetched from Razorpay and must be captured, INR and the row's amount. team_wallet_mark_paid credits once (the
// webhook calls the same function); the caller that made the transition sends the receipt push.
// Answer: { ok: true, row, balance_paise, credited_now }. Refusals: WALLET_SIGNATURE / WALLET_NOT_FOUND /
// WALLET_NOT_CAPTURED / WALLET_AMOUNT (400). Spec: odds-app/docs/ios-team-wallet-handoff.md section 2.3.

import { corsHeaders, hmacHex, json, sendTopupReceipt, timingSafeEqual, trimPayment, walletCaller, walletErrorResponse } from "../_shared/teamWallet.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const keyId = Deno.env.get("RAZORPAY_KEY_ID");
    const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET");
    if (!keyId || !keySecret) return json({ error: "WALLET_PROVIDER: Razorpay is not configured on the server." }, 500);

    const caller = await walletCaller(req);
    if (caller instanceof Response) return caller;
    const { svc, uid } = caller;

    const body = await req.json().catch(() => ({})) as { tx_id?: string; razorpay_order_id?: string; razorpay_payment_id?: string; razorpay_signature?: string };
    const txId = String(body?.tx_id ?? "");
    const orderId = String(body?.razorpay_order_id ?? "");
    const paymentId = String(body?.razorpay_payment_id ?? "");
    const signature = String(body?.razorpay_signature ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(txId) || !orderId || !paymentId || !signature) return json({ error: "WALLET_NOT_FOUND: The payment details are incomplete." }, 400);

    const { data: row, error: rowErr } = await svc.from("team_wallet").select("id, user_id, kind, status, amount_paise, razorpay").eq("id", txId).maybeSingle();
    if (rowErr) return walletErrorResponse(rowErr);
    if (!row || row.user_id !== uid || row.kind !== "topup") return json({ error: "WALLET_NOT_FOUND: This top-up was not found." }, 404);
    if (String(row.razorpay?.order_id ?? "") !== orderId) return json({ error: "WALLET_NOT_FOUND: This payment does not belong to this top-up." }, 400);
    if (row.status === "paid") {
      const { data: bal } = await svc.rpc("team_wallet_balance", { p_user: uid });
      return json({ ok: true, already: true, credited_now: false, row, balance_paise: Number(bal ?? 0) });
    }

    // 1. the signature
    const expected = await hmacHex(keySecret, `${orderId}|${paymentId}`);
    if (!timingSafeEqual(expected, signature)) {
      console.warn(`[wallet-verify-payment] signature mismatch tx ${txId} payment ${paymentId}`);
      if (row.status === "pending") await svc.rpc("team_wallet_mark_failed", { p_tx: txId, p_reason: "signature mismatch", p_payment: null, p_event: "app_verify" });
      return json({ error: "WALLET_SIGNATURE: The payment could not be verified. If money left your account it will be added within a few minutes." }, 400);
    }

    // 2. the payment itself, from Razorpay
    const rpRes = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`, { headers: { Authorization: `Basic ${btoa(`${keyId}:${keySecret}`)}` } });
    const payment = await rpRes.json().catch(() => null);
    if (!rpRes.ok || !payment?.id) {
      console.error("[wallet-verify-payment] payment fetch failed:", payment);
      return json({ error: "WALLET_NOT_CAPTURED: The payment is still processing. Your wallet updates when it completes." }, 400);
    }
    if (payment.status !== "captured") return json({ error: "WALLET_NOT_CAPTURED: The payment is still processing. Your wallet updates when it completes.", status: payment.status }, 400);
    if (payment.order_id !== orderId || payment.currency !== "INR" || Number(payment.amount) !== Number(row.amount_paise)) {
      console.warn(`[wallet-verify-payment] amount / order mismatch tx ${txId}:`, { order: payment.order_id, currency: payment.currency, amount: payment.amount, row: row.amount_paise });
      return json({ error: "WALLET_AMOUNT: The payment does not match this top-up. Odds will check it." }, 400);
    }

    // 3. credit once
    const { data: paid, error: payErr } = await svc.rpc("team_wallet_mark_paid", { p_tx: txId, p_payment_id: paymentId, p_signature: signature, p_method: payment.method ?? null, p_payment: trimPayment(payment), p_event: "app_verify" });
    if (payErr) return walletErrorResponse(payErr);
    if (paid?.credited_now === true) await sendTopupReceipt(svc, paid, "wallet-verify-payment");
    console.log(`[wallet-verify-payment] ${uid} tx ${txId} ${paid?.credited_now ? "credited" : "already paid"} balance ${paid?.balance_after_paise}`);
    const { credited_now, ...publicRow } = paid ?? {};
    return json({ ok: true, credited_now: credited_now === true, row: publicRow, balance_paise: Number(publicRow?.balance_after_paise ?? 0) });
  } catch (e) {
    console.error("[wallet-verify-payment]", e);
    return walletErrorResponse(e);
  }
});
```

#### `supabase/functions/wallet-settle-ai-plan/index.ts`

```ts
// wallet-settle-ai-plan (Team Wallet, 2 Nov 2026): "Deduct from wallet", one tap. Body: { tx_id }.
// team_wallet_settle marks the caller's pending bill paid under the lock and returns the held draft (a paid bill
// returns it again, so a lost answer never loses a paid draft). Answer: { ok, already, result, balance_paise, row }
// where result is the ai-plan-draft answer ({ draft, dropped, sources, model, generated_at }) the app applies
// exactly as before. Refusals: WALLET_INSUFFICIENT (402, the bill stays pending), WALLET_CANCELLED, WALLET_NOT_FOUND.
// Spec: odds-app/docs/ios-team-wallet-handoff.md section 2.3.

import { corsHeaders, json, walletCaller, walletErrorResponse } from "../_shared/teamWallet.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const caller = await walletCaller(req);
    if (caller instanceof Response) return caller;
    const { svc, uid } = caller;
    const body = await req.json().catch(() => ({}));
    const txId = String(body?.tx_id ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(txId)) return json({ error: "WALLET_NOT_FOUND: This bill was not found." }, 400);
    const { data, error } = await svc.rpc("team_wallet_settle", { p_tx: txId, p_user: uid });
    if (error) return walletErrorResponse(error);
    console.log(`[wallet-settle-ai-plan] ${uid} tx ${txId} ${data?.already ? "already paid" : "paid"} balance ${data?.balance_paise}`);
    return json({ ok: true, already: data?.already === true, result: data?.draft ?? null, balance_paise: Number(data?.balance_paise ?? 0), row: data?.row ?? null });
  } catch (e) {
    console.error("[wallet-settle-ai-plan]", e);
    return walletErrorResponse(e);
  }
});
```

#### `supabase/functions/wallet-discard-ai-plan/index.ts`

```ts
// wallet-discard-ai-plan (Team Wallet, 2 Nov 2026): "Discard" the drafted plan. Body: { tx_id }.
// team_wallet_discard cancels the caller's pending bill and removes the held draft; nothing is charged. At most 3
// discards per trainer per IST day (WALLET_DISCARD_LIMIT). Answer: { ok, already }.
// Spec: odds-app/docs/ios-team-wallet-handoff.md section 2.3.

import { corsHeaders, json, walletCaller, walletErrorResponse } from "../_shared/teamWallet.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const caller = await walletCaller(req);
    if (caller instanceof Response) return caller;
    const { svc, uid } = caller;
    const body = await req.json().catch(() => ({}));
    const txId = String(body?.tx_id ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(txId)) return json({ error: "WALLET_NOT_FOUND: This bill was not found." }, 400);
    const { data, error } = await svc.rpc("team_wallet_discard", { p_tx: txId, p_user: uid });
    if (error) return walletErrorResponse(error);
    console.log(`[wallet-discard-ai-plan] ${uid} tx ${txId} ${data?.already ? "already discarded" : "discarded"}`);
    return json({ ok: true, already: data?.already === true, row: data?.row ?? null });
  } catch (e) {
    console.error("[wallet-discard-ai-plan]", e);
    return walletErrorResponse(e);
  }
});
```

#### `supabase/functions/ai-plan-draft/index.ts`

```ts
// ai-plan-draft (2026-10-16, owner: "if an Essentials client has no valid plan, the trainer makes it
// with the help of AI: pick 1. Push / Pull / Legs 2. Full Body (upper / lower) 3. Bro split, press
// Generate workout plan, and the plan comes from the client's latest QHP, medical and blood reports,
// built from OUR exercises, editable in the same Create Plan form").
//
// Writes NOTHING. Two modes:
//   { client_id, preview: true }                       who may use it + what the AI will read (no AI call)
//   { client_id, split, sessions_per_week?, note? }    the draft: sections of exercises from exercises_db
//                                                      (Strength + Cardio, the Strength Training pool) with
//                                                      sets (reps / duration, rest, tempo, RIR, notes),
//                                                      plus why-this-plan and avoided lines.
// Access: admin, super_admin, coach; the client's trainer (trainer_clients); or a trainer booked with the
// client today (IST) or later (the Essentials auction winner). Every client the caller may plan for since
// 21 Oct 2026 (owner: "ask AI or manual for every new plan"; Essentials clients only before that). The
// preview still says whether the client is on Essentials. Sessions a week: the client's weekly slots,
// else the package (sessions a cycle spread over its weeks), else 3, clamped 2 to 6.
// Every exercise name is checked against the database. Since 16 Oct 2026 (owner) the model may add at
// most 2 exercises a section that are not in the library when clearly more effective ("new": true,
// returned with in_db false; the app labels them NOT IN DB and add_ai_exercises_to_library saves them
// with the plan); any other unknown name is dropped and reported. Quantities follow what our trainers
// write (QUANTITY, measured on the last 100 plans per modality).
// Model: PLAN_AI_MODEL secret, else gemini-3.8-flash (owner), falling back to gemini-3.6-flash when
// Google refuses the name. Docs: docs/features/android/trainer/ai-plan-assistant.md
// Team Wallet (2 Nov 2026; charging rule final on 3 Nov 2026, owner): GENERATING IS FREE, any number of times. A
// TRAINER is charged ONCE per plan, a FIXED price (team_wallet_ai_plan_price_paise, Rs 50 for now), when the plan is
// created: the trigger trg_team_wallet_plan_created on workout_plan_exercises (migration 20261103120000) writes the one
// wallet row (a free 0-row while the 3 free plans last, free for Essentials, nothing for manual plans). This function
// writes NOTHING to the wallet: the preview carries `wallet` (the standing: free count, the price, a negative balance)
// so the Create Plan chooser and the Create Plan button can say what will happen; a draft answers the same figures
// under `wallet` with charge_at 'plan_create'. Admins, super admins and coaches are never charged. While the wallet
// migration is not run (functions missing) wallet is null.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { postChatCompletion } from "../_shared/ai-router.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const MODEL = Deno.env.get("PLAN_AI_MODEL") ?? "google/gemini-3.8-flash";
const FALLBACK_MODEL = "google/gemini-3.6-flash";
const AI_TIMEOUT_MS = 70_000;

type SplitKey = "ppl" | "upper_lower" | "bro";
const SPLITS: Record<SplitKey, { label: string; sections: { name: string; focus: string }[] }> = {
  ppl: {
    label: "Push / Pull / Legs",
    sections: [
      { name: "Push", focus: "chest, shoulders, triceps" },
      { name: "Pull", focus: "back, biceps, rear shoulders" },
      { name: "Legs", focus: "quads, hamstrings, glutes, calves, core" },
    ],
  },
  upper_lower: {
    label: "Full Body (Upper / Lower)",
    sections: [
      { name: "Upper Body", focus: "chest, back, shoulders, arms" },
      { name: "Lower Body", focus: "legs, glutes, core" },
    ],
  },
  bro: {
    label: "Bro split",
    sections: [
      { name: "Chest", focus: "chest, with some triceps" },
      { name: "Back", focus: "back, with some biceps" },
      { name: "Shoulders", focus: "shoulders and core" },
      { name: "Arms", focus: "biceps, triceps, forearms" },
      { name: "Legs", focus: "quads, hamstrings, glutes, calves" },
    ],
  },
};
const CONDITIONING = "Conditioning";

// How much our trainers actually put in a plan (owner, 16 Oct 2026: "check the last 100 plans of all
// modalities, how many exercises our trainers add, and give similar results, only for quantity, hard
// coded"). Measured live the same day on the last 100 plans per modality (workout_plan_exercises,
// plan_id set): exercises per section as p25 / median / p75, sections per plan as median.
//   Strength (100 plans, 16 Sep to 16 Oct 2026): 2 sections a plan (1 to 3), 9 exercises a section
//     (7 to 15), 22.5 a plan (15 to 31); trainers write 1 set row an exercise.
//   Yoga 35 a plan (26 to 46), Pilates 16 (10 to 26), Boxing 8 (6 to 9), Aerobics 6 (5 to 7); 1 section.
// The assistant drafts Strength Training plans (Essentials); the other rows are kept for when it
// drafts other modalities.
const QUANTITY = {
  strength: { perSection: { min: 8, target: 9, max: 10 }, hardCap: 14 },
  conditioning: { perSection: { min: 4, target: 6, max: 7 }, hardCap: 8 }, // Aerobics plans: 6 (5 to 7)
  yoga: { perPlan: { min: 26, target: 35, max: 46 } },
  pilates: { perPlan: { min: 10, target: 16, max: 26 } },
  boxing: { perPlan: { min: 6, target: 8, max: 9 } },
  aerobics: { perPlan: { min: 5, target: 6, max: 7 } },
} as const;
// At most this many exercises a section may be new (not in exercises_db yet).
const MAX_NEW_PER_SECTION = 2;
const GROUPS = ["Chest", "Back", "Shoulders", "Arms", "Legs", "Core", "Warm-up", "Full Body", "Glutes"];

const ESSENTIALS_RE = /^(odds\s+)?essentials?(\s+by\s+odds)?$/i;
const isEssentials = (sub: unknown) => typeof sub === "string" && ESSENTIALS_RE.test(sub.trim().replace(/\s+/g, " "));

const istToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const daysAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const norm = (s: string) => s.toLowerCase().replace(/[‐-―−]/g, "-").replace(/\s+/g, " ").trim();
const clip = (s: unknown, n: number) => (typeof s === "string" ? (s.length > n ? s.slice(0, n) + "…" : s) : s);

/** Drop empties, media and very long values from the QHP JSON so every real value fits in the prompt. */
const compact = (v: any, depth = 0): any => {
  if (v == null || depth > 6) return undefined;
  if (typeof v === "string") { const t = v.trim(); return t ? clip(t, 300) : undefined; }
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (Array.isArray(v)) {
    const out = v.slice(0, 20).map((x) => compact(x, depth + 1)).filter((x) => x !== undefined);
    return out.length ? out : undefined;
  }
  if (typeof v === "object") {
    const out: Record<string, any> = {};
    for (const [k, x] of Object.entries(v)) {
      if (/url|photo|image|video|signature|file|base64|audio|thumbnail/i.test(k)) continue;
      const c = compact(x, depth + 1);
      if (c !== undefined) out[k] = c;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return undefined;
};
const capJson = (v: unknown, max: number) => { const s = JSON.stringify(v ?? null); return s.length > max ? s.slice(0, max) + "…" : s; };
const ageFrom = (dob: unknown) => {
  if (typeof dob !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(dob)) return null;
  const d = new Date(dob.slice(0, 10)); const n = new Date();
  let a = n.getFullYear() - d.getFullYear(); if (n.getMonth() < d.getMonth() || (n.getMonth() === d.getMonth() && n.getDate() < d.getDate())) a--;
  return a > 0 && a < 120 ? a : null;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Not signed in" }, 401);
    const url = Deno.env.get("SUPABASE_URL")!;
    const svc = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: userData, error: userErr } = await svc.auth.getUser(token);
    const uid = userData?.user?.id;
    if (userErr || !uid) return json({ error: "Not signed in" }, 401);

    const body = await req.json().catch(() => ({}));
    const clientId = String(body?.client_id ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(clientId)) return json({ error: "client_id is required" }, 400);
    const preview = body?.preview === true;

    // ---- who may plan for this client ----
    const [{ data: prof }, { data: client }] = await Promise.all([
      svc.from("profiles").select("role, first_name, last_name").eq("id", uid).maybeSingle(),
      svc.from("clients").select("id, first_name, last_name, goal, short_term_goal, date_of_birth, subscription_type, weekly_protocol, sessions_per_cycle, cycle_type").eq("id", clientId).maybeSingle(),
    ]);
    if (!client) return json({ error: "Client not found" }, 404);
    const role = String(prof?.role ?? "");
    let allowed = ["admin", "super_admin", "coach"].includes(role);
    if (!allowed) {
      const { data: link } = await svc.from("trainer_clients").select("client_id").eq("trainer_id", uid).eq("client_id", clientId).limit(1);
      allowed = (link?.length ?? 0) > 0;
    }
    if (!allowed) {
      const from = new Date(new Date(`${istToday()}T00:00:00Z`).getTime() - 330 * 60_000).toISOString();
      const { data: booked } = await svc.from("session_schedule").select("id, status").eq("trainer_id", uid).eq("client_id", clientId).gte("scheduled_datetime", from).limit(20);
      allowed = (booked ?? []).some((b: any) => (b.status ?? "") !== "cancelled");
    }
    const essentials = isEssentials(client.subscription_type);
    const clientName = [client.first_name, client.last_name].filter(Boolean).join(" ").trim() || "Client";
    const slots: { day?: string; time?: string; modality?: string }[] = Array.isArray(client.weekly_protocol?.slots) ? client.weekly_protocol.slots : [];
    // Sessions a week: the weekly slots, else the package (sessions a cycle over the cycle's weeks), else 3.
    const perCycle = Number(client.sessions_per_cycle) || 0;
    const cycleType = String(client.cycle_type ?? "").toLowerCase();
    const cycleWeeks = /week/.test(cycleType) ? 1 : /quarter|3 ?month/.test(cycleType) ? 13 : 4.3;
    const fromPackage = perCycle ? Math.round(perCycle / cycleWeeks) : 0;
    const suggested = Math.min(6, Math.max(2, slots.length || fromPackage || 3));

    // ---- what the AI reads (also shown in the preview) ----
    const safe = async <T>(p: PromiseLike<{ data: T | null; error: any }>): Promise<T | null> => { try { const r = await p; return r.error ? null : r.data; } catch { return null; } };
    const [qhpRows, medRows, bloodRows, summaryRows, recentRows] = await Promise.all([
      safe(svc.from("coach_assessment").select("assessment_date, completed, new_client_assessment_data, existing_client_assessment_data, ai_biomechanical, mechanical_score").eq("client_id", clientId).not("completed", "is", null).is("cancelled", null).order("completed", { ascending: false }).limit(1)),
      safe(svc.from("client_medical_history").select("category, severity, title, description, diagnosis, is_ongoing, status, event_date, end_date").eq("client_id", clientId).order("event_date", { ascending: false }).limit(25)),
      safe(svc.from("blood_report_markers").select("test_date, category_name, marker_name, value, unit, reference_min, reference_max, status").eq("client_id", clientId).order("test_date", { ascending: false }).limit(300)),
      safe(svc.from("client_health_summary").select("briefing_date, context_summary").eq("client_id", clientId).lte("briefing_date", istToday()).order("briefing_date", { ascending: false }).limit(1)),
      safe(svc.from("workout_exercises").select("session_date, modality, session_name, exercise_name").eq("client_id", clientId).gte("session_date", daysAgo(30)).limit(400)),
    ]);
    const qhp: any = (qhpRows as any[] | null)?.[0] ?? null;
    const qhpData = qhp ? (qhp.new_client_assessment_data ?? qhp.existing_client_assessment_data ?? null) : null;
    const standardized = qhpData?.["Standardized Assessment"] ?? qhpData ?? null;
    const blood = (bloodRows as any[] | null) ?? [];
    const bloodDates = [...new Set(blood.map((b) => b.test_date).filter(Boolean))].slice(0, 2);
    const bloodRecent = blood.filter((b) => bloodDates.includes(b.test_date));
    const bloodFlags = bloodRecent.filter((b) => b.status && !/^normal$/i.test(String(b.status)));
    const med = (medRows as any[] | null) ?? [];
    const ctxSummary: any = (summaryRows as any[] | null)?.[0]?.context_summary ?? null;
    const recent = (recentRows as any[] | null) ?? [];
    const recentSessions = new Set(recent.map((r) => `${r.session_date}|${r.session_name ?? ""}`)).size;

    const sources = {
      qhp_date: qhp?.assessment_date ?? null,
      blood_date: bloodDates[0] ?? null,
      blood_flags: bloodFlags.length,
      medical_items: med.length,
      health_context: !!ctxSummary,
      sessions_last_30_days: recentSessions,
      weekly_slots: slots.map((s) => ({ day: s.day ?? null, time: s.time ?? null, modality: s.modality ?? null })),
      suggested_sessions_per_week: suggested,
    };
    const splits = (Object.keys(SPLITS) as SplitKey[]).map((k) => ({ key: k, label: SPLITS[k].label, sections: SPLITS[k].sections.map((s) => s.name) }));

    // ---- the wallet standing (trainers are charged at plan creation; null while the wallet is not set up) ----
    // Free plans (owner, 2 Nov 2026 evening): the first 3 for non-Essentials clients are free, Essentials always free.
    // Since 3 Nov 2026 (owner) the money moves ONCE per plan, at Create Plan, a fixed price (price_paise); generating is
    // free, so nothing here refuses a draft. The gate takes the client so the chooser can show the standing for it.
    type WalletGate = { charges: boolean; balance_paise: number; negative: boolean; bill_paise: number | null; price_paise: number | null; charge_at: string; free_total: number; free_used: number; free_left: number; essentials: boolean; free_this: boolean; billed: boolean; pending_bill: any; ok: boolean; reason: string | null; line: string | null };
    let wallet: WalletGate | null = null;
    {
      let { data: g, error: gErr } = await svc.rpc("team_wallet_ai_plan_gate", { p_user: uid, p_essentials: essentials, p_client: clientId });
      // Before migration 20261103110000 the gate has two arguments: ask the old way so nothing breaks in between.
      if (gErr && /PGRST202|could not find the function/i.test(gErr.message ?? "")) ({ data: g, error: gErr } = await svc.rpc("team_wallet_ai_plan_gate", { p_user: uid, p_essentials: essentials }));
      if (gErr) { if (!/PGRST202|could not find the function/i.test(gErr.message ?? "")) console.warn("[ai-plan-draft] wallet gate:", gErr.message); }
      else if (g && typeof g === "object") {
        wallet = {
          charges: g.charges === true, balance_paise: Number(g.balance_paise) || 0, negative: g.negative === true || Number(g.balance_paise) < 0,
          bill_paise: g.bill_paise == null ? null : Number(g.bill_paise),
          price_paise: g.price_paise == null ? null : Number(g.price_paise), charge_at: typeof g.charge_at === "string" ? g.charge_at : "draft",
          free_total: Number(g.free_total) || 0, free_used: Number(g.free_used) || 0, free_left: Number(g.free_left) || 0,
          essentials: g.essentials === true, free_this: g.free_this !== false, billed: g.billed === true,
          pending_bill: g.pending_bill ?? null, ok: g.ok !== false, reason: g.reason ?? null, line: g.line ?? null,
        };
      }
    }

    if (preview) {
      // eligible = allowed since 21 Oct 2026 (every client the caller may plan for); essentials is information.
      return json({ eligible: allowed, allowed, essentials, client_name: clientName, sources, splits, model: MODEL.replace(/^google\//, ""), wallet });
    }
    if (!allowed) return json({ error: "You can only plan for your own or your booked clients." }, 403);

    const split = String(body?.split ?? "") as SplitKey;
    if (!SPLITS[split]) return json({ error: "split must be ppl, upper_lower or bro" }, 400);
    const perWeek = Math.min(6, Math.max(1, Number(body?.sessions_per_week) || suggested));
    const note = typeof body?.note === "string" ? body.note.trim().slice(0, 500) : "";
    const hasCardio = slots.some((s) => /cardio/i.test(String(s.modality ?? "")));

    // ---- our exercises (the Strength Training plan pool: Strength + Cardio) ----
    const { data: pool, error: poolErr } = await svc.from("exercises_db").select("exercise, muscle_group, equipment, measurement_type, modality").in("modality", ["Strength", "Cardio"]).order("exercise");
    if (poolErr) return json({ error: `Exercise list: ${poolErr.message}` }, 500);
    const byName = new Map<string, { name: string; group: string | null; equipment: string | null; measurement: "reps" | "duration"; modality: string }>();
    for (const r of (pool ?? []) as any[]) {
      const name = String(r.exercise ?? "").trim();
      if (!name || byName.has(norm(name))) continue;
      byName.set(norm(name), { name, group: r.muscle_group ?? null, equipment: r.equipment ?? null, measurement: r.measurement_type === "duration" ? "duration" : "reps", modality: r.modality });
    }
    const list = [...byName.values()].map((e) => `${e.name} | ${e.modality === "Cardio" ? "Cardio" : e.group ?? "Other"} | ${e.equipment ?? "-"} | ${e.measurement}`).join("\n");

    const sectionsWanted = [...SPLITS[split].sections, ...(hasCardio ? [{ name: CONDITIONING, focus: "cardio and conditioning for the client's Cardio days (Cardio exercises, duration based)" }] : [])];
    const facts = {
      client: {
        age: ageFrom(client.date_of_birth),
        goal: client.goal ?? null,
        short_term_goal: client.short_term_goal ?? null,
        weekly_slots: sources.weekly_slots,
        sessions_per_week: perWeek,
        sessions_last_30_days: recentSessions,
        recent_exercises: [...new Set(recent.map((r) => r.exercise_name).filter(Boolean))].slice(0, 25),
      },
      latest_qhp: qhp ? { date: qhp.assessment_date, mechanical_score: qhp.mechanical_score ?? null, standardized_assessment: compact(standardized), analysis: compact(qhp.ai_biomechanical?.analysis ? { areas_of_concern: qhp.ai_biomechanical.analysis.areas_of_concern, recommendations: qhp.ai_biomechanical.analysis.recommendations, health_insights: qhp.ai_biomechanical.analysis.health_insights } : null) } : null,
      medical_history: med.map((m) => compact({ category: m.category, severity: m.severity, title: m.title, description: m.description, diagnosis: m.diagnosis, ongoing: m.is_ongoing, status: m.status, from: m.event_date, to: m.end_date })),
      blood_out_of_range: bloodFlags.slice(0, 40).map((b) => ({ marker: b.marker_name, value: b.value, unit: b.unit, range: [b.reference_min, b.reference_max], status: b.status, date: b.test_date })),
      health_context: ctxSummary ? compact({ improved: ctxSummary.improved, worsened: ctxSummary.worsened, watch: ctxSummary.watch }) : null,
      trainer_note: note || null,
    };

    const system = `You are Odds AI, a senior strength and conditioning coach in India. You draft ONE editable workout plan for a trainer, for one Odds client${client.subscription_type ? ` on the ${String(client.subscription_type).trim()} plan` : ""}, built ONLY from the exercise list supplied.

RULES
- Output a single JSON object, nothing else.
- Use exercise names EXACTLY as written in the EXERCISE LIST (same spelling, same punctuation). Never use an exercise twice in one section.
- New exercises: only when an exercise that is clearly more effective or safer for THIS client is missing from the list, you may add it with "new": true, a standard gym name (2 to 6 words, no brand names), its group (one of ${GROUPS.join(", ")}), its equipment (for example Dumbbell, Barbell, Machine, Cable, Bodyweight, Resistance Band, Kettlebell) and its measurement ("reps" or "duration"). At most ${MAX_NEW_PER_SECTION} new exercises a section; everything else from the list.
- Sections: exactly these, in this order: ${sectionsWanted.map((s) => `"${s.name}" (${s.focus})`).join("; ")}.
- How many exercises: our trainers put ${QUANTITY.strength.perSection.target} exercises in a section (usually ${QUANTITY.strength.perSection.min} to ${QUANTITY.strength.perSection.max}), so give each split section ${QUANTITY.strength.perSection.min} to ${QUANTITY.strength.perSection.max} exercises in total: 1 or 2 whose group is Warm-up first, then the main exercises for that section's focus.${hasCardio ? ` "${CONDITIONING}" gets ${QUANTITY.conditioning.perSection.min} to ${QUANTITY.conditioning.perSection.max} cardio exercises.` : ""}
- Sets per exercise: 2 to 4. For a "reps" exercise give reps (a whole number, 5 to 20), rest in seconds (30 to 180), tempo like "3-1-1-0" when useful, rir (a whole number 0 to 4). For a "duration" exercise give duration as text ("40 sec", "5 min") and rest in seconds. Leave load empty: the trainer sets kilograms in the session. Put coaching cues or a load hint in note (max 80 characters).
- Respect the client's data: injuries, pain areas, chronic conditions, medicines, blood markers, QHP test results, age and goal. Choose safe regressions for painful or injured areas (for example no heavy axial loading with low-back pain, no deep loaded knee flexion with knee pain, avoid breath-holding heavy lifts with high blood pressure). Scale volume to the sessions per week and to how much the client trained in the last 30 days.
- rationale: 3 to 5 short lines, each naming the client data point that drove a choice (for example "QHP 16 Jul: knee pain, so split squats replace back squats").
- avoided: 0 to 5 short lines, the exercise or pattern left out and why.
- summary: 1 or 2 sentences on the plan's intent. Plain text, no emoji, no medical diagnosis words beyond what the data already states.

JSON SHAPE
{"summary": string, "sections": [{"name": string, "exercises": [{"name": string, "new": boolean, "group": string|null, "equipment": string|null, "measurement": "reps"|"duration"|null, "sets": [{"reps": number|null, "duration": string|null, "rest": number|null, "tempo": string|null, "rir": number|null, "note": string|null}]}]}], "rationale": [string], "avoided": [string]}
("new", "group", "equipment" and "measurement" matter only for a new exercise; for a listed one set "new": false.)`;

    const user = `SPLIT: ${SPLITS[split].label}
SESSIONS PER WEEK: ${perWeek}
CLIENT DATA (JSON): ${capJson(facts, 18000)}

EXERCISE LIST (name | group | equipment | measurement):
${list}`;

    const callModel = async (model: string) => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), AI_TIMEOUT_MS);
      try {
        return await postChatCompletion({
          model,
          messages: [{ role: "system", content: system }, { role: "user", content: user }],
          response_format: { type: "json_object" },
          temperature: 0.4,
          reasoning_effort: "low",
          usage_context: { function_name: "ai-plan-draft", client_id: clientId, metadata: { user_id: uid, essentials, free: wallet ? wallet.free_this : null } },
        }, {}, ctrl.signal);
      } finally { clearTimeout(t); }
    };
    let usedModel = MODEL;
    let res = await callModel(MODEL);
    if (!res.ok && (res.status === 404 || res.status === 400) && MODEL !== FALLBACK_MODEL) {
      const txt = await res.text().catch(() => "");
      if (/model|not found|unsupported|invalid/i.test(txt) || res.status === 404) {
        console.warn(`[ai-plan-draft] ${MODEL} refused (${res.status}): ${txt.slice(0, 160)}; using ${FALLBACK_MODEL}`);
        usedModel = FALLBACK_MODEL;
        res = await callModel(FALLBACK_MODEL);
      }
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return json({ error: `The AI could not draft the plan (${res.status}). ${txt.slice(0, 200)}` }, 502);
    }
    const out = await res.json();
    const content = out?.choices?.[0]?.message?.content ?? "";
    let parsed: any;
    try { parsed = JSON.parse(String(content).replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch { return json({ error: "The AI answer was not readable. Try Generate again." }, 502); }

    // ---- validate against our list and the split ----
    const dropped: string[] = [];
    const wanted = new Map(sectionsWanted.map((s) => [norm(s.name), s.name]));
    const gotSections = new Map<string, any>();
    for (const s of Array.isArray(parsed?.sections) ? parsed.sections : []) {
      const key = norm(String(s?.name ?? ""));
      if (wanted.has(key) && !gotSections.has(key)) gotSections.set(key, s);
    }
    const int = (v: any, lo: number, hi: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };
    const titleCase = (s: string) => s.replace(/\s+/g, " ").trim().replace(/\b([a-z])/g, (m) => m.toUpperCase());
    const newOk = (name: string) => /^[A-Za-z][A-Za-z0-9 ()'\/&+.,\-]{2,59}$/.test(name) && name.split(" ").length <= 8;
    const sections = sectionsWanted.map((w) => {
      const s = gotSections.get(norm(w.name));
      const seen = new Set<string>();
      const exercises: any[] = [];
      let newCount = 0;
      const cap = w.name === CONDITIONING ? QUANTITY.conditioning.hardCap : QUANTITY.strength.hardCap;
      for (const e of Array.isArray(s?.exercises) ? s.exercises : []) {
        const raw = String(e?.name ?? "").replace(/\s+/g, " ").trim();
        let hit = byName.get(norm(raw));
        // Not in our library: kept only when the model marked it new, the name is a plain exercise
        // name and the section still has room for new ones; it is labelled NOT IN DB in the app and
        // added to exercises_db when the trainer submits the plan.
        if (!hit && e?.new === true && newOk(raw) && newCount < MAX_NEW_PER_SECTION) {
          const group = GROUPS.find((g) => g.toLowerCase() === String(e?.group ?? "").trim().toLowerCase()) ?? (w.name === CONDITIONING ? "Full Body" : null);
          const measurement: "reps" | "duration" = e?.measurement === "duration" ? "duration" : "reps";
          const equipment = typeof e?.equipment === "string" && e.equipment.trim() ? titleCase(e.equipment).slice(0, 40) : null;
          hit = { name: titleCase(raw), group, equipment, measurement, modality: w.name === CONDITIONING ? "Cardio" : "Strength", isNew: true } as any;
          newCount++;
        }
        if (!hit) { if (raw) dropped.push(raw.slice(0, 80)); continue; }
        if (seen.has(hit.name)) continue;
        seen.add(hit.name);
        const rawSets = (Array.isArray(e?.sets) ? e.sets : []).slice(0, 6);
        const sets = (rawSets.length ? rawSets : [{}]).map((st: any) => ({
          reps: hit.measurement === "reps" ? int(st?.reps, 1, 50) : null,
          duration: hit.measurement === "duration" ? (typeof st?.duration === "string" && st.duration.trim() ? st.duration.trim().slice(0, 20) : "30 sec") : null,
          rest: int(st?.rest, 0, 600),
          tempo: typeof st?.tempo === "string" && /^[0-9xX]-[0-9xX]-[0-9xX](-[0-9xX])?$/.test(st.tempo.trim()) ? st.tempo.trim() : null,
          rir: hit.measurement === "reps" ? int(st?.rir, 0, 5) : null,
          note: typeof st?.note === "string" && st.note.trim() ? st.note.trim().slice(0, 120) : null,
        }));
        const isNew = (hit as any).isNew === true;
        exercises.push({ name: hit.name, measurement: hit.measurement, group: hit.group, in_db: !isNew, ...(isNew ? { equipment: hit.equipment, modality: hit.modality } : {}), sets });
        if (exercises.length >= cap) break;
      }
      return { name: w.name, exercises };
    });
    const lines = (v: any, n: number) => (Array.isArray(v) ? v : []).filter((x) => typeof x === "string" && x.trim()).slice(0, n).map((x: string) => x.trim().slice(0, 240));
    const month = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", month: "short", year: "numeric" }).format(new Date());

    const exerciseCount = sections.reduce((n, s) => n + s.exercises.length, 0);
    console.log(`[ai-plan-draft] ${uid} -> ${clientId} ${split} ${usedModel}: ${exerciseCount} exercises (${sections.reduce((n, s) => n + s.exercises.filter((e: any) => e.in_db === false).length, 0)} new), ${dropped.length} dropped`);
    const answer = {
      draft: {
        plan_name: `${clientName.split(" ")[0]} · ${SPLITS[split].label} · ${month}`,
        description: typeof parsed?.summary === "string" ? parsed.summary.trim().slice(0, 400) : "",
        split,
        split_label: SPLITS[split].label,
        sessions_per_week: perWeek,
        sections,
        rationale: lines(parsed?.rationale, 5),
        avoided: lines(parsed?.avoided, 5),
      },
      dropped: [...new Set(dropped)].slice(0, 20),
      sources,
      model: usedModel.replace(/^google\//, ""),
      generated_at: new Date().toISOString(),
    };
    if (!wallet?.charges) return json(answer);
    // ---- a trainer: nothing is charged here (owner, 3 Nov 2026: generating is free; the plan's creation charges once,
    // a fixed price, through the server trigger). The standing travels with the draft so the form can say what
    // Create Plan will do: free (Essentials, or one of the 3 free plans), or the price.
    console.log(`[ai-plan-draft] ${uid} draft for a trainer: ${wallet.essentials ? "Essentials, free" : wallet.free_this ? `${wallet.free_left} free left` : `Rs ${Number(wallet.price_paise ?? wallet.bill_paise ?? 0) / 100} at Create Plan`}${wallet.negative ? ", wallet negative" : ""}`);
    return json({
      ...answer,
      wallet: {
        charged: false, charged_paise: 0, charge_at: "plan_create", price_paise: wallet.price_paise ?? wallet.bill_paise ?? null,
        balance_paise: wallet.balance_paise, negative: wallet.negative, essentials: wallet.essentials, free_this: wallet.free_this,
        free_left: wallet.free_left, free_total: wallet.free_total, free: wallet.free_this,
      },
    });
  } catch (e) {
    console.error("[ai-plan-draft] error:", e);
    const msg = e instanceof Error ? e.message : "Unexpected error";
    return json({ error: /abort/i.test(msg) ? "The AI took too long. Try Generate again." : msg }, 500);
  }
});
```

## 6. Check on the iPhone
1. `node tests/rules/team_wallet_test.js`, `node tests/rules/wallet_checkout_html_test.js`, `node tests/rules/ai_plan_rules_test.js`: ALL PASS.
2. Wallet: Rs 0, "No movements yet"; Add money Rs 400 refused in the sheet; Rs 1 opens the Razorpay sheet (test); pay by
   UPI: "Rs 1 added", a PAID row, the push.
3. As Sagar (trainer): Plan tab > Create Plan: chip "N FREE LEFT" or "RS 50"; Generate twice: the Wallet shows no new
   row; the button reads "Create Plan · Rs 50"; press it: "Rs 50 deducted. Wallet Rs -50." in red, the Wallet shows one
   "Odds AI plan, <name>" row of - Rs 50 and "Rs -50" with Add funds; Create Plan again: the popup "Add funds"
   (Build manually / Add money) at the card, and again at the button if a draft is already in the form; Add Rs 500:
   Wallet Rs 450, the card reads "RS 50 · balance Rs 450"; Save & Resubmit of the plan: no new row; a manual plan: no row.
4. As an admin: Create Plan shows no chip, drafts free, no wallet line, plain "Create Plan".
Server: migrations 20261102160000 and 20261103110000 live since 2 and 3 Nov 2026; 20261103120000 (this rule) PGlite-tested
16 of 16 and handed to the owner to run; ai-plan-draft, wallet-verify-payment and razorpay-webhook redeployed 3 Nov 2026.
