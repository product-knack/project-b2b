-- NOTE: SUPERSEDED by crew_adopt_logged_sessions.sql (adds the adopt-logged
-- rule on top of the replace rule). Do not re-run this file.

-- ============ My Crew: manager/HOD Add Session follows the replace rule ============
-- Old behavior: plan_manager_add_session refused ('exists') when the member had
-- ANY non-cancelled session with that client that day — even an old CRM row
-- that isn't on the plan card (dead-end advice), or an already-LOGGED morning
-- session (blocking a legitimate second session).
--
-- New behavior, consistent with plan sharing:
--   * a CREW-created session already exists for member+client+day -> 'exists'
--     (it IS on the card — RESCHEDULE is the right tool; never stack a second)
--   * old NON-crew UNLOGGED session(s) -> DELETED, new crew session created
--     (the crew booking supersedes stale roster rows)
--   * old NON-crew LOGGED/completed session -> KEPT (history is sacred), and
--     the new crew session is created alongside (second session that day)
--   * exact-datetime collision with another member -> 'conflict' (unchanged)
-- Returns gained 'replaced_prev' (count of deleted stale rows).
--
-- Supersedes plan_manager_add_session from plan_roster_sync_migration.sql —
-- do not re-run that file's copy. Run this file once in the SQL editor.

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
  -- caller must be the MANAGER of this row (current window), or the physio HOD
  -- adding for a doctor member.
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
