import React from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator, Modal, ScrollView, Linking } from 'react-native';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono, Card, Avatar } from '../components/primitives';
import { Page, TitleBlock, Badge } from './common';
import {
  useClientBasicInfo, useClientSessionMetrics, useGenerationMemberMap,
  useUpdateRenewalDate, useRenewPackage, useRenewalOpportunities,
  type ClientBasicInfo, type RenewalOpportunity,
} from '../lib/adminRenewalQueries';

/* ============ ADMIN — Renewals (web admin "Sessions" tab + new Opportunities tab) ============ */

const AV_GRADS: [string, string][] = [['#FB8B3A', '#EE5E16'], ['#57C98A', '#2E9A63'], ['#7C8FE8', '#4A5AC8'], ['#9A7BEA', '#6E5BD0'], ['#E0A53C', '#C07C1E'], ['#4FD1C5', '#2C8A86'], ['#F687B3', '#C2568A'], ['#F0883E', '#C05621']];
const avColors = (seed: string): [string, string] => AV_GRADS[[...(seed || '?')].reduce((a, c) => a + c.charCodeAt(0), 0) % AV_GRADS.length];
const fmtDay = (iso: string | null) => (iso && !Number.isNaN(new Date(iso).getTime()) ? new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : null);
const todayYmd = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/* Web getRowColor: red when remaining ≤ 0, yellow when ≤ floor(30% of package). */
const urgencyColor = (remaining: number | null, pkg: number | null): string | null => {
  if (remaining == null || pkg == null || pkg === 0) return null;
  if (remaining <= 0) return C.red;
  if (remaining <= Math.floor(pkg * 0.3)) return C.gold;
  return null;
};

function Loading() {
  return <View style={{ paddingVertical: 30, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View>;
}
function Err({ q }: { q: { isError: boolean; error: unknown } }) {
  if (!q.isError) return null;
  return <Body style={{ fontSize: 11.5, color: C.red, textAlign: 'center', paddingVertical: 8 }}>{(q.error as Error)?.message ?? 'Could not load.'}</Body>;
}
const inputSt = { borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 11, paddingVertical: 10, color: '#fff', fontFamily: F.body, fontSize: 13 } as const;
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <View style={{ gap: 5 }}><Mono style={{ fontSize: 8.5, letterSpacing: 0.8, color: C.mono2 }}>{label}</Mono>{children}</View>;
}
function SheetShell({ title, sub, onClose, children }: { title: string; sub?: string | null; onClose: () => void; children: React.ReactNode }) {
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.62)', justifyContent: 'flex-end' }}>
        <View style={{ maxHeight: '92%', backgroundColor: '#0E0A09', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.14)', paddingHorizontal: 18, paddingTop: 14, paddingBottom: 22 }}>
          <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 12 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 12 }}>
            <View style={{ flex: 1 }}>
              <Serif numberOfLines={1} style={{ fontSize: 18 }}>{title}</Serif>
              {sub ? <Body numberOfLines={1} style={{ fontSize: 10.5, color: C.muted2, marginTop: 1 }}>{sub}</Body> : null}
            </View>
            <Pressable onPress={onClose} hitSlop={8} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="close" size={13} color="#B8B2AC" strokeWidth={2.3} />
            </Pressable>
          </View>
          {children}
        </View>
      </View>
    </Modal>
  );
}
function PrimaryBtn({ label, onPress, disabled, color = C.orange }: { label: string; onPress: () => void; disabled?: boolean; color?: string }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={{ alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: hexA(color, disabled ? 0.06 : 0.16), borderWidth: 1, borderColor: hexA(color, disabled ? 0.2 : 0.5) }}>
      <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: disabled ? C.muted3 : color }}>{label}</Text>
    </Pressable>
  );
}

/* Common target shape for both sheets — from either tab's rows. */
type RenewTarget = { id: string; name: string; packageSessions: number; packageType: string | null; renewalDate: string | null };

/* ---------------- Renewal date sheet (web CalendarPicker popover) ---------------- */
function RenewalDateSheet({ target, onClose }: { target: RenewTarget; onClose: () => void }) {
  const update = useUpdateRenewalDate();
  const [date, setDate] = React.useState(target.renewalDate ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(target.renewalDate)) : todayYmd());
  const [err, setErr] = React.useState<string | null>(null);
  return (
    <SheetShell title="Set renewal date" sub={target.name} onClose={onClose}>
      <View style={{ gap: 11, paddingBottom: 8 }}>
        <Field label="RENEWED ON (YYYY-MM-DD · IST)"><TextInput value={date} onChangeText={setDate} placeholder="2026-07-16" placeholderTextColor={C.muted3} autoCorrect={false} style={inputSt} /></Field>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <Pressable onPress={() => setDate(todayYmd())} style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
            <Text style={{ fontFamily: F.bodySemi, fontSize: 10.5, color: C.muted }}>Today</Text>
          </Pressable>
        </View>
        <Body style={{ fontSize: 10.5, color: C.muted3 }}>Updates the latest renewal record; if the client has none, a renewal entry is created with the current package.</Body>
        {err ? <Body style={{ fontSize: 11, color: C.red }}>{err}</Body> : null}
        <PrimaryBtn label={update.isPending ? 'Saving…' : 'Save renewal date'} disabled={update.isPending || !/^\d{4}-\d{2}-\d{2}$/.test(date)}
          onPress={() => { setErr(null); update.mutate({ clientId: target.id, dateYmd: date, packageSessions: target.packageSessions, packageType: target.packageType }, { onSuccess: onClose, onError: (e: any) => setErr(e?.message ?? 'Failed') }); }} />
      </View>
    </SheetShell>
  );
}

/* ---------------- Renew package sheet (web RenewPackageDialog, single client) ---------------- */
function RenewSheet({ target, onClose }: { target: RenewTarget; onClose: () => void }) {
  const renew = useRenewPackage();
  const genQ = useGenerationMemberMap();
  const adminName = genQ.data?.[target.id] ?? null;
  const [sessions, setSessions] = React.useState('');
  const [cycleSessions, setCycleSessions] = React.useState('');
  const [duration, setDuration] = React.useState('');
  const [amount, setAmount] = React.useState('');
  const [cycleType, setCycleType] = React.useState<'monthly' | 'custom'>('monthly');
  const [notes, setNotes] = React.useState('');
  const [err, setErr] = React.useState<string | null>(null);
  const valid = Number(sessions) > 0 && Number(cycleSessions) > 0 && Number(duration) > 0;
  return (
    <SheetShell title="Renew package" sub={target.name + (target.packageType ? ` · current ${target.packageType}` : '')} onClose={onClose}>
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 11, paddingBottom: 10 }}>
        {adminName ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, padding: 12, borderRadius: 13, backgroundColor: hexA(C.gold, 0.08), borderWidth: 1, borderColor: hexA(C.gold, 0.35) }}>
            <Icon name="alert" size={14} color={C.gold} strokeWidth={2.2} />
            <Body style={{ flex: 1, fontSize: 11.5, color: '#F2C066' }}>Generation member — packages are renewed by the generation admin ({adminName}), not individually.</Body>
          </View>
        ) : (
          <>
            <Field label="SESSIONS IN NEW PACKAGE *"><TextInput value={sessions} onChangeText={setSessions} keyboardType="numeric" placeholder="48" placeholderTextColor={C.muted3} style={inputSt} /></Field>
            <Field label="SESSIONS PER CYCLE *"><TextInput value={cycleSessions} onChangeText={setCycleSessions} keyboardType="numeric" placeholder="12" placeholderTextColor={C.muted3} style={inputSt} /></Field>
            <Field label="PACKAGE DURATION (MONTHS) *"><TextInput value={duration} onChangeText={setDuration} keyboardType="numeric" placeholder="4" placeholderTextColor={C.muted3} style={inputSt} /></Field>
            <Field label="PACKAGE AMOUNT (₹ · OPTIONAL)"><TextInput value={amount} onChangeText={setAmount} keyboardType="numeric" placeholder="50000" placeholderTextColor={C.muted3} style={inputSt} /></Field>
            <Field label="CYCLE TYPE">
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {(['monthly', 'custom'] as const).map((t) => (
                  <Pressable key={t} onPress={() => setCycleType(t)} style={{ paddingVertical: 7, paddingHorizontal: 13, borderRadius: 999, backgroundColor: cycleType === t ? hexA(C.orange, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: cycleType === t ? hexA(C.orange, 0.5) : 'rgba(255,255,255,0.09)' }}>
                    <Text style={{ fontFamily: cycleType === t ? F.bodyBold : F.bodySemi, fontSize: 11, color: cycleType === t ? C.orange : C.muted }}>{t}</Text>
                  </Pressable>
                ))}
              </View>
            </Field>
            <Field label="NOTES (OPTIONAL)"><TextInput value={notes} onChangeText={setNotes} multiline placeholder="Context for this renewal…" placeholderTextColor={C.muted3} style={[inputSt, { minHeight: 56, textAlignVertical: 'top' }]} /></Field>
            <Body style={{ fontSize: 10, color: C.muted3 }}>Overdue sessions from the current package are counted and carried into the renewal note automatically.</Body>
            {err ? <Body style={{ fontSize: 11, color: C.red }}>{err}</Body> : null}
            <PrimaryBtn label={renew.isPending ? 'Renewing…' : 'Confirm renewal'} color={C.green} disabled={renew.isPending || !valid}
              onPress={() => {
                setErr(null);
                renew.mutate({ clientId: target.id, packageSessions: Number(sessions), cycleSessions: Number(cycleSessions), packageDuration: Number(duration), packageAmount: amount.trim() ? parseFloat(amount) : null, cycleType, notes },
                  { onSuccess: onClose, onError: (e: any) => setErr(e?.message ?? 'Failed') });
              }} />
          </>
        )}
      </ScrollView>
    </SheetShell>
  );
}

/* Expandable renewal-history strip: latest renewal is on the date button;
   this reveals every PREVIOUS renewal (date + package size), newest first. */
function RenewalHistory({ history }: { history?: { renewed_at: string; package_sessions: number | null }[] | null }) {
  const [open, setOpen] = React.useState(false);
  // history can be undefined when a pre-upgrade cached row rehydrates from disk.
  const rows = history ?? [];
  if (rows.length <= 1) return null; // nothing before the latest
  const previous = rows.slice(1);
  return (
    <View style={{ borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.18)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
      <Pressable onPress={() => setOpen((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 8, paddingHorizontal: 11 }}>
        <Icon name="clock" size={12} color={C.muted2} strokeWidth={2} />
        <Text style={{ flex: 1, fontFamily: F.bodySemi, fontSize: 10.5, color: C.muted }}>
          {previous.length} previous renewal{previous.length === 1 ? '' : 's'}
        </Text>
        <Icon name={open ? 'chevUp' : 'chevDown'} size={13} color={C.muted3} strokeWidth={2.2} />
      </Pressable>
      {open ? (
        <View style={{ paddingHorizontal: 11, paddingBottom: 9 }}>
          {previous.map((r, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)' }}>
              <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: C.muted3 }} />
              <Text style={{ flex: 1, fontFamily: F.bodySemi, fontSize: 11, color: C.ink3 }}>{fmtDay(r.renewed_at) ?? '—'}</Text>
              {r.package_sessions ? <Mono style={{ fontSize: 9, color: C.muted3 }}>{r.package_sessions} SESSIONS</Mono> : null}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/* ---------------- Shared client card ---------------- */
function MetricCell({ label, value, color }: { label: string; value: React.ReactNode; color?: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 2 }}>
      {typeof value === 'number' || typeof value === 'string' ? <Serif style={{ fontSize: 17, color: color ?? '#fff' }}>{value}</Serif> : value}
      <Mono style={{ fontSize: 7.5, letterSpacing: 0.5, color: C.muted3, textAlign: 'center' }}>{label}</Mono>
    </View>
  );
}

/* ---------------- Main screen ---------------- */
export function AdminRenewals() {
  const [tab, setTab] = React.useState<'sessions' | 'opportunities'>('sessions');
  const [search, setSearch] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [withoutSub, setWithoutSub] = React.useState(false);
  const [dateTarget, setDateTarget] = React.useState<RenewTarget | null>(null);
  const [renewTarget, setRenewTarget] = React.useState<RenewTarget | null>(null);
  const pageSize = 10;

  // 300ms debounce, reset to page 1 (web parity)
  React.useEffect(() => {
    const t = setTimeout(() => { setDebounced(search); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const basicQ = useClientBasicInfo({ page, pageSize, searchTerm: debounced, withoutSubscription: withoutSub });
  const clients = basicQ.data?.clients ?? [];
  const totalCount = basicQ.data?.totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const metricsQ = useClientSessionMetrics(clients.map((c) => c.id));
  const genQ = useGenerationMemberMap();
  const oppQ = useRenewalOpportunities(tab === 'opportunities');

  // Merge + sort DESC by sessions_after_renewal once metrics arrive (web parity)
  const rows = React.useMemo(() => {
    const merged = clients.map((c) => ({ c, m: metricsQ.data?.[c.id] ?? null }));
    if (!metricsQ.data) return merged;
    return [...merged].sort((a, b) => (b.m?.sessions_after_renewal ?? 0) - (a.m?.sessions_after_renewal ?? 0));
  }, [clients, metricsQ.data]);

  const targetOf = (c: ClientBasicInfo): RenewTarget => ({
    id: c.id, name: `${c.first_name ?? ''} ${c.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || '—',
    packageSessions: c.package_sessions, packageType: c.package_type, renewalDate: c.renewal_date,
  });
  const oppTargetOf = (o: RenewalOpportunity): RenewTarget => ({
    id: o.id, name: o.name, packageSessions: o.package_sessions, packageType: o.package_type, renewalDate: o.renewal_date,
  });

  return (
    <Page gap={13}>
      <TitleBlock title="Renewals" sub="Client sessions & renewal pipeline" />

      {/* tabs */}
      <View style={{ flexDirection: 'row', gap: 7 }}>
        {(([['sessions', 'Sessions'], ['opportunities', 'Renewal Opportunities']]) as ['sessions' | 'opportunities', string][]).map(([id, label]) => {
          const active = tab === id;
          return (
            <Pressable key={id} onPress={() => setTab(id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 13, borderRadius: 999, backgroundColor: active ? hexA(C.orange, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.orange, 0.5) : 'rgba(255,255,255,0.09)' }}>
              <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 11.5, color: active ? C.orange : C.muted }}>{label}</Text>
              {id === 'opportunities' && oppQ.data ? (
                <View style={{ minWidth: 18, alignItems: 'center', paddingHorizontal: 4, paddingVertical: 1, borderRadius: 99, backgroundColor: hexA(C.red, 0.18) }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 9.5, color: C.red }}>{oppQ.data.length}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      {tab === 'sessions' ? (
        <>
          {/* search + toggle */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 13, paddingVertical: 11, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)' }}>
            <Icon name="search" size={15} color={C.muted3} strokeWidth={2} />
            <TextInput value={search} onChangeText={setSearch} placeholder="Search clients by name…" placeholderTextColor={C.muted3} autoCorrect={false} style={{ flex: 1, fontFamily: F.body, fontSize: 14, color: '#fff', padding: 0 }} />
            {search ? <Pressable onPress={() => setSearch('')} hitSlop={8}><Icon name="close" size={13} color={C.muted3} strokeWidth={2.3} /></Pressable> : null}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Body style={{ flex: 1, fontSize: 11, color: C.muted2 }}>{basicQ.isPending ? 'Loading…' : `${totalCount} client${totalCount === 1 ? '' : 's'} found`}</Body>
            <Pressable onPress={() => { setWithoutSub((v) => !v); setPage(1); }} style={{ paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, backgroundColor: withoutSub ? hexA(C.purple, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: withoutSub ? hexA(C.purple, 0.5) : 'rgba(255,255,255,0.09)' }}>
              <Text style={{ fontFamily: withoutSub ? F.bodyBold : F.bodySemi, fontSize: 10.5, color: withoutSub ? C.purple : C.muted }}>Without Subscription</Text>
            </Pressable>
          </View>

          <Err q={basicQ} />
          {basicQ.isPending ? <Loading /> : rows.length === 0 ? (
            <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 24 }}>No clients match this view.</Body>
          ) : (
            <>
              {rows.map(({ c, m }) => {
                const col = urgencyColor(m?.remaining_sessions ?? null, c.package_sessions || null);
                const genAdmin = genQ.data?.[c.id] ?? null;
                const name = `${c.first_name ?? ''} ${c.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || '—';
                return (
                  <Card key={c.id} colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border={hexA(col ?? '#94A3B8', col ? 0.35 : 0.12)} radius={15} style={{ padding: 12, gap: 10, borderLeftWidth: 3, borderLeftColor: col ?? 'rgba(255,255,255,0.1)' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                      <Avatar initial={(name[0] ?? '?').toUpperCase()} size={34} colors={avColors(name)} fontSize={13} />
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <Body numberOfLines={1} style={{ flexShrink: 1, fontSize: 13, fontFamily: F.bodySemi, color: '#fff' }}>{name}</Body>
                          <Badge text="B2C" color={C.blue} />
                          {genAdmin ? <Badge text={`Generation · ${genAdmin}`} color={C.purple} /> : null}
                        </View>
                        {c.phone ? (
                          <Pressable onPress={() => Linking.openURL(`tel:${c.phone}`)} hitSlop={6} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 }}>
                            <Icon name="phone" size={10} color={C.blue} strokeWidth={2.2} />
                            <Body style={{ fontSize: 10.5, color: C.blue }}>{c.phone}</Body>
                          </Pressable>
                        ) : <Body style={{ fontSize: 10.5, color: C.muted3, marginTop: 2 }}>No phone on file</Body>}
                      </View>
                    </View>

                    <View style={{ flexDirection: 'row', paddingVertical: 9, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.22)' }}>
                      <MetricCell label="PACKAGE" value={c.package_sessions || '—'} />
                      <MetricCell label="OVERALL" value={m ? m.session_count : <ActivityIndicator size="small" color={C.muted3} />} />
                      <MetricCell label="AFTER RENEWAL" value={m ? m.sessions_after_renewal : <ActivityIndicator size="small" color={C.muted3} />} />
                      <MetricCell label="REMAINING" value={m ? m.remaining_sessions : <ActivityIndicator size="small" color={C.muted3} />} color={col ?? C.green} />
                    </View>

                    <RenewalHistory history={c.renewal_history} />

                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      {genAdmin ? (
                        <Body style={{ flex: 1, fontSize: 10.5, color: C.muted3 }}>Renewed by generation admin</Body>
                      ) : (
                        <Pressable onPress={() => setDateTarget(targetOf(c))} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 11, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
                          <Icon name="calendar" size={12} color={C.muted} strokeWidth={2} />
                          <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: F.bodySemi, fontSize: 10.5, color: fmtDay(c.renewal_date) ? C.ink3 : C.muted3 }}>{fmtDay(c.renewal_date) ?? 'Set date'}</Text>
                          <Icon name="chevRight" size={10} color={C.muted3} strokeWidth={2.3} />
                        </Pressable>
                      )}
                      <Pressable onPress={() => setRenewTarget(targetOf(c))} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, backgroundColor: hexA(C.green, 0.12), borderWidth: 1, borderColor: hexA(C.green, 0.4) }}>
                        <Icon name="swap" size={12} color={C.green} strokeWidth={2.2} />
                        <Text style={{ fontFamily: F.bodyBold, fontSize: 10.5, color: C.green }}>Renew</Text>
                      </Pressable>
                    </View>
                  </Card>
                );
              })}
              {totalPages > 1 ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  {(([['Previous', -1, page <= 1], ['Next', 1, page >= totalPages]]) as [string, number, boolean][]).map(([lab, dir, disabled]) => (
                    <Pressable key={lab} disabled={disabled} onPress={() => setPage((p) => p + dir)} style={{ flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)', opacity: disabled ? 0.4 : 1 }}>
                      <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: C.orange }}>{lab}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              <Mono style={{ fontSize: 8.5, letterSpacing: 0.6, color: C.muted3, textAlign: 'center' }}>PAGE {page} OF {totalPages}</Mono>
            </>
          )}
        </>
      ) : (
        <>
          {/* Renewal opportunities — remaining sessions < 3 */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 13, backgroundColor: hexA(C.red, 0.07), borderWidth: 1, borderColor: hexA(C.red, 0.3) }}>
            <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: hexA(C.red, 0.14), alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="alert" size={14} color={C.red} strokeWidth={2.2} />
            </View>
            <Body style={{ flex: 1, fontSize: 11.5, color: '#E0A090' }}>
              {oppQ.isPending ? 'Scanning all active clients…' : `${oppQ.data?.length ?? 0} subscribed client${(oppQ.data?.length ?? 0) === 1 ? '' : 's'} with fewer than 3 sessions left — prime renewal window.`}
            </Body>
          </View>
          <Err q={oppQ} />
          {oppQ.isPending ? <Loading /> : (oppQ.data ?? []).length === 0 ? (
            <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 24 }}>No clients below 3 remaining sessions. All packages healthy.</Body>
          ) : (
            (oppQ.data ?? []).map((o) => {
              const col = o.remaining_sessions <= 0 ? C.red : C.gold;
              return (
                <Card key={o.id} colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border={hexA(col, 0.3)} radius={15} style={{ padding: 12, gap: 10, borderLeftWidth: 3, borderLeftColor: col }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                    <Avatar initial={(o.name[0] ?? '?').toUpperCase()} size={34} colors={avColors(o.name)} fontSize={13} />
                    <View style={{ flex: 1 }}>
                      <Body numberOfLines={1} style={{ fontSize: 13, fontFamily: F.bodySemi, color: '#fff' }}>{o.name}</Body>
                      <Body numberOfLines={1} style={{ fontSize: 10, color: C.muted3, marginTop: 1 }}>{o.subscription ?? '—'}{o.renewal_date ? ` · renewed ${fmtDay(o.renewal_date)}` : ' · never renewed'}</Body>
                    </View>
                    <View style={{ alignItems: 'center' }}>
                      <Serif style={{ fontSize: 22, color: col }}>{o.remaining_sessions}</Serif>
                      <Mono style={{ fontSize: 7.5, letterSpacing: 0.5, color: C.muted3 }}>LEFT</Mono>
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Body style={{ flex: 1, fontSize: 10.5, color: C.muted2 }}>{o.sessions_after_renewal}/{o.package_sessions} sessions used this package</Body>
                    {o.phone ? (
                      <Pressable onPress={() => Linking.openURL(`tel:${o.phone}`)} hitSlop={6} style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: hexA(C.blue, 0.1), borderWidth: 1, borderColor: hexA(C.blue, 0.35), alignItems: 'center', justifyContent: 'center' }}>
                        <Icon name="phone" size={13} color={C.blue} strokeWidth={2.2} />
                      </Pressable>
                    ) : null}
                    <Pressable onPress={() => setRenewTarget(oppTargetOf(o))} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, backgroundColor: hexA(C.green, 0.12), borderWidth: 1, borderColor: hexA(C.green, 0.4) }}>
                      <Icon name="swap" size={12} color={C.green} strokeWidth={2.2} />
                      <Text style={{ fontFamily: F.bodyBold, fontSize: 10.5, color: C.green }}>Renew</Text>
                    </Pressable>
                  </View>
                </Card>
              );
            })
          )}
        </>
      )}

      {dateTarget ? <RenewalDateSheet target={dateTarget} onClose={() => setDateTarget(null)} /> : null}
      {renewTarget ? <RenewSheet target={renewTarget} onClose={() => setRenewTarget(null)} /> : null}
    </Page>
  );
}
