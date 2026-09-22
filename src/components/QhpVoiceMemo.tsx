import React from 'react';
import { View, Text, Pressable, Modal, Alert, ActivityIndicator } from 'react-native';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Body, Mono } from './primitives';
import { useVoiceRecorder, VoiceTapButton, VoicePlayer, RecordedVoice } from './VoiceNote';
import { useAttachQhpVoiceMemo, useSignedQhpMemoUrl, QHP_MEMO_MAX_MS, QhpRow } from '../lib/qhpQueries';
import { clockOf } from '../lib/techDesk';

/* ============ QHP voice memo (web QHPVoiceMemoDialog / QHPVoiceMemoPlayer parity) ============
   Every completed QHP card offers the assessor one "Voice memo": record, listen
   back, Record again or Save. Saved once, the button gives way to a player for
   good; the database trigger blocks any later change. Audio only, no transcript. */

const ACCENT = '#5CE1E6';

/** The record button on a card without a memo. */
export function QhpVoiceMemoButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="Record a voice memo for this QHP"
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9, borderRadius: 11, backgroundColor: hexA(ACCENT, 0.1), borderWidth: 1, borderColor: hexA(ACCENT, 0.38), opacity: pressed ? 0.7 : 1 })}>
      <Icon name="mic" size={12} color={ACCENT} strokeWidth={2.2} />
      <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: ACCENT }}>Voice memo</Text>
    </Pressable>
  );
}

/** Saved memo on a card: signs the private path for an hour, then plays it. */
export function QhpVoiceMemoPlayer({ path, sec, recordedAt }: { path: string; sec: number | null; recordedAt: string | null }) {
  const urlQ = useSignedQhpMemoUrl(path);
  const when = recordedAt ? new Date(recordedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true }) : null;
  return (
    <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 11, backgroundColor: hexA(ACCENT, 0.06), borderWidth: 1, borderColor: hexA(ACCENT, 0.22) }}>
      {urlQ.isError
        ? <Body style={{ fontSize: 10.5, color: C.muted3, paddingVertical: 6 }}>Voice memo unavailable ({(urlQ.error as Error).message}).</Body>
        : <VoicePlayer url={urlQ.data ?? null} accent={ACCENT} label={when ? `MEMO · ${when.toUpperCase()}` : 'MEMO'} knownMs={sec ? sec * 1000 : null} />}
    </View>
  );
}

/* ---------- dialog ----------
   Stages: intro (the prompt + Start) → recording → review (local playback,
   Record again / Save) → saving. Closing mid-recording discards the take;
   nothing reaches the bucket before Save. */
type Stage = 'intro' | 'recording' | 'review';
export function QhpVoiceMemoDialog({ row, userId, onClose }: { row: QhpRow | null; userId: string; onClose: () => void }) {
  const [take, setTake] = React.useState<RecordedVoice | null>(null);
  const rec = useVoiceRecorder((f) => setTake(f), { maxMs: QHP_MEMO_MAX_MS });
  const attachM = useAttachQhpVoiceMemo();
  const stage: Stage = take ? 'review' : rec.recording ? 'recording' : 'intro';

  // A fresh row gets a fresh dialog: no take carries over between cards.
  React.useEffect(() => { setTake(null); }, [row?.id]);

  const close = () => {
    if (attachM.isPending) return;
    if (rec.recording) rec.finish(false);
    setTake(null);
    onClose();
  };
  const save = async () => {
    if (!row || !take) return;
    try {
      await attachM.mutateAsync({ assessmentId: row.id, userId, uri: take.uri, name: take.name, mime: take.mime, durationMs: take.durationMs });
      setTake(null);
      onClose();
      Alert.alert('Voice memo saved', 'It is now attached to this QHP and cannot be changed.');
    } catch (e: any) {
      Alert.alert("Couldn't save the memo", e?.message ?? 'Try again.');
    }
  };

  return (
    <Modal visible={!!row} transparent animationType="fade" onRequestClose={close}>
      <Pressable onPress={close} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'center', padding: 22 }}>
        <Pressable onPress={() => {}} style={{ borderRadius: 18, backgroundColor: '#141010', borderWidth: 1, borderColor: hexA(ACCENT, 0.3), padding: 18, gap: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: hexA(ACCENT, 0.12), borderWidth: 1, borderColor: hexA(ACCENT, 0.3) }}>
              <Icon name="mic" size={16} color={ACCENT} strokeWidth={2.1} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: '#fff' }}>Voice memo</Text>
              <Body style={{ fontSize: 11.5, color: C.muted2 }} numberOfLines={1}>{row?.client_name ?? 'Client'} · {row?.label ?? 'QHP'}</Body>
            </View>
            <Pressable onPress={close} hitSlop={10} disabled={attachM.isPending} style={{ width: 30, height: 30, alignItems: 'center', justifyContent: 'center', opacity: attachM.isPending ? 0.4 : 1 }}>
              <Icon name="close" size={14} color={C.muted} strokeWidth={2.3} />
            </Pressable>
          </View>

          <View style={{ padding: 12, borderRadius: 13, backgroundColor: hexA(ACCENT, 0.06), borderWidth: 1, borderColor: hexA(ACCENT, 0.2) }}>
            <Body style={{ fontSize: 13, color: '#fff', lineHeight: 19 }}>Record all insights regarding the QHP in detail.</Body>
            <Body style={{ fontSize: 11, color: C.muted2, marginTop: 4 }}>Up to {clockOf(QHP_MEMO_MAX_MS)}. Saved once, the memo cannot be re-recorded or deleted, so listen back before you save.</Body>
          </View>

          {stage === 'intro' || stage === 'recording' ? (
            <VoiceTapButton recording={rec.recording} recMs={rec.recMs} maxMs={QHP_MEMO_MAX_MS} onStart={rec.start} onStop={() => rec.finish(true)} accent={ACCENT} label="Start recording" />
          ) : null}

          {stage === 'review' && take ? (
            <>
              <View style={{ paddingHorizontal: 10, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
                <VoicePlayer url={take.uri} accent={ACCENT} label="LISTEN BACK" knownMs={take.durationMs} />
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Pressable onPress={() => setTake(null)} disabled={attachM.isPending}
                  style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', opacity: attachM.isPending ? 0.5 : 1 }}>
                  <Icon name="mic" size={12} color={C.muted} strokeWidth={2.2} />
                  <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: C.muted }}>Record again</Text>
                </Pressable>
                <Pressable onPress={save} disabled={attachM.isPending}
                  style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11, borderRadius: 12, backgroundColor: hexA(ACCENT, 0.16), borderWidth: 1, borderColor: hexA(ACCENT, 0.45) }}>
                  {attachM.isPending ? <ActivityIndicator size="small" color={ACCENT} /> : <Icon name="checks" size={13} color={ACCENT} strokeWidth={2.4} />}
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: ACCENT }}>{attachM.isPending ? 'Saving…' : 'Save'}</Text>
                </Pressable>
              </View>
              <Mono style={{ fontSize: 8.5, color: C.muted3, textAlign: 'center' }}>{clockOf(take.durationMs)} RECORDED · SAVE IS FINAL</Mono>
            </>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
