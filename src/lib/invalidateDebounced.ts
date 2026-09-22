import type { QueryClient } from '@tanstack/react-query';

/* App-wide coalescing for realtime-driven invalidations.

   Every realtime handler used to call qc.invalidateQueries() per event, so a
   bulk roster create (50-100 session_schedule rows) triggered 50-100 refetches
   of the same query — and the CRM handlers buzzed the phone once per row.
   Calls for the same query key inside the window collapse into ONE invalidation
   that fires `ms` after the first event; the map is shared across every caller
   (three overlapping subscriptions on one table still cost one refetch). */
const pending = new Map<string, ReturnType<typeof setTimeout>>();

export function invalidateDebounced(qc: QueryClient, queryKey: unknown[], ms = 800) {
  const k = JSON.stringify(queryKey);
  if (pending.has(k)) return;
  pending.set(k, setTimeout(() => {
    pending.delete(k);
    qc.invalidateQueries({ queryKey });
  }, ms));
}

/** Sign-out / tests: drop any queued invalidations. */
export function clearPendingInvalidations() {
  pending.forEach((t) => clearTimeout(t));
  pending.clear();
}
