import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
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
  dbRole === 'client' || !dbRole ? null : dbRole === 'crm' ? 'crm' : dbRole === 'coach' ? 'coach' : dbRole === 'ops' ? 'ops' : dbRole === 'admin' ? 'admin' : dbRole === 'doctor' ? 'doctor' : dbRole === 'marketing' ? 'marketing' : 'trainer';

async function fetchRole(userId: string): Promise<{ app: Role | null; db: string | null }> {
  const { data } = await supabase.from('profiles').select('role').eq('id', userId).maybeSingle();
  return { app: appRoleOf(data?.role), db: data?.role ?? null };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<Role | null>(null);
  const [dbRole, setDbRole] = useState<string | null>(null);
  // While signIn() is verifying a role-picker match, the session-change effect must
  // NOT publish the role (it would let the Router redirect before rejection).
  const expectedRoleRef = React.useRef<Role | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (!s) { setRole(null); setDbRole(null); }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Resolve the account's role whenever the signed-in user changes. Restored
  // sessions of non-staff accounts are signed out immediately.
  useEffect(() => {
    const uid = session?.user?.id;
    if (!uid) return;
    let cancelled = false;
    fetchRole(uid).then((r) => {
      if (cancelled) return;
      if (!r.app) { supabase.auth.signOut(); return; }
      if (expectedRoleRef.current && r.app !== expectedRoleRef.current) return; // signIn() is rejecting this session
      setRole(r.app);
      setDbRole(r.db);
    });
    return () => { cancelled = true; };
  }, [session?.user?.id]);

  const signIn = useCallback(async (email: string, password: string, expectedRole?: Role) => {
    expectedRoleRef.current = expectedRole ?? null;
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return { error: error.message, role: null };
      const r = await fetchRole(data.user.id);
      if (!r.app) {
        // Not a staff account (client / no profile) — this app is staff-only.
        await supabase.auth.signOut();
        return { error: 'This app is for Odds staff. Please use the client app to sign in.', role: null };
      }
      // Role-picker enforcement: the selected role must match the ACCOUNT's real
      // role. Mismatch → sign the session straight back out, never publish state.
      if (expectedRole && r.app !== expectedRole) {
        await supabase.auth.signOut();
        return { error: 'wrong-role:' + r.app, role: null };
      }
      setRole(r.app);
      setDbRole(r.db);
      return { error: null, role: r.app };
    } finally {
      expectedRoleRef.current = null;
    }
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setRole(null);
    setDbRole(null);
  }, []);

  return <Ctx.Provider value={{ session, loading, role, dbRole, signIn, signOut }}>{children}</Ctx.Provider>;
}
