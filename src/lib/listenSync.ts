/* Writing the spoken-summary listens (3 Nov 2026, owner: "no network must work the same"). The Play entry and the
   progress of a listen go to the phone's record first (listenLocal.ts), then to the server: at once when online
   (log_summary_listen / log_summary_listen_progress with the real time and the briefing day), through the outbox
   when offline (kinds summary-listen / summary-listen-progress, drained with the workout logs, one queued progress
   per client, kind and build with the highest percent). A stale answer (the summary was rebuilt) drops the phone's
   record for that build. Nothing here blocks the voice: a failed write is logged and retried by the drain. */
import React from 'react';
import { Platform } from 'react-native';
import { supabase } from './supabase';
import { withTimeout, NET_MS } from './withTimeout';
import { enqueueOutbox, getIsOnline, getOutboxMine, updateOutboxItem } from './offline';
import { recordLocalListen, markLocalListenSynced, dropLocalListen } from './listenLocal';
import { generatedAtOf, summaryOf, type ClientHealthSummaryRow, type Which } from './clientHealthSummary';

export type ListenPlayPayload = { clientId: string; which: Which; version: number | null; generatedAt: string | null; briefingDate: string | null; at: string };
export type ListenProgressPayload = ListenPlayPayload & { percent: number };
const DEVICE = Platform.OS === 'ios' ? 'ios' : 'android';

const rpc = async (name: string, args: Record<string, unknown>, label: string): Promise<any> => {
  const { data, error } = await withTimeout(Promise.resolve((supabase.rpc as any)(name, args)) as Promise<{ data: any; error: any }>, NET_MS, label);
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  return data;
};

/** The server call for a Play entry (online now, or from the drain). */
export async function submitSummaryListen(p: ListenPlayPayload): Promise<void> {
  await rpc('log_summary_listen', { p_client_id: p.clientId, p_which: p.which, p_at: p.at, p_briefing_date: p.briefingDate, p_device: DEVICE }, 'Listen');
}
/** The server call for a percent; a stale answer drops the phone's record for that build. */
export async function submitSummaryListenProgress(p: ListenProgressPayload): Promise<{ stale: boolean }> {
  const d = await rpc('log_summary_listen_progress', {
    p_client_id: p.clientId, p_which: p.which, p_percent: Math.round(p.percent), p_version: p.version, p_at: p.at, p_briefing_date: p.briefingDate, p_device: DEVICE,
  }, 'Listen progress');
  if (d?.stale === true) { await dropLocalListen(p.clientId, p.which, p.generatedAt); return { stale: true }; }
  await markLocalListenSynced(p.clientId, p.which, p.generatedAt);
  return { stale: false };
}
/** The outbox drain's entry point (offline.ts processItem). A listen older than the server's 7-day window is dropped
    with the item (the server refuses it; nothing to retry). */
export async function submitQueuedListen(kind: 'summary-listen' | 'summary-listen-progress', payload: any): Promise<void> {
  try {
    if (kind === 'summary-listen') await submitSummaryListen(payload as ListenPlayPayload);
    else await submitSummaryListenProgress(payload as ListenProgressPayload);
  } catch (e: any) {
    if (/LISTEN_TOO_OLD|No summary on file|Not allowed to listen/.test(String(e?.message ?? ''))) return; // final: drop the item
    throw e;
  }
}

const isNetworkError = (e: any) => /network|fetch|timeout|took too long|ECONN|ENOTFOUND/i.test(String(e?.message ?? e?.name ?? ''));

/** Play: the phone's record (percent 0 for this build) and the server entry, queued when offline. */
export async function writeListenPlay(row: ClientHealthSummaryRow | null | undefined, clientId: string, which: Which): Promise<void> {
  const at = new Date().toISOString();
  const p: ListenPlayPayload = { clientId, which, version: summaryOf(row, which)?.version ?? null, generatedAt: generatedAtOf(row, which), briefingDate: row?.briefing_date ?? null, at };
  await recordLocalListen({ clientId, which, version: p.version, generatedAt: p.generatedAt, briefingDate: p.briefingDate, percent: 0, at });
  if (getIsOnline()) {
    try { await submitSummaryListen(p); return; } catch (e) { if (!isNetworkError(e)) throw e; }
  }
  await enqueueOutbox('summary-listen', `Listen · ${which === 'weekly' ? "This week's training" : 'Health context'}`, p, { autoDrain: false });
}

/** Progress: the phone's record first (best so far), then the server; offline, ONE queued item per client, kind and
    build that keeps the highest percent and the first time it reached the threshold. */
export async function writeListenProgress(row: ClientHealthSummaryRow | null | undefined, clientId: string, which: Which, percent: number): Promise<void> {
  const generatedAt = generatedAtOf(row, which);
  const rec = await recordLocalListen({ clientId, which, version: summaryOf(row, which)?.version ?? null, generatedAt, briefingDate: row?.briefing_date ?? null, percent });
  const p: ListenProgressPayload = { clientId, which, version: rec.version, generatedAt, briefingDate: rec.briefingDate, at: rec.heardAt ?? rec.at, percent: rec.percent };
  if (getIsOnline()) {
    try { await submitSummaryListenProgress(p); return; } catch (e) { if (!isNetworkError(e)) { console.warn('[listen] progress not written:', String((e as Error)?.message)); return; } }
  }
  const existing = getOutboxMine().find((i) => i.kind === 'summary-listen-progress' && i.status !== 'syncing'
    && i.payload?.clientId === clientId && i.payload?.which === which && i.payload?.generatedAt === generatedAt);
  if (existing) {
    if ((existing.payload?.percent ?? 0) < p.percent) await updateOutboxItem(existing.id, { payload: { ...existing.payload, percent: p.percent, at: p.at } });
    return;
  }
  await enqueueOutbox('summary-listen-progress', `Listened ${Math.round(p.percent)} percent · ${which === 'weekly' ? "This week's training" : 'Health context'}`, p, { autoDrain: false });
}

/* Milestones: the server is told at 25, 50, 75 and the threshold / 100, and the final percent when the run stops.
   The phone's record is updated on every step (it is what the screen shows). */
const MILESTONES = [25, 50, 75, 95, 100];
/** The write hooks for one client's rows: `onPlay(which)` before the voice starts, `onProgress(which, percent, final)`
    from the voice controller. Keeps the row it was given (the build the listen belongs to). */
export function useListenWriter(row: ClientHealthSummaryRow | null | undefined, clientId: string | null | undefined) {
  const rowRef = React.useRef(row); rowRef.current = row;
  const sent = React.useRef<Record<string, number>>({});
  const onPlay = React.useCallback((which: Which, onError?: (e: Error) => void) => {
    if (!clientId) return;
    sent.current[which] = -1;
    writeListenPlay(rowRef.current, clientId, which).catch((e) => onError?.(e));
  }, [clientId]);
  const onProgress = React.useCallback((which: Which, percent: number, final: boolean) => {
    if (!clientId) return;
    const r = rowRef.current;
    const last = sent.current[which] ?? -1;
    const next = MILESTONES.find((m) => m > last && percent >= m);
    if (!final && next == null) {
      // keep the phone's record moving between milestones (cheap: memory + one storage write)
      recordLocalListen({ clientId, which, version: summaryOf(r, which)?.version ?? null, generatedAt: generatedAtOf(r, which), briefingDate: r?.briefing_date ?? null, percent }).catch(() => {});
      return;
    }
    const pct = final ? Math.max(percent, last) : (next as number);
    sent.current[which] = Math.max(last, pct);
    writeListenProgress(r, clientId, which, Math.max(pct, percent)).catch(() => {});
  }, [clientId]);
  return { onPlay, onProgress };
}
