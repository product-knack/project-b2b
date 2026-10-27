/* QHP navigation (14 Oct 2026, owner: "a Start navigation button on the upcoming QHP
   cards, Uber-style live tracking to the client's pin, only when clients.brb_location
   exists"; same afternoon: "beautify it like Google Maps, same style map, same animation,
   and tell me 'after 400 metres turn left'").
   A light vector map in a WebView (MapLibre + OpenFreeMap, no key) with a pitched
   heading-up camera that glides between fixes, the Odds bike badge, the planned
   route from the roster-distance function (Google Routes with turn-by-turn steps,
   OSRM fallback), a turn banner on top with the distance to the manoeuvre, spoken
   cues at 400 m and at the turn (expo-speech, mute button), the time left in a white
   bottom sheet with Exit, round side buttons (north / heading, mute, overview), a
   Re-centre pill when the camera is moved, and the ride saved as
   coach_assessment.navigation_track at Arrived / End. Since 21 Oct 2026 the ride GPS runs
   in a foreground location service (rideLocationTask.ts), so the turns, the voice, the
   recording and the office feed keep going with the screen locked. */
import React from 'react';
import { View, Text, Pressable, ActivityIndicator, Alert, AppState, Linking, AccessibilityInfo, Platform } from 'react-native';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { F, hexA } from '../theme';
import { Icon } from '../icons';
import { useStore, homeRouteFor } from '../store';
import { useSpeech } from '../lib/useSpeech';
import { NAV_MAP_HTML } from '../lib/navMapHtml';
import { navTargetRef, fetchNavRoute, saveNavigationTrack, appVersionLabel, type NavTarget } from '../lib/qhpNavigationQueries';
import { RoutePublisher, liveFromFix, type RouteEta, type RoutePlanned } from '../lib/routeTracker';
import { startRideService, stopRideService, setRideFixListener, type RideServiceState } from '../lib/rideLocationTask';
import { useIsOnline } from '../lib/offline';
import { backOverride } from '../gestureLock';
import {
  type Fix, type LatLng, type RouteInfo, type TrackPoint, type Projection, type Maneuver, type ManeuverKind,
  projectOnRoute, isOffRoute, isArrived, estimateLeft, arrivalClock, agoText, shouldKeep, toPoint, headingFrom, isMoving,
  buildTrack, stalePin, haversineM, nextManeuver, fmtStepDistance, voiceCue, maneuverPhrase, instructionTitle, ARRIVE_CUE, ROUTE_REFRESH_MS, ROUTE_MIN_GAP_MS,
} from '../lib/qhpNavigation';
import { friendlyError } from '../lib/friendlyError';

type Phase = 'locating' | 'ready' | 'navigating' | 'arrived' | 'saving';
type RouteState = 'none' | 'ok' | 'recalculating' | 'local';
const TRACK_KEY = (id: string) => `qhp-nav-track:${id}`;
/* A roster session ride (kind 'session', from Today's Roster) has no assessment row to
   write to: it navigates exactly the same but nothing is stored (14 Oct 2026). */
const savesRide = (t: NavTarget) => t.kind === 'qhp' && !!t.assessmentId;
const PARTIAL_SAVE_MS = 60_000;
/* One fix shape for the screen watch and the ride service. */
const toFix = (p: Location.LocationObject): Fix => ({ t: p.timestamp || Date.now(), lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy ?? null, spd: p.coords.speed ?? null, heading: p.coords.heading ?? null });
const plannedOf = (r: RouteInfo | null): RoutePlanned => ({ planned_km: r?.distanceKm ?? null, planned_min: r?.durationMin ?? null, planned_polyline: r?.polyline ?? null });

/* Google's navigation palette */
const G = { blue: '#1A73E8', green: '#188038', red: '#D93025', teal: '#0B6E63', tealDark: '#095A51', ink: '#202124', ink2: '#3C4043', muted: '#5F6368', line: '#DADCE0', sheet: '#FFFFFF', amber: '#B06000', amberBg: '#FEF7E0' };
const shadow = { shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 5 } as const;

/* Manoeuvre arrows (24 x 24 strokes, drawn by the app's Icon with a raw path). */
const ARROWS: Record<ManeuverKind, string> = {
  straight: 'M12 20V5M7 10l5-5 5 5',
  left: 'M17 20v-6a4 4 0 0 0-4-4H5M9 6l-4 4 4 4',
  right: 'M7 20v-6a4 4 0 0 1 4-4h8M15 6l4 4-4 4',
  'slight-left': 'M14 20v-6l-6-6M8 13V8h5',
  'slight-right': 'M10 20v-6l6-6M16 13V8h-5',
  'sharp-left': 'M16 20V9a3 3 0 0 0-3-3H8M11 3 6 6l3 5',
  'sharp-right': 'M8 20V9a3 3 0 0 1 3-3h5M13 3l5 3-3 5',
  'uturn-left': 'M16 20V9a4 4 0 0 0-8 0v4M11 10l-3 3-3-3',
  'uturn-right': 'M8 20V9a4 4 0 0 1 8 0v4M13 10l3 3 3-3',
  'roundabout-left': 'M12 21v-5M12 16a4.5 4.5 0 1 0-4.5-4.5M7.5 11.5V7.5M10 10 7.5 7.5 5 10',
  'roundabout-right': 'M12 21v-5M12 16a4.5 4.5 0 1 1 4.5-4.5M16.5 11.5V7.5M14 10l2.5-2.5L19 10',
  merge: 'M12 21V9M12 9 7 4M12 9l5-5',
  'fork-left': 'M12 21v-9M12 12 7 7M7 11V7h4',
  'fork-right': 'M12 21v-9M12 12l5-5M17 11V7h-4',
  'ramp-left': 'M14 20v-6l-6-6M8 13V8h5',
  'ramp-right': 'M10 20v-6l6-6M16 13V8h-5',
  depart: 'M12 20V5M7 10l5-5 5 5',
  arrive: 'M12 21s-6-5.3-6-10a6 6 0 1 1 12 0c0 4.7-6 10-6 10zM12 11h.01',
  ferry: 'M4 17c2 1.5 4 1.5 6 0s4-1.5 6 0 4 1.5 4 0M6 13l1-5h10l1 5M12 4v4',
};

function RoundBtn({ path, name, label, onPress, active, tint }: { path?: string; name?: any; label: string; onPress: () => void; active?: boolean; tint?: string }) {
  const col = tint ?? (active ? G.blue : G.ink2);
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => ({ width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? '#F1F3F4' : '#fff', ...shadow })}>
      {path ? <Icon path={path} size={22} color={col} strokeWidth={2.2} /> : <Icon name={name} size={20} color={col} strokeWidth={2.2} />}
    </Pressable>
  );
}

export function QhpNavigation() {
  const { back, canGoBack, go, role } = useStore();
  const insets = useSafeAreaInsets();
  // Where Exit lands when there is no history: the QHP page for a QHP ride, else the role's home (trainer or doctor roster).
  const leave = (kind: 'qhp' | 'session' | null) => (canGoBack ? back() : go(kind === 'qhp' ? 'qhp' : homeRouteFor(role)));
  const target = React.useRef<NavTarget | null>(navTargetRef.current).current;
  const web = React.useRef<WebView>(null);
  const speech = useSpeech();
  const [mapReady, setMapReady] = React.useState(false);
  const [mapError, setMapError] = React.useState<string | null>(null);
  const [phase, setPhase] = React.useState<Phase>('locating');
  const [routeState, setRouteState] = React.useState<RouteState>('none');
  const [route, setRoute] = React.useState<RouteInfo | null>(null);
  const [fix, setFix] = React.useState<Fix | null>(null);
  const [proj, setProj] = React.useState<Projection | null>(null);
  const [routeAgo, setRouteAgo] = React.useState<string>('');
  const [reduceMotion, setReduceMotion] = React.useState(false);
  const [permDenied, setPermDenied] = React.useState(false);
  const [saveNote, setSaveNote] = React.useState<string | null>(null);
  const [following, setFollowing] = React.useState(true);
  const [reached, setReached] = React.useState(false); // the pin was reached (stays true while saving)
  const [cameraNorth, setCameraNorth] = React.useState(false);
  const [muted, setMuted] = React.useState(false);
  const mutedRef = React.useRef(false);
  mutedRef.current = muted;
  // Where the ride GPS comes from once started: the foreground service (fixes continue with
  // the screen locked) or, when it could not start, the screen watch (21 Oct 2026).
  const [share, setShare] = React.useState<RideServiceState | null>(null);
  const online = useIsOnline();
  const watchRef = React.useRef<Location.LocationSubscription | null>(null);
  const onFixRef = React.useRef<(f: Fix) => void>(() => {});

  // Ride recording
  const startMs = React.useRef<number | null>(null);
  const points = React.useRef<TrackPoint[]>([]);
  const prevFix = React.useRef<Fix | null>(null);
  const headingRef = React.useRef(0);
  const movingRef = React.useRef(false);
  const routeRef = React.useRef<RouteInfo | null>(null);
  const lastRouteCallAt = React.useRef(0);
  const routeInFlight = React.useRef(false);
  const phaseRef = React.useRef<Phase>('locating');
  const lastPartialSave = React.useRef(0);
  const finishing = React.useRef(false);
  const routeAtStart = React.useRef<RouteInfo | null>(null);
  const spoken = React.useRef<Set<string>>(new Set());
  const compassRef = React.useRef<number | null>(null);
  const headingSubRef = React.useRef<Location.LocationSubscription | null>(null);
  phaseRef.current = phase;
  routeRef.current = route;

  const pin: LatLng | null = target ? [target.lat, target.lng] : null;
  const stale = target ? stalePin(target.pinCapturedAt, target.pinMethod) : { stale: false, reason: null };

  const send = React.useCallback((m: any) => {
    web.current?.injectJavaScript(`window.__nav && window.__nav.apply(${JSON.stringify(m)}); true;`);
  }, []);

  const say = React.useCallback((id: string, text: string) => {
    if (mutedRef.current) return;
    speech.speak(id, text);
  }, [speech]);

  React.useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((r) => { if (alive) setReduceMotion(!!r); }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (r) => setReduceMotion(!!r));
    return () => { alive = false; sub.remove(); };
  }, []);
  React.useEffect(() => { if (mapReady) send({ type: 'motion', reduce: reduceMotion }); }, [mapReady, reduceMotion, send]);

  // Map init once the page is up, then replay the last fix.
  React.useEffect(() => {
    if (!mapReady || !target) return;
    const f = prevFix.current;
    if (f) setTimeout(() => onFix(f), 150);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady]);

  // GPS: a fix every second; the compass beside it for the badge's heading. Before Start the
  // screen watch; from Start the ride service takes over (see start()).
  React.useEffect(() => {
    if (!target) return;
    let alive = true;
    (async () => {
      try {
        let perm = await Location.getForegroundPermissionsAsync();
        if (!perm.granted && perm.canAskAgain) perm = await Location.requestForegroundPermissionsAsync();
        if (!perm.granted) { if (alive) setPermDenied(true); return; }
        const sub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 }, (p) => {
          if (!alive) return;
          onFixRef.current(toFix(p));
        });
        if (alive) watchRef.current = sub; else sub.remove();
        let lastSent = 0, lastDeg = -1;
        headingSubRef.current = await Location.watchHeadingAsync((h) => {
          if (!alive) return;
          const deg = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
          if (!(deg >= 0)) return;
          const now = Date.now();
          if (now - lastSent < 100 || Math.abs(deg - lastDeg) < 1) return;
          lastSent = now; lastDeg = deg;
          compassRef.current = deg;
          send({ type: 'compass', deg });
        });
      } catch { if (alive) setPermDenied(true); }
    })();
    return () => {
      alive = false;
      watchRef.current?.remove(); watchRef.current = null;
      headingSubRef.current?.remove(); headingSubRef.current = null;
      // Leaving the screen for any reason ends the service and the start retries.
      setRideFixListener(null);
      void stopRideService();
      publisher.current?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.assessmentId, target?.scheduleId]);

  const nearestIndex = (p: LatLng, pts: LatLng[]): number => {
    let bi = 0, bd = Infinity;
    for (let i = 0; i < pts.length; i++) { const d = haversineM(p, pts[i]); if (d < bd) { bd = d; bi = i; } }
    return bi;
  };

  const [maneuver, setManeuver] = React.useState<Maneuver | null>(null);

  // Route tracker (14 Oct 2026; background since 21 Oct 2026): a QHP ride publishes its
  // position to the office from Start to Arrived / Exit, screen locked or not. Roster rides
  // never publish. Failures never stop the ride.
  const publisher = React.useRef<RoutePublisher | null>(null);
  const etaNow = React.useRef<RouteEta>({ etaMin: null, distanceKm: null });
  // The heading the office draws: the GPS course while riding, the compass while standing
  // (the arrow pointed north at every stop before 21 Oct 2026).
  const liveHeading = () => (movingRef.current ? headingRef.current : (compassRef.current ?? headingRef.current));

  const onFix = (f: Fix) => {
    const prev = prevFix.current;
    headingRef.current = headingFrom(prev, f, headingRef.current);
    movingRef.current = isMoving(prev, f);
    prevFix.current = f;
    setFix(f);
    if (phaseRef.current === 'locating') setPhase('ready');
    const here: LatLng = [f.lat, f.lng];
    const r = routeRef.current;
    const pj = r ? projectOnRoute(here, r.points) : null;
    setProj(pj);
    const estNow = pin ? estimateLeft(here, pin, r, pj) : null;
    etaNow.current = estNow ? { etaMin: estNow.min, distanceKm: estNow.km } : { etaMin: null, distanceKm: null };
    if (phaseRef.current === 'navigating' || phaseRef.current === 'arrived') {
      const s = startMs.current ?? f.t;
      const last = points.current[points.current.length - 1] ?? null;
      if (shouldKeep(last, f, s)) {
        points.current.push(toPoint(f, s));
        if (points.current.length % 6 === 0 && target && savesRide(target)) persistLocal();
      }
      if (pin && isArrived(here, pin, f.acc) && phaseRef.current === 'navigating') {
        setPhase('arrived');
        setReached(true);
        if (!spoken.current.has(ARRIVE_CUE)) { spoken.current.add(ARRIVE_CUE); say(ARRIVE_CUE, 'You have arrived at your destination.'); }
        send({ type: 'arrived' });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        if (publisher.current) {
          const t = currentTrack('arrived', Date.now());
          if (t) void publisher.current.arrived(liveFromFix(f, { etaMin: 0, distanceKm: 0 }, liveHeading()), t);
        }
      }
      publisher.current?.position(liveFromFix(f, etaNow.current, liveHeading()));
      if (r && pj && isOffRoute(pj, f.acc) && !routeInFlight.current && Date.now() - lastRouteCallAt.current > ROUTE_MIN_GAP_MS) {
        setRouteState('recalculating');
        send({ type: 'route', points: r.points, dim: true });
        refreshRoute(here, 'off-route');
      } else if (Date.now() - lastRouteCallAt.current > ROUTE_REFRESH_MS && !routeInFlight.current) {
        refreshRoute(here, 'periodic');
      }
      if (target && savesRide(target) && Date.now() - lastPartialSave.current > PARTIAL_SAVE_MS) { lastPartialSave.current = Date.now(); void partialSave(); }
      // Turn-by-turn: the next manoeuvre and its spoken cue.
      if (r && pj && phaseRef.current === 'navigating') {
        const mv = nextManeuver(pj.alongM, r.steps, pj.totalM);
        setManeuver(mv);
        const cue = voiceCue(mv, spoken.current);
        if (cue) { spoken.current.add(cue.id); say(cue.id, cue.text); }
      }
    }
    const alongIndex = pj && r ? nearestIndex(here, r.points) : null;
    const intervalMs = prev ? Math.max(0, f.t - prev.t) : 1000;
    send({ type: 'pos', lat: f.lat, lng: f.lng, heading: headingRef.current, speed: f.spd ?? 0, intervalMs, moving: movingRef.current && phaseRef.current !== 'arrived', alongIndex, follow: phaseRef.current !== 'ready' });
  };
  onFixRef.current = onFix;

  const refreshRoute = async (origin: LatLng, why: 'start' | 'periodic' | 'off-route') => {
    if (!target || routeInFlight.current) return;
    routeInFlight.current = true;
    lastRouteCallAt.current = Date.now();
    try {
      const r = await fetchNavRoute(target, { lat: origin[0], lng: origin[1] });
      routeRef.current = r;
      setRoute(r);
      setRouteState('ok');
      setRouteAgo('just now');
      if (why !== 'periodic') spoken.current = new Set(); // a new line: cues start over
      send({ type: 'route', points: r.points, dim: false, overview: false });
      const f = prevFix.current;
      if (f) {
        const pj = projectOnRoute([f.lat, f.lng], r.points);
        setProj(pj);
        if (pj) setManeuver(nextManeuver(pj.alongM, r.steps, pj.totalM));
        send({ type: 'pos', lat: f.lat, lng: f.lng, heading: headingRef.current, speed: f.spd ?? 0, intervalMs: 400, moving: movingRef.current && phaseRef.current !== 'arrived', alongIndex: pj ? nearestIndex([f.lat, f.lng], r.points) : null, follow: phaseRef.current !== 'ready' });
      }
      if (why === 'off-route') say('reroute', 'Rerouting.');
    } catch {
      setRouteState('local');
      if (routeRef.current) send({ type: 'route', points: routeRef.current.points, dim: false });
    } finally {
      routeInFlight.current = false;
    }
  };

  React.useEffect(() => {
    const t = setInterval(() => { if (routeRef.current) setRouteAgo(agoText(Date.now() - routeRef.current.fetchedAt)); }, 10_000);
    return () => clearInterval(t);
  }, []);

  const persistLocal = () => {
    if (!target || !target.assessmentId || startMs.current == null) return;
    AsyncStorage.setItem(TRACK_KEY(target.assessmentId), JSON.stringify({ startMs: startMs.current, points: points.current })).catch(() => {});
  };

  const currentTrack = (endedBy: 'arrived' | 'ended' | null, endMs: number | null) => {
    if (!target || startMs.current == null) return null;
    const r = routeAtStart.current;
    const last = prevFix.current ? ([prevFix.current.lat, prevFix.current.lng] as LatLng) : null;
    return buildTrack({
      startMs: startMs.current, endMs, endedBy, points: points.current,
      pin: { lat: target.lat, lng: target.lng, captured_at: target.pinCapturedAt, method: target.pinMethod },
      planned: r ? { km: r.distanceKm, min: r.durationMin, polyline: r.polyline } : null,
      last, source: Platform.OS === 'ios' ? 'ios' : 'android', appVersion: appVersionLabel(),
    });
  };

  const partialSave = async () => {
    const t = currentTrack(null, null);
    if (!t || !target || !target.assessmentId) return;
    try { await saveNavigationTrack(target.assessmentId, t); } catch { /* best effort while riding */ }
    // The 60 s checkpoint for the office: the trail so far (polyline + thinned points) and the
    // planned route as drawn now (refreshed after a reroute, and the start's if it had none).
    const f = prevFix.current;
    if (f && publisher.current) void publisher.current.checkpoint(liveFromFix(f, etaNow.current, liveHeading()), t.points, t.polyline, plannedOf(routeRef.current));
  };

  // Preview the route as soon as we know where the assessor is (before Start).
  const previewed = React.useRef(false);
  React.useEffect(() => {
    if (phase !== 'ready' || !fix || previewed.current || !mapReady) return;
    previewed.current = true;
    (async () => {
      await refreshRoute([fix.lat, fix.lng], 'start');
      send({ type: 'overview' });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, fix, mapReady]);

  const start = async () => {
    if (!target || !fix || phase !== 'ready') return;
    startMs.current = Date.now();
    points.current = [toPoint(fix, startMs.current)];
    lastPartialSave.current = Date.now();
    lastRouteCallAt.current = 0;
    spoken.current = new Set();
    setPhase('navigating');
    setFollowing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    send({ type: 'start' });
    if (savesRide(target)) persistLocal();
    if (savesRide(target) && target.assessmentId) {
      // Tell the office the ride started (toast on the Leads page, chip on the journey). Sent
      // before the route fetch (up to 15 s) and retried until it lands; the planned route
      // follows on the first checkpoint when the preview had none.
      publisher.current = new RoutePublisher(target.assessmentId);
      const f0 = prevFix.current ?? fix;
      void publisher.current.start(
        liveFromFix(f0, etaNow.current, liveHeading()),
        plannedOf(routeRef.current),
        { lat: target.lat, lng: target.lng, captured_at: target.pinCapturedAt, method: target.pinMethod },
        appVersionLabel(),
      );
    }
    // The ride GPS moves to the foreground service (a persistent notification): fixes, turns,
    // the voice and the office feed carry on with the screen locked. Android requires the app
    // to be in front for this call, which the Start tap guarantees.
    const svc = await startRideService(target.clientName.split(' ')[0] || target.clientName, savesRide(target));
    if (svc === 'service') {
      setRideFixListener((locs) => { for (const p of locs) onFixRef.current(toFix(p)); });
      watchRef.current?.remove(); watchRef.current = null;
    }
    setShare(svc);
    if (!routeRef.current) await refreshRoute([fix.lat, fix.lng], 'start');
    routeAtStart.current = routeRef.current;
    const r = routeRef.current;
    const first = r?.steps?.[0];
    const pj = r ? projectOnRoute([fix.lat, fix.lng], r.points) : null;
    const mv = r && pj ? nextManeuver(pj.alongM, r.steps, pj.totalM) : null;
    setManeuver(mv);
    const opening = first ? instructionTitle(first.instruction) : null;
    const next = mv && mv.kind !== 'arrive' ? `, then in ${fmtStepDistance(mv.distanceM).replace(' m', ' metres').replace(' km', ' kilometres')} ${maneuverPhrase(mv.kind, mv.street, mv.prep)}` : '';
    say('start', `${opening ?? 'Starting navigation'}${next}.`);
  };

  const finish = async (endedBy: 'arrived' | 'ended') => {
    if (!target || finishing.current) return;
    finishing.current = true;
    setPhase('saving');
    speech.stop();
    send({ type: 'stop' });
    setRideFixListener(null);
    void stopRideService();
    const t = currentTrack(endedBy, Date.now());
    const f = prevFix.current;
    // The office's end event and the QHP record run side by side (21 Oct 2026): before, a
    // stalled record save ran first and blocked the end event, so the office kept a live
    // ride and the assessor sat behind "Could not save the ride". ended() never throws: it
    // lands now, or the outbox replays it when the phone is back online.
    const endedP = t && f && publisher.current ? publisher.current.ended(liveFromFix(f, etaNow.current, liveHeading()), t) : Promise.resolve(null);
    try {
      if (t && savesRide(target) && target.assessmentId) {
        const res = await saveNavigationTrack(target.assessmentId, t, { final: true });
        setSaveNote(res === 'queued' ? 'Ride saved on this phone; it syncs when you are back online.' : null);
        await AsyncStorage.removeItem(TRACK_KEY(target.assessmentId)).catch(() => {});
      }
      await endedP;
      publisher.current?.destroy();
      publisher.current = null;
      if (endedBy === 'arrived') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      navTargetRef.current = null;
      leave(target.kind);
    } catch (e: any) {
      await endedP;
      finishing.current = false;
      setPhase(endedBy === 'arrived' ? 'arrived' : 'navigating');
      Alert.alert('Could not save the ride', friendlyError(e, 'Please try again.'), [{ text: 'OK' }]);
    }
  };

  const confirmExit = () => {
    if (phase === 'ready' || phase === 'locating') { speech.stop(); navTargetRef.current = null; leave(target?.kind ?? null); return; }
    // Exit after the pin was reached records the ride as arrived (it said "ended" before 21 Oct 2026).
    const endedBy = reached || phase === 'arrived' ? 'arrived' : 'ended';
    Alert.alert('Exit navigation?', target && savesRide(target) ? 'The ride so far is saved with the QHP.' : 'You can start again from the roster card.', [
      { text: 'Keep going', style: 'cancel' },
      { text: 'Exit', style: 'destructive', onPress: () => finish(endedBy) },
    ]);
  };

  // Android back goes through the same Exit confirm as the Exit button (20 Oct 2026 audit,
  // item 1): before, back() just left the screen, the ride was never saved and the office kept
  // seeing it live until the sweep. The edge swipe is already off on this route (Router
  // NO_SWIPE_BACK).
  const confirmExitRef = React.useRef(confirmExit); confirmExitRef.current = confirmExit;
  React.useEffect(() => {
    backOverride.handler = () => confirmExitRef.current();
    return () => { backOverride.handler = null; };
  }, []);

  React.useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active' && phaseRef.current === 'navigating') send({ type: 'recenter' }); });
    return () => sub.remove();
  }, [send]);

  if (!target) {
    return (
      <View style={{ flex: 1, backgroundColor: '#e8eaed', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 }}>
        <Text style={{ fontFamily: F.body, fontSize: 13, color: G.muted, textAlign: 'center' }}>Nothing to navigate to. Open an upcoming QHP or a roster card's distance and tap Start navigation.</Text>
        <Pressable onPress={() => leave(null)} hitSlop={10}><Text style={{ fontFamily: F.bodySemi, fontSize: 13.5, color: G.blue }}>Back</Text></Pressable>
      </View>
    );
  }

  // ---- the numbers
  const here: LatLng | null = fix ? [fix.lat, fix.lng] : null;
  const est = here && pin ? estimateLeft(here, pin, route, proj) : null;
  const atPin = reached && (phase === 'arrived' || phase === 'saving');
  const gapM = here && pin ? Math.round(haversineM(here, pin)) : null;
  const approx = (est?.local || routeState === 'local' || routeState === 'recalculating') && !atPin;
  const minText = !est ? '—' : atPin ? '0' : `${approx ? '~' : ''}${est.min}`;
  const kmText = !est ? '' : atPin && gapM != null ? `${gapM} m` : est.km < 1 ? `${Math.round(est.km * 1000)} m` : `${est.km} km`;
  const arriveText = !est ? '' : arrivalClock(Date.now(), atPin ? 0 : est.min);
  const navigating = phase === 'navigating' || phase === 'arrived' || phase === 'saving';

  const bannerKind: ManeuverKind = atPin ? 'arrive' : maneuver?.kind ?? 'straight';
  const bannerDist = atPin ? (gapM != null ? `${gapM} m` : '') : maneuver ? fmtStepDistance(maneuver.distanceM) : '';
  const bannerText = atPin ? 'You have arrived' : maneuver
    ? (maneuver.kind === 'arrive' ? target.clientName : (maneuver.street ?? maneuver.instruction ?? 'Continue'))
    : (route && !route.steps.length ? 'Follow the blue line' : 'Finding the route');
  const bannerSub = atPin ? target.clientName : maneuver ? (maneuver.street ? maneuver.instruction : maneuver.note) : null;

  const statusLine: { text: string; color: string; bg: string } | null = permDenied
    ? { text: 'Location is off for Odds. Allow it in the phone settings.', color: '#fff', bg: G.red }
    : routeState === 'recalculating' ? { text: 'Rerouting…', color: G.ink2, bg: '#fff' }
    : routeState === 'local' ? { text: `Route service unreachable${route ? `, last route ${routeAgo}` : ''}. Estimates only.`, color: G.amber, bg: G.amberBg }
    : null;

  const call = () => { if (target.phone) Linking.openURL(`tel:${target.phone.replace(/[^0-9+]/g, '')}`).catch(() => {}); };
  const openMaps = () => Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${target.lat},${target.lng}&travelmode=driving`).catch(() => {});

  return (
    <View style={{ flex: 1, backgroundColor: '#e8eaed' }}>
      <WebView
        ref={web}
        source={{ html: NAV_MAP_HTML, baseUrl: 'https://odds.local/' }}
        style={{ flex: 1, backgroundColor: '#e8eaed' }}
        javaScriptEnabled
        domStorageEnabled
        originWhitelist={['*']}
        mixedContentMode="always"
        setSupportMultipleWindows={false}
        bounces={false}
        overScrollMode="never"
        pullToRefreshEnabled={false}
        allowsBackForwardNavigationGestures={false}
        textZoom={100}
        setBuiltInZoomControls={false}
        androidLayerType="hardware"
        onMessage={(e) => {
          try {
            const m = JSON.parse(e.nativeEvent.data);
            if (m.type === 'loaded') { send({ type: 'init', dest: { lat: target.lat, lng: target.lng, name: target.clientName.split(' ')[0] }, stale: stale.stale }); }
            else if (m.type === 'ready') setMapReady(true);
            else if (m.type === 'drag') setFollowing(false);
            else if (m.type === 'error') setMapError(String(m.message ?? 'map error'));
          } catch { /* not ours */ }
        }}
      />

      {/* ---- Top: the turn banner while navigating, the client card before */}
      <View style={{ position: 'absolute', left: 12, right: 12, top: insets.top + 8 }} pointerEvents="box-none">
        {navigating ? (
          <View style={{ borderRadius: 18, backgroundColor: G.teal, ...shadow, overflow: 'hidden' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingHorizontal: 16 }}>
              <View style={{ alignItems: 'center', width: 64 }}>
                <Icon path={ARROWS[bannerKind]} size={44} color="#fff" strokeWidth={2.6} />
                <Text style={{ fontFamily: F.bodyBold, fontSize: 22, color: '#fff', marginTop: 2 }}>{bannerDist.replace(/ (m|km)$/, '')}<Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.85)' }}> {bannerDist.endsWith('km') ? 'km' : 'm'}</Text></Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text numberOfLines={2} style={{ fontFamily: F.bodySemi, fontSize: 24, lineHeight: 29, color: '#fff' }}>{bannerText}</Text>
                {bannerSub && bannerSub !== bannerText ? <Text numberOfLines={1} style={{ fontFamily: F.body, fontSize: 13, color: 'rgba(255,255,255,0.8)', marginTop: 2 }}>{bannerSub}</Text> : null}
              </View>
            </View>
            {maneuver?.then && !atPin ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 16, backgroundColor: G.tealDark }}>
                <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: 'rgba(255,255,255,0.9)' }}>Then</Text>
                <Icon path={ARROWS[maneuver.then.kind]} size={20} color="#fff" strokeWidth={2.4} />
                {maneuver.then.street ? <Text numberOfLines={1} style={{ fontFamily: F.body, fontSize: 13, color: 'rgba(255,255,255,0.9)', flex: 1 }}>{maneuver.then.street}</Text> : null}
              </View>
            ) : null}
          </View>
        ) : (
          <View style={{ borderRadius: 18, backgroundColor: '#fff', ...shadow, padding: 14, gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Pressable onPress={confirmExit} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back" style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F1F3F4' }}>
                <Icon name="arrowLeft" size={16} color={G.ink2} strokeWidth={2.3} />
              </Pressable>
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ fontFamily: F.bodyBold, fontSize: 20, color: G.ink }}>{target.clientName}</Text>
                <Text numberOfLines={1} style={{ fontFamily: F.body, fontSize: 13, color: G.muted, marginTop: 1 }}>{target.address ?? 'Client home pin'}</Text>
              </View>
              {target.phone ? (
                <Pressable onPress={call} hitSlop={8} accessibilityRole="button" accessibilityLabel="Call the client" style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: hexA(G.green, 0.12) }}>
                  <Icon name="phone" size={16} color={G.green} strokeWidth={2.2} />
                </Pressable>
              ) : null}
            </View>
            {stale.stale ? (
              <View style={{ flexDirection: 'row', gap: 8, padding: 10, borderRadius: 10, backgroundColor: G.amberBg }}>
                <Icon name="alert" size={14} color={G.amber} strokeWidth={2.2} />
                <Text style={{ flex: 1, fontFamily: F.body, fontSize: 12, lineHeight: 16, color: G.amber }}>{stale.reason}</Text>
              </View>
            ) : null}
          </View>
        )}
        {statusLine ? (
          <View style={{ alignSelf: 'center', marginTop: 8, paddingVertical: 7, paddingHorizontal: 14, borderRadius: 999, backgroundColor: statusLine.bg, ...shadow, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {routeState === 'recalculating' ? <ActivityIndicator size={10} color={G.ink2} /> : null}
            <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: statusLine.color }}>{statusLine.text}</Text>
          </View>
        ) : mapError ? (
          <View style={{ alignSelf: 'center', marginTop: 8, paddingVertical: 7, paddingHorizontal: 14, borderRadius: 999, backgroundColor: G.amberBg, ...shadow }}>
            <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: G.amber }}>The map could not load. The turns and numbers still work.</Text>
          </View>
        ) : null}
      </View>

      {/* ---- Right: round controls */}
      {navigating && phase !== 'saving' ? (
        <View style={{ position: 'absolute', right: 12, top: insets.top + 160, gap: 12 }}>
          <RoundBtn path="M12 5v14M5 12h14" label="Zoom in" onPress={() => send({ type: 'zoom', delta: 1 })} />
          <RoundBtn path="M5 12h14" label="Zoom out" onPress={() => send({ type: 'zoom', delta: -1 })} />
          <RoundBtn path="M12 3l4 9-4 9-4-9zM12 3v18" label={cameraNorth ? 'Heading up' : 'North up'} active={cameraNorth} onPress={() => { const n = !cameraNorth; setCameraNorth(n); send({ type: 'camera', mode: n ? 'north' : 'heading' }); }} />
          <RoundBtn path={muted ? 'M11 5 6 9H3v6h3l5 4zM22 9l-6 6M16 9l6 6' : 'M11 5 6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13'} label={muted ? 'Unmute voice' : 'Mute voice'} tint={muted ? G.red : G.ink2} onPress={() => { const m = !muted; setMuted(m); if (m) speech.stop(); }} />
          <RoundBtn path="M6 20V9a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v11M6 20h12M12 6V3M9 3h6" label="Route overview" onPress={() => { setFollowing(false); send({ type: 'overview' }); }} />
          <RoundBtn name="map" label="Open in Google Maps" tint={G.blue} onPress={openMaps} />
        </View>
      ) : null}

      {/* ---- Re-centre pill */}
      {navigating && !following && phase !== 'saving' ? (
        <Pressable onPress={() => { setFollowing(true); send({ type: 'recenter' }); }} hitSlop={8} accessibilityRole="button"
          style={{ position: 'absolute', left: 16, bottom: insets.bottom + 112, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 999, backgroundColor: '#fff', ...shadow }}>
          <Icon path="M12 3l4 9-4 9-4-9z" size={16} color={G.teal} strokeWidth={2.2} fill={G.teal} />
          <Text style={{ fontFamily: F.bodySemi, fontSize: 15, color: G.teal }}>Re-centre</Text>
        </Pressable>
      ) : null}

      {/* ---- Bottom sheet */}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 12, paddingBottom: insets.bottom + 12, backgroundColor: G.sheet, borderTopLeftRadius: 22, borderTopRightRadius: 22, ...shadow, gap: 10 }}>
        {saveNote ? <Text style={{ fontFamily: F.body, fontSize: 12, color: G.amber, textAlign: 'center' }}>{saveNote}</Text> : null}
        {!navigating ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 30, color: G.green }}>{phase === 'locating' ? '—' : minText}<Text style={{ fontSize: 16 }}> min</Text></Text>
              <Text style={{ fontFamily: F.body, fontSize: 15, color: G.muted }}>{phase === 'locating' ? 'Finding your position…' : est ? `${kmText} · arrive ${arriveText}` : 'Fetching the route…'}</Text>
            </View>
            <Pressable onPress={start} disabled={phase !== 'ready'} hitSlop={6} accessibilityRole="button" accessibilityState={{ disabled: phase !== 'ready' }}
              style={({ pressed }) => ({ height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, backgroundColor: G.blue, opacity: phase !== 'ready' ? 0.5 : pressed ? 0.85 : 1 })}>
              <Icon path="M12 3l4 9-4 9-4-9z" size={16} color="#fff" strokeWidth={2.2} fill="#fff" />
              <Text style={{ fontFamily: F.bodyBold, fontSize: 16, color: '#fff' }}>Start</Text>
            </Pressable>
            {phase === 'locating' ? <Text style={{ fontFamily: F.body, fontSize: 11.5, color: G.muted, textAlign: 'center' }}>Move outdoors if you are inside. Starts when your position is found.</Text> : null}
          </>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Pressable onPress={() => { setMuted((m) => !m); if (!muted) speech.stop(); }} hitSlop={8} accessibilityRole="button" accessibilityLabel={muted ? 'Unmute' : 'Mute'}
              style={{ width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F1F3F4' }}>
              <Icon path={muted ? 'M11 5 6 9H3v6h3l5 4zM22 9l-6 6M16 9l6 6' : 'M11 5 6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13'} size={22} color={muted ? G.red : G.ink2} strokeWidth={2.2} />
            </Pressable>
            <View style={{ flex: 1, alignItems: 'center' }}>
              {atPin ? (
                <Pressable onPress={() => finish('arrived')} disabled={phase === 'saving'} hitSlop={6} accessibilityRole="button"
                  style={({ pressed }) => ({ alignSelf: 'stretch', height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: G.blue, opacity: phase === 'saving' ? 0.6 : pressed ? 0.85 : 1 })}>
                  {phase === 'saving' ? <ActivityIndicator color="#fff" /> : <Text style={{ fontFamily: F.bodyBold, fontSize: 16, color: '#fff' }}>Arrived</Text>}
                </Pressable>
              ) : (
                <>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 30, lineHeight: 34, color: approx ? G.amber : G.green }}>{minText}<Text style={{ fontSize: 16 }}> min</Text></Text>
                  <Text style={{ fontFamily: F.body, fontSize: 14, color: G.muted, marginTop: 1 }}>{kmText}{arriveText ? ` · ${arriveText}` : ''}</Text>
                </>
              )}
            </View>
            <Pressable onPress={confirmExit} disabled={phase === 'saving'} hitSlop={8} accessibilityRole="button" accessibilityLabel="Exit navigation"
              style={({ pressed }) => ({ height: 52, paddingHorizontal: 20, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: G.red, opacity: pressed ? 0.85 : 1 })}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 16, color: '#fff' }}>Exit</Text>
            </Pressable>
          </View>
        )}
        {navigating && savesRide(target) ? (
          <Text style={{ fontFamily: F.body, fontSize: 11, color: !online || publisher.current?.isStopped ? G.amber : G.muted, textAlign: 'center' }}>
            {publisher.current?.isStopped
              ? (publisher.current.reason === 'ended' ? 'The office closed this ride. Your route and record are still saved.' : 'This ride is not shared with the office.')
              : !online ? 'Offline. The office keeps your last position until the connection is back.'
              : share === 'service' ? 'Sharing your ride with the Odds office, also with the screen locked, until you tap Arrived or Exit.'
              : 'Sharing your position with the Odds office while this screen is open.'}
          </Text>
        ) : null}
        <Text style={{ fontFamily: F.body, fontSize: 9.5, color: '#9AA0A6', textAlign: 'center', marginTop: -2 }}>Map © OpenStreetMap contributors · OpenFreeMap{routeState === 'ok' && route ? ` · route ${routeAgo}` : ''}</Text>
      </View>
    </View>
  );
}
