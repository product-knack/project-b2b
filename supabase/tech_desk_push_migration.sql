-- ============ Tech Desk push notifications ============
-- Reporter and Tech get a push for every ticket event (with the app closed), plus
-- three cron nudges. Same shape as the client-thread push: pg_net trigger -> edge
-- function -> FCM via odds_device_tokens.
--
-- ORDER:
--   1. Deploy the two functions FIRST (a trigger pointing at a missing function
--      just queues 404s in net.http_request_queue):
--        supabase functions deploy notify-tech-desk --no-verify-jwt
--        supabase functions deploy notify-tech-desk-reminders --no-verify-jwt
--      Secrets already set from the other push functions: SUPABASE_URL,
--      SUPABASE_SERVICE_ROLE_KEY, FIREBASE_SERVICE_ACCOUNT_JSON, CRON_SECRET.
--   2. Run this whole file in the SQL editor. Idempotent, safe to re-run.
-- pg_cron and pg_net are already enabled (far-session alerts use both).

-- 1. Dedupe / suppression log ----------------------------------------------
-- One row per push actually sent. The event function drops a second push to the
-- same person + ticket inside 60 s; the reminder function keys its once-per-day
-- and once-per-ticket rules on kind. Rows go with the ticket when it is deleted.
create table if not exists public.tech_push_log (
  id         bigint generated always as identity primary key,
  recipient  uuid not null references public.profiles(id) on delete cascade,
  ticket_id  uuid not null references public.tech_tickets(id) on delete cascade,
  kind       text not null,
  sent_at    timestamptz not null default now()
);
create index if not exists tech_push_log_ticket_recent
  on public.tech_push_log (ticket_id, recipient, sent_at desc);
-- Service role only: the functions write it, no client ever reads it.
alter table public.tech_push_log enable row level security;

-- 2. Event trigger ----------------------------------------------------------
-- Every Tech Desk event already lands a row in tech_ticket_messages (system rows,
-- replies, and the acknowledge / close-with-reason text rows), so this ONE trigger
-- covers all of them. The call is async through pg_net and wrapped so a push
-- problem can never fail or slow the insert that caused it.
create or replace function public.notify_tech_desk_message_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
begin
  begin
    select decrypted_secret into v_key from vault.decrypted_secrets where name = 'CRON_SECRET' limit 1;
  exception when others then
    v_key := null;
  end;
  perform net.http_post(
    url := 'https://agtjszjedaenclbzgjvi.supabase.co/functions/v1/notify-tech-desk',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-key', coalesce(v_key, 'odds-cron-2026-farsession')
    ),
    body := jsonb_build_object('message_id', NEW.id)
  );
  return NEW;
exception when others then
  return NEW; -- pushes must never break a write
end;
$$;

drop trigger if exists trg_notify_tech_desk_message on public.tech_ticket_messages;
create trigger trg_notify_tech_desk_message
  after insert on public.tech_ticket_messages
  for each row execute function public.notify_tech_desk_message_trigger();

-- 3. Reminder cron (every 15 min) ------------------------------------------
do $$ begin
  perform cron.unschedule('notify-tech-desk-reminders');
exception when others then null; end $$;

select cron.schedule(
  'notify-tech-desk-reminders',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://agtjszjedaenclbzgjvi.supabase.co/functions/v1/notify-tech-desk-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-key', coalesce(
        (select decrypted_secret from vault.decrypted_secrets where name = 'CRON_SECRET' limit 1),
        'odds-cron-2026-farsession')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- 4. Check ------------------------------------------------------------------
-- select jobname, schedule, active from cron.job where jobname = 'notify-tech-desk-reminders';
-- select tgname from pg_trigger where tgname = 'trg_notify_tech_desk_message';
-- After a test reply from the app:
-- select recipient, kind, sent_at from public.tech_push_log order by sent_at desc limit 10;
-- select status_code, content from net._http_response order by id desc limit 5;
