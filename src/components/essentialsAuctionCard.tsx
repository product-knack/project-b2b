/* Essentials Auction home card (trainer dashboard, 1 Oct 2026). Shows only while
   the auction window is open (1:00 PM to 5:00 PM IST since 15 Oct 2026, from
   essentials_auction_config) and tomorrow has at least one lot; outside that it
   renders nothing, so the home stays quiet 21 hours a day. Same bones as the
   My Crew card (top strip with a travelling light band, breathing glyph glow),
   auction colours (indigo field, gold), a LIVE pill with the closing countdown,
   the first open lots as chips, and a tap that opens the auction page. Polls the
   lots every 20 s only while visible; every loop stops under Reduce Motion. */
import React from 'react';
import { View, Text, Pressable, Animated, Easing, AccessibilityInfo, AppState } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Body, Mono } from './primitives';
import { useStore } from '../store';
import { useAuth } from '../auth';
import { serverNow } from '../lib/managerChatQueries';
import { DEFAULT_AUCTION_CONFIG, auctionTargetDate, formatCountdown, formatLotDate, formatTime12, windowState } from '../lib/essentialsAuction';
import { useAuctionConfig, useEssentialsAuction } from '../lib/essentialsAuctionQueries';

const GOLD_SOFT = '#FFE3A3';
const INDIGO_CARD: [string, string] = ['rgba(44,34,92,0.66)', 'rgba(20,15,30,0.84)'];

const firstName = (name: string) => name.trim().split(/\s+/)[0] || 'Client';

export function EssentialsAuctionHomeCard() {
  const { go } = useStore();
  const { session } = useAuth();
  const me = session?.user?.id ?? null;

  // Clock: every 30 s and on foreground, so the card appears and leaves with the window.
  const [now, setNow] = React.useState<Date>(() => serverNow());
  React.useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), 30_000);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') setNow(serverNow()); });
    return () => { clearInterval(t); sub.remove(); };
  }, []);
  const [reduceMotion, setReduceMotion] = React.useState(false);
  React.useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((r) => { if (alive) setReduceMotion(!!r); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const cfgQ = useAuctionConfig();
  const win = windowState(cfgQ.data ?? DEFAULT_AUCTION_CONFIG, now);
  const date = auctionTargetDate(now);
  const lotsQ = useEssentialsAuction(date, win.open);
  const lots = lotsQ.data ?? [];
  const open = lots.filter((l) => l.status !== 'grabbed');
  // Bids by questions (10 Oct 2026): "yours" = the sessions this trainer bid on (or won).
  const yours = lots.filter((l) => l.my_points != null || (l.status === 'grabbed' && l.trainer_id === me)).length;
  const show = win.open && lots.length > 0;

  const pulse = React.useRef(new Animated.Value(0)).current; // glow ring behind the gavel
  const sweep = React.useRef(new Animated.Value(0)).current; // light band along the top strip
  const beat = React.useRef(new Animated.Value(0)).current;  // LIVE dot heartbeat
  React.useEffect(() => {
    if (!show || reduceMotion) return;
    const l1 = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    const l2 = Animated.loop(Animated.sequence([
      Animated.timing(sweep, { toValue: 1, duration: 2400, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
      Animated.timing(sweep, { toValue: 0, duration: 0, useNativeDriver: true }),
      Animated.delay(1400),
    ]));
    const l3 = Animated.loop(Animated.timing(beat, { toValue: 1, duration: 1300, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    l1.start(); l2.start(); l3.start();
    return () => { l1.stop(); l2.stop(); l3.stop(); };
  }, [show, reduceMotion, pulse, sweep, beat]);

  if (!show) return null;

  const chips = open.slice(0, 3);
  const more = open.length - chips.length;
  const sub = open.length
    ? `${open.length} session${open.length === 1 ? '' : 's'} open for tomorrow${yours ? ` · ${yours} you bid on` : ''}`
    : `Every session is taken${yours ? ` · ${yours} you bid on` : ''}`;

  return (
    <Pressable onPress={() => go('essentials-auction')} accessibilityRole="button" accessibilityLabel={`Essentials Auction, live, ${sub}`}
      style={({ pressed }) => ({ borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: hexA(C.gold, 0.45), opacity: pressed ? 0.9 : 1 })}>
      <LinearGradient colors={INDIGO_CARD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
        {/* top strip with travelling light band */}
        <View style={{ height: 3, backgroundColor: hexA(C.gold, 0.2), overflow: 'hidden' }}>
          {reduceMotion ? null : (
            <Animated.View style={{ width: 90, height: 3, transform: [{ translateX: sweep.interpolate({ inputRange: [0, 1], outputRange: [-90, 430] }) }] }}>
              <LinearGradient colors={['transparent', hexA(C.gold, 0.95), 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ flex: 1 }} />
            </Animated.View>
          )}
        </View>
        <View pointerEvents="none" style={{ position: 'absolute', right: -30, top: -30, width: 120, height: 120, borderRadius: 60, backgroundColor: hexA(C.gold, 0.08) }} />
        <View style={{ padding: 14, gap: 11 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            {/* gavel glyph with breathing glow */}
            <View style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
              {reduceMotion ? null : (
                <Animated.View style={{
                  position: 'absolute', width: 44, height: 44, borderRadius: 15, backgroundColor: hexA(C.gold, 0.4),
                  transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.3] }) }],
                  opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0.04] }),
                }} />
              )}
              <LinearGradient colors={['#F2C14E', '#D98B1C']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="gavel" size={20} color="#1A1200" strokeWidth={2.2} />
              </LinearGradient>
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                <Body style={{ fontSize: 15, fontFamily: F.bodySemi, color: '#fff' }} numberOfLines={1}>Essentials Auction</Body>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 1.5, paddingHorizontal: 7, borderRadius: 999, backgroundColor: hexA(C.green, 0.14), borderWidth: 1, borderColor: hexA(C.green, 0.5) }}>
                  <View style={{ width: 10, height: 10, alignItems: 'center', justifyContent: 'center' }}>
                    {reduceMotion ? null : (
                      <Animated.View style={{ position: 'absolute', width: 10, height: 10, borderRadius: 5, borderWidth: 1.2, borderColor: C.green, opacity: beat.interpolate({ inputRange: [0, 1], outputRange: [0.8, 0] }), transform: [{ scale: beat.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.8] }) }] }} />
                    )}
                    <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: C.green }} />
                  </View>
                  <Mono style={{ fontSize: 7.5, letterSpacing: 0.8, color: C.green }}>LIVE</Mono>
                </View>
              </View>
              <Body style={{ fontSize: 11, color: C.muted2, marginTop: 2 }} numberOfLines={1}>{sub} · decided in {formatCountdown(win.minutesLeft)}</Body>
            </View>
            <Icon name="chevRight" size={17} color={C.gold} strokeWidth={2.3} />
          </View>

          {/* the first open lots, time + first name; grabbed ones stay on the page */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {chips.map((l) => (
              <View key={`${l.client_id}-${l.slot_time}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4, paddingHorizontal: 9, borderRadius: 999, backgroundColor: hexA(C.gold, l.status === 'reserved' ? 0.08 : 0.14), borderWidth: 1, borderColor: hexA(C.gold, l.status === 'reserved' ? 0.3 : 0.5) }}>
                <Icon name={l.status === 'reserved' ? 'shield' : 'flame'} size={10} color={GOLD_SOFT} strokeWidth={2.3} />
                <Text style={{ fontFamily: F.bodySemi, fontSize: 10.5, color: GOLD_SOFT }}>{formatTime12(l.slot_time)} · {firstName(l.client_name)}</Text>
              </View>
            ))}
            {more > 0 ? (
              <View style={{ paddingVertical: 4, paddingHorizontal: 9, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}>
                <Text style={{ fontFamily: F.bodySemi, fontSize: 10.5, color: C.ink3 }}>+{more} more</Text>
              </View>
            ) : null}
            {!chips.length ? <Mono style={{ fontSize: 8.5, letterSpacing: 0.8, color: C.muted3 }}>TOMORROW · {formatLotDate(lots[0]?.auction_date ?? date).toUpperCase()}</Mono> : null}
          </View>
          <Body style={{ fontSize: 10.5, color: C.muted3, lineHeight: 14 }}>Answer the client's five questions to bid. Best score wins at {win.closesAt}.</Body>
        </View>
      </LinearGradient>
    </Pressable>
  );
}
