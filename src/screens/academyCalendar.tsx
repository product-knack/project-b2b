import React from 'react';
import { View, Text, Pressable, Modal, ActivityIndicator, Alert } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C, F, hexA, ORANGE_GRAD } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono } from '../components/primitives';
import { HScroll, Badge } from './common';
import {
  useAcademyBatches, useAcademyUsers, useSetBatchTeachers, prettyDate, AcademyBatch,
} from '../lib/academyQueries';

/* ============================================================================
   Academy Calendar — weekly class schedule derived from each batch's schedule
   JSON (web CalendarTab + expandBatches port, phone layout: week nav + day
   strip + a vertical timeline for the selected day). Tapping a class opens
   whole-batch teacher reassignment (set_batch_teachers RPC), exactly like the
   web popover — there are no per-class overrides.
   ========================================================================== */

const ACC = '#6EA8FE';
const CAL_DAY_KEYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const CAL_COLORS = ['#6EA8FE', '#B78BFF', '#5BD4A4', '#E8A87C', '#EA7B9A', '#E8D07C', '#7CD4E8'];
const calColorFor = (id: string) => { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return CAL_COLORS[h % CAL_COLORS.length]; };

/* Free-text time parser (web parseTimeRange): "6-7pm", "18:00", "10:00-12:00".
   Default end = start + 60min; bare hours 1-7 with no am/pm assume PM. */
export function parseTimeRange(text: string | null | undefined): { start: number; end: number } | null {
  if (!text) return null;
  const m = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(text)
    ?? /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(text);
  if (!m) return null;
  const toMin = (hRaw: string, minRaw: string | undefined, mer: string | undefined) => {
    let h = parseInt(hRaw, 10);
    const mm = minRaw ? parseInt(minRaw, 10) : 0;
    const mer2 = (mer ?? '').toLowerCase();
    if (mer2 === 'pm' && h < 12) h += 12;
    else if (mer2 === 'am' && h === 12) h = 0;
    else if (!mer2 && h >= 1 && h <= 7) h += 12; // heuristic: ambiguous small hour = PM
    return h * 60 + mm;
  };
  const endMer = (m[6] ?? undefined) as string | undefined;
  const start = toMin(m[1], m[2], (m[3] as string | undefined) ?? endMer);
  const end = m[4] != null ? toMin(m[4], m[5], endMer ?? (m[3] as string | undefined)) : start + 60;
  return { start, end: end > start ? end : start + 60 };
}
const fmtMin = (n: number) => {
  const h24 = Math.floor(n / 60) % 24, mm = n % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(mm).padStart(2, '0')} ${h24 >= 12 ? 'PM' : 'AM'}`;
};

type ClassInstance = {
  key: string; batch: AcademyBatch; date: string;
  start: number | null; end: number | null; color: string; conflicted: boolean;
};

export function AcademyCalendarTab() {
  const q = useAcademyBatches();
  const setTeachersM = useSetBatchTeachers();
  const teachersQ = useAcademyUsers('teacher', false);
  const [monthDate, setMonthDate] = React.useState(new Date());
  const istTodayYmd = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const [calSel, setCalSel] = React.useState<string | null>(istTodayYmd);
  const [teacherFilter, setTeacherFilter] = React.useState<string>('all');
  const [courseFilter, setCourseFilter] = React.useState<string>('all');
  const [showInactive, setShowInactive] = React.useState(false);
  const [openClass, setOpenClass] = React.useState<ClassInstance | null>(null);
  const [selTeachers, setSelTeachers] = React.useState<string[]>([]);
  const [selPrimary, setSelPrimary] = React.useState<string | null>(null);

  const shiftMonth = (d: number) => { setMonthDate((prev) => { const n = new Date(prev); n.setMonth(n.getMonth() + d); return n; }); setCalSel(null); };
  const goToday = () => { setMonthDate(new Date()); setCalSel(istTodayYmd); };

  // Every date of the visible month as YYYY-MM-DD.
  const y = monthDate.getFullYear(), mo = monthDate.getMonth();
  const daysInMonth = new Date(y, mo + 1, 0).getDate();
  const p2 = (n: number) => String(n).padStart(2, '0');
  const monthDates = React.useMemo(
    () => Array.from({ length: daysInMonth }, (_, i) => `${y}-${p2(mo + 1)}-${p2(i + 1)}`),
    [y, mo, daysInMonth]
  );
  // Weekday key ('Mon'...) for a YYYY-MM-DD date.
  const dayKeyOf = (ymd: string) => CAL_DAY_KEYS[(new Date(`${ymd}T00:00:00Z`).getUTCDay() + 6) % 7];

  const batches = q.data ?? [];
  const courses = React.useMemo(() => [...new Set(batches.map((b) => b.course_name).filter(Boolean))].sort(), [batches]);

  // Expand every batch's schedule.days across the whole visible month.
  const { byDay, conflictCount } = React.useMemo(() => {
    const instances: ClassInstance[] = [];
    batches
      .filter((b) => showInactive || b.status === 'active')
      .filter((b) => courseFilter === 'all' || b.course_name === courseFilter)
      .filter((b) => teacherFilter === 'all' || b.teachers.some((t) => t.id === teacherFilter))
      .forEach((b) => {
        const days = b.schedule?.days ?? [];
        const range = parseTimeRange(b.schedule?.time);
        const primary = b.teachers.find((t) => t.isPrimary) ?? b.teachers[0];
        monthDates.forEach((date) => {
          if (!days.includes(dayKeyOf(date))) return;
          if (b.start_date && date < b.start_date) return;
          if (b.end_date && date > b.end_date) return;
          instances.push({
            key: `${b.id}|${date}`, batch: b, date,
            start: range?.start ?? null, end: range?.end ?? null,
            color: calColorFor(primary?.id ?? b.id), conflicted: false,
          });
        });
      });
    // Conflicts (web detectConflicts): same date, overlapping windows, sharing any teacher.
    let conflicts = 0;
    for (let i = 0; i < instances.length; i++) {
      for (let j = i + 1; j < instances.length; j++) {
        const a = instances[i], c = instances[j];
        if (a.date !== c.date || a.start == null || c.start == null) continue;
        const overlap = a.start < (c.end ?? c.start) && c.start < (a.end ?? a.start);
        if (!overlap) continue;
        const shared = a.batch.teachers.some((t) => c.batch.teachers.some((u) => u.id === t.id));
        if (shared) { a.conflicted = c.conflicted = true; conflicts++; }
      }
    }
    const byDay = new Map<string, ClassInstance[]>();
    instances.forEach((ins) => {
      if (!byDay.has(ins.date)) byDay.set(ins.date, []);
      byDay.get(ins.date)!.push(ins);
    });
    byDay.forEach((list) => list.sort((a, b) => (a.start ?? 9999) - (b.start ?? 9999)));
    return { byDay, conflictCount: conflicts };
  }, [batches, monthDates, teacherFilter, courseFilter, showInactive]);

  const openReassign = (ins: ClassInstance) => {
    setOpenClass(ins);
    setSelTeachers(ins.batch.teachers.map((t) => t.id));
    setSelPrimary(ins.batch.teachers.find((t) => t.isPrimary)?.id ?? ins.batch.teachers[0]?.id ?? null);
  };
  const toggleSelTeacher = (id: string) => {
    setSelTeachers((ids) => {
      const has = ids.includes(id);
      const next = has ? ids.filter((x) => x !== id) : [...ids, id];
      setSelPrimary((p) => (has && p === id ? next[0] ?? null : !has && !p ? id : p));
      return next;
    });
  };
  const saveTeachers = () => {
    if (!openClass || !selTeachers.length || !selPrimary) return;
    setTeachersM.mutate({ batchId: openClass.batch.id, teacherIds: selTeachers, primaryId: selPrimary }, {
      onSuccess: () => { Alert.alert('Teachers updated', 'The change applies to the entire batch going forward.'); setOpenClass(null); },
      onError: (e: any) => Alert.alert('Could not update', e?.message ?? 'Try again'),
    });
  };

  const dayList = calSel ? (byDay.get(calSel) ?? []) : [];
  const monthLabel = monthDate.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  return (
    <View style={{ gap: 11 }}>
      {/* Month nav — roster-calendar style */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 13, gap: 8, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }}>
        <Pressable onPress={() => shiftMonth(-1)} hitSlop={8} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="chevLeft" size={14} color={C.ink3} strokeWidth={2.3} />
        </Pressable>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: '#fff' }}>{monthLabel}</Text>
          {conflictCount > 0 ? (
            <View style={{ marginTop: 3, paddingVertical: 2, paddingHorizontal: 8, borderRadius: 999, backgroundColor: hexA(C.red, 0.16), borderWidth: 1, borderColor: hexA(C.red, 0.45) }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 8.5, color: C.red }}>{conflictCount} CONFLICT{conflictCount === 1 ? '' : 'S'} THIS MONTH</Text>
            </View>
          ) : null}
        </View>
        <Pressable onPress={goToday} style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, backgroundColor: hexA(ACC, 0.12), borderWidth: 1, borderColor: hexA(ACC, 0.4) }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 10.5, color: ACC }}>Today</Text>
        </Pressable>
        <Pressable onPress={() => shiftMonth(1)} hitSlop={8} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="chevRight" size={14} color={C.ink3} strokeWidth={2.3} />
        </Pressable>
      </View>

      {/* Filters */}
      <HScroll gap={7}>
        <Pressable onPress={() => setShowInactive((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 7, paddingHorizontal: 11, borderRadius: 999, backgroundColor: showInactive ? hexA(C.muted2, 0.14) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: showInactive ? hexA(C.muted2, 0.4) : 'rgba(255,255,255,0.09)' }}>
          <Icon name="eye" size={10} color={C.muted2} strokeWidth={2.2} />
          <Text style={{ fontFamily: F.bodySemi, fontSize: 10.5, color: C.muted }}>Inactive</Text>
        </Pressable>
        {[{ id: 'all', name: 'All teachers' }, ...(teachersQ.data ?? [])].map((t: any) => {
          const on = teacherFilter === t.id;
          return (
            <Pressable key={t.id} onPress={() => setTeacherFilter(t.id)} style={{ paddingVertical: 7, paddingHorizontal: 11, borderRadius: 999, backgroundColor: on ? hexA(ACC, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: on ? hexA(ACC, 0.5) : 'rgba(255,255,255,0.09)' }}>
              <Text style={{ fontFamily: on ? F.bodyBold : F.bodySemi, fontSize: 10.5, color: on ? ACC : C.muted }}>{t.name}</Text>
            </Pressable>
          );
        })}
        {courses.map((cn) => {
          const on = courseFilter === cn;
          return (
            <Pressable key={cn} onPress={() => setCourseFilter(on ? 'all' : cn)} style={{ paddingVertical: 7, paddingHorizontal: 11, borderRadius: 999, backgroundColor: on ? hexA(C.purple, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: on ? hexA(C.purple, 0.5) : 'rgba(255,255,255,0.09)' }}>
              <Text style={{ fontFamily: on ? F.bodyBold : F.bodySemi, fontSize: 10.5, color: on ? C.purple : C.muted }}>{cn}</Text>
            </Pressable>
          );
        })}
      </HScroll>

      {/* Month grid — roster-calendar style: day cells with class-count chips */}
      <View style={{ padding: 14, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }}>
        <View style={{ flexDirection: 'row', marginBottom: 7 }}>
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((w, i) => (
            <Text key={i} style={{ flex: 1, textAlign: 'center', fontFamily: F.mono, fontSize: 9, color: C.muted3 }}>{w}</Text>
          ))}
        </View>
        {(() => {
          const firstWeekday = new Date(y, mo, 1).getDay();
          const cells: (number | null)[] = [];
          for (let i = 0; i < firstWeekday; i++) cells.push(null);
          for (let day = 1; day <= daysInMonth; day++) cells.push(day);
          while (cells.length % 7 !== 0) cells.push(null);
          const weeks: (number | null)[][] = [];
          for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
          return weeks.map((wk, wi) => (
            <View key={wi} style={{ flexDirection: 'row', marginBottom: 5 }}>
              {wk.map((day, di) => {
                const k = day ? `${y}-${p2(mo + 1)}-${p2(day)}` : '';
                const list = day ? byDay.get(k) ?? [] : [];
                const sel = day != null && k === calSel;
                const isToday = day != null && k === istTodayYmd;
                const hasConf = list.some((c) => c.conflicted);
                const dotCol = hasConf ? C.red : ACC;
                return (
                  <Pressable key={di} disabled={!day} onPress={() => day && setCalSel(sel ? null : k)} style={{ flex: 1, alignItems: 'center', gap: 3, paddingVertical: 3 }}>
                    <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: sel ? ACC : 'transparent', borderWidth: isToday && !sel ? 1.5 : 0, borderColor: hexA(ACC, 0.55) }}>
                      <Text style={{ fontFamily: sel || isToday ? F.bodyBold : F.body, fontSize: 12, color: sel ? '#0B0E14' : isToday ? ACC : day ? C.ink3 : 'transparent' }}>{day ?? 0}</Text>
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
          ));
        })()}
      </View>

      <Body style={{ fontSize: 9.5, color: C.muted3 }}>Teacher changes here apply to the entire batch going forward, every scheduled day.</Body>

      {/* Selected day classes */}
      {q.isPending ? <ActivityIndicator color={ACC} style={{ paddingVertical: 24 }} />
        : !calSel ? <Body style={{ fontSize: 11.5, color: C.muted3, textAlign: 'center' }}>Tap a day to see its classes.</Body>
        : dayList.length === 0 ? <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 26 }}>No classes on {prettyDate(calSel)}.</Body>
        : dayList.map((ins) => (
          <Pressable key={ins.key} onPress={() => openReassign(ins)} style={{ flexDirection: 'row', borderRadius: 15, overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: ins.conflicted ? hexA(C.red, 0.45) : hexA(ins.color, 0.25) }}>
            <View style={{ width: 4, backgroundColor: ins.conflicted ? C.red : ins.color }} />
            <View style={{ flex: 1, padding: 12, gap: 7 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Body numberOfLines={1} style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{ins.batch.course_name} · {ins.batch.batch_name}</Body>
                  <Mono style={{ fontSize: 8.5, color: C.muted3, marginTop: 2 }}>
                    {ins.start != null ? `${fmtMin(ins.start)} – ${fmtMin(ins.end ?? ins.start + 60)} IST` : 'TIME NOT SET'}
                  </Mono>
                </View>
                {ins.conflicted ? (
                  <View style={{ paddingVertical: 3, paddingHorizontal: 8, borderRadius: 999, backgroundColor: hexA(C.red, 0.14), borderWidth: 1, borderColor: hexA(C.red, 0.45) }}>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 8.5, color: C.red }}>CONFLICT</Text>
                  </View>
                ) : null}
                {ins.batch.status !== 'active' ? <Badge text={ins.batch.status} color={C.muted2} /> : null}
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
                {ins.batch.teachers.map((t) => (
                  <View key={t.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 3, paddingHorizontal: 8, borderRadius: 999, backgroundColor: hexA(calColorFor(t.id), 0.12), borderWidth: 1, borderColor: hexA(calColorFor(t.id), 0.35) }}>
                    {t.isPrimary ? <Icon name="crown" size={8} color={calColorFor(t.id)} strokeWidth={2.2} /> : null}
                    <Text style={{ fontFamily: F.bodySemi, fontSize: 9.5, color: calColorFor(t.id) }}>{t.name.split(' ')[0]}</Text>
                  </View>
                ))}
              </View>
            </View>
          </Pressable>
        ))}

      {/* Class sheet — details + whole-batch teacher reassignment */}
      <Modal visible={!!openClass} transparent animationType="slide" onRequestClose={() => setOpenClass(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }}>
          <Pressable style={{ flex: 1 }} onPress={() => setOpenClass(null)} />
          <View style={{ maxHeight: '84%', backgroundColor: '#12131A', borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: hexA(ACC, 0.18), paddingHorizontal: 18, paddingTop: 16, paddingBottom: 26 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <View style={{ flex: 1 }}>
                <Serif style={{ fontSize: 18 }} numberOfLines={1}>{openClass?.batch.course_name} · {openClass?.batch.batch_name}</Serif>
                <Body style={{ fontSize: 11, color: C.muted2 }}>
                  {openClass ? `${prettyDate(openClass.date)} · ${openClass.start != null ? `${fmtMin(openClass.start)} – ${fmtMin(openClass.end ?? openClass.start + 60)} IST` : 'time not set'}` : ''}
                </Body>
              </View>
              <Pressable onPress={() => setOpenClass(null)} hitSlop={10} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="close" size={13} color={C.muted2} strokeWidth={2.3} />
              </Pressable>
            </View>
            {openClass?.conflicted ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, padding: 10, borderRadius: 11, backgroundColor: hexA(C.red, 0.08), borderWidth: 1, borderColor: hexA(C.red, 0.35), marginBottom: 11 }}>
                <Icon name="alert" size={13} color={C.red} strokeWidth={2.2} />
                <Body style={{ flex: 1, fontSize: 11, color: '#F0A9A0' }}>A teacher on this class is double-booked in an overlapping slot this day.</Body>
              </View>
            ) : null}
            <Mono style={{ fontSize: 9, letterSpacing: 1, color: C.mono2, marginBottom: 7 }}>TEACHERS · TAP TO SELECT, CROWN = PRIMARY</Mono>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 8 }}>
              {(teachersQ.data ?? []).map((t) => {
                const on = selTeachers.includes(t.id);
                const prim = selPrimary === t.id;
                return (
                  <Pressable key={t.id} onPress={() => toggleSelTeacher(t.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 7, paddingHorizontal: 11, borderRadius: 999, backgroundColor: on ? hexA(prim ? ACC : C.gold, 0.14) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: on ? hexA(prim ? ACC : C.gold, 0.5) : 'rgba(255,255,255,0.1)' }}>
                    {on ? (
                      <Pressable onPress={() => setSelPrimary(t.id)} hitSlop={8}>
                        <Icon name="crown" size={11} color={prim ? ACC : 'rgba(255,255,255,0.35)'} strokeWidth={2.2} />
                      </Pressable>
                    ) : null}
                    <Text style={{ fontFamily: on ? F.bodyBold : F.bodySemi, fontSize: 11.5, color: on ? (prim ? ACC : C.gold) : C.muted }}>{t.name}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Body style={{ fontSize: 9.5, color: C.muted3, marginBottom: 10 }}>This changes the teachers for the ENTIRE batch, not just this class.</Body>
            <Pressable onPress={saveTeachers} disabled={setTeachersM.isPending || !selTeachers.length || !selPrimary} style={{ borderRadius: 13, overflow: 'hidden', opacity: setTeachersM.isPending || !selTeachers.length || !selPrimary ? 0.5 : 1 }}>
              <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ alignItems: 'center', paddingVertical: 13 }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: '#fff' }}>{setTeachersM.isPending ? 'Saving…' : 'Update batch teachers'}</Text>
              </LinearGradient>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}
