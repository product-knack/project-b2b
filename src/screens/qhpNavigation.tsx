/* QHP navigation (14 Oct 2026, owner: "a Start navigation button on the upcoming QHP
   cards, Uber-style live tracking to the client's pin, only when clients.brb_location
   exists"). Night map in a WebView (CARTO dark tiles on OpenStreetMap data), the
   planned route from the roster-distance function (Google, server key), the phone's
   GPS every few seconds in the foreground, the Odds bike marker, and the ride saved
   as coach_assessment.navigation_track at Arrived / End.
   One obvious action per moment: Start before moving, the map while moving, Arrived
   at the pin. Calm: a thin dark layer over the map, no decoration.
   States: finding GPS, ready, navigating, off route (recalculating), route service
   down (local estimate), at the pin, and a stale pin flag. No background location. */
import React from 'react';
import { View, Text, Pressable, ActivityIndicator, Alert, AppState, Linking, AccessibilityInfo } from 'react-native';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono } from '../components/primitives';
import { useStore } from '../store';
import { NAV_MAP_HTML } from '../lib/navMapHtml';
import { navTargetRef, fetchNavRoute, saveNavigationTrack, appVersionLabel, type NavTarget } from '../lib/qhpNavigationQueries';
import {
  type Fix, type LatLng, type RouteInfo, type TrackPoint, type Projection,
  projectOnRoute, isOffRoute, isArrived, estimateLeft, arrivalClock, agoText, shouldKeep, toPoint, headingFrom, isMoving,
  buildTrack, stalePin, haversineM, ROUTE_REFRESH_MS, ROUTE_MIN_GAP_MS,
} from '../lib/qhpNavigation';

type Phase = 'locating' | 'ready' | 'navigating' | 'arrived' | 'saving';
type RouteState = 'none' | 'ok' | 'recalculating' | 'local';
const ORANGE = C.orange;
const TRACK_KEY = (id: string) => `qhp-nav-track:${id}`;
const PARTIAL_SAVE_MS = 60_000;

function IconBtn({ name, color, label, onPress }: { name: any; color: string; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={10} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => ({ width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: hexA(color, pressed ? 0.26 : 0.14), borderWidth: 1, borderColor: hexA(color, 0.45) })}>
      <Icon name={name} size={15} color={color} strokeWidth={2.2} />
    </Pressable>
  );
}

function Chip({ text, color, spin }: { text: string; color: string; spin?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999, backgroundColor: hexA(color, 0.14), borderWidth: 1, borderColor: hexA(color, 0.5) }}>
      {spin ? <ActivityIndicator size={8} color={color} /> : <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color }} />}
      <Mono style={{ fontSize: 10, letterSpacing: 1.2, color }}>{text.toUpperCase()}</Mono>
    </View>
  );
}

function Num({ value, unit, label }: { value: string; unit: string; label: string }) {
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3 }}>
        <Text style={{ fontFamily: F.bodyBold, fontSize: 32, lineHeight: 36, color: '#fff', letterSpacing: -0.3 }}>{value}</Text>
        <Text style={{ fontFamily: F.bodySemi, fontSize: 15, color: C.ink3 }}>{unit}</Text>
      </View>
      <Mono style={{ fontSize: 10, letterSpacing: 1.4, color: C.mono, marginTop: 2 }}>{label}</Mono>
    </View>
  );
}

export function QhpNavigation() {
  const { back, canGoBack, go } = useStore();
  const insets = useSafeAreaInsets();
  const target = React.useRef<NavTarget | null>(navTargetRef.current).current;
  const web = React.useRef<WebView>(null);
  const [mapReady, setMapReady] = React.useState(false);
  const [phase, setPhase] = React.useState<Phase>('locating');
  const [routeState, setRouteState] = React.useState<RouteState>('none');
  const [route, setRoute] = React.useState<RouteInfo | null>(null);
  const [fix, setFix] = React.useState<Fix | null>(null);
  const [proj, setProj] = React.useState<Projection | null>(null);
  const [routeAgo, setRouteAgo] = React.useState<string>('');
  const [reduceMotion, setReduceMotion] = React.useState(false);
  const [permDenied, setPermDenied] = React.useState(false);
  const [saveNote, setSaveNote] = React.useState<string | null>(null);

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
  phaseRef.current = phase;
  routeRef.current = route;

  const pin: LatLng | null = target ? [target.lat, target.lng] : null;
  const stale = target ? stalePin(target.pinCapturedAt, target.pinMethod) : { stale: false, reason: null };

  const send = React.useCallback((m: any) => {
    web.current?.injectJavaScript(`window.__nav && window.__nav.apply(${JSON.stringify(m)}); true;`);
  }, []);

  // Reduce motion (system) also freezes the marker in the page.
  React.useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((r) => { if (alive) setReduceMotion(!!r); }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (r) => setReduceMotion(!!r));
    return () => { alive = false; sub.remove(); };
  }, []);
  React.useEffect(() => { if (mapReady) send({ type: 'motion', reduce: reduceMotion }); }, [mapReady, reduceMotion, send]);

  // Map init once the page is up, then replay the last fix (a fix that arrived before the
  // page loaded was sent into the void; without this a still phone shows no badge).
  React.useEffect(() => {
    if (!mapReady || !target) return;
    send({ type: 'init', dest: { lat: target.lat, lng: target.lng, name: target.clientName.split(' ')[0] }, stale: stale.stale });
    const f = prevFix.current;
    if (f) setTimeout(() => onFix(f), 150);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, target, stale.stale, send]);

  // GPS: foreground watch, every 2 s or 3 m.
  React.useEffect(() => {
    if (!target) return;
    let sub: Location.LocationSubscription | null = null;
    let alive = true;
    (async () => {
      try {
        let perm = await Location.getForegroundPermissionsAsync();
        if (!perm.granted && perm.canAskAgain) perm = await Location.requestForegroundPermissionsAsync();
        if (!perm.granted) { if (alive) setPermDenied(true); return; }
        // distanceInterval 0: a fix every 2 s even while standing still, so the map, the
        // projection and the recording keep ticking at a signal or before setting off.
        sub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.BestForNavigation, timeInterval: 2000, distanceInterval: 0 }, (p) => {
          if (!alive) return;
          const f: Fix = { t: p.timestamp || Date.now(), lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy ?? null, spd: p.coords.speed ?? null, heading: p.coords.heading ?? null };
          onFix(f);
        });
      } catch { if (alive) setPermDenied(true); }
    })();
    return () => { alive = false; sub?.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.assessmentId]);

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
    if (phaseRef.current === 'navigating' || phaseRef.current === 'arrived') {
      // Record the ride.
      const s = startMs.current ?? f.t;
      const last = points.current[points.current.length - 1] ?? null;
      if (shouldKeep(last, f, s)) {
        points.current.push(toPoint(f, s));
        if (points.current.length % 6 === 0) persistLocal();
      }
      // Arrival: at the pin, the Arrived action appears (never auto-closes).
      if (pin && isArrived(here, pin, f.acc) && phaseRef.current === 'navigating') {
        setPhase('arrived');
        send({ type: 'arrived' });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      }
      // Off route: a fresh route from here, rate limited; while waiting the line dims.
      if (r && pj && isOffRoute(pj, f.acc) && !routeInFlight.current && Date.now() - lastRouteCallAt.current > ROUTE_MIN_GAP_MS) {
        setRouteState('recalculating');
        send({ type: 'route', points: r.points, dim: true });
        refreshRoute(here, 'off-route');
      } else if (Date.now() - lastRouteCallAt.current > ROUTE_REFRESH_MS && !routeInFlight.current) {
        refreshRoute(here, 'periodic');
      }
      if (Date.now() - lastPartialSave.current > PARTIAL_SAVE_MS) { lastPartialSave.current = Date.now(); void partialSave(); }
    }
    // Map: the rider; alongIndex lets the page grey out the ridden part of the line.
    const alongIndex = pj && r ? nearestIndex(here, r.points) : null;
    send({ type: 'pos', lat: f.lat, lng: f.lng, heading: headingRef.current, moving: movingRef.current && phaseRef.current !== 'arrived', alongIndex, follow: phaseRef.current !== 'ready' });
  };

  const nearestIndex = (p: LatLng, pts: LatLng[]): number => {
    let bi = 0, bd = Infinity;
    for (let i = 0; i < pts.length; i++) { const d = haversineM(p, pts[i]); if (d < bd) { bd = d; bi = i; } }
    return bi;
  };

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
      send({ type: 'route', points: r.points, dim: false, overview: why === 'start' });
      // Project the last fix onto the new line at once (numbers lose the tilde, the badge and
      // the ridden part update) instead of waiting for the next GPS tick.
      const f = prevFix.current;
      if (f) { const pj = projectOnRoute([f.lat, f.lng], r.points); setProj(pj); send({ type: 'pos', lat: f.lat, lng: f.lng, heading: headingRef.current, moving: movingRef.current && phaseRef.current !== 'arrived', alongIndex: pj ? nearestIndex([f.lat, f.lng], r.points) : null, follow: phaseRef.current !== 'ready' && why !== 'start' }); }
    } catch {
      // The screen keeps working on the phone's own numbers; the line stays as it was.
      setRouteState('local');
      if (routeRef.current) send({ type: 'route', points: routeRef.current.points, dim: false });
    } finally {
      routeInFlight.current = false;
    }
  };

  // "Route updated N ago" ticks every 10 s.
  React.useEffect(() => {
    const t = setInterval(() => { if (routeRef.current) setRouteAgo(agoText(Date.now() - routeRef.current.fetchedAt)); }, 10_000);
    return () => clearInterval(t);
  }, []);

  const persistLocal = () => {
    if (!target || startMs.current == null) return;
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
  const routeAtStart = React.useRef<RouteInfo | null>(null);

  const partialSave = async () => {
    const t = currentTrack(null, null);
    if (!t || !target) return;
    try { await saveNavigationTrack(target.assessmentId, t); } catch { /* best effort while riding */ }
  };

  const start = async () => {
    if (!target || !fix || phase !== 'ready') return;
    startMs.current = Date.now();
    points.current = [toPoint(fix, startMs.current)];
    lastPartialSave.current = Date.now();
    setPhase('navigating');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    send({ type: 'start' });
    persistLocal();
    await refreshRoute([fix.lat, fix.lng], 'start');
    routeAtStart.current = routeRef.current;
  };

  const finish = async (endedBy: 'arrived' | 'ended') => {
    if (!target || finishing.current) return;
    finishing.current = true;
    setPhase('saving');
    send({ type: 'stop' });
    const t = currentTrack(endedBy, Date.now());
    try {
      if (t) {
        const res = await saveNavigationTrack(target.assessmentId, t, { final: true });
        setSaveNote(res === 'queued' ? 'Ride saved on this phone; it syncs when you are back online.' : null);
      }
      await AsyncStorage.removeItem(TRACK_KEY(target.assessmentId)).catch(() => {});
      if (endedBy === 'arrived') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      navTargetRef.current = null;
      canGoBack ? back() : go('qhp');
    } catch (e: any) {
      finishing.current = false;
      setPhase(endedBy === 'arrived' ? 'arrived' : 'navigating');
      Alert.alert('Could not save the ride', e?.message ?? 'Please try again.', [{ text: 'OK' }]);
    }
  };

  const confirmEnd = () => {
    if (phase === 'ready' || phase === 'locating') { navTargetRef.current = null; canGoBack ? back() : go('qhp'); return; }
    Alert.alert('End navigation?', 'The ride so far is saved with the QHP.', [
      { text: 'Keep going', style: 'cancel' },
      { text: 'End', style: 'destructive', onPress: () => finish('ended') },
    ]);
  };

  // Leaving the app pauses nothing (foreground only); on return the map recentres.
  React.useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') send({ type: 'recenter' }); });
    return () => sub.remove();
  }, [send]);

  if (!target) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 }}>
        <Body style={{ fontSize: 13, color: C.muted2, textAlign: 'center' }}>Nothing to navigate to. Open an upcoming QHP and tap Start navigation.</Body>
        <Pressable onPress={() => (canGoBack ? back() : go('qhp'))} hitSlop={10}><Text style={{ fontFamily: F.bodySemi, fontSize: 13.5, color: ORANGE }}>Back</Text></Pressable>
      </View>
    );
  }

  // ---- the numbers
  const here: LatLng | null = fix ? [fix.lat, fix.lng] : null;
  const est = here && pin ? estimateLeft(here, pin, route, proj) : null;
  const atPin = phase === 'arrived';
  const gapM = here && pin ? Math.round(haversineM(here, pin)) : null;
  const leftValue = !est ? '—' : atPin && gapM != null ? String(gapM) : est.km < 1 ? String(Math.round(est.km * 1000)) : `${est.local || routeState === 'local' ? '~' : ''}${est.km}`;
  const leftUnit = !est ? 'km' : atPin || est.km < 1 ? 'm' : 'km';
  const minValue = !est ? '—' : atPin ? '0' : `${est.local || routeState === 'local' || routeState === 'recalculating' ? '~' : ''}${est.min}`;
  const arriveValue = !est ? '—' : arrivalClock(Date.now(), atPin ? 0 : est.min);
  const [arriveHM, arriveAP] = arriveValue === '—' ? ['—', ''] : [arriveValue.replace(/\s?(AM|PM)$/, ''), (arriveValue.match(/(AM|PM)$/) ?? [''])[0]];

  const chip = permDenied ? { text: 'Location off', color: C.red }
    : phase === 'locating' ? { text: 'Finding you', color: C.gold, spin: true }
    : phase === 'saving' ? { text: 'Saving ride', color: C.gold, spin: true }
    : atPin ? { text: 'You are here', color: C.green }
    : routeState === 'recalculating' ? { text: 'Recalculating', color: C.gold, spin: true }
    : routeState === 'local' ? { text: 'Local estimate', color: C.muted }
    : phase === 'ready' ? { text: 'Ready', color: C.gold }
    : { text: 'Live', color: C.green };

  const note: { text: string; color: string } | null = permDenied
    ? { text: 'Location is off for Odds. Allow it in the phone settings, then come back.', color: C.red }
    : phase === 'locating' ? { text: 'Move outdoors if you are inside. The route loads as soon as your position is known.', color: C.gold }
    : atPin ? { text: `Within ${gapM ?? '—'} m of the pin. Tap Arrived when you are with the client.`, color: C.green }
    : routeState === 'recalculating' ? { text: 'Off the route. Recalculating from where you are.', color: C.gold }
    : routeState === 'local' ? { text: 'Running on the phone only: straight line times 1.35, at 22 km/h. The map still follows you.', color: C.muted2 }
    : stale.stale && phase === 'ready' ? { text: stale.reason!, color: C.gold }
    : null;

  const updLine = permDenied ? ''
    : phase === 'locating' ? 'WAITING FOR THE FIRST GPS FIX'
    : phase === 'ready' ? (fix?.acc != null ? `GPS ACCURACY ±${Math.round(fix.acc)} M` : 'GPS READY')
    : routeState === 'local' ? `ROUTE SERVICE UNREACHABLE${route ? ` · LAST ROUTE ${routeAgo.toUpperCase()}` : ''}`
    : route ? `ROUTE UPDATED ${routeAgo.toUpperCase()}` : 'FETCHING THE ROUTE';

  const call = () => { if (target.phone) Linking.openURL(`tel:${target.phone.replace(/[^0-9+]/g, '')}`).catch(() => {}); };
  const openMaps = () => Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${target.lat},${target.lng}&travelmode=driving`).catch(() => {});

  return (
    <View style={{ flex: 1, backgroundColor: '#0b0b0f' }}>
      <WebView
        ref={web}
        source={{ html: NAV_MAP_HTML, baseUrl: 'https://odds.local/' }}
        style={{ flex: 1, backgroundColor: '#0b0b0f' }}
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
        onMessage={(e) => {
          try {
            const m = JSON.parse(e.nativeEvent.data);
            if (m.type === 'loaded') setMapReady(true);
          } catch { /* not ours */ }
        }}
      />

      {/* Top card: a thin dark layer, the client first, then the three numbers */}
      <View style={{ position: 'absolute', left: 0, right: 0, top: 0, paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 10, backgroundColor: 'rgba(8,6,6,0.94)', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <IconBtn name="arrowLeft" color={C.ink3} label="Back" onPress={confirmEnd} />
          <View style={{ flex: 1 }} />
          <Chip text={chip.text} color={chip.color} spin={(chip as any).spin} />
          {target.phone ? <IconBtn name="phone" color={C.green} label="Call the client" onPress={call} /> : null}
          <IconBtn name="map" color={C.blue} label="Open in Google Maps" onPress={openMaps} />
        </View>
        <Serif numberOfLines={1} style={{ fontSize: 25, lineHeight: 29, marginTop: 10 }}>{target.clientName}</Serif>
        <Body numberOfLines={1} style={{ fontSize: 13, color: C.ink3, marginTop: 2 }}>{target.address ?? 'Client home pin'}</Body>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
          <Num value={leftValue} unit={leftUnit} label="LEFT" />
          <Num value={minValue} unit="min" label="TIME" />
          <Num value={arriveHM} unit={arriveAP} label="ARRIVE" />
        </View>
        {note ? (
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 7, marginTop: 10 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: note.color, marginTop: 5 }} />
            <Body style={{ flex: 1, fontSize: 12, lineHeight: 16, color: note.color }}>{note.text}</Body>
          </View>
        ) : null}
        {updLine ? <Mono style={{ fontSize: 10, letterSpacing: 1, color: C.muted3, marginTop: 9 }}>{updLine}</Mono> : null}
      </View>

      {/* Bottom bar: one action per moment */}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 12, paddingBottom: insets.bottom + 12, backgroundColor: 'rgba(8,6,6,0.94)', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)', alignItems: 'center', gap: 10 }}>
        {saveNote ? <Body style={{ fontSize: 11.5, color: C.gold, textAlign: 'center' }}>{saveNote}</Body> : null}
        {phase === 'locating' || phase === 'ready' ? (
          <>
            <Pressable onPress={start} disabled={phase !== 'ready'} hitSlop={10} accessibilityRole="button" accessibilityState={{ disabled: phase !== 'ready' }}
              style={({ pressed }) => ({ width: '100%', height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: ORANGE, opacity: phase !== 'ready' ? 0.45 : pressed ? 0.85 : 1 })}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: '#fff' }}>Start navigation</Text>
            </Pressable>
            {phase === 'ready' ? (
              <Pressable onPress={confirmEnd} hitSlop={10} accessibilityRole="button" style={{ paddingVertical: 6, paddingHorizontal: 12 }}><Text style={{ fontFamily: F.bodySemi, fontSize: 14, color: C.muted }}>Back</Text></Pressable>
            ) : <Body style={{ fontSize: 11, color: C.muted3 }}>Starts when your position is found</Body>}
          </>
        ) : phase === 'arrived' || phase === 'saving' ? (
          <>
            <Pressable onPress={() => finish('arrived')} disabled={phase === 'saving'} hitSlop={10} accessibilityRole="button"
              style={({ pressed }) => ({ width: '100%', height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: ORANGE, opacity: phase === 'saving' ? 0.6 : pressed ? 0.85 : 1 })}>
              {phase === 'saving' ? <ActivityIndicator color="#fff" /> : <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: '#fff' }}>Arrived</Text>}
            </Pressable>
            <Pressable onPress={confirmEnd} hitSlop={10} accessibilityRole="button" style={{ paddingVertical: 6, paddingHorizontal: 12 }}><Text style={{ fontFamily: F.bodySemi, fontSize: 14, color: C.muted }}>End navigation</Text></Pressable>
          </>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
            <Pressable onPress={() => send({ type: 'recenter' })} hitSlop={10} accessibilityRole="button" style={{ paddingVertical: 6, paddingHorizontal: 12 }}><Text style={{ fontFamily: F.bodySemi, fontSize: 14, color: C.ink3 }}>Recentre</Text></Pressable>
            <Pressable onPress={confirmEnd} hitSlop={10} accessibilityRole="button" style={{ paddingVertical: 6, paddingHorizontal: 12 }}><Text style={{ fontFamily: F.bodySemi, fontSize: 14, color: C.muted }}>End navigation</Text></Pressable>
          </View>
        )}
      </View>
    </View>
  );
}
