/* The phone's own record of the spoken-summary listens (3 Nov 2026, owner: "no network must work the same").
   Every progress write lands here first (percent, heard, the real time), then goes to the server at once when
   online or through the outbox when not. The bar, the lines, the chips and the Add Workout gate read the merge of
   the server's status and this record (clientHealthSummary.ts mergedProgress / listenGate(local)). One record per
   client and kind, for one build (generated_at); another build replaces it. Per signed-in user (userId), cleared
   on sign-out with the session teardown. */
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { LocalListen, LocalListens, Which } from './clientHealthSummary';
import { HEARD_PERCENT } from './clientHealthSummary';
import { registerTeardown } from './sessionTeardown';

const KEY = 'listen-local:v1';
type Store = Record<string, LocalListen>; // key = `${userId}|${clientId}|${which}`
let store: Store = {};
let loaded = false;
let uid: string | null = null;
const listeners = new Set<() => void>();
const k = (clientId: string, which: Which) => `${uid ?? '-'}|${clientId}|${which}`;

async function load() {
  if (loaded) return;
  loaded = true;
  try { const raw = await AsyncStorage.getItem(KEY); if (raw) store = JSON.parse(raw) ?? {}; } catch { store = {}; }
  listeners.forEach((l) => l());
}
async function persist() {
  try { await AsyncStorage.setItem(KEY, JSON.stringify(store)); } catch { /* keep the memory copy */ }
}
export function setListenLocalUser(id: string | null) { uid = id; listeners.forEach((l) => l()); }
export async function clearListenLocal() { store = {}; try { await AsyncStorage.removeItem(KEY); } catch { /* nothing */ } listeners.forEach((l) => l()); }
registerTeardown(() => clearListenLocal());

export const getLocalListen = (clientId: string, which: Which): LocalListen | null => store[k(clientId, which)] ?? null;
export const getLocalListens = (clientId: string): LocalListens => ({ weekly: getLocalListen(clientId, 'weekly'), context: getLocalListen(clientId, 'context') });

/** Record progress for one listen. A new build (generatedAt) replaces the record; the percent never drops within a
    build; heard flips at HEARD_PERCENT and keeps the first time it happened. Returns the record. */
export async function recordLocalListen(o: { clientId: string; which: Which; version: number | null; generatedAt: string | null; briefingDate: string | null; percent: number; at?: string; synced?: boolean }): Promise<LocalListen> {
  await load();
  const key = k(o.clientId, o.which);
  const prev = store[key];
  const same = prev && prev.generatedAt === o.generatedAt;
  const pct = Math.max(0, Math.min(100, Math.round(o.percent)));
  const percent = same ? Math.max(prev.percent, pct) : pct;
  const heard = percent >= HEARD_PERCENT;
  const at = o.at ?? new Date().toISOString();
  const rec: LocalListen = {
    clientId: o.clientId, which: o.which, version: o.version, generatedAt: o.generatedAt, briefingDate: o.briefingDate,
    percent, heard,
    heardAt: heard ? (same && prev.heard && prev.heardAt ? prev.heardAt : at) : null,
    at: same ? prev.at : at,
    synced: o.synced ?? (same ? prev.synced && percent === prev.percent : false),
  };
  store[key] = rec;
  await persist();
  listeners.forEach((l) => l());
  return rec;
}
/** The server took it (or already had it): the record is no longer "saved on this phone only". */
export async function markLocalListenSynced(clientId: string, which: Which, generatedAt: string | null) {
  await load();
  const key = k(clientId, which);
  const rec = store[key];
  if (!rec || rec.generatedAt !== generatedAt) return;
  store[key] = { ...rec, synced: true };
  await persist();
  listeners.forEach((l) => l());
}
/** The server said the build changed (stale): the record for that build is dropped. */
export async function dropLocalListen(clientId: string, which: Which, generatedAt: string | null) {
  await load();
  const key = k(clientId, which);
  if (store[key] && store[key].generatedAt === generatedAt) { delete store[key]; await persist(); listeners.forEach((l) => l()); }
}

/** React: the phone's records for one client (re-rendered on every write). */
export function useLocalListens(clientId: string | null | undefined): LocalListens {
  const [, tick] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => { load(); listeners.add(tick); return () => { listeners.delete(tick); }; }, []);
  return clientId ? getLocalListens(clientId) : {};
}
/** React: the records for many clients (My Crew). */
export function useLocalListensMap(clientIds: string[]): Record<string, LocalListens> {
  const [, tick] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => { load(); listeners.add(tick); return () => { listeners.delete(tick); }; }, []);
  const out: Record<string, LocalListens> = {};
  for (const id of clientIds) out[id] = getLocalListens(id);
  return out;
}
