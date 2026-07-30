import React from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator, Alert, Keyboard } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C, F, hexA, ORANGE_GRAD } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono, Card } from '../components/primitives';
import { Page, TitleBlock, HScroll, Badge, AnimChip, MiniAvatar } from './common';
import { SheetShell } from './reportDetail';
import { useAuth } from '../auth';
import { istToday, prettyDate, useBatchStudents, AttStatus } from '../lib/academyQueries';
import { parseTimeRange } from './academyCalendar';
import {
  useMyAcademyLink, useTeacherBatches, useWeekAttendance, useBatchDateMarks, useSubmitTeacherAttendance,
  TeacherBatch, BatchDateMark,
} from '../lib/academyAttendanceQueries';

/* ============================================================================
   Academy Teacher — the teacher-facing workspace (academy_users.role 'teacher'
   linked via profile_id). Mirror of the web teacher page, phone-first: a
   Monday-first week strip, the day's classes sorted by start time, and a
   one-tap "everyone present" attendance sheet. Teacher marks ALWAYS go in as
   approval_status 'pending'; rows the office already approved are locked.
   ========================================================================== */

const ACC = '#6EA8FE'; // academy accent (matches the academy-admin workspace)

/* ---------- timezone-safe YYYY-MM-DD math (local-midnight construction) ---------- */
const DAY_KEYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const pad2 = (n: number) => String(n).padStart(2, '0');
const addDays = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T00:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};
const dayKeyOf = (ymd: string) => DAY_KEYS[(new Date(`${ymd}T00:00:00`).getDay() + 6) % 7];
const mondayOf = (ymd: string) => addDays(ymd, -((new Date(`${ymd}T00:00:00`).getDay() + 6) % 7));
const shortDate = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y) return ymd;
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1)).toLocaleDateString('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short' });
};
const fmtMin = (n: number) => {
  const h24 = Math.floor(n / 60) % 24, mm = n % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(mm).padStart(2, '0')} ${h24 >= 12 ? 'PM' : 'AM'}`;
};

/* Live "minutes since IST midnight", refreshed every 30s so the Log button
   unlocks by itself when a class starts while the screen is open. */
const istNowMinutes = () => {
  const d = new Date(Date.now() + 330 * 60_000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};
function useIstNowMinutes(): number {
  const [m, setM] = React.useState(istNowMinutes);
  React.useEffect(() => {
    const id = setInterval(() => setM(istNowMinutes()), 30_000);
    return () => clearInterval(id);
  }, []);
  return m;
}

const initials = (n: string) => n.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';
const avColors = (n: string): [string, string] => {
  const sets: [string, string][] = [['#7C8FE8', '#9A7BEA'], ['#E8A87C', '#EA7B9A'], ['#7CE8C1', '#4FB6E8'], ['#E8D07C', '#E8A87C']];
  let h = 0; for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
  return sets[h % sets.length];
};
const attColor = (s: string) => (s === 'present' ? C.green : s === 'late' ? C.gold : s === 'leave' ? C.blue : C.red);

/* A batch occurs on a date when its schedule lists that weekday, the date is
   inside [start_date, end_date] when set, and the batch is active. */
const occursOn = (b: TeacherBatch, date: string) =>
  b.status === 'active' &&
  (b.schedule?.days ?? []).includes(dayKeyOf(date)) &&
  (!b.start_date || date >= b.start_date) &&
  (!b.end_date || date <= b.end_date);

type DayStatus = { label: string; color: string };
const dayStatusOf = (cell: { total: number; pending: number; approved: number; rejected: number } | undefined): DayStatus => {
  if (!cell || cell.total === 0) return { label: 'Not marked', color: C.muted2 };
  if (cell.approved === cell.total) return { label: 'Approved', color: C.green };
  if (cell.pending > 0) return { label: 'Pending', color: C.gold };
  if (cell.rejected > 0) return { label: 'Rejected', color: C.red };
  return { label: 'Not marked', color: C.muted2 };
};

export function AcademyTeacher() {
  const { session } = useAuth();
  const profileId = session?.user?.id ?? null;
  const linkQ = useMyAcademyLink(profileId);
  const teacherId = linkQ.data?.teacherId ?? null;

  const today = istToday();
  const [weekStart, setWeekStart] = React.useState(() => mondayOf(istToday()));
  const [selDate, setSelDate] = React.useState(istToday);
  const nowMin = useIstNowMinutes();

  const batchesQ = useTeacherBatches(teacherId);
  const batches = batchesQ.data ?? [];
  const weekFrom = weekStart;
  const weekTo = addDays(weekStart, 6);
  const batchIds = React.useMemo(() => batches.map((b) => b.id), [batches]);
  const weekQ = useWeekAttendance(batchIds, weekFrom, weekTo);

  const weekDates = React.useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const classCountByDate = React.useMemo(() => {
    const m: Record<string, number> = {};
    weekDates.forEach((d) => { m[d] = batches.filter((b) => occursOn(b, d)).length; });
    return m;
  }, [weekDates, batches]);

  const dayClasses = React.useMemo(
    () =>
      batches
        .filter((b) => occursOn(b, selDate))
        .slice()
        .sort((a, b) => (parseTimeRange(a.schedule?.time)?.start ?? 9999) - (parseTimeRange(b.schedule?.time)?.start ?? 9999)),
    [batches, selDate]
  );

  const [sheet, setSheet] = React.useState<{ batch: TeacherBatch; date: string } | null>(null);
  const closeSheet = () => { Keyboard.dismiss(); setSheet(null); };

  const shiftWeek = (n: number) => { setWeekStart((w) => addDays(w, n * 7)); setSelDate((d) => addDays(d, n * 7)); };
  const isThisWeek = weekStart === mondayOf(today);
  const resetWeek = () => { setWeekStart(mondayOf(today)); setSelDate(today); };

  /* ----- not-linked / loading gates ----- */
  if (linkQ.isPending) {
    return (
      <Page gap={14} pt={6}>
        <TitleBlock title="Odds Academy" sub="Your teaching week and attendance" />
        <ActivityIndicator color={ACC} style={{ paddingVertical: 40 }} />
      </Page>
    );
  }
  if (!teacherId) {
    return (
      <Page gap={14} pt={6}>
        <TitleBlock title="Odds Academy" sub="Your teaching week and attendance" />
        <View style={{ alignItems: 'center', gap: 12, paddingVertical: 52, paddingHorizontal: 20 }}>
          <View style={{ width: 54, height: 54, borderRadius: 17, backgroundColor: hexA(ACC, 0.1), borderWidth: 1, borderColor: hexA(ACC, 0.3), alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="userCircle" size={26} color={ACC} strokeWidth={1.9} />
          </View>
          <Serif style={{ fontSize: 19, textAlign: 'center' }}>Not linked as an academy teacher</Serif>
          <Body style={{ fontSize: 12.5, color: C.muted2, textAlign: 'center', lineHeight: 18 }}>
            Your login is not connected to a teacher profile yet. Ask the academy office to link your account, then pull to refresh.
          </Body>
        </View>
      </Page>
    );
  }

  return (
    <Page gap={14} pt={6} scrollKey="academy-teacher">
      <TitleBlock title="Odds Academy" sub="Your teaching week and attendance" />

      {/* Week navigation */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 13, gap: 8, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }}>
        <Pressable onPress={() => shiftWeek(-1)} hitSlop={8} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="chevLeft" size={14} color={C.ink3} strokeWidth={2.3} />
        </Pressable>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: '#fff' }}>{shortDate(weekFrom)} - {shortDate(weekTo)}</Text>
          <Mono style={{ fontSize: 8, letterSpacing: 0.8, color: C.muted3, marginTop: 2 }}>{isThisWeek ? 'THIS WEEK' : 'IST WEEK'}</Mono>
        </View>
        <Pressable onPress={resetWeek} disabled={isThisWeek} style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, backgroundColor: hexA(ACC, isThisWeek ? 0.05 : 0.12), borderWidth: 1, borderColor: hexA(ACC, isThisWeek ? 0.16 : 0.4), opacity: isThisWeek ? 0.55 : 1 }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 10.5, color: ACC }}>This week</Text>
        </Pressable>
        <Pressable onPress={() => shiftWeek(1)} hitSlop={8} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="chevRight" size={14} color={C.ink3} strokeWidth={2.3} />
        </Pressable>
      </View>

      {/* Day strip (Monday-first) */}
      <HScroll gap={7}>
        {weekDates.map((date, i) => {
          const active = date === selDate;
          const isToday = date === today;
          const hasClasses = (classCountByDate[date] ?? 0) > 0;
          return (
            <AnimChip
              key={date}
              active={active}
              onPress={() => setSelDate(date)}
              style={{ alignItems: 'center', gap: 2, paddingVertical: 9, paddingHorizontal: 14, borderRadius: 13, backgroundColor: active ? hexA(ACC, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(ACC, 0.5) : isToday ? hexA(ACC, 0.35) : 'rgba(255,255,255,0.09)' }}
            >
              <Mono style={{ fontSize: 8, letterSpacing: 0.8, color: active ? ACC : C.muted3 }}>{DAY_KEYS[i].toUpperCase()}</Mono>
              <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 14.5, color: active ? ACC : isToday ? C.ink2 : C.muted }}>{Number(date.slice(8))}</Text>
              <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: hasClasses ? (active ? ACC : hexA(ACC, 0.55)) : 'transparent' }} />
            </AnimChip>
          );
        })}
      </HScroll>

      {/* Selected day's classes */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name="calendar" size={13} color={ACC} strokeWidth={2.1} />
        <Mono style={{ flex: 1, fontSize: 9, letterSpacing: 1, color: C.mono2 }}>CLASSES · {prettyDate(selDate).toUpperCase()}</Mono>
        <Mono style={{ fontSize: 9, color: C.muted3 }}>{dayClasses.length} CLASS{dayClasses.length === 1 ? '' : 'ES'}</Mono>
      </View>

      {batchesQ.isPending ? (
        <ActivityIndicator color={ACC} style={{ paddingVertical: 26 }} />
      ) : batches.length === 0 ? (
        <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 26 }}>No batches are assigned to you yet.</Body>
      ) : dayClasses.length === 0 ? (
        <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 26 }}>No classes on {prettyDate(selDate)}.</Body>
      ) : (
        dayClasses.map((b) => {
          const range = parseTimeRange(b.schedule?.time);
          const st = dayStatusOf(weekQ.data?.[`${b.id}__${selDate}`]);
          const isPast = selDate < today;
          const isFuture = selDate > today;
          const started = isPast || (!isFuture && (!range || nowMin >= range.start));
          const hint = isFuture
            ? `Starts ${prettyDate(selDate)}`
            : range ? `Starts at ${fmtMin(range.start)}` : 'Not started yet';
          return (
            <Card key={b.id} colors={['rgba(30,38,58,0.5)', 'rgba(16,16,20,0.55)']} border={hexA(ACC, 0.16)} radius={17} style={{ padding: 14, gap: 11 }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 9 }}>
                <View style={{ flex: 1 }}>
                  <Body numberOfLines={1} style={{ fontSize: 15, fontFamily: F.bodySemi, color: '#fff' }}>{b.course_name} · {b.batch_name}</Body>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 }}>
                    <Icon name="clock" size={11} color={C.muted3} strokeWidth={2} />
                    <Text style={{ fontFamily: F.bodySemi, fontSize: 10.5, color: C.ink3 }}>{b.schedule?.time ? `${b.schedule.time} IST` : 'Time not set'}</Text>
                  </View>
                </View>
                <Badge text={st.label} color={st.color} />
              </View>

              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                {b.teachers.map((t) => (
                  <View key={t.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4, paddingHorizontal: 9, borderRadius: 999, backgroundColor: hexA(t.isPrimary ? ACC : C.muted2, 0.1), borderWidth: 1, borderColor: hexA(t.isPrimary ? ACC : C.muted2, 0.3) }}>
                    {t.isPrimary ? <Icon name="crown" size={9} color={ACC} strokeWidth={2.2} /> : null}
                    <Text style={{ fontFamily: F.bodySemi, fontSize: 10.5, color: t.isPrimary ? ACC : C.muted }}>{t.name}</Text>
                  </View>
                ))}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingLeft: 2 }}>
                  <Icon name="users" size={11} color={C.muted3} strokeWidth={2} />
                  <Text style={{ fontFamily: F.bodySemi, fontSize: 10.5, color: C.ink3 }}>{b.studentCount} student{b.studentCount === 1 ? '' : 's'}</Text>
                </View>
              </View>

              {started ? (
                <Pressable onPress={() => setSheet({ batch: b, date: selDate })} style={{ borderRadius: 12, overflow: 'hidden' }}>
                  <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 11 }}>
                    <Icon name="checks" size={14} color="#fff" strokeWidth={2.4} />
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: '#fff' }}>Log Attendance</Text>
                  </LinearGradient>
                </Pressable>
              ) : (
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 11, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
                  <Icon name="clock" size={13} color={C.muted3} strokeWidth={2.1} />
                  <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: C.muted }}>{hint}</Text>
                </View>
              )}
            </Card>
          );
        })
      )}

      <LogAttendanceSheet open={sheet} onClose={closeSheet} />
    </Page>
  );
}

/* ---------------- Log Attendance sheet ---------------- */
const CHOICES: { key: AttStatus; label: string; color: string }[] = [
  { key: 'present', label: 'Present', color: C.green },
  { key: 'absent', label: 'Absent', color: C.red },
  { key: 'late', label: 'Late', color: C.gold },
];

function LogAttendanceSheet({ open, onClose }: { open: { batch: TeacherBatch; date: string } | null; onClose: () => void }) {
  const studentsQ = useBatchStudents(open?.batch.id ?? null);
  const marksQ = useBatchDateMarks(open?.batch.id ?? null, open?.date ?? null);
  const submitM = useSubmitTeacherAttendance();

  const [statuses, setStatuses] = React.useState<Record<string, AttStatus>>({});
  const [remarks, setRemarks] = React.useState<Record<string, string>>({});
  const [remarkOpen, setRemarkOpen] = React.useState<Record<string, boolean>>({});

  const students = studentsQ.data ?? [];
  const existing: Record<string, BatchDateMark> = marksQ.data ?? {};

  // Prefill from existing marks; unmarked students default to present (one-tap flow).
  React.useEffect(() => {
    if (!open) return;
    const st: Record<string, AttStatus> = {};
    const rm: Record<string, string> = {};
    const ro: Record<string, boolean> = {};
    (studentsQ.data ?? []).forEach((s) => {
      const ex = marksQ.data?.[s.studentId];
      st[s.studentId] = (ex?.status as AttStatus) ?? 'present';
      rm[s.studentId] = ex?.remarks ?? '';
      ro[s.studentId] = !!ex?.remarks;
    });
    setStatuses(st); setRemarks(rm); setRemarkOpen(ro);
  }, [open?.batch.id, open?.date, studentsQ.data, marksQ.data]);

  const lockedIds = students.filter((s) => existing[s.studentId]?.approval === 'approved').map((s) => s.studentId);
  const unlocked = students.filter((s) => existing[s.studentId]?.approval !== 'approved');
  const allApproved = students.length > 0 && lockedIds.length === students.length;

  const counts = unlocked.reduce(
    (acc, s) => { const st = statuses[s.studentId] ?? 'present'; acc[st] = (acc[st] ?? 0) + 1; return acc; },
    {} as Record<string, number>
  );

  const submit = () => {
    if (!open || unlocked.length === 0) return;
    const marks = unlocked.map((s) => ({
      studentId: s.studentId,
      status: statuses[s.studentId] ?? 'present',
      remarks: (remarks[s.studentId] ?? '').trim() || null,
    }));
    submitM.mutate(
      { batchId: open.batch.id, date: open.date, sessionTime: open.batch.schedule?.time ?? null, marks, existing },
      {
        onSuccess: () => {
          Keyboard.dismiss();
          onClose();
          Alert.alert('Submitted for approval', `${marks.length} student${marks.length === 1 ? '' : 's'} recorded for ${prettyDate(open.date)}. The academy office will review it.`);
        },
        onError: (e: any) => Alert.alert('Could not submit', e?.message ?? 'Try again'),
      }
    );
  };

  return (
    <SheetShell
      visible={!!open}
      onClose={onClose}
      accent={ACC}
      icon="checks"
      title={open ? `${open.batch.course_name} · ${open.batch.batch_name}` : 'Attendance'}
      subtitle={open ? [prettyDate(open.date), open.batch.schedule?.time ? `${open.batch.schedule.time} IST` : null].filter(Boolean).join('  ·  ').toUpperCase() : undefined}
    >
      {studentsQ.isPending || marksQ.isPending ? (
        <ActivityIndicator color={ACC} style={{ paddingVertical: 30 }} />
      ) : students.length === 0 ? (
        <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 26 }}>No active students enrolled in this batch.</Body>
      ) : (
        <>
          <Body style={{ fontSize: 10.5, color: C.muted3 }}>Everyone starts as present. Tap to change, add a remark if needed, then submit for approval.</Body>

          <View style={{ gap: 9 }}>
            {students.map((s) => {
              const ex = existing[s.studentId];
              const locked = ex?.approval === 'approved';
              const cur = statuses[s.studentId] ?? 'present';
              const hasRemark = !!(remarks[s.studentId] ?? '').trim();
              const showRemark = !!remarkOpen[s.studentId];
              return (
                <View key={s.studentId} style={{ padding: 11, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: locked ? hexA(C.green, 0.22) : 'rgba(255,255,255,0.07)', gap: 9 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <MiniAvatar initial={initials(s.name)} colors={avColors(s.name)} size={34} />
                    <View style={{ flex: 1 }}>
                      <Body numberOfLines={1} style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{s.name}</Body>
                      {s.rollNo ? <Mono style={{ fontSize: 8.5, color: C.muted3, marginTop: 1 }}>ROLL {s.rollNo}</Mono> : null}
                    </View>
                    {locked && ex ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: attColor(ex.status), textTransform: 'capitalize' }}>{ex.status}</Text>
                        <Badge text="Approved" color={C.green} />
                      </View>
                    ) : (
                      <Pressable
                        onPress={() => setRemarkOpen((m) => ({ ...m, [s.studentId]: !m[s.studentId] }))}
                        hitSlop={8}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 5, paddingHorizontal: 9, borderRadius: 999, backgroundColor: showRemark || hasRemark ? hexA(ACC, 0.12) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: showRemark || hasRemark ? hexA(ACC, 0.4) : 'rgba(255,255,255,0.09)' }}
                      >
                        <Icon name="bubble" size={10} color={showRemark || hasRemark ? ACC : C.muted3} strokeWidth={2.1} />
                        <Text style={{ fontFamily: F.bodySemi, fontSize: 9.5, color: showRemark || hasRemark ? ACC : C.muted }}>remark</Text>
                      </Pressable>
                    )}
                  </View>

                  {locked ? (
                    ex?.remarks ? <Body style={{ fontSize: 10.5, color: C.muted2 }}>{ex.remarks}</Body> : null
                  ) : (
                    <>
                      <View style={{ flexDirection: 'row', gap: 7 }}>
                        {CHOICES.map((c) => {
                          const on = cur === c.key;
                          return (
                            <AnimChip
                              key={c.key}
                              grow
                              active={on}
                              onPress={() => setStatuses((m) => ({ ...m, [s.studentId]: c.key }))}
                              style={{ alignItems: 'center', paddingVertical: 9, borderRadius: 11, backgroundColor: on ? hexA(c.color, 0.15) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: on ? hexA(c.color, 0.5) : 'rgba(255,255,255,0.09)' }}
                            >
                              <Text style={{ fontFamily: on ? F.bodyBold : F.bodySemi, fontSize: 11.5, color: on ? c.color : C.muted }}>{c.label}</Text>
                            </AnimChip>
                          );
                        })}
                      </View>
                      {showRemark ? (
                        <TextInput
                          value={remarks[s.studentId] ?? ''}
                          onChangeText={(t) => setRemarks((m) => ({ ...m, [s.studentId]: t }))}
                          placeholder="Optional remark"
                          placeholderTextColor={C.muted3}
                          style={{ paddingVertical: 9, paddingHorizontal: 12, borderRadius: 11, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.04)', color: '#fff', fontFamily: F.body, fontSize: 12.5 }}
                        />
                      ) : null}
                    </>
                  )}
                </View>
              );
            })}
          </View>

          {lockedIds.length > 0 && !allApproved ? (
            <Body style={{ fontSize: 10, color: C.muted3, textAlign: 'center' }}>
              {lockedIds.length} of {students.length} already approved and locked. Only the rest will be submitted.
            </Body>
          ) : null}

          {allApproved ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 12, backgroundColor: hexA(C.green, 0.08), borderWidth: 1, borderColor: hexA(C.green, 0.3) }}>
              <Icon name="shield" size={14} color={C.green} strokeWidth={2.1} />
              <Body style={{ flex: 1, fontSize: 11.5, color: '#9ED9B5', lineHeight: 16 }}>
                Attendance for this date is fully approved and locked. Contact the academy office if a change is needed.
              </Body>
            </View>
          ) : (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                <Mono style={{ fontSize: 9, color: C.green }}>P {counts.present ?? 0}</Mono>
                <Mono style={{ fontSize: 9, color: C.red }}>A {counts.absent ?? 0}</Mono>
                <Mono style={{ fontSize: 9, color: C.gold }}>L {counts.late ?? 0}</Mono>
                {counts.leave ? <Mono style={{ fontSize: 9, color: C.blue }}>LV {counts.leave}</Mono> : null}
              </View>
              <Pressable onPress={submit} disabled={submitM.isPending || unlocked.length === 0} style={{ borderRadius: 13, overflow: 'hidden', opacity: submitM.isPending || unlocked.length === 0 ? 0.5 : 1 }}>
                <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ alignItems: 'center', paddingVertical: 14 }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: '#fff' }}>{submitM.isPending ? 'Submitting…' : 'Submit for approval'}</Text>
                </LinearGradient>
              </Pressable>
              <Body style={{ fontSize: 9.5, color: C.muted3, textAlign: 'center' }}>Marks go to the academy office as pending and count only once approved.</Body>
            </>
          )}
        </>
      )}
    </SheetShell>
  );
}
