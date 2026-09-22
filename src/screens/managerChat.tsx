import React from 'react';
import { View, Text, Pressable, ScrollView, FlatList, Image, TextInput, Keyboard, Platform, Modal, ActivityIndicator, Animated, Easing, Alert, PanResponder } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { backSwipeLock } from '../gestureLock';
import { withTimeout, NET_MS } from '../lib/withTimeout';
import { C, F, hexA, ORANGE_GRAD } from '../theme';
import { Icon } from '../icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Serif, Body, Mono, ProgressBar } from '../components/primitives';
import { HScroll } from './common';
import { useStore } from '../store';
import { useAuth } from '../auth';
import { istDayLabel, istTimeParts } from '../lib/trainerQueries';
import { supabase } from '../lib/supabase';
import {
  useMyManagerTeam, useManagerTeamMessages, useManagerChatRealtime, useSendManagerTeamMessage,
  useManagerChatUnread, markManagerChatRead, useTomorrowCompose, tomorrowPlanBody, fmt12h,
  usePlanOutcome, usePlanScheduleRows, useMemberClients, usePhysioHod, useHodTeams, useHodFeedMessages, useClientProtocols, ClientProtocol, protoModalityLabel, protoEntryCount, istToday, serverNow, ManagerChatMessage, ManagerTeamInfo, TomorrowPlanEntry, PlanRescheduleHop,
  TRAINER_MODALITIES, DOCTOR_MODALITIES, THERAPIST_MODALITIES, isHodManagedRole, TeamFlagTrainer,
} from '../lib/managerChatQueries';
import { useQueryClient } from '@tanstack/react-query';

/* "My Crew" identity: PINK (user pick). Semantic colors stay: green =
   done/approved, red = missed/rejected, gold = plans/times. */
const PINK = '#F06A9B';
const PINK_SOFT = '#F5B8CE';
const PINK_GRAD = ['#F06A9B', '#D14E80'] as [string, string];
const NEW_PILL_UNTIL = '2026-08-30'; // green NEW pill on the home card, IST inclusive
const BLUE = '#7C8FE8'; // protocol chip identity

/* Right-drag any bubble/card → quoted reply (same gesture as the client chat).
   Locks the edge back-gesture while dragging so it can't navigate away. */
function SwipeReply({ enabled, onReply, children }: { enabled: boolean; onReply: () => void; children: React.ReactNode }) {
  const tx = React.useRef(new Animated.Value(0)).current;
  const fired = React.useRef(false);
  // A bubble re-keyed/unmounted mid-drag never fires Release → release the lock.
  React.useEffect(() => () => { backSwipeLock.locked = false; }, []);
  const enabledRef = React.useRef(enabled); enabledRef.current = enabled;
  const onReplyRef = React.useRef(onReply); onReplyRef.current = onReply;
  const springBack = () => Animated.spring(tx, { toValue: 0, useNativeDriver: true, speed: 20, bounciness: 5 }).start();
  const pan = React.useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => enabledRef.current && g.dx > 14 && Math.abs(g.dx) > Math.abs(g.dy) * 1.6,
      onPanResponderGrant: () => { backSwipeLock.locked = true; fired.current = false; },
      onPanResponderMove: (_e, g) => {
        const v = Math.max(0, Math.min(g.dx, 76));
        tx.setValue(v);
        if (v > 52 && !fired.current) {
          fired.current = true;
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        }
      },
      onPanResponderRelease: (_e, g) => {
        backSwipeLock.locked = false;
        if (g.dx > 52) onReplyRef.current();
        springBack();
      },
      onPanResponderTerminate: () => { backSwipeLock.locked = false; springBack(); },
      onPanResponderTerminationRequest: () => false,
    })
  ).current;
  const iconOpacity = tx.interpolate({ inputRange: [0, 24, 60], outputRange: [0, 0.25, 1] });
  const iconScale = tx.interpolate({ inputRange: [0, 60], outputRange: [0.6, 1], extrapolate: 'clamp' });
  return (
    <View {...pan.panHandlers}>
      <Animated.View style={{ position: 'absolute', left: 6, top: 0, bottom: 0, justifyContent: 'center', opacity: iconOpacity, transform: [{ scale: iconScale }] }}>
        <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: hexA(PINK, 0.16), borderWidth: 1, borderColor: hexA(PINK, 0.35), alignItems: 'center', justifyContent: 'center' }}>
          <Icon path="M9 17l-5-5 5-5M4 12h10a5 5 0 0 1 5 5v2" size={15} color={PINK} strokeWidth={2.2} />
        </View>
      </Animated.View>
      <Animated.View style={{ transform: [{ translateX: tx }] }}>{children}</Animated.View>
    </View>
  );
}

/* Quoted mini-block rendered inside a bubble (reply_to payload). Tap → jump. */
function QuoteBlock({ q, mine, onJump }: { q: { id: string; name: string; body: string }; mine: boolean; onJump: (id: string) => void }) {
  return (
    <Pressable onPress={() => onJump(q.id)} style={{ flexDirection: 'row', borderRadius: 10, overflow: 'hidden', backgroundColor: mine ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.05)', marginBottom: 6, minWidth: 170 }}>
      <View style={{ width: 3, backgroundColor: mine ? '#FBD3E2' : PINK }} />
      <View style={{ flex: 1, paddingVertical: 6, paddingHorizontal: 9 }}>
        <Text numberOfLines={1} style={{ fontFamily: F.bodyBold, fontSize: 10.5, color: mine ? '#FBD3E2' : PINK_SOFT }}>{q.name}</Text>
        <Text numberOfLines={2} style={{ fontFamily: F.body, fontSize: 11.5, lineHeight: 15, color: mine ? 'rgba(255,255,255,0.85)' : C.muted2, marginTop: 1 }}>{q.body}</Text>
      </View>
    </Pressable>
  );
}

/* Weekly-protocol chip + info popup (clients.weekly_protocol). */
function ProtocolChip({ onPress }: { onPress: () => void }) {
  return (
    <Pressable hitSlop={10} onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 999, backgroundColor: hexA(BLUE, 0.12), borderWidth: 1, borderColor: hexA(BLUE, 0.45) }}>
      <Icon name="clipboard" size={9} color={BLUE} strokeWidth={2.2} />
      <Mono style={{ fontSize: 8, letterSpacing: 0.5, color: BLUE }}>PROTOCOL</Mono>
    </Pressable>
  );
}
function ProtocolPopup({ info, onClose }: { info: { name: string; proto: ClientProtocol } | null; onClose: () => void }) {
  // Header totals: weekly and monthly are SEPARATE pools now
  // (e.g. "7/WEEK + 4/MONTH"); older rows may have a fractional total_per_week.
  const fmtN = (n: number) => String(Math.round(n * 100) / 100);
  const totParts: string[] = [];
  if (info?.proto.total_per_week != null && info.proto.total_per_week > 0) totParts.push(`${fmtN(info.proto.total_per_week)}/WEEK`);
  if (info?.proto.total_per_month != null && info.proto.total_per_month > 0) totParts.push(`${fmtN(info.proto.total_per_month)}/MONTH`);
  const totLabel = totParts.length ? totParts.join(' + ') : null;
  return (
    <Modal visible={!!info} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'center', padding: 26 }}>
        <Pressable onPress={onClose} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.72)' }} />
        <View style={{ borderRadius: 18, backgroundColor: '#12100E', borderWidth: 1, borderColor: hexA(BLUE, 0.4), padding: 15, gap: 10, maxHeight: '82%' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: hexA(BLUE, 0.14), borderWidth: 1, borderColor: hexA(BLUE, 0.4), alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="clipboard" size={15} color={BLUE} strokeWidth={2} />
            </View>
            <View style={{ flex: 1 }}>
              <Body style={{ fontSize: 15, fontFamily: F.bodySemi, color: '#fff' }} numberOfLines={1}>{info?.name}</Body>
              <Mono style={{ fontSize: 8.5, letterSpacing: 0.8, color: BLUE, marginTop: 2 }}>
                WEEKLY PROTOCOL{totLabel ? ` · ${totLabel}` : ''}
              </Mono>
            </View>
            <Pressable onPress={onClose} hitSlop={8} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="close" size={13} color={C.muted} strokeWidth={2.3} />
            </Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
          {(info?.proto.entries ?? []).map((e, i) => {
            const monthly = e.frequency === 'monthly'; // doctor-led Rehab/Recovery only
            return (
              <View key={i} style={{ padding: 10, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', gap: 3 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                  <Body style={{ flex: 1, fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>
                    {e.modality ?? 'Session'} · {protoEntryCount(e) || '?'}x/{monthly ? 'month' : 'week'}
                  </Body>
                  <View style={{ paddingVertical: 2, paddingHorizontal: 7, borderRadius: 999, backgroundColor: hexA(monthly ? C.purple : BLUE, 0.12), borderWidth: 1, borderColor: hexA(monthly ? C.purple : BLUE, 0.4) }}>
                    <Mono style={{ fontSize: 7.5, letterSpacing: 0.6, color: monthly ? C.purple : BLUE }}>{monthly ? 'MONTHLY' : 'WEEKLY'}</Mono>
                  </View>
                </View>
                <Body style={{ fontSize: 11.5, color: C.muted2 }}>
                  {monthly
                    ? `Any day of the month${e.trainer_name ? ` · with ${e.trainer_name}` : ''}`
                    : `${e.days && e.days.length ? e.days.join(', ') : 'Any day'}${e.trainer_name ? ` · with ${e.trainer_name}` : ''}`}
                </Body>
              </View>
            );
          })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/* ============ Managers Messenger — team chat per competition ============
   Spec: docs/managers-messenger-spec.md. Window + membership are enforced by
   RLS; this screen mirrors those states (read-only after the window closes). */

const initials = (name: string) => name.split(' ').filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?';
const AV_COLORS = ['#E8734A', '#7C8FE8', '#57C98A', '#C9A557', '#B57CE8', '#E87C9E', '#5AC8C8'];
const avColor = (name: string) => AV_COLORS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AV_COLORS.length];

function AvatarDot({ name, size = 24, url }: { name: string; size?: number; url?: string | null }) {
  // profiles.avatar_url when available; initials fallback on null/load-error.
  const [err, setErr] = React.useState(false);
  if (url && !err) {
    return <Image source={{ uri: url }} onError={() => setErr(true)} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: avColor(name) }} />;
  }
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: avColor(name), alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontFamily: F.bodyBold, fontSize: size * 0.36, color: '#fff' }}>{initials(name)}</Text>
    </View>
  );
}

/* ---------- Daily 7 PM Team Flags card (manager-only) ----------
   Posted by the enqueue_manager_team_flags() cron. RLS already hides these
   rows from non-managers; the isManager guard at the render site is only a
   belt-and-braces. Tapping a trainer expands their off-pace clients. */
const FLAG_RED = '#E85D5D';

const FLAG_GREEN = '#57C98A';
function TeamFlagsCard({
  msg, isManager, meId, savingKey, onSaveRemark, doctorIds, meIsHod,
}: {
  msg: ManagerChatMessage;
  isManager: boolean;
  meId: string;
  savingKey: string | null;
  onSaveRemark: (messageId: string, trainerId: string, remark: string) => void;
  doctorIds: Set<string>; // doctor blocks: the PHYSIO HOD closes these, manager is view-only
  meIsHod: boolean;
}) {
  const all = msg.payload?.flags ?? [];
  // A member sees ONLY their own block; the manager sees the whole team.
  const flags = isManager || meIsHod ? all : all.filter((t) => t.trainer_id === meId);
  const openCount = all.filter((t) => !t.remark).length;
  const closedCount = all.length - openCount;
  const allClosed = openCount === 0;
  const accent = allClosed ? FLAG_GREEN : FLAG_RED;
  const dayLab = msg.payload?.date ? istDayLabel(msg.payload.date + 'T12:00:00+05:30') : '';
  // Members land with their block expanded; managers expand per trainer.
  const [open, setOpen] = React.useState<Record<string, boolean>>(
    () => (isManager || meIsHod ? {} : Object.fromEntries(flags.map((t) => [t.trainer_id, true])))
  );
  const [drafts, setDrafts] = React.useState<Record<string, string>>({});
  // Which closed blocks are currently in edit mode (manager re-editing a remark).
  const [editing, setEditing] = React.useState<Record<string, boolean>>({});
  // The whole card is click-to-expand: managers get the compact summary first
  // (their cards are dense); a member's single-block card starts expanded.
  const [cardOpen, setCardOpen] = React.useState(!(isManager || meIsHod));
  const totalClients = flags.reduce((s, t) => s + (t.clients?.length ?? 0), 0);
  if (!flags.length) return null;
  return (
    <View style={{ borderRadius: 16, overflow: 'hidden', backgroundColor: 'rgba(26,20,15,0.94)', borderWidth: 1, borderColor: hexA(accent, 0.45) }}>
      <View style={{ height: 2.5, backgroundColor: hexA(accent, 0.7) }} />
      <View style={{ padding: 12, gap: 9 }}>
        {/* header: identity + open/closed state at a glance — tap to expand/collapse */}
        <Pressable
          onPress={() => { Haptics.selectionAsync().catch(() => {}); setCardOpen((v) => !v); }}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}
        >
          <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: hexA(accent, 0.16), alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={allClosed ? 'checks' : 'alert'} size={13} color={accent} strokeWidth={2.2} />
          </View>
          <Mono style={{ fontSize: 9.5, letterSpacing: 1, color: accent, flex: 1 }}>
            {isManager || meIsHod ? 'TEAM FLAGS' : 'YOUR FLAG'}{dayLab ? ` · ${dayLab.toUpperCase()}` : ''}
          </Mono>
          {isManager || meIsHod ? (
            <>
              {openCount > 0 ? (
                <View style={{ paddingHorizontal: 8, paddingVertical: 2.5, borderRadius: 999, backgroundColor: hexA(FLAG_RED, 0.16) }}>
                  <Mono style={{ fontSize: 9.5, color: FLAG_RED }}>{openCount} OPEN</Mono>
                </View>
              ) : null}
              <View style={{ paddingHorizontal: 8, paddingVertical: 2.5, borderRadius: 999, backgroundColor: hexA(FLAG_GREEN, 0.16) }}>
                <Mono style={{ fontSize: 9.5, color: FLAG_GREEN }}>{closedCount} CLOSED</Mono>
              </View>
            </>
          ) : null}
          <View style={{ transform: [{ rotate: cardOpen ? '90deg' : '0deg' }] }}>
            <Icon name="arrowRight" size={13} color={C.muted2} strokeWidth={2} />
          </View>
        </Pressable>
        {!cardOpen ? (
          <Body style={{ fontSize: 11.5, color: C.muted2, lineHeight: 16 }}>
            {flags.length} trainer{flags.length === 1 ? '' : 's'} · {totalClients} client{totalClients === 1 ? '' : 's'} flagged — tap to review.
          </Body>
        ) : (
        <>
        <Body style={{ fontSize: 11.5, color: C.muted2, lineHeight: 16 }}>
          {isManager
            ? 'Sessions off pace vs the weekly protocol. Add a remark under every trainer to close their flag.'
            : "Your clients flagged off pace, with the manager's remark."}
        </Body>

        {flags.map((t) => {
          const isOpenUi = !!open[t.trainer_id];
          const closed = !!t.remark;
          const rowAccent = closed ? FLAG_GREEN : FLAG_RED;
          const hodBlock = doctorIds.has(t.trainer_id);
          const saveKey = `${msg.id}:${t.trainer_id}`;
          const saving = savingKey === saveKey;
          const draft = drafts[t.trainer_id] ?? '';
          return (
            <View key={t.trainer_id} style={{ borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.045)', borderWidth: 1, borderColor: hexA(rowAccent, isOpenUi ? 0.4 : 0.22), overflow: 'hidden' }}>
              <Pressable
                onPress={() => { Haptics.selectionAsync().catch(() => {}); setOpen((p) => ({ ...p, [t.trainer_id]: !p[t.trainer_id] })); }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 9, paddingHorizontal: 10 }}
              >
                <AvatarDot name={t.trainer_name || 'Trainer'} size={26} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Body style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: C.ink }} numberOfLines={1}>
                    {t.trainer_name || 'Trainer'}
                  </Body>
                  <Mono style={{ fontSize: 8.5, color: C.muted2, marginTop: 1 }}>
                    {t.clients?.length ?? 0} CLIENT{(t.clients?.length ?? 0) === 1 ? '' : 'S'} FLAGGED
                  </Mono>
                </View>
                <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: hexA(rowAccent, 0.16) }}>
                  <Mono style={{ fontSize: 9, color: rowAccent }}>{closed ? 'CLOSED' : 'OPEN'}</Mono>
                </View>
                <View style={{ transform: [{ rotate: isOpenUi ? '90deg' : '0deg' }] }}>
                  <Icon name="arrowRight" size={13} color={C.muted2} strokeWidth={2} />
                </View>
              </Pressable>
              {isOpenUi ? (
                <View style={{ borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' }}>
                  {(t.clients ?? []).map((cl) => (
                    <View key={`${t.trainer_id}-${cl.client_id ?? cl.name}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6.5, paddingHorizontal: 12 }}>
                      <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: FLAG_RED }} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Body style={{ fontSize: 12.5, fontFamily: F.bodySemi, color: C.ink }} numberOfLines={1}>{cl.name}</Body>
                        <Mono style={{ fontSize: 9, color: C.muted2, marginTop: 1 }}>
                          {cl.sessions_per_week}/WK{cl.modality ? ` · ${String(protoModalityLabel(String(cl.modality))).toUpperCase()}` : ''} · NO SESSION {cl.gap_days}+ DAYS
                        </Mono>
                      </View>
                    </View>
                  ))}
                  {/* remark zone: closed = green remark bubble (latest only, EDITED
                      tag when a history exists, manager can re-edit); open =
                      manager input / member waiting line */}
                  {closed && !editing[t.trainer_id] ? (
                    <View style={{ margin: 10, marginTop: 4, borderRadius: 10, backgroundColor: hexA(FLAG_GREEN, 0.09), borderWidth: 1, borderColor: hexA(FLAG_GREEN, 0.3), padding: 9, gap: 3 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Mono style={{ fontSize: 8.5, letterSpacing: 1, color: FLAG_GREEN, flex: 1 }}>
                          {hodBlock ? 'PHYSIO HOD' : 'MANAGER'} REMARK{t.remark_at ? ` · ${istDayLabel(t.remark_at).toUpperCase()} ${istTimeParts(t.remark_at).time} ${istTimeParts(t.remark_at).ampm}` : ''}
                        </Mono>
                        {(t.remark_history?.length ?? 0) > 0 ? (
                          <View style={{ paddingHorizontal: 6, paddingVertical: 1.5, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.08)' }}>
                            <Mono style={{ fontSize: 8, letterSpacing: 0.8, color: C.muted2 }}>EDITED</Mono>
                          </View>
                        ) : null}
                        {(hodBlock ? meIsHod : isManager) ? (
                          <Pressable
                            onPress={() => {
                              setDrafts((p) => ({ ...p, [t.trainer_id]: t.remark ?? '' }));
                              setEditing((p) => ({ ...p, [t.trainer_id]: true }));
                            }}
                            style={{ paddingHorizontal: 8, paddingVertical: 2.5, borderRadius: 999, borderWidth: 1, borderColor: hexA(FLAG_GREEN, 0.4) }}
                          >
                            <Mono style={{ fontSize: 8.5, letterSpacing: 0.8, color: FLAG_GREEN }}>EDIT</Mono>
                          </Pressable>
                        ) : null}
                      </View>
                      <Body style={{ fontSize: 12.5, color: C.ink, lineHeight: 18 }}>{t.remark}</Body>
                    </View>
                  ) : (hodBlock ? meIsHod : isManager) ? (
                    <View style={{ margin: 10, marginTop: 4, gap: 7 }}>
                      <TextInput
                        value={draft}
                        onChangeText={(v) => setDrafts((p) => ({ ...p, [t.trainer_id]: v }))}
                        placeholder={closed ? 'Edit the remark...' : 'Remark to close this flag (required)...'}
                        placeholderTextColor={C.muted3}
                        multiline
                        style={{ minHeight: 40, maxHeight: 90, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: hexA(closed ? FLAG_GREEN : FLAG_RED, 0.3), paddingHorizontal: 10, paddingVertical: 8, fontFamily: F.body, fontSize: 12.5, color: C.ink }}
                      />
                      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
                        {closed ? (
                          <Pressable
                            disabled={saving}
                            onPress={() => setEditing((p) => ({ ...p, [t.trainer_id]: false }))}
                            style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.07)' }}
                          >
                            <Mono style={{ fontSize: 9.5, letterSpacing: 0.8, color: C.muted2 }}>CANCEL</Mono>
                          </Pressable>
                        ) : null}
                        <Pressable
                          disabled={!draft.trim() || saving || (closed && draft.trim() === (t.remark ?? ''))}
                          onPress={() => {
                            onSaveRemark(msg.id, t.trainer_id, draft);
                            setEditing((p) => ({ ...p, [t.trainer_id]: false }));
                          }}
                          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 7, paddingHorizontal: 13, borderRadius: 999, backgroundColor: draft.trim() ? hexA(FLAG_GREEN, 0.9) : 'rgba(255,255,255,0.08)', opacity: saving ? 0.6 : 1 }}
                        >
                          {saving ? <ActivityIndicator size="small" color="#0B0908" /> : <Icon name="checks" size={12} color={draft.trim() ? '#0B0908' : C.muted3} strokeWidth={2.4} />}
                          <Mono style={{ fontSize: 9.5, letterSpacing: 0.8, color: draft.trim() ? '#0B0908' : C.muted3 }}>
                            {closed ? 'SAVE EDIT' : 'CLOSE FLAG'}
                          </Mono>
                        </Pressable>
                      </View>
                    </View>
                  ) : (
                    <Mono style={{ fontSize: 9, color: C.muted3, marginHorizontal: 12, marginBottom: 10 }}>
                      {hodBlock ? 'AWAITING PHYSIO HOD REMARK' : 'AWAITING MANAGER REMARK'}
                    </Mono>
                  )}
                </View>
              ) : null}
            </View>
          );
        })}
        </>
        )}
      </View>
    </View>
  );
}

/* ---------- Dashboard entry card (mounted on the trainer home) ----------
   Deliberately different from every other home card: blue identity (Client
   Threads next to it owns purple), a light
   sweep along the top edge, a breathing glow behind the chat glyph, and a
   pulsing unread pill. All core Animated on the native driver. */
export function ManagerTeamChatCard() {
  const { session } = useAuth();
  const { go } = useStore();
  const teamQ = useMyManagerTeam();
  const hodQ = usePhysioHod();
  const cardIsHod = !!hodQ.data?.meIsHod && !teamQ.data;
  const hodTeamsQ = useHodTeams(cardIsHod);
  const team = teamQ.data ?? (cardIsHod ? hodTeamsQ.data?.[0] ?? null : null);
  const hodTeamCount = cardIsHod ? (hodTeamsQ.data?.length ?? 0) : 0;
  const { unread } = useManagerChatUnread(team?.scoreId ?? null, session?.user?.id);
  // Live updates on the home screen too: a teammate's message bumps the unread
  // pill instantly, no refresh needed.
  useManagerChatRealtime(team?.scoreId ?? null, 'card');
  const pulse = React.useRef(new Animated.Value(0)).current; // glow ring behind the glyph
  const sweep = React.useRef(new Animated.Value(0)).current; // light band along the top strip
  const pop = React.useRef(new Animated.Value(0)).current;   // unread pill heartbeat
  const hasUnread = unread > 0;
  React.useEffect(() => {
    if (!team?.active) return;
    const l1 = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    const l2 = Animated.loop(Animated.sequence([
      Animated.timing(sweep, { toValue: 1, duration: 2400, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
      Animated.timing(sweep, { toValue: 0, duration: 0, useNativeDriver: true }),
      Animated.delay(1400),
    ]));
    l1.start(); l2.start();
    return () => { l1.stop(); l2.stop(); };
  }, [team?.active]);
  React.useEffect(() => {
    if (!hasUnread) return;
    const l = Animated.loop(Animated.sequence([
      Animated.timing(pop, { toValue: 1, duration: 650, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(pop, { toValue: 0, duration: 650, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    l.start();
    return () => l.stop();
  }, [hasUnread]);
  if (!team) return null; // not in a current team — card hidden
  return (
    <Pressable onPress={() => go('manager-chat')} style={{ borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: hexA(PINK, 0.4) }}>
      <LinearGradient colors={['rgba(66,24,44,0.62)', 'rgba(24,13,18,0.8)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
        {/* top strip with travelling light band */}
        <View style={{ height: 3, backgroundColor: hexA(PINK, 0.18), overflow: 'hidden' }}>
          <Animated.View style={{ width: 90, height: 3, transform: [{ translateX: sweep.interpolate({ inputRange: [0, 1], outputRange: [-90, 430] }) }] }}>
            <LinearGradient colors={['transparent', hexA(PINK, 0.95), 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ flex: 1 }} />
          </Animated.View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 }}>
          {/* glyph with breathing glow */}
          <View style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
            <Animated.View style={{
              position: 'absolute', width: 44, height: 44, borderRadius: 15, backgroundColor: hexA(PINK, 0.4),
              transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.3] }) }],
              opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0.04] }),
            }} />
            <View style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: hexA(PINK, 0.18), borderWidth: 1, borderColor: hexA(PINK, 0.55), alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="chat" size={19} color={PINK_SOFT} strokeWidth={2} />
            </View>
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
              <Body style={{ fontSize: 15, fontFamily: F.bodySemi, color: '#fff' }} numberOfLines={1}>My Crew</Body>
              {istToday() <= NEW_PILL_UNTIL ? (
                <View style={{ paddingVertical: 1.5, paddingHorizontal: 7, borderRadius: 999, backgroundColor: hexA(C.green, 0.14), borderWidth: 1, borderColor: hexA(C.green, 0.5) }}>
                  <Mono style={{ fontSize: 7.5, letterSpacing: 0.8, color: C.green }}>NEW</Mono>
                </View>
              ) : null}
              {team.active ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: C.green }} /> : null}
            </View>
            <Body style={{ fontSize: 11, color: C.muted2, marginTop: 2 }} numberOfLines={1}>
              {hodTeamCount
                ? `${hodTeamCount} teams · physio oversight`
                : `${team.isManager ? 'Manager' : 'Member'} · ${team.teamName} · ${team.daysLeft != null ? `${team.daysLeft}d left` : team.active ? 'ongoing' : 'ended'}`}
            </Body>
          </View>
          {/* member avatar stack */}
          <View style={{ flexDirection: 'row' }}>
            {team.members.slice(0, 3).map((m, i) => (
              <View key={m.id} style={{ marginLeft: i ? -9 : 0, borderWidth: 1.5, borderColor: '#241119', borderRadius: 14 }}>
                <AvatarDot name={m.name} size={24} />
              </View>
            ))}
            {team.members.length > 3 ? (
              <View style={{ width: 25, height: 25, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center', marginLeft: -9, borderWidth: 1.5, borderColor: '#241119' }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 8.5, color: C.muted }}>+{team.members.length - 3}</Text>
              </View>
            ) : null}
          </View>
          {hasUnread ? (
            <Animated.View style={{ alignItems: 'center', gap: 3, transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [1, 1.14] }) }] }}>
              <LinearGradient colors={[hexA(PINK, 1), hexA(PINK, 0.6)]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ minWidth: 28, height: 28, borderRadius: 14, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: '#fff' }}>{unread > 99 ? '99+' : unread}</Text>
              </LinearGradient>
              <Mono style={{ fontSize: 6.5, letterSpacing: 0.8, color: PINK_SOFT }}>UNREAD</Mono>
            </Animated.View>
          ) : (
            <Icon name="chevRight" size={16} color={hexA(PINK, 0.8)} strokeWidth={2.3} />
          )}
        </View>
      </LinearGradient>
    </Pressable>
  );
}

/* ---------- Merged Team Day Plan card ----------
   ONE card per date in the thread: every trainer's latest plan for that date
   merged into a single message — trainer by trainer — with the members who
   have NOT submitted named on top, flipping to a green "all submitted" banner
   once everyone has. When the date arrives, each claimed session is checked
   against training_sessions: tick = completed, cross = missed (PENDING while
   the day still runs), so the manager reads "claimed 8, did 6" per trainer. */
const MISSED_CAT_LABELS: Record<string, string> = { client_no_show: 'Client No-show', trainer_no_show: 'Trainer No-show', venue_issue: 'Venue Issue', emergency: 'Emergency', miscommunication: 'Miscommunication', forgot_to_log: 'Forgot to Log', other: 'Other' };
const missedCatLabel = (v: string | null) => (v ? MISSED_CAT_LABELS[v] ?? v : 'Missed');

function MergedPlanCard({ date, bySender, team, meId, timeEdits, onEditTime, onRequestChange, adds, onAddSession, doctorIds, meIsHod, onHodRemark, sectionFilter, onOpenCompose, onRetryBooking, retryingKey }: {
  date: string; bySender: Map<string, ManagerChatMessage>; team: ManagerTeamInfo; meId: string | null;
  timeEdits: Map<string, { time: string; modality?: string | null; remark?: string | null; history?: PlanRescheduleHop[] | null; createdAt: string }>; // `${trainerId}:${clientId}` -> manager override
  onEditTime: ((r: { date: string; clientId: string; name: string; trainerId: string; current: string; currentModality: string | null; scheduleId: string | null }) => void) | null; // non-null only for the manager
  onRequestChange: ((r: { date: string; clientId: string; name: string; trainerId: string; current: string; currentModality: string | null; scheduleId: string | null }) => void) | null; // non-null for MEMBERS (their own rows)
  adds: Map<string, TomorrowPlanEntry[]>; // trainerId -> manager-added sessions for this date
  doctorIds: Set<string>; // doctor members: HOD territory, manager view-only
  meIsHod: boolean; // the physio HOD controls DOCTOR sections in this same card
  onHodRemark: ((r: { scheduleId: string; name: string }) => void) | null; // HOD missed-remark on a doctor session
  sectionFilter?: (sectionId: string) => boolean; // e.g. HOD's All-Physios feed: doctor sections only
  onAddSession: ((r: { date: string; trainerId: string; trainerName: string }) => void) | null; // non-null only for the manager
  onOpenCompose?: (() => void) | null; // member empty-plan CTA → tomorrow compose sheet
  /* A conflicted entry never made it into session_schedule. The plan payload froze
     that verdict, so once the clash is resolved something has to re-run the sync —
     this is that retry (owner of the section, the manager, or the HOD). */
  onRetryBooking?: ((r: { date: string; messageId: string; clientId: string; name: string; time: string; modality: string | null }) => void) | null;
  retryingKey?: string | null; // `${messageId}:${clientId}` while in flight
}) {
  const dayLab = new Date(date + 'T12:00:00Z').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const today = istToday();
  const mode: 'upcoming' | 'live' | 'final' = date > today ? 'upcoming' : date === today ? 'live' : 'final';
  // Current members in team order first (a plan message OR manager-added
  // sessions give a member a section), then any sender who has since left.
  const sections = [
    ...team.members.filter((mm) => bySender.has(mm.id) || (adds.get(mm.id)?.length ?? 0) > 0).map((mm) => ({ id: mm.id, name: mm.name, isManager: mm.isManager, msg: bySender.get(mm.id) ?? null, addEntries: adds.get(mm.id) ?? [] })),
    ...[...bySender.values()].filter((m) => !team.members.some((mm) => mm.id === m.senderId)).map((m) => ({ id: m.senderId, name: m.senderName, isManager: false, msg: m as ManagerChatMessage | null, addEntries: adds.get(m.senderId) ?? [] })),
  ];
  // A section's full entry list: the trainer's plan + manager adds not already
  // covered by the plan (the trainer's own entry for a client wins).
  const secEntries = (s: { msg: ManagerChatMessage | null; addEntries: TomorrowPlanEntry[] }): (TomorrowPlanEntry & { added?: boolean })[] => {
    const base = s.msg?.payload?.entries ?? [];
    const extra = s.addEntries.filter((a) => !base.some((b) => b.client_id && b.client_id === a.client_id)).map((a) => ({ ...a, added: true }));
    return [...base, ...extra];
  };
  // Visibility: the MANAGER sees every trainer's plan; a regular member sees
  // ONLY their own section (and no submission roll-call).
  const isMgr = team.isManager;
  const privileged = isMgr || meIsHod;
  const visibleBase = privileged ? sections : sections.filter((s) => s.id === meId);
  const visibleSections = sectionFilter ? visibleBase.filter((s) => sectionFilter(s.id)) : visibleBase;
  const allIds = visibleSections.flatMap((s) => secEntries(s).map((e) => e.client_id).filter(Boolean)) as string[];
  // Weekly-protocol chips: batch lookup for every visible client (5 min cache).
  const protoQ = useClientProtocols(allIds);
  const protocols = protoQ.data ?? {};
  const [protoFor, setProtoFor] = React.useState<{ name: string; proto: ClientProtocol } | null>(null);
  const outcomeQ = usePlanOutcome(date, allIds, mode !== 'upcoming', mode === 'live');
  // Linked entries display from session_schedule (source of truth), so CRM-side
  // changes and reschedules are always current; the payload is only a fallback.
  const scheduleIds = visibleSections.flatMap((s) => secEntries(s).map((e) => e.schedule_id).filter(Boolean)) as string[];
  // Final-day cards keep refreshing too: the trainer's missed remark (logged
  // from Today's Roster) usually arrives the day after the plan.
  const schedQ = usePlanScheduleRows(scheduleIds, mode === 'final' ? 300_000 : 120_000);
  const schedRows = schedQ.data ?? {};
  const doneMap = outcomeQ.data ?? {}; // `${trainerId}:${clientId}` -> { time, acked }
  // Done = THIS member's session happened: the linked roster row got logged, or
  // the SECTION OWNER has a completed session for that client on the date.
  // Never another member's log — a client can have a trainer session AND a
  // doctor session the same day (that cross-marking was the v2 bug).
  const entryDone = (sectionId: string, e: TomorrowPlanEntry): boolean => {
    const sched = e.schedule_id ? schedRows[e.schedule_id] : undefined;
    if (sched?.logged) return true;
    return !!(e.client_id && doneMap[`${sectionId}:${e.client_id}`]);
  };
  const entryLoggedTime = (sectionId: string, e: TomorrowPlanEntry): string | null =>
    (e.client_id ? doneMap[`${sectionId}:${e.client_id}`]?.time ?? null : null);
  // Client acknowledgement of the logged session (null = unknown / not logged).
  const entryAcked = (sectionId: string, e: TomorrowPlanEntry): boolean | null =>
    (e.client_id ? doneMap[`${sectionId}:${e.client_id}`]?.acked ?? null : null);
  const showStatus = mode !== 'upcoming' && !outcomeQ.isLoading && !outcomeQ.isError;
  const awaiting = team.members.filter((mm) => !bySender.has(mm.id));
  // Sections are COLLAPSED by default (trainer name + count only) and expand on
  // tap — a member's single own section stays open since there's nothing to pick.
  const [openSecs, setOpenSecs] = React.useState<Set<string>>(new Set());
  const singleSec = visibleSections.length === 1;
  const toggleSec = (id: string) => setOpenSecs((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const totalN = visibleSections.reduce((a, s) => a + secEntries(s).length, 0);
  const doneN = visibleSections.reduce((a, s) => a + secEntries(s).filter((e) => entryDone(s.id, e)).length, 0);
  const missedN = totalN - doneN;
  const badgeCol = !showStatus ? C.gold : doneN === totalN ? C.green : mode === 'final' ? C.red : C.gold;
  return (
    <View style={{ borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: hexA(C.gold, 0.35) }}>
      <LinearGradient colors={['rgba(44,32,16,0.96)', 'rgba(19,14,11,0.98)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
      <LinearGradient colors={[hexA(C.gold, 0.65), 'rgba(255,255,255,0.02)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 3 }} />
      <View style={{ padding: 13, gap: 11 }}>
        {/* header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ width: 34, height: 34, borderRadius: 12, backgroundColor: hexA(C.gold, 0.13), borderWidth: 1, borderColor: hexA(C.gold, 0.4), alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="calendar" size={15} color={C.gold} strokeWidth={2.1} />
          </View>
          <View style={{ flex: 1 }}>
            <Mono style={{ fontSize: 12, letterSpacing: 1.6, color: '#fff' }}>
              {privileged ? 'TEAM DAY PLAN' : 'MY DAY PLAN'}
            </Mono>
            <Mono style={{ fontSize: 9, letterSpacing: 1.1, color: C.gold, marginTop: 3 }}>
              {mode === 'upcoming' ? 'TOMORROW · ' : mode === 'live' ? 'TODAY · ' : ''}{dayLab.toUpperCase()}
            </Mono>
          </View>
          <View style={{ minWidth: 26, paddingVertical: 3, paddingHorizontal: 9, borderRadius: 999, backgroundColor: hexA(badgeCol, 0.14), borderWidth: 1, borderColor: hexA(badgeCol, 0.45), alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: badgeCol }}>{showStatus ? `${doneN}/${totalN}` : totalN}</Text>
          </View>
        </View>
        {/* the day at a glance — total projected sessions vs what got logged
            (privileged viewers only; members get their flat rows straight away) */}
        {!privileged ? null : (
        <View style={{ flexDirection: 'row', gap: 7 }}>
          <View style={{ flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 11, backgroundColor: hexA(C.gold, 0.07), borderWidth: 1, borderColor: hexA(C.gold, 0.28) }}>
            <Serif style={{ fontSize: 23, color: C.gold }}>{totalN}</Serif>
            <Mono style={{ fontSize: 7.5, letterSpacing: 1, color: C.gold, marginTop: 2 }}>PROJECTED</Mono>
          </View>
          {showStatus ? (
            <View style={{ flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 11, backgroundColor: hexA(C.green, 0.07), borderWidth: 1, borderColor: hexA(C.green, 0.28) }}>
              <Serif style={{ fontSize: 23, color: C.green }}>{doneN}</Serif>
              <Mono style={{ fontSize: 7.5, letterSpacing: 1, color: C.green, marginTop: 2 }}>LOGGED</Mono>
            </View>
          ) : null}
          {showStatus ? (
            <View style={{ flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 11, backgroundColor: hexA(mode === 'final' && missedN ? C.red : PINK, 0.07), borderWidth: 1, borderColor: hexA(mode === 'final' && missedN ? C.red : PINK, 0.28) }}>
              <Serif style={{ fontSize: 23, color: mode === 'final' && missedN ? C.red : PINK }}>{totalN - doneN}</Serif>
              <Mono style={{ fontSize: 7.5, letterSpacing: 1, color: mode === 'final' && missedN ? C.red : PINK, marginTop: 2 }}>{mode === 'final' ? 'MISSED' : 'PENDING'}</Mono>
            </View>
          ) : null}
        </View>
        )}
        {/* submission status — on top, manager only */}
        {!isMgr ? null : awaiting.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 5, padding: 8, borderRadius: 11, backgroundColor: hexA(C.red, 0.06), borderWidth: 1, borderColor: hexA(C.red, 0.22) }}>
            <Mono style={{ fontSize: 9, letterSpacing: 0.8, color: C.red }}>NOT SUBMITTED:</Mono>
            {awaiting.map((mm) => (
              <Pressable
                key={mm.id}
                disabled={!onAddSession || mode === 'final' || isHodManagedRole(mm.role)}
                onPress={() => onAddSession && onAddSession({ date, trainerId: mm.id, trainerName: mm.name })}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 2.5, paddingHorizontal: 7, borderRadius: 999, backgroundColor: hexA(C.red, 0.1), borderWidth: 1, borderColor: hexA(C.red, 0.32) }}
              >
                <AvatarDot name={mm.name} size={13} />
                <Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: '#F5C0B5' }}>{mm.name.split(' ')[0]}</Text>
                {onAddSession && mode !== 'final' && !isHodManagedRole(mm.role) ? <Mono style={{ fontSize: 8, color: '#F5C0B5' }}>+</Mono> : null}
              </Pressable>
            ))}
          </View>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8, borderRadius: 11, backgroundColor: hexA(C.green, 0.07), borderWidth: 1, borderColor: hexA(C.green, 0.3) }}>
            <Icon path="M20 6 9 17l-5-5" size={11} color={C.green} strokeWidth={3} />
            <Mono style={{ fontSize: 9, letterSpacing: 0.8, color: C.green }}>ALL {team.members.length} MEMBERS SUBMITTED · {totalN} SESSIONS</Mono>
          </View>
        )}
        {/* one section per trainer (members: own section only) */}
        {!privileged && visibleSections.length === 0 ? (
          <View style={{ alignItems: 'center', gap: 9, paddingVertical: 14, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.18)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }}>
            <View style={{ width: 34, height: 34, borderRadius: 12, backgroundColor: hexA(C.gold, 0.1), borderWidth: 1, borderColor: hexA(C.gold, 0.3), alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="calendar" size={15} color={C.gold} strokeWidth={2} />
            </View>
            <Body style={{ fontSize: 11.5, color: C.muted2 }}>You haven't shared your plan for this day.</Body>
            {onOpenCompose && team.active && date >= today ? (
              <Pressable onPress={onOpenCompose} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: hexA(C.gold, 0.14), borderWidth: 1, borderColor: hexA(C.gold, 0.5) }}>
                <Icon name="calendar" size={12} color={C.gold} strokeWidth={2.2} />
                <Mono style={{ fontSize: 9.5, letterSpacing: 0.8, color: C.gold }}>PLAN TOMORROW'S SESSIONS</Mono>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {visibleSections.map((s) => {
          // Effective times: manager overrides apply only when NEWER than this
          // trainer's plan message (a later re-share supersedes older tweaks).
          const baseTs = s.msg ? Date.parse(s.msg.createdAt) : 0;
          const entries = [...secEntries(s)]
            .map((e0) => {
              // Roster row wins for linked entries; message overlay is the
              // fallback for legacy/unlinked ones.
              const sched = e0.schedule_id ? schedRows[e0.schedule_id] : undefined;
              const ov = e0.client_id ? timeEdits.get(`${s.id}:${e0.client_id}`) : undefined;
              const newer = !!ov && Date.parse(ov.createdAt) > baseTs;
              const effTime = sched ? sched.time : newer ? ov!.time : e0.time;
              const effMod = sched?.modality ?? (newer && ov!.modality ? ov!.modality : e0.modality ?? null);
              const cancelled = sched?.status === 'cancelled';
              const edited = sched
                ? sched.time !== e0.time || (!!sched.modality && !!e0.modality && sched.modality !== e0.modality)
                : newer && (ov!.time !== e0.time || (!!ov!.modality && ov!.modality !== (e0.modality ?? null)));
              return { ...e0, time: effTime, modality: effMod, edited, cancelled, mgrNote: newer ? ov!.remark ?? null : null, mgrHist: newer ? ov!.history ?? null : null, missedRemark: sched?.missedRemark ?? null };
            })
            .sort((a, b) => a.time.localeCompare(b.time));
          const secDone = entries.filter((e) => entryDone(s.id, e)).length;
          const expanded = singleSec || openSecs.has(s.id);
          const hideHeader = !privileged; // §5: a member's own rows render flat
          return (
            <View key={s.id} style={{ borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', borderLeftWidth: 2.5, borderLeftColor: avColor(s.name), overflow: 'hidden' }}>
              {hideHeader ? null : (
              <Pressable disabled={singleSec} onPress={() => toggleSec(s.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, paddingHorizontal: 10, backgroundColor: 'rgba(255,255,255,0.03)', borderBottomWidth: expanded ? 1 : 0, borderBottomColor: 'rgba(255,255,255,0.05)' }}>
                <AvatarDot name={s.name} size={20} url={team.members.find((mm) => mm.id === s.id)?.avatarUrl} />
                <Text style={{ fontFamily: F.bodySemi, fontSize: 13.5, color: '#fff' }}>{s.name.split(' ')[0]}</Text>
                {s.isManager ? <Icon name="crown" size={10} color={C.gold} strokeWidth={2.2} /> : null}
                {/* Role tag: doctor and therapist sections share one card — the
                   label tells them apart (HOD territory either way). */}
                {(() => {
                  const r = team.members.find((mm) => mm.id === s.id)?.role;
                  if (!isHodManagedRole(r)) return null;
                  const col = r === 'therapist' ? C.purple : C.blue;
                  return (
                    <View style={{ paddingVertical: 1.5, paddingHorizontal: 7, borderRadius: 999, backgroundColor: hexA(col, 0.12), borderWidth: 1, borderColor: hexA(col, 0.4) }}>
                      <Mono style={{ fontSize: 7.5, letterSpacing: 0.6, color: col }}>{r === 'therapist' ? 'THERAPIST' : 'DOCTOR'}</Mono>
                    </View>
                  );
                })()}
                <View style={{ flex: 1 }} />
                {showStatus ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <View style={{ width: 42 }}>
                      <ProgressBar pct={entries.length ? Math.round((secDone / entries.length) * 100) : 0} height={3} fill={secDone === entries.length ? C.green : mode === 'final' ? C.red : C.gold} />
                    </View>
                    <Mono style={{ fontSize: 9.5, color: secDone === entries.length ? C.green : mode === 'final' ? C.red : C.gold }}>{secDone}/{entries.length}</Mono>
                  </View>
                ) : (
                  <View style={{ paddingVertical: 2, paddingHorizontal: 8, borderRadius: 999, backgroundColor: hexA(C.gold, 0.1), borderWidth: 1, borderColor: hexA(C.gold, 0.3) }}>
                    <Mono style={{ fontSize: 9, color: C.gold }}>{entries.length} SESSION{entries.length === 1 ? '' : 'S'}</Mono>
                  </View>
                )}
                {onAddSession && mode !== 'final' && (doctorIds.has(s.id) ? meIsHod : isMgr) ? (
                  <Pressable hitSlop={10} onPress={() => onAddSession({ date, trainerId: s.id, trainerName: s.name })} style={{ paddingVertical: 3.5, paddingHorizontal: 8, borderRadius: 999, backgroundColor: hexA(C.gold, 0.12), borderWidth: 1, borderColor: hexA(C.gold, 0.45) }}>
                    <Mono style={{ fontSize: 8.5, color: C.gold }}>+ ADD</Mono>
                  </Pressable>
                ) : null}
                {!singleSec ? <Icon name={expanded ? 'chevUp' : 'chevDown'} size={13} color={C.muted2} strokeWidth={2.3} /> : null}
              </Pressable>
              )}
              {expanded || hideHeader ? (
              <View style={{ padding: 8, gap: 4 }}>
                {entries.map((e, i) => {
                  const isDone = entryDone(s.id, e);
                  const needsRemark = showStatus && mode === 'final' && !isDone;
                  const canAct = doctorIds.has(s.id) ? meIsHod : isMgr;
                  const proto = e.client_id ? protocols[e.client_id] : undefined;
                  // §6: own not-yet-logged linked rows (today included) can request
                  const canRequest = !!onRequestChange && mode !== 'final' && !e.cancelled && s.id === meId && !!e.client_id && !isDone && !!e.schedule_id;
                  return (
                    <View key={`${e.client_id ?? e.name}-${i}`}>
                    {/* two-line row: name + time pills, then meta + action chips */}
                    <View style={{ paddingVertical: 6.5, paddingHorizontal: 8, borderRadius: 10, gap: 4, backgroundColor: showStatus && isDone ? hexA(C.green, 0.05) : i % 2 ? 'rgba(255,255,255,0.02)' : 'transparent' }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        {showStatus ? (
                          <View style={{ width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: isDone ? hexA(C.green, 0.16) : mode === 'live' ? 'rgba(255,255,255,0.06)' : hexA(C.red, 0.14), borderWidth: 1, borderColor: isDone ? hexA(C.green, 0.5) : mode === 'live' ? 'rgba(255,255,255,0.12)' : hexA(C.red, 0.45) }}>
                            {isDone
                              ? <Icon path="M20 6 9 17l-5-5" size={10} color={C.green} strokeWidth={3.2} />
                              : mode === 'live'
                                ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.muted2 }} />
                                : <Icon path="M18 6 6 18M6 6l12 12" size={10} color={C.red} strokeWidth={3.2} />}
                          </View>
                        ) : (
                          <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: hexA(C.gold, 0.7), marginHorizontal: 6 }} />
                        )}
                        <Body style={{ flex: 1, fontSize: 14, fontFamily: F.bodySemi, color: showStatus && !isDone && mode === 'final' ? C.muted : '#fff' }} numberOfLines={1}>{e.name}</Body>
                        {/* time pill — tap = reschedule when authorized */}
                        <Pressable
                          disabled={!onEditTime || mode === 'final' || !e.client_id || !canAct}
                          onPress={() => onEditTime && e.client_id && onEditTime({ date, clientId: e.client_id, name: e.name, trainerId: s.id, current: e.time, currentModality: e.modality ?? null, scheduleId: e.schedule_id ?? null })}
                          style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 2.5, paddingHorizontal: 8, borderRadius: 999, backgroundColor: hexA(C.gold, e.edited ? 0.16 : 0.09), borderWidth: 1, borderColor: hexA(C.gold, e.edited ? 0.55 : 0.3) }}
                        >
                          {e.edited ? <Icon path="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" size={8} color={C.gold} strokeWidth={2.4} /> : null}
                          <Mono style={{ fontSize: 11, color: C.gold }}>{fmt12h(e.time)}</Mono>
                        </Pressable>
                        {/* actual logged time — green, next to the gold planned time */}
                        {showStatus && isDone && entryLoggedTime(s.id, e) ? (
                          <View style={{ paddingVertical: 2.5, paddingHorizontal: 8, borderRadius: 999, backgroundColor: hexA(C.green, 0.09), borderWidth: 1, borderColor: hexA(C.green, 0.35) }}>
                            <Mono style={{ fontSize: 11, color: C.green }}>{fmt12h(entryLoggedTime(s.id, e)!)}</Mono>
                          </View>
                        ) : null}
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 28 }}>
                        <View style={{ flex: 1, gap: 1.5 }}>
                          {e.modality ? <Mono style={{ fontSize: 8, letterSpacing: 0.6, color: C.muted2 }}>{e.modality.toUpperCase()}{e.added ? ' · ADDED' : ''}</Mono> : e.added ? <Mono style={{ fontSize: 8, letterSpacing: 0.6, color: PINK_SOFT }}>ADDED BY MANAGER</Mono> : null}
                          {e.roster === 'conflict' ? (
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                              <Mono style={{ fontSize: 8, letterSpacing: 0.6, color: C.red }}>ROSTER CONFLICT · NOT BOOKED</Mono>
                              {onRetryBooking && e.client_id && (s.id === meId || team.isManager || meIsHod) ? (
                                <Pressable
                                  hitSlop={10}
                                  disabled={!!retryingKey}
                                  onPress={() => onRetryBooking({ date, messageId: s.msg?.id ?? '', clientId: e.client_id!, name: e.name, time: e.time, modality: e.modality ?? null })}
                                  accessibilityRole="button"
                                  accessibilityLabel={`Retry booking ${e.name}`}
                                  style={{ paddingVertical: 2, paddingHorizontal: 7, borderRadius: 999, backgroundColor: hexA(C.gold, 0.12), borderWidth: 1, borderColor: hexA(C.gold, 0.4), opacity: retryingKey ? 0.5 : 1 }}
                                >
                                  <Mono style={{ fontSize: 8, letterSpacing: 0.6, color: C.gold }}>
                                    {retryingKey === `${s.msg?.id ?? ''}:${e.client_id}` ? 'BOOKING…' : 'RETRY BOOKING'}
                                  </Mono>
                                </Pressable>
                              ) : null}
                            </View>
                          ) : null}
                          {e.cancelled ? <Mono style={{ fontSize: 8, letterSpacing: 0.6, color: C.red }}>CANCELLED IN ROSTER</Mono> : null}
                        </View>
                        {/* client acknowledgement of the logged session */}
                        {showStatus && isDone && entryAcked(s.id, e) !== null ? (
                          <Mono style={{ fontSize: 7.5, letterSpacing: 0.5, color: entryAcked(s.id, e) ? C.green : C.gold }}>
                            {entryAcked(s.id, e) ? '✓ ACKNOWLEDGED' : 'NOT ACKNOWLEDGED'}
                          </Mono>
                        ) : null}
                        {proto ? <ProtocolChip onPress={() => setProtoFor({ name: e.name, proto })} /> : null}
                        {canRequest ? (
                          <Pressable hitSlop={10} onPress={() => onRequestChange!({ date, clientId: e.client_id!, name: e.name, trainerId: s.id, current: e.time, currentModality: e.modality ?? null, scheduleId: e.schedule_id ?? null })} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 999, backgroundColor: hexA(PINK, 0.12), borderWidth: 1, borderColor: hexA(PINK, 0.45) }}>
                            <Icon path="M8 3 4 7l4 4M4 7h16M16 21l4-4-4-4M20 17H4" size={9} color={PINK_SOFT} strokeWidth={2.2} />
                            <Mono style={{ fontSize: 8, letterSpacing: 0.5, color: PINK_SOFT }}>RESCHEDULE</Mono>
                          </Pressable>
                        ) : null}
                      </View>
                    </View>
                    {/* manager reschedule trail — full chain + latest reason */}
                    {e.mgrNote || (e.mgrHist && e.mgrHist.length) ? (
                      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginLeft: 26, marginTop: 2, marginBottom: 3, padding: 7, borderRadius: 9, backgroundColor: hexA(PINK, 0.07), borderWidth: 1, borderColor: hexA(PINK, 0.28) }}>
                        <Mono style={{ fontSize: 8.5, letterSpacing: 0.6, color: PINK_SOFT, marginTop: 1.5 }}>MGR</Mono>
                        <View style={{ flex: 1, gap: 2 }}>
                          {e.mgrHist && e.mgrHist.length ? (
                            <Mono style={{ fontSize: 9.5, color: PINK_SOFT }}>
                              {[e.mgrHist[0]?.from_time, ...e.mgrHist.map((h: PlanRescheduleHop) => h.to_time)].filter(Boolean).map((t) => fmt12h(t as string)).join(' → ')}
                              {e.mgrHist.length > 1 ? `   ·   ${e.mgrHist.length} MOVES` : ''}
                            </Mono>
                          ) : null}
                          {e.mgrNote ? <Body style={{ fontSize: 12.5, color: C.ink, lineHeight: 17 }}>{e.mgrNote}</Body> : null}
                        </View>
                      </View>
                    ) : null}
                    {/* missed remark — the TRAINER logs it from Today's Roster;
                       Team Messenger displays it from session_schedule.missed_remarks */}
                    {needsRemark ? (
                      e.missedRemark ? (
                        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginLeft: 26, marginTop: 2, marginBottom: 3, padding: 7, borderRadius: 9, backgroundColor: hexA(C.gold, 0.06), borderWidth: 1, borderColor: hexA(C.gold, 0.25) }}>
                          <Mono style={{ fontSize: 8.5, letterSpacing: 0.6, color: C.gold, marginTop: 1.5 }}>{(e.missedRemark.by_role ?? 'trainer').toUpperCase()}</Mono>
                          <View style={{ flex: 1, gap: 1 }}>
                            <Mono style={{ fontSize: 9, letterSpacing: 0.6, color: C.gold }}>{missedCatLabel(e.missedRemark.category).toUpperCase()}</Mono>
                            <Body style={{ fontSize: 12.5, color: C.ink, lineHeight: 17 }}>{e.missedRemark.remark}</Body>
                          </View>
                        </View>
                      ) : meIsHod && doctorIds.has(s.id) && e.schedule_id && onHodRemark ? (
                        <Pressable hitSlop={8} onPress={() => onHodRemark({ scheduleId: e.schedule_id!, name: e.name })} style={{ alignSelf: 'flex-start', marginLeft: 26, marginTop: 2, marginBottom: 3, flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4, paddingHorizontal: 9, borderRadius: 999, backgroundColor: hexA(C.red, 0.08), borderWidth: 1, borderColor: hexA(C.red, 0.3) }}>
                          <Icon path="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" size={10} color={C.red} strokeWidth={2.2} />
                          <Mono style={{ fontSize: 8, letterSpacing: 0.6, color: C.red }}>ADD REMARK</Mono>
                        </Pressable>
                      ) : (
                        <Mono style={{ fontSize: 8.5, letterSpacing: 0.6, color: C.red, marginLeft: 26, marginTop: 2, marginBottom: 3 }}>
                          {s.id === meId ? "REMARK PENDING · ADD IT FROM TODAY'S ROSTER" : 'MISSED REMARK PENDING'}
                        </Mono>
                      )
                    ) : null}
                    </View>
                  );
                })}
              </View>
              ) : null}
            </View>
          );
        })}
        {/* footer summary */}
        {showStatus ? (
          <View style={{ gap: 5, paddingTop: 5, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' }}>
            <ProgressBar pct={totalN ? Math.round((doneN / totalN) * 100) : 0} height={4} fill={badgeCol} animated />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Mono style={{ fontSize: 9, letterSpacing: 0.6, color: badgeCol }}>
                {mode === 'live'
                  ? `${doneN} OF ${totalN} LOGGED SO FAR`
                  : missedN === 0 ? 'ALL SESSIONS LOGGED' : `${missedN} OF ${totalN} NOT LOGGED`}
              </Mono>
              <Mono style={{ fontSize: 9, letterSpacing: 0.6, color: C.muted2 }}>{totalN ? Math.round((doneN / totalN) * 100) : 0}%</Mono>
            </View>
          </View>
        ) : null}
        {showStatus && mode === 'final' ? (() => {
          const pending = visibleSections.reduce((a, s2) => a + secEntries(s2).filter((en) => en.client_id && !entryDone(s2.id, en) && !(en.schedule_id && schedRows[en.schedule_id]?.missedRemark)).length, 0);
          return pending > 0 ? (
            <Mono style={{ fontSize: 9, letterSpacing: 0.6, color: C.red }}>{pending} MISSED SESSION{pending === 1 ? '' : 'S'} AWAITING TRAINER REMARK</Mono>
          ) : null;
        })() : null}
        {!privileged ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingTop: 6, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)' }}>
            <Icon name="users" size={10} color={C.muted3} strokeWidth={2} />
            <Mono style={{ fontSize: 8.5, letterSpacing: 0.6, color: C.muted3 }}>FULL TEAM PLAN IS VISIBLE TO THE MANAGER</Mono>
          </View>
        ) : null}
      </View>
      </LinearGradient>
      <ProtocolPopup info={protoFor} onClose={() => setProtoFor(null)} />
    </View>
  );
}

/* ---------- Manager: add a session into a member's day ---------- */
function AddSessionModal({ visible, trainerId, trainerName, targetRole, date, busy, scheduledIds, onClose, onSave }: {
  visible: boolean; trainerId: string | null; trainerName: string; targetRole?: string | null; date: string; busy: boolean;
  scheduledIds: string[]; // clients already in this trainer's day — locked (reschedule instead)
  onClose: () => void; onSave: (clientId: string, clientName: string, time: string, modality: string) => void;
}) {
  const clientsQ = useMemberClients(trainerId, visible);
  const [cid, setCid] = React.useState<string | null>(null);
  const [mod, setMod] = React.useState<string | null>(null);
  const [t, setT] = React.useState<string | null>(null);
  // Modality options follow the TARGET member's role — a therapist's sessions
  // are always Therapy (single option, preselected).
  const modOptions = targetRole === 'therapist' ? THERAPIST_MODALITIES : [...new Set([...TRAINER_MODALITIES, ...DOCTOR_MODALITIES])];
  React.useEffect(() => { if (visible) { setCid(null); setMod(modOptions.length === 1 ? modOptions[0] : null); setT(null); } }, [visible, trainerId, targetRole]);
  const clients = clientsQ.data ?? [];
  const selName = clients.find((c) => c.clientId === cid)?.name ?? '';
  const canSave = !!cid && !!mod && !!t && !busy;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'center', padding: 20 }}>
        <Pressable onPress={onClose} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.65)' }} />
        <View style={{ borderRadius: 18, backgroundColor: '#12100E', borderWidth: 1, borderColor: hexA(C.gold, 0.3), padding: 16, gap: 10, maxHeight: '88%' }}>
          <Serif style={{ fontSize: 18 }}>Add session</Serif>
          <Body style={{ fontSize: 11.5, color: C.muted2 }}>
            {trainerName.split(' ')[0]}'s plan · {date ? istDayLabel(date) : ''}. Pick the client, modality and time.
          </Body>
          <ScrollView style={{ maxHeight: 300 }} showsVerticalScrollIndicator={false} nestedScrollEnabled contentContainerStyle={{ gap: 5 }}>
            {clientsQ.isLoading ? (
              <Body style={{ fontSize: 12, color: C.muted3, textAlign: 'center', paddingVertical: 12 }}>Loading clients…</Body>
            ) : clients.length === 0 ? (
              <Body style={{ fontSize: 12, color: C.muted3, textAlign: 'center', paddingVertical: 12 }}>No active clients in this member's book.</Body>
            ) : clients.map((c) => {
              const on = cid === c.clientId;
              const already = scheduledIds.includes(c.clientId);
              return (
                <Pressable
                  key={c.clientId}
                  onPress={() => {
                    if (already) {
                      Alert.alert('Already scheduled', `${c.name} already has a session with ${trainerName.split(' ')[0]} that day. Use RESCHEDULE on the plan card to change it.`);
                      return;
                    }
                    setCid(on ? null : c.clientId);
                  }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 11, backgroundColor: on ? hexA(C.gold, 0.1) : 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: already ? hexA(C.gold, 0.28) : on ? hexA(C.gold, 0.45) : 'rgba(255,255,255,0.07)', opacity: already ? 0.65 : 1 }}
                >
                  <AvatarDot name={c.name} size={22} />
                  <View style={{ flex: 1 }}>
                    <Body style={{ fontSize: 13, fontFamily: F.bodySemi, color: '#fff' }} numberOfLines={1}>{c.name}</Body>
                    {already ? <Mono style={{ fontSize: 8, color: C.gold, marginTop: 1 }}>ALREADY SCHEDULED · RESCHEDULE TO EDIT</Mono> : null}
                  </View>
                  {already
                    ? <Icon path="M7 11V7a5 5 0 0 1 10 0v4M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2Z" size={13} color={C.gold} strokeWidth={2.2} />
                    : on ? <Icon path="M20 6 9 17l-5-5" size={13} color={C.gold} strokeWidth={3} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {modOptions.map((mName) => {
              const active = mod === mName;
              return (
                <Pressable key={mName} onPress={() => setMod(active ? null : mName)} style={{ paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999, backgroundColor: active ? hexA(PINK, 0.18) : 'rgba(255,255,255,0.045)', borderWidth: 1, borderColor: active ? hexA(PINK, 0.55) : 'rgba(255,255,255,0.09)' }}>
                  <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 10.5, color: active ? PINK_SOFT : C.muted }}>{mName}</Text>
                </Pressable>
              );
            })}
          </View>
          <ScrollView style={{ maxHeight: 240 }} showsVerticalScrollIndicator={false} nestedScrollEnabled>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {SHEET_TIMES.map((tt) => {
                const active = t === tt;
                return (
                  <Pressable key={tt} onPress={() => setT(active ? null : tt)} style={{ paddingVertical: 7, paddingHorizontal: 11, borderRadius: 10, backgroundColor: active ? hexA(C.gold, 0.18) : 'rgba(255,255,255,0.045)', borderWidth: 1, borderColor: active ? hexA(C.gold, 0.55) : 'rgba(255,255,255,0.09)' }}>
                    <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 11.5, color: active ? C.gold : C.ink }}>{fmt12h(tt)}</Text>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
          <View style={{ flexDirection: 'row', gap: 9 }}>
            <Pressable onPress={onClose} style={{ flex: 1, paddingVertical: 12, borderRadius: 13, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: C.ink }}>Cancel</Text>
            </Pressable>
            <Pressable onPress={() => canSave && onSave(cid!, selName, t!, mod!)} disabled={!canSave} style={{ flex: 1, borderRadius: 13, overflow: 'hidden', opacity: canSave ? 1 : 0.5 }}>
              <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ paddingVertical: 12, alignItems: 'center' }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: '#fff' }}>{busy ? 'Adding…' : 'Add session'}</Text>
              </LinearGradient>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/* ---------- HOD combined feed: ALL physios in ONE card per day ----------
   One cross-team query; every physio (the HOD's own sessions included) merges
   into a single TOMORROW card and a single TODAY card, with her controls.
   Requests from any team surface on top with Approve/Reject. */
function HodAllFeed({ teams, meId, meName, busy, onEditTime, onHodRemark, onActRequest, onAddSession, onOpenChat }: {
  teams: ManagerTeamInfo[]; meId: string | null; meName: string; busy: boolean;
  onEditTime: (r: { date: string; clientId: string; name: string; trainerId: string; current: string; currentModality: string | null; scheduleId: string | null }) => void;
  onHodRemark: (r: { scheduleId: string; name: string }) => void;
  onActRequest: (m: ManagerChatMessage, approve: boolean) => void;
  onAddSession: (r: { date: string; trainerId: string; trainerName: string; scoreId: string; scheduledIds: string[] }) => void;
  onOpenChat: (scoreId: string) => void;
}) {
  const msgsQ = useHodFeedMessages(teams.map((t) => t.scoreId), teams.length > 0);
  const msgs = msgsQ.data ?? [];
  const physios = React.useMemo(() => {
    // Carry the REAL role through (doctor vs therapist) — the merged card
    // labels each section with it, so one card covers both role types.
    const map = new Map<string, { name: string; scoreId: string; role: string | null }>();
    teams.forEach((t) => t.members.forEach((m) => { if (isHodManagedRole(m.role)) map.set(m.id, { name: m.name, scoreId: t.scoreId, role: m.role ?? 'doctor' }); }));
    if (meId && !map.has(meId)) map.set(meId, { name: meName || 'Me', scoreId: teams[0]?.scoreId ?? '', role: 'doctor' });
    return map;
  }, [teams, meId, meName]);
  const today = istToday();
  const tomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(serverNow().getTime() + 864e5));
  const { plans, adds, edits, requests } = React.useMemo(() => {
    const dates = [today, tomorrow];
    const plans = new Map<string, Map<string, ManagerChatMessage>>();
    const addTmp = new Map<string, Map<string, Map<string, TomorrowPlanEntry>>>();
    const edits = new Map<string, Map<string, { time: string; modality?: string | null; remark?: string | null; history?: PlanRescheduleHop[] | null; createdAt: string }>>();
    const acted = new Set<string>();
    const reqs: ManagerChatMessage[] = [];
    msgs.forEach((m) => {
      const pl = m.payload ?? {};
      if (pl.request_id) acted.add(pl.request_id);
      if (m.kind === 'tomorrow_plan' && pl.date && dates.includes(pl.date) && physios.has(m.senderId)) {
        if (!plans.has(pl.date)) plans.set(pl.date, new Map());
        plans.get(pl.date)!.set(m.senderId, m);
      } else if (m.kind === 'plan_add' && pl.date && dates.includes(pl.date) && pl.trainer_id && physios.has(pl.trainer_id) && pl.client_id) {
        if (!addTmp.has(pl.date)) addTmp.set(pl.date, new Map());
        const byTr = addTmp.get(pl.date)!;
        if (!byTr.has(pl.trainer_id)) byTr.set(pl.trainer_id, new Map());
        byTr.get(pl.trainer_id)!.set(pl.client_id, { client_id: pl.client_id, name: pl.name ?? 'Client', time: pl.time ?? '07:00', modality: pl.modality ?? null, schedule_id: pl.schedule_id ?? null, roster: pl.schedule_id ? 'created' : 'conflict' });
      } else if (m.kind === 'plan_time_edit' && pl.date && pl.trainer_id && pl.client_id && pl.time) {
        if (!edits.has(pl.date)) edits.set(pl.date, new Map());
        edits.get(pl.date)!.set(`${pl.trainer_id}:${pl.client_id}`, { time: pl.time, modality: pl.modality ?? null, remark: pl.remark ?? null, history: pl.history ?? null, createdAt: m.createdAt });
      } else if (m.kind === 'plan_reschedule_request' && pl.trainer_id && physios.has(pl.trainer_id)) {
        reqs.push(m);
      }
    });
    const adds = new Map<string, Map<string, TomorrowPlanEntry[]>>();
    addTmp.forEach((byTr, d) => { const out = new Map<string, TomorrowPlanEntry[]>(); byTr.forEach((v, k) => out.set(k, [...v.values()])); adds.set(d, out); });
    return { plans, adds, edits, requests: reqs.filter((m) => !acted.has(m.id)) };
  }, [msgs, physios, today, tomorrow]);
  const doctorSet = React.useMemo(() => new Set(physios.keys()), [physios]);
  const synthTeam: ManagerTeamInfo = React.useMemo(() => ({
    scoreId: teams[0]?.scoreId ?? 'hod-all',
    teamName: 'All Physios',
    managerId: '',
    isManager: false,
    start: teams[0]?.start ?? today,
    end: teams[0]?.end ?? null,
    active: true,
    daysLeft: teams[0]?.daysLeft ?? null,
    pctElapsed: teams[0]?.pctElapsed ?? 0,
    members: [...physios.entries()].map(([id, v]) => ({ id, name: v.name, role: v.role ?? 'doctor', isManager: false })),
  }), [teams, physios, today]);
  const openAdd = (trainerId: string, trainerName: string, date: string) => {
    const scoreId = physios.get(trainerId)?.scoreId ?? teams[0]?.scoreId ?? '';
    const planEntries = plans.get(date)?.get(trainerId)?.payload?.entries ?? [];
    const addIds = (adds.get(date)?.get(trainerId) ?? []).map((e) => e.client_id).filter(Boolean) as string[];
    onAddSession({ date, trainerId, trainerName, scoreId, scheduledIds: [...(planEntries.map((e) => e.client_id).filter(Boolean) as string[]), ...addIds] });
  };
  return (
    <View style={{ gap: 12 }}>
      {/* Quick actions: ONE labeled block so plan + chat are never missed —
          the HOD's own tomorrow plan, per-physio adds, and team chats. */}
      <View style={{ borderRadius: 15, padding: 11, gap: 9, backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: hexA(C.gold, 0.3) }}>
        <Mono style={{ fontSize: 8, letterSpacing: 0.9, color: C.muted3 }}>ADD A SESSION FOR A PHYSIO · TODAY OR TOMORROW</Mono>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {[...physios.entries()].filter(([id]) => id !== meId).map(([id, v]) => (
            <Pressable
              key={id}
              onPress={() => Alert.alert(`Add session · ${v.name.split(' ')[0]}`, 'Which day?', [
                { text: 'Today', onPress: () => openAdd(id, v.name, today) },
                { text: 'Tomorrow', onPress: () => openAdd(id, v.name, tomorrow) },
                { text: 'Cancel', style: 'cancel' },
              ])}
              style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, backgroundColor: hexA(C.gold, 0.08), borderWidth: 1, borderColor: hexA(C.gold, 0.35) }}
            >
              <Mono style={{ fontSize: 9, color: C.gold }}>+ {v.name.split(' ')[0]}</Mono>
            </Pressable>
          ))}
        </View>
        <Mono style={{ fontSize: 8, letterSpacing: 0.9, color: C.muted3 }}>OPEN A TEAM CHAT</Mono>
        <HScroll gap={6}>
          {teams.map((t) => (
            <Pressable key={t.scoreId} onPress={() => onOpenChat(t.scoreId)} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6, paddingHorizontal: 11, borderRadius: 999, backgroundColor: hexA(C.green, 0.1), borderWidth: 1, borderColor: hexA(C.green, 0.4) }}>
              <Icon name="chat" size={11} color={C.green} strokeWidth={2.2} />
              <Mono style={{ fontSize: 9, color: C.green }}>{t.teamName.toUpperCase()}</Mono>
            </Pressable>
          ))}
        </HScroll>
      </View>
      {requests.length > 0 ? (
        <View style={{ gap: 8 }}>
          <Mono style={{ fontSize: 9.5, letterSpacing: 1.2, color: C.gold }}>RESCHEDULE REQUESTS · {requests.length}</Mono>
          {requests.map((m) => (
            <RequestCard key={m.id} m={m} status={'pending'} isMgr={false} meIsHod hodTarget busy={busy} onApprove={() => onActRequest(m, true)} onReject={() => onActRequest(m, false)} />
          ))}
        </View>
      ) : null}
      {/* TODAY first (what's happening now), tomorrow's plan below it */}
      {[today, tomorrow].map((d) => ((plans.get(d)?.size ?? 0) > 0 || (adds.get(d)?.size ?? 0) > 0) ? (
        <MergedPlanCard
          key={d}
          date={d}
          bySender={plans.get(d) ?? new Map()}
          team={synthTeam}
          meId={meId}
          timeEdits={edits.get(d) ?? new Map()}
          onEditTime={onEditTime}
          onRequestChange={null}
          adds={adds.get(d) ?? new Map()}
          onAddSession={(r) => openAdd(r.trainerId, r.trainerName, r.date)}
          doctorIds={doctorSet}
          meIsHod
          onHodRemark={onHodRemark}
        />
      ) : null)}
      {msgsQ.isLoading ? <ActivityIndicator color={C.green} /> : null}
    </View>
  );
}

/* ---------- HOD "All Physios" digest ----------
   One team's doctor activity for today + tomorrow: pending doctor requests
   (Approve/Reject) and the merged day cards filtered to DOCTOR sections, with
   the HOD's reschedule/remark controls. Rendered per team in the feed. */
function HodDoctorDigest({ team, meId, busy, onEditTime, onHodRemark, onActRequest, onAddSession, onOpenChat }: {
  team: ManagerTeamInfo; meId: string | null; busy: boolean;
  onEditTime: (r: { date: string; clientId: string; name: string; trainerId: string; current: string; currentModality: string | null; scheduleId: string | null }) => void;
  onHodRemark: (r: { scheduleId: string; name: string }) => void;
  onActRequest: (m: ManagerChatMessage, approve: boolean) => void;
  onAddSession: (r: { date: string; trainerId: string; trainerName: string; scoreId: string; scheduledIds: string[] }) => void;
  onOpenChat: (scoreId: string) => void;
}) {
  const msgsQ = useManagerTeamMessages(team.scoreId);
  // No per-team channel here: HodAllFeed's single 'hod-feed-all' subscription
  // refreshes every team's chat cache (one insert used to fire three handlers).
  const msgs = msgsQ.data ?? [];
  const doctorIds = React.useMemo(() => new Set(team.members.filter((m) => isHodManagedRole(m.role)).map((m) => m.id)), [team.members]);
  const today = istToday();
  const tomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(serverNow().getTime() + 864e5));
  const { plans, adds, edits, requests } = React.useMemo(() => {
    const dates = [today, tomorrow];
    const plans = new Map<string, Map<string, ManagerChatMessage>>();
    const addTmp = new Map<string, Map<string, Map<string, TomorrowPlanEntry>>>();
    const edits = new Map<string, Map<string, { time: string; modality?: string | null; remark?: string | null; history?: PlanRescheduleHop[] | null; createdAt: string }>>();
    const acted = new Set<string>();
    const reqs: ManagerChatMessage[] = [];
    msgs.forEach((m) => {
      const pl = m.payload ?? {};
      if (pl.request_id) acted.add(pl.request_id);
      if (m.kind === 'tomorrow_plan' && pl.date && dates.includes(pl.date) && doctorIds.has(m.senderId)) {
        if (!plans.has(pl.date)) plans.set(pl.date, new Map());
        plans.get(pl.date)!.set(m.senderId, m);
      } else if (m.kind === 'plan_add' && pl.date && dates.includes(pl.date) && pl.trainer_id && doctorIds.has(pl.trainer_id) && pl.client_id) {
        if (!addTmp.has(pl.date)) addTmp.set(pl.date, new Map());
        const byTr = addTmp.get(pl.date)!;
        if (!byTr.has(pl.trainer_id)) byTr.set(pl.trainer_id, new Map());
        byTr.get(pl.trainer_id)!.set(pl.client_id, { client_id: pl.client_id, name: pl.name ?? 'Client', time: pl.time ?? '07:00', modality: pl.modality ?? null, schedule_id: pl.schedule_id ?? null, roster: pl.schedule_id ? 'created' : 'conflict' });
      } else if (m.kind === 'plan_time_edit' && pl.date && pl.trainer_id && pl.client_id && pl.time) {
        if (!edits.has(pl.date)) edits.set(pl.date, new Map());
        edits.get(pl.date)!.set(`${pl.trainer_id}:${pl.client_id}`, { time: pl.time, modality: pl.modality ?? null, remark: pl.remark ?? null, history: pl.history ?? null, createdAt: m.createdAt });
      } else if (m.kind === 'plan_reschedule_request' && pl.trainer_id && doctorIds.has(pl.trainer_id)) {
        reqs.push(m);
      }
    });
    const adds = new Map<string, Map<string, TomorrowPlanEntry[]>>();
    addTmp.forEach((byTr, d) => { const out = new Map<string, TomorrowPlanEntry[]>(); byTr.forEach((v, k) => out.set(k, [...v.values()])); adds.set(d, out); });
    return { plans, adds, edits, requests: reqs.filter((m) => !acted.has(m.id)) };
  }, [msgs, doctorIds, today, tomorrow]);
  const dates = [today, tomorrow];
  if (!doctorIds.size) return null;
  const openAdd = (trainerId: string, trainerName: string, date: string) => {
    const planEntries = plans.get(date)?.get(trainerId)?.payload?.entries ?? [];
    const addIds = (adds.get(date)?.get(trainerId) ?? []).map((e) => e.client_id).filter(Boolean) as string[];
    onAddSession({ date, trainerId, trainerName, scoreId: team.scoreId, scheduledIds: [...(planEntries.map((e) => e.client_id).filter(Boolean) as string[]), ...addIds] });
  };
  return (
    <View style={{ gap: 9 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Mono style={{ fontSize: 9.5, letterSpacing: 1.2, color: C.green }}>TEAM {team.teamName.toUpperCase()}</Mono>
        <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.07)' }} />
        <Pressable onPress={() => onOpenChat(team.scoreId)} hitSlop={6} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 9, borderRadius: 999, backgroundColor: hexA(C.green, 0.12), borderWidth: 1, borderColor: hexA(C.green, 0.45) }}>
          <Icon name="chat" size={10} color={C.green} strokeWidth={2.2} />
          <Mono style={{ fontSize: 8.5, letterSpacing: 0.5, color: C.green }}>CHAT</Mono>
        </Pressable>
      </View>
      {/* start or grow a doctor's TOMORROW plan even when nothing is shared yet */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {team.members.filter((mm) => isHodManagedRole(mm.role)).map((d) => (
          <Pressable key={d.id} onPress={() => openAdd(d.id, d.name, tomorrow)} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4.5, paddingHorizontal: 9, borderRadius: 999, backgroundColor: hexA(C.gold, 0.1), borderWidth: 1, borderColor: hexA(C.gold, 0.4) }}>
            <Mono style={{ fontSize: 8.5, color: C.gold }}>+ {d.name.split(' ')[0]} · TOMORROW</Mono>
          </Pressable>
        ))}
      </View>
      {requests.map((m) => (
        <RequestCard key={m.id} m={m} status={'pending'} isMgr={false} meIsHod hodTarget busy={busy} onApprove={() => onActRequest(m, true)} onReject={() => onActRequest(m, false)} />
      ))}
      {dates.map((d) => ((plans.get(d)?.size ?? 0) > 0 || (adds.get(d)?.size ?? 0) > 0) ? (
        <MergedPlanCard
          key={d}
          date={d}
          bySender={plans.get(d) ?? new Map()}
          team={team}
          meId={meId}
          timeEdits={edits.get(d) ?? new Map()}
          onEditTime={onEditTime}
          onRequestChange={null}
          adds={adds.get(d) ?? new Map()}
          onAddSession={(r) => openAdd(r.trainerId, r.trainerName, r.date)}
          doctorIds={doctorIds}
          meIsHod
          onHodRemark={onHodRemark}
          sectionFilter={(id) => doctorIds.has(id)}
        />
      ) : null)}
    </View>
  );
}

/* ---------- Reschedule request bubble ----------
   A member asks the manager to move their session. PENDING until the manager
   taps Approve (real roster reschedule + history chain) or Reject; the status
   chip updates in place for the whole team. */
function RequestCard({ m, status, isMgr, busy, onApprove, onReject, hodTarget, meIsHod }: {
  m: ManagerChatMessage; hodTarget: boolean; meIsHod: boolean; status: 'pending' | 'approved' | 'rejected'; isMgr: boolean; busy: boolean;
  onApprove: () => void; onReject: () => void;
}) {
  const p = m.payload ?? {};
  const col = status === 'approved' ? C.green : status === 'rejected' ? C.red : C.gold;
  return (
    <View style={{ borderRadius: 15, overflow: 'hidden', minWidth: 240, backgroundColor: 'rgba(26,20,15,0.92)', borderWidth: 1, borderColor: hexA(col, 0.45) }}>
      <View style={{ height: 2.5, backgroundColor: hexA(col, 0.6) }} />
      <View style={{ padding: 11, gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <Mono style={{ flex: 1, fontSize: 9, letterSpacing: 1, color: col }}>RESCHEDULE REQUEST</Mono>
          <View style={{ paddingVertical: 2, paddingHorizontal: 8, borderRadius: 999, backgroundColor: hexA(col, 0.14), borderWidth: 1, borderColor: hexA(col, 0.45) }}>
            <Mono style={{ fontSize: 8, letterSpacing: 0.6, color: col }}>{status.toUpperCase()}</Mono>
          </View>
        </View>
        <Body style={{ fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }}>{p.name}</Body>
        <Mono style={{ fontSize: 10, color: C.muted2 }}>
          {p.date ? istDayLabel(p.date) : ''} · {p.from_time ? fmt12h(p.from_time) : '?'} to {p.to_time ? fmt12h(p.to_time) : '?'}{p.to_modality ? `  ·  ${p.to_modality}` : ''}
        </Mono>
        {p.reason ? <Body style={{ fontSize: 12, color: C.ink2, lineHeight: 16 }}>{p.reason}</Body> : null}
        {hodTarget && !meIsHod ? (
          <Mono style={{ fontSize: 8, letterSpacing: 0.6, color: PINK_SOFT }}>HANDLED BY THE PHYSIO HOD</Mono>
        ) : null}
        {((isMgr && !hodTarget) || (meIsHod && hodTarget)) && status === 'pending' ? (
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 3 }}>
            <Pressable disabled={busy} onPress={onReject} style={{ flex: 1, paddingVertical: 9, borderRadius: 11, alignItems: 'center', backgroundColor: hexA(C.red, 0.1), borderWidth: 1, borderColor: hexA(C.red, 0.4), opacity: busy ? 0.6 : 1 }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: C.red }}>Reject</Text>
            </Pressable>
            <Pressable disabled={busy} onPress={onApprove} style={{ flex: 1, paddingVertical: 9, borderRadius: 11, alignItems: 'center', backgroundColor: hexA(C.green, 0.12), borderWidth: 1, borderColor: hexA(C.green, 0.45), opacity: busy ? 0.6 : 1 }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: C.green }}>Approve</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
}

/* ---------- @mention-aware message body ----------
   Sized to the Messenger house bubble type (14.5/20) for readability. */
function MsgBody({ body, mine, firstNames, myFirst }: { body: string; mine: boolean; firstNames: Set<string>; myFirst: string }) {
  const parts = body.split(/(@\w+)/g);
  return (
    <Text selectable style={{ fontFamily: F.body, fontSize: 14.5, lineHeight: 20, color: mine ? '#fff' : C.ink }}>
      {parts.map((p, i) => {
        if (p.startsWith('@') && firstNames.has(p.slice(1).toLowerCase())) {
          const isMe = p.slice(1).toLowerCase() === myFirst;
          return (
            <Text key={i} style={{ fontFamily: F.bodyBold, color: mine ? '#FFE9D2' : isMe ? C.gold : C.orange }}>{p}</Text>
          );
        }
        return p;
      })}
    </Text>
  );
}

/* ---------- Tomorrow's Plan compose sheet ----------
   Fed by session_schedule (tomorrow's slots pre-selected at their real time),
   then the rest of the actively-training book as manual picks. */
// 30-minute grid, 05:00 through 22:30 (36 slots) — drives compose, reschedule
// and request dialogs on both platforms.
const SHEET_TIMES: string[] = (() => { const o: string[] = []; for (let h = 5; h <= 22; h++) { o.push(`${String(h).padStart(2, '0')}:00`); o.push(`${String(h).padStart(2, '0')}:30`); } return o; })();
function TomorrowPlanSheet({ visible, onClose, onSend, sending, existing, addOnly }: {
  visible: boolean; onClose: () => void; sending: boolean;
  onSend: (date: string, entries: TomorrowPlanEntry[]) => void;
  existing: ManagerChatMessage | null; // my already-shared plan for tomorrow — edit it, don't start over
  addOnly: boolean; // members after sharing: existing entries LOCKED, new clients can still be added
}) {
  const insets = useSafeAreaInsets();
  const { dbRole } = useAuth();
  const modalityOptions = dbRole === 'doctor' ? DOCTOR_MODALITIES : dbRole === 'therapist' ? THERAPIST_MODALITIES : TRAINER_MODALITIES;
  const composeQ = useTomorrowCompose(visible);
  type SelVal = { time: string; modality: string | null };
  const [sel, setSel] = React.useState<Map<string, SelVal>>(new Map()); // clientId -> {time 'HH:mm', modality}
  const [timeFor, setTimeFor] = React.useState<string | null>(null);    // row with the time strip open
  const [modFor, setModFor] = React.useState<string | null>(null);      // row with the modality strip open
  // Seed the selection ONCE per open (again only if the plan being edited
  // changes). It used to re-seed on every data update, but the compose query
  // refetches in the background whenever it is 30 s stale and the app comes
  // back to the foreground (focusManager) or NetInfo reports a reconnect
  // (onlineManager, which flaps on Android): three or four picks in, the whole
  // selection vanished. A background refresh now only refreshes the rows.
  const seededRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!visible) { seededRef.current = null; return; }
    if (!composeQ.data) return;
    const tag = existing?.id ?? 'fresh';
    if (seededRef.current === tag) return;
    seededRef.current = tag;
    if (existing?.payload?.entries?.length) {
      // Reopening after sharing: restore MY submitted selection for editing.
      setSel(new Map(existing.payload.entries.filter((e) => e.client_id).map((e) => [e.client_id!, { time: e.time, modality: e.modality ?? null }])));
    } else {
      // Fresh plan: nothing pre-selected — the trainer picks every client and
      // slot themselves (roster slot seeds the time, last session seeds the modality).
      setSel(new Map());
    }
    setTimeFor(null); setModFor(null);
  }, [visible, composeQ.data, existing?.id]);
  const baseRows = composeQ.data?.rows ?? [];
  // Previously-submitted clients that fell out of the roster/book still render
  // (selected, editable) so the shared plan is never silently truncated.
  const extraRows = (existing?.payload?.entries ?? [])
    .filter((e) => e.client_id && !baseRows.some((r) => r.clientId === e.client_id))
    .map((e) => ({ clientId: e.client_id!, name: e.name, slotTime: null, scheduled: false, lastModality: e.modality ?? null }));
  const rows = [...baseRows, ...extraRows].sort((a, b) => a.name.localeCompare(b.name));
  const count = sel.size;
  // Weekly-protocol chips on compose rows (§8) — batch lookup, 5 min cache.
  const protoQ = useClientProtocols(rows.map((r) => r.clientId));
  const protocols = protoQ.data ?? {};
  const [protoFor, setProtoFor] = React.useState<{ name: string; proto: ClientProtocol } | null>(null);
  // Add-only mode: already-shared clients are locked (visible for context, not
  // editable); only NEW clients count toward the button.
  const lockedIds = React.useMemo(
    () => new Set((addOnly ? (existing?.payload?.entries ?? []) : []).map((e) => e.client_id).filter(Boolean) as string[]),
    [addOnly, existing?.id]);
  const newCount = count - [...sel.keys()].filter((k) => lockedIds.has(k)).length;
  // Tapping a locked (already-shared) row: shake it + warning haptic — the row
  // label spells out that only the manager can edit it.
  const shakeX = React.useRef(new Animated.Value(0)).current;
  const [shakeId, setShakeId] = React.useState<string | null>(null);
  const shakeLocked = (cid: string) => {
    setShakeId(cid);
    shakeX.setValue(0);
    Animated.sequence([
      Animated.timing(shakeX, { toValue: 8, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: -8, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: 6, duration: 45, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: -6, duration: 45, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: 0, duration: 40, useNativeDriver: true }),
    ]).start();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
  };
  const toggle = (cid: string, slotTime: string | null, lastModality: string | null) => {
    if (addOnly && lockedIds.has(cid)) { shakeLocked(cid); return; } // shared entries: manager-only edits
    setSel((prev) => {
      const next = new Map(prev);
      if (next.has(cid)) { next.delete(cid); if (timeFor === cid) setTimeFor(null); if (modFor === cid) setModFor(null); }
      else { next.set(cid, { time: slotTime ?? '07:00', modality: lastModality }); if (!slotTime) setTimeFor(cid); }
      return next;
    });
  };
  const send = () => {
    if (!composeQ.data || !count || sending) return;
    const entries: TomorrowPlanEntry[] = rows.filter((r) => sel.has(r.clientId)).map((r) => {
      const v = sel.get(r.clientId)!;
      return { client_id: r.clientId, name: r.name, time: v.time, modality: v.modality };
    });
    if (addOnly && newCount === 0) return; // nothing new to add
    // Modality is MANDATORY on every selected client (locked legacy entries exempt).
    const missingMod = entries.filter((e) => !e.modality && !(addOnly && e.client_id && lockedIds.has(e.client_id)));
    if (missingMod.length) {
      Alert.alert('Modality required', `Set the modality for: ${missingMod.map((e) => e.name.split(' ')[0]).join(', ')}`);
      return;
    }
    // Gap rule: sessions must be at least 30 minutes apart. Exactly the SAME
    // time is allowed with confirmation (couple sessions are legitimate);
    // a gap of 1-29 minutes is blocked outright, with the reason spelled out.
    const toMin = (t: string) => { const [h, mi] = t.split(':').map(Number); return h * 60 + mi; };
    const sorted = [...entries].sort((a, b) => toMin(a.time) - toMin(b.time));
    const tooClose: string[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const gap = toMin(sorted[i].time) - toMin(sorted[i - 1].time);
      if (gap > 0 && gap < 30) {
        tooClose.push(`${fmt12h(sorted[i - 1].time)} ${sorted[i - 1].name.split(' ')[0]} and ${fmt12h(sorted[i].time)} ${sorted[i].name.split(' ')[0]} (only ${gap} min apart)`);
      }
    }
    if (tooClose.length) {
      Alert.alert(
        'Sessions too close',
        `Keep at least 30 minutes between your sessions. These are too close to send:\n\n${tooClose.join('\n')}\n\nMove one of the times, then send again.`,
      );
      return;
    }
    // Exact same-time sessions (couple training) still confirm before saving.
    const byTime = new Map<string, string[]>();
    entries.forEach((e) => byTime.set(e.time, [...(byTime.get(e.time) ?? []), e.name.split(' ')[0]]));
    const overlaps = [...byTime.entries()].filter(([, names]) => names.length > 1);
    if (overlaps.length) {
      Alert.alert(
        'Same-time sessions',
        overlaps.map(([t, names]) => `${fmt12h(t)}: ${names.join(' + ')}`).join('\n') + '\n\nAdd these to the roster anyway?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Add anyway', onPress: () => onSend(composeQ.data!.date, entries) },
        ],
      );
      return;
    }
    onSend(composeQ.data.date, entries);
  };
  const renderRow = (r: { clientId: string; name: string; slotTime: string | null; scheduled: boolean; lastModality: string | null }) => {
    const on = sel.has(r.clientId);
    const cur = sel.get(r.clientId);
    const locked = addOnly && lockedIds.has(r.clientId);
    // Options always include the row's current value even if it's off-list.
    const rowMods = cur?.modality && !modalityOptions.includes(cur.modality) ? [cur.modality, ...modalityOptions] : modalityOptions;
    return (
      <Animated.View key={r.clientId} style={{ borderRadius: 13, backgroundColor: on ? hexA(C.gold, 0.07) : 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: locked ? hexA(C.gold, 0.3) : on ? hexA(C.gold, 0.35) : 'rgba(255,255,255,0.07)', transform: [{ translateX: locked && shakeId === r.clientId ? shakeX : 0 }] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 11 }}>
          <Pressable onPress={() => toggle(r.clientId, r.slotTime, r.lastModality)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
            <View style={{ width: 21, height: 21, borderRadius: 7, alignItems: 'center', justifyContent: 'center', borderWidth: locked ? 1 : on ? 0 : 2, borderColor: locked ? hexA(C.gold, 0.5) : 'rgba(255,255,255,0.2)', backgroundColor: locked ? hexA(C.gold, 0.14) : on ? C.gold : 'transparent' }}>
              {locked
                ? <Icon path="M7 11V7a5 5 0 0 1 10 0v4M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2Z" size={11} color={C.gold} strokeWidth={2.2} />
                : on ? <Icon path="M20 6 9 17l-5-5" size={12} color="#1A1206" strokeWidth={3.2} /> : null}
            </View>
            <AvatarDot name={r.name} size={26} />
            <View style={{ flex: 1 }}>
              <Body style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }} numberOfLines={1}>{r.name}</Body>
              {locked ? <Mono style={{ fontSize: 8.5, color: C.gold, marginTop: 1 }}>LOCKED · ASK YOUR MANAGER TO EDIT</Mono>
                : r.slotTime ? <Mono style={{ fontSize: 8.5, color: C.muted3, marginTop: 1 }}>ROSTER {fmt12h(r.slotTime)}</Mono> : null}
            </View>
          </Pressable>
          {protocols[r.clientId] ? <ProtocolChip onPress={() => setProtoFor({ name: r.name, proto: protocols[r.clientId] })} /> : null}
          {on ? (
            <Pressable onPress={() => { if (locked) { shakeLocked(r.clientId); return; } setModFor(modFor === r.clientId ? null : r.clientId); setTimeFor(null); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, backgroundColor: hexA(PINK, locked ? 0.06 : 0.12), borderWidth: 1, borderColor: hexA(PINK, locked ? 0.2 : 0.4), opacity: locked ? 0.7 : 1 }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 10.5, color: PINK_SOFT }} numberOfLines={1}>{cur?.modality ?? 'Modality'}</Text>
              {!locked ? <Icon name="chevDown" size={9} color={PINK_SOFT} strokeWidth={2.4} /> : null}
            </Pressable>
          ) : null}
          {on ? (
            <Pressable onPress={() => { if (locked) { shakeLocked(r.clientId); return; } setTimeFor(timeFor === r.clientId ? null : r.clientId); setModFor(null); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6, paddingHorizontal: 11, borderRadius: 999, backgroundColor: hexA(C.gold, locked ? 0.07 : 0.13), borderWidth: 1, borderColor: hexA(C.gold, locked ? 0.25 : 0.45), opacity: locked ? 0.7 : 1 }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 11.5, color: C.gold }}>{cur?.time ? fmt12h(cur.time) : 'Pick time'}</Text>
              {!locked ? <Icon name="chevDown" size={10} color={C.gold} strokeWidth={2.4} /> : null}
            </Pressable>
          ) : null}
        </View>
        {on && timeFor === r.clientId ? (
          <View style={{ paddingHorizontal: 11, paddingBottom: 10 }}>
            <HScroll gap={6}>
              {SHEET_TIMES.map((t) => {
                const active = cur?.time === t;
                return (
                  <Pressable key={t} onPress={() => { setSel((prev) => new Map(prev).set(r.clientId, { time: t, modality: prev.get(r.clientId)?.modality ?? null })); setTimeFor(null); }} style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 9, backgroundColor: active ? hexA(C.gold, 0.18) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.gold, 0.55) : 'rgba(255,255,255,0.08)' }}>
                    <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 10.5, color: active ? C.gold : C.muted }}>{fmt12h(t)}</Text>
                  </Pressable>
                );
              })}
            </HScroll>
          </View>
        ) : null}
        {on && modFor === r.clientId ? (
          <View style={{ paddingHorizontal: 11, paddingBottom: 10 }}>
            <HScroll gap={6}>
              {rowMods.map((mName) => {
                const active = cur?.modality === mName;
                return (
                  <Pressable key={mName} onPress={() => { setSel((prev) => new Map(prev).set(r.clientId, { time: prev.get(r.clientId)?.time ?? '07:00', modality: mName })); setModFor(null); }} style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 9, backgroundColor: active ? hexA(PINK, 0.18) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(PINK, 0.55) : 'rgba(255,255,255,0.08)' }}>
                    <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 10.5, color: active ? PINK_SOFT : C.muted }}>{mName}</Text>
                  </Pressable>
                );
              })}
            </HScroll>
          </View>
        ) : null}
      </Animated.View>
    );
  };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Backdrop is a SIBLING of the sheet, not a parent: wrapping the sheet in
         Pressables makes every scroll/tap negotiate with the press responder
         first, which is what made the list feel sticky. */}
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable onPress={onClose} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)' }} />
        <View style={{ maxHeight: '88%', backgroundColor: '#0E0A09', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.14)', paddingHorizontal: 18, paddingTop: 14 }}>
          <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 12 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
            <View style={{ width: 38, height: 38, borderRadius: 13, backgroundColor: hexA(C.gold, 0.12), borderWidth: 1, borderColor: hexA(C.gold, 0.4), alignItems: 'center', justifyContent: 'center', marginRight: 11 }}>
              <Icon name="calendar" size={17} color={C.gold} strokeWidth={2.1} />
            </View>
            <View style={{ flex: 1 }}>
              <Serif style={{ fontSize: 20 }}>Tomorrow's Plan</Serif>
              <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 2 }}>
                {composeQ.data ? istDayLabel(composeQ.data.date) : '…'} · {addOnly ? 'adding to your shared plan' : existing ? 'editing your shared plan' : 'share your day with the team'}
              </Body>
            </View>
            <Pressable onPress={onClose} hitSlop={8} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="close" size={14} color="#B8B2AC" strokeWidth={2.3} />
            </Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" nestedScrollEnabled contentContainerStyle={{ gap: 7, paddingBottom: 100 }}>
            {composeQ.isLoading ? (
              <View style={{ alignItems: 'center', paddingVertical: 26, gap: 10 }}>
                <ActivityIndicator color={C.gold} />
                <Body style={{ fontSize: 12, color: C.muted3 }}>Loading tomorrow's roster…</Body>
              </View>
            ) : composeQ.isError ? (
              <Body style={{ fontSize: 12.5, color: C.red, textAlign: 'center', paddingVertical: 20 }}>Couldn't load your roster — check your connection and reopen.</Body>
            ) : rows.length === 0 ? (
              <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 20 }}>No active clients in your book yet.</Body>
            ) : rows.map(renderRow)}
          </ScrollView>
          <View style={{ position: 'absolute', left: 18, right: 18, bottom: insets.bottom + 12 }}>
            <Pressable onPress={send} disabled={!count || sending || (addOnly && newCount === 0)} style={{ opacity: !count || sending || (addOnly && newCount === 0) ? 0.5 : 1 }}>
              <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 14 }}>
                <Icon name="send" size={15} color="#fff" strokeWidth={2.4} />
                <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: '#fff' }}>
                  {sending ? 'Sending…' : addOnly ? `Add · ${newCount} client${newCount === 1 ? '' : 's'}` : `${existing ? 'Update' : 'Send'} · ${count} client${count === 1 ? '' : 's'}`}
                </Text>
              </LinearGradient>
            </Pressable>
          </View>
        </View>
      </View>
      <ProtocolPopup info={protoFor} onClose={() => setProtoFor(null)} />
    </Modal>
  );
}

/* ---------- The chat screen ---------- */
export function ManagerChat() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { back, canGoBack, go } = useStore();
  const { session, dbRole } = useAuth();
  const meId = session?.user?.id ?? null;
  const teamQ = useMyManagerTeam();
  const hodQ = usePhysioHod();
  const hodId = hodQ.data?.hodId ?? null;
  const meIsHod = !!hodQ.data?.meIsHod;
  // The HOD is a member of no team: her Team Messenger shows every current team
  // containing a doctor, with a switcher. Same UI, per-section authority.
  const hodTeamsQ = useHodTeams(meIsHod && !teamQ.data);
  const hodTeams = hodTeamsQ.data ?? [];
  const [hodTeamIdx, setHodTeamIdx] = React.useState(0);
  const [hodView, setHodView] = React.useState<'all' | 'team'>('all'); // HOD lands on the All-Physios feed
  const team = teamQ.data ?? (meIsHod ? hodTeams[Math.min(hodTeamIdx, Math.max(0, hodTeams.length - 1))] ?? null : null);
  // Doctor members: HOD controls them, the manager is VIEW-ONLY.
  const doctorIds = React.useMemo(() => new Set((team?.members ?? []).filter((mm) => isHodManagedRole(mm.role)).map((mm) => mm.id)), [team?.members]);
  const msgsQ = useManagerTeamMessages(team?.scoreId ?? null);
  useManagerChatRealtime(team?.scoreId ?? null);
  const meName = team?.members.find((m) => m.id === meId)?.name ?? 'You';
  const sendM = useSendManagerTeamMessage(meId, meName, dbRole);
  // @mention support: match tokens against members' first names.
  const firstNames = React.useMemo(() => new Set((team?.members ?? []).map((m) => m.name.split(' ')[0].toLowerCase())), [team?.members]);
  const myFirst = meName.split(' ')[0].toLowerCase();
  const [input, setInput] = React.useState('');
  const [planOpen, setPlanOpen] = React.useState(false);
  // Team-flags remark save: updates the message payload in place (RLS allows
  // only the manager, only on team_flags rows). savingKey = `${msgId}:${trainerId}`.
  const [flagSaving, setFlagSaving] = React.useState<string | null>(null);
  const saveFlagRemark = React.useCallback(async (messageId: string, trainerId: string, remark: string) => {
    const key = `${messageId}:${trainerId}`;
    setFlagSaving(key);
    try {
      const msg = (msgsQ.data ?? []).find((x) => x.id === messageId);
      const flags = (msg?.payload?.flags ?? []).map((f) => {
        if (f.trainer_id !== trainerId) return f;
        // Editing an existing remark: archive the previous version so the
        // full trail lives in the payload; the UI shows only the latest.
        const history = f.remark && f.remark !== remark.trim()
          ? [...(f.remark_history ?? []), { remark: f.remark, by: f.remark_by ?? null, at: f.remark_at ?? null }]
          : (f.remark_history ?? []);
        return {
          ...f,
          remark: remark.trim(),
          remark_by: meId,
          remark_at: new Date().toISOString(),
          remark_history: history,
          closed: true,
        };
      });
      const { error } = await supabase
        .from('manager_team_messages')
        .update({ payload: { ...(msg?.payload ?? {}), flags } })
        .eq('id', messageId);
      if (error) throw new Error(error.message);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      qc.invalidateQueries({ queryKey: ['manager-chat', team?.scoreId] });
    } catch (e: any) {
      Alert.alert('Could not save remark', e?.message ?? 'Try again');
    } finally {
      setFlagSaving(null);
    }
  }, [msgsQ.data, meId, qc, team?.scoreId]);
  const [kbH, setKbH] = React.useState(0);
  const listRef = React.useRef<FlatList<ManagerChatMessage>>(null);
  const msgs = msgsQ.data ?? [];
  // Quoted replies (§3): the message being replied to + flash-highlight target.
  const [replyTo, setReplyTo] = React.useState<{ id: string; name: string; body: string } | null>(null);
  const [flashId, setFlashId] = React.useState<string | null>(null);
  // Approving a request that can't one-tap (missing schedule/time) opens the
  // dialog prefilled; the saved edit must still carry the request id.
  const [editReqId, setEditReqId] = React.useState<string | null>(null);
  // Merge plan messages: ONE consolidated card per date, rendered where the
  // LAST plan message for that date sits; earlier plan messages are absorbed
  // into it (each trainer's latest send per date wins).
  const planMsgsByDate = React.useMemo(() => {
    const by = new Map<string, Map<string, ManagerChatMessage>>();
    msgs.forEach((m) => {
      if (m.kind !== 'tomorrow_plan' || !m.payload?.date) return;
      if (!by.has(m.payload.date)) by.set(m.payload.date, new Map());
      by.get(m.payload.date)!.set(m.senderId, m); // asc order → latest per sender wins
    });
    return by;
  }, [msgs]);
  const renderMsgs = React.useMemo(() => {
    const lastPlanIdByDate = new Map<string, string>();
    msgs.forEach((m) => { if (m.kind === 'tomorrow_plan' && m.payload?.date) lastPlanIdByDate.set(m.payload.date, m.id); });
    // plan_remark / plan_time_edit / decision messages never render as bubbles —
    // they attach to the card or update a request's status in place. plan_add
    // DOES render: the trainer must see in chat that the manager added a session.
    return msgs.filter((m) => m.kind !== 'plan_remark' && m.kind !== 'plan_time_edit' && m.kind !== 'plan_reschedule_decision' && !(m.kind === 'tomorrow_plan' && m.payload?.date && lastPlanIdByDate.get(m.payload.date) !== m.id));
  }, [msgs]);
  // §5 role-scoped stream for plain members: others' requests / add / update
  // notices are noise — keep only their own. Privileged viewers see everything.
  const privileged = !!team?.isManager || meIsHod;
  const scopedMsgs = React.useMemo(() => {
    if (privileged) return renderMsgs;
    return renderMsgs.filter((m) => {
      if (m.kind === 'plan_reschedule_request') return m.senderId === meId;
      if (m.kind === 'plan_add' || m.kind === 'session_update') return m.senderId === meId || m.payload?.trainer_id === meId;
      return true;
    });
  }, [renderMsgs, privileged, meId]);
  // Inverted list data (newest first) — opens pinned to the newest message.
  // Text sends that failed (offline fail-fast, retries exhausted, RLS rejection)
  // stay in the thread as a "Not sent · tap to retry" bubble — the message is
  // never lost and the composer stays free for the next one.
  const [failedSends, setFailedSends] = React.useState<ManagerChatMessage[]>([]);
  const listData = React.useMemo(() => [...[...failedSends].reverse(), ...[...scopedMsgs].reverse()], [scopedMsgs, failedSends]);
  // Jump to a message (quote tap): plan messages collapse into the day card at
  // the LAST plan slot for that date — redirect there. Flash ~1.6s on arrival.
  const jumpToMessage = React.useCallback((targetId: string) => {
    const target = msgs.find((x) => x.id === targetId);
    let id = targetId;
    if (target?.kind === 'tomorrow_plan' && target.payload?.date) {
      for (const m2 of msgs) { if (m2.kind === 'tomorrow_plan' && m2.payload?.date === target.payload.date) id = m2.id; }
    }
    const idx = listData.findIndex((x) => x.id === id);
    if (idx < 0) return;
    listRef.current?.scrollToIndex({ index: idx, viewPosition: 0.5, animated: true });
    setFlashId(id);
    setTimeout(() => setFlashId((cur) => (cur === id ? null : cur)), 1600);
  }, [msgs, listData]);
  const makeQuote = React.useCallback((m: ManagerChatMessage) => ({
    id: m.id,
    name: m.senderId === meId ? meName : m.senderName,
    body: (m.body ?? '').length > 120 ? `${(m.body ?? '').slice(0, 120)}…` : (m.body ?? ''),
  }), [meId, meName]);
  // Manager-added sessions: latest plan_add per (date, trainer, client),
  // manager- or HOD-sent — merged into that trainer's section on the card.
  // (The HOD adds sessions for doctors/therapists who live in MANAGER teams,
  // so their plan_adds arrive in this thread from outside the team.)
  const addsByDate = React.useMemo(() => {
    const by = new Map<string, Map<string, Map<string, TomorrowPlanEntry>>>();
    const mgrId = teamQ.data?.managerId;
    if (!mgrId) return by;
    msgs.forEach((m) => {
      if (m.kind !== 'plan_add' || (m.senderId !== mgrId && (!hodId || m.senderId !== hodId))) return;
      const p = m.payload ?? {};
      if (!p.date || !p.client_id || !p.trainer_id || !p.time) return;
      if (!by.has(p.date)) by.set(p.date, new Map());
      const byTr = by.get(p.date)!;
      if (!byTr.has(p.trainer_id)) byTr.set(p.trainer_id, new Map());
      byTr.get(p.trainer_id)!.set(p.client_id, { client_id: p.client_id, name: p.name ?? 'Client', time: p.time, modality: p.modality ?? null, schedule_id: p.schedule_id ?? null, roster: p.schedule_id ? 'created' : 'conflict' });
    });
    return by;
  }, [msgs, teamQ.data?.managerId, hodId]);
  const [addFor, setAddFor] = React.useState<{ date: string; trainerId: string; trainerName: string; scheduledIds: string[]; scoreId: string } | null>(null);
  // Request status: APPROVED when a manager plan_time_edit references the
  // request id; REJECTED when a manager decision message does; else PENDING.
  const reqStatus = React.useMemo(() => {
    const map = new Map<string, 'approved' | 'rejected'>();
    const mgrId = teamQ.data?.managerId;
    if (!mgrId) return map;
    msgs.forEach((m) => {
      if (m.senderId !== mgrId && m.senderId !== hodId) return;
      const rid = m.payload?.request_id;
      if (!rid) return;
      if (m.kind === 'plan_time_edit') map.set(rid, 'approved');
      else if (m.kind === 'plan_reschedule_decision' && m.payload?.approved === false && map.get(rid) !== 'approved') map.set(rid, 'rejected');
    });
    return map;
  }, [msgs, teamQ.data?.managerId]);
  // Manager time edits: latest plan_time_edit per (date, trainer, client), manager-sent only.
  // Applied ON TOP of a trainer's plan at render, but only when newer than that trainer's
  // plan message — a trainer re-sharing later supersedes older manager tweaks.
  const timeEditsByDate = React.useMemo(() => {
    const by = new Map<string, Map<string, { time: string; modality?: string | null; remark?: string | null; history?: PlanRescheduleHop[] | null; createdAt: string }>>();
    const mgrId = teamQ.data?.managerId;
    if (!mgrId) return by;
    msgs.forEach((m) => {
      if (m.kind !== 'plan_time_edit' || (m.senderId !== mgrId && m.senderId !== hodId)) return;
      const d = m.payload?.date; const cid = m.payload?.client_id; const tid = m.payload?.trainer_id; const t = m.payload?.time;
      if (!d || !cid || !tid || !t) return;
      if (!by.has(d)) by.set(d, new Map());
      by.get(d)!.set(`${tid}:${cid}`, { time: t, modality: m.payload?.modality ?? null, remark: m.payload?.remark ?? null, history: m.payload?.history ?? null, createdAt: m.createdAt }); // asc order → latest wins
    });
    return by;
  }, [msgs, teamQ.data?.managerId, hodId]);
  const [editTime, setEditTime] = React.useState<{ date: string; clientId: string; name: string; trainerId: string; current: string; currentModality: string | null; scheduleId: string | null } | null>(null);
  const [editMod, setEditMod] = React.useState<string | null>(null);
  const [editRemark, setEditRemark] = React.useState('');
  const [editIsRequest, setEditIsRequest] = React.useState(false); // member asking the manager, not the manager editing
  const [editViaHod, setEditViaHod] = React.useState(false);       // the physio HOD editing a doctor's session
  const [hodRemFor, setHodRemFor] = React.useState<{ scheduleId: string; name: string } | null>(null);
  const [hodRemCat, setHodRemCat] = React.useState<string | null>(null);
  const [hodRemText, setHodRemText] = React.useState('');
  // Missed-session remarks come from the TRAINER via Today's Roster; the card
  // reads them straight from session_schedule.missed_remarks (usePlanScheduleRows).
  // My latest shared plan for tomorrow — reopening the sheet edits it in place.
  const tomorrowDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(serverNow().getTime() + 864e5));
  const myTomorrowPlan = React.useMemo<ManagerChatMessage | null>(() => {
    let last: ManagerChatMessage | null = null;
    for (const m of msgs) { if (m.kind === 'tomorrow_plan' && m.senderId === meId && m.payload?.date === tomorrowDate) last = m; }
    return last;
  }, [msgs, meId, tomorrowDate]);
  // Sheet prefill respects newer manager time edits, so a trainer's Update
  // doesn't silently revert them.
  const myTomorrowPlanEffective = React.useMemo(() => {
    if (!myTomorrowPlan || !meId) return myTomorrowPlan;
    const edits = timeEditsByDate.get(tomorrowDate);
    if (!edits) return myTomorrowPlan;
    const base = Date.parse(myTomorrowPlan.createdAt);
    const entries = (myTomorrowPlan.payload?.entries ?? []).map((e) => {
      const ov = e.client_id ? edits.get(`${meId}:${e.client_id}`) : undefined;
      return ov && Date.parse(ov.createdAt) > base ? { ...e, time: ov.time } : e;
    });
    return { ...myTomorrowPlan, payload: { ...myTomorrowPlan.payload, entries } };
  }, [myTomorrowPlan, timeEditsByDate, tomorrowDate, meId]);

  React.useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const s = Keyboard.addListener(showEvt, (e: any) => setKbH(e.endCoordinates?.height ?? 0));
    const h = Keyboard.addListener(hideEvt, () => setKbH(0));
    return () => { s.remove(); h.remove(); };
  }, []);
  // Read-marking: entering the thread + every new message while it's on screen.
  // Marks up to the newest message's SERVER timestamp (clock-skew-proof).
  React.useEffect(() => {
    if (!team?.scoreId) return;
    markManagerChatRead(team.scoreId, msgs.length ? msgs[msgs.length - 1].createdAt : undefined);
  }, [team?.scoreId, msgs.length]);
  React.useEffect(() => { setReplyTo(null); }, [team?.scoreId]);

  const inputRef = React.useRef<TextInput>(null);
  const sendText = async () => {
    const body = input.trim();
    if (!body || !team || sendM.isPending) return;
    const quote = replyTo;
    setInput('');
    inputRef.current?.clear(); // native clear too — avoids stale composition artifacts
    setReplyTo(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      await sendM.mutateAsync({ scoreId: team.scoreId, body, payload: quote ? { reply_to: quote } : undefined });
    } catch (e: any) {
      setFailedSends((xs) => [...xs, {
        id: `failed-${Date.now()}-${xs.length}`, senderId: meId ?? '', senderName: meName, senderRole: dbRole,
        kind: 'text', payload: quote ? { reply_to: quote } : null, body, createdAt: new Date().toISOString(), _failed: true,
      }]);
    }
  };
  const retryFailed = async (m: ManagerChatMessage) => {
    if (!team || sendM.isPending) return;
    setFailedSends((xs) => xs.filter((x) => x.id !== m.id));
    try {
      await sendM.mutateAsync({ scoreId: team.scoreId, body: m.body, payload: m.payload?.reply_to ? { reply_to: m.payload.reply_to } : undefined });
    } catch (e: any) {
      setFailedSends((xs) => [...xs, m]);
      Alert.alert('Still not sent', e?.message ?? 'Check your connection and try again.');
    }
  };
  const discardFailed = (m: ManagerChatMessage) => setFailedSends((xs) => xs.filter((x) => x.id !== m.id));
  const saveTimeEdit = async (newTime: string) => {
    if (!team || !editTime || sendM.isPending) return;
    if (!editMod && editIsRequest) {
      Alert.alert('Modality required', 'Pick the session modality before sending.');
      return;
    }
    // MEMBER path: send a reschedule REQUEST to the manager (no roster write).
    if (editIsRequest) {
      const reason = editRemark.trim() || null;
      if (!reason) {
        Alert.alert('Reason required', 'Write why you need this session moved before picking the new time.');
        return;
      }
      try {
        await sendM.mutateAsync({
          scoreId: team.scoreId, kind: 'plan_reschedule_request',
          payload: { date: editTime.date, client_id: editTime.clientId, name: editTime.name, trainer_id: editTime.trainerId, schedule_id: editTime.scheduleId, from_time: editTime.current, to_time: newTime, from_modality: editTime.currentModality, to_modality: editMod, reason },
          body: `Reschedule request: ${editTime.name} ${fmt12h(editTime.current)} to ${fmt12h(newTime)} (${istDayLabel(editTime.date)})`,
        });
        setEditTime(null); setEditIsRequest(false); setEditRemark('');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      } catch (e: any) { Alert.alert('Request not sent', e?.message ?? 'Check your connection and try again.'); }
      return;
    }
    // Reason is REQUIRED for direct manager reschedules: it goes into the
    // message payload (history hop) and onto the roster row. When acting on a
    // member's request the reason is preset from the request (not re-required).
    const remark = editRemark.trim() || (editReqId ? 'Approved reschedule request' : null);
    if (!remark) {
      Alert.alert('Reason required', 'Write why this session is moving before picking the new time. The team and the roster record both keep it.');
      return;
    }
    if (!editMod) {
      Alert.alert('Modality required', 'Pick the session modality before saving.');
      return;
    }
    // Physio HOD editing a doctor's session: the RPC moves the roster AND posts
    // the team message itself — nothing else to send here.
    if (editViaHod) {
      if (!editTime.scheduleId) { Alert.alert('Not linked', 'This entry has no roster session to move.'); return; }
      try {
        const { error } = await supabase.rpc('hod_doctor_reschedule', { p_schedule: editTime.scheduleId, p_date: editTime.date, p_time: newTime, p_modality: editMod, p_remark: remark });
        if (error) { Alert.alert('Reschedule failed', error.message); return; }
        qc.invalidateQueries({ queryKey: ['mgr-plan-sched'] });
        qc.invalidateQueries({ queryKey: ['trainer-roster'] });
        qc.invalidateQueries({ queryKey: ['doctor-roster'] });
        qc.invalidateQueries({ queryKey: ['manager-chat'] });
        setEditTime(null); setEditRemark(''); setEditViaHod(false);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      } catch (err: any) { Alert.alert('Reschedule failed', String(err?.message ?? err)); }
      return;
    }
    // Linked entry → this is a REAL reschedule: the RPC moves the
    // session_schedule row, stamps reschedule_approved_by with the manager id
    // and stores the remark. If the roster update fails, nothing is posted —
    // the chat and the roster must never disagree.
    if (editTime.scheduleId) {
      try {
        const { error } = await supabase.rpc('plan_manager_reschedule', {
          p_score: team.scoreId, p_schedule: editTime.scheduleId, p_date: editTime.date,
          p_time: newTime, p_modality: editMod, p_remark: remark,
        });
        if (error) { Alert.alert('Reschedule failed', error.message); return; }
        qc.invalidateQueries({ queryKey: ['mgr-plan-sched'] }); // card re-reads the moved roster row
        qc.invalidateQueries({ queryKey: ['trainer-roster'] }); // my dashboard Today's Sessions
        qc.invalidateQueries({ queryKey: ['doctor-roster'] });
      } catch (err: any) { Alert.alert('Reschedule failed', String(err?.message ?? err)); return; }
    }
    // Cumulative history chain: session_schedule keeps only the LATEST approval,
    // so every edit message carries the whole chain (prior hops + this one).
    const prevEdit = timeEditsByDate.get(editTime.date)?.get(`${editTime.trainerId}:${editTime.clientId}`);
    const history: PlanRescheduleHop[] = [
      ...(prevEdit?.history ?? []),
      { from_time: editTime.current, to_time: newTime, from_modality: editTime.currentModality, to_modality: editMod, remark, by: meId, at: new Date().toISOString() },
    ];
    try {
      await sendM.mutateAsync({
        scoreId: team.scoreId, kind: 'plan_time_edit',
        payload: { date: editTime.date, client_id: editTime.clientId, name: editTime.name, trainer_id: editTime.trainerId, time: newTime, modality: editMod, schedule_id: editTime.scheduleId, remark: remark ?? undefined, request_id: editReqId ?? undefined, history },
        body: editReqId
          ? `Rescheduled ${editTime.name} to ${fmt12h(newTime)} (${istDayLabel(editTime.date)})`
          : `Manager moved ${editTime.name}'s session to ${fmt12h(newTime)}${editMod ? ` · ${editMod}` : ''} (${istDayLabel(editTime.date)})${remark ? ` · ${remark}` : ''}`,
      });
      setEditTime(null); setEditRemark(''); setEditReqId(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e: any) { Alert.alert('Reschedule message not sent', e?.message ?? 'The roster was updated, but the chat message failed. Check your connection and try again.'); }
  };
  // Manager adds a session into a member's day: roster row first, then the message.
  const saveAdd = async (clientId: string, clientName: string, time: string, modality: string) => {
    if (!team || !addFor || sendM.isPending) return;
    let scheduleId: string | null = null;
    try {
      const { data, error } = await supabase.rpc('plan_manager_add_session', {
        p_score: addFor.scoreId, p_trainer: addFor.trainerId, p_client: clientId,
        p_date: addFor.date, p_time: time, p_modality: modality,
      });
      if (error) { Alert.alert('Add failed', error.message); return; }
      if ((data as any)?.result === 'conflict') { Alert.alert('Not added', `${clientName} already has a session at that exact time.`); return; }
      if ((data as any)?.result === 'exists') { Alert.alert('Already scheduled', `${clientName} already has a session with this member that day. Use RESCHEDULE on the plan card to change it.`); return; }
      scheduleId = (data as any)?.schedule_id ?? null;
      qc.invalidateQueries({ queryKey: ['mgr-plan-sched'] });
      qc.invalidateQueries({ queryKey: ['trainer-roster'] });
      qc.invalidateQueries({ queryKey: ['doctor-roster'] });
    } catch (err: any) { Alert.alert('Add failed', String(err?.message ?? err)); return; }
    try {
      await sendM.mutateAsync({
        scoreId: addFor.scoreId, kind: 'plan_add',
        payload: { date: addFor.date, client_id: clientId, name: clientName, trainer_id: addFor.trainerId, time, modality, schedule_id: scheduleId },
        body: `Manager added ${clientName} at ${fmt12h(time)}${modality ? ` · ${modality}` : ''} to ${addFor.trainerName.split(' ')[0]}'s plan (${istDayLabel(addFor.date)})`,
      });
      setAddFor(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch { /* rollback visible */ }
  };
  // Physio HOD paths (SECURITY DEFINER RPCs post the team messages themselves).
  const hodActRequest = async (m: ManagerChatMessage, approve: boolean) => {
    if (sendM.isPending) return;
    try {
      const { error } = await supabase.rpc('hod_act_on_request', { p_request: m.id, p_approve: approve });
      if (error) { Alert.alert(approve ? 'Approve failed' : 'Reject failed', error.message); return; }
      qc.invalidateQueries({ queryKey: ['manager-chat'] });
      qc.invalidateQueries({ queryKey: ['mgr-plan-sched'] });
      qc.invalidateQueries({ queryKey: ['trainer-roster'] });
      qc.invalidateQueries({ queryKey: ['doctor-roster'] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (err: any) { Alert.alert('Failed', String(err?.message ?? err)); }
  };
  const saveHodRemark = async () => {
    if (!hodRemFor || sendM.isPending) return;
    const txt = hodRemText.trim();
    if (!txt || !hodRemCat) { Alert.alert('Incomplete', 'Pick a category and write the remark.'); return; }
    try {
      const { error } = await supabase.rpc('hod_doctor_missed_remark', { p_schedule: hodRemFor.scheduleId, p_category: hodRemCat, p_remark: txt });
      if (error) { Alert.alert('Remark failed', error.message); return; }
      qc.invalidateQueries({ queryKey: ['mgr-plan-sched'] });
      setHodRemFor(null); setHodRemText(''); setHodRemCat(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (err: any) { Alert.alert('Remark failed', String(err?.message ?? err)); }
  };
  // Manager acting on a member's reschedule request. ONE-TAP when the request
  // carries schedule_id + to_time; otherwise fall back to the dialog PREFILLED
  // (time/modality/reason preset, request id carried through).
  const approveRequest = async (m: ManagerChatMessage) => {
    if (!team || sendM.isPending) return;
    const p = m.payload ?? {};
    if (!p.date || !p.client_id || !p.trainer_id) return;
    if (!p.schedule_id || !p.to_time) {
      setEditMod(p.to_modality ?? p.from_modality ?? null);
      setEditRemark(p.reason ?? '');
      setEditIsRequest(false); setEditViaHod(false);
      setEditReqId(m.id);
      setEditTime({ date: p.date, clientId: p.client_id, name: p.name ?? 'Client', trainerId: p.trainer_id, current: p.from_time ?? '07:00', currentModality: p.from_modality ?? null, scheduleId: p.schedule_id ?? null });
      return;
    }
    const reason = p.reason || 'Approved reschedule request';
    const modality = p.to_modality ?? p.from_modality ?? null;
    try {
      const { error } = await supabase.rpc('plan_manager_reschedule', {
        p_score: team.scoreId, p_schedule: p.schedule_id, p_date: p.date,
        p_time: p.to_time, p_modality: modality, p_remark: reason,
      });
      if (error) { Alert.alert('Approve failed', error.message); return; }
      qc.invalidateQueries({ queryKey: ['mgr-plan-sched'] });
      qc.invalidateQueries({ queryKey: ['trainer-roster'] });
      qc.invalidateQueries({ queryKey: ['doctor-roster'] });
    } catch (err: any) { Alert.alert('Approve failed', String(err?.message ?? err)); return; }
    const prevEdit = timeEditsByDate.get(p.date)?.get(`${p.trainer_id}:${p.client_id}`);
    const history: PlanRescheduleHop[] = [
      ...(prevEdit?.history ?? []),
      { from_time: p.from_time, to_time: p.to_time, from_modality: p.from_modality ?? null, to_modality: modality, remark: reason, by: meId, at: new Date().toISOString() },
    ];
    try {
      await sendM.mutateAsync({
        scoreId: team.scoreId, kind: 'plan_time_edit',
        payload: { date: p.date, client_id: p.client_id, name: p.name, trainer_id: p.trainer_id, time: p.to_time, modality, schedule_id: p.schedule_id ?? null, remark: reason, request_id: m.id, history },
        body: `Rescheduled ${p.name} to ${fmt12h(p.to_time)} (${istDayLabel(p.date)})`,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch { /* rollback visible */ }
  };
  const rejectRequest = async (m: ManagerChatMessage) => {
    if (!team || sendM.isPending) return;
    const p = m.payload ?? {};
    try {
      await sendM.mutateAsync({
        scoreId: team.scoreId, kind: 'plan_reschedule_decision',
        payload: { request_id: m.id, approved: false, date: p.date, client_id: p.client_id, name: p.name, trainer_id: p.trainer_id },
        body: `Rejected · reschedule request for ${p.name ?? 'session'} (${p.date ? istDayLabel(p.date) : ''})`,
      });
    } catch { /* rollback visible */ }
  };
  /* Retry a booking that `plan_sync_roster` refused at compose time.
     The plan payload froze `roster:'conflict'`, so nothing re-ran the sync once the
     clash was fixed — the session simply never reached session_schedule. This
     re-syncs that ONE entry and, on success, rewrites the entry in the message
     payload so the card stops reading "NOT BOOKED". */
  const [retryingKey, setRetryingKey] = React.useState<string | null>(null);
  const retryBooking = React.useCallback(async (r: { date: string; messageId: string; clientId: string; name: string; time: string; modality: string | null }) => {
    if (!team || retryingKey) return;
    const key = `${r.messageId}:${r.clientId}`;
    setRetryingKey(key);
    try {
      const { data, error } = await withTimeout(
        Promise.resolve(supabase.rpc('plan_sync_roster', {
          p_score: team.scoreId,
          p_date: r.date,
          p_entries: [{ client_id: r.clientId, time: r.time, modality: r.modality }],
        })) as Promise<{ data: any; error: any }>,
        NET_MS, 'Retry booking');
      if (error) throw new Error(error.message);
      const row = Array.isArray(data) ? (data as any[]).find((x) => x.client_id === r.clientId) : null;
      if (!row || row.result === 'conflict') {
        Alert.alert('Still double-booked', `${r.name.split(' ')[0]} already has another session at ${fmt12h(r.time)}. Move that one first, then retry.`);
        return;
      }
      // Rewrite just this entry in the plan payload (same mechanism the team-flags
      // remarks use). Without it the red tag outlives the fix.
      const msg = (msgsQ.data ?? []).find((x) => x.id === r.messageId);
      if (msg?.payload?.entries) {
        const entries = (msg.payload.entries as TomorrowPlanEntry[]).map((e) =>
          e.client_id === r.clientId ? { ...e, roster: row.result ?? 'linked', schedule_id: row.schedule_id ?? null } : e);
        const { error: upErr } = await withTimeout(
          Promise.resolve(supabase.from('manager_team_messages').update({ payload: { ...msg.payload, entries } }).eq('id', r.messageId)) as Promise<{ error: any }>,
          NET_MS, 'Retry booking');
        if (upErr) throw new Error(upErr.message);
      }
      ['manager-chat', 'mgr-plan-sched', 'trainer-roster', 'doctor-roster', 'crm-month-roster'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      Alert.alert('Booked', `${r.name.split(' ')[0]} is on the roster at ${fmt12h(r.time)}.`);
    } catch (e: any) {
      Alert.alert("Couldn't book", e?.message ?? 'Check your connection and try again.');
    } finally {
      setRetryingKey(null);
    }
  }, [team, retryingKey, msgsQ.data, qc]);

  const sendPlan = async (date: string, entries: TomorrowPlanEntry[]) => {
    if (!team) return;
    // Roster sync FIRST: every entry becomes a real session_schedule row —
    // created if missing, linked if the client already has one with me that
    // day (CRM rows are never moved), 'conflict' if the client is double-booked.
    // Non-fatal: if the RPC is missing/unavailable the plan still posts unlinked.
    let enriched = entries;
    let syncError: string | null = null;
    try {
      const { data, error } = await supabase.rpc('plan_sync_roster', {
        p_score: team.scoreId,
        p_date: date,
        p_entries: entries.map((e) => ({ client_id: e.client_id, time: e.time, modality: e.modality ?? null })),
      });
      if (error) syncError = error.message;
      else if (Array.isArray(data)) {
        const byClient = new Map<string, any>((data as any[]).map((r: any) => [r.client_id, r]));
        enriched = entries.map((e) => {
          const r = e.client_id ? byClient.get(e.client_id) : null;
          return r ? { ...e, schedule_id: r.schedule_id ?? null, roster: r.result ?? null } : e;
        });
      }
    } catch (err: any) { syncError = String(err?.message ?? err); }
    // My own roster surfaces refresh instantly (other devices via realtime).
    if (!syncError) {
      qc.invalidateQueries({ queryKey: ['trainer-roster'] });
      qc.invalidateQueries({ queryKey: ['doctor-roster'] });
    }
    // Roster failures are never silent: name what didn't reach session_schedule.
    if (syncError) {
      Alert.alert('Roster sync failed', `${syncError}\n\nThe plan still posts to the chat, but NO roster sessions were saved.`);
    } else {
      // Only NEW conflicts get the popup — entries already known to conflict
      // from the previous share just keep their red tag on the card, so adding
      // more clients later doesn't re-alert the same old conflict every time.
      const prevConflictIds = new Set((myTomorrowPlan?.payload?.entries ?? []).filter((e) => e.roster === 'conflict' && e.client_id).map((e) => e.client_id as string));
      const conflicted = enriched.filter((e) => e.roster === 'conflict' && !(e.client_id && prevConflictIds.has(e.client_id)));
      if (conflicted.length) {
        Alert.alert('Not added to roster', `${conflicted.map((e) => e.name.split(' ')[0]).join(', ')} already ${conflicted.length === 1 ? 'has' : 'have'} a session at that exact time. Those slots were not saved to the roster.`);
      }
    }
    try {
      await sendM.mutateAsync({ scoreId: team.scoreId, kind: 'tomorrow_plan', payload: { date, entries: enriched }, body: tomorrowPlanBody(date, enriched) });
      setPlanOpen(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch { /* rollback visible in list */ }
  };

  if (teamQ.isLoading || (meIsHod && !teamQ.data && hodTeamsQ.isLoading)) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={C.orange} /></View>;
  }
  if (!team) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30, gap: 12 }}>
        <Icon name="users" size={34} color="#4C4640" strokeWidth={1.6} />
        <Serif style={{ fontSize: 19 }}>No competition team</Serif>
        <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center' }}>You are not part of a current manager competition team.</Body>
        <Pressable onPress={() => (canGoBack ? back() : go('dashboard'))} style={{ paddingVertical: 10, paddingHorizontal: 18, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
          <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: C.ink }}>Back</Text>
        </Pressable>
      </View>
    );
  }

  const todayLab = istDayLabel(serverNow().toISOString());
  const BUBBLE_KINDS = ['text', 'plan_reschedule_request', 'plan_add', 'session_update'];
  // One inverted-list item. prev = listData[index + 1] is the OLDER message, so
  // day separators and sender runs derive per item (no mutable running state).
  const renderMessage = ({ item: m, index }: { item: ManagerChatMessage; index: number }) => {
    const prev = listData[index + 1];
    const mine = m.senderId === meId;
    const day = istDayLabel(m.createdAt);
    const showDay = !prev || istDayLabel(prev.createdAt) !== day;
    const isPlan = m.kind === 'tomorrow_plan' && !!m.payload?.date && !!m.payload?.entries?.length;
    const isReq = m.kind === 'plan_reschedule_request';
    const isAdd = m.kind === 'plan_add';
    const isUpd = m.kind === 'session_update';
    const sameRun = !showDay && !isPlan && m.kind !== 'team_flags' && !!prev && prev.senderId === m.senderId && BUBBLE_KINDS.includes(prev.kind);
    const tp = istTimeParts(m.createdAt);
    const flash = flashId === m.id;
    const quote = m.payload?.reply_to;
    const replyEnabled = team.active;
    const onReply = () => setReplyTo(makeQuote(m));
    const flashStyle = flash ? { borderRadius: 18, backgroundColor: hexA(PINK, 0.1) } : null;
    const daySep = showDay ? (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 10 }}>
        <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.06)' }} />
        <Mono style={{ fontSize: 9.5, letterSpacing: 1, color: C.muted2 }}>{day === todayLab ? 'TODAY' : day.toUpperCase()}</Mono>
        <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.06)' }} />
      </View>
    ) : null;
    if (m.kind === 'team_flags') {
      // Manager sees the whole team; a member sees only their own block.
      const flagsAll = m.payload?.flags ?? [];
      const visible = team.isManager ? flagsAll : flagsAll.filter((f) => f.trainer_id === meId);
      if (!visible.length) return <>{daySep}</>;
      return (
        <>
          {daySep}
          <SwipeReply enabled={replyEnabled} onReply={onReply}>
          <View style={[{ marginTop: 8 }, flashStyle]}>
            <TeamFlagsCard
              msg={m}
              isManager={team.isManager}
              meId={meId ?? ''}
              savingKey={flagSaving}
              onSaveRemark={saveFlagRemark}
              doctorIds={doctorIds}
              meIsHod={meIsHod}
            />
            <Mono style={{ fontSize: 8.5, color: C.muted3, alignSelf: 'flex-end', marginTop: 3, marginRight: 2 }}>{tp.time} {tp.ampm}</Mono>
          </View>
          </SwipeReply>
        </>
      );
    }
    if (isPlan) {
      // ONE merged card per date, rendered at the LAST plan message's slot
      return (
        <>
          {daySep}
          <SwipeReply enabled={replyEnabled} onReply={onReply}>
          <View style={[{ marginTop: 8 }, flashStyle]}>
            <MergedPlanCard
              date={m.payload!.date!}
              bySender={planMsgsByDate.get(m.payload!.date!) ?? new Map()}
              team={team}
              meId={meId}
              timeEdits={timeEditsByDate.get(m.payload!.date!) ?? new Map()}
              onEditTime={team.isManager || meIsHod ? (r) => { setEditMod(r.currentModality); setEditRemark(''); setEditIsRequest(false); setEditViaHod(!team.isManager); setEditReqId(null); setEditTime(r); } : null}
              onRequestChange={!team.isManager ? (r) => { setEditMod(r.currentModality); setEditRemark(''); setEditIsRequest(true); setEditTime(r); } : null}
              adds={(() => { const src = addsByDate.get(m.payload!.date!); const out = new Map<string, TomorrowPlanEntry[]>(); src?.forEach((v, k) => out.set(k, [...v.values()])); return out; })()}
              doctorIds={doctorIds}
              meIsHod={meIsHod}
              onHodRemark={meIsHod ? (r) => { setHodRemFor(r); setHodRemCat(null); setHodRemText(''); } : null}
              onOpenCompose={!privileged ? () => setPlanOpen(true) : null}
              onRetryBooking={retryBooking}
              retryingKey={retryingKey}
              onAddSession={team.isManager || meIsHod ? (r) => {
                // Clients already in this trainer's day (plan + manager adds) lock in the picker.
                const planEntries = planMsgsByDate.get(r.date)?.get(r.trainerId)?.payload?.entries ?? [];
                const addIds = [...(addsByDate.get(r.date)?.get(r.trainerId)?.keys() ?? [])];
                setAddFor({ ...r, scoreId: team.scoreId, scheduledIds: [...(planEntries.map((e) => e.client_id).filter(Boolean) as string[]), ...addIds] });
              } : null}
            />
            <Mono style={{ fontSize: 8.5, color: C.muted3, alignSelf: 'flex-end', marginTop: 3, marginRight: 2 }}>UPDATED {tp.time} {tp.ampm}</Mono>
          </View>
          </SwipeReply>
        </>
      );
    }
    return (
      <>
        {daySep}
        <SwipeReply enabled={replyEnabled} onReply={onReply}>
        <View style={[{ flexDirection: 'row', alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '84%', marginTop: sameRun ? 3 : 10, gap: 8 }, flashStyle]}>
          {!mine ? (
            sameRun ? <View style={{ width: 26 }} /> : <View style={{ alignSelf: 'flex-end' }}><AvatarDot name={m.senderName} size={26} url={team.members.find((mm) => mm.id === m.senderId)?.avatarUrl} /></View>
          ) : null}
          <View style={{ flexShrink: 1 }}>
            {!mine && !sameRun ? (
              <Mono style={{ fontSize: 9.5, color: C.muted2, marginLeft: 7, marginBottom: 3 }}>
                {m.senderName.split(' ')[0].toUpperCase()}
              </Mono>
            ) : null}
            {isUpd ? (
              <View>
                <View style={{ borderRadius: 15, overflow: 'hidden', minWidth: 230, backgroundColor: 'rgba(26,20,15,0.92)', borderWidth: 1, borderColor: hexA(C.green, 0.45) }}>
                  <View style={{ height: 2.5, backgroundColor: hexA(C.green, 0.6) }} />
                  <View style={{ padding: 11, gap: 5 }}>
                    <Mono style={{ fontSize: 9, letterSpacing: 1, color: C.green }}>SESSION UPDATED · CLIENT CHAT</Mono>
                    <Body style={{ fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }}>{m.payload?.name ?? 'Client'}</Body>
                    <Mono style={{ fontSize: 10, color: C.muted2 }}>
                      {m.payload?.date ? istDayLabel(m.payload.date) : ''} · {m.payload?.from_time ? fmt12h(m.payload.from_time) : '?'} to {m.payload?.to_time ? fmt12h(m.payload.to_time) : '?'} · agreed with the client
                    </Mono>
                  </View>
                </View>
                <Mono style={{ fontSize: 8.5, color: C.muted3, alignSelf: mine ? 'flex-end' : 'flex-start', marginTop: 3, marginHorizontal: 4 }}>{tp.time} {tp.ampm}</Mono>
              </View>
            ) : isAdd ? (
              <View>
                <View style={{ borderRadius: 15, overflow: 'hidden', minWidth: 230, backgroundColor: 'rgba(26,20,15,0.92)', borderWidth: 1, borderColor: hexA(PINK, 0.45) }}>
                  <View style={{ height: 2.5, backgroundColor: hexA(PINK, 0.6) }} />
                  <View style={{ padding: 11, gap: 5 }}>
                    <Mono style={{ fontSize: 9, letterSpacing: 1, color: PINK_SOFT }}>SESSION ADDED BY MANAGER</Mono>
                    <Body style={{ fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }}>{m.payload?.name ?? 'Client'}</Body>
                    <Mono style={{ fontSize: 10, color: C.muted2 }}>
                      {m.payload?.date ? istDayLabel(m.payload.date) : ''} · {m.payload?.time ? fmt12h(m.payload.time) : ''}{m.payload?.modality ? `  ·  ${m.payload.modality}` : ''} · for {(team.members.find((mm) => mm.id === m.payload?.trainer_id)?.name ?? 'a member').split(' ')[0]}
                    </Mono>
                  </View>
                </View>
                <Mono style={{ fontSize: 8.5, color: C.muted3, alignSelf: mine ? 'flex-end' : 'flex-start', marginTop: 3, marginHorizontal: 4 }}>{tp.time} {tp.ampm}</Mono>
              </View>
            ) : isReq ? (
              <View>
                <RequestCard m={m} hodTarget={doctorIds.has(String(m.payload?.trainer_id ?? ''))} status={reqStatus.get(m.id) ?? 'pending'} isMgr={team.isManager} busy={sendM.isPending} meIsHod={meIsHod} onApprove={() => (meIsHod && doctorIds.has(String(m.payload?.trainer_id ?? ''))) ? hodActRequest(m, true) : approveRequest(m)} onReject={() => (meIsHod && doctorIds.has(String(m.payload?.trainer_id ?? ''))) ? hodActRequest(m, false) : rejectRequest(m)} />
                <Mono style={{ fontSize: 8.5, color: C.muted3, alignSelf: mine ? 'flex-end' : 'flex-start', marginTop: 3, marginHorizontal: 4 }}>{tp.time} {tp.ampm}</Mono>
              </View>
            ) : mine ? (
              <Pressable onLongPress={replyEnabled && !m._failed ? onReply : undefined} delayLongPress={300} onPress={m._failed ? () => retryFailed(m) : undefined} accessibilityLabel={m._failed ? 'Message not sent. Tap to retry.' : undefined}>
                <LinearGradient colors={PINK_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: 17, borderBottomRightRadius: 5, paddingVertical: 9, paddingHorizontal: 13, opacity: m._failed ? 0.7 : 1 }}>
                  {quote ? <QuoteBlock q={quote} mine onJump={jumpToMessage} /> : null}
                  <MsgBody body={m.body} mine firstNames={firstNames} myFirst={myFirst} />
                  <Mono style={{ fontSize: 8.5, color: 'rgba(255,255,255,0.78)', alignSelf: 'flex-end', marginTop: 3 }}>{m._failed ? 'NOT SENT' : `${tp.time} ${tp.ampm}`}</Mono>
                </LinearGradient>
                {m._failed ? (
                  <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 4, marginRight: 2 }}>
                    <Mono style={{ fontSize: 9, color: C.red }}>{sendM.isPending ? 'SENDING…' : 'TAP TO RETRY'}</Mono>
                    <Pressable onPress={() => discardFailed(m)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Discard unsent message"><Mono style={{ fontSize: 9, color: C.muted2 }}>DISCARD</Mono></Pressable>
                  </View>
                ) : null}
              </Pressable>
            ) : (
              <Pressable onLongPress={replyEnabled ? onReply : undefined} delayLongPress={300} style={{ borderRadius: 17, borderBottomLeftRadius: 5, paddingVertical: 9, paddingHorizontal: 13, backgroundColor: 'rgba(255,255,255,0.055)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
                {quote ? <QuoteBlock q={quote} mine={false} onJump={jumpToMessage} /> : null}
                <MsgBody body={m.body} mine={false} firstNames={firstNames} myFirst={myFirst} />
                <Mono style={{ fontSize: 8.5, color: C.muted3, alignSelf: 'flex-end', marginTop: 3 }}>{tp.time} {tp.ampm}</Mono>
              </Pressable>
            )}
          </View>
        </View>
        </SwipeReply>
      </>
    );
  };
  // No insets.top — the global app bar already owns the safe area; adding it
  // here doubles the gap above the header (same rule as clientThreads).
  return (
    <View style={{ flex: 1 }}>
      {/* Header — blue-tinted team identity band */}
      <LinearGradient colors={['#2B1420', '#150E12']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10, gap: 9, borderBottomWidth: 1, borderBottomColor: hexA(PINK, 0.22) }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Pressable onPress={() => (canGoBack ? back() : go('dashboard'))} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back" style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.07)', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="chevLeft" size={15} color="#fff" strokeWidth={2.4} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
              <Serif style={{ fontSize: 19 }}>My Crew</Serif>
              {team.active ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: C.green }} /> : null}
            </View>
            <Mono style={{ fontSize: 8, letterSpacing: 0.9, color: C.muted3, marginTop: 2 }} numberOfLines={1}>
              {meIsHod && hodView === 'all'
                ? `ALL PHYSIOS · ${hodTeams.length} TEAMS · PHYSIO OVERSIGHT`
                : `${team.teamName.toUpperCase()} · ${team.members.length} MEMBERS${team.daysLeft != null ? ` · ${team.daysLeft}D LEFT` : ''}${team.isManager ? ' · YOU MANAGE' : meIsHod ? ' · PHYSIO OVERSIGHT' : ''}`}
            </Mono>
          </View>
          {/* member avatar stack */}
          <View style={{ flexDirection: 'row' }}>
            {team.members.slice(0, 4).map((m, i) => (
              <View key={m.id} style={{ marginLeft: i ? -9 : 0, borderWidth: 1.5, borderColor: '#251221', borderRadius: 14 }}>
                <AvatarDot name={m.name} size={25} />
              </View>
            ))}
            {team.members.length > 4 ? (
              <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center', marginLeft: -9, borderWidth: 1.5, borderColor: '#251221' }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 8.5, color: C.muted }}>+{team.members.length - 4}</Text>
              </View>
            ) : null}
          </View>
        </View>
        {/* Competition window progress */}
        {team.end ? (
          <View style={{ gap: 4 }}>
            <ProgressBar pct={team.pctElapsed} height={4} fill={team.active ? PINK : C.muted2} animated />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Mono style={{ fontSize: 7.5, letterSpacing: 0.8, color: C.muted3 }}>{team.start ? istDayLabel(team.start) : ''}</Mono>
              <Mono style={{ fontSize: 7.5, letterSpacing: 0.8, color: team.active ? hexA(PINK, 0.95) : C.muted3 }}>{team.active ? `${team.daysLeft} DAYS LEFT` : 'COMPETITION OVER'}</Mono>
              <Mono style={{ fontSize: 7.5, letterSpacing: 0.8, color: C.muted3 }}>{istDayLabel(team.end)}</Mono>
            </View>
          </View>
        ) : null}
        {/* Members strip — manager crowned */}
        <HScroll gap={6}>
          {team.members.map((m) => (
            <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4, paddingHorizontal: 9, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: m.isManager ? hexA(C.gold, 0.4) : 'rgba(255,255,255,0.09)' }}>
              {m.isManager ? <Icon name="crown" size={10} color={C.gold} strokeWidth={2.2} /> : null}
              <Text style={{ fontFamily: F.bodySemi, fontSize: 10.5, color: m.isManager ? C.gold : C.ink }}>{m.name.split(' ')[0]}{m.id === meId ? ' (you)' : ''}</Text>
            </View>
          ))}
        </HScroll>
        {meIsHod && hodTeams.length > 0 ? (
          <HScroll gap={6}>
            <Pressable onPress={() => setHodView('all')} style={{ paddingVertical: 5, paddingHorizontal: 11, borderRadius: 999, backgroundColor: hodView === 'all' ? hexA(C.green, 0.16) : 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: hodView === 'all' ? hexA(C.green, 0.5) : 'rgba(255,255,255,0.09)' }}>
              <Text style={{ fontFamily: hodView === 'all' ? F.bodyBold : F.bodySemi, fontSize: 10.5, color: hodView === 'all' ? C.green : C.ink }}>All Physios</Text>
            </Pressable>
            {hodTeams.map((t, i) => {
              const sel = hodView === 'team' && i === hodTeamIdx;
              return (
                <Pressable key={t.scoreId} onPress={() => { setHodView('team'); setHodTeamIdx(i); }} style={{ paddingVertical: 5, paddingHorizontal: 11, borderRadius: 999, backgroundColor: sel ? hexA(C.green, 0.16) : 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: sel ? hexA(C.green, 0.5) : 'rgba(255,255,255,0.09)' }}>
                  <Text style={{ fontFamily: sel ? F.bodyBold : F.bodySemi, fontSize: 10.5, color: sel ? C.green : C.ink }}>{t.teamName}</Text>
                </Pressable>
              );
            })}
          </HScroll>
        ) : null}
      </LinearGradient>

      {meIsHod && hodView === 'all' ? (
        <>
        {/* All-Physios feed: every team's doctor cards + pending doctor requests */}
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 24, gap: 14 }}>
          <HodAllFeed
            teams={hodTeams}
            meId={meId}
            meName={meName}
            busy={sendM.isPending}
            onEditTime={(r) => { setEditMod(r.currentModality); setEditRemark(''); setEditIsRequest(false); setEditViaHod(true); setEditTime(r); }}
            onHodRemark={(r) => { setHodRemFor(r); setHodRemCat(null); setHodRemText(''); }}
            onActRequest={hodActRequest}
            onAddSession={(r) => setAddFor(r)}
            onOpenChat={(scoreId) => { const i = hodTeams.findIndex((t) => t.scoreId === scoreId); if (i >= 0) { setHodTeamIdx(i); setHodView('team'); } }}
          />
          <Body style={{ fontSize: 11.5, color: C.muted3, textAlign: 'center', paddingVertical: 10 }}>
            Doctor day plans and requests across all teams. Open a team tab above to read its full chat.
          </Body>
        </ScrollView>
        {/* HOD composer: chat with any team WITHOUT leaving the feed — pick the
            target team, type, send; the view jumps into that team's chat. */}
        <View style={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: (kbH > 0 ? kbH + (Platform.OS === 'android' ? insets.bottom : 0) : insets.bottom) + 10, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.07)', backgroundColor: '#0B0908', gap: 7 }}>
          <HScroll gap={6}>
            {hodTeams.map((t, i) => {
              const sel = i === hodTeamIdx;
              return (
                <Pressable key={t.scoreId} onPress={() => setHodTeamIdx(i)} style={{ paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999, backgroundColor: sel ? hexA(PINK, 0.16) : 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: sel ? hexA(PINK, 0.5) : 'rgba(255,255,255,0.09)' }}>
                  <Mono style={{ fontSize: 8.5, color: sel ? PINK_SOFT : C.muted }}>TO {t.teamName.toUpperCase()}</Mono>
                </Pressable>
              );
            })}
          </HScroll>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
            {/* My Tomorrow Plan — same spot as the trainer composer's calendar button */}
            <Pressable
              onPress={() => setPlanOpen(true)}
              hitSlop={6}
              style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: hexA(C.gold, 0.12), borderWidth: 1, borderColor: hexA(C.gold, 0.4), alignItems: 'center', justifyContent: 'center' }}
            >
              <Icon name="calendar" size={17} color={C.gold} strokeWidth={2.1} />
              {myTomorrowPlan ? (
                <View style={{ position: 'absolute', top: 3, right: 3, width: 9, height: 9, borderRadius: 5, backgroundColor: C.green, borderWidth: 1.5, borderColor: '#0B0908' }} />
              ) : null}
            </Pressable>
            <View style={{ flex: 1, borderRadius: 21, borderWidth: 1, borderColor: 'rgba(255,255,255,0.11)', backgroundColor: 'rgba(255,255,255,0.045)', paddingHorizontal: 14, paddingVertical: Platform.OS === 'ios' ? 12 : 4, minHeight: 42, justifyContent: 'center' }}>
              <TextInput
                value={input}
                onChangeText={setInput}
                placeholder={`Message team ${team?.teamName ?? ''}…`}
                placeholderTextColor={C.muted3}
                multiline
                autoCorrect={false}
                style={{ fontFamily: F.body, fontSize: 13.5, color: '#fff', maxHeight: 100, paddingTop: 0, paddingBottom: 0 }}
              />
            </View>
            <Pressable onPress={() => { if (input.trim()) { sendText(); setHodView('team'); } }} disabled={!input.trim() || sendM.isPending} accessibilityRole="button" accessibilityLabel="Send message">
              {input.trim() && !sendM.isPending ? (
                <LinearGradient colors={PINK_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="send" size={16} color="#fff" strokeWidth={2.4} />
                </LinearGradient>
              ) : (
                <View style={{ width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.07)' }}>
                  <Icon name="send" size={16} color={C.muted3} strokeWidth={2.4} />
                </View>
              )}
            </Pressable>
          </View>
        </View>
        </>
      ) : (
      <>
      {/* Messages — inverted list pinned to the NEWEST message; edge overscroll
          disabled. Day separators/sender runs computed per item in renderMessage. */}
      <FlatList
        ref={listRef}
        inverted
        data={listData}
        keyExtractor={(x) => x.id}
        renderItem={renderMessage}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 14, paddingTop: 14, paddingBottom: 12 }}
        keyboardShouldPersistTaps="handled"
        overScrollMode="never"
        bounces={false}
        onScrollToIndexFailed={(info) => {
          listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
          setTimeout(() => listRef.current?.scrollToIndex({ index: info.index, viewPosition: 0.5, animated: true }), 250);
        }}
        ListEmptyComponent={
          /* inverted lists render the empty component flipped — counter-flip it */
          <View style={{ transform: [{ scaleY: -1 }] }}>
            {msgsQ.isLoading ? (
          <View style={{ alignItems: 'center', paddingVertical: 30, gap: 10 }}>
            <ActivityIndicator color={PINK} />
            <Body style={{ fontSize: 12, color: C.muted3 }}>Loading messages…</Body>
          </View>
        ) : (
          <View style={{ alignItems: 'center', gap: 10, paddingVertical: 44 }}>
            <View style={{ width: 62, height: 62, borderRadius: 22, backgroundColor: hexA(PINK, 0.1), borderWidth: 1, borderColor: hexA(PINK, 0.3), alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="chat" size={26} color={PINK} strokeWidth={1.8} />
            </View>
            <Serif style={{ fontSize: 18 }}>Say hello to your team</Serif>
            <Body style={{ fontSize: 12, color: C.muted3, textAlign: 'center', maxWidth: 250, lineHeight: 17 }}>
              Everyone in Team {team.teamName} sees this chat. Use the gold calendar button to share tomorrow's session plan.
            </Body>
          </View>
        )}
          </View>
        }
      />

      {/* Input — or the sealed banner once the window has closed (RLS enforces it too) */}
      {team.active ? (
        // Manual keyboard lift on BOTH platforms — Android runs edge-to-edge
        // (no adjustResize window shrink), so the composer must move itself.
        // Android under-reports keyboard height by the bottom system-bar
        // inset; add it back (same proven pattern as the client messenger).
        <View style={{ paddingHorizontal: 12, paddingTop: 9, paddingBottom: (kbH > 0 ? kbH + (Platform.OS === 'android' ? insets.bottom : 0) : insets.bottom) + 10, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.07)', backgroundColor: '#0B0908' }}>
          {/* Replying-to bar — quote excerpt + cancel */}
          {replyTo ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 8, padding: 8, borderRadius: 12, backgroundColor: hexA(PINK, 0.08), borderWidth: 1, borderColor: hexA(PINK, 0.3) }}>
              <View style={{ width: 3, alignSelf: 'stretch', borderRadius: 2, backgroundColor: PINK }} />
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ fontFamily: F.bodyBold, fontSize: 10.5, color: PINK_SOFT }}>Replying to {replyTo.name}</Text>
                <Text numberOfLines={1} style={{ fontFamily: F.body, fontSize: 11.5, color: C.muted2, marginTop: 1 }}>{replyTo.body}</Text>
              </View>
              <Pressable onPress={() => setReplyTo(null)} hitSlop={8} style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.07)', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="close" size={12} color={C.muted} strokeWidth={2.3} />
              </Pressable>
            </View>
          ) : null}
          {/* @mention suggestions — compact wrap chips (max 4) with a role tag;
              the draft replacement is deferred one frame (§11 IME safety) */}
          {(() => {
            const mt = input.match(/(^|\s)@(\w*)$/);
            if (!mt) return null;
            const q = mt[2].toLowerCase();
            const opts = team.members.filter((mm) => mm.id !== meId && mm.name.split(' ')[0].toLowerCase().startsWith(q)).slice(0, 4);
            if (!opts.length) return null;
            return (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                {opts.map((mm) => {
                  const first = mm.name.split(' ')[0];
                  return (
                    <Pressable key={mm.id} onPress={() => requestAnimationFrame(() => setInput((prev) => prev.replace(/(^|\s)@\w*$/, `$1@${first} `)))} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999, backgroundColor: hexA(PINK, 0.12), borderWidth: 1, borderColor: hexA(PINK, 0.4) }}>
                      <AvatarDot name={mm.name} size={18} url={mm.avatarUrl} />
                      <Text style={{ fontFamily: F.bodySemi, fontSize: 11.5, color: '#FBD3E2' }}>@{first}</Text>
                      <Mono style={{ fontSize: 7, letterSpacing: 0.5, color: mm.isManager ? C.gold : C.muted3 }}>{mm.isManager ? 'MGR' : (mm.role ?? 'member').slice(0, 7).toUpperCase()}</Mono>
                    </Pressable>
                  );
                })}
              </View>
            );
          })()}
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
            <Pressable
              onPress={() => setPlanOpen(true)}
              hitSlop={6}
              style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: hexA(C.gold, 0.12), borderWidth: 1, borderColor: hexA(C.gold, 0.4), alignItems: 'center', justifyContent: 'center' }}
            >
              <Icon name="calendar" size={17} color={C.gold} strokeWidth={2.1} />
              {myTomorrowPlan ? (
                <View style={{ position: 'absolute', top: 3, right: 3, width: 9, height: 9, borderRadius: 5, backgroundColor: C.green, borderWidth: 1.5, borderColor: '#0B0908' }} />
              ) : null}
            </Pressable>
            <View style={{ flex: 1, borderRadius: 21, borderWidth: 1, borderColor: 'rgba(255,255,255,0.11)', backgroundColor: 'rgba(255,255,255,0.045)', paddingHorizontal: 14, paddingVertical: Platform.OS === 'ios' ? 12 : 4, minHeight: 42, justifyContent: 'center' }}>
              <TextInput
                ref={inputRef}
                value={input}
                onChangeText={setInput}
                placeholder="Message the team…"
                placeholderTextColor={C.muted3}
                multiline
                autoCorrect={false}
                style={{ fontFamily: F.body, fontSize: 13.5, color: '#fff', maxHeight: 100, paddingTop: 0, paddingBottom: 0 }}
              />
            </View>
            <Pressable onPress={sendText} disabled={!input.trim() || sendM.isPending} accessibilityRole="button" accessibilityLabel="Send message">
              {input.trim() && !sendM.isPending ? (
                <LinearGradient colors={PINK_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="send" size={16} color="#fff" strokeWidth={2.4} />
                </LinearGradient>
              ) : (
                <View style={{ width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.07)' }}>
                  <Icon name="send" size={16} color={C.muted3} strokeWidth={2.4} />
                </View>
              )}
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={{ marginHorizontal: 14, marginBottom: insets.bottom + 12, padding: 13, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: hexA(C.gold, 0.3), flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Icon name="award" size={16} color={C.gold} strokeWidth={2} />
          <Body style={{ flex: 1, fontSize: 12, color: C.muted, lineHeight: 17 }}>
            Competition ended{team.end ? ` ${istDayLabel(team.end)}` : ''} — this chat is read-only. A new team chat starts with the next competition.
          </Body>
        </View>
      )}

      {/* Members after sharing get ADD-ONLY mode: shared entries locked (only
         the manager edits those), new clients can still be added. */}
      </>
      )}

      <TomorrowPlanSheet visible={planOpen} onClose={() => setPlanOpen(false)} onSend={sendPlan} sending={sendM.isPending} existing={myTomorrowPlanEffective} addOnly={!team.isManager && !!myTomorrowPlan} />

      {/* Manager: add a session into a member's day */}
      <AddSessionModal
        visible={!!addFor}
        trainerId={addFor?.trainerId ?? null}
        trainerName={addFor?.trainerName ?? ''}
        targetRole={(() => {
          if (!addFor) return null;
          for (const tt of [team, ...hodTeams]) {
            const m = tt?.members.find((mm) => mm.id === addFor.trainerId);
            if (m) return m.role;
          }
          return null;
        })()}
        date={addFor?.date ?? ''}
        busy={sendM.isPending}
        scheduledIds={addFor?.scheduledIds ?? []}
        onClose={() => setAddFor(null)}
        onSave={saveAdd}
      />

      {/* Physio HOD: missed-session remark on a doctor's session */}
      <Modal visible={!!hodRemFor} transparent animationType="fade" onRequestClose={() => setHodRemFor(null)}>
        <View style={{ flex: 1, justifyContent: 'center', padding: 22, paddingBottom: 22 + kbH }}>
          <Pressable onPress={() => setHodRemFor(null)} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.65)' }} />
          <View style={{ borderRadius: 18, backgroundColor: '#12100E', borderWidth: 1, borderColor: hexA(C.gold, 0.3), padding: 16, gap: 10 }}>
            <Serif style={{ fontSize: 18 }}>Session remark</Serif>
            <Body style={{ fontSize: 11.5, color: C.muted2 }}>{hodRemFor?.name} · saved on the roster session, visible to the team.</Body>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {Object.entries(MISSED_CAT_LABELS).map(([val, label]) => {
                const active = hodRemCat === val;
                return (
                  <Pressable key={val} onPress={() => setHodRemCat(val)} style={{ paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999, backgroundColor: active ? hexA(C.gold, 0.16) : 'rgba(255,255,255,0.045)', borderWidth: 1, borderColor: active ? hexA(C.gold, 0.5) : 'rgba(255,255,255,0.09)' }}>
                    <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 10.5, color: active ? C.gold : C.muted }}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={{ borderRadius: 13, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', backgroundColor: 'rgba(0,0,0,0.25)', paddingHorizontal: 12, paddingVertical: 9 }}>
              <TextInput value={hodRemText} onChangeText={setHodRemText} placeholder="What happened?" placeholderTextColor={C.muted3} multiline style={{ fontFamily: F.body, fontSize: 13, color: '#fff', minHeight: 56, maxHeight: 110, textAlignVertical: 'top', paddingTop: 0 }} />
            </View>
            <View style={{ flexDirection: 'row', gap: 9 }}>
              <Pressable onPress={() => setHodRemFor(null)} style={{ flex: 1, paddingVertical: 12, borderRadius: 13, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
                <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: C.ink }}>Cancel</Text>
              </Pressable>
              <Pressable onPress={saveHodRemark} disabled={!hodRemText.trim() || !hodRemCat} style={{ flex: 1, borderRadius: 13, overflow: 'hidden', opacity: !hodRemText.trim() || !hodRemCat ? 0.5 : 1 }}>
                <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ paddingVertical: 12, alignItems: 'center' }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: '#fff' }}>Save remark</Text>
                </LinearGradient>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Manager time editor — pick a new time for a member's plan entry */}
      <Modal visible={!!editTime} transparent animationType="fade" onRequestClose={() => { setEditTime(null); setEditReqId(null); }}>
        <View style={{ flex: 1, justifyContent: 'center', padding: 22, paddingBottom: 22 + kbH }}>
          <Pressable onPress={() => { setEditTime(null); setEditReqId(null); }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.65)' }} />
          <View style={{ borderRadius: 18, backgroundColor: '#12100E', borderWidth: 1, borderColor: hexA(C.gold, 0.3), padding: 16, gap: 11, maxHeight: '75%' }}>
            <Serif style={{ fontSize: 18 }}>{editIsRequest ? `Request reschedule · ${editTime?.name ?? ''}` : editReqId ? `Approve reschedule · ${editTime?.name ?? ''}` : 'Change session'}</Serif>
            <Body style={{ fontSize: 11.5, color: C.muted2 }}>
              {editTime?.name} · {editTime ? istDayLabel(editTime.date) : ''}. {editIsRequest
                ? 'Write the reason, pick the modality, then tap a time to send the request.'
                : `Write the reason, pick the modality, then tap a time to save.${editTime?.scheduleId ? ' This reschedules the real roster session.' : ' The whole team sees the update.'}`}
            </Body>
            {/* reschedule reason — REQUIRED (preset when approving a request) */}
            <View style={{ borderRadius: 12, borderWidth: 1, borderColor: editReqId || editRemark.trim() ? 'rgba(255,255,255,0.12)' : hexA(C.red, 0.35), backgroundColor: 'rgba(0,0,0,0.25)', paddingHorizontal: 12, paddingVertical: 8 }}>
              <TextInput
                value={editRemark}
                onChangeText={setEditRemark}
                placeholder={editIsRequest ? 'Reason (required), e.g. clash with another client' : 'Reason (required), e.g. trainer double-booked'}
                placeholderTextColor={C.muted3}
                style={{ fontFamily: F.body, fontSize: 12.5, color: '#fff', paddingVertical: 0 }}
              />
            </View>
            {/* modality first — preselected from the entry (or the client's history) */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {[...new Set([...(editMod && !TRAINER_MODALITIES.includes(editMod) && !DOCTOR_MODALITIES.includes(editMod) ? [editMod] : []), ...TRAINER_MODALITIES, ...DOCTOR_MODALITIES])].map((mName) => {
                const active = editMod === mName;
                return (
                  <Pressable key={mName} onPress={() => setEditMod(active ? null : mName)} style={{ paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999, backgroundColor: active ? hexA(PINK, 0.18) : 'rgba(255,255,255,0.045)', borderWidth: 1, borderColor: active ? hexA(PINK, 0.55) : 'rgba(255,255,255,0.09)' }}>
                    <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 10.5, color: active ? PINK_SOFT : C.muted }}>{mName}</Text>
                  </Pressable>
                );
              })}
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
                {SHEET_TIMES.map((t) => {
                  const active = editTime?.current === t;
                  return (
                    <Pressable key={t} onPress={() => saveTimeEdit(t)} disabled={sendM.isPending} style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, backgroundColor: active ? hexA(C.gold, 0.18) : 'rgba(255,255,255,0.045)', borderWidth: 1, borderColor: active ? hexA(C.gold, 0.55) : 'rgba(255,255,255,0.09)' }}>
                      <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 12, color: active ? C.gold : C.ink }}>{fmt12h(t)}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
            <Pressable onPress={() => { setEditTime(null); setEditReqId(null); }} style={{ paddingVertical: 12, borderRadius: 13, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: C.ink }}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

    </View>
  );
}
