import React from 'react';
import { View, Text, Pressable, Animated, Easing, ActivityIndicator, AppState, Modal, Image, Dimensions, Alert } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono, Card } from '../components/primitives';
import { Page, MiniAvatar } from './common';
import { useAuth } from '../auth';
import { serverNow } from '../lib/managerChatQueries';
import { useReduceMotion } from '../lib/useReduceMotion';
import {
  AuctionLot, BidResult, DEFAULT_AUCTION_CONFIG, WindowState, auctionTargetDate, bidsLine, canGrab, formatCountdown, formatLotDate,
  formatTime12, istClock, lotNumber, lotResultLine, pointsText, windowState, EtaNeighbour, LotEta, formatMinutes,
} from '../lib/essentialsAuction';
import { useAuctionConfig, useAuctionClientPhotos, useAuctionEta, useEssentialsAuction } from '../lib/essentialsAuctionQueries';
import { AuctionQuizSheet } from '../components/auctionQuizSheet';
import { AuctionResultsCards } from '../components/auctionResultsCards';

/* ============ Essentials Auction (trainer sidebar page, 1 Oct 2026) ============
   Every Essentials by Odds client saves their own week in the client app
   (clients.weekly_protocol.slots). The day before each training the auction
   offers it to trainers. Since 10 Oct 2026 (hub-track migration 20261010120000)
   a trainer bids by answering the client's five questions, one attempt each; at
   the close (4:00 PM IST) the highest score wins, equal scores the earlier bid,
   still equal the client's usual trainer, and the server writes the winner's
   session_schedule row, care-team note and My Crew entry. Everyone who bid sees
   the result on the dashboard for four hours. Port of the web page (hub-track
   src/pages/trainer/EssentialsAuction.tsx) on the same RPCs: get_essentials_auction
   (tomorrow only, polled every 20 s), get_essentials_auction_quiz,
   submit_essentials_bid and get_my_auction_results. The device clock only decides
   how the buttons look. */

const INDIGO: [string, string] = ['#232058', '#3E2B7E'];
const GOLD_GRAD: [string, string] = ['#F2C14E', '#D98B1C'];
const ROSE = '#F06A8A';
const SKY = '#8FC6F0';
const INDIGO_SOFT = '#A5B4FC';

const initials = (name: string) => name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
const AVS: [string, string][] = [['#7C8FE8', '#9A7BEA'], ['#F47A2A', '#D95C1A'], ['#2FB7A3', '#1E8C7A'], ['#E0A53C', '#B3771C'], ['#E76A52', '#B03A2E']];
const modalityColor = (m: string) => {
  const k = m.toLowerCase();
  if (k.includes('strength')) return C.orange;
  if (k.includes('yoga') || k.includes('pilates')) return C.purple;
  if (k.includes('box') || k.includes('hiit')) return C.red;
  if (k.includes('cardio') || k.includes('aerobic')) return C.blue;
  if (k.includes('rehab') || k.includes('physio')) return C.green;
  return C.gold;
};

/* The LIVE dot: a ring that swells and fades around a solid dot. */
function PulseDot({ color, reduceMotion }: { color: string; reduceMotion: boolean }) {
  const v = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    if (reduceMotion) return;
    const loop = Animated.loop(Animated.timing(v, { toValue: 1, duration: 1400, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, v]);
  return (
    <View style={{ width: 14, height: 14, alignItems: 'center', justifyContent: 'center' }}>
      {reduceMotion ? null : (
        <Animated.View style={{ position: 'absolute', width: 14, height: 14, borderRadius: 7, borderWidth: 1.5, borderColor: color, opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.8, 0] }), transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.9] }) }] }} />
      )}
      <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: color }} />
    </View>
  );
}

function WindowPill({ win, reduceMotion }: { win: WindowState; reduceMotion: boolean }) {
  const color = win.phase === 'open' ? C.green : win.phase === 'before' ? C.gold : C.muted2;
  const text = win.phase === 'open'
    ? `LIVE · decided in ${formatCountdown(win.minutesLeft)}`
    : win.phase === 'before'
      ? `Opens at ${win.opensAt} · in ${formatCountdown(win.minutesLeft)}`
      : `Decided at ${win.closesAt} · reopens ${win.opensAt}`;
  return (
    <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, backgroundColor: hexA(color, 0.16), borderWidth: 1, borderColor: hexA(color, 0.5) }}>
      {win.phase === 'open' ? <PulseDot color={color} reduceMotion={reduceMotion} /> : <Icon name={win.phase === 'before' ? 'clock' : 'lock'} size={12} color={color} strokeWidth={2.4} />}
      <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color }}>{text}</Text>
    </View>
  );
}

function Counter({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={{ flex: 1, paddingVertical: 10, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: hexA(color, 0.3), alignItems: 'center', gap: 2 }}>
      <Serif style={{ fontSize: 24, color }}>{value}</Serif>
      <Mono style={{ fontSize: 8, letterSpacing: 1.2, color: C.muted3 }}>{label}</Mono>
    </View>
  );
}

/* The rotated stamp on a decided lot; springs in when the status arrives. */
function Stamp({ text, color }: { text: string; color: string }) {
  const s = React.useRef(new Animated.Value(1.7)).current;
  const o = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    s.setValue(1.7); o.setValue(0);
    Animated.parallel([
      Animated.spring(s, { toValue: 1, friction: 5, tension: 120, useNativeDriver: true }),
      Animated.timing(o, { toValue: 1, duration: 160, useNativeDriver: true }),
    ]).start();
  }, [text, s, o]);
  return (
    <Animated.View style={{ opacity: o, transform: [{ rotate: '-8deg' }, { scale: s }], paddingVertical: 3, paddingHorizontal: 9, borderRadius: 6, borderWidth: 2, borderColor: color, backgroundColor: hexA(color, 0.12) }}>
      <Text style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: 2, color }}>{text}</Text>
    </Animated.View>
  );
}

/* The live bid button: gold, with a light sweep while the session can be bid on. */
function BidButton({ live, busy, onPress, reduceMotion, label }: { live: boolean; busy?: boolean; onPress: () => void; reduceMotion: boolean; label: string }) {
  const x = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    if (!live || reduceMotion) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(x, { toValue: 1, duration: 1500, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.delay(900),
    ]));
    loop.start();
    return () => loop.stop();
  }, [live, reduceMotion, x]);
  return (
    <Pressable onPress={live && !busy ? onPress : undefined} disabled={!live || busy} hitSlop={10} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !live || busy }}
      style={({ pressed }) => ({ borderRadius: 14, overflow: 'hidden', opacity: pressed ? 0.85 : 1, borderWidth: 1, borderColor: live ? hexA(C.gold, 0.7) : 'rgba(255,255,255,0.1)' })}>
      <LinearGradient colors={live ? GOLD_GRAD : ['rgba(255,255,255,0.05)', 'rgba(255,255,255,0.03)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 13 }}>
        {busy ? <ActivityIndicator color="#1A1200" /> : <Icon name="gavel" size={16} color={live ? '#1A1200' : C.muted2} strokeWidth={2.3} />}
        <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: live ? '#1A1200' : C.muted2 }}>{label}</Text>
        {live && !reduceMotion ? (
          <Animated.View pointerEvents="none" style={{ position: 'absolute', top: -20, bottom: -20, width: 70, transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [-120, 420] }) }, { rotate: '18deg' }] }}>
            <LinearGradient colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.45)', 'rgba(255,255,255,0)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ flex: 1 }} />
          </Animated.View>
        ) : null}
      </LinearGradient>
    </Pressable>
  );
}

/* The client's QHP front-view photo as a tappable thumbnail; initials when there is none. */
function ClientFace({ name, photo, index, size, onPress }: { name: string; photo?: string | null; index: number; size: number; onPress?: () => void }) {
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setFailed(false), [photo]);
  if (!photo || failed) return <MiniAvatar initial={initials(name)} colors={AVS[index % AVS.length]} size={size} />;
  return (
    <Pressable onPress={onPress} disabled={!onPress} hitSlop={6} accessibilityRole="imagebutton" accessibilityLabel={`${name}, QHP front view photo`}
      style={{ width: size, height: size, borderRadius: size * 0.32, overflow: 'hidden', borderWidth: 1.5, borderColor: hexA(C.gold, 0.7), backgroundColor: 'rgba(255,255,255,0.06)' }}>
      <Image source={{ uri: photo }} onError={() => setFailed(true)} style={{ width: size, height: size }} resizeMode="cover" />
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingVertical: 1, alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.55)' }}>
        <Text style={{ fontFamily: F.mono, fontSize: 6.5, letterSpacing: 1, color: GOLD_SOFT }}>QHP</Text>
      </View>
    </Pressable>
  );
}
const GOLD_SOFT = '#FFE3A3';

/* Full-screen look at the QHP front view (its own Modal; nothing else is open when it shows). */
function PhotoLightbox({ item, onClose }: { item: { url: string; name: string } | null; onClose: () => void }) {
  const { width, height } = Dimensions.get('window');
  return (
    <Modal visible={!!item} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.94)', alignItems: 'center', justifyContent: 'center' }}>
        <Pressable onPress={onClose} accessibilityLabel="Close" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
        {item ? (
          <View pointerEvents="box-none" style={{ alignItems: 'center', gap: 12 }}>
            <Image source={{ uri: item.url }} style={{ width: width - 32, height: height * 0.72, borderRadius: 18 }} resizeMode="contain" />
            <Mono style={{ fontSize: 9, letterSpacing: 1.2, color: C.gold }}>{item.name.toUpperCase()} · QHP FRONT VIEW</Mono>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" style={{ paddingVertical: 9, paddingHorizontal: 18, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: '#fff' }}>Close</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

/* One neighbouring session of the trainer (the one before or after the lot) with the drive estimate. */
function EtaRow({ side, n }: { side: 'prev' | 'next'; n: EtaNeighbour }) {
  const col = n.tight ? C.red : n.etaMin == null ? C.muted2 : C.green;
  const travel = n.etaMin != null ? `~${formatMinutes(n.etaMin)} drive${n.km != null ? ` · ${n.km} km` : ''}` : n.session.locText ? n.session.locText : 'no map pin';
  const gap = n.gapMin < 0 ? `overlaps by ${formatMinutes(-n.gapMin)}` : `${formatMinutes(n.gapMin)} gap`;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Icon name={side === 'prev' ? 'arrowLeft' : 'arrowRight'} size={12} color={col} strokeWidth={2.4} />
      <View style={{ flex: 1 }}>
        <Body numberOfLines={1} style={{ fontSize: 12, color: '#fff' }}>
          {side === 'prev' ? 'Before' : 'After'}: {istClock(n.session.start)} · {n.session.name}{n.session.modality ? ` · ${n.session.modality}` : ''}
        </Body>
        <Mono numberOfLines={1} style={{ fontSize: 8.5, letterSpacing: 0.5, color: col }}>{travel.toUpperCase()} · {gap.toUpperCase()}{n.tight ? ' · TIGHT' : n.etaMin != null ? ' · OK' : ''}</Mono>
      </View>
    </View>
  );
}

/* The ETA block on a session card: the lot's location (pin or address) and the trainer's own
   sessions within 3 hours either side with the drive between the two clients. */
function EtaBlock({ eta }: { eta: LotEta | null | undefined }) {
  if (!eta) return null;
  const hasRows = !!(eta.prev || eta.next);
  if (!hasRows && !eta.locText && !eta.loc) return null;
  const col = eta.tight ? C.red : C.blue;
  return (
    <View style={{ gap: 7, padding: 11, borderRadius: 14, backgroundColor: hexA(col, 0.07), borderWidth: 1, borderColor: hexA(col, eta.tight ? 0.5 : 0.25) }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Icon name="map" size={12} color={col} strokeWidth={2.2} />
        <Mono style={{ flex: 1, fontSize: 8.5, letterSpacing: 1.2, color: col }}>ETA · YOUR SESSIONS AROUND IT</Mono>
        {eta.tight ? (
          <View style={{ paddingVertical: 2, paddingHorizontal: 7, borderRadius: 999, backgroundColor: hexA(C.red, 0.16), borderWidth: 1, borderColor: hexA(C.red, 0.5) }}>
            <Mono style={{ fontSize: 7.5, letterSpacing: 1, color: C.red }}>TIGHT TRAVEL</Mono>
          </View>
        ) : null}
      </View>
      {eta.loc
        ? (eta.locText ? <Mono numberOfLines={1} style={{ fontSize: 8.5, letterSpacing: 0.5, color: C.muted2 }}>CLIENT · {eta.locText.toUpperCase()}</Mono> : null)
        : <Mono numberOfLines={2} style={{ fontSize: 8.5, letterSpacing: 0.5, color: C.gold }}>{eta.locText ? `CLIENT · ${eta.locText.toUpperCase()} (FROM THE QHP, NO MAP PIN)` : 'CLIENT · NO LOCATION ON FILE YET'}</Mono>}
      {eta.prev ? <EtaRow side="prev" n={eta.prev} /> : null}
      {eta.next ? <EtaRow side="next" n={eta.next} /> : null}
      {!hasRows ? <Mono style={{ fontSize: 8.5, letterSpacing: 0.5, color: C.muted2 }}>NO SESSION OF YOURS WITHIN 3 HOURS OF IT</Mono> : null}
      <Mono style={{ fontSize: 7, letterSpacing: 0.6, color: C.muted3 }}>ROAD ESTIMATE FROM THE CLIENTS' MAP PINS · SESSIONS TAKEN AS 60 MIN</Mono>
    </View>
  );
}

function LotCard({ lot, index, me, win, now, reduceMotion, photo, eta, onPhoto, onBid }: { lot: AuctionLot; index: number; me: string | null; win: WindowState; now: Date; reduceMotion: boolean; photo?: string | null; eta?: LotEta | null; onPhoto?: () => void; onBid: () => void }) {
  const enter = React.useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  React.useEffect(() => {
    if (reduceMotion) { enter.setValue(1); return; }
    Animated.timing(enter, { toValue: 1, duration: 420, delay: Math.min(index, 8) * 70, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [enter, index, reduceMotion]);

  const grabbed = lot.status === 'grabbed';
  const mine = grabbed && lot.trainer_id === me;
  const bid = lot.my_points != null;
  const decided = lot.round_result === 'won';
  const can = canGrab(lot, me, win);
  const col = modalityColor(lot.modality);
  const accent = grabbed ? (mine ? C.gold : ROSE) : bid ? INDIGO_SOFT : lot.status === 'reserved' ? C.blue : C.gold;
  const headStart = lot.preferred_trainer_id && lot.reserved_until && now.getTime() < new Date(lot.reserved_until).getTime() && !grabbed;
  const trainerLine = lot.preferred_trainer_name && !grabbed
    ? headStart
      ? lot.preferred_trainer_id === me ? `Yours first until ${istClock(lot.reserved_until!)}` : `${lot.preferred_trainer_name} goes first until ${istClock(lot.reserved_until!)}`
      : `Usual trainer: ${lot.preferred_trainer_name}`
    : null;

  return (
    <Animated.View style={{ opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] }}>
      <Card colors={grabbed ? ['rgba(30,24,40,0.5)', 'rgba(16,13,18,0.55)'] : bid ? ['rgba(40,38,96,0.5)', 'rgba(18,16,30,0.55)'] : ['rgba(46,36,80,0.5)', 'rgba(20,16,24,0.55)']} border={hexA(accent, grabbed ? 0.25 : 0.45)} radius={22} style={{ padding: 16, gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ paddingVertical: 3, paddingHorizontal: 8, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}>
            <Mono style={{ fontSize: 8.5, letterSpacing: 1.5, color: C.ink3 }}>{lotNumber(index)}</Mono>
          </View>
          <View style={{ flex: 1 }} />
          {grabbed ? (
            <Stamp text={mine ? 'YOURS' : decided ? 'WON' : 'BOOKED'} color={accent} />
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 3, paddingHorizontal: 9, borderRadius: 999, backgroundColor: hexA(accent, 0.14), borderWidth: 1, borderColor: hexA(accent, 0.45) }}>
              <Icon name={bid ? 'checks' : lot.status === 'reserved' ? 'shield' : 'flame'} size={11} color={accent} strokeWidth={2.3} />
              <Mono style={{ fontSize: 8.5, letterSpacing: 1.5, color: accent }}>{bid ? 'YOU BID' : lot.status === 'reserved' ? (lot.preferred_trainer_id === me ? 'RESERVED FOR YOU' : 'RESERVED') : 'OPEN'}</Mono>
            </View>
          )}
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10 }}>
          <Serif style={{ fontSize: 34, lineHeight: 38, color: grabbed && !mine ? C.muted : '#fff' }}>{formatTime12(lot.slot_time)}</Serif>
          <View style={{ paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999, backgroundColor: hexA(col, 0.14), borderWidth: 1, borderColor: hexA(col, 0.4), marginBottom: 6 }}>
            <Text style={{ fontFamily: F.bodySemi, fontSize: 11.5, color: col }}>{lot.modality || 'Training'}</Text>
          </View>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <ClientFace name={lot.client_name} photo={photo} index={index} size={photo ? 56 : 40} onPress={onPhoto} />
          <View style={{ flex: 1 }}>
            <Body numberOfLines={1} style={{ fontSize: 15, fontFamily: F.bodySemi, color: '#fff' }}>{lot.client_name}</Body>
            <Body style={{ fontSize: 11, color: C.muted2, marginTop: 1 }}>Essentials by Odds · {formatLotDate(lot.auction_date)}</Body>
            {photo ? <Mono style={{ fontSize: 7.5, letterSpacing: 0.8, color: C.muted3, marginTop: 2 }}>TAP THE PHOTO FOR THE QHP FRONT VIEW</Mono> : null}
          </View>
        </View>

        {/* bids so far and the size of the questionnaire */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon name="users" size={12} color={INDIGO_SOFT} strokeWidth={2.2} />
          <Body style={{ fontSize: 11.5, color: INDIGO_SOFT }}>{bidsLine(lot)}</Body>
        </View>

        {trainerLine ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Icon name="user" size={12} color={SKY} strokeWidth={2.2} />
            <Body style={{ fontSize: 11.5, color: SKY }}>{trainerLine}</Body>
          </View>
        ) : null}

        {!grabbed ? <EtaBlock eta={eta} /> : null}

        {grabbed ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, backgroundColor: hexA(accent, 0.1), borderWidth: 1, borderColor: hexA(accent, 0.3) }}>
            <Icon name="trophy" size={14} color={accent} strokeWidth={2.4} />
            <Body style={{ flex: 1, fontSize: 12.5, fontFamily: F.bodySemi, color: accent }}>{lotResultLine(lot, me)}</Body>
            {lot.grabbed_at ? <Mono style={{ fontSize: 8.5, letterSpacing: 0.6, color: C.muted3 }}>{istClock(lot.grabbed_at).toUpperCase()}</Mono> : null}
          </View>
        ) : bid ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, backgroundColor: hexA(INDIGO_SOFT, 0.1), borderWidth: 1, borderColor: hexA(INDIGO_SOFT, 0.35) }}>
            <Icon name="checks" size={14} color={INDIGO_SOFT} strokeWidth={2.4} />
            <Body style={{ flex: 1, fontSize: 12.5, fontFamily: F.bodySemi, color: INDIGO_SOFT }}>Your bid: {pointsText(lot.my_points, lot.question_count)} correct</Body>
            {lot.my_submitted_at ? <Mono style={{ fontSize: 8.5, letterSpacing: 0.6, color: C.muted3 }}>{istClock(lot.my_submitted_at).toUpperCase()}</Mono> : null}
          </View>
        ) : (
          <View style={{ gap: 6 }}>
            <BidButton live={can.ok} onPress={onBid} reduceMotion={reduceMotion} label="Answer and bid" />
            {!can.ok && can.why ? <Mono style={{ fontSize: 8.5, letterSpacing: 0.6, color: C.muted3, textAlign: 'center' }}>{can.why.toUpperCase()}</Mono> : null}
          </View>
        )}
      </Card>
    </Animated.View>
  );
}

export function EssentialsAuction() {
  const { session, dbRole } = useAuth();
  const me = session?.user?.id ?? null;
  // Physiotherapists see the rehab sessions, trainers the trainings (the database
  // filters the rows by role); only the wording differs here.
  const physio = dbRole === 'doctor';
  const reduceMotion = useReduceMotion();

  // The page clock: re-read every 15 s and whenever the app comes to the foreground,
  // so the pill, the day and the buttons follow the window.
  const [now, setNow] = React.useState<Date>(() => serverNow());
  React.useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), 15_000);
    return () => clearInterval(t);
  }, []);

  const cfgQ = useAuctionConfig();
  const cfg = cfgQ.data ?? DEFAULT_AUCTION_CONFIG;
  const date = auctionTargetDate(now);
  const win = windowState(cfg, now);
  const lotsQ = useEssentialsAuction(date);
  const refetchLots = lotsQ.refetch;
  React.useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      setNow(serverNow());
      refetchLots();
    });
    return () => sub.remove();
  }, [refetchLots]);

  const [quizLot, setQuizLot] = React.useState<AuctionLot | null>(null);
  const [quizEta, setQuizEta] = React.useState<string | null>(null);
  const [photoFor, setPhotoFor] = React.useState<{ url: string; name: string } | null>(null);
  const photosQ = useAuctionClientPhotos((lotsQ.data ?? []).map((l) => l.client_id));
  const photos = photosQ.data ?? {};
  const etaQ = useAuctionEta(lotsQ.data ?? [], me, date);
  const etas = etaQ.data ?? {};
  const etaOf = (lot: AuctionLot) => etas[`${lot.client_id}@${lot.slot_time}`] ?? null;
  // A tight transfer gets a warning first; the trainer may still bid (a win puts the session on the roster).
  const openQuiz = (lot: AuctionLot) => {
    const e = etaOf(lot);
    const tight = e?.tight ? [e.prev, e.next].filter((n): n is EtaNeighbour => !!n && n.tight) : [];
    if (!tight.length) { setQuizEta(null); setQuizLot(lot); return; }
    const lines = tight.map((n) =>
      `${istClock(n.session.start)} with ${n.session.name}: ${n.etaMin != null ? `about ${formatMinutes(n.etaMin)} by road, ` : ''}${n.gapMin < 0 ? 'the sessions overlap.' : `you would have ${formatMinutes(n.gapMin)}.`}`);
    Alert.alert('Tight travel', `${lines.join('\n')}\n\nBid anyway?`, [
      { text: 'Not now', style: 'cancel' },
      { text: 'Bid anyway', onPress: () => { setQuizEta(lines.join(' ')); setQuizLot(lot); } },
    ]);
  };
  const [banner, setBanner] = React.useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const bannerAnim = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    if (!banner) return;
    Animated.spring(bannerAnim, { toValue: 1, friction: 7, tension: 90, useNativeDriver: true }).start();
    const t = setTimeout(() => {
      Animated.timing(bannerAnim, { toValue: 0, duration: 260, useNativeDriver: true }).start(() => setBanner(null));
    }, banner.kind === 'ok' ? 7000 : 9000);
    return () => clearTimeout(t);
  }, [banner, bannerAnim]);

  const lots = lotsQ.data ?? [];
  // The server's own tomorrow wins for the labels once rows are in (a phone on the wrong day still reads right).
  const shownDate = lots[0]?.auction_date ?? date;
  const openCount = lots.filter((l) => l.status !== 'grabbed').length;
  const bidsCount = lots.reduce((n, l) => n + l.bids_count, 0);
  const yoursCount = lots.filter((l) => l.my_points != null || (l.status === 'grabbed' && l.trainer_id === me)).length;

  // While the questions are open, a poll may show the session booked by someone else
  // (CRM roster, Add session): close the sheet at once and say so.
  React.useEffect(() => {
    if (!quizLot) return;
    const fresh = lots.find((l) => l.client_id === quizLot.client_id && l.slot_time === quizLot.slot_time);
    if (fresh && fresh.status === 'grabbed' && fresh.trainer_id !== me) {
      setQuizLot(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      setBanner({ kind: 'err', text: `Booked a moment ago by ${fresh.trainer_name ?? 'another trainer'}. The card shows who got it.` });
    }
  }, [lots, quizLot, me]);

  const onSubmitted = (r: BidResult) => {
    setBanner({ kind: 'ok', text: `Bid placed for ${r.client_name}: ${pointsText(r.points, r.question_count)} correct. Decided at ${win.closesAt}.` });
    refetchLots();
  };

  const noun = physio ? 'rehab session' : 'training';
  const intro = win.phase === 'open'
    ? `Each session is one ${noun}. Answer the client's five questions once; 1 point per right answer. Highest score takes the session at the close, equal scores go to the earlier bid, and the winner's roster and the care team are updated automatically.`
    : win.phase === 'before'
      ? `Preview of tomorrow's sessions. Bidding opens at ${win.opensAt} IST.`
      : `Bidding closed at ${win.closesAt} IST and the sessions are decided. Sessions nobody won go to the care team to fill.`;

  return (
    <Page gap={14} pt={6}>
      {/* Won / lost cards of the last 4 hours */}
      <AuctionResultsCards />

      {/* Hero */}
      <LinearGradient colors={INDIGO} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: 24, padding: 18, gap: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
        <View pointerEvents="none" style={{ position: 'absolute', right: -40, top: -40, width: 170, height: 170, borderRadius: 85, backgroundColor: hexA(C.gold, 0.12) }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <LinearGradient colors={GOLD_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="gavel" size={24} color="#1A1200" strokeWidth={2.2} />
          </LinearGradient>
          <View style={{ flex: 1 }}>
            <Mono style={{ fontSize: 8.5, letterSpacing: 1.6, color: C.gold }}>BEST ANSWERS WIN</Mono>
            <Serif style={{ fontSize: 23, marginTop: 1 }}>Essentials Auction</Serif>
            <Body style={{ fontSize: 12, color: C.ink3, marginTop: 3, lineHeight: 16 }}>
              Tomorrow's Essentials by Odds {physio ? 'rehab sessions' : 'trainings'}. Answer the client's five questions to bid; the best score wins at {win.closesAt}.
            </Body>
          </View>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 11, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' }}>
            <Icon name="calendar" size={12} color="#fff" strokeWidth={2.2} />
            <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: '#fff' }}>Tomorrow · {formatLotDate(shownDate)}</Text>
          </View>
          <WindowPill win={win} reduceMotion={reduceMotion} />
        </View>
        <Mono style={{ fontSize: 8.5, letterSpacing: 1.2, color: C.muted3 }}>BIDS {win.opensAt.toUpperCase()} TO {win.closesAt.toUpperCase()} IST</Mono>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Counter label="OPEN" value={openCount} color={C.gold} />
          <Counter label="BIDS" value={bidsCount} color={INDIGO_SOFT} />
          <Counter label="YOURS" value={yoursCount} color={C.green} />
        </View>
      </LinearGradient>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Body style={{ flex: 1, fontSize: 12.5, color: C.muted2, lineHeight: 18 }}>{intro}</Body>
        <Pressable onPress={() => lotsQ.refetch()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Refresh the sessions"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 7, paddingHorizontal: 11, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}>
          {lotsQ.isFetching ? <ActivityIndicator size="small" color={C.gold} /> : <Icon name="swap" size={13} color={C.ink3} strokeWidth={2.2} />}
          <Text style={{ fontFamily: F.bodySemi, fontSize: 11.5, color: C.ink3 }}>Refresh</Text>
        </Pressable>
      </View>

      {banner ? (
        <Animated.View accessibilityLiveRegion="polite" style={{ opacity: bannerAnim, transform: [{ translateY: bannerAnim.interpolate({ inputRange: [0, 1], outputRange: [-10, 0] }) }], flexDirection: 'row', alignItems: 'center', gap: 10, padding: 13, borderRadius: 16, backgroundColor: hexA(banner.kind === 'ok' ? C.green : C.red, 0.12), borderWidth: 1, borderColor: hexA(banner.kind === 'ok' ? C.green : C.red, 0.4) }}>
          <Icon name={banner.kind === 'ok' ? 'checks' : 'alert'} size={16} color={banner.kind === 'ok' ? C.green : C.red} strokeWidth={2.4} />
          <Body style={{ flex: 1, fontSize: 12.5, color: '#fff', lineHeight: 18 }}>{banner.text}</Body>
        </Animated.View>
      ) : null}

      {lotsQ.isPending ? (
        <View style={{ alignItems: 'center', gap: 10, paddingVertical: 40 }}>
          <ActivityIndicator color={C.gold} />
          <Body style={{ fontSize: 12.5, color: C.muted3 }}>Opening tomorrow's sessions…</Body>
        </View>
      ) : lotsQ.isError ? (
        <Card colors={['rgba(74,28,20,0.5)', 'rgba(24,14,13,0.55)']} border={hexA(C.red, 0.4)} radius={20} style={{ padding: 16, gap: 10 }}>
          <Serif style={{ fontSize: 17 }}>Could not load the auction.</Serif>
          <Body style={{ fontSize: 12.5, color: C.ink3, lineHeight: 18 }}>{(lotsQ.error as Error).message}</Body>
          <Pressable onPress={() => lotsQ.refetch()} hitSlop={10} accessibilityRole="button" style={{ alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: hexA(C.red, 0.16), borderWidth: 1, borderColor: hexA(C.red, 0.4) }}>
            <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: C.red }}>Try again</Text>
          </Pressable>
        </Card>
      ) : lots.length === 0 ? (
        <Card radius={20} style={{ padding: 22, alignItems: 'center', gap: 8 }}>
          <View style={{ width: 54, height: 54, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: hexA(C.gold, 0.1), borderWidth: 1, borderColor: hexA(C.gold, 0.3) }}>
            <Icon name="gavel" size={24} color={C.gold} strokeWidth={2} />
          </View>
          <Serif style={{ fontSize: 18 }}>No sessions for tomorrow</Serif>
          <Body style={{ fontSize: 12.5, color: C.muted2, textAlign: 'center', lineHeight: 18 }}>
            No Essentials by Odds client has a {noun} set for {formatLotDate(shownDate)} that is still unbooked. Sessions appear as clients save their week in the app.
          </Body>
        </Card>
      ) : (
        <View style={{ gap: 12 }}>
          {lots.map((lot, i) => (
            <LotCard key={`${lot.client_id}-${lot.slot_time}`} lot={lot} index={i} me={me} win={win} now={now} reduceMotion={reduceMotion}
              photo={photos[lot.client_id] ?? null} onPhoto={photos[lot.client_id] ? () => setPhotoFor({ url: photos[lot.client_id], name: lot.client_name }) : undefined}
              eta={etaOf(lot)}
              onBid={() => openQuiz(lot)} />
          ))}
        </View>
      )}

      <Body style={{ fontSize: 10.5, color: C.muted3, textAlign: 'center', lineHeight: 15 }}>
        India time. The server checks the window again when you bid, so a wrong phone clock cannot bid outside it.
      </Body>

      <AuctionQuizSheet lot={quizLot} physio={physio} photo={quizLot ? photos[quizLot.client_id] ?? null : null} closesAt={win.closesAt} etaWarning={quizEta}
        onClose={() => { setQuizLot(null); refetchLots(); }} onSubmitted={onSubmitted} />
      <PhotoLightbox item={photoFor} onClose={() => setPhotoFor(null)} />
    </Page>
  );
}
