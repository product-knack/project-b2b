-- ============================================================================
-- Tech Desk: the reporter acknowledges a fix, and that closes the ticket
-- ============================================================================
-- Run this whole file at once in the Supabase SQL editor (project
-- agtjszjedaenclbzgjvi). Safe to re-run: every statement is idempotent.
--
-- Why: "Resolved" used to be Tech's word for it. Tickets then sat in Resolved
-- forever, or a tech person closed their own work. Now a resolution is a claim
-- that the person who raised the ticket has to answer:
--
--     tech moves to Resolved  ->  reporter confirms  ->  ticket closes itself
--                             ->  reporter says it is not fixed  ->  In Progress
--
-- Verified live before writing (2026-09-05, admin probe): tech_tickets has the
-- original 14 columns and no acknowledgement column; no tech_ticket_acknowledge
-- function exists; 6 tickets, one of them (T6) already sitting in resolved.
-- That T6 will show its reporter the acknowledgement card the moment this runs,
-- which is the correct behaviour, not a migration gap.
-- ============================================================================


-- 1. The column ---------------------------------------------------------------
-- This is the 15th column on tech_tickets. The original spec froze the table at
-- 14; the user lifted that freeze on 2026-09-05 for this feature.
--
-- Shape (latest acknowledgement, with the earlier rounds kept underneath):
--   {
--     "by":          "<profiles.id of the reporter>",
--     "by_name":     "Nirdosh Sharma",        -- frozen at acknowledgement time
--     "at":          "2026-09-05T11:04:22.317Z",
--     "verdict":     "confirmed" | "reopened",
--     "note":        "still happens on the roster screen",   -- optional/absent
--     "resolved_at": "2026-09-05T10:57:15.539Z", -- which resolution this answers
--     "history":     [ { ...the same shape, oldest first, last 20 } ]
--   }
ALTER TABLE public.tech_tickets
  ADD COLUMN IF NOT EXISTS acknowledgement jsonb;

COMMENT ON COLUMN public.tech_tickets.acknowledgement IS
  'Reporter''s answer to a resolution. {by, by_name, at, verdict confirmed|reopened, note, resolved_at, history[]}. Written ONLY by tech_ticket_acknowledge(); never patch it from a client.';


-- 2. The RPC ------------------------------------------------------------------
-- Reporters cannot UPDATE tech_tickets (RLS makes UPDATE staff-only), exactly
-- like tech_ticket_close, so acknowledging has to go through SECURITY DEFINER.
-- The rules live here rather than in the two clients: web and android both call
-- this, and a rule enforced only in a screen is not a rule.
CREATE OR REPLACE FUNCTION public.tech_ticket_acknowledge(
  _id      uuid,
  _verdict text,
  _note    text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid   uuid := auth.uid();
  _t     public.tech_tickets%ROWTYPE;
  _name  text;
  _clean text := NULLIF(btrim(coalesce(_note, '')), '');
  _prev  jsonb;
  _hist  jsonb;
  _entry jsonb;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  -- The IS NULL arm matters: `NULL NOT IN (...)` is NULL, not true, so without it a
  -- missing verdict would fall through this guard and out of both branches below.
  IF _verdict IS NULL OR _verdict NOT IN ('confirmed', 'reopened') THEN
    RAISE EXCEPTION 'Unknown acknowledgement' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO _t FROM public.tech_tickets WHERE id = _id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket not found' USING ERRCODE = 'P0001';
  END IF;

  -- Only the person who raised it. Tech confirming their own fix is the exact
  -- thing this feature exists to stop.
  IF _t.created_by <> _uid THEN
    RAISE EXCEPTION 'Only the person who raised this ticket can acknowledge it'
      USING ERRCODE = '42501';
  END IF;

  IF _t.status <> 'resolved' THEN
    -- Idempotent on a double tap: a slow connection must not paint an error over
    -- an acknowledgement that already landed.
    IF _t.status = 'closed' AND _t.acknowledgement IS NOT NULL THEN
      RETURN _t.acknowledgement;
    END IF;
    RAISE EXCEPTION 'This ticket is not waiting for your acknowledgement'
      USING ERRCODE = 'P0001';
  END IF;

  IF _verdict = 'reopened' AND _clean IS NULL THEN
    RAISE EXCEPTION 'Tell Tech what is still wrong' USING ERRCODE = 'P0001';
  END IF;

  SELECT NULLIF(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), '')
    INTO _name
    FROM public.profiles p
   WHERE p.id = _uid;

  -- Previous rounds move into history; a ticket that ping-pongs is a story worth
  -- being able to read back. Keep the last 20.
  _prev := _t.acknowledgement;
  _hist := coalesce(_prev -> 'history', '[]'::jsonb);
  IF _prev IS NOT NULL THEN
    _hist := _hist || jsonb_build_array(_prev - 'history');
    IF jsonb_array_length(_hist) > 20 THEN
      _hist := (
        SELECT coalesce(jsonb_agg(e ORDER BY n), '[]'::jsonb)
          FROM jsonb_array_elements(_hist) WITH ORDINALITY AS x(e, n)
         WHERE n > jsonb_array_length(_hist) - 20
      );
    END IF;
  END IF;

  -- Same stamp format the timeline triggers write, so both clients parse one shape.
  _entry := jsonb_strip_nulls(jsonb_build_object(
    'by',          _uid,
    'by_name',     _name,
    'at',          to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'verdict',     _verdict,
    'note',        _clean,
    'resolved_at', _t.timeline ->> 'resolved_at'
  )) || jsonb_build_object('history', _hist);

  IF _verdict = 'confirmed' THEN
    -- The whole point: acknowledging IS closing. tech_ticket_touch_timeline
    -- stamps closed_at, tech_ticket_log_events writes the "moved to Closed" row
    -- against auth.uid(), which is still the reporter inside SECURITY DEFINER.
    UPDATE public.tech_tickets
       SET acknowledgement = _entry,
           status          = 'closed'
     WHERE id = _id;
  ELSE
    -- Back to Tech. resolution is cleared explicitly as well as by the trigger,
    -- so the row is right even if that trigger is ever changed.
    UPDATE public.tech_tickets
       SET acknowledgement = _entry,
           status          = 'in_progress',
           resolution      = NULL
     WHERE id = _id;
  END IF;

  -- A plain text message from the reporter, not a new system event: the web
  -- client's systemLineText only knows created/status/priority/assignee, so an
  -- unknown event would render there as "assigned to a teammate".
  -- created_at is clock_timestamp(), not the default now(): inside one transaction
  -- now() is frozen, so this row and the trigger's "moved to Closed" row would share
  -- a timestamp and the thread would order them differently on every refetch.
  INSERT INTO public.tech_ticket_messages (ticket_id, sender_id, created_at, message)
  VALUES (_id, _uid, clock_timestamp(), jsonb_build_object(
    'type', 'text',
    'text', CASE WHEN _verdict = 'confirmed'
                 THEN 'Acknowledged as fixed.' || coalesce(' ' || _clean, '')
                 ELSE 'Not fixed yet. ' || _clean
            END
  ));

  RETURN _entry;
END $$;

REVOKE ALL ON FUNCTION public.tech_ticket_acknowledge(uuid, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.tech_ticket_acknowledge(uuid, text, text) TO authenticated;


-- 3. Check it -----------------------------------------------------------------
-- Should raise "Only the person who raised this ticket can acknowledge it" or
-- "This ticket is not waiting for your acknowledgement" (never PGRST202):
--   select public.tech_ticket_acknowledge(
--     (select id from public.tech_tickets order by serial_no desc limit 1),
--     'confirmed', null);
--
-- After a real acknowledgement from the app:
--   select serial_no, status, resolution, acknowledgement, timeline
--     from public.tech_tickets where serial_no = <n>;
-- expect status 'closed', timeline.closed_at set, acknowledgement.verdict
-- 'confirmed', and one text message from the reporter at the end of the thread.
