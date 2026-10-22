/* Essentials Manager (22 Oct 2026): the only page of profiles.role = essential_manager (admins may open it too).
   One hour before the Essentials Auction closes, the sessions with no bid are listed; each can be pushed into
   any current My Crew (once per crew): the crew gets a card in its stream, every member a push, and the card opens
   that session on the auction page. Backend: hub-track migration 20261022200100. Rules: src/lib/essentialsUnsold.ts.
   Sheet rules: sibling backdrop, hitSlop >= 10, one Modal at a time. */
import React from 'react';
import { View, Text, Pressable, Modal, ScrollView, ActivityIndicator, AppState } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono, Card } from '../components/primitives';
import { Page } from './common';
import { serverNow } from '../lib/managerChatQueries';
import { useEssentialsCrews, useEssentialsUnsold, usePushUnsoldToCrew, useUnsoldWindow } from '../lib/essentialsManagerQueries';
import { DEFAULT_UNSOLD_WINDOW, alreadyPushedTo, countdownText, hm12, phaseText, pushPreview, pushedLines, unsoldPhase, type Crew, type UnsoldLot } from '../lib/essentialsUnsold';

const GOLD = C.gold;

export function EssentialsManager() {
  const insets = useSafeAreaInsets();
  const winQ = useUnsoldWindow();
  const w = winQ.data ?? DEFAULT_UNSOLD_WINDOW;
  const [now, setNow] = React.useState(() => serverNow().getTime());
  React.useEffect(() => {
    const id = setInterval(() => setNow(serverNow().getTime()), 15_000);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') setNow(serverNow().getTime()); });
    return () => { clearInterval(id); sub.remove(); };
  }, []);
  const phase = unsoldPhase(now, w);
  const lotsQ = useEssentialsUnsold();
  const crewsQ = useEssentialsCrews();
  const pushM = usePushUnsoldToCrew();
  const [pickFor, setPickFor] = React.useState<UnsoldLot | null>(null);
  const [confirm, setConfirm] = React.useState<Crew | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const lots = lotsQ.data ?? [];

  const doPush = async () => {
    if (!pickFor || !confirm) return;
    try {
      const r = await pushM.mutateAsync({ clientId: pickFor.client_id, slotTime: pickFor.slot_time, scoreId: confirm.score_id });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setNotice(`Pushed ${pickFor.client_name} to ${r.teamName}. ${r.memberCount} member${r.memberCount === 1 ? '' : 's'} alerted.`);
      setConfirm(null); setPickFor(null);
    } catch (e: any) {
      setNotice(e?.message || 'Could not push the session.');
      setConfirm(null);
    }
  };

  return (
    <Page gap={14} pt={6} pb={40 + insets.bottom}>
      <View style={{ borderRadius: 22, overflow: 'hidden', borderWidth: 1, borderColor: hexA(GOLD, 0.35) }}>
        <LinearGradient colors={['#2A1E55', '#120E2A']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: 18, gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: hexA(GOLD, 0.18), alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="gavel" size={20} color={GOLD} strokeWidth={2} />
            </View>
            <View style={{ flex: 1 }}>
              <Mono style={{ fontSize: 8.5, letterSpacing: 1, color: GOLD }}>ESSENTIALS MANAGER</Mono>
              <Serif style={{ fontSize: 22, marginTop: 1 }}>Unsold sessions</Serif>
            </View>
          </View>
          <Body style={{ fontSize: 12.5, color: C.ink3, lineHeight: 18 }}>{phaseText(phase, w)}</Body>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <View style={{ paddingVertical: 5, paddingHorizontal: 11, borderRadius: 999, backgroundColor: hexA(phase === 'open' ? C.green : GOLD, 0.16), borderWidth: 1, borderColor: hexA(phase === 'open' ? C.green : GOLD, 0.45) }}>
              <Mono style={{ fontSize: 9, letterSpacing: 0.6, color: phase === 'open' ? C.green : GOLD }}>{phase === 'open' ? countdownText(now, w).toUpperCase() : phase === 'before' ? `OPENS ${hm12(w.alert_from).toUpperCase()}` : 'CLOSED'}</Mono>
            </View>
            <Mono style={{ fontSize: 9, color: C.muted2 }}>AUCTION CLOSES {hm12(w.close).toUpperCase()} IST</Mono>
          </View>
        </LinearGradient>
      </View>

      {notice ? (
        <Pressable onPress={() => setNotice(null)} style={{ padding: 12, borderRadius: 14, backgroundColor: hexA(GOLD, 0.08), borderWidth: 1, borderColor: hexA(GOLD, 0.3) }}>
          <Body style={{ fontSize: 12.5, color: '#fff' }}>{notice}</Body>
        </Pressable>
      ) : null}

      {lotsQ.isLoading ? (
        <View style={{ alignItems: 'center', gap: 10, paddingVertical: 40 }}>
          <ActivityIndicator color={GOLD} />
          <Body style={{ fontSize: 12.5, color: C.muted3 }}>Checking tomorrow's sessions…</Body>
        </View>
      ) : lotsQ.isError ? (
        <Card radius={20} style={{ padding: 16, gap: 10 }}>
          <Serif style={{ fontSize: 17 }}>Could not load the sessions.</Serif>
          <Body style={{ fontSize: 12.5, color: C.ink3 }}>{(lotsQ.error as Error).message}</Body>
          <Pressable onPress={() => lotsQ.refetch()} hitSlop={10} style={{ alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: hexA(C.red, 0.12), borderWidth: 1, borderColor: hexA(C.red, 0.4) }}>
            <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: C.red }}>Try again</Text>
          </Pressable>
        </Card>
      ) : lots.length === 0 ? (
        <Card radius={20} style={{ padding: 22, alignItems: 'center', gap: 8 }}>
          <Icon name="checks" size={26} color={C.green} strokeWidth={2} />
          <Serif style={{ fontSize: 18 }}>Nothing unsold</Serif>
          <Body style={{ fontSize: 12.5, color: C.muted2, textAlign: 'center', lineHeight: 18 }}>Every session in tomorrow's auction has a bid or a decision.</Body>
        </Card>
      ) : (
        <View style={{ gap: 12 }}>
          <Mono style={{ fontSize: 9, letterSpacing: 1, color: C.muted2 }}>{lots.length} UNSOLD · TOMORROW</Mono>
          {lots.map((lot) => (
            <Card key={`${lot.client_id}-${lot.slot_time}`} radius={20} style={{ padding: 15, gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: hexA(GOLD, 0.12), borderWidth: 1, borderColor: hexA(GOLD, 0.3), alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: GOLD }}>{lot.client_name.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('')}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: '#fff' }} numberOfLines={1}>{lot.client_name}</Text>
                  <Body style={{ fontSize: 12, color: C.muted2, marginTop: 1 }}>{hm12(lot.slot_time)} · {lot.modality}{lot.preferred_trainer_name ? ` · usually ${lot.preferred_trainer_name}` : ''}</Body>
                </View>
                <View style={{ paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999, backgroundColor: hexA(C.red, 0.12), borderWidth: 1, borderColor: hexA(C.red, 0.4) }}>
                  <Mono style={{ fontSize: 9, letterSpacing: 0.5, color: C.red }}>0 BIDS</Mono>
                </View>
              </View>
              {pushedLines(lot).map((l) => (
                <View key={l} style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                  <Icon name="checks" size={12} color={C.green} strokeWidth={2.4} />
                  <Body style={{ flex: 1, fontSize: 11.5, color: C.green }}>{l}</Body>
                </View>
              ))}
              <Pressable onPress={() => setPickFor(lot)} disabled={phase !== 'open'} hitSlop={10} accessibilityRole="button"
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 12, borderRadius: 13, backgroundColor: hexA(GOLD, phase === 'open' ? 0.16 : 0.06), borderWidth: 1, borderColor: hexA(GOLD, phase === 'open' ? 0.5 : 0.2), opacity: phase === 'open' ? 1 : 0.6 }}>
                <Icon name="users" size={14} color={GOLD} strokeWidth={2.2} />
                <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: GOLD }}>{lot.pushes.length ? 'Push to another crew' : 'Push to a crew'}</Text>
              </Pressable>
              {phase !== 'open' ? <Body style={{ fontSize: 10.5, color: C.muted3 }}>{phase === 'before' ? `Pushing opens at ${hm12(w.alert_from)}.` : 'The auction has closed.'}</Body> : null}
            </Card>
          ))}
        </View>
      )}

      {/* Crew picker (one Modal; the confirm is a second step inside it, never a sibling modal). */}
      <Modal visible={!!pickFor} transparent animationType="slide" onRequestClose={() => { if (!pushM.isPending) { setConfirm(null); setPickFor(null); } }}>
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable onPress={() => { if (!pushM.isPending) { setConfirm(null); setPickFor(null); } }} accessibilityRole="button" accessibilityLabel="Close" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.65)' }} />
          <View style={{ maxHeight: '85%', backgroundColor: '#0E0A09', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: hexA(GOLD, 0.25), paddingHorizontal: 18, paddingTop: 14, paddingBottom: insets.bottom + 18, gap: 12 }}>
            <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center' }} />
            {pickFor ? (
              confirm ? (
                <>
                  <Serif style={{ fontSize: 20 }}>Push to {confirm.team_name}?</Serif>
                  <Body style={{ fontSize: 12.5, color: C.muted2, lineHeight: 18 }}>{confirm.member_count} member{confirm.member_count === 1 ? '' : 's'}{confirm.manager_name ? ` and ${confirm.manager_name}` : ''} get this push and a card in their My Crew:</Body>
                  <View style={{ padding: 12, borderRadius: 14, backgroundColor: hexA(GOLD, 0.08), borderWidth: 1, borderColor: hexA(GOLD, 0.3) }}>
                    <Body style={{ fontSize: 12.5, color: '#fff', lineHeight: 18 }}>{pushPreview(pickFor, w.close)}</Body>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <Pressable onPress={() => setConfirm(null)} disabled={pushM.isPending} hitSlop={10} style={{ flex: 1, alignItems: 'center', paddingVertical: 13, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
                      <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: C.ink }}>Back</Text>
                    </Pressable>
                    <Pressable onPress={doPush} disabled={pushM.isPending} hitSlop={10} style={{ flex: 1.3, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 13, borderRadius: 13, backgroundColor: hexA(GOLD, 0.18), borderWidth: 1, borderColor: hexA(GOLD, 0.5) }}>
                      {pushM.isPending ? <ActivityIndicator size="small" color={GOLD} /> : <Icon name="send" size={13} color={GOLD} strokeWidth={2.3} />}
                      <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: GOLD }}>{pushM.isPending ? 'Pushing…' : 'Push now'}</Text>
                    </Pressable>
                  </View>
                </>
              ) : (
                <>
                  <Serif style={{ fontSize: 20 }}>Push {pickFor.client_name} to a crew</Serif>
                  <Body style={{ fontSize: 12.5, color: C.muted2, lineHeight: 18 }}>{hm12(pickFor.slot_time)} · {pickFor.modality} tomorrow. Pick the crew whose members should bid. A session can go to several crews, once each.</Body>
                  <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 6 }}>
                    {crewsQ.isLoading ? (
                      <ActivityIndicator color={GOLD} style={{ paddingVertical: 20 }} />
                    ) : (crewsQ.data ?? []).length === 0 ? (
                      <Body style={{ fontSize: 12.5, color: C.muted2, paddingVertical: 12 }}>No crew is running right now.</Body>
                    ) : (crewsQ.data ?? []).map((c) => {
                      const done = alreadyPushedTo(pickFor, c.score_id);
                      return (
                        <Pressable key={c.score_id} onPress={() => !done && setConfirm(c)} disabled={done} hitSlop={6} accessibilityRole="button"
                          style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 14, backgroundColor: done ? 'rgba(255,255,255,0.03)' : hexA(GOLD, 0.06), borderWidth: 1, borderColor: done ? 'rgba(255,255,255,0.08)' : hexA(GOLD, 0.3), opacity: done ? 0.6 : 1 }}>
                          <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: hexA(C.purple, 0.16), alignItems: 'center', justifyContent: 'center' }}>
                            <Icon name="users" size={15} color={C.purple} strokeWidth={2.1} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: '#fff' }} numberOfLines={1}>{c.team_name}</Text>
                            <Body style={{ fontSize: 11, color: C.muted2, marginTop: 1 }}>{c.manager_name ? `${c.manager_name} · ` : ''}{c.member_count} member{c.member_count === 1 ? '' : 's'}</Body>
                          </View>
                          <Mono style={{ fontSize: 8.5, letterSpacing: 0.5, color: done ? C.green : GOLD }}>{done ? 'PUSHED' : 'PICK'}</Mono>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                  <Pressable onPress={() => setPickFor(null)} hitSlop={10} style={{ alignItems: 'center', paddingVertical: 12, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
                    <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: C.ink }}>Cancel</Text>
                  </Pressable>
                </>
              )
            ) : null}
          </View>
        </View>
      </Modal>
    </Page>
  );
}
