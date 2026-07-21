import React from 'react';
import { View, Text, Pressable, Linking, Platform, AppState, AppStateStatus } from 'react-native';
import Constants from 'expo-constants';
import { useQuery } from '@tanstack/react-query';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono } from './primitives';
import { supabase } from '../lib/supabase';

/* ============ Force-update gate ============
   Compares this binary's build number against app_version_requirements
   (min_version_code per platform). Older build → hard full-screen blocker with
   an "Update Now" store link; no bypass. FAIL-OPEN: if the row can't be read
   (offline, table missing) the app runs normally — but the query cache is
   persisted, so a previously-seen requirement still enforces offline. */

const installedBuild = (): number => {
  const cfg: any = Constants.expoConfig ?? {};
  const raw = Platform.OS === 'ios' ? cfg.ios?.buildNumber : cfg.android?.versionCode;
  const n = parseInt(String(raw ?? ''), 10);
  return isFinite(n) ? n : 0;
};

type Requirement = { min_version_code: number; store_url: string; message: string | null };

export function UpdateGate({ children }: { children: React.ReactNode }) {
  const reqQ = useQuery({
    queryKey: ['app-version-requirement', Platform.OS],
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<Requirement | null> => {
      const { data, error } = await supabase
        .from('app_version_requirements')
        .select('min_version_code, store_url, message')
        .eq('platform', Platform.OS === 'ios' ? 'ios' : 'android')
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as Requirement) ?? null;
    },
  });

  // Re-check when the app returns to the foreground (catches new requirements fast).
  React.useEffect(() => {
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active') reqQ.refetch();
    });
    return () => sub.remove();
  }, []);

  const req = reqQ.data;
  const current = installedBuild();
  const mustUpdate = !!req && current > 0 && current < req.min_version_code;

  if (!mustUpdate) return <>{children}</>;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', padding: 30, gap: 16 }}>
      <View style={{ width: 74, height: 74, borderRadius: 26, backgroundColor: hexA(C.orange, 0.12), borderWidth: 1, borderColor: hexA(C.orange, 0.35), alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="trend" size={32} color={C.orange} strokeWidth={1.9} />
      </View>
      <Serif style={{ fontSize: 23, textAlign: 'center' }}>Update Required</Serif>
      <Body style={{ fontSize: 13.5, color: C.muted, textAlign: 'center', lineHeight: 20, maxWidth: 320 }}>
        {req?.message || 'A new version of Odds is available. Please update to continue.'}
      </Body>
      <Mono style={{ fontSize: 9, letterSpacing: 0.8, color: C.muted3 }}>
        INSTALLED v{current} · REQUIRED v{req?.min_version_code}
      </Mono>
      <Pressable
        onPress={() => { if (req?.store_url) Linking.openURL(req.store_url).catch(() => {}); }}
        style={{ width: '100%', maxWidth: 320, alignItems: 'center', paddingVertical: 14, borderRadius: 14, backgroundColor: hexA(C.orange, 0.16), borderWidth: 1, borderColor: hexA(C.orange, 0.5) }}
      >
        <Text style={{ fontFamily: F.bodyBold, fontSize: 14.5, color: C.orange }}>Update Now</Text>
      </Pressable>
    </View>
  );
}
