import { Platform } from 'react-native';
import * as ScreenCapture from 'expo-screen-capture';
import Constants from 'expo-constants';
import { supabase } from './supabase';
import { enqueueOutbox, getIsOnline } from './offline';

/* ============ Screenshot audit trail ============
   Whenever the OS reports a screenshot of the app, one row is written to
   screenshot_events: who (auth.uid), when (device clock — survives offline
   replay), which screen, platform, app version.

   Coverage honesty (OS limits, not ours):
   - Home dashboards (capture allowed): detected on both platforms.
   - iOS: detected on EVERY screen — the secure view blanks the image but the
     OS still fires the notification.
   - Android 14+: the modern detection API reports screenshots of the app with
     no permission needed.
   - Android 13 and older: a FLAG_SECURE-blocked attempt produces NO OS signal
     at all, and successful-capture detection needs the media-images permission
     — we listen only if it was already granted, never prompt for it. */

export type ScreenshotLogPayload = {
  profileId: string; route: string; platform: string;
  appVersion: string | null; takenAt: string;
};

/* Plain submit — used directly AND by the offline outbox drainer. */
export async function submitScreenshotLog(p: ScreenshotLogPayload) {
  const { error } = await supabase.from('screenshot_events').insert({
    profile_id: p.profileId, route: p.route, platform: p.platform,
    app_version: p.appVersion, taken_at: p.takenAt,
  });
  if (error) throw new Error(error.message);
}

export async function logScreenshot(profileId: string, route: string) {
  const payload: ScreenshotLogPayload = {
    profileId, route,
    platform: Platform.OS,
    appVersion: (Constants.expoConfig as any)?.version ?? null,
    takenAt: new Date().toISOString(),
  };
  try {
    if (!getIsOnline()) {
      await enqueueOutbox('screenshot-log', 'Screenshot event', payload, { autoDrain: false });
      return;
    }
    await submitScreenshotLog(payload);
  } catch {
    // Table missing / network blip / RLS — queue and move on, never disturb the UI.
    await enqueueOutbox('screenshot-log', 'Screenshot event', payload).catch(() => {});
  }
}

/* Can this device tell us about screenshots at all? (see coverage notes above) */
export async function canListenForScreenshots(): Promise<boolean> {
  if (Platform.OS === 'ios') return true;
  if (Platform.OS === 'android' && Number(Platform.Version) >= 34) return true;
  try {
    const p = await (ScreenCapture as any).getPermissionsAsync?.();
    return !!p?.granted;
  } catch { return false; }
}

export const addScreenshotListener = (cb: () => void) => ScreenCapture.addScreenshotListener(cb);
