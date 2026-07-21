import React from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator, Alert, Keyboard } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C, F, hexA, ORANGE_GRAD } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono } from '../components/primitives';
import { Page, Badge, MiniAvatar, AnimChip, HScroll, TimeDial } from './common';
import { useAuth } from '../auth';
import {
  useMonthRoster, useRosterPeople, useBulkCreateRoster, useRescheduleRosterSession,
  useCancelRosterSession, useDeleteFutureSessions, useInferRoster, MODALITIES, modalityColor, RosterSession, RosterConflict,
} from '../lib/rosterQueries';
import { SheetShell } from './reportDetail';

/* ============ CRM: Roster Management — live month agenda over session_schedule
   + the web's "Create Roster" bulk flow with identical conflict rules. ============ */

const initials = (n: string) => n.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
const AVS: [string, string][] = [['#F0883E', '#C05621'], ['#4FD1C5', '#2C7A7B'], ['#B794F4', '#6B46C1'], ['#F687B3', '#B83280'], ['#68D391', '#276749'], ['#63B3ED', '#2B6CB0']];
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase();
const dayKey = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const dayLabel = (key: string) => new Date(key + 'T00:00:00').toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: '2-digit', month: 'short' });

const INPUT = {
  paddingVertical: 9, paddingHorizontal: 11, borderRadius: 11,
  borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', backgroundColor: 'rgba(0,0,0,0.25)',
  color: '#fff', fontFamily: F.body, fontSize: 13.5,
} as const;

/* ---------- Picker sheet: choose a trainer or client filter ---------- */
function FilterPickerSheet({ visible, title, options, selectedId, onPick, onClose }: {
  visible: boolean; title: string; options: { id: string; name: string; n?: number }[];
  selectedId: string | null; onPick: (id: string | null) => void; onClose: () => void;
}) {
  const [q, setQ] = React.useState('');
  React.useEffect(() => { if (visible) setQ(''); }, [visible]);
  const query = q.trim().toLowerCase();
  const list = options.filter((o) => !query || o.name.toLowerCase().includes(query));
  return (
    <SheetShell visible={visible} onClose={onClose} accent={C.orange} icon="users" title={title} subtitle={`${options.length} AVAILABLE`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 10, paddingHorizontal: 13, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
        <Icon name="search" size={14} color={C.muted3} strokeWidth={2} />
        <TextInput value={q} onChangeText={setQ} placeholder="Search…" placeholderTextColor={C.muted3} autoCorrect={false} style={{ flex: 1, fontFamily: F.body, fontSize: 13.5, color: '#fff', padding: 0 }} />
      </View>
      <Pressable onPress={() => { Keyboard.dismiss(); onPick(null); onClose(); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 13, backgroundColor: !selectedId ? hexA(C.orange, 0.1) : 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: !selectedId ? hexA(C.orange, 0.45) : 'rgba(255,255,255,0.07)' }}>
        <Icon name="users" size={15} color={!selectedId ? C.orange : C.muted} strokeWidth={2} />
        <Body style={{ flex: 1, fontSize: 13.5, fontFamily: F.bodySemi, color: !selectedId ? C.orange : '#fff' }}>Everyone</Body>
        {!selectedId ? <Icon name="checks" size={14} color={C.orange} strokeWidth={2.5} /> : null}
      </Pressable>
      {list.slice(0, 40).map((o, i) => {
        const active = selectedId === o.id;
        return (
          <Pressable key={o.id} onPress={() => { Keyboard.dismiss(); onPick(o.id); onClose(); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 11, borderRadius: 13, backgroundColor: active ? hexA(C.orange, 0.1) : 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: active ? hexA(C.orange, 0.45) : 'rgba(255,255,255,0.07)' }}>
            <MiniAvatar initial={initials(o.name)} colors={AVS[i % AVS.length]} size={32} />
            <Body numberOfLines={1} style={{ flex: 1, fontSize: 13, fontFamily: F.bodySemi, color: '#fff' }}>{o.name}</Body>
            {o.n != null ? <Mono style={{ fontSize: 8.5, color: C.muted3 }}>{o.n}</Mono> : null}
            {active ? <Icon name="checks" size={14} color={C.orange} strokeWidth={2.5} /> : null}
          </Pressable>
        );
      })}
    </SheetShell>
  );
}

export function CrmRoster() {
  const { session } = useAuth();
  const crmId = session?.user?.id ?? null;
  const [monthOffset, setMonthOffset] = React.useState(0);
  const [trainerId, setTrainerId] = React.useState<string | null>(null);
  const [clientId, setClientId] = React.useState<string | null>(null);
  const [view, setView] = React.useState<'calendar' | 'agenda'>('calendar');
  const [selectedDay, setSelectedDay] = React.useState<string | null>(null);
  const [dayLimit, setDayLimit] = React.useState(7);
  const [pickTrainer, setPickTrainer] = React.useState(false);
  const [pickClient, setPickClient] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [selected, setSelected] = React.useState<RosterSession | null>(null);

  const rosterQ = useMonthRoster(crmId, monthOffset, trainerId);
  const peopleQ = useRosterPeople(crmId);
  const all = rosterQ.data?.sessions ?? [];
  const sessions = clientId ? all.filter((s) => s.clientId === clientId) : all;

  const todayKey = dayKey(new Date().toISOString());
  const now = new Date();
  const base = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);

  // Sessions grouped by day.
  const byDay = React.useMemo(() => {
    const m = new Map<string, RosterSession[]>();
    sessions.forEach((s) => m.set(dayKey(s.when), [...(m.get(dayKey(s.when)) ?? []), s]));
    return m;
  }, [sessions]);

  // Calendar weeks for the month (Monday-first).
  const weeks = React.useMemo(() => {
    const first = new Date(base.getFullYear(), base.getMonth(), 1);
    const daysInMonth = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
    const lead = (first.getDay() + 6) % 7;
    const cells: (string | null)[] = Array(lead).fill(null);
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push(`${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    }
    while (cells.length % 7) cells.push(null);
    const out: (string | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7));
    return out;
  }, [monthOffset]);

  // Default selected day: today (current month) else first day with sessions.
  React.useEffect(() => {
    if (monthOffset === 0) setSelectedDay(todayKey);
    else setSelectedDay([...byDay.keys()].sort()[0] ?? null);
    setDayLimit(7);
  }, [monthOffset, rosterQ.data?.monthLabel]);

  const scheduled = sessions.filter((s) => !s.cancelled).length;
  const cancelled = sessions.filter((s) => s.cancelled).length;

  // Progress for the focused day — the selected calendar day (agenda view falls
  // back to today). Respects the active trainer/client filter.
  const statDay = view === 'calendar' && selectedDay ? selectedDay : todayKey;
  const statDayIsToday = statDay === todayKey;
  const statSessions = sessions.filter((s) => dayKey(s.when) === statDay && !s.cancelled);
  const dayTotal = statSessions.length;
  const dayDone = statSessions.filter((s) => s.completed).length;
  const dayPct = dayTotal ? Math.round((dayDone / dayTotal) * 100) : 0;
  const statDayLabel = statDayIsToday ? 'TODAY' : new Date(statDay + 'T00:00:00').toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' }).toUpperCase();

  const trainerName = trainerId ? (peopleQ.data?.trainers.find((t) => t.id === trainerId)?.name ?? peopleQ.data?.doctors.find((t) => t.id === trainerId)?.name ?? 'Trainer') : null;
  const clientName = clientId ? (peopleQ.data?.clients.find((c) => c.id === clientId)?.name ?? 'Client') : null;

  // Picker options with month session counts (from unfiltered month data).
  const trainerOptions = React.useMemo(() => {
    const counts = new Map<string, number>();
    all.forEach((s) => { if (s.trainerId) counts.set(s.trainerId, (counts.get(s.trainerId) ?? 0) + 1); });
    const pool = [...(peopleQ.data?.trainers ?? []), ...(peopleQ.data?.doctors ?? [])];
    return pool.map((t) => ({ ...t, n: counts.get(t.id) ?? 0 })).sort((a, b) => (b.n ?? 0) - (a.n ?? 0) || a.name.localeCompare(b.name));
  }, [all, peopleQ.data]);
  const clientOptions = React.useMemo(() => {
    const counts = new Map<string, number>();
    all.forEach((s) => counts.set(s.clientId, (counts.get(s.clientId) ?? 0) + 1));
    return (peopleQ.data?.clients ?? []).map((c) => ({ ...c, n: counts.get(c.id) ?? 0 })).sort((a, b) => (b.n ?? 0) - (a.n ?? 0) || a.name.localeCompare(b.name));
  }, [all, peopleQ.data]);

  const daySessions = selectedDay ? (byDay.get(selectedDay) ?? []) : [];
  const agendaDays = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).filter(([k]) => monthOffset !== 0 || k >= todayKey);

  const SessionRow = ({ s, i }: { s: RosterSession; i: number }) => {
    const col = modalityColor(s.modality);
    return (
      <Pressable onPress={() => setSelected(s)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12, borderTopWidth: i ? 1 : 0, borderTopColor: 'rgba(255,255,255,0.05)', opacity: s.cancelled ? 0.55 : 1 }}>
        <View style={{ width: 58 }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 11.5, color: s.cancelled ? C.muted3 : '#fff' }}>{timeOf(s.when)}</Text>
        </View>
        <View style={{ width: 3, alignSelf: 'stretch', borderRadius: 2, backgroundColor: hexA(col, s.cancelled ? 0.3 : 0.8) }} />
        <View style={{ flex: 1 }}>
          <Body numberOfLines={1} style={{ fontSize: 13, fontFamily: F.bodySemi, color: s.cancelled ? C.muted2 : '#fff', textDecorationLine: s.cancelled ? 'line-through' : 'none' }}>{s.clientName}</Body>
          <Mono style={{ fontSize: 7.5, color: C.muted3, marginTop: 2 }} numberOfLines={1}>{(s.modality ?? 'SESSION').toUpperCase()} · {s.trainerName.toUpperCase()}</Mono>
        </View>
        {s.hasRescheduleReq && !s.cancelled ? <Badge text="Resched" color={C.gold} /> : null}
        {s.cancelled
          ? <Badge text="Cancelled" color={C.red} />
          : <Badge text={s.completed ? 'Completed' : 'Pending'} color={s.completed ? C.green : C.gold} />}
        <Icon name="chevRight" size={13} color={C.muted3} strokeWidth={2.2} />
      </Pressable>
    );
  };

  return (
    <Page gap={13} pt={6}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Serif style={{ fontSize: 24 }}>Roster Management</Serif>
          <Body style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>Every scheduled session across your book</Body>
        </View>
        <Pressable onPress={() => setCreateOpen(true)}>
          <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12 }}>
            <Icon name="calPlus" size={13} color="#fff" strokeWidth={2.4} />
            <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: '#fff' }}>Create Roster</Text>
          </LinearGradient>
        </Pressable>
      </View>

      {/* Filter pickers */}
      <View style={{ flexDirection: 'row', gap: 7 }}>
        <Pressable onPress={() => setPickTrainer(true)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, backgroundColor: trainerId ? hexA(C.blue, 0.12) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: trainerId ? hexA(C.blue, 0.45) : 'rgba(255,255,255,0.09)' }}>
          <Icon name="user" size={13} color={trainerId ? C.blue : C.muted3} strokeWidth={2.1} />
          <Body numberOfLines={1} style={{ flex: 1, fontSize: 12, fontFamily: trainerId ? F.bodySemi : F.body, color: trainerId ? C.blue : C.muted }}>{trainerName ?? 'All trainers'}</Body>
          {trainerId ? (
            <Pressable onPress={() => setTrainerId(null)} hitSlop={8}><Icon name="close" size={12} color={C.blue} strokeWidth={2.5} /></Pressable>
          ) : <Icon name="chevDown" size={12} color={C.muted3} strokeWidth={2.2} />}
        </Pressable>
        <Pressable onPress={() => setPickClient(true)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, backgroundColor: clientId ? hexA(C.gold, 0.12) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: clientId ? hexA(C.gold, 0.45) : 'rgba(255,255,255,0.09)' }}>
          <Icon name="users" size={13} color={clientId ? C.gold : C.muted3} strokeWidth={2.1} />
          <Body numberOfLines={1} style={{ flex: 1, fontSize: 12, fontFamily: clientId ? F.bodySemi : F.body, color: clientId ? C.gold : C.muted }}>{clientName ?? 'All clients'}</Body>
          {clientId ? (
            <Pressable onPress={() => setClientId(null)} hitSlop={8}><Icon name="close" size={12} color={C.gold} strokeWidth={2.5} /></Pressable>
          ) : <Icon name="chevDown" size={12} color={C.muted3} strokeWidth={2.2} />}
        </Pressable>
      </View>

      {/* Month pager + view toggle */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Pressable onPress={() => setMonthOffset(monthOffset - 1)} hitSlop={8} style={{ width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
          <Icon name="chevLeft" size={15} color={C.muted} strokeWidth={2.3} />
        </Pressable>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Body style={{ fontSize: 14.5, fontFamily: F.bodySemi, color: '#fff' }}>{rosterQ.data?.monthLabel ?? '…'}</Body>
          <Mono style={{ fontSize: 8, color: C.muted3, marginTop: 2 }}>
            {rosterQ.isLoading ? 'LOADING…' : `${scheduled} SCHEDULED · ${cancelled} CANCELLED`}
          </Mono>
        </View>
        <Pressable onPress={() => setMonthOffset(monthOffset + 1)} hitSlop={8} style={{ width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
          <Icon name="chevRight" size={15} color={C.muted} strokeWidth={2.3} />
        </Pressable>
        <View style={{ flexDirection: 'row', gap: 4, padding: 3, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.28)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' }}>
          {([['calendar', 'calendar'], ['agenda', 'list']] as const).map(([id, icon]) => {
            const active = view === id;
            return (
              <Pressable key={id} onPress={() => setView(id)} style={{ width: 32, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: active ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                {active ? <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} /> : null}
                <Icon name={icon as any} size={14} color={active ? '#fff' : C.muted2} strokeWidth={2.2} />
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Day progress — scheduled, done and % complete for the selected day */}
      {!rosterQ.isLoading && (view === 'calendar' ? !!selectedDay : monthOffset === 0) ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', borderRadius: 16, backgroundColor: 'rgba(24,17,14,0.6)', borderWidth: 1, borderColor: hexA(C.orange, 0.18), overflow: 'hidden' }}>
          <LinearGradient colors={[hexA(C.orange, 0.5), 'rgba(255,255,255,0.02)']} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={{ width: 3, alignSelf: 'stretch' }} />
          {([[statDayLabel, dayTotal, '#fff'], ['DONE', dayDone, C.green], ['COMPLETE', `${dayPct}%`, dayPct >= 70 ? C.green : dayPct >= 40 ? C.gold : C.orange]] as [string, string | number, string][]).map(([lab, val, col], i) => (
            <View key={lab} style={{ flex: 1, alignItems: 'center', paddingVertical: 12, gap: 3, borderLeftWidth: i ? 1 : 0, borderLeftColor: 'rgba(255,255,255,0.06)' }}>
              <Text style={{ fontFamily: F.serif, fontSize: 22, color: col }}>{val}</Text>
              <Mono style={{ fontSize: 8, letterSpacing: 1, color: C.muted3 }}>{lab}</Mono>
            </View>
          ))}
        </View>
      ) : null}

      {rosterQ.isLoading ? (
        <View style={{ alignItems: 'center', gap: 8, paddingVertical: 30 }}>
          <ActivityIndicator color={C.orange} />
          <Body style={{ fontSize: 12.5, color: C.muted3 }}>Loading roster…</Body>
        </View>
      ) : view === 'calendar' ? (
        <>
          {/* Month calendar grid */}
          <View style={{ borderRadius: 17, backgroundColor: 'rgba(24,17,14,0.55)', borderWidth: 1, borderColor: 'rgba(255,150,90,0.12)', overflow: 'hidden' }}>
            <LinearGradient colors={[hexA(C.orange, 0.45), 'rgba(255,255,255,0.02)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 2.5 }} />
            <View style={{ flexDirection: 'row', paddingTop: 10, paddingHorizontal: 6 }}>
              {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
                <Mono key={i} style={{ flex: 1, textAlign: 'center', fontSize: 8.5, letterSpacing: 0.5, color: C.muted3 }}>{d}</Mono>
              ))}
            </View>
            <View style={{ padding: 6, gap: 4 }}>
              {weeks.map((week, wi) => (
                <View key={wi} style={{ flexDirection: 'row', gap: 4 }}>
                  {week.map((key, di) => {
                    if (!key) return <View key={di} style={{ flex: 1, aspectRatio: 0.86 }} />;
                    const rows = byDay.get(key) ?? [];
                    const live = rows.filter((s) => !s.cancelled);
                    const isSel = selectedDay === key;
                    const isToday = key === todayKey;
                    const dayNum = Number(key.slice(8));
                    return (
                      <Pressable key={di} onPress={() => setSelectedDay(key)} style={{ flex: 1, aspectRatio: 0.86, borderRadius: 10, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', gap: 3, backgroundColor: isSel ? 'transparent' : rows.length ? 'rgba(255,255,255,0.035)' : 'transparent', borderWidth: 1, borderColor: isSel ? 'transparent' : isToday ? hexA(C.orange, 0.55) : 'transparent' }}>
                        {isSel ? <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} /> : null}
                        <Text style={{ fontFamily: isSel || isToday ? F.bodyBold : F.bodySemi, fontSize: 12.5, color: isSel ? '#fff' : rows.length ? '#fff' : C.muted3 }}>{dayNum}</Text>
                        {live.length ? (
                          <View style={{ flexDirection: 'row', gap: 2, alignItems: 'center' }}>
                            {live.slice(0, 3).map((s, si) => (
                              <View key={si} style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: isSel ? '#fff' : modalityColor(s.modality) }} />
                            ))}
                            {live.length > 3 ? <Text style={{ fontFamily: F.mono, fontSize: 7, color: isSel ? '#fff' : C.muted2 }}>+{live.length - 3}</Text> : null}
                          </View>
                        ) : rows.length ? (
                          <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: isSel ? '#fff' : hexA(C.red, 0.6) }} />
                        ) : <View style={{ height: 4 }} />}
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </View>
          </View>

          {/* Selected day sessions */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 2 }}>
            <Mono style={{ fontSize: 9, letterSpacing: 1.2, color: selectedDay === todayKey ? C.orange : '#8A6A4E' }}>
              {selectedDay ? `${selectedDay === todayKey ? 'TODAY · ' : ''}${dayLabel(selectedDay).toUpperCase()}` : 'PICK A DAY'}
            </Mono>
            <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.05)' }} />
            <Mono style={{ fontSize: 9, color: C.muted3 }}>{daySessions.length} SESSION{daySessions.length === 1 ? '' : 'S'}</Mono>
          </View>
          {daySessions.length === 0 ? (
            <View style={{ alignItems: 'center', gap: 8, paddingVertical: 22 }}>
              <Icon name="calendar" size={22} color={C.muted3} strokeWidth={1.8} />
              <Body style={{ fontSize: 12, color: C.muted2 }}>Nothing scheduled this day.</Body>
            </View>
          ) : (
            <View style={{ borderRadius: 16, backgroundColor: 'rgba(24,17,14,0.55)', borderWidth: 1, borderColor: 'rgba(255,150,90,0.1)', overflow: 'hidden' }}>
              {daySessions.map((s, i) => <SessionRow key={s.id} s={s} i={i} />)}
            </View>
          )}
        </>
      ) : (
        <>
          {agendaDays.length === 0 ? (
            <View style={{ alignItems: 'center', gap: 9, paddingVertical: 28 }}>
              <Icon name="calendar" size={26} color={C.muted3} strokeWidth={1.8} />
              <Body style={{ fontSize: 12.5, color: C.muted2 }}>No sessions match.</Body>
            </View>
          ) : (
            <>
              {agendaDays.slice(0, dayLimit).map(([key, rows]) => (
                <View key={key} style={{ gap: 7 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 2 }}>
                    <Mono style={{ fontSize: 9, letterSpacing: 1.2, color: key === todayKey ? C.orange : '#8A6A4E' }}>
                      {key === todayKey ? 'TODAY · ' : ''}{dayLabel(key).toUpperCase()}
                    </Mono>
                    <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.05)' }} />
                    <Mono style={{ fontSize: 9, color: C.muted3 }}>{rows.length}</Mono>
                  </View>
                  <View style={{ borderRadius: 16, backgroundColor: 'rgba(24,17,14,0.55)', borderWidth: 1, borderColor: key === todayKey ? hexA(C.orange, 0.2) : 'rgba(255,150,90,0.1)', overflow: 'hidden' }}>
                    {rows.map((s, i) => <SessionRow key={s.id} s={s} i={i} />)}
                  </View>
                </View>
              ))}
              {agendaDays.length > dayLimit ? (
                <Pressable onPress={() => setDayLimit(dayLimit + 7)} style={{ alignItems: 'center', paddingVertical: 11, borderRadius: 12, backgroundColor: hexA(C.orange, 0.08), borderWidth: 1, borderColor: hexA(C.orange, 0.3) }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: C.orange }}>Show More Days ({agendaDays.length - dayLimit} left)</Text>
                </Pressable>
              ) : null}
            </>
          )}
        </>
      )}

      <FilterPickerSheet visible={pickTrainer} title="Filter by Trainer" options={trainerOptions} selectedId={trainerId} onPick={setTrainerId} onClose={() => setPickTrainer(false)} />
      <FilterPickerSheet visible={pickClient} title="Filter by Client" options={clientOptions} selectedId={clientId} onPick={setClientId} onClose={() => setPickClient(false)} />
      <CreateRosterSheet visible={createOpen} onClose={() => setCreateOpen(false)} crmId={crmId} people={peopleQ.data} />
      <SessionActionSheet session={selected} crmId={crmId} onClose={() => setSelected(null)} />
    </Page>
  );
}
/* ================= Session actions: reschedule / cancel / wipe future ================= */
export function SessionActionSheet({ session, crmId, onClose }: { session: RosterSession | null; crmId: string | null; onClose: () => void }) {
  const reschedM = useRescheduleRosterSession();
  const cancelM = useCancelRosterSession();
  const wipeM = useDeleteFutureSessions();
  const [mode, setMode] = React.useState<'menu' | 'reschedule' | 'cancel'>('menu');
  const [dayOffset, setDayOffset] = React.useState(1);
  const [time, setTime] = React.useState('10:00');
  const [remark, setRemark] = React.useState('');
  const [canceledBy, setCanceledBy] = React.useState<'Client' | 'Trainer'>('Client');
  React.useEffect(() => { if (session) { setMode('menu'); setRemark(''); setCanceledBy('Client'); } }, [session?.id]);

  if (!session) return <SheetShell visible={false} onClose={onClose} accent={C.orange} icon="calendar" title="" >{null}</SheetShell>;
  const col = modalityColor(session.modality);

  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(Date.now() + i * 864e5);
    return { offset: i, label: i === 0 ? 'Today' : d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short' }), date: d.getDate(), iso: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` };
  });

  const doReschedule = async (force = false) => {
    const day = days.find((d) => d.offset === dayOffset)!;
    try {
      await reschedM.mutateAsync({ id: session.id, clientId: session.clientId, trainerId: session.trainerId, newDateTime: `${day.iso}T${time}:00`, force });
      onClose();
    } catch (e: any) {
      if (e?.message === 'TRAINER_OVERLAP') {
        Alert.alert('Trainer is booked', 'The trainer already has a session within an hour of that slot.', [
          { text: 'Pick another slot', style: 'cancel' },
          { text: 'Force anyway', style: 'destructive', onPress: () => doReschedule(true) },
        ]);
      } else Alert.alert("Couldn't reschedule", e?.message ?? 'Try again.');
    }
  };
  const doCancel = async () => {
    try { await cancelM.mutateAsync({ id: session.id, canceledBy, remark }); onClose(); }
    catch (e: any) { Alert.alert("Couldn't cancel", e?.message ?? 'Try again.'); }
  };
  const doWipe = () => {
    Alert.alert('Delete ALL future sessions?', `Every upcoming session for ${session.clientName} will be permanently deleted. This cannot be undone.`, [
      { text: 'Keep them', style: 'cancel' },
      {
        text: 'Delete all', style: 'destructive', onPress: async () => {
          try { const n = await wipeM.mutateAsync({ clientId: session.clientId }); onClose(); Alert.alert('Roster cleared', `${n} upcoming sessions deleted for ${session.clientName}.`); }
          catch (e: any) { Alert.alert("Couldn't delete", e?.message ?? 'Try again.'); }
        },
      },
    ]);
  };

  return (
    <SheetShell visible={!!session} onClose={onClose} accent={col} icon="calendar" title={session.clientName} subtitle={`${(session.modality ?? 'SESSION').toUpperCase()} · ${dayLabel(dayKey(session.when)).toUpperCase()} · ${timeOf(session.when)}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Badge text={session.cancelled ? 'Cancelled' : 'Scheduled'} color={session.cancelled ? C.red : C.green} />
        <Badge text={session.modality ?? 'Session'} color={col} />
        <Body style={{ flex: 1, fontSize: 11.5, color: C.muted2 }} numberOfLines={1}>with {session.trainerName}</Body>
      </View>
      {session.notes ? <Body style={{ fontSize: 11.5, color: C.muted2 }}>{session.notes}</Body> : null}

      {mode === 'menu' ? (
        <View style={{ gap: 8 }}>
          {!session.cancelled ? (
            <>
              <Pressable onPress={() => setMode('reschedule')} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 13, borderRadius: 13, backgroundColor: hexA(C.gold, 0.09), borderWidth: 1, borderColor: hexA(C.gold, 0.35) }}>
                <Icon name="clock" size={16} color={C.gold} strokeWidth={2.1} />
                <Body style={{ flex: 1, fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>Reschedule this session</Body>
                <Icon name="chevRight" size={14} color={C.gold} strokeWidth={2.2} />
              </Pressable>
              <Pressable onPress={() => setMode('cancel')} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 13, borderRadius: 13, backgroundColor: hexA(C.red, 0.07), borderWidth: 1, borderColor: hexA(C.red, 0.3) }}>
                <Icon name="close" size={16} color={C.red} strokeWidth={2.3} />
                <Body style={{ flex: 1, fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>Cancel this session</Body>
                <Icon name="chevRight" size={14} color={C.red} strokeWidth={2.2} />
              </Pressable>
            </>
          ) : null}
          <Pressable onPress={doWipe} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 13, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: hexA(C.red, 0.25) }}>
            <Icon name="alert" size={16} color={C.red} strokeWidth={2.1} />
            <View style={{ flex: 1 }}>
              <Body style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: C.red }}>Delete all future sessions</Body>
              <Body style={{ fontSize: 10.5, color: C.muted3, marginTop: 1 }}>Wipes {session.clientName}'s entire upcoming roster</Body>
            </View>
          </Pressable>
        </View>
      ) : mode === 'reschedule' ? (
        <>
          <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.muted3 }}>NEW DAY</Mono>
          <HScroll gap={7}>
            {days.map((d) => {
              const active = dayOffset === d.offset;
              return (
                <AnimChip key={d.offset} active={active} onPress={() => setDayOffset(d.offset)} style={{ alignItems: 'center', paddingVertical: 9, paddingHorizontal: 13, borderRadius: 12, backgroundColor: active ? hexA(C.gold, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.gold, 0.5) : 'rgba(255,255,255,0.09)', gap: 2 }}>
                  <Mono style={{ fontSize: 7.5, color: active ? C.gold : C.muted3 }}>{d.label.toUpperCase()}</Mono>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: active ? C.gold : C.muted }}>{d.date}</Text>
                </AnimChip>
              );
            })}
          </HScroll>
          <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.muted3 }}>NEW TIME — PICK HOUR & MINUTES</Mono>
          <TimeDial time={time} onChange={setTime} accent={C.gold} />
          <Pressable onPress={() => doReschedule(false)} disabled={reschedM.isPending} style={{ opacity: reschedM.isPending ? 0.5 : 1 }}>
            <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ alignItems: 'center', paddingVertical: 12, borderRadius: 12 }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: '#fff' }}>{reschedM.isPending ? 'Moving…' : 'Move Session'}</Text>
            </LinearGradient>
          </Pressable>
        </>
      ) : (
        <>
          <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.muted3 }}>CANCELLED BY</Mono>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {(['Client', 'Trainer'] as const).map((who) => {
              const active = canceledBy === who;
              return (
                <AnimChip key={who} grow active={active} onPress={() => setCanceledBy(who)} style={{ alignItems: 'center', paddingVertical: 9, borderRadius: 11, backgroundColor: active ? hexA(C.red, 0.14) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.red, 0.45) : 'rgba(255,255,255,0.09)' }}>
                  <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 11.5, color: active ? C.red : C.muted }}>{who}</Text>
                </AnimChip>
              );
            })}
          </View>
          <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.muted3 }}>CANCELLATION REMARK</Mono>
          <TextInput value={remark} onChangeText={setRemark} placeholder="Why is it being cancelled? (optional)" placeholderTextColor={C.muted3} multiline style={[INPUT, { minHeight: 56, textAlignVertical: 'top' }]} />
          <Pressable onPress={doCancel} disabled={cancelM.isPending} style={{ alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: hexA(C.red, 0.14), borderWidth: 1, borderColor: hexA(C.red, 0.45), opacity: cancelM.isPending ? 0.5 : 1 }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: C.red }}>{cancelM.isPending ? 'Cancelling…' : 'Cancel Session'}</Text>
          </Pressable>
        </>
      )}
    </SheetShell>
  );
}

/* ================= Create Roster (web BulkSessionCreator — Create New + Replicate) ================= */
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const TIME_OPTIONS = ['05:30', '06:00', '06:30', '07:00', '07:30', '08:00', '08:30', '09:00', '10:00', '11:00', '12:00', '15:00', '16:00', '17:00', '17:30', '18:00', '18:30', '19:00', '20:00'];
const fmtTime12 = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}${m ? ':' + String(m).padStart(2, '0') : ''} ${h < 12 ? 'AM' : 'PM'}`;
};

function StepHeader({ n, title, done }: { n: number; title: string; done?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
      <View style={{ width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: done ? hexA(C.green, 0.16) : hexA(C.orange, 0.14), borderWidth: 1, borderColor: done ? hexA(C.green, 0.5) : hexA(C.orange, 0.4) }}>
        {done ? <Icon name="checks" size={12} color={C.green} strokeWidth={2.6} /> : <Text style={{ fontFamily: F.bodyBold, fontSize: 11.5, color: C.orange }}>{n}</Text>}
      </View>
      <Body style={{ flex: 1, fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{title}</Body>
    </View>
  );
}

function WeeksStepper({ weeks, setWeeks }: { weeks: number; setWeeks: (n: number) => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Pressable onPress={() => setWeeks(Math.max(1, weeks - 1))} style={{ width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}>
        <Text style={{ fontFamily: F.bodyBold, fontSize: 18, color: weeks > 1 ? '#fff' : C.muted3 }}>−</Text>
      </Pressable>
      <View style={{ flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 12, backgroundColor: hexA(C.blue, 0.08), borderWidth: 1, borderColor: hexA(C.blue, 0.3) }}>
        <Text style={{ fontFamily: F.bodyBold, fontSize: 19, color: C.blue }}>{weeks}</Text>
        <Mono style={{ fontSize: 7, letterSpacing: 0.8, color: C.muted3 }}>WEEK{weeks > 1 ? 'S' : ''}</Mono>
      </View>
      <Pressable onPress={() => setWeeks(Math.min(8, weeks + 1))} style={{ width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}>
        <Text style={{ fontFamily: F.bodyBold, fontSize: 18, color: weeks < 8 ? '#fff' : C.muted3 }}>+</Text>
      </Pressable>
    </View>
  );
}

export function CreateRosterSheet({ visible, onClose, crmId, people, presetClient }: {
  visible: boolean; onClose: () => void; crmId: string | null;
  people?: { clients: { id: string; name: string }[]; trainers: { id: string; name: string }[]; doctors: { id: string; name: string }[] };
  presetClient?: { id: string; name: string } | null;
}) {
  const bulkM = useBulkCreateRoster();
  const [tab, setTab] = React.useState<'new' | 'replicate'>('new');
  const [client, setClient] = React.useState<{ id: string; name: string } | null>(null);
  const [clientQ, setClientQ] = React.useState('');
  // Create-new state
  const [modality, setModality] = React.useState<string>('Strength');
  const [provider, setProvider] = React.useState<{ id: string; name: string } | null>(null);
  const [providerQ, setProviderQ] = React.useState('');
  const [pickProvider, setPickProvider] = React.useState(false);
  const [weeks, setWeeks] = React.useState(4);
  const [defaultTime, setDefaultTime] = React.useState('07:00');
  const [dayTimes, setDayTimes] = React.useState<Map<number, string>>(new Map([[1, '07:00'], [3, '07:00'], [5, '07:00']]));
  const [editDay, setEditDay] = React.useState<number | null>(null);
  // Replicate state
  const inferQ = useInferRoster(visible && tab === 'replicate' && client ? client.id : null);
  const [repWeeks, setRepWeeks] = React.useState(4);
  const [repStart, setRepStart] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<{ created: number; conflicts: RosterConflict[] } | null>(null);

  React.useEffect(() => {
    if (visible) {
      setTab('new'); setClient(presetClient ?? null); setClientQ(''); setProvider(null); setProviderQ('');
      setPickProvider(false); setResult(null); setEditDay(null);
      setDefaultTime('07:00');
      setDayTimes(new Map([[1, '07:00'], [3, '07:00'], [5, '07:00']]));
      setWeeks(4); setRepWeeks(4); setRepStart(null);
    }
  }, [visible]);

  const isPhysio = modality === 'Physiotherapy';
  const providerPool = isPhysio ? (people?.doctors ?? []) : (people?.trainers ?? []);
  const pq = providerQ.trim().toLowerCase();
  const providers = providerPool.filter((p) => !pq || p.name.toLowerCase().includes(pq));
  const cq = clientQ.trim().toLowerCase();
  const clients = (people?.clients ?? []).filter((c) => !cq || c.name.toLowerCase().includes(cq));

  const selectedDays = [...dayTimes.keys()].sort();
  const willCreate = selectedDays.length * weeks;
  const toggleDay = (d: number) => {
    const next = new Map(dayTimes);
    if (next.has(d)) { next.delete(d); if (editDay === d) setEditDay(null); }
    else next.set(d, defaultTime);
    setDayTimes(next);
  };
  const setTimeFor = (d: number, t: string) => { const next = new Map(dayTimes); next.set(d, t); setDayTimes(next); };
  // Changing the default time re-times every selected day (per-day overrides after).
  const applyDefaultTime = (t: string) => {
    setDefaultTime(t);
    setDayTimes((prev) => { const next = new Map<number, string>(); prev.forEach((_v, k) => next.set(k, t)); return next; });
  };

  // Replicate helpers
  const inferred = inferQ.data ?? [];
  const nextMonday = () => {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
    return d;
  };
  const startOptions = [
    { iso: nextMonday(), label: 'Next Monday' },
    ...Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + i + 1); return { iso: d, label: i === 0 ? 'Tomorrow' : d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: '2-digit' }) }; }),
  ];
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const repStartIso = repStart ?? ymd(nextMonday());

  const runNew = async (force = false) => {
    if (!client || !provider || !selectedDays.length) return;
    try {
      const r = await bulkM.mutateAsync({
        clientId: client.id, trainerId: provider.id, modality, weeks,
        schedules: selectedDays.map((d) => ({ day: d, time: dayTimes.get(d)! })),
        forceProceed: force,
      });
      setResult(r);
    } catch (e: any) { Alert.alert("Couldn't create roster", e?.message ?? 'Try again.'); }
  };
  const runReplicate = async (force = false) => {
    if (!client || !inferred.length) return;
    const fallbackTrainer = inferred.find((s) => s.trainerId)?.trainerId;
    if (!fallbackTrainer) { Alert.alert('No trainer found', "The previous roster has no trainer to replicate."); return; }
    try {
      const r = await bulkM.mutateAsync({
        clientId: client.id, trainerId: fallbackTrainer, modality: inferred[0].modality ?? 'Strength', weeks: repWeeks,
        schedules: inferred.map((s) => ({ day: s.day, time: s.time, trainerId: s.trainerId, modality: s.modality })),
        startDate: repStartIso, forceProceed: force,
      });
      setResult(r);
    } catch (e: any) { Alert.alert("Couldn't replicate", e?.message ?? 'Try again.'); }
  };
  const trainerConflicts = (result?.conflicts ?? []).filter((c) => c.kind === 'trainer');

  return (
    <SheetShell visible={visible} onClose={onClose} accent={C.orange} icon="calPlus" title="Create Monthly Roster" subtitle={client ? client.name.toUpperCase() : 'SET UP A WEEKLY TRAINING PLAN'}>
      {result ? (
        <>
          <View style={{ alignItems: 'center', gap: 8, paddingVertical: 10 }}>
            <View style={{ width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', backgroundColor: hexA(result.created ? C.green : C.gold, 0.14), borderWidth: 1, borderColor: hexA(result.created ? C.green : C.gold, 0.45) }}>
              <Icon name={result.created ? 'checks' : 'alert'} size={24} color={result.created ? C.green : C.gold} strokeWidth={2.3} />
            </View>
            <Serif style={{ fontSize: 20 }}>{result.created} sessions created</Serif>
            {client ? <Mono style={{ fontSize: 9, color: C.muted3 }}>{client.name.toUpperCase()}</Mono> : null}
          </View>
          {result.conflicts.length ? (
            <View style={{ gap: 6 }}>
              <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.gold }}>SKIPPED SLOTS ({result.conflicts.length})</Mono>
              {result.conflicts.slice(0, 10).map((c, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 9, borderRadius: 10, backgroundColor: hexA(c.kind === 'client' ? C.red : C.gold, 0.06), borderWidth: 1, borderColor: hexA(c.kind === 'client' ? C.red : C.gold, 0.25) }}>
                  <Icon name="alert" size={11} color={c.kind === 'client' ? C.red : C.gold} strokeWidth={2.2} />
                  <Body style={{ flex: 1, fontSize: 11, color: C.ink3 }}>{c.detail}</Body>
                </View>
              ))}
              {result.conflicts.length > 10 ? <Body style={{ fontSize: 10.5, color: C.muted3, textAlign: 'center' }}>+{result.conflicts.length - 10} more skipped</Body> : null}
            </View>
          ) : null}
          {trainerConflicts.length ? (
            <Pressable onPress={() => (tab === 'new' ? runNew(true) : runReplicate(true))} disabled={bulkM.isPending} style={{ alignItems: 'center', paddingVertical: 11, borderRadius: 12, backgroundColor: hexA(C.gold, 0.12), borderWidth: 1, borderColor: hexA(C.gold, 0.45), opacity: bulkM.isPending ? 0.5 : 1 }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: C.gold }}>Force-create {trainerConflicts.length} trainer-clash slots</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={onClose}>
            <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ alignItems: 'center', paddingVertical: 12, borderRadius: 12 }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: '#fff' }}>Done</Text>
            </LinearGradient>
          </Pressable>
        </>
      ) : (
        <>
          {/* Mode tabs */}
          <View style={{ flexDirection: 'row', gap: 6, padding: 4, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.28)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' }}>
            {([['new', 'Create New', 'calPlus'], ['replicate', 'Replicate Roster', 'swap']] as const).map(([id, label, icon]) => {
              const active = tab === id;
              return (
                <AnimChip key={id} grow active={active} onPress={() => setTab(id)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 10, overflow: 'hidden', backgroundColor: active ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                  {active ? <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} /> : null}
                  <Icon name={icon as any} size={12} color={active ? '#fff' : C.muted2} strokeWidth={2.2} />
                  <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 11.5, color: active ? '#fff' : C.muted }}>{label}</Text>
                </AnimChip>
              );
            })}
          </View>

          {/* Step 1 — client (shared) */}
          <StepHeader n={1} title={client ? client.name : 'Pick the client'} done={!!client} />
          {!client ? (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 10, paddingHorizontal: 13, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
                <Icon name="search" size={14} color={C.muted3} strokeWidth={2} />
                <TextInput value={clientQ} onChangeText={setClientQ} placeholder="Search your clients…" placeholderTextColor={C.muted3} autoCorrect={false} style={{ flex: 1, fontFamily: F.body, fontSize: 13.5, color: '#fff', padding: 0 }} />
              </View>
              {clients.slice(0, 50).map((c, i) => (
                <Pressable key={c.id} onPress={() => setClient(c)} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: 11, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }}>
                  <MiniAvatar initial={initials(c.name)} colors={AVS[i % AVS.length]} size={34} />
                  <Body numberOfLines={1} style={{ flex: 1, fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{c.name}</Body>
                  <Icon name="chevRight" size={13} color={C.muted3} strokeWidth={2.2} />
                </Pressable>
              ))}
            </>
          ) : (
            <Pressable onPress={() => setClient(null)} style={{ alignSelf: 'flex-start', paddingVertical: 5, paddingHorizontal: 11, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 10.5, color: C.muted }}>Change client</Text>
            </Pressable>
          )}

          {client && tab === 'new' ? (
            <>
              {/* Step 2 — plan */}
              <StepHeader n={2} title="Build the weekly plan" done={selectedDays.length > 0} />
              <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.muted3 }}>DEFAULT MODALITY</Mono>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {MODALITIES.map((m) => {
                  const active = modality === m;
                  const col = modalityColor(m);
                  return (
                    <AnimChip key={m} active={active} onPress={() => { setModality(m); setProvider(null); }} style={{ paddingVertical: 8, paddingHorizontal: 13, borderRadius: 999, backgroundColor: active ? hexA(col, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(col, 0.55) : 'rgba(255,255,255,0.09)' }}>
                      <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 11.5, color: active ? col : C.muted }}>{m}</Text>
                    </AnimChip>
                  );
                })}
              </View>
              <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.muted3 }}>TRAINING DAYS — TAP A SELECTED DAY TO SET ITS TIME</Mono>
              <View style={{ flexDirection: 'row', gap: 5 }}>
                {DAY_SHORT.map((lbl, d) => {
                  const on = dayTimes.has(d);
                  return (
                    <AnimChip key={d} grow active={on} onPress={() => (on ? setEditDay(editDay === d ? null : d) : toggleDay(d))} style={{ alignItems: 'center', paddingVertical: 9, borderRadius: 11, gap: 2, backgroundColor: on ? hexA(C.orange, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: on ? hexA(C.orange, editDay === d ? 0.9 : 0.5) : 'rgba(255,255,255,0.09)' }}>
                      <Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: on ? C.orange : C.muted }}>{lbl}</Text>
                      {on ? <Mono style={{ fontSize: 6.5, color: C.ink3 }}>{fmtTime12(dayTimes.get(d)!)}</Mono> : <Mono style={{ fontSize: 6.5, color: 'transparent' }}>—</Mono>}
                    </AnimChip>
                  );
                })}
              </View>
              {selectedDays.length ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
                  {selectedDays.map((d) => (
                    <Pressable key={d} onPress={() => toggleDay(d)} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4, paddingHorizontal: 9, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
                      <Text style={{ fontFamily: F.bodySemi, fontSize: 9.5, color: C.ink3 }}>{DAY_SHORT[d]} · {fmtTime12(dayTimes.get(d)!)}</Text>
                      <Icon name="close" size={9} color={C.muted3} strokeWidth={2.6} />
                    </Pressable>
                  ))}
                </View>
              ) : null}
              {/* Session time — applies to every selected day; per-day override below */}
              <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.muted3 }}>SESSION TIME — APPLIES TO ALL SELECTED DAYS</Mono>
              <View style={{ padding: 11, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.24)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }}>
                <TimeDial time={defaultTime} onChange={applyDefaultTime} accent={C.gold} />
              </View>
              {editDay != null && dayTimes.has(editDay) ? (
                <View style={{ padding: 11, borderRadius: 13, backgroundColor: hexA(C.orange, 0.06), borderWidth: 1, borderColor: hexA(C.orange, 0.3), gap: 8 }}>
                  <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.orange }}>{DAY_NAMES[editDay].toUpperCase()} ONLY — OVERRIDE TIME</Mono>
                  <TimeDial time={dayTimes.get(editDay)!} onChange={(t) => setTimeFor(editDay, t)} accent={C.gold} />
                  <Pressable onPress={() => setEditDay(null)} style={{ alignSelf: 'flex-end' }}>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: C.orange }}>Done</Text>
                  </Pressable>
                </View>
              ) : null}
              <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.muted3 }}>NUMBER OF WEEKS</Mono>
              <WeeksStepper weeks={weeks} setWeeks={setWeeks} />

              {/* Step 3 — provider */}
              <StepHeader n={3} title={provider ? `${isPhysio ? 'Doctor' : 'Trainer'}: ${provider.name}` : `Pick the ${isPhysio ? 'doctor' : 'trainer'}`} done={!!provider} />
              {!pickProvider && !provider ? (
                <Pressable onPress={() => setPickProvider(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 9, padding: 12, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
                  <Icon name="userPlus" size={15} color={C.muted} strokeWidth={2} />
                  <Body style={{ flex: 1, fontSize: 12.5, color: C.muted }}>Choose from {providerPool.length} {isPhysio ? 'doctors' : 'trainers'}…</Body>
                  <Icon name="chevDown" size={13} color={C.muted3} strokeWidth={2.2} />
                </Pressable>
              ) : null}
              {provider ? (
                <Pressable onPress={() => { setProvider(null); setPickProvider(true); }} style={{ alignSelf: 'flex-start', paddingVertical: 5, paddingHorizontal: 11, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}>
                  <Text style={{ fontFamily: F.bodySemi, fontSize: 10.5, color: C.muted }}>Change {isPhysio ? 'doctor' : 'trainer'}</Text>
                </Pressable>
              ) : null}
              {pickProvider && !provider ? (
                <>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 10, paddingHorizontal: 13, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
                    <Icon name="search" size={14} color={C.muted3} strokeWidth={2} />
                    <TextInput value={providerQ} onChangeText={setProviderQ} placeholder={`Search ${isPhysio ? 'doctors' : 'trainers'}…`} placeholderTextColor={C.muted3} autoCorrect={false} style={{ flex: 1, fontFamily: F.body, fontSize: 13.5, color: '#fff', padding: 0 }} />
                  </View>
                  {providers.map((p, i) => (
                    <Pressable key={p.id} onPress={() => { setProvider(p); setPickProvider(false); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: 10, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }}>
                      <MiniAvatar initial={initials(p.name)} colors={AVS[i % AVS.length]} size={32} />
                      <Body numberOfLines={1} style={{ flex: 1, fontSize: 13, fontFamily: F.bodySemi, color: '#fff' }}>{p.name}</Body>
                      <Icon name="chevRight" size={13} color={C.muted3} strokeWidth={2.2} />
                    </Pressable>
                  ))}
                </>
              ) : null}

              <Pressable onPress={() => runNew(false)} disabled={!provider || !selectedDays.length || bulkM.isPending} style={{ opacity: provider && selectedDays.length && !bulkM.isPending ? 1 : 0.5 }}>
                <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ alignItems: 'center', paddingVertical: 13, borderRadius: 12 }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: '#fff' }}>{bulkM.isPending ? 'Checking conflicts & creating…' : `Create ${willCreate} Sessions`}</Text>
                </LinearGradient>
              </Pressable>
              <Body style={{ fontSize: 10.5, color: C.muted3 }}>Every slot is checked against trainer leave, trainer bookings and the client's own sessions (±1 hour) — clashes are skipped and reported.</Body>
            </>
          ) : null}

          {client && tab === 'replicate' ? (
            <>
              <StepHeader n={2} title="Previous weekly pattern" done={inferred.length > 0} />
              {inferQ.isLoading ? (
                <Body style={{ fontSize: 12, color: C.muted3, textAlign: 'center', paddingVertical: 12 }}>Reading the last 4 weeks…</Body>
              ) : inferred.length === 0 ? (
                <View style={{ alignItems: 'center', gap: 7, paddingVertical: 14 }}>
                  <Icon name="alert" size={20} color={C.gold} strokeWidth={2} />
                  <Body style={{ fontSize: 12, color: C.muted2, textAlign: 'center' }}>No repeating pattern found in the last 4 weeks — use Create New instead.</Body>
                </View>
              ) : (
                <View style={{ borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.24)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
                  {inferred.map((s, i) => (
                    <View key={`${s.day}-${s.time}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12, borderTopWidth: i ? 1 : 0, borderTopColor: 'rgba(255,255,255,0.05)' }}>
                      <View style={{ width: 40 }}>
                        <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: '#fff' }}>{DAY_SHORT[s.day]}</Text>
                        <Mono style={{ fontSize: 7.5, color: C.muted3 }}>{fmtTime12(s.time)}</Mono>
                      </View>
                      <View style={{ width: 3, alignSelf: 'stretch', borderRadius: 2, backgroundColor: hexA(modalityColor(s.modality), 0.8) }} />
                      <View style={{ flex: 1 }}>
                        <Body numberOfLines={1} style={{ fontSize: 12, fontFamily: F.bodySemi, color: '#fff' }}>{s.modality ?? 'Session'}</Body>
                        <Mono style={{ fontSize: 7.5, color: C.muted3, marginTop: 1 }} numberOfLines={1}>{s.trainerName.toUpperCase()}</Mono>
                      </View>
                      <Badge text={`×${s.count}`} color={C.blue} />
                    </View>
                  ))}
                </View>
              )}
              {inferred.length ? (
                <>
                  <StepHeader n={3} title="When should it restart?" done={true} />
                  <HScroll gap={6}>
                    {startOptions.map((o, i) => {
                      const iso = ymd(o.iso);
                      const active = repStartIso === iso;
                      return (
                        <AnimChip key={i} active={active} onPress={() => setRepStart(iso)} style={{ alignItems: 'center', paddingVertical: 9, paddingHorizontal: 13, borderRadius: 12, backgroundColor: active ? hexA(C.gold, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.gold, 0.5) : 'rgba(255,255,255,0.09)' }}>
                          <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 11, color: active ? C.gold : C.muted }}>{o.label}</Text>
                        </AnimChip>
                      );
                    })}
                  </HScroll>
                  <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.muted3 }}>NUMBER OF WEEKS</Mono>
                  <WeeksStepper weeks={repWeeks} setWeeks={setRepWeeks} />
                  <Pressable onPress={() => runReplicate(false)} disabled={bulkM.isPending} style={{ opacity: bulkM.isPending ? 0.5 : 1 }}>
                    <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ alignItems: 'center', paddingVertical: 13, borderRadius: 12 }}>
                      <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: '#fff' }}>{bulkM.isPending ? 'Replicating…' : `Replicate ${inferred.length * repWeeks} Sessions`}</Text>
                    </LinearGradient>
                  </Pressable>
                  <Body style={{ fontSize: 10.5, color: C.muted3 }}>Recreates the same weekly slots — same times, same trainers, same modalities — starting {repStartIso === ymd(nextMonday()) ? 'next Monday' : 'on the chosen day'}.</Body>
                </>
              ) : null}
            </>
          ) : null}
        </>
      )}
    </SheetShell>
  );
}
