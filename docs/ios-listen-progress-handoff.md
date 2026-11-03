# iOS handoff: listen progress in percent, heard from 95 percent, everyone's percent on My Crew, offline like online (3 Nov 2026)

Plan with every decision: docs/listen-progress-plan.md. Both apps share the server (migration 20261103100000, below).

## 1. What the user sees
- Under every Play row (client page card, Today's Roster strip, Essentials cards, Log Health Data popup, the Add
  Workout gate sheet, My Crew's Listen now sheet): a progress bar; "YOU: 60 PERCENT HEARD" (gold) or "HEARD 100 PERCENT,
  YOU CAN LOG." (green); "· SAVED ON THIS PHONE · SYNCS WHEN ONLINE" while the phone's record is not on the server yet;
  while under 95 percent and due, the red alert **"Listen to 100 percent now, so you do not have to listen again when
  you log the session."** The bar moves while the audio plays.
- A listen counts as heard only from **95 percent** of its current build (owner: 95 and above is 100). A Play stopped
  earlier shows its percent and keeps the summary due. Plays from before this rule (no percent on the trail) count as heard.
- My Crew, Tomorrow's Plan: the chip reads NOT HEARD (red), "60 PERCENT · FINISH" (amber) or HEARD 100 (green). Tapping it
  opens Listen now with a **Who listened** block first: one line per crew member, "This week 100 percent · Health context
  40 percent" (a heard listen reads 100), members who never played at 0, non-crew listeners under OTHERS, then the two
  Play rows. Footnote: "A listen counts from 95 percent. A phone that listened offline shows here after it syncs."
- Who listened sheet (client page): the percent next to every entry.
- Offline: everything above works the same. The device voice reads the cached script; the phone's record clears the
  gate and drives the bar; the writes queue and sync with the workout logs; the real heard time reaches the server.
  Opening Tomorrow's Plan online prefetches the clients' rows for the next offline day. A client whose row was never
  loaded on this phone reads "Connect once to load NAME's summaries" and has nothing to require.
- The Add Workout gate no longer skips itself offline; inside it a row counts as heard at 95 percent too.

## 2. Data / server contract (hub-track migration 20261103100000, the owner runs it)
- Trail entry: `{at, by, by_name, role, which, version, briefing_date, percent, heard, heard_at, updated_at, device}`.
  No `percent` key = legacy play = heard at 100.
- `log_summary_listen(p_client_id, p_which, p_at default now, p_briefing_date default null, p_device)`: the Play entry
  at percent 0. `p_at` within the last 7 days, never the future (clamped); `p_briefing_date` names the row the listen
  belongs to (an offline listen synced the next day).
- `log_summary_listen_progress(p_client_id, p_which, p_percent, p_version, p_at, p_briefing_date, p_device)` →
  `{ok, stale, percent, heard, heard_at, version, briefing_date}`: best percent so far, never lower; heard from 95;
  `stale: true` when `p_version` is not the row's current version (the phone drops its record for that build).
  Refusal `LISTEN_TOO_OLD: This listen is older than 7 days and cannot be recorded.` (the queued item is dropped).
- `get_my_listen_status(uuid[])` adds `weekly_version, context_version, my_weekly_percent, my_context_percent,
  my_weekly_heard, my_context_heard, my_weekly_heard_at, my_context_heard_at` (old columns unchanged).
- `get_crew_listen_progress(uuid[])` → rows `{client_id, which, by, by_name, role, percent, heard, at, version}`,
  best per listener per summary for the current build; same visibility as the row read.
- Outbox kinds (iOS: the same queue) `summary-listen` payload `{clientId, which, version, generatedAt, briefingDate, at}`
  and `summary-listen-progress` (+ `percent`); the drain calls the two RPCs with `p_at` / `p_briefing_date`;
  one queued progress per client, kind and build, the highest percent kept.
- Milestones written: 25, 50, 75, 95, 100 and the final percent on stop / pause; the phone's record on every step.

## 3. Code to port
New pure / plain files (copy byte for byte): `src/lib/listenLocal.ts`, `src/lib/listenSync.ts`. Then the diff hunks
of the edited files (the rules in `clientHealthSummary.ts`, the controller's progress in `summaryVoice.ts`, the
queries, the outbox, the card / strip / gate / chip / sheet, My Crew, the Workout gate, both tests).

### `src/lib/listenLocal.ts` (new)
```ts
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
```

### `src/lib/listenSync.ts` (new)
```ts
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
```

### Edited files (`git diff -U4`)
```diff
diff --git a/src/auth.tsx b/src/auth.tsx
index fdb42aa..94bb4df 100644
--- a/src/auth.tsx
+++ b/src/auth.tsx
@@ -2,8 +2,9 @@ import React, { createContext, useContext, useEffect, useState, useCallback } fr
 import type { Session } from '@supabase/supabase-js';
 import { supabase } from './lib/supabase';
 import { runSessionTeardown } from './lib/sessionTeardown';
 import { setOutboxUser } from './lib/offline';
+import { setListenLocalUser } from './lib/listenLocal';
 import type { Role } from './store';
 
 type AuthCtx = {
   session: Session | null;
@@ -45,13 +46,15 @@ export function AuthProvider({ children }: { children: React.ReactNode }) {
   useEffect(() => {
     supabase.auth.getSession().then(({ data }) => {
       hadSessionRef.current = !!data.session;
       setOutboxUser(data.session?.user?.id ?? null);
+      setListenLocalUser(data.session?.user?.id ?? null);
       setSession(data.session);
       setLoading(false);
     });
     const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
       setOutboxUser(s?.user?.id ?? null);
+      setListenLocalUser(s?.user?.id ?? null);
       if (!s && hadSessionRef.current) runSessionTeardown();
       hadSessionRef.current = !!s;
       setSession(s);
       if (!s) { setRole(null); setDbRole(null); }
diff --git a/src/components/clientHealthSummaryCard.tsx b/src/components/clientHealthSummaryCard.tsx
index 59b2d7b..bb7178a 100644
--- a/src/components/clientHealthSummaryCard.tsx
+++ b/src/components/clientHealthSummaryCard.tsx
@@ -15,16 +15,21 @@ import { Icon, type IconName } from '../icons';
 import { Serif, Mono, Body } from './primitives';
 import { ReplayMask } from './ReplayShield';
 import { LatestHealthDataBlock } from './LatestHealthData';
 import { useAuth } from '../auth';
-import { useClientHealthSummary, useLogSummaryListen } from '../lib/clientHealthSummaryQueries';
+import { useClientHealthSummary } from '../lib/clientHealthSummaryQueries';
 import { useSummaryVoice, type SummaryVoice, type VoiceSource } from '../lib/summaryVoice';
+import { useListenWriter } from '../lib/listenSync';
+import { useLocalListens } from '../lib/listenLocal';
+import { useIsOnline } from '../lib/offline';
 import {
   TITLES, type Which, type ClientHealthSummaryRow, type WeeklySummary, type ContextSummary,
   durationText, fmtStamp, historyOf, summaryOf, generatedAtOf, hasScript, lastListen, isNewSince,
   listenGate, gateDue, type GateState,
-  listenRuleLine, LISTEN_WHY, LISTEN_CHIP_DUE, LISTEN_CHIP_DUE_SHORT, LISTEN_CHIP_OK, listenNowLine, gateFromStatus, type ListenStatusRow,
+  listenRuleLine, LISTEN_WHY, listenNowLine, gateFromStatus, type ListenStatusRow,
   type ListenGate, type HeardMap, listenStillNeeded, listenAllHeard, LISTEN_PROCEED, LISTEN_WAIT,
+  mergedProgress, progressLine, LISTEN_100_ALERT, LISTEN_OFFLINE_SAVED, LISTEN_NO_SCRIPT_OFFLINE, HEARD_PERCENT, entryPercent, entryHeard,
+  type LocalListens, statusPercent, listenChipText, crewListenLines, crewLineText, type CrewListenRow,
 } from '../lib/clientHealthSummary';
 
 const GOLD = C.gold;
 const WEEKLY = C.green;
@@ -134,16 +139,23 @@ type RowProps = {
   onToggleTranscript: () => void;
   /** Gate mode: a status chip instead of the "new since you listened" badge. */
   status?: { text: string; color: string } | null;
   ordinal?: number;
+  /** Progress (3 Nov 2026): my best percent of the current build, the live percent while playing, and whether the
+      phone's record is still waiting for the network. */
+  percent?: number;
+  livePercent?: number | null;
+  offlineSaved?: boolean;
 };
-function SummaryRow({ which, row, uid, active, paused, busy, canPause, source, part, parts, transcriptOpen, onPlay, onStop, onToggleTranscript, status, ordinal, rule, ruleDue }: RowProps) {
+function SummaryRow({ which, row, uid, active, paused, busy, canPause, source, part, parts, transcriptOpen, onPlay, onStop, onToggleTranscript, status, ordinal, rule, ruleDue, percent, livePercent, offlineSaved }: RowProps) {
   const s = summaryOf(row, which);
   const col = colorOf(which);
   const has = hasScript(row, which);
   const last = lastListen(historyOf(row), which);
   const fresh = !status && isNewSince(row, which, uid);
   const sub = busy ? 'Preparing the voice…' : active && source === 'sarvam' && parts > 1 ? `${subLine(row, which)} · part ${part} of ${parts}` : subLine(row, which);
+  const shown = Math.max(percent ?? 0, active && livePercent != null ? livePercent : 0);
+  const heard = shown >= HEARD_PERCENT;
   return (
     <View style={{ borderRadius: 16, padding: 12, backgroundColor: hexA(col, 0.05), borderWidth: 1, borderColor: hexA(col, active ? 0.5 : 0.2), gap: 8 }}>
       <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 11 }}>
         <PlayButton which={which} active={active} paused={paused} busy={busy} canPause={canPause} disabled={!has} onPress={onPlay} />
@@ -184,8 +196,25 @@ function SummaryRow({ which, row, uid, active, paused, busy, canPause, source, p
       </View>
       {transcriptOpen && s?.script ? (
         <Body style={{ fontSize: 12.5, color: C.ink, lineHeight: 19, padding: 11, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.3)' }}>{s.script}</Body>
       ) : null}
+      {has && percent != null ? (
+        <View style={{ gap: 4 }} accessibilityLabel={progressLine(shown)}>
+          <View style={{ height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
+            <View style={{ width: `${Math.max(0, Math.min(100, heard ? 100 : shown))}%`, height: 5, borderRadius: 3, backgroundColor: heard ? C.green : shown > 0 ? GOLD : 'transparent' }} />
+          </View>
+          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
+            <Mono style={{ fontSize: 8.5, letterSpacing: 0.6, color: heard ? C.green : shown > 0 ? GOLD : C.muted3 }}>{progressLine(shown).toUpperCase()}</Mono>
+            {offlineSaved ? <Mono style={{ fontSize: 8, letterSpacing: 0.5, color: C.muted3 }}>· {LISTEN_OFFLINE_SAVED.toUpperCase()}</Mono> : null}
+          </View>
+          {!heard && (ruleDue || status) ? (
+            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingVertical: 6, paddingHorizontal: 9, borderRadius: 10, backgroundColor: hexA(C.red, 0.09), borderWidth: 1, borderColor: hexA(C.red, 0.35) }}>
+              <Icon name="alert" size={12} color="#FF9B8F" strokeWidth={2.3} />
+              <Text style={{ flex: 1, fontFamily: F.bodySemi, fontSize: 11.5, lineHeight: 16, color: '#FF9B8F' }}>{LISTEN_100_ALERT}</Text>
+            </View>
+          ) : null}
+        </View>
+      ) : null}
       {rule ? (
         <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingVertical: 7, paddingHorizontal: 9, borderRadius: 10, backgroundColor: hexA(ruleDue ? C.red : C.green, 0.09), borderWidth: 1, borderColor: hexA(ruleDue ? C.red : C.green, 0.35) }}>
           <Icon name={ruleDue ? 'alert' : 'checks'} size={12} color={ruleDue ? '#FF9B8F' : C.green} strokeWidth={2.3} />
           <Text style={{ flex: 1, fontFamily: F.bodySemi, fontSize: 11.5, lineHeight: 16, color: ruleDue ? '#FF9B8F' : C.green }}>{rule}</Text>
@@ -222,8 +251,9 @@ function HistorySheet({ visible, onClose, row }: { visible: boolean; onClose: ()
                 <View style={{ flex: 1 }}>
                   <Text numberOfLines={1} style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: '#fff' }}>{h.by_name ?? 'Unknown'}{h.role ? <Text style={{ color: C.muted3 }}> · {h.role}</Text> : null}</Text>
                   <Mono style={{ fontSize: 8.5, letterSpacing: 0.6, color: C.muted3, marginTop: 1 }}>{h.which === 'weekly' ? 'WEEK' : 'CONTEXT'} · {fmtStamp(h.at).toUpperCase()}</Mono>
                 </View>
+                <Mono style={{ fontSize: 9, letterSpacing: 0.5, color: entryHeard(h) ? C.green : GOLD }}>{entryHeard(h) ? '100%' : `${entryPercent(h)}%`}</Mono>
               </View>
             ))}
           </ScrollView>
         </View>
@@ -236,25 +266,31 @@ function HistorySheet({ visible, onClose, row }: { visible: boolean; onClose: ()
 export function ClientHealthSummaryCard({ clientId, clientName }: { clientId: string | null | undefined; clientName?: string | null }) {
   const { session } = useAuth();
   const uid = session?.user?.id ?? null;
   const q = useClientHealthSummary(clientId ?? null);
-  const logM = useLogSummaryListen(clientId ?? null);
   const voice = useSummaryVoice();
   const [transcript, setTranscript] = React.useState<Which | null>(null);
   const [histOpen, setHistOpen] = React.useState(false);
   const [err, setErr] = React.useState<string | null>(null);
   const row = q.data ?? null;
   const history = historyOf(row);
+  // Progress (3 Nov 2026): the phone's record merged with the server's; writes through listenSync (outbox offline).
+  const local = useLocalListens(clientId ?? null);
+  const writer = useListenWriter(row, clientId ?? null);
+  const [live, setLive] = React.useState<{ which: Which; pct: number } | null>(null);
+  const gate = listenGate(row, uid, Date.now(), local);
 
   const play = (which: Which) => {
     const s = summaryOf(row, which);
     if (!s?.script || !clientId) return;
     if (voice.speakingId === which) { tapActive(voice); return; }
     setErr(null);
-    // The trail first: the RPC is the record of who listened, whatever the voice does next.
-    logM.mutate(which, { onError: (e) => setErr((e as Error).message) });
+    // The trail first: the record of who listened, whatever the voice does next (the phone's record, then the server).
+    writer.onPlay(which, (e) => setErr(e.message));
+    setLive({ which, pct: 0 });
     voice.play(which, { clientId, which, script: s.script }, {
       onError: (m) => { setTranscript(which); setErr(BOTH_FAILED(m)); },
+      onProgress: (pct, final) => { setLive(final ? null : { which, pct }); writer.onProgress(which, pct, final); },
     });
   };
 
   if (!clientId || q.isError) return null;
@@ -287,9 +323,10 @@ export function ClientHealthSummaryCard({ clientId, clientName }: { clientId: st
           <View style={{ gap: 9 }}>
             <Body style={{ fontSize: 10.5, color: C.muted2, lineHeight: 15 }}>{LISTEN_WHY}</Body>
             {(['weekly', 'context'] as Which[]).map((which) => (
               <SummaryRow key={which} which={which} row={row} uid={uid} {...rowVoiceProps(voice, which)} transcriptOpen={transcript === which}
-                rule={listenRuleLine(which, listenGate(row, uid)[which], clientName)} ruleDue={listenGate(row, uid)[which] === 'due'}
+                rule={listenRuleLine(which, gate[which], clientName)} ruleDue={gate[which] === 'due'}
+                percent={mergedProgress(row, which, uid, local[which])} livePercent={live?.which === which ? live.pct : null} offlineSaved={!!local[which] && !local[which]!.synced}
                 onPlay={() => play(which)} onStop={voice.stop} onToggleTranscript={() => setTranscript((t) => (t === which ? null : which))} />
             ))}
           </View>
         )}
@@ -312,27 +349,32 @@ export function ClientSummaryStrip({ clientId, date, accent = GOLD, latest = fal
   const { session } = useAuth();
   const uid = session?.user?.id ?? null;
   const [open, setOpen] = React.useState(!!defaultOpen);
   const q = useClientHealthSummary(clientId ?? null, true, date ?? null);
-  const logM = useLogSummaryListen(clientId ?? null);
   const voice = useSummaryVoice();
+  const online = useIsOnline();
   const [transcript, setTranscript] = React.useState<Which | null>(null);
   const [err, setErr] = React.useState<string | null>(null);
   const row = q.data ?? null;
-  const gate = listenGate(row, uid);
+  const local = useLocalListens(clientId ?? null);
+  const writer = useListenWriter(row, clientId ?? null);
+  const [live, setLive] = React.useState<{ which: Which; pct: number } | null>(null);
+  const gate = listenGate(row, uid, Date.now(), local);
   const due = gateDue(gate);
   React.useEffect(() => { if (!open) voice.stop(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
   if (!clientId || q.isError) return null;
   const hasWeekly = hasScript(row, 'weekly'), hasContext = hasScript(row, 'context');
-  const summaryLine = q.isLoading ? 'Loading…' : !row || (!hasWeekly && !hasContext) ? 'Nothing built yet for this day' : [hasWeekly ? `This week · ${durationText(row!.weekly_summary!.script)}` : null, hasContext ? `Health context · ${durationText(row!.context_summary!.script)}` : null].filter(Boolean).join('   ');
+  const summaryLine = q.isLoading ? 'Loading…' : !row || (!hasWeekly && !hasContext) ? (!online ? LISTEN_NO_SCRIPT_OFFLINE((clientName ?? '').split(' ')[0] || 'this client') : 'Nothing built yet for this day') : [hasWeekly ? `This week · ${durationText(row!.weekly_summary!.script)}` : null, hasContext ? `Health context · ${durationText(row!.context_summary!.script)}` : null].filter(Boolean).join('   ');
   const play = (which: Which) => {
     const s = summaryOf(row, which);
     if (!s?.script) return;
     if (voice.speakingId === which) { tapActive(voice); return; }
     setErr(null);
-    logM.mutate(which, { onError: (e) => setErr((e as Error).message) });
+    writer.onPlay(which, (e) => setErr(e.message));
+    setLive({ which, pct: 0 });
     voice.play(which, { clientId, which, script: s.script, date: row?.briefing_date ?? date ?? null }, {
       onError: (m) => { setTranscript(which); setErr(BOTH_FAILED(m)); },
+      onProgress: (pct, final) => { setLive(final ? null : { which, pct }); writer.onProgress(which, pct, final); },
     });
   };
   return (
     <ReplayMask>
@@ -351,8 +393,9 @@ export function ClientSummaryStrip({ clientId, date, accent = GOLD, latest = fal
             <Body style={{ fontSize: 10.5, color: due ? '#FF9B8F' : C.muted2, lineHeight: 15 }}>{LISTEN_WHY}</Body>
             {(['weekly', 'context'] as Which[]).map((which) => (
               <SummaryRow key={which} which={which} row={row} uid={uid} {...rowVoiceProps(voice, which)} transcriptOpen={transcript === which}
                 rule={listenRuleLine(which, gate[which], clientName)} ruleDue={gate[which] === 'due'}
+                percent={mergedProgress(row, which, uid, local[which])} livePercent={live?.which === which ? live.pct : null} offlineSaved={!!local[which] && !local[which]!.synced}
                 onPlay={() => play(which)} onStop={voice.stop} onToggleTranscript={() => setTranscript((t) => (t === which ? null : which))} />
             ))}
             {voice.notice ? <Body style={{ fontSize: 11, color: GOLD }}>{voice.notice}</Body> : null}
             {err ? <Body style={{ fontSize: 11, color: C.red }}>{err}</Body> : null}
@@ -388,12 +431,14 @@ export function ListenGateSheet({ visible, clientId, clientName, onContinue }: {
   const insets = useSafeAreaInsets();
   const { session } = useAuth();
   const uid = session?.user?.id ?? null;
   const q = useClientHealthSummary(clientId, visible);
-  const logM = useLogSummaryListen(clientId);
   const voice = useSummaryVoice();
   const row = q.data ?? null;
-  const gate = listenGate(row, uid);
+  const local = useLocalListens(clientId);
+  const writer = useListenWriter(row, clientId);
+  const [live, setLive] = React.useState<{ which: Which; pct: number } | null>(null);
+  const gate = listenGate(row, uid, Date.now(), local);
   // What is due is fixed when the sheet opens (22 Oct 2026): Play records the listen at once and the refreshed
   // row would read "done" seconds into the audio. Only a play to the end (or a transcript that stood in) counts.
   const [atOpen, setAtOpen] = React.useState<ListenGate | null>(null);
   React.useEffect(() => {
@@ -413,12 +458,18 @@ export function ListenGateSheet({ visible, clientId, clientName, onContinue }: {
     const s = summaryOf(row, which);
     if (!s?.script || !clientId) return;
     if (voice.speakingId === which) { tapActive(voice); return; }
     setErr(null);
-    logM.mutate(which, { onError: (e) => setErr((e as Error).message) });
+    writer.onPlay(which, (e) => setErr(e.message));
+    setLive({ which, pct: 0 });
     voice.play(which, { clientId, which, script: s.script }, {
-      // Heard to the end: the recording's last part, or the device voice when it stood in.
+      // Heard to the end: the recording's last part, or the device voice when it stood in (95 percent counts, 3 Nov 2026).
       onDone: () => setHeard((h) => ({ ...h, [which]: true })),
+      onProgress: (pct, final) => {
+        setLive(final ? null : { which, pct });
+        writer.onProgress(which, pct, final);
+        if (pct >= HEARD_PERCENT) setHeard((h) => (h[which] ? h : { ...h, [which]: true }));
+      },
       onError: (m) => {
         // Nothing could speak: the transcript stands in and counts as heard.
         setTranscript(which);
         setHeard((h) => ({ ...h, [which]: true }));
@@ -453,8 +504,9 @@ export function ListenGateSheet({ visible, clientId, clientName, onContinue }: {
             ) : (['weekly', 'context'] as Which[]).map((which, i) => (
               <SummaryRow key={which} which={which} row={row} uid={uid} ordinal={i + 1} {...rowVoiceProps(voice, which)} transcriptOpen={transcript === which}
                 onPlay={() => play(which)} onStop={voice.stop} onToggleTranscript={() => setTranscript((t) => (t === which ? null : which))}
                 status={gateStatus(which, gateNow[which], heard[which], row)}
+                percent={heard[which] ? 100 : mergedProgress(row, which, uid, local[which])} livePercent={live?.which === which ? live.pct : null} offlineSaved={!!local[which] && !local[which]!.synced}
                 rule={listenRuleLine(which, gateNow[which], clientName)} ruleDue={gateNow[which] === 'due' && !heard[which]} />
             ))}
             {voice.notice ? <Body style={{ fontSize: 11, color: GOLD }}>{voice.notice}</Body> : null}
             {err ? <Body style={{ fontSize: 11.5, color: C.red }}>{err}</Body> : null}
@@ -476,27 +528,59 @@ export function ListenGateSheet({ visible, clientId, clientName, onContinue }: {
 
 export { gateDue };
 
 /* ---------- My Crew (27 Oct 2026): the chip on a plan row and the Listen now sheet ---------- */
-/** Red "NOT HEARD · LISTEN NOW" while either summary is due for the signed-in trainer, green "HEARD" otherwise, nothing when none exists. */
-export function ListenStatusChip({ status, onPress, compact = false }: { status: ListenStatusRow | null | undefined; onPress: () => void; compact?: boolean }) {
-  const gate = gateFromStatus(status);
+/** Red "NOT HEARD · LISTEN NOW" while either summary is due for the signed-in trainer, amber "60 PERCENT · FINISH" when
+    a listen is under way, green "HEARD 100" otherwise, nothing when none exists. `local` = the phone's own record. */
+export function ListenStatusChip({ status, onPress, compact = false, local }: { status: ListenStatusRow | null | undefined; onPress: () => void; compact?: boolean; local?: LocalListens | null }) {
+  const gate = gateFromStatus(status, Date.now(), local);
   if (gate.weekly === 'none' && gate.context === 'none') return null;
-  const due = gateDue(gate);
-  const col = due ? C.red : C.green;
+  const chip = listenChipText(gate, { weekly: statusPercent(status, 'weekly', local), context: statusPercent(status, 'context', local) }, compact);
+  const col = chip.tone === 'red' ? C.red : chip.tone === 'amber' ? GOLD : C.green;
   return (
-    <Pressable onPress={onPress} hitSlop={10} accessibilityRole="button" accessibilityLabel={due ? 'Summaries not heard, listen now' : 'Summaries heard'}
+    <Pressable onPress={onPress} hitSlop={10} accessibilityRole="button" accessibilityLabel={chip.tone === 'green' ? 'Summaries heard' : `Summaries not fully heard, ${chip.text.toLowerCase()}`}
       style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 999, backgroundColor: hexA(col, 0.12), borderWidth: 1, borderColor: hexA(col, 0.45) }}>
-      <Icon name={due ? 'alert' : 'checks'} size={9} color={col} strokeWidth={2.2} />
-      <Mono style={{ fontSize: 8, letterSpacing: 0.5, color: col }}>{due ? (compact ? LISTEN_CHIP_DUE_SHORT : LISTEN_CHIP_DUE) : LISTEN_CHIP_OK}</Mono>
+      <Icon name={chip.tone === 'green' ? 'checks' : 'alert'} size={9} color={col} strokeWidth={2.2} />
+      <Mono style={{ fontSize: 8, letterSpacing: 0.5, color: col }}>{chip.text}</Mono>
     </Pressable>
   );
 }
 
 export type ListenNowInfo = { id: string; name: string; when?: 'tomorrow' | 'today' } | null;
 
-/** The sheet behind the chip: the rule sentence and the two Play rows (the strip, open). */
-export function ListenNowSheet({ info, onClose }: { info: ListenNowInfo; onClose: () => void }) {
+/** My Crew's "Who listened" block (3 Nov 2026): every crew member's percent for both summaries of this client. */
+export function CrewListenBlock({ clientId, rows, members, loading }: { clientId: string; rows: CrewListenRow[]; members: { id: string; name: string }[]; loading?: boolean }) {
+  const { crew, others } = crewListenLines(rows, clientId, members);
+  const Line = ({ l }: { l: ReturnType<typeof crewListenLines>['crew'][number] }) => {
+    const all = l.weeklyHeard && l.contextHeard;
+    return (
+      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 }}>
+        <Icon name={all ? 'checks' : 'alert'} size={11} color={all ? C.green : GOLD} strokeWidth={2.2} />
+        <Text numberOfLines={1} style={{ width: 92, fontFamily: F.bodySemi, fontSize: 12, color: '#fff' }}>{l.name.split(' ')[0]}</Text>
+        <Mono style={{ flex: 1, fontSize: 8.5, letterSpacing: 0.4, color: all ? C.green : C.ink3 }} numberOfLines={1}>{crewLineText(l).toUpperCase()}</Mono>
+      </View>
+    );
+  };
+  return (
+    <View style={{ padding: 11, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.3)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', gap: 4 }}>
+      <Mono style={{ fontSize: 9, letterSpacing: 1.2, color: C.muted3 }}>WHO LISTENED · PERCENT OF THE CURRENT BUILD</Mono>
+      {loading && !rows.length ? <ActivityIndicator size="small" color={GOLD} style={{ alignSelf: 'flex-start', marginVertical: 6 }} /> : null}
+      {crew.map((l) => <Line key={l.by} l={l} />)}
+      {others.length ? (
+        <>
+          <Mono style={{ fontSize: 8, letterSpacing: 0.8, color: C.muted3, marginTop: 4 }}>OTHERS</Mono>
+          {others.map((l) => <Line key={l.by} l={l} />)}
+        </>
+      ) : null}
+      {!crew.length && !others.length && !loading ? <Body style={{ fontSize: 11.5, color: C.muted2 }}>Nobody has listened yet.</Body> : null}
+      <Body style={{ fontSize: 10.5, color: C.muted3, lineHeight: 14, marginTop: 2 }}>A listen counts from 95 percent. A phone that listened offline shows here after it syncs.</Body>
+    </View>
+  );
+}
+
+/** The sheet behind the chip: the rule sentence, the Who listened block (when the caller passes the crew) and the two
+    Play rows (the strip, open). */
+export function ListenNowSheet({ info, onClose, crewRows, members, crewLoading }: { info: ListenNowInfo; onClose: () => void; crewRows?: CrewListenRow[]; members?: { id: string; name: string }[]; crewLoading?: boolean }) {
   const insets = useSafeAreaInsets();
   return (
     <Modal visible={!!info} transparent animationType="slide" onRequestClose={onClose}>
       <View style={{ flex: 1, justifyContent: 'flex-end' }}>
@@ -516,8 +600,9 @@ export function ListenNowSheet({ info, onClose }: { info: ListenNowInfo; onClose
                 <Icon name="close" size={14} color={C.muted} strokeWidth={2.3} />
               </Pressable>
             </View>
             <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12, paddingBottom: 6 }}>
+              {info && crewRows ? <CrewListenBlock clientId={info.id} rows={crewRows} members={members ?? []} loading={crewLoading} /> : null}
               {info ? <ClientSummaryStrip clientId={info.id} clientName={info.name} accent={GOLD} defaultOpen /> : null}
             </ScrollView>
           </View>
         </ReplayMask>
diff --git a/src/lib/clientHealthSummary.ts b/src/lib/clientHealthSummary.ts
index 641340e..6f25027 100644
--- a/src/lib/clientHealthSummary.ts
+++ b/src/lib/clientHealthSummary.ts
@@ -12,8 +12,14 @@ export type ListenEntry = {
   by_name?: string | null;
   role?: string | null;
   which: Which;
   version?: number | null;
+  /** Progress (3 Nov 2026): the best percent of this listen; absent on a legacy play (counts as heard). */
+  percent?: number | null;
+  heard?: boolean | null;
+  heard_at?: string | null;
+  carried?: boolean | null;
+  briefing_date?: string | null;
 };
 
 export type WeeklySummary = {
   generated_at?: string | null;
@@ -103,8 +109,19 @@ export const generatedAtOf = (row: ClientHealthSummaryRow | null | undefined, wh
 
 export const hasScript = (row: ClientHealthSummaryRow | null | undefined, which: Which): boolean =>
   !!summaryOf(row, which)?.script?.trim();
 
+/* ---------- Listen progress (3 Nov 2026) ----------
+   Owner: "show everyone in percent how much they listened, and an alert to listen to 100 percent so the session
+   log needs no second listen; 95 percent and above counts as 100". A trail entry now carries percent / heard; an
+   entry WITHOUT a percent key is a play from before this rule and counts as heard. */
+export const HEARD_PERCENT = 95;
+export const entryPercent = (e: ListenEntry | null | undefined): number =>
+  !e ? 0 : e.percent == null ? 100 : Math.max(0, Math.min(100, Math.round(Number(e.percent) || 0)));
+export const entryHeard = (e: ListenEntry | null | undefined): boolean => !!e && (e.percent == null ? true : entryPercent(e) >= HEARD_PERCENT);
+/** The moment an entry counts as heard: heard_at when the server stamped it, else its at. */
+export const entryHeardAt = (e: ListenEntry): string => e.heard_at ?? e.at;
+
 /** The signed-in user's newest listen of that kind (the trail is oldest first). */
 export const myLastListen = (history: ListenEntry[], which: Which, uid: string | null | undefined): ListenEntry | null => {
   if (!uid) return null;
   for (let i = history.length - 1; i >= 0; i--) {
@@ -112,8 +129,30 @@ export const myLastListen = (history: ListenEntry[], which: Which, uid: string |
     if (h.which === which && h.by === uid) return h;
   }
   return null;
 };
+/** The signed-in user's newest HEARD listen of that kind (percent at or above the threshold, or a legacy play). */
+export const myLastHeard = (history: ListenEntry[], which: Which, uid: string | null | undefined): ListenEntry | null => {
+  if (!uid) return null;
+  for (let i = history.length - 1; i >= 0; i--) {
+    const h = history[i];
+    if (h.which === which && h.by === uid && entryHeard(h)) return h;
+  }
+  return null;
+};
+/** The signed-in user's best percent for the CURRENT build of that kind (0 when nothing since the build). */
+export const myProgress = (row: ClientHealthSummaryRow | null | undefined, which: Which, uid: string | null | undefined): number => {
+  const g = generatedAtOf(row, which);
+  if (!uid || !g) return 0;
+  const built = new Date(g).getTime();
+  let best = 0;
+  for (const h of historyOf(row)) {
+    if (h.which !== which || h.by !== uid) continue;
+    if (new Date(h.at).getTime() < built && !(h.carried && entryHeard(h))) continue;
+    best = Math.max(best, entryPercent(h));
+  }
+  return best;
+};
 
 /** Anyone's newest listen of that kind. */
 export const lastListen = (history: ListenEntry[], which: Which): ListenEntry | null => {
   for (let i = history.length - 1; i >= 0; i--) if (history[i].which === which) return history[i];
@@ -139,24 +178,61 @@ export const isNewSince = (row: ClientHealthSummaryRow | null | undefined, which
    get_client_health_summary carries each person's newest earlier-day context listen
    (carried: true), so the context is heard once per update, not once per day. */
 export type GateState = 'none' | 'done' | 'due';
 
-export const gateStateFor = (row: ClientHealthSummaryRow | null | undefined, which: Which, uid: string | null | undefined, nowMs: number = Date.now()): GateState => {
+/** Since 3 Nov 2026 only a HEARD listen (95 percent or more, or a legacy play) can make a summary done; `local`
+    is the phone's own record for the current build (an offline listen not yet synced), merged in by the caller. */
+export const gateStateFor = (row: ClientHealthSummaryRow | null | undefined, which: Which, uid: string | null | undefined, nowMs: number = Date.now(), local?: LocalListen | null): GateState => {
   const g = generatedAtOf(row, which);
   if (!hasScript(row, which) || !g) return 'none';
-  const mine = myLastListen(historyOf(row), which, uid);
-  if (!mine) return 'due';
-  const heardAt = new Date(mine.at).getTime();
-  if (!isFinite(heardAt) || heardAt < new Date(g).getTime()) return 'due';
-  if (which === 'weekly' && istDayOf(mine.at) !== istDayOf(nowMs)) return 'due';
-  return 'done';
+  const built = new Date(g).getTime();
+  const mine = myLastHeard(historyOf(row), which, uid);
+  const ok = (atIso: string): boolean => {
+    const heardAt = new Date(atIso).getTime();
+    if (!isFinite(heardAt) || heardAt < built) return false;
+    if (which === 'weekly' && istDayOf(atIso) !== istDayOf(nowMs)) return false;
+    return true;
+  };
+  if (mine && ok(entryHeardAt(mine))) return 'done';
+  const v = summaryOf(row, which)?.version ?? null;
+  if (local && local.which === which && local.heard && local.heardAt && (local.version == null || v == null || local.version === v) && local.generatedAt === g && ok(local.heardAt)) return 'done';
+  return 'due';
 };
 
 export type ListenGate = { weekly: GateState; context: GateState };
-export const listenGate = (row: ClientHealthSummaryRow | null | undefined, uid: string | null | undefined, nowMs: number = Date.now()): ListenGate => ({
-  weekly: gateStateFor(row, 'weekly', uid, nowMs),
-  context: gateStateFor(row, 'context', uid, nowMs),
+/** The phone's own record of one listen (listenLocal.ts): what this phone heard of a build, synced or not. */
+export type LocalListen = {
+  clientId: string;
+  which: Which;
+  version: number | null;
+  /** The build this record is for (generated_at); another build means a new summary, the record no longer counts. */
+  generatedAt: string | null;
+  briefingDate: string | null;
+  percent: number;
+  heard: boolean;
+  heardAt: string | null;
+  at: string;
+  synced: boolean;
+};
+export type LocalListens = Partial<Record<Which, LocalListen | null>>;
+export const listenGate = (row: ClientHealthSummaryRow | null | undefined, uid: string | null | undefined, nowMs: number = Date.now(), local?: LocalListens | null): ListenGate => ({
+  weekly: gateStateFor(row, 'weekly', uid, nowMs, local?.weekly ?? null),
+  context: gateStateFor(row, 'context', uid, nowMs, local?.context ?? null),
 });
+
+/** The percent to show for one row: the server's best for the current build merged with the phone's record. */
+export const mergedProgress = (row: ClientHealthSummaryRow | null | undefined, which: Which, uid: string | null | undefined, local?: LocalListen | null): number => {
+  const server = myProgress(row, which, uid);
+  const g = generatedAtOf(row, which);
+  const mine = local && local.which === which && local.generatedAt === g ? local.percent : 0;
+  return Math.max(server, mine);
+};
+/** The lines under a Play row's progress bar (owner's words, 3 Nov 2026). */
+export const LISTEN_100_ALERT = 'Listen to 100 percent now, so you do not have to listen again when you log the session.';
+export const LISTEN_100_OK = 'Heard 100 percent, you can log.';
+export const progressLine = (percent: number): string => (percent >= HEARD_PERCENT ? LISTEN_100_OK : `You: ${Math.max(0, Math.min(100, Math.round(percent)))} percent heard`);
+export const LISTEN_OFFLINE_SAVED = 'Saved on this phone · syncs when online';
+export const LISTEN_NO_SCRIPT_OFFLINE = (first: string) => `Connect once to load ${first}'s summaries.`;
 export const gateDue = (g: ListenGate): boolean => g.weekly === 'due' || g.context === 'due';
 
 /* ---------- The rule, written once (27 Oct 2026) ----------
    Owner: "add the rule everywhere so the trainer knows why it matters and cannot log without it". Every
@@ -184,38 +260,93 @@ export const LISTEN_CHIP_OK = 'HEARD';
 export const LISTEN_CHIP_DUE_SHORT = 'NOT HEARD';
 export const listenNowLine = (clientFirstName: string | null | undefined, when: 'tomorrow' | 'today' = 'tomorrow'): string =>
   `You have not heard ${(clientFirstName ?? '').trim().split(/\s+/)[0] || 'this client'}'s summaries. You cannot log ${when}'s session without this. Listen now.`;
 
-/** One row of get_my_listen_status (a batched read for My Crew): the same gate, computed from flat fields. */
+/** One row of get_my_listen_status (a batched read for My Crew): the same gate, computed from flat fields.
+    Since 3 Nov 2026 the heard columns decide; the old my_last_*_at columns stay for older builds. */
 export type ListenStatusRow = {
   client_id: string;
   has_weekly: boolean;
   has_context: boolean;
   weekly_generated_at: string | null;
   context_generated_at: string | null;
   my_last_weekly_at: string | null;
   my_last_context_at: string | null;
+  weekly_version?: number | null;
+  context_version?: number | null;
+  my_weekly_percent?: number | null;
+  my_context_percent?: number | null;
+  my_weekly_heard?: boolean | null;
+  my_context_heard?: boolean | null;
+  my_weekly_heard_at?: string | null;
+  my_context_heard_at?: string | null;
 };
 /** True when the listen chip has something to say (a summary exists for at least one kind). */
 export const listenChipShown = (s: ListenStatusRow | null | undefined, nowMs: number = Date.now()): boolean => {
   const g = gateFromStatus(s, nowMs);
   return !(g.weekly === 'none' && g.context === 'none');
 };
-export const gateFromStatus = (s: ListenStatusRow | null | undefined, nowMs: number = Date.now()): ListenGate => {
+export const gateFromStatus = (s: ListenStatusRow | null | undefined, nowMs: number = Date.now(), local?: LocalListens | null): ListenGate => {
   const one = (which: Which): GateState => {
     if (!s) return 'none';
     const has = which === 'weekly' ? s.has_weekly : s.has_context;
     const g = which === 'weekly' ? s.weekly_generated_at : s.context_generated_at;
-    const mine = which === 'weekly' ? s.my_last_weekly_at : s.my_last_context_at;
     if (!has || !g) return 'none';
-    if (!mine) return 'due';
-    const heardAt = new Date(mine).getTime();
-    if (!isFinite(heardAt) || heardAt < new Date(g).getTime()) return 'due';
-    if (which === 'weekly' && istDayOf(mine) !== istDayOf(nowMs)) return 'due';
-    return 'done';
+    const built = new Date(g).getTime();
+    const ok = (atIso: string): boolean => {
+      const t = new Date(atIso).getTime();
+      if (!isFinite(t) || t < built) return false;
+      if (which === 'weekly' && istDayOf(atIso) !== istDayOf(nowMs)) return false;
+      return true;
+    };
+    // The server before this rule had no heard columns: fall back to the last play, as before.
+    const heardKnown = which === 'weekly' ? s.my_weekly_heard : s.my_context_heard;
+    const heardAt = which === 'weekly' ? (s.my_weekly_heard_at ?? null) : (s.my_context_heard_at ?? null);
+    const mine = heardKnown == null ? (which === 'weekly' ? s.my_last_weekly_at : s.my_last_context_at) : heardKnown ? (heardAt ?? (which === 'weekly' ? s.my_last_weekly_at : s.my_last_context_at)) : null;
+    if (mine && ok(mine)) return 'done';
+    const l = local?.[which];
+    if (l && l.heard && l.heardAt && l.generatedAt === g && ok(l.heardAt)) return 'done';
+    return 'due';
   };
   return { weekly: one('weekly'), context: one('context') };
 };
+/** My Crew chip text and tone from the status and the phone's record: HEARD 100 / 60 PERCENT · FINISH / NOT HEARD. */
+export const statusPercent = (s: ListenStatusRow | null | undefined, which: Which, local?: LocalListens | null): number => {
+  const server = which === 'weekly' ? Number(s?.my_weekly_percent ?? 0) : Number(s?.my_context_percent ?? 0);
+  const g = which === 'weekly' ? s?.weekly_generated_at : s?.context_generated_at;
+  const l = local?.[which];
+  const mine = l && g && l.generatedAt === g ? l.percent : 0;
+  return Math.max(server || 0, mine);
+};
+export const listenChipText = (gate: ListenGate, percents: Record<Which, number>, compact = false): { text: string; tone: 'red' | 'amber' | 'green' } => {
+  const due = gateDue(gate);
+  if (!due) return { text: 'HEARD 100', tone: 'green' };
+  const dueKinds = (['weekly', 'context'] as Which[]).filter((w) => gate[w] === 'due');
+  const least = Math.min(...dueKinds.map((w) => percents[w] ?? 0));
+  if (least > 0) return { text: `${Math.round(least)} PERCENT · FINISH`, tone: 'amber' };
+  return { text: compact ? LISTEN_CHIP_DUE_SHORT : LISTEN_CHIP_DUE, tone: 'red' };
+};
+/** One line of the My Crew "Who listened" block, from get_crew_listen_progress rows (best per person per kind). */
+export type CrewListenRow = { client_id: string; which: Which; by: string; by_name: string | null; role: string | null; percent: number; heard: boolean; at: string | null; version: number | null };
+export type CrewListenLine = { by: string; name: string; weekly: number | null; context: number | null; weeklyHeard: boolean; contextHeard: boolean };
+export const crewListenLines = (rows: CrewListenRow[], clientId: string, members: { id: string; name: string }[]): { crew: CrewListenLine[]; others: CrewListenLine[] } => {
+  const byId = new Map<string, CrewListenLine>();
+  const line = (id: string, name: string): CrewListenLine => byId.get(id) ?? (byId.set(id, { by: id, name, weekly: null, context: null, weeklyHeard: false, contextHeard: false }), byId.get(id)!);
+  for (const m of members) line(m.id, m.name);
+  for (const r of rows) {
+    if (r.client_id !== clientId) continue;
+    const l = line(r.by, r.by_name ?? 'Unknown');
+    if (r.which === 'weekly') { l.weekly = Math.max(l.weekly ?? 0, r.percent); l.weeklyHeard = l.weeklyHeard || r.heard; }
+    else { l.context = Math.max(l.context ?? 0, r.percent); l.contextHeard = l.contextHeard || r.heard; }
+  }
+  const memberIds = new Set(members.map((m) => m.id));
+  const all = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
+  return { crew: all.filter((l) => memberIds.has(l.by)), others: all.filter((l) => !memberIds.has(l.by)) };
+};
+export const crewLineText = (l: CrewListenLine): string => {
+  const one = (p: number | null, heard: boolean) => (p == null ? '0 percent' : heard ? '100 percent' : `${Math.round(p)} percent`);
+  return `This week ${one(l.weekly, l.weeklyHeard)} · Health context ${one(l.context, l.contextHeard)}`;
+};
 
 /* ---------- The Add Workout listen sheet (22 Oct 2026) ----------
    Owner: "after both listens the trainer must tap Proceed to workout". Play records the listen on the server at
    once, so the refreshed row reads "done" seconds into the audio. Before this fix the second Play therefore made
diff --git a/src/lib/clientHealthSummaryQueries.ts b/src/lib/clientHealthSummaryQueries.ts
index 59df888..640c5ea 100644
--- a/src/lib/clientHealthSummaryQueries.ts
+++ b/src/lib/clientHealthSummaryQueries.ts
@@ -5,12 +5,12 @@
    trainers, any doctor or therapist, CRM and managers, and whoever the server lets
    listen; an unauthorised user simply gets no row). The direct table read of 9 Oct
    broke on 10 Oct (42703: weekly_generated_at no longer exists) and hid the card on
    every client page until 15 Oct 2026. Write: the listen trail through log_summary_listen. */
-import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
+import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
 import { supabase } from './supabase';
 import { withTimeout, NET_MS } from './withTimeout';
-import type { ClientHealthSummaryRow, ListenEntry, Which, ListenStatusRow } from './clientHealthSummary';
+import type { ClientHealthSummaryRow, ListenEntry, Which, ListenStatusRow, CrewListenRow } from './clientHealthSummary';
 import { friendlyError } from './friendlyError';
 
 export const HEALTH_SUMMARY_KEY = 'client-health-summary';
 
@@ -56,10 +56,11 @@ export function useClientHealthSummary(clientId: string | null | undefined, enab
 
 const friendlyListenError = (e: { code?: string; message: string }): string =>
   e.code === 'PGRST202' ? 'Listening is not set up on the server yet. Tell the tech team.' : e.message;
 
-/** log_summary_listen(p_client_id, p_which): appends {at, by, by_name, role, which, version, briefing_date}
-    to the row in effect today. */
+/** log_summary_listen(p_client_id, p_which, p_at, p_briefing_date, p_device): appends {at, by, by_name, role, which,
+    version, briefing_date, percent 0, heard false} to the row in effect. Since 3 Nov 2026 the rows write through
+    listenSync (phone record first, outbox when offline); this direct mutation stays for callers that need the entry. */
 export function useLogSummaryListen(clientId: string | null | undefined) {
   const qc = useQueryClient();
   return useMutation({
     mutationFn: async (which: Which): Promise<ListenEntry> => {
@@ -74,8 +75,40 @@ export function useLogSummaryListen(clientId: string | null | undefined) {
     onSettled: () => { qc.invalidateQueries({ queryKey: [HEALTH_SUMMARY_KEY, clientId ?? null] }); },
   });
 }
 
+/** My Crew (3 Nov 2026): everyone's best percent per client and summary (get_crew_listen_progress), one call per plan.
+    Before the migration (PGRST202) the list is empty. */
+export function useCrewListenProgress(clientIds: string[], enabled: boolean) {
+  const ids = [...new Set(clientIds.filter(Boolean))].sort();
+  return useQuery({
+    queryKey: ['crew-listen-progress', ids.join(',')],
+    enabled: enabled && ids.length > 0,
+    staleTime: 60_000,
+    refetchOnWindowFocus: true,
+    queryFn: async (): Promise<CrewListenRow[]> => {
+      const { data, error } = await withTimeout(
+        Promise.resolve((supabase.rpc as any)('get_crew_listen_progress', { p_client_ids: ids })) as Promise<{ data: any; error: any }>,
+        NET_MS, 'Who listened');
+      if (error) {
+        if (error.code === 'PGRST202' || /could not find the function/i.test(String(error.message ?? ''))) return [];
+        throw new Error(friendlyError(error, 'Could not read who listened.'));
+      }
+      return ((data ?? []) as any[]).map((r) => ({
+        client_id: String(r.client_id), which: r.which === 'weekly' ? 'weekly' : 'context', by: String(r.by), by_name: r.by_name ?? null, role: r.role ?? null,
+        percent: Number(r.percent) || 0, heard: r.heard === true, at: r.at ?? null, version: r.version == null ? null : Number(r.version),
+      }));
+    },
+  });
+}
+
+/** Prefetch the rows of a list of clients so their scripts are on the phone for an offline listen (My Crew's
+    Tomorrow's Plan, opened online). Same key as the card and the gate (today's row). */
+export async function prefetchClientHealthSummaries(qc: QueryClient, clientIds: string[]): Promise<void> {
+  const ids = [...new Set(clientIds.filter(Boolean))].slice(0, 30);
+  await Promise.all(ids.map((id) => qc.prefetchQuery({ queryKey: [HEALTH_SUMMARY_KEY, id, 'today'], queryFn: () => fetchClientHealthSummary(id, null), staleTime: 60_000 }).catch(() => {})));
+}
+
 /** My Crew (27 Oct 2026): the listen gate inputs for a list of clients in one call (get_my_listen_status). A client the
     caller may not listen to is missing from the map; before the migration (PGRST202) the map is empty, no chips. */
 export function useMyListenStatuses(clientIds: string[], enabled: boolean) {
   const ids = [...new Set(clientIds.filter(Boolean))].sort();
@@ -97,8 +130,13 @@ export function useMyListenStatuses(clientIds: string[], enabled: boolean) {
         out[String(r.client_id)] = {
           client_id: String(r.client_id), has_weekly: r.has_weekly === true, has_context: r.has_context === true,
           weekly_generated_at: r.weekly_generated_at ?? null, context_generated_at: r.context_generated_at ?? null,
           my_last_weekly_at: r.my_last_weekly_at ?? null, my_last_context_at: r.my_last_context_at ?? null,
+          // progress columns (3 Nov 2026); absent before the migration, then the chip falls back to the last play
+          weekly_version: r.weekly_version == null ? null : Number(r.weekly_version), context_version: r.context_version == null ? null : Number(r.context_version),
+          my_weekly_percent: r.my_weekly_percent == null ? null : Number(r.my_weekly_percent), my_context_percent: r.my_context_percent == null ? null : Number(r.my_context_percent),
+          my_weekly_heard: typeof r.my_weekly_heard === 'boolean' ? r.my_weekly_heard : null, my_context_heard: typeof r.my_context_heard === 'boolean' ? r.my_context_heard : null,
+          my_weekly_heard_at: r.my_weekly_heard_at ?? null, my_context_heard_at: r.my_context_heard_at ?? null,
         };
       }
       return out;
     },
diff --git a/src/lib/offline.ts b/src/lib/offline.ts
index 478383e..d7407d4 100644
--- a/src/lib/offline.ts
+++ b/src/lib/offline.ts
@@ -23,9 +23,9 @@ const OUTBOX_KEY = 'outbox:v1';
 
 export type OutboxItem = {
   id: string;
   userId?: string;        // who queued it — items never drain (or show) under another account
-  kind: 'workout-log' | 'create-plan' | 'edit-plan' | 'chat-message' | 'location-log' | 'screenshot-log' | 'session-voice-note' | 'nav-track' | 'route-ended' | 'session-otp-verify';
+  kind: 'workout-log' | 'create-plan' | 'edit-plan' | 'chat-message' | 'location-log' | 'screenshot-log' | 'session-voice-note' | 'nav-track' | 'route-ended' | 'session-otp-verify' | 'summary-listen' | 'summary-listen-progress';
   label: string;          // human line for the pending-sync UI
   createdAt: string;      // ORIGINAL device timestamp at submit time
   status: 'pending' | 'syncing' | 'failed';
   attempts: number;
@@ -329,8 +329,16 @@ async function processItem(item: OutboxItem): Promise<{ linkPending?: boolean }
     // Route tracker end event (21 Oct 2026): the office's permanent ride record when the
     // phone was offline at Arrived / Exit. Lazy require: routeTracker imports enqueue.
     const { submitRouteEnded } = require('./routeTracker');
     await submitRouteEnded(item.payload);
+  } else if (item.kind === 'summary-listen' || item.kind === 'summary-listen-progress') {
+    // Spoken-summary listens made offline (3 Nov 2026): the Play entry, then the best percent, each with the
+    // real heard time and the briefing day it was heard on. Lazy require: listenSync imports enqueue.
+    const { submitQueuedListen } = require('./listenSync');
+    await submitQueuedListen(item.kind, item.payload);
+    qcRef?.invalidateQueries({ queryKey: ['client-health-summary', item.payload?.clientId] });
+    qcRef?.invalidateQueries({ queryKey: ['listen-status'] });
+    qcRef?.invalidateQueries({ queryKey: ['crew-listen-progress'] });
   }
 }
 
 export async function drainOutbox() {
diff --git a/src/lib/summaryVoice.ts b/src/lib/summaryVoice.ts
index 963d002..edbd113 100644
--- a/src/lib/summaryVoice.ts
+++ b/src/lib/summaryVoice.ts
@@ -44,12 +44,16 @@ export type PlayCallbacks = {
   /** The whole summary was heard to the end (recording or device voice). */
   onDone?: () => void;
   /** Neither the recording nor the device voice could speak. */
   onError?: (message: string) => void;
+  /** How much of the summary has been heard so far, 0 to 100 (3 Nov 2026): the recording from the player's
+      position across its parts, the device voice from the sentences spoken. Reported at most once per percent
+      step and once more when the run stops early (the final percent). */
+  onProgress?: (percent: number, final: boolean) => void;
 };
 
 /* ---------- injected dependencies (the real ones are below) ---------- */
-export type PlayerStatus = { isLoaded?: boolean; playing?: boolean; didJustFinish?: boolean; error?: string | null };
+export type PlayerStatus = { isLoaded?: boolean; playing?: boolean; didJustFinish?: boolean; error?: string | null; currentTime?: number; duration?: number };
 export type PlayerLike = {
   play(): void;
   pause(): void;
   replace(source: { uri: string }): void;
@@ -62,8 +66,10 @@ export type DeviceSpeechCallbacks = {
   onPause?: () => void;
   onResume?: () => void;
   /** Someone else stopped the device voice (it is one engine for the whole app). */
   onStopped?: () => void;
+  /** Sentences spoken so far of the total (progress for the device voice). */
+  onChunk?: (spoken: number, total: number) => void;
 };
 export type SummaryVoiceDeps = {
   getAudio: (req: SummaryAudioRequest) => Promise<string[]>;
   makePlayer: (uri: string) => PlayerLike;
@@ -131,13 +137,30 @@ export function createSummaryVoice(deps: SummaryVoiceDeps, onState: (s: SummaryV
     try { c(); } catch { /* gone */ }
     deps.deviceStop();
   };
 
+  // Progress of the current run (3 Nov 2026): the last percent reported, so a stop can report the final figure
+  // once and a percent is never reported twice.
+  let lastPct = -1;
+  let progressCb: PlayCallbacks['onProgress'] | undefined;
+  const report = (pct: number, final = false) => {
+    const p = Math.max(0, Math.min(100, Math.floor(pct)));
+    if (!progressCb) return;
+    if (final) { if (p > lastPct) lastPct = p; progressCb(lastPct < 0 ? 0 : lastPct, true); return; }
+    if (p <= lastPct) return;
+    lastPct = p;
+    progressCb(p, false);
+  };
+
   const stop = () => {
+    const hadRun = state.phase !== 'idle' && lastPct >= 0;
     run++;
     releaseAudioFocus(holder);
     releasePlayer();
     endDevice();
+    if (hadRun) report(lastPct, true);
+    lastPct = -1;
+    progressCb = undefined;
     emit({ ...IDLE_VOICE });
   };
   /** A run ended on its own (heard to the end, or nothing could speak). */
   const finished = () => { run++; cancelDevice = null; releaseAudioFocus(holder); };
@@ -146,14 +169,15 @@ export function createSummaryVoice(deps: SummaryVoiceDeps, onState: (s: SummaryV
   const speakDevice = (myRun: number, id: string, script: string, cb: PlayCallbacks | undefined, notice: string | null) => {
     releasePlayer();
     emit({ id, phase: 'playing', source: 'device', notice, part: 0, parts: 0 });
     const cancel = deps.deviceSpeak(script, {
-      onDone: () => { if (myRun !== run) return; finished(); emit({ ...IDLE_VOICE, notice }); cb?.onDone?.(); },
+      onDone: () => { if (myRun !== run) return; report(100); report(100, true); finished(); emit({ ...IDLE_VOICE, notice }); cb?.onDone?.(); },
       onError: (m) => { if (myRun !== run) return; finished(); emit({ ...IDLE_VOICE, notice }); cb?.onError?.(m); },
       onPause: () => { if (myRun === run) emit({ phase: 'paused' }); },
       onResume: () => { if (myRun === run) emit({ phase: 'playing' }); },
       // The engine was stopped from outside (another reader): this reading is over, not heard.
-      onStopped: () => { if (myRun !== run) return; finished(); emit({ ...IDLE_VOICE, notice }); },
+      onStopped: () => { if (myRun !== run) return; report(lastPct, true); finished(); emit({ ...IDLE_VOICE, notice }); },
+      onChunk: (spoken, total) => { if (myRun === run && total > 0) report(Math.min(99, (spoken / total) * 100)); },
     });
     if (myRun === run) cancelDevice = typeof cancel === 'function' ? cancel : () => {};
   };
 
@@ -176,18 +200,26 @@ export function createSummaryVoice(deps: SummaryVoiceDeps, onState: (s: SummaryV
     sub = p.addListener('playbackStatusUpdate', (st) => {
       if (myRun !== run || fellBack) return;
       if (st.error) { fallback(st.error); return; }
       if (st.playing && !started) { started = true; clearStall(); }
+      // Progress: parts finished plus the position inside the current part, parts weighted equally (they are
+      // cut at near-equal sentence counts). Never 100 before the last part reports its finish.
+      if (started && typeof st.currentTime === 'number' && typeof st.duration === 'number' && st.duration > 0) {
+        const inPart = Math.max(0, Math.min(1, st.currentTime / st.duration));
+        report(Math.min(99, ((i + inPart) / urls.length) * 100));
+      }
       // A finish counts once per part: only after the part was heard playing (a repeated
       // end-of-part status while the next source loads must not skip a part).
       if (st.didJustFinish && started) {
         started = false;
         i++;
         if (i < urls.length) {
+          report(Math.min(99, (i / urls.length) * 100));
           emit({ part: i + 1 });
           armStall(myRun, () => fallback('no sound'));
           try { p.replace({ uri: urls[i] }); p.play(); } catch (e) { fallback(msgOf(e)); }
         } else {
+          report(100); report(100, true);
           finished();
           releasePlayer();
           emit({ ...IDLE_VOICE });
           cb?.onDone?.();
@@ -202,8 +234,10 @@ export function createSummaryVoice(deps: SummaryVoiceDeps, onState: (s: SummaryV
     // Our own previous run first, then the focus: whatever else in the app is sounding stops.
     stop();
     claimAudioFocus(holder);
     const myRun = run;
+    progressCb = cb?.onProgress;
+    lastPct = cb?.onProgress ? 0 : -1;
     emit({ id, phase: 'preparing', source: null, notice: null, part: 0, parts: 0 });
     deps.getAudio(req)
       .then((urls) => {
         if (myRun !== run) return;
@@ -276,8 +310,9 @@ function deviceSpeak(text: string, cb: DeviceSpeechCallbacks): () => void {
   if (!parts.length) { cb.onError('Nothing to read.'); return cancel; }
   let i = 0;
   const next = () => {
     if (dead) return;
+    if (i > 0) cb.onChunk?.(i, parts.length);
     if (i >= parts.length) { dead = true; cb.onDone(); return; }
     try {
       Speech.speak(parts[i++], {
         language: 'en-IN',
diff --git a/src/screens/managerChat.tsx b/src/screens/managerChat.tsx
index 05f5638..c0d6fa3 100644
--- a/src/screens/managerChat.tsx
+++ b/src/screens/managerChat.tsx
@@ -27,9 +27,11 @@ import { EssentialsBadge } from '../components/essentialsBadge';
 import { LatestVoiceChip, LatestVoicePopup, LatestVoiceInfo } from '../components/SessionVoice';
 import { useClientsLatestVoiceNotes } from '../lib/sessionVoiceQueries';
 import { ListenStatusChip, ListenNowSheet, type ListenNowInfo } from '../components/clientHealthSummaryCard';
 import { listenChipShown } from '../lib/clientHealthSummary';
-import { useMyListenStatuses } from '../lib/clientHealthSummaryQueries';
+import { useMyListenStatuses, useCrewListenProgress, prefetchClientHealthSummaries } from '../lib/clientHealthSummaryQueries';
+import { useLocalListensMap } from '../lib/listenLocal';
+import { useIsOnline } from '../lib/offline';
 import { friendlyError } from '../lib/friendlyError';
 import { shortNames, shortNameFor } from '../lib/crewNames';
 import { usePlanCover } from '../lib/managerChatQueries';
 import { coverFor, coverBlockedLine, coverReviewLine, coverKicker, coverAction, coverSendBlockedText, coverServerRefusedText, isPlanExpiredResult, isPlanCoverRefusal, planModalityFor, COVER_CTA, COVER_CTA_REVISION, COVER_CARD_TAG, type PlanCoverRow } from '../lib/planCover';
@@ -1452,8 +1454,20 @@ function TomorrowPlanSheet({ visible, onClose, onSend, sending, existing, addOnl
   // The listen rule on each row (27 Oct 2026): one batched read, the chip opens the Listen now sheet.
   const listenQ = useMyListenStatuses(rows.map((r) => r.clientId), visible);
   const listenById = listenQ.data ?? {};
   const [listenFor, setListenFor] = React.useState<ListenNowInfo>(null);
+  // Listen progress (3 Nov 2026): the phone's own records (offline listens count at once), everyone's percent for the
+  // Who listened block, and the rows prefetched while online so tomorrow's summaries can be heard offline.
+  const listenLocal = useLocalListensMap(rows.map((r) => r.clientId));
+  const crewListenQ = useCrewListenProgress(rows.map((r) => r.clientId), visible);
+  const qcListen = useQueryClient();
+  const onlineForPrefetch = useIsOnline();
+  const crewTeamQ = useMyManagerTeam(); // cached: the chat screen reads the same query
+  const crewMembers = (crewTeamQ.data?.members ?? []).map((m) => ({ id: m.id, name: m.name }));
+  React.useEffect(() => {
+    if (!visible || !onlineForPrefetch || !rows.length) return;
+    prefetchClientHealthSummaries(qcListen, rows.map((r) => r.clientId));
+  }, [visible, onlineForPrefetch, rows.map((r) => r.clientId).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
   const latestVoice = latestVoiceQ.data ?? {};
   const [voiceFor, setVoiceFor] = React.useState<LatestVoiceInfo>(null);
   // Expired-plan gate (27 Oct 2026): one batched read; a selected row whose plan for the picked modality is
   // expired on that day shows the box and cannot be sent. Rules in src/lib/planCover.ts.
@@ -1592,9 +1606,9 @@ function TomorrowPlanSheet({ visible, onClose, onSend, sending, existing, addOnl
             "…", drew over the checkbox and avatar, and pushed the modality and time buttons off the screen. */}
         {hasChips ? (
           <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, paddingLeft: 42, paddingRight: 11, paddingBottom: 10 }}>
               {latestVoice[r.clientId] ? <LatestVoiceChip compact latest={latestVoice[r.clientId]} onPress={() => setVoiceFor({ name: r.name, latest: latestVoice[r.clientId] })} /> : null}
-              <ListenStatusChip compact status={listenById[r.clientId]} onPress={() => setListenFor({ id: r.clientId, name: r.name })} />
+              <ListenStatusChip compact status={listenById[r.clientId]} local={listenLocal[r.clientId]} onPress={() => setListenFor({ id: r.clientId, name: r.name })} />
               {cycles[r.clientId] ? <CycleChip cycle={cycles[r.clientId]} onPress={() => setCycleFor({ name: r.name, cycle: cycles[r.clientId] })} /> : null}
               {essentials[r.clientId] ? <EssentialsBadge status={essentials[r.clientId]} compact /> : null}
               {protocols[r.clientId] ? <ProtocolChip onPress={() => setProtoFor({ name: r.name, proto: protocols[r.clientId] })} /> : null}
           </View>
@@ -1686,9 +1700,10 @@ function TomorrowPlanSheet({ visible, onClose, onSend, sending, existing, addOnl
       </View>
       <ProtocolPopup info={protoFor} onClose={() => setProtoFor(null)} />
       <CyclePopup info={cycleFor} onClose={() => setCycleFor(null)} />
       <LatestVoicePopup info={voiceFor} onClose={() => setVoiceFor(null)} />
-      <ListenNowSheet info={listenFor} onClose={() => { setListenFor(null); listenQ.refetch(); }} />
+      <ListenNowSheet info={listenFor} onClose={() => { setListenFor(null); listenQ.refetch(); crewListenQ.refetch(); }}
+        crewRows={crewListenQ.data ?? []} crewLoading={crewListenQ.isLoading} members={crewMembers} />
     </Modal>
   );
 }
 
diff --git a/src/screens/trainer.tsx b/src/screens/trainer.tsx
index ede2393..41dab65 100644
--- a/src/screens/trainer.tsx
+++ b/src/screens/trainer.tsx
@@ -26,8 +26,9 @@ import { BloodReportSheet, QhpReportSheet, ConsultAiSheet } from './reportDetail
 import { useClientCycleStatus, ClientCycle } from '../lib/cycleQueries';
 import { CycleChip, CyclePopup, CyclePopupInfo, cycleColor } from '../components/cycleLabel';
 import { EssentialsBadge } from '../components/essentialsBadge';
 import { ClientHealthSummaryCard, ListenGateSheet, ClientSummaryStrip } from '../components/clientHealthSummaryCard';
+import { useLocalListens } from '../lib/listenLocal';
 import { LatestRecoveryLine } from '../components/LatestHealthData';
 import { dayMonth, dayBefore } from '../lib/latestDaily';
 import { useClientHealthSummary } from '../lib/clientHealthSummaryQueries';
 import { listenGate, gateDue, listenSheetUp } from '../lib/clientHealthSummary';
@@ -6715,16 +6716,20 @@ export function Workout() {
   // the health context whenever a new report rebuilt it. Roster-opened logs
   // only, online only, never while editing a queued log; fails open when the
   // row cannot be read (no summary = nothing to require).
   const { session: authSession, dbRole: authRole } = useAuth();
-  const listenEligible = !!workoutScheduleId && !editingOutboxId && isOnline;
+  // Since 3 Nov 2026 the gate works offline too (owner: "no network must work the same"): the row comes from the
+  // persisted cache, the device voice reads it, and the phone's own listen record (listenLocal) clears the gate until
+  // the outbox syncs it. Only a client whose row was never loaded on this phone has nothing to require.
+  const listenEligible = !!workoutScheduleId && !editingOutboxId;
   const summaryQ = useClientHealthSummary(selectedClientId, listenEligible);
+  const listenLocal = useLocalListens(listenEligible ? selectedClientId : null);
   const [listenDone, setListenDone] = React.useState(false);
   // Once needed, the listen sheet STAYS up until the trainer taps Proceed to workout (22 Oct 2026): Play records the
   // listen at once, so the refreshed row read "done" and closed the sheet mid-audio on the second Play.
   const [listenArmed, setListenArmed] = React.useState(false);
   React.useEffect(() => { setListenDone(false); setListenArmed(false); }, [selectedClientId, workoutScheduleId, editingOutboxId]);
-  const listenDue = listenEligible && !!summaryQ.data && gateDue(listenGate(summaryQ.data, authSession?.user?.id ?? null));
+  const listenDue = listenEligible && !!summaryQ.data && gateDue(listenGate(summaryQ.data, authSession?.user?.id ?? null, Date.now(), listenLocal));
   React.useEffect(() => { if (listenDue && !listenDone) setListenArmed(true); }, [listenDue, listenDone]);
   const listenRequired = listenSheetUp({ done: listenDone, armed: listenArmed, eligible: listenEligible, due: listenDue });
   // Session timer (13 Oct 2026): a log whose health data is already complete starts its
   // timer on entry (gate 'skipped'); when the check-in sheet has to open, its Save starts
diff --git a/tests/rules/health_summary_rules_test.js b/tests/rules/health_summary_rules_test.js
index 4fc391a..43d3227 100644
--- a/tests/rules/health_summary_rules_test.js
+++ b/tests/rules/health_summary_rules_test.js
@@ -104,6 +104,44 @@ eq('button copy', [R.LISTEN_PROCEED, R.LISTEN_WAIT], ['Proceed to workout', 'Lis
 eq('listen chip shown: both built', R.listenChipShown(st, NOW), true);
 eq('listen chip hidden: nothing built', R.listenChipShown({ ...st, has_weekly: false, has_context: false }, NOW), false);
 eq('listen chip shown: only the context built', R.listenChipShown({ ...st, has_weekly: false }, NOW), true);
 eq('short label', R.LISTEN_CHIP_DUE_SHORT, 'NOT HEARD');
+
+/* ---- listen progress (3 Nov 2026): heard only from 95 percent; legacy plays count; offline record merges ---- */
+eq('legacy entry (no percent) is heard at 100', [R.entryHeard({ at: 'x', by: ME, which: 'weekly' }), R.entryPercent({ at: 'x', by: ME, which: 'weekly' })], [true, 100]);
+eq('94 is not heard, 95 is', [R.entryHeard({ at: 'x', by: ME, which: 'weekly', percent: 94 }), R.entryHeard({ at: 'x', by: ME, which: 'weekly', percent: 95 })], [false, true]);
+const playedToday = [{ at: '2026-10-09T02:00:00Z', by: ME, which: 'weekly', percent: 40, heard: false }, { at: '2026-10-06T02:00:00Z', by: ME, which: 'context', percent: 30, heard: false }];
+eq('a Play stopped at 40 and 30 percent leaves both due', R.listenGate(row({ listen_history: playedToday }), ME, NOW), { weekly: 'due', context: 'due' });
+const heardToday = [{ at: '2026-10-09T02:00:00Z', by: ME, which: 'weekly', percent: 97, heard: true, heard_at: '2026-10-09T02:05:00Z' }, { at: '2026-10-06T02:00:00Z', by: ME, which: 'context', percent: 100, heard: true }];
+eq('97 percent today and 100 percent context are done', R.listenGate(row({ listen_history: heardToday }), ME, NOW), { weekly: 'done', context: 'done' });
+eq('my progress: best percent of the current build', R.myProgress(row({ listen_history: [{ at: '2026-10-09T01:00:00Z', by: ME, which: 'weekly', percent: 20 }, { at: '2026-10-09T02:00:00Z', by: ME, which: 'weekly', percent: 60 }, { at: '2026-10-07T02:00:00Z', by: ME, which: 'weekly', percent: 100 }] }), 'weekly', ME), 60);
+eq('my progress: someone else does not count', R.myProgress(row({ listen_history: [{ at: '2026-10-09T02:00:00Z', by: OTHER, which: 'weekly', percent: 100 }] }), 'weekly', ME), 0);
+const localHeard = { clientId: 'c', which: 'weekly', version: null, generatedAt: '2026-10-08T18:29:00Z', briefingDate: null, percent: 96, heard: true, heardAt: '2026-10-09T03:00:00Z', at: '2026-10-09T02:50:00Z', synced: false };
+eq('offline record heard today clears the weekly gate', R.listenGate(row(), ME, NOW, { weekly: localHeard }).weekly, 'done');
+eq('offline record for another build does not', R.listenGate(row(), ME, NOW, { weekly: { ...localHeard, generatedAt: '2026-10-07T18:29:00Z' } }).weekly, 'due');
+eq('offline record at 50 does not', R.listenGate(row(), ME, NOW, { weekly: { ...localHeard, percent: 50, heard: false, heardAt: null } }).weekly, 'due');
+eq('merged progress takes the higher of server and phone', R.mergedProgress(row({ listen_history: [{ at: '2026-10-09T02:00:00Z', by: ME, which: 'weekly', percent: 40 }] }), 'weekly', ME, { ...localHeard, percent: 70, heard: false }), 70);
+eq('progress lines', [R.progressLine(60), R.progressLine(95), R.progressLine(100)], ['You: 60 percent heard', 'Heard 100 percent, you can log.', 'Heard 100 percent, you can log.']);
+eq('alert sentence', R.LISTEN_100_ALERT, 'Listen to 100 percent now, so you do not have to listen again when you log the session.');
+// the batched status with the new columns
+const stNew = { ...st, my_last_weekly_at: '2026-10-09T02:00:00Z', my_weekly_percent: 40, my_weekly_heard: false, my_weekly_heard_at: null, my_context_percent: 100, my_context_heard: true, my_context_heard_at: '2026-10-06T02:00:00Z', my_last_context_at: '2026-10-06T02:00:00Z' };
+eq('status: a 40 percent play today is due, the heard context is done', R.gateFromStatus(stNew, NOW), { weekly: 'due', context: 'done' });
+eq('status: old server without heard columns falls back to the last play', R.gateFromStatus({ ...st, my_last_weekly_at: '2026-10-09T02:00:00Z', my_last_context_at: '2026-10-06T02:00:00Z' }, NOW), { weekly: 'done', context: 'done' });
+eq('status: the phone record clears it', R.gateFromStatus(stNew, NOW, { weekly: localHeard }).weekly, 'done');
+eq('chip: 40 percent due reads FINISH', R.listenChipText({ weekly: 'due', context: 'done' }, { weekly: 40, context: 100 }), { text: '40 PERCENT · FINISH', tone: 'amber' });
+eq('chip: nothing played reads NOT HEARD', R.listenChipText({ weekly: 'due', context: 'due' }, { weekly: 0, context: 0 }, true), { text: 'NOT HEARD', tone: 'red' });
+eq('chip: all heard', R.listenChipText({ weekly: 'done', context: 'done' }, { weekly: 100, context: 100 }), { text: 'HEARD 100', tone: 'green' });
+eq('status percent merges the phone record', R.statusPercent(stNew, 'weekly', { weekly: { ...localHeard, percent: 80, heard: false } }), 80);
+// the crew block
+const crewRows = [
+  { client_id: 'c', which: 'weekly', by: 'm1', by_name: 'Sagar Sharma', role: 'trainer', percent: 100, heard: true, at: null, version: 5 },
+  { client_id: 'c', which: 'context', by: 'm1', by_name: 'Sagar Sharma', role: 'trainer', percent: 40, heard: false, at: null, version: 2 },
+  { client_id: 'c', which: 'weekly', by: 'x9', by_name: 'Dr Who', role: 'doctor', percent: 97, heard: true, at: null, version: 5 },
+  { client_id: 'other', which: 'weekly', by: 'm2', by_name: 'Priya', role: 'trainer', percent: 100, heard: true, at: null, version: 5 },
+];
+const lines = R.crewListenLines(crewRows, 'c', [{ id: 'm1', name: 'Sagar Sharma' }, { id: 'm2', name: 'Priya Singh' }]);
+eq('crew lines: every member listed, others separate', [lines.crew.map((l) => l.name), lines.others.map((l) => l.name)], [['Priya Singh', 'Sagar Sharma'], ['Dr Who']]);
+eq('crew line text: Sagar', R.crewLineText(lines.crew[1]), 'This week 100 percent · Health context 40 percent');
+eq('crew line text: Priya never played this client', R.crewLineText(lines.crew[0]), 'This week 0 percent · Health context 0 percent');
+eq('crew line text: 97 reads as 100 (heard)', R.crewLineText(lines.others[0]), 'This week 100 percent · Health context 0 percent');
 console.log(fails ? `${fails} FAILED` : 'ALL PASS');
 process.exit(fails ? 1 : 0);
diff --git a/tests/rules/summary_voice_test.js b/tests/rules/summary_voice_test.js
index cd22ee8..5facf8f 100644
--- a/tests/rules/summary_voice_test.js
+++ b/tests/rules/summary_voice_test.js
@@ -322,8 +322,53 @@ const last = (log) => log.states[log.states.length - 1];
     focus.releaseAudioFocus(other);
     void otherSilenced;
   }
 
+  /* 17. progress (3 Nov 2026): parts plus the position inside a part, 100 only at the end, the final percent on stop */
+  {
+    const { ctl, log, handles } = build();
+    const prog = [];
+    ctl.play('weekly', REQ, { onProgress: (p, final) => prog.push(final ? `F${p}` : p) });
+    await tick(); await tick();
+    handles[0]._status({ playing: true, currentTime: 5, duration: 10 });   // half of part 1 of 3 = 16
+    handles[0]._status({ playing: true, currentTime: 5, duration: 10 });   // same percent, not repeated
+    handles[0]._status({ playing: true, didJustFinish: true });            // part 1 done = 33
+    handles[0]._status({ playing: true, currentTime: 9, duration: 10 });   // part 2 at 90 percent = 63
+    handles[0]._status({ playing: true, didJustFinish: true });            // part 2 done = 66
+    handles[0]._status({ playing: true, currentTime: 10, duration: 10 });  // part 3 at the end but not finished = 99
+    handles[0]._status({ playing: true, didJustFinish: true });            // all done = 100, final
+    eq('recording progress steps', prog, [16, 33, 63, 66, 99, 100, 'F100']);
+    eq('no progress after the end', (ctl.stop(), prog.length), 7);
+  }
+  {
+    const { ctl, handles } = build();
+    const prog = [];
+    ctl.play('weekly', REQ, { onProgress: (p, final) => prog.push(final ? `F${p}` : p) });
+    await tick(); await tick();
+    handles[0]._status({ playing: true, currentTime: 4, duration: 10 });   // 13
+    ctl.stop();
+    eq('a stop reports the final percent once', prog, [13, 'F13']);
+  }
+  {
+    const { ctl, log } = build({ getAudio: async () => { throw new Error('offline'); } });
+    const prog = [];
+    ctl.play('weekly', REQ, { onProgress: (p, final) => prog.push(final ? `F${p}` : p) });
+    await tick(); await tick();
+    const d = log.device[0].cb;
+    d.onChunk(1, 4); d.onChunk(2, 4); d.onChunk(3, 4); d.onDone();
+    eq('device voice progress by sentences, 100 at the end', prog, [25, 50, 75, 100, 'F100']);
+  }
+  {
+    const { ctl, log } = build({ getAudio: async () => { throw new Error('offline'); } });
+    const prog = [];
+    ctl.play('weekly', REQ, { onProgress: (p, final) => prog.push(final ? `F${p}` : p) });
+    await tick(); await tick();
+    const d = log.device[0].cb;
+    d.onChunk(1, 4);
+    d.onStopped();
+    eq('device voice stopped from outside reports the final percent', prog, [25, 'F25']);
+  }
+
   /* 16. message helpers */
   eq('CLOUD_UNAVAILABLE text', V.CLOUD_UNAVAILABLE('x'), "Cloud voice unavailable (x); using this device's voice.");
   eq('STALL_MS', V.STALL_MS, 15000);
   eq('SPEAK_FN_MS', V.SPEAK_FN_MS, 45000);
```

### Server (reference; nothing to build on iOS)
```sql
-- ============================================================================
-- Client health summary: listen progress in percent, "heard" only from 95 percent (3 Nov 2026)
-- Owner: "on My Crew show everyone in percent how much they listened, an alert to listen to 100 percent so the
-- session log needs no second listen, and no network must work the same". Plan: odds-app/docs/listen-progress-plan.md.
--
-- Before: log_summary_listen appended a trail entry the moment Play was pressed; nothing recorded how far anyone
-- listened, and a Play stopped at once cleared the Add Workout gate for the day.
-- Now:
--   1. A trail entry carries percent (0..100), heard (percent >= 95, owner: "treat 95 percent and above as 100"),
--      heard_at, updated_at, device. The Play entry starts at percent 0. An entry WITHOUT a percent key is a legacy
--      play from before this migration and counts as heard (nobody is blocked for yesterday's plays).
--   2. log_summary_listen_progress(client, which, percent, version, at, briefing_date): the caller's newest entry for
--      that summary version gets the best percent so far (never lower). at / briefing_date let an offline listen sync
--      later with the real heard time onto the row it was heard on (7-day window, never the future). A version that
--      no longer matches the row's summary answers {stale: true} and writes nothing.
--   3. get_my_listen_status gains my_*_percent / my_*_heard / my_*_heard_at for the CURRENT version (the old
--      my_last_*_at columns keep their meaning so older app builds behave as before).
--   4. get_crew_listen_progress(clients): per client, per listener, the best percent for each summary's current
--      version (My Crew's "Who listened" block). Same visibility rule as everything else (can_listen_client_summary
--      through get_client_health_summary).
--   5. get_client_health_summary carries a person's earlier-day context listen preferring a HEARD one (a 100 percent
--      on Monday is not hidden by a 30 percent replay on Wednesday of the same version).
-- A rolled-back probe (14 checks) at the end.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Config and helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.summary_listen_heard_percent()
RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT 95 $$;   -- owner, 3 Nov 2026: 95 percent and above counts as heard
GRANT EXECUTE ON FUNCTION public.summary_listen_heard_percent() TO authenticated, service_role;

/** Is this trail entry a heard one: percent at or above the threshold, or a legacy entry without a percent key. */
CREATE OR REPLACE FUNCTION public.summary_listen_entry_heard(e jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN e ? 'percent' THEN COALESCE((e->>'percent')::int, 0) >= 95 ELSE true END
$$;
/** The percent a trail entry stands for: its percent, or 100 for a legacy entry. */
CREATE OR REPLACE FUNCTION public.summary_listen_entry_percent(e jsonb)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN e ? 'percent' THEN LEAST(100, GREATEST(0, COALESCE((e->>'percent')::int, 0))) ELSE 100 END
$$;
GRANT EXECUTE ON FUNCTION public.summary_listen_entry_heard(jsonb), public.summary_listen_entry_percent(jsonb) TO authenticated, service_role;

/** The accepted "when": an offline listen may name a time up to 7 days back, never the future. */
CREATE OR REPLACE FUNCTION public.summary_listen_at(p_at timestamptz)
RETURNS timestamptz LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_at IS NULL THEN RETURN now(); END IF;
  IF p_at < now() - interval '7 days' THEN RAISE EXCEPTION 'LISTEN_TOO_OLD: This listen is older than 7 days and cannot be recorded.'; END IF;
  RETURN LEAST(p_at, now());
END;
$$;
GRANT EXECUTE ON FUNCTION public.summary_listen_at(timestamptz) TO authenticated, service_role;

/** The briefing row a listen belongs to: the named day when it exists, else the row in effect on the IST day of the listen. */
CREATE OR REPLACE FUNCTION public.summary_listen_row_date(p_client_id uuid, p_at timestamptz, p_briefing_date date)
RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT s.briefing_date FROM public.client_health_summary s
      WHERE s.client_id = p_client_id AND p_briefing_date IS NOT NULL AND s.briefing_date = p_briefing_date
        AND s.briefing_date <= (now() AT TIME ZONE 'Asia/Kolkata')::date),
    (SELECT s.briefing_date FROM public.client_health_summary s
      WHERE s.client_id = p_client_id AND s.briefing_date <= (p_at AT TIME ZONE 'Asia/Kolkata')::date
      ORDER BY s.briefing_date DESC LIMIT 1));
$$;
REVOKE ALL ON FUNCTION public.summary_listen_row_date(uuid, timestamptz, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.summary_listen_row_date(uuid, timestamptz, date) TO service_role;

-- ---------------------------------------------------------------------------
-- 1. The Play entry (replaces the 2-argument version; the two new arguments default, so old callers still resolve)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.log_summary_listen(uuid, text);
CREATE OR REPLACE FUNCTION public.log_summary_listen(p_client_id uuid, p_which text, p_at timestamptz DEFAULT NULL, p_briefing_date date DEFAULT NULL, p_device text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_at    timestamptz := public.summary_listen_at(p_at);
  v_date  date;
  v_row   public.client_health_summary%ROWTYPE;
  v_name text;
  v_role text;
  v_version int;
  v_entry jsonb;
  v_hist jsonb;
BEGIN
  IF p_which NOT IN ('weekly', 'context') THEN
    RAISE EXCEPTION 'which must be weekly or context';
  END IF;
  IF NOT public.can_listen_client_summary(p_client_id) THEN
    RAISE EXCEPTION 'Not allowed to listen to this client''s summary';
  END IF;
  v_date := public.summary_listen_row_date(p_client_id, v_at, p_briefing_date);
  IF v_date IS NULL THEN
    RAISE EXCEPTION 'No summary on file for this client yet';
  END IF;
  SELECT * INTO v_row FROM public.client_health_summary WHERE client_id = p_client_id AND briefing_date = v_date FOR UPDATE;
  SELECT NULLIF(btrim(concat_ws(' ', first_name, last_name)), ''), role::text INTO v_name, v_role
    FROM public.profiles WHERE id = auth.uid();
  v_version := CASE WHEN p_which = 'weekly' THEN (v_row.weekly_summary->>'version')::int ELSE (v_row.context_summary->>'version')::int END;
  v_entry := jsonb_build_object(
    'at', v_at, 'by', auth.uid(), 'by_name', v_name, 'role', v_role, 'which', p_which, 'version', v_version, 'briefing_date', v_date,
    'percent', 0, 'heard', false, 'updated_at', now(), 'device', NULLIF(btrim(COALESCE(p_device, '')), ''));
  v_hist := COALESCE(v_row.listen_history, '[]'::jsonb) || jsonb_build_array(v_entry);
  IF jsonb_array_length(v_hist) > 500 THEN
    SELECT COALESCE(jsonb_agg(x ORDER BY n), '[]'::jsonb) INTO v_hist
      FROM (SELECT x, n FROM jsonb_array_elements(v_hist) WITH ORDINALITY AS t(x, n) ORDER BY n DESC LIMIT 500) s;
  END IF;
  UPDATE public.client_health_summary SET listen_history = v_hist WHERE client_id = p_client_id AND briefing_date = v_date;
  RETURN v_entry;
END;
$$;
REVOKE ALL ON FUNCTION public.log_summary_listen(uuid, text, timestamptz, date, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.log_summary_listen(uuid, text, timestamptz, date, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Progress: the best percent so far for the caller's listen of that summary version
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_summary_listen_progress(p_client_id uuid, p_which text, p_percent integer, p_version integer DEFAULT NULL, p_at timestamptz DEFAULT NULL, p_briefing_date date DEFAULT NULL, p_device text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_at timestamptz := public.summary_listen_at(p_at);
  v_date date;
  v_row public.client_health_summary%ROWTYPE;
  v_version int;
  v_pct int := LEAST(100, GREATEST(0, COALESCE(p_percent, 0)));
  v_idx int := NULL;
  v_entry jsonb;
  v_hist jsonb;
  v_name text;
  v_role text;
  v_heard boolean;
BEGIN
  IF p_which NOT IN ('weekly', 'context') THEN RAISE EXCEPTION 'which must be weekly or context'; END IF;
  IF NOT public.can_listen_client_summary(p_client_id) THEN RAISE EXCEPTION 'Not allowed to listen to this client''s summary'; END IF;
  v_date := public.summary_listen_row_date(p_client_id, v_at, p_briefing_date);
  IF v_date IS NULL THEN RAISE EXCEPTION 'No summary on file for this client yet'; END IF;
  SELECT * INTO v_row FROM public.client_health_summary WHERE client_id = p_client_id AND briefing_date = v_date FOR UPDATE;
  v_version := CASE WHEN p_which = 'weekly' THEN (v_row.weekly_summary->>'version')::int ELSE (v_row.context_summary->>'version')::int END;
  -- The summary was rebuilt since the listen started: the percent belongs to a version that no longer exists here.
  IF p_version IS NOT NULL AND v_version IS DISTINCT FROM p_version THEN
    RETURN jsonb_build_object('ok', false, 'stale', true, 'version', v_version, 'briefing_date', v_date);
  END IF;
  v_hist := COALESCE(v_row.listen_history, '[]'::jsonb);
  -- The caller's newest entry of that kind and version on this row.
  SELECT n - 1 INTO v_idx
    FROM jsonb_array_elements(v_hist) WITH ORDINALITY AS t(e, n)
   WHERE jsonb_typeof(t.e) = 'object' AND t.e->>'which' = p_which AND t.e->>'by' = auth.uid()::text
     AND ((t.e->>'version')::int IS NOT DISTINCT FROM v_version)
   ORDER BY n DESC LIMIT 1;
  IF v_idx IS NULL THEN
    -- No Play entry (an offline progress whose Play never synced): start one at the listen time.
    SELECT NULLIF(btrim(concat_ws(' ', first_name, last_name)), ''), role::text INTO v_name, v_role FROM public.profiles WHERE id = auth.uid();
    v_entry := jsonb_build_object('at', v_at, 'by', auth.uid(), 'by_name', v_name, 'role', v_role, 'which', p_which, 'version', v_version,
                                  'briefing_date', v_date, 'percent', 0, 'heard', false, 'updated_at', now(), 'device', NULLIF(btrim(COALESCE(p_device, '')), ''));
    v_hist := v_hist || jsonb_build_array(v_entry);
    v_idx := jsonb_array_length(v_hist) - 1;
  ELSE
    v_entry := v_hist -> v_idx;
  END IF;
  v_pct := GREATEST(v_pct, public.summary_listen_entry_percent(v_entry) * (CASE WHEN v_entry ? 'percent' THEN 1 ELSE 0 END));
  v_heard := v_pct >= public.summary_listen_heard_percent();
  v_entry := v_entry || jsonb_build_object('percent', v_pct, 'heard', v_heard, 'updated_at', now())
             || CASE WHEN v_heard AND NOT COALESCE((v_entry->>'heard')::boolean, false) THEN jsonb_build_object('heard_at', v_at) ELSE '{}'::jsonb END
             || CASE WHEN p_device IS NOT NULL AND NOT (v_entry ? 'device') THEN jsonb_build_object('device', p_device) ELSE '{}'::jsonb END;
  v_hist := jsonb_set(v_hist, ARRAY[v_idx::text], v_entry, false);
  UPDATE public.client_health_summary SET listen_history = v_hist WHERE client_id = p_client_id AND briefing_date = v_date;
  RETURN jsonb_build_object('ok', true, 'stale', false, 'percent', v_pct, 'heard', v_heard, 'heard_at', v_entry->'heard_at', 'version', v_version, 'briefing_date', v_date);
END;
$$;
REVOKE ALL ON FUNCTION public.log_summary_listen_progress(uuid, text, integer, integer, timestamptz, date, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.log_summary_listen_progress(uuid, text, integer, integer, timestamptz, date, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. The row read: carry a person's earlier-day context listen, preferring a heard one
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_client_health_summary(p_client_id uuid, p_date date DEFAULT NULL)
RETURNS TABLE (
  client_id uuid,
  briefing_date date,
  status text,
  built_at timestamptz,
  weekly_summary jsonb,
  context_summary jsonb,
  listen_history jsonb,
  has_quiz boolean,
  auction_result text,
  context_dirty boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT s.client_id, s.briefing_date, s.status, s.built_at, s.weekly_summary, s.context_summary,
         COALESCE((
           SELECT jsonb_agg(c.e || jsonb_build_object('carried', true) ORDER BY c.at)
             FROM (
               SELECT DISTINCT ON (h.e->>'by') h.e, h.e->>'at' AS at
                 FROM public.client_health_summary o
                 CROSS JOIN LATERAL jsonb_array_elements(COALESCE(o.listen_history, '[]'::jsonb)) AS h(e)
                WHERE o.client_id = s.client_id
                  AND o.briefing_date < s.briefing_date
                  AND o.briefing_date >= s.briefing_date - 45
                  AND jsonb_typeof(h.e) = 'object'
                  AND h.e->>'which' = 'context'
                  AND COALESCE(h.e->>'by', '') <> ''
                  AND COALESCE(h.e->>'at', '') <> ''
                -- a heard listen of the same version first (3 Nov 2026), then the newest
                ORDER BY h.e->>'by', public.summary_listen_entry_heard(h.e) DESC, h.e->>'at' DESC
             ) c
            WHERE NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements(COALESCE(s.listen_history, '[]'::jsonb)) AS t(e)
               WHERE jsonb_typeof(t.e) = 'object' AND t.e->>'which' = 'context' AND t.e->>'by' = c.e->>'by'
                 AND public.summary_listen_entry_heard(t.e))
         ), '[]'::jsonb) || COALESCE(s.listen_history, '[]'::jsonb),
         s.quiz IS NOT NULL AND COALESCE((s.quiz->>'fallback')::boolean, false) = false,
         s.auction->>'result',
         s.context_dirty
    FROM public.client_health_summary s
   WHERE s.client_id = p_client_id
     AND public.can_listen_client_summary(p_client_id)
     AND s.briefing_date <= COALESCE(p_date, (now() AT TIME ZONE 'Asia/Kolkata')::date)
   ORDER BY s.briefing_date DESC
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.get_client_health_summary(uuid, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_client_health_summary(uuid, date) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. My Crew: the caller's status per client (old columns unchanged, new percent / heard columns added)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_my_listen_status(uuid[]);
CREATE OR REPLACE FUNCTION public.get_my_listen_status(p_client_ids uuid[])
RETURNS TABLE (
  client_id            uuid,
  has_weekly           boolean,
  has_context          boolean,
  weekly_generated_at  timestamptz,
  context_generated_at timestamptz,
  my_last_weekly_at    timestamptz,
  my_last_context_at   timestamptz,
  weekly_version       integer,
  context_version      integer,
  my_weekly_percent    integer,
  my_context_percent   integer,
  my_weekly_heard      boolean,
  my_context_heard     boolean,
  my_weekly_heard_at   timestamptz,
  my_context_heard_at  timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH rows AS (
    SELECT c.id AS cid, s.*
      FROM unnest(COALESCE(p_client_ids, ARRAY[]::uuid[])) AS c(id)
      CROSS JOIN LATERAL public.get_client_health_summary(c.id, NULL) s
     WHERE auth.uid() IS NOT NULL
  ),
  mine AS (
    SELECT r.cid, e->>'which' AS which, e,
           (e->>'version')::int AS v,
           CASE WHEN e->>'which' = 'weekly' THEN (r.weekly_summary->>'version')::int ELSE (r.context_summary->>'version')::int END AS cur_v,
           CASE WHEN e->>'which' = 'weekly' THEN NULLIF(r.weekly_summary->>'generated_at', '')::timestamptz ELSE NULLIF(r.context_summary->>'generated_at', '')::timestamptz END AS gen_at
      FROM rows r
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(r.listen_history, '[]'::jsonb)) e
     WHERE jsonb_typeof(e) = 'object' AND e->>'by' = auth.uid()::text AND COALESCE(e->>'at', '') <> ''
  ),
  cur AS (
    -- entries of the CURRENT version (a legacy entry with no version counts when it is after the build)
    SELECT m.cid, m.which, m.e FROM mine m
     WHERE (m.v IS NOT DISTINCT FROM m.cur_v) OR (m.v IS NULL AND m.gen_at IS NOT NULL AND (m.e->>'at')::timestamptz >= m.gen_at)
  ),
  agg AS (
    SELECT cid, which,
           max(public.summary_listen_entry_percent(e)) AS pct,
           bool_or(public.summary_listen_entry_heard(e)) AS heard,
           max(CASE WHEN public.summary_listen_entry_heard(e) THEN COALESCE(NULLIF(e->>'heard_at', '')::timestamptz, (e->>'at')::timestamptz) END) AS heard_at
      FROM cur GROUP BY cid, which
  )
  SELECT r.cid,
         NULLIF(trim(COALESCE(r.weekly_summary->>'script', '')), '') IS NOT NULL,
         NULLIF(trim(COALESCE(r.context_summary->>'script', '')), '') IS NOT NULL,
         NULLIF(r.weekly_summary->>'generated_at', '')::timestamptz,
         NULLIF(r.context_summary->>'generated_at', '')::timestamptz,
         (SELECT max((m.e->>'at')::timestamptz) FROM mine m WHERE m.cid = r.cid AND m.which = 'weekly'),
         (SELECT max((m.e->>'at')::timestamptz) FROM mine m WHERE m.cid = r.cid AND m.which = 'context'),
         (r.weekly_summary->>'version')::int,
         (r.context_summary->>'version')::int,
         COALESCE((SELECT a.pct FROM agg a WHERE a.cid = r.cid AND a.which = 'weekly'), 0),
         COALESCE((SELECT a.pct FROM agg a WHERE a.cid = r.cid AND a.which = 'context'), 0),
         COALESCE((SELECT a.heard FROM agg a WHERE a.cid = r.cid AND a.which = 'weekly'), false),
         COALESCE((SELECT a.heard FROM agg a WHERE a.cid = r.cid AND a.which = 'context'), false),
         (SELECT a.heard_at FROM agg a WHERE a.cid = r.cid AND a.which = 'weekly'),
         (SELECT a.heard_at FROM agg a WHERE a.cid = r.cid AND a.which = 'context')
    FROM rows r;
$$;
REVOKE ALL ON FUNCTION public.get_my_listen_status(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_listen_status(uuid[]) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. My Crew: everyone's progress per client (the "Who listened" block)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_crew_listen_progress(p_client_ids uuid[])
RETURNS TABLE (
  client_id uuid,
  which     text,
  by        uuid,
  by_name   text,
  role      text,
  percent   integer,
  heard     boolean,
  at        timestamptz,
  version   integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH rows AS (
    SELECT c.id AS cid, s.*
      FROM unnest(COALESCE(p_client_ids, ARRAY[]::uuid[])) AS c(id)
      CROSS JOIN LATERAL public.get_client_health_summary(c.id, NULL) s
     WHERE auth.uid() IS NOT NULL
  ),
  ent AS (
    SELECT r.cid, e->>'which' AS which, (e->>'by')::uuid AS by, e->>'by_name' AS by_name, e->>'role' AS role, e,
           (e->>'version')::int AS v,
           CASE WHEN e->>'which' = 'weekly' THEN (r.weekly_summary->>'version')::int ELSE (r.context_summary->>'version')::int END AS cur_v,
           CASE WHEN e->>'which' = 'weekly' THEN NULLIF(r.weekly_summary->>'generated_at', '')::timestamptz ELSE NULLIF(r.context_summary->>'generated_at', '')::timestamptz END AS gen_at
      FROM rows r
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(r.listen_history, '[]'::jsonb)) e
     WHERE jsonb_typeof(e) = 'object' AND e->>'which' IN ('weekly', 'context') AND COALESCE(e->>'by', '') ~ '^[0-9a-f-]{36}$' AND COALESCE(e->>'at', '') <> ''
  )
  SELECT x.cid, x.which, x.by, max(x.by_name), max(x.role),
         max(public.summary_listen_entry_percent(x.e)),
         bool_or(public.summary_listen_entry_heard(x.e)),
         max((x.e->>'at')::timestamptz),
         max(x.cur_v)
    FROM ent x
   WHERE (x.v IS NOT DISTINCT FROM x.cur_v) OR (x.v IS NULL AND x.gen_at IS NOT NULL AND (x.e->>'at')::timestamptz >= x.gen_at)
   GROUP BY x.cid, x.which, x.by;
$$;
REVOKE ALL ON FUNCTION public.get_crew_listen_progress(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_crew_listen_progress(uuid[]) TO authenticated;
COMMENT ON FUNCTION public.get_crew_listen_progress(uuid[]) IS
  'For a list of clients, every listener''s best percent of each spoken summary''s current version (heard = 95 percent or more, legacy plays count as heard); clients the caller may not listen to are left out.';

COMMIT;

-- ---------------------------------------------------------------------------
-- Probe: a trainer and a client with a summary, inside a block that is always rolled back. 14 checks.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE IF NOT EXISTS listen_probe (step int, check_name text, expected text, result text);
TRUNCATE listen_probe;

DO $probe$
DECLARE
  v_user uuid; v_other uuid; v_client uuid; v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  x jsonb; st record; v_res text; v_n int; v_ver int;
  v_names text[] := '{}'; v_expected text[] := '{}'; v_results text[] := '{}';
BEGIN
  SELECT p.id INTO v_user FROM public.profiles p WHERE p.role::text = 'trainer' AND p.email = 'sagaroddsfitness@gmail.com' LIMIT 1;
  IF v_user IS NULL THEN SELECT p.id INTO v_user FROM public.profiles p WHERE p.role::text = 'trainer' LIMIT 1; END IF;
  SELECT p.id INTO v_other FROM public.profiles p WHERE p.role::text = 'trainer' AND p.id <> v_user LIMIT 1;
  -- a client with today's row and both scripts (the probe writes to a copy of the trail and rolls back)
  SELECT s.client_id INTO v_client FROM public.client_health_summary s
   WHERE s.briefing_date <= v_today AND COALESCE(s.weekly_summary->>'script', '') <> '' AND COALESCE(s.context_summary->>'script', '') <> ''
   ORDER BY s.briefing_date DESC LIMIT 1;
  BEGIN
    IF v_user IS NULL OR v_client IS NULL THEN RAISE EXCEPTION 'no trainer or client row to probe with'; END IF;
    PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
    -- make sure the trainer may listen: the probe stubs nothing, so a refusal shows as a stopped probe
    v_ver := (SELECT (s.weekly_summary->>'version')::int FROM public.get_client_health_summary(v_client, NULL) s);

    -- 1. Play writes a 0 percent, not heard entry
    x := public.log_summary_listen(v_client, 'weekly', NULL, NULL, 'android');
    v_names := array_append(v_names, 'Play writes percent 0, not heard'); v_expected := array_append(v_expected, '0, false');
    v_results := array_append(v_results, (x->>'percent') || ', ' || (x->>'heard'));

    -- 2. progress 40, then 25 (never lower), then 96 (heard from 95)
    x := public.log_summary_listen_progress(v_client, 'weekly', 40, v_ver, NULL, NULL, 'android');
    v_res := (x->>'percent');
    x := public.log_summary_listen_progress(v_client, 'weekly', 25, v_ver, NULL, NULL, 'android');
    v_res := v_res || ' then ' || (x->>'percent');
    x := public.log_summary_listen_progress(v_client, 'weekly', 96, v_ver, NULL, NULL, 'android');
    v_names := array_append(v_names, '40, then 25 keeps 40, then 96 is heard'); v_expected := array_append(v_expected, '40 then 40 then 96 heard true');
    v_results := array_append(v_results, v_res || ' then ' || (x->>'percent') || ' heard ' || (x->>'heard'));

    -- 3. my status answers the percent, heard and heard_at
    SELECT * INTO st FROM public.get_my_listen_status(ARRAY[v_client]) LIMIT 1;
    v_names := array_append(v_names, 'get_my_listen_status: weekly 96, heard, heard_at set, context 0'); v_expected := array_append(v_expected, '96 true yes 0 false');
    v_results := array_append(v_results, st.my_weekly_percent || ' ' || st.my_weekly_heard || ' ' || CASE WHEN st.my_weekly_heard_at IS NOT NULL THEN 'yes' ELSE 'no' END || ' ' || st.my_context_percent || ' ' || st.my_context_heard);

    -- 4. a stale version writes nothing
    x := public.log_summary_listen_progress(v_client, 'weekly', 100, COALESCE(v_ver, 0) + 7, NULL, NULL, 'android');
    v_names := array_append(v_names, 'a progress for another version is stale'); v_expected := array_append(v_expected, 'stale true, ok false');
    v_results := array_append(v_results, 'stale ' || (x->>'stale') || ', ok ' || (x->>'ok'));

    -- 5. a context Play stopped at 30: not heard; the row read says so too
    x := public.log_summary_listen(v_client, 'context', NULL, NULL, 'android');
    x := public.log_summary_listen_progress(v_client, 'context', 30, NULL, NULL, NULL, 'android');
    SELECT * INTO st FROM public.get_my_listen_status(ARRAY[v_client]) LIMIT 1;
    v_names := array_append(v_names, 'context at 30 percent is not heard'); v_expected := array_append(v_expected, '30 false');
    v_results := array_append(v_results, st.my_context_percent || ' ' || st.my_context_heard);

    -- 6. a legacy entry (no percent key) counts as heard at 100
    UPDATE public.client_health_summary SET listen_history = COALESCE(listen_history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'at', now(), 'by', v_other, 'by_name', 'Legacy Trainer', 'role', 'trainer', 'which', 'weekly', 'version', v_ver, 'briefing_date', v_today))
     WHERE client_id = v_client AND briefing_date = (SELECT max(briefing_date) FROM public.client_health_summary WHERE client_id = v_client AND briefing_date <= v_today);
    SELECT count(*) FILTER (WHERE c.by = v_other AND c.which = 'weekly' AND c.percent = 100 AND c.heard) INTO v_n FROM public.get_crew_listen_progress(ARRAY[v_client]) c;
    v_names := array_append(v_names, 'legacy play reads heard at 100 in the crew progress'); v_expected := array_append(v_expected, '1');
    v_results := array_append(v_results, v_n::text);

    -- 7. the crew progress lists both listeners for the weekly, me at 96 heard
    SELECT count(*) INTO v_n FROM public.get_crew_listen_progress(ARRAY[v_client]) c WHERE c.which = 'weekly';
    SELECT c.percent::text || ' ' || c.heard INTO v_res FROM public.get_crew_listen_progress(ARRAY[v_client]) c WHERE c.which = 'weekly' AND c.by = v_user;
    v_names := array_append(v_names, 'crew progress: two weekly listeners, mine 96 heard'); v_expected := array_append(v_expected, '2 listeners, 96 true');
    v_results := array_append(v_results, v_n || ' listeners, ' || v_res);

    -- 8. an offline listen synced later: at = 2 hours ago, lands with that time
    x := public.log_summary_listen_progress(v_client, 'context', 97, NULL, now() - interval '2 hours', NULL, 'android');
    v_names := array_append(v_names, 'offline sync with a real heard time'); v_expected := array_append(v_expected, 'heard, heard_at 2 h ago');
    v_results := array_append(v_results, CASE WHEN (x->>'heard')::boolean AND abs(extract(epoch FROM (now() - (x->>'heard_at')::timestamptz)) - 7200) < 60 THEN 'heard, heard_at 2 h ago' ELSE 'got ' || x::text END);

    -- 9. a future time is clamped to now; older than 7 days refused
    x := public.log_summary_listen(v_client, 'weekly', now() + interval '1 day', NULL, 'android');
    v_res := CASE WHEN (x->>'at')::timestamptz <= now() THEN 'clamped' ELSE 'future kept' END;
    BEGIN x := public.log_summary_listen(v_client, 'weekly', now() - interval '8 days', NULL, 'android'); v_res := v_res || ', allowed'; EXCEPTION WHEN others THEN v_res := v_res || ', ' || SQLERRM; END;
    v_names := array_append(v_names, 'future clamped, 8 days old refused'); v_expected := array_append(v_expected, 'clamped, LISTEN_TOO_OLD: This listen is older than 7 days and cannot be recorded.');
    v_results := array_append(v_results, v_res);

    -- 10. the row read carries the heard context listen even after a later partial replay (same version)
    SELECT count(*) INTO v_n FROM public.get_client_health_summary(v_client, NULL) s
      CROSS JOIN LATERAL jsonb_array_elements(s.listen_history) e
     WHERE e->>'which' = 'context' AND e->>'by' = v_user::text AND public.summary_listen_entry_heard(e);
    v_names := array_append(v_names, 'the row read has my heard context entry'); v_expected := array_append(v_expected, 'at least 1');
    v_results := array_append(v_results, CASE WHEN v_n >= 1 THEN 'at least 1' ELSE '0' END);

    -- 11. anon gets nothing
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claims', '', true);
    SELECT count(*) INTO v_n FROM public.get_crew_listen_progress(ARRAY[v_client]);
    v_names := array_append(v_names, 'anon crew progress is empty'); v_expected := array_append(v_expected, '0');
    v_results := array_append(v_results, v_n::text);

    RAISE EXCEPTION 'PROBE_DONE';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'PROBE_DONE' THEN
      v_names := array_append(v_names, 'probe stopped'); v_expected := array_append(v_expected, 'ran'); v_results := array_append(v_results, 'could not run: ' || SQLERRM);
    END IF;
  END;
  INSERT INTO listen_probe (step, check_name, expected, result)
  SELECT n, v_names[n], v_expected[n], v_results[n] FROM generate_subscripts(v_names, 1) AS n;
END
$probe$;

INSERT INTO listen_probe (step, check_name, expected, result)
SELECT 20, 'heard threshold', '95', public.summary_listen_heard_percent()::text
UNION ALL
SELECT 21, 'legacy entry helpers', '100 true', public.summary_listen_entry_percent('{"at":"x"}'::jsonb) || ' ' || public.summary_listen_entry_heard('{"at":"x"}'::jsonb)
UNION ALL
SELECT 22, 'percent helpers at 94 and 95', '94 false, 95 true', public.summary_listen_entry_percent('{"percent":94}'::jsonb) || ' ' || public.summary_listen_entry_heard('{"percent":94}'::jsonb) || ', ' || public.summary_listen_entry_percent('{"percent":95}'::jsonb) || ' ' || public.summary_listen_entry_heard('{"percent":95}'::jsonb);

SELECT step, check_name, expected, result FROM listen_probe ORDER BY step;
```

## 4. Check on the iPhone
1. `node tests/rules/health_summary_rules_test.js` and `node tests/rules/summary_voice_test.js`: ALL PASS.
2. Online, as Sagar on Vashist (Today's Roster strip): Play the weekly, stop at a third: the bar shows about 33 percent,
   the red alert shows, the chip on My Crew reads "33 PERCENT · FINISH"; play it to the end: "HEARD 100 PERCENT", the
   chip HEARD 100, Add Workout opens without the gate.
3. Offline (airplane mode): Play both on the roster strip (device voice), bar to 100 with "SAVED ON THIS PHONE", Add
   Workout opens without the gate, log the session (queued); network back: the outbox drains, the server trail shows
   the real heard time, the manager's My Crew lists Sagar at 100 percent, the "saved on this phone" line is gone.
4. My Crew (manager): tap a client's chip: the Who listened block lists every crew member's percents.

Not confirmed: nothing was opened on a phone after the change (tsc, the rule tests and the Metro bundle pass; the
migration passed its 16-check probe locally and is not run live yet).
