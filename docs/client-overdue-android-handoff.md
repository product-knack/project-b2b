# New policy (pause allowance + Professional Holding Fee): Android staff app handoff (30 Oct 2026)

Replaces the first version of this file (93d8316, the 22-Oct "overdue fee" draft that was never run). Built on the web and the database on 30 Oct 2026: hub-track migrations `20261030130000_new_policy_pause_allowance.sql` and `20261030140000_professional_holding_fee.sql`; feature file `b2b/docs/features/web/admin/new-policy.md`; plan `b2b/docs/plans/new-policy-pause-payment-2026-10-30.md`. Nothing in this app has been changed. The client app has its own file: `b2c-pause-policy-handoff.md`.

## The rules (server, nothing to compute in the app)
- Only accounts on the new policy (`clients.new_policy_adoption` on the card that holds the package; a couple follows the paying partner, a family its admin). Essentials, Trial, Influencer, Staff are outside it.
- Pause allowance per package: 1 month 0, 2 = 7, 3 = 15, 4 = 20, 5 = 25, 6 = 30, 8 = 40, 12 = 60 days (5 a month from 3 months for other lengths). Paused days move the package end date. Unused days expire.
- From the package end date until a renewal is recorded: no new bookings or session logs dated on or after the end date.
- Holding fee: Rs 800 a day per professional reserved (trainer, therapist, physiotherapist; each person once; at least 1), at most 7 days, list frozen on day 1; renewal stops it; admin settles (paid, added to renewal, waived with a reason).
- Day 8 without a renewal: the programme is put on hold (a pause row with `source = system_hold`), the professionals' `trainer_clients` rows are switched off, the CRM is told to assign a trainer when the client renews.

## 1. Messages the trainer / manager / CRM app will now get **needed**
Show the sentence after the code through `friendlyError`; never retry these.
- `PACKAGE_ENDED: <Name>'s package ended on 22 Nov 2026, so sessions from that day cannot be booked until the renewal is recorded.` on a `session_schedule` insert (or a move to another day), and the log variant ("a session on 30 Nov cannot be logged") on a `training_sessions` insert. An offline queued log dated before the end date is fine.
- `PROGRAMME_PAUSED: <Name>'s programme is paused on 3 Nov 2026. Resume it first, or book another day.` on a booking on a paused day.
- Pause dialogs (CRM / admin, which insert `client_pause_history` directly today) for a new-policy client: `PAUSE_NO_BALANCE`, `PAUSE_NOT_INCLUDED`, `PAUSE_OUTSIDE_PACKAGE`, `PAUSE_OVERLAP` sentences; an open-ended pause is cut to the balance by the server.
- Admin and super admin bookings are not refused.

## 2. My Crew day plan **needed**
`plan_sync_roster` returns per entry `result = "package_ended"` or `"programme_paused"` with `message`, `schedule_id` null; nothing of that client is touched. Show it like `plan_expired` (a tag on the card entry + the message). The member also gets a push "Session not added to your roster" (`data.type = crew_package_ended` / `crew_programme_paused`).

## 3. Pushes the staff will receive (no app change needed, routes optional)
`programme_paused`, `programme_resumed` (client paused or resumed from the client app), `package_ended` (booked sessions after the end date removed), `programme_on_hold` (day 8: professionals released), `assign_trainer_after_hold` (CRM: renewed after a hold).

## 4. Admin and CRM client screens **optional, parity with the web**
- `get_client_overdue(p_client_id)` (crm, admin, super_admin) → `{visible, new_policy, pending[], pending_total, settled[], credits[], on_hold, hold{since, released[]}, professionals_now[]}`; each pending item has `days, amount, per_day, professional_count, professionals[{id,name,role}], package_end, package_end_base, paused_in_package, first_day, last_day, completed, stopped (renewed | seven_days | null), package_id`.
- `get_pause_balance(p_client_id)` → the allowance card ("Total pause days: 15 · Used: 4 · Left: 11").
- Admin only: `mark_client_overdue_paid(package_id, amount, note)`, `waive_client_overdue(package_id, reason)` (reason of 5+ characters), `apply_overdue_credit(package_id, 'refund', null, note)`, `set_client_new_policy(client_id, value, reason)`.
- Wording to copy from web `src/lib/clientOverdue.ts` and `src/lib/pauseAllowance.ts` (pure files, copy byte for byte).

## Do not
- Write `clients.overdues_status`, `client_renewals.overdues_status` or `clients.new_policy_adoption` (server only).
- Insert or update a `system_hold` pause, or work out days, amounts or balances on the device.
