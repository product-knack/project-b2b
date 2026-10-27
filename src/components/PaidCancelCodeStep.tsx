/* Paid cancellation code step (22 Oct 2026). Owner: "CRM sees the paid cancellation code on Session Logs; a
   trainer, doctor or therapist marking a paid cancellation must enter it; show who to ask with the client's
   latest active CRM's name and number". Rendered inside the cancel flow's picker modal in place of the old
   "Paid Cancellation?" confirm, for the trainer roster (trainer.tsx) and the shared doctor / therapist flow
   (cancelSessionFlow.tsx). Backend: hub-track migration 20261022180000 (verify_paid_cancellation_code,
   get_client_crm_contact, the gate on session_schedule). The code itself never reaches the app.
   A member without Session code on keeps the old confirm (no code exists for them). */
import React from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator, Linking } from 'react-native';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono } from './primitives';
import { useClientsOtpFlags, useClientCrmContact, useVerifyPaidCancellationCode } from '../lib/sessionOtpQueries';
import { otpDigits, askCrmLine, paidCancelReasonText, PAID_CANCEL_INTRO, PAID_CANCEL_NOTICE } from '../lib/sessionOtp';
import { friendlyError } from '../lib/friendlyError';

export function PaidCancelCodeStep({ clientId, scheduleId, clientName, onBack, onContinue }: {
  clientId: string | null | undefined;
  scheduleId: string;
  clientName: string;
  onBack: () => void;
  /** Called once the code is verified (or at once for a member without Session code on). */
  onContinue: () => void;
}) {
  const flagsQ = useClientsOtpFlags([clientId]);
  const flag = clientId ? flagsQ.data?.[clientId] : false;
  const contactQ = useClientCrmContact(flag === true ? clientId ?? null : null);
  const verifyM = useVerifyPaidCancellationCode();
  const [code, setCode] = React.useState('');
  const [err, setErr] = React.useState<string | null>(null);
  const inputRef = React.useRef<React.ComponentRef<typeof TextInput>>(null);

  const submit = async () => {
    if (code.length !== 4 || verifyM.isPending) return;
    setErr(null);
    try {
      const a = await verifyM.mutateAsync({ scheduleId, code });
      if (a.ok) onContinue();
      else { setErr(paidCancelReasonText(a.reason)); setCode(''); }
    } catch (e: any) {
      setErr(friendlyError(e, 'The code could not be verified. Check your connection and retry.'));
    }
  };

  if (!clientId || (flagsQ.isLoading && flag === undefined)) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 }}>
        <ActivityIndicator size="small" color={C.gold} />
        <Body style={{ fontSize: 12, color: C.muted2 }}>Checking the member's settings…</Body>
      </View>
    );
  }

  if (flag !== true) {
    // The old double confirm: no paid cancellation code exists for this member.
    return (
      <>
        <Serif style={{ fontSize: 19 }}>Paid Cancellation?</Serif>
        <Body style={{ fontSize: 12.5, color: C.muted2, lineHeight: 18 }}>This marks the session as a last-moment paid cancellation and raises a claim that goes to admin for approval. Continue?</Body>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Pressable onPress={onBack} hitSlop={10} style={{ flex: 1, alignItems: 'center', paddingVertical: 13, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
            <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: C.ink }}>Back</Text>
          </Pressable>
          <Pressable onPress={onContinue} hitSlop={10} style={{ flex: 1, alignItems: 'center', paddingVertical: 13, borderRadius: 13, backgroundColor: hexA(C.gold, 0.16), borderWidth: 1, borderColor: hexA(C.gold, 0.45) }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: C.gold }}>Yes, continue</Text>
          </Pressable>
        </View>
      </>
    );
  }

  const contact = contactQ.data ?? null;
  const phone = contact?.phone ?? null;
  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
        <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: hexA(C.gold, 0.13), alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="lock" size={15} color={C.gold} strokeWidth={2.2} />
        </View>
        <Serif style={{ flex: 1, fontSize: 19 }}>Paid cancellation code</Serif>
      </View>
      <Body style={{ fontSize: 12.5, color: C.muted2, lineHeight: 18 }}>{PAID_CANCEL_INTRO(clientName)}</Body>
      <View style={{ padding: 12, borderRadius: 14, backgroundColor: hexA(C.gold, 0.07), borderWidth: 1, borderColor: hexA(C.gold, 0.25), gap: 4 }}>
        <Mono style={{ fontSize: 8.5, letterSpacing: 0.8, color: C.gold }}>ASK CRM</Mono>
        {contactQ.isLoading ? (
          <ActivityIndicator size="small" color={C.gold} style={{ alignSelf: 'flex-start' }} />
        ) : (
          <Body style={{ fontSize: 13, fontFamily: F.bodySemi, color: '#fff' }}>{askCrmLine(contact)}</Body>
        )}
        {phone ? (
          <Pressable onPress={() => Linking.openURL(`tel:${phone}`).catch(() => {})} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Call ${contact?.name ?? 'the CRM'}`}
            style={{ alignSelf: 'flex-start', marginTop: 4, flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 11, borderRadius: 999, backgroundColor: hexA(C.gold, 0.14), borderWidth: 1, borderColor: hexA(C.gold, 0.4) }}>
            <Icon name="phone" size={12} color={C.gold} strokeWidth={2.2} />
            <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: C.gold }}>Call {phone}</Text>
          </Pressable>
        ) : null}
      </View>
      <Body style={{ fontSize: 11, color: C.muted3, lineHeight: 15 }}>{PAID_CANCEL_NOTICE}</Body>
      <Pressable onPress={() => inputRef.current?.focus()} style={{ flexDirection: 'row', justifyContent: 'center', gap: 10 }} accessibilityLabel="Paid cancellation code, 4 digits">
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={{ width: 52, height: 58, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.3)', borderWidth: 1.5, borderColor: code.length === i ? C.gold : code[i] ? hexA(C.gold, 0.5) : 'rgba(255,255,255,0.14)' }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 24, color: '#fff' }}>{code[i] ?? ''}</Text>
          </View>
        ))}
      </Pressable>
      <TextInput ref={inputRef} value={code} onChangeText={(t) => { setCode(otpDigits(t)); setErr(null); }} keyboardType="number-pad" maxLength={4} autoFocus
        onSubmitEditing={submit} style={{ position: 'absolute', opacity: 0, height: 1, width: 1 }} />
      {err ? <Body style={{ fontSize: 11.5, color: C.red }}>{err}</Body> : null}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Pressable onPress={onBack} disabled={verifyM.isPending} hitSlop={10} style={{ flex: 1, alignItems: 'center', paddingVertical: 13, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
          <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: C.ink }}>Back</Text>
        </Pressable>
        <Pressable onPress={submit} disabled={code.length !== 4 || verifyM.isPending} hitSlop={10} style={{ flex: 1.2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 13, borderRadius: 13, backgroundColor: hexA(C.gold, 0.16), borderWidth: 1, borderColor: hexA(C.gold, 0.45), opacity: code.length !== 4 ? 0.5 : 1 }}>
          {verifyM.isPending ? <ActivityIndicator size="small" color={C.gold} /> : null}
          <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: C.gold }}>{verifyM.isPending ? 'Checking…' : 'Verify and continue'}</Text>
        </Pressable>
      </View>
    </>
  );
}
