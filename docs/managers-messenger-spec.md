# SPEC — "Managers Messenger" (team chat per competition) — PARKED, ready to build

Status: **parked by priority call (Aug 20, 2026)** — behind Doctor Consultation testing,
store builds, native audit fixes. Spec is complete and build-ready; est. ~1 day.
No deadline pressure: current competition window runs to 31 Jan 2027.

## What it is
A chat thread per competition team. Entry card on the home dashboard for anyone in a
current team; tap → team chat. The thread is scoped to the team's `manager_score` row and
its competition window. When the competition ends, the chat turns read-only automatically.
When a new batch/team is created, the chat re-points to the new thread automatically.

## Ground truth (verified live)
`manager_score` = one row per team per batch:
`{id, manager_id, team_name, team_json: [member profile ids], team_start, team_end, winner, target}`.
"Current competition" = the leaderboard's existing rule: ongoing rows
(`team_end` null or >= today), else the latest `team_start` batch. The chat MUST reuse this
exact resolution (shared helper) so leaderboard and chat never disagree.
Live at spec time: 3 teams (Priyanshu / khalid / Sagar), window 2026-08-01 → 2027-01-31.

## Database — ONE new table (constraint honored)
```sql
create table manager_team_messages (
  id uuid primary key default gen_random_uuid(),
  score_id uuid not null references manager_score(id),
  sender_id uuid not null,
  body text not null,
  created_at timestamptz not null default now()
);
-- index (score_id, created_at); add to supabase_realtime publication.
```
Plus one SECURITY DEFINER helper (a function, not a table):
`was_participant(p_score uuid, p_user uuid) returns boolean` — true if the user has at
least one message in that thread (bypasses RLS to avoid policy recursion).

### RLS (the rules live here, not in the UI)
- **INSERT**: `sender_id = auth.uid()` AND sender is a CURRENT member of the linked row
  (`manager_id = auth.uid()` OR `team_json ? auth.uid()::text`) AND
  `current_date between team_start and coalesce(team_end, 'infinity')`.
  → post-window messaging is impossible server-side; only current members can post.
- **SELECT**: current member OR manager OR `was_participant(score_id, auth.uid())`.
- **No UPDATE / DELETE** — messages immutable.

### Membership decisions (CLOSED — do not reopen)
1. **Mid-competition JOIN: the new member sees the FULL thread history**, including
   messages from before they joined. Intentional — a team member gets the team's full
   context. No join timestamp; SELECT policy stays exactly as drafted above.
2. **Mid-competition LEAVE: read access persists only if they ever posted**
   (`was_participant`); they can no longer post either way. A silent (never-posted)
   removed member loses read access — accepted trade-off of the single-table design.

## Realtime — security confirmed
Use `postgres_changes` subscriptions only (never broadcast). Supabase enforces the
subscriber's RLS SELECT policy per WAL change (WALRUS) — a user without SELECT on another
team's rows receives no payload at all. The client-side `score_id=eq.` filter is
convenience, not the boundary. Build-time checks: channel carries the user JWT
(supabase-js v2 auto-auth, same as client-threads channels); negative test = manager B
subscribed to team A's score_id receives zero events.

## Sender identity
Messages store only `sender_id`. Names/roles resolve at READ time from `profiles`
(client-threads pattern): renames apply retroactively; a hard-deleted profile falls back
to a neutral "Team member" label — bodies always render, never blank.

## App side
- `src/lib/managerChatQueries.ts`:
  `useMyManagerTeam()` (ongoing-else-latest resolution; manager OR member; returns row,
  member profiles, window state, days left) · `useManagerTeamMessages(scoreId)` (+ realtime
  INSERT sub) · `useSendManagerTeamMessage` (optimistic).
- **Unread without a second table**: per-thread last-read timestamp in AsyncStorage.
- UI: dashboard entry card (team name, avatar stack, countdown, unread badge, live dot);
  chat screen `manager-chat` (obsidian/ember): header with competition progress bar
  (team_start → team_end, "Ends 31 Jan · Nd left"), date-separated bubbles, sender name +
  role chip, optimistic send, keyboard-safe input; ended state = sealed banner
  "Competition ended <date> — this chat is read-only" replacing the input.
- Route registered + added to SENSITIVE_ROUTES (chats discuss clients/performance).
- Dynamic switching needs zero config: new batch → new score_id → card and screen follow.

## Template messages — "Tomorrow's Plan" (added to spec Aug 20, parks with the feature)
- Schema: `manager_team_messages` gains `kind text not null default 'text'` and
  `payload jsonb` (columns on the one table — constraint intact). Template messages:
  `kind='tomorrow_plan'`, `payload={date, entries:[{client_id, name, time}]}`; `body`
  ALWAYS carries a plain-text rendering as fallback. RLS unchanged (INSERT policy covers
  templates: current member + inside window).
- Compose: template icon beside the chat input → "Tomorrow's Plan" sheet. Loads the
  trainer's actively-training book + tomorrow's IST `session_schedule` slots (mine, not
  cancelled). Clients WITH a tomorrow session are pre-selected with their real slot time
  (editable); clients without are listed unchecked and need a time when selected. Footer
  "N clients · Send to team chat" posts ONE message.
- Render: `tomorrow_plan` bubbles are rich cards — calendar header ("TOMORROW'S PLAN ·
  THU 21 AUG" + count badge), client+time rows sorted by time, sender footer — so the
  manager scans the whole team's tomorrow at a glance.
- Edges: any current member may post; repeat sends are just newer messages; "tomorrow" is
  IST-anchored; empty book/day → sheet with empty-state hint. Est. +0.5 day (total ~1.5d).

## Out of v1 (explicitly)
Push notifications (edge fn + pg_net trigger, phase 2) · attachments/replies · admin
read-all (one extra RLS clause if ever wanted).

## Verification checklist (when built)
1. As Sagar (manager, active window): send / read / realtime live update.
2. Non-member RLS negative: cannot select or insert; realtime delivers nothing.
3. Window negative: back-dated test row → INSERT rejected by RLS.
4. Join mid-competition → full history visible. Leave after posting → still readable,
   cannot post. Leave without posting → no access.
5. New batch row → card/screen switch threads automatically; old thread read-only history.
6. Sender rename → old messages show the new name.
