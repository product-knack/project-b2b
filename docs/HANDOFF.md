# Project Handoff — Odds Fitness Native App

Read this first when picking up the project on a new machine.

## Built, never used, needs a process decision before any code (20 Oct 2026)
**Live ride tracking of the assessor (route tracker).** Built 14 Oct 2026 on the app
(`src/lib/routeTracker.ts`, `src/screens/qhpNavigation.tsx`), the server (hub-track migration
`20261014120000_route_tracker.sql`) and the web Leads page. Audited end to end on 20 Oct 2026:
`docs/route-tracker-audit-20oct.md`. Zero rides have ever been published. The blocker is not a bug:
no client has a location pin before their first QHP (8 of 84 QHP clients in the last 30 days had
one, all captured by a trainer at a session), so Start navigation, and with it the tracking, is
almost never available. Decisions for whoever owns ops, not engineering: (1) how the pin gets onto
the lead before the ride (Ops pastes it at QHP booking, the assessor pastes an address at Start, or
the pin carries from lead to client); (2) who may see rides (today the lead owner, QHP managers and
admins; 8 of 27 booked leads have an owner). Do not build any phase until those are decided.
If the feature is ever switched on, fix these four first (details in the audit): Android back leaves
the ride unsaved and "live"; a stalled final save blocks the end event and traps the assessor; a
dropped start is never retried and the whole ride then fails quietly; an end sent offline is lost.
While idle it costs nothing: the crons touch an empty table, and the Leads page host was made
dormant on 20 Oct 2026 (one query every 5 minutes, no realtime channel until a ride exists).

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
