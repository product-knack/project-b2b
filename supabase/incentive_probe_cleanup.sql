-- CRM Incentives: one-time cleanup of live-verification probe rows (2026-08-01)
-- plus OPTIONAL policy hardening. Run in the Supabase SQL editor.

-- ============ 1. REQUIRED: remove the "ZZ Probe" verification rows ============
-- Two request rows (one rejected, one approved) and two ledger events were left
-- behind by the end-to-end verification because neither table has a DELETE
-- policy for the app roles. They inflate Deepak's referral tally by 2.

DELETE FROM public.incentive_events
 WHERE new_value LIKE 'ZZ Probe%';

DELETE FROM public.crm_incentive_request
 WHERE details->>'referred_client_name' LIKE 'ZZ Probe%';

-- ============ 2. OPTIONAL (recommended by the port spec) ============
-- Admin/ops can hard-delete bad rows in future (today nobody can, not even
-- admins), and the ledger INSERT is restricted to the roles that review
-- requests instead of any signed-in user.

CREATE POLICY "Admins can delete incentive requests"
  ON public.crm_incentive_request FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','super_admin','ops')));

CREATE POLICY "Admins can delete incentive events"
  ON public.incentive_events FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','super_admin','ops')));

-- Tighten the wide-open events INSERT (was: WITH CHECK (true)).
-- NOTE: only run this if the WEB app's approval also runs as admin/ops (it
-- does today — approval happens from the admin dashboard).
DROP POLICY IF EXISTS "Authenticated users can insert incentive events" ON public.incentive_events;
CREATE POLICY "Reviewers can insert incentive events"
  ON public.incentive_events FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','super_admin','ops')));
