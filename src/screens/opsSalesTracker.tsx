import React from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator, Alert, Keyboard } from 'react-native';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono, Card } from '../components/primitives';
import { Page, TitleBlock, Badge, HScroll, AnimChip } from './common';
import { SheetShell } from './reportDetail';
import { useAuth } from '../auth';
import {
  useDerivedDailySales, useSalesTargets, useUpsertMonthTarget, useUpdateTarget, useDeleteTarget, useProfilesByIds,
  computeMonthlySummaries, monthLabelOf, inr, SALES_TRACKER_START,
  type DerivedSaleRow, type MonthlySummary, type SalesTargetRow, type SalesProfileInfo,
} from '../lib/opsSalesTrackerQueries';

/* ============ OPS — Sales Tracker (web /ops/sales-tracker) ============
   Daily: read-only derived sale rows for one IST month.
   Monthly: per-month performance summaries + breakdown sheet + targets. */

const istTodayYmd = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const curMonthKey = () => istTodayYmd().slice(0, 7);
const addMonths = (key: string, n: number) => {
  const [y, m] = key.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};
// Row dates are already IST calendar dates (YYYY-MM-DD): format via UTC so the
// device timezone can never shift the day.
const fmtDay = (ymd: string | null) =>
  ymd ? new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', day: '2-digit', month: 'short' }) : '-';
const fmtDayFull = (ymd: string | null) =>
  ymd ? new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' }) : '-';

// Sales credit belongs to CRM/ops/marketing people; admin accounts that appear
// as fallback executors are hidden (web DailySalesTable parity).
const HIDDEN_ASSIGNEE_ROLES = new Set(['admin', 'super_admin']);
const assigneeName = (id: string | null, map: Map<string, SalesProfileInfo> | undefined): string | null => {
  if (!id || !map) return null;
  const p = map.get(id);
  if (!p) return null;
  if (p.role && HIDDEN_ASSIGNEE_ROLES.has(p.role)) return null;
  return p.name;
};

function Loading() {
  return <View style={{ paddingVertical: 36, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View>;
}
function Chip({ label, active, onPress, color = C.orange }: { label: string; active: boolean; onPress: () => void; color?: string }) {
  return (
    <AnimChip active={active} onPress={onPress} style={{ paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, backgroundColor: active ? hexA(color, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(color, 0.5) : 'rgba(255,255,255,0.09)' }}>
      <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 11, color: active ? color : C.muted }}>{label}</Text>
    </AnimChip>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <View style={{ gap: 6 }}><Mono style={{ fontSize: 8.5, letterSpacing: 0.8, color: C.mono2 }}>{label}</Mono>{children}</View>;
}
const inputSt = { borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 11, paddingVertical: 10, color: '#fff', fontFamily: F.body, fontSize: 13 } as const;

/* ---------------- Daily row card ---------------- */
function DailyRow({ r, name }: { r: DerivedSaleRow; name: string | null }) {
  const paid = r.gross > 0;
  const col = paid ? C.green : C.gold;
  return (
    <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border={hexA(col, 0.16)} radius={14} style={{ padding: 12, gap: 8, borderLeftWidth: 3, borderLeftColor: col }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Body numberOfLines={1} style={{ flex: 1, fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{r.customerName}</Body>
        <Badge text={paid ? 'Converted' : 'Pending payment'} color={col} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <Mono style={{ fontSize: 8.5, letterSpacing: 0.5, color: C.mono2 }}>{fmtDay(r.date).toUpperCase()}</Mono>
        <Body style={{ fontSize: 11, color: C.muted2 }}>{name ?? '-'}</Body>
        <Body numberOfLines={1} style={{ flexShrink: 1, fontSize: 11, color: C.muted2 }}>{r.program ?? '-'}{r.duration ? ` · ${r.duration}` : ''}</Body>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 16 }}>
        <View>
          <Mono style={{ fontSize: 7.5, letterSpacing: 0.6, color: C.muted3 }}>GROSS</Mono>
          <Body style={{ fontSize: 13, fontFamily: F.bodyBold, color: C.ink }}>{inr(r.gross)}</Body>
        </View>
        <View>
          <Mono style={{ fontSize: 7.5, letterSpacing: 0.6, color: C.muted3 }}>NET</Mono>
          <Body style={{ fontSize: 13, fontFamily: F.bodySemi, color: C.ink2 }}>{inr(r.net)}</Body>
        </View>
        <View style={{ flex: 1 }} />
        {r.paymentMode ? <Badge text={r.paymentMode} color={C.blue} /> : null}
      </View>
      <Mono style={{ fontSize: 7.5, letterSpacing: 0.5, color: C.muted3 }}>
        QHP BOOKED {r.qhpBookedAt ? fmtDayFull(r.qhpBookedAt).toUpperCase() : '-'} · COMPLETED {r.qhpCompletedAt ? fmtDayFull(r.qhpCompletedAt).toUpperCase() : '-'}
      </Mono>
    </Card>
  );
}

/* ---------------- Monthly summary card ---------------- */
function MonthCard({ s, onPress }: { s: MonthlySummary; onPress: () => void }) {
  const achCol = s.achievementPct == null ? C.muted : s.achievementPct >= 100 ? C.green : s.achievementPct >= 60 ? C.gold : C.red;
  const momUp = (s.momGrowthPct ?? 0) >= 0;
  const momCol = momUp ? C.green : C.red;
  return (
    <Card onPress={onPress} colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border={hexA(C.orange, 0.14)} radius={16} style={{ padding: 13, gap: 9 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Serif style={{ fontSize: 17, flex: 1 }}>{s.monthLabel}</Serif>
        {s.target != null ? (
          <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: achCol }}>
            {s.totalConversions} / {s.target} · {Math.round(s.achievementPct ?? 0)}%
          </Text>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: '#fff' }}>{s.totalConversions}</Text>
            <Mono style={{ fontSize: 8, letterSpacing: 0.6, color: C.muted3 }}>NO TARGET</Mono>
          </View>
        )}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Mono style={{ fontSize: 7.5, letterSpacing: 0.6, color: C.muted3 }}>NET REVENUE</Mono>
          <Body style={{ fontSize: 16, fontFamily: F.bodyBold, color: C.ink }}>{inr(s.netRevenue)}</Body>
        </View>
        {s.momGrowthPct != null ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Icon name={momUp ? 'chevUp' : 'chevDown'} size={11} color={momCol} strokeWidth={2.6} />
            <Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: momCol }}>
              {momUp ? '+' : ''}{s.momGrowthPct.toFixed(1)}% vs {s.prevMonthLabel}
            </Text>
          </View>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        <View style={{ flexShrink: 1 }}>
          <Mono style={{ fontSize: 7.5, letterSpacing: 0.6, color: C.muted3 }}>TOP PROGRAM</Mono>
          <Body numberOfLines={1} style={{ fontSize: 11.5, color: C.ink2 }}>{s.highestSellingProgram ?? '-'}</Body>
        </View>
        <View>
          <Mono style={{ fontSize: 7.5, letterSpacing: 0.6, color: C.muted3 }}>TOP PAYMENT</Mono>
          <Body style={{ fontSize: 11.5, color: C.ink2 }}>{s.topPaymentMode ?? '-'}</Body>
        </View>
      </View>
      {s.conversionsWithoutPayment > 0 ? (
        <Body style={{ fontSize: 10.5, color: C.gold }}>
          {s.conversionsWithoutPayment} conversion{s.conversionsWithoutPayment === 1 ? '' : 's'} without recorded payment
        </Body>
      ) : null}
    </Card>
  );
}

/* ---------------- Saved-target row (inline edit + delete) ---------------- */
function TargetRow({ t }: { t: SalesTargetRow }) {
  const update = useUpdateTarget();
  const del = useDeleteTarget();
  const [editing, setEditing] = React.useState(false);
  const [val, setVal] = React.useState(String(t.target));
  React.useEffect(() => setVal(String(t.target)), [t.target]);

  const n = Number(val);
  const valid = val.trim() !== '' && Number.isFinite(n) && n >= 0;
  const exactMonth = t.start_date.slice(0, 7) === t.end_date.slice(0, 7) && t.start_date.endsWith('-01');
  const label = exactMonth ? monthLabelOf(t.start_date.slice(0, 7)) : `${fmtDayFull(t.start_date)} - ${fmtDayFull(t.end_date)}`;

  const save = () => {
    if (!valid || update.isPending) return;
    update.mutate({ id: t.id, target: n }, {
      onSuccess: () => { Keyboard.dismiss(); setEditing(false); },
      onError: (e: any) => Alert.alert('Could not update target', e?.message ?? 'Try again.'),
    });
  };
  const confirmDelete = () =>
    Alert.alert('Delete target?', `Delete the ${label} target?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => del.mutate(t.id, { onError: (e: any) => Alert.alert('Could not delete target', e?.message ?? 'Try again.') }) },
    ]);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 11, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Body numberOfLines={1} style={{ fontSize: 12.5, fontFamily: F.bodySemi, color: '#fff' }}>{label}</Body>
        <Mono style={{ fontSize: 7.5, letterSpacing: 0.5, color: C.muted3, marginTop: 2 }}>{(t.department ?? 'sales').toUpperCase()}</Mono>
      </View>
      {editing ? (
        <>
          <TextInput
            value={val}
            onChangeText={(v) => setVal(v.replace(/[^0-9]/g, ''))}
            keyboardType="number-pad"
            autoFocus
            placeholderTextColor={C.muted3}
            style={[inputSt, { width: 72, paddingVertical: 7, textAlign: 'center' }]}
          />
          <Pressable disabled={!valid || update.isPending} onPress={save} hitSlop={6} style={{ paddingVertical: 7, paddingHorizontal: 11, borderRadius: 10, backgroundColor: hexA(C.green, valid ? 0.14 : 0.06), borderWidth: 1, borderColor: hexA(C.green, valid ? 0.45 : 0.2) }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 10.5, color: valid ? C.green : C.muted3 }}>{update.isPending ? '…' : 'Save'}</Text>
          </Pressable>
          <Pressable onPress={() => { Keyboard.dismiss(); setEditing(false); setVal(String(t.target)); }} hitSlop={6} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="close" size={12} color={C.muted} strokeWidth={2.3} />
          </Pressable>
        </>
      ) : (
        <>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: C.ink }}>{t.target}</Text>
            <Mono style={{ fontSize: 7, letterSpacing: 0.5, color: C.muted3 }}>CONVERSIONS</Mono>
          </View>
          <Pressable onPress={() => setEditing(true)} hitSlop={6} style={{ paddingVertical: 7, paddingHorizontal: 11, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}>
            <Text style={{ fontFamily: F.bodySemi, fontSize: 10.5, color: C.muted }}>Edit</Text>
          </Pressable>
          <Pressable disabled={del.isPending} onPress={confirmDelete} hitSlop={6} style={{ paddingVertical: 7, paddingHorizontal: 11, borderRadius: 10, backgroundColor: hexA(C.red, 0.08), borderWidth: 1, borderColor: hexA(C.red, 0.3), opacity: del.isPending ? 0.5 : 1 }}>
            <Text style={{ fontFamily: F.bodySemi, fontSize: 10.5, color: C.red }}>{del.isPending ? '…' : 'Delete'}</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

/* ---------------- Set Target sheet ---------------- */
function SetTargetSheet({ visible, onClose, targets }: { visible: boolean; onClose: () => void; targets: SalesTargetRow[] }) {
  const upsert = useUpsertMonthTarget();
  const [monthKey, setMonthKey] = React.useState(curMonthKey());
  const [value, setValue] = React.useState('');
  const monthOptions = React.useMemo(() => [0, 1, 2, 3].map((i) => addMonths(curMonthKey(), i)), []);

  // Prefill with the exact-month row when one exists (web SetTargetDialog parity).
  React.useEffect(() => {
    if (!visible) return;
    const exact = targets.find((t) => t.start_date.slice(0, 7) === monthKey && t.end_date.slice(0, 7) === monthKey);
    setValue(exact ? String(exact.target) : '');
  }, [visible, monthKey, targets]);

  const n = Number(value);
  const valid = value.trim() !== '' && Number.isFinite(n) && n >= 0;
  const save = () => {
    if (!valid || upsert.isPending) return;
    upsert.mutate({ monthKey, target: n }, {
      onSuccess: onClose, // parent's onClose already dismisses the keyboard first
      onError: (e: any) => Alert.alert('Could not save target', e?.message ?? 'Try again.'),
    });
  };

  const sorted = [...targets].sort((a, b) => b.start_date.localeCompare(a.start_date));

  return (
    <SheetShell visible={visible} onClose={onClose} accent={C.orange} icon="target" title="Monthly targets" subtitle="SALES CONVERSION TARGETS">
      <Field label="MONTH">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {monthOptions.map((k) => (
            <Chip key={k} label={monthLabelOf(k)} active={monthKey === k} onPress={() => setMonthKey(k)} />
          ))}
        </View>
      </Field>
      <Field label="TARGET (CONVERSIONS)">
        <TextInput
          value={value}
          onChangeText={(v) => setValue(v.replace(/[^0-9]/g, ''))}
          keyboardType="number-pad"
          placeholder="e.g. 40"
          placeholderTextColor={C.muted3}
          style={inputSt}
        />
      </Field>
      <Body style={{ fontSize: 10.5, color: C.muted2 }}>Achievement % = converted leads in the month / this target.</Body>
      <Pressable onPress={save} disabled={!valid || upsert.isPending} style={{ alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: hexA(C.orange, !valid || upsert.isPending ? 0.06 : 0.16), borderWidth: 1, borderColor: hexA(C.orange, !valid || upsert.isPending ? 0.2 : 0.5) }}>
        <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: !valid || upsert.isPending ? C.muted3 : C.orange }}>{upsert.isPending ? 'Saving…' : 'Save target'}</Text>
      </Pressable>

      <Mono style={{ fontSize: 9, letterSpacing: 0.9, color: C.muted3, marginTop: 4 }}>SAVED TARGETS · {sorted.length}</Mono>
      {sorted.length === 0 ? (
        <Body style={{ fontSize: 11.5, color: C.muted3 }}>No targets saved yet.</Body>
      ) : (
        sorted.map((t) => <TargetRow key={t.id} t={t} />)
      )}
    </SheetShell>
  );
}

/* ---------------- Month breakdown sheet ---------------- */
function BreakdownSheet({ summary, onClose }: { summary: MonthlySummary | null; onClose: () => void }) {
  const s = summary;
  const subscriptionRevenue = s ? s.programBreakdown.reduce((sum, p) => sum + p.revenue, 0) : 0;
  const otherRevenue = s ? s.netRevenue - subscriptionRevenue : 0;
  return (
    <SheetShell
      visible={!!s}
      onClose={onClose}
      accent={C.orange}
      icon="chart"
      title={s ? `${s.monthLabel} breakdown` : ''}
      subtitle={s ? `${s.totalConversions} CONVERSIONS · ${inr(s.netRevenue)} NET` : undefined}
    >
      {s ? (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14, padding: 12, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }}>
            <View>
              <Mono style={{ fontSize: 7.5, letterSpacing: 0.6, color: C.muted3 }}>CONVERSIONS</Mono>
              <Body style={{ fontSize: 14, fontFamily: F.bodyBold, color: C.ink }}>{s.totalConversions}</Body>
              {s.conversionsWithoutPayment > 0 ? (
                <Body style={{ fontSize: 9.5, color: C.gold }}>{s.conversionsWithoutPayment} without payment</Body>
              ) : null}
            </View>
            <View>
              <Mono style={{ fontSize: 7.5, letterSpacing: 0.6, color: C.muted3 }}>TARGET</Mono>
              <Body style={{ fontSize: 14, fontFamily: F.bodyBold, color: C.ink }}>{s.target == null ? '-' : s.target}</Body>
            </View>
            <View>
              <Mono style={{ fontSize: 7.5, letterSpacing: 0.6, color: C.muted3 }}>NET REVENUE</Mono>
              <Body style={{ fontSize: 14, fontFamily: F.bodyBold, color: C.ink }}>{inr(s.netRevenue)}</Body>
            </View>
            <View>
              <Mono style={{ fontSize: 7.5, letterSpacing: 0.6, color: C.muted3 }}>MOM</Mono>
              <Body style={{ fontSize: 14, fontFamily: F.bodyBold, color: s.momGrowthPct == null ? C.ink : s.momGrowthPct >= 0 ? C.green : C.red }}>
                {s.momGrowthPct == null ? '-' : `${s.momGrowthPct >= 0 ? '+' : ''}${s.momGrowthPct.toFixed(1)}%`}
              </Body>
            </View>
          </View>

          <Mono style={{ fontSize: 9, letterSpacing: 0.9, color: C.muted3 }}>SUBSCRIPTIONS SOLD</Mono>
          {s.programBreakdown.length === 0 && otherRevenue <= 0 ? (
            <Body style={{ fontSize: 11.5, color: C.muted3 }}>No subscription breakdown for this month.</Body>
          ) : (
            <View style={{ borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
              {s.programBreakdown.map((p) => (
                <View key={p.program} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' }}>
                  <Body numberOfLines={1} style={{ flex: 1, fontSize: 12.5, color: C.ink }}>{p.program}</Body>
                  <Mono style={{ fontSize: 8.5, letterSpacing: 0.5, color: C.mono2 }}>{p.count} SOLD</Mono>
                  <Body style={{ fontSize: 12.5, fontFamily: F.bodySemi, color: C.ink, minWidth: 78, textAlign: 'right' }}>{inr(p.revenue)}</Body>
                </View>
              ))}
              {otherRevenue > 0 ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' }}>
                  <Body numberOfLines={1} style={{ flex: 1, fontSize: 12.5, color: C.muted2 }}>QHP fees & other</Body>
                  <Body style={{ fontSize: 12.5, fontFamily: F.bodySemi, color: C.ink2, minWidth: 78, textAlign: 'right' }}>{inr(otherRevenue)}</Body>
                </View>
              ) : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: 'rgba(255,255,255,0.04)' }}>
                <Body style={{ flex: 1, fontSize: 12.5, fontFamily: F.bodyBold, color: '#fff' }}>Total</Body>
                <Mono style={{ fontSize: 8.5, letterSpacing: 0.5, color: C.mono2 }}>{s.programBreakdown.reduce((sum, p) => sum + p.count, 0)} SOLD</Mono>
                <Body style={{ fontSize: 12.5, fontFamily: F.bodyBold, color: '#fff', minWidth: 78, textAlign: 'right' }}>{inr(s.netRevenue)}</Body>
              </View>
            </View>
          )}
        </>
      ) : null}
    </SheetShell>
  );
}

/* ---------------- Main screen ---------------- */
export function OpsSalesTracker() {
  const { session, dbRole } = useAuth();
  const salesQ = useDerivedDailySales();
  const targetsQ = useSalesTargets();
  const [tab, setTab] = React.useState<'daily' | 'monthly'>('daily');
  const [month, setMonth] = React.useState(curMonthKey());
  const [year, setYear] = React.useState(istTodayYmd().slice(0, 4));
  const [selected, setSelected] = React.useState<MonthlySummary | null>(null);
  const [targetOpen, setTargetOpen] = React.useState(false);

  const rows = salesQ.data?.rows ?? [];
  const payments = salesQ.data?.payments ?? [];
  const targets = targetsQ.data ?? [];

  const profileIds = React.useMemo(
    () => rows.map((r) => r.assignedTo).filter(Boolean) as string[],
    [rows]
  );
  const profilesQ = useProfilesByIds(profileIds);

  // Month chips: months present in the data + the current IST month, newest
  // first, never before the tracker start (Apr 2026).
  const monthKeys = React.useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.date) set.add(r.date.slice(0, 7));
    set.add(curMonthKey());
    return Array.from(set)
      .filter((k) => k >= SALES_TRACKER_START.slice(0, 7))
      .sort((a, b) => b.localeCompare(a));
  }, [rows]);

  const monthRows = React.useMemo(
    () => rows.filter((r) => r.date != null && r.date.slice(0, 7) === month),
    [rows, month]
  );
  const monthGross = monthRows.reduce((s, r) => s + r.gross, 0);

  const summaries = React.useMemo(
    () => computeMonthlySummaries(rows, payments, targets),
    [rows, payments, targets]
  );
  const yearSummaries = summaries.filter((s) => s.monthKey.slice(0, 4) === year);
  const years = React.useMemo(() => {
    const cur = Number(istTodayYmd().slice(0, 4));
    const out: string[] = [];
    for (let y = 2026; y <= cur; y++) out.push(String(y));
    return out;
  }, []);

  // Target management gate: ops@oddsfitness.com OR raw profiles.role of
  // admin/super_admin (useAuth exposes dbRole = raw profiles.role).
  const canManageTargets =
    session?.user?.email === 'ops@oddsfitness.com' || dbRole === 'admin' || dbRole === 'super_admin';

  // Android new-arch: sheets containing a TextInput must dismiss the keyboard
  // before unmounting, otherwise the app crashes. Route the close through this.
  const closeTargetSheet = React.useCallback(() => {
    Keyboard.dismiss();
    setTimeout(() => setTargetOpen(false), 80);
  }, []);

  return (
    <Page gap={13}>
      <TitleBlock title="Sales Tracker" sub="Derived daily sales · monthly performance" />

      {/* tab toggle */}
      <View style={{ flexDirection: 'row', gap: 7, alignItems: 'center' }}>
        {(([['daily', 'Daily'], ['monthly', 'Monthly']]) as ['daily' | 'monthly', string][]).map(([id, label]) => {
          const active = tab === id;
          return (
            <Pressable key={id} onPress={() => setTab(id)} style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: active ? hexA(C.orange, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.orange, 0.5) : 'rgba(255,255,255,0.09)' }}>
              <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 11.5, color: active ? C.orange : C.muted }}>{label}</Text>
            </Pressable>
          );
        })}
        <View style={{ flex: 1 }} />
        {tab === 'monthly' && canManageTargets ? (
          <Pressable onPress={() => setTargetOpen(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 13, borderRadius: 999, backgroundColor: hexA(C.orange, 0.14), borderWidth: 1, borderColor: hexA(C.orange, 0.45) }}>
            <Icon name="target" size={12} color={C.orange} strokeWidth={2.2} />
            <Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: C.orange }}>Set Target</Text>
          </Pressable>
        ) : null}
      </View>

      {salesQ.isError ? (
        <Body style={{ fontSize: 11.5, color: C.red, textAlign: 'center' }}>{(salesQ.error as Error).message}</Body>
      ) : null}

      {salesQ.isLoading ? (
        <Loading />
      ) : tab === 'daily' ? (
        <>
          <HScroll gap={6}>
            {monthKeys.map((k) => (
              <Chip key={k} label={monthLabelOf(k)} active={month === k} onPress={() => setMonth(k)} />
            ))}
          </HScroll>

          {/* summary header: row count + total gross */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 13, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }}>
            <Mono style={{ flex: 1, fontSize: 8.5, letterSpacing: 0.6, color: C.mono2 }}>
              {monthLabelOf(month).toUpperCase()} · {monthRows.length} {monthRows.length === 1 ? 'ENTRY' : 'ENTRIES'}
            </Mono>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: C.ink }}>{inr(monthGross)}</Text>
            <Mono style={{ fontSize: 7.5, letterSpacing: 0.5, color: C.muted3 }}>GROSS</Mono>
          </View>

          {monthRows.length === 0 ? (
            <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 24 }}>No sales for this month.</Body>
          ) : (
            monthRows.map((r) => (
              <DailyRow key={r.id} r={r} name={assigneeName(r.assignedTo, profilesQ.data)} />
            ))
          )}
        </>
      ) : (
        <>
          <HScroll gap={6}>
            {years.map((y) => (
              <Chip key={y} label={y} active={year === y} onPress={() => setYear(y)} />
            ))}
          </HScroll>

          {yearSummaries.length === 0 ? (
            <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 24 }}>
              No monthly data yet. Summaries appear once converted leads and payments exist.
            </Body>
          ) : (
            <>
              <Body style={{ fontSize: 10.5, color: C.muted3 }}>Tap a month for its breakdown.</Body>
              {yearSummaries.map((s) => (
                <MonthCard key={s.monthKey} s={s} onPress={() => setSelected(s)} />
              ))}
            </>
          )}
        </>
      )}

      {/* breakdown sheet (no inputs — plain close) */}
      <BreakdownSheet summary={selected} onClose={() => setSelected(null)} />

      {/* target management sheet (has inputs — keyboard-safe close) */}
      {canManageTargets ? (
        <SetTargetSheet visible={targetOpen} onClose={closeTargetSheet} targets={targets} />
      ) : null}
    </Page>
  );
}
