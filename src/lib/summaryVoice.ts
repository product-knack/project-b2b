/* The Sarvam voice for the client summaries (15 Oct 2026, user: "in app it uses the
   device voice, I want to use the Sarvam API as in my web b2b app"). Mirrors the web
   card (hub-track src/components/trainer/ClientHealthSummaryCard.tsx): a play press
   asks the edge function speak-client-summary for the recording of one summary of
   one briefing day (the function renders the script once per version through Sarvam
   bulbul:v3 / priya into the private bucket client-health-summary-audio and returns
   one-hour signed MP3 part URLs; a second play only signs). The parts are played
   back to back on ONE expo-audio player (replace the source when a part finishes).
   On ANY failure (function, network, player) the old device voice (expo-speech)
   reads the script instead, with a notice and a "device voice" label, so the
   mandatory listen gate can always be cleared. The listen trail is logged by the
   caller before play, as before.

   The controller is plain code with injected dependencies so the sequencing
   (parts, fallback, stop, pause) is unit-tested in node; useSummaryVoice wires it
   to expo-audio, expo-speech and Supabase. */
import React from 'react';
import { Platform } from 'react-native';
import * as Speech from 'expo-speech';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { supabase } from './supabase';
import { invokeWithTimeout } from './withTimeout';
import { splitForSpeech, type Which } from './clientHealthSummary';

export type VoiceSource = 'sarvam' | 'device';
export type VoicePhase = 'idle' | 'preparing' | 'playing' | 'paused';
export type SummaryVoiceState = {
  /** Which summary is being prepared / played (the caller's id, e.g. 'weekly'). */
  id: string | null;
  phase: VoicePhase;
  source: VoiceSource | null;
  /** Why the device voice is speaking instead of the recording; kept until the next play or stop. */
  notice: string | null;
  /** 1-based part being played and the part count (recording only). */
  part: number;
  parts: number;
};
export const IDLE_VOICE: SummaryVoiceState = { id: null, phase: 'idle', source: null, notice: null, part: 0, parts: 0 };

export type SummaryAudioRequest = { clientId: string; which: Which; date?: string | null };
export type PlayRequest = SummaryAudioRequest & { script: string };
export type PlayCallbacks = {
  /** The whole summary was heard to the end (recording or device voice). */
  onDone?: () => void;
  /** Neither the recording nor the device voice could speak. */
  onError?: (message: string) => void;
};

/* ---------- injected dependencies (the real ones are below) ---------- */
export type PlayerStatus = { isLoaded?: boolean; playing?: boolean; didJustFinish?: boolean; error?: string | null };
export type PlayerLike = {
  play(): void;
  pause(): void;
  replace(source: { uri: string }): void;
  remove(): void;
  addListener(event: 'playbackStatusUpdate', cb: (st: PlayerStatus) => void): { remove(): void };
};
export type DeviceSpeechCallbacks = { onDone: () => void; onError: (message: string) => void; onPause?: () => void; onResume?: () => void };
export type SummaryVoiceDeps = {
  getAudio: (req: SummaryAudioRequest) => Promise<string[]>;
  makePlayer: (uri: string) => PlayerLike;
  prepareAudio: () => Promise<void>;
  deviceSpeak: (text: string, cb: DeviceSpeechCallbacks) => void;
  deviceStop: () => void;
  devicePause?: () => void;
  deviceResume?: () => void;
  deviceCanPause: boolean;
  /** How long a part may sit without ever reporting `playing` before the recording is given up on. */
  stallMs?: number;
  setTimer?: (fn: () => void, ms: number) => any;
  clearTimer?: (t: any) => void;
};

const msgOf = (e: any): string => String(e?.message ?? e ?? 'unknown error');

export const CLOUD_UNAVAILABLE = (why: string) => `Cloud voice unavailable (${why}); using this device's voice.`;
export const RECORDING_FAILED = (why: string) => `The recording could not play (${why}); using this device's voice.`;
export const STALL_MS = 15_000;

/* Every card, strip and gate owns a controller, so one voice at a time is enforced
   here: a play stops whatever any other controller is speaking (user, 15 Oct 2026:
   two summaries played together after pressing Play on a second card). */
const speaking = new Set<() => void>();

/* ---------- the controller ---------- */
export function createSummaryVoice(deps: SummaryVoiceDeps, onState: (s: SummaryVoiceState) => void) {
  // Bumped on every play / stop / finish so callbacks of an older run are ignored.
  let run = 0;
  let state: SummaryVoiceState = IDLE_VOICE;
  let player: PlayerLike | null = null;
  let sub: { remove(): void } | null = null;
  let stall: any = null;
  const setT = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearT = deps.clearTimer ?? ((t: any) => clearTimeout(t));
  const stallMs = deps.stallMs ?? STALL_MS;

  const emit = (patch: Partial<SummaryVoiceState>) => { state = { ...state, ...patch }; onState(state); };
  const clearStall = () => { if (stall != null) { clearT(stall); stall = null; } };
  const armStall = (myRun: number, onStall: () => void) => {
    clearStall();
    stall = setT(() => { stall = null; if (myRun === run) onStall(); }, stallMs);
  };
  const releasePlayer = () => {
    clearStall();
    try { sub?.remove(); } catch { /* gone */ }
    // Silence first: a released native player can keep sounding until it is collected.
    try { player?.pause(); } catch { /* released */ }
    try { player?.remove(); } catch { /* released */ }
    sub = null;
    player = null;
  };

  const stop = () => {
    run++;
    speaking.delete(stop);
    releasePlayer();
    deps.deviceStop();
    emit({ ...IDLE_VOICE });
  };
  /** A run ended on its own (heard to the end, or nothing could speak). */
  const finished = () => { run++; speaking.delete(stop); };

  /** The device voice reads the script (the fallback); `notice` says why. */
  const speakDevice = (myRun: number, id: string, script: string, cb: PlayCallbacks | undefined, notice: string | null) => {
    releasePlayer();
    emit({ id, phase: 'playing', source: 'device', notice, part: 0, parts: 0 });
    deps.deviceSpeak(script, {
      onDone: () => { if (myRun !== run) return; finished(); emit({ ...IDLE_VOICE, notice }); cb?.onDone?.(); },
      onError: (m) => { if (myRun !== run) return; finished(); emit({ ...IDLE_VOICE, notice }); cb?.onError?.(m); },
      onPause: () => { if (myRun === run) emit({ phase: 'paused' }); },
      onResume: () => { if (myRun === run) emit({ phase: 'playing' }); },
    });
  };

  /** The recording's parts, back to back on one player. */
  const playParts = async (myRun: number, id: string, req: PlayRequest, urls: string[], cb: PlayCallbacks | undefined) => {
    try { await deps.prepareAudio(); } catch { /* the player decides */ }
    if (myRun !== run) return;
    let i = 0;
    let started = false; // the current part reported `playing` at least once
    let fellBack = false;
    const fallback = (why: string) => {
      if (myRun !== run || fellBack) return;
      fellBack = true;
      speakDevice(myRun, id, req.script, cb, RECORDING_FAILED(why));
    };
    let p: PlayerLike;
    try { p = deps.makePlayer(urls[0]); } catch (e) { fallback(msgOf(e)); return; }
    player = p;
    emit({ id, phase: 'playing', source: 'sarvam', notice: null, part: 1, parts: urls.length });
    sub = p.addListener('playbackStatusUpdate', (st) => {
      if (myRun !== run || fellBack) return;
      if (st.error) { fallback(st.error); return; }
      if (st.playing && !started) { started = true; clearStall(); }
      // A finish counts once per part: only after the part was heard playing (a repeated
      // end-of-part status while the next source loads must not skip a part).
      if (st.didJustFinish && started) {
        started = false;
        i++;
        if (i < urls.length) {
          emit({ part: i + 1 });
          armStall(myRun, () => fallback('no sound'));
          try { p.replace({ uri: urls[i] }); p.play(); } catch (e) { fallback(msgOf(e)); }
        } else {
          finished();
          releasePlayer();
          emit({ ...IDLE_VOICE });
          cb?.onDone?.();
        }
      }
    });
    armStall(myRun, () => fallback('no sound'));
    try { p.play(); } catch (e) { fallback(msgOf(e)); }
  };

  const play = (id: string, req: PlayRequest, cb?: PlayCallbacks) => {
    // One voice at a time across the app: silence every other controller, then our own run.
    for (const other of Array.from(speaking)) if (other !== stop) other();
    stop();
    speaking.add(stop);
    const myRun = run;
    emit({ id, phase: 'preparing', source: null, notice: null, part: 0, parts: 0 });
    deps.getAudio(req)
      .then((urls) => {
        if (myRun !== run) return;
        if (!urls?.length) throw new Error('No recording came back');
        return playParts(myRun, id, req, urls, cb);
      })
      .catch((e) => {
        if (myRun !== run) return;
        speakDevice(myRun, id, req.script, cb, CLOUD_UNAVAILABLE(msgOf(e)));
      });
  };

  const canPause = () => state.source === 'sarvam' || (state.source === 'device' && deps.deviceCanPause);
  const pause = () => {
    if (state.phase !== 'playing') return;
    if (state.source === 'sarvam') { try { player?.pause(); } catch { /* released */ } emit({ phase: 'paused' }); }
    else if (deps.deviceCanPause) { deps.devicePause?.(); emit({ phase: 'paused' }); }
  };
  const resume = () => {
    if (state.phase !== 'paused') return;
    if (state.source === 'sarvam') { try { player?.play(); } catch { /* released */ } emit({ phase: 'playing' }); }
    else if (deps.deviceCanPause) { deps.deviceResume?.(); emit({ phase: 'playing' }); }
  };

  return { play, stop, pause, resume, canPause, getState: () => state };
}

/* ---------- the real dependencies ---------- */
/** The first play of a new summary version renders through Sarvam (a long context script
    is several parts, rendered three at a time) before the URLs come back. */
export const SPEAK_FN_MS = 45_000;

/* functions.invoke can keep the anon-key Authorization header when the session was
   restored from storage, so the live access token is attached (same as clientQueries). */
async function fetchSummaryAudio(req: SummaryAudioRequest): Promise<string[]> {
  let { data } = await supabase.auth.getSession();
  if (!data.session) {
    await new Promise((r) => setTimeout(r, 450));
    ({ data } = await supabase.auth.getSession());
  }
  const token = data.session?.access_token;
  const { data: out, error } = await invokeWithTimeout('speak-client-summary', {
    body: { client_id: req.clientId, which: req.which, briefing_date: req.date ?? undefined },
    ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
  }, SPEAK_FN_MS);
  if (error) {
    let m = error?.message ?? 'unknown error';
    try {
      const ctx = (error as any).context;
      if (ctx && typeof ctx.json === 'function') m = (await ctx.json())?.error ?? m;
    } catch { /* keep the generic message */ }
    throw new Error(m);
  }
  const urls = Array.isArray(out?.urls) ? (out.urls as unknown[]).filter((u): u is string => typeof u === 'string' && !!u) : [];
  if (!urls.length) throw new Error(out?.error ?? 'No recording came back');
  return urls;
}

const CHUNK_MAX = 3500;
/** expo-speech, one utterance at a time; long scripts queued in sentence chunks (as useSpeech). */
function deviceSpeak(text: string, cb: DeviceSpeechCallbacks) {
  const nativeMax = typeof Speech.maxSpeechInputLength === 'number' && Speech.maxSpeechInputLength > 0 ? Speech.maxSpeechInputLength : CHUNK_MAX;
  const parts = splitForSpeech(text, Math.min(nativeMax, CHUNK_MAX));
  if (!parts.length) { cb.onError('Nothing to read.'); return; }
  let i = 0;
  let dead = false;
  const next = () => {
    if (dead) return;
    if (i >= parts.length) { cb.onDone(); return; }
    try {
      Speech.speak(parts[i++], {
        language: 'en-IN',
        rate: 1.0,
        onDone: next,
        onStopped: () => { dead = true; },
        onError: (e: any) => { dead = true; cb.onError(String(e?.message ?? e ?? 'The device could not speak.')); },
        onPause: () => cb.onPause?.(),
        onResume: () => cb.onResume?.(),
      });
    } catch (e: any) {
      dead = true;
      cb.onError(String(e?.message ?? 'The device could not speak.'));
    }
  };
  Speech.stop().catch(() => {});
  next();
}

const nativeDeps: SummaryVoiceDeps = {
  getAudio: fetchSummaryAudio,
  makePlayer: (uri) => createAudioPlayer({ uri }, { updateInterval: 500 }) as unknown as PlayerLike,
  prepareAudio: () => setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }),
  deviceSpeak,
  deviceStop: () => { Speech.stop().catch(() => {}); },
  devicePause: () => { Speech.pause().catch(() => {}); },
  deviceResume: () => { Speech.resume().catch(() => {}); },
  deviceCanPause: Platform.OS === 'ios',
};

/* ---------- the hook ---------- */
export function useSummaryVoice() {
  const [state, setState] = React.useState<SummaryVoiceState>(IDLE_VOICE);
  const ctl = React.useRef<ReturnType<typeof createSummaryVoice> | null>(null);
  if (!ctl.current) ctl.current = createSummaryVoice(nativeDeps, setState);
  React.useEffect(() => () => { ctl.current?.stop(); }, []);
  const c = ctl.current;
  return {
    /** The id being prepared or played (null when idle). */
    speakingId: state.phase === 'idle' ? null : state.id,
    /** The id whose recording is still being fetched. */
    busyId: state.phase === 'preparing' ? state.id : null,
    paused: state.phase === 'paused',
    source: state.source,
    notice: state.notice,
    part: state.part,
    parts: state.parts,
    /** The recording pauses on both platforms; the device voice only on iOS. */
    canPause: c.canPause(),
    play: c.play,
    stop: c.stop,
    pause: c.pause,
    resume: c.resume,
  };
}
export type SummaryVoice = ReturnType<typeof useSummaryVoice>;
