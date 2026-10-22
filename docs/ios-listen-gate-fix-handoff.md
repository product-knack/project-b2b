# iOS handoff: the "Listen before you log" sheet closes on the second Play (fixed on Android 22 Oct 2026)

For the iOS Expo repo (separate Claude session). Self-contained: everything needed to find, fix and test the bug is
below. Android commit: "Listen sheet holds until Proceed to workout" (product-knack/project-b2b, 22 Oct 2026).
Feature doc: `docs/features/android/trainer/client-health-summary.md` (sections 3, 6, 8, 9, 10).

## 1. The bug as a trainer sees it
1. Today's Roster > a client > **Log Workout** (Add Workout).
2. The sheet **"Listen before you log"** opens with two items: **This week's training** (due every day) and
   **Health context** (due when a new report rebuilt it).
3. The trainer plays the first item. Then taps **Play** on the second one.
4. Within a second the sheet closes, the voice stops, and the workout form opens. The trainer never heard the
   second summary, and never tapped the button.
5. Related: the button already counts the first item as heard the moment Play is tapped, not when the audio ends.

Owner's requirement: both due summaries must be heard to the end, and only then does the trainer tap
**"Proceed to workout"**, which opens the form.

## 2. Why it happens (check the iOS code for the same chain)
- The sheet's `play(which)` calls the listen mutation (`useLogSummaryListen` -> RPC `log_summary_listen`) **before**
  the audio plays (intended: the server trail records every play, web parity).
- On settle the mutation invalidates `['client-health-summary', clientId, ...]`; the summary row comes back with
  this trainer's listen in `listen_history`, so `listenGate(row, uid)` now says `done` for that item.
- The **Workout form** decided whether the sheet shows from that same row:
  `listenRequired = listenEligible && !listenDone && !!summaryQ.data && gateDue(listenGate(summaryQ.data, uid))`.
  After the SECOND Play both items read `done`, `gateDue` is false, `listenRequired` turns false, the sheet's
  `visible` goes false, its effect calls `voice.stop()`, and the form shows.
- Inside the sheet `need(which) = gate[which] === 'due' && !heard[which]` used the LIVE gate, so after a Play the
  item already read `done` and the button counted it as heard.
- Files on Android (look for the same names in iOS): `src/screens/trainer.tsx` (`Workout`: `listenEligible`,
  `summaryQ`, `listenDone`, `listenRequired`, the `<ListenGateSheet … onContinue={() => setListenDone(true)} />`
  mount), `src/components/clientHealthSummaryCard.tsx` (`ListenGateSheet`), `src/lib/clientHealthSummary.ts`
  (`listenGate`, `gateStateFor`, `gateDue`), `src/lib/clientHealthSummaryQueries.ts` (`useLogSummaryListen`),
  `src/lib/summaryVoice.ts` (`onDone` fires only after the last part played, or after the device voice finished
  reading; `stop()` never fires it; check that the iOS copy behaves the same).

## 3. The fix (three parts)

### 3a. Pure rules, add to `src/lib/clientHealthSummary.ts` (copy byte for byte, after `gateDue`)
```ts
/* ---------- The Add Workout listen sheet (22 Oct 2026) ----------
   Owner: "after both listens the trainer must tap Proceed to workout". Play records the listen on the server at
   once, so the refreshed row reads "done" seconds into the audio. Before this fix the second Play therefore made
   the form decide nothing was due, close the sheet (which stopped the voice) and open the workout form, and the
   button counted an item as heard the moment Play was tapped. Two rules close it:
   1. listenSheetUp: once the sheet has been needed it stays up until the trainer taps Proceed (armed), whatever
      the row says after a refresh.
   2. listenStillNeeded / listenAllHeard: what is due is judged from the row AS IT WAS WHEN THE SHEET OPENED
      (atOpen), and an item counts only when its audio played to the end on this phone (or its transcript stood in
      because nothing could speak). */
export type HeardMap = Record<Which, boolean>;
export const LISTEN_PROCEED = 'Proceed to workout';
export const LISTEN_WAIT = 'Listen first';

export const listenSheetUp = (o: { done: boolean; armed: boolean; eligible: boolean; due: boolean }): boolean =>
  !o.done && (o.armed || (o.eligible && o.due));

export const listenStillNeeded = (atOpen: ListenGate, heard: HeardMap, which: Which): boolean =>
  atOpen[which] === 'due' && !heard[which];

export const listenAllHeard = (atOpen: ListenGate, heard: HeardMap): boolean =>
  !listenStillNeeded(atOpen, heard, 'weekly') && !listenStillNeeded(atOpen, heard, 'context');
```

### 3b. The Workout form (`Workout` in `src/screens/trainer.tsx`)
Replace the three lines that compute `listenRequired`:
```ts
const [listenDone, setListenDone] = React.useState(false);
React.useEffect(() => { setListenDone(false); }, [selectedClientId, workoutScheduleId]);
const listenRequired = listenEligible && !listenDone && !!summaryQ.data && gateDue(listenGate(summaryQ.data, authSession?.user?.id ?? null));
```
with:
```ts
const [listenDone, setListenDone] = React.useState(false);
// Once needed, the listen sheet STAYS up until the trainer taps Proceed to workout (22 Oct 2026): Play records the
// listen at once, so the refreshed row read "done" and closed the sheet mid-audio on the second Play.
const [listenArmed, setListenArmed] = React.useState(false);
React.useEffect(() => { setListenDone(false); setListenArmed(false); }, [selectedClientId, workoutScheduleId, editingOutboxId]);
const listenDue = listenEligible && !!summaryQ.data && gateDue(listenGate(summaryQ.data, authSession?.user?.id ?? null));
React.useEffect(() => { if (listenDue && !listenDone) setListenArmed(true); }, [listenDue, listenDone]);
const listenRequired = listenSheetUp({ done: listenDone, armed: listenArmed, eligible: listenEligible, due: listenDue });
```
and add `listenSheetUp` to the import from `'../lib/clientHealthSummary'`. Everything else that reads
`listenRequired` (the sheet's `visible`, the health check-in auto-open, the partner prompt, the Submit hint) stays
as it is. `editingOutboxId` is in the reset list so editing a queued log never inherits an armed sheet.

### 3c. The sheet (`ListenGateSheet` in `src/components/clientHealthSummaryCard.tsx`)
1. Import: add `type ListenGate, type HeardMap, listenStillNeeded, listenAllHeard, LISTEN_PROCEED, LISTEN_WAIT`
   to the import from `'../lib/clientHealthSummary'`.
2. Right after `const gate = listenGate(row, uid);` add the frozen gate:
```ts
// What is due is fixed when the sheet opens (22 Oct 2026): Play records the listen at once and the refreshed
// row would read "done" seconds into the audio. Only a play to the end (or a transcript that stood in) counts.
const [atOpen, setAtOpen] = React.useState<ListenGate | null>(null);
React.useEffect(() => {
  if (!visible) { setAtOpen(null); return; }
  if (!atOpen && row) setAtOpen(gate);
}, [visible, row, atOpen]); // eslint-disable-line react-hooks/exhaustive-deps
const gateNow: ListenGate = atOpen ?? gate;
```
3. `useState<Record<Which, boolean>>` for `heard` becomes `useState<HeardMap>` (same shape).
4. Replace
```ts
const need = (which: Which) => gate[which] === 'due' && !heard[which];
const allDone = !need('weekly') && !need('context');
```
with `const allDone = listenAllHeard(gateNow, heard);`
5. In the rows, `status={gateStatus(which, gate[which], heard[which], row)}` becomes
   `status={gateStatus(which, gateNow[which], heard[which], row)}`.
6. Button text `{allDone ? 'Continue to log' : 'Listen first'}` becomes `{allDone ? LISTEN_PROCEED : LISTEN_WAIT}`.
7. Footnote text becomes: `Every play is recorded with your name and the time. Red items must be heard to the end,
   then tap {LISTEN_PROCEED}.`
Keep: `play()` still logs the listen first (the server trail), `onDone` sets `heard[which]`, `onError` opens the
transcript and counts it as heard, `finish()` stops the voice and calls `onContinue`. (Back to roster was removed
later the same day, see section 8.)

## 4. Rule test, add to `tests/rules/health_summary_rules_test.js` (before the final console.log)
```js
const both = { weekly: 'due', context: 'due' };
const none = { weekly: false, context: false };
eq('sheet: due, not armed yet', R.listenSheetUp({ done: false, armed: false, eligible: true, due: true }), true);
eq('sheet: the refreshed row reads done after Play, but armed keeps it up', R.listenSheetUp({ done: false, armed: true, eligible: true, due: false }), true);
eq('sheet: armed stays up through a network blip', R.listenSheetUp({ done: false, armed: true, eligible: false, due: false }), true);
eq('sheet: Proceed tapped closes it', R.listenSheetUp({ done: true, armed: true, eligible: true, due: true }), false);
eq('sheet: nothing due, never armed', R.listenSheetUp({ done: false, armed: false, eligible: true, due: false }), false);
eq('sheet: not eligible (editing a queued log, offline at open)', R.listenSheetUp({ done: false, armed: false, eligible: false, due: true }), false);
eq('heard: nothing heard, both due', R.listenAllHeard(both, none), false);
eq('heard: first heard to the end only', R.listenAllHeard(both, { weekly: true, context: false }), false);
eq('heard: Play tapped on the second (row now says done) is not enough: atOpen still says due', R.listenStillNeeded(both, { weekly: true, context: false }, 'context'), true);
eq('heard: both heard to the end', R.listenAllHeard(both, { weekly: true, context: true }), true);
eq('heard: only the weekly was due at open', R.listenAllHeard({ weekly: 'due', context: 'done' }, { weekly: true, context: false }), true);
eq('heard: a missing summary is never required', R.listenAllHeard({ weekly: 'none', context: 'due' }, { weekly: false, context: true }), true);
eq('button copy', [R.LISTEN_PROCEED, R.LISTEN_WAIT], ['Proceed to workout', 'Listen first']);
```
Run `node tests/rules/health_summary_rules_test.js` (Android: 42 checks, ALL PASS).

## 5. Nothing on the server changes
Same RPCs (`get_client_health_summary`, `log_summary_listen`), same edge function `speak-client-summary`.

## 6. Verify on an iPhone
Pick a roster client whose two summaries are due for you today (Sagar's Vashist Dev or Asad work; or any client you
have not listened to today).
1. Log Workout: the sheet shows two red items, the button reads "Listen first" and is disabled.
2. Play the first and let it finish: its chip turns green; the button stays "Listen first".
3. Play the second: the sheet STAYS, the voice keeps playing. Stop it halfway: still "Listen first".
4. Play it again to the end: the button turns green, "Proceed to workout".
5. Tap it: the health check-in (or the form) opens.
6. Back to the roster and Log Workout again for the same client: no sheet (both heard today per the trail).
7. iOS silent mode gives no sound on a physical device (expo docs): use the transcript toggle or turn the ring switch.

## 7. Known gap left open on both platforms (owner to decide)
A Play on the Today's Roster summary strip or on the client page, even stopped at once, writes the trail, so the
Add Workout sheet does not appear for that client that day. Closing it needs a "heard to the end" mark on the
server (web and app), not built.

## 8. Follow-up the same day: no "Back to roster" button (Android, 22 Oct 2026)
Owner: "on the workout log page there is a Back to roster button", then "fix this as not show this button".
Found: Play each item for a second, tap **Back to roster**, tap Log Workout again for the same client, and the
sheet does not come back (the trail already holds both plays). The sheet's only way out is now
**Proceed to workout**.
1. `ListenGateSheet` (`src/components/clientHealthSummaryCard.tsx`): delete the `onLeave` prop (type and
   destructuring) and `const leave = ...`; the Modal becomes
   `<Modal visible={visible} transparent animationType="slide" onRequestClose={() => {}}>` (on iOS this only
   matters for a hardware keyboard Escape; keep it identical anyway); delete the Back to roster `Pressable`; the
   button row becomes `<View style={{ flexDirection: 'row', marginTop: 12 }}>` and the Proceed `Pressable` style
   `flex: 1` (was `flex: 1.3`).
2. `Workout` (`src/screens/trainer.tsx`): remove `onLeave={() => goBackRef.current()}` from the `<ListenGateSheet>`
   mount.
3. If the iOS sheet uses a swipe-down or pageSheet presentation, turn that off for this sheet too
   (`presentationStyle="overFullScreen"` with `transparent`, no `onDismiss` exit), or the swipe is a second door.
Nobody gets stuck: a summary that cannot load or speak counts as heard (the transcript opens), and the form's own
Cancel works after Proceed. Closing the app while the sheet is up still resets it (needs the server mark of
section 7). Verify: open Log Workout on a client with both summaries due; the sheet shows one button only; the
back gesture does nothing; Play both to the end; Proceed to workout opens the form.
