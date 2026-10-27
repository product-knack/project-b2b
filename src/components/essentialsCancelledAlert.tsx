/* Essentials Auction: the client cancelled a session of mine (26 Oct 2026, owner: "after the auction, if a
   client's session was sold and the client cancels, push the trainer and show an alert on the dashboard").
   The server lists my cancelled sessions of the last 48 hours (get_my_essentials_cancellations); a card
   dismissed with Got it stays hidden on this device for that user (AsyncStorage, pruned to the rounds still
   served). Mounted on the trainer home and the physio's Doctor Dashboard next to the unsold alert. */
import React from 'react';
import { View, Text, Pressable } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono } from './primitives';
import { useAuth } from '../auth';
import { useMyEssentialsCancellations } from '../lib/essentialsAuctionQueries';
import { cancellationLine, istClock } from '../lib/essentialsAuction';

const ROSE = '#F06A8A';
const HOURS = 48;
const keyFor = (uid: string) => `essentials-cancelled-dismissed:${uid}`;

export function EssentialsCancelledAlert() {
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;
  const q = useMyEssentialsCancellations(HOURS, !!uid);
  const [dismissed, setDismissed] = React.useState<string[] | null>(null);
  React.useEffect(() => {
    if (!uid) return;
    let alive = true;
    AsyncStorage.getItem(keyFor(uid)).then((raw) => {
      if (!alive) return;
      try { const arr = raw ? JSON.parse(raw) : []; setDismissed(Array.isArray(arr) ? arr : []); } catch { setDismissed([]); }
    }).catch(() => { if (alive) setDismissed([]); });
    return () => { alive = false; };
  }, [uid]);
  const rows = q.data ?? [];
  const visible = dismissed ? rows.filter((r) => !dismissed.includes(r.round_key)) : [];
  const dismiss = (key: string) => {
    if (!uid) return;
    const next = [...(dismissed ?? []), key].filter((k) => rows.some((r) => r.round_key === k));
    setDismissed(next);
    AsyncStorage.setItem(keyFor(uid), JSON.stringify(next)).catch(() => {});
  };
  if (!visible.length) return null;
  return (
    <View style={{ borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: hexA(ROSE, 0.45) }}>
      <LinearGradient colors={['rgba(70,26,40,0.7)', 'rgba(22,12,16,0.9)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: 14, gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
          <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: hexA(ROSE, 0.16), alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="gavel" size={15} color={ROSE} strokeWidth={2.1} />
          </View>
          <View style={{ flex: 1 }}>
            <Mono style={{ fontSize: 8.5, letterSpacing: 0.9, color: ROSE }}>ESSENTIALS · CANCELLED BY THE CLIENT</Mono>
            <Serif style={{ fontSize: 16, marginTop: 1 }}>{visible.length === 1 ? 'A session is off your roster' : `${visible.length} sessions are off your roster`}</Serif>
          </View>
        </View>
        {visible.slice(0, 3).map((r) => (
          <View key={r.round_key} accessibilityLiveRegion="polite"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 9, paddingHorizontal: 11, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: hexA(ROSE, 0.22) }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: '#fff' }} numberOfLines={2}>{cancellationLine(r)}</Text>
              <Body style={{ fontSize: 10.5, color: C.muted2, marginTop: 1 }}>Cancelled in the Essentials app at {istClock(r.cancelled_at)} IST · the session is no longer on your roster</Body>
            </View>
            <Pressable onPress={() => dismiss(r.round_key)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Got it, ${r.client_name}`}
              style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, backgroundColor: hexA(ROSE, 0.16), borderWidth: 1, borderColor: hexA(ROSE, 0.45) }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: ROSE }}>Got it</Text>
            </Pressable>
          </View>
        ))}
      </LinearGradient>
    </View>
  );
}
