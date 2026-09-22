# iOS handoff — everything changed between Android 4.5 (25) and 4.6 (26)

Paste this whole doc to the iOS app's coding assistant. Three changes, all shipped and
verified on Android 4.6 (26). (The Yoga plan builder rebuild went into 4.5 (25) and has
its own doc: `ios-yoga-plan-builder-fix.md` — apply that separately if not done yet.)

---

# Change 1 — Ops dashboard: Client Threads was missing entirely

## Symptom
An ops-role user has NO way to reach Client Threads: no sidebar entry, no unread banner on
the ops dashboard. Ops was the only staff role without it (trainer, CRM, coach, admin,
doctor, academy all have the entry).

## Root cause
Pure omission: the ops navigation config never got the Client Threads item, and the ops
home screen never mounted the unread banner. The feature itself already works for ops
accounts — the Ops Head is a standing member of every client thread, and the thread list
already gives standing members the real-threads view.

## Fix (mirror on iOS)
1. Add to the ops sidebar/nav, in the Workspace group right after Messenger:
   `{ label: 'Client Threads', icon: <atSign>, route: 'client-threads' }` — same item every
   other role uses.
2. Mount the shared Client Threads unread banner at the top of the ops dashboard (same
   component the coach/doctor/academy homes use). It self-hides at 0 unread and deep-links
   to the threads list — one line, no props.
No backend work: the route/screen is role-agnostic, RLS governs access (Ops Head sees all
real threads; a regular ops user without client assignments sees the empty state), and the
screen should already be in the sensitive/replay-shield route list.

## Verify
Sign in as the Ops Head → sidebar shows Client Threads; the banner appears on the ops home
when any thread has unread messages; tapping either lands on the threads list.

---

# Change 2 — Plan expiry: the Plan tab used 45 days, everything else uses 42

## Symptom
A client's workout plan showed **Expired on web but Active in the native app** (real case:
client `0da303d9-f48b-449c-9589-aa0504de9f68`, Strength plan approved Jul 7 — web flipped
to Expired on Aug 18, native said Active until Aug 21).

## Root cause
The plan-validity rule everywhere is **42 days from `approved_at`** (timestamp-exact:
`expiry = approved_at + 42 × 24h`). Web, the roster expiry strip, the log-form plan
availability, and the plan gate all use 42 — but the client-detail **Plan tab's** hook
computed `expired` with a stray literal **45** (a leftover from an old, wrong architecture
doc). Result: a 3-day window on every plan where the Plan tab says Active while everything
else says Expired.

## Fix (mirror on iOS)
- Search the iOS codebase for plan-expiry math using **45** days — any
  `approved_at + 45d` (or `45 * 86400`, `45 * 24h`) in plan status logic is the same bug.
- Replace with the shared 42-day constant. Best practice from the Android fix: export ONE
  `PLAN_VALID_DAYS = 42` constant and use it in every consumer (Plan tab status, roster
  strip, log-form availability, gate) so the surfaces can never drift again.
- Careful not to touch QHP logic while sweeping: the QHP validity really is 45 days —
  only PLAN math must be 42.

## Verify
For the test client above: Plan tab shows the Strength plan as Expired (chip + red/gold
state), matching web. Boundary check: a plan approved exactly 42×24h ago is Expired; at
41d23h it is Active.

---

# Change 3 — Plan cards: show Created and Expires dates

## What was added
On trainer → client detail → Plan tab, every plan card now carries a small dates line
under the name/meta:
- Approved plans: `Created 7 Jul · Expires 18 Aug` — once past the boundary it reads
  **`Expired 18 Aug`** and the line renders in the warning color (matching the Expired
  status chip).
- Non-approved plans (pending review / needs revision / rejected):
  `Created 7 Jul · Expires 42d after approval` (no expiry exists until approval).

## Implementation notes
- `Created` = the plan's `created_at` (row creation), formatted as a short IST day label
  ("7 Jul").
- `Expires` = `approved_at + PLAN_VALID_DAYS (42) × 24h` — computed from the SAME shared
  constant as Change 2, never a second literal.
- Muted/small typography; warning color only when expired.

## Verify
An active plan shows both dates; an expired one shows "Expired <date>" in the warning
color; a pending plan shows the "42d after approval" placeholder. Dates match what the web
shows for the same plan.
