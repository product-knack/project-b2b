-- ============================================================================
-- CLEANUP: delete the OLD messenger-based client-thread test data.
-- Removes every conversation of type 'client' plus its messages and
-- participants, in FK-safe order. Regular DMs / groups / announcements are
-- untouched. Run once in the Supabase SQL Editor AFTER the new-tables
-- migration is in place.
-- ============================================================================

begin;

-- Safety preview counts (visible in the editor output before the deletes):
select
  (select count(*) from conversations where type = 'client')            as client_conversations,
  (select count(*) from messages m
     join conversations c on c.id = m.conversation_id
     where c.type = 'client')                                           as their_messages,
  (select count(*) from conversation_participants cp
     join conversations c on c.id = cp.conversation_id
     where c.type = 'client')                                           as their_participants;

-- 1. Messages first (FK → conversations)
delete from messages m
using conversations c
where c.id = m.conversation_id and c.type = 'client';

-- 2. Participants (FK → conversations)
delete from conversation_participants cp
using conversations c
where c.id = cp.conversation_id and c.type = 'client';

-- 3. The conversation rows themselves
delete from conversations where type = 'client';

commit;
