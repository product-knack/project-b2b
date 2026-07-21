-- ============================================================================
-- CLIENT THREADS — dedicated tables, fully separated from the messenger.
-- One internal team thread per client. Membership is NOT stored: access is
-- derived live from trainer_clients (actively_training = true) + admins.
-- Clients can never pass the access check (their uid is never a trainer_id
-- and their role is never admin) — structural client lockout.
-- Run once in the Supabase SQL Editor.
-- ============================================================================

-- 1. Tables ------------------------------------------------------------------
create table if not exists public.client_threads (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null unique references public.clients(id) on delete cascade,
  created_by uuid references public.profiles(id),
  last_message_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.client_thread_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.client_threads(id) on delete cascade,
  sender_id uuid not null references public.profiles(id),
  body text,
  attachment_url text,
  attachment_type text,
  created_at timestamptz not null default now()
);
create index if not exists idx_ctm_thread_created
  on public.client_thread_messages (thread_id, created_at desc);

create table if not exists public.client_thread_reads (
  thread_id uuid not null references public.client_threads(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);

-- 2. Access check: STRICTLY assigned team (any staff role via trainer_clients,
--    actively_training) + admins/super_admins. ------------------------------
create or replace function public.can_access_client_thread(p_client uuid)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1 from trainer_clients tc
    where tc.client_id = p_client
      and tc.trainer_id = auth.uid()
      and tc.actively_training = true
  )
  or exists (
    select 1 from profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'super_admin')
  );
$$;
grant execute on function public.can_access_client_thread(uuid) to authenticated;

-- 3. RLS ---------------------------------------------------------------------
alter table public.client_threads enable row level security;
alter table public.client_thread_messages enable row level security;
alter table public.client_thread_reads enable row level security;

drop policy if exists ct_select on public.client_threads;
create policy ct_select on public.client_threads
  for select using (public.can_access_client_thread(client_id));

drop policy if exists ct_insert on public.client_threads;
create policy ct_insert on public.client_threads
  for insert with check (public.can_access_client_thread(client_id));

drop policy if exists ctm_select on public.client_thread_messages;
create policy ctm_select on public.client_thread_messages
  for select using (exists (
    select 1 from public.client_threads t
    where t.id = thread_id and public.can_access_client_thread(t.client_id)
  ));

-- Immutable log: insert-only, must be your own message, into an accessible thread.
drop policy if exists ctm_insert on public.client_thread_messages;
create policy ctm_insert on public.client_thread_messages
  for insert with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.client_threads t
      where t.id = thread_id and public.can_access_client_thread(t.client_id)
    )
  );

drop policy if exists ctr_all on public.client_thread_reads;
create policy ctr_all on public.client_thread_reads
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 4. RPC: authorize + race-safe get-or-create, returns the thread id ---------
create or replace function public.open_client_thread(p_client_id uuid)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if auth.uid() is null or not public.can_access_client_thread(p_client_id) then
    raise exception 'Not authorized for this client thread';
  end if;
  insert into client_threads (client_id, created_by)
  values (p_client_id, auth.uid())
  on conflict (client_id) do update set client_id = excluded.client_id
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.open_client_thread(uuid) to authenticated;

-- 5. Trigger: keep last_message_at fresh for inbox ordering ------------------
create or replace function public.bump_client_thread_ts()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update client_threads set last_message_at = new.created_at where id = new.thread_id;
  return new;
end;
$$;
drop trigger if exists trg_bump_client_thread on public.client_thread_messages;
create trigger trg_bump_client_thread
  after insert on public.client_thread_messages
  for each row execute function public.bump_client_thread_ts();

-- 6. Realtime: live message delivery -----------------------------------------
alter publication supabase_realtime add table public.client_thread_messages;
