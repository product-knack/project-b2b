---
name: workout-log-contract
description: "The VERIFIED workout-logging backend contract (web + native odds-app) — corrects the user's stale architecture doc"
metadata: 
  node_type: memory
  type: project
  originSessionId: 5527b21c-0de8-4869-8f72-0c35b4727fce
---

The trainer Add Workout form's real backend contract, extracted verbatim from web code + live DB (2026-07-17). **The user's pasted architecture doc was wrong in key places — trust this, not it.**

**Why:** the doc described `workout_sessions`/`scheduled_sessions` tables, plan-snapshot columns, per-set RPE, a ±90-min conflict check, `duplicate_remarks`, and a yoga "English (Sanskrit)" rule — NONE exist in the live DB or web code.

**How to apply (the true contract):**
- The ONLY session write is `workout_exercises` rows sharing a client-generated `session_id` uuid; `training_sessions` rows are created by DB triggers (verified live: 13/13 sessions have one, keyed `workout_session_id`). Post-insert UPDATEs on `training_sessions`: `rpe` (INTEGER, session-level), `schedule_session_id`, `partner_session_group_id` — all `.eq('workout_session_id', sessionId)`, non-fatal.
- Session remark → `remark` column on the FIRST exercise row only. Plan targets are written INTO `*_performed` columns (no `*_plan` columns exist — the form's reps_plan/load_plan/duration_plan are placeholders only). `load_performed` is free TEXT (bodyweight expressions like "BW+5" valid); load is OPTIONAL per set, reps/duration required.
- Modality rows: yoga/boxing → `body_part` 'Yoga Activity'/'Boxing Activity', `set_number` null, boxing `duration_seconds = minutes×60` + `rounds` (Padwork defaults 1). Aerobics → 'Aerobics Activity', minutes×60, set_number kept, measurement_type 'reps' (web quirk). Pilates uses the STRENGTH grid + equipment select (Pilates Ring/Ball/Resistance Band/Brick), NOT a checklist. Aqua Aerobics = fixed 16-exercise list with per-entry reps/duration types, body_part 'Aqua Aerobics Activity'. Custom modality exists only when an approved Custom plan does; its typed name becomes the row `modality`.
- Gate: effective plan expiry is **42 days** (web's inline 45-day re-check is dead code — `availableModalities` already filters at 42); 3 plan-less sessions per modality block (strength counts legacy null-modality rows with body_part). Duplicate guard = same-day query on `workout_exercises.created_at` (local midnight bounds) + confirm dialog, NO remarks column; allow on error.
- Partner flow: `clients.training_partner_id` → co-partner = other client with same id; shared uuid → both sessions' `training_sessions.partner_session_group_id`.
- Native implementation lives in [clientQueries.ts](odds-app/src/lib/clientQueries.ts) (`submitWorkoutLog`, `checkDuplicateWorkoutToday`, `useApprovedPlansForLogging`, `usePartnerInfo`, `usePreviousExerciseData`) and the `Workout()` form in [trainer.tsx](odds-app/src/screens/trainer.tsx) (plan pre-population via body-part chips, ✅ modality indicators, draft autosave in kv-store `workout-draft:{trainerId}:{clientId}`, ≥2× load/reps warning, "Last: X" placeholders). Write mutations were NOT test-fired against production. Related: [[coach-workspace]].
