# Team Wallet: FINAL end-to-end plan (2 Nov 2026)

Status: PLAN ONLY. Nothing is built; the build starts when the owner says so. A draft of the migration was run on a
local Postgres copy to test the design; it found one rule (section 3, "seq") and was then taken out of the repo.

Nothing here is built. This is the plan for a wallet in every staff account of the Odds staff app (Android, then
iOS): add money through Razorpay, see the balance and the transaction history, minimum top-up Rs 500. One table,
`team_wallet`, holds the balance, the history and the Razorpay details, as asked. Spending from the wallet is designed
in (one function) but wired to nothing yet, because what the wallet pays for is still your decision (section 9).

## 1. What exists today and what is reused
- Razorpay primary account: secrets `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` in the
  Supabase project. Edge functions `create-razorpay-order` (order + notes + amount from the database, never from the
  app), `verify-renewal-payment` (HMAC check), `razorpay-webhook` (payment.captured, payment_link.paid, failed,
  cancelled, expired; finds a renewal request by `notes.request_id`, then order id, then payment link id; answers 200
  on unknown events so Razorpay does not retry forever). Three payment-link functions for leads and packages.
- The Nutrition Copilot account (`RAZORPAY_NUTRITION_*`) is never used here.
- The staff app has `react-native-webview` already, no Razorpay SDK, and opens payment links through the browser on
  the admin and ops screens.
- The wallet reuses the primary account, the order + verify + webhook pattern, and the webhook function (one new
  branch at the top of it, before the renewal lookup).

## 2. Decisions (owner, 2 Nov 2026)
1. Who gets a wallet: every active `profiles` row (every role); clients never.
2. Money in: Razorpay only, whole rupees, **minimum Rs 500, maximum Rs 5,000 per person per IST day** (so one top-up
   is Rs 500 to Rs 5,000, and the day's top-ups together never pass Rs 5,000). Quick picks Rs 500, 1,000, 2,000,
   5,000 plus an open box.
3. Money out: **only the Odds AI workout plan for now.** Each "Generate with Odds AI" press charges the wallet a fixed
   price (section 5a); a draft the AI could not produce is reversed at once. Nothing else can debit the wallet.
4. Refunds: none from the app. A refund made in the Razorpay dashboard is recorded automatically (section 5) so the
   balance stays right.
5. Checkout inside the app: Razorpay Standard Checkout in a WebView (option A). Option B (payment link in the browser)
   stays as the fallback if UPI apps misbehave inside the WebView on a real phone.
6. Reporting: **none for now; a trainer sees only their own history.** Row level security lets a user read their own
   rows and nobody else's through the API; the SQL editor is the only other reader.
7. Receipt push after a top-up: **yes.** "Rs 2,000 added to your wallet. Balance Rs 2,500." through the staff push
   helper, tapping it opens the Wallet screen.
8. AI plan price (final, 2 Nov): **Rs 30 to Rs 50 per draft, set by the client data the draft used** (section 5a).
   No model-cost maths. The trainer sees no breakdown: after the draft is made the app says "Your bill is Rs 40" with
   one tap, **Deduct from wallet**; the draft is applied only after the deduction. Charged to **trainers only**:
   admins, super admins and coaches draft free, because today only trainers make workout plans with the AI. Minimum
   balance to press Generate: Rs 50 (the highest possible bill).

All decisions are in. The build starts on the owner's word.

## 3. The table: `team_wallet` (one table, 12 columns, an append-only ledger)
One row per movement of money. Only what is searched, counted or locked is a real column; the Razorpay details and
the small bookkeeping fields live in two JSON columns. Amounts are signed: a credit is positive, a debit is negative,
so the balance is a plain sum and there is no direction column.

```sql
CREATE TABLE public.team_wallet (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq                 bigint GENERATED ALWAYS AS IDENTITY,              -- ledger order; the balance is the highest paid seq
  user_id             uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  role                text NOT NULL,                                   -- profiles.role when the row was made
  kind                text NOT NULL CHECK (kind IN ('topup', 'ai_plan', 'reversal', 'refund', 'adjustment')),
  amount_paise        bigint NOT NULL CHECK (amount_paise <> 0),        -- signed: credit > 0, debit < 0; always paise
  status              text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'paid', 'failed', 'expired', 'cancelled')),
  balance_after_paise bigint,                                          -- set when the row becomes paid
  razorpay            jsonb,                                           -- see the shape below; NULL for non-Razorpay rows
  meta                jsonb NOT NULL DEFAULT '{}'::jsonb,              -- see the shape below
  created_at          timestamptz NOT NULL DEFAULT now(),
  paid_at             timestamptz,
  CONSTRAINT team_wallet_sign CHECK (
       (kind IN ('topup', 'reversal') AND amount_paise > 0)
    OR (kind IN ('ai_plan', 'refund') AND amount_paise < 0)
    OR  kind = 'adjustment'),
  CONSTRAINT team_wallet_topup_limits CHECK (kind <> 'topup' OR amount_paise BETWEEN 50000 AND 500000),
  CONSTRAINT team_wallet_paid_has_balance CHECK (status <> 'paid' OR balance_after_paise IS NOT NULL),
  CONSTRAINT team_wallet_json_shapes CHECK ((razorpay IS NULL OR jsonb_typeof(razorpay) = 'object') AND jsonb_typeof(meta) = 'object')
);
CREATE UNIQUE INDEX team_wallet_payment_uidx ON public.team_wallet ((razorpay->>'payment_id')) WHERE razorpay->>'payment_id' IS NOT NULL;
CREATE UNIQUE INDEX team_wallet_order_uidx   ON public.team_wallet ((razorpay->>'order_id'))   WHERE razorpay->>'order_id'   IS NOT NULL;
CREATE INDEX team_wallet_user_idx    ON public.team_wallet (user_id, seq DESC);
CREATE INDEX team_wallet_pending_idx ON public.team_wallet (created_at) WHERE status = 'pending';
ALTER TABLE public.team_wallet ENABLE ROW LEVEL SECURITY;
CREATE POLICY team_wallet_own_read ON public.team_wallet FOR SELECT TO authenticated USING (user_id = auth.uid());
-- no insert / update / delete policy: every write goes through the edge functions (service role) and the locked functions
```

The two JSON columns (keys are fixed by the functions; the app never writes them):

| column | keys | written by |
|---|---|---|
| razorpay | `order_id`, `payment_id`, `signature`, `method` (upi, card, netbanking, wallet), `event` (the last Razorpay event seen), `payment` (the trimmed payment entity: id, status, amount, currency, method, email, contact, error_code, error_description), `refund_id` (refund rows) | create order, verify, webhook |
| meta | `note` (a sentence a person reads), `reference` (reversal: the charged row id), `created_by` (the user, or the admin who adjusted), `failed_at`, `failure_reason`; for an AI plan bill: `draft_ref`, `client_id`, `client_name`, `blocks` (the data blocks that set the bill), and `draft` (the held draft, removed once settled or discarded) | the functions |

- Why these twelve stay as columns: `user_id`, `status`, `kind`, `seq` and `created_at` are what every read filters and orders by;
  `amount_paise` and `balance_after_paise` are what the constraints and the balance use; `role` is the reporting cut;
  `paid_at` is the statement date. Everything else is read whole, never filtered, so JSON costs nothing.
- The Razorpay ids still get unique indexes (expression indexes on the JSON keys), so a payment id or an order id can
  never land on two rows.
- A pending top-up expires 30 minutes after `created_at`; no expires_at column is needed (the sweep and the order
  function use `created_at < now() - interval '30 minutes'`).
- A paid row never changes again except its `razorpay.event` / `razorpay.payment` (a later webhook may note them);
  status moves only pending to paid, failed, expired or cancelled, and failed or expired to paid (a late success after
  a failed attempt on the same order is real money and must be credited). The daily cap (Rs 5,000: paid plus pending
  top-ups of the IST day) is checked in the order function under the user's lock, not by a constraint.
- Row level security: a user reads their own rows and nothing else; no admin policy for now (owner); nobody inserts
  or updates through the API. All writes go through the edge functions (service role) and the locked functions.
- Balance: `team_wallet_balance(user_id)` = the paid row with the highest `seq` for that user, its
  `balance_after_paise`; 0 when none. Found on the local test run: several rows written in one transaction share the
  same timestamp, so ordering by `paid_at` picked the wrong row and the balance went stale. The identity column
  `seq` has no ties.
- Why one table works: the ledger is the truth, every change runs under a per-user lock
  (`pg_advisory_xact_lock(hashtext('team_wallet:' || user_id))`), and inside the lock the balance is read from the
  highest paid row before `balance_after_paise` is written, so two payments landing in the same second cannot
  double a credit or lose one.

Reading the rows: a top-up is one row (+amount) that goes pending, then paid (or failed / expired); an AI plan bill is
one row (-bill) that goes pending at generation, then paid on Deduct (or cancelled on Discard / after 24 hours); a
reversal is one paid row (+amount) whose meta.reference is the charged row (admin use); a Razorpay refund is one paid
row (-amount) with razorpay.refund_id; an adjustment is whatever the admin wrote, with meta.note mandatory.

## 4. The server functions (hub-track migration)
- `team_wallet_mark_paid(tx_id, payment_id, signature, method, payload, event)`: lock the user, re-read the row; if it
  is already paid return it unchanged (idempotent: the webhook and the app's verify both call this, in any order);
  refuse if the payment id is already on another row; set status paid, paid_at, the Razorpay fields and
  `balance_after_paise` = balance + amount. Service role only.
- `team_wallet_mark_failed(tx_id, reason, payload)`: pending to failed with the reason; never touches a paid row.
- `team_wallet_debit(user_id, amount_paise, kind, reference, note)`: lock, read the balance, refuse with
  `WALLET_INSUFFICIENT: Your wallet has Rs X. This needs Rs Y. Add money in Wallet.` when short, else insert a paid
  debit row with the new `balance_after_paise`. Called only by the AI plan function (5a).
- `team_wallet_reverse(tx_id, note)`: lock, insert a paid credit row of the same amount pointing at the ai_plan row,
  once (a second call returns the existing reversal).
- `team_wallet_adjust(user_id, amount_paise, direction, note)`: admin and finance only, same lock, for support
  corrections; the note is mandatory.
- `team_wallet_expire_pending()`: pg_cron every 15 minutes: pending top-ups past `expires_at` become expired. (A
  payment that still arrives for an expired row is credited by the webhook: the money was taken.)
- `get_my_team_wallet(limit, before)`: the balance and the last N rows for the app, newest first, with a cursor.

## 5a. The only spend: the Odds AI workout plan, Rs 30 to Rs 50 by the client's data

### The bill (owner, 2 Nov 2026: "a random amount of Rs 30 to 50 according to the data processed for that client")
- Deterministic, not random: the same client and the same data give the same bill, so the trainer never sees two
  prices for one case and support can explain any bill from the row.
- `bill = Rs 30 + Rs 5 for each data block the draft used`, capped at Rs 50:
  | block | counts when |
  |---|---|
  | QHP assessment | the client has a completed `coach_assessment` the draft read |
  | medical history | at least one `client_medical_history` row |
  | blood report | at least one `blood_report_markers` row |
  | health context | a `client_health_summary` context for the client |
  So a client with nothing on file costs Rs 30, a client with everything Rs 50. `ai-plan-draft` already loads these four
  blocks for the prompt (its `sources` answer), so the count costs nothing extra.
- The rule lives in one SQL function `team_wallet_ai_plan_bill_paise(p_client_id)` (3000 + 500 per block, max 5000)
  and nowhere else; the edge function calls it, the app never computes it.
- Shown to the trainer only after the draft: "Your bill is Rs 40". No breakdown, no price before Generate.

### The flow (trainer only; other roles keep today's free flow)
1. **Before Generate:** the Create Plan card shows "Wallet Rs Y". The app checks: balance at least Rs 50 (the highest
   bill) and no unpaid bill waiting. Short: the card greys with "Add money in Wallet" (opens the Wallet screen). A
   waiting bill: "Settle or discard the last draft first" with both buttons.
2. **Generate:** `ai-plan-draft` makes the draft as today, asks `team_wallet_ai_plan_bill_paise(client)` for the bill,
   and inserts ONE `team_wallet` row: kind `ai_plan`, amount `-bill_paise`, status `pending`, `meta {draft_ref,
   client_id, client_name, blocks: ['qhp', 'medical', 'blood', 'context'], draft: <the draft json, at most 32 KB>}`.
   It answers `{tx_id, bill_paise, balance_paise, preview: {sections, exercise_count}}`: a short preview (the section
   names and how many exercises), never the full draft.
3. **The app shows the bill:** "Your plan is ready. Your bill is Rs 40." with **Deduct from wallet** (one tap) and
   **Discard**. Under it: "Wallet Rs 2,000, after this Rs 1,960".
4. **Deduct:** edge function `wallet-settle-ai-plan(tx_id)` calls `team_wallet_settle(tx_id)`: lock the user, require
   the row pending and the caller's own, require balance at least the bill (short: `WALLET_INSUFFICIENT`, the bill
   stays pending, the trainer adds money and taps again), mark paid with `balance_after_paise`, remove the draft from
   meta and return it. The app applies the draft to the builder exactly as today. The history row reads "Odds AI
   plan, <client name>" with "Rs 40".
5. **Discard:** `wallet-discard-ai-plan(tx_id)`: status `cancelled`, the draft removed, nothing charged. Guard: at most
   3 discards per trainer per IST day (`WALLET_DISCARD_LIMIT`), and never a new Generate while a bill is pending.
6. **Expiry:** a pending bill older than 24 hours is cancelled by the sweep (draft removed). No pushes for bills.
7. **A draft the model could not make:** no wallet row at all, the error as today.

### Why this is safe
- The draft is held on the server until the bill is paid, so "generate, read, never pay" is not possible; the only
  leak is the short preview.
- The trainer cannot press Generate without Rs 50 in the wallet, so a bill is always payable at once.
- Settle and discard are idempotent and locked; a settle after a discard refuses (`WALLET_CANCELLED`).
- The bill is fixed at generation time; changing the rule later never alters an old bill.
- The AI usage log keeps working as today for the audit; it is not used for billing.

## 5. The edge functions
1. `wallet-create-order` (new). Caller: a signed-in staff profile, status active. Body: `amount_inr` (whole number).
   Checks: min 500, max 5,000, the daily cap of Rs 5,000 (paid + pending today, IST), at most 2 pending top-ups per
   user (older ones are expired first). Inserts the pending row (role snapshot, expires_at), creates the Razorpay order
   (`receipt` = `tw_` + the first 36 characters of the row id, `notes` = `{purpose: 'team_wallet_topup', wallet_tx_id,
   user_id}`), stores `razorpay_order_id`, returns `{tx_id, order_id, amount_paise, currency, key_id, prefill:
   {name, email, contact}}`. If Razorpay refuses, the row is marked failed with Razorpay's description.
2. `wallet-verify-payment` (new). Body: `{tx_id, razorpay_order_id, razorpay_payment_id, razorpay_signature}`. Checks
   the row belongs to the caller and carries that order id; HMAC-SHA256 of `order_id|payment_id` with the key secret,
   timing-safe compare; then fetches the payment from Razorpay (`GET /v1/payments/:id`) and requires status
   `captured`, the same amount and currency INR (a WebView cannot change the amount, but this closes the door);
   calls `team_wallet_mark_paid`; returns the row. A bad signature marks the row failed only while it is pending
   (never a paid row) and answers 400.
3. `razorpay-webhook` (existing, one new branch at the top): if `payment.notes.purpose` or `order.notes.purpose` is
   `team_wallet_topup`, read `wallet_tx_id`: `payment.captured` calls `team_wallet_mark_paid`; `payment.failed` calls
   `team_wallet_mark_failed` (only while pending); `refund.processed` inserts a paid refund debit row for the refunded
   amount with the refund id in `reference` (balance may go negative only here, by design, so finance sees it);
   anything else answers 200 ignored. The renewal flow below it is untouched.
4. `wallet-checkout-page` (new, only for option A): serves a small HTML page that loads Razorpay's `checkout.js` with
   the order, key id and prefill, opens it at once, and posts `{ok, order_id, payment_id, signature}` or `{dismissed}`
   back to the app through `window.ReactNativeWebView.postMessage`. No secrets on the page.

## 6. The app (odds-app; iOS by handoff)
- Drawer item **Wallet** for every role (`chrome.tsx`), route `wallet` (`Router.tsx`), screen `src/screens/wallet.tsx`.
- Screen: a balance card ("Rs 2,500" from paise, "Updated 2 Nov, 3:10 PM"); **Add money** (chips Rs 500 / 1,000 /
  2,000 / 5,000, an open box with the rule line "Minimum Rs 500. Up to Rs 5,000 a day."); **History** grouped by
  month: kind, amount with a plus or minus, status chip (Paid, Waiting for payment, Failed, Expired, Refunded), the
  Razorpay payment id shortened, tap for the full detail sheet; pull to refresh.
- Add money flow: tap Add money, pick or type the amount, tap Continue. The app calls `wallet-create-order`, then opens
  the checkout (option A: a full-screen WebView on `wallet-checkout-page?tx=...`, with intent:// and upi:// links
  handed to the system so GPay, PhonePe and Paytm open; option B: the browser). On the checkout's message the app calls
  `wallet-verify-payment`, shows "Rs 2,000 added" and the new balance. On dismiss, the row stays pending for 30
  minutes ("Waiting for payment"); the user can tap it to reopen checkout or wait for it to expire.
- While a row is pending the screen subscribes to it (realtime on `team_wallet` filtered by `user_id`), so a webhook
  credit that lands after the app lost the checkout result still updates the balance within seconds.
- Offline: the balance and history show from the cache with "last updated"; Add money is off with the plain
  no-connection line; nothing is queued (money moves only online).
- Errors through `friendlyError`; server refusals are `CODE: sentence` (`WALLET_MIN_AMOUNT`, `WALLET_DAILY_CAP`,
  `WALLET_PENDING_LIMIT`, `WALLET_INSUFFICIENT`, `WALLET_FORBIDDEN`). The daily-cap sentence says how much is still
  allowed today ("You can add Rs 2,000 more today.").
- Pure rules file `src/lib/teamWallet.ts` (amount checks, paise to rupee text, status copy, grouping) with a node test,
  copied byte for byte to iOS.

## 7. Edge cases covered
- Amount comes from the server's row and the Razorpay order, never from the app's second call.
- The webhook arrives before the app's verify call, or both arrive: both call the same locked, idempotent function.
- Razorpay sends the same event twice: the second call finds the row paid and returns.
- The app closes after the bank OTP: the webhook credits; the realtime subscription updates the screen next open.
- A payment attempt fails, the user retries on the same order and succeeds: failed to paid is allowed.
- The order expires on our side (30 minutes) and the payment still lands: credited; expired to paid is allowed.
- A payment id reused on another row: refused by the unique index.
- Two top-ups at the same second: the per-user lock serialises the balance writes.
- A tampered signature: refused, the pending row marked failed with "signature mismatch", nothing credited.
- A refund made in the Razorpay dashboard: recorded as a refund row by the webhook; the balance drops.
- A profile goes inactive: no new top-ups; a payment already made is still credited.
- Currency other than INR, partial payments, amounts with paise: refused at order creation (whole rupees, INR,
  `payment_capture` on).
- Daily cap and limits are computed on IST days.
- Live keys only: Razorpay test keys cannot share the live webhook secret, so the live test is one real Rs 500 top-up
  on your own account (it stays in your wallet).
- An AI draft charged, then the model fails: reversed in the same function call, inside a try / finally, so a crash
  after the charge still returns the money.
- Two Generate presses at once: two charges (each is a real draft); the lock keeps the balance right.

## 8. Build order and checks
1. Migration (table, functions, view, cron, policies) with a rolled-back probe: paid once under two callers, late
   success after failed, late success after expired, insufficient debit refused, refund row, daily cap, limits.
   PGlite run locally before you run it.
2. Edge functions `wallet-create-order`, `wallet-verify-payment`, `wallet-checkout-page`, and the webhook branch;
   deployed by CLI with the same JWT settings as today's functions. A rule test for the HMAC and the limits.
3. The app screen, rules file and tests; tsc, bundle; APK only on request. Feature doc
   `docs/features/android/shared/team-wallet.md` and `web/shared/team-wallet-backend.md`.
4. Live test with one real Rs 500 top-up: the row goes pending, paid; the balance reads Rs 500; the webhook log shows
   the captured event; a second verify call changes nothing.
5. iOS handoff generated from the finished files.

## 9. Decided, nothing open
- 2 Nov 2026 (evening, owner): the first 3 AI plans per trainer are free (non-Essentials clients; Essentials always free, never counted); the count comes from the logs we have (the ledger's free rows from now on plus the AI plans already saved in the plan registry); "3 free left / 2 free left" shows in the plan creator; an admin may add Rs 1 for testing.
Rs 30 to 50 per AI plan by the client's data blocks, trainers only, shown after the draft, one-tap deduct, draft held
until paid; receipt push after a top-up; Rs 500 minimum and Rs 5,000 a day; checkout in the app; own history only;
one 12-column ledger table. Build starts on the owner's go, in the order of section 8.
