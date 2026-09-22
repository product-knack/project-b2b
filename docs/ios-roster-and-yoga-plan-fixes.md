# iOS handoff — two bugs: (1) Replicate Roster "0 sessions created", (2) Yoga/Boxing approved plan not showing

Paste this whole doc to the iOS app's coding assistant. Both fixes are shipped and verified
on Android (native 4.0 (23)). Both are RELEVANT to iOS: the iOS React Native app also runs
Hermes (bug 1 is a Hermes-specific crash class), and bug 2 is a port gap, not a data issue.

---

# Bug 1 — CRM "Create Monthly Roster" → Replicate tab shows "0 sessions created"

## Symptom
CRM dashboard → Create Monthly Roster → **Replicate Roster** → run. Result screen shows
**"0 sessions created"** with NO skipped-slot conflicts listed. No error alert. Nothing is
inserted in `session_schedule`. The **Create New** tab works fine.

## Root cause — Hermes cannot parse `toLocaleString()` output
The roster-pattern inference (derive the client's weekly slots from their last 28 days of
sessions) converted timestamps to IST like this:

```ts
const d = new Date(r.scheduled_datetime);
const ist = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));  // ← BUG
const day = ist.getDay();
const time = `${String(ist.getHours()).padStart(2, '0')}:${String(ist.getMinutes()).padStart(2, '0')}`;
```

On **Hermes** (the RN JS engine on BOTH Android and iOS), `new Date("8/13/2026, 2:00:00 PM")`
is **`Invalid Date`**. So every inferred slot became `day: NaN, time: 'NaN:NaN'`. The
bulk-create mutation then keys its weekday map by that `NaN` day — and `date.getDay()`
(always 0–6) never matches `NaN` — so **zero candidate slots** are generated: 0 created,
0 conflicts, no error. Perfectly silent.

Why it's sneaky: V8/JSC (Chrome, Safari, Node, the web app) parse that string fine, so the
bug only reproduces on-device under Hermes. Unit tests in Node will pass while the app fails.

## The fix — IST parts via `Intl.DateTimeFormat`, never `new Date(toLocaleString(...))`
```ts
const istFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Kolkata', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const parts = istFmt.formatToParts(new Date(r.scheduled_datetime));
const part = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
const day = DOW[part('weekday')] ?? 0;                                  // 0=Sun … 6=Sat
const time = `${part('hour').padStart(2, '0')}:${part('minute').padStart(2, '0')}`;
```
Notes:
- `hourCycle: 'h23'` matters — without it midnight can format as `'24'` and break `HH:mm`.
- Keep day numbering 0=Sunday…6=Saturday so it matches `Date.getDay()` in the bulk-create.

## Audit the whole iOS codebase (this is a crash CLASS, not one bug)
```bash
grep -rnE "new Date\([^)]*toLocaleString" src
```
Every hit is broken on Hermes. Replace each with `Intl.DateTimeFormat`/`formatToParts`
(or compute from UTC fields). On Android only one live instance existed (this one) after
an earlier QHP-stats fix of the same class.

## Verify
1. Pick a client with an existing weekly roster (test client **Vashist Dev** has Tue/Thu
   14:00 IST). Replicate must now infer the real slots — day/time shown correctly, not blank.
2. Replicating over dates that already have sessions must list **"skipped — client already
   has a session"** conflicts (visible list), NOT a silent 0.
3. Replicating onto clean future dates creates `days × weeks` sessions and says so.
4. Sanity: `2026-08-18T08:30:00Z` must map to day 2 (Tuesday), time `14:00`.

---

# Bug 2 — Log Workout: approved plan not showing for Yoga (Boxing identical)

## Symptom
Trainer logs a workout and selects **Yoga**: the client's valid approved yoga plan never
appears — no plan content loads (the modality chip may even show the ✓ "has plan" marker).
Same for **Boxing**. Strength/Pilates show their plan via the body-part selector fine.

## Root cause — activity modalities have NO plan display path
This is NOT a data or lookup bug. Verified live: yoga plan rows are stored correctly
(`workout_plan_exercises.modality = 'Yoga'`, one row per activity, `body_part =
'Yoga Activities'`, names like 'Cat and cow'), the approved-plans hook returns them, the ✓
indicator and the 4-workout plan gate both see them.

The gap is in the form UI. A plan surfaces in exactly two ways:
1. The **body-part strip** (tap a body part → load exercises with targets) — deliberately
   HIDDEN for activity modalities (`!isActivityModality`), because yoga/boxing log as
   mark-as-completed activity checklists, not body-part sets.
2. An **aerobics-only auto-populate** effect.

Yoga and Boxing had neither → a ✓-marked plan showed nothing.

## The fix (exact Android reference — mirror it)
### 2a. Auto-populate activity modalities from the approved plan
Runs when Yoga/Boxing is selected and the form is empty; loads the plan's activities as an
**unchecked** checklist (trainer marks what was done). Dedupes names; Boxing "Padwork"
keeps its 1-round default.
```ts
const activityPopulatedRef = React.useRef<string | null>(null);
React.useEffect(() => {
  if (!isActivityModality || !currentPlan) return;          // yoga or boxing only
  const key = `${mLower}:${currentPlan.plan_id}`;
  if (activityPopulatedRef.current === key) return;         // once per modality+plan
  activityPopulatedRef.current = key;
  setExercises((xs) => {
    if (xs.length) return xs;                               // never clobber manual entries
    const seen = new Set<string>();
    const acts = currentPlan.exercises.filter((ex) => {
      const n = ex.exercise_name.trim().toLowerCase();
      if (!n || seen.has(n)) return false;
      seen.add(n);
      return true;
    });
    return acts.map((ex) => ({
      name: ex.exercise_name,
      measurement: 'reps' as const,
      body_part: ex.body_part ?? undefined,
      notes: '',
      collapsed: true,
      completed: false,                                     // UNCHECKED — trainer ticks what was done
      activityType: 'Constant' as const,
      rounds: isBoxingModality && /pad ?work/i.test(ex.exercise_name) ? '1' : '',
      durationMin: '',
      sets: [{ reps: '', load: '', duration: '' }],
    }));
  });
}, [isActivityModality, mLower, currentPlan]);
```

### 2b. Re-arm the populate effects on modality switch (latent bug, fix together)
Switching yoga → strength → yoga left an EMPTY form, because the populate guard stayed set
while the modality-switch effect cleared the exercise list. This also affected aerobics.
In the effect that clears the list on modality change, also reset the refs:
```ts
React.useEffect(() => {
  if (prevModalityRef.current !== modality) {
    prevModalityRef.current = modality;
    setExercises([]);
    aerobicsPopulatedRef.current = null;   // existing aerobics populate ref
    activityPopulatedRef.current = null;   // the new yoga/boxing ref
  }
}, [modality]);
```
Also reset both refs wherever the form hands off to a second client (training-partner /
couple flow), next to the existing aerobics ref reset.

## Every-modality audit (Android results — replicate the checks on iOS)
| Modality | Plan surfaces via | Status |
|---|---|---|
| Strength | body-part strip → tap loads targets | OK (44k approved rows, 0 null body_part) |
| Pilates | body-part strip | OK |
| Custom | body-part strip (chip only when a Custom plan exists) | OK |
| Aerobics | auto-populate (duration sets, minutes) | OK |
| **Yoga** | none → **add activity-checklist auto-populate** | FIX |
| **Boxing** | none → **same** | FIX |
| Aqua Aerobics | fixed built-in exercise list by design | OK |

## Verify
1. Client with a valid approved **Yoga** plan → select Yoga in the log form → the plan's
   activities appear as an unchecked list; ✓ stays on the chip; submit works (activity rows).
2. Same for **Boxing** (Padwork prefills 1 round).
3. Switch Yoga → Strength → Yoga: the checklist reloads (not an empty form). Repeat for
   Aerobics (regression check for the re-arm fix).
4. Manually added activities are never overwritten by the auto-populate.
5. Strength/Pilates body-part flow unchanged.
