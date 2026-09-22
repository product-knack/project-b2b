import React from 'react';
import { View, Pressable, Alert, Animated, ActivityIndicator, PanResponder } from 'react-native';
import * as Haptics from 'expo-haptics';
import { createAudioPlayer, setAudioModeAsync, requestRecordingPermissionsAsync, useAudioRecorder, RecordingPresets, type AudioPlayer } from 'expo-audio';
import { C, hexA } from '../theme';
import { Icon } from '../icons';
import { Mono } from './primitives';
import { clockOf } from '../lib/techDesk';

/* ============ Voice notes (record + play) ============
   One expo-audio implementation shared by the Tech Desk (ticket memos) and the
   CRM communication log (call memos that also get transcribed). The recorder
   writes an m4a (AAC) on both platforms; the player streams any URL, local
   file:// or a signed storage URL. expo-audio reports SECONDS; this UI works
   in ms. */

export type RecordedVoice = { uri: string; name: string; mime: string; size: number; durationMs: number };

/* ---------- recorder hook ----------
   start() asks for the mic, finish(keep) stops and hands the file back through
   onRecorded. Takes shorter than 800 ms are dropped (an accidental tap); an
   optional maxMs auto-stops and keeps the take, so a long CRM call note cannot
   run past the transcription limit. */
export function useVoiceRecorder(onRecorded: (f: RecordedVoice) => void, opts?: { maxMs?: number }) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const activeRef = React.useRef(false);
  const startedAtRef = React.useRef(0);
  const [recording, setRecording] = React.useState(false);
  const [recMs, setRecMs] = React.useState(0);
  const timer = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const onRecordedRef = React.useRef(onRecorded); onRecordedRef.current = onRecorded;
  const maxMs = opts?.maxMs ?? 0;

  React.useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
    if (activeRef.current) { activeRef.current = false; recorder.stop().catch(() => {}); }
  }, []);

  const finish = React.useCallback(async (keep: boolean) => {
    if (!activeRef.current) return;
    activeRef.current = false;
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    const elapsed = Date.now() - startedAtRef.current;
    setRecording(false);
    setRecMs(0);
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      const uri = recorder.uri;
      if (!keep || !uri) return;
      if (elapsed < 800) { Alert.alert('Too short', 'Hold on a moment longer before stopping.'); return; }
      onRecordedRef.current({ uri, name: `voice-${Date.now()}.m4a`, mime: 'audio/m4a', size: 0, durationMs: elapsed });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e: any) {
      if (keep) Alert.alert('Recording failed', e?.message ?? 'Unknown error');
    }
  }, [recorder]);
  const finishRef = React.useRef(finish); finishRef.current = finish;

  const start = React.useCallback(async () => {
    if (activeRef.current) return;
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) { Alert.alert('Microphone needed', 'Allow microphone access to record a voice memo.'); return; }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      activeRef.current = true;
      startedAtRef.current = Date.now();
      setRecording(true);
      setRecMs(0);
      timer.current = setInterval(() => {
        const ms = Date.now() - startedAtRef.current;
        setRecMs(ms);
        if (maxMs && ms >= maxMs) finishRef.current(true); // hit the ceiling: keep what we have
      }, 250);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    } catch (e: any) {
      Alert.alert('Could not start recording', e?.message ?? 'Unknown error');
    }
  }, [recorder, maxMs]);

  return { recording, recMs, start, finish };
}

/** Breathing red dot for the "recording" state. */
function RecDot({ size = 9 }: { size?: number }) {
  const v = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: 700, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [v]);
  return <Animated.View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: C.red, opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }) }} />;
}

/** Hold-to-record mic. Press and hold to record, release to save, slide LEFT
    past the threshold to delete. Same gesture as the Messenger's voice notes, so
    it already feels familiar; the PanResponder is created once and reads the
    latest handlers through refs (a fresh instance mid-gesture never saw the grant). */
const CANCEL_PX = 90;
export function VoiceHoldButton({ recording, recMs, onStart, onFinish, accent, compact }: {
  recording: boolean; recMs: number;
  onStart: () => void; onFinish: (keep: boolean) => void;
  accent: string; compact?: boolean;
}) {
  const scale = React.useRef(new Animated.Value(1)).current;
  const drag = React.useRef(new Animated.Value(0)).current;
  const activeRef = React.useRef(false);
  const [willCancel, setWillCancel] = React.useState(false);

  const rest = () => {
    setWillCancel(false);
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 6 }),
      Animated.timing(drag, { toValue: 0, duration: 160, useNativeDriver: true }),
    ]).start();
  };
  // Latest callbacks via refs — the responder below is built once.
  const beginRef = React.useRef(() => {});
  const moveRef = React.useRef((_dx: number) => {});
  const endRef = React.useRef(() => {});
  beginRef.current = () => {
    if (activeRef.current) return;
    activeRef.current = true;
    Animated.spring(scale, { toValue: 1.4, useNativeDriver: true, speed: 24, bounciness: 8 }).start();
    onStart();
  };
  moveRef.current = (dx) => {
    if (!activeRef.current) return;
    const x = Math.min(0, dx);
    drag.setValue(x);
    if (x < -CANCEL_PX) {
      // Slid far enough: delete this take without saving.
      activeRef.current = false;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      onFinish(false);
      rest();
    } else {
      setWillCancel(x < -CANCEL_PX / 2);
    }
  };
  endRef.current = () => {
    if (!activeRef.current) { rest(); return; }
    activeRef.current = false;
    onFinish(true);           // released → auto stop and save
    rest();
  };
  const pan = React.useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => beginRef.current(),
    onPanResponderMove: (_e: any, g: any) => moveRef.current(g.dx),
    onPanResponderRelease: () => endRef.current(),
    onPanResponderTerminate: () => endRef.current(),
  })).current;

  const size = compact ? 40 : 44;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: recording ? 1 : undefined }}>
      {recording ? (
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 9 }}>
          <RecDot />
          <Mono style={{ fontSize: 13, color: C.red }}>{clockOf(recMs)}</Mono>
          <Mono style={{ flex: 1, fontSize: 8.5, color: willCancel ? C.red : C.muted3 }} numberOfLines={1}>
            {willCancel ? 'RELEASE TO DELETE' : 'SLIDE LEFT TO DELETE'}
          </Mono>
          <Icon name="trash" size={14} color={willCancel ? C.red : C.faint} strokeWidth={2.2} />
        </View>
      ) : null}
      <Animated.View
        {...pan.panHandlers}
        style={{ transform: [{ scale }, { translateX: drag }] }}
      >
        <View
          accessibilityRole="button"
          accessibilityLabel="Hold to record a voice memo"
          accessibilityHint="Press and hold to record, release to save, slide left to delete"
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={{
            width: size, height: size, borderRadius: size / 2,
            alignItems: 'center', justifyContent: 'center',
            backgroundColor: recording ? hexA(C.red, 0.2) : hexA(accent, 0.14),
            borderWidth: 1, borderColor: recording ? hexA(C.red, 0.5) : hexA(accent, 0.4),
          }}
        >
          <Icon name="mic" size={compact ? 17 : 19} color={recording ? C.red : accent} strokeWidth={2.2} />
        </View>
      </Animated.View>
    </View>
  );
}

/** Tap-to-record control for longer notes (a CRM call memo runs minutes, where
    a hold gesture tires the thumb). Idle: a labelled mic button. Recording: red
    dot, elapsed / ceiling clock and a Stop button. */
export function VoiceTapButton({ recording, recMs, maxMs, onStart, onStop, accent, label = 'Record voice memo', disabled }: {
  recording: boolean; recMs: number; maxMs?: number;
  onStart: () => void; onStop: () => void;
  accent: string; label?: string; disabled?: boolean;
}) {
  if (recording) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 12, backgroundColor: hexA(C.red, 0.08), borderWidth: 1, borderColor: hexA(C.red, 0.35) }}>
        <RecDot />
        <Mono style={{ fontSize: 13, color: C.red }}>{clockOf(recMs)}{maxMs ? ` / ${clockOf(maxMs)}` : ''}</Mono>
        <Mono style={{ flex: 1, fontSize: 8.5, color: C.muted3 }} numberOfLines={1}>RECORDING</Mono>
        <Pressable onPress={onStop} hitSlop={10} accessibilityRole="button" accessibilityLabel="Stop recording"
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, backgroundColor: hexA(C.red, 0.18), borderWidth: 1, borderColor: hexA(C.red, 0.5), opacity: pressed ? 0.7 : 1 })}>
          <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: C.red }} />
          <Mono style={{ fontSize: 10, color: C.red }}>STOP</Mono>
        </Pressable>
      </View>
    );
  }
  return (
    <Pressable onPress={onStart} disabled={disabled} hitSlop={6} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 10, borderRadius: 12, backgroundColor: hexA(accent, 0.1), borderWidth: 1, borderColor: hexA(accent, 0.38), opacity: disabled ? 0.45 : pressed ? 0.7 : 1 })}>
      <Icon name="mic" size={15} color={accent} strokeWidth={2.2} />
      <Mono style={{ fontSize: 10.5, letterSpacing: 0.6, color: accent }}>{label.toUpperCase()}</Mono>
    </Pressable>
  );
}

/* ---------- player ----------
   Each instance owns its player and releases it on unmount. `url` may still be
   null while a signed URL resolves; the button shows a spinner until then. */
export function VoicePlayer({ url, accent = C.orange, label = 'VOICE', knownMs }: { url: string | null; accent?: string; label?: string; knownMs?: number | null }) {
  const playerRef = React.useRef<AudioPlayer | null>(null);
  const subRef = React.useRef<{ remove?: () => void } | null>(null);
  const [playing, setPlaying] = React.useState(false);
  const [posMs, setPosMs] = React.useState(0);
  const [durMs, setDurMs] = React.useState(knownMs ?? 0);

  React.useEffect(() => () => {
    try { subRef.current?.remove?.(); } catch { /* gone */ }
    try { playerRef.current?.remove(); } catch { /* released */ }
  }, []);

  const onStatus = (st: any) => {
    if (!st?.isLoaded) return;
    setPosMs(Math.round((st.currentTime ?? 0) * 1000));
    if (st.duration) setDurMs(Math.round(st.duration * 1000));
    setPlaying(!!st.playing);
    if (st.didJustFinish) {
      setPlaying(false); setPosMs(0);
      try { playerRef.current?.pause(); playerRef.current?.seekTo(0); } catch { /* released */ }
    }
  };
  const toggle = async () => {
    if (!url) return;
    try {
      if (!playerRef.current) {
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
        const p = createAudioPlayer({ uri: url });
        playerRef.current = p;
        subRef.current = p.addListener('playbackStatusUpdate', onStatus);
        p.play();
        return;
      }
      const p = playerRef.current;
      if (p.playing) p.pause(); else p.play();
    } catch (e: any) {
      Alert.alert('Playback failed', e?.message ?? 'Could not play this voice memo.');
    }
  };
  const pct = durMs > 0 ? Math.min(1, posMs / durMs) : 0;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 190, paddingVertical: 6 }}>
      <Pressable onPress={toggle} disabled={!url} hitSlop={8} accessibilityRole="button" accessibilityLabel={playing ? 'Pause voice memo' : 'Play voice memo'}
        style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: hexA(accent, 0.16), borderWidth: 1, borderColor: hexA(accent, 0.4), opacity: url ? 1 : 0.5 }}>
        {!url ? <ActivityIndicator size="small" color={accent} />
          : <Icon name={playing ? 'clock' : 'chevRight'} size={14} color={accent} strokeWidth={2.4} />}
      </Pressable>
      <View style={{ flex: 1, gap: 5 }}>
        <View style={{ height: 3, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden' }}>
          <View style={{ width: `${pct * 100}%`, height: 3, backgroundColor: accent }} />
        </View>
        <Mono style={{ fontSize: 8.5, color: C.muted2 }}>{clockOf(posMs)}{durMs ? ` / ${clockOf(durMs)}` : ''} · {label}</Mono>
      </View>
    </View>
  );
}
