import React from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator, Modal, ScrollView, Linking } from 'react-native';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono, Card, Avatar } from '../components/primitives';
import { Page, TitleBlock, Badge, HScroll } from './common';
import { useAuth } from '../auth';
import { useStore } from '../store';
import {
  useAdminClients, useClientTabCounts, useDeleteClient, useToggleOddsConversion, useUpdateClientSubscription, useReactivateClient,
  SUBSCRIPTION_OPTIONS, CLIENTS_PER_PAGE, type UnifiedClient, type ClientFilter, type StatusTab,
} from '../lib/adminClientQueries';

/* ============ ADMIN — Clients (web /admin/clients port) ============ */

const AV_GRADS: [string, string][] = [['#FB8B3A', '#EE5E16'], ['#57C98A', '#2E9A63'], ['#7C8FE8', '#4A5AC8'], ['#9A7BEA', '#6E5BD0'], ['#E0A53C', '#C07C1E'], ['#4FD1C5', '#2C8A86'], ['#F687B3', '#C2568A'], ['#F0883E', '#C05621']];
const avColors = (seed: string): [string, string] => AV_GRADS[[...(seed || '?')].reduce((a, c) => a + c.charCodeAt(0), 0) % AV_GRADS.length];
const nameOf = (c: UnifiedClient) => `${c.first_name ?? ''} ${c.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || '—';
const fmtPause = (ymd: string | null) => (ymd ? new Date(`${String(ymd).slice(0, 10)}T12:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—');

/* Per-client action sheet: subscription, ODDS toggle, reactivate, delete (B2B only). */
function ClientSheet({ c, profileId, onClose }: { c: UnifiedClient; profileId: string | null; onClose: () => void }) {
  const del = useDeleteClient();
  const toggle = useToggleOddsConversion();
  const updateSub = useUpdateClientSubscription();
  const reactivate = useReactivateClient();
  const [subOpen, setSubOpen] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const busy = del.isPending || toggle.isPending || updateSub.isPending || reactivate.isPending;
  const fail = (e: any) => setErr(e?.message ?? 'Failed');
  const row = (label: string, color: string, onPress: () => void, danger = false) => (
    <Pressable disabled={busy} onPress={onPress} style={{ paddingVertical: 11, paddingHorizontal: 13, borderRadius: 11, backgroundColor: hexA(color, danger ? 0.1 : 0.12), borderWidth: 1, borderColor: hexA(color, 0.4) }}>
      <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color }}>{label}</Text>
    </Pressable>
  );
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.62)', justifyContent: 'flex-end' }}>
        <View style={{ maxHeight: '88%', backgroundColor: '#0E0A09', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.14)', paddingHorizontal: 18, paddingTop: 14, paddingBottom: 24 }}>
          <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 12 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 10 }}>
            <View style={{ flex: 1 }}>
              <Serif numberOfLines={1} style={{ fontSize: 18 }}>{nameOf(c)}</Serif>
              <Body numberOfLines={1} style={{ fontSize: 10.5, color: C.muted2, marginTop: 1 }}>{c.client_source} · {c.subscription_type ?? 'No subscription'} · {c.status ?? 'active'}</Body>
            </View>
            <Pressable onPress={onClose} hitSlop={8} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="close" size={13} color="#B8B2AC" strokeWidth={2.3} />
            </Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 9, paddingBottom: 8 }}>
            {err ? <Body style={{ fontSize: 10.5, color: C.red }}>{err}</Body> : null}
            {row(subOpen ? 'Change subscription ▾' : 'Change subscription', C.gold, () => setSubOpen((v) => !v))}
            {subOpen ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {['none', ...SUBSCRIPTION_OPTIONS].map((s) => {
                  const active = s === 'none' ? c.subscription_type == null : c.subscription_type === s;
                  return (
                    <Pressable key={s} disabled={busy || active} onPress={() => { setErr(null); updateSub.mutate({ client: c, type: s === 'none' ? null : s }, { onSuccess: onClose, onError: fail }); }}
                      style={{ paddingVertical: 7, paddingHorizontal: 11, borderRadius: 999, backgroundColor: active ? hexA(C.gold, 0.2) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.gold, 0.6) : 'rgba(255,255,255,0.09)' }}>
                      <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 10.5, color: active ? C.gold : C.muted }}>{s === 'none' ? 'None' : s}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
            {row(busy && toggle.isPending ? 'Working…' : c.is_odds_converted ? 'Remove ODDS conversion' : 'Mark ODDS converted', C.purple, () => { setErr(null); toggle.mutate(c, { onSuccess: onClose, onError: fail }); })}
            {c.status === 'discontinued' ? row(reactivate.isPending ? 'Reactivating…' : 'Reactivate client', C.green, () => { setErr(null); reactivate.mutate({ clientId: c.id, profileId }, { onSuccess: onClose, onError: fail }); }) : null}
            {c.client_source === 'B2B' ? (
              confirmDelete
                ? row(del.isPending ? 'Deleting…' : 'Tap again to permanently delete', C.red, () => { setErr(null); del.mutate(c, { onSuccess: onClose, onError: fail }); }, true)
                : row('Delete client (B2B only)', C.red, () => setConfirmDelete(true), true)
            ) : <Body style={{ fontSize: 10, color: C.muted3 }}>B2C clients can't be deleted from here.</Body>}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export function AdminClients() {
  const { set, go } = useStore();
  const { session } = useAuth();
  const profileId = session?.user?.id ?? null;
  const [search, setSearch] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [clientFilter, setClientFilter] = React.useState<ClientFilter>('all');
  const [statusTab, setStatusTab] = React.useState<StatusTab>('active');
  const [subFilter, setSubFilter] = React.useState('all');
  const [page, setPage] = React.useState(1);
  const [open, setOpen] = React.useState<UnifiedClient | null>(null);
  React.useEffect(() => { const t = setTimeout(() => { setDebounced(search); setPage(1); }, 800); return () => clearTimeout(t); }, [search]);

  const countsQ = useClientTabCounts(clientFilter);
  const q = useAdminClients({ page, search: debounced, clientFilter, statusTab, subscriptionFilter: subFilter });
  const rows = q.data?.rows ?? [];
  const total = q.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / CLIENTS_PER_PAGE));
  const reset = () => setPage(1);

  const TABS: [StatusTab, string][] = [['active', 'Active'], ['without_subscription', 'No Sub'], ['inactive', 'Inactive'], ['discontinued', 'Discontinued']];
  const TYPES: [ClientFilter, string][] = [['all', 'All'], ['paused', 'Paused']];

  return (
    <Page gap={13}>
      <TitleBlock title="Clients" sub="Entire client base — search, segment & manage" />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 13, paddingVertical: 11, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)' }}>
        <Icon name="search" size={15} color={C.muted3} strokeWidth={2} />
        <TextInput value={search} onChangeText={setSearch} placeholder="Search name or email…" placeholderTextColor={C.muted3} autoCorrect={false} style={{ flex: 1, fontFamily: F.body, fontSize: 14, color: '#fff', padding: 0 }} />
        {search ? <Pressable onPress={() => setSearch('')} hitSlop={8}><Icon name="close" size={13} color={C.muted3} strokeWidth={2.3} /></Pressable> : null}
      </View>

      <HScroll gap={7}>
        {TABS.map(([id, label]) => {
          const active = statusTab === id;
          const n = countsQ.data?.[id];
          return (
            <Pressable key={id} onPress={() => { setStatusTab(id); reset(); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: active ? hexA(C.orange, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.orange, 0.5) : 'rgba(255,255,255,0.09)' }}>
              <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 11.5, color: active ? C.orange : C.muted }}>{label}</Text>
              {n != null ? <Text style={{ fontFamily: F.bodyBold, fontSize: 9.5, color: active ? C.orange : C.muted3 }}>{n}</Text> : null}
            </Pressable>
          );
        })}
      </HScroll>
      <HScroll gap={6}>
        {TYPES.map(([id, label]) => {
          const active = clientFilter === id;
          return (
            <Pressable key={id} onPress={() => { setClientFilter(id); reset(); }} style={{ paddingVertical: 7, paddingHorizontal: 11, borderRadius: 999, backgroundColor: active ? hexA(C.blue, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.blue, 0.5) : 'rgba(255,255,255,0.09)' }}>
              <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 10.5, color: active ? C.blue : C.muted }}>{label}</Text>
            </Pressable>
          );
        })}
      </HScroll>

      {q.isError ? <Body style={{ fontSize: 11.5, color: C.red, textAlign: 'center' }}>{(q.error as Error).message}</Body> : null}
      {q.isPending ? (
        <View style={{ paddingVertical: 30, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View>
      ) : rows.length === 0 ? (
        <Body style={{ fontSize: 12, color: C.muted3, textAlign: 'center', paddingVertical: 22 }}>No clients match this view.</Body>
      ) : (
        <>
          <Body style={{ fontSize: 10.5, color: C.muted3 }}>{debounced ? `${rows.length} result${rows.length === 1 ? '' : 's'}` : `Page ${page} of ${pages} · ${total} clients`}</Body>
          {rows.map((c) => {
            const name = nameOf(c);
            return (
              <Card key={c.id} onPress={() => { set({ selectedClientId: c.id, selectedClientName: name }); go('admin-client-detail'); }} colors={c.is_paused ? ['rgba(84,62,20,0.5)', 'rgba(38,28,14,0.55)'] : ['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border={hexA(c.is_paused ? C.gold : c.status === 'discontinued' ? C.red : '#94A3B8', c.is_paused ? 0.45 : c.status === 'discontinued' ? 0.3 : 0.12)} radius={15} style={{ padding: 12, gap: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Avatar initial={(name[0] ?? '?').toUpperCase()} size={36} colors={avColors(name)} fontSize={14} />
                  <View style={{ flex: 1 }}>
                    <Body numberOfLines={1} style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{name}</Body>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2, alignItems: 'center' }}>
                      {c.phone ? (
                        <Pressable onPress={() => Linking.openURL(`tel:${c.phone}`)} hitSlop={6} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                          <Icon name="phone" size={9} color={C.blue} strokeWidth={2.2} />
                          <Body style={{ fontSize: 10, color: C.blue }}>{c.phone}</Body>
                        </Pressable>
                      ) : null}
                      {c.email ? <Body numberOfLines={1} style={{ flexShrink: 1, fontSize: 10, color: C.muted3 }}>{c.email}</Body> : null}
                    </View>
                  </View>
                  <Pressable onPress={() => setOpen(c)} hitSlop={8} style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="bars" size={13} color={C.muted2} strokeWidth={2.2} />
                  </Pressable>
                  <Icon name="chevRight" size={13} color={C.muted3} strokeWidth={2.2} />
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                  <Badge text={c.client_source} color={c.client_source === 'B2C' ? C.blue : C.purple} />
                  {c.subscription_type ? <Badge text={c.subscription_type} color={C.gold} /> : <Badge text="No sub" color={'#94A3B8'} />}
                  {c.is_odds_converted ? <Badge text="ODDS" color={C.green} /> : null}
                  {c.is_paused ? <Badge text="Paused" color={C.gold} /> : null}
                  {c.status === 'discontinued' ? <Badge text="Discontinued" color={C.red} /> : c.status === 'inactive' ? <Badge text="Inactive" color={'#94A3B8'} /> : null}
                  <View style={{ flex: 1 }} />
                  <Mono style={{ fontSize: 8, letterSpacing: 0.4, color: C.muted3 }}>{c.sessions} SESSIONS</Mono>
                </View>
                {c.is_paused ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10, backgroundColor: hexA(C.gold, 0.1), borderWidth: 1, borderColor: hexA(C.gold, 0.3), alignSelf: 'flex-start' }}>
                    <Icon name="clock" size={11} color={C.gold} strokeWidth={2.2} />
                    <Body style={{ fontSize: 10.5, color: '#F2C066' }}>
                      Paused {fmtPause(c.pause_start)} → {c.pause_end ? fmtPause(c.pause_end) : 'open-ended'}
                    </Body>
                  </View>
                ) : null}
                {c.trainers.length ? <Body numberOfLines={1} style={{ fontSize: 10, color: C.muted2 }}>Trainers: <Text style={{ color: C.ink2 }}>{c.trainers.join(', ')}</Text></Body> : null}
              </Card>
            );
          })}
          {!debounced && pages > 1 ? (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {(([['Previous', -1, page <= 1], ['Next', 1, page >= pages]]) as [string, number, boolean][]).map(([lab, dir, disabled]) => (
                <Pressable key={lab} disabled={disabled} onPress={() => setPage((p) => p + dir)} style={{ flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)', opacity: disabled ? 0.4 : 1 }}>
                  <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: C.orange }}>{lab}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </>
      )}
      {open ? <ClientSheet c={open} profileId={profileId} onClose={() => setOpen(null)} /> : null}
    </Page>
  );
}
