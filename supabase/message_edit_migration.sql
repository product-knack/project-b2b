-- ============ Messenger: edit your own message (with history) ============
-- Long-press a bubble → Edit message. The previous text is preserved in a new
-- jsonb column `edited_message` (array of prior versions), so every edit keeps
-- a durable trail on the SAME row:
--   edited_message: [{ "message": "<previous text>", "edited_at": "...", "edited_by": "<uuid>" }, ...]
-- The reader RPC get_messages_page RETURNS SETOF messages, so the new column
-- flows through it automatically — no change needed there.
-- Run in the Supabase SQL editor (idempotent).

alter table public.messages add column if not exists edited_message jsonb;

-- Editing goes ONLY through this definer RPC (no UPDATE policy on messages is
-- added): sender-only, text messages only, history appended atomically.
create or replace function public.edit_chat_message(
  p_message text,   -- messages.id (text-cast so the column type never bites)
  p_body text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_row record;
  v_body text := trim(coalesce(p_body, ''));
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if v_body = '' then raise exception 'message cannot be empty'; end if;

  select * into v_row from messages where id::text = p_message;
  if not found then raise exception 'message not found'; end if;
  if v_row.sender_id <> v_uid then raise exception 'you can only edit your own messages'; end if;
  if coalesce(v_row.is_deleted, false) then raise exception 'this message was deleted'; end if;
  if coalesce(v_row.message_type, 'text') <> 'text' then raise exception 'only text messages can be edited'; end if;
  if v_row.message = v_body then
    return jsonb_build_object('id', v_row.id, 'changed', false);
  end if;

  update messages set
    message = v_body,
    edited_message = coalesce(v_row.edited_message, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'message', v_row.message,
      'edited_at', now(),
      'edited_by', v_uid
    ))
  where id::text = p_message;

  return jsonb_build_object(
    'id', v_row.id,
    'changed', true,
    'edits', coalesce(jsonb_array_length(v_row.edited_message), 0) + 1);
end $$;
revoke all on function public.edit_chat_message(text, text) from public;
grant execute on function public.edit_chat_message(text, text) to authenticated;

-- Realtime: `messages` is already in the supabase_realtime publication (INSERT
-- events power the thread today). Publications publish UPDATE events too unless
-- created with a restricted publish list — the app now listens for UPDATE to
-- live-refresh edited bubbles. If edits do NOT appear live on a second device,
-- run:  alter publication supabase_realtime set (publish = 'insert, update, delete');
