/* QHP cancellation requests, the shared pieces (26 Oct 2026):
   - CancelChipView: the status chip of a QHP row (pending / paid cancellation / unpaid / not approved).
   - QhpCancelRow: one card in the assessor's Cancellations tab and the QHP Manager's lists.
   - RequestCancellationSheet: the assessor asks (reason + paid / unpaid claim).
   - WithdrawButton: the assessor takes a pending request back.
   - DecideCancellationSheet: the QHP Manager approves (final paid / unpaid) or declines (note required).
   Sheet rules: keyboard padding, a sibling backdrop, keyboardShouldPersistTaps, hitSlop 10, never a sibling
   modal. Rules in src/lib/qhpCancellation.ts, network in src/lib/qhpCancellationQueries.ts. */
import React from 'react';
import { View, Text, Pressable, Modal, ScrollView, TextInput, ActivityIndicator, Alert } from 'react-native';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Body, Mono } from './primitives';
import { useKeyboardHeight } from '../lib/useKeyboardHeight';
import {
  CancelView, Payment, cancelChip, cancelDetail, istDay,
  REQUEST_TITLE, REQUEST_LINE, REQUEST_CHARGE, REQUEST_HINT, WITHDRAW, APPROVE_TITLE, APPROVE_CHARGE, APPROVE_BUTTON, DECLINE_TITLE, DECLINE_LINE, REASON_MAX,
} from '../lib/qhpCancellation';
import { useRequestQhpCancellation, useWithdrawQhpCancellation, useDecideQhpCancellation } from '../lib/qhpCancellationQueries';

const toneColor = (tone: 'amber' | 'green' | 'grey' | 'red') => (tone === 'amber' ? C.gold : tone === 'green' ? C.green : tone === 'red' ? C.red : C.muted);

export function CancelChipView({ view }: { view: CancelView }) {
  const chip = cancelChip(view);
  if (!chip) return null;
  const col = toneColor(chip.tone);
  return (
    <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4, paddingHorizontal: 9, borderRadius: 999, backgroundColor: hexA(col, 0.14), borderWidth: 1, borderColor: hexA(col, 0.5) }}>
      <Icon name={chip.tone === 'green' ? 'checks' : chip.tone === 'amber' ? 'clock' : 'alert'} size={10} color={col} strokeWidth={2.4} />
      <Text style={{ fontFamily: F.bodyBold, fontSize: 10.5, color: col }}>{chip.text}</Text>
    </View>
  );
}

/** The slot line of a QHP: "28 Oct · 10:00 AM". */
export const slotLine = (date: string | null | undefined, time: string | null | undefined): string => {
  const t = time ? new Date(`2000-01-01T${String(time).slice(0, 8)}`).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }) : '';
  return [istDay(date ?? null), t].filter(Boolean).join(' · ');
};

export function QhpCancelRow({ title, subtitle, view, forAssessor, children }: { title: string; subtitle: string; view: CancelView; forAssessor: boolean; children?: React.ReactNode }) {
  const chip = cancelChip(view);
  const col = chip ? toneColor(chip.tone) : C.muted;
  return (
    <View style={{ padding: 12, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: hexA(col, 0.22), borderLeftWidth: 3, borderLeftColor: col, gap: 7 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Body numberOfLines={1} style={{ flex: 1, fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }}>{title}</Body>
        <CancelChipView view={view} />
      </View>
      <Body style={{ fontSize: 11.5, color: C.muted2 }}>{subtitle}</Body>
      <Body style={{ fontSize: 11.5, color: C.ink3, lineHeight: 16 }}>{cancelDetail(view, forAssessor)}</Body>
      {children}
    </View>
  );
}

/* ---------- a centred sheet with keyboard room ---------- */
function CentreSheet({ visible, onClose, accent, children }: { visible: boolean; onClose: () => void; accent: string; children: React.ReactNode }) {
  const kb = useKeyboardHeight();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'center', padding: 22, paddingBottom: 22 + kb }}>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.65)' }} />
        <View style={{ maxHeight: '100%', borderRadius: 18, backgroundColor: '#141010', borderWidth: 1, borderColor: hexA(accent, 0.3), padding: 18 }}>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12 }}>{children}</ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function PaymentChips({ value, onChange, disabled }: { value: Payment | null; onChange: (p: Payment) => void; disabled?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {(([['paid', 'Paid cancellation', C.green], ['unpaid', 'Unpaid', C.muted]] as const)).map(([p, label, col]) => {
        const on = value === p;
        return (
          <Pressable key={p} onPress={() => onChange(p)} disabled={disabled} hitSlop={6} accessibilityRole="radio" accessibilityState={{ selected: on }}
            style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 12, backgroundColor: on ? hexA(col, 0.18) : 'rgba(255,255,255,0.04)', borderWidth: 1.5, borderColor: on ? hexA(col, 0.7) : 'rgba(255,255,255,0.12)' }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: on ? col : C.muted }}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const inputStyle = (ok: boolean, accent: string) => ({ minHeight: 64, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: ok ? hexA(accent, 0.35) : 'rgba(255,255,255,0.1)', padding: 12, color: '#fff', fontFamily: F.body, fontSize: 13, textAlignVertical: 'top' as const });

/* ---------- the assessor asks ---------- */
export type RequestTarget = { id: string; clientName: string | null; slot: string } | null;

export function RequestCancellationSheet({ target, onClose }: { target: RequestTarget; onClose: () => void }) {
  const [reason, setReason] = React.useState('');
  const [payment, setPayment] = React.useState<Payment | null>(null);
  const m = useRequestQhpCancellation();
  React.useEffect(() => { if (target) { setReason(''); setPayment(null); m.reset(); } }, [target?.id]);
  const ready = reason.trim().length > 0 && payment != null && !m.isPending;
  const send = () => {
    if (!target || !ready || !payment) return;
    m.mutate({ assessmentId: target.id, clientName: target.clientName, reason, payment }, { onSuccess: () => { onClose(); Alert.alert('Request sent', 'The QHP Manager will decide. The QHP stays scheduled until then.'); } });
  };
  return (
    <CentreSheet visible={!!target} onClose={onClose} accent={C.red}>
      <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: '#fff' }}>{REQUEST_TITLE}</Text>
      <Body style={{ fontSize: 12, color: C.muted2 }}>{target?.clientName ?? 'Client'}{target?.slot ? ` · ${target.slot}` : ''}. {REQUEST_LINE}</Body>
      <Mono style={{ fontSize: 9.5, letterSpacing: 1.2, color: C.mono2 }}>REASON (REQUIRED)</Mono>
      <TextInput value={reason} onChangeText={(t) => setReason(t.slice(0, REASON_MAX))} placeholder="Why does this QHP need to be cancelled?" placeholderTextColor={C.muted3} multiline style={inputStyle(reason.trim().length > 0, C.red)} />
      <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: '#fff' }}>{REQUEST_CHARGE}</Text>
      <PaymentChips value={payment} onChange={setPayment} disabled={m.isPending} />
      <Body style={{ fontSize: 10.5, color: C.muted3 }}>{REQUEST_HINT}</Body>
      {m.isError ? <Body style={{ fontSize: 11.5, color: C.red }}>{(m.error as Error).message}</Body> : null}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Pressable onPress={onClose} hitSlop={10} style={{ flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}><Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: C.muted }}>Back</Text></Pressable>
        <Pressable onPress={send} disabled={!ready} hitSlop={10} style={{ flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 12, backgroundColor: hexA(C.red, ready ? 0.16 : 0.06), borderWidth: 1, borderColor: hexA(C.red, ready ? 0.45 : 0.2) }}>
          {m.isPending ? <ActivityIndicator size="small" color={C.red} /> : <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: ready ? C.red : C.muted3 }}>Send request</Text>}
        </Pressable>
      </View>
    </CentreSheet>
  );
}

/* ---------- the assessor withdraws ---------- */
export function WithdrawButton({ assessmentId }: { assessmentId: string }) {
  const m = useWithdrawQhpCancellation();
  const ask = () => Alert.alert('Withdraw the request?', 'The QHP stays scheduled and the QHP Manager will not see this request.', [
    { text: 'Keep it', style: 'cancel' },
    { text: 'Withdraw', style: 'destructive', onPress: () => m.mutate(assessmentId, { onError: (e: any) => Alert.alert('Could not withdraw', e?.message ?? 'Try again.') }) },
  ]);
  return (
    <Pressable onPress={ask} disabled={m.isPending} hitSlop={10} accessibilityRole="button" style={{ alignSelf: 'flex-start', paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', opacity: m.isPending ? 0.6 : 1 }}>
      <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: C.ink3 }}>{m.isPending ? 'Withdrawing…' : WITHDRAW}</Text>
    </Pressable>
  );
}

/* ---------- the QHP Manager decides ---------- */
export type DecideTarget = { id: string; clientName: string | null; slot: string; claim: Payment; mode: 'approve' | 'decline' } | null;

export function DecideCancellationSheet({ target, onClose }: { target: DecideTarget; onClose: () => void }) {
  const [payment, setPayment] = React.useState<Payment>('paid');
  const [note, setNote] = React.useState('');
  const m = useDecideQhpCancellation();
  React.useEffect(() => { if (target) { setPayment(target.claim); setNote(''); m.reset(); } }, [target?.id, target?.mode]);
  const approve = target?.mode === 'approve';
  const accent = approve ? C.red : C.gold;
  const ready = !!target && !m.isPending && (approve || note.trim().length > 0);
  const send = () => {
    if (!target || !ready) return;
    m.mutate({ assessmentId: target.id, clientName: target.clientName, approve: !!approve, payment: approve ? payment : null, note }, {
      onSuccess: () => { onClose(); Alert.alert(approve ? 'QHP cancelled' : 'Request declined', approve ? `${target.clientName ?? 'The client'}'s QHP is cancelled as ${payment}.` : 'The assessor has been told. The QHP stays scheduled.'); },
    });
  };
  return (
    <CentreSheet visible={!!target} onClose={onClose} accent={accent}>
      <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: '#fff' }}>{approve ? APPROVE_TITLE : DECLINE_TITLE}</Text>
      <Body style={{ fontSize: 12, color: C.muted2 }}>{approve ? `The QHP is cancelled for ${target?.clientName ?? 'the client'}${target?.slot ? ` on ${target.slot}` : ''}.` : DECLINE_LINE}</Body>
      {approve ? (
        <>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: '#fff' }}>{APPROVE_CHARGE}</Text>
          <PaymentChips value={payment} onChange={setPayment} disabled={m.isPending} />
          {target && payment !== target.claim ? <Body style={{ fontSize: 11, color: C.gold }}>The assessor asked for {target.claim}.</Body> : <Body style={{ fontSize: 10.5, color: C.muted3 }}>Prefilled with the assessor's claim.</Body>}
        </>
      ) : null}
      <Mono style={{ fontSize: 9.5, letterSpacing: 1.2, color: C.mono2 }}>{approve ? 'NOTE (OPTIONAL)' : 'NOTE (REQUIRED)'}</Mono>
      <TextInput value={note} onChangeText={(t) => setNote(t.slice(0, REASON_MAX))} placeholder={approve ? 'Anything the assessor should know' : 'Why the request is declined'} placeholderTextColor={C.muted3} multiline style={inputStyle(note.trim().length > 0, accent)} />
      {m.isError ? <Body style={{ fontSize: 11.5, color: C.red }}>{(m.error as Error).message}</Body> : null}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Pressable onPress={onClose} hitSlop={10} style={{ flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}><Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: C.muted }}>Back</Text></Pressable>
        <Pressable onPress={send} disabled={!ready} hitSlop={10} style={{ flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 12, backgroundColor: hexA(accent, ready ? 0.16 : 0.06), borderWidth: 1, borderColor: hexA(accent, ready ? 0.45 : 0.2) }}>
          {m.isPending ? <ActivityIndicator size="small" color={accent} /> : <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: ready ? accent : C.muted3 }}>{approve ? APPROVE_BUTTON : 'Decline'}</Text>}
        </Pressable>
      </View>
    </CentreSheet>
  );
}

export { slotLine as qhpSlotLine };
