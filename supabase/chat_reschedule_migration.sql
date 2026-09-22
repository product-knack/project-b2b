-- ============ Chat-agreed reschedules (AI-assisted) — migration ============
-- Run in the Supabase SQL editor (idempotent). Pairs with the edge function
-- supabase/functions/analyze-chat-reschedule (deploy it + set GEMINI_API_KEY
-- or LOVABLE_API_KEY as a function secret; CRON_SECRET already exists).
--
-- Flow: trainer/client agree a new time in the "My Care Team" chat → messages
-- INSERT trigger (cheap SQL prefilter) → pg_net → edge fn (Gemini, strict JSON,
-- candidates constrained to real upcoming sessions) → suggestion row → chip in
-- the trainer's chat → trainer taps Accept → chat_accept_reschedule RPC moves
-- the real session_schedule row + posts a 'session_update' notice into the
-- trainer's Team Messenger thread. The AI NEVER writes the roster.

-- 1) Suggestions table -------------------------------------------------------
create table if not exists public.chat_reschedule_suggestions (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  message_id uuid not null,
  trainer_id uuid not null,          -- the session's trainer (only they see/act)
  client_id uuid not null,
  schedule_id uuid not null references public.session_schedule(id) on delete cascade,
  old_datetime timestamptz not null,
  proposed_datetime timestamptz not null,
  confidence numeric,
  evidence text,                     -- the quoted chat line the AI based this on
  status text not null default 'pending',  -- pending | accepted | dismissed | expired
  created_at timestamptz not null default now()
);
create index if not exists idx_crs_trainer_status on public.chat_reschedule_suggestions (trainer_id, status);
create index if not exists idx_crs_conversation on public.chat_reschedule_suggestions (conversation_id);

alter table public.chat_reschedule_suggestions enable row level security;
-- Only the session's trainer sees their suggestions.
drop policy if exists "crs trainer reads own" on public.chat_reschedule_suggestions;
create policy "crs trainer reads own" on public.chat_reschedule_suggestions
  for select to authenticated using (trainer_id = auth.uid());
-- Trainer may dismiss a pending suggestion (accept goes through the RPC).
drop policy if exists "crs trainer dismisses own" on public.chat_reschedule_suggestions;
create policy "crs trainer dismisses own" on public.chat_reschedule_suggestions
  for update to authenticated
  using (trainer_id = auth.uid() and status = 'pending')
  with check (trainer_id = auth.uid() and status = 'dismissed');
-- No INSERT policy: only the edge function (service role) writes suggestions.

-- Realtime so the chip appears live in the open chat.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'chat_reschedule_suggestions'
  ) then
    alter publication supabase_realtime add table public.chat_reschedule_suggestions;
  end if;
end $$;

-- 2) Prefilter trigger on messages ------------------------------------------
-- Fires the edge fn ONLY when: a text message in a client-linked (care team)
-- conversation matches a time-ish pattern AND that client has an upcoming
-- session in the next 48h. Everything else never touches the AI.
create or replace function public.trg_chat_reschedule_analyze() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_client uuid;
begin
  if new.is_deleted or new.message_type <> 'text' or new.message is null then return new; end if;
  if new.message !~* '(\d{1,2}\s*[:.]\s*\d{2})|(\d{1,2}\s*(am|pm|baje|bje))|(\mkal\M)|(\maaj\M)|shift|resched|time\s*(change|badal)|(c|see)\s*(u|you)\s*at' then
    return new;
  end if;
  select client_id into v_client from conversations where id = new.conversation_id and client_id is not null;
  if v_client is null then return new; end if;
  if not exists (
    select 1 from session_schedule ss
      where ss.client_id = v_client
        and ss.scheduled_datetime between now() - interval '2 hours' and now() + interval '48 hours'
        and (ss.status is null or ss.status not in ('cancelled'))
        and ss.workout_session_id is null
  ) then
    return new;
  end if;
  perform net.http_post(
    url := 'https://agtjszjedaenclbzgjvi.supabase.co/functions/v1/analyze-chat-reschedule',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-key', 'odds-cron-2026-farsession'
    ),
    body := jsonb_build_object('message_id', new.id, 'conversation_id', new.conversation_id, 'client_id', v_client)
  );
  return new;
end $$;

drop trigger if exists chat_reschedule_analyze on public.messages;
create trigger chat_reschedule_analyze after insert on public.messages
  for each row execute function public.trg_chat_reschedule_analyze();

-- 3) Accept RPC: the trainer's single tap ------------------------------------
-- Moves the REAL roster row and posts the Team Messenger notice atomically.
create or replace function public.chat_accept_reschedule(p_suggestion uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_s record;
  v_row record;
  v_score uuid;
  v_client_name text;
  v_from text;
  v_to text;
  v_date date;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select * into v_s from chat_reschedule_suggestions where id = p_suggestion;
  if not found then raise exception 'suggestion not found'; end if;
  if v_s.trainer_id <> v_uid then raise exception 'only the session trainer can accept'; end if;
  if v_s.status <> 'pending' then raise exception 'suggestion is no longer pending'; end if;
  if v_s.proposed_datetime <= now() then
    update chat_reschedule_suggestions set status = 'expired' where id = p_suggestion;
    raise exception 'proposed time has already passed';
  end if;

  select * into v_row from session_schedule where id = v_s.schedule_id;
  if not found then raise exception 'session not found'; end if;
  if v_row.status = 'cancelled' then raise exception 'session is cancelled'; end if;
  if v_row.workout_session_id is not null then raise exception 'session is already logged'; end if;

  update session_schedule set
    scheduled_datetime = v_s.proposed_datetime,
    reschedule_status = 'approved',
    reschedule_processed_at = now(),
    reschedule_approved_by = v_uid,
    reschedule_request = 'Rescheduled from client chat (AI-suggested, trainer-approved)'
  where id = v_s.schedule_id;

  update chat_reschedule_suggestions set status = 'accepted' where id = p_suggestion;

  -- Team Messenger notice for the manager (skip silently if not in a team).
  select ms.id into v_score from manager_score ms
    where (ms.manager_id = v_uid or ms.team_json ? v_uid::text)
      and ms.team_start <= (now() at time zone 'Asia/Kolkata')::date
      and (ms.team_end is null or ms.team_end >= (now() at time zone 'Asia/Kolkata')::date)
    order by ms.team_start desc limit 1;
  if v_score is not null then
    select trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')) into v_client_name
      from clients where id = v_s.client_id;
    v_from := to_char(v_s.old_datetime at time zone 'Asia/Kolkata', 'FMHH12:MI AM');
    v_to   := to_char(v_s.proposed_datetime at time zone 'Asia/Kolkata', 'FMHH12:MI AM');
    v_date := (v_s.proposed_datetime at time zone 'Asia/Kolkata')::date;
    insert into manager_team_messages (team_id, sender_id, kind, payload, body)
      values (
        v_score, v_uid, 'session_update',
        jsonb_build_object(
          'date', v_date, 'client_id', v_s.client_id, 'name', coalesce(v_client_name, 'Client'),
          'trainer_id', v_uid, 'schedule_id', v_s.schedule_id,
          'from_time', to_char(v_s.old_datetime at time zone 'Asia/Kolkata', 'HH24:MI'),
          'to_time', to_char(v_s.proposed_datetime at time zone 'Asia/Kolkata', 'HH24:MI'),
          'source', 'client_chat'
        ),
        'Session updated · ' || coalesce(v_client_name, 'Client') || ' moved ' || v_from || ' to ' || v_to || ' (agreed in client chat)'
      );
  end if;

  return jsonb_build_object('schedule_id', v_s.schedule_id, 'new_datetime', v_s.proposed_datetime);
end $$;
revoke all on function public.chat_accept_reschedule(uuid) from public;
grant execute on function public.chat_accept_reschedule(uuid) to authenticated;
