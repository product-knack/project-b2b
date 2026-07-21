import { Platform } from 'react-native';
import { supabase } from './supabase';

/* ============ odds_device_tokens — save pipeline (port of the web app) ============
   Mirrors safeDeviceTokenUpsert.ts + pendingDeviceToken.ts from the Capacitor app:
   • pendingToken  — one-shot slot for a token that arrived before login
   • lastKnownToken — survives login/logout within the JS session (re-login re-saves)
   • safeDeviceTokenUpsert — dedup by userId:token, 500ms debounce, waits for an
     active auth session (retry ×3, 2s backoff), retries FK 23503 once after 3s,
     then upserts on (user_id, platform).
   The server side is untouched: edge functions read this table with service_role
   and fan out via FCM v1, deleting rows FCM reports UNREGISTERED/NOT_FOUND. */

let pendingToken: string | null = null;
let lastKnownToken: string | null = null;
const savedKeys = new Set<string>(); // `${userId}:${token}` — dedup per session
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

export function setPendingDeviceToken(token: string) {
  pendingToken = token;
  lastKnownToken = token;
}
export function consumePendingDeviceToken(): string | null {
  const t = pendingToken;
  pendingToken = null;
  return t;
}
export function getLastKnownToken(): string | null {
  return lastKnownToken;
}
export function resetDeviceTokenCache() {
  // On sign-out: allow the next login (possibly a different user) to re-write.
  savedKeys.clear();
  pendingToken = lastKnownToken; // keep the physical device token available
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForSession(): Promise<boolean> {
  for (let i = 0; i < 3; i++) {
    const { data } = await supabase.auth.getSession();
    if (data.session) return true;
    await sleep(2000);
  }
  return false;
}

export function safeDeviceTokenUpsert(userId: string, token: string) {
  if (!userId || !token) return;
  const key = `${userId}:${token}`;
  if (savedKeys.has(key)) return;
  lastKnownToken = token;

  // 500ms debounce to absorb auth-state churn (web parity).
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(async () => {
    try {
      if (savedKeys.has(key)) return;
      if (!(await waitForSession())) return;
      const platform = Platform.OS === 'ios' ? 'ios' : 'android';
      const write = () =>
        supabase.from('odds_device_tokens').upsert(
          { user_id: userId, token, platform, updated_at: new Date().toISOString() },
          { onConflict: 'user_id,platform' }
        );
      let { error } = await write();
      if (error && error.code === '23503') {
        // profiles row not created yet — single 3s retry (web parity)
        await sleep(3000);
        ({ error } = await write());
      }
      if (!error) savedKeys.add(key);
      else console.warn('[pushToken] upsert failed:', error.message);
    } catch (e: any) {
      console.warn('[pushToken] upsert error:', e?.message ?? e);
    }
  }, 500);
}
