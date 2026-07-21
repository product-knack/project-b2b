import React from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator, Modal, ScrollView, Linking, Animated, Keyboard, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C, F, hexA, ORANGE_GRAD } from '../theme';
import { Icon, IconName } from '../icons';
import { Serif, Body, Mono, Card, Avatar, ProgressBar } from '../components/primitives';
import { Page, TitleBlock, GreetingHeader, Badge, HScroll, BackLink } from './common';
import { useStore } from '../store';
import { useAuth } from '../auth';
import { useSidebarProfile } from '../lib/navQueries';
import {
  useCoachDashboard, useCoachClients, useCoachClientsOverview, useCoachTrainers, useTrainerDetail, useTrainerSessions,
  useCoachAssessments, useCoachProgramsV2, usePlanExercises, useCoachPendingPlanCount, useCoachProgression, useCoachApprovedPlans,
  useCoachPlansOverview, useCoachCalendar, qhpWindows,
  useOverviewClientDetail, useSetImprovementStatus,
  useProcessCoachPlan, useClientCriticalMarkers, useClientProgressionSummary,
  type PlanAction, type ConcerningMarker, type ProgressionClient as ProgClient, type Improvement, type ProgramPlan,
} from '../lib/coachQueries';
import { QhpCompareBlock, VolumeBlock, ImprovementsBlock, AiPlanBlock, ProgressionCharts } from './coachClientSections';
import { useClientBioAge } from '../lib/clientQueries';
import { AccountSwitch } from '../components/AccountSwitch';

/* ============ COACH workspace screens (head-of-trainers). Data layer: coachQueries.ts,
   scoped coach_trainers → trainer_clients(active) → clients. Obsidian/ember UI. ============ */

const useUid = () => useAuth().session?.user?.id ?? null;
const todayLabel = () => new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase();
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const fmtDay = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' }) : '—');
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase();

function Loading() {
  return <View style={{ paddingVertical: 46, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View>;
}
function EmptyState({ text }: { text: string }) {
  return <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 26 }}>{text}</Body>;
}
function ErrorState({ q }: { q: { isError: boolean; error: unknown } }) {
  if (!q.isError) return null;
  return <Body style={{ fontSize: 12, color: C.red, textAlign: 'center', paddingVertical: 20 }}>{(q.error as Error)?.message ?? 'Could not load data.'}</Body>;
}

function SearchBar({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 13, paddingVertical: 11, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)' }}>
      <Icon name="search" size={15} color={C.muted3} strokeWidth={2} />
      <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={C.muted3} autoCorrect={false} style={{ flex: 1, fontFamily: F.body, fontSize: 14, color: '#fff', padding: 0 }} />
      {value ? <Pressable onPress={() => onChange('')} hitSlop={8}><Icon name="close" size={13} color={C.muted3} strokeWidth={2.3} /></Pressable> : null}
    </View>
  );
}
function Chip({ label, active, onPress, color = C.orange, count }: { label: string; active: boolean; onPress: () => void; color?: string; count?: number }) {
  return (
    <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, backgroundColor: active ? hexA(color, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(color, 0.5) : 'rgba(255,255,255,0.09)' }}>
      <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 11.5, color: active ? color : C.muted }}>{label}</Text>
      {count != null ? <Text style={{ fontFamily: F.mono, fontSize: 10, color: active ? color : C.muted3 }}>{count}</Text> : null}
    </Pressable>
  );
}
function StatTile({ icon, label, value, color }: { icon: IconName; label: string; value: number | string; color: string }) {
  return (
    <Card colors={['rgba(60,38,24,0.45)', 'rgba(18,14,14,0.5)']} border={hexA(color, 0.22)} radius={16} style={{ width: '47.5%', flexGrow: 1, padding: 14 }}>
      <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: hexA(color, 0.14), alignItems: 'center', justifyContent: 'center', marginBottom: 9 }}>
        <Icon name={icon} size={15} color={color} strokeWidth={2} />
      </View>
      <Serif style={{ fontSize: 27, color }}>{value}</Serif>
      <Mono style={{ fontSize: 8.5, letterSpacing: 0.8, color: C.muted3, marginTop: 2 }}>{label}</Mono>
    </Card>
  );
}
// Vibrant per-person avatar gradients — bright fills so the dark initial stays readable.
const AV_GRADS: [string, string][] = [
  ['#FB8B3A', '#EE5E16'], ['#57C98A', '#2E9A63'], ['#7C8FE8', '#4A5AC8'],
  ['#9A7BEA', '#6E5BD0'], ['#E0A53C', '#C07C1E'], ['#4FD1C5', '#2C8A86'],
  ['#F687B3', '#C2568A'], ['#F0883E', '#C05621'],
];
const avColors = (seed: string): [string, string] => AV_GRADS[[...(seed || '?')].reduce((a, c) => a + c.charCodeAt(0), 0) % AV_GRADS.length];
function RowAvatar({ initial, seed, size = 40 }: { initial: string; seed?: string; size?: number }) {
  return <Avatar initial={initial} size={size} fontSize={size * 0.38} colors={avColors(seed ?? initial)} />;
}

/* Animated dashboard alert — pulsing glow + bell shake while plans await review. */
function PendingPlansAlert({ count, onPress }: { count: number; onPress: () => void }) {
  const pulse = React.useRef(new Animated.Value(0)).current;
  const enter = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    Animated.timing(enter, { toValue: 1, duration: 420, useNativeDriver: true }).start();
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 850, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 850, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse, enter]);
  const glow = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.18, 0.85] });
  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] });
  const ringFade = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] });
  const iconTilt = pulse.interpolate({ inputRange: [0, 0.5, 1], outputRange: ['-8deg', '8deg', '-8deg'] });
  return (
    <Animated.View style={{ opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [-10, 0] }) }] }}>
      <Pressable onPress={onPress} style={{ borderRadius: 16, overflow: 'hidden' }}>
        <LinearGradient colors={['rgba(88,52,18,0.75)', 'rgba(34,20,12,0.85)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: 13, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, borderWidth: 1, borderColor: hexA(C.gold, 0.45) }}>
          {/* pulsing glow wash */}
          <Animated.View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: hexA(C.gold, 0.09), opacity: glow }} />
          <View style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
            <Animated.View style={{ position: 'absolute', width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, borderColor: C.gold, opacity: ringFade, transform: [{ scale: ringScale }] }} />
            <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: hexA(C.gold, 0.16), borderWidth: 1, borderColor: hexA(C.gold, 0.5), alignItems: 'center', justifyContent: 'center' }}>
              <Animated.View style={{ transform: [{ rotate: iconTilt }] }}>
                <Icon name="bell" size={17} color={C.gold} strokeWidth={2.1} />
              </Animated.View>
            </View>
          </View>
          <View style={{ flex: 1 }}>
            <Body style={{ fontSize: 13.5, fontFamily: F.bodyBold, color: '#fff' }}>{count} plan{count === 1 ? '' : 's'} awaiting your review</Body>
            <Body style={{ fontSize: 11, color: hexA('#F2C066', 0.9), marginTop: 1 }}>Trainers are waiting for approval — tap to review now</Body>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, backgroundColor: hexA(C.gold, 0.16), borderWidth: 1, borderColor: hexA(C.gold, 0.45) }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: C.gold }}>Review</Text>
            <Icon name="chevRight" size={12} color={C.gold} strokeWidth={2.5} />
          </View>
        </LinearGradient>
      </Pressable>
    </Animated.View>
  );
}

/* ================= 1. DASHBOARD ================= */
export function CoachDashboard() {
  const uid = useUid();
  const prof = useSidebarProfile();
  const { go } = useStore();
  const q = useCoachDashboard(uid);
  const pendingPlans = useCoachPendingPlanCount(uid);
  const d = q.data;
  const first = (prof.fullName || 'Coach').split(' ')[0];
  const [perfVisible, setPerfVisible] = React.useState(12);

  return (
    <Page gap={16}>
      <GreetingHeader date={todayLabel()} name={`Hi, ${first}`} sub="Your trainers & clients at a glance" initial={prof.initial} avatarUrl={prof.avatarUrl} />
      <AccountSwitch />
      {(pendingPlans.data ?? 0) > 0 ? <PendingPlansAlert count={pendingPlans.data!} onPress={() => go('coach-programs')} /> : null}
      <ErrorState q={q} />
      {q.isLoading || !d ? <Loading /> : (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            <StatTile icon="crown" label="TRAINERS" value={d.totalTrainers} color={C.orange} />
            <StatTile icon="users" label="ACTIVE CLIENTS" value={d.totalClients} color={C.blue} />
            <StatTile icon="sparkle" label="NEW QHP · 7D" value={d.newAssessments} color={C.green} />
            <StatTile icon="heart" label="RE-QHP · 7D" value={d.reAssessments} color={C.gold} />
          </View>

          <View style={{ flexDirection: 'row', gap: 10 }}>
            {(([['Client Plans', 'list', 'coach-plans-overview'], ['Clients Overview', 'layers', 'coach-clients-overview']]) as [string, IconName, string][]).map(([label, ic, route]) => (
              <Card key={route} onPress={() => go(route)} colors={['rgba(56,34,21,0.5)', 'rgba(20,16,15,0.5)']} border={hexA(C.orange, 0.2)} radius={16} style={{ flex: 1, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: hexA(C.orange, 0.14), alignItems: 'center', justifyContent: 'center' }}><Icon name={ic} size={16} color={C.orange} strokeWidth={2} /></View>
                <Body style={{ flex: 1, fontSize: 12.5, fontFamily: F.bodySemi, color: '#fff' }}>{label}</Body>
                <Icon name="chevRight" size={15} color={C.muted3} strokeWidth={2.2} />
              </Card>
            ))}
          </View>

          <View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <Mono style={{ fontSize: 10.5, letterSpacing: 1.6, color: C.mono }}>TRAINER PERFORMANCE · THIS WEEK</Mono>
              <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.06)' }} />
            </View>
            {d.trainers.length === 0 ? <EmptyState text="No trainers assigned yet." /> : d.trainers.slice(0, perfVisible).map((t, i) => {
              const up = t.diffPct >= 0;
              return (
                <View key={t.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', marginBottom: 8 }}>
                  <Mono style={{ fontSize: 12, color: C.muted3, width: 18 }}>{i + 1}</Mono>
                  <RowAvatar initial={t.initial} seed={t.name} />
                  <View style={{ flex: 1 }}>
                    <Body numberOfLines={1} style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{t.name}</Body>
                    <Body style={{ fontSize: 11, color: C.muted2, marginTop: 1 }}>{t.count} session{t.count === 1 ? '' : 's'} this week</Body>
                  </View>
                  {t.count > 0 || t.prev > 0 ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, paddingVertical: 3, paddingHorizontal: 8, borderRadius: 8, backgroundColor: hexA(up ? C.green : C.red, 0.12) }}>
                      <Icon name={up ? 'trend' : 'chevDown'} size={11} color={up ? C.green : C.red} strokeWidth={2.4} />
                      <Text style={{ fontFamily: F.bodyBold, fontSize: 10.5, color: up ? C.green : C.red }}>{Math.abs(t.diffPct)}%</Text>
                    </View>
                  ) : null}
                </View>
              );
            })}
            {d.trainers.length > perfVisible ? (
              <Pressable onPress={() => setPerfVisible((v) => v + 20)} style={{ alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)', marginTop: 2 }}>
                <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: C.orange }}>Show more ({d.trainers.length - perfVisible})</Text>
              </Pressable>
            ) : perfVisible > 12 ? (
              <Pressable onPress={() => setPerfVisible(12)} style={{ alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)', marginTop: 2 }}>
                <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: C.muted }}>Show less</Text>
              </Pressable>
            ) : null}
          </View>
        </>
      )}
    </Page>
  );
}

/* ================= 2. MY CLIENTS ================= */
export function CoachClients() {
  const uid = useUid();
  const { openClient } = useStore();
  const q = useCoachClients(uid);
  const [search, setSearch] = React.useState('');
  const [visible, setVisible] = React.useState(30);
  const all = q.data ?? [];
  const term = search.trim().toLowerCase();
  const filtered = term ? all.filter((c) => c.name.toLowerCase().includes(term) || (c.email ?? '').toLowerCase().includes(term)) : all;
  const shown = filtered.slice(0, visible);

  return (
    <Page gap={14}>
      <TitleBlock title="My Clients" sub={q.data ? `${all.length} active clients across your trainers` : 'Clients across your trainers'} />
      <SearchBar value={search} onChange={(v) => { setSearch(v); setVisible(30); }} placeholder="Search by name or email…" />
      <ErrorState q={q} />
      {q.isLoading ? <Loading /> : filtered.length === 0 ? <EmptyState text={term ? 'No clients match your search.' : 'No active clients yet.'} /> : (
        <>
          {shown.map((c) => (
            <Card key={c.id} onPress={() => openClient(c.id, c.name)} colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.1)" radius={14} style={{ padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <RowAvatar initial={c.initial} seed={c.name} />
              <View style={{ flex: 1 }}>
                <Body numberOfLines={1} style={{ fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }}>{c.name}</Body>
                <Body numberOfLines={1} style={{ fontSize: 11.5, color: C.muted2, marginTop: 1 }}>{c.email || c.phone || '—'}</Body>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 5 }}>
                  <Badge text={`${c.sessions} sessions`} color={C.blue} />
                  {c.subscription ? <Badge text={c.subscription} color={C.gold} /> : null}
                </View>
              </View>
              <Icon name="chevRight" size={16} color={C.muted3} strokeWidth={2.2} />
            </Card>
          ))}
          {visible < filtered.length ? (
            <Pressable onPress={() => setVisible((v) => v + 30)} style={{ alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)' }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: C.orange }}>Load more ({filtered.length - visible})</Text>
            </Pressable>
          ) : null}
        </>
      )}
    </Page>
  );
}

/* ================= 3. CLIENTS OVERVIEW ================= */
const IMP_META: Record<Improvement, { label: string; color: string }> = {
  good: { label: 'Good', color: C.green }, average: { label: 'Average', color: C.gold }, poor: { label: 'Poor', color: C.red }, unrated: { label: 'Unrated', color: C.muted2 },
};
const IMP_KEYS: Improvement[] = ['good', 'average', 'poor', 'unrated'];
const fmtQhp = (ms: number | null) => (ms == null ? null : new Date(ms).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' }));

/* Stacked distribution bar + tappable legend (acts as the performance filter). */
function PerfSummary({ counts, active, onSelect }: { counts: { total: number; good: number; average: number; poor: number; unrated: number }; active: 'all' | Improvement; onSelect: (v: 'all' | Improvement) => void }) {
  const total = Math.max(1, counts.total);
  return (
    <Card colors={['rgba(56,34,21,0.5)', 'rgba(20,16,15,0.5)']} border={hexA(C.orange, 0.16)} radius={16} style={{ padding: 14, gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Mono style={{ flex: 1, fontSize: 10, letterSpacing: 1.4, color: C.mono }}>TEAM PERFORMANCE</Mono>
        {active !== 'all' ? (
          <Pressable onPress={() => onSelect('all')} hitSlop={8}><Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: C.orange }}>Show all</Text></Pressable>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', height: 8, borderRadius: 99, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.05)' }}>
        {IMP_KEYS.map((k) => (counts[k] > 0 ? <View key={k} style={{ flex: counts[k] / total, backgroundColor: hexA(IMP_META[k].color, active === 'all' || active === k ? 0.9 : 0.22) }} /> : null))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {IMP_KEYS.map((k) => {
          const m = IMP_META[k]; const on = active === k;
          return (
            <Pressable key={k} onPress={() => onSelect(on ? 'all' : k)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, backgroundColor: on ? hexA(m.color, 0.16) : 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: on ? hexA(m.color, 0.5) : 'rgba(255,255,255,0.08)' }}>
              <View style={{ width: 7, height: 7, borderRadius: 99, backgroundColor: m.color }} />
              <Text style={{ fontFamily: on ? F.bodyBold : F.bodySemi, fontSize: 11, color: on ? m.color : C.muted }}>{m.label}</Text>
              <Text style={{ fontFamily: F.mono, fontSize: 10, color: on ? m.color : C.muted3 }}>{counts[k]}</Text>
            </Pressable>
          );
        })}
      </View>
    </Card>
  );
}

export function CoachClientsOverview() {
  const uid = useUid();
  const { set, go } = useStore();
  const q = useCoachClientsOverview(uid);
  const [search, setSearch] = React.useState('');
  const [perf, setPerf] = React.useState<'all' | Improvement>('all');
  const [qhp, setQhp] = React.useState<'all' | 'week' | 'month' | 'none'>('all');
  const [visible, setVisible] = React.useState(30);
  const d = q.data;
  const term = search.trim().toLowerCase();
  const { week: weekMs, month: monthMs } = React.useMemo(() => qhpWindows(), []);
  const filtered = (d?.clients ?? []).filter((c) => {
    if (perf !== 'all' && c.improvement !== perf) return false;
    if (qhp === 'none' && c.latestQhpAt != null) return false;
    if (qhp === 'week' && !(c.latestQhpAt != null && c.latestQhpAt >= weekMs)) return false;
    if (qhp === 'month' && !(c.latestQhpAt != null && c.latestQhpAt >= monthMs)) return false;
    if (term && !(c.name.toLowerCase().includes(term) || (c.email ?? '').toLowerCase().includes(term))) return false;
    return true;
  });
  const shown = filtered.slice(0, visible);
  const openDetail = (c: { id: string; name: string }) => { set({ selectedClientId: c.id, selectedClientName: c.name }); go('coach-client-overview'); };

  return (
    <Page gap={13}>
      <TitleBlock title="Clients Overview" sub={d ? `${d.counts.total} subscribed clients across your trainers` : 'Performance & QHP timing'} />
      <ErrorState q={q} />
      {q.isLoading ? <Loading /> : !d ? null : (
        <>
          <PerfSummary counts={d.counts} active={perf} onSelect={(v) => { setPerf(v); setVisible(30); }} />
          <HScroll gap={7}>
            {(([['all', 'Any QHP', d.counts.total], ['week', 'This week', d.counts.qhpWeek], ['month', 'This month', d.counts.qhpMonth], ['none', 'No QHP yet', d.counts.noQhp]]) as ['all' | 'week' | 'month' | 'none', string, number][]).map(([id, label, n]) => (
              <Chip key={id} label={label} count={n} active={qhp === id} onPress={() => { setQhp(id); setVisible(30); }} color={id === 'none' ? C.red : C.blue} />
            ))}
          </HScroll>
          <SearchBar value={search} onChange={(v) => { setSearch(v); setVisible(30); }} placeholder="Search by name or email…" />
          <Body style={{ fontSize: 11, color: C.muted3 }}>Showing {shown.length} of {filtered.length} client{filtered.length === 1 ? '' : 's'}</Body>
          {filtered.length === 0 ? <EmptyState text="No clients match these filters." /> : (
            <>
              {shown.map((c) => {
                const m = IMP_META[c.improvement];
                const qhpDate = fmtQhp(c.latestQhpAt);
                return (
                  <Card key={c.id} onPress={() => openDetail(c)} colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border={hexA(m.color, c.improvement === 'unrated' ? 0.1 : 0.22)} radius={14} style={{ padding: 12, borderLeftWidth: 3, borderLeftColor: c.improvement === 'unrated' ? 'rgba(255,255,255,0.14)' : m.color, gap: 8 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                      <RowAvatar initial={c.initial} seed={c.name} />
                      <View style={{ flex: 1 }}>
                        <Body numberOfLines={1} style={{ fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }}>{c.name}</Body>
                        <Body numberOfLines={1} style={{ fontSize: 11, color: C.muted2, marginTop: 1 }}>{c.email || c.phone || '—'}</Body>
                      </View>
                      <Badge text={m.label} color={m.color} />
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <Badge text={c.subscription} color={C.gold} />
                      <Badge text={qhpDate ? `QHP ${qhpDate}` : 'No QHP'} color={qhpDate ? C.blue : C.red} />
                      <Body style={{ fontSize: 10.5, color: C.muted3, textTransform: 'capitalize' }}>{c.status}</Body>
                      <View style={{ flex: 1 }} />
                      <Icon name="chevRight" size={15} color={C.muted3} strokeWidth={2.2} />
                    </View>
                  </Card>
                );
              })}
              {visible < filtered.length ? (
                <Pressable onPress={() => setVisible((v) => v + 30)} style={{ alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)' }}>
                  <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: C.orange }}>Load more ({filtered.length - visible})</Text>
                </Pressable>
              ) : null}
            </>
          )}
        </>
      )}
    </Page>
  );
}

/* ---- Clients Overview → client detail (web /coach/clients-overview/:id) ---- */
function RatingButtons({ clientId, value }: { clientId: string; value: Improvement }) {
  const m = useSetImprovementStatus();
  const run = (next: 'good' | 'average' | 'poor') => m.mutate({ clientId, next: value === next ? null : next });
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {(['good', 'average', 'poor'] as const).map((k) => {
          const meta = IMP_META[k]; const active = value === k;
          return (
            <Pressable key={k} onPress={() => run(k)} disabled={m.isPending} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11, borderRadius: 12, backgroundColor: hexA(meta.color, active ? 0.2 : 0.05), borderWidth: 1, borderColor: hexA(meta.color, active ? 0.6 : 0.22), opacity: m.isPending ? 0.6 : 1 }}>
              <View style={{ width: 7, height: 7, borderRadius: 99, backgroundColor: meta.color }} />
              <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 12, color: active ? meta.color : C.muted }}>{meta.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {m.isError ? <Body style={{ fontSize: 11, color: C.red }}>{(m.error as Error)?.message}</Body> : null}
      <Body style={{ fontSize: 10.5, color: C.muted3 }}>{m.isPending ? 'Saving…' : value !== 'unrated' ? 'Tap the active rating again to clear it.' : 'Rate this client — the rating is shared with the whole team.'}</Body>
    </View>
  );
}

function Section({ title, icon, color, count, defaultOpen, children }: { title: string; icon: IconName; color: string; count?: number; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = React.useState(!!defaultOpen);
  return (
    <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.1)" radius={16} style={{ padding: 0 }}>
      <Pressable onPress={() => setOpen((o) => !o)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 }}>
        <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: hexA(color, 0.13), alignItems: 'center', justifyContent: 'center' }}><Icon name={icon} size={15} color={color} strokeWidth={2} /></View>
        <Body style={{ flex: 1, fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{title}</Body>
        {count != null && count > 0 ? <Badge text={`${count}`} color={color} /> : null}
        <Icon name={open ? 'chevUp' : 'chevDown'} size={14} color={C.muted3} strokeWidth={2.2} />
      </Pressable>
      {open ? <View style={{ paddingHorizontal: 14, paddingBottom: 14, gap: 10 }}>{children}</View> : null}
    </Card>
  );
}

export function CoachClientOverviewDetail() {
  const { selectedClientId, selectedClientName, back, openClient } = useStore();
  const q = useOverviewClientDetail(selectedClientId);
  const marks = useClientCriticalMarkers(selectedClientId);
  const bioQ = useClientBioAge(selectedClientId);
  const bio = (bioQ.data ?? [])[0] as any | undefined; // newest biological_age_history row
  const c = q.data;
  const qhpDate = c ? fmtQhp(c.latestQhpAt) : null;

  return (
    <Page gap={14}>
      <BackLink label="Clients Overview" onPress={back} />
      <ErrorState q={q} />
      {q.isLoading ? <Loading /> : !c ? <EmptyState text={`Could not load ${selectedClientName ?? 'this client'}.`} /> : (
        <>
          <Card colors={['rgba(56,34,21,0.5)', 'rgba(20,16,15,0.5)']} border={hexA(C.orange, 0.18)} radius={18} style={{ padding: 16, gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 13 }}>
              <RowAvatar initial={c.initial} seed={c.name} size={52} />
              <View style={{ flex: 1 }}>
                <Serif style={{ fontSize: 21 }}>{c.name}</Serif>
                <Body numberOfLines={1} style={{ fontSize: 11.5, color: C.muted2, marginTop: 2 }}>{c.email || '—'}{c.phone ? ` · ${c.phone}` : ''}</Body>
              </View>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Badge text={c.subscription} color={C.gold} />
              <Badge text={qhpDate ? `Last QHP ${qhpDate}` : 'No QHP yet'} color={qhpDate ? C.blue : C.red} />
              <Body style={{ fontSize: 11, color: C.muted3, textTransform: 'capitalize' }}>{c.status}</Body>
            </View>
          </Card>

          {/* System ages — AXION (metabolic) & MAQ (mechanical) from the latest biological_age_history row */}
          {bio && (bio.metabolic_age != null || bio.mechanical_age != null) ? (
            <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.1)" radius={16} style={{ padding: 14, gap: 11 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Mono style={{ flex: 1, fontSize: 10, letterSpacing: 1.4, color: C.mono }}>SYSTEM AGES</Mono>
                {bio.is_provisional ? <Badge text="Provisional" color={C.gold} /> : null}
                {bio.calculation_date ? <Mono style={{ fontSize: 9, color: C.muted3 }}>{fmtDate(bio.calculation_date).toUpperCase()}</Mono> : null}
              </View>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                {([
                  ['AXION', 'Metabolic Health', bio.metabolic_age, C.gold],
                  ['MAQ', 'Mechanical Health', bio.mechanical_age, C.blue],
                ] as const).map(([k, sub, v, col]) => (
                  <View key={k} style={{ flex: 1, padding: 12, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: hexA(col, 0.24) }}>
                    <Mono style={{ fontSize: 10, letterSpacing: 1, color: C.orange }}>{k}</Mono>
                    <Body style={{ fontSize: 10.5, color: C.muted2, marginTop: 1 }}>{sub}</Body>
                    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4, marginTop: 7 }}>
                      <Serif style={{ fontSize: 25, color: v != null ? '#fff' : C.muted3 }}>{v != null ? Number(v).toFixed(1) : '—'}</Serif>
                      {v != null ? <Body style={{ fontSize: 11, color: C.muted2, marginBottom: 3 }}>yrs</Body> : null}
                    </View>
                    {v != null && bio.chronological_age != null ? (
                      <Text style={{ fontFamily: F.bodySemi, fontSize: 10, color: Number(v) <= Number(bio.chronological_age) ? C.green : C.red, marginTop: 4 }}>
                        {Number(v) <= Number(bio.chronological_age) ? '▼' : '▲'} {Math.abs(Number(v) - Number(bio.chronological_age)).toFixed(1)} vs actual
                      </Text>
                    ) : null}
                  </View>
                ))}
              </View>
              {bio.chronological_age != null ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                  <Body style={{ fontSize: 11.5, color: C.muted }}>Chronological age</Body>
                  <Serif style={{ fontSize: 15 }}>{Number(bio.chronological_age).toFixed(0)} yrs</Serif>
                </View>
              ) : null}
            </Card>
          ) : null}

          <View style={{ gap: 8 }}>
            <Mono style={{ fontSize: 10, letterSpacing: 1.4, color: C.mono }}>PERFORMANCE RATING</Mono>
            <RatingButtons clientId={c.id} value={c.improvement} />
          </View>

          <Section title="AI Comparison: QHP vs QHP" icon="swap" color={C.gold} defaultOpen>
            <QhpCompareBlock clientId={c.id} />
          </Section>

          <Section title="Workout Volume Analysis" icon="chart" color={C.blue}>
            <VolumeBlock clientId={c.id} />
          </Section>

          <Section title="Progression" icon="trend" color={C.orange}>
            <ProgressionCharts clientId={c.id} />
          </Section>

          <Section title="Critical Markers" icon="heart" color={C.red} count={marks.data?.markers.length}>
            {marks.isLoading ? <Loading /> : (marks.data?.markers.length ?? 0) === 0 ? (
              <Body style={{ fontSize: 12, color: C.muted2 }}>No concerning markers in the latest report.</Body>
            ) : (
              <>
                {marks.data?.reportDate ? <Mono style={{ fontSize: 9, letterSpacing: 0.8, color: C.muted3 }}>LATEST REPORT · {fmtDate(marks.data.reportDate).toUpperCase()}</Mono> : null}
                {marks.data!.markers.map((mk, i) => {
                  const meta = MK_META[mk.status];
                  return (
                    <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: 11, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: hexA(meta.color, 0.25), borderLeftWidth: 3, borderLeftColor: meta.color }}>
                      <View style={{ flex: 1 }}>
                        <Body numberOfLines={1} style={{ fontSize: 12.5, fontFamily: F.bodySemi, color: '#fff' }}>{mk.name}</Body>
                        {mk.referenceRange ? <Mono style={{ fontSize: 8.5, color: C.muted3, marginTop: 1 }}>REF {mk.referenceRange}</Mono> : null}
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: meta.color }}>{mk.value}{mk.unit ? ` ${mk.unit}` : ''}</Text>
                        <Text style={{ fontFamily: F.bodySemi, fontSize: 9.5, color: meta.color }}>{meta.label}</Text>
                      </View>
                    </View>
                  );
                })}
              </>
            )}
          </Section>

          <Section title="Improvements" icon="trend" color={C.green}>
            <ImprovementsBlock clientId={c.id} />
          </Section>

          <Section title="AI Generated Workout Plan" icon="sparkle" color={C.purple}>
            <AiPlanBlock clientId={c.id} clientName={c.name} />
          </Section>

          <Pressable onPress={() => openClient(c.id, c.name, 'trends')} style={{ overflow: 'hidden', borderRadius: 13 }}>
            <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14 }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: '#fff' }}>Open full profile & trends</Text>
              <Icon name="arrowRight" size={15} color="#fff" strokeWidth={2.3} />
            </LinearGradient>
          </Pressable>
        </>
      )}
    </Page>
  );
}

/* ================= 4. TRAINERS (web TrainersOverview parity) ================= */
export function CoachTrainers() {
  const uid = useUid();
  const { set, go } = useStore();
  const q = useCoachTrainers(uid);
  const [search, setSearch] = React.useState('');
  const all = q.data ?? [];
  const term = search.trim().toLowerCase();
  const list = term ? all.filter((t) => t.name.toLowerCase().includes(term)) : all;
  const totals = React.useMemo(() => ({
    sessions: all.reduce((s, t) => s + t.sessions, 0),
    clients: all.reduce((s, t) => s + t.clients, 0),
  }), [all]);
  const openTrainer = (t: { id: string; name: string }) => { set({ selectedClientId: t.id, selectedClientName: t.name }); go('coach-trainer-detail'); };

  return (
    <Page gap={14}>
      <TitleBlock title="Trainers" sub="Trainers assigned to you" />
      {q.data ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {(([['crown', 'TRAINERS', all.length, C.orange], ['calendar', 'TOTAL SESSIONS', totals.sessions, C.blue], ['users', 'TOTAL CLIENTS', totals.clients, C.green]]) as [IconName, string, number, string][]).map(([ic, lab, val, col]) => (
            <Card key={lab} colors={['rgba(56,34,21,0.5)', 'rgba(20,16,15,0.5)']} border={hexA(col, 0.22)} radius={14} style={{ flex: 1, padding: 11, gap: 6 }}>
              <View style={{ width: 26, height: 26, borderRadius: 8, backgroundColor: hexA(col, 0.14), alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={ic} size={13} color={col} strokeWidth={2.1} />
              </View>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 18, color: col }}>{val.toLocaleString()}</Text>
              <Mono style={{ fontSize: 7, letterSpacing: 0.6, color: C.muted3 }}>{lab}</Mono>
            </Card>
          ))}
        </View>
      ) : null}
      <SearchBar value={search} onChange={setSearch} placeholder="Search trainers…" />
      <ErrorState q={q} />
      {q.isLoading ? <Loading /> : list.length === 0 ? <EmptyState text={term ? 'No trainers match.' : 'No trainers assigned.'} /> : list.map((t) => {
        const rate = t.attendanceRate;
        const rateCol = rate >= 80 ? C.green : rate >= 60 ? C.gold : C.red;
        return (
          <Card key={t.id} onPress={() => openTrainer(t)} colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.1)" radius={16} style={{ padding: 14, gap: 11 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <RowAvatar initial={t.initial} seed={t.name} />
              <View style={{ flex: 1 }}>
                <Body numberOfLines={1} style={{ fontSize: 14.5, fontFamily: F.bodySemi, color: '#fff' }}>{t.name}</Body>
                <Body numberOfLines={1} style={{ fontSize: 11, color: C.muted2, marginTop: 1 }}>{t.email || t.phone || '—'}</Body>
              </View>
              <Icon name="chevRight" size={16} color={C.muted3} strokeWidth={2.2} />
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {(([['CLIENTS', t.clients, C.blue], ['SESSIONS', t.sessions, C.orange]]) as [string, number, string][]).map(([lab, val, col]) => (
                <View key={lab} style={{ flex: 1, paddingVertical: 9, borderRadius: 11, backgroundColor: hexA(col, 0.08), borderWidth: 1, borderColor: hexA(col, 0.2), alignItems: 'center' }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 17, color: col }}>{val}</Text>
                  <Mono style={{ fontSize: 8, letterSpacing: 0.6, color: C.muted3, marginTop: 1 }}>{lab}</Mono>
                </View>
              ))}
            </View>
            <View style={{ gap: 5 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Mono style={{ fontSize: 9, letterSpacing: 0.8, color: C.muted3 }}>ATTENDANCE MARKED</Mono>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 11.5, color: rateCol }}>{rate}%</Text>
              </View>
              <ProgressBar pct={rate} height={5} fill={rateCol} />
            </View>
          </Card>
        );
      })}
    </Page>
  );
}

/* ---- Trainer detail (web /coach/trainers/:id — TrainerDetails.tsx) ---- */
export function CoachTrainerDetail() {
  const { selectedClientId: trainerId, selectedClientName, back } = useStore();
  const q = useTrainerDetail(trainerId);
  const [sessPage, setSessPage] = React.useState(1);
  const sess = useTrainerSessions(trainerId, sessPage);
  const [search, setSearch] = React.useState('');
  const [visible, setVisible] = React.useState(10);
  const d = q.data;
  const term = search.trim().toLowerCase();
  const clients = (d?.clients ?? []).filter((c) => !term || c.name.toLowerCase().includes(term) || (c.phone ?? '').toLowerCase().includes(term));
  const shownClients = clients.slice(0, visible);
  const sessPages = Math.max(1, Math.ceil((d?.totalSessions ?? 0) / 5));

  return (
    <Page gap={14}>
      <BackLink label="Trainers" onPress={back} />
      <ErrorState q={q} />
      {q.isLoading ? <Loading /> : !d ? <EmptyState text={`Could not load ${selectedClientName ?? 'this trainer'}.`} /> : (
        <>
          {/* Profile */}
          <Card colors={['rgba(56,34,21,0.5)', 'rgba(20,16,15,0.5)']} border={hexA(C.orange, 0.18)} radius={18} style={{ padding: 16, flexDirection: 'row', alignItems: 'center', gap: 13 }}>
            <RowAvatar initial={d.initial} seed={d.name} size={52} />
            <View style={{ flex: 1 }}>
              <Serif style={{ fontSize: 21 }}>{d.name}</Serif>
              <Body numberOfLines={1} style={{ fontSize: 11.5, color: C.muted2, marginTop: 2 }}>{d.email || '—'}</Body>
              <Body numberOfLines={1} style={{ fontSize: 11.5, color: C.muted2, marginTop: 1 }}>{d.phone || 'No phone'}</Body>
            </View>
          </Card>

          {/* Performance */}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {(([['SESSIONS · MONTH', `${d.monthSessions}`, C.blue], ['ATTENDANCE', `${d.attendanceRate}%`, d.attendanceRate >= 80 ? C.green : d.attendanceRate >= 60 ? C.gold : C.red], ['TOTAL SESSIONS', d.totalSessions.toLocaleString(), C.orange]]) as [string, string, string][]).map(([lab, val, col]) => (
              <Card key={lab} colors={['rgba(56,34,21,0.5)', 'rgba(20,16,15,0.5)']} border={hexA(col, 0.22)} radius={14} style={{ flex: 1, padding: 12, alignItems: 'center', gap: 3 }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 18, color: col }}>{val}</Text>
                <Mono style={{ fontSize: 6.5, letterSpacing: 0.6, color: C.muted3 }}>{lab}</Mono>
              </Card>
            ))}
          </View>

          {/* Recent sessions — 5 per page like the web */}
          <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.1)" radius={16} style={{ padding: 14, gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Mono style={{ flex: 1, fontSize: 9.5, letterSpacing: 1.2, color: C.mono }}>RECENT SESSIONS</Mono>
              <Mono style={{ fontSize: 8.5, color: C.muted3 }}>PAGE {sessPage} / {sessPages}</Mono>
            </View>
            {sess.isLoading ? <Loading /> : (sess.data ?? []).length === 0 ? <Body style={{ fontSize: 12, color: C.muted2, textAlign: 'center', paddingVertical: 10 }}>No sessions found.</Body> : (sess.data ?? []).map((s) => (
              <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' }}>
                <View style={{ flex: 1 }}>
                  <Body numberOfLines={1} style={{ fontSize: 12.5, fontFamily: F.bodySemi, color: '#fff' }}>{s.clientName}</Body>
                  <Body style={{ fontSize: 10, color: C.muted2, marginTop: 1 }}>{fmtDate(s.at)}{s.type ? ` · ${s.type}` : ''}</Body>
                </View>
                <Icon path={s.marked ? 'M20 6 9 17l-5-5' : 'M6 6l12 12M18 6 6 18'} size={14} color={s.marked ? C.green : C.muted3} strokeWidth={2.5} />
              </View>
            ))}
            {sessPages > 1 ? (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {(([['Previous', -1, sessPage <= 1], ['Next', 1, sessPage >= sessPages]]) as [string, number, boolean][]).map(([lab, dir, disabled]) => (
                  <Pressable key={lab} disabled={disabled} onPress={() => setSessPage((p) => p + dir)} style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)', opacity: disabled ? 0.4 : 1 }}>
                    <Text style={{ fontFamily: F.bodySemi, fontSize: 11.5, color: C.orange }}>{lab}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </Card>

          {/* All clients with approved-plan status */}
          <View style={{ gap: 10 }}>
            <Mono style={{ fontSize: 10, letterSpacing: 1.4, color: C.mono }}>ALL CLIENTS · {d.clients.length}</Mono>
            <SearchBar value={search} onChange={(v) => { setSearch(v); setVisible(10); }} placeholder="Search clients…" />
            {clients.length === 0 ? <EmptyState text={term ? 'No clients match.' : 'No clients assigned yet.'} /> : shownClients.map((c) => (
              <Card key={c.id} colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.1)" radius={14} style={{ padding: 12, gap: 7 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <RowAvatar initial={c.initial} seed={c.name} size={36} />
                  <View style={{ flex: 1 }}>
                    <Body numberOfLines={1} style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{c.name}</Body>
                    <Body numberOfLines={1} style={{ fontSize: 10.5, color: C.muted2, marginTop: 1 }}>{c.phone || 'No phone'}</Body>
                  </View>
                  <Badge text={c.status} color={c.status === 'active' ? C.green : C.muted2} />
                </View>
                {c.plan ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <Badge text={c.plan.expired ? `${c.plan.modality} · Expired` : c.plan.modality} color={c.plan.expired ? C.gold : C.green} />
                    <Mono style={{ fontSize: 8.5, letterSpacing: 0.4, color: C.muted3 }}>APPROVED {fmtDate(c.plan.approvedAt).toUpperCase()}</Mono>
                  </View>
                ) : (
                  <Body style={{ fontSize: 10.5, color: C.muted3 }}>No approved plan</Body>
                )}
              </Card>
            ))}
            {visible < clients.length ? (
              <Pressable onPress={() => setVisible((v) => v + 10)} style={{ alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)' }}>
                <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: C.orange }}>Load more ({clients.length - visible})</Text>
              </Pressable>
            ) : null}
          </View>
        </>
      )}
    </Page>
  );
}

/* ================= 5. ASSESSMENTS ================= */
export function CoachAssessments() {
  const uid = useUid();
  const q = useCoachAssessments(uid);
  const [search, setSearch] = React.useState('');
  const all = q.data ?? [];
  const term = search.trim().toLowerCase();
  const list = term ? all.filter((a) => a.clientName.toLowerCase().includes(term) || a.assessorName.toLowerCase().includes(term)) : all;

  return (
    <Page gap={14}>
      <TitleBlock title="Assessments" sub={q.data ? `${all.length} assessments across your team` : 'QHP assessments'} />
      <SearchBar value={search} onChange={setSearch} placeholder="Search by client or assessor…" />
      <ErrorState q={q} />
      {q.isLoading ? <Loading /> : list.length === 0 ? <EmptyState text={term ? 'No assessments match.' : 'No assessments yet.'} /> : list.slice(0, 120).map((a) => {
        const col = a.completed ? C.green : a.scheduled ? C.blue : C.gold;
        const label = a.completed ? 'Completed' : a.scheduled ? 'Scheduled' : 'Not scheduled';
        return (
          <Card key={a.id} colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border={hexA(col, 0.18)} radius={14} style={{ padding: 12, borderLeftWidth: 3, borderLeftColor: col, gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Body numberOfLines={1} style={{ flex: 1, fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }}>{a.clientName}</Body>
              <Badge text={label} color={col} />
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              <Body style={{ fontSize: 11.5, color: C.muted2 }}>Assessor {a.assessorName}</Body>
              {a.date ? <Body style={{ fontSize: 11.5, color: C.muted2 }}>{fmtDate(a.date)}{a.time ? ` · ${String(a.time).slice(0, 5)}` : ''}</Body> : null}
            </View>
          </Card>
        );
      })}
      {list.length > 120 ? <Body style={{ fontSize: 11, color: C.muted3, textAlign: 'center' }}>+{list.length - 120} more</Body> : null}
    </Page>
  );
}

/* ================= 6. PROGRAMS (redesigned; contracts = web CoachPrograms) ================= */
const statusCol = (s: string | null) => (s === 'approved' ? C.green : s === 'rejected' ? C.red : s === 'needs_revision' ? C.gold : C.blue);
const modalityCol = (m: string | null) => {
  const s = (m ?? '').toLowerCase();
  return s.includes('boxing') ? C.red : s.includes('yoga') ? C.purple : s.includes('strength') ? C.blue : C.muted2;
};

function MetaChip({ icon, text, color = C.muted2 }: { icon?: IconName; text: string; color?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 3.5, paddingHorizontal: 8, borderRadius: 8, backgroundColor: hexA(color, 0.1), borderWidth: 1, borderColor: hexA(color, 0.25) }}>
      {icon ? <Icon name={icon} size={10.5} color={color} strokeWidth={2.2} /> : null}
      <Text style={{ fontFamily: F.bodySemi, fontSize: 10, color }}>{text}</Text>
    </View>
  );
}

/* Bottom-sheet reader for a manual workout plan — every exercise grouped by body part
   (web WorkoutPlanView port; data via usePlanExercises). Accepts pending AND approved plans. */
type ViewerPlan = { id: string; title: string; clientName: string; trainerName: string; modality: string | null; weeks?: number | null; description?: string | null };
function PlanViewerSheet({ plan, onClose }: { plan: ViewerPlan; onClose: () => void }) {
  const q = usePlanExercises(plan.id);
  const exs = q.data ?? [];
  const groups = React.useMemo(() => {
    const map = new Map<string, typeof exs>();
    exs.forEach((e) => { const arr = map.get(e.bodyPart) ?? []; arr.push(e); map.set(e.bodyPart, arr); });
    return [...map.entries()];
  }, [exs]);
  const mc = modalityCol(plan.modality);
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}>
        <View style={{ height: '88%', backgroundColor: '#0E0A09', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.14)', paddingHorizontal: 18, paddingTop: 14 }}>
          <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 12 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: hexA(C.orange, 0.13), alignItems: 'center', justifyContent: 'center' }}><Icon name="dumbbell" size={16} color={C.orange} strokeWidth={2} /></View>
            <Serif numberOfLines={2} style={{ flex: 1, fontSize: 18 }}>{plan.title}</Serif>
            <Pressable onPress={onClose} hitSlop={8} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="close" size={13} color="#B8B2AC" strokeWidth={2.3} />
            </Pressable>
          </View>
          <Body style={{ fontSize: 11.5, color: C.muted2, marginBottom: 8 }}>{plan.clientName} · by {plan.trainerName}</Body>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {plan.modality ? <MetaChip text={plan.modality} color={mc} /> : null}
            {plan.weeks ? <MetaChip icon="clock" text={`${plan.weeks} weeks`} color={C.green} /> : null}
            <MetaChip icon="list" text={`${exs.length} exercise${exs.length === 1 ? '' : 's'}`} color={C.blue} />
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 34, gap: 12 }}>
            {plan.description ? <Body style={{ fontSize: 12, color: C.muted2, lineHeight: 17 }}>{plan.description}</Body> : null}
            {q.isLoading ? <Loading /> : q.isError ? <Body style={{ fontSize: 11.5, color: C.red }}>{(q.error as Error).message}</Body> : exs.length === 0 ? <EmptyState text="No exercises found in this plan." /> : groups.map(([part, list]) => (
              <View key={part} style={{ gap: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Mono style={{ fontSize: 10, letterSpacing: 1.2, color: C.orange }}>{part.toUpperCase()}</Mono>
                  <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.06)' }} />
                  <Mono style={{ fontSize: 9, color: C.muted3 }}>{list.length}</Mono>
                </View>
                {list.map((e, i) => (
                  <View key={e.id} style={{ padding: 12, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', gap: 8 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                      <View style={{ width: 24, height: 24, borderRadius: 8, backgroundColor: hexA(C.orange, 0.14), alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ fontFamily: F.mono, fontSize: 10.5, color: C.orange }}>{i + 1}</Text>
                      </View>
                      <Body numberOfLines={2} style={{ flex: 1, fontSize: 13, fontFamily: F.bodySemi, color: '#fff' }}>{e.name}</Body>
                      {e.superSet ? <MetaChip text={`SS ${e.superSet}`} color={C.purple} /> : null}
                    </View>
                    {(e.subActivity || e.activityType) ? <Body style={{ fontSize: 11, color: C.muted2 }}>{[e.activityType, e.subActivity].filter(Boolean).join(' · ')}</Body> : null}
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                      {e.sets ? <MetaChip text={`${e.sets} sets`} color={C.orange} /> : null}
                      {e.reps != null ? <MetaChip text={`${e.reps} reps`} color={C.blue} /> : null}
                      {e.rmPct != null ? <MetaChip text={`${e.rmPct}% RM`} color={C.green} /> : null}
                      {e.load != null ? <MetaChip text={`${e.load} kg`} color={C.green} /> : null}
                      {e.tempo ? <MetaChip text={`Tempo ${e.tempo}`} color={C.gold} /> : null}
                      {e.rest != null ? <MetaChip text={`Rest ${e.rest}s`} color={C.muted2} /> : null}
                      {e.rir != null ? <MetaChip text={`RIR ${e.rir}`} color={C.purple} /> : null}
                      {e.duration != null ? <MetaChip icon="clock" text={`${e.duration} min`} color={C.blue} /> : null}
                    </View>
                    {e.notes ? <Body style={{ fontSize: 11, color: C.muted3, fontStyle: 'italic' }}>{e.notes}</Body> : null}
                  </View>
                ))}
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function ProgramPendingCard({ plan, coachId, onView }: { plan: ProgramPlan; coachId: string; onView: () => void }) {
  const m = useProcessCoachPlan();
  const [feedback, setFeedback] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const isWorkout = plan.kind === 'workout';
  const kc = isWorkout ? C.orange : C.purple;
  const run = (action: PlanAction) => {
    if ((action === 'reject' || action === 'needs_revision') && !feedback.trim()) { setOpen(true); return; }
    m.mutate({ kind: plan.kind, id: plan.id, action, feedback, coachId });
  };
  const busy = m.isPending;
  return (
    <Card colors={['rgba(46,28,18,0.42)', 'rgba(18,14,14,0.52)']} border={hexA(kc, 0.18)} radius={16} style={{ padding: 14, gap: 10 }}>
      {/* Header — web PlanHeaderCard parity: trainer name big, "X Plan for {client}" under it */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: hexA(kc, 0.13), borderWidth: 1, borderColor: hexA(kc, 0.3), alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="user" size={16} color={kc} strokeWidth={2} />
        </View>
        <View style={{ flex: 1 }}>
          <Body numberOfLines={1} style={{ fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }}>{plan.trainerName}</Body>
          <Body numberOfLines={1} style={{ fontSize: 11, color: C.muted2, marginTop: 1 }}>{isWorkout ? 'Workout' : 'Training'} Plan for {plan.clientName}</Body>
        </View>
        <Badge text={isWorkout ? 'Workout' : 'Training'} color={kc} />
      </View>
      {plan.createdAt ? <Mono style={{ fontSize: 8.5, letterSpacing: 0.6, color: C.muted3 }}>{isWorkout ? 'CREATED' : 'UPLOADED'} {fmtDate(plan.createdAt).toUpperCase()}</Mono> : null}

      {/* Plan content box — web WorkoutPlanCard / document row parity */}
      {isWorkout ? (
        <View style={{ padding: 12, borderRadius: 13, backgroundColor: hexA(kc, 0.06), borderWidth: 1, borderColor: hexA(kc, 0.2), gap: 8 }}>
          <Body numberOfLines={2} style={{ fontSize: 13, fontFamily: F.bodySemi, color: '#fff' }}>{plan.title}</Body>
          {plan.description ? <Body numberOfLines={2} style={{ fontSize: 11.5, color: C.muted2, lineHeight: 16 }}>{plan.description}</Body> : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {plan.modality ? <MetaChip text={plan.modality} color={modalityCol(plan.modality)} /> : null}
            {plan.weeks ? <MetaChip icon="clock" text={`${plan.weeks} weeks`} color={C.green} /> : null}
          </View>
          <Pressable onPress={onView} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 11, borderRadius: 11, backgroundColor: hexA(kc, 0.12), borderWidth: 1, borderColor: hexA(kc, 0.45) }}>
            <Icon name="eye" size={14} color={kc} strokeWidth={2.2} />
            <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: kc }}>Review plan</Text>
          </Pressable>
        </View>
      ) : null}
      {plan.fileUrl ? (
        <Pressable onPress={() => Linking.openURL(plan.fileUrl!)} style={{ flexDirection: 'row', alignItems: 'center', gap: 9, padding: 11, borderRadius: 12, backgroundColor: hexA(C.blue, 0.07), borderWidth: 1, borderColor: hexA(C.blue, 0.28) }}>
          <Icon name="file" size={15} color={C.blue} strokeWidth={2} />
          <Body numberOfLines={1} style={{ flex: 1, fontSize: 11.5, color: C.blue }}>{plan.fileName || 'Attached document'}</Body>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: C.blue }}>Open</Text>
        </Pressable>
      ) : null}

      <Pressable onPress={() => setOpen((o) => !o)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Icon name={open ? 'chevUp' : 'chevDown'} size={13} color={C.muted2} strokeWidth={2.2} />
        <Body style={{ fontSize: 11.5, color: feedback.trim() ? C.green : C.muted2 }}>{feedback.trim() ? 'Feedback added' : 'Add feedback (required to reject / revise)'}</Body>
      </Pressable>
      {open ? (
        <TextInput value={feedback} onChangeText={setFeedback} placeholder="Feedback for the trainer…" placeholderTextColor={C.muted3} multiline style={{ minHeight: 64, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', padding: 11, color: '#fff', fontFamily: F.body, fontSize: 13, textAlignVertical: 'top' }} />
      ) : null}
      {m.isError ? <Body style={{ fontSize: 11, color: C.red }}>{(m.error as Error)?.message}</Body> : null}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {(([['approve', 'Approve', C.green], ['needs_revision', 'Revise', C.gold], ['reject', 'Reject', C.red]]) as [PlanAction, string, string][]).map(([action, label, col]) => {
          const disabled = busy || ((action === 'reject' || action === 'needs_revision') && !feedback.trim());
          return (
            <Pressable key={action} onPress={() => run(action)} disabled={busy} style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 11, backgroundColor: hexA(col, disabled ? 0.06 : 0.14), borderWidth: 1, borderColor: hexA(col, disabled ? 0.18 : 0.42) }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: disabled ? C.muted3 : col }}>{busy ? '…' : label}</Text>
            </Pressable>
          );
        })}
      </View>
    </Card>
  );
}

export function CoachPrograms() {
  const uid = useUid();
  const q = useCoachProgramsV2(uid);
  const [tab, setTab] = React.useState<'pending' | 'approved'>('pending');
  const [viewing, setViewing] = React.useState<ProgramPlan | null>(null);
  const d = q.data;

  return (
    <Page gap={14}>
      <TitleBlock title="Programs" sub="Review training documents & workout plans from your trainers" />

      {/* Stats */}
      {d ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {(([['clock', 'PENDING', `${d.pending.length}`, C.blue, false], ['file', 'APPROVED', 'View all', C.purple, true], ['checks', 'PROCESSED', `${d.processedTotal}`, C.green, false]]) as [IconName, string, string, string, boolean][]).map(([ic, lab, val, col, toApproved]) => (
            <Card key={lab} onPress={toApproved ? () => setTab('approved') : undefined} colors={['rgba(56,34,21,0.5)', 'rgba(20,16,15,0.5)']} border={hexA(col, 0.22)} radius={14} style={{ flex: 1, padding: 11, gap: 6 }}>
              <View style={{ width: 26, height: 26, borderRadius: 8, backgroundColor: hexA(col, 0.14), alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={ic} size={13} color={col} strokeWidth={2.1} />
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: toApproved ? 12.5 : 19, color: col }}>{val}</Text>
                {toApproved ? <Icon name="chevRight" size={12} color={col} strokeWidth={2.4} /> : null}
              </View>
              <Mono style={{ fontSize: 7.5, letterSpacing: 0.7, color: C.muted3 }}>{lab}</Mono>
            </Card>
          ))}
        </View>
      ) : null}

      {/* Tabs */}
      <View style={{ flexDirection: 'row', gap: 6, padding: 4, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.28)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' }}>
        {(([['pending', 'Pending', d?.pending.length ?? 0], ['approved', 'Approved', null]]) as ['pending' | 'approved', string, number | null][]).map(([id, label, n]) => {
          const active = tab === id;
          return (
            <Pressable key={id} onPress={() => setTab(id)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 10, borderRadius: 10, overflow: 'hidden', backgroundColor: active ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
              {active ? <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} /> : null}
              <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 12.5, color: active ? '#fff' : C.muted }}>{label}</Text>
              {n != null ? <Text style={{ fontFamily: F.mono, fontSize: 9.5, color: active ? 'rgba(255,255,255,0.85)' : C.muted3 }}>{n}</Text> : null}
            </Pressable>
          );
        })}
      </View>

      {tab === 'approved' ? <ApprovedPlansBody uid={uid} /> : (
        <>
          <ErrorState q={q} />
          {q.isLoading ? <Loading /> : !d ? null : d.pending.length === 0 ? (
            <View style={{ alignItems: 'center', gap: 10, paddingVertical: 34 }}>
              <View style={{ width: 52, height: 52, borderRadius: 17, backgroundColor: hexA(C.green, 0.1), alignItems: 'center', justifyContent: 'center' }}><Icon name="checks" size={24} color={C.green} strokeWidth={2} /></View>
              <Body style={{ fontSize: 13, fontFamily: F.bodySemi, color: '#fff' }}>All caught up</Body>
              <Body style={{ fontSize: 11.5, color: C.muted2, textAlign: 'center', maxWidth: 250 }}>Every plan has been reviewed. New submissions from your trainers will appear here.</Body>
            </View>
          ) : d.pending.map((p) => (
            <ProgramPendingCard key={p.kind + p.id} plan={p} coachId={uid ?? ''} onView={() => setViewing(p)} />
          ))}
        </>
      )}
      {viewing ? <PlanViewerSheet plan={viewing} onClose={() => setViewing(null)} /> : null}
    </Page>
  );
}

/* ================= 7. PROGRESSION ================= */
const MK_META: Record<ConcerningMarker['status'], { label: string; color: string; icon: IconName }> = {
  critical: { label: 'Critical', color: '#C6482E', icon: 'alert' },
  high: { label: 'High', color: C.red, icon: 'chevUp' },
  low: { label: 'Low', color: C.gold, icon: 'chevDown' },
};
function MiniBars({ data, color }: { data: number[]; color: string }) {
  const max = Math.max(1, ...data);
  if (!data.length) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 46 }}>
      {data.map((v, i) => (
        <View key={i} style={{ flex: 1, height: Math.max(3, (v / max) * 46), borderRadius: 3, backgroundColor: hexA(color, 0.25 + 0.55 * (v / max)) }} />
      ))}
    </View>
  );
}
function ProgressionDialog({ client, onClose, onOpenFull }: { client: ProgClient; onClose: () => void; onOpenFull: () => void }) {
  const [tab, setTab] = React.useState<'progression' | 'markers'>('progression');
  const prog = useClientProgressionSummary(client.id);
  const marks = useClientCriticalMarkers(client.id);
  const p = prog.data;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}>
        <View style={{ height: '86%', backgroundColor: '#0E0A09', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.14)', paddingHorizontal: 18, paddingTop: 14 }}>
          <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 14 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 }}>
            <RowAvatar initial={client.initial} seed={client.name} size={44} />
            <View style={{ flex: 1 }}>
              <Serif style={{ fontSize: 20 }}>{client.name}</Serif>
              <Body style={{ fontSize: 11.5, color: C.muted, marginTop: 1 }}>{client.modality}{client.subscription ? ` · ${client.subscription}` : ''}</Body>
            </View>
            <Pressable onPress={onClose} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="close" size={14} color="#B8B2AC" strokeWidth={2.3} />
            </Pressable>
          </View>

          <View style={{ flexDirection: 'row', gap: 6, padding: 4, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.28)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', marginBottom: 12 }}>
            {(([['progression', 'Progression'], ['markers', `Critical Markers${marks.data?.markers.length ? ` · ${marks.data.markers.length}` : ''}`]]) as [any, string][]).map(([id, label]) => {
              const active = tab === id;
              return (
                <Pressable key={id} onPress={() => setTab(id)} style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10, overflow: 'hidden', backgroundColor: active ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                  {active ? <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} /> : null}
                  <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 12, color: active ? '#fff' : C.muted }}>{label}</Text>
                </Pressable>
              );
            })}
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 30, gap: 12 }}>
            {tab === 'progression' ? (
              prog.isLoading ? <Loading /> : !p || p.count === 0 ? <EmptyState text="No workout analysis recorded yet." /> : (
                <>
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    {(([['LATEST LOAD', p.latestLoad != null ? `${p.latestLoad}` : '—', 'kg', C.orange], ['LATEST 1RM', p.latest1RM != null ? `${p.latest1RM}` : '—', 'kg', C.green], ['SESSIONS', `${p.count}`, 'total', C.blue]]) as [string, string, string, string][]).map(([lab, val, unit, col]) => (
                      <View key={lab} style={{ flex: 1, paddingVertical: 12, borderRadius: 13, backgroundColor: hexA(col, 0.08), borderWidth: 1, borderColor: hexA(col, 0.2), alignItems: 'center' }}>
                        <Text style={{ fontFamily: F.bodyBold, fontSize: 20, color: col }}>{val}</Text>
                        <Mono style={{ fontSize: 8, letterSpacing: 0.5, color: C.muted3, marginTop: 2 }}>{lab}</Mono>
                      </View>
                    ))}
                  </View>
                  {p.loadSeries.length >= 2 ? (
                    <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.09)" radius={14} style={{ padding: 14, gap: 10 }}>
                      <Mono style={{ fontSize: 9.5, letterSpacing: 1, color: C.mono }}>SESSION LOAD · LAST {p.loadSeries.length}</Mono>
                      <MiniBars data={p.loadSeries} color={C.orange} />
                    </Card>
                  ) : null}
                  <View style={{ gap: 8 }}>
                    <Mono style={{ fontSize: 9.5, letterSpacing: 1, color: C.mono }}>RECENT SESSIONS</Mono>
                    {p.recent.map((r, i) => (
                      <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 11, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' }}>
                        <View style={{ flex: 1 }}>
                          <Body numberOfLines={1} style={{ fontSize: 12.5, fontFamily: F.bodySemi, color: '#fff' }}>{r.type || 'Workout'}</Body>
                          <Mono style={{ fontSize: 9, color: C.muted3, marginTop: 1 }}>{fmtDay(r.date)}</Mono>
                        </View>
                        {r.load != null ? <Badge text={`${r.load} kg`} color={C.orange} /> : null}
                        {r.oneRm != null ? <Badge text={`1RM ${r.oneRm}`} color={C.green} /> : null}
                      </View>
                    ))}
                  </View>
                </>
              )
            ) : (
              marks.isLoading ? <Loading /> : (marks.data?.markers.length ?? 0) === 0 ? (
                <View style={{ alignItems: 'center', gap: 10, paddingVertical: 30 }}>
                  <View style={{ width: 46, height: 46, borderRadius: 15, backgroundColor: hexA(C.green, 0.12), alignItems: 'center', justifyContent: 'center' }}><Icon name="checks" size={22} color={C.green} strokeWidth={2} /></View>
                  <Body style={{ fontSize: 12.5, color: C.muted2, textAlign: 'center' }}>No concerning markers in the latest report.</Body>
                </View>
              ) : (
                <>
                  {marks.data?.reportDate ? <Mono style={{ fontSize: 9, letterSpacing: 0.8, color: C.muted3 }}>LATEST REPORT · {fmtDate(marks.data.reportDate).toUpperCase()}</Mono> : null}
                  {marks.data!.markers.map((mk, i) => {
                    const meta = MK_META[mk.status];
                    return (
                      <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: 12, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: hexA(meta.color, 0.25), borderLeftWidth: 3, borderLeftColor: meta.color }}>
                        <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: hexA(meta.color, 0.14), alignItems: 'center', justifyContent: 'center' }}><Icon name={meta.icon} size={15} color={meta.color} strokeWidth={2.2} /></View>
                        <View style={{ flex: 1 }}>
                          <Body numberOfLines={1} style={{ fontSize: 13, fontFamily: F.bodySemi, color: '#fff' }}>{mk.name}</Body>
                          {mk.referenceRange ? <Mono style={{ fontSize: 9, color: C.muted3, marginTop: 1 }}>REF {mk.referenceRange}</Mono> : null}
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: meta.color }}>{mk.value}{mk.unit ? ` ${mk.unit}` : ''}</Text>
                          <Text style={{ fontFamily: F.bodySemi, fontSize: 9.5, color: meta.color }}>{meta.label}</Text>
                        </View>
                      </View>
                    );
                  })}
                </>
              )
            )}
            <Pressable onPress={onOpenFull} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', marginTop: 4 }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: C.orange }}>Open full profile</Text>
              <Icon name="arrowRight" size={14} color={C.orange} strokeWidth={2.2} />
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export function CoachProgression() {
  const uid = useUid();
  const { openClient } = useStore();
  const q = useCoachProgression(uid);
  const [search, setSearch] = React.useState('');
  const [selected, setSelected] = React.useState<ProgClient | null>(null);
  const all = q.data ?? [];
  const term = search.trim().toLowerCase();
  const list = term ? all.filter((c) => c.name.toLowerCase().includes(term)) : all;

  return (
    <Page gap={14}>
      <TitleBlock title="Progression" sub="Pick a client to view their progress & health markers" />
      <SearchBar value={search} onChange={setSearch} placeholder="Search clients…" />
      <ErrorState q={q} />
      {q.isLoading ? <Loading /> : list.length === 0 ? <EmptyState text={term ? 'No clients match.' : 'No clients yet.'} /> : list.slice(0, 200).map((c) => (
        <Card key={c.id} onPress={() => setSelected(c)} colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.1)" radius={14} style={{ padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <RowAvatar initial={c.initial} />
          <View style={{ flex: 1 }}>
            <Body numberOfLines={1} style={{ fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }}>{c.name}</Body>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <Badge text={c.modality} color={c.modality === 'Hybrid' ? C.purple : C.blue} />
              {c.subscription ? <Badge text={c.subscription} color={C.gold} /> : null}
            </View>
          </View>
          <Icon name="trend" size={16} color={C.muted3} strokeWidth={2.2} />
        </Card>
      ))}
      {selected ? (
        <ProgressionDialog
          client={selected}
          onClose={() => setSelected(null)}
          onOpenFull={() => { const c = selected; setSelected(null); openClient(c.id, c.name, 'trends'); }}
        />
      ) : null}
    </Page>
  );
}

/* ================= 8. CLIENT PLANS OVERVIEW ================= */
const PLAN_STATUS_META: Record<'active' | 'expiring_soon' | 'expired', { label: string; color: string }> = {
  active: { label: 'Active', color: C.green }, expiring_soon: { label: 'Expiring', color: C.gold }, expired: { label: 'Expired', color: C.red },
};
type Opt = { value: string; label: string };

function SelectField({ label, value, options, onPress }: { label: string; value: string; options: Opt[]; onPress: () => void }) {
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
function PickerModal({ title, options, value, onSelect, onClose, searchable }: { title: string; options: Opt[]; value: string; onSelect: (v: string) => void; onClose: () => void; searchable?: boolean }) {
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
          {searchable ? <View style={{ marginBottom: 8 }}><SearchBar value={term} onChange={setTerm} placeholder="Search…" /></View> : null}
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

export function CoachPlansOverview() {
  const uid = useUid();
  const { openClient } = useStore();
  const q = useCoachPlansOverview(uid);
  const d = q.data;
  const [search, setSearch] = React.useState('');
  const [trainer, setTrainer] = React.useState('all');
  const [modality, setModality] = React.useState('all');
  const [planStatus, setPlanStatus] = React.useState<'all' | 'has_plan' | 'no_plan'>('all');
  const [expiry, setExpiry] = React.useState<'all' | 'active' | 'expiring_soon' | 'expired'>('all');
  const [visible, setVisible] = React.useState(30);
  const [openPicker, setOpenPicker] = React.useState<null | 'trainer' | 'modality' | 'planStatus' | 'expiry'>(null);

  const rows = d?.rows ?? [];
  const term = search.trim().toLowerCase();
  const list = rows.filter((r) => {
    if (trainer !== 'all' && !r.trainers.some((t) => t.id === trainer)) return false;
    if (modality !== 'all' && !r.plans.some((p) => p.modality === modality)) return false;
    if (planStatus === 'has_plan' && r.plans.length === 0) return false;
    if (planStatus === 'no_plan' && r.plans.length > 0) return false;
    if (expiry !== 'all' && !r.plans.some((p) => p.status === expiry)) return false;
    if (term && !r.name.toLowerCase().includes(term)) return false;
    return true;
  });
  const shown = list.slice(0, visible);

  const trainerOpts: Opt[] = [{ value: 'all', label: 'All Trainers' }, ...(d?.allTrainers ?? []).map((t) => ({ value: t.id, label: t.name }))];
  const modalityOpts: Opt[] = [{ value: 'all', label: 'All Modalities' }, ...(d?.allModalities ?? []).map((m) => ({ value: m, label: m }))];
  const planStatusOpts: Opt[] = [{ value: 'all', label: 'All' }, { value: 'has_plan', label: 'Has plan' }, { value: 'no_plan', label: 'No plan' }];
  const expiryOpts: Opt[] = [{ value: 'all', label: 'All' }, { value: 'active', label: 'Active' }, { value: 'expiring_soon', label: 'Expiring soon' }, { value: 'expired', label: 'Expired' }];
  const reset = () => setVisible(30);

  return (
    <Page gap={13}>
      <TitleBlock title="Client Plans Overview" sub="Monitor training plans across all clients and trainers" />
      <SearchBar value={search} onChange={(v) => { setSearch(v); reset(); }} placeholder="Search clients…" />

      {/* Filters */}
      <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.1)" radius={16} style={{ padding: 14, gap: 11 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Mono style={{ flex: 1, fontSize: 10, letterSpacing: 1.4, color: C.mono }}>FILTERS</Mono>
          {(trainer !== 'all' || modality !== 'all' || planStatus !== 'all' || expiry !== 'all') ? (
            <Pressable onPress={() => { setTrainer('all'); setModality('all'); setPlanStatus('all'); setExpiry('all'); reset(); }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: C.orange }}>Clear</Text>
            </Pressable>
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          <SelectField label="Trainer" value={trainer} options={trainerOpts} onPress={() => setOpenPicker('trainer')} />
          <SelectField label="Modality" value={modality} options={modalityOpts} onPress={() => setOpenPicker('modality')} />
          <SelectField label="Plan Status" value={planStatus} options={planStatusOpts} onPress={() => setOpenPicker('planStatus')} />
          <SelectField label="Expiry Status" value={expiry} options={expiryOpts} onPress={() => setOpenPicker('expiry')} />
        </View>
      </Card>

      {/* Count banner */}
      {d ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 11, paddingHorizontal: 13, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
          <Icon name="layers" size={14} color={C.muted2} strokeWidth={2} />
          <Body style={{ fontSize: 12.5, color: C.ink3 }}>Showing <Text style={{ fontFamily: F.bodyBold, color: '#fff' }}>{list.length}</Text> of {rows.length} clients</Body>
        </View>
      ) : null}

      <ErrorState q={q} />
      {q.isLoading ? <Loading /> : list.length === 0 ? <EmptyState text="No clients match these filters." /> : (
        <>
          {shown.map((r) => (
            <Card key={r.clientId} onPress={() => openClient(r.clientId, r.name)} colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.1)" radius={14} style={{ padding: 13, gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <RowAvatar initial={r.initial} seed={r.name} />
                <Body numberOfLines={1} style={{ flex: 1, fontSize: 14.5, fontFamily: F.bodySemi, color: '#fff' }}>{r.name}</Body>
                <Icon name="chevRight" size={16} color={C.muted3} strokeWidth={2.2} />
              </View>

              <View style={{ gap: 6 }}>
                <Mono style={{ fontSize: 8, letterSpacing: 0.7, color: C.muted3 }}>ASSIGNED TRAINERS</Mono>
                {r.trainers.length ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {r.trainers.map((t) => (
                      <View key={t.id} style={{ paddingVertical: 4, paddingHorizontal: 9, borderRadius: 999, backgroundColor: hexA(C.gold, 0.14), borderWidth: 1, borderColor: hexA(C.gold, 0.3) }}>
                        <Text style={{ fontFamily: F.bodySemi, fontSize: 10.5, color: C.gold }}>{t.name}</Text>
                      </View>
                    ))}
                  </View>
                ) : <Body style={{ fontSize: 11, color: C.muted3 }}>None assigned</Body>}
              </View>

              <View style={{ gap: 6 }}>
                <Mono style={{ fontSize: 8, letterSpacing: 0.7, color: C.muted3 }}>MODALITIES · PLAN STATUS</Mono>
                {r.plans.length ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {r.plans.map((p, i) => {
                      const meta = PLAN_STATUS_META[p.status];
                      const tag = p.status === 'expiring_soon' && p.daysLeft != null ? `${p.daysLeft}d left` : meta.label;
                      return (
                        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4, paddingHorizontal: 9, borderRadius: 999, backgroundColor: hexA(meta.color, 0.12), borderWidth: 1, borderColor: hexA(meta.color, 0.35) }}>
                          <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: meta.color }} />
                          <Text style={{ fontFamily: F.bodySemi, fontSize: 10.5, color: '#fff' }}>{p.modality}</Text>
                          <Text style={{ fontFamily: F.bodySemi, fontSize: 10, color: meta.color }}>· {tag}</Text>
                        </View>
                      );
                    })}
                  </View>
                ) : <Body style={{ fontSize: 11, color: C.muted3 }}>No approved plan</Body>}
              </View>
            </Card>
          ))}
          {visible < list.length ? (
            <Pressable onPress={() => setVisible((v) => v + 30)} style={{ alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)' }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: C.orange }}>Load more ({list.length - visible})</Text>
            </Pressable>
          ) : null}
        </>
      )}

      {openPicker === 'trainer' ? <PickerModal title="Filter by trainer" options={trainerOpts} value={trainer} onSelect={(v) => { setTrainer(v); reset(); }} onClose={() => setOpenPicker(null)} searchable /> : null}
      {openPicker === 'modality' ? <PickerModal title="Filter by modality" options={modalityOpts} value={modality} onSelect={(v) => { setModality(v); reset(); }} onClose={() => setOpenPicker(null)} /> : null}
      {openPicker === 'planStatus' ? <PickerModal title="Plan status" options={planStatusOpts} value={planStatus} onSelect={(v) => { setPlanStatus(v as any); reset(); }} onClose={() => setOpenPicker(null)} /> : null}
      {openPicker === 'expiry' ? <PickerModal title="Expiry status" options={expiryOpts} value={expiry} onSelect={(v) => { setExpiry(v as any); reset(); }} onClose={() => setOpenPicker(null)} /> : null}
    </Page>
  );
}

/* ================= 9. APPROVED PLANS ================= */
/* Approved plans list — shared by the Programs "Approved" tab and the standalone route. */
function ApprovedPlansBody({ uid }: { uid: string | null }) {
  const q = useCoachApprovedPlans(uid);
  const [search, setSearch] = React.useState('');
  const [visible, setVisible] = React.useState(20);
  const [viewing, setViewing] = React.useState<{ id: string; title: string; clientName: string; trainerName: string; modality: string | null } | null>(null);
  const all = q.data ?? [];
  const term = search.trim().toLowerCase();
  const list = term ? all.filter((p) => p.title.toLowerCase().includes(term) || p.clientName.toLowerCase().includes(term) || p.trainerName.toLowerCase().includes(term) || (p.modality ?? '').toLowerCase().includes(term)) : all;
  const shown = list.slice(0, visible);

  return (
    <>
      <SearchBar value={search} onChange={(v) => { setSearch(v); setVisible(20); }} placeholder="Search by plan, client, trainer or modality…" />
      <ErrorState q={q} />
      {q.isLoading ? <Loading /> : list.length === 0 ? <EmptyState text={term ? 'No plans match.' : 'No approved plans yet.'} /> : (
        <>
          <Body style={{ fontSize: 11, color: C.muted3 }}>Showing {shown.length} of {list.length} approved plan{list.length === 1 ? '' : 's'}{term ? ` matching "${search.trim()}"` : ''}</Body>
          {shown.map((p) => (
            <Card key={p.kind + p.id} colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border={hexA(C.green, 0.14)} radius={14} style={{ padding: 12, gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: hexA(p.kind === 'workout' ? C.orange : C.purple, 0.13), alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={p.kind === 'workout' ? 'dumbbell' : 'file'} size={15} color={p.kind === 'workout' ? C.orange : C.purple} strokeWidth={2} />
                </View>
                <View style={{ flex: 1 }}>
                  <Body numberOfLines={1} style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{p.title}</Body>
                  <Body numberOfLines={1} style={{ fontSize: 11, color: C.muted2, marginTop: 1 }}>{p.clientName} · by {p.trainerName}</Body>
                </View>
                <Badge text="Approved" color={C.green} />
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <MetaChip text={p.kind === 'workout' ? 'Workout plan' : 'Training doc'} color={p.kind === 'workout' ? C.orange : C.purple} />
                {p.modality ? <MetaChip text={p.modality} color={modalityCol(p.modality)} /> : null}
                {p.createdAt ? <Mono style={{ fontSize: 8.5, letterSpacing: 0.5, color: C.muted3 }}>{fmtDate(p.createdAt).toUpperCase()}</Mono> : null}
                <View style={{ flex: 1 }} />
                <Pressable
                  onPress={() => { if (p.kind === 'workout') setViewing({ id: p.id, title: p.title, clientName: p.clientName, trainerName: p.trainerName, modality: p.modality }); else if (p.fileUrl) Linking.openURL(p.fileUrl); }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 7, paddingHorizontal: 12, borderRadius: 10, backgroundColor: hexA(C.blue, 0.1), borderWidth: 1, borderColor: hexA(C.blue, 0.35) }}
                >
                  <Icon name="eye" size={12.5} color={C.blue} strokeWidth={2.2} />
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: C.blue }}>View plan</Text>
                </Pressable>
              </View>
            </Card>
          ))}
          {visible < list.length ? (
            <Pressable onPress={() => setVisible((v) => v + 20)} style={{ alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)' }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: C.orange }}>Load more ({list.length - visible})</Text>
            </Pressable>
          ) : null}
        </>
      )}
      {viewing ? <PlanViewerSheet plan={viewing} onClose={() => setViewing(null)} /> : null}
    </>
  );
}

export function CoachApprovedPlans() {
  const uid = useUid();
  return (
    <Page gap={14}>
      <TitleBlock title="Approved Plans" sub="All approved training documents & workout plans from your trainers" />
      <ApprovedPlansBody uid={uid} />
    </Page>
  );
}

/* ================= 10. CALENDAR (team sessions by day) ================= */
export function CoachCalendar() {
  const uid = useUid();
  const [offset, setOffset] = React.useState(0);
  const q = useCoachCalendar(uid, offset);
  const list = q.data ?? [];
  const done = list.filter((s) => s.done).length;
  const pct = list.length ? Math.round((done / list.length) * 100) : 0;
  const days = React.useMemo(() => Array.from({ length: 11 }, (_, i) => i - 3), []);
  const dayLabel = (o: number) => { const dd = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })); dd.setDate(dd.getDate() + o); return { dow: dd.toLocaleDateString('en-IN', { weekday: 'short' }).toUpperCase(), day: dd.getDate(), tag: o === 0 ? 'TODAY' : null }; };

  return (
    <Page gap={14}>
      <TitleBlock title="Calendar" sub="Your team's sessions" />
      <HScroll gap={8}>
        {days.map((o) => {
          const l = dayLabel(o); const sel = o === offset;
          return (
            <Pressable key={o} onPress={() => setOffset(o)} style={{ width: 56, alignItems: 'center', paddingVertical: 9, borderRadius: 13, backgroundColor: sel ? hexA(C.orange, 0.15) : 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: sel ? hexA(C.orange, 0.45) : 'rgba(255,255,255,0.08)' }}>
              <Mono style={{ fontSize: 8.5, letterSpacing: 0.8, color: sel ? C.orange : C.muted3 }}>{l.tag ?? l.dow}</Mono>
              <Serif style={{ fontSize: 19, color: sel ? C.orange : C.ink, marginTop: 2 }}>{l.day}</Serif>
            </Pressable>
          );
        })}
      </HScroll>
      {q.isLoading ? <Loading /> : (
        <>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {(([['SESSIONS', list.length, '#fff'], ['DONE', done, C.green], ['COMPLETION', `${pct}%`, C.orange]]) as [string, any, string][]).map(([lab, val, col]) => (
              <View key={lab} style={{ flex: 1, paddingVertical: 11, borderRadius: 13, backgroundColor: hexA(col === '#fff' ? C.blue : col, 0.08), borderWidth: 1, borderColor: hexA(col === '#fff' ? C.blue : col, 0.2), alignItems: 'center' }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 18, color: col }}>{val}</Text>
                <Mono style={{ fontSize: 8, letterSpacing: 0.6, color: C.muted3, marginTop: 1 }}>{lab}</Mono>
              </View>
            ))}
          </View>
          {list.length === 0 ? <EmptyState text="No sessions scheduled for this day." /> : list.map((s) => {
            const col = s.done ? C.green : s.status === 'cancelled' ? C.red : C.blue;
            return (
              <Card key={s.id} colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border={hexA(col, 0.16)} radius={13} style={{ padding: 12, borderLeftWidth: 3, borderLeftColor: col, gap: 5 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Body numberOfLines={1} style={{ flex: 1, fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{s.clientName}</Body>
                  <Badge text={s.done ? 'Completed' : s.status === 'cancelled' ? 'Cancelled' : 'Scheduled'} color={col} />
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                  <Body style={{ fontSize: 11.5, color: C.muted2 }}>{fmtTime(s.at)}</Body>
                  <Body style={{ fontSize: 11.5, color: C.muted2 }}>Trainer {s.trainerName}</Body>
                  {s.type ? <Body style={{ fontSize: 11.5, color: C.muted3 }}>{s.type}</Body> : null}
                </View>
              </Card>
            );
          })}
        </>
      )}
    </Page>
  );
}
