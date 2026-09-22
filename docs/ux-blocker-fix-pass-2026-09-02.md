# UX blocker fix pass — 2 Sep 2026

Companion to `ux-blocker-audit-2026-09-02.md`. Everything below is implemented in
the native app and passes `tsc` + a Metro bundle. Left as-is by decision:
**BL1, BL2, BL4, H2**. H13 was fixed as part of item 3.

Each section: what was wrong → what changed → how to test it by hand.

---

## 1. H1 — Sign-out / account switch leaks the previous user

**Was:** react-query cache (memory + SQLite persister), outbox, AI cache, device
token cache and store selections survived sign-out. The next account could see
the previous account's dashboards, drafts and chat selections.

**Now:** `src/lib/sessionTeardown.ts` is a teardown registry. Registered:
query-cache clear + persister wipe (App.tsx), outbox clear (per-user outbox
items are stamped with `userId` and only drained for the current user), AI cache
wipe, device-token cache reset, AsyncStorage per-user key purge. `resetSession()`
in the store clears history/selection state. Runs on `signOut()`, on the reverse
auth gate, on `onAuthStateChange → null`, and before AccountSwitch signs in.

**Test:** log a workout offline as trainer A (do not sync) → sign out → sign in as
trainer B → Home shows no pending log from A; B's dashboard has no A data flash.
Switch back to A → A's queued log is still there and syncs.

## 2. BL5 / H8 / H11 / H20 — Requests that could hang forever

- **BL5 / H20 (network calls):** every sign-in, edge-function invoke, storage
  upload and the heavy admin/coach/CRM/doctor/revenue queries now go through
  `src/lib/withTimeout.ts` (20 s network, 60 s upload, 90 s slow functions).
  A timed-out call shows an error + retry instead of a spinner forever.
- **H8 (Workout submit bar dead):** the outbox `submitItem` spin-wait is bounded
  (returns `queued` after ~12 s of another drain) and each `processItem` is
  wrapped in a 45 s timeout; timeouts count as transient (item stays queued).
- **H11 (GPS spinner):** all three `getCurrentPositionAsync` sites (trainer
  session start, workout sign-off, doctor client detail) time out at 15 s with
  "Couldn't get a fix".

**Test:** airplane mode ON, cold start, sign in → error within ~20 s, button
re-enabled. Workout → Log with a hung network → the Save spinner ends with a
queued/failed state, never stuck. Indoors with location on → "Couldn't get a
fix" within 15 s.

## 3. BL3 — QHP PDF generation freezes and can't be cancelled

**Was:** hand-rolled base64 decoder (1–4 s JS freeze), no timeouts, no cancel.

**Now:** `fetch(uri).arrayBuffer()` replaces the decoder (H13); print, upload and
the `qhp_details` update each have timeouts; a `CancelToken` threads through
narrative generation + render/upload; the sheet's ✕ / hardware back while busy
asks "Cancel generation?" and stops cleanly.

**Test:** QHP → Generate PDF → tap ✕ mid-way → confirm → sheet closes, no
half-written report is shown as complete. Let one finish → PDF opens as before.

## 4. BL6 / BL8 / H15 / H16 — Main-thread and refetch storms

- **BL6:** CRM missing-log matching is indexed by trainer / client:trainer
  (was O(n²) with `Date.parse` per comparison).
- **BL8:** the query persister writes at most every 5 s and only for the
  offline-critical allow-list (`PERSIST_PREFIXES`); arrays >400 rows and the
  `NEVER_PERSIST` set are never serialised. Cache buster bumped to `v3`.
- **H15:** pull-to-refresh refetches only *active* queries.
- **H16:** previous-exercise lookups cover 90 days, refresh every 10 min, never
  on window focus; client sessions capped to 60 rows / 365 days; OfflineWarmup
  warms 10 clients and no longer mounts session/report queries.
- **Session Logs live updates kept:** the global 60 s poll is gone, but Sessions
  pages (trainer month sessions, today roster, doctor own roster) poll every
  60 s themselves and `liveSync` TABLE_KEYS include every roster key.

**Test:** CRM home cold start → no multi-second freeze; Sessions page: log a
session from another device → appears within ~60 s without pull-to-refresh.

## 5. BL7 / H17 — Workout log keystroke re-renders the whole form

**Now:**
- `ExerciseCard` is a module-level `React.memo` component; every handler passed
  to it is a stable `useCallback`; `useDragReorder` returns a stable API object.
- `SetInput` keeps text locally and commits to state on blur / end-editing /
  250 ms of quiet. Every structural write (`setExercises` wrapper, add/remove
  set, remove/reorder exercise) and `submit()` flush pending edits first, so an
  index-based commit can never land on the wrong set and nothing typed is lost.
- Store split: actions live in a stable `ActionsCtx` (`useStoreActions()`),
  state in the existing context; `RouteScreen` is memoised on (route, role).

**Test (regression-critical):** Workout → add 6 exercises × 4 sets → type reps
quickly in the last set → no lag; tap "Add set" immediately after typing → the
new set prefilled with what you just typed; type then immediately press Log →
confirm dialog shows the typed values; drag-reorder still works; template load
overwrites typed values; RPE slider, duplicate guard, couple flow unchanged.

## 6. H3 / H4 / H5 / H6 / H7 — Navigation & lifecycle

- **H3:** push tap is consumed once per process and cleared
  (`clearLastNotificationResponseAsync`); Router clears chat-push launches it
  consumes; non-chat pushes route to `homeRouteFor(role)` (not the bogus
  `'home'`).
- **H4:** Android hardware back honours `backOverride` (open chat thread closes,
  Create Plan shows its discard guard, Workout runs its cancel cleanup); Client
  Threads registers an override; `'create-plan'` added to `NO_SWIPE_BACK`.
- **H5:** `backSwipeLock` resets on every route change and on unmount of every
  writer (HScroll, TimeDial, RPE slider, swipe-reply rows).
- **H6:** `openClient` / `openWorkout` dedupe same-route pushes; the swipe-back
  release always resets the drag offset (no blank off-canvas page).
- **H7:** post-save "Saved ✓" timers (Create Plan ×4, Workout ×2) live in refs,
  cleared on back/unmount; drag interval cleared on unmount.

**Test:** tap a chat push → thread opens once; sign out/in → not re-opened.
Inside a Messenger/Client thread press hardware back → thread closes, list
stays. Create Plan with content → hardware back → "Discard this plan?"; edge
swipe does nothing. Save a plan and tap back within the "Saved ✓" second → lands
one screen back, not two. Scroll a chip row, navigate away mid-touch → swipe-back
still works on the next screen.

## 7. H9 / H10 / H12 / H19 — Stuck states and duplicate writes

- **H9 Manager chat:** offline sends fail immediately (no 30 s freeze); a failed
  text stays in the thread as a dimmed "NOT SENT · TAP TO RETRY / DISCARD"
  bubble; reschedule / plan message failures show an Alert instead of vanishing.
- **H10 Access gates:** `useMyCapabilities` / `useDoctorIdentity` expose
  `isPending / isPaused / isError / refetch`; CRM Escalations, Rehab
  Recommendation, QHP Review and QHP Manager show "Checking access…" /
  "Waiting for connection…" / "Couldn't verify access — Retry" instead of a
  false denial.
- **H12 Client chat send:** server rejection removes the optimistic bubble,
  restores the draft + quote and alerts; send button disabled while pending;
  synchronous double-tap guard.
- **H19:** `disabled={isPending}` + dimming + `onError` Alerts on: Mark Done
  (CRM client detail + CRM home), Mark Completed (services), Close Ticket
  (marketing), follow-up done + spam toggle (ops leads), Reopen (sales), AI
  insight Retry, share switch + delete entry/remark (doctor client detail),
  distribution bucket chips, coach rating + plan action, client status changes,
  journey steps, suggestion dismiss.

**Test:** airplane mode → Manager chat send → bubble marked NOT SENT instantly;
reconnect → tap → sent. Open CRM Escalations offline with an empty cache →
"Waiting for connection…" (not "CRM Manager Only"). Double-tap Mark Done → one
row updated, button dims during the write.

## 8. H14 — Realtime storms

`src/lib/invalidateDebounced.ts` coalesces invalidations per query key app-wide
(800 ms; 400 ms for chat lists). Used by liveSync, CRM approvals (home + page,
per-event haptic removed), messenger global listeners, manager chat channels.
The HOD view keeps ONE `hod-feed-all` subscription (per-team cards no longer
open their own channels).

**Test:** bulk-create 30 roster rows from the web → CRM Approvals refetches
once, phone does not buzz 30 times.

## 9. H18 — Accessibility (first pass)

Roles/labels on: hamburger, drawer backdrop/close/profile/logout/nav rows,
BackLink, ActionBtn, messenger + manager-chat send, manager-chat back, exercise
card grip / remove / add-set / remove-set / all nine set inputs, access-retry
button, failed-bubble retry/discard. `accessibilityViewIsModal` on the drawer
and the Workout sheets/dialogs; backdrops hidden from the a11y tree; tap-swallow
containers no longer announced as buttons.

**Test:** TalkBack on → Workout: swipe through a set → hears "Set 1 reps",
"Remove set 1", "Add set to Squat"; open the drawer → focus stays inside it.

---

## Files touched (new)
`src/lib/sessionTeardown.ts`, `src/lib/withTimeout.ts`,
`src/lib/invalidateDebounced.ts`, `AccessPending` in `src/screens/common.tsx`,
`ExerciseCard` / `SetInput` / `flushPendingSetCommits` in `src/screens/trainer.tsx`,
`useStoreActions` in `src/store.tsx`.

## Standing rules from this pass
- New network call in a screen → wrap in `withTimeout` / `invokeWithTimeout`.
- New realtime handler → `invalidateDebounced(qc, key)`, never a haptic per event.
- New capability-gated screen → render `<AccessPending>` while `isPending || isError`.
- New per-user cache (AsyncStorage/SQLite) → register it with `registerTeardown`.
- New Workout set field → use `SetInput`; never a raw controlled `TextInput` in the card.
- Screen with an internal sub-view → set `backOverride.handler`; the hardware back and edge swipe both honour it.
