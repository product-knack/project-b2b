-- REQUIRED for the native "edit plan" feature (trainer can edit an approved plan
-- until 4 workouts are logged against it — web parity, incl. shared plans).
--
-- Multi-trainer rule (web parity): when a client has two trainers on the same
-- modality they share one plan_id, each trainer's exercises stamped with their
-- trainer_id. Editing only ever touches the CALLING trainer's rows — the other
-- trainer's exercises are never deleted or rewritten.
--
-- Edit = "Save & Resubmit" (web parity): the reinserted rows take the table
-- DEFAULTS for status ('pending_review'), approved_at/approved_by/coach_feedback
-- (null) and created_at (now()) — exactly what the web builder's insert does —
-- so an edited plan goes back to the coach for re-approval.
--
-- One SECURITY DEFINER RPC = one transaction:
--   * caller must own at least one row of the plan
--   * 4-workout lock RE-VALIDATED server-side at execution time (guards online
--     saves AND offline outbox syncs alike; raises PLAN_LOCKED:<n>)
--   * delete + reinsert is atomic — a delete can never commit without its
--     reinsert, and plan_id/trainer_id/client_id/modality can't be forged.
-- Run in the Supabase SQL editor.

CREATE OR REPLACE FUNCTION public.edit_workout_plan(
  _plan_id uuid,
  _plan_name text,
  _plan_description text,
  _duration_weeks int,
  _exercises jsonb   -- array of per-set rows (see column list below)
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  v_client uuid; v_modality text; v_status text; v_approved_at timestamptz;
  norm_modality text; v_count int;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _exercises IS NULL OR jsonb_array_length(_exercises) = 0 THEN
    RAISE EXCEPTION 'Plan must have at least one exercise';
  END IF;

  -- The caller's own slice of the plan (shared plans: each trainer has their own
  -- rows). No rows = not your plan.
  SELECT client_id, modality, status, approved_at
    INTO v_client, v_modality, v_status, v_approved_at
    FROM workout_plan_exercises
   WHERE plan_id = _plan_id AND trainer_id = uid
   LIMIT 1;
  IF v_client IS NULL THEN
    RAISE EXCEPTION 'Plan not found, or it has no exercises added by you';
  END IF;

  -- 4-workout lock (approved plans only). Same rule as the web hook:
  -- distinct workout sessions, modality-normalized, since approval.
  IF v_status = 'approved' AND v_approved_at IS NOT NULL THEN
    norm_modality := CASE WHEN v_modality = 'Strength Training' THEN 'Strength' ELSE v_modality END;
    SELECT COUNT(DISTINCT session_id) INTO v_count
      FROM workout_exercises
     WHERE client_id = v_client
       AND modality = norm_modality
       AND session_date IS NOT NULL
       AND session_date >= v_approved_at;
    IF v_count >= 4 THEN
      RAISE EXCEPTION 'PLAN_LOCKED:%', v_count;
    END IF;
  END IF;

  -- Only MY rows. Another trainer's exercises in the same plan survive intact.
  DELETE FROM workout_plan_exercises WHERE plan_id = _plan_id AND trainer_id = uid;

  -- status / approved_* / coach_feedback / created_at intentionally omitted →
  -- table defaults = pending_review + null + now() (web "Save & Resubmit").
  INSERT INTO workout_plan_exercises (
    plan_id, trainer_id, client_id, modality,
    plan_name, plan_description, plan_duration_weeks,
    body_part, exercise_name, set_number, tempo, rest_period, rm_percentage,
    reps_target, load_target, super_set_group, exercise_notes, duration,
    activity_type, sub_activity, rir_target, order_index, measurement_type
  )
  SELECT
    _plan_id, uid, v_client, v_modality,
    _plan_name, _plan_description, _duration_weeks,
    r.body_part, r.exercise_name, r.set_number, r.tempo, r.rest_period, r.rm_percentage,
    r.reps_target, r.load_target, r.super_set_group, r.exercise_notes, r.duration,
    r.activity_type, r.sub_activity, r.rir_target, r.order_index, r.measurement_type
  -- Types verified against the live table (2026-07-28): int = rest_period,
  -- reps_target, rir_target, order_index; numeric = rm_percentage, load_target;
  -- everything else text (set_number is TEXT by design).
  FROM jsonb_to_recordset(_exercises) AS r(
    body_part text, exercise_name text, set_number text, tempo text, rest_period int,
    rm_percentage numeric, reps_target int, load_target numeric, super_set_group text,
    exercise_notes text, duration text, activity_type text, sub_activity text,
    rir_target int, order_index int, measurement_type text
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.edit_workout_plan(uuid, text, text, int, jsonb) TO authenticated;
