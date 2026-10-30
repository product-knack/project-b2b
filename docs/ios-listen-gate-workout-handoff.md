# iOS handoff: the mandatory "Listen before you log" popup in the workout log (30 Oct 2026)

One self-contained file for the popup that makes a trainer hear the client's short summary (This week's training) and
long summary (Health context) before logging a workout. It is the current Android behaviour in builds 5.1 (44) and
5.2 (43), and replaces reading the pieces spread over `client-health-summary-handoff.md` (9 Oct),
`ios-listen-gate-fix-handoff.md` (22 Oct) and `ios-listen-rule-handoff.md` (27 Oct). The whole summaries system
(how the summaries are built, the voice, the other screens) is in `ios-health-summaries-context.md`.
No server change: everything below is live.

## 1. The rule

| | Short: This week's training | Long: Health context |
|---|---|---|
| Changes | every night (built at 1:00 AM IST for the next training day) | only when a new report, QHP, consultation or record arrives (copied forward unchanged otherwise) |
| Must be heard | **every day**: my last listen must be today (IST) and after its latest build | **once per update**: my last listen must be after its latest build, any day |
| Nothing built yet | not required | not required |

- "My listen" = an entry in the summary's listen trail by the signed-in trainer, written when they press Play
  anywhere in the app (the roster strip, the client page, this popup, My Crew). The server carries each person's
  newest earlier-day context listen onto today's row (`carried: true`), which is what makes the long one "once per
  update".
- Inside the popup, a due item counts only when its audio **plays to the end on this phone** (or, if nothing can
  speak, its transcript is opened instead).

## 2. When the popup shows (all four must hold)
1. The workout form was opened **from Today's Roster** (it has a schedule id; Android `workoutScheduleId`).
2. The phone is **online** (offline the listen could not be recorded, so the popup is skipped).
3. The form is **not editing a queued (offline) log**.
4. At least one summary is **due** for the signed-in trainer (section 1).

If the summary row cannot be read (no row, not allowed, function missing), nothing is required: the popup never blocks
on a read failure.

## 3. Order and what it blocks
- The popup comes **first**. The Log Health Data check-in (sleep, nutrition, steps, hydration, medicines) auto-opens
  only after the popup is cleared. The couple (partner) prompt also waits for it.
- While it is required, **Submit is off** and the hint under the form reads "Listen to the client's summaries first".
- It cannot be dismissed: no backdrop tap, no close button, and the phone's back gesture does nothing. The only way
  out is **Proceed to workout**, enabled after every red item was heard to the end. (A "Back to roster" button
  existed until 22 Oct; it was removed because Play, back, and re-entering skipped the popup.)
- Once Proceed is tapped it does not come back for this form. Changing the client, the roster slot, or opening a
  queued log resets it.

## 4. Server contract (live)

| Call | Shape | Notes |
|---|---|---|
| `get_client_health_summary(p_client_id uuid, p_date date default null)` | one row `{client_id, briefing_date, status, built_at, weekly_summary, context_summary, listen_history, has_quiz, auction_result, context_dirty}` | the row in effect today; `listen_history = [{at, by, by_name, role, which: 'weekly' \| 'context', version, briefing_date, carried?}]`, oldest first; earlier-day context listens of each person are prepended with `carried: true`. Treat `PGRST202`, `42P01`, `42501` as "no row". `weekly_summary.script`, `weekly_summary.generated_at`, `context_summary.script`, `context_summary.generated_at` drive the rule |
| `log_summary_listen(p_client_id uuid, p_which 'weekly' \| 'context')` | the new trail entry | call it **when Play is pressed, before the audio** (the trail is the record whatever the voice does next). `PGRST202` → "Listening is not set up on the server yet. Tell the tech team." |
| Edge `speak-client-summary` `{client_id, which}` | `{urls[], parts, version, ...}` | the Sarvam recording; the device voice is the fallback. Your existing `summaryVoice` port handles this |

## 5. Code to port

### 5.1 Pure rules (`src/lib/clientHealthSummary.ts`; copy byte for byte if not already identical)
```ts
export type Which = 'weekly' | 'context';
export type GateState = 'none' | 'done' | 'due';

export const hasScript = (row, which) => !!summaryOf(row, which)?.script?.trim();

/** The signed-in user's newest listen of that kind (the trail is oldest first). */
export const myLastListen = (history: ListenEntry[], which: Which, uid: string | null | undefined): ListenEntry | null => {
  if (!uid) return null;
  for (let i = history.length - 1; i >= 0; i--) { const h = history[i]; if (h.which === which && h.by === uid) return h; }
  return null;
};

export const gateStateFor = (row, which: Which, uid, nowMs: number = Date.now()): GateState => {
  const g = generatedAtOf(row, which);                    // summary.generated_at
  if (!hasScript(row, which) || !g) return 'none';
  const mine = myLastListen(historyOf(row), which, uid);
  if (!mine) return 'due';
  const heardAt = new Date(mine.at).getTime();
  if (!isFinite(heardAt) || heardAt < new Date(g).getTime()) return 'due';
  if (which === 'weekly' && istDayOf(mine.at) !== istDayOf(nowMs)) return 'due';   // the daily rule
  return 'done';
};

export type ListenGate = { weekly: GateState; context: GateState };
export const listenGate = (row, uid, nowMs = Date.now()): ListenGate => ({ weekly: gateStateFor(row, 'weekly', uid, nowMs), context: gateStateFor(row, 'context', uid, nowMs) });
export const gateDue = (g: ListenGate): boolean => g.weekly === 'due' || g.context === 'due';

/* Holding the popup (22 Oct 2026) */
export type HeardMap = Record<Which, boolean>;
export const LISTEN_PROCEED = 'Proceed to workout';
export const LISTEN_WAIT = 'Listen first';
export const listenSheetUp = (o: { done: boolean; armed: boolean; eligible: boolean; due: boolean }): boolean =>
  !o.done && (o.armed || (o.eligible && o.due));
export const listenStillNeeded = (atOpen: ListenGate, heard: HeardMap, which: Which): boolean => atOpen[which] === 'due' && !heard[which];
export const listenAllHeard = (atOpen: ListenGate, heard: HeardMap): boolean =>
  !listenStillNeeded(atOpen, heard, 'weekly') && !listenStillNeeded(atOpen, heard, 'context');

/* Copy (27 Oct 2026) */
export const LISTEN_WHY = 'Each summary must be heard once after it changes, or Submit stays off.';
export const listenRuleLine = (which: Which, state: GateState, clientFirstName?: string | null): string | null => {
  const name = (clientFirstName ?? '').trim().split(/\s+/)[0] || 'this client';
  if (state === 'none') return null;
  if (state === 'done') return 'Heard after the latest update. You can log.';
  return which === 'context'
    ? `Listen to this at least once. It changed since you last heard it. You cannot log a workout for ${name} until you do.`
    : `Listen to this at least once today. You cannot log ${name}'s workout until you do.`;
};
```
`istDayOf` is the IST calendar day (`Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', ... })`).
Why `armed` and `atOpen` exist: Play writes the listen at once, so seconds into the audio the refreshed row reads
"done". Without `armed` the popup closed mid-audio on the second Play and dropped the trainer into the form; without
`atOpen` the button counted an item as heard the moment Play was tapped.

### 5.2 Queries (`src/lib/clientHealthSummaryQueries.ts`)
```ts
export async function fetchClientHealthSummary(clientId: string, date?: string | null) {
  const { data, error } = await withTimeout(Promise.resolve(supabase.rpc('get_client_health_summary', { p_client_id: clientId, p_date: date ?? null })), NET_MS, 'Client summary');
  if (error) { if (error.code === 'PGRST202' || error.code === '42P01' || error.code === '42501') return null; throw new Error(error.message); }
  const row = Array.isArray(data) ? data[0] : data;
  return row ? toRow(row) : null;
}
export function useClientHealthSummary(clientId, enabled = true, date?: string | null) {
  return useQuery({ queryKey: ['client-health-summary', clientId ?? null, date ?? 'today'], enabled: !!clientId && enabled, staleTime: 60_000,
    queryFn: () => fetchClientHealthSummary(clientId as string, date ?? null) });
}
export function useLogSummaryListen(clientId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (which: Which) => {
      if (!clientId) throw new Error('No client selected.');
      const { data, error } = await withTimeout(Promise.resolve(supabase.rpc('log_summary_listen', { p_client_id: clientId, p_which: which })), NET_MS, 'Listen');
      if (error) throw new Error(error.code === 'PGRST202' ? 'Listening is not set up on the server yet. Tell the tech team.' : error.message);
      return data;
    },
    onSettled: () => { qc.invalidateQueries({ queryKey: ['client-health-summary', clientId ?? null] }); },
  });
}
```

### 5.3 The workout form (`Workout`, src/screens/trainer.tsx)
```ts
const { session: authSession } = useAuth();
const listenEligible = !!workoutScheduleId && !editingOutboxId && isOnline;
const summaryQ = useClientHealthSummary(selectedClientId, listenEligible);
const [listenDone, setListenDone] = React.useState(false);
const [listenArmed, setListenArmed] = React.useState(false);
React.useEffect(() => { setListenDone(false); setListenArmed(false); }, [selectedClientId, workoutScheduleId, editingOutboxId]);
const listenDue = listenEligible && !!summaryQ.data && gateDue(listenGate(summaryQ.data, authSession?.user?.id ?? null));
React.useEffect(() => { if (listenDue && !listenDone) setListenArmed(true); }, [listenDue, listenDone]);
const listenRequired = listenSheetUp({ done: listenDone, armed: listenArmed, eligible: listenEligible, due: listenDue });
```
- Submit: add `&& !listenRequired` to `canSubmit`.
- Hint: when `listenRequired`, the missing-field hint reads `"Listen to the client's summaries first"` (after the
  plan-limit hint, before the others).
- The health check-in auto-open waits for it:
  `if ((gateBlocking || medicineOnly) && !listenRequired && !autoOpened.current) { ...prefill...; setHealthOpen(true); }`
  with `listenRequired` in the effect's dependencies.
- The partner (couple) prompt's `visible` gets `&& !listenRequired`.
- Render the popup (one modal at a time):
```tsx
<ListenGateSheet
  visible={listenRequired && !healthOpen && !templatesOpen && !pairPickerOpen && !dupOpen}
  clientId={selectedClientId}
  clientName={clientName}
  onContinue={() => setListenDone(true)}
/>
```

### 5.4 The popup (`ListenGateSheet`, src/components/clientHealthSummaryCard.tsx)
Logic, exactly:
```tsx
export function ListenGateSheet({ visible, clientId, clientName, onContinue }) {
  const uid = useAuth().session?.user?.id ?? null;
  const q = useClientHealthSummary(clientId, visible);
  const logM = useLogSummaryListen(clientId);
  const voice = useSummaryVoice();                      // the Sarvam recording with the device-voice fallback
  const row = q.data ?? null;
  const gate = listenGate(row, uid);
  const [atOpen, setAtOpen] = React.useState<ListenGate | null>(null);   // what was due when the popup opened
  React.useEffect(() => { if (!visible) { setAtOpen(null); return; } if (!atOpen && row) setAtOpen(gate); }, [visible, row, atOpen]);
  const gateNow = atOpen ?? gate;
  const [heard, setHeard] = React.useState<HeardMap>({ weekly: false, context: false });
  const [transcript, setTranscript] = React.useState<Which | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  React.useEffect(() => { if (visible) { setHeard({ weekly: false, context: false }); setTranscript(null); setErr(null); } else voice.stop(); }, [visible]);
  const allDone = listenAllHeard(gateNow, heard);
  const play = (which: Which) => {
    const s = summaryOf(row, which);
    if (!s?.script || !clientId) return;
    if (voice.speakingId === which) { tapActive(voice); return; }          // pause / resume / stop of the playing one
    setErr(null);
    logM.mutate(which, { onError: (e) => setErr((e as Error).message) });  // record first
    voice.play(which, { clientId, which, script: s.script }, {
      onDone: () => setHeard((h) => ({ ...h, [which]: true })),            // heard to the END
      onError: (m) => {                                                     // nothing could speak: the transcript stands in
        setTranscript(which);
        setHeard((h) => ({ ...h, [which]: true }));
        setErr(`Neither the recording nor this device could speak (${m}). Read the transcript instead.`);
      },
    });
  };
  const finish = () => { voice.stop(); onContinue(); };
  ...
}
```
Layout (Android, dark):
- `Modal` transparent, slide, `onRequestClose={() => {}}` (back does nothing); a dark backdrop that is NOT pressable.
- Sheet `#0E0A09`, top radius 26, max height 92 %, bottom padding = safe area + 18.
- Header: a red round headphones icon (40 px), title **"Listen before you log"**, sub line:
  `LISTEN_WHY + " This week's training changes every day; the health context changes when a new report arrives. Hear each one to the end, then tap Proceed to workout."`
- Body (scrolls): "Loading summaries…" with a spinner while loading; else two rows, 01 This week's training and
  02 Health context, each the normal summary row (Play / Pause / Stop, title, duration, transcript toggle, last
  listened by) plus:
  - a status chip: `none` "Nothing to hear yet" (muted); heard in this popup "Heard just now" (green); `done`
    "Heard today" (weekly) or "Up to date" (context) (green); due weekly "Due today" (red); due context
    "New report · 29 Oct, 1:07 am" (red, the build stamp) or "Not heard yet";
  - the rule line `listenRuleLine(which, gateNow[which], clientName)` in a box, red while due and not yet heard
    in this popup, green otherwise.
- Under the rows: the voice notice when the device voice stood in (gold), the error line (red), and the footnote
  "Every play is recorded with your name and the time. Red items must be heard to the end, then tap Proceed to workout."
- Footer: one full-width button, green gradient **"Proceed to workout"** when `allDone`, else a dim brown
  **"Listen first"**, disabled, opacity 0.45, `hitSlop` 10.
- On close (`visible` false) the voice stops.

### 5.5 Voice requirements the popup relies on
- `onDone` must fire only at the **end of the last part** of the recording (or at the end of the device voice when it
  stood in), never on Play. A Stop or Pause before the end must not count.
- One sound at a time: Play on one row stops the other.
- Play the recording with `playsInSilentMode: true` (iOS silent switch); if nothing can speak, `onError` opens the
  transcript, which counts as heard.

## 6. Edge cases (Android behaviour; keep identical)

| Case | Result |
|---|---|
| Opened from the client page or a plan (no roster slot) | no popup |
| Offline | no popup (the listen could not be recorded); the log proceeds |
| Editing a queued log | no popup |
| No summary built for the client | `none` for both, no popup |
| Only the long one is due (short heard earlier today) | popup with the short row green "Heard today", Proceed needs only the long one |
| Trainer heard both on the roster strip before opening the form | nothing due, no popup |
| Trainer presses Play on the strip and stops after 2 s, then opens the form | the trail already has the listen, so no popup. Known gap since 22 Oct: "heard to the end" is enforced only inside the popup |
| Second Play while the first finished | the popup stays up (`armed`), the second plays to the end, then Proceed |
| Recording fails (Sarvam down, offline mid-way) | the device voice reads it with a notice; its end counts |
| Nothing can speak at all | the transcript opens and counts as heard, with the red error line |
| Proceed tapped, then the trainer goes back and opens the same form again | a new form instance: the rule is checked again from the trail (now done, so no popup) |
| Client switched in the form (couple second leg) | the gate resets for the new client; it shows only when that leg is roster-opened and due |

## 7. Tests
- Copy `tests/rules/health_summary_rules_test.js` (Android, 58 checks) and point `ROOT` at the iOS repo. The gate
  cases cover: no listen, listen before the build, weekly heard yesterday (due) or today (done), the nightly-build
  boundary at 18:29Z / 18:31Z, context heard on an earlier day (done, carried), `listenSheetUp` with armed / done,
  `listenAllHeard` with the state at open, and the button copy.
- `npx tsc --noEmit` exit 0.

## 8. Check on the iPhone
1. As a trainer, pick a roster client whose summaries you have not heard today. Today's Roster → Log Workout: the
   popup opens before the health check-in; Proceed reads "Listen first" and is disabled; Submit's hint reads
   "Listen to the client's summaries first".
2. Swipe down, tap the dark area, use the back gesture: nothing closes it.
3. Play This week's training and stop it half way: its rule stays red, Proceed stays disabled. Play it to the end:
   "Heard just now", green rule.
4. Play Health context; while it plays, the first row does not turn back to red and the popup stays up. At the end:
   Proceed turns green. Tap it: the health check-in opens next.
5. Leave and open Log Workout for the same client again: no popup (both heard).
6. Next morning, the same client: only This week's training is due; Health context shows "Up to date".
7. Airplane mode, then Log Workout from the roster: no popup.
8. In SQL, each Play added an entry:
   `select jsonb_array_length(listen_history), listen_history->-1 from client_health_summary where client_id = '<client>' order by briefing_date desc limit 1;`
