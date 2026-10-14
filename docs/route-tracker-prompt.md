# Paste-ready prompt: share the assessor's live position from Start navigation (Android, 2026-10-14)

Paste everything below this line into the odds-app session.

---

Build the route tracker's app side end to end in `C:\Users\ADMIN\Desktop\b2b\odds-app`. Read `docs/route-tracker-handoff.md` first (the server contract); this prompt is the step list with the exact anchors. The backend is LIVE on `agtjszjedaenclbzgjvi`: table `route_tracker`, RPC `publish_route_position`, broadcast trigger, sweep and retention cron (hub-track migration `20261014120000`). The web side (Leads page toast, journey chip, tracking popup) is live too. This is the **foreground-only** release: positions are sent while the navigation screen is open; do NOT touch `app.json`, permissions, foreground services or background location (that is a separate reviewed release). Keep the existing `coach_assessment.navigation_track` writes exactly as they are; a later migration drops that column.

## 0. Contract in one table

`supabase.rpc('publish_route_position', { p_assessment_id, p_event, p_live, p_record, p_points })` → `{ status, started_at, ended_at, updated_at }` or `{ status, ignored: true }`. Only the QHP's assessor (`coach_assessment.coach_id = auth.uid()`). Errors start with `ROUTE_` (`ROUTE_FORBIDDEN`, `ROUTE_NO_QHP`, `ROUTE_NOT_STARTED`, `ROUTE_ENDED`, `ROUTE_BAD_EVENT`).

`p_live` on every event: `{ lat, lng, heading, speed_mps, accuracy_m, eta_min, distance_km, fix_at }` (`fix_at` = ISO of the GPS fix; the server ignores a fix older than the stored one).

| event | when | p_record | p_points |
|---|---|---|---|
| `start` | in `start()` right after `setPhase('navigating')` once `routeAtStart` is known | `{ planned_km, planned_min, planned_polyline, pin, source, app_version }` | null |
| `position` | from the fix handler, throttled: 5 s moving (speed > 0.8 m/s), 30 s still | null | null |
| `checkpoint` | from `partialSave()` (already every 60 s) | `{ polyline }` | `points.current` (already thinned, max 4000) |
| `arrived` | when the screen flips to `arrived` (the geofence) | `{ distance_km_total, duration_min, avg_kmh, arrival_gap_m, polyline }` | points |
| `ended` | in `finish(endedBy)` | same as arrived plus `ended_by` (`'arrived'` or `'ended'`) | points |

The server adds `assessor_name`, `client_name`, `arrived_at` and the default `ended_by` itself.

## 1. New module `src/lib/routeTracker.ts`

```ts
import { Platform } from 'react-native';
import { supabase } from './supabase';
import { withTimeout } from './withTimeout';
import type { Fix, NavigationTrack, TrackPoint } from './qhpNavigation';

export type RouteEvent = 'start' | 'position' | 'checkpoint' | 'arrived' | 'ended';
export const POSITION_MOVING_MS = 5_000;
export const POSITION_STILL_MS = 30_000;
export const MOVING_MPS = 0.8;

export const liveFromFix = (f: Fix, eta: { etaMin: number | null; distanceKm: number | null }, heading: number | null) => ({
  lat: f.lat, lng: f.lng,
  heading: heading ?? f.heading ?? null,
  speed_mps: f.spd ?? null,
  accuracy_m: f.acc ?? null,
  eta_min: eta.etaMin, distance_km: eta.distanceKm,
  fix_at: new Date(f.t).toISOString(),
});

export class RoutePublisher {
  private lastSentAt = 0;
  private stopped = false;            // ROUTE_FORBIDDEN / ROUTE_NO_QHP: stop for this ride
  constructor(private assessmentId: string) {}

  private async call(event: RouteEvent, live: any, record?: any, points?: TrackPoint[] | null) {
    if (this.stopped) return null;
    try {
      const { data, error } = await withTimeout(
        supabase.rpc('publish_route_position', { p_assessment_id: this.assessmentId, p_event: event, p_live: live, p_record: record ?? null, p_points: points ?? null }),
        8_000, 'route tracker');
      if (error) {
        if (/ROUTE_FORBIDDEN|ROUTE_NO_QHP/.test(error.message)) this.stopped = true;
        throw error;
      }
      return data;
    } catch (e) {
      if (__DEV__) console.log('[route-tracker]', event, (e as any)?.message);
      return null;                     // never block the ride
    }
  }

  start(live: any, planned: { planned_km: number | null; planned_min: number | null; planned_polyline: string | null }, pin: NavigationTrack['pin'], appVersion: string | null) {
    this.lastSentAt = Date.now();
    return this.call('start', live, { ...planned, pin, source: Platform.OS === 'ios' ? 'ios' : 'android', app_version: appVersion });
  }
  /** Throttled; call on every fix. */
  position(live: any) {
    const moving = (live.speed_mps ?? 0) > MOVING_MPS;
    const gap = moving ? POSITION_MOVING_MS : POSITION_STILL_MS;
    if (Date.now() - this.lastSentAt < gap) return;
    this.lastSentAt = Date.now();
    void this.call('position', live);
  }
  checkpoint(live: any, points: TrackPoint[], polyline: string) {
    this.lastSentAt = Date.now();
    return this.call('checkpoint', live, { polyline }, points);
  }
  arrived(live: any, t: NavigationTrack) {
    return this.call('arrived', live, summaryOf(t), t.points);
  }
  /** Retried once after 3 s; the final record matters. */
  async ended(live: any, t: NavigationTrack) {
    const rec = { ...summaryOf(t), ended_by: t.ended_by ?? 'ended' };
    const r = await this.call('ended', live, rec, t.points);
    if (r) return r;
    await new Promise((res) => setTimeout(res, 3_000));
    return this.call('ended', live, rec, t.points);
  }
}

const summaryOf = (t: NavigationTrack) => ({
  distance_km_total: t.distance_km, duration_min: t.duration_min, avg_kmh: t.avg_kmh,
  arrival_gap_m: t.arrival_gap_m, polyline: t.polyline,
});
```

Add a short offline test in the repo's existing pattern for `liveFromFix` (lat/lng/fix_at ISO, speed and accuracy pass through) and for the throttle (two calls 1 s apart while moving send once; 31 s apart while still send twice). If `withTimeout` has a different signature in `src/lib/withTimeout.ts`, adapt the call, do not change the helper.

## 2. Wire it into `src/screens/qhpNavigation.tsx`

- Import: `import { RoutePublisher, liveFromFix } from '../lib/routeTracker';` and keep a ref: `const publisher = React.useRef<RoutePublisher | null>(null);`
- **Guard**: publish only when `savesRide(target)` (line 37: `t.kind === 'qhp' && !!t.assessmentId`). Roster rides never publish (the RPC would answer `ROUTE_NO_QHP`).
- **ETA and remaining**: the ride sheet already shows minutes left and km (`est` around line 513). Expose the current numbers as `etaNow.current = { etaMin, distanceKm }` wherever `est` is set (null when estimating fails).
- **start()** (line ~300): after `routeAtStart.current = routeRef.current;` add
  ```ts
  if (savesRide(target)) {
    publisher.current = new RoutePublisher(target.assessmentId!);
    const r = routeAtStart.current;
    void publisher.current.start(
      liveFromFix(fix, etaNow.current, headingRef.current),
      { planned_km: r?.distanceKm ?? null, planned_min: r?.durationMin ?? null, planned_polyline: r?.polyline ?? null },
      { lat: target.lat, lng: target.lng, captured_at: target.pinCapturedAt, method: target.pinMethod },
      appVersionLabel());
  }
  ```
- **Fix handler** (the function that receives each `Fix`, line ~196): inside the `navigating || arrived` branch, after the arrival check, add `publisher.current?.position(liveFromFix(f, etaNow.current, headingRef.current));`
- **Arrival** (same handler, the `setPhase('arrived')` block): after `send({ type: 'arrived' })` add `const t = currentTrack('arrived', Date.now()); if (t) void publisher.current?.arrived(liveFromFix(f, { etaMin: 0, distanceKm: 0 }, headingRef.current), t);`
- **partialSave()** (line ~286): after the `saveNavigationTrack` call add `if (t) void publisher.current?.checkpoint(liveFromFix(prevFix.current ?? fix, etaNow.current, headingRef.current), t.points, t.polyline);` (use whatever name the handler keeps for the latest fix; `prevFix` exists).
- **finish(endedBy)** (line ~333): before `navTargetRef.current = null;` add `if (t && publisher.current) await publisher.current.ended(liveFromFix(prevFix.current ?? fix, etaNow.current, headingRef.current), t); publisher.current = null;`. `ended()` never throws, so the existing try/catch and the Alert stay as they are.
- **Status line** on the ride sheet, under the numbers row (near line 513), only while `navigating` and `savesRide(target)`: `Sharing your position with the Odds office while this screen is open` (`F.body`, 11, `G.muted`, centered). No toggle; Exit stops it.
- Leaving the screen without Arrived or Exit (back gesture while navigating) already asks to exit; nothing extra. If the user kills the app the sweep marks the ride stale after 10 minutes and ended after 3 hours.

## 3. Types

Hand-add `route_tracker` (Row/Insert/Update as in `docs/route-tracker-handoff.md`) and `publish_route_position` (Args `p_assessment_id: string; p_event: string; p_live?: Json | null; p_record?: Json | null; p_points?: Json | null`, Returns `Json`) to the app's Supabase types where other hand-added entries live (`src/lib/supabase.ts` types or the file the repo uses). If the repo calls `rpc` loosely typed, a cast is acceptable.

## 4. Verify (dev build, real ride)

1. Open an upcoming QHP of a lead whose owner has the hub-track Leads page open, tap Start navigation.
2. SQL editor: `select status, lat, lng, live, updated_at, started_at, record->>'planned_km' from route_tracker order by updated_at desc limit 1;` shows `on_the_way` within a second of Start and `updated_at` moving every ~5 s while you ride (30 s while standing).
3. Web: the toast "NAME is going to CLIENT's place" at Start, the blue chip with the ETA on the lead's journey, the dot moving in the popup.
4. After 60 s: `select jsonb_array_length(points), length(record->>'polyline') from route_tracker where status <> 'ended' order by updated_at desc limit 1;` grows at each checkpoint.
5. Lock the phone 11 minutes: the row goes `stale` (web chip amber); unlock: back to `on_the_way` on the next fix (expected in this release).
6. Tap Arrived: `status = 'arrived'`, `record->>'arrived_at'` set; Exit: `status = 'ended'`, `ended_at` set, `record->>'ended_by' = 'arrived'`, `record->>'distance_km_total'` present.
7. A roster ride (Today's Roster → Start navigation) writes nothing to `route_tracker`.
8. Airplane mode mid-ride: the screen keeps navigating, positions are dropped silently, no Alert; back online the next checkpoint resumes.

## 5. Docs (mandatory)

Create `C:\Users\ADMIN\Desktop\b2b\docs\features\android\trainer\route-tracker.md` from `docs/features/_template.md` (events table, throttle, the retry on `ended`, the roster guard, the offline rule) and add its line to `docs/features/README.md`; add a dated change-log line to `docs/features/android/trainer/qhp-navigation.md` and to `docs/features/web/ops/route-tracker.md` ("app side shipped"). Copy the web file to hub-track as usual.
