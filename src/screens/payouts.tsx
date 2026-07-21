import React from 'react';
import { View, Text, Pressable, ActivityIndicator, Animated, Easing } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C, F, hexA, ORANGE_GRAD } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono, Card } from '../components/primitives';
import { Page } from './common';
import { useAuth } from '../auth';
import { DEV_TRAINER_ID } from '../lib/supabase';
import {
  usePayoutHistory, usePayoutSessionDetails, payoutTypeMeta, inr,
  PayoutBatch, PayoutRecord,
} from '../lib/payoutQueries';

/* ============ TRAINER PAYOUTS — obsidian/ember redesign ============ */

const fmtPaidDay = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const fmtPaidTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase() : '';
const fmtDay = (d: string | null, withYear = false) =>
  d ? new Date(d + 'T00:00:00+05:30').toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', ...(withYear ? { year: 'numeric' } : {}) }) : '—';

/* Animated ₹ figure with Indian digit grouping. */
function CountUpINR({ value, style, duration = 1000 }: { value: number; style?: any; duration?: number }) {
  const [display, setDisplay] = React.useState(0);
  const anim = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    anim.setValue(0);
    const id = anim.addListener(({ value: v }) => setDisplay(Math.round(v)));
    Animated.timing(anim, { toValue: value, duration, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
    return () => anim.removeListener(id);
  }, [value]);
  return <Text style={style}>₹{display.toLocaleString('en-IN')}</Text>;
}

function TypeBadge({ type }: { type: string }) {
  const { label, color } = payoutTypeMeta(type);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 3.5, paddingHorizontal: 9, borderRadius: 999, backgroundColor: hexA(color, 0.12), borderWidth: 1, borderColor: hexA(color, 0.3) }}>
      <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: color }} />
      <Text style={{ fontFamily: F.bodyBold, fontSize: 9.5, letterSpacing: 0.3, color }}>{label.toUpperCase()}</Text>
    </View>
  );
}

/* One record (cycle line) inside a batch — expands to its session breakdown. */
function RecordRow({ record }: { record: PayoutRecord }) {
  const [open, setOpen] = React.useState(false);
  const sessQ = usePayoutSessionDetails(open ? record : null);
  const meta = payoutTypeMeta(record.payout_type);
  const name = record.clientName || record.reimbursement?.title || meta.label;
  const hasDetail = record.paid_session_ids.length > 0 || record.paid_cancelled_session_ids.length > 0;

  return (
    <View style={{ borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.025)', borderWidth: 1, borderColor: open ? hexA(meta.color, 0.28) : 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
      <Pressable onPress={() => hasDetail && setOpen((o) => !o)} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: 12 }}>
        <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: hexA(meta.color, 0.12), borderWidth: 1, borderColor: hexA(meta.color, 0.25), alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={record.payout_type.startsWith('qhp') ? 'heart' : record.payout_type === 'reimbursement' ? 'rupee' : 'dumbbell'} size={15} color={meta.color} strokeWidth={1.9} />
        </View>
        <View style={{ flex: 1 }}>
          <Body numberOfLines={1} style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{name}</Body>
          <Mono style={{ fontSize: 8.5, letterSpacing: 0.4, color: C.muted3, marginTop: 2.5 }}>
            {record.cycle_number ? `PKG ${record.packageNumber} · CYCLE ${record.cycleNumber} · ` : ''}{record.completed_sessions} × {inr(record.fee_per_session)}
          </Mono>
        </View>
        <Text style={{ fontFamily: F.bodyBold, fontSize: 14.5, color: '#fff' }}>{inr(record.amount)}</Text>
        {hasDetail ? <Icon name={open ? 'chevUp' : 'chevDown'} size={14} color={C.muted3} strokeWidth={2.2} /> : null}
      </Pressable>
      {open ? (
        <View style={{ paddingHorizontal: 12, paddingBottom: 12, gap: 7, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)', paddingTop: 10 }}>
          {sessQ.isLoading ? (
            <Body style={{ fontSize: 11.5, color: C.muted3, textAlign: 'center', paddingVertical: 6 }}>Loading sessions…</Body>
          ) : (sessQ.data ?? []).length === 0 ? (
            <Body style={{ fontSize: 11.5, color: C.muted3, textAlign: 'center', paddingVertical: 6 }}>No session details.</Body>
          ) : (
            (sessQ.data ?? []).map((s, i) => (
              <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: hexA(s.cancelled ? C.red : C.green, 0.12), alignItems: 'center', justifyContent: 'center' }}>
                  <Icon path={s.cancelled ? 'M18 6 6 18M6 6l12 12' : 'M20 6 9 17l-5-5'} size={10} color={s.cancelled ? C.red : C.green} strokeWidth={2.6} />
                </View>
                <Mono style={{ fontSize: 9, color: C.muted3, width: 18 }}>{i + 1}</Mono>
                <Body style={{ flex: 1, fontSize: 12, color: s.cancelled ? C.muted3 : C.ink3, textDecorationLine: s.cancelled ? 'line-through' : 'none' }}>
                  {fmtDay(s.scheduled_at?.slice(0, 10) ?? null, true)}{s.session_type ? ` · ${s.session_type.replace(/_/g, ' ')}` : ''}
                </Body>
                <Mono style={{ fontSize: 10, color: s.cancelled ? C.muted3 : C.ink3 }}>{inr(record.fee_per_session)}</Mono>
              </View>
            ))
          )}
          {record.remarks ? (
            <View style={{ flexDirection: 'row', gap: 7, marginTop: 3, padding: 9, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.03)' }}>
              <Icon name="chat" size={12} color={C.muted3} strokeWidth={2} />
              <Body style={{ flex: 1, fontSize: 11.5, color: C.muted2, fontStyle: 'italic' }}>{record.remarks}</Body>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/* A payout batch (payment cycle) — timeline node + collapsible card. */
function BatchCard({ batch, isLatest, isLast }: { batch: PayoutBatch; isLatest: boolean; isLast: boolean }) {
  const [open, setOpen] = React.useState(false);
  const adjusted = batch.totalExtras > 0 || batch.totalDeductions > 0;
  return (
    <View style={{ flexDirection: 'row', gap: 12 }}>
      {/* Timeline rail */}
      <View style={{ width: 16, alignItems: 'center' }}>
        <View style={{ width: 13, height: 13, borderRadius: 7, marginTop: 20, backgroundColor: isLatest ? C.orange : 'rgba(255,255,255,0.09)', borderWidth: 2.5, borderColor: isLatest ? hexA(C.orange, 0.35) : 'rgba(255,255,255,0.14)' }} />
        {!isLast ? <View style={{ flex: 1, width: 1.5, backgroundColor: 'rgba(255,255,255,0.07)', marginTop: 5, marginBottom: -14 }} /> : null}
      </View>

      {/* Card */}
      <View style={{ flex: 1, borderRadius: 19, overflow: 'hidden', borderWidth: 1, borderColor: open ? hexA(C.orange, 0.3) : isLatest ? hexA(C.orange, 0.2) : 'rgba(255,255,255,0.07)', backgroundColor: 'rgba(24,17,14,0.55)' }}>
        <LinearGradient colors={isLatest ? [hexA(C.orange, 0.55), 'rgba(255,255,255,0.02)'] : ['rgba(255,255,255,0.1)', 'rgba(255,255,255,0.01)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 3 }} />
        <Pressable onPress={() => setOpen((o) => !o)} style={{ padding: 15, gap: 11 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Body style={{ fontSize: 15.5, fontFamily: F.bodyBold, color: '#fff' }}>{fmtPaidDay(batch.paidAt)}</Body>
                {isLatest ? (
                  <View style={{ paddingVertical: 2, paddingHorizontal: 7, borderRadius: 999, backgroundColor: hexA(C.orange, 0.15), borderWidth: 1, borderColor: hexA(C.orange, 0.4) }}>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 8, letterSpacing: 0.8, color: C.orange }}>LATEST</Text>
                  </View>
                ) : null}
              </View>
              <Mono style={{ fontSize: 9, letterSpacing: 0.5, color: C.muted3, marginTop: 3 }}>PAID {fmtPaidTime(batch.paidAt)}</Mono>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              {adjusted ? <Text style={{ fontFamily: F.mono, fontSize: 10.5, color: C.muted3, textDecorationLine: 'line-through' }}>{inr(batch.gross + batch.totalExtras)}</Text> : null}
              <Serif style={{ fontSize: 23, color: C.orange }}>{inr(batch.net)}</Serif>
              <Mono style={{ fontSize: 7.5, letterSpacing: 0.8, color: C.muted3, marginTop: 1 }}>NET PAYOUT</Mono>
            </View>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 3.5, paddingHorizontal: 9, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)' }}>
              <Icon name="calendar" size={10} color={C.muted2} strokeWidth={2.2} />
              <Text style={{ fontFamily: F.bodySemi, fontSize: 10, color: C.muted2 }}>{fmtDay(batch.periodStart)} – {fmtDay(batch.periodEnd, true)}</Text>
            </View>
            {batch.types.map((t) => <TypeBadge key={t} type={t} />)}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 3.5, paddingHorizontal: 9, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)' }}>
              <Icon name="dumbbell" size={10} color={C.muted2} strokeWidth={2.2} />
              <Text style={{ fontFamily: F.bodySemi, fontSize: 10, color: C.muted2 }}>{batch.sessionCount}</Text>
            </View>
            <View style={{ flex: 1 }} />
            <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={open ? 'chevUp' : 'chevDown'} size={13} color={C.muted2} strokeWidth={2.3} />
            </View>
          </View>
        </Pressable>

        {open ? (
          <View style={{ paddingHorizontal: 15, paddingBottom: 15, gap: 13 }}>
            {/* Breakdown */}
            <View style={{ borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.28)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
              <View style={{ padding: 13, gap: 9 }}>
                <Mono style={{ fontSize: 9, letterSpacing: 1.2, color: C.mono2 }}>BREAKDOWN</Mono>
                <Row label={`Sessions · ${batch.sessionCount}`} value={inr(batch.gross)} />
                {batch.extras.map((e, i) => <Row key={`e${i}`} label={e.name} value={`+ ${inr(e.amount)}`} color={C.green} />)}
                {batch.deductions.map((d, i) => <Row key={`d${i}`} label={d.name} value={`− ${inr(d.amount)}`} color={C.red} />)}
              </View>
              <LinearGradient colors={[hexA(C.orange, 0.16), hexA(C.orange, 0.06)]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 13, borderTopWidth: 1, borderTopColor: hexA(C.orange, 0.2) }}>
                <Text style={{ flex: 1, fontFamily: F.bodyBold, fontSize: 13, color: '#fff' }}>Net Payout</Text>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 17, color: C.orange }}>{inr(batch.net)}</Text>
              </LinearGradient>
            </View>

            {/* Cycle details */}
            <View style={{ gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Mono style={{ fontSize: 9, letterSpacing: 1.2, color: C.mono2 }}>CYCLE DETAILS</Mono>
                <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.06)' }} />
                <Mono style={{ fontSize: 9, color: C.muted3 }}>{batch.records.length}</Mono>
              </View>
              {batch.records.map((r) => <RecordRow key={r.id} record={r} />)}
            </View>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {color ? <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: color, marginRight: 7 }} /> : null}
      <Body numberOfLines={1} style={{ flex: 1, fontSize: 12.5, color: C.muted2 }}>{label}</Body>
      <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: color ?? C.ink }}>{value}</Text>
    </View>
  );
}

export function Payouts() {
  const { session } = useAuth();
  const isTestAccount = session?.user?.email?.startsWith('rn-test-trainer');
  const trainerId = !session ? '' : isTestAccount ? DEV_TRAINER_ID : session.user.id;
  const q = usePayoutHistory(trainerId);
  const batches = q.data ?? [];

  const totalEarnings = batches.reduce((s, b) => s + b.net, 0);
  const avg = batches.length ? Math.round(totalEarnings / batches.length) : 0;
  const lastPaid = batches[0]?.paidAt ?? null;

  return (
    <Page gap={16} pt={6}>
      {/* Hero — total earnings */}
      <Card colors={['rgba(64,38,22,0.55)', 'rgba(18,14,14,0.6)']} border="rgba(255,150,90,0.16)" radius={22} style={{ overflow: 'hidden' }}>
        <LinearGradient colors={['#E0A53C', '#FB8B3A', '#EE5E16']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 4 }} />
        <View style={{ padding: 18, gap: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Mono style={{ fontSize: 10, letterSpacing: 1.8, color: C.mono2 }}>TOTAL EARNINGS</Mono>
              {q.isLoading ? (
                <Serif style={{ fontSize: 38, marginTop: 6, color: C.muted3 }}>—</Serif>
              ) : (
                <CountUpINR value={totalEarnings} style={{ fontFamily: F.serif, fontSize: 38, lineHeight: 44, color: '#fff', marginTop: 6 }} />
              )}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 }}>
                <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: C.green }} />
                <Body style={{ fontSize: 11.5, color: C.muted2 }}>{lastPaid ? `Last paid ${fmtPaidDay(lastPaid)}` : 'Earnings, bonuses & payments'}</Body>
              </View>
            </View>
            <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 54, height: 54, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="rupee" size={25} color="#fff" strokeWidth={2} />
            </LinearGradient>
          </View>

          {/* Inline stats */}
          <View style={{ flexDirection: 'row', borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.28)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', paddingVertical: 12 }}>
            {([
              ['CYCLES', String(batches.length), C.blue],
              ['AVG / CYCLE', inr(avg), C.green],
              ['THIS BATCH', batches[0] ? inr(batches[0].net) : '—', C.gold],
            ] as const).map(([lab, val, col], i) => (
              <View key={lab} style={{ flex: 1, alignItems: 'center', gap: 3, borderLeftWidth: i === 0 ? 0 : 1, borderLeftColor: 'rgba(255,255,255,0.06)' }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 15.5, color: col }}>{val}</Text>
                <Mono style={{ fontSize: 7.5, letterSpacing: 0.8, color: C.muted3 }}>{lab}</Mono>
              </View>
            ))}
          </View>
        </View>
      </Card>

      {/* History */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
        <Mono style={{ fontSize: 10.5, letterSpacing: 1.8, color: C.mono2 }}>PAYMENT HISTORY</Mono>
        <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.06)' }} />
        {batches.length ? <Mono style={{ fontSize: 10, color: C.muted3 }}>{batches.length} cycle{batches.length === 1 ? '' : 's'}</Mono> : null}
      </View>

      {q.isLoading ? (
        <View style={{ alignItems: 'center', gap: 8, paddingVertical: 34 }}>
          <ActivityIndicator color={C.orange} />
          <Body style={{ fontSize: 12.5, color: C.muted3 }}>Loading payouts…</Body>
        </View>
      ) : q.isError ? (
        <Body style={{ color: C.red, textAlign: 'center', paddingVertical: 24 }}>Couldn't load payouts.</Body>
      ) : batches.length === 0 ? (
        <View style={{ alignItems: 'center', gap: 10, paddingVertical: 40 }}>
          <View style={{ width: 52, height: 52, borderRadius: 17, backgroundColor: hexA(C.orange, 0.09), borderWidth: 1, borderColor: hexA(C.orange, 0.2), alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="rupee" size={23} color={C.orange} strokeWidth={1.8} />
          </View>
          <Body style={{ fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }}>No payouts yet</Body>
          <Body style={{ fontSize: 12, color: C.muted3, textAlign: 'center', paddingHorizontal: 44, lineHeight: 17 }}>Your payment cycles will appear here once they're processed.</Body>
        </View>
      ) : (
        <View style={{ gap: 14 }}>
          {batches.map((b, i) => <BatchCard key={b.batchId} batch={b} isLatest={i === 0} isLast={i === batches.length - 1} />)}
        </View>
      )}
    </Page>
  );
}
