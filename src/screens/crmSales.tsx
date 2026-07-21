import React from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator, Alert } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C, F, hexA, ORANGE_GRAD } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono, Card, ProgressBar } from '../components/primitives';
import { Page, BackLink, Badge, MiniAvatar, AnimChip } from './common';
import { useStore } from '../store';
import { useAuth } from '../auth';
import { useCrmClientList, useCrmClientDetail, usePackageCycle } from '../lib/crmClientQueries';
import { useSalesTargets, useCreateSalesTarget, useUpdateSalesTarget, useGenerationInfo, TARGET_TYPES, SalesTarget, SalesTargetType, SalesStatus } from '../lib/salesQueries';
import { SheetShell } from './reportDetail';

/* ============ CRM: Sales Tracker — live pipeline over sales_tracker.
   List mirrors the web CRMSalesTracker (status tabs, KPIs, urgency);
   CrmSalesDetail mirrors CRMSalesTrackerDetails (consumption + Add CTA). ============ */

const istD = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' }) : '—');
const initials = (n: string) => n.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
const AVS: [string, string][] = [['#F0883E', '#C05621'], ['#4FD1C5', '#2C7A7B'], ['#B794F4', '#6B46C1'], ['#F687B3', '#B83280'], ['#68D391', '#276749'], ['#63B3ED', '#2B6CB0']];
const typeMeta = (t: SalesTargetType) => TARGET_TYPES.find((x) => x.id === t) ?? TARGET_TYPES[0];

const INPUT = {
  paddingVertical: 9, paddingHorizontal: 11, borderRadius: 11,
  borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', backgroundColor: 'rgba(0,0,0,0.25)',
  color: '#fff', fontFamily: F.body, fontSize: 13.5,
} as const;

type Filter = 'all' | 'action' | 'none';

/* ---------- Shared target card (list + detail) ---------- */
function TargetCard({ t }: { t: SalesTarget }) {
  const updateM = useUpdateSalesTarget();
  const [losing, setLosing] = React.useState(false);
  const [lostReason, setLostReason] = React.useState('');
  const [notesOpen, setNotesOpen] = React.useState(false);
  const col = t.status === 'won' ? C.green : t.status === 'lost' ? C.red : t.overdue ? C.red : t.closingSoon ? C.gold : C.blue;
  const tm = typeMeta(t.type);

  const markWon = () => Alert.alert('Mark as won?', `${t.clientName} — ${t.value}`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Won 🏆', onPress: () => updateM.mutate({ id: t.id, status: 'won' }, { onError: (e: any) => Alert.alert("Couldn't update", e?.message) }) },
  ]);
  const confirmLost = () => {
    if (!lostReason.trim()) return;
    updateM.mutate({ id: t.id, status: 'lost', lostReason: lostReason.trim() }, { onError: (e: any) => Alert.alert("Couldn't update", e?.message) });
    setLosing(false); setLostReason('');
  };
  const reopen = () => updateM.mutate({ id: t.id, status: 'open' }, { onError: (e: any) => Alert.alert("Couldn't update", e?.message) });

  return (
    <View style={{ padding: 11, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.24)', borderWidth: 1, borderColor: hexA(col, 0.2), borderLeftWidth: 3, borderLeftColor: col, gap: 7 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <Badge text={tm.label} color={tm.color} />
        <Badge text={t.status === 'open' ? (t.overdue ? 'Overdue' : t.closingSoon ? 'Closing Soon' : 'Open') : t.status === 'won' ? 'Won' : 'Lost'} color={col} />
        <View style={{ flex: 1 }} />
        {t.opsNotes.length ? (
          <Pressable onPress={() => setNotesOpen(!notesOpen)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 9, borderRadius: 999, backgroundColor: hexA(C.purple, 0.1), borderWidth: 1, borderColor: hexA(C.purple, 0.35) }}>
            <Icon name="bubble" size={10} color={C.purple} strokeWidth={2.2} />
            <Text style={{ fontFamily: F.bodyBold, fontSize: 10, color: C.purple }}>{t.opsNotes.length}</Text>
          </Pressable>
        ) : null}
      </View>
      <Body style={{ fontSize: 13, color: '#fff', fontFamily: F.bodySemi }}>{t.value}</Body>
      <Mono style={{ fontSize: 8.5, color: C.muted3 }}>
        {t.status === 'open'
          ? (t.expectedClose ? `DUE ${istD(t.expectedClose).toUpperCase()}` : 'NO CLOSE DATE')
          : t.status === 'won' ? `WON ${istD(t.closedAt).toUpperCase()}` : `LOST${t.lostReason ? ` — ${t.lostReason}` : ''}`}
        {'  ·  BY '}{t.ownerName.toUpperCase()}
      </Mono>
      {t.notes ? <Body style={{ fontSize: 11.5, color: C.muted2 }} numberOfLines={2}>{t.notes}</Body> : null}
      {notesOpen && t.opsNotes.length ? (
        <View style={{ gap: 5, padding: 9, borderRadius: 10, backgroundColor: hexA(C.purple, 0.05), borderWidth: 1, borderColor: hexA(C.purple, 0.2) }}>
          <Mono style={{ fontSize: 7.5, letterSpacing: 0.8, color: C.purple }}>OPS COACHING NOTES</Mono>
          {t.opsNotes.map((n) => (
            <View key={n.id} style={{ gap: 2 }}>
              <Body style={{ fontSize: 11.5, color: C.ink3 }}>{n.note}</Body>
              <Mono style={{ fontSize: 7.5, color: C.muted3 }}>{(n.category || '').replace(/_/g, ' ').toUpperCase()} · {n.by_name?.toUpperCase() ?? ''} · {istD(n.at)}</Mono>
            </View>
          ))}
        </View>
      ) : null}
      {t.status === 'open' ? (
        losing ? (
          <View style={{ gap: 7 }}>
            <TextInput value={lostReason} onChangeText={setLostReason} placeholder="Why was it lost? (required)" placeholderTextColor={C.muted3} autoFocus style={INPUT} />
            <View style={{ flexDirection: 'row', gap: 7 }}>
              <Pressable onPress={() => { setLosing(false); setLostReason(''); }} style={{ flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.05)' }}><Text style={{ fontFamily: F.bodySemi, fontSize: 11.5, color: C.muted }}>Cancel</Text></Pressable>
              <Pressable onPress={confirmLost} disabled={!lostReason.trim()} style={{ flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 10, backgroundColor: hexA(C.red, 0.16), borderWidth: 1, borderColor: hexA(C.red, 0.4), opacity: lostReason.trim() ? 1 : 0.5 }}><Text style={{ fontFamily: F.bodyBold, fontSize: 11.5, color: C.red }}>Confirm Lost</Text></Pressable>
            </View>
          </View>
        ) : (
          <View style={{ flexDirection: 'row', gap: 7 }}>
            <Pressable onPress={markWon} style={{ flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 10, backgroundColor: hexA(C.green, 0.13), borderWidth: 1, borderColor: hexA(C.green, 0.4) }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 11.5, color: C.green }}>Mark Won</Text>
            </Pressable>
            <Pressable onPress={() => setLosing(true)} style={{ flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 10, backgroundColor: hexA(C.red, 0.09), borderWidth: 1, borderColor: hexA(C.red, 0.3) }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 11.5, color: C.red }}>Mark Lost</Text>
            </Pressable>
          </View>
        )
      ) : (
        <Pressable onPress={reopen} style={{ alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, backgroundColor: hexA(C.blue, 0.1), borderWidth: 1, borderColor: hexA(C.blue, 0.35) }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 10.5, color: C.blue }}>Reopen</Text>
        </Pressable>
      )}
    </View>
  );
}

/* ================= LIST ================= */
export function CrmSales() {
  const { go, set } = useStore();
  const { session } = useAuth();
  const crmId = session?.user?.id ?? null;
  const targetsQ = useSalesTargets(crmId);
  const clientsQ = useCrmClientList(crmId, 'active');
  const inactiveQ = useCrmClientList(crmId, 'inactive');
  const [statusTab, setStatusTab] = React.useState<'active' | 'inactive' | 'no_package'>('active');
  const [filter, setFilter] = React.useState<Filter>('all');
  const [query, setQuery] = React.useState('');

  const targets = targetsQ.data ?? [];
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const wonThisMonth = (t: SalesTarget) => t.status === 'won' && !!t.closedAt && new Date(t.closedAt) >= monthStart;

  const kpis = {
    open: targets.filter((t) => t.status === 'open').length,
    overdue: targets.filter((t) => t.overdue).length,
    soon: targets.filter((t) => t.closingSoon).length,
    wonMonth: targets.filter(wonThisMonth).length,
  };

  const q = query.trim().toLowerCase();
  const byClient = React.useMemo(() => {
    const m = new Map<string, SalesTarget[]>();
    targets.forEach((t) => m.set(t.clientId, [...(m.get(t.clientId) ?? []), t]));
    return m;
  }, [targets]);

  const active = clientsQ.data ?? [];
  const inactive = inactiveQ.data ?? [];
  const tabCounts = {
    active: active.filter((c) => c.hasPackage).length,
    inactive: inactive.filter((c) => c.hasPackage).length,
    no_package: [...active, ...inactive].filter((c) => !c.hasPackage).length,
  };

  const source = React.useMemo(() =>
    statusTab === 'active' ? active.filter((c) => c.hasPackage)
    : statusTab === 'inactive' ? inactive.filter((c) => c.hasPackage)
    : [...active, ...inactive].filter((c) => !c.hasPackage),
  [active, inactive, statusTab]);

  const groups = React.useMemo(() => {
    const rows = source.map((c) => ({
      clientId: c.id, clientName: c.name, subscription: c.subscription,
      pkg: [c.package ? `${c.package} sess.` : null, c.packageDuration ? `${c.packageDuration} mo` : null, c.monthly ? 'Monthly' : null].filter(Boolean).join(' · ') || null,
      rows: byClient.get(c.id) ?? [],
    }));
    const matches = (g: typeof rows[number]) => {
      if (filter === 'action') return g.rows.some((t) => t.status === 'open');
      if (filter === 'none') return g.rows.length === 0;
      return true;
    };
    const score = (g: typeof rows[number]) =>
      g.rows.some((t) => t.overdue) ? 0 : g.rows.some((t) => t.closingSoon) ? 1 : g.rows.some((t) => t.status === 'open') ? 2 : g.rows.length ? 3 : 4;
    return rows
      .filter(matches)
      .filter((g) => !q || g.clientName.toLowerCase().includes(q) || g.rows.some((t) => t.value.toLowerCase().includes(q)))
      .sort((a, b) => score(a) - score(b) || a.clientName.localeCompare(b.clientName));
  }, [source, byClient, filter, q]);

  const openDetail = (id: string, name: string) => { set({ selectedClientId: id, selectedClientName: name }); go('crm-sales-detail'); };

  // One glanceable pill per client row.
  const rowPill = (rows: SalesTarget[]) => {
    if (!rows.length) return { text: 'No CTA yet', color: C.muted2 };
    const overdue = rows.filter((t) => t.overdue).length;
    if (overdue) return { text: `${overdue} overdue`, color: C.red };
    const soon = rows.filter((t) => t.closingSoon).length;
    if (soon) return { text: `${soon} closing soon`, color: C.gold };
    const open = rows.filter((t) => t.status === 'open').length;
    if (open) return { text: `${open} open`, color: C.blue };
    const won = rows.filter((t) => t.status === 'won').length;
    if (won) return { text: `${won} won`, color: C.green };
    return { text: 'lost', color: C.muted2 };
  };

  return (
    <Page gap={13} pt={6}>
      <View>
        <Serif style={{ fontSize: 24 }}>Sales Tracker</Serif>
        <Body style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>Tap a client to see their sales overview & add CTAs</Body>
      </View>

      {/* One thin stat strip */}
      <View style={{ flexDirection: 'row', borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.28)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
        {([['OPEN', kpis.open, C.blue], ['OVERDUE', kpis.overdue, C.red], ['CLOSING 7D', kpis.soon, C.gold], ['WON · MTH', kpis.wonMonth, C.green]] as [string, number, string][]).map(([lab, val, col], i) => (
          <View key={lab} style={{ flex: 1, alignItems: 'center', paddingVertical: 10, gap: 2, borderLeftWidth: i ? 1 : 0, borderLeftColor: 'rgba(255,255,255,0.06)' }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 16, color: col }}>{targetsQ.isLoading ? '…' : val}</Text>
            <Mono style={{ fontSize: 6.5, letterSpacing: 0.6, color: C.muted3 }}>{lab}</Mono>
          </View>
        ))}
      </View>

      {/* Status tabs */}
      <View style={{ flexDirection: 'row', gap: 6, padding: 4, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.28)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' }}>
        {([['active', 'Active', tabCounts.active], ['inactive', 'Inactive', tabCounts.inactive], ['no_package', 'No Package', tabCounts.no_package]] as const).map(([id, label, n]) => {
          const tabActive = statusTab === id;
          return (
            <AnimChip key={id} grow active={tabActive} onPress={() => { setStatusTab(id); setFilter('all'); }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 9, borderRadius: 10, overflow: 'hidden', backgroundColor: tabActive ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
              {tabActive ? <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} /> : null}
              <Text style={{ fontFamily: tabActive ? F.bodyBold : F.bodySemi, fontSize: 12, color: tabActive ? '#fff' : C.muted }}>{label}</Text>
              {(clientsQ.data && inactiveQ.data) ? <Text style={{ fontFamily: F.mono, fontSize: 9.5, color: tabActive ? 'rgba(255,255,255,0.85)' : C.muted3 }}>{n}</Text> : null}
            </AnimChip>
          );
        })}
      </View>

      {/* Quick filter + search in one row */}
      <View style={{ flexDirection: 'row', gap: 7 }}>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 9, paddingHorizontal: 13, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
          <Icon name="search" size={14} color={C.muted3} strokeWidth={2} />
          <TextInput value={query} onChangeText={setQuery} placeholder="Search clients…" placeholderTextColor={C.muted3} autoCorrect={false} style={{ flex: 1, fontFamily: F.body, fontSize: 13.5, color: '#fff', padding: 0 }} />
        </View>
        {([['all', 'All'], ['action', 'Open'], ['none', 'No CTA']] as [Filter, string][]).map(([id, label]) => {
          const activeF = filter === id;
          return (
            <AnimChip key={id} active={activeF} onPress={() => setFilter(id)} style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 9, paddingHorizontal: 12, borderRadius: 12, backgroundColor: activeF ? hexA(C.orange, 0.15) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: activeF ? hexA(C.orange, 0.5) : 'rgba(255,255,255,0.08)' }}>
            <Text style={{ fontFamily: activeF ? F.bodyBold : F.bodySemi, fontSize: 11.5, color: activeF ? C.orange : C.muted }}>{label}</Text>
            </AnimChip>
          );
        })}
      </View>

      {/* Client rows — one line each, like the web table */}
      {targetsQ.isLoading || clientsQ.isLoading || inactiveQ.isLoading ? (
        <View style={{ alignItems: 'center', gap: 8, paddingVertical: 30 }}>
          <ActivityIndicator color={C.orange} />
          <Body style={{ fontSize: 12.5, color: C.muted3 }}>Loading pipeline…</Body>
        </View>
      ) : groups.length === 0 ? (
        <View style={{ alignItems: 'center', gap: 10, paddingVertical: 28 }}>
          <Icon name="target" size={26} color={C.muted3} strokeWidth={1.8} />
          <Body style={{ fontSize: 12.5, color: C.muted2, textAlign: 'center' }}>Nothing matches.</Body>
        </View>
      ) : (
        <View style={{ borderRadius: 17, backgroundColor: 'rgba(24,17,14,0.55)', borderWidth: 1, borderColor: 'rgba(255,150,90,0.12)', overflow: 'hidden' }}>
          {groups.slice(0, 60).map((g, gi) => {
            const pill = rowPill(g.rows);
            return (
              <Pressable key={g.clientId} onPress={() => openDetail(g.clientId, g.clientName)} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 12, paddingHorizontal: 13, borderTopWidth: gi ? 1 : 0, borderTopColor: 'rgba(255,255,255,0.05)' }}>
                <MiniAvatar initial={initials(g.clientName)} colors={AVS[gi % AVS.length]} size={38} />
                <View style={{ flex: 1 }}>
                  <Body numberOfLines={1} style={{ fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }}>{g.clientName}</Body>
                  <Body numberOfLines={1} style={{ fontSize: 11, color: C.muted2, marginTop: 2 }}>
                    {[g.pkg, g.subscription].filter(Boolean).join('  ·  ') || 'No package details'}
                  </Body>
                </View>
                <View style={{ paddingVertical: 5, paddingHorizontal: 11, borderRadius: 999, backgroundColor: hexA(pill.color, 0.12), borderWidth: 1, borderColor: hexA(pill.color, 0.35) }}>
                  <Text style={{ fontFamily: F.bodySemi, fontSize: 10.5, color: pill.color }}>{pill.text}</Text>
                </View>
                <Icon name="chevRight" size={15} color={C.muted3} strokeWidth={2.2} />
              </Pressable>
            );
          })}
        </View>
      )}
      {groups.length > 60 ? <Body style={{ fontSize: 11, color: C.muted3, textAlign: 'center' }}>+{groups.length - 60} more — refine the search</Body> : null}
    </Page>
  );
}

/* ================= DETAIL (Sales Overview — mirrors CRMSalesTrackerDetails) ================= */
export function CrmSalesDetail() {
  const { selectedClientId: clientId, selectedClientName, back, canGoBack, go } = useStore();
  const { session } = useAuth();
  const crmId = session?.user?.id ?? null;
  const detailQ = useCrmClientDetail(clientId);
  const pkgQ = usePackageCycle(clientId);
  const genQ = useGenerationInfo(clientId);
  const targetsQ = useSalesTargets(crmId);
  const [addOpen, setAddOpen] = React.useState(false);

  const client = detailQ.data?.client;
  const name = selectedClientName ?? (client ? `${client.first_name ?? ''} ${client.last_name ?? ''}`.trim() : 'Client');
  const pkg = pkgQ.data;
  const myTargets = (targetsQ.data ?? []).filter((t) => t.clientId === clientId);
  const pctUsed = pkg && pkg.totalSessions ? Math.min(100, Math.round((pkg.completed / pkg.totalSessions) * 100)) : 0;
  const remaining = pkg && pkg.totalSessions ? Math.max(0, pkg.totalSessions - pkg.completed) : null;

  return (
    <Page gap={14} pt={6}>
      <BackLink label="Sales Tracker" onPress={() => (canGoBack ? back() : go('crm-sales'))} />

      {detailQ.isLoading ? (
        <View style={{ alignItems: 'center', gap: 8, paddingVertical: 40 }}>
          <ActivityIndicator color={C.orange} />
          <Body style={{ fontSize: 12.5, color: C.muted3 }}>Loading sales overview…</Body>
        </View>
      ) : !client ? (
        <Body style={{ color: C.red, textAlign: 'center', paddingVertical: 30 }}>Couldn't load this client.</Body>
      ) : (
        <>
          {/* Hero */}
          <Card colors={['rgba(72,40,22,0.55)', 'rgba(15,11,10,0.62)']} border="rgba(255,150,90,0.18)" radius={20} style={{ overflow: 'hidden' }}>
            <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 3 }} />
            <View style={{ padding: 15, gap: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <MiniAvatar initial={initials(name)} colors={AVS[0]} size={48} />
                <View style={{ flex: 1 }}>
                  <Mono style={{ fontSize: 8, letterSpacing: 1.2, color: C.orange }}>SALES OVERVIEW</Mono>
                  <Serif style={{ fontSize: 21, marginTop: 2 }} numberOfLines={1}>{name}</Serif>
                  {detailQ.data?.subscription ? <View style={{ alignSelf: 'flex-start', marginTop: 5 }}><Badge text={detailQ.data.subscription} color={C.gold} /></View> : null}
                </View>
              </View>
              <Pressable onPress={() => setAddOpen(true)}>
                <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 12, borderRadius: 12 }}>
                  <Icon name="plus" size={14} color="#fff" strokeWidth={2.6} />
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: '#fff' }}>Add CTA</Text>
                </LinearGradient>
              </Pressable>
            </View>
          </Card>

          {/* Generation pool notice */}
          {genQ.data?.pooled ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 11, borderRadius: 13, backgroundColor: hexA(C.gold, 0.07), borderWidth: 1, borderColor: hexA(C.gold, 0.3) }}>
              <Icon name="users" size={14} color={C.gold} strokeWidth={2.2} />
              <Body style={{ flex: 1, fontSize: 11.5, color: C.ink3 }}>Sessions shared from <Text style={{ fontFamily: F.bodySemi, color: C.gold }}>{genQ.data.adminName ?? 'the generation admin'}</Text>'s generation pool.</Body>
            </View>
          ) : null}

          {/* Session consumption */}
          <Card colors={['rgba(46,28,18,0.4)', 'rgba(16,12,11,0.55)']} border={hexA(C.blue, 0.14)} radius={18} style={{ overflow: 'hidden' }}>
            <LinearGradient colors={[hexA(C.blue, 0.55), 'rgba(255,255,255,0.02)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 2.5 }} />
            <View style={{ padding: 14, gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                <View style={{ width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: hexA(C.blue, 0.12), borderWidth: 1, borderColor: hexA(C.blue, 0.28) }}>
                  <Icon name="activity" size={15} color={C.blue} strokeWidth={2.1} />
                </View>
                <Body style={{ flex: 1, fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>Session Consumption</Body>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 18, color: pctUsed >= 85 ? C.red : C.blue }}>{pkgQ.isLoading ? '…' : `${pctUsed}%`}<Text style={{ fontSize: 10, color: C.muted2 }}> used</Text></Text>
              </View>
              {pkgQ.isLoading ? <Body style={{ fontSize: 12, color: C.muted3, textAlign: 'center' }}>Computing…</Body> : pkg ? (
                <>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6 }}>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 26, color: '#fff' }}>{pkg.completed}</Text>
                    <Text style={{ fontFamily: F.body, fontSize: 13, color: C.muted2, marginBottom: 4 }}>of {pkg.totalSessions || '—'}</Text>
                  </View>
                  <ProgressBar pct={pctUsed} height={7} fill={pctUsed >= 85 ? C.red : C.blue} />
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Body style={{ flex: 1, fontSize: 11, color: C.muted2 }}>{remaining != null ? `${remaining} sessions remaining` : 'No package size set'}</Body>
                    <Mono style={{ fontSize: 8.5, color: C.muted3 }}>CYCLE {pkg.currentCycle} · {pkg.completed}/{pkg.totalSessions || '—'}</Mono>
                  </View>
                </>
              ) : null}
            </View>
          </Card>

          {/* Package tiles */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {([['layers', 'SUBSCRIPTION TYPE', detailQ.data?.subscription ?? '—', C.gold],
               ['target', 'CURRENT PACKAGE', client.session_package ? `${client.session_package} sessions` : '—', C.orange],
               ['clock', 'DURATION', client.package_duration ? `${client.package_duration} months` : client.is_monthly_subscription ? 'Monthly' : '—', C.blue]] as [string, string, string, string][]).map(([icon, lab, val, col]) => (
              <View key={lab} style={{ flexGrow: 1, minWidth: '29%', padding: 12, borderRadius: 14, backgroundColor: hexA(col, 0.06), borderWidth: 1, borderColor: hexA(col, 0.22), gap: 6 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Icon name={icon as any} size={12} color={col} strokeWidth={2.2} />
                  <Mono style={{ fontSize: 7, letterSpacing: 0.6, color: C.muted3 }}>{lab}</Mono>
                </View>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: '#fff' }} numberOfLines={1}>{val}</Text>
              </View>
            ))}
          </View>

          {/* CTAs for this client */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 2 }}>
            <Mono style={{ fontSize: 9, letterSpacing: 1.4, color: '#8A6A4E' }}>CTA TARGETS</Mono>
            <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.05)' }} />
            {targetsQ.data ? <Mono style={{ fontSize: 9, color: C.muted3 }}>{myTargets.length}</Mono> : null}
          </View>
          {targetsQ.isLoading ? <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 14 }}>Loading targets…</Body>
            : myTargets.length === 0 ? (
              <View style={{ alignItems: 'center', gap: 8, paddingVertical: 20 }}>
                <Icon name="target" size={24} color={C.muted3} strokeWidth={1.8} />
                <Body style={{ fontSize: 12, color: C.muted2 }}>No CTAs yet — add the first one above.</Body>
              </View>
            ) : myTargets.map((t) => <TargetCard key={t.id} t={t} />)}

          <AddCtaSheet
            visible={addOpen}
            onClose={() => setAddOpen(false)}
            crmId={crmId}
            clientId={clientId!}
            clientName={name}
            currentSubscription={detailQ.data?.subscription ?? null}
            currentPackage={client.session_package ? `${client.session_package} sessions` : null}
          />
        </>
      )}
    </Page>
  );
}

/* ---------- Add CTA sheet (mirrors the web dialog: structured package inputs + status) ---------- */
function AddCtaSheet({ visible, onClose, crmId, clientId, clientName, currentSubscription, currentPackage }: {
  visible: boolean; onClose: () => void; crmId: string | null; clientId: string; clientName: string;
  currentSubscription: string | null; currentPackage: string | null;
}) {
  const createM = useCreateSalesTarget();
  const [type, setType] = React.useState<SalesTargetType>('package');
  const [sessions, setSessions] = React.useState('');
  const [duration, setDuration] = React.useState('');
  const [value, setValue] = React.useState('');
  const [status, setStatus] = React.useState<SalesStatus>('open');
  const [lostReason, setLostReason] = React.useState('');
  const [closeDays, setCloseDays] = React.useState<number | null>(14);
  const [notes, setNotes] = React.useState('');

  const composedValue = type === 'package'
    ? [sessions.trim() ? `${sessions.trim()} sessions` : '', duration.trim() ? `${duration.trim()} months` : ''].filter(Boolean).join(' · ')
    : value.trim();
  const valid = !!composedValue && (status !== 'lost' || !!lostReason.trim());

  const submit = async () => {
    if (!crmId || !valid) return;
    const expectedClose = status === 'open' && closeDays != null ? new Date(Date.now() + closeDays * 864e5).toISOString().slice(0, 10) : null;
    try {
      await createM.mutateAsync({ crmId, clientId, type, value: composedValue, status, lostReason: lostReason.trim() || null, expectedClose, notes: notes || null });
      setSessions(''); setDuration(''); setValue(''); setNotes(''); setStatus('open'); setLostReason(''); setType('package'); setCloseDays(14);
      onClose();
    } catch (e: any) { Alert.alert("Couldn't create CTA", e?.message ?? 'Try again.'); }
  };

  return (
    <SheetShell visible={visible} onClose={onClose} accent={C.orange} icon="target" title="Add CTA Target" subtitle={clientName.toUpperCase()}>
      {/* Currently using */}
      <View style={{ padding: 12, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.26)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', gap: 8 }}>
        <Mono style={{ fontSize: 7.5, letterSpacing: 0.9, color: C.muted3 }}>CURRENTLY USING</Mono>
        <View style={{ flexDirection: 'row', gap: 16 }}>
          <View style={{ flex: 1 }}>
            <Mono style={{ fontSize: 7, color: C.muted3 }}>SUBSCRIPTION</Mono>
            <Body style={{ fontSize: 13, color: '#fff', fontFamily: F.bodySemi, marginTop: 2 }}>{currentSubscription ?? '—'}</Body>
          </View>
          <View style={{ flex: 1 }}>
            <Mono style={{ fontSize: 7, color: C.muted3 }}>PACKAGE</Mono>
            <Body style={{ fontSize: 13, color: '#fff', fontFamily: F.bodySemi, marginTop: 2 }}>{currentPackage ?? '—'}</Body>
          </View>
        </View>
      </View>

      <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.muted3 }}>TARGET TYPE</Mono>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {TARGET_TYPES.map((tt) => {
          const active = type === tt.id;
          return (
            <AnimChip key={tt.id} grow active={active} onPress={() => setType(tt.id)} style={{ alignItems: 'center', paddingVertical: 9, borderRadius: 11, backgroundColor: active ? hexA(tt.color, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(tt.color, 0.5) : 'rgba(255,255,255,0.09)' }}>
              <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 11.5, color: active ? tt.color : C.muted }}>{tt.label}</Text>
            </AnimChip>
          );
        })}
      </View>

      {type === 'package' ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1, gap: 5 }}>
            <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.muted3 }}>SESSIONS *</Mono>
            <TextInput value={sessions} onChangeText={setSessions} placeholder="e.g. 24" placeholderTextColor={C.muted3} keyboardType="number-pad" style={INPUT} />
          </View>
          <View style={{ flex: 1, gap: 5 }}>
            <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.muted3 }}>DURATION (MONTHS)</Mono>
            <TextInput value={duration} onChangeText={setDuration} placeholder="e.g. 3" placeholderTextColor={C.muted3} keyboardType="number-pad" style={INPUT} />
          </View>
        </View>
      ) : (
        <>
          <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.muted3 }}>{type === 'subscription' ? 'SUBSCRIPTION PITCHED *' : 'SERVICE PITCHED *'}</Mono>
          <TextInput value={value} onChangeText={setValue} placeholder={type === 'subscription' ? 'e.g. Odds Lux upgrade' : 'e.g. Physio block · 6 sessions'} placeholderTextColor={C.muted3} style={INPUT} />
        </>
      )}

      <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.muted3 }}>STATUS</Mono>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {([['open', 'Open', C.blue], ['won', 'Won', C.green], ['lost', 'Lost', C.red]] as [SalesStatus, string, string][]).map(([id, label, col]) => {
          const active = status === id;
          return (
            <AnimChip key={id} grow active={active} onPress={() => setStatus(id)} style={{ alignItems: 'center', paddingVertical: 9, borderRadius: 11, backgroundColor: active ? hexA(col, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(col, 0.5) : 'rgba(255,255,255,0.09)' }}>
              <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 11.5, color: active ? col : C.muted }}>{label}</Text>
            </AnimChip>
          );
        })}
      </View>
      {status === 'lost' ? (
        <TextInput value={lostReason} onChangeText={setLostReason} placeholder="Why was it lost? (required)" placeholderTextColor={C.muted3} style={INPUT} />
      ) : null}

      {status === 'open' ? (
        <>
          <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.muted3 }}>EXPECTED CLOSE</Mono>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {([[7, '1 week'], [14, '2 weeks'], [30, '1 month'], [null, 'No date']] as [number | null, string][]).map(([v, lbl]) => {
              const active = closeDays === v;
              return (
                <AnimChip key={lbl} grow active={active} onPress={() => setCloseDays(v)} style={{ alignItems: 'center', paddingVertical: 9, borderRadius: 11, backgroundColor: active ? hexA(C.gold, 0.15) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.gold, 0.5) : 'rgba(255,255,255,0.09)' }}>
                  <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 10.5, color: active ? C.gold : C.muted }}>{lbl}</Text>
                </AnimChip>
              );
            })}
          </View>
          {closeDays == null ? <Body style={{ fontSize: 10.5, color: C.red }}>No close date counts as overdue until one is set.</Body> : null}
        </>
      ) : null}

      <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.muted3 }}>NOTES</Mono>
      <TextInput value={notes} onChangeText={setNotes} placeholder="Any context, objections, follow-ups…" placeholderTextColor={C.muted3} multiline style={[INPUT, { minHeight: 60, textAlignVertical: 'top' }]} />
      {composedValue ? <Mono style={{ fontSize: 8.5, color: C.muted3 }}>WILL SAVE AS: “{composedValue.toUpperCase()}”</Mono> : null}
      <Pressable onPress={submit} disabled={!valid || createM.isPending} style={{ opacity: valid && !createM.isPending ? 1 : 0.5 }}>
        <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ alignItems: 'center', paddingVertical: 12, borderRadius: 12 }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: '#fff' }}>{createM.isPending ? 'Saving…' : 'Save CTA Target'}</Text>
        </LinearGradient>
      </Pressable>
    </SheetShell>
  );
}
