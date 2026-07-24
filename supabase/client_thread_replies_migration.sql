-- OPTIONAL: enables swipe-to-reply linkage in Client Threads.
-- Without this, the app still works — replies just send as plain messages.
-- Run in Supabase SQL editor.

ALTER TABLE public.client_thread_messages
  ADD COLUMN IF NOT EXISTS reply_to_id uuid REFERENCES public.client_thread_messages(id) ON DELETE SET NULL;
