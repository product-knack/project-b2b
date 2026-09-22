import React from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useAuth } from '../auth';
import { safeDeviceTokenUpsert, resetDeviceTokenCache, setPendingDeviceToken, consumePendingDeviceToken, getLastKnownToken } from '../lib/pushToken';
import { useStore, homeRouteFor } from '../store';

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

// What the user is looking at right now, mirrored at module level because the
// notification handler below runs outside React. A Tech Desk push about the very
// ticket already open on screen is noise: realtime is updating that screen anyway.
const viewing: { route: string | null; ticketId: string | null } = { route: null, ticketId: null };
const TICKET_ROUTES = new Set(['tech-desk-ticket', 'tech-desk-inbox-ticket']);

// Foreground notifications: show banner + play sound while the app is open.
Notifications.setNotificationHandler({
  handleNotification: async (n) => {
    const d: any = n?.request?.content?.data ?? {};
    const onThisTicket = d?.type === 'tech_ticket' && !!d.ticket_id
      && viewing.ticketId === String(d.ticket_id) && TICKET_ROUTES.has(viewing.route ?? '');
    if (onThisTicket) return { shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false };
    return { shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true };
  },
});

// Process-wide (not per mount): this manager remounts on every sign-out/sign-in
// and LocationGate flip, and a per-mount flag replayed the launch tap each time.
let coldStartHandled = false;
// Consume the tap so no later mount (or the next signed-in user) can replay it.
const clearLastResponse = () => {
  const fn = (Notifications as any).clearLastNotificationResponseAsync;
  if (typeof fn === 'function') fn().catch(() => {});
};

export function PushTokenManager() {
  const { session, dbRole } = useAuth();
  const uid = session?.user?.id ?? null;
  const askedRef = React.useRef(false);
  const { go, set, setOpenChat, role, route, selectedTicketId } = useStore();
  const roleRef = React.useRef(role); roleRef.current = role;
  const dbRoleRef = React.useRef(dbRole); dbRoleRef.current = dbRole;
  // Keep the foreground-suppression mirror current.
  React.useEffect(() => { viewing.route = route; viewing.ticketId = selectedTicketId; }, [route, selectedTicketId]);

  // ---- Tap → deep link (all dashboards) ----
  // Chat pushes carry conversation_id → open that exact thread in Messenger.
  // Session/roster alerts land on the ROLE's home (the roster lives there for
  // every role) — 'home' itself is not a route, so it must be resolved here.
  const routeFromNotification = React.useCallback((data: any) => {
    if (!data || typeof data !== 'object') return;
    const convId = data.conversation_id ? String(data.conversation_id) : null;
    if (convId) { setOpenChat(convId); go('messenger'); return; }
    const t = String(data.type ?? '');
    // Tech Desk: open the exact ticket on MY side of it. The screen is decided by
    // my role, not by the payload, so a staff member who also raised the ticket
    // still lands on the console. Opening stamps the seen marker, clearing the badge.
    if (t === 'tech_ticket' && data.ticket_id) {
      const r = dbRoleRef.current;
      const staff = r === 'tech' || r === 'admin';
      set({ selectedTicketId: String(data.ticket_id) });
      go(staff ? 'tech-desk-inbox-ticket' : 'tech-desk-ticket');
      return;
    }
    // Revenue-forecast pushes carry the web route — land the CRM on their list.
    if (t === 'priority_assigned' || t === 'priority_remark_due' || data.route === '/crm/revenue-forecast') { go('crm-revenue-forecast'); return; }
    // 7 PM team-flags push → straight into the manager chat.
    if (t === 'manager_team_flags' || data.route === 'manager-chat') { go('manager-chat'); return; }
    // Anything else that names a route/session (unknown web routes included) → home.
    // plan_expiry lands on the trainer's home too: the roster cards there carry the
    // same amber "N d left" strips the push is about.
    if (t === 'far_session_alert' || t === 'longevity_message' || t === 'plan_expiry' || data.route || data.session_id) go(homeRouteFor(roleRef.current));
  }, [go, set, setOpenChat]);
  // Android FCM notification-messages tapped from background/kill sometimes
  // carry the data on the trigger's remoteMessage instead of content.data —
  // merge both so conversation_id is never missed.
  const extractPushData = (resp: Notifications.NotificationResponse | null): any => {
    if (!resp) return null;
    const content: any = resp.notification?.request?.content ?? {};
    const trigger: any = resp.notification?.request?.trigger ?? {};
    const remote = trigger?.remoteMessage?.data ?? trigger?.payload ?? {};
    return { ...(remote || {}), ...(content.data || {}) };
  };
  React.useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
      routeFromNotification(extractPushData(resp));
      clearLastResponse();
    });
    // Cold start: the app was launched BY tapping a notification — the listener
    // above never fires for it, so replay the launching response ONCE per process.
    // (The Router consumes chat-push launches before sign-in and clears them, so
    // this only ever sees non-chat launches.)
    if (!coldStartHandled) {
      coldStartHandled = true;
      Notifications.getLastNotificationResponseAsync()
        .then((resp) => { if (resp) { routeFromNotification(extractPushData(resp)); clearLastResponse(); } })
        .catch(() => {});
    }
    return () => sub.remove();
  }, [routeFromNotification]);

  // Android notification channel (required for heads-up display on 8+).
  React.useEffect(() => {
    if (Platform.OS !== 'android') return;
    Notifications.setNotificationChannelAsync('default', {
      name: 'Odds notifications',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#F97316',
    }).catch(() => {});
    // Longevity Team alerts — the B2C 2-minute reply commitment. The LONG
    // vibration lives on the NOTIFICATION CHANNEL, so it fires even with the
    // app killed / phone locked (~30s of buzz-pause cycles). The server's
    // longevity push targets this channel via channel_id.
    // Tech Desk gets its own channel so it can be muted without muting chat.
    Notifications.setNotificationChannelAsync('tech-desk', {
      name: 'Tech Desk',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 200, 150, 200],
      lightColor: '#5CE1E6',
      sound: 'default',
    }).catch(() => {});
    // Chat message pushes — the shared B2C send-chat-notification fn targets
    // channel_id 'chat_messages'; register it so delivery/heads-up is reliable.
    Notifications.setNotificationChannelAsync('chat_messages', {
      name: 'Chat messages',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#F97316',
      sound: 'default',
    }).catch(() => {});
    Notifications.setNotificationChannelAsync('longevity-alerts', {
      name: 'Longevity Team messages',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, ...Array.from({ length: 18 }, (_, i) => (i % 2 === 0 ? 1000 : 700))],
      lightColor: '#E11D48',
      sound: 'default',
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
