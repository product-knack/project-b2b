import React from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Alert, Animated, Easing, Modal, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useRescheduleRequests, useApproveReschedule, useRejectReschedule, useRosterRequests, useReviewRosterRequest, RescheduleReq, RosterReq } from '../lib/approvalQueries';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, F, hexA, ORANGE_GRAD, tones } from '../theme';
import { Icon } from '../icons';
import { useStore } from '../store';
import { Serif, Body, Mono, Card, StatCard, QuickAction, IconChip, GradientButton, ProgressBar, Avatar } from '../components/primitives';
import { Page, GreetingHeader, TitleBlock, BackLink, MiniStat, Badge, MiniAvatar, AnimChip } from './common';
import { useSidebarProfile } from '../lib/navQueries';
import { useAuth } from '../auth';
import { useClientThreadsUnread } from '../lib/clientThreadQueries';
import { ClientThreadsCard } from '../components/clientThreadsCard';
import { CountUp } from '../components/primitives';
import { useCrmProfile, useCrmMetrics, useBirthdaysToday, useCrmEndedPauses, EndedPause, useCrmReferralsList, useCrmChurnList } from '../lib/crmQueries';
import { useCrmIncentives } from '../lib/crmTabQueries';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCrmCommsBook, useMarkCommDone } from '../lib/crmClientQueries';
import { CrmWorkspace, RetentionBreakdownSheet } from './crmTabs';
import {
  crmStats, crmBanners, crmRenewals, roadmapDef, stageDefs, onboardCards, journeyCards,
  salesRows, salesCtas, apprTabDefs, apprItems, bloodTabDefs, bloodRows, consumeList,
  serviceRows, rosterList, qhpCrmList, qhpSteps, escTabDefs, escRows, tasksCols, chipDays,
} from '../data';

/* ---------- Birthday card — the app's own celebration moment: warm obsidian
   card, ember→gold candle glow, Serif headline, drifting ember sparks. ---------- */
function BirthdaySpark({ delay, x, size, color }: { delay: number; x: number; size: number; color: string }) {
  const t = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    Animated.loop(Animated.sequence([
      Animated.delay(delay),
      Animated.timing(t, { toValue: 1, duration: 2600, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(t, { toValue: 0, duration: 0, useNativeDriver: true }),
    ])).start();
  }, []);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute', bottom: 6, left: x, width: size, height: size, borderRadius: size / 2, backgroundColor: color,
        opacity: t.interpolate({ inputRange: [0, 0.15, 0.75, 1], outputRange: [0, 0.9, 0.35, 0] }),
        transform: [
          { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, -58] }) },
          { translateX: t.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, size, -size] }) },
        ],
      }}
    />
  );
}
function BirthdayBanner({ crmId }: { crmId: string | null }) {
  const { go } = useStore();
  const bQ = useBirthdaysToday(crmId);
  const enter = React.useRef(new Animated.Value(0)).current;
  const glow = React.useRef(new Animated.Value(0)).current;
  const today = bQ.data?.today ?? [];
  const weekCount = bQ.data?.weekCount ?? 0;
  // No dismiss — appears on the birthday, disappears by itself the next day.
  const show = today.length > 0;

  React.useEffect(() => {
    if (!show) return;
    Animated.spring(enter, { toValue: 1, friction: 7, tension: 55, useNativeDriver: true }).start();
    // Candle-glow breathing on the cake ring.
    Animated.loop(Animated.sequence([
      Animated.timing(glow, { toValue: 1, duration: 1500, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(glow, { toValue: 0, duration: 1500, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ])).start();
  }, [show]);

  if (!show) return null;
  const first = today[0];
  const names = today.map((b) => b.name).join(' & ');
  const headline = today.length === 1
    ? `${first.name} turns ${first.ageTurning} today`
    : `${names} have birthdays today`;
  const openBirthdays = () => go('crm-birthdays');

  return (
    <Animated.View style={{ opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [-14, 0] }) }, { scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) }] }}>
      <Pressable onPress={openBirthdays} style={{ borderRadius: 19, overflow: 'hidden', borderWidth: 1, borderColor: hexA(C.gold, 0.35), backgroundColor: 'rgba(30,21,12,0.92)' }}>
        {/* ember → gold accent strip */}
        <LinearGradient colors={[C.orange, C.gold]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 3 }} />
        {/* warm inner wash */}
        <LinearGradient colors={[hexA(C.gold, 0.12), 'rgba(0,0,0,0)']} start={{ x: 0, y: 0 }} end={{ x: 0.8, y: 1 }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
        {/* drifting ember sparks rising off the card */}
        <BirthdaySpark delay={0} x={54} size={4} color={hexA(C.gold, 0.9)} />
        <BirthdaySpark delay={900} x={70} size={3} color={hexA(C.orange, 0.9)} />
        <BirthdaySpark delay={1700} x={44} size={3} color={hexA(C.gold, 0.7)} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 13, padding: 14 }}>
          {/* cake in a breathing gold ring */}
          <View style={{ width: 50, height: 50, alignItems: 'center', justifyContent: 'center' }}>
            <Animated.View style={{ position: 'absolute', width: 50, height: 50, borderRadius: 25, backgroundColor: hexA(C.gold, 0.16), transform: [{ scale: glow.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.12] }) }], opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }} />
            <View style={{ width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: hexA(C.gold, 0.1), borderWidth: 1, borderColor: hexA(C.gold, 0.45) }}>
              <Text style={{ fontSize: 19 }}>🎂</Text>
            </View>
          </View>
          <View style={{ flex: 1 }}>
            <Mono style={{ fontSize: 8, letterSpacing: 1.4, color: C.gold }}>CLIENT BIRTHDAY · TODAY</Mono>
            <Serif style={{ fontSize: 18, marginTop: 3, lineHeight: 22 }}>{headline}</Serif>
            <Body style={{ fontSize: 11, color: C.muted2, marginTop: 3 }}>
              Tap to see all upcoming birthdays{weekCount ? `  ·  ${weekCount} more this week` : ''}
            </Body>
          </View>
          <Icon name="chevRight" size={16} color={C.gold} strokeWidth={2.3} />
        </View>
      </Pressable>
    </Animated.View>
  );
}

/* ---------- Pause-Ended alert — clients whose pause period lapsed and are now
   active again. Fresh animated card: green→blue "resumed" glow, a breathing play
   ring, a count pill, and a tap-to-expand roster with per-row Open / Dismiss. --- */
const PAUSE_DISMISS_KEY = 'crm-pause-ended-dismissed';
function PauseEndedBanner({ crmId }: { crmId: string | null }) {
  const { set, go } = useStore();
  const pausesQ = useCrmEndedPauses(crmId);
  const all = pausesQ.data ?? [];
  const [dismissed, setDismissed] = React.useState<Set<string>>(new Set());
  const [loaded, setLoaded] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);
  const enter = React.useRef(new Animated.Value(0)).current;
  const glow = React.useRef(new Animated.Value(0)).current;

  const keyOf = (p: EndedPause) => `${p.clientId}:${p.pauseEnd}`;
  const persist = (s: Set<string>) => { setDismissed(new Set(s)); AsyncStorage.setItem(PAUSE_DISMISS_KEY, JSON.stringify([...s])).catch(() => {}); };

  React.useEffect(() => {
    AsyncStorage.getItem(PAUSE_DISMISS_KEY).then((raw) => {
      if (raw) { try { setDismissed(new Set(JSON.parse(raw))); } catch { /* noop */ } }
      setLoaded(true);
    });
  }, []);

  const visible = all.filter((p) => !dismissed.has(keyOf(p)));
  const show = loaded && visible.length > 0;

  // Prune dismissals that have aged out of the 14-day window.
  React.useEffect(() => {
    if (!all.length) return;
    const valid = new Set(all.map(keyOf));
    const next = new Set([...dismissed].filter((k) => valid.has(k)));
    if (next.size !== dismissed.size) persist(next);
  }, [pausesQ.data]);

  React.useEffect(() => {
    if (!show) return;
    Animated.spring(enter, { toValue: 1, friction: 7, tension: 55, useNativeDriver: true }).start();
    Animated.loop(Animated.sequence([
      Animated.timing(glow, { toValue: 1, duration: 1500, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(glow, { toValue: 0, duration: 1500, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ])).start();
  }, [show]);

  if (!show) return null;
  const openClient = (p: EndedPause) => { set({ selectedClientId: p.clientId, selectedClientName: p.clientName }); go('crm-client'); };
  const dismissOne = (p: EndedPause) => { const n = new Set(dismissed); n.add(keyOf(p)); persist(n); };
  const dismissAll = () => { const n = new Set(dismissed); visible.forEach((p) => n.add(keyOf(p))); persist(n); };
  const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });
  const headline = visible.length === 1 ? `${visible[0].clientName} is back from pause` : `${visible.length} clients are back from pause`;
  const ACC = C.green;

  return (
    <Animated.View style={{ opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [-14, 0] }) }, { scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) }] }}>
      <View style={{ borderRadius: 19, overflow: 'hidden', borderWidth: 1, borderColor: hexA(ACC, 0.32), backgroundColor: 'rgba(14,24,20,0.92)' }}>
        {/* green → blue "reactivated" accent strip */}
        <LinearGradient colors={[C.green, C.blue]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 3 }} />
        <LinearGradient colors={[hexA(ACC, 0.12), 'rgba(0,0,0,0)']} start={{ x: 0, y: 0 }} end={{ x: 0.8, y: 1 }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />

        {/* Header — tap to expand/collapse */}
        <Pressable onPress={() => setExpanded((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 13, padding: 14 }}>
          <View style={{ width: 50, height: 50, alignItems: 'center', justifyContent: 'center' }}>
            <Animated.View style={{ position: 'absolute', width: 50, height: 50, borderRadius: 25, backgroundColor: hexA(ACC, 0.16), transform: [{ scale: glow.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.12] }) }], opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }} />
            <View style={{ width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: hexA(ACC, 0.1), borderWidth: 1, borderColor: hexA(ACC, 0.45) }}>
              <Icon path="M8 5v14l11-7z" size={18} color={ACC} strokeWidth={2.2} />
            </View>
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
              <Mono style={{ fontSize: 8, letterSpacing: 1.4, color: ACC }}>BACK FROM PAUSE · NOW ACTIVE</Mono>
              <View style={{ minWidth: 18, height: 16, paddingHorizontal: 5, borderRadius: 8, backgroundColor: hexA(ACC, 0.2), borderWidth: 1, borderColor: hexA(ACC, 0.45), alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 9.5, color: ACC }}>{visible.length}</Text>
              </View>
            </View>
            <Serif style={{ fontSize: 18, marginTop: 3, lineHeight: 22 }} numberOfLines={1}>{headline}</Serif>
            <Body style={{ fontSize: 11, color: C.muted2, marginTop: 3 }}>Their pause period ended · tap to {expanded ? 'hide' : 'see who returned'}</Body>
          </View>
          <Icon name={expanded ? 'chevUp' : 'chevDown'} size={16} color={ACC} strokeWidth={2.3} />
        </Pressable>

        {/* Expanded roster */}
        {expanded ? (
          <View style={{ paddingHorizontal: 14, paddingBottom: 14, gap: 8 }}>
            {visible.slice(0, 20).map((p) => (
              <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 11, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.28)', borderWidth: 1, borderColor: hexA(ACC, 0.18), borderLeftWidth: 3, borderLeftColor: ACC }}>
                <View style={{ flex: 1 }}>
                  <Body numberOfLines={1} style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{p.clientName}</Body>
                  <Body numberOfLines={1} style={{ fontSize: 10.5, color: C.muted2, marginTop: 2 }}>Paused {fmt(p.pauseStart)} → {fmt(p.pauseEnd)}{p.reason ? ` · ${p.reason}` : ''}</Body>
                </View>
                <Pressable onPress={() => openClient(p)} hitSlop={6} style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, backgroundColor: hexA(ACC, 0.14), borderWidth: 1, borderColor: hexA(ACC, 0.4) }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 10.5, color: ACC }}>Open</Text>
                </Pressable>
                <Pressable onPress={() => dismissOne(p)} hitSlop={6} style={{ width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}>
                  <Icon name="close" size={12} color={C.muted} strokeWidth={2.4} />
                </Pressable>
              </View>
            ))}
            {visible.length > 20 ? <Body style={{ fontSize: 10.5, color: C.muted3, textAlign: 'center' }}>+{visible.length - 20} more</Body> : null}
            {visible.length > 1 ? (
              <Pressable onPress={dismissAll} style={{ alignSelf: 'center', marginTop: 2, paddingVertical: 8, paddingHorizontal: 18, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 11.5, color: C.muted }}>Dismiss all</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
    </Animated.View>
  );
}

/* ============ CRM DASHBOARD ============ */
export function CrmDashboard() {
  const { set, go } = useStore();
  const { session } = useAuth();
  const crmId = session?.user?.id ?? null;
  // Live data — mirrors the web CRM dashboard's contracts (see crmQueries.ts).
  // Urgency lives in the workspace's Action Center; the dashboard itself only
  // needs profile, KPI metrics, and the thread unread badge.
  const profileQ = useCrmProfile(crmId);
  const metricsQ = useCrmMetrics(crmId);
  const { unread: threadUnread } = useClientThreadsUnread(crmId, 'crm');

  const firstName = profileQ.data?.firstName ?? 'there';
  const sideProf = useSidebarProfile();
  const [retentionOpen, setRetentionOpen] = React.useState(false);
  // Referral + package-upsell cards (counts shared with the incentives panel via react-query).
  const incentQ = useCrmIncentives(crmId);
  const inc = incentQ.data;
  const [refOpen, setRefOpen] = React.useState(false);
  const churnQ = useCrmChurnList(crmId);
  const [churnOpen, setChurnOpen] = React.useState(false);
  const hour = Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }));
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const m = metricsQ.data;

  return (
    <Page scrollKey="crm-dashboard">
      <GreetingHeader
        date={new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: '2-digit', month: 'short' }).replace(',', ' ·').toUpperCase()}
        name={`${greeting}, ${firstName}`}
        sub="Your client success overview"
        initial={(firstName[0] || 'C').toUpperCase()}
        avatarUrl={sideProf.avatarUrl}
      />
      {/* Birthday alert — shows only when a client's birthday is today */}
      <BirthdayBanner crmId={crmId} />
      {/* Pause-ended alert — clients whose pause lapsed and are active again */}
      <PauseEndedBanner crmId={crmId} />
      {/* Client Threads — one team chat per client (trainers + CRMs + doctors) */}
      <ClientThreadsCard onPress={() => go('client-threads')} unread={threadUnread} />
      {/* KPI stats — live (mirrors web useCRMMetrics). Total Clients opens My Clients;
          Retention opens its 30-day breakdown sheet. */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {([
          { label: 'TOTAL CLIENTS', value: m?.totalClients ?? 0, suffix: '', color: C.orange, icon: 'users' as const, onPress: () => go('crm-clients'), sub: `${m?.activeLast30 ?? 0} active in last 30 days` },
          { label: 'RETENTION 30D', value: m?.retentionPct ?? 0, suffix: '%', color: C.green, icon: 'trend' as const, onPress: () => setRetentionOpen(true), sub: 'tap for breakdown' },
          { label: 'REFERRALS', value: (inc?.approvedReferrals ?? 0) + (inc?.pendingReferrals ?? 0), suffix: '', color: C.purple, icon: 'gift' as const, onPress: () => setRefOpen(true), sub: `${inc?.approvedReferrals ?? 0} approved · ${inc?.pendingReferrals ?? 0} pending` },
          { label: 'CHURN SO FAR', value: (churnQ.data ?? []).length, suffix: '', color: C.red, icon: 'alert' as const, onPress: () => setChurnOpen(true), sub: (churnQ.data ?? []).length ? 'discontinued clients · tap for breakdown' : 'no churned clients' },
        ]).map((s) => (
          <Pressable key={s.label} onPress={s.onPress} style={{ width: '47.5%', flexGrow: 1, borderRadius: 17, backgroundColor: 'rgba(24,17,14,0.55)', borderWidth: 1, borderColor: hexA(s.color, 0.2), overflow: 'hidden' }}>
            <LinearGradient colors={[hexA(s.color, 0.5), 'rgba(255,255,255,0.02)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 3 }} />
            <View style={{ padding: 13, gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Mono style={{ fontSize: 8.5, letterSpacing: 0.8, color: C.muted3 }}>{s.label}</Mono>
                <View style={{ width: 26, height: 26, borderRadius: 9, backgroundColor: hexA(s.color, 0.14), alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={s.icon} size={13} color={s.color} strokeWidth={2} />
                </View>
              </View>
              {metricsQ.isLoading ? (
                <Serif style={{ fontSize: 26, color: C.muted3 }}>—</Serif>
              ) : (
                <View style={{ gap: 3 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
                      <CountUp value={s.value} style={{ fontSize: 26, color: s.color }} />
                      {s.suffix ? <Serif style={{ fontSize: 16, color: hexA(s.color, 0.7), marginBottom: 2 }}>{s.suffix}</Serif> : null}
                    </View>
                    <Icon name="chevRight" size={15} color={hexA(s.color, 0.7)} strokeWidth={2.3} />
                  </View>
                  {s.sub ? <Body numberOfLines={1} style={{ fontSize: 9.5, color: C.muted2 }}>{s.sub}</Body> : null}
                </View>
              )}
            </View>
          </Pressable>
        ))}
      </View>

      {/* Workspace — Action Center + queue tiles; each opens its full-screen section */}
      <CrmWorkspace crmId={crmId} />

      {/* Retention 30D tile drill-down */}
      <RetentionBreakdownSheet crmId={crmId} open={retentionOpen} onClose={() => setRetentionOpen(false)} />
      <ReferralsSheet crmId={crmId} open={refOpen} onClose={() => setRefOpen(false)} />
      <ChurnSheet rows={churnQ.data ?? []} loading={churnQ.isPending} error={churnQ.isError ? (churnQ.error as Error).message : null} open={churnOpen} onClose={() => setChurnOpen(false)} />
    </Page>
  );
}

/* ---------- Churn breakdown sheet (dashboard card drill-down) ---------- */
function ChurnSheet({ rows, loading, error, open, onClose }: { rows: import('../lib/crmQueries').CrmChurnRow[]; loading: boolean; error: string | null; open: boolean; onClose: () => void }) {
  const { set, go } = useStore();
  const fmtD = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: '2-digit' }) : '—');
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' }}>
        <Pressable onPress={() => {}} style={{ maxHeight: '80%', backgroundColor: '#171210', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.15)', paddingHorizontal: 18, paddingTop: 16, paddingBottom: 26 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 12 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: C.red }} />
            <View style={{ flex: 1 }}>
              <Serif style={{ fontSize: 19, color: '#fff' }}>Churn So Far</Serif>
              <Body style={{ fontSize: 10.5, color: C.muted3, marginTop: 1 }}>Your clients now discontinued — newest first</Body>
            </View>
            <View style={{ minWidth: 26, height: 24, paddingHorizontal: 8, borderRadius: 12, backgroundColor: hexA(C.red, 0.15), borderWidth: 1, borderColor: hexA(C.red, 0.4), alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: C.red }}>{rows.length}</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="close" size={15} color={C.muted2} />
            </Pressable>
          </View>
          {loading ? (
            <View style={{ paddingVertical: 36, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View>
          ) : error ? (
            <Body style={{ fontSize: 12, color: C.red, textAlign: 'center', paddingVertical: 22 }}>{error}</Body>
          ) : rows.length === 0 ? (
            <Body style={{ fontSize: 12, color: C.muted3, textAlign: 'center', paddingVertical: 22 }}>No churned clients — nobody assigned to you has discontinued. 🎉</Body>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false} style={{ flexShrink: 1 }} nestedScrollEnabled>
              {rows.map((r) => (
                <Pressable key={r.clientId} onPress={() => { set({ selectedClientId: r.clientId, selectedClientName: r.name }); onClose(); go('crm-client'); }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' }}>
                  <MiniAvatar initial={(r.name[0] ?? '?').toUpperCase()} colors={['#E76A52', '#B03A2E']} size={34} />
                  <View style={{ flex: 1 }}>
                    <Body numberOfLines={1} style={{ fontSize: 13, fontFamily: F.bodySemi, color: '#fff' }}>{r.name}</Body>
                    <Body numberOfLines={1} style={{ fontSize: 10, color: C.muted3, marginTop: 1 }}>
                      {[r.subscription, r.reason ? r.reason.replace(/_/g, ' ') : null].filter(Boolean).join(' · ') || 'No reason recorded'}
                    </Body>
                    {r.details ? <Body numberOfLines={2} style={{ fontSize: 9.5, color: C.muted2, marginTop: 1 }}>{r.details}</Body> : null}
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 2 }}>
                    <Badge text="Discontinued" color={C.red} />
                    <Mono style={{ fontSize: 8.5, color: C.muted3 }}>{fmtD(r.discontinuedAt)}</Mono>
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/* ---------- Referrals breakdown sheet (dashboard card drill-down) ---------- */
function ReferralsSheet({ crmId, open, onClose }: { crmId: string | null; open: boolean; onClose: () => void }) {
  const q = useCrmReferralsList(crmId, open);
  const [filter, setFilter] = React.useState<'all' | 'approved' | 'pending' | 'rejected'>('all');
  React.useEffect(() => { if (open) setFilter('all'); }, [open]);
  const rows = (q.data ?? []).filter((r) => filter === 'all' || r.status === filter);
  const count = (s: string) => (q.data ?? []).filter((r) => r.status === s).length;
  const statCol = (s: string) => (s === 'approved' ? C.green : s === 'rejected' ? C.red : C.gold);
  const fmtD = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: '2-digit' }) : '—');
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' }}>
        <Pressable onPress={() => {}} style={{ maxHeight: '80%', backgroundColor: '#171210', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.15)', paddingHorizontal: 18, paddingTop: 16, paddingBottom: 26 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 12 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: C.purple }} />
            <View style={{ flex: 1 }}>
              <Serif style={{ fontSize: 19, color: '#fff' }}>Referrals</Serif>
              <Body style={{ fontSize: 10.5, color: C.muted3, marginTop: 1 }}>Referrals you raised — newest first</Body>
            </View>
            <Pressable onPress={onClose} hitSlop={10} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="close" size={15} color={C.muted2} />
            </Pressable>
          </View>
          {q.isPending ? (
            <View style={{ paddingVertical: 36, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View>
          ) : q.isError ? (
            <Body style={{ fontSize: 12, color: C.red, textAlign: 'center', paddingVertical: 22 }}>{(q.error as Error).message}</Body>
          ) : (
            <>
              <View style={{ flexDirection: 'row', gap: 7, marginBottom: 10 }}>
                {(([['all', `All ${(q.data ?? []).length}`, C.muted], ['approved', `Approved ${count('approved')}`, C.green], ['pending', `Pending ${count('pending')}`, C.gold], ['rejected', `Rejected ${count('rejected')}`, C.red]]) as ['all' | 'approved' | 'pending' | 'rejected', string, string][]).map(([id, label, col]) => {
                  const active = filter === id;
                  return (
                    <Pressable key={id} onPress={() => setFilter(id)} style={{ flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 11, backgroundColor: hexA(col, active ? 0.18 : 0.06), borderWidth: 1, borderColor: hexA(col, active ? 0.5 : 0.2) }}>
                      <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 10, color: active ? (col === C.muted ? '#fff' : col) : C.muted }}>{label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              {rows.length === 0 ? (
                <Body style={{ fontSize: 12, color: C.muted3, textAlign: 'center', paddingVertical: 22 }}>No referrals in this view.</Body>
              ) : (
                <ScrollView showsVerticalScrollIndicator={false} style={{ flexShrink: 1 }} nestedScrollEnabled>
                  {rows.map((r) => (
                    <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' }}>
                      <MiniAvatar initial={(r.name[0] ?? '?').toUpperCase()} colors={['#9A7BEA', '#6E5BD0']} size={34} />
                      <View style={{ flex: 1 }}>
                        <Body numberOfLines={1} style={{ fontSize: 13, fontFamily: F.bodySemi, color: '#fff' }}>{r.name}</Body>
                        <Mono style={{ fontSize: 9, color: C.muted3, marginTop: 1 }}>{fmtD(r.createdAt)}</Mono>
                      </View>
                      <Badge text={r.status} color={statCol(r.status)} />
                    </View>
                  ))}
                </ScrollView>
              )}
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/* ============ CRM: SALES TRACKER ============ */
export function CrmSales() {
  const { go } = useStore();
  return (
    <Page gap={16} pt={6}>
      <TitleBlock title="Your sales pipeline" sub="Track every CTA, spot what's overdue, close the next opportunity." />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {[['OPEN CTAS', '32', '#fff', 'rgba(255,150,90,0.1)'], ['OVERDUE', '7', C.red, hexA(C.red, 0.22)], ['CLOSING THIS WEEK', '9', C.gold, hexA(C.gold, 0.22)], ['WON THIS MONTH', '12', C.green, hexA(C.green, 0.22)]].map(([lab, val, col, bord]) => (
          <Card key={lab as string} colors={['rgba(74,42,24,0.5)', 'rgba(22,16,15,0.5)']} border={bord as string} radius={18} style={{ width: '47.5%', flexGrow: 1, padding: 15 }}>
            <Mono style={{ fontSize: 10, letterSpacing: 1.2, color: C.mono }}>{lab}</Mono>
            <Serif style={{ fontSize: 30, color: col as string, marginTop: 5 }}>{val}</Serif>
          </Card>
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: 7 }}>
        {[['Active · 41', true], ['Inactive · 12', false], ['No package · 5', false]].map(([l, a]) => (
          a ? <LinearGradient key={l as string} colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999 }}><Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: '#fff' }}>{l}</Text></LinearGradient>
            : <View key={l as string} style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' }}><Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: C.muted }}>{l}</Text></View>
        ))}
      </View>
      {salesRows.map((r) => (
        <Card key={r.name} onPress={() => go('crm-sales-detail')} colors={['rgba(46,28,18,0.42)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.09)" radius={16} style={{ padding: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 11 }}>
            <View><Body style={{ fontSize: 15, fontFamily: F.bodySemi, color: '#fff' }}>{r.name}</Body><Body style={{ fontSize: 11.5, color: C.muted2 }}>{r.pkg}</Body></View>
            <View style={{ alignItems: 'flex-end' }}><Text style={{ fontFamily: F.mono, fontSize: 12, color: r.won ? C.green : r.overdue ? C.red : C.ink }}>{r.open} open</Text><Mono style={{ fontSize: 10.5, color: C.faint }}>{r.last}</Mono></View>
          </View>
          <ProgressBar pct={r.pct} fill={r.won ? C.green : undefined} />
        </Card>
      ))}
    </Page>
  );
}

/* ============ CRM: SALES DETAIL ============ */
export function CrmSalesDetail() {
  const { go, setDialog } = useStore();
  return (
    <Page gap={16} pt={6}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <BackLink label="Sales Tracker" onPress={() => go('crm-sales')} />
        <Pressable onPress={() => setDialog({ kind: 'cta' })}>
          <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 9, paddingHorizontal: 14, borderRadius: 12 }}>
            <Icon name="plus" size={14} color="#fff" strokeWidth={2.6} /><Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: '#fff' }}>Add CTA</Text>
          </LinearGradient>
        </Pressable>
      </View>
      <Card colors={['rgba(74,42,24,0.5)', 'rgba(22,16,15,0.5)']} border="rgba(255,150,90,0.12)" radius={20} style={{ padding: 18, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <Avatar initial="MS" size={60} colors={['#9A7BEA', '#6E5BD0']} fontSize={20} />
        <View><Mono style={{ fontSize: 10, letterSpacing: 1.2, color: C.mono2 }}>SALES OVERVIEW</Mono><Serif style={{ fontSize: 23 }}>Meera Shah</Serif><Body style={{ fontSize: 12, color: C.muted }}>Pro · Monthly</Body></View>
      </Card>
      <Card colors={['rgba(46,28,18,0.42)', 'rgba(18,14,14,0.5)']} radius={18} style={{ padding: 18 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}><Icon name="activity" size={17} color={C.orange} strokeWidth={2} /><Serif style={{ fontSize: 17 }}>Session Consumption</Serif></View>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 10 }}>
          <Serif style={{ fontSize: 34 }}>18<Text style={{ fontFamily: F.body, fontSize: 18, color: C.muted2 }}> / 36</Text></Serif>
          <Serif style={{ fontSize: 26, color: C.orange }}>50%</Serif>
        </View>
        <ProgressBar pct={50} height={8} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 9 }}><Body style={{ fontSize: 11.5, color: C.muted2 }}>18 sessions remaining</Body><Body style={{ fontSize: 11.5, color: C.muted2 }}>Cycle 2 · 6/18</Body></View>
      </Card>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {[['SUBSCRIPTION', 'Pro', C.ink], ['CURRENT PACKAGE', '3-month', '#F0875A'], ['DURATION', '90 days', C.ink], ['NO. OF PACKAGES', '2', C.ink], ['START', '12 Apr 2026', C.ink], ['EXPIRY', '11 Jul 2026', C.gold]].map(([lab, val, col]) => (
          <View key={lab as string} style={{ width: '47.5%', flexGrow: 1, backgroundColor: 'rgba(0,0,0,0.28)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', borderRadius: 14, padding: 13 }}>
            <Mono style={{ fontSize: 9.5, letterSpacing: 1, color: C.muted3 }}>{lab}</Mono>
            <Text style={{ fontFamily: F.bodySemi, fontSize: 14.5, color: col as string, marginTop: 3 }}>{val}</Text>
          </View>
        ))}
      </View>
      <Card colors={['rgba(46,28,18,0.42)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.09)" radius={18} style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
        <Serif style={{ fontSize: 17, paddingVertical: 14, paddingBottom: 4 }}>CTA Targets</Serif>
        {salesCtas.map((c) => (
          <View key={c.type} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' }}>
            <View style={{ flex: 1 }}><Body style={{ fontSize: 14, fontFamily: F.bodySemi }}>{c.type}</Body><Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 1 }}>{c.meta}</Body></View>
            <Badge text={c.status} color={c.color} />
          </View>
        ))}
      </Card>
    </Page>
  );
}

/* ============ CRM: CLIENT JOURNEY ============ */
export function CrmJourney() {
  const { go } = useStore();
  return (
    <Page gap={16} pt={6}>
      <TitleBlock title="Client Journey" sub="Track and manage client onboarding progress" />
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <MiniStat value="72" label="Completed" color={C.green} borderColor={hexA(C.green, 0.22)} />
        <MiniStat value="38" label="In Progress" color={C.gold} borderColor={hexA(C.gold, 0.22)} />
        <MiniStat value="18" label="Not Started" color={C.red} borderColor={hexA(C.red, 0.22)} />
      </View>
      {journeyCards.map((c) => (
        <Card key={c.name} onPress={() => go('crm-roadmap')} colors={['rgba(46,28,18,0.42)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.09)" radius={16} style={{ padding: 15 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <MiniAvatar initial={c.init} colors={c.av} size={38} />
            <View style={{ flex: 1 }}><Body style={{ fontSize: 15, fontFamily: F.bodySemi, color: '#fff' }}>{c.name}</Body><Body style={{ fontSize: 11.5, color: C.muted2 }}>{c.tier}</Body></View>
            <View style={{ paddingVertical: 3, paddingHorizontal: 9, borderRadius: 7, backgroundColor: hexA(c.complete ? C.green : '#8A847E', 0.14) }}><Text style={{ fontFamily: F.bodyBold, fontSize: 10, color: c.complete ? C.green : C.muted }}>{c.pct}%</Text></View>
          </View>
          <ProgressBar pct={c.pct} fill={c.complete ? C.green : undefined} />
        </Card>
      ))}
    </Page>
  );
}

/* ============ CRM: JOURNEY ROADMAP ============ */
export function CrmRoadmap() {
  const { go, roadmap, toggleRoadmap } = useStore();
  let rmDone = 0, rmTotal = 0;
  roadmapDef.forEach((c, ci) => { rmDone += roadmap[ci].filter(Boolean).length; rmTotal += c.steps.length; });
  const pct = Math.round((rmDone / rmTotal) * 100);
  return (
    <Page gap={16} pt={6}>
      <BackLink label="Back to Client Journey" onPress={() => go('crm-journey')} />
      <Card colors={['rgba(74,42,24,0.5)', 'rgba(22,16,15,0.5)']} border="rgba(255,150,90,0.12)" radius={20} style={{ padding: 18 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <Avatar initial="MS" size={48} colors={['#9A7BEA', '#6E5BD0']} fontSize={16} />
          <View><Serif style={{ fontSize: 20 }}>Meera Shah</Serif><Body style={{ fontSize: 12, color: C.muted }}>Pro · In Progress</Body></View>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 7 }}><Body style={{ fontSize: 12, color: C.muted }}>Overall Progress</Body><Text style={{ fontFamily: F.mono, color: '#F0875A' }}>{rmDone}/{rmTotal} · {pct}%</Text></View>
        <ProgressBar pct={pct} height={8} />
      </Card>
      {roadmapDef.map((cat, ci) => {
        const checks = roadmap[ci];
        const done = checks.filter(Boolean).length;
        const complete = done === cat.steps.length;
        return (
          <Card key={cat.title} colors={['rgba(46,28,18,0.42)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.09)" radius={16} style={{ padding: 16 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 12 }}>
              <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: hexA(complete ? C.green : C.orange, complete ? 0.2 : 0.15) }}><Text style={{ fontFamily: F.mono, fontSize: 13, color: complete ? C.green : C.orange }}>{ci + 1}</Text></View>
              <Serif style={{ flex: 1, fontSize: 16 }}>{cat.title}</Serif>
              <View style={{ paddingVertical: 3, paddingHorizontal: 10, borderRadius: 999, backgroundColor: complete ? hexA(C.green, 0.14) : 'rgba(255,255,255,0.06)' }}><Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: complete ? C.green : C.muted }}>{done}/{cat.steps.length}</Text></View>
            </View>
            {cat.steps.map((s, si) => (
              <Pressable key={s} onPress={() => toggleRoadmap(ci, si)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 12, borderRadius: 12, marginBottom: 6, backgroundColor: checks[si] ? hexA(C.green, 0.08) : 'rgba(255,255,255,0.03)' }}>
                <View style={{ width: 22, height: 22, borderRadius: 7, alignItems: 'center', justifyContent: 'center', borderWidth: checks[si] ? 0 : 2, borderColor: 'rgba(255,255,255,0.2)', backgroundColor: checks[si] ? C.green : 'transparent' }}>
                  {checks[si] ? <Icon path="M20 6 9 17l-5-5" size={13} color="#06231A" strokeWidth={3.2} /> : null}
                </View>
                <Text style={{ flex: 1, fontFamily: F.body, fontSize: 14, color: checks[si] ? C.ink : '#B8B2AC' }}>{s}</Text>
              </Pressable>
            ))}
          </Card>
        );
      })}
    </Page>
  );
}

/* ============ CRM: NEW ONBOARDING ============ */
/* ============ CRM: SESSION CONSUMPTION ============ */
export function CrmConsume() {
  const { go } = useStore();
  return (
    <Page gap={16} pt={6}>
      <TitleBlock title="Session Consumption" sub="Track client activity and session breakdowns" />
      <View style={{ flexDirection: 'row', gap: 7 }}>
        <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999 }}><Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: '#fff' }}>Inactive Clients</Text></LinearGradient>
        <View style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' }}><Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: C.muted }}>Sessions Breakdown</Text></View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 13, paddingHorizontal: 15, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}><Icon name="calendar" size={16} color={C.orange} strokeWidth={2} /><Body style={{ fontSize: 13.5 }}>Last 7 days</Body></View>
        <Mono style={{ fontSize: 11.5, color: C.orange }}>3 inactive</Mono>
      </View>
      {consumeList.map((x) => (
        <View key={x.name} style={{ backgroundColor: 'rgba(30,20,15,0.5)', borderWidth: 1, borderColor: 'rgba(255,150,90,0.09)', borderLeftWidth: 4, borderLeftColor: x.c, borderRadius: 16, padding: 15 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 11 }}>
            <Body style={{ fontSize: 15, fontFamily: F.bodySemi, color: '#fff' }}>{x.name}</Body>
            <Badge text={`${x.days}d inactive`} color={x.c} />
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {[['LAST WORKOUT', x.last], ['TRAINER', x.trainer], ['REMAINING', x.left]].map(([l, v]) => (
              <View key={l} style={{ flex: 1 }}><Mono style={{ fontSize: 9, color: C.muted3 }}>{l}</Mono><Body style={{ fontSize: 12.5, color: C.ink3, marginTop: 2 }}>{v}</Body></View>
            ))}
          </View>
        </View>
      ))}
    </Page>
  );
}

/* ============ CRM: COMMUNICATIONS ============ */
const COMM_STATUS_ORDER = ['Follow-up Required', 'Follow Up', 'Call Rescheduled', 'Not Responding', 'Client Not Available', 'Counselling Done', 'Follow Up Done'];
const commStatusColor = (s: string | null): string => {
  switch (s) {
    case 'Counselling Done': return C.green;
    case 'Follow Up Done': return C.green;
    case 'Follow-up Required': return C.blue;
    case 'Follow Up': return C.gold;
    case 'Call Rescheduled': return C.gold;
    case 'Not Responding': return C.red;
    case 'Client Not Available': return C.muted2;
    default: return C.muted2;
  }
};
const commMediumLabel = (m: string | null) => (m ? m.charAt(0).toUpperCase() + m.slice(1) : null);

export function CrmComms() {
  const { go, set } = useStore();
  const { session } = useAuth();
  const crmId = session?.user?.id ?? null;
  const bookQ = useCrmCommsBook(crmId);
  const doneM = useMarkCommDone();
  const [mode, setMode] = React.useState<'client' | 'all'>('client');
  const [followFilter, setFollowFilter] = React.useState<'all' | 'overdue' | 'today' | 'upcoming' | 'none'>('all');
  const [statusFilter, setStatusFilter] = React.useState<string>('all');
  const [query, setQuery] = React.useState('');
  const [rowLimit, setRowLimit] = React.useState(40);
  React.useEffect(() => { setRowLimit(40); }, [mode, followFilter, statusFilter, query]);

  const istD = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' }) : '—');
  const istDT = (iso: string | null) => (iso ? `${new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' })} · ${new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase()}` : '—');
  const book = bookQ.data;
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const dayOf = (iso: string) => { const d = new Date(iso); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const q = query.trim().toLowerCase();

  // Unified item shape for both modes (latest-per-client vs full log).
  type Item = { key: string; commId: string; clientId: string; clientName: string; callDate: string; status: string | null; medium: string | null; category: string | null; remarks: string | null; followUp: string | null; overdue: boolean };
  const source: Item[] = mode === 'client'
    ? (book?.rows ?? []).map((r) => ({ key: r.clientId, commId: r.commId, clientId: r.clientId, clientName: r.clientName, callDate: r.callDate, status: r.status, medium: r.medium, category: r.category, remarks: r.remarks, followUp: r.followUp, overdue: r.overdue }))
    : (book?.log ?? []).map((r) => ({ key: r.id, commId: r.id, clientId: r.clientId, clientName: r.clientName, callDate: r.callDate, status: r.status, medium: r.medium, category: r.category, remarks: r.remarks, followUp: r.followUp, overdue: r.overdue }));

  const statusesPresent = COMM_STATUS_ORDER.filter((s) => (book?.log ?? []).some((r) => r.status === s));

  const items = source
    .filter((r) => !q || r.clientName.toLowerCase().includes(q) || (r.remarks ?? '').toLowerCase().includes(q))
    .filter((r) => statusFilter === 'all' || r.status === statusFilter)
    .filter((r) => {
      if (followFilter === 'all') return true;
      if (!r.followUp) return followFilter === 'none';
      const f = dayOf(r.followUp);
      if (followFilter === 'overdue') return f < todayStart.getTime();
      if (followFilter === 'today') return f === todayStart.getTime();
      return followFilter === 'upcoming' && f > todayStart.getTime();
    })
    .sort((a, b) => (b.callDate ?? '').localeCompare(a.callDate ?? ''));
  const shown = items.slice(0, rowLimit);

  const openClient = (r: { clientId: string; clientName: string }) => {
    set({ selectedClientId: r.clientId, selectedClientName: r.clientName });
    go('crm-client');
  };

  return (
    <Page gap={14} pt={6} scrollKey="crm-comms">
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <TitleBlock title="Communications" sub="Every call & follow-up — logged and tracked" />
        <View style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }}><Text style={{ fontFamily: F.body, fontSize: 12, color: C.ink3 }}>30 days</Text></View>
      </View>

      {/* Live KPIs (same formulas as the web analytics hook) */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {([['TOTAL ATTEMPTS', book?.totalAttempts30d, '#fff', 'rgba(255,150,90,0.1)'],
           ['PENDING FOLLOW-UPS', book?.pendingFollowUps, C.gold, hexA(C.gold, 0.22)],
           ['SUCCESS RATE', book != null ? `${book.successRate}%` : null, C.green, hexA(C.green, 0.22)],
           ['CLIENTS CONTACTED', book?.clientsContacted30d, C.blue, hexA(C.blue, 0.22)]] as const).map(([lab, val, col, bord]) => (
          <Card key={lab} colors={['rgba(74,42,24,0.5)', 'rgba(22,16,15,0.5)']} border={bord} radius={16} style={{ width: '47.5%', flexGrow: 1, padding: 15 }}>
            <Mono style={{ fontSize: 10, letterSpacing: 1, color: C.mono }}>{lab}</Mono>
            <Serif style={{ fontSize: 28, color: col, marginTop: 4 }}>{val ?? '…'}</Serif>
          </Card>
        ))}
      </View>

      {/* Outcome distribution — last 30 days (mirrors the web outcome chart) */}
      {(book?.outcomes?.length ?? 0) > 0 ? (
        <Card colors={['rgba(46,28,18,0.42)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.09)" radius={16} style={{ padding: 14, gap: 10 }}>
          <Mono style={{ fontSize: 10, letterSpacing: 1, color: C.mono2 }}>OUTCOMES · LAST 30 DAYS</Mono>
          <View style={{ flexDirection: 'row', height: 8, borderRadius: 999, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.05)' }}>
            {(book?.outcomes ?? []).map((o) => (
              <View key={o.status} style={{ width: `${o.pct}%`, backgroundColor: commStatusColor(o.status) }} />
            ))}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {(book?.outcomes ?? []).map((o) => (
              <View key={o.status} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: commStatusColor(o.status) }} />
                <Body style={{ fontSize: 11, color: C.ink3 }}>{o.status}</Body>
                <Mono style={{ fontSize: 10, color: C.muted3 }}>{o.count}</Mono>
              </View>
            ))}
          </View>
        </Card>
      ) : null}

      {/* Mode toggle: latest per client vs. full activity log */}
      <View style={{ flexDirection: 'row', gap: 6, padding: 4, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.28)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' }}>
        {([['client', 'By Client', book?.rows.length], ['all', 'All Activity', book?.totalEntries]] as const).map(([id, label, n]) => {
          const active = mode === id;
          return (
            <AnimChip key={id} grow active={active} onPress={() => setMode(id)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 10, overflow: 'hidden', backgroundColor: active ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
              {active ? <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} /> : null}
              <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 12.5, color: active ? '#fff' : C.muted }}>{label}</Text>
              {n != null ? <Text style={{ fontFamily: F.mono, fontSize: 10, color: active ? 'rgba(255,255,255,0.85)' : C.muted3 }}>{n}</Text> : null}
            </AnimChip>
          );
        })}
      </View>

      {/* Status filter */}
      {statusesPresent.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {(['all', ...statusesPresent]).map((s) => {
            const active = statusFilter === s;
            const col = s === 'all' ? C.orange : commStatusColor(s);
            return (
              <AnimChip key={s} active={active} onPress={() => setStatusFilter(s)} style={{ paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, backgroundColor: active ? hexA(col, 0.15) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(col, 0.5) : 'rgba(255,255,255,0.09)' }}>
                <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 11, color: active ? col : C.muted }}>{s === 'all' ? 'All Statuses' : s}</Text>
              </AnimChip>
            );
          })}
        </View>
      ) : null}

      {/* Follow-up filter */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {([['all', 'Any Follow-up'], ['overdue', 'Overdue'], ['today', 'Today'], ['upcoming', 'Upcoming'], ['none', 'No Follow-up']] as const).map(([id, label]) => {
          const active = followFilter === id;
          const col = id === 'overdue' ? C.red : C.gold;
          return (
            <AnimChip key={id} active={active} onPress={() => setFollowFilter(id)} style={{ paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, backgroundColor: active ? hexA(col, 0.14) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(col, 0.45) : 'rgba(255,255,255,0.09)' }}>
              <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 11, color: active ? col : C.muted }}>{label}</Text>
            </AnimChip>
          );
        })}
      </View>

      {/* Search */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 14, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
        <Icon name="search" size={16} color={C.muted3} strokeWidth={2} />
        <TextInput value={query} onChangeText={setQuery} placeholder="Search client or remarks…" placeholderTextColor={C.muted3} autoCorrect={false} style={{ flex: 1, fontFamily: F.body, fontSize: 14, color: '#fff', padding: 0 }} />
        {query ? <Pressable onPress={() => setQuery('')} hitSlop={8}><Icon name="close" size={14} color={C.muted} strokeWidth={2.4} /></Pressable> : null}
      </View>

      {/* List */}
      <Card colors={['rgba(46,28,18,0.42)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.09)" radius={18} style={{ paddingHorizontal: 14, paddingBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingBottom: 6 }}>
          <Serif style={{ flex: 1, fontSize: 17 }}>{mode === 'client' ? 'Client Communications' : 'Activity Log'}</Serif>
          {book ? <Mono style={{ fontSize: 10, color: C.muted3 }}>{items.length} {mode === 'client' ? 'CLIENTS' : 'ENTRIES'}</Mono> : null}
        </View>
        {bookQ.isLoading ? (
          <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 20 }}>Loading communications…</Body>
        ) : items.length === 0 ? (
          <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 20 }}>No communications match these filters.</Body>
        ) : (
          <>
            {shown.map((r) => {
              const col = r.overdue ? C.red : commStatusColor(r.status);
              const med = commMediumLabel(r.medium);
              return (
                <Pressable key={r.key} onPress={() => openClient(r)} style={{ paddingVertical: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)', gap: 6 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: col }} />
                    <Body numberOfLines={1} style={{ flex: 1, fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }}>{r.clientName}</Body>
                    {r.status ? <Badge text={r.overdue ? 'Overdue' : r.status} color={col} /> : null}
                    <Icon name="chevRight" size={14} color={C.muted3} strokeWidth={2.2} />
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', paddingLeft: 17 }}>
                    <Mono style={{ fontSize: 10, color: C.muted3 }}>{mode === 'client' ? `LAST ${istD(r.callDate).toUpperCase()}` : istDT(r.callDate)}</Mono>
                    {med ? <View style={{ paddingVertical: 2, paddingHorizontal: 7, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}><Text style={{ fontFamily: F.bodySemi, fontSize: 9.5, color: C.muted }}>{med}</Text></View> : null}
                    {r.category ? <View style={{ paddingVertical: 2, paddingHorizontal: 7, borderRadius: 999, backgroundColor: hexA(C.gold, 0.1), borderWidth: 1, borderColor: hexA(C.gold, 0.28) }}><Text style={{ fontFamily: F.bodySemi, fontSize: 9.5, color: C.gold }}>{r.category}</Text></View> : null}
                  </View>
                  {r.followUp ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 17 }}>
                      <Icon name="calendar" size={11} color={r.overdue ? C.red : C.muted3} strokeWidth={2.1} />
                      <Body style={{ fontSize: 11, color: r.overdue ? C.red : C.muted2 }}>{r.overdue ? 'Overdue follow-up' : 'Follow-up'} {istD(r.followUp)}</Body>
                    </View>
                  ) : null}
                  {r.remarks ? <Body numberOfLines={2} style={{ fontSize: 11.5, color: C.muted3, paddingLeft: 17 }}>{r.remarks}</Body> : null}
                  {r.status !== 'Follow Up Done' ? (
                    <View style={{ flexDirection: 'row', paddingLeft: 17 }}>
                      <Pressable onPress={() => doneM.mutate({ id: r.commId, clientId: r.clientId })} disabled={doneM.isPending} hitSlop={6} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 5, paddingHorizontal: 11, borderRadius: 999, backgroundColor: hexA(C.green, 0.12), borderWidth: 1, borderColor: hexA(C.green, 0.35) }}>
                        <Icon name="checks" size={11} color={C.green} strokeWidth={2.6} />
                        <Text style={{ fontFamily: F.bodyBold, fontSize: 10.5, color: C.green }}>Mark Done</Text>
                      </Pressable>
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
            {items.length > rowLimit ? (
              <Pressable onPress={() => setRowLimit(rowLimit + 40)} style={{ alignItems: 'center', marginTop: 12, paddingVertical: 11, borderRadius: 12, backgroundColor: hexA(C.orange, 0.08), borderWidth: 1, borderColor: hexA(C.orange, 0.3) }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: C.orange }}>Load More ({items.length - rowLimit} left)</Text>
              </Pressable>
            ) : null}
          </>
        )}
      </Card>
    </Page>
  );
}

/* ============ CRM: CALENDAR ============ */
export function CrmCalendar() {
  const cells: (number | null)[] = [];
  for (let i = 0; i < 3; i++) cells.push(null);
  for (let d = 1; d <= 31; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return (
    <Page gap={16} pt={6}>
      <TitleBlock title="Calendar" sub="Schedule meetings, reminders, tasks and follow-ups" />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' }}><Icon path="M15 6l-6 6 6 6" size={14} color="#B8B2AC" strokeWidth={2.2} /></View>
          <Serif style={{ fontSize: 17 }}>July 2026</Serif>
          <View style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' }}><Icon name="chevRight" size={14} color="#B8B2AC" strokeWidth={2.2} /></View>
        </View>
        <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 13, borderRadius: 11 }}><Icon name="plus" size={13} color="#fff" strokeWidth={2.6} /><Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: '#fff' }}>New</Text></LinearGradient>
      </View>
      <Card colors={['rgba(46,28,18,0.42)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.09)" radius={16} style={{ padding: 12 }}>
        <View style={{ flexDirection: 'row', marginBottom: 6 }}>
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (<Text key={i} style={{ flex: 1, textAlign: 'center', fontFamily: F.mono, fontSize: 9, color: C.muted3 }}>{d}</Text>))}
        </View>
        {weeks.map((w, wi) => (
          <View key={wi} style={{ flexDirection: 'row', marginBottom: 3, gap: 3 }}>
            {w.map((d, di) => (
              <View key={di} style={{ flex: 1, minHeight: 44, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.02)', padding: 4, gap: 2 }}>
                <Text style={{ fontSize: 10, color: C.muted2, fontFamily: F.mono }}>{d ?? ''}</Text>
                {d && chipDays[d] ? chipDays[d].map((ch, ci) => (
                  <View key={ci} style={{ paddingVertical: 1, paddingHorizontal: 4, borderRadius: 4, backgroundColor: hexA(ch.c, 0.2) }}><Text numberOfLines={1} style={{ fontSize: 8.5, fontFamily: F.bodyBold, color: ch.c }}>{ch.t}</Text></View>
                )) : null}
              </View>
            ))}
          </View>
        ))}
      </Card>
    </Page>
  );
}

/* ============ CRM: SERVICE REQUESTS ============ */
export function CrmService() {
  const { setDialog } = useStore();
  return (
    <Page gap={16} pt={6}>
      <TitleBlock title="Service Requests" sub="Manage and track all service booking requests" />
      {serviceRows.map((x) => (
        <Card key={x.name} colors={['rgba(46,28,18,0.42)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.09)" radius={16} style={{ padding: 15 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
            <View><Body style={{ fontSize: 15, fontFamily: F.bodySemi, color: '#fff' }}>{x.name}</Body><Body style={{ fontSize: 12, color: C.muted }}>{x.svc}</Body></View>
            <Badge text={x.status} color={x.c} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}><Icon name="calendar" size={13} color={C.muted2} strokeWidth={2} /><Body style={{ fontSize: 12, color: C.muted2 }}>{x.when} · {x.type}</Body></View>
          {x.pending ? (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable onPress={() => setDialog({ kind: 'approve', id: x.name })} style={[svcBtn, { backgroundColor: hexA(C.green, 0.14), borderColor: hexA(C.green, 0.3) }]}><Text style={{ fontSize: 12.5, fontFamily: F.bodySemi, color: C.green }}>Approve</Text></Pressable>
              <Pressable onPress={() => setDialog({ kind: 'reject', id: x.name })} style={[svcBtn, { backgroundColor: hexA(C.red, 0.12), borderColor: hexA(C.red, 0.3) }]}><Text style={{ fontSize: 12.5, fontFamily: F.bodySemi, color: C.red }}>Reject</Text></Pressable>
              <View style={[svcBtn, { backgroundColor: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.08)' }]}><Text style={{ fontSize: 12.5, fontFamily: F.bodySemi, color: C.ink3 }}>Reschedule</Text></View>
            </View>
          ) : null}
        </Card>
      ))}
    </Page>
  );
}
const svcBtn = { flex: 1, alignItems: 'center' as const, paddingVertical: 10, borderRadius: 11, borderWidth: 1 };

/* ============ CRM: PENDING APPROVALS ============ */
/* Live Pending Approvals — Rescheduling + Roster Requests, realtime, mirrors the
   web PendingSessionApprovals contracts (see approvalQueries.ts). */
const istSlot = (iso: string) => `${new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' })} · ${new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase()}`;
const istProposed = (d: string, t: string) => {
  const iso = `${d}T${t.length === 5 ? t + ':00' : t}+05:30`;
  return istSlot(new Date(iso).toISOString());
};

/* One request card with entrance animation (new realtime rows slide in). */
function ApprovalCard({ color, children }: { color: string; children: React.ReactNode }) {
  const a = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    Animated.timing(a, { toValue: 1, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, []);
  return (
    <Animated.View style={{ opacity: a, transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }}>
      <View style={{ borderRadius: 16, backgroundColor: 'rgba(24,17,14,0.6)', borderWidth: 1, borderColor: hexA(color, 0.28), borderLeftWidth: 4, borderLeftColor: color, padding: 14, gap: 10 }}>
        {children}
      </View>
    </Animated.View>
  );
}

export function CrmApprovals() {
  const { session } = useAuth();
  const crmId = session?.user?.id ?? null;
  const qc = useQueryClient();
  const [tab, setTab] = React.useState<0 | 1>(0);
  const [rosterSub, setRosterSub] = React.useState<'pending' | 'approved' | 'rejected'>('pending');
  const [rejectingId, setRejectingId] = React.useState<string | null>(null);
  const [rejectReason, setRejectReason] = React.useState('');
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const reschedQ = useRescheduleRequests(crmId);
  const rosterQ = useRosterRequests(crmId);
  const approveM = useApproveReschedule();
  const rejectM = useRejectReschedule();
  const reviewM = useReviewRosterRequest();

  const pending = reschedQ.data?.pending ?? [];
  const processed = reschedQ.data?.processed ?? [];
  const roster = rosterQ.data ?? [];
  const rosterPending = roster.filter((r) => r.status === 'pending');
  const rosterShown = roster.filter((r) => r.status === rosterSub);
  const urgentTotal = pending.length + rosterPending.length;

  /* Realtime: new/changed requests appear instantly — no manual refresh. */
  React.useEffect(() => {
    const bump = (keys: string[][]) => {
      keys.forEach((k) => qc.invalidateQueries({ queryKey: k }));
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    };
    const ch = supabase
      .channel('crm-approvals-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'session_schedule' }, () => bump([['crm-reschedule-requests']]))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'all_requests' }, () => bump([['crm-roster-requests']]))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  /* Animated segmented control */
  const seg = React.useRef(new Animated.Value(0)).current;
  const [segW, setSegW] = React.useState(0);
  const switchTab = (i: 0 | 1) => {
    setTab(i);
    setRejectingId(null);
    Animated.spring(seg, { toValue: i, useNativeDriver: true, speed: 16, bounciness: 7 }).start();
  };

  /* Live pulse dot */
  const pulse = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ])).start();
  }, []);

  const doApprove = (req: RescheduleReq) => {
    if (!req.proposedDate || !req.proposedTime) { Alert.alert('No proposed slot', 'The trainer did not propose a new date/time. Reject with a note instead.'); return; }
    Alert.alert('Approve reschedule?', `${req.clientName}'s session moves to ${istProposed(req.proposedDate, req.proposedTime)}.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Approve & Move', onPress: async () => {
        setBusyId(req.id);
        try { await approveM.mutateAsync({ req, crmId: crmId! }); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); }
        catch (e: any) { Alert.alert("Couldn't approve", e?.message ?? 'Try again.'); }
        finally { setBusyId(null); }
      } },
    ]);
  };
  const doRejectResched = async (req: RescheduleReq) => {
    if (!rejectReason.trim()) return;
    setBusyId(req.id);
    try { await rejectM.mutateAsync({ id: req.id, crmId: crmId!, reason: rejectReason }); setRejectingId(null); setRejectReason(''); }
    catch (e: any) { Alert.alert("Couldn't reject", e?.message ?? 'Try again.'); }
    finally { setBusyId(null); }
  };
  const doReviewRoster = (req: RosterReq, action: 'approve' | 'reject') => {
    if (action === 'reject') {
      if (!rejectReason.trim() && rejectingId === req.id) { /* allow empty note */ }
      setBusyId(req.id);
      reviewM.mutateAsync({ req, crmId: crmId!, action: 'reject', note: rejectReason })
        .then(() => { setRejectingId(null); setRejectReason(''); })
        .catch((e: any) => Alert.alert("Couldn't reject", e?.message ?? 'Try again.'))
        .finally(() => setBusyId(null));
      return;
    }
    const msg = req.rosterType === 'single'
      ? `This creates the session${req.slotAt ? ` on ${istSlot(req.slotAt)}` : ''} for ${req.clientName} and marks the request approved.`
      : 'Full-roster requests are approved here; build the actual roster in Roster Management afterwards.';
    Alert.alert('Approve request?', msg, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Approve', onPress: async () => {
        setBusyId(req.id);
        try { await reviewM.mutateAsync({ req, crmId: crmId!, action: 'approve' }); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); }
        catch (e: any) { Alert.alert("Couldn't approve", e?.message ?? 'Try again.'); }
        finally { setBusyId(null); }
      } },
    ]);
  };

  const rejectBox = (onConfirm: () => void, optional = false) => (
    <View style={{ gap: 8 }}>
      <TextInput
        value={rejectReason}
        onChangeText={setRejectReason}
        placeholder={optional ? 'Reason (optional)…' : 'Why is this rejected? (required)'}
        placeholderTextColor={C.muted3}
        multiline
        autoFocus
        style={{ minHeight: 54, textAlignVertical: 'top', paddingVertical: 9, paddingHorizontal: 11, borderRadius: 11, borderWidth: 1, borderColor: hexA(C.red, 0.35), backgroundColor: 'rgba(0,0,0,0.25)', color: '#fff', fontFamily: F.body, fontSize: 13 }}
      />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Pressable onPress={() => { setRejectingId(null); setRejectReason(''); }} style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
          <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: C.muted }}>Cancel</Text>
        </Pressable>
        <Pressable onPress={onConfirm} disabled={!optional && !rejectReason.trim()} style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 11, backgroundColor: hexA(C.red, 0.15), borderWidth: 1, borderColor: hexA(C.red, 0.4), opacity: !optional && !rejectReason.trim() ? 0.5 : 1 }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: C.red }}>Confirm Reject</Text>
        </Pressable>
      </View>
    </View>
  );

  const actionRow = (onApprove: () => void, onRejectStart: () => void, busy: boolean) => (
    <View style={{ flexDirection: 'row', gap: 9 }}>
      <Pressable onPress={onApprove} disabled={busy} style={{ flex: 1.4, opacity: busy ? 0.6 : 1 }}>
        <LinearGradient colors={['#3FBF77', '#2E9A5D']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 12, borderRadius: 12 }}>
          <Icon path="M20 6 9 17l-5-5" size={14} color="#fff" strokeWidth={2.8} />
          <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: '#fff' }}>{busy ? 'Working…' : 'Approve'}</Text>
        </LinearGradient>
      </Pressable>
      <Pressable onPress={onRejectStart} disabled={busy} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: hexA(C.red, 0.1), borderWidth: 1, borderColor: hexA(C.red, 0.35), opacity: busy ? 0.6 : 1 }}>
        <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: C.red }}>Reject</Text>
      </Pressable>
    </View>
  );

  return (
    <Page gap={14} pt={6}>
      {/* Header — urgent, live */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: hexA(C.red, 0.12), borderWidth: 1, borderColor: hexA(C.red, 0.3), alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="alert" size={20} color={C.red} strokeWidth={2} />
        </View>
        <View style={{ flex: 1 }}>
          <Serif style={{ fontSize: 23 }}>Pending Approvals</Serif>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
            <Animated.View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: C.green, opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }), transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.15] }) }] }} />
            <Body style={{ fontSize: 11.5, color: C.muted2 }}>Live — new requests appear instantly</Body>
          </View>
        </View>
        {urgentTotal > 0 ? (
          <View style={{ minWidth: 30, height: 30, paddingHorizontal: 9, borderRadius: 15, backgroundColor: hexA(C.red, 0.15), borderWidth: 1, borderColor: hexA(C.red, 0.4), alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: C.red }}>{urgentTotal}</Text>
          </View>
        ) : null}
      </View>

      {/* Animated segmented control */}
      <View onLayout={(e) => setSegW(e.nativeEvent.layout.width)} style={{ flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 999, padding: 4, position: 'relative' }}>
        {segW > 0 ? (
          <Animated.View style={{ position: 'absolute', top: 4, bottom: 4, left: 4, width: (segW - 8) / 2, borderRadius: 999, transform: [{ translateX: seg.interpolate({ inputRange: [0, 1], outputRange: [0, (segW - 8) / 2] }) }] }}>
            <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1, borderRadius: 999 }} />
          </Animated.View>
        ) : null}
        {([['Rescheduling', pending.length], ['Roster Requests', rosterPending.length]] as [string, number][]).map(([label, n], i) => (
          <Pressable key={label} onPress={() => switchTab(i as 0 | 1)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10 }}>
            <Text style={{ fontFamily: tab === i ? F.bodyBold : F.bodySemi, fontSize: 12.5, color: tab === i ? '#fff' : C.muted }}>{label}</Text>
            {n > 0 ? (
              <View style={{ minWidth: 19, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 10, backgroundColor: tab === i ? 'rgba(255,255,255,0.25)' : hexA(C.red, 0.18), alignItems: 'center' }}>
                <Text style={{ fontFamily: F.mono, fontSize: 10.5, color: tab === i ? '#fff' : C.red }}>{n}</Text>
              </View>
            ) : null}
          </Pressable>
        ))}
      </View>

      {tab === 0 ? (
        /* ============ RESCHEDULING ============ */
        reschedQ.isLoading ? (
          <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 26 }}>Loading requests…</Body>
        ) : (
          <>
            {pending.length === 0 ? (
              <View style={{ alignItems: 'center', gap: 8, paddingVertical: 26 }}>
                <Icon name="checks" size={22} color={C.green} strokeWidth={2.2} />
                <Body style={{ fontSize: 13, color: C.muted2 }}>No pending reschedule requests.</Body>
              </View>
            ) : (
              pending.map((r) => (
                <ApprovalCard key={r.id} color={C.gold}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                    <Body style={{ flex: 1, fontSize: 15, fontFamily: F.bodyBold, color: '#fff' }} numberOfLines={1}>{r.clientName}</Body>
                    {r.modality ? <Badge text={r.modality} color={C.blue} /> : null}
                    <Badge text="Pending" color={C.gold} />
                  </View>
                  <Body style={{ fontSize: 11.5, color: C.muted2 }}>Trainer {r.trainerName}{r.requestedAt ? ` · asked ${istSlot(r.requestedAt)}` : ''}</Body>
                  {/* current → proposed */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, padding: 11, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.28)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }}>
                    <View style={{ flex: 1 }}>
                      <Mono style={{ fontSize: 8, letterSpacing: 0.7, color: C.muted3 }}>CURRENT</Mono>
                      <Body style={{ fontSize: 12.5, color: C.ink3, marginTop: 2 }}>{istSlot(r.currentAt)}</Body>
                    </View>
                    <Icon name="arrowRight" size={15} color={C.orange} strokeWidth={2.4} />
                    <View style={{ flex: 1, alignItems: 'flex-end' }}>
                      <Mono style={{ fontSize: 8, letterSpacing: 0.7, color: C.orange }}>PROPOSED</Mono>
                      <Body style={{ fontSize: 12.5, fontFamily: F.bodySemi, color: C.orange, marginTop: 2 }}>
                        {r.proposedDate && r.proposedTime ? istProposed(r.proposedDate, r.proposedTime) : 'Not specified'}
                      </Body>
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8, padding: 10, borderRadius: 11, backgroundColor: hexA(C.gold, 0.07), borderWidth: 1, borderColor: hexA(C.gold, 0.2) }}>
                    <Icon name="chat" size={13} color={C.gold} strokeWidth={2} />
                    <Body style={{ flex: 1, fontSize: 12, color: C.ink3 }}>{r.reason}</Body>
                  </View>
                  {rejectingId === r.id
                    ? rejectBox(() => doRejectResched(r))
                    : actionRow(() => doApprove(r), () => { setRejectingId(r.id); setRejectReason(''); }, busyId === r.id)}
                </ApprovalCard>
              ))
            )}
            {processed.length > 0 ? (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 4 }}>
                  <Mono style={{ fontSize: 10, letterSpacing: 1.4, color: C.mono2 }}>RECENTLY PROCESSED</Mono>
                  <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.06)' }} />
                </View>
                {processed.slice(0, 6).map((r) => (
                  <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 11, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.025)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' }}>
                    <Icon path={r.status === 'approved' ? 'M20 6 9 17l-5-5' : 'M18 6 6 18M6 6l12 12'} size={13} color={r.status === 'approved' ? C.green : C.red} strokeWidth={2.6} />
                    <View style={{ flex: 1 }}>
                      <Body numberOfLines={1} style={{ fontSize: 13, fontFamily: F.bodySemi, color: '#fff' }}>{r.clientName}</Body>
                      <Body numberOfLines={1} style={{ fontSize: 10.5, color: C.muted3, marginTop: 1 }}>{r.status === 'rejected' && r.notes ? r.notes : istSlot(r.currentAt)}</Body>
                    </View>
                    <Badge text={r.status === 'approved' ? 'Approved' : 'Rejected'} color={r.status === 'approved' ? C.green : C.red} />
                  </View>
                ))}
              </>
            ) : null}
          </>
        )
      ) : (
        /* ============ ROSTER REQUESTS ============ */
        rosterQ.isLoading ? (
          <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 26 }}>Loading requests…</Body>
        ) : (
          <>
            {/* sub-filter */}
            <View style={{ flexDirection: 'row', gap: 7 }}>
              {(['pending', 'approved', 'rejected'] as const).map((s) => {
                const n = roster.filter((r) => r.status === s).length;
                const active = rosterSub === s;
                const col = s === 'pending' ? C.gold : s === 'approved' ? C.green : C.red;
                return (
                  <Pressable key={s} onPress={() => setRosterSub(s)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 9, borderRadius: 11, backgroundColor: active ? hexA(col, 0.13) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(col, 0.4) : 'rgba(255,255,255,0.07)' }}>
                    <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 11.5, color: active ? col : C.muted }}>{s[0].toUpperCase() + s.slice(1)}</Text>
                    {n > 0 ? <Text style={{ fontFamily: F.mono, fontSize: 10, color: active ? col : C.muted2 }}>{n}</Text> : null}
                  </Pressable>
                );
              })}
            </View>
            {rosterShown.length === 0 ? (
              <View style={{ alignItems: 'center', gap: 8, paddingVertical: 26 }}>
                <Icon name="checks" size={22} color={C.green} strokeWidth={2.2} />
                <Body style={{ fontSize: 13, color: C.muted2 }}>No {rosterSub} roster requests.</Body>
              </View>
            ) : (
              rosterShown.map((r) => {
                const col = r.status === 'pending' ? C.purple : r.status === 'approved' ? C.green : C.red;
                return (
                  <ApprovalCard key={r.id} color={col}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <Body style={{ flex: 1, fontSize: 15, fontFamily: F.bodyBold, color: '#fff' }} numberOfLines={1}>{r.clientName}</Body>
                      {r.rosterType ? <Badge text={r.rosterType === 'full' ? 'Full Roster' : 'Single Day'} color={r.rosterType === 'full' ? C.purple : C.blue} /> : null}
                      {r.status !== 'pending' ? <Badge text={r.status[0].toUpperCase() + r.status.slice(1)} color={col} /> : null}
                    </View>
                    <Body style={{ fontSize: 11.5, color: C.muted2 }}>{r.trainerName} requested · {istSlot(r.requestedAt)}</Body>
                    {r.slotAt ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.28)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }}>
                        <Icon name="clock" size={13} color={C.green} strokeWidth={2} />
                        <Body style={{ fontSize: 12.5, color: C.ink3 }}>Requested slot: <Text style={{ fontFamily: F.bodySemi, color: '#fff' }}>{istSlot(r.slotAt)}</Text></Body>
                      </View>
                    ) : null}
                    {r.remark ? (
                      <View style={{ flexDirection: 'row', gap: 8, padding: 10, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.03)' }}>
                        <Icon name="chat" size={13} color={C.muted3} strokeWidth={2} />
                        <Body style={{ flex: 1, fontSize: 12, color: C.muted2 }}>{r.remark}</Body>
                      </View>
                    ) : null}
                    {r.status === 'pending' ? (
                      rejectingId === r.id
                        ? rejectBox(() => doReviewRoster(r, 'reject'), true)
                        : actionRow(() => doReviewRoster(r, 'approve'), () => { setRejectingId(r.id); setRejectReason(''); }, busyId === r.id)
                    ) : r.reviewNote ? (
                      <Body style={{ fontSize: 11.5, color: C.muted2, fontStyle: 'italic' }}>“{r.reviewNote}”</Body>
                    ) : null}
                  </ApprovalCard>
                );
              })
            )}
          </>
        )
      )}
    </Page>
  );
}

/* ============ CRM: ROSTER MANAGEMENT ============ */
export function CrmRoster() {
  return (
    <Page gap={16} pt={6}>
      <TitleBlock title="Roster Management" sub="Manage training schedules and monthly rosters" />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <MiniStat value="210" label="Scheduled" />
        <MiniStat value="180" label="Completed" color={C.green} borderColor={hexA(C.green, 0.2)} />
        <MiniStat value="12" label="Missed" color={C.red} borderColor={hexA(C.red, 0.2)} />
        <MiniStat value="42" label="Confirmed" color={C.blue} borderColor={hexA(C.blue, 0.2)} />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 7 }}>
        {[['List View', true], ['Calendar', false], ['Reschedule · 3', false], ['Missed', false]].map(([l, a]) => (
          a ? <LinearGradient key={l as string} colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999 }}><Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: '#fff' }}>{l}</Text></LinearGradient>
            : <View key={l as string} style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' }}><Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: C.muted }}>{l}</Text></View>
        ))}
      </ScrollView>
      <Card colors={['rgba(46,28,18,0.42)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.09)" radius={16} style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
        {rosterList.map((x, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: 'rgba(255,255,255,0.06)' }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: x.c }} />
            <View style={{ width: 78 }}><Body style={{ fontSize: 12, fontFamily: F.bodySemi }}>{x.date}</Body><Mono style={{ fontSize: 10.5, color: C.muted2 }}>{x.time}</Mono></View>
            <View style={{ flex: 1 }}><Body style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{x.name}</Body><Body style={{ fontSize: 11, color: C.muted2 }}>{x.modality} · {x.trainer}</Body></View>
            <Badge text={x.status} color={x.sc} />
          </View>
        ))}
      </Card>
    </Page>
  );
}

/* ============ CRM: QHP ============ */
export function CrmQhp() {
  const { openSheet, go } = useStore();
  return (
    <Page gap={16} pt={6}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <TitleBlock title="QHP Management" sub="Track Quarterly Health Profile assessments" />
        <Pressable onPress={() => openSheet('schedule')}><LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 9, paddingHorizontal: 13, borderRadius: 12 }}><Icon name="plus" size={13} color="#fff" strokeWidth={2.6} /><Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: '#fff' }}>Schedule</Text></LinearGradient></Pressable>
      </View>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <MiniStat value="128" label="Total" />
        <MiniStat value="107" label="On time" color={C.green} borderColor={hexA(C.green, 0.22)} />
        <MiniStat value="21" label="Pending" color={C.red} borderColor={hexA(C.red, 0.22)} />
      </View>
      {qhpCrmList.map((q) => (
        <Card key={q.name} onPress={() => go('crm-assessment')} colors={['rgba(46,28,18,0.42)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.09)" radius={16} style={{ padding: 15 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}><Body style={{ fontSize: 15, fontFamily: F.bodySemi, color: '#fff' }}>{q.name}</Body><Badge text={q.status} color={q.c} /></View>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {qhpSteps.map((s, i) => (
              <View key={s} style={{ flex: 1, alignItems: 'center', gap: 5 }}>
                <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: i < q.stage ? C.green : 'rgba(255,255,255,0.15)' }} />
                <Text style={{ fontSize: 9, color: C.muted2, textAlign: 'center' }}>{s}</Text>
              </View>
            ))}
          </View>
        </Card>
      ))}
    </Page>
  );
}

/* ============ CRM: BLOOD REPORTS ============ */
export function CrmBlood() {
  const { go, crmBloodTab, set, setDialog } = useStore();
  return (
    <Page gap={16} pt={6}>
      <BackLink label="Tools" onPress={() => go('crm-tools')} />
      <TitleBlock title="Blood Reports" sub="Track blood report status and download branded PDFs" />
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <MiniStat value="128" label="Total" />
        <MiniStat value="96" label="With Reports" color={C.green} borderColor={hexA(C.green, 0.22)} />
        <MiniStat value="32" label="Missing" color={C.gold} borderColor={hexA(C.gold, 0.22)} />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {bloodTabDefs.map((t) => {
          const active = crmBloodTab === t.id;
          return (
            <Pressable key={t.id} onPress={() => set({ crmBloodTab: t.id })} style={{ paddingVertical: 9, paddingHorizontal: 14, borderRadius: 999, backgroundColor: active ? hexA(C.orange, 0.13) : 'transparent', borderWidth: 1, borderColor: active ? hexA(C.orange, 0.3) : 'rgba(255,255,255,0.05)' }}>
              <Text style={{ fontFamily: active ? F.bodySemi : F.body, fontSize: 13, color: active ? C.orange : C.muted }}>{t.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {bloodRows.map((b, idx) => (
        <Card key={b.name} colors={['rgba(46,28,18,0.42)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.09)" radius={16} style={{ padding: 15 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 9 }}>
            <View><Body style={{ fontSize: 15, fontFamily: F.bodySemi, color: '#fff' }}>{b.name}</Body><Mono style={{ fontSize: 11, color: C.muted2 }}>{b.last}</Mono></View>
            <Badge text={b.count > 0 ? `${b.count} report${b.count > 1 ? 's' : ''}` : 'Missing'} color={b.count > 0 ? C.green : C.gold} />
          </View>
          {b.count > 0 && b.markers.length === 0 ? <Body style={{ fontSize: 12, color: C.green }}>All markers within normal range</Body> : null}
          {b.markers.length ? (
            <View style={{ flexDirection: 'row', gap: 7, flexWrap: 'wrap' }}>
              {b.markers.map((m) => (
                <Pressable key={m.m} onPress={() => setDialog({ kind: 'markers', i: idx })} style={{ paddingVertical: 4, paddingHorizontal: 9, borderRadius: 999, backgroundColor: hexA(m.c, 0.12) }}><Text style={{ fontSize: 10.5, fontFamily: F.bodySemi, color: m.c }}>{m.m} · {m.sev}</Text></Pressable>
              ))}
            </View>
          ) : null}
        </Card>
      ))}
    </Page>
  );
}

/* ============ CRM: ESCALATIONS ============ */
export function CrmEsc() {
  const { crmEscTab, set } = useStore();
  return (
    <Page gap={16} pt={6}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 16, backgroundColor: hexA(C.red, 0.09), borderWidth: 1, borderColor: hexA(C.red, 0.28) }}>
        <Icon name="shield" path="M8 3h8l5 5v8l-5 5H8l-5-5V8z" size={20} color={C.red} strokeWidth={2} />
        <View style={{ flex: 1 }}><Serif style={{ fontSize: 19 }}>Escalations</Serif><Body style={{ fontSize: 12, color: '#CC9999' }}>9 open · Manager view</Body></View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {escTabDefs.map((t) => {
          const active = crmEscTab === t.id;
          return (
            <Pressable key={t.id} onPress={() => set({ crmEscTab: t.id })} style={{ flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 9, paddingHorizontal: 14, borderRadius: 999, backgroundColor: active ? hexA(C.orange, 0.13) : 'transparent', borderWidth: 1, borderColor: active ? hexA(C.orange, 0.3) : 'rgba(255,255,255,0.05)' }}>
              <Text style={{ fontFamily: active ? F.bodySemi : F.body, fontSize: 13, color: active ? C.orange : C.muted }}>{t.label}</Text>
              <View style={{ paddingVertical: 1, paddingHorizontal: 6, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.05)' }}><Text style={{ fontFamily: F.mono, fontSize: 11, color: tones[t.tone] }}>{t.count}</Text></View>
            </Pressable>
          );
        })}
      </ScrollView>
      {escRows.map((e) => (
        <View key={e.title} style={{ backgroundColor: 'rgba(30,20,15,0.5)', borderWidth: 1, borderColor: 'rgba(255,150,90,0.09)', borderLeftWidth: 4, borderLeftColor: C.gold, borderRadius: 16, padding: 15 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <View style={{ paddingVertical: 3, paddingHorizontal: 9, borderRadius: 7, backgroundColor: hexA(C.red, 0.14) }}><Text style={{ fontSize: 10, fontFamily: F.bodyBold, color: C.red }}>{e.cat}</Text></View>
            <Text style={{ fontFamily: F.mono, fontSize: 11, color: C.red }}>{e.over}</Text>
          </View>
          <Body style={{ fontSize: 14, fontFamily: F.bodySemi, marginBottom: 5 }}>{e.title}</Body>
          <Body style={{ fontSize: 11.5, color: C.muted2, marginBottom: 10 }}>Due {e.due} · With {e.owner}</Body>
          <View style={{ paddingVertical: 9, paddingHorizontal: 11, borderRadius: 10, backgroundColor: hexA(C.gold, 0.08), borderWidth: 1, borderColor: hexA(C.gold, 0.2) }}><Body style={{ fontSize: 12, color: C.ink3 }}>{e.remark}</Body></View>
        </View>
      ))}
    </Page>
  );
}

/* ============ CRM: TASKS ============ */
export function CrmTasks() {
  return (
    <Page gap={16} pt={6}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <TitleBlock title="Task Manager" sub="Manage your tasks and stay organized" />
        <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 9, paddingHorizontal: 13, borderRadius: 12 }}><Icon name="plus" size={14} color="#fff" strokeWidth={2.6} /><Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: '#fff' }}>Create</Text></LinearGradient>
      </View>
      <View style={{ flexDirection: 'row', gap: 11, alignItems: 'center', paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, backgroundColor: hexA(C.gold, 0.08), borderWidth: 1, borderColor: hexA(C.gold, 0.26) }}>
        <Icon name="target" path="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M12 8v4M12 16h.01" size={17} color={C.gold} strokeWidth={2} />
        <Body style={{ fontSize: 12.5, color: '#E0C58A' }}>3 client(s) pending QHP scheduling</Body>
      </View>
      {tasksCols.map((col) => (
        <Card key={col.name} colors={['rgba(46,28,18,0.42)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.09)" radius={16} style={{ overflow: 'hidden' }}>
          <View style={{ height: 3, backgroundColor: col.c }} />
          <View style={{ padding: 14, paddingHorizontal: 16 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}><Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: '#fff' }}>{col.name}</Text><Mono style={{ fontSize: 12, color: C.muted2 }}>{col.tasks.length}</Mono></View>
            <View style={{ gap: 10 }}>
              {col.tasks.map((t) => (
                <View key={t.t} style={{ backgroundColor: 'rgba(0,0,0,0.28)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', borderRadius: 12, padding: 12 }}>
                  <View style={{ marginBottom: 8, alignSelf: 'flex-start', paddingVertical: 2, paddingHorizontal: 8, borderRadius: 6, backgroundColor: hexA(t.prc, 0.14) }}><Text style={{ fontSize: 10, fontFamily: F.bodyBold, color: t.prc }}>{t.pr}</Text></View>
                  <Body style={{ fontSize: 13.5, marginBottom: 8 }}>{t.t}</Body>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Icon name="calendar" size={12} color={C.muted2} strokeWidth={2} /><Body style={{ fontSize: 11, color: C.muted2 }}>{t.due}</Body></View>
                </View>
              ))}
            </View>
          </View>
        </Card>
      ))}
    </Page>
  );
}

/* ============ CRM: TOOLS ============ */
export function CrmTools() {
  const { go } = useStore();
  return (
    <Page gap={16} pt={6}>
      <TitleBlock title="Tools" sub="Quick utilities for managing your assigned clients" />
      <Card onPress={() => go('crm-blood')} colors={['rgba(46,28,18,0.42)', 'rgba(18,14,14,0.5)']} radius={18} style={{ padding: 18 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <IconChip icon="activity" color={C.orange} size={46} iconSize={22} />
          <Icon name="chevRight" size={18} color={C.muted} strokeWidth={2.2} />
        </View>
        <Serif style={{ fontSize: 18, marginTop: 14 }}>Blood Reports</Serif>
        <Body style={{ fontSize: 12.5, color: C.muted, marginTop: 4, lineHeight: 18 }}>View which clients have or are missing blood reports, and download a polished PDF.</Body>
      </Card>
      <View style={{ backgroundColor: 'rgba(255,255,255,0.02)', borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.1)', borderRadius: 18, padding: 18, opacity: 0.55 }}>
        <View style={{ width: 46, height: 46, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' }}><Icon name="target" path="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M12 8v8M8 12h8" size={22} color={C.muted3} strokeWidth={1.9} /></View>
        <Serif style={{ fontSize: 18, marginTop: 14, color: C.muted }}>More tools</Serif>
        <Body style={{ fontSize: 12.5, color: C.muted3, marginTop: 4 }}>Coming soon</Body>
      </View>
    </Page>
  );
}

/* ============ CRM: ASSESSMENT DETAILS ============ */
export function CrmAssessment() {
  const { go } = useStore();
  return (
    <Page gap={16} pt={6}>
      <BackLink label="QHP" onPress={() => go('crm-qhp')} />
      <TitleBlock title="QHP Details" sub="Aarav Kapoor" />
      <Card colors={['rgba(46,28,18,0.42)', 'rgba(18,14,14,0.5)']} radius={16} style={{ padding: 16, flexDirection: 'row', flexWrap: 'wrap' }}>
        {[['TYPE', 'QHP', C.ink], ['ASSESSOR', 'Anil', C.ink], ['SCORE', '72/100', C.orange], ['SCHEDULED', '28 Jun', C.ink], ['COMPLETED', '29 Jun', C.ink], ['LOCATION', 'Indiranagar', C.ink]].map(([l, v, col]) => (
          <View key={l as string} style={{ width: '33.3%', marginBottom: 14 }}><Mono style={{ fontSize: 9, color: C.muted3 }}>{l}</Mono><Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: col as string, marginTop: 3 }}>{v}</Text></View>
        ))}
      </Card>
      <Card colors={['rgba(46,28,18,0.42)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.09)" radius={16} style={{ padding: 16 }}>
        <Serif style={{ fontSize: 16, marginBottom: 12 }}>Assessment Data</Serif>
        <View style={{ gap: 9 }}>
          {[['Posture', 'Mild forward head'], ['Mobility', 'Good (7/10)'], ['Strength', 'Above average']].map(([k, v]) => (
            <View key={k} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 9, paddingHorizontal: 11, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.03)' }}><Body style={{ fontSize: 12.5, color: C.muted }}>{k}</Body><Body style={{ fontSize: 12.5, fontFamily: F.bodySemi }}>{v}</Body></View>
          ))}
        </View>
      </Card>
      <View style={{ backgroundColor: hexA(C.blue, 0.08), borderWidth: 1, borderColor: hexA(C.blue, 0.24), borderRadius: 16, padding: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 8 }}><Icon name="sparkle" size={15} color={C.blue} fill={C.blue} strokeWidth={0} /><Mono style={{ fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase', color: '#A9BCFF', fontFamily: F.bodyBold }}>AI Biomechanical Analysis</Mono></View>
        <Body style={{ fontSize: 13, color: C.ink3, lineHeight: 20 }}>Movement patterns are broadly efficient. Prioritise thoracic mobility and posterior-chain strength; forward-head posture suggests desk-related tightness — add daily neck & upper-back drills.</Body>
      </View>
    </Page>
  );
}

/* ============ CRM: HEALTH REPORT ============ */
export function CrmHealth() {
  const { go } = useStore();
  const markers = [
    { name: 'LDL Cholesterol', ref: 'Ref < 100 mg/dL', val: '165', status: 'Critical', c: C.red },
    { name: 'Vitamin D', ref: 'Ref 30–100 ng/mL', val: '18', status: 'Suboptimal', c: C.gold },
    { name: 'HbA1c', ref: 'Ref < 5.7%', val: '5.2', status: 'Optimal', c: C.green },
  ];
  return (
    <Page gap={16} pt={6}>
      <BackLink label="Back" onPress={() => go('client')} />
      <TitleBlock title="Health Report" sub="Aarav Kapoor — Full Panel · 20 Jun 2026" />
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Card colors={[hexA(C.green, 0.12), 'rgba(22,16,15,0.5)']} border={hexA(C.green, 0.22)} radius={18} style={{ flex: 1, padding: 18, alignItems: 'center' }}>
          <Mono style={{ fontSize: 10, color: C.mono }}>METABOLIC</Mono><Serif style={{ fontSize: 34, color: C.green, marginTop: 4 }}>78</Serif><Body style={{ fontSize: 10, color: C.muted2 }}>/ 100</Body>
        </Card>
        <Card colors={[hexA(C.blue, 0.12), 'rgba(22,16,15,0.5)']} border={hexA(C.blue, 0.22)} radius={18} style={{ flex: 1, padding: 18, alignItems: 'center' }}>
          <Mono style={{ fontSize: 10, color: C.mono }}>LONGEVITY</Mono><Serif style={{ fontSize: 34, color: C.blue, marginTop: 4 }}>71</Serif><Body style={{ fontSize: 10, color: C.muted2 }}>/ 100</Body>
        </Card>
      </View>
      <Card colors={['rgba(46,28,18,0.42)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.09)" radius={16} style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
        <Serif style={{ fontSize: 16, paddingVertical: 14, paddingBottom: 4 }}>Biomarkers</Serif>
        {markers.map((m) => (
          <View key={m.name} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' }}>
            <View><Body style={{ fontSize: 13.5, fontFamily: F.bodySemi }}>{m.name}</Body><Mono style={{ fontSize: 11, color: C.muted2 }}>{m.ref}</Mono></View>
            <View style={{ alignItems: 'flex-end' }}><Text style={{ fontFamily: F.mono, fontSize: 14, color: m.c }}>{m.val}</Text><Text style={{ fontSize: 10, fontFamily: F.bodyBold, color: m.c }}>{m.status}</Text></View>
          </View>
        ))}
      </Card>
      <View style={{ backgroundColor: hexA(C.blue, 0.08), borderWidth: 1, borderColor: hexA(C.blue, 0.24), borderRadius: 16, padding: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 8 }}><Icon name="sparkle" size={15} color={C.blue} fill={C.blue} strokeWidth={0} /><Mono style={{ fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase', color: '#A9BCFF', fontFamily: F.bodyBold }}>AI Analysis</Mono></View>
        <Body style={{ fontSize: 13, color: C.ink3, lineHeight: 20 }}>Elevated LDL is the key risk to address — prioritise soluble fibre, omega-3s, and reduced saturated fat. Vitamin D supplementation advised. Glycaemic control is excellent.</Body>
      </View>
    </Page>
  );
}
