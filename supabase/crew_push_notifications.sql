-- ============ My Crew push notifications (all scenarios) ============
-- BEFORE RUNNING: deploy the edge function first —
--   supabase functions deploy notify-crew-event      (from the hub-track repo)
--
-- Instant pushes (DB trigger on manager_team_messages INSERT):
--   A1/A3 member: session rescheduled / request approved (plan_time_edit)
--   A2    member: session added to your day (plan_add)
--   A3    member: request rejected (plan_reschedule_decision)
--   A5    member: you got flagged (team_flags blocks)
--   A6/B5 member/manager: @mention in team chat (text)
--   A7    member: remark landed via HOD (covered by plan_time_edit/remark msgs)
--   B1    manager: member reschedule request
--   B3    manager: member shared/updated a day plan
--   B6    manager: AI chat-reschedule accepted (session_update)
--   C1    HOD: doctor/therapist reschedule request
--   C2    HOD: doctor/therapist shared a day plan
--   C3    HOD: doctor/therapist flag blocks awaiting her remark
-- Cron digests (pg_cron, IST):
--   A8 06:00  member morning digest (today's sessions + first time)
--   A4 20:00  member nudge: tomorrow's plan not shared yet
--   B2 20:00  manager roll-call summary (who's missing)
--   B4 21:00  manager: today's missed sessions + remarks pending
--   C4 21:00  HOD: doctor/therapist missed sessions awaiting her remark
-- Every push deep-links to My Crew. Run this whole file once (idempotent).

-- ---------- shared sender ----------
create or replace function public.crew_push_send(p_events jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_events is null or jsonb_array_length(p_events) = 0 then return; end if;
  perform net.http_post(
    url := 'https://agtjszjedaenclbzgjvi.supabase.co/functions/v1/notify-crew-event',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-key', 'odds-cron-2026-farsession'),
    body := jsonb_build_object('events', p_events));
exception when others then null; -- pushes must never break a write
end $$;
revoke all on function public.crew_push_send(jsonb) from public, anon, authenticated;

-- ---------- instant events: trigger on every crew message ----------
create or replace function public.crew_message_push()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_mgr uuid;
  v_sender_name text;
  v_events jsonb := '[]'::jsonb;
  v_target uuid;
  v_role text;
  v_hods uuid[];
  f jsonb;
  m record;
  v_cnt int;
  v_doc_flags int := 0;
begin
  begin
    select ms.manager_id into v_mgr from manager_score ms where ms.id = new.team_id;
    select coalesce(nullif(trim(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')), ''), 'A teammate')
      into v_sender_name from profiles p where p.id = new.sender_id;
    select array_agg(p.id) into v_hods from profiles p where p.role_specialization::text ilike '%physio_hod%';

    if new.kind in ('plan_time_edit', 'plan_add', 'plan_reschedule_decision') then
      -- A1 / A2 / A3: the affected MEMBER
      v_target := nullif(new.payload->>'trainer_id', '')::uuid;
      if v_target is not null and v_target <> new.sender_id then
        v_events := v_events || jsonb_build_array(jsonb_build_object(
          'user_ids', jsonb_build_array(v_target),
          'type', 'crew_' || new.kind,
          'title', case
            when new.kind = 'plan_add' then 'Session added to your day'
            when new.kind = 'plan_reschedule_decision' then 'Reschedule request rejected'
            when new.payload->>'request_id' is not null then 'Reschedule request approved'
            else 'Your session was rescheduled' end,
          'body', coalesce(new.body, 'Open My Crew to review.')));
      end if;

    elsif new.kind = 'plan_reschedule_request' then
      -- B1 (manager) or C1 (HOD when the requester is doctor/therapist)
      v_target := nullif(new.payload->>'trainer_id', '')::uuid;
      select p.role::text into v_role from profiles p where p.id = v_target;
      if v_role in ('doctor', 'therapist') then
        if v_hods is not null then
          v_events := v_events || jsonb_build_array(jsonb_build_object(
            'user_ids', to_jsonb(v_hods), 'type', 'crew_request_hod',
            'title', 'Reschedule request needs your decision',
            'body', coalesce(new.body, v_sender_name || ' requested a reschedule.')));
        end if;
      elsif v_mgr is not null and v_mgr <> new.sender_id then
        v_events := v_events || jsonb_build_array(jsonb_build_object(
          'user_ids', jsonb_build_array(v_mgr), 'type', 'crew_request',
          'title', 'Reschedule request needs your decision',
          'body', coalesce(new.body, v_sender_name || ' requested a reschedule.')));
      end if;

    elsif new.kind = 'session_update' then
      -- B6: manager sees chat-agreed reschedules
      if v_mgr is not null and v_mgr <> new.sender_id then
        v_events := v_events || jsonb_build_array(jsonb_build_object(
          'user_ids', jsonb_build_array(v_mgr), 'type', 'crew_session_update',
          'title', 'Session moved via client chat',
          'body', coalesce(new.body, 'A session was rescheduled by client agreement.')));
      end if;

    elsif new.kind = 'tomorrow_plan' then
      -- B3: manager; C2: HOD when a doctor/therapist shared
      if v_mgr is not null and v_mgr <> new.sender_id then
        v_events := v_events || jsonb_build_array(jsonb_build_object(
          'user_ids', jsonb_build_array(v_mgr), 'type', 'crew_plan_shared',
          'title', v_sender_name || ' shared a day plan',
          'body', coalesce(new.body, 'Open My Crew to review the plan.')));
      end if;
      select p.role::text into v_role from profiles p where p.id = new.sender_id;
      if v_role in ('doctor', 'therapist') and v_hods is not null and not (new.sender_id = any(v_hods)) then
        v_events := v_events || jsonb_build_array(jsonb_build_object(
          'user_ids', to_jsonb(v_hods), 'type', 'crew_plan_shared_hod',
          'title', v_sender_name || ' shared a day plan',
          'body', coalesce(new.body, 'A physio shared their day plan.')));
      end if;

    elsif new.kind = 'team_flags' then
      -- A5: each flagged member; C3: HOD when doctor/therapist blocks exist
      for f in select * from jsonb_array_elements(coalesce(new.payload->'flags', '[]'::jsonb)) loop
        v_target := nullif(f->>'trainer_id', '')::uuid;
        v_cnt := coalesce(jsonb_array_length(f->'clients'), 0);
        if v_target is not null and v_cnt > 0 then
          v_events := v_events || jsonb_build_array(jsonb_build_object(
            'user_ids', jsonb_build_array(v_target), 'type', 'crew_flagged',
            'title', 'You have a team flag',
            'body', v_cnt || ' client' || case when v_cnt = 1 then '' else 's' end || ' off pace this week. Tap to review.'));
          select p.role::text into v_role from profiles p where p.id = v_target;
          if v_role in ('doctor', 'therapist') then v_doc_flags := v_doc_flags + 1; end if;
        end if;
      end loop;
      if v_doc_flags > 0 and v_hods is not null then
        v_events := v_events || jsonb_build_array(jsonb_build_object(
          'user_ids', to_jsonb(v_hods), 'type', 'crew_flags_hod',
          'title', 'Doctor flags need your remark',
          'body', v_doc_flags || ' flag block' || case when v_doc_flags = 1 then '' else 's' end || ' awaiting your remark.'));
      end if;

    elsif new.kind = 'text' then
      -- A6 / B5: @mention by first name (team members only, never the sender)
      for m in
        select p.id, lower(split_part(trim(coalesce(p.first_name, '')), ' ', 1)) as first
        from profiles p
        where p.id in (
          select (jsonb_array_elements_text(coalesce(ms.team_json, '[]'::jsonb)))::uuid
            from manager_score ms where ms.id = new.team_id
          union
          select ms.manager_id from manager_score ms where ms.id = new.team_id
        )
      loop
        if m.id <> new.sender_id and m.first <> '' and position('@' || m.first in lower(coalesce(new.body, ''))) > 0 then
          v_events := v_events || jsonb_build_array(jsonb_build_object(
            'user_ids', jsonb_build_array(m.id), 'type', 'crew_mention',
            'title', v_sender_name || ' mentioned you',
            'body', left(coalesce(new.body, ''), 140)));
        end if;
      end loop;
    end if;

    perform crew_push_send(v_events);
  exception when others then null; -- never block the message insert
  end;
  return new;
end $$;

drop trigger if exists trg_crew_message_push on public.manager_team_messages;
create trigger trg_crew_message_push
  after insert on public.manager_team_messages
  for each row execute function public.crew_message_push();

-- ---------- A8: morning digest (06:00 IST) ----------
create or replace function public.crew_push_morning()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_events jsonb := '[]'::jsonb;
  m record;
  v_cnt int; v_first text; v_sent int := 0;
begin
  for m in
    select distinct u::uuid as id from (
      select ms.manager_id::text as u from manager_score ms
        where ms.team_start <= v_today and (ms.team_end is null or ms.team_end >= v_today)
      union all
      select jsonb_array_elements_text(coalesce(ms.team_json, '[]'::jsonb)) from manager_score ms
        where ms.team_start <= v_today and (ms.team_end is null or ms.team_end >= v_today)
    ) x where u is not null and u <> ''
  loop
    select count(*), to_char(min(ss.scheduled_datetime) at time zone 'Asia/Kolkata', 'FMHH12:MI AM')
      into v_cnt, v_first
      from session_schedule ss
      where ss.trainer_id = m.id
        and ss.scheduled_datetime >= (v_today::text || ' 00:00:00')::timestamp at time zone 'Asia/Kolkata'
        and ss.scheduled_datetime <  ((v_today + 1)::text || ' 00:00:00')::timestamp at time zone 'Asia/Kolkata'
        and (ss.status is null or ss.status not in ('cancelled'));
    if v_cnt > 0 then
      v_events := v_events || jsonb_build_array(jsonb_build_object(
        'user_ids', jsonb_build_array(m.id), 'type', 'crew_morning',
        'title', 'Today: ' || v_cnt || ' session' || case when v_cnt = 1 then '' else 's' end,
        'body', 'First session at ' || coalesce(v_first, '?') || '. Tap for your day plan.'));
      v_sent := v_sent + 1;
    end if;
  end loop;
  perform crew_push_send(v_events);
  return v_sent;
end $$;
revoke all on function public.crew_push_morning() from public, anon, authenticated;

-- ---------- A4 + B2: evening roll-call (20:00 IST) ----------
create or replace function public.crew_push_rollcall()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_tomorrow text := to_char((now() at time zone 'Asia/Kolkata')::date + 1, 'YYYY-MM-DD');
  v_events jsonb := '[]'::jsonb;
  t record; mid uuid;
  v_members uuid[]; v_missing_names text[]; v_missing_ids uuid[];
  v_total int; v_shared int; v_sent int := 0;
begin
  for t in
    select ms.id, ms.manager_id, ms.team_json from manager_score ms
      where ms.team_start <= v_today and (ms.team_end is null or ms.team_end >= v_today)
  loop
    v_members := array(
      select distinct u::uuid from (
        select t.manager_id::text as u
        union all select jsonb_array_elements_text(coalesce(t.team_json, '[]'::jsonb))
      ) x where u is not null and u <> '');
    v_total := coalesce(array_length(v_members, 1), 0);
    if v_total = 0 then continue; end if;
    v_missing_ids := array(
      select mm from unnest(v_members) mm
      where not exists (
        select 1 from manager_team_messages msg
        where msg.team_id = t.id and msg.kind = 'tomorrow_plan'
          and msg.sender_id = mm and msg.payload->>'date' = v_tomorrow));
    v_shared := v_total - coalesce(array_length(v_missing_ids, 1), 0);
    -- A4: nudge each missing MEMBER (the manager gets the summary instead)
    foreach mid in array coalesce(v_missing_ids, '{}'::uuid[]) loop
      if mid <> t.manager_id then
        v_events := v_events || jsonb_build_array(jsonb_build_object(
          'user_ids', jsonb_build_array(mid), 'type', 'crew_plan_reminder',
          'title', 'Tomorrow''s plan not shared yet',
          'body', 'Share your day plan with the team before the day starts.'));
        v_sent := v_sent + 1;
      end if;
    end loop;
    -- B2: one summary to the manager
    select array_agg(split_part(trim(coalesce(p.first_name, '')), ' ', 1)) into v_missing_names
      from profiles p where p.id = any(coalesce(v_missing_ids, '{}'::uuid[]));
    v_events := v_events || jsonb_build_array(jsonb_build_object(
      'user_ids', jsonb_build_array(t.manager_id), 'type', 'crew_rollcall',
      'title', 'Tomorrow''s plan: ' || v_shared || ' of ' || v_total || ' shared',
      'body', case when coalesce(array_length(v_missing_ids, 1), 0) = 0
        then 'Everyone shared their plan. All set for tomorrow.'
        else 'Missing: ' || array_to_string(coalesce(v_missing_names, '{}'::text[]), ', ') end));
    v_sent := v_sent + 1;
  end loop;
  perform crew_push_send(v_events);
  return v_sent;
end $$;
revoke all on function public.crew_push_rollcall() from public, anon, authenticated;

-- ---------- B4 + C4: missed-session sweep (21:00 IST) ----------
create or replace function public.crew_push_missed_sweep()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_events jsonb := '[]'::jsonb;
  t record;
  v_members uuid[];
  v_missed int; v_awaiting int;
  v_hod_missed int := 0; v_hod_awaiting int := 0;
  v_hods uuid[]; v_sent int := 0;
begin
  select array_agg(p.id) into v_hods from profiles p where p.role_specialization::text ilike '%physio_hod%';
  for t in
    select ms.id, ms.manager_id, ms.team_json from manager_score ms
      where ms.team_start <= v_today and (ms.team_end is null or ms.team_end >= v_today)
  loop
    v_members := array(
      select distinct u::uuid from (
        select t.manager_id::text as u
        union all select jsonb_array_elements_text(coalesce(t.team_json, '[]'::jsonb))
      ) x where u is not null and u <> '');
    select
      count(*),
      count(*) filter (where coalesce(jsonb_array_length(ss.missed_remarks), 0) = 0)
      into v_missed, v_awaiting
      from session_schedule ss
      where ss.trainer_id = any(v_members)
        and ss.scheduled_datetime >= (v_today::text || ' 00:00:00')::timestamp at time zone 'Asia/Kolkata'
        and ss.scheduled_datetime < now()
        and ss.workout_session_id is null
        and (ss.status is null or ss.status not in ('cancelled', 'completed'));
    if v_missed > 0 then
      v_events := v_events || jsonb_build_array(jsonb_build_object(
        'user_ids', jsonb_build_array(t.manager_id), 'type', 'crew_missed_sweep',
        'title', v_missed || ' session' || case when v_missed = 1 then '' else 's' end || ' missed today',
        'body', case when v_awaiting > 0
          then v_awaiting || ' still awaiting a remark. Tap to review.'
          else 'All missed sessions have remarks.' end));
      v_sent := v_sent + 1;
    end if;
    -- HOD slice: doctor/therapist members of this team
    select v_hod_missed + count(*),
           v_hod_awaiting + count(*) filter (where coalesce(jsonb_array_length(ss.missed_remarks), 0) = 0)
      into v_hod_missed, v_hod_awaiting
      from session_schedule ss
      where ss.trainer_id in (select p.id from profiles p where p.id = any(v_members) and p.role in ('doctor', 'therapist'))
        and ss.scheduled_datetime >= (v_today::text || ' 00:00:00')::timestamp at time zone 'Asia/Kolkata'
        and ss.scheduled_datetime < now()
        and ss.workout_session_id is null
        and (ss.status is null or ss.status not in ('cancelled', 'completed'));
  end loop;
  if v_hod_awaiting > 0 and v_hods is not null then
    v_events := v_events || jsonb_build_array(jsonb_build_object(
      'user_ids', to_jsonb(v_hods), 'type', 'crew_missed_hod',
      'title', 'Physio sessions missed today',
      'body', v_hod_awaiting || ' of ' || v_hod_missed || ' awaiting your remark. Tap to review.'));
    v_sent := v_sent + 1;
  end if;
  perform crew_push_send(v_events);
  return v_sent;
end $$;
revoke all on function public.crew_push_missed_sweep() from public, anon, authenticated;

-- ---------- schedules (unschedule-then-schedule = idempotent) ----------
do $$ begin perform cron.unschedule('crew-push-morning-6am-ist'); exception when others then null; end $$;
select cron.schedule('crew-push-morning-6am-ist', '30 0 * * *', $$ select public.crew_push_morning(); $$);

do $$ begin perform cron.unschedule('crew-push-rollcall-8pm-ist'); exception when others then null; end $$;
select cron.schedule('crew-push-rollcall-8pm-ist', '30 14 * * *', $$ select public.crew_push_rollcall(); $$);

do $$ begin perform cron.unschedule('crew-push-missed-9pm-ist'); exception when others then null; end $$;
select cron.schedule('crew-push-missed-9pm-ist', '30 15 * * *', $$ select public.crew_push_missed_sweep(); $$);
