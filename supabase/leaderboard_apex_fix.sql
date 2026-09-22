-- get_trainer_leaderboard: fix the "Odds APEX" tier spelling in the allow-list.
--
-- Every version of this function (20260711120112 .. 20260728124654) lists the
-- tier as 'odds apax'. The live data, the web app and the Android app all spell
-- it "Odds APEX" (clients.subscription_type = 'Odds APEX'), so sessions logged
-- for an APEX client never count toward the trainer leaderboard.
-- Found 2026-09-15 via training_sessions 33129e36-f643-4bd3-b452-e68318eca2ce
-- (Ziaur Rehman, client Disha Batra): the RPC returned 47 for September while
-- he had 48 qualifying rows; the missing one was the APEX session.
--
-- This is the 20260728124654 body with the single allow-list change. Run once
-- in the Supabase SQL editor; no data changes, the leaderboard recomputes live.

CREATE OR REPLACE FUNCTION public.get_trainer_leaderboard(start_date date, end_date date)
 RETURNS TABLE(trainer_id uuid, trainer_name text, session_count bigint, late_session_count bigint, first_assignment_date date, qhp_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  late_tracking_start_date CONSTANT DATE := '2026-02-10';
  trainer_modalities TEXT[] := ARRAY['Strength', 'Yoga', 'Boxing', 'HIIT', 'Cardio', 'Pilates'];
  -- 'odds apex' (was 'odds apax'): matches clients.subscription_type = 'Odds APEX'
  allowed_subs TEXT[] := ARRAY['odds basic','odds pro','odds lux','odds prive','odds apex','odds plus','influencer','staff','trial','opportunity'];
  excluded_trainer_ids UUID[] := ARRAY['9c809a3c-9af2-4dd5-8691-82964cb8907b']::uuid[];
BEGIN
  RETURN QUERY
  WITH trainer_sessions AS (
    SELECT
      ts.trainer_id,
      ts.id as session_id,
      ts.scheduled_at,
      ts.created_at,
      ts.client_id,
      ts.status_late_log,
      p_inner.role as trainer_role,
      CASE
        WHEN p_inner.role = 'doctor' THEN true
        WHEN DATE(ts.scheduled_at) < late_tracking_start_date THEN true
        WHEN ts.cancelled = true OR ts.status = 'cancelled' THEN true
        WHEN ABS(EXTRACT(EPOCH FROM (ts.created_at - ts.scheduled_at)) / 3600) <= 2 THEN true
        WHEN ts.status_late_log = 'approved' THEN true
        ELSE false
      END as is_on_time
    FROM training_sessions ts
    JOIN profiles p_inner ON p_inner.id = ts.trainer_id
    JOIN clients c ON c.id = ts.client_id
    WHERE ts.scheduled_at >= start_date
      AND ts.scheduled_at < (end_date + interval '1 day')
      AND ts.status != 'parked'
      AND ts.trainer_id IS NOT NULL
      AND COALESCE(p_inner.managers, false) = false
      AND ts.trainer_id <> ALL(excluded_trainer_ids)
      AND LOWER(TRIM(c.subscription_type)) = ANY(allowed_subs)
  ),
  filtered_sessions AS (
    SELECT ts.*
    FROM trainer_sessions ts
    WHERE (
      ts.trainer_role != 'doctor'
      OR NOT EXISTS (
        SELECT 1 FROM session_schedule ss
        WHERE ss.trainer_id = ts.trainer_id
          AND ss.client_id = ts.client_id
          AND DATE(ss.scheduled_datetime) = DATE(ts.scheduled_at)
          AND ss.modality = ANY(trainer_modalities)
      )
    )
  ),
  first_assignments AS (
    SELECT
      p.id as tid,
      MIN(DATE(tc.assigned_at)) as first_assignment
    FROM profiles p
    LEFT JOIN trainer_clients tc ON tc.trainer_id = p.id
    WHERE p.role IN ('trainer', 'doctor')
      AND COALESCE(p.managers, false) = false
      AND p.id <> ALL(excluded_trainer_ids)
    GROUP BY p.id
  ),
  qhp_counts AS (
    SELECT ca.coach_id, COUNT(*) as cnt
    FROM coach_assessment ca
    WHERE ca.coach_id IN (
      SELECT p2.id FROM profiles p2
      WHERE p2.role IN ('trainer', 'doctor')
        AND COALESCE(p2.managers, false) = false
        AND p2.id <> ALL(excluded_trainer_ids)
    )
      AND ca.completed IS NOT NULL
      AND ca.assessment_date >= start_date
      AND ca.assessment_date <= end_date
    GROUP BY ca.coach_id
  )
  SELECT
    p.id as trainer_id,
    CONCAT(p.first_name, ' ', p.last_name) as trainer_name,
    COALESCE(SUM(CASE WHEN fs.is_on_time THEN 1 ELSE 0 END), 0)::bigint as session_count,
    COALESCE(SUM(CASE
      WHEN DATE(fs.scheduled_at) >= late_tracking_start_date AND NOT fs.is_on_time THEN 1
      ELSE 0
    END), 0)::bigint as late_session_count,
    fa.first_assignment as first_assignment_date,
    COALESCE(qc.cnt, 0)::bigint as qhp_count
  FROM profiles p
  LEFT JOIN filtered_sessions fs ON fs.trainer_id = p.id
  LEFT JOIN first_assignments fa ON fa.tid = p.id
  LEFT JOIN qhp_counts qc ON qc.coach_id = p.id
  WHERE p.role IN ('trainer', 'doctor')
    AND COALESCE(p.managers, false) = false
    AND p.id <> ALL(excluded_trainer_ids)
  GROUP BY p.id, p.first_name, p.last_name, fa.first_assignment, qc.cnt
  HAVING COALESCE(SUM(CASE WHEN fs.is_on_time THEN 1 ELSE 0 END), 0) > 0
      OR COALESCE(SUM(CASE WHEN DATE(fs.scheduled_at) >= late_tracking_start_date AND NOT fs.is_on_time THEN 1 ELSE 0 END), 0) > 0
      OR COALESCE(qc.cnt, 0) > 0
  ORDER BY session_count DESC, trainer_name ASC;
END;
$function$;

-- Verify (September 2026): Ziaur Rehman should move from 47 to 48.
-- select trainer_name, session_count from get_trainer_leaderboard('2026-09-01','2026-09-30') where trainer_name like 'Ziaur%';
