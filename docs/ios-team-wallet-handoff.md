# iOS handoff: Team Wallet, end to end (specification, 2 Nov 2026)

This is a build specification, not a copy of finished code: the Android app and the backend are built from the same
text at the same time, so the iOS app can be built in parallel and come out identical. Every contract the two apps
share is fixed here: the table, the server functions, the edge function request and answer shapes, the error codes and
their sentences, the push payloads, the cache keys and every screen text. When the Android pure rules file
(`src/lib/teamWallet.ts`) and its test exist, they replace section 3.1 byte for byte; until then build 3.1 exactly as
written. The backend is built once (hub-track) and used by both apps; iOS builds nothing on the server.
Owner decisions: odds-app/docs/team-wallet-plan.md. Copy rule: no dashes in user-facing text.

## 1. What the user sees

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
  "rows": [
    { "id": "uuid", "seq": 12, "kind": "topup", "amount_paise": 200000, "status": "paid", "balance_after_paise": 250000,
      "created_at": "2026-11-02T09:38:00Z", "paid_at": "2026-11-02T09:40:11Z",
      "razorpay": { "order_id": "order_x", "payment_id": "pay_x", "method": "upi" },
      "meta": { "note": "Add money" } }
  ]
}
```
- `charges_ai` is true for role trainer only. `rows` are newest first, at most `p_limit` (max 200); pass the last
  row's `created_at` as `p_before` for the next page. `razorpay.signature` and `razorpay.payment` are never returned.
- Refusal: `WALLET_SIGN_IN: Sign in to see your wallet.` (42501).

### 2.3 Edge functions (HTTPS, `Authorization: Bearer <session access token>`, JSON in and out)
| function | request | answer | refusals (`error` = `CODE: sentence`) |
|---|---|---|---|
| `wallet-create-order` | `{ "amount_inr": 2000 }` | `{ "tx_id", "order_id", "amount_paise", "currency": "INR", "key_id", "checkout_url", "prefill": { "name", "email", "contact" } }` | `WALLET_MIN_AMOUNT: The minimum top-up is Rs 500.` / `WALLET_MIN_AMOUNT: Enter whole rupees, at least Rs 500.` / `WALLET_DAILY_CAP: You can add Rs 3000 more today. The limit is Rs 5000 a day.` / `WALLET_DAILY_CAP: You have added Rs 5000 today. The limit is Rs 5000 a day. Try again tomorrow.` / `WALLET_PENDING_LIMIT: Two top-ups are already waiting for payment. Finish or cancel one first.` / `WALLET_FORBIDDEN: ...` (42501) / `WALLET_PROVIDER: Razorpay did not accept the order. Try again.` |
| `wallet-checkout-page` | GET `?tx=<tx_id>&t=<short-lived token from create-order>` | an HTML page | a plain page "This link has expired. Go back and tap Add money again." |
| `wallet-verify-payment` | `{ "tx_id", "razorpay_order_id", "razorpay_payment_id", "razorpay_signature" }` | `{ "ok": true, "row": <row as in 2.2>, "balance_paise" }` | `WALLET_SIGNATURE: The payment could not be verified. If money left your account it will be added within a few minutes.` / `WALLET_NOT_FOUND: This top-up was not found.` / `WALLET_NOT_CAPTURED: The payment is still processing. Your wallet updates when it completes.` |
| `wallet-settle-ai-plan` | `{ "tx_id" }` | `{ "ok": true, "draft": <the AI draft json, same shape ai-plan-draft returns today>, "balance_paise" }` | `WALLET_INSUFFICIENT: Your wallet has Rs 30. This needs Rs 40. Add money in Wallet.` / `WALLET_CANCELLED: This draft was discarded.` / `WALLET_NOT_FOUND: ...` |
| `wallet-discard-ai-plan` | `{ "tx_id" }` | `{ "ok": true }` | `WALLET_DISCARD_LIMIT: You have discarded 3 drafts today. Try again tomorrow.` / `WALLET_NOT_FOUND: ...` |
| `ai-plan-draft` (existing, changed) | as today; `preview: true` answer gains `{ "wallet": { "charges": true, "balance_paise", "pending_bill": { "tx_id", "bill_paise" } or null } }`; the draft call for a trainer answers `{ "bill": { "tx_id", "bill_paise", "balance_paise" }, "preview": { "sections": ["Chest", ...], "exercise_count": 27 } }` INSTEAD of the draft | as today | `WALLET_FLOOR: You need at least Rs 50 in your wallet to make an AI plan.` / `WALLET_BILL_PENDING: Settle or discard your last draft first.` |
- Every refusal arrives as HTTP 400 (402 for `WALLET_INSUFFICIENT`, 403 for `WALLET_FORBIDDEN`) with body
  `{ "error": "CODE: sentence" }`. The app shows the sentence after the colon (`codedSentence`, with `WALLET_` added to
  its pattern), then `friendlyError` for anything else.
- The checkout page protocol: the page posts ONE message through `window.ReactNativeWebView.postMessage(JSON.stringify(m))`
  where `m` is `{ "ok": true, "razorpay_order_id", "razorpay_payment_id", "razorpay_signature" }`, or
  `{ "dismissed": true }`, or `{ "failed": true, "reason": "<Razorpay's description>" }`. The page never holds the key
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

Not confirmed: nothing is live yet; the backend ships first (migration, five edge functions, the webhook branch), and
this file is updated with the deployed function versions and the final pure rules file when Android lands.
