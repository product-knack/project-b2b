-- FIX: get_manager_team_late_logs fails with
--   "invalid input value for enum user_role: ''"
-- whenever a team member's profiles.role is NULL, because
--   COALESCE(tp.role, '') tries to cast '' to the user_role ENUM.
-- The only change vs the deployed version is tp.role::text in the final predicate.
-- This breaks the Late Logs tab on Managers Overview in BOTH the web and native app.
-- Run in the Supabase SQL editor.

CREATE OR REPLACE FUNCTION public.get_manager_team_late_logs(
  member_ids uuid[],
  period_start date,
  period_end date DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  trainer_id uuid,
  trainer_name text,
  client_id uuid,
  client_name text,
  session_type text,
  session_name text,
  scheduled_at timestamptz,
  logged_at timestamptz,
  late_log_reason text,
  status_late_log text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  late_tracking_start_date CONSTANT date := '2026-02-10';
  trainer_modalities CONSTANT text[] := ARRAY['Strength', 'Yoga', 'Boxing', 'HIIT', 'Cardio', 'Pilates'];
  effective_end date := COALESCE(period_end, CURRENT_DATE);
BEGIN
  RETURN QUERY
  SELECT
    ts.id,
    ts.trainer_id,
    COALESCE(
      NULLIF(TRIM(COALESCE(tp.first_name, '') || ' ' || COALESCE(tp.last_name, '')), ''),
      'Unknown'
    ) AS trainer_name,
    ts.client_id,
    COALESCE(
      NULLIF(TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')), ''),
      'Unknown'
    ) AS client_name,
    ts.session_type,
    ts.session_name,
    ts.scheduled_at,
    ts.created_at AS logged_at,
    ts.late_log_reason,
    ts.status_late_log
  FROM public.training_sessions ts
  JOIN public.clients c ON c.id = ts.client_id
  LEFT JOIN public.profiles tp ON tp.id = ts.trainer_id
  LEFT JOIN public.session_schedule ss
    ON ss.trainer_id = ts.trainer_id
   AND ss.client_id = ts.client_id
   AND DATE(ss.scheduled_datetime) = DATE(ts.scheduled_at)
  WHERE ts.trainer_id = ANY(member_ids)
    AND ts.scheduled_at >= (period_start::timestamp AT TIME ZONE 'Asia/Kolkata')
    AND ts.scheduled_at <  ((effective_end + INTERVAL '1 day')::timestamp AT TIME ZONE 'Asia/Kolkata')
    AND ts.status <> 'parked'
    AND DATE(ts.scheduled_at) >= late_tracking_start_date
    AND (ts.status_late_log IS NULL OR ts.status_late_log <> 'approved')
    AND ABS(EXTRACT(EPOCH FROM (ts.created_at - ts.scheduled_at)) / 3600) > 2
    AND (
      COALESCE(tp.role::text, '') <> 'doctor'   -- FIX: ::text so NULL roles don't blow up the enum cast
      OR ss.modality IS NULL
      OR NOT (ss.modality = ANY(trainer_modalities))
    )
  ORDER BY ts.scheduled_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_manager_team_late_logs(uuid[], date, date) FROM public;
GRANT EXECUTE ON FUNCTION public.get_manager_team_late_logs(uuid[], date, date) TO authenticated;
