import React from 'react';
import { View, Text, Pressable, ScrollView, Modal, StyleSheet, TextInput, Animated, PanResponder, Easing } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, F, hexA, ORANGE_GRAD } from '../theme';
import { Icon } from '../icons';
import { useStore } from '../store';
import { useAuth } from '../auth';
import { DEV_TRAINER_ID } from '../lib/supabase';
import { useAckSessions, istTimeParts } from '../lib/trainerQueries';
import { Serif, Mono, Body, GradientButton, ProgressBar, IconChip } from './primitives';
import { apprItems, bloodRows } from '../data';

function SheetShell({
  visible,
  onClose,
  children,
  maxHeightPct = 82,
  fixedHeight = false,
}: {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  maxHeightPct?: number;
  fixedHeight?: boolean;
}) {
  const insets = useSafeAreaInsets();
  // fixedHeight gives the sheet a definite height so inner ScrollViews can
  // actually scroll (with maxHeight alone they get clipped, not scrollable).
  const sizeStyle = fixedHeight ? { height: `${maxHeightPct}%` as const } : { maxHeight: `${maxHeightPct}%` as const };

  // Swipe-down-to-dismiss. Pan lives on the grabber/header zone only, so inner
  // ScrollViews still scroll; dragging the handle down past a threshold closes.
  const translateY = React.useRef(new Animated.Value(0)).current;
  const closeRef = React.useRef(onClose);
  closeRef.current = onClose;
  React.useEffect(() => { if (visible) translateY.setValue(0); }, [visible]);
  const pan = React.useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => g.dy > 4 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_e, g) => { if (g.dy > 0) translateY.setValue(g.dy); },
      onPanResponderRelease: (_e, g) => {
        if (g.dy > 110 || g.vy > 0.6) {
          Animated.timing(translateY, { toValue: 800, duration: 180, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() => closeRef.current());
        } else {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 4, speed: 18 }).start();
        }
      },
    })
  ).current;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Backdrop is a SIBLING (absolute) so the sheet content is never wrapped in a
          Pressable — a ScrollView nested inside a Pressable loses scroll gestures on Android. */}
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable onPress={onClose} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)' }} />
        <Animated.View style={[styles.sheet, sizeStyle, { paddingBottom: insets.bottom + 20, transform: [{ translateY }] }]}>
          {/* Drag zone — enlarged tap/drag target around the grabber. */}
          <View {...pan.panHandlers} style={{ alignItems: 'center', paddingVertical: 8, marginTop: -6, marginBottom: 8 }}>
            <View style={[styles.grabber, { marginBottom: 0 }]} />
          </View>
          <View style={{ flex: fixedHeight ? 1 : undefined }}>
            {children}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

/* ---------- Acknowledge sessions (live data, mirrors the web dialog) ---------- */
export function AckSheet() {
  const { sheet, closeSheet } = useStore();
  const open = sheet === 'ack';
  // Same trainer-id resolution as the dashboard (dev fallback only for the shared test account).
  const { session } = useAuth();
  const isTestAccount = session?.user?.email?.startsWith('rn-test-trainer');
  const trainerId = !session ? '' : isTestAccount ? DEV_TRAINER_ID : session.user.id;
  const ackQ = useAckSessions(trainerId, open);

  const [search, setSearch] = React.useState('');
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (open) { setSearch(''); setSelectedId(null); }
  }, [open]);

  const rows = ackQ.data ?? [];
  const q = search.trim().toLowerCase();
  const filtered = q ? rows.filter((r) => r.client_name.toLowerCase().includes(q)) : rows;
  const totSum = rows.reduce((s, r) => s + r.total, 0);
  const ackSum = rows.reduce((s, r) => s + r.acked, 0);
  const overallPct = totSum ? Math.round((ackSum / totSum) * 100) : 0;
  const selected = selectedId ? rows.find((r) => r.client_id === selectedId) ?? null : null;
  const pctColor = (pct: number) => (pct >= 67 ? C.green : pct >= 34 ? C.gold : C.red);

  const fmtDay = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : '—';

  return (
    <SheetShell visible={open} onClose={closeSheet} fixedHeight>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 13, marginBottom: 16 }}>
        <View style={styles.ring}>
          <View style={styles.ringInner}>
            <Text style={{ fontFamily: F.mono, fontSize: 13, color: '#fff' }}>{ackQ.isLoading ? '…' : `${selected ? selected.pct : overallPct}%`}</Text>
          </View>
        </View>
        <View style={{ flex: 1 }}>
          <Serif style={{ fontSize: 20 }} numberOfLines={1}>{selected ? selected.client_name : 'Acknowledgements'}</Serif>
          <Body style={{ fontSize: 12.5, color: C.muted, marginTop: 1 }}>
            <Text style={{ fontFamily: F.mono, color: C.orange }}>
              {selected ? `${selected.acked} / ${selected.total}` : `${ackSum} / ${totSum}`}
            </Text>{' '}
            sessions acknowledged{selected ? '' : ' · since 1 May'}
          </Body>
          {selected?.trainers?.length ? (
            <Body style={{ fontSize: 10.5, color: C.muted3, marginTop: 1, lineHeight: 15 }}>Trainer: {selected.trainers.join(', ')}</Body>
          ) : null}
        </View>
        <Pressable onPress={closeSheet} style={styles.closeBtn}><Icon name="close" size={15} color="#B8B2AC" strokeWidth={2.3} /></Pressable>
      </View>

      {!selected ? (
        <>
          <View style={styles.searchBar}>
            <Icon name="search" size={17} color={C.muted3} strokeWidth={2} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search client…"
              placeholderTextColor={C.muted3}
              autoCorrect={false}
              style={{ flex: 1, fontFamily: F.body, fontSize: 14, color: '#fff', padding: 0 }}
            />
            {search ? (
              <Pressable onPress={() => setSearch('')} hitSlop={8}><Icon name="close" size={13} color={C.muted3} strokeWidth={2.2} /></Pressable>
            ) : null}
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 11, paddingTop: 14 }} showsVerticalScrollIndicator keyboardShouldPersistTaps="handled">
            {ackQ.isLoading ? (
              <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 26 }}>Loading acknowledgements…</Body>
            ) : ackQ.isError ? (
              <Body style={{ fontSize: 12.5, color: C.red, textAlign: 'center', paddingVertical: 26 }}>Couldn't load ({(ackQ.error as Error).message}).</Body>
            ) : filtered.length === 0 ? (
              <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 26 }}>{q ? 'No clients match your search.' : 'No active clients found.'}</Body>
            ) : (
              filtered.map((r) => {
                const c = pctColor(r.pct);
                return (
                  <Pressable key={r.client_id} onPress={() => setSelectedId(r.client_id)} style={styles.ackRow}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                      <View style={{ flex: 1 }}>
                        <Body style={{ fontSize: 14.5, fontFamily: F.bodySemi }}>{r.client_name}</Body>
                        <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 1 }}>{r.acked} of {r.total} sessions</Body>
                        {r.trainers?.length ? (
                          <Body style={{ fontSize: 10.5, color: C.muted3, marginTop: 1, lineHeight: 15 }}>Trainer: <Body style={{ fontSize: 10.5, color: C.ink3 }}>{r.trainers.join(', ')}</Body></Body>
                        ) : null}
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <View style={{ paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999, backgroundColor: hexA(c, 0.14) }}>
                          <Text style={{ fontFamily: F.mono, fontSize: 11, color: c }}>{r.pct}%</Text>
                        </View>
                        <Icon name="chevRight" size={14} color={C.muted3} strokeWidth={2.2} />
                      </View>
                    </View>
                    <ProgressBar pct={r.pct} height={5} fill={c} />
                  </Pressable>
                );
              })
            )}
          </ScrollView>
        </>
      ) : (
        <>
          <Pressable onPress={() => setSelectedId(null)} style={{ flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 4 }}>
            <Icon name="arrowLeft" size={14} color={C.ink2} strokeWidth={2.2} />
            <Body style={{ fontSize: 13, fontFamily: F.bodySemi }}>All clients</Body>
          </Pressable>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 9, paddingTop: 12 }} showsVerticalScrollIndicator>
            {selected.sessions.length === 0 ? (
              <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 26 }}>No sessions since 1 May.</Body>
            ) : (
              selected.sessions.map((s) => {
                const tp = s.scheduled_at ? istTimeParts(s.scheduled_at) : null;
                return (
                  <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 13, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: s.acknowledged ? hexA(C.green, 0.22) : 'rgba(255,255,255,0.07)' }}>
                    <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: s.acknowledged ? hexA(C.green, 0.14) : 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' }}>
                      <Icon path={s.acknowledged ? 'M20 6 9 17l-5-5' : 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z'} size={13} color={s.acknowledged ? C.green : C.muted3} strokeWidth={2.4} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Body style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{fmtDay(s.scheduled_at)}</Body>
                      {tp ? <Mono style={{ fontSize: 10, color: C.muted3, marginTop: 1 }}>{tp.time} {tp.ampm}</Mono> : null}
                    </View>
                    <View style={{ paddingVertical: 3, paddingHorizontal: 9, borderRadius: 999, backgroundColor: hexA(s.acknowledged ? C.green : C.gold, 0.13), borderWidth: 1, borderColor: hexA(s.acknowledged ? C.green : C.gold, 0.3) }}>
                      <Text style={{ fontFamily: F.bodySemi, fontSize: 10.5, color: s.acknowledged ? C.green : C.gold }}>{s.acknowledged ? 'Acknowledged' : 'Pending'}</Text>
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>
        </>
      )}
    </SheetShell>
  );
}

/* ---------- Emergency leave ---------- */
export function LeaveSheet() {
  const { sheet, closeSheet } = useStore();
  return (
    <SheetShell visible={sheet === 'leave'} onClose={closeSheet} maxHeightPct={90}>
      <ScrollView>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 }}>
          <IconChip icon="alert" color={C.red} iconSize={21} />
          <View style={{ flex: 1 }}>
            <Serif style={{ fontSize: 20 }}>Emergency Leave</Serif>
            <Body style={{ fontSize: 12.5, color: C.muted, marginTop: 1 }}>Submit a leave request</Body>
          </View>
          <Pressable onPress={closeSheet} style={styles.closeBtn}><Icon name="close" size={15} color="#B8B2AC" strokeWidth={2.3} /></Pressable>
        </View>
        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
          {[['START', 'Today · 09:00'], ['END', 'Today · 18:00']].map(([l, v]) => (
            <View key={l} style={{ flex: 1 }}>
              <Mono style={{ fontSize: 10, letterSpacing: 1.2, color: C.mono2, marginBottom: 7 }}>{l}</Mono>
              <View style={styles.field}>
                <Icon name="calendar" size={15} color={C.orange} strokeWidth={2} />
                <Body style={{ fontSize: 13.5 }}>{v}</Body>
              </View>
            </View>
          ))}
        </View>
        <Mono style={{ fontSize: 10, letterSpacing: 1.2, color: C.mono2, marginBottom: 8 }}>QUICK PICK</Mono>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
          {['Half day', 'Full day', '2 days'].map((p, i) => (
            <View key={p} style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: i === 0 ? hexA(C.orange, 0.13) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: i === 0 ? hexA(C.orange, 0.3) : 'rgba(255,255,255,0.07)' }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: i === 0 ? C.orange : C.muted }}>{p}</Text>
            </View>
          ))}
        </View>
        <Mono style={{ fontSize: 10, letterSpacing: 1.2, color: C.mono2, marginBottom: 8 }}>REASON</Mono>
        <View style={[styles.field, { minHeight: 76, alignItems: 'flex-start', paddingTop: 13 }]}>
          <Body style={{ fontSize: 13.5, color: C.muted3 }}>Enter reason for emergency leave…</Body>
        </View>
        <GradientButton label="Submit Leave Request" onPress={closeSheet} style={{ marginTop: 18 }} />
      </ScrollView>
    </SheetShell>
  );
}

/* ---------- Schedule QHP ---------- */
export function ScheduleSheet() {
  const { sheet, closeSheet } = useStore();
  const rows: { icon: any; label: string; value: string; color: string }[] = [
    { icon: 'user', label: 'CLIENT', value: 'Sana Kapoor', color: C.blue },
    { icon: 'calendar', label: 'DATE & TIME', value: 'Wed 2 Jul · 11:00 AM', color: C.orange },
    { icon: 'target', label: 'TYPE', value: 'Full QHP · Coral Gym', color: C.green },
  ];
  return (
    <SheetShell visible={sheet === 'schedule'} onClose={closeSheet} maxHeightPct={70}>
      <Serif style={{ fontSize: 22, marginBottom: 16 }}>Schedule QHP</Serif>
      <View style={{ gap: 10, marginBottom: 18 }}>
        {rows.map((r) => (
          <View key={r.label} style={styles.scheduleRow}>
            <Icon name={r.icon} size={17} color={r.color} strokeWidth={2} />
            <View style={{ flex: 1 }}>
              <Mono style={{ fontSize: 10, color: C.muted3, letterSpacing: 0.8 }}>{r.label}</Mono>
              <Body style={{ fontSize: 14.5, fontFamily: F.bodySemi, color: '#fff' }}>{r.value}</Body>
            </View>
          </View>
        ))}
      </View>
      <GradientButton label="Confirm Schedule" onPress={closeSheet} />
    </SheetShell>
  );
}

/* ---------- CRM dialogs ---------- */
export function CrmDialogs() {
  const { crmDialog, setDialog, approve, reject } = useStore();
  if (!crmDialog) return null;
  const close = () => setDialog(null);

  let body: React.ReactNode = null;
  if (crmDialog.kind === 'approve' || crmDialog.kind === 'reject') {
    const isApprove = crmDialog.kind === 'approve';
    body = (
      <>
        <Serif style={{ fontSize: 20, marginBottom: 6 }}>{isApprove ? 'Approve Session' : 'Reject Session'}</Serif>
        <Body style={{ fontSize: 13, color: C.muted, marginBottom: 14 }}>Please provide a remark for this {isApprove ? 'approval' : 'rejection'}.</Body>
        <Mono style={{ fontSize: 10, letterSpacing: 1.2, color: C.mono2, marginBottom: 7 }}>REMARK *</Mono>
        <View style={styles.dialogField}>
          <Body style={{ fontSize: 13, color: C.muted3 }}>{isApprove ? 'Approved — forwarding to admin.' : 'Rejected — parked for review.'}</Body>
        </View>
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
          <Pressable onPress={close} style={styles.cancelBtn}><Text style={styles.cancelText}>Cancel</Text></Pressable>
          <Pressable onPress={() => (isApprove ? approve(crmDialog.id) : reject(crmDialog.id))} style={[styles.confirmBtn, { backgroundColor: isApprove ? C.green : C.red }]}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: isApprove ? '#06231A' : '#2A0E08' }}>{isApprove ? 'Approve' : 'Reject'}</Text>
          </Pressable>
        </View>
      </>
    );
  } else if (crmDialog.kind === 'cta') {
    body = (
      <>
        <Serif style={{ fontSize: 20, marginBottom: 14 }}>Add CTA target</Serif>
        <Mono style={{ fontSize: 10, letterSpacing: 1.2, color: C.mono2, marginBottom: 7 }}>TARGET TYPE</Mono>
        <View style={{ flexDirection: 'row', gap: 7, marginBottom: 14 }}>
          {['Package', 'Subscription', 'Service'].map((t, i) => (
            <View key={t} style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10, backgroundColor: i === 0 ? hexA(C.orange, 0.13) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: i === 0 ? hexA(C.orange, 0.3) : 'rgba(255,255,255,0.07)' }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: i === 0 ? C.orange : C.muted }}>{t}</Text>
            </View>
          ))}
        </View>
        <Mono style={{ fontSize: 10, letterSpacing: 1.2, color: C.mono2, marginBottom: 7 }}>EXPECTED CLOSE</Mono>
        <View style={styles.dialogField}><Body style={{ fontSize: 13 }}>11 Jul 2026</Body></View>
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
          <Pressable onPress={close} style={styles.cancelBtn}><Text style={styles.cancelText}>Cancel</Text></Pressable>
          <View style={{ flex: 1 }}><GradientButton label="Add target" onPress={close} /></View>
        </View>
      </>
    );
  } else if (crmDialog.kind === 'markers') {
    const data = bloodRows[crmDialog.i];
    body = (
      <>
        <Serif style={{ fontSize: 19, marginBottom: 3 }}>Abnormal Markers — {data.name}</Serif>
        <Mono style={{ fontSize: 11.5, color: C.muted2, marginBottom: 16 }}>Last test: {data.last}</Mono>
        <View style={{ gap: 10, marginBottom: 16 }}>
          {data.markers.map((m) => (
            <View key={m.m} style={styles.markerRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <Body style={{ fontSize: 14, fontFamily: F.bodySemi }}>{m.m}</Body>
                <View style={{ paddingVertical: 3, paddingHorizontal: 9, borderRadius: 7, backgroundColor: hexA(m.c, 0.14) }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 10, color: m.c }}>{m.sev}</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 12, color: C.muted2, fontFamily: F.body }}>Value <Text style={{ fontFamily: F.mono, color: C.ink }}>{m.val}</Text></Text>
                <Text style={{ fontSize: 12, color: C.muted2, fontFamily: F.body }}>Ref <Text style={{ fontFamily: F.mono, color: C.ink }}>{m.ref}</Text></Text>
              </View>
            </View>
          ))}
        </View>
        <Pressable onPress={close} style={[styles.cancelBtn, { width: '100%' }]}><Text style={styles.cancelText}>Close</Text></Pressable>
      </>
    );
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      <Pressable onPress={close} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center', padding: 22 }}>
        <Pressable onPress={() => {}} style={styles.dialog}>{body}</Pressable>
      </Pressable>
    </Modal>
  );
}

export function Overlays() {
  return (
    <>
      <AckSheet />
      <LeaveSheet />
      <ScheduleSheet />
      <CrmDialogs />
    </>
  );
}

const styles = StyleSheet.create({
  sheet: { backgroundColor: C.sheetBg, borderTopWidth: 1, borderTopColor: 'rgba(255,150,90,0.12)', borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 18, paddingTop: 14 },
  grabber: { width: 38, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 16 },
  closeBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 15, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' },
  ackRow: { backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', borderRadius: 15, padding: 13, paddingHorizontal: 15 },
  ring: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: C.orange },
  ringInner: { width: 42, height: 42, borderRadius: 21, backgroundColor: C.sheetBg, alignItems: 'center', justifyContent: 'center' },
  field: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 13, paddingHorizontal: 14, borderRadius: 13, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.03)' },
  scheduleRow: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 13, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  dialog: { width: '100%', maxWidth: 340, backgroundColor: C.panel, borderWidth: 1, borderColor: 'rgba(255,150,90,0.14)', borderRadius: 20, padding: 20 },
  dialogField: { minHeight: 50, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.03)', padding: 12 },
  cancelBtn: { flex: 1, alignItems: 'center', paddingVertical: 13, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.06)' },
  cancelText: { fontFamily: F.bodySemi, fontSize: 14, color: C.ink3 },
  confirmBtn: { flex: 1, alignItems: 'center', paddingVertical: 13, borderRadius: 12 },
  markerRow: { padding: 13, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
});
