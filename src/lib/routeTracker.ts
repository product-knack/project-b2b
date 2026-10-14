/* Route tracker, app side (14 Oct 2026, foreground-only release): while the QHP
   navigation screen is open, the assessor's position is published to the office
   through the publish_route_position RPC (hub-track migration 20261014120000),
   which feeds the Leads page toast, the journey chip and the tracking popup.
   Contract: odds-app/docs/route-tracker-handoff.md. Five events: start, position
   (throttled: 5 s moving, 30 s still), checkpoint (the 60 s partial save: trail
   polyline + thinned points), arrived, ended. Every failure is dropped so the ride
   never stalls; only `ended` retries once, because that row is the permanent
   record. Only QHP rides publish (the RPC needs a coach_assessment row). Nothing
   here touches permissions or background location. */
import { Platform } from 'react-native';
import { supabase } from './supabase';
import { withTimeout } from './withTimeout';
import type { Fix, NavigationTrack, TrackPoint } from './qhpNavigation';

export type RouteEvent = 'start' | 'position' | 'checkpoint' | 'arrived' | 'ended';
export const POSITION_MOVING_MS = 5_000;
export const POSITION_STILL_MS = 30_000;
export const MOVING_MPS = 0.8;
export const RPC_TIMEOUT_MS = 8_000;
export const ENDED_RETRY_MS = 3_000;

export type RouteEta = { etaMin: number | null; distanceKm: number | null };
export type RouteLive = {
  lat: number; lng: number;
  heading: number | null;
  speed_mps: number | null;
  accuracy_m: number | null;
  eta_min: number | null;
  distance_km: number | null;
  fix_at: string;
};

/** The `p_live` payload of every event, from the latest GPS fix. */
export const liveFromFix = (f: Fix, eta: RouteEta, heading: number | null): RouteLive => ({
  lat: f.lat, lng: f.lng,
  heading: heading ?? f.heading ?? null,
  speed_mps: f.spd ?? null,
  accuracy_m: f.acc ?? null,
  eta_min: eta.etaMin, distance_km: eta.distanceKm,
  fix_at: new Date(f.t).toISOString(),
});

/** The ride numbers the server stores on `arrived` and `ended`. */
export const summaryOf = (t: NavigationTrack) => ({
  distance_km_total: t.distance_km, duration_min: t.duration_min, avg_kmh: t.avg_kmh,
  arrival_gap_m: t.arrival_gap_m, polyline: t.polyline,
});

export type RouteAnswer = { status?: string; ignored?: boolean; started_at?: string; ended_at?: string; updated_at?: string } | null;

export class RoutePublisher {
  private lastSentAt = 0;
  private stopped = false; // ROUTE_FORBIDDEN / ROUTE_NO_QHP: the server will never take this ride
  constructor(private assessmentId: string, private now: () => number = Date.now) {}

  get isStopped() { return this.stopped; }

  private async call(event: RouteEvent, live: RouteLive | null, record?: Record<string, unknown> | null, points?: TrackPoint[] | null): Promise<RouteAnswer> {
    if (this.stopped) return null;
    try {
      const { data, error } = await withTimeout(
        Promise.resolve(supabase.rpc('publish_route_position', {
          p_assessment_id: this.assessmentId, p_event: event, p_live: live, p_record: record ?? null, p_points: points ?? null,
        })) as Promise<{ data: any; error: any }>,
        RPC_TIMEOUT_MS, 'Route tracker',
      );
      if (error) {
        if (/ROUTE_FORBIDDEN|ROUTE_NO_QHP/.test(String(error.message ?? ''))) this.stopped = true;
        throw error;
      }
      return (data ?? null) as RouteAnswer;
    } catch (e: any) {
      if (__DEV__) console.log('[route-tracker]', event, e?.message ?? e);
      return null; // never block the ride
    }
  }

  start(live: RouteLive, planned: { planned_km: number | null; planned_min: number | null; planned_polyline: string | null }, pin: NavigationTrack['pin'], appVersion: string | null) {
    this.lastSentAt = this.now();
    return this.call('start', live, { ...planned, pin, source: Platform.OS === 'ios' ? 'ios' : 'android', app_version: appVersion });
  }

  /** Throttled; call on every fix. Returns true when a position was sent. */
  position(live: RouteLive): boolean {
    if (this.stopped) return false;
    const moving = (live.speed_mps ?? 0) > MOVING_MPS;
    const gap = moving ? POSITION_MOVING_MS : POSITION_STILL_MS;
    if (this.now() - this.lastSentAt < gap) return false;
    this.lastSentAt = this.now();
    void this.call('position', live);
    return true;
  }

  checkpoint(live: RouteLive, points: TrackPoint[], polyline: string) {
    this.lastSentAt = this.now();
    return this.call('checkpoint', live, { polyline }, points);
  }

  arrived(live: RouteLive, t: NavigationTrack) {
    this.lastSentAt = this.now();
    return this.call('arrived', live, summaryOf(t), t.points);
  }

  /** Retried once after 3 s; the final record matters. */
  async ended(live: RouteLive, t: NavigationTrack): Promise<RouteAnswer> {
    const rec = { ...summaryOf(t), ended_by: t.ended_by ?? 'ended' };
    const r = await this.call('ended', live, rec, t.points);
    if (r || this.stopped) return r;
    await new Promise((res) => setTimeout(res, ENDED_RETRY_MS));
    return this.call('ended', live, rec, t.points);
  }
}
