-- ============ Plan-expiry push to trainers (10:00 and 19:00 IST) ============
-- A trainer whose actively-training client has an approved workout plan with
-- 1..3 days left gets one push per slot listing those clients.
--
-- ORDER:
--   1. supabase functions deploy notify-plan-expiry --no-verify-jwt
--      (secrets already present: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
--       FIREBASE_SERVICE_ACCOUNT_JSON, CRON_SECRET)
--   2. Run this file in the SQL editor. Idempotent.
-- pg_cron and pg_net are already enabled (far-session alerts).

-- 1. The rule, in one place --------------------------------------------------
-- Mirrors the app's usePlanExpiryMap exactly: workout_plan_exercises is one row
-- per set, so take the NEWEST approved_at per client + normalized modality
-- ("Strength Training" -> "Strength", NULL -> "Training"), valid 42 days from
-- approved_at, days_left = ceil((expiry - now) / 1 day). The app's amber state is
-- 0 < days_left <= 3; an already-expired plan (days_left <= 0) is red on the
-- roster card and is deliberately NOT in this push.
create or replace function public.plan_expiry_push_rows(p_warn_days int default 3)
returns table (trainer_id uuid, client_id uuid, client_name text, modality text, days_left int)
language sql
security definer
set search_path = public
as $$
  with latest as (
    select
      wpe.client_id,
      case when wpe.modality = 'Strength Training' then 'Strength'
           else coalesce(wpe.modality, 'Training') end as modality,
      max(wpe.approved_at) as approved_at
    from public.workout_plan_exercises wpe
    where wpe.status = 'approved' and wpe.approved_at is not null
    group by 1, 2
  ),
  expiring as (
    select
      l.client_id, l.modality,
      ceil(extract(epoch from ((l.approved_at + interval '42 days') - now())) / 86400.0)::int as days_left
    from latest l
  )
  select
    tc.trainer_id,
    e.client_id,
    nullif(btrim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), '') as client_name,
    e.modality,
    e.days_left
  from expiring e
  join public.trainer_clients tc on tc.client_id = e.client_id and tc.actively_training = true
  join public.clients c on c.id = e.client_id
  where e.days_left between 1 and p_warn_days
  order by tc.trainer_id, e.days_left, client_name;
$$;
revoke all on function public.plan_expiry_push_rows(int) from public, anon, authenticated;

-- 2. Dedupe log -------------------------------------------------------------
-- One row per trainer per slot (YYYY-MM-DD-am / -pm in IST). A manual re-run of
-- the function in the same slot pushes nobody twice.
create table if not exists public.plan_expiry_push_log (
  trainer_id uuid not null references public.profiles(id) on delete cascade,
  slot_key   text not null,
  clients    int  not null default 0,
  sent_at    timestamptz not null default now(),
  primary key (trainer_id, slot_key)
);
alter table public.plan_expiry_push_log enable row level security; -- service role only

-- 3. Cron: 10:00 and 19:00 IST = 04:30 and 13:30 UTC (pg_cron runs in UTC) ---
do $$ begin
  perform cron.unschedule('notify-plan-expiry-am');
  perform cron.unschedule('notify-plan-expiry-pm');
exception when others then null; end $$;

select cron.schedule('notify-plan-expiry-am', '30 4 * * *', $$
  select net.http_post(
    url := 'https://agtjszjedaenclbzgjvi.supabase.co/functions/v1/notify-plan-expiry',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-key', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'CRON_SECRET' limit 1), 'odds-cron-2026-farsession')),
    body := '{}'::jsonb);
$$);

select cron.schedule('notify-plan-expiry-pm', '30 13 * * *', $$
  select net.http_post(
    url := 'https://agtjszjedaenclbzgjvi.supabase.co/functions/v1/notify-plan-expiry',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-key', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'CRON_SECRET' limit 1), 'odds-cron-2026-farsession')),
    body := '{}'::jsonb);
$$);

-- 4. Check ------------------------------------------------------------------
-- Who would be pushed right now (no push sent):
--   select * from public.plan_expiry_push_rows(3);
-- Both jobs listed, active:
--   select jobname, schedule, active from cron.job where jobname like 'notify-plan-expiry-%';
-- After the first slot:
--   select * from public.plan_expiry_push_log order by sent_at desc limit 20;
