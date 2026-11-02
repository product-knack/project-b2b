# iOS handoff: Team Wallet, end to end (specification, 2 Nov 2026)

This is a build specification, not a copy of finished code: the Android app and the backend are built from the same
text at the same time, so the iOS app can be built in parallel and come out identical. Every contract the two apps
share is fixed here: the table, the server functions, the edge function request and answer shapes, the error codes and
their sentences, the push payloads, the cache keys and every screen text. When the Android pure rules file
(`src/lib/teamWallet.ts`) and its test exist, they replace section 3.1 byte for byte; until then build 3.1 exactly as
written. The backend is built once (hub-track) and used by both apps; iOS builds nothing on the server.
Owner decisions: odds-app/docs/team-wallet-plan.md. Copy rule: no dashes in user-facing text.

## 1. What the user sees

Free drafts (owner, 2 Nov 2026 evening): a trainer's first 3 AI plans for non-Essentials clients are free, an Essentials client is always free. The Create Plan AI card and the panel say "3 free AI plans left. After that Rs 30 to 50 a plan from your wallet." (singular for 1) or "Free for Essentials clients."; a free Generate behaves exactly like today (the draft lands in the builder, no bill sheet) and the count drops; once the free ones are used the wallet rules below apply. The Wallet history shows a free draft as "Odds AI plan, <name>" with the amount text "Free", chip FREE, line "Free plan, not charged" (or "Free for Essentials clients"); the balance card says "N free AI plans left" while any remain. Any account may add exactly Rs 1 as a test top-up while the wallet is being tested (type 1 in the box; the sheet passes it, hint "Rs 1 test top-up (testing only)."; the server accepts 100 paise and refuses Rs 2 to Rs 499). While the wallet read has no data yet, the sheet assumes the full day's room so Continue is never locked by a missing read.

### 1.1 Wallet (drawer item "Wallet", every role, route `wallet`)
- Title "Wallet", sub "Add money, see your history".
- **Balance card:** big "Rs 2,500" (whole rupees with Indian grouping, from paise), under it "Updated 2 Nov, 3:10 PM"
  (the time of the last read). While loading: a spinner in the card. Offline: the cached value and "Offline, last
  known balance".
- **Add money** (orange button under the card). Opens the Add money sheet (1.2). Off while offline, with the line
  "No connection. Money can only be added online."
- **History**, grouped by IST month ("NOVEMBER 2026"), newest first, one row per movement:
  - left: the title and a second line; right: the amount, "+ Rs 2,000" (green) or "- Rs 40" (white), and a status
    chip.
  - titles: top-up "Added money"; AI plan "Odds AI plan, <client first name>"; reversal "Returned"; refund "Refunded to
    your bank"; adjustment "Adjustment by Odds".
  - second line: "2 Nov, 3:08 PM" plus, for a paid row, "Balance Rs 2,500"; for a pending top-up "Waiting for payment";
    for a pending AI bill "Bill waiting: deduct or discard"; for failed "Failed: <reason>"; for expired "Expired, not
    charged"; for cancelled "Discarded".
  - status chips: PAID (green), WAITING (amber), FAILED (red), EXPIRED (grey), DISCARDED (grey).
  - tap a row: the detail sheet (1.4). Tap a pending top-up: the checkout reopens (1.3). Tap a pending AI bill: the
    bill sheet (1.5).
  - end of list: "That is everything." Empty: "No movements yet. Add money to start." Load more on scroll (cursor).
- Pull to refresh.

### 1.2 Add money sheet
- Title "Add money", line "Minimum Rs 500. Up to Rs 5,000 a day."
- Quick picks: "Rs 500", "Rs 1,000", "Rs 2,000", "Rs 5,000" (chips); an open box "Amount in rupees" (number pad,
  whole rupees only; digits only, at most 4).
- Under the box, live: "You can add Rs 3,000 more today." (from `today_room_paise`), or in red "The minimum is Rs 500."
  / "You can add Rs 3,000 more today." when the typed amount passes it / "You have added Rs 5,000 today. Try again
  tomorrow." when the room is 0 (then every chip is off).
- Buttons: Cancel, **Continue** (on only when the amount is valid and the phone is online). Continue calls
  `wallet-create-order` (2.3), then opens the checkout (1.3). A server refusal shows its sentence in red under the box.

### 1.3 Checkout (full-screen WebView)
- A full-screen modal with a header "Pay Rs 2,000" and a Close button; the WebView loads the checkout page
  (2.3, `wallet-checkout-page`), which opens Razorpay Standard Checkout at once (UPI apps, cards, net banking).
- The page posts a message to the app when done (2.3). On `{ok: true}` the app calls `wallet-verify-payment`; on
  success it closes the modal, shows the alert "Rs 2,000 added" with "Balance Rs 2,500", and refreshes the screen.
  On `{dismissed: true}` it closes the modal; the row stays "Waiting for payment" for 30 minutes and can be reopened
  from the history row. On `{failed: true, reason}` it closes and shows the alert "Payment failed" with the reason.
- While a top-up is pending the screen subscribes to its row (2.5); a webhook credit that lands after the modal was
  closed updates the balance and the row within seconds and shows the same "Rs 2,000 added" alert.
- Close with the back gesture or the Close button: same as dismissed.

### 1.4 Movement detail sheet
- Title = the row title; lines: Amount, Status, When (created), Paid at (paid rows), Balance after (paid rows),
  Payment id (top-ups: `razorpay.payment_id`), Order id, Method ("UPI" / "Card" / "Net banking" / "Wallet"), Note.
  Copy button next to the payment id. Nothing editable.

### 1.5 Odds AI plan bill (Create Plan, trainers only)
- Before Generate, on the "Generate with Odds AI" card (existing): a line "Wallet Rs 2,000". No price is shown. When
  the balance is under Rs 50 the card is greyed with "Add money in Wallet" (a button that opens the Wallet screen) and
  the reason line "You need at least Rs 50 in your wallet to make an AI plan." When a bill is waiting:
  "Settle or discard your last draft first." with **Open bill**.
- Generate as today. When the server answers with a bill, the **bill sheet** opens:
  title "Your plan is ready", line "Your bill is Rs 40.", preview "4 sections, 27 exercises", line "Wallet Rs 2,000,
  after this Rs 1,960", buttons **Deduct from wallet** (green, one tap) and **Discard** (grey).
- Deduct calls `wallet-settle-ai-plan`; on success the sheet closes and the draft is applied to the builder exactly as
  today's AI draft is. Short balance: the sheet shows "Your wallet has Rs 30. This needs Rs 40. Add money in Wallet."
  with the Wallet button; the bill stays, the sheet reopens from the card or from the Wallet history.
- Discard calls `wallet-discard-ai-plan`; the sheet closes, "Draft discarded. Nothing was charged." as a toast line
  on the card. After the third discard of the day the server refuses: "You have discarded 3 drafts today. Try again
  tomorrow."
- Admins, super admins and coaches: the card and Generate exactly as today, no wallet line, no bill.

### 1.6 Pushes
- After a top-up is paid: title "Rs 2,000 added to your wallet", body "Balance Rs 2,500." (trainers: "Balance Rs
  2,500. Odds AI plans cost Rs 30 to 50 each."), data `{type: 'wallet_topup', route: 'wallet', tx_id}`. Tap opens
  the Wallet screen.

## 2. Data and server contract (built once in hub-track; both apps consume)

### 2.1 The table `team_wallet` (the exact DDL; iOS reads it only through the function in 2.2)
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
  razorpay            jsonb,                                           -- NULL for non-Razorpay rows
  meta                jsonb NOT NULL DEFAULT '{}'::jsonb,
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
```
- `razorpay` keys: `order_id`, `payment_id`, `signature`, `method` (upi, card, netbanking, wallet), `event`,
  `payment` (trimmed payment entity), `refund_id`.
- `meta` keys: `note`, `reference`, `created_by`, `failed_at`, `failure_reason`; AI bills: `draft_ref`, `client_id`,
  `client_name`, `blocks` (the data blocks that set the bill), `draft` (held until settled, then removed).
- Rules the app can rely on: a pending top-up expires 30 minutes after `created_at`; a pending AI bill 24 hours; a
  paid row never changes; the balance is the `balance_after_paise` of the user's highest-`seq` paid row.

### 2.2 The read the app uses: `get_my_team_wallet(p_limit integer default 50, p_before timestamptz default null)`
RPC, authenticated, own rows only. Answer (jsonb):
```json
{
  "balance_paise": 250000,
  "today_topup_paise": 200000,
  "today_room_paise": 300000,
  "min_topup_paise": 50000,
  "daily_cap_paise": 500000,
  "ai_bill_min_paise": 3000,
  "ai_bill_max_paise": 5000,
  "charges_ai": true,
  "free_total": 3,
  "free_used": 1,
  "free_left": 2,
  "rows": [
    { "id": "uuid", "seq": 12, "user_id": "uuid", "role": "trainer", "kind": "topup", "amount_paise": 200000, "status": "paid", "balance_after_paise": 250000,
      "created_at": "2026-11-02T09:38:00Z", "paid_at": "2026-11-02T09:40:11Z",
      "razorpay": { "order_id": "order_x", "payment_id": "pay_x", "method": "upi" },
      "meta": { "note": "Add money" } }
  ]
}
```
- Also `ai_floor_paise` (5000) and `pending_bill` (`{tx_id, bill_paise, client_id, client_name, created_at, preview}` or null). `charges_ai` is true for role trainer only. `rows` are newest first, at most `p_limit` (max 200); pass the last
  row's `created_at` as `p_before` for the next page. `razorpay.signature` and `razorpay.payment` are never returned.
- Refusal: `WALLET_SIGN_IN: Sign in to see your wallet.` (42501).

### 2.3 Edge functions (HTTPS, `Authorization: Bearer <session access token>`, JSON in and out)
| function | request | answer | refusals (`error` = `CODE: sentence`) |
|---|---|---|---|
| `wallet-create-order` | `{ "amount_inr": 2000 }` (or `{ "reopen_tx_id" }` for the caller's own pending top-up: same answer, no new row, 410 after 30 minutes) | `{ "tx_id", "order_id", "amount_paise", "currency": "INR", "key_id", "checkout_url", "prefill": { "name", "email", "contact" } }` | `WALLET_MIN_AMOUNT: The minimum top-up is Rs 500.` / `WALLET_MIN_AMOUNT: Enter whole rupees, at least Rs 500.` / `WALLET_DAILY_CAP: You can add Rs 3000 more today. The limit is Rs 5000 a day.` / `WALLET_DAILY_CAP: You have added Rs 5000 today. The limit is Rs 5000 a day. Try again tomorrow.` / `WALLET_PENDING_LIMIT: Two top-ups are already waiting for payment. Finish or cancel one first.` / `WALLET_FORBIDDEN: ...` (42501) / `WALLET_PROVIDER: Razorpay did not accept the order. Try again.` |
| `wallet-checkout-page` | GET `?tx=<tx_id>&t=<short-lived token from create-order>` | an HTML page | a plain page "This link has expired. Go back and tap Add money again." |
| `wallet-verify-payment` | `{ "tx_id", "razorpay_order_id", "razorpay_payment_id", "razorpay_signature" }` | `{ "ok": true, "credited_now": true, "row": <row as in 2.2>, "balance_paise" }` (`credited_now false` when the webhook got there first) | `WALLET_SIGNATURE: The payment could not be verified. If money left your account it will be added within a few minutes.` / `WALLET_NOT_FOUND: This top-up was not found.` / `WALLET_NOT_CAPTURED: The payment is still processing. Your wallet updates when it completes.` |
| `wallet-settle-ai-plan` | `{ "tx_id" }` | `{ "ok": true, "already": false, "result": <the whole ai-plan-draft answer: draft, dropped, sources, model, generated_at>, "balance_paise", "row" }` (a paid bill answers again with `already: true` and the same result)  | `WALLET_INSUFFICIENT: Your wallet has Rs 30. This needs Rs 40. Add money in Wallet.` / `WALLET_CANCELLED: This draft was discarded.` / `WALLET_NOT_FOUND: ...` |
| `wallet-discard-ai-plan` | `{ "tx_id" }` | `{ "ok": true }` | `WALLET_DISCARD_LIMIT: You have discarded 3 drafts today. Try again tomorrow.` / `WALLET_NOT_FOUND: ...` |
| `ai-plan-draft` (existing, changed) | as today; `preview: true` answer gains `{ "wallet": { "charges", "balance_paise", "floor_paise", "free_total", "free_used", "free_left", "essentials", "free_this", "billed", "pending_bill": {...} or null, "ok", "reason" } }`; a free draft (`free_this`) answers the draft as today plus `wallet: { free: true, essentials, free_left, free_total }`; a billed draft for a trainer answers `{ "bill": { "tx_id", "bill_paise", "balance_paise" }, "preview": { "sections": ["Chest", ...], "exercise_count": 27 } }` INSTEAD of the draft | as today | `WALLET_FLOOR: You need at least Rs 50 in your wallet to make an AI plan.` / `WALLET_BILL_PENDING: Settle or discard your last draft first.` |
- Every refusal arrives as HTTP 400 (402 for `WALLET_INSUFFICIENT`, 403 for `WALLET_FORBIDDEN` / `WALLET_SIGN_IN`, 503 for `WALLET_NOT_SET_UP` while the migration is not run) with body
  `{ "error": "CODE: sentence" }`. The app shows the sentence after the colon (`codedSentence`, with `WALLET_` added to
  its pattern), then `friendlyError` for anything else.
- The checkout page protocol: the page posts ONE message through `window.ReactNativeWebView.postMessage(JSON.stringify(m))`
  where `m` is `{ "ok": true, "razorpay_order_id", "razorpay_payment_id", "razorpay_signature" }`, or
  `{ "dismissed": true }` (`paid: true` when the row was already paid, `expired: true` for a lapsed link), or
  `{ "failed": true, "reason": "<Razorpay's description>" }`. A failed attempt does NOT close the sheet: Razorpay offers a
  retry inside it; the app keeps the reason and reports it when the sheet is finally closed. The page never holds the key
  secret; it holds the public key id, the order id, the amount and the prefill. Links that start with `upi://`,
  `intent://`, `tez://`, `phonepe://`, `paytmmp://` must be handed to the system (`Linking.openURL`), not loaded in the
  WebView (`onShouldStartLoadWithRequest` returns false for them); when the user comes back, Razorpay's page polls the
  payment itself and posts the result.

### 2.4 Pushes (server, through the staff push helper)
- `wallet_topup` (1.6) only. Payload data: `{ "type": "wallet_topup", "route": "wallet", "tx_id": "<uuid>" }`. In
  `PushTokenManager`: `if (t === 'wallet_topup') { go('wallet'); return; }`.

### 2.5 Cache and realtime
- Query keys: `['team-wallet']` (the read in 2.2, staleTime 15 s, refetch on focus), `['team-wallet', 'page', before]`
  for later pages, `['ai-plan-preview', clientId]` already exists and now carries `wallet`.
- After verify, settle, discard: invalidate `['team-wallet']`; after settle also the plan caches as today's AI draft
  apply does.
- Realtime: while any own row is pending, subscribe to `postgres_changes` on `public.team_wallet` with filter
  `user_id=eq.<uid>` (RLS lets the user see only their rows); on any change invalidate `['team-wallet']`; when a
  pending top-up turns paid, show the "Rs X added" alert once (dedupe by tx_id in a ref).
- Persisted cache: the wallet read is plain JSON and may be persisted (the app's persister rule: no Map / Set).

## 3. Code to build (iOS, mirroring the Android file names)

### 3.1 `src/lib/teamWallet.ts` (pure, no React Native imports; Android's file will replace it byte for byte)
Exports and exact behaviour (node-tested in `tests/rules/team_wallet_test.js`):
- `MIN_TOPUP_PAISE = 50000`, `DAILY_CAP_PAISE = 500000`, `AI_FLOOR_PAISE = 5000`, `TOPUP_PICKS = [50000, 100000, 200000, 500000]`.
- `rupees(paise: number): string` → "Rs 2,000" (Indian grouping: 1,00,000; no decimals; negative shown as "- Rs 40";
  0 → "Rs 0").
- `signedRupees(paise)` → "+ Rs 2,000" / "- Rs 40".
- `parseRupeeInput(text: string): number | null` → whole rupees from digits only ("2,000" → 2000; "20.5" → null; "" →
  null); returns the paise value (2000 → 200000).
- `topupProblem(amountPaise: number | null, roomPaise: number): string | null` → null when ok; "The minimum is Rs
  500." when below; "You have added Rs 5,000 today. Try again tomorrow." when room is 0; "You can add Rs 3,000 more
  today." when above the room.
- `rowTitle(row)`, `rowSecondLine(row)`, `rowChip(row) → { text, tone: 'green' | 'amber' | 'red' | 'grey' }` with the
  texts of 1.1.
- `monthHeader(iso)` → "NOVEMBER 2026" (IST).
- `groupByMonth(rows)` → `[{ header, rows }]` newest first.
- `isPendingTopup(row)`, `isPendingBill(row)`, `topupExpired(row, nowMs)` (30 minutes), `methodLabel(method)`.
- `billLines(billPaise, balancePaise)` → `{ bill: "Your bill is Rs 40.", after: "Wallet Rs 2,000, after this Rs 1,960" }`.
- `walletCardState(balancePaise, pendingBill, chargesAi)` → `'free' | 'ok' | 'floor' | 'bill_pending'` with the card
  copy of 1.5.
- `codedWalletSentence(e)`: the sentence after `WALLET_...:`; the shared `codedSentence` in `approvalRequests.ts` gains
  `WALLET` in its regex on both apps.
Test cases (the Android test will carry exactly these): formatting of 0, 500, 2000, 100000, 250050 paise; parse of
"2,000", "500", "20.5", "", "abc"; topupProblem for 40000, 50000, 350000 with room 300000, any amount with room 0;
row titles for each kind; chips for each status; expiry at 29 and 31 minutes; billLines; card states.

### 3.2 `src/lib/teamWalletQueries.ts`
- `useTeamWallet()`: `rpc('get_my_team_wallet', { p_limit: 50 })` through `withTimeout(..., NET_MS)`, key
  `['team-wallet']`.
- `useTeamWalletPage(before)`: the next page.
- `useCreateTopup()`: `invokeWithTimeout('wallet-create-order', { body: { amount_inr } })`.
- `useVerifyTopup()`, `useSettleAiBill()`, `useDiscardAiBill()`: the matching functions; all invalidate `['team-wallet']`.
- `useWalletRealtime(enabled)`: the subscription of 2.5.
- Errors: `codedSentence(e) ?? friendlyError(e, '<plain fallback>')`.

### 3.3 `src/screens/wallet.tsx`
- `Page` with `TitleBlock`, the balance `Card`, the Add money button, the grouped history (`SectionList`), pull to
  refresh through `Page`. Sheets: Add money (1.2), detail (1.4), the checkout modal (3.4). Sheet rules: `useKeyboardHeight`
  padding, a sibling backdrop, `keyboardShouldPersistTaps="handled"`, `hitSlop` 10, one Modal at a time.
- Offline (`useIsOnline`): the Add money button off with the line of 1.1; nothing queued.
- Replay shield: add `wallet` to `SENSITIVE_ROUTES` (money on screen).

### 3.4 `src/components/WalletCheckout.tsx`
- Full-screen `Modal`; `WebView` from `react-native-webview` with `source={{ uri: checkout_url }}`,
  `onMessage` parsing the one JSON message of 2.3, `onShouldStartLoadWithRequest` handing the UPI and intent schemes to
  `Linking.openURL`, `javaScriptEnabled`, `domStorageEnabled`, a loading spinner until the first load, and the Close
  button (= dismissed). Android has the same component.

### 3.5 Create Plan (`src/screens/createPlan.tsx`, `AiPlanAssistant.tsx`)
- The preview call now carries `wallet`; `walletCardState` picks the card copy of 1.5.
- The Generate press for a trainer gets `{ bill, preview }` instead of the draft: open the bill sheet
  (`src/components/AiBillSheet.tsx`): Deduct → `useSettleAiBill` → on `{ draft }` apply it exactly where today's draft is
  applied; Discard → `useDiscardAiBill`. A pending bill found in the preview answer reopens the same sheet from the
  card's **Open bill**.
- Non-trainers: no change.

### 3.6 Plumbing
- `Router.tsx`: route `wallet` → `Wallet`; `chrome.tsx`: drawer item "Wallet" (icon: a card or coin) for every role,
  under the profile items; `PushTokenManager.tsx`: the `wallet_topup` route; `approvalRequests.ts` `codedSentence`:
  add `WALLET` to `(?:OTP|APPROVAL|LOCATION|WALLET)_`.

## 4. Check on the iPhone (once the backend is live)
1. Wallet opens for every role with "Rs 0" and "No movements yet. Add money to start."
2. Add money: Rs 400 shows "The minimum is Rs 500." and Continue stays off; Rs 2,000 continues; the checkout opens;
   pay by UPI (the UPI app opens and returns); the alert "Rs 2,000 added" shows "Balance Rs 2,000"; the history has
   "Added money, PAID, Balance Rs 2,000". The push "Rs 2,000 added to your wallet" arrives.
3. Close the checkout without paying: the row reads "Waiting for payment"; tap it: the checkout reopens; wait 30
   minutes: EXPIRED.
4. Add Rs 3,500 on the same day: "You can add Rs 3,000 more today." in red; Continue off.
5. As a trainer with Rs 30: the Create Plan AI card is greyed with "Add money in Wallet". With Rs 2,000: Generate;
   the bill sheet reads "Your bill is Rs 40." for a client with a QHP and medical history; Deduct; the draft fills
   the builder; the Wallet history has "Odds AI plan, <client>, - Rs 40, PAID, Balance Rs 1,960".
6. Generate again and Discard: "Draft discarded. Nothing was charged." No wallet row charged (a DISCARDED row shows).
7. Airplane mode: the balance shows from the cache with "Offline, last known balance"; Add money is off.
8. As an admin: Create Plan AI card exactly as today, no wallet line, no bill.
9. `node tests/rules/team_wallet_test.js`: ALL PASS.

Status 2 Nov 2026 (evening): the seven edge functions are deployed; the migration `20261102160000_team_wallet.sql` is
written and PGlite-tested (27 of 27) but NOT run yet (until then every wallet call answers WALLET_NOT_SET_UP and the AI
plan drafts free). Android is built (section 5 below is generated from the finished files). Not confirmed on a phone:
the Razorpay sheet inside the WebView with a UPI app round trip (first real Rs 500 top-up pending). Where this file and
the code disagree, the code in section 5 wins.

## 5. Code as built (generated from the Android tree, 2 Nov 2026)

New files in full, then the diff hunks of the edited files (`git diff -U4` against 755512e, the tree before any wallet work). The server files are listed at the end for reference; iOS builds none of them.

### `src/lib/teamWallet.ts` (new)
Pure rules. Copy byte for byte; the test below must pass against it.

```ts
/* Team Wallet rules (2 Nov 2026). Pure: no React, no network; tested in node (tests/rules/team_wallet_test.js) and
   copied byte for byte to iOS. The server (hub-track migration 20261102160000) holds every limit; these are the
   same numbers for the sheet's live hints and the copy of every row, chip and bill line.
   Owner: Rs 500 minimum, Rs 5,000 per person per IST day, the Odds AI plan costs Rs 30 to 50 (trainers only),
   shown after the draft, one tap Deduct from wallet. Plan: docs/team-wallet-plan.md. */

export const MIN_TOPUP_PAISE = 50000;
/** Exactly Rs 1 is accepted as a test top-up (owner, 2 Nov 2026, while the wallet is being tested). */
export const TEST_TOPUP_PAISE = 100;
export const DAILY_CAP_PAISE = 500000;
export const AI_FLOOR_PAISE = 5000;
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
  charges_ai: boolean;
  free_total: number;
  free_used: number;
  free_left: number;
  pending_bill: PendingBill | null;
  rows: WalletRow[];
};
/** What ai-plan-draft's preview says about the caller's wallet (null while the wallet is not on the server).
    Free drafts (owner, 2 Nov 2026): a trainer's first 3 AI plans for non-Essentials clients are free (free_left), an
    Essentials client is always free; free_this = this draft costs nothing, billed = the bill sheet will follow. */
export type WalletGate = {
  charges: boolean; balance_paise: number; floor_paise: number;
  free_total: number; free_used: number; free_left: number; essentials: boolean; free_this: boolean; billed: boolean;
  pending_bill: PendingBill | null; ok: boolean; reason: 'WALLET_FLOOR' | 'WALLET_BILL_PENDING' | null;
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
  ai_floor_paise: num(d?.ai_floor_paise, AI_FLOOR_PAISE),
  charges_ai: d?.charges_ai === true,
  free_total: num(d?.free_total, FREE_DRAFTS),
  free_used: num(d?.free_used),
  free_left: num(d?.free_left),
  pending_bill: parsePendingBill(d?.pending_bill),
  rows: (Array.isArray(d?.rows) ? d.rows : []).map(parseWalletRow).filter(Boolean) as WalletRow[],
});
export const parseWalletGate = (w: any): WalletGate | null => {
  if (!w || typeof w !== 'object') return null;
  const reason = w.reason === 'WALLET_FLOOR' || w.reason === 'WALLET_BILL_PENDING' ? w.reason : null;
  const charges = w.charges === true;
  const free_left = num(w.free_left);
  const essentials = w.essentials === true;
  const free_this = typeof w.free_this === 'boolean' ? w.free_this : !charges || essentials || free_left > 0;
  return {
    charges, balance_paise: num(w.balance_paise), floor_paise: num(w.floor_paise, AI_FLOOR_PAISE),
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
export type WalletCardState = 'free' | 'essentials' | 'free_left' | 'ok' | 'floor' | 'bill_pending' | 'unknown';
/** "3 free AI plans left" / "1 free AI plan left" */
export const freeLeftLine = (n: number): string => `${n} free AI plan${n === 1 ? '' : 's'} left`;
/** The Create Plan AI card: what the wallet allows and the line to show. */
export const walletCardState = (w: WalletGate | null | undefined): { state: WalletCardState; line: string | null; action: 'wallet' | 'bill' | null } => {
  if (!w) return { state: 'unknown', line: null, action: null };
  if (!w.charges) return { state: 'free', line: null, action: null };
  if (w.essentials) return { state: 'essentials', line: 'Free for Essentials clients.', action: null };
  if (w.free_left > 0) return { state: 'free_left', line: `${freeLeftLine(w.free_left)}. After that Rs 30 to 50 a plan from your wallet.`, action: null };
  if (w.pending_bill) return { state: 'bill_pending', line: 'Settle or discard your last draft first.', action: 'bill' };
  if (w.balance_paise < w.floor_paise) return { state: 'floor', line: `Wallet ${rupees(w.balance_paise)}. You need at least ${rupees(w.floor_paise)} in your wallet to make an AI plan.`, action: 'wallet' };
  return { state: 'ok', line: `Free AI plans used. Wallet ${rupees(w.balance_paise)}, Rs 30 to 50 a plan.`, action: null };
};

/** The sentence after "WALLET_CODE:" of a server refusal, else null. */
export const codedWalletSentence = (e: unknown): string | null => {
  const msg = String((e as { message?: unknown } | null)?.message ?? '').trim();
  const m = msg.match(/^WALLET_[A-Z_]+:\s*(.+)$/s);
  return m && m[1].trim() ? m[1].trim() : null;
};
export const walletCodeOf = (e: unknown): string | null => String((e as { message?: unknown } | null)?.message ?? '').match(/^(WALLET_[A-Z_]+):/)?.[1] ?? null;
```

### `tests/rules/team_wallet_test.js` (new)
Rule test (62 checks). Copy as is; ROOT resolves to the repo root.

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
const gate = (o) => W.parseWalletGate({ charges: true, balance_paise: 200000, floor_paise: 5000, free_total: 3, free_used: 3, free_left: 0, essentials: false, free_this: false, billed: true, pending_bill: null, ok: true, reason: null, ...o });
eq('card: not charged', W.walletCardState(gate({ charges: false, free_this: true, billed: false })).state, 'free');
eq('card: ok (free used up)', W.walletCardState(gate({})), { state: 'ok', line: 'Free AI plans used. Wallet Rs 2,000, Rs 30 to 50 a plan.', action: null });
eq('card: 3 free left', W.walletCardState(gate({ free_used: 0, free_left: 3, free_this: true, billed: false })), { state: 'free_left', line: '3 free AI plans left. After that Rs 30 to 50 a plan from your wallet.', action: null });
eq('card: 1 free left (singular)', W.walletCardState(gate({ free_used: 2, free_left: 1, free_this: true, billed: false })).line, '1 free AI plan left. After that Rs 30 to 50 a plan from your wallet.');
eq('card: Essentials client is free even with 0 left', W.walletCardState(gate({ essentials: true, free_this: true, billed: false, balance_paise: 0 })), { state: 'essentials', line: 'Free for Essentials clients.', action: null });
eq('card: floor', W.walletCardState(gate({ balance_paise: 3000, ok: false, reason: 'WALLET_FLOOR' })), { state: 'floor', line: 'Wallet Rs 30. You need at least Rs 50 in your wallet to make an AI plan.', action: 'wallet' });
eq('card: bill pending', W.walletCardState(gate({ pending_bill: read.pending_bill, ok: false, reason: 'WALLET_BILL_PENDING' })), { state: 'bill_pending', line: 'Settle or discard your last draft first.', action: 'bill' });
eq('card: unknown', W.walletCardState(null).state, 'unknown');
eq('gate parse', W.parseWalletGate({ charges: true, balance_paise: 3000, floor_paise: 5000, pending_bill: null, ok: false, reason: 'WALLET_FLOOR' }).reason, 'WALLET_FLOOR');
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

### `src/lib/teamWalletQueries.ts` (new)
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

export type TopupOrder = { tx_id: string; order_id: string; amount_paise: number; checkout_url: string; key_id: string };
const parseOrder = (d: any): TopupOrder => {
  if (!d?.tx_id || !d?.checkout_url) throw new Error('The checkout could not be prepared. Try again.');
  return { tx_id: String(d.tx_id), order_id: String(d.order_id ?? ''), amount_paise: Number(d.amount_paise) || 0, checkout_url: String(d.checkout_url), key_id: String(d.key_id ?? '') };
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
  return {
    draft: d.draft,
    dropped: Array.isArray(d.dropped) ? d.dropped : [],
    sources: d.sources ?? null,
    model: String(d.model ?? ''),
    generated_at: String(d.generated_at ?? new Date().toISOString()),
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

### `src/screens/wallet.tsx` (new)
The Wallet screen with its three sheets.

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
import { useTeamWallet, useTeamWalletPage, useCreateTopup, useVerifyTopup, useWalletRealtime, walletErrorText } from '../lib/teamWalletQueries';
import {
  DAILY_CAP_PAISE, TEST_TOPUP_PAISE, TOPUP_PICKS, fmtWhen, freeLeftLine, groupByMonth, isPendingBill, isPendingTopup, methodLabel, parseRupeeInput, rowAmountText, rowChip, rowSecondLine, rowTitle, rupees,
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
  const [checkout, setCheckout] = React.useState<{ url: string; txId: string; amountPaise: number } | null>(null);
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
        setCheckout({ url: o.checkout_url, txId: o.tx_id, amountPaise: o.amount_paise });
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
      verifyM.mutate({ tx_id: c.txId, razorpay_order_id: m.razorpay_order_id, razorpay_payment_id: m.razorpay_payment_id, razorpay_signature: m.razorpay_signature }, {
        onSuccess: (r) => { trackEvent('Wallet Topup Paid', { amount_paise: c.amountPaise }); if (r.row) announce({ ...r.row, balance_after_paise: r.row.balance_after_paise ?? r.balance_paise }); else Alert.alert(`${rupees(c.amountPaise)} added`, `Balance ${rupees(r.balance_paise)}.`); },
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

  return (
    <Page gap={16} pt={6}>
      <TitleBlock title="Wallet" sub="Add money, see your history" />

      <Card colors={['rgba(60,38,24,0.5)', 'rgba(18,14,14,0.55)']} radius={20} style={{ padding: 18, gap: 6 }}>
        <Mono style={{ fontSize: 9, letterSpacing: 1.2, color: C.muted3 }}>BALANCE</Mono>
        {q.isPending ? <ActivityIndicator color={C.orange} style={{ alignSelf: 'flex-start', marginVertical: 8 }} /> : (
          <Serif style={{ fontSize: 38, color: (data?.balance_paise ?? 0) < 0 ? C.red : '#fff' }}>{rupees(data?.balance_paise ?? 0)}</Serif>
        )}
        <Body style={{ fontSize: 11.5, color: C.muted2 }}>
          {!online ? 'Offline, last known balance' : updatedAt ? `Updated ${fmtWhen(new Date(updatedAt).toISOString())}` : notSetUp ? 'The wallet is not set up on the server yet.' : q.isError ? walletErrorText(q.error, 'Could not load the wallet. Pull to refresh.') : ''}
        </Body>
        {data?.charges_ai ? <Body style={{ fontSize: 11, color: C.muted3, marginTop: 2 }}>{data.free_left > 0 ? `${freeLeftLine(data.free_left)}. After that Odds AI plans cost Rs 30 to 50 each, deducted here.` : 'Odds AI plans cost Rs 30 to 50 each, deducted here. Essentials clients stay free.'}</Body> : null}
      </Card>

      <Pressable onPress={() => { setAddErr(null); setAddOpen(true); }} disabled={!online || notSetUp} accessibilityRole="button" accessibilityLabel="Add money" style={{ borderRadius: 13, overflow: 'hidden', opacity: online && !notSetUp ? 1 : 0.5 }}>
        <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 13 }}>
          <Icon name="plus" size={15} color="#fff" strokeWidth={2.6} />
          <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: '#fff' }}>Add money</Text>
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
      <WalletCheckout visible={!!checkout} url={checkout?.url ?? null} amountPaise={checkout?.amountPaise ?? 0}
        onMessage={onCheckoutMessage} onClose={() => onCheckoutMessage({ dismissed: true })} />
    </Page>
  );
}
```

### `src/components/WalletCheckout.tsx` (new)
The full-screen WebView checkout.

```tsx
/* Team Wallet checkout (2 Nov 2026): a full-screen WebView on the server's wallet-checkout-page, which opens Razorpay
   Standard Checkout at once and posts ONE message back: { ok, razorpay_order_id, razorpay_payment_id, razorpay_signature }
   | { dismissed } | { failed, reason }. UPI and app intents (upi://, intent://, tez://, phonepe://, paytmmp://) are handed
   to the system so GPay, PhonePe and Paytm open; Razorpay's page polls the payment when the user comes back.
   Close = dismissed: the row stays "Waiting for payment" for 30 minutes and can be reopened from the history. */
import React from 'react';
import { View, Text, Pressable, Modal, ActivityIndicator, Linking, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { C, F } from '../theme';
import { Icon } from '../icons';
import { Body } from './primitives';
import { rupees } from '../lib/teamWallet';

export type CheckoutMessage =
  | { ok: true; razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }
  | { dismissed: true; paid?: boolean; expired?: boolean; error?: boolean }
  | { failed: true; reason: string };

const EXTERNAL = /^(upi|intent|tez|phonepe|paytmmp|gpay|bhim|credpay|cred|market):/i;

export function WalletCheckout({ visible, url, amountPaise, onMessage, onClose }: {
  visible: boolean;
  url: string | null;
  amountPaise: number;
  onMessage: (m: CheckoutMessage) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = React.useState(true);
  const [note, setNote] = React.useState<string | null>(null);
  React.useEffect(() => { if (visible) { setLoading(true); setNote(null); } }, [visible, url]);

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
          {url ? (
            <WebView
              source={{ uri: url }}
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

### `src/components/AiBillSheet.tsx` (new)
The bill sheet shown after a trainer's draft.

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

### Edited files (diff hunks)

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
diff --git a/src/components/AiPlanAssistant.tsx b/src/components/AiPlanAssistant.tsx
index 9d0a105..17b3033 100644
--- a/src/components/AiPlanAssistant.tsx
+++ b/src/components/AiPlanAssistant.tsx
@@ -12,8 +12,11 @@ import { Icon } from '../icons';
 import { Body, Mono, Serif } from './primitives';
 import { trackEvent } from '../lib/amplitude';
 import { useAiPlanDraft } from '../lib/aiPlanQueries';
 import { SPLITS, splitOf, aiPromptLine, sourcesLine, draftExerciseCount, draftNewExercises, type AiPlanPreview, type AiPlanResult, type SplitKey } from '../lib/aiPlanDraft';
+import { useStore } from '../store';
+import { walletCardState, rupees } from '../lib/teamWallet';
+import { AiBillSheet, type AiBillTarget } from './AiBillSheet';
 
 const AI = '#A78BFA';
 const STEPS = ['Reading the QHP', 'Checking blood markers and medical history', 'Picking exercises from the Odds library', 'Setting sets, reps and rest', 'Checking every exercise against the library'];
 
@@ -25,9 +28,22 @@ export function AiPlanAssistant({ clientId, clientName, preview, onApply }: {
       `prompt` is the registry's ai_prompt for this draft: the split label and the note as one line. */
   onApply: (r: AiPlanResult, prompt: string) => void;
 }) {
   const draftM = useAiPlanDraft();
+  const { go } = useStore();
   const [open, setOpen] = React.useState(true);
+  /* Team Wallet (2 Nov 2026): a trainer's draft is held behind a bill of Rs 30 to 50 until Deduct from wallet.
+     The panel shows the wallet line, refuses Generate under Rs 50 or while a bill waits, and opens the bill sheet
+     after the draft (or for the waiting bill the preview reports). */
+  const [bill, setBill] = React.useState<AiBillTarget>(null);
+  const [billNote, setBillNote] = React.useState<string | null>(null);
+  const wallet = walletCardState(preview.wallet);
+  const pendingBill = preview.wallet?.pending_bill ?? null;
+  const openPendingBill = () => {
+    if (!pendingBill || !preview.wallet) return;
+    setBill({ tx_id: pendingBill.tx_id, bill_paise: pendingBill.bill_paise, balance_paise: preview.wallet.balance_paise, preview: pendingBill.preview, clientName: pendingBill.client_name ?? clientName });
+  };
+  const walletBlocks = wallet.state === 'floor' || wallet.state === 'bill_pending';
   const [split, setSplit] = React.useState<SplitKey | null>(null);
   const [note, setNote] = React.useState('');
   const [result, setResult] = React.useState<AiPlanResult | null>(null);
   const [step, setStep] = React.useState(0);
@@ -49,9 +65,16 @@ export function AiPlanAssistant({ clientId, clientName, preview, onApply }: {
     if (!split || draftM.isPending) return;
     trackEvent('AI Plan Generate Tapped', { client_id: clientId, split, has_note: !!note.trim() });
     try {
       // Sessions a week: the server takes the client's weekly slot count (owner, 16 Oct 2026: no picker).
-      const r = await draftM.mutateAsync({ clientId, split, note });
+      const a = await draftM.mutateAsync({ clientId, split, note });
+      if (a.kind === 'bill') {
+        setBillNote(null);
+        trackEvent('AI Plan Bill Shown', { client_id: clientId, split, bill_paise: a.bill.bill_paise, blocks: a.bill.blocks.length });
+        setBill({ tx_id: a.bill.tx_id, bill_paise: a.bill.bill_paise, balance_paise: a.bill.balance_paise, preview: a.preview, clientName });
+        return;
+      }
+      const r = a.result;
       setResult(r);
       trackEvent('AI Plan Generated', { client_id: clientId, split, model: r.model, exercises: draftExerciseCount(r.draft), not_in_db: draftNewExercises(r.draft).length, dropped: r.dropped.length });
       onApply(r, aiPromptLine(r.draft.split_label || splitOf(split)?.label || split, note));
     } catch (e: any) {
@@ -59,8 +82,15 @@ export function AiPlanAssistant({ clientId, clientName, preview, onApply }: {
     }
   };
 
   const src = sourcesLine(preview.sources);
+  const applyPaid = (r: AiPlanResult) => {
+    setBill(null);
+    setResult(r);
+    setBillNote(null);
+    trackEvent('AI Plan Generated', { client_id: clientId, split: r.draft.split, model: r.model, exercises: draftExerciseCount(r.draft), not_in_db: draftNewExercises(r.draft).length, dropped: r.dropped.length, paid: true });
+    onApply(r, aiPromptLine(r.draft.split_label || splitOf(r.draft.split)?.label || r.draft.split, note));
+  };
 
   return (
     <LinearGradient colors={['rgba(76,52,140,0.42)', 'rgba(18,14,22,0.6)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
       style={{ borderRadius: 20, borderWidth: 1, borderColor: hexA(AI, 0.4), padding: 15, gap: 13 }}>
@@ -83,8 +113,27 @@ export function AiPlanAssistant({ clientId, clientName, preview, onApply }: {
               <Body style={{ flex: 1, fontSize: 11, color: C.ink3, lineHeight: 15 }}>Reads {src}</Body>
             </View>
           ) : null}
 
+          {wallet.state !== 'free' && wallet.state !== 'unknown' ? (
+            <View style={{ gap: 8, padding: 11, borderRadius: 12, backgroundColor: walletBlocks ? hexA(C.gold, 0.08) : 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: walletBlocks ? hexA(C.gold, 0.35) : 'rgba(255,255,255,0.06)' }}>
+              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
+                <Icon name="rupee" size={12} color={walletBlocks ? C.gold : C.muted} strokeWidth={2.2} />
+                <Body style={{ flex: 1, fontSize: 11.5, color: walletBlocks ? C.gold : C.ink3, lineHeight: 15 }}>{wallet.line}</Body>
+              </View>
+              {wallet.action === 'wallet' ? (
+                <Pressable onPress={() => go('wallet')} hitSlop={10} accessibilityRole="button" style={{ alignSelf: 'flex-start', paddingVertical: 7, paddingHorizontal: 12, borderRadius: 9, backgroundColor: hexA(C.orange, 0.16), borderWidth: 1, borderColor: hexA(C.orange, 0.5) }}>
+                  <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: C.orange }}>Add money in Wallet</Text>
+                </Pressable>
+              ) : wallet.action === 'bill' ? (
+                <Pressable onPress={openPendingBill} hitSlop={10} accessibilityRole="button" style={{ alignSelf: 'flex-start', paddingVertical: 7, paddingHorizontal: 12, borderRadius: 9, backgroundColor: hexA(AI, 0.18), borderWidth: 1, borderColor: hexA(AI, 0.55) }}>
+                  <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: AI }}>Open bill{pendingBill ? `, ${rupees(pendingBill.bill_paise)}` : ''}</Text>
+                </Pressable>
+              ) : null}
+            </View>
+          ) : null}
+          {billNote ? <Body style={{ fontSize: 11.5, color: C.green }}>{billNote}</Body> : null}
+
           {/* 1 · split */}
           <View style={{ gap: 8 }}>
             <Mono style={{ fontSize: 9.5, letterSpacing: 1.3, color: AI }}>CHOOSE A SPLIT</Mono>
             {SPLITS.map((s) => {
@@ -117,19 +166,20 @@ export function AiPlanAssistant({ clientId, clientName, preview, onApply }: {
             <TextInput value={note} onChangeText={(t) => setNote(t.slice(0, 300))} placeholder="e.g. no machines at home, wants to focus on posture" placeholderTextColor={C.muted3} multiline
               style={{ minHeight: 48, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.03)', color: '#fff', fontFamily: F.body, fontSize: 13, textAlignVertical: 'top' }} />
           </View>
 
-          <Pressable onPress={generate} disabled={!split || draftM.isPending} hitSlop={6} accessibilityRole="button" accessibilityState={{ disabled: !split || draftM.isPending }}
-            style={{ borderRadius: 14, overflow: 'hidden', opacity: !split ? 0.5 : 1 }}>
+          <Pressable onPress={generate} disabled={!split || draftM.isPending || walletBlocks} hitSlop={6} accessibilityRole="button" accessibilityState={{ disabled: !split || draftM.isPending || walletBlocks }}
+            style={{ borderRadius: 14, overflow: 'hidden', opacity: !split || walletBlocks ? 0.5 : 1 }}>
             <LinearGradient colors={['#8B5CF6', '#6D28D9']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14 }}>
               {draftM.isPending ? <ActivityIndicator size="small" color="#fff" /> : <Icon name="sparkle" size={15} color="#fff" strokeWidth={2.2} />}
               <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: '#fff' }}>
                 {draftM.isPending ? `Drafting… ${secs}s` : !split ? 'Choose a split first' : result ? 'Generate again' : 'Generate workout plan'}
               </Text>
             </LinearGradient>
           </Pressable>
           {draftM.isPending ? <Body style={{ fontSize: 11, color: AI, textAlign: 'center' }}>{STEPS[step]}…</Body> : null}
-          {draftM.error && !draftM.isPending ? <Body style={{ fontSize: 11.5, color: C.red }}>{(draftM.error as Error).message}</Body> : null}
+          {draftM.error && !draftM.isPending ? <Body style={{ fontSize: 11.5, color: C.red }}>{(draftM.error as Error).message.replace(/^WALLET_[A-Z_]+:\s*/, '')}</Body> : null}
+          {wallet.state === 'ok' && !result ? <Body style={{ fontSize: 10.5, color: C.muted3, textAlign: 'center' }}>Rs 30 to 50 a draft, shown after it is made. Deduct in one tap or discard it.</Body> : null}
 
           {result && !draftM.isPending ? (
             <View style={{ gap: 9, padding: 12, borderRadius: 14, backgroundColor: hexA(C.green, 0.07), borderWidth: 1, borderColor: hexA(C.green, 0.3) }}>
               <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
@@ -165,7 +215,9 @@ export function AiPlanAssistant({ clientId, clientName, preview, onApply }: {
             </View>
           ) : null}
         </>
       ) : null}
+      <AiBillSheet bill={bill} onDeducted={applyPaid} onClose={() => setBill(null)}
+        onDiscarded={() => { setBill(null); setBillNote('Draft discarded. Nothing was charged.'); trackEvent('AI Plan Draft Discarded', { client_id: clientId }); }} />
     </LinearGradient>
   );
 }
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
index 290d543..ee61e9b 100644
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
 
@@ -42,9 +43,11 @@ export type AiPlanSources = {
   sessions_last_30_days: number;
   weekly_slots: { day: string | null; time: string | null; modality: string | null }[];
   suggested_sessions_per_week: number;
 };
-export type AiPlanPreview = { eligible: boolean; allowed: boolean; essentials: boolean; client_name: string; sources: AiPlanSources; model: string };
+/** wallet (Team Wallet, 2 Nov 2026): does the caller pay for drafts (trainers), the balance and a waiting bill;
+    null while the wallet is not on the server. */
+export type AiPlanPreview = { eligible: boolean; allowed: boolean; essentials: boolean; client_name: string; sources: AiPlanSources; model: string; wallet: WalletGate | null };
 export type AiPlanResult = { draft: AiPlanDraft; dropped: string[]; sources: AiPlanSources; model: string; generated_at: string };
 
 const str = (v: unknown) => (v == null ? '' : String(v));
 
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
index fafb0e5..733e6d4 100644
--- a/src/screens/createPlan.tsx
+++ b/src/screens/createPlan.tsx
@@ -18,8 +18,9 @@ import { enqueueOutbox, getIsOnline, useIsOnline, getOutbox, updateOutboxItem }
 import { useDragReorder } from '../lib/useDragReorder';
 import { AiPlanAssistant } from '../components/AiPlanAssistant';
 import { useAiPlanPreview } from '../lib/aiPlanQueries';
 import { draftToBodyParts, shouldFill, draftExerciseCount, aiChoice, planSource, type AiPlanResult, type PlanBuildMode } from '../lib/aiPlanDraft';
+import { walletCardState } from '../lib/teamWallet';
 import { trackEvent } from '../lib/amplitude';
 
 /* ============ CREATE WORKOUT PLAN ============
    Mirrors the web app's Create Workout Plan form end-to-end (client, plan meta,
@@ -250,8 +251,10 @@ export function CreatePlan() {
   const aiPreviewQ = useAiPlanPreview(selectedClientId, !isEdit && isOnline);
   const aiAllowed = !isEdit && aiPreviewQ.data?.allowed === true;
   const [mode, setMode] = React.useState<PlanBuildMode | null>(isEdit ? 'manual' : null);
   const aiPick = aiChoice({ online: isOnline, clientId: selectedClientId, modality, allowed: isEdit ? false : aiPreviewQ.data ? aiPreviewQ.data.allowed : null });
+  // Team Wallet (2 Nov 2026): a trainer pays Rs 30 to 50 a draft; the card says what the wallet allows (the panel holds the buttons).
+  const walletCard = walletCardState(aiPreviewQ.data?.wallet ?? null);
   const chooseMode = (m: PlanBuildMode) => {
     setMode(m);
     // An AI draft is a Strength Training plan (it covers the Strength and Cardio days).
     if (m === 'ai' && !modality) setModality('Strength Training');
@@ -512,8 +515,9 @@ export function CreatePlan() {
               </View>
               <Icon name="chevRight" size={16} color="#A78BFA" strokeWidth={2.4} />
             </View>
             {aiPick.reason ? <Body style={{ fontSize: 11, color: C.gold }}>{aiPick.reason}</Body> : null}
+            {!aiPick.reason && walletCard.line ? <Body style={{ fontSize: 11, color: walletCard.state === 'ok' ? C.muted2 : C.gold }}>{walletCard.line}</Body> : null}
           </Pressable>
           <Pressable onPress={() => chooseMode('manual')} hitSlop={6} accessibilityRole="button"
             style={{ padding: 16, borderRadius: 20, backgroundColor: 'rgba(50,30,19,0.45)', borderWidth: 1, borderColor: hexA(C.orange, 0.4), gap: 10 }}>
             <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
```

### Server files for reference (deployed from hub-track; nothing to build on iOS)

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
    const body = `Balance ${rupees(Number(row.balance_after_paise ?? 0))}.${row.role === "trainer" ? " Odds AI plans cost Rs 30 to 50 each." : ""}`;
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

#### `supabase/functions/wallet-checkout-page/index.ts`

```ts
// wallet-checkout-page (Team Wallet, 2 Nov 2026): the HTML page the app's WebView loads to pay a top-up.
// GET ?tx=<tx_id>&t=<token minted by wallet-create-order>. Public (no bearer: a WebView sends none after the
// first navigation); the token (tx id + expiry + HMAC with the key secret, 35 minutes) is the only key. The page
// holds the public key id, the order id, the amount and the prefill, never a secret, and opens Razorpay Standard
// Checkout at once. It posts ONE message to the app through window.ReactNativeWebView.postMessage:
//   { ok: true, razorpay_order_id, razorpay_payment_id, razorpay_signature }   the app then calls wallet-verify-payment
//   { dismissed: true }                                                       the sheet was closed (row stays pending 30 min)
//   { failed: true, reason }                                                  an attempt failed (Razorpay offers a retry; the app
//                                                                             shows the reason when the sheet is finally closed)
// A paid row shows "Already added" and posts { dismissed: true, paid: true }; an expired / failed / missing row or
// a bad token shows the plain expired line. Spec: odds-app/docs/ios-team-wallet-handoff.md section 2.3.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { rupees, verifyCheckoutToken } from "../_shared/teamWallet.ts";

const html = (body: string, status = 200) =>
  new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Frame-Options": "SAMEORIGIN", "Referrer-Policy": "no-referrer" } });
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const STYLE = `<style>
  html,body{margin:0;height:100%;background:#0e0a09;color:#fff;font-family:-apple-system,system-ui,"Segoe UI",Roboto,sans-serif}
  .box{min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px;text-align:center;box-sizing:border-box}
  .t{font-size:22px;font-weight:700}.s{font-size:14px;color:#a8a09a;line-height:1.5;max-width:320px}
  button{margin-top:8px;padding:12px 22px;border-radius:12px;border:1px solid #f08a3c;background:rgba(240,138,60,0.14);color:#f08a3c;font-weight:700;font-size:15px}
  .spin{width:28px;height:28px;border-radius:50%;border:3px solid rgba(255,255,255,0.15);border-top-color:#f08a3c;animation:r 0.9s linear infinite}@keyframes r{to{transform:rotate(360deg)}}
</style>`;
const page = (title: string, inner: string, script = "") =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"><title>${esc(title)}</title>${STYLE}</head><body><div class="box">${inner}</div><script>
  window.__post = function (m) { var s = JSON.stringify(m); try { if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) { window.ReactNativeWebView.postMessage(s); return true; } } catch (e) {} return false; };
  ${script}</script></body></html>`;

Deno.serve(async (req) => {
  if (req.method !== "GET") return html(page("Wallet", `<div class="t">Wallet</div><div class="s">Open this page from the Odds app.</div>`), 405);
  try {
    const url = new URL(req.url);
    const tx = await verifyCheckoutToken(url.searchParams.get("t") ?? "");
    const expired = page("Link expired", `<div class="t">This link has expired</div><div class="s">Go back and tap Add money again.</div>`, `window.__post({ dismissed: true, expired: true });`);
    if (!tx || tx !== url.searchParams.get("tx")) return html(expired, 403);

    const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: row } = await svc.from("team_wallet").select("id, user_id, kind, status, amount_paise, created_at, razorpay").eq("id", tx).maybeSingle();
    if (!row || row.kind !== "topup" || !row.razorpay?.order_id) return html(expired, 404);
    if (row.status === "paid") {
      return html(page("Already added", `<div class="t">${esc(rupees(Number(row.amount_paise)))} already added</div><div class="s">This top-up is already in your wallet.</div>`, `window.__post({ dismissed: true, paid: true });`));
    }
    const tooOld = Date.now() - new Date(row.created_at).getTime() > 30 * 60_000;
    if (row.status !== "pending" && !(row.status === "failed" && !tooOld)) return html(expired, 410);
    if (tooOld) return html(expired, 410);

    const keyId = Deno.env.get("RAZORPAY_KEY_ID") ?? "";
    const { data: prof } = await svc.from("profiles").select("first_name, last_name, email, phone").eq("id", row.user_id).maybeSingle();
    const name = [prof?.first_name, prof?.last_name].filter(Boolean).join(" ").trim() || "Odds staff";
    const options = {
      key: keyId,
      amount: Number(row.amount_paise),
      currency: "INR",
      name: "Odds Fitness",
      description: "Team Wallet top-up",
      order_id: row.razorpay.order_id,
      prefill: { name, email: prof?.email ?? "", contact: prof?.phone ?? "" },
      notes: { purpose: "team_wallet_topup", wallet_tx_id: row.id },
      theme: { color: "#F08A3C", backdrop_color: "#0e0a09" },
      retry: { enabled: true, max_count: 3 },
      remember_customer: false,
    };
    const amount = rupees(Number(row.amount_paise));
    const inner = `<div class="spin" id="spin"></div><div class="t">Paying ${esc(amount)}</div><div class="s" id="s">Opening the Razorpay checkout. Choose UPI, a card or net banking.</div><button id="again" style="display:none">Open the checkout again</button>`;
    const script = `
  var opts = ${JSON.stringify(options)};
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
  var tag = document.createElement('script'); tag.src = 'https://checkout.razorpay.com/v1/checkout.js'; tag.onload = openCheckout;
  tag.onerror = function () { spin.style.display = 'none'; status('Razorpay could not load. Check your connection, then open the checkout again.'); again.style.display = 'inline-block'; };
  document.head.appendChild(tag);`;
    return html(page(`Pay ${amount}`, inner, script));
  } catch (e) {
    console.error("[wallet-checkout-page]", e);
    return html(page("Wallet", `<div class="t">Something went wrong</div><div class="s">Close this page and tap Add money again.</div>`, `window.__post({ dismissed: true, error: true });`), 500);
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
