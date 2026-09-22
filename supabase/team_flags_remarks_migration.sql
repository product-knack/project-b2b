-- ============ Team Flags: manager remarks + member self-view ============
-- 1. Members can read team_flags rows again — each member's APP shows only
--    their own trainer block; the manager sees the whole team. (This restores
--    the original read policy; the earlier manager-only carve-out is dropped
--    because members must now see their own flag + the manager's remark.)
-- 2. The manager (and only the manager, and only on team_flags rows) may
--    UPDATE the message payload — that is how the mandatory closing remark is
--    stored inside the flag JSON. All other kinds stay immutable.
-- Run in the SQL Editor (idempotent).

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

drop policy if exists "mtm manager closes team flags" on public.manager_team_messages;
create policy "mtm manager closes team flags" on public.manager_team_messages
  for update to authenticated
  using (
    kind = 'team_flags'
    and exists (
      select 1 from public.manager_score ms
      where ms.id = team_id and ms.manager_id = auth.uid()
    )
  )
  with check (
    kind = 'team_flags'
    and exists (
      select 1 from public.manager_score ms
      where ms.id = team_id and ms.manager_id = auth.uid()
    )
  );
