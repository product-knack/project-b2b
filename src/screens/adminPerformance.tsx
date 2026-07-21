import React from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { C, F, hexA } from '../theme';
import { Icon, IconName } from '../icons';
import { Serif, Body, Mono, Card, Avatar } from '../components/primitives';
import { Page, TitleBlock, Badge, HScroll } from './common';
import { useCrmLeaderboard, useTrainerPerformance, type LeaderboardEntry } from '../lib/adminPerformanceQueries';

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
  const [tab, setTab] = React.useState<'crm' | 'trainer'>('crm');
  const [period, setPeriod] = React.useState<'month' | 'all'>('month');
  const [showAll, setShowAll] = React.useState(false);
  const crmQ = useCrmLeaderboard(period);
  const trQ = useTrainerPerformance();

  const rows = crmQ.data ?? [];
  const totals = rows.reduce((a, r) => ({ ref: a.ref + r.referrals, cs: a.cs + r.crossSells, pu: a.pu + r.packageUpgrades, su: a.su + r.subscriptionUpgrades }), { ref: 0, cs: 0, pu: 0, su: 0 });
  const trainers = trQ.data ?? [];
  const shownTrainers = showAll ? trainers : trainers.slice(0, 10);

  return (
    <Page gap={13}>
      <TitleBlock title="Performance" sub="CRM incentives & trainer session momentum" />
      <View style={{ flexDirection: 'row', gap: 7, alignItems: 'center' }}>
        {(([['crm', 'CRM'], ['trainer', 'Trainers']]) as ['crm' | 'trainer', string][]).map(([id, label]) => {
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
