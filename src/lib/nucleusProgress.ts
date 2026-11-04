/* Odds Nucleus staff reading progress (4 Nov 2026; owner: "I want to see who read that article"). The ONE write of
   the feature: record_library_staff_progress (hub-track migration 20261102100000, live 2 Nov 2026) puts a staff row
   into the member app's longevity_resource_progress so the web Education Content Engagement page lists trainers and
   doctors. The reading clock lives here (useReadingSession): one open record, the seconds every 15 s and on leave,
   foreground only; the server keeps the furthest progress and marks Finished at 90 percent. Offline the call waits
   in the outbox (kind library-progress). A failed call never blocks reading or playback. The phone's saved / recent /
   resume state (nucleusQueries.ts) is untouched. Plan: docs/nucleus-staff-progress-plan.md.
   The pure part (buildProgressCall, isPermanentLibraryRefusal, clockDelta) is tested in node
   (tests/rules/nucleus_progress_test.js) and copied byte for byte to iOS. */
import React from 'react';
import { AppState } from 'react-native';
import { supabase } from './supabase';
import { withTimeout, NET_MS } from './withTimeout';
import { enqueueOutbox, getIsOnline } from './offline';

export type ReadMedium = 'read' | 'audio' | 'video';
export type ProgressSample = { progress: number; position?: number | null; duration?: number | null };
export type ProgressCall = {
  p_resource_id: string;
  p_medium: ReadMedium;
  p_position: number | null;
  p_duration: number | null;
  p_seconds_delta: number;
  p_progress: number;
  p_opened: boolean;
};
/** The 15 s cadence of the clock and the smallest delta worth a call. */
export const TICK_MS = 15_000;
export const MIN_DELTA_SECONDS = 1;
export const MAX_DELTA_SECONDS = 3600;

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);
const secs = (v: number | null | undefined): number | null => (v == null || !Number.isFinite(v) ? null : Math.max(0, Math.round(v)));

/** The RPC's named parameters. read = no position / duration; progress clamped 0..1; delta 0..3600 whole seconds. */
export const buildProgressCall = (o: { pieceId: string; medium: ReadMedium; sample: ProgressSample; secondsDelta: number; opened: boolean }): ProgressCall => {
  const media = o.medium !== 'read';
  const position = media ? secs(o.sample.position) : null;
  const duration = media ? secs(o.sample.duration) : null;
  const progress = media && position != null && duration ? clamp01(position / duration) : clamp01(o.sample.progress);
  return {
    p_resource_id: o.pieceId, p_medium: o.medium, p_position: position, p_duration: duration,
    p_seconds_delta: Math.max(0, Math.min(MAX_DELTA_SECONDS, Math.round(Number.isFinite(o.secondsDelta) ? o.secondsDelta : 0))),
    p_progress: Math.round(progress * 1000) / 1000, p_opened: !!o.opened,
  };
};
/** The server's final answers: nothing to retry (an unpublished piece, a member login, a bad medium, no session). */
export const isPermanentLibraryRefusal = (message: unknown): boolean => /LIBRARY_(NOT_PUBLISHED|STAFF_ONLY|BAD_MEDIUM|SIGN_IN)/.test(String(message ?? ''));
export const isNetworkError = (e: unknown): boolean => /network|fetch|timeout|took too long|ECONN|ENOTFOUND|offline/i.test(String((e as any)?.message ?? (e as any)?.name ?? ''));
/** Whole seconds between two clock readings; never negative, never more than the cap. */
export const clockDelta = (fromMs: number | null, toMs: number): number => (fromMs == null ? 0 : Math.max(0, Math.min(MAX_DELTA_SECONDS, Math.round((toMs - fromMs) / 1000))));

/* ---------- the call ---------- */
async function rpcProgress(call: ProgressCall): Promise<void> {
  const { error } = await withTimeout(Promise.resolve((supabase.rpc as any)('record_library_staff_progress', call)) as Promise<{ data: any; error: any }>, NET_MS, 'Reading progress');
  if (error) throw Object.assign(new Error(error.message ?? 'Reading progress'), { code: error.code });
}
/** Sends the record, or queues it offline. Never throws: a failed call must never block reading or playback. */
export async function recordStaffProgress(call: ProgressCall, label: string): Promise<void> {
  try {
    if (!getIsOnline()) { await enqueueOutbox('library-progress', label, call, { autoDrain: false }); return; }
    await rpcProgress(call);
  } catch (e: any) {
    const msg = String(e?.message ?? '');
    if (isPermanentLibraryRefusal(msg)) { console.warn('[nucleus] reading progress refused:', msg); return; }
    if (/PGRST202|could not find the function/i.test(msg)) { console.warn('[nucleus] reading progress: the server function is missing'); return; }
    if (isNetworkError(e)) { try { await enqueueOutbox('library-progress', label, call, { autoDrain: false }); } catch { /* storage unavailable */ } return; }
    console.warn('[nucleus] reading progress not written:', msg);
  }
}
/** The outbox drain's entry point (offline.ts): a final refusal drops the item, a network error keeps it. */
export async function submitQueuedProgress(payload: any): Promise<void> {
  try { await rpcProgress(payload as ProgressCall); }
  catch (e: any) {
    const msg = String(e?.message ?? '');
    if (isPermanentLibraryRefusal(msg) || /PGRST202|could not find the function/i.test(msg)) return; // final: drop the item
    throw e;
  }
}

/* ---------- the reading clock ---------- */
/** Owns one piece's clock for one medium: the open record once `enabled`, a 15 s tick with the seconds since the
    previous call while `active` (the article on screen, or the player playing) and the app is in the foreground, a
    flush on background, on `active` turning false and on unmount. `sample()` is read at every call, so the screen
    feeds the furthest scroll fraction or the player's position without re-rendering. */
export function useReadingSession(pieceId: string, medium: ReadMedium, enabled: boolean, active: boolean, sample: () => ProgressSample, label: string) {
  const sampleRef = React.useRef(sample); sampleRef.current = sample;
  const labelRef = React.useRef(label); labelRef.current = label;
  const openedRef = React.useRef<string | null>(null);   // the piece id whose open record went out
  const runningSince = React.useRef<number | null>(null);
  const foreground = React.useRef(AppState.currentState === 'active' || AppState.currentState == null);
  const lastSentProgress = React.useRef(-1);

  const send = (delta: number, opened: boolean) => {
    const call = buildProgressCall({ pieceId, medium, sample: sampleRef.current(), secondsDelta: delta, opened });
    if (!opened && delta < MIN_DELTA_SECONDS && call.p_progress <= lastSentProgress.current) return;
    lastSentProgress.current = Math.max(lastSentProgress.current, call.p_progress);
    void recordStaffProgress(call, labelRef.current);
  };
  const start = () => { if (runningSince.current == null) runningSince.current = Date.now(); };
  const stop = (): number => { const d = clockDelta(runningSince.current, Date.now()); runningSince.current = null; return d; };

  // the open record, once per piece and medium
  React.useEffect(() => {
    if (!enabled || openedRef.current === pieceId) return;
    openedRef.current = pieceId;
    lastSentProgress.current = -1;
    send(0, true);
  }, [pieceId, enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  // the clock: runs while enabled, active and in the foreground
  React.useEffect(() => {
    if (!enabled || !active) return;
    if (foreground.current) start();
    const t = setInterval(() => { if (!foreground.current || runningSince.current == null) return; const d = stop(); start(); send(d, false); }, TICK_MS);
    const sub = AppState.addEventListener('change', (s) => {
      const fg = s === 'active';
      if (fg === foreground.current) return;
      foreground.current = fg;
      if (fg) start(); else send(stop(), false);
    });
    return () => { clearInterval(t); sub.remove(); send(stop(), false); };
  }, [pieceId, enabled, active]); // eslint-disable-line react-hooks/exhaustive-deps
}
