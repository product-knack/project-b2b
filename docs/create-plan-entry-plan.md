# Create Plan entry: Manual or AI, free count, automatic deduction, negative wallet: end-to-end plan (3 Nov 2026, revised the same day)

Status: BUILT 3 Nov 2026 and SUPERSEDED the same day (later) by docs/ai-plan-charge-on-create-plan.md: the charge moved from "after every draft" to ONCE per plan, a fixed Rs 50, when Create Plan succeeds (generating free). The chooser cards, the free count and the negative rule below still stand. (Migration 20261103110000 LIVE 3 Nov 2026, 11 of 11; ai-plan-draft redeployed twice; Android built; iOS handoff docs/ios-wallet-end-to-end-handoff.md.) Originally a plan only. Owner's ask (3 Nov 2026): "client detail page > Plan tab > Create Plan: show two
options, Manual plan and AI generated (with the free count, e.g. 2 free plans left), open accordingly; after the 3
free plans every trainer pays." Revised the same day by the owner: deduct automatically after the draft, no Deduct
tap, the draft always lands, the balance may go negative (capped at one plan's price), only a negative balance blocks
the next AI plan, the next top-up clears the negative first.

## 1. What exists today (checked in the code, nothing changed)
- Plan tab > **Create Plan** (`trainer.tsx` 4911, `set({ editingPlan: null }); go('create-plan')`) opens Create Plan
  with `mode === null`, which already renders a two-card chooser (`createPlan.tsx` 489 to 531): "Generate with Odds AI"
  and "Build it manually". The AI card carries the wallet line from the preview (`walletCardState`). Edit Plan never asks.
- Free plans: 3 per trainer for non-Essentials clients, Essentials always free, counted from the ledger's free rows
  plus the AI plans saved before 3 Nov 2026 (`team_wallet_free_used`); the preview answers `free_left`.
- Paid draft today (2 Nov design, replaced by this plan): Generate needs balance at least Rs 50; the server holds the
  draft behind a pending bill; the app shows "Your bill is Rs 40" with Deduct from wallet / Discard. `team_wallet_settle`
  refuses when the balance is short (`WALLET_INSUFFICIENT`).
- Gaps against the ask: the cards' words and the free chip; the price is only known after the draft; a short balance
  greys the card instead of a popup; the Deduct tap.

## 2. The rule (owner, 3 Nov 2026, final)
1. Create Plan from the Plan tab opens the chooser with two options: **AI generated** and **Manual plan**. Manual plan
   is always open.
2. The AI option card shows the trainer's standing for THIS client before anything is generated, as a chip and a line:
   - "2 FREE LEFT" while free plans remain (non-Essentials client);
   - "Free for Essentials clients" for an Essentials client (never charged, never counted);
   - after the 3 free: "Rs 33 from your wallet · balance Rs 28" (the exact bill for this client, computed from its data
     blocks before the draft).
3. **Deduction is automatic, after the draft is made, no Deduct tap. The draft always lands in the builder.** The
   bill (Rs 30 + Rs 5 per data block, cap Rs 50) is deducted the moment the server returns the draft. A draft the
   model could not make charges nothing.
4. **The balance may go negative:** balance Rs 28, plan Rs 33 → deduct Rs 33, the wallet shows **Rs -5**. The floor
   is one plan's price: nobody can go below minus the maximum bill (Rs -50), enforced by a table constraint.
5. **The pre-generation gate is only for a negative balance**, never for "balance less than price": while the balance
   is below 0 the AI option is blocked with the popup **"Your wallet is at Rs -5. Add funds to make the next plan with
   Odds AI."** and two buttons, **Add money** (opens the Wallet) and **Build manually**. At Rs 0 or above the AI option
   opens, whatever the price.
6. **The next top-up clears the negative first**, the rest is balance: Rs 500 at Rs -5 → Rs 495 (plain ledger
   arithmetic, nothing special to build).
7. Wallet screen: a negative balance is shown in red with the line "Your wallet is at Rs -5. Add funds to make the next
   plan with Odds AI.", and the top button reads **Add funds** (the same sheet as Add money).
8. Free count visible before generation; after a free draft the count drops on the next Create Plan.
9. iOS identical (handoff generated from the finished files).

## 3. Backend (hub-track)
- Migration `20261103110000_ai_plan_auto_charge.sql` (PGlite-tested, the owner runs it):
  - Table: `CONSTRAINT team_wallet_ai_floor CHECK (kind <> 'ai_plan' OR balance_after_paise IS NULL OR balance_after_paise >= -5000)`:
    an AI charge may leave the balance negative, never below minus the maximum bill. (The CHECK on `amount_paise` and
    the free 0-rows stay as they are.)
  - `team_wallet_charge_ai_plan(p_user, p_client, p_client_name, p_draft_ref, p_preview)` (service role): lock the
    user; refuse only when the balance is already negative (`WALLET_NEGATIVE: Your wallet is at Rs -5. Add funds to
    make the next plan with Odds AI.`); compute the bill; insert ONE PAID `ai_plan` row (amount minus the bill,
    `balance_after_paise` = balance minus the bill, negative allowed; `meta {client_id, client_name, blocks, preview,
    draft_ref, note 'Odds AI plan'}`); answer `{tx_id, bill_paise, balance_paise, blocks}`. No draft held on the row
    any more (the draft already went to the app), so no `draft` key, no pending state, nothing to settle or discard.
  - `team_wallet_ai_plan_gate(p_user, p_essentials, p_client uuid default null)`: answers `bill_paise` for the client
    (when given and billed) and `negative` (balance below 0); `ok` is false only for a pending bill from the old design
    or a negative balance; `reason` `WALLET_NEGATIVE` carries the popup sentence with the exact figure. The Rs 50
    floor is gone.
  - `team_wallet_settle` / `team_wallet_discard` stay for pending bills written before this change (none in production
    yet; the sweep cancels any older than 24 hours). `team_wallet_reverse` unchanged (support use, and the AI-failure
    reversal path keeps working: nothing is charged before the draft exists, so it is rarely needed).
  - `get_my_team_wallet`: `charges_ai`, `free_left`, `balance_paise` already there; adds `negative` and the
    `ai_bill_max_paise` the screen uses for the floor line.
  - Probe (rolled back): Rs 28 wallet + Rs 33 plan → charged, balance -500 paise; a second plan at Rs -5 → refused
    `WALLET_NEGATIVE` with "Rs -5"; a Rs 500 top-up at Rs -5 → balance 49500; the constraint refuses a row that would
    land below -5000; Essentials never charged; free count unchanged by a charged plan; `get_crew`/status untouched.
- `ai-plan-draft` (redeploy): the preview passes the client to the gate so the chooser gets `bill_paise`, `balance_paise`,
  `free_left`, `essentials`, `negative`; the draft call refuses with `WALLET_NEGATIVE` before the model runs when the
  balance is negative; after a successful draft for a billed trainer it calls `team_wallet_charge_ai_plan` and returns
  the draft directly plus `wallet: { charged_paise, balance_paise, tx_id }`. If the charge call fails for a reason other
  than `WALLET_NEGATIVE` (a transient error), the draft is still returned with `wallet: { charged: false, error }` and
  the failure is logged: the owner's rule is "the draft always lands"; the ledger is corrected by support if it ever
  happens (visible in the function logs).
- Receipt line in the push after a top-up (`sendTopupReceipt`): unchanged ("Odds AI plans cost Rs 30 to 50 each").

## 4. Android (odds-app)
- `src/lib/aiPlanDraft.ts`: `aiChoice` returns the wallet verdict for the card: `enabled`, `reason`, `chip` ("2 FREE
  LEFT" / "FREE FOR ESSENTIALS" / "RS 33"), `line` ("2 free plans left" / "Free for Essentials clients" / "Rs 33 from
  your wallet · balance Rs 28"), `negative` with the popup sentence (`negativeBalanceText(balancePaise)`), and
  `afterChargeLine(charged, balance)` ("Rs 33 deducted. Wallet Rs -5." in red when negative). Node tests.
- `createPlan.tsx` chooser: cards titled **AI generated** and **Manual plan**; the AI card shows the chip and the line.
  Tap AI with a negative balance: `Alert` "Add funds" with the owner's sentence and the buttons **Add money** (go
  `wallet`) / **Build manually** (chooseMode('manual')); otherwise the AI builder opens as today. Back from the Wallet
  returns to the chooser with the preview refetched (the Wallet screen invalidates `['ai-plan-preview']` after a
  top-up already).
- `AiPlanAssistant`: the Generate button reads "Generate for Rs 33" when billed (free: "Generate workout plan"); the
  answer is a plain draft again (no bill sheet): it is applied at once and a line under the result box says "Rs 33
  deducted. Wallet Rs -5." / "Wallet Rs 467." (green when 0 or above, red when negative). `useAiPlanDraft` keeps the
  `bill` branch only for a pending bill from the old design (the `AiBillSheet` stays mounted for that case, otherwise
  unused); the mutation invalidates the wallet and the preview.
- Wallet screen (`wallet.tsx`): balance in red when negative, under it "Your wallet is at Rs -5. Add funds to make the
  next plan with Odds AI."; the top button reads **Add funds** while negative (same sheet); history rows unchanged
  ("Odds AI plan, Aarav · - Rs 33 · Balance Rs -5"). `rupees(-500)` already renders "- Rs 5"; the screen shows
  "Rs -5" in the owner's form (`signedBalance`).
- Offline: the chooser needs the preview (online); offline the AI card says "Odds AI needs a connection", manual works.
- Pure-rule tests for the chip / line / popup sentence / after-charge line.

## 5. Web
- No change: the web trainer dashboard has no AI plan builder. The Wallet is app-only.

## 6. Edge cases
- Two Generates in a row on Rs 10: the first charges to Rs -23 (allowed, above -50); the second is blocked by the
  negative gate. Two at the very same second: the per-user lock serialises them; the second sees the negative balance
  and refuses before charging (the model runs for it, the draft still lands; see section 3's "draft always lands").
- The constraint can only bite if a bill ever exceeds Rs 50 or two charges slip past the gate: the function answers
  the plain sentence "The wallet cannot go further below zero. Add funds first." and the draft still lands uncharged
  (logged).
- Essentials client at a negative balance: still free, never gated (the gate is for billed drafts only).
- Pending bills from the 2 Nov design: Open bill / Deduct / Discard keep working until they lapse (24 h).
- A refund or admin adjustment that makes the balance negative behaves like a charge: the next AI plan is blocked
  until a top-up.
- Daily top-up cap unchanged (Rs 5,000 a day); the minimum Rs 500 (and the Rs 1 test top-up) unchanged.

## 7. Decided (owner, 3 Nov 2026)
Automatic deduction after the draft, no Deduct tap, draft always lands; negative balance allowed down to minus one
plan's price; only a negative balance blocks the next AI plan; the next top-up clears the negative first; the option
card shows the chip before generation; the Wallet screen shows red and "Add funds" when negative.

## 8. Build order and checks
1. Migration (PGlite probe of section 3) + `ai-plan-draft` redeploy.
2. Android: rules + tests, the chooser cards and the popup, the assistant's price label and after-charge line, the
   Wallet screen's negative state; tsc, rule tests, bundle; APK on request.
3. Docs (ai-plan-assistant android, team-wallet android + backend, the wallet handoff's spec section), iOS handoff
   from the finished files, copier card.
4. Live check as Sagar (1 free plan left today): Plan tab > Create Plan shows "1 FREE LEFT"; after it, a paid client
   shows "Rs 33 from your wallet · balance Rs 0"; Generate deducts to Rs -33 and the draft lands; Create Plan again:
   the popup "Your wallet is at Rs -33 ..." with Add money; add Rs 500: balance Rs 467; Generate again works.
