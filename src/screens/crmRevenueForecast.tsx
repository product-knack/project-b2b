import React from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator, Alert, Keyboard } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C, F, hexA, ORANGE_GRAD } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono } from '../components/primitives';
import { Page, TitleBlock, Badge, MiniAvatar } from './common';
import { useAuth } from '../auth';
import { useStore } from '../store';
import {
  useRevenueForecastClients, usePriorityRows, derivePrioritySets, useConsumedSinceMark,
  useAddForecastRemark, useCrmForecastBanner, remarkDue, monthKey, monthLabel,
  PriorityRow, ForecastClient,
} from '../lib/revenueForecastQueries';
import { useSidebarProfile } from '../lib/navQueries';

/* ============ CRM: Revenue Forecast ============
   Web parity: /crm/revenue-forecast — only MY priority clients (achieved and
   fall-short rows drop out, §6), sorted by sessions left. CRMs add remarks
   (reason + plan); admin replies show inline. */

const ACC = C.gold;
const initials = (n: string) => n.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || 'C';
const AVS: [string, string][] = [['#F0883E', '#C05621'], ['#4FD1C5', '#2C7A7B'], ['#B794F4', '#6B46C1'], ['#F687B3', '#B83280'], ['#68D391', '#276749'], ['#63B3ED', '#2B6CB0']];
const shortDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' }) : null;
const sessionsLeftColor = (n: number | null) => (n === null ? C.muted3 : n <= 0 ? C.red : n <= 2 ? C.gold : C.ink);

/* ---- CRM home banner (mounted on the CRM dashboard) ---- */
export function CrmRevenueForecastBanner() {
  const { session } = useAuth();
  const { go } = useStore();
  const b = useCrmForecastBanner(session?.user?.id ?? null);
  if (b.isLoading || b.total === 0) return null;
  return (
    <Pressable onPress={() => go('crm-revenue-forecast')} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, backgroundColor: hexA(ACC, 0.09), borderWidth: 1, borderColor: hexA(ACC, 0.35), padding: 12 }}>
      <View style={{ width: 34, height: 34, borderRadius: 12, backgroundColor: hexA(ACC, 0.15), alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="rupee" size={16} color={ACC} strokeWidth={2.1} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: ACC }}>
          {b.total} priority renewal{b.total === 1 ? '' : 's'} this month
        </Text>
        <Body style={{ fontSize: 11, color: C.muted2, marginTop: 1 }}>
          {[
            b.newCount ? `${b.newCount} newly assigned` : null,
            b.dueCount ? `${b.dueCount} remark${b.dueCount === 1 ? '' : 's'} due` : null,
          ].filter(Boolean).join(' · ') || 'All caught up on remarks'}
        </Body>
      </View>
      <Icon name="chevRight" size={15} color={ACC} strokeWidth={2.3} />
    </Pressable>
  );
}

export function CrmRevenueForecast() {
  const { session } = useAuth();
  const me = session?.user?.id ?? null;
  const profile = useSidebarProfile();
  const month = monthKey();
  const clientsQ = useRevenueForecastClients();
  const rowsQ = usePriorityRows(month);
  const consumedQ = useConsumedSinceMark(rowsQ.data ?? []);
  const addM = useAddForecastRemark();

  const [openRow, setOpenRow] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState('');
  const [plan, setPlan] = React.useState('');

  const sets = React.useMemo(() => derivePrioritySets(rowsQ.data ?? []), [rowsQ.data]);
  const byId = React.useMemo(() => new Map((clientsQ.data ?? []).map((c) => [c.clientId, c])), [clientsQ.data]);

  // §6: my clients, not yet achieved, not fall-short — sorted sessionsLeft asc (nulls last).
  const list = React.useMemo(() =>
    sets.priorityRowsActive
      .filter((r) => r.achievement.status !== 'achieved')
      .map((r) => ({ row: r, client: byId.get(r.client_id) ?? null }))
      .filter(({ client }) => client?.crmId === me)
      .sort((a, b) => {
        const sa = a.client?.sessionsLeft ?? 9999; const sb = b.client?.sessionsLeft ?? 9999;
        return sa - sb || (a.client?.name ?? '').localeCompare(b.client?.name ?? '');
      }),
    [sets.priorityRowsActive, byId, me]);

  const submitRemark = async (row: PriorityRow) => {
    if (!reason.trim()) return;
    try {
      await addM.mutateAsync({
        clientId: row.client_id, month, authorName: profile.fullName || 'CRM',
        entry: { type: 'remark', reason: reason.trim(), plan: plan.trim() },
      });
      setReason(''); setPlan(''); Keyboard.dismiss();
    } catch (e: any) { Alert.alert("Couldn't add remark", e?.message ?? 'Try again.'); }
  };

  const threeDaysAgo = new Date(Date.now() - 3 * 864e5).toISOString();

  return (
    <Page gap={13} pt={6} scrollKey="crm-revenue-forecast">
      <TitleBlock title="Revenue Forecast" sub={`Your priority renewals · ${monthLabel(month)}`} />

      {clientsQ.isLoading || rowsQ.isLoading ? (
        <View style={{ alignItems: 'center', paddingVertical: 30, gap: 8 }}>
          <ActivityIndicator color={ACC} />
          <Body style={{ fontSize: 12, color: C.muted3 }}>Loading your priority list…</Body>
        </View>
      ) : list.length === 0 ? (
        <View style={{ alignItems: 'center', paddingVertical: 34, gap: 8 }}>
          <Icon name="checks" size={26} color={C.green} strokeWidth={2} />
          <Body style={{ fontSize: 13, color: C.muted2, textAlign: 'center' }}>No open priority renewals assigned to you this month.</Body>
        </View>
      ) : (
        <View style={{ gap: 9 }}>
          {list.map(({ row, client }) => {
            const isOpen = openRow === row.id;
            const due = remarkDue({
              baseline: row.baseline, liveSessionsLeft: client?.sessionsLeft ?? null,
              consumedSinceMark: consumedQ.data?.get(row.client_id) ?? 0,
              remarks: row.remarks, achieved: false,
            });
            const isNew = row.created_at >= threeDaysAgo;
            const remarks = row.remarks.filter((r) => r.type === 'remark').sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
            const repliesOf = (id: string) => row.remarks.filter((r) => r.type === 'reply' && r.parent_id === id);
            return (
              <View key={row.id} style={{ borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: due.due ? hexA(ACC, 0.45) : 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                <Pressable onPress={() => { setOpenRow(isOpen ? null : row.id); setReason(''); setPlan(''); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 }}>
                  <MiniAvatar initial={initials(client?.name ?? 'C')} colors={AVS[(client?.name ?? '').length % AVS.length]} size={34} />
                  <View style={{ flex: 1 }}>
                    <Body numberOfLines={1} style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{client?.name ?? 'Client'}</Body>
                    <Body style={{ fontSize: 10.5, color: C.muted3, marginTop: 1 }}>Marked {shortDate(row.baseline?.marked_at ?? row.created_at)} with {row.baseline?.sessions_left_at_mark ?? '?'} left</Body>
                    <View style={{ flexDirection: 'row', gap: 5, marginTop: 3, flexWrap: 'wrap' }}>
                      {isNew ? <Badge text="New" color={C.blue} /> : null}
                      {due.due ? <Badge text={`Remark due (${due.pending})`} color={ACC} /> : <Badge text="Remarks up to date" color={C.green} />}
                    </View>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 2 }}>
                    <Text style={{ fontFamily: F.serif, fontSize: 19, color: sessionsLeftColor(client?.sessionsLeft ?? null) }}>{client?.sessionsLeft ?? '–'}</Text>
                    <Mono style={{ fontSize: 7.5, color: C.muted3 }}>LEFT</Mono>
                  </View>
                  <Icon name={isOpen ? 'chevUp' : 'chevDown'} size={15} color={C.muted} strokeWidth={2.2} />
                </Pressable>
                {isOpen ? (
                  <View style={{ padding: 12, gap: 10, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' }}>
                    {remarks.length === 0 ? <Body style={{ fontSize: 11.5, color: C.muted3 }}>No remarks yet. Add the first one below.</Body> : (
                      remarks.map((r) => (
                        <View key={r.id} style={{ borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', padding: 10, gap: 5 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Body style={{ flex: 1, fontSize: 11, fontFamily: F.bodySemi, color: C.blue }}>{r.author_name || 'You'}</Body>
                            <Mono style={{ fontSize: 8, color: C.muted3 }}>{shortDate(r.created_at)}</Mono>
                          </View>
                          {r.reason ? <Body style={{ fontSize: 12.5, color: '#fff' }}>{r.reason}</Body> : null}
                          {r.plan ? <Body style={{ fontSize: 11.5, color: C.muted2 }}>Plan: {r.plan}</Body> : null}
                          {repliesOf(r.id).map((rep) => (
                            <View key={rep.id} style={{ marginLeft: 9, borderLeftWidth: 2, borderLeftColor: hexA(ACC, 0.4), paddingLeft: 8, gap: 1 }}>
                              <Body style={{ fontSize: 10.5, fontFamily: F.bodySemi, color: ACC }}>{rep.author_name || 'Admin'}</Body>
                              <Body style={{ fontSize: 12, color: C.ink3 }}>{rep.message}</Body>
                            </View>
                          ))}
                        </View>
                      ))
                    )}
                    <Mono style={{ fontSize: 8.5, letterSpacing: 0.8, color: C.muted3 }}>ADD A REMARK</Mono>
                    <TextInput value={reason} onChangeText={setReason} placeholder="What happened / why no renewal yet?" placeholderTextColor={C.muted3} multiline style={{ minHeight: 54, textAlignVertical: 'top', paddingVertical: 9, paddingHorizontal: 11, borderRadius: 11, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', backgroundColor: 'rgba(0,0,0,0.25)', color: '#fff', fontFamily: F.body, fontSize: 12.5 }} />
                    <TextInput value={plan} onChangeText={setPlan} placeholder="Your plan to close it (optional)" placeholderTextColor={C.muted3} multiline style={{ minHeight: 44, textAlignVertical: 'top', paddingVertical: 9, paddingHorizontal: 11, borderRadius: 11, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', backgroundColor: 'rgba(0,0,0,0.25)', color: '#fff', fontFamily: F.body, fontSize: 12.5 }} />
                    <Pressable onPress={() => submitRemark(row)} disabled={!reason.trim() || addM.isPending} style={{ opacity: !reason.trim() || addM.isPending ? 0.5 : 1 }}>
                      <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ alignItems: 'center', paddingVertical: 11, borderRadius: 12 }}>
                        <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: '#fff' }}>{addM.isPending ? 'Saving…' : 'Add Remark'}</Text>
                      </LinearGradient>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      )}
    </Page>
  );
}
