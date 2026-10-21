/* Route tracker, app side (14 Oct 2026; live release 21 Oct 2026): while a QHP ride runs,
   the assessor's position is published to the office through the publish_route_position
   RPC (hub-track migration 20261014120000, rules updated in 20261021120000), which feeds
   the Leads page toast, the journey chip, the rides panel and the tracking popup.
   Contract: odds-app/docs/route-tracker-handoff.md. Five events: start, position
   (throttled: 5 s moving, 30 s still), checkpoint (the 60 s partial save: trail polyline +
   thinned points + the planned route), arrived, ended.
   Rules since 21 Oct 2026 (the four broken items of the 20 Oct audit):
   - `start` is retried with a backoff (3 s, 6 s, 12 s, up to 30 s) until the server holds
     the row; nothing else is sent before that (it would only raise ROUTE_NOT_STARTED).
   - ROUTE_NOT_STARTED on a later event means the row is gone: `start` is sent again.
   - ROUTE_FORBIDDEN / ROUTE_NO_QHP stop the publisher for good; ROUTE_ENDED (the office or
     the sweep closed the ride) stops the live events but `ended` still lands (the server
     merges the totals into an ended row).
   - `ended` is tried once when online, then queued in the outbox (kind route-ended) and
     replayed by the drain, so a ride that ends offline still gets its record.
   Every live failure is dropped so the ride never stalls. Only QHP rides publish (the RPC
   needs a coach_assessment row). The GPS source (screen watch or the foreground service)
   is the screen's concern, see rideLocationTask.ts. */
import { Platform } from 'react-native';
import { supabase } from './supabase';
import { withTimeout } from './withTimeout';
import { enqueueOutbox, getIsOnline } from './offline';
import type { Fix, NavigationTrack, TrackPoint } from './qhpNavigation';

export type RouteEvent = 'start' | 'position' | 'checkpoint' | 'arrived' | 'ended';
export const POSITION_MOVING_MS = 5_000;
export const POSITION_STILL_MS = 30_000;
export const MOVING_MPS = 0.8;
export const RPC_TIMEOUT_MS = 8_000;
export const START_RETRY_MS = 3_000;
export const START_RETRY_MAX_MS = 30_000;

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
export type RoutePlanned = { planned_km: number | null; planned_min: number | null; planned_polyline: string | null };
export type RouteStartRecord = RoutePlanned & { pin: NavigationTrack['pin']; source: 'ios' | 'android'; app_version: string | null };

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
export type RouteStopReason = 'forbidden' | 'no_qhp' | 'ended';

/** What the outbox replays when `ended` could not be sent (kind route-ended). */
export type RouteEndedPayload = {
  assessmentId: string;
  live: RouteLive;
  record: Record<string, unknown>;
  points: TrackPoint[];
  /** So a replay can send `start` first when the row never existed (ROUTE_NOT_STARTED). */
  startRecord: RouteStartRecord | null;
};

const isStopError = (msg: string): RouteStopReason | null =>
  /ROUTE_FORBIDDEN/.test(msg) ? 'forbidden' : /ROUTE_NO_QHP/.test(msg) ? 'no_qhp' : /ROUTE_ENDED/.test(msg) ? 'ended' : null;

async function rpc(assessmentId: string, event: RouteEvent, live: RouteLive | null, record: Record<string, unknown> | null, points: TrackPoint[] | null): Promise<RouteAnswer> {
  const { data, error } = await withTimeout(
    Promise.resolve(supabase.rpc('publish_route_position', {
      p_assessment_id: assessmentId, p_event: event, p_live: live, p_record: record, p_points: points,
    })) as Promise<{ data: any; error: any }>,
    RPC_TIMEOUT_MS, 'Route tracker',
  );
  if (error) throw error;
  return (data ?? null) as RouteAnswer;
}

/** Outbox replay of a queued end event: `ended`, or `start` then `ended` when the row never
    existed. Throws on a real refusal (the drain marks the item failed), on a connection
    failure (retried later). */
export async function submitRouteEnded(p: RouteEndedPayload): Promise<void> {
  try {
    await rpc(p.assessmentId, 'ended', p.live, p.record, p.points);
  } catch (e: any) {
    if (/ROUTE_NOT_STARTED/.test(String(e?.message ?? '')) && p.startRecord) {
      await rpc(p.assessmentId, 'start', p.live, p.startRecord, null);
      await rpc(p.assessmentId, 'ended', p.live, p.record, p.points);
      return;
    }
    throw e;
  }
}

export class RoutePublisher {
  private lastSentAt = 0;
  private stopReason: RouteStopReason | null = null;
  private started = false;
  private startArgs: { live: RouteLive; record: RouteStartRecord } | null = null;
  private startInFlight: Promise<boolean> | null = null;
  private startTimer: ReturnType<typeof setTimeout> | null = null;
  private startAttempts = 0;
  private destroyed = false;
  constructor(private assessmentId: string, private now: () => number = Date.now, private retryMs: number = START_RETRY_MS) {}

  /** No more live events will be taken (forbidden, no QHP, or the ride was closed). */
  get isStopped() { return this.stopReason !== null; }
  /** The server will never take this ride (the end event is dropped, not queued). */
  private get refused() { return this.stopReason === 'forbidden' || this.stopReason === 'no_qhp'; }
  get reason() { return this.stopReason; }
  get isStarted() { return this.started; }
  get attempts() { return this.startAttempts; }

  private async call(event: RouteEvent, live: RouteLive | null, record?: Record<string, unknown> | null, points?: TrackPoint[] | null): Promise<RouteAnswer> {
    try {
      return await rpc(this.assessmentId, event, live, record ?? null, points ?? null);
    } catch (e: any) {
      const msg = String(e?.message ?? '');
      const stop = isStopError(msg);
      if (stop) this.stopReason = stop;
      else if (/ROUTE_NOT_STARTED/.test(msg) && this.started) {
        // The row is gone (the QHP was recreated, the row deleted): send start again.
        this.started = false;
        this.scheduleStart(0);
      }
      if (__DEV__) console.log('[route-tracker]', event, msg || e);
      return null; // never block the ride
    }
  }

  private scheduleStart(delay: number) {
    if (this.startTimer || this.destroyed || this.isStopped) return;
    this.startTimer = setTimeout(() => { this.startTimer = null; void this.ensureStarted(); }, delay);
  }

  /** Sends `start` (once per attempt) until the server holds the row. Resolves true when it does. */
  ensureStarted(): Promise<boolean> {
    if (this.started) return Promise.resolve(true);
    if (this.isStopped || this.destroyed || !this.startArgs) return Promise.resolve(false);
    if (this.startInFlight) return this.startInFlight;
    if (this.startTimer) return Promise.resolve(false); // a retry is already booked
    const { live, record } = this.startArgs;
    this.startAttempts += 1;
    this.startInFlight = this.call('start', live, record).then((r) => {
      this.startInFlight = null;
      if (r) { this.started = true; this.lastSentAt = this.now(); return true; }
      if (!this.isStopped && !this.destroyed) this.scheduleStart(Math.min(START_RETRY_MAX_MS, this.retryMs * 2 ** Math.min(4, this.startAttempts - 1)));
      return false;
    });
    return this.startInFlight;
  }

  /** Tell the office the ride started. Retried in the background until it lands. */
  start(live: RouteLive, planned: RoutePlanned, pin: NavigationTrack['pin'], appVersion: string | null): Promise<boolean> {
    this.startArgs = { live, record: { ...planned, pin, source: Platform.OS === 'ios' ? 'ios' : 'android', app_version: appVersion } };
    this.started = false;
    this.startAttempts = 0;
    return this.ensureStarted();
  }

  /** Throttled; call on every fix. Returns true when a position was sent. */
  position(live: RouteLive): boolean {
    if (this.isStopped || this.destroyed) return false;
    if (!this.started) {
      // Keep the freshest fix for the start record; nothing goes out before the row exists.
      if (this.startArgs) this.startArgs.live = live;
      void this.ensureStarted();
      return false;
    }
    const moving = (live.speed_mps ?? 0) > MOVING_MPS;
    const gap = moving ? POSITION_MOVING_MS : POSITION_STILL_MS;
    if (this.now() - this.lastSentAt < gap) return false;
    this.lastSentAt = this.now();
    void this.call('position', live);
    return true;
  }

  /** The 60 s checkpoint: the trail so far and the planned route as currently drawn. */
  async checkpoint(live: RouteLive, points: TrackPoint[], polyline: string, planned?: RoutePlanned | null): Promise<RouteAnswer> {
    if (!(await this.ensureStarted())) return null;
    this.lastSentAt = this.now();
    return this.call('checkpoint', live, { polyline, ...(planned ?? {}) }, points);
  }

  async arrived(live: RouteLive, t: NavigationTrack): Promise<RouteAnswer> {
    if (!(await this.ensureStarted())) return null;
    this.lastSentAt = this.now();
    return this.call('arrived', live, summaryOf(t), t.points);
  }

  /** The permanent record. One try when online, else the outbox replays it. Never throws.
      Resolves 'sent', 'queued' or 'dropped' (forbidden / no QHP: the server will never take it). */
  async ended(live: RouteLive, t: NavigationTrack): Promise<'sent' | 'queued' | 'dropped'> {
    if (this.startTimer) { clearTimeout(this.startTimer); this.startTimer = null; }
    if (this.refused) return 'dropped';
    const record = { ...summaryOf(t), ended_by: t.ended_by ?? 'ended' };
    const payload: RouteEndedPayload = { assessmentId: this.assessmentId, live, record, points: t.points, startRecord: this.startArgs?.record ?? null };
    const queue = async () => { await enqueueOutbox('route-ended', 'QHP ride shared with the office', payload); return 'queued' as const; };
    if (!getIsOnline()) return queue();
    if (!this.started && this.startArgs && !(await this.ensureStartedNow())) {
      return this.refused ? 'dropped' : queue();
    }
    try {
      await rpc(this.assessmentId, 'ended', live, record, t.points);
      return 'sent';
    } catch (e: any) {
      const stop = isStopError(String(e?.message ?? ''));
      if (stop) this.stopReason = stop;
      return this.refused ? 'dropped' : queue();
    }
  }

  /** One direct start attempt (no backoff), for the end event. */
  private async ensureStartedNow(): Promise<boolean> {
    if (this.started) return true;
    if (this.startInFlight) return this.startInFlight;
    if (!this.startArgs) return false;
    const r = await this.call('start', this.startArgs.live, this.startArgs.record);
    if (r) this.started = true;
    return !!r;
  }

  /** Stop retrying (the screen left). */
  destroy() {
    this.destroyed = true;
    if (this.startTimer) { clearTimeout(this.startTimer); this.startTimer = null; }
  }
}
