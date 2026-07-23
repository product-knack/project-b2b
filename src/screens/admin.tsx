import React from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator, Animated, Easing, Modal, ScrollView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C, F, hexA } from '../theme';
import { Icon, IconName } from '../icons';
import { Serif, Body, Mono, Card, CountUp, Avatar, ProgressBar } from '../components/primitives';
import { Page, GreetingHeader, Badge } from './common';
import { FeatureTour, ADMIN_TOUR, TourLauncher } from '../components/featureTour';
import { useSidebarProfile } from '../lib/navQueries';
import { useStore } from '../store';
import { RequestsSummaryCard } from './adminRequests';
import {
  useActiveClientsBreakdown, useAdminRevenue, useRevenueBreakdown, useAdminNewLeads, useInvoiceRaisedLeads,
  usePaidCancellationsPending, useAdminUrgentAlerts, inr, type BarPoint, type ActiveClientRow,
} from '../lib/adminQueries';

/* ============ ADMIN workspace — Dashboard tab (web /admin default tab) ============ */

const AV_GRADS: [string, string][] = [['#FB8B3A', '#EE5E16'], ['#57C98A', '#2E9A63'], ['#7C8FE8', '#4A5AC8'], ['#9A7BEA', '#6E5BD0'], ['#E0A53C', '#C07C1E'], ['#4FD1C5', '#2C8A86'], ['#F687B3', '#C2568A'], ['#F0883E', '#C05621']];
const avColors = (seed: string): [string, string] => AV_GRADS[[...(seed || '?')].reduce((a, c) => a + c.charCodeAt(0), 0) % AV_GRADS.length];
const fmtDay = (iso: string | null) => (iso && !Number.isNaN(new Date(iso).getTime()) ? new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' }) : '—');
const daysAgo = (iso: string | null) => (iso && !Number.isNaN(new Date(iso).getTime()) ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)) : null);

function Loading() {
  return <View style={{ paddingVertical: 32, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View>;
}
function Err({ q }: { q: { isError: boolean; error: unknown } }) {
  if (!q.isError) return null;
  return <Body style={{ fontSize: 11.5, color: C.red, textAlign: 'center', paddingVertical: 8 }}>{(q.error as Error)?.message ?? 'Could not load.'}</Body>;
}
function SectionHead({ label }: { label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 10 }}>
      <Mono style={{ fontSize: 10.5, letterSpacing: 1.6, color: C.mono }}>{label}</Mono>
      <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.06)' }} />
    </View>
  );
}

/* Staggered entrance + looping pulse shared by all alert cards. */
function useEnterPulse(delay: number) {
  const pulse = React.useRef(new Animated.Value(0)).current;
  const enter = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    const entry = Animated.timing(enter, { toValue: 1, duration: 420, delay, useNativeDriver: true });
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 850, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 850, useNativeDriver: true }),
    ]));
    entry.start();
    loop.start();
    return () => { entry.stop(); loop.stop(); };
  }, [pulse, enter, delay]);
  return { pulse, enter };
}
const enterStyle = (enter: Animated.Value) => ({
  opacity: enter,
  transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [-10, 0] }) }],
});

/* Entrance-only rise-in (fade + slide up, no looping pulse) for surfaced cards. */
function RiseIn({ delay = 0, children }: { delay?: number; children: React.ReactNode }) {
  const enter = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    const a = Animated.timing(enter, { toValue: 1, duration: 520, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    a.start();
    return () => a.stop();
  }, [enter, delay]);
  return (
    <Animated.View style={{ opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }] }}>
      {children}
    </Animated.View>
  );
}

/* Urgent (red) alert — pulsing left rail + ping ring, entrance slide (web AdminOnboardingUrgentAlerts).
   onPress makes the whole card a deep-link (web: navigate to the workflow page). */
function UrgentAlert({ icon, title, sub, delay = 0, onPress }: { icon: IconName; title: string; sub: string; delay?: number; onPress?: () => void }) {
  const { pulse, enter } = useEnterPulse(delay);
  const railFade = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] });
  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] });
  const ringFade = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] });
  const glow = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.1, 0.45] });
  return (
    <Animated.View style={enterStyle(enter)}>
      <Pressable onPress={onPress} disabled={!onPress} style={{ borderRadius: 15, overflow: 'hidden', borderWidth: 1.5, borderColor: hexA(C.red, 0.45) }}>
        <LinearGradient colors={[hexA(C.red, 0.12), 'rgba(24,12,10,0.85)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: 12 }}>
          <Animated.View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: hexA(C.red, 0.07), opacity: glow }} />
          <Animated.View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, backgroundColor: C.red, opacity: railFade }} />
          <View style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginLeft: 4 }}>
            <Animated.View style={{ position: 'absolute', width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, borderColor: C.red, opacity: ringFade, transform: [{ scale: ringScale }] }} />
            <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: hexA(C.red, 0.15), borderWidth: 1, borderColor: hexA(C.red, 0.45), alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={icon} size={16} color={C.red} strokeWidth={2.1} />
            </View>
          </View>
          <View style={{ flex: 1 }}>
            <Body numberOfLines={2} style={{ fontSize: 12.5, fontFamily: F.bodyBold, color: '#fff' }}>{title}</Body>
            <Body numberOfLines={1} style={{ fontSize: 10.5, color: '#E0A090', marginTop: 1 }}>{sub}</Body>
          </View>
          {onPress ? <Icon name="chevRight" size={14} color={hexA(C.red, 0.9)} strokeWidth={2.4} /> : null}
        </LinearGradient>
      </Pressable>
    </Animated.View>
  );
}

/* Amber / purple info alert — entrance slide + soft glow pulse. onPress deep-links
   to the matching approval queue (web setActiveTab parity). */
function InfoAlert({ icon, color, tint, title, sub, count, delay = 0, onPress }: { icon: IconName; color: string; tint: string; title: string; sub: string; count?: number; delay?: number; onPress?: () => void }) {
  const { pulse, enter } = useEnterPulse(delay);
  const glow = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.06, 0.28] });
  return (
    <Animated.View style={enterStyle(enter)}>
      <Pressable onPress={onPress} disabled={!onPress} style={{ borderRadius: 15, overflow: 'hidden', borderWidth: 1, borderColor: hexA(color, 0.42) }}>
        <LinearGradient colors={[hexA(color, 0.12), 'rgba(255,255,255,0.02)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: 12 }}>
          <Animated.View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: hexA(color, 0.09), opacity: glow }} />
          <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: hexA(color, 0.16), borderWidth: 1, borderColor: hexA(color, 0.45), alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={icon} size={16} color={color} strokeWidth={2.1} />
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
              <Body numberOfLines={1} style={{ flexShrink: 1, fontSize: 12.5, fontFamily: F.bodyBold, color: tint }}>{title}</Body>
              {count != null ? (
                <View style={{ minWidth: 20, alignItems: 'center', paddingHorizontal: 6, paddingVertical: 1.5, borderRadius: 999, backgroundColor: color }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 10, color: '#0c0808' }}>{count}</Text>
                </View>
              ) : null}
            </View>
            <Body numberOfLines={2} style={{ fontSize: 10.5, color: hexA(tint, 0.85), marginTop: 1 }}>{sub}</Body>
          </View>
          {onPress ? <Icon name="chevRight" size={14} color={hexA(color, 0.9)} strokeWidth={2.4} /> : null}
        </LinearGradient>
      </Pressable>
    </Animated.View>
  );
}

/* Weekly bar strip (W1..W5) — pure View bars, value on top, label below. */
function BarStrip({ data, color, format }: { data: BarPoint[]; color: string; format?: (n: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
      {data.map((d) => (
        <View key={d.label} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
          <Mono style={{ fontSize: 8, letterSpacing: 0.3, color: d.value ? C.ink3 : C.faint2 }}>{format ? format(d.value) : d.value}</Mono>
          <View style={{ width: '100%', height: 46, justifyContent: 'flex-end' }}>
            <LinearGradient colors={[hexA(color, 0.85), hexA(color, 0.35)]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }}
              style={{ width: '100%', height: Math.max(3, Math.round((d.value / max) * 46)), borderRadius: 5 }} />
          </View>
          <Mono style={{ fontSize: 8, letterSpacing: 0.6, color: C.muted3 }}>{d.label}</Mono>
        </View>
      ))}
    </View>
  );
}

/* Bottom-sheet shell for the breakdown drill-downs. */
function SheetShell({ title, sub, onClose, children }: { title: string; sub?: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.62)', justifyContent: 'flex-end' }}>
        <View style={{ maxHeight: '90%', backgroundColor: '#0E0A09', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.14)', paddingHorizontal: 18, paddingTop: 14, paddingBottom: 22 }}>
          <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 12 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 12 }}>
            <View style={{ flex: 1 }}>
              <Serif style={{ fontSize: 18 }}>{title}</Serif>
              {sub ? <Body style={{ fontSize: 10.5, color: C.muted2, marginTop: 1 }}>{sub}</Body> : null}
            </View>
            <Pressable onPress={onClose} hitSlop={8} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="close" size={13} color="#B8B2AC" strokeWidth={2.3} />
            </Pressable>
          </View>
          {children}
        </View>
      </View>
    </Modal>
  );
}

/* ---------------- Active clients drill-down (web ActiveClientsDialog) ---------------- */
function ActiveClientsSheet({ data, onClose }: { data: { activeTraining: number; pullback: number; series: BarPoint[]; clients: ActiveClientRow[] }; onClose: () => void }) {
  const [view, setView] = React.useState<'training' | 'pullback'>('training');
  const [search, setSearch] = React.useState('');
  const [pausedOnly, setPausedOnly] = React.useState(false);
  const base = data.clients.filter((c) => (view === 'training' ? c.isTraining : c.isPullback));
  const pausedInView = base.filter((c) => c.isPaused).length;
  const list = base
    .filter((c) => !(view === 'pullback' && pausedOnly) || c.isPaused)
    .filter((c) => {
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return (c.clientName ?? '').toLowerCase().includes(q) || (c.subscription ?? '').toLowerCase().includes(q);
    })
    // Most recently trained first (web parity); paused rows kept, not truncated.
    .sort((a, b) => (b.lastSessionAt ? new Date(b.lastSessionAt).getTime() : 0) - (a.lastSessionAt ? new Date(a.lastSessionAt).getTime() : 0));
  // Show every client — no cap (paused clients used to fall past the old 60-row limit).
  const shown = list;
  return (
    <SheetShell title="Active Client Base" sub="This month · eligible subscription tiers" onClose={onClose}>
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ gap: 12, paddingBottom: 10 }}>
        <View style={{ flexDirection: 'row', gap: 9 }}>
          {(([['training', 'Active-Training Paying Clients', data.activeTraining, C.green, '≥1 completed session in last 30 days'], ['pullback', 'Pullback Clients', data.pullback, C.red, 'No completed session in last 3 days (active or paused, eligible tiers)']]) as ['training' | 'pullback', string, number, string, string][]).map(([id, label, n, col, hint]) => {
            const active = view === id;
            return (
              <Pressable key={id} onPress={() => setView(id)} style={{ flex: 1, borderRadius: 14, padding: 11, backgroundColor: active ? hexA(col, 0.12) : 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: active ? hexA(col, 0.5) : 'rgba(255,255,255,0.08)', gap: 2 }}>
                <Serif style={{ fontSize: 24, color: col }}>{n}</Serif>
                <Body style={{ fontSize: 11, fontFamily: F.bodySemi, color: active ? col : C.muted }}>{label}</Body>
                <Body style={{ fontSize: 9.5, lineHeight: 12, color: C.muted3 }}>{hint}</Body>
              </Pressable>
            );
          })}
        </View>

        <View style={{ gap: 6 }}>
          <Mono style={{ fontSize: 9, letterSpacing: 0.9, color: C.muted3 }}>ACTIVE-TRAINING TREND</Mono>
          <BarStrip data={data.series} color={C.green} />
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)' }}>
          <Icon name="search" size={14} color={C.muted3} strokeWidth={2} />
          <TextInput value={search} onChangeText={setSearch} placeholder="Search client / tier" placeholderTextColor={C.muted3} autoCorrect={false} style={{ flex: 1, fontFamily: F.body, fontSize: 13, color: '#fff', padding: 0 }} />
          {search ? <Pressable onPress={() => setSearch('')} hitSlop={8}><Icon name="close" size={12} color={C.muted3} strokeWidth={2.3} /></Pressable> : null}
        </View>

        {/* count + paused-only toggle */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Mono style={{ flex: 1, fontSize: 8.5, letterSpacing: 0.6, color: C.muted3 }}>
            SHOWING {shown.length}{view === 'pullback' && pausedInView > 0 ? ` · ${pausedInView} PAUSED` : ''}
          </Mono>
          {view === 'pullback' && pausedInView > 0 ? (
            <Pressable onPress={() => setPausedOnly((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999, backgroundColor: hexA(C.purple, pausedOnly ? 0.18 : 0.07), borderWidth: 1, borderColor: hexA(C.purple, pausedOnly ? 0.5 : 0.25) }}>
              <Icon name="clock" size={10} color={C.purple} strokeWidth={2.3} />
              <Text style={{ fontFamily: F.bodySemi, fontSize: 10, color: C.purple }}>Paused only</Text>
            </Pressable>
          ) : null}
        </View>

        {shown.length === 0 ? (
          <Body style={{ fontSize: 12, color: C.muted3, textAlign: 'center', paddingVertical: 18 }}>{search || pausedOnly ? 'No clients match this filter.' : 'No clients in this slice.'}</Body>
        ) : shown.map((c) => {
          const ago = daysAgo(c.lastSessionAt);
          return (
            <View key={c.clientId} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.22)' }}>
              <Avatar initial={(c.clientName?.[0] ?? '?').toUpperCase()} size={32} colors={avColors(c.clientName ?? '?')} fontSize={12} />
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Body numberOfLines={1} style={{ flexShrink: 1, fontSize: 12.5, fontFamily: F.bodySemi, color: '#fff' }}>{c.clientName ?? '—'}</Body>
                  {c.isPaused ? <Badge text="Paused" color={C.purple} /> : null}
                </View>
                <Body numberOfLines={1} style={{ fontSize: 9.5, color: C.muted3, marginTop: 1 }}>
                  {c.subscription ?? '—'}{c.isPaused && c.pauseReason ? ` · ${c.pauseReason}` : ''}
                </Body>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 1 }}>
                <Mono style={{ fontSize: 8.5, letterSpacing: 0.4, color: C.ink3 }}>{fmtDay(c.lastSessionAt).toUpperCase()}</Mono>
                <Mono style={{ fontSize: 7.5, letterSpacing: 0.4, color: ago != null && ago >= 3 ? C.red : C.muted3 }}>{ago == null ? 'NEVER TRAINED' : `${ago}D AGO`}</Mono>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </SheetShell>
  );
}

/* ---------------- Revenue drill-down (web RevenueBreakdownCard streams) ---------------- */
const STREAM_META: Record<string, { icon: IconName; color: string }> = {
  renewal: { icon: 'swap', color: C.gold }, new: { icon: 'userPlus', color: C.blue },
  misc: { icon: 'sparkle', color: C.purple }, 'add-on': { icon: 'layers', color: C.green }, addon: { icon: 'layers', color: C.green },
};
function RevenueSheet({ total, prevTotal, deltaPct, onClose }: { total: number; prevTotal: number; deltaPct: number; onClose: () => void }) {
  const q = useRevenueBreakdown(true);
  const rows = [...(q.data ?? [])].sort((a, b) => b.value - a.value);
  const sum = rows.reduce((s, r) => s + r.value, 0);
  const grand = total || sum; // shares vs the analytics total, falling back to the stream sum (web parity)
  const deltaUp = deltaPct >= 0;
  return (
    <SheetShell title="Revenue Breakdown" sub="This month · by payment stream" onClose={onClose}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingBottom: 10 }}>
        <View style={{ gap: 3 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10 }}>
            <Serif style={{ fontSize: 32, lineHeight: 36, color: C.gold }}>{inr(total)}</Serif>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 3, paddingHorizontal: 8, borderRadius: 999, backgroundColor: hexA(deltaUp ? C.green : C.red, 0.12), marginBottom: 5 }}>
              <Icon name={deltaUp ? 'trend' : 'chevDown'} size={9} color={deltaUp ? C.green : C.red} strokeWidth={2.5} />
              <Text style={{ fontFamily: F.bodyBold, fontSize: 10, color: deltaUp ? C.green : C.red }}>{deltaUp ? '+' : ''}{deltaPct}%</Text>
            </View>
          </View>
          <Body style={{ fontSize: 9.5, color: C.muted3 }}>vs {inr(prevTotal)} last month</Body>
        </View>

        {q.isPending ? <Loading /> : q.isError ? <Err q={q} /> : rows.length === 0 ? (
          <Body style={{ fontSize: 12, color: C.muted3, textAlign: 'center', paddingVertical: 18 }}>No revenue in this range.</Body>
        ) : rows.map((r) => {
          const meta = STREAM_META[r.label.toLowerCase().trim()] ?? { icon: 'layers' as IconName, color: '#94A3B8' };
          const share = grand ? (r.value / grand) * 100 : 0;
          return (
            <View key={r.label} style={{ padding: 12, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: hexA(meta.color, 0.18), gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: hexA(meta.color, 0.14), alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={meta.icon} size={14} color={meta.color} strokeWidth={2} />
                </View>
                <Body style={{ flex: 1, fontSize: 13, fontFamily: F.bodySemi, color: '#fff' }}>{r.label}</Body>
                <View style={{ alignItems: 'flex-end' }}>
                  <Serif style={{ fontSize: 16, color: meta.color }}>₹{r.value.toLocaleString('en-IN')}</Serif>
                  <Mono style={{ fontSize: 8, letterSpacing: 0.5, color: C.muted3 }}>{share.toFixed(1)}% OF TOTAL</Mono>
                </View>
              </View>
              <ProgressBar pct={share} height={5} fill={meta.color} animated />
            </View>
          );
        })}
        <Body style={{ fontSize: 9, color: C.faint, textAlign: 'center' }}>Streams: initial packages, renewals, add-on packages & services, miscellaneous payments.</Body>
      </ScrollView>
    </SheetShell>
  );
}

export function AdminDashboard() {
  const [tourOpen, setTourOpen] = React.useState(false);
  const prof = useSidebarProfile();
  const acQ = useActiveClientsBreakdown();
  const revQ = useAdminRevenue();
  const newLeadsQ = useAdminNewLeads();
  const invoiceQ = useInvoiceRaisedLeads();
  const cancelQ = usePaidCancellationsPending();
  const urgentQ = useAdminUrgentAlerts();
  const [sheet, setSheet] = React.useState<'clients' | 'revenue' | null>(null);
  const { set, go } = useStore();
  // web parity: workflow alerts deep-link to the matching Requests queue tab;
  // onboarding alerts go to the client-management page (no onboarding page natively yet).
  const goRequests = (tabKey: string) => { set({ adminRequestsTab: tabKey }); go('admin-requests'); };

  const istHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }).format(new Date()));
  const greeting = istHour < 12 ? 'Good morning' : istHour < 17 ? 'Good afternoon' : 'Good evening';
  const first = (prof.fullName || 'Admin').split(' ')[0];
  const monthName = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', month: 'long' }).toUpperCase();

  const ac = acQ.data;
  const rev = revQ.data;
  const urgent = urgentQ.data;
  const newLeads = newLeadsQ.data ?? 0;
  const invoice = invoiceQ.data ?? { count: 0, total: 0 };
  const cancels = cancelQ.data ?? 0;
  const deltaUp = (rev?.deltaPct ?? 0) >= 0;

  // isPending (not isLoading): offline-paused queries have isLoading=false with no data —
  // they must show the spinner, never a false "all clear".
  const alertsLoading = urgentQ.isPending || newLeadsQ.isPending || invoiceQ.isPending || cancelQ.isPending;
  const alertsError = urgentQ.isError || newLeadsQ.isError || invoiceQ.isError || cancelQ.isError;
  // Ordered list of visible alerts so entrance animations stagger naturally.
  const alertNodes: React.ReactNode[] = [];
  if (urgent) {
    let i = 0;
    const d = () => i++ * 90;
    if (urgent.noTrainer > 0) alertNodes.push(<UrgentAlert key="noTrainer" delay={d()} icon="userPlus" onPress={() => go('admin-clients')} title={`${urgent.noTrainer} new client${urgent.noTrainer !== 1 ? 's' : ''} do not have a trainer assigned`} sub="Assign trainers to ensure onboarding proceeds smoothly" />);
    if (urgent.noCrm > 0) alertNodes.push(<UrgentAlert key="noCrm" delay={d()} icon="userCircle" onPress={() => go('admin-clients')} title={`${urgent.noCrm} client${urgent.noCrm !== 1 ? 's' : ''} do not have a CRM assigned`} sub="Assign a CRM manager for client communication and follow-ups" />);
    if (urgent.qhpNotScheduled > 3) alertNodes.push(<UrgentAlert key="qhpSched" delay={d()} icon="alert" onPress={() => go('admin-clients')} title={`${urgent.qhpNotScheduled} QHPs need to be scheduled`} sub="More than 3 clients are waiting for QHP scheduling" />);
    if (urgent.assessorDelayed.length > 0) alertNodes.push(<UrgentAlert key="assessor" delay={d()} icon="clock" onPress={() => go('admin-clients')} title={`${urgent.assessorDelayed.length} QHP${urgent.assessorDelayed.length !== 1 ? 's' : ''} assigned 6+ hours ago — not completed`} sub={`Assessor delayed: ${urgent.assessorDelayed.join(', ')}`} />);
    if (newLeads > 0) alertNodes.push(<InfoAlert key="newLeads" delay={d()} icon="userPlus" color={C.gold} tint="#F2C066" count={newLeads} onPress={() => goRequests('newleads')} title={`${newLeads} new client card request${newLeads === 1 ? '' : 's'} from Ops`} sub={`Ops marked ${newLeads === 1 ? 'a lead' : `${newLeads} leads`} as QHP Booked or Raise Invoice — client card pending.`} />);
    if (invoice.count > 0) alertNodes.push(<InfoAlert key="invoice" delay={d()} icon="file" color={C.purple} tint={C.purple} count={invoice.count} onPress={() => goRequests('invoice')} title="New Invoice Raised link" sub={`${invoice.count} lead${invoice.count > 1 ? 's' : ''} waiting for payment generation${invoice.total > 0 ? ` · ₹${invoice.total.toLocaleString('en-IN')}` : ''}`} />);
    if (cancels > 0) alertNodes.push(<InfoAlert key="cancel" delay={d()} icon="rupee" color={C.gold} tint="#F2C066" onPress={() => goRequests('paidcancel')} title={`${cancels} Paid Cancellation Request${cancels === 1 ? '' : 's'} Pending`} sub="Trainers are waiting on admin approval to mark these as paid cancellations." />);
  }

  return (
    <Page gap={16}>
      <GreetingHeader
        date={new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: '2-digit', month: 'short' }).replace(',', ' ·').toUpperCase()}
        name={`${greeting}, ${first}`}
        sub="Admin control center"
        initial={prof.initial}
        avatarUrl={prof.avatarUrl}
        rightAction={<TourLauncher onPress={() => setTourOpen(true)} />}
      />
      <FeatureTour visible={tourOpen} steps={ADMIN_TOUR} tourName='admin' onClose={() => setTourOpen(false)} />

      {/* Revenue — the headline metric, first thing on the page, rises in on entry */}
      <RiseIn delay={0}>
        <View>
          <SectionHead label="REVENUE" />
          <Err q={revQ} />
          {revQ.isPending ? <Loading /> : rev ? (
            <Card onPress={() => setSheet('revenue')} colors={['rgba(64,38,22,0.5)', 'rgba(20,16,15,0.55)']} border={hexA(C.gold, 0.24)} radius={18} style={{ overflow: 'hidden' }}>
              <LinearGradient colors={[hexA(C.gold, 0.5), 'rgba(255,255,255,0.02)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 3 }} />
              <View style={{ padding: 15, gap: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                  <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: C.gold }} />
                  <Mono style={{ flex: 1, fontSize: 9.5, letterSpacing: 1.4, color: '#F2C066' }}>REVENUE · {monthName}</Mono>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 9, borderRadius: 999, backgroundColor: hexA(C.gold, 0.13), borderWidth: 1, borderColor: hexA(C.gold, 0.35) }}>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 9.5, color: C.gold }}>Breakdown</Text>
                    <Icon name="chevRight" size={10} color={C.gold} strokeWidth={2.6} />
                  </View>
                </View>
                <View style={{ gap: 3 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10 }}>
                    <Serif style={{ fontSize: 38, lineHeight: 42, color: C.gold }}>{inr(rev.total)}</Serif>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 9, borderRadius: 999, backgroundColor: hexA(deltaUp ? C.green : C.red, 0.12), marginBottom: 6 }}>
                      <Icon name={deltaUp ? 'trend' : 'chevDown'} size={10} color={deltaUp ? C.green : C.red} strokeWidth={2.5} />
                      <Text style={{ fontFamily: F.bodyBold, fontSize: 10.5, color: deltaUp ? C.green : C.red }}>{deltaUp ? '+' : ''}{rev.deltaPct}%</Text>
                    </View>
                  </View>
                  <Body style={{ fontSize: 10, color: C.muted3 }}>vs {inr(rev.prevTotal)} last month</Body>
                </View>
                <BarStrip data={rev.data} color={C.gold} format={inr} />
              </View>
            </Card>
          ) : null}
        </View>
      </RiseIn>

      {/* Alerts — animated, staggered entrance */}
      <View>
        <SectionHead label="NEEDS ATTENTION" />
        {alertsLoading ? <Loading /> : alertsError ? (
          <View style={{ gap: 4 }}>
            <Err q={urgentQ} />
            <Err q={newLeadsQ} />
            <Err q={invoiceQ} />
            <Err q={cancelQ} />
          </View>
        ) : alertNodes.length === 0 ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 13, borderRadius: 14, backgroundColor: hexA(C.green, 0.07), borderWidth: 1, borderColor: hexA(C.green, 0.28) }}>
            <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: hexA(C.green, 0.14), alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="checks" size={14} color={C.green} strokeWidth={2.2} />
            </View>
            <Body style={{ flex: 1, fontSize: 12, color: hexA(C.green, 0.95) }}>All clear — no onboarding gaps, client-card requests or pending approvals.</Body>
          </View>
        ) : (
          <View style={{ gap: 9 }}>{alertNodes}</View>
        )}
      </View>

      {/* Pending approvals hero — tap anywhere (or a queue chip) to open Requests */}
      <RequestsSummaryCard onOpen={(t) => { set({ adminRequestsTab: t ?? null }); go('admin-requests'); }} />

      {/* Graphs — tap for breakdowns */}
      <View>
        <SectionHead label="THIS MONTH" />
        <View style={{ gap: 12 }}>
          <Err q={acQ} />
          {acQ.isPending ? <Loading /> : ac ? (
            <>
              <Card onPress={() => setSheet('clients')} colors={['rgba(64,38,22,0.5)', 'rgba(20,16,15,0.55)']} border={hexA(C.green, 0.22)} radius={18} style={{ overflow: 'hidden' }}>
                <LinearGradient colors={[hexA(C.green, 0.5), 'rgba(255,255,255,0.02)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 3 }} />
                <View style={{ padding: 15, gap: 12 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                    <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: C.green }} />
                    <Mono style={{ flex: 1, fontSize: 9.5, letterSpacing: 1.4, color: hexA(C.green, 0.9) }}>ACTIVE CLIENTS · {monthName}</Mono>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 9, borderRadius: 999, backgroundColor: hexA(C.green, 0.13), borderWidth: 1, borderColor: hexA(C.green, 0.35) }}>
                      <Text style={{ fontFamily: F.bodyBold, fontSize: 9.5, color: C.green }}>Breakdown</Text>
                      <Icon name="chevRight" size={10} color={C.green} strokeWidth={2.6} />
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10 }}>
                    <CountUp value={ac.activeTraining} style={{ fontSize: 40, lineHeight: 44, color: C.green }} />
                    <Body style={{ flex: 1, fontSize: 10.5, color: C.muted, lineHeight: 14, marginBottom: 5 }}>active-training paying clients{'\n'}≥1 completed session · eligible tiers</Body>
                  </View>
                  {(() => {
                    const pausedN = ac.clients.filter((c) => c.isPaused).length;
                    return pausedN > 0 ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999, backgroundColor: hexA(C.gold, 0.1), borderWidth: 1, borderColor: hexA(C.gold, 0.32) }}>
                        <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: C.gold }} />
                        <Text style={{ fontFamily: F.bodySemi, fontSize: 10.5, color: C.gold }}>{pausedN} client{pausedN === 1 ? '' : 's'} on pause</Text>
                        <Icon name="chevRight" size={10} color={C.gold} strokeWidth={2.4} />
                      </View>
                    ) : null;
                  })()}
                  <BarStrip data={ac.series} color={C.green} />
                </View>
              </Card>
            </>
          ) : null}
        </View>
      </View>

      {sheet === 'clients' && ac ? <ActiveClientsSheet data={ac} onClose={() => setSheet(null)} /> : null}
      {sheet === 'revenue' && rev ? <RevenueSheet total={rev.total} prevTotal={rev.prevTotal} deltaPct={rev.deltaPct} onClose={() => setSheet(null)} /> : null}
    </Page>
  );
}
