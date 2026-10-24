# iOS handoff: assessor navigation and the live route tracker, end to end (state on 23 Oct 2026)

For the iOS Expo repo (separate Claude session). Self-contained: what the feature is, every server contract, how
the Android app does it screen by screen, which files to copy byte for byte, which files to edit, the iOS-only
settings, and how to verify. It supersedes `ios-route-tracker-background-handoff.md` (21 Oct) and the navigation
part of `ios-remaining-features-8-to-20-handoff.md`. Feature docs: `b2b/docs/features/android/trainer/qhp-navigation.md`
(the screen), `b2b/docs/features/android/trainer/route-tracker.md` (the office feed), `b2b/docs/features/web/ops/route-tracker.md`
(the Leads page side). Android commits (product-knack/project-b2b): 14 Oct "QHP navigation", 14 Oct "Route tracker:
publish the QHP ride ... (foreground only)", 21 Oct "QHP navigation: pinch zoom no longer snaps back; Zoom in / Zoom
out buttons" (15a7c4b), 21 Oct "Route tracker live release: ride GPS in a foreground service, publisher retries and
queued end, Android back through Exit" (1745280). Copy rule: no dashes, "client" and "pin", times as 3:48 PM,
"the Odds office".

## 0. Where iOS stands today (live data, 23 Oct 2026)
- The iPhone app already has the navigation screen and saves the ride onto the QHP row: Dr Divya's rides of 6 Oct
  and 21 Oct carry `navigation_track.source = 'ios', app_version '5.1'`.
- The iPhone app publishes to the office with the 14 Oct publisher: foreground only, one try per event, a failed
  `start` is dropped and every later event then fails silently. Live consequence on 23 Oct: a test ride by Divya
  from the iPhone produced no `route_tracker` row and no track on the 4:00 PM QHP. The 21 Oct publisher below fixes
  that (start retried with a backoff, nothing sent before the row exists, the end event queued offline).
- The iPhone app has no background location for the ride: the office feed stops when the phone locks.
- The 21 Oct zoom fix (pinch no longer snaps back, Zoom in / Zoom out buttons) is in the map page and the screen.

## 1. The feature in one page
1. **Start navigation** on an upcoming QHP card (assessor's QHP page) or on a Today's Roster card's distance sheet
   opens a full-screen Google-Maps-style map to the client's home pin: heading-up 3D camera, blue planned line that
   turns grey behind the rider, the Odds bike marker, a teal turn banner with the next manoeuvre and distance,
   spoken turns, a bottom sheet with minutes left, km and the arrival clock, Exit and Arrived.
2. The route and its turn-by-turn steps come from the deployed edge function `roster-distance` in navigate mode
   (Google Routes with the server key, OSRM fallback); refreshed at Start, every 75 s, and at once when off route.
3. A **QHP ride** (the card carries `assessmentId`) is recorded: a partial save every 60 s and a final save at
   Arrived / Exit into `coach_assessment.navigation_track`; offline the final save waits in the outbox (`nav-track`).
   A **roster ride** (`kind 'session'`) is never stored and never shared.
4. A QHP ride is also **shared live with the office** through the RPC `publish_route_position`: `start`, throttled
   `position` fixes, a `checkpoint` every 60 s, `arrived` at the geofence, `ended` at Exit / Arrived. The Leads page
   shows a toast, an "Assessor rides" panel, a chip on the lead and a popup with the live dot, the route, the ETA and
   the trail. The app only publishes; it never reads the tracker.
5. With the **screen locked** the GPS keeps coming from a background location task started at the Start tap, so the
   turns, the voice, the recording and the office feed keep running until Arrived / Exit.

## 2. Server contracts (all live on project agtjszjedaenclbzgjvi; nothing to port)

| Call | Body / arguments | Returns | Notes |
|---|---|---|---|
| edge `roster-distance` | `{ client_id, assessment_id?, origin: {lat, lng}, mode: 'navigate' }` with the user's token | `{ ok, distanceKm, durationMin, traffic, approx, polyline, steps[], clientLat, clientLng, clientName, clientAddress, clientPhone }` | `steps[] = { maneuver (Google enum: TURN_LEFT, ROUNDABOUT_LEFT, DEPART ...), instruction (may be two lines: the manoeuvre, then a landmark), distanceMeters, polyline }`. `assessment_id` only on the QHP path (assessor check); the roster path is authorized by the trainer's own clients / slots. Failure never blocks: the screen falls back to a straight-line local estimate. |
| `coach_assessment.navigation_track` update | the assessor's own row (existing update policy) | | json: `version 1, started_at, ended_at, arrived_at, ended_by ('arrived' \| 'ended'), distance_km, duration_min, avg_kmh, arrival_gap_m, planned_km, planned_min, planned_polyline, points [[t_s, lat, lng, acc_m, speed_mps]], polyline, pin {lat, lng, captured_at, method}, source ('ios'), app_version`. Partial every 60 s (`ended_at` null), final at Arrived / Exit. |
| `publish_route_position(p_assessment_id, p_event, p_live, p_record, p_points)` | event `start` \| `position` \| `checkpoint` \| `arrived` \| `ended` | `{status, started_at, ended_at, updated_at}`; `{status, ignored: true}` when `p_live.fix_at` is older than the stored fix; `{..., merged: true}` for `ended` on an ended row | errors start with `ROUTE_`: `ROUTE_FORBIDDEN` (not the assessor), `ROUTE_NO_QHP`, `ROUTE_NO_CLIENT`, `ROUTE_NOT_STARTED` (no row), `ROUTE_ENDED` (live event on an ended row), `ROUTE_BAD_EVENT`, `ROUTE_BAD_POINTS` (over 6000). One `route_tracker` row per QHP. A `start` within 15 minutes of a live row continues it (same `started_at`, points kept); the sweep ends arrived rides after 10 silent minutes, flags silent rides stale after 10 minutes, times them out after 3 silent hours, ends rides of completed or cancelled QHPs. |

Events the app sends:

| event | when | p_record | p_points |
|---|---|---|---|
| `start` | in `start()` right after the phase flips to navigating, before the route fetch; retried 3 s, 6 s, 12 s, 24 s, then every 30 s until answered | `{planned_km, planned_min, planned_polyline (null when the preview had no route yet), pin, source: 'ios', app_version}` | null |
| `position` | every fix while navigating or arrived, only once the row exists; 5 s apart while moving (speed over 0.8 m/s), 30 s while still | null | null |
| `checkpoint` | from the 60 s partial save | `{polyline, planned_km, planned_min, planned_polyline}` (the planned line as drawn now, so a reroute reaches the office) | the thinned points |
| `arrived` | the arrival geofence (60 m, or the GPS accuracy capped at 150 m) | `{distance_km_total, duration_min, avg_kmh, arrival_gap_m, polyline}` | the points |
| `ended` | `finish()`: Exit, or Arrived; Exit after the pin was reached says `arrived` | the same plus `ended_by: 'arrived' \| 'ended'` | the points |

`p_live` on every event: `{lat, lng, heading, speed_mps, accuracy_m, eta_min, distance_km, fix_at}`; `eta_min` and
`distance_km` are the sheet's own numbers; `heading` is the GPS course while moving, else the compass.

## 3. Files to copy byte for byte from the Android repo
Pure (no native imports; node-tested):
- `src/lib/qhpNavigation.ts` (433 lines): geometry, route projection, off-route and arrival tests, GPS thinning, the track json,
  the stale-pin rule, turn-by-turn (`nextManeuver`, `maneuverKind`, `streetOf`, `prepOf`, `fmtStepDistance`,
  `voiceCue`, `maneuverPhrase`), `encodePolyline` / `decodePolyline`.
- `src/lib/routeTracker.ts` (239 lines): `RoutePublisher` (`start`, `position`, `checkpoint`, `arrived`, `ended`,
  `ensureStarted`, `destroy`, `isStopped`, `reason`), `liveFromFix`, `summaryOf`, `submitRouteEnded`, the constants
  `POSITION_MOVING_MS 5000`, `POSITION_STILL_MS 30000`, `MOVING_MPS 0.8`, `RPC_TIMEOUT_MS 8000`, `START_RETRY_MS 3000`,
  `START_RETRY_MAX_MS 30000`. Needs the iOS copies of `./supabase`, `./withTimeout`, `./offline`
  (`enqueueOutbox`, `getIsOnline`).
- `src/lib/navMapHtml.ts` (232 lines): the map page for the WebView (MapLibre GL 4.7.1 from jsDelivr, OpenFreeMap
  "liberty" style, the route layers, the bike marker, the pitched heading-up camera, the finger-aware follow loop
  of 21 Oct, the wake lock). It is one TS template literal: never put a backtick inside the page's script.
- `tests/rules/route_tracker_test.js` (186 lines, 51 checks), `tests/rules/qhp_navigation_test.js` (87 lines, 49),
  `tests/rules/qhp_turns_test.js` (100 lines). `ROOT` resolves to the repo root; run each with `node`.

React Native, copy as they are:
- `src/lib/rideLocationTask.ts` (74 lines): `RIDE_LOCATION_TASK = 'odds-ride-location'`, `TaskManager.defineTask` at
  module scope, `setRideFixListener(fn)`, `startRideService(clientName, shared)` returning `'service' | 'screen'`,
  `stopRideService()`, the notification texts (Android only; ignored on iOS). The call uses
  `activityType: AutomotiveNavigation`, `pausesUpdatesAutomatically: false`, `showsBackgroundLocationIndicator: true`,
  which iOS honours; the `foregroundService` option is ignored there.
- `src/lib/qhpNavigationQueries.ts` (115 lines): `navTargetRef` (the handoff the card writes before `go('qhp-navigate')`),
  `fetchNavRoute` (the function call incl. `steps`), `saveNavigationTrack` (the row update, outbox on a network error
  or a timeout: `isTimeoutError(e) || /network request failed|network error|failed to fetch|fetch failed|timeout|timed out|abort|socket|ENOTFOUND|ECONN/i`),
  `submitNavigationTrack` (the outbox replay).
- `src/screens/qhpNavigation.tsx` (652 lines): the screen. Imports `../lib/useSpeech` (expo-speech, en-IN), the
  WebView, `expo-location`, `expo-haptics`, `../gestureLock` (`backOverride`; iOS has no hardware back, the effect is
  harmless), `../lib/offline` (`useIsOnline`). If the iOS repo already has an older copy, replace it whole: the 21 Oct
  version holds the zoom fix and every publisher hook (section 5).

## 4. Edits in the iOS repo
- `index.ts`: `import './src/lib/rideLocationTask';` right after the gesture-handler import, so the task exists at
  module scope before any start.
- `src/lib/offline.ts`: the kind union gains `'nav-track'` (if missing) and `'route-ended'`; `processItem` replays
  `nav-track` through `submitNavigationTrack(item.payload)` and `route-ended` through a lazy
  `require('./routeTracker').submitRouteEnded(item.payload)` (`ended`, or `start` then `ended` when the row never
  existed); `uiVisible` hides both kinds from Waiting to Sync.
- `src/Router.tsx`: route `qhp-navigate` → the screen, full-bleed (no header, no launcher, no swipe back), in
  `SENSITIVE_ROUTES` (health data on screen).
- The two entry points write `navTargetRef.current` then `go('qhp-navigate')`:
  - QHP page, Upcoming card, **Start navigation** (only when the row has `client_id`, `home_lat`, `home_lng` from
    `clients.brb_location`): `{ kind: 'qhp', assessmentId: q.id, scheduleId: null, clientId, clientName, address: q.location || q.lead_address, phone, lat, lng, pinCapturedAt: q.home_captured_at, pinMethod: q.home_method }`.
  - Today's Roster distance sheet, **Start navigation** (trainer and doctor rosters): `{ kind: 'session', assessmentId: null, scheduleId: row.id, clientId, clientName, address, phone, lat, lng, pinCapturedAt: null, pinMethod: null }`. "Open in Google Maps instead" stays as a text link.
- `app.json` > plugins > `expo-location`: `"isIosBackgroundLocationEnabled": true` (prebuild adds `location` to
  `UIBackgroundModes`). Keep the When In Use string; do NOT add an "Always" string: `startLocationUpdatesAsync` keeps
  delivering in the background with When In Use once the background mode exists and the updates were started in the
  foreground (Apple's rule). `npx expo install expo-task-manager` (SDK 57: `~57.0.21`); `expo-location ~57.0.15`,
  `react-native-webview 13.16.1`, `expo-speech ~57.0.3`, `expo-haptics ~57.0.2` as on Android.
- App Store review note: "During a home assessment ride the app shares the assessor's position with the office from
  Start to Arrived or Exit. Location updates run only for that ride and stop when the ride ends; no 'Always'
  permission is requested."

## 5. The screen, piece by piece (what the Android file does; check each in the iOS copy)
- **GPS before Start**: `watchPositionAsync` at best-for-navigation accuracy, a fix every second, `distanceInterval 0`;
  the last fix is replayed when the map page loads and when a route lands. `watchHeadingAsync` gives the compass
  (true, else magnetic; at most 10 updates a second, on a 1-degree change).
- **`start()`** in order: phase → navigating; for a QHP ride `publisher.current = new RoutePublisher(assessmentId)`
  and `publisher.start(liveFromFix(lastFix, etaNow, liveHeading()), { ...plannedOf(routeRef.current), pin, source: 'ios', app_version })`
  BEFORE the route fetch; then `const svc = await startRideService(firstName, savesRide(target))`; on `'service'`
  `setRideFixListener((locs) => { for (const p of locs) onFixRef.current(toFix(p)); })` and drop the screen watch;
  `setShare(svc)`; then the route fetch as before (`savesRide(t) = t.kind === 'qhp' && !!t.assessmentId`).
- **Every fix** goes through one handler (`onFixRef.current = onFix`): record the point (kept when it moved 8 m or
  10 s passed, at most 4000, older half thinned), project onto the planned line for LEFT / TIME / ARRIVE, feed the
  map page, speak the cues (once under 400 m, once under 70 m, "Rerouting." when off route, "You have arrived at
  your destination." once), then `publisher.position(liveFromFix(f, etaNow, liveHeading()))`; at the geofence
  `publisher.arrived(liveFromFix(f, {etaMin: 0, distanceKm: 0}, liveHeading()), track)`.
- **`partialSave()`** every 60 s: `saveNavigationTrack(assessmentId, track)` (partial) and
  `publisher.checkpoint(liveFromFix(...), t.points, t.polyline, plannedOf(routeRef.current))`.
- **`finish(endedBy)`** (Exit, Arrived): `setRideFixListener(null); void stopRideService();` then
  `const endedP = publisher.ended(liveFromFix(...), track)` started BEFORE the final `saveNavigationTrack(..., {final: true})`
  and awaited after it (also in the catch), then `publisher.destroy()`; the device copy
  `AsyncStorage 'qhp-nav-track:<assessmentId>'` is removed after the final save. `confirmExit()`:
  `endedBy = reached || phase === 'arrived' ? 'arrived' : 'ended'`; the prompt reads "Exit navigation? The ride so far
  is saved with the QHP." (roster ride: "You can start again from the roster card.").
- **Unmount**: remove the watch and the heading sub, `setRideFixListener(null)`, `void stopRideService()`,
  `publisher.current?.destroy()`.
- **`liveHeading()`** = the GPS course while moving (over 2 m/s), else the compass.
- **The sharing line** on the sheet during a QHP ride (five states): "Sharing your ride with the Odds office, also
  with the screen locked, until you tap Arrived or Exit." (`share === 'service'`); "Sharing your position with the
  Odds office while this screen is open." (`'screen'`); amber "Offline. The office keeps your last position until the
  connection is back." (`!online`); amber "The office closed this ride. Your route and record are still saved."
  (`publisher.reason === 'ended'`); amber "This ride is not shared with the office." (`ROUTE_FORBIDDEN` / `ROUTE_NO_QHP`).
- **Zoom (21 Oct)**: Zoom in / Zoom out round buttons (12 to 19, kept by the follow camera); a pinch or a double tap
  is adopted into the follow zoom at `zoomend`; while any finger is on the map the follow camera stays still (the page
  counts fingers with DOM `touchstart` / `touchend` / `touchcancel`); a one-finger drag, tilt or rotate pauses
  following and shows the Re-centre pill; Start resets to zoom 17.
- **Status pill** states: "Rerouting…", "Route service unreachable, last route 3 min ago. Estimates only." (amber),
  "Location is off for Odds. Allow it in the phone settings." (red), "The map could not load. The turns and numbers
  still work." (amber). Stale pin (older than 90 days or pasted): a note before Start, the pin amber, never blocked.

## 6. Publisher rules (why a ride cannot stall; all in `routeTracker.ts`, unit-tested)
- Nothing before the row exists: `position` is a no-op until `start` is answered (the freshest fix is kept for the
  start record); `checkpoint` and `arrived` wait for it. A lost start is retried with the backoff while the ride runs.
- Throttle: 5 s moving, 30 s still; `start`, `checkpoint` and `arrived` reset the clock. The server also ignores a
  fix older than the one it holds.
- Stop codes: `ROUTE_FORBIDDEN` / `ROUTE_NO_QHP` stop the publisher for the ride and the end event is dropped;
  `ROUTE_ENDED` stops the live events only, `ended` still lands (merged); `ROUTE_NOT_STARTED` on a later event resends
  `start`.
- The end event: one try when online (8 s), else straight to the outbox; a failed try is queued too. It runs beside
  the record save, never after it, so a failed record save ("Could not save the ride") still lets the office get the end.
- Every live failure is dropped; `__DEV__` logs the event name, production is silent.

## 7. Verify on an iPhone
Pick a QHP for the signed-in assessor whose client has a pin (an admin schedules one; Vashist Dev
`0eecb1ab-6894-4b0d-8779-51920bfbd6b6` has a pin from 19 Jul 2026).
1. QHP page > Upcoming > Start navigation > Start: the blue location indicator appears in the status bar; within a
   second `select status, record->>'source', record->>'app_version', started_at from route_tracker order by updated_at desc limit 1`
   shows a `live` row with `ios`; the office's Leads page toasts and the Assessor rides panel counts 1.
2. Ride: `updated_at` moves every ~5 s; **lock the phone 3 minutes**: it keeps moving; after 60 s `points` and
   `record.polyline` fill.
3. Airplane mode: the sheet line turns amber; back online the dot catches up.
4. Arrived: `arrived` + `record.arrived_at`; Exit: `ended`, `ended_by 'arrived'`; the indicator disappears;
   `coach_assessment.navigation_track` has the final json with `source 'ios'`.
5. Exit in airplane mode: the record and the end event sync later (`nav-track` and `route-ended` outbox items, both
   hidden from Waiting to Sync).
6. A roster ride (Today's Roster > distance sheet > Start navigation): the map and turns work, no `route_tracker` row.
7. Pinch to zoom while riding: the map holds the new zoom and keeps following; Zoom in / Zoom out step one level.
8. `node tests/rules/route_tracker_test.js` (51), `node tests/rules/qhp_navigation_test.js` (49), `node tests/rules/qhp_turns_test.js`.

## 8. Known gaps, both platforms
- The usual trainer line, the Leads page panel and the sweep are server and web, nothing to port.
- Background location on iOS needs the background mode in the build (a new native build), not only the JS.
- Deleting a `route_tracker` row while a ride is live makes the next event answer `ROUTE_NOT_STARTED`; the 21 Oct
  publisher resends `start` and the row comes back; the 14 Oct publisher does not.
