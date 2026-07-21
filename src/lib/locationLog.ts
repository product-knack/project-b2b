import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { enqueueOutbox, getIsOnline } from './offline';

/* ============ Foreground work check-in location logging ============
   On app open (session-ready + AppState 'active'), TRAINERS and DOCTORS capture
   their current location at most once per CAPTURE_INTERVAL_HOURS and store one
   row in trainer_location_logs (the append_trainer_location RPC keys on
   auth.uid(), so doctor rows land in the same table — verified live). Fully
   silent + fire-and-forget: a missing permission, disabled location services,
   or a GPS hang never crashes or blocks the app. Offline / transient insert
   failures queue to the offline outbox and replay with the ORIGINAL
   captured_at. This is NOT background tracking. */

// Raw profiles.role values whose location is captured.
const CAPTURED_ROLES = ['trainer', 'doctor'];

// Single knob — change this to adjust how often a location is captured.
export const CAPTURE_INTERVAL_HOURS = 1;

const LAST_KEY = 'location:lastCapturedAt'; // AsyncStorage; survives app restarts
const POSITION_TIMEOUT_MS = 15_000;

export type LocationLogPayload = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  capturedAt: string; // ORIGINAL device timestamp of the fix — never the sync time
};

/* Connectivity failures → retry later (queue); real rejections → give up silently. */
function isTransient(e: any): boolean {
  const msg = String(e?.message ?? e ?? '');
  return /network request failed|network error|failed to fetch|fetch failed|timeout|abort|socket|ENOTFOUND|ECONN/i.test(msg);
}

/* Resolve a promise, or null if it doesn't settle within ms (so a GPS hang can't linger). */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; resolve(null); } }, ms);
    p.then((v) => { if (!done) { done = true; clearTimeout(t); resolve(v); } })
     .catch(() => { if (!done) { done = true; clearTimeout(t); resolve(null); } });
  });
}

/* Append one point onto today's row via the atomic SECURITY DEFINER RPC. The RPC
   resolves trainer_id = auth.uid() and derives the IST log_date from p_captured_at
   server-side, then does a single race-safe upsert (points = points || newPoint).
   The client never sends trainer_id, and there is no read-modify-write. */
export async function submitLocationLog(p: LocationLogPayload): Promise<void> {
  const { error } = await supabase.rpc('append_trainer_location', {
    p_lat: p.latitude,
    p_lng: p.longitude,
    p_accuracy: p.accuracy,
    p_captured_at: p.capturedAt, // ISO of the capture moment → IST day + point.at
  });
  if (error) throw new Error(error.message);
}

const enqueueLocation = (p: LocationLogPayload) =>
  enqueueOutbox('location-log', 'Location check-in', p);

// Guard so the two triggers (mount + AppState 'active') can't run concurrently.
let inFlight = false;

/* Capture + store the current location, subject to the throttle. `dbRole` is the
   RAW profiles.role (from useAuth.dbRole): only trainers and doctors are ever
   captured — coach/crm/admin/super_admin/marketing are excluded. Safe to call on
   every app open — everything past the throttle is best-effort and swallowed. */
export async function maybeCaptureLocation(userId: string | null | undefined, dbRole: string | null | undefined): Promise<void> {
  if (!userId) return;
  if (!CAPTURED_ROLES.includes(dbRole ?? '')) return; // raw role, not the coarse app role
  if (inFlight) return;
  inFlight = true;
  try {
    // 1. Throttle — at most once per CAPTURE_INTERVAL_HOURS (persisted across restarts).
    try {
      const last = await AsyncStorage.getItem(LAST_KEY);
      if (last) {
        const lastMs = Number(last);
        if (Number.isFinite(lastMs) && Date.now() - lastMs < CAPTURE_INTERVAL_HOURS * 3_600_000) return;
      }
    } catch { /* storage read failed → treat as no throttle, continue */ }

    // 2. Foreground permission — NEVER prompts here. Asking is owned by the
    //    LocationGate (one ask at app open); the hourly capture is fully silent.
    const perm = await Location.getForegroundPermissionsAsync();
    if (!perm.granted) return;

    // 3. Current position (Balanced), guarded by a timeout so a hang can't linger.
    const pos = await withTimeout(
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      POSITION_TIMEOUT_MS,
    );
    if (!pos) return; // timed out, services off, or GPS error → silent skip

    const payload: LocationLogPayload = {
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      accuracy: pos.coords.accuracy ?? null,
      capturedAt: new Date(pos.timestamp || Date.now()).toISOString(),
    };

    // 4. Store, and ONLY advance the throttle once the capture is safely handled —
    //    a confirmed save, or a successfully queued outbox item. A failed capture
    //    must NOT burn the hour; it retries on the next app open.
    const markCaptured = () => AsyncStorage.setItem(LAST_KEY, String(Date.now())).catch(() => {});

    if (!getIsOnline()) {
      // Offline → queue for replay, then count it as captured (outbox won't lose it).
      await enqueueLocation(payload);
      await markCaptured();
      return;
    }
    try {
      await submitLocationLog(payload);
      await markCaptured(); // confirmed save
    } catch (e: any) {
      if (isTransient(e)) {
        await enqueueLocation(payload); // queued for retry with the original captured_at
        await markCaptured();           // safely handled → advance throttle
        return;
      }
      // Real rejection (RLS / validation) — NOT queued, so DON'T advance the throttle:
      // the next app open will retry instead of losing the hour.
    }
  } catch {
    // Any unexpected failure (permissions, GPS, storage) — stay silent, throttle untouched.
  } finally {
    inFlight = false;
  }
}
