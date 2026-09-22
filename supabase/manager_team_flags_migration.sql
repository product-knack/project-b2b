-- !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!! WARNING !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
-- DO NOT RE-RUN THIS FILE. It is kept for reference only:
--  * The SELECT policy below is SUPERSEDED by the role-proof definer policies
--    in physio_hod_migration.sql — re-running would break doctor/HOD access.
--  * enqueue_manager_team_flags() is SUPERSEDED by
--    weekly_protocol_v2_team_flags.sql (protocol frequency awareness).
-- !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

-- ============ Managers Messenger — daily 7 PM Team Flags card ============
-- Every day at 19:00 IST a cron function checks each active competition team:
-- for every member trainer, their assigned clients whose weekly protocol
-- (clients.weekly_protocol, set by the CRM) says sessions are off pace get
-- flagged. A 'team_flags' card is posted into the team chat (visible to the
-- MANAGER only, enforced by RLS below) and the manager gets a push that
-- deep-links to the chat.
--
-- Off-pace rule (Mon-Sun week window, all dates IST):
--   sessions/week 2 -> allowed gap 3 days   (no session Mon-Wed -> flag Thu 7pm)
--   sessions/week 3 -> allowed gap 2 days
--   sessions/week 4, 5 -> allowed gap 1 day
--   sessions/week 6 -> allowed gap 1 day
-- A client is flagged when the FULL allowed gap (clipped to the current week,
-- so early weekdays cannot false-flag) passed with no completed session AND
-- there is no roster entry scheduled for today.
--
-- BEFORE RUNNING: deploy the edge function first —
--   supabase functions deploy notify-manager-team-flags
-- Run this file in the SQL Editor (idempotent).

-- 1. RLS: team_flags cards are manager-only. Recreate the SELECT policy with
--    the kind carve-out; everything else behaves exactly as before.
drop policy if exists "mtm members read" on public.manager_team_messages;
create policy "mtm members read" on public.manager_team_messages
  for select to authenticated using (
    (
      kind <> 'team_flags'
      and (
        exists (
          select 1 from public.manager_score ms
          where ms.id = team_id
            and (ms.manager_id = auth.uid() or ms.team_json ? auth.uid()::text)
        )
        or public.was_participant(team_id, auth.uid())
      )
    )
    or (
      kind = 'team_flags'
      and exists (
        select 1 from public.manager_score ms
        where ms.id = team_id and ms.manager_id = auth.uid()
      )
    )
  );

-- 2. The 7 PM computation + card + push.
create or replace function public.enqueue_manager_team_flags()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_monday date := date_trunc('week', (now() at time zone 'Asia/Kolkata'))::date;
  t record;
  m_id uuid;
  member_ids uuid[];
  trainer_flags jsonb;
  team_payload jsonb := '[]'::jsonb;
  total_flags int;
  total_trainers int;
  posted int := 0;
begin
  for t in
    select ms.id, ms.manager_id, ms.team_json
    from manager_score ms
    where ms.team_start <= v_today
      and (ms.team_end is null or ms.team_end >= v_today)
  loop
    team_payload := '[]'::jsonb;

    member_ids := array(
      select distinct u::uuid
      from (
        select t.manager_id::text as u
        union all
        select jsonb_array_elements_text(coalesce(t.team_json, '[]'::jsonb))
      ) x
      where u is not null and u <> ''
    );

    foreach m_id in array member_ids loop
      -- Flagged clients for this member, from their weekly_protocol entries.
      select jsonb_agg(f order by f->>'name')
      into trainer_flags
      from (
        select jsonb_build_object(
                 'client_id', c.id,
                 'name', trim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')),
                 'sessions_per_week', (e.entry->>'sessions_per_week')::int,
                 'modality', e.entry->>'modality',
                 'gap_days', case (e.entry->>'sessions_per_week')::int
                               when 2 then 3 when 3 then 2 else 1 end
               ) as f
        from clients c
        join trainer_clients tc
          on tc.client_id = c.id
         and tc.trainer_id = m_id
         and tc.actively_training = true
        cross join lateral (
          select entry
          from jsonb_array_elements(coalesce(c.weekly_protocol->'entries', '[]'::jsonb)) entry
          where (entry->>'trainer_id')::uuid = m_id
            and (entry->>'sessions_per_week')::int between 2 and 6
          limit 1
        ) e
        where c.status = 'active'
          -- full allowed gap must fit inside the current Mon-Sun week
          and v_today - (case (e.entry->>'sessions_per_week')::int
                           when 2 then 3 when 3 then 2 else 1 end) >= v_monday
          -- no completed session on any day of the gap window
          and not exists (
            select 1 from training_sessions ts
            where ts.client_id = c.id
              and ts.status = 'completed'
              and coalesce(ts.cancelled, false) = false
              and (ts.scheduled_at at time zone 'Asia/Kolkata')::date
                    between v_today - (case (e.entry->>'sessions_per_week')::int
                                         when 2 then 3 when 3 then 2 else 1 end)
                        and v_today - 1
          )
          -- and no roster entry scheduled for today either
          and not exists (
            select 1 from session_schedule ss
            where ss.client_id = c.id
              and lower(coalesce(ss.status,'')) not in ('cancelled','canceled','deleted')
              and (ss.scheduled_datetime at time zone 'Asia/Kolkata')::date = v_today
          )
      ) flagged;

      if trainer_flags is not null and jsonb_array_length(trainer_flags) > 0 then
        team_payload := team_payload || jsonb_build_array(jsonb_build_object(
          'trainer_id', m_id,
          'trainer_name', (
            select trim(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,''))
            from profiles p where p.id = m_id
          ),
          'clients', trainer_flags
        ));
      end if;
    end loop;

    if jsonb_array_length(team_payload) > 0 then
      select coalesce(sum(jsonb_array_length(tf->'clients')), 0)::int
      into total_flags
      from jsonb_array_elements(team_payload) tf;
      total_trainers := jsonb_array_length(team_payload);

      insert into manager_team_messages (team_id, sender_id, kind, payload, body)
      values (
        t.id,
        t.manager_id,
        'team_flags',
        jsonb_build_object('date', v_today, 'flags', team_payload),
        'Team flags (' || to_char(v_today, 'DD Mon') || '): ' || total_flags ||
          ' client(s) off pace across ' || total_trainers || ' trainer(s)'
      );
      posted := posted + 1;

      perform net.http_post(
        url := 'https://agtjszjedaenclbzgjvi.supabase.co/functions/v1/notify-manager-team-flags',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-key', 'odds-cron-2026-farsession'
        ),
        body := jsonb_build_object(
          'manager_id', t.manager_id,
          'flag_count', total_flags,
          'trainer_count', total_trainers
        )
      );
    end if;
  end loop;

  return posted;
end;
$$;

-- 3. Daily at 19:00 IST (13:30 UTC). Unschedule-then-schedule = idempotent.
do $$
begin
  perform cron.unschedule('manager-team-flags-7pm-ist');
exception when others then null;
end $$;
select cron.schedule(
  'manager-team-flags-7pm-ist',
  '30 13 * * *',
  $$ select public.enqueue_manager_team_flags(); $$
);
