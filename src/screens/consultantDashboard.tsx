import React from 'react';
import { View, Text, Pressable, Modal, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import { F } from '../theme';
import { Icon } from '../icons';
import { useStore } from '../store';
import { useAuth } from '../auth';
import { useDoctorIdentity } from '../lib/doctorQueries';
import {
  useDoctorConsultationSlots, useConsultantConsultations, computeConsultantStats, dayCountsOf, ConsultationSlot, DiagnosisRow,
  sameDay, addDays, startOfWeekSun, dateFromYmd, ymdLocal, MONTHS_LONG, MONTHS_SHORT, DAYS_SHORT, DAYS_LONG, fmtStampLocal, slotPersonName,
} from '../lib/consultantQueries';
import { CX, INDIGO_GRAD, ConsultantShell, LCard, CardHead, SearchBox, SlotCard, DiagRow, useSlotActions, useNow, initialsOf, LightBtn, SlotActions } from '../components/consultantUi';

/* ============ CONSULTANT DASHBOARD (port of web ConsultantDashboard.tsx, 22 Sep 2026) ============
   Bookings (doctor_consultation_details) and medical_diagnosis requests naming
   the doctor, counted by the web's rules (computeConsultantStats): greeting,
   Scheduled and Consultations Done cards, today's donut, the overall bars,
   the profile card and a week calendar whose header opens the month view. */

/* ---------- small charts ---------- */
function Donut({ pct }: { pct: number }) {
  const size = 92, stroke = 9, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, pct));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill as any}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={CX.slate100} strokeWidth={stroke} fill="none" />
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={CX.indigo} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={`${c} ${c}`} strokeDashoffset={c * (1 - p / 100)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </Svg>
      <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: CX.slate800 }}>{Math.round(p)}%</Text>
      <Text style={{ fontFamily: F.bodyReg, fontSize: 9, color: CX.slate400 }}>busy</Text>
    </View>
  );
}
function PlanBar({ label, pct, colors }: { label: string; pct: number; colors: [string, string] }) {
  const p = Math.max(0, Math.min(100, pct));
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ fontFamily: F.body, fontSize: 12, color: CX.slate600 }}>{label}</Text>
        <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: CX.slate800 }}>{Math.round(p)}%</Text>
      </View>
      <View style={{ height: 8, borderRadius: 999, backgroundColor: CX.slate100, overflow: 'hidden' }}>
        <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ width: `${p}%`, height: '100%', borderRadius: 999 }} />
      </View>
    </View>
  );
}
function StatCard({ label, sub, value, icon, chipBg, iconColor }: { label: string; sub: string; value: number; icon: any; chipBg: string; iconColor: string }) {
  return (
    <LCard style={{ flex: 1 }} pad={14}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: chipBg, alignItems: 'center', justifyContent: 'center' }}><Icon name={icon} size={14} color={iconColor} strokeWidth={2.2} /></View>
        <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: CX.slate500, flex: 1 }}>{label}</Text>
      </View>
      <Text style={{ fontFamily: F.bodyBold, fontSize: 28, color: CX.slate900, marginTop: 8 }}>{value}</Text>
      <Text style={{ fontFamily: F.bodyReg, fontSize: 11, color: CX.slate400, marginTop: 2 }}>{sub}</Text>
    </LCard>
  );
}

/* ---------- day list (shared by the week card and the month view) ---------- */
function DayList({ day, slots, consultations, clientNames, search, loading, actions, now }: {
  day: Date; slots: ConsultationSlot[]; consultations: DiagnosisRow[]; clientNames: Record<string, string>; search: string; loading: boolean; actions: SlotActions; now: number;
}) {
  const q = search.trim().toLowerCase();
  const dayEvents = consultations
    .filter((d) => d.scheduled_at && sameDay(new Date(d.scheduled_at), day))
    .filter((d) => !q || (clientNames[d.client_id] ?? '').toLowerCase().includes(q) || (d.problem_statement ?? '').toLowerCase().includes(q))
    .sort((a, b) => (a.scheduled_at ?? '').localeCompare(b.scheduled_at ?? ''));
  const daySlots = slots
    .filter((s) => s.status !== 'cancelled' && sameDay(dateFromYmd(s.consultation_date), day))
    .filter((s) => !q || slotPersonName(s.client).toLowerCase().includes(q) || (s.description ?? '').toLowerCase().includes(q))
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
  if (loading) return <ActivityIndicator color={CX.slate400} style={{ paddingVertical: 18 }} />;
  if (dayEvents.length === 0 && daySlots.length === 0) {
    return <Text style={{ fontFamily: F.bodyReg, fontSize: 13, color: CX.slate400, textAlign: 'center', paddingVertical: 14 }}>{q ? 'No consultations match your search.' : 'No consultations this day.'}</Text>;
  }
  return (
    <View style={{ gap: 8 }}>
      {daySlots.map((s) => <SlotCard key={s.id} slot={s} actions={actions} now={now} />)}
      {dayEvents.map((e) => <DiagRow key={e.id} row={e} name={clientNames[e.client_id] ?? 'Client'} />)}
    </View>
  );
}

/* ---------- month view (port of ConsultantCalendarDialog.tsx) ---------- */
function CalendarMonthSheet({ visible, onClose, slots, consultations, clientNames, selectedDay, onSelectDay, actions, now }: {
  visible: boolean; onClose: () => void; slots: ConsultationSlot[]; consultations: DiagnosisRow[]; clientNames: Record<string, string>;
  selectedDay: Date; onSelectDay: (d: Date) => void; actions: SlotActions; now: number;
}) {
  const insets = useSafeAreaInsets();
  const today = new Date(now);
  const [month, setMonth] = React.useState(() => new Date(selectedDay.getFullYear(), selectedDay.getMonth(), 1));
  React.useEffect(() => { if (visible) setMonth(new Date(selectedDay.getFullYear(), selectedDay.getMonth(), 1)); }, [visible]);
  const counts = React.useMemo(() => dayCountsOf(slots, consultations, now), [slots, consultations, now]);
  const first = month;
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const offset = first.getDay();
  const cells = Math.ceil((offset + daysInMonth) / 7) * 7;
  const monthKey = ymdLocal(first).slice(0, 7);
  const totals = Object.entries(counts).filter(([k]) => k.startsWith(monthKey)).reduce((acc, [, c]) => ({ total: acc.total + c.total, done: acc.done + c.done, elapsed: acc.elapsed + c.elapsed, upcoming: acc.upcoming + c.upcoming }), { total: 0, done: 0, elapsed: 0, upcoming: 0 });
  const summary = totals.total === 0 ? 'No consultations this month' : [`${totals.total} consultation${totals.total === 1 ? '' : 's'}`, totals.done ? `${totals.done} done` : '', totals.upcoming ? `${totals.upcoming} upcoming` : '', totals.elapsed ? `${totals.elapsed} elapsed` : ''].filter(Boolean).join(' · ');
  const pillStyle = (c: { total: number; done: number; elapsed: number }) => c.elapsed > 0 ? { bg: CX.amber50, fg: CX.amber600 } : c.done === c.total ? { bg: CX.emerald50, fg: CX.emerald600 } : { bg: CX.indigo50, fg: CX.indigo };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15,23,42,0.45)' }} />
        <View accessibilityViewIsModal style={{ maxHeight: '92%', backgroundColor: CX.white, borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingBottom: insets.bottom + 12 }}>
          <View style={{ paddingHorizontal: 18, paddingTop: 14, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: CX.indigo100, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: CX.slate200, position: 'absolute', top: 6, left: '50%', marginLeft: -20 }} />
            <Text style={{ fontFamily: F.bodyBold, fontSize: 16, color: CX.slate900, flex: 1, marginTop: 6 }}>My Calendar</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close" style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: CX.slate100, alignItems: 'center', justifyContent: 'center', marginTop: 6 }}><Icon name="close" size={14} color={CX.slate600} strokeWidth={2.4} /></Pressable>
          </View>
          <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ padding: 18, gap: 14 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Pressable onPress={() => setMonth(new Date(first.getFullYear(), first.getMonth() - 1, 1))} hitSlop={8} accessibilityRole="button" accessibilityLabel="Previous month" style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: CX.slate100, alignItems: 'center', justifyContent: 'center' }}><Icon name="chevLeft" size={14} color={CX.slate600} strokeWidth={2.4} /></Pressable>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: CX.slate900 }}>{MONTHS_LONG[first.getMonth()]} {first.getFullYear()}</Text>
                <Text style={{ fontFamily: F.bodyReg, fontSize: 11, color: CX.slate500 }}>{summary}</Text>
              </View>
              <Pressable onPress={() => setMonth(new Date(first.getFullYear(), first.getMonth() + 1, 1))} hitSlop={8} accessibilityRole="button" accessibilityLabel="Next month" style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: CX.slate100, alignItems: 'center', justifyContent: 'center' }}><Icon name="chevRight" size={14} color={CX.slate600} strokeWidth={2.4} /></Pressable>
              <Pressable onPress={() => { setMonth(new Date(today.getFullYear(), today.getMonth(), 1)); onSelectDay(today); }} accessibilityRole="button" style={{ height: 32, paddingHorizontal: 10, borderRadius: 10, backgroundColor: CX.indigo50, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: CX.indigo }}>Today</Text></Pressable>
            </View>
            <View style={{ flexDirection: 'row' }}>
              {DAYS_SHORT.map((d) => <Text key={d} style={{ flex: 1, textAlign: 'center', fontFamily: F.bodyBold, fontSize: 9.5, letterSpacing: 0.6, color: CX.slate400, textTransform: 'uppercase' }}>{d}</Text>)}
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {Array.from({ length: cells }, (_, i) => {
                const dayNum = i - offset + 1;
                if (dayNum < 1 || dayNum > daysInMonth) return <View key={i} style={{ width: `${100 / 7}%`, height: 54 }} />;
                const d = new Date(first.getFullYear(), first.getMonth(), dayNum);
                const active = sameDay(d, selectedDay);
                const isToday = sameDay(d, today);
                const c = counts[ymdLocal(d)];
                const ps = c ? pillStyle(c) : null;
                return (
                  <Pressable key={i} onPress={() => onSelectDay(d)} accessibilityRole="button" accessibilityLabel={`${dayNum} ${MONTHS_LONG[first.getMonth()]}`} accessibilityState={{ selected: active }}
                    style={{ width: `${100 / 7}%`, height: 54, padding: 2 }}>
                    <View style={{ flex: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center', gap: 3, backgroundColor: active ? CX.indigo : isToday ? CX.indigo50 : 'transparent' }}>
                      <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: active ? '#fff' : isToday ? CX.indigo : CX.slate700 }}>{dayNum}</Text>
                      {c ? <View style={{ minWidth: 18, paddingHorizontal: 5, borderRadius: 999, backgroundColor: active ? 'rgba(255,255,255,0.25)' : ps!.bg }}><Text style={{ fontFamily: F.bodyBold, fontSize: 9, textAlign: 'center', color: active ? '#fff' : ps!.fg }}>{c.total}</Text></View> : <View style={{ height: 13 }} />}
                    </View>
                  </Pressable>
                );
              })}
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
              {[[CX.indigoB, 'Upcoming'], ['#34d399', 'All done'], ['#fbbf24', 'Elapsed, not completed']].map(([col, lab]) => (
                <View key={lab} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}><View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: col }} /><Text style={{ fontFamily: F.bodyReg, fontSize: 10.5, color: CX.slate500 }}>{lab}</Text></View>
              ))}
            </View>
            <View style={{ borderTopWidth: 1, borderTopColor: CX.slate100, paddingTop: 12, gap: 8 }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 10.5, letterSpacing: 0.8, textTransform: 'uppercase', color: CX.slate400 }}>{DAYS_LONG[selectedDay.getDay()]}, {selectedDay.getDate()} {MONTHS_SHORT[selectedDay.getMonth()]}</Text>
              <DayList day={selectedDay} slots={slots} consultations={consultations} clientNames={clientNames} search="" loading={false} actions={actions} now={now} />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/* ---------- the page ---------- */
export function ConsultantDashboard() {
  const { session } = useAuth();
  const { go } = useStore();
  const uid = session?.user?.id ?? null;
  const ident = useDoctorIdentity();
  const doctorName = ident.data.fullName;
  const consultQ = useConsultantConsultations(doctorName);
  const slotsQ = useDoctorConsultationSlots(uid);
  const nowDate = useNow(60_000);
  const now = nowDate.getTime();
  const actions = useSlotActions();
  const [selectedDay, setSelectedDay] = React.useState<Date>(() => new Date());
  const [search, setSearch] = React.useState('');
  const [calendarOpen, setCalendarOpen] = React.useState(false);

  const slots = slotsQ.data ?? [];
  const consultations = consultQ.data?.consultations ?? [];
  const clientNames = consultQ.data?.clientNames ?? {};
  const stats = React.useMemo(() => computeConsultantStats(slots, consultations, nowDate), [slots, consultations, nowDate]);
  const activeSlots = slots.filter((s) => s.status !== 'cancelled');
  const weekStart = startOfWeekSun(selectedDay);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const firstName = ident.data.firstName || 'Doctor';
  const initials = `${(ident.data.firstName || ' ')[0] ?? ''}${(ident.data.lastName || ' ')[0] ?? ''}`.trim().toUpperCase() || 'D';
  const loading = (slotsQ.isPending && !!uid) || (consultQ.isPending && doctorName.trim().length > 0);

  return (
    <ConsultantShell active="dashboard">
      {/* top bar: search + bell */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <SearchBox value={search} onChange={setSearch} placeholder="Search events, patients etc." />
        <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: CX.white, alignItems: 'center', justifyContent: 'center', shadowColor: '#4f5bd5', shadowOpacity: 0.12, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 2 }} accessibilityLabel={stats.pendingCount > 0 ? `${stats.pendingCount} pending` : 'Nothing pending'}>
          <Icon name="bell" size={18} color={CX.slate500} strokeWidth={2} />
          {stats.pendingCount > 0 ? <View style={{ position: 'absolute', top: 11, right: 12, width: 8, height: 8, borderRadius: 4, backgroundColor: CX.rose, borderWidth: 2, borderColor: '#fff' }} /> : null}
        </View>
      </View>

      {/* greeting banner */}
      <View style={{ borderRadius: 28, overflow: 'hidden', shadowColor: CX.indigo, shadowOpacity: 0.35, shadowRadius: 20, shadowOffset: { width: 0, height: 14 }, elevation: 6 }}>
        <LinearGradient colors={[CX.indigo, CX.indigoMid, CX.indigoB]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ padding: 22 }}>
          <View pointerEvents="none" style={{ position: 'absolute', right: -32, top: -32, width: 160, height: 160, borderRadius: 80, backgroundColor: 'rgba(255,255,255,0.1)' }} />
          <View pointerEvents="none" style={{ position: 'absolute', right: 64, bottom: -30, width: 96, height: 96, borderRadius: 48, backgroundColor: 'rgba(255,255,255,0.1)' }} />
          <View pointerEvents="none" style={{ position: 'absolute', right: 26, top: '38%' }}><Icon name="heart" size={64} color="rgba(255,255,255,0.15)" strokeWidth={1.6} /></View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
            <Icon name="calendar" size={11} color="#fff" strokeWidth={2.2} />
            <Text style={{ fontFamily: F.body, fontSize: 11, color: '#fff' }}>{fmtStampLocal(nowDate)}</Text>
          </View>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 24, color: '#fff', marginTop: 12 }}>Good Day, {doctorName || firstName}!</Text>
          <Text style={{ fontFamily: F.bodyReg, fontSize: 13, color: 'rgba(255,255,255,0.8)', marginTop: 3 }}>Have a nice {DAYS_LONG[nowDate.getDay()]}!</Text>
        </LinearGradient>
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
        <LightBtn label="Reimbursement" icon="rupee" tone="outline" onPress={() => go('doctor-reimbursements')} />
      </View>

      {slotsQ.isError ? (
        <LCard pad={14}>
          <Text style={{ fontFamily: F.body, fontSize: 12.5, color: CX.rose600 }}>Could not load your bookings. Pull down to retry.</Text>
        </LCard>
      ) : null}

      {/* stat cards */}
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <StatCard label="Scheduled" value={stats.scheduledCount} sub={stats.elapsedCount > 0 ? `upcoming · ${stats.elapsedCount} elapsed, not completed` : 'upcoming consultations'} icon="calendar" chipBg={CX.indigo100} iconColor={CX.indigo} />
        <StatCard label="Consultations Done" value={stats.completedThisMonth} sub="this month" icon="checks" chipBg={CX.emerald100} iconColor={CX.emerald} />
      </View>

      {/* scheduled events + plans done */}
      <LCard>
        <CardHead title="My Scheduled Events" chip="Today" />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
          <Donut pct={stats.busyness} />
          <View style={{ gap: 10 }}>
            <View><Text style={{ fontFamily: F.bodyBold, fontSize: 20, color: CX.slate800 }}>{stats.todayTotal}</Text><Text style={{ fontFamily: F.bodyReg, fontSize: 11.5, color: CX.slate400 }}>Consultations today</Text></View>
            <View><Text style={{ fontFamily: F.bodyBold, fontSize: 20, color: CX.slate800 }}>{stats.todayDone}</Text><Text style={{ fontFamily: F.bodyReg, fontSize: 11.5, color: CX.slate400 }}>Completed today</Text></View>
          </View>
        </View>
      </LCard>
      <LCard>
        <CardHead title="My Plans Done" chip="Overall" />
        <View style={{ gap: 14 }}>
          <PlanBar label="Consultations completed" pct={(stats.completedCount / stats.total) * 100} colors={INDIGO_GRAD} />
          <PlanBar label="Scheduled" pct={(stats.scheduledCount / stats.total) * 100} colors={[CX.pink400, CX.pink500]} />
          {stats.elapsedCount > 0 ? <PlanBar label="Elapsed, not completed" pct={(stats.elapsedCount / stats.total) * 100} colors={['#fbbf24', CX.amber]} /> : null}
          {stats.pendingRequests > 0 ? <PlanBar label="Pending requests" pct={(stats.pendingRequests / stats.total) * 100} colors={[CX.slate300, CX.slate400]} /> : null}
        </View>
      </LCard>

      {/* profile */}
      <LCard pad={0} style={{ overflow: 'hidden' }}>
        <LinearGradient colors={INDIGO_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ paddingHorizontal: 16, paddingVertical: 10 }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 10.5, letterSpacing: 1, color: '#fff' }}>MY PROFILE</Text>
        </LinearGradient>
        <View style={{ padding: 16, gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ width: 54, height: 54, borderRadius: 27, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
              <LinearGradient colors={INDIGO_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill as any} />
              <Text style={{ fontFamily: F.bodyBold, fontSize: 18, color: '#fff' }}>{initials}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ fontFamily: F.bodySemi, fontSize: 15, color: CX.slate800 }}>{doctorName || 'Doctor'}</Text>
              <Text numberOfLines={1} style={{ fontFamily: F.bodyBold, fontSize: 10.5, letterSpacing: 0.9, textTransform: 'uppercase', color: CX.indigo, marginTop: 2 }}>{ident.data.specializations || 'Consultant'}</Text>
            </View>
          </View>
          <View style={{ gap: 6 }}>
            {ident.data.email ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Icon name="send" size={13} color="rgba(91,108,245,0.6)" strokeWidth={2} /><Text numberOfLines={1} style={{ fontFamily: F.bodyReg, fontSize: 13, color: CX.slate500, flex: 1 }}>{ident.data.email}</Text></View> : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Icon name="activity" size={13} color="rgba(91,108,245,0.6)" strokeWidth={2} /><Text style={{ fontFamily: F.bodyReg, fontSize: 13, color: CX.slate500 }}>{stats.activeTotal} total consultations</Text></View>
          </View>
        </View>
      </LCard>

      {/* calendar: header opens the month view */}
      <LCard pad={0} style={{ overflow: 'hidden' }}>
        <Pressable onPress={() => setCalendarOpen(true)} accessibilityRole="button" accessibilityLabel="Open the month view" style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1 })}>
          <LinearGradient colors={INDIGO_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 10.5, letterSpacing: 1, color: '#fff' }}>MY CALENDAR</Text>
              <Icon name="swap" size={11} color="rgba(255,255,255,0.85)" strokeWidth={2.2} />
            </View>
            <Text style={{ fontFamily: F.body, fontSize: 11, color: 'rgba(255,255,255,0.85)' }}>{MONTHS_LONG[selectedDay.getMonth()]}</Text>
          </LinearGradient>
        </Pressable>
        <View style={{ padding: 12, gap: 12 }}>
          <View style={{ flexDirection: 'row', gap: 4 }}>
            {weekDays.map((d) => {
              const active = sameDay(d, selectedDay);
              const isToday = sameDay(d, nowDate);
              return (
                <Pressable key={d.toISOString()} onPress={() => setSelectedDay(d)} accessibilityRole="button" accessibilityLabel={`${DAYS_LONG[d.getDay()]} ${d.getDate()}`} accessibilityState={{ selected: active }}
                  style={{ flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: 12, backgroundColor: active ? CX.indigo : 'transparent' }}>
                  <Text style={{ fontFamily: F.bodyReg, fontSize: 9.5, textTransform: 'uppercase', color: active ? 'rgba(255,255,255,0.8)' : CX.slate400 }}>{DAYS_SHORT[d.getDay()]}</Text>
                  <Text style={{ fontFamily: F.bodySemi, fontSize: 14, color: active ? '#fff' : isToday ? CX.indigo : CX.slate700, marginTop: 2 }}>{d.getDate()}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={{ borderTopWidth: 1, borderTopColor: CX.slate100, paddingTop: 12, gap: 8 }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 10.5, letterSpacing: 0.8, textTransform: 'uppercase', color: CX.slate400 }}>{MONTHS_LONG[selectedDay.getMonth()]} {selectedDay.getDate()}</Text>
            <DayList day={selectedDay} slots={slots} consultations={consultations} clientNames={clientNames} search={search} loading={loading} actions={actions} now={now} />
          </View>
        </View>
      </LCard>

      <CalendarMonthSheet visible={calendarOpen} onClose={() => setCalendarOpen(false)} slots={activeSlots} consultations={consultations} clientNames={clientNames}
        selectedDay={selectedDay} onSelectDay={setSelectedDay} actions={actions} now={now} />
    </ConsultantShell>
  );
}
