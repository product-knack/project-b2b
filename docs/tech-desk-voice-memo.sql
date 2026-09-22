-- Tech Desk voice memos — backend enablement
-- Run in the Supabase SQL editor (project agtjszjedaenclbzgjvi).
--
-- Verified 3 Sep 2026: uploading audio/m4a to `tech-ticket-files` fails with
--   415 InvalidMimeType — "mime type audio/m4a is not supported"
-- because the bucket was created with allowed_mime_types = {image/*, video/*, application/pdf}
-- (supabase/migrations/20260903110100_tech_desk.sql in the hub-track repo).
-- Until this runs, the Record button fails at upload time on app AND web.

-- ---------------------------------------------------------------------------
-- Allow audio uploads in the Tech Desk bucket (size limit unchanged at 25 MB).
UPDATE storage.buckets
   SET allowed_mime_types = ARRAY['image/*', 'video/*', 'audio/*', 'application/pdf']
 WHERE id = 'tech-ticket-files';

-- Verify: expect audio/* in the array.
SELECT id, file_size_limit, allowed_mime_types
  FROM storage.buckets
 WHERE id = 'tech-ticket-files';

-- ---------------------------------------------------------------------------
-- NOTE — do NOT try to DELETE FROM storage.objects here.
-- Supabase blocks it with a trigger:
--   ERROR 42501: Direct deletion from storage tables is not allowed.
--                Use the Storage API instead.  (storage.protect_delete())
-- and because the SQL editor runs the whole script in one transaction, a failed
-- DELETE also rolls back the UPDATE above.
--
-- A 1-byte object `mimetest-1788509842675.bin` was left under ticket
-- 0cf606af-586e-4350-ac7b-56f8d3c1f376 by the MIME probe. It is orphaned (no
-- message row references it) and harmless. To remove it, use the Storage UI:
--   Dashboard -> Storage -> tech-ticket-files -> 0cf606af-…-aa0504de9f68 ->
--   select mimetest-1788509842675.bin -> Delete
-- The bucket has no DELETE policy for `authenticated`, so only the dashboard
-- (service role) or the SECURITY DEFINER cleanup trigger can remove objects.

-- ---------------------------------------------------------------------------
-- WEB SIDE (hub-track) — required for parity, not optional.
-- The app writes { type:'file', file:{ …, kind:'audio' }, text? }. The web union in
-- src/lib/techDesk.ts is kind: "image" | "video" | "pdf", so a voice memo from the
-- app renders as an unknown attachment until 'audio' is added there with a player.
-- No further SQL: the message CHECK only enforces message->>'type' IN ('text','file');
-- `kind` is unconstrained jsonb.
