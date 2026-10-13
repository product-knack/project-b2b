/* Essentials Auction won / lost cards (10 Oct 2026). After the 4:00 PM decision
   every trainer who bid sees one card per round for 4 hours: green for a win
   (trophy tile), rose for a loss (gavel tile) with the winner's name and points.
   The server lists a round for 4 hours (get_my_auction_results), so nothing here
   expires it; a dismissed card stays hidden on this device for that user
   (AsyncStorage key essentials-auction-dismissed:<uid>, pruned to the rounds
   still served). Mounted on the trainer home, the physio's Doctor Dashboard and
   at the top of the auction page. Entrance spring, off under Reduce Motion. */
import React from 'react';
import { View, Text, Pressable, Animated } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Body, Mono } from './primitives';
import { useStore } from '../store';
import { useAuth } from '../auth';
import { useReduceMotion } from '../lib/useReduceMotion';
import { useMyAuctionResults } from '../lib/essentialsAuctionQueries';
import { AuctionResult, pointsText, resultDetail, resultHeadline } from '../lib/essentialsAuction';

const HOURS = 4;
const ROSE = '#F06A8A';
const keyFor = (uid: string) => `essentials-auction-dismissed:${uid}`;

function Chip({ text, color, onPress }: { text: string; color: string; onPress?: () => void }) {
  const inner = (
    <View style={{ paddingVertical: 3, paddingHorizontal: 9, borderRadius: 999, backgroundColor: hexA(color, onPress ? 0.14 : 0.08), borderWidth: 1, borderColor: hexA(color, onPress ? 0.5 : 0.3) }}>
      <Text style={{ fontFamily: F.bodySemi, fontSize: 10.5, color }}>{text}</Text>
    </View>
  );
  return onPress ? <Pressable onPress={onPress} hitSlop={10} accessibilityRole="button" accessibilityLabel={text}>{inner}</Pressable> : inner;
}

function ResultCard({ r, compact, reduceMotion, index, onDismiss, onOpen }: { r: AuctionResult; compact?: boolean; reduceMotion: boolean; index: number; onDismiss: () => void; onOpen: () => void }) {
  const enter = React.useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  React.useEffect(() => {
    if (reduceMotion) { enter.setValue(1); return; }
    Animated.spring(enter, { toValue: 1, friction: 7, tension: 90, delay: Math.min(index, 4) * 90, useNativeDriver: true }).start();
  }, [enter, index, reduceMotion]);
  const col = r.won ? C.green : ROSE;
  return (
    <Animated.View accessibilityLiveRegion="polite" style={{ opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }, { scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }] }}>
      <LinearGradient colors={r.won ? ['rgba(28,62,44,0.6)', 'rgba(14,20,16,0.7)'] : ['rgba(70,26,40,0.55)', 'rgba(22,12,16,0.7)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={{ borderRadius: 18, borderWidth: 1, borderColor: hexA(col, 0.45), borderLeftWidth: 4, borderLeftColor: col, padding: 13, paddingRight: 40, gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 11 }}>
          <View style={{ width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: r.won ? col : hexA(col, 0.14), borderWidth: 1, borderColor: hexA(col, 0.55) }}>
            <Icon name={r.won ? 'trophy' : 'gavel'} size={19} color={r.won ? '#06130B' : col} strokeWidth={2.2} />
          </View>
          <View style={{ flex: 1 }}>
            <Mono style={{ fontSize: 8.5, letterSpacing: 1.4, color: col }}>{r.won ? 'YOU WON THE AUCTION' : 'AUCTION LOST'}</Mono>
            <Body style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff', lineHeight: 18, marginTop: 2 }}>{resultHeadline(r)}</Body>
            <Body style={{ fontSize: 11.5, color: C.muted2, lineHeight: 16, marginTop: 2 }}>{resultDetail(r)}</Body>
            {!compact ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 8 }}>
                <Chip text={`Your score ${pointsText(r.my_points, r.question_count)}`} color={C.ink3} />
                {r.result === 'won' && !r.won && r.winner_points != null ? <Chip text={`${r.winner_name ?? 'Winner'} ${pointsText(r.winner_points, r.question_count)}`} color={C.ink3} /> : null}
                <Chip text="Open the auction" color={C.gold} onPress={onOpen} />
              </View>
            ) : null}
          </View>
        </View>
        <Pressable onPress={onDismiss} hitSlop={10} accessibilityRole="button" accessibilityLabel="Dismiss" style={{ position: 'absolute', right: 8, top: 8, width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="close" size={13} color={C.ink3} strokeWidth={2.4} />
        </Pressable>
      </LinearGradient>
    </Animated.View>
  );
}

export function AuctionResultsCards({ compact }: { compact?: boolean }) {
  const { go } = useStore();
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;
  const reduceMotion = useReduceMotion();
  const resultsQ = useMyAuctionResults(HOURS, !!uid);
  const results = resultsQ.data ?? [];
  const [dismissed, setDismissed] = React.useState<string[] | null>(null); // null until read

  // Read the device's dismissed list for this user once.
  React.useEffect(() => {
    let alive = true;
    setDismissed(null);
    if (!uid) return;
    AsyncStorage.getItem(keyFor(uid)).then((raw) => {
      if (!alive) return;
      try { const arr = raw ? JSON.parse(raw) : []; setDismissed(Array.isArray(arr) ? arr.filter((k) => typeof k === 'string') : []); } catch { setDismissed([]); }
    }).catch(() => { if (alive) setDismissed([]); });
    return () => { alive = false; };
  }, [uid]);

  // Keep the list small: only keys the server still serves (once the results have loaded).
  React.useEffect(() => {
    if (!uid || dismissed == null || !resultsQ.isSuccess) return;
    const keep = dismissed.filter((k) => results.some((r) => r.round_key === k));
    if (keep.length !== dismissed.length) setDismissed(keep);
    AsyncStorage.setItem(keyFor(uid), JSON.stringify(keep)).catch(() => {});
  }, [uid, dismissed, results, resultsQ.isSuccess]);

  if (!uid || dismissed == null) return null;
  const visible = results.filter((r) => !dismissed.includes(r.round_key));
  if (!visible.length) return null;
  return (
    <View style={{ gap: 9 }}>
      {visible.map((r, i) => (
        <ResultCard key={r.round_key} r={r} index={i} compact={compact} reduceMotion={reduceMotion}
          onDismiss={() => setDismissed((d) => (d ?? []).includes(r.round_key) ? d : [...(d ?? []), r.round_key])}
          onOpen={() => go('essentials-auction')} />
      ))}
    </View>
  );
}
