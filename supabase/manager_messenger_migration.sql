-- ============ Managers Messenger — migration ============
-- One table + one SECURITY DEFINER helper + RLS + realtime, per
-- docs/managers-messenger-spec.md. Run in the Supabase SQL editor (idempotent).
-- The thread-scoping column is team_id = manager_score.id (the competition
-- team row). It was originally named score_id; the rename block below migrates
-- live deployments in place, keeping all data.

-- Rename score_id -> team_id on existing deployments (no-op once renamed).
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'manager_team_messages' and column_name = 'score_id'
  ) then
    alter table public.manager_team_messages rename column score_id to team_id;
  end if;
end $$;
alter index if exists idx_mtm_score_created rename to idx_mtm_team_created;

create table if not exists public.manager_team_messages (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.manager_score(id) on delete cascade,
  sender_id uuid not null,
  kind text not null default 'text',        -- 'text' | 'tomorrow_plan' | 'plan_time_edit'
  payload jsonb,                            -- tomorrow_plan: {date, entries:[{client_id,name,time,modality,schedule_id}]}
  body text not null,                       -- always readable plain text (fallback for template kinds)
  created_at timestamptz not null default now()
);

create index if not exists idx_mtm_team_created
  on public.manager_team_messages (team_id, created_at);

-- Ever-posted check for the SELECT policy. SECURITY DEFINER so the policy can
-- consult the same table without RLS recursion. (Membership decision, CLOSED:
-- leavers keep read access only if they ever posted.)
-- NOTE: p_score parameter name kept (changing param names needs a drop/create
-- cycle through the dependent policies); it carries the manager_score id.
create or replace function public.was_participant(p_score uuid, p_user uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.manager_team_messages
    where team_id = p_score and sender_id = p_user
  );
$$;
revoke all on function public.was_participant(uuid, uuid) from public;
grant execute on function public.was_participant(uuid, uuid) to authenticated;

alter table public.manager_team_messages enable row level security;

-- READ: current team members (manager or team_json) OR anyone who ever posted
-- in the thread. Mid-competition joiners therefore see FULL history (intentional).
drop policy if exists "mtm members read" on public.manager_team_messages;
create policy "mtm members read" on public.manager_team_messages
  for select to authenticated using (
    exists (
      select 1 from public.manager_score ms
      where ms.id = team_id
        and (ms.manager_id = auth.uid() or ms.team_json ? auth.uid()::text)
    )
    or public.was_participant(team_id, auth.uid())
  );

-- WRITE: only CURRENT members, only INSIDE the competition window (IST-anchored),
-- and only as themselves. Post-window messaging is impossible server-side.
-- Manager-only kinds: 'plan_remark' (legacy) and 'plan_time_edit' (manager
-- reschedules a member's plan entry).
drop policy if exists "mtm current members post in window" on public.manager_team_messages;
create policy "mtm current members post in window" on public.manager_team_messages
  for insert to authenticated with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.manager_score ms
      where ms.id = team_id
        and (ms.manager_id = auth.uid() or ms.team_json ? auth.uid()::text)
        and ms.team_start <= (now() at time zone 'Asia/Kolkata')::date
        and (ms.team_end is null or ms.team_end >= (now() at time zone 'Asia/Kolkata')::date)
    )
    and (
      kind not in ('plan_remark', 'plan_time_edit', 'plan_reschedule_decision', 'plan_add')
      or exists (
        select 1 from public.manager_score ms2
        where ms2.id = team_id and ms2.manager_id = auth.uid()
      )
    )
  );

-- No UPDATE / DELETE policies: messages are immutable.

-- Realtime (postgres_changes; WALRUS enforces the SELECT policy per subscriber).
-- Idempotent: skips if the table is already in the publication.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'manager_team_messages'
  ) then
    alter publication supabase_realtime add table public.manager_team_messages;
  end if;
end $$;
