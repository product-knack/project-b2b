# iOS handoff 3 of N: Trainer Incentive page with UGC submissions (19 Sep 2026)

Paste this whole doc to the iOS app's coding assistant. It adds a trainer sidebar page **Incentive**: a
card for the **User Generated Content (UGC)** programme (a client posts a reel or stories with ODDSFITNESS,
the trainer submits the link, admin approves, the payout follows) and, under it, the trainer's own
incentive events with their status. Shipped on Android (odds-app) on 19 Sep 2026. Admin review happens in
the Plutus web app; nothing about review is built in the mobile app.

---

## 0. Ground rules

1. **The backend is LIVE and SHARED** (Supabase project `agtjszjedaenclbzgjvi`). Do NOT create, alter or run
   any SQL. The table columns and CHECKs this needs were added on 19 Sep 2026
   (`odds-app/supabase/incentive_ugc_migration.sql`, already run).
2. **Reference implementation** in the Android React Native repo `odds-app`: `src/screens/incentives.tsx`
   (screen `Incentives`, `UgcSheet`, `EventRow`), `src/lib/incentiveUgcQueries.ts` (NOT `incentiveQueries.ts`,
   which is an unrelated CRM feature), `src/lib/referralQueries.ts` (`useMyReferralClients`, reused for the
   client picker), the nav item in `src/data.ts` and the route in `src/Router.tsx`.
3. Use the signed-in user's id (`session.user.id`) for reads and for `user_id` on insert. Never a dev / test
   trainer id: RLS reads `user_id = auth.uid()`, so a substituted id shows an empty list.
4. Every network call through the app's `withTimeout`. No em dashes in user copy. The sheet follows the
   app's sheet rules: keyboard-height bottom padding, backdrop as a SIBLING of the sheet (not a parent
   Pressable), `keyboardShouldPersistTaps="handled"` on every ScrollView, hitSlop 10 or more on small taps.

---

## 1. What the trainer experiences

1. Sidebar, trainer nav, group **My Work**, a new item **Incentive** (gift icon) right after Payouts and
   Referrals → route `incentives`.
2. Page title "Incentive", sub-line "Programmes you can claim from the app".
3. **UGC card** (tappable, opens the sheet): caps label "UGC", title "User Generated Content", sub-line
   "A client posts a reel or stories with ODDSFITNESS; you submit the link.", a chevron, then three tier rows
   with dots and amounts:
   - Reel with collaboration ₹3,000
   - Reel without collaboration ₹1,500
   - 2+ stories tagging ODDSFITNESS ₹2,000

   Bottom row: badges "N pending review" (gold, only when N > 0) and "₹X approved" (green, only when X > 0),
   and on the right a pill "+ Submit UGC".
4. **Submit UGC sheet** (bottom sheet, slide up): grab handle, title "Submit UGC", close button, the intro
   "A client posted a reel or stories with ODDSFITNESS. Admin checks the post; once approved it counts
   towards your payout." Then:
   - **WHAT WAS POSTED \*** : three radio rows (label, blurb, amount on the right):
     - "Reel with collaboration" / "Client shoots and posts a reel in collaboration with ODDSFITNESS" / ₹3,000
     - "Reel without collaboration" / "Client posts a reel but does not accept the collaboration tag" / ₹1,500
     - "2+ stories tagging ODDSFITNESS" / "Client posts two or more stories tagging ODDSFITNESS" / ₹2,000
   - **CLIENT WHO POSTED \*** : a field "Select a client" that expands an inline list (not a second modal)
     with a search input "Search your clients", max height 200, "No clients match." when filtered empty; the
     picked client shows in the field with a small clear (x) button.
   - **LINK TO THE POST \*** : text input, placeholder "https://www.instagram.com/reel/…", URL keyboard, no
     autocapitalize / autocorrect; the border turns red while the text is non-empty and invalid.
   - **POSTED ON · SWIPE FOR EARLIER** : a horizontal strip of the last 14 IST days, today first; each chip
     shows the weekday caps ("TODAY", "YDAY", then "MON", "TUE" ...), the day number and the month caps.
     Today is preselected.
   - **NOTES** : multiline, placeholder "Anything admin should know (optional)".
   - Buttons: **Cancel** and **Submit for approval** (orange gradient; spinner while sending; disabled until
     type, client and a valid link are set). Under them while disabled: "CONTENT TYPE, CLIENT AND LINK ARE
     REQUIRED" (tiny caps).
   - On success: success haptic, the sheet closes, alert "Submitted for approval" / "Admin reviews the post.
     Once approved it counts towards your incentive payout."
   - On error: alert "Couldn't submit" + the message; the form keeps its values and can be sent again.
5. **MY INCENTIVES · N** list under the card (a caps label with a hairline), newest first, one row per
   `incentive_events` row of this user (every event type, not just UGC):
   - title: the UGC tier label for UGC rows, else the event type label (Referral, Cross-sell, Package
     upgrade, Subscription upgrade);
   - the tier amount (for UGC rows) and a status badge: **Pending** (gold), **Approved** (green),
     **Rejected** (red), **Earned** (green) when `status` is NULL;
   - second line: the event type in caps, then " · {client name} · {23 Sep 2026}";
   - the post link (one line) and the notes (two lines) when present;
   - a 3 px left border in the status color.
   - Empty: a card with a gift icon and "No incentive events yet. Submit a UGC post above, or earn one
     through referrals and upgrades." Error: the message in red. Loading: a spinner.

---

## 2. Backend contract (live)

### Table `incentive_events`
Columns: `id, user_id, client_id, event_type, previous_value, new_value, reference_id, reference_table,
event_date, created_at, event_month, status, details`.
- `event_type` CHECK: `referral | cross_sell | package_upgrade | subscription_upgrade | ugc`.
- `status` CHECK: `NULL | 'pending' | 'approved' | 'rejected'`. NULL = a row created by an admin approval
  (already earned). The app only ever writes `'pending'`.
- `details` jsonb for UGC: `{ "content_type": "reel_collab" | "reel_no_collab" | "stories", "post_url": text,
  "notes": text | null, "platform": "instagram" }`. After admin review Plutus merges
  `details.review = { decision, by, at, note?, amount?, payout_batch_id?, source: 'plutus' }` (the app may
  ignore it).
- RLS: SELECT own rows (`user_id = auth.uid()`), admins all; INSERT open to authenticated; **no UPDATE or
  DELETE** for users. No RPC is involved on the app side.

### Read
```ts
supabase.from('incentive_events')
  .select('id, event_type, status, event_date, event_month, new_value, details, created_at, client:client_id ( first_name, last_name )')
  .eq('user_id', uid)
  .order('event_date', { ascending: false });
```
If the error message mentions `status` or `details` (a backend without the columns), retry once with
`'id, event_type, event_date, event_month, new_value, created_at, client:client_id ( first_name, last_name )'`
so the earned rows still render. `client` may arrive as an object or a one-element array; name =
`first_name + ' ' + last_name` trimmed.

### Insert (the Submit button)
```ts
const url = postUrl.trim();
if (!/^https?:\/\/\S+\.\S+/i.test(url)) throw new Error('Paste the full link to the post (starts with https://).');
if (!/^\d{4}-\d{2}-\d{2}$/.test(postedOn)) throw new Error('Pick the date it was posted.');
await supabase.from('incentive_events').insert({
  user_id: uid,
  client_id: clientId,
  event_type: 'ugc',
  new_value: contentType,                        // 'reel_collab' | 'reel_no_collab' | 'stories'
  event_date: `${postedOn}T00:00:00+05:30`,      // postedOn = 'YYYY-MM-DD', an IST calendar day
  event_month: `${postedOn.slice(0, 7)}-01`,
  status: 'pending',
  details: { content_type: contentType, post_url: url, notes: notes.trim() || null, platform: 'instagram' },
});
```
Map error code `23514` or `42703`, or a message mentioning status / details / event_type, to "UGC incentives
are not enabled on the backend yet (incentive_ugc_migration.sql). Ask admin."; anything else shows the raw
message. Guard double taps with a ref set on send and cleared on error.

### Client picker source
```ts
supabase.from('trainer_clients').select('client_id, clients ( id, first_name, last_name )').eq('trainer_id', uid);
```
De-duplicate by client id, name = first + last, sort by name. All assigned clients, active or not.

### What happens after submit (context only)
Admin opens the trainer in Plutus, sees the pending UGC request and approves (optionally marking it paid,
which writes a `trainer_payout_records` row) or rejects through the RPC `review_ugc_incentive`. The row's
`status` becomes `approved` or `rejected`; the app just re-reads it.

---

## 3. Client logic

- Constants (identical to Android and to the web's Incentive Payout card; display only, the payout system
  decides the money):
  ```ts
  export const UGC_TYPES = [
    { value: 'reel_collab', label: 'Reel with collaboration', amount: 3000, blurb: 'Client shoots and posts a reel in collaboration with ODDSFITNESS' },
    { value: 'reel_no_collab', label: 'Reel without collaboration', amount: 1500, blurb: 'Client posts a reel but does not accept the collaboration tag' },
    { value: 'stories', label: '2+ stories tagging ODDSFITNESS', amount: 2000, blurb: 'Client posts two or more stories tagging ODDSFITNESS' },
  ];
  export const EVENT_TYPE_LABEL = { ugc: 'UGC', referral: 'Referral', cross_sell: 'Cross-sell', package_upgrade: 'Package upgrade', subscription_upgrade: 'Subscription upgrade' };
  export const fmtInr = (n: number) => `₹${n.toLocaleString('en-IN')}`;
  ```
- Tier of a row: `details.content_type ?? new_value`.
- Card badges: `pending` = UGC rows with status `pending`; `approved amount` = the sum of the TIER amounts
  of UGC rows with status `approved` (the standard figure, not the admin-entered amount; same as Android).
- Dates: `fmtDay(iso)` = `toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' })`.
  The 14-day strip uses IST `YYYY-MM-DD` keys (`Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' })`).
- The sheet resets every field each time it opens (type none, client none, link empty, notes empty, date
  today) and resets the mutation state.
- Query keys: `['my-incentive-events', uid]` (staleTime 60 s) and `['my-referral-clients', uid]`
  (staleTime 5 min, fetched only while the sheet is open). On submit success invalidate
  `['my-incentive-events', uid]`, `['incentive-metrics']` and `['incentive-leaderboard']`.
- Plain arrays only, so persisting these queries is safe.

## 4. Look (Android tokens; map to yours)
- Accent for everything UGC: pink-violet `#E879F9`. Card gradient `rgba(58,24,66,0.55)` to
  `rgba(20,14,22,0.6)`, border accent at 30%, radius 19, a 3 px accent-to-transparent top rule; a 44 px rounded
  icon box (accent 14% fill, 40% border) with a filled sparkle.
- Radio rows: selected = accent 12% fill, 50% border, a filled accent circle with a dark check; unselected =
  faint fill, 20% white ring.
- Date chips 62 px wide, selected accent 14% fill / 45% border, weekday + month in Mono caps, day in Serif 19.
- Status colors: gold `#E0A53C`, green `#57C98A`, red `#E76A52`. Badge = 14% fill, bold 10 text, radius 7.
- Sheet background `#0E0A09`, top radius 26, max height 90% (95% while the keyboard is up).

## 5. Probe before building (trainer login; ask the user for one)
- `GET /rest/v1/incentive_events?select=id,status,details&user_id=eq.<uid>&limit=1` → 200 (an empty array is
  fine). A 400 mentioning `status` means the migration is missing: stop and tell the user.
- Do NOT probe the insert against production with a real trainer; the first real submission is the test.

## 6. Acceptance test
1. Sidebar shows **Incentive** for a trainer; the page shows the UGC card with the three tiers and amounts.
2. Open the sheet: Submit is disabled with the caps hint; picking a type, a client and a valid Instagram link
   enables it; an invalid link turns the border red.
3. Submit: alert "Submitted for approval"; the row appears at the top of MY INCENTIVES as **Pending** with
   the tier amount, the client and the date; the card shows "1 pending review".
4. In SQL: `select event_type, status, event_date, event_month, new_value, details from incentive_events where event_type = 'ugc' order by created_at desc limit 1;`
   shows `ugc`, `pending`, the IST midnight of the picked day, the first of that month, and the details.
5. After admin approves it in Plutus, the row turns **Approved** and the card shows "₹3,000 approved" (for a
   collab reel); a rejected one shows **Rejected** in red.
6. Referral or upgrade rows created by admin approvals show as **Earned**.
7. The keyboard never covers the link or notes fields; the backdrop tap closes the sheet; the client list
   scrolls inside the sheet.

## 7. If the iOS app is not React Native
Same reads and insert through the Supabase Swift SDK (`from("incentive_events").select(...).eq("user_id", uid)`,
`.insert(row)`); the sheet is a `.sheet` with `presentationDetents([.large])`, the client list expands inline,
the date strip is a horizontal `ScrollView`.
