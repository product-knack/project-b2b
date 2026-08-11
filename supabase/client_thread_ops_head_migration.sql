-- ============ Client Threads: standing members join EVERY thread ============
-- Standing members get blanket access to every client's internal thread,
-- regardless of assignment (same as admins):
--   386dc683-d537-492b-b589-769f57e6c824  Sunaina Sethia (Ops Head)
--   2c6a0525-18d8-40aa-a5bb-df814a114452  designated admin
-- Idempotent - safe to re-run. Run in SQL Editor.

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
  -- Standing members: part of every client thread.
  or auth.uid() in (
    '386dc683-d537-492b-b589-769f57e6c824'::uuid,
    '2c6a0525-18d8-40aa-a5bb-df814a114452'::uuid
  );
$$;
grant execute on function public.can_access_client_thread(uuid) to authenticated;
