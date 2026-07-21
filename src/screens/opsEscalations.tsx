import React from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator } from 'react-native';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono, Card } from '../components/primitives';
import { Page, TitleBlock, Badge, HScroll } from './common';
import { useMyOpsProfile } from '../lib/opsLeadQueries';
import {
  ESC_CATEGORIES, escCountFor, useEscCategory, useSaveQhpEscRemark, useUpdateEscalation, useOpsRenewalsPending,
  type EscCategory, type EscalationRow,
} from '../lib/opsEscalationQueries';

/* ============ OPS — Escalations desk (web /ops/escalations) ============ */

const fmtAt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }) : '—');
const fmtDay = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' }) : '—');
const prettyKey = (k: string) => k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/* Render up to a few primitive details fields generically (client name, CRM, dates…). */
function DetailsBits({ details }: { details: any }) {
  if (!details || typeof details !== 'object') return null;
  const bits = Object.entries(details)
    .filter(([k, v]) => k !== 'remarks' && (typeof v === 'string' || typeof v === 'number') && String(v).length <= 60 && !/^https?:/.test(String(v)))
    .slice(0, 5);
  if (!bits.length) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
      {bits.map(([k, v]) => (
        <View key={k} style={{ flexDirection: 'row', gap: 4, paddingVertical: 3, paddingHorizontal: 8, borderRadius: 7, backgroundColor: 'rgba(0,0,0,0.25)' }}>
          <Mono style={{ fontSize: 7.5, letterSpacing: 0.4, color: C.muted3 }}>{prettyKey(k).toUpperCase()}</Mono>
          <Body style={{ fontSize: 10, color: C.ink2 }}>{/^\d{4}-\d{2}-\d{2}T/.test(String(v)) ? fmtAt(String(v)) : String(v)}</Body>
        </View>
      ))}
    </View>
  );
}

function EscCard({ row, cat, profile }: { row: EscalationRow; cat: EscCategory; profile: any }) {
  const qhpRemark = useSaveQhpEscRemark();
  const update = useUpdateEscalation();
  const [remarkOpen, setRemarkOpen] = React.useState(false);
  const [remark, setRemark] = React.useState('');
  const [err, setErr] = React.useState<string | null>(null);
  const isQhp = cat.key === 'qhp_overdue';
  const overdue = row.due_at != null && new Date(row.due_at).getTime() < Date.now() && row.status === 'open';
  const levelColor = (row.current_level ?? 1) >= 3 ? C.red : (row.current_level ?? 1) === 2 ? C.orange : C.gold;
  const savedRemarks: { tier: string; r: any }[] = isQhp
    ? (['t1', 't2'] as const).filter((t) => row.details?.remarks?.[t]?.text).map((t) => ({ tier: t.toUpperCase(), r: row.details.remarks[t] }))
    : [];
  const busy = qhpRemark.isPending || update.isPending;

  const saveRemark = () => {
    setErr(null);
    const done = { onSuccess: () => { setRemark(''); setRemarkOpen(false); }, onError: (e: any) => setErr(e?.message ?? 'Failed') };
    if (isQhp) {
      const tier = row.my_tier ?? 2; // ops acts as tier-2 by default (web parity)
      qhpRemark.mutate({ id: row.id, tier: tier as 1 | 2, text: remark, profile }, done);
    } else {
      if (remark.trim().length < 3) { setErr('Remark must be at least 3 characters.'); return; }
      update.mutate({ id: row.id, remark: remark.trim(), profileId: profile?.id ?? null }, done);
    }
  };

  return (
    <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border={hexA(overdue ? C.red : levelColor, 0.2)} radius={14} style={{ padding: 12, borderLeftWidth: 3, borderLeftColor: overdue ? C.red : levelColor, gap: 7 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <Body numberOfLines={2} style={{ flex: 1, fontSize: 12.5, fontFamily: F.bodySemi, color: '#fff' }}>{row.title ?? '(untitled escalation)'}</Body>
        {row.my_tier ? <Badge text={`T${row.my_tier}`} color={C.blue} /> : null}
        <Badge text={`L${row.current_level ?? 1}`} color={levelColor} />
        {row.status === 'completed' ? <Badge text="Resolved" color={C.green} /> : overdue ? <Badge text="Overdue" color={C.red} /> : null}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        <Mono style={{ fontSize: 8, letterSpacing: 0.4, color: C.muted3 }}>ESCALATED {fmtAt(row.escalated_at).toUpperCase()}</Mono>
        {row.due_at ? <Mono style={{ fontSize: 8, letterSpacing: 0.4, color: overdue ? C.red : C.muted3 }}>DUE {fmtAt(row.due_at).toUpperCase()}</Mono> : null}
      </View>
      <DetailsBits details={row.details} />
      {savedRemarks.map(({ tier, r }) => (
        <View key={tier} style={{ padding: 9, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.22)', gap: 2 }}>
          <Body style={{ fontSize: 11, color: C.ink2, lineHeight: 15 }}>{r.text}</Body>
          <Mono style={{ fontSize: 7.5, letterSpacing: 0.4, color: C.muted3 }}>{tier} · {(r.by_name ?? '—').toUpperCase()} · {fmtAt(r.at).toUpperCase()}</Mono>
        </View>
      ))}
      {err ? <Body style={{ fontSize: 10.5, color: C.red }}>{err}</Body> : null}

      {row.status === 'open' ? (
        remarkOpen ? (
          <View style={{ gap: 7 }}>
            <TextInput value={remark} onChangeText={(v) => setRemark(v.slice(0, 600))} placeholder={isQhp ? `Tier-${row.my_tier ?? 2} remark…` : 'Remark…'} placeholderTextColor={C.muted3} multiline
              style={{ borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 11, paddingVertical: 9, color: '#fff', fontFamily: F.body, fontSize: 12.5, minHeight: 52, textAlignVertical: 'top' }} />
            <View style={{ flexDirection: 'row', gap: 7 }}>
              <Pressable onPress={saveRemark} disabled={busy || remark.trim().length < 3} style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10, backgroundColor: hexA(C.orange, remark.trim().length < 3 ? 0.06 : 0.16), borderWidth: 1, borderColor: hexA(C.orange, remark.trim().length < 3 ? 0.2 : 0.5) }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: remark.trim().length < 3 ? C.muted3 : C.orange }}>{busy ? 'Saving…' : 'Save remark'}</Text>
              </Pressable>
              <Pressable onPress={() => { setRemarkOpen(false); setErr(null); }} style={{ alignItems: 'center', paddingVertical: 9, paddingHorizontal: 14, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
                <Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: C.muted }}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={{ flexDirection: 'row', gap: 7 }}>
            <Pressable onPress={() => setRemarkOpen(true)} style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: C.muted }}>Add remark</Text>
            </Pressable>
            <Pressable disabled={busy} onPress={() => { setErr(null); update.mutate({ id: row.id, status: 'completed', profileId: profile?.id ?? null }, { onError: (e: any) => setErr(e?.message ?? 'Failed') }); }}
              style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10, backgroundColor: hexA(C.green, 0.12), borderWidth: 1, borderColor: hexA(C.green, 0.4) }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: C.green }}>{update.isPending ? '…' : 'Mark resolved'}</Text>
            </Pressable>
          </View>
        )
      ) : null}
    </Card>
  );
}

export function OpsEscalations() {
  const profQ = useMyOpsProfile();
  const [activeKey, setActiveKey] = React.useState<string>(ESC_CATEGORIES[0].key);
  const [status, setStatus] = React.useState<'open' | 'completed' | 'all'>('open');
  // One light count query per category (fixed array → stable hook order).
  const countQs = ESC_CATEGORIES.map((cat) => useEscCategory(cat, 'open', true)); // eslint-disable-line react-hooks/rules-of-hooks
  const activeCat = ESC_CATEGORIES.find((c) => c.key === activeKey) ?? ESC_CATEGORIES[0];
  const listQ = useEscCategory(activeCat, status, activeKey !== 'renewals');
  const renewalsQ = useOpsRenewalsPending(activeKey === 'renewals');
  const rows = listQ.data ?? [];

  return (
    <Page gap={13}>
      <TitleBlock title="Escalations" sub="Automated SLA ladder · since Jun 2026" />

      <HScroll gap={7}>
        {ESC_CATEGORIES.map((cat, i) => {
          const active = activeKey === cat.key;
          const n = escCountFor(countQs[i].data ?? [], cat.countMode);
          return (
            <Pressable key={cat.key} onPress={() => setActiveKey(cat.key)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: active ? hexA(C.orange, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.orange, 0.5) : 'rgba(255,255,255,0.09)' }}>
              <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 11, color: active ? C.orange : C.muted }}>{cat.label}</Text>
              {n > 0 ? <View style={{ minWidth: 18, alignItems: 'center', paddingHorizontal: 4, paddingVertical: 1, borderRadius: 99, backgroundColor: hexA(C.red, 0.18) }}><Text style={{ fontFamily: F.bodyBold, fontSize: 9.5, color: C.red }}>{n}</Text></View> : null}
            </Pressable>
          );
        })}
        {(() => {
          const active = activeKey === 'renewals';
          return (
            <Pressable onPress={() => setActiveKey('renewals')} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: active ? hexA(C.purple, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.purple, 0.5) : 'rgba(255,255,255,0.09)' }}>
              <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 11, color: active ? C.purple : C.muted }}>Renewals Pending</Text>
            </Pressable>
          );
        })()}
      </HScroll>

      {activeKey === 'renewals' ? (
        /* Derived list — package exhausted 24h+ with no newer approved renewal (web useOpsRenewalsPending). */
        renewalsQ.isLoading ? <View style={{ paddingVertical: 36, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View>
        : renewalsQ.isError ? <Body style={{ fontSize: 11.5, color: C.red, textAlign: 'center' }}>{(renewalsQ.error as Error).message}</Body>
        : !(renewalsQ.data ?? []).length ? <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 24 }}>No renewals pending 24h+. All caught up.</Body>
        : (
          <>
            <Body style={{ fontSize: 11, color: C.muted2 }}>{renewalsQ.data!.length} client{renewalsQ.data!.length === 1 ? '' : 's'} exhausted their package 24h+ ago with no approved renewal.</Body>
            {renewalsQ.data!.map((r) => (
              <Card key={r.clientId} colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border={hexA(r.daysPending >= 3 ? C.red : C.gold, 0.2)} radius={14} style={{ padding: 12, borderLeftWidth: 3, borderLeftColor: r.daysPending >= 3 ? C.red : C.gold, gap: 6 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Body numberOfLines={1} style={{ flex: 1, fontSize: 13, fontFamily: F.bodySemi, color: '#fff' }}>{r.clientName}</Body>
                  <Badge text={`${r.daysPending}d pending`} color={r.daysPending >= 3 ? C.red : C.gold} />
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                  <Body style={{ fontSize: 10.5, color: C.muted2 }}>CRM · {r.assignedCrmName ?? 'Unassigned'}</Body>
                  <Body style={{ fontSize: 10.5, color: C.muted2 }}>{r.consumed}/{r.packageSize} sessions used</Body>
                  <Mono style={{ fontSize: 8, letterSpacing: 0.4, color: C.muted3 }}>EXHAUSTED {fmtDay(r.exhaustedAt).toUpperCase()}</Mono>
                  {r.lastRenewalAt ? <Mono style={{ fontSize: 8, letterSpacing: 0.4, color: C.muted3 }}>LAST RENEWAL {fmtDay(r.lastRenewalAt).toUpperCase()}</Mono> : null}
                </View>
              </Card>
            ))}
          </>
        )
      ) : (
        <>
          {/* category explainer */}
          <Card colors={['rgba(56,34,21,0.45)', 'rgba(20,16,15,0.5)']} border="rgba(255,150,90,0.14)" radius={14} style={{ padding: 12, gap: 5 }}>
            <Serif style={{ fontSize: 14 }}>{activeCat.label}</Serif>
            <Body style={{ fontSize: 11, color: C.ink2, lineHeight: 16 }}>{activeCat.rule}</Body>
            <Body style={{ fontSize: 10, color: C.muted2 }}>Ladder — {activeCat.ladder}</Body>
            <Body style={{ fontSize: 10, color: C.muted2 }}>Resolves when — {activeCat.resolves}</Body>
          </Card>

          <View style={{ flexDirection: 'row', gap: 7 }}>
            {(([['open', 'Open'], ['completed', 'Resolved'], ['all', 'All']]) as ['open' | 'completed' | 'all', string][]).map(([id, label]) => {
              const active = status === id;
              return (
                <Pressable key={id} onPress={() => setStatus(id)} style={{ paddingVertical: 7, paddingHorizontal: 13, borderRadius: 999, backgroundColor: active ? hexA(C.orange, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.orange, 0.5) : 'rgba(255,255,255,0.09)' }}>
                  <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 11, color: active ? C.orange : C.muted }}>{label}</Text>
                </Pressable>
              );
            })}
          </View>

          {listQ.isLoading ? <View style={{ paddingVertical: 36, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View>
          : listQ.isError ? <Body style={{ fontSize: 11.5, color: C.red, textAlign: 'center' }}>{(listQ.error as Error).message}</Body>
          : rows.length === 0 ? <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 24 }}>No {status === 'all' ? '' : status + ' '}escalations here.</Body>
          : rows.map((row) => <EscCard key={row.id} row={row} cat={activeCat} profile={profQ.data} />)}
        </>
      )}
    </Page>
  );
}
