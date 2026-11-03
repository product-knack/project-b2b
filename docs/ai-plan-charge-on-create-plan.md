# Odds AI plan: one fixed charge per plan, when Create Plan succeeds; generating is free: end-to-end plan (3 Nov 2026)

Status: BUILT 3 Nov 2026 (owner: "Go, with one change: the price is FIXED per plan"). Migration 20261103120000 written and
PGlite-tested 16 of 16, the owner runs it; ai-plan-draft, wallet-verify-payment and razorpay-webhook redeployed; Android
built (tsc, rule tests 101, bundle); docs updated; iOS handoff docs/ios-wallet-end-to-end-handoff.md regenerated (card 14).

Owner's rule (3 Nov 2026): "money is deducted only once per plan, when the trainer clicks the Create Plan button;
before that generating is free, any time. The price is fixed per plan, not computed from the client's data blocks.
One server constant for the price (Rs 50 for now)."

## 1. What exists today (live since 3 Nov 2026 morning)
- The charge happens inside `ai-plan-draft`, right after each draft: every **Generate** press on a billed trainer
  costs Rs 30 + Rs 5 per data block (cap Rs 50), and a free draft consumes one of the 3 free plans at Generate time
  (`team_wallet_charge_ai_plan` / `team_wallet_record_free_draft`, both called by the edge function).
- "Generate again" therefore charges again, and a draft the trainer never turns into a plan is still paid for.
- The plan itself is created by the app inserting `workout_plan_exercises` rows with a pre-generated `plan_id`,
  `source = 'ai'` and `ai_prompt` when a draft was applied (`submitWorkoutPlan` in `clientQueries.ts`, online at once
  or queued in the outbox as `create-plan`). The registry (`workout_plan`) copies `creator = 'ai'` at approval.
- The gate (`team_wallet_ai_plan_gate(user, essentials, client)`) answers the standing for the chooser: free count,
  the client's bill, negative balance; only a negative balance blocks.

## 2. The rule (owner, 3 Nov 2026, final)
1. **Generating is free, any number of times.** Generate and Generate again never touch the wallet or the free count.
2. **One fixed price per plan.** The price is a server constant, `team_wallet_ai_plan_price_paise() = 5000`
   (Rs 50 for now). No per-client bill, no data blocks, the price never moves between Generate and Create Plan.
3. **One charge per plan, when Create Plan succeeds.** When the trainer's plan is saved with `source = 'ai'`
   (an Odds AI draft was used), the wallet is charged Rs 50 **once for that plan**. While free plans remain the free
   count drops by one instead; an Essentials client's plan is always free and never counts.
4. **Never twice for the same plan:** Save and Resubmit after a CRM review, an edit, a retried offline sync, or a plan
   whose rows are inserted again, charge nothing more (the ledger keeps one row per `plan_id`).
5. **Manual plans never charge** (no draft applied = `source = 'human'`). A draft applied and then rebuilt by hand
   is still an AI plan and is charged: the AI draft was used (owner, 3 Nov 2026).
6. **A negative balance blocks pressing Create Plan for an AI plan** (popup "Your wallet is at Rs -5. Add funds to
   make the next plan with Odds AI." with Add money / Build manually), and the AI option in the chooser shows the same
   popup, as today. A balance below the price never blocks: the plan is created and the wallet goes negative, floor
   minus one plan's price (-5000 paise), the next top-up clears it first (unchanged).
7. The plan is **always created**: a wallet problem at creation time is logged, never a reason to lose the plan.
8. Offline: an AI plan queued offline is created when it syncs; the charge is made on the server at that moment (the
   phone shows "Rs 50 will be deducted when it syncs"). The negative check happens on the phone at the button with
   the last known balance.
9. A rejected or deleted plan is not refunded (it was created and charged once; support can reverse with
   `team_wallet_reverse` if ever needed).

## 3. Backend (hub-track migration `20261103120000_ai_plan_charge_on_create.sql`, the owner runs it)
- `team_wallet_ai_plan_price_paise() RETURNS bigint` = 5000, the ONE constant (immutable, revoked). The old
  `team_wallet_ai_plan_bill(_paise)` block counters stay for history rows but are no longer called by anything; the
  gate's `bill_paise` always equals the fixed price.
- Ledger: one wallet row per plan: `meta.plan_id` on `ai_plan` rows (charged and free alike) with a unique partial
  index `team_wallet_plan_uidx ON team_wallet ((meta->>'plan_id')) WHERE kind = 'ai_plan' AND meta->>'plan_id' IS NOT NULL`.
- `team_wallet_charge_ai_plan(p_user, p_client, p_client_name, p_plan_id, p_preview)` charges the fixed price
  (no blocks); `team_wallet_record_free_draft(p_user, p_client, p_client_name, p_plan_id, p_preview)` writes the free
  0-row; both return the existing row with `already: true` when a row for that `plan_id` exists and write nothing.
- `team_wallet_ai_plan_gate(...)`: `bill_paise` = fixed price, `blocks` = 0, `charge_at = 'plan_create'`, `price_paise`.
- **Trigger** `trg_team_wallet_plan_created` AFTER INSERT ON `workout_plan_exercises` FOR EACH STATEMENT (transition
  table `new_rows`, next to the registry's trigger), function SECURITY DEFINER: for each DISTINCT new `plan_id` with
  `source = 'ai'` whose `trainer_id` is a trainer: skip when a wallet row for that `plan_id` exists; else decide free
  or charged on the server (Essentials from the client's plan name; `team_wallet_free_used` for the count) and write
  the one row. Each plan is wrapped in BEGIN/EXCEPTION: a failure (the -5000 floor, a missing profile) is a
  `RAISE WARNING`, never an error: the plan rows stay.
- `ai-plan-draft` (redeploy): no charge, no free-row record at draft time, no WALLET_NEGATIVE refusal before the
  model runs (generating is free; the chooser keeps its popup). The preview still answers the standing (`wallet` with
  `free_left`, `bill_paise` = price, `negative`, `line`, `charge_at: 'plan_create'`); a draft answers the draft plus
  `wallet: { charge_at: 'plan_create', price_paise, free_this, free_left, negative }` (informational only).
- `get_my_team_wallet` adds `ai_plan_price_paise`. The Wallet history row for a plan reads "Odds AI plan, <first
  name>" with the plan creation time.
- Probe (rolled back, as Sagar on a client): insert 3 AI rows of one plan → ONE charge row of -5000 with `plan_id`;
  insert 2 more rows of the same plan → still one; a second plan → a second charge; a manual plan → nothing; an
  Essentials client's AI plan → a free row, free count unchanged; free plans remaining → free rows then charges; a
  plan that would breach -5000 → the rows stay, a warning, no charge row; gate `bill_paise` = 5000 everywhere.

## 4. Android (odds-app)
- Chooser card (`createPlan.tsx`): chips "2 FREE LEFT" / "FREE FOR ESSENTIALS" / "RS 50" / "ADD FUNDS"; the line
  reads "Rs 50 from your wallet when you create the plan · balance Rs 467" / "2 free AI plans left, then Rs 50 a
  plan"; the negative popup unchanged.
- AI panel (`AiPlanAssistant.tsx`): Generate reads "Generate workout plan" (no price); hint "Generating is free.
  Rs 50 is deducted once, when you tap Create Plan." (billed) / "Generating is free. This plan uses 1 of your 2 free
  AI plans." / "Generating is free. Essentials plans are free."; the after-draft charge line goes.
- Create Plan button (AI plan): "Create Plan · Rs 50" / "Create Plan · free"; on press with a negative balance (the
  preview's latest wallet) the popup of rule 6 and no submit. After the plan is saved online the done line reads
  "Rs 50 deducted. Wallet Rs 417." (red when negative; the wallet read is invalidated and re-read); queued offline:
  "Rs 50 will be deducted when it syncs"; a free plan: "Free AI plan used. 1 free left."; manual: unchanged.
- `teamWallet.ts`: `AI_PLAN_PRICE_PAISE` fallback 5000 (server value wins), `createButtonLabel(w)`,
  `createDoneLine(w, balanceAfter, queued)`, `generateHint(w)`; rule tests.
- `useCreateWorkoutPlan` invalidates `['my-team-wallet']` and `['ai-plan-preview']` after a plan is saved so the
  chooser's count and the Wallet move at once; the outbox drain does the same after a queued `create-plan` lands.
- Edit Plan: nothing (never charges).

## 5. Web
- No change (no AI builder on the web).

## 6. Edge cases
- Two Create Plan presses in a row (double tap): the same `plan_id`, one charge (unique index).
- A draft applied, then rebuilt by hand: charged (rule 5).
- Free count race (two phones): the trigger decides on the server under the user's lock; at most one free row per plan.
- A plan created while the wallet is negative (offline sync): charged anyway, the floor applies; if the floor would
  be breached the plan still lands with a warning and no charge row (support can adjust).
- Price change later: edit the one constant; rows already written keep their amount.

## 7. Build order and checks
1. Migration (PGlite probe of section 3, with a stub `workout_plan_exercises` and the live function texts) +
   `ai-plan-draft` redeploy (charge removed).
2. Android: rules + tests, the chooser line, the panel hint, the Create Plan label / popup / done line, the
   invalidations; tsc, rule tests, bundle; APK on request.
3. Docs (team-wallet android + backend, ai-plan-assistant android, create-plan-entry plan status), the end-to-end iOS
   handoff regenerated (card 14), copier.
4. Live check as Sagar: Generate twice (free, no rows), Create Plan → one "Odds AI plan" row of Rs 50, wallet moves
   once; Save and Resubmit → no new row; a manual plan → no row; the admin adjustment restores his balance.
