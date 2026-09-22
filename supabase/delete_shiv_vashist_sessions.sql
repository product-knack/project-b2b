-- 15 Sep 2026. Two things in one run:
--
-- A. Fix prevent_delete_paid_session(): the BEFORE DELETE guard on
--    training_sessions compares OLD.id against COALESCE(paid_session_ids,
--    ARRAY[]::uuid[]) but both trainer_payout_records.paid_session_ids and
--    paid_cancelled_session_ids are text[], so it raised
--    "42846: COALESCE could not convert type uuid[] to text[]" on EVERY delete,
--    paid or not. Same intent, correct types. (Hand-run function, not in the
--    migrations folder.)
--
-- B. Delete therapist Shiv (d869b27b) x client Vashist Dev (0eecb1ab) sessions:
--    56f9c751 (31 Aug 09:00 IST, deep tissue) and 4d340cd8 (31 Aug 14:21 IST,
--    lymphatic drainage). Neither is in any payout record (verified via the API),
--    so the fixed guard lets them through. Their roster slot 106b2ca7 is already gone.

-- A. corrected guard
CREATE OR REPLACE FUNCTION public.prevent_delete_paid_session()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.trainer_payout_records r
    WHERE r.paid_at IS NOT NULL
      AND (
        OLD.id::text = ANY (COALESCE(r.paid_session_ids, ARRAY[]::text[]))
        OR OLD.id::text = ANY (COALESCE(r.paid_cancelled_session_ids, ARRAY[]::text[]))
      )
  ) THEN
    RAISE EXCEPTION 'Session % is part of a paid payout and cannot be deleted', OLD.id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END;
$$;

-- B. the two rows (scoped to therapist + client as a safety net)
DELETE FROM public.training_sessions
WHERE id IN ('56f9c751-f40e-46d2-ae75-2b6c655ec203', '4d340cd8-2211-4a1c-bd7e-36533c4dac3f')
  AND trainer_id = 'd869b27b-ba55-4807-af18-00b9572323d6'
  AND client_id  = '0eecb1ab-6894-4b0d-8779-51920bfbd6b6';

-- Verify: 0
SELECT count(*) AS remaining
FROM public.training_sessions
WHERE trainer_id = 'd869b27b-ba55-4807-af18-00b9572323d6'
  AND client_id  = '0eecb1ab-6894-4b0d-8779-51920bfbd6b6';
