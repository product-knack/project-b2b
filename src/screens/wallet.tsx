import React from 'react';
import { View, Text, Pressable, TextInput, Modal, ScrollView, ActivityIndicator, Alert, Keyboard } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import { C, F, hexA, ORANGE_GRAD } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono, Card } from '../components/primitives';
import { Page, TitleBlock, AccessPending } from './common';
import { useAuth } from '../auth';
import { useStore } from '../store';
import { useKeyboardHeight } from '../lib/useKeyboardHeight';
import { useIsOnline } from '../lib/offline';
import { useTeamWallet, useTeamWalletPage, useCreateTopup, useVerifyTopup, useWalletRealtime, walletErrorText, type TopupOrder } from '../lib/teamWalletQueries';
import {
  DAILY_CAP_PAISE, TOPUP_PICKS, balanceText, negativeBalanceLine, fmtWhen, freeLeftLine, groupByMonth, isPendingBill, isPendingTopup, methodLabel, parseRupeeInput, rowAmountText, rowChip, rowSecondLine, rowTitle, rupees,
  signedRupees, topupExpired, topupProblem, topupRoomLine, type Tone, type WalletRow,
} from '../lib/teamWallet';
import { WalletCheckout, type CheckoutMessage } from '../components/WalletCheckout';
import { trackEvent } from '../lib/amplitude';

/* ============ Wallet (Team Wallet, 2 Nov 2026) ============
   Every staff role: add money through Razorpay (Rs 500 to Rs 5,000 a day), see the balance and the own history.
   The ledger is the definer RPC get_my_team_wallet; money moves only through the edge functions. The Odds AI plan
   bill (trainers) is settled from Create Plan, where the draft lands; from here a waiting bill can only be opened
   there. Offline: the cached balance and history, read-only. Plan: docs/team-wallet-plan.md. */

const TONE: Record<Tone, string> = { green: C.green, amber: C.gold, red: C.red, grey: C.muted3 };
const OFFLINE_LINE = 'No connection. Money can only be added online.';

function Chip({ text, tone }: { text: string; tone: Tone }) {
  const color = TONE[tone];
  return (
    <View style={{ paddingVertical: 3, paddingHorizontal: 8, borderRadius: 999, backgroundColor: hexA(color, 0.14), borderWidth: 1, borderColor: hexA(color, 0.4) }}>
      <Text style={{ fontFamily: F.bodyBold, fontSize: 9.5, color }}>{text}</Text>
    </View>
  );
}

function RowCard({ r, now, onPress }: { r: WalletRow; now: number; onPress: () => void }) {
  const chip = rowChip(r, now);
  const credit = r.amount_paise >= 0;
  return (
    <Pressable onPress={onPress} hitSlop={4} accessibilityRole="button" accessibilityLabel={`${rowTitle(r)}, ${rowAmountText(r)}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 13, borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: hexA(TONE[chip.tone], 0.22) }}>
      <View style={{ flex: 1, gap: 3 }}>
        <Body numberOfLines={1} style={{ fontSize: 14.5, fontFamily: F.bodySemi, color: '#fff' }}>{rowTitle(r)}</Body>
        <Body numberOfLines={2} style={{ fontSize: 11.5, color: C.muted2, lineHeight: 15 }}>{rowSecondLine(r, now)}</Body>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 5 }}>
        <Text style={{ fontFamily: F.bodyBold, fontSize: 14.5, color: credit ? C.green : '#fff' }}>{rowAmountText(r)}</Text>
        <Chip text={chip.text} tone={chip.tone} />
      </View>
    </Pressable>
  );
}

/* ---------- Add money sheet ---------- */
function AddMoneySheet({ visible, roomPaise, busy, error, onClose, onContinue }: {
  visible: boolean; roomPaise: number; busy: boolean; error: string | null; onClose: () => void; onContinue: (amountPaise: number) => void;
}) {
  const insets = useSafeAreaInsets();
  const kbH = useKeyboardHeight();
  const online = useIsOnline();
  const [text, setText] = React.useState('');
  React.useEffect(() => { if (visible) setText(''); else Keyboard.dismiss(); }, [visible]);
  const amount = parseRupeeInput(text);
  const problem = topupProblem(amount, roomPaise);
  const ready = amount != null && !problem && online && !busy;
  const hint = problem ?? (amount == null ? topupRoomLine(roomPaise) : `Adds ${rupees(amount)} to your wallet.`);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" importantForAccessibility="no-hide-descendants"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.64)' }} />
        <View accessibilityViewIsModal style={{ backgroundColor: C.sheetBg, borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.16)', paddingHorizontal: 18, paddingTop: 14, paddingBottom: 14 + insets.bottom + kbH, gap: 12 }}>
          <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center' }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
            <View style={{ flex: 1 }}>
              <Serif style={{ fontSize: 19 }}>Add money</Serif>
              <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 2 }}>Minimum Rs 500. Up to Rs 5,000 a day.</Body>
            </View>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close"
              style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)' }}>
              <Icon name="close" size={14} color={C.muted} strokeWidth={2.2} />
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 12 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {TOPUP_PICKS.map((p) => {
                const on = amount === p;
                const off = roomPaise <= 0 || p > roomPaise;
                return (
                  <Pressable key={p} onPress={() => setText(String(p / 100))} disabled={off} hitSlop={6} accessibilityRole="button" accessibilityState={{ selected: on, disabled: off }}
                    style={{ flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 12, backgroundColor: on ? hexA(C.orange, 0.18) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: on ? hexA(C.orange, 0.7) : 'rgba(255,255,255,0.1)', opacity: off ? 0.4 : 1 }}>
                    <Text style={{ fontFamily: on ? F.bodyBold : F.bodySemi, fontSize: 12.5, color: on ? C.orange : C.ink }}>{rupees(p)}</Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={{ gap: 6 }}>
              <Mono style={{ fontSize: 9, letterSpacing: 0.8, color: C.muted3 }}>AMOUNT IN RUPEES</Mono>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: problem ? hexA(C.red, 0.5) : 'rgba(255,255,255,0.12)' }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 18, color: C.muted }}>Rs</Text>
                <TextInput value={text} onChangeText={(t) => setText(t.replace(/[^\d]/g, '').slice(0, 5))} keyboardType="number-pad" placeholder="500" placeholderTextColor={C.muted3}
                  accessibilityLabel="Amount in rupees" style={{ flex: 1, fontFamily: F.bodyBold, fontSize: 22, color: '#fff', paddingVertical: 12 }} />
              </View>
              <Body style={{ fontSize: 11.5, color: problem ? '#F0A0A0' : C.muted2 }}>{hint}</Body>
            </View>
            {error ? <Body style={{ fontSize: 12, color: '#F0A0A0', lineHeight: 16 }}>{error}</Body> : null}
            {!online ? <Body style={{ fontSize: 11.5, color: C.gold }}>{OFFLINE_LINE}</Body> : null}
          </ScrollView>
          <View style={{ flexDirection: 'row', gap: 10, paddingTop: 4 }}>
            <Pressable onPress={onClose} accessibilityRole="button" style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: C.muted }}>Cancel</Text>
            </Pressable>
            <Pressable onPress={() => amount != null && onContinue(amount)} disabled={!ready} accessibilityRole="button" accessibilityLabel="Continue to pay"
              style={{ flex: 1.4, borderRadius: 12, overflow: 'hidden', opacity: ready ? 1 : 0.5 }}>
              <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ minHeight: 46, alignItems: 'center', justifyContent: 'center' }}>
                {busy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: '#fff' }}>{amount != null && !problem ? `Continue, ${rupees(amount)}` : 'Continue'}</Text>}
              </LinearGradient>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/* ---------- Detail sheet ---------- */
function DetailSheet({ row, now, onClose, onReopen, onOpenBill }: { row: WalletRow | null; now: number; onClose: () => void; onReopen: (r: WalletRow) => void; onOpenBill: (r: WalletRow) => void }) {
  const insets = useSafeAreaInsets();
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => { if (row) setCopied(false); }, [row?.id]);
  const line = (k: string, v: string | null | undefined, copy?: string) => (!v ? null : (
    <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' }}>
      <Mono style={{ width: 92, fontSize: 8.5, letterSpacing: 0.8, color: C.muted3 }}>{k}</Mono>
      <Body numberOfLines={2} style={{ flex: 1, fontSize: 13, color: C.ink }}>{v}</Body>
      {copy ? (
        <Pressable onPress={async () => { await Clipboard.setStringAsync(copy); setCopied(true); }} hitSlop={10} accessibilityRole="button" accessibilityLabel="Copy">
          <Icon name={copied ? 'checks' : 'copy'} size={14} color={copied ? C.green : C.muted} strokeWidth={2.2} />
        </Pressable>
      ) : null}
    </View>
  ));
  const chip = row ? rowChip(row, now) : null;
  const reopenable = !!row && isPendingTopup(row) && !topupExpired(row, now);
  const pendingBill = !!row && isPendingBill(row);
  return (
    <Modal visible={!!row} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" importantForAccessibility="no-hide-descendants"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.64)' }} />
        <View accessibilityViewIsModal style={{ backgroundColor: C.sheetBg, borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.16)', paddingHorizontal: 18, paddingTop: 14, paddingBottom: 16 + insets.bottom, gap: 10 }}>
          <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center' }} />
          {row ? (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                <View style={{ flex: 1 }}>
                  <Serif style={{ fontSize: 19 }}>{rowTitle(row)}</Serif>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 20, color: row.amount_paise >= 0 ? C.green : '#fff', marginTop: 4 }}>{rowAmountText(row)}</Text>
                </View>
                {chip ? <Chip text={chip.text} tone={chip.tone} /> : null}
                <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close"
                  style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)' }}>
                  <Icon name="close" size={14} color={C.muted} strokeWidth={2.2} />
                </Pressable>
              </View>
              <View>
                {line('STATUS', rowSecondLine(row, now).split(' · ').slice(1).join(' · ') || row.status)}
                {line('WHEN', fmtWhen(row.created_at))}
                {line('PAID AT', row.paid_at ? fmtWhen(row.paid_at) : null)}
                {line('BALANCE AFTER', row.balance_after_paise == null ? null : rupees(row.balance_after_paise))}
                {line('PAYMENT ID', row.razorpay?.payment_id ?? null, row.razorpay?.payment_id ?? undefined)}
                {line('ORDER ID', row.razorpay?.order_id ?? null)}
                {line('REFUND ID', row.razorpay?.refund_id ?? null)}
                {line('METHOD', methodLabel(row.razorpay?.method))}
                {line('CLIENT', row.kind === 'ai_plan' ? row.meta?.client_name ?? null : null)}
                {line('NOTE', row.kind === 'adjustment' || row.kind === 'reversal' || row.kind === 'refund' ? row.meta?.note ?? null : null)}
              </View>
              {reopenable ? (
                <Pressable onPress={() => onReopen(row)} accessibilityRole="button" accessibilityLabel="Open the checkout again" style={{ borderRadius: 12, overflow: 'hidden' }}>
                  <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ minHeight: 46, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: '#fff' }}>Pay {rupees(row.amount_paise)} now</Text>
                  </LinearGradient>
                </Pressable>
              ) : null}
              {pendingBill ? (
                <View style={{ gap: 8 }}>
                  <Body style={{ fontSize: 11.5, color: C.muted2, lineHeight: 16 }}>Deduct or discard this bill from Create Plan, where the draft opens. It lapses after 24 hours, uncharged.</Body>
                  <Pressable onPress={() => onOpenBill(row)} accessibilityRole="button" accessibilityLabel="Open in Create Plan" style={{ borderRadius: 12, overflow: 'hidden' }}>
                    <LinearGradient colors={['#8B5CF6', '#6D28D9']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ minHeight: 46, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: '#fff' }}>Open in Create Plan</Text>
                    </LinearGradient>
                  </Pressable>
                </View>
              ) : null}
            </>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

/* ================= SCREEN ================= */
export function Wallet() {
  const { session } = useAuth();
  const { go, set } = useStore();
  const uid = session?.user?.id ?? null;
  const online = useIsOnline();
  const q = useTeamWallet(!!uid);
  const createM = useCreateTopup();
  const verifyM = useVerifyTopup();
  const [addOpen, setAddOpen] = React.useState(false);
  const [addErr, setAddErr] = React.useState<string | null>(null);
  const [checkout, setCheckout] = React.useState<TopupOrder | null>(null);
  const failedRef = React.useRef<string | null>(null);
  const announcedRef = React.useRef(new Set<string>());
  const [detail, setDetail] = React.useState<WalletRow | null>(null);
  const [before, setBefore] = React.useState<string | null>(null);
  const [extra, setExtra] = React.useState<WalletRow[]>([]);
  const pageQ = useTeamWalletPage(before);
  const [now, setNow] = React.useState(Date.now());
  const [updatedAt, setUpdatedAt] = React.useState<number | null>(null);
  React.useEffect(() => { if (q.dataUpdatedAt) setUpdatedAt(q.dataUpdatedAt); }, [q.dataUpdatedAt]);
  React.useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  React.useEffect(() => { if (pageQ.data) setExtra((e) => [...e, ...pageQ.data!.filter((r) => !e.some((x) => x.id === r.id))]); }, [pageQ.data]);

  const data = q.data;
  const rows = React.useMemo(() => {
    const base = data?.rows ?? [];
    const ids = new Set(base.map((r) => r.id));
    return [...base, ...extra.filter((r) => !ids.has(r.id))];
  }, [data?.rows, extra]);
  const hasPending = rows.some((r) => (isPendingTopup(r) && !topupExpired(r, now)) || isPendingBill(r));

  const announce = (row: WalletRow) => {
    if (announcedRef.current.has(row.id)) return;
    announcedRef.current.add(row.id);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    Alert.alert(`${rupees(row.amount_paise)} added`, `Balance ${rupees(row.balance_after_paise ?? 0)}.`);
  };
  useWalletRealtime(uid, hasPending || !!checkout, announce);

  const openCheckout = (r: { amount_inr: number } | { reopen_tx_id: string }) => {
    setAddErr(null);
    createM.mutate(r, {
      onSuccess: (o) => {
        setAddOpen(false); setDetail(null); failedRef.current = null;
        setCheckout(o);
        trackEvent('Wallet Checkout Opened', { amount_paise: o.amount_paise, reopened: 'reopen_tx_id' in r });
      },
      onError: (e) => {
        const text = walletErrorText(e, 'Could not start the payment. Try again.');
        if (addOpen) setAddErr(text); else Alert.alert("Couldn't open the checkout", text);
      },
    });
  };

  const onCheckoutMessage = (m: CheckoutMessage) => {
    if (!checkout) return;
    if ('ok' in m && m.ok) {
      const c = checkout;
      setCheckout(null);
      verifyM.mutate({ tx_id: c.tx_id, razorpay_order_id: m.razorpay_order_id, razorpay_payment_id: m.razorpay_payment_id, razorpay_signature: m.razorpay_signature }, {
        onSuccess: (r) => { trackEvent('Wallet Topup Paid', { amount_paise: c.amount_paise }); if (r.row) announce({ ...r.row, balance_after_paise: r.row.balance_after_paise ?? r.balance_paise }); else Alert.alert(`${rupees(c.amount_paise)} added`, `Balance ${rupees(r.balance_paise)}.`); },
        onError: (e) => Alert.alert('Payment check', walletErrorText(e, 'The payment could not be confirmed yet. If money left your account it is added within a few minutes.')),
      });
      return;
    }
    if ('failed' in m && m.failed) { failedRef.current = String(m.reason ?? 'The payment did not go through'); return; }
    if ('dismissed' in m) {
      setCheckout(null);
      q.refetch();
      if ((m as any).paid) Alert.alert('Already added', 'This top-up is already in your wallet.');
      else if ((m as any).expired) Alert.alert('Checkout expired', 'Tap Add money to start again.');
      else if (failedRef.current) Alert.alert('Payment failed', `${failedRef.current}. Nothing was charged. Tap the waiting row to try again.`);
      failedRef.current = null;
    }
  };

  const openBill = (r: WalletRow) => {
    const clientId = r.meta?.client_id ? String(r.meta.client_id) : null;
    if (!clientId) { Alert.alert('Open Create Plan', 'Open the client and tap Create Plan: the waiting bill shows there.'); return; }
    setDetail(null);
    set({ selectedClientId: clientId, selectedClientName: String(r.meta?.client_name ?? 'Client'), editingPlan: null });
    go('create-plan');
  };

  if (!session) return <AccessPending />;
  const groups = groupByMonth(rows);
  const notSetUp = q.isError && /not set up/i.test(String((q.error as Error)?.message ?? ''));
  const negative = !!data && (data.negative || data.balance_paise < 0);

  return (
    <Page gap={16} pt={6}>
      <TitleBlock title="Wallet" sub="Add money, see your history" />

      <Card colors={['rgba(60,38,24,0.5)', 'rgba(18,14,14,0.55)']} radius={20} style={{ padding: 18, gap: 6 }}>
        <Mono style={{ fontSize: 9, letterSpacing: 1.2, color: C.muted3 }}>BALANCE</Mono>
        {q.isPending ? <ActivityIndicator color={C.orange} style={{ alignSelf: 'flex-start', marginVertical: 8 }} /> : (
          <Serif style={{ fontSize: 38, color: negative ? C.red : '#fff' }}>{balanceText(data?.balance_paise ?? 0)}</Serif>
        )}
        {/* Below zero (3 Nov 2026): an AI plan took the wallet negative; the next top-up clears it first. */}
        {negative ? <Body style={{ fontSize: 12, color: '#FF9B8F', lineHeight: 16 }}>{data?.negative_line ?? negativeBalanceLine(data?.balance_paise ?? 0)}</Body> : null}
        <Body style={{ fontSize: 11.5, color: C.muted2 }}>
          {!online ? 'Offline, last known balance' : updatedAt ? `Updated ${fmtWhen(new Date(updatedAt).toISOString())}` : notSetUp ? 'The wallet is not set up on the server yet.' : q.isError ? walletErrorText(q.error, 'Could not load the wallet. Pull to refresh.') : ''}
        </Body>
        {data?.charges_ai && !negative ? <Body style={{ fontSize: 11, color: C.muted3, marginTop: 2 }}>{data.free_left > 0 ? `${freeLeftLine(data.free_left)}. After that an Odds AI plan costs ${rupees(data.ai_plan_price_paise)}, deducted here when you create the plan. Generating is free.` : `An Odds AI plan costs ${rupees(data.ai_plan_price_paise)}, deducted here when you create the plan. Generating is free. Essentials clients stay free.`}</Body> : null}
      </Card>

      <Pressable onPress={() => { setAddErr(null); setAddOpen(true); }} disabled={!online || notSetUp} accessibilityRole="button" accessibilityLabel={negative ? 'Add funds' : 'Add money'} style={{ borderRadius: 13, overflow: 'hidden', opacity: online && !notSetUp ? 1 : 0.5 }}>
        <LinearGradient colors={negative ? [C.red, '#B2402E'] : ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 13 }}>
          <Icon name="plus" size={15} color="#fff" strokeWidth={2.6} />
          <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: '#fff' }}>{negative ? 'Add funds' : 'Add money'}</Text>
        </LinearGradient>
      </Pressable>
      {!online ? <Body style={{ fontSize: 11.5, color: C.gold, marginTop: -8 }}>{OFFLINE_LINE}</Body> : null}
      {verifyM.isPending ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 11, borderRadius: 12, backgroundColor: hexA(C.green, 0.08), borderWidth: 1, borderColor: hexA(C.green, 0.3) }}>
          <ActivityIndicator size="small" color={C.green} />
          <Body style={{ fontSize: 12, color: C.ink }}>Confirming the payment with Razorpay</Body>
        </View>
      ) : null}

      <View style={{ gap: 10 }}>
        <Mono style={{ fontSize: 9, letterSpacing: 1.2, color: C.muted3 }}>HISTORY</Mono>
        {q.isPending ? <ActivityIndicator color={C.orange} style={{ marginVertical: 20 }} /> : !rows.length ? (
          <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 24 }}>{q.isError ? 'Could not load the history. Pull to refresh.' : 'No movements yet. Add money to start.'}</Body>
        ) : groups.map((g) => (
          <View key={g.header} style={{ gap: 8 }}>
            <Mono style={{ fontSize: 8.5, letterSpacing: 1, color: C.mono, marginTop: 4 }}>{g.header}</Mono>
            {g.rows.map((r) => <RowCard key={r.id} r={r} now={now} onPress={() => setDetail(r)} />)}
          </View>
        ))}
        {rows.length >= 50 && (!pageQ.data || pageQ.data.length === 50) ? (
          <Pressable onPress={() => setBefore(rows[rows.length - 1]?.created_at ?? null)} disabled={pageQ.isFetching} hitSlop={8} accessibilityRole="button"
            style={{ alignSelf: 'center', paddingVertical: 9, paddingHorizontal: 16, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
            {pageQ.isFetching ? <ActivityIndicator size="small" color={C.muted} /> : <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: C.muted }}>Load older</Text>}
          </Pressable>
        ) : rows.length ? <Mono style={{ fontSize: 8.5, color: C.faint, textAlign: 'center', marginTop: 6 }}>THAT IS EVERYTHING</Mono> : null}
      </View>

      {/* One Modal at a time: the sheets are siblings and only one is ever open. */}
      {/* No wallet read yet (loading, offline cache empty, migration not run): the sheet assumes the full day's room and
          lets the server decide; a room of 0 here used to lock Continue before the first read landed. */}
      <AddMoneySheet visible={addOpen && !checkout} roomPaise={data?.today_room_paise ?? DAILY_CAP_PAISE} busy={createM.isPending} error={addErr}
        onClose={() => setAddOpen(false)} onContinue={(p) => openCheckout({ amount_inr: Math.round(p / 100) })} />
      <DetailSheet row={!addOpen && !checkout ? detail : null} now={now} onClose={() => setDetail(null)}
        onReopen={(r) => openCheckout({ reopen_tx_id: r.id })} onOpenBill={openBill} />
      <WalletCheckout visible={!!checkout} order={checkout}
        onMessage={onCheckoutMessage} onClose={() => onCheckoutMessage({ dismissed: true })} />
    </Page>
  );
}
