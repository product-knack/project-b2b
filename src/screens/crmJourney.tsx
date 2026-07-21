import React from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator, Alert } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C, F, hexA, ORANGE_GRAD } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono, Card, ProgressBar } from '../components/primitives';
import { Page, BackLink, Badge, MiniAvatar, AnimChip } from './common';
import { useStore } from '../store';
import { useAuth } from '../auth';
import {
  useJourneyClients, useToggleJourneyStep, JOURNEY_CATEGORIES, ALL_STEP_KEYS,
  journeyProgress, journeyDone, journeyComplete, JourneyClient,
} from '../lib/journeyQueries';

/* ============ CRM: Client Journey — mirrors the web ClientJourney /
   ClientJourneyRoadmap: onboarding checklist per client, live toggles. ============ */

const initials = (n: string) => n.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
const AVS: [string, string][] = [['#F0883E', '#C05621'], ['#4FD1C5', '#2C7A7B'], ['#B794F4', '#6B46C1'], ['#F687B3', '#B83280'], ['#68D391', '#276749'], ['#63B3ED', '#2B6CB0']];

type Filter = 'all' | 'completed' | 'in_progress' | 'not_started';

/* ================= LIST ================= */
export function CrmJourney() {
  const { go, set } = useStore();
  const { session } = useAuth();
  const crmId = session?.user?.id ?? null;
  const clientsQ = useJourneyClients(crmId);
  const [filter, setFilter] = React.useState<Filter>('all');
  const [query, setQuery] = React.useState('');

  const clients = clientsQ.data ?? [];
  const stateOf = (c: JourneyClient): Filter => {
    if (journeyComplete(c.journey)) return 'completed';
    if (journeyProgress(c.journey) > 0) return 'in_progress';
    return 'not_started';
  };
  const counts = {
    completed: clients.filter((c) => stateOf(c) === 'completed').length,
    in_progress: clients.filter((c) => stateOf(c) === 'in_progress').length,
    not_started: clients.filter((c) => stateOf(c) === 'not_started').length,
  };
  const q = query.trim().toLowerCase();
  const list = clients
    .filter((c) => filter === 'all' || stateOf(c) === filter)
    .filter((c) => !q || c.name.toLowerCase().includes(q))
    .sort((a, b) => journeyProgress(a.journey) - journeyProgress(b.journey)); // least progressed first

  const openClient = (c: JourneyClient) => { set({ selectedClientId: c.id, selectedClientName: c.name }); go('crm-journey-client'); };

  return (
    <Page gap={13} pt={6}>
      <View>
        <Serif style={{ fontSize: 24 }}>Client Journey</Serif>
        <Body style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>Track and manage onboarding progress</Body>
      </View>

      {/* Stat strip */}
      <View style={{ flexDirection: 'row', borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.28)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
        {([['COMPLETED', counts.completed, C.green], ['IN PROGRESS', counts.in_progress, C.gold], ['NOT STARTED', counts.not_started, C.red]] as [string, number, string][]).map(([lab, val, col], i) => (
          <View key={lab} style={{ flex: 1, alignItems: 'center', paddingVertical: 10, gap: 2, borderLeftWidth: i ? 1 : 0, borderLeftColor: 'rgba(255,255,255,0.06)' }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 16, color: col }}>{clientsQ.isLoading ? '…' : val}</Text>
            <Mono style={{ fontSize: 6.5, letterSpacing: 0.6, color: C.muted3 }}>{lab}</Mono>
          </View>
        ))}
      </View>

      {/* Filter + search */}
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {([['all', 'All'], ['not_started', 'Not Started'], ['in_progress', 'In Progress'], ['completed', 'Done']] as [Filter, string][]).map(([id, label]) => {
          const active = filter === id;
          const col = id === 'completed' ? C.green : id === 'in_progress' ? C.gold : id === 'not_started' ? C.red : C.orange;
          return (
            <AnimChip key={id} grow active={active} onPress={() => setFilter(id)} style={{ alignItems: 'center', paddingVertical: 9, borderRadius: 11, backgroundColor: active ? hexA(col, 0.15) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(col, 0.5) : 'rgba(255,255,255,0.08)' }}>
              <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 11, color: active ? col : C.muted }}>{label}</Text>
            </AnimChip>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 10, paddingHorizontal: 13, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
        <Icon name="search" size={15} color={C.muted3} strokeWidth={2} />
        <TextInput value={query} onChangeText={setQuery} placeholder="Search clients…" placeholderTextColor={C.muted3} autoCorrect={false} style={{ flex: 1, fontFamily: F.body, fontSize: 14, color: '#fff', padding: 0 }} />
      </View>

      {/* Clients */}
      {clientsQ.isLoading ? (
        <View style={{ alignItems: 'center', gap: 8, paddingVertical: 30 }}>
          <ActivityIndicator color={C.orange} />
          <Body style={{ fontSize: 12.5, color: C.muted3 }}>Loading journeys…</Body>
        </View>
      ) : list.length === 0 ? (
        <Body style={{ color: C.muted2, textAlign: 'center', paddingVertical: 26 }}>No clients match.</Body>
      ) : (
        <View style={{ borderRadius: 17, backgroundColor: 'rgba(24,17,14,0.55)', borderWidth: 1, borderColor: 'rgba(255,150,90,0.12)', overflow: 'hidden' }}>
          {list.slice(0, 60).map((c, i) => {
            const pct = journeyProgress(c.journey);
            const done = journeyDone(c.journey);
            const st = stateOf(c);
            const col = st === 'completed' ? C.green : st === 'in_progress' ? C.gold : C.red;
            return (
              <Pressable key={c.id} onPress={() => openClient(c)} style={{ paddingVertical: 12, paddingHorizontal: 13, gap: 8, borderTopWidth: i ? 1 : 0, borderTopColor: 'rgba(255,255,255,0.05)' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
                  <MiniAvatar initial={initials(c.name)} colors={AVS[i % AVS.length]} size={38} />
                  <View style={{ flex: 1 }}>
                    <Body numberOfLines={1} style={{ fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }}>{c.name}</Body>
                    <Mono style={{ fontSize: 8, color: C.muted3, marginTop: 2 }}>{done} OF {ALL_STEP_KEYS.length} STEPS{c.subscription ? `  ·  ${c.subscription.toUpperCase()}` : ''}</Mono>
                  </View>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: col }}>{pct}%</Text>
                  <Icon name="chevRight" size={15} color={C.muted3} strokeWidth={2.2} />
                </View>
                <ProgressBar pct={pct} height={5} fill={col} />
              </Pressable>
            );
          })}
        </View>
      )}
      {list.length > 60 ? <Body style={{ fontSize: 11, color: C.muted3, textAlign: 'center' }}>+{list.length - 60} more — refine the search</Body> : null}
    </Page>
  );
}

/* ================= DETAIL (roadmap with live toggles) ================= */
export function CrmJourneyDetail() {
  const { selectedClientId: clientId, selectedClientName, back, canGoBack, go } = useStore();
  const { session } = useAuth();
  const crmId = session?.user?.id ?? null;
  const clientsQ = useJourneyClients(crmId);
  const toggleM = useToggleJourneyStep();

  const client = (clientsQ.data ?? []).find((c) => c.id === clientId) ?? null;
  const name = selectedClientName ?? client?.name ?? 'Client';
  const journey = client?.journey ?? {};
  const pct = journeyProgress(journey);
  const done = journeyDone(journey);

  const toggle = (stepKey: string, next: boolean) => {
    if (!crmId || !clientId) return;
    toggleM.mutate({ crmId, clientId, stepKey, value: next }, {
      onError: (e: any) => Alert.alert("Couldn't update", e?.message ?? 'Try again.'),
    });
  };

  return (
    <Page gap={13} pt={6}>
      <BackLink label="Client Journey" onPress={() => (canGoBack ? back() : go('crm-journey'))} />

      {clientsQ.isLoading ? (
        <View style={{ alignItems: 'center', gap: 8, paddingVertical: 40 }}>
          <ActivityIndicator color={C.orange} />
          <Body style={{ fontSize: 12.5, color: C.muted3 }}>Loading journey…</Body>
        </View>
      ) : !client ? (
        <Body style={{ color: C.red, textAlign: 'center', paddingVertical: 30 }}>Couldn't load this client's journey.</Body>
      ) : (
        <>
          {/* Header */}
          <Card colors={['rgba(72,40,22,0.55)', 'rgba(15,11,10,0.62)']} border="rgba(255,150,90,0.18)" radius={20} style={{ overflow: 'hidden' }}>
            <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 3 }} />
            <View style={{ padding: 15, gap: 11 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <MiniAvatar initial={initials(name)} colors={AVS[0]} size={46} />
                <View style={{ flex: 1 }}>
                  <Mono style={{ fontSize: 8, letterSpacing: 1.2, color: C.orange }}>ONBOARDING JOURNEY</Mono>
                  <Serif style={{ fontSize: 20, marginTop: 2 }} numberOfLines={1}>{name}</Serif>
                </View>
                <View style={{ alignItems: 'center' }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 22, color: pct === 100 ? C.green : C.blue }}>{pct}%</Text>
                  <Mono style={{ fontSize: 7, color: C.muted3 }}>{done}/{ALL_STEP_KEYS.length} STEPS</Mono>
                </View>
              </View>
              <ProgressBar pct={pct} height={7} fill={pct === 100 ? C.green : C.blue} />
              {pct === 100 ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, padding: 9, borderRadius: 11, backgroundColor: hexA(C.green, 0.08), borderWidth: 1, borderColor: hexA(C.green, 0.3) }}>
                  <Icon name="checks" size={13} color={C.green} strokeWidth={2.5} />
                  <Body style={{ fontSize: 11.5, color: C.green, fontFamily: F.bodySemi }}>Onboarding complete — great work.</Body>
                </View>
              ) : null}
            </View>
          </Card>

          {/* Categories */}
          {JOURNEY_CATEGORIES.map((cat, ci) => {
            const catDone = cat.steps.filter((s) => journey[s.key] === true).length;
            const allDone = catDone === cat.steps.length;
            const col = allDone ? C.green : catDone > 0 ? C.gold : C.muted2;
            return (
              <Card key={cat.id} colors={['rgba(46,28,18,0.4)', 'rgba(16,12,11,0.55)']} border={hexA(col === C.muted2 ? C.orange : col, 0.13)} radius={17} style={{ overflow: 'hidden' }}>
                <LinearGradient colors={[hexA(col === C.muted2 ? C.orange : col, 0.5), 'rgba(255,255,255,0.02)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 2.5 }} />
                <View style={{ padding: 13, gap: 9 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                    <View style={{ width: 26, height: 26, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: allDone ? hexA(C.green, 0.15) : 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: allDone ? hexA(C.green, 0.45) : 'rgba(255,255,255,0.1)' }}>
                      {allDone
                        ? <Icon name="checks" size={13} color={C.green} strokeWidth={2.6} />
                        : <Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: C.muted }}>{ci + 1}</Text>}
                    </View>
                    <Body style={{ flex: 1, fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{cat.title}</Body>
                    <Mono style={{ fontSize: 8.5, color: col }}>{catDone}/{cat.steps.length}</Mono>
                  </View>
                  {cat.steps.map((s) => {
                    const checked = journey[s.key] === true;
                    return (
                      <Pressable key={s.key} onPress={() => toggle(s.key, !checked)} disabled={toggleM.isPending} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, paddingHorizontal: 10, borderRadius: 11, backgroundColor: checked ? hexA(C.green, 0.05) : 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: checked ? hexA(C.green, 0.2) : 'rgba(255,255,255,0.06)' }}>
                        <View style={{ width: 20, height: 20, borderRadius: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: checked ? hexA(C.green, 0.2) : 'rgba(255,255,255,0.05)', borderWidth: 1.5, borderColor: checked ? C.green : 'rgba(255,255,255,0.22)' }}>
                          {checked ? <Icon name="checks" size={11} color={C.green} strokeWidth={2.8} /> : null}
                        </View>
                        <Body style={{ flex: 1, fontSize: 12, lineHeight: 17, color: checked ? C.muted2 : '#fff' }}>{s.label}</Body>
                      </Pressable>
                    );
                  })}
                </View>
              </Card>
            );
          })}
        </>
      )}
    </Page>
  );
}
