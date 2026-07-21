-- ============================================================================
-- FAR-SESSION ALERTS — dedupe table + 15-minute cron trigger.
--
-- STEP 0 (Dashboard, not SQL): enable the two extensions via the UI toggle —
--   Supabase Dashboard → Database → Extensions → search "pg_cron"  → Enable
--   Supabase Dashboard → Database → Extensions → search "pg_net"   → Enable
-- (Creating them via raw SQL trips Supabase's permission hook — the
--  "dependent privileges exist" error you saw.)
--
-- THEN run everything below in the SQL Editor.
-- ============================================================================

-- 1. Dedupe: one alert per session, ever.
create table if not exists public.far_session_alerts (
  session_id uuid primary key,
  trainer_id uuid,
  duration_min integer,
  notified_at timestamptz not null default now()
);
alter table public.far_session_alerts enable row level security;
-- Service-role only (the edge fn); no client policies needed.

-- 2. Cron: call the function every 15 minutes.
do $$ begin
  perform cron.unschedule('notify-far-sessions');
exception when others then null; end $$;

select cron.schedule(
  'notify-far-sessions',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://agtjszjedaenclbzgjvi.supabase.co/functions/v1/notify-far-sessions',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-key', 'odds-cron-2026-farsession'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Verify: should list the job with schedule */15 * * * *
select jobname, schedule, active from cron.job where jobname = 'notify-far-sessions';
