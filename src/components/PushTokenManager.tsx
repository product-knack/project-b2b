import React from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useAuth } from '../auth';
import { safeDeviceTokenUpsert, resetDeviceTokenCache, setPendingDeviceToken, consumePendingDeviceToken, getLastKnownToken } from '../lib/pushToken';

/* ============ Push notifications — permission + FCM token → odds_device_tokens ============
   Render-nothing manager mounted in the authed shell. Lifecycle (web parity):
   1. Signed-in user → ask notification permission ONCE (system popup; Android 13+
      shows the runtime dialog, older Androids auto-grant).
   2. On grant → native FCM device token via getDevicePushTokenAsync → safe upsert
      into odds_device_tokens (dedup/debounce/session-wait inside).
   3. Token refresh listener re-saves rotated tokens.
   4. Sign-out → resetDeviceTokenCache() so the next login re-writes.
   NOTE: on Android the FCM call needs google-services.json baked into the build —
   until then it throws and we silently skip (guarded), everything else unaffected. */

// Foreground notifications: show banner + play sound while the app is open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export function PushTokenManager() {
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;
  const askedRef = React.useRef(false);

  // Android notification channel (required for heads-up display on 8+).
  React.useEffect(() => {
    if (Platform.OS !== 'android') return;
    Notifications.setNotificationChannelAsync('default', {
      name: 'Odds notifications',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#F97316',
    }).catch(() => {});
  }, []);

  React.useEffect(() => {
    if (!uid) { resetDeviceTokenCache(); return; }
    let alive = true;

    (async () => {
      try {
        // 1. Permission — the popup the user grants once.
        let perm = await Notifications.getPermissionsAsync();
        if (perm.status !== 'granted' && (perm.canAskAgain || !askedRef.current)) {
          askedRef.current = true;
          perm = await Notifications.requestPermissionsAsync();
        }
        if (perm.status !== 'granted' || !alive) return;

        // 2. Pending / last-known first (web parity), then a fresh registration.
        const pending = consumePendingDeviceToken();
        if (pending) safeDeviceTokenUpsert(uid, pending);
        const last = getLastKnownToken();
        if (last) safeDeviceTokenUpsert(uid, last);

        // 3. Fresh native FCM (Android) / APNs (iOS) token.
        const dev = await Notifications.getDevicePushTokenAsync();
        const token = typeof dev.data === 'string' ? dev.data : null;
        if (token && alive) {
          setPendingDeviceToken(token); // keeps lastKnown fresh for user switches
          safeDeviceTokenUpsert(uid, token);
        }
      } catch (e: any) {
        // Most common cause: google-services.json not in the build yet — skip quietly.
        console.warn('[push] token registration skipped:', e?.message ?? e);
      }
    })();

    // 4. Token rotation → re-save.
    const sub = Notifications.addPushTokenListener((t) => {
      const token = typeof t.data === 'string' ? t.data : null;
      if (token) {
        setPendingDeviceToken(token);
        if (uid) safeDeviceTokenUpsert(uid, token);
      }
    });
    return () => { alive = false; sub.remove(); };
  }, [uid]);

  return null;
}
