-- NOTE: plan_sync_roster below is SUPERSEDED by crew_replaces_prev_sessions.sql
-- and plan_manager_add_session by crew_add_session_replaces.sql (both follow
-- the replace rule now). Do not re-run either from this file; only
-- plan_manager_reschedule here is still current.

-- ============ Team Messenger ↔ session_schedule sync — migration ============
-- Two SECURITY DEFINER RPCs. Run in the Supabase SQL editor (idempotent).
--
-- 1) plan_sync_roster: when a trainer shares/updates their day plan, each entry
--    becomes a NEW session_schedule row. Pre-existing sessions are IGNORED, not
--    linked (the old future roster is being deleted at go-live; Team Messenger
--    plans are the roster source from then on). The ONLY lookup is against rows
--    this feature itself created (notes marker) so a re-shared plan UPDATES its
--    own rows instead of duplicating them. Exact-duplicate inserts (unique
--    violation) come back as 'conflict'.
-- 2) plan_manager_reschedule: a manager's edit in Team Messenger is a REAL
--    reschedule — scheduled_datetime/modality updated, manager id stored in
--    reschedule_approved_by, remark stored in notes + reschedule_request,
--    status marked approved/processed (visible in CRM reschedule history).
--
-- Both enforce: caller must belong to the manager_score row (current window).

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
  v_out jsonb := '[]'::jsonb;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  -- caller must be a CURRENT member of this competition row (window enforced),
  -- OR the physio HOD (she is a doctor with her own sessions but no membership).
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
    v_dt := (p_date::text || ' ' || (e->>'time') || ':00')::timestamp at time zone 'Asia/Kolkata';

    -- ONLY look at rows this feature itself created (idempotent re-share);
    -- any other pre-existing session is ignored entirely — never linked.
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
      begin
        insert into session_schedule (trainer_id, client_id, scheduled_datetime, modality, status, notes)
          values (v_uid, (e->>'client_id')::uuid, v_dt, nullif(e->>'modality', ''), 'scheduled', 'Created from Team Messenger day plan')
          returning id into v_id;
        v_result := 'created';
      exception when unique_violation then
        v_id := null;
        v_result := 'conflict'; -- exact same client+datetime row already exists
      end;
    end if;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'client_id', e->>'client_id', 'schedule_id', v_id, 'result', v_result));
  end loop;
  return v_out;
end $$;
revoke all on function public.plan_sync_roster(uuid, date, jsonb) from public;
grant execute on function public.plan_sync_roster(uuid, date, jsonb) to authenticated;

create or replace function public.plan_manager_reschedule(
  p_score uuid,
  p_schedule uuid,
  p_date date,
  p_time text,       -- 'HH:mm' IST
  p_modality text,   -- null = keep
  p_remark text      -- null = none
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_row record;
  v_dt timestamptz;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  -- caller must be the MANAGER of this competition row (current window)
  if not exists (
    select 1 from manager_score ms where ms.id = p_score
      and ms.manager_id = v_uid
      and ms.team_start <= (now() at time zone 'Asia/Kolkata')::date
      and (ms.team_end is null or ms.team_end >= (now() at time zone 'Asia/Kolkata')::date)
  ) then
    raise exception 'only the team manager can reschedule';
  end if;

  select * into v_row from session_schedule where id = p_schedule;
  if not found then raise exception 'session not found'; end if;
  -- the row's trainer must be a current member of the SAME team row
  if not exists (
    select 1 from manager_score ms where ms.id = p_score
      and (ms.manager_id = v_row.trainer_id or ms.team_json ? v_row.trainer_id::text)
  ) then
    raise exception 'session does not belong to this team';
  end if;
  if v_row.status = 'cancelled' then raise exception 'session is cancelled'; end if;
  if v_row.workout_session_id is not null then raise exception 'session is already logged'; end if;

  v_dt := (p_date::text || ' ' || p_time || ':00')::timestamp at time zone 'Asia/Kolkata';

  -- double-booking guard for the new slot — scoped to PLAN-CREATED rows only,
  -- so stale legacy sessions (pending deletion at go-live) can never block.
  if exists (
    select 1 from session_schedule ss
      where ss.client_id = v_row.client_id and ss.id <> p_schedule
        and coalesce(ss.notes, '') like 'Created from Team Messenger%'
        and ss.scheduled_datetime between v_dt - interval '60 minutes' and v_dt + interval '60 minutes'
        and (ss.status is null or ss.status not in ('cancelled'))
  ) then
    raise exception 'client already has a session within 60 minutes of that slot';
  end if;

  update session_schedule set
    scheduled_datetime = v_dt,
    modality = coalesce(nullif(p_modality, ''), modality),
    reschedule_status = 'approved',
    reschedule_processed_at = now(),
    reschedule_approved_by = v_uid,
    reschedule_request = 'Manager reschedule via Team Messenger' || case when nullif(p_remark, '') is not null then ': ' || p_remark else '' end,
    notes = case when nullif(p_remark, '') is not null then p_remark else notes end
  where id = p_schedule;

  return jsonb_build_object(
    'schedule_id', p_schedule,
    'old_datetime', v_row.scheduled_datetime,
    'new_datetime', v_dt);
end $$;
revoke all on function public.plan_manager_reschedule(uuid, uuid, date, text, text, text) from public;
grant execute on function public.plan_manager_reschedule(uuid, uuid, date, text, text, text) to authenticated;

-- 3) plan_manager_add_session: the MANAGER adds a session into any member's
--    day. Inserts the real session_schedule row under the MEMBER's trainer_id
--    (same provenance note as plan rows, so the member's own re-share converges
--    on it instead of duplicating). Exact-duplicate -> {result:'conflict'}.
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
  v_dt timestamptz;
  v_id uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not exists (
    select 1 from manager_score ms where ms.id = p_score
      and ms.manager_id = v_uid
      and ms.team_start <= (now() at time zone 'Asia/Kolkata')::date
      and (ms.team_end is null or ms.team_end >= (now() at time zone 'Asia/Kolkata')::date)
  ) then
    raise exception 'only the team manager can add sessions';
  end if;
  if not exists (
    select 1 from manager_score ms where ms.id = p_score
      and (ms.manager_id = p_trainer or ms.team_json ? p_trainer::text)
  ) then
    raise exception 'trainer is not a member of this team';
  end if;
  -- ONE session per trainer+client per IST day: if any non-cancelled session
  -- already exists for this pair that day, refuse with 'exists' (the manager
  -- should RESCHEDULE the existing one instead of stacking a second).
  if exists (
    select 1 from session_schedule ss
      where ss.trainer_id = p_trainer and ss.client_id = p_client
        and ss.scheduled_datetime >= (p_date::text || ' 00:00:00')::timestamp at time zone 'Asia/Kolkata'
        and ss.scheduled_datetime <  ((p_date + 1)::text || ' 00:00:00')::timestamp at time zone 'Asia/Kolkata'
        and (ss.status is null or ss.status not in ('cancelled'))
  ) then
    return jsonb_build_object('schedule_id', null, 'result', 'exists');
  end if;
  v_dt := (p_date::text || ' ' || p_time || ':00')::timestamp at time zone 'Asia/Kolkata';
  begin
    insert into session_schedule (trainer_id, client_id, scheduled_datetime, modality, status, notes)
      values (p_trainer, p_client, v_dt, nullif(p_modality, ''), 'scheduled', 'Created from Team Messenger day plan (added by manager)')
      returning id into v_id;
  exception when unique_violation then
    return jsonb_build_object('schedule_id', null, 'result', 'conflict');
  end;
  return jsonb_build_object('schedule_id', v_id, 'result', 'created');
end $$;
revoke all on function public.plan_manager_add_session(uuid, uuid, uuid, date, text, text) from public;
grant execute on function public.plan_manager_add_session(uuid, uuid, uuid, date, text, text) to authenticated;
