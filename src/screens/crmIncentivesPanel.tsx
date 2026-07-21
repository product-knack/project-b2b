import React from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator, Alert } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C, F, hexA, ORANGE_GRAD } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono } from '../components/primitives';
import { Badge, MiniAvatar, AnimChip } from './common';
import { useAuth } from '../auth';
import { useCrmClientList } from '../lib/crmClientQueries';
import {
  useMyIncentives, usePendingIncentiveRequests, useIncentiveLeaderboard,
  useRaiseIncentiveRequest, EVENT_META,
} from '../lib/incentiveQueries';
import { SheetShell } from './reportDetail';

/* ============ Incentives panel — mirrors the web CRMIncentivesTab:
   My Incentives / Pending Requests / Leaderboard + Raise Request. ============ */

const initials = (n: string) => n.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
const AVS: [string, string][] = [['#F0883E', '#C05621'], ['#4FD1C5', '#2C7A7B'], ['#B794F4', '#6B46C1'], ['#F687B3', '#B83280'], ['#68D391', '#276749'], ['#63B3ED', '#2B6CB0']];
const istD = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' }) : '—');

const INPUT = {
  paddingVertical: 9, paddingHorizontal: 11, borderRadius: 11,
  borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', backgroundColor: 'rgba(0,0,0,0.25)',
  color: '#fff', fontFamily: F.body, fontSize: 13.5,
} as const;

export function IncentivesPanel({ crmId, overview }: {
  crmId: string | null;
  overview?: { approvedReferrals: number; pendingReferrals: number; crossSells: number; packageUpgrades: number; subscriptionUpgrades: number } | null;
}) {
  const [tab, setTab] = React.useState<'mine' | 'pending' | 'board'>('mine');
  const [raiseOpen, setRaiseOpen] = React.useState(false);
  const mineQ = useMyIncentives(tab === 'mine' ? crmId : crmId); // shared cache; always warm
  const pendingQ = usePendingIncentiveRequests(crmId);
  const [period, setPeriod] = React.useState<'month' | 'all'>('month');
  const boardQ = useIncentiveLeaderboard(period);
  const myRank = (boardQ.data ?? []).find((r) => r.userId === crmId);

  return (
    <View style={{ gap: 10 }}>
      {/* Overview tiles */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {([
          ['Referrals', overview?.approvedReferrals ?? 0, `${overview?.pendingReferrals ?? 0} pending`, C.green],
          ['Cross-sells', overview?.crossSells ?? 0, 'total', C.blue],
          ['Pkg upgrades', overview?.packageUpgrades ?? 0, 'total', C.gold],
          ['Sub upgrades', overview?.subscriptionUpgrades ?? 0, 'total', C.purple],
        ] as [string, number, string, string][]).map(([lab, val, sub, col]) => (
          <View key={lab} style={{ width: '47%', flexGrow: 1, padding: 12, borderRadius: 13, backgroundColor: hexA(col, 0.07), borderWidth: 1, borderColor: hexA(col, 0.22) }}>
            <Serif style={{ fontSize: 24, color: col }}>{val}</Serif>
            <Body style={{ fontSize: 11, color: C.ink3, marginTop: 2 }}>{lab}</Body>
            <Mono style={{ fontSize: 9, color: C.muted3, marginTop: 1 }}>{sub.toUpperCase()}</Mono>
          </View>
        ))}
      </View>

      {/* Raise request */}
      <Pressable onPress={() => setRaiseOpen(true)}>
        <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 12, borderRadius: 12 }}>
          <Icon name="plus" size={14} color="#fff" strokeWidth={2.6} />
          <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: '#fff' }}>Raise Request</Text>
        </LinearGradient>
      </Pressable>

      {/* Tabs */}
      <View style={{ flexDirection: 'row', gap: 5, padding: 4, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.28)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' }}>
        {([['mine', 'My Incentives'], ['pending', `Pending${pendingQ.data?.length ? ` · ${pendingQ.data.length}` : ''}`], ['board', 'Leaderboard']] as const).map(([id, label]) => {
          const active = tab === id;
          return (
            <AnimChip key={id} grow active={active} onPress={() => setTab(id)} style={{ alignItems: 'center', paddingVertical: 9, borderRadius: 9, overflow: 'hidden', backgroundColor: active ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
              {active ? <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} /> : null}
              <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 11, color: active ? '#fff' : C.muted }}>{label}</Text>
            </AnimChip>
          );
        })}
      </View>

      {tab === 'mine' ? (
        mineQ.isLoading ? <ActivityIndicator color={C.orange} style={{ paddingVertical: 16 }} />
        : (mineQ.data ?? []).length === 0 ? <Body style={{ fontSize: 12, color: C.muted3, textAlign: 'center', paddingVertical: 12 }}>No approved incentives yet — raise your first request.</Body>
        : (mineQ.data ?? []).slice(0, 20).map((e) => {
          const meta = EVENT_META[e.type] ?? EVENT_META.referral;
          return (
            <View key={e.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 11, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: hexA(meta.color, 0.2), borderLeftWidth: 3, borderLeftColor: meta.color }}>
              <Icon name={meta.icon as any} size={14} color={meta.color} strokeWidth={2.1} />
              <View style={{ flex: 1 }}>
                <Body numberOfLines={1} style={{ fontSize: 13, fontFamily: F.bodySemi, color: '#fff' }}>{e.name}</Body>
                <Mono style={{ fontSize: 8, color: C.muted3, marginTop: 1 }}>{meta.label.toUpperCase()} · {istD(e.date).toUpperCase()}</Mono>
              </View>
              <Badge text={meta.label} color={meta.color} />
            </View>
          );
        })
      ) : tab === 'pending' ? (
        pendingQ.isLoading ? <ActivityIndicator color={C.orange} style={{ paddingVertical: 16 }} />
        : (pendingQ.data ?? []).length === 0 ? <Body style={{ fontSize: 12, color: C.muted3, textAlign: 'center', paddingVertical: 12 }}>Nothing awaiting approval.</Body>
        : (pendingQ.data ?? []).map((r) => {
          const meta = EVENT_META[r.type] ?? EVENT_META.referral;
          return (
            <View key={`${r.type}-${r.id}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 11, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: hexA(C.gold, 0.2), borderLeftWidth: 3, borderLeftColor: hexA(meta.color, 0.8) }}>
              <Icon name={meta.icon as any} size={14} color={meta.color} strokeWidth={2.1} />
              <View style={{ flex: 1 }}>
                <Body numberOfLines={1} style={{ fontSize: 13, fontFamily: F.bodySemi, color: '#fff' }}>{r.clientName}</Body>
                <Body numberOfLines={1} style={{ fontSize: 11, color: C.muted2, marginTop: 1 }}>{r.details}</Body>
                <Mono style={{ fontSize: 7.5, color: C.muted3, marginTop: 1 }}>{meta.label.toUpperCase()} · {istD(r.createdAt).toUpperCase()}</Mono>
              </View>
              <Badge text="Pending" color={C.gold} />
            </View>
          );
        })
      ) : (
        <>
          {/* Your rank + period toggle */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {myRank ? (
              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 12, backgroundColor: hexA(C.orange, 0.08), borderWidth: 1, borderColor: hexA(C.orange, 0.3) }}>
                <Text style={{ fontSize: 15 }}>{myRank.rank === 1 ? '🏆' : myRank.rank === 2 ? '🥈' : myRank.rank === 3 ? '🥉' : '🎯'}</Text>
                <Body style={{ flex: 1, fontSize: 12, color: C.ink3 }}>You're <Text style={{ fontFamily: F.bodyBold, color: C.orange }}>#{myRank.rank}</Text> with {myRank.total} points</Body>
              </View>
            ) : <View style={{ flex: 1 }} />}
            {(['month', 'all'] as const).map((p) => {
              const active = period === p;
              return (
                <AnimChip key={p} active={active} onPress={() => setPeriod(p)} style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: active ? hexA(C.purple, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.purple, 0.5) : 'rgba(255,255,255,0.09)' }}>
                  <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 10.5, color: active ? C.purple : C.muted }}>{p === 'month' ? 'This Month' : 'All Time'}</Text>
                </AnimChip>
              );
            })}
          </View>
          {boardQ.isLoading ? <ActivityIndicator color={C.orange} style={{ paddingVertical: 16 }} />
            : (boardQ.data ?? []).slice(0, 15).map((r, i) => {
              const me = r.userId === crmId;
              return (
                <View key={r.userId} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 12, backgroundColor: me ? hexA(C.orange, 0.08) : 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: me ? hexA(C.orange, 0.35) : 'rgba(255,255,255,0.06)' }}>
                  <Text style={{ width: 26, textAlign: 'center', fontSize: r.rank <= 3 ? 15 : 12, fontFamily: F.bodyBold, color: C.muted }}>
                    {r.rank === 1 ? '🏆' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : `#${r.rank}`}
                  </Text>
                  <MiniAvatar initial={initials(r.name)} colors={AVS[i % AVS.length]} size={30} />
                  <View style={{ flex: 1 }}>
                    <Body numberOfLines={1} style={{ fontSize: 12.5, fontFamily: F.bodySemi, color: me ? C.orange : '#fff' }}>{r.name}{me ? ' (you)' : ''}</Body>
                    <Mono style={{ fontSize: 7.5, color: C.muted3, marginTop: 1 }}>{r.referrals} REF · {r.crossSells} XSELL · {r.packageUpgrades} PKG · {r.subscriptionUpgrades} SUB</Mono>
                  </View>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: C.purple }}>{r.total}</Text>
                </View>
              );
            })}
        </>
      )}

      <RaiseRequestSheet visible={raiseOpen} onClose={() => setRaiseOpen(false)} crmId={crmId} />
    </View>
  );
}

/* ---------- Raise Request sheet (4 types, web-exact payloads) ---------- */
function RaiseRequestSheet({ visible, onClose, crmId }: { visible: boolean; onClose: () => void; crmId: string | null }) {
  const raiseM = useRaiseIncentiveRequest();
  const clientsQ = useCrmClientList(visible ? crmId : null, 'active');
  const [kind, setKind] = React.useState<'referral' | 'subscription_upgrade' | 'cross_sell' | 'package_upgrade'>('referral');
  const [client, setClient] = React.useState<{ id: string; name: string; subscription: string | null; package: string | null } | null>(null);
  const [clientQ, setClientQ] = React.useState('');
  const [f, setF] = React.useState<Record<string, string>>({});
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  React.useEffect(() => { if (visible) { setKind('referral'); setClient(null); setClientQ(''); setF({}); } }, [visible]);
  React.useEffect(() => { setClient(null); }, [kind]);

  const q = clientQ.trim().toLowerCase();
  const clients = (clientsQ.data ?? []).filter((c) => !q || c.name.toLowerCase().includes(q));
  const needsClient = kind !== 'referral';

  const valid = kind === 'referral' ? !!f.name?.trim()
    : kind === 'subscription_upgrade' ? !!client && !!f.next?.trim()
    : kind === 'cross_sell' ? !!client && !!f.service?.trim()
    : !!client && !!f.newSessions?.trim() && !!f.duration?.trim();

  const submit = async () => {
    if (!crmId || !valid) return;
    try {
      if (kind === 'referral') await raiseM.mutateAsync({ kind, crmId, name: f.name, phone: f.phone, email: f.email, notes: f.notes });
      else if (kind === 'subscription_upgrade') await raiseM.mutateAsync({ kind, crmId, clientId: client!.id, previous: client!.subscription, next: f.next, reason: f.reason });
      else if (kind === 'cross_sell') await raiseM.mutateAsync({ kind, crmId, clientId: client!.id, service: f.service, sessions: parseInt(f.sessions) || undefined, notes: f.notes });
      else await raiseM.mutateAsync({ kind, crmId, clientId: client!.id, previousSessions: client!.package, newSessions: f.newSessions, durationMonths: f.duration });
      onClose();
      Alert.alert('Request raised', 'It will show under Pending until approved.');
    } catch (e: any) { Alert.alert("Couldn't raise request", e?.message ?? 'Try again.'); }
  };

  return (
    <SheetShell visible={visible} onClose={onClose} accent={C.purple} icon="gift" title="Raise Request" subtitle="INCENTIVE REQUEST — GOES FOR APPROVAL">
      <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.muted3 }}>REQUEST TYPE</Mono>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {(Object.entries(EVENT_META) as [typeof kind, typeof EVENT_META[string]][]).map(([id, meta]) => {
          const active = kind === id;
          return (
            <AnimChip key={id} active={active} onPress={() => setKind(id)} style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: active ? hexA(meta.color, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(meta.color, 0.55) : 'rgba(255,255,255,0.09)' }}>
              <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 11, color: active ? meta.color : C.muted }}>{meta.label}</Text>
            </AnimChip>
          );
        })}
      </View>

      {kind === 'referral' ? (
        <>
          <TextInput value={f.name ?? ''} onChangeText={(v) => set('name', v)} placeholder="Referred person's name *" placeholderTextColor={C.muted3} style={INPUT} />
          <TextInput value={f.phone ?? ''} onChangeText={(v) => set('phone', v)} placeholder="Phone (optional)" placeholderTextColor={C.muted3} keyboardType="phone-pad" style={INPUT} />
          <TextInput value={f.email ?? ''} onChangeText={(v) => set('email', v)} placeholder="Email (optional)" placeholderTextColor={C.muted3} autoCapitalize="none" style={INPUT} />
          <TextInput value={f.notes ?? ''} onChangeText={(v) => set('notes', v)} placeholder="Notes (optional)" placeholderTextColor={C.muted3} multiline style={[INPUT, { minHeight: 50, textAlignVertical: 'top' }]} />
        </>
      ) : (
        <>
          <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.muted3 }}>CLIENT *</Mono>
          {client ? (
            <Pressable onPress={() => setClient(null)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 12, backgroundColor: hexA(C.purple, 0.1), borderWidth: 1, borderColor: hexA(C.purple, 0.4) }}>
              <Body style={{ flex: 1, fontSize: 13, fontFamily: F.bodySemi, color: '#fff' }}>{client.name}</Body>
              <Icon name="close" size={12} color={C.purple} strokeWidth={2.5} />
            </Pressable>
          ) : (
            <>
              <TextInput value={clientQ} onChangeText={setClientQ} placeholder="Search clients…" placeholderTextColor={C.muted3} style={INPUT} />
              {clients.slice(0, 5).map((c, i) => (
                <Pressable key={c.id} onPress={() => setClient({ id: c.id, name: c.name, subscription: c.subscription, package: c.package })} style={{ flexDirection: 'row', alignItems: 'center', gap: 9, padding: 9, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.22)' }}>
                  <MiniAvatar initial={initials(c.name)} colors={AVS[i % AVS.length]} size={28} />
                  <Body style={{ flex: 1, fontSize: 12.5, color: '#fff' }}>{c.name}</Body>
                </Pressable>
              ))}
            </>
          )}
          {kind === 'subscription_upgrade' ? (
            <>
              {client?.subscription ? <Mono style={{ fontSize: 8.5, color: C.muted3 }}>CURRENT: {client.subscription.toUpperCase()}</Mono> : null}
              <TextInput value={f.next ?? ''} onChangeText={(v) => set('next', v)} placeholder="New subscription type * (e.g. Odds Lux)" placeholderTextColor={C.muted3} style={INPUT} />
              <TextInput value={f.reason ?? ''} onChangeText={(v) => set('reason', v)} placeholder="Reason (optional)" placeholderTextColor={C.muted3} multiline style={[INPUT, { minHeight: 50, textAlignVertical: 'top' }]} />
            </>
          ) : kind === 'cross_sell' ? (
            <>
              <TextInput value={f.service ?? ''} onChangeText={(v) => set('service', v)} placeholder="Service name * (e.g. Physiotherapy block)" placeholderTextColor={C.muted3} style={INPUT} />
              <TextInput value={f.sessions ?? ''} onChangeText={(v) => set('sessions', v)} placeholder="Sessions (optional, e.g. 6)" placeholderTextColor={C.muted3} keyboardType="number-pad" style={INPUT} />
              <TextInput value={f.notes ?? ''} onChangeText={(v) => set('notes', v)} placeholder="Notes (optional)" placeholderTextColor={C.muted3} multiline style={[INPUT, { minHeight: 50, textAlignVertical: 'top' }]} />
            </>
          ) : (
            <>
              {client?.package ? <Mono style={{ fontSize: 8.5, color: C.muted3 }}>CURRENT PACKAGE: {client.package} SESSIONS</Mono> : null}
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TextInput value={f.newSessions ?? ''} onChangeText={(v) => set('newSessions', v)} placeholder="New sessions *" placeholderTextColor={C.muted3} keyboardType="number-pad" style={[INPUT, { flex: 1 }]} />
                <TextInput value={f.duration ?? ''} onChangeText={(v) => set('duration', v)} placeholder="Months *" placeholderTextColor={C.muted3} keyboardType="number-pad" style={[INPUT, { flex: 1 }]} />
              </View>
            </>
          )}
        </>
      )}

      <Pressable onPress={submit} disabled={!valid || raiseM.isPending} style={{ opacity: valid && !raiseM.isPending ? 1 : 0.5 }}>
        <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ alignItems: 'center', paddingVertical: 12, borderRadius: 12 }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: '#fff' }}>{raiseM.isPending ? 'Raising…' : 'Raise Request'}</Text>
        </LinearGradient>
      </Pressable>
    </SheetShell>
  );
}
