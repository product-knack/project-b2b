# Client overdue fee: Android handoff (30 Oct 2026)

Built on the web and the database on 30 Oct 2026 (hub-track migration `20261030120000_client_overdue_fee.sql`, feature file `b2b/docs/features/web/admin/client-overdue.md`). Nothing in this app has been changed. This note lists what the app needs so it says the same thing as the web.

## The rule (server, nothing to compute in the app)
- Clients onboarded on or after 22 Oct 2026 (`clients.payment_date`) whose package ends without a renewal owe Rs 800 a day, at most 7 days (Rs 5,600). Day 1 is the package end date. Paused days are skipped. A renewal stops it (the renewal day is not charged). A client marked inactive is frozen at that day. Essentials, Trial, Influencer and Staff are left out.
- Couple: only the partner who paid sees it. Odds generation: only the family admin; members never.
- After day 7, while unpaid and not renewed, new sessions cannot be booked for the client, the partner or the family members.

## 1. Booking refusals (trainer app, every build that books sessions) **needed**
- Any `session_schedule` insert by a trainer, manager, CRM or ops for a held client now fails with
  `OVERDUE_LOCKED: <Name>'s package ended on 22 Nov 2026 and the overdue of Rs 5,600 for 7 days is unpaid, so new sessions cannot be booked. Ask the admin to record the renewal or mark the overdue paid.`
- Show the sentence after `OVERDUE_LOCKED: ` through `friendlyError` (plain-English rule); never retry it. Admin and super admin bookings pass.
- Sessions already booked can still be logged; workout logging is not affected.

## 2. My Crew day plan **needed**
- `plan_sync_roster` returns a new per-entry result `overdue_locked` with `message` (the sentence above), `schedule_id` null. Show it like `plan_expired`: a tag on the card entry and the message; nothing of that client was touched. The member also gets a push "Session not added to your roster" with the sentence (`data.type = crew_overdue_locked`).

## 3. Admin client screen (admin workspace) optional, parity
- Read `get_client_overdue(p_client_id uuid)` → `{visible, pending[], pending_total, settled[], per_day, max_days, as_of, account_kind, account_blocked}`; show nothing when `visible` is false.
- Each pending item: `days, amount, max_days, package_end, first_day, last_day, completed, stopped (renewed | inactive | seven_days | null), stopped_at, paused_days, package_id`.
- Mark as paid: `mark_client_overdue_paid(p_package_id, p_amount, p_note)` with `p_amount` = the item's `amount`, behind a confirmation. Errors: `OVERDUE_CHANGED` (amount moved on, reload), `OVERDUE_NOT_PENDING`, `OVERDUE_FORBIDDEN` (not admin).
- Wording to copy from web `src/lib/clientOverdue.ts` (pure, copy byte for byte): `overdueHeadline` ("Day 3 of 7" / "7 days completed"), `overdueStatusLine`, `overdueChipText` ("Overdue ₹2,400 · day 3 of 7"), `amountIfRenewedToday`.

## 4. Admin renewal **optional**
- After saving a renewal for a client with a pending overdue, `add_client_overdue_to_renewal(p_package_id, p_renewal_id, p_amount)` with `p_amount = amountIfRenewedToday(item)` records it as added. The web does this behind an unticked "Mark as added to this renewal".

## 5. CRM client screen **optional, parity**
- Same reader as 3, read-only banner: "Overdue payment pending: ₹X", the headline, "New sessions on hold" after day 7, the status line + "The admin collects it."

## Do not
- Write `clients.overdues_status` or `client_renewals.overdues_status` (a guard refuses: `OVERDUE_SERVER_ONLY`).
- Work out days or amounts on the device.
