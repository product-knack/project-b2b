-- ============================================================================
-- FORCE-UPDATE GATE — minimum required app build per platform.
-- The app checks this at launch; installs older than min_version_code are
-- blocked behind an "Update Now" screen linking to store_url.
-- To force an update after publishing: bump min_version_code for the platform.
-- Run once in the Supabase SQL Editor.
-- ============================================================================

create table if not exists public.app_version_requirements (
  platform text primary key check (platform in ('android', 'ios')),
  min_version_code integer not null default 1,
  store_url text not null,
  message text,
  updated_at timestamptz not null default now()
);

alter table public.app_version_requirements enable row level security;

-- Readable by everyone (checked before login too); writable only via SQL editor / service role.
drop policy if exists avr_read on public.app_version_requirements;
create policy avr_read on public.app_version_requirements
  for select using (true);

insert into public.app_version_requirements (platform, min_version_code, store_url, message) values
  ('android', 1, 'https://play.google.com/store/apps/details?id=teampassport.oddsfitness.com',
   'A new version of Odds is available. Please update to continue.'),
  ('ios', 1, 'https://apps.apple.com/app/id0000000000',
   'A new version of Odds is available. Please update to continue.')
on conflict (platform) do nothing;

-- ─── Usage when you publish a new release ───────────────────────────────────
-- Example: you published versionCode 5 to Play and want everyone below it blocked:
--   update public.app_version_requirements
--   set min_version_code = 5, updated_at = now() where platform = 'android';
-- (For iOS, set min_version_code to the new buildNumber and fix store_url to
--  the real App Store id once the app is listed.)
