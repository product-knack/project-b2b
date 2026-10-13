/* QHP navigation (14 Oct 2026): the data half. The route comes from the deployed
   roster-distance edge function (Google Routes with the server key, OSRM fallback)
   in its navigate mode; the ride is written to coach_assessment.navigation_track
   (hub-track migration 20261014100000) by the assessor through the row's own
   update policy, with the offline outbox as the fallback. */
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { supabase } from './supabase';
import { invokeWithTimeout, withTimeout, NET_MS } from './withTimeout';
import { enqueueOutbox, getIsOnline } from './offline';
import { decodePolyline, type NavigationTrack, type RouteInfo } from './qhpNavigation';

/** What the QHP card hands to the screen (set before go('qhp-navigate'), read on mount). */
export type NavTarget = {
  assessmentId: string;
  clientId: string;
  clientName: string;
  address: string | null;
  phone: string | null;
  lat: number;
  lng: number;
  pinCapturedAt: string | null;
  pinMethod: string | null;
};
export const navTargetRef: { current: NavTarget | null } = { current: null };

export const appVersionLabel = (): string | null => {
  const cfg: any = (Constants as any)?.expoConfig ?? {};
  if (!cfg.version) return null;
  const build = Platform.OS === 'ios' ? cfg.ios?.buildNumber : cfg.android?.versionCode;
  return build != null && build !== '' ? `${cfg.version} (${build})` : String(cfg.version);
};

async function invokeWithToken(name: string, body: any) {
  let { data } = await supabase.auth.getSession();
  if (!data.session) {
    await new Promise((r) => setTimeout(r, 450));
    ({ data } = await supabase.auth.getSession());
  }
  const token = data.session?.access_token;
  return invokeWithTimeout(name, { body, ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}) }, 15_000);
}

/** One route refresh. Throws on any failure; the screen then runs on the local estimate. */
export async function fetchNavRoute(target: NavTarget, origin: { lat: number; lng: number }): Promise<RouteInfo> {
  const { data, error } = await invokeWithToken('roster-distance', {
    client_id: target.clientId, assessment_id: target.assessmentId, origin, mode: 'navigate',
  });
  if (error) {
    const res: Response | undefined = (error as any)?.context;
    let code = '';
    try { code = (await res?.clone().json())?.error ?? ''; } catch { /* non-JSON */ }
    throw new Error(code || error.message || 'Route service unavailable');
  }
  if (!data?.ok) throw new Error(String(data?.error ?? 'Route service unavailable'));
  const polyline: string | null = typeof data.polyline === 'string' && data.polyline ? data.polyline : null;
  const points = polyline ? decodePolyline(polyline) : [];
  return {
    points: points.length >= 2 ? points : [[origin.lat, origin.lng], [target.lat, target.lng]],
    distanceKm: Number(data.distanceKm) || 0,
    durationMin: Number(data.durationMin) || 0,
    traffic: !!data.traffic,
    approx: !!data.approx || !polyline,
    fetchedAt: Date.now(),
    polyline,
  };
}

/** Write the track on the QHP row (the assessor's own update policy). */
export async function submitNavigationTrack(p: { assessmentId: string; track: NavigationTrack }): Promise<void> {
  const { error } = await withTimeout(
    Promise.resolve(supabase.from('coach_assessment').update({ navigation_track: p.track } as any).eq('id', p.assessmentId)),
    NET_MS, 'Navigation track',
  ) as { error: any };
  if (error) throw new Error(error.message);
}

/** Final write at Arrived / End: straight to the row when online, else through the outbox
    (replayed with the json exactly as captured). Partial writes while riding are best effort. */
export async function saveNavigationTrack(assessmentId: string, track: NavigationTrack, opts?: { final?: boolean }): Promise<'saved' | 'queued' | 'skipped'> {
  if (!getIsOnline()) {
    if (!opts?.final) return 'skipped';
    await enqueueOutbox('nav-track', 'QHP ride track', { assessmentId, track });
    return 'queued';
  }
  try {
    await submitNavigationTrack({ assessmentId, track });
    return 'saved';
  } catch (e: any) {
    if (!opts?.final) return 'skipped';
    if (/network request failed|network error|failed to fetch|fetch failed|timeout/i.test(String(e?.message))) {
      await enqueueOutbox('nav-track', 'QHP ride track', { assessmentId, track });
      return 'queued';
    }
    throw e;
  }
}
