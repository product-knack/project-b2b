# Client app (B2C): Programme Pause and Payment Policy handoff (30 Oct 2026)

Built on the server and the staff web on 30 Oct 2026 (hub-track migrations `20261030130000_new_policy_pause_allowance.sql` and `20261030140000_professional_holding_fee.sql`; plan `b2b/docs/plans/new-policy-pause-payment-2026-10-30.md`). The client app code is not on our machine; this file is everything the client app needs. Nothing works differently for a client until the migrations are run.

## Who it applies to
Only clients on the **new policy** (`clients.new_policy_adoption`; every card created from 30 Oct 2026 and the cards whose first payment was on or after 22 Oct 2026). A couple and a generation family follow the card that holds the package (the paying partner, the family admin). Essentials, Trial, Influencer and Staff are outside it. The app never reads the flag itself: every answer below already says `new_policy`.

## 1. Pause and resume (new screens)
### Read
`get_pause_balance()` (no argument = the signed-in client) returns:
```json
{ "new_policy": true, "months": 3, "entitled": 15, "used": 4, "left": 11,
  "package_start": "2026-10-25", "package_end": "2027-01-29", "package_end_base": "2027-01-25", "paused_in_package": 4,
  "active_pause": null | { "id": "...", "start": "2026-11-20", "end": "2026-11-30", "source": "client_app" },
  "on_hold": false, "can_pause": true, "cannot_pause_reason": null | "OLD_POLICY" | "NO_PACKAGE" | "EXCLUDED" | "ON_HOLD" | "PACKAGE_ENDED" | "NOT_INCLUDED" | "ALREADY_PAUSED" | "NO_BALANCE",
  "is_holder": true, "holder_name": "Asha Rao", "history": [ { "start": "...", "end": "...", "source": "client_app", "counts": true } ] }
```
### Screen
- On the programme screen, for `new_policy` clients only, a card: **"Total pause days: 15 · Used: 0 · Left: 15"** (exactly this format, with `entitled`, `used`, `left`), "Package ends 29 Jan 2027 (incl. 4 paused days)" when `paused_in_package > 0`, and a progress bar of used over total.
- **Pause programme** button when `can_pause` and `is_holder`; **Resume programme** when `active_pause` is set and `is_holder`. A partner or family member sees the card read-only with "Only {holder_name} can pause the programme".
- When `can_pause` is false, show the reason in place of the button (texts below, same as the server sends).
- Confirm before pausing: "Pause your programme from today? Your pause days are used one a day until you resume, at most {left} days. Booked sessions from today are cancelled."
### Write
- `client_pause_programme()` → the new balance (pause starts today, runs at most `left` days, booked sessions inside it are removed, the trainers and the CRM are told).
- `client_resume_programme()` → the new balance (the pause ends yesterday; pausing and resuming on the same day uses 0 days).
- Errors come as `CODE: sentence`; show the sentence. Codes: `PAUSE_NOT_INCLUDED` ("A 1-month package has no pause days."), `PAUSE_NO_BALANCE`, `PAUSE_ALREADY_PAUSED`, `PAUSE_PACKAGE_ENDED`, `PAUSE_ON_HOLD`, `PAUSE_OLD_POLICY`, `PAUSE_ONLY_HOLDER`, `PAUSE_NOT_PAUSED`.
- The app must never insert or update `client_pause_history` directly. **Please confirm the app does not do this today** (we are about to close direct writes: `20261030150000_pause_history_write_access.sql`, run only after your confirmation).

## 2. Booking after the package end
A booking (`session_schedule`) or a session log dated on or after the package end date is refused until the renewal is recorded: `PACKAGE_ENDED: Asha's package ended on 22 Nov 2026, so sessions from that day cannot be booked until the renewal is recorded.` A booking on a paused day: `PROGRAMME_PAUSED: ...`. Show the sentence.

## 3. In-app circular (ours, posted when your release is out)
`get_my_circulars()` already returns circulars; we added an audience for new-policy clients. When the pause screens are in a released build, we run `supabase/queries/circular_pause_programme_20261030.sql`, which posts:
- Title: **New feature on the app: Pause your programme**
- Body: the Programme Pause Policy text below, word for word.
Nothing to change in the app for this (it already shows circulars).

## 4. Terms of use / customer agreement popup
Add the two policies below to the terms of use / customer agreement popup, word for word. When the client accepts, record it with our existing consent function, which now takes a new kind:
```
record_my_consent('customer_agreement', '{"version": "2026-10-30", "accepted_at": "<ISO time>"}')
```
(stored on the profile as `consent_details.customer_agreement`, earlier versions kept in `customer_agreement_history`). Bump `version` whenever the text changes.

**Note for the manager:** the Payment Policy says "INR 800 per day", while the rule agreed on 30 Oct 2026 (D8) is Rs 800 per day **per professional reserved** (two professionals = Rs 1,600 a day). The text below is copied as given; if the rule stays per professional, the text should say so before it goes in the app.

### Programme Pause Policy (verbatim)
Programme Pause Policy
Pause Entitlement: Clients are entitled to a fixed number of pause days based on their subscription duration, as specified below:
1-month membership: no pause days
2-month membership: 7 pause days
3-month membership: 15 pause days
6-month membership: 30 pause days
Pausing and Resuming the Programme: Clients may pause and resume their programme directly through the Odds Application at any time, subject to their available pause-day balance. There is no limit on the number of times a client may pause or resume their programme, provided the total pause days used do not exceed their allocated entitlement.
Tracking of Pause Days: The Odds Application will display the total pause days available and the total pause days used for the client's subscription. Clients are responsible for monitoring their available pause-day balance. For example, a client with a 3-month membership will be entitled to 15 pause days, and the application will display the total days available and the days used.
Expiry of Unused Pause Days: Pause days are valid only for the duration of the applicable subscription. Any unused pause days will expire upon the end of the subscription period and cannot be carried forward to a subsequent subscription or added as an extension to the existing subscription.
Expiry of Unutilised Sessions: The sessions recommended for a client under their subscription must be utilised within the applicable subscription period. Any recommended sessions that remain unused upon expiry or completion of the subscription will lapse and cannot be availed of after the subscription ends.

### Payment Policy (verbatim)
Payment Policy
To ensure continuity with your currently assigned professionals, we recommend completing your programme renewal payment by the end date of your current subscription. Beyond this date, a Professional Holding Fee of INR 800 per day will apply for up to one week, allowing us to reserve the same coaches and experts for you during this period. If the renewal payment remains pending beyond this extension, your programme will be temporarily paused, and a new trainer will be assigned when you renew your programme.
Since we truly value your association with us, we would also be happy to waive the entire Professional Holding Fee previously paid, should you complete your next renewal payment by the due date.

## 5. Optional, later
- Show "Your package ends on {package_end}. Renew by then to keep your professionals." from 7 days before the end (the data is in `get_pause_balance`).
- After day 8 without a renewal `on_hold` is true: "Your programme is paused until you renew."
