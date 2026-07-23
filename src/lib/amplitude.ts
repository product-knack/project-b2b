/* ============ Amplitude analytics + Session Replay (B2B staff app) ============
   Silent, background-only tracking — no UI, no consent popup. Event properties
   are METADATA ONLY: ids, screen names, roles, dimensions. Never message text,
   report content or form values on events.

   Session Replay: records screens for replay in Amplitude (text inputs are
   masked by the plugin's defaults). The plugin is a NATIVE module — it loads in
   dev/release builds (APK); in Expo Go the require fails and replay is skipped
   gracefully while base events keep working.

   Rules:
   - Client-side only (this whole app is client-side React Native).
   - init happens EXACTLY ONCE per app lifecycle (promise-guarded below).
   - Every export is try/catch-wrapped — analytics can never crash the app.
   - user id = the stable profiles.id (never email). */
import * as amplitude from '@amplitude/analytics-react-native';

const AMPLITUDE_API_KEY = '52df3a0d399779bf6e13f29ce4ece4c6';

// Native module — absent in Expo Go; lazy-required so the app never crashes there.
let SessionReplayPlugin: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  SessionReplayPlugin = require('@amplitude/plugin-session-replay-react-native').SessionReplayPlugin;
} catch { /* Expo Go / module unavailable — replay off, events still on */ }

// Single-init guard: concurrent/repeat calls all await the same promise.
let initPromise: Promise<void> | null = null;

export const initializeAmplitude = (): Promise<void> => {
  if (!AMPLITUDE_API_KEY) return Promise.resolve();
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      // The project is EU-residency (verified: US ingest 400s this key, EU 200s)
      // — the SDK must target the EU zone or every request is "Invalid API key".
      await amplitude.init(AMPLITUDE_API_KEY, undefined, { serverZone: 'EU' as any }).promise;
      if (SessionReplayPlugin) {
        try {
          // sampleRate 1 = capture EVERY session of EVERY user. enableRemoteConfig
          // false is CRITICAL: with it on (the default), the Amplitude dashboard's
          // replay sampling (0% until configured) silently overrides the local
          // 100% and nothing gets recorded.
          await amplitude.add(new SessionReplayPlugin({ sampleRate: 1, enableRemoteConfig: false, privacyConfig: { maskLevel: 'medium' } })).promise;
        } catch (e) { console.warn('[amplitude] session replay unavailable:', e); }
      }
    } catch (e) {
      console.warn('[amplitude] init failed:', e);
      initPromise = null; // allow a retry on next call
    }
  })();
  return initPromise;
};

/* Identity snapshot merged onto EVERY event (set by AnalyticsTracker) — so any
   call site in the app fires fully-detailed events without importing auth. */
let eventStamp: Record<string, any> = {};
export const setEventStamp = (stamp: Record<string, any>) => { eventStamp = stamp; };

export const trackEvent = (eventName: string, eventProperties?: Record<string, any>) => {
  if (!AMPLITUDE_API_KEY) return;
  try { amplitude.track(eventName, { ...eventStamp, ...eventProperties }); } catch { /* never crash */ }
};

/* Tab views inside a client detail page (any dashboard) — one shared event. */
export const trackClientTab = (screen: string, tab: string, client?: { id?: string | null; name?: string | null }) => {
  trackEvent('Client Tab Viewed', {
    screen_name: screen,
    tab,
    ...(client?.id ? { client_id: client.id } : {}),
    ...(client?.name ? { client_name: client.name } : {}),
  });
};

export const setUserProperties = (properties: Record<string, any>) => {
  if (!AMPLITUDE_API_KEY) return;
  try {
    const identify = new amplitude.Identify();
    Object.keys(properties).forEach((k) => { if (properties[k] != null) identify.set(k, properties[k]); });
    amplitude.identify(identify);
  } catch { /* never crash */ }
};

export const setAnalyticsUser = (userId: string | null, userInfo?: Record<string, any>) => {
  if (!AMPLITUDE_API_KEY) return;
  try {
    if (!userId) { amplitude.reset(); return; } // sign-out → detach identity
    amplitude.setUserId(userId);
    if (userInfo) setUserProperties(userInfo);
  } catch { /* never crash */ }
};
