-- ============ Roster request: carry the trainer's chosen modality ============
-- The trainer now picks the session modality when requesting a single-day
-- roster; the CRM's approve dialog prefills it (still editable). Nullable —
-- old requests and the web app are unaffected.
-- Run in Supabase Dashboard → SQL Editor.

alter table public.all_requests add column if not exists modality text;
