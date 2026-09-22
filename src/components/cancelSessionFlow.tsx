import React from 'react';
import { View, Text, Pressable, Modal, TextInput, Image, ScrollView, Alert, ActivityIndicator, Keyboard, KeyboardAvoidingView, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono } from './primitives';
import { useKeyboardHeight } from '../lib/useKeyboardHeight';
import { useCancelScheduledSession } from '../lib/trainerQueries';

/* ============ Cancel a roster session (shared flow) ============
   The trainer roster card's two-step cancel, lifted out so doctors (Today's
   Roster and the HOD roster page) get the exact same thing:
     1. type picker: Cancel Session (no charge) vs Paid Cancellation (double
        confirms; raises an admin-approval claim),
     2. remark (required) + optional photo, then Confirm.
   Writes through useCancelScheduledSession (session_schedule update, paid =>
   paid_cancellation + admin_approval 'pending', CRM push). `askWho` adds the
   HOD's "Cancelled by" Client / Doctor toggle (DB check accepts Client | Trainer). */

export type CancelSessionRow = { id: string; client_name: string; scheduled_datetime: string };

export function CancelSessionFlow({ row, onClose, askWho, who = 'Doctor', onDone }: {
  row: CancelSessionRow | null;
  onClose: () => void;
  askWho?: boolean;
  /** Label for the staff side of the "Cancelled by" toggle (stored as 'Trainer'). */
  who?: string;
  onDone?: () => void;
}) {
  const kbH = useKeyboardHeight();
  const cancelM = useCancelScheduledSession();
  const [step, setStep] = React.useState<'pick' | 'paidConfirm' | 'form'>('pick');
  const [paid, setPaid] = React.useState(false);
  const [text, setText] = React.useState('');
  const [att, setAtt] = React.useState<{ uri: string; name: string; mime: string } | null>(null);
  const [by, setBy] = React.useState<'Client' | 'Trainer' | null>(null);
  const visible = !!row;

  React.useEffect(() => {
    if (visible) { setStep('pick'); setPaid(false); setText(''); setAtt(null); setBy(null); cancelM.reset(); }
  }, [visible]);

  const when = row ? new Date(row.scheduled_datetime).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }) : '';
  const pickAttachment = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow photo access to attach an image.'); return; }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.75 });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    setAtt({ uri: a.uri, name: a.fileName || `photo-${Date.now()}.jpg`, mime: a.mimeType || 'image/jpeg' });
  };
  // Android new-arch rule: never unmount a Modal while its TextInput is focused.
  const close = () => { Keyboard.dismiss(); setTimeout(onClose, 80); };
  const busy = cancelM.isPending;
  const err = cancelM.error as Error | null;
  const blocked = busy || !text.trim() || (askWho && !by);
  const submit = async () => {
    if (!row || blocked) return;
    try {
      await cancelM.mutateAsync({ id: row.id, remark: text, paid, image: att ?? undefined, canceledBy: askWho ? (by as 'Client' | 'Trainer') : 'Trainer' });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      close();
      onDone?.();
    } catch { /* error surfaced below */ }
  };

  return (
    <>
      {/* Step 1 + 2: type picker (web CancelTypePickerDialog), paid double-confirms */}
      <Modal visible={visible && step !== 'form'} transparent animationType="fade" onRequestClose={onClose}>
        <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center', padding: 22 }}>
          <Pressable onPress={() => {}} style={{ width: '100%', maxWidth: 360, backgroundColor: '#12100E', borderWidth: 1, borderColor: 'rgba(255,150,90,0.16)', borderRadius: 20, padding: 20, gap: 12 }}>
            {step === 'pick' ? (
              <>
                <Serif style={{ fontSize: 19 }}>Cancel Session</Serif>
                <Body style={{ fontSize: 12.5, color: C.muted2 }}>How should {row?.client_name}'s {when} session be cancelled?</Body>
                <Pressable onPress={() => { setPaid(false); setStep('form'); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: 13, borderRadius: 14, backgroundColor: hexA(C.red, 0.07), borderWidth: 1, borderColor: hexA(C.red, 0.3) }}>
                  <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: hexA(C.red, 0.13), alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="close" size={15} color={C.red} strokeWidth={2.3} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: '#fff' }}>Cancel Session</Text>
                    <Body style={{ fontSize: 11, color: C.muted2, marginTop: 1 }}>Standard cancellation, no charge</Body>
                  </View>
                  <Icon name="chevRight" size={14} color={C.muted3} strokeWidth={2.2} />
                </Pressable>
                <Pressable onPress={() => setStep('paidConfirm')} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: 13, borderRadius: 14, backgroundColor: hexA(C.gold, 0.07), borderWidth: 1, borderColor: hexA(C.gold, 0.3) }}>
                  <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: hexA(C.gold, 0.13), alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="rupee" size={15} color={C.gold} strokeWidth={2.2} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: '#fff' }}>Paid Cancellation</Text>
                    <Body style={{ fontSize: 11, color: C.muted2, marginTop: 1 }}>Last-moment cancel, counted as paid after admin approval</Body>
                  </View>
                  <Icon name="chevRight" size={14} color={C.muted3} strokeWidth={2.2} />
                </Pressable>
                <Pressable onPress={onClose} style={{ alignItems: 'center', paddingVertical: 12, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
                  <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: C.ink }}>Dismiss</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Serif style={{ fontSize: 19 }}>Paid Cancellation?</Serif>
                <Body style={{ fontSize: 12.5, color: C.muted2, lineHeight: 18 }}>This marks the session as a last-moment paid cancellation and raises a claim that goes to admin for approval. Continue?</Body>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Pressable onPress={() => setStep('pick')} style={{ flex: 1, alignItems: 'center', paddingVertical: 13, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
                    <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: C.ink }}>Back</Text>
                  </Pressable>
                  <Pressable onPress={() => { setPaid(true); setStep('form'); }} style={{ flex: 1, alignItems: 'center', paddingVertical: 13, borderRadius: 13, backgroundColor: hexA(C.gold, 0.16), borderWidth: 1, borderColor: hexA(C.gold, 0.45) }}>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: C.gold }}>Yes, continue</Text>
                  </Pressable>
                </View>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Step 3: remark + optional photo. Backdrop deliberately not tappable. */}
      <Modal visible={visible && step === 'form'} transparent animationType="fade" onRequestClose={close}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center', padding: 22, paddingBottom: Platform.OS === 'android' && kbH > 0 ? kbH + 14 : 22 }}>
          <ScrollView bounces={false} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={{ width: '100%', maxWidth: 360, maxHeight: '100%', flexGrow: 0, backgroundColor: '#12100E', borderWidth: 1, borderColor: 'rgba(255,150,90,0.16)', borderRadius: 20 }} contentContainerStyle={{ padding: 20, gap: 14 }}>
            <Serif style={{ fontSize: 19 }}>{paid ? 'Paid Cancellation' : 'Cancel Session'}</Serif>
            <Body style={{ fontSize: 12.5, color: C.muted2 }}>
              {paid ? `Add a remark for ${row?.client_name}'s paid cancellation, sent to admin for approval.` : `Add a cancellation remark for ${row?.client_name}'s session.`}
            </Body>
            {askWho ? (
              <View>
                <Mono style={{ fontSize: 10, letterSpacing: 1.2, color: C.mono2, marginBottom: 8 }}>CANCELLED BY *</Mono>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {(['Client', 'Trainer'] as const).map((w) => {
                    const on = by === w;
                    return (
                      <Pressable key={w} onPress={() => setBy(w)} accessibilityRole="button" accessibilityState={{ selected: on }} style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 11, backgroundColor: hexA(C.red, on ? 0.16 : 0.04), borderWidth: 1, borderColor: hexA(C.red, on ? 0.5 : 0.16) }}>
                        <Text style={{ fontFamily: on ? F.bodyBold : F.bodySemi, fontSize: 12, color: on ? C.red : C.muted }}>{w === 'Trainer' ? who : w}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Remark…"
              placeholderTextColor={C.muted3}
              multiline
              style={{ minHeight: 72, textAlignVertical: 'top', paddingVertical: 12, paddingHorizontal: 13, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.03)', color: '#fff', fontFamily: F.body, fontSize: 14 }}
            />
            {att ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)' }}>
                <Image source={{ uri: att.uri }} style={{ width: 42, height: 42, borderRadius: 9, backgroundColor: '#000' }} />
                <Body style={{ flex: 1, fontSize: 11.5, color: C.ink3 }} numberOfLines={1}>{att.name}</Body>
                <Pressable onPress={() => setAtt(null)} hitSlop={10} style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="close" size={12} color={C.muted} strokeWidth={2.3} />
                </Pressable>
              </View>
            ) : (
              <Pressable onPress={pickAttachment} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 11, borderRadius: 12, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.14)' }}>
                <Icon name="file" size={13} color={C.muted2} strokeWidth={2} />
                <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: C.muted }}>Attach photo (optional)</Text>
              </Pressable>
            )}
            {err ? <Body style={{ fontSize: 12, color: C.red }}>{err.message}</Body> : null}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable onPress={() => !busy && close()} style={{ flex: 1, alignItems: 'center', paddingVertical: 13, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
                <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: C.ink }}>Dismiss</Text>
              </Pressable>
              <Pressable onPress={submit} disabled={!!blocked} style={{ flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 7, paddingVertical: 13, borderRadius: 13, backgroundColor: blocked ? 'rgba(255,255,255,0.06)' : hexA(paid ? C.gold : C.red, 0.16), borderWidth: 1, borderColor: blocked ? 'rgba(255,255,255,0.08)' : hexA(paid ? C.gold : C.red, 0.4) }}>
                {busy ? <ActivityIndicator size="small" color={paid ? C.gold : C.red} /> : null}
                <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: blocked ? C.muted3 : paid ? C.gold : C.red }}>{busy ? 'Saving…' : 'Confirm'}</Text>
              </Pressable>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}
