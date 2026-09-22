-- Trainer self-serve roster: add a session for TODAY or TOMORROW only.
-- Run in the Supabase SQL editor (project agtjszjedaenclbzgjvi).
--
-- WHY AN RPC AND NOT A DIRECT INSERT
-- Trainers have no INSERT path onto session_schedule today: the roster is owned by
-- CRM (Request Roster -> all_requests -> CRM approves) and by managers (the team
-- day plan -> plan_sync_roster). A trainer who is in NO current manager team has
-- neither, which is the gap this fills. Doing it as a SECURITY DEFINER function
-- means the "today or tomorrow only" rule, the assignment check and the clash
-- rules are enforced on the server, not just hidden in the app UI.
--
-- Verified 2026-09-04 before writing: trainer_clients is (trainer_id, client_id,
-- actively_training boolean); public.trainer_add_own_session does not exist yet
-- (PGRST202).

CREATE OR REPLACE FUNCTION public.trainer_add_own_session(
  _client_id uuid,
  _date      date,
  _time      text,          -- 'HH:mm' IST
  _modality  text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid   uuid := auth.uid();
  _today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  _at    timestamptz;
  _id    uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  -- Today or tomorrow, IST. This is the whole point of the function.
  IF _date IS NULL OR _date < _today OR _date > _today + 1 THEN
    RAISE EXCEPTION 'You can only add sessions for today or tomorrow' USING ERRCODE = 'P0001';
  END IF;

  IF _modality IS NULL OR btrim(_modality) = '' THEN
    RAISE EXCEPTION 'Pick a modality' USING ERRCODE = 'P0001';
  END IF;

  -- Must be YOUR actively-training client.
  IF NOT EXISTS (
    SELECT 1 FROM public.trainer_clients tc
     WHERE tc.trainer_id = _uid
       AND tc.client_id  = _client_id
       AND tc.actively_training IS TRUE
  ) THEN
    RAISE EXCEPTION 'That client is not assigned to you' USING ERRCODE = '42501';
  END IF;

  _at := ((_date::text || ' ' || _time || ':00')::timestamp AT TIME ZONE 'Asia/Kolkata');

  -- Same +/- 60 minute clash window the CRM bulk creator uses.
  IF EXISTS (
    SELECT 1 FROM public.session_schedule s
     WHERE s.trainer_id = _uid
       AND s.status <> 'cancelled'
       AND s.scheduled_datetime >  _at - interval '60 minutes'
       AND s.scheduled_datetime <  _at + interval '60 minutes'
  ) THEN
    RAISE EXCEPTION 'You already have a session around that time' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.session_schedule s
     WHERE s.client_id = _client_id
       AND s.status <> 'cancelled'
       AND s.scheduled_datetime >  _at - interval '60 minutes'
       AND s.scheduled_datetime <  _at + interval '60 minutes'
  ) THEN
    RAISE EXCEPTION 'That client already has a session around that time' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.session_schedule
    (trainer_id, client_id, scheduled_datetime, modality, status, notes)
  VALUES
    (_uid, _client_id, _at, btrim(_modality), 'scheduled', 'Added by trainer from Today''s Roster')
  RETURNING id INTO _id;

  RETURN jsonb_build_object('id', _id, 'at', _at);
END $$;

GRANT EXECUTE ON FUNCTION public.trainer_add_own_session(uuid, date, text, text) TO authenticated;

-- Verify (expect P0001 "You can only add sessions for today or tomorrow"):
-- SELECT public.trainer_add_own_session(
--   '00000000-0000-0000-0000-000000000000'::uuid, CURRENT_DATE + 5, '10:00', 'Strength');
