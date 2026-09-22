-- ============ QHP Manager: who booked the QHP (ops attribution) ============
-- The Task Pending cards (Not Scheduled / Scheduled) come from leads in the
-- "QHP Booked" stage. leads.qhp_booked_by records WHO set that stage (ops
-- staff), but the QHP manager role cannot read leads directly (RLS) — this
-- definer RPC returns just the attribution for the given clients.
-- Fallback for older leads without qhp_booked_by: the lead's creator.
-- Run once in the SQL editor.

create or replace function public.get_lead_qhp_booked_by(_client_ids uuid[])
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_out jsonb;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'client_id', x.client_id,
    'booked_by_name', nullif(trim(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')), ''),
    'booked_by_role', x.booked_role
  )), '[]'::jsonb)
  into v_out
  from (
    select distinct on (l.client_id)
           l.client_id,
           coalesce(l.qhp_booked_by, l.created_by) as booked_id,
           coalesce(l.qhp_booked_by_role, l.created_by_role) as booked_role
    from leads l
    where l.client_id = any(_client_ids)
    order by l.client_id, l.updated_at desc nulls last
  ) x
  left join profiles p on p.id = x.booked_id;
  return v_out;
end $$;
revoke all on function public.get_lead_qhp_booked_by(uuid[]) from public;
grant execute on function public.get_lead_qhp_booked_by(uuid[]) to authenticated;
