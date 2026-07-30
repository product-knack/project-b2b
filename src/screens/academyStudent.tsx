import React from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono, Card } from '../components/primitives';
import { Page, TitleBlock, HScroll, Badge } from './common';
import { SheetShell } from './reportDetail';
import { useAuth } from '../auth';
import { attPct, istToday, prettyDate } from '../lib/academyQueries';
import { parseTimeRange } from './academyCalendar';
import {
  useMyAcademyLink, useStudentBatches, useMyAttendance, StudentBatch, MyAttRow,
} from '../lib/academyAttendanceQueries';

/* ============================================================================
   Academy Student — the student's own view (mirror of the web student page):
   batch strip with attendance %, today's classes, a Monday-first month
   calendar of APPROVED attendance, stats and grouped history. Read-only:
   students never write attendance.
   ========================================================================== */

const ACC = '#6EA8FE'; // academy accent
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const p2 = (n: number) => String(n).padStart(2, '0');
const dayKeyOf = (ymd: string) => WEEK[(new Date(`${ymd}T00:00:00Z`).getUTCDay() + 6) % 7];
const fmtMin = (n: number) => {
  const h24 = Math.floor(n / 60) % 24, mm = n % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${p2(mm)} ${h24 >= 12 ? 'PM' : 'AM'}`;
};
const pctColor = (p: number) => (p >= 75 ? C.green : p >= 50 ? C.gold : C.red);
const attColor = (s: string) => (s === 'present' ? C.green : s === 'late' ? C.gold : s === 'leave' ? C.blue : C.red);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const monthLabelOf = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, 1)).toLocaleDateString('en-IN', { timeZone: 'UTC', month: 'long', year: 'numeric' });
};

export function AcademyStudent() {
  const { session } = useAuth();
  const profileId = session?.user?.id ?? null;
  const linkQ = useMyAcademyLink(profileId);
  const studentId = linkQ.data?.studentId ?? null;

  return (
    <Page gap={14} pt={6} scrollKey="academy-student">
      <TitleBlock title="Odds Academy" sub="Your batches and attendance" />
      {linkQ.isPending ? (
        <ActivityIndicator color={ACC} style={{ paddingVertical: 40 }} />
      ) : !studentId ? (
        <View style={{ alignItems: 'center', gap: 10, paddingVertical: 46 }}>
          <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: hexA(ACC, 0.1), borderWidth: 1, borderColor: hexA(ACC, 0.3), alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="userCircle" size={24} color={ACC} strokeWidth={1.9} />
          </View>
          <Body style={{ fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }}>Not linked as an academy student</Body>
          <Body style={{ fontSize: 11.5, color: C.muted2, textAlign: 'center', maxWidth: 260 }}>
            Your login is not connected to a student record yet. Ask the academy office to link your account.
          </Body>
        </View>
      ) : (
        <StudentBody studentId={studentId} />
      )}
    </Page>
  );
}

function StudentBody({ studentId }: { studentId: string }) {
  const batchesQ = useStudentBatches(studentId);
  const attQ = useMyAttendance(studentId);
  const [activeBatch, setActiveBatch] = React.useState<string | null>(null);
  const [monthDate, setMonthDate] = React.useState(() => new Date());
  const [openDay, setOpenDay] = React.useState<string | null>(null);
  const [limit, setLimit] = React.useState(20);

  const today = istToday();
  const batches = batchesQ.data ?? [];
  const allRows = attQ.data ?? [];
  // Approved rows narrowed to the tapped batch card, when one is active.
  const rows = React.useMemo(
    () => (activeBatch ? allRows.filter((r) => r.batchId === activeBatch) : allRows),
    [allRows, activeBatch]
  );
  const filteredBatches = activeBatch ? batches.filter((b) => b.id === activeBatch) : batches;

  // ---- Today's classes (enrolled batches scheduled on today's weekday) ----
  const todayKey = dayKeyOf(today);
  const todayClasses = batches.filter((b) => (b.schedule?.days ?? []).includes(todayKey));

  // ---- Month grid (Monday-first, roster-calendar pattern) ----
  const y = monthDate.getFullYear(), mo = monthDate.getMonth();
  const monthKey = `${y}-${p2(mo + 1)}`;
  const weeks = React.useMemo(() => {
    const daysInMonth = new Date(y, mo + 1, 0).getDate();
    const lead = (new Date(y, mo, 1).getDay() + 6) % 7;
    const cells: (string | null)[] = Array(lead).fill(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(`${monthKey}-${p2(d)}`);
    while (cells.length % 7) cells.push(null);
    const out: (string | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7));
    return out;
  }, [y, mo]);

  const byDate = React.useMemo(() => {
    const m = new Map<string, MyAttRow[]>();
    rows.forEach((r) => m.set(r.date, [...(m.get(r.date) ?? []), r]));
    return m;
  }, [rows]);

  // Weekdays on which any (filtered) batch holds class -> blue "scheduled" dots.
  const scheduledDays = React.useMemo(() => {
    const s = new Set<string>();
    filteredBatches.forEach((b) => (b.schedule?.days ?? []).forEach((d) => s.add(d)));
    return s;
  }, [filteredBatches]);

  // Dot priority: red (absent/leave) > gold (late) > green (present) > blue (scheduled).
  const dotFor = (k: string): string | null => {
    const list = byDate.get(k) ?? [];
    if (list.some((r) => r.status === 'absent' || r.status === 'leave')) return C.red;
    if (list.some((r) => r.status === 'late')) return C.gold;
    if (list.some((r) => r.status === 'present')) return C.green;
    if (scheduledDays.has(dayKeyOf(k))) return C.blue;
    return null;
  };

  const shiftMonth = (d: number) => setMonthDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + d, 1));
  const monthLabel = monthDate.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  // ---- Stats: month counts + overall weighted pct for the current filter ----
  const monthRows = rows.filter((r) => r.date.startsWith(monthKey));
  const countOf = (s: MyAttRow['status']) => monthRows.filter((r) => r.status === s).length;
  const overallPct = attPct(rows);

  // ---- History grouped by month (rows arrive newest date first) ----
  const visible = rows.slice(0, limit);
  const groups: { ym: string; rows: MyAttRow[] }[] = [];
  visible.forEach((r) => {
    const ym = r.date.slice(0, 7);
    const g = groups[groups.length - 1];
    if (g && g.ym === ym) g.rows.push(r);
    else groups.push({ ym, rows: [r] });
  });
  const remaining = rows.length - visible.length;

  const dayRows = openDay ? (byDate.get(openDay) ?? []) : [];

  return (
    <View style={{ gap: 13 }}>
      {/* ---- Batch strip: tap a card to filter calendar + history ---- */}
      {batchesQ.isPending ? (
        <ActivityIndicator color={ACC} style={{ paddingVertical: 20 }} />
      ) : batches.length === 0 ? (
        <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 20 }}>
          You are not enrolled in any active batch yet.
        </Body>
      ) : (
        <HScroll gap={9}>
          {batches.map((b: StudentBatch) => {
            const on = activeBatch === b.id;
            const col = pctColor(b.pct);
            return (
              <Card
                key={b.id}
                onPress={() => setActiveBatch((p) => (p === b.id ? null : b.id))}
                colors={on ? [hexA(ACC, 0.16), 'rgba(16,16,20,0.55)'] : ['rgba(30,38,58,0.5)', 'rgba(16,16,20,0.55)']}
                border={on ? hexA(ACC, 0.55) : 'rgba(255,255,255,0.08)'}
                radius={16}
                style={{ width: 196, padding: 13, gap: 8 }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Body numberOfLines={1} style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{b.batch_name}</Body>
                    <Body numberOfLines={1} style={{ fontSize: 10.5, color: C.muted2, marginTop: 1 }}>{b.course_name}</Body>
                  </View>
                  {on ? <Icon name="checks" size={13} color={ACC} strokeWidth={2.4} /> : null}
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  <Icon name="userCircle" size={11} color={C.muted3} strokeWidth={2} />
                  <Body numberOfLines={1} style={{ flex: 1, fontSize: 10.5, color: C.ink3 }}>{b.teacherName ?? 'No teacher'}</Body>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6 }}>
                  <Serif style={{ fontSize: 27, lineHeight: 30, color: col }}>{b.pct}%</Serif>
                  <Mono style={{ fontSize: 7, letterSpacing: 0.8, color: C.muted3, marginBottom: 4 }}>ATTENDANCE</Mono>
                </View>
              </Card>
            );
          })}
        </HScroll>
      )}
      {activeBatch ? (
        <Body style={{ fontSize: 9.5, color: C.muted3, marginTop: -5 }}>Showing one batch. Tap the card again to see everything.</Body>
      ) : null}

      {/* ---- Today's classes banner ---- */}
      {todayClasses.length ? (
        <View style={{ borderRadius: 15, backgroundColor: hexA(ACC, 0.07), borderWidth: 1, borderColor: hexA(ACC, 0.28), padding: 13, gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
            <Icon name="clock" size={13} color={ACC} strokeWidth={2.1} />
            <Mono style={{ fontSize: 9, letterSpacing: 1, color: ACC }}>TODAY'S CLASSES · {prettyDate(today).toUpperCase()}</Mono>
          </View>
          {todayClasses.map((b) => {
            const range = parseTimeRange(b.schedule?.time);
            return (
              <View key={b.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: ACC }} />
                <Body numberOfLines={1} style={{ flex: 1, fontSize: 12.5, fontFamily: F.bodySemi, color: '#fff' }}>
                  {b.course_name} · {b.batch_name}
                </Body>
                <Mono style={{ fontSize: 9.5, color: C.ink3 }}>
                  {range ? `${fmtMin(range.start)} - ${fmtMin(range.end)}` : b.schedule?.time || 'Time not set'}
                </Mono>
              </View>
            );
          })}
        </View>
      ) : null}

      {/* ---- Month calendar (Monday-first) ---- */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12, gap: 8, borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }}>
        <Pressable onPress={() => shiftMonth(-1)} hitSlop={8} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="chevLeft" size={14} color={C.ink3} strokeWidth={2.3} />
        </Pressable>
        <Text style={{ flex: 1, textAlign: 'center', fontFamily: F.bodyBold, fontSize: 14, color: '#fff' }}>{monthLabel}</Text>
        <Pressable onPress={() => shiftMonth(1)} hitSlop={8} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="chevRight" size={14} color={C.ink3} strokeWidth={2.3} />
        </Pressable>
      </View>

      <View style={{ padding: 12, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }}>
        <View style={{ flexDirection: 'row', marginBottom: 7 }}>
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((w, i) => (
            <Mono key={i} style={{ flex: 1, textAlign: 'center', fontSize: 8.5, letterSpacing: 0.5, color: C.muted3 }}>{w}</Mono>
          ))}
        </View>
        {attQ.isPending ? (
          <ActivityIndicator color={ACC} style={{ paddingVertical: 26 }} />
        ) : (
          weeks.map((wk, wi) => (
            <View key={wi} style={{ flexDirection: 'row', marginBottom: 4 }}>
              {wk.map((k, di) => {
                if (!k) return <View key={di} style={{ flex: 1, paddingVertical: 3 }} />;
                const list = byDate.get(k) ?? [];
                const dot = dotFor(k);
                const isToday = k === today;
                return (
                  <Pressable key={di} disabled={!list.length} onPress={() => setOpenDay(k)} style={{ flex: 1, alignItems: 'center', gap: 3, paddingVertical: 3 }}>
                    <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: list.length ? 'rgba(255,255,255,0.045)' : 'transparent', borderWidth: isToday ? 1.5 : 0, borderColor: hexA(ACC, 0.55) }}>
                      <Text style={{ fontFamily: isToday || list.length ? F.bodyBold : F.body, fontSize: 12, color: isToday ? ACC : list.length ? '#fff' : C.ink3 }}>{Number(k.slice(8))}</Text>
                    </View>
                    <View style={{ height: 6, alignItems: 'center', justifyContent: 'center' }}>
                      {dot ? <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: dot }} /> : null}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ))
        )}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10, marginTop: 8 }}>
          {([[C.green, 'Present'], [C.gold, 'Late'], [C.red, 'Absent / leave'], [C.blue, 'Class day']] as const).map(([col, lab]) => (
            <View key={lab} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: col }} />
              <Mono style={{ fontSize: 7.5, color: C.muted3 }}>{lab.toUpperCase()}</Mono>
            </View>
          ))}
        </View>
      </View>

      {/* ---- Stats: month counts + overall weighted pct ---- */}
      <View style={{ flexDirection: 'row', gap: 7 }}>
        {([['Present', countOf('present'), C.green], ['Absent', countOf('absent'), C.red], ['Late', countOf('late'), C.gold], ['Leave', countOf('leave'), C.blue]] as const).map(([lab, n, col]) => (
          <View key={lab} style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 13, backgroundColor: hexA(col, 0.07), borderWidth: 1, borderColor: hexA(col, 0.25) }}>
            <Serif style={{ fontSize: 21, color: col }}>{attQ.isPending ? '…' : n}</Serif>
            <Mono style={{ fontSize: 6.5, letterSpacing: 0.7, color: C.muted3, marginTop: 2 }}>{lab.toUpperCase()}</Mono>
          </View>
        ))}
        <View style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 13, backgroundColor: hexA(pctColor(overallPct), 0.07), borderWidth: 1, borderColor: hexA(pctColor(overallPct), 0.25) }}>
          <Serif style={{ fontSize: 21, color: pctColor(overallPct) }}>{attQ.isPending ? '…' : `${overallPct}%`}</Serif>
          <Mono style={{ fontSize: 6.5, letterSpacing: 0.7, color: C.muted3, marginTop: 2 }}>OVERALL</Mono>
        </View>
      </View>
      <Body style={{ fontSize: 9.5, color: C.muted3, marginTop: -6 }}>
        Counts are for {monthLabel}. Overall is weighted across your full approved history: present 1, late 0.5.
      </Body>

      {/* ---- History (approved rows, grouped by month, newest first) ---- */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Mono style={{ fontSize: 9, letterSpacing: 1.2, color: C.mono2 }}>HISTORY</Mono>
        <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.05)' }} />
        <Mono style={{ fontSize: 9, color: C.muted3 }}>{rows.length} RECORD{rows.length === 1 ? '' : 'S'}</Mono>
      </View>
      {attQ.isPending ? (
        <ActivityIndicator color={ACC} style={{ paddingVertical: 20 }} />
      ) : rows.length === 0 ? (
        <View style={{ alignItems: 'center', gap: 8, paddingVertical: 22 }}>
          <Icon name="calendar" size={22} color={C.muted3} strokeWidth={1.8} />
          <Body style={{ fontSize: 12, color: C.muted2 }}>No approved attendance yet.</Body>
        </View>
      ) : (
        <>
          {groups.map((g) => (
            <View key={g.ym} style={{ gap: 7 }}>
              <Mono style={{ fontSize: 8.5, letterSpacing: 1, color: C.muted3 }}>{monthLabelOf(g.ym).toUpperCase()}</Mono>
              <View style={{ borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
                {g.rows.map((r, i) => (
                  <View key={r.id} style={{ padding: 12, gap: 4, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: 'rgba(255,255,255,0.05)' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                      <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: attColor(r.status) }} />
                      <View style={{ flex: 1 }}>
                        <Body numberOfLines={1} style={{ fontSize: 12.5, fontFamily: F.bodySemi, color: '#fff' }}>{r.batchLabel}</Body>
                        <Mono style={{ fontSize: 8.5, color: C.muted3, marginTop: 1 }}>
                          {prettyDate(r.date).toUpperCase()}{r.sessionTime ? ` · ${r.sessionTime}` : ''}
                        </Mono>
                      </View>
                      <Badge text={cap(r.status)} color={attColor(r.status)} />
                    </View>
                    {r.remarks ? (
                      <Body style={{ fontSize: 10.5, color: C.muted2, marginLeft: 14 }}>{r.remarks}</Body>
                    ) : null}
                  </View>
                ))}
              </View>
            </View>
          ))}
          {remaining > 0 ? (
            <Pressable onPress={() => setLimit((n) => n + 20)} style={{ alignItems: 'center', paddingVertical: 11, borderRadius: 12, backgroundColor: hexA(ACC, 0.08), borderWidth: 1, borderColor: hexA(ACC, 0.3) }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: ACC }}>Load more ({remaining} left)</Text>
            </Pressable>
          ) : null}
        </>
      )}

      {/* ---- Day detail sheet ---- */}
      <SheetShell
        visible={!!openDay}
        onClose={() => setOpenDay(null)}
        accent={ACC}
        icon="calendar"
        title={openDay ? prettyDate(openDay) : ''}
        subtitle={`${dayRows.length} APPROVED RECORD${dayRows.length === 1 ? '' : 'S'}`}
      >
        {dayRows.map((r) => (
          <View key={r.id} style={{ borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.28)', borderWidth: 1, borderColor: hexA(attColor(r.status), 0.25), padding: 13, gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
              <View style={{ flex: 1 }}>
                <Body numberOfLines={1} style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{r.batchLabel}</Body>
                <Mono style={{ fontSize: 8.5, color: C.muted3, marginTop: 2 }}>{r.sessionTime ? r.sessionTime.toUpperCase() : 'SESSION TIME NOT SET'}</Mono>
              </View>
              <Badge text={cap(r.status)} color={attColor(r.status)} />
            </View>
            {r.remarks ? (
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' }}>
                <Icon name="bubble" size={11} color={C.muted3} strokeWidth={2} />
                <Body style={{ flex: 1, fontSize: 11, color: C.ink3 }}>{r.remarks}</Body>
              </View>
            ) : null}
          </View>
        ))}
      </SheetShell>
    </View>
  );
}
