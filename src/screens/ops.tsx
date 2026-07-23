import React from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator, Modal, ScrollView, Linking, Animated } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C, F, hexA, ORANGE_GRAD } from '../theme';
import { Icon, IconName } from '../icons';
import { Serif, Body, Mono, Card, Avatar, CountUp, ProgressBar } from '../components/primitives';
import { Page, TitleBlock, GreetingHeader, Badge, HScroll, BackLink } from './common';
import { FeatureTour, OPS_TOUR, TourLauncher } from '../components/featureTour';
import { useStore } from '../store';
import { useSidebarProfile } from '../lib/navQueries';
import { useLeadStats, useColdLeads, useOpsFollowUpReminders, useMyOpsProfile } from '../lib/opsLeadQueries';
import {
  useSalesTargetsOverview, useAppendSalesTargetNote, NOTE_CATEGORIES,
  useQhpHolds, useAddHoldReply, useCrmPendingAssignments, useOpsPaidClients,
  useBaselineExplanation, baselineMonths,
  type SalesTargetRow, type QhpHoldRow,
} from '../lib/opsQueries';

/* ============ OPS workspace (web /ops/*) — obsidian/ember UI ============ */

const fmtAt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }) : '—');
const fmtDay = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const AV_GRADS: [string, string][] = [['#FB8B3A', '#EE5E16'], ['#57C98A', '#2E9A63'], ['#7C8FE8', '#4A5AC8'], ['#9A7BEA', '#6E5BD0'], ['#E0A53C', '#C07C1E'], ['#4FD1C5', '#2C8A86'], ['#F687B3', '#C2568A'], ['#F0883E', '#C05621']];
export const opsAvColors = (seed: string): [string, string] => AV_GRADS[[...(seed || '?')].reduce((a, c) => a + c.charCodeAt(0), 0) % AV_GRADS.length];

function Loading() {
  return <View style={{ paddingVertical: 40, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View>;
}
function Err({ q }: { q: { isError: boolean; error: unknown } }) {
  if (!q.isError) return null;
  return <Body style={{ fontSize: 11.5, color: C.red, textAlign: 'center', paddingVertical: 10 }}>{(q.error as Error)?.message ?? 'Could not load.'}</Body>;
}
export function OpsSearch({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 13, paddingVertical: 11, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)' }}>
      <Icon name="search" size={15} color={C.muted3} strokeWidth={2} />
      <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={C.muted3} autoCorrect={false} style={{ flex: 1, fontFamily: F.body, fontSize: 14, color: '#fff', padding: 0 }} />
      {value ? <Pressable onPress={() => onChange('')} hitSlop={8}><Icon name="close" size={13} color={C.muted3} strokeWidth={2.3} /></Pressable> : null}
    </View>
  );
}

/* ================= 1. DASHBOARD ================= */

/* Pulse + entrance rhythm shared by the urgent banners (same as coach PendingPlansAlert). */
function usePulse() {
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
  return { pulse, enter };
}

/* Animated urgent banner — pulsing ring icon, glow wash, optional inset preview rows. */
function OpsAlertBanner({ color, tint, icon, title, sub, rows, cta, onPress }: {
  color: string; tint: string; icon: IconName; title: string; sub: string;
  rows?: { key: string; main: string; meta: string }[]; cta: string; onPress: () => void;
}) {
  const { pulse, enter } = usePulse();
  const glow = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.16, 0.7] });
  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] });
  const ringFade = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] });
  const iconTilt = pulse.interpolate({ inputRange: [0, 0.5, 1], outputRange: ['-8deg', '8deg', '-8deg'] });
  return (
    <Animated.View style={{ opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [-10, 0] }) }] }}>
      <Pressable onPress={onPress} style={{ borderRadius: 16, overflow: 'hidden' }}>
        <LinearGradient colors={[hexA(color, 0.16), 'rgba(26,16,11,0.88)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: 13, borderRadius: 16, borderWidth: 1, borderColor: hexA(color, 0.45), gap: 10 }}>
          <Animated.View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: hexA(color, 0.08), opacity: glow }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
              <Animated.View style={{ position: 'absolute', width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, borderColor: color, opacity: ringFade, transform: [{ scale: ringScale }] }} />
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: hexA(color, 0.16), borderWidth: 1, borderColor: hexA(color, 0.5), alignItems: 'center', justifyContent: 'center' }}>
                <Animated.View style={{ transform: [{ rotate: iconTilt }] }}>
                  <Icon name={icon} size={17} color={color} strokeWidth={2.1} />
                </Animated.View>
              </View>
            </View>
            <View style={{ flex: 1 }}>
              <Body style={{ fontSize: 13.5, fontFamily: F.bodyBold, color: '#fff' }}>{title}</Body>
              <Body numberOfLines={1} style={{ fontSize: 11, color: tint, marginTop: 1 }}>{sub}</Body>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, backgroundColor: hexA(color, 0.16), borderWidth: 1, borderColor: hexA(color, 0.45) }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 11, color }}>{cta}</Text>
              <Icon name="chevRight" size={12} color={color} strokeWidth={2.5} />
            </View>
          </View>
          {rows?.length ? (
            <View style={{ borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: hexA(color, 0.2) }}>
              {rows.map((r, i) => (
                <View key={r.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 11, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: 'rgba(255,255,255,0.05)' }}>
                  <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: color }} />
                  <Body numberOfLines={1} style={{ flex: 1, fontSize: 11.5, fontFamily: F.bodySemi, color: C.ink2 }}>{r.main}</Body>
                  <Mono style={{ fontSize: 8, letterSpacing: 0.4, color: tint }}>{r.meta}</Mono>
                </View>
              ))}
            </View>
          ) : null}
        </LinearGradient>
      </Pressable>
    </Animated.View>
  );
}

function SectionHead({ label }: { label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 10 }}>
      <Mono style={{ fontSize: 10.5, letterSpacing: 1.6, color: C.mono }}>{label}</Mono>
      <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.06)' }} />
    </View>
  );
}

/* KPI tile — mono label, colored accent strip, count-up serif number. */
function KpiTile({ label, value, suffix, icon, color, onPress }: { label: string; value: number | null; suffix?: string; icon: IconName; color: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ flex: 1, borderRadius: 17, backgroundColor: 'rgba(24,17,14,0.55)', borderWidth: 1, borderColor: hexA(color, 0.2), overflow: 'hidden' }}>
      <LinearGradient colors={[hexA(color, 0.5), 'rgba(255,255,255,0.02)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 3 }} />
      <View style={{ padding: 13, gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Mono style={{ fontSize: 8.5, letterSpacing: 0.8, color: C.muted3 }}>{label}</Mono>
          <View style={{ width: 26, height: 26, borderRadius: 9, backgroundColor: hexA(color, 0.14), alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={icon} size={13} color={color} strokeWidth={2} />
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 5 }}>
          {value == null ? <Serif style={{ fontSize: 26, color: C.muted3 }}>—</Serif> : <CountUp value={value} style={{ fontSize: 26, color }} />}
          {suffix ? <Serif style={{ fontSize: 15, color: hexA(color, 0.7), marginBottom: 2 }}>{suffix}</Serif> : null}
        </View>
      </View>
    </Pressable>
  );
}

/* Radar row — one live queue that needs eyes, with count pill. */
function AttentionRow({ icon, color, title, sub, count, onPress }: { icon: IconName; color: string; title: string; sub: string; count: number; onPress: () => void }) {
  return (
    <Card onPress={onPress} colors={['rgba(46,28,18,0.42)', 'rgba(18,14,14,0.5)']} border={hexA(color, 0.2)} radius={15} style={{ padding: 12, flexDirection: 'row', alignItems: 'center', gap: 11 }}>
      <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: hexA(color, 0.13), borderWidth: 1, borderColor: hexA(color, 0.32), alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={16} color={color} strokeWidth={2} />
      </View>
      <View style={{ flex: 1 }}>
        <Body style={{ fontSize: 13, fontFamily: F.bodySemi, color: '#fff' }}>{title}</Body>
        <Body numberOfLines={1} style={{ fontSize: 10.5, color: C.muted3, marginTop: 1 }}>{sub}</Body>
      </View>
      <View style={{ minWidth: 26, height: 26, borderRadius: 13, paddingHorizontal: 8, backgroundColor: hexA(color, 0.16), borderWidth: 1, borderColor: hexA(color, 0.4), alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color }}>{count}</Text>
      </View>
      <Icon name="chevRight" size={13} color={C.muted3} strokeWidth={2.2} />
    </Card>
  );
}

const istYmdOf = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));

export function OpsDashboard() {
  const [tourOpen, setTourOpen] = React.useState(false);
  const prof = useSidebarProfile();
  const { go, set } = useStore();
  const statsQ = useLeadStats();
  const coldQ = useColdLeads();
  const remindersQ = useOpsFollowUpReminders(true);
  const holdsQ = useQhpHolds(true);
  const pendingQ = useCrmPendingAssignments(true);
  const s = statsQ.data;

  const reminders = remindersQ.data ?? [];
  const overdueFollowUps = reminders.filter((r) => r.overdue);
  const holds = holdsQ.data ?? [];
  const overdueHolds = holds.filter((h) => h.is_overdue);
  const pending = pendingQ.data ?? [];
  const pendingOverdue = pending.filter((p) => p.overdue);
  const todayYmd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const dueToday = reminders.filter((r) => !r.overdue && istYmdOf(r.next_follow_up_at) === todayYmd);
  const upNext = [...reminders].sort((a, b) => a.next_follow_up_at.localeCompare(b.next_follow_up_at)).slice(0, 3);

  const istHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }).format(new Date()));
  const greeting = istHour < 12 ? 'Good morning' : istHour < 17 ? 'Good afternoon' : 'Good evening';
  const first = (prof.fullName || 'Ops').split(' ')[0];
  const monthName = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', month: 'long' }).toUpperCase();
  const goLeads = (quick?: string) => { set({ crmSection: quick ?? null }); go('ops-leads'); };

  // Attention section states — the rows below render dueToday/holds/pending, so the
  // gate must match exactly; overdue follow-ups are covered by the red banner above.
  const attnLoading = remindersQ.isLoading || holdsQ.isLoading || pendingQ.isLoading;
  const attnError = remindersQ.isError || holdsQ.isError || pendingQ.isError;
  const attnRowCount = (dueToday.length ? 1 : 0) + (holds.length ? 1 : 0) + (pending.length ? 1 : 0);
  const allClear = !attnLoading && !attnError && attnRowCount === 0 && overdueFollowUps.length === 0;
  const showAttention = attnLoading || attnError || attnRowCount > 0 || allClear;

  return (
    <Page gap={16}>
      <GreetingHeader
        date={new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: '2-digit', month: 'short' }).replace(',', ' ·').toUpperCase()}
        name={`${greeting}, ${first}`}
        sub="Leads, sales & escalations"
        initial={prof.initial}
        avatarUrl={prof.avatarUrl}
        rightAction={<TourLauncher onPress={() => setTourOpen(true)} />}
      />
      <FeatureTour visible={tourOpen} steps={OPS_TOUR} tourName='ops' onClose={() => setTourOpen(false)} />

      {/* Urgent banners — animated, with previews */}
      {overdueFollowUps.length > 0 ? (
        <OpsAlertBanner
          color={C.red} tint="#E0A090" icon="clock"
          title={`${overdueFollowUps.length} overdue follow-up${overdueFollowUps.length === 1 ? '' : 's'}`}
          sub="Leads waiting past their scheduled call time"
          rows={overdueFollowUps.slice(0, 3).map((r) => ({ key: r.id, main: r.name, meta: fmtAt(r.next_follow_up_at).toUpperCase() }))}
          cta="Open" onPress={() => goLeads()}
        />
      ) : null}
      {overdueHolds.length > 0 ? (
        <OpsAlertBanner
          color={C.gold} tint="#F2C066" icon="alert"
          title={`${overdueHolds.length} QHP hold${overdueHolds.length === 1 ? '' : 's'} past deadline`}
          sub="Resolve time crossed — reply or release the hold"
          rows={overdueHolds.slice(0, 3).map((h) => ({ key: h.lead_id, main: h.client_name, meta: h.resolving_at ? `DUE ${fmtAt(h.resolving_at).toUpperCase()}` : 'NO DEADLINE' }))}
          cta="Resolve" onPress={() => go('ops-qhp-hold')}
        />
      ) : null}

      {/* Hero — pipeline this month */}
      <Err q={statsQ} />
      {statsQ.isLoading ? <Loading /> : s ? (
        <>
          <Card onPress={() => goLeads('pipeline')} colors={['rgba(64,38,22,0.5)', 'rgba(20,16,15,0.55)']} border={hexA(C.orange, 0.24)} radius={18} style={{ overflow: 'hidden' }}>
            <LinearGradient colors={[hexA(C.orange, 0.55), 'rgba(255,255,255,0.02)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 3 }} />
            <View style={{ padding: 15, gap: 13 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: C.orange }} />
                <Mono style={{ flex: 1, fontSize: 9.5, letterSpacing: 1.4, color: '#F0A875' }}>LEAD PIPELINE · {monthName}</Mono>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 9, borderRadius: 999, backgroundColor: hexA(C.orange, 0.13), borderWidth: 1, borderColor: hexA(C.orange, 0.35) }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 9.5, color: C.orange }}>Open board</Text>
                  <Icon name="chevRight" size={10} color={C.orange} strokeWidth={2.6} />
                </View>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10 }}>
                <CountUp value={s.activePipeline} style={{ fontSize: 42, lineHeight: 46 }} />
                <Body style={{ flex: 1, fontSize: 11, color: C.muted, lineHeight: 15, marginBottom: 5 }}>leads in active pipeline{'\n'}New · Potential · QHP Booked</Body>
              </View>
              <View style={{ gap: 6 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Mono style={{ fontSize: 8.5, letterSpacing: 0.9, color: C.muted3 }}>CONVERSION</Mono>
                  <Body style={{ fontSize: 11, color: C.ink2 }}><Text style={{ fontFamily: F.bodyBold, color: C.green }}>{s.converted}</Text> won · {s.conversionRate}%</Body>
                </View>
                <ProgressBar pct={s.conversionRate} height={7} animated />
              </View>
              <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)', paddingTop: 11 }}>
                {(([['THIS MONTH', s.thisMonth], ['THIS WEEK', s.newThisWeek], ['ALL TIME', s.total]]) as [string, number][]).map(([lab, val], i) => (
                  <View key={lab} style={{ flex: 1, alignItems: 'center', gap: 2, borderLeftWidth: i === 0 ? 0 : 1, borderLeftColor: 'rgba(255,255,255,0.06)' }}>
                    <Serif style={{ fontSize: 18 }}>{val}</Serif>
                    <Mono style={{ fontSize: 8, letterSpacing: 0.6, color: C.muted3 }}>{lab}</Mono>
                  </View>
                ))}
              </View>
            </View>
          </Card>

          {/* KPI pair */}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <KpiTile label="COLD LEADS" value={coldQ.data?.count ?? null} icon="clock" color={C.red} onPress={() => goLeads('cold')} />
            <KpiTile label="CONVERTED" value={s.converted} suffix={`${s.conversionRate}%`} icon="checks" color={C.green} onPress={() => goLeads('converted')} />
          </View>
        </>
      ) : null}

      {/* Needs attention — live queues */}
      {showAttention ? (
        <View>
          <SectionHead label="NEEDS ATTENTION" />
          {attnLoading ? <Loading /> : attnError ? (
            <View style={{ gap: 4 }}>
              <Err q={remindersQ} />
              <Err q={holdsQ} />
              <Err q={pendingQ} />
            </View>
          ) : allClear ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 13, borderRadius: 14, backgroundColor: hexA(C.green, 0.07), borderWidth: 1, borderColor: hexA(C.green, 0.28) }}>
              <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: hexA(C.green, 0.14), alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="checks" size={14} color={C.green} strokeWidth={2.2} />
              </View>
              <Body style={{ flex: 1, fontSize: 12, color: hexA(C.green, 0.95) }}>All clear — no holds, pending assignments or follow-ups due today.</Body>
            </View>
          ) : (
            <View style={{ gap: 9 }}>
              {dueToday.length > 0 ? (
                <AttentionRow icon="clock" color={C.orange} title="Follow-ups due today" sub={`Next: ${dueToday[0].name} · ${fmtAt(dueToday[0].next_follow_up_at)}`} count={dueToday.length} onPress={() => goLeads()} />
              ) : null}
              {holds.length > 0 ? (
                <AttentionRow icon="heart" color={C.gold} title="QHP reports on hold" sub={overdueHolds.length ? `${overdueHolds.length} past the resolve deadline` : 'Awaiting your reply'} count={holds.length} onPress={() => go('ops-qhp-hold')} />
              ) : null}
              {pending.length > 0 ? (
                <AttentionRow icon="userPlus" color={C.blue} title="Paid — CRM assignment pending" sub={pendingOverdue.length ? `${pendingOverdue.length} waiting 24h+` : 'Payment received, no CRM yet'} count={pending.length} onPress={() => go('ops-crm-pending')} />
              ) : null}
            </View>
          )}
        </View>
      ) : null}

      {/* Up next — soonest follow-ups */}
      {upNext.length > 0 ? (
        <View>
          <SectionHead label="UP NEXT · FOLLOW-UPS" />
          <Card colors={['rgba(46,28,18,0.42)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.1)" radius={16} style={{ paddingVertical: 4 }}>
            {upNext.map((r, i) => (
              <Pressable key={r.id} onPress={() => goLeads()} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 10, paddingHorizontal: 13, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: 'rgba(255,255,255,0.05)' }}>
                <Avatar initial={(r.name[0] ?? '?').toUpperCase()} size={34} colors={opsAvColors(r.name)} fontSize={13} />
                <View style={{ flex: 1 }}>
                  <Body numberOfLines={1} style={{ fontSize: 12.5, fontFamily: F.bodySemi, color: '#fff' }}>{r.name}</Body>
                  <Body numberOfLines={1} style={{ fontSize: 10, color: C.muted3, marginTop: 1 }}>{r.next_follow_up_note || r.stage}</Body>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 3 }}>
                  <Mono style={{ fontSize: 8, letterSpacing: 0.4, color: r.overdue ? C.red : '#F0A875' }}>{fmtAt(r.next_follow_up_at).toUpperCase()}</Mono>
                  {r.overdue ? <Badge text="Overdue" color={C.red} /> : null}
                </View>
              </Pressable>
            ))}
            <Pressable onPress={() => goLeads()} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)' }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 11.5, color: C.orange }}>View all follow-ups</Text>
              <Icon name="arrowRight" size={12} color={C.orange} strokeWidth={2.4} />
            </Pressable>
          </Card>
        </View>
      ) : null}

      {/* Workspace shortcuts */}
      <View>
        <SectionHead label="WORKSPACE" />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 9 }}>
          {(([
            ['target', 'Leads', 'Pipeline & applicants', C.orange, () => goLeads()],
            ['trend', 'Sales Targets', 'Deals & ops notes', C.gold, () => go('ops-targets')],
            ['alert', 'Escalations', 'SLA ladder & renewals', C.red, () => go('ops-escalations')],
            ['users', 'Paid Clients', 'Active roster & CRM', C.green, () => go('ops-clients')],
            ['activity', 'CRM Activity', 'Baseline explanations', C.purple, () => go('ops-activity')],
            ['chart', 'QHP Stats', 'Bookings & conversion', C.blue, () => go('qhp-stats')],
          ]) as [IconName, string, string, string, () => void][]).map(([ic, label, hint, col, onPress]) => (
            <Card key={label} onPress={onPress} colors={['rgba(46,28,18,0.42)', 'rgba(18,14,14,0.5)']} border={hexA(col, 0.18)} radius={16} style={{ width: '47.5%', flexGrow: 1, overflow: 'hidden' }}>
              <LinearGradient colors={[hexA(col, 0.5), 'rgba(255,255,255,0.02)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 3 }} />
              <View style={{ padding: 12, gap: 9 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: hexA(col, 0.13), borderWidth: 1, borderColor: hexA(col, 0.3), alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name={ic} size={15} color={col} strokeWidth={2} />
                  </View>
                  <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="chevRight" size={12} color={C.muted2} strokeWidth={2.3} />
                  </View>
                </View>
                <View>
                  <Body numberOfLines={1} style={{ fontSize: 13, fontFamily: F.bodySemi, color: '#fff' }}>{label}</Body>
                  <Body numberOfLines={1} style={{ fontSize: 9.5, color: C.muted3, marginTop: 1 }}>{hint}</Body>
                </View>
              </View>
            </Card>
          ))}
        </View>
      </View>
    </Page>
  );
}

/* ================= 2. PAID CLIENTS ================= */
export function OpsClients() {
  const q = useOpsPaidClients(true);
  const [search, setSearch] = React.useState('');
  const [visible, setVisible] = React.useState(30);
  const all = q.data ?? [];
  const term = search.trim().toLowerCase();
  const list = term ? all.filter((c) => c.name.toLowerCase().includes(term) || (c.assignedCrm ?? '').toLowerCase().includes(term)) : all;

  return (
    <Page gap={13}>
      <TitleBlock title="Paid Clients" sub={q.data ? `${all.length} paying clients` : 'Roster with assigned CRM & packages'} />
      <OpsSearch value={search} onChange={(v) => { setSearch(v); setVisible(30); }} placeholder="Search by client or CRM…" />
      <Err q={q} />
      {q.isLoading ? <Loading /> : list.length === 0 ? <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 24 }}>No clients match.</Body> : (
        <>
          {list.slice(0, visible).map((c) => (
            <Card key={c.id} colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.1)" radius={14} style={{ padding: 12, gap: 7 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
                <Avatar initial={c.initial} size={38} fontSize={14} colors={opsAvColors(c.name)} />
                <View style={{ flex: 1 }}>
                  <Body numberOfLines={1} style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{c.name}</Body>
                  <Body numberOfLines={1} style={{ fontSize: 10.5, color: C.muted2, marginTop: 1 }}>CRM {c.assignedCrm ?? '— unassigned'}</Body>
                </View>
                {c.status !== 'active' ? <Badge text={c.status} color={C.muted2} /> : null}
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Badge text={c.subscription} color={C.gold} />
                {c.lastPackage ? <Badge text={c.lastPackage} color={C.blue} /> : null}
                {c.paymentDate ? <Mono style={{ fontSize: 8.5, letterSpacing: 0.4, color: C.muted3 }}>PAID {fmtDay(c.paymentDate).toUpperCase()}</Mono> : null}
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
    </Page>
  );
}

/* ================= 3. CRM PENDING ================= */
export function OpsCrmPending() {
  const q = useCrmPendingAssignments(true);
  const [search, setSearch] = React.useState('');
  const all = q.data ?? [];
  const term = search.trim().toLowerCase();
  const list = term ? all.filter((r) => r.clientName.toLowerCase().includes(term)) : all;
  const over24 = all.filter((r) => r.overdue).length;

  return (
    <Page gap={13}>
      <TitleBlock title="CRM Pending" sub="Paid clients with no CRM assigned within 3 hours" />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {(([['TOTAL PENDING', `${all.length}`, C.gold], ['PENDING > 24H', `${over24}`, C.red], ['AUTO-REFRESH', '60s', C.blue]]) as [string, string, string][]).map(([lab, val, col]) => (
          <Card key={lab} colors={['rgba(56,34,21,0.5)', 'rgba(20,16,15,0.5)']} border={hexA(col, 0.22)} radius={14} style={{ flex: 1, padding: 11, alignItems: 'center', gap: 3 }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 18, color: col }}>{val}</Text>
            <Mono style={{ fontSize: 6.5, letterSpacing: 0.6, color: C.muted3 }}>{lab}</Mono>
          </Card>
        ))}
      </View>
      <OpsSearch value={search} onChange={setSearch} placeholder="Search clients…" />
      <Body style={{ fontSize: 10.5, color: C.muted2 }}>Assignment happens from the Admin panel — this list is visibility only.</Body>
      <Err q={q} />
      {q.isLoading ? <Loading /> : list.length === 0 ? <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 24 }}>Nothing pending — every paid client has a CRM. 🎉</Body> : list.map((r) => (
        <Card key={r.id} colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border={hexA(r.overdue ? C.red : C.gold, 0.2)} radius={14} style={{ padding: 12, borderLeftWidth: 3, borderLeftColor: r.overdue ? C.red : C.gold, gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Body numberOfLines={1} style={{ flex: 1, fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{r.clientName}</Body>
            <Badge text={r.overdue ? 'Pending > 24h' : 'Waiting'} color={r.overdue ? C.red : C.gold} />
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            {r.phone ? <Pressable onPress={() => Linking.openURL(`tel:${r.phone}`)}><Body style={{ fontSize: 11, color: C.blue }}>{r.phone}</Body></Pressable> : null}
            {r.email ? <Body numberOfLines={1} style={{ fontSize: 11, color: C.muted2 }}>{r.email}</Body> : null}
          </View>
          <Mono style={{ fontSize: 8.5, letterSpacing: 0.5, color: C.muted3 }}>PAYMENT RECEIVED {fmtAt(r.paymentReceivedAt).toUpperCase()}</Mono>
        </Card>
      ))}
    </Page>
  );
}

/* ================= 4. CRM ACTIVITY hub + BASELINE ================= */
export function OpsCrmActivity() {
  const { go } = useStore();
  return (
    <Page gap={14}>
      <TitleBlock title="CRM Activity" sub="Trackers for CRM follow-through" />
      <Card onPress={() => go('ops-baseline')} colors={['rgba(56,34,21,0.5)', 'rgba(20,16,15,0.5)']} border={hexA(C.purple, 0.25)} radius={16} style={{ padding: 15, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: hexA(C.purple, 0.14), alignItems: 'center', justifyContent: 'center' }}><Icon name="heart" size={18} color={C.purple} strokeWidth={2} /></View>
        <View style={{ flex: 1 }}>
          <Body style={{ fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }}>Baseline Explanation Status</Body>
          <Body style={{ fontSize: 11, color: C.muted2, marginTop: 2 }}>Has CRM explained the QHP baseline report to each new paid client?</Body>
        </View>
        <Icon name="chevRight" size={16} color={C.muted3} strokeWidth={2.2} />
      </Card>
    </Page>
  );
}

export function OpsBaseline() {
  const { back } = useStore();
  const months = React.useMemo(baselineMonths, []);
  const [monthKey, setMonthKey] = React.useState(months[0]?.key ?? '');
  const [tab, setTab] = React.useState<'all' | 'explained' | 'pending'>('all');
  const [search, setSearch] = React.useState('');
  const q = useBaselineExplanation(monthKey, true);
  const all = q.data ?? [];
  const explained = all.filter((r) => r.explained);
  const term = search.trim().toLowerCase();
  const list = (tab === 'explained' ? explained : tab === 'pending' ? all.filter((r) => !r.explained) : all)
    .filter((r) => !term || r.name.toLowerCase().includes(term) || (r.assignedCrm ?? '').toLowerCase().includes(term));

  return (
    <Page gap={13}>
      <BackLink label="CRM Activity" onPress={back} />
      <TitleBlock title="Baseline Explanation" sub="QHP baseline walk-through per newly onboarded client" />
      <HScroll gap={7}>
        {months.map((m) => {
          const active = monthKey === m.key;
          return (
            <Pressable key={m.key} onPress={() => setMonthKey(m.key)} style={{ paddingVertical: 8, paddingHorizontal: 13, borderRadius: 999, backgroundColor: active ? hexA(C.orange, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.orange, 0.5) : 'rgba(255,255,255,0.09)' }}>
              <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 11.5, color: active ? C.orange : C.muted }}>{m.label}</Text>
            </Pressable>
          );
        })}
      </HScroll>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {(([['all', 'ALL', all.length, C.blue], ['explained', 'EXPLAINED', explained.length, C.green], ['pending', 'PENDING', all.length - explained.length, C.red]]) as ['all' | 'explained' | 'pending', string, number, string][]).map(([id, lab, n, col]) => {
          const active = tab === id;
          return (
            <Pressable key={id} onPress={() => setTab(id)} style={{ flex: 1 }}>
              <Card colors={['rgba(56,34,21,0.5)', 'rgba(20,16,15,0.5)']} border={hexA(col, active ? 0.5 : 0.2)} radius={14} style={{ padding: 11, alignItems: 'center', gap: 3 }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 18, color: col }}>{n}</Text>
                <Mono style={{ fontSize: 7, letterSpacing: 0.6, color: active ? col : C.muted3 }}>{lab}</Mono>
              </Card>
            </Pressable>
          );
        })}
      </View>
      <OpsSearch value={search} onChange={setSearch} placeholder="Search by client or CRM…" />
      <Err q={q} />
      {q.isLoading ? <Loading /> : list.length === 0 ? <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 24 }}>No clients in this view.</Body> : list.map((r) => (
        <Card key={r.clientId} colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border={hexA(r.explained ? C.green : C.red, 0.18)} radius={14} style={{ padding: 12, borderLeftWidth: 3, borderLeftColor: r.explained ? C.green : C.red, gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Body numberOfLines={1} style={{ flex: 1, fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{r.name}</Body>
            <Badge text={r.explained ? (r.source === 'journey' ? 'Explained (Journey)' : 'Explained') : 'Pending'} color={r.explained ? C.green : C.red} />
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <Badge text={r.subscription} color={C.gold} />
            <Body style={{ fontSize: 10.5, color: C.muted2 }}>CRM {r.assignedCrm ?? '—'}</Body>
            <Mono style={{ fontSize: 8, letterSpacing: 0.4, color: C.muted3 }}>ONBOARDED {fmtDay(r.onboardedAt).toUpperCase()}</Mono>
          </View>
          {r.explained ? (
            <Body style={{ fontSize: 10.5, color: C.muted2 }}>
              By {r.explainedBy ?? '—'}{r.explainedBy && r.explainedBy === r.assignedCrm ? ' (same as assigned)' : ''}{r.explainedAt ? ` · ${fmtAt(r.explainedAt)}` : ''}
            </Body>
          ) : null}
        </Card>
      ))}
    </Page>
  );
}

/* ================= 5. SALES TARGETS ================= */
function TargetNoteSheet({ target, canWrite, onClose }: { target: SalesTargetRow; canWrite: boolean; onClose: () => void }) {
  const m = useAppendSalesTargetNote();
  const [cat, setCat] = React.useState<string>('general');
  const [note, setNote] = React.useState('');
  const [err, setErr] = React.useState<string | null>(null);
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.62)', justifyContent: 'flex-end' }}>
        <View style={{ maxHeight: '85%', backgroundColor: '#0E0A09', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.14)', paddingHorizontal: 18, paddingTop: 14, paddingBottom: 24 }}>
          <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 12 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 10 }}>
            <Serif numberOfLines={1} style={{ flex: 1, fontSize: 18 }}>{target.clientName}</Serif>
            <Badge text={target.status} color={target.status === 'won' ? C.green : target.status === 'lost' ? C.red : C.gold} />
            <Pressable onPress={onClose} hitSlop={8}><Icon name="close" size={14} color={C.muted2} strokeWidth={2.3} /></Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingBottom: 10 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Badge text={target.targetType} color={C.blue} />
              <Body style={{ fontSize: 11, color: C.muted2 }}>Owner {target.ownerName}</Body>
              <Mono style={{ fontSize: 8.5, color: C.muted3 }}>OPENED {fmtDay(target.createdAt).toUpperCase()}</Mono>
              {target.stale ? <Badge text="Stale ≥14d" color={C.red} /> : null}
            </View>
            {target.lostReason ? <Body style={{ fontSize: 11.5, color: C.red }}>Lost: {target.lostReason}</Body> : null}
            {(target.opsNotes ?? []).length ? (
              <View style={{ gap: 7 }}>
                <Mono style={{ fontSize: 9, letterSpacing: 0.8, color: C.muted3 }}>OPS NOTES · {target.opsNotes.length}</Mono>
                {[...target.opsNotes].reverse().map((n, i) => (
                  <View key={n.id ?? i} style={{ padding: 10, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.22)', borderLeftWidth: 3, borderLeftColor: hexA(C.orange, 0.6), gap: 3 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                      <Badge text={String(n.category).replace('_', ' ')} color={C.orange} />
                      <Mono style={{ fontSize: 7.5, color: C.muted3 }}>{(n.by_name ?? '').toUpperCase()} · {fmtAt(n.at).toUpperCase()}</Mono>
                    </View>
                    <Body style={{ fontSize: 11.5, color: C.ink2, lineHeight: 16 }}>{n.note}</Body>
                  </View>
                ))}
              </View>
            ) : <Body style={{ fontSize: 11.5, color: C.muted3 }}>No ops notes yet.</Body>}
            {canWrite ? (
              <View style={{ gap: 8 }}>
                <Mono style={{ fontSize: 9, letterSpacing: 0.8, color: C.muted3 }}>ADD COACHING NOTE</Mono>
                <HScroll gap={6}>
                  {NOTE_CATEGORIES.map(([id, label]) => {
                    const active = cat === id;
                    return (
                      <Pressable key={id} onPress={() => setCat(id)} style={{ paddingVertical: 7, paddingHorizontal: 11, borderRadius: 999, backgroundColor: active ? hexA(C.orange, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.orange, 0.5) : 'rgba(255,255,255,0.09)' }}>
                        <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 11, color: active ? C.orange : C.muted }}>{label}</Text>
                      </Pressable>
                    );
                  })}
                </HScroll>
                <TextInput value={note} onChangeText={(v) => setNote(v.slice(0, 1000))} placeholder="Coaching note for the CRM (min 5 chars)…" placeholderTextColor={C.muted3} multiline style={{ minHeight: 70, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', padding: 11, color: '#fff', fontFamily: F.body, fontSize: 13, textAlignVertical: 'top' }} />
                {err ? <Body style={{ fontSize: 11, color: C.red }}>{err}</Body> : null}
                <Pressable
                  onPress={() => { setErr(null); m.mutate({ targetId: target.id, category: cat, note }, { onSuccess: () => setNote(''), onError: (e: any) => setErr(e?.message ?? 'Failed') }); }}
                  disabled={m.isPending || note.trim().length < 5}
                  style={{ alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: hexA(C.orange, note.trim().length < 5 ? 0.06 : 0.15), borderWidth: 1, borderColor: hexA(C.orange, note.trim().length < 5 ? 0.2 : 0.5) }}
                >
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: note.trim().length < 5 ? C.muted3 : C.orange }}>{m.isPending ? 'Adding…' : 'Add note'}</Text>
                </Pressable>
              </View>
            ) : <Body style={{ fontSize: 10.5, color: C.muted3 }}>Read-only — ops/admin/managers can add notes.</Body>}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export function OpsTargets() {
  const profQ = useMyOpsProfile();
  const q = useSalesTargetsOverview(true);
  const [status, setStatus] = React.useState<'all' | 'open' | 'won' | 'lost'>('all');
  const [staleOnly, setStaleOnly] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [open, setOpen] = React.useState<SalesTargetRow | null>(null);
  const all = q.data ?? [];
  const canWrite = profQ.data?.role === 'ops' || profQ.data?.role === 'admin' || profQ.data?.managers === true;
  const term = search.trim().toLowerCase();
  const list = all
    .filter((t) => (status === 'all' ? true : t.status === status))
    .filter((t) => !staleOnly || t.stale)
    .filter((t) => !term || t.clientName.toLowerCase().includes(term) || t.ownerName.toLowerCase().includes(term));

  return (
    <Page gap={13}>
      <TitleBlock title="Sales Targets" sub="Cross-CRM sales tracker with ops coaching notes" />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {(([['OPEN', all.filter((t) => t.status === 'open').length, C.gold], ['WON', all.filter((t) => t.status === 'won').length, C.green], ['LOST', all.filter((t) => t.status === 'lost').length, C.red], ['STALE ≥14D', all.filter((t) => t.stale).length, C.purple]]) as [string, number, string][]).map(([lab, n, col]) => (
          <Card key={lab} colors={['rgba(56,34,21,0.5)', 'rgba(20,16,15,0.5)']} border={hexA(col, 0.22)} radius={14} style={{ flex: 1, padding: 10, alignItems: 'center', gap: 3 }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 17, color: col }}>{n}</Text>
            <Mono style={{ fontSize: 6, letterSpacing: 0.5, color: C.muted3 }}>{lab}</Mono>
          </Card>
        ))}
      </View>
      <HScroll gap={7}>
        {(['all', 'open', 'won', 'lost'] as const).map((s) => {
          const active = status === s;
          return (
            <Pressable key={s} onPress={() => setStatus(s)} style={{ paddingVertical: 8, paddingHorizontal: 13, borderRadius: 999, backgroundColor: active ? hexA(C.orange, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.orange, 0.5) : 'rgba(255,255,255,0.09)' }}>
              <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 11.5, color: active ? C.orange : C.muted, textTransform: 'capitalize' }}>{s}</Text>
            </Pressable>
          );
        })}
        <Pressable onPress={() => setStaleOnly((v) => !v)} style={{ paddingVertical: 8, paddingHorizontal: 13, borderRadius: 999, backgroundColor: staleOnly ? hexA(C.purple, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: staleOnly ? hexA(C.purple, 0.5) : 'rgba(255,255,255,0.09)' }}>
          <Text style={{ fontFamily: staleOnly ? F.bodyBold : F.bodySemi, fontSize: 11.5, color: staleOnly ? C.purple : C.muted }}>Stale only</Text>
        </Pressable>
      </HScroll>
      <OpsSearch value={search} onChange={setSearch} placeholder="Search by client or CRM owner…" />
      <Err q={q} />
      {q.isLoading ? <Loading /> : list.length === 0 ? <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 24 }}>No targets match.</Body> : list.map((t) => (
        <Card key={t.id} onPress={() => setOpen(t)} colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border={hexA(t.status === 'won' ? C.green : t.status === 'lost' ? C.red : C.gold, 0.18)} radius={14} style={{ padding: 12, borderLeftWidth: 3, borderLeftColor: t.status === 'won' ? C.green : t.status === 'lost' ? C.red : C.gold, gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Body numberOfLines={1} style={{ flex: 1, fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{t.clientName}</Body>
            {t.stale ? <Badge text="Stale" color={C.purple} /> : null}
            <Badge text={t.status} color={t.status === 'won' ? C.green : t.status === 'lost' ? C.red : C.gold} />
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <Badge text={t.targetType} color={C.blue} />
            <Body style={{ fontSize: 10.5, color: C.muted2 }}>Owner {t.ownerName}</Body>
            <Mono style={{ fontSize: 8, letterSpacing: 0.4, color: C.muted3 }}>{fmtDay(t.createdAt).toUpperCase()}</Mono>
            {(t.opsNotes ?? []).length ? <Badge text={`${t.opsNotes.length} note${t.opsNotes.length === 1 ? '' : 's'}`} color={C.orange} /> : null}
          </View>
        </Card>
      ))}
      {open ? <TargetNoteSheet target={(q.data ?? []).find((t) => t.id === open.id) ?? open} canWrite={canWrite} onClose={() => setOpen(null)} /> : null}
    </Page>
  );
}

/* ================= 6. QHP HOLD ================= */
function HoldCard({ hold }: { hold: QhpHoldRow }) {
  const [open, setOpen] = React.useState(false);
  const [msg, setMsg] = React.useState('');
  const [err, setErr] = React.useState<string | null>(null);
  const reply = useAddHoldReply();
  const dueSoon = !hold.is_overdue && hold.resolving_at && (new Date(hold.resolving_at).getTime() - Date.now()) / 60000 <= 720;
  const col = hold.is_overdue ? C.red : dueSoon ? C.gold : C.blue;
  return (
    <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border={hexA(col, 0.2)} radius={14} style={{ padding: 12, borderLeftWidth: 3, borderLeftColor: col, gap: 7 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Body numberOfLines={1} style={{ flex: 1, fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{hold.client_name}</Body>
        <Badge text={hold.is_overdue ? 'Overdue' : dueSoon ? 'Due in <12h' : 'On hold'} color={col} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        {hold.phone ? <Pressable onPress={() => Linking.openURL(`tel:${hold.phone}`)}><Body style={{ fontSize: 11, color: C.blue }}>{hold.phone}</Body></Pressable> : null}
        <Body style={{ fontSize: 10.5, color: C.muted2 }}>Held by {hold.held_by_name ?? '—'}</Body>
        {hold.resolving_at ? <Mono style={{ fontSize: 8, letterSpacing: 0.4, color: col }}>RESOLVE BY {fmtAt(hold.resolving_at).toUpperCase()}</Mono> : null}
      </View>
      {hold.reason ? (
        <View style={{ padding: 9, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.03)', borderLeftWidth: 2, borderLeftColor: hexA(col, 0.6) }}>
          <Mono style={{ fontSize: 7.5, letterSpacing: 0.6, color: C.muted3 }}>REASON FOR HOLD</Mono>
          <Body style={{ fontSize: 11.5, color: C.ink2, lineHeight: 16, marginTop: 2 }}>{hold.reason}</Body>
        </View>
      ) : null}
      <Pressable onPress={() => setOpen((o) => !o)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Icon name={open ? 'chevUp' : 'chevDown'} size={12} color={C.muted2} strokeWidth={2.2} />
        <Body style={{ fontSize: 11, color: C.muted2 }}>Replies ({hold.replies.length})</Body>
      </Pressable>
      {open ? (
        <View style={{ gap: 7 }}>
          {hold.replies.map((r) => (
            <View key={r.id} style={{ padding: 9, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.22)', gap: 2 }}>
              <Mono style={{ fontSize: 7.5, letterSpacing: 0.5, color: C.muted3 }}>{(r.author_name ?? '—').toUpperCase()} ({r.author_role}) · {fmtAt(r.created_at).toUpperCase()}</Mono>
              <Body style={{ fontSize: 11.5, color: C.ink2, lineHeight: 16 }}>{r.message}</Body>
            </View>
          ))}
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
            <TextInput value={msg} onChangeText={(v) => setMsg(v.slice(0, 1000))} placeholder="Reply…" placeholderTextColor={C.muted3} multiline style={{ flex: 1, minHeight: 42, maxHeight: 90, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 11, paddingVertical: 9, color: '#fff', fontFamily: F.body, fontSize: 12.5 }} />
            <Pressable
              onPress={() => { setErr(null); reply.mutate({ leadId: hold.lead_id, message: msg }, { onSuccess: () => setMsg(''), onError: (e: any) => setErr(e?.message ?? 'Failed') }); }}
              disabled={reply.isPending || !msg.trim()}
              style={{ paddingVertical: 11, paddingHorizontal: 14, borderRadius: 11, backgroundColor: hexA(C.orange, !msg.trim() ? 0.06 : 0.16), borderWidth: 1, borderColor: hexA(C.orange, !msg.trim() ? 0.2 : 0.5) }}
            >
              <Icon name="send" size={14} color={!msg.trim() ? C.muted3 : C.orange} strokeWidth={2.2} />
            </Pressable>
          </View>
          {err ? <Body style={{ fontSize: 10.5, color: C.red }}>{err}</Body> : null}
        </View>
      ) : null}
    </Card>
  );
}

export function OpsQhpHold() {
  const q = useQhpHolds(true);
  const holds = q.data ?? [];
  const overdue = holds.filter((h) => h.is_overdue).sort((a, b) => (a.resolving_at ?? '').localeCompare(b.resolving_at ?? ''));
  const rest = holds.filter((h) => !h.is_overdue).sort((a, b) => (a.resolving_at ?? '').localeCompare(b.resolving_at ?? ''));
  const dueSoon = rest.filter((h) => h.resolving_at && (new Date(h.resolving_at).getTime() - Date.now()) / 60000 <= 720).length;

  return (
    <Page gap={13}>
      <TitleBlock title="QHP Hold" sub="QHPs paused by the QHP Manager and their resolve deadlines" />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {(([['TOTAL ON HOLD', holds.length, C.blue], ['DUE IN 12H', dueSoon, C.gold], ['OVERDUE', overdue.length, C.red]]) as [string, number, string][]).map(([lab, n, col]) => (
          <Card key={lab} colors={['rgba(56,34,21,0.5)', 'rgba(20,16,15,0.5)']} border={hexA(col, 0.22)} radius={14} style={{ flex: 1, padding: 11, alignItems: 'center', gap: 3 }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 18, color: col }}>{n}</Text>
            <Mono style={{ fontSize: 6.5, letterSpacing: 0.6, color: C.muted3 }}>{lab}</Mono>
          </Card>
        ))}
      </View>
      <Err q={q} />
      {q.isLoading ? <Loading /> : holds.length === 0 ? <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 24 }}>No QHPs on hold. 🎉</Body> : (
        <>
          {overdue.length ? <Mono style={{ fontSize: 10, letterSpacing: 1.2, color: C.red }}>OVERDUE · {overdue.length}</Mono> : null}
          {overdue.map((h) => <HoldCard key={h.lead_id} hold={h} />)}
          {rest.length ? <Mono style={{ fontSize: 10, letterSpacing: 1.2, color: C.mono }}>ON HOLD · {rest.length}</Mono> : null}
          {rest.map((h) => <HoldCard key={h.lead_id} hold={h} />)}
        </>
      )}
    </Page>
  );
}
