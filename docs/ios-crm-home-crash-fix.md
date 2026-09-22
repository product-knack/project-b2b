# iOS handoff — Fix the CRM home crash ("This screen hit a snag" / `undefined is not a function`)

Paste this whole doc to the iOS app's coding assistant. This SUPERSEDES the earlier
"buster + array guards" note — that fixed a different, launch-time variant. The bug below
is a **serialization** bug in the persisted query cache and is the real recurring cause.

---

## 1. Symptom
- CRM dashboard **home** shows the error boundary: "This screen hit a snag / The page
  couldn't finish rendering / **undefined is not a function**".
- Appears **after some time of use**, NOT on first load. Tapping **Retry** clears it, then it
  **comes back later** (often after the app was backgrounded and the OS killed it).
- Only happens for a CRM who actually has data on the home (≥1 active item this month).

## 2. Root cause — a `Map`/`Set` in persisted React Query cache
The app persists the **entire** React Query cache to disk and rehydrates it on launch. The
persister serializes with JSON. Critically:

```
JSON.stringify(new Map([["a",1]]))  === "{}"     // and the same for Set
```

So any query whose `data` is a **`Map`** (or `Set`) is written to disk as `{}` and comes back
on the next cold start as a **plain object `{}` that has no `.get`/`.has`**. A guard like:

```ts
consumedQ.data?.get(clientId)   // single optional chain
```

only protects against `data` being null/undefined. A rehydrated `{}` is **truthy**, so `?.`
passes through and `.get` is `undefined` → Hermes throws **"undefined is not a function"** →
caught by the screen error boundary.

### Why every symptom matches
- **After some use, not first load:** on a fresh install the Map isn't persisted yet, so
  `data` is `undefined` and `?.get` short-circuits safely. It only rehydrates as `{}` after
  the query has run once and the app cold-starts (mobile OS silently kills backgrounded apps).
- **Intermittent:** the `.get` runs inside a `.filter` over the CRM's rows, so it only crashes
  when there's ≥1 qualifying row.
- **Retry clears it, returns later:** Retry + `refetchOnMount` fetch a real in-memory `Map`;
  the next cold start rehydrates `{}` again.
- **A `buster` bump alone does NOT fix it:** the buster clears the persisted cache once on
  upgrade, but the Map re-persists as `{}` every session after. This is not a stale-shape bug.

### The exact offender (Android/RN reference)
`src/lib/revenueForecastQueries.ts`: `useConsumedSinceMark` returns `Promise<Map<string,number>>`,
consumed at two sites via `consumedQ.data?.get(id)` — `revenueForecastQueries.ts` (the
`dueCount` in `useCrmForecastBanner`) and `crmRevenueForecast.tsx` (the full forecast screen).
The banner is the **first child** on the CRM home, so its crash takes the whole screen down.

---

## 3. The fix — two layers (apply BOTH)

### Fix 1 (root cause, class-wide): never persist a `Map`/`Set` query
Find where the persisted query client is configured (search `PersistQueryClientProvider`,
`persistOptions`, `dehydrateOptions`). Add a `shouldDehydrateQuery` that skips Map/Set data.
Exact RN code (from the shipped Android fix):

```tsx
// App.tsx
import { QueryClient, defaultShouldDehydrateQuery } from '@tanstack/react-query';

<PersistQueryClientProvider
  client={queryClient}
  persistOptions={{
    persister: cachePersister,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    buster: 'v2',
    // A Map/Set does not survive JSON serialization (JSON.stringify(new Map()) === '{}'),
    // so it rehydrates as a plain {} with no .get/.has and the next Map/Set method call
    // throws "undefined is not a function". Never persist them; they refetch on mount.
    dehydrateOptions: {
      shouldDehydrateQuery: (query) => {
        const d = query.state.data;
        if (d instanceof Map || d instanceof Set) return false;
        return defaultShouldDehydrateQuery(query);
      },
    },
  }}
>
```
Effect: Map/Set queries are never written to disk → on rehydration they're `undefined` (not
`{}`) → every single-`?.` consumer short-circuits safely → `refetchOnMount: 'always'` gets a
real Map. Nothing is lost (they were only ever persisted as corrupt `{}`).

### Fix 2 (defensive, per-site): double-optional the Map/Set calls
Covers the transitional first launch, where the OLD persisted `{}` still rehydrates before the
new write-filter takes effect. Change every `?.get(`/`?.has(` on query data to `?.get?.(`/
`?.has?.(`:

```ts
// before
consumedSinceMark: consumedQ.data?.get(r.client_id) ?? 0,
// after
consumedSinceMark: consumedQ.data?.get?.(r.client_id) ?? 0,
```
`({}).get?.(x)` short-circuits to `undefined` → `?? 0`. (There's already a safe sibling in the
same file — the Set is read as `mineQ.data?.has?.(id)`; mirror that style everywhere.)

---

## 4. Find every affected site in the iOS codebase
```bash
# Map/Set-returning queries (each one is a persistence hazard):
grep -rnE "Promise<(Map|Set)<|new (Map|Set)\b" src/lib
# Method calls on query data that break on a rehydrated {} :
grep -rnE "\.data\??\.(get|has|forEach|entries|keys|values)\(" src
# Confirm the persist config and whether a shouldDehydrateQuery filter already exists:
grep -rnE "PersistQueryClient|persistOptions|dehydrateOptions|shouldDehydrateQuery" .
```
At each Map/Set consumer: ensure the persistence filter is in place (Fix 1) AND the call uses
double-optional (Fix 2). Known Android hotspots to check for iOS parity: the revenue-forecast
`consumed` Map and `my-clients` Set, plus any ops sales-tracker Map.

## 5. Native / Swift analog (if the iOS app is not React Native)
Same principle: **don't persist a structure that loses its type through JSON, and never call a
type-specific method on a value decoded from a cache without checking it.** Concretely:
- If you cache decoded models, key "consumed counts" as a `[String: Int]` **dictionary** (JSON
  round-trips fine), not a custom Map-like type that serializes to `{}`.
- Decode cached values with safe defaults (`(try? decode(...)) ?? [:]`) and treat lookups as
  optional (`dict[id] ?? 0`), never force-unwrap.
- If you use any disk-cached query layer, exclude non-JSON-safe structures from what you write.

## 6. How to verify (critical — reproduce the real path)
1. Sign in as a CRM who **has ≥1 active priority/renewal item this month**.
2. Open the CRM home once (so the Map query runs and persists), then **fully background/kill
   the app and relaunch** (this is what triggers rehydration — a warm resume won't reproduce).
3. CRM home renders with the forecast banner; **no "This screen hit a snag"**.
4. Repeat the kill/relaunch a few times — it must never recur.
5. tsc/build clean.

## 7. One-line summary
A `Map` in the persisted query cache serialized to `{}` and rehydrated without `.get`, so
`data?.get(id)` threw `undefined is not a function` on the CRM home. Fix = **stop persisting
Map/Set queries** (`shouldDehydrateQuery`) **and** double-optional every Map/Set call
(`?.get?.()`).
