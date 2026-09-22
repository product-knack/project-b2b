-- ============ My Crew: one-time backfill of 'conflict' plan entries ============
-- Plans shared BEFORE the replace rule went live could hit the unique constraint
-- (same trainer+client already booked at that exact datetime) -> entry stored as
-- roster='conflict' with no schedule_id, and no crew session was ever created.
--
-- This script fixes every such entry on TODAY-or-future plan dates (IST), taking
-- only the LATEST plan message per (team, sender, date) — superseded messages
-- don't render and must not spawn sessions. Per conflicted entry:
--   * crew row already exists for that member+client+day  -> ADOPT it
--   * blocking row is LOGGED/completed                    -> ADOPT it (no delete)
--   * blocking row(s) unlogged                            -> DELETE them, CREATE
--     the crew session at the planned time, link it
--   * insert still collides (another MEMBER's exact-time session) -> left as
--     conflict, reported
-- The message payload entry is patched in place (schedule_id + roster='created');
-- the SQL editor bypasses the app-side immutability policy. Open devices refresh
-- via the message UPDATE realtime event.
--
-- Run this whole file once; the result table lists every action taken.

create or replace function pg_temp.crew_backfill_conflicts()
returns table(plan_date date, client_name text, trainer_name text, action text, old_session uuid, new_session uuid)
language plpgsql as $$
declare
  m record;
  v_entries jsonb;
  e jsonb;
  i int;
  cid uuid;
  d date;
  ds timestamptz;
  de timestamptz;
  v_sid uuid;
  v_blockers uuid[];
  v_changed boolean;
begin
  for m in
    select distinct on (mm.team_id, mm.sender_id, mm.payload->>'date')
           mm.id, mm.sender_id, mm.payload
    from manager_team_messages mm
    where mm.kind = 'tomorrow_plan'
      and (mm.payload->>'date')::date >= (now() at time zone 'Asia/Kolkata')::date
    order by mm.team_id, mm.sender_id, mm.payload->>'date', mm.created_at desc
  loop
    v_entries := coalesce(m.payload->'entries', '[]'::jsonb);
    v_changed := false;
    for i in 0..jsonb_array_length(v_entries) - 1 loop
      e := v_entries->i;
      if not (e->>'roster' = 'conflict' and (e->>'schedule_id') is null and (e->>'client_id') is not null) then
        continue;
      end if;
      cid := (e->>'client_id')::uuid;
      d := (m.payload->>'date')::date;
      ds := (d::text || ' 00:00:00')::timestamp at time zone 'Asia/Kolkata';
      de := ((d + 1)::text || ' 00:00:00')::timestamp at time zone 'Asia/Kolkata';
      plan_date := d;
      client_name := coalesce(e->>'name', cid::text);
      select trim(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')) into trainer_name
        from profiles p where p.id = m.sender_id;
      old_session := null; new_session := null; v_sid := null;

      -- 1) crew row already exists for this member+client+day -> adopt
      select ss.id into v_sid from session_schedule ss
        where ss.trainer_id = m.sender_id and ss.client_id = cid
          and ss.scheduled_datetime >= ds and ss.scheduled_datetime < de
          and coalesce(ss.notes,'') like 'Created from Team Messenger%'
          and (ss.status is null or ss.status <> 'cancelled')
        order by ss.scheduled_datetime limit 1;
      if v_sid is not null then
        action := 'adopted_existing_crew_row';
        new_session := v_sid;
      else
        -- 2) blocking row already LOGGED/completed -> adopt, never delete
        select ss.id into v_sid from session_schedule ss
          where ss.trainer_id = m.sender_id and ss.client_id = cid
            and ss.scheduled_datetime >= ds and ss.scheduled_datetime < de
            and coalesce(ss.notes,'') not like 'Created from Team Messenger%'
            and (ss.workout_session_id is not null or ss.status = 'completed')
            and (ss.status is null or ss.status <> 'cancelled')
          order by ss.scheduled_datetime limit 1;
        if v_sid is not null then
          action := 'adopted_logged_session';
          old_session := v_sid; new_session := v_sid;
        else
          -- 3) delete unlogged blockers, then create the crew session
          select array_agg(ss.id) into v_blockers from session_schedule ss
            where ss.trainer_id = m.sender_id and ss.client_id = cid
              and ss.scheduled_datetime >= ds and ss.scheduled_datetime < de
              and coalesce(ss.notes,'') not like 'Created from Team Messenger%'
              and ss.workout_session_id is null
              and (ss.status is null or ss.status not in ('cancelled','completed'));
          if v_blockers is not null then
            delete from session_schedule where id = any(v_blockers);
            old_session := v_blockers[1];
          end if;
          begin
            insert into session_schedule (trainer_id, client_id, scheduled_datetime, modality, status, notes)
              values (m.sender_id, cid,
                      (d::text || ' ' || (e->>'time') || ':00')::timestamp at time zone 'Asia/Kolkata',
                      nullif(e->>'modality',''), 'scheduled', 'Created from Team Messenger day plan')
              returning id into v_sid;
            action := case when v_blockers is null then 'created'
                           else 'replaced_' || coalesce(array_length(v_blockers,1),0) || '_and_created' end;
            new_session := v_sid;
          exception when unique_violation then
            v_sid := null;
            action := 'still_conflict_other_member';
          end;
        end if;
      end if;

      if v_sid is not null then
        v_entries := jsonb_set(v_entries, array[i::text],
          (e || jsonb_build_object('schedule_id', v_sid, 'roster', 'created')));
        v_changed := true;
      end if;
      return next;
    end loop;
    if v_changed then
      update manager_team_messages set payload = jsonb_set(m.payload, '{entries}', v_entries) where id = m.id;
    end if;
  end loop;
end $$;

select * from pg_temp.crew_backfill_conflicts();
