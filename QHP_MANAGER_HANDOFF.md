# QHP Manager Dashboard — End-to-End Handoff

> Context doc for continuing the QHP Manager dashboard in **odds-app** (React Native / Expo SDK 57, TypeScript, TanStack Query + Supabase anon key).
> Web reference app: `C:\Users\ADMIN\Desktop\b2b 12 july\oddsfitness-hub-track-main` (fallback: `C:\Users\ADMIN\Desktop\hybrid-b2b\oddsfitness-hub-track-main`).
> Goal: replicate the web QHP Manager page **exactly** (backend contracts + card fields), gated so only a QHP Manager sees it.

---

## 0. Ground rules (do not break)

- **Anon key only.** Never put `service_role` in the app. The user runs all DDL/SQL by hand in the Supabase SQL editor.
- Client-role accounts must never access this staff app.
- Keep `npx tsc --noEmit` (or `node node_modules/typescript/bin/tsc --noEmit`) at **0 errors**.
- **Read the web app before changing logic.** Match backend contracts (columns, RPC names, insert shapes) exactly — approximations have caused rework.
- UI theme: obsidian `#080606` / ember `#F47A2A`, Geogrotesque fonts. Reuse existing primitives (`Card`, `Badge`, `Icon`, `GradientButton`, `Page`, `TitleBlock`, colors `C.*`, fonts `F.*`, `hexA()`).

**Supabase**: URL `https://agtjszjedaenclbzgjvi.supabase.co`, anon key in `.env` (`EXPO_PUBLIC_SUPABASE_ANON_KEY`).
**Test creds**: CRM `crm@oddsfitness.com` / `Ritu@odds11` (Ritu, CRM), Trainer `divya@oddsfitness.com` / `Divya@odds` (Divya, trainer).
⚠️ **Neither test account is the QHP Manager.** The only QHP Manager is **Raj Thakur**. `get_qhp_booked_client_ids` gates internally and returns **0 rows** for non-managers, so the Task Pending list only populates when logged in as Raj. Ask the user for Raj's login to see live Task Pending data.

---

## 1. Role gating — who sees this page

In the web, "trainer" is a single role with **boolean capability flags** layered on top of the `profiles` table (NOT a separate role column). The QHP Manager gate is:

```
profiles.can_schedule_assessments_for_others === true   →  QHP Manager
```

Other relevant flags: `can_conduct_assessments` (Assessor), `can_view_all_assessments`, `can_view_all_trainers`, `workout_analysist` (DB column typo = Workout Analyst).

**File: `src/lib/capabilities.ts`** — `useMyCapabilities()` returns
`{ data: { isQhpManager, canConductAssessments, canViewAllAssessments, canViewAllTrainers, workoutAnalyst }, isLoading }`.
`isQhpManager = data?.can_schedule_assessments_for_others === true`. Always returns a non-null `data` (EMPTY fallback), so it's safe to read `caps.data.isQhpManager` during load.

**Drawer gating** lives in `src/components/chrome.tsx` (`routeVisible(r)`): `qhp-manager` / `qhp-stats` require `isQhpManager`; `qhp` requires `isQhpManager || canConductAssessments || canViewAllAssessments`. Empty groups are hidden.

The `QhpManager` screen itself also guards: if `!isMgr`, it renders a "This area is for QHP Managers only." panel.

---

## 2. Backend data model (live Supabase — verified)

### Tables / columns actually used

**`coach_assessment`** (the central QHP table; the assessor is `coach_id`):
- `id`, `client_id`, `client_name`, `coach_id`, `scheduled_by`
- `assessment_date` (DATE `YYYY-MM-DD`), `assessment_time` (TIME `HH:MM:SS`), `location`, `notes`
- `assessment_scheduled` (bool)
- `completed` — **TIMESTAMP, not boolean.** "completed" for the manager list = `completed != null`.
- QHP data columns (a QHP is *filled/done* when ANY is a non-empty object):
  `new_client_assessment_data`, `existing_client_assessment_data`, `qhp_data`
- `qhp_manager` — the QHP Manager's sign-off on a completed QHP: `'approved'` | `'not_approved'` | null (single stage; NOT the Junior→Senior→HOD flow).
- `sla_deadline_at` (TIMESTAMP) — used only for the Manager-tab "overdue" flag.
- `reschedule_status` — `'pending'` | `'approved'` | `'rejected'` | null.
- `reschedule_data` (JSONB) — shape `{ remark, requested_at, proposed_date, proposed_time }`.
- `ai_biomechanical`, `qhp_assessor_connected`, `qhp_assessor_connected_at`, `updated_at`, `created_at`.

**`clients`**: `id`, `first_name`, `last_name`, `phone`, `status` (`'active'`/null/…), `created_at`, `subscription_type`.

**`qhp_schedule`** (scheduling *requests* pending manager action): `id`, `client_id`, `date`, `time`, `address`, `status` (`'pending'`…).

**`qhp_details`**: the generated report (Junior→Senior→HOD review flow — a *different* role; not the QHP Manager's job). `coach_assessment_id` links back.

**`leads`**: stage `'QHP Booked'`, `qhp_hold`, etc. Reached via RPCs below (not queried directly for Task Pending).

### RPCs (verified to exist & shapes)

- **`get_qhp_booked_client_ids()`** → rows containing `client_id` (leads at stage `'QHP Booked'`). **Internally gated** to QHP managers → 0 rows for others.
- **`get_qhp_holds()`** → rows: `lead_id, client_id, client_name, phone, reason, resolving_at, held_at, held_by, held_by_name, is_overdue, replies, replies_count, last_reply_at`.
- **`set_lead_qhp_hold(_client_id, _reason, _resolving_at)`** → puts a client's QHP on hold.

---

## 3. Task Pending logic — CLIENT-CENTRIC (this is the important part)

The web Task Pending is **NOT** built from `coach_assessment.assessment_scheduled`. It is built from **booked leads → clients → assessments**. Exact algorithm (implemented in `useQhpManager`):

1. `get_qhp_booked_client_ids()` → dedupe `client_id`s.
2. `clients` where `id in (those)` AND `status active or null` (`.or('status.eq.active,status.is.null')`) AND `created_at >= '2026-03-04T00:00:00+00:00'` (hard cutoff, matches web).
3. `coach_assessment` where `client_id in (those clients)`, selecting the 3 data columns + `assessment_date/time`.
4. **Drop** any client whose assessment data is filled (non-empty on any of the 3 data cols) — that QHP is *completed*, not pending.
5. Bucket the remaining clients:
   - **Scheduled** = a `coach_assessment` row exists (data still empty) → `hasQHP`.
   - **On Hold** = no row + present in `get_qhp_holds()`.
   - **Not Scheduled** = no row + not on hold.
6. **Task Pending badge count** = total remaining pending clients (NotScheduled + Scheduled + OnHold).

### SLA — recomputed client-side (do NOT use `sla_deadline_at` for Task Pending)

`computeQhpSlaDeadline(clients.created_at)` = **3 working hours within 07:00–22:00 IST** from the client's `created_at`. Then `formatSlaRemaining(deadline)` → `{ text, level: red|amber|green, overdue }` (overdue → "Overdue by Xh Ym"; ≤30m → amber; else green "Xh Ym left"). Also `formatWaiting(fromIso)` and `waitUrgency(fromIso)` (green ≤2h / amber ≤4h "⏳ Approaching delay…" / red >4h "⚠️ Delayed — this is slowing down the onboarding process"). All exported from `qhpManagerQueries.ts`.

### Card fields (per web)
- **Joined** = `clients.created_at`.
- **Not Scheduled**: SLA badge + "SLA BREACHED" note when overdue, Waiting duration w/ urgency, phone. Actions: **Schedule QHP**, **Hold**.
- **Scheduled**: "QHP {assessment_date}", **Upcoming** (assessment in future) vs **Delayed** warning (>4h past). Action: **Reschedule QHP** + copy.
- **On Hold**: hold reason + Overdue badge.

---

## 4. Other tabs

- **Manager** (all QHPs across trainers): `coach_assessment` limit 3000, assessor names from `profiles`. Counts: scheduled / completed (`completed != null`) / overdue (`!completed && sla_deadline_at < now`) / total.
- **Requests**: `qhp_schedule` where `status='pending'` → client names joined from `clients`. **Currently read-only** — web's Approve inserts a `coach_assessment` (TODO).
- **QHP Review**: completed QHPs where `qhp_manager` is null → Approve / Not approve (single stage). Counts: pending / approvedCount / notApprovedCount.
- **Reschedule** (sub-tab under Task Pending + the orange banner): `coach_assessment` where `reschedule_status='pending'`; shows Current → Proposed + REMARK; Approve/Reject.

---

## 5. Mutations (all in `src/lib/qhpManagerQueries.ts` unless noted)

| Hook | Action | Contract |
|---|---|---|
| `useResolveQhpReschedule()` | Approve/reject a reschedule | `coach_assessment.reschedule_status = 'approved'/'rejected'`. **DB trigger** applies `reschedule_data.proposed_*` → `assessment_date/time` on approve. |
| `useSetQhpManagerReview()` | Sign off completed QHP | `coach_assessment.qhp_manager = 'approved'/'not_approved'`. |
| `useHoldQhp()` | Put client QHP on hold | `rpc('set_lead_qhp_hold', { _client_id, _reason, _resolving_at })`. |
| `useRescheduleQhpAssessment()` | Manager direct reschedule | `coach_assessment` update `assessment_date`, `assessment_time`. |
| `useScheduleQhp()` *(in `src/lib/qhpQueries.ts`)* | Create a QHP | INSERT `coach_assessment { coach_id: assessorId, client_id, client_name, assessment_date, assessment_time, location, notes, assessment_scheduled: true, scheduled_by }`. |
| `useQhpAssessors()` *(qhpQueries)* | Assessor dropdown | `profiles` where `role in ('trainer','doctor')` AND `can_conduct_assessments = true`. |

**Cache key**: the manager query key is `['qhp-manager', 'v2']`. All the above invalidate it (the `'v2'` bump was needed because a stale persisted SQLite cache of the *old* data shape caused a `undefined.length` render crash — if you change the returned data shape again, bump to `'v3'`).

---

## 6. Files & where things live

| File | Contents |
|---|---|
| `src/lib/capabilities.ts` | `useMyCapabilities()` — role gate. |
| `src/lib/qhpManagerQueries.ts` | `useQhpManager(enabled)` (all Task Pending + Manager + Requests + Review + Reschedule data), SLA helpers (`computeQhpSlaDeadline`, `formatSlaRemaining`, `formatWaiting`, `waitUrgency`), types (`PendingClient`, `QhpAssessment`, `QhpReschedule`, `QhpRequest`), and mutations (`useResolveQhpReschedule`, `useSetQhpManagerReview`, `useHoldQhp`, `useRescheduleQhpAssessment`). |
| `src/lib/qhpQueries.ts` | Assessor-side QHP hooks + `useScheduleQhp`, `useQhpAssessors`, `useQhpClients`. `useScheduleQhp` now invalidates `['qhp-manager','v2']` too. |
| `src/screens/trainer.tsx` | `QhpManager()` screen (~line 5348), reusable `ScheduleQhpSheet` (~line 5133), `QhpStats()` (still mock ~5613), `Qhp()` assessor screen (mock). |
| `src/components/chrome.tsx` | Drawer nav gating (`routeVisible`). |
| `src/icons.tsx` | Icon paths (added `copy`). |

### `PendingClient` type (Task Pending cards)
```ts
{ clientId, name, phone, joinedAt, hasQHP, assessmentId, assessmentDate, assessmentTime, holdReason, holdOverdue }
```

### `ScheduleQhpSheet` (reusable schedule form — matches web CoachAssessmentSchedulingForm)
Props: `{ visible, onClose, scheduledBy, prefill?: { clientId, clientName, date? } }`. Has assessor dropdown, client dropdown (prefillable), 14-day date picker, tap-to-cycle time, location, notes → calls `useScheduleQhp`. **Already updated to accept `prefill`.**

---

## 7. STATE: what's done vs pending

### ✅ Done & typechecking
- Role gate + drawer gating.
- Task Pending rewritten to the exact client-centric algorithm above, with client-side SLA, correct buckets & counts.
- Cards: Not Scheduled (SLA badge, breach note, waiting/urgency, **Hold** button + Hold modal), Scheduled (QHP date, Upcoming/Delayed), On Hold, Reschedule (Approve/Reject).
- Manager / Requests / QHP Review tabs wired to live data.
- Mutations: resolve reschedule, manager review, hold, reschedule-assessment. `useScheduleQhp` & `useQhpAssessors` exist and refresh the manager list.
- `ScheduleQhpSheet` made reusable with `prefill`. `copy` icon added.
- Query key bumped to `v2` (fixed the `cannot read property 'length'` crash from stale cache).

### 🔧 In progress — INTERRUPTED mid-wiring (finish these first)
The user's last request: **"Not Scheduled cards must show the Schedule QHP button (not only Hold); on the Scheduled tab add a Reschedule button and an easy copy-credential button."** The plumbing exists but the `QhpManager` screen wasn't finished. Remaining steps:

1. **In `src/screens/trainer.tsx`**, add to the top imports:
   ```ts
   import { /* …existing… */ useRescheduleQhpAssessment } from '../lib/qhpManagerQueries';
   import * as Clipboard from 'expo-clipboard';   // expo-clipboard@~8.0.8 is installed
   ```
   *(This exact edit was pending when the session ended — the `import` line still reads without `useRescheduleQhpAssessment`/`Clipboard`.)*
2. In `QhpManager()` add state: `scheduleFor` (PendingClient|null), `reschedFor` (PendingClient|null), and `const { session } = useAuth();` (for `scheduledBy = session?.user?.id`).
3. **Not Scheduled card**: add a dark **Schedule QHP** button before the Hold button → `onPress={() => setScheduleFor(c)}`.
4. **Scheduled card**: add **Reschedule QHP** button → opens a small date/time modal → `useRescheduleQhpAssessment().mutate({ id: c.assessmentId!, date, time })`. Add a **copy** icon button (`Icon name="copy"`) → `Clipboard.setStringAsync(c.phone ?? '')` copying phone/credential (optionally also a `phone` call button via `Linking.openURL('tel:'+c.phone)`).
5. Render `<ScheduleQhpSheet visible={!!scheduleFor} onClose={() => setScheduleFor(null)} scheduledBy={session?.user?.id ?? ''} prefill={scheduleFor ? { clientId: scheduleFor.clientId, clientName: scheduleFor.name } : undefined} />` and the reschedule modal.
6. **SLA-breached scheduling** (web parity): when scheduling a client whose SLA is overdue, the web requires a **delay reason** and stores `assignment_delay_reason`, `assigned_late`, `delay_minutes`, `sla_deadline_at` on the insert. `useScheduleQhp` does NOT set these yet — extend it with optional fields and surface a required reason input in `ScheduleQhpSheet` when SLA is breached.

### ⏳ Not started (web parity backlog)
- **Tracker** tab and **Client Linked** tab — web has 6 tabs total (Task Pending, Manager, Tracker, Requests, Client Linked, QHP Review); native has 4. Read the web for their exact queries.
- **Requests → Approve** action (insert `coach_assessment` from a `qhp_schedule` row).
- **"Assessor's Retention"** button (top-right in web).
- `QhpStats` and `Qhp` (assessor) screens are still **mock** — need wiring.

---

## 8. How to verify against live data

Because only Raj (QHP Manager) sees Task Pending, verify with a node probe (run from inside `odds-app/` so `@supabase/supabase-js` resolves). Sign in as the manager, then call `get_qhp_booked_client_ids`, `get_qhp_holds`, and the `clients`/`coach_assessment` queries and confirm shapes. Example probe used earlier confirmed every column above exists and the `.or/.gte/.in` filters run clean. Clean up any probe file afterward (don't leave scripts in the repo).

`npx tsc` was flaky in this shell (npx tried to install a bogus global `tsc`). Use: `node node_modules/typescript/bin/tsc --noEmit`.
