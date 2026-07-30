import React from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Modal, ActivityIndicator, Alert, Keyboard, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C, F, hexA, ORANGE_GRAD } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono, Card, Avatar, ProgressBar } from '../components/primitives';
import { Page, TitleBlock, HScroll, Badge } from './common';
import { useAuth } from '../auth';
import { useStore } from '../store';
import { AcademyCalendarTab } from './academyCalendar';
import { AttendanceApprovalPanel, PendingAttendanceBanner } from './academyApproval';
import {
  useAcademyOverview, useAcademyUsers, useSaveAcademyUser, useSoftDeleteAcademyUser, useEnrollmentCounts,
  useAcademyBatches, useDeleteBatch, useSaveBatch, useSetBatchTeachers, useBatchStudents, useAttendanceByBatchDate, useUpsertAttendance,
  useAttendanceReport, useAssessments, useUpsertAssessmentMarks, useUpdateAssessmentMeta,
  ATT_STATUSES, AttStatus, attPct, attWeight, LOW_ATTENDANCE_PCT, istToday, istDaysAgo, prettyDate,
  defaultPassMarks, AcademyUser, AcademyBatch,
} from '../lib/academyQueries';

/* ============================================================================
   Academy Management — the academy-admin workspace (profiles.role 'academy',
   also reachable by admins). Mirrors the web module's six surfaces, tuned for
   phones: marking attendance is the primary on-site flow.
   ========================================================================== */

const ACC = '#6EA8FE'; // academy accent (distinct from the other workspaces)
const inputStyle = {
  paddingVertical: 11, paddingHorizontal: 13, borderRadius: 12, borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.04)',
  color: '#fff', fontFamily: F.body, fontSize: 14,
} as const;

const initials = (n: string) => n.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';
const avColors = (n: string): [string, string] => {
  const sets: [string, string][] = [['#7C8FE8', '#9A7BEA'], ['#E8A87C', '#EA7B9A'], ['#7CE8C1', '#4FB6E8'], ['#E8D07C', '#E8A87C']];
  let h = 0; for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
  return sets[h % sets.length];
};
const attColor = (s: string) => (s === 'present' ? C.green : s === 'late' ? C.gold : s === 'leave' ? C.blue : C.red);

type Tab = 'overview' | 'students' | 'teachers' | 'batches' | 'calendar' | 'attendance' | 'assessments';

export function AcademyDashboard() {
  const [tab, setTab] = React.useState<Tab>('overview');
  // Batch card → Attendance tab, pre-filtered (web cross-tab deep link).
  const [attBatchId, setAttBatchId] = React.useState<string | null>(null);
  const jumpToAttendance = (batchId: string) => { setAttBatchId(batchId); setTab('attendance'); };

  const TABS: { key: Tab; label: string; icon: any }[] = [
    { key: 'overview', label: 'Overview', icon: 'grid' },
    { key: 'students', label: 'Students', icon: 'users' },
    { key: 'teachers', label: 'Teachers', icon: 'userCircle' },
    { key: 'batches', label: 'Batches', icon: 'layers' },
    { key: 'calendar', label: 'Calendar', icon: 'calendar' },
    { key: 'attendance', label: 'Attendance', icon: 'checks' },
    { key: 'assessments', label: 'Marks', icon: 'clipboard' },
  ];

  return (
    <Page gap={14} pt={6}>
      <TitleBlock title="Academy" sub="Students, batches, attendance and marks" />
      <HScroll gap={7}>
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <Pressable key={t.key} onPress={() => setTab(t.key)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 13, borderRadius: 999, backgroundColor: active ? hexA(ACC, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(ACC, 0.5) : 'rgba(255,255,255,0.09)' }}>
              <Icon name={t.icon} size={12} color={active ? ACC : C.muted2} strokeWidth={2.1} />
              <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 12, color: active ? ACC : C.muted }}>{t.label}</Text>
            </Pressable>
          );
        })}
      </HScroll>

      {tab === 'overview' ? <OverviewTab onOpenBatches={() => setTab('batches')} />
        : tab === 'students' ? <PeopleTab role="student" />
        : tab === 'teachers' ? <PeopleTab role="teacher" />
        : tab === 'batches' ? <BatchesTab onAttendance={jumpToAttendance} />
        : tab === 'calendar' ? <AcademyCalendarTab />
        : tab === 'attendance' ? <AttendanceTab presetBatchId={attBatchId} />
        : <AssessmentsTab />}
    </Page>
  );
}

/* ---------------- Overview ---------------- */
function OverviewTab({ onOpenBatches }: { onOpenBatches: () => void }) {
  const q = useAcademyOverview();
  const batchesQ = useAcademyBatches();
  const d = q.data;
  const recent = (batchesQ.data ?? []).slice(0, 5);
  const maxTotal = Math.max(...(d?.last7 ?? []).map((r) => r.total), 1);

  return (
    <View style={{ gap: 13 }}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {([['Students', d?.students, ACC], ['Teachers', d?.teachers, C.purple]] as const).map(([lab, n, col]) => (
          <View key={lab} style={{ flex: 1, alignItems: 'center', paddingVertical: 14, borderRadius: 15, backgroundColor: hexA(col, 0.07), borderWidth: 1, borderColor: hexA(col, 0.25) }}>
            <Serif style={{ fontSize: 26, color: col }}>{q.isPending ? '…' : n ?? 0}</Serif>
            <Mono style={{ fontSize: 8, letterSpacing: 0.8, color: C.muted3, marginTop: 2 }}>{lab.toUpperCase()}</Mono>
          </View>
        ))}
        {([['Batches', d?.activeBatches, C.orange], ["Today", d?.todayPct, C.green]] as const).map(([lab, n, col]) => (
          <View key={lab} style={{ flex: 1, alignItems: 'center', paddingVertical: 14, borderRadius: 15, backgroundColor: hexA(col, 0.07), borderWidth: 1, borderColor: hexA(col, 0.25) }}>
            <Serif style={{ fontSize: 26, color: col }}>{q.isPending ? '…' : lab === 'Today' ? `${n ?? 0}%` : n ?? 0}</Serif>
            <Mono style={{ fontSize: 8, letterSpacing: 0.8, color: C.muted3, marginTop: 2 }}>{lab === 'Today' ? 'ATTENDANCE' : 'ACTIVE'}</Mono>
          </View>
        ))}
      </View>
      {d && d.todayMarked === 0 ? (
        <Body style={{ fontSize: 10.5, color: C.muted3, textAlign: 'center', marginTop: -6 }}>No attendance marked yet today.</Body>
      ) : null}

      {/* 7-day attendance */}
      <Card colors={['rgba(30,38,58,0.5)', 'rgba(16,16,20,0.55)']} border={hexA(ACC, 0.16)} radius={17} style={{ padding: 15, gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Icon name="chart" size={14} color={ACC} strokeWidth={2} />
          <Mono style={{ flex: 1, fontSize: 9, letterSpacing: 1, color: C.mono2 }}>ATTENDANCE · LAST 7 DAYS</Mono>
        </View>
        {q.isPending ? (
          <ActivityIndicator color={ACC} style={{ paddingVertical: 20 }} />
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 108 }}>
            {(d?.last7 ?? []).map((r) => {
              const h = Math.max(4, (r.pct / 100) * 84);
              const dim = r.total === 0;
              return (
                <View key={r.date} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
                  <Text style={{ fontFamily: F.mono, fontSize: 8, color: dim ? C.muted3 : r.pct < LOW_ATTENDANCE_PCT ? C.red : C.green }}>{dim ? '—' : `${r.pct}%`}</Text>
                  <View style={{ width: '100%', height: h, borderRadius: 5, backgroundColor: dim ? 'rgba(255,255,255,0.05)' : hexA(r.pct < LOW_ATTENDANCE_PCT ? C.red : C.green, 0.75) }} />
                  <Mono style={{ fontSize: 7.5, color: C.muted3 }}>{r.date.slice(8)}</Mono>
                </View>
              );
            })}
          </View>
        )}
        <Body style={{ fontSize: 9.5, color: C.muted3 }}>Weighted: present counts 1, late counts 0.5.</Body>
      </Card>

      {/* Recent batches */}
      <Card colors={['rgba(30,38,58,0.5)', 'rgba(16,16,20,0.55)']} border="rgba(255,255,255,0.08)" radius={17} style={{ padding: 15, gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Mono style={{ flex: 1, fontSize: 9, letterSpacing: 1, color: C.mono2 }}>RECENT BATCHES</Mono>
          <Pressable onPress={onOpenBatches} hitSlop={8}><Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: ACC }}>See all</Text></Pressable>
        </View>
        {batchesQ.isPending ? <ActivityIndicator color={ACC} style={{ paddingVertical: 14 }} />
          : recent.length === 0 ? <Body style={{ fontSize: 12, color: C.muted3, textAlign: 'center', paddingVertical: 12 }}>No batches yet.</Body>
          : recent.map((b) => (
            <View key={b.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)' }}>
              <View style={{ flex: 1 }}>
                <Body numberOfLines={1} style={{ fontSize: 13, fontFamily: F.bodySemi, color: '#fff' }}>{b.course_name} · {b.batch_name}</Body>
                <Body numberOfLines={1} style={{ fontSize: 10.5, color: C.muted2, marginTop: 1 }}>
                  {b.teachers[0]?.name ?? 'No teacher'}{b.teachers.length > 1 ? ` +${b.teachers.length - 1}` : ''} · {b.enrolled} enrolled
                </Body>
              </View>
              <Badge text={b.status} color={b.status === 'active' ? C.green : b.status === 'completed' ? C.blue : C.red} />
            </View>
          ))}
      </Card>
    </View>
  );
}

/* ---------------- Students / Teachers ---------------- */
function PeopleTab({ role }: { role: 'student' | 'teacher' }) {
  const q = useAcademyUsers(role);
  const enrollQ = useEnrollmentCounts();
  const batchesQ = useAcademyBatches();
  const saveM = useSaveAcademyUser();
  const delM = useSoftDeleteAcademyUser();
  const [search, setSearch] = React.useState('');
  const [showInactive, setShowInactive] = React.useState(false);
  const [editing, setEditing] = React.useState<Partial<AcademyUser> | null>(null);

  // Teachers: how many batches they teach (primary or co-teacher).
  const batchCount = React.useMemo(() => {
    const m: Record<string, number> = {};
    (batchesQ.data ?? []).forEach((b) => b.teachers.forEach((t) => { m[t.id] = (m[t.id] ?? 0) + 1; }));
    return m;
  }, [batchesQ.data]);

  const qq = search.trim().toLowerCase();
  const rows = (q.data ?? [])
    .filter((u) => showInactive || u.status === 'active')
    .filter((u) => !qq || u.name.toLowerCase().includes(qq) || (u.email ?? '').toLowerCase().includes(qq) || (u.roll_no ?? '').toLowerCase().includes(qq));

  const confirmDelete = (u: AcademyUser) =>
    Alert.alert(`Deactivate ${u.name}?`, 'They stay in the records but are marked inactive and hidden from active lists.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Deactivate', style: 'destructive', onPress: () => delM.mutate(u.id, { onError: (e: any) => Alert.alert('Failed', e?.message ?? 'Try again') }) },
    ]);

  return (
    <View style={{ gap: 11 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)' }}>
          <Icon name="search" size={14} color={C.muted3} strokeWidth={2} />
          <TextInput value={search} onChangeText={setSearch} placeholder={`Search ${role}s…`} placeholderTextColor={C.muted3} autoCorrect={false} style={{ flex: 1, fontFamily: F.body, fontSize: 13.5, color: '#fff', padding: 0 }} />
        </View>
        <Pressable onPress={() => setEditing({ role, status: 'active' })} style={{ borderRadius: 12, overflow: 'hidden' }}>
          <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 42, height: 42, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="plus" size={18} color="#fff" strokeWidth={2.6} />
          </LinearGradient>
        </Pressable>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Pressable onPress={() => setShowInactive((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 11, borderRadius: 999, backgroundColor: showInactive ? hexA(C.muted2, 0.14) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: showInactive ? hexA(C.muted2, 0.4) : 'rgba(255,255,255,0.09)' }}>
          <Icon name={showInactive ? 'checks' : 'eye'} size={11} color={C.muted2} strokeWidth={2.2} />
          <Text style={{ fontFamily: F.bodySemi, fontSize: 10.5, color: C.muted }}>Show inactive</Text>
        </Pressable>
        <Mono style={{ flex: 1, textAlign: 'right', fontSize: 9, color: C.muted3 }}>{rows.length} {role.toUpperCase()}{rows.length === 1 ? '' : 'S'}</Mono>
      </View>

      {q.isPending ? <ActivityIndicator color={ACC} style={{ paddingVertical: 26 }} />
        : rows.length === 0 ? <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 26 }}>No {role}s found.</Body>
        : rows.map((u) => (
          <Pressable key={u.id} onPress={() => setEditing(u)} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: 13, borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: u.status === 'active' ? 'rgba(255,255,255,0.07)' : hexA(C.red, 0.18) }}>
            <Avatar initial={initials(u.name)} size={38} colors={avColors(u.name)} fontSize={13} />
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                <Body numberOfLines={1} style={{ flex: 1, fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }}>{u.name}</Body>
                {u.status !== 'active' ? <Badge text="Inactive" color={C.red} /> : null}
              </View>
              <Body numberOfLines={1} style={{ fontSize: 10.5, color: C.muted2, marginTop: 1 }}>
                {[u.roll_no ? `Roll ${u.roll_no}` : null, u.email, u.phone].filter(Boolean).join(' · ') || 'No contact details'}
              </Body>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 3 }}>
              <Mono style={{ fontSize: 12, color: ACC }}>{role === 'student' ? (enrollQ.data?.[u.id] ?? 0) : (batchCount[u.id] ?? 0)}</Mono>
              <Mono style={{ fontSize: 6.5, letterSpacing: 0.6, color: C.muted3 }}>BATCHES</Mono>
            </View>
            {u.status === 'active' ? (
              <Pressable onPress={() => confirmDelete(u)} hitSlop={8} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: hexA(C.red, 0.1), alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="close" size={12} color={C.red} strokeWidth={2.3} />
              </Pressable>
            ) : null}
          </Pressable>
        ))}

      <PersonSheet
        value={editing} role={role} busy={saveM.isPending}
        onClose={() => setEditing(null)}
        onSave={(v) => saveM.mutate({ ...v, role } as any, {
          onSuccess: () => setEditing(null),
          onError: (e: any) => Alert.alert('Could not save', e?.message ?? 'Try again'),
        })}
      />
    </View>
  );
}

function PersonSheet({ value, role, busy, onClose, onSave }: {
  value: Partial<AcademyUser> | null; role: 'student' | 'teacher'; busy: boolean;
  onClose: () => void; onSave: (v: Partial<AcademyUser>) => void;
}) {
  const [form, setForm] = React.useState<Partial<AcademyUser>>({});
  React.useEffect(() => { if (value) setForm(value); }, [value]);
  const [kb, setKb] = React.useState(0);
  React.useEffect(() => {
    const s = Keyboard.addListener('keyboardDidShow', (e) => setKb(e.endCoordinates.height));
    const h = Keyboard.addListener('keyboardDidHide', () => setKb(0));
    return () => { s.remove(); h.remove(); };
  }, []);
  if (!value) return null;
  const isEdit = !!value.id;
  const field = (label: string, key: keyof AcademyUser, opts: any = {}) => (
    <View style={{ gap: 5 }}>
      <Mono style={{ fontSize: 9, letterSpacing: 1, color: C.mono2 }}>{label}</Mono>
      <TextInput
        value={(form[key] as string) ?? ''}
        onChangeText={(t) => setForm((f) => ({ ...f, [key]: t }))}
        placeholderTextColor={C.muted3} style={inputStyle} {...opts}
      />
    </View>
  );
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={{ maxHeight: '88%', backgroundColor: '#12131A', borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: hexA(ACC, 0.18), paddingHorizontal: 18, paddingTop: 16, paddingBottom: kb > 0 ? kb + 16 : 26 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <Serif style={{ flex: 1, fontSize: 19 }}>{isEdit ? 'Edit' : 'Add'} {role}</Serif>
            <Pressable onPress={onClose} hitSlop={10} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="close" size={13} color={C.muted2} strokeWidth={2.3} />
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 11 }} showsVerticalScrollIndicator={false}>
            {field('NAME *', 'name', { placeholder: 'Full name', autoCapitalize: 'words' })}
            {field('EMAIL', 'email', { placeholder: 'name@example.com', keyboardType: 'email-address', autoCapitalize: 'none', autoCorrect: false })}
            {field('PHONE', 'phone', { placeholder: '9876543210', keyboardType: 'phone-pad' })}
            {role === 'student' ? field('ROLL NO', 'roll_no', { placeholder: 'Optional', autoCapitalize: 'characters' }) : null}
            <View style={{ gap: 5 }}>
              <Mono style={{ fontSize: 9, letterSpacing: 1, color: C.mono2 }}>STATUS</Mono>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {(['active', 'inactive'] as const).map((s) => {
                  const on = (form.status ?? 'active') === s;
                  return (
                    <Pressable key={s} onPress={() => setForm((f) => ({ ...f, status: s }))} style={{ flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 12, backgroundColor: on ? hexA(s === 'active' ? C.green : C.red, 0.14) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: on ? hexA(s === 'active' ? C.green : C.red, 0.45) : 'rgba(255,255,255,0.09)' }}>
                      <Text style={{ fontFamily: on ? F.bodyBold : F.bodySemi, fontSize: 12.5, color: on ? (s === 'active' ? C.green : C.red) : C.muted }}>{s === 'active' ? 'Active' : 'Inactive'}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
            <Pressable disabled={busy || !(form.name ?? '').trim()} onPress={() => onSave(form)} style={{ borderRadius: 13, overflow: 'hidden', opacity: busy || !(form.name ?? '').trim() ? 0.5 : 1, marginTop: 4 }}>
              <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ alignItems: 'center', paddingVertical: 14 }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: '#fff' }}>{busy ? 'Saving…' : isEdit ? 'Save changes' : `Add ${role}`}</Text>
              </LinearGradient>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/* ---------------- Batches ---------------- */
function BatchesTab({ onAttendance }: { onAttendance: (batchId: string) => void }) {
  const q = useAcademyBatches();
  const delM = useDeleteBatch();
  const [rosterFor, setRosterFor] = React.useState<AcademyBatch | null>(null);
  // 'new' opens an empty form; a batch opens it prefilled for editing.
  const [formFor, setFormFor] = React.useState<'new' | AcademyBatch | null>(null);

  const confirmDelete = (b: AcademyBatch) =>
    Alert.alert(
      'Delete batch?',
      `"${b.course_name} · ${b.batch_name}" and ALL its enrollments, attendance and marks will be permanently deleted. This cannot be undone.`,
      [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => delM.mutate(b.id, { onError: (e: any) => Alert.alert('Failed', e?.message ?? 'Try again') }) }]
    );

  return (
    <View style={{ gap: 11 }}>
      {/* Create Batch */}
      <Pressable onPress={() => setFormFor('new')} style={{ borderRadius: 13, overflow: 'hidden' }}>
        <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 12 }}>
          <Icon name="plus" size={15} color="#fff" strokeWidth={2.6} />
          <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: '#fff' }}>Create Batch</Text>
        </LinearGradient>
      </Pressable>

      {q.isPending ? <ActivityIndicator color={ACC} style={{ paddingVertical: 26 }} />
        : (q.data ?? []).length === 0 ? <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 26 }}>No batches yet.</Body>
        : (q.data ?? []).map((b) => {
          const days = b.schedule?.days ?? [];
          const col = b.status === 'active' ? C.green : b.status === 'completed' ? C.blue : C.red;
          return (
            <Card key={b.id} colors={['rgba(30,38,58,0.5)', 'rgba(16,16,20,0.55)']} border={hexA(col, 0.16)} radius={17} style={{ padding: 14, gap: 11 }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 9 }}>
                <View style={{ flex: 1 }}>
                  <Body style={{ fontSize: 15, fontFamily: F.bodySemi, color: '#fff' }}>{b.course_name}</Body>
                  <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 1 }}>{b.batch_name}</Body>
                </View>
                <Badge text={b.status} color={col} />
              </View>

              {b.teachers.length ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {b.teachers.map((t) => (
                    <View key={t.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4, paddingHorizontal: 9, borderRadius: 999, backgroundColor: hexA(t.isPrimary ? ACC : C.muted2, 0.1), borderWidth: 1, borderColor: hexA(t.isPrimary ? ACC : C.muted2, 0.3) }}>
                      {t.isPrimary ? <Icon name="crown" size={9} color={ACC} strokeWidth={2.2} /> : null}
                      <Text style={{ fontFamily: F.bodySemi, fontSize: 10.5, color: t.isPrimary ? ACC : C.muted }}>{t.name}</Text>
                    </View>
                  ))}
                </View>
              ) : <Body style={{ fontSize: 10.5, color: C.muted3 }}>No teacher assigned.</Body>}

              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {days.length ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    <Icon name="calendar" size={11} color={C.muted3} strokeWidth={2} />
                    <Text style={{ fontFamily: F.bodySemi, fontSize: 10.5, color: C.ink3 }}>{days.join(', ')}{b.schedule?.time ? ` · ${b.schedule.time} IST` : ''}</Text>
                  </View>
                ) : null}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  <Icon name="users" size={11} color={C.muted3} strokeWidth={2} />
                  <Text style={{ fontFamily: F.bodySemi, fontSize: 10.5, color: C.ink3 }}>{b.enrolled} enrolled</Text>
                </View>
              </View>
              <Mono style={{ fontSize: 8.5, color: C.muted3 }}>{prettyDate(b.start_date)} → {prettyDate(b.end_date)}</Mono>

              <View style={{ flexDirection: 'row', gap: 7 }}>
                <Pressable onPress={() => setRosterFor(b)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 9, borderRadius: 11, backgroundColor: hexA(C.purple, 0.1), borderWidth: 1, borderColor: hexA(C.purple, 0.3) }}>
                  <Icon name="users" size={11} color={C.purple} strokeWidth={2.2} />
                  <Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: C.purple }}>Students</Text>
                </Pressable>
                <Pressable onPress={() => onAttendance(b.id)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 9, borderRadius: 11, backgroundColor: hexA(C.green, 0.1), borderWidth: 1, borderColor: hexA(C.green, 0.3) }}>
                  <Icon name="checks" size={11} color={C.green} strokeWidth={2.2} />
                  <Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: C.green }}>Attendance</Text>
                </Pressable>
                <Pressable onPress={() => setFormFor(b)} style={{ paddingVertical: 9, paddingHorizontal: 13, borderRadius: 11, backgroundColor: hexA(ACC, 0.1), borderWidth: 1, borderColor: hexA(ACC, 0.32) }}>
                  <Icon path="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" size={12} color={ACC} strokeWidth={2.1} />
                </Pressable>
                <Pressable onPress={() => confirmDelete(b)} style={{ paddingVertical: 9, paddingHorizontal: 13, borderRadius: 11, backgroundColor: hexA(C.red, 0.08), borderWidth: 1, borderColor: hexA(C.red, 0.28) }}>
                  <Icon path="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14ZM10 11v6M14 11v6" size={12} color={C.red} strokeWidth={2.1} />
                </Pressable>
              </View>
            </Card>
          );
        })}

      {/* Batch roster */}
      <Modal visible={!!rosterFor} transparent animationType="slide" onRequestClose={() => setRosterFor(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }}>
          <Pressable style={{ flex: 1 }} onPress={() => setRosterFor(null)} />
          <View style={{ maxHeight: '80%', backgroundColor: '#12131A', borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: hexA(ACC, 0.18), paddingHorizontal: 18, paddingTop: 16, paddingBottom: 26 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <View style={{ flex: 1 }}>
                <Serif style={{ fontSize: 18 }}>{rosterFor?.batch_name}</Serif>
                <Body style={{ fontSize: 11, color: C.muted2 }}>{rosterFor?.course_name} · {rosterFor?.enrolled} enrolled</Body>
              </View>
              <Pressable onPress={() => setRosterFor(null)} hitSlop={10} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="close" size={13} color={C.muted2} strokeWidth={2.3} />
              </Pressable>
            </View>
            {rosterFor ? <BatchRoster batchId={rosterFor.id} /> : null}
          </View>
        </View>
      </Modal>

      <BatchFormSheet value={formFor} onClose={() => setFormFor(null)} />
    </View>
  );
}

/* ---------- Create / Edit batch (web BatchFormDialog port) ---------- */
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const BATCH_STATUSES = ['active', 'completed', 'cancelled'] as const;
const ymdOk = (s: string) => !s || /^\d{4}-\d{2}-\d{2}$/.test(s);

function BatchFormSheet({ value, onClose }: { value: 'new' | AcademyBatch | null; onClose: () => void }) {
  const teachersQ = useAcademyUsers('teacher', false);
  const saveM = useSaveBatch();
  const isEdit = value !== 'new' && value != null;
  const [course, setCourse] = React.useState('');
  const [name, setName] = React.useState('');
  const [teacherIds, setTeacherIds] = React.useState<string[]>([]);
  const [primaryId, setPrimaryId] = React.useState<string | null>(null);
  const [startDate, setStartDate] = React.useState('');
  const [endDate, setEndDate] = React.useState('');
  const [days, setDays] = React.useState<Set<string>>(new Set());
  const [time, setTime] = React.useState('');
  const [status, setStatus] = React.useState<string>('active');
  const [kb, setKb] = React.useState(0);
  React.useEffect(() => {
    const s = Keyboard.addListener('keyboardDidShow', (e) => setKb(e.endCoordinates.height));
    const h = Keyboard.addListener('keyboardDidHide', () => setKb(0));
    return () => { s.remove(); h.remove(); };
  }, []);
  React.useEffect(() => {
    if (!value) return;
    if (value === 'new') {
      setCourse(''); setName(''); setTeacherIds([]); setPrimaryId(null);
      setStartDate(''); setEndDate(''); setDays(new Set()); setTime(''); setStatus('active');
    } else {
      setCourse(value.course_name); setName(value.batch_name);
      setTeacherIds(value.teachers.map((t) => t.id));
      setPrimaryId(value.teachers.find((t) => t.isPrimary)?.id ?? value.teachers[0]?.id ?? null);
      setStartDate(value.start_date ?? ''); setEndDate(value.end_date ?? '');
      setDays(new Set(value.schedule?.days ?? [])); setTime(value.schedule?.time ?? '');
      setStatus(value.status || 'active');
    }
  }, [value]);

  // Tap toggles membership; tap the star on a selected teacher to make them primary.
  const toggleTeacher = (id: string) => {
    setTeacherIds((ids) => {
      const has = ids.includes(id);
      const next = has ? ids.filter((x) => x !== id) : [...ids, id];
      setPrimaryId((p) => {
        if (has && p === id) return next[0] ?? null;   // removed the primary → first remaining
        if (!has && !p) return id;                     // first teacher added becomes primary
        return p;
      });
      return next;
    });
  };

  const canSave = !!course.trim() && !!name.trim() && teacherIds.length > 0 && !!primaryId && ymdOk(startDate) && ymdOk(endDate) && !saveM.isPending;
  const save = () => {
    if (!canSave) return;
    saveM.mutate(
      {
        id: isEdit ? (value as AcademyBatch).id : null,
        payload: {
          course_name: course.trim(), batch_name: name.trim(),
          start_date: startDate || null, end_date: endDate || null,
          schedule: { days: [...days], time: time.trim() },
          status,
        },
        teacherIds, primaryId,
      },
      {
        onSuccess: () => { Alert.alert(isEdit ? 'Batch updated' : 'Batch created', `"${course.trim()} · ${name.trim()}" saved.`); onClose(); },
        onError: (e: any) => Alert.alert('Could not save batch', e?.message ?? 'Try again'),
      }
    );
  };

  if (!value) return null;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={{ maxHeight: '92%', backgroundColor: '#12131A', borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: hexA(ACC, 0.18), paddingHorizontal: 18, paddingTop: 16, paddingBottom: kb > 0 ? kb + 14 : 26 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <View style={{ flex: 1 }}>
              <Serif style={{ fontSize: 19 }}>{isEdit ? 'Edit Batch' : 'Create Batch'}</Serif>
              <Body style={{ fontSize: 11, color: C.muted2 }}>Define course, teachers and schedule</Body>
            </View>
            <Pressable onPress={onClose} hitSlop={10} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="close" size={13} color={C.muted2} strokeWidth={2.3} />
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingBottom: 8 }}>
            <View style={{ flexDirection: 'row', gap: 9 }}>
              <View style={{ flex: 1, gap: 5 }}>
                <Mono style={{ fontSize: 9, letterSpacing: 1, color: C.mono2 }}>COURSE *</Mono>
                <TextInput value={course} onChangeText={setCourse} placeholder="e.g. CSPS" placeholderTextColor={C.muted3} style={inputStyle} />
              </View>
              <View style={{ flex: 1, gap: 5 }}>
                <Mono style={{ fontSize: 9, letterSpacing: 1, color: C.mono2 }}>BATCH NAME *</Mono>
                <TextInput value={name} onChangeText={setName} placeholder="e.g. July '26" placeholderTextColor={C.muted3} style={inputStyle} />
              </View>
            </View>

            <View style={{ gap: 6 }}>
              <Mono style={{ fontSize: 9, letterSpacing: 1, color: C.mono2 }}>TEACHERS * · TAP TO SELECT, TAP ★ FOR PRIMARY</Mono>
              {teachersQ.isPending ? <ActivityIndicator color={ACC} style={{ paddingVertical: 8 }} /> : (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
                  {(teachersQ.data ?? []).map((t) => {
                    const on = teacherIds.includes(t.id);
                    const prim = primaryId === t.id;
                    return (
                      <Pressable key={t.id} onPress={() => toggleTeacher(t.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 7, paddingHorizontal: 11, borderRadius: 999, backgroundColor: on ? hexA(prim ? ACC : C.gold, 0.14) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: on ? hexA(prim ? ACC : C.gold, 0.5) : 'rgba(255,255,255,0.1)' }}>
                        {on ? (
                          <Pressable onPress={() => setPrimaryId(t.id)} hitSlop={8}>
                            <Icon name="crown" size={11} color={prim ? ACC : 'rgba(255,255,255,0.35)'} strokeWidth={2.2} />
                          </Pressable>
                        ) : null}
                        <Text style={{ fontFamily: on ? F.bodyBold : F.bodySemi, fontSize: 11.5, color: on ? (prim ? ACC : C.gold) : C.muted }}>{t.name}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
              <Body style={{ fontSize: 9.5, color: C.muted3 }}>The primary teacher is the batch's main contact and calendar colour.</Body>
            </View>

            <View style={{ flexDirection: 'row', gap: 9 }}>
              <View style={{ flex: 1, gap: 5 }}>
                <Mono style={{ fontSize: 9, letterSpacing: 1, color: C.mono2 }}>START DATE</Mono>
                <TextInput value={startDate} onChangeText={setStartDate} placeholder="YYYY-MM-DD" placeholderTextColor={C.muted3} autoCorrect={false} style={[inputStyle, { fontFamily: F.mono }, !ymdOk(startDate) ? { borderColor: hexA(C.red, 0.5) } : null]} />
              </View>
              <View style={{ flex: 1, gap: 5 }}>
                <Mono style={{ fontSize: 9, letterSpacing: 1, color: C.mono2 }}>END DATE</Mono>
                <TextInput value={endDate} onChangeText={setEndDate} placeholder="YYYY-MM-DD" placeholderTextColor={C.muted3} autoCorrect={false} style={[inputStyle, { fontFamily: F.mono }, !ymdOk(endDate) ? { borderColor: hexA(C.red, 0.5) } : null]} />
              </View>
            </View>

            <View style={{ gap: 6 }}>
              <Mono style={{ fontSize: 9, letterSpacing: 1, color: C.mono2 }}>DAYS</Mono>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {WEEK.map((d) => {
                  const on = days.has(d);
                  return (
                    <Pressable key={d} onPress={() => setDays((prev) => { const n = new Set(prev); on ? n.delete(d) : n.add(d); return n; })} style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10, backgroundColor: on ? hexA(C.green, 0.14) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: on ? hexA(C.green, 0.5) : 'rgba(255,255,255,0.09)' }}>
                      <Text style={{ fontFamily: on ? F.bodyBold : F.bodySemi, fontSize: 10, color: on ? C.green : C.muted2 }}>{d}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={{ gap: 5 }}>
              <Mono style={{ fontSize: 9, letterSpacing: 1, color: C.mono2 }}>TIME (E.G. 10:00-12:00)</Mono>
              <TextInput value={time} onChangeText={setTime} placeholder="10:00-12:00" placeholderTextColor={C.muted3} autoCorrect={false} style={inputStyle} />
            </View>

            <View style={{ gap: 6 }}>
              <Mono style={{ fontSize: 9, letterSpacing: 1, color: C.mono2 }}>STATUS</Mono>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {BATCH_STATUSES.map((s) => {
                  const on = status === s;
                  const col = s === 'active' ? C.green : s === 'completed' ? C.blue : C.red;
                  return (
                    <Pressable key={s} onPress={() => setStatus(s)} style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 11, backgroundColor: on ? hexA(col, 0.14) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: on ? hexA(col, 0.45) : 'rgba(255,255,255,0.09)' }}>
                      <Text style={{ fontFamily: on ? F.bodyBold : F.bodySemi, fontSize: 11.5, color: on ? col : C.muted, textTransform: 'capitalize' }}>{s}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <Pressable onPress={save} disabled={!canSave} style={{ borderRadius: 13, overflow: 'hidden', opacity: canSave ? 1 : 0.5, marginTop: 4 }}>
              <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ alignItems: 'center', paddingVertical: 14 }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: '#fff' }}>{saveM.isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Create Batch'}</Text>
              </LinearGradient>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function BatchRoster({ batchId }: { batchId: string }) {
  const q = useBatchStudents(batchId);
  if (q.isPending) return <ActivityIndicator color={ACC} style={{ paddingVertical: 24 }} />;
  const rows = q.data ?? [];
  if (!rows.length) return <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 20 }}>No active students enrolled.</Body>;
  return (
    <ScrollView showsVerticalScrollIndicator={false} nestedScrollEnabled>
      {rows.map((s, i) => (
        <View key={s.studentId} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: 'rgba(255,255,255,0.05)' }}>
          <Avatar initial={initials(s.name)} size={32} colors={avColors(s.name)} fontSize={11} />
          <Body style={{ flex: 1, fontSize: 13.5, color: '#fff' }}>{s.name}</Body>
          {s.rollNo ? <Mono style={{ fontSize: 9.5, color: C.muted3 }}>{s.rollNo}</Mono> : null}
        </View>
      ))}
    </ScrollView>
  );
}

/* ---------------- Attendance ---------------- */
function AttendanceTab({ presetBatchId }: { presetBatchId: string | null }) {
  const [sub, setSub] = React.useState<'mark' | 'approvals' | 'report'>('mark');
  const { session } = useAuth();
  const adminId = session?.user?.id ?? '';
  return (
    <View style={{ gap: 12 }}>
      <PendingAttendanceBanner onPress={() => setSub('approvals')} />
      <View style={{ flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 999, padding: 3 }}>
        {([['mark', 'Mark'], ['approvals', 'Approvals'], ['report', 'Reports']] as const).map(([id, lab]) => {
          const active = sub === id;
          return active ? (
            <LinearGradient key={id} colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 999 }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: '#fff' }}>{lab}</Text>
            </LinearGradient>
          ) : (
            <Pressable key={id} onPress={() => setSub(id)} style={{ flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 999 }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: C.muted }}>{lab}</Text>
            </Pressable>
          );
        })}
      </View>
      {sub === 'mark' ? <MarkAttendance presetBatchId={presetBatchId} />
        : sub === 'approvals' ? <AttendanceApprovalPanel adminId={adminId} />
        : <AttendanceReports presetBatchId={presetBatchId} />}
    </View>
  );
}

function BatchPicker({ value, onChange, label = 'BATCH' }: { value: string | null; onChange: (id: string) => void; label?: string }) {
  const q = useAcademyBatches();
  const rows = q.data ?? [];
  React.useEffect(() => { if (!value && rows.length) onChange(rows[0].id); }, [rows.length]);
  return (
    <View style={{ gap: 6 }}>
      <Mono style={{ fontSize: 9, letterSpacing: 1, color: C.mono2 }}>{label}</Mono>
      <HScroll gap={7}>
        {rows.map((b) => {
          const on = value === b.id;
          return (
            <Pressable key={b.id} onPress={() => onChange(b.id)} style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: on ? hexA(ACC, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: on ? hexA(ACC, 0.5) : 'rgba(255,255,255,0.09)' }}>
              <Text style={{ fontFamily: on ? F.bodyBold : F.bodySemi, fontSize: 11.5, color: on ? ACC : C.muted }} numberOfLines={1}>{b.course_name} · {b.batch_name}</Text>
            </Pressable>
          );
        })}
      </HScroll>
    </View>
  );
}

function MarkAttendance({ presetBatchId }: { presetBatchId: string | null }) {
  const { session } = useAuth();
  const meId = session?.user?.id ?? null;
  const [batchId, setBatchId] = React.useState<string | null>(presetBatchId);
  React.useEffect(() => { if (presetBatchId) setBatchId(presetBatchId); }, [presetBatchId]);
  const [date, setDate] = React.useState(istToday());
  const studentsQ = useBatchStudents(batchId);
  const existingQ = useAttendanceByBatchDate(batchId, date);
  const saveM = useUpsertAttendance();
  const [marks, setMarks] = React.useState<Record<string, AttStatus>>({});
  const [dirty, setDirty] = React.useState(false);

  // Prefill from whatever is already saved for this batch+date.
  React.useEffect(() => {
    if (!existingQ.data) return;
    const seed: Record<string, AttStatus> = {};
    Object.values(existingQ.data).forEach((r) => { seed[r.studentId] = r.status; });
    setMarks(seed);
    setDirty(false);
  }, [existingQ.data, batchId, date]);

  const students = studentsQ.data ?? [];
  const markedCount = students.filter((s) => marks[s.studentId]).length;
  const livePct = attPct(students.filter((s) => marks[s.studentId]).map((s) => ({ status: marks[s.studentId] })));

  const setAll = (st: AttStatus) => { const m: Record<string, AttStatus> = {}; students.forEach((s) => { m[s.studentId] = st; }); setMarks(m); setDirty(true); };
  const save = () => {
    if (!batchId) return;
    const rows = students.filter((s) => marks[s.studentId]).map((s) => ({ studentId: s.studentId, status: marks[s.studentId] }));
    if (!rows.length) { Alert.alert('Nothing to save', 'Mark at least one student first.'); return; }
    saveM.mutate({ batchId, date, markedBy: meId, rows }, {
      onSuccess: () => { setDirty(false); Alert.alert('Attendance saved', `${rows.length} student${rows.length === 1 ? '' : 's'} recorded for ${prettyDate(date)}.`); },
      onError: (e: any) => Alert.alert('Could not save', e?.message ?? 'Try again'),
    });
  };
  const shiftDate = (n: number) => {
    const [y, m, d] = date.split('-').map(Number);
    const nd = new Date(Date.UTC(y, m - 1, d + n));
    setDate(nd.toISOString().slice(0, 10));
  };

  return (
    <View style={{ gap: 12 }}>
      <BatchPicker value={batchId} onChange={setBatchId} />

      {/* Date stepper */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }}>
        <Pressable onPress={() => shiftDate(-1)} hitSlop={8} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="chevLeft" size={13} color={C.ink3} strokeWidth={2.3} />
        </Pressable>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: '#fff' }}>{prettyDate(date)}</Text>
          {date !== istToday() ? (
            <Pressable onPress={() => setDate(istToday())} hitSlop={6}><Mono style={{ fontSize: 8.5, color: ACC }}>JUMP TO TODAY</Mono></Pressable>
          ) : <Mono style={{ fontSize: 8.5, color: C.muted3 }}>TODAY</Mono>}
        </View>
        <Pressable onPress={() => shiftDate(1)} disabled={date >= istToday()} hitSlop={8} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center', opacity: date >= istToday() ? 0.3 : 1 }}>
          <Icon name="chevRight" size={13} color={C.ink3} strokeWidth={2.3} />
        </Pressable>
      </View>

      {studentsQ.isPending || existingQ.isPending ? (
        <ActivityIndicator color={ACC} style={{ paddingVertical: 26 }} />
      ) : students.length === 0 ? (
        <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 26 }}>No active students enrolled in this batch.</Body>
      ) : (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Pressable onPress={() => setAll('present')} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: hexA(C.green, 0.12), borderWidth: 1, borderColor: hexA(C.green, 0.4) }}>
              <Icon name="checks" size={12} color={C.green} strokeWidth={2.4} />
              <Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: C.green }}>All present</Text>
            </Pressable>
            <View style={{ flex: 1, alignItems: 'flex-end' }}>
              <Mono style={{ fontSize: 9, color: C.muted3 }}>{markedCount}/{students.length} MARKED{markedCount ? ` · ${livePct}%` : ''}</Mono>
            </View>
          </View>

          {students.map((s) => {
            const cur = marks[s.studentId];
            return (
              <View key={s.studentId} style={{ padding: 12, borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: cur ? hexA(attColor(cur), 0.28) : 'rgba(255,255,255,0.07)', gap: 9 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Avatar initial={initials(s.name)} size={32} colors={avColors(s.name)} fontSize={11} />
                  <View style={{ flex: 1 }}>
                    <Body numberOfLines={1} style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{s.name}</Body>
                    {s.rollNo ? <Mono style={{ fontSize: 8.5, color: C.muted3 }}>ROLL {s.rollNo}</Mono> : null}
                  </View>
                </View>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  {ATT_STATUSES.map((st) => {
                    const on = cur === st;
                    const col = attColor(st);
                    return (
                      <Pressable key={st} onPress={() => { setMarks((m) => ({ ...m, [s.studentId]: st })); setDirty(true); }} style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10, backgroundColor: on ? hexA(col, 0.18) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: on ? hexA(col, 0.5) : 'rgba(255,255,255,0.08)' }}>
                        <Text style={{ fontFamily: on ? F.bodyBold : F.bodySemi, fontSize: 10.5, color: on ? col : C.muted2, textTransform: 'capitalize' }}>{st}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            );
          })}

          <Pressable onPress={save} disabled={saveM.isPending || !markedCount} style={{ borderRadius: 14, overflow: 'hidden', opacity: saveM.isPending || !markedCount ? 0.5 : 1 }}>
            <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 15 }}>
              <Icon name="checks" size={15} color="#fff" strokeWidth={2.6} />
              <Text style={{ fontFamily: F.bodyBold, fontSize: 14.5, color: '#fff' }}>
                {saveM.isPending ? 'Saving…' : dirty ? `Save attendance (${markedCount})` : 'Saved'}
              </Text>
            </LinearGradient>
          </Pressable>
        </>
      )}
    </View>
  );
}

function AttendanceReports({ presetBatchId }: { presetBatchId: string | null }) {
  const [batchId, setBatchId] = React.useState<string | null>(presetBatchId);
  const [days, setDays] = React.useState(30);
  const from = istDaysAgo(days - 1), to = istToday();
  const q = useAttendanceReport(batchId, from, to);
  const studentsQ = useBatchStudents(batchId);
  const [view, setView] = React.useState<'student' | 'date'>('student');

  const nameById = React.useMemo(() => new Map((studentsQ.data ?? []).map((s) => [s.studentId, s.name])), [studentsQ.data]);
  const rows = q.data ?? [];

  const byStudent = React.useMemo(() => {
    const m = new Map<string, { status: string }[]>();
    rows.forEach((r) => { if (!m.has(r.student_id)) m.set(r.student_id, []); m.get(r.student_id)!.push({ status: r.status }); });
    return [...m.entries()]
      .map(([id, list]) => ({ id, name: nameById.get(id) ?? 'Student', total: list.length, pct: attPct(list) }))
      .sort((a, b) => a.pct - b.pct);
  }, [rows, nameById]);

  const byDate = React.useMemo(() => {
    const m = new Map<string, { status: string }[]>();
    rows.forEach((r) => { if (!m.has(r.date)) m.set(r.date, []); m.get(r.date)!.push({ status: r.status }); });
    return [...m.entries()].map(([date, list]) => ({ date, total: list.length, pct: attPct(list) })).sort((a, b) => b.date.localeCompare(a.date));
  }, [rows]);

  return (
    <View style={{ gap: 12 }}>
      <BatchPicker value={batchId} onChange={setBatchId} />
      <View style={{ flexDirection: 'row', gap: 7 }}>
        {[7, 30, 90].map((n) => {
          const on = days === n;
          return (
            <Pressable key={n} onPress={() => setDays(n)} style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 11, backgroundColor: on ? hexA(ACC, 0.14) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: on ? hexA(ACC, 0.45) : 'rgba(255,255,255,0.09)' }}>
              <Text style={{ fontFamily: on ? F.bodyBold : F.bodySemi, fontSize: 11.5, color: on ? ACC : C.muted }}>{n} days</Text>
            </Pressable>
          );
        })}
        {(['student', 'date'] as const).map((v) => {
          const on = view === v;
          return (
            <Pressable key={v} onPress={() => setView(v)} style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 11, backgroundColor: on ? hexA(C.purple, 0.14) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: on ? hexA(C.purple, 0.45) : 'rgba(255,255,255,0.09)' }}>
              <Text style={{ fontFamily: on ? F.bodyBold : F.bodySemi, fontSize: 11.5, color: on ? C.purple : C.muted }}>By {v}</Text>
            </Pressable>
          );
        })}
      </View>

      {q.isPending ? <ActivityIndicator color={ACC} style={{ paddingVertical: 26 }} />
        : rows.length === 0 ? <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 26 }}>No attendance recorded in this range.</Body>
        : view === 'student' ? (
          <View style={{ gap: 8 }}>
            {byStudent.map((s) => {
              const low = s.pct < LOW_ATTENDANCE_PCT;
              return (
                <View key={s.id} style={{ padding: 12, borderRadius: 14, backgroundColor: low ? hexA(C.red, 0.06) : 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: low ? hexA(C.red, 0.28) : 'rgba(255,255,255,0.07)', gap: 7 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                    <Body numberOfLines={1} style={{ flex: 1, fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{s.name}</Body>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: low ? C.red : C.green }}>{s.pct}%</Text>
                  </View>
                  <ProgressBar pct={s.pct} height={5} fill={low ? C.red : C.green} />
                  <Mono style={{ fontSize: 8.5, color: C.muted3 }}>{s.total} SESSION{s.total === 1 ? '' : 'S'}{low ? ' · BELOW 75%' : ''}</Mono>
                </View>
              );
            })}
          </View>
        ) : (
          <View style={{ gap: 7 }}>
            {byDate.map((r) => {
              const low = r.pct < LOW_ATTENDANCE_PCT;
              return (
                <View key={r.date} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 11, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }}>
                  <Body style={{ flex: 1, fontSize: 12.5, color: C.ink }}>{prettyDate(r.date)}</Body>
                  <Mono style={{ fontSize: 9, color: C.muted3 }}>{r.total}</Mono>
                  <Text style={{ width: 44, textAlign: 'right', fontFamily: F.bodyBold, fontSize: 13, color: low ? C.red : C.green }}>{r.pct}%</Text>
                </View>
              );
            })}
          </View>
        )}
    </View>
  );
}

/* ---------------- Assessments ---------------- */
function AssessmentsTab() {
  const [batchId, setBatchId] = React.useState<string | null>(null);
  const [days, setDays] = React.useState(90);
  const from = istDaysAgo(days - 1), to = istToday();
  const q = useAssessments(batchId, from, to);
  const studentsQ = useBatchStudents(batchId);
  const [entryOpen, setEntryOpen] = React.useState(false);
  const [threshold, setThreshold] = React.useState(40); // UI-only pass line (web parity)

  const nameById = React.useMemo(() => new Map((studentsQ.data ?? []).map((s) => [s.studentId, s.name])), [studentsQ.data]);
  const rows = q.data ?? [];

  // Grouped by (date|title) — one row per assessment sitting.
  const groups = React.useMemo(() => {
    const m = new Map<string, typeof rows>();
    rows.forEach((r) => { const k = `${r.date}|${r.title}`; if (!m.has(k)) m.set(k, []); m.get(k)!.push(r); });
    return [...m.entries()].map(([k, list]) => {
      const [date, title] = k.split('|');
      const scored = list.filter((r) => !r.is_absent && r.marks_obtained != null);
      const pcts = scored.map((r) => (r.marks_obtained! / (r.max_marks || 1)) * 100);
      return {
        key: k, date, title, max: list[0]?.max_marks ?? 0, pass: list[0]?.pass_marks ?? null,
        taken: scored.length, absent: list.filter((r) => r.is_absent).length, rows: list,
        avg: pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : null,
        high: pcts.length ? Math.round(Math.max(...pcts)) : null,
        low: pcts.length ? Math.round(Math.min(...pcts)) : null,
      };
    }).sort((a, b) => b.date.localeCompare(a.date));
  }, [rows]);

  const [openKey, setOpenKey] = React.useState<string | null>(null);

  return (
    <View style={{ gap: 12 }}>
      <BatchPicker value={batchId} onChange={setBatchId} />
      <View style={{ flexDirection: 'row', gap: 7 }}>
        {[30, 90, 365].map((n) => {
          const on = days === n;
          return (
            <Pressable key={n} onPress={() => setDays(n)} style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 11, backgroundColor: on ? hexA(ACC, 0.14) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: on ? hexA(ACC, 0.45) : 'rgba(255,255,255,0.09)' }}>
              <Text style={{ fontFamily: on ? F.bodyBold : F.bodySemi, fontSize: 11.5, color: on ? ACC : C.muted }}>{n === 365 ? '1 year' : `${n} days`}</Text>
            </Pressable>
          );
        })}
        <Pressable onPress={() => setEntryOpen(true)} disabled={!batchId} style={{ borderRadius: 11, overflow: 'hidden', opacity: batchId ? 1 : 0.4 }}>
          <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 9, paddingHorizontal: 13 }}>
            <Icon name="plus" size={12} color="#fff" strokeWidth={2.6} />
            <Text style={{ fontFamily: F.bodyBold, fontSize: 11.5, color: '#fff' }}>Marks</Text>
          </LinearGradient>
        </Pressable>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Mono style={{ fontSize: 9, color: C.mono2 }}>PASS LINE {threshold}%</Mono>
        <View style={{ flex: 1, flexDirection: 'row', gap: 5, justifyContent: 'flex-end' }}>
          {[33, 40, 50, 60].map((t) => (
            <Pressable key={t} onPress={() => setThreshold(t)} style={{ paddingVertical: 5, paddingHorizontal: 9, borderRadius: 999, backgroundColor: threshold === t ? hexA(C.gold, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: threshold === t ? hexA(C.gold, 0.45) : 'rgba(255,255,255,0.08)' }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 10, color: threshold === t ? C.gold : C.muted2 }}>{t}%</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {q.isPending ? <ActivityIndicator color={ACC} style={{ paddingVertical: 26 }} />
        : groups.length === 0 ? <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 26 }}>No assessments in this range.</Body>
        : groups.map((g) => {
          const open = openKey === g.key;
          return (
            <View key={g.key} style={{ borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: open ? hexA(ACC, 0.3) : 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
              <Pressable onPress={() => setOpenKey(open ? null : g.key)} style={{ padding: 13, gap: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                  <View style={{ flex: 1 }}>
                    <Body numberOfLines={1} style={{ fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }}>{g.title}</Body>
                    <Mono style={{ fontSize: 8.5, color: C.muted3, marginTop: 2 }}>{prettyDate(g.date)} · MAX {g.max}{g.pass != null ? ` · PASS ${g.pass}` : ''}</Mono>
                  </View>
                  <Icon name={open ? 'chevUp' : 'chevDown'} size={13} color={C.muted3} strokeWidth={2.3} />
                </View>
                <View style={{ flexDirection: 'row', gap: 7 }}>
                  {([['AVG', g.avg], ['HIGH', g.high], ['LOW', g.low]] as const).map(([lab, v]) => (
                    <View key={lab} style={{ flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.04)' }}>
                      <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: v == null ? C.muted3 : v < threshold ? C.red : C.green }}>{v == null ? '—' : `${v}%`}</Text>
                      <Mono style={{ fontSize: 6.5, letterSpacing: 0.6, color: C.muted3 }}>{lab}</Mono>
                    </View>
                  ))}
                  <View style={{ flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.04)' }}>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: C.ink }}>{g.taken}</Text>
                    <Mono style={{ fontSize: 6.5, letterSpacing: 0.6, color: C.muted3 }}>TAKEN</Mono>
                  </View>
                </View>
              </Pressable>
              {open ? (
                <View style={{ paddingHorizontal: 13, paddingBottom: 13, gap: 6 }}>
                  {g.rows
                    .slice()
                    .sort((a, b) => (b.marks_obtained ?? -1) - (a.marks_obtained ?? -1))
                    .map((r) => {
                      const pct = r.is_absent || r.marks_obtained == null ? null : Math.round((r.marks_obtained / (r.max_marks || 1)) * 100);
                      const fail = pct != null && pct < threshold;
                      return (
                        <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 7, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)' }}>
                          <Body numberOfLines={1} style={{ flex: 1, fontSize: 12.5, color: C.ink }}>{nameById.get(r.student_id) ?? 'Student'}</Body>
                          {r.is_absent ? <Badge text="Absent" color={C.muted2} /> : (
                            <>
                              <Mono style={{ fontSize: 10, color: C.muted2 }}>{r.marks_obtained ?? '—'}/{r.max_marks}</Mono>
                              <Text style={{ width: 40, textAlign: 'right', fontFamily: F.bodyBold, fontSize: 12.5, color: fail ? C.red : C.green }}>{pct == null ? '—' : `${pct}%`}</Text>
                            </>
                          )}
                        </View>
                      );
                    })}
                </View>
              ) : null}
            </View>
          );
        })}

      <EnterMarksSheet visible={entryOpen} batchId={batchId} onClose={() => setEntryOpen(false)} />
    </View>
  );
}

function EnterMarksSheet({ visible, batchId, onClose }: { visible: boolean; batchId: string | null; onClose: () => void }) {
  const { session } = useAuth();
  const meId = session?.user?.id ?? null;
  const studentsQ = useBatchStudents(batchId);
  const saveM = useUpsertAssessmentMarks();
  const [title, setTitle] = React.useState('');
  const [date, setDate] = React.useState(istToday());
  const [max, setMax] = React.useState('100');
  const [pass, setPass] = React.useState('40');
  const [marks, setMarks] = React.useState<Record<string, string>>({});
  const [absent, setAbsent] = React.useState<Record<string, boolean>>({});
  const [kb, setKb] = React.useState(0);
  React.useEffect(() => {
    const s = Keyboard.addListener('keyboardDidShow', (e) => setKb(e.endCoordinates.height));
    const h = Keyboard.addListener('keyboardDidHide', () => setKb(0));
    return () => { s.remove(); h.remove(); };
  }, []);
  React.useEffect(() => {
    if (!visible) return;
    setTitle(''); setDate(istToday()); setMax('100'); setPass('40'); setMarks({}); setAbsent({});
  }, [visible]);
  // Pass defaults to 40% of max while the trainer edits max (web default).
  const onMaxChange = (t: string) => {
    const v = t.replace(/[^0-9]/g, '');
    setMax(v);
    const n = parseInt(v, 10);
    if (isFinite(n) && n > 0) setPass(String(defaultPassMarks(n)));
  };

  const students = studentsQ.data ?? [];
  const maxN = parseInt(max, 10) || 0;
  const passN = parseInt(pass, 10) || 0;
  const filled = students.filter((s) => absent[s.studentId] || (marks[s.studentId] ?? '').trim()).length;
  const canSave = !!batchId && !!title.trim() && maxN > 0 && passN >= 0 && passN <= maxN && filled > 0 && !saveM.isPending;

  const save = () => {
    if (!batchId) return;
    const rows = students
      .filter((s) => absent[s.studentId] || (marks[s.studentId] ?? '').trim())
      .map((s) => ({
        studentId: s.studentId,
        marks: absent[s.studentId] ? null : parseInt(marks[s.studentId] ?? '', 10),
        isAbsent: !!absent[s.studentId],
      }));
    const bad = rows.find((r) => !r.isAbsent && (r.marks == null || !isFinite(r.marks) || r.marks < 0 || r.marks > maxN));
    if (bad) { Alert.alert('Check the marks', `Every mark must be a number between 0 and ${maxN}.`); return; }
    saveM.mutate({ batchId, date, title, maxMarks: maxN, passMarks: passN, createdBy: meId, rows }, {
      onSuccess: () => { Alert.alert('Marks saved', `${rows.length} student${rows.length === 1 ? '' : 's'} recorded for "${title.trim()}".`); onClose(); },
      onError: (e: any) => Alert.alert('Could not save', e?.message ?? 'Try again'),
    });
  };

  if (!visible) return null;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={{ maxHeight: '92%', backgroundColor: '#12131A', borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: hexA(ACC, 0.18), paddingHorizontal: 18, paddingTop: 16, paddingBottom: kb > 0 ? kb + 12 : 24 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <Serif style={{ flex: 1, fontSize: 19 }}>Enter marks</Serif>
            <Pressable onPress={onClose} hitSlop={10} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="close" size={13} color={C.muted2} strokeWidth={2.3} />
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 11, paddingBottom: 10 }}>
            <View style={{ gap: 5 }}>
              <Mono style={{ fontSize: 9, letterSpacing: 1, color: C.mono2 }}>ASSESSMENT TITLE *</Mono>
              <TextInput value={title} onChangeText={setTitle} placeholder="e.g. Unit Test 1" placeholderTextColor={C.muted3} style={inputStyle} />
            </View>
            <View style={{ flexDirection: 'row', gap: 9 }}>
              <View style={{ flex: 1, gap: 5 }}>
                <Mono style={{ fontSize: 9, letterSpacing: 1, color: C.mono2 }}>MAX MARKS *</Mono>
                <TextInput value={max} onChangeText={onMaxChange} keyboardType="number-pad" style={[inputStyle, { fontFamily: F.mono }]} />
              </View>
              <View style={{ flex: 1, gap: 5 }}>
                <Mono style={{ fontSize: 9, letterSpacing: 1, color: C.mono2 }}>PASS MARKS</Mono>
                <TextInput value={pass} onChangeText={(t) => setPass(t.replace(/[^0-9]/g, ''))} keyboardType="number-pad" style={[inputStyle, { fontFamily: F.mono }]} />
              </View>
            </View>
            <Mono style={{ fontSize: 8.5, color: C.muted3, marginTop: -4 }}>DATE · {prettyDate(date)}</Mono>

            {students.length === 0 ? (
              <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 18 }}>No active students in this batch.</Body>
            ) : students.map((s) => {
              const isAbsent = !!absent[s.studentId];
              return (
                <View key={s.studentId} style={{ flexDirection: 'row', alignItems: 'center', gap: 9, padding: 10, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }}>
                  <Body numberOfLines={1} style={{ flex: 1, fontSize: 13, color: '#fff' }}>{s.name}</Body>
                  <TextInput
                    value={isAbsent ? '' : (marks[s.studentId] ?? '')}
                    onChangeText={(t) => setMarks((m) => ({ ...m, [s.studentId]: t.replace(/[^0-9]/g, '') }))}
                    editable={!isAbsent}
                    keyboardType="number-pad" placeholder={isAbsent ? '—' : `0-${maxN}`} placeholderTextColor={C.muted3}
                    style={{ width: 64, textAlign: 'center', paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: isAbsent ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.05)', color: '#fff', fontFamily: F.mono, fontSize: 13 }}
                  />
                  <Pressable onPress={() => setAbsent((a) => ({ ...a, [s.studentId]: !a[s.studentId] }))} style={{ paddingVertical: 7, paddingHorizontal: 10, borderRadius: 10, backgroundColor: isAbsent ? hexA(C.red, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: isAbsent ? hexA(C.red, 0.45) : 'rgba(255,255,255,0.08)' }}>
                    <Text style={{ fontFamily: F.bodySemi, fontSize: 10, color: isAbsent ? C.red : C.muted2 }}>Absent</Text>
                  </Pressable>
                </View>
              );
            })}

            <Pressable onPress={save} disabled={!canSave} style={{ borderRadius: 13, overflow: 'hidden', opacity: canSave ? 1 : 0.5, marginTop: 4 }}>
              <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ alignItems: 'center', paddingVertical: 14 }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: '#fff' }}>{saveM.isPending ? 'Saving…' : `Save marks (${filled})`}</Text>
              </LinearGradient>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
