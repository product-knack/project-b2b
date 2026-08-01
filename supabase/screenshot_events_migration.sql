-- Screenshot audit trail (2026-08-01): who screenshotted the app, when, on
-- which screen. Rows are written by the app whenever the OS reports a
-- screenshot of it (home dashboards where capture is allowed; iOS everywhere;
-- Android 14+ detection). Run once in the Supabase SQL editor.

CREATE TABLE public.screenshot_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Original capture moment (client clock) — offline events replay later with
  -- the true timestamp, so this is NOT the same as created_at.
  taken_at timestamptz NOT NULL DEFAULT now(),
  route text,          -- app screen that was visible (store-router route name)
  platform text,       -- 'android' | 'ios'
  app_version text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_screenshot_events_taken ON public.screenshot_events (taken_at DESC);
CREATE INDEX idx_screenshot_events_profile ON public.screenshot_events (profile_id, taken_at DESC);

GRANT SELECT, INSERT ON public.screenshot_events TO authenticated;
GRANT ALL ON public.screenshot_events TO service_role;

ALTER TABLE public.screenshot_events ENABLE ROW LEVEL SECURITY;

-- Users may only log their own events (the app stamps auth.uid()).
CREATE POLICY "Users log their own screenshot events"
  ON public.screenshot_events FOR INSERT TO authenticated
  WITH CHECK (profile_id = auth.uid());

-- Only admin / super_admin can read the audit trail.
CREATE POLICY "Admins read screenshot events"
  ON public.screenshot_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','super_admin')));
