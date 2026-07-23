-- ============ Longevity Team message → CRM push (app-closed alerts) ============
-- Fires the notify-longevity-message edge function on EVERY new chat message in
-- a care-team GROUP conversation (any type='group' except Odds Announcements),
-- regardless of which app sent it (B2B staff or B2C client). The edge function
-- filters recipients to CRM participants and pushes on the 'longevity-alerts'
-- Android channel (~30s vibration on the notification itself) — this is what
-- makes the 2-minute reply commitment hold with the CRM's app closed.
--
-- Requires the pg_net extension (already enabled for the far-session cron).
-- Run in Supabase Dashboard → SQL Editor.

create or replace function public.notify_longevity_message_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only care-team group messages; the http call is async (pg_net) so message
  -- inserts are never slowed or failed by push delivery.
  if exists (
    select 1 from conversations c
    where c.id = NEW.conversation_id
      and c.type = 'group'
      and coalesce(c.name, '') <> 'Odds Announcements'
  ) then
    perform net.http_post(
      url := 'https://agtjszjedaenclbzgjvi.supabase.co/functions/v1/notify-longevity-message',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-key', 'odds-cron-2026-farsession'
      ),
      body := jsonb_build_object('message_id', NEW.id)
    );
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_notify_longevity_message on public.messages;
create trigger trg_notify_longevity_message
after insert on public.messages
for each row execute function public.notify_longevity_message_trigger();
