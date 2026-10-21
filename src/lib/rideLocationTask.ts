/* Ride location service (21 Oct 2026, owner: "track the assessor live in the Leads
   dashboard, also while the screen is locked"). While a ride runs, the GPS comes from an
   expo-location background task bound to an Android foreground service (a persistent
   "Odds is sharing your ride" notification), so fixes keep arriving with the phone locked
   or another app in front, and the office feed keeps moving. The service is started from
   the Start tap (Android only allows it while the app is in front), stopped at Arrived /
   Exit and when the screen unmounts.
   Permissions: only the while-in-use location permission. A foreground service of type
   location keeps receiving fixes in the background on Android 10+ without
   ACCESS_BACKGROUND_LOCATION (expo-location skips the background check when
   `foregroundService` is given). The manifest carries FOREGROUND_SERVICE and
   FOREGROUND_SERVICE_LOCATION (Android 14 needs the second). iOS: the same call keeps
   updates in the background once UIBackgroundModes carries `location` (the iOS repo's
   app.json: isIosBackgroundLocationEnabled), with "When In Use" only; nothing here asks
   for "Always".
   This module is imported from index.ts so the task is defined before any start. */
import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';

export const RIDE_LOCATION_TASK = 'odds-ride-location';

type FixListener = (locations: Location.LocationObject[]) => void;
let listener: FixListener | null = null;

/** The navigation screen registers itself here while a ride runs; null when it leaves. */
export function setRideFixListener(l: FixListener | null) { listener = l; }

TaskManager.defineTask(RIDE_LOCATION_TASK, async ({ data, error }) => {
  if (error || !data) return;
  const locs = (data as { locations?: Location.LocationObject[] }).locations ?? [];
  if (locs.length && listener) listener(locs);
});

/** 'service': fixes keep coming with the screen locked. 'screen': the service could not start
    (an old Android build without the permission, or iOS without the background mode), the
    screen watch carries on while it is open. */
export type RideServiceState = 'service' | 'screen';

export const rideNotificationTitle = (shared: boolean) => (shared ? 'Odds is sharing your ride' : 'Odds navigation');
export const rideNotificationBody = (clientName: string, shared: boolean) =>
  shared
    ? `Riding to ${clientName}. The Odds office follows your position until you tap Arrived or Exit.`
    : `Riding to ${clientName}. Navigation keeps running with the screen locked until you tap Arrived or Exit.`;

/** Start the foreground location service for a ride. Never throws. */
export async function startRideService(clientName: string, shared: boolean): Promise<RideServiceState> {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(RIDE_LOCATION_TASK)) await Location.stopLocationUpdatesAsync(RIDE_LOCATION_TASK);
    await Location.startLocationUpdatesAsync(RIDE_LOCATION_TASK, {
      accuracy: Location.Accuracy.BestForNavigation,
      timeInterval: 1000,
      distanceInterval: 0,
      activityType: Location.ActivityType.AutomotiveNavigation,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: rideNotificationTitle(shared),
        notificationBody: rideNotificationBody(clientName, shared),
        notificationColor: '#F97316',
        killServiceOnDestroy: true,
      },
    });
    return 'service';
  } catch (e: any) {
    if (__DEV__) console.log('[ride-service] start failed', e?.message ?? e);
    return 'screen';
  }
}

export async function stopRideService() {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(RIDE_LOCATION_TASK)) await Location.stopLocationUpdatesAsync(RIDE_LOCATION_TASK);
  } catch { /* nothing to stop */ }
}
