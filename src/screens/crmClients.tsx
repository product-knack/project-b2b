import React from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Serif, Body } from '../components/primitives';
import { Page, Badge, MiniAvatar, AnimChip } from './common';
import { useStore } from '../store';
import { useAuth } from '../auth';
import { useCrmClientList } from '../lib/crmClientQueries';

/* ============ CRM: My Clients list — mirrors the web CRMClients,
   restyled for the app's obsidian/ember system. Detail page lives in
   crmClientDetail.tsx. ============ */

const initials = (n: string) => n.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
const AVS: [string, string][] = [['#F0883E', '#C05621'], ['#4FD1C5', '#2C7A7B'], ['#B794F4', '#6B46C1'], ['#F687B3', '#B83280'], ['#68D391', '#276749'], ['#63B3ED', '#2B6CB0']];

export function CrmClients() {
  const { go, set } = useStore();
  const { session } = useAuth();
  const crmId = session?.user?.id ?? null;
  const [tab, setTab] = React.useState<'active' | 'inactive'>('active');
  const [query, setQuery] = React.useState('');
  const listQ = useCrmClientList(crmId, tab);
  const inactiveQ = useCrmClientList(crmId, 'inactive');

  const q = query.trim().toLowerCase();
  const list = (listQ.data ?? []).filter((c) => !q || c.name.toLowerCase().includes(q));
  const openDetail = (id: string, name: string) => { set({ selectedClientId: id, selectedClientName: name }); go('crm-client'); };

  return (
    <Page gap={14} pt={6}>
      <View>
        <Serif style={{ fontSize: 24 }}>My Clients{listQ.data ? ` (${list.length})` : ''}</Serif>
        <Body style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>Your assigned book of clients</Body>
      </View>

      {/* Status tabs (server-side filter, like the web) */}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {([['active', 'Active Clients', null], ['inactive', 'Inactive', inactiveQ.data?.length ?? null]] as const).map(([id, label, n]) => {
          const active = tab === id;
          return (
            <AnimChip key={id} grow active={active} onPress={() => setTab(id)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 12, backgroundColor: active ? hexA(C.orange, 0.14) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.orange, 0.45) : 'rgba(255,255,255,0.08)' }}>
              <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 13, color: active ? C.orange : C.muted }}>{label}</Text>
              {n != null && n > 0 ? <Text style={{ fontFamily: F.mono, fontSize: 11, color: active ? C.orange : C.muted2 }}>{n}</Text> : null}
            </AnimChip>
          );
        })}
      </View>

      {/* Search */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 14, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
        <Icon name="search" size={16} color={C.muted3} strokeWidth={2} />
        <TextInput value={query} onChangeText={setQuery} placeholder="Search clients…" placeholderTextColor={C.muted3} autoCorrect={false} style={{ flex: 1, fontFamily: F.body, fontSize: 14.5, color: '#fff', padding: 0 }} />
      </View>

      {listQ.isLoading ? (
        <View style={{ alignItems: 'center', gap: 8, paddingVertical: 30 }}>
          <ActivityIndicator color={C.orange} />
          <Body style={{ fontSize: 12.5, color: C.muted3 }}>Loading clients…</Body>
        </View>
      ) : list.length === 0 ? (
        <Body style={{ color: C.muted2, textAlign: 'center', paddingVertical: 30 }}>No {tab} clients{q ? ' match your search' : ''}.</Body>
      ) : (
        list.map((c, i) => (
          <Pressable key={c.id} onPress={() => openDetail(c.id, c.name)} style={{ borderRadius: 18, backgroundColor: 'rgba(24,17,14,0.55)', borderWidth: 1, borderColor: c.renewalPending ? hexA(C.red, 0.3) : 'rgba(255,150,90,0.12)', overflow: 'hidden' }}>
            <LinearGradient colors={[hexA(c.renewalPending ? C.red : C.orange, 0.45), 'rgba(255,255,255,0.01)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 3 }} />
            <View style={{ padding: 14, gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <MiniAvatar initial={initials(c.name)} colors={AVS[i % AVS.length]} size={44} />
                <View style={{ flex: 1 }}>
                  <Body numberOfLines={1} style={{ fontSize: 15.5, fontFamily: F.bodySemi, color: '#fff' }}>{c.name}</Body>
                </View>
                <Icon name="chevRight" size={16} color={C.muted} strokeWidth={2.2} />
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                <Badge text={c.status === 'active' ? 'Active' : c.status[0].toUpperCase() + c.status.slice(1)} color={c.status === 'active' ? C.green : C.muted2} />
                {c.subscription ? <Badge text={c.subscription} color={C.gold} /> : null}
                {c.appUser ? <Badge text="App User" color={C.blue} /> : null}
                {c.renewalPending ? <Badge text="Renewal Pending" color={C.red} /> : null}
                {c.paused ? <Badge text="Paused" color={C.purple} /> : null}
                {c.package ? (
                  <View style={{ paddingVertical: 3, paddingHorizontal: 9, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
                    <Text style={{ fontFamily: F.bodySemi, fontSize: 10, color: C.ink3 }}>Package · {c.package}</Text>
                  </View>
                ) : null}
              </View>
            </View>
          </Pressable>
        ))
      )}
    </Page>
  );
}
