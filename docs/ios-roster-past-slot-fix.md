# iOS handoff — Create Roster: silent past-slot skip ("0 sessions created" cause B)

Paste this whole doc to the iOS app's coding assistant. This is the SECOND independent
cause of the silent "0 sessions created" result in Create Monthly Roster — separate from
the Hermes `toLocaleString` Replicate bug (cause A, already handed off). Both fixes are
shipped and verified on Android; iOS needs BOTH.

## 1. Symptom
A CRM creates a roster where a chosen slot time has ALREADY passed today — e.g. builds a
5:00 PM roster at 5:33 PM. Result: **"0 sessions created"**, no skipped-slots list, no
error. Affects ANY tab (Create New included), any platform that ported this loop. On
Android this existed **since launch** — same-day afternoon rosters have hit unexplained
zeros the whole time.

## 2. Root cause
In the bulk-create candidate loop, slots whose datetime is already past are dropped with
a bare `continue` and NO conflict entry:

```ts
const at = new Date(d); at.setHours(hh, mm, 0, 0);
if (at < new Date()) continue;   // skip already-past slots  ← SILENT
```

Every other skip in the flow (trainer on leave, trainer clash, client clash) records a
visible "skipped slot" row — this one records nothing. When every candidate is past
(same-day roster with a 1-week window, or all selected times earlier in the day), the
result sheet shows a bare zero with no explanation.

## 3. Required behavior — split at the trainer's 2-hour log window
The trainer log window is scheduled −1h … +2h. Use the +2h edge as the boundary:

1. **Slot past its time but within 2h** (the 5:20 PM for a 5:00 PM case) → **CREATE it.**
   The trainer can still see and log it normally on Today's Roster. This is the "CRM
   formalizes the session that just happened" case and must work.
2. **Slot older than 2h** → **skip, but VISIBLY**: push a conflict entry with the ACTUAL
   formatted slot time, not a generic message:
   `"Fri 05 Sep · 5:00 pm has already passed — pick a later start date"`
   Give it its own kind (e.g. `'past'`) so it renders in the existing skipped-slots list.

### Android reference (shipped)
```ts
const LOG_POST_WINDOW_MS = 2 * 60 * 60 * 1000; // = trainer log window close (+2h)
for (let d = new Date(start); d <= end; d = new Date(d.getTime() + 864e5)) {
  const sched = byDow.get(d.getDay());
  if (!sched) continue; // day not selected — not a slot, nothing to report
  const [hh, mm] = sched.time.split(':').map(Number);
  const at = new Date(d); at.setHours(hh, mm, 0, 0);
  if (at.getTime() < Date.now() - LOG_POST_WINDOW_MS) {
    conflicts.push({ kind: 'past', when: at.toISOString(), detail: `${fmt(at)} has already passed — pick a later start date` });
    continue;
  }
  candidates.push({ at, sched });
}
```
(`fmt` = the existing IST weekday + date + 12h-time formatter used for the other
conflict messages. `conflicts` must be declared BEFORE this loop.)

## 4. The core rule + audit (do this, not just the one fix)
**No skip in the bulk-create flow may be silent.** Audit every `continue` / early return
that drops a slot:
- day-not-selected `continue` is fine (it is not a slot).
- past-slot skip → fix per §3.
- any dedupe guard (same client + datetime) → record a conflict too (Android found one,
  practically unreachable, made visible anyway).
- leave / trainer-clash / client-clash skips should already record conflicts — verify.
- insert failures must either throw a visible error or record per-row conflicts.

**Also audit for the nastier iOS-specific variant:** if the iOS code generates the FIRST
week's slots, filters out past ones, and THEN expands to N weeks, a past 5:00 PM today
wipes that weekday from ALL weeks — zeroing even 4-week rosters. If found, restructure to
per-occurrence past checks like the reference above.

**Target invariant after the fix: whenever the mutation runs, `created + conflicts ≥ 1`.**
A "0 sessions created" screen with an empty skipped list must be unreachable.

## 5. Downstream concerns — verified NON-issues (don't "fix" these)
- **Late-log rule (±2h):** compares the workout log's own `created_at` vs its own
  `scheduled_at` on `training_sessions`. `session_schedule` never enters the predicate —
  a slot created past its time CANNOT flag the trainer late.
- **Missing-session alert (≥3h past, unlogged):** a slot created inside the 2h window is
  at most 2h past at creation, so it cannot appear in the alert prematurely; it enters
  only if it reaches 3h still unlogged, same as any normal slot.
- Known edge, accepted: a slot created near the 2h boundary leaves the trainer only
  minutes of log window; the alternative (dropping it silently) is worse.

## 6. Verify
1. Create a roster containing today's weekday with a time 10–30 min in the past →
   that slot IS created; the trainer sees it on Today's Roster as "Ready to log" and can
   log it.
2. Create a roster where a selected time is 3+ hours past → result shows the slot in the
   skipped list with the "<day · time> has already passed — pick a later start date"
   message; later-week occurrences of that weekday still create.
3. 1-week window + only today's weekday + past time → NOT a bare zero: the skipped list
   explains it.
4. Confirm there is NO input combination that produces "0 sessions created" with an
   empty skipped list.
