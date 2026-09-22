# Team Messenger — end-to-end feature reference (Android shipped Aug 20-21, 2026)

One chat thread per competition team, scoped to a `manager_score` row. Auto-follows the
current competition: when a new batch row is created the card and screen re-point to it
with zero config; when the window ends the chat seals read-only. Built for Android in
`managerChat.tsx` + `managerChatQueries.ts`; this doc is the contract for the iOS port.

## 1. Backend (already live in production — run nothing)
File: `supabase/manager_messenger_migration.sql` (idempotent; applied + re-applied Aug 20-21).

- **Table `manager_team_messages`**: `id uuid pk`, `score_id uuid -> manager_score(id) on delete cascade`,
  `sender_id uuid`, `kind text default 'text'`, `payload jsonb`, `body text`, `created_at timestamptz`.
  Index `(score_id, created_at)`. Messages are IMMUTABLE (no UPDATE/DELETE policies).
- **Message kinds** (body always carries a plain-text fallback):
  - `text` — payload null.
  - `tomorrow_plan` — `{date: 'YYYY-MM-DD' (IST), entries: [{client_id, name, time: 'HH:mm'}]}`.
  - `plan_remark` — `{date, client_id, name, trainer_id, remark}` (manager remark on a missed session).
- **RLS**:
  - SELECT: current member (`manager_id = auth.uid()` OR `team_json ? auth.uid()::text`) OR
    `was_participant(score_id, auth.uid())` (SECURITY DEFINER: ever posted in the thread).
  - INSERT: `sender_id = auth.uid()` AND current member AND today-IST inside
    `team_start..coalesce(team_end, infinity)` AND (`kind <> 'plan_remark'` OR sender is the
    row's `manager_id`). So: no posting after the window; only the manager can post remarks.
  - Realtime publication on; WALRUS enforces the subscriber's SELECT policy per event
    (live-verified: non-member subscriber received zero events).
- **Membership semantics (CLOSED decisions)**: mid-competition joiners see FULL history;
  leavers keep read access only if they ever posted and can never post again;
  a never-posted removed member loses access entirely.

## 2. Team resolution (must match the leaderboard exactly)
`useMyManagerTeam()`: fetch all `manager_score` rows ordered `created_at desc`;
pool = ongoing rows (`team_end` null or >= today-IST), else the latest `team_start` batch;
my row = first where `manager_id === uid` or `team_json` contains uid. Members = manager +
team_json profiles (names resolved from `profiles` at read time, 'Team member' fallback —
renames apply retroactively). Exposes `{scoreId, teamName, managerId, isManager, start, end,
active, daysLeft, pctElapsed, members[]}`.

## 3. Entry points
- **Home card** ("Team Messenger") on the TRAINER and DOCTOR dashboards. Hidden when the
  user isn't in a current team. BLUE identity (#7C8FE8 — Client Threads next to it owns
  purple): navy gradient body, travelling light band on the top strip, breathing glow behind
  the chat glyph, member avatar stack, days-left line, pulsing gradient unread pill
  (count of OTHERS' messages since last read; own sends never count).
- Route `manager-chat` registered in the Router and in SENSITIVE_ROUTES (replay shield).
- The global floating launcher (OddsAiBar) is hidden on this route — it overlapped the input.

## 4. Chat screen
- Blue header band: back button, team name + live dot, member avatar stack, competition
  progress bar (start date · N DAYS LEFT · end date), member chips strip (manager crowned,
  "(you)" marker). No `insets.top` — the global app bar owns the safe area.
- Messages: Messenger-house bubbles — own = ORANGE_GRAD gradient, white 14.5/20 text;
  others = surface bubble, ink text, 26px avatar, sender FIRST NAME only (no role suffix).
  Consecutive same-sender messages group. Date separators as hairlines ("TODAY" for today).
  Timestamps inside the bubble bottom-right.
- **@mentions**: typing `@` shows a filtering strip of member chips above the input; tap
  inserts `@FirstName`. Rendered bold — cream in own bubbles, orange in others', GOLD when
  the mention is you. Visual only (no push in v1).
- Input: kb-height-listener padding (house pattern), gold calendar button (green dot when
  my tomorrow plan is already shared), gradient send button. When the competition has ended
  the input is replaced by a sealed read-only banner (RLS enforces it server-side too).
- Realtime: `postgres_changes` INSERT subscription invalidates the message query. Channel
  names are tagged per consumer (`manager-chat-card-*` / `manager-chat-screen-*`) so the
  home card and the screen can both be subscribed during transitions.

## 5. Tomorrow's Plan (compose)
Sheet opened from the calendar button. ONE flat alphabetical list (union of my
actively-training book from `trainer_clients` + tomorrow-IST `session_schedule` slots,
mine, not cancelled — works for doctors too, their sessions carry `trainer_id`).
NOTHING pre-selected: the trainer picks every client and time manually; a client's roster
slot only seeds their default time on toggle (small grey "ROSTER 9:00 AM" hint).
Time strip: 5:00–21:30 half-hours. Send posts ONE `tomorrow_plan` message.
**Edit-in-place**: reopening restores my submitted selection (clients + times; clients that
fell out of the roster/book still render); button becomes "Update · N clients"; the newest
message per sender per date replaces the older ones everywhere.
Sheet structure note: the backdrop Pressable is a SIBLING of the sheet, never a parent —
parent-Pressables make the list scroll sticky.

## 6. Team Day Plan (merged card in the thread)
All `tomorrow_plan` messages for one date collapse into ONE card, rendered at the position
of the newest plan message (older ones absorbed; each sender's latest wins).
- **Visibility**: the MANAGER sees "TEAM DAY PLAN" — every trainer's section, the
  submission roll-call, team totals. A regular member sees "MY DAY PLAN" — only their own
  section and counts, plus "FULL TEAM PLAN IS VISIBLE TO THE MANAGER". (Presentation-level:
  the raw messages remain readable to all members by RLS — inherent to the single thread.)
- **Roll-call on top (manager)**: red "NOT SUBMITTED:" chips naming members without a plan
  for that date → flips to a green "ALL N MEMBERS SUBMITTED · M SESSIONS" banner.
- **Stat tiles**: PROJECTED (always) · LOGGED · PENDING/MISSED (once the date arrives).
- **Per-trainer sections**: avatar-colored accent stripe, name + crown, mini progress bar
  with x/y, client rows sorted by time with gold time pills.
- **Outcome ticks** (`usePlanOutcome`): a claimed session is DONE when the client has a
  `training_sessions` row with `status='completed'` and `cancelled=false` anywhere on the
  plan's IST date — time-flexible and trainer-agnostic by design. Live day: green tick /
  hollow pending dot, refetch every 2 min. After the day: tick / red cross, missed names
  dimmed, footer "N OF M NOT LOGGED". Computed on every viewer's device (trainers can read
  other trainers' `training_sessions` rows — verified).
- "UPDATED h:mm" stamp under the card = newest plan message time.

## 7. Manager remarks on missed sessions
FINAL-mode only ("after that day"). Under every missed row the MANAGER sees a red
"ADD REMARK" chip → keyboard-safe dialog → saves a `plan_remark` message. Renders as a gold
"MGR" box under that session for the whole team (members see remarks on their own missed
sessions). Latest remark per (date, client) wins; EDIT re-opens prefilled. Card footer shows
"N MISSED SESSIONS STILL NEED A REMARK" to the manager until complete. Enforced twice:
render honors only the current manager's remark messages, and the DB INSERT policy rejects
`plan_remark` from anyone else.

## 8. Unread
On-device marker `mgr-chat:last-read:{scoreId}` (AsyncStorage) storing the SERVER
timestamp of the newest message seen (never the device clock — skew silently swallowed
unreads), compared via `Date.parse` (DB `+00:00` vs JS `Z` formats must not string-compare).
Marked on thread open and on every new message while open. Unread = others' messages newer
than the marker. Card + screen both realtime-subscribed, so counts move without refresh.

## 9. Verified live (Aug 20-21)
Send/read/realtime as manager; non-member: 0 rows, INSERT 42501, zero realtime events;
spoofed sender 42501; post-window insert 42501; UPDATE/DELETE no-ops; team resolution matches
the leaderboard row for Sagar (d6e51ad8, window 2026-08-01→2027-01-31, 7 members);
`plan_remark` contract round-trip as manager; probe rows cleaned.

## 10. Out of v1
Push notifications (phase 2: edge fn + pg_net trigger) · long-press seen-by receipts
(planned: `manager_team_reads` watermark table — plan agreed, not built) · attachments /
replies · admin read-all (one RLS clause if ever wanted).
