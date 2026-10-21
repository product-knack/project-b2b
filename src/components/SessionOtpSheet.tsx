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

/* Session code sheet (20 Oct 2026; offline 21 Oct 2026): the trainer types the member's 4-digit code before
   Add Workout. Mirrors the web SessionOtpDialog: title "Session code", the body line (plus the couple
   sentence), four boxes drawn from one number input, inline reason copy, Cancel / Verify. Online: auto-submit
   on the 4th digit, {ok:true} calls onVerified, {ok:false} shows the reason and clears the boxes.
   Offline (owner decision 21 Oct 2026: trust now, verify at sync): the gold line explains, the button reads
   Save code, and onSave(code) hands the digits to the caller, who queues them before the workout. A verify
   call that fails on the network switches the sheet to the same Save code mode (the trainer may still retry).
   Sheet rules: sibling backdrop, keyboard padding, hitSlop >= 10, one Modal at a time (the caller mounts it
   next to its other sheets and opens it alone). */
export function SessionOtpSheet({ visible, scheduleId, clientName, couple, onVerified, onSave, onClose }: {
  visible: boolean;
  scheduleId: string | null;
  clientName: string;
  couple: boolean;
  onVerified: () => void;
  /** The code typed with no network (or after a failed call); the caller queues it. Absent = online only. */
  onSave?: (code: string) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const kbH = useKeyboardHeight();
  const online = useIsOnline();
  const verifyM = useVerifySessionOtp();
  const [code, setCode] = React.useState('');
  const [err, setErr] = React.useState<string | null>(null);
  const [netFailed, setNetFailed] = React.useState(false);
  const inputRef = React.useRef<TextInput>(null);
  const submitting = React.useRef(false);
  const busy = verifyM.isPending;
  // Save mode: no network, or the last call never reached the server. Needs a caller that queues.
  const saveMode = !!onSave && (!online || netFailed);

  React.useEffect(() => {
    if (visible) { setCode(''); setErr(null); setNetFailed(false); submitting.current = false; verifyM.reset(); setTimeout(() => inputRef.current?.focus(), 250); }
    else Keyboard.dismiss();
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = React.useCallback((value: string) => {
    if (!scheduleId || value.length !== 4 || !onSave) return;
    Keyboard.dismiss();
    onSave(value);
  }, [scheduleId, onSave]);

  const submit = React.useCallback(async (value: string) => {
    if (!scheduleId || value.length !== 4 || submitting.current) return;
    if (saveMode) { save(value); return; }
    if (!online) { setErr('You are offline. The session code can only be verified online.'); return; }
    submitting.current = true;
    setErr(null);
    try {
      const answer = await verifyM.mutateAsync({ scheduleId, code: value });
      if (answer.ok) { Keyboard.dismiss(); onVerified(); return; }
      setErr(otpReasonText(answer.reason));
      setCode('');
      setTimeout(() => inputRef.current?.focus(), 50);
    } catch {
      // The server was never reached: offer to save the code for the sync (the digits stay in the boxes).
      if (onSave) { setNetFailed(true); setErr(OTP_NETWORK_MESSAGE); }
      else setErr('The code could not be verified. Check your connection and retry.');
    } finally {
      submitting.current = false;
    }
  }, [scheduleId, online, saveMode, save, verifyM, onVerified, onSave]);

  const onChange = (raw: string) => {
    const next = otpDigits(raw);
    setCode(next);
    if (err && !netFailed) setErr(null);
    // Online: the fourth digit submits. Save mode waits for the tap on Save code.
    if (next.length === 4 && !saveMode) submit(next);
  };

  const canAct = code.length === 4 && !busy && !!scheduleId;
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
                  <View key={i} style={{ width: 54, height: 60, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1.5, borderColor: err && !netFailed ? hexA(C.red, 0.6) : active ? C.gold : 'rgba(255,255,255,0.12)' }}>
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
            {err ? <Body style={{ fontSize: 12, color: netFailed ? C.gold : C.red, textAlign: 'center' }}>{err}</Body> : null}
            {!online && !err ? <Body style={{ fontSize: 12, color: C.gold, textAlign: 'center', lineHeight: 17 }}>{onSave ? OTP_OFFLINE_MESSAGE : 'You are offline. The session code can only be verified online.'}</Body> : null}

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable onPress={() => { if (!busy) onClose(); }} disabled={busy} hitSlop={10} accessibilityRole="button" style={{ flex: 1, alignItems: 'center', paddingVertical: 14, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.06)', opacity: busy ? 0.5 : 1 }}>
                <Text style={{ fontFamily: F.bodySemi, fontSize: 13.5, color: C.muted }}>Cancel</Text>
              </Pressable>
              <Pressable onPress={() => submit(code)} disabled={!canAct} hitSlop={10} accessibilityRole="button" accessibilityState={{ disabled: !canAct }} style={{ flex: 1.3, alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 14, backgroundColor: canAct ? C.gold : hexA(C.gold, 0.25), opacity: canAct ? 1 : 0.6 }}>
                {busy ? <ActivityIndicator size="small" color="#1A1208" /> : <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: '#1A1208' }}>{saveMode ? 'Save code' : 'Verify'}</Text>}
              </Pressable>
            </View>
            <Body style={{ fontSize: 10.5, color: C.muted3, textAlign: 'center' }}>The code is the member's own. You verify it, you never see it here.</Body>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
