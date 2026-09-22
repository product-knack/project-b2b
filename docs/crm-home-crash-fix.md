# CRM Home Crash — End‑to‑End Fix ("This screen hit a snag" / `undefined is not a function`)

Paste this whole doc to the iOS app's coding assistant. It fixes the CRM home screen
crash that shows **"This screen hit a snag"** with **`undefined is not a function`** on
some CRM accounts/devices. There are **two independent bugs**; you must apply **both**,
or it will keep reproducing on some devices.

---

## 1. Symptom
- Only some CRM accounts/devices; a fresh install often does NOT reproduce.
- The CRM home screen renders the error boundary fallback ("This screen hit a snag").
- Underlying JS error: `undefined is not a function` (Hermes) — thrown while the screen
  renders, so it is caught by the screen error boundary, NOT by React Query's error state.

## 2. Root cause (two bugs)

### Bug A — stale **persisted** query cache
The app persists the React Query cache to disk (SQLite/AsyncStorage) and rehydrates it on
launch. When the **shape** of a cached value changed across releases (the Revenue Forecast
rows now carry `remarks` as a JSON **array** and `achievement`/`fall_short` as objects), a
device that upgraded still rehydrates the **old/malformed** cached shape. The persisted
cache is keyed by a `buster` string; if the buster is not changed, old caches survive the
upgrade and feed the new code a value it does not expect.

### Bug B — unguarded array operations on jsonb fields
Derived selectors and the banner run `.filter()` / `.some()` / `.map()` **directly** on
`remarks` (and on the rows list). If that value is ever **not an array** (null, `{}`, or a
malformed jsonb from a stale cache), calling `.filter` on it throws
`undefined is not a function`. Because this runs in the **render path / hook body** (not
inside a `queryFn`), React Query cannot turn it into an error state — it bubbles up and
trips the screen error boundary.

> Bug A is what makes it appear "on some devices only." Bug B is the actual throw.
> Fixing only A hides it until the next bad payload; fixing only B stops the crash but
> leaves stale/incorrect cached data. **Do both.**

---

## 3. The fix

### Fix 1 — bump the persisted‑cache buster (invalidates all old caches on upgrade)
Find where the persisted query client is configured (search: `PersistQueryClient`,
`persistOptions`, or `buster`). Change the buster string to a new value.

```tsx
// App.tsx  (or wherever PersistQueryClientProvider is set up)
<PersistQueryClientProvider
  client={queryClient}
  persistOptions={{
    persister: cachePersister,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    buster: 'v2',            // was 'v1' — bump on ANY cached-shape change
  }}
>
```

If the iOS app does not use `PersistQueryClient` but persists cache another way (custom
persister, MMKV, AsyncStorage), do the equivalent: **change the cache version key** so all
previously stored caches are dropped once on this release.

### Fix 2 — array‑guard every jsonb array access
Coerce to an array with `Array.isArray(x) ? x : []` **before** any array method, in **both**
the derived selectors and the query mapping. Exact reference code (from the working build):

```ts
// revenueForecastQueries.ts

// remarkDue(): guard before .filter
export function remarkDue(input: {
  baseline: { sessions_left_at_mark?: number | null } | null;
  liveSessionsLeft: number | null;
  consumedSinceMark: number;
  remarks: RemarkEntry[];
  achieved: boolean;
}) {
  const baseLeft = input.baseline?.sessions_left_at_mark ?? input.liveSessionsLeft ?? null;
  const zeroAtMark = baseLeft !== null && baseLeft <= 0;
  const required = (zeroAtMark ? 1 : 0) + Math.max(0, input.consumedSinceMark);
  // Defensive: a stale persisted cache or malformed jsonb can hand us a non-array.
  const remarks = Array.isArray(input.remarks) ? input.remarks : [];
  const given = remarks.filter((r) => r.type === 'remark').length;
  const pending = Math.max(0, required - given);
  const due = pending > 0 && !input.achieved;
  return { due, pending, required, given, reason: input.consumedSinceMark > 0 ? 'sessions_consumed' : 'zero_at_mark' };
}

// latestCrmRemark / hasUnansweredRemark / latestRemarkAt: guard before .filter/.some
export const latestCrmRemark = (remarks: RemarkEntry[]) =>
  (Array.isArray(remarks) ? remarks : [])
    .filter((r) => r.type === 'remark')
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))[0] ?? null;

export const hasUnansweredRemark = (remarks: RemarkEntry[]) => {
  const arr = Array.isArray(remarks) ? remarks : [];
  const last = latestCrmRemark(arr);
  if (!last) return false;
  return !arr.some((r) => r.type === 'reply' && (r.created_at || '') > (last.created_at || ''));
};

export const latestRemarkAt = (remarks: RemarkEntry[]) => latestCrmRemark(remarks)?.created_at ?? null;
```

```ts
// usePriorityRows(): normalize the jsonb fields at the query boundary so nothing
// downstream ever receives a non-array / undefined.
return ((data ?? []) as any[]).map((r) => ({
  ...r,
  achievement: r.achievement ?? { status: 'pending' },
  remarks: Array.isArray(r.remarks) ? r.remarks : [],
  fall_short: r.fall_short ?? null,
})) as PriorityRow[];
```

```ts
// useCrmForecastBanner(): guard the rows list itself, and use optional-call on the Set.
const rows = (Array.isArray(rowsQ.data) ? rowsQ.data : []).filter(
  (r) =>
    r.achievement?.status !== 'achieved' &&
    r.fall_short?.status !== 'fall_short' &&
    mineQ.data?.has?.(r.client_id)          // optional call: mineQ.data may be undefined while loading
);
```

---

## 4. Find every equivalent site in the iOS codebase
Run these searches and apply the same guard at each hit that touches `remarks`,
`achievement`, `fall_short`, or the forecast rows list:

```bash
grep -rnE "\.remarks|revenue_forecast|remarkDue|latestCrmRemark|hasUnansweredRemark|\.fall_short|\.achievement" src
```

At each hit, ensure:
1. Any value read from a **jsonb** column that should be an array is coerced:
   `Array.isArray(x) ? x : []` before `.filter/.map/.some/.sort/.reduce`.
2. Any object jsonb (`achievement`, `fall_short`, `baseline`) is read with optional
   chaining (`r.achievement?.status`) and never assumed present.
3. React Query `.data` used in a hook body is guarded (`Array.isArray(q.data) ? q.data : []`)
   and Map/Set access uses optional call (`q.data?.has?.(id)`).

## 5. Native / Swift analog (if the iOS app is not React Native)
Same two principles:
- **Cache:** bump the local cache/store schema version so previously persisted CRM/forecast
  data is discarded once on this release (don't decode old blobs into the new model).
- **Decoding:** decode `remarks` as `[Remark]` with a safe default of `[]` when the JSON is
  null or not an array (e.g. `try? container.decode([Remark].self, forKey: .remarks) ?? []`),
  and treat `achievement`/`fall_short`/`baseline` as optionals. Never force‑unwrap a jsonb
  field or call array APIs on a value that could be null.

---

## 6. How to verify
1. Type‑check / build passes.
2. Load the CRM account that reproduced it (the one whose device showed the crash) **after**
   upgrading over the previous install (do NOT clean‑install first — the bug lives in the
   upgraded persisted cache).
3. CRM home renders with the Revenue Forecast banner; no "This screen hit a snag".
4. Sanity: a client whose `remarks` is empty/null and one with real remarks both render, and
   the banner's `dueCount` / `newCount` compute without error.

## 7. One‑line summary
A stale persisted cache handed the CRM home a non‑array `remarks`; calling `.filter` on it
threw `undefined is not a function` during render. Fix = **bump the cache buster** (drop old
caches on upgrade) **and** `Array.isArray(...) ? ... : []`‑guard every array op on the
forecast jsonb fields, plus normalize `remarks` to `[]` at the query boundary.
