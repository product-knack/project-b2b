import React from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono, Card } from '../components/primitives';
import { Page, TitleBlock, Badge, BackLink, HScroll } from './common';
import { supabase } from '../lib/supabase';
import { inr } from '../lib/adminQueries';

/* ============ ADMIN — Revenue Tracker + Revenue Summary (web /compliance/tools ports) ============
   Both sit behind the web's password gate (edge fn verify-revenue-tracker-password);
   unlock is held in memory for the session, like the web's sessionStorage flag. */

let unlocked = false; // session-scoped, mirrors web sessionStorage["revenue-tracker-unlocked"]
function Gate({ children }: { children: React.ReactNode }) {
  const [ok, setOk] = React.useState(unlocked);
  const [pw, setPw] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  if (ok) return <>{children}</>;
  return (
    <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border={hexA(C.gold, 0.25)} radius={16} style={{ padding: 16, gap: 10, alignItems: 'center' }}>
      <Icon name="shield" size={22} color={C.gold} strokeWidth={2} />
      <Serif style={{ fontSize: 16 }}>Protected area</Serif>
      <Body style={{ fontSize: 11, color: C.muted2, textAlign: 'center' }}>Enter the revenue tracker password to continue.</Body>
      <TextInput value={pw} onChangeText={setPw} secureTextEntry placeholder="Password" placeholderTextColor={C.muted3}
        style={{ alignSelf: 'stretch', borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 11, paddingVertical: 10, color: '#fff', fontFamily: F.body, fontSize: 13 }} />
      {err ? <Body style={{ fontSize: 10.5, color: C.red }}>{err}</Body> : null}
      <Pressable disabled={busy || !pw} onPress={async () => {
        setBusy(true); setErr(null);
        try {
          const { data, error } = await supabase.functions.invoke('verify-revenue-tracker-password', { body: { password: pw } });
          if (error || !(data as any)?.ok) setErr('Incorrect password.');
          else { unlocked = true; setOk(true); }
        } catch { setErr('Could not verify — try again.'); }
        setBusy(false);
      }} style={{ alignSelf: 'stretch', alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: hexA(C.gold, busy || !pw ? 0.06 : 0.16), borderWidth: 1, borderColor: hexA(C.gold, busy || !pw ? 0.2 : 0.5) }}>
        <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: busy || !pw ? C.muted3 : C.gold }}>{busy ? 'Verifying…' : 'Unlock'}</Text>
      </Pressable>
    </Card>
  );
}

/* ---------------- Shared data (web useRevenueTrackerData, fetchAll-paginated) ---------------- */
const fetchAll = async (build: (from: number) => any): Promise<any[]> => {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from).range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
};
function useRevClients() {
  return useQuery({
    queryKey: ['rev-tracker-clients'],
    staleTime: 120_000,
    queryFn: async () => {
      const rows = await fetchAll(() => supabase.from('clients')
        .select('id, first_name, last_name, email, status, subscription_type, session_package, sessions_per_cycle, package_duration, package_amount, payment_date, created_at, miscellaneous_payments, without_gst')
        .in('status', ['active', 'inactive', 'discontinued']).order('created_at', { ascending: true }));
      return rows.filter((c) => c.subscription_type && String(c.subscription_type).toLowerCase() !== 'staff');
    },
  });
}
function useRevRenewals() {
  return useQuery({
    queryKey: ['rev-tracker-renewals'],
    staleTime: 120_000,
    queryFn: () => fetchAll(() => supabase.from('client_renewals').select('*').order('renewed_at', { ascending: true })),
  });
}
function useAddons() {
  return useQuery({
    queryKey: ['rev-tracker-addons'],
    staleTime: 120_000,
    queryFn: async () => {
      const [pkgs, rens] = await Promise.all([
        fetchAll(() => supabase.from('additional_packages').select('id, client_id, service_name, package_amount, payment_date').order('payment_date', { ascending: false })),
        fetchAll(() => supabase.from('additional_service_renewals').select('id, client_id, package_amount, payment_date').order('payment_date', { ascending: false })),
      ]);
      return { pkgs, rens };
    },
  });
}
const miscOf = (clients: any[]) => clients.flatMap((c) => (Array.isArray(c.miscellaneous_payments) ? c.miscellaneous_payments : [])
  .filter((m: any) => typeof m?.payment_date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(m.payment_date))
  .map((m: any) => ({ clientName: `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim(), amount: Number(m.amount) || 0, payment_date: m.payment_date })));
const parseMonths = (d: string | null) => { const m = /(\d+)/.exec(String(d ?? '')); return m ? parseInt(m[1]) : 3; };
const ym = (d: string | null | undefined) => (typeof d === 'string' ? d.slice(0, 7) : '');

export function AdminRevenueTracker() {
  const clientsQ = useRevClients();
  const renewalsQ = useRevRenewals();
  const [search, setSearch] = React.useState('');
  const [missingOnly, setMissingOnly] = React.useState(false);
  const clients = clientsQ.data ?? [];
  const renewals = renewalsQ.data ?? [];
  const loading = clientsQ.isPending || renewalsQ.isPending;

  const latestRenewal = new Map<string, any>();
  renewals.forEach((r: any) => { if (r.client_id && r.request_status !== 'rejected') latestRenewal.set(r.client_id, r); }); // asc order → last write = latest
  const ltvByClient = new Map<string, number>();
  renewals.forEach((r: any) => { if (r.client_id) ltvByClient.set(r.client_id, (ltvByClient.get(r.client_id) ?? 0) + (Number(r.package_amount) || 0)); });

  const rows = clients.map((c: any) => {
    const ren = latestRenewal.get(c.id);
    const total = ren?.package_sessions || (Number(c.sessions_per_cycle) || 0) * parseMonths(c.package_duration);
    const renewalAmount = Number(ren?.package_amount ?? c.package_amount) || 0;
    const paymentDate = ren?.payment_date ?? c.payment_date ?? null;
    const ltv = (Number(c.package_amount) || 0) + (ltvByClient.get(c.id) ?? 0);
    return { id: c.id, name: `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || '—', email: c.email, status: c.status, sub: c.subscription_type, total, renewalAmount, paymentDate, ltv, cycleStart: ren?.renewed_at ?? c.created_at };
  });
  const term = search.trim().toLowerCase();
  const filtered = rows.filter((r) => (!term || r.name.toLowerCase().includes(term) || String(r.email ?? '').toLowerCase().includes(term)) && (!missingOnly || !r.renewalAmount));
  const totalLtv = rows.reduce((s, r) => s + r.ltv, 0);
  const missingCount = rows.filter((r) => !r.renewalAmount).length;

  return (
    <Page gap={13}>
      <BackLink label="Tools" />
      <TitleBlock title="Revenue Tracker" sub="Per-client packages, amounts & lifetime value" />
      <Gate>
        <View style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 9 }}>
            {(([['CLIENTS', String(rows.length), C.blue], ['TOTAL LTV', inr(totalLtv), C.gold], ['MISSING AMOUNT', String(missingCount), C.red]]) as [string, string, string][]).map(([lab, val, col]) => (
              <Card key={lab} colors={['rgba(60,38,24,0.45)', 'rgba(18,14,14,0.5)']} border={hexA(col, 0.22)} radius={14} style={{ flexGrow: 1, minWidth: 96, padding: 11, alignItems: 'center', gap: 2 }}>
                <Serif style={{ fontSize: 17, color: col }}>{loading ? '—' : val}</Serif>
                <Mono style={{ fontSize: 7.5, letterSpacing: 0.5, color: C.muted3 }}>{lab}</Mono>
              </Card>
            ))}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)' }}>
              <Icon name="search" size={14} color={C.muted3} strokeWidth={2} />
              <TextInput value={search} onChangeText={setSearch} placeholder="Search name or email…" placeholderTextColor={C.muted3} style={{ flex: 1, fontFamily: F.body, fontSize: 13, color: '#fff', padding: 0 }} />
            </View>
            <Pressable onPress={() => setMissingOnly((v) => !v)} style={{ paddingVertical: 9, paddingHorizontal: 11, borderRadius: 999, backgroundColor: missingOnly ? hexA(C.red, 0.14) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: missingOnly ? hexA(C.red, 0.5) : 'rgba(255,255,255,0.09)' }}>
              <Text style={{ fontFamily: missingOnly ? F.bodyBold : F.bodySemi, fontSize: 10, color: missingOnly ? C.red : C.muted }}>Missing ₹</Text>
            </Pressable>
          </View>
          {clientsQ.isError ? <Body style={{ fontSize: 11, color: C.red, textAlign: 'center' }}>{(clientsQ.error as Error).message}</Body> : null}
          {loading ? <View style={{ paddingVertical: 26, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View>
          : filtered.slice(0, 60).map((r) => (
            <Card key={r.id} colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border={hexA(r.renewalAmount ? '#94A3B8' : C.red, r.renewalAmount ? 0.1 : 0.3)} radius={14} style={{ padding: 11, gap: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                <Body numberOfLines={1} style={{ flex: 1, fontSize: 12.5, fontFamily: F.bodySemi, color: '#fff' }}>{r.name}</Body>
                {r.sub ? <Badge text={r.sub} color={C.gold} /> : null}
                <Serif style={{ fontSize: 15, color: r.renewalAmount ? C.green : C.red }}>{r.renewalAmount ? inr(r.renewalAmount) : '—'}</Serif>
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 9 }}>
                <Body style={{ fontSize: 10, color: C.muted3 }}>Package <Text style={{ color: C.ink2 }}>{r.total || '—'}</Text></Body>
                <Body style={{ fontSize: 10, color: C.muted3 }}>Paid <Text style={{ color: C.ink2 }}>{r.paymentDate ? String(r.paymentDate).slice(0, 10) : 'missing'}</Text></Body>
                <Body style={{ fontSize: 10, color: C.muted3 }}>LTV <Text style={{ color: '#F2C066' }}>{inr(r.ltv)}</Text></Body>
                <Badge text={r.status} color={r.status === 'active' ? C.green : r.status === 'discontinued' ? C.red : '#94A3B8'} />
              </View>
            </Card>
          ))}
          {!loading && filtered.length > 60 ? <Mono style={{ fontSize: 8.5, letterSpacing: 0.6, color: C.muted3, textAlign: 'center' }}>+{filtered.length - 60} MORE — REFINE THE SEARCH</Mono> : null}
        </View>
      </Gate>
    </Page>
  );
}

/* ---------------- Revenue Summary (month KPIs + ledger) ---------------- */
export function AdminRevenueSummary() {
  const clientsQ = useRevClients();
  const renewalsQ = useRevRenewals();
  const addonsQ = useAddons();
  const pendingQ = useQuery({
    queryKey: ['rev-pending-requests'],
    staleTime: 120_000,
    queryFn: () => fetchAll(() => supabase.from('renewal_payment_requests').select('id, payment_status, new_package_amount, created_at')),
  });
  const [month, setMonth] = React.useState(new Date().toISOString().slice(0, 7));
  const shiftMonth = (d: number) => {
    const [y, m] = month.split('-').map(Number);
    const dt = new Date(y, m - 1 + d, 1);
    setMonth(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`);
  };
  const clients = clientsQ.data ?? [];
  const renewals = renewalsQ.data ?? [];
  const addons = addonsQ.data ?? { pkgs: [], rens: [] };
  const loading = clientsQ.isPending || renewalsQ.isPending || addonsQ.isPending;

  const sum = (rows: any[], amtKey: string) => rows.reduce((s, r) => s + (Number(r[amtKey]) || 0), 0);
  const newClientRows = clients.filter((c: any) => ym(c.payment_date) === month).map((c: any) => ({ label: `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim(), kind: 'New Client', amount: Number(c.package_amount) || 0, date: c.payment_date }));
  const renewalRows = renewals.filter((r: any) => r.request_status !== 'rejected' && ym(r.payment_date) === month).map((r: any) => ({ label: r.new_package ?? 'Renewal', kind: 'Renewal', amount: Number(r.package_amount) || 0, date: r.payment_date }));
  const addonRows = [...addons.pkgs, ...addons.rens].filter((a: any) => ym(a.payment_date) === month).map((a: any) => ({ label: a.service_name ?? 'Add-on', kind: 'Add-on', amount: Number(a.package_amount) || 0, date: a.payment_date }));
  const miscRows = miscOf(clients).filter((m) => ym(m.payment_date) === month).map((m) => ({ label: m.clientName, kind: 'Misc', amount: m.amount, date: m.payment_date }));
  const pending = (pendingQ.data ?? []).filter((r: any) => !['paid', 'cancelled'].includes(r.payment_status));
  const totals = { n: sum(newClientRows, 'amount'), r: sum(renewalRows, 'amount'), a: sum(addonRows, 'amount'), m: sum(miscRows, 'amount'), p: sum(pending, 'new_package_amount') };
  const ledger = [...newClientRows, ...renewalRows, ...addonRows, ...miscRows].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const kindColor: Record<string, string> = { 'New Client': C.blue, Renewal: C.gold, 'Add-on': C.green, Misc: C.purple };

  return (
    <Page gap={13}>
      <BackLink label="Tools" />
      <TitleBlock title="Revenue Summary" sub="Month ledger across all payment streams" />
      <Gate>
        <View style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
            <Pressable onPress={() => shiftMonth(-1)} hitSlop={8}><Icon name="chevLeft" size={16} color={C.orange} strokeWidth={2.4} /></Pressable>
            <Serif style={{ fontSize: 16 }}>{new Date(`${month}-01T12:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</Serif>
            <Pressable onPress={() => shiftMonth(1)} hitSlop={8}><Icon name="chevRight" size={16} color={C.orange} strokeWidth={2.4} /></Pressable>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 9 }}>
            {(([['NEW CLIENTS', totals.n, C.blue], ['RENEWALS', totals.r, C.gold], ['ADD-ONS', totals.a, C.green], ['MISC', totals.m, C.purple], ['TOTAL', totals.n + totals.r + totals.a + totals.m, C.orange], ['PENDING / UNRECEIVED', totals.p, C.red]]) as [string, number, string][]).map(([lab, n, col]) => (
              <Card key={lab} colors={['rgba(60,38,24,0.45)', 'rgba(18,14,14,0.5)']} border={hexA(col, 0.22)} radius={14} style={{ width: '47.5%', flexGrow: 1, padding: 11, gap: 3 }}>
                <Mono style={{ fontSize: 7.5, letterSpacing: 0.5, color: C.muted3 }}>{lab}</Mono>
                <Serif style={{ fontSize: 18, color: col }}>{loading ? '—' : inr(n)}</Serif>
              </Card>
            ))}
          </View>
          <Body style={{ fontSize: 9, color: C.faint }}>Pending / Unreceived is the global awaiting-payment backlog (not month-scoped) — web parity.</Body>
          <Mono style={{ fontSize: 9.5, letterSpacing: 1.2, color: C.mono }}>PAYMENTS THIS MONTH · {ledger.length}</Mono>
          {loading ? <View style={{ paddingVertical: 24, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View>
          : ledger.length === 0 ? <Body style={{ fontSize: 11.5, color: C.muted3, textAlign: 'center', paddingVertical: 16 }}>No payments recorded this month.</Body>
          : ledger.slice(0, 80).map((l, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.22)' }}>
              <Badge text={l.kind} color={kindColor[l.kind]} />
              <Body numberOfLines={1} style={{ flex: 1, fontSize: 11.5, color: '#fff', fontFamily: F.bodySemi }}>{l.label || '—'}</Body>
              <Mono style={{ fontSize: 7.5, letterSpacing: 0.4, color: C.muted3 }}>{String(l.date).slice(0, 10)}</Mono>
              <Serif style={{ fontSize: 14, color: C.green }}>{inr(l.amount)}</Serif>
            </View>
          ))}
          {!loading && ledger.length > 80 ? <Mono style={{ fontSize: 8.5, letterSpacing: 0.6, color: C.muted3, textAlign: 'center' }}>+{ledger.length - 80} MORE ROWS</Mono> : null}
        </View>
      </Gate>
    </Page>
  );
}
