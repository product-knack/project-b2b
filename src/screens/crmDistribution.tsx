import React from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator, Alert } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono, Card } from '../components/primitives';
import { Page, Badge, MiniAvatar, AnimChip, HScroll } from './common';
import { useStore } from '../store';
import { useAuth } from '../auth';
import { useCrmClientList } from '../lib/crmClientQueries';
import { useClientDistribution, useUpsertDistribution, DIST_CATEGORIES, DistributionCategory } from '../lib/distributionQueries';

/* ============ CRM: Client Distribution — mirrors the web CRMClientDistribution:
   sort the assigned book into care buckets, one tap per client. ============ */

const initials = (n: string) => n.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
const AVS: [string, string][] = [['#F0883E', '#C05621'], ['#4FD1C5', '#2C7A7B'], ['#B794F4', '#6B46C1'], ['#F687B3', '#B83280'], ['#68D391', '#276749'], ['#63B3ED', '#2B6CB0']];

type Bucket = 'none' | DistributionCategory;

export function CrmDistribution() {
  const { go, set } = useStore();
  const { session } = useAuth();
  const crmId = session?.user?.id ?? null;
  const clientsQ = useCrmClientList(crmId, 'active');
  const distQ = useClientDistribution(crmId);
  const upsertM = useUpsertDistribution();
  const [bucket, setBucket] = React.useState<Bucket>('none');
  const [query, setQuery] = React.useState('');

  const clients = clientsQ.data ?? [];
  const dist = distQ.data ?? {};
  const q = query.trim().toLowerCase();

  const inBucket = (b: Bucket) => clients.filter((c) => (b === 'none' ? !dist[c.id] : dist[c.id] === b));
  const list = inBucket(bucket).filter((c) => !q || c.name.toLowerCase().includes(q));
  const loading = clientsQ.isLoading || distQ.isLoading;
  const categorized = clients.length - inBucket('none').length;

  const assign = (clientId: string, category: DistributionCategory) => {
    if (!crmId) return;
    upsertM.mutate({ crmId, clientId, category }, {
      onError: (e: any) => Alert.alert("Couldn't update", e?.message ?? 'Try again.'),
    });
  };
  const openClient = (id: string, name: string) => { set({ selectedClientId: id, selectedClientName: name }); go('crm-client'); };

  return (
    <Page gap={14} pt={6}>
      <View>
        <Serif style={{ fontSize: 24 }}>Client Distribution</Serif>
        <Body style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>Sort your book into care buckets — one tap per client</Body>
      </View>

      {/* Coverage strip */}
      <Card colors={['rgba(64,38,22,0.5)', 'rgba(16,12,11,0.55)']} border="rgba(255,150,90,0.14)" radius={17} style={{ overflow: 'hidden' }}>
        <LinearGradient colors={[hexA(C.orange, 0.55), 'rgba(255,255,255,0.02)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 2.5 }} />
        <View style={{ flexDirection: 'row', padding: 4 }}>
          {DIST_CATEGORIES.map((cat, i) => {
            const n = inBucket(cat.id).length;
            return (
              <View key={cat.id} style={{ flex: 1, alignItems: 'center', paddingVertical: 10, gap: 3, borderLeftWidth: i ? 1 : 0, borderLeftColor: 'rgba(255,255,255,0.05)' }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 17, color: cat.color }}>{loading ? '…' : n}</Text>
                <Mono style={{ fontSize: 6.8, letterSpacing: 0.5, color: C.muted3, textAlign: 'center' }}>{cat.label.toUpperCase()}</Mono>
              </View>
            );
          })}
        </View>
        <View style={{ paddingHorizontal: 14, paddingBottom: 11 }}>
          <View style={{ height: 5, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.06)', overflow: 'hidden', flexDirection: 'row' }}>
            {DIST_CATEGORIES.map((cat) => {
              const n = inBucket(cat.id).length;
              return clients.length ? <View key={cat.id} style={{ width: `${(n / clients.length) * 100}%`, backgroundColor: cat.color }} /> : null;
            })}
          </View>
          <Mono style={{ fontSize: 8, color: C.muted3, marginTop: 6 }}>{loading ? 'LOADING…' : `${categorized} OF ${clients.length} CLIENTS CATEGORIZED`}</Mono>
        </View>
      </Card>

      {/* Bucket tabs */}
      <HScroll gap={7}>
        {([{ id: 'none' as Bucket, label: 'No Category', color: C.orange }, ...DIST_CATEGORIES] as { id: Bucket; label: string; color: string }[]).map((b) => {
          const active = bucket === b.id;
          const n = inBucket(b.id).length;
          return (
            <AnimChip key={b.id} active={active} onPress={() => setBucket(b.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 9, paddingHorizontal: 13, borderRadius: 12, backgroundColor: active ? hexA(b.color, 0.15) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(b.color, 0.5) : 'rgba(255,255,255,0.08)' }}>
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: b.color }} />
              <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 12, color: active ? b.color : C.muted }}>{b.label}</Text>
              {!loading ? <Text style={{ fontFamily: F.mono, fontSize: 9.5, color: active ? b.color : C.muted3 }}>{n}</Text> : null}
            </AnimChip>
          );
        })}
      </HScroll>

      {/* Search */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
        <Icon name="search" size={15} color={C.muted3} strokeWidth={2} />
        <TextInput value={query} onChangeText={setQuery} placeholder="Search clients…" placeholderTextColor={C.muted3} autoCorrect={false} style={{ flex: 1, fontFamily: F.body, fontSize: 14, color: '#fff', padding: 0 }} />
      </View>

      {loading ? (
        <View style={{ alignItems: 'center', gap: 8, paddingVertical: 30 }}>
          <ActivityIndicator color={C.orange} />
          <Body style={{ fontSize: 12.5, color: C.muted3 }}>Loading your book…</Body>
        </View>
      ) : list.length === 0 ? (
        <Body style={{ color: C.muted2, textAlign: 'center', paddingVertical: 26 }}>
          {q ? 'No clients match your search.' : bucket === 'none' ? 'Every client has a category — nice work.' : 'No clients in this bucket yet.'}
        </Body>
      ) : (
        list.map((c, i) => {
          const current = dist[c.id];
          const curMeta = DIST_CATEGORIES.find((x) => x.id === current);
          return (
            <View key={c.id} style={{ borderRadius: 17, backgroundColor: 'rgba(24,17,14,0.55)', borderWidth: 1, borderColor: curMeta ? hexA(curMeta.color, 0.28) : 'rgba(255,150,90,0.12)', overflow: 'hidden' }}>
              <View style={{ height: 2.5, backgroundColor: curMeta ? hexA(curMeta.color, 0.6) : 'rgba(255,255,255,0.06)' }} />
              <View style={{ padding: 13, gap: 11 }}>
                <Pressable onPress={() => openClient(c.id, c.name)} style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
                  <MiniAvatar initial={initials(c.name)} colors={AVS[i % AVS.length]} size={40} />
                  <View style={{ flex: 1 }}>
                    <Body numberOfLines={1} style={{ fontSize: 14.5, fontFamily: F.bodySemi, color: '#fff' }}>{c.name}</Body>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 4 }}>
                      {curMeta ? <Badge text={curMeta.label} color={curMeta.color} /> : <Badge text="Uncategorized" color={C.muted2} />}
                      {c.subscription ? <Badge text={c.subscription} color={C.gold} /> : null}
                      {c.paused ? <Badge text="Paused" color={C.purple} /> : null}
                    </View>
                  </View>
                  <Icon name="chevRight" size={15} color={C.muted3} strokeWidth={2.2} />
                </Pressable>
                {/* One-tap bucket picker */}
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  {DIST_CATEGORIES.map((cat) => {
                    const active = current === cat.id;
                    return (
                      <AnimChip key={cat.id} grow active={active} disabled={active} onPress={() => assign(c.id, cat.id)} style={{ alignItems: 'center', paddingVertical: 8, borderRadius: 10, backgroundColor: active ? hexA(cat.color, 0.18) : 'rgba(255,255,255,0.035)', borderWidth: 1, borderColor: active ? hexA(cat.color, 0.55) : 'rgba(255,255,255,0.08)' }}>
                        <Text numberOfLines={1} style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 9.5, color: active ? cat.color : C.muted }}>{cat.label}</Text>
                      </AnimChip>
                    );
                  })}
                </View>
              </View>
            </View>
          );
        })
      )}
    </Page>
  );
}
