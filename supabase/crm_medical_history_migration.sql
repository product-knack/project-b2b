-- ============ CRM access to Medical History (Upload Reports) ============
-- The native CRM client-detail page gains an "Upload Reports" button reusing the
-- doctor's Add Medical Entry flow (manual form + AI document upload). Live RLS
-- currently blocks CRMs entirely (verified 2026-07-23: SELECT 0 rows, INSERT and
-- storage upload both rejected), so these policies open exactly what the flow
-- needs — scoped to the CRM's OWN assigned, actively-training clients.
--
-- Run in Supabase Dashboard → SQL Editor.

-- Helper predicate used inline: the caller is a CRM assigned to the client.

-- 1. client_medical_history — read + add entries for assigned clients.
drop policy if exists "crm_select_assigned_medical" on public.client_medical_history;
create policy "crm_select_assigned_medical" on public.client_medical_history
for select using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'crm')
  and exists (
    select 1 from public.trainer_clients tc
    where tc.trainer_id = auth.uid()
      and tc.client_id = client_medical_history.client_id
      and tc.actively_training = true
  )
);

drop policy if exists "crm_insert_assigned_medical" on public.client_medical_history;
create policy "crm_insert_assigned_medical" on public.client_medical_history
for insert with check (
  doctor_id = auth.uid()
  and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'crm')
  and exists (
    select 1 from public.trainer_clients tc
    where tc.trainer_id = auth.uid()
      and tc.client_id = client_medical_history.client_id
      and tc.actively_training = true
  )
);

-- 2. client_findings — the AI-upload path inserts a placeholder row per file
--    (the process-finding-batch edge function then fills it via service role).
drop policy if exists "crm_select_assigned_findings" on public.client_findings;
create policy "crm_select_assigned_findings" on public.client_findings
for select using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'crm')
  and exists (
    select 1 from public.trainer_clients tc
    where tc.trainer_id = auth.uid()
      and tc.client_id = client_findings.client_id
      and tc.actively_training = true
  )
);

drop policy if exists "crm_insert_assigned_findings" on public.client_findings;
create policy "crm_insert_assigned_findings" on public.client_findings
for insert with check (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'crm')
  and exists (
    select 1 from public.trainer_clients tc
    where tc.trainer_id = auth.uid()
      and tc.client_id = client_findings.client_id
      and tc.actively_training = true
  )
);

-- 3. Storage — manual attachments go to medical-history-files, AI uploads to
--    client-documents (path `<clientId>/…`). CRMs may upload to both and read
--    medical-history-files (attachment viewing).
drop policy if exists "crm_upload_medical_files" on storage.objects;
create policy "crm_upload_medical_files" on storage.objects
for insert with check (
  bucket_id in ('medical-history-files', 'client-documents')
  and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'crm')
);

drop policy if exists "crm_read_medical_files" on storage.objects;
create policy "crm_read_medical_files" on storage.objects
for select using (
  bucket_id = 'medical-history-files'
  and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'crm')
);
