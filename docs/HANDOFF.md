# Project Handoff — Odds Fitness Native App

Read this first when picking up the project on a new machine.

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
