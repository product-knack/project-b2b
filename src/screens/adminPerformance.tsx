import React from 'react';
import { View, Text, Pressable, ActivityIndicator, TextInput, Alert, Keyboard } from 'react-native';
import { C, F, hexA } from '../theme';
import { Icon, IconName } from '../icons';
import { Serif, Body, Mono, Card, Avatar } from '../components/primitives';
import { Page, TitleBlock, Badge, HScroll, AnimChip } from './common';
import { SheetShell } from './reportDetail';
import { useAuth } from '../auth';
import { useStore } from '../store';
import { useCrmLeaderboard, useTrainerPerformance, type LeaderboardEntry } from '../lib/adminPerformanceQueries';
import {
  useAdminIncentiveRequests, useReviewIncentiveRequest, usePendingIncentiveCount,
  formatIncentiveMonth, formatIncentiveDate, EVENT_META, AdminIncentiveRequest,
} from '../lib/incentiveQueries';

/* Amber pending-requests alert — mounted here AND on the admin dashboard. */
export function AdminIncentiveAlert({ onPress }: { onPress?: () => void }) {
  const q = usePendingIncentiveCount();
  if (!q.data) return null;
  return (
    <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, backgroundColor: hexA(C.gold, 0.09), borderWidth: 1, borderColor: hexA(C.gold, 0.35), padding: 12 }}>
      <View style={{ width: 34, height: 34, borderRadius: 12, backgroundColor: hexA(C.gold, 0.15), alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="crown" size={16} color={C.gold} strokeWidth={2} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: C.gold }}>{q.data} incentive request{q.data === 1 ? '' : 's'} awaiting review</Text>
        <Body style={{ fontSize: 11, color: C.muted2, marginTop: 1 }}>CRM referrals, up-sells and upgrades to approve</Body>
      </View>
      <Icon name="chevRight" size={15} color={C.gold} strokeWidth={2.3} />
    </Pressable>
  );
}

/* ============ ADMIN — Performance (CRM leaderboard + trainer week-over-week) ============ */

const AV_GRADS: [string, string][] = [['#FB8B3A', '#EE5E16'], ['#57C98A', '#2E9A63'], ['#7C8FE8', '#4A5AC8'], ['#9A7BEA', '#6E5BD0'], ['#E0A53C', '#C07C1E'], ['#4FD1C5', '#2C8A86'], ['#F687B3', '#C2568A'], ['#F0883E', '#C05621']];
const avColors = (s: string): [string, string] => AV_GRADS[[...(s || '?')].reduce((a, c) => a + c.charCodeAt(0), 0) % AV_GRADS.length];
const MEDALS = [C.gold, '#B8BCC4', '#C08A52'];

function CountChip({ icon, n, color }: { icon: IconName; n: number; color: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 9, backgroundColor: hexA(color, n > 0 ? 0.14 : 0.05), borderWidth: 1, borderColor: hexA(color, n > 0 ? 0.4 : 0.14) }}>
      <Icon name={icon} size={10} color={n > 0 ? color : C.muted3} strokeWidth={2.2} />
      <Text style={{ fontFamily: F.bodyBold, fontSize: 10, color: n > 0 ? color : C.muted3 }}>{n}</Text>
    </View>
  );
}

export function AdminPerformance() {
  const { adminPerfTab, set: setStore } = useStore();
  const [tab, setTab] = React.useState<'crm' | 'requests' | 'trainer'>(adminPerfTab === 'requests' ? 'requests' : 'crm');
  // The deep-link param is one-shot (dashboard alert -> Requests tab).
  React.useEffect(() => { if (adminPerfTab) setStore({ adminPerfTab: null }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [period, setPeriod] = React.useState<'month' | 'all'>('month');
  const [showAll, setShowAll] = React.useState(false);
  const crmQ = useCrmLeaderboard(period);
  const trQ = useTrainerPerformance();
  const pendingCountQ = usePendingIncentiveCount();

  const rows = crmQ.data ?? [];
  const totals = rows.reduce((a, r) => ({ ref: a.ref + r.referrals, cs: a.cs + r.crossSells, pu: a.pu + r.packageUpgrades, su: a.su + r.subscriptionUpgrades }), { ref: 0, cs: 0, pu: 0, su: 0 });
  const trainers = trQ.data ?? [];
  const shownTrainers = showAll ? trainers : trainers.slice(0, 10);

  return (
    <Page gap={13}>
      <TitleBlock title="Performance" sub="CRM incentives & trainer session momentum" />
      {tab !== 'requests' ? <AdminIncentiveAlert onPress={() => setTab('requests')} /> : null}
      <View style={{ flexDirection: 'row', gap: 7, alignItems: 'center' }}>
        {(([['crm', 'CRM'], ['requests', `Requests${pendingCountQ.data ? ` · ${pendingCountQ.data}` : ''}`], ['trainer', 'Trainers']]) as ['crm' | 'requests' | 'trainer', string][]).map(([id, label]) => {
          const active = tab === id;
          return (
            <Pressable key={id} onPress={() => setTab(id)} style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: active ? hexA(C.orange, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.orange, 0.5) : 'rgba(255,255,255,0.09)' }}>
              <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 11.5, color: active ? C.orange : C.muted }}>{label}</Text>
            </Pressable>
          );
        })}
        <View style={{ flex: 1 }} />
        {tab === 'crm' ? (
          (([['month', 'This Month'], ['all', 'All Time']]) as ['month' | 'all', string][]).map(([id, label]) => {
            const active = period === id;
            return (
              <Pressable key={id} onPress={() => setPeriod(id)} style={{ paddingVertical: 7, paddingHorizontal: 11, borderRadius: 999, backgroundColor: active ? hexA(C.gold, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.gold, 0.5) : 'rgba(255,255,255,0.09)' }}>
                <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 10.5, color: active ? C.gold : C.muted }}>{label}</Text>
              </Pressable>
            );
          })
        ) : null}
      </View>

      {tab === 'crm' ? (
        <>
          {/* Stat tiles */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 9 }}>
            {(([['gift', 'TOTAL REFERRALS', totals.ref, C.orange], ['users', 'TOTAL CROSS-SELLS', totals.cs, C.blue], ['trend', 'PACKAGE UPGRADES', totals.pu, C.green], ['chevUp', 'SUBSCRIPTION UPGRADES', totals.su, C.purple]]) as [IconName, string, number, string][]).map(([icon, label, n, col]) => (
              <Card key={label} colors={['rgba(60,38,24,0.45)', 'rgba(18,14,14,0.5)']} border={hexA(col, 0.22)} radius={15} style={{ width: '47.5%', flexGrow: 1, padding: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 7 }}>
                  <Icon name={icon} size={12} color={col} strokeWidth={2} />
                  <Mono style={{ flexShrink: 1, fontSize: 7.5, letterSpacing: 0.5, color: C.muted3 }}>{label}</Mono>
                </View>
                <Serif style={{ fontSize: 24, color: col }}>{crmQ.isPending ? '—' : n}</Serif>
              </Card>
            ))}
          </View>

          <Mono style={{ fontSize: 9.5, letterSpacing: 1.2, color: C.mono }}>CRM LEADERBOARD</Mono>
          {crmQ.isError ? <Body style={{ fontSize: 11, color: C.red, textAlign: 'center' }}>{(crmQ.error as Error).message}</Body> : null}
          {crmQ.isPending ? <View style={{ paddingVertical: 26, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View>
          : rows.length === 0 ? <Body style={{ fontSize: 11.5, color: C.muted3, textAlign: 'center', paddingVertical: 18 }}>No CRM users found.</Body>
          : rows.map((r: LeaderboardEntry) => {
            const medal = r.rank <= 3 ? MEDALS[r.rank - 1] : null;
            return (
              <Card key={r.userId} colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border={hexA(medal ?? '#94A3B8', medal ? 0.3 : 0.1)} radius={15} style={{ padding: 12, gap: 9, borderLeftWidth: 3, borderLeftColor: medal ?? 'rgba(255,255,255,0.1)' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{ width: 34, alignItems: 'center' }}>
                    {medal ? <Icon name={r.rank === 1 ? 'crown' : 'award'} size={19} color={medal} strokeWidth={2} /> : <Mono style={{ fontSize: 11, color: C.muted3 }}>#{r.rank}</Mono>}
                  </View>
                  <Avatar initial={(r.userName[0] ?? '?').toUpperCase()} size={32} colors={avColors(r.userName)} fontSize={12} />
                  <View style={{ flex: 1 }}>
                    <Body numberOfLines={1} style={{ fontSize: 13, fontFamily: F.bodySemi, color: '#fff' }}>{r.userName}</Body>
                    <View style={{ flexDirection: 'row', marginTop: 3 }}><Badge text="CRM" color={C.purple} /></View>
                  </View>
                  <View style={{ alignItems: 'center' }}>
                    <Serif style={{ fontSize: 21, color: r.totalScore > 0 ? C.gold : C.muted3 }}>{r.totalScore}</Serif>
                    <Mono style={{ fontSize: 7, letterSpacing: 0.5, color: C.muted3 }}>POINTS</Mono>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                  <CountChip icon="gift" n={r.referrals} color={C.orange} />
                  <CountChip icon="users" n={r.crossSells} color={C.blue} />
                  <CountChip icon="trend" n={r.packageUpgrades} color={C.green} />
                  <CountChip icon="chevUp" n={r.subscriptionUpgrades} color={C.purple} />
                </View>
              </Card>
            );
          })}
        </>
      ) : tab === 'requests' ? (
        <IncentiveRequestsPanel />
      ) : (
        <>
          <Body style={{ fontSize: 11, color: C.muted2, marginTop: -4 }}>Session counts comparison — current week vs previous week (completed, attendance marked)</Body>
          {trQ.isError ? <Body style={{ fontSize: 11, color: C.red, textAlign: 'center' }}>{(trQ.error as Error).message}</Body> : null}
          {trQ.isPending ? <View style={{ paddingVertical: 26, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View>
          : shownTrainers.length === 0 ? <Body style={{ fontSize: 11.5, color: C.muted3, textAlign: 'center', paddingVertical: 18 }}>No trainers found.</Body>
          : shownTrainers.map((t, i) => {
            const up = t.diffPct > 0; const flat = t.diffPct === 0;
            const dCol = flat ? C.muted3 : up ? C.green : C.red;
            return (
              <Card key={t.id} colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border={hexA(i < 3 ? MEDALS[i] : '#94A3B8', i < 3 ? 0.3 : 0.1)} radius={14} style={{ padding: 11, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ minWidth: 30, alignItems: 'center', paddingVertical: 3, paddingHorizontal: 6, borderRadius: 8, backgroundColor: hexA(i < 3 ? MEDALS[i] : '#94A3B8', 0.14) }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 10, color: i < 3 ? MEDALS[i] : C.muted2 }}>#{i + 1}</Text>
                </View>
                <Body numberOfLines={1} style={{ flex: 1, fontSize: 12.5, fontFamily: F.bodySemi, color: '#fff' }}>{t.name}</Body>
                <View style={{ alignItems: 'center' }}>
                  <Serif style={{ fontSize: 17 }}>{t.currentWeek}</Serif>
                  <Mono style={{ fontSize: 6.5, letterSpacing: 0.4, color: C.muted3 }}>THIS WEEK</Mono>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, minWidth: 62, justifyContent: 'flex-end' }}>
                  {!flat ? <Icon name={up ? 'trend' : 'chevDown'} size={11} color={dCol} strokeWidth={2.4} /> : null}
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 11.5, color: dCol }}>{up ? '+' : ''}{t.diffPct}%</Text>
                </View>
              </Card>
            );
          })}
          {!trQ.isPending && trainers.length > 10 ? (
            <Pressable onPress={() => setShowAll((v) => !v)} style={{ alignItems: 'center', paddingVertical: 10, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)' }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 11.5, color: C.orange }}>{showAll ? 'Show top 10' : `Show all ${trainers.length} trainers`}</Text>
            </Pressable>
          ) : null}
        </>
      )}
    </Page>
  );
}

/* ---------- Incentive requests review (single-table crm_incentive_request) ----------
   Approval writes ONE incentive_events row and nothing else; rejection stores
   the admin note. Domain tables (renewals/packages/subscriptions) are never
   touched from here - new architecture, web parity. */
function IncentiveRequestsPanel() {
  const { session } = useAuth();
  const adminId = session?.user?.id ?? '';
  const [status, setStatus] = React.useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const listQ = useAdminIncentiveRequests(status);
  const reviewM = useReviewIncentiveRequest();
  const [rejectFor, setRejectFor] = React.useState<AdminIncentiveRequest | null>(null);
  const [note, setNote] = React.useState('');

  const approve = (r: AdminIncentiveRequest) => {
    Alert.alert('Approve this incentive?', `${r.requesterName} gets credited for "${(EVENT_META[r.type] ?? EVENT_META.referral).label}" (${r.clientName}). This writes the incentive ledger only.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Approve', onPress: async () => {
        try { await reviewM.mutateAsync({ request: r, decision: 'approved', adminId }); }
        catch (e: any) { Alert.alert("Couldn't approve", e?.message ?? 'Try again.'); }
      } },
    ]);
  };
  const submitReject = async () => {
    if (!rejectFor) return;
    try {
      await reviewM.mutateAsync({ request: rejectFor, decision: 'rejected', adminId, adminNotes: note });
      Keyboard.dismiss();
      setTimeout(() => { setRejectFor(null); setNote(''); }, 80);
    } catch (e: any) { Alert.alert("Couldn't reject", e?.message ?? 'Try again.'); }
  };
  const raisedAt = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });

  return (
    <View style={{ gap: 9 }}>
      <HScroll gap={7}>
        {(['pending', 'approved', 'rejected', 'all'] as const).map((s) => {
          const active = status === s;
          const col = s === 'approved' ? C.green : s === 'rejected' ? C.red : s === 'pending' ? C.gold : C.blue;
          return (
            <AnimChip key={s} active={active} onPress={() => setStatus(s)} style={{ paddingVertical: 8, paddingHorizontal: 13, borderRadius: 999, backgroundColor: active ? hexA(col, 0.15) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(col, 0.5) : 'rgba(255,255,255,0.09)' }}>
              <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 11.5, color: active ? col : C.muted, textTransform: 'capitalize' }}>{s}</Text>
            </AnimChip>
          );
        })}
      </HScroll>
      {listQ.isLoading ? <ActivityIndicator color={C.orange} style={{ paddingVertical: 20 }} />
      : (listQ.data ?? []).length === 0 ? (
        <Body style={{ fontSize: 12, color: C.muted3, textAlign: 'center', paddingVertical: 20 }}>No {status === 'all' ? '' : status + ' '}requests.</Body>
      ) : (listQ.data ?? []).map((r) => {
        const meta = EVENT_META[r.type] ?? EVENT_META.referral;
        const stColor = r.status === 'approved' ? C.green : r.status === 'rejected' ? C.red : C.gold;
        return (
          <Card key={r.id} colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border={hexA(stColor, 0.2)} radius={14} style={{ padding: 12, gap: 8, borderLeftWidth: 3, borderLeftColor: hexA(meta.color, 0.8) }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
              <Icon name={meta.icon as IconName} size={14} color={meta.color} strokeWidth={2.1} />
              <View style={{ flex: 1 }}>
                <Body numberOfLines={1} style={{ fontSize: 13, fontFamily: F.bodySemi, color: '#fff' }}>{r.requesterName}</Body>
                <Body numberOfLines={1} style={{ fontSize: 11, color: C.muted2, marginTop: 1 }}>{meta.label} · {r.clientName}</Body>
              </View>
              <Badge text={r.status === 'approved' ? 'Approved' : r.status === 'rejected' ? 'Rejected' : 'Pending'} color={stColor} />
            </View>
            <Body style={{ fontSize: 11.5, color: C.ink3 }}>{r.detailsText}</Body>
            <Mono style={{ fontSize: 7.5, color: C.muted3 }}>
              MONTH {formatIncentiveMonth(r.incentiveMonth).toUpperCase()} · EVENT {formatIncentiveDate(r.incentiveDate).toUpperCase()} · RAISED {raisedAt(r.createdAt).toUpperCase()}
            </Mono>
            {r.status === 'rejected' && r.adminNotes ? <Body style={{ fontSize: 11, color: hexA(C.red, 0.9) }}>Note: {r.adminNotes}</Body> : null}
            {r.status === 'pending' ? (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Pressable onPress={() => approve(r)} disabled={reviewM.isPending} style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 11, backgroundColor: hexA(C.green, 0.12), borderWidth: 1, borderColor: hexA(C.green, 0.4), opacity: reviewM.isPending ? 0.6 : 1 }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: C.green }}>Approve</Text>
                </Pressable>
                <Pressable onPress={() => { setRejectFor(r); setNote(''); }} disabled={reviewM.isPending} style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 11, backgroundColor: hexA(C.red, 0.08), borderWidth: 1, borderColor: hexA(C.red, 0.3), opacity: reviewM.isPending ? 0.6 : 1 }}>
                  <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: C.red }}>Reject</Text>
                </Pressable>
              </View>
            ) : null}
          </Card>
        );
      })}

      <SheetShell visible={!!rejectFor} onClose={() => { Keyboard.dismiss(); setTimeout(() => setRejectFor(null), 80); }} accent={C.red} icon="close" title="Reject request" subtitle={(rejectFor ? `${rejectFor.requesterName} - ${rejectFor.clientName}` : '').toUpperCase()}>
        <Body style={{ fontSize: 11.5, color: C.muted2 }}>The CRM sees your note on their Requests tab. The request can not be re-raised automatically.</Body>
        <TextInput value={note} onChangeText={setNote} placeholder="Reason (optional but recommended)" placeholderTextColor={C.muted3} multiline style={{ minHeight: 64, textAlignVertical: 'top', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', backgroundColor: 'rgba(0,0,0,0.25)', color: '#fff', fontFamily: F.body, fontSize: 13 }} />
        <Pressable onPress={submitReject} disabled={reviewM.isPending} style={{ alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: hexA(C.red, 0.14), borderWidth: 1, borderColor: hexA(C.red, 0.45), opacity: reviewM.isPending ? 0.5 : 1 }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: C.red }}>{reviewM.isPending ? 'Rejecting…' : 'Reject Request'}</Text>
        </Pressable>
      </SheetShell>
    </View>
  );
}
