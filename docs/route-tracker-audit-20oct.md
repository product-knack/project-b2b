# Live ride tracking (route tracker): audit, 20 Oct 2026

**Status: SWITCHED ON 21 Oct 2026** (owner: "when an assessor starts navigation, also with the screen locked, the Leads dashboard tracks it live; give an option to track live from this page; built before but not working in the test"). Done on 21 Oct: the four broken items (1 to 4), items 5 (server), 7, 8, 9, 10, 11, 12 (server cap + protected keys), 15 (server), 16, 18 (dialog scroll, empty tiles, titles), 19 (IST), 20 (docs); missing pieces B (ops may read), C (the ride closes itself), E (the Assessor rides panel on Leads), H (planned route on checkpoints), and M for Android (the foreground service, no Play background-location declaration needed; iOS handoff written). Still open: A (the pin before the ride stays a process decision; the member app's `set_my_home_location` is the member-side fix), D (paused state), F, G, I, J, K, L, N, O, items 6 (superseded by the read-through-client rule), 13, 14 (status callback added on the lobby only), 17 (the end event now runs beside the save, so the worst case is one 20 s save). The owner decided who sees rides: the whole ops team, since the Leads page is theirs. Feature docs: `docs/features/android/trainer/route-tracker.md`, `docs/features/web/ops/route-tracker.md`. The text below is the audit as written on 20 Oct 2026.

**Previous status (20 Oct 2026): built 14 Oct 2026 on both sides, never used, parked. Needs a process decision before any code.** No phase of the build proposal below was started (owner decision 20 Oct 2026). The Leads page host was made dormant the same day (one query every 5 minutes, no realtime channel while no ride exists). Full write-up with the same numbering: the "Live Ride Tracking Audit" page shared on 20 Oct 2026.

Scope: the app publisher and navigation screen (`odds-app/src/lib/routeTracker.ts`, `src/screens/qhpNavigation.tsx`), the server (`hub-track supabase/migrations/20261014120000_route_tracker.sql`: table, `publish_route_position`, broadcast trigger, realtime policies, sweep and retention crons) and the web (`src/hooks/useRouteTracker.ts`, `src/components/ops/leads/RouteTracker*.tsx`, `LeadJourneyStrip.tsx`, `pages/ops/Leads.tsx`). Live checks were read-only.

## Where it stands (live, 20 Oct 2026)
- 0 rides ever published: `route_tracker` is empty.
- 8 of 84 QHP clients in the last 30 days had the location pin that Start navigation needs; all 29 pins on file were captured by a trainer's phone at a session (after the first QHP); the Ops "Add location" paste on the lead row (6 Oct) has never been used.
- 8 of 27 leads at QHP Booked have an owner; readers are the lead owner, QHP managers and admins, so most rides would reach managers and admins only.
- Server guard rails hold: the RPC refuses strangers (`ROUTE_FORBIDDEN`), unknown QHPs (`ROUTE_NO_QHP`) and signed-out callers; the private realtime topics admit admin and refuse an assessor, a doctor and the anonymous key.
- 0 of 86 scheduled QHPs since 20 Sep lack a linked client, so the `ROUTE_NO_CLIENT` path is theoretical today.

## Process decisions (ops, not engineering)
1. **The pin before the ride.** Without a pin there is no navigation and no tracking. Options, combinable: Ops pastes the client's WhatsApp location as a step of the QHP Booked dialog (the "Add location" control already exists on the lead row); the assessor pastes or types the address at Start and the route function geocodes it; the pin on the lead is carried to the client card at conversion.
2. **Who sees rides.** Today: lead owner (by `leads.client_id` link at the moment the ride starts), QHP manager, admin. Most booked leads have no owner. Options: the whole ops role, or every lead owner regardless of the link. One line in `can_read_route` and the lobby policy. Note: "not marketing" is in the docs, but Divya (marketing@) is one of the three assignable lead owners and reads her leads' rides.
3. Whether the encoded ridden route is kept for ever (today) or dropped with the GPS points after 90 days.

## The 4 broken items: the first things to fix if the feature is ever switched on
1. **Android back leaves the ride unsaved and still "live".** `qhpNavigation.tsx` sets no back override, so the phone's back button pops the screen with no Exit confirm: no `ended`, no record, the office sees "on the way" until the sweep marks it stale (10 min) and times it out (3 h after start). Fix: route back through `confirmExit` (the same code the trainer audit reverted on 19 Oct had this).
2. **A stalled final save blocks the end event and traps the assessor.** `finish()` awaits `saveNavigationTrack` before `publisher.ended`; a failed save skips the end. `saveNavigationTrack` queues only when the message matches `/timeout/i`, but `withTimeout` says "timed out", so a stalled connection waits 20 s, throws, shows "Could not save the ride" and repeats on every retry. Fix: send `ended` first, queue on `isTimeoutError`, let the assessor leave while the save retries.
3. **A dropped `start` is never retried and the whole ride then fails quietly.** `start` is fired once with `void`; the publisher swallows every error and stops only on `ROUTE_FORBIDDEN` / `ROUTE_NO_QHP`, so after a lost start every event raises `ROUTE_NOT_STARTED` for the whole ride (one call per 5 s) and the record is lost. Fix: retry start until it lands; treat `ROUTE_NOT_STARTED` as "resend start" and `ROUTE_ENDED` as stop.
4. **An `ended` sent offline is lost for good.** No queue for route events (the outbox only replays the `nav-track` record): one try, one retry after 3 s, then dropped; the office keeps the last checkpoint with no totals until the 3 h timeout. Fix: queue `start` and `ended` through the outbox.

## Other bugs and issues (ranked)
5. Arrived then phone locked: the sweep flips `arrived` to `stale` after 10 min (it covers `status IN ('on_the_way','arrived')`), the chip turns amber, a later fix revives it to `on_the_way`, and the 3 h timeout is keyed on `started_at`, not silence. The web never reads `record.arrived_at`.
6. Lead owner visibility hangs on the `leads.client_id` link at start; a link made later is never picked up. See decision 2.
7. The chip never re-renders when the rider goes quiet (store only changes with the lobby data); its own 10 min amber rule never fires; 10 min is too long against a 5 s cadence anyway.
8. Exit after arrival records `ended_by: 'ended'` with no `arrived_at` (`confirmExit` always calls `finish('ended')`).
9. The publisher is created after the route fetch (up to 15 s): late toast, early fixes unpublished, no `arrived` when starting inside the 60 m geofence.
10. Moving / standing decided from raw GPS speed only (null or iOS -1 means the 30 s cadence while riding); heading starts at 0 and never falls back to the compass, so the office arrow points north at stops.
11. Web trail reset: `liveTrail.current = base` on every row change, so live fixes between checkpoints are not accumulated.
12. Points: never capped in memory, `capPoints` yields 3n/4 so the 4000 cap is exceeded after about two hours; no server size check; later payloads can overwrite server-set `assessor_name`, `client_name`, `pin`.
13. Failed exit: the map `stop` (wake lock release) is sent before the save; a failed save returns to navigating with the arrival flag still set (second `arrived` + haptic possible); back during the saving spinner pops two screens (`finish` is not guarded against unmount).
14. Realtime: both subscriptions had no status callback (a refused join retried every 10 s silently); a ride starting during a socket drop never toasts (no replay). The dormant change of 20 Oct adds the status callback on the lobby.
15. Every `start` resets the row (`started_at`, `points` NULL, `record` replaced) and re-toasts: several alerts per QHP on a restart.
16. The sharing line is static ("Sharing your position with the Odds office while this screen is open") even when stopped, forbidden, offline or timed out; on QHP rides its two lines push the sheet over the Re-centre pill at 360 dp.
17. Up to about 39 s of spinner at the door on a bad connection (20 s save + 8 + 3 + 8 s end and retry), Exit disabled, no text.
18. Web dialog and chip: phone dialog cannot scroll (the route dialog's `overflow-hidden` drops the base `overflow-y-auto` through tailwind-merge; 52vh map plus header, stats and footer exceeds the cap); empty stat tiles collapse; chip's Track button clipped in narrow journey cells; marker teleports every 5 s; title stays "on the way" next to an Arrived / Ride ended badge; toast body says "Click here" but only the button works; "No signal since 12 minutes ago".
19. Rules: Started / Last update / Ride ended use the browser zone (rest of the page pins IST); a PC clock 10 min behind shows a live ride as "No signal"; em dashes in the minutes placeholder, the timed-out alert and the roster distance sheet; `invokeWithToken` calls `getSession()` twice outside the timeout wrapper.
20. Docs drifted from the code: `ROUTE_NO_CLIENT` undocumented; the handoff promised a foreground retry that was never built; the web doc's chip key (`baseline.id ?? scheduled.id`) versus the code (`baseline?.id`); "not marketing".

## Missing pieces (ranked by value)
- A. The pin before the ride (decision 1). Medium, web + app + server.
- B. Rides visible to the people who need them (decision 2). Small, server.
- C. The ride closes itself: silence after arrival ends as arrived; a completed, cancelled or reassigned QHP ends the ride; timeout on silence. Small, server.
- D. Paused state on background plus a 2 minute "no signal" with a chip tick. Small, app + web.
- E. Rides in progress strip on Leads, the chip on the phone layout, a QHP Manager live view. Small, web (the host already holds every active ride).
- F. Late versus the QHP slot; phone push to the owner and manager at start, late, arrived. Small to medium, web + server.
- G. Arrival notice and sound, auto-close, contacts (assessor, client, maps link), end summary (arrival gap, late by). Small, web.
- H. Route and ETA refreshed after a reroute (planned route on checkpoints, ETA source flag). Small, app + web.
- I. Resume after an app restart (a local copy is written every few points and never read). Medium, app.
- J. Office to assessor: cancel, reschedule, ping. Medium, app + server + web.
- K. Ride history and replay (one row per QHP is overwritten by every start). Medium, server + web + app.
- L. Battery and signal in the live payload. Small, app + web.
- M. Background location release (bounded to the ride, persistent notification, disclosure screen; Play review about three weeks). Large.
- N. Client tracking link. Large.
- O. Arrival proof (photo or OTP). Medium.

## The build proposal that was NOT started
- Phase 1, about 2 days: items 1 to 4, 8 to 14, 16, 17; server: silence after arrival ends as arrived, timeout on silence, no re-alert on a quick restart; web: trail accumulation, chip tick and 2 min amber, realtime status, IST times.
- Phase 2, about 3 days: A, B, D, E, F (flag), G, H, dialog fixes.
- Phase 3, separate releases: M, pushes, I, J, K, L, N, O.

## Idle cost (checked 20 Oct 2026)
- Crons: `route-tracker-sweep` every 5 min runs two indexed UPDATEs on an empty table; `route-tracker-retention` weekly. Negligible; left as they are.
- Leads page host (Ops page only; the sales CRM read-only page never mounts it): was one query per minute per viewer plus one private channel join per viewer, and for viewers the lobby policy refuses a silent rejoin every 10 s. Now: one query every 5 minutes and no channel while no ride exists; the channel opens when the poll sees a ride and closes when none remain; a refused join is removed, not retried. When the feature is switched on, restore the always-on lobby (`IDLE_POLL_MS` 60 s, drop the `awake` gate in `useRouteTrackerLobby`) so the toast is instant.

## Device test (first ever), when it is switched on
An admin schedules a QHP for Sagar (`sagaroddsfitness@gmail.com`, an assessor) with a client who has a pin; the Leads page open as an admin or QHP manager; phone: QHP, Upcoming, Start navigation, Start; expect the row `on_the_way` within a second and the toast; positions every 5 s (30 s standing); points after 60 s; lock 3 min; Arrived; Exit. Negative: back mid-ride asks to exit (after fix 1); a Today's Roster ride writes no row.
