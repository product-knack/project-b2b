-- ============ My Crew: card state readers (cross-member visibility) ============
-- The day-plan card computes logged/missed per entry from session_schedule and
-- training_sessions. RLS scopes both tables to YOUR OWN clients — so a manager
-- (or any teammate) reading another member's section silently got zero rows and
-- the card showed sessions as pending/missed even when they were logged
-- (live case: Sameer Gupta @ Faizan, logged + linked, invisible to Sagar).
--
-- Two SECURITY DEFINER readers fix it. Guard: caller must be (or have been) a
-- competition-team participant, or the physio HOD. Run once in the SQL editor.

-- 1) Roster rows for plan entries (times/status/logged/missed remarks).
create or replace function public.crew_sched_rows(p_ids uuid[])
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_out jsonb;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not (
    exists (select 1 from manager_score ms where ms.manager_id = v_uid or ms.team_json ? v_uid::text)
    or is_physio_hod(v_uid)
  ) then
    raise exception 'not a team participant';
  end if;
  select coalesce(jsonb_object_agg(ss.id, jsonb_build_object(
    'scheduled_datetime', ss.scheduled_datetime,
    'modality', ss.modality,
    'status', ss.status,
    'logged', (ss.workout_session_id is not null or ss.status = 'completed'),
    'missed_remarks', ss.missed_remarks
  )), '{}'::jsonb)
  into v_out
  from session_schedule ss
  where ss.id = any(p_ids);
  return v_out;
end $$;
revoke all on function public.crew_sched_rows(uuid[]) from public;
grant execute on function public.crew_sched_rows(uuid[]) to authenticated;

-- 2) Completed sessions for the card's clients on one IST date — the outcome
--    source. Returns [{client_id, trainer_id, at}] so the app can keep its
--    trainer-scoped done rule (only the section owner's log counts).
create or replace function public.crew_plan_outcome(p_date date, p_clients uuid[])
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_out jsonb;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not (
    exists (select 1 from manager_score ms where ms.manager_id = v_uid or ms.team_json ? v_uid::text)
    or is_physio_hod(v_uid)
  ) then
    raise exception 'not a team participant';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'client_id', t.client_id, 'trainer_id', t.trainer_id, 'at', t.scheduled_at
  )), '[]'::jsonb)
  into v_out
  from training_sessions t
  where t.client_id = any(p_clients)
    and t.status = 'completed'
    and coalesce(t.cancelled, false) = false
    and t.scheduled_at >= (p_date::text || ' 00:00:00')::timestamp at time zone 'Asia/Kolkata'
    and t.scheduled_at <  ((p_date + 1)::text || ' 00:00:00')::timestamp at time zone 'Asia/Kolkata';
  return v_out;
end $$;
revoke all on function public.crew_plan_outcome(date, uuid[]) from public;
grant execute on function public.crew_plan_outcome(date, uuid[]) to authenticated;
