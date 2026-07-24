import React from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator, Modal, ScrollView, Alert, Keyboard, Animated, Easing } from 'react-native';
import { C, F, hexA, ORANGE_GRAD } from '../theme';
import { LinearGradient } from 'expo-linear-gradient';
import { Icon, IconName } from '../icons';
import { Serif, Body, Mono, Card, Avatar } from '../components/primitives';
import { Page, TitleBlock, HScroll, Badge } from './common';
import { useAuth } from '../auth';
import { useStore } from '../store';
import {
  HEAD_DOCTOR_ID, ALLOWED_DOCTOR_IDS, useDoctorIdentity, usePhysioMetrics, useSeniorDashboard,
  useDoctorSessionDetails, usePendingProtocols, useApproveProtocol, useRejectProtocol,
  useProtocolExercises, useCreateProtocol, usePhysioProtocols, useDoctorAssignedClients,
  useDoctorClientSessionCounts, useAllClientsForDoctor, useHeadDoctorMonthSessions,
  useHeadDoctorDoctors, useBulkCreateRoster, useCancelRosterSession, useRescheduleRosterSession,
  useDeleteFutureRoster, formatDoctorSessionType, personName, DOCTOR_ROSTER_CREATE_MODALITIES,
  ProtocolExerciseInput, usePhysioDialogClients, useHeadDoctorClients, fetchRosterReplicatePrefill,
  useDoctorsRunRate, useDoctorTodayRoster, DoctorRosterRow, usePhysioSessionExercises,
} from '../lib/doctorQueries';

export { HEAD_DOCTOR_ID };
export { DoctorSessionsPage as DoctorSessions } from './doctorSessions';
import { LeaderboardPreview, DistanceSheet, MapPing, approxTravel } from './trainer';
import { PhysioSessionSheet } from './doctorSessions';
import { FeatureTour, DOCTOR_TOUR, TourLauncher } from '../components/featureTour';
import * as Location from 'expo-location';
import { useTrainerLeaderboard, istTimeParts } from '../lib/trainerQueries';

/* ============ DOCTOR WORKSPACE (web /doctor/* port, obsidian/ember UI) ============ */

export function useIsHeadDoctor(): boolean {
  const { session } = useAuth();
  return session?.user?.id === HEAD_DOCTOR_ID;
}

const AV_GRADS: [string, string][] = [['#FB8B3A', '#EE5E16'], ['#57C98A', '#2E9A63'], ['#7C8FE8', '#4A5AC8'], ['#9A7BEA', '#6E5BD0'], ['#E0A53C', '#C07C1E'], ['#4FD1C5', '#2C8A86'], ['#F687B3', '#C2568A'], ['#F0883E', '#C05621']];
const avColors = (s: string): [string, string] => AV_GRADS[[...(s || '?')].reduce((a, c) => a + c.charCodeAt(0), 0) % AV_GRADS.length];
const monthLabel = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
const fmtDayShort = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' });
const fmtAt = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
const inputStyle = { paddingVertical: 11, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.03)', color: '#fff', fontFamily: F.body, fontSize: 13.5 } as const;

/* ---------- Dashboard animations ---------- */
function FadeInUp({ delay = 0, children, style }: { delay?: number; children: React.ReactNode; style?: any }) {
  const v = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: 460, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, []);
  return (
    <Animated.View style={[{ opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }] }, style]}>
      {children}
    </Animated.View>
  );
}

function CountUpText({ value, style }: { value: number; style?: any }) {
  const [shown, setShown] = React.useState(0);
  const anim = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    anim.setValue(0);
    const id = anim.addListener(({ value: p }) => setShown(Math.round(p * value)));
    Animated.timing(anim, { toValue: 1, duration: 750, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start(() => setShown(value));
    return () => anim.removeListener(id);
  }, [value]);
  return <Serif style={style}>{shown}</Serif>;
}

function GrowBar({ pct, color, delay = 0 }: { pct: number; color: string; delay?: number }) {
  const v = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    Animated.timing(v, { toValue: Math.max(0.02, Math.min(1, pct)), duration: 680, delay, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [pct]);
  return (
    <View style={{ height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
      <Animated.View style={{ height: '100%', borderRadius: 2, backgroundColor: color, width: v.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }} />
    </View>
  );
}

function PulseGlow({ children }: { children: React.ReactNode }) {
  const v = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, []);
  return (
    <Animated.View style={{ transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.09] }) }] }}>
      {children}
    </Animated.View>
  );
}

function HodGate({ children }: { children: React.ReactNode }) {
  const isHead = useIsHeadDoctor();
  if (!isHead) {
    return (
      <Page gap={14} pt={6}>
        <TitleBlock title="Access Restricted" sub="Head Doctor only" />
        <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border={hexA(C.red, 0.2)} radius={18} style={{ padding: 22, alignItems: 'center', gap: 9 }}>
          <Icon name="shield" size={24} color={C.red} strokeWidth={1.8} />
          <Body style={{ fontSize: 12.5, color: C.muted2, textAlign: 'center' }}>This page is only available to the Head Doctor.</Body>
        </Card>
      </Page>
    );
  }
  return <>{children}</>;
}

/* ============ DASHBOARD ============ */
/* ============ Full session detail sheet (HOD breakdown → tap a session) ============
   Parses the structured physio notes ("Category: X", "--- Modality ---" sections,
   "Key: value" lines) into styled cards, and loads the session's
   physio_session_exercises (grouped per exercise with set chips). */
function parseSessionNotes(notes: string | null): { title: string; rows: { k: string | null; v: string }[] }[] {
  if (!notes?.trim()) return [];
  const sections: { title: string; rows: { k: string | null; v: string }[] }[] = [{ title: 'Session', rows: [] }];
  notes.split(/\r?\n/).forEach((raw) => {
    const line = raw.trim();
    if (!line) return;
    const sec = line.match(/^-{2,}\s*(.+?)\s*-{2,}$/);
    if (sec) { sections.push({ title: sec[1], rows: [] }); return; }
    const kv = line.match(/^([A-Za-z][A-Za-z0-9 /()%&+-]{1,40}):\s*(.*)$/);
    const target = sections[sections.length - 1];
    if (kv && kv[2]) target.rows.push({ k: kv[1], v: kv[2] });
    else target.rows.push({ k: null, v: line });
  });
  return sections.filter((s) => s.rows.length);
}

function DoctorSessionDetailSheet({ session, onClose }: { session: any | null; onClose: () => void }) {
  const exQ = usePhysioSessionExercises(session?.id ?? null, !!session);
  if (!session) return null;
  const sections = parseSessionNotes(session.notes);
  const rows = (exQ.data ?? []) as any[];
  // Group per-set rows into exercises.
  const exGroups: { name: string; sets: any[] }[] = [];
  const idx = new Map<string, { name: string; sets: any[] }>();
  rows.forEach((r) => {
    const key = (r.exercise_name || 'Exercise').trim();
    let g = idx.get(key);
    if (!g) { g = { name: key, sets: [] }; idx.set(key, g); exGroups.push(g); }
    g.sets.push(r);
  });
  const typeCol = /rehab/i.test(session.session_type ?? '') ? C.purple : C.blue;
  const when = new Date(session.scheduled_at);
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable onPress={onClose} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.65)' }} />
        <View style={{ maxHeight: '88%', backgroundColor: C.sheetBg, borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.14)', overflow: 'hidden' }}>
          {/* Gradient header */}
          <LinearGradient colors={['#241812', '#131010']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ paddingHorizontal: 18, paddingTop: 10, paddingBottom: 13, borderBottomWidth: 1, borderBottomColor: hexA(typeCol, 0.25) }}>
            <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.16)', marginBottom: 12 }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
              <View style={{ width: 40, height: 40, borderRadius: 14, backgroundColor: hexA(typeCol, 0.14), borderWidth: 1, borderColor: hexA(typeCol, 0.4), alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="activity" size={17} color={typeCol} strokeWidth={2} />
              </View>
              <View style={{ flex: 1 }}>
                <Serif numberOfLines={1} style={{ fontSize: 19 }}>{session.client_name ?? session.session_name ?? 'Session'}</Serif>
                <Mono style={{ fontSize: 8.5, letterSpacing: 0.6, color: C.muted3, marginTop: 2 }}>
                  {when.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: '2-digit', month: 'short' }).toUpperCase()} · {when.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase()}
                </Mono>
              </View>
              <Pressable onPress={onClose} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="close" size={14} color="#B8B2AC" strokeWidth={2.3} />
              </Pressable>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
              <Badge text={formatDoctorSessionType(session.session_type)} color={typeCol} />
              {session.cancelled ? <Badge text="Cancelled" color={C.red} /> : session.attendance_marked ? <Badge text="Attended" color={C.green} /> : <Badge text="Scheduled" color={C.gold} />}
              <Badge text={session.session_acknowledged_at ? 'Client Acknowledged' : 'Not Acknowledged'} color={session.session_acknowledged_at ? C.green : C.muted2} />
              {session.location ? <Badge text={session.location} color={C.muted2} /> : null}
            </View>
          </LinearGradient>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, gap: 11, paddingBottom: 30 }}>
            {/* Parsed structured notes */}
            {sections.length === 0 && !rows.length && !exQ.isLoading ? (
              <Body style={{ fontSize: 12, color: C.muted3, textAlign: 'center', paddingVertical: 18 }}>No detailed notes recorded for this session.</Body>
            ) : null}
            {sections.map((sec, si) => (
              <View key={si} style={{ borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: hexA(typeCol, 0.16), overflow: 'hidden' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, paddingHorizontal: 13, backgroundColor: hexA(typeCol, 0.07), borderBottomWidth: 1, borderBottomColor: hexA(typeCol, 0.14) }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: typeCol }} />
                  <Mono style={{ fontSize: 9.5, letterSpacing: 1, color: typeCol }}>{sec.title.toUpperCase()}</Mono>
                </View>
                <View style={{ padding: 12, gap: 7 }}>
                  {sec.rows.map((r, ri) => r.k ? (
                    <View key={ri} style={{ flexDirection: 'row', gap: 10 }}>
                      <Body style={{ width: 118, fontSize: 11, color: C.muted3 }}>{r.k}</Body>
                      <Body style={{ flex: 1, fontSize: 12.5, color: '#fff', lineHeight: 18 }}>{r.v}</Body>
                    </View>
                  ) : (
                    <Body key={ri} style={{ fontSize: 12, color: C.ink3, lineHeight: 18 }}>{r.v}</Body>
                  ))}
                </View>
              </View>
            ))}

            {/* Exercises performed */}
            {exQ.isLoading ? (
              <View style={{ paddingVertical: 14, alignItems: 'center' }}><ActivityIndicator color={typeCol} /></View>
            ) : exGroups.length ? (
              <View style={{ borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: hexA(C.green, 0.18), overflow: 'hidden' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, paddingHorizontal: 13, backgroundColor: hexA(C.green, 0.07), borderBottomWidth: 1, borderBottomColor: hexA(C.green, 0.14) }}>
                  <Icon name="dumbbell" size={12} color={C.green} strokeWidth={2.2} />
                  <Mono style={{ flex: 1, fontSize: 9.5, letterSpacing: 1, color: C.green }}>EXERCISES · {exGroups.length}</Mono>
                </View>
                <View style={{ padding: 12, gap: 10 }}>
                  {exGroups.map((g) => (
                    <View key={g.name} style={{ gap: 6 }}>
                      <Body style={{ fontSize: 13, fontFamily: F.bodySemi, color: '#fff' }}>{g.name}</Body>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                        {g.sets.map((st: any, i: number) => {
                          const bits = [
                            st.reps != null ? `${st.reps} reps` : null,
                            st.load != null && st.load !== '' ? `${st.load} kg` : null,
                            st.modality_duration ? `${st.modality_duration}` : null,
                            st.modality_frequency ? `${st.modality_frequency}` : null,
                          ].filter(Boolean).join(' · ');
                          return (
                            <View key={i} style={{ paddingVertical: 4, paddingHorizontal: 9, borderRadius: 999, backgroundColor: hexA(C.green, 0.08), borderWidth: 1, borderColor: hexA(C.green, 0.28) }}>
                              <Text style={{ fontFamily: F.bodySemi, fontSize: 10, color: C.ink3 }}>S{st.set_number ?? i + 1}{bits ? ` · ${bits}` : ''}</Text>
                            </View>
                          );
                        })}
                      </View>
                      {g.sets[0]?.notes ? <Body style={{ fontSize: 10.5, color: C.muted3, fontStyle: 'italic' }}>{g.sets[0].notes}</Body> : null}
                    </View>
                  ))}
                </View>
              </View>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/* ---------- Today's Roster (doctor's own — HOD-created) ----------
   Timeline-styled section: gradient summary header with day progress, staggered
   session cards with a status rail + NEXT highlight, the trainer-style distance
   strip, and Log Session / Cancel actions. */
const MODALITY_ICON = (m: string | null): IconName => {
  const t = (m ?? '').toLowerCase();
  if (t.includes('physio')) return 'activity';
  if (t.includes('red') || t.includes('rlt')) return 'heart';
  if (t.includes('neural') || t.includes('cognitive')) return 'sparkle';
  if (t.includes('nutrition')) return 'clipboard';
  return 'dumbbell';
};

function DoctorTodayRoster() {
  const { session } = useAuth();
  const uid = session?.user?.id ?? '';
  const rosterQ = useDoctorTodayRoster();
  const cancelM = useCancelRosterSession();
  const [logFor, setLogFor] = React.useState<{ clientId: string; clientName: string } | null>(null);
  const [distFor, setDistFor] = React.useState<DoctorRosterRow | null>(null);
  const [cancelFor, setCancelFor] = React.useState<DoctorRosterRow | null>(null);
  const [remark, setRemark] = React.useState('');

  // One silent device fix for the inline distance estimates (doctors may not have
  // granted location — never prompts here; the sheet asks on tap instead).
  const [devPos, setDevPos] = React.useState<{ lat: number; lng: number } | null>(null);
  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (!perm.granted) return;
        const pos = await new Promise<any>((resolve) => {
          const t = setTimeout(() => resolve(null), 12_000);
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
            .then((p) => { clearTimeout(t); resolve(p); })
            .catch(() => { clearTimeout(t); resolve(null); });
        });
        if (alive && pos) setDevPos({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      } catch { /* strip falls back to tap-for-route */ }
    })();
    return () => { alive = false; };
  }, []);

  const rows = rosterQ.data ?? [];
  const stOf = (r: DoctorRosterRow) => (r.status ?? 'scheduled').toLowerCase();
  const doneCount = rows.filter((r) => stOf(r) === 'completed').length;
  const cancelledCount = rows.filter((r) => stOf(r) === 'cancelled').length;
  const activeTotal = rows.length - cancelledCount;
  const upcoming = rows.filter((r) => stOf(r) !== 'cancelled' && stOf(r) !== 'completed');
  // The NEXT session = first non-done/cancelled at or after now, else the last pending one.
  const now = Date.now();
  const nextId = (upcoming.find((r) => new Date(r.scheduled_datetime).getTime() >= now - 30 * 60_000) ?? upcoming[0])?.id ?? null;
  const dayLabel = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: '2-digit', month: 'short' });

  const doCancel = async () => {
    if (!cancelFor) return;
    try {
      // canceled_by check constraint accepts only 'Client' | 'Trainer' — a uuid here is rejected by the DB
      await cancelM.mutateAsync({ session_id: cancelFor.id, canceled_by: 'Trainer', cancellation_remark: remark.trim() || 'Cancelled by doctor' });
      setCancelFor(null); setRemark('');
    } catch { /* error shown below */ }
  };

  return (
    <View style={{ gap: 11 }}>
      {/* Summary header */}
      <FadeInUp delay={40}>
        <Card colors={['rgba(58,34,20,0.55)', 'rgba(20,15,14,0.6)']} border={hexA(C.orange, 0.22)} radius={19} style={{ overflow: 'hidden' }}>
          <LinearGradient colors={[hexA(C.orange, 0.55), 'rgba(255,255,255,0.02)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 3 }} />
          <View style={{ padding: 14, gap: 11 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
              <View style={{ width: 38, height: 38, borderRadius: 13, backgroundColor: hexA(C.orange, 0.14), borderWidth: 1, borderColor: hexA(C.orange, 0.35), alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="calendar" size={17} color={C.orange} strokeWidth={2.1} />
              </View>
              <View style={{ flex: 1 }}>
                <Serif style={{ fontSize: 18 }}>Today's Roster</Serif>
                <Mono style={{ fontSize: 8, letterSpacing: 0.8, color: C.mono2, marginTop: 1 }}>{dayLabel.toUpperCase()}</Mono>
              </View>
              <View style={{ alignItems: 'center' }}>
                <Serif style={{ fontSize: 22, color: C.orange }}>{doneCount}<Text style={{ fontSize: 13, color: C.muted3 }}>/{activeTotal || 0}</Text></Serif>
                <Mono style={{ fontSize: 6.5, letterSpacing: 0.6, color: C.muted3 }}>DONE</Mono>
              </View>
            </View>
            {rows.length ? (
              <View style={{ gap: 7 }}>
                <GrowBar pct={activeTotal ? doneCount / activeTotal : 0} color={doneCount === activeTotal && activeTotal > 0 ? C.green : C.orange} delay={250} />
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  {([['Upcoming', upcoming.length, C.blue], ['Completed', doneCount, C.green], ['Cancelled', cancelledCount, C.red]] as const).map(([lab, n, col]) => (
                    <View key={lab} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4, paddingHorizontal: 9, borderRadius: 999, backgroundColor: hexA(col, n ? 0.1 : 0.04), borderWidth: 1, borderColor: hexA(col, n ? 0.32 : 0.1) }}>
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: n ? col : C.muted3 }} />
                      <Text style={{ fontFamily: F.bodySemi, fontSize: 9.5, color: n ? col : C.muted3 }}>{n} {lab}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}
          </View>
        </Card>
      </FadeInUp>

      {rosterQ.isPending ? (
        <View style={{ paddingVertical: 20, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View>
      ) : rosterQ.isError ? (
        <Body style={{ fontSize: 11.5, color: C.red, textAlign: 'center' }}>{(rosterQ.error as Error).message}</Body>
      ) : rows.length === 0 ? (
        <FadeInUp delay={110}>
          <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.09)" radius={17} style={{ padding: 22, alignItems: 'center', gap: 9 }}>
            <View style={{ width: 46, height: 46, borderRadius: 16, backgroundColor: hexA(C.blue, 0.1), borderWidth: 1, borderColor: hexA(C.blue, 0.25), alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="calendar" size={20} color={C.blue} strokeWidth={1.9} />
            </View>
            <Serif style={{ fontSize: 15 }}>A clear day</Serif>
            <Body style={{ fontSize: 11.5, color: C.muted3, textAlign: 'center' }}>No roster sessions scheduled for today.</Body>
          </Card>
        </FadeInUp>
      ) : rows.map((r, idx) => {
        const { time, ampm } = istTimeParts(r.scheduled_datetime);
        const st = stOf(r);
        const isCancelled = st === 'cancelled';
        const isCompleted = st === 'completed';
        const isNext = r.id === nextId;
        const stColor = isCancelled ? C.red : isCompleted ? C.green : isNext ? C.orange : st === 'confirmed' ? C.blue : C.gold;
        const est = devPos && r.home_lat != null && r.home_lng != null ? approxTravel(devPos, r.home_lat, r.home_lng) : null;
        return (
          <FadeInUp key={r.id} delay={120 + idx * 70}>
            <Card colors={isNext ? ['rgba(66,38,20,0.6)', 'rgba(22,16,14,0.65)'] : ['rgba(46,28,18,0.45)', 'rgba(18,14,14,0.5)']} border={hexA(stColor, isNext ? 0.4 : 0.16)} radius={17} style={{ overflow: 'hidden', opacity: isCancelled ? 0.7 : 1 }}>
              <View style={{ flexDirection: 'row' }}>
                {/* status rail */}
                <View style={{ width: 4, backgroundColor: hexA(stColor, isCancelled ? 0.4 : 0.85) }} />
                <View style={{ flex: 1, padding: 13, gap: 10 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
                    {/* time block */}
                    <View style={{ alignItems: 'center', minWidth: 56, paddingVertical: 7, paddingHorizontal: 6, borderRadius: 13, backgroundColor: hexA(stColor, 0.09), borderWidth: 1, borderColor: hexA(stColor, 0.25) }}>
                      <Serif style={{ fontSize: 17, color: isCancelled ? C.muted2 : '#fff' }}>{time}</Serif>
                      <Mono style={{ fontSize: 7.5, letterSpacing: 0.7, color: stColor }}>{ampm}</Mono>
                    </View>
                    <View style={{ flex: 1, gap: 5 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                        <Body numberOfLines={1} style={{ flex: 1, fontSize: 14.5, fontFamily: F.bodySemi, color: '#fff', textDecorationLine: isCancelled ? 'line-through' : 'none' }}>{r.client_name}</Body>
                        {isNext ? (
                          <PulseGlow>
                            <View style={{ paddingVertical: 3, paddingHorizontal: 9, borderRadius: 999, backgroundColor: hexA(C.orange, 0.18), borderWidth: 1, borderColor: hexA(C.orange, 0.55) }}>
                              <Text style={{ fontFamily: F.bodyBold, fontSize: 8.5, letterSpacing: 0.8, color: C.orange }}>NEXT</Text>
                            </View>
                          </PulseGlow>
                        ) : null}
                      </View>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                        {r.modality ? (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 3, paddingHorizontal: 9, borderRadius: 999, backgroundColor: hexA(C.blue, 0.1), borderWidth: 1, borderColor: hexA(C.blue, 0.3) }}>
                            <Icon name={MODALITY_ICON(r.modality)} size={10} color={C.blue} strokeWidth={2.2} />
                            <Text style={{ fontFamily: F.bodySemi, fontSize: 9.5, color: C.blue }}>{formatDoctorSessionType(r.modality)}</Text>
                          </View>
                        ) : null}
                        <View style={{ paddingVertical: 3, paddingHorizontal: 9, borderRadius: 999, backgroundColor: hexA(stColor, 0.1), borderWidth: 1, borderColor: hexA(stColor, 0.3) }}>
                          <Text style={{ fontFamily: F.bodySemi, fontSize: 9.5, color: stColor }}>{isCancelled ? 'Cancelled' : isCompleted ? 'Completed' : st === 'confirmed' ? 'Confirmed' : 'Scheduled'}</Text>
                        </View>
                      </View>
                    </View>
                  </View>

                  {/* Distance strip — captured home + device fix → instant estimate; tap for live route */}
                  {r.has_home_location && r.client_id && !isCancelled ? (
                    <Pressable onPress={() => setDistFor(r)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 11, borderRadius: 12, backgroundColor: hexA(C.blue, 0.06), borderWidth: 1, borderColor: hexA(C.blue, 0.26) }}>
                      <View style={{ width: 30, height: 30, alignItems: 'center', justifyContent: 'center' }}>
                        <MapPing color={C.blue} />
                        <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: hexA(C.blue, 0.14), borderWidth: 1, borderColor: hexA(C.blue, 0.42), alignItems: 'center', justifyContent: 'center' }}>
                          <Icon name="route" size={14} color={C.blue} strokeWidth={2.1} />
                        </View>
                      </View>
                      <View style={{ flex: 1 }}>
                        {est ? (
                          <>
                            <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: '#A9C6F0' }}>{est.km} km · ~{est.min} min drive</Text>
                            <Mono style={{ fontSize: 7.5, letterSpacing: 0.6, color: C.muted3, marginTop: 1 }}>FROM YOUR LOCATION · TAP FOR LIVE ROUTE</Mono>
                          </>
                        ) : (
                          <>
                            <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: '#A9C6F0' }}>Distance to client's home</Text>
                            <Mono style={{ fontSize: 7.5, letterSpacing: 0.6, color: C.muted3, marginTop: 1 }}>TAP FOR ROUTE & DRIVE TIME</Mono>
                          </>
                        )}
                      </View>
                      <Icon name="chevRight" size={14} color={C.blue} strokeWidth={2.3} />
                    </Pressable>
                  ) : null}

                  {/* Actions */}
                  {!isCancelled && !isCompleted ? (
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <Pressable onPress={() => setLogFor({ clientId: r.client_id ?? '', clientName: r.client_name })} style={{ flex: 1.5, borderRadius: 12, overflow: 'hidden' }}>
                        <LinearGradient colors={isNext ? ORANGE_GRAD : [hexA(C.green, 0.2), hexA(C.green, 0.1)]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11, borderRadius: 12, borderWidth: isNext ? 0 : 1, borderColor: hexA(C.green, 0.45) }}>
                          <Icon name="plus" size={13} color={isNext ? '#fff' : C.green} strokeWidth={2.3} />
                          <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: isNext ? '#fff' : C.green }}>Log Session</Text>
                        </LinearGradient>
                      </Pressable>
                      <Pressable onPress={() => { setRemark(''); cancelM.reset(); setCancelFor(r); }} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: hexA(C.red, 0.35) }}>
                        <Icon name="close" size={12} color={C.red} strokeWidth={2.4} />
                        <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: C.red }}>Cancel</Text>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              </View>
            </Card>
          </FadeInUp>
        );
      })}

      {/* Log Session → the physio session sheet, prefilled with this client */}
      <PhysioSessionSheet visible={!!logFor} onClose={() => setLogFor(null)} clientId={logFor?.clientId} clientName={logFor?.clientName} />

      {/* Live-routed distance sheet */}
      {distFor ? <DistanceSheet row={{ client_id: distFor.client_id, client_name: distFor.client_name }} visible onClose={() => setDistFor(null)} /> : null}

      {/* Cancel confirm (remark optional) */}
      <Modal visible={!!cancelFor} transparent animationType="fade" onRequestClose={() => setCancelFor(null)}>
        <Pressable onPress={() => setCancelFor(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center', padding: 22 }}>
          <Pressable onPress={() => {}} style={{ width: '100%', borderRadius: 20, backgroundColor: C.sheetBg, borderWidth: 1, borderColor: hexA(C.red, 0.3), padding: 17, gap: 12 }}>
            <Serif style={{ fontSize: 18 }}>Cancel this session?</Serif>
            <Body style={{ fontSize: 12, color: C.muted2 }}>
              {cancelFor?.client_name} · {cancelFor ? `${istTimeParts(cancelFor.scheduled_datetime).time} ${istTimeParts(cancelFor.scheduled_datetime).ampm}` : ''} — this marks the roster session cancelled.
            </Body>
            <TextInput
              value={remark} onChangeText={setRemark} placeholder="Reason (optional)" placeholderTextColor={C.muted3} multiline
              style={{ minHeight: 64, textAlignVertical: 'top', fontFamily: F.body, fontSize: 13, color: '#fff', padding: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}
            />
            {cancelM.isError ? <Body style={{ fontSize: 11, color: C.red }}>{(cancelM.error as Error).message}</Body> : null}
            <View style={{ flexDirection: 'row', gap: 9 }}>
              <Pressable onPress={() => setCancelFor(null)} style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}>
                <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: C.muted }}>Keep Session</Text>
              </Pressable>
              <Pressable disabled={cancelM.isPending} onPress={doCancel} style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: hexA(C.red, 0.16), borderWidth: 1, borderColor: hexA(C.red, 0.5), opacity: cancelM.isPending ? 0.6 : 1 }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: C.red }}>{cancelM.isPending ? 'Cancelling…' : 'Cancel Session'}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

export function DoctorDashboard() {
  const [tourOpen, setTourOpen] = React.useState(false);
  const { session } = useAuth();
  const { go } = useStore();
  const uid = session?.user?.id ?? null;
  const identity = useDoctorIdentity();
  const isHead = identity.data.isHeadDoctor;

  const [monthBack, setMonthBack] = React.useState(0);
  const selectedMonth = React.useMemo(() => { const d = new Date(); d.setMonth(d.getMonth() - monthBack); return d; }, [monthBack]);
  const [rangeMode, setRangeMode] = React.useState<'month' | 'day'>('month');
  const [dayBack, setDayBack] = React.useState(0);
  const selectedDay = React.useMemo(() => { const d = new Date(); d.setDate(d.getDate() - dayBack); return d; }, [dayBack]);

  const metrics = usePhysioMetrics(uid, selectedMonth);
  // HOD-only by request: the all-doctors card and its edge call are limited to the
  // Head Doctor (the fn rejects everyone else anyway). isHead is uid-derived — instant.
  const teamEnabled = isHead;
  const teamQ = useSeniorDashboard(selectedMonth, teamEnabled, rangeMode === 'day' ? selectedDay : null);
  const pendingQ = usePendingProtocols();
  const tlbQ = useTrainerLeaderboard();
  const tlbMedals = [C.gold, '#B8BCC4', '#C08A52'];
  const tlbRows = (tlbQ.data ?? []).slice(0, 3).map((e, i) => ({ rank: i + 1, name: e.trainerName, value: e.sessionCount + e.qhpCount, color: tlbMedals[i] ?? C.orange }));
  const [breakdownOpen, setBreakdownOpen] = React.useState(false);
  const [ackOpen, setAckOpen] = React.useState(false);
  const [runRateOpen, setRunRateOpen] = React.useState(false);
  const runRateQ = useDoctorsRunRate();
  const [detailFor, setDetailFor] = React.useState<{ id: string; name: string } | null>(null);
  const [sessOpen, setSessOpen] = React.useState<any | null>(null);
  const detailQ = useDoctorSessionDetails(detailFor?.id ?? null, selectedMonth, !!detailFor, rangeMode === 'day' ? selectedDay : null);

  const leaderboard = teamQ.data?.leaderboard ?? [];
  const totalSessions = leaderboard.reduce((s, e) => s + e.sessions, 0);
  const totalAck = leaderboard.reduce((s, e) => s + (e.acknowledged ?? 0), 0);
  const ackPct = totalSessions ? Math.round((totalAck / totalSessions) * 100) : 0;
  const pendingCount = (pendingQ.data ?? []).length;

  return (
    <Page gap={14} pt={6}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <TitleBlock title="Doctor Dashboard" sub={identity.data.isPhysio ? 'Physiotherapy overview' : identity.data.isNutritionist ? 'Nutrition overview' : 'Doctor overview'} />
        </View>
        <TourLauncher onPress={() => setTourOpen(true)} />
      </View>
      <FeatureTour visible={tourOpen} steps={DOCTOR_TOUR} tourName='doctor' onClose={() => setTourOpen(false)} />

      {/* Pending protocol approvals banner (HOD) */}
      {isHead && pendingCount > 0 ? (
        <FadeInUp delay={0}>
          <Pressable onPress={() => go('doctor-protocol-approvals')} style={{ borderRadius: 15, overflow: 'hidden', borderWidth: 1.5, borderColor: hexA(C.gold, 0.5) }}>
            <LinearGradient colors={[hexA(C.gold, 0.14), hexA(C.orange, 0.06)]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: 13 }}>
              <PulseGlow>
                <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: hexA(C.gold, 0.18), borderWidth: 1, borderColor: hexA(C.gold, 0.4), alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="clipboard" size={16} color={C.gold} strokeWidth={2.2} />
                </View>
              </PulseGlow>
              <View style={{ flex: 1 }}>
                <Body style={{ fontSize: 13, fontFamily: F.bodyBold, color: '#F5D08A' }}>{pendingCount} protocol{pendingCount === 1 ? '' : 's'} awaiting your approval</Body>
                <Body style={{ fontSize: 11, color: hexA(C.gold, 0.85), marginTop: 1 }}>Tap to review physio treatment protocols</Body>
              </View>
              <Icon name="chevRight" size={15} color={C.gold} strokeWidth={2.4} />
            </LinearGradient>
          </Pressable>
        </FadeInUp>
      ) : null}

      {/* KPI cards */}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <FadeInUp delay={60} style={{ flex: 1 }}>
          <Card colors={['rgba(46,28,18,0.45)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.12)" radius={17} style={{ padding: 14, gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: hexA(C.orange, 0.12), alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="calendar" size={12} color={C.orange} strokeWidth={2.1} />
              </View>
              <Mono style={{ fontSize: 8.5, letterSpacing: 0.8, color: C.muted3 }}>TODAY (PERSONAL)</Mono>
            </View>
            {metrics.isLoading ? <Serif style={{ fontSize: 30 }}>…</Serif> : <CountUpText value={metrics.todaySessions} style={{ fontSize: 30 }} />}
            <Body style={{ fontSize: 10.5, color: C.muted2 }}>{metrics.monthlySessions} this month</Body>
          </Card>
        </FadeInUp>
        {isHead ? (
          <FadeInUp delay={130} style={{ flex: 1 }}>
            <Card onPress={() => setBreakdownOpen(true)} colors={['rgba(46,28,18,0.45)', 'rgba(18,14,14,0.5)']} border={hexA(C.blue, 0.2)} radius={17} style={{ padding: 14, gap: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: hexA(C.blue, 0.12), alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="users" size={12} color={C.blue} strokeWidth={2.1} />
                </View>
                <Mono style={{ fontSize: 8.5, letterSpacing: 0.8, color: C.muted3 }}>TODAY (ALL DOCTORS)</Mono>
              </View>
              {teamQ.isPending ? <Serif style={{ fontSize: 30, color: '#A9BCFF' }}>…</Serif>
                : teamQ.isError ? <Serif style={{ fontSize: 30, color: C.red }}>!</Serif>
                : <CountUpText value={teamQ.data?.todayCount ?? 0} style={{ fontSize: 30, color: '#A9BCFF' }} />}
              {teamQ.isError ? (
                <Body style={{ fontSize: 9.5, color: C.red }} numberOfLines={2}>{(teamQ.error as Error).message}</Body>
              ) : (
                <Body style={{ fontSize: 10.5, color: C.muted2 }}>Tap for breakdown</Body>
              )}
            </Card>
          </FadeInUp>
        ) : null}
      </View>

      {/* Today's roster — the doctor's own HOD-created schedule */}
      <DoctorTodayRoster />

      {/* Run rate — HOD ONLY: whole-team month-to-date + team projection; tap = per-doctor breakdown */}
      {isHead ? (
        <FadeInUp delay={150}>
          {(() => {
            const rows = runRateQ.data?.rows ?? [];
            const teamCurrent = rows.reduce((n, r) => n + r.current, 0);
            const teamProjected = rows.reduce((n, r) => n + r.projected, 0);
            const teamPerDay = rows.reduce((n, r) => n + r.perDay, 0);
            return (
              <Card onPress={() => setRunRateOpen(true)} colors={['rgba(46,28,18,0.45)', 'rgba(18,14,14,0.5)']} border={hexA(C.purple, 0.24)} radius={17} style={{ overflow: 'hidden' }}>
                <LinearGradient colors={[hexA(C.purple, 0.55), 'rgba(255,255,255,0.02)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 3 }} />
                <View style={{ padding: 14, gap: 10 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: hexA(C.purple, 0.13), borderWidth: 1, borderColor: hexA(C.purple, 0.4), alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name="trend" size={16} color={C.purple} strokeWidth={2.2} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Mono style={{ fontSize: 8.5, letterSpacing: 0.9, color: C.muted3 }}>TEAM RUN RATE · DAY {runRateQ.data?.daysElapsed ?? '…'} OF {runRateQ.data?.daysInMonth ?? '…'}</Mono>
                      <Body style={{ fontSize: 13.5, fontFamily: F.bodyBold, color: '#fff', marginTop: 2 }}>
                        {runRateQ.isPending ? 'Calculating pace…' : `${teamCurrent} done · ${teamPerDay.toFixed(1)}/day team pace`}
                      </Body>
                      <Body style={{ fontSize: 10.5, color: C.muted2, marginTop: 1 }}>Tap for every doctor's run rate</Body>
                    </View>
                    <View style={{ alignItems: 'center' }}>
                      {runRateQ.isPending ? <Serif style={{ fontSize: 28, color: '#C9B8F5' }}>…</Serif>
                        : <CountUpText value={teamProjected} style={{ fontSize: 28, color: '#C9B8F5' }} />}
                      <Mono style={{ fontSize: 7, letterSpacing: 0.8, color: C.muted3 }}>TEAM PROJECTED</Mono>
                    </View>
                  </View>
                  {!runRateQ.isPending && teamProjected > 0 ? (
                    <GrowBar pct={teamCurrent / teamProjected} color={C.purple} delay={300} />
                  ) : null}
                </View>
              </Card>
            );
          })()}
        </FadeInUp>
      ) : null}

      {/* Acknowledgements — compulsory: every session must be client-acknowledged */}
      {isHead ? (
        <FadeInUp delay={170}>
          <Card onPress={() => setAckOpen(true)} colors={['rgba(24,44,32,0.5)', 'rgba(18,20,16,0.55)']} border={hexA(totalAck < totalSessions ? C.gold : C.green, 0.28)} radius={17} style={{ overflow: 'hidden' }}>
            <LinearGradient colors={[hexA(totalAck < totalSessions ? C.gold : C.green, 0.55), 'rgba(255,255,255,0.02)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 3 }} />
            <View style={{ padding: 14, gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: hexA(C.green, 0.13), borderWidth: 1, borderColor: hexA(C.green, 0.35), alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="checks" size={16} color={C.green} strokeWidth={2.2} />
                </View>
                <View style={{ flex: 1 }}>
                  <Mono style={{ fontSize: 8.5, letterSpacing: 0.9, color: C.muted3 }}>ACKNOWLEDGEMENTS · {monthLabel(selectedMonth).toUpperCase()}</Mono>
                  <Body style={{ fontSize: 13.5, fontFamily: F.bodyBold, color: '#fff', marginTop: 2 }}>
                    {teamQ.isPending ? 'Counting…' : `${totalAck} of ${totalSessions} sessions acknowledged`}
                  </Body>
                  <Body style={{ fontSize: 10.5, color: totalAck < totalSessions ? '#F2C066' : C.muted2, marginTop: 1 }}>
                    {teamQ.isPending ? 'Acknowledgement is compulsory' : totalAck < totalSessions ? `${totalSessions - totalAck} pending — acknowledgement is compulsory · tap for breakdown` : 'All sessions acknowledged · tap for breakdown'}
                  </Body>
                </View>
                <View style={{ alignItems: 'center' }}>
                  <Serif style={{ fontSize: 24, color: totalAck < totalSessions ? C.gold : C.green }}>{teamQ.isPending ? '…' : `${ackPct}%`}</Serif>
                </View>
              </View>
              {!teamQ.isPending ? <GrowBar pct={totalSessions ? totalAck / totalSessions : 0} color={totalAck < totalSessions ? C.gold : C.green} delay={340} /> : null}
            </View>
          </Card>
        </FadeInUp>
      ) : null}

      {/* HOD Sessions Details leaderboard */}
      {isHead ? (
        <FadeInUp delay={200}>
        <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.1)" radius={18} style={{ padding: 15, gap: 11 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Mono style={{ flex: 1, fontSize: 10.5, letterSpacing: 1.6, color: C.mono }}>SESSIONS DETAILS</Mono>
            <View style={{ flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 999, padding: 2 }}>
              {([['month', 'Monthly'], ['day', 'Day-wise']] as const).map(([id, lab]) => {
                const active = rangeMode === id;
                return (
                  <Pressable key={id} onPress={() => setRangeMode(id)} style={{ paddingVertical: 5, paddingHorizontal: 11, borderRadius: 999, backgroundColor: active ? hexA(C.orange, 0.2) : 'transparent' }}>
                    <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 10.5, color: active ? C.orange : C.muted }}>{lab}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
            <Pressable onPress={() => (rangeMode === 'month' ? setMonthBack((v) => Math.min(11, v + 1)) : setDayBack((v) => v + 1))} hitSlop={8} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="chevLeft" size={13} color={C.ink3} strokeWidth={2.3} />
            </Pressable>
            <Text style={{ flex: 1, textAlign: 'center', fontFamily: F.bodySemi, fontSize: 12.5, color: '#fff' }}>
              {rangeMode === 'month' ? monthLabel(selectedMonth) : selectedDay.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
            </Text>
            <Pressable onPress={() => (rangeMode === 'month' ? setMonthBack((v) => Math.max(0, v - 1)) : setDayBack((v) => Math.max(0, v - 1)))} hitSlop={8} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="chevRight" size={13} color={C.ink3} strokeWidth={2.3} />
            </Pressable>
          </View>
          <Body style={{ fontSize: 11, color: C.muted2 }}>Total: <Text style={{ fontFamily: F.bodyBold, color: '#fff' }}>{totalSessions}</Text> sessions</Body>
          {teamQ.isPending ? (
            teamQ.fetchStatus === 'fetching' ? (
              <View style={{ paddingVertical: 18, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View>
            ) : (
              <Body style={{ fontSize: 11.5, color: C.muted3, textAlign: 'center', paddingVertical: 14 }}>Offline — team data will load when the connection returns.</Body>
            )
          ) : teamQ.isError ? (
            <View style={{ gap: 8 }}>
              <Body style={{ fontSize: 11.5, color: C.red }}>{(teamQ.error as Error).message}</Body>
              <Pressable onPress={() => teamQ.refetch()} style={{ alignSelf: 'flex-start', backgroundColor: hexA(C.orange, 0.12), borderWidth: 1, borderColor: hexA(C.orange, 0.4), borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 11.5, color: C.orange }}>Retry</Text>
              </Pressable>
            </View>
          ) : leaderboard.length === 0 ? (
            <Body style={{ fontSize: 11.5, color: C.muted3, textAlign: 'center', paddingVertical: 12 }}>No sessions in this range.</Body>
          ) : (() => {
            const maxSessions = Math.max(...leaderboard.map((e) => e.sessions), 1);
            return leaderboard.map((e, i) => {
              const medal = i === 0 ? C.gold : i === 1 ? '#C7CBD6' : i === 2 ? '#D08B4C' : null;
              return (
                <FadeInUp key={e.id} delay={120 + i * 70}>
                  <Pressable onPress={() => setDetailFor({ id: e.id, name: e.name })} style={{ gap: 8, padding: 11, borderRadius: 13, backgroundColor: i === 0 ? hexA(C.gold, 0.07) : 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: medal ? hexA(medal, 0.32) : 'rgba(255,255,255,0.06)' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: medal ? hexA(medal, 0.16) : 'rgba(255,255,255,0.05)', borderWidth: medal ? 1 : 0, borderColor: medal ? hexA(medal, 0.45) : 'transparent' }}>
                        <Text style={{ fontFamily: F.mono, fontSize: 11, color: medal ?? C.muted }}>#{i + 1}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Body style={{ fontSize: 13, fontFamily: F.bodySemi, color: '#fff' }} numberOfLines={1}>{e.name}</Body>
                        <Mono style={{ fontSize: 8.5, color: C.muted3, marginTop: 1 }}>ACK {e.acknowledged ?? 0}/{e.sessions}</Mono>
                      </View>
                      <Text style={{ fontFamily: F.bodyBold, fontSize: 17, color: medal ?? '#fff' }}>{e.sessions}</Text>
                      <Icon name="chevRight" size={13} color={C.muted3} strokeWidth={2.2} />
                    </View>
                    <GrowBar pct={e.sessions / maxSessions} color={medal ?? C.blue} delay={260 + i * 70} />
                  </Pressable>
                </FadeInUp>
              );
            });
          })()}
        </Card>
        </FadeInUp>
      ) : null}

      {/* Trainer Leaderboard — web parity: shown to all doctors. Exact trainer-home
          podium preview card; tap opens the full standings page. */}
      <FadeInUp delay={isHead ? 320 : 160}>
        <LeaderboardPreview
          title="Trainer Leaderboard"
          sub={tlbQ.isLoading ? 'Loading…' : `${(tlbQ.data ?? []).length} trainers · this month`}
          accent={C.gold}
          unit="SESS"
          live
          onPress={() => go('trainer-leaderboard')}
          rows={tlbRows}
        />
      </FadeInUp>

      {/* Run rate breakdown — every doctor's pace + projection */}
      <Modal visible={runRateOpen} transparent animationType="slide" onRequestClose={() => setRunRateOpen(false)}>
        <Pressable onPress={() => setRunRateOpen(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' }}>
          <Pressable onPress={() => {}} style={{ maxHeight: '80%', backgroundColor: '#171210', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.15)', paddingHorizontal: 18, paddingTop: 16, paddingBottom: 26 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 12 }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: C.purple }} />
              <View style={{ flex: 1 }}>
                <Serif style={{ fontSize: 19, color: '#fff' }}>Run Rate — All Doctors</Serif>
                <Body style={{ fontSize: 10.5, color: C.muted3, marginTop: 1 }}>
                  Day {runRateQ.data?.daysElapsed ?? '—'} of {runRateQ.data?.daysInMonth ?? '—'} · projected = pace × days in month
                </Body>
              </View>
              <Pressable onPress={() => setRunRateOpen(false)} hitSlop={10} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="close" size={15} color={C.muted2} />
              </Pressable>
            </View>
            {runRateQ.isPending ? (
              <View style={{ paddingVertical: 36, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View>
            ) : runRateQ.isError ? (
              <Body style={{ fontSize: 12, color: C.red, textAlign: 'center', paddingVertical: 22 }}>{(runRateQ.error as Error).message}</Body>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false} style={{ flexShrink: 1 }} nestedScrollEnabled>
                {(runRateQ.data?.rows ?? []).map((r, i) => {
                  const maxProj = Math.max(1, runRateQ.data?.rows?.[0]?.projected ?? 1);
                  const mine = r.id === uid;
                  return (
                    <View key={r.id} style={{ paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)', gap: 7, ...(mine ? { backgroundColor: hexA(C.purple, 0.05), marginHorizontal: -18, paddingHorizontal: 18 } : null) }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        <View style={{ width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: i < 3 ? hexA(C.purple, 0.16) : 'rgba(255,255,255,0.05)' }}>
                          <Text style={{ fontFamily: F.mono, fontSize: 10.5, color: i < 3 ? '#C9B8F5' : C.muted }}>#{i + 1}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Body numberOfLines={1} style={{ fontSize: 13, fontFamily: F.bodySemi, color: '#fff' }}>{r.name}{mine ? '  (you)' : ''}</Body>
                          <Mono style={{ fontSize: 9, color: C.muted3, marginTop: 1 }}>{r.current} DONE · {r.perDay.toFixed(1)}/DAY</Mono>
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={{ fontFamily: F.bodyBold, fontSize: 16, color: '#C9B8F5' }}>{r.projected}</Text>
                          <Mono style={{ fontSize: 7, letterSpacing: 0.6, color: C.muted3 }}>PROJECTED</Mono>
                        </View>
                      </View>
                      <GrowBar pct={r.projected / maxProj} color={mine ? C.purple : hexA(C.purple, 0.55)} delay={100 + i * 50} />
                    </View>
                  );
                })}
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Acknowledgements breakdown — per doctor; tap one for session-level detail */}
      <Modal visible={ackOpen} transparent animationType="slide" onRequestClose={() => setAckOpen(false)}>
        <Pressable onPress={() => setAckOpen(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' }}>
          <Pressable onPress={() => {}} style={{ maxHeight: '80%', backgroundColor: '#171210', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.15)', paddingHorizontal: 18, paddingTop: 16, paddingBottom: 26 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 4 }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: totalAck < totalSessions ? C.gold : C.green }} />
              <View style={{ flex: 1 }}>
                <Serif style={{ fontSize: 19, color: '#fff' }}>Acknowledgements</Serif>
                <Body style={{ fontSize: 10.5, color: C.muted3, marginTop: 1 }}>{monthLabel(selectedMonth)} · every session must be client-acknowledged</Body>
              </View>
              <Pressable onPress={() => setAckOpen(false)} hitSlop={10} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="close" size={15} color={C.muted2} />
              </Pressable>
            </View>
            <View style={{ flexDirection: 'row', gap: 8, marginVertical: 10 }}>
              {(([['Acknowledged', totalAck, C.green], ['Pending', totalSessions - totalAck, totalSessions - totalAck > 0 ? C.gold : C.muted3], ['Total', totalSessions, C.blue]]) as [string, number, string][]).map(([lab, val, col]) => (
                <View key={lab} style={{ flex: 1, paddingVertical: 9, borderRadius: 12, backgroundColor: hexA(col, 0.08), borderWidth: 1, borderColor: hexA(col, 0.25), alignItems: 'center' }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 17, color: col }}>{val}</Text>
                  <Mono style={{ fontSize: 7.5, color: C.muted3, marginTop: 1 }}>{lab.toUpperCase()}</Mono>
                </View>
              ))}
            </View>
            {leaderboard.length === 0 ? (
              <Body style={{ fontSize: 12, color: C.muted3, textAlign: 'center', paddingVertical: 22 }}>No sessions this month.</Body>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false} style={{ flexShrink: 1 }} nestedScrollEnabled>
                {[...leaderboard].sort((a, b) => (b.sessions - (b.acknowledged ?? 0)) - (a.sessions - (a.acknowledged ?? 0))).map((e) => {
                  const ack = e.acknowledged ?? 0;
                  const pend = e.sessions - ack;
                  const col = pend > 0 ? C.gold : C.green;
                  return (
                    <Pressable key={e.id} onPress={() => { setAckOpen(false); setDetailFor({ id: e.id, name: e.name }); }} style={{ paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)', gap: 7 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        <View style={{ flex: 1 }}>
                          <Body numberOfLines={1} style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{e.name}</Body>
                          <Mono style={{ fontSize: 9, color: C.muted3, marginTop: 1 }}>ACK {ack}/{e.sessions}</Mono>
                        </View>
                        {pend > 0 ? <Badge text={`${pend} pending`} color={C.gold} /> : <Badge text="All acknowledged" color={C.green} />}
                        <Icon name="chevRight" size={13} color={C.muted3} strokeWidth={2.2} />
                      </View>
                      <GrowBar pct={e.sessions ? ack / e.sessions : 0} color={col} />
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}
            <Body style={{ fontSize: 10, color: C.muted3, textAlign: 'center', marginTop: 10 }}>Tap a doctor to see each session's acknowledgement status.</Body>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Today's all-doctors breakdown */}
      <Modal visible={breakdownOpen} transparent animationType="fade" onRequestClose={() => setBreakdownOpen(false)}>
        <Pressable onPress={() => setBreakdownOpen(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', padding: 22 }}>
          <Pressable onPress={() => {}} style={{ borderRadius: 18, backgroundColor: '#141010', borderWidth: 1, borderColor: hexA(C.blue, 0.3), padding: 18, gap: 11, maxHeight: '75%' }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: '#fff' }}>Today's Sessions Breakdown</Text>
            {!isHead ? (
              <Body style={{ fontSize: 12, color: C.muted3 }}>The team breakdown is available to the Head Doctor only.</Body>
            ) : (teamQ.data?.todayByDoctor ?? []).length === 0 ? (
              <Body style={{ fontSize: 12, color: C.muted3 }}>No sessions logged today.</Body>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false}>
                {(teamQ.data?.todayByDoctor ?? []).map((d) => (
                  <View key={d.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' }}>
                    <Body style={{ flex: 1, fontSize: 13, color: C.ink }}>{d.name}</Body>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: '#A9BCFF' }}>{d.sessions}</Text>
                  </View>
                ))}
                <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10 }}>
                  <Body style={{ flex: 1, fontSize: 13, fontFamily: F.bodyBold, color: '#fff' }}>Total</Body>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 14.5, color: C.blue }}>{teamQ.data?.todayCount ?? 0}</Text>
                </View>
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Per-doctor session detail dialog */}
      <Modal visible={!!detailFor} transparent animationType="slide" onRequestClose={() => setDetailFor(null)}>
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable onPress={() => setDetailFor(null)} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)' }} />
          <View style={{ height: '80%', backgroundColor: '#0E0A09', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.14)', paddingHorizontal: 18, paddingTop: 14 }}>
            <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 12 }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
              <View style={{ flex: 1 }}>
                <Serif style={{ fontSize: 19 }}>{detailFor?.name}'s Sessions</Serif>
                <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 2 }}>
                  {(detailQ.data ?? []).length} total · {(detailQ.data ?? []).filter((s: any) => !!s.session_acknowledged_at).length} acknowledged
                </Body>
              </View>
              <Pressable onPress={() => setDetailFor(null)} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="close" size={14} color="#B8B2AC" strokeWidth={2.3} />
              </Pressable>
            </View>
            {detailQ.isPending ? (
              <View style={{ paddingVertical: 26, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 26 }}>
                {(detailQ.data ?? []).map((s: any) => (
                  <Pressable key={s.id} onPress={() => setSessOpen(s)} style={{ padding: 11, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', gap: 5 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                      <Body style={{ flex: 1, fontSize: 12.5, fontFamily: F.bodySemi, color: '#fff' }} numberOfLines={1}>{s.client_name ?? s.session_name ?? 'Session'}</Body>
                      <Badge text={formatDoctorSessionType(s.session_type)} color={C.blue} />
                      {s.cancelled ? <Badge text="Cancelled" color={C.red} /> : s.attendance_marked ? <Badge text="Attended" color={C.green} /> : null}
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Mono style={{ fontSize: 9, color: C.muted3 }}>{fmtAt(s.scheduled_at).toUpperCase()}</Mono>
                      <Badge text={s.session_acknowledged_at ? 'Client Acknowledged' : 'Not Acknowledged'} color={s.session_acknowledged_at ? C.green : C.muted} />
                    </View>
                    {s.notes ? <Body style={{ fontSize: 10.5, color: C.muted2, fontStyle: 'italic' }} numberOfLines={3}>{s.notes}</Body> : null}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-end' }}>
                      <Mono style={{ fontSize: 7.5, letterSpacing: 0.6, color: C.orange }}>FULL DETAILS</Mono>
                      <Icon name='chevRight' size={11} color={C.orange} strokeWidth={2.4} />
                    </View>
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
        {/* NESTED inside this Modal's tree — a sibling Modal mounted while this
            one is visible renders blank + touch-blocked on Android. */}
        {sessOpen ? <DoctorSessionDetailSheet session={sessOpen} onClose={() => setSessOpen(null)} /> : null}
      </Modal>
    </Page>
  );
}

/* ============ MY CLIENTS ============ */
export function DoctorClients() {
  const { set, go } = useStore();
  const clientsQ = useDoctorAssignedClients();
  const [months, setMonths] = React.useState('1');
  const clientIds = (clientsQ.data ?? []).map((c) => c.id);
  const countsQ = useDoctorClientSessionCounts(clientIds, months, clientIds.length > 0);
  const [search, setSearch] = React.useState('');
  const term = search.trim().toLowerCase();
  const list = (clientsQ.data ?? []).filter((c) => !term || c.name.toLowerCase().includes(term));

  return (
    <Page gap={13} pt={6}>
      <TitleBlock title="My Clients" sub="Clients assigned to you" />
      <TextInput value={search} onChangeText={setSearch} placeholder="Search clients…" placeholderTextColor={C.muted3} style={inputStyle} />
      <HScroll gap={7}>
        {(['1', '2', '3', '4', 'overall'] as const).map((m) => {
          const active = months === m;
          return (
            <Pressable key={m} onPress={() => setMonths(m)} style={{ paddingVertical: 7, paddingHorizontal: 13, borderRadius: 999, backgroundColor: active ? hexA(C.orange, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.orange, 0.5) : 'rgba(255,255,255,0.09)' }}>
              <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 11.5, color: active ? C.orange : C.muted }}>{m === 'overall' ? 'Overall' : `${m} mo`}</Text>
            </Pressable>
          );
        })}
      </HScroll>
      {clientsQ.isPending ? (
        <View style={{ paddingVertical: 28, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View>
      ) : clientsQ.isError ? (
        <Body style={{ fontSize: 12, color: C.red, textAlign: 'center' }}>{(clientsQ.error as Error).message}</Body>
      ) : list.length === 0 ? (
        <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 24 }}>{term ? 'No clients match your search.' : 'No clients assigned yet.'}</Body>
      ) : list.map((c) => (
        <Card key={c.id} onPress={() => { set({ selectedClientId: c.id, selectedClientName: c.name }); go('doctor-client-detail'); }} colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.1)" radius={15} style={{ padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Avatar initial={(c.name[0] ?? '?').toUpperCase()} size={38} colors={avColors(c.name)} fontSize={14} />
          <View style={{ flex: 1 }}>
            <Body style={{ fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }} numberOfLines={1}>{c.name}</Body>
            {c.subscription ? <Body style={{ fontSize: 10.5, color: C.muted2, marginTop: 1 }}>{c.subscription}</Body> : null}
            {c.crmName ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 }}>
                <Icon name="userCircle" size={11} color={C.muted3} strokeWidth={1.9} />
                <Body style={{ fontSize: 10.5, color: C.muted2 }} numberOfLines={1}>
                  CRM · {c.crmName}{c.crmPhone ? ` · ${c.crmPhone}` : ''}
                </Body>
              </View>
            ) : null}
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 17, color: C.green }}>{countsQ.data?.[c.id] ?? 0}</Text>
            <Mono style={{ fontSize: 7.5, color: C.muted3 }}>{months === 'overall' ? 'SESSIONS' : `IN ${months} MO`}</Mono>
          </View>
        </Card>
      ))}
    </Page>
  );
}

/* ============ ALL CLIENTS (HOD + allowed ids) ============ */
export function DoctorAllClients() {
  const { set, go } = useStore();
  const { session } = useAuth();
  const uid = session?.user?.id ?? '';
  const allowed = ALLOWED_DOCTOR_IDS.includes(uid);
  const q = useAllClientsForDoctor(allowed);
  const [search, setSearch] = React.useState('');
  const [subFilter, setSubFilter] = React.useState('all');
  const SUBS = ['all', 'none', 'Odds basic', 'Odds plus', 'Odds pro', 'Odds lux', 'Odds Prive', 'Odds APEX', 'Virtual Training', 'Influencer'];

  if (!allowed) {
    return (
      <Page gap={14} pt={6}>
        <TitleBlock title="Access Restricted" sub="All Clients is limited" />
        <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 26 }}>This page is available to the Head Doctor only.</Body>
      </Page>
    );
  }
  const term = search.trim().toLowerCase();
  const list = (q.data ?? []).filter((c) => {
    const matches = !term || c.name.toLowerCase().includes(term) || (c.email ?? '').toLowerCase().includes(term);
    const subOk = subFilter === 'all' ? true : subFilter === 'none' ? !c.subscription : c.subscription === subFilter;
    return matches && subOk;
  });

  return (
    <Page gap={13} pt={6}>
      <TitleBlock title="All Clients" sub={`${(q.data ?? []).length} active clients`} />
      <TextInput value={search} onChangeText={setSearch} placeholder="Search by name or email…" placeholderTextColor={C.muted3} style={inputStyle} />
      <HScroll gap={7}>
        {SUBS.map((s) => {
          const active = subFilter === s;
          return (
            <Pressable key={s} onPress={() => setSubFilter(s)} style={{ paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, backgroundColor: active ? hexA(C.orange, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.orange, 0.5) : 'rgba(255,255,255,0.09)' }}>
              <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 11, color: active ? C.orange : C.muted }}>{s === 'all' ? 'All' : s === 'none' ? 'No sub' : s}</Text>
            </Pressable>
          );
        })}
      </HScroll>
      {q.isPending ? (
        <View style={{ paddingVertical: 28, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View>
      ) : q.isError ? (
        <Body style={{ fontSize: 12, color: C.red, textAlign: 'center' }}>{(q.error as Error).message}</Body>
      ) : (
        <>
          <Body style={{ fontSize: 11, color: C.muted3 }}>Showing {Math.min(list.length, 60)} of {list.length}</Body>
          {list.slice(0, 60).map((c) => (
            <Card key={c.id} onPress={() => { set({ selectedClientId: c.id, selectedClientName: c.name }); go('doctor-client-detail'); }} colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.1)" radius={15} style={{ padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Avatar initial={(c.name[0] ?? '?').toUpperCase()} size={38} colors={avColors(c.name)} fontSize={14} />
              <View style={{ flex: 1 }}>
                <Body style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }} numberOfLines={1}>{c.name}</Body>
                <Body style={{ fontSize: 10.5, color: C.muted2, marginTop: 1 }} numberOfLines={1}>{c.crmName ? `CRM · ${c.crmName}` : 'Unassigned CRM'}</Body>
              </View>
              {c.subscription ? <Badge text={c.subscription} color={C.gold} /> : null}
            </Card>
          ))}
        </>
      )}
    </Page>
  );
}

/* ============ PROTOCOL APPROVALS (HOD) + creation ============ */
function PhaseExercisesBlock({ protocolId, phase, label }: { protocolId: string; phase: string; label: string }) {
  const q = useProtocolExercises(protocolId, phase);
  const groups = React.useMemo(() => {
    const map = new Map<string, any[]>();
    (q.data ?? []).forEach((ex) => {
      const k = `${ex.exercise_order}-${ex.exercise_name}`;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(ex);
    });
    return [...map.values()];
  }, [q.data]);
  if (q.isPending) return <ActivityIndicator color={C.orange} size="small" />;
  if (!groups.length) return null;
  return (
    <View style={{ gap: 6 }}>
      <Mono style={{ fontSize: 9, letterSpacing: 1, color: C.mono2 }}>{label.toUpperCase()} EXERCISES</Mono>
      {groups.map((rows, gi) => (
        <View key={gi} style={{ padding: 9, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', gap: 3 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
            <Icon name="dumbbell" size={11} color={C.blue} strokeWidth={2.1} />
            <Body style={{ flex: 1, fontSize: 12, fontFamily: F.bodySemi, color: '#fff' }}>{rows[0].exercise_name}</Body>
            <Mono style={{ fontSize: 8.5, color: C.muted3 }}>{rows.length} SET{rows.length === 1 ? '' : 'S'}</Mono>
          </View>
          {rows.map((r, ri) => (
            <Body key={ri} style={{ fontSize: 10.5, color: C.muted2 }}>
              Set {ri + 1}: {[r.reps != null ? `${r.reps} reps` : null, r.load_kg != null ? `${r.load_kg}kg` : null, r.duration || null].filter(Boolean).join(' · ') || '—'}
            </Body>
          ))}
        </View>
      ))}
    </View>
  );
}

export function DoctorProtocolApprovals() {
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;
  const q = usePendingProtocols();
  const approveM = useApproveProtocol();
  const rejectM = useRejectProtocol();
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [rejectFor, setRejectFor] = React.useState<any | null>(null);
  const [rejectNotes, setRejectNotes] = React.useState('');
  const [err, setErr] = React.useState<string | null>(null);

  return (
    <HodGate>
      <Page gap={13} pt={6}>
        <TitleBlock title="Protocol Approvals" sub="Pending physio treatment protocols" />
        {err ? <Body style={{ fontSize: 11, color: C.red, textAlign: 'center' }}>{err}</Body> : null}
        {q.isPending ? (
          <View style={{ paddingVertical: 28, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View>
        ) : (q.data ?? []).length === 0 ? (
          <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border={hexA(C.green, 0.2)} radius={18} style={{ padding: 22, alignItems: 'center', gap: 8 }}>
            <Icon name="checks" size={24} color={C.green} strokeWidth={2} />
            <Body style={{ fontSize: 13, fontFamily: F.bodySemi, color: '#fff' }}>All caught up!</Body>
            <Body style={{ fontSize: 11.5, color: C.muted3 }}>No pending protocols to review.</Body>
          </Card>
        ) : (q.data ?? []).map((p: any) => {
          const total = (p.initial_rehab_sessions ?? 0) + (p.intermediate_rehab_sessions ?? 0) + (p.advanced_rehab_sessions ?? 0);
          const open = expanded === p.id;
          return (
            <Card key={p.id} colors={['rgba(46,28,18,0.42)', 'rgba(18,14,14,0.5)']} border={hexA(C.gold, 0.25)} radius={17} style={{ padding: 14, gap: 10, borderLeftWidth: 3, borderLeftColor: C.gold }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Body style={{ fontSize: 14.5, fontFamily: F.bodyBold, color: '#fff' }} numberOfLines={1}>{personName(p.client)}</Body>
                  <Body style={{ fontSize: 10.5, color: C.muted2, marginTop: 1 }}>By {personName(p.physio)} · {fmtAt(p.created_at)}</Body>
                </View>
                <Badge text="Pending" color={C.gold} />
              </View>
              <Body style={{ fontSize: 12.5, color: C.ink3 }}>{p.complaint}</Body>
              <View style={{ flexDirection: 'row', gap: 7 }}>
                {([['Initial', p.initial_rehab_sessions, C.green], ['Intermediate', p.intermediate_rehab_sessions, C.gold], ['Advanced', p.advanced_rehab_sessions, C.blue]] as const).map(([lab, n, col]) => (
                  <View key={lab} style={{ flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 11, backgroundColor: hexA(col, 0.08), borderWidth: 1, borderColor: hexA(col, 0.25) }}>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: col }}>{n ?? 0}</Text>
                    <Mono style={{ fontSize: 7.5, color: C.muted3 }}>{lab.toUpperCase()}</Mono>
                  </View>
                ))}
              </View>
              <Body style={{ fontSize: 10.5, color: C.muted3 }}>Total: {total} sessions</Body>
              <Pressable onPress={() => setExpanded(open ? null : p.id)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)' }}>
                <Text style={{ fontFamily: F.bodySemi, fontSize: 11.5, color: C.muted }}>{open ? 'Hide' : 'View'} Prescribed Exercises</Text>
                <Icon name={open ? 'chevUp' : 'chevDown'} size={12} color={C.muted} strokeWidth={2.2} />
              </Pressable>
              {open ? (
                <View style={{ gap: 9 }}>
                  {p.initial_rehab_sessions > 0 ? <PhaseExercisesBlock protocolId={p.id} phase="initial" label="Initial" /> : null}
                  {p.intermediate_rehab_sessions > 0 ? <PhaseExercisesBlock protocolId={p.id} phase="intermediate" label="Intermediate" /> : null}
                  {p.advanced_rehab_sessions > 0 ? <PhaseExercisesBlock protocolId={p.id} phase="advanced" label="Advanced" /> : null}
                </View>
              ) : null}
              <View style={{ flexDirection: 'row', gap: 9 }}>
                <Pressable disabled={approveM.isPending} onPress={() => { setErr(null); if (uid) approveM.mutate({ id: p.id, approved_by: uid }, { onError: (e: any) => setErr(e?.message ?? 'Failed') }); }} style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: hexA(C.green, 0.14), borderWidth: 1, borderColor: hexA(C.green, 0.45), opacity: approveM.isPending ? 0.6 : 1 }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: C.green }}>{approveM.isPending ? 'Approving…' : 'Approve'}</Text>
                </Pressable>
                <Pressable disabled={rejectM.isPending} onPress={() => { setRejectFor(p); setRejectNotes(''); }} style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: hexA(C.red, 0.1), borderWidth: 1, borderColor: hexA(C.red, 0.35) }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: C.red }}>Reject</Text>
                </Pressable>
              </View>
            </Card>
          );
        })}

        {/* Reject dialog — notes required (web) */}
        <Modal visible={!!rejectFor} transparent animationType="fade" onRequestClose={() => setRejectFor(null)}>
          <Pressable onPress={() => setRejectFor(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', padding: 22 }}>
            <Pressable onPress={() => {}} style={{ borderRadius: 18, backgroundColor: '#141010', borderWidth: 1, borderColor: hexA(C.red, 0.3), padding: 18, gap: 12 }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: '#fff' }}>Reject Protocol</Text>
              <Body style={{ fontSize: 12, color: C.muted2 }}>Please provide a reason for rejecting this protocol.</Body>
              <TextInput value={rejectNotes} onChangeText={setRejectNotes} placeholder="Reason for rejection…" placeholderTextColor={C.muted3} multiline style={[inputStyle, { minHeight: 66, textAlignVertical: 'top' }]} />
              <View style={{ flexDirection: 'row', gap: 9 }}>
                <Pressable onPress={() => setRejectFor(null)} style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
                  <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: C.ink }}>Cancel</Text>
                </Pressable>
                <Pressable disabled={!rejectNotes.trim() || rejectM.isPending} onPress={() => {
                  setErr(null);
                  rejectM.mutate({ id: rejectFor.id, rejection_notes: rejectNotes }, { onSuccess: () => setRejectFor(null), onError: (e: any) => { setRejectFor(null); setErr(e?.message ?? 'Failed'); } });
                }} style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: hexA(C.red, rejectNotes.trim() ? 0.16 : 0.06), borderWidth: 1, borderColor: hexA(C.red, rejectNotes.trim() ? 0.45 : 0.2) }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: rejectNotes.trim() ? C.red : C.muted3 }}>{rejectM.isPending ? 'Rejecting…' : 'Reject'}</Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      </Page>
    </HodGate>
  );
}

/* ============ HOD ROSTER MANAGEMENT ============ */
export function DoctorRoster() {
  const isHead = useIsHeadDoctor();
  const [monthDate, setMonthDate] = React.useState(new Date());
  const [doctorId, setDoctorId] = React.useState<string | 'all'>('all');
  const [clientSel, setClientSel] = React.useState<{ id: string; name: string } | null>(null);
  const doctorsQ = useHeadDoctorDoctors(isHead);
  const clientsQ = useHeadDoctorClients(isHead);
  const q = useHeadDoctorMonthSessions(monthDate, 'all');
  const cancelM = useCancelRosterSession();
  const reschedM = useRescheduleRosterSession();
  const [tab, setTab] = React.useState<'calendar' | 'reschedule' | 'list'>('calendar');
  const [cancelFor, setCancelFor] = React.useState<any | null>(null);
  // DB check constraint session_schedule_canceled_by_check allows exactly 'Client' | 'Trainer' (live-verified) — web dialog contract
  const [cancelBy, setCancelBy] = React.useState<'Client' | 'Trainer' | null>(null);
  const [cancelRemark, setCancelRemark] = React.useState('');
  const [reschedFor, setReschedFor] = React.useState<any | null>(null);
  const [reschedDate, setReschedDate] = React.useState('');
  const [reschedTime, setReschedTime] = React.useState('');
  const [err, setErr] = React.useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = React.useState(false);
  const [delOpen, setDelOpen] = React.useState(false);
  const [clientPickOpen, setClientPickOpen] = React.useState(false);
  const [clientSearch, setClientSearch] = React.useState('');
  const [calSel, setCalSel] = React.useState<string | null>(null); // YYYY-MM-DD (local)

  // web: doctor filter is bypassed while a client is selected — both applied client-side here.
  const sessions = React.useMemo(
    () => (q.data ?? [])
      .filter((s: any) => (clientSel ? s.client_id === clientSel.id : true))
      .filter((s: any) => (clientSel ? true : doctorId === 'all' || s.trainer_id === doctorId)),
    [q.data, doctorId, clientSel]
  );
  const stats = {
    total: sessions.length,
    scheduled: sessions.filter((s: any) => s.status === 'scheduled').length,
    confirmed: sessions.filter((s: any) => s.status === 'confirmed').length,
    cancelled: sessions.filter((s: any) => s.status === 'cancelled').length,
  };
  const reschedRequests = sessions.filter((s: any) => s.reschedule_request);
  const shiftMonth = (d: number) => { setMonthDate((prev) => { const n = new Date(prev); n.setMonth(n.getMonth() + d); return n; }); setCalSel(null); };
  const goToday = () => { setMonthDate(new Date()); setCalSel(new Date().toLocaleDateString('en-CA')); };

  const statusColor = (s: string | null) => (s === 'cancelled' ? C.red : s === 'confirmed' ? C.green : C.gold);
  const sessionCard = (s: any) => (
    <Card key={s.id} colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border={hexA(statusColor(s.status), 0.16)} radius={15} style={{ padding: 12, gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
        <View style={{ flex: 1 }}>
          <Body style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }} numberOfLines={1}>{s.client_name}</Body>
          <Body style={{ fontSize: 10.5, color: C.muted2, marginTop: 1 }} numberOfLines={1}>{s.trainer_name} · {formatDoctorSessionType(s.modality)}</Body>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Mono style={{ fontSize: 10, color: C.orange }}>{fmtDayShort(s.scheduled_datetime).toUpperCase()}</Mono>
          <Mono style={{ fontSize: 9.5, color: C.muted2, marginTop: 1 }}>{new Date(s.scheduled_datetime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}</Mono>
        </View>
        <Badge text={s.status || 'scheduled'} color={statusColor(s.status)} />
      </View>
      {s.reschedule_request ? <Body style={{ fontSize: 11, color: C.gold }}>Request: {s.reschedule_request}</Body> : null}
      {s.status !== 'cancelled' ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable onPress={() => { setReschedFor(s); const d = new Date(s.scheduled_datetime); setReschedDate(d.toLocaleDateString('en-CA')); setReschedTime(d.toTimeString().slice(0, 5)); }} style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 11, backgroundColor: hexA(C.blue, 0.1), borderWidth: 1, borderColor: hexA(C.blue, 0.3) }}>
            <Text style={{ fontFamily: F.bodySemi, fontSize: 11.5, color: '#A9BCFF' }}>Reschedule</Text>
          </Pressable>
          <Pressable onPress={() => { setCancelFor(s); setCancelBy(null); setCancelRemark(''); }} style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 11, backgroundColor: hexA(C.red, 0.08), borderWidth: 1, borderColor: hexA(C.red, 0.28) }}>
            <Text style={{ fontFamily: F.bodySemi, fontSize: 11.5, color: C.red }}>Cancel</Text>
          </Pressable>
        </View>
      ) : null}
    </Card>
  );

  return (
    <HodGate>
      <Page gap={13} pt={6}>
        <TitleBlock title="Doctor Roster" sub="Team roster management" />
        {/* Bulk create + delete-future (web: delete only with a client selected) */}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable onPress={() => setBulkOpen(true)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11, borderRadius: 12, backgroundColor: hexA(C.orange, 0.14), borderWidth: 1, borderColor: hexA(C.orange, 0.45) }}>
            <Icon name="calPlus" size={14} color={C.orange} />
            <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: C.orange }}>Create Roster</Text>
          </Pressable>
          {clientSel ? (
            <Pressable onPress={() => setDelOpen(true)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11, borderRadius: 12, backgroundColor: hexA(C.red, 0.07), borderWidth: 1, borderColor: hexA(C.red, 0.3) }}>
              <Icon name="close" size={13} color={C.red} />
              <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: C.red }}>Delete Roster</Text>
            </Pressable>
          ) : null}
        </View>

        {/* Month nav + Today */}
        <Card colors={['rgba(46,28,18,0.45)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.12)" radius={16} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 13, gap: 8 }}>
          <Pressable onPress={() => shiftMonth(-1)} hitSlop={8} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="chevLeft" size={14} color={C.ink3} strokeWidth={2.3} />
          </Pressable>
          <Text style={{ flex: 1, textAlign: 'center', fontFamily: F.bodyBold, fontSize: 14, color: '#fff' }}>{monthLabel(monthDate)}</Text>
          <Pressable onPress={goToday} style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, backgroundColor: hexA(C.orange, 0.12), borderWidth: 1, borderColor: hexA(C.orange, 0.4) }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 10.5, color: C.orange }}>Today</Text>
          </Pressable>
          <Pressable onPress={() => shiftMonth(1)} hitSlop={8} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="chevRight" size={14} color={C.ink3} strokeWidth={2.3} />
          </Pressable>
        </Card>

        {/* Stats */}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {([['Total', stats.total, C.blue], ['Sched', stats.scheduled, C.gold], ['Confirm', stats.confirmed, C.green], ['Cancel', stats.cancelled, C.red]] as const).map(([lab, n, col]) => (
            <View key={lab} style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 13, backgroundColor: hexA(col, 0.07), borderWidth: 1, borderColor: hexA(col, 0.22) }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 17, color: col }}>{n}</Text>
              <Mono style={{ fontSize: 7.5, color: C.muted3 }}>{lab.toUpperCase()}</Mono>
            </View>
          ))}
        </View>

        {/* Filters: client picker chip + doctor chips (doctor disabled while a client is chosen) */}
        <HScroll gap={7}>
          <Pressable onPress={() => (clientSel ? setClientSel(null) : setClientPickOpen(true))} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, backgroundColor: hexA(C.purple, clientSel ? 0.18 : 0.06), borderWidth: 1, borderColor: hexA(C.purple, clientSel ? 0.55 : 0.25) }}>
            <Icon name="user" size={11} color={C.purple} strokeWidth={2.2} />
            <Text style={{ fontFamily: F.bodyBold, fontSize: 11.5, color: C.purple }} numberOfLines={1}>{clientSel ? clientSel.name : 'All Clients'}</Text>
            <Icon name={clientSel ? 'close' : 'chevDown'} size={10} color={C.purple} strokeWidth={2.4} />
          </Pressable>
          {[{ id: 'all', name: 'All Doctors' }, ...(doctorsQ.data ?? [])].map((d) => {
            const active = !clientSel && doctorId === d.id;
            return (
              <Pressable key={d.id} disabled={!!clientSel} onPress={() => setDoctorId(d.id as any)} style={{ opacity: clientSel ? 0.4 : 1, paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, backgroundColor: active ? hexA(C.orange, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.orange, 0.5) : 'rgba(255,255,255,0.09)' }}>
                <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 11.5, color: active ? C.orange : C.muted }}>{d.name}</Text>
              </Pressable>
            );
          })}
        </HScroll>

        {/* Tabs — Calendar first (web order) */}
        <View style={{ flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 999, padding: 3 }}>
          {([['calendar', 'Calendar'], ['reschedule', reschedRequests.length ? `Resched (${reschedRequests.length})` : 'Resched'], ['list', 'List']] as const).map(([id, lab]) => {
            const active = tab === id;
            return active ? (
              <LinearGradient key={id} colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 999 }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: '#fff' }}>{lab}</Text>
              </LinearGradient>
            ) : (
              <Pressable key={id} onPress={() => setTab(id)} style={{ flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 999 }}>
                <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: C.muted }}>{lab}</Text>
              </Pressable>
            );
          })}
        </View>
        {err ? <Body style={{ fontSize: 11, color: C.red, textAlign: 'center' }}>{err}</Body> : null}

        {q.isPending ? (
          <View style={{ paddingVertical: 28, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View>
        ) : tab === 'calendar' ? (
          (() => {
            const byDay = new Map<string, any[]>();
            sessions.forEach((s: any) => {
              const k = new Date(s.scheduled_datetime).toLocaleDateString('en-CA');
              if (!byDay.has(k)) byDay.set(k, []);
              byDay.get(k)!.push(s);
            });
            const y = monthDate.getFullYear(), m = monthDate.getMonth();
            const daysInMonth = new Date(y, m + 1, 0).getDate();
            const firstWeekday = new Date(y, m, 1).getDay();
            const p2 = (n: number) => String(n).padStart(2, '0');
            const keyOf = (day: number) => `${y}-${p2(m + 1)}-${p2(day)}`;
            const todayIso = new Date().toLocaleDateString('en-CA');
            const cells: (number | null)[] = [];
            for (let i = 0; i < firstWeekday; i++) cells.push(null);
            for (let day = 1; day <= daysInMonth; day++) cells.push(day);
            while (cells.length % 7 !== 0) cells.push(null);
            const weeks: (number | null)[][] = [];
            for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
            const selList = calSel ? (byDay.get(calSel) ?? []).slice().sort((a: any, b: any) => String(a.scheduled_datetime).localeCompare(String(b.scheduled_datetime))) : [];
            return (
              <>
                <View style={{ padding: 14, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }}>
                  <View style={{ flexDirection: 'row', marginBottom: 7 }}>
                    {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((w, i) => <Text key={i} style={{ flex: 1, textAlign: 'center', fontFamily: F.mono, fontSize: 9, color: C.muted3 }}>{w}</Text>)}
                  </View>
                  {weeks.map((wk, wi) => (
                    <View key={wi} style={{ flexDirection: 'row', marginBottom: 5 }}>
                      {wk.map((day, di) => {
                        const k = day ? keyOf(day) : '';
                        const list = day ? byDay.get(k) ?? [] : [];
                        const sel = day != null && k === calSel;
                        const isToday = day != null && k === todayIso;
                        const anyCancel = list.some((s: any) => s.status === 'cancelled');
                        const allConfirmed = list.length > 0 && list.every((s: any) => s.status === 'confirmed');
                        const dotCol = anyCancel ? C.red : allConfirmed ? C.green : C.gold;
                        return (
                          <Pressable key={di} disabled={!day} onPress={() => day && setCalSel(sel ? null : k)} style={{ flex: 1, alignItems: 'center', gap: 3, paddingVertical: 3 }}>
                            <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: sel ? C.orangeGradB : 'transparent', borderWidth: isToday && !sel ? 1.5 : 0, borderColor: hexA(C.orange, 0.55) }}>
                              <Text style={{ fontFamily: sel || isToday ? F.bodyBold : F.body, fontSize: 12, color: sel ? '#fff' : isToday ? C.orange : day ? C.ink3 : 'transparent' }}>{day ?? 0}</Text>
                            </View>
                            <View style={{ height: 12, alignItems: 'center' }}>
                              {list.length ? (
                                <View style={{ paddingHorizontal: 5, borderRadius: 7, backgroundColor: hexA(dotCol, 0.18) }}>
                                  <Text style={{ fontFamily: F.mono, fontSize: 8.5, color: dotCol }}>{list.length}</Text>
                                </View>
                              ) : null}
                            </View>
                          </Pressable>
                        );
                      })}
                    </View>
                  ))}
                </View>
                {calSel ? (
                  selList.length === 0 ? <Body style={{ fontSize: 12, color: C.muted3, textAlign: 'center', paddingVertical: 10 }}>No roster sessions on this day.</Body> : selList.map(sessionCard)
                ) : (
                  <Body style={{ fontSize: 11.5, color: C.muted3, textAlign: 'center' }}>Tap a day to see its sessions.</Body>
                )}
              </>
            );
          })()
        ) : (tab === 'list' ? sessions : reschedRequests).length === 0 ? (
          <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 24 }}>{tab === 'list' ? 'No sessions this month.' : 'No reschedule requests.'}</Body>
        ) : (
          (tab === 'list' ? sessions : reschedRequests).slice(0, 80).map(sessionCard)
        )}

        {/* Cancel dialog */}
        <Modal visible={!!cancelFor} transparent animationType="fade" onRequestClose={() => setCancelFor(null)}>
          <Pressable onPress={() => setCancelFor(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', padding: 22 }}>
            <Pressable onPress={() => {}} style={{ borderRadius: 18, backgroundColor: '#141010', borderWidth: 1, borderColor: hexA(C.red, 0.3), padding: 18, gap: 12 }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: '#fff' }}>Cancel Session</Text>
              <Body style={{ fontSize: 12, color: C.muted2 }}>{cancelFor?.client_name} · {cancelFor ? fmtAt(cancelFor.scheduled_datetime) : ''}</Body>
              <Mono style={{ fontSize: 9, letterSpacing: 1, color: C.mono2 }}>CANCELLED BY</Mono>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {(['Client', 'Trainer'] as const).map((who) => {
                  const active = cancelBy === who;
                  return (
                    <Pressable key={who} onPress={() => setCancelBy(who)} style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 11, backgroundColor: hexA(C.red, active ? 0.16 : 0.04), borderWidth: 1, borderColor: hexA(C.red, active ? 0.5 : 0.16) }}>
                      <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 12, color: active ? C.red : C.muted }}>{who === 'Trainer' ? 'Doctor' : who}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Mono style={{ fontSize: 9, letterSpacing: 1, color: C.mono2 }}>REASON</Mono>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
                {['Client Request', 'Doctor Unavailable', 'Scheduling Conflict', 'Emergency', 'Other'].map((r) => {
                  const active = cancelRemark === r;
                  return (
                    <Pressable key={r} onPress={() => setCancelRemark(r)} style={{ paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, backgroundColor: active ? hexA(C.orange, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.orange, 0.5) : 'rgba(255,255,255,0.1)' }}>
                      <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 11.5, color: active ? C.orange : C.muted }}>{r}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <View style={{ flexDirection: 'row', gap: 9 }}>
                <Pressable onPress={() => setCancelFor(null)} style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
                  <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: C.ink }}>Keep</Text>
                </Pressable>
                <Pressable disabled={!cancelBy || !cancelRemark || cancelM.isPending} onPress={() => {
                  setErr(null);
                  cancelM.mutate({ session_id: cancelFor.id, canceled_by: cancelBy!, cancellation_remark: cancelRemark }, { onSuccess: () => setCancelFor(null), onError: (e: any) => { setCancelFor(null); setErr(e?.message ?? 'Failed'); } });
                }} style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: hexA(C.red, cancelBy && cancelRemark ? 0.16 : 0.06), borderWidth: 1, borderColor: hexA(C.red, cancelBy && cancelRemark ? 0.45 : 0.2) }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: cancelBy && cancelRemark ? C.red : C.muted3 }}>{cancelM.isPending ? 'Cancelling…' : 'Cancel Session'}</Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>

        {/* Reschedule dialog */}
        <Modal visible={!!reschedFor} transparent animationType="fade" onRequestClose={() => setReschedFor(null)}>
          <Pressable onPress={() => setReschedFor(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', padding: 22 }}>
            <Pressable onPress={() => {}} style={{ borderRadius: 18, backgroundColor: '#141010', borderWidth: 1, borderColor: hexA(C.blue, 0.3), padding: 18, gap: 12 }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: '#fff' }}>Reschedule Session</Text>
              <Body style={{ fontSize: 12, color: C.muted2 }}>{reschedFor?.client_name}</Body>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Mono style={{ fontSize: 9, letterSpacing: 1, color: C.mono2, marginBottom: 5 }}>DATE (YYYY-MM-DD)</Mono>
                  <TextInput value={reschedDate} onChangeText={setReschedDate} placeholder="2026-07-20" placeholderTextColor={C.muted3} style={[inputStyle, { fontFamily: F.mono }]} />
                </View>
                <View style={{ width: 100 }}>
                  <Mono style={{ fontSize: 9, letterSpacing: 1, color: C.mono2, marginBottom: 5 }}>TIME (HH:MM)</Mono>
                  <TextInput value={reschedTime} onChangeText={setReschedTime} placeholder="09:30" placeholderTextColor={C.muted3} style={[inputStyle, { fontFamily: F.mono }]} />
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 9 }}>
                <Pressable onPress={() => setReschedFor(null)} style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
                  <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: C.ink }}>Cancel</Text>
                </Pressable>
                <Pressable disabled={reschedM.isPending || !/^\d{4}-\d{2}-\d{2}$/.test(reschedDate) || !/^\d{2}:\d{2}$/.test(reschedTime)} onPress={() => {
                  setErr(null);
                  const dt = new Date(`${reschedDate}T${reschedTime}:00`);
                  reschedM.mutate({ session_id: reschedFor.id, new_datetime: dt.toISOString() }, { onSuccess: () => setReschedFor(null), onError: (e: any) => { setReschedFor(null); setErr(e?.message ?? 'Failed'); } });
                }} style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: hexA(C.blue, 0.14), borderWidth: 1, borderColor: hexA(C.blue, 0.4) }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: '#A9BCFF' }}>{reschedM.isPending ? 'Saving…' : 'Reschedule'}</Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>

        {/* Client filter picker */}
        <Modal visible={clientPickOpen} transparent animationType="slide" onRequestClose={() => setClientPickOpen(false)}>
          <Pressable onPress={() => setClientPickOpen(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' }}>
            <Pressable onPress={() => {}} style={{ maxHeight: '72%', backgroundColor: '#171210', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.15)', paddingHorizontal: 18, paddingTop: 16, paddingBottom: 26 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 10 }}>
                <Serif style={{ flex: 1, fontSize: 18, color: '#fff' }}>Filter by client</Serif>
                <Pressable onPress={() => setClientPickOpen(false)} hitSlop={10} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="close" size={15} color={C.muted2} />
                </Pressable>
              </View>
              <TextInput value={clientSearch} onChangeText={setClientSearch} placeholder="Search clients…" placeholderTextColor={C.muted3} style={[inputStyle, { marginBottom: 8 }]} />
              <ScrollView keyboardShouldPersistTaps="handled" style={{ flexShrink: 1 }} nestedScrollEnabled>
                {(clientsQ.data ?? [])
                  .filter((c) => !clientSearch.trim() || c.name.toLowerCase().includes(clientSearch.trim().toLowerCase()))
                  .slice(0, 60)
                  .map((c) => (
                    <Pressable key={c.id} onPress={() => { setClientSel(c); setClientPickOpen(false); setClientSearch(''); }} style={{ paddingVertical: 11, paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' }}>
                      <Body style={{ fontSize: 13, color: C.ink }}>{c.name}</Body>
                    </Pressable>
                  ))}
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>

        <BulkCreateSheet visible={bulkOpen} onClose={() => setBulkOpen(false)} doctors={doctorsQ.data ?? []} presetClient={clientSel ?? undefined} />
        <DeleteFutureSheet visible={delOpen} onClose={() => setDelOpen(false)} doctors={doctorsQ.data ?? []} presetClient={clientSel} />
      </Page>
    </HodGate>
  );
}

/* ---------- Bulk session creator (web HeadDoctorBulkSessionCreator contract) ---------- */
const WEEKDAYS = [['Sun', 0], ['Mon', 1], ['Tue', 2], ['Wed', 3], ['Thu', 4], ['Fri', 5], ['Sat', 6]] as const;

function RosterSheet({ visible, onClose, title, children, footer }: { visible: boolean; onClose: () => void; title: string; children: React.ReactNode; footer: React.ReactNode }) {
  const [kb, setKb] = React.useState(0);
  React.useEffect(() => {
    const s = Keyboard.addListener('keyboardDidShow', (e) => setKb(e.endCoordinates.height));
    const h = Keyboard.addListener('keyboardDidHide', () => setKb(0));
    return () => { s.remove(); h.remove(); };
  }, []);
  const close = () => { Keyboard.dismiss(); setTimeout(onClose, 60); };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end' }}>
        <Pressable style={{ flex: 1 }} onPress={close} />
        <View style={{ maxHeight: '90%', backgroundColor: '#171210', borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, borderColor: 'rgba(255,150,90,0.15)', paddingBottom: kb > 0 ? kb : 26 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 16, paddingBottom: 10 }}>
            <Serif style={{ fontSize: 19, color: '#fff' }}>{title}</Serif>
            <Pressable onPress={close} hitSlop={10} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="close" size={15} color={C.muted2} />
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 12, gap: 12 }}>
            {children}
          </ScrollView>
          <View style={{ paddingHorizontal: 18, paddingTop: 10, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' }}>{footer}</View>
        </View>
      </View>
    </Modal>
  );
}

function ClientSelect({ visible, value, onSelect }: { visible: boolean; value: { id: string; name: string } | null; onSelect: (c: { id: string; name: string } | null) => void }) {
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;
  const clientsQ = usePhysioDialogClients(uid, visible);
  const [search, setSearch] = React.useState('');
  const term = search.trim().toLowerCase();
  const list = (clientsQ.data ?? []).filter((c) => !term || c.name.toLowerCase().includes(term));
  return (
    <View style={{ gap: 8 }}>
      <Mono style={{ fontSize: 9, letterSpacing: 1, color: C.mono2 }}>CLIENT</Mono>
      {value ? (
        <Pressable onPress={() => onSelect(null)} style={{ flexDirection: 'row', alignItems: 'center', gap: 9, padding: 11, borderRadius: 12, backgroundColor: hexA(C.green, 0.08), borderWidth: 1, borderColor: hexA(C.green, 0.35) }}>
          <Icon name="user" size={13} color={C.green} />
          <Body style={{ flex: 1, fontSize: 13, color: '#fff' }}>{value.name}</Body>
          <Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: C.muted2 }}>Change</Text>
        </Pressable>
      ) : (
        <>
          <TextInput value={search} onChangeText={setSearch} placeholder="Search client…" placeholderTextColor={C.muted3} style={inputStyle} />
          {clientsQ.isLoading ? <ActivityIndicator color={C.orange} size="small" /> : (
            <View style={{ maxHeight: 190 }}>
              <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                {list.slice(0, 40).map((c) => (
                  <Pressable key={c.id} onPress={() => { Keyboard.dismiss(); onSelect(c); }} style={{ paddingVertical: 10, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' }}>
                    <Body style={{ fontSize: 12.5, color: C.muted }}>{c.name}</Body>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          )}
        </>
      )}
    </View>
  );
}

/* Wheel-style time picker — two snapping columns (hour / 5-min steps). Rendered as
   a Modal NESTED inside the RosterSheet's Modal tree (Android renders sibling
   modals blank + touch-blocking, so it must live inside the open sheet). */
const WHEEL_ITEM = 40;
function TimeWheelPicker({ visible, initial, onClose, onPick }: { visible: boolean; initial: string; onClose: () => void; onPick: (hhmm: string) => void }) {
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const mins = Array.from({ length: 12 }, (_, i) => i * 5);
  const [h, setH] = React.useState(9);
  const [m, setM] = React.useState(0);
  React.useEffect(() => {
    if (!visible) return;
    const mt = /^(\d{2}):(\d{2})$/.exec(initial);
    setH(mt ? Math.min(23, parseInt(mt[1], 10)) : 9);
    setM(mt ? Math.min(55, Math.round(parseInt(mt[2], 10) / 5) * 5) : 0);
  }, [visible]);
  const p2 = (n: number) => String(n).padStart(2, '0');
  const wheel = (data: number[], val: number, setVal: (n: number) => void) => (
    <View style={{ height: WHEEL_ITEM * 3, width: 72 }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        snapToInterval={WHEEL_ITEM}
        decelerationRate="fast"
        nestedScrollEnabled
        contentOffset={{ x: 0, y: data.indexOf(val) * WHEEL_ITEM }}
        contentContainerStyle={{ paddingVertical: WHEEL_ITEM }}
        onMomentumScrollEnd={(e) => {
          const idx = Math.max(0, Math.min(data.length - 1, Math.round(e.nativeEvent.contentOffset.y / WHEEL_ITEM)));
          setVal(data[idx]);
        }}
      >
        {data.map((n) => (
          <View key={n} style={{ height: WHEEL_ITEM, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontFamily: n === val ? F.bodyBold : F.body, fontSize: n === val ? 20 : 15, color: n === val ? C.orange : C.muted2 }}>{p2(n)}</Text>
          </View>
        ))}
      </ScrollView>
      {/* selection band */}
      <View pointerEvents="none" style={{ position: 'absolute', top: WHEEL_ITEM, left: 0, right: 0, height: WHEEL_ITEM, borderTopWidth: 1, borderBottomWidth: 1, borderColor: hexA(C.orange, 0.35) }} />
    </View>
  );
  if (!visible) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center', padding: 30 }}>
        <Pressable onPress={() => {}} style={{ width: '100%', maxWidth: 300, borderRadius: 20, backgroundColor: '#171210', borderWidth: 1, borderColor: 'rgba(255,150,90,0.2)', padding: 18, gap: 14 }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: '#fff', textAlign: 'center' }}>Pick a time</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            {wheel(hours, h, setH)}
            <Text style={{ fontFamily: F.bodyBold, fontSize: 20, color: C.muted2 }}>:</Text>
            {wheel(mins, m, setM)}
          </View>
          <Mono style={{ fontSize: 9, letterSpacing: 1, color: C.muted3, textAlign: 'center' }}>IST · 24 HOUR</Mono>
          <View style={{ flexDirection: 'row', gap: 9 }}>
            <Pressable onPress={onClose} style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: C.ink }}>Cancel</Text>
            </Pressable>
            <Pressable onPress={() => { onPick(`${p2(h)}:${p2(m)}`); onClose(); }} style={{ flex: 1, borderRadius: 12, overflow: 'hidden' }}>
              <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ alignItems: 'center', paddingVertical: 12 }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: '#fff' }}>Set {p2(h)}:{p2(m)}</Text>
              </LinearGradient>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function BulkCreateSheet({ visible, onClose, doctors, presetClient }: { visible: boolean; onClose: () => void; doctors: { id: string; name: string }[]; presetClient?: { id: string; name: string } }) {
  const bulkM = useBulkCreateRoster();
  const [mode, setMode] = React.useState<'create' | 'replicate'>('create');
  const [client, setClient] = React.useState<{ id: string; name: string } | null>(null);
  const [doctorSel, setDoctorSel] = React.useState<string | null>(null);
  const [modality, setModality] = React.useState<string>(DOCTOR_ROSTER_CREATE_MODALITIES[0]);
  const [days, setDays] = React.useState<Set<number>>(new Set());
  const [times, setTimes] = React.useState<Record<number, string>>({});
  // per-day overrides (web DaySchedule rows): doctor + modality fall back to defaults
  const [dayDoctor, setDayDoctor] = React.useState<Record<number, string | null>>({});
  const [dayModality, setDayModality] = React.useState<Record<number, string | null>>({});
  const [weeks, setWeeks] = React.useState('4');
  // startDate has no UI (web Create New iterates from today); Replicate still
  // auto-anchors to next Monday internally, matching the web Copy tab default.
  const [startDate, setStartDate] = React.useState('');
  const [timePickFor, setTimePickFor] = React.useState<number | null>(null);
  const [repBusy, setRepBusy] = React.useState(false);
  const [repNote, setRepNote] = React.useState<string | null>(null);

  const nextMondayYmd = () => {
    const n = new Date();
    n.setDate(n.getDate() + (((8 - n.getDay()) % 7) || 7));
    return n.toLocaleDateString('en-CA');
  };
  const reset = () => {
    setMode('create'); setClient(presetClient ?? null); setDoctorSel(null);
    setModality(DOCTOR_ROSTER_CREATE_MODALITIES[0]); setDays(new Set()); setTimes({});
    setDayDoctor({}); setDayModality({}); setWeeks('4'); setStartDate(''); setRepNote(null);
  };
  React.useEffect(() => { if (visible) reset(); }, [visible]);

  // Replicate: auto-fill from the client's previous roster (web Replicate tab logic).
  const runReplicate = async (c: { id: string; name: string }) => {
    setRepBusy(true); setRepNote(null);
    try {
      const pre = await fetchRosterReplicatePrefill(c.id);
      if (!pre) { setRepNote('No previous doctor roster found for this client — fill the form manually.'); return; }
      if (pre.defaultDoctor && doctors.some((d) => d.id === pre.defaultDoctor)) setDoctorSel(pre.defaultDoctor);
      if (pre.defaultModality && (DOCTOR_ROSTER_CREATE_MODALITIES as readonly string[]).includes(pre.defaultModality)) setModality(pre.defaultModality);
      const ds = new Set<number>();
      const t: Record<number, string> = {};
      const dd: Record<number, string | null> = {};
      const dm: Record<number, string | null> = {};
      Object.entries(pre.days).forEach(([k, v]) => {
        const day = Number(k);
        ds.add(day); t[day] = v.time;
        dd[day] = v.doctor && doctors.some((d) => d.id === v.doctor) ? v.doctor : null;
        dm[day] = v.modality ?? null;
      });
      setDays(ds); setTimes(t); setDayDoctor(dd); setDayModality(dm);
      setWeeks('4'); setStartDate(nextMondayYmd());
      setRepNote('Prefilled from the previous roster — review and adjust before creating.');
    } catch (e: any) {
      setRepNote(e?.message ?? 'Could not load the previous roster.');
    } finally { setRepBusy(false); }
  };

  const weeksN = Math.min(8, Math.max(1, parseInt(weeks, 10) || 0)); // web: 1–8 weeks
  const timesOk = [...days].every((d) => /^\d{2}:\d{2}$/.test(times[d] ?? ''));
  const startOk = !startDate || /^\d{4}-\d{2}-\d{2}$/.test(startDate);
  const canSubmit = !!client && !!doctorSel && days.size > 0 && (parseInt(weeks, 10) || 0) >= 1 && timesOk && startOk && !bulkM.isPending;

  const submit = async () => {
    if (!canSubmit || !client || !doctorSel) return;
    try {
      const result = await bulkM.mutateAsync({
        client_id: client.id,
        trainer_id: doctorSel,
        modality,
        preferences: [...days].sort((a, b) => a - b).map((d) => ({
          day_of_week: d,
          preferred_time: times[d],
          preferred_trainer_id: dayDoctor[d] ?? undefined,
          preferred_modality: dayModality[d] ?? undefined,
        })),
        weeks: weeksN,
        startDate: startDate ? new Date(`${startDate}T00:00:00`) : undefined,
      });
      reset(); onClose();
      const conflictNote = result.conflicts.length
        ? `\n${result.conflicts.length} skipped due to conflicts:\n${result.conflicts.slice(0, 5).map((c: any) => `• ${fmtAt(c.scheduled_datetime)} — ${c.reason}`).join('\n')}${result.conflicts.length > 5 ? '\n…' : ''}`
        : '';
      Alert.alert('Roster created', `${result.created} session${result.created === 1 ? '' : 's'} scheduled.${conflictNote}`);
    } catch (e: any) {
      Alert.alert('Failed to create sessions', e?.message ?? 'Unknown error');
    }
  };

  const cycleDayDoctor = (d: number) => {
    const opts: (string | null)[] = [null, ...doctors.map((x) => x.id)];
    const cur = opts.indexOf(dayDoctor[d] ?? null);
    setDayDoctor((p) => ({ ...p, [d]: opts[(cur + 1) % opts.length] }));
  };
  const cycleDayModality = (d: number) => {
    const opts: (string | null)[] = [null, ...DOCTOR_ROSTER_CREATE_MODALITIES];
    const cur = opts.indexOf(dayModality[d] ?? null);
    setDayModality((p) => ({ ...p, [d]: opts[(cur + 1) % opts.length] }));
  };
  const doctorName = (id: string | null) => (id ? doctors.find((x) => x.id === id)?.name ?? '—' : 'Default');

  return (
    <RosterSheet visible={visible} onClose={onClose} title="Create Roster" footer={
      <Pressable disabled={!canSubmit} onPress={submit} style={{ opacity: canSubmit ? 1 : 0.45, borderRadius: 13, overflow: 'hidden' }}>
        <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ paddingVertical: 13, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
          {bulkM.isPending ? <ActivityIndicator size="small" color="#fff" /> : null}
          <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: '#fff' }}>Create Sessions</Text>
        </LinearGradient>
      </Pressable>
    }>
      {/* Create / Replicate tabs (web HeadDoctorBulkSessionCreator) */}
      <View style={{ flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 999, padding: 3 }}>
        {([['create', 'Create'], ['replicate', 'Replicate']] as const).map(([id, lab]) => {
          const active = mode === id;
          return active ? (
            <LinearGradient key={id} colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 999 }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: '#fff' }}>{lab}</Text>
            </LinearGradient>
          ) : (
            <Pressable key={id} onPress={() => { setMode(id); setRepNote(null); if (id === 'replicate' && client) runReplicate(client); }} style={{ flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 999 }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: C.muted }}>{lab}</Text>
            </Pressable>
          );
        })}
      </View>
      {mode === 'replicate' ? (
        <Body style={{ fontSize: 10.5, color: C.muted3 }}>Pick a client — their previous 5 weeks of roster fill the form automatically (most-frequent doctor, modality and per-day times).</Body>
      ) : null}
      {repBusy ? <View style={{ paddingVertical: 6, alignItems: 'center' }}><ActivityIndicator size="small" color={C.orange} /></View> : null}
      {repNote ? <Body style={{ fontSize: 10.5, color: C.gold }}>{repNote}</Body> : null}

      <ClientSelect visible={visible} value={client} onSelect={(c) => { setClient(c); if (c && mode === 'replicate') runReplicate(c); }} />
      <View style={{ gap: 8 }}>
        <Mono style={{ fontSize: 9, letterSpacing: 1, color: C.mono2 }}>DEFAULT DOCTOR</Mono>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
          {doctors.map((d) => {
            const active = doctorSel === d.id;
            return (
              <Pressable key={d.id} onPress={() => setDoctorSel(d.id)} style={{ paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, backgroundColor: active ? hexA(C.blue, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.blue, 0.5) : 'rgba(255,255,255,0.09)' }}>
                <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 11.5, color: active ? '#A9BCFF' : C.muted }}>{d.name}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <View style={{ gap: 8 }}>
        <Mono style={{ fontSize: 9, letterSpacing: 1, color: C.mono2 }}>DEFAULT MODALITY</Mono>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {DOCTOR_ROSTER_CREATE_MODALITIES.map((m) => {
            const active = modality === m;
            return (
              <Pressable key={m} onPress={() => setModality(m)} style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 12, backgroundColor: active ? hexA(C.orange, 0.14) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.orange, 0.5) : 'rgba(255,255,255,0.09)' }}>
                <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: active ? C.orange : C.muted }}>{formatDoctorSessionType(m)}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <View style={{ gap: 8 }}>
        <Mono style={{ fontSize: 9, letterSpacing: 1, color: C.mono2 }}>TREATMENT DAYS</Mono>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {WEEKDAYS.map(([lab, d]) => {
            const active = days.has(d);
            return (
              <Pressable key={d} onPress={() => setDays((prev) => { const n = new Set(prev); if (n.has(d)) { n.delete(d); } else { n.add(d); setTimes((t) => ({ [d]: t[d] ?? '09:00', ...t })); } return n; })}
                style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 11, backgroundColor: active ? hexA(C.green, 0.14) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.green, 0.5) : 'rgba(255,255,255,0.09)' }}>
                <Text style={{ fontFamily: F.bodySemi, fontSize: 10.5, color: active ? C.green : C.muted2 }}>{lab}</Text>
              </Pressable>
            );
          })}
        </View>
        {[...days].sort((a, b) => a - b).map((d) => (
          <View key={d} style={{ backgroundColor: 'rgba(0,0,0,0.22)', borderRadius: 12, padding: 10, gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Body style={{ width: 40, fontSize: 12, fontFamily: F.bodySemi, color: '#fff' }}>{WEEKDAYS[d][0]}</Body>
              <Pressable onPress={() => setTimePickFor(d)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: hexA(C.orange, 0.3) }}>
                <Icon name="clock" size={13} color={C.orange} strokeWidth={2} />
                <Text style={{ flex: 1, fontFamily: F.mono, fontSize: 14, color: '#fff' }}>{times[d] ?? '09:00'}</Text>
                <Icon name="chevDown" size={11} color={C.muted3} strokeWidth={2.4} />
              </Pressable>
            </View>
            <View style={{ flexDirection: 'row', gap: 7 }}>
              <Pressable onPress={() => cycleDayDoctor(d)} style={{ flex: 1.4, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 7, borderRadius: 10, backgroundColor: hexA(C.blue, dayDoctor[d] ? 0.14 : 0.05), borderWidth: 1, borderColor: hexA(C.blue, dayDoctor[d] ? 0.45 : 0.18) }}>
                <Icon name="user" size={10} color={dayDoctor[d] ? '#A9BCFF' : C.muted3} strokeWidth={2.2} />
                <Text numberOfLines={1} style={{ fontFamily: F.bodySemi, fontSize: 10, color: dayDoctor[d] ? '#A9BCFF' : C.muted3 }}>{doctorName(dayDoctor[d] ?? null)}</Text>
              </Pressable>
              <Pressable onPress={() => cycleDayModality(d)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 7, borderRadius: 10, backgroundColor: hexA(C.orange, dayModality[d] ? 0.14 : 0.05), borderWidth: 1, borderColor: hexA(C.orange, dayModality[d] ? 0.45 : 0.18) }}>
                <Text numberOfLines={1} style={{ fontFamily: F.bodySemi, fontSize: 10, color: dayModality[d] ? C.orange : C.muted3 }}>{dayModality[d] ? formatDoctorSessionType(dayModality[d]!) : 'Default'}</Text>
              </Pressable>
            </View>
          </View>
        ))}
        {days.size ? <Body style={{ fontSize: 9.5, color: C.muted3 }}>Per-day doctor / modality fall back to the defaults above — tap to override.</Body> : null}
      </View>
      <View style={{ gap: 6 }}>
        <Mono style={{ fontSize: 9, letterSpacing: 1, color: C.mono2 }}>WEEKS</Mono>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => {
            const active = weeks === String(n);
            return (
              <Pressable key={n} onPress={() => setWeeks(String(n))} style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 11, backgroundColor: active ? hexA(C.orange, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.orange, 0.55) : 'rgba(255,255,255,0.09)' }}>
                <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 13, color: active ? C.orange : C.muted }}>{n}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      {mode === 'replicate' && startDate ? (
        <Body style={{ fontSize: 10.5, color: C.muted3 }}>Roster starts next Monday ({startDate}).</Body>
      ) : null}
      <Body style={{ fontSize: 10.5, color: C.muted3 }}>Sessions start from today. Slots already booked for the doctor or client at the exact time are skipped as conflicts.</Body>
      <TimeWheelPicker
        visible={timePickFor != null}
        initial={timePickFor != null ? (times[timePickFor] ?? '09:00') : '09:00'}
        onClose={() => setTimePickFor(null)}
        onPick={(hhmm) => { if (timePickFor != null) setTimes((t) => ({ ...t, [timePickFor]: hhmm })); }}
      />
    </RosterSheet>
  );
}

/* ---------- Delete future sessions (guarded hard delete — web contract; requires a selected client) ---------- */
function DeleteFutureSheet({ visible, onClose, doctors, presetClient }: { visible: boolean; onClose: () => void; doctors: { id: string; name: string }[]; presetClient: { id: string; name: string } | null }) {
  const delM = useDeleteFutureRoster();
  const [doctorSel, setDoctorSel] = React.useState<string | null>(null);
  const [confirm, setConfirm] = React.useState('');
  React.useEffect(() => { if (visible) { setDoctorSel(null); setConfirm(''); } }, [visible]);
  const canDelete = !!presetClient && confirm.trim().toLowerCase() === 'delete' && !delM.isPending;
  return (
    <RosterSheet visible={visible} onClose={onClose} title="Delete Future Sessions" footer={
      <Pressable disabled={!canDelete} onPress={async () => {
        if (!presetClient) return;
        try {
          await delM.mutateAsync({ client_id: presetClient.id, doctor_id: doctorSel ?? undefined });
          onClose();
          Alert.alert('Future sessions deleted', `All upcoming non-cancelled roster sessions for ${presetClient.name}${doctorSel ? ' with the selected doctor' : ''} were removed.`);
        } catch (e: any) {
          Alert.alert('Failed to delete sessions', e?.message ?? 'Unknown error');
        }
      }} style={{ opacity: canDelete ? 1 : 0.45, alignItems: 'center', paddingVertical: 13, borderRadius: 13, backgroundColor: hexA(C.red, 0.16), borderWidth: 1, borderColor: hexA(C.red, 0.5) }}>
        <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: C.red }}>{delM.isPending ? 'Deleting…' : 'Delete Future Sessions'}</Text>
      </Pressable>
    }>
      <Body style={{ fontSize: 12, color: C.muted2 }}>
        Permanently removes every upcoming (from today) non-cancelled roster session for <Text style={{ fontFamily: F.bodyBold, color: '#fff' }}>{presetClient?.name ?? '—'}</Text>. This cannot be undone.
      </Body>
      <View style={{ gap: 8 }}>
        <Mono style={{ fontSize: 9, letterSpacing: 1, color: C.mono2 }}>LIMIT TO DOCTOR (OPTIONAL)</Mono>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
          <Pressable onPress={() => setDoctorSel(null)} style={{ paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, backgroundColor: doctorSel === null ? hexA(C.orange, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: doctorSel === null ? hexA(C.orange, 0.5) : 'rgba(255,255,255,0.09)' }}>
            <Text style={{ fontFamily: F.bodySemi, fontSize: 11.5, color: doctorSel === null ? C.orange : C.muted }}>All Doctors</Text>
          </Pressable>
          {doctors.map((d) => {
            const active = doctorSel === d.id;
            return (
              <Pressable key={d.id} onPress={() => setDoctorSel(d.id)} style={{ paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, backgroundColor: active ? hexA(C.blue, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.blue, 0.5) : 'rgba(255,255,255,0.09)' }}>
                <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 11.5, color: active ? '#A9BCFF' : C.muted }}>{d.name}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <View style={{ gap: 6 }}>
        <Mono style={{ fontSize: 9, letterSpacing: 1, color: C.mono2 }}>TYPE "DELETE" TO CONFIRM</Mono>
        <TextInput value={confirm} onChangeText={setConfirm} placeholder="delete" placeholderTextColor={C.muted3} autoCapitalize="none" style={[inputStyle, { borderColor: hexA(C.red, 0.35) }]} />
      </View>
    </RosterSheet>
  );
}
