import React from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Modal, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C, F, hexA, ORANGE_GRAD } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono, Card, ProgressBar } from '../components/primitives';
import { Page, TitleBlock, HScroll, BackLink } from './common';
import { useStore } from '../store';
import {
  useDailyGoalsAnalyser, dgBand, DgTrainer,
  useWeeklySummary, wkBand, WkTrainer,
} from '../lib/academyAnalyserQueries';
import { prettyDate } from '../lib/academyQueries';

const ACC = '#6EA8FE';
const bandColor = (b: string) =>
  b === 'critical' || b === 'focus' ? C.red : b === 'warning' || b === 'ontrack' ? C.gold : C.green;
const bandLabel = (b: string) =>
  b === 'critical' ? 'Critical' : b === 'warning' ? 'Warning' : b === 'good' ? 'Good'
  : b === 'excellent' ? 'Excellent' : b === 'ontrack' ? 'On track' : 'Needs focus';

/* ============================================================================
   Daily Goals Analyser — are trainers logging sleep, steps and nutrition?
   ========================================================================== */
export function AcademyDailyGoals() {
  const { back, canGoBack, go } = useStore();
  const q = useDailyGoalsAnalyser();
  const [search, setSearch] = React.useState('');
  const [band, setBand] = React.useState<'all' | 'critical' | 'warning' | 'good'>('all');
  const [openFor, setOpenFor] = React.useState<DgTrainer | null>(null);

  const d = q.data;
  const rows = (d?.trainers ?? [])
    .filter((t) => band === 'all' || dgBand(t.pct) === band)
    .filter((t) => !search.trim() || t.name.toLowerCase().includes(search.trim().toLowerCase()));
  const counts = React.useMemo(() => {
    const c = { critical: 0, warning: 0, good: 0 };
    (d?.trainers ?? []).forEach((t) => { c[dgBand(t.pct)]++; });
    return c;
  }, [d?.trainers]);
  const heroCol = bandColor(dgBand(d?.overallPct ?? 0));

  return (
    <Page gap={12} pt={6}>
      <BackLink label="Back to Academy" onPress={() => (canGoBack ? back() : go('academy-dashboard'))} />
      <TitleBlock title="Daily Goals Analyser" sub="Sleep, steps and nutrition logging compliance" />

      {q.isPending ? <ActivityIndicator color={ACC} style={{ paddingVertical: 34 }} />
        : q.isError ? <Body style={{ fontSize: 12, color: C.red, textAlign: 'center', paddingVertical: 22 }}>{(q.error as Error).message}</Body>
        : (
        <>
          {/* Hero */}
          <Card colors={[hexA(heroCol, 0.1), 'rgba(16,16,20,0.6)']} border={hexA(heroCol, 0.3)} radius={18} style={{ padding: 17, gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 13 }}>
              <View style={{ flex: 1 }}>
                <Mono style={{ fontSize: 8.5, letterSpacing: 1, color: C.mono2 }}>OVERALL COMPLIANCE</Mono>
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 3 }}>
                  <Serif style={{ fontSize: 38, color: heroCol }}>{d?.overallPct ?? 0}%</Serif>
                  <Body style={{ fontSize: 11, color: C.muted2, marginBottom: 8 }}>
                    {(d?.totalLogged ?? 0).toLocaleString()} of {(d?.totalPoints ?? 0).toLocaleString()} logged
                  </Body>
                </View>
              </View>
            </View>
            <ProgressBar pct={d?.overallPct ?? 0} height={7} fill={heroCol} />
            <Body style={{ fontSize: 10, color: C.muted3 }}>
              Last {d?.days} completed days ({prettyDate(d?.from ?? null)} to {prettyDate(d?.to ?? null)}) · 3 metrics per client per day
            </Body>
          </Card>

          {/* Search */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)' }}>
            <Icon name="search" size={14} color={C.muted3} strokeWidth={2} />
            <TextInput value={search} onChangeText={setSearch} placeholder="Search trainer…" placeholderTextColor={C.muted3} autoCorrect={false} style={{ flex: 1, fontFamily: F.body, fontSize: 13.5, color: '#fff', padding: 0 }} />
          </View>

          {/* Severity chips */}
          <HScroll gap={7}>
            {([['all', 'All', (d?.trainers ?? []).length, ACC], ['critical', 'Critical', counts.critical, C.red], ['warning', 'Warning', counts.warning, C.gold], ['good', 'Good', counts.good, C.green]] as const).map(([id, lab, n, col]) => {
              const on = band === id;
              return (
                <Pressable key={id} onPress={() => setBand(id as any)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 7, paddingHorizontal: 13, borderRadius: 999, backgroundColor: on ? hexA(col, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: on ? hexA(col, 0.5) : 'rgba(255,255,255,0.09)' }}>
                  <Text style={{ fontFamily: on ? F.bodyBold : F.bodySemi, fontSize: 11.5, color: on ? col : C.muted }}>{lab}</Text>
                  <Mono style={{ fontSize: 9, color: on ? col : C.muted3 }}>{n}</Mono>
                </Pressable>
              );
            })}
          </HScroll>

          {rows.length === 0 ? (
            <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 26 }}>No trainers match these filters.</Body>
          ) : rows.map((t) => {
            const col = bandColor(dgBand(t.pct));
            return (
              <Pressable key={t.trainerId} onPress={() => setOpenFor(t)} style={{ padding: 13, borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: hexA(col, 0.2), gap: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                  <View style={{ flex: 1 }}>
                    <Body numberOfLines={1} style={{ fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }}>{t.name}</Body>
                    <Mono style={{ fontSize: 8.5, color: C.muted3, marginTop: 2 }}>{t.clients} CLIENT{t.clients === 1 ? '' : 'S'} · {t.logged}/{t.total} POINTS</Mono>
                  </View>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 17, color: col }}>{t.pct}%</Text>
                  <Icon name="chevRight" size={14} color={C.muted3} strokeWidth={2.3} />
                </View>
                <View style={{ flexDirection: 'row', gap: 7 }}>
                  {([['Sleep', t.sleepPct], ['Steps', t.stepsPct], ['Nutr', t.nutritionPct]] as const).map(([lab, p]) => (
                    <View key={lab} style={{ flex: 1, gap: 3 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Mono style={{ fontSize: 7.5, color: C.muted3 }}>{lab.toUpperCase()}</Mono>
                        <Mono style={{ fontSize: 8, color: bandColor(dgBand(p)) }}>{p}%</Mono>
                      </View>
                      <View style={{ height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
                        <View style={{ width: `${p}%`, height: 4, borderRadius: 2, backgroundColor: bandColor(dgBand(p)) }} />
                      </View>
                    </View>
                  ))}
                </View>
              </Pressable>
            );
          })}
        </>
      )}

      {/* Trainer detail */}
      <Modal visible={!!openFor} transparent animationType="slide" onRequestClose={() => setOpenFor(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end' }}>
          <Pressable style={{ flex: 1 }} onPress={() => setOpenFor(null)} />
          <View style={{ maxHeight: '84%', backgroundColor: '#12131A', borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: hexA(ACC, 0.18), paddingHorizontal: 18, paddingTop: 16, paddingBottom: 26 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <View style={{ flex: 1 }}>
                <Serif style={{ fontSize: 18 }} numberOfLines={1}>{openFor?.name}</Serif>
                <Body style={{ fontSize: 11, color: C.muted2 }}>{openFor?.clients} clients · {openFor?.pct}% compliance · worst first</Body>
              </View>
              <Pressable onPress={() => setOpenFor(null)} hitSlop={10} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="close" size={13} color={C.muted2} strokeWidth={2.3} />
              </Pressable>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} nestedScrollEnabled>
              {(openFor?.perClient ?? []).map((c, i) => {
                const days = d?.days ?? 7;
                const pill = (lab: string, n: number) => {
                  const col = n === 0 ? C.red : n < days ? C.gold : C.green;
                  return (
                    <View key={lab} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 999, backgroundColor: hexA(col, 0.1), borderWidth: 1, borderColor: hexA(col, 0.3) }}>
                      <Mono style={{ fontSize: 7.5, color: C.muted3 }}>{lab}</Mono>
                      <Text style={{ fontFamily: F.bodyBold, fontSize: 10, color: col }}>{n}/{days}</Text>
                    </View>
                  );
                };
                return (
                  <View key={c.clientId} style={{ paddingVertical: 10, gap: 7, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: 'rgba(255,255,255,0.05)' }}>
                    <Body numberOfLines={1} style={{ fontSize: 13, fontFamily: F.bodySemi, color: '#fff' }}>{c.name}</Body>
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      {pill('SLEEP', c.sleep)}
                      {pill('STEPS', c.steps)}
                      {pill('NUTR', c.nutrition)}
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </Page>
  );
}

/* ============================================================================
   Weekly Summary Analyser — read rates on the AI weekly summary.
   ========================================================================== */
export function AcademyWeeklySummary() {
  const { back, canGoBack, go } = useStore();
  const [week, setWeek] = React.useState<string | 'latest'>('latest');
  const [tab, setTab] = React.useState<'trainers' | 'clients'>('trainers');
  const [clientFilter, setClientFilter] = React.useState<'all' | 'read' | 'unread'>('all');
  const q = useWeeklySummary(week);
  const d = q.data;

  const clientRows = (d?.clientRows ?? []).filter((r) =>
    clientFilter === 'all' ? true : clientFilter === 'read' ? r.clientRead : !r.clientRead
  );
  const heroCol = bandColor(wkBand(d?.clientReadPct ?? 0));

  return (
    <Page gap={12} pt={6}>
      <BackLink label="Back to Academy" onPress={() => (canGoBack ? back() : go('academy-dashboard'))} />
      <TitleBlock title="Weekly Summary" sub="Who is reading the AI weekly summary" />

      {/* Week selector */}
      <HScroll gap={7}>
        <Pressable onPress={() => setWeek('latest')} style={{ paddingVertical: 7, paddingHorizontal: 13, borderRadius: 999, backgroundColor: week === 'latest' ? hexA(ACC, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: week === 'latest' ? hexA(ACC, 0.5) : 'rgba(255,255,255,0.09)' }}>
          <Text style={{ fontFamily: week === 'latest' ? F.bodyBold : F.bodySemi, fontSize: 11.5, color: week === 'latest' ? ACC : C.muted }}>Latest per client</Text>
        </Pressable>
        {(d?.weeks ?? []).slice(0, 8).map((w) => {
          const on = week === w;
          return (
            <Pressable key={w} onPress={() => setWeek(w)} style={{ paddingVertical: 7, paddingHorizontal: 13, borderRadius: 999, backgroundColor: on ? hexA(C.purple, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: on ? hexA(C.purple, 0.5) : 'rgba(255,255,255,0.09)' }}>
              <Text style={{ fontFamily: on ? F.bodyBold : F.bodySemi, fontSize: 11.5, color: on ? C.purple : C.muted }}>{prettyDate(w)}</Text>
            </Pressable>
          );
        })}
      </HScroll>

      {q.isPending ? <ActivityIndicator color={ACC} style={{ paddingVertical: 34 }} />
        : q.isError ? <Body style={{ fontSize: 12, color: C.red, textAlign: 'center', paddingVertical: 22 }}>{(q.error as Error).message}</Body>
        : (
        <>
          {/* Hero read rates */}
          <View style={{ flexDirection: 'row', gap: 9 }}>
            {([['Clients read', d?.clientReadPct ?? 0, `${d?.clientReadCount ?? 0}/${d?.totalRows ?? 0}`], ['Trainers read', d?.trainerReadPct ?? 0, 'of assigned rows']] as const).map(([lab, pct, sub]) => {
              const col = bandColor(wkBand(pct));
              return (
                <Card key={lab} colors={[hexA(col, 0.09), 'rgba(16,16,20,0.6)']} border={hexA(col, 0.28)} radius={16} style={{ flex: 1, padding: 14, gap: 7 }}>
                  <Mono style={{ fontSize: 8, letterSpacing: 0.9, color: C.mono2 }}>{lab.toUpperCase()}</Mono>
                  <Serif style={{ fontSize: 30, color: col }}>{pct}%</Serif>
                  <ProgressBar pct={pct} height={5} fill={col} />
                  <Mono style={{ fontSize: 8, color: C.muted3 }}>{sub}</Mono>
                </Card>
              );
            })}
          </View>
          <Body style={{ fontSize: 10, color: C.muted3, textAlign: 'center', marginTop: -4 }}>
            {week === 'latest' ? 'Each client’s most recent summary week' : `Week of ${prettyDate(week as string)}`} · last 12 weeks in scope
          </Body>

          {/* Tabs */}
          <View style={{ flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 999, padding: 3 }}>
            {([['trainers', `Trainers (${(d?.trainers ?? []).length})`], ['clients', `Clients (${d?.totalRows ?? 0})`]] as const).map(([id, lab]) => {
              const on = tab === id;
              return on ? (
                <LinearGradient key={id} colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 999 }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: '#fff' }}>{lab}</Text>
                </LinearGradient>
              ) : (
                <Pressable key={id} onPress={() => setTab(id)} style={{ flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 999 }}>
                  <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: C.muted }}>{lab}</Text>
                </Pressable>
              );
            })}
          </View>

          {tab === 'trainers' ? (
            (d?.trainers ?? []).length === 0 ? (
              <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 26 }}>No trainer acknowledgements in this window.</Body>
            ) : (d?.trainers ?? []).map((t: WkTrainer, i) => {
              const col = bandColor(wkBand(t.pct));
              return (
                <View key={t.trainerId} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: 12, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: hexA(col, 0.18) }}>
                  <Mono style={{ width: 20, fontSize: 11, color: i < 3 ? C.gold : C.muted3 }}>{i + 1}</Mono>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Body numberOfLines={1} style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{t.name}</Body>
                    <ProgressBar pct={t.pct} height={4} fill={col} />
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: col }}>{t.pct}%</Text>
                    <Mono style={{ fontSize: 8, color: C.muted3 }}>{t.read}/{t.total}</Mono>
                  </View>
                </View>
              );
            })
          ) : (
            <>
              <View style={{ flexDirection: 'row', gap: 7 }}>
                {([['all', 'All', d?.totalRows ?? 0, ACC], ['read', 'Read', d?.clientReadCount ?? 0, C.green], ['unread', 'Unread', (d?.totalRows ?? 0) - (d?.clientReadCount ?? 0), C.red]] as const).map(([id, lab, n, col]) => {
                  const on = clientFilter === id;
                  return (
                    <Pressable key={id} onPress={() => setClientFilter(id as any)} style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 11, backgroundColor: on ? hexA(col, 0.14) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: on ? hexA(col, 0.45) : 'rgba(255,255,255,0.09)' }}>
                      <Text style={{ fontFamily: on ? F.bodyBold : F.bodySemi, fontSize: 11.5, color: on ? col : C.muted }}>{lab}</Text>
                      <Mono style={{ fontSize: 8.5, color: on ? col : C.muted3 }}>{n}</Mono>
                    </Pressable>
                  );
                })}
              </View>
              {clientRows.length === 0 ? (
                <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 26 }}>No summaries match this filter.</Body>
              ) : clientRows.slice(0, 200).map((r) => (
                <View key={`${r.clientId}-${r.weekStart}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: r.clientRead ? hexA(C.green, 0.18) : 'rgba(255,255,255,0.07)' }}>
                  <View style={{ flex: 1 }}>
                    <Body numberOfLines={1} style={{ fontSize: 13, fontFamily: F.bodySemi, color: '#fff' }}>{r.name}</Body>
                    <Mono style={{ fontSize: 8, color: C.muted3, marginTop: 2 }}>
                      WEEK {prettyDate(r.weekStart).toUpperCase()}{r.acknowledgedAt ? ` · READ ${prettyDate(r.acknowledgedAt.slice(0, 10)).toUpperCase()}` : ''}
                    </Mono>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 3 }}>
                    <View style={{ paddingVertical: 3, paddingHorizontal: 9, borderRadius: 999, backgroundColor: hexA(r.clientRead ? C.green : C.red, 0.13), borderWidth: 1, borderColor: hexA(r.clientRead ? C.green : C.red, 0.35) }}>
                      <Text style={{ fontFamily: F.bodyBold, fontSize: 9.5, color: r.clientRead ? C.green : C.red }}>{r.clientRead ? 'Client read' : 'Unread'}</Text>
                    </View>
                    <Mono style={{ fontSize: 7.5, color: r.trainerRead ? C.green : C.muted3 }}>{r.trainerRead ? 'TRAINER READ' : 'TRAINER PENDING'}</Mono>
                  </View>
                </View>
              ))}
              {clientRows.length > 200 ? (
                <Body style={{ fontSize: 10.5, color: C.muted3, textAlign: 'center' }}>Showing the first 200 of {clientRows.length}.</Body>
              ) : null}
            </>
          )}
        </>
      )}
    </Page>
  );
}
