-- ============ Client-thread message → staff push (app-closed alerts) ============
-- Fires the notify-client-thread-message edge function on every new
-- client_thread_messages INSERT, async via pg_net so message sends are never
-- slowed or failed by push delivery. Same pattern as the longevity trigger.
--
-- BEFORE RUNNING: deploy the edge function first —
--   supabase functions deploy notify-client-thread-message
-- (or paste it in Dashboard -> Edge Functions). Then run this in SQL Editor.

create or replace function public.notify_client_thread_message_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url := 'https://agtjszjedaenclbzgjvi.supabase.co/functions/v1/notify-client-thread-message',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-key', 'odds-cron-2026-farsession'
    ),
    body := jsonb_build_object('message_id', NEW.id)
  );
  return NEW;
end;
$$;

drop trigger if exists trg_notify_client_thread_message on public.client_thread_messages;
create trigger trg_notify_client_thread_message
  after insert on public.client_thread_messages
  for each row execute function public.notify_client_thread_message_trigger();
