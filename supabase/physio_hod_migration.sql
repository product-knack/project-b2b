-- ============ Physio HOD authority — migration ============
-- Run in the Supabase SQL editor (idempotent).
--
-- The physio HOD (profiles.role_specialization contains 'physio_hod', currently
-- Anjana Odds) owns DOCTOR members' sessions in Team Messenger:
--  - doctor reschedule requests are acted on by the HOD, not the team manager;
--  - the HOD can reschedule any physio doctor's session and add remarks;
--  - the team manager keeps VIEW-ONLY access to doctor sections.
-- The HOD is not a team member, so: a read-policy extension lets her read team
-- threads, and SECURITY DEFINER RPCs perform her actions (roster + messages).

-- Helper: is this user the physio HOD? (::text cast keeps it type-agnostic
-- whether role_specialization is jsonb or text[].)
create or replace function public.is_physio_hod(p_user uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p
    where p.id = p_user and p.role_specialization::text ilike '%physio_hod%'
  );
$$;
revoke all on function public.is_physio_hod(uuid) from public;
grant execute on function public.is_physio_hod(uuid) to authenticated;

-- Read extension: the HOD can read every team thread (needed for the Physio
-- Day Plans screen + realtime). Recreates the SELECT policy with the extra arm.
drop policy if exists "mtm members read" on public.manager_team_messages;
create policy "mtm members read" on public.manager_team_messages
  for select to authenticated using (
    exists (
      select 1 from public.manager_score ms
      where ms.id = team_id
        and (ms.manager_id = auth.uid() or ms.team_json ? auth.uid()::text)
    )
    or public.was_participant(team_id, auth.uid())
    or public.is_physio_hod(auth.uid())
  );

-- HOD reschedules a physio doctor's session (mirrors plan_manager_reschedule,
-- but gated on HOD identity + doctor-owned session; posts the team notice as her).
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
  if not exists (select 1 from profiles p where p.id = v_row.trainer_id and p.role = 'doctor') then
    raise exception 'session does not belong to a doctor';
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

  -- Post the plan_time_edit into the DOCTOR's current team thread (if any),
  -- so the team card override + trail work exactly like a manager edit.
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

-- HOD acts on a doctor's reschedule request message (approve = move roster +
-- post approval; reject = post decision). One RPC, atomic.
create or replace function public.hod_act_on_request(
  p_request uuid,     -- manager_team_messages.id of the plan_reschedule_request
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
  if not exists (select 1 from profiles p where p.id = (v_msg.payload->>'trainer_id')::uuid and p.role = 'doctor') then
    raise exception 'request does not belong to a doctor';
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

-- HOD remark on a doctor's session — appended to session_schedule.missed_remarks
-- in the exact Today's Roster shape, by_role='physio_hod', so it renders
-- everywhere remarks already render.
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
  if not exists (select 1 from profiles p where p.id = v_row.trainer_id and p.role = 'doctor') then
    raise exception 'session does not belong to a doctor';
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

-- Team Flags: the HOD closes DOCTOR blocks (remark stored in the payload, same
-- update-in-place mechanism the manager uses). Policy recreated with a HOD arm;
-- app-side the HOD only ever touches doctor blocks, the manager only trainer
-- blocks (doctor blocks are view-only for the manager).
drop policy if exists "mtm manager closes team flags" on public.manager_team_messages;
create policy "mtm manager closes team flags" on public.manager_team_messages
  for update to authenticated
  using (
    kind = 'team_flags'
    and (
      exists (select 1 from public.manager_score ms where ms.id = team_id and ms.manager_id = auth.uid())
      or public.is_physio_hod(auth.uid())
    )
  )
  with check (
    kind = 'team_flags'
    and (
      exists (select 1 from public.manager_score ms where ms.id = team_id and ms.manager_id = auth.uid())
      or public.is_physio_hod(auth.uid())
    )
  );

-- HOD inside the SAME Team Messenger (no separate surface): she may post in
-- team threads (text + the manager-kinds she needs for doctor sections).
drop policy if exists "mtm current members post in window" on public.manager_team_messages;
create policy "mtm current members post in window" on public.manager_team_messages
  for insert to authenticated with check (
    sender_id = auth.uid()
    and (
      exists (
        select 1 from public.manager_score ms
        where ms.id = team_id
          and (ms.manager_id = auth.uid() or ms.team_json ? auth.uid()::text)
          and ms.team_start <= (now() at time zone 'Asia/Kolkata')::date
          and (ms.team_end is null or ms.team_end >= (now() at time zone 'Asia/Kolkata')::date)
      )
      or public.is_physio_hod(auth.uid())
    )
    and (
      kind not in ('plan_remark', 'plan_time_edit', 'plan_reschedule_decision', 'plan_add')
      or exists (
        select 1 from public.manager_score ms2
        where ms2.id = team_id and ms2.manager_id = auth.uid()
      )
      or public.is_physio_hod(auth.uid())
    )
  );

-- Manager add-session RPC: HOD may add sessions for DOCTOR members.
create or replace function public.plan_manager_add_session(
  p_score uuid,
  p_trainer uuid,
  p_client uuid,
  p_date date,
  p_time text,
  p_modality text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_dt timestamptz;
  v_id uuid;
  v_is_mgr boolean;
  v_is_hod boolean;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select exists (
    select 1 from manager_score ms where ms.id = p_score
      and ms.manager_id = v_uid
      and ms.team_start <= (now() at time zone 'Asia/Kolkata')::date
      and (ms.team_end is null or ms.team_end >= (now() at time zone 'Asia/Kolkata')::date)
  ) into v_is_mgr;
  v_is_hod := is_physio_hod(v_uid) and exists (select 1 from profiles p where p.id = p_trainer and p.role = 'doctor');
  if not (v_is_mgr or v_is_hod) then
    raise exception 'only the team manager (or the physio HOD for doctors) can add sessions';
  end if;
  if not exists (
    select 1 from manager_score ms where ms.id = p_score
      and (ms.manager_id = p_trainer or ms.team_json ? p_trainer::text)
  ) then
    raise exception 'trainer is not a member of this team';
  end if;
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

-- Team resolution for EVERY role: doctors (and the HOD) could not read
-- manager_score under its RLS, so the Team Messenger card never appeared for
-- them. The chat hooks now resolve teams through this definer function.
create or replace function public.messenger_teams()
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', ms.id,
    'team_name', ms.team_name,
    'manager_id', ms.manager_id,
    'team_json', ms.team_json,
    'team_start', ms.team_start,
    'team_end', ms.team_end
  ) order by ms.created_at desc), '[]'::jsonb)
  from manager_score ms;
$$;
revoke all on function public.messenger_teams() from public;
grant execute on function public.messenger_teams() to authenticated;

-- ============ ROLE-PROOF POLICIES (the doctor bug) ============
-- The message policies contained bare subqueries on manager_score. Policy
-- subqueries run AS THE CALLER, and manager_score RLS blocks doctor reads —
-- so doctors silently failed BOTH the SELECT (empty chat) and the INSERT
-- (plans posted nothing) while the definer RPCs kept writing roster rows.
-- These definer helpers make membership checks identical for every role.
create or replace function public.is_team_member_any(p_team uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from manager_score ms
    where ms.id = p_team and (ms.manager_id = p_user or ms.team_json ? p_user::text)
  );
$$;
create or replace function public.is_current_team_member(p_team uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from manager_score ms
    where ms.id = p_team and (ms.manager_id = p_user or ms.team_json ? p_user::text)
      and ms.team_start <= (now() at time zone 'Asia/Kolkata')::date
      and (ms.team_end is null or ms.team_end >= (now() at time zone 'Asia/Kolkata')::date)
  );
$$;
create or replace function public.is_team_manager(p_team uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from manager_score ms where ms.id = p_team and ms.manager_id = p_user);
$$;
revoke all on function public.is_team_member_any(uuid, uuid) from public;
revoke all on function public.is_current_team_member(uuid, uuid) from public;
revoke all on function public.is_team_manager(uuid, uuid) from public;
grant execute on function public.is_team_member_any(uuid, uuid) to authenticated;
grant execute on function public.is_current_team_member(uuid, uuid) to authenticated;
grant execute on function public.is_team_manager(uuid, uuid) to authenticated;

drop policy if exists "mtm members read" on public.manager_team_messages;
create policy "mtm members read" on public.manager_team_messages
  for select to authenticated using (
    public.is_team_member_any(team_id, auth.uid())
    or public.was_participant(team_id, auth.uid())
    or public.is_physio_hod(auth.uid())
  );

drop policy if exists "mtm current members post in window" on public.manager_team_messages;
create policy "mtm current members post in window" on public.manager_team_messages
  for insert to authenticated with check (
    sender_id = auth.uid()
    and (public.is_current_team_member(team_id, auth.uid()) or public.is_physio_hod(auth.uid()))
    and (
      kind not in ('plan_remark', 'plan_time_edit', 'plan_reschedule_decision', 'plan_add')
      or public.is_team_manager(team_id, auth.uid())
      or public.is_physio_hod(auth.uid())
    )
  );

drop policy if exists "mtm manager closes team flags" on public.manager_team_messages;
create policy "mtm manager closes team flags" on public.manager_team_messages
  for update to authenticated
  using (kind = 'team_flags' and (public.is_team_manager(team_id, auth.uid()) or public.is_physio_hod(auth.uid())))
  with check (kind = 'team_flags' and (public.is_team_manager(team_id, auth.uid()) or public.is_physio_hod(auth.uid())));
