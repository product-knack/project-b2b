-- ============ Therapist role — crew/HOD integration ============
-- Therapists are doctor-LIKE in My Crew: they sit in a competition team (the
-- manager sees their sections VIEW-ONLY) and the physio HOD holds the
-- authority (reschedule / approve requests / missed remarks) — exactly the
-- doctor treatment. The three HOD RPCs and the manager-add HOD arm checked
-- p.role = 'doctor'; this widens them to ('doctor', 'therapist').
-- Everything else (RLS on training_sessions/session_schedule/clients for the
-- therapist role) already exists from the web build. Run once.
--
-- Supersedes: the three HOD fns from physio_hod_migration.sql and
-- plan_manager_add_session from crew_adopt_logged_sessions.sql.

create or replace function public.hod_doctor_reschedule(
  p_schedule uuid,
  p_date date,
  p_time text,       -- 'HH:mm' IST
  p_modality text,   -- null = keep
  p_remark text      -- required
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_row record;
  v_dt timestamptz;
  v_team uuid;
  v_client_name text;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not is_physio_hod(v_uid) then raise exception 'only the physio HOD can do this'; end if;
  if nullif(p_remark, '') is null then raise exception 'reason is required'; end if;

  select * into v_row from session_schedule where id = p_schedule;
  if not found then raise exception 'session not found'; end if;
  if not exists (select 1 from profiles p where p.id = v_row.trainer_id and p.role in ('doctor', 'therapist')) then
    raise exception 'session does not belong to a doctor or therapist';
  end if;
  if v_row.status = 'cancelled' then raise exception 'session is cancelled'; end if;
  if v_row.workout_session_id is not null then raise exception 'session is already logged'; end if;

  v_dt := (p_date::text || ' ' || p_time || ':00')::timestamp at time zone 'Asia/Kolkata';

  update session_schedule set
    scheduled_datetime = v_dt,
    modality = coalesce(nullif(p_modality, ''), modality),
    reschedule_status = 'approved',
    reschedule_processed_at = now(),
    reschedule_approved_by = v_uid,
    reschedule_request = 'Physio HOD reschedule via Team Messenger: ' || p_remark
  where id = p_schedule;

  select ms.id into v_team from manager_score ms
    where (ms.manager_id = v_row.trainer_id or ms.team_json ? v_row.trainer_id::text)
      and ms.team_start <= (now() at time zone 'Asia/Kolkata')::date
      and (ms.team_end is null or ms.team_end >= (now() at time zone 'Asia/Kolkata')::date)
    order by ms.team_start desc limit 1;
  if v_team is not null then
    select trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')) into v_client_name
      from clients where id = v_row.client_id;
    insert into manager_team_messages (team_id, sender_id, kind, payload, body)
      values (
        v_team, v_uid, 'plan_time_edit',
        jsonb_build_object(
          'date', p_date, 'client_id', v_row.client_id, 'name', coalesce(v_client_name, 'Client'),
          'trainer_id', v_row.trainer_id, 'time', p_time, 'modality', nullif(p_modality, ''),
          'schedule_id', p_schedule, 'remark', p_remark, 'by_hod', true
        ),
        'Physio HOD moved ' || coalesce(v_client_name, 'Client') || ' to ' ||
        to_char(v_dt at time zone 'Asia/Kolkata', 'FMHH12:MI AM') || ' (' || p_remark || ')'
      );
  end if;
  return jsonb_build_object('schedule_id', p_schedule, 'new_datetime', v_dt);
end $$;
revoke all on function public.hod_doctor_reschedule(uuid, date, text, text, text) from public;
grant execute on function public.hod_doctor_reschedule(uuid, date, text, text, text) to authenticated;

create or replace function public.hod_act_on_request(
  p_request uuid,
  p_approve boolean
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_msg record;
  v_dt timestamptz;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not is_physio_hod(v_uid) then raise exception 'only the physio HOD can do this'; end if;
  select * into v_msg from manager_team_messages where id = p_request and kind = 'plan_reschedule_request';
  if not found then raise exception 'request not found'; end if;
  if not exists (select 1 from profiles p where p.id = (v_msg.payload->>'trainer_id')::uuid and p.role in ('doctor', 'therapist')) then
    raise exception 'request does not belong to a doctor or therapist';
  end if;

  if p_approve then
    if v_msg.payload->>'schedule_id' is not null then
      v_dt := ((v_msg.payload->>'date') || ' ' || (v_msg.payload->>'to_time') || ':00')::timestamp at time zone 'Asia/Kolkata';
      update session_schedule set
        scheduled_datetime = v_dt,
        modality = coalesce(nullif(v_msg.payload->>'to_modality', ''), modality),
        reschedule_status = 'approved',
        reschedule_processed_at = now(),
        reschedule_approved_by = v_uid,
        reschedule_request = 'Physio HOD approved chat request'
      where id = (v_msg.payload->>'schedule_id')::uuid
        and (status is null or status <> 'cancelled') and workout_session_id is null;
    end if;
    insert into manager_team_messages (team_id, sender_id, kind, payload, body)
      values (
        v_msg.team_id, v_uid, 'plan_time_edit',
        v_msg.payload || jsonb_build_object('time', v_msg.payload->>'to_time', 'modality', v_msg.payload->>'to_modality', 'request_id', p_request, 'remark', coalesce(v_msg.payload->>'reason', 'Approved by physio HOD'), 'by_hod', true),
        'Physio HOD approved · ' || coalesce(v_msg.payload->>'name', 'session') || ' moved to ' || coalesce(v_msg.payload->>'to_time', '?')
      );
  else
    insert into manager_team_messages (team_id, sender_id, kind, payload, body)
      values (
        v_msg.team_id, v_uid, 'plan_reschedule_decision',
        jsonb_build_object('request_id', p_request, 'approved', false, 'date', v_msg.payload->>'date', 'client_id', v_msg.payload->>'client_id', 'name', v_msg.payload->>'name', 'trainer_id', v_msg.payload->>'trainer_id', 'by_hod', true),
        'Physio HOD rejected · reschedule request for ' || coalesce(v_msg.payload->>'name', 'session')
      );
  end if;
  return jsonb_build_object('approved', p_approve);
end $$;
revoke all on function public.hod_act_on_request(uuid, boolean) from public;
grant execute on function public.hod_act_on_request(uuid, boolean) to authenticated;

create or replace function public.hod_doctor_missed_remark(
  p_schedule uuid,
  p_category text,
  p_remark text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_row record;
  v_name text;
  v_entry jsonb;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not is_physio_hod(v_uid) then raise exception 'only the physio HOD can do this'; end if;
  if nullif(p_remark, '') is null then raise exception 'remark is required'; end if;
  select * into v_row from session_schedule where id = p_schedule;
  if not found then raise exception 'session not found'; end if;
  if not exists (select 1 from profiles p where p.id = v_row.trainer_id and p.role in ('doctor', 'therapist')) then
    raise exception 'session does not belong to a doctor or therapist';
  end if;
  select trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')) into v_name
    from profiles where id = v_uid;
  v_entry := jsonb_build_object(
    'at', now(), 'by', v_uid, 'by_name', coalesce(nullif(v_name, ''), 'Physio HOD'),
    'by_role', 'physio_hod', 'category', coalesce(nullif(p_category, ''), 'other'), 'remark', p_remark
  );
  update session_schedule
    set missed_remarks = coalesce(missed_remarks, '[]'::jsonb) || jsonb_build_array(v_entry)
    where id = p_schedule;
  return v_entry;
end $$;
revoke all on function public.hod_doctor_missed_remark(uuid, text, text) from public;
grant execute on function public.hod_doctor_missed_remark(uuid, text, text) to authenticated;

-- Manager/HOD Add Session (adopt + replace rules unchanged) — HOD arm now
-- covers therapists too.
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

  if exists (
    select 1 from session_schedule ss
      where ss.trainer_id = p_trainer and ss.client_id = p_client
        and ss.scheduled_datetime >= v_day_start and ss.scheduled_datetime < v_day_end
        and coalesce(ss.notes, '') like 'Created from Team Messenger%'
        and (ss.status is null or ss.status not in ('cancelled'))
  ) then
    return jsonb_build_object('schedule_id', null, 'result', 'exists');
  end if;

  delete from session_schedule ss
    where ss.trainer_id = p_trainer and ss.client_id = p_client
      and ss.scheduled_datetime >= v_day_start and ss.scheduled_datetime < v_day_end
      and coalesce(ss.notes, '') not like 'Created from Team Messenger%'
      and ss.workout_session_id is null
      and (ss.status is null or ss.status not in ('cancelled', 'completed'));
  get diagnostics v_replaced = row_count;

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
