import React from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator, Modal, ScrollView, Keyboard, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, F, hexA, ORANGE_GRAD } from '../theme';
import { LinearGradient } from 'expo-linear-gradient';
import { Icon } from '../icons';
import { Serif, Body, Mono, Card } from '../components/primitives';
import { Page, TitleBlock, Badge } from './common';
import { useAuth } from '../auth';
import {
  useDoctorIdentity, useDoctorDaySessions, useNeuralChecksForDay, usePhysioSessionExercises,
  useDoctorOwnRoster, usePhysioDialogClients, useApprovedProtocols, useProtocolExercises,
  useRehabExerciseList, useSubmitPhysioSession, buildStructuredNotes, formatDoctorSessionType,
  RECOVERY_MODALITIES, COGNITIVE_TRAINING_TYPES, PhysioSubmitInput, PhysioSet, HEAD_DOCTOR_ID,
} from '../lib/doctorQueries';

/* ============ /doctor/sessions — day view + Log Physio Session (web port) ============ */

const fmtDayLong = (d: Date) => d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
const inputStyle = { paddingVertical: 11, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.03)', color: '#fff', fontFamily: F.body, fontSize: 13.5 } as const;
const labelStyle = { fontSize: 9.5, letterSpacing: 1.1, color: C.mono2, marginBottom: 6 } as const;

/* ---------- Session exercise details (web PhysioSessionExerciseDetails) ---------- */
function SessionExerciseDetails({ sessionId }: { sessionId: string }) {
  const [expanded, setExpanded] = React.useState(false);
  const q = usePhysioSessionExercises(sessionId, expanded);
  const groups = React.useMemo(() => {
    const map = new Map<string, any[]>();
    (q.data ?? []).forEach((r) => {
      const k = `${r.exercise_order}-${(r.exercise_name ?? '').trim().toLowerCase()}`;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(r);
    });
    return [...map.values()].sort((a, b) => (a[0].exercise_order ?? 0) - (b[0].exercise_order ?? 0));
  }, [q.data]);
  return (
    <View style={{ gap: 7 }}>
      <Pressable onPress={() => setExpanded((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <Icon name="dumbbell" size={12} color={C.blue} strokeWidth={2.1} />
        <Text style={{ flex: 1, fontFamily: F.bodySemi, fontSize: 11.5, color: '#A9BCFF' }}>Session Exercises</Text>
        <Icon name={expanded ? 'chevUp' : 'chevDown'} size={13} color={C.muted3} strokeWidth={2.2} />
      </Pressable>
      {expanded ? (
        q.isPending ? <ActivityIndicator color={C.orange} size="small" /> :
        groups.length === 0 ? <Body style={{ fontSize: 11, color: C.muted3 }}>No exercise data recorded.</Body> : (
          groups.map((rows, gi) => {
            const g = rows[0];
            const isRecovery = g.session_type === 'recovery';
            return (
              <View key={gi} style={{ padding: 10, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: hexA(isRecovery ? C.gold : C.blue, 0.2), gap: 5 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                  <Icon name={isRecovery ? 'sparkle' : 'dumbbell'} size={11} color={isRecovery ? C.gold : C.blue} strokeWidth={2.1} />
                  <Body style={{ flex: 1, fontSize: 12, fontFamily: F.bodySemi, color: '#fff' }}>{g.exercise_name}</Body>
                  <Mono style={{ fontSize: 8.5, color: C.muted3 }}>{isRecovery ? 'RECOVERY' : `${rows.length} SET${rows.length === 1 ? '' : 'S'}${g.phase ? ` · ${String(g.phase).toUpperCase()}` : ''}`}</Mono>
                </View>
                {rows.map((r, ri) => (
                  <Body key={ri} style={{ fontSize: 10.5, color: C.muted2 }}>
                    {isRecovery
                      ? [r.area_focused ? `Area ${r.area_focused}` : null, r.modality_duration ? `Duration ${r.modality_duration}` : null, r.modality_pressure ? `Pressure ${r.modality_pressure}` : null, r.modality_frequency ? `Temp ${r.modality_frequency}` : null, r.training_type ? `Training ${r.training_type}` : null, r.modality_notes ? `Notes: ${r.modality_notes}` : null].filter(Boolean).join(' · ') || '—'
                      : `Set ${r.set_number ?? ri + 1}: ${[r.reps != null ? `${r.reps} reps` : null, r.weight_kg != null ? `${r.weight_kg} kg` : null, r.duration || null].filter(Boolean).join(' · ') || '—'}`}
                  </Body>
                ))}
              </View>
            );
          })
        )
      ) : null}
    </View>
  );
}

/* ---------- Log Physio Session sheet (web PhysioSessionDialog port) ---------- */
export function PhysioSessionSheet({ visible, onClose, clientId, clientName }: { visible: boolean; onClose: () => void; clientId?: string; clientName?: string }) {
  const { session } = useAuth();
  const uid = session?.user?.id ?? '';
  const isSenior = uid === HEAD_DOCTOR_ID;
  const submitM = useSubmitPhysioSession();

  const [selClientId, setSelClientId] = React.useState('');
  const [selClientName, setSelClientName] = React.useState('');
  const activeClientId = clientId || selClientId;
  const activeClientName = clientName || selClientName;
  const clientsQ = usePhysioDialogClients(uid, visible && !clientId);
  const [clientSearch, setClientSearch] = React.useState('');

  const [category, setCategory] = React.useState<'' | 'rehab' | 'recovery'>('');
  const [tab, setTab] = React.useState<'with-plan' | 'log-session'>('log-session');
  const [cancelled, setCancelled] = React.useState(false);

  // Rehab with-plan
  const protocolsQ = useApprovedProtocols(visible && activeClientId ? activeClientId : null);
  const [protocolId, setProtocolId] = React.useState('');
  const [rehabPhase, setRehabPhase] = React.useState('');
  const [rehabNotes, setRehabNotes] = React.useState('');
  const planExQ = useProtocolExercises(protocolId || null, rehabPhase || undefined);
  const [checked, setChecked] = React.useState<Record<string, { exercise_name: string; exercise_order: number; sets: PhysioSet[] }>>({});

  // Rehab without-plan
  const emptyWp = { chief_complaint: '', current_status: '', pain_pre: '', pain_post: '', areas_treated: '', clinical_observation: '', treatments: [{ technique: '', target_area: '', reasoning: '' }], immediate_response: '', home_care: '', plan_next_session: '' };
  const [wpForm, setWpForm] = React.useState({ ...emptyWp });
  const [wpExercises, setWpExercises] = React.useState<{ id: string; exercise_name: string; sets: PhysioSet[] }[]>([]);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const rehabListQ = useRehabExerciseList(pickerOpen);
  const [pickerSearch, setPickerSearch] = React.useState('');

  // Recovery
  const [selectedModalities, setSelectedModalities] = React.useState<string[]>([]);
  const [modalityDetails, setModalityDetails] = React.useState<Record<string, any>>({});

  // Cognitive (doctors only; the whole sheet is doctor-only in this app)
  const [cogOn, setCogOn] = React.useState(false);
  const [markAsSession, setMarkAsSession] = React.useState(false);
  const emptyCog = { psychoemotional_state_index: null, delta: null, theta: null, alpha: null, beta: null, gamma: null } as PhysioSubmitInput['cognitive'];
  const [cog, setCog] = React.useState<PhysioSubmitInput['cognitive']>({ ...emptyCog });
  const isCognitiveOnly = cogOn && !category;

  const [err, setErr] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);

  // Manual keyboard height — reliable on Android 15 edge-to-edge where
  // KeyboardAvoidingView isn't (same pattern as the messenger composers). The
  // sheet gets paddingBottom = keyboard height so the scroll viewport always
  // ends ABOVE the keyboard and no input is ever covered.
  const insets = useSafeAreaInsets();
  const [kbH, setKbH] = React.useState(0);
  React.useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const s = Keyboard.addListener(showEvt, (e) => setKbH(e.endCoordinates?.height ?? 0));
    const h = Keyboard.addListener(hideEvt, () => setKbH(0));
    return () => { s.remove(); h.remove(); };
  }, []);
  const kbLift = kbH > 0 ? kbH + (Platform.OS === 'android' ? insets.bottom : 0) : 0;

  // Reset on open (web parity)
  React.useEffect(() => {
    if (!visible) return;
    setCategory(''); setTab('log-session'); setCancelled(false);
    setProtocolId(''); setRehabPhase(''); setRehabNotes(''); setChecked({});
    setWpForm({ ...emptyWp, treatments: [{ technique: '', target_area: '', reasoning: '' }] });
    setWpExercises([]); setSelectedModalities([]); setModalityDetails({});
    setCogOn(false); setMarkAsSession(false); setCog({ ...emptyCog });
    setErr(null); setDone(false);
    if (!clientId) { setSelClientId(''); setSelClientName(''); setClientSearch(''); }
  }, [visible]);
  // Approved protocols exist → default to With Plan (web effect)
  React.useEffect(() => { if ((protocolsQ.data ?? []).length > 0) setTab('with-plan'); }, [protocolsQ.data?.length]);
  // Phase/protocol change resets checked exercises (web effect)
  React.useEffect(() => { setChecked({}); }, [protocolId, rehabPhase]);

  const planGroups = React.useMemo(() => {
    const map = new Map<string, any[]>();
    (planExQ.data ?? []).forEach((r) => {
      const k = `${r.exercise_order}-${r.exercise_name}`;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(r);
    });
    return [...map.entries()];
  }, [planExQ.data]);

  const canSubmit = (() => {
    if (!activeClientId) return false;
    if (isCognitiveOnly) return Object.values(cog).some((v) => v != null);
    if (category === 'rehab') return tab === 'with-plan' ? !!(protocolId && rehabPhase) : !!wpForm.chief_complaint.trim();
    if (category === 'recovery') return selectedModalities.length > 0;
    return false;
  })();

  const doSubmit = async () => {
    if (!canSubmit || submitM.isPending) return;
    setErr(null);
    const input: PhysioSubmitInput = {
      doctorId: uid, clientId: activeClientId, clientName: activeClientName,
      category, cancelled, tab, protocolId,
      protocolComplaint: (protocolsQ.data ?? []).find((p: any) => p.id === protocolId)?.complaint ?? null,
      rehabPhase, rehabNotes, checkedExercises: Object.values(checked),
      wpForm, wpExercises: wpExercises.map(({ exercise_name, sets }) => ({ exercise_name, sets })),
      selectedModalities, modalityDetails,
      cognitiveEnabled: cogOn, markAsSession, cognitive: cog,
    };
    try {
      await submitM.mutateAsync(input);
      setDone(true);
      setTimeout(onClose, 700);
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to log session');
    }
  };

  const setCogField = (k: keyof PhysioSubmitInput['cognitive'], v: string) => {
    const num = v === '' ? null : Math.min(100, Math.max(0, parseFloat(v) || 0));
    setCog((p) => ({ ...p, [k]: num }));
  };

  const catBtn = (id: 'rehab' | 'recovery', label: string, icon: any) => {
    const active = category === id;
    return (
      <Pressable key={id} onPress={() => setCategory(active ? '' : id)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 12, borderRadius: 13, backgroundColor: active ? hexA(C.orange, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.orange, 0.5) : 'rgba(255,255,255,0.09)' }}>
        <Icon name={icon} size={14} color={active ? C.orange : C.muted} strokeWidth={2.1} />
        <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 13, color: active ? C.orange : C.muted }}>{label}</Text>
      </Pressable>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable onPress={() => { Keyboard.dismiss(); onClose(); }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)' }} />
        <View style={{ height: '92%', backgroundColor: '#0E0A09', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.14)', paddingHorizontal: 18, paddingTop: 14, paddingBottom: kbLift }}>
          <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 12 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: hexA(C.green, 0.13), alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="activity" size={16} color={C.green} strokeWidth={2.1} />
            </View>
            <View style={{ flex: 1 }}>
              <Serif style={{ fontSize: 19 }}>Log Physio Session</Serif>
              {activeClientName ? <Body style={{ fontSize: 11.5, color: C.muted2 }}>{activeClientName}</Body> : null}
            </View>
            <Pressable onPress={onClose} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="close" size={14} color="#B8B2AC" strokeWidth={2.3} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12, paddingBottom: 40 }}>
            {/* Client selector (only when no client passed) */}
            {!clientId ? (
              <View style={{ gap: 7 }}>
                <Mono style={labelStyle}>CLIENT *</Mono>
                {activeClientId ? (
                  <Pressable onPress={() => { setSelClientId(''); setSelClientName(''); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 9, padding: 11, borderRadius: 12, backgroundColor: hexA(C.orange, 0.1), borderWidth: 1, borderColor: hexA(C.orange, 0.4) }}>
                    <Icon name="user" size={13} color={C.orange} strokeWidth={2.1} />
                    <Body style={{ flex: 1, fontSize: 13, fontFamily: F.bodySemi, color: '#fff' }}>{activeClientName}</Body>
                    <Icon name="close" size={12} color={C.muted} strokeWidth={2.2} />
                  </Pressable>
                ) : (
                  <>
                    <TextInput value={clientSearch} onChangeText={setClientSearch} placeholder="Search client…" placeholderTextColor={C.muted3} style={inputStyle} />
                    <View style={{ maxHeight: 190, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }}>
                      <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled">
                        {(clientsQ.data ?? []).filter((c) => !clientSearch.trim() || c.name.toLowerCase().includes(clientSearch.trim().toLowerCase())).slice(0, 40).map((c) => (
                          <Pressable key={c.id} onPress={() => { Keyboard.dismiss(); setSelClientId(c.id); setSelClientName(c.name); }} style={{ paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' }}>
                            <Body style={{ fontSize: 13, color: C.ink }}>{c.name}</Body>
                          </Pressable>
                        ))}
                      </ScrollView>
                    </View>
                  </>
                )}
              </View>
            ) : null}

            {/* Cognitive toggle (web: doctors only) */}
            {activeClientId ? (
              <Pressable onPress={() => setCogOn((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 13, backgroundColor: hexA(C.purple, cogOn ? 0.12 : 0.05), borderWidth: 1, borderColor: hexA(C.purple, cogOn ? 0.45 : 0.2) }}>
                <View style={{ width: 22, height: 22, borderRadius: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: cogOn ? C.purple : 'rgba(255,255,255,0.05)', borderWidth: 1.5, borderColor: cogOn ? C.purple : 'rgba(255,255,255,0.2)' }}>
                  {cogOn ? <Icon path="M20 6 9 17l-5-5" size={12} color="#0c0808" strokeWidth={3} /> : null}
                </View>
                <Text style={{ flex: 1, fontFamily: F.bodySemi, fontSize: 13, color: cogOn ? C.purple : C.muted }}>Add Cognitive Health</Text>
              </Pressable>
            ) : null}

            {/* Cognitive fields */}
            {cogOn ? (
              <View style={{ padding: 13, borderRadius: 14, backgroundColor: hexA(C.purple, 0.05), borderWidth: 1, borderColor: hexA(C.purple, 0.22), gap: 9 }}>
                <Mono style={{ fontSize: 9.5, letterSpacing: 1.2, color: C.purple }}>COGNITIVE HEALTH · 0–100 (%)</Mono>
                {([['psychoemotional_state_index', 'Psychoemotional State Index'], ['delta', 'Delta'], ['theta', 'Theta'], ['alpha', 'Alpha'], ['beta', 'Beta'], ['gamma', 'Gamma']] as const).map(([k, lab]) => (
                  <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                    <Body style={{ flex: 1, fontSize: 12, color: C.ink3 }}>{lab}</Body>
                    <TextInput
                      value={cog[k] != null ? String(cog[k]) : ''}
                      onChangeText={(t) => setCogField(k, t.replace(/[^0-9.]/g, ''))}
                      keyboardType="decimal-pad" placeholder="0-100" placeholderTextColor={C.muted3}
                      style={[inputStyle, { width: 90, textAlign: 'center', paddingVertical: 8 }]}
                    />
                  </View>
                ))}
                {isCognitiveOnly ? (
                  <Pressable onPress={() => setMarkAsSession((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 3 }}>
                    <View style={{ width: 20, height: 20, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: markAsSession ? C.purple : 'rgba(255,255,255,0.05)', borderWidth: 1.5, borderColor: markAsSession ? C.purple : 'rgba(255,255,255,0.2)' }}>
                      {markAsSession ? <Icon path="M20 6 9 17l-5-5" size={11} color="#0c0808" strokeWidth={3} /> : null}
                    </View>
                    <Body style={{ flex: 1, fontSize: 11.5, color: C.muted2 }}>Mark as a session — also logs a Neural Check session</Body>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            {/* Category */}
            {activeClientId ? (
              <View style={{ gap: 7 }}>
                <Mono style={labelStyle}>SESSION CATEGORY{isCognitiveOnly ? ' (OPTIONAL — COGNITIVE ONLY)' : ' *'}</Mono>
                <View style={{ flexDirection: 'row', gap: 9 }}>
                  {catBtn('rehab', 'Rehab', 'heart')}
                  {catBtn('recovery', 'Recovery', 'sparkle')}
                </View>
              </View>
            ) : null}

            {/* REHAB */}
            {category === 'rehab' ? (
              <>
                <View style={{ flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 999, padding: 3 }}>
                  {([['with-plan', 'With Plan'], ['log-session', 'Without Plan']] as const).map(([id, lab]) => {
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

                {tab === 'with-plan' ? (
                  <>
                    <View style={{ gap: 7 }}>
                      <Mono style={labelStyle}>APPROVED PROTOCOL *</Mono>
                      {(protocolsQ.data ?? []).length === 0 ? (
                        <Body style={{ fontSize: 11.5, color: C.muted3 }}>No approved protocols for this client — use Without Plan.</Body>
                      ) : (protocolsQ.data ?? []).map((p: any) => {
                        const sel = protocolId === p.id;
                        return (
                          <Pressable key={p.id} onPress={() => setProtocolId(sel ? '' : p.id)} style={{ padding: 11, borderRadius: 12, backgroundColor: sel ? hexA(C.green, 0.1) : 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: sel ? hexA(C.green, 0.45) : 'rgba(255,255,255,0.08)' }}>
                            <Body style={{ fontSize: 12.5, fontFamily: sel ? F.bodyBold : F.bodySemi, color: sel ? C.green : '#fff' }} numberOfLines={2}>{p.complaint}</Body>
                          </Pressable>
                        );
                      })}
                    </View>
                    <View style={{ gap: 7 }}>
                      <Mono style={labelStyle}>PHASE *</Mono>
                      <View style={{ flexDirection: 'row', gap: 7 }}>
                        {([['initial', 'Initial'], ['intermediate', 'Intermediate'], ['advanced', 'Advanced']] as const).map(([id, lab]) => {
                          const sel = rehabPhase === id;
                          return (
                            <Pressable key={id} onPress={() => setRehabPhase(id)} style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 11, backgroundColor: sel ? hexA(C.gold, 0.14) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: sel ? hexA(C.gold, 0.45) : 'rgba(255,255,255,0.08)' }}>
                              <Text style={{ fontFamily: sel ? F.bodyBold : F.bodySemi, fontSize: 11.5, color: sel ? C.gold : C.muted }}>{lab}</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>
                    {protocolId && rehabPhase ? (
                      <View style={{ gap: 8 }}>
                        <Mono style={labelStyle}>PRESCRIBED EXERCISES — TICK WHAT WAS DONE</Mono>
                        {planExQ.isPending ? <ActivityIndicator color={C.orange} size="small" /> :
                        planGroups.length === 0 ? <Body style={{ fontSize: 11.5, color: C.muted3 }}>No exercises prescribed for this phase.</Body> :
                        planGroups.map(([key, rows]) => {
                          const ex = rows[0];
                          const isChecked = !!checked[key];
                          return (
                            <View key={key} style={{ padding: 11, borderRadius: 12, backgroundColor: isChecked ? hexA(C.green, 0.06) : 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: isChecked ? hexA(C.green, 0.35) : 'rgba(255,255,255,0.07)', gap: 8 }}>
                              <Pressable onPress={() => {
                                setChecked((prev) => {
                                  const next = { ...prev };
                                  if (next[key]) { delete next[key]; return next; }
                                  next[key] = {
                                    exercise_name: ex.exercise_name,
                                    exercise_order: ex.exercise_order,
                                    sets: rows.map((r: any) => ({ reps: r.reps?.toString() || '', weight_kg: r.load_kg?.toString() || '', duration: r.duration || '' })),
                                  };
                                  return next;
                                });
                              }} style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                                <View style={{ width: 20, height: 20, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: isChecked ? C.green : 'rgba(255,255,255,0.05)', borderWidth: 1.5, borderColor: isChecked ? C.green : 'rgba(255,255,255,0.2)' }}>
                                  {isChecked ? <Icon path="M20 6 9 17l-5-5" size={11} color="#0c0808" strokeWidth={3} /> : null}
                                </View>
                                <Body style={{ flex: 1, fontSize: 12.5, fontFamily: F.bodySemi, color: '#fff' }}>{ex.exercise_name}</Body>
                                <Mono style={{ fontSize: 8.5, color: C.muted3 }}>{rows.length} SET{rows.length === 1 ? '' : 'S'}</Mono>
                              </Pressable>
                              {isChecked ? checked[key].sets.map((s, si) => (
                                <View key={si} style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                                  <Mono style={{ width: 24, fontSize: 9, color: C.muted3 }}>S{si + 1}</Mono>
                                  <TextInput value={s.reps} onChangeText={(t) => setChecked((p) => ({ ...p, [key]: { ...p[key], sets: p[key].sets.map((x, xi) => xi === si ? { ...x, reps: t.replace(/[^0-9]/g, '') } : x) } }))} keyboardType="number-pad" placeholder="Reps" placeholderTextColor={C.muted3} style={[inputStyle, { flex: 1, paddingVertical: 8, textAlign: 'center' }]} />
                                  <TextInput value={s.weight_kg} onChangeText={(t) => setChecked((p) => ({ ...p, [key]: { ...p[key], sets: p[key].sets.map((x, xi) => xi === si ? { ...x, weight_kg: t.replace(/[^0-9.]/g, '') } : x) } }))} keyboardType="decimal-pad" placeholder="Kg" placeholderTextColor={C.muted3} style={[inputStyle, { flex: 1, paddingVertical: 8, textAlign: 'center' }]} />
                                  <TextInput value={s.duration} onChangeText={(t) => setChecked((p) => ({ ...p, [key]: { ...p[key], sets: p[key].sets.map((x, xi) => xi === si ? { ...x, duration: t } : x) } }))} placeholder="Duration" placeholderTextColor={C.muted3} style={[inputStyle, { flex: 1.2, paddingVertical: 8, textAlign: 'center' }]} />
                                </View>
                              )) : null}
                            </View>
                          );
                        })}
                        <TextInput value={rehabNotes} onChangeText={setRehabNotes} placeholder="Session notes (optional)" placeholderTextColor={C.muted3} multiline style={[inputStyle, { minHeight: 56, textAlignVertical: 'top' }]} />
                      </View>
                    ) : null}
                  </>
                ) : (
                  <View style={{ gap: 9 }}>
                    {([
                      ['chief_complaint', 'Chief Complaint *', false], ['current_status', 'Current Examination', false],
                    ] as const).map(([k, lab]) => (
                      <View key={k}>
                        <Mono style={labelStyle}>{lab.toUpperCase()}</Mono>
                        <TextInput value={(wpForm as any)[k]} onChangeText={(t) => setWpForm((p) => ({ ...p, [k]: t }))} placeholder={lab.replace(' *', '')} placeholderTextColor={C.muted3} multiline style={[inputStyle, { minHeight: 46, textAlignVertical: 'top' }]} />
                      </View>
                    ))}
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <View style={{ flex: 1 }}>
                        <Mono style={labelStyle}>PAIN PRE (VAS /10)</Mono>
                        <TextInput value={wpForm.pain_pre} onChangeText={(t) => setWpForm((p) => ({ ...p, pain_pre: t.replace(/[^0-9]/g, '').slice(0, 2) }))} keyboardType="number-pad" placeholder="—" placeholderTextColor={C.muted3} style={[inputStyle, { textAlign: 'center' }]} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Mono style={labelStyle}>PAIN POST (VAS /10)</Mono>
                        <TextInput value={wpForm.pain_post} onChangeText={(t) => setWpForm((p) => ({ ...p, pain_post: t.replace(/[^0-9]/g, '').slice(0, 2) }))} keyboardType="number-pad" placeholder="—" placeholderTextColor={C.muted3} style={[inputStyle, { textAlign: 'center' }]} />
                      </View>
                    </View>
                    {([
                      ['areas_treated', 'Area(s) Treated'], ['clinical_observation', 'Clinical Observation'],
                    ] as const).map(([k, lab]) => (
                      <View key={k}>
                        <Mono style={labelStyle}>{lab.toUpperCase()}</Mono>
                        <TextInput value={(wpForm as any)[k]} onChangeText={(t) => setWpForm((p) => ({ ...p, [k]: t }))} placeholder={lab} placeholderTextColor={C.muted3} multiline style={[inputStyle, { minHeight: 46, textAlignVertical: 'top' }]} />
                      </View>
                    ))}
                    <View style={{ gap: 7 }}>
                      <Mono style={labelStyle}>TREATMENT ADMINISTERED</Mono>
                      {wpForm.treatments.map((t, ti) => (
                        <View key={ti} style={{ padding: 10, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', gap: 6 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                            <Mono style={{ flex: 1, fontSize: 8.5, color: C.muted3 }}>TREATMENT {ti + 1}</Mono>
                            {wpForm.treatments.length > 1 ? (
                              <Pressable onPress={() => setWpForm((p) => ({ ...p, treatments: p.treatments.filter((_, i) => i !== ti) }))} hitSlop={8}>
                                <Icon name="close" size={12} color={C.muted2} strokeWidth={2.2} />
                              </Pressable>
                            ) : null}
                          </View>
                          <TextInput value={t.technique} onChangeText={(v) => setWpForm((p) => ({ ...p, treatments: p.treatments.map((x, i) => i === ti ? { ...x, technique: v } : x) }))} placeholder="Technique" placeholderTextColor={C.muted3} style={[inputStyle, { paddingVertical: 9 }]} />
                          <TextInput value={t.target_area} onChangeText={(v) => setWpForm((p) => ({ ...p, treatments: p.treatments.map((x, i) => i === ti ? { ...x, target_area: v } : x) }))} placeholder="Target area" placeholderTextColor={C.muted3} style={[inputStyle, { paddingVertical: 9 }]} />
                          <TextInput value={t.reasoning} onChangeText={(v) => setWpForm((p) => ({ ...p, treatments: p.treatments.map((x, i) => i === ti ? { ...x, reasoning: v } : x) }))} placeholder="Reasoning" placeholderTextColor={C.muted3} style={[inputStyle, { paddingVertical: 9 }]} />
                        </View>
                      ))}
                      <Pressable onPress={() => setWpForm((p) => ({ ...p, treatments: [...p.treatments, { technique: '', target_area: '', reasoning: '' }] }))} style={{ alignItems: 'center', paddingVertical: 9, borderRadius: 11, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.13)' }}>
                        <Text style={{ fontFamily: F.bodySemi, fontSize: 11.5, color: C.muted }}>+ Add treatment</Text>
                      </Pressable>
                    </View>
                    {([
                      ['immediate_response', 'Immediate Response to Treatment'], ['home_care', 'Home Care / Advice'], ['plan_next_session', 'Plan for Next Session'],
                    ] as const).map(([k, lab]) => (
                      <View key={k}>
                        <Mono style={labelStyle}>{lab.toUpperCase()}</Mono>
                        <TextInput value={(wpForm as any)[k]} onChangeText={(t) => setWpForm((p) => ({ ...p, [k]: t }))} placeholder={lab} placeholderTextColor={C.muted3} multiline style={[inputStyle, { minHeight: 46, textAlignVertical: 'top' }]} />
                      </View>
                    ))}
                    {/* WP exercises */}
                    <View style={{ gap: 7 }}>
                      <Mono style={labelStyle}>EXERCISES</Mono>
                      {wpExercises.map((ex, ei) => (
                        <View key={ex.id} style={{ padding: 10, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', gap: 6 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                            <TextInput value={ex.exercise_name} onChangeText={(v) => setWpExercises((p) => p.map((x, i) => i === ei ? { ...x, exercise_name: v } : x))} placeholder="Exercise name" placeholderTextColor={C.muted3} style={[inputStyle, { flex: 1, paddingVertical: 9 }]} />
                            <Pressable onPress={() => setWpExercises((p) => p.filter((_, i) => i !== ei))} hitSlop={8}><Icon name="close" size={13} color={C.muted2} strokeWidth={2.2} /></Pressable>
                          </View>
                          {ex.sets.map((s, si) => (
                            <View key={si} style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                              <Mono style={{ width: 24, fontSize: 9, color: C.muted3 }}>S{si + 1}</Mono>
                              <TextInput value={s.reps} onChangeText={(t) => setWpExercises((p) => p.map((x, i) => i === ei ? { ...x, sets: x.sets.map((y, yi) => yi === si ? { ...y, reps: t.replace(/[^0-9]/g, '') } : y) } : x))} keyboardType="number-pad" placeholder="Reps" placeholderTextColor={C.muted3} style={[inputStyle, { flex: 1, paddingVertical: 8, textAlign: 'center' }]} />
                              <TextInput value={s.weight_kg} onChangeText={(t) => setWpExercises((p) => p.map((x, i) => i === ei ? { ...x, sets: x.sets.map((y, yi) => yi === si ? { ...y, weight_kg: t.replace(/[^0-9.]/g, '') } : y) } : x))} keyboardType="decimal-pad" placeholder="Kg" placeholderTextColor={C.muted3} style={[inputStyle, { flex: 1, paddingVertical: 8, textAlign: 'center' }]} />
                              <TextInput value={s.duration} onChangeText={(t) => setWpExercises((p) => p.map((x, i) => i === ei ? { ...x, sets: x.sets.map((y, yi) => yi === si ? { ...y, duration: t } : y) } : x))} placeholder="Duration" placeholderTextColor={C.muted3} style={[inputStyle, { flex: 1.2, paddingVertical: 8, textAlign: 'center' }]} />
                            </View>
                          ))}
                          <Pressable onPress={() => setWpExercises((p) => p.map((x, i) => i === ei ? { ...x, sets: [...x.sets, { reps: '', weight_kg: '', duration: '' }] } : x))} style={{ alignItems: 'center', paddingVertical: 7 }}>
                            <Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: C.muted }}>+ Add set</Text>
                          </Pressable>
                        </View>
                      ))}
                      <Pressable onPress={() => { setPickerSearch(''); setPickerOpen(true); }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 11, borderRadius: 12, borderWidth: 1.5, borderStyle: 'dashed', borderColor: hexA(C.orange, 0.32), backgroundColor: hexA(C.orange, 0.05) }}>
                        <Icon name="plus" size={13} color={C.orange} strokeWidth={2.5} />
                        <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: C.orange }}>Add Exercise</Text>
                      </Pressable>
                    </View>
                  </View>
                )}
              </>
            ) : null}

            {/* RECOVERY */}
            {category === 'recovery' ? (
              <View style={{ gap: 9 }}>
                <Mono style={labelStyle}>MODALITIES * (SELECT ALL USED)</Mono>
                {RECOVERY_MODALITIES.map((m) => {
                  const sel = selectedModalities.includes(m.value);
                  const d = modalityDetails[m.value] || {};
                  return (
                    <View key={m.value} style={{ padding: 11, borderRadius: 12, backgroundColor: sel ? hexA(C.gold, 0.06) : 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: sel ? hexA(C.gold, 0.38) : 'rgba(255,255,255,0.07)', gap: 8 }}>
                      <Pressable onPress={() => {
                        setSelectedModalities((p) => sel ? p.filter((x) => x !== m.value) : [...p, m.value]);
                        setModalityDetails((p) => { const n = { ...p }; if (sel) delete n[m.value]; else n[m.value] = { modality: m.value }; return n; });
                      }} style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                        <View style={{ width: 20, height: 20, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: sel ? C.gold : 'rgba(255,255,255,0.05)', borderWidth: 1.5, borderColor: sel ? C.gold : 'rgba(255,255,255,0.2)' }}>
                          {sel ? <Icon path="M20 6 9 17l-5-5" size={11} color="#0c0808" strokeWidth={3} /> : null}
                        </View>
                        <Body style={{ flex: 1, fontSize: 13, fontFamily: sel ? F.bodyBold : F.bodySemi, color: sel ? '#fff' : C.muted }}>{m.label}</Body>
                      </Pressable>
                      {sel ? (
                        <View style={{ gap: 6 }}>
                          {m.value === 'red_light_therapy' ? (
                            <>
                              <TextInput value={d.area_focused ?? ''} onChangeText={(t) => setModalityDetails((p) => ({ ...p, [m.value]: { ...p[m.value], area_focused: t } }))} placeholder="Area focused" placeholderTextColor={C.muted3} style={[inputStyle, { paddingVertical: 9 }]} />
                              <View style={{ flexDirection: 'row', gap: 6 }}>
                                <TextInput value={d.rlt_duration ?? ''} onChangeText={(t) => setModalityDetails((p) => ({ ...p, [m.value]: { ...p[m.value], rlt_duration: t } }))} placeholder="Duration" placeholderTextColor={C.muted3} style={[inputStyle, { flex: 1, paddingVertical: 9 }]} />
                                <TextInput value={d.rlt_temperature ?? ''} onChangeText={(t) => setModalityDetails((p) => ({ ...p, [m.value]: { ...p[m.value], rlt_temperature: t } }))} placeholder="Temperature" placeholderTextColor={C.muted3} style={[inputStyle, { flex: 1, paddingVertical: 9 }]} />
                              </View>
                            </>
                          ) : m.value === 'pneumatic_compression' ? (
                            <View style={{ flexDirection: 'row', gap: 6 }}>
                              <TextInput value={d.pc_duration ?? ''} onChangeText={(t) => setModalityDetails((p) => ({ ...p, [m.value]: { ...p[m.value], pc_duration: t } }))} placeholder="Duration" placeholderTextColor={C.muted3} style={[inputStyle, { flex: 1, paddingVertical: 9 }]} />
                              <TextInput value={d.pc_pressure ?? ''} onChangeText={(t) => setModalityDetails((p) => ({ ...p, [m.value]: { ...p[m.value], pc_pressure: t } }))} placeholder="Pressure" placeholderTextColor={C.muted3} style={[inputStyle, { flex: 1, paddingVertical: 9 }]} />
                            </View>
                          ) : m.value === 'cognitive_entrainment' ? (
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                              {COGNITIVE_TRAINING_TYPES.map((tt) => {
                                const on = d.ce_training_type === tt;
                                return (
                                  <Pressable key={tt} onPress={() => setModalityDetails((p) => ({ ...p, [m.value]: { ...p[m.value], ce_training_type: on ? undefined : tt } }))} style={{ paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999, backgroundColor: on ? hexA(C.purple, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: on ? hexA(C.purple, 0.45) : 'rgba(255,255,255,0.08)' }}>
                                    <Text style={{ fontFamily: on ? F.bodyBold : F.body, fontSize: 10.5, color: on ? C.purple : C.muted }}>{tt}</Text>
                                  </Pressable>
                                );
                              })}
                            </View>
                          ) : null}
                          <TextInput value={d.modality_notes ?? ''} onChangeText={(t) => setModalityDetails((p) => ({ ...p, [m.value]: { ...p[m.value], modality_notes: t } }))} placeholder="Notes" placeholderTextColor={C.muted3} multiline style={[inputStyle, { minHeight: 42, textAlignVertical: 'top' }]} />
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            ) : null}

            {/* Cancelled */}
            {category ? (
              <Pressable onPress={() => setCancelled((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                <View style={{ width: 20, height: 20, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: cancelled ? C.red : 'rgba(255,255,255,0.05)', borderWidth: 1.5, borderColor: cancelled ? C.red : 'rgba(255,255,255,0.2)' }}>
                  {cancelled ? <Icon path="M20 6 9 17l-5-5" size={11} color="#0c0808" strokeWidth={3} /> : null}
                </View>
                <Body style={{ fontSize: 12.5, color: cancelled ? C.red : C.muted }}>Mark as Cancelled</Body>
              </Pressable>
            ) : null}

            {err ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 11, borderRadius: 12, backgroundColor: hexA(C.red, 0.08), borderWidth: 1, borderColor: hexA(C.red, 0.28) }}>
                <Icon name="alert" size={13} color={C.red} strokeWidth={2.2} />
                <Body style={{ flex: 1, fontSize: 11.5, color: '#E0A090' }}>{err}</Body>
              </View>
            ) : null}

            <Pressable onPress={doSubmit} disabled={!canSubmit || submitM.isPending} style={{ opacity: canSubmit && !submitM.isPending ? 1 : 0.5 }}>
              <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 14 }}>
                <Icon name="checks" size={15} color="#fff" strokeWidth={2.5} />
                <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: '#fff' }}>{submitM.isPending ? 'Saving…' : done ? 'Saved ✓' : isCognitiveOnly ? (markAsSession ? 'Log Neural Check Session' : 'Save Cognitive Metrics') : 'Log Session'}</Text>
              </LinearGradient>
            </Pressable>
          </ScrollView>
        </View>

        {/* Rehab exercise picker */}
        <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
          <View style={{ flex: 1, justifyContent: 'flex-end' }}>
            <Pressable onPress={() => setPickerOpen(false)} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)' }} />
            <View style={{ maxHeight: '75%', backgroundColor: '#0E0A09', borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.14)', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 22 }}>
              <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 10 }} />
              <Serif style={{ fontSize: 18, marginBottom: 8 }}>Rehab Exercises</Serif>
              <TextInput value={pickerSearch} onChangeText={setPickerSearch} placeholder="Search…" placeholderTextColor={C.muted3} style={[inputStyle, { marginBottom: 8 }]} />
              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 6, paddingBottom: 10 }}>
                {(rehabListQ.data ?? []).filter((e: any) => {
                  const q = pickerSearch.trim().toLowerCase();
                  return !q || (e.exercise ?? '').toLowerCase().includes(q) || (e.muscle_group ?? '').toLowerCase().includes(q) || (e.equipment ?? '').toLowerCase().includes(q);
                }).slice(0, 80).map((e: any) => (
                  <Pressable key={e.id} onPress={() => {
                    Keyboard.dismiss();
                    setWpExercises((p) => [...p, { id: `wp-${Date.now()}`, exercise_name: e.exercise ?? '', sets: [{ reps: '', weight_kg: '', duration: '' }] }]);
                    setPickerOpen(false);
                  }} style={{ paddingVertical: 10, paddingHorizontal: 12, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }}>
                    <Body style={{ fontSize: 12.5, fontFamily: F.bodySemi, color: '#fff' }}>{e.exercise}</Body>
                    <Body style={{ fontSize: 10, color: C.muted3, marginTop: 1 }}>{[e.muscle_group, e.equipment].filter(Boolean).join(' · ')}</Body>
                  </Pressable>
                ))}
                <Pressable onPress={() => {
                  setWpExercises((p) => [...p, { id: `wp-${Date.now()}`, exercise_name: '', sets: [{ reps: '', weight_kg: '', duration: '' }] }]);
                  setPickerOpen(false);
                }} style={{ alignItems: 'center', paddingVertical: 11, borderRadius: 11, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.13)' }}>
                  <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: C.muted }}>+ Custom exercise</Text>
                </Pressable>
              </ScrollView>
            </View>
          </View>
        </Modal>
      </View>
    </Modal>
  );
}

/* ---------- Sessions page ---------- */
export function DoctorSessionsPage() {
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;
  const identity = useDoctorIdentity();
  const [date, setDate] = React.useState(new Date());
  const [view, setView] = React.useState<'sessions' | 'schedule'>('sessions');
  const [logOpen, setLogOpen] = React.useState(false);

  const dayQ = useDoctorDaySessions(date);
  const ncQ = useNeuralChecksForDay(uid, date, identity.data.isHeadDoctor);
  // web DoctorRosterSection: the Schedule tab has its OWN month, independent of the day strip
  const [scheduleMonth, setScheduleMonth] = React.useState(new Date());
  const rosterQ = useDoctorOwnRoster(scheduleMonth);

  const sessions = React.useMemo(() => {
    const real = (dayQ.data ?? []).map((s) => ({ ...s, isNeuralCheck: false as const, neural: null as any }));
    const pseudo = identity.data.isHeadDoctor
      ? (ncQ.data ?? []).map((nc) => ({
          id: `neural-${nc.id}`, clientName: nc.resolvedName, clientId: nc.client_id ?? '',
          time: new Date(nc.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }),
          location: '', focus: 'neural_check', attended: true, remarks: null, date: nc.created_at,
          cancelled: false, isUnique: null, sessionName: 'Neural Check', hasPhysioExercises: false,
          isNeuralCheck: true as const, neural: nc,
        }))
      : [];
    return [...real, ...pseudo].sort((a, b) => b.time.localeCompare(a.time));
  }, [dayQ.data, ncQ.data, identity.data.isHeadDoctor]);
  const attended = sessions.filter((s) => s.attended && !s.cancelled);

  const shiftDay = (d: number) => setDate((prev) => { const n = new Date(prev); n.setDate(n.getDate() + d); return n; });
  const shiftScheduleMonth = (d: number) => setScheduleMonth((prev) => { const n = new Date(prev); n.setMonth(n.getMonth() + d); return n; });
  const scheduleMonthLabel = scheduleMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  // web: highlight block filters the month's rows to the day-strip date
  const rosterToday = (rosterQ.data ?? []).filter((r: any) => new Date(r.scheduled_datetime).toDateString() === date.toDateString());
  const rosterStatusColor = (s: string | null) => (s === 'cancelled' ? C.red : s === 'confirmed' ? C.blue : s === 'completed' ? C.green : C.gold);

  return (
    <Page gap={13} pt={6}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <TitleBlock title="Sessions" sub="Doctor session log & schedule" />
        </View>
        {identity.data.isPhysio || identity.data.isHeadDoctor ? (
          <Pressable onPress={() => setLogOpen(true)}>
            <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12 }}>
              <Icon name="plus" size={13} color="#fff" strokeWidth={2.6} />
              <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: '#fff' }}>Log Session</Text>
            </LinearGradient>
          </Pressable>
        ) : null}
      </View>

      {/* Date strip */}
      <Card colors={['rgba(46,28,18,0.45)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.12)" radius={16} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 13 }}>
        <Pressable onPress={() => shiftDay(-1)} hitSlop={8} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="chevLeft" size={15} color={C.ink3} strokeWidth={2.3} />
        </Pressable>
        <Text style={{ flex: 1, textAlign: 'center', fontFamily: F.bodyBold, fontSize: 14.5, color: '#fff' }}>{fmtDayLong(date)}</Text>
        <Pressable onPress={() => shiftDay(1)} hitSlop={8} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="chevRight" size={15} color={C.ink3} strokeWidth={2.3} />
        </Pressable>
      </Card>

      {/* Tabs */}
      <View style={{ flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 999, padding: 3 }}>
        {([['sessions', 'Sessions'], ['schedule', 'Schedule']] as const).map(([id, lab]) => {
          const active = view === id;
          return active ? (
            <LinearGradient key={id} colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 999 }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: '#fff' }}>{lab}</Text>
            </LinearGradient>
          ) : (
            <Pressable key={id} onPress={() => setView(id)} style={{ flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 999 }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: C.muted }}>{lab}</Text>
            </Pressable>
          );
        })}
      </View>

      {view === 'sessions' ? (
        <>
          {attended.length ? (
            <View style={{ gap: 7 }}>
              <Mono style={{ fontSize: 10, letterSpacing: 1.4, color: C.mono2 }}>TODAY'S ATTENDANCE</Mono>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {attended.map((s) => (
                  <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999, backgroundColor: hexA(C.green, 0.12), borderWidth: 1, borderColor: hexA(C.green, 0.32) }}>
                    <Icon name="checks" size={10} color={C.green} strokeWidth={2.5} />
                    <Text style={{ fontFamily: F.bodySemi, fontSize: 10.5, color: C.green }}>{s.clientName}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {dayQ.isPending ? (
            <View style={{ paddingVertical: 28, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View>
          ) : sessions.length === 0 ? (
            <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 26 }}>No sessions on this day.</Body>
          ) : sessions.map((s) => {
            const isNC = s.isNeuralCheck;
            return (
              <Card key={s.id} colors={isNC ? ['rgba(50,22,38,0.5)', 'rgba(18,14,14,0.5)'] : ['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border={hexA(isNC ? C.purple : s.cancelled ? C.red : C.green, 0.22)} radius={16} style={{ padding: 13, gap: 9 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: hexA(isNC ? C.purple : C.blue, 0.13), alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name={isNC ? 'sparkle' : 'clock'} size={14} color={isNC ? C.purple : C.blue} strokeWidth={2.1} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Body style={{ fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }} numberOfLines={1}>{s.clientName}</Body>
                    <Body style={{ fontSize: 10.5, color: C.muted2, marginTop: 1 }}>{s.time}{s.location ? ` · ${s.location}` : ''}</Body>
                  </View>
                  <Badge text={isNC ? 'Neural Check' : formatDoctorSessionType(s.focus)} color={isNC ? C.purple : C.blue} />
                  {s.cancelled ? <Badge text="Cancelled" color={C.red} /> : s.attended ? <Badge text="Attended" color={C.green} /> : null}
                </View>
                {isNC && s.neural ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {([['PSI', s.neural.psychoemotional_state_index], ['Delta', s.neural.delta], ['Theta', s.neural.theta], ['Alpha', s.neural.alpha], ['Beta', s.neural.beta], ['Gamma', s.neural.gamma]] as const).map(([lab, v]) => (
                      <View key={lab} style={{ width: '31%', flexGrow: 1, padding: 8, borderRadius: 10, backgroundColor: hexA(C.purple, 0.07), borderWidth: 1, borderColor: hexA(C.purple, 0.2) }}>
                        <Mono style={{ fontSize: 7.5, color: C.muted3 }}>{lab}</Mono>
                        <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: C.purple, marginTop: 2 }}>{v != null ? `${v}%` : '—'}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
                {s.remarks ? <Body style={{ fontSize: 11, color: C.muted2, fontStyle: 'italic' }} numberOfLines={4}>"{s.remarks}"</Body> : null}
                {s.hasPhysioExercises && !isNC ? <SessionExerciseDetails sessionId={s.id} /> : null}
              </Card>
            );
          })}
        </>
      ) : (
        <>
          {/* My Roster header + month nav (web DoctorRosterSection) */}
          <Card colors={['rgba(46,28,18,0.45)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.12)" radius={16} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 13, gap: 8 }}>
            <Icon name="calendar" size={14} color={C.orange} strokeWidth={2.1} />
            <Text style={{ flex: 1, fontFamily: F.bodyBold, fontSize: 13.5, color: '#fff' }}>My Roster</Text>
            <Pressable onPress={() => shiftScheduleMonth(-1)} hitSlop={8} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="chevLeft" size={13} color={C.ink3} strokeWidth={2.3} />
            </Pressable>
            <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: '#fff', minWidth: 86, textAlign: 'center' }}>{scheduleMonthLabel}</Text>
            <Pressable onPress={() => shiftScheduleMonth(1)} hitSlop={8} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="chevRight" size={13} color={C.ink3} strokeWidth={2.3} />
            </Pressable>
          </Card>

          {rosterQ.isPending ? (
            <View style={{ paddingVertical: 28, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View>
          ) : (rosterQ.data ?? []).length === 0 ? (
            <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 26 }}>No roster sessions for this month</Body>
          ) : (
            <>
              {/* Selected-day highlight (web "Today's Roster") */}
              {rosterToday.length > 0 ? (
                <Card colors={['rgba(46,28,18,0.5)', 'rgba(18,14,14,0.5)']} border={hexA(C.orange, 0.3)} radius={15} style={{ padding: 12, gap: 8 }}>
                  <Body style={{ fontSize: 12, fontFamily: F.bodyBold, color: C.orange }}>Today's Roster ({rosterToday.length} session{rosterToday.length === 1 ? '' : 's'})</Body>
                  {rosterToday.map((r: any) => (
                    <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                      <Body style={{ flex: 1, fontSize: 12.5, fontFamily: F.bodySemi, color: '#fff' }} numberOfLines={1}>{r.client_name}</Body>
                      <Mono style={{ fontSize: 10.5, color: C.muted2 }}>{new Date(r.scheduled_datetime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}</Mono>
                      <Badge text={r.status || 'scheduled'} color={rosterStatusColor(r.status)} />
                    </View>
                  ))}
                </Card>
              ) : null}

              <Body style={{ fontSize: 11.5, color: C.muted2 }}>
                Total: <Text style={{ fontFamily: F.bodyBold, color: '#fff' }}>{(rosterQ.data ?? []).length}</Text> sessions in {scheduleMonthLabel}
              </Body>

              {/* Full month list */}
              {(rosterQ.data ?? []).map((r: any) => {
                const dt = new Date(r.scheduled_datetime);
                const isToday = dt.toDateString() === new Date().toDateString();
                return (
                  <Card key={r.id} colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border={isToday ? hexA(C.orange, 0.35) : 'rgba(255,150,90,0.1)'} radius={15} style={{ padding: 12, flexDirection: 'row', alignItems: 'center', gap: 11 }}>
                    <View style={{ width: 64 }}>
                      <Mono style={{ fontSize: 10.5, color: isToday ? C.orange : C.muted }}>{dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</Mono>
                      <Mono style={{ fontSize: 10, color: C.muted3, marginTop: 1 }}>{dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}</Mono>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Body style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }} numberOfLines={1}>{r.client_name}</Body>
                      <Body style={{ fontSize: 10.5, color: C.muted2, marginTop: 1 }}>{formatDoctorSessionType(r.modality || r.session_type)}</Body>
                    </View>
                    <Badge text={r.status || 'scheduled'} color={rosterStatusColor(r.status)} />
                  </Card>
                );
              })}
            </>
          )}
        </>
      )}

      <PhysioSessionSheet visible={logOpen} onClose={() => setLogOpen(false)} />
    </Page>
  );
}
