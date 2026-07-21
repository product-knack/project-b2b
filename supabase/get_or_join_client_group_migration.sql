-- ============ get_or_join_client_group ============
-- Locates a client's care-team GROUP conversation ("My Care Team" /
-- "My Longevity Team") and adds the CALLER as an active participant if they
-- aren't one yet. Returns the conversation id, or NULL when no group exists
-- or the caller isn't authorized.
--
-- Why: assigned staff (especially CRMs) are often NOT participants of the
-- client's group. Without membership, RLS hides the group's messages, so
-- realtime never delivers them — no unread counts, no banners, and no
-- Longevity-Team vibration alert. The native app already calls this RPC
-- (chatQueries.resolveClientGroup) with a silent fallback; this migration
-- makes it real.
--
-- Authorization: the caller must be actively assigned to the client via
-- trainer_clients, OR be an admin/super_admin.
--
-- Run this in the Supabase Dashboard → SQL Editor.

create or replace function public.get_or_join_client_group(p_client_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_client_profile uuid;
  v_conv uuid;
  v_role text;
begin
  if v_uid is null then
    return null;
  end if;

  -- Caller must be assigned staff for this client, or an admin.
  select role into v_role from profiles where id = v_uid;
  if not exists (
    select 1 from trainer_clients
    where trainer_id = v_uid and client_id = p_client_id and actively_training = true
  ) and coalesce(v_role, '') not in ('admin', 'super_admin') then
    return null;
  end if;

  select profile_id into v_client_profile from clients where id = p_client_id;
  if v_client_profile is null then
    return null;
  end if;

  -- The client's care-team group: a type='group' conversation the CLIENT is an
  -- active participant of (excluding the Odds Announcements broadcast).
  -- Prefer the canonical care-team names, else the newest matching group.
  select c.id into v_conv
  from conversations c
  join conversation_participants cp
    on cp.conversation_id = c.id and cp.user_id = v_client_profile and cp.is_active = true
  where c.type = 'group' and coalesce(c.name, '') <> 'Odds Announcements'
  order by (c.name in ('My Care Team', 'My Longevity Team')) desc, c.created_at desc
  limit 1;

  if v_conv is null then
    return null;
  end if;

  -- Join the caller (idempotent): reactivate a stale row or insert a new one.
  update conversation_participants
     set is_active = true
   where conversation_id = v_conv and user_id = v_uid and is_active = false;

  if not exists (
    select 1 from conversation_participants
    where conversation_id = v_conv and user_id = v_uid
  ) then
    insert into conversation_participants (conversation_id, user_id, is_active, joined_at)
    values (v_conv, v_uid, true, now());
  end if;

  return v_conv;
end;
$$;

grant execute on function public.get_or_join_client_group(uuid) to authenticated;
