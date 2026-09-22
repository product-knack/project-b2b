-- NOTE: SUPERSEDED by crew_adopt_logged_sessions.sql (adds the adopt-logged
-- rule on top of the replace rule). Do not re-run this file.

-- ============ My Crew: the day plan REPLACES pre-existing sessions ============
-- New rule: when a trainer (or doctor/HOD) shares their crew day plan and a
-- client in it ALREADY has a session with THAT SAME member on that IST day
-- (e.g. CRM-scheduled earlier), the old session is DELETED and the crew plan's
-- session becomes the one and only booking.
--
-- Safety rails (never deleted):
--   * sessions already LOGGED (workout_session_id set) or status completed
--   * cancelled rows (harmless history)
--   * OTHER members' sessions with the client that day — a client can
--     legitimately have a trainer session AND a doctor session on the same day
--   * rows this feature itself created (they update in place as before)
--
-- Part 2 at the bottom backfills existing data: deletes old duplicate sessions
-- on days where a crew-created session already exists for the same
-- member+client (same guards). Run this whole file once in the SQL editor.
--
-- NOTE: this supersedes plan_sync_roster from plan_roster_sync_migration.sql —
-- do not re-run that file's function afterwards.

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
  v_replaced int;
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

    -- REPLACE rule: any pre-existing (non-crew) session for this client with
    -- ME on this day is superseded by the crew plan — delete it. Logged,
    -- completed and cancelled rows are untouchable; other members' sessions
    -- with this client are out of scope entirely.
    delete from session_schedule ss
      where ss.client_id = (e->>'client_id')::uuid
        and ss.trainer_id = v_uid
        and ss.scheduled_datetime >= v_day_start and ss.scheduled_datetime < v_day_end
        and coalesce(ss.notes, '') not like 'Created from Team Messenger%'
        and ss.workout_session_id is null
        and (ss.status is null or ss.status not in ('cancelled', 'completed'));
    get diagnostics v_replaced = row_count;

    v_dt := (p_date::text || ' ' || (e->>'time') || ':00')::timestamp at time zone 'Asia/Kolkata';

    -- Idempotent re-share: rows this feature itself created update in place.
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
        v_result := 'conflict'; -- another member's session at the exact same datetime
      end;
    end if;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'client_id', e->>'client_id', 'schedule_id', v_id, 'result', v_result,
      'replaced_prev', coalesce(v_replaced, 0)));
  end loop;
  return v_out;
end $$;
revoke all on function public.plan_sync_roster(uuid, date, jsonb) from public;
grant execute on function public.plan_sync_roster(uuid, date, jsonb) to authenticated;

-- ============ Part 2: one-time backfill ============
-- Delete old duplicate sessions on days where a crew-created session already
-- exists for the SAME member + client (same guards as the live rule). Returns
-- how many rows were removed.
with crew as (
  select ss.trainer_id, ss.client_id,
         (ss.scheduled_datetime at time zone 'Asia/Kolkata')::date as d
  from session_schedule ss
  where coalesce(ss.notes, '') like 'Created from Team Messenger%'
    and (ss.status is null or ss.status not in ('cancelled'))
),
del as (
  delete from session_schedule ss
  using crew c
  where ss.trainer_id = c.trainer_id
    and ss.client_id = c.client_id
    and (ss.scheduled_datetime at time zone 'Asia/Kolkata')::date = c.d
    and coalesce(ss.notes, '') not like 'Created from Team Messenger%'
    and ss.workout_session_id is null
    and (ss.status is null or ss.status not in ('cancelled', 'completed'))
  returning ss.id
)
select count(*) as backfilled_duplicates_deleted from del;
