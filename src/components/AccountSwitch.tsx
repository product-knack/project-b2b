import React from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Body } from './primitives';
import { useAuth } from '../auth';
import { useStore } from '../store';
import { counterpartOf } from '../lib/linkedAccounts';

/* Dashboard toggle between the two linked accounts (coach ⇄ Sagar Sharma).
   Renders ONLY when the signed-in user is one of the pair. Swaps the Supabase
   session in place (signInWithPassword replaces it — no sign-out flash). */
export function AccountSwitch() {
  const { session, signIn } = useAuth();
  const { go, set } = useStore();
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const other = counterpartOf(session?.user?.id);
  if (!other) return null;

  const onPress = async () => {
    if (busy) return;
    setErr(null);
    setBusy(true);
    try {
      const res = await signIn(other.email, other.password);
      if (res.error || !res.role) { setErr(res.error ?? 'Could not switch accounts.'); return; }
      set({ role: res.role }); // the drawer picks its nav from the store role — keep it in sync
      go(res.role === 'coach' ? 'coach-dashboard' : res.role === 'crm' ? 'crm-dashboard' : 'dashboard', true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: 6 }}>
      <Pressable onPress={onPress} disabled={busy} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 11, paddingHorizontal: 13, borderRadius: 14, backgroundColor: hexA(C.purple, 0.09), borderWidth: 1, borderColor: hexA(C.purple, 0.35), opacity: busy ? 0.7 : 1 }}>
        <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: hexA(C.purple, 0.16), alignItems: 'center', justifyContent: 'center' }}>
          {busy ? <ActivityIndicator size="small" color={C.purple} /> : <Icon name="swap" size={15} color={C.purple} strokeWidth={2.2} />}
        </View>
        <View style={{ flex: 1 }}>
          <Body style={{ fontSize: 12.5, fontFamily: F.bodySemi, color: '#fff' }}>{busy ? 'Switching…' : `Switch to ${other.label}`}</Body>
          <Body style={{ fontSize: 10.5, color: C.muted2, marginTop: 1 }}>{other.workspace === 'coach' ? 'Coach dashboard' : 'Trainer dashboard'} · same person, second account</Body>
        </View>
        <Icon name="chevRight" size={14} color={C.purple} strokeWidth={2.4} />
      </Pressable>
      {err ? <Body style={{ fontSize: 10.5, color: C.gold, paddingHorizontal: 4 }}>{err}</Body> : null}
    </View>
  );
}
