-- ============ Therapist: log a session v2.1 (RUN THIS WHOLE FILE) ============
-- Fixes the recurring session_schedule_status_check error: the DB was still
-- running v1, which inserted a session_schedule row with status 'completed' —
-- but that column's CHECK allows ONLY scheduled/cancelled/confirmed.
-- "Logged" is NOT a status: it is the workout_session_id link (what My Crew
-- and every roster reader checks). v2.1:
--   1. insert the training_sessions row (source of truth) — status 'completed'
--      is valid THERE, just not on session_schedule
--   2. today's UNLOGGED scheduled row for that client (crew rows included)
--      -> stamp its workout_session_id with the training-session id => LOGGED
--   3. else insert a now()-stamped roster row with status 'scheduled' and the
--      workout_session_id already set (reads as completed via the link)
--   4. the whole roster step is best-effort: if it ever fails, the session
--      still saves and the error text comes back in the result for diagnosis
-- (The one-time Shiv test-data wipe that used to be part 2 of this file has
-- been removed — do NOT wipe again, it would delete the new test sessions.)

create or replace function public.therapist_log_session(
  p_client uuid,
  p_duration int,
  p_note text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_ts uuid;
  v_sched uuid;
  v_linked boolean := false;
  v_roster_err text := null;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from profiles p where p.id = v_uid and p.role = 'therapist') then
    raise exception 'only therapists can log therapy sessions';
  end if;
  if nullif(trim(coalesce(p_note, '')), '') is null then raise exception 'session note is required'; end if;
  if coalesce(p_duration, 0) <= 0 then raise exception 'duration must be greater than 0'; end if;
  if not exists (
    select 1 from trainer_clients tc
    where tc.trainer_id = v_uid and tc.client_id = p_client and tc.actively_training = true
  ) then
    raise exception 'client is not assigned to you';
  end if;

  insert into training_sessions (client_id, trainer_id, session_type, scheduled_at, duration_minutes, status, attendance_marked, location, therapist_notes)
    values (p_client, v_uid, 'therapy', v_now, p_duration, 'completed', true, 'Therapy', trim(p_note))
    returning id into v_ts;

  v_day_start := (( v_now at time zone 'Asia/Kolkata')::date::text || ' 00:00:00')::timestamp at time zone 'Asia/Kolkata';
  v_day_end   := (((v_now at time zone 'Asia/Kolkata')::date + 1)::text || ' 00:00:00')::timestamp at time zone 'Asia/Kolkata';

  -- Roster step is best-effort: never let it fail the actual session log.
  begin
    -- Link today's scheduled (crew) session instead of duplicating the roster.
    select ss.id into v_sched from session_schedule ss
      where ss.trainer_id = v_uid and ss.client_id = p_client
        and ss.scheduled_datetime >= v_day_start and ss.scheduled_datetime < v_day_end
        and ss.workout_session_id is null
        and (ss.status is null or ss.status not in ('cancelled'))
      order by ss.scheduled_datetime limit 1;
    if v_sched is not null then
      update session_schedule set workout_session_id = v_ts::text where id = v_sched;
      v_linked := true;
    else
      insert into session_schedule (trainer_id, client_id, scheduled_datetime, modality, session_type, status, notes, workout_session_id)
        values (v_uid, p_client, v_now, 'Therapy', 'therapy', 'scheduled', trim(p_note), v_ts::text)
        returning id into v_sched;
    end if;
  exception when others then
    v_roster_err := SQLERRM;
  end;

  -- Best-effort back-link on the training row.
  if v_sched is not null then
    begin
      update training_sessions set schedule_session_id = v_sched::text where id = v_ts;
    exception when others then null;
    end;
  end if;

  return jsonb_build_object('session_id', v_ts, 'schedule_id', v_sched, 'linked_scheduled', v_linked, 'roster_error', v_roster_err);
end $$;
revoke all on function public.therapist_log_session(uuid, int, text) from public;
grant execute on function public.therapist_log_session(uuid, int, text) to authenticated;

-- Proof the new version is live (must return one row: is_v2 = true).
select p.proname, p.prosrc like '%v_roster_err%' as is_v2
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'therapist_log_session';
