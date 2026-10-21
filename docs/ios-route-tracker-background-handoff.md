# iOS handoff: route tracker with the screen locked (21 Oct 2026)

For the iOS Expo repo (separate Claude session). The Android app (`product-knack/project-b2b`, commit after 15a7c4b of 21 Oct 2026) now keeps the assessor's ride feed running with the phone locked, and the office side changed with it. The iOS app already publishes rides (a `route_tracker` row with `record.source = 'ios'`, `app_version '5.1'` was seen live on 21 Oct 2026 at 1:14 PM IST), but only while the navigation screen is in front. Port the items below in this order; every file named "byte for byte" is a pure TypeScript module with no platform branch.

## 1. Install
- `npx expo install expo-task-manager` (SDK 57: `~57.0.21`).
- `app.json` > plugins > `expo-location`: `"isIosBackgroundLocationEnabled": true` (prebuild adds `location` to `UIBackgroundModes`). Keep `NSLocationWhenInUseUsageDescription`; do NOT add an "Always" string: `startLocationUpdatesAsync` keeps delivering in the background with When In Use once the background mode exists and the updates were started in the foreground (Apple's rule). `showsBackgroundLocationIndicator: true` shows the blue status pill while the ride runs, which is what Apple expects.
- App Store review notes: "During a home assessment ride the app shares the assessor's position with the office from Start to Arrived or Exit. Location updates run only for that ride and stop when the ride ends; no 'Always' permission is requested."

## 2. Files, byte for byte
- `src/lib/rideLocationTask.ts` (new): the task definition, `startRideService(clientName, shared)`, `stopRideService()`, `setRideFixListener(fn)`. The Android-only options (`foregroundService`) are ignored on iOS; `activityType: AutomotiveNavigation`, `pausesUpdatesAutomatically: false`, `showsBackgroundLocationIndicator: true` apply. The header comment explains the permission model for both platforms.
- `src/lib/routeTracker.ts` (replace): `RoutePublisher` with `ensureStarted` (start retried 3 s, 6 s, 12 s, 24 s, then every 30 s), `position` a no-op before the row exists, `ROUTE_NOT_STARTED` resends start, `ROUTE_FORBIDDEN` / `ROUTE_NO_QHP` stop for good, `ROUTE_ENDED` stops live events but `ended` still lands, `ended()` one try online else the outbox, `destroy()`, `submitRouteEnded(payload)` for the outbox replay, `RoutePlanned` / `RouteStartRecord` types. `source` stays `Platform.OS === 'ios' ? 'ios' : 'android'`.
- `tests/rules/route_tracker_test.js` (new, 51 checks) with its `ROOT` resolution; run `node tests/rules/route_tracker_test.js`.

## 3. Small edits
- `index.ts`: `import './src/lib/rideLocationTask';` right after the gesture-handler import (the task must exist at module scope before any start).
- `src/lib/offline.ts`: the kind union gains `'route-ended'`; `processItem` gets the branch that lazy-requires `./routeTracker` and awaits `submitRouteEnded(item.payload)`; `uiVisible` hides `route-ended` like `nav-track`.
- `src/lib/qhpNavigationQueries.ts` `saveNavigationTrack`: import `isTimeoutError` from `./withTimeout`; the queue rule becomes `isTimeoutError(e) || /network request failed|network error|failed to fetch|fetch failed|timeout|timed out|abort|socket|ENOTFOUND|ECONN/i.test(...)`.

## 4. `src/screens/qhpNavigation.tsx` (apply the same edits as Android, commit "Route tracker live release" of 21 Oct 2026)
1. Imports: `type RoutePlanned` from `../lib/routeTracker`; `startRideService, stopRideService, setRideFixListener, type RideServiceState` from `../lib/rideLocationTask`; `useIsOnline` from `../lib/offline`; `backOverride` from `../gestureLock` (iOS has no hardware back; keep the effect anyway, it is harmless and the Router's swipe uses it).
2. Module scope: `toFix(p: Location.LocationObject): Fix` and `plannedOf(r: RouteInfo | null): RoutePlanned`.
3. State: `share` (`RideServiceState | null`), `online = useIsOnline()`, `watchRef`, `onFixRef`; after `onFix` is defined, `onFixRef.current = onFix;`.
4. The GPS effect: the watch callback calls `onFixRef.current(toFix(p))`, the subscription is stored in `watchRef`; the cleanup removes the watch and the heading sub, calls `setRideFixListener(null)`, `void stopRideService()`, `publisher.current?.destroy()`.
5. `liveHeading()` = the GPS course while moving, else the compass; used for every `liveFromFix` the publisher gets.
6. `start()`: the publisher is created and `start` sent BEFORE the route fetch with `plannedOf(routeRef.current)`; then `const svc = await startRideService(firstName, savesRide(target))`; on `'service'` register the listener (`for (const p of locs) onFixRef.current(toFix(p))`) and drop the watch; `setShare(svc)`; then the route fetch as before.
7. `partialSave()`: the checkpoint call passes `plannedOf(routeRef.current)` as the fourth argument.
8. `finish()`: `setRideFixListener(null); void stopRideService();` then `endedP = publisher.ended(...)` is started BEFORE the `navigation_track` save and awaited after it (also in the catch); `publisher.current?.destroy()` before nulling.
9. `confirmExit()`: `endedBy = reached || phase === 'arrived' ? 'arrived' : 'ended'`.
10. The sharing line (five states): service / screen / offline (amber) / `reason === 'ended'` (amber) / stopped (amber). Copy in `docs/features/android/trainer/route-tracker.md` section 3.

## 5. Verify on an iPhone
Start a QHP ride: the blue location pill appears; lock the phone 3 minutes: the Leads page dot keeps moving (ask the office, or `select updated_at from route_tracker order by updated_at desc limit 1` keeps changing); Exit: the pill disappears, `ended_by` is set. Airplane mode at Exit: the record syncs later (`route-ended` outbox item, hidden from Waiting to Sync).

## 6. Server and web (already done, nothing to port)
Migration `20261021120000_route_tracker_live_release.sql` (ops may read, `ended` merges into an ended row, a start within 15 min continues the ride, the sweep closes arrived / silent / completed rides) and the Leads page "Assessor rides" panel are in hub-track.
