# Handoff: reimbursement "paid" state (web shipped 2026-09-29, Android pending)

Owner of this note: the web session. The Android session owns the native reimbursement screens.

## What changed on the backend
- `reimbursements.status` CHECK now allows `paid` (migration `20260929130000_reimbursements_finance_pay.sql`).
- New RPC `pay_reimbursement(p_id uuid, p_amount numeric default null, p_note text default null)`: finance / admin / super_admin only; requires `approved_by.decision = 'approved'`, refuses rejected and already paid rows; sets `status = 'paid'` and `paid_by = {id, name, at, amount, payout_batch_id: null, source: 'finance', note}`.
- Finance marks requests paid from the web finance dashboard (`/finance/reimbursements`, Physios tab).

## Also new the same day: multi-item requests (tech / marketing)
- `expense_details` may now be `{"type": "multi", "expense_date", "amount": <sum>, "note": null, "items": [{"type": text, "amount": number, "note": text|null, "screenshots": [...]}]}`; the row's `screenshots` holds every bill flattened (up to 30). Any non-empty `type` text is allowed now (migration `20260929140000`).
- These rows are raised from the web tech / marketing dashboards and decided by finance; they never show on the doctors' side. If a native list ever reads all rows, filter by the requester's role like `DoctorReimbursements.tsx` does, and render `items` when present (`requestTypeLabel` / `requestAmount` in the web lib show the rule).

## What Android should do
- Wherever the native lib mirrors web's `effectiveStatus(row)`, add the paid rule in this order: rejected (status or stamp) -> **paid** (`status === 'paid'` or `paid_by` present) -> approved (stamp) -> pending. Today a paid row would show as "Approved".
- Add a "Paid" chip (violet) and a Paid filter pill on the doctor's My requests screen and on the HOD review screen; show "Paid <date> ₹X by <name>" from `paid_by`.
- No native pay action is needed (finance pays on web).

Web source of truth: `oddsfitness-hub-track/src/lib/reimbursements.ts` (`effectiveStatus`, `STATUS_META`, `payReimbursement`); feature docs `b2b/docs/features/web/doctor/reimbursement.md` and `web/finance/finance-dashboard.md`.
