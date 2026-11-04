# iOS handoff: Odds Nucleus records staff reading progress (4 Nov 2026)

Build iOS from this file alone. Section 1 is the plan (the rule, what exists on the server, the verify steps),
section 2 the code generated from the finished Android files. The server RPC `record_library_staff_progress`
(migration 20261102100000) is LIVE since 2 Nov 2026; nothing to build there. Copy rule: no dashes in user-facing
text (none here: the feature has no screen copy).

## 0. In one paragraph
The web Education Content Engagement page lists staff readers, but the app never wrote a row. Now the piece screen
records the open once, then the seconds every 15 s and on leave (foreground only), with the furthest scroll fraction
for an article (`read`) or position / length for the article audio (`audio`) and a direct video file (`video`); an
embedded YouTube / Vimeo player records only the open and the seconds. The server keeps the furthest progress, adds
the seconds, counts opens and marks Finished at 90 percent. Offline the call waits in the outbox (kind
`library-progress`); final refusals are dropped; nothing ever blocks reading or playback. Saved, recent and resume
stay on the device exactly as before.

## 1. The plan

# Odds Nucleus: staff reading progress reaches the server: end-to-end plan (4 Nov 2026)

Status: BUILT 4 Nov 2026 (app side; owner: no new APK for now). tsc, 12 rule checks, Metro bundle clean. Originally: Owner (4 Nov 2026): "I want to see who read that article"; the web Education Content
Engagement page already shows staff rows, but the app never writes one.

## 1. What exists today
- Server (LIVE since 2 Nov 2026, hub-track migration `20261102100000_library_staff_progress.sql`): the member app's
  table `longevity_resource_progress` accepts staff rows (`profile_id` = the staff member, `client_id` NULL) through
  ONE definer RPC `record_library_staff_progress(p_resource_id, p_medium, p_position, p_duration, p_seconds_delta,
  p_progress, p_opened)`. The server keeps the furthest progress and the longest duration, adds `p_seconds_delta`
  (capped at 3600 a call), counts opens when `p_opened`, and sets `completed_at` the first time progress reaches
  0.9 ("Finished" on the web). Refusals: `LIBRARY_SIGN_IN`, `LIBRARY_STAFF_ONLY` (a member login),
  `LIBRARY_BAD_MEDIUM`, `LIBRARY_NOT_PUBLISHED`.
- Web (LIVE): Education Content → Engagement → Staff chip; the audience dialog lists each staff reader with a role
  badge, the medium, the percent and the seconds; Finished with the date.
- App (version 5.3 (44) of 3 Nov): Nucleus keeps saved pieces, the recent list and the resume position ON THE PHONE
  only (`nucleusQueries.ts`, AsyncStorage) and writes nothing. The piece screen (`nucleus.tsx` `PieceView`) already
  measures everything the server wants: the furthest scroll fraction of an article (`furthest`), the audio position
  and duration (`ListenBar`, position every 10 s, paused in the background through `AppState`), the direct-file
  video position (`FileVideo`, every 10 s). YouTube / Vimeo embeds in a WebView expose no position.
- Handoff from the web session: `docs/nucleus-staff-progress-handoff.md` (the one call, when to call, errors, offline).

## 2. The rule (what gets recorded)
1. **Open** of a piece = one record with `p_opened true` (so the web's "times" counts opens) and the starting
   progress (0, or the stored resume fraction). Audio and video count as their own medium (`audio` / `video`);
   the article text is `read`.
2. **Reading time** = seconds the piece is on screen in the foreground, sent every 15 s and on leave as a delta
   (`p_seconds_delta`), never while the app is in the background and never while the screen is not on the piece.
3. **Progress**: `read` = the furthest scroll fraction reached (0 to 1); `audio` / `video` = position / length.
   The server keeps the furthest, so a re-read that scrolls less never lowers it.
4. **Finished** = progress 0.9 or more, set by the server once. The app changes nothing for it.
5. **Offline**: the record goes into the existing outbox (new kind `library-progress`) and drains with the rest, in
   order; deltas add up on the server. A refusal (`LIBRARY_*`) drops the item (nothing to retry).
6. **Never in the way**: a failed or slow call never blocks reading or playback (no spinner, no alert; logged only).
7. **Nothing else changes**: saved, recent and resume stay on the phone exactly as today; the app never reads the
   progress table (the web does the reporting).
8. Embedded YouTube / Vimeo videos: the open is recorded (`video`, progress 0) and the seconds on screen; no position
   or finish (the embed gives none). A direct video file records position and finish like audio.

## 3. Android (odds-app), the whole change in one file plus the outbox kind
- `src/lib/nucleusProgress.ts` (NEW, pure + one network call):
  - `buildProgressCall(o)` (pure): the named parameters for the RPC from `{pieceId, medium, position, duration,
    secondsDelta, progress, opened}` (clamps 0..1, rounds seconds, null position / duration for `read`);
    `isPermanentLibraryRefusal(message)`: the four `LIBRARY_*` codes; `ticks(seconds)` helpers for the 15 s cadence.
  - `recordStaffProgress(call)`: `supabase.rpc('record_library_staff_progress', call)` through `withTimeout(NET_MS)`;
    offline or a network error → `enqueueOutbox('library-progress', '<piece title> · reading', call, {autoDrain:
    false})`; a permanent refusal → dropped with `console.warn`; never throws to the caller.
  - `useReadingSession(pieceId, medium, enabled)`: a small hook that owns the clock: starts on open (sends the open
    record), runs a 15 s interval that sends the delta with the latest progress / position, pauses on `AppState`
    not active, resumes on active, flushes the remaining seconds on unmount and on `pieceId` change (Prev / Next
    re-keys the view). It takes a `getProgress()` ref so the screen feeds the furthest scroll fraction or the
    player's position / duration without re-rendering.
- `src/screens/nucleus.tsx`: `PieceView` calls `useReadingSession(piece.id, 'read', piece.kind === 'article')` and
  feeds `furthest.current`; `ListenBar` calls it with `'audio'` while a player exists, feeding `pos` and `dur`;
  `FileVideo` with `'video'` feeding `player.currentTime` and `player.duration`; the embed path (`VideoBlock` with
  `started`) calls it with `'video'` and progress 0. Playback pauses in the background as today; the session clock
  pauses with it.
- `src/lib/offline.ts`: kind `'library-progress'` in the union; the drain calls `recordStaffProgress` again for the
  queued call (lazy require); a `LIBRARY_*` answer drops the item, a network error keeps it for the next drain.
- `tests/rules/nucleus_progress_test.js`: `buildProgressCall` clamps and nulls, the permanent-refusal list, the
  delta maths of the clock (a 40 s read = 15 + 15 + 10 on leave; background time excluded).
- Doc header of `nucleusQueries.ts` and `docs/features/android/shared/odds-nucleus.md` section 4 ("Written: one RPC
  call ...") + change log; README line.
- Nothing in `SENSITIVE_ROUTES` changes (published content). No new drawer item, no copy change on screen.

## 4. Server
- No SQL. The RPC and the table change are live. (A quick read-only check before building: call the RPC as the Sagar
  test account on a published piece with `p_seconds_delta 0, p_opened false` is a write of a row, so NOT done on
  production; verify with the real first read after the build instead.)

## 5. Release
- tsc, rule tests, Metro bundle, commit, push; then **APK + AAB 5.4 (45)** (the owner asked for the build with this).
- Version bump in `app.json` and `android/app/build.gradle`.

## 6. Verify (the handoff's test, on a phone with the new build)
1. Sign in as a trainer, open a published article, scroll halfway, wait 20 seconds, go back.
2. Web: Education Content → Engagement → Staff: the piece shows 1 staff person; the dialog lists the trainer with a
   Trainer badge, Read, about 50 percent, about 20 seconds.
3. Read to the end: Finished with today's date.
4. Airplane mode, read 30 seconds, back online: the seconds add up after the outbox drains.
5. SQL check: `select count(*) filter (where profile_id is not null) from public.longevity_resource_progress;` > 0.

## 7. Edge cases
- Prev / Next inside a course: the old piece flushes, the new one records an open.
- The same piece opened twice in a day: times 2, seconds add, progress the furthest.
- A member login (client) using the staff app: the server refuses `LIBRARY_STAFF_ONLY`, the app drops it silently.
- An unpublished piece still cached on the phone: `LIBRARY_NOT_PUBLISHED`, dropped.
- Sign-out mid-read: the flush runs with the dying session; a `LIBRARY_SIGN_IN` refusal is dropped; the outbox is
  per user, nothing crosses accounts.
- iOS: the same three files; handoff card 16 after the build.

## 2. Code (generated from the Android tree)

### 2.1 New files in full

#### `src/lib/nucleusProgress.ts`
The one call, the outbox entry point and the reading clock hook. The pure part (buildProgressCall,
isPermanentLibraryRefusal, isNetworkError, clockDelta, the three constants) is copied byte for byte; the hook uses
React and AppState exactly as on Android.

```ts
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
```

#### `tests/rules/nucleus_progress_test.js`
12 checks. Copy as is; run it first.

```js
// Rule test for the Odds staff app. ROOT = the repo root; point it at the iOS repo and run: node tests/rules/nucleus_progress_test.js
const ROOT = require("path").resolve(__dirname, "../..");
// Nucleus staff reading progress (4 Nov 2026): the RPC call shape, the final refusals, the clock delta.
const ts = require(ROOT + '/node_modules/typescript');
const fs = require('fs');
const src = fs.readFileSync(ROOT + '/src/lib/nucleusProgress.ts', 'utf8');
// the pure part only: the file's React / native imports are stubbed
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const stubs = { react: { useRef: () => ({ current: null }), useEffect: () => {} }, 'react-native': { AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } }, './supabase': { supabase: {} }, './withTimeout': { withTimeout: (p) => p, NET_MS: 1 }, './offline': { enqueueOutbox: async () => {}, getIsOnline: () => true } };
const m = { exports: {} }; new Function('module', 'exports', 'require', js)(m, m.exports, (n) => stubs[n] ?? require(n));
const P = m.exports;
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };

// 1. the call shape
eq('read: no position, progress = scroll fraction', P.buildProgressCall({ pieceId: 'p1', medium: 'read', sample: { progress: 0.4567, position: 120, duration: 300 }, secondsDelta: 15, opened: false }),
  { p_resource_id: 'p1', p_medium: 'read', p_position: null, p_duration: null, p_seconds_delta: 15, p_progress: 0.457, p_opened: false });
eq('audio: position / duration', P.buildProgressCall({ pieceId: 'p1', medium: 'audio', sample: { progress: 0, position: 90.4, duration: 180 }, secondsDelta: 0, opened: true }),
  { p_resource_id: 'p1', p_medium: 'audio', p_position: 90, p_duration: 180, p_seconds_delta: 0, p_progress: 0.5, p_opened: true });
eq('video without a known length: the sample progress', P.buildProgressCall({ pieceId: 'p1', medium: 'video', sample: { progress: 0, position: 30, duration: null }, secondsDelta: 15, opened: false }).p_progress, 0);
eq('clamps: progress above 1, negative delta, delta above the cap', [
  P.buildProgressCall({ pieceId: 'p', medium: 'read', sample: { progress: 1.4 }, secondsDelta: -3, opened: false }).p_progress,
  P.buildProgressCall({ pieceId: 'p', medium: 'read', sample: { progress: 0.2 }, secondsDelta: -3, opened: false }).p_seconds_delta,
  P.buildProgressCall({ pieceId: 'p', medium: 'read', sample: { progress: 0.2 }, secondsDelta: 99999, opened: false }).p_seconds_delta,
], [1, 0, 3600]);
eq('NaN progress reads as 0', P.buildProgressCall({ pieceId: 'p', medium: 'read', sample: { progress: NaN }, secondsDelta: NaN, opened: false }), { p_resource_id: 'p', p_medium: 'read', p_position: null, p_duration: null, p_seconds_delta: 0, p_progress: 0, p_opened: false });
eq('audio position past the length caps at 1', P.buildProgressCall({ pieceId: 'p', medium: 'audio', sample: { progress: 0, position: 200, duration: 180 }, secondsDelta: 1, opened: false }).p_progress, 1);

// 2. refusals and network errors
eq('final refusals', ['LIBRARY_NOT_PUBLISHED: x', 'LIBRARY_STAFF_ONLY: y', 'LIBRARY_BAD_MEDIUM', 'LIBRARY_SIGN_IN: z'].map(P.isPermanentLibraryRefusal), [true, true, true, true]);
eq('not final', ['Network request failed', 'took too long', 'something else'].map(P.isPermanentLibraryRefusal), [false, false, false]);
eq('network errors', [new Error('Network request failed'), new Error('Reading progress took too long'), { name: 'AbortError' }, new Error('row violates')].map(P.isNetworkError), [true, true, false, false]);

// 3. the clock
eq('delta: 40 s read = 15 + 15 + 10 on leave', [P.clockDelta(0, 15_400), P.clockDelta(15_400, 30_100), P.clockDelta(30_100, 40_000)], [15, 15, 10]);
eq('delta: no start = 0, backwards = 0, cap', [P.clockDelta(null, 5000), P.clockDelta(9000, 5000), P.clockDelta(0, 10 * 3600 * 1000)], [0, 0, 3600]);
eq('constants', [P.TICK_MS, P.MIN_DELTA_SECONDS, P.MAX_DELTA_SECONDS], [15000, 1, 3600]);

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
```

### 2.2 Edited files: `git diff -U4` against the tree before this change

The three hooks into the piece screen (read in PieceView, audio in ListenBar from the first play, video in FileVideo
and the embed path), the outbox kind and its drain branch, the header comment of nucleusQueries.ts.

```diff
diff --git a/src/lib/nucleusQueries.ts b/src/lib/nucleusQueries.ts
index d74fa57..f4cc338 100644
--- a/src/lib/nucleusQueries.ts
+++ b/src/lib/nucleusQueries.ts
@@ -1,8 +1,9 @@
 /* Odds Nucleus data (16 Oct 2026): the published pieces (one small query, read only) and
    the device-side state (saved pieces, the recent list, resume positions) in AsyncStorage
-   keyed by the signed-in user. The app writes NOTHING to the database for this feature:
-   longevity_resource_progress is the member app's table and its policy refuses staff. */
+   keyed by the signed-in user. Since 4 Nov 2026 the ONE database write of the feature lives in
+   nucleusProgress.ts (record_library_staff_progress: who read what, how far, how long, for the
+   web's Engagement page); everything here stays on the phone. */
 import React from 'react';
 import AsyncStorage from '@react-native-async-storage/async-storage';
 import { useQuery } from '@tanstack/react-query';
 import { supabase } from './supabase';
diff --git a/src/lib/offline.ts b/src/lib/offline.ts
index 54ad7c1..cb1b44e 100644
--- a/src/lib/offline.ts
+++ b/src/lib/offline.ts
@@ -23,9 +23,9 @@ const OUTBOX_KEY = 'outbox:v1';
 
 export type OutboxItem = {
   id: string;
   userId?: string;        // who queued it \u2014 items never drain (or show) under another account
-  kind: 'workout-log' | 'create-plan' | 'edit-plan' | 'chat-message' | 'location-log' | 'screenshot-log' | 'session-voice-note' | 'nav-track' | 'route-ended' | 'session-otp-verify' | 'summary-listen' | 'summary-listen-progress';
+  kind: 'workout-log' | 'create-plan' | 'edit-plan' | 'chat-message' | 'location-log' | 'screenshot-log' | 'session-voice-note' | 'nav-track' | 'route-ended' | 'session-otp-verify' | 'summary-listen' | 'summary-listen-progress' | 'library-progress';
   label: string;          // human line for the pending-sync UI
   createdAt: string;      // ORIGINAL device timestamp at submit time
   status: 'pending' | 'syncing' | 'failed';
   attempts: number;
@@ -337,8 +337,13 @@ async function processItem(item: OutboxItem): Promise<{ linkPending?: boolean }
     const { submitQueuedListen } = require('./listenSync');
     await submitQueuedListen(item.kind, item.payload);
     qcRef?.invalidateQueries({ queryKey: ['client-health-summary', item.payload?.clientId] });
     qcRef?.invalidateQueries({ queryKey: ['listen-status'] });
+  } else if (item.kind === 'library-progress') {
+    // Odds Nucleus staff reading progress made offline (4 Nov 2026): the same RPC call, deltas add up on the server.
+    // Lazy require: nucleusProgress imports enqueue.
+    const { submitQueuedProgress } = require('./nucleusProgress');
+    await submitQueuedProgress(item.payload);
     qcRef?.invalidateQueries({ queryKey: ['crew-listen-progress'] });
   }
 }
 
diff --git a/src/screens/nucleus.tsx b/src/screens/nucleus.tsx
index 92e56f1..29fdfed 100644
--- a/src/screens/nucleus.tsx
+++ b/src/screens/nucleus.tsx
@@ -23,8 +23,9 @@ import { useAuth } from '../auth';
 import { trackEvent } from '../lib/amplitude';
 import { getIsOnline } from '../lib/offline';
 import { claimAudioFocus, releaseAudioFocus, type AudioHolder } from '../lib/audioFocus';
 import { useNucleusPieces, useNucleusLocal, readPosition, type NucleusLocal } from '../lib/nucleusQueries';
+import { useReadingSession } from '../lib/nucleusProgress';
 import {
   type NucleusPiece, type NucleusTopic, type NucleusPosition, type KindFilter, type BodyBlock,
   TOPICS, topicMeta, heroPiece, courses, coursePlace, relatedPieces, filterPieces,
   videoHost, videoEmbedUrl, youtubeThumb, isHttp, isHttps, parseBody, inlineRuns, fmtClock, minutesOf, metaLine, kindLabel,
@@ -337,16 +338,21 @@ export function Nucleus() {
 
 /* ============================================================ the piece ============ */
 
 /** A direct video file through expo-video: resumes, stores the position every 10 s and on leave. */
-function FileVideo({ url, startAt, onPosition }: { url: string; startAt: number; onPosition: (seconds: number) => void }) {
+function FileVideo({ url, startAt, onPosition, pieceId, title }: { url: string; startAt: number; onPosition: (seconds: number) => void; pieceId: string; title: string }) {
   const player = useVideoPlayer(url, (p) => { if (startAt > 0) p.currentTime = startAt; p.play(); });
   const onPosRef = React.useRef(onPosition); onPosRef.current = onPosition;
+  const [playing, setPlaying] = React.useState(true);
   React.useEffect(() => {
     const read = () => { try { const t = player.currentTime; if (Number.isFinite(t) && t > 0) onPosRef.current(t); } catch { /* released */ } };
     const t = setInterval(read, POSITION_EVERY_MS);
-    return () => { clearInterval(t); read(); };
+    let sub: { remove: () => void } | null = null;
+    try { sub = (player as any).addListener('playingChange', (ev: any) => setPlaying(ev?.isPlaying ?? ev === true)); } catch { /* older API */ }
+    return () => { clearInterval(t); read(); try { sub?.remove(); } catch { /* gone */ } };
   }, [player]);
+  // Staff reading progress (4 Nov 2026): the open, the seconds while playing, the position over the length.
+  useReadingSession(pieceId, 'video', true, playing, () => { try { return { progress: 0, position: player.currentTime, duration: player.duration }; } catch { return { progress: 0 }; } }, `${title} · video`);
   return <VideoView player={player} style={{ width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000' }} nativeControls contentFit="contain" />;
 }
 
 function VideoBlock({ piece, startAt, onPosition }: { piece: NucleusPiece; startAt: number; onPosition: (seconds: number) => void }) {
@@ -359,8 +365,11 @@ function VideoBlock({ piece, startAt, onPosition }: { piece: NucleusPiece; start
     trackEvent('Nucleus Video Played', { id: piece.id, host: host ?? 'unknown' });
     setStarted(true);
   };
   const online = getIsOnline();
+  // Staff reading progress (4 Nov 2026): an embedded YouTube / Vimeo player gives no position, so only the open and
+  // the seconds on screen are recorded (progress 0); a direct file records inside FileVideo.
+  useReadingSession(piece.id, 'video', started && host !== 'file' && !!embed, started && host !== 'file' && !!embed, () => ({ progress: 0 }), `${piece.title} · video`);
   if (!host) {
     return (
       <Cover piece={piece} height={190} radius={18}>
         <View style={{ padding: 14, gap: 8, backgroundColor: 'rgba(8,6,6,0.6)' }}>
@@ -386,9 +395,9 @@ function VideoBlock({ piece, startAt, onPosition }: { piece: NucleusPiece; start
             </View>
           </Cover>
         </Pressable>
       ) : host === 'file' && piece.video_url ? (
-        <FileVideo url={piece.video_url} startAt={startAt} onPosition={onPosition} />
+        <FileVideo url={piece.video_url} startAt={startAt} onPosition={onPosition} pieceId={piece.id} title={piece.title} />
       ) : embed ? (
         <WebView
           source={{ uri: embed }}
           style={{ width: '100%', height: Math.round((width || 320) * 9 / 16), backgroundColor: '#000' }}
@@ -421,10 +430,13 @@ function ListenBar({ piece, startAt, onPosition, onEnd }: { piece: NucleusPiece;
   const [err, setErr] = React.useState<string | null>(null);
   const [drag, setDrag] = React.useState<number | null>(null);
   const [barW, setBarW] = React.useState(0);
   const posRef = React.useRef(startAt); posRef.current = pos;
+  const durRef = React.useRef(dur); durRef.current = dur;
   const onPosRef = React.useRef(onPosition); onPosRef.current = onPosition;
   const onEndRef = React.useRef(onEnd); onEndRef.current = onEnd;
+  // Staff reading progress (4 Nov 2026): the audio medium, opened on the first play, seconds while playing.
+  useReadingSession(piece.id, 'audio', playedRef.current || playing, playing, () => ({ progress: 0, position: posRef.current, duration: durRef.current || piece.audio_seconds || null }), `${piece.title} · audio`);
 
   const store = () => { const p = playerRef.current; const t = p ? safeTime(p) : posRef.current; if (t > 0) onPosRef.current(t); };
   // One sound at a time (16 Oct 2026): another player starting pauses the article audio.
   const holder = React.useRef<AudioHolder>({ silence: () => { try { playerRef.current?.pause(); } catch { /* released */ } store(); } }).current;
@@ -670,8 +682,11 @@ function PieceView({ piece, all, local, onOpen, onBack }: { piece: NucleusPiece;
     if (piece.kind === 'article' && !piece.audio_url && furthest.current > 0.02) {
       localRef.current.setPosition(piece.id, { medium: 'read', value: Math.round(furthest.current * 100) / 100, at: new Date().toISOString() });
     }
   }, [piece.id]); // eslint-disable-line react-hooks/exhaustive-deps
+  // Staff reading progress (4 Nov 2026): the article text as medium 'read', the furthest scroll fraction, the
+  // seconds while the piece is on screen in the foreground; the server marks Finished at 90 percent.
+  useReadingSession(piece.id, 'read', piece.kind === 'article', piece.kind === 'article', () => ({ progress: furthest.current }), `${piece.title} · reading`);
 
   const mediaStart = posReady ? resumeFrom(pos, piece.kind === 'video' ? piece.duration_seconds : piece.audio_seconds) : 0;
   const storeMedia = (seconds: number) => {
     if (!mediumKind) return;
```

## 3. Check on the iPhone
1. `node tests/rules/nucleus_progress_test.js`: ALL PASS (12).
2. As a trainer: open a published article, scroll halfway, wait 20 seconds, go back. Web: Education Content →
   Engagement → Staff shows the trainer, Read, about 50 percent, about 20 seconds.
3. Read to the end: Finished with today's date. Play the article audio for 20 seconds: a second row, Audio.
4. Airplane mode, read 30 seconds, back online: the seconds add up after the outbox drains.
5. SQL: `select count(*) filter (where profile_id is not null) from public.longevity_resource_progress;` > 0.
