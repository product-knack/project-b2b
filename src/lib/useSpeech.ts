/* Device text-to-speech for the client summaries (expo-speech, SDK 57 docs
   https://docs.expo.dev/versions/v57.0.0/sdk/speech/). One utterance at a time;
   pause / resume exist on iOS only (Android has stop + play again). Long scripts
   are queued in sentence chunks (splitForSpeech). Stops on unmount. */
import React from 'react';
import { Platform } from 'react-native';
import * as Speech from 'expo-speech';
import { splitForSpeech } from './clientHealthSummary';

const CHUNK_MAX = 3500;
type Callbacks = { onDone?: () => void; onError?: (message: string) => void };

export function useSpeech() {
  const [speakingId, setSpeakingId] = React.useState<string | null>(null);
  const [paused, setPaused] = React.useState(false);
  // Bumped on every speak / stop so callbacks of an older utterance are ignored.
  const runRef = React.useRef(0);

  React.useEffect(() => () => { runRef.current++; Speech.stop().catch(() => {}); }, []);

  const stop = React.useCallback(() => {
    runRef.current++;
    setSpeakingId(null);
    setPaused(false);
    Speech.stop().catch(() => {});
  }, []);

  const speak = React.useCallback((id: string, text: string, cb?: Callbacks) => {
    const run = ++runRef.current;
    Speech.stop().catch(() => {});
    const nativeMax = typeof Speech.maxSpeechInputLength === 'number' && Speech.maxSpeechInputLength > 0 ? Speech.maxSpeechInputLength : CHUNK_MAX;
    const parts = splitForSpeech(text, Math.min(nativeMax, CHUNK_MAX));
    if (!parts.length) { cb?.onError?.('Nothing to read.'); return; }
    setSpeakingId(id);
    setPaused(false);
    let i = 0;
    const next = () => {
      if (run !== runRef.current) return;
      if (i >= parts.length) { setSpeakingId(null); setPaused(false); cb?.onDone?.(); return; }
      const part = parts[i++];
      try {
        Speech.speak(part, {
          language: 'en-IN',
          rate: 1.0,
          onDone: next,
          onStopped: () => { if (run === runRef.current) { runRef.current++; setSpeakingId(null); setPaused(false); } },
          onError: (e: any) => {
            if (run !== runRef.current) return;
            runRef.current++;
            setSpeakingId(null);
            setPaused(false);
            cb?.onError?.(String(e?.message ?? e ?? 'The device could not speak.'));
          },
          onPause: () => { if (run === runRef.current) setPaused(true); },
          onResume: () => { if (run === runRef.current) setPaused(false); },
        });
      } catch (e: any) {
        runRef.current++;
        setSpeakingId(null);
        setPaused(false);
        cb?.onError?.(String(e?.message ?? 'The device could not speak.'));
      }
    };
    next();
  }, []);

  const canPause = Platform.OS === 'ios';
  const pause = React.useCallback(() => { if (!canPause) return; setPaused(true); Speech.pause().catch(() => {}); }, [canPause]);
  const resume = React.useCallback(() => { if (!canPause) return; setPaused(false); Speech.resume().catch(() => {}); }, [canPause]);

  return { speakingId, paused, speak, stop, pause, resume, canPause };
}
