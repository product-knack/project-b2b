# Odds App — End-to-End Context (handoff)

> Paste this into a fresh Claude session to continue work on **odds-app**. It describes the whole app: stack, architecture, backend, every workspace/screen, conventions, and how to verify against live data. When in doubt, trust the code and the live DB over this doc.

---

## 0. What this is

`odds-app` is a **React Native / Expo** mobile app for **Odds Fitness staff** (a gym/coaching business). It is being **ported from a live web app** (React + Supabase). The app is staff-only — client-role accounts cannot use it. It has three staff **workspaces** chosen by the signed-in account's `profiles.role`: **Trainer**, **CRM**, and **Coach**.

- App root: `C:\Users\ADMIN\Desktop\b2b\odds-app`
- Web reference (read this before porting logic): `C:\Users\ADMIN\Desktop\b2b 12 july\oddsfitness-hub-track-main` (fallback: `C:\Users\ADMIN\Desktop\hybrid-b2b\oddsfitness-hub-track-main`)
- There are two existing handoff docs in the repo root: **`QHP_MANAGER_HANDOFF.md`** (QHP Manager feature) and this file.

---

## 1. Stack & versions (from package.json — source of truth)

- **Expo `~54.0.0`**, **React Native `0.81.5`**, **TypeScript `~5.9.2`**
  (Note: `AGENTS.md`/`CLAUDE.md` tells you to read Expo **v57** docs — that's inconsistent with package.json's 54; verify the actual installed SDK before using version-specific APIs.)
- **@tanstack/react-query `^5.101.2`** + `react-query-persist-client` + `query-async-storage-persister` — cache is **persisted across launches** (PersistQueryClientProvider). Global defaults: `staleTime` ~30s, `refetchInterval: 60_000`, `networkMode: 'offlineFirst'`.
- **@supabase/supabase-js `^2.110.0`** — anon key only.
- **@react-native-async-storage/async-storage**, **expo-sqlite** (cache/kv), **expo-location** (foreground only), **expo-clipboard**, **expo-linear-gradient**, **react-native-svg** (icons).
- Self-rolled navigation (NO React Navigation / expo-router).

---

## 2. Golden rules (do not break)

1. **Anon key only.** NEVER put the `service_role` key in the app. The user runs all DDL/SQL by hand in the Supabase SQL editor — give them SQL, don't try to run migrations.
2. **Read the web app before porting logic.** Match backend contracts (table names, columns, RPC names, insert/update shapes) EXACTLY. Approximations have caused rework. The user repeatedly insists on exact fidelity.
3. **Verify against live Supabase before claiming done.** Probe tables/RPCs as the relevant signed-in role (pattern in §8).
4. **Keep typecheck at 0 errors:** `node node_modules/typescript/bin/tsc --noEmit` (plain `npx tsc` misbehaves in this shell — see §8).
5. **UI theme:** obsidian `#080606` / ember `#F47A2A`, Geogrotesque fonts. Reuse existing primitives; screens have transparent backgrounds (ambient glow shows through) — wrap content in `Page`, never an opaque `View`.
6. Client-role accounts must never access this staff app. QHP/coach areas are gated by role/capability.

---

## 3. Architecture

### 3.1 Auth & roles — `src/auth.tsx`
- `AuthProvider` exposes `{ session, loading, role, dbRole, signIn, signOut }` via `useAuth()`.
- `dbRole` = raw `profiles.role`. `role` = app workspace, derived by `appRoleOf(dbRole)`:
  ```ts
  dbRole === 'client' || !dbRole ? null       // signed out (staff-only app)
    : dbRole === 'crm'   ? 'crm'
    : dbRole === 'coach' ? 'coach'
    : 'trainer'                                 // every other staff role → trainer workspace
  ```
- Role resolved on session-restore and on `signIn`. Non-staff accounts are force-signed-out.
- **Trainer sub-roles are NOT `profiles.role`** — they're boolean capability flags on `profiles` (see §3.6 / `capabilities.ts`).

### 3.2 Navigation & routing (self-rolled)
- **Global store** `src/store.tsx` (`useStore()`) holds `route: string` and navigation actions:
  - `go(route, reset?)` — navigate (pushes history; `reset` clears it, used post-login).
  - `back()` — pop history (drives swipe-back).
  - `openClient(id, name, tab?)` → sets `selectedClientId/Name/clientInitialTab`, routes to `'client'`. Detail screens read these from the store (params are NOT in the route string).
  - `openWorkout(...)`, `openChat`, `crmSection`, etc.
  - `role: Role` here is the UI workspace; type `Role = 'trainer' | 'crm' | 'coach'` (defined in store.tsx).
- **`src/Router.tsx`** — `SCREENS: Record<string, React.ComponentType>` maps every route-key → screen component. `RouteScreen` looks up `SCREENS[route] ?? Dashboard`, wrapped in an error boundary. Post-login redirect ternary sends `crm→crm-dashboard`, `coach→coach-dashboard`, else `dashboard`. **There is NO route-level access control** — role only picks the drawer nav + landing screen; any signed-in user could `go()` anywhere. Gate deliberately if needed.
- **`src/components/chrome.tsx`** — `Header` + `Drawer`. Drawer picks nav by role: `role === 'crm' ? crmNav : role === 'coach' ? coachNav : trainerNav`. Items can be hidden via `itemVisible()` (trainer capability gating). Badges from `useNavBadges()`.
- **`src/data.ts`** — the nav arrays `trainerNav`, `crmNav`, `coachNav` (`NavGroup[]`, each `{ label, items: [{ label, icon, route, badge? }] }`). `icon` must be a key of `ic` in `src/icons.tsx` (or add a path there).

### 3.3 Adding a new role/screen (the recipe)
1. Widen `Role` in `store.tsx`. 2. Add branch in `appRoleOf` (`auth.tsx`). 3. Add a `*Nav` in `data.ts`. 4. Add nav selection in `chrome.tsx`. 5. Import screen + add route keys to `SCREENS` and the redirect in `Router.tsx`. 6. Duplicate redirect in `SignIn.doSignIn` (`trainer.tsx`). 7. Add label to `ROLE_LABELS` in `navQueries.ts`. 8. New screens in `src/screens/*`, new hooks in `src/lib/*`.

### 3.4 Data layer — `src/lib/*Queries.ts`
- Each hook: `export function useX(...) { return useQuery({ queryKey: [...], enabled, staleTime, queryFn }) }`. Import `supabase` from `./supabase`, `useAuth` for the signed-in id (`session.user.id`), guard with `enabled: !!uid`.
- Mutations: `useMutation` + `useQueryClient`, `onSuccess` invalidates the relevant `queryKey`.
- Query keys are `['<domain-noun>', ...params]`; **`src/lib/liveSync.tsx`** maps Postgres tables → key prefixes and invalidates them on realtime changes (one `supabase.channel('live-sync')`).

### 3.5 Theme & primitives
- `src/theme.ts` — palette `C` (orange `#F47A2A`; status green/red/blue/purple/gold; obsidian surfaces; ink/muted text ramps), `ORANGE_GRAD`, `hexA(hex, a)` alpha helper, fonts `F` (Geogrotesque family).
- `src/components/primitives.tsx` — `Card` (warm gradient surface; pass `colors`/`border`/`radius`/`style`/`onPress`), `GradientButton`, `Avatar` (⚠️ renders the initial in near-black text — put it on a BRIGHT gradient, not a dark one), `ProgressBar`, `StatCard`, `Pill`, `Tab`, `SectionLabel`, `AttentionBanner`.
- `src/screens/common.tsx` — `Page` (standard scroll body: pull-to-refresh, keyboard-aware, `maxWidth: 640`), `GreetingHeader`, `TitleBlock`, `Badge`, `MiniStat`, `HScroll`, `SessionCard`, `BackLink`, `MiniAvatar`.
- `src/icons.tsx` — `ic` path map, `Icon` component (`name` from `ic`, or raw `path`), `IconName`.

### 3.6 Trainer capabilities — `src/lib/capabilities.ts`
`useMyCapabilities()` → `{ data: { isQhpManager, canConductAssessments, canViewAllAssessments, canViewAllTrainers, workoutAnalyst, isManager, isTrainerManager }, isLoading }`. Read from boolean `profiles` columns. Key gate: **QHP Manager = `profiles.can_schedule_assessments_for_others === true`** (exactly one: Raj Thakur).

---

## 4. Backend (Supabase)

- URL `https://agtjszjedaenclbzgjvi.supabase.co`; anon key in `.env` (`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`). Client in `src/lib/supabase.ts`.
- RLS is enforced; reads/writes are scoped by the signed-in role. Some tables (e.g. `coach_trainers`) are readable only under the matching role's own session.

### Test accounts (dev quick-fill chips on the sign-in screen)
| Role | Email | Password | Notes |
|---|---|---|---|
| CRM | `crm@oddsfitness.com` | `Ritu@odds11` | Ritu, `role='crm'` |
| Trainer | `divya@oddsfitness.com` | `Divya@odds` | Divya, `role='trainer'` |
| Coach | `coach@oddsfitness.com` | `Coach@odds001` | id `3d04b08d-…`, `role='coach'`, 62 trainers → 267 clients |

### Key tables (columns verified live)
- **`profiles`** — `id, first_name, last_name, role, managers`, + capability booleans (`can_schedule_assessments_for_others`, `can_conduct_assessments`, `can_view_all_assessments`, `can_view_all_trainers`, `workout_analysist` [sic], …), `email, phone`.
- **`clients`** — `id, first_name, last_name, email, phone, status, created_at, subscription_type, improvement_status, is_hybrid, avatar_url, sessions_per_cycle, coach_id, …` (50 cols). ~660 rows.
- **`coach_trainers`** — `coach_id, trainer_id` (RLS: coach-only readable).
- **`trainer_clients`** — `trainer_id, client_id, actively_training, assigned_at`. ~2097 rows.
- **`training_sessions`** — `id, trainer_id, client_id, scheduled_at, status, attendance_marked, session_type, duration_minutes, unique, cancelled, …` (35 cols). ~15.6k rows.
- **`workout_plan_exercises`** — ONE ROW PER EXERCISE; plan-level fields (`plan_id, plan_name, modality, status, approved_at, approved_by, coach_feedback, trainer_id, client_id, document_url`) repeat across rows → **dedupe by `plan_id`**. ~25k rows. Statuses: `pending`/`pending_review`/`approved`/`rejected`/`needs_revision`.
- **`client_training_plans`** — uploaded training-plan docs: `id, file_name, file_path, status, approved_at, approved_by, coach_feedback, trainer_id, client_id`.
- **`coach_assessment`** — the QHP table (assessor = `coach_id`): `id, client_id, client_name, coach_id, scheduled_by, assessment_date, assessment_time, assessment_scheduled, completed (TIMESTAMP not bool), qhp_manager ('approved'/'not_approved'/null), sla_deadline_at, reschedule_status, reschedule_data (jsonb {remark, requested_at, proposed_date, proposed_time}), new_client_assessment_data/existing_client_assessment_data/qhp_data (jsonb — non-empty = QHP done), mechanical_score, ai_biomechanical, health_briefing`. ~175 rows.
- **`qhp_details`** — generated QHP report + Junior→Senior→HOD review flow.
- **`qhp_schedule`** — QHP scheduling requests (`status='pending'`, `date, time, address`).
- **`health_reports`** — biomarkers: `client_id, is_active, created_at, extracted_data (jsonb)`. `extracted_data = { tests: [ { name, markers: [ { name, value(string), unit, status, reference_range } ] } ], summary, metadata, patient_info }`. Marker `status` ∈ normal|low|high|abnormal|critical.
- **`workout_analysis`** — progression: `client_id, created_at, session_load, max_1rm, one_rm(jsonb), modality, workout_type`.
- Others referenced: `nutrition_tracker`, `daily_health_metrics`, `daily_sleep_logs`, `daily_goals`, `biological_age_history`, `leads`, `conversations`/`messages` (chat), `trainer_payout_records`.
- **`training_plans` does NOT exist** — plan data lives in `workout_plan_exercises`.

### RPCs (SECURITY DEFINER; verified live)
- `get_qhp_booked_client_ids()` — leads at stage 'QHP Booked' (gated to QHP managers).
- `get_qhp_holds()`, `set_lead_qhp_hold(_client_id, _reason, _resolving_at)`.
- `get_pending_workout_plans_for_coach(p_coach_id, p_limit)`, `get_pending_training_plans_for_coach(p_coach_id)`, `get_unique_client_plans(p_client_ids uuid[])`.
- **There is NO plan-approval RPC** — approve/reject is a direct table UPDATE (RLS-authorized).

### ⚠️ Gotcha: PostgREST caps every response at **1000 rows**
Raw-row aggregations (counting sessions, plan-exercise rows) silently truncate. Always paginate with `.range(from, to)` in a loop — see `fetchAll()` in `src/lib/coachQueries.ts`. (This coach has 14.4k sessions; a naive count returned exactly 1000.)

---

## 5. Workspaces & screens

Screens live in `src/screens/*`; data hooks in `src/lib/*Queries.ts`. Route keys are the strings in `Router.tsx`'s `SCREENS`.

### 5.1 Trainer workspace — `src/screens/trainer.tsx` (+ payouts, createPlan, workoutAnalyst, messenger, qhpAssessmentForm, reportDetail)
Routes: `dashboard, clients, client (ClientDetail), sessions, workout, create-plan, workout-analyst, payouts, qhp, qhp-manager, qhp-stats, managers, messenger, client-threads, profile, events, mgr-dash, trainer-leaderboard`.
- **Dashboard** — today's roster, stats, leaderboard; capability-gated alerts.
- **ClientDetail** — rich client profile with a **trends** tab (bio-age gauges [Axion/Metabolic + MAQ/Mechanical], Session Load & Max 1RM charts via `AreaLine`/`ProgChart` from `workout_analysis` + `biological_age_history`). Reused by coach via `openClient(id, name, 'trends')`.
- **QHP** (assessor), **QHP Manager** (oversight — see `QHP_MANAGER_HANDOFF.md`), **QHP Stats**.
- **Messenger** (`messenger.tsx`) — 3 tabs (Clients / Team / Odds Admin), client threads, chat notifications. Chat data in `chatQueries.ts`/`chatMedia.ts`.
- **Location tracking** — `src/components/LocationCapture.tsx` + `src/lib/locationLog.ts` (foreground only, TRAINERS only, outbox/throttle; hidden from UI).

### 5.2 CRM workspace — `src/screens/crm*.tsx`
Routes: `crm-dashboard, crm-clients, crm-client, crm-distribution, crm-consume, crm-comms, crm-roster, crm-qhp, crm-esc, crm-tasks, crm-tools, crm-approvals, crm-service, crm-birthdays, crm-sales, crm-journey, crm-blood, crm-assessment, crm-health, crm-section`, etc. Data in `crm*Queries.ts`, `approvalQueries`, `serviceQueries`, `escalationQueries`, `distributionQueries`, `consumeQueries`, `rosterQueries`, `salesQueries`, `journeyQueries`, `taskQueries`, `bloodQueries`, `incentiveQueries`. (These predate the current session; read the files/web app before changing.)

### 5.3 Coach workspace — `src/screens/coach.tsx` + `src/lib/coachQueries.ts` (BUILT THIS SESSION — most current)
Coach = **head-of-trainers**. Universal scope: `coach_trainers(coach_id=me) → trainer_clients(trainer_id IN …, actively_training=true) → clients` (`coachScope(uid)` helper). Nav = `coachNav`. Routes:
- `coach-dashboard` — trainers/clients/new-QHP(7d)/re-QHP(7d) tiles, quick actions, **Trainer Performance** leaderboard (weekly completed+marked sessions, trend vs prior week, "Show more").
- `coach-calendar` — team sessions for a selected day (date strip + completion stats).
- `coach-trainers` — per-trainer clients/sessions/attendance-rate.
- `coach-assessments` — `coach_assessment` where `coach_id IN (trainerIds ∪ me) OR scheduled_by=me`.
- `coach-clients` — paginated client list w/ conducted-session counts.
- `coach-clients-overview` — subscribed clients + improvement-status & QHP-timing filters (IST week/month via `qhpWindows()`).
- `coach-progression` — client picker → **ProgressionDialog** (tab 1: `workout_analysis` summary + mini bar chart; tab 2: **Critical Markers** from latest active `health_reports` via `extractConcerningMarkers`; "Open full profile" → ClientDetail trends).
- `coach-programs` — approval inbox (pending workout / pending training / processed). **Approve/reject/needs-revision** wired as DIRECT table UPDATEs (`useProcessCoachPlan`): workout → `workout_plan_exercises` by `plan_id`; training → `client_training_plans` by `id`. approve sets status='approved'+approved_by+approved_at; reject/needs_revision set status+coach_feedback (feedback required).
- `coach-plans-overview` — **Client Plans Overview**: 4 dropdown filters (Trainer / Modality / Plan Status / Expiry), "Showing X of Y", cards with ALL assigned-trainer chips + per-modality status chips (Active/`Nd left`/Expired; 42-day expiry rule). Data: `get_unique_client_plans` RPC.
- `coach-approved-plans` — merged approved workout + training plans.

Coach detail is captured in memory (see §7). CAVEAT: coach plan-approval UPDATE RLS was not tested live (reads only — didn't mutate prod data); the web coach does the same update, and errors surface inline. Not yet ported: the web's "Weekly Health Summary" progression tab (nutrition_tracker/daily_health_metrics/daily_sleep_logs/daily_goals); dedicated coach client/trainer detail pages (coach reuses the trainer ClientDetail via `openClient`).

---

## 6. Avatars gotcha (recently fixed)
The `Avatar` primitive draws the initial in near-black — on a dark gradient it becomes an invisible blob. `coach.tsx` uses `RowAvatar` with an 8-color bright palette seeded off the person's name (`avColors`). Apply the same pattern anywhere you place avatars on dark surfaces.

---

## 7. Existing docs & memory
- `QHP_MANAGER_HANDOFF.md` (repo root) — full QHP Manager feature spec + what's pending.
- Persistent memory (loaded each session) at `C:\Users\ADMIN\.claude\projects\C--Users-ADMIN-Desktop-b2b\memory\`:
  - `coach-workspace.md` — coach scope pattern, role plumbing, coach account, 1000-row cap, what's done/pending.
  - `client-threads-backend.md` — chat/threads DB objects exist only in live Supabase, not in any repo.
  - `MEMORY.md` is the index.

---

## 8. Dev workflow

- **Typecheck (do this after every change):** `node node_modules/typescript/bin/tsc --noEmit` (must be 0 errors). Plain `npx tsc` tries to install a bogus global package in this shell — don't use it.
- **Live verification pattern** (can't run the RN app headless): write a temporary `*.mjs` **inside** `odds-app/` (so `@supabase/supabase-js` resolves), sign in with a role's creds, run `node file.mjs`, then delete it. Read-only probes only — do NOT mutate production data. Example skeleton:
  ```js
  import { createClient } from '@supabase/supabase-js'; import fs from 'fs';
  const env = fs.readFileSync('.env','utf8');
  const URL=/EXPO_PUBLIC_SUPABASE_URL=(.+)/.exec(env)[1].trim();
  const KEY=/EXPO_PUBLIC_SUPABASE_ANON_KEY=(.+)/.exec(env)[1].trim();
  const sb=createClient(URL,KEY);
  await sb.auth.signInWithPassword({ email:'coach@oddsfitness.com', password:'Coach@odds001' });
  // ...probe queries...
  ```
- **Editing huge functions** in `trainer.tsx` (5000+ lines): match a unique snippet; for very large blocks, splice via a node script.
- Platform: Windows; shell is Git Bash (Bash tool) or PowerShell. Prefer the dedicated file tools over shell `cat`/`grep`.

---

## 9. Suggested next tasks (open items)
- Coach: port "Weekly Health Summary" progression tab; build dedicated coach client/trainer detail pages; confirm plan-approval RLS write works end-to-end.
- QHP Manager: finish the interrupted Schedule-QHP button wiring + SLA-breach reason (see `QHP_MANAGER_HANDOFF.md` §7); Tracker & Client-Linked tabs; Requests-approve action.
- SQL the user still needs to run by hand (from prior sessions): RLS for `trainer_payout_records`; `ALTER PUBLICATION supabase_realtime ADD TABLE messages` (chat notifications); `get_or_join_client_group` RPC (messenger group join).

---

## 10. How to start in a new session
1. Skim this file + `QHP_MANAGER_HANDOFF.md` + the memory files.
2. For any feature: open the corresponding web-app page first, extract the exact Supabase contract, then port.
3. Probe live to confirm shapes (as the right role).
4. Implement in `src/lib/*Queries.ts` (data) + `src/screens/*` (UI), reusing theme/primitives.
5. `node node_modules/typescript/bin/tsc --noEmit` → 0 errors, then verify behavior against live data.
