-- Trainer incentives: User Generated Content (UGC) submissions. 19 Sep 2026.
--
-- incentive_events today (live): id, user_id, client_id, event_type, previous_value,
-- new_value, reference_id, reference_table, event_date, created_at, event_month.
-- event_type CHECK allows referral | cross_sell | package_upgrade | subscription_upgrade.
-- RLS: SELECT own rows (+ admin all), INSERT any authenticated, no UPDATE / DELETE.
--
-- The trainer app's Incentive page writes UGC submissions into this table, so it
-- needs: the 'ugc' event type, a nullable `status` (NULL for the existing
-- approval-created rows, 'pending' for a fresh UGC submission), and a `details`
-- jsonb for the form fields (content type, post URL, notes). Run once in the
-- SQL editor; existing rows are untouched (status stays NULL).

alter table public.incentive_events add column if not exists status text null;
alter table public.incentive_events add column if not exists details jsonb null;

alter table public.incentive_events drop constraint if exists incentive_events_event_type_check;
alter table public.incentive_events add constraint incentive_events_event_type_check
  check (event_type in ('referral', 'cross_sell', 'package_upgrade', 'subscription_upgrade', 'ugc'));

alter table public.incentive_events drop constraint if exists incentive_events_status_check;
alter table public.incentive_events add constraint incentive_events_status_check
  check (status is null or status in ('pending', 'approved', 'rejected'));

comment on column public.incentive_events.status is 'NULL = created by an admin approval (already earned). ''pending'' | ''approved'' | ''rejected'' for self-submitted events (UGC from the trainer app).';
comment on column public.incentive_events.details is 'Self-submitted event payload. UGC: {"content_type": "reel_collab" | "reel_no_collab" | "stories", "post_url": text, "notes": text | null, "platform": "instagram"}';

create index if not exists idx_incentive_events_status on public.incentive_events(status) where status is not null;

-- Verify: both columns present, CHECK lists 'ugc'
select column_name, data_type, is_nullable from information_schema.columns
where table_name = 'incentive_events' and column_name in ('status', 'details');
select pg_get_constraintdef(oid) from pg_constraint where conname = 'incentive_events_event_type_check';
