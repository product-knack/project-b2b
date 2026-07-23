import React from 'react';
import { useStore } from '../store';
import { useAuth } from '../auth';
import { supabase } from '../lib/supabase';
import { initializeAmplitude, setAnalyticsUser, setUserProperties, setEventStamp, trackEvent } from '../lib/amplitude';

/* Render-nothing analytics trigger (mirrors <LocationCapture />): silent,
   metadata-only Amplitude tracking. One mount covers EVERY screen in the app —
   the custom router keeps the current screen in useStore().route, so a single
   effect is the equivalent of B2C's usePathname() page tracking.

   Robustness: identity is applied AFTER init resolves (no queued-identify
   races), and the user's name/email/role are ALSO stamped onto every event as
   properties — so each "Screen Viewed" row in Amplitude shows the full detail
   (screen_name, user_name, user_email, role) on its own, without depending on
   the identify round-trip. */
export function AnalyticsTracker() {
  const { route, role, selectedClientId, selectedClientName, aiOpen } = useStore();
  const { session, dbRole } = useAuth();
  const uid = session?.user?.id ?? null;
  const email = session?.user?.email ?? null;

  // Latest identity snapshot for event stamping (refs — no re-renders).
  const nameRef = React.useRef<string | null>(null);
  const emailRef = React.useRef<string | null>(null);
  const roleRef = React.useRef<string | null>(null);
  emailRef.current = email;
  roleRef.current = role ?? null;
  // Publish the stamp so trackEvent() merges identity onto EVERY event app-wide.
  React.useEffect(() => {
    setEventStamp({ user_name: nameRef.current ?? undefined, user_email: email ?? undefined, role: role ?? 'unknown' });
  }, [email, role, uid]);

  // Init once at startup.
  React.useEffect(() => { initializeAmplitude(); }, []);

  // Identity: AWAIT init, then bind user id + properties; fetch the profile
  // name and merge it (identify + event stamping). Detach on sign-out.
  React.useEffect(() => {
    let alive = true;
    (async () => {
      await initializeAmplitude();
      if (!alive) return;
      if (!uid) { nameRef.current = null; setAnalyticsUser(null); return; }
      setAnalyticsUser(uid, { email, role: role ?? null, db_role: dbRole ?? null });
      const { data } = await supabase.from('profiles').select('first_name, last_name').eq('id', uid).maybeSingle();
      if (!alive || !data) return;
      const name = `${data.first_name ?? ''} ${data.last_name ?? ''}`.replace(/\s+/g, ' ').trim();
      if (name) {
        nameRef.current = name;
        setEventStamp({ user_name: name, user_email: email ?? undefined, role: role ?? 'unknown' });
        setUserProperties({ name, first_name: data.first_name ?? null, last_name: data.last_name ?? null });
      }
    })();
    return () => { alive = false; };
  }, [uid, role, dbRole]);

  // Every event carries the full identity detail (metadata only).
  const stamp = () => ({
    user_name: nameRef.current ?? undefined,
    user_email: emailRef.current ?? undefined,
    role: roleRef.current ?? 'unknown',
  });

  // Screen Viewed — fires on every route change, for all 7 role workspaces.
  React.useEffect(() => {
    if (!route || route === 'signin') return;
    trackEvent('Screen Viewed', {
      screen_name: route,
      ...stamp(),
      ...(selectedClientId && /client|workout/.test(route) ? { client_id: selectedClientId, client_name: selectedClientName ?? undefined } : {}),
    });
  }, [route]);

  // Non-route overlay: the Odds AI chat.
  React.useEffect(() => {
    if (aiOpen) trackEvent('Odds AI Opened', stamp());
  }, [aiOpen]);

  return null;
}
