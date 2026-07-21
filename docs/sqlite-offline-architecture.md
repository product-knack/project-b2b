# SQLite Offline Layer — Structure & Logic

Companion to `messenger-architecture.md`. How the native app uses SQLite for offline
support: what's stored, the outbox queue design, the network wiring, and the rules that
make it safe. Same recipe applies directly to the B2C app.

Stack pieces: `expo-sqlite/kv-store` · `@react-native-community/netinfo` ·
TanStack React Query v5 (`onlineManager`, `PersistQueryClientProvider`).

---

## 1. SQLite is used for exactly two things

Both go through **`expo-sqlite/kv-store`** — a key-value API backed by a real SQLite DB.
No hand-written tables, no migrations, no ORM. Two keys:

| Key | Contents | Purpose |
|---|---|---|
| `rq-cache:v1` | the entire serialized React Query cache | instant warm starts + offline reads |
| `outbox:v1` | JSON array of queued writes | durable offline submissions |

Why kv-store instead of AsyncStorage: it's synchronous-fast, SQLite-durable, has no 6MB
Android cursor limit, and plugs straight into React Query's async-storage persister API.

## 2. Read side — persisted query cache

Setup in `App.tsx`:

```ts
import Storage from 'expo-sqlite/kv-store';
const cachePersister = createAsyncStoragePersister({ storage: Storage, key: 'rq-cache:v1' });

<PersistQueryClientProvider
  client={queryClient}
  persistOptions={{ persister: cachePersister, maxAge: 7 * 24 * 3600 * 1000, buster: 'v1' }}>
```

Three settings must agree, or persistence silently misbehaves:

- **`gcTime: 7d`** on the QueryClient — queries garbage-collected sooner than `maxAge`
  won't be there to restore. Keep `gcTime === maxAge`.
- **`buster: 'v1'`** — bump this string whenever a query's *data shape* changes; it
  invalidates the entire persisted cache in one move. (This app once shipped a crash from
  restoring stale-shaped rows; the buster is the fix.)
- **`networkMode: 'offlineFirst'`** on queries *and* mutations — offline, queries render
  cached data and **pause** instead of erroring; they auto-resume on reconnect.

**The `isPending` gotcha:** an offline-paused query has `data === undefined`,
`isError === false`, and `isLoading === false`. Any "empty state" or "all clear" UI gated
on `isLoading` will lie while offline. Always gate loading/empty UI on **`isPending`**.

Result: cold-starting the app in airplane mode renders the full last-synced UI (inbox,
threads, client lists) instantly from SQLite.

## 3. Write side — the outbox queue

### 3.1 Item structure

```ts
type OutboxItem = {
  id: string;                 // local queue id
  kind: 'workout-log' | 'create-plan' | 'chat-message' | 'location-log';
  label: string;              // human-readable line for the pending-sync UI
  createdAt: string;          // ORIGINAL device timestamp at submit time
  status: 'pending' | 'failed';
  attempts: number;
  error?: string;             // set when a real rejection marks it failed
  payload: any;               // everything the idempotent submit fn needs, incl. pre-generated row ids
};
```

Two fields carry the design:

- **`payload` contains pre-generated row ids and original timestamps.** The Postgres row id
  (e.g. the chat message uuid, the session id) is minted on-device *at submit time*, not at
  sync time. Replays therefore can't duplicate rows, and synced data keeps the timestamp of
  when the user actually did the thing, not when the network came back.
- **`status: 'failed'` vs deletion** — a real server rejection never throws data away; the
  item is kept with its error string so the user can review/retry/discard.

### 3.2 In-memory store + persistence

The queue lives as a module-level array with a tiny listener set (a hand-rolled store —
no Redux/Zustand needed):

```
let items: OutboxItem[] = [];          // hydrated once from SQLite (lazy `load()`)
const listeners = new Set<() => void>();
persist() = Storage.setItem(OUTBOX_KEY, JSON.stringify(items)) + notify()
```

Every mutation (`enqueue`, `remove`, `retry`, drain progress) rewrites the whole array to
SQLite and notifies listeners. At this queue's scale (a handful of items) whole-array
rewrites are simpler and safe; don't build per-row tables until you actually need them.

### 3.3 Lifecycle

```
submit while offline
  → enqueueOutbox(kind, label, payload)     appended + persisted
  → drainOutbox()                            opportunistic immediate attempt
                                             (covers "mid-submit blip" cases)

connectivity returns (NetInfo)               → drainOutbox()
app launch (initOffline)                     → NetInfo.fetch() → drainOutbox()
```

`drainOutbox()` rules — each one matters:

1. **Single-flight guard** (`draining` flag) — NetInfo flaps can't start parallel drains.
2. **In-order processing** of `pending` items (FIFO — a plan created offline before a
   message stays ordered).
3. Per item: call the **idempotent submit function** for its kind, then remove it and
   invalidate that kind's React Query keys (chat → thread + overview; workout log →
   roster/sessions; etc.). The submit functions pre-`SELECT` by the payload's id and
   no-op if the row already exists — that's the idempotency contract.
4. **Error classification** decides what happens on failure:
   - `isTransientError(e)` — regex over the message for network shapes
     (`network request failed | failed to fetch | timeout | socket | ECONN…`) →
     bump `attempts`, **`break` the loop** (we're evidently still offline; NetInfo will
     re-trigger). Breaking, not continuing, preserves FIFO ordering.
   - anything else = real server rejection → mark `status:'failed'` with the error text,
     keep the data, continue to the next item.

### 3.4 Network state wiring

```ts
onlineManager.setEventListener((setOnline) =>
  NetInfo.addEventListener((state) => {
    const next = !!state.isConnected && state.isInternetReachable !== false;
    ...
    setOnline(next);                    // React Query resumes paused queries/mutations
    if (next && wasOffline) drainOutbox();
  })
);
```

One NetInfo subscription feeds three consumers: React Query's `onlineManager` (resumes
paused fetches), the outbox drainer, and a `getIsOnline()` snapshot that send-paths check
synchronously ("am I online right now?") before deciding optimistic-send vs enqueue.
Note the `isInternetReachable !== false` guard — connected-to-WiFi-without-internet counts
as offline.

### 3.5 UI hooks

- `useOutbox()` — subscribes to the listener set, returns the queue **minus
  `location-log` items**: location capture is silent by design and must never appear in
  the user-facing pending-sync list (privacy rule enforced at the hook, not the UI).
- `useIsOnline()` — same subscription, powers offline banners.
- The pending-sync UI renders each visible item's `label` + status, with Retry
  (flips `failed → pending` and drains) and Remove.

## 4. What is and isn't queued

| Queued offline | Not queued |
|---|---|
| chat text messages | chat media (upload payloads too big/stale — send throws with a clear error) |
| workout logs (+ their health-gate data, synced first) | anything requiring a fresh server response to proceed |
| workout plan creations | |
| location logs (silent) | |

Rule of thumb: queue writes that are **self-contained, idempotent, and meaningful hours
later**. Everything else should fail fast with an honest message.

## 5. Replication recipe (for the B2C app)

1. `Storage` from `expo-sqlite/kv-store`; wire `createAsyncStoragePersister` +
   `PersistQueryClientProvider` with matching `gcTime`/`maxAge` and a `buster` string.
2. Set `networkMode: 'offlineFirst'` globally; audit every spinner/empty-state to use
   `isPending`.
3. Wire NetInfo → `onlineManager` once at startup; expose `getIsOnline()` + `useIsOnline()`.
4. Give every offline-capable write: a client-generated row id, an original timestamp in
   the payload, and an idempotent submit function (SELECT-by-id first).
5. Build the outbox module (array + listeners + two SQLite keys) with the drain rules
   above verbatim — single-flight, FIFO, transient-break, reject-mark.
6. Add the pending-sync UI with retry/remove, filtering any privacy-sensitive kinds.
7. Bump the `buster` on every breaking change to cached data shapes.
