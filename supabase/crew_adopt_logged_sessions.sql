-- ============ My Crew: ADOPT already-logged sessions (the "Malti case") ============
-- When a member shares their day plan, or a manager/HOD adds a session, and the
-- member ALREADY has a LOGGED (done) session with that client on that IST day
-- that is not crew-linked, the flows now ADOPT that session — link its real
-- schedule row into the plan — instead of creating a duplicate row next to it.
--
-- Full decision order for both flows (member+client+day):
--   1. crew row exists            -> plan share updates it / add returns 'exists'
--   2. stale UNLOGGED non-crew    -> deleted (replace rule, unchanged)
--   3. LOGGED/completed non-crew  -> ADOPTED: its id is returned with
--                                    result 'adopted'; nothing created/changed
--   4. else                       -> new crew session created (unchanged)
-- Logged history is never modified; adoption only links it onto the card.
--
-- Supersedes plan_sync_roster from crew_replaces_prev_sessions.sql and
-- plan_manager_add_session from crew_add_session_replaces.sql.
-- Run this whole file once in the SQL editor.

create or replace function public.plan_sync_roster(
  p_score uuid,
  p_date date,
  p_entries jsonb  -- [{client_id, time 'HH:mm', modality}]
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  e jsonb;
  v_dt timestamptz;
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_row record;
  v_id uuid;
  v_result text;
  v_replaced int;
  v_out jsonb := '[]'::jsonb;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not (
    exists (
      select 1 from manager_score ms where ms.id = p_score
        and (ms.manager_id = v_uid or ms.team_json ? v_uid::text)
        and ms.team_start <= (now() at time zone 'Asia/Kolkata')::date
        and (ms.team_end is null or ms.team_end >= (now() at time zone 'Asia/Kolkata')::date)
    )
    or is_physio_hod(v_uid)
  ) then
    raise exception 'not a current team member';
  end if;

  v_day_start := (p_date::text || ' 00:00:00')::timestamp at time zone 'Asia/Kolkata';
  v_day_end   := ((p_date + 1)::text || ' 00:00:00')::timestamp at time zone 'Asia/Kolkata';

  for e in select * from jsonb_array_elements(p_entries) loop
    v_id := null;

    -- Replace rule: stale UNLOGGED non-crew sessions are superseded.
    delete from session_schedule ss
      where ss.client_id = (e->>'client_id')::uuid
        and ss.trainer_id = v_uid
        and ss.scheduled_datetime >= v_day_start and ss.scheduled_datetime < v_day_end
        and coalesce(ss.notes, '') not like 'Created from Team Messenger%'
        and ss.workout_session_id is null
        and (ss.status is null or ss.status not in ('cancelled', 'completed'));
    get diagnostics v_replaced = row_count;

    v_dt := (p_date::text || ' ' || (e->>'time') || ':00')::timestamp at time zone 'Asia/Kolkata';

    -- Idempotent re-share: crew rows update in place.
    select id, scheduled_datetime into v_row from session_schedule
      where client_id = (e->>'client_id')::uuid
        and trainer_id = v_uid
        and scheduled_datetime >= v_day_start and scheduled_datetime < v_day_end
        and coalesce(notes, '') like 'Created from Team Messenger%'
        and (status is null or status not in ('cancelled'))
      order by scheduled_datetime limit 1;

    if found then
      v_id := v_row.id;
      update session_schedule
        set scheduled_datetime = v_dt,
            modality = coalesce(nullif(e->>'modality', ''), modality)
        where id = v_id;
      v_result := case when v_row.scheduled_datetime <> v_dt then 'moved' else 'updated' end;
    else
      -- ADOPT rule: an already-LOGGED session with this client today is the
      -- session — link it instead of creating a duplicate beside it.
      select id into v_id from session_schedule
        where client_id = (e->>'client_id')::uuid
          and trainer_id = v_uid
          and scheduled_datetime >= v_day_start and scheduled_datetime < v_day_end
          and coalesce(notes, '') not like 'Created from Team Messenger%'
          and (workout_session_id is not null or status = 'completed')
          and (status is null or status <> 'cancelled')
        order by scheduled_datetime limit 1;
      if v_id is not null then
        v_result := 'adopted';
      else
        begin
          insert into session_schedule (trainer_id, client_id, scheduled_datetime, modality, status, notes)
            values (v_uid, (e->>'client_id')::uuid, v_dt, nullif(e->>'modality', ''), 'scheduled', 'Created from Team Messenger day plan')
            returning id into v_id;
          v_result := 'created';
        exception when unique_violation then
          v_id := null;
          v_result := 'conflict'; -- another member's session at the exact same datetime
        end;
      end if;
    end if;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'client_id', e->>'client_id', 'schedule_id', v_id, 'result', v_result,
      'replaced_prev', coalesce(v_replaced, 0)));
  end loop;
  return v_out;
end $$;
revoke all on function public.plan_sync_roster(uuid, date, jsonb) from public;
grant execute on function public.plan_sync_roster(uuid, date, jsonb) to authenticated;

create or replace function public.plan_manager_add_session(
  p_score uuid,
  p_trainer uuid,
  p_client uuid,
  p_date date,
  p_time text,      -- 'HH:mm' IST
  p_modality text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_dt timestamptz;
  v_id uuid;
  v_replaced int := 0;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not (
    exists (
      select 1 from manager_score ms where ms.id = p_score
        and ms.manager_id = v_uid
        and ms.team_start <= (now() at time zone 'Asia/Kolkata')::date
        and (ms.team_end is null or ms.team_end >= (now() at time zone 'Asia/Kolkata')::date)
    )
    or (
      is_physio_hod(v_uid)
      and exists (select 1 from profiles p where p.id = p_trainer and p.role = 'doctor')
    )
  ) then
    raise exception 'only the team manager can add sessions';
  end if;
  if not exists (
    select 1 from manager_score ms where ms.id = p_score
      and (ms.manager_id = p_trainer or ms.team_json ? p_trainer::text)
  ) then
    raise exception 'trainer is not a member of this team';
  end if;

  v_day_start := (p_date::text || ' 00:00:00')::timestamp at time zone 'Asia/Kolkata';
  v_day_end   := ((p_date + 1)::text || ' 00:00:00')::timestamp at time zone 'Asia/Kolkata';

  -- A crew session already on the card: RESCHEDULE it, never stack another.
  if exists (
    select 1 from session_schedule ss
      where ss.trainer_id = p_trainer and ss.client_id = p_client
        and ss.scheduled_datetime >= v_day_start and ss.scheduled_datetime < v_day_end
        and coalesce(ss.notes, '') like 'Created from Team Messenger%'
        and (ss.status is null or ss.status not in ('cancelled'))
  ) then
    return jsonb_build_object('schedule_id', null, 'result', 'exists');
  end if;

  -- Stale non-crew UNLOGGED rows are superseded by the crew booking.
  delete from session_schedule ss
    where ss.trainer_id = p_trainer and ss.client_id = p_client
      and ss.scheduled_datetime >= v_day_start and ss.scheduled_datetime < v_day_end
      and coalesce(ss.notes, '') not like 'Created from Team Messenger%'
      and ss.workout_session_id is null
      and (ss.status is null or ss.status not in ('cancelled', 'completed'));
  get diagnostics v_replaced = row_count;

  -- ADOPT rule: an already-LOGGED session with this client today is mapped
  -- onto the card instead of creating a duplicate next to it.
  select ss.id into v_id from session_schedule ss
    where ss.trainer_id = p_trainer and ss.client_id = p_client
      and ss.scheduled_datetime >= v_day_start and ss.scheduled_datetime < v_day_end
      and coalesce(ss.notes, '') not like 'Created from Team Messenger%'
      and (ss.workout_session_id is not null or ss.status = 'completed')
      and (ss.status is null or ss.status <> 'cancelled')
    order by ss.scheduled_datetime limit 1;
  if v_id is not null then
    return jsonb_build_object('schedule_id', v_id, 'result', 'adopted', 'replaced_prev', v_replaced);
  end if;

  v_dt := (p_date::text || ' ' || p_time || ':00')::timestamp at time zone 'Asia/Kolkata';
  begin
    insert into session_schedule (trainer_id, client_id, scheduled_datetime, modality, status, notes)
      values (p_trainer, p_client, v_dt, nullif(p_modality, ''), 'scheduled', 'Created from Team Messenger day plan (added by manager)')
      returning id into v_id;
  exception when unique_violation then
    return jsonb_build_object('schedule_id', null, 'result', 'conflict', 'replaced_prev', v_replaced);
  end;
  return jsonb_build_object('schedule_id', v_id, 'result', 'created', 'replaced_prev', v_replaced);
end $$;
revoke all on function public.plan_manager_add_session(uuid, uuid, uuid, date, text, text) from public;
grant execute on function public.plan_manager_add_session(uuid, uuid, uuid, date, text, text) to authenticated;
