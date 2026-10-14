# Route tracker: Android handoff (foreground-only release, 2026-10-14)

Backend is live on project `agtjszjedaenclbzgjvi` once migration
`20261014120000_route_tracker.sql` has run (hub-track). Web side (Leads page alert,
journey chip, tracking popup) is built in hub-track. Canonical doc:
`C:\Users\ADMIN\Desktop\b2b\docs\features\web\ops\route-tracker.md`.

This release shares the assessor's position **only while the navigation screen is
open**. Background sharing (locked phone, other app) is a separate release that
needs Play and App Store review; nothing in this handoff touches permissions,
`app.json` or the foreground service.

## What exists on the server

| Object | Purpose |
|---|---|
| `route_tracker` | One row per QHP: live position while riding (`lat`, `lng`, `updated_at`, `live` json) and the ride record after (`record` json, `points` json). `status` on_the_way / arrived / ended / stale. Readable by the lead owner, QHP managers, admins and the assessor (own row). **Nobody writes it directly.** |
| `publish_route_position(p_assessment_id uuid, p_event text, p_live jsonb, p_record jsonb, p_points jsonb) -> jsonb` | The only write path. Checks `coach_assessment.coach_id = auth.uid()`. Returns `{status, started_at, ended_at, updated_at}` or `{status, ignored: true, ...}` for a fix older than the stored one. Errors start with `ROUTE_` (`ROUTE_FORBIDDEN`, `ROUTE_NOT_STARTED`, `ROUTE_ENDED`, `ROUTE_NO_QHP`, `ROUTE_BAD_EVENT`). |
| Broadcast trigger | Every write broadcasts a small payload to the web over Supabase Realtime (`realtime.send`). The app does not subscribe to anything. |
| Sweep (cron, every 5 min) | `stale` after 10 min without a write; `ended` with `ended_by: timeout` 3 h after start. A `position` after `stale` brings the row back to on_the_way automatically. |

### Events and payloads

`p_live` (every event may carry it; lat/lng become columns, the rest is stored as `live`):
```json
{ "lat": 28.5607, "lng": 77.2109, "heading": 112, "speed_mps": 6.1, "accuracy_m": 9,
  "eta_min": 14, "distance_km": 5.3, "fix_at": "2026-10-14T06:12:31.000Z" }
```
`fix_at` = the GPS fix timestamp (ISO). The server ignores a position whose `fix_at` is older than the stored one.

| event | when | p_live | p_record | p_points |
|---|---|---|---|---|
| `start` | the Start button, after the first fix | first fix | `{planned_km, planned_min, planned_polyline, pin {lat,lng,captured_at,method}, source, app_version}` | null |
| `position` | every 5 s while moving (speed > 0.8 m/s), every 30 s while still | latest fix | null | null |
| `checkpoint` | every 60 s (the same cadence as today's partial write) | latest fix | `{ polyline }` (the ridden track so far, Google encoded) | the thinned points array `[[t_s, lat, lng, acc_m, speed_mps], ...]` (max 4000, same thinning as today) |
| `arrived` | the Arrived button | latest fix | `{distance_km_total, duration_min, avg_kmh, arrival_gap_m, polyline}` | final points |
| `ended` | Exit, or Arrived followed by leaving the screen | latest fix | `{distance_km_total, duration_min, avg_kmh, arrival_gap_m, polyline, ended_by: "ended" or "arrived"}` | final points |

The server adds `assessor_name`, `client_name` (at start), `arrived_at` (on arrived) and `ended_by` (default on ended) to `record` itself.

## App work (`src/screens/qhpNavigation.tsx`, `src/lib/qhpNavigationQueries.ts`)

1. **New module `src/lib/routeTracker.ts`**: `publishRoute(assessmentId, event, live, record?, points?)` calling the RPC through `withTimeout` (standing rule, 8 s), swallowing errors except `ROUTE_FORBIDDEN` / `ROUTE_NO_QHP` (log once, stop publishing for this ride). A `RoutePublisher` class with `start(fix, planned)`, `fix(fix, eta)`, `checkpoint(fix, points, polyline)`, `arrived(fix, summary)`, `ended(fix, summary)`; it keeps `lastSentAt`, throttles `position` to 5 s moving / 30 s still, and never queues: a failed `position` is dropped, a failed `checkpoint` is retried at the next checkpoint, a failed `arrived`/`ended` is retried once after 3 s and then once more on the next app foreground (AsyncStorage key `route-final:<assessmentId>`), because the final record matters.
2. **Start** (the Start button handler, after the first fix is known): `publisher.start(firstFix, { planned_km, planned_min, planned_polyline, pin, source: Platform.OS, app_version })`. Keep the existing `coach_assessment.navigation_track` partial write exactly as it is for this release; it is dropped in the next migration.
3. **Fixes** (the `watchPositionAsync` callback, line ~160): call `publisher.fix(fix, { eta_min, distance_km })` with the current ETA and remaining distance the screen already computes; the publisher applies the throttle. Heading from the GPS while moving, else the bearing between fixes (as the map already does).
4. **60-second checkpoint**: where the partial track write runs today, also call `publisher.checkpoint(fix, thinnedPoints, encodedTrack)`.
5. **Arrived / Exit**: `publisher.arrived(...)` / `publisher.ended(...)` with the same summary numbers the final `navigation_track` write builds.
6. **Status line** on the ride sheet, under the numbers: "Sharing your position with the Odds office while this screen is open" (grey, 11 px). No toggle in this release; Exit stops it.
7. Roster rides (`NavTarget.kind 'session'`) do NOT publish: the RPC needs a QHP (`ROUTE_NO_QHP`). Guard on `target.kind === 'qhp'`.
8. Types: hand-add `route_tracker` and `publish_route_position` to the app's Supabase types where other hand-added entries live.

## Verify
- Start a QHP ride on a dev build; in the SQL editor: `select status, lat, lng, live, updated_at, started_at from route_tracker order by updated_at desc limit 1;` updates every ~5 s while moving.
- After 60 s: `select jsonb_array_length(points), length(record->>'polyline') from route_tracker where assessment_id = '<id>';` grows.
- Tap Arrived: `status = 'arrived'`, `record->>'arrived_at'` set. Exit: `status = 'ended'`, `ended_at` set, `record->>'ended_by' = 'arrived'`.
- Lock the phone for 11 minutes mid-ride, unlock: the row goes `stale` then back to `on_the_way` on the next fix (expected in this release).
- Web: with the Leads page open as the lead's owner or a QHP manager, the toast appears at Start and the popup follows the dot.

## Docs (mandatory)
Create `C:\Users\ADMIN\Desktop\b2b\docs\features\android\trainer\route-tracker.md` from `_template.md` (events table above, throttle rule, retry rule for the final event, the roster guard) and add its index line; add a dated line to the web file's change log.
