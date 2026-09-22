import React from 'react';
import { View, Text, Pressable, TextInput, ScrollView, Animated, Easing, ActivityIndicator, Alert, Modal, RefreshControl, Keyboard } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { getIsOnline } from '../lib/offline';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono } from '../components/primitives';
import { AccessPending, HScroll } from './common';
import { useStore } from '../store';
import { useAuth } from '../auth';
import { backOverride } from '../gestureLock';
import { useKeyboardHeight } from '../lib/useKeyboardHeight';
import {
  ALL_PLATFORMS, ALL_TYPES, PRIORITY_COLOR, PRIORITY_LABEL, PLATFORM_LABEL, PLATFORM_ON_TICKET, RESOLUTION_LABEL,
  STAGE_LABEL, STAGE_ORDER, STATUS_COLOR, STATUS_LABEL, TECH, TIME_PRESETS, TYPE_ICON, TYPE_LABEL, TYPE_LABEL_LONG, TYPE_LABEL_MAX,
  statusColor, TechPlatform, TechPriority, TechResolution, TechStatus,
  TechTicket, TechType, customTypeLabels, fmtMinutes, freshAck, fullStamp, isNewForStaff, isOpenStatus, isUnfiled,
  parseTicketNo, personName, sortTickets, splitMinutes, stageIndexOf, ticketNo, timeAgo, typeLabelOf, typeLongOf,
} from '../lib/techDesk';
import {
  StaffAlert, isTechStaffRole, staffAlerts, staffHasUnread, useCustomTypeLabels, useDeleteTicket, useMarkTicketSeen, useSetTimeTaken,
  useTechActivity, useTechDeskRealtime, useTechMessages, useTechStaff, useTechTicket, useTechTickets, useUpdateTicket,
} from '../lib/techDeskQueries';
import { AckRecord, ClosureRecord, Composer, FadeIn, PersonAvatar, Pulse, Thread, TicketMeta, TicketShell } from './techDesk';

/** A written type is sky, so it never reads as the console's own cyan accent. */
const SKY = '#7CC6F5';

/* ============ Tech console — the tech role's home, and admin's "All Tickets" ============
   A dark, single-accent console: this is the ONLY screen that leaves the app's
   warm theme (deliberate, web parity). Everything is derived client-side from the
   one ticket query; realtime keeps it live, the 60 s refetch is the floor. */

const ACCENT = TECH.cyan;

/* ---------- console chrome ----------
   This screen does not use `Page`, so it has to bring its own pull-to-refresh:
   every other screen in the app has one, and pulling down on a queue is the first
   thing anyone tries. The 60 s refetch is a floor, not a substitute for asking. */
function ConsoleShell({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = React.useState(false);
  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    // Offline a refetch can only fail, and a failure would replace the cached
    // queue on screen with an error. Spin briefly and keep what we have (Page rule).
    if (!getIsOnline()) { setTimeout(() => setRefreshing(false), 400); return; }
    try {
      await Promise.all([
        qc.refetchQueries({ queryKey: ['tech-tickets'], type: 'active' }),
        qc.refetchQueries({ queryKey: ['tech-ticket-activity'], type: 'active' }),
      ]);
    } catch { /* the query's own error state already shows this */ }
    setRefreshing(false);
  }, [qc]);

  return (
    <View style={{ flex: 1, backgroundColor: TECH.ground }}>
      <LinearGradient colors={['rgba(92,225,230,0.10)', 'rgba(92,225,230,0.02)', TECH.ground]} locations={[0, 0.28, 0.6]}
        style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 320 }} />
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ACCENT} colors={[ACCENT]} progressBackgroundColor={TECH.panel} />}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 120 + insets.bottom, gap: 16 }}>
        {children}
      </ScrollView>
    </View>
  );
}

/** Live clock — the console's "system online" heartbeat. */
function LiveClock() {
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return <Mono style={{ fontSize: 15, color: ACCENT, letterSpacing: 1.5 }}>{now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false })}</Mono>;
}

function CountUp({ value, style }: { value: number; style?: any }) {
  const [shown, setShown] = React.useState(0);
  const anim = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    anim.setValue(0);
    const id = anim.addListener(({ value: p }) => setShown(Math.round(p * value)));
    // Only settle on `value` if the run actually finished. A realtime update mid-count
    // interrupts the old animation, and its callback would otherwise snap the readout
    // back to the number it was counting to before the new one takes over.
    Animated.timing(anim, { toValue: 1, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: false })
      .start(({ finished }) => { if (finished) setShown(value); });
    return () => anim.removeListener(id);
  }, [value]);
  return <Serif style={style}>{shown}</Serif>;
}

function Readout({ label, value, color, pulse }: { label: string; value: number; color: string; pulse?: boolean }) {
  return (
    <View style={{ flex: 1, gap: 3, paddingVertical: 10, paddingHorizontal: 11, borderRadius: 13, backgroundColor: TECH.panel, borderWidth: 1, borderColor: TECH.line }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
        {pulse && value > 0 ? <Pulse color={color} size={5} /> : <View style={{ width: 5, height: 5, borderRadius: 5, backgroundColor: hexA(color, 0.5) }} />}
        <Mono style={{ fontSize: 7.5, letterSpacing: 0.9, color: TECH.faint }}>{label}</Mono>
      </View>
      <CountUp value={value} style={{ fontSize: 24, color }} />
    </View>
  );
}

/* ---------- filter pill ---------- */
function Pill({ label, count, active, onPress, color = ACCENT }: { label: string; count?: number; active: boolean; onPress: () => void; color?: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: active }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 34, paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, backgroundColor: active ? hexA(color, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(color, 0.45) : TECH.line }}>
      <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 12, color: active ? color : TECH.muted }}>{label}</Text>
      {count != null ? <Mono style={{ fontSize: 9, color: active ? color : TECH.faint }}>{count}</Mono> : null}
    </Pressable>
  );
}

/** Compact picker for the secondary filters and the detail's property pickers.
    The options open in a Modal, not an absolutely-positioned dropdown: inside a
    horizontal ScrollView, Android clips anything drawn outside the row's bounds
    (`overflow: 'visible'` is not honoured there), so the old menu was invisible. */
function Picker({ label, value, options, onPick, color = ACCENT }: {
  label: string; value: string; options: { id: string; label: string; color?: string }[]; onPick: (id: string) => void; color?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const current = options.find((o) => o.id === value);
  return (
    <>
      <Pressable onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel={`${label}: ${current?.label ?? 'All'}`}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 38, paddingVertical: 8, paddingHorizontal: 11, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: open ? hexA(color, 0.45) : TECH.line }}>
        <Mono style={{ fontSize: 8, color: TECH.faint }}>{label.toUpperCase()}</Mono>
        {current?.color ? <View style={{ width: 6, height: 6, borderRadius: 6, backgroundColor: current.color }} /> : null}
        <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: current ? TECH.ink : TECH.muted }}>{current?.label ?? 'All'}</Text>
        <Icon name="chevDown" size={11} color={TECH.muted} strokeWidth={2.2} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 }}>
          {/* Sibling backdrop (house rule) — never a parent wrapping the panel. */}
          <Pressable onPress={() => setOpen(false)} accessibilityRole="button" accessibilityLabel="Close" importantForAccessibility="no-hide-descendants"
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.66)' }} />
          <View accessibilityViewIsModal style={{ width: '100%', maxWidth: 320, borderRadius: 16, overflow: 'hidden', backgroundColor: TECH.panel2, borderWidth: 1, borderColor: hexA(color, 0.32) }}>
            <View style={{ paddingVertical: 11, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: TECH.line }}>
              <Mono style={{ fontSize: 8.5, letterSpacing: 1.2, color: TECH.faint }}>{label.toUpperCase()}</Mono>
            </View>
            <ScrollView style={{ maxHeight: 320 }} keyboardShouldPersistTaps="handled">
              {options.map((o) => (
                <Pressable key={o.id} onPress={() => { onPick(o.id); setOpen(false); }} accessibilityRole="button"
                  accessibilityState={{ selected: o.id === value }}
                  style={{ minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 12, paddingHorizontal: 14, backgroundColor: o.id === value ? hexA(color, 0.12) : 'transparent' }}>
                  {o.color ? <View style={{ width: 7, height: 7, borderRadius: 7, backgroundColor: o.color }} /> : null}
                  <Text style={{ flex: 1, fontFamily: o.id === value ? F.bodyBold : F.body, fontSize: 13.5, color: o.id === value ? color : TECH.ink2 }}>{o.label}</Text>
                  {o.id === value ? <Icon name="checks" size={13} color={color} strokeWidth={2.6} /> : null}
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

/* ---------- staff: re-file the type ----------
   "Other" is a reporter's escape hatch, not a category, so Tech is expected to file it.
   Either pick a fixed kind or write a name; a written name IS the type from then on and
   the enum sits at 'other' underneath, which is why both keys always travel together. */
function TypePicker({ ticket, busy, onPatch }: { ticket: TechTicket; busy: boolean; onPatch: (p: any) => void }) {
  const insets = useSafeAreaInsets();
  const kbH = useKeyboardHeight();
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const reuse = useCustomTypeLabels();
  const written = ticket.type_label?.trim() || '';
  const unfiled = isUnfiled(ticket);

  React.useEffect(() => { if (open) setDraft(written); }, [open]);

  const pickFixed = (k: TechType) => { onPatch({ type: k, type_label: null }); setOpen(false); };
  const setWritten = (raw: string) => {
    const label = raw.trim().slice(0, TYPE_LABEL_MAX);
    if (!label) return;
    Keyboard.dismiss();
    onPatch({ type: 'other', type_label: label });
    setOpen(false);
  };
  const shown = reuse.filter((l) => !draft.trim() || l.toLowerCase().includes(draft.trim().toLowerCase())).slice(0, 8);

  return (
    <>
      <Pressable onPress={() => setOpen(true)} disabled={busy} accessibilityRole="button" accessibilityLabel={`Type: ${typeLabelOf(ticket)}`}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 38, paddingVertical: 8, paddingHorizontal: 11, borderRadius: 10, opacity: busy ? 0.5 : 1, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: unfiled ? hexA(C.gold, 0.55) : TECH.line }}>
        <Mono style={{ fontSize: 8, color: TECH.faint }}>TYPE</Mono>
        <Icon name={written ? 'tag' : TYPE_ICON[ticket.type]} size={11} color={written ? SKY : unfiled ? C.gold : TECH.muted} strokeWidth={2.2} />
        <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: written ? SKY : TECH.ink }}>{typeLabelOf(ticket)}</Text>
        {unfiled ? (
          <View style={{ paddingVertical: 1, paddingHorizontal: 5, borderRadius: 4, backgroundColor: hexA(C.gold, 0.16) }}>
            <Mono style={{ fontSize: 7, color: C.gold }}>NEEDS FILING</Mono>
          </View>
        ) : null}
        <Icon name="chevDown" size={11} color={TECH.muted} strokeWidth={2.2} />
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable onPress={() => setOpen(false)} accessibilityRole="button" accessibilityLabel="Close" importantForAccessibility="no-hide-descendants"
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.66)' }} />
          <View accessibilityViewIsModal style={{ maxHeight: '86%', backgroundColor: TECH.panel2, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 1, borderColor: hexA(ACCENT, 0.28), paddingHorizontal: 16, paddingTop: 14, paddingBottom: 14 + insets.bottom + kbH }}>
            <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.18)', alignSelf: 'center', marginBottom: 12 }} />
            <Serif style={{ fontSize: 18, color: TECH.ink, marginBottom: 12 }}>Type</Serif>

            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 14, paddingBottom: 6 }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {ALL_TYPES.map((k) => {
                  const on = !written && ticket.type === k;
                  return (
                    <Pressable key={k} onPress={() => pickFixed(k)} accessibilityRole="button" accessibilityState={{ selected: on }}
                      style={{ flexGrow: 1, flexBasis: '45%', minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 11, paddingHorizontal: 12, borderRadius: 12, backgroundColor: on ? hexA(ACCENT, 0.14) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: on ? hexA(ACCENT, 0.45) : TECH.line }}>
                      <Icon name={TYPE_ICON[k]} size={13} color={on ? ACCENT : TECH.muted} strokeWidth={2.1} />
                      <Text style={{ flex: 1, fontFamily: on ? F.bodyBold : F.bodySemi, fontSize: 12.5, color: on ? ACCENT : TECH.ink2 }}>{TYPE_LABEL[k]}</Text>
                      {on ? <Icon name="checks" size={12} color={ACCENT} strokeWidth={2.6} /> : null}
                    </Pressable>
                  );
                })}
              </View>

              <View style={{ height: 1, backgroundColor: TECH.line }} />

              <View style={{ gap: 7 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Mono style={{ flex: 1, fontSize: 8.5, letterSpacing: 0.9, color: TECH.faint }}>OR WRITE YOUR OWN</Mono>
                  <Mono style={{ fontSize: 8.5, color: draft.length > TYPE_LABEL_MAX ? C.red : TECH.faint }}>{draft.length}/{TYPE_LABEL_MAX}</Mono>
                </View>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TextInput
                    value={draft} onChangeText={(v) => setDraft(v.slice(0, TYPE_LABEL_MAX))}
                    placeholder="Hardware, Access, Data fix..." placeholderTextColor={TECH.faint}
                    onSubmitEditing={() => setWritten(draft)} returnKeyType="done" accessibilityLabel="Write a type name"
                    style={{ flex: 1, fontFamily: F.body, fontSize: 14, color: TECH.ink, paddingVertical: 11, paddingHorizontal: 12, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: TECH.line }} />
                  <Pressable onPress={() => setWritten(draft)} disabled={!draft.trim()} accessibilityRole="button" accessibilityLabel="Set this type"
                    style={{ minWidth: 62, alignItems: 'center', justifyContent: 'center', borderRadius: 11, opacity: draft.trim() ? 1 : 0.4, backgroundColor: hexA(ACCENT, 0.16), borderWidth: 1, borderColor: hexA(ACCENT, 0.45) }}>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: ACCENT }}>Set</Text>
                  </Pressable>
                </View>
                <Mono style={{ fontSize: 8, color: TECH.faint }}>
                  {written ? `NOW: ${written.toUpperCase()}` : "SHOWS EVERYWHERE AS THE TICKET'S TYPE."}
                </Mono>
                {shown.length ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
                    {shown.map((l) => (
                      <Pressable key={l} onPress={() => setWritten(l)} accessibilityRole="button" accessibilityLabel={`Use ${l}`}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 32, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, backgroundColor: hexA(SKY, 0.1), borderWidth: 1, borderColor: hexA(SKY, 0.3) }}>
                        <Icon name="tag" size={9} color={SKY} strokeWidth={2.2} />
                        <Text style={{ fontFamily: F.bodySemi, fontSize: 11.5, color: SKY }}>{l}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

/* ---------- staff: how long it took ----------
   Bookkeeping, not conversation: no thread row, and reporters never see it. Editable at
   any status; once a ticket is done with nothing logged the pill turns amber and asks. */
function TimeTakenPill({ ticket, busy }: { ticket: TechTicket; busy: boolean }) {
  const insets = useSafeAreaInsets();
  const kbH = useKeyboardHeight();
  const setM = useSetTimeTaken();
  const [open, setOpen] = React.useState(false);
  const cur = ticket.time_taken?.minutes ?? null;
  const [h, setH] = React.useState('');
  const [m, setM2] = React.useState('');

  React.useEffect(() => {
    if (!open) return;
    const s = splitMinutes(cur ?? 0);
    setH(cur == null ? '' : String(s.hours));
    setM2(cur == null ? '' : String(s.minutes));
  }, [open]);

  const done = ticket.status === 'resolved' || ticket.status === 'closed';
  const nudge = done && cur == null;
  const total = (parseInt(h || '0', 10) || 0) * 60 + (parseInt(m || '0', 10) || 0);
  const canSave = total >= 1 && total <= 100000;

  const save = (minutes: number | null) => {
    if (setM.isPending) return;
    Keyboard.dismiss();
    setM.mutate({ id: ticket.id, minutes }, {
      onSuccess: () => setOpen(false),
      onError: (e: any) => Alert.alert("Couldn't save the time", e?.message ?? 'Try again.'),
    });
  };

  return (
    <>
      <Pressable onPress={() => setOpen(true)} disabled={busy} accessibilityRole="button" accessibilityLabel={cur == null ? 'Add time taken' : `Time ${fmtMinutes(cur)}`}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 38, paddingVertical: 8, paddingHorizontal: 11, borderRadius: 10, opacity: busy ? 0.5 : 1, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: nudge ? hexA(C.gold, 0.55) : TECH.line }}>
        <Mono style={{ fontSize: 8, color: TECH.faint }}>TIME</Mono>
        <Icon name="clock" size={11} color={nudge ? C.gold : cur != null ? ACCENT : TECH.muted} strokeWidth={2.2} />
        <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: nudge ? C.gold : cur != null ? ACCENT : TECH.muted }}>
          {cur != null ? fmtMinutes(cur) : nudge ? 'Add time taken' : 'Not set'}
        </Text>
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable onPress={() => setOpen(false)} accessibilityRole="button" accessibilityLabel="Close" importantForAccessibility="no-hide-descendants"
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.66)' }} />
          <View accessibilityViewIsModal style={{ backgroundColor: TECH.panel2, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 1, borderColor: hexA(ACCENT, 0.28), paddingHorizontal: 16, paddingTop: 14, paddingBottom: 14 + insets.bottom + kbH, gap: 13 }}>
            <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.18)', alignSelf: 'center' }} />
            <View style={{ gap: 3 }}>
              <Mono style={{ fontSize: 8.5, letterSpacing: 1, color: ACCENT }}>TIME TAKEN</Mono>
              <Body style={{ fontSize: 12, color: TECH.ink2 }}>How long this took, by your count. You can change it any time.</Body>
            </View>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
              {TIME_PRESETS.map((p) => (
                <Pressable key={p} onPress={() => save(p)} disabled={setM.isPending} accessibilityRole="button" accessibilityLabel={`Log ${fmtMinutes(p)}`}
                  style={{ minHeight: 36, justifyContent: 'center', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: cur === p ? hexA(ACCENT, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: cur === p ? hexA(ACCENT, 0.45) : TECH.line }}>
                  <Text style={{ fontFamily: cur === p ? F.bodyBold : F.bodySemi, fontSize: 12.5, color: cur === p ? ACCENT : TECH.ink2 }}>{fmtMinutes(p)}</Text>
                </Pressable>
              ))}
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 9 }}>
              {([['HOURS', h, setH], ['MINUTES', m, setM2]] as const).map(([lab, val, set]) => (
                <View key={lab} style={{ flex: 1, gap: 5 }}>
                  <Mono style={{ fontSize: 8, color: TECH.faint }}>{lab}</Mono>
                  <TextInput value={val} onChangeText={(v) => set(v.replace(/[^0-9]/g, '').slice(0, 4))} keyboardType="number-pad"
                    placeholder="0" placeholderTextColor={TECH.faint} accessibilityLabel={lab.toLowerCase()}
                    style={{ fontFamily: F.body, fontSize: 15, color: TECH.ink, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: TECH.line }} />
                </View>
              ))}
              <Pressable onPress={() => save(total)} disabled={!canSave || setM.isPending} accessibilityRole="button" accessibilityLabel="Save time taken"
                style={{ minWidth: 74, minHeight: 41, alignItems: 'center', justifyContent: 'center', borderRadius: 11, opacity: canSave && !setM.isPending ? 1 : 0.4, backgroundColor: hexA(ACCENT, 0.16), borderWidth: 1, borderColor: hexA(ACCENT, 0.45) }}>
                {setM.isPending ? <ActivityIndicator size="small" color={ACCENT} /> : <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: ACCENT }}>Save</Text>}
              </Pressable>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Mono style={{ flex: 1, fontSize: 8.5, color: TECH.faint }}>
                {ticket.time_taken
                  ? `${fmtMinutes(ticket.time_taken.minutes)} BY ${(ticket.time_taken.by_name || 'STAFF').toUpperCase()} · ${fullStamp(ticket.time_taken.at)}`
                  : 'NOTHING LOGGED YET.'}
              </Mono>
              {cur != null ? (
                <Pressable onPress={() => save(null)} disabled={setM.isPending} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear time taken">
                  <Mono style={{ fontSize: 9, color: C.red }}>CLEAR</Mono>
                </Pressable>
              ) : null}
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

/* ---------- staff: delete a ticket ----------
   Total and irreversible: the ticket, its thread and every attachment, for everyone,
   with no notification to the reporter. The dialog names what is about to go so the
   tap is a decision rather than a reflex, and points at Close for the ordinary case. */
function DeleteTicketSheet({ ticket, messageCount, visible, onClose, onDeleted }: {
  ticket: TechTicket; messageCount: number; visible: boolean; onClose: () => void; onDeleted: () => void;
}) {
  const insets = useSafeAreaInsets();
  const delM = useDeleteTicket();
  const sentRef = React.useRef(false);
  React.useEffect(() => { if (visible) { sentRef.current = false; delM.reset(); } }, [visible]);

  const reporter = personName(ticket.creator);
  const go = () => {
    if (delM.isPending || sentRef.current) return;
    sentRef.current = true;
    delM.mutate(ticket.id, {
      onSuccess: () => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); onDeleted(); },
      onError: (e: any) => { sentRef.current = false; Alert.alert("Couldn't delete", e?.message ?? 'Check your connection and try again.'); },
    });
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 26 }}>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" importantForAccessibility="no-hide-descendants"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.72)' }} />
        <View accessibilityViewIsModal style={{ width: '100%', maxWidth: 360, borderRadius: 18, backgroundColor: TECH.panel2, borderWidth: 1, borderColor: hexA(C.red, 0.45), padding: 18, gap: 12, marginBottom: insets.bottom }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Icon name="alert" size={15} color={C.red} strokeWidth={2.4} />
            <Mono style={{ fontSize: 9, letterSpacing: 1.3, color: C.red }}>NO UNDO</Mono>
          </View>
          <Serif style={{ fontSize: 20, color: TECH.ink }}>Delete {ticketNo(ticket.serial_no)}?</Serif>
          <Text numberOfLines={3} style={{ fontFamily: F.bodySemi, fontSize: 13, color: TECH.ink2, lineHeight: 18 }}>{ticket.title}</Text>

          <View style={{ gap: 5, padding: 11, borderRadius: 12, backgroundColor: hexA(C.red, 0.07), borderWidth: 1, borderColor: hexA(C.red, 0.22) }}>
            <Mono style={{ fontSize: 8.5, letterSpacing: 0.8, color: C.red }}>THIS ALSO REMOVES</Mono>
            <Body style={{ fontSize: 12, color: TECH.ink2, lineHeight: 17 }}>
              {messageCount} message{messageCount === 1 ? '' : 's'} in the thread and every attachment on it, for everyone.
              {' '}Raised by {reporter}, who is not told.
            </Body>
          </View>
          <Body style={{ fontSize: 11.5, color: TECH.muted, lineHeight: 16 }}>If the work is simply done, close it instead.</Body>

          <View style={{ flexDirection: 'row', gap: 9, marginTop: 2 }}>
            <Pressable onPress={onClose} disabled={delM.isPending} accessibilityRole="button"
              style={{ flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: TECH.line }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: TECH.ink2 }}>Keep it</Text>
            </Pressable>
            <Pressable onPress={go} disabled={delM.isPending} accessibilityRole="button" accessibilityLabel={`Delete ${ticketNo(ticket.serial_no)} permanently`}
              style={{ flex: 1.25, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 12, opacity: delM.isPending ? 0.6 : 1, backgroundColor: hexA(C.red, 0.16), borderWidth: 1, borderColor: hexA(C.red, 0.5) }}>
              {delM.isPending ? <ActivityIndicator size="small" color={C.red} />
                : <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: C.red }}>Delete ticket</Text>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/* ---------- console alert strip ----------
   The tech role lives on this screen, so the global reporter banner (which hides
   itself on Tech Desk routes) never reaches them. This is their version, derived
   from the tickets already loaded rather than a second query. */
function ConsoleAlerts({ alerts, onOpen }: { alerts: StaffAlert[]; onOpen: (id: string) => void }) {
  const [dismissed, setDismissed] = React.useState<string | null>(null);
  // The exact set being shown, so anything new re-opens the strip after a dismiss.
  const signature = alerts.map((a) => `${a.ticketId}:${a.at}`).join('|');
  if (!alerts.length || dismissed === signature) return null;

  const top = alerts[0];
  const more = alerts.length - 1;
  const col = top.kind === 'ack'
    ? (top.verdict === 'confirmed' ? STATUS_COLOR.resolved : C.gold)
    : top.kind === 'new' ? ACCENT : STATUS_COLOR.in_progress;
  const tag = top.kind === 'ack'
    ? (top.verdict === 'confirmed' ? 'ACKNOWLEDGED' : 'SENT BACK')
    : top.kind === 'new' ? 'NEW TICKET' : 'NEW REPLY';

  return (
    <Pressable onPress={() => onOpen(top.ticketId)} accessibilityRole="button"
      accessibilityLabel={`${tag}. ${ticketNo(top.serialNo)} ${top.title}. ${top.who} ${top.text}. Open ticket.`}
      style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 13, backgroundColor: hexA(col, 0.09), borderWidth: 1, borderColor: hexA(col, 0.34) })}>
      <Pulse color={col} size={6} />
      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <Mono style={{ fontSize: 8, letterSpacing: 0.9, color: col }}>{tag}</Mono>
          <Mono style={{ fontSize: 9, color: col }}>{ticketNo(top.serialNo)}</Mono>
          <Text numberOfLines={1} style={{ flex: 1, fontFamily: F.bodySemi, fontSize: 12, color: TECH.ink }}>{top.title}</Text>
        </View>
        <Mono style={{ fontSize: 8.5, color: TECH.muted }} numberOfLines={1}>
          {top.who} {top.text}{more > 0 ? ` · +${more} more` : ''}
        </Mono>
      </View>
      <Pressable onPress={() => setDismissed(signature)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Dismiss">
        <Icon name="close" size={13} color={TECH.muted} strokeWidth={2.2} />
      </Pressable>
    </Pressable>
  );
}

/* ---------- console row ---------- */
function ConsoleRow({ t, unread, onPress }: { t: TechTicket; unread: boolean; onPress: () => void }) {
  const col = statusColor(t.status, true);
  // Two things the row has to say beyond its status: nobody has opened this yet,
  // and the reporter has answered a resolution since anyone last looked.
  const isNew = isNewForStaff(t);
  const ack = freshAck(t);
  const written = t.type_label?.trim() || '';
  const unfiled = isUnfiled(t);
  const mins = t.time_taken?.minutes;
  const byReporter = t.status === 'closed' && t.closure?.by_role === 'reporter';
  const reporter = personName(t.creator);
  const reporterRole = (t.creator?.role ?? '').trim();
  const metaCol = ack ? (ack.verdict === 'confirmed' ? STATUS_COLOR.resolved : C.gold)
    : t.status === 'resolved' ? STATUS_COLOR.resolved : TECH.faint;
  const metaTag = ack ? (ack.verdict === 'confirmed' ? 'CONFIRMED · ' : 'SENT BACK · ')
    : t.status === 'resolved' ? 'AWAITING ACK · ' : '';
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${ticketNo(t.serial_no)}, raised by ${reporter}${reporterRole ? `, ${reporterRole}` : ''}. ${t.title}`}
      style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1, minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 13, backgroundColor: unread ? hexA(ACCENT, 0.07) : TECH.panel, borderWidth: 1, borderColor: unread ? hexA(ACCENT, 0.3) : TECH.line })}>
      <View style={{ width: 8, alignItems: 'center' }}>{unread ? <Pulse color={ACCENT} size={6} /> : null}</View>
      <View style={{ flex: 1, gap: 4 }}>
        {/* WHO leads. On a queue the first question is "who is this from", so the
            reporter's full name is the bold first line, the ticket title sits under it. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <Mono style={{ fontSize: 10.5, color: ACCENT }}>{ticketNo(t.serial_no)}</Mono>
          {isNew ? (
            <View style={{ paddingVertical: 1.5, paddingHorizontal: 6, borderRadius: 999, backgroundColor: hexA(ACCENT, 0.18), borderWidth: 1, borderColor: hexA(ACCENT, 0.45) }}>
              <Mono style={{ fontSize: 7.5, letterSpacing: 0.5, color: ACCENT }}>NEW</Mono>
            </View>
          ) : null}
          {t.priority === 'urgent' ? <Pulse color={PRIORITY_COLOR.urgent} size={7} /> : <View style={{ width: 7, height: 7, borderRadius: 7, backgroundColor: PRIORITY_COLOR[t.priority] }} />}
          <PersonAvatar name={reporter} url={t.creator?.avatar_url} size={18} />
          <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: F.bodyBold, fontSize: 15, color: TECH.ink }}>{reporter}</Text>
          {reporterRole ? (
            <View style={{ paddingVertical: 1.5, paddingHorizontal: 6, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.07)' }}>
              <Mono style={{ fontSize: 7.5, letterSpacing: 0.5, color: TECH.ink2 }}>{reporterRole.toUpperCase()}</Mono>
            </View>
          ) : null}
          <View style={{ flex: 1 }} />
          {written ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 1.5, paddingHorizontal: 6, borderRadius: 999, backgroundColor: hexA(SKY, 0.16), borderWidth: 1, borderColor: hexA(SKY, 0.4) }}>
              <Icon name="tag" size={9} color={SKY} strokeWidth={2.2} />
              <Mono style={{ fontSize: 7.5, color: SKY }} numberOfLines={1}>{written.toUpperCase()}</Mono>
            </View>
          ) : (
            <Icon name={TYPE_ICON[t.type]} size={12} color={unfiled ? C.gold : TECH.faint} strokeWidth={2} />
          )}
        </View>
        <Text numberOfLines={1} style={{ fontFamily: unread ? F.bodySemi : F.body, fontSize: 13, color: unread ? TECH.ink : TECH.ink2 }}>{t.title}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Mono style={{ flex: 1, fontSize: 8.5, color: TECH.faint }} numberOfLines={1}>
            {/* Resolved means it is parked on the reporter, which is the queue's most
                easily forgotten state — say so on the row rather than only in the detail.
                Once they answer, the row says what they answered instead. Only the TAG
                is coloured: colouring the whole line turned platforms and time green too. */}
            {metaTag ? <Text style={{ color: metaCol }}>{metaTag}</Text> : null}
            {mins != null ? <Text style={{ color: ACCENT }}>{fmtMinutes(mins)} · </Text> : null}
            {typeLabelOf(t).toUpperCase()} · {t.platforms.map((p) => PLATFORM_ON_TICKET[p].toUpperCase()).join(' · ')} · {timeAgo(t.created_at)}
            {t.assignee ? ` · ${personName(t.assignee).split(' ')[0]}` : ''}
          </Mono>
          {byReporter ? (
            <View style={{ paddingVertical: 1.5, paddingHorizontal: 5, borderRadius: 4, borderWidth: 1, borderColor: hexA(C.gold, 0.4) }}>
              <Mono style={{ fontSize: 7, color: C.gold }}>CLOSED BY REPORTER</Mono>
            </View>
          ) : null}
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4, paddingHorizontal: 9, borderRadius: 999, backgroundColor: hexA(col, 0.14), borderWidth: 1, borderColor: hexA(col, 0.34) }}>
        <View style={{ width: 5, height: 5, borderRadius: 5, backgroundColor: col }} />
        <Text style={{ fontFamily: F.bodyBold, fontSize: 10, color: col }}>{STATUS_LABEL[t.status]}</Text>
      </View>
    </Pressable>
  );
}

/* ================= CONSOLE — inbox ================= */
export function TechDeskInbox() {
  const { go, set } = useStore();
  const { session, dbRole } = useAuth();
  const ticketsQ = useTechTickets('all');
  const activityQ = useTechActivity(ticketsQ.data ?? []);
  useTechDeskRealtime();

  const [status, setStatus] = React.useState<'new' | 'active' | TechStatus | 'all'>('active');
  const [priority, setPriority] = React.useState<'all' | TechPriority>('all');
  // 'all' | a fixed kind | 'other' (unfiled only) | 'label:<written type>'
  const [type, setType] = React.useState<string>('all');
  const [platform, setPlatform] = React.useState<'all' | TechPlatform>('all');
  const [role, setRole] = React.useState<'all' | string>('all');
  const [query, setQuery] = React.useState('');

  if (!dbRole) return <AccessPending />;
  if (!isTechStaffRole(dbRole)) {
    return (
      <ConsoleShell>
        <View style={{ alignItems: 'center', gap: 10, paddingVertical: 70 }}>
          <Icon name="shield" size={26} color={ACCENT} strokeWidth={1.9} />
          <Serif style={{ fontSize: 19, color: TECH.ink }}>Tech Desk only</Serif>
          <Body style={{ fontSize: 12.5, color: TECH.muted, textAlign: 'center' }}>This console is for the Tech Desk team.</Body>
        </View>
      </ConsoleShell>
    );
  }

  const all = ticketsQ.data ?? [];
  const act = activityQ.data ?? {};
  const counts: Record<string, number> = { all: all.length, active: 0, new: 0 };
  all.forEach((t) => {
    counts[t.status] = (counts[t.status] ?? 0) + 1;
    if (isOpenStatus(t.status)) counts.active = (counts.active ?? 0) + 1;
    if (isNewForStaff(t)) counts.new = (counts.new ?? 0) + 1;
  });
  // The strip and the New count both read the queue that is already loaded.
  const alerts = staffAlerts(all, act);
  const roleOptions = [...new Set(all.map((t) => t.creator?.role).filter(Boolean) as string[])];
  const writtenTypes = customTypeLabels(all);

  const q = query.trim().toLowerCase();
  const serial = q ? parseTicketNo(q) : null;
  const filtered = sortTickets(all.filter((t) => {
    if (status === 'new' ? !isNewForStaff(t)
      : status === 'active' ? !isOpenStatus(t.status)
      : status !== 'all' && t.status !== status) return false;
    if (priority !== 'all' && t.priority !== priority) return false;
    // 'other' means UNFILED, not "the enum happens to be other": a ticket someone has
    // already named is filed, and belongs under its own name instead.
    if (type !== 'all') {
      if (type.startsWith('label:')) { if ((t.type_label ?? '').trim() !== type.slice(6)) return false; }
      else if (type === 'other') { if (!isUnfiled(t)) return false; }
      else if (t.type !== type) return false;
    }
    if (platform !== 'all' && !t.platforms.includes(platform)) return false;
    if (role !== 'all' && t.creator?.role !== role) return false;
    if (q && !((serial != null && t.serial_no === serial) || t.title.toLowerCase().includes(q) || ticketNo(t.serial_no).toLowerCase().includes(q))) return false;
    return true;
  }));

  const openTicket = (id: string) => { set({ selectedTicketId: id }); go('tech-desk-inbox-ticket'); };
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = (session?.user?.user_metadata?.first_name as string) || 'Tech';
  const today = all.filter((t) => new Date(t.created_at).toDateString() === new Date().toDateString()).length;
  const urgent = all.filter((t) => t.priority === 'urgent' && isOpenStatus(t.status)).length;
  const sysLine = `SYSTEM ONLINE · TECH DESK · ${new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: '2-digit', month: 'short' }).toUpperCase()}`;

  const STATUS_TABS: { id: 'new' | 'active' | TechStatus | 'all'; label: string }[] = [
    // "New" leads: an unopened ticket is the one thing here with a clock running on it.
    { id: 'new', label: 'New' },
    { id: 'active', label: 'Active' }, { id: 'open', label: 'Open' }, { id: 'in_progress', label: 'In Progress' },
    { id: 'waiting_on_reporter', label: 'Waiting' }, { id: 'testing', label: 'Testing' },
    { id: 'resolved', label: 'Resolved' }, { id: 'closed', label: 'Closed' }, { id: 'all', label: 'All' },
  ];

  return (
    <ConsoleShell>
      {/* ---- header ---- */}
      <FadeIn>
        <View style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ flex: 1, gap: 3 }}>
              <Mono style={{ fontSize: 8, letterSpacing: 1.1, color: ACCENT }}>{sysLine}</Mono>
              <Serif style={{ fontSize: 25, color: TECH.ink }}>{greet}, {firstName}</Serif>
            </View>
            <View style={{ alignItems: 'center', gap: 4 }}>
              <View style={{ width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: hexA(ACCENT, 0.12), borderWidth: 1.5, borderColor: hexA(ACCENT, 0.5) }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: ACCENT }}>{firstName.slice(0, 2).toUpperCase()}</Text>
              </View>
              <Mono style={{ fontSize: 7, color: TECH.faint }}>TECH · ON DUTY</Mono>
            </View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <LiveClock />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 3, paddingHorizontal: 9, borderRadius: 999, backgroundColor: hexA(ACCENT, 0.1), borderWidth: 1, borderColor: hexA(ACCENT, 0.3) }}>
              <Pulse color={ACCENT} size={5} />
              <Mono style={{ fontSize: 8, color: ACCENT }}>LIVE</Mono>
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 9 }}>
            <Readout label="IN QUEUE" value={counts.active ?? 0} color={ACCENT} />
            <Readout label="URGENT" value={urgent} color={PRIORITY_COLOR.urgent} pulse />
            <Readout label="RAISED TODAY" value={today} color={STATUS_COLOR.testing} />
          </View>
        </View>
      </FadeIn>

      {/* ---- what happened while you were away ---- */}
      <ConsoleAlerts alerts={alerts} onOpen={openTicket} />

      {/* ---- search ---- */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, backgroundColor: TECH.panel, borderWidth: 1, borderColor: TECH.line }}>
        <Icon name="search" size={14} color={TECH.muted} strokeWidth={2.2} />
        <TextInput value={query} onChangeText={setQuery} placeholder="Search T-number or title" placeholderTextColor={TECH.faint}
          accessibilityLabel="Search tickets"
          style={{ flex: 1, fontFamily: F.body, fontSize: 13.5, color: TECH.ink, padding: 0 }} />
        {query ? (
          <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search">
            <Icon name="close" size={13} color={TECH.muted} strokeWidth={2.2} />
          </Pressable>
        ) : null}
      </View>

      {/* ---- status tabs ---- */}
      <HScroll gap={8}>
        {STATUS_TABS.map((t) => (
          <Pill key={t.id} label={t.label} count={counts[t.id] ?? 0} active={status === t.id} onPress={() => setStatus(t.id)}
            color={t.id === 'new' || t.id === 'active' || t.id === 'all' ? ACCENT : statusColor(t.id as TechStatus, true) ?? ACCENT} />
        ))}
      </HScroll>

      {/* ---- secondary filters ---- */}
      <HScroll gap={8}>
        <Picker label="Priority" value={priority} onPick={(v) => setPriority(v as any)}
          options={[{ id: 'all', label: 'All' }, ...(['urgent', 'high', 'medium', 'low'] as TechPriority[]).map((p) => ({ id: p, label: PRIORITY_LABEL[p], color: PRIORITY_COLOR[p] }))]} />
        <Picker label="Type" value={type} onPick={setType}
          options={[
            { id: 'all', label: 'All' },
            ...(['bug', 'feature', 'research'] as TechType[]).map((k) => ({ id: k, label: TYPE_LABEL[k] })),
            { id: 'other', label: 'Other (unfiled)' },
            // Every name the team has actually written, so the queue can be worked by it.
            ...writtenTypes.map((l) => ({ id: `label:${l}`, label: l })),
          ]} />
        <Picker label="Platform" value={platform} onPick={(v) => setPlatform(v as any)}
          options={[{ id: 'all', label: 'All' }, ...ALL_PLATFORMS.map((p) => ({ id: p, label: PLATFORM_LABEL[p] }))]} />
        <Picker label="Role" value={role} onPick={setRole}
          options={[{ id: 'all', label: 'All' }, ...roleOptions.map((r) => ({ id: r, label: r.toUpperCase() }))]} />
      </HScroll>

      {/* ---- queue ---- */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <Mono style={{ flex: 1, fontSize: 8.5, letterSpacing: 1, color: TECH.faint }}>QUEUE // {filtered.length} TICKET{filtered.length === 1 ? '' : 'S'}</Mono>
        <Pulse color={ACCENT} size={5} />
        <Mono style={{ fontSize: 8, color: TECH.faint }}>listening</Mono>
      </View>

      {ticketsQ.isPending ? (
        <View style={{ paddingVertical: 40, alignItems: 'center' }}><ActivityIndicator color={ACCENT} /></View>
      ) : ticketsQ.isError ? (
        <Body style={{ fontSize: 11.5, color: C.red, textAlign: 'center', paddingVertical: 20 }}>{(ticketsQ.error as Error).message}</Body>
      ) : !all.length ? (
        <View style={{ alignItems: 'center', gap: 12, paddingVertical: 50 }}>
          <View style={{ width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: hexA(ACCENT, 0.25) }}>
            <Pulse color={ACCENT} size={12} />
          </View>
          <Mono style={{ fontSize: 11, letterSpacing: 1.5, color: ACCENT }}>SCANNING FOR TICKETS_</Mono>
          <Body style={{ fontSize: 12, color: TECH.muted, textAlign: 'center', paddingHorizontal: 24 }}>When anyone on the team raises something, it lands here instantly.</Body>
        </View>
      ) : !filtered.length ? (
        <View style={{ alignItems: 'center', gap: 6, paddingVertical: 40 }}>
          <Body style={{ fontSize: 12.5, color: TECH.ink2 }}>Nothing matches these filters.</Body>
          <Mono style={{ fontSize: 9, color: TECH.faint }}>TRY WIDENING A FILTER</Mono>
        </View>
      ) : (
        <View style={{ gap: 9 }}>
          {filtered.map((t, i) => (
            <FadeIn key={t.id} delay={Math.min(i * 40, 300)}>
              <ConsoleRow t={t} unread={staffHasUnread(t, act[t.id])} onPress={() => openTicket(t.id)} />
            </FadeIn>
          ))}
        </View>
      )}
    </ConsoleShell>
  );
}

/* ================= CONSOLE — ticket detail ================= */
export function TechDeskInboxTicket() {
  const { back, canGoBack, go, selectedTicketId } = useStore();
  const { session, dbRole } = useAuth();
  const me = session?.user?.id ?? '';
  const ticketQ = useTechTicket(selectedTicketId);
  const msgsQ = useTechMessages(selectedTicketId);
  const staffQ = useTechStaff();
  const updateM = useUpdateTicket();
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  useTechDeskRealtime();
  const messages = msgsQ.data ?? [];
  useMarkTicketSeen(selectedTicketId, messages.length);

  const goBack = React.useCallback(() => (canGoBack ? back() : go('tech-desk-inbox')), [canGoBack]);
  // Hardware back / edge swipe returns to the queue rather than popping the stack blindly.
  const goBackRef = React.useRef(goBack); goBackRef.current = goBack;
  React.useEffect(() => {
    backOverride.handler = () => goBackRef.current();
    return () => { backOverride.handler = null; };
  }, []);

  // The queue screen guards itself; this one did not, and `dbRole` was read and then
  // never used. A deep link or a role change mid-session could land a non-staff account
  // on the console detail. RLS still protects the data, but the screen should say no.
  if (!dbRole) return <View style={{ flex: 1, backgroundColor: TECH.ground }}><AccessPending /></View>;
  if (!isTechStaffRole(dbRole)) {
    return (
      <View style={{ flex: 1, backgroundColor: TECH.ground, alignItems: 'center', gap: 10, paddingVertical: 70, paddingHorizontal: 24 }}>
        <Icon name="shield" size={26} color={ACCENT} strokeWidth={1.9} />
        <Serif style={{ fontSize: 19, color: TECH.ink }}>Tech Desk only</Serif>
        <Body style={{ fontSize: 12.5, color: TECH.muted, textAlign: 'center' }}>This console is for the Tech Desk team.</Body>
      </View>
    );
  }

  const t = ticketQ.data;
  if (ticketQ.isPending) {
    return <View style={{ flex: 1, backgroundColor: TECH.ground, paddingVertical: 60, alignItems: 'center' }}><ActivityIndicator color={ACCENT} /></View>;
  }
  if (!t) {
    return (
      <View style={{ flex: 1, backgroundColor: TECH.ground }}>
        <Body style={{ fontSize: 12.5, color: TECH.muted, textAlign: 'center', paddingVertical: 40 }}>This ticket is no longer available.</Body>
      </View>
    );
  }

  const busy = updateM.isPending;
  const closed = t.status === 'closed';
  const waiting = t.status === 'waiting_on_reporter';
  const currentIdx = stageIndexOf(t.status);
  const patch = (p: any) => updateM.mutate({ id: t.id, patch: p }, { onError: (e: any) => Alert.alert("Couldn't update", e?.message ?? 'Try again.') });
  // Moving to Resolved carries a resolution; the trigger clears it when the status leaves resolved/closed.
  const move = (s: TechStatus) => patch(s === 'resolved' ? { status: s, resolution: t.resolution ?? 'fixed' } : { status: s });

  const sideActions: { label: string; to: TechStatus; tone: string }[] =
    closed ? [{ label: 'Reopen', to: 'in_progress', tone: ACCENT }]
    : t.status === 'resolved' ? [{ label: 'Close', to: 'closed', tone: TECH.muted }]
    : waiting ? [{ label: 'Resume', to: 'in_progress', tone: ACCENT }, { label: 'Close', to: 'closed', tone: TECH.muted }]
    : [{ label: 'Ask reporter', to: 'waiting_on_reporter', tone: C.gold }, { label: 'Close', to: 'closed', tone: TECH.muted }];

  return (
    <TicketShell
      dark
      onBack={goBack}
      backLabel="Queue"
      header={busy ? <ActivityIndicator size="small" color={ACCENT} /> : null}
      composer={<Composer ticketId={t.id} closed={closed} dark />}
    >
      {/* ---- title ---- */}
      <View style={{ gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Mono style={{ fontSize: 12, color: ACCENT }}>{ticketNo(t.serial_no)}</Mono>
          <Icon name={t.type_label?.trim() ? 'tag' : TYPE_ICON[t.type]} size={13} color={t.type_label?.trim() ? SKY : TECH.muted} strokeWidth={2} />
          <Mono style={{ fontSize: 9, color: t.type_label?.trim() ? SKY : TECH.faint }}>{typeLongOf(t).toUpperCase()}</Mono>
        </View>
        <Serif style={{ fontSize: 22, color: TECH.ink }}>{t.title}</Serif>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <PersonAvatar name={personName(t.creator)} url={t.creator?.avatar_url} size={20} />
          <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: TECH.ink2 }}>{personName(t.creator)}</Text>
          <View style={{ paddingVertical: 1.5, paddingHorizontal: 5, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.06)' }}>
            <Mono style={{ fontSize: 7, color: TECH.muted }}>{(t.creator?.role ?? '').toUpperCase()}</Mono>
          </View>
          <Mono style={{ fontSize: 9, color: TECH.faint }}>{timeAgo(t.created_at)}</Mono>
        </View>
      </View>

      {/* ---- stage strip (the primary control) ---- */}
      <View style={{ gap: 9, padding: 13, borderRadius: 14, backgroundColor: TECH.panel, borderWidth: 1, borderColor: TECH.line }}>
        <Mono style={{ fontSize: 8, letterSpacing: 1, color: TECH.faint }}>STAGE</Mono>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {STAGE_ORDER.map((stage, i) => {
            const done = i < currentIdx || (closed && i === currentIdx);
            const current = !closed && i === currentIdx;
            const disabled = busy || (current && !waiting);
            const col = current && waiting ? C.gold : done || current ? ACCENT : TECH.faint;
            return (
              <React.Fragment key={stage}>
                <Pressable onPress={() => move(stage)} disabled={disabled} accessibilityRole="button"
                  accessibilityLabel={`Move to ${STAGE_LABEL[stage]}`} accessibilityState={{ selected: current, disabled }}
                  style={{ flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 8, borderRadius: 11, backgroundColor: done || current ? hexA(col, current ? 0.18 : 0.1) : 'transparent', borderWidth: 1, borderColor: hexA(col, done || current ? 0.45 : 0.18) }}>
                  {done ? <Icon name="checks" size={12} color={col} strokeWidth={2.6} />
                    : current ? <Pulse color={col} size={8} />
                    : <View style={{ width: 6, height: 6, borderRadius: 6, backgroundColor: TECH.faint }} />}
                  <Mono style={{ fontSize: 8, color: done || current ? col : TECH.faint, textAlign: 'center' }}>{STAGE_LABEL[stage].toUpperCase()}</Mono>
                </Pressable>
                {i < STAGE_ORDER.length - 1 ? <View style={{ width: 10, height: 1.5, backgroundColor: i < currentIdx ? hexA(ACCENT, 0.5) : 'rgba(255,255,255,0.08)' }} /> : null}
              </React.Fragment>
            );
          })}
        </View>
        {waiting ? <Mono style={{ fontSize: 8.5, color: C.gold }}>· WAITING ON REPORTER</Mono> : null}
        {closed ? <Mono style={{ fontSize: 8.5, color: TECH.muted }}>· CLOSED</Mono> : null}
      </View>

      {/* ---- the resolution is a claim until the reporter answers it ---- */}
      {t.status === 'resolved' ? (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 9, padding: 11, borderRadius: 12, backgroundColor: hexA(STATUS_COLOR.resolved, 0.08), borderWidth: 1, borderColor: hexA(STATUS_COLOR.resolved, 0.3) }}>
          <View style={{ marginTop: 3 }}><Pulse color={STATUS_COLOR.resolved} size={6} /></View>
          <View style={{ flex: 1, gap: 3 }}>
            <Mono style={{ fontSize: 8.5, letterSpacing: 0.9, color: STATUS_COLOR.resolved }}>AWAITING ACKNOWLEDGEMENT</Mono>
            <Body style={{ fontSize: 11.5, color: TECH.ink2, lineHeight: 17 }}>
              {personName(t.creator).split(' ')[0]} confirms the fix and this closes itself. Close it here only if they have gone quiet.
            </Body>
          </View>
        </View>
      ) : null}
      {/* What they answered last time. On an In Progress ticket this is the reason it came back. */}
      {t.acknowledgement ? <AckRecord ack={t.acknowledgement} dark /> : null}

      <DeleteTicketSheet
        ticket={t}
        messageCount={messages.length}
        visible={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onDeleted={() => { setDeleteOpen(false); goBack(); }}
      />

      {/* ---- properties + side actions ---- */}
      <View style={{ gap: 10, zIndex: 40 }}>
        <HScroll gap={8}>
          {/* Type first: an unfiled ticket is the one property that is actually wrong. */}
          <TypePicker ticket={t} busy={busy} onPatch={patch} />
          <TimeTakenPill ticket={t} busy={busy} />
          <Picker label="Priority" value={t.priority} onPick={(v) => patch({ priority: v })}
            options={(['urgent', 'high', 'medium', 'low'] as TechPriority[]).map((p) => ({ id: p, label: PRIORITY_LABEL[p], color: PRIORITY_COLOR[p] }))} />
          <Picker label="Assignee" value={t.assigned_to ?? 'none'} onPick={(v) => patch({ assigned_to: v === 'none' ? null : v })}
            options={[{ id: 'none', label: 'Unassigned' }, ...(staffQ.data ?? []).map((s) => ({ id: s.id, label: personName(s) }))]} />
          {t.status === 'resolved' || closed ? (
            <Picker label="Resolution" value={t.resolution ?? 'none'} onPick={(v) => patch({ resolution: v === 'none' ? null : v })}
              options={[{ id: 'none', label: '—' }, ...(['fixed', 'wont_fix', 'not_a_bug'] as TechResolution[]).map((r) => ({ id: r, label: RESOLUTION_LABEL[r] }))]} />
          ) : null}
        </HScroll>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {/* Delete sits apart on the left, quiet and unfilled: it is not a next step
              in the ticket's life, it ends the ticket. */}
          <Pressable onPress={() => setDeleteOpen(true)} disabled={busy} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Delete ${ticketNo(t.serial_no)}`}
            style={{ minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center', paddingVertical: 9, paddingHorizontal: 12, borderRadius: 10, opacity: busy ? 0.5 : 1, borderWidth: 1, borderColor: hexA(C.red, 0.3) }}>
            <Icon name="trash" size={12} color={C.red} strokeWidth={2.2} />
            <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: C.red }}>Delete</Text>
          </Pressable>
          <View style={{ flex: 1 }} />
          {sideActions.map((a) => (
            <Pressable key={a.label} onPress={() => move(a.to)} disabled={busy} accessibilityRole="button" accessibilityLabel={a.label}
              style={{ minHeight: 38, justifyContent: 'center', paddingVertical: 9, paddingHorizontal: 14, borderRadius: 10, opacity: busy ? 0.5 : 1, backgroundColor: hexA(a.tone, 0.12), borderWidth: 1, borderColor: hexA(a.tone, 0.38) }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: a.tone }}>{a.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <TicketMeta t={t} dark />
      {/* Why it was closed, and by whom. Stays put if the ticket is reopened. */}
      <ClosureRecord ticket={t} dark />
      {t.assignee ? <Mono style={{ fontSize: 8.5, color: TECH.faint }}>ASSIGNED TO {personName(t.assignee).toUpperCase()}</Mono> : null}

      <View style={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
          <Mono style={{ fontSize: 8.5, letterSpacing: 1.2, color: TECH.faint }}>THREAD</Mono>
          <View style={{ flex: 1, height: 1, backgroundColor: TECH.line }} />
        </View>
        {msgsQ.isPending ? <ActivityIndicator color={ACCENT} /> : <Thread ticket={t} messages={messages} meId={me} dark />}
      </View>
    </TicketShell>
  );
}
