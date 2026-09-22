import React from 'react';
import { View, ActivityIndicator, Image, Dimensions } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useFonts } from 'expo-font';
import { QueryClient, defaultShouldDehydrateQuery } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import Storage from 'expo-sqlite/kv-store';
import { StoreProvider } from './src/store';
import { registerTeardown } from './src/lib/sessionTeardown';
import { AuthProvider } from './src/auth';
import { Router } from './src/Router';
import { initOffline } from './src/lib/offline';
import { C } from './src/theme';

/* Offline-first: cached data renders immediately (and is all you get offline);
   fetches pause while disconnected and resume on reconnect instead of erroring.
   Live-by-default: every query silently re-polls while its screen is open and
   refetches on screen mount / app foreground, so no page needs a manual refresh
   (realtime table events in liveSync.tsx push updates even sooner). */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      gcTime: 7 * 24 * 60 * 60 * 1000, // keep for the persisted-cache window
      networkMode: 'offlineFirst',
      refetchOnReconnect: true,
      // 'always' refetched every query on every navigation (screens remount);
      // `true` honours staleTime so a screen revisited within 30 s does not refetch.
      refetchOnMount: true,
      refetchOnWindowFocus: true,
      // No global poll: it fired 35-45 requests a minute on the CRM workspace and
      // re-ran the heavy reducers on every tick. Live data comes from realtime
      // (liveSync TABLE_KEYS) and the ~25 hooks that opt in to their own interval.
    },
    mutations: { networkMode: 'offlineFirst' },
  },
});

// Query cache persisted to SQLite (expo-sqlite kv-store) — the app opens with
// the last-synced data even with no connection.
// throttleTime: the persister JSON.stringify-es the WHOLE dehydrated cache on the
// JS thread — 1 s (the default) was a stutter source while data streams in.
const cachePersister = createAsyncStoragePersister({ storage: Storage, key: 'rq-cache:v1', throttleTime: 5_000 });

/* Persist ALLOW-LIST (first query-key segment, exact or prefix): the small,
   offline-critical data — dashboards, rosters, client basics, plans, identity,
   chat lists. Heavy/derived payloads (session histories with AI blobs, full QHP
   json, 1000-row exercise history, month rosters) are fetched on demand instead of
   being serialized on every cache event and parsed on every cold start. */
const PERSIST_PREFIXES = [
  'trainer-', 'my-', 'client-', 'exercise-db', 'plan-', 'approved-plans', 'modality-gate', 'sidebar-profile', 'nav-badges', 'chat-overview',
  'physio-hod-identity', 'doctor-', 'therapist-', 'therapy-', 'manager-', 'mgr-', 'hod-teams', 'app-version-requirement', 'play-store-version',
  'crm-client-list', 'crm-client-detail', 'crm-metrics', 'crm-journey-clients', 'crm-tasks', 'crm-my-tasks', 'coach-clients-overview', 'coach-overview-client',
  'academy-', 'admin-', 'ops-',
];
const NEVER_PERSIST = new Set(['client-sessions', 'client-reports', 'prev-exercise-data', 'session-exercises', 'crm-month-roster', 'head-doctor-month-sessions', 'hod-feed-msgs', 'doctor-day-sessions']);

// Sign-out / account switch: drop every cached query (memory AND the persisted
// SQLite copy) so the next user can never see the previous user's data.
registerTeardown(async () => {
  queryClient.clear();
  await cachePersister.removeClient();
});

initOffline(queryClient);

export default function App() {
  // Screen-capture lockdown moved into the Router (route-aware): screenshots
  // are blocked everywhere EXCEPT each role's home dashboard, so store
  // screenshots of the home page can be taken while client data stays covered.
  // Brand type: Geogrotesque (Emtype) for all UI/body text; Gradvis-Regular for
  // display/hero headlines. These are TRIAL cuts — license Geogrotesque from
  // Emtype and Gradvis from its foundry before any commercial release.
  // When the Gradvis file arrives, drop Gradvis-Regular.otf into assets/fonts,
  // add it here, and point F.serif/F.serifSemi at it in src/theme.ts.
  const [loaded] = useFonts({
    'Geogrotesque-Light': require('./assets/fonts/GeogrotesqueTRIAL-Lt.otf'),
    'Geogrotesque-LightItalic': require('./assets/fonts/GeogrotesqueTRIAL-LtIt.otf'),
    'Geogrotesque-Regular': require('./assets/fonts/GeogrotesqueTRIAL-Rg.otf'),
    'Geogrotesque-Italic': require('./assets/fonts/GeogrotesqueTRIAL-RgIt.otf'),
    'Geogrotesque-Medium': require('./assets/fonts/GeogrotesqueTRIAL-Md.otf'),
    'Geogrotesque-MediumItalic': require('./assets/fonts/GeogrotesqueTRIAL-MdIt.otf'),
    'Geogrotesque-SemiBold': require('./assets/fonts/GeogrotesqueTRIAL-SmBd.otf'),
    'Geogrotesque-SemiBoldItalic': require('./assets/fonts/GeogrotesqueTRIAL-SmBdIt.otf'),
    'Geogrotesque-Bold': require('./assets/fonts/GeogrotesqueTRIAL-Bd.otf'),
    'Geogrotesque-BoldItalic': require('./assets/fonts/GeogrotesqueTRIAL-BdIt.otf'),
  });

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <SafeAreaProvider>
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        {/* Branded ambient background: a huge, faint orange Odds mark bleeding off the
            top-right, over a whisper of warm glow — same mood as before, but branded. */}
        <LinearGradient
          colors={['rgba(242,107,26,0.07)', 'rgba(242,107,26,0.02)', C.bg]}
          locations={[0, 0.3, 0.6]}
          style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
        />
        <Image
          source={require('./assets/odds-mark.png')}
          resizeMode="contain"
          style={{
            position: 'absolute',
            width: Dimensions.get('window').width * 1.15,
            height: Dimensions.get('window').width * 0.95,
            top: Dimensions.get('window').height / 2 - (Dimensions.get('window').width * 0.95) / 2,
            left: Dimensions.get('window').width * -0.075,
            opacity: 0.055,
          }}
        />
        <StatusBar style="light" />
        {loaded ? (
          <PersistQueryClientProvider
            client={queryClient}
            persistOptions={{
              persister: cachePersister,
              maxAge: 7 * 24 * 60 * 60 * 1000,
              buster: 'v3', // bumped: the allow-list below changes what is persisted — start every device clean
              // Never persist a query whose data is a Map/Set: JSON.stringify(new Map())
              // === '{}', so it rehydrates as a plain {} with no .get/.has and the next
              // Map/Set method call throws "undefined is not a function" (crashed the CRM
              // home banner). Skipped queries simply refetch on mount (refetchOnMount:
              // 'always'), so nothing is lost — they were only ever persisted as corrupt.
              dehydrateOptions: {
                shouldDehydrateQuery: (query) => {
                  const d = query.state.data;
                  if (d instanceof Map || d instanceof Set) return false;
                  const k0 = String(query.queryKey[0] ?? '');
                  if (NEVER_PERSIST.has(k0)) return false;
                  if (!PERSIST_PREFIXES.some((p) => k0 === p || k0.startsWith(p))) return false;
                  if (Array.isArray(d) && d.length > 400) return false; // never persist a silently 1000-row-capped list
                  return defaultShouldDehydrateQuery(query);
                },
              },
            }}
          >
            <AuthProvider>
              <StoreProvider>
                <Router />
              </StoreProvider>
            </AuthProvider>
          </PersistQueryClientProvider>
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={C.orange} />
          </View>
        )}
      </View>
    </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
