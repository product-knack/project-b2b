-- ============ Weekly Protocol v2 → Team Flags cron update ============
-- The CRM Weekly Protocol page now stores per-entry `frequency` ('weekly' |
-- 'monthly'; monthly only for doctor-led Rehab/Recovery, up to 60/month) and
-- the weekly cap moved from 6 to 14 sessions.
--
-- WITHOUT this update the 7 PM flags cron treats a monthly count as a WEEKLY
-- count: a "4/month Recovery" protocol would look like 4/week (1-day allowed
-- gap) and false-flag the client almost every evening.
--
-- Changes vs the original enqueue_manager_team_flags():
--   1. Only `frequency = 'weekly'` entries are flagged (missing frequency =
--      legacy = weekly). Monthly cadence does not fit a daily gap rule —
--      monthly entries are informational (protocol chip/popup) and never flag.
--   2. Weekly range widened from 2-6 to 2-14 (new cap). Gap rule unchanged:
--      2/wk -> 3 days, 3/wk -> 2 days, 4+/wk -> 1 day.
--
-- Run ONLY this file in the SQL editor. Do NOT re-run the original
-- manager_team_flags_migration.sql — its RLS section is superseded by the
-- role-proof policies from physio_hod_migration.sql and re-running it would
-- break doctor access again. The cron schedule (jobid manager-team-flags-7pm-ist)
-- stays as is; it picks up this function automatically.

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
      -- Flagged clients for this member, from their WEEKLY protocol entries.
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
            -- v2: monthly entries (doctor-led Rehab/Recovery) never flag —
            -- a monthly count is not a weekly pace. Missing frequency = legacy weekly.
            and coalesce(entry->>'frequency', 'weekly') = 'weekly'
            and (entry->>'sessions_per_week')::int between 2 and 14
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
