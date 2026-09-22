import React from 'react';
import { View, Text, Pressable, Modal, ScrollView, TextInput, Alert, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useQueryClient } from '@tanstack/react-query';
import { C, F, hexA, ORANGE_GRAD } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono, Card, Avatar } from './primitives';
import { useStore } from '../store';
import { useAuth } from '../auth';
import { useKeyboardHeight } from '../lib/useKeyboardHeight';
import { istDate } from '../lib/trainerQueries';
import { useQhpRefreshPending, buildQhpRefreshMessage, fmtProposedSlot, QhpRefreshRow, QHP_REFRESH_DAYS } from '../lib/qhpRefreshQueries';
import { useOpenClientThread, useSendClientThreadMessage, pendingThreadClientRef } from '../lib/clientThreadQueries';

/* ============ QHP Refresh Pending (trainer dashboard section) ============
   Clients whose last QHP was 40+ days ago. Tap a client → propose a date and
   time with a note → it posts to the client's internal thread, @-tagging the
   CRM (the thread push reaches the CRM even with the app closed). Once a
   proposal is in the thread the row reads PROPOSED and only offers the thread. */

const AVS: [string, string][] = [['#9A7BEA', '#6E5BD0'], ['#57C98A', '#3A9E6E'], ['#FB8B3A', '#EE5E16'], ['#7C8FE8', '#5B6FD0'], ['#F2C066', '#D89A2B']];
const initialsOf = (n: string) => n.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || 'C';
const fmtLast = (ymd: string) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short' });
const fmtAt = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });

export function QhpRefreshPendingCard({ trainerId }: { trainerId: string }) {
  const q = useQhpRefreshPending(trainerId);
  const qc = useQueryClient();
  const { go } = useStore();
  // A proposed client goes straight to its thread (the proposal lives there);
  // an actionable one opens the propose-a-slot sheet.
  const openThread = (clientId: string) => { pendingThreadClientRef.current = clientId; go('client-threads'); };
  const rows = q.data ?? [];
  const [showAll, setShowAll] = React.useState(false);
  const [sel, setSel] = React.useState<QhpRefreshRow | null>(null);
  const shown = showAll ? rows : rows.slice(0, 5);
  const count = rows.length;
  const proposed = rows.filter((r) => r.proposal).length;

  // The thread insert is committed before this runs: flip the row to PROPOSED at
  // once, then let the refetch confirm it from the thread.
  const onSent = (row: QhpRefreshRow, slotText: string) => {
    const key = ['trainer-qhp-refresh-pending', trainerId];
    qc.setQueryData<QhpRefreshRow[]>(key, (old) => (old ?? []).map((r) => (r.clientId === row.clientId ? { ...r, proposal: { at: new Date().toISOString(), slot: slotText, mine: true } } : r)));
    qc.invalidateQueries({ queryKey: key });
  };

  return (
    <>
      <Card colors={['rgba(46,36,18,0.45)', 'rgba(18,14,14,0.55)']} border={hexA(C.gold, 0.2)} radius={17} style={{ overflow: 'hidden' }}>
        <LinearGradient colors={[hexA(C.gold, 0.55), 'rgba(255,255,255,0.02)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 3 }} />
        <View style={{ paddingHorizontal: 13, paddingVertical: 13, gap: 10 }}>
          {/* Header: title + client count */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: hexA(C.gold, 0.14), borderWidth: 1, borderColor: hexA(C.gold, 0.32), alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="clipboard" size={19} color={C.gold} strokeWidth={1.9} />
            </View>
            <View style={{ flex: 1 }}>
              <Body style={{ fontSize: 14.5, fontFamily: F.bodyBold, color: '#fff' }}>QHP Refresh Pending</Body>
              <Body numberOfLines={2} style={{ fontSize: 11, color: C.muted2, marginTop: 2 }}>
                {q.isLoading ? 'Checking your clients…'
                  : count === 0 ? `Every client had a QHP within the last ${QHP_REFRESH_DAYS} days.`
                  : `Last QHP ${QHP_REFRESH_DAYS}+ days ago.${proposed ? ` ${proposed} proposed, waiting for the CRM.` : ' Tap a client to propose a slot to their CRM.'}`}
              </Body>
            </View>
            <View style={{ minWidth: 30, height: 30, borderRadius: 15, paddingHorizontal: 9, backgroundColor: count > 0 ? C.gold : 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: count > 0 ? C.gold : 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}>
              {q.isLoading ? <ActivityIndicator size="small" color={C.gold} /> : <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: count > 0 ? '#1a1206' : C.muted2 }}>{count}</Text>}
            </View>
          </View>

          {q.isError ? <Body style={{ fontSize: 11.5, color: C.red }}>Couldn't load ({(q.error as Error).message}).</Body> : null}

          {/* One row per overdue client */}
          {shown.map((r, i) => {
            const col = r.proposal ? C.green : r.daysSince >= 60 ? C.red : C.gold;
            return (
              <Pressable key={r.clientId} onPress={() => (r.proposal ? openThread(r.clientId) : setSel(r))} accessibilityRole="button"
                accessibilityLabel={r.proposal ? `${r.clientName}, slot already proposed, open the client thread` : `Propose a QHP slot for ${r.clientName}`}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 11, borderRadius: 13, backgroundColor: pressed ? hexA(col, 0.12) : 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: hexA(col, 0.22), borderLeftWidth: 3, borderLeftColor: col, opacity: r.proposal ? 0.85 : 1 })}>
                <Avatar initial={initialsOf(r.clientName)} size={36} colors={AVS[i % AVS.length]} fontSize={12} />
                <View style={{ flex: 1 }}>
                  <Body numberOfLines={1} style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{r.clientName}</Body>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
                    <Mono style={{ fontSize: 9, color: r.proposal ? C.muted3 : col }}>{r.daysSince} DAYS</Mono>
                    <Mono style={{ fontSize: 9, color: C.muted3 }}>· LAST QHP {fmtLast(r.lastQhpDate).toUpperCase()}</Mono>
                    {r.crmName ? (
                      <View style={{ paddingVertical: 1, paddingHorizontal: 6, borderRadius: 999, backgroundColor: hexA(C.purple, 0.12), borderWidth: 1, borderColor: hexA(C.purple, 0.32) }}>
                        <Mono style={{ fontSize: 8, color: C.purple }}>CRM · {r.crmName.split(' ')[0].toUpperCase()}</Mono>
                      </View>
                    ) : <Mono style={{ fontSize: 8, color: C.muted3 }}>NO CRM</Mono>}
                  </View>
                  {r.proposal ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 5 }}>
                      <Icon name="checks" size={11} color={C.green} strokeWidth={2.6} />
                      <Mono numberOfLines={1} style={{ flex: 1, fontSize: 8.5, letterSpacing: 0.4, color: C.green }}>
                        PROPOSED {r.proposal.slot ? r.proposal.slot.toUpperCase() : fmtAt(r.proposal.at).toUpperCase()} · TAP TO OPEN THREAD
                      </Mono>
                    </View>
                  ) : null}
                </View>
                <Icon name="chevRight" size={14} color={col} strokeWidth={2.3} />
              </Pressable>
            );
          })}
          {rows.length > 5 ? (
            <Pressable onPress={() => setShowAll((v) => !v)} hitSlop={10} style={{ alignSelf: 'center', paddingVertical: 6, paddingHorizontal: 12 }}>
              <Mono style={{ fontSize: 9.5, letterSpacing: 0.6, color: C.gold }}>{showAll ? 'SHOW FEWER' : `SHOW ALL ${rows.length}`}</Mono>
            </Pressable>
          ) : null}
        </View>
      </Card>

      <QhpRefreshRequestSheet row={sel} onClose={() => setSel(null)} onSent={onSent} />
    </>
  );
}

/* ---------- Propose-a-slot sheet ----------
   Scrollable strips: 14 dates, hours 6 AM to 9 PM, minutes in 15-minute steps.
   Every strip scrolls its selection into view on open. Free-text note, live
   preview, Send. Sends into the client's thread (opened on demand) with the CRM
   @-tagged. A client already proposed opens its thread from the card instead. */
const HOURS24 = Array.from({ length: 16 }, (_, i) => 6 + i); // 6 .. 21
const MINS = [0, 15, 30, 45];
const hourLabel = (h: number) => `${((h + 11) % 12) + 1} ${h >= 12 ? 'PM' : 'AM'}`;
const CHIP_W = 62, CHIP_GAP = 8;

function QhpRefreshRequestSheet({ row, onClose, onSent }: { row: QhpRefreshRow | null; onClose: () => void; onSent: (row: QhpRefreshRow, slotText: string) => void }) {
  const insets = useSafeAreaInsets();
  const kbH = useKeyboardHeight();
  const { go } = useStore();
  const { session, dbRole } = useAuth();
  const meId = session?.user?.id ?? null;
  const openM = useOpenClientThread();
  const sendM = useSendClientThreadMessage(meId, 'You', dbRole);
  const [date, setDate] = React.useState<string | null>(null);
  const [hour, setHour] = React.useState(9);   // 24h
  const [minute, setMinute] = React.useState(0);
  const [note, setNote] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const dateRef = React.useRef<ScrollView>(null);
  const hourRef = React.useRef<ScrollView>(null);
  const visible = !!row;

  const days = React.useMemo(() => Array.from({ length: 14 }, (_, i) => {
    const d = new Date(Date.now() + i * 86_400_000);
    return {
      iso: istDate(d),
      dow: d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short' }).toUpperCase(),
      day: d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric' }),
      mon: d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', month: 'short' }).toUpperCase(),
      tag: i === 0 ? 'TODAY' : i === 1 ? 'TMRW' : null,
    };
  }), [visible]);

  React.useEffect(() => {
    if (!visible) return;
    setDate(days[1]?.iso ?? null); setHour(9); setMinute(0); setNote(''); setBusy(false);
    // Bring the defaults into view once the strips have laid out.
    const t = setTimeout(() => {
      dateRef.current?.scrollTo({ x: 0, animated: false });
      hourRef.current?.scrollTo({ x: Math.max(0, (HOURS24.indexOf(9) - 1) * (CHIP_W + CHIP_GAP)), animated: false });
    }, 60);
    return () => clearTimeout(t);
  }, [visible]);

  const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  const canSend = !!row && !!date && !!meId && !busy;
  const preview = row && date ? buildQhpRefreshMessage(row, { date, time }, note) : '';

  const send = async () => {
    if (!row || !date || !canSend) return;
    setBusy(true);
    try {
      const threadId = await openM.mutateAsync(row.clientId);
      await sendM.mutateAsync({ threadId, body: buildQhpRefreshMessage(row, { date, time }, note) });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onSent(row, fmtProposedSlot({ date, time }));
      const clientId = row.clientId;
      onClose();
      Alert.alert('Sent to the client thread', `${row.crmName ? `${row.crmName} is tagged` : 'The thread team is notified'} with your proposed slot for ${row.clientName}. The client now shows as proposed until the CRM schedules the QHP.`, [
        { text: 'Open thread', onPress: () => { pendingThreadClientRef.current = clientId; go('client-threads'); } },
        { text: 'Done', style: 'cancel' },
      ]);
    } catch (e: any) {
      Alert.alert("Couldn't send", e?.message ?? 'Try again.');
    } finally { setBusy(false); }
  };

  const label = (t: string) => <Mono style={{ fontSize: 9, letterSpacing: 0.8, color: C.muted3, marginBottom: 7 }}>{t}</Mono>;
  const chip = (on: boolean, col: string) => ({ width: CHIP_W, alignItems: 'center' as const, paddingVertical: 9, borderRadius: 13, backgroundColor: on ? hexA(col, 0.14) : 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: on ? hexA(col, 0.45) : 'rgba(255,255,255,0.08)' });

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => !busy && onClose()}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable onPress={() => !busy && onClose()} accessibilityRole="button" accessibilityLabel="Close" importantForAccessibility="no-hide-descendants"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.62)' }} />
        <View accessibilityViewIsModal style={{ maxHeight: '90%', backgroundColor: C.sheetBg, borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: hexA(C.gold, 0.2), paddingHorizontal: 18, paddingTop: 14, paddingBottom: 14 + insets.bottom + kbH }}>
          <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 12 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 4 }}>
            <View style={{ flex: 1 }}>
              <Serif style={{ fontSize: 19 }}>Propose a QHP slot</Serif>
              <Body numberOfLines={1} style={{ fontSize: 11.5, color: C.muted2, marginTop: 2 }}>
                {row?.clientName} · last QHP {row ? fmtLast(row.lastQhpDate) : ''} · {row?.daysSince} days ago
              </Body>
            </View>
            <Pressable onPress={() => !busy && onClose()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close"
              style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)' }}>
              <Icon name="close" size={14} color={C.muted} strokeWidth={2.2} />
            </Pressable>
          </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 }}>
              <Icon name="atSign" size={12} color={C.purple} strokeWidth={2.2} />
              <Body style={{ flex: 1, fontSize: 11, color: C.muted2 }}>
                {row?.crmName ? `Posts to ${row.clientName}'s thread and tags ${row.crmName} (CRM).` : `No CRM is assigned to ${row?.clientName ?? 'this client'} yet. The thread's standing members are notified instead.`}
              </Body>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 14, paddingBottom: 8 }}>
              <View>
                {label('QHP DATE · SWIPE FOR MORE')}
                <ScrollView ref={dateRef} keyboardShouldPersistTaps="handled" horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: CHIP_GAP, paddingBottom: 4 }}>
                  {days.map((d) => {
                    const on = date === d.iso;
                    return (
                      <Pressable key={d.iso} onPress={() => setDate(d.iso)} accessibilityRole="button" accessibilityState={{ selected: on }} style={chip(on, C.gold)}>
                        <Mono style={{ fontSize: 8.5, letterSpacing: 0.8, color: on ? C.gold : C.muted3 }}>{d.tag ?? d.dow}</Mono>
                        <Serif style={{ fontSize: 19, color: on ? C.gold : C.ink, marginTop: 2 }}>{d.day}</Serif>
                        <Mono style={{ fontSize: 8.5, color: on ? hexA(C.gold, 0.8) : C.faint }}>{d.mon}</Mono>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>

              <View>
                {label('HOUR · SWIPE FOR MORE')}
                <ScrollView ref={hourRef} keyboardShouldPersistTaps="handled" horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: CHIP_GAP, paddingBottom: 4 }}>
                  {HOURS24.map((h) => {
                    const on = hour === h;
                    return (
                      <Pressable key={h} onPress={() => setHour(h)} accessibilityRole="button" accessibilityState={{ selected: on }} style={[chip(on, C.gold), { paddingVertical: 11 }]}>
                        <Serif style={{ fontSize: 17, color: on ? C.gold : C.ink }}>{((h + 11) % 12) + 1}</Serif>
                        <Mono style={{ fontSize: 8, letterSpacing: 0.6, color: on ? hexA(C.gold, 0.8) : C.muted3, marginTop: 1 }}>{h >= 12 ? 'PM' : 'AM'}</Mono>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>

              <View>
                {label('MINUTES')}
                <View style={{ flexDirection: 'row', gap: CHIP_GAP }}>
                  {MINS.map((m) => {
                    const on = minute === m;
                    return (
                      <Pressable key={m} onPress={() => setMinute(m)} accessibilityRole="button" accessibilityState={{ selected: on }} style={[chip(on, C.gold), { flex: 1, width: undefined, paddingVertical: 11 }]}>
                        <Serif style={{ fontSize: 17, color: on ? C.gold : C.ink }}>:{String(m).padStart(2, '0')}</Serif>
                      </Pressable>
                    );
                  })}
                </View>
                <Body style={{ fontSize: 11, color: C.muted2, marginTop: 7, textAlign: 'center' }}>
                  {date ? fmtProposedSlot({ date, time }) : `${hourLabel(hour)} · pick a date`}
                </Body>
              </View>

              <View>
                {label('NOTE FOR THE CRM')}
                <TextInput value={note} onChangeText={setNote} multiline placeholder="Anything the CRM should know: client availability, location, what changed…" placeholderTextColor={C.muted3}
                  accessibilityLabel="Note for the CRM"
                  style={{ minHeight: 84, textAlignVertical: 'top', paddingVertical: 11, paddingHorizontal: 13, borderRadius: 13, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.03)', color: '#fff', fontFamily: F.body, fontSize: 13.5 }} />
              </View>

              {preview ? (
                <View style={{ padding: 11, borderRadius: 13, backgroundColor: hexA(C.purple, 0.06), borderWidth: 1, borderColor: hexA(C.purple, 0.22) }}>
                  {label('MESSAGE PREVIEW')}
                  <Body style={{ fontSize: 12, color: C.ink3, lineHeight: 18 }}>{preview}</Body>
                </View>
              ) : null}
            </ScrollView>

            <Pressable onPress={send} disabled={!canSend} accessibilityRole="button" accessibilityLabel="Send to the client thread"
              style={{ marginTop: 12, borderRadius: 13, overflow: 'hidden', opacity: canSend ? 1 : 0.5 }}>
              <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 13 }}>
                {busy ? <ActivityIndicator size="small" color="#fff" /> : <Icon name="send" size={15} color="#fff" strokeWidth={2.3} />}
                <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: '#fff' }}>{busy ? 'Sending…' : 'Send to client thread'}</Text>
              </LinearGradient>
            </Pressable>
        </View>
      </View>
    </Modal>
  );
}
