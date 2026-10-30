-- ============ My Crew: manager Add Session, Force create over a client clash ============
-- DO NOT RE-RUN (30 Oct 2026). This is the 23 Sep 2026 text. The live function is in hub-track
-- supabase/migrations/20261030190000_plan_expired_notice.sql: the same body plus the expired-plan
-- gate (20261028100000), which now refuses with a plain sentence ("Sadhvi's Strength plan expired
-- on 30 Oct 2026. The session was not added to the roster. Make a new plan and get it approved
-- first."). Running this file would remove that gate.
-- 23 Sep 2026. plan_manager_add_session answered {result:'conflict'} and stopped whenever
-- the client already had an ACTIVE session at that exact datetime with another trainer
-- (unique index uniq_session_schedule_client_datetime_active on (client_id,
-- scheduled_datetime) where status is distinct from 'cancelled'; migration 20260520090027
-- in hub-track). The app now shows a warning with a Force create button instead of a dead
-- end. This version adds p_force (default false, so the current store build keeps working):
--   * the conflict reply names who holds the clash: conflict = {schedule_id, trainer_id,
--     trainer_name, modality, status, logged, source 'crew' | 'roster'};
--   * p_force = true cancels that clashing row (status 'cancelled', canceled_by 'Trainer',
--     cancellation_remark says why, updated_at) and then creates the crew session; the reply
--     carries forced = true and cancelled = the same conflict object;
--   * a LOGGED clash (workout_session_id set or status 'completed') is never cancelled:
--     result 'conflict' with force_blocked = 'logged'.
-- Same-member rules are unchanged: crew row that day -> 'exists'; stale unlogged non-crew
-- rows -> deleted (replaced_prev); a logged non-crew row -> 'adopted'; else insert.
-- Supersedes plan_manager_add_session from therapist_role_migration.sql (HOD arm for
-- doctors and therapists kept). Run once in the SQL editor.

-- The signature changes, so the old overload must go first: with both present PostgREST
-- could not pick one for a 6-argument call (PGRST203).
drop function if exists public.plan_manager_add_session(uuid, uuid, uuid, date, text, text);

create or replace function public.plan_manager_add_session(
  p_score uuid,
  p_trainer uuid,
  p_client uuid,
  p_date date,
  p_time text,      -- 'HH:mm' IST
  p_modality text,
  p_force boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_dt timestamptz;
  v_id uuid;
  v_replaced int := 0;
  v_clash record;
  v_has_clash boolean := false;
  v_clash_json jsonb := null;
  v_member_name text;
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
      and exists (select 1 from profiles p where p.id = p_trainer and p.role in ('doctor', 'therapist'))
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

  -- 1. This member already has a crew session with the client that day: nothing to add.
  if exists (
    select 1 from session_schedule ss
      where ss.trainer_id = p_trainer and ss.client_id = p_client
        and ss.scheduled_datetime >= v_day_start and ss.scheduled_datetime < v_day_end
        and coalesce(ss.notes, '') like 'Created from Team Messenger%'
        and (ss.status is null or ss.status not in ('cancelled'))
  ) then
    return jsonb_build_object('schedule_id', null, 'result', 'exists');
  end if;

  -- 2. Replace: the member's stale, unlogged, non-crew rows for that client that day.
  delete from session_schedule ss
    where ss.trainer_id = p_trainer and ss.client_id = p_client
      and ss.scheduled_datetime >= v_day_start and ss.scheduled_datetime < v_day_end
      and coalesce(ss.notes, '') not like 'Created from Team Messenger%'
      and ss.workout_session_id is null
      and (ss.status is null or ss.status not in ('cancelled', 'completed'));
  get diagnostics v_replaced = row_count;

  -- 3. Adopt: the member already logged a session with that client that day.
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

  -- 4. Clash: another trainer's active session with this client at the exact datetime
  --    (the unique index would refuse the insert). Name it, and only cancel it on force.
  select ss.id, ss.trainer_id, ss.modality, ss.status, ss.notes,
         (ss.workout_session_id is not null or ss.status = 'completed') as logged,
         nullif(trim(concat_ws(' ', p.first_name, p.last_name)), '') as trainer_name
    into v_clash
    from session_schedule ss
    left join profiles p on p.id = ss.trainer_id
   where ss.client_id = p_client and ss.scheduled_datetime = v_dt
     and (ss.status is null or ss.status <> 'cancelled')
   order by ss.scheduled_datetime, ss.id
   limit 1;
  v_has_clash := found;

  if v_has_clash then
    v_clash_json := jsonb_build_object(
      'schedule_id', v_clash.id,
      'trainer_id', v_clash.trainer_id,
      'trainer_name', v_clash.trainer_name,
      'modality', v_clash.modality,
      'status', v_clash.status,
      'logged', v_clash.logged,
      'source', case when coalesce(v_clash.notes, '') like 'Created from Team Messenger%' then 'crew' else 'roster' end);
    if not coalesce(p_force, false) then
      return jsonb_build_object('schedule_id', null, 'result', 'conflict', 'replaced_prev', v_replaced, 'conflict', v_clash_json);
    end if;
    if v_clash.logged then
      -- A logged session is a record of work done; force never cancels it.
      return jsonb_build_object('schedule_id', null, 'result', 'conflict', 'replaced_prev', v_replaced, 'conflict', v_clash_json, 'force_blocked', 'logged');
    end if;
    select nullif(trim(concat_ws(' ', p.first_name, p.last_name)), '') into v_member_name from profiles p where p.id = p_trainer;
    update session_schedule ss
       set status = 'cancelled',
           canceled_by = 'Trainer',   -- the CHECK constraint allows 'Client' or 'Trainer' only
           cancellation_remark = 'Replaced by the team manager: crew session with '
                                 || coalesce(v_member_name, 'a team member') || ' at the same time (force add)',
           updated_at = now()
     where ss.id = v_clash.id;
  end if;

  -- 5. Create.
  begin
    insert into session_schedule (trainer_id, client_id, scheduled_datetime, modality, status, notes)
      values (p_trainer, p_client, v_dt, nullif(p_modality, ''), 'scheduled', 'Created from Team Messenger day plan (added by manager)')
      returning id into v_id;
  exception when unique_violation then
    -- Raced by a booking made between the clash check and the insert.
    return jsonb_build_object('schedule_id', null, 'result', 'conflict', 'replaced_prev', v_replaced, 'conflict', v_clash_json);
  end;
  return jsonb_build_object(
    'schedule_id', v_id, 'result', 'created', 'replaced_prev', v_replaced,
    'forced', v_has_clash, 'cancelled', v_clash_json);
end $$;

revoke all on function public.plan_manager_add_session(uuid, uuid, uuid, date, text, text, boolean) from public, anon, authenticated;
grant execute on function public.plan_manager_add_session(uuid, uuid, uuid, date, text, text, boolean) to authenticated;

-- Verify: exactly one overload, with the boolean at the end.
select p.proname, pg_get_function_identity_arguments(p.oid) as args
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'plan_manager_add_session';
