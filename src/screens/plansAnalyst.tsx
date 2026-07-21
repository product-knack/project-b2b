import React from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator, Modal, ScrollView, Keyboard, Platform } from 'react-native';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono, Card, Avatar } from '../components/primitives';
import { Page, TitleBlock, Badge, HScroll, BackLink } from './common';
import { useStore } from '../store';
import { useComplianceClients, useClientCompliance, usePlannedExercises, type ComplianceRow } from '../lib/complianceQueries';
import { useAnalystTrainers } from '../lib/analystQueries';

/* ============ Workout Plans Analyst — web /coach/workout-plans-analyst port.
   Client picker (search / trainer / goal filters) → per-client compliance detail. ============ */

const AV_GRADS: [string, string][] = [
  ['#FB8B3A', '#EE5E16'], ['#57C98A', '#2E9A63'], ['#7C8FE8', '#4A5AC8'],
  ['#9A7BEA', '#6E5BD0'], ['#E0A53C', '#C07C1E'], ['#4FD1C5', '#2C8A86'],
  ['#F687B3', '#C2568A'], ['#F0883E', '#C05621'],
];
const avColors = (seed: string): [string, string] => AV_GRADS[[...(seed || '?')].reduce((a, c) => a + c.charCodeAt(0), 0) % AV_GRADS.length];

const complianceColor = (pct: number) => (pct >= 80 ? C.green : pct >= 50 ? C.gold : C.red);
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

function Loading() {
  return <View style={{ paddingVertical: 42, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View>;
}

function Search({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 13, paddingVertical: 11, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)' }}>
      <Icon name="search" size={15} color={C.muted3} strokeWidth={2} />
      <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={C.muted3} autoCorrect={false} style={{ flex: 1, fontFamily: F.body, fontSize: 14, color: '#fff', padding: 0 }} />
      {value ? <Pressable onPress={() => onChange('')} hitSlop={8}><Icon name="close" size={13} color={C.muted3} strokeWidth={2.3} /></Pressable> : null}
    </View>
  );
}

type Opt = { value: string; label: string };
function Picker({ title, options, value, onSelect, onClose, searchable }: { title: string; options: Opt[]; value: string; onSelect: (v: string) => void; onClose: () => void; searchable?: boolean }) {
  const [term, setTerm] = React.useState('');
  // Edge-to-edge Android doesn't resize Modals for the keyboard — track its height
  // manually and pad the sheet so the search input and options stay visible.
  const [kb, setKb] = React.useState(0);
  React.useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (e) => setKb(e.endCoordinates?.height ?? 0));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKb(0));
    return () => { show.remove(); hide.remove(); };
  }, []);
  // Dismiss the keyboard BEFORE unmounting the Modal — tearing the Modal down with an
  // active keyboard crashes on the new architecture.
  const close = () => { const wasOpen = kb > 0; Keyboard.dismiss(); setTimeout(onClose, wasOpen ? 80 : 0); };
  const pick = (v: string) => { const wasOpen = kb > 0; Keyboard.dismiss(); setTimeout(() => { onSelect(v); onClose(); }, wasOpen ? 80 : 0); };
  const t = term.trim().toLowerCase();
  const opts = t ? options.filter((o) => (o.label ?? '').toLowerCase().includes(t)) : options;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={close}>
      <Pressable onPress={close} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}>
        <Pressable onPress={() => {}} style={{ maxHeight: '75%', backgroundColor: '#0E0A09', borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.14)', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 24 + kb }}>
          <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 12 }} />
          <Serif style={{ fontSize: 18, marginBottom: 10 }}>{title}</Serif>
          {searchable ? <View style={{ marginBottom: 8 }}><Search value={term} onChange={setTerm} placeholder="Search…" /></View> : null}
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {opts.map((o) => {
              const active = o.value === value;
              return (
                <Pressable key={o.value} onPress={() => pick(o.value)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 13, paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' }}>
                  <Body style={{ flex: 1, fontSize: 14, color: active ? C.orange : C.ink }}>{o.label}</Body>
                  {active ? <Icon path="M20 6 9 17l-5-5" size={15} color={C.orange} strokeWidth={2.6} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
function FilterField({ label, value, options, onPress }: { label: string; value: string; options: Opt[]; onPress: () => void }) {
  const current = options.find((o) => o.value === value)?.label ?? options[0]?.label ?? '';
  return (
    <View style={{ flex: 1, minWidth: '46%', gap: 5 }}>
      <Mono style={{ fontSize: 8.5, letterSpacing: 0.9, color: C.mono }}>{label.toUpperCase()}</Mono>
      <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 11, paddingHorizontal: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: value !== 'all' ? hexA(C.orange, 0.4) : 'rgba(255,255,255,0.1)' }}>
        <Body numberOfLines={1} style={{ flex: 1, fontSize: 12.5, color: value !== 'all' ? C.orange : C.ink3 }}>{current}</Body>
        <Icon name="chevDown" size={13} color={C.muted2} strokeWidth={2.2} />
      </Pressable>
    </View>
  );
}

/* ================= 1. Client picker ================= */
export function PlansAnalyst() {
  const { set, go } = useStore();
  const [search, setSearch] = React.useState('');
  const [trainer, setTrainer] = React.useState('all');
  const [goal, setGoal] = React.useState('all');
  const [openPicker, setOpenPicker] = React.useState<null | 'trainer' | 'goal'>(null);
  const [visible, setVisible] = React.useState(30);
  const trainersQ = useAnalystTrainers();
  const q = useComplianceClients(trainer === 'all' ? null : trainer);

  const all = q.data?.clients ?? [];
  const term = search.trim().toLowerCase();
  const list = all.filter((c) => {
    if (goal !== 'all' && c.goal !== goal) return false;
    if (term && !c.name.toLowerCase().includes(term)) return false;
    return true;
  });
  const shown = list.slice(0, visible);
  const trainerOpts: Opt[] = [{ value: 'all', label: 'All Trainers' }, ...(trainersQ.data ?? []).map((t) => ({ value: t.id, label: t.name }))];
  const goalOpts: Opt[] = [{ value: 'all', label: 'All Goals' }, ...(q.data?.goals ?? []).map((g) => ({ value: g, label: g }))];

  return (
    <Page gap={13}>
      <TitleBlock title="Workout Plans Analyst" sub="Analyze workout plan compliance & effectiveness per client" />
      <Search value={search} onChange={(v) => { setSearch(v); setVisible(30); }} placeholder="Search clients by name…" />
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <FilterField label="Trainer" value={trainer} options={trainerOpts} onPress={() => setOpenPicker('trainer')} />
        <FilterField label="Goal" value={goal} options={goalOpts} onPress={() => setOpenPicker('goal')} />
      </View>
      {q.isError ? <Body style={{ fontSize: 11.5, color: C.red, textAlign: 'center' }}>{(q.error as Error).message}</Body> : null}
      {q.isLoading ? <Loading /> : list.length === 0 ? (
        <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 26 }}>{term || goal !== 'all' ? 'No clients match these filters.' : 'No clients available.'}</Body>
      ) : (
        <>
          <Body style={{ fontSize: 11, color: C.muted3 }}>Showing {shown.length} of {list.length} client{list.length === 1 ? '' : 's'}</Body>
          {shown.map((c) => (
            <Card key={c.id} onPress={() => { set({ selectedClientId: c.id, selectedClientName: c.name }); go('plans-analyst-client'); }} colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.1)" radius={14} style={{ padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Avatar initial={c.initial} size={40} fontSize={15} colors={avColors(c.name)} />
              <View style={{ flex: 1 }}>
                <Body numberOfLines={1} style={{ fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }}>{c.name}</Body>
                {c.goal ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 }}>
                    <Icon name="target" size={11} color={C.orange} strokeWidth={2.2} />
                    <Body numberOfLines={1} style={{ fontSize: 11, color: C.orange }}>{c.goal}</Body>
                  </View>
                ) : (
                  <Body style={{ fontSize: 11, color: C.muted3, marginTop: 3 }}>No goal recorded</Body>
                )}
              </View>
              <Icon name="chevRight" size={16} color={C.muted3} strokeWidth={2.2} />
            </Card>
          ))}
          {visible < list.length ? (
            <Pressable onPress={() => setVisible((v) => v + 30)} style={{ alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)' }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: C.orange }}>Load more ({list.length - visible})</Text>
            </Pressable>
          ) : null}
        </>
      )}
      {openPicker === 'trainer' ? <Picker title="Filter by trainer" options={trainerOpts} value={trainer} onSelect={(v) => { setTrainer(v); setVisible(30); }} onClose={() => setOpenPicker(null)} searchable /> : null}
      {openPicker === 'goal' ? <Picker title="Filter by goal" options={goalOpts} value={goal} onSelect={(v) => { setGoal(v); setVisible(30); }} onClose={() => setOpenPicker(null)} /> : null}
    </Page>
  );
}

/* ================= 2. Client compliance detail ================= */
const monthKey = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const monthLabel = (key: string) => { const [y, m] = key.split('-').map(Number); return new Date(y, m - 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }); };

/* Monthly Average Compliance bar graph (web parity: newest month first, tap a bar to switch month). */
function MonthlyBarChart({ data, selected, onSelect }: { data: { key: string; label: string; avg: number }[]; selected: string; onSelect: (k: string) => void }) {
  const H = 110;
  return (
    <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.1)" radius={16} style={{ padding: 14, gap: 12 }}>
      <Mono style={{ fontSize: 9.5, letterSpacing: 1.2, color: C.mono }}>MONTHLY AVERAGE COMPLIANCE</Mono>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 14, paddingHorizontal: 2 }}>
          {data.map((m) => {
            const col = complianceColor(m.avg);
            const active = m.key === selected;
            return (
              <Pressable key={m.key} onPress={() => onSelect(m.key)} style={{ alignItems: 'center', gap: 5 }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 10, color: active ? col : C.muted2 }}>{m.avg}%</Text>
                <View style={{ width: 30, height: H, justifyContent: 'flex-end' }}>
                  <View style={{ width: 30, height: Math.max(4, (m.avg / 100) * H), borderRadius: 7, backgroundColor: hexA(col, active ? 1 : 0.45), borderWidth: active ? 1.5 : 0, borderColor: '#fff2' }} />
                </View>
                <Mono style={{ fontSize: 8, letterSpacing: 0.3, color: active ? col : C.muted3 }}>{m.label.toUpperCase()}</Mono>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
      <Body style={{ fontSize: 9.5, color: C.muted3 }}>Tap a bar to jump to that month.</Body>
    </Card>
  );
}

/* "Planned Exercises" sheet — what the active plan prescribed for that session's date. */
function PlannedExercisesSheet({ clientId, row, onClose }: { clientId: string; row: ComplianceRow; onClose: () => void }) {
  const q = usePlannedExercises(clientId, row.date, row.modality);
  const list = q.data ?? null;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}>
        <View style={{ maxHeight: '80%', backgroundColor: '#0E0A09', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.14)', paddingHorizontal: 18, paddingTop: 14, paddingBottom: 26 }}>
          <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 12 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: hexA(C.orange, 0.13), alignItems: 'center', justifyContent: 'center' }}><Icon name="target" size={15} color={C.orange} strokeWidth={2} /></View>
            <Serif style={{ flex: 1, fontSize: 18 }}>Planned Exercises · {fmtDay(row.date)}</Serif>
            <Pressable onPress={onClose} hitSlop={8} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="close" size={13} color="#B8B2AC" strokeWidth={2.3} />
            </Pressable>
          </View>
          {q.isLoading ? <Loading /> : q.isError ? (
            <Body style={{ fontSize: 11.5, color: C.red, paddingVertical: 16 }}>{(q.error as Error).message}</Body>
          ) : !list || list.planned.length === 0 ? (
            <Body style={{ fontSize: 12, color: C.muted2, textAlign: 'center', paddingVertical: 24 }}>No plan with a matching modality was active on this date.</Body>
          ) : (() => {
            const doneN = list.planned.filter((e) => e.done).length;
            const missedN = list.planned.length - doneN;
            return (
              <>
                {/* per-plan summary: done (green) · missed (red) · off-plan (gold) */}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999, backgroundColor: hexA(C.green, 0.12), borderWidth: 1, borderColor: hexA(C.green, 0.3) }}>
                    <Icon name="checks" size={11} color={C.green} strokeWidth={2.4} />
                    <Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: C.green }}>{doneN}/{list.planned.length} as planned</Text>
                  </View>
                  {missedN > 0 ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999, backgroundColor: hexA(C.red, 0.1), borderWidth: 1, borderColor: hexA(C.red, 0.28) }}>
                      <Icon name="close" size={10} color={C.red} strokeWidth={2.6} />
                      <Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: C.red }}>{missedN} not done</Text>
                    </View>
                  ) : null}
                  {list.extras.length > 0 ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999, backgroundColor: hexA(C.gold, 0.1), borderWidth: 1, borderColor: hexA(C.gold, 0.28) }}>
                      <Icon name="alert" size={10} color={C.gold} strokeWidth={2.4} />
                      <Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: C.gold }}>{list.extras.length} off-plan</Text>
                    </View>
                  ) : null}
                </View>
                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 12 }}>
                  {list.planned.map((e, i) => {
                    const col = e.done ? C.green : C.red;
                    return (
                      <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: 12, borderRadius: 12, backgroundColor: hexA(col, 0.06), borderWidth: 1, borderColor: hexA(col, 0.28), borderLeftWidth: 3, borderLeftColor: col }}>
                        <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: hexA(col, 0.14), borderWidth: 1, borderColor: hexA(col, 0.4), alignItems: 'center', justifyContent: 'center' }}>
                          <Icon name={e.done ? 'checks' : 'close'} size={12} color={col} strokeWidth={2.6} />
                        </View>
                        <View style={{ flex: 1, gap: 5 }}>
                          <Body style={{ fontSize: 13, fontFamily: F.bodySemi, color: '#fff' }}>{e.name}</Body>
                          <View style={{ flexDirection: 'row', gap: 6 }}>
                            {e.modality ? <Badge text={e.modality} color={C.blue} /> : null}
                            <Badge text={e.done ? 'As planned' : 'Not done'} color={col} />
                          </View>
                        </View>
                      </View>
                    );
                  })}
                  {list.extras.length > 0 ? (
                    <>
                      <Mono style={{ fontSize: 9.5, letterSpacing: 1.6, color: C.gold, marginTop: 6 }}>PERFORMED · NOT IN PLAN</Mono>
                      {list.extras.map((name, i) => (
                        <View key={`x-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: 12, borderRadius: 12, backgroundColor: hexA(C.gold, 0.05), borderWidth: 1, borderColor: hexA(C.gold, 0.24), borderLeftWidth: 3, borderLeftColor: C.gold }}>
                          <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: hexA(C.gold, 0.13), borderWidth: 1, borderColor: hexA(C.gold, 0.38), alignItems: 'center', justifyContent: 'center' }}>
                            <Icon name="alert" size={12} color={C.gold} strokeWidth={2.3} />
                          </View>
                          <View style={{ flex: 1, gap: 5 }}>
                            <Body style={{ fontSize: 13, fontFamily: F.bodySemi, color: '#fff' }}>{name}</Body>
                            <View style={{ alignSelf: 'flex-start' }}><Badge text="Off-plan" color={C.gold} /></View>
                          </View>
                        </View>
                      ))}
                    </>
                  ) : null}
                </ScrollView>
              </>
            );
          })()}
        </View>
      </View>
    </Modal>
  );
}

export function PlansAnalystClient() {
  const { selectedClientId, selectedClientName, back } = useStore();
  const q = useClientCompliance(selectedClientId);
  const [month, setMonth] = React.useState('');
  const [visible, setVisible] = React.useState(10);
  const all = q.data ?? [];

  const months = React.useMemo(() => [...new Set(all.map((r) => monthKey(r.date)))].sort().reverse(), [all]);
  React.useEffect(() => {
    if (months.length && !month) {
      const now = monthKey(new Date().toISOString());
      setMonth(months.includes(now) ? now : months[0]);
    }
  }, [months, month]);

  const rows = month ? all.filter((r) => monthKey(r.date) === month) : all;
  const avg = rows.length ? Math.round(rows.reduce((a, r) => a + r.percentage, 0) / rows.length) : 0;
  const shown = rows.slice(0, visible);
  const [planFor, setPlanFor] = React.useState<ComplianceRow | null>(null);

  // Per-month averages for the bar graph (newest first, like the web chart).
  const monthlyAverages = React.useMemo(() => months.map((m) => {
    const inMonth = all.filter((r) => monthKey(r.date) === m);
    const a = inMonth.length ? Math.round(inMonth.reduce((s, r) => s + r.percentage, 0) / inMonth.length) : 0;
    const [y, mo] = m.split('-').map(Number);
    return { key: m, label: new Date(y, mo - 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }), avg: a };
  }), [all, months]);

  // Per-trainer breakdown for the selected month (web parity).
  const byTrainer = React.useMemo(() => {
    const map = new Map<string, { name: string; sessions: number; sum: number }>();
    rows.forEach((r) => {
      const k = r.trainerId ?? 'unknown';
      const cur = map.get(k) ?? { name: r.trainerName, sessions: 0, sum: 0 };
      cur.sessions += 1; cur.sum += r.percentage;
      map.set(k, cur);
    });
    return [...map.values()].map((t) => ({ ...t, avg: Math.round(t.sum / t.sessions) })).sort((a, b) => b.avg - a.avg);
  }, [rows]);

  return (
    <Page gap={13}>
      <BackLink label="Plans Analyst" onPress={back} />
      <TitleBlock title={selectedClientName ?? 'Client'} sub="Workout plan compliance — % of performed exercises that match the active plan" />
      {q.isError ? <Body style={{ fontSize: 11.5, color: C.red, textAlign: 'center' }}>{(q.error as Error).message}</Body> : null}
      {q.isLoading ? <Loading /> : all.length === 0 ? (
        <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 26 }}>No compliance data — this client needs an approved plan and logged workouts after it.</Body>
      ) : (
        <>
          <HScroll gap={7}>
            {months.map((m) => {
              const active = month === m;
              return (
                <Pressable key={m} onPress={() => { setMonth(m); setVisible(10); }} style={{ paddingVertical: 8, paddingHorizontal: 13, borderRadius: 999, backgroundColor: active ? hexA(C.orange, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.orange, 0.5) : 'rgba(255,255,255,0.09)' }}>
                  <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 11.5, color: active ? C.orange : C.muted }}>{monthLabel(m)}</Text>
                </Pressable>
              );
            })}
          </HScroll>

          <View style={{ flexDirection: 'row', gap: 10 }}>
            {(([['AVG COMPLIANCE', `${avg}%`, complianceColor(avg)], ['SESSIONS', `${rows.length}`, C.blue]]) as [string, string, string][]).map(([lab, val, col]) => (
              <Card key={lab} colors={['rgba(56,34,21,0.5)', 'rgba(20,16,15,0.5)']} border={hexA(col, 0.22)} radius={14} style={{ flex: 1, padding: 13, alignItems: 'center', gap: 3 }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 22, color: col }}>{val}</Text>
                <Mono style={{ fontSize: 7.5, letterSpacing: 0.7, color: C.muted3 }}>{lab}</Mono>
              </Card>
            ))}
          </View>

          {monthlyAverages.length > 1 ? (
            <MonthlyBarChart data={monthlyAverages} selected={month} onSelect={(k) => { setMonth(k); setVisible(10); }} />
          ) : null}

          {byTrainer.length > 1 ? (
            <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.1)" radius={14} style={{ padding: 13, gap: 9 }}>
              <Mono style={{ fontSize: 9.5, letterSpacing: 1.2, color: C.mono }}>BY TRAINER · {month ? monthLabel(month).toUpperCase() : 'ALL'}</Mono>
              {byTrainer.map((t, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Body numberOfLines={1} style={{ flex: 1, fontSize: 12.5, color: '#fff' }}>{t.name}</Body>
                  <Mono style={{ fontSize: 9, color: C.muted3 }}>{t.sessions} SESS</Mono>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: complianceColor(t.avg), width: 44, textAlign: 'right' }}>{t.avg}%</Text>
                </View>
              ))}
            </Card>
          ) : null}

          {shown.map((r, i) => {
            const col = complianceColor(r.percentage);
            return (
              <Card key={i} onPress={() => setPlanFor(r)} colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border={hexA(col, 0.18)} radius={14} style={{ padding: 12, borderLeftWidth: 3, borderLeftColor: col, gap: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Body style={{ fontSize: 13, fontFamily: F.bodySemi, color: '#fff' }}>{fmtDay(r.date)}</Body>
                    <Body numberOfLines={1} style={{ fontSize: 10.5, color: C.muted2, marginTop: 1 }}>{r.trainerName}</Body>
                  </View>
                  {r.modality ? <Badge text={r.modality} color={C.blue} /> : null}
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 17, color: col }}>{r.percentage}%</Text>
                </View>
                <View style={{ height: 5, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                  <View style={{ width: `${Math.min(100, r.percentage)}%`, height: 5, borderRadius: 99, backgroundColor: col }} />
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Mono style={{ flex: 1, fontSize: 8.5, letterSpacing: 0.5, color: C.muted3 }}>{r.matched} OF {r.total} EXERCISES MATCHED THE PLAN</Mono>
                  <Icon name="eye" size={12} color={C.blue} strokeWidth={2.2} />
                  <Text style={{ fontFamily: F.bodySemi, fontSize: 10, color: C.blue }}>Planned</Text>
                </View>
              </Card>
            );
          })}
          {planFor && selectedClientId ? <PlannedExercisesSheet clientId={selectedClientId} row={planFor} onClose={() => setPlanFor(null)} /> : null}
          {visible < rows.length ? (
            <Pressable onPress={() => setVisible((v) => v + 10)} style={{ alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)' }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: C.orange }}>Load more ({rows.length - visible})</Text>
            </Pressable>
          ) : null}
        </>
      )}
    </Page>
  );
}
