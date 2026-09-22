-- ============ Cron-key fix: read CRON_SECRET from Vault ============
-- The working cron callers read the secret from vault.decrypted_secrets at
-- call time; crew_push_send and enqueue_manager_team_flags hardcoded a guessed
-- value, so their edge-function calls came back 401 unauthorized (proven live
-- with a direct test call). This patches BOTH to the vault pattern, with the
-- old literal kept as a fallback. Run once.

-- 1) crew_push_send: vault-read key
create or replace function public.crew_push_send(p_events jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_key text;
begin
  if p_events is null or jsonb_array_length(p_events) = 0 then return; end if;
  begin
    select decrypted_secret into v_key from vault.decrypted_secrets where name = 'CRON_SECRET' limit 1;
  exception when others then
    v_key := null;
  end;
  perform net.http_post(
    url := 'https://agtjszjedaenclbzgjvi.supabase.co/functions/v1/notify-crew-event',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-key', coalesce(v_key, 'odds-cron-2026-farsession')),
    body := jsonb_build_object('events', p_events));
exception when others then null; -- pushes must never break a write
end $$;
revoke all on function public.crew_push_send(jsonb) from public, anon, authenticated;

-- 2) enqueue_manager_team_flags: same fix on its push call (weekly-v2 body
--    unchanged otherwise; supersedes weekly_protocol_v2_team_flags.sql).
create or replace function public.enqueue_manager_team_flags()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_monday date := date_trunc('week', (now() at time zone 'Asia/Kolkata'))::date;
  v_key text;
  t record;
  m_id uuid;
  member_ids uuid[];
  trainer_flags jsonb;
  team_payload jsonb := '[]'::jsonb;
  total_flags int;
  total_trainers int;
  posted int := 0;
begin
  begin
    select decrypted_secret into v_key from vault.decrypted_secrets where name = 'CRON_SECRET' limit 1;
  exception when others then
    v_key := null;
  end;
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
            and coalesce(entry->>'frequency', 'weekly') = 'weekly'
            and (entry->>'sessions_per_week')::int between 2 and 14
          limit 1
        ) e
        where c.status = 'active'
          and v_today - (case (e.entry->>'sessions_per_week')::int
                           when 2 then 3 when 3 then 2 else 1 end) >= v_monday
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
          'x-cron-key', coalesce(v_key, 'odds-cron-2026-farsession')
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

-- 3) End-to-end test (uncomment and run AFTER the above): pushes a test
--    notification to Sagar's phone through the full vault -> pg_net -> edge
--    function -> FCM chain. Tapping it must open My Crew.
-- select public.crew_push_send(jsonb_build_array(jsonb_build_object(
--   'user_ids', jsonb_build_array('4b5c7679-c163-4060-b84d-d7753a51e695'),
--   'title', 'My Crew push test',
--   'body', 'Tap to open My Crew.',
--   'type', 'crew_test')));
