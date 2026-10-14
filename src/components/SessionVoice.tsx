import { voiceDayWithin, hasPainNote } from '../lib/sessionVoiceTypes';
import React from 'react';
import { View, Text, Pressable, Modal, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { setAudioModeAsync, useAudioPlaylist, useAudioPlaylistStatus } from 'expo-audio';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Body, Mono, Serif } from './primitives';
import { ReplayMask } from './ReplayShield';
import { useVoiceRecorder, VoiceTapButton, VoicePlayer, RecordedVoice } from './VoiceNote';
import { clockOf } from '../lib/techDesk';
import {
  SessionVoiceNote, PendingVoiceTake, SESSION_VOICE_MAX_MS, SESSION_VOICE_MAX_NOTES, ClientLatestVoice,
  persistTake, discardTake, queueSessionVoiceNote, useSignedSessionVoiceUrls, useInvalidateSessionVoice,
} from '../lib/sessionVoiceQueries';

/* ============ Session voice notes UI (30 Sep 2026) ============
   - VoiceNotesComposer: record takes (tap to record, 5 min cap), list them with a
     local player and a trash button. Used by the workout log form (under RPE)
     and by the roster sheet below.
   - SessionVoicePlaylistPlayer: the session's saved notes as ONE audio: one
     play button, one bar over the total, "note 2 of 3", back to back.
   - SessionVoiceSheet: Today's Roster's logged card: existing notes + record more.
   Voice is not visual, but the sheet and the player sit inside ReplayMask so
   nothing about them reaches session replay on unshielded screens. */

const ACCENT = C.purple;

/* ---------- pain / discomfort (14 Oct 2026) ----------
   Owner: "when a trainer records a voice note, show the title 'Please mention pain
   and discomfort if the client has any' with a checkbox; if yes, save its answer in
   the same json column as the note". The box is answered per take: a take kept
   while it is ticked carries painDiscomfort = true, the tag on its row toggles it
   again, and the box clears after every kept take so the next note is a fresh
   answer. The RPC stores it as `pain_discomfort` on the note element. */
export const PAIN_TITLE = 'Please mention pain and discomfort if the client has any';
export const PAIN_CHECKBOX = 'The client has pain or discomfort';

function PainTag({ on, onPress, disabled }: { on: boolean; onPress?: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled || !onPress} hitSlop={8} accessibilityRole="button" accessibilityState={{ selected: on }}
      accessibilityLabel={on ? 'Pain or discomfort reported, tap to clear' : 'No pain reported, tap to mark pain or discomfort'}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 3, paddingHorizontal: 8, borderRadius: 999, backgroundColor: hexA(on ? C.red : C.muted3, on ? 0.14 : 0.08), borderWidth: 1, borderColor: hexA(on ? C.red : C.muted3, on ? 0.5 : 0.3) }}>
      <Icon name="alert" size={9} color={on ? C.red : C.muted3} strokeWidth={2.3} />
      <Mono style={{ fontSize: 7.5, letterSpacing: 0.5, color: on ? C.red : C.muted3 }}>{on ? 'PAIN / DISCOMFORT' : 'NO PAIN'}</Mono>
    </Pressable>
  );
}

/* ---------- composer ---------- */
export function VoiceNotesComposer({ takes, onAdd, onRemove, onToggleFlag, savedCount = 0, disabled, hint, onRecordingChange }: {
  takes: PendingVoiceTake[];
  onAdd: (t: PendingVoiceTake) => void;
  onRemove: (uri: string) => void;
  /** flips painDiscomfort on a kept take (the tag on its row) */
  onToggleFlag?: (uri: string) => void;
  /** notes already saved on the session (counts against the cap) */
  savedCount?: number;
  disabled?: boolean;
  hint?: string;
  /** lets the host (the workout form) hold Submit while a recording runs */
  onRecordingChange?: (recording: boolean) => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [pain, setPain] = React.useState(false);
  const painRef = React.useRef(false);
  painRef.current = pain;
  const rec = useVoiceRecorder(async (f: RecordedVoice) => {
    setBusy(true);
    try {
      onAdd(await persistTake(f.uri, f.durationMs, painRef.current));
      setPain(false); // a fresh answer for the next note
    }
    catch (e: any) { Alert.alert("Couldn't keep the recording", e?.message ?? 'Try again.'); }
    finally { setBusy(false); }
  }, { maxMs: SESSION_VOICE_MAX_MS });
  React.useEffect(() => { onRecordingChange?.(rec.recording); }, [rec.recording]);
  const left = Math.max(0, SESSION_VOICE_MAX_NOTES - savedCount - takes.length);
  return (
    <View style={{ gap: 8 }}>
      {takes.map((t, i) => (
        <View key={t.uri} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, borderRadius: 12, backgroundColor: hexA(ACCENT, 0.07), borderWidth: 1, borderColor: hexA(t.painDiscomfort ? C.red : ACCENT, t.painDiscomfort ? 0.45 : 0.3) }}>
          <View style={{ flex: 1, gap: 2, paddingBottom: 6 }}>
            <VoicePlayer url={t.uri} accent={ACCENT} label={`NOTE ${savedCount + i + 1} · NOT SAVED YET`} knownMs={t.durationMs} />
            <View style={{ flexDirection: 'row' }}>
              <PainTag on={t.painDiscomfort === true} onPress={onToggleFlag ? () => onToggleFlag(t.uri) : undefined} disabled={disabled} />
            </View>
          </View>
          <Pressable onPress={() => onRemove(t.uri)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Remove this voice note" disabled={disabled}
            style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: hexA(C.red, 0.1), borderWidth: 1, borderColor: hexA(C.red, 0.35) }}>
            <Icon name="trash" size={13} color={C.red} strokeWidth={2.2} />
          </Pressable>
        </View>
      ))}
      {left > 0 ? (
        <>
          <View style={{ gap: 7, padding: 11, borderRadius: 12, backgroundColor: hexA(C.red, pain ? 0.08 : 0.04), borderWidth: 1, borderColor: hexA(C.red, pain ? 0.4 : 0.18) }}>
            <Body style={{ fontSize: 12.5, fontFamily: F.bodySemi, color: '#fff', lineHeight: 17 }}>{PAIN_TITLE}</Body>
            <Pressable onPress={() => setPain((p) => !p)} disabled={disabled || rec.recording} hitSlop={8} accessibilityRole="checkbox" accessibilityState={{ checked: pain }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
              <View style={{ width: 20, height: 20, borderRadius: 6, alignItems: 'center', justifyContent: 'center', borderWidth: pain ? 0 : 2, borderColor: 'rgba(255,255,255,0.3)', backgroundColor: pain ? C.red : 'transparent' }}>
                {pain ? <Icon path="M20 6 9 17l-5-5" size={12} color="#fff" strokeWidth={3} /> : null}
              </View>
              <Body style={{ flex: 1, fontSize: 12, color: pain ? '#FF9B8F' : C.ink3 }}>{PAIN_CHECKBOX}</Body>
            </Pressable>
            <Body style={{ fontSize: 10, color: C.muted3, lineHeight: 14 }}>Tick it before you record; the answer is saved with that note.</Body>
          </View>
          <VoiceTapButton recording={rec.recording} recMs={rec.recMs} maxMs={SESSION_VOICE_MAX_MS} onStart={rec.start} onStop={() => rec.finish(true)} accent={ACCENT}
            label={takes.length || savedCount ? 'Record another note' : 'Record voice note'} disabled={disabled || busy} />
        </>
      ) : (
        <Body style={{ fontSize: 11, color: C.muted3 }}>This session has the maximum of {SESSION_VOICE_MAX_NOTES} voice notes.</Body>
      )}
      {!rec.recording && hint ? <Body style={{ fontSize: 10.5, color: C.muted3, lineHeight: 15 }}>{hint}</Body> : null}
    </View>
  );
}

/** Flip the pain / discomfort answer on one pending take (hosts keep the takes in state). */
export const toggleTakeFlag = (takes: PendingVoiceTake[], uri: string): PendingVoiceTake[] =>
  takes.map((t) => (t.uri === uri ? { ...t, painDiscomfort: !t.painDiscomfort } : t));

/* ---------- one player for all of a session's notes ---------- */
function PlaylistInner({ urls, notes }: { urls: string[]; notes: SessionVoiceNote[] }) {
  const playlist = useAudioPlaylist({ sources: urls.map((uri) => ({ uri })), updateInterval: 250 });
  const status = useAudioPlaylistStatus(playlist);
  const [started, setStarted] = React.useState(false);
  const durations = notes.map((n) => n.duration_sec * 1000);
  const totalMs = durations.reduce((a, b) => a + b, 0);
  const idx = Math.min(Math.max(0, status?.currentIndex ?? 0), notes.length - 1);
  // Position across the whole session = finished notes + the current note's clock
  // (the file's own duration once known, else the recorded one).
  const curDurMs = status?.duration ? status.duration * 1000 : durations[idx] ?? 0;
  const beforeMs = durations.slice(0, idx).reduce((a, b) => a + b, 0);
  const posMs = Math.min(totalMs, beforeMs + Math.min(curDurMs, (status?.currentTime ?? 0) * 1000));
  const playing = !!status?.playing;
  const finished = !!status?.didJustFinish && idx === notes.length - 1;

  React.useEffect(() => {
    // Back to the first note when the last one ends, ready for another listen.
    if (finished) { try { playlist.pause(); playlist.skipTo(0); playlist.seekTo(0); } catch { /* released */ } }
  }, [finished]);

  const toggle = async () => {
    try {
      if (!started) { await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }); setStarted(true); }
      if (playlist.playing) playlist.pause(); else playlist.play();
    } catch (e: any) {
      Alert.alert('Playback failed', e?.message ?? 'Could not play these voice notes.');
    }
  };
  const pct = totalMs > 0 ? Math.min(1, posMs / totalMs) : 0;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 4 }}>
      <Pressable onPress={toggle} hitSlop={8} accessibilityRole="button" accessibilityLabel={playing ? 'Pause voice notes' : 'Play voice notes'}
        style={{ width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: hexA(ACCENT, 0.16), borderWidth: 1, borderColor: hexA(ACCENT, 0.45) }}>
        {playing
          ? <View style={{ flexDirection: 'row', gap: 3 }}><View style={{ width: 3, height: 13, borderRadius: 1.5, backgroundColor: ACCENT }} /><View style={{ width: 3, height: 13, borderRadius: 1.5, backgroundColor: ACCENT }} /></View>
          : <Icon name="chevRight" size={16} color={ACCENT} strokeWidth={2.6} />}
      </Pressable>
      <View style={{ flex: 1, gap: 5 }}>
        <View style={{ height: 4, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden' }}>
          <View style={{ width: `${pct * 100}%`, height: 4, backgroundColor: ACCENT }} />
        </View>
        <Mono style={{ fontSize: 8.5, color: C.muted2 }}>
          {clockOf(posMs)} / {clockOf(totalMs)} · NOTE {idx + 1} OF {notes.length}{status?.isBuffering ? ' · LOADING' : ''}
        </Mono>
      </View>
    </View>
  );
}

export function SessionVoicePlaylistPlayer({ notes }: { notes: SessionVoiceNote[] }) {
  const urlsQ = useSignedSessionVoiceUrls(notes.map((n) => n.path));
  const urls = (urlsQ.data ?? []).filter(Boolean);
  const totalMs = notes.reduce((a, n) => a + n.duration_sec * 1000, 0);
  if (!notes.length) return null;
  return (
    <ReplayMask>
      <View style={{ padding: 11, borderRadius: 13, backgroundColor: hexA(ACCENT, 0.07), borderWidth: 1, borderColor: hexA(ACCENT, 0.3), gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon name="mic" size={12} color={ACCENT} strokeWidth={2.2} />
          <Mono style={{ flex: 1, fontSize: 8.5, letterSpacing: 0.8, color: ACCENT }}>VOICE NOTES · {notes.length} · {clockOf(totalMs)}</Mono>
          {hasPainNote(notes) ? <PainTag on /> : null}
        </View>
        {urlsQ.isError ? (
          <Body style={{ fontSize: 11, color: C.red }}>Couldn't load the voice notes. Pull to refresh and try again.</Body>
        ) : urls.length !== notes.length ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 }}>
            <ActivityIndicator size="small" color={ACCENT} />
            <Body style={{ fontSize: 11, color: C.muted3 }}>Preparing {notes.length === 1 ? 'the note' : 'the notes'}…</Body>
          </View>
        ) : (
          <PlaylistInner key={urls.join('|')} urls={urls} notes={notes} />
        )}
        <Body style={{ fontSize: 10, color: C.muted3 }} numberOfLines={3}>
          {notes.map((n, i) => `${i + 1}. ${n.recorded_by_name ?? 'Trainer'}${n.recorded_at ? ` · ${new Date(n.recorded_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' })}` : ''}${n.pain_discomfort ? ' · pain reported' : ''}`).join('   ')}
        </Body>
      </View>
    </ReplayMask>
  );
}

/* ---------- Today's Roster sheet: listen + add more ---------- */
export type SessionVoiceSheetInfo = { workoutSessionId: string; clientId: string; clientName: string; notes: SessionVoiceNote[] } | null;

export function SessionVoiceSheet({ info, userId, onClose }: { info: SessionVoiceSheetInfo; userId: string; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const invalidate = useInvalidateSessionVoice();
  const [takes, setTakes] = React.useState<PendingVoiceTake[]>([]);
  const [saving, setSaving] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  React.useEffect(() => { if (info) { setTakes([]); setErr(null); setSaving(false); } }, [info?.workoutSessionId]);

  const close = () => {
    if (saving) return;
    takes.forEach((t) => discardTake(t.uri));
    setTakes([]);
    onClose();
  };
  const save = async () => {
    if (!info || !takes.length || saving) return;
    setSaving(true); setErr(null);
    let queued = 0, synced = 0;
    try {
      for (const t of takes) {
        const res = await queueSessionVoiceNote(
          { workoutSessionId: info.workoutSessionId, clientId: info.clientId, userId, uri: t.uri, durationMs: t.durationMs, source: 'roster', painDiscomfort: t.painDiscomfort === true },
          `${info.clientName} · voice note`,
        );
        if (res.status === 'failed') { setErr(res.error ?? 'The server rejected this note.'); setSaving(false); return; }
        if (res.status === 'queued') queued++; else synced++;
      }
      setTakes([]);
      invalidate();
      onClose();
      if (queued) Alert.alert('Saved on this device', `${queued} voice note${queued === 1 ? '' : 's'} will upload when you are back online.`);
    } finally { setSaving(false); }
  };

  return (
    <Modal visible={!!info} transparent animationType="slide" onRequestClose={close}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Close" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.62)' }} />
        <ReplayMask style={{ maxHeight: '88%' }}>
          <View style={{ backgroundColor: '#0E0A09', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: hexA(ACCENT, 0.25), paddingHorizontal: 18, paddingTop: 14, paddingBottom: insets.bottom + 18, flexShrink: 1 }}>
            <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 14 }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: hexA(ACCENT, 0.14), borderWidth: 1, borderColor: hexA(ACCENT, 0.35), alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="mic" size={18} color={ACCENT} strokeWidth={2.1} />
              </View>
              <View style={{ flex: 1 }}>
                <Serif style={{ fontSize: 19 }}>Voice notes</Serif>
                <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 2 }} numberOfLines={1}>{info?.clientName ?? ''} · today's session</Body>
              </View>
              <Pressable onPress={close} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close" style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="close" size={14} color={C.muted} strokeWidth={2.3} />
              </Pressable>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12, paddingBottom: 6 }}>
              {info?.notes.length ? (
                <SessionVoicePlaylistPlayer notes={info.notes} />
              ) : (
                <Body style={{ fontSize: 12, color: C.muted3 }}>No voice notes saved on this session yet.</Body>
              )}
              <Mono style={{ fontSize: 9, letterSpacing: 0.8, color: C.muted3 }}>ADD A NOTE</Mono>
              <VoiceNotesComposer takes={takes} onAdd={(t) => setTakes((x) => [...x, t])} onRemove={(uri) => { discardTake(uri); setTakes((x) => x.filter((t) => t.uri !== uri)); }}
                onToggleFlag={(uri) => setTakes((x) => toggleTakeFlag(x, uri))}
                savedCount={info?.notes.length ?? 0} disabled={saving}
                hint="Speak the note about this session. It is added to the session's notes and plays together with them." />
              {err ? <Body style={{ fontSize: 12, color: C.red }}>{err}</Body> : null}
              <Pressable onPress={save} disabled={!takes.length || saving} accessibilityRole="button"
                style={({ pressed }) => ({ opacity: !takes.length || saving ? 0.45 : pressed ? 0.85 : 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 14, backgroundColor: hexA(ACCENT, 0.18), borderWidth: 1, borderColor: hexA(ACCENT, 0.5) })}>
                {saving ? <ActivityIndicator size="small" color={ACCENT} /> : <Icon name="checks" size={15} color={ACCENT} strokeWidth={2.6} />}
                <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: ACCENT }}>{saving ? 'Saving…' : takes.length > 1 ? `Save ${takes.length} notes` : 'Save note'}</Text>
              </Pressable>
            </ScrollView>
          </View>
        </ReplayMask>
      </View>
    </Modal>
  );
}

/* ---------- My Crew, Tomorrow's Plan: the client's latest session notes ---------- */
export type LatestVoiceInfo = { name: string; latest: ClientLatestVoice } | null;

const dayLabel = (ymd: string) => new Date(`${ymd}T00:00:00+05:30`).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true });
const shortDay = (ymd: string) => new Date(`${ymd}T00:00:00+05:30`).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' }).toUpperCase();

/** True when any note of the client's latest session day was recorded with the pain box ticked. */
export const latestHasPain = (latest: ClientLatestVoice | null | undefined): boolean =>
  !!latest && latest.sessions.some((s) => hasPainNote(s.notes));

/** Compact chip on a plan row: "NOTES · 30 SEP" (the client's latest session day with notes);
    red "PAIN · 30 SEP" when a note of that day reported pain or discomfort. */
export function LatestVoiceChip({ latest, onPress }: { latest: ClientLatestVoice; onPress: () => void }) {
  const n = latest.sessions.reduce((a, s) => a + s.notes.length, 0);
  const pain = latestHasPain(latest);
  const col = pain ? C.red : ACCENT;
  return (
    <Pressable hitSlop={10} onPress={onPress} accessibilityRole="button" accessibilityLabel={`Play ${n} voice notes from ${dayLabel(latest.day)}${pain ? ', pain or discomfort reported' : ''}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 999, backgroundColor: hexA(col, 0.12), borderWidth: 1, borderColor: hexA(col, 0.45) }}>
      <Icon name={pain ? 'alert' : 'mic'} size={9} color={col} strokeWidth={2.2} />
      <Mono style={{ fontSize: 8, letterSpacing: 0.5, color: col }}>{pain ? 'PAIN' : 'NOTES'} · {shortDay(latest.day)}</Mono>
    </Pressable>
  );
}

/** The red line under a day's notes when any of them reported pain or discomfort. */
function PainLine({ when }: { when: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 7, paddingHorizontal: 10, borderRadius: 10, backgroundColor: hexA(C.red, 0.09), borderWidth: 1, borderColor: hexA(C.red, 0.35) }}>
      <Icon name="alert" size={12} color={C.red} strokeWidth={2.3} />
      <Body style={{ flex: 1, fontSize: 11.5, color: '#FF9B8F', lineHeight: 15 }}>Pain or discomfort was reported {when}. Listen before the next session.</Body>
    </View>
  );
}

/** Inline block for the workout health check-in popup (5 Oct 2026): the client's most recent
    session day with voice notes, only when it is within the last `days` days; one player per
    session with its time, name and the recorder; otherwise the plain "no audio" sentence. */
export function LatestVoiceInline({ latest, loading, days = 5 }: { latest: ClientLatestVoice | null | undefined; loading?: boolean; days?: number }) {
  const recent = !!latest && voiceDayWithin(latest.day, days);
  const total = recent ? latest!.sessions.reduce((a, s) => a + s.notes.length, 0) : 0;
  return (
    <View style={{ padding: 15, borderRadius: 18, backgroundColor: hexA(ACCENT, 0.05), borderWidth: 1, borderColor: hexA(ACCENT, 0.2), gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
        <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: hexA(ACCENT, 0.13), alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="mic" size={15} color={ACCENT} strokeWidth={2} />
        </View>
        <View style={{ flex: 1 }}>
          <Body style={{ fontSize: 14.5, fontFamily: F.bodySemi, color: '#fff' }}>Last session voice notes</Body>
          <Mono style={{ fontSize: 8.5, letterSpacing: 0.8, color: recent ? ACCENT : C.muted3, marginTop: 2 }}>
            {recent ? `${dayLabel(latest!.day).toUpperCase()} · ${total} NOTE${total === 1 ? '' : 'S'}` : `LAST ${days} DAYS`}
          </Mono>
        </View>
      </View>
      {loading && !latest ? (
        <ActivityIndicator color={ACCENT} />
      ) : recent ? (
        <>
        {latestHasPain(latest) ? <PainLine when="in the last session" /> : null}
        {latest!.sessions.map((s, i) => {
          const by = [...new Set(s.notes.map((n) => n.recorded_by_name).filter(Boolean))].join(', ');
          return (
            <View key={s.id} style={{ gap: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Mono style={{ fontSize: 8, letterSpacing: 0.5, color: C.muted3 }}>SESSION {i + 1} OF {latest!.sessions.length}</Mono>
                <Body style={{ flex: 1, fontSize: 12, color: C.ink3 }} numberOfLines={1}>
                  {dayLabel(latest!.day)} · {timeLabel(s.scheduled_at)}{s.session_name ? ` · ${s.session_name}` : s.session_type ? ` · ${s.session_type}` : ''}
                </Body>
              </View>
              {by ? <Mono style={{ fontSize: 8.5, letterSpacing: 0.5, color: ACCENT }}>LOGGED BY {by.toUpperCase()}</Mono> : null}
              <SessionVoicePlaylistPlayer notes={s.notes} />
            </View>
          );
        })}
        </>
      ) : (
        <Body style={{ fontSize: 12.5, color: C.muted2, lineHeight: 18 }}>There is no audio present in any of the last {days} days' sessions.</Body>
      )}
    </View>
  );
}

/** Centred popup: one player per session of that day, newest day only. Mount it inside the
    parent sheet's Modal tree (never as a sibling Modal). */
export function LatestVoicePopup({ info, onClose }: { info: LatestVoiceInfo; onClose: () => void }) {
  const total = info ? info.latest.sessions.reduce((a, s) => a + s.notes.length, 0) : 0;
  return (
    <Modal visible={!!info} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'center', padding: 22 }}>
        <Pressable onPress={onClose} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.72)' }} />
        {info ? (
          <ReplayMask style={{ maxHeight: '86%' }}>
            <View style={{ borderRadius: 18, backgroundColor: '#12100E', borderWidth: 1, borderColor: hexA(ACCENT, 0.4), padding: 15, gap: 12, flexShrink: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: hexA(ACCENT, 0.14), borderWidth: 1, borderColor: hexA(ACCENT, 0.4), alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="mic" size={15} color={ACCENT} strokeWidth={2} />
                </View>
                <View style={{ flex: 1 }}>
                  <Body style={{ fontSize: 15, fontFamily: F.bodySemi, color: '#fff' }} numberOfLines={1}>{info.name}</Body>
                  <Mono style={{ fontSize: 8.5, letterSpacing: 0.8, color: ACCENT, marginTop: 2 }}>
                    LAST SESSION NOTES · {dayLabel(info.latest.day).toUpperCase()} · {total} NOTE{total === 1 ? '' : 'S'}
                  </Mono>
                </View>
                <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close" style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="close" size={13} color={C.muted} strokeWidth={2.3} />
                </Pressable>
              </View>
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
                {latestHasPain(info.latest) ? <PainLine when={`on ${dayLabel(info.latest.day)}`} /> : null}
                {info.latest.sessions.map((s, i) => {
                  const by = [...new Set(s.notes.map((n) => n.recorded_by_name).filter(Boolean))].join(', ');
                  return (
                    <View key={s.id} style={{ gap: 6 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Mono style={{ fontSize: 8, letterSpacing: 0.5, color: C.muted3 }}>SESSION {i + 1} OF {info.latest.sessions.length}</Mono>
                        <Body style={{ flex: 1, fontSize: 12, color: C.ink3 }} numberOfLines={1}>
                          {timeLabel(s.scheduled_at)}{s.session_name ? ` · ${s.session_name}` : s.session_type ? ` · ${s.session_type}` : ''}{by ? ` · by ${by}` : ''}
                        </Body>
                      </View>
                      <SessionVoicePlaylistPlayer notes={s.notes} />
                    </View>
                  );
                })}
                <Body style={{ fontSize: 10.5, color: C.muted3, lineHeight: 15 }}>Only the most recent day with notes is shown; older sessions are on the client's Sessions list.</Body>
              </ScrollView>
            </View>
          </ReplayMask>
        ) : null}
      </View>
    </Modal>
  );
}
