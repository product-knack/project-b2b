# Odds Messenger — End-to-End Architecture & Smoothness Playbook

How the native (staff) app's messenger is built: data model, backend, query layer, realtime,
send pipeline, offline strategy, UX patterns, and — most importantly — **why it feels smooth**.
Use this as the blueprint for rebuilding the B2C app's messenger.

Stack: React Native (Expo) · Supabase (Postgres + RPC + Realtime + Storage) · TanStack React Query v5.

---

## 1. Data model (4 tables + 1 storage bucket)

```
conversations            id, type, name, client_id, updated_at
conversation_participants conversation_id, user_id, is_active, last_read_at
messages                 id (CLIENT-generated uuid), conversation_id, sender_id, message,
                         message_type (text|image|video|voice|document),
                         attachment_url, attachment_type, attachment_size,
                         created_at, is_deleted, reply_to_id
profiles                 id, first_name, last_name, avatar_url, role
```

Storage bucket: `chat-media`, object path `{conversationId}/{messageId}-{filename}` —
the first path segment is the conversation id so storage RLS can gate by membership.

**Conversation types** (one enum column, not separate tables):
| type | Meaning | Created by |
|---|---|---|
| `direct` | 1:1 DM (staff↔client or staff↔staff) | RPC `get_or_create_dm(p_other, 'direct')` |
| `team` | staff↔staff DM (rendered 1:1 when it has one other member) | RPC `get_or_create_dm(p_other, 'team')` |
| `group` | care-team group *including* the client; also the read-only `Odds Announcements` broadcast | RPC `get_or_join_client_group(p_client_id)` |
| `client` | staff-only thread about a client (`client_id` set, client not a member) | RPC `get_or_create_client_thread(p_client_id)` |

Key design decision: **the same client has three separate chat surfaces** (their direct DM,
the staff-only thread, the care-team group) and they must never bleed into each other's
previews or unread counts. The conversation list explicitly filters per type.

**Unread + read receipts = one column.** No per-message receipt rows. Each participant has
`last_read_at`; unread = messages newer than it; "Seen by X" = member's `last_read_at >=
message.created_at`. Marking read is a single-row update of *your own* participant row.
This is dramatically cheaper than per-message receipts and is all a fitness app needs.

**Client-generated message ids** (uuid v4 made on-device). This one choice unlocks:
optimistic bubbles keyed properly, realtime-echo dedup, and safe offline retries (see §5, §6).

## 2. Backend (RPCs do the heavy lifting)

Never assemble the inbox client-side from raw tables. Two RPCs carry the read path:

- **`get_conversation_overview()`** — one round-trip returning, for every conversation the
  caller belongs to: last message (text/type/at/sender), `unread_count`, `my_last_read_at`.
  Computing unread counts in SQL is the difference between one query and N+1 per thread.
  The client then does exactly two batched follow-ups (`conversation_participants` and
  `profiles` via `.in(...)`) to resolve names/avatars/member counts.
- **`get_messages_page(p_conversation_id, p_before_at, p_before_id, p_limit)`** — keyset
  (cursor) pagination, newest-first, 30 per page. Cursor = `(created_at, id)` of the last
  row, so pagination never does OFFSET scans and never skips/duplicates on concurrent inserts.

"Get or create" RPCs (`get_or_create_dm`, `get_or_create_client_thread`,
`get_or_join_client_group`) are SECURITY DEFINER: they create the conversation +
participants atomically server-side, and re-sync membership on open (e.g. the client thread
refreshes its member list from `trainer_clients` every time). RLS on every table scopes
reads/writes to active participants, which also pre-filters realtime payloads for free.

## 3. Query layer (React Query)

| Hook | Key | Freshness | Notes |
|---|---|---|---|
| `useChatOverview(meId)` | `['chat-overview', me]` | staleTime 15s | inbox: RPC + 2 batched lookups |
| `useMessageThread(convId)` | `['chat-thread', id]` | staleTime 10s | **useInfiniteQuery**, keyset pages of 30 |
| `useThreadMembers` | `['thread-members', id]` | 60s | group header/member chips |
| `useConversationReads` | `['conversation-reads', id]` | 8s + 20s interval | powers "Seen by" |
| roster / client lists | — | 60–120s | pickers, rarely change |

Global defaults: staleTime 30s, foreground-only 60s refetch interval, refetch on
mount/reconnect/focus, retry 1, `networkMode: 'offlineFirst'`.

The inbox splits into tabs (Clients / Team / Announcements) *client-side* from the single
overview result — one fetch feeds the whole home screen, the drawer unread badge, and the
per-tab badges.

## 4. Realtime (two channels, no polling for messages)

1. **Per-open-thread channel** — `postgres_changes INSERT on messages` with a server-side
   `conversation_id=eq.X` filter. On payload: **patch the cache directly** with
   `queryClient.setQueryData` (prepend to page 0), deduped by message id, and mark the
   thread read if the sender isn't me. No refetch → a new message renders in ~0ms of
   network time. This is the single biggest smoothness win.
2. **Global channel** (one per signed-in user) — INSERT on `messages` with *no* filter;
   RLS ensures only my conversations' messages arrive. It invalidates the overview (so the
   inbox reorders + badges update) and, when the user is not on the messenger screen, shows
   an animated in-app banner (spring-in, auto-hide 4.5s, haptic, tap → deep-link into that
   chat). Sender/conversation names for the banner are cached in `useRef` maps so repeat
   banners cost zero queries.

No presence or typing indicators — deliberately omitted; the read-receipt + realtime insert
combo covers 95% of perceived liveness at a fraction of the connection overhead.

## 5. Send pipeline (optimistic + idempotent)

```
draft → build ChatMessage {id: uuid(), _pending: true}
      → setQueryData: prepend to page 0            (bubble appears instantly, "sending…")
      → online?  submitChatMessage()               → invalidate thread + overview
        offline? enqueueOutbox('chat-message')     (bubble stays pending)
```

`submitChatMessage` is **idempotent**: it first SELECTs by the client-generated id and
returns early if the row exists, else INSERTs and bumps `conversations.updated_at`.
Because the id is fixed on-device, the outbox can replay it safely, and the realtime echo
of your own insert dedupes against the optimistic bubble instead of doubling it.

**Media**: requires connectivity (explicitly not queueable offline). Optimistic bubble shows
the local file uri while `fetch(uri).arrayBuffer()` (RN/Hermes-safe — do NOT use blobs)
uploads to `chat-media` with `upsert:false`, then a 1-year signed URL goes into the message
row. Size caps: image 10MB, video 50MB, doc 20MB, voice 10MB. On failure, invalidate the
thread so the stuck bubble disappears.

**Replies**: WhatsApp-style — `reply_to_id` travels through the optimistic object and the
insert; the bubble renders a quoted preview (min-width it, or one-word replies crush it).

## 6. Offline strategy

- **Persisted cache**: React Query cache persisted to SQLite (`expo-sqlite/kv-store`,
  7-day maxAge, versioned buster key). Cold-starting offline shows the full last-synced
  inbox and threads instantly.
- **`networkMode: 'offlineFirst'`** everywhere: offline queries render cached data and
  *pause* (never error); they resume on reconnect. (Gotcha: paused queries have
  `isLoading === false` — gate spinners on `isPending`.)
- **Durable outbox**: a SQLite-backed FIFO queue drained on launch and on reconnect
  (NetInfo wired into React Query's `onlineManager`). Text sends survive app restarts;
  transient network errors requeue, real rejections mark the item failed and surface in a
  pending-sync UI.

## 7. UX structure & patterns

- **One route, internal state machine** — `MessengerHome ⇄ MessageThread` are local state,
  not navigation routes. Opening a chat is a state change (instant), and a `backOverride`
  hook makes the OS/gesture back close the chat instead of leaving the messenger.
- **Inverted FlatList** — newest message at the bottom with zero scroll management; loading
  older messages is just `onEndReached` (which fires when scrolling *up* in an inverted
  list) → `fetchNextPage`. Never use a ScrollView for a message list.
- **Keyboard**: manual `Keyboard` show/hide listeners tracking keyboard height, composer
  padding = kbHeight when open. On Android edge-to-edge, `KeyboardAvoidingView` is
  unreliable — the manual approach is deliberate.
- **Bubbles**: own = brand gradient right-aligned; others = translucent left with sender
  name in groups; date pills when the day changes (Today / Yesterday / date, rendered in
  IST); pending shows "sending…/uploading…"; images fixed 220×220 (no layout jumps).
- **Swipe-to-reply**: PanResponder claiming clearly-horizontal drags (>14px, dx > 1.6·dy),
  haptic at the trigger threshold, spring-back. It locks the page-level back-swipe while
  active so the two gestures never fight.
- **@mentions**: regex on the draft tail (`/(^|\s)@(\w*)$/`) opens a member picker in
  groups; rendered messages highlight known member mentions.
- **Announcements**: same thread UI with the composer swapped for a "read-only" notice.
- **Unread affordances**: bold name + tinted row + count pill in the inbox; summed counts
  on tabs and the app-wide nav badge — all derived from the one overview query.

## 8. Why it feels smooth — the checklist

1. **Realtime patches the cache; it never refetches the thread.** setQueryData + dedup.
2. **Optimistic everything** — send, reply, read-marking; the network catches up later.
3. **One RPC for the inbox** — unread counts computed in SQL, zero N+1.
4. **Keyset pagination** — 30-row pages via (created_at,id) cursor; no OFFSET, no dupes.
5. **Inverted FlatList** with `removeClippedSubviews`, `windowSize: 11`,
   `onEndReachedThreshold: 0.4`, `useCallback` renderItem, memoized derived maps.
6. **Batched `.in(...)` lookups** for every profile/participant resolution.
7. **Persisted cache + offlineFirst** — warm starts render instantly, offline never blanks.
8. **RLS-scoped realtime** — the server filters payloads, the client never sifts noise.
9. **Foreground-only polling**, and profile-name caches for notification banners.
10. **Fixed media dimensions** in bubbles — no reflow when images load.

## 9. Build order (how this was actually layered)

1. **Phase 1 — schema + RLS + RPCs** (`get_conversation_overview`, `get_messages_page`,
   the get-or-create trio). Test with SQL before any UI.
2. **Phase 2 — read path**: inbox from the overview RPC, thread with infinite scroll,
   polling only (15s/10s staleTimes). Fully usable, no realtime yet.
3. **Phase 3 — sends + realtime + receipts**: optimistic send with client ids and the
   idempotent submit, the two realtime channels, `last_read_at` receipts, banners.
4. **Phase 4 — polish**: media uploads, replies, mentions, swipe-to-reply, offline outbox,
   persisted cache.

Each phase ships a working messenger; smoothness compounds at phase 3.

## 10. Pitfalls to avoid (learned the hard way)

- Don't fetch message pages by OFFSET — concurrent inserts shift rows and you get dupes/gaps.
- Don't let the server generate message ids if you want optimistic UI — you can't dedup echoes.
- Don't refetch the thread on every realtime event — patch the cache.
- Don't use blob uploads on Hermes — `fetch(uri).arrayBuffer()`.
- Don't rely on `KeyboardAvoidingView` on Android edge-to-edge.
- Don't compute unread counts client-side across N conversations.
- Don't mix a client's multiple thread types in one list without explicit type filters.
- Don't queue media offline (payloads too big/stale) — queue text only, block media with a clear error.
- Gate loading UI on `isPending`, not `isLoading`, or offline-paused queries render empty states.
