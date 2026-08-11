-- ============ Client Threads: Operations Head joins EVERY thread ============
-- Sunaina Sethia (Ops Head, profile 386dc683-d537-492b-b589-769f57e6c824,
-- ops@oddsfitness.com) gets standing access to every client's internal thread,
-- regardless of assignment - same blanket access as admins. Run in SQL Editor.

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
  )
  -- Operations Head: standing member of every client thread.
  or auth.uid() = '386dc683-d537-492b-b589-769f57e6c824'::uuid;
$$;
grant execute on function public.can_access_client_thread(uuid) to authenticated;
