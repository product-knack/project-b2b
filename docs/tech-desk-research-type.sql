-- Tech Desk: add a third ticket type, "research".
-- Run in the Supabase SQL editor (project agtjszjedaenclbzgjvi).
--
-- Verified 4 Sep 2026: the enum currently has only bug + feature. Querying
--   /tech_tickets?type=eq.research
-- returns  22P02  invalid input value for enum tech_ticket_type: "research"
-- so until STEP 1 runs, raising a research ticket fails on insert.

-- ===========================================================================
-- STEP 1 — RUN THIS ALONE, BY ITSELF, AND LET IT COMMIT.
-- ===========================================================================
-- Postgres will not let a new enum value be USED in the same transaction that
-- adds it ("unsafe use of new value ... of enum type"). The SQL editor wraps a
-- multi-statement script in one transaction, so pasting this together with the
-- verification select below fails. Same rule we hit adding the 'tech' role.
--
-- Select ONLY this line and run it:

ALTER TYPE public.tech_ticket_type ADD VALUE IF NOT EXISTS 'research';


-- ===========================================================================
-- STEP 2 — after step 1 has committed, run this to verify.
-- ===========================================================================
-- Expect: bug, feature, research

SELECT e.enumlabel
  FROM pg_enum e
  JOIN pg_type t ON t.oid = e.enumtypid
 WHERE t.typname = 'tech_ticket_type'
 ORDER BY e.enumsortorder;


-- ===========================================================================
-- Notes
-- ===========================================================================
-- * Nothing else in the schema changes. `type` has no CHECK constraint beyond the
--   enum, no trigger branches on it, and RLS does not reference it.
-- * Enum values cannot be removed in Postgres. Adding 'research' is one-way —
--   reverting means recreating the type and rewriting the column.
-- * Ordering: ADD VALUE appends, so 'research' sorts last. Nothing in the app
--   orders by type, so this is cosmetic.
--
-- WEB SIDE (hub-track) — required for parity.
-- Checked on 4 Sep: the web has NO research type in src/ (searched src/lib/techDesk.ts
-- and src/components/tech/*). It needs, mirroring the native change:
--   1. TechTicketType union            -> add "research"
--   2. type label map                  -> Research
--   3. RaiseTicketDialog segmented control -> a third option
--   4. the description prompt per type -> "What should we look into, and what
--                                          decision does it inform?"
--   5. TicketInbox type filter         -> a Research option
--   6. row + detail glyph              -> an icon for research
-- Until then, a research ticket raised from the app shows in the web console with
-- whatever the type fallback renders, and web users cannot raise one.
