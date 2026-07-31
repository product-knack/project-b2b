import React from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator, Alert, Keyboard } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C, F, hexA, ORANGE_GRAD } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono, Card } from '../components/primitives';
import { Page, TitleBlock, HScroll, Badge, MiniAvatar, AnimChip } from './common';
import { SheetShell } from './reportDetail';
import { useAuth } from '../auth';
import {
  useRevenueForecastClients, usePriorityRows, useForecastMonths, derivePrioritySets,
  useMarkPriority, useRemovePriority, useMarkFallShort, useConsumedSinceMark, useAddForecastRemark,
  remarkDue, hasUnansweredRemark, latestRemarkAt, monthKey, monthLabel, shiftMonth,
  SOURCE_LABEL, ForecastClient, PriorityRow, RemarkEntry,
} from '../lib/revenueForecastQueries';
import { useSidebarProfile } from '../lib/navQueries';

/* ============ ADMIN: Revenue Forecast ============
   Web parity: /admin/revenue-forecast. Full client list with multi-select
   "Move to priority", the month's priority list with achievement/remark state,
   and the fall-short archive. All maths live in revenueForecastQueries. */

const ACC = C.gold;
const initials = (n: string) => n.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || 'C';
const AVS: [string, string][] = [['#F0883E', '#C05621'], ['#4FD1C5', '#2C7A7B'], ['#B794F4', '#6B46C1'], ['#F687B3', '#B83280'], ['#68D391', '#276749'], ['#63B3ED', '#2B6CB0']];
const STATUS_TABS = [['all', 'All'], ['active', 'Active'], ['without_subscription', 'No subscription'], ['inactive', 'Inactive'], ['discontinued', 'Discontinued']] as const;

const sessionsLeftColor = (n: number | null) => (n === null ? C.muted3 : n <= 0 ? C.red : n <= 2 ? C.gold : C.ink);
const shortDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: '2-digit' }) : null;

/* ---------- Remark thread (shared shape with the CRM page) ---------- */
export function RemarkThread({ row, canReply, authorName, month }: { row: PriorityRow; canReply: boolean; authorName: string; month: string }) {
  const addM = useAddForecastRemark();
  const [replyFor, setReplyFor] = React.useState<string | null>(null);
  const [replyText, setReplyText] = React.useState('');
  const remarks = row.remarks.filter((r) => r.type === 'remark').sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
  const repliesOf = (id: string) => row.remarks.filter((r) => r.type === 'reply' && r.parent_id === id);
  if (!remarks.length) return <Body style={{ fontSize: 11.5, color: C.muted3 }}>No remarks yet.</Body>;
  const sendReply = async (parentId: string) => {
    if (!replyText.trim()) return;
    try {
      await addM.mutateAsync({ clientId: row.client_id, month, authorName, entry: { type: 'reply', parent_id: parentId, message: replyText.trim() } });
      setReplyText(''); setReplyFor(null); Keyboard.dismiss();
    } catch (e: any) { Alert.alert("Couldn't send reply", e?.message ?? 'Try again.'); }
  };
  return (
    <View style={{ gap: 8 }}>
      {remarks.map((r) => (
        <View key={r.id} style={{ borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', padding: 11, gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
            <Body style={{ flex: 1, fontSize: 11.5, fontFamily: F.bodySemi, color: C.blue }}>{r.author_name || 'CRM'}</Body>
            <Mono style={{ fontSize: 8.5, color: C.muted3 }}>{shortDate(r.created_at)}</Mono>
          </View>
          {r.reason ? <Body style={{ fontSize: 12.5, color: '#fff' }}>{r.reason}</Body> : null}
          {r.plan ? <Body style={{ fontSize: 11.5, color: C.muted2 }}>Plan: {r.plan}</Body> : null}
          {repliesOf(r.id).map((rep) => (
            <View key={rep.id} style={{ marginLeft: 10, borderLeftWidth: 2, borderLeftColor: hexA(ACC, 0.4), paddingLeft: 9, gap: 2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                <Body style={{ flex: 1, fontSize: 11, fontFamily: F.bodySemi, color: ACC }}>{rep.author_name || 'Admin'}</Body>
                <Mono style={{ fontSize: 8, color: C.muted3 }}>{shortDate(rep.created_at)}</Mono>
              </View>
              <Body style={{ fontSize: 12, color: C.ink3 }}>{rep.message}</Body>
            </View>
          ))}
          {canReply ? (
            replyFor === r.id ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                <TextInput value={replyText} onChangeText={setReplyText} placeholder="Reply to this remark…" placeholderTextColor={C.muted3} style={{ flex: 1, paddingVertical: 8, paddingHorizontal: 11, borderRadius: 11, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', backgroundColor: 'rgba(0,0,0,0.25)', color: '#fff', fontFamily: F.body, fontSize: 12.5 }} />
                <Pressable onPress={() => sendReply(r.id)} disabled={addM.isPending} style={{ width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: hexA(ACC, 0.14), borderWidth: 1, borderColor: hexA(ACC, 0.4), opacity: addM.isPending ? 0.5 : 1 }}>
                  <Icon name="send" size={14} color={ACC} strokeWidth={2.1} />
                </Pressable>
              </View>
            ) : (
              <Pressable onPress={() => { setReplyFor(r.id); setReplyText(''); }} hitSlop={6}>
                <Body style={{ fontSize: 11, color: ACC }}>Reply</Body>
              </Pressable>
            )
          ) : null}
        </View>
      ))}
    </View>
  );
}

export function AdminRevenueForecast() {
  const { session } = useAuth();
  const adminId = session?.user?.id ?? '';
  const profile = useSidebarProfile();
  const [month, setMonth] = React.useState(monthKey());
  const [mainTab, setMainTab] = React.useState<'clients' | 'priority' | 'fallshort'>('clients');
  const [statusTab, setStatusTab] = React.useState<(typeof STATUS_TABS)[number][0]>('all');
  const [search, setSearch] = React.useState('');
  const [crmFilter, setCrmFilter] = React.useState<string | null>(null);
  const [needsRenewal, setNeedsRenewal] = React.useState(false);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [shown, setShown] = React.useState(30);
  const [openRow, setOpenRow] = React.useState<string | null>(null);
  const [fallShortFor, setFallShortFor] = React.useState<PriorityRow | null>(null);
  const [fsReason, setFsReason] = React.useState('');

  const clientsQ = useRevenueForecastClients();
  const rowsQ = usePriorityRows(month);
  const monthsQ = useForecastMonths(monthKey());
  const consumedQ = useConsumedSinceMark(rowsQ.data ?? []);
  const markM = useMarkPriority();
  const removeM = useRemovePriority();
  const fallShortM = useMarkFallShort();

  const sets = React.useMemo(() => derivePrioritySets(rowsQ.data ?? []), [rowsQ.data]);
  const byId = React.useMemo(() => new Map((clientsQ.data ?? []).map((c) => [c.clientId, c])), [clientsQ.data]);
  const fellShortCount = (id: string) => {
    const fs = sets.byClient.get(id)?.fall_short;
    if (!fs?.status) return 0;
    return (fs.history?.length ?? 0) + (fs.status === 'fall_short' ? 1 : 0);
  };

  const crmOptions = React.useMemo(() => {
    const m = new Map<string, string>();
    (clientsQ.data ?? []).forEach((c) => { if (c.crmId && c.crmName) m.set(c.crmId, c.crmName); });
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [clientsQ.data]);

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return (clientsQ.data ?? [])
      .filter((c) => statusTab === 'all' || c.statusBucket === statusTab)
      .filter((c) => !crmFilter || c.crmId === crmFilter)
      .filter((c) => !needsRenewal || (c.sessionsLeft !== null && c.sessionsLeft < 2))
      .filter((c) => !q || c.name.toLowerCase().includes(q) || (c.email ?? '').toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [clientsQ.data, statusTab, crmFilter, needsRenewal, search]);

  const priorityList = React.useMemo(() =>
    sets.priorityRowsActive
      .map((r) => ({ row: r, client: byId.get(r.client_id) ?? null }))
      .sort((a, b) => {
        const sa = a.client?.sessionsLeft ?? 9999; const sb = b.client?.sessionsLeft ?? 9999;
        return sa - sb || (a.client?.name ?? '').localeCompare(b.client?.name ?? '');
      }),
    [sets.priorityRowsActive, byId]);

  const toggleSel = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const moveToPriority = () => {
    const ids = [...selected].filter((id) => !sets.priorityIds.has(id));
    if (!ids.length) { Alert.alert('Already priority', 'Everyone selected is already on the priority list.'); return; }
    Alert.alert('Move to priority?', `${ids.length} client${ids.length === 1 ? '' : 's'} will be marked as priority renewals for ${monthLabel(month)}. Their CRMs get notified.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: `Mark ${ids.length}`, onPress: async () => {
        try {
          const map = new Map<string, number | null>();
          ids.forEach((id) => map.set(id, byId.get(id)?.sessionsLeft ?? null));
          await markM.mutateAsync({ clientIds: ids, month, markedBy: adminId, sessionsLeft: map });
          setSelected(new Set());
        } catch (e: any) { Alert.alert("Couldn't mark priority", e?.message ?? 'Try again.'); }
      } },
    ]);
  };
  const removePriority = (row: PriorityRow, name: string) => {
    Alert.alert('Remove from priority?', `${name} will be removed from the ${monthLabel(month)} forecast. Their remark history goes with the row.`, [
      { text: 'Keep', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        try { await removeM.mutateAsync({ clientId: row.client_id, month }); }
        catch (e: any) { Alert.alert("Couldn't remove", e?.message ?? 'Try again.'); }
      } },
    ]);
  };
  const submitFallShort = async () => {
    if (!fallShortFor || !fsReason.trim()) return;
    try {
      await fallShortM.mutateAsync({ row: fallShortFor, reason: fsReason, markedBy: adminId });
      Keyboard.dismiss();
      setTimeout(() => { setFallShortFor(null); setFsReason(''); }, 80);
    } catch (e: any) { Alert.alert("Couldn't mark fall short", e?.message ?? 'Try again.'); }
  };

  const monthIdx = (monthsQ.data ?? [monthKey()]).indexOf(month);
  const authorName = profile.fullName || 'Admin';

  const PriorityCard = ({ row, client }: { row: PriorityRow; client: ForecastClient | null }) => {
    const isOpen = openRow === row.id;
    const achieved = row.achievement.status === 'achieved';
    const unanswered = hasUnansweredRemark(row.remarks);
    const due = remarkDue({ baseline: row.baseline, liveSessionsLeft: client?.sessionsLeft ?? null, consumedSinceMark: consumedQ.data?.get(row.client_id) ?? 0, remarks: row.remarks, achieved });
    const shorts = fellShortCount(row.client_id);
    return (
      <View style={{ borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: unanswered ? hexA(C.gold, 0.45) : achieved ? hexA(C.green, 0.3) : 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
        <Pressable onPress={() => setOpenRow(isOpen ? null : row.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 }}>
          <MiniAvatar initial={initials(client?.name ?? 'C')} colors={AVS[(client?.name ?? '').length % AVS.length]} size={34} />
          <View style={{ flex: 1 }}>
            <Body numberOfLines={1} style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{client?.name ?? 'Client'}</Body>
            <Body style={{ fontSize: 10.5, color: C.muted3, marginTop: 1 }}>
              {client?.crmName ? `CRM: ${client.crmName}` : 'No CRM assigned'} · marked {shortDate(row.baseline?.marked_at ?? row.created_at)}
            </Body>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 3 }}>
            <Text style={{ fontFamily: F.serif, fontSize: 19, color: sessionsLeftColor(client?.sessionsLeft ?? null) }}>{client?.sessionsLeft ?? '–'}</Text>
            <Mono style={{ fontSize: 7.5, color: C.muted3 }}>LEFT</Mono>
          </View>
          <Icon name={isOpen ? 'chevUp' : 'chevDown'} size={15} color={C.muted} strokeWidth={2.2} />
        </Pressable>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 12, paddingBottom: isOpen ? 0 : 12 }}>
          {achieved ? <Badge text={`Achieved · ${SOURCE_LABEL[row.achievement.source ?? ''] ?? 'Payment'}`} color={C.green} /> : <Badge text="Pending" color={C.blue} />}
          {due.due ? <Badge text={`Remark due (${due.pending})`} color={C.gold} /> : null}
          {unanswered ? <Badge text="New remark" color={C.gold} /> : null}
          {shorts > 0 ? <Badge text={`Fell short ${shorts}x`} color={C.red} /> : null}
        </View>
        {isOpen ? (
          <View style={{ padding: 12, gap: 10, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)', marginTop: 10 }}>
            {achieved && row.achievement.amount != null ? (
              <Body style={{ fontSize: 11.5, color: C.green }}>Paid {row.achievement.amount.toLocaleString('en-IN')} on {shortDate(row.achievement.achieved_at)} ({SOURCE_LABEL[row.achievement.source ?? ''] ?? row.achievement.source})</Body>
            ) : null}
            <Body style={{ fontSize: 10.5, color: C.muted3 }}>
              At mark: {row.baseline?.sessions_left_at_mark ?? 'unknown'} sessions left · since then {consumedQ.data?.get(row.client_id) ?? 0} uncompleted slot(s) passed
            </Body>
            <RemarkThread row={row} canReply authorName={authorName} month={month} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable onPress={() => { setFallShortFor(row); setFsReason(''); }} style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 11, backgroundColor: hexA(C.red, 0.08), borderWidth: 1, borderColor: hexA(C.red, 0.3) }}>
                <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: C.red }}>Fall short</Text>
              </Pressable>
              <Pressable onPress={() => removePriority(row, client?.name ?? 'Client')} style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
                <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: C.muted }}>Remove</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <Page gap={13} pt={6} scrollKey="admin-revenue-forecast">
      <TitleBlock title="Revenue Forecast" sub="Priority renewals and CRM follow-through" />

      {/* Month switcher */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Pressable disabled={monthIdx >= (monthsQ.data?.length ?? 1) - 1} onPress={() => setMonth((monthsQ.data ?? [])[monthIdx + 1] ?? shiftMonth(month, -1))} hitSlop={8} style={{ width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', opacity: monthIdx >= (monthsQ.data?.length ?? 1) - 1 ? 0.4 : 1 }}>
          <Icon name="chevLeft" size={14} color={C.muted} strokeWidth={2.3} />
        </Pressable>
        <Body style={{ flex: 1, textAlign: 'center', fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }}>{monthLabel(month)}</Body>
        <Pressable disabled={monthIdx <= 0} onPress={() => setMonth((monthsQ.data ?? [])[monthIdx - 1] ?? shiftMonth(month, 1))} hitSlop={8} style={{ width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', opacity: monthIdx <= 0 ? 0.4 : 1 }}>
          <Icon name="chevRight" size={14} color={C.muted} strokeWidth={2.3} />
        </Pressable>
      </View>

      {/* Main tabs */}
      <View style={{ flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 999, padding: 3 }}>
        {([['clients', `All clients`], ['priority', `Priority (${sets.priorityRowsActive.length})`], ['fallshort', `Fall short (${sets.fallShortRows.length})`]] as const).map(([id, lab]) => {
          const active = mainTab === id;
          return active ? (
            <LinearGradient key={id} colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 999 }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 11.5, color: '#fff' }}>{lab}</Text>
            </LinearGradient>
          ) : (
            <Pressable key={id} onPress={() => setMainTab(id)} style={{ flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 999 }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 11.5, color: C.muted }}>{lab}</Text>
            </Pressable>
          );
        })}
      </View>

      {clientsQ.isLoading || rowsQ.isLoading ? (
        <View style={{ alignItems: 'center', paddingVertical: 30, gap: 8 }}>
          <ActivityIndicator color={ACC} />
          <Body style={{ fontSize: 12, color: C.muted3 }}>Crunching the client book…</Body>
        </View>
      ) : mainTab === 'clients' ? (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 10, paddingHorizontal: 13, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
          <Icon name="search" size={14} color={C.muted3} strokeWidth={2} />
            <TextInput value={search} onChangeText={(t) => { setSearch(t); setShown(30); }} placeholder="Search name or email…" placeholderTextColor={C.muted3} autoCorrect={false} style={{ flex: 1, fontFamily: F.body, fontSize: 13.5, color: '#fff', padding: 0 }} />
          </View>
          <HScroll gap={7}>
            {STATUS_TABS.map(([id, lab]) => (
              <AnimChip key={id} active={statusTab === id} onPress={() => { setStatusTab(id); setShown(30); }} style={{ paddingVertical: 8, paddingHorizontal: 13, borderRadius: 999, backgroundColor: statusTab === id ? hexA(ACC, 0.15) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: statusTab === id ? hexA(ACC, 0.5) : 'rgba(255,255,255,0.09)' }}>
                <Text style={{ fontFamily: statusTab === id ? F.bodyBold : F.bodySemi, fontSize: 11.5, color: statusTab === id ? ACC : C.muted }}>{lab}</Text>
              </AnimChip>
            ))}
            <AnimChip active={needsRenewal} onPress={() => { setNeedsRenewal(!needsRenewal); setShown(30); }} style={{ paddingVertical: 8, paddingHorizontal: 13, borderRadius: 999, backgroundColor: needsRenewal ? hexA(C.red, 0.14) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: needsRenewal ? hexA(C.red, 0.45) : 'rgba(255,255,255,0.09)' }}>
              <Text style={{ fontFamily: needsRenewal ? F.bodyBold : F.bodySemi, fontSize: 11.5, color: needsRenewal ? C.red : C.muted }}>Needs renewal (&lt;2)</Text>
            </AnimChip>
          </HScroll>
          {crmOptions.length ? (
            <HScroll gap={7}>
              <AnimChip active={!crmFilter} onPress={() => setCrmFilter(null)} style={{ paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, backgroundColor: !crmFilter ? hexA(C.blue, 0.14) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: !crmFilter ? hexA(C.blue, 0.45) : 'rgba(255,255,255,0.09)' }}>
                <Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: !crmFilter ? C.blue : C.muted }}>All CRMs</Text>
              </AnimChip>
              {crmOptions.map(([id, name]) => (
                <AnimChip key={id} active={crmFilter === id} onPress={() => { setCrmFilter(crmFilter === id ? null : id); setShown(30); }} style={{ paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, backgroundColor: crmFilter === id ? hexA(C.blue, 0.14) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: crmFilter === id ? hexA(C.blue, 0.45) : 'rgba(255,255,255,0.09)' }}>
                  <Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: crmFilter === id ? C.blue : C.muted }}>{name}</Text>
                </AnimChip>
              ))}
            </HScroll>
          ) : null}
          <Mono style={{ fontSize: 8.5, letterSpacing: 0.8, color: C.muted3 }}>{filtered.length} CLIENTS · {selected.size} SELECTED</Mono>
          <View style={{ gap: 8 }}>
            {filtered.slice(0, shown).map((c) => {
              const isPriority = sets.priorityIds.has(c.clientId);
              const achieved = sets.achievedIds.has(c.clientId);
              const shorts = fellShortCount(c.clientId);
              const sel = selected.has(c.clientId);
              return (
                <Pressable key={c.clientId} onPress={() => !isPriority && toggleSel(c.clientId)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 11, borderRadius: 13, backgroundColor: sel ? hexA(ACC, 0.08) : 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: sel ? hexA(ACC, 0.45) : 'rgba(255,255,255,0.07)', opacity: isPriority ? 0.75 : 1 }}>
                  <View style={{ width: 20, height: 20, borderRadius: 7, borderWidth: 1.5, borderColor: sel ? ACC : 'rgba(255,255,255,0.25)', backgroundColor: sel ? hexA(ACC, 0.25) : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                    {sel ? <Icon name="checks" size={12} color={ACC} strokeWidth={3} /> : null}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Body numberOfLines={1} style={{ fontSize: 13, fontFamily: F.bodySemi, color: '#fff' }}>{c.name}</Body>
                    <Body numberOfLines={1} style={{ fontSize: 10, color: C.muted3, marginTop: 1 }}>
                      {c.crmName ?? 'No CRM'} · last renewal {shortDate(c.lastRenewalDate) ?? 'never'}
                    </Body>
                    <View style={{ flexDirection: 'row', gap: 5, marginTop: 3, flexWrap: 'wrap' }}>
                      {isPriority ? <Badge text={achieved ? 'Achieved' : 'Priority'} color={achieved ? C.green : ACC} /> : null}
                      {shorts > 0 ? <Badge text={`Fell short ${shorts}x`} color={C.red} /> : null}
                    </View>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ fontFamily: F.serif, fontSize: 18, color: sessionsLeftColor(c.sessionsLeft) }}>{c.sessionsLeft ?? '–'}</Text>
                    <Mono style={{ fontSize: 7.5, color: C.muted3 }}>LEFT · CYCLE {c.cycleNumber}</Mono>
                  </View>
                </Pressable>
              );
            })}
          </View>
          {filtered.length > shown ? (
            <Pressable onPress={() => setShown((n) => n + 30)} style={{ alignItems: 'center', paddingVertical: 11, borderRadius: 12, borderWidth: 1.5, borderStyle: 'dashed', borderColor: hexA(ACC, 0.3) }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: ACC }}>Load 30 more · {filtered.length - shown} left</Text>
            </Pressable>
          ) : null}
          {selected.size ? (
            <Pressable onPress={moveToPriority} disabled={markM.isPending} style={{ opacity: markM.isPending ? 0.6 : 1 }}>
              <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 13, borderRadius: 13 }}>
                <Icon name="trend" size={15} color="#fff" strokeWidth={2.3} />
                <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: '#fff' }}>{markM.isPending ? 'Marking…' : `Move ${selected.size} to priority`}</Text>
              </LinearGradient>
            </Pressable>
          ) : null}
        </>
      ) : mainTab === 'priority' ? (
        <View style={{ gap: 8 }}>
          {priorityList.length === 0 ? (
            <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 24 }}>No priority clients for {monthLabel(month)}. Mark some from All clients.</Body>
          ) : priorityList.map(({ row, client }) => <PriorityCard key={row.id} row={row} client={client} />)}
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          {sets.fallShortRows.length === 0 ? (
            <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 24 }}>No one has fallen short in {monthLabel(month)}.</Body>
          ) : sets.fallShortRows.map((row) => {
            const client = byId.get(row.client_id) ?? null;
            return (
              <View key={row.id} style={{ borderRadius: 14, backgroundColor: hexA(C.red, 0.05), borderWidth: 1, borderColor: hexA(C.red, 0.25), padding: 12, gap: 6 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <MiniAvatar initial={initials(client?.name ?? 'C')} colors={AVS[0]} size={32} />
                  <View style={{ flex: 1 }}>
                    <Body numberOfLines={1} style={{ fontSize: 13, fontFamily: F.bodySemi, color: '#fff' }}>{client?.name ?? 'Client'}</Body>
                    <Body style={{ fontSize: 10, color: C.muted3 }}>{shortDate(row.fall_short?.marked_at)} · fell short {fellShortCount(row.client_id)}x total</Body>
                  </View>
                  <Badge text="Fall short" color={C.red} />
                </View>
                {row.fall_short?.reason ? <Body style={{ fontSize: 12, color: C.ink3 }}>{row.fall_short.reason}</Body> : null}
                <Pressable onPress={async () => {
                  try {
                    const map = new Map<string, number | null>([[row.client_id, byId.get(row.client_id)?.sessionsLeft ?? null]]);
                    await markM.mutateAsync({ clientIds: [row.client_id], month, markedBy: adminId, sessionsLeft: map });
                  } catch (e: any) { Alert.alert("Couldn't reassign", e?.message ?? 'Try again.'); }
                }} style={{ alignItems: 'center', paddingVertical: 9, borderRadius: 11, backgroundColor: hexA(ACC, 0.1), borderWidth: 1, borderColor: hexA(ACC, 0.35) }}>
                  <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: ACC }}>Reassign as priority</Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      )}

      {/* Fall-short reason sheet */}
      <SheetShell visible={!!fallShortFor} onClose={() => { Keyboard.dismiss(); setTimeout(() => setFallShortFor(null), 80); }} accent={C.red} icon="alert" title="Mark fall short" subtitle={(byId.get(fallShortFor?.client_id ?? '')?.name ?? 'CLIENT').toUpperCase()}>
        <Body style={{ fontSize: 11.5, color: C.muted2 }}>The client moves to the Fall short tab for this month. Re-marking them later keeps this record in history.</Body>
        <TextInput value={fsReason} onChangeText={setFsReason} placeholder="Why did this renewal fall short?" placeholderTextColor={C.muted3} multiline style={{ minHeight: 70, textAlignVertical: 'top', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', backgroundColor: 'rgba(0,0,0,0.25)', color: '#fff', fontFamily: F.body, fontSize: 13 }} />
        <Pressable onPress={submitFallShort} disabled={!fsReason.trim() || fallShortM.isPending} style={{ alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: hexA(C.red, 0.14), borderWidth: 1, borderColor: hexA(C.red, 0.45), opacity: !fsReason.trim() || fallShortM.isPending ? 0.5 : 1 }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: C.red }}>{fallShortM.isPending ? 'Saving…' : 'Mark fall short'}</Text>
        </Pressable>
      </SheetShell>
    </Page>
  );
}
