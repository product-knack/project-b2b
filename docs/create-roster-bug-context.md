# Create Roster — "0 sessions created" bug: full end-to-end context

> **UPDATE (Aug 18): there are TWO independent causes of the silent zero, both now
> fixed on Android.** §1–§8 below cover Cause A (Hermes date-parse, Replicate tab).
> **Cause B** (§9, added later): the candidate loop silently skipped slots whose
> time had already passed today — a CRM creating a 5:00 PM slot at 5:33 PM got
> "0 sessions created" with no explanation, on ANY tab, on every platform,
> since launch. iOS must apply BOTH fixes.

The complete record of the bug found and fixed on Android (Aug 13, shipped in native
4.0 (23)). Written to be pasted anywhere — includes the investigation, root cause, exact
fix, and current status per platform.

## 1. Symptom
CRM dashboard → **Create Monthly Roster** → run. The result sheet shows:
- **"0 sessions created"**
- NO "skipped slots" conflict list
- NO error alert
- Nothing inserted into `session_schedule`

First reported for client Vashist Dev; later the same signature appeared for CRM Deepak
Panu on the **iOS** app (only that CRM seemed affected — see §6 for why it looks
account-specific when it is not).

## 2. How Create Roster works (both tabs share one mutation)
`useBulkCreateRoster` (native `src/lib/rosterQueries.ts`, mirrors the web
BulkSessionCreator):
1. Build candidate slots: for every day from start date through `weeks × 7` days, look up
   the day-of-week in a `Map` keyed by the schedule's `day` (0=Sun…6=Sat, matching
   `Date.getDay()`), at that day's `HH:mm` time. Past slots are skipped.
2. Per candidate: skip if the trainer is on leave (conflict listed), skip on trainer clash
   ±60 min (conflict listed; force-able), hard-skip on client clash ±60 min (conflict
   listed).
3. Insert the surviving rows into `session_schedule`; on unique-violation retry per-row.
4. Return `{ created, conflicts }` — the result sheet renders both.

Two entry tabs feed it:
- **Create New**: trainer/modality/weeks + day-time chips picked by hand.
- **Replicate Roster**: `useInferRoster` derives the client's weekly pattern (weekday +
  time + usual trainer/modality) from their last 28 days of `session_schedule` rows, and
  feeds those as the schedules.

## 3. Root cause — Hermes cannot parse `toLocaleString()` output
`useInferRoster` converted each session timestamp to IST like this:

```ts
const d = new Date(r.scheduled_datetime);
const ist = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));  // ← BUG
const day = ist.getDay();
const time = `${String(ist.getHours()).padStart(2, '0')}:${String(ist.getMinutes()).padStart(2, '0')}`;
```

On **Hermes** — the JS engine of the React Native app on BOTH Android and iOS —
`new Date("8/13/2026, 2:00:00 PM")` returns **`Invalid Date`**. Consequences, in order:
- `ist.getDay()` → `NaN`; time string → `'NaN:NaN'` — every inferred slot is corrupted.
- The bulk-create keys its weekday map by that `NaN` day. `date.getDay()` during candidate
  generation only ever returns 0–6, which never equals `NaN` → **zero candidate slots**.
- Zero candidates ⇒ zero inserts AND zero conflicts ⇒ the perfectly silent
  "0 sessions created" screen. No code path errors.

**Scope:** only the **Replicate** tab is affected (Create New builds its schedules from UI
chips with sound day indices, verified 0=Sun…6=Sat). Everything else was checked and
cleared: weeks stepper clamped 1–8, 24h times, RLS inserts work for CRMs (live-tested),
no DB trigger suppression, conflict rendering correct.

## 4. Why this bug evaded every off-device test
- V8 and JSC (Chrome, Safari, Node) parse `"8/13/2026, 2:00:00 PM"` fine — so the web app
  is unaffected and every Node-based probe/test of the same logic passes.
- It only reproduces under Hermes, i.e. on-device in the RN app.
- The failure is silent by construction: no exception, no rejected promise, no RLS error —
  the loop simply matches nothing.
- Live-DB checks reinforced the confusion: inserts as the CRM worked, the client's data
  was clean, and existing rosters (created earlier via web) looked normal.

## 5. The fix (shipped on Android, native 4.0 (23), Aug 13)
Replace the unparseable round-trip with `Intl.DateTimeFormat.formatToParts`:

```ts
const istFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Kolkata', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const parts = istFmt.formatToParts(new Date(r.scheduled_datetime));
const part = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
const day = DOW[part('weekday')] ?? 0;                       // 0=Sun … 6=Sat
const time = `${part('hour').padStart(2, '0')}:${part('minute').padStart(2, '0')}`;
```
- `hourCycle: 'h23'` is required: without it midnight can format as `'24'` and break the
  `HH:mm` contract (verified: midnight → `00`).
- Verified against real data: `2026-08-18T08:30:00Z` → day 2 (Tuesday), `14:00` IST.

**This is a crash CLASS, not one bug.** Audit any codebase with:
```bash
grep -rnE "new Date\([^)]*toLocaleString" src
```
Every hit is broken under Hermes. The Android app had exactly one live instance (this one)
after an earlier QHP-stats fix of the same class.

## 6. Why it masquerades as "only one CRM can't create rosters"
The bug is flow-specific, not account-specific. A CRM whose book already has long-running
rosters is exactly the CRM who uses **Replicate** — others use **Create New** and never
hit it. Investigated for CRM Deepak Panu (`66829d61-b183-4f50-8085-ba13ee312c8b`):
profile/role/book/picker all normal, 489 `session_schedule` rows created for his clients
in 21 days — the account is clean; the flow he uses is the broken one.

## 7. Expected behavior AFTER the fix (for verification)
1. Replicate for a client with an existing pattern (test client **Vashist Dev**: Tue/Thu
   14:00 IST, trainer Sagar) infers real slots — days/times shown, not blank/NaN.
2. Replicating onto dates that already hold sessions lists **visible** "skipped — client
   already has a session" conflicts. A silent 0 is impossible: every skip path records a
   conflict.
3. Replicating onto clean future dates creates `days × weeks` sessions and reports the
   count.
4. Create New continues to work unchanged.

## 8. Platform status
- **Android**: fixed in native 4.0 (23) (all Aug-13 builds). Builds ≤ 4.0 (22) still
  contain the bug.
- **Web**: never affected (V8/JSC).
- **iOS**: NOT yet fixed — the iOS RN app also runs Hermes, so if its Replicate/infer code
  was ported from the same source it fails identically. The iOS fix instructions live in
  `docs/ios-roster-and-yoga-plan-fixes.md` (Bug 1) and are exactly §5 above plus the §5
  codebase grep.

## 9. Cause B — the SILENT past-slot skip (any tab, since launch)
The candidate loop dropped any slot whose datetime had already passed, with a bare
`continue` and NO conflict entry — the only invisible skip in the flow:

```ts
if (at < new Date()) continue; // skip already-past slots  ← silent
```

Repro: a CRM creates a same-day roster after the chosen time has passed (5:00 PM slot at
5:33 PM). With a 1-week window, or when the selected days' times are earlier in the day,
EVERY candidate can be past → "0 sessions created", zero conflicts, no error. Present
since the app's initial commit (2026-07-21) — afternoon same-day rosters have hit
unexplained zeros the whole time, on every platform including web-ported logic.

### The fix (Android, Aug 18)
Split at the trainer's 2-hour log window (POST_WINDOW_MS = 2h):
- Slot past its time but **within 2h** (5:20 PM for a 5:00 PM slot) → **CREATE it**.
  The trainer can still log it normally; the late-log rule cannot fire off slot dates
  (it compares the log's own timestamps), and the ≥3h missing-session alert cannot
  trigger prematurely (the slot is at most 2h past at creation).
- Slot **older than 2h** → skip, but push a VISIBLE conflict with the actual time:
  `"Fri 05 Sep · 5:00 pm has already passed — pick a later start date"` (kind: 'past').
- The defensive duplicate-slot dedupe also records a conflict now. Invariant after the
  fix: **created + conflicts ≥ 1 whenever the mutation runs — a silent "0 created, 0
  conflicts" result is unreachable.**

iOS: apply the same split + visible-skip; also audit for the nastier variant of
filtering past slots BEFORE expanding the weeks (which would wipe all weeks of that
weekday, zeroing even multi-week rosters).
