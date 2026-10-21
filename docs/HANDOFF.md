# Project Handoff — Odds Fitness Native App

Read this first when picking up the project on a new machine.

## Live ride tracking of the assessor (route tracker): LIVE since 21 Oct 2026
Built 14 Oct 2026 on the app (`src/lib/routeTracker.ts`, `src/screens/qhpNavigation.tsx`), the
server (hub-track migrations `20261014120000`, `20261020140000`, `20261021120000`) and the web
Leads page; audited 20 Oct 2026 (`docs/route-tracker-audit-20oct.md`, status at its top); switched
on 21 Oct 2026 on the owner's decision ("track live from the Leads page, also with the screen
locked"). What changed on 21 Oct: the ride GPS runs in an Android foreground location service
(`src/lib/rideLocationTask.ts`, expo-task-manager, `FOREGROUND_SERVICE_LOCATION`, no background
location declaration), the publisher retries `start`, queues `ended` through the outbox kind
`route-ended`, Android back goes through the Exit confirm; the web got an "Assessor rides" panel
and an always-on lobby; the ops role may watch rides. Feature docs:
`docs/features/android/trainer/route-tracker.md` and `docs/features/web/ops/route-tracker.md`.
Still a process decision: the pin before the ride (the member app's `set_my_home_location` is the
member-side fix). iOS: the iOS app publishes while its screen is open (5.1); the lock-screen part
is in `docs/ios-route-tracker-background-handoff.md`. Play upload: declare the foreground service
type (location) in Play Console App content before uploading a build with this permission.

## What this is
React Native / Expo (SDK 54) staff app for Odds Fitness — a native port of the live web app
(`oddsfitness-hub-track-main`, React + Supabase). Six role workspaces: trainer, CRM, coach,
ops, admin, doctor. Backend is Supabase (`https://agtjszjedaenclbzgjvi.supabase.co`) using the
ANON key only — never service_role in the app. Edge functions live in `supabase/functions/`
(deploy with `npx supabase functions deploy <name> --project-ref agtjszjedaenclbzgjvi`).

## Working rules (established with the owner)
- EXACT backend-contract fidelity with the web app; verify against live data with read-only
  node probes signed in as test accounts (prefill creds are in `src/screens/trainer.tsx` ~line 60).
- NEVER test-fire write mutations against production; reads only. Writes ship and get their
  first exercise in real app use.
- Client PHONE NUMBERS must never be shown on CRM/doctor/trainer dashboards (staff numbers OK).
- Verification loop after every change:
  `node node_modules/typescript/bin/tsc --noEmit` (must be 0 errors) and
  `curl -s -o /dev/null -w "%{http_code}" "http://localhost:8081/index.bundle?platform=ios&dev=true&minify=false"` (must be 200).
- Expo dev server: `npx expo start` (use `--tunnel` — the office Wi-Fi blocks phone→PC LAN).
- UI style: "obsidian/ember" dark theme — match existing screens (see `src/theme.ts`, primitives).
- Query cache is PERSISTED to disk (App.tsx) — never return `Map`/`Set` from a useQuery
  (rehydrates as `{}` and crashes); plain objects only.

## Key locations
- Screens: `src/screens/` (trainer.tsx is the big one), data hooks: `src/lib/*Queries.ts`
- Offline: `src/lib/offline.ts` (write outbox), `src/components/OfflineWarmup.tsx` (trainer pre-sync)
- Location: `src/components/LocationCapture.tsx` (hourly capture + trainer hard gate)
- Client Threads (dedicated backend): `src/lib/clientThreadQueries.ts`, `src/screens/clientThreads.tsx`,
  migration SQL in `supabase/client_threads_migration.sql`
- Roster distance: `supabase/functions/roster-distance/` + Google key in Supabase secret GOOGLE_API_KEY
- iOS handoffs: `docs/ios-*-handoff.md`, one document per batch, pasted to the iOS app's assistant. The latest is
  `docs/ios-8-to-16oct-handoff.md` (20 Oct 2026: everything Android gained from 8 to 16 Oct, 15 sections in build
  order, with the pure rule files to copy byte for byte). Their node tests live in `tests/rules/` (run
  `node tests/rules/<name>.js` from the repo root; `ROOT` at the top of each file points at the repo).

## Deep context per workspace
See `docs/memory/` — verified backend contracts, gotchas, and test accounts per dashboard
(admin-workspace.md, doctor-workspace.md, ops-workspace.md, coach-workspace.md, etc.).
These were the working notes from the original development machine; treat them as accurate
but re-verify anything critical against live data before relying on it.

## Current state (as of 2026-07-20)
Everything compiles clean (tsc 0 errors) and all recent features are deployed/verified:
report-detail redesign, QHP score journeys, services drawer, session-handoff popup,
request-roster dialog, roster distance (Google Routes live), client threads v2 (dedicated
tables + realtime + mentions + swipe-reply), offline warm-up, location gate, renewals history.
Next likely direction: iOS build via EAS (eas.json not yet created).

Update 2026-10-16: Odds Nucleus shipped in code (drawer group Learn for every role; read-only
over longevity_resources; players for YouTube / Vimeo / files / article audio; saved, recent and
positions on the device; feature doc docs/features/android/shared/odds-nucleus.md). Not yet in a
signed build; device test pending.
