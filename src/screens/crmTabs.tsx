import React from 'react';
import { View, Text, Pressable, Animated, Easing, TextInput, Alert, Linking, Modal, ScrollView, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono, Card, ProgressBar } from '../components/primitives';
import { Badge, MiniAvatar, Page, BackLink } from './common';
import { useStore } from '../store';
import { IncentivesPanel } from './crmIncentivesPanel';
import { useSubmitIncident } from '../lib/incentiveQueries';
import { SessionActionSheet } from './crmRoster';
import { RosterSession } from '../lib/rosterQueries';
import { useAuth } from '../auth';
import { useCrmRenewals, useCrmBirthdays, useCrmMetrics, useCrmRetentionBreakdown } from '../lib/crmQueries';
import {
  useCrmInactiveOverview, useCrmMissingLogRows, useCrmLeaves, useCrmTasks,
  useCrmTickets, useCrmOpenTicketsCount, useCrmStaleComms, useCrmPendingComms,
  useCrmQhpCompletions, useCrmIncidentTrainers, useCrmTrainerIncidentHistory, useCrmIncentives, useLeaveAffectedSessions, useCloseTicket,
} from '../lib/crmTabQueries';
import { useRescheduleRequests, useRosterRequests } from '../lib/approvalQueries';
import { useMarkCommDone } from '../lib/crmClientQueries';
import type { CommRow } from '../lib/crmTabQueries';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

/* ============ CRM Workspace — command-center grid + full-screen sections ============
   The 12 web-parity sections are QUEUES, not tabs: the dashboard shows a
   scannable grid of live-count tiles (grouped Needs Action / Clients / Team & Me)
   plus an Action Center digest; tapping a tile opens that section as its own
   full-screen page (route 'crm-section'). All data contracts are unchanged. */

const istD = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' });
const istT = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase();
const initials = (n: string) => n.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
const MAX_ROWS = 15;

function EmptyState({ text }: { text: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 18 }}>
      <Icon name="checks" size={15} color={C.green} strokeWidth={2.2} />
      <Body style={{ fontSize: 12.5, color: C.muted2 }}>{text}</Body>
    </View>
  );
}
function LoadingState() {
  return <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 18 }}>Loading…</Body>;
}
function MoreNote({ total, shown = MAX_ROWS, onMore }: { total: number; shown?: number; onMore?: () => void }) {
  if (total <= shown) return null;
  if (!onMore) return <Body style={{ fontSize: 11, color: C.muted3, textAlign: 'center', paddingTop: 6 }}>+{total - shown} more</Body>;
  return (
    <Pressable onPress={onMore} style={{ alignItems: 'center', paddingVertical: 11, borderRadius: 12, backgroundColor: hexA(C.orange, 0.08), borderWidth: 1, borderColor: hexA(C.orange, 0.3) }}>
      <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: C.orange }}>Load More ({total - shown} left)</Text>
    </Pressable>
  );
}
function RowShell({ color, children, onPress }: { color: string; children: React.ReactNode; onPress?: () => void }) {
  const style = { padding: 12, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: hexA(color, 0.2), borderLeftWidth: 3, borderLeftColor: color, gap: 8 } as const;
  if (onPress) return <Pressable onPress={onPress} style={style}>{children}</Pressable>;
  return <View style={style}>{children}</View>;
}

/* ---------- Section registry ---------- */
type SectionDef = { id: string; label: string; short?: string; icon: any; color: string; sub: string; cluster: 'action' | 'clients' | 'me' };
const SECTIONS: SectionDef[] = [
  { id: 'notifications', label: 'Notifications', icon: 'alert', color: C.red, sub: 'Missing logs · QHP updates · idle clients', cluster: 'action' },
  { id: 'pending-renewals', label: 'Renewals', icon: 'rupee', color: C.red, sub: '3 or fewer sessions left', cluster: 'action' },
  { id: 'pending-comms', label: 'Pending Follow-ups', icon: 'phone', color: C.red, sub: 'Clients waiting on your follow-up call', cluster: 'action' },
  { id: 'stale-comms', label: 'No Comms 7d+', icon: 'phone', color: C.gold, sub: 'No communication logged in 7+ days', cluster: 'action' },
  { id: 'tickets', label: 'Tickets', icon: 'clipboard', color: C.gold, sub: 'Raised by trainers', cluster: 'action' },
  { id: 'birthdays', label: 'Birthdays', icon: 'gift', color: C.gold, sub: 'Today & this week', cluster: 'clients' },
  /* TEAM & ME — my book, my tasks, my wins, my team */
  { id: 'clients-overview', label: 'Client Overview', icon: 'users', color: C.orange, sub: 'Inactive clients — no session in 7+ days', cluster: 'me' },
  { id: 'leave-requests', label: 'Leave Requests', icon: 'calPlus', color: C.gold, sub: 'Trainer leaves — active & upcoming', cluster: 'me' },
  { id: 'pending-tasks', label: 'Pending Tasks', icon: 'list', color: C.blue, sub: 'Yours + admin-assigned to-dos', cluster: 'me' },
  { id: 'incentives', label: 'Incentives', icon: 'gift', color: C.purple, sub: 'Referrals, cross-sells & upgrades', cluster: 'me' },
  { id: 'incidents', label: 'Incidents', icon: 'shield', color: C.red, sub: 'Trainer incident log & history', cluster: 'me' },
];
const sectionOf = (id: string) => SECTIONS.find((s) => s.id === id) ?? SECTIONS[0];

/* All workspace queries in one hook — mounted by the grid (for counts) and by the
   section pages (cache-shared, so opening a section is instant). */
function useWorkspaceData(crmId: string | null) {
  const inactiveQ = useCrmInactiveOverview(crmId);
  const missingQ = useCrmMissingLogRows(crmId);
  const leavesQ = useCrmLeaves();
  const tasksQ = useCrmTasks(crmId);
  const openTicketsQ = useCrmOpenTicketsCount();
  const staleQ = useCrmStaleComms(crmId);
  const pendingCommsQ = useCrmPendingComms(crmId);
  const renewalsQ = useCrmRenewals(crmId);
  const qhpQ = useCrmQhpCompletions(crmId);
  const bdayQ = useCrmBirthdays(crmId);
  const metricsQ = useCrmMetrics(crmId);
  const incentQ = useCrmIncentives(crmId);
  const incTrainersQ = useCrmIncidentTrainers(crmId);
  const reschedQ = useRescheduleRequests(crmId);
  const rosterReqQ = useRosterRequests(crmId);

  const pendingResched = reschedQ.data?.pending ?? [];
  const pendingRoster = (rosterReqQ.data ?? []).filter((r) => r.status === 'pending');
  const inactive = inactiveQ.data ?? [];
  const missing = missingQ.data ?? [];
  const leaves = leavesQ.data ?? [];
  const activeLeaves = leaves.filter((l) => l.status !== 'completed');
  const tasks = tasksQ.data ?? [];
  const stale = staleQ.data ?? [];
  const renewals = (renewalsQ.data ?? []).filter((r) => r.remaining <= 3);
  const idle = inactive.filter((r) => r.days == null || r.days >= 15);
  const bdays = (bdayQ.data?.today.length ?? 0) + (bdayQ.data?.thisWeek.length ?? 0);
  const qhps = qhpQ.data ?? [];
  const pendingComms = pendingCommsQ.data ?? [];
  const notifCount = missing.length + qhps.length + idle.length; // web badge composition

  const counts: Record<string, number | null> = {
    'approvals': pendingResched.length + pendingRoster.length,
    'notifications': notifCount,
    'pending-renewals': renewals.length,
    'pending-comms': pendingComms.length,
    'stale-comms': stale.length,
    'tickets': openTicketsQ.data ?? 0,
    'pending-tasks': tasks.length,
    'clients-overview': inactive.length,
    'birthdays': bdays,
    'leave-requests': activeLeaves.length,
    'incidents': (incTrainersQ.data ?? []).reduce((a, t) => a + (t.myCount ?? 0), 0),
    'performance': null,
    'incentives': (incentQ.data ? (incentQ.data.approvedReferrals ?? 0) + (incentQ.data.crossSells ?? 0) + (incentQ.data.packageUpgrades ?? 0) + (incentQ.data.subscriptionUpgrades ?? 0) : null),
  };
  const loading = inactiveQ.isLoading || missingQ.isLoading || renewalsQ.isLoading;

  return {
    inactiveQ, missingQ, leavesQ, tasksQ, openTicketsQ, staleQ, pendingCommsQ, renewalsQ, qhpQ, bdayQ, metricsQ, incentQ,
    inactive, missing, leaves, activeLeaves, tasks, stale, renewals, idle, bdays, qhps, pendingComms, notifCount, counts, loading,
    pendingResched, pendingRoster,
  };
}

/* Urgent Action Center row — breathing glow + pulsing icon + blinking URGENT tag,
   so pending approvals read as "act on this now". */
function UrgentActionRow({ color, icon, count, text, onPress }: { color: string; icon: any; count: number; text: string; onPress: () => void }) {
  const pulse = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 750, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 750, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, []);
  return (
    <Pressable onPress={onPress} style={{ borderRadius: 13, borderWidth: 1.5, borderColor: hexA(color, 0.45), borderLeftWidth: 4, borderLeftColor: color, overflow: 'hidden' }}>
      {/* breathing glow */}
      <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: hexA(color, 0.07) }} />
      <Animated.View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: hexA(color, 0.14), opacity: pulse }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: 12 }}>
        {/* pulsing icon */}
        <Animated.View style={{ width: 32, height: 32, borderRadius: 11, backgroundColor: hexA(color, 0.18), borderWidth: 1, borderColor: hexA(color, 0.45), alignItems: 'center', justifyContent: 'center', transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.14] }) }] }}>
          <Icon name={icon} size={15} color={color} strokeWidth={2.3} />
        </Animated.View>
        <Body style={{ flex: 1, fontSize: 13, color: '#fff' }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color }}>{count} </Text>{text}
        </Body>
        {/* blinking URGENT tag */}
        <Animated.View style={{ paddingVertical: 3, paddingHorizontal: 8, borderRadius: 7, backgroundColor: hexA(color, 0.22), borderWidth: 1, borderColor: hexA(color, 0.5), opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }) }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 8.5, letterSpacing: 1, color }}>URGENT</Text>
        </Animated.View>
        <Icon name="chevRight" size={14} color={hexA(color, 0.9)} strokeWidth={2.4} />
      </View>
    </Pressable>
  );
}

/* ============ Pending Follow-up card — the web dashboard's "Pending Follow-ups"
   list as a living card: breathing ember/red halo, pulsing phone ring, entrance
   slide, and inline Call / Mark Done / View actions. ============ */
function FollowUpCard({ row, index, busy, onCall, onDone, onView }: {
  row: CommRow; index: number; busy: boolean;
  onCall: () => void; onDone: () => void; onView: () => void;
}) {
  const col = row.overdue ? C.red : C.orange;
  const pulse = React.useRef(new Animated.Value(0)).current;
  const enter = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    Animated.timing(enter, { toValue: 1, duration: 380, delay: Math.min(index, 6) * 70, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    return () => loop.stop();
  }, []);

  const Act = ({ label, icon, color, filled, onPress, disabled }: { label: string; icon: any; color: string; filled?: boolean; onPress: () => void; disabled?: boolean }) => (
    <Pressable onPress={onPress} disabled={disabled} style={{
      flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
      paddingVertical: 9, borderRadius: 11, opacity: disabled ? 0.55 : 1,
      backgroundColor: filled ? hexA(color, 0.16) : 'rgba(255,255,255,0.03)',
      borderWidth: 1, borderColor: filled ? hexA(color, 0.5) : 'rgba(255,255,255,0.1)',
    }}>
      <Icon name={icon} size={13} color={color} strokeWidth={2.4} />
      <Text style={{ fontFamily: F.bodyBold, fontSize: 11.5, color }}>{label}</Text>
    </Pressable>
  );

  return (
    <Animated.View style={{ opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] }}>
      <View style={{ borderRadius: 16, borderWidth: 1.5, borderColor: hexA(col, 0.38), borderLeftWidth: 4, borderLeftColor: col, overflow: 'hidden', backgroundColor: 'rgba(20,14,12,0.72)' }}>
        {/* breathing halo */}
        <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: hexA(col, 0.1), opacity: pulse }} />
        <LinearGradient colors={[hexA(col, 0.5), 'rgba(255,255,255,0.01)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 2.5 }} />
        <View style={{ padding: 13, gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
            {/* pulsing phone ring */}
            <View style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
              <Animated.View style={{ position: 'absolute', width: 40, height: 40, borderRadius: 14, borderWidth: 1.5, borderColor: hexA(col, 0.55), opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0] }), transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.28] }) }] }} />
              <View style={{ width: 34, height: 34, borderRadius: 12, backgroundColor: hexA(col, 0.16), borderWidth: 1, borderColor: hexA(col, 0.4), alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="phone" size={15} color={col} strokeWidth={2.3} />
              </View>
            </View>
            <View style={{ flex: 1 }}>
              <Body numberOfLines={1} style={{ fontSize: 14.5, fontFamily: F.bodySemi, color: '#fff' }}>{row.clientName}</Body>
              <Body numberOfLines={1} style={{ fontSize: 11, color: C.muted2, marginTop: 1.5 }}>
                Last {row.medium ? `${row.medium.toLowerCase()} ` : 'call '}{istD(row.callDate)}
              </Body>
            </View>
            <Badge text={row.overdue ? 'Overdue' : 'Follow-up Required'} color={row.overdue ? C.red : C.blue} />
          </View>
          {row.followUpDate ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 9, backgroundColor: hexA(col, 0.08), borderWidth: 1, borderColor: hexA(col, 0.2), alignSelf: 'flex-start' }}>
              <Icon name="calendar" size={11.5} color={col} strokeWidth={2.2} />
              <Body style={{ fontSize: 11, color: row.overdue ? col : C.ink3 }}>
                {row.overdue ? 'Was due ' : 'Due '}<Text style={{ fontFamily: F.bodySemi, color: col }}>{istD(row.followUpDate)}</Text>
              </Body>
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {row.phone ? <Act label="Call" icon="phone" color={C.green} filled onPress={onCall} /> : null}
            <Act label={busy ? 'Saving…' : 'Mark Done'} icon="checks" color={C.orange} filled onPress={onDone} disabled={busy} />
            <Act label="View" icon="chevRight" color={C.ink3} onPress={onView} />
          </View>
        </View>
      </View>
    </Animated.View>
  );
}

/* ============ Dashboard piece: Action Center + tile grid ============ */
export function CrmWorkspace({ crmId }: { crmId: string | null }) {
  const { set, go } = useStore();
  const d = useWorkspaceData(crmId);
  const qc = useQueryClient();
  // Tiles with a dedicated full page open it; the rest open their section view.
  const open = (id: string) => {
    if (id === 'approvals') { go('crm-approvals'); return; }
    if (id === 'pending-tasks') { go('crm-tasks'); return; }
    if (id === 'birthdays') { go('crm-birthdays'); return; }
    set({ crmSection: id });
    go('crm-section');
  };

  // Realtime on the HOME screen too: a trainer's new reschedule / roster request
  // pops into the Action Center + Approvals tile instantly.
  React.useEffect(() => {
    const ch = supabase
      .channel('crm-home-approvals-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'session_schedule' }, () => qc.invalidateQueries({ queryKey: ['crm-reschedule-requests'] }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'all_requests' }, () => qc.invalidateQueries({ queryKey: ['crm-roster-requests'] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  // Action Center: the most urgent item per red queue — approvals first.
  const urgentRenewals = d.renewals.filter((r) => r.remaining < 2);

  const unexplainedQhp = d.qhps.filter((q) => !q.explainedAt);
  const actions: { key: string; section: string; icon: any; color: string; text: string; count: number; urgent?: boolean }[] = [];
  if (d.pendingResched.length) actions.push({ key: 'rsc', section: 'approvals', icon: 'calendar', color: C.red, text: `reschedule request${d.pendingResched.length === 1 ? '' : 's'} awaiting approval`, count: d.pendingResched.length, urgent: true });
  if (d.pendingRoster.length) actions.push({ key: 'ros', section: 'approvals', icon: 'layers', color: C.purple, text: `roster request${d.pendingRoster.length === 1 ? '' : 's'} awaiting approval`, count: d.pendingRoster.length, urgent: true });
  if (d.pendingComms.length) actions.push({ key: 'fup', section: 'pending-comms', icon: 'phone', color: C.orange, text: `follow-up call${d.pendingComms.length === 1 ? '' : 's'} pending${d.pendingComms.some((r) => r.overdue) ? ' — some overdue' : ''}`, count: d.pendingComms.length, urgent: true });
  if (urgentRenewals.length) actions.push({ key: 'ren', section: 'pending-renewals', icon: 'rupee', color: C.red, text: `client${urgentRenewals.length === 1 ? '' : 's'} need renewal now`, count: urgentRenewals.length });
  if (d.missing.length) actions.push({ key: 'mis', section: 'notifications#missing', icon: 'alert', color: C.red, text: `scheduled session${d.missing.length === 1 ? '' : 's'} not logged`, count: d.missing.length });
  if (d.stale.length) actions.push({ key: 'com', section: 'stale-comms', icon: 'phone', color: C.gold, text: `client${d.stale.length === 1 ? '' : 's'} with no communication in 7+ days`, count: d.stale.length });
  if (unexplainedQhp.length) actions.push({ key: 'qhp', section: 'notifications#qhp', icon: 'heart', color: C.purple, text: `QHP report${unexplainedQhp.length === 1 ? '' : 's'} to explain`, count: unexplainedQhp.length });

  const cluster = (label: string, ids: SectionDef['cluster']) => {
    const items = SECTIONS.filter((s) => s.cluster === ids);
    return (
      <View style={{ gap: 9 }}>
        <Mono style={{ fontSize: 10.5, letterSpacing: 1.8, color: C.mono2 }}>{label}</Mono>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {items.map((s) => {
            const count = d.counts[s.id];
            const hasWork = (count ?? 0) > 0;
            const infoTile = count == null;
            const tint = infoTile || hasWork ? s.color : C.muted2;
            return (
              <Pressable key={s.id} onPress={() => open(s.id)} style={{ width: '47.5%', flexGrow: 1, borderRadius: 16, overflow: 'hidden', backgroundColor: hasWork ? 'rgba(24,17,14,0.6)' : 'rgba(255,255,255,0.025)', borderWidth: 1, borderColor: hasWork ? hexA(s.color, 0.28) : 'rgba(255,255,255,0.07)', opacity: infoTile || hasWork ? 1 : 0.62 }}>
                <LinearGradient colors={[hexA(tint, hasWork ? 0.55 : 0.18), 'rgba(255,255,255,0.01)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 3 }} />
                <View style={{ padding: 12, gap: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: hexA(tint, 0.13), alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name={s.icon} size={15} color={tint} strokeWidth={2} />
                    </View>
                    {infoTile ? (
                      <Icon name="chevRight" size={14} color={C.muted3} strokeWidth={2.2} />
                    ) : hasWork ? (
                      <Text style={{ fontFamily: F.serif, fontSize: 24, color: tint }}>{count}</Text>
                    ) : (
                      <Icon name="checks" size={16} color={C.green} strokeWidth={2.2} />
                    )}
                  </View>
                  <View>
                    <Body numberOfLines={1} style={{ fontSize: 13, fontFamily: F.bodySemi, color: hasWork || infoTile ? '#fff' : C.muted }}>{s.label}</Body>
                    <Body numberOfLines={1} style={{ fontSize: 10, color: C.muted3, marginTop: 1 }}>{hasWork || infoTile ? s.sub : 'All clear'}</Body>
                  </View>
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  };

  return (
    <View style={{ gap: 16 }}>
      {/* ⚡ Action Center */}
      <Card colors={['rgba(46,28,18,0.42)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.1)" radius={18} style={{ padding: 15, gap: 11 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: hexA(C.orange, 0.13), borderWidth: 1, borderColor: hexA(C.orange, 0.3), alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="alert" size={16} color={C.orange} strokeWidth={2} />
          </View>
          <Serif style={{ flex: 1, fontSize: 18 }}>Action Center</Serif>
          {actions.length ? (
            <View style={{ minWidth: 22, height: 22, paddingHorizontal: 7, borderRadius: 11, backgroundColor: hexA(C.red, 0.15), borderWidth: 1, borderColor: hexA(C.red, 0.35), alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontFamily: F.mono, fontSize: 11.5, color: C.red }}>{actions.length}</Text>
            </View>
          ) : null}
        </View>
        {d.loading ? (
          <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 10 }}>Checking your queues…</Body>
        ) : actions.length === 0 ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 10 }}>
            <Icon name="checks" size={16} color={C.green} strokeWidth={2.2} />
            <Body style={{ fontSize: 13, color: C.green }}>All clear — nothing urgent right now.</Body>
          </View>
        ) : (
          actions.slice(0, 5).map((a) => (
            a.urgent ? (
              <UrgentActionRow key={a.key} color={a.color} icon={a.icon} count={a.count} text={a.text} onPress={() => open(a.section)} />
            ) : (
            <Pressable key={a.key} onPress={() => open(a.section)} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: 11, borderRadius: 13, backgroundColor: hexA(a.color, 0.08), borderWidth: 1, borderColor: hexA(a.color, 0.3), borderLeftWidth: 3, borderLeftColor: a.color }}>
              <Icon name={a.icon} size={15} color={a.color} strokeWidth={2.2} />
              <Body style={{ flex: 1, fontSize: 13, color: '#fff' }}>
                <Text style={{ fontFamily: F.bodyBold, color: a.color }}>{a.count} </Text>{a.text}
              </Body>
              <Icon name="chevRight" size={14} color={hexA(a.color, 0.8)} strokeWidth={2.4} />
            </Pressable>
            )
          ))
        )}
      </Card>

      {/* Workspace grid */}
      {cluster('NEEDS ACTION', 'action')}
      {cluster('CLIENTS', 'clients')}
      {cluster('TEAM & ME', 'me')}
    </View>
  );
}

/* ============ Full-screen section page (route 'crm-section') ============ */
export function CrmSectionPage() {
  const { crmSection, back, canGoBack, go, set } = useStore();
  const { session } = useAuth();
  const crmId = session?.user?.id ?? null;
  const qc = useQueryClient();
  const d = useWorkspaceData(crmId);
  // Section id may carry a sub-tab deep-link: "notifications#qhp".
  const [sectionId, subLink] = (crmSection ?? 'notifications').split('#');
  const meta = sectionOf(sectionId);

  const [notifSub, setNotifSub] = React.useState<'missing' | 'qhp' | 'idle'>((subLink as any) || 'missing');
  React.useEffect(() => { if (subLink) setNotifSub(subLink as any); }, [crmSection]);
  const [ticketTab, setTicketTab] = React.useState<'open' | 'closed'>('open');
  const [closingTicket, setClosingTicket] = React.useState<string | null>(null);
  const [closeRemark, setCloseRemark] = React.useState('');
  const closeTicketM = useCloseTicket();
  const [openIncident, setOpenIncident] = React.useState<string | null>(null);
  const [incidentText, setIncidentText] = React.useState('');
  const submitIncidentM = useSubmitIncident();
  const [leaveTab, setLeaveTab] = React.useState<'active' | 'previous'>('active');
  const [openLeave, setOpenLeave] = React.useState<string | null>(null);
  const [leaveSession, setLeaveSession] = React.useState<RosterSession | null>(null);
  const [rowLimit, setRowLimit] = React.useState(MAX_ROWS);
  React.useEffect(() => { setRowLimit(MAX_ROWS); }, [crmSection]);
  // Retention breakdown drill-down (shared sheet — also used by the dashboard tile).
  const [retentionOpen, setRetentionOpen] = React.useState(false);
  const openLeaveRow = (d.leaves ?? []).find((l) => l.id === openLeave) ?? null;
  const affectedQ = useLeaveAffectedSessions(crmId, openLeaveRow);
  const ticketsQ = useCrmTickets(ticketTab);
  const incTrainersQ = useCrmIncidentTrainers(crmId);
  const incHistQ = useCrmTrainerIncidentHistory(openIncident);

  const { inactive, missing, leaves, activeLeaves, tasks, stale, renewals, idle, bdays, qhps, pendingComms, notifCount } = d;
  const markDoneM = useMarkCommDone();
  const [markingDone, setMarkingDone] = React.useState<string | null>(null);
  const markFollowUpDone = (row: CommRow) => {
    setMarkingDone(row.id);
    markDoneM.mutate({ id: row.id, clientId: row.clientId }, {
      onSettled: () => setMarkingDone(null),
      onError: (e: any) => Alert.alert('Could not mark done', e?.message ?? 'Please try again.'),
    });
  };
  const openClient = (row: CommRow) => { set({ selectedClientId: row.clientId, selectedClientName: row.clientName, clientInitialTab: 'comms' }); go('crm-client'); };

  /* --- Notifications sub-renderers --- */
  const renderMissing = () =>
    d.missingQ.isLoading ? <LoadingState /> : missing.length === 0 ? <EmptyState text="Every session scheduled in the last 7 days has been logged." /> : (
      <>
        {missing.slice(0, rowLimit).map((r) => (
          <RowShell key={r.id} color={C.red}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Icon name="alert" size={14} color={C.red} strokeWidth={2.2} />
              <Body style={{ flex: 1, fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }} numberOfLines={1}>Missing — Session Not Logged</Body>
              <Badge text="Missing" color={C.red} />
            </View>
            <Body style={{ fontSize: 11.5, color: C.muted2 }}>Scheduled {r.hoursAgo}h ago — please verify with the trainer.</Body>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              <Body style={{ fontSize: 11.5, color: C.ink3 }}>Client  <Text style={{ color: '#fff', fontFamily: F.bodySemi }}>{r.clientName}</Text></Body>
              <Body style={{ fontSize: 11.5, color: C.ink3 }}>Coach  <Text style={{ color: '#fff', fontFamily: F.bodySemi }}>{r.trainerName}</Text></Body>
            </View>
            <Body style={{ fontSize: 11, color: C.muted3 }}>{istD(r.when)} · {istT(r.when)}{r.modality ? ` · ${r.modality}` : ''}</Body>
          </RowShell>
        ))}
        <MoreNote shown={rowLimit} onMore={() => setRowLimit(rowLimit + 15)} total={missing.length} />
      </>
    );

  const renderQhp = () =>
    d.qhpQ.isLoading ? <LoadingState /> : qhps.length === 0 ? <EmptyState text="No QHP completions in the last 7 days." /> : (
      <>
        {qhps.slice(0, rowLimit).map((q) => (
          <RowShell key={q.id} color={q.explainedAt ? C.green : C.purple}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Body style={{ flex: 1, fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }} numberOfLines={1}>{q.clientName}</Body>
              <Badge text={q.label} color={C.purple} />
            </View>
            <Body style={{ fontSize: 11.5, color: C.muted2 }}>{q.assessorName ? `Assessor ${q.assessorName} · ` : ''}{istD(q.completedAt)} · {istT(q.completedAt)}</Body>
            {q.explainedAt ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Icon path="M20 6 9 17l-5-5" size={12} color={C.green} strokeWidth={2.6} />
                <Body style={{ fontSize: 11, color: C.green }}>Explained {istD(q.explainedAt)}{q.explainedBy ? ` by ${q.explainedBy}` : ''}</Body>
              </View>
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.gold }} />
                <Body style={{ fontSize: 11, color: C.gold }}>Pending — explain the QHP to the client</Body>
              </View>
            )}
          </RowShell>
        ))}
        <MoreNote shown={rowLimit} onMore={() => setRowLimit(rowLimit + 15)} total={qhps.length} />
      </>
    );

  const renderIdle = () =>
    d.inactiveQ.isLoading ? <LoadingState /> : idle.length === 0 ? <EmptyState text="Nobody idle 15+ days." /> : (
      <>
        {idle.slice(0, rowLimit).map((r) => (
          <RowShell key={r.id} color={C.blue}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
              <Icon name="clock" size={15} color={C.blue} strokeWidth={2} />
              <View style={{ flex: 1 }}>
                <Body numberOfLines={1} style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{r.name}</Body>
                <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 1 }}>{r.lastSession ? `Last session ${istD(r.lastSession)}` : 'No session ever logged'}</Body>
              </View>
              <Badge text={r.days == null ? 'Never' : `${r.days}d idle`} color={C.blue} />
            </View>
          </RowShell>
        ))}
        <MoreNote shown={rowLimit} onMore={() => setRowLimit(rowLimit + 15)} total={idle.length} />
      </>
    );

  const body = () => {
    switch (meta.id) {
      case 'clients-overview':
        return d.inactiveQ.isLoading ? <LoadingState /> : inactive.length === 0 ? <EmptyState text="All caught up — every client trained this week." /> : (
          <>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {([['Inactive', inactive.length, C.orange], ['14d+', inactive.filter((r) => (r.days ?? 999) >= 14).length, C.gold], ['30d+', inactive.filter((r) => (r.days ?? 999) >= 30).length, C.red]] as [string, number, string][]).map(([lab, val, col]) => (
                <View key={lab} style={{ flex: 1, paddingVertical: 8, borderRadius: 11, backgroundColor: hexA(col, 0.07), borderWidth: 1, borderColor: hexA(col, 0.22), alignItems: 'center' }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 16, color: col }}>{val}</Text>
                  <Mono style={{ fontSize: 8.5, color: C.muted3, marginTop: 1 }}>{lab.toUpperCase()}</Mono>
                </View>
              ))}
            </View>
            {inactive.slice(0, rowLimit).map((r) => {
              const col = r.days == null ? C.muted2 : r.days >= 30 ? C.red : r.days >= 14 ? C.orange : C.gold;
              return (
                <RowShell key={r.id} color={col}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
                    <MiniAvatar initial={initials(r.name)} colors={[col, hexA(col, 0.6)] as [string, string]} size={36} />
                    <View style={{ flex: 1 }}>
                      <Body numberOfLines={1} style={{ fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }}>{r.name}</Body>
                      <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 1 }}>
                        {r.lastSession ? `Last session ${istD(r.lastSession)}${r.trainerName ? ` · ${r.trainerName}` : ''}` : 'No session ever logged'}
                      </Body>
                    </View>
                    <Badge text={r.days == null ? 'Never' : `${r.days}d ago`} color={col} />
                  </View>
                </RowShell>
              );
            })}
            <MoreNote shown={rowLimit} onMore={() => setRowLimit(rowLimit + 15)} total={inactive.length} />
          </>
        );
      case 'notifications':
        return (
          <>
            <View style={{ flexDirection: 'row', gap: 7 }}>
              {([['missing', 'Missing', missing.length, C.red], ['qhp', 'QHP Updates', qhps.length, C.purple], ['idle', 'Not Doing', idle.length, C.gold]] as ['missing' | 'qhp' | 'idle', string, number, string][]).map(([id, label, n, col]) => {
                const active = notifSub === id;
                return (
                  <Pressable key={id} onPress={() => setNotifSub(id)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 9, borderRadius: 11, backgroundColor: active ? hexA(col, 0.14) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(col, 0.4) : 'rgba(255,255,255,0.07)' }}>
                    <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 11.5, color: active ? col : C.muted }}>{label}</Text>
                    {n > 0 ? <Text style={{ fontFamily: F.mono, fontSize: 10, color: active ? col : C.muted2 }}>{n}</Text> : null}
                  </Pressable>
                );
              })}
            </View>
            {notifSub === 'missing' ? renderMissing() : notifSub === 'qhp' ? renderQhp() : renderIdle()}
          </>
        );
      case 'leave-requests': {
        const shown = leaveTab === 'active' ? activeLeaves : leaves.filter((l) => l.status === 'completed');
        return d.leavesQ.isLoading ? <LoadingState /> : (
          <>
            {/* Tabs: Active & Upcoming / Previous — like the web CRMLeaveRequests */}
            <View style={{ flexDirection: 'row', gap: 6, padding: 4, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.28)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' }}>
              {([['active', `Active & Upcoming · ${activeLeaves.length}`], ['previous', `Previous · ${leaves.filter((l) => l.status === 'completed').length}`]] as const).map(([id, label]) => {
                const active = leaveTab === id;
                return (
                  <Pressable key={id} onPress={() => { setLeaveTab(id); setOpenLeave(null); }} style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 9, overflow: 'hidden', backgroundColor: active ? hexA(C.orange, 0.16) : 'rgba(255,255,255,0.02)', borderWidth: 1, borderColor: active ? hexA(C.orange, 0.5) : 'transparent' }}>
                    <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 11.5, color: active ? C.orange : C.muted }}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>
            {shown.length === 0 ? <EmptyState text={leaveTab === 'active' ? 'No active or upcoming leaves.' : 'No previous leaves.'} /> : shown.slice(0, rowLimit).map((l) => {
              const col = l.status === 'active' ? C.red : l.status === 'upcoming' ? C.gold : C.muted2;
              const isOpen = openLeave === l.id;
              const endsMs = new Date(`${l.endDate}T${l.endTime || '23:59'}:00+05:30`).getTime() - Date.now();
              const endsIn = endsMs > 0 ? (endsMs > 864e5 ? `${Math.floor(endsMs / 864e5)}d ${Math.floor((endsMs % 864e5) / 36e5)}h` : `${Math.floor(endsMs / 36e5)}h ${Math.floor((endsMs % 36e5) / 6e4)}m`) : null;
              return (
                <RowShell key={l.id} color={col}>
                  <Pressable onPress={() => setOpenLeave(isOpen ? null : l.id)} style={{ gap: 6 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Body style={{ flex: 1, fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }} numberOfLines={1}>{l.trainerName}</Body>
                      <Badge text={l.status === 'active' ? '● On Leave' : l.status === 'upcoming' ? 'Upcoming' : 'Completed'} color={col} />
                      {l.status !== 'completed' ? <Icon name={isOpen ? 'chevUp' : 'chevDown'} size={13} color={C.muted2} strokeWidth={2.2} /> : null}
                    </View>
                    <Body style={{ fontSize: 11.5, color: C.muted2 }}>
                      {istD(l.startDate + 'T00:00:00Z')} {l.startTime} → {istD(l.endDate + 'T00:00:00Z')} {l.endTime}
                      {l.status === 'active' && endsIn ? `  ·  back in ${endsIn}` : ''}
                    </Body>
                    {l.reason ? <Body style={{ fontSize: 11.5, color: C.muted3 }} numberOfLines={2}>{l.reason}</Body> : null}
                  </Pressable>
                  {isOpen && l.status !== 'completed' ? (
                    affectedQ.isLoading ? <LoadingState /> : (affectedQ.data ?? []).length === 0 ? (
                      <Body style={{ fontSize: 11.5, color: C.green, paddingTop: 2 }}>✓ None of your clients' sessions fall in this leave.</Body>
                    ) : (
                      <View style={{ gap: 6, marginTop: 2 }}>
                        <Mono style={{ fontSize: 8, letterSpacing: 0.8, color: C.red }}>{(affectedQ.data ?? []).length} AFFECTED SESSION{(affectedQ.data ?? []).length > 1 ? 'S' : ''} — TAP TO RESCHEDULE / CANCEL</Mono>
                        {(affectedQ.data ?? []).map((s) => (
                          <Pressable
                            key={s.id}
                            onPress={() => setLeaveSession({
                              id: s.id, clientId: s.clientId, clientName: s.clientName,
                              trainerId: l.trainerId, trainerName: l.trainerName,
                              when: s.when, modality: s.modality, status: s.status,
                              notes: null, cancelled: s.status === 'cancelled', completed: false, hasRescheduleReq: false,
                            })}
                            style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 9, borderRadius: 10, backgroundColor: hexA(s.status === 'cancelled' ? C.muted2 : C.red, 0.06), borderWidth: 1, borderColor: hexA(s.status === 'cancelled' ? C.muted2 : C.red, 0.25), opacity: s.status === 'cancelled' ? 0.6 : 1 }}
                          >
                            <Icon name="calendar" size={11} color={s.status === 'cancelled' ? C.muted2 : C.red} strokeWidth={2.2} />
                            <Body numberOfLines={1} style={{ flex: 1, fontSize: 11.5, color: C.ink3 }}>{s.clientName} · {s.modality ?? 'Session'}</Body>
                            <Mono style={{ fontSize: 8, color: C.muted3 }}>{istD(s.when).toUpperCase()} {istT(s.when)}</Mono>
                            {s.status === 'cancelled' ? <Badge text="Cancelled" color={C.muted2} /> : <Icon name="chevRight" size={11} color={C.red} strokeWidth={2.4} />}
                          </Pressable>
                        ))}
                      </View>
                    )
                  ) : null}
                </RowShell>
              );
            })}
            <MoreNote shown={rowLimit} onMore={() => setRowLimit(rowLimit + 15)} total={shown.length} />
          </>
        );
      }
      case 'pending-tasks':
        return d.tasksQ.isLoading ? <LoadingState /> : tasks.length === 0 ? <EmptyState text="No pending tasks." /> : (
          <>
            {tasks.slice(0, rowLimit).map((t) => {
              const pcol = t.priority === 'urgent' ? C.red : t.priority === 'high' ? C.orange : t.priority === 'medium' ? C.gold : C.blue;
              return (
                <RowShell key={t.id} color={t.overdue ? C.red : pcol}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                    <Body style={{ flex: 1, fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }} numberOfLines={1}>{t.title}</Body>
                    {t.byAdmin ? <Badge text="Admin" color={C.purple} /> : null}
                    <Badge text={t.priority} color={pcol} />
                    {t.overdue ? <Badge text="Overdue" color={C.red} /> : null}
                  </View>
                  {t.description ? <Body style={{ fontSize: 11.5, color: C.muted2 }} numberOfLines={2}>{t.description}</Body> : null}
                  <Body style={{ fontSize: 10.5, color: C.muted3 }}>
                    {t.dueDate ? `Due ${istD(t.dueDate)} · ` : ''}Created {istD(t.createdAt)}{t.pingCount > 0 ? ` · pinged ${t.pingCount}x` : ''}
                  </Body>
                </RowShell>
              );
            })}
            <MoreNote shown={rowLimit} onMore={() => setRowLimit(rowLimit + 15)} total={tasks.length} />
          </>
        );
      case 'tickets':
        return (
          <>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {(['open', 'closed'] as const).map((s) => {
                const active = ticketTab === s;
                return (
                  <Pressable key={s} onPress={() => setTicketTab(s)} style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 11, backgroundColor: active ? hexA(C.red, 0.13) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.red, 0.35) : 'rgba(255,255,255,0.07)' }}>
                    <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 12.5, color: active ? C.red : C.muted }}>{s === 'open' ? 'Open' : 'Closed'}</Text>
                  </Pressable>
                );
              })}
            </View>
            {ticketsQ.isLoading ? <LoadingState /> : (ticketsQ.data ?? []).length === 0 ? <EmptyState text={`No ${ticketTab} tickets.`} /> : (
              <>
                {(ticketsQ.data ?? []).slice(0, rowLimit).map((t) => (
                  <RowShell key={t.id} color={ticketTab === 'open' ? C.red : C.green}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Body style={{ flex: 1, fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }} numberOfLines={1}>{t.clientName}</Body>
                      <Badge text={t.category} color={ticketTab === 'open' ? C.orange : C.green} />
                    </View>
                    {t.description ? <Body style={{ fontSize: 11.5, color: C.ink3 }} numberOfLines={2}>{t.description}</Body> : null}
                    <Body style={{ fontSize: 10.5, color: C.muted3 }}>Raised by {t.raisedBy} · {istD(t.createdAt)}{t.closedAt ? ` · Closed ${istD(t.closedAt)}` : ''}</Body>
                    {t.closeRemark ? <Body style={{ fontSize: 11, color: C.muted2, fontStyle: 'italic' }} numberOfLines={2}>“{t.closeRemark}”</Body> : null}
                    {ticketTab === 'open' ? (
                      closingTicket === t.id ? (
                        <View style={{ gap: 7 }}>
                          <TextInput
                            value={closeRemark}
                            onChangeText={setCloseRemark}
                            placeholder="Resolution remark — what was done?"
                            placeholderTextColor={C.muted3}
                            multiline
                            autoFocus
                            style={{ minHeight: 50, textAlignVertical: 'top', paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', backgroundColor: 'rgba(0,0,0,0.25)', color: '#fff', fontFamily: F.body, fontSize: 12.5 }}
                          />
                          <View style={{ flexDirection: 'row', gap: 7 }}>
                            <Pressable onPress={() => { setClosingTicket(null); setCloseRemark(''); }} style={{ flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.05)' }}>
                              <Text style={{ fontFamily: F.bodySemi, fontSize: 11.5, color: C.muted }}>Cancel</Text>
                            </Pressable>
                            <Pressable
                              onPress={() => {
                                if (!crmId) return;
                                closeTicketM.mutate({ ticketId: t.id, closeRemark, closedBy: crmId }, {
                                  onSuccess: () => { setClosingTicket(null); setCloseRemark(''); },
                                  onError: (e: any) => Alert.alert("Couldn't close", e?.message ?? 'Try again.'),
                                });
                              }}
                              disabled={closeTicketM.isPending}
                              style={{ flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 10, backgroundColor: hexA(C.green, 0.14), borderWidth: 1, borderColor: hexA(C.green, 0.45), opacity: closeTicketM.isPending ? 0.5 : 1 }}
                            >
                              <Text style={{ fontFamily: F.bodyBold, fontSize: 11.5, color: C.green }}>{closeTicketM.isPending ? 'Closing…' : 'Confirm Close'}</Text>
                            </Pressable>
                          </View>
                        </View>
                      ) : (
                        <Pressable onPress={() => { setClosingTicket(t.id); setCloseRemark(''); }} style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, backgroundColor: hexA(C.green, 0.12), borderWidth: 1, borderColor: hexA(C.green, 0.4) }}>
                          <Icon name="checks" size={11} color={C.green} strokeWidth={2.5} />
                          <Text style={{ fontFamily: F.bodyBold, fontSize: 10.5, color: C.green }}>Close Ticket</Text>
                        </Pressable>
                      )
                    ) : null}
                  </RowShell>
                ))}
                <MoreNote shown={rowLimit} onMore={() => setRowLimit(rowLimit + 15)} total={(ticketsQ.data ?? []).length} />
              </>
            )}
          </>
        );
      case 'pending-comms': {
        const overdueCount = pendingComms.filter((r) => r.overdue).length;
        return d.pendingCommsQ.isLoading ? <LoadingState /> : pendingComms.length === 0 ? <EmptyState text="No pending follow-ups — every call is closed out." /> : (
          <>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {([['Pending', pendingComms.length, C.orange], ['Overdue', overdueCount, C.red], ['On Track', pendingComms.length - overdueCount, C.green]] as [string, number, string][]).map(([lab, val, col]) => (
                <View key={lab} style={{ flex: 1, paddingVertical: 8, borderRadius: 11, backgroundColor: hexA(col, 0.07), borderWidth: 1, borderColor: hexA(col, 0.22), alignItems: 'center' }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 16, color: col }}>{val}</Text>
                  <Mono style={{ fontSize: 8.5, color: C.muted3, marginTop: 1 }}>{lab.toUpperCase()}</Mono>
                </View>
              ))}
            </View>
            {pendingComms.slice(0, rowLimit).map((r, i) => (
              <FollowUpCard
                key={r.id} row={r} index={i}
                busy={markingDone === r.id}
                onCall={() => { if (r.phone) Linking.openURL(`tel:${r.phone.replace(/[^\d+]/g, '')}`); }}
                onDone={() => markFollowUpDone(r)}
                onView={() => openClient(r)}
              />
            ))}
            <MoreNote shown={rowLimit} onMore={() => setRowLimit(rowLimit + 15)} total={pendingComms.length} />
          </>
        );
      }
      case 'stale-comms':
        return d.staleQ.isLoading ? <LoadingState /> : stale.length === 0 ? <EmptyState text="Every client has a communication logged in the last 7 days." /> : (
          <>
            {stale.slice(0, 30).map((r) => (
              <RowShell key={r.id} color={r.days == null ? C.red : C.gold} onPress={() => { set({ selectedClientId: r.id, selectedClientName: r.name, clientInitialTab: 'comms' }); go('crm-client'); }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
                  <MiniAvatar initial={initials(r.name)} colors={r.days == null ? ['#E76A52', '#B03A2E'] : ['#E0A53C', '#B57F1E']} size={36} />
                  <View style={{ flex: 1 }}>
                    <Body numberOfLines={1} style={{ fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }}>{r.name}</Body>
                    <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 1 }}>
                      {r.lastComm ? `Last comm ${istD(r.lastComm)}` : 'No communication ever logged'}
                    </Body>
                  </View>
                  <Badge text={r.days == null ? 'Never logged' : `${r.days}d ago`} color={r.days == null ? C.red : C.gold} />
                  <Icon name="chevRight" size={13} color={C.muted3} strokeWidth={2.2} />
                </View>
              </RowShell>
            ))}
            {stale.length > 30 ? <Body style={{ fontSize: 11, color: C.muted3, textAlign: 'center', paddingTop: 6 }}>+{stale.length - 30} more</Body> : null}
          </>
        );
      case 'performance':
        return d.metricsQ.isLoading || d.renewalsQ.isLoading ? <LoadingState /> : (
          <>
            <Pressable onPress={() => setRetentionOpen(true)} style={{ padding: 14, borderRadius: 14, backgroundColor: hexA(C.green, 0.06), borderWidth: 1, borderColor: hexA(C.green, 0.2), gap: 9 }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Body style={{ fontSize: 12.5, color: C.ink3 }}>Retention Rate (Last 30 Days)</Body>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, paddingVertical: 2.5, paddingHorizontal: 7, borderRadius: 999, backgroundColor: hexA(C.green, 0.13), borderWidth: 1, borderColor: hexA(C.green, 0.32) }}>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 8.5, color: C.green }}>Breakdown</Text>
                    <Icon name="chevRight" size={9} color={C.green} strokeWidth={2.6} />
                  </View>
                </View>
                <Serif style={{ fontSize: 28, color: C.green }}>{d.metricsQ.data?.retentionPct ?? 0}%</Serif>
              </View>
              <ProgressBar pct={d.metricsQ.data?.retentionPct ?? 0} height={6} fill={C.green} />
              <Body style={{ fontSize: 11, color: C.muted2 }}>{Math.round(((d.metricsQ.data?.retentionPct ?? 0) / 100) * (d.metricsQ.data?.totalClients ?? 0))} of {d.metricsQ.data?.totalClients ?? 0} clients active · tap to see who</Body>
            </Pressable>
            <Mono style={{ fontSize: 10, letterSpacing: 1.2, color: C.mono2, marginTop: 4 }}>UPCOMING RENEWALS</Mono>
            {renewals.length === 0 ? <EmptyState text="No renewals due." /> : renewals.slice(0, 8).map((r) => {
              const col = r.remaining < 2 ? C.red : C.gold;
              return (
                <View key={r.clientId} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' }}>
                  <Body style={{ flex: 1, fontSize: 13, fontFamily: F.bodySemi, color: '#fff' }} numberOfLines={1}>{r.name}</Body>
                  <Mono style={{ fontSize: 10, color: C.muted3 }}>{r.completed}/{r.packageSize}</Mono>
                  <Badge text={r.remaining <= 0 ? 'Exhausted' : `${r.remaining} left`} color={col} />
                </View>
              );
            })}
          </>
        );
      case 'pending-renewals':
        return d.renewalsQ.isLoading ? <LoadingState /> : renewals.length === 0 ? <EmptyState text="No renewals due — all packages healthy." /> : (
          <>
            {renewals.slice(0, rowLimit).map((r) => {
              const col = r.remaining < 2 ? C.red : C.gold;
              return (
                <RowShell key={r.clientId} color={col}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
                    <MiniAvatar initial={initials(r.name)} colors={['#F0883E', '#C05621']} size={36} />
                    <View style={{ flex: 1 }}>
                      <Body numberOfLines={1} style={{ fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }}>{r.name}</Body>
                      <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 1 }}>{r.completed} of {r.packageSize} sessions used</Body>
                    </View>
                    <Badge text={r.remaining <= 0 ? 'Exhausted' : `${r.remaining} left`} color={col} />
                  </View>
                  <ProgressBar pct={r.pct} height={5} fill={col} />
                </RowShell>
              );
            })}
            <MoreNote shown={rowLimit} onMore={() => setRowLimit(rowLimit + 15)} total={renewals.length} />
          </>
        );
      case 'incentives':
        return d.incentQ.isLoading ? <LoadingState /> : (
          <IncentivesPanel crmId={crmId} overview={d.incentQ.data ?? null} />
        );
      case 'birthdays':
        return d.bdayQ.isLoading ? <LoadingState /> : bdays === 0 ? <EmptyState text="No birthdays this week." /> : (
          <>
            {(d.bdayQ.data?.today ?? []).map((b) => (
              <RowShell key={b.id} color={C.gold}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Icon name="gift" size={14} color={C.gold} strokeWidth={2.2} />
                  <Body style={{ flex: 1, fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{b.name}</Body>
                  <Badge text="Today 🎂" color={C.gold} />
                </View>
              </RowShell>
            ))}
            {(d.bdayQ.data?.thisWeek ?? []).map((b) => (
              <View key={b.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 8, paddingVertical: 8 }}>
                <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: C.muted2 }} />
                <Body style={{ flex: 1, fontSize: 13, color: C.ink3 }}>{b.name}</Body>
                <Mono style={{ fontSize: 10, color: C.muted3 }}>{b.day}</Mono>
              </View>
            ))}
          </>
        );
      default: // incidents
        return incTrainersQ.isLoading ? <LoadingState /> : (
          <>
            {(incTrainersQ.data ?? [])
              .sort((a, b) => b.myCount - a.myCount)
              .slice(0, 30)
              .map((t) => {
                const open = openIncident === t.id;
                return (
                  <View key={t.id}>
                    <Pressable onPress={() => setOpenIncident(open ? null : t.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' }}>
                      <MiniAvatar initial={initials(t.name)} colors={['#F0883E', '#C05621']} size={32} />
                      <Body style={{ flex: 1, fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }} numberOfLines={1}>{t.name}</Body>
                      {t.myCount > 0 ? <Badge text={`${t.myCount} logged`} color={C.orange} /> : null}
                      <Icon name={open ? 'chevUp' : 'chevDown'} size={14} color={C.muted} strokeWidth={2.2} />
                    </Pressable>
                    {open ? (
                      <View style={{ paddingVertical: 8, paddingLeft: 10, gap: 8 }}>
                        {/* Report a new incident for this trainer (web TrainerIncidentDialog) */}
                        <View style={{ padding: 10, borderRadius: 12, backgroundColor: hexA(C.red, 0.05), borderWidth: 1, borderColor: hexA(C.red, 0.25), gap: 8 }}>
                          <Mono style={{ fontSize: 8.5, letterSpacing: 0.8, color: C.red }}>REPORT AN INCIDENT</Mono>
                          <TextInput
                            value={incidentText}
                            onChangeText={setIncidentText}
                            placeholder="What happened? Be specific — date, client, behaviour…"
                            placeholderTextColor={C.muted3}
                            multiline
                            maxLength={2000}
                            style={{ minHeight: 56, textAlignVertical: 'top', paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', backgroundColor: 'rgba(0,0,0,0.25)', color: '#fff', fontFamily: F.body, fontSize: 12.5 }}
                          />
                          <Pressable
                            onPress={() => {
                              if (!crmId || !incidentText.trim()) return;
                              submitIncidentM.mutate({ crmId, trainerId: t.id, message: incidentText }, {
                                onSuccess: () => setIncidentText(''),
                                onError: (e: any) => Alert.alert("Couldn't report", e?.message ?? 'Try again.'),
                              });
                            }}
                            disabled={!incidentText.trim() || submitIncidentM.isPending}
                            style={{ alignSelf: 'flex-end', paddingVertical: 8, paddingHorizontal: 16, borderRadius: 999, backgroundColor: hexA(C.red, 0.15), borderWidth: 1, borderColor: hexA(C.red, 0.45), opacity: incidentText.trim() && !submitIncidentM.isPending ? 1 : 0.5 }}
                          >
                            <Text style={{ fontFamily: F.bodyBold, fontSize: 11.5, color: C.red }}>{submitIncidentM.isPending ? 'Reporting…' : 'Submit Incident'}</Text>
                          </Pressable>
                        </View>
                        {incHistQ.isLoading ? <LoadingState /> : (incHistQ.data ?? []).length === 0 ? (
                          <Body style={{ fontSize: 11.5, color: C.muted3, paddingVertical: 4 }}>No incidents logged for this trainer.</Body>
                        ) : (
                          (incHistQ.data ?? []).map((h) => (
                            <RowShell key={h.id} color={C.orange}>
                              <Body style={{ fontSize: 12.5, color: C.ink3 }}>{h.message}</Body>
                              <Body style={{ fontSize: 10.5, color: C.muted3 }}>{h.authorName} ({h.authorRole}) · {istD(h.createdAt)}</Body>
                            </RowShell>
                          ))
                        )}
                      </View>
                    ) : null}
                  </View>
                );
              })}
          </>
        );
    }
  };

  const count = d.counts[meta.id];
  return (
    <Page gap={13} pt={6}>
      <BackLink label="Workspace" onPress={() => (canGoBack ? back() : go('crm-dashboard'))} />
      {/* Section header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: hexA(meta.color, 0.13), borderWidth: 1, borderColor: hexA(meta.color, 0.3), alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={meta.icon} size={20} color={meta.color} strokeWidth={2} />
        </View>
        <View style={{ flex: 1 }}>
          <Serif style={{ fontSize: 23 }}>{meta.label}</Serif>
          <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 1 }}>{meta.sub}</Body>
        </View>
        {count != null && count > 0 ? (
          <View style={{ minWidth: 28, height: 28, paddingHorizontal: 9, borderRadius: 14, backgroundColor: hexA(meta.color, 0.14), borderWidth: 1, borderColor: hexA(meta.color, 0.32), alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontFamily: F.mono, fontSize: 13, color: meta.color }}>{count}</Text>
          </View>
        ) : null}
      </View>
      <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.09)" radius={18} style={{ padding: 15, gap: 10 }}>
        {body()}
      </Card>
      {/* Reschedule/Cancel for a leave-affected session — the roster action sheet. */}
      <SessionActionSheet
        session={leaveSession}
        crmId={crmId}
        onClose={() => { setLeaveSession(null); qc.invalidateQueries({ queryKey: ['crm-leave-affected'] }); }}
      />

      {/* Retention Rate breakdown (last 30 days) */}
      <RetentionBreakdownSheet crmId={crmId} open={retentionOpen} onClose={() => setRetentionOpen(false)} />
    </Page>
  );
}

/* ============ Retention breakdown sheet — shared by the dashboard tile and the
   Performance section card. Lazy: the query only runs while open. ============ */
export function RetentionBreakdownSheet({ crmId, open, onClose }: { crmId: string | null; open: boolean; onClose: () => void }) {
  const { set, go } = useStore();
  const [retFilter, setRetFilter] = React.useState<'all' | 'retained' | 'lapsed'>('all');
  React.useEffect(() => { if (open) setRetFilter('all'); }, [open]);
  const retentionQ = useCrmRetentionBreakdown(crmId, open);
  const b = retentionQ.data;
  const rows = (b?.rows ?? []).filter((r) => retFilter === 'all' ? true : retFilter === 'retained' ? r.retained : !r.retained);
  const fmtD = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' }) : '—');
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' }}>
        <Pressable onPress={() => {}} style={{ maxHeight: '82%', backgroundColor: '#171210', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.15)', paddingHorizontal: 18, paddingTop: 16, paddingBottom: 26 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 12 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: C.green }} />
            <View style={{ flex: 1 }}>
              <Serif style={{ fontSize: 19, color: '#fff' }}>Retention · Last 30 Days</Serif>
              <Body style={{ fontSize: 10.5, color: C.muted3, marginTop: 1 }}>Completed ≥1 session in the last 30 days ÷ actively-training clients</Body>
            </View>
            <Pressable onPress={onClose} hitSlop={10} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="close" size={15} color={C.muted2} />
            </Pressable>
          </View>

          {retentionQ.isPending ? (
            <View style={{ paddingVertical: 40, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View>
          ) : retentionQ.isError ? (
            <Body style={{ fontSize: 12, color: C.red, textAlign: 'center', paddingVertical: 24 }}>{(retentionQ.error as Error).message}</Body>
          ) : (
            <>
              {/* headline formula */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 13, borderRadius: 14, backgroundColor: hexA(C.green, 0.07), borderWidth: 1, borderColor: hexA(C.green, 0.25), marginBottom: 12 }}>
                <Serif style={{ fontSize: 34, color: C.green }}>{b?.pct ?? 0}%</Serif>
                <View style={{ flex: 1 }}>
                  <Body style={{ fontSize: 12.5, color: '#fff', fontFamily: F.bodySemi }}>{b?.retained ?? 0} of {b?.total ?? 0} clients active</Body>
                  <Body style={{ fontSize: 10.5, color: C.muted2, marginTop: 1 }}>{(b?.total ?? 0) - (b?.retained ?? 0)} lapsed — no completed session in 30 days</Body>
                </View>
              </View>

              {/* filter chips */}
              <View style={{ flexDirection: 'row', gap: 7, marginBottom: 10 }}>
                {(([['all', `All ${b?.total ?? 0}`, C.muted], ['retained', `Retained ${b?.retained ?? 0}`, C.green], ['lapsed', `Lapsed ${(b?.total ?? 0) - (b?.retained ?? 0)}`, C.red]]) as ['all' | 'retained' | 'lapsed', string, string][]).map(([id, label, col]) => {
                  const active = retFilter === id;
                  return (
                    <Pressable key={id} onPress={() => setRetFilter(id)} style={{ flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 11, backgroundColor: hexA(col, active ? 0.18 : 0.06), borderWidth: 1, borderColor: hexA(col, active ? 0.5 : 0.2) }}>
                      <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 10.5, color: active ? (col === C.muted ? '#fff' : col) : C.muted }}>{label}</Text>
                    </Pressable>
                  );
                })}
              </View>

              {rows.length === 0 ? (
                <Body style={{ fontSize: 12, color: C.muted3, textAlign: 'center', paddingVertical: 22 }}>No clients in this view.</Body>
              ) : (
                <ScrollView showsVerticalScrollIndicator={false} style={{ flexShrink: 1 }} nestedScrollEnabled>
                  {rows.map((r) => (
                    <Pressable key={r.clientId} onPress={() => { set({ selectedClientId: r.clientId, selectedClientName: r.name }); onClose(); go('crm-client'); }}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' }}>
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: r.retained ? C.green : C.red }} />
                      <View style={{ flex: 1 }}>
                        <Body numberOfLines={1} style={{ fontSize: 13, fontFamily: F.bodySemi, color: '#fff' }}>{r.name}</Body>
                        <Body numberOfLines={1} style={{ fontSize: 10, color: C.muted3, marginTop: 1 }}>{r.subscription ?? 'No subscription'}</Body>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={{ fontFamily: F.bodySemi, fontSize: 10, color: r.retained ? C.green : C.red }}>{r.retained ? 'Active' : 'Lapsed'}</Text>
                        <Mono style={{ fontSize: 8.5, color: C.muted3, marginTop: 1 }}>{r.retained ? `LAST ${fmtD(r.lastCompletedAt)}` : 'NO SESSION 30D'}</Mono>
                      </View>
                    </Pressable>
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
