import React from 'react';
import { View, Text, Pressable, TextInput, Modal, ScrollView, ActivityIndicator, Alert, Keyboard } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Body, Mono, Serif } from './primitives';
import { useAuth } from '../auth';
import { useKeyboardHeight } from '../lib/useKeyboardHeight';
import { friendlyError } from '../lib/friendlyError';
import {
  SESSION_CODE_OFF, MIN_REASON, STATUS_WORD, codedSentence, fmtWhen, lineRequest, reasonProblem, sessionCodeStatusLine, type Tone,
} from '../lib/approvalRequests';
import {
  useClientApprovalRequests, useCreateApprovalRequest, useTurnSessionCodeOn, useWithdrawApprovalRequest,
} from '../lib/approvalRequestQueries';

/* CRM client page: the Session code switch (2 Nov 2026, approval requests). Turning it ON is direct; turning it
   OFF asks for a reason and sends a request to the doctors' manager, and it goes off only when approved (the
   database refuses a direct "off" with OTP_OFF_NEEDS_APPROVAL). An admin's request is approved at once.
   Web twin: hub-track src/components/approvals/SessionCodeOffRequest.tsx. */

const TONE: Record<Tone, string> = { amber: C.gold, green: C.green, red: C.red, muted: C.muted2 };

export function SessionCodeRow({ clientId, clientName, otpOn }: { clientId: string; clientName: string; otpOn: boolean }) {
  const { dbRole } = useAuth();
  const isAdmin = dbRole === 'admin' || dbRole === 'super_admin';
  const reqQ = useClientApprovalRequests(clientId, SESSION_CODE_OFF, 5);
  const onM = useTurnSessionCodeOn();
  const withdrawM = useWithdrawApprovalRequest();
  const [sheet, setSheet] = React.useState(false);
  const [history, setHistory] = React.useState(false);
  const requests = reqQ.data ?? [];
  const pending = requests.find((r) => r.status === 'pending') ?? null;
  const line = sessionCodeStatusLine(lineRequest(requests, otpOn));
  const busy = onM.isPending || withdrawM.isPending;

  const press = () => {
    if (busy) return;
    if (!otpOn) {
      Alert.alert('Turn on the Session code?', `Every scheduled session of ${clientName} will need the member's 4-digit code before the trainer can log it.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Turn on', onPress: () => onM.mutate({ clientId }, { onError: (e) => Alert.alert("Couldn't turn it on", (codedSentence(e) ?? friendlyError(e, 'Try again.'))) }) },
      ]);
      return;
    }
    if (pending) {
      Alert.alert('Request already sent', "The off request is waiting for the doctors' manager. You can withdraw it below.");
      return;
    }
    setSheet(true);
  };
  const withdraw = () => {
    if (!pending) return;
    Alert.alert('Withdraw the request?', 'The Session code stays on and the request is closed.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Withdraw', style: 'destructive', onPress: () => withdrawM.mutate({ id: pending.id, clientId }, { onError: (e) => Alert.alert("Couldn't withdraw", (codedSentence(e) ?? friendlyError(e, 'Try again.'))) }) },
    ]);
  };

  return (
    <View style={{ gap: 6 }}>
      <Pressable onPress={press} disabled={busy} accessibilityRole="switch" accessibilityState={{ checked: otpOn }} accessibilityLabel="Session code" hitSlop={10}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 11, borderRadius: 12, backgroundColor: otpOn ? hexA(C.green, 0.1) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: otpOn ? hexA(C.green, 0.4) : 'rgba(255,255,255,0.09)', opacity: busy ? 0.6 : 1 }}>
        <View style={{ width: 38, height: 22, borderRadius: 11, padding: 3, backgroundColor: otpOn ? hexA(C.green, 0.35) : 'rgba(255,255,255,0.1)', alignItems: otpOn ? 'flex-end' : 'flex-start' }}>
          <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: otpOn ? C.green : C.muted2 }} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: otpOn ? C.green : C.muted }}>{otpOn ? 'Session code on' : 'Session code off'}</Text>
          <Mono style={{ fontSize: 7.5, letterSpacing: 0.5, color: C.muted3, marginTop: 2 }}>
            {otpOn ? (pending ? 'OFF REQUEST WAITING FOR APPROVAL' : "TURNING OFF NEEDS THE DOCTORS' MANAGER") : 'TAP TO TURN ON'}
          </Mono>
        </View>
        {busy ? <ActivityIndicator size="small" color={C.green} /> : <Icon name="shield" size={14} color={otpOn ? C.green : C.muted3} strokeWidth={2.2} />}
      </Pressable>

      {line ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 11, borderRadius: 11, backgroundColor: hexA(TONE[line.tone], 0.09), borderWidth: 1, borderColor: hexA(TONE[line.tone], 0.35) }}>
          <Body style={{ flex: 1, fontSize: 11.5, lineHeight: 16, color: TONE[line.tone] }}>{line.text}</Body>
          {pending ? (
            <Pressable onPress={withdraw} hitSlop={10} accessibilityRole="button" accessibilityLabel="Withdraw the request"
              style={{ paddingVertical: 5, paddingHorizontal: 9, borderRadius: 9, borderWidth: 1, borderColor: hexA(C.gold, 0.45) }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: C.gold }}>Withdraw</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {requests.length > 0 ? (
        <Pressable onPress={() => setHistory((h) => !h)} hitSlop={10} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 2 }}>
          <Icon name={history ? 'chevUp' : 'chevDown'} size={11} color={C.muted2} strokeWidth={2.3} />
          <Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: C.muted2 }}>Session code requests ({requests.length})</Text>
        </Pressable>
      ) : null}
      {history ? (
        <View style={{ gap: 6 }}>
          {requests.map((r) => (
            <View key={r.id} style={{ padding: 10, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', gap: 3 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                <Text style={{ fontFamily: F.bodySemi, fontSize: 11.5, color: '#fff' }}>{STATUS_WORD[r.status]}{r.auto_approved ? ' (admin)' : ''}</Text>
                <Mono style={{ fontSize: 8.5, color: C.muted3 }}>{fmtWhen(r.requested_at).toUpperCase()}</Mono>
              </View>
              <Body style={{ fontSize: 11, color: C.muted2 }}>Asked by {r.requested_by_name || 'staff'}: {r.reason}</Body>
              {r.reviewed_at && r.status !== 'pending' ? (
                <Body style={{ fontSize: 11, color: C.muted3 }}>{r.reviewed_by_name ? `${r.reviewed_by_name}, ` : ''}{fmtWhen(r.reviewed_at)}{r.review_note ? `: ${r.review_note}` : ''}</Body>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

      <SessionCodeOffSheet visible={sheet} onClose={() => setSheet(false)} clientId={clientId} clientName={clientName} isAdmin={isAdmin} />
    </View>
  );
}

export function SessionCodeOffSheet({ visible, onClose, clientId, clientName, isAdmin }: { visible: boolean; onClose: () => void; clientId: string; clientName: string; isAdmin: boolean }) {
  const insets = useSafeAreaInsets();
  const kbH = useKeyboardHeight();
  const createM = useCreateApprovalRequest();
  const [reason, setReason] = React.useState('');
  React.useEffect(() => { if (visible) { setReason(''); createM.reset(); } }, [visible]);
  const problem = reasonProblem(reason);
  const send = () => {
    if (problem || createM.isPending) return;
    Keyboard.dismiss();
    createM.mutate({ type: SESSION_CODE_OFF, clientId, reason: reason.trim() }, {
      onSuccess: (r) => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        onClose();
        Alert.alert(r.status === 'approved' ? 'Session code turned off' : 'Request sent',
          r.status === 'approved' ? `The Session code is off for ${clientName}.` : `The doctors' manager will approve or reject it. The Session code stays on for ${clientName} until then.`);
      },
      onError: (e) => Alert.alert("Couldn't send the request", (codedSentence(e) ?? friendlyError(e, 'Try again.'))),
    });
  };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => { if (!createM.isPending) onClose(); }}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable onPress={() => !createM.isPending && onClose()} accessibilityRole="button" accessibilityLabel="Close" importantForAccessibility="no-hide-descendants"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.64)' }} />
        <View accessibilityViewIsModal style={{ maxHeight: '88%', backgroundColor: C.sheetBg, borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: hexA(C.gold, 0.3), paddingHorizontal: 18, paddingTop: 14, paddingBottom: 14 + insets.bottom + kbH }}>
          <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 12 }} />
          <Serif style={{ fontSize: 19 }}>Turn off the Session code?</Serif>
          <Body style={{ fontSize: 12, color: C.muted2, lineHeight: 17, marginTop: 4, marginBottom: 12 }}>
            {isAdmin
              ? `As an admin your request is approved at once and the Session code goes off for ${clientName} (and the training partner).`
              : `The doctors' manager must approve this. The Session code stays on for ${clientName} (and the training partner) until then.`}
          </Body>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 8, paddingBottom: 8 }}>
            <Mono style={{ fontSize: 9, letterSpacing: 0.8, color: C.muted3 }}>REASON (AT LEAST {MIN_REASON} CHARACTERS)</Mono>
            <TextInput value={reason} onChangeText={setReason} multiline maxLength={600} placeholder="Why should the Session code be turned off for this client?" placeholderTextColor={C.muted3}
              accessibilityLabel="Reason"
              style={{ minHeight: 90, textAlignVertical: 'top', fontFamily: F.body, fontSize: 14, color: '#fff', paddingVertical: 11, paddingHorizontal: 12, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }} />
            <Body style={{ fontSize: 11, color: C.muted3 }}>The reason is shown to the reviewer and kept in the history.</Body>
          </ScrollView>
          <View style={{ flexDirection: 'row', gap: 10, paddingTop: 12 }}>
            <Pressable onPress={onClose} disabled={createM.isPending} accessibilityRole="button"
              style={{ flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: C.muted }}>Keep it on</Text>
            </Pressable>
            <Pressable onPress={send} disabled={!!problem || createM.isPending} accessibilityRole="button" accessibilityLabel={isAdmin ? 'Turn off' : 'Send request'}
              style={{ flex: 1.4, minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 12, backgroundColor: hexA(C.gold, problem ? 0.06 : 0.16), borderWidth: 1, borderColor: hexA(C.gold, problem ? 0.2 : 0.5), opacity: createM.isPending ? 0.6 : 1 }}>
              {createM.isPending ? <ActivityIndicator size="small" color={C.gold} /> : null}
              <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: problem ? C.muted3 : C.gold }}>{createM.isPending ? 'Sending…' : isAdmin ? 'Turn off' : 'Send request'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
