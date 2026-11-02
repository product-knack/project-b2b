# iOS handoff: smoother workout log form (Android, 2 Nov 2026)

Owner: "some users complain the workout log form is not smooth". Android fixed five things in Add Workout
(`src/screens/trainer.tsx` `Workout`, `src/screens/common.tsx` `Page`, `src/lib/offline.ts`). No server change.
The iOS app was ported from this code, so check each point in its copy.

## 1. Load box: number keyboard + BW button (visible change)
- Before: load used the letter keyboard in capitals (`autoCapitalize="characters"`) so "BW+5" could be typed; every
  set needed a "?123" tap, and the keyboard height changed between reps (number pad) and load.
- Now: `LoadCell` = a `SetInput` with `decimal` + `keyboardType="decimal-pad"` and a 34 px **BW** button beside it.
  BW on = bodyweight; the box then holds the extra kg (placeholder "+ kg").
- Saved text is unchanged: "20", "BW", "BW+5". Copy `src/lib/workoutLoad.ts` byte for byte (`splitBodyweightLoad`,
  `joinBodyweightLoad`, `decimalOnly`) and `tests/rules/workout_load_test.js` (ALL PASS).
- The BW toggle calls `flushPendingSetCommits()` first and keeps the newest typed number in a ref, so toggling right
  after typing never drops it.
- Template builder and Create Plan keep the old free-text load box.

## 2. The form must not subscribe to the whole offline queue
- Android had `const outboxAllW = useOutboxAll()` in `Workout` (21 Oct) only to word a refused session code. Every
  queue or network event gave it a new array and redrew the whole form. Now `getOutboxMine()` (new export in
  `offline.ts`: `items.filter(mine)`) is read only in the submit error path.
- `offline.ts` NetInfo listener: `notify()` only when the online flag actually flips (NetInfo also fires for signal
  and link changes with the same answer).

## 3. Keyboard height only while a sheet needs it
- `Workout` listened to keyboard show/hide for its three sheets (health check-in, Add Exercise, templates) all the
  time, redrawing the form on every keyboard event. Now the listener runs only while `healthOpen || pickerOpen ||
  templatesOpen`; on open it reads `Keyboard.isVisible()` / `Keyboard.metrics()` for a keyboard already up.

## 4. Text boxes type locally (`SetInput`)
- Session name, Remarks, the exercise search and the sleep / steps / hydration boxes were `TextInput`s bound to
  form state (a full redraw per keystroke). They are now `SetInput` (local text, commit after 250 ms, on blur or on
  `flushPendingSetCommits()`).
- New `SetInput` props: `decimal` (digits + one point), `commitOnEmptyChange` (commit at once when the box goes
  empty <-> filled, so Save Health Data enables immediately; used on the three health boxes). `onFocus` is passed
  through.
- Anything that SAVES a typed value flushes first and reads a ref: `remarkRef`, `sessionNameRef` (submit, the
  couple-session draft snapshot, the draft writer), `hValsRef` (saveHealth), `exSearchRef` (the two "add custom
  exercise" buttons). Commit handlers write the ref at once, then set state.
- The draft's unmount / background flush commits waiting text first (`flushPendingSetCommits()` returns a count;
  dirty is set only when the form is not done and not editing a queued log).

## 5. Next box scrolls above an open keyboard
- `Page` exports `PageRevealContext` (Android only): `reveal()` measures the focused input and scrolls it 24 px
  above the keyboard. It ran only on `keyboardDidShow`; `SetInput` now calls it on focus, so moving to the next set
  with the keyboard already open no longer leaves the box behind it. Null outside a `Page` (sheets), a no-op on iOS
  (iOS uses `automaticallyAdjustKeyboardInsets`), so on iOS only points 1 to 4 apply.

## Check on the iPhone
1. Log a Strength session: the load box shows the number pad; BW toggles orange; type 5 with BW on and save: the
   session shows load "BW+5" on the web.
2. Type a remark and press Log within a second: the saved log has the full remark.
3. Health check-in: type sleep, steps, water; Save turns on as soon as each box has a value; saved values are the
   full numbers typed.
4. Type quickly in Remarks with many exercises in the list: no lag.
