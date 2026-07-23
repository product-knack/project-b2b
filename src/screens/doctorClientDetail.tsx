import React from 'react';
import { View, Text, TextInput, Pressable, Modal, ScrollView, ActivityIndicator, Keyboard, Alert, Switch, Linking, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as DocumentPicker from 'expo-document-picker';
import { C, F, hexA, ORANGE_GRAD } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono, Card, Avatar } from '../components/primitives';
import { Page, BackLink, Badge, AnimChip, HScroll } from './common';
import { PdfPreview } from '../components/PdfPreview';
import { useStore } from '../store';
import { useAuth } from '../auth';
import { trackClientTab } from '../lib/amplitude';
import {
  HEAD_DOCTOR_ID, formatDoctorSessionType,
  useDoctorIdentity, useDoctorClientHeader, useDoctorClientSessionCounts,
  usePhysioProtocols, useProtocolExercises, useCreateProtocol, useRehabExerciseList,
  ProtocolExerciseInput,
  useRehabSessions, usePhysioCounselling, useAddPhysioCounselling, useGenerateCounsellingAI,
  useCancelledClientSessions, useClientMedicalHistory, useAddMedicalHistory, useDeleteMedicalHistory,
  useAiUploadMedicalDocs, PickedDoc,
  MEDICAL_CATEGORIES, MEDICAL_CATEGORY_LABELS, MEDICAL_SEVERITIES,
  useClientFindings, useToggleFindingShared,
  useDoctorClientRemarks, useAddClientRemark, useUpdateClientRemark, useDeleteClientRemark, REMARKS_PER_PAGE,
  useAssignableDoctors, useAssignDoctors, useClientDoctorAssignments,
} from '../lib/doctorQueries';
import { useWorkoutSessionExercises, useClientCrm } from '../lib/doctorQueries';
import { useWorkoutSessions } from '../lib/adminClientDetailQueries';
import { useClientHealthReports } from '../lib/qhpQueries';
import { PhysioSessionSheet } from './doctorSessions';
import { ServicesButton } from '../components/servicesButton';

/* ============ Doctor → Client Detail (web DoctorClientDetail.tsx port) ============
   Native tab set covers the doctor-specific surface: Sessions (protocols /
   rehab sessions / counselling / cancelled), Medical History, Reports
   (health reports + findings), Notes (team remarks). Shared web tabs
   (Whoop / HeartMath / Progression / QHP) live on their own native pages. */

const fmtD = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const fmtDT = (iso?: string | null) => (iso ? `${fmtD(iso)}, ${new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}` : '—');
const CARD_G: [string, string] = ['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)'];
const PURPLE = '#A78BFA';

const SEVERITY_COLOR: Record<string, string> = { mild: C.green, moderate: C.gold, severe: C.orange, critical: C.red };
const ROLE_COLOR: Record<string, string> = { admin: C.red, doctor: C.blue, coach: C.green, trainer: PURPLE };
const AV_GRADS: [string, string][] = [['#FB8B3A', '#EE5E16'], ['#57C98A', '#2E9A63'], ['#7C8FE8', '#4A5AC8'], ['#9A7BEA', '#6E5BD0'], ['#E0A53C', '#C07C1E'], ['#4FD1C5', '#2C8A86'], ['#F687B3', '#C2568A'], ['#F0883E', '#C05621']];
const avColors = (s: string): [string, string] => AV_GRADS[[...(s || '?')].reduce((a, c) => a + c.charCodeAt(0), 0) % AV_GRADS.length];

/* ---------- shared bottom sheet with keyboard handling ---------- */
function Sheet({ visible, onClose, title, children, footer }: {
  visible: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode;
}) {
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
          {footer ? <View style={{ paddingHorizontal: 18, paddingTop: 10, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' }}>{footer}</View> : null}
        </View>
      </View>
    </Modal>
  );
}

function Inp(props: any) {
  return (
    <TextInput
      placeholderTextColor={C.muted3}
      {...props}
      style={[{ backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, color: '#fff', fontFamily: F.body, fontSize: 13 }, props.style]}
    />
  );
}

function Lbl({ children, req }: { children: React.ReactNode; req?: boolean }) {
  return <Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: C.muted2, letterSpacing: 0.3 }}>{children}{req ? <Text style={{ color: C.orange }}> *</Text> : null}</Text>;
}

function PrimaryBtn({ label, onPress, disabled, busy, color = C.orange }: { label: string; onPress: () => void; disabled?: boolean; busy?: boolean; color?: string }) {
  return (
    <Pressable onPress={onPress} disabled={disabled || busy} style={{ opacity: disabled ? 0.45 : 1, borderRadius: 13, overflow: 'hidden' }}>
      <LinearGradient colors={[hexA(color, 0.9), hexA(color, 0.65)]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ paddingVertical: 13, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
        {busy ? <ActivityIndicator size="small" color="#1A1210" /> : null}
        <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: '#1A1210' }}>{label}</Text>
      </LinearGradient>
    </Pressable>
  );
}

function SectionHead({ title, count, right, open, onToggle }: { title: string; count?: number; right?: React.ReactNode; open: boolean; onToggle: () => void }) {
  return (
    <Pressable onPress={onToggle} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Serif style={{ fontSize: 16.5, color: '#fff' }}>{title}</Serif>
        {count != null ? <Badge text={String(count)} color={C.muted2} /> : null}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        {right}
        <Icon name={open ? 'chevUp' : 'chevDown'} size={16} color={C.muted2} />
      </View>
    </Pressable>
  );
}

/* ---------- PDF / image preview sheet ---------- */
function PreviewSheet({ item, onClose }: { item: { url: string; title: string } | null; onClose: () => void }) {
  return (
    <Modal visible={!!item} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.82)', justifyContent: 'flex-end' }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={{ backgroundColor: '#171210', borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, borderColor: 'rgba(255,150,90,0.15)', padding: 16, paddingBottom: 28, gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Serif style={{ fontSize: 17, color: '#fff', flex: 1 }} numberOfLines={1}>{item?.title ?? ''}</Serif>
            <Pressable onPress={onClose} hitSlop={10} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="close" size={15} color={C.muted2} />
            </Pressable>
          </View>
          {item ? <PdfPreview url={item.url} height={480} /> : null}
        </View>
      </View>
    </Modal>
  );
}

/* ============ Protocols (physio only) ============ */

function PhaseExercisesList({ protocolId, phase }: { protocolId: string; phase: string }) {
  const q = useProtocolExercises(protocolId, phase);
  const rows = q.data ?? [];
  if (q.isLoading) return <ActivityIndicator size="small" color={C.orange} style={{ paddingVertical: 8 }} />;
  if (!rows.length) return <Body style={{ fontSize: 11.5, color: C.muted3 }}>No exercises for this phase.</Body>;
  const grouped = new Map<string, any[]>();
  rows.forEach((r: any) => {
    const k = `${r.exercise_order}-${r.exercise_name}`;
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k)!.push(r);
  });
  return (
    <View style={{ gap: 8 }}>
      {[...grouped.entries()].map(([k, sets]) => (
        <View key={k} style={{ backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 10, padding: 10, gap: 4 }}>
          <Body style={{ fontSize: 12.5, color: '#fff', fontFamily: F.bodySemi }}>{sets[0].exercise_name}</Body>
          {sets.map((s: any, i: number) => (
            <Body key={s.id ?? i} style={{ fontSize: 11.5, color: C.muted2 }}>
              Set {i + 1}: {[s.reps != null ? `${s.reps} reps` : null, s.load_kg != null ? `${s.load_kg}kg` : null, s.duration || null].filter(Boolean).join(' • ') || '—'}
            </Body>
          ))}
        </View>
      ))}
    </View>
  );
}

const PHASES = [
  { key: 'initial' as const, label: 'Initial Rehab', sub: 'Foundation phase', sessKey: 'initial_rehab_sessions', treatKey: 'initial_rehab_treatment' },
  { key: 'intermediate' as const, label: 'Intermediate Rehab', sub: 'Progression phase', sessKey: 'intermediate_rehab_sessions', treatKey: 'intermediate_rehab_treatment' },
  { key: 'advanced' as const, label: 'Advanced Rehab', sub: 'Performance phase', sessKey: 'advanced_rehab_sessions', treatKey: 'advanced_rehab_treatment' },
];

function ProtocolCard({ p }: { p: any }) {
  const [open, setOpen] = React.useState(false);
  const status = (p.status ?? 'pending') as string;
  const color = status === 'approved' ? C.green : status === 'rejected' ? C.red : C.gold;
  const label = status === 'approved' ? 'Approved' : status === 'rejected' ? 'Rejected' : 'Pending';
  const total = (p.initial_rehab_sessions ?? 0) + (p.intermediate_rehab_sessions ?? 0) + (p.advanced_rehab_sessions ?? 0);
  return (
    <Card colors={CARD_G} border={hexA(color, 0.28)} radius={14} style={{ padding: 12, gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Badge text={label} color={color} />
        <Mono style={{ fontSize: 10.5, color: C.muted3 }}>{fmtD(p.created_at)}</Mono>
      </View>
      <Body style={{ fontSize: 13, color: '#fff' }}>{p.complaint ?? '—'}</Body>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {PHASES.map((ph) => (
          <View key={ph.key} style={{ backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
            <Mono style={{ fontSize: 10, color: C.muted2 }}>{ph.label.split(' ')[0]}: {p[ph.sessKey] ?? 0}</Mono>
          </View>
        ))}
        <View style={{ backgroundColor: hexA(C.orange, 0.12), borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
          <Mono style={{ fontSize: 10, color: C.orange }}>Total: {total}</Mono>
        </View>
      </View>
      {p.rejection_notes ? <Body style={{ fontSize: 11.5, color: C.red }}>Rejection: {p.rejection_notes}</Body> : null}
      <Pressable onPress={() => setOpen((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Icon name={open ? 'chevUp' : 'chevDown'} size={13} color={C.blue} />
        <Text style={{ fontFamily: F.bodySemi, fontSize: 11.5, color: C.blue }}>{open ? 'Hide Exercises' : 'View Exercises'}</Text>
      </Pressable>
      {open ? (
        <View style={{ gap: 10 }}>
          {PHASES.filter((ph) => (p[ph.sessKey] ?? 0) > 0).map((ph) => (
            <View key={ph.key} style={{ gap: 6 }}>
              <Mono style={{ fontSize: 10.5, color: C.gold, letterSpacing: 0.5 }}>{ph.label.toUpperCase()}</Mono>
              {p[ph.treatKey] ? <Body style={{ fontSize: 11.5, color: C.muted2 }}>{p[ph.treatKey]}</Body> : null}
              <PhaseExercisesList protocolId={p.id} phase={ph.key} />
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

/* ---------- Rehab exercise picker (exercises_db modality='Rehab') ---------- */
function RehabPicker({ visible, onClose, onPick, onCustom }: { visible: boolean; onClose: () => void; onPick: (names: string[]) => void; onCustom: () => void }) {
  const q = useRehabExerciseList(visible);
  const [search, setSearch] = React.useState('');
  const [sel, setSel] = React.useState<Set<string>>(new Set());
  React.useEffect(() => { if (visible) { setSel(new Set()); setSearch(''); } }, [visible]);
  const rows = (q.data ?? []).filter((e: any) => {
    const s = search.trim().toLowerCase();
    if (!s) return true;
    return [e.exercise, e.muscle_group, e.equipment].some((v: any) => (v ?? '').toLowerCase().includes(s));
  });
  return (
    <Sheet visible={visible} onClose={onClose} title="Rehab Exercises" footer={
      <View style={{ gap: 8 }}>
        <PrimaryBtn label={sel.size ? `Add ${sel.size} Exercise${sel.size > 1 ? 's' : ''}` : 'Add Selected'} disabled={!sel.size} onPress={() => { onPick([...sel]); onClose(); }} />
        <Pressable onPress={() => { onCustom(); onClose(); }} style={{ alignItems: 'center', paddingVertical: 8 }}>
          <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: C.blue }}>+ Custom Exercise</Text>
        </Pressable>
      </View>
    }>
      <Inp placeholder="Search exercise, muscle group, equipment…" value={search} onChangeText={setSearch} />
      {q.isLoading ? <ActivityIndicator color={C.orange} style={{ paddingVertical: 16 }} /> : rows.slice(0, 80).map((e: any) => {
        const on = sel.has(e.exercise);
        return (
          <Pressable key={e.id} onPress={() => setSel((prev) => { const n = new Set(prev); if (n.has(e.exercise)) n.delete(e.exercise); else n.add(e.exercise); return n; })}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: on ? hexA(C.orange, 0.1) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: on ? hexA(C.orange, 0.4) : 'rgba(255,255,255,0.07)', borderRadius: 12, padding: 11 }}>
            <View style={{ width: 18, height: 18, borderRadius: 5, borderWidth: 1.5, borderColor: on ? C.orange : C.muted3, backgroundColor: on ? C.orange : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
              {on ? <Icon name="checks" size={11} color="#1A1210" strokeWidth={3} /> : null}
            </View>
            <View style={{ flex: 1 }}>
              <Body style={{ fontSize: 12.5, color: '#fff' }}>{e.exercise}</Body>
              <Mono style={{ fontSize: 10, color: C.muted3 }}>{[e.muscle_group, e.equipment].filter(Boolean).join(' • ')}</Mono>
            </View>
          </Pressable>
        );
      })}
    </Sheet>
  );
}

/* ---------- Create Protocol sheet (web CreateProtocolDialog verbatim contract) ---------- */
type SetDetail = { reps: string; duration: string; load_kg: string };
type PhaseExercise = { exercise_name: string; sets: SetDetail[] };
const emptySet = (): SetDetail => ({ reps: '', duration: '', load_kg: '' });

function CreateProtocolSheet({ visible, onClose, clientId, clientName, physioId }: {
  visible: boolean; onClose: () => void; clientId: string; clientName: string; physioId: string;
}) {
  const createM = useCreateProtocol();
  const [complaint, setComplaint] = React.useState('');
  const [sessions, setSessions] = React.useState<Record<string, string>>({ initial: '0', intermediate: '0', advanced: '0' });
  const [treatment, setTreatment] = React.useState<Record<string, string>>({ initial: '', intermediate: '', advanced: '' });
  const [exercises, setExercises] = React.useState<Record<string, PhaseExercise[]>>({ initial: [], intermediate: [], advanced: [] });
  const [pickerFor, setPickerFor] = React.useState<string | null>(null);

  const reset = () => {
    setComplaint(''); setSessions({ initial: '0', intermediate: '0', advanced: '0' });
    setTreatment({ initial: '', intermediate: '', advanced: '' });
    setExercises({ initial: [], intermediate: [], advanced: [] });
  };
  const dirty = !!complaint.trim() || Object.values(sessions).some((v) => (parseInt(v, 10) || 0) > 0) || Object.values(exercises).some((a) => a.length > 0);
  const requestClose = () => {
    if (!dirty) { onClose(); return; }
    Alert.alert('Discard Protocol?', 'Your protocol draft will be lost.', [
      { text: 'Keep Editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => { reset(); onClose(); } },
    ]);
  };

  const total = (['initial', 'intermediate', 'advanced'] as const).reduce((a, k) => a + (parseInt(sessions[k], 10) || 0), 0);
  const mutEx = (phase: string, fn: (list: PhaseExercise[]) => PhaseExercise[]) =>
    setExercises((prev) => ({ ...prev, [phase]: fn(prev[phase]) }));

  const submit = async () => {
    if (!complaint.trim() || total === 0) return;
    const allExercises: ProtocolExerciseInput[] = [];
    let order = 0;
    (['initial', 'intermediate', 'advanced'] as const).forEach((phase) => {
      exercises[phase].forEach((ex) => {
        if (ex.exercise_name.trim()) {
          ex.sets.forEach((s) => {
            allExercises.push({
              phase,
              exercise_name: ex.exercise_name.trim(),
              sets: ex.sets.length,
              reps: s.reps ? parseInt(s.reps, 10) : null,
              duration: s.duration || null,
              load_kg: s.load_kg ? parseFloat(s.load_kg) : null,
              exercise_order: order,
            });
          });
          order++;
        }
      });
    });
    try {
      await createM.mutateAsync({
        client_id: clientId,
        physio_id: physioId,
        complaint: complaint.trim(),
        initial_rehab_sessions: parseInt(sessions.initial, 10) || 0,
        initial_rehab_treatment: treatment.initial.trim(),
        intermediate_rehab_sessions: parseInt(sessions.intermediate, 10) || 0,
        intermediate_rehab_treatment: treatment.intermediate.trim(),
        advanced_rehab_sessions: parseInt(sessions.advanced, 10) || 0,
        advanced_rehab_treatment: treatment.advanced.trim(),
        exercises: allExercises,
      });
      reset(); onClose();
      Alert.alert('Protocol submitted for approval', 'It has been sent to the Head Doctor for review.');
    } catch (e: any) {
      Alert.alert('Failed to create protocol', e?.message ?? 'Unknown error');
    }
  };

  return (
    <>
      <Sheet visible={visible} onClose={requestClose} title="Create Protocol" footer={
        <View style={{ gap: 6 }}>
          <Mono style={{ fontSize: 11, color: C.muted2, textAlign: 'center' }}>Total: {total} sessions</Mono>
          <PrimaryBtn label="Submit for Approval" onPress={submit} busy={createM.isPending} disabled={!complaint.trim() || total === 0 || createM.isPending} />
        </View>
      }>
        <Body style={{ fontSize: 11.5, color: C.muted2 }}>For {clientName}. It will be sent for approval to the Head Doctor.</Body>
        <View style={{ gap: 6 }}>
          <Lbl req>Complaint</Lbl>
          <Inp placeholder="Describe the client's complaint…" value={complaint} onChangeText={setComplaint} multiline style={{ minHeight: 70, textAlignVertical: 'top' }} />
        </View>
        {PHASES.map((ph) => {
          const count = parseInt(sessions[ph.key], 10) || 0;
          return (
            <View key={ph.key} style={{ backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderRadius: 14, padding: 12, gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View>
                  <Body style={{ fontSize: 13.5, color: '#fff', fontFamily: F.bodySemi }}>{ph.label}</Body>
                  <Mono style={{ fontSize: 10, color: C.muted3 }}>{ph.sub}</Mono>
                </View>
                <View style={{ width: 84 }}>
                  <Inp keyboardType="number-pad" value={sessions[ph.key]} onChangeText={(v: string) => setSessions((p) => ({ ...p, [ph.key]: v.replace(/[^0-9]/g, '') }))} placeholder="0" style={{ textAlign: 'center' }} />
                </View>
              </View>
              {count > 0 ? (
                <>
                  <View style={{ gap: 6 }}>
                    <Lbl>Treatment</Lbl>
                    <Inp placeholder="Describe treatment plan for this phase…" value={treatment[ph.key]} onChangeText={(v: string) => setTreatment((p) => ({ ...p, [ph.key]: v }))} multiline style={{ minHeight: 52, textAlignVertical: 'top' }} />
                  </View>
                  {exercises[ph.key].map((ex, exIdx) => (
                    <View key={exIdx} style={{ backgroundColor: 'rgba(0,0,0,0.25)', borderRadius: 12, padding: 10, gap: 8 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Inp placeholder="Exercise name *" value={ex.exercise_name} onChangeText={(v: string) => mutEx(ph.key, (l) => l.map((e, i) => (i === exIdx ? { ...e, exercise_name: v } : e)))} style={{ flex: 1 }} />
                        <Pressable onPress={() => mutEx(ph.key, (l) => l.filter((_, i) => i !== exIdx))} hitSlop={8}>
                          <Icon name="close" size={16} color={C.red} />
                        </Pressable>
                      </View>
                      {ex.sets.map((s, setIdx) => (
                        <View key={setIdx} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Mono style={{ fontSize: 10, color: C.muted3, width: 34 }}>Set {setIdx + 1}</Mono>
                          <Inp placeholder="Reps" keyboardType="number-pad" value={s.reps} onChangeText={(v: string) => mutEx(ph.key, (l) => l.map((e, i) => (i === exIdx ? { ...e, sets: e.sets.map((ss, j) => (j === setIdx ? { ...ss, reps: v.replace(/[^0-9]/g, '') } : ss)) } : e)))} style={{ flex: 1 }} />
                          <Inp placeholder="Load kg" keyboardType="decimal-pad" value={s.load_kg} onChangeText={(v: string) => mutEx(ph.key, (l) => l.map((e, i) => (i === exIdx ? { ...e, sets: e.sets.map((ss, j) => (j === setIdx ? { ...ss, load_kg: v } : ss)) } : e)))} style={{ flex: 1 }} />
                          <Inp placeholder="Duration" value={s.duration} onChangeText={(v: string) => mutEx(ph.key, (l) => l.map((e, i) => (i === exIdx ? { ...e, sets: e.sets.map((ss, j) => (j === setIdx ? { ...ss, duration: v } : ss)) } : e)))} style={{ flex: 1 }} />
                          {ex.sets.length > 1 ? (
                            <Pressable onPress={() => mutEx(ph.key, (l) => l.map((e, i) => (i === exIdx ? { ...e, sets: e.sets.filter((_, j) => j !== setIdx) } : e)))} hitSlop={8}>
                              <Icon name="close" size={13} color={C.muted3} />
                            </Pressable>
                          ) : null}
                        </View>
                      ))}
                      <Pressable onPress={() => mutEx(ph.key, (l) => l.map((e, i) => (i === exIdx ? { ...e, sets: [...e.sets, emptySet()] } : e)))} style={{ alignSelf: 'flex-start' }}>
                        <Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: C.blue }}>+ Add Set</Text>
                      </Pressable>
                    </View>
                  ))}
                  <Pressable onPress={() => setPickerFor(ph.key)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: hexA(C.orange, 0.1), borderWidth: 1, borderColor: hexA(C.orange, 0.35), borderRadius: 10, paddingHorizontal: 11, paddingVertical: 7 }}>
                    <Icon name="plus" size={12} color={C.orange} />
                    <Text style={{ fontFamily: F.bodySemi, fontSize: 11.5, color: C.orange }}>Add Exercise</Text>
                  </Pressable>
                </>
              ) : null}
            </View>
          );
        })}
      </Sheet>
      <RehabPicker
        visible={!!pickerFor}
        onClose={() => setPickerFor(null)}
        onPick={(names) => { if (pickerFor) mutEx(pickerFor, (l) => [...l, ...names.map((n) => ({ exercise_name: n, sets: [emptySet()] }))]); }}
        onCustom={() => { if (pickerFor) mutEx(pickerFor, (l) => [...l, { exercise_name: '', sets: [emptySet()] }]); }}
      />
    </>
  );
}

/* ============ Rehab sessions block ============ */
function RehabSessionCard({ s, onShowText }: { s: any; onShowText: (title: string, text: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const grouped = new Map<string, any[]>();
  (s.exercises ?? []).forEach((e: any) => {
    const k = `${e.exercise_order}-${(e.exercise_name ?? '').toLowerCase()}`;
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k)!.push(e);
  });
  const cancelled = s.status === 'cancelled';
  return (
    <Card colors={CARD_G} border={hexA(cancelled ? C.red : C.blue, 0.2)} radius={14} style={{ padding: 12, gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Badge text={formatDoctorSessionType(s.session_type)} color={cancelled ? C.red : C.blue} />
        <Mono style={{ fontSize: 10.5, color: C.muted3 }}>{fmtDT(s.scheduled_at)}</Mono>
      </View>
      <Body style={{ fontSize: 11.5, color: C.muted2 }}>by {s.trainer_name}</Body>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {s.notes ? (
          <Pressable onPress={() => onShowText('Session Notes', s.notes)} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 9, paddingHorizontal: 9, paddingVertical: 5 }}>
            <Icon name="file" size={11} color={C.muted2} /><Text style={{ fontFamily: F.bodySemi, fontSize: 10.5, color: C.muted }}>Notes</Text>
          </Pressable>
        ) : null}
        {s.notes_ai_analysis ? (
          <Pressable onPress={() => onShowText('AI Notes Analysis', s.notes_ai_analysis)} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: hexA(PURPLE, 0.12), borderRadius: 9, paddingHorizontal: 9, paddingVertical: 5 }}>
            <Icon name="sparkle" size={11} color={PURPLE} /><Text style={{ fontFamily: F.bodySemi, fontSize: 10.5, color: PURPLE }}>Notes AI</Text>
          </Pressable>
        ) : null}
        {s.rehab_ai_analysis ? (
          <Pressable onPress={() => onShowText('Rehab AI Analysis', s.rehab_ai_analysis)} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: hexA(C.gold, 0.12), borderRadius: 9, paddingHorizontal: 9, paddingVertical: 5 }}>
            <Icon name="sparkle" size={11} color={C.gold} /><Text style={{ fontFamily: F.bodySemi, fontSize: 10.5, color: C.gold }}>Rehab AI</Text>
          </Pressable>
        ) : null}
      </View>
      {grouped.size ? (
        <>
          <Pressable onPress={() => setOpen((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Icon name={open ? 'chevUp' : 'chevDown'} size={13} color={C.blue} />
            <Text style={{ fontFamily: F.bodySemi, fontSize: 11.5, color: C.blue }}>{open ? 'Hide' : 'View'} Details ({grouped.size})</Text>
          </Pressable>
          {open ? (
            <View style={{ gap: 8 }}>
              {[...grouped.values()].map((sets, gi) => {
                const first = sets[0];
                const isModality = !!first.modality_type;
                return (
                  <View key={gi} style={{ backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 10, padding: 10, gap: 4 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <Body style={{ fontSize: 12.5, color: '#fff', fontFamily: F.bodySemi }}>{first.exercise_name}</Body>
                      {first.phase ? <Badge text={first.phase} color={C.gold} /> : null}
                    </View>
                    {isModality ? (
                      <View style={{ gap: 2 }}>
                        {first.area_focused ? <Body style={{ fontSize: 11, color: C.muted2 }}>Area: {first.area_focused}</Body> : null}
                        {first.modality_duration ? <Body style={{ fontSize: 11, color: C.muted2 }}>Duration: {first.modality_duration}</Body> : null}
                        {first.modality_frequency ? <Body style={{ fontSize: 11, color: C.muted2 }}>Temperature: {first.modality_frequency}</Body> : null}
                        {first.modality_pressure ? <Body style={{ fontSize: 11, color: C.muted2 }}>Pressure: {first.modality_pressure}</Body> : null}
                        {first.training_type ? <Body style={{ fontSize: 11, color: C.muted2 }}>Training: {first.training_type}</Body> : null}
                        {first.modality_notes ? <Body style={{ fontSize: 11, color: C.muted2 }}>Notes: {first.modality_notes}</Body> : null}
                      </View>
                    ) : (
                      sets.map((st: any, i: number) => (
                        <Body key={st.id ?? i} style={{ fontSize: 11, color: C.muted2 }}>
                          Set {st.set_number ?? i + 1}: {[st.reps != null ? `${st.reps} reps` : null, st.weight_kg != null ? `${st.weight_kg}kg` : null, st.duration || null].filter(Boolean).join(' • ') || '—'}
                        </Body>
                      ))
                    )}
                  </View>
                );
              })}
            </View>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}

/* ============ Workout sessions (web ClientWorkoutSessions) ============ */
function WorkoutSessionCard({ w }: { w: any }) {
  const [open, setOpen] = React.useState(false);
  const exQ = useWorkoutSessionExercises(w.session_id, open);
  const fmtSet = (s: any) => {
    if (s.duration_seconds != null) return `${Math.round(s.duration_seconds / 60)} min${s.reps_performed ? ` · ${s.reps_performed} reps` : ''}`;
    return [s.reps_performed != null ? `${s.reps_performed} reps` : null, s.load_performed ? `${s.load_performed}` : null, s.rounds ? `${s.rounds} rounds` : null].filter(Boolean).join(' × ') || '—';
  };
  return (
    <Card colors={CARD_G} border={hexA('#A9BCFF', 0.16)} radius={14} style={{ padding: 12, gap: 8 }}>
      <Pressable onPress={() => setOpen((v) => !v)} style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Body style={{ flex: 1, fontSize: 13, fontFamily: F.bodySemi, color: '#fff' }} numberOfLines={1}>{w.session_name || 'Workout Session'}</Body>
          {w.modality ? <Badge text={w.modality} color={C.blue} /> : null}
          <Icon name={open ? 'chevUp' : 'chevDown'} size={13} color={C.muted3} strokeWidth={2.2} />
        </View>
        <Body style={{ fontSize: 10.5, color: C.muted2 }}>{fmtD(w.session_date)} · by {w.trainerName}</Body>
      </Pressable>
      {open ? (
        exQ.isPending ? <ActivityIndicator size="small" color={C.orange} style={{ paddingVertical: 8 }} /> :
        (exQ.data ?? []).length === 0 ? <Body style={{ fontSize: 11.5, color: C.muted3 }}>No exercise rows recorded.</Body> :
        <View style={{ gap: 8 }}>
          {(exQ.data ?? []).map((g: any) => (
            <View key={g.name} style={{ backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 10, padding: 10, gap: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <Body style={{ flex: 1, fontSize: 12.5, color: '#fff', fontFamily: F.bodySemi }} numberOfLines={1}>{g.name}</Body>
                {g.sets[0]?.body_part ? <Mono style={{ fontSize: 8.5, color: C.muted3 }}>{String(g.sets[0].body_part).toUpperCase()}</Mono> : null}
              </View>
              {g.sets.map((s: any, i: number) => (
                <Body key={i} style={{ fontSize: 11, color: C.muted2 }}>
                  {s.set_number != null ? `Set ${s.set_number}: ` : ''}{fmtSet(s)}{s.exercise_notes ? ` — ${s.exercise_notes}` : ''}
                </Body>
              ))}
            </View>
          ))}
          {(exQ.data ?? []).flatMap((g: any) => g.sets).find((s: any) => s.remark)?.remark ? (
            <Body style={{ fontSize: 11, color: C.muted2, fontStyle: 'italic' }}>"{(exQ.data ?? []).flatMap((g: any) => g.sets).find((s: any) => s.remark)?.remark}"</Body>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

/* ============ Counselling (physio only) ============ */
function AiAnalysisBody({ text }: { text: string }) {
  return (
    <View style={{ gap: 6 }}>
      {text.split('\n').map((line, i) => {
        const t = line.trim();
        if (!t) return <View key={i} style={{ height: 4 }} />;
        const isHeader = t.endsWith(':') || (t.includes('**') && t.length < 100);
        if (isHeader) {
          return (
            <View key={i} style={{ alignSelf: 'flex-start', backgroundColor: hexA(C.gold, 0.12), borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4 }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 11.5, color: C.gold }}>{t.replace(/\*\*/g, '')}</Text>
            </View>
          );
        }
        if (t.startsWith('-')) return <Body key={i} style={{ fontSize: 12, color: C.muted, paddingLeft: 8 }}>• {t.replace(/^-\s*/, '')}</Body>;
        return <Body key={i} style={{ fontSize: 12, color: C.muted }}>{t}</Body>;
      })}
    </View>
  );
}

function CounsellingBlock({ clientId, uid }: { clientId: string; uid: string }) {
  const q = usePhysioCounselling(clientId);
  const addM = useAddPhysioCounselling();
  const aiM = useGenerateCounsellingAI();
  const [details, setDetails] = React.useState('');
  const [view, setView] = React.useState<{ title: string; body: React.ReactNode } | null>(null);
  const [aiBusyId, setAiBusyId] = React.useState<string | null>(null);
  const rows = q.data ?? [];

  const genAI = async (row: any) => {
    setAiBusyId(row.id);
    try {
      const result = await aiM.mutateAsync({ id: row.id, counsellingDetails: row.counselling_details });
      setView({ title: 'AI Analysis', body: <AiAnalysisBody text={result} /> });
    } catch (e: any) {
      Alert.alert('AI analysis failed', e?.message ?? 'Unknown error');
    } finally { setAiBusyId(null); }
  };

  return (
    <View style={{ gap: 10 }}>
      <View style={{ gap: 8 }}>
        <Inp
          placeholder={'Chief Complaint\nCondition\nPain Area\nVAS\nObservation and Examination\nTreatment Protocol\nPrecautions'}
          value={details} onChangeText={setDetails} multiline style={{ minHeight: 110, textAlignVertical: 'top' }}
        />
        <PrimaryBtn label="Add Counselling" disabled={!details.trim() || addM.isPending} busy={addM.isPending} onPress={async () => {
          try {
            await addM.mutateAsync({ clientId, doctorId: uid, counsellingDetails: details.trim() });
            setDetails('');
            Alert.alert('Rehab counselling added successfully');
          } catch (e: any) { Alert.alert('Failed to add counselling', e?.message ?? 'Unknown error'); }
        }} />
      </View>
      {q.isLoading ? <ActivityIndicator color={C.orange} /> : !rows.length ? (
        <Body style={{ fontSize: 12, color: C.muted3, textAlign: 'center', paddingVertical: 8 }}>No counselling entries yet.</Body>
      ) : rows.map((r: any) => (
        <Card key={r.id} colors={CARD_G} border="rgba(255,150,90,0.12)" radius={13} style={{ padding: 11, gap: 7 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Mono style={{ fontSize: 10.5, color: C.muted3 }}>{fmtDT(r.created_at)}</Mono>
            <Body style={{ fontSize: 10.5, color: C.muted2 }}>by {r.doctor_name}</Body>
          </View>
          <Body style={{ fontSize: 12, color: C.muted }} numberOfLines={3}>{r.counselling_details}</Body>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Pressable onPress={() => setView({ title: 'Counselling Details', body: <Body style={{ fontSize: 12.5, color: C.muted, lineHeight: 19 }}>{r.counselling_details}</Body> })}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 9, paddingHorizontal: 10, paddingVertical: 6 }}>
              <Icon name="eye" size={12} color={C.muted2} /><Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: C.muted }}>View</Text>
            </Pressable>
            {r.ai_simplified_analysis ? (
              <Pressable onPress={() => setView({
                title: 'AI Analysis',
                body: (
                  <View style={{ gap: 12 }}>
                    <AiAnalysisBody text={r.ai_simplified_analysis} />
                    <Pressable onPress={() => genAI(r)} disabled={aiBusyId === r.id} style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: hexA(PURPLE, 0.12), borderWidth: 1, borderColor: hexA(PURPLE, 0.35), borderRadius: 10, paddingHorizontal: 11, paddingVertical: 7 }}>
                      {aiBusyId === r.id ? <ActivityIndicator size="small" color={PURPLE} /> : <Icon name="sparkle" size={12} color={PURPLE} />}
                      <Text style={{ fontFamily: F.bodySemi, fontSize: 11.5, color: PURPLE }}>Regenerate</Text>
                    </Pressable>
                  </View>
                ),
              })}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: hexA(PURPLE, 0.12), borderRadius: 9, paddingHorizontal: 10, paddingVertical: 6 }}>
                <Icon name="sparkle" size={12} color={PURPLE} /><Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: PURPLE }}>View AI</Text>
              </Pressable>
            ) : (
              <Pressable onPress={() => genAI(r)} disabled={aiBusyId === r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: hexA(C.gold, 0.12), borderRadius: 9, paddingHorizontal: 10, paddingVertical: 6 }}>
                {aiBusyId === r.id ? <ActivityIndicator size="small" color={C.gold} /> : <Icon name="sparkle" size={12} color={C.gold} />}
                <Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: C.gold }}>Generate AI</Text>
              </Pressable>
            )}
          </View>
        </Card>
      ))}
      <Sheet visible={!!view} onClose={() => setView(null)} title={view?.title ?? ''}>
        {view?.body}
      </Sheet>
    </View>
  );
}

/* ============ Medical entry sheet (web MedicalHistoryFormDialog: choose | manual | ai) ============ */
const MED_INITIAL = {
  category: 'illness', severity: 'moderate', title: '', description: '', event_date: '', end_date: '',
  is_ongoing: false, problem_description: '', diagnosis: '', treatment_given: '', medicines_taken: '',
  hospital_name: '', treating_doctor: '',
};
export function MedicalEntrySheet({ visible, onClose, clientId, doctorId }: { visible: boolean; onClose: () => void; clientId: string; doctorId: string }) {
  const addM = useAddMedicalHistory();
  const aiM = useAiUploadMedicalDocs();
  const [mode, setMode] = React.useState<'choose' | 'manual' | 'ai'>('choose');
  const [f, setF] = React.useState({ ...MED_INITIAL });
  const [more, setMore] = React.useState(false);
  const [tags, setTags] = React.useState<string[]>([]);
  const [tagInput, setTagInput] = React.useState('');
  const [files, setFiles] = React.useState<PickedDoc[]>([]);
  const [docType, setDocType] = React.useState<'lab_report' | 'other'>('lab_report');
  const [aiFiles, setAiFiles] = React.useState<PickedDoc[]>([]);
  const up = (k: string, v: any) => setF((p) => ({ ...p, [k]: v }));
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(f.event_date);
  const canSave = !!f.title.trim() && dateOk && !addM.isPending;
  const resetAll = () => { setF({ ...MED_INITIAL }); setMore(false); setTags([]); setTagInput(''); setFiles([]); setAiFiles([]); setDocType('lab_report'); setMode('choose'); };
  const requestClose = () => { resetAll(); onClose(); };

  const pickDocs = async (restrict: boolean, onPicked: (docs: PickedDoc[]) => void) => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        multiple: true, copyToCacheDirectory: true,
        type: restrict ? ['application/pdf', 'image/jpeg', 'image/png'] : '*/*',
      });
      if (res.canceled) return;
      onPicked((res.assets ?? []).map((a) => ({ uri: a.uri, name: a.name ?? 'file', mime: a.mimeType ?? 'application/octet-stream', size: a.size ?? null })));
    } catch (e: any) { Alert.alert('Could not open file picker', e?.message ?? 'Unknown error'); }
  };

  const addTag = () => {
    const t = tagInput.trim();
    if (t && !tags.includes(t)) { setTags((prev) => [...prev, t]); setTagInput(''); }
  };

  const submitManual = async () => {
    try {
      await addM.mutateAsync({ clientId, doctorId, ...f, tags, files });
      resetAll(); onClose();
      Alert.alert('Medical history entry added');
    } catch (e: any) { Alert.alert('Failed to save entry', e?.message ?? 'Unknown error'); }
  };

  const submitAi = async () => {
    try {
      const r = await aiM.mutateAsync({ clientId, doctorId, docType, files: aiFiles });
      resetAll(); onClose();
      Alert.alert(
        r.softWarn ? 'Upload accepted' : `${r.count} file(s) uploaded`,
        r.softWarn
          ? 'The processing acknowledgement was not received — the report may still appear shortly. Refresh in a minute.'
          : 'AI is extracting in the background — results will appear in 1–2 minutes.'
      );
    } catch (e: any) { Alert.alert('Upload failed', e?.message ?? 'Unknown error'); }
  };

  const fileRow = (file: PickedDoc, onRemove: () => void, disabled: boolean) => (
    <View key={`${file.uri}-${file.name}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderRadius: 12, padding: 11 }}>
      <Icon name="file" size={15} color={C.orange} />
      <View style={{ flex: 1 }}>
        <Body style={{ fontSize: 12.5, color: '#fff' }} numberOfLines={1}>{file.name}</Body>
        {file.size != null ? <Mono style={{ fontSize: 9.5, color: C.muted3 }}>{(file.size / 1024 / 1024).toFixed(1)} MB</Mono> : null}
      </View>
      <Pressable onPress={onRemove} disabled={disabled} hitSlop={8}><Icon name="close" size={14} color={C.muted2} /></Pressable>
    </View>
  );

  return (
    <Sheet visible={visible} onClose={requestClose} title="Add Medical History Entry" footer={
      mode === 'manual' ? (
        <PrimaryBtn label="Save Entry" disabled={!canSave} busy={addM.isPending} onPress={submitManual} />
      ) : mode === 'ai' ? (
        <PrimaryBtn label={aiM.isPending ? 'AI Processing…' : 'Upload & Extract'} disabled={aiFiles.length === 0 || aiM.isPending} busy={aiM.isPending} onPress={submitAi} />
      ) : undefined
    }>
      {mode === 'choose' ? (
        <View style={{ flexDirection: 'row', gap: 10, paddingVertical: 8 }}>
          <Pressable onPress={() => setMode('ai')} style={{ flex: 1, alignItems: 'center', gap: 9, padding: 16, borderRadius: 16, borderWidth: 1.5, borderStyle: 'dashed', borderColor: hexA(C.orange, 0.4), backgroundColor: hexA(C.orange, 0.05) }}>
            <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: hexA(C.orange, 0.12), alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="sparkle" size={19} color={C.orange} />
            </View>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: '#fff' }}>Upload Document</Text>
            <Body style={{ fontSize: 10.5, color: C.muted2, textAlign: 'center' }}>Upload a PDF or image and AI will extract all details automatically</Body>
          </Pressable>
          <Pressable onPress={() => setMode('manual')} style={{ flex: 1, alignItems: 'center', gap: 9, padding: 16, borderRadius: 16, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.18)', backgroundColor: 'rgba(255,255,255,0.02)' }}>
            <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.07)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="file" size={19} color={C.muted} />
            </View>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: '#fff' }}>Manual Entry</Text>
            <Body style={{ fontSize: 10.5, color: C.muted2, textAlign: 'center' }}>Fill in all fields manually with clinical details</Body>
          </Pressable>
        </View>
      ) : null}

      {mode === 'ai' ? (
        <>
          <Pressable onPress={() => { setAiFiles([]); setMode('choose'); }} disabled={aiM.isPending} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start' }}>
            <Icon name="chevLeft" size={13} color={C.blue} />
            <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: C.blue }}>Back</Text>
          </Pressable>
          <Body style={{ fontSize: 11.5, color: C.muted2 }}>Upload a medical document and AI will extract and store all relevant data automatically.</Body>
          <View style={{ gap: 8 }}>
            <Lbl req>Document Type</Lbl>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {([
                ['lab_report', 'Lab Report', 'Blood tests, lipid panel, thyroid, etc.'],
                ['other', 'Medical / Hospital', 'Discharge, MRI, prescription, surgery'],
              ] as [typeof docType, string, string][]).map(([val, label, caption]) => {
                const active = docType === val;
                return (
                  <Pressable key={val} onPress={() => setDocType(val)} style={{ flex: 1, gap: 4, padding: 12, borderRadius: 13, borderWidth: 1.5, borderColor: active ? hexA(C.orange, 0.55) : 'rgba(255,255,255,0.12)', backgroundColor: active ? hexA(C.orange, 0.07) : 'rgba(255,255,255,0.02)' }}>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: active ? C.orange : '#fff' }}>{label}</Text>
                    <Body style={{ fontSize: 9.5, color: C.muted3 }}>{caption}</Body>
                  </Pressable>
                );
              })}
            </View>
          </View>
          {aiFiles.length === 0 ? (
            <Pressable onPress={() => pickDocs(true, (docs) => setAiFiles((prev) => [...prev, ...docs]))} style={{ alignItems: 'center', gap: 8, padding: 24, borderRadius: 16, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.22)' }}>
              <Icon name="plus" size={22} color={C.muted2} />
              <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: C.muted }}>Tap to select PDFs or images</Text>
              <Body style={{ fontSize: 10, color: C.muted3 }}>Supported: PDF, JPG, PNG — multiple files allowed</Body>
            </Pressable>
          ) : (
            <View style={{ gap: 8 }}>
              {aiFiles.map((file, idx) => fileRow(file, () => setAiFiles((prev) => prev.filter((_, i) => i !== idx)), aiM.isPending))}
              <Pressable onPress={() => pickDocs(true, (docs) => setAiFiles((prev) => [...prev, ...docs]))} disabled={aiM.isPending} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 11, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.2)' }}>
                <Icon name="plus" size={12} color={C.muted2} />
                <Text style={{ fontFamily: F.bodySemi, fontSize: 11.5, color: C.muted2 }}>Add more files</Text>
              </Pressable>
            </View>
          )}
        </>
      ) : null}

      {mode === 'manual' ? (
      <>
      <Pressable onPress={() => setMode('choose')} disabled={addM.isPending} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start' }}>
        <Icon name="chevLeft" size={13} color={C.blue} />
        <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: C.blue }}>Back</Text>
      </Pressable>
      <View style={{ gap: 6 }}>
        <Lbl req>Title</Lbl>
        <Inp placeholder="e.g. ACL reconstruction" value={f.title} onChangeText={(v: string) => up('title', v)} />
      </View>
      <View style={{ gap: 6 }}>
        <Lbl>Category</Lbl>
        <HScroll>
          {MEDICAL_CATEGORIES.map((c) => (
            <AnimChip key={c} active={f.category === c} onPress={() => up('category', c)}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: f.category === c ? '#1A1210' : C.muted }}>{MEDICAL_CATEGORY_LABELS[c]}</Text>
            </AnimChip>
          ))}
        </HScroll>
      </View>
      <View style={{ gap: 6 }}>
        <Lbl>Severity</Lbl>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {MEDICAL_SEVERITIES.map((s) => (
            <Pressable key={s} onPress={() => up('severity', s)} style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 11, backgroundColor: f.severity === s ? hexA(SEVERITY_COLOR[s], 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: f.severity === s ? hexA(SEVERITY_COLOR[s], 0.5) : 'rgba(255,255,255,0.08)' }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: f.severity === s ? SEVERITY_COLOR[s] : C.muted2, textTransform: 'capitalize' }}>{s}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1, gap: 6 }}>
          <Lbl req>Event date</Lbl>
          <Inp placeholder="YYYY-MM-DD" value={f.event_date} onChangeText={(v: string) => up('event_date', v)} />
        </View>
        <View style={{ flex: 1, gap: 6 }}>
          <Lbl>End date</Lbl>
          <Inp placeholder="YYYY-MM-DD" value={f.end_date} onChangeText={(v: string) => up('end_date', v)} editable={!f.is_ongoing} style={{ opacity: f.is_ongoing ? 0.4 : 1 }} />
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Body style={{ fontSize: 12.5, color: C.muted }}>Ongoing condition</Body>
        <Switch value={f.is_ongoing} onValueChange={(v) => { up('is_ongoing', v); if (v) up('end_date', ''); }} trackColor={{ false: 'rgba(255,255,255,0.15)', true: hexA(C.orange, 0.5) }} thumbColor={f.is_ongoing ? C.orange : '#888'} />
      </View>
      <View style={{ gap: 6 }}>
        <Lbl>Description</Lbl>
        <Inp placeholder="Short summary…" value={f.description} onChangeText={(v: string) => up('description', v)} multiline style={{ minHeight: 56, textAlignVertical: 'top' }} />
      </View>
      <Pressable onPress={() => setMore((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Icon name={more ? 'chevUp' : 'chevDown'} size={13} color={C.blue} />
        <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: C.blue }}>{more ? 'Hide' : 'More'} details</Text>
      </Pressable>
      {more ? (
        <View style={{ gap: 10 }}>
          {([
            ['problem_description', 'Problem description'], ['diagnosis', 'Diagnosis'], ['treatment_given', 'Treatment given'],
            ['medicines_taken', 'Medicines taken'], ['hospital_name', 'Hospital name'], ['treating_doctor', 'Treating doctor'],
          ] as [string, string][]).map(([k, label]) => (
            <View key={k} style={{ gap: 6 }}>
              <Lbl>{label}</Lbl>
              <Inp placeholder={label} value={(f as any)[k]} onChangeText={(v: string) => up(k, v)} />
            </View>
          ))}
        </View>
      ) : null}
      <View style={{ gap: 6 }}>
        <Lbl>Tags</Lbl>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Inp placeholder="Add a tag…" value={tagInput} onChangeText={setTagInput} onSubmitEditing={addTag} style={{ flex: 1 }} />
          <Pressable onPress={addTag} disabled={!tagInput.trim()} style={{ opacity: tagInput.trim() ? 1 : 0.4, width: 44, borderRadius: 12, backgroundColor: hexA(C.orange, 0.14), borderWidth: 1, borderColor: hexA(C.orange, 0.4), alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="plus" size={15} color={C.orange} />
          </Pressable>
        </View>
        {tags.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {tags.map((t) => (
              <Pressable key={t} onPress={() => setTags((prev) => prev.filter((x) => x !== t))} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999, backgroundColor: hexA(C.blue, 0.1), borderWidth: 1, borderColor: hexA(C.blue, 0.35) }}>
                <Text style={{ fontFamily: F.bodySemi, fontSize: 10.5, color: '#A9BCFF' }}>{t}</Text>
                <Icon name="close" size={10} color="#A9BCFF" />
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
      <View style={{ gap: 8 }}>
        <Lbl>Attachments</Lbl>
        {files.map((file, idx) => fileRow(file, () => setFiles((prev) => prev.filter((_, i) => i !== idx)), addM.isPending))}
        <Pressable onPress={() => pickDocs(false, (docs) => setFiles((prev) => [...prev, ...docs]))} disabled={addM.isPending} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 11, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.2)' }}>
          <Icon name="plus" size={12} color={C.muted2} />
          <Text style={{ fontFamily: F.bodySemi, fontSize: 11.5, color: C.muted2 }}>Attach files</Text>
        </Pressable>
      </View>
      </>
      ) : null}
    </Sheet>
  );
}

/* ============ Assign doctors (HOD) ============ */
function AssignDoctorsSheet({ visible, onClose, clientId, viewerId }: { visible: boolean; onClose: () => void; clientId: string; viewerId: string }) {
  const doctorsQ = useAssignableDoctors(visible ? viewerId : null);
  const assignedQ = useClientDoctorAssignments(clientId, visible);
  const assignM = useAssignDoctors();
  const [sel, setSel] = React.useState<Set<string>>(new Set());
  React.useEffect(() => {
    if (visible && assignedQ.data) setSel(new Set(assignedQ.data));
  }, [visible, assignedQ.data]);
  const doctors = (doctorsQ.data ?? []) as any[];
  return (
    <Sheet visible={visible} onClose={onClose} title="Assign Doctors" footer={
      <PrimaryBtn label="Save Assignments" busy={assignM.isPending} disabled={assignM.isPending} onPress={async () => {
        try {
          await assignM.mutateAsync({ clientId, selectedDoctors: [...sel] });
          onClose();
          Alert.alert('Doctor assignments updated');
        } catch (e: any) { Alert.alert('Failed to update assignments', e?.message ?? 'Unknown error'); }
      }} />
    }>
      <Body style={{ fontSize: 11.5, color: C.muted2 }}>Deselecting a doctor keeps the record but marks it inactive.</Body>
      {doctorsQ.isLoading || assignedQ.isLoading ? <ActivityIndicator color={C.orange} style={{ paddingVertical: 14 }} /> : doctors.map((d) => {
        const on = sel.has(d.id);
        return (
          <Pressable key={d.id} onPress={() => setSel((prev) => { const n = new Set(prev); if (n.has(d.id)) n.delete(d.id); else n.add(d.id); return n; })}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: on ? hexA(C.blue, 0.1) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: on ? hexA(C.blue, 0.4) : 'rgba(255,255,255,0.07)', borderRadius: 12, padding: 12 }}>
            <View style={{ width: 18, height: 18, borderRadius: 5, borderWidth: 1.5, borderColor: on ? C.blue : C.muted3, backgroundColor: on ? C.blue : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
              {on ? <Icon name="checks" size={11} color="#1A1210" strokeWidth={3} /> : null}
            </View>
            <View style={{ flex: 1 }}>
              <Body style={{ fontSize: 13, color: '#fff' }}>{`${d.first_name ?? ''} ${d.last_name ?? ''}`.trim() || 'Unknown'}</Body>
              {d.email ? <Mono style={{ fontSize: 10, color: C.muted3 }}>{d.email}</Mono> : null}
            </View>
            {d.id === HEAD_DOCTOR_ID ? <Badge text="HOD" color={C.gold} /> : null}
          </Pressable>
        );
      })}
    </Sheet>
  );
}

/* ============ Health reports list (shared by Medical + Reports tabs) ============ */
function HealthReportsBlock({ clientId, onPreview }: { clientId: string; onPreview: (url: string, title: string) => void }) {
  const q = useClientHealthReports(clientId);
  const rows = q.data ?? [];
  if (q.isLoading) return <ActivityIndicator color={C.orange} style={{ paddingVertical: 10 }} />;
  if (!rows.length) return <Body style={{ fontSize: 12, color: C.muted3, textAlign: 'center', paddingVertical: 8 }}>No health reports uploaded.</Body>;
  return (
    <View style={{ gap: 8 }}>
      {rows.map((r) => (
        <Card key={r.id} colors={CARD_G} border="rgba(255,150,90,0.12)" radius={13} style={{ padding: 11, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: hexA(C.blue, 0.12), alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="file" size={15} color={C.blue} />
          </View>
          <View style={{ flex: 1 }}>
            <Body style={{ fontSize: 12.5, color: '#fff' }} numberOfLines={1}>{r.reportName}</Body>
            <Mono style={{ fontSize: 10, color: C.muted3 }}>{[r.reportType, fmtD(r.date)].filter(Boolean).join(' • ')}</Mono>
          </View>
          {r.fileUrl ? (
            <Pressable onPress={() => onPreview(r.fileUrl!, r.reportName)} style={{ backgroundColor: hexA(C.blue, 0.12), borderWidth: 1, borderColor: hexA(C.blue, 0.4), borderRadius: 10, paddingHorizontal: 11, paddingVertical: 7 }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: C.blue }}>Preview</Text>
            </Pressable>
          ) : null}
        </Card>
      ))}
    </View>
  );
}

/* ============ MAIN SCREEN ============ */
export function DoctorClientDetail() {
  const { selectedClientId: clientId, selectedClientName, back, openWorkout } = useStore();
  const { session } = useAuth();
  const uid = session?.user?.id ?? '';
  const ident = useDoctorIdentity();
  const headerQ = useDoctorClientHeader(clientId);
  const h = headerQ.data;
  const crmQ = useClientCrm(clientId);

  const [months, setMonths] = React.useState('1');
  const countsQ = useDoctorClientSessionCounts(clientId ? [clientId] : [], months, !!clientId);
  const [tab, setTab] = React.useState<'sessions' | 'medical' | 'reports' | 'notes'>('sessions');
  React.useEffect(() => { trackClientTab('doctor-client-detail', tab, { id: clientId, name: selectedClientName }); }, [tab]);
  const [assignOpen, setAssignOpen] = React.useState(false);
  const [logOpen, setLogOpen] = React.useState(false);
  const [infoOpen, setInfoOpen] = React.useState(false);
  const [createProtoOpen, setCreateProtoOpen] = React.useState(false);
  const [medEntryOpen, setMedEntryOpen] = React.useState(false);
  const [preview, setPreview] = React.useState<{ url: string; title: string } | null>(null);
  const [textView, setTextView] = React.useState<{ title: string; text: string } | null>(null);

  // section collapse state
  const [secProto, setSecProto] = React.useState(true);
  const [secRehab, setSecRehab] = React.useState(true);
  const [secCouns, setSecCouns] = React.useState(false);
  const [secWorkout, setSecWorkout] = React.useState(false);
  const [secCancel, setSecCancel] = React.useState(false);

  const protocolsQ = usePhysioProtocols(tab === 'sessions' && ident.data.isPhysio ? clientId : null);
  const rehabQ = useRehabSessions(tab === 'sessions' ? clientId : null);
  const workoutQ = useWorkoutSessions(tab === 'sessions' && secWorkout ? clientId : null);
  const cancelledQ = useCancelledClientSessions(tab === 'sessions' && secCancel ? clientId : null);
  const medQ = useClientMedicalHistory(tab === 'medical' ? clientId : null);
  const findingsQ = useClientFindings(tab === 'reports' ? clientId : null);
  const remarksQ = useDoctorClientRemarks(tab === 'notes' ? clientId : null);
  const delMedM = useDeleteMedicalHistory();
  const shareM = useToggleFindingShared();
  const addRemarkM = useAddClientRemark();
  const updRemarkM = useUpdateClientRemark();
  const delRemarkM = useDeleteClientRemark();

  const [remarkText, setRemarkText] = React.useState('');
  const [remarkPage, setRemarkPage] = React.useState(0);
  const [editRemark, setEditRemark] = React.useState<{ id: string; content: string } | null>(null);

  if (!clientId) {
    return <Page><Body style={{ color: C.muted3, textAlign: 'center', paddingVertical: 40 }}>No client selected.</Body></Page>;
  }

  const name = h?.name ?? selectedClientName ?? 'Client';
  const sessCount = countsQ.data?.[clientId] ?? 0;
  const isHead = uid === HEAD_DOCTOR_ID;
  const isPhysio = ident.data.isPhysio;

  const remarks = remarksQ.data ?? [];
  const remarkPages = Math.max(1, Math.ceil(remarks.length / REMARKS_PER_PAGE));
  const pageRemarks = remarks.slice(remarkPage * REMARKS_PER_PAGE, (remarkPage + 1) * REMARKS_PER_PAGE);

  const TABS: { key: typeof tab; label: string; icon: any }[] = [
    { key: 'sessions', label: 'Sessions', icon: 'activity' },
    { key: 'medical', label: 'Medical', icon: 'heart' },
    { key: 'reports', label: 'Reports', icon: 'file' },
    { key: 'notes', label: 'Notes', icon: 'bubble' },
  ];

  return (
    <Page kbAware scrollKey={`doctor-client-${clientId}-${tab}`}>
      {/* top bar: back + info */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <BackLink label="Back to Clients" onPress={back} />
        <Pressable onPress={() => setInfoOpen(true)} hitSlop={10} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: hexA(C.blue, 0.1), borderWidth: 1, borderColor: hexA(C.blue, 0.38), alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: '#A9BCFF', fontStyle: 'italic' }}>i</Text>
        </Pressable>
      </View>

      {/* hero */}
      <Card colors={['rgba(46,28,18,0.5)', 'rgba(18,14,14,0.55)']} border="rgba(255,150,90,0.16)" radius={18} style={{ padding: 14, gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Avatar initial={(name[0] ?? '?').toUpperCase()} size={52} colors={avColors(name)} fontSize={20} />
          <View style={{ flex: 1 }}>
            <Serif numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.55} style={{ fontSize: 21, color: '#fff' }}>{name}</Serif>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 5, marginTop: 5 }}>
              {h?.subscription ? <Badge text={h.subscription} color={C.gold} /> : null}
              {h?.status ? <Badge text={h.status} color={h.status === 'active' ? C.green : C.red} /> : null}
              <ServicesButton subscriptionType={h?.subscription} />
            </View>
            {crmQ.data ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 5 }}>
                <Icon name="userCircle" size={12} color={C.muted3} strokeWidth={1.9} />
                <Body style={{ fontSize: 11, color: C.muted2 }} numberOfLines={1}>
                  CRM · {crmQ.data.name}{crmQ.data.phone ? ` · ${crmQ.data.phone}` : ''}
                </Body>
              </View>
            ) : null}
          </View>
          <View style={{ alignItems: 'center', paddingHorizontal: 4 }}>
            <Serif style={{ fontSize: 25, color: '#A9BCFF' }}>{countsQ.isLoading ? '…' : sessCount}</Serif>
            <Mono style={{ fontSize: 7.5, color: C.muted3, letterSpacing: 0.7 }}>DR SESSIONS</Mono>
          </View>
        </View>
        <HScroll gap={7}>
          {['1', '2', '3', '4', 'overall'].map((m) => (
            <AnimChip key={m} active={months === m} onPress={() => setMonths(m)}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: months === m ? '#1A1210' : C.muted }}>{m === 'overall' ? 'Overall' : `${m} mo`}</Text>
            </AnimChip>
          ))}
        </HScroll>
      </Card>

      {/* actions */}
      {isPhysio || isHead ? (
        <View style={{ gap: 8 }}>
          {isPhysio ? (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable onPress={() => setLogOpen(true)} style={{ flex: 1, borderRadius: 13, overflow: 'hidden' }}>
                <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 12 }}>
                  <Icon name="heart" size={14} color="#fff" strokeWidth={2.2} />
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: '#fff' }}>Log Physio</Text>
                </LinearGradient>
              </Pressable>
              <Pressable onPress={() => clientId && openWorkout(clientId, name, '', null)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 12, borderRadius: 13, backgroundColor: hexA(C.blue, 0.12), borderWidth: 1, borderColor: hexA(C.blue, 0.42) }}>
                <Icon name="dumbbell" size={14} color="#A9BCFF" strokeWidth={2.1} />
                <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: '#A9BCFF' }}>Add Workout</Text>
              </Pressable>
            </View>
          ) : null}
          {isHead ? (
            <Pressable onPress={() => setAssignOpen(true)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 11, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.13)' }}>
              <Icon name="users" size={13} color={C.muted} strokeWidth={2.1} />
              <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: C.muted }}>Assign Doctors</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {/* tabs — segmented pill */}
      <View style={{ flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 999, padding: 3 }}>
        {TABS.map((t) => {
          const active = tab === t.key;
          return active ? (
            <LinearGradient key={t.key} colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 8, borderRadius: 999 }}>
              <Icon name={t.icon} size={12} color="#fff" strokeWidth={2.2} />
              <Text style={{ fontFamily: F.bodyBold, fontSize: 10.5, color: '#fff' }}>{t.label}</Text>
            </LinearGradient>
          ) : (
            <Pressable key={t.key} onPress={() => setTab(t.key)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 8, borderRadius: 999 }}>
              <Icon name={t.icon} size={12} color={C.muted3} strokeWidth={2} />
              <Text style={{ fontFamily: F.bodySemi, fontSize: 10.5, color: C.muted }}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {/* ===== SESSIONS TAB ===== */}
      {tab === 'sessions' ? (
        <View style={{ gap: 16 }}>
          {isPhysio ? (
            <View style={{ gap: 10 }}>
              <SectionHead title="Physio Protocols" count={(protocolsQ.data ?? []).length} open={secProto} onToggle={() => setSecProto((v) => !v)}
                right={
                  <Pressable onPress={() => setCreateProtoOpen(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: hexA(C.orange, 0.12), borderWidth: 1, borderColor: hexA(C.orange, 0.4), borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 }}>
                    <Icon name="plus" size={11} color={C.orange} />
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: C.orange }}>Create Protocol</Text>
                  </Pressable>
                } />
              {secProto ? (
                protocolsQ.isLoading ? <ActivityIndicator color={C.orange} /> : !(protocolsQ.data ?? []).length ? (
                  <Body style={{ fontSize: 12, color: C.muted3, textAlign: 'center', paddingVertical: 8 }}>No protocols yet.</Body>
                ) : (protocolsQ.data ?? []).map((p: any) => <ProtocolCard key={p.id} p={p} />)
              ) : null}
            </View>
          ) : null}

          <View style={{ gap: 10 }}>
            <SectionHead title="Rehab Sessions" count={(rehabQ.data ?? []).length} open={secRehab} onToggle={() => setSecRehab((v) => !v)} />
            {secRehab ? (
              rehabQ.isLoading ? <ActivityIndicator color={C.orange} /> : !(rehabQ.data ?? []).length ? (
                <Body style={{ fontSize: 12, color: C.muted3, textAlign: 'center', paddingVertical: 8 }}>No rehab sessions logged.</Body>
              ) : (rehabQ.data ?? []).map((s: any) => <RehabSessionCard key={s.id} s={s} onShowText={(title, text) => setTextView({ title, text })} />)
            ) : null}
          </View>

          {isPhysio ? (
            <View style={{ gap: 10 }}>
              <SectionHead title="Rehab Counselling" open={secCouns} onToggle={() => setSecCouns((v) => !v)} />
              {secCouns ? <CounsellingBlock clientId={clientId} uid={uid} /> : null}
            </View>
          ) : null}

          <View style={{ gap: 10 }}>
            <SectionHead title="Workout Sessions" open={secWorkout} onToggle={() => setSecWorkout((v) => !v)} />
            {secWorkout ? (
              workoutQ.isPending ? <ActivityIndicator color={C.orange} /> : (workoutQ.data ?? []).length === 0 ? (
                <Body style={{ fontSize: 12, color: C.muted3, textAlign: 'center', paddingVertical: 8 }}>No workout sessions logged.</Body>
              ) : (
                <>
                  {(workoutQ.data ?? []).slice(0, 40).map((w: any) => <WorkoutSessionCard key={w.session_id} w={w} />)}
                  {(workoutQ.data ?? []).length > 40 ? <Body style={{ fontSize: 10.5, color: C.muted3, textAlign: 'center' }}>Showing the latest 40 workouts.</Body> : null}
                </>
              )
            ) : null}
          </View>

          <View style={{ gap: 10 }}>
            <SectionHead title="Cancelled Sessions" open={secCancel} onToggle={() => setSecCancel((v) => !v)} />
            {secCancel ? (
              cancelledQ.isLoading ? <ActivityIndicator color={C.orange} /> : !(cancelledQ.data ?? []).length ? (
                <Body style={{ fontSize: 12, color: C.muted3, textAlign: 'center', paddingVertical: 8 }}>No cancelled sessions.</Body>
              ) : (cancelledQ.data ?? []).map((s: any) => (
                <Card key={s.id} colors={CARD_G} border={hexA(C.red, 0.25)} radius={13} style={{ padding: 11, gap: 6 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Badge text="Cancelled" color={C.red} />
                    <Mono style={{ fontSize: 10.5, color: C.muted3 }}>{fmtDT(s.scheduled_at)}</Mono>
                  </View>
                  <Body style={{ fontSize: 12.5, color: '#fff' }}>{formatDoctorSessionType(s.session_type)}</Body>
                  <Body style={{ fontSize: 11, color: C.muted2 }}>by {s.trainer_name}</Body>
                  {s.notes ? <Body style={{ fontSize: 11.5, color: C.muted2 }}>Cancellation Reason: {s.notes}</Body> : null}
                  {s.attachment_url ? (
                    <Pressable onPress={() => setPreview({ url: s.attachment_url, title: 'Cancellation Attachment' })} style={{ alignSelf: 'flex-start', backgroundColor: hexA(C.blue, 0.12), borderRadius: 9, paddingHorizontal: 10, paddingVertical: 6 }}>
                      <Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: C.blue }}>View Attachment</Text>
                    </Pressable>
                  ) : null}
                </Card>
              ))
            ) : null}
          </View>
        </View>
      ) : null}

      {/* ===== MEDICAL TAB ===== */}
      {tab === 'medical' ? (
        <View style={{ gap: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Serif style={{ fontSize: 16.5, color: '#fff' }}>Medical History</Serif>
            <Pressable onPress={() => setMedEntryOpen(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: hexA(C.orange, 0.12), borderWidth: 1, borderColor: hexA(C.orange, 0.4), borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 }}>
              <Icon name="plus" size={11} color={C.orange} />
              <Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: C.orange }}>Add Entry</Text>
            </Pressable>
          </View>
          {medQ.isLoading ? <ActivityIndicator color={C.orange} /> : !(medQ.data ?? []).length ? (
            <Body style={{ fontSize: 12, color: C.muted3, textAlign: 'center', paddingVertical: 8 }}>No medical history recorded.</Body>
          ) : (medQ.data ?? []).map((e: any) => (
            <Card key={e.id} colors={CARD_G} border={hexA(SEVERITY_COLOR[e.severity] ?? C.muted3, 0.25)} radius={14} style={{ padding: 12, gap: 7 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', flex: 1 }}>
                  <Badge text={MEDICAL_CATEGORY_LABELS[e.category] ?? e.category} color={C.blue} />
                  {e.severity ? <Badge text={e.severity} color={SEVERITY_COLOR[e.severity] ?? C.muted2} /> : null}
                  {e.is_ongoing ? <Badge text="Ongoing" color={C.gold} /> : null}
                </View>
                {e.doctor_id === uid ? (
                  <Pressable hitSlop={8} onPress={() => Alert.alert('Delete entry?', `"${e.title}" will be permanently removed.`, [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Delete', style: 'destructive', onPress: () => delMedM.mutate({ id: e.id, clientId }) },
                  ])}>
                    <Icon name="close" size={15} color={C.red} />
                  </Pressable>
                ) : null}
              </View>
              <Body style={{ fontSize: 13.5, color: '#fff', fontFamily: F.bodySemi }}>{e.title}</Body>
              <Mono style={{ fontSize: 10.5, color: C.muted3 }}>{fmtD(e.event_date)}{e.end_date ? ` → ${fmtD(e.end_date)}` : ''} · by {e.doctor_name}</Mono>
              {e.description ? <Body style={{ fontSize: 12, color: C.muted }}>{e.description}</Body> : null}
              {([
                ['Problem', e.problem_description], ['Diagnosis', e.diagnosis], ['Treatment', e.treatment_given],
                ['Medicines', e.medicines_taken], ['Hospital', e.hospital_name], ['Treating doctor', e.treating_doctor],
              ] as [string, string | null][]).filter(([, v]) => v).map(([label, v]) => (
                <Body key={label} style={{ fontSize: 11.5, color: C.muted2 }}><Text style={{ color: C.muted3 }}>{label}: </Text>{v}</Body>
              ))}
            </Card>
          ))}
          <View style={{ gap: 10 }}>
            <Serif style={{ fontSize: 16.5, color: '#fff' }}>Lab Reports</Serif>
            <HealthReportsBlock clientId={clientId} onPreview={(url, title) => setPreview({ url, title })} />
          </View>
        </View>
      ) : null}

      {/* ===== REPORTS TAB ===== */}
      {tab === 'reports' ? (
        <View style={{ gap: 14 }}>
          <View style={{ gap: 10 }}>
            <Serif style={{ fontSize: 16.5, color: '#fff' }}>Health Reports</Serif>
            <HealthReportsBlock clientId={clientId} onPreview={(url, title) => setPreview({ url, title })} />
          </View>
          <View style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Serif style={{ fontSize: 16.5, color: '#fff' }}>Findings</Serif>
              <Badge text={String((findingsQ.data ?? []).length)} color={C.muted2} />
            </View>
            <Body style={{ fontSize: 10.5, color: C.muted3 }}>Upload new findings from the web dashboard.</Body>
            {findingsQ.isLoading ? <ActivityIndicator color={C.orange} /> : !(findingsQ.data ?? []).length ? (
              <Body style={{ fontSize: 12, color: C.muted3, textAlign: 'center', paddingVertical: 8 }}>No findings uploaded.</Body>
            ) : (findingsQ.data ?? []).map((fi: any) => (
              <Card key={fi.id} colors={CARD_G} border="rgba(255,150,90,0.12)" radius={13} style={{ padding: 11, gap: 7 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Body style={{ fontSize: 13, color: '#fff', fontFamily: F.bodySemi, flex: 1 }} numberOfLines={1}>{fi.title ?? fi.file_name}</Body>
                  <Mono style={{ fontSize: 10, color: C.muted3 }}>{fmtD(fi.created_at)}</Mono>
                </View>
                {fi.description ? <Body style={{ fontSize: 11.5, color: C.muted2 }}>{fi.description}</Body> : null}
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  {fi.file_url ? (
                    <Pressable onPress={() => setPreview({ url: fi.file_url, title: fi.title ?? fi.file_name ?? 'Finding' })} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: hexA(C.blue, 0.12), borderRadius: 9, paddingHorizontal: 10, paddingVertical: 6 }}>
                      <Icon name="eye" size={12} color={C.blue} /><Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: C.blue }}>View</Text>
                    </Pressable>
                  ) : <View />}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                    <Mono style={{ fontSize: 9.5, color: C.muted3 }}>Shared with client</Mono>
                    <Switch value={!!fi.shared_with_client} onValueChange={(v) => shareM.mutate({ id: fi.id, clientId, shared: v })}
                      trackColor={{ false: 'rgba(255,255,255,0.15)', true: hexA(C.green, 0.5) }} thumbColor={fi.shared_with_client ? C.green : '#888'} />
                  </View>
                </View>
              </Card>
            ))}
          </View>
        </View>
      ) : null}

      {/* ===== NOTES TAB ===== */}
      {tab === 'notes' ? (
        <View style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Serif style={{ fontSize: 16.5, color: '#fff' }}>Team Remarks</Serif>
            <Badge text={String(remarks.length)} color={C.muted2} />
          </View>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
            <Inp placeholder="Add a remark for the team…" value={remarkText} onChangeText={setRemarkText} multiline style={{ flex: 1, minHeight: 44, maxHeight: 110, textAlignVertical: 'top' }} />
            <Pressable disabled={!remarkText.trim() || addRemarkM.isPending} onPress={async () => {
              try {
                await addRemarkM.mutateAsync({ clientId, authorId: uid, content: remarkText });
                setRemarkText(''); setRemarkPage(0);
              } catch (e: any) { Alert.alert('Failed to add remark', e?.message ?? 'Unknown error'); }
            }} style={{ opacity: !remarkText.trim() ? 0.4 : 1, width: 44, height: 44, borderRadius: 13, backgroundColor: hexA(C.orange, 0.16), borderWidth: 1, borderColor: hexA(C.orange, 0.45), alignItems: 'center', justifyContent: 'center' }}>
              {addRemarkM.isPending ? <ActivityIndicator size="small" color={C.orange} /> : <Icon name="send" size={16} color={C.orange} />}
            </Pressable>
          </View>
          {remarksQ.isLoading ? <ActivityIndicator color={C.orange} /> : !remarks.length ? (
            <Body style={{ fontSize: 12, color: C.muted3, textAlign: 'center', paddingVertical: 8 }}>No remarks yet.</Body>
          ) : (
            <>
              {pageRemarks.map((r: any) => (
                <Card key={r.id} colors={CARD_G} border="rgba(255,150,90,0.1)" radius={13} style={{ padding: 11, gap: 6 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, flex: 1 }}>
                      <Body style={{ fontSize: 12, color: '#fff', fontFamily: F.bodySemi }}>{r.author_name}</Body>
                      {r.author_role ? <Badge text={r.author_role} color={ROLE_COLOR[r.author_role] ?? C.muted2} /> : null}
                    </View>
                    <Mono style={{ fontSize: 9.5, color: C.muted3 }}>{fmtDT(r.created_at)}</Mono>
                  </View>
                  <Body style={{ fontSize: 12.5, color: C.muted, lineHeight: 18 }}>{r.content}</Body>
                  {r.author_id === uid ? (
                    <View style={{ flexDirection: 'row', gap: 10 }}>
                      <Pressable onPress={() => setEditRemark({ id: r.id, content: r.content })}>
                        <Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: C.blue }}>Edit</Text>
                      </Pressable>
                      <Pressable onPress={() => Alert.alert('Delete remark?', 'This cannot be undone.', [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Delete', style: 'destructive', onPress: () => delRemarkM.mutate({ id: r.id, clientId }) },
                      ])}>
                        <Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: C.red }}>Delete</Text>
                      </Pressable>
                    </View>
                  ) : null}
                </Card>
              ))}
              {remarkPages > 1 ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
                  <Pressable disabled={remarkPage === 0} onPress={() => setRemarkPage((p) => Math.max(0, p - 1))} style={{ opacity: remarkPage === 0 ? 0.35 : 1 }}>
                    <Icon name="chevLeft" size={17} color={C.muted} />
                  </Pressable>
                  <Mono style={{ fontSize: 11, color: C.muted2 }}>{remarkPage + 1} / {remarkPages}</Mono>
                  <Pressable disabled={remarkPage >= remarkPages - 1} onPress={() => setRemarkPage((p) => Math.min(remarkPages - 1, p + 1))} style={{ opacity: remarkPage >= remarkPages - 1 ? 0.35 : 1 }}>
                    <Icon name="chevRight" size={17} color={C.muted} />
                  </Pressable>
                </View>
              ) : null}
            </>
          )}
        </View>
      ) : null}

      {/* sheets */}
      <Sheet visible={infoOpen} onClose={() => setInfoOpen(false)} title="Client Details">
        {headerQ.isLoading ? <ActivityIndicator color={C.orange} style={{ paddingVertical: 20 }} /> : (
          <View style={{ gap: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Avatar initial={(name[0] ?? '?').toUpperCase()} size={46} colors={avColors(name)} fontSize={18} />
              <View style={{ flex: 1 }}>
                <Serif numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.55} style={{ fontSize: 18, color: '#fff' }}>{name}</Serif>
                {h?.email ? <Mono style={{ fontSize: 10, color: C.muted3, marginTop: 2 }} numberOfLines={1}>{h.email}</Mono> : null}
              </View>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {h?.subscription ? <Badge text={h.subscription} color={C.gold} /> : null}
              {h?.status ? <Badge text={h.status} color={h.status === 'active' ? C.green : C.red} /> : null}
              {h?.isHybrid != null ? <Badge text={h.isHybrid ? 'Hybrid' : 'Non-Hybrid'} color={C.blue} /> : null}
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {([
                ['Age', h?.assessment.age], ['Gender', h?.assessment.gender],
                ['Height', h?.assessment.height], ['Weight', h?.assessment.weight],
                ['Goal', h?.goal], ['Location', h?.location],
                ['Completed Sessions', h?.completedSessions != null ? String(h.completedSessions) : null],
                ['Member Since', h?.createdAt ? fmtD(h.createdAt) : null],
              ] as [string, string | null | undefined][]).map(([label, v]) => (
                <View key={label} style={{ width: '48%', flexGrow: 1, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', borderRadius: 12, padding: 10 }}>
                  <Mono style={{ fontSize: 8.5, color: C.muted3, letterSpacing: 0.7 }}>{label.toUpperCase()}</Mono>
                  <Body style={{ fontSize: 13, color: v ? '#fff' : C.muted3, marginTop: 3 }} numberOfLines={2}>{v ?? '—'}</Body>
                </View>
              ))}
            </View>
            {h?.trainers.length ? (
              <View style={{ gap: 6 }}>
                <Mono style={{ fontSize: 9.5, color: C.muted3, letterSpacing: 0.7 }}>TEAM</Mono>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {h.trainers.map((t) => <Badge key={t.id} text={`${t.name}${t.role ? ` · ${t.role}` : ''}`} color={ROLE_COLOR[t.role ?? ''] ?? C.muted2} />)}
                </View>
              </View>
            ) : null}
            {h?.assessmentMedicalHistory ? (
              <View style={{ gap: 6, backgroundColor: hexA(C.red, 0.05), borderWidth: 1, borderColor: hexA(C.red, 0.18), borderRadius: 12, padding: 11 }}>
                <Mono style={{ fontSize: 9.5, color: C.red, letterSpacing: 0.7 }}>MEDICAL HISTORY (ASSESSMENT)</Mono>
                <Body style={{ fontSize: 11.5, color: C.muted, lineHeight: 17 }}>{h.assessmentMedicalHistory}</Body>
              </View>
            ) : null}
          </View>
        )}
      </Sheet>
      <PreviewSheet item={preview} onClose={() => setPreview(null)} />
      <Sheet visible={!!textView} onClose={() => setTextView(null)} title={textView?.title ?? ''}>
        {textView ? (textView.title.includes('AI') ? <AiAnalysisBody text={textView.text} /> : <Body style={{ fontSize: 12.5, color: C.muted, lineHeight: 19 }}>{textView.text}</Body>) : null}
      </Sheet>
      <Sheet visible={!!editRemark} onClose={() => setEditRemark(null)} title="Edit Remark" footer={
        <PrimaryBtn label="Save" busy={updRemarkM.isPending} disabled={!editRemark?.content.trim() || updRemarkM.isPending} onPress={async () => {
          if (!editRemark) return;
          try {
            await updRemarkM.mutateAsync({ id: editRemark.id, clientId, content: editRemark.content });
            setEditRemark(null);
          } catch (e: any) { Alert.alert('Failed to update remark', e?.message ?? 'Unknown error'); }
        }} />
      }>
        <Inp value={editRemark?.content ?? ''} onChangeText={(v: string) => setEditRemark((p) => (p ? { ...p, content: v } : p))} multiline style={{ minHeight: 90, textAlignVertical: 'top' }} />
      </Sheet>
      {isPhysio ? (
        <CreateProtocolSheet visible={createProtoOpen} onClose={() => setCreateProtoOpen(false)} clientId={clientId} clientName={name} physioId={uid} />
      ) : null}
      <MedicalEntrySheet visible={medEntryOpen} onClose={() => setMedEntryOpen(false)} clientId={clientId} doctorId={uid} />
      {isHead ? <AssignDoctorsSheet visible={assignOpen} onClose={() => setAssignOpen(false)} clientId={clientId} viewerId={uid} /> : null}
      <PhysioSessionSheet visible={logOpen} onClose={() => setLogOpen(false)} clientId={clientId} clientName={name} />
    </Page>
  );
}
