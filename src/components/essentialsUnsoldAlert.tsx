/* Essentials Auction unsold alerts for crew members (22 Oct 2026).
   - EssentialsUnsoldAlert: the trainer / physio home banner while an unsold session pushed into my crew is still
     open for bids; a tap opens the auction page scrolled to that card.
   - EssentialsUnsoldCrewCard: the same session as a card in the My Crew stream (kind auction_unsold).
   Rules in src/lib/essentialsUnsold.ts. */
import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono } from './primitives';
import { useStore } from '../store';
import { serverNow } from '../lib/managerChatQueries';
import { useUnsoldCrewAlerts, useUnsoldWindow } from '../lib/essentialsManagerQueries';
import { unsoldAlertLive, unsoldLine, hm12, DEFAULT_UNSOLD_WINDOW } from '../lib/essentialsUnsold';

const GOLD = C.gold;

export function EssentialsUnsoldAlert() {
  const { go, set } = useStore();
  const alertsQ = useUnsoldCrewAlerts();
  const winQ = useUnsoldWindow();
  const w = winQ.data ?? DEFAULT_UNSOLD_WINDOW;
  const now = serverNow().getTime();
  const live = (alertsQ.data ?? []).filter((a) => unsoldAlertLive(a.date, now, w));
  if (!live.length) return null;
  const open = (clientId: string) => { set({ auctionFocusClientId: clientId }); go('essentials-auction'); };
  return (
    <View style={{ borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: hexA(GOLD, 0.45) }}>
      <LinearGradient colors={['rgba(72,52,10,0.75)', 'rgba(26,18,8,0.9)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: 14, gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
          <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: hexA(GOLD, 0.16), alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="gavel" size={15} color={GOLD} strokeWidth={2.1} />
          </View>
          <View style={{ flex: 1 }}>
            <Mono style={{ fontSize: 8.5, letterSpacing: 0.9, color: GOLD }}>ESSENTIALS AUCTION · STILL UNSOLD</Mono>
            <Serif style={{ fontSize: 16, marginTop: 1 }}>{live.length === 1 ? 'A session pushed to your crew' : `${live.length} sessions pushed to your crew`}</Serif>
          </View>
        </View>
        {live.slice(0, 3).map((a) => (
          <Pressable key={a.messageId} onPress={() => open(a.clientId)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Open ${a.name} in the auction`}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 9, paddingHorizontal: 11, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: hexA(GOLD, 0.22) }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: '#fff' }} numberOfLines={1}>{unsoldLine(a.name, a.time, a.modality)}</Text>
              <Body style={{ fontSize: 10.5, color: C.muted2, marginTop: 1 }}>{a.pushedByName ? `Pushed by ${a.pushedByName}` : 'Pushed by the Essentials manager'} · bid before {hm12(w.close)}</Body>
            </View>
            <View style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, backgroundColor: hexA(GOLD, 0.16), borderWidth: 1, borderColor: hexA(GOLD, 0.45) }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: GOLD }}>Answer and bid</Text>
            </View>
          </Pressable>
        ))}
      </LinearGradient>
    </View>
  );
}

/** The My Crew stream card for one auction_unsold message. */
export function EssentialsUnsoldCrewCard({ payload, createdAt }: { payload: any; createdAt: string }) {
  const { go, set } = useStore();
  const winQ = useUnsoldWindow();
  const w = winQ.data ?? DEFAULT_UNSOLD_WINDOW;
  const live = unsoldAlertLive(payload?.date, serverNow().getTime(), w);
  const clientId = payload?.client_id ? String(payload.client_id) : null;
  const closeHm = typeof payload?.close === 'string' ? payload.close.slice(0, 5) : w.close;
  return (
    <View style={{ borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: hexA(GOLD, live ? 0.45 : 0.2), opacity: live ? 1 : 0.75 }}>
      <LinearGradient colors={['rgba(72,52,10,0.7)', 'rgba(26,18,8,0.9)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: 13, gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Icon name="gavel" size={14} color={GOLD} strokeWidth={2.1} />
          <Mono style={{ flex: 1, fontSize: 8.5, letterSpacing: 0.9, color: GOLD }}>UNSOLD IN THE ESSENTIALS AUCTION</Mono>
          <Mono style={{ fontSize: 8.5, color: C.muted3 }}>{new Date(createdAt).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase()}</Mono>
        </View>
        <Text style={{ fontFamily: F.bodyBold, fontSize: 14.5, color: '#fff' }}>{unsoldLine(String(payload?.name ?? 'Client'), String(payload?.time ?? '').slice(0, 5), payload?.modality)}</Text>
        <Body style={{ fontSize: 11.5, color: C.ink3, lineHeight: 16 }}>
          {payload?.pushed_by_name ? `${payload.pushed_by_name} pushed this session to the crew. ` : ''}
          {live ? `No bid yet. Answer the client's questions before ${hm12(closeHm)} to win it.` : 'This auction has closed.'}
        </Body>
        {clientId ? (
          <Pressable onPress={() => { set({ auctionFocusClientId: clientId }); go('essentials-auction'); }} disabled={!live} hitSlop={8} accessibilityRole="button"
            style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 13, borderRadius: 999, backgroundColor: hexA(GOLD, live ? 0.18 : 0.08), borderWidth: 1, borderColor: hexA(GOLD, live ? 0.5 : 0.2) }}>
            <Icon name="chevRight" size={12} color={GOLD} strokeWidth={2.4} />
            <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: GOLD }}>{live ? 'Open in the auction' : 'Closed'}</Text>
          </Pressable>
        ) : null}
      </LinearGradient>
    </View>
  );
}
