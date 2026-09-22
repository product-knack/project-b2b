-- ============ HOD can assign THERAPISTS from All Clients ============
-- The head-doctor policies on trainer_clients only allowed rows whose trainer
-- has role 'doctor' — saving a therapist assignment from the app was rejected
-- by RLS. Recreates both policies covering doctor AND therapist trainers.
-- (role compared as text so this works regardless of the user_role enum cast.)

drop policy if exists "Head doctor can update doctor assignments" on public.trainer_clients;
drop policy if exists "Head doctor can insert doctor assignments" on public.trainer_clients;

create policy "Head doctor can update doctor assignments"
on public.trainer_clients
as permissive for update to authenticated
using (
  auth.uid() = '30df5c2b-0f40-4736-9f41-7cbc830a191a'::uuid
  and exists (
    select 1 from public.profiles p
    where p.id = trainer_clients.trainer_id and p.role::text in ('doctor', 'therapist')
  )
)
with check (
  auth.uid() = '30df5c2b-0f40-4736-9f41-7cbc830a191a'::uuid
  and exists (
    select 1 from public.profiles p
    where p.id = trainer_clients.trainer_id and p.role::text in ('doctor', 'therapist')
  )
);

create policy "Head doctor can insert doctor assignments"
on public.trainer_clients
as permissive for insert to authenticated
with check (
  auth.uid() = '30df5c2b-0f40-4736-9f41-7cbc830a191a'::uuid
  and exists (
    select 1 from public.profiles p
    where p.id = trainer_clients.trainer_id and p.role::text in ('doctor', 'therapist')
  )
);

-- Proof: both policies exist (2 rows).
select policyname, cmd from pg_policies
where tablename = 'trainer_clients' and policyname like 'Head doctor%';
