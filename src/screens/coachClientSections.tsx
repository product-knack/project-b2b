import React from 'react';
import { View, Text, Pressable, ActivityIndicator, Modal, ScrollView } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { C, F, hexA } from '../theme';
import { Icon, IconName } from '../icons';
import { Serif, Body, Mono } from '../components/primitives';
import { Badge } from './common';
import {
  useClientQhps, useCompareQhps, useClientWorkoutMonths, useAnalyseVolume,
  useClientModalityImprovements, useClientModalityMonthDetail, useGenerateAiPlan,
  monthLabel, splitMdSections, aiPlanToText,
  type QhpItem, type ModalityBucket, type ModalityMonthAgg, type MdTone,
} from '../lib/coachClientQueries';
import { useClientBioAge, useClientProgression } from '../lib/clientQueries';
import { istDayLabel } from '../lib/trainerQueries';
import { AreaLine, AgeGauge, buildProgSeries, ProgChart, RangeChips } from './trainer';

/* ============ Clients Overview → detail sections (web CoachClientOverviewDetail port) ============ */

const TONE: Record<MdTone, string> = { positive: C.green, negative: C.red, action: C.orange, neutral: C.muted2 };

function Spinner({ text }: { text: string }) {
  return (
    <View style={{ alignItems: 'center', gap: 10, paddingVertical: 22 }}>
      <ActivityIndicator color={C.orange} />
      <Body style={{ fontSize: 11.5, color: C.muted2 }}>{text}</Body>
    </View>
  );
}

/* Minimal markdown-ish text: **bold** spans inside a Body line. */
function MdText({ text, size = 12.5 }: { text: string; size?: number }) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return (
    <Body style={{ fontSize: size, color: C.ink2, lineHeight: size * 1.5 }}>
      {parts.map((p, i) => (i % 2 === 1 ? <Text key={i} style={{ fontFamily: F.bodyBold, color: '#fff' }}>{p}</Text> : <Text key={i}>{p}</Text>))}
    </Body>
  );
}
/* AI markdown → toned blocks (## sections colored by sentiment, bullets rendered natively). */
export function MdBlocks({ md }: { md: string }) {
  const sections = React.useMemo(() => splitMdSections(md), [md]);
  return (
    <View style={{ gap: 9 }}>
      {sections.map((s, i) => {
        const col = TONE[s.tone];
        const lines = s.body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        return (
          <View key={i} style={{ padding: 12, borderRadius: 12, backgroundColor: hexA(col, 0.07), borderLeftWidth: 3, borderLeftColor: col, gap: 6 }}>
            {s.heading ? <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: s.tone === 'neutral' ? '#fff' : col }}>{s.heading}</Text> : null}
            {lines.map((l, j) => {
              const b = l.match(/^[-*•]\s+(.*)$/);
              const clean = (b ? b[1] : l).replace(/^#{1,6}\s+/, '');
              return (
                <View key={j} style={{ flexDirection: 'row', gap: 7 }}>
                  {b ? <Text style={{ color: col, fontSize: 12.5, lineHeight: 19 }}>•</Text> : null}
                  <View style={{ flex: 1 }}><MdText text={clean} /></View>
                </View>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

function ActionButton({ label, icon, onPress, disabled, color = C.orange, filled }: { label: string; icon?: IconName; onPress: () => void; disabled?: boolean; color?: string; filled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 11, paddingHorizontal: 14, borderRadius: 12, backgroundColor: hexA(color, disabled ? 0.05 : filled ? 0.2 : 0.1), borderWidth: 1, borderColor: hexA(color, disabled ? 0.15 : 0.45) }}>
      {icon ? <Icon name={icon} size={14} color={disabled ? C.muted3 : color} strokeWidth={2.2} /> : null}
      <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: disabled ? C.muted3 : color }}>{label}</Text>
    </Pressable>
  );
}

/* ================= 1. QHP Comparison ================= */
export function QhpCompareBlock({ clientId }: { clientId: string }) {
  const q = useClientQhps(clientId);
  const m = useCompareQhps();
  const [selected, setSelected] = React.useState<string[]>([]);
  const [result, setResult] = React.useState<string | null>(null);
  const qhps = q.data ?? [];

  React.useEffect(() => {
    if (qhps.length >= 2 && selected.length === 0) setSelected([qhps[0].id, qhps[qhps.length - 1].id]);
  }, [qhps.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id: string) => setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const items: QhpItem[] = qhps.filter((x) => selected.includes(x.id));
  const fmt = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  if (q.isLoading) return <Spinner text="Loading QHPs…" />;
  if (q.isError) return <Body style={{ fontSize: 11.5, color: C.red }}>{(q.error as Error).message}</Body>;
  if (qhps.length < 2) return <Body style={{ fontSize: 12, color: C.muted2 }}>At least two completed QHPs are needed for a comparison. This client has {qhps.length}.</Body>;

  return (
    <View style={{ gap: 10 }}>
      <Mono style={{ fontSize: 9, letterSpacing: 0.8, color: C.muted3 }}>QHPS TO COMPARE · SELECT 2 OR MORE</Mono>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
        {qhps.map((x) => {
          const on = selected.includes(x.id);
          return (
            <Pressable key={x.id} onPress={() => toggle(x.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 11, borderRadius: 11, backgroundColor: on ? hexA(C.gold, 0.15) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: on ? hexA(C.gold, 0.5) : 'rgba(255,255,255,0.09)' }}>
              {on ? <Icon path="M20 6 9 17l-5-5" size={12} color={C.gold} strokeWidth={2.6} /> : null}
              <Text style={{ fontFamily: on ? F.bodyBold : F.bodySemi, fontSize: 11, color: on ? C.gold : C.muted }}>{x.label} · {fmt(x.date)}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <ActionButton label={m.isPending ? 'Generating…' : 'Generate Comparison'} icon="sparkle" filled disabled={items.length < 2 || m.isPending}
            onPress={() => { setResult(null); m.mutate({ items }, { onSuccess: setResult }); }} />
        </View>
        {selected.length ? (
          <Pressable onPress={() => setSelected([])} style={{ justifyContent: 'center', paddingHorizontal: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
            <Text style={{ fontFamily: F.bodySemi, fontSize: 11.5, color: C.muted }}>Clear</Text>
          </Pressable>
        ) : null}
      </View>
      {m.isPending ? <Spinner text="Comparing QHPs with AI — this can take ~20s…" /> : null}
      {m.isError ? <Body style={{ fontSize: 11.5, color: C.red }}>{(m.error as Error).message}</Body> : null}
      {result && !m.isPending ? <MdBlocks md={result} /> : null}
    </View>
  );
}

/* ================= 2. Workout Volume Analysis ================= */
const VOL_MIN = 2, VOL_MAX = 6;
function MonthPicker({ months, used, onSelect, onClose }: { months: string[]; used: Set<string>; onSelect: (m: string) => void; onClose: () => void }) {
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}>
        <Pressable onPress={() => {}} style={{ maxHeight: '70%', backgroundColor: '#0E0A09', borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.14)', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 24 }}>
          <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 12 }} />
          <Serif style={{ fontSize: 18, marginBottom: 10 }}>Pick month</Serif>
          <ScrollView showsVerticalScrollIndicator={false}>
            {months.map((mo) => {
              const disabled = used.has(mo);
              return (
                <Pressable key={mo} disabled={disabled} onPress={() => { onSelect(mo); onClose(); }} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)', opacity: disabled ? 0.35 : 1 }}>
                  <Body style={{ flex: 1, fontSize: 14, color: C.ink }}>{monthLabel(mo)}</Body>
                  {disabled ? <Mono style={{ fontSize: 8.5, color: C.muted3 }}>SELECTED</Mono> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
export function VolumeBlock({ clientId }: { clientId: string }) {
  const q = useClientWorkoutMonths(clientId);
  const m = useAnalyseVolume();
  const months = q.data ?? [];
  const [slots, setSlots] = React.useState<(string | null)[]>([null, null]);
  const [pickFor, setPickFor] = React.useState<number | null>(null);
  const [result, setResult] = React.useState<{ summary: string; months: any[] } | null>(null);

  React.useEffect(() => {
    if (months.length >= 2 && !slots[0] && !slots[1]) setSlots([months[0], months[1]]);
    else if (months.length === 1 && !slots[0]) setSlots([months[0], null]);
  }, [months.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const valid = slots.filter(Boolean) as string[];
  const canRun = slots.every(Boolean) && new Set(valid).size === valid.length && valid.length >= VOL_MIN && !m.isPending;

  if (q.isLoading) return <Spinner text="Loading months…" />;
  if (q.isError) return <Body style={{ fontSize: 11.5, color: C.red }}>{(q.error as Error).message}</Body>;
  if (months.length < 2) return <Body style={{ fontSize: 12, color: C.muted2 }}>Need at least two months of completed sessions to compare.</Body>;

  const metricRows: [string, (x: any) => number][] = [
    ['Sessions', (x) => x.sessions], ['Sets logged', (x) => x.totalSets], ['Reps', (x) => x.totalReps],
    ['Load volume', (x) => x.totalLoadVolume], ['Session minutes', (x) => x.totalSessionMinutes], ['Cardio min', (x) => x.totalDurationMinutes],
  ];

  return (
    <View style={{ gap: 10 }}>
      <Body style={{ fontSize: 11.5, color: C.muted2 }}>Pick 2 to {VOL_MAX} months and get an AI side-by-side comparison.</Body>
      {slots.map((v, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Mono style={{ fontSize: 8.5, letterSpacing: 0.6, color: C.muted3, width: 56 }}>MONTH {i + 1}</Mono>
          <Pressable onPress={() => setPickFor(i)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
            <Body style={{ flex: 1, fontSize: 12.5, color: v ? '#fff' : C.muted3 }}>{v ? monthLabel(v) : 'Pick month'}</Body>
            <Icon name="chevDown" size={13} color={C.muted2} strokeWidth={2.2} />
          </Pressable>
          {slots.length > VOL_MIN ? (
            <Pressable onPress={() => setSlots((p) => p.filter((_, j) => j !== i))} hitSlop={6} style={{ width: 34, height: 38, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="close" size={12} color={C.muted2} strokeWidth={2.3} />
            </Pressable>
          ) : null}
        </View>
      ))}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <ActionButton label={`Add month (${slots.length}/${VOL_MAX})`} icon="plus" color={C.blue} disabled={slots.length >= VOL_MAX || slots.length >= months.length}
          onPress={() => setSlots((p) => { const used = new Set(p.filter(Boolean) as string[]); return [...p, months.find((x) => !used.has(x)) ?? null]; })} />
        <View style={{ flex: 1 }}>
          <ActionButton label={m.isPending ? 'Analysing…' : 'Compare'} icon="sparkle" filled disabled={!canRun}
            onPress={() => { setResult(null); m.mutate({ clientId, months: valid }, { onSuccess: setResult }); }} />
        </View>
      </View>
      {new Set(valid).size !== valid.length ? <Body style={{ fontSize: 10.5, color: C.red }}>Each month must be unique.</Body> : null}
      {m.isPending ? <Spinner text="Crunching the months with AI…" /> : null}
      {m.isError ? <Body style={{ fontSize: 11.5, color: C.red }}>{(m.error as Error).message}</Body> : null}

      {result && !m.isPending && result.months.length >= 2 ? (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', backgroundColor: 'rgba(0,0,0,0.22)', padding: 12 }}>
              <View style={{ flexDirection: 'row', paddingBottom: 7, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)' }}>
                <Mono style={{ fontSize: 8.5, letterSpacing: 0.6, color: C.muted3, width: 104 }}>METRIC</Mono>
                {result.months.map((x: any) => <Mono key={x.month} style={{ fontSize: 8.5, letterSpacing: 0.6, color: C.muted3, width: 74, textAlign: 'right' }}>{monthLabel(x.month).toUpperCase()}</Mono>)}
              </View>
              {metricRows.map(([label, get]) => {
                const vals = result.months.map(get);
                const mx = Math.max(...vals), mn = Math.min(...vals);
                const allEq = vals.every((v) => v === vals[0]);
                return (
                  <View key={label} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' }}>
                    <Body style={{ fontSize: 11.5, color: C.muted2, width: 104 }}>{label}</Body>
                    {vals.map((v, i) => (
                      <Text key={i} style={{ fontFamily: F.bodyBold, fontSize: 12, width: 74, textAlign: 'right', color: allEq ? C.ink2 : v === mx ? C.green : v === mn ? C.red : C.ink2 }}>{v.toLocaleString()}</Text>
                    ))}
                  </View>
                );
              })}
              <Body style={{ fontSize: 9.5, color: C.muted3, marginTop: 7 }}>Green = best, red = lowest across the selected months.</Body>
            </View>
          </ScrollView>
          {result.summary ? <MdBlocks md={result.summary} /> : null}
        </>
      ) : null}
      {pickFor != null ? (
        <MonthPicker months={months} used={new Set(slots.filter((_, j) => j !== pickFor).filter(Boolean) as string[])}
          onSelect={(mo) => setSlots((p) => p.map((x, j) => (j === pickFor ? mo : x)))} onClose={() => setPickFor(null)} />
      ) : null}
    </View>
  );
}

/* ================= 3. Improvements (per-modality month over month) ================= */
const BUCKETS: { key: ModalityBucket; label: string; icon: IconName; primary: (m: ModalityMonthAgg) => number; primaryLabel: string }[] = [
  { key: 'Strength', label: 'Strength', icon: 'dumbbell', primary: (m) => m.totalLoadVolume, primaryLabel: 'Load volume' },
  { key: 'YogaPilates', label: 'Yoga / Pilates', icon: 'activity', primary: (m) => m.totalDurationMinutes, primaryLabel: 'Active minutes' },
  { key: 'Aerobics', label: 'Aerobics', icon: 'heart', primary: (m) => m.totalDurationMinutes, primaryLabel: 'Duration min' },
];
function Spark({ data, color }: { data: number[]; color: string }) {
  const max = Math.max(1, ...data);
  if (data.length < 2) return <Body style={{ fontSize: 10, color: C.muted3 }}>Not enough data</Body>;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 34, flex: 1 }}>
      {data.map((v, i) => <View key={i} style={{ flex: 1, height: Math.max(3, (v / max) * 34), borderRadius: 2.5, backgroundColor: hexA(color, 0.3 + 0.55 * (v / max)) }} />)}
    </View>
  );
}
function Delta({ curr, prev }: { curr: number; prev: number | undefined }) {
  if (prev === undefined || prev === 0) return <Mono style={{ fontSize: 9, color: C.muted3 }}>—</Mono>;
  const pct = Math.round(((curr - prev) / prev) * 100);
  if (pct === 0) return <Mono style={{ fontSize: 9, color: C.muted3 }}>0%</Mono>;
  const up = pct > 0;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
      <Icon name={up ? 'trend' : 'chevDown'} size={9} color={up ? C.green : C.red} strokeWidth={2.5} />
      <Text style={{ fontFamily: F.bodyBold, fontSize: 9.5, color: up ? C.green : C.red }}>{up ? '+' : ''}{pct}%</Text>
    </View>
  );
}
function MetricCell({ label, value, delta }: { label: string; value: string; delta?: React.ReactNode }) {
  return (
    <View style={{ minWidth: '22%', flexGrow: 1, gap: 1 }}>
      <Mono style={{ fontSize: 7.5, letterSpacing: 0.5, color: C.muted3 }}>{label}</Mono>
      <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: '#fff' }}>{value}</Text>
      {delta}
    </View>
  );
}
function SessionRow({ s, showLoad }: { s: { sessionName: string | null; sessionDate: string; trainerName: string | null; totalSets: number; totalLoadVolume: number; totalDurationMinutes: number; totalRounds: number; exercises: { name: string; sets: number; reps: number; loadVolume: number; durationMinutes: number }[] }; showLoad: boolean }) {
  const [open, setOpen] = React.useState(false);
  return (
    <View style={{ borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }}>
      <Pressable onPress={() => setOpen((o) => !o)} style={{ flexDirection: 'row', alignItems: 'center', gap: 9, padding: 11 }}>
        <View style={{ flex: 1 }}>
          <Body numberOfLines={1} style={{ fontSize: 12.5, fontFamily: F.bodySemi, color: '#fff' }}>{s.sessionName || 'Untitled session'}</Body>
          <Body style={{ fontSize: 10, color: C.muted2, marginTop: 1 }}>{new Date(s.sessionDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}{s.trainerName ? ` · ${s.trainerName}` : ''}</Body>
        </View>
        <Mono style={{ fontSize: 9, color: C.muted3 }}>{s.totalSets} SETS{showLoad ? ` · ${s.totalLoadVolume.toLocaleString()} VOL` : s.totalDurationMinutes > 0 ? ` · ${s.totalDurationMinutes} MIN` : ''}</Mono>
        <Icon name={open ? 'chevUp' : 'chevDown'} size={13} color={C.muted3} strokeWidth={2.2} />
      </Pressable>
      {open ? (
        <View style={{ paddingHorizontal: 11, paddingBottom: 11, gap: 6 }}>
          {s.exercises.map((e) => (
            <View key={e.name} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Body numberOfLines={1} style={{ flex: 1, fontSize: 11.5, color: C.ink2 }}>{e.name}</Body>
              <Mono style={{ fontSize: 9, color: C.muted2 }}>{e.sets}×{e.reps}{showLoad ? ` · ${e.loadVolume.toLocaleString()}` : e.durationMinutes ? ` · ${e.durationMinutes}m` : ''}</Mono>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}
function ModalityDetailModal({ clientId, bucket, months, onClose }: { clientId: string; bucket: ModalityBucket; months: ModalityMonthAgg[]; onClose: () => void }) {
  const meta = BUCKETS.find((b) => b.key === bucket)!;
  const [openMonth, setOpenMonth] = React.useState<string | null>(null);
  const detail = useClientModalityMonthDetail(clientId, bucket, openMonth);
  const ascending = [...months].reverse();
  const idxOf = new Map(ascending.map((x, i) => [x.month, i]));
  const showLoad = bucket === 'Strength';

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}>
        <View style={{ height: '86%', backgroundColor: '#0E0A09', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.14)', paddingHorizontal: 18, paddingTop: 14 }}>
          <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 12 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            {openMonth ? (
              <Pressable onPress={() => setOpenMonth(null)} hitSlop={8} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="arrowLeft" size={14} color="#B8B2AC" strokeWidth={2.3} />
              </Pressable>
            ) : (
              <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: hexA(C.orange, 0.13), alignItems: 'center', justifyContent: 'center' }}><Icon name={meta.icon} size={15} color={C.orange} strokeWidth={2} /></View>
            )}
            <Serif style={{ flex: 1, fontSize: 19 }}>{meta.label}{openMonth ? ` · ${monthLabel(openMonth)}` : ' — monthly'}</Serif>
            <Pressable onPress={onClose} hitSlop={8} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="close" size={13} color="#B8B2AC" strokeWidth={2.3} />
            </Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 30, gap: 9 }}>
            {openMonth ? (
              detail.isLoading ? <Spinner text="Loading sessions…" /> :
              (detail.data ?? []).length === 0 ? <Body style={{ fontSize: 12, color: C.muted2, textAlign: 'center', paddingVertical: 20 }}>No sessions found for this month.</Body> :
              (detail.data ?? []).map((s) => <SessionRow key={s.sessionId} s={s} showLoad={showLoad} />)
            ) : months.length === 0 ? (
              <Body style={{ fontSize: 12, color: C.muted2, textAlign: 'center', paddingVertical: 20 }}>No sessions logged for this modality yet.</Body>
            ) : (
              <>
                {months.map((x) => {
                  const i = idxOf.get(x.month) ?? 0;
                  const prev = i > 0 ? ascending[i - 1] : undefined;
                  return (
                    <Pressable key={x.month} onPress={() => setOpenMonth(x.month)} style={{ padding: 12, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', gap: 9 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Body style={{ flex: 1, fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{monthLabel(x.month)}</Body>
                        <Icon name="chevRight" size={14} color={C.muted3} strokeWidth={2.2} />
                      </View>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                        <MetricCell label="SESSIONS" value={`${x.sessions}`} delta={<Delta curr={x.sessions} prev={prev?.sessions} />} />
                        {bucket === 'Strength' ? (
                          <>
                            <MetricCell label="SETS" value={x.totalSets.toLocaleString()} delta={<Delta curr={x.totalSets} prev={prev?.totalSets} />} />
                            <MetricCell label="REPS" value={x.totalReps.toLocaleString()} delta={<Delta curr={x.totalReps} prev={prev?.totalReps} />} />
                            <MetricCell label="LOAD VOL" value={x.totalLoadVolume.toLocaleString()} delta={<Delta curr={x.totalLoadVolume} prev={prev?.totalLoadVolume} />} />
                            <MetricCell label="AVG RIR" value={x.avgRIR != null ? `${x.avgRIR}` : '—'} />
                          </>
                        ) : bucket === 'YogaPilates' ? (
                          <>
                            <MetricCell label="ACTIVE MIN" value={x.totalDurationMinutes.toLocaleString()} delta={<Delta curr={x.totalDurationMinutes} prev={prev?.totalDurationMinutes} />} />
                            <MetricCell label="ENTRIES" value={x.totalSets.toLocaleString()} delta={<Delta curr={x.totalSets} prev={prev?.totalSets} />} />
                          </>
                        ) : (
                          <>
                            <MetricCell label="DURATION MIN" value={x.totalDurationMinutes.toLocaleString()} delta={<Delta curr={x.totalDurationMinutes} prev={prev?.totalDurationMinutes} />} />
                            <MetricCell label="ROUNDS" value={x.totalRounds.toLocaleString()} delta={<Delta curr={x.totalRounds} prev={prev?.totalRounds} />} />
                          </>
                        )}
                      </View>
                      {x.topExercises.length ? <Body numberOfLines={1} style={{ fontSize: 10, color: C.muted3 }}>Top: {x.topExercises.map((e) => e.name).join(', ')}</Body> : null}
                    </Pressable>
                  );
                })}
                <Body style={{ fontSize: 10, color: C.muted3 }}>Deltas compare each month with the previous month. Tap a month for the session breakdown.</Body>
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
export function ImprovementsBlock({ clientId }: { clientId: string }) {
  const q = useClientModalityImprovements(clientId);
  const [openBucket, setOpenBucket] = React.useState<ModalityBucket | null>(null);
  if (q.isLoading) return <Spinner text="Aggregating workout history…" />;
  if (q.isError) return <Body style={{ fontSize: 11.5, color: C.red }}>{(q.error as Error).message}</Body>;
  const d = q.data!;
  return (
    <View style={{ gap: 9 }}>
      <Body style={{ fontSize: 11.5, color: C.muted2 }}>Month-over-month progress per modality. Tap a tile for the breakdown.</Body>
      {BUCKETS.map((b) => {
        const months = d[b.key];
        const totalSessions = months.reduce((s, x) => s + x.sessions, 0);
        const disabled = totalSessions === 0;
        const spark = months.slice(0, 6).reverse().map((x) => b.primary(x));
        return (
          <Pressable key={b.key} disabled={disabled} onPress={() => setOpenBucket(b.key)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', opacity: disabled ? 0.5 : 1 }}>
            <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: hexA(C.orange, 0.13), alignItems: 'center', justifyContent: 'center' }}><Icon name={b.icon} size={16} color={C.orange} strokeWidth={2} /></View>
            <View style={{ width: 104 }}>
              <Body numberOfLines={1} style={{ fontSize: 12.5, fontFamily: F.bodySemi, color: '#fff' }}>{b.label}</Body>
              <Body style={{ fontSize: 10, color: C.muted2, marginTop: 1 }}>{totalSessions} session{totalSessions === 1 ? '' : 's'}</Body>
            </View>
            <Spark data={spark} color={C.orange} />
            <Icon name="chevRight" size={14} color={C.muted3} strokeWidth={2.2} />
          </Pressable>
        );
      })}
      {openBucket ? <ModalityDetailModal clientId={clientId} bucket={openBucket} months={d[openBucket]} onClose={() => setOpenBucket(null)} /> : null}
    </View>
  );
}

/* ================= Progression — full charts (Session Load / Max 1RM / Biological Age),
   same components the trainer ClientDetail trends tab uses. ================= */
const subCard = { padding: 13, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', gap: 11 } as const;
export function ProgressionCharts({ clientId }: { clientId: string }) {
  const bioQ = useClientBioAge(clientId);
  const progQ = useClientProgression(clientId);
  const [loadRange, setLoadRange] = React.useState('M');
  const [rmRange, setRmRange] = React.useState('M');
  const [ageSeries, setAgeSeries] = React.useState<'axion' | 'maq'>('axion');
  const [bioRange, setBioRange] = React.useState('3M');

  const progRows = progQ.data ?? [];
  const loadSeries = React.useMemo(() => buildProgSeries(progRows, loadRange, 'session_load', 'avg'), [progRows, loadRange]);
  const rmSeries = React.useMemo(() => buildProgSeries(progRows, rmRange, 'max_1rm', 'max'), [progRows, rmRange]);
  const rangeLabel = (r: string) => (r === 'W' ? 'Last 7 days' : r === 'M' ? 'Last 30 days' : 'Last 6 months');

  const bioRows: any[] = bioQ.data ?? [];
  const latestBio = bioRows[0];
  const bioAsc = React.useMemo(() => [...bioRows].reverse(), [bioRows]);
  const bioFiltered = React.useMemo(() => {
    if (bioRange !== '3M') return bioAsc;
    const cutoff = Date.now() - 92 * 24 * 3600e3;
    return bioAsc.filter((r) => r.calculation_date && new Date(r.calculation_date).getTime() >= cutoff);
  }, [bioAsc, bioRange]);
  const axionPts = bioFiltered.map((r) => r.metabolic_age).filter((n: any): n is number => n != null);
  const maqPts = bioFiltered.map((r) => r.mechanical_age).filter((n: any): n is number => n != null);
  const fmtDelta = (age: number | null | undefined, chrono: number | null | undefined) => {
    if (age == null || chrono == null) return '—';
    const d = +(age - chrono).toFixed(1);
    return `${d >= 0 ? '+' : '−'}${Math.abs(d)} vs chrono`;
  };

  if (progQ.isLoading || bioQ.isLoading) return <Spinner text="Loading progression…" />;

  return (
    <View style={{ gap: 10 }}>
      {/* Session Load */}
      <View style={subCard}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Body style={{ fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }}>Session Load</Body>
            <Mono style={{ fontSize: 8.5, color: C.muted3, marginTop: 1 }}>{rangeLabel(loadRange).toUpperCase()} · {loadSeries.count} SESSION{loadSeries.count === 1 ? '' : 'S'}</Mono>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4 }}>
            <Serif style={{ fontSize: 22, color: C.orange }}>{loadSeries.headline.toLocaleString()}</Serif>
            <Body style={{ fontSize: 10.5, color: C.muted2, marginBottom: 3 }}>kg avg</Body>
          </View>
        </View>
        <RangeChips options={['W', 'M', '6M']} value={loadRange} onChange={setLoadRange} />
        <ProgChart range={loadRange} id="ov-load" data={loadSeries.data} labels={loadSeries.labels} color={C.orange} avg={loadSeries.headline || undefined} />
      </View>

      {/* Max 1RM */}
      <View style={subCard}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Body style={{ fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }}>Max 1RM Progress</Body>
            <Mono style={{ fontSize: 8.5, color: C.muted3, marginTop: 1 }}>{rangeLabel(rmRange).toUpperCase()} · {rmSeries.count} SESSION{rmSeries.count === 1 ? '' : 'S'}</Mono>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4 }}>
            <Serif style={{ fontSize: 22, color: C.green }}>{rmSeries.headline}</Serif>
            <Body style={{ fontSize: 10.5, color: C.muted2, marginBottom: 3 }}>kg max</Body>
          </View>
        </View>
        <RangeChips options={['W', 'M', '6M']} value={rmRange} onChange={setRmRange} accent={C.green} />
        <ProgChart range={rmRange} id="ov-rm" data={rmSeries.data} labels={rmSeries.labels} color={C.green} />
      </View>

      {/* Biological Age */}
      <View style={subCard}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Body style={{ flex: 1, fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }}>Biological Age</Body>
          {latestBio?.calculation_date ? <Mono style={{ fontSize: 8.5, color: C.muted3 }}>UPDATED {istDayLabel(latestBio.calculation_date).toUpperCase()}</Mono> : null}
        </View>
        {bioRows.length === 0 ? (
          <Body style={{ fontSize: 12, color: C.muted2, textAlign: 'center', paddingVertical: 10 }}>No biological age data yet.</Body>
        ) : (
          <>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <AgeGauge
                value={latestBio?.metabolic_age != null ? `${latestBio.metabolic_age}` : '—'}
                label="Axion · Metabolic"
                delta={fmtDelta(latestBio?.metabolic_age, latestBio?.chronological_age)}
                deltaColor={(latestBio?.metabolic_age ?? 0) > (latestBio?.chronological_age ?? 0) ? C.gold : C.green}
                color={C.blue}
              />
              <View style={{ width: 1, backgroundColor: 'rgba(255,255,255,0.06)' }} />
              <AgeGauge
                value={latestBio?.mechanical_age != null ? `${latestBio.mechanical_age}` : '—'}
                label="MAQ · Mechanical"
                delta={fmtDelta(latestBio?.mechanical_age, latestBio?.chronological_age)}
                deltaColor={(latestBio?.mechanical_age ?? 0) > (latestBio?.chronological_age ?? 0) ? C.gold : C.green}
                color={C.red}
              />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ flex: 1, flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 999, padding: 3 }}>
                {(([['axion', 'Axion', C.blue], ['maq', 'MAQ', C.red]]) as ['axion' | 'maq', string, string][]).map(([id, label, col]) => {
                  const active = ageSeries === id;
                  return (
                    <Pressable key={id} onPress={() => setAgeSeries(id)} style={{ flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: 999, backgroundColor: active ? hexA(col, 0.18) : 'transparent', borderWidth: 1, borderColor: active ? hexA(col, 0.45) : 'transparent' }}>
                      <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 12, color: active ? col : C.muted }}>{label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <RangeChips options={['3M', 'All']} value={bioRange} onChange={setBioRange} accent={ageSeries === 'axion' ? C.blue : C.red} />
            </View>
            {ageSeries === 'axion' ? (
              axionPts.length >= 2 ? <AreaLine id="ov-axion" points={axionPts} color={C.blue} labels={[]} /> : <Body style={{ fontSize: 11.5, color: C.muted3, textAlign: 'center', paddingVertical: 8 }}>Not enough entries in this range for a trend.</Body>
            ) : (
              maqPts.length >= 2 ? <AreaLine id="ov-maq" points={maqPts} color={C.red} labels={[]} /> : <Body style={{ fontSize: 11.5, color: C.muted3, textAlign: 'center', paddingVertical: 8 }}>Not enough entries in this range for a trend.</Body>
            )}
          </>
        )}
      </View>
    </View>
  );
}

/* ================= 4. AI Generated Workout Plan ================= */
export function AiPlanBlock({ clientId, clientName }: { clientId: string; clientName: string }) {
  const gen = useGenerateAiPlan();
  const [plan, setPlan] = React.useState<import('../lib/coachClientQueries').AiPlan | null>(null);
  const [ctx, setCtx] = React.useState<import('../lib/coachClientQueries').AiPlanContext | null>(null);
  const [copied, setCopied] = React.useState(false);
  const run = () => gen.mutate({ clientId }, { onSuccess: (d) => { setPlan(d.plan); setCtx(d.context); setCopied(false); } });
  const copy = async () => { if (!plan) return; await Clipboard.setStringAsync(aiPlanToText(plan, clientName)); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  if (!plan && !gen.isPending) {
    return (
      <View style={{ gap: 11 }}>
        <Body style={{ fontSize: 11.5, color: C.muted2, lineHeight: 17 }}>Generate a personalised 7-day plan grounded in this client's medical history, blood markers, recent training and goals — every recommendation cites the data point behind it.</Body>
        {gen.isError ? <Body style={{ fontSize: 11.5, color: C.red }}>{(gen.error as Error).message}</Body> : null}
        <ActionButton label="Generate AI Workout Plan" icon="sparkle" filled onPress={run} />
      </View>
    );
  }
  if (gen.isPending && !plan) return <Spinner text="Analysing data and composing the plan — up to ~30s…" />;
  if (!plan) return null;

  return (
    <View style={{ gap: 11 }}>
      {ctx ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          <Badge text={`${ctx.workout_days_14d ?? 0} workout days / 14d`} color={C.blue} />
          <Badge text={`${ctx.abnormal_marker_count ?? 0} abnormal markers`} color={C.red} />
          <Badge text={`${ctx.medical_condition_count ?? 0} medical notes`} color={C.gold} />
          {ctx.avg_sleep_hours_7d != null ? <Badge text={`Avg sleep ${ctx.avg_sleep_hours_7d}h`} color={C.purple} /> : null}
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}><ActionButton label={gen.isPending ? 'Regenerating…' : 'Regenerate'} icon="sparkle" color={C.blue} disabled={gen.isPending} onPress={run} /></View>
        <View style={{ flex: 1 }}><ActionButton label={copied ? 'Copied!' : 'Copy plan'} icon="copy" color={copied ? C.green : C.orange} filled onPress={copy} /></View>
      </View>
      {gen.isError ? <Body style={{ fontSize: 11.5, color: C.red }}>{(gen.error as Error).message}</Body> : null}

      <View style={{ padding: 12, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }}>
        <MdText text={plan.summary} />
      </View>
      {plan.weekly_focus?.length ? (
        <View style={{ gap: 7 }}>
          <Mono style={{ fontSize: 9, letterSpacing: 0.8, color: C.muted3 }}>WEEKLY FOCUS</Mono>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{plan.weekly_focus.map((f, i) => <Badge key={i} text={f} color={C.orange} />)}</View>
        </View>
      ) : null}
      <Mono style={{ fontSize: 9, letterSpacing: 0.8, color: C.muted3 }}>7-DAY PLAN</Mono>
      {plan.days?.map((d, i) => {
        const rest = /rest/i.test(d.focus);
        return (
          <View key={i} style={{ padding: 12, borderRadius: 13, backgroundColor: rest ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: rest ? 'rgba(255,255,255,0.05)' : hexA(C.orange, 0.14), gap: 7, opacity: rest ? 0.75 : 1 }}>
            <Mono style={{ fontSize: 8.5, letterSpacing: 0.8, color: C.muted3 }}>{d.day_label.toUpperCase()}</Mono>
            <Body style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: rest ? C.muted : '#fff' }}>{d.focus}</Body>
            {d.blocks?.map((b, j) => (
              <Body key={j} style={{ fontSize: 11.5, color: C.ink2, lineHeight: 17 }}>
                <Text style={{ fontFamily: F.bodySemi, color: '#fff' }}>{b.name}: </Text>{b.details}
              </Body>
            ))}
            {d.references?.length ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
                {d.references.map((r, k) => (
                  <View key={k} style={{ paddingVertical: 3, paddingHorizontal: 8, borderRadius: 99, backgroundColor: hexA(C.blue, 0.1), borderWidth: 1, borderColor: hexA(C.blue, 0.25) }}>
                    <Text style={{ fontFamily: F.bodySemi, fontSize: 9, color: C.blue }}>{r}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        );
      })}
      {plan.references_global?.length ? (
        <View style={{ padding: 12, borderRadius: 12, backgroundColor: hexA(C.orange, 0.06), borderWidth: 1, borderColor: hexA(C.orange, 0.22), gap: 6 }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: C.orange }}>Why this plan — data references</Text>
          {plan.references_global.map((r, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 7 }}>
              <Text style={{ color: C.orange, fontSize: 11.5, lineHeight: 17 }}>•</Text>
              <Body style={{ flex: 1, fontSize: 11.5, color: C.ink2, lineHeight: 17 }}>{r}</Body>
            </View>
          ))}
        </View>
      ) : null}
      {plan.rationale?.length ? (
        <View style={{ padding: 12, borderRadius: 12, backgroundColor: hexA(C.blue, 0.06), borderWidth: 1, borderColor: hexA(C.blue, 0.22), gap: 9 }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: C.blue }}>Rationale & theory</Text>
          {plan.rationale.map((r, i) => (
            <View key={i} style={{ padding: 10, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.25)', gap: 4 }}>
              <Mono style={{ fontSize: 8, letterSpacing: 0.7, color: C.blue }}>DECISION</Mono>
              <Body style={{ fontSize: 11.5, color: '#fff', lineHeight: 16 }}>{r.decision}</Body>
              <Mono style={{ fontSize: 8, letterSpacing: 0.7, color: C.muted3, marginTop: 3 }}>EVIDENCE (THIS CLIENT)</Mono>
              <Body style={{ fontSize: 11, color: C.ink2, lineHeight: 16 }}>{r.evidence}</Body>
              <Mono style={{ fontSize: 8, letterSpacing: 0.7, color: C.muted3, marginTop: 3 }}>THEORY</Mono>
              <Body style={{ fontSize: 11, color: C.ink2, lineHeight: 16 }}>{r.theory}</Body>
            </View>
          ))}
        </View>
      ) : null}
      {plan.caveats?.length ? (
        <View style={{ padding: 12, borderRadius: 12, backgroundColor: hexA(C.gold, 0.06), borderWidth: 1, borderColor: hexA(C.gold, 0.25), gap: 6 }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: C.gold }}>Caveats</Text>
          {plan.caveats.map((c, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 7 }}>
              <Text style={{ color: C.gold, fontSize: 11.5, lineHeight: 17 }}>•</Text>
              <Body style={{ flex: 1, fontSize: 11.5, color: C.ink2, lineHeight: 17 }}>{c}</Body>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}
