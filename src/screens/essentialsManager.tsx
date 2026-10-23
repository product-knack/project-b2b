/* Essentials Manager (22 Oct 2026): the page of the essential_manager specialization (or role; admins too).
   - One hour before the Essentials Auction closes: the sessions with no bid, each pushable into any current My Crew
     (once per crew): the crew gets a card in its stream, every member a push, and the card opens that session on
     the auction page.
   - After the close: the sessions still unsold can be assigned to anyone free one hour either side of them that
     day (trainers and coaches for trainings, physios for rehab); the person gets the roster row, a crew entry and
     a push. Backend: hub-track migrations 20261022200100 / 210000 / 220000. Rules: src/lib/essentialsUnsold.ts.
   Sheet rules: sibling backdrop, hitSlop >= 10, one Modal at a time (the two pickers never open together). */
import React from 'react';
import { View, Text, Pressable, Modal, ScrollView, ActivityIndicator, AppState } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono, Card } from '../components/primitives';
import { Page } from './common';
import { useAuth } from '../auth';
import { serverNow } from '../lib/managerChatQueries';
import { useAssignUnsold, useEssentialsCrews, useEssentialsFreeStaff, useEssentialsUnsold, usePushUnsoldToCrew, useUnsoldWindow } from '../lib/essentialsManagerQueries';
import {
  DEFAULT_UNSOLD_WINDOW, alreadyPushedTo, assignOpen, assignPreview, countdownText, hm12, phaseText, pushPreview, pushedLines,
  roleLabel, staffDayLine, unsoldPhase, type Crew, type FreeStaff, type UnsoldLot,
} from '../lib/essentialsUnsold';

const GOLD = C.gold;

const SheetFrame = ({ visible, onClose, busy, bottom, children }: { visible: boolean; onClose: () => void; busy: boolean; bottom: number; children: React.ReactNode }) => (
  <Modal visible={visible} transparent animationType="slide" onRequestClose={() => { if (!busy) onClose(); }}>
    <View style={{ flex: 1, justifyContent: 'flex-end' }}>
      <Pressable onPress={() => { if (!busy) onClose(); }} accessibilityRole="button" accessibilityLabel="Close" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.65)' }} />
      <View style={{ maxHeight: '85%', backgroundColor: '#0E0A09', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: hexA(GOLD, 0.25), paddingHorizontal: 18, paddingTop: 14, paddingBottom: bottom + 18, gap: 12 }}>
        <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center' }} />
        {children}
      </View>
    </View>
  </Modal>
);

const GhostButton = ({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) => (
  <Pressable onPress={onPress} disabled={disabled} hitSlop={10} style={{ flex: 1, alignItems: 'center', paddingVertical: 13, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
    <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: C.ink }}>{label}</Text>
  </Pressable>
);

export function EssentialsManager() {
  const insets = useSafeAreaInsets();
  const { profile } = useAuth() as any;
  const myName: string | null = profile ? `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || null : null;
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
  const assignM = useAssignUnsold();
  const [pickFor, setPickFor] = React.useState<UnsoldLot | null>(null);
  const [confirm, setConfirm] = React.useState<Crew | null>(null);
  const [assignFor, setAssignFor] = React.useState<UnsoldLot | null>(null);
  const [assignPick, setAssignPick] = React.useState<FreeStaff | null>(null);
  const staffQ = useEssentialsFreeStaff(assignFor?.client_id ?? null, assignFor?.slot_time ?? null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const lots = lotsQ.data ?? [];
  const closeAll = () => { setConfirm(null); setPickFor(null); setAssignPick(null); setAssignFor(null); };

  const doPush = async () => {
    if (!pickFor || !confirm) return;
    try {
      const r = await pushM.mutateAsync({ clientId: pickFor.client_id, slotTime: pickFor.slot_time, scoreId: confirm.score_id });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setNotice(`Pushed ${pickFor.client_name} to ${r.teamName}. ${r.memberCount} member${r.memberCount === 1 ? '' : 's'} alerted.`);
      closeAll();
    } catch (e: any) { setNotice(e?.message || 'Could not push the session.'); setConfirm(null); }
  };
  const doAssign = async () => {
    if (!assignFor || !assignPick) return;
    try {
      const r = await assignM.mutateAsync({ clientId: assignFor.client_id, slotTime: assignFor.slot_time, trainerId: assignPick.id });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setNotice(`${r.clientName} at ${hm12(assignFor.slot_time)} is assigned to ${r.trainerName}. They have been told and it is on their roster.`);
      closeAll();
    } catch (e: any) { setNotice(e?.message || 'Could not assign the session.'); setAssignPick(null); staffQ.refetch(); }
  };

  const pillLabel = phase === 'open' ? countdownText(now, w).toUpperCase() : phase === 'before' ? `OPENS ${hm12(w.alert_from).toUpperCase()}` : 'CLOSED · ASSIGN';
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
              <Mono style={{ fontSize: 9, letterSpacing: 0.6, color: phase === 'open' ? C.green : GOLD }}>{pillLabel}</Mono>
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
          <Body style={{ fontSize: 12.5, color: C.muted2, textAlign: 'center', lineHeight: 18 }}>Every session in tomorrow's auction has a bid, a decision or someone assigned.</Body>
        </Card>
      ) : (
        <View style={{ gap: 12 }}>
          <Mono style={{ fontSize: 9, letterSpacing: 1, color: C.muted2 }}>{lots.length} UNSOLD · TOMORROW</Mono>
          {lots.map((lot) => {
            const canAssign = assignOpen(lot, now, w);
            return (
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
                    <Mono style={{ fontSize: 9, letterSpacing: 0.5, color: C.red }}>{lot.round_result === 'no_bids' ? 'NO BIDS' : '0 BIDS'}</Mono>
                  </View>
                </View>
                {pushedLines(lot).map((l) => (
                  <View key={l} style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                    <Icon name="checks" size={12} color={C.green} strokeWidth={2.4} />
                    <Body style={{ flex: 1, fontSize: 11.5, color: C.green }}>{l}</Body>
                  </View>
                ))}
                {phase === 'closed' ? (
                  <>
                    <Pressable onPress={() => setAssignFor(lot)} disabled={!canAssign} hitSlop={10} accessibilityRole="button"
                      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 12, borderRadius: 13, backgroundColor: hexA(GOLD, canAssign ? 0.16 : 0.06), borderWidth: 1, borderColor: hexA(GOLD, canAssign ? 0.5 : 0.2), opacity: canAssign ? 1 : 0.6 }}>
                      <Icon name="userPlus" size={14} color={GOLD} strokeWidth={2.2} />
                      <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: GOLD }}>Assign someone free</Text>
                    </Pressable>
                    {!canAssign ? <Body style={{ fontSize: 10.5, color: C.muted3 }}>This session has already started.</Body> : null}
                  </>
                ) : (
                  <>
                    <Pressable onPress={() => setPickFor(lot)} disabled={phase !== 'open'} hitSlop={10} accessibilityRole="button"
                      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 12, borderRadius: 13, backgroundColor: hexA(GOLD, phase === 'open' ? 0.16 : 0.06), borderWidth: 1, borderColor: hexA(GOLD, phase === 'open' ? 0.5 : 0.2), opacity: phase === 'open' ? 1 : 0.6 }}>
                      <Icon name="users" size={14} color={GOLD} strokeWidth={2.2} />
                      <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: GOLD }}>{lot.pushes.length ? 'Push to another crew' : 'Push to a crew'}</Text>
                    </Pressable>
                    {phase === 'before' ? <Body style={{ fontSize: 10.5, color: C.muted3 }}>Pushing opens at {hm12(w.alert_from)}.</Body> : null}
                  </>
                )}
              </Card>
            );
          })}
        </View>
      )}

      {/* Crew picker (window open): two steps inside one Modal. */}
      <SheetFrame visible={!!pickFor} onClose={closeAll} busy={pushM.isPending} bottom={insets.bottom}>
        {pickFor ? (
          confirm ? (
            <>
              <Serif style={{ fontSize: 20 }}>Push to {confirm.team_name}?</Serif>
              <Body style={{ fontSize: 12.5, color: C.muted2, lineHeight: 18 }}>{confirm.member_count} member{confirm.member_count === 1 ? '' : 's'}{confirm.manager_name ? ` and ${confirm.manager_name}` : ''} get this push and a card in their My Crew:</Body>
              <View style={{ padding: 12, borderRadius: 14, backgroundColor: hexA(GOLD, 0.08), borderWidth: 1, borderColor: hexA(GOLD, 0.3) }}>
                <Body style={{ fontSize: 12.5, color: '#fff', lineHeight: 18 }}>{pushPreview(pickFor, w.close)}</Body>
              </View>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <GhostButton label="Back" onPress={() => setConfirm(null)} disabled={pushM.isPending} />
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
              <GhostButton label="Cancel" onPress={closeAll} />
            </>
          )
        ) : null}
      </SheetFrame>

      {/* Free-staff picker (after the close): two steps inside one Modal. */}
      <SheetFrame visible={!!assignFor} onClose={closeAll} busy={assignM.isPending} bottom={insets.bottom}>
        {assignFor ? (
          assignPick ? (
            <>
              <Serif style={{ fontSize: 20 }}>Assign to {assignPick.name}?</Serif>
              <Body style={{ fontSize: 12.5, color: C.muted2, lineHeight: 18 }}>{roleLabel(assignPick)} · {staffDayLine(assignPick)}{assignPick.trained_yesterday ? ' · trained this client yesterday' : ''}. The session goes on their roster and they get this push:</Body>
              <View style={{ padding: 12, borderRadius: 14, backgroundColor: hexA(GOLD, 0.08), borderWidth: 1, borderColor: hexA(GOLD, 0.3) }}>
                <Body style={{ fontSize: 12.5, color: '#fff', lineHeight: 18 }}>{assignPreview(assignFor, assignPick.name, myName)}</Body>
              </View>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <GhostButton label="Back" onPress={() => setAssignPick(null)} disabled={assignM.isPending} />
                <Pressable onPress={doAssign} disabled={assignM.isPending} hitSlop={10} style={{ flex: 1.3, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 13, borderRadius: 13, backgroundColor: hexA(GOLD, 0.18), borderWidth: 1, borderColor: hexA(GOLD, 0.5) }}>
                  {assignM.isPending ? <ActivityIndicator size="small" color={GOLD} /> : <Icon name="checks" size={13} color={GOLD} strokeWidth={2.4} />}
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: GOLD }}>{assignM.isPending ? 'Assigning…' : 'Assign now'}</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <Serif style={{ fontSize: 20 }}>Assign {assignFor.client_name}</Serif>
              <Body style={{ fontSize: 12.5, color: C.muted2, lineHeight: 18 }}>{hm12(assignFor.slot_time)} · {assignFor.modality} tomorrow. Everyone below has nothing within an hour either side of it that day. Fewest sessions first.</Body>
              <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 6 }}>
                {staffQ.isLoading ? (
                  <ActivityIndicator color={GOLD} style={{ paddingVertical: 20 }} />
                ) : staffQ.isError ? (
                  <Body style={{ fontSize: 12.5, color: C.red, paddingVertical: 12 }}>{(staffQ.error as Error).message}</Body>
                ) : (staffQ.data ?? []).length === 0 ? (
                  <Body style={{ fontSize: 12.5, color: C.muted2, paddingVertical: 12 }}>Nobody is free an hour either side of this session.</Body>
                ) : (staffQ.data ?? []).map((s) => (
                  <Pressable key={s.id} onPress={() => setAssignPick(s)} hitSlop={6} accessibilityRole="button"
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 14, backgroundColor: hexA(GOLD, 0.06), borderWidth: 1, borderColor: hexA(GOLD, 0.3) }}>
                    <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: hexA(s.is_physio ? C.blue : C.green, 0.16), alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: s.is_physio ? C.blue : C.green }}>{s.name.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('')}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: '#fff' }} numberOfLines={1}>{s.name}</Text>
                      <Body style={{ fontSize: 11, color: C.muted2, marginTop: 1 }}>{roleLabel(s)} · {staffDayLine(s)}</Body>
                      {s.trained_yesterday ? <Mono style={{ fontSize: 8, letterSpacing: 0.5, color: GOLD, marginTop: 2 }}>TRAINED THIS CLIENT YESTERDAY</Mono> : null}
                    </View>
                    <Mono style={{ fontSize: 8.5, letterSpacing: 0.5, color: GOLD }}>PICK</Mono>
                  </Pressable>
                ))}
              </ScrollView>
              <GhostButton label="Cancel" onPress={closeAll} />
            </>
          )
        ) : null}
      </SheetFrame>
    </Page>
  );
}
