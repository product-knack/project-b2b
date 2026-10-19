import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { Session } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './lib/supabase';
import { runSessionTeardown, registerTeardown } from './lib/sessionTeardown';
import { setOutboxUser, useIsOnline } from './lib/offline';
import type { Role } from './store';

type AuthCtx = {
  session: Session | null;
  loading: boolean;      // true until the initial session check finishes
  role: Role | null;     // app workspace, derived from profiles.role (null until resolved)
  dbRole: string | null; // the raw profiles.role value
  signIn: (email: string, password: string, expectedRole?: Role) => Promise<{ error: string | null; role: Role | null }>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthCtx>(null as any);
export const useAuth = () => useContext(Ctx);

/* The workspace is decided by the ACCOUNT's role (profiles.role), never by a UI
   picker — mirrors the web app's `/${profile.role}` redirect. CRM accounts get
   the CRM workspace; other STAFF roles land on the trainer workspace. Client
   accounts are not staff — they can't use this app at all. */
const appRoleOf = (dbRole: string | null | undefined): Role | null =>
  dbRole === 'client' || !dbRole ? null : dbRole === 'crm' ? 'crm' : dbRole === 'coach' ? 'coach' : dbRole === 'ops' ? 'ops' : dbRole === 'admin' ? 'admin' : dbRole === 'doctor' ? 'doctor' : dbRole === 'therapist' ? 'therapist' : dbRole === 'marketing' ? 'marketing' : dbRole === 'academy' ? 'academy' : dbRole === 'tech' ? 'tech' : 'trainer';

/* `failed` = the lookup itself did not complete (no network, a server error): NOT "no
   profile". 19 Oct 2026 audit: a failed lookup used to read as "not a staff account" and
   signed the restored session out, and sign-out wipes the offline queue, so a trainer who
   opened the app without signal lost every workout log still waiting to sync. */
async function fetchRole(userId: string): Promise<{ app: Role | null; db: string | null; failed: boolean }> {
  try {
    const { data, error } = await supabase.from('profiles').select('role').eq('id', userId).maybeSingle();
    if (error) return { app: null, db: null, failed: true };
    return { app: appRoleOf(data?.role), db: data?.role ?? null, failed: false };
  } catch {
    return { app: null, db: null, failed: true };
  }
}

/* Last role the server confirmed for an account, so a restored session opens its workspace
   offline (the persisted query cache carries the pages). Cleared with the session teardown. */
const roleKey = (uid: string) => `auth:role:${uid}`;
let cachedRoleUid: string | null = null;
async function readCachedRole(uid: string): Promise<{ app: Role; db: string | null } | null> {
  try {
    const raw = await AsyncStorage.getItem(roleKey(uid));
    if (!raw) return null;
    const j = JSON.parse(raw);
    const app = appRoleOf(j?.db);
    return app ? { app, db: j?.db ?? null } : null;
  } catch { return null; }
}
async function writeCachedRole(uid: string, db: string | null) {
  cachedRoleUid = uid;
  try { await AsyncStorage.setItem(roleKey(uid), JSON.stringify({ db })); } catch { /* best effort */ }
}
registerTeardown(async () => {
  const uid = cachedRoleUid;
  cachedRoleUid = null;
  if (uid) { try { await AsyncStorage.removeItem(roleKey(uid)); } catch { /* best effort */ } }
});

const ROLE_RETRY_MS = 20_000; // a failed lookup while "online" (server hiccup) is tried again

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<Role | null>(null);
  const [dbRole, setDbRole] = useState<string | null>(null);
  const online = useIsOnline();
  const [retryTick, setRetryTick] = useState(0);
  // While signIn() is verifying a role-picker match, the session-change effect must
  // NOT publish the role (it would let the Router redirect before rejection).
  const expectedRoleRef = React.useRef<Role | null>(null);
  // The account whose role the SERVER confirmed in this session; a cached role is only a stand-in.
  const confirmedUidRef = React.useRef<string | null>(null);

  // Tracks whether a session was live, so a transition TO signed-out (expiry,
  // revocation, sign-out elsewhere) runs the per-user teardown — but the initial
  // "no session yet" at cold start never wipes the offline cache.
  const hadSessionRef = React.useRef(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      hadSessionRef.current = !!data.session;
      setOutboxUser(data.session?.user?.id ?? null);
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setOutboxUser(s?.user?.id ?? null);
      if (!s && hadSessionRef.current) runSessionTeardown();
      hadSessionRef.current = !!s;
      setSession(s);
      if (!s) { setRole(null); setDbRole(null); confirmedUidRef.current = null; }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Resolve the account's role whenever the signed-in user changes. Restored
  // sessions of non-staff accounts are signed out immediately. A lookup that
  // FAILS (no signal, server trouble) never signs out: the last confirmed role
  // opens the workspace and the lookup is retried when the connection is back.
  useEffect(() => {
    const uid = session?.user?.id;
    if (!uid) return;
    if (confirmedUidRef.current === uid) return;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      const r = await fetchRole(uid);
      if (cancelled) return;
      if (r.failed) {
        if (!expectedRoleRef.current) {
          const cached = await readCachedRole(uid);
          if (cancelled) return;
          if (cached) { cachedRoleUid = uid; setRole(cached.app); setDbRole(cached.db); }
        }
        retry = setTimeout(() => setRetryTick((t) => t + 1), ROLE_RETRY_MS);
        return;
      }
      if (!r.app) { supabase.auth.signOut({ scope: 'local' }); return; }
      confirmedUidRef.current = uid;
      writeCachedRole(uid, r.db);
      if (expectedRoleRef.current && r.app !== expectedRoleRef.current) return; // signIn() is rejecting this session
      setRole(r.app);
      setDbRole(r.db);
    })();
    return () => { cancelled = true; if (retry) clearTimeout(retry); };
  }, [session?.user?.id, online, retryTick]);

  const signIn = useCallback(async (email: string, password: string, expectedRole?: Role) => {
    expectedRoleRef.current = expectedRole ?? null;
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return { error: error.message, role: null };
      const r = await fetchRole(data.user.id);
      if (r.failed) {
        // The account could not be checked: not a verdict on the account. Nothing of this
        // seconds-old session is worth keeping, so leave it signed out and say what happened.
        await supabase.auth.signOut({ scope: 'local' });
        return { error: 'Could not check your account. Check your connection and try again.', role: null };
      }
      if (!r.app) {
        // Not a staff account (client / no profile) — this app is staff-only.
        await supabase.auth.signOut({ scope: 'local' });
        return { error: 'This app is for Odds staff. Please use the client app to sign in.', role: null };
      }
      // Role-picker enforcement: the selected role must match the ACCOUNT's real
      // role. Mismatch → sign the session straight back out, never publish state.
      if (expectedRole && r.app !== expectedRole) {
        await supabase.auth.signOut({ scope: 'local' });
        return { error: 'wrong-role:' + r.app, role: null };
      }
      confirmedUidRef.current = data.user.id;
      writeCachedRole(data.user.id, r.db);
      setRole(r.app);
      setDbRole(r.db);
      return { error: null, role: r.app };
    } finally {
      expectedRoleRef.current = null;
    }
  }, []);

  const signOut = useCallback(async () => {
    // Teardown FIRST (query cache + persisted copy, outbox, AI cache, token
    // cache, per-user AsyncStorage keys) so nothing of this user survives.
    await runSessionTeardown();
    await supabase.auth.signOut({ scope: 'local' });
    setRole(null);
    setDbRole(null);
    confirmedUidRef.current = null;
  }, []);

  return <Ctx.Provider value={{ session, loading, role, dbRole, signIn, signOut }}>{children}</Ctx.Provider>;
}
