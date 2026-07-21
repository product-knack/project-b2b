import React from 'react';
import { View, ActivityIndicator, Image, Dimensions } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useFonts } from 'expo-font';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import Storage from 'expo-sqlite/kv-store';
import { StoreProvider } from './src/store';
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
      refetchOnMount: 'always',
      refetchOnWindowFocus: true,
      refetchInterval: 60_000,
      refetchIntervalInBackground: false,
    },
    mutations: { networkMode: 'offlineFirst' },
  },
});

// Query cache persisted to SQLite (expo-sqlite kv-store) — the app opens with
// the last-synced data even with no connection.
const cachePersister = createAsyncStoragePersister({ storage: Storage, key: 'rq-cache:v1' });

initOffline(queryClient);

export default function App() {
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
            persistOptions={{ persister: cachePersister, maxAge: 7 * 24 * 60 * 60 * 1000, buster: 'v1' }}
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
