import React from 'react';
import { View, Text, Pressable, ActivityIndicator, AppState, AppStateStatus, Linking } from 'react-native';
import * as Location from 'expo-location';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Serif, Body } from './primitives';
import { useAuth } from '../auth';
import { maybeCaptureLocation } from '../lib/locationLog';

/* Render-nothing trigger (mirrors <LiveSync />): on app open — session-ready and
   every AppState → 'active' — capture the trainer's location, throttled to once
   per CAPTURE_INTERVAL_HOURS inside maybeCaptureLocation. Only mounts in the
   authed shell, and only trainers are ever captured (role gate lives in the
   capture fn too, so this is safe regardless of where it renders). */
export function LocationCapture() {
  const { session, dbRole } = useAuth();
  const userId = session?.user?.id ?? null;
  // RAW profiles.role — the capture fn only runs for exactly 'trainer'. The coarse
  // app role collapses coach/doctor/admin → 'trainer', so we must NOT use it here.
  const rawRole = dbRole ?? null;

  // Fire when a logged-in session becomes available (app open while signed in).
  React.useEffect(() => {
    if (!userId) return;
    maybeCaptureLocation(userId, rawRole);
  }, [userId, rawRole]);

  // Fire again whenever the app returns to the foreground (also "app open").
  React.useEffect(() => {
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active' && userId) maybeCaptureLocation(userId, rawRole);
    });
    return () => sub.remove();
  }, [userId, rawRole]);

  return null;
}

/* ============ Location gate — TRAINERS & DOCTORS ============
   One system permission ask at app open ("Allow While Using App" / "Allow Always").
   If a trainer/doctor denies, the app is BLOCKED behind a full-screen prompt until
   location is granted. The OS only shows its popup once or twice — after that
   the button deep-links to the app's Settings page instead. Other roles
   and the signed-out state pass straight through. */
export function LocationGate({ children }: { children: React.ReactNode }) {
  const { session, dbRole, signOut } = useAuth();
  const isTrainer = !!session && (dbRole === 'trainer' || dbRole === 'doctor');
  const [status, setStatus] = React.useState<'checking' | 'granted' | 'blocked'>('checking');
  const [canAsk, setCanAsk] = React.useState(true);
  const askedOnce = React.useRef(false);

  const check = React.useCallback(async (ask: boolean) => {
    try {
      let perm = await Location.getForegroundPermissionsAsync();
      if (!perm.granted && ask && perm.canAskAgain) {
        askedOnce.current = true;
        perm = await Location.requestForegroundPermissionsAsync(); // the ONE system popup
      }
      setCanAsk(perm.canAskAgain);
      setStatus(perm.granted ? 'granted' : 'blocked');
    } catch {
      setStatus('blocked');
    }
  }, []);

  // App open (trainer session ready): auto-ask once if the OS still allows asking.
  React.useEffect(() => {
    if (!isTrainer) return;
    setStatus('checking');
    check(!askedOnce.current);
  }, [isTrainer]);

  // Returning from Settings (or anywhere): silently re-check — unblocks instantly.
  React.useEffect(() => {
    if (!isTrainer) return;
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => { if (s === 'active') check(false); });
    return () => sub.remove();
  }, [isTrainer, check]);

  if (!isTrainer || status === 'granted') return <>{children}</>;

  if (status === 'checking') {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={C.orange} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', padding: 30, gap: 16 }}>
      <View style={{ width: 74, height: 74, borderRadius: 26, backgroundColor: hexA(C.orange, 0.12), borderWidth: 1, borderColor: hexA(C.orange, 0.35), alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="pin" size={32} color={C.orange} strokeWidth={1.9} />
      </View>
      <Serif style={{ fontSize: 23, textAlign: 'center' }}>Location Access Required</Serif>
      <Body style={{ fontSize: 13.5, color: C.muted, textAlign: 'center', lineHeight: 20, maxWidth: 320 }}>
        {canAsk
          ? 'Odds needs your location to open. When prompted, choose “Allow While Using App” (or “Always Allow”).'
          : 'Location was denied. Enable location for Odds in your phone Settings, then come back — the app unlocks automatically.'}
      </Body>
      <Pressable
        onPress={() => (canAsk ? check(true) : Linking.openSettings())}
        style={{ alignSelf: 'stretch', maxWidth: 320, alignItems: 'center', paddingVertical: 14, borderRadius: 14, backgroundColor: hexA(C.orange, 0.16), borderWidth: 1, borderColor: hexA(C.orange, 0.5) }}
      >
        <Text style={{ fontFamily: F.bodyBold, fontSize: 14.5, color: C.orange }}>{canAsk ? 'Allow Location' : 'Open Settings'}</Text>
      </Pressable>
      <Pressable onPress={() => signOut()} hitSlop={8}>
        <Body style={{ fontSize: 12, color: C.muted3 }}>Sign out</Body>
      </Pressable>
    </View>
  );
}
