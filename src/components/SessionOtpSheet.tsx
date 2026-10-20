import React from 'react';
import { View, Text, Pressable, Modal, TextInput, ScrollView, ActivityIndicator, Keyboard } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Body, Serif } from './primitives';
import { useKeyboardHeight } from '../lib/useKeyboardHeight';
import { useIsOnline } from '../lib/offline';
import { useVerifySessionOtp } from '../lib/sessionOtpQueries';
import { otpDigits, otpReasonText, otpSheetBody, OTP_NETWORK_MESSAGE, OTP_OFFLINE_MESSAGE } from '../lib/sessionOtp';

/* Session code sheet (20 Oct 2026): the trainer types the member's 4-digit code before Add Workout.
   Mirrors the web SessionOtpDialog: title "Session code", the body line (plus the couple sentence),
   four boxes drawn from one number input, auto-submit on the 4th digit, inline reason copy, Cancel /
   Verify. {ok:true} calls onVerified; {ok:false} shows the reason and clears the boxes; a network
   error keeps the sheet open; offline shows the offline line and never calls the server.
   Sheet rules: sibling backdrop, keyboard padding, hitSlop >= 10, one Modal at a time (the caller
   mounts it next to its other sheets and opens it alone). */
export function SessionOtpSheet({ visible, scheduleId, clientName, couple, onVerified, onClose }: {
  visible: boolean;
  scheduleId: string | null;
  clientName: string;
  couple: boolean;
  onVerified: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const kbH = useKeyboardHeight();
  const online = useIsOnline();
  const verifyM = useVerifySessionOtp();
  const [code, setCode] = React.useState('');
  const [err, setErr] = React.useState<string | null>(null);
  const inputRef = React.useRef<TextInput>(null);
  const submitting = React.useRef(false);
  const busy = verifyM.isPending;

  React.useEffect(() => {
    if (visible) { setCode(''); setErr(null); submitting.current = false; verifyM.reset(); setTimeout(() => inputRef.current?.focus(), 250); }
    else Keyboard.dismiss();
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = React.useCallback(async (value: string) => {
    if (!scheduleId || value.length !== 4 || submitting.current) return;
    if (!online) { setErr(OTP_OFFLINE_MESSAGE); return; }
    submitting.current = true;
    setErr(null);
    try {
      const answer = await verifyM.mutateAsync({ scheduleId, code: value });
      if (answer.ok) { Keyboard.dismiss(); onVerified(); return; }
      setErr(otpReasonText(answer.reason));
      setCode('');
      setTimeout(() => inputRef.current?.focus(), 50);
    } catch {
      setErr(OTP_NETWORK_MESSAGE);
    } finally {
      submitting.current = false;
    }
  }, [scheduleId, online, verifyM, onVerified]);

  const onChange = (raw: string) => {
    const next = otpDigits(raw);
    setCode(next);
    if (err) setErr(null);
    if (next.length === 4) submit(next);
  };

  const canVerify = code.length === 4 && !busy && !!scheduleId;
  const boxes = [0, 1, 2, 3];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => { if (!busy) onClose(); }}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable onPress={() => { if (!busy) onClose(); }} accessibilityRole="button" accessibilityLabel="Close" importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)' }} />
        <View accessibilityViewIsModal style={{ backgroundColor: C.sheetBg, borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.14)', paddingHorizontal: 18, paddingTop: 14, paddingBottom: insets.bottom + 18 + kbH }}>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 14 }}>
            <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center' }} />
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: hexA(C.gold, 0.14), borderWidth: 1, borderColor: hexA(C.gold, 0.35), alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="lock" size={18} color={C.gold} strokeWidth={2} />
              </View>
              <View style={{ flex: 1 }}>
                <Serif style={{ fontSize: 20 }}>Session code</Serif>
                <Body style={{ fontSize: 12, color: C.muted2, marginTop: 3, lineHeight: 17 }}>{otpSheetBody(clientName, couple)}</Body>
              </View>
              <Pressable onPress={() => { if (!busy) onClose(); }} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close" style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="close" size={13} color="#B8B2AC" strokeWidth={2.3} />
              </Pressable>
            </View>

            {/* Four boxes over one hidden input: tapping a box focuses the input. */}
            <Pressable onPress={() => inputRef.current?.focus()} accessibilityRole="button" accessibilityLabel="Enter the 4-digit code" style={{ flexDirection: 'row', justifyContent: 'center', gap: 12, paddingVertical: 6 }}>
              {boxes.map((i) => {
                const ch = code[i] ?? '';
                const active = i === Math.min(code.length, 3);
                return (
                  <View key={i} style={{ width: 54, height: 60, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1.5, borderColor: err ? hexA(C.red, 0.6) : active ? C.gold : 'rgba(255,255,255,0.12)' }}>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 24, color: '#fff' }}>{ch}</Text>
                  </View>
                );
              })}
            </Pressable>
            <TextInput
              ref={inputRef}
              value={code}
              onChangeText={onChange}
              keyboardType="number-pad"
              maxLength={4}
              autoFocus={false}
              caretHidden
              editable={!busy}
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              accessibilityLabel="Session code"
              style={{ position: 'absolute', opacity: 0, height: 1, width: 1 }}
            />
            {err ? <Body style={{ fontSize: 12, color: C.red, textAlign: 'center' }}>{err}</Body> : null}
            {!online && !err ? <Body style={{ fontSize: 12, color: C.gold, textAlign: 'center' }}>{OTP_OFFLINE_MESSAGE}</Body> : null}

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable onPress={() => { if (!busy) onClose(); }} disabled={busy} hitSlop={10} accessibilityRole="button" style={{ flex: 1, alignItems: 'center', paddingVertical: 14, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.06)', opacity: busy ? 0.5 : 1 }}>
                <Text style={{ fontFamily: F.bodySemi, fontSize: 13.5, color: C.muted }}>Cancel</Text>
              </Pressable>
              <Pressable onPress={() => submit(code)} disabled={!canVerify} hitSlop={10} accessibilityRole="button" accessibilityState={{ disabled: !canVerify }} style={{ flex: 1.3, alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 14, backgroundColor: canVerify ? C.gold : hexA(C.gold, 0.25), opacity: canVerify ? 1 : 0.6 }}>
                {busy ? <ActivityIndicator size="small" color="#1A1208" /> : <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: '#1A1208' }}>Verify</Text>}
              </Pressable>
            </View>
            <Body style={{ fontSize: 10.5, color: C.muted3, textAlign: 'center' }}>The code is the member's own. You verify it, you never see it here.</Body>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
