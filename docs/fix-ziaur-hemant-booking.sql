-- Fix: Ziaur Rehman → Hemant Chawla, 4:00 PM today (4 Sep 2026 IST) was never booked.
--
-- WHY IT HAPPENED
-- The day plan runs `plan_sync_roster` ONCE, when the plan is shared. Hemant was
-- double-booked at that moment, so the entry came back `roster = 'conflict'` and no
-- session_schedule row was created. That result is frozen into the (immutable) plan
-- message payload, so resolving the clash afterwards — by moving the other trainer's
-- session to 10:00 PM — never re-ran the sync. The card still reads
-- "ROSTER CONFLICT · NOT BOOKED" and neither the trainer nor the manager has a retry.
--
-- VERIFIED 4 Sep 2026 against production:
--   trainer Ziaur Rehman  77909470-e4b6-472d-bb58-19c2afc83e13
--   client  Hemant Chawla 08941088-3334-4dfe-8204-bb438f9ca25f
--   Ziaur today: 08:00, 08:30, 10:30(cancelled), 11:30, 12:30, 14:00, 18:30 — no 16:00
--   Hemant today: only 22:00 Pilates with trainer 57fc9854 — 16:00 is free
--
-- 4:00 PM IST == 10:30 UTC. Re-running this is safe: the guard skips if it exists.

INSERT INTO public.session_schedule
  (trainer_id, client_id, scheduled_datetime, modality, status, notes)
SELECT
  '77909470-e4b6-472d-bb58-19c2afc83e13'::uuid,
  '08941088-3334-4dfe-8204-bb438f9ca25f'::uuid,
  '2026-09-04T10:30:00+00:00'::timestamptz,
  'Strength',
  'scheduled',
  'Created from Team Messenger day plan'
WHERE NOT EXISTS (
  SELECT 1 FROM public.session_schedule
   WHERE trainer_id = '77909470-e4b6-472d-bb58-19c2afc83e13'::uuid
     AND client_id  = '08941088-3334-4dfe-8204-bb438f9ca25f'::uuid
     AND scheduled_datetime = '2026-09-04T10:30:00+00:00'::timestamptz
);

-- ---------------------------------------------------------------------------
-- FOLLOW-UP (4 Sep 2026): the INSERT above was run and created row
-- 5e9ea276-1da1-4b7b-b1d5-8b7dc83ab0c2 at 4:00 PM. Moving it to 4:30 PM.
-- 4:30 PM IST == 11:00 UTC. Verified free for both Ziaur and Hemant before running.
-- Guarded on workout_session_id IS NULL so a logged session is never moved.
UPDATE public.session_schedule
   SET scheduled_datetime = '2026-09-04T11:00:00+00:00'::timestamptz,
       updated_at         = now()
 WHERE id = '5e9ea276-1da1-4b7b-b1d5-8b7dc83ab0c2'::uuid
   AND workout_session_id IS NULL;

-- Verify: expect one 4:00 PM Strength row for Hemant with Ziaur.
SELECT s.id,
       (s.scheduled_datetime AT TIME ZONE 'Asia/Kolkata') AS ist_time,
       s.modality, s.status, s.notes
  FROM public.session_schedule s
 WHERE s.trainer_id = '77909470-e4b6-472d-bb58-19c2afc83e13'::uuid
   AND s.scheduled_datetime >= '2026-09-03T18:30:00+00:00'::timestamptz
   AND s.scheduled_datetime <  '2026-09-04T18:30:00+00:00'::timestamptz
 ORDER BY s.scheduled_datetime;

-- ---------------------------------------------------------------------------
-- OPTIONAL — clear the stale red tag on the plan card.
-- The card reads `roster` from the message payload, so the "ROSTER CONFLICT ·
-- NOT BOOKED" line survives until the payload changes. manager_team_messages
-- allows payload UPDATEs (the team-flags remark flow relies on it), so this
-- rewrites just that one entry to 'linked' and points it at the new row.
-- Run it AFTER the INSERT above. Adjust the date if the plan was for another day.
--
-- UPDATE public.manager_team_messages m
--    SET payload = jsonb_set(
--          m.payload,
--          '{entries}',
--          (SELECT jsonb_agg(
--                    CASE WHEN e->>'client_id' = '08941088-3334-4dfe-8204-bb438f9ca25f'
--                         THEN e || jsonb_build_object(
--                                'roster', 'linked',
--                                'schedule_id', (SELECT s.id::text FROM public.session_schedule s
--                                                 WHERE s.trainer_id = '77909470-e4b6-472d-bb58-19c2afc83e13'::uuid
--                                                   AND s.client_id  = '08941088-3334-4dfe-8204-bb438f9ca25f'::uuid
--                                                   AND s.scheduled_datetime = '2026-09-04T10:30:00+00:00'::timestamptz
--                                                 LIMIT 1))
--                         ELSE e END)
--             FROM jsonb_array_elements(m.payload->'entries') e))
--  WHERE m.kind = 'tomorrow_plan'
--    AND m.payload->>'date' = '2026-09-04'
--    AND m.payload->'entries' @> '[{"client_id":"08941088-3334-4dfe-8204-bb438f9ca25f"}]'::jsonb;
