import React from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator, Modal, ScrollView, Linking } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Polyline, Line as SvgLine, Text as SvgText, Circle } from 'react-native-svg';
import { C, F, hexA, ORANGE_GRAD } from '../theme';
import { Icon, IconName } from '../icons';
import { useAuth } from '../auth';
import { useStore } from '../store';
import { Serif, Body, Mono, Card, Avatar } from '../components/primitives';
import { Page, TitleBlock, Badge, GreetingHeader } from './common';
import { useSidebarProfile } from '../lib/navQueries';
import {
  useInfluencers, useInfluencer, useInfluencerCampaignLogs, useCampaignLogMutations,
  useInfluencerOpenTickets, currentIstMonth, InfluencerClient, MonthBucket, MARKETING_ADMIN_ID, Ticket,
  useMarketingBloodReports, markerStatusOf, useLeadsAnalytics,
} from '../lib/marketingQueries';
import { useLeadsList, useLeadStats } from '../lib/opsLeadQueries';
import { useClientReports } from '../lib/clientQueries';
import { useSessionsByCycle } from '../lib/adminClientDetailQueries';
import { QhpReportSheet } from './reportDetail';
import { OpsLeads } from './opsLeads';

/* ============ MARKETING WORKSPACE — influencer performance ============
   Port of the web /marketing pages: dashboard KPIs + monthly chart + insights,
   influencer list, detail (Content / Performance / Instagram / Tickets /
   Sessions / Reports), read-only Leads (full ops experience for the marketing
   admin), and lead analytics. Data: useInfluencers aggregator over clients
   (subscription_type='Influencer') + influencer_campaign_logs. */

const AV_GRADS: [string, string][] = [['#FB8B3A', '#EE5E16'], ['#57C98A', '#2E9A63'], ['#7C8FE8', '#4A5AC8'], ['#9A7BEA', '#6E5BD0'], ['#E0A53C', '#C07C1E'], ['#4FD1C5', '#2C8A86'], ['#F687B3', '#C2568A']];
const avColors = (seed: string): [string, string] => AV_GRADS[[...(seed || '?')].reduce((a, c) => a + c.charCodeAt(0), 0) % AV_GRADS.length];
const initials = (n: string) => n.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?';
const scoreColor = (s: number) => (s >= 8 ? C.green : s >= 6 ? C.gold : C.red);
const statusColor = (s: string) => (s === 'exceeded' ? C.green : s === 'on-track' ? C.blue : s === 'behind' ? C.gold : C.red);
const monthLabel = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
};
const shiftMonth = (ym: string, d: number) => {
  const [y, m] = ym.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + d, 15));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
};

function KpiCard({ label, value, sub, color, icon }: { label: string; value: string; sub?: string | null; color: string; icon: any }) {
  return (
    <Card colors={['rgba(46,28,18,0.42)', 'rgba(18,14,14,0.5)']} radius={16} style={{ flex: 1, overflow: 'hidden' }}>
      <LinearGradient colors={[hexA(color, 0.5), 'rgba(255,255,255,0.02)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 3 }} />
      <View style={{ padding: 12, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon name={icon} size={13} color={color} strokeWidth={2} />
          <Mono style={{ flex: 1, fontSize: 7.5, letterSpacing: 0.6, color: C.muted3 }}>{label.toUpperCase()}</Mono>
        </View>
        <Serif style={{ fontSize: 24, color }}>{value}</Serif>
        {sub ? <Body numberOfLines={1} style={{ fontSize: 9.5, color: C.muted3 }}>{sub}</Body> : null}
      </View>
    </Card>
  );
}

/* Circular completion ring (SVG). */
function ProgressRing({ pct, size = 92, stroke = 9, color, children }: { pct: number; size?: number; stroke?: number; color: string; children?: React.ReactNode }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const off = circ * (1 - Math.max(0, Math.min(100, pct)) / 100);
  const c = size / 2;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={c} cy={c} r={r} stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} fill="none" />
        <Circle cx={c} cy={c} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={`${circ} ${circ}`} strokeDashoffset={off} />
      </Svg>
      {children}
    </View>
  );
}

/* Compact stat chip for the dashboard header row. */
function StatChip({ icon, value, label, color }: { icon: IconName; value: string; label: string; color: string }) {
  return (
    <Card colors={['rgba(46,28,18,0.42)', 'rgba(18,14,14,0.52)']} border={hexA(color, 0.18)} radius={15} style={{ flex: 1, padding: 12, gap: 7 }}>
      <View style={{ width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: hexA(color, 0.14), borderWidth: 1, borderColor: hexA(color, 0.3) }}>
        <Icon name={icon} size={15} color={color} strokeWidth={2.1} />
      </View>
      <Serif style={{ fontSize: 22, color: '#fff' }}>{value}</Serif>
      <Mono style={{ fontSize: 7.5, letterSpacing: 0.5, color: C.muted3 }}>{label.toUpperCase()}</Mono>
    </Card>
  );
}

/* ---------------- /marketing — dashboard ---------------- */
export function MarketingDashboard() {
  const { go, set } = useStore();
  const infQ = useInfluencers();
  const sideProf = useSidebarProfile();
  const [chartMode, setChartMode] = React.useState<'combined' | 'stories' | 'reels'>('combined');
  const [selMonth, setSelMonth] = React.useState<string | null>(null);
  const list = infQ.data ?? [];
  const active = list.filter((c) => (c.status ?? '').toLowerCase() === 'active');
  const activeThisMonth = active.filter((c) => c.sessionsThisMonth > 0);
  const monthDelivered = list.reduce((n, c) => n + c.monthStories + c.monthReels, 0);
  const monthExpected = list.reduce((n, c) => n + c.monthExpStories + c.monthExpReels, 0);
  const completionPct = monthExpected ? Math.round((monthDelivered / monthExpected) * 100) : 0;
  const monthStories = list.reduce((n, c) => n + c.monthStories, 0);
  const monthReels = list.reduce((n, c) => n + c.monthReels, 0);
  const behind = list.filter((c) => c.monthExpStories + c.monthExpReels > 0 && c.monthStories + c.monthReels < 0.5 * (c.monthExpStories + c.monthExpReels));
  const topPerformers = [...list].filter((c) => (c.status ?? '').toLowerCase() === 'active').sort((a, b) => b.score - a.score).slice(0, 3);
  const compColor = completionPct >= 70 ? C.green : completionPct >= 40 ? C.gold : C.red;
  const thisMonthLabel = new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  // Aggregate monthly buckets across all influencers (last 6 months present in data)
  const monthMap = new Map<string, { stories: number; reels: number }>();
  list.forEach((c) => c.monthly.forEach((m) => {
    const cur = monthMap.get(m.month) ?? { stories: 0, reels: 0 };
    cur.stories += m.stories; cur.reels += m.reels;
    monthMap.set(m.month, cur);
  }));
  const months = [...monthMap.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-6);
  const maxVal = Math.max(1, ...months.map(([, v]) => (chartMode === 'stories' ? v.stories : chartMode === 'reels' ? v.reels : Math.max(v.stories, v.reels))));

  // Deterministic insights, tone-tagged for color-coded rendering (web parity thresholds).
  type Insight = { text: string; tone: 'success' | 'warn' | 'danger' | 'info' };
  const insights: Insight[] = [];
  if (monthExpected > 0) {
    if (completionPct >= 80) insights.push({ text: `Content delivery is strong this month at ${completionPct}% of target.`, tone: 'success' });
    else if (completionPct >= 50) insights.push({ text: `Content delivery is at ${completionPct}% — nudge influencers to close the gap before month end.`, tone: 'warn' });
    else insights.push({ text: `Only ${completionPct}% of this month's content target delivered — follow-ups needed.`, tone: 'danger' });
  } else insights.push({ text: 'No content targets set this month — set expected stories/reels per influencer.', tone: 'info' });
  if (behind.length) insights.push({ text: `${behind.length} influencer${behind.length === 1 ? ' is' : 's are'} below 50% of their monthly target.`, tone: 'warn' });
  const inactive = active.length - activeThisMonth.length;
  if (inactive > 0) insights.push({ text: `${inactive} active influencer${inactive === 1 ? " hasn't" : "s haven't"} trained this month.`, tone: 'info' });
  const toneColor = (t: Insight['tone']) => (t === 'success' ? C.green : t === 'warn' ? C.gold : t === 'danger' ? C.red : C.blue);
  const toneIcon = (t: Insight['tone']): IconName => (t === 'success' ? 'checks' : t === 'danger' ? 'alert' : t === 'warn' ? 'trend' : 'sparkle');

  return (
    <Page gap={14}>
      <GreetingHeader
        date={new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: '2-digit', month: 'short' }).replace(',', ' ·').toUpperCase()}
        name="Marketing"
        sub="Influencer performance"
        initial="M"
        avatarUrl={sideProf.avatarUrl}
      />
      {infQ.isLoading ? (
        <View style={{ paddingVertical: 40, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View>
      ) : infQ.isError ? (
        <Body style={{ color: C.red, textAlign: 'center' }}>{(infQ.error as Error).message}</Body>
      ) : (
        <>
          {/* Hero — monthly completion ring */}
          <Card colors={['rgba(58,34,20,0.55)', 'rgba(20,15,14,0.6)']} border={hexA(C.orange, 0.22)} radius={20} style={{ padding: 16, overflow: 'hidden' }}>
            <LinearGradient colors={[hexA(C.orange, 0.5), 'rgba(255,255,255,0.02)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3 }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
              <ProgressRing pct={completionPct} color={compColor}>
                <View style={{ alignItems: 'center' }}>
                  <Serif style={{ fontSize: 26, color: compColor }}>{completionPct}%</Serif>
                  <Mono style={{ fontSize: 6.5, letterSpacing: 0.5, color: C.muted3 }}>DELIVERED</Mono>
                </View>
              </ProgressRing>
              <View style={{ flex: 1, gap: 8 }}>
                <View>
                  <Mono style={{ fontSize: 8, letterSpacing: 0.8, color: C.mono2 }}>{thisMonthLabel.toUpperCase()}</Mono>
                  <Serif style={{ fontSize: 17, color: '#fff' }}>Content Progress</Serif>
                </View>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <View style={{ flex: 1, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 12, backgroundColor: hexA(C.blue, 0.1), borderWidth: 1, borderColor: hexA(C.blue, 0.25) }}>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 16, color: C.blue }}>{monthStories}</Text>
                    <Mono style={{ fontSize: 7, letterSpacing: 0.4, color: C.muted3 }}>STORIES</Mono>
                  </View>
                  <View style={{ flex: 1, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 12, backgroundColor: hexA(C.purple, 0.1), borderWidth: 1, borderColor: hexA(C.purple, 0.25) }}>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 16, color: C.purple }}>{monthReels}</Text>
                    <Mono style={{ fontSize: 7, letterSpacing: 0.4, color: C.muted3 }}>REELS</Mono>
                  </View>
                  <View style={{ flex: 1, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 16, color: '#fff' }}>{monthDelivered}<Text style={{ fontFamily: F.body, fontSize: 10, color: C.muted3 }}>/{monthExpected || '—'}</Text></Text>
                    <Mono style={{ fontSize: 7, letterSpacing: 0.4, color: C.muted3 }}>TOTAL</Mono>
                  </View>
                </View>
              </View>
            </View>
          </Card>

          {/* Stat chips */}
          <View style={{ flexDirection: 'row', gap: 9 }}>
            <StatChip icon="users" value={String(list.length)} label={`${active.length} active`} color={C.blue} />
            <StatChip icon="target" value={String(activeThisMonth.length)} label="active this month" color={C.green} />
            <StatChip icon="alert" value={String(behind.length)} label="behind target" color={behind.length ? C.gold : C.muted2} />
          </View>

          {/* Monthly performance chart */}
          <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.09)" radius={18} style={{ padding: 15, gap: 13 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Serif style={{ fontSize: 17 }}>Monthly Performance</Serif>
                <Body style={{ fontSize: 10, color: C.muted3, marginTop: 1 }}>Tap a bar for the exact count.</Body>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {(['combined', 'stories', 'reels'] as const).map((m) => (
                <Pressable key={m} onPress={() => setChartMode(m)} style={{ flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: 10, backgroundColor: chartMode === m ? hexA(C.orange, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: chartMode === m ? hexA(C.orange, 0.45) : 'rgba(255,255,255,0.08)' }}>
                  <Text style={{ fontFamily: chartMode === m ? F.bodyBold : F.bodySemi, fontSize: 10.5, color: chartMode === m ? C.orange : C.muted }}>{m === 'combined' ? 'Combined' : m === 'stories' ? 'Stories' : 'Reels'}</Text>
                </Pressable>
              ))}
            </View>
            {months.length === 0 ? (
              <Body style={{ color: C.muted3, textAlign: 'center', paddingVertical: 20, fontSize: 12 }}>No campaign data yet.</Body>
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, height: 158, paddingTop: 8 }}>
                {months.map(([ym, v]) => {
                  const sel = selMonth === ym;
                  const barW = chartMode === 'combined' ? 12 : 24;
                  return (
                    <Pressable key={ym} onPress={() => setSelMonth(sel ? null : ym)} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
                      {sel ? (
                        <View style={{ paddingVertical: 2, paddingHorizontal: 7, borderRadius: 8, backgroundColor: hexA(C.orange, 0.16), borderWidth: 1, borderColor: hexA(C.orange, 0.45) }}>
                          <Text style={{ fontFamily: F.bodyBold, fontSize: 9.5, color: C.orange }}>{chartMode === 'stories' ? v.stories : chartMode === 'reels' ? v.reels : v.stories + v.reels}</Text>
                        </View>
                      ) : (
                        <View style={{ height: 18 }} />
                      )}
                      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 3, flex: 1, opacity: selMonth && !sel ? 0.4 : 1 }}>
                        {(chartMode === 'combined' || chartMode === 'stories') ? (
                          <View style={{ width: barW, height: Math.max(3, (v.stories / maxVal) * 118), borderRadius: 6, overflow: 'hidden', borderWidth: sel ? 1 : 0, borderColor: '#fff' }}>
                            <LinearGradient colors={['#93A2EF', '#5566D4']} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={{ flex: 1 }} />
                          </View>
                        ) : null}
                        {(chartMode === 'combined' || chartMode === 'reels') ? (
                          <View style={{ width: barW, height: Math.max(3, (v.reels / maxVal) * 118), borderRadius: 6, overflow: 'hidden', borderWidth: sel ? 1 : 0, borderColor: '#fff' }}>
                            <LinearGradient colors={['#AD93EF', '#7A5FD6']} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={{ flex: 1 }} />
                          </View>
                        ) : null}
                      </View>
                      <Mono style={{ fontSize: 7.5, color: sel ? C.orange : C.muted3 }}>{monthLabel(ym).toUpperCase()}</Mono>
                    </Pressable>
                  );
                })}
              </View>
            )}
            {selMonth && monthMap.get(selMonth) ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, paddingHorizontal: 12, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.28)', borderWidth: 1, borderColor: 'rgba(255,150,90,0.16)' }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 11.5, color: '#fff' }}>{monthLabel(selMonth)}</Text>
                <View style={{ flex: 1 }} />
                <Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: C.blue }}>{monthMap.get(selMonth)!.stories} stories</Text>
                <Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: C.purple }}>{monthMap.get(selMonth)!.reels} reels</Text>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: C.orange }}>{monthMap.get(selMonth)!.stories + monthMap.get(selMonth)!.reels} total</Text>
              </View>
            ) : null}
            <View style={{ flexDirection: 'row', gap: 14, justifyContent: 'center' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}><View style={{ width: 9, height: 9, borderRadius: 3, backgroundColor: '#5566D4' }} /><Mono style={{ fontSize: 8.5, color: C.muted2 }}>STORIES</Mono></View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}><View style={{ width: 9, height: 9, borderRadius: 3, backgroundColor: '#7A5FD6' }} /><Mono style={{ fontSize: 8.5, color: C.muted2 }}>REELS</Mono></View>
            </View>
          </Card>

          {/* Top performers */}
          {topPerformers.length ? (
            <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.09)" radius={18} style={{ padding: 15, gap: 11 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Icon name="crown" size={15} color={C.gold} strokeWidth={2} />
                <Serif style={{ flex: 1, fontSize: 16 }}>Top Performers</Serif>
                <Mono style={{ fontSize: 8, color: C.muted3 }}>BY SCORE</Mono>
              </View>
              {topPerformers.map((c, i) => {
                const col = scoreColor(c.score);
                const medal = ['#E0A53C', '#B8C0CC', '#C98A5A'][i] ?? C.muted2;
                return (
                  <Pressable key={c.id} onPress={() => { set({ selectedClientId: c.id, selectedClientName: c.name }); go('marketing-client-detail'); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.2)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' }}>
                    <View style={{ width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: hexA(medal, 0.18), borderWidth: 1, borderColor: hexA(medal, 0.5) }}>
                      <Text style={{ fontFamily: F.bodyBold, fontSize: 10, color: medal }}>{i + 1}</Text>
                    </View>
                    <Avatar initial={initials(c.name)} size={36} colors={avColors(c.name)} fontSize={13} />
                    <View style={{ flex: 1 }}>
                      <Body numberOfLines={1} style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{c.name}</Body>
                      <Body style={{ fontSize: 9.5, color: C.muted3, marginTop: 1 }}>{c.monthStories + c.monthReels} posts · {c.sessionsThisMonth} sessions this month</Body>
                    </View>
                    <View style={{ alignItems: 'center' }}>
                      <Serif style={{ fontSize: 18, color: col }}>{c.score}</Serif>
                      <Mono style={{ fontSize: 6, letterSpacing: 0.5, color: C.muted3 }}>/10</Mono>
                    </View>
                    <Icon name="chevRight" size={14} color={C.muted3} strokeWidth={2.2} />
                  </Pressable>
                );
              })}
            </Card>
          ) : null}

          {/* Smart insights */}
          <Card colors={['rgba(38,28,52,0.45)', 'rgba(18,14,20,0.5)']} border={hexA(C.purple, 0.2)} radius={18} style={{ padding: 15, gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Icon name="sparkle" size={15} color={C.purple} strokeWidth={2} />
              <Serif style={{ fontSize: 16 }}>Smart Insights</Serif>
            </View>
            {insights.map((ins, i) => {
              const col = toneColor(ins.tone);
              return (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, paddingHorizontal: 11, borderRadius: 12, backgroundColor: hexA(col, 0.07), borderWidth: 1, borderColor: hexA(col, 0.18) }}>
                  <View style={{ width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: hexA(col, 0.14) }}>
                    <Icon name={toneIcon(ins.tone)} size={13} color={col} strokeWidth={2.1} />
                  </View>
                  <Body style={{ flex: 1, fontSize: 12, color: C.ink3, lineHeight: 17 }}>{ins.text}</Body>
                </View>
              );
            })}
          </Card>

          {/* CTA */}
          <Pressable onPress={() => go('marketing-clients')} style={{ borderRadius: 16, overflow: 'hidden' }}>
            <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, paddingVertical: 15 }}>
              <Icon name="users" size={16} color="#fff" strokeWidth={2.2} />
              <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: '#fff' }}>View All Influencers</Text>
              <Icon name="chevRight" size={16} color="#fff" strokeWidth={2.4} />
            </LinearGradient>
          </Pressable>
        </>
      )}
    </Page>
  );
}


/* ---------------- /marketing/clients — influencer list ---------------- */
export function MarketingClients() {
  const { go, set } = useStore();
  const infQ = useInfluencers();
  const [query, setQuery] = React.useState('');
  const q = query.trim().toLowerCase();
  const rows = (infQ.data ?? []).filter((c) => !q || c.name.toLowerCase().includes(q));

  return (
    <Page gap={13}>
      <TitleBlock title="Influencer Clients" sub={`${infQ.data?.length ?? 0} influencers on the program`} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 13, paddingVertical: 11, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)' }}>
        <Icon name="search" size={15} color={C.muted3} strokeWidth={2} />
        <TextInput value={query} onChangeText={setQuery} placeholder="Search influencers…" placeholderTextColor={C.muted3} autoCorrect={false} style={{ flex: 1, fontFamily: F.body, fontSize: 14, color: '#fff', padding: 0 }} />
      </View>
      {infQ.isLoading ? (
        <View style={{ paddingVertical: 30, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View>
      ) : rows.length === 0 ? (
        <Body style={{ color: C.muted3, textAlign: 'center', paddingVertical: 24, fontSize: 12.5 }}>No influencers{q ? ' match your search' : ''}.</Body>
      ) : rows.map((c) => {
        const col = scoreColor(c.score);
        return (
          <Card key={c.id} onPress={() => { set({ selectedClientId: c.id, selectedClientName: c.name }); go('marketing-client-detail'); }} colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border={hexA(col, 0.22)} radius={15} style={{ padding: 12, gap: 10, borderLeftWidth: 3, borderLeftColor: col }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
              <Avatar initial={initials(c.name)} size={40} colors={avColors(c.name)} fontSize={14} />
              <View style={{ flex: 1 }}>
                <Body numberOfLines={1} style={{ fontSize: 14.5, fontFamily: F.bodySemi, color: '#fff' }}>{c.name}</Body>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
                  <Badge text={c.status === 'active' ? 'Active' : (c.status ?? 'Inactive')} color={c.status === 'active' ? C.green : C.muted2} />
                  {c.crmName ? <Badge text={`CRM · ${c.crmName}`} color={C.gold} /> : null}
                </View>
              </View>
              <View style={{ alignItems: 'center' }}>
                <Serif style={{ fontSize: 21, color: col }}>{c.score}</Serif>
                <Mono style={{ fontSize: 6.5, letterSpacing: 0.6, color: C.muted3 }}>SCORE /10</Mono>
              </View>
            </View>
            <View style={{ flexDirection: 'row', paddingVertical: 8, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.22)' }}>
              {([['SESSIONS', `${c.sessionsUsed}/${c.sessionsTotal || '—'}`, C.orange], ['STORIES', `${c.stories}/${c.expectedStories || '—'}`, C.blue], ['REELS', `${c.reels}/${c.expectedReels || '—'}`, C.purple], ['THIS MONTH', String(c.sessionsThisMonth), C.green]] as const).map(([lab, val, cc]) => (
                <View key={lab} style={{ flex: 1, alignItems: 'center', gap: 2 }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: cc }}>{val}</Text>
                  <Mono style={{ fontSize: 6.5, letterSpacing: 0.5, color: C.muted3 }}>{lab}</Mono>
                </View>
              ))}
            </View>
          </Card>
        );
      })}
    </Page>
  );
}

/* ---------------- /marketing/clients/:id — influencer detail ---------------- */
type MTab = 'content' | 'performance' | 'instagram' | 'tickets' | 'sessions' | 'reports';

export function MarketingClientDetail() {
  const { selectedClientId: clientId, selectedClientName, back, canGoBack, go } = useStore();
  const infQ = useInfluencer(clientId ?? null);
  const c = infQ.data;
  const name = c?.name ?? selectedClientName ?? 'Influencer';
  const [tab, setTab] = React.useState<MTab>('content');
  const tickets = useInfluencerOpenTickets(clientId ?? null, 'marketing');
  const allInf = useInfluencers().data ?? [];

  React.useEffect(() => { if (tab === 'tickets') tickets.markSeen(); }, [tab]);

  return (
    <Page gap={13}>
      <Pressable onPress={() => (canGoBack ? back() : go('marketing-clients'))} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name="arrowLeft" size={16} color={C.ink2} strokeWidth={2.2} />
        <Body style={{ fontSize: 13.5, color: C.ink2 }}>Back</Body>
      </Pressable>

      {/* Header card */}
      <Card colors={['rgba(46,28,18,0.5)', 'rgba(18,14,14,0.55)']} border="rgba(255,150,90,0.16)" radius={18} style={{ padding: 14, gap: 11 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Avatar initial={initials(name)} size={50} colors={avColors(name)} fontSize={18} />
          <View style={{ flex: 1 }}>
            <Serif numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={{ fontSize: 20 }}>{name}</Serif>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
              <Badge text="Influencer" color={C.purple} />
              <Badge text={c?.status === 'active' ? 'Active' : (c?.status ?? '—')} color={c?.status === 'active' ? C.green : C.muted2} />
              {c?.crmName ? <Badge text={`CRM · ${c.crmName}`} color={C.gold} /> : null}
            </View>
          </View>
          {c ? (
            <View style={{ alignItems: 'center' }}>
              <Serif style={{ fontSize: 24, color: scoreColor(c.score) }}>{c.score}</Serif>
              <Mono style={{ fontSize: 6.5, letterSpacing: 0.6, color: C.muted3 }}>SCORE</Mono>
            </View>
          ) : null}
        </View>
        {c ? (
          <View style={{ flexDirection: 'row', paddingVertical: 8, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.22)' }}>
            {([['CYCLE', `${c.sessionsInCycle}/${c.cycleTotal || '—'}`], ['TOTAL SESS', String(c.sessionsUsed)], ['STORIES', String(c.stories)], ['REELS', String(c.reels)]] as const).map(([lab, val]) => (
              <View key={lab} style={{ flex: 1, alignItems: 'center', gap: 2 }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: '#fff' }}>{val}</Text>
                <Mono style={{ fontSize: 6.5, letterSpacing: 0.5, color: C.muted3 }}>{lab}</Mono>
              </View>
            ))}
          </View>
        ) : null}
      </Card>

      {/* Tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 7 }}>
        {([['content', 'Content'], ['performance', 'Performance'], ['instagram', 'Instagram'], ['tickets', 'Tickets'], ['sessions', 'Sessions'], ['reports', 'Reports']] as [MTab, string][]).map(([id, label]) => {
          const active = tab === id;
          return (
            <Pressable key={id} onPress={() => setTab(id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 9, paddingHorizontal: 15, borderRadius: 999, backgroundColor: active ? hexA(C.orange, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.orange, 0.5) : 'rgba(255,255,255,0.08)' }}>
              <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 12, color: active ? C.orange : C.muted }}>{label}</Text>
              {id === 'tickets' && tickets.unread > 0 ? (
                <View style={{ minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4, backgroundColor: C.red, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 9, color: '#fff' }}>{tickets.unread}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>

      {tab === 'content' ? <ContentTab clientId={clientId!} /> :
       tab === 'performance' ? <PerformanceTab me={c} all={allInf} /> :
       tab === 'instagram' ? <InstagramTab clientId={clientId!} url={c?.instagramUrl ?? null} /> :
       tab === 'tickets' ? <TicketsTab clientId={clientId!} /> :
       tab === 'sessions' ? <SessionsTab clientId={clientId!} /> :
       <ReportsTab clientId={clientId!} />}
    </Page>
  );
}

/* ----- Content tab ----- */
function ContentTab({ clientId }: { clientId: string }) {
  const logsQ = useInfluencerCampaignLogs(clientId);
  const muts = useCampaignLogMutations(clientId);
  const [month, setMonth] = React.useState(currentIstMonth());
  const [targetOpen, setTargetOpen] = React.useState(false);
  const [addOpen, setAddOpen] = React.useState(false);
  const log = (logsQ.data ?? []).find((l) => l.month === month) ?? null;

  return (
    <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.09)" style={{ padding: 14, gap: 12 }}>
      {/* Month navigator */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Pressable onPress={() => setMonth((m) => shiftMonth(m, -1))} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="chevLeft" size={15} color={C.ink2} strokeWidth={2.3} />
        </Pressable>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Serif style={{ fontSize: 16 }}>{monthLabel(month)}</Serif>
          {log ? <Badge text={log.status ?? 'pending'} color={log.status === 'completed' ? C.green : log.status === 'partial' ? C.gold : C.muted2} /> : null}
        </View>
        <Pressable onPress={() => setMonth((m) => shiftMonth(m, 1))} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="chevRight" size={15} color={C.ink2} strokeWidth={2.3} />
        </Pressable>
      </View>

      {logsQ.isLoading ? (
        <View style={{ paddingVertical: 20, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View>
      ) : !log || (log.expected_stories === 0 && log.expected_reels === 0) ? (
        <View style={{ alignItems: 'center', gap: 10, paddingVertical: 16 }}>
          <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center' }}>No content target set for {monthLabel(month)}.</Body>
          <Pressable onPress={() => setTargetOpen(true)} style={{ paddingVertical: 10, paddingHorizontal: 18, borderRadius: 12, backgroundColor: hexA(C.orange, 0.14), borderWidth: 1, borderColor: hexA(C.orange, 0.45) }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: C.orange }}>Set Target</Text>
          </Pressable>
        </View>
      ) : (
        <>
          {([['Stories', log.stories_count, log.expected_stories, C.blue], ['Reels', log.reels_count, log.expected_reels, C.purple]] as const).map(([lab, done, exp, col]) => (
            <View key={lab} style={{ gap: 5 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Body style={{ flex: 1, fontSize: 12.5, fontFamily: F.bodySemi, color: '#fff' }}>{lab}</Body>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: col }}>{done}<Text style={{ color: C.muted2, fontSize: 11 }}> / {exp}</Text></Text>
              </View>
              <View style={{ height: 6, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.06)' }}>
                <View style={{ width: `${Math.min(100, exp ? (done / exp) * 100 : 0)}%`, height: 6, borderRadius: 999, backgroundColor: col }} />
              </View>
            </View>
          ))}
          {/* Content entries */}
          {log.content_details.length ? (
            <View style={{ gap: 6, marginTop: 2 }}>
              <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.muted3 }}>ENTRIES · {log.content_details.length}</Mono>
              {log.content_details.slice().reverse().slice(0, 12).map((e, i) => (
                <Pressable key={i} onPress={() => { if (e.url) Linking.openURL(e.url).catch(() => {}); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7, paddingHorizontal: 10, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.2)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' }}>
                  <Badge text={e.type === 'story' ? 'Story' : 'Reel'} color={e.type === 'story' ? C.blue : C.purple} />
                  {e.category ? <Badge text={e.category} color={C.gold} /> : null}
                  <Mono style={{ flex: 1, fontSize: 8.5, color: C.muted3, textAlign: 'right' }}>{new Date(e.added_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</Mono>
                  {e.url ? <Icon name="chevRight" size={12} color={C.blue} strokeWidth={2.2} /> : null}
                </Pressable>
              ))}
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable onPress={() => setAddOpen(true)} style={{ flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 12, backgroundColor: hexA(C.green, 0.13), borderWidth: 1, borderColor: hexA(C.green, 0.4) }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: C.green }}>+ Add Content</Text>
            </Pressable>
            <Pressable onPress={() => setTargetOpen(true)} style={{ flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: C.muted }}>Edit Target</Text>
            </Pressable>
          </View>
        </>
      )}

      {targetOpen ? <TargetSheet month={month} initial={log} onClose={() => setTargetOpen(false)} onSave={(es, er) => muts.setTarget.mutate({ month, expectedStories: es, expectedReels: er }, { onSuccess: () => setTargetOpen(false) })} busy={muts.setTarget.isPending} err={(muts.setTarget.error as Error | null)?.message} /> : null}
      {addOpen ? <AddContentSheet month={month} onClose={() => setAddOpen(false)} onSave={(entries) => muts.addContent.mutate({ month, entries }, { onSuccess: () => setAddOpen(false) })} busy={muts.addContent.isPending} err={(muts.addContent.error as Error | null)?.message} /> : null}
    </Card>
  );
}

function SheetFrame({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable onPress={onClose} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.62)' }} />
        <View style={{ backgroundColor: '#0E0A09', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.14)', padding: 18, paddingBottom: 30 }}>
          <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 12 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
            <Serif style={{ flex: 1, fontSize: 18 }}>{title}</Serif>
            <Pressable onPress={onClose} hitSlop={8} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="close" size={13} color="#B8B2AC" strokeWidth={2.3} />
            </Pressable>
          </View>
          {children}
        </View>
      </View>
    </Modal>
  );
}
const inputSt = { borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 11, paddingVertical: 10, color: '#fff', fontFamily: F.body, fontSize: 13 } as const;

function TargetSheet({ month, initial, onClose, onSave, busy, err }: { month: string; initial: { expected_stories: number; expected_reels: number } | null; onClose: () => void; onSave: (s: number, r: number) => void; busy: boolean; err?: string | null }) {
  const [stories, setStories] = React.useState(String(initial?.expected_stories || ''));
  const [reels, setReels] = React.useState(String(initial?.expected_reels || ''));
  return (
    <SheetFrame title={`Target · ${monthLabel(month)}`} onClose={onClose}>
      <View style={{ gap: 11 }}>
        <Mono style={{ fontSize: 8.5, letterSpacing: 0.8, color: C.mono2 }}>EXPECTED STORIES</Mono>
        <TextInput value={stories} onChangeText={setStories} keyboardType="numeric" placeholder="4" placeholderTextColor={C.muted3} style={inputSt} />
        <Mono style={{ fontSize: 8.5, letterSpacing: 0.8, color: C.mono2 }}>EXPECTED REELS</Mono>
        <TextInput value={reels} onChangeText={setReels} keyboardType="numeric" placeholder="1" placeholderTextColor={C.muted3} style={inputSt} />
        {err ? <Body style={{ fontSize: 11, color: C.red }}>{err}</Body> : null}
        <Pressable disabled={busy} onPress={() => onSave(parseInt(stories, 10) || 0, parseInt(reels, 10) || 0)} style={{ alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: hexA(C.orange, busy ? 0.06 : 0.16), borderWidth: 1, borderColor: hexA(C.orange, 0.5) }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: C.orange }}>{busy ? 'Saving…' : 'Save Target'}</Text>
        </Pressable>
      </View>
    </SheetFrame>
  );
}

function AddContentSheet({ month, onClose, onSave, busy, err }: { month: string; onClose: () => void; onSave: (entries: { type: 'story' | 'reel'; url?: string; category?: string }[]) => void; busy: boolean; err?: string | null }) {
  const [type, setType] = React.useState<'story' | 'reel'>('story');
  const [url, setUrl] = React.useState('');
  const [category, setCategory] = React.useState<string | null>(null);
  return (
    <SheetFrame title={`Add Content · ${monthLabel(month)}`} onClose={onClose}>
      <View style={{ gap: 11 }}>
        <View style={{ flexDirection: 'row', gap: 7 }}>
          {(['story', 'reel'] as const).map((t) => (
            <Pressable key={t} onPress={() => setType(t)} style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 12, backgroundColor: type === t ? hexA(t === 'story' ? C.blue : C.purple, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: type === t ? hexA(t === 'story' ? C.blue : C.purple, 0.5) : 'rgba(255,255,255,0.08)' }}>
              <Text style={{ fontFamily: type === t ? F.bodyBold : F.bodySemi, fontSize: 12.5, color: type === t ? (t === 'story' ? C.blue : C.purple) : C.muted }}>{t === 'story' ? 'Story' : 'Reel'}</Text>
            </Pressable>
          ))}
        </View>
        {type === 'reel' ? (
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {['aesthetic', 'longevity', 'performance'].map((cat) => (
              <Pressable key={cat} onPress={() => setCategory(category === cat ? null : cat)} style={{ paddingVertical: 6, paddingHorizontal: 11, borderRadius: 999, backgroundColor: category === cat ? hexA(C.gold, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: category === cat ? hexA(C.gold, 0.5) : 'rgba(255,255,255,0.08)' }}>
                <Text style={{ fontFamily: F.bodySemi, fontSize: 10.5, color: category === cat ? C.gold : C.muted }}>{cat}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        <Mono style={{ fontSize: 8.5, letterSpacing: 0.8, color: C.mono2 }}>URL (OPTIONAL)</Mono>
        <TextInput value={url} onChangeText={setUrl} autoCapitalize="none" placeholder="https://instagram.com/…" placeholderTextColor={C.muted3} style={inputSt} />
        {err ? <Body style={{ fontSize: 11, color: C.red }}>{err}</Body> : null}
        <Pressable disabled={busy} onPress={() => onSave([{ type, url: url.trim() || undefined, category: category ?? undefined }])} style={{ alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: hexA(C.green, busy ? 0.06 : 0.16), borderWidth: 1, borderColor: hexA(C.green, 0.5) }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: C.green }}>{busy ? 'Saving…' : `Add ${type === 'story' ? 'Story' : 'Reel'}`}</Text>
        </Pressable>
      </View>
    </SheetFrame>
  );
}


/* ----- Performance tab (client-side scoring, web parity) ----- */
function PerformanceTab({ me, all }: { me: InfluencerClient | null; all: InfluencerClient[] }) {
  if (!me) return <Body style={{ color: C.muted3, textAlign: 'center', paddingVertical: 20 }}>Loading…</Body>;
  const sessionScore = me.sessionsTotal ? Math.min(10, (me.sessionsUsed / me.sessionsTotal) * 10) : 0;
  const contentScore = (me.expectedStories + me.expectedReels) ? Math.min(10, ((me.stories + me.reels) / (me.expectedStories + me.expectedReels)) * 10) : 0;
  const okMonths = me.monthly.filter((m) => m.status === 'on-track' || m.status === 'exceeded').length;
  const consistencyScore = me.monthly.length ? (okMonths / me.monthly.length) * 10 : 0;
  const overall = Math.round((sessionScore * 0.4 + contentScore * 0.4 + consistencyScore * 0.2) * 10);
  const peers = all.filter((a) => a.id !== me.id);
  const peerAvg = peers.length ? peers.reduce((n, p) => n + p.score, 0) / peers.length : 0;
  const lastTwo = me.monthly.slice(-2);
  const trend = lastTwo.length === 2 ? (lastTwo[1].stories + lastTwo[1].reels) - (lastTwo[0].stories + lastTwo[0].reels) : 0;
  const rows: [string, number, string][] = [
    ['Sessions (40%)', sessionScore, C.orange],
    ['Content (40%)', contentScore, C.blue],
    ['Consistency (20%)', consistencyScore, C.purple],
  ];
  return (
    <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.09)" style={{ padding: 14, gap: 13 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ width: 74, height: 74, borderRadius: 37, borderWidth: 4, borderColor: hexA(overall >= 70 ? C.green : overall >= 50 ? C.gold : C.red, 0.7), alignItems: 'center', justifyContent: 'center' }}>
          <Serif style={{ fontSize: 22, color: overall >= 70 ? C.green : overall >= 50 ? C.gold : C.red }}>{overall}</Serif>
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <Serif style={{ fontSize: 16 }}>Overall Score</Serif>
          <Body style={{ fontSize: 11.5, color: C.muted2 }}>Sessions 40% · Content 40% · Consistency 20%</Body>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <Icon name="trend" size={12} color={trend >= 0 ? C.green : C.red} strokeWidth={2.2} />
            <Body style={{ fontSize: 11, color: trend >= 0 ? C.green : C.red }}>
              {trend === 0 ? 'Flat vs last month' : trend > 0 ? `+${trend} content vs last month` : `${trend} content vs last month`}
            </Body>
          </View>
        </View>
      </View>
      {rows.map(([lab, val, col]) => (
        <View key={lab} style={{ gap: 4 }}>
          <View style={{ flexDirection: 'row' }}>
            <Body style={{ flex: 1, fontSize: 12, color: C.ink3 }}>{lab}</Body>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: col }}>{val.toFixed(1)}/10</Text>
          </View>
          <View style={{ height: 6, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.06)' }}>
            <View style={{ width: `${val * 10}%`, height: 6, borderRadius: 999, backgroundColor: col }} />
          </View>
        </View>
      ))}
      <View style={{ gap: 4, paddingTop: 4, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' }}>
        <View style={{ flexDirection: 'row' }}>
          <Body style={{ flex: 1, fontSize: 12, color: C.ink3 }}>Peer average (score /10)</Body>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: C.muted }}>{peerAvg.toFixed(1)}</Text>
        </View>
        <View style={{ height: 6, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.06)' }}>
          <View style={{ width: `${Math.min(100, peerAvg * 10)}%`, height: 6, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.25)' }} />
        </View>
        <Body style={{ fontSize: 10.5, color: me.score >= peerAvg ? C.green : C.gold }}>
          {me.score >= peerAvg ? `Above the peer average by ${(me.score - peerAvg).toFixed(1)} points` : `${(peerAvg - me.score).toFixed(1)} points below the peer average`}
        </Body>
      </View>
      {me.monthly.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {me.monthly.slice(-6).map((m) => (
            <View key={m.month} style={{ paddingVertical: 4, paddingHorizontal: 9, borderRadius: 999, backgroundColor: hexA(statusColor(m.status), 0.1), borderWidth: 1, borderColor: hexA(statusColor(m.status), 0.3) }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 9.5, color: statusColor(m.status) }}>{monthLabel(m.month)} · {m.status}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

/* ----- Instagram tab ----- */
function InstagramTab({ clientId, url }: { clientId: string; url: string | null }) {
  const logsQ = useInfluencerCampaignLogs(clientId);
  const muts = useCampaignLogMutations(clientId);
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(url ?? '');
  const shots = (logsQ.data ?? []).flatMap((l) => l.screenshots).filter(Boolean);
  return (
    <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.09)" style={{ padding: 14, gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name="heart" size={16} color={C.purple} strokeWidth={2} />
        <Serif style={{ flex: 1, fontSize: 16 }}>Instagram</Serif>
        <Pressable onPress={() => { setDraft(url ?? ''); setEditing(true); }} hitSlop={8}>
          <Mono style={{ fontSize: 9, color: C.blue }}>{url ? 'EDIT' : 'ADD URL'}</Mono>
        </Pressable>
      </View>
      {url ? (
        <Pressable onPress={() => Linking.openURL(url).catch(() => {})} style={{ flexDirection: 'row', alignItems: 'center', gap: 9, padding: 12, borderRadius: 12, backgroundColor: hexA(C.purple, 0.08), borderWidth: 1, borderColor: hexA(C.purple, 0.3) }}>
          <Body numberOfLines={1} style={{ flex: 1, fontSize: 12.5, color: '#C9B8F5' }}>{url}</Body>
          <Icon name="chevRight" size={14} color={C.purple} strokeWidth={2.2} />
        </Pressable>
      ) : (
        <Body style={{ fontSize: 12, color: C.muted3 }}>No Instagram profile linked yet.</Body>
      )}
      {shots.length ? (
        <View style={{ gap: 6 }}>
          <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.muted3 }}>SCREENSHOTS · {shots.length}</Mono>
          {shots.slice(0, 10).map((s, i) => (
            <Pressable key={i} onPress={() => Linking.openURL(s).catch(() => {})} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.2)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' }}>
              <Icon name="file" size={13} color={C.blue} strokeWidth={2} />
              <Body numberOfLines={1} style={{ flex: 1, fontSize: 11, color: C.ink3 }}>{s.split('/').pop()}</Body>
            </Pressable>
          ))}
        </View>
      ) : null}
      {editing ? (
        <SheetFrame title="Instagram URL" onClose={() => setEditing(false)}>
          <View style={{ gap: 11 }}>
            <TextInput value={draft} onChangeText={setDraft} autoCapitalize="none" placeholder="https://instagram.com/username" placeholderTextColor={C.muted3} style={inputSt} />
            {muts.setInstagram.isError ? <Body style={{ fontSize: 11, color: C.red }}>{(muts.setInstagram.error as Error).message}</Body> : null}
            <Pressable disabled={muts.setInstagram.isPending} onPress={() => muts.setInstagram.mutate({ url: draft }, { onSuccess: () => setEditing(false) })} style={{ alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: hexA(C.purple, 0.16), borderWidth: 1, borderColor: hexA(C.purple, 0.5) }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: C.purple }}>{muts.setInstagram.isPending ? 'Saving…' : 'Save'}</Text>
            </Pressable>
          </View>
        </SheetFrame>
      ) : null}
    </Card>
  );
}

/* ----- Tickets tab (two-way marketing ⇄ CRM threads in log JSONB) ----- */
function TicketsTab({ clientId }: { clientId: string }) {
  const { session } = useAuth();
  const logsQ = useInfluencerCampaignLogs(clientId);
  const muts = useCampaignLogMutations(clientId);
  const [draft, setDraft] = React.useState('');
  const [replyFor, setReplyFor] = React.useState<{ month: string; parentId: string } | null>(null);
  const [replyDraft, setReplyDraft] = React.useState('');

  const threads = (logsQ.data ?? []).flatMap((l) =>
    l.tickets.filter((t) => !t.parent_id).map((root) => ({
      month: l.month, root,
      replies: l.tickets.filter((t) => t.parent_id === root.id).sort((a, b) => a.created_at.localeCompare(b.created_at)),
    }))
  ).sort((a, b) => b.root.created_at.localeCompare(a.root.created_at));

  return (
    <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.09)" style={{ padding: 14, gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name="inbox" size={16} color={C.gold} strokeWidth={2} />
        <Serif style={{ flex: 1, fontSize: 16 }}>Tickets</Serif>
        <Mono style={{ fontSize: 9, color: C.muted3 }}>{threads.filter((t) => t.root.status === 'open').length} OPEN</Mono>
      </View>

      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TextInput value={draft} onChangeText={setDraft} placeholder="Raise a ticket for the CRM team…" placeholderTextColor={C.muted3} style={[inputSt, { flex: 1 }]} />
        <Pressable
          disabled={!draft.trim() || muts.addTicket.isPending}
          onPress={() => muts.addTicket.mutate({ month: currentIstMonth(), message: draft.trim(), sender: 'marketing' }, { onSuccess: () => setDraft('') })}
          style={{ width: 42, borderRadius: 11, backgroundColor: draft.trim() ? hexA(C.gold, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: draft.trim() ? hexA(C.gold, 0.5) : 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name="send" size={15} color={draft.trim() ? C.gold : C.muted3} strokeWidth={2} />
        </Pressable>
      </View>

      {logsQ.isLoading ? (
        <View style={{ paddingVertical: 16, alignItems: 'center' }}><ActivityIndicator color={C.gold} /></View>
      ) : threads.length === 0 ? (
        <Body style={{ fontSize: 12, color: C.muted3, textAlign: 'center', paddingVertical: 12 }}>No tickets yet.</Body>
      ) : threads.map(({ month, root, replies }) => {
        const open = root.status === 'open';
        return (
          <View key={root.id} style={{ borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: hexA(open ? C.gold : C.green, 0.22), padding: 11, gap: 7 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
              <Badge text={root.sender === 'marketing' ? 'Marketing' : 'CRM'} color={root.sender === 'marketing' ? C.purple : C.gold} />
              <Badge text={open ? 'Open' : 'Closed'} color={open ? C.gold : C.green} />
              <Mono style={{ flex: 1, fontSize: 8.5, color: C.muted3, textAlign: 'right' }}>{new Date(root.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</Mono>
            </View>
            <Body style={{ fontSize: 12.5, color: '#fff', lineHeight: 18 }}>{root.message}</Body>
            {replies.map((r) => (
              <View key={r.id} style={{ marginLeft: 12, paddingLeft: 10, borderLeftWidth: 2, borderLeftColor: hexA(r.sender === 'marketing' ? C.purple : C.gold, 0.4), gap: 2 }}>
                <Mono style={{ fontSize: 8, color: r.sender === 'marketing' ? C.purple : C.gold }}>{r.sender.toUpperCase()}</Mono>
                <Body style={{ fontSize: 12, color: C.ink3 }}>{r.message}</Body>
              </View>
            ))}
            {open ? (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Pressable onPress={() => { setReplyFor({ month, parentId: root.id }); setReplyDraft(''); }} style={{ flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
                  <Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: C.muted }}>Reply</Text>
                </Pressable>
                <Pressable onPress={() => muts.closeTicket.mutate({ month, ticketId: root.id, closedBy: session?.user?.id ?? 'marketing' })} style={{ flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 10, backgroundColor: hexA(C.green, 0.1), borderWidth: 1, borderColor: hexA(C.green, 0.35) }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: C.green }}>Close Ticket</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        );
      })}

      {replyFor ? (
        <SheetFrame title="Reply to ticket" onClose={() => setReplyFor(null)}>
          <View style={{ gap: 11 }}>
            <TextInput value={replyDraft} onChangeText={setReplyDraft} multiline placeholder="Your reply…" placeholderTextColor={C.muted3} style={[inputSt, { minHeight: 70, textAlignVertical: 'top' }]} />
            <Pressable
              disabled={!replyDraft.trim() || muts.addTicket.isPending}
              onPress={() => muts.addTicket.mutate({ month: replyFor.month, message: replyDraft.trim(), sender: 'marketing', parentId: replyFor.parentId }, { onSuccess: () => setReplyFor(null) })}
              style={{ alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: hexA(C.gold, 0.16), borderWidth: 1, borderColor: hexA(C.gold, 0.5) }}
            >
              <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: C.gold }}>{muts.addTicket.isPending ? 'Sending…' : 'Send Reply'}</Text>
            </Pressable>
          </View>
        </SheetFrame>
      ) : null}
    </Card>
  );
}

/* ----- Sessions tab — web ClientSessionTabs port (package → cycle → session tree, read-only) ----- */
const dayName = (iso: string) => new Date(iso).toLocaleDateString('en-US', { weekday: 'long' });
const fmtSessAt = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} · ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
};
const fmtSessDay = (iso: string | null) => iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 'ongoing';
const prettyType = (t: string | null) => (t ? t.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()) : '—');

function SessionsTab({ clientId }: { clientId: string }) {
  const q = useSessionsByCycle(clientId);
  const packages = q.data?.packages ?? [];
  const other = q.data?.other ?? [];
  const [openPkg, setOpenPkg] = React.useState<number | null>(null);
  const [openCycle, setOpenCycle] = React.useState<string | null>(null);

  // Open the current package by default once data lands.
  React.useEffect(() => {
    if (openPkg === null && packages.length) setOpenPkg(packages.find((p) => p.isCurrent)?.n ?? packages[0].n);
  }, [packages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 2 }}>
        <Icon name="dumbbell" size={16} color={C.orange} strokeWidth={2} />
        <Serif style={{ flex: 1, fontSize: 17 }}>All Sessions</Serif>
        <Mono style={{ fontSize: 8.5, color: C.muted3 }}>READ-ONLY</Mono>
      </View>

      {q.isLoading ? (
        <View style={{ paddingVertical: 24, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View>
      ) : q.isError ? (
        <Body style={{ fontSize: 12, color: C.red, textAlign: 'center', paddingVertical: 14 }}>{(q.error as Error).message}</Body>
      ) : packages.length === 0 && other.length === 0 ? (
        <Body style={{ fontSize: 12, color: C.muted3, textAlign: 'center', paddingVertical: 18 }}>No sessions recorded.</Body>
      ) : (
        <>
          {packages.map((p) => {
            const pkgOpen = openPkg === p.n;
            return (
              <Card key={p.n} colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border={hexA(p.isCurrent ? C.orange : '#94A3B8', p.isCurrent ? 0.32 : 0.12)} radius={15} style={{ padding: 12, gap: 8 }}>
                <Pressable onPress={() => setOpenPkg(pkgOpen ? null : p.n)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Icon name="layers" size={15} color={p.isCurrent ? C.orange : C.muted2} strokeWidth={2} />
                  <Serif style={{ fontSize: 15 }}>Package {p.n}</Serif>
                  <View style={{ paddingVertical: 2, paddingHorizontal: 7, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 8.5, color: C.muted }}>{p.total || '∞'} Sessions</Text>
                  </View>
                  {p.isCurrent ? <Badge text="Current" color={C.orange} /> : <Badge text="Completed" color={C.green} />}
                  <View style={{ flex: 1 }} />
                  <Icon name={pkgOpen ? 'chevUp' : 'chevDown'} size={13} color={C.muted3} strokeWidth={2.3} />
                </Pressable>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  <Mono style={{ fontSize: 8, color: C.muted3 }}>{p.cycles.length}/{p.total ? Math.ceil(p.total / p.perCycle) : '∞'} CYCLES</Mono>
                  <Mono style={{ fontSize: 8, color: C.muted3 }}>{p.countable}/{p.total || '∞'} SESSIONS</Mono>
                  <Mono style={{ fontSize: 8, color: C.muted3 }}>{fmtSessDay(p.start).toUpperCase()} – {fmtSessDay(p.end).toUpperCase()}</Mono>
                </View>

                {pkgOpen ? p.cycles.map((cy) => {
                  const key = `${p.n}-${cy.n}`;
                  const cyOpen = openCycle === key || (openCycle === null && cy.isCurrent);
                  return (
                    <View key={key} style={{ borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.22)', padding: 10, gap: 8 }}>
                      <Pressable onPress={() => setOpenCycle(cyOpen ? `${key}-x` : key)} style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                        <Icon name={cyOpen ? 'chevDown' : 'chevRight'} size={12} color={C.muted2} strokeWidth={2.3} />
                        <Body style={{ fontSize: 12.5, fontFamily: F.bodySemi, color: '#fff' }}>Cycle {cy.n}</Body>
                        {cy.isCurrent ? <Badge text="Current" color={C.green} /> : <Badge text="Complete" color={C.green} />}
                        <View style={{ flex: 1 }} />
                        <Mono style={{ fontSize: 7.5, color: C.muted3 }}>{cy.sessions.length}/{p.perCycle} SESSIONS</Mono>
                      </Pressable>

                      {cyOpen ? (
                        cy.sessions.length === 0 ? (
                          <Body style={{ fontSize: 10.5, color: C.muted3, paddingLeft: 6 }}>No sessions in this cycle.</Body>
                        ) : cy.sessions.map((s) => {
                          const cancelled = s.cancelled || s.status === 'cancelled';
                          return (
                            <View key={s.id} style={{ flexDirection: 'row', gap: 9, paddingVertical: 8, paddingHorizontal: 4, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)' }}>
                              <View style={{ flex: 1, gap: 2 }}>
                                <Body style={{ fontSize: 11.5, fontFamily: F.bodySemi, color: '#fff' }}>{fmtSessAt(s.scheduled_at)}</Body>
                                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                                  <Mono style={{ fontSize: 8, color: C.muted3 }}>{dayName(s.scheduled_at).toUpperCase()}</Mono>
                                  <Body style={{ fontSize: 10, color: C.blue }}>{prettyType(s.session_type)}</Body>
                                  <Body style={{ fontSize: 10, color: C.muted2 }}>· {s.trainerName}</Body>
                                </View>
                                {s.notes ? <Body numberOfLines={2} style={{ fontSize: 9.5, color: C.muted3 }}>{s.notes}</Body> : null}
                              </View>
                              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                                <Badge text={cancelled ? 'cancelled' : 'completed'} color={cancelled ? C.red : C.green} />
                                {s.complimentary_session ? <Badge text="Comp" color={C.purple} /> : null}
                              </View>
                            </View>
                          );
                        })
                      ) : null}
                    </View>
                  );
                }) : null}
              </Card>
            );
          })}

          {/* Other services (physio / RLT on odds basic — kept outside the pool, web parity) */}
          {other.length ? (
            <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.09)" radius={15} style={{ padding: 12, gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                <Icon name="activity" size={14} color={C.purple} strokeWidth={2} />
                <Serif style={{ flex: 1, fontSize: 14 }}>Other Services</Serif>
                <Mono style={{ fontSize: 8, color: C.muted3 }}>{other.length}</Mono>
              </View>
              {other.slice(0, 40).map((s) => {
                const cancelled = s.cancelled || s.status === 'cancelled';
                return (
                  <View key={s.id} style={{ flexDirection: 'row', gap: 9, paddingVertical: 7, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)' }}>
                    <View style={{ flex: 1, gap: 1 }}>
                      <Body style={{ fontSize: 11, fontFamily: F.bodySemi, color: '#fff' }}>{fmtSessAt(s.scheduled_at)}</Body>
                      <Body style={{ fontSize: 9.5, color: C.muted3 }}>{prettyType(s.session_type)} · {s.trainerName}</Body>
                    </View>
                    <Badge text={cancelled ? 'cancelled' : 'completed'} color={cancelled ? C.red : C.green} />
                  </View>
                );
              })}
            </Card>
          ) : null}
        </>
      )}
    </View>
  );
}

/* ----- Reports tab — web BloodReportsSection port + QHP sheets ----- */
const statusMeta = (status: string): { color: string; label: string } => {
  const s = status.toLowerCase();
  if (s === 'high' || s === 'critical_high') return { color: C.red, label: s.replace(/_/g, ' ') };
  if (s === 'low' || s === 'critical_low' || s === 'borderline') return { color: C.gold, label: s.replace(/_/g, ' ') };
  return { color: C.green, label: s.replace(/_/g, ' ') || 'normal' };
};

function StatusPill({ status }: { status: string }) {
  const m = statusMeta(status);
  return (
    <View style={{ paddingVertical: 2, paddingHorizontal: 8, borderRadius: 999, backgroundColor: hexA(m.color, 0.12), borderWidth: 1, borderColor: hexA(m.color, 0.4) }}>
      <Text style={{ fontFamily: F.bodyBold, fontSize: 8.5, color: m.color, textTransform: 'capitalize' }}>{m.label}</Text>
    </View>
  );
}

function FlaggedPill({ n }: { n: number }) {
  if (!n) return null;
  return (
    <View style={{ paddingVertical: 2.5, paddingHorizontal: 8, borderRadius: 999, backgroundColor: hexA(C.red, 0.14), borderWidth: 1, borderColor: hexA(C.red, 0.45) }}>
      <Text style={{ fontFamily: F.bodyBold, fontSize: 8.5, color: C.red }}>{n} flagged</Text>
    </View>
  );
}

function CollapseHeader({ open, title, count, flagged, onPress, icon, sub }: { open: boolean; title: string; count?: number | null; flagged?: number; onPress: () => void; icon?: IconName; sub?: string | null }) {
  return (
    <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 11, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: open ? hexA(C.orange, 0.3) : 'rgba(255,255,255,0.08)' }}>
      <Icon name={open ? 'chevDown' : 'chevRight'} size={13} color={C.muted2} strokeWidth={2.2} />
      {icon ? <Icon name={icon} size={13} color={C.gold} strokeWidth={2} /> : null}
      <Body numberOfLines={1} style={{ flex: 1, fontSize: 12.5, fontFamily: F.bodySemi, color: '#fff' }}>{title}</Body>
      {count != null ? (
        <View style={{ paddingVertical: 2, paddingHorizontal: 7, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 8.5, color: C.muted }}>{count}</Text>
        </View>
      ) : null}
      {flagged ? <FlaggedPill n={flagged} /> : null}
      {sub ? <Mono style={{ fontSize: 8, color: C.muted3 }}>{sub}</Mono> : null}
    </Pressable>
  );
}

function MarkerRow({ name, refText, value, unit, status, prev, trend }: { name: string; refText?: string | null; value: any; unit?: string | null; status: string; prev?: number | null; trend?: string | null }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.2)' }}>
      <View style={{ flex: 1, gap: 1 }}>
        <Body numberOfLines={1} style={{ fontSize: 12, fontFamily: F.bodySemi, color: '#fff' }}>{name}</Body>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {refText ? <Body style={{ fontSize: 10, color: C.muted3 }}>Ref: {refText}</Body> : null}
          {prev != null ? (
            <Body style={{ fontSize: 10, color: C.muted3 }}>
              {trend === 'up' ? '↑ ' : trend === 'down' ? '↓ ' : ''}Prev: {prev}
            </Body>
          ) : null}
        </View>
      </View>
      <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: '#fff' }}>
        {String(value)}{unit ? <Text style={{ fontFamily: F.body, fontSize: 10, color: C.muted3 }}> {unit}</Text> : null}
      </Text>
      <StatusPill status={status} />
    </View>
  );
}

function ReportsTab({ clientId }: { clientId: string }) {
  const reportsQ = useClientReports(clientId);
  const bloodQ = useMarketingBloodReports(clientId);
  const [qhp, setQhp] = React.useState<{ row: any; label: string } | null>(null);
  const [open, setOpen] = React.useState<Record<string, boolean>>({});
  const toggle = (k: string) => setOpen((p) => ({ ...p, [k]: !p[k] }));
  const qhpRows: any[] = reportsQ.data?.qhp ?? [];
  const markers = bloodQ.data?.markers ?? [];
  const reports = bloodQ.data?.reports ?? [];

  // group markers by category, mirror the web's abnormal rule
  const grouped = new Map<string, typeof markers>();
  markers.forEach((m) => {
    const cat = m.category_name || 'Other';
    grouped.set(cat, [...(grouped.get(cat) ?? []), m]);
  });
  const categories = [...grouped.keys()].sort();
  const latestDate = markers[0]?.test_date ?? null;
  const isAbnormal = (s: string) => s.toLowerCase() !== 'normal' && s.toLowerCase() !== 'in_range';
  const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : null;

  return (
    <View style={{ gap: 12 }}>
      {/* QHP reports */}
      {qhpRows.length ? (
        <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.09)" style={{ padding: 14, gap: 9 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Icon name="heart" size={15} color={C.gold} strokeWidth={2} />
            <Serif style={{ flex: 1, fontSize: 16 }}>QHP Reports</Serif>
          </View>
          {qhpRows.map((a: any, i: number) => {
            const label = i === 0 ? 'QHP Baseline' : `QHP Refresh ${i}`;
            return (
              <Pressable key={a.id} onPress={() => setQhp({ row: a, label })} style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 9, paddingHorizontal: 11, borderRadius: 11, backgroundColor: hexA(C.gold, 0.06), borderWidth: 1, borderColor: hexA(C.gold, 0.22) }}>
                <Body style={{ flex: 1, fontSize: 12.5, color: '#fff' }}>{label}</Body>
                <Mono style={{ fontSize: 8.5, color: C.muted3 }}>{fmtDate(a.created_at)}</Mono>
                <Icon name="chevRight" size={13} color={C.gold} strokeWidth={2.2} />
              </Pressable>
            );
          })}
        </Card>
      ) : null}

      {/* Blood reports — web BloodReportsSection parity */}
      <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.09)" style={{ padding: 14, gap: 9 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Icon name="activity" size={15} color={C.blue} strokeWidth={2} />
          <Serif style={{ flex: 1, fontSize: 16 }}>Blood Reports</Serif>
          {markers.length ? (
            <View style={{ paddingVertical: 2.5, paddingHorizontal: 8, borderRadius: 999, backgroundColor: hexA(C.gold, 0.14), borderWidth: 1, borderColor: hexA(C.gold, 0.4) }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 8.5, color: C.gold }}>{markers.length} markers</Text>
            </View>
          ) : null}
        </View>
        {latestDate ? <Mono style={{ fontSize: 8.5, color: C.muted3 }}>LATEST: {fmtDate(latestDate)?.toUpperCase()}</Mono> : null}

        {bloodQ.isLoading ? (
          <View style={{ paddingVertical: 16, alignItems: 'center' }}><ActivityIndicator color={C.blue} /></View>
        ) : !markers.length && !reports.length ? (
          <Body style={{ fontSize: 12, color: C.muted3, textAlign: 'center', paddingVertical: 12 }}>No blood report data available.</Body>
        ) : (
          <>
            {/* Uploaded reports → extracted test groups → markers */}
            {reports.map((r) => {
              const rOpen = !!open[`r-${r.id}`];
              return (
                <View key={r.id} style={{ gap: 7 }}>
                  <CollapseHeader open={rOpen} title={r.report_name || 'Health Report'} icon="file" sub={fmtDate(r.upload_date) ?? undefined} count={r.tests.length ? null : undefined} onPress={() => toggle(`r-${r.id}`)} />
                  {rOpen ? (
                    r.tests.length === 0 ? (
                      <Body style={{ fontSize: 11, color: C.muted3, paddingLeft: 12 }}>No extracted data in this report.</Body>
                    ) : r.tests.map((test: any, ti: number) => {
                      const tKey = `t-${r.id}-${ti}`;
                      const tOpen = !!open[tKey];
                      const tMarkers: any[] = test.markers ?? [];
                      const flagged = tMarkers.filter((m) => markerStatusOf(m) !== 'normal').length;
                      return (
                        <View key={tKey} style={{ gap: 6, paddingLeft: 10 }}>
                          <CollapseHeader open={tOpen} title={test.test_name || test.category || `Test ${ti + 1}`} count={tMarkers.length} flagged={flagged} onPress={() => toggle(tKey)} />
                          {tOpen ? (
                            <View style={{ gap: 5, paddingLeft: 10 }}>
                              {tMarkers.map((m: any, mi: number) => (
                                <MarkerRow key={mi} name={m.name} refText={m.reference_range} value={m.value} unit={m.unit} status={markerStatusOf(m)} />
                              ))}
                            </View>
                          ) : null}
                        </View>
                      );
                    })
                  ) : null}
                </View>
              );
            })}

            {/* Marker categories from blood_report_markers */}
            {categories.map((cat) => {
              const rows = grouped.get(cat)!;
              const cOpen = !!open[`c-${cat}`];
              const flagged = rows.filter((m) => isAbnormal(m.status)).length;
              return (
                <View key={cat} style={{ gap: 6 }}>
                  <CollapseHeader open={cOpen} title={cat} count={rows.length} flagged={flagged} onPress={() => toggle(`c-${cat}`)} />
                  {cOpen ? (
                    <View style={{ gap: 5, paddingLeft: 10 }}>
                      {rows.map((m) => (
                        <MarkerRow
                          key={m.id} name={m.marker_name}
                          refText={m.reference_min != null && m.reference_max != null ? `${m.reference_min} – ${m.reference_max} ${m.unit ?? ''}`.trim() : null}
                          value={m.value} unit={m.unit} status={m.status} prev={m.previous_value} trend={m.trend}
                        />
                      ))}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </>
        )}
      </Card>

      <QhpReportSheet report={qhp?.row ?? null} label={qhp?.label} onClose={() => setQhp(null)} />
    </View>
  );
}

/* ---------------- /marketing/leads ---------------- */
const STAGE_COLORS: Record<string, string> = {
  'New': C.blue, 'Contacted': C.gold, 'Follow-up': C.gold, 'QHP Booked': '#4FD1C5', 'QHP Completed': '#4FD1C5',
  'Decision Awaiting': C.purple, 'Raise invoice': C.orange, 'Converted': C.green, 'Lost': C.red,
};

export function MarketingLeads() {
  const { session } = useAuth();
  // Marketing Admin gets the full interactive Ops Leads experience (web parity).
  if (session?.user?.id === MARKETING_ADMIN_ID) return <OpsLeads />;
  return <MarketingLeadsReadOnly />;
}

function MarketingLeadsReadOnly() {
  const [page, setPage] = React.useState(1);
  const [search, setSearch] = React.useState('');
  const statsQ = useLeadStats();
  const listQ = useLeadsList({ search, sortBy: 'created_at', sortDir: 'desc', page, pageSize: 25 });
  const rows = listQ.data?.rows ?? [];
  const total = listQ.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / 25));
  const st = statsQ.data;
  return (
    <Page gap={13}>
      <TitleBlock title="Leads" sub="Read-only view of the sales pipeline" />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <KpiCard label="Total" value={String(st?.total ?? '…')} color={C.blue} icon="users" />
        <KpiCard label="New (7d)" value={String(st?.newThisWeek ?? '…')} color={C.gold} icon="userPlus" />
        <KpiCard label="Pipeline" value={String(st?.activePipeline ?? '…')} color={C.purple} icon="layers" />
        <KpiCard label="Conv %" value={st ? `${st.conversionRate}%` : '…'} color={C.green} icon="trend" />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 13, paddingVertical: 10, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)' }}>
        <Icon name="search" size={15} color={C.muted3} strokeWidth={2} />
        <TextInput value={search} onChangeText={(t) => { setSearch(t); setPage(1); }} placeholder="Search leads…" placeholderTextColor={C.muted3} style={{ flex: 1, fontFamily: F.body, fontSize: 14, color: '#fff', padding: 0 }} />
      </View>
      {listQ.isLoading ? (
        <View style={{ paddingVertical: 26, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View>
      ) : rows.length === 0 ? (
        <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 22 }}>No leads found.</Body>
      ) : rows.map((l: any) => (
        <Card key={l.id} colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.09)" radius={14} style={{ padding: 12, gap: 7 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Body numberOfLines={1} style={{ flex: 1, fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{l.name}</Body>
            <Badge text={l.stage} color={STAGE_COLORS[l.stage] ?? C.muted2} />
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {l.source ? <Badge text={l.source} color={C.blue} /> : null}
            {l.influencer ? <Badge text={`Inf · ${l.influencer}`} color={C.purple} /> : null}
            {l.ads_creative ? <Badge text={`Ad · ${l.ads_creative}`} color={C.gold} /> : null}
            {l.lead_date ? (
              <Mono style={{ fontSize: 9, color: C.muted3, alignSelf: 'center' }}>
                {new Date(l.lead_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
              </Mono>
            ) : null}
          </View>
        </Card>
      ))}
      {totalPages > 1 ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Pressable disabled={page <= 1} onPress={() => setPage((p) => p - 1)} style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.04)', opacity: page <= 1 ? 0.4 : 1 }}>
            <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: C.orange }}>Previous</Text>
          </Pressable>
          <Mono style={{ fontSize: 9, color: C.muted3 }}>PAGE {page}/{totalPages}</Mono>
          <Pressable disabled={page >= totalPages} onPress={() => setPage((p) => p + 1)} style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.04)', opacity: page >= totalPages ? 0.4 : 1 }}>
            <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: C.orange }}>Next</Text>
          </Pressable>
        </View>
      ) : null}
    </Page>
  );
}

/* ---------------- /marketing/leads-analytics (web LeadsAnalytics port) ---------------- */
// Semantic stage colors (web STAGE_COLORS parity + live stages).
const ANALYTICS_STAGE_COLORS: Record<string, string> = {
  'New': '#38BDF8', 'Not Picked': '#94A3B8', 'Follow Up': '#F59E0B', 'Follow-up': '#F59E0B',
  'Potential': C.purple, 'QHP Booked': '#3B5BDB', 'QHP Completed': '#14B8A6', 'Converted': C.green,
  'Lost': C.red, 'Trial': '#38BDF8', 'Raise invoice': '#EC4899', 'Contacted': C.gold,
  'Decision Awaiting': C.purple, 'Unknown': '#94A3B8',
};
const PALETTE = ['#3B5BDB', C.orange, C.green, C.purple, '#14B8A6', C.red, '#F59E0B', '#38BDF8', '#EC4899', '#94A3B8'];
const stageCol = (name: string, i: number) => ANALYTICS_STAGE_COLORS[name] ?? PALETTE[i % PALETTE.length];

const ymd = (d: Date) => {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};
const prettyDate = (s: string) => {
  const d = new Date(`${s}T00:00:00`);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};
const dayLabel = (s: string) => {
  const d = new Date(`${s}T00:00:00`);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
};
type Grouped = { name: string; value: number }[];
const groupCount = (rows: any[], key: string, fallback = 'Unknown'): Grouped => {
  const m = new Map<string, number>();
  rows.forEach((r) => { const k = (r[key] as string | null) || fallback; m.set(k, (m.get(k) ?? 0) + 1); });
  return [...m.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
};

/* SVG line chart — daily new leads. Width comes from onLayout. */
function LeadsOverTime({ data }: { data: { date: string; value: number }[] }) {
  const [w, setW] = React.useState(0);
  const H = 150, padL = 26, padB = 22, padT = 8, padR = 6;
  const iw = Math.max(1, w - padL - padR), ih = H - padT - padB;
  const max = Math.max(1, ...data.map((d) => d.value));
  const stepX = data.length > 1 ? iw / (data.length - 1) : 0;
  const x = (i: number) => padL + i * stepX;
  const y = (v: number) => padT + ih - (v / max) * ih;
  const pts = data.map((d, i) => `${x(i)},${y(d.value)}`).join(' ');
  const areaPts = data.length ? `${padL},${padT + ih} ${pts} ${x(data.length - 1)},${padT + ih}` : '';
  const gridVals = [0, Math.round(max / 2), max];
  const labelEvery = Math.max(1, Math.ceil(data.length / 6));
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ height: H }}>
      {w > 0 && data.length > 0 ? (
        <Svg width={w} height={H}>
          {gridVals.map((gv, i) => {
            const gy = y(gv);
            return (
              <React.Fragment key={i}>
                <SvgLine x1={padL} y1={gy} x2={w - padR} y2={gy} stroke="rgba(255,255,255,0.08)" strokeWidth={1} strokeDasharray="3 3" />
                <SvgText x={padL - 5} y={gy + 3} fill={C.muted3} fontSize={8} textAnchor="end">{gv}</SvgText>
              </React.Fragment>
            );
          })}
          {areaPts ? <Polyline points={areaPts} fill={hexA(C.orange, 0.12)} stroke="none" /> : null}
          <Polyline points={pts} fill="none" stroke={C.orange} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {data.map((d, i) => (i % labelEvery === 0 || i === data.length - 1) ? (
            <SvgText key={i} x={x(i)} y={H - 6} fill={C.muted3} fontSize={7.5} textAnchor="middle">{dayLabel(d.date).replace(' ', ' ')}</SvgText>
          ) : null)}
        </Svg>
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={C.orange} /></View>
      )}
    </View>
  );
}

/* Vertical bar chart (By Source / By Stage). Bars tappable when onPick given. */
function VBars({ data, colorFor, selected, onPick }: { data: Grouped; colorFor: (name: string, i: number) => string; selected?: string | null; onPick?: (name: string) => void }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 168, paddingTop: 6 }}>
      {data.map((d, i) => {
        const dim = selected && selected !== d.name;
        const inner = (
          <View style={{ flex: 1, alignItems: 'center', gap: 4, opacity: dim ? 0.4 : 1 }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 9, color: colorFor(d.name, i) }}>{d.value}</Text>
            <View style={{ flex: 1, justifyContent: 'flex-end' }}>
              <View style={{ width: 22, borderTopLeftRadius: 5, borderTopRightRadius: 5, height: Math.max(3, (d.value / max) * 120), backgroundColor: colorFor(d.name, i), borderWidth: selected === d.name ? 1.5 : 0, borderColor: '#fff' }} />
            </View>
            <Text numberOfLines={2} style={{ fontFamily: F.body, fontSize: 7.5, color: C.muted3, textAlign: 'center', width: 40, height: 20 }}>{d.name}</Text>
          </View>
        );
        return onPick ? (
          <Pressable key={d.name} onPress={() => onPick(d.name)} style={{ flex: 1 }}>{inner}</Pressable>
        ) : (
          <View key={d.name} style={{ flex: 1 }}>{inner}</View>
        );
      })}
    </View>
  );
}

/* Horizontal bar chart (By Ad Source). */
function HBars({ data, color }: { data: Grouped; color: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <View style={{ gap: 8 }}>
      {data.map((d) => (
        <View key={d.name} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Body numberOfLines={1} style={{ width: 78, fontSize: 10, color: C.ink3, textAlign: 'right' }}>{d.name}</Body>
          <View style={{ flex: 1, height: 16, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.04)', overflow: 'hidden', justifyContent: 'center' }}>
            <View style={{ width: `${(d.value / max) * 100}%`, minWidth: 3, height: 16, borderRadius: 5, backgroundColor: color }} />
          </View>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 10, color, width: 30 }}>{d.value}</Text>
        </View>
      ))}
    </View>
  );
}

const RANGE_PRESETS = [
  { key: '7', label: 'Last 7 days', days: 6 },
  { key: '30', label: 'Last 30 days', days: 29 },
  { key: 'month', label: 'This month', days: -1 },
] as const;

const QUALIFIED_LEADS_ROWS: [string, number, number, number, number, number, number, number][] = [
  ['Nov 2024', 6, 3, 4, 4, 2, 19, 187], ['Dec 2024', 2, 7, 6, 4, 0, 19, 128], ['Jan 2025', 2, 12, 14, 4, 0, 32, 158],
  ['Feb 2025', 2, 10, 8, 4, 0, 24, 157], ['March 2025', 7, 8, 7, 5, 0, 27, 262], ['April 2025', 6, 11, 14, 9, 0, 40, 282],
  ['May 2025', 6, 11, 5, 6, 0, 28, 259], ['June 2025', 7, 9, 10, 7, 3, 36, 236], ['July 2025', 10, 12, 14, 20, 1, 57, 344],
  ['August 2025', 9, 7, 5, 13, 2, 36, 242], ['September 2025', 2, 5, 8, 15, 0, 32, 277], ['October 2025', 1, 1, 10, 3, 2, 17, 177],
  ['November 2025', 1, 5, 4, 3, 1, 14, 175], ['December 2025', 1, 13, 6, 6, 1, 27, 146], ['January 2026', 1, 19, 9, 3, 2, 34, 185],
  ['Feb 2026', 3, 16, 8, 2, 0, 29, 134], ['March 2026', 2, 22, 5, 3, 1, 33, 130], ['April 2026', 2, 8, 4, 7, 3, 24, 147],
];
const CONVERSION_ROWS: [string, number, number, number, number, number, number][] = [
  ['Aug 2024', 7, 2, 1, 4, 0, 14], ['Sept 2024', 5, 5, 4, 1, 0, 15], ['Oct 2024', 2, 2, 3, 0, 1, 8], ['Nov 2024', 2, 4, 3, 0, 1, 10],
  ['Dec 2024', 2, 7, 3, 0, 0, 12], ['Jan 2025', 0, 9, 2, 0, 0, 11], ['Feb 2025', 2, 10, 1, 0, 0, 13], ['March 2025', 4, 9, 1, 1, 0, 15],
  ['April 2025', 4, 9, 5, 2, 0, 20], ['May 2025', 5, 11, 0, 0, 0, 16], ['June 2025', 3, 9, 2, 0, 0, 14], ['July 2025', 7, 10, 4, 1, 0, 22],
  ['August 2025', 4, 7, 1, 1, 1, 14], ['September 2025', 2, 5, 6, 5, 0, 18], ['October 2025', 1, 6, 2, 1, 0, 10], ['November 2025', 1, 9, 1, 0, 0, 11],
  ['December 2025', 1, 10, 2, 2, 0, 15], ['January 2026', 1, 19, 4, 1, 0, 25], ['February 2026', 2, 16, 2, 1, 0, 21], ['March 2026', 2, 22, 4, 2, 0, 30],
  ['April 2026', 1, 13, 2, 0, 0, 15], ['May 2026', 1, 9, 1, 1, 0, 25],
];

function HistTable({ headers, rows, boldFrom }: { headers: string[]; rows: (string | number)[][]; boldFrom: number }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View>
        <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.1)', paddingBottom: 6 }}>
          {headers.map((h, i) => (
            <Text key={h} style={{ width: i === 0 ? 96 : 74, fontFamily: F.bodyBold, fontSize: 8.5, color: i >= boldFrom ? C.orange : C.muted2, textAlign: i === 0 ? 'left' : 'right' }}>{h}</Text>
          ))}
        </View>
        {rows.map((r, ri) => (
          <View key={ri} style={{ flexDirection: 'row', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.04)' }}>
            {r.map((cell, ci) => (
              <Text key={ci} style={{ width: ci === 0 ? 96 : 74, fontFamily: ci === 0 || ci >= boldFrom ? F.bodySemi : F.body, fontSize: 10, color: ci === 0 ? '#fff' : ci >= boldFrom ? C.ink2 : C.muted, textAlign: ci === 0 ? 'left' : 'right' }}>{cell}</Text>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const AnalyticsCard = ({ title, sub, children, right }: { title: string; sub?: string; children: React.ReactNode; right?: React.ReactNode }) => (
  <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.09)" style={{ padding: 14, gap: 10 }}>
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Serif style={{ fontSize: 16 }}>{title}</Serif>
        {sub ? <Body style={{ fontSize: 10.5, color: C.muted3 }}>{sub}</Body> : null}
      </View>
      {right}
    </View>
    {children}
  </Card>
);

export function MarketingLeadAnalytics() {
  const [preset, setPreset] = React.useState<'7' | '30' | 'month'>('30');
  const range = React.useMemo(() => {
    const end = new Date();
    let start: Date;
    if (preset === 'month') start = new Date(end.getFullYear(), end.getMonth(), 1);
    else start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - (preset === '7' ? 6 : 29));
    return { start: ymd(start), end: ymd(end) };
  }, [preset]);

  const q = useLeadsAnalytics(range.start, range.end);
  const rows = q.data?.rows ?? [];
  const convertedRows = q.data?.convertedRows ?? [];
  const [selectedStage, setSelectedStage] = React.useState<string | null>(null);

  const overTime = React.useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach((r) => { if (r.lead_date) m.set(r.lead_date, (m.get(r.lead_date) ?? 0) + 1); });
    return [...m.entries()].map(([date, value]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date));
  }, [rows]);
  const bySource = React.useMemo(() => groupCount(rows, 'source'), [rows]);
  const byAdSource = React.useMemo(() => groupCount(rows.filter((r) => r.source === 'Instagram'), 'ads_creative', 'Not specified').slice(0, 12), [rows]);
  const byStage = React.useMemo(() => {
    const base = groupCount(rows.filter((r) => r.stage !== 'Converted'), 'stage');
    if (convertedRows.length) base.push({ name: 'Converted', value: convertedRows.length });
    return base.sort((a, b) => b.value - a.value);
  }, [rows, convertedRows]);

  React.useEffect(() => {
    if (selectedStage && !byStage.find((s) => s.name === selectedStage)) setSelectedStage(null);
  }, [byStage, selectedStage]);

  const stageSources = React.useMemo(() => {
    if (!selectedStage) return [];
    const subset = selectedStage === 'Converted' ? convertedRows : rows.filter((r) => (r.stage || 'Unknown') === selectedStage);
    return groupCount(subset, 'source');
  }, [rows, convertedRows, selectedStage]);

  return (
    <Page gap={13}>
      <TitleBlock title="Leads Analytics" sub={q.isLoading ? 'Loading…' : `${rows.length} leads between ${prettyDate(range.start)} and ${prettyDate(range.end)}.`} />

      {/* Range presets */}
      <View style={{ flexDirection: 'row', gap: 7 }}>
        {RANGE_PRESETS.map((p) => {
          const on = preset === p.key;
          return (
            <Pressable key={p.key} onPress={() => setPreset(p.key as any)} style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 11, backgroundColor: on ? hexA(C.orange, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: on ? hexA(C.orange, 0.5) : 'rgba(255,255,255,0.09)' }}>
              <Text style={{ fontFamily: on ? F.bodyBold : F.bodySemi, fontSize: 11, color: on ? C.orange : C.muted }}>{p.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {q.isLoading ? (
        <View style={{ paddingVertical: 40, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View>
      ) : q.isError ? (
        <Body style={{ fontSize: 12, color: C.red, textAlign: 'center', paddingVertical: 20 }}>{(q.error as Error).message}</Body>
      ) : (
        <>
          <AnalyticsCard title="Leads over time" sub="Daily new leads in the selected range.">
            {overTime.length ? <LeadsOverTime data={overTime} /> : <Body style={{ fontSize: 11, color: C.muted3, textAlign: 'center', paddingVertical: 24 }}>No leads in this range.</Body>}
          </AnalyticsCard>

          <AnalyticsCard title="By Source" sub="Where leads are coming from.">
            {bySource.length ? <VBars data={bySource} colorFor={() => '#3B5BDB'} /> : <Body style={{ fontSize: 11, color: C.muted3, textAlign: 'center', paddingVertical: 20 }}>No data.</Body>}
          </AnalyticsCard>

          <AnalyticsCard
            title="By Stage"
            sub={selectedStage ? `Showing sources for "${selectedStage}".` : 'Tap a bar to see lead sources for that stage.'}
            right={selectedStage ? (
              <Pressable onPress={() => setSelectedStage(null)} hitSlop={8}><Mono style={{ fontSize: 9, color: C.orange }}>CLEAR</Mono></Pressable>
            ) : undefined}
          >
            {byStage.length ? (
              <VBars data={byStage} colorFor={stageCol} selected={selectedStage} onPick={(name) => setSelectedStage((prev) => (prev === name ? null : name))} />
            ) : <Body style={{ fontSize: 11, color: C.muted3, textAlign: 'center', paddingVertical: 20 }}>No data.</Body>}
          </AnalyticsCard>

          {selectedStage ? (
            <AnalyticsCard title={`Sources — ${selectedStage}`} sub={`${stageSources.reduce((s, r) => s + r.value, 0)} leads · source breakdown for the selected stage.`}>
              {stageSources.length ? <VBars data={stageSources} colorFor={() => stageCol(selectedStage, 0)} /> : <Body style={{ fontSize: 11, color: C.muted3, textAlign: 'center', paddingVertical: 18 }}>No leads for this stage in range.</Body>}
            </AnalyticsCard>
          ) : null}

          <AnalyticsCard title="By Ad Source" sub="Ads creative attribution for Instagram leads.">
            {byAdSource.length ? <HBars data={byAdSource} color={C.orange} /> : <Body style={{ fontSize: 11, color: C.muted3, textAlign: 'center', paddingVertical: 18 }}>No Instagram ad leads in this range.</Body>}
          </AnalyticsCard>

          <AnalyticsCard title="Qualified Leads (Historical)" sub="Hard-coded monthly qualified-leads breakdown by source.">
            <HistTable
              headers={['Month', 'Influencer', 'Client Ref', 'IG+WA', 'Direct', 'Google', 'Qualified', 'Total']}
              rows={QUALIFIED_LEADS_ROWS.map((r) => [...r])}
              boldFrom={6}
            />
          </AnalyticsCard>

          <AnalyticsCard title="Conversion Data (Historical)" sub="Hard-coded monthly new-client conversions by source.">
            <HistTable
              headers={['Month', 'Influencer', 'Referral', 'Instagram', 'Direct', 'Google', 'New Client']}
              rows={CONVERSION_ROWS.map((r) => [...r])}
              boldFrom={6}
            />
          </AnalyticsCard>
        </>
      )}
    </Page>
  );
}

