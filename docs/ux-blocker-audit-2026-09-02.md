> **Status (2 Sep 2026):** items 1-9 fixed — see `ux-blocker-fix-pass-2026-09-02.md` for the feature-wise changes and manual test steps. Left as-is by decision: BL1, BL2, BL4, H2.

# Odds Staff App — Deep UI/UX Blocker Audit (2 Sep 2026)

**Scope:** static analysis of `odds-app/src` (React Native 0.81.5 / Expo SDK 54 — note `AGENTS.md` says 57; `package.json` pins `expo ~54.0.36`). The iOS-worded brief was mapped to RN equivalents: custom store router instead of UINavigationController, PanResponder/gesture-handler instead of gesture recognizers, the JS thread instead of the main thread, react-query/`useState` flags for stuck states, listeners/channels/timers for lifecycle.
**Method:** five parallel category reviews (navigation, JS-thread, stuck states, lifecycle, visual/a11y/double-tap), every High/Blocker claim re-verified by reading the code. The scroll/touch fix pass shipped earlier today (keyboard padding, sheet caps, sibling backdrops, hitSlop, pressed feedback, drag grip, duplicate-exercise guard) is **excluded** — it is already fixed.
**Audit only — no code changed.**

---

## 1. App map

**Stack:** Expo 54 · RN 0.81.5 (Hermes, Android edge-to-edge ON) · Supabase JS (postgrest/rpc/functions/storage/realtime) · react-query v5 with a persisted SQLite cache (`rq-cache:v1`) · SQLite offline outbox (`src/lib/offline.ts`) · expo-notifications push · Amplitude.

**Navigation model** (`src/store.tsx`, `src/Router.tsx`):
- 110 routes in `SCREENS`; store holds `route`, `history[]`, `canGoBack`; `go(route, reset?)` pushes (dedupes same route), `back()` pops or falls back to the role home. Screens are **unmounted and re-created** on every navigation (`ScreenHost` renders one layer).
- Exits: `Header` + hamburger **Drawer** rendered on every authed route (universal exit); `BottomNav` exists but is **never rendered** (dead code); floating Home/AI bar hidden on `workout`, `create-plan`, `messenger`, `manager-chat`, thread views.
- Back gestures: edge swipe-back `PanResponder` (disabled only on `workout`; honours `backSwipeLock` + `backOverride`), Android `BackHandler` (closes AI/drawer, then `back()`, backgrounds only on the home route). **No role gating** in the Router — the drawer is the only gate.
- Gates wrapping the whole authed tree: `UpdateGate` (force-update, no bypass) and `LocationGate` (trainers/doctors; Settings deep-link + Sign out).
- Data defaults (`App.tsx:23-38`): `staleTime 30s`, `gcTime 7d`, `refetchOnMount:'always'`, `refetchOnWindowFocus`, **`refetchInterval: 60_000` for every query**, `networkMode:'offlineFirst'`.
- Deep links: `PushTokenManager` (tap listener + cold-start replay) **and** `Router` (cold-start `conversation_id`) — two handlers for one event.

---

## 2. Findings

Severity: **Blocker** = user cannot proceed / whole app affected · **High** = data/duplicate-write/privacy or a common flow visibly broken · **Medium** = annoying/degraded · **Low** = polish.

### BLOCKERS

**BL1 — Offline (or flaky) launch force-signs the user out, with no way back in.** `src/auth.tsx:25-28, 57-59`. `fetchRole` discards the postgrest `error`; a network failure yields `data:null` → `appRoleOf(undefined)` → `null` → `signOut({scope:'local'})`. Router then hard-routes to Sign In, where signing in is impossible offline; the persisted cache and outbox become unreachable. *Repro:* sign in → kill app → airplane mode → launch. *Fix:* return a third `unknown` state on error; only sign out on a confirmed missing/`client` role; keep the session and retry with backoff.

**BL2 — UpdateGate can lock out every Android user, and has no exit.** `src/components/UpdateGate.tsx:45-55, 99-120`. `playForce` scrapes the Play Store HTML with `/\[\[\["(\d+(?:\.\d+)+)"\]\]/` and blocks if the first match is newer than the installed `version`. Fail-open covers "no match" only, not "wrong match": a Play markup change matching some other dotted number blocks all users with no bypass, no sign-out. Also bites staged rollouts (Play shows the new version before the device can get it → "Update Now" opens a page that only offers "Open"). `openURL` failures are swallowed. *Fix:* only force when BOTH the DB row and the scrape agree (or trust the DB row alone), sanity-clamp the scraped version (≤ installed major+1), surface `openURL` failure, add the same Sign-out row `LocationGate` has.

**BL3 — QHP "Generate PDF" modal is an inescapable trap while busy.** `src/screens/qhpAssessmentDetail.tsx:227-242`, `src/lib/qhpPdf.ts:105-128, 243-268`. `onRequestClose` is a no-op and the ✕ is hidden while `phase ∈ {working, uploading}`; no backdrop dismiss. AI generation is bounded but uncancellable (5 batches × 2 attempts × 75-120 s ≈ up to 20 min); the storage upload has **no timeout**. *Repro:* start finalize, drop to captive/1-bar Wi-Fi mid-upload → stuck at "Rendering & uploading… 70%". *Fix:* keep a Cancel affordance visible during busy (with confirm), `AbortController`/`Promise.race` timeouts on every step, `onRequestClose` = cancel.

**BL4 — Session-handoff popup: no-op back, auto-opens as a sibling modal, untimed only-exit.** `src/components/sessionHandoff.tsx:49-50, 142-151`; mounted at `src/screens/trainer.tsx:4158` as a sibling of three other Modals in Client Detail. It opens asynchronously when its query resolves — if the (i) info modal or a report sheet is already open, Android renders a blank, touch-eating overlay (the codebase documents this hazard at `doctor.tsx:940`, `crmRoster.tsx:563`). The only button is `disabled` until checked and while the untimed ack mutation is pending. *Fix:* real `onRequestClose`, a "Review later" secondary action, client-side timeout on the ack, and gate auto-open on "no other modal open".

**BL5 — Sign-in button can latch at "Signing in…" forever.** `src/screens/trainer.tsx:101-110, 190`. `setSigningIn(false)` is not in a `finally`; `signInWithPassword` has no timeout; a rejection inside the wrong-role branch (`auth.tsx:75-81`) skips the reset. The button has no `disabled` prop — the guard is `if (signingIn) return`, so a stuck flag makes it a permanent no-op. *Fix:* `try/finally` + 20 s `Promise.race`, surface the timeout in `authErr`.

**BL6 — CRM dashboards freeze every 60 seconds.** `src/lib/crmQueries.ts:320-323`, `src/lib/crmTabQueries.ts:79-83` + `App.tsx:23-38`. Missing-log detection is O(schedules × logs) with `new Date(iso)` constructed **inside the inner `.some()`** — ≈200 k ISO parses per run for a 120-client book (est. 200-450 ms of blocked JS). Both queries inherit the global 60 s `refetchInterval` and `refetchOnMount:'always'`; the CRM workspace mounts 15 detail hooks + the drawer's 5 badge queries → **35-45 round-trips per minute**, every mount, every foreground. *Fix:* parse once, index logs by trainer (or move the match into an RPC); remove the global `refetchInterval` (realtime already covers hot tables), `refetchOnMount: true`; badge counts via one count RPC.

**BL7 — Workout Log re-renders ~1,300 React elements per keystroke.** `src/screens/trainer.tsx:5641, 5950-5952, 6666` (0 `React.memo` in the 11.4k-line file). Every reps/load/tempo/note character calls `setExercises` at the top of `Workout()`; the exercise cards are an inline `.map` with no memo boundary. 6 exercises × 4 sets ≈ 940 elements + ~370 shell = a full reconcile per character (est. 15-40 ms on mid-range Android → caret lags the keyboard). Amplified by H17 (drawer/AI toggles re-render the same tree) and H-drag (each reorder swap = full re-render + 31 Hz timer). *Fix:* `React.memo` `ExerciseCard` with `useCallback` handlers; uncontrolled inputs committing on blur (the `draftStateRef` pattern already exists); move `sessionName/remark/search` states into leaf components.

**BL8 — Persisted-cache serialization storm + a warm-up that fills it with multi-MB blobs.** `App.tsx:42, 105-109`; `src/components/OfflineWarmup.tsx:31, 60-116`; `src/lib/clientQueries.ts:1258-1296, 1816`. The persister dehydrates the whole cache on every cache event (only the storage write is throttled to 1 s, and it is a synchronous `JSON.stringify`). Warm-up mounts 8 queries × 40 clients (320 queries over ~55 s) including full `qhp_json`, `extracted_data`, `biomarkers`, `ai_analysis`, and an **unbounded** `useClientSessions` (1000 rows + a second `analysis_data` blob query). `gcTime` 7 d means nothing is evicted; cold start `JSON.parse`s the whole blob before first paint. *Fix:* allow-list `shouldDehydrateQuery` to small offline-critical keys; `throttleTime` 5-10 s; drop the heavy columns from warm-up (lazy on open); `.limit(60)` + date window on sessions; `MAX_CLIENTS` 40 → ~10. Measure first: log `Storage.getItem('rq-cache:v1')` length and `getQueryCache().getAll().length`.

### HIGH

**H1 — Nothing is cleared on sign-out or account switch → user A's data is live for user B.** `src/auth.tsx:92-96`, `chrome.tsx:245`, `AccountSwitch.tsx:26-29`. Zero `queryClient.clear()`/`removeQueries`/`persister.removeClient()` in `src/`. Unscoped keys (`client-detail`, `client-medical-history`, `client-findings`, `admin-clients`, …), the 7-day persisted cache, `ai_clients` SQLite (medical histories, phones), the store (`selectedClientId`, `openChatId`) and AsyncStorage flags all survive. **H1b:** the outbox is not user-scoped (`offline.ts:16,32`) — a location fix queued by trainer A drains under trainer B's `auth.uid()` (`locationLog.ts:49-60`); A's queued workouts fail under B and show in B's "Waiting to Sync". *Fix:* one teardown routine on sign-out/switch (cache, persister, outbox, `ai_clients`, store, token cache); stamp `userId` on outbox items and skip mismatches.

**H2 — Two production logins' passwords ship in plain text in the JS bundle.** `src/lib/linkedAccounts.ts:9-12` (used by `AccountSwitch`). Anyone unpacking the APK gets a coach + trainer login. *Fix:* replace with a server-side "switch session" RPC/edge function keyed on the current user, or remove the feature.

**H3 — Push deep-link: last tap replays on every remount; two cold-start handlers; `go('home')` targets a route that doesn't exist.** `src/components/PushTokenManager.tsx:47, 59-73`, `src/Router.tsx:399-451`. `getLastNotificationResponseAsync()` is never cleared (0 uses of `clearLastNotificationResponseAsync`) and the guard is a per-mount ref; the manager remounts on every sign-out/sign-in and on `LocationGate` flips → user B is yanked into user A's conversation. `'home'` is not in `SCREENS` (route falls back to the right screen but the drawer/AI bar/back rules see a bogus route). *Fix:* clear the response after consuming; single owner (Router's `pendingChatRef`); `go(homeRouteFor(role))`; map unknown `data.route` explicitly.

**H4 — Hardware back ignores `backOverride`; Client Threads registers none; Create Plan's unsaved-changes guard is bypassed by swipe and hardware back.** `src/Router.tsx:292, 422-433`; `clientThreads.tsx:54-57`; `createPlan.tsx:214, 421`. Android back inside a Messenger thread pops the whole route (thread + draft lost); Client Threads thread view has no override at all; `'create-plan'` is not in `NO_SWIPE_BACK` so a swipe silently discards a plan. *Fix:* honour `backOverride.handler` in the `BackHandler`; register overrides in Client Threads, Workout (`goBack` cleanup), Create Plan (`guardedBack`); add `'create-plan'` to `NO_SWIPE_BACK`.

**H5 — `backSwipeLock` can stick `true` app-wide.** `src/gestureLock.ts:3`, writers `common.tsx:22-40` (HScroll/TimeDial, 33 screens), `trainer.tsx:5488-5523`, `messenger.tsx:97`, `managerChat.tsx:42`, `clientThreads.tsx:199`. Unmount mid-gesture (realtime re-key, deep link, gate flip) skips `onTouchEnd`/`Release` → swipe-back dead for the session (iOS then has hamburger only). *Fix:* reset in `ScreenHost`'s route effect + unmount cleanups in each writer.

**H6 — Swipe-back onto the same route leaves the screen translated off-canvas (blank).** `src/store.tsx:186-189` (`openClient`/`openWorkout` push `prev.route` unconditionally — no same-route dedupe like `go()`), `Router.tsx:282-284, 306-324` (`drag` reset keyed only on `route`). Two taps in one JS frame (easy during a BL6/BL7 stall) → `history=[…,'clients','client']` → swipe back pops to `'client'` (unchanged) → `drag` stays at `SCREEN_W`. On-screen back link variant = first press does nothing. *Fix:* dedupe in `openClient/openWorkout`; `drag.setValue(0)` unconditionally in the release callback.

**H7 — Post-save navigation timers never cleared; drag interval has no unmount cleanup.** `createPlan.tsx:276, 285, 315, 324`, `trainer.tsx:6148, 6161`, `src/lib/useDragReorder.ts:131`. Tap back inside the 700-900 ms "Saved ✓" window → orphaned `goBack()` pops a second screen; the partner-leg timer mutates `selectedClientId` for an unmounted form. Unmount while holding a grip → a 31 Hz interval runs for the rest of the session calling `setState` on a dead tree. *Fix:* ref + `clearTimeout` on unmount; `useEffect(() => () => clearInterval(timer.current), [])`.

**H8 — Outbox `submitItem` spin-waits unbounded → Workout submit bar dead.** `src/lib/offline.ts:265` (`while (draining) await …120ms`); `processItem` inserts have no timeout. One hung background drain leaves `trainer.tsx:6232`'s `finally { setSaving(false) }` unreachable. *Fix:* bound the wait; timeout each `processItem`.

**H9 — Manager chat: 30 s retry loop runs while offline, freezing the composer, then the message is lost.** `src/lib/managerChatQueries.ts:257-285`; gating at `managerChat.tsx:1717, 1733, 1821, 2268, 2390`. Six attempts ≈ 30.5 s; every action is disabled on `sendM.isPending`; no outbox (unlike client chat); reschedule/plan paths `catch {}` silently (`:1753, :1817`). *Fix:* fail fast when `!getIsOnline()`, per-bubble Retry, show errors in the sheets.

**H10 — Capability/identity gates treat "unknown" as "denied".** `src/lib/capabilities.ts:96`, `src/lib/doctorQueries.ts:118`. Paused (offline) or errored queries return `EMPTY` → `crmEsc.tsx:51`, `doctorRehabRecommendation.tsx:58`, `qhpReview.tsx:286`, `trainer.tsx:9303-9318`, drawer entries (`chrome.tsx:150`) render hard denials with no retry. *Fix:* expose `isPending/isError`; "Checking access…" / "Couldn't verify — Retry".

**H11 — Location capture spinner with no timeout (3 sites).** `trainer.tsx:3747-3764, 7989-8006`, `doctorClientDetail.tsx:1018`. `getCurrentPositionAsync({High})` waits forever indoors. The repo already has the race pattern (`locationLog.ts:39-46`, `trainer.tsx:439-444`, `doctor.tsx:280`). *Fix:* reuse it (15 s → "Couldn't get a fix").

**H12 — Chat send: server rejection is silent and the message vanishes; double-send unguarded.** `chatQueries.ts:294-331` (no `onError`), `messenger.tsx:380-384, 829` (no `isPending` check, no `disabled`). Optimistic bubble stays "sending…" until the 60 s poll replaces it, then disappears; a double tap during a JS stall posts twice (`clientThreads.tsx:311/454` does this correctly). *Fix:* `onError` restoring draft + Alert (mirror `managerChat.tsx:1725`); guard on `sendM.isPending`.

**H13 — Hand-rolled base64 decoder freezes the JS thread 1-4 s on every QHP PDF upload.** `src/lib/qhpPdf.ts:243-268`. Full PDF → base64 string → regex strip → 342 k iterations × 4 `indexOf` (~44 M comparisons) + 1.4 M tiny string allocs. *Fix:* `fetch(uri).arrayBuffer()` as `chatMedia.ts:34-36` already does; delete `base64ToBytes`.

**H14 — Un-debounced realtime handlers (with a haptic per row) and a triple HOD subscription.** `messenger.tsx:1717` (all `messages` → 4-round-trip overview refetch), `:1762`; `crm.tsx:1029-1031` and `crmTabs.tsx:266-268` (`*` on all `session_schedule` + `Haptics` per event — a bulk roster create = 50-100 refetches + 50-100 buzzes); `managerChatQueries.ts:228-249, 768-772`; HOD screen subscribes three overlapping channels (`managerChat.tsx:1511, 1101` + `hod-feed-all`) → one insert fires 3 handlers and ~8 invalidations. *Fix:* shared 800 ms debounce (as `liveSync.tsx:61-68`), drop per-event haptics, one subscription for the HOD view.

**H15 — Pull-to-refresh invalidates the entire query cache.** `src/screens/common.tsx:194` (`invalidateQueries()` unfiltered) → 20-40 refetches now and every later screen refetches cold. *Fix:* `refetchQueries({ type: 'active' })`.

**H16 — `usePreviousExerciseData` re-downloads 1,000 rows every 60 s while the trainer types.** `src/lib/clientQueries.ts:544-585` (`staleTime: 0`, inherits polling). *Fix:* long `staleTime`, no interval, 90-day window / `DISTINCT ON` server-side.

**H17 — Store context churn: any store change re-renders the whole active screen.** `src/store.tsx:174-209` (all actions recreated on every `set`), `Router.tsx:227-247, 355` (nothing memoised). Opening the drawer re-renders the 1,300-element workout form behind it. *Fix:* split state/actions contexts (actions memoised once), `React.memo(RouteScreen)`, isolate `drawerOpen/aiOpen/sheet`.

**H18 — Accessibility is absent.** 0 `accessibilityLabel/Role/Hint/ViewIsModal` in `src/`: 1,377 Pressables announced as text, ~243 icon-only controls unlabelled (hamburger `chrome.tsx:22`, close drawer `:186`, send `messenger.tsx:829`, ~40 sheet ✕, delete rows), 120 Modals leave the screen behind them in the a11y tree, 37 no-op tap-swallowers announced as giant buttons, colour-only status dots (`trainer.tsx:2725`, `common.tsx:268`). *Fix:* role/label on the ~30 highest-traffic controls first; `accessibilityViewIsModal` on sheet containers + `importantForAccessibility="no-hide-descendants"` on backdrops.

**H19 — 10 unguarded mutation controls → duplicate writes and no feedback.** `crmClientDetail.tsx:840` (Mark Done), `crmService.tsx:137` (Mark Completed), `marketing.tsx:795` (Close ticket), `opsLeads.tsx:635` (follow-up done; label changes but not `disabled`), `opsLeads.tsx:621` (spam toggle), `messenger.tsx:380/829` (send), `crmSales.tsx:49/103` (reopen), `crmClientDetail.tsx:1709` (AI retry — billed twice), `doctorClientDetail.tsx:1305` (share switch), `crmDistribution.tsx:135`; plus Alert stacking on `crmService.tsx:46-52/131`, `crmSales.tsx:42`, `crmTasks.tsx:59`. Also 13 `.mutate()` sites with no `onError` at all (`coach.tsx:875, 366`, `crmClientDetail.tsx:210, 215, 383, 840`, `crm.tsx:886`, `doctorClientDetail.tsx:1251, 1305, 1354`, `marketing.tsx:795`, `messenger.tsx:228, 384`). *Fix:* `disabled={m.isPending}` + opacity + `onError` Alert; a tiny inline "Saved ✓" state.

**H20 — Untimed `functions.invoke` / storage / auth calls behind disabled buttons.** `adminRevenue.tsx:30-40` (password gate "Verifying…" forever, and the whole revenue area stays locked), `adminUserQueries.ts:40,62`, `adminRequestQueries.ts:446,467`, `adminClientDetailQueries.ts:299`, `coachClientQueries.ts:72,112,265`, `crmClientDetailQueries.ts:601`, `revenueForecastQueries.ts:317`, `chatMedia.ts:34-42` (50 MB video, no cancel), `navQueries.ts:68` (avatar), `trainerQueries.ts:384`, `doctorQueries.ts:1480`. *Fix:* one shared `withTimeout()` (patterns exist at `qhpPdf.ts:105-110`, `aiCache.ts:321-326`) applied at each call, `finally` for busy flags.

### MEDIUM

- **M1** Sheet controls under the home indicator / Android gesture bar: 43 bottom sheets hard-code `paddingBottom 24-34` with no `insets.bottom` (29 of 44 Modal files never import `useSafeAreaInsets`); worst: `coach.tsx:787/1025`, `coachClientSections.tsx:316`, `doctor.tsx:901` (no bottom padding at all).
- **M2** Doubled insets on three opaque full-screen Modals (no `statusBarTranslucent/navigationBarTranslucent`): `featureTour.tsx:541`, `messenger.tsx:981` lightbox, `qhpAssessmentForm.tsx:1186` — empty bands top/bottom on Android.
- **M3** Messenger reached via cold-start push has `canGoBack=false`, hidden Home bar and no in-content back → hamburger only on iOS (`Router.tsx:447`, no `BackLink` in `messenger.tsx`).
- **M4** Workout: swipe-back disabled by design, but the only `BackLink` scrolls away inside the ScrollView (`trainer.tsx:6265`) and Android back bypasses `goBack`'s `editingOutboxId` cleanup.
- **M5** Hard-coded `go('dashboard')` back-fallbacks send doctors/CRMs to the trainer dashboard (`managerChat.tsx:1980, 2147`); `createPlan.tsx:213` falls back to `'client'` with a nullable `selectedClientId`. `store.tsx:3-6` already warns about this drift.
- **M6** `['mgr-plan-outcome-v5']` is never invalidated by any write except the therapist RPC → crew card LOGGED/ACKED ticks stale up to 2 min (live) or indefinitely (final/upcoming) (`managerChatQueries.ts:412`, six mutations in `managerChat.tsx` invalidate only `mgr-plan-sched`; `offline.ts:186-189`).
- **M7** `liveSync` `TABLE_KEYS` omits `trainer-roster`, `doctor-roster`, `trainer-month-sessions`, `crm-month-roster`, `mgr-plan-*` — CRM reschedules reach trainers/managers only via the 60 s poll (`liveSync.tsx:29-30`).
- **M8** `PushTokenManager` re-subscribes its listener on every store change because `setOpenChat` is recreated per render (`store.tsx:192`); `aiCache` module singleton shows the previous CRM's counts after a switch (`aiCache.ts:51-73`).
- **M9** `coachClientSections.tsx:386-393` crashes offline (`q.data!` after `isLoading` gate — should be `isPending`).
- **M10** Media upload: failure silently deletes the bubble, no timeout/cancel on a 50 MB video (`chatQueries.ts:364-392`, `chatMedia.ts:34-42`); `VoiceBubble` creates a new `Audio.Sound` per tap while loading (`messenger.tsx:914-932`).
- **M11** Sheets that close only on success, error invisible behind the sheet (`managerChat.tsx:1751-1753, 1815-1817`); `LeaveSheet` pre-flight fetch leaves a duplicate-submit window (`overlays.tsx:244-258`); `confirmInactive` closes optimistically and discards the reason on failure (`crmClientDetail.tsx:213-218`; same at `:210, :383, :840`); duplicate-session check runs before the `saving` flag (`trainer.tsx:6179-6184`).
- **M12** Four `Animated.loop`s never stopped, two re-started per toggle on the same value (`crm.tsx:41, 75, 160, 1048`); `CountUpText` ignores `finished` and flashes the stale value, and re-counts from 0 every 60 s poll (`doctor.tsx:58-68`); `GrowBar` re-applies its stagger delay on every data change (`doctor.tsx:70-74`).
- **M13** Zero font-scaling defence (0 `allowFontScaling/maxFontSizeMultiplier`): fixed-height badges clip at ≥2× (`chrome.tsx:256-268, 289`, `primitives.tsx:442-456`), 3-up stat tiles wrap and desync (`common.tsx:295-302`, `coach.tsx:64`, `crm.tsx:526/774`, `academyAnalysers.tsx:215`).
- **M14** `CrmClients` renders an unvirtualized 200-row list (400 gradients) re-filtered per keystroke (`crmClients.tsx:29, 66`); 8 hidden Modals in `Workout()` still evaluate their children (exercise DB filtered per keystroke while closed, `trainer.tsx:7291-7300`); O(clients × sessions) reducers with silent 1000-row caps (`crmClientQueries.ts:54`, `crmQueries.ts:275`, `revenueForecastQueries.ts:195`); `useMonthRoster` `select('*')` × 2,000 rows every 60 s (`rosterQueries.ts:50-58`); `useClientSessions` unbounded (`clientQueries.ts:1258-1296`); chat image bubbles decode full-resolution uploads (`messenger.tsx:586`, `chatMedia.ts:10, 34-37`); always-mounted Drawer keeps 8 queries polling (`chrome.tsx:141-150`); `Page` `onScroll` at 16 ms app-wide (`common.tsx:207-221`); AI question builds context with 150 `JSON.parse` + ~300 `RegExp` per submit (`aiCache.ts:289-305`).
- **M15** `BottomNav` + `bottomTabs`/`tabMap` are dead code that would be wrong (trainer-only) if ever enabled (`chrome.tsx:39-73`, `data.ts:475-487`).

### LOW

`PdfPreview` "Loading…" forever if the WebView never fires load events (`PdfPreview.tsx:45-48`); `LocationGate` 'checking' spinner has no fallback if the permission call never settles (`LocationCapture.tsx:52-88`); `AccountSwitch` "Switching…" without timeout; push-token debounce runs ~9 s after sign-out under the old user (`pushToken.ts:17, 55-77`); `crmRoster.tsx:80-107` row re-enabled while its confirm Alert is up; `go()` clears `sheet` but not `crmDialog` (`store.tsx:144-155`); `reportDetail.tsx:86-89` SheetShell has no backdrop dismiss (has ✕/swipe/back); 116 of 120 Modals leave the status-bar strip undimmed on Android; shadow clipped by `overflow:hidden` on the chat toast (`messenger.tsx:1797`); RPE slider thumb may clip on Android (`trainer.tsx:5538-5545`); uncancelled `setTimeout(refresh, 30s/75s)` (`doctorQueries.ts:1560`), post-success Alert timer (`qhpAssessmentForm.tsx:739`), `oddsAi.tsx:192/199` (dead code); `Router.tsx:262` `enter.setValue(0)` during render; `Date`/`Intl` constructed per row (`adminRenewalQueries.ts:106/273`, `ops.tsx:162`); `offline.ts` persists once per drained item; `store.tsx:200` JSON clone of a 4-bool object.

---

## 3. Summary table (sorted by severity)

| ID | Area | File(s) | Issue |
|---|---|---|---|
| BL1 | Auth | auth.tsx:25-28,57-59 | Offline/flaky launch signs the user out; can't sign back in |
| BL2 | Gate | UpdateGate.tsx:45-120 | Play-scrape force-update can lock out all Android users; no exit |
| BL3 | Stuck | qhpAssessmentDetail.tsx:227-242, qhpPdf.ts | PDF generate/upload modal: no back, no ✕, no timeout |
| BL4 | Nav/Stuck | sessionHandoff.tsx:49-151, trainer.tsx:4158 | Handoff popup: no-op back, sibling-modal blank, untimed ack |
| BL5 | Stuck | trainer.tsx:101-110,190 | Sign-in latches "Signing in…" |
| BL6 | Perf | crmQueries.ts:320, crmTabQueries.ts:79, App.tsx:23-38 | O(n×m) Date parsing × global 60 s polling → CRM freezes every minute |
| BL7 | Perf | trainer.tsx:5641,6666 | Workout Log re-renders ~1,300 elements per keystroke |
| BL8 | Perf | App.tsx:42,105; OfflineWarmup.tsx; clientQueries.ts:1258,1816 | Persisted-cache stringify storm + multi-MB warm-up blobs |
| H1 | Lifecycle/Privacy | auth.tsx:92-96, offline.ts:16, locationLog.ts:49 | Nothing cleared on sign-out; outbox drains under wrong user |
| H2 | Security | linkedAccounts.ts:9-12 | Plaintext production credentials in the bundle |
| H3 | Deep link | PushTokenManager.tsx:47,59-73; Router.tsx:399-451 | Push replay on remount, duplicate handlers, `go('home')` |
| H4 | Nav | Router.tsx:292,422-433; clientThreads.tsx; createPlan.tsx:214 | Hardware back ignores overrides; plan guard bypassed |
| H5 | Gesture | gestureLock.ts; common.tsx:22-40 (+4) | `backSwipeLock` can stick app-wide |
| H6 | Nav | store.tsx:186-189; Router.tsx:282,306-324 | Same-route back leaves screen off-canvas |
| H7 | Lifecycle | createPlan.tsx:276-324; trainer.tsx:6148,6161; useDragReorder.ts:131 | Orphaned post-save timers; drag interval leak |
| H8 | Stuck | offline.ts:265 | Unbounded spin-wait kills Workout submit |
| H9 | Stuck | managerChatQueries.ts:257-285 | 30 s offline retry freezes composer, loses message |
| H10 | Stuck | capabilities.ts:96; doctorQueries.ts:118 | Unknown access rendered as denied (5 screens) |
| H11 | Stuck | trainer.tsx:3747,7989; doctorClientDetail.tsx:1018 | Location spinner without timeout |
| H12 | Stuck/Dup | chatQueries.ts:294; messenger.tsx:380-384,829 | Silent send failure; unguarded double send |
| H13 | Perf | qhpPdf.ts:243-268 | Base64 decoder freezes JS 1-4 s |
| H14 | Perf | messenger.tsx:1717,1762; crm.tsx:1029; crmTabs.tsx:266; managerChatQueries.ts | Un-debounced realtime + haptic per row; triple HOD subscription |
| H15 | Perf | common.tsx:194 | Pull-to-refresh invalidates everything |
| H16 | Perf | clientQueries.ts:544-585 | 1,000 rows re-fetched every 60 s mid-typing |
| H17 | Perf | store.tsx:174-209; Router.tsx:227-247 | Context churn re-renders whole screen on drawer toggle |
| H18 | A11y | app-wide | Zero labels/roles/modal flags (1,377 pressables, 120 modals) |
| H19 | Dup | 10 controls (see text) | Unguarded mutations → duplicate writes, no feedback |
| H20 | Stuck | adminRevenue.tsx:30-40 + 11 invoke/upload sites | Untimed edge/storage/auth calls behind disabled buttons |
| M1-M15 | Visual/Nav/Perf | see §2 | Safe-area, insets, fallbacks, stale keys, loops, font scaling, lists |
| L | — | see §2 | Polish |

---

## 4. Fix these first (top 5)

1. **BL1 — `auth.tsx` role fetch.** One-line class of bug, worst blast radius: every trainer who opens the app in a basement gym gets signed out and locked out. Capture the error; never sign out on "unknown".
2. **BL2 — UpdateGate safety valve.** Require the DB requirement (or clamp the scraped version), surface `openURL` failure, add Sign out. A markup change on Google's side must not brick the field.
3. **Query defaults + the two hot loops (BL6, BL8, H15, H16).** Remove the global `refetchInterval`, `refetchOnMount: true`, allow-list the persister, put the warm-up on a diet, index the missing-log match. This one change set removes most of the periodic freezes across CRM, trainer and manager screens.
4. **Escape hatches + timeouts for busy modals (BL3, BL4, BL5, H8, H11, H20).** A shared `withTimeout()` helper, `try/finally` on busy flags, and a Cancel/Later control that is never hidden. Ship BL7's `React.memo` card split with it — same file, same "app feels hung" complaint.
5. **Navigation + session integrity (H1, H3, H4, H5, H6, H7).** Sign-out teardown (cache/persister/outbox/store), push replay clear + single cold-start owner, hardware back honouring overrides, `create-plan` no-swipe + guard, `backSwipeLock` reset on route change, `openClient` dedupe + unconditional drag reset, cleared post-save timers.

*H2 (credentials in the bundle) is not a UX item but should be handled in the same release.*
