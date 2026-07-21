import React from 'react';
import Storage from 'expo-sqlite/kv-store';
import NetInfo from '@react-native-community/netinfo';
import type { QueryClient } from '@tanstack/react-query';
import { onlineManager } from '@tanstack/react-query';
import { submitWorkoutLog, submitHealthData, submitWorkoutPlan, WorkoutLogInput, WorkoutPlanCreateInput, HealthDataInput } from './clientQueries';
import { submitChatMessage } from './chatQueries';
import { submitLocationLog, LocationLogPayload } from './locationLog';

/* ============ Offline outbox + network state ============
   Durable queue (SQLite kv-store) for submissions made while offline. Items are
   drained in order on app start and whenever connectivity returns. Payloads
   carry pre-generated ids + original device timestamps, and the submit
   functions are idempotent, so retries can never duplicate rows. */

const OUTBOX_KEY = 'outbox:v1';

export type OutboxItem = {
  id: string;
  kind: 'workout-log' | 'create-plan' | 'chat-message' | 'location-log';
  label: string;          // human line for the pending-sync UI
  createdAt: string;      // ORIGINAL device timestamp at submit time
  status: 'pending' | 'syncing' | 'failed';
  attempts: number;
  error?: string;
  payload: any;           // WorkoutLogInput (+ optional health) | WorkoutPlanCreateInput
};

export type WorkoutLogOutboxPayload = WorkoutLogInput & { health?: HealthDataInput | null };

/* ---- store ---- */
let items: OutboxItem[] = [];
let loaded = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

async function load() {
  if (loaded) return;
  try {
    const raw = await Storage.getItem(OUTBOX_KEY);
    items = raw ? JSON.parse(raw) : [];
    // A crash mid-sync can strand an item in 'syncing' — recover it to 'pending'
    // so the drain picks it up again (submits are idempotent, replay is safe).
    items = items.map((i) => (i.status === 'syncing' ? { ...i, status: 'pending' as const } : i));
  } catch {
    items = [];
  }
  loaded = true;
  notify();
}

async function persist() {
  await Storage.setItem(OUTBOX_KEY, JSON.stringify(items));
  notify();
}

function rid() {
  return 'xxxxxxxx'.replace(/x/g, () => ((Math.random() * 16) | 0).toString(16)) + Date.now().toString(36);
}

/* ---- synced-log notices ----
   When a queued workout log reaches the server (background drain OR manual retry),
   a notice is recorded so the dashboard can confirm "saved to server ✓". Notices
   auto-expire after 3 hours and can be dismissed earlier. Persisted so the
   confirmation survives an app restart within the window. */
const NOTICE_KEY = 'synced-log-notices:v1';
const NOTICE_TTL_MS = 3 * 3600 * 1000;
export type SyncedNotice = { id: string; label: string; syncedAt: string };
let notices: SyncedNotice[] = [];
let noticesLoaded = false;
function pruneNotices() {
  const cutoff = Date.now() - NOTICE_TTL_MS;
  notices = notices.filter((n) => new Date(n.syncedAt).getTime() > cutoff);
}
async function loadNotices() {
  if (noticesLoaded) return;
  try {
    const raw = await Storage.getItem(NOTICE_KEY);
    notices = raw ? JSON.parse(raw) : [];
  } catch {
    notices = [];
  }
  noticesLoaded = true;
  pruneNotices();
  notify();
}
async function persistNotices() {
  pruneNotices();
  await Storage.setItem(NOTICE_KEY, JSON.stringify(notices));
  notify();
}
async function addSyncedNotice(item: OutboxItem) {
  if (item.kind !== 'workout-log') return;
  await loadNotices();
  notices = [...notices.filter((n) => n.id !== item.id), { id: item.id, label: item.label, syncedAt: new Date().toISOString() }];
  await persistNotices();
}
export async function dismissSyncedNotice(id: string) {
  await loadNotices();
  notices = notices.filter((n) => n.id !== id);
  await persistNotices();
}
export function useSyncedNotices(): SyncedNotice[] {
  const [snap, setSnap] = React.useState<SyncedNotice[]>([]);
  React.useEffect(() => {
    const l = () => { pruneNotices(); setSnap([...notices]); };
    listeners.add(l);
    loadNotices().then(l);
    const t = setInterval(l, 60_000); // re-check every minute so 3h expiry hides live
    return () => { listeners.delete(l); clearInterval(t); };
  }, []);
  return snap;
}

export async function enqueueOutbox(kind: OutboxItem['kind'], label: string, payload: any, opts?: { autoDrain?: boolean }): Promise<OutboxItem> {
  await load();
  const item: OutboxItem = { id: rid(), kind, label, createdAt: new Date().toISOString(), status: 'pending', attempts: 0, payload };
  items = [...items, item];
  // The SQLite write is AWAITED before this returns — the caller is guaranteed the
  // item is on disk before any network attempt happens (crash-safety foundation).
  await persist();
  // Opportunistic: if we're actually online (e.g. mid-submit blip), try right away.
  // Callers that run submitItem() themselves pass autoDrain:false to keep control.
  if (opts?.autoDrain !== false) drainOutbox();
  return item;
}

export async function removeOutboxItem(id: string) {
  await load();
  items = items.filter((i) => i.id !== id);
  await persist();
}

export async function retryOutboxItem(id: string) {
  await load();
  items = items.map((i) => (i.id === id ? { ...i, status: 'pending' as const, error: undefined } : i));
  await persist();
  drainOutbox();
}

/* Edit-in-place for a still-unsynced item: ONLY the payload/label change — the item
   id, createdAt, and the payload's pre-generated session id / original sessionDate
   are the caller's responsibility to preserve (idempotency + original-time rules). */
export async function updateOutboxItem(id: string, patch: { label?: string; payload: any }): Promise<boolean> {
  await load();
  const exists = items.some((i) => i.id === id);
  if (!exists) return false;
  items = items.map((i) => (i.id === id ? { ...i, label: patch.label ?? i.label, payload: patch.payload, status: 'pending' as const, error: undefined } : i));
  await persist();
  return true;
}

export function getOutbox(): OutboxItem[] {
  return items;
}

export function getOutboxItem(id: string): OutboxItem | undefined {
  return items.find((i) => i.id === id);
}

/* ---- network state ---- */
let online = true;
export function getIsOnline() {
  return online;
}

/* True for connectivity failures (retry later); false for real server rejections. */
function isTransientError(e: any): boolean {
  const msg = String(e?.message ?? e ?? '');
  return /network request failed|network error|failed to fetch|fetch failed|timeout|abort|socket|ENOTFOUND|ECONN/i.test(msg);
}

/* ---- drainer ---- */
let qcRef: QueryClient | null = null;
let draining = false;

/* One item's actual submit + cache invalidation. Throws on failure; success means
   the server insert/RPC genuinely succeeded (submit fns throw on any DB error). */
async function processItem(item: OutboxItem): Promise<void> {
  if (item.kind === 'workout-log') {
    const p = item.payload as WorkoutLogOutboxPayload;
    // Health gate data entered offline syncs first (idempotent upserts),
    // then the log itself (idempotent via pre-generated session id).
    if (p.health) await submitHealthData(p.health);
    await submitWorkoutLog(p);
    qcRef?.invalidateQueries({ queryKey: ['trainer-roster'] });
    qcRef?.invalidateQueries({ queryKey: ['client-sessions'] });
    qcRef?.invalidateQueries({ queryKey: ['trainer-month-sessions'] });
    if (p.health) qcRef?.invalidateQueries({ queryKey: ['client-health-check', p.clientId] });
  } else if (item.kind === 'create-plan') {
    const p = item.payload as WorkoutPlanCreateInput;
    await submitWorkoutPlan(p);
    qcRef?.invalidateQueries({ queryKey: ['client-plans', p.clientId] });
  } else if (item.kind === 'chat-message') {
    const p = item.payload as { id: string; conversationId: string; senderId: string; text: string };
    await submitChatMessage(p);
    qcRef?.invalidateQueries({ queryKey: ['chat-thread', p.conversationId] });
    qcRef?.invalidateQueries({ queryKey: ['chat-overview', p.senderId] });
  } else if (item.kind === 'location-log') {
    // Replays with the ORIGINAL captured_at carried in the payload. No UI to
    // invalidate — location logs are never shown in-app.
    await submitLocationLog(item.payload as LocationLogPayload);
  }
}

export async function drainOutbox() {
  await load();
  if (draining || !online) return;
  const pending = items.filter((i) => i.status === 'pending');
  if (!pending.length) return;
  draining = true;
  try {
    for (const item of pending) {
      // The item may have been discarded/edited while the loop ran — re-read it.
      const current = items.find((i) => i.id === item.id);
      if (!current || current.status !== 'pending') continue;
      try {
        await processItem(current);
        items = items.filter((i) => i.id !== item.id);
        await persist();
        await addSyncedNotice(current);
      } catch (e: any) {
        if (isTransientError(e)) {
          // Still offline / flaky — bump the attempt count and stop; NetInfo will
          // trigger another drain when the connection is back.
          items = items.map((i) => (i.id === item.id ? { ...i, attempts: i.attempts + 1 } : i));
          await persist();
          break;
        }
        // Real server rejection — keep the data, surface it for review. Never
        // auto-retried (only transient errors are), so no silent retry loop.
        items = items.map((i) =>
          i.id === item.id ? { ...i, status: 'failed' as const, attempts: i.attempts + 1, error: String(e?.message ?? e) } : i
        );
        await persist();
      }
    }
  } finally {
    draining = false;
  }
}

/* Targeted, AWAITED sync of a single item — powers the form's post-submit result
   ("Synced ✓" only when the real DB insert succeeded) and the Retry button.
   'queued' = still offline / transient failure, item stays pending. */
export type SubmitItemResult = { status: 'synced' | 'queued' | 'failed'; error?: string };
export async function submitItem(id: string): Promise<SubmitItemResult> {
  await load();
  // Wait out any in-flight drain — it may be syncing this very item.
  while (draining) await new Promise((r) => setTimeout(r, 120));
  const item = items.find((i) => i.id === id);
  if (!item) return { status: 'synced' }; // gone from the queue ⇒ a drain already synced it
  if (!online) return { status: 'queued' };
  draining = true;
  try {
    items = items.map((i) => (i.id === id ? { ...i, status: 'syncing' as const, error: undefined } : i));
    await persist();
    try {
      const current = items.find((i) => i.id === id)!;
      await processItem(current);
      items = items.filter((i) => i.id !== id);
      await persist();
      await addSyncedNotice(current);
      return { status: 'synced' };
    } catch (e: any) {
      if (isTransientError(e)) {
        items = items.map((i) => (i.id === id ? { ...i, status: 'pending' as const, attempts: i.attempts + 1 } : i));
        await persist();
        return { status: 'queued' };
      }
      const msg = String(e?.message ?? e);
      items = items.map((i) => (i.id === id ? { ...i, status: 'failed' as const, attempts: i.attempts + 1, error: msg } : i));
      await persist();
      return { status: 'failed', error: msg };
    }
  } finally {
    draining = false;
  }
}

/* ---- init: wire NetInfo → React Query onlineManager + auto-drain ---- */
export function initOffline(queryClient: QueryClient) {
  qcRef = queryClient;
  load();
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) => {
      const next = !!state.isConnected && state.isInternetReachable !== false;
      const wasOffline = !online;
      online = next;
      setOnline(next);
      notify();
      if (next && wasOffline) drainOutbox();
    })
  );
  // Initial state + first drain attempt on launch.
  NetInfo.fetch().then((state) => {
    online = !!state.isConnected && state.isInternetReachable !== false;
    notify();
    if (online) drainOutbox();
  });
}

/* ---- React hooks for the UI ---- */
// Location logs are captured silently and must NEVER appear in the pending-sync
// list — the user should never see their location syncing. They still drain via
// the internal `items` list above; this hook just hides them from the UI.
const uiVisible = (list: OutboxItem[]) => list.filter((i) => i.kind !== 'location-log');
export function useOutbox(): OutboxItem[] {
  const [snap, setSnap] = React.useState<OutboxItem[]>(uiVisible(items));
  React.useEffect(() => {
    const l = () => setSnap(uiVisible(items));
    listeners.add(l);
    load();
    return () => { listeners.delete(l); };
  }, []);
  return snap;
}

export function useIsOnline(): boolean {
  const [snap, setSnap] = React.useState(online);
  React.useEffect(() => {
    const l = () => setSnap(online);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return snap;
}
