import AsyncStorage from '@react-native-async-storage/async-storage';

/* ============ Session teardown registry ============
   Everything that caches per-user data registers a cleaner here; auth.signOut,
   the account switch and the session-expiry gate run them ALL before the next
   user can sign in. Registration (not direct imports) keeps this free of import
   cycles: App.tsx owns the query client/persister, offline.ts the outbox,
   aiCache.ts its SQLite table, pushToken.ts its device-token cache. */
type TeardownFn = () => Promise<void> | void;
const fns = new Set<TeardownFn>();

export function registerTeardown(fn: TeardownFn): () => void {
  fns.add(fn);
  return () => { fns.delete(fn); };
}

/* Per-user AsyncStorage keys that must not survive a sign-out. */
const DOOMED_KEY = /^(parallel_workout_session|location:|offline-warmup:|crm-group-autojoin:|mgr-chat:last-read:)/;

let running: Promise<void> | null = null;
/* Best-effort and idempotent: a failing cleaner never blocks sign-out, and
   concurrent callers (explicit signOut + the SIGNED_OUT auth event) share one run. */
export function runSessionTeardown(): Promise<void> {
  if (running) return running;
  running = (async () => {
    for (const f of [...fns]) {
      try { await f(); } catch { /* never block sign-out */ }
    }
    try {
      const keys = await AsyncStorage.getAllKeys();
      const doomed = keys.filter((k) => DOOMED_KEY.test(k));
      if (doomed.length) await AsyncStorage.multiRemove(doomed);
    } catch { /* ignore */ }
  })().finally(() => { running = null; });
  return running;
}
