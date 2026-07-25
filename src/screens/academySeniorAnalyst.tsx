import React from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono, Avatar } from '../components/primitives';
import { Page, TitleBlock, HScroll, BackLink } from './common';
import { useStore } from '../store';
import { supabase } from '../lib/supabase';

/* ============================================================================
   Senior Analyst — client overview (web /analyst/clients).
   Active clients that carry a subscription, each tagged with the goal pulled
   from their most recent QHP assessment. Tapping a client opens the shared
   client detail screen (full analytics).
   Gated by profiles.senior_analyst.
   ========================================================================== */

const ACC = '#6EA8FE';

async function fetchAll<T>(build: (from: number, to: number) => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    const chunk = (data ?? []) as T[];
    out.push(...chunk);
    if (chunk.length < 1000) break;
  }
  return out;
}

/* Goal lookup mirrors the web extractSelectedGoal: qhp_data first, then the new
   then existing assessment blobs; inside each, the Standardized Assessment, the
   Existing Client Re-Assessment, a root selectedGoal, then goalSelection. */
const extractGoal = (a: any): string | null => {
  for (const src of [a?.qhp_data, a?.new_client_assessment_data, a?.existing_client_assessment_data]) {
    if (src && typeof src === 'object') {
      const std = src['Standardized Assessment'];
      if (std?.selectedGoal) return String(std.selectedGoal);
      const re = src['Existing Client Re-Assessment'];
      if (re?.selectedGoal) return String(re.selectedGoal);
      if (src.selectedGoal) return String(src.selectedGoal);
      if (src.goalSelection?.selectedGoal) return String(src.goalSelection.selectedGoal);
    }
  }
  return null;
};

export type SaClient = {
  id: string; name: string; email: string | null; phone: string | null;
  subscription: string | null; goal: string | null; selectedGoal: string | null;
};

export function useSeniorAnalystClients() {
  return useQuery({
    queryKey: ['senior-analyst-clients'],
    staleTime: 300_000,
    queryFn: async (): Promise<{ clients: SaClient[]; goals: string[] }> => {
      const rows = await fetchAll<any>((f, t) =>
        supabase
          .from('clients')
          .select('id, first_name, last_name, email, phone, status, subscription_type, goal')
          .eq('status', 'active')
          .not('subscription_type', 'is', null)
          .neq('subscription_type', '')
          .order('first_name', { ascending: true })
          .range(f, t)
      );
      if (!rows.length) return { clients: [], goals: [] };
      const ids = rows.map((c) => c.id);
      // Newest assessment per client wins (rows arrive created_at desc).
      const assessments: any[] = [];
      for (let i = 0; i < ids.length; i += 300) {
        const slice = ids.slice(i, i + 300);
        assessments.push(...await fetchAll<any>((f, t) =>
          supabase
            .from('coach_assessment')
            .select('client_id, qhp_data, new_client_assessment_data, existing_client_assessment_data, created_at')
            .in('client_id', slice)
            .order('created_at', { ascending: false })
            .range(f, t)
        ));
      }
      const goalByClient = new Map<string, string | null>();
      const goalSet = new Set<string>();
      assessments.forEach((a) => {
        if (!a.client_id || goalByClient.has(a.client_id)) return;
        const g = extractGoal(a);
        goalByClient.set(a.client_id, g);
        if (g) goalSet.add(g);
      });
      const clients: SaClient[] = rows.map((c) => ({
        id: c.id,
        name: `${c.first_name ?? ''} ${c.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || 'Client',
        email: c.email ?? null, phone: c.phone ?? null,
        subscription: c.subscription_type ?? null, goal: c.goal ?? null,
        selectedGoal: goalByClient.get(c.id) ?? null,
      }));
      return { clients, goals: [...goalSet].sort() };
    },
  });
}

const initials = (n: string) => n.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';
const avColors = (n: string): [string, string] => {
  const sets: [string, string][] = [['#7C8FE8', '#9A7BEA'], ['#E8A87C', '#EA7B9A'], ['#7CE8C1', '#4FB6E8'], ['#E8D07C', '#E8A87C']];
  let h = 0; for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
  return sets[h % sets.length];
};

export function AcademySeniorAnalyst() {
  const { back, canGoBack, go, set } = useStore();
  const q = useSeniorAnalystClients();
  const [search, setSearch] = React.useState('');
  const [goal, setGoal] = React.useState<string>('all');

  const clients = q.data?.clients ?? [];
  const goals = q.data?.goals ?? [];
  const qq = search.trim().toLowerCase();
  const rows = clients
    .filter((c) => goal === 'all' || c.selectedGoal === goal)
    .filter((c) => !qq || c.name.toLowerCase().includes(qq) || (c.email ?? '').toLowerCase().includes(qq));

  const open = (c: SaClient) => {
    set({ selectedClientId: c.id, selectedClientName: c.name });
    go('client'); // shared client detail — progression, goals, reports, sessions
  };

  return (
    <Page gap={12} pt={6}>
      <BackLink label="Back to Academy" onPress={() => (canGoBack ? back() : go('academy-dashboard'))} />
      <TitleBlock title="Senior Analyst" sub="Every active subscribed client and their goal" />

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)' }}>
        <Icon name="search" size={14} color={C.muted3} strokeWidth={2} />
        <TextInput value={search} onChangeText={setSearch} placeholder="Search name or email…" placeholderTextColor={C.muted3} autoCorrect={false} autoCapitalize="none" style={{ flex: 1, fontFamily: F.body, fontSize: 13.5, color: '#fff', padding: 0 }} />
      </View>

      {goals.length ? (
        <HScroll gap={7}>
          {['all', ...goals].map((g) => {
            const on = goal === g;
            return (
              <Pressable key={g} onPress={() => setGoal(g)} style={{ paddingVertical: 7, paddingHorizontal: 13, borderRadius: 999, backgroundColor: on ? hexA(ACC, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: on ? hexA(ACC, 0.5) : 'rgba(255,255,255,0.09)' }}>
                <Text style={{ fontFamily: on ? F.bodyBold : F.bodySemi, fontSize: 11.5, color: on ? ACC : C.muted }} numberOfLines={1}>{g === 'all' ? 'All goals' : g}</Text>
              </Pressable>
            );
          })}
        </HScroll>
      ) : null}

      <Mono style={{ fontSize: 9, color: C.muted3, textAlign: 'right' }}>{rows.length} CLIENT{rows.length === 1 ? '' : 'S'}</Mono>

      {q.isPending ? <ActivityIndicator color={ACC} style={{ paddingVertical: 34 }} />
        : q.isError ? <Body style={{ fontSize: 12, color: C.red, textAlign: 'center', paddingVertical: 22 }}>{(q.error as Error).message}</Body>
        : rows.length === 0 ? <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 30 }}>No clients match these filters.</Body>
        : rows.slice(0, 300).map((c) => (
          <Pressable key={c.id} onPress={() => open(c)} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: 13, borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }}>
            <Avatar initial={initials(c.name)} size={38} colors={avColors(c.name)} fontSize={13} />
            <View style={{ flex: 1 }}>
              <Body numberOfLines={1} style={{ fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }}>{c.name}</Body>
              <Body numberOfLines={1} style={{ fontSize: 10.5, color: C.muted2, marginTop: 1 }}>
                {[c.subscription, c.email].filter(Boolean).join(' · ') || 'No details'}
              </Body>
              {c.selectedGoal ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 5 }}>
                  <Icon name="target" size={10} color={ACC} strokeWidth={2.2} />
                  <Text style={{ fontFamily: F.bodySemi, fontSize: 10, color: ACC }} numberOfLines={1}>{c.selectedGoal}</Text>
                </View>
              ) : null}
            </View>
            <Icon name="chevRight" size={15} color={C.muted3} strokeWidth={2.3} />
          </Pressable>
        ))}
      {rows.length > 300 ? (
        <Body style={{ fontSize: 10.5, color: C.muted3, textAlign: 'center' }}>Showing the first 300 of {rows.length}. Search to narrow.</Body>
      ) : null}
    </Page>
  );
}
