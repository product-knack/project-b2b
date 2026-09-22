-- ============ My Crew: client-acknowledgement flag on the day-plan card ============
-- Adds `acked` (training_sessions.session_acknowledged_at is set) to each row
-- returned by crew_plan_outcome, so the card can label logged sessions
-- ACKNOWLEDGED / NOT ACKNOWLEDGED for every viewer (same source as the
-- trainer Sessions page and the home ack card).
-- Supersedes crew_plan_outcome from crew_card_state_rpcs.sql. Run once.

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
    'client_id', t.client_id, 'trainer_id', t.trainer_id, 'at', t.scheduled_at,
    'acked', (t.session_acknowledged_at is not null)
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
