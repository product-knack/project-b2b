---
name: client-threads-backend
description: "Client Threads feature DB objects live only in Supabase (not in either repo) — conversations.client_id, type 'client', RPC get_or_create_client_thread"
metadata: 
  node_type: memory
  type: project
  originSessionId: 1868ff08-17e9-4ae7-91d8-6bffa2573efa
---

The "Client Threads" feature (one team chat per client, added 2026-07-10) has DB-side objects that exist ONLY in the live Supabase project — they are not in the odds-app repo nor the old hybrid-b2b repo:

- `conversations.client_id uuid REFERENCES clients(id)` + unique partial index `uq_conversations_client_thread` on (client_id) WHERE type='client'.
- `conversations_type_check` CHECK was widened to `('direct','group','team','client')`.
- RPC `get_or_create_client_thread(p_client_id uuid)` — SECURITY DEFINER; authorizes caller via trainer_clients (actively_training) or admin/super_admin role; creates/renames the thread (name = client full name); syncs participants = all actively-assigned staff + caller; deactivates unassigned staff. Grant: authenticated.

**Why:** the user runs all DDL by hand in the Supabase SQL editor (I have anon key only); there is no migrations folder for the new app, so this schema drift is otherwise invisible from the code.

**How to apply:** when touching messenger/threads code, remember `type='client'` conversations exist; app side is `useOpenClientThread` / `useClientThreadMap` in [[odds-app]] src/lib/chatQueries.ts, ClientThreads screen in messenger.tsx, route 'client-threads'. Messages RLS stays participant-only; messages have no DELETE policy (immutable).
