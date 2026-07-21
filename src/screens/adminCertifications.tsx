import React from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator, Modal, ScrollView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C, F, hexA, ORANGE_GRAD } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono, Card, Avatar } from '../components/primitives';
import { Page, TitleBlock, Badge } from './common';
import { useCertifications, useSaveCertification, useDeleteCertification, useCertTrainers, certTrainerName, overallPct, unweightedGrade, type Certification } from '../lib/adminCertQueries';

/* ============ ADMIN — ODDS Certifications ============ */

const AV_GRADS: [string, string][] = [['#FB8B3A', '#EE5E16'], ['#57C98A', '#2E9A63'], ['#7C8FE8', '#4A5AC8'], ['#9A7BEA', '#6E5BD0'], ['#E0A53C', '#C07C1E'], ['#4FD1C5', '#2C8A86'], ['#F687B3', '#C2568A'], ['#F0883E', '#C05621']];
const avColors = (s: string): [string, string] => AV_GRADS[[...(s || '?')].reduce((a, c) => a + c.charCodeAt(0), 0) % AV_GRADS.length];
const gradeColor = (g: string | null) => (g === 'A' ? C.green : g === 'B' ? C.blue : g === 'C' ? C.gold : g === 'D' ? '#F0883E' : C.red);
const inpSt = { borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 11, paddingVertical: 10, color: '#fff', fontFamily: F.body, fontSize: 13 } as const;

function CertFormSheet({ existing, onClose }: { existing: Certification | null; onClose: () => void }) {
  const save = useSaveCertification();
  const trainersQ = useCertTrainers();
  const [trainerId, setTrainerId] = React.useState<string | null>(existing?.trainer_id ?? null);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [course, setCourse] = React.useState(existing?.course_name ?? '');
  const [written, setWritten] = React.useState(existing?.written_test != null ? String(existing.written_test) : '');
  const [viva, setViva] = React.useState(existing?.viva != null ? String(existing.viva) : '');
  const [english, setEnglish] = React.useState(existing?.english_spoken != null ? String(existing.english_spoken) : '');
  const [err, setErr] = React.useState<string | null>(null);
  const preview = unweightedGrade(Number(written) || 0, Number(viva) || 0, Number(english) || 0);
  const selected = (trainersQ.data ?? []).find((t) => t.id === trainerId) ?? null;
  const term = search.trim().toLowerCase();
  const list = (trainersQ.data ?? []).filter((t) => !term || t.name.toLowerCase().includes(term));
  const scoreField = (label: string, max: number, val: string, set: (v: string) => void) => (
    <View style={{ gap: 5 }}>
      <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.mono2 }}>{label}</Mono>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <TextInput value={val} onChangeText={set} keyboardType="numeric" placeholder="Enter score" placeholderTextColor={C.muted3} style={[inpSt, { flex: 1 }]} />
        <Mono style={{ fontSize: 11, color: C.muted2 }}>/{max}</Mono>
      </View>
    </View>
  );
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.62)', justifyContent: 'flex-end' }}>
        <View style={{ maxHeight: '92%', backgroundColor: '#0E0A09', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.14)', paddingHorizontal: 18, paddingTop: 14, paddingBottom: 24 }}>
          <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 12 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 10 }}>
            <Serif style={{ flex: 1, fontSize: 18 }}>{existing ? 'Edit Certification' : 'Add New Certification'}</Serif>
            <Pressable onPress={onClose} hitSlop={8} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="close" size={13} color="#B8B2AC" strokeWidth={2.3} />
            </Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 10, paddingBottom: 8 }}>
            <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.mono2 }}>TRAINER</Mono>
            <Pressable onPress={() => setPickerOpen((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 11, paddingHorizontal: 12, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: pickerOpen ? hexA(C.orange, 0.45) : 'rgba(255,255,255,0.1)' }}>
              <Text numberOfLines={1} style={{ flex: 1, fontFamily: selected ? F.bodySemi : F.body, fontSize: 12.5, color: selected ? '#fff' : C.muted3 }}>{selected?.name ?? 'Select trainer'}</Text>
              <Icon name={pickerOpen ? 'chevUp' : 'chevDown'} size={12} color={C.muted2} strokeWidth={2.3} />
            </Pressable>
            {pickerOpen ? (
              <View style={{ borderRadius: 11, backgroundColor: 'rgba(20,16,14,0.98)', borderWidth: 1, borderColor: hexA(C.orange, 0.35), overflow: 'hidden' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 11, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' }}>
                  <Icon name="search" size={12} color={C.muted3} strokeWidth={2} />
                  <TextInput value={search} onChangeText={setSearch} placeholder="Search…" placeholderTextColor={C.muted3} style={{ flex: 1, fontFamily: F.body, fontSize: 12, color: '#fff', padding: 0 }} />
                </View>
                <ScrollView style={{ maxHeight: 190 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                  {list.map((t, i) => (
                    <Pressable key={t.id} onPress={() => { setTrainerId(t.id); setPickerOpen(false); }} style={{ paddingVertical: 10, paddingHorizontal: 12, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: 'rgba(255,255,255,0.05)', backgroundColor: trainerId === t.id ? hexA(C.orange, 0.09) : 'transparent' }}>
                      <Text style={{ fontFamily: trainerId === t.id ? F.bodyBold : F.bodySemi, fontSize: 12, color: trainerId === t.id ? C.orange : '#fff' }}>{t.name}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            ) : null}
            <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.mono2 }}>COURSE NAME</Mono>
            <TextInput value={course} onChangeText={setCourse} placeholder="Enter course name" placeholderTextColor={C.muted3} style={inpSt} />
            {scoreField('WRITTEN TEST SCORE', 90, written, setWritten)}
            {scoreField('VIVA SCORE', 6, viva, setViva)}
            {scoreField('ENGLISH SPOKEN SCORE', 10, english, setEnglish)}
            {/* Live preview (web form: unweighted average drives the grade) */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 13, backgroundColor: hexA(C.gold, 0.08), borderWidth: 1, borderColor: hexA(C.gold, 0.3) }}>
              <View style={{ flex: 1 }}>
                <Mono style={{ fontSize: 8, letterSpacing: 0.6, color: C.muted3 }}>OVERALL SCORE</Mono>
                <Serif style={{ fontSize: 20, color: '#F2C066' }}>{preview.avg}%</Serif>
              </View>
              <View style={{ paddingVertical: 6, paddingHorizontal: 13, borderRadius: 999, backgroundColor: gradeColor(preview.grade) }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: '#0c0808' }}>Grade: {preview.grade}</Text>
              </View>
            </View>
            {err ? <Body style={{ fontSize: 10.5, color: C.red }}>{err}</Body> : null}
            <Pressable disabled={save.isPending} onPress={() => {
              setErr(null);
              save.mutate({ id: existing?.id, trainerId: trainerId ?? '', courseName: course, written: Number(written), viva: Number(viva), english: Number(english) },
                { onSuccess: onClose, onError: (e: any) => setErr(e?.message ?? 'Failed') });
            }} style={{ overflow: 'hidden', borderRadius: 12 }}>
              <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ alignItems: 'center', paddingVertical: 13 }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: '#fff' }}>{save.isPending ? 'Saving…' : existing ? 'Save Changes' : 'Add Certification'}</Text>
              </LinearGradient>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export function AdminCertifications() {
  const q = useCertifications();
  const del = useDeleteCertification();
  const [sheet, setSheet] = React.useState<{ open: true; cert: Certification | null } | null>(null);
  const [delArm, setDelArm] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const rows = q.data ?? [];
  return (
    <Page gap={13}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <View style={{ flex: 1 }}><TitleBlock title="Odds Certifications" sub="Trainer certification scores & grades" /></View>
        <Pressable onPress={() => setSheet({ open: true, cert: null })} style={{ overflow: 'hidden', borderRadius: 12 }}>
          <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 13 }}>
            <Icon name="award" size={13} color="#fff" strokeWidth={2.2} />
            <Text style={{ fontFamily: F.bodyBold, fontSize: 11.5, color: '#fff' }}>Add</Text>
          </LinearGradient>
        </Pressable>
      </View>
      {err ? <Body style={{ fontSize: 10.5, color: C.red, textAlign: 'center' }}>{err}</Body> : null}
      {q.isError ? <Body style={{ fontSize: 11, color: C.red, textAlign: 'center' }}>{(q.error as Error).message}</Body> : null}
      {q.isPending ? <View style={{ paddingVertical: 28, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View>
      : rows.length === 0 ? (
        <View style={{ alignItems: 'center', gap: 8, paddingVertical: 30 }}>
          <Icon name="award" size={26} color={C.muted3} strokeWidth={1.8} />
          <Body style={{ fontSize: 12, color: C.muted3 }}>No certifications yet — add the first one.</Body>
        </View>
      ) : rows.map((c) => {
        const name = certTrainerName(c);
        const pct = overallPct(c);
        const gc = gradeColor(c.grade);
        return (
          <Card key={c.id} colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border={hexA(gc, 0.22)} radius={15} style={{ padding: 12, gap: 9, borderLeftWidth: 3, borderLeftColor: gc }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
              <Avatar initial={(name[0] ?? '?').toUpperCase()} size={32} colors={avColors(name)} fontSize={12} />
              <View style={{ flex: 1 }}>
                <Body numberOfLines={1} style={{ fontSize: 13, fontFamily: F.bodySemi, color: '#fff' }}>{name}</Body>
                <Body numberOfLines={1} style={{ fontSize: 10.5, color: C.muted2, marginTop: 1 }}>{c.course_name ?? '—'}</Body>
              </View>
              <View style={{ alignItems: 'center' }}>
                <Serif style={{ fontSize: 19, color: gc }}>{pct}%</Serif>
                <Mono style={{ fontSize: 6.5, letterSpacing: 0.4, color: C.muted3 }}>OVERALL</Mono>
              </View>
              <View style={{ paddingVertical: 5, paddingHorizontal: 11, borderRadius: 999, backgroundColor: gc }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: '#0c0808' }}>{c.grade ?? '—'}</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <Badge text={`Written ${c.written_test ?? 0}/90`} color={C.blue} />
              <Badge text={`VIVA ${c.viva ?? 0}/6`} color={C.purple} />
              <Badge text={`English ${c.english_spoken ?? 0}/10`} color={C.gold} />
              <View style={{ flex: 1 }} />
              <Pressable onPress={() => setSheet({ open: true, cert: c })} hitSlop={5} style={{ width: 28, height: 28, borderRadius: 9, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="clipboard" size={12} color={C.muted} strokeWidth={2} />
              </Pressable>
              <Pressable disabled={del.isPending} onPress={() => {
                setErr(null);
                if (delArm === c.id) del.mutate(c.id, { onSuccess: () => setDelArm(null), onError: (e: any) => { setDelArm(null); setErr(e?.message ?? 'Failed'); } });
                else setDelArm(c.id);
              }} hitSlop={5} style={{ width: 28, height: 28, borderRadius: 9, backgroundColor: hexA(C.red, delArm === c.id ? 0.28 : 0.08), borderWidth: 1, borderColor: hexA(C.red, 0.4), alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="close" size={11} color={C.red} strokeWidth={2.5} />
              </Pressable>
            </View>
          </Card>
        );
      })}
      {delArm ? <Body style={{ fontSize: 9.5, color: C.red }}>Tap ✕ again to delete the certification.</Body> : null}
      {sheet ? <CertFormSheet existing={sheet.cert} onClose={() => setSheet(null)} /> : null}
    </Page>
  );
}
