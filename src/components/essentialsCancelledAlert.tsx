/* Essentials Auction: the client cancelled a session of mine (26 Oct 2026, owner: "after the auction, if a
   client's session was sold and the client cancels, push the trainer and show an alert on the dashboard").
   The server lists my cancelled sessions of the last 48 hours (get_my_essentials_cancellations); a card
   dismissed with Got it stays hidden on this device for that user (AsyncStorage, pruned to the rounds still
   served). Mounted on the trainer home and the physio's Doctor Dashboard next to the unsold alert.
   27 Oct 2026 (the client app's cancel rule): a training on today's or tomorrow's date is TAGGED, the roster
   row stays until the trainer marks it here (paid = one of the client's 20, free = nothing counts); a
   cancellation two or more days ahead is already off the roster. */
import React from 'react';
import { View, Text, Pressable, Alert, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono } from './primitives';
import { useAuth } from '../auth';
import { useMyEssentialsCancellations, useMarkClientCancellation } from '../lib/essentialsAuctionQueries';
import { clientCancelLine, markedLine, istClock, istParts, type EssentialsCancellation } from '../lib/essentialsAuction';
import { friendlyError } from '../lib/friendlyError';

const ROSE = '#F06A8A';
const HOURS = 48;
const keyFor = (uid: string) => `essentials-cancelled-dismissed:${uid}`;

function MarkButton({ row }: { row: EssentialsCancellation }) {
  const m = useMarkClientCancellation();
  const ask = () => Alert.alert('Mark this cancellation?',
    row.kind === 'paid'
      ? `${row.client_name}'s session turns cancelled on your roster as a paid cancellation, one of their 20. The care team approves the payout.`
      : `${row.client_name}'s session turns cancelled on your roster as a free cancellation. Nothing counts.`,
    [{ text: 'Not now', style: 'cancel' }, { text: 'Mark it', onPress: () => m.mutate(row.session_id as string, { onError: (e: any) => Alert.alert('Could not mark it', friendlyError(e, 'Try again.')) }) }]);
  if (!row.session_id) return null;
  return (
    <Pressable onPress={ask} disabled={m.isPending} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Mark ${row.client_name}'s cancellation on the roster`}
      style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 13, borderRadius: 999, backgroundColor: hexA(ROSE, 0.18), borderWidth: 1, borderColor: hexA(ROSE, 0.5), opacity: m.isPending ? 0.6 : 1 }}>
      {m.isPending ? <ActivityIndicator size="small" color={ROSE} /> : <Icon name="checks" size={12} color={ROSE} strokeWidth={2.4} />}
      <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: ROSE }}>Mark as cancelled on my roster</Text>
    </Pressable>
  );
}

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
  // A tagged cancellation that is not marked yet is never dismissible: the roster still holds the session.
  const visible = dismissed ? rows.filter((r) => (r.tagged && !r.marked) || !dismissed.includes(r.round_key)) : [];
  const dismiss = (key: string) => {
    if (!uid) return;
    const next = [...(dismissed ?? []), key].filter((k) => rows.some((r) => r.round_key === k));
    setDismissed(next);
    AsyncStorage.setItem(keyFor(uid), JSON.stringify(next)).catch(() => {});
  };
  if (!visible.length) return null;
  const todayYmd = istParts().date;
  return (
    <View style={{ borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: hexA(ROSE, 0.45) }}>
      <LinearGradient colors={['rgba(70,26,40,0.7)', 'rgba(22,12,16,0.9)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: 14, gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
          <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: hexA(ROSE, 0.16), alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="gavel" size={15} color={ROSE} strokeWidth={2.1} />
          </View>
          <View style={{ flex: 1 }}>
            <Mono style={{ fontSize: 8.5, letterSpacing: 0.9, color: ROSE }}>ESSENTIALS · CANCELLED BY THE CLIENT</Mono>
            <Serif style={{ fontSize: 16, marginTop: 1 }}>{visible.length === 1 ? 'A client cancelled a session' : `${visible.length} clients cancelled a session`}</Serif>
          </View>
        </View>
        {visible.slice(0, 4).map((r) => (
          <View key={r.round_key} accessibilityLiveRegion="polite"
            style={{ gap: 8, paddingVertical: 10, paddingHorizontal: 11, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: hexA(r.tagged && !r.marked ? ROSE : C.muted3, r.tagged && !r.marked ? 0.45 : 0.22) }}>
            <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: '#fff', lineHeight: 18 }}>{clientCancelLine(r, todayYmd)}</Text>
            <Body style={{ fontSize: 10.5, color: C.muted2 }}>
              {r.marked && r.tagged ? markedLine(r.kind) : `Cancelled in the Essentials app at ${istClock(r.cancelled_at)} IST`}
            </Body>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {r.tagged && !r.marked ? <MarkButton row={r} /> : null}
              {!(r.tagged && !r.marked) ? (
                <Pressable onPress={() => dismiss(r.round_key)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Got it, ${r.client_name}`}
                  style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, backgroundColor: hexA(ROSE, 0.16), borderWidth: 1, borderColor: hexA(ROSE, 0.45) }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: ROSE }}>Got it</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ))}
      </LinearGradient>
    </View>
  );
}
