import React from 'react';
import { View, Text, Pressable, TextInput, Modal, ScrollView, ActivityIndicator, Alert, Keyboard } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { C, F, hexA, ORANGE_GRAD } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono, Card } from '../components/primitives';
import { Page, TitleBlock, AccessPending } from './common';
import { useAuth } from '../auth';
import { useKeyboardHeight } from '../lib/useKeyboardHeight';
import {
  MyReferral, ReferralClientOption, ReferralStatus,
  useCreateReferral, useMyReferralClients, useMyReferrals,
} from '../lib/referralQueries';

/* ============ My Referrals — submit side ============
   Port of the web's TrainerReferrals / DoctorReferrals page (one screen, both
   roles). The admin approvals queue already exists natively in adminRequests.
   Approval is what creates the incentive; this screen only submits and tracks. */

const STATUS_META: Record<ReferralStatus, { label: string; color: string }> = {
  pending: { label: 'Pending', color: C.gold },
  approved: { label: 'Approved', color: C.green },
  rejected: { label: 'Rejected', color: C.red },
  // Nothing in either app ever writes 'converted' (the CHECK allows it and a
  // manager RPC counts it). Kept so a hand-edited row still renders.
  converted: { label: 'Converted', color: C.blue },
};

const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' });

function StatTile({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 13, backgroundColor: hexA(color, 0.07), borderWidth: 1, borderColor: hexA(color, 0.28) }}>
      <Serif style={{ fontSize: 22, color }}>{value}</Serif>
      <Mono style={{ fontSize: 7.5, letterSpacing: 1, color, marginTop: 2 }}>{label}</Mono>
    </View>
  );
}

function ReferralRow({ r }: { r: MyReferral }) {
  const meta = STATUS_META[r.status] ?? STATUS_META.pending;
  return (
    <View style={{ padding: 13, borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: hexA(meta.color, 0.26), gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
        <Body numberOfLines={1} style={{ flex: 1, fontSize: 15, fontFamily: F.bodySemi, color: '#fff' }}>{r.referred_client_name}</Body>
        <View style={{ paddingVertical: 3.5, paddingHorizontal: 10, borderRadius: 999, backgroundColor: hexA(meta.color, 0.14), borderWidth: 1, borderColor: hexA(meta.color, 0.4) }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 10, color: meta.color }}>{meta.label}</Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
        {r.trainer_source ? (
          <View style={{ paddingVertical: 2.5, paddingHorizontal: 8, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
            <Mono style={{ fontSize: 8, color: C.ink3 }}>{r.trainer_source.toUpperCase()}</Mono>
          </View>
        ) : null}
        <Mono style={{ fontSize: 8.5, color: C.muted3 }}>{fmtDay(r.created_at)}</Mono>
      </View>
      {r.linkedClientName ? (
        <Mono style={{ fontSize: 8.5, color: C.muted2 }}>INTRODUCED BY {r.linkedClientName.toUpperCase()}</Mono>
      ) : null}
      {r.notes ? <Body style={{ fontSize: 12, color: C.muted2, lineHeight: 17 }}>{r.notes}</Body> : null}
      {r.status === 'rejected' ? (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 9, borderRadius: 11, backgroundColor: hexA(C.red, 0.07), borderWidth: 1, borderColor: hexA(C.red, 0.24) }}>
          <View style={{ marginTop: 2 }}><Icon name="alert" size={12} color={C.red} strokeWidth={2.2} /></View>
          {/* Rejecting with no reason is allowed by the admin screen, so say so
              rather than rendering an empty block. */}
          <Body style={{ flex: 1, fontSize: 11.5, color: '#E0A090', lineHeight: 16 }}>
            {r.rejection_reason?.trim() || 'No reason was given.'}
          </Body>
        </View>
      ) : null}
    </View>
  );
}

/* ---------- add sheet ---------- */
function AddReferralSheet({ visible, onClose, referrerId }: { visible: boolean; onClose: () => void; referrerId: string }) {
  const insets = useSafeAreaInsets();
  const kbH = useKeyboardHeight();
  const clientsQ = useMyReferralClients(visible ? referrerId : null);
  const createM = useCreateReferral();
  const [name, setName] = React.useState('');
  const [source, setSource] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [linkedId, setLinkedId] = React.useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [clientQ, setClientQ] = React.useState('');
  const sentRef = React.useRef(false);

  React.useEffect(() => {
    if (visible) {
      setName(''); setSource(''); setNotes(''); setLinkedId(null);
      setPickerOpen(false); setClientQ(''); sentRef.current = false; createM.reset();
    }
  }, [visible]);

  const clients = clientsQ.data ?? [];
  const linked = clients.find((c) => c.id === linkedId) ?? null;
  const q = clientQ.trim().toLowerCase();
  const shown = q ? clients.filter((c) => c.name.toLowerCase().includes(q)) : clients;
  const canSave = !!name.trim() && !createM.isPending;

  const submit = () => {
    if (!canSave || sentRef.current) return;
    Keyboard.dismiss();
    sentRef.current = true;
    createM.mutate({ referrerId, name, source, linkedClientId: linkedId, notes }, {
      onSuccess: () => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); onClose(); },
      onError: (e: any) => { sentRef.current = false; Alert.alert("Couldn't add the referral", e?.message ?? 'Check your connection and try again.'); },
    });
  };

  const label = (t: string) => <Mono style={{ fontSize: 9, letterSpacing: 0.8, color: C.muted3 }}>{t}</Mono>;
  const field = {
    fontFamily: F.body, fontSize: 14, color: '#fff', paddingVertical: 11, paddingHorizontal: 12,
    borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  } as const;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        {/* Sibling backdrop — never a Pressable wrapping the body (house rule). */}
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" importantForAccessibility="no-hide-descendants"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.64)' }} />
        <View accessibilityViewIsModal style={{ maxHeight: kbH > 0 ? '95%' : '88%', backgroundColor: C.sheetBg, borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.16)', paddingHorizontal: 18, paddingTop: 14, paddingBottom: 14 + insets.bottom + kbH }}>
          <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 12 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 4 }}>
            <Serif style={{ flex: 1, fontSize: 19 }}>New referral</Serif>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close"
              style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)' }}>
              <Icon name="close" size={14} color={C.muted} strokeWidth={2.2} />
            </Pressable>
          </View>
          <Body style={{ fontSize: 12, color: C.muted2, lineHeight: 17, marginBottom: 12 }}>
            Admin reviews it. Once approved it counts towards your incentive.
          </Body>

          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 13, paddingBottom: 8 }}>
            <View style={{ gap: 6 }}>
              {label('NAME *')}
              <TextInput value={name} onChangeText={setName} placeholder="Who did you refer?" placeholderTextColor={C.muted3}
                accessibilityLabel="Referral name" style={field} />
            </View>

            <View style={{ gap: 6 }}>
              {label('SOURCE')}
              <TextInput value={source} onChangeText={setSource} placeholder="How did you find them? (optional)" placeholderTextColor={C.muted3}
                accessibilityLabel="Source" style={field} />
            </View>

            <View style={{ gap: 6 }}>
              {label('INTRODUCED BY A CLIENT')}
              <Pressable onPress={() => setPickerOpen((v) => !v)} accessibilityRole="button" accessibilityLabel="Pick the client who introduced them"
                style={[field, { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 46 }]}>
                <Body style={{ flex: 1, fontSize: 14, color: linked ? '#fff' : C.muted3 }}>{linked ? linked.name : 'None'}</Body>
                {linked ? (
                  <Pressable onPress={() => setLinkedId(null)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear">
                    <Icon name="close" size={13} color={C.muted2} strokeWidth={2.2} />
                  </Pressable>
                ) : null}
                <Icon name={pickerOpen ? 'chevUp' : 'chevDown'} size={14} color={C.muted} strokeWidth={2.2} />
              </Pressable>
              {pickerOpen ? (
                <View style={{ borderRadius: 11, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: '#14100D' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' }}>
                    <Icon name="search" size={13} color={C.muted3} strokeWidth={2} />
                    <TextInput value={clientQ} onChangeText={setClientQ} placeholder="Search your clients" placeholderTextColor={C.muted3}
                      autoCorrect={false} accessibilityLabel="Search clients"
                      style={{ flex: 1, fontFamily: F.body, fontSize: 13.5, color: '#fff', padding: 0 }} />
                  </View>
                  <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled style={{ maxHeight: 200 }}>
                    {clientsQ.isPending ? (
                      <View style={{ paddingVertical: 16, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View>
                    ) : !shown.length ? (
                      <Body style={{ fontSize: 12, color: C.muted3, textAlign: 'center', paddingVertical: 16 }}>No clients match.</Body>
                    ) : shown.map((c: ReferralClientOption) => {
                      const on = c.id === linkedId;
                      return (
                        <Pressable key={c.id} onPress={() => { setLinkedId(c.id); setPickerOpen(false); setClientQ(''); }}
                          accessibilityRole="button" accessibilityState={{ selected: on }}
                          style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 11, paddingHorizontal: 12, backgroundColor: on ? hexA(C.orange, 0.12) : 'transparent' }}>
                          <Text style={{ flex: 1, fontFamily: on ? F.bodyBold : F.body, fontSize: 13.5, color: on ? C.orange : C.ink }}>{c.name}</Text>
                          {on ? <Icon name="checks" size={13} color={C.orange} strokeWidth={2.6} /> : null}
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>
              ) : null}
            </View>

            <View style={{ gap: 6 }}>
              {label('NOTES')}
              <TextInput value={notes} onChangeText={setNotes} placeholder="Anything admin should know (optional)" placeholderTextColor={C.muted3}
                multiline accessibilityLabel="Notes"
                style={[field, { minHeight: 76, textAlignVertical: 'top' }]} />
            </View>
          </ScrollView>

          <View style={{ flexDirection: 'row', gap: 10, paddingTop: 12 }}>
            <Pressable onPress={onClose} accessibilityRole="button"
              style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: C.muted }}>Cancel</Text>
            </Pressable>
            <Pressable onPress={submit} disabled={!canSave} accessibilityRole="button" accessibilityLabel="Add referral"
              style={{ flex: 1.4, borderRadius: 12, overflow: 'hidden', opacity: canSave ? 1 : 0.5 }}>
              <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ minHeight: 46, alignItems: 'center', justifyContent: 'center' }}>
                {createM.isPending ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: '#fff' }}>Add referral</Text>}
              </LinearGradient>
            </Pressable>
          </View>
          {!name.trim() ? <Mono style={{ fontSize: 8.5, color: C.faint, textAlign: 'center', marginTop: 7 }}>A NAME IS ALL THAT IS REQUIRED</Mono> : null}
        </View>
      </View>
    </Modal>
  );
}

/* ================= SCREEN ================= */
export function Referrals() {
  const { session } = useAuth();
  /* The signed-in user, ALWAYS. payouts.tsx swaps in DEV_TRAINER_ID for the
     shared test account; doing that here would break both directions, since RLS
     is `referrer_id = auth.uid()` on read AND write. */
  const userId = session?.user?.id ?? null;
  const q = useMyReferrals(userId);
  const [addOpen, setAddOpen] = React.useState(false);

  if (!session) return <AccessPending />;

  const rows = q.data ?? [];
  const n = (s: ReferralStatus) => rows.filter((r) => r.status === s).length;

  return (
    <Page gap={16} pt={6}>
      <TitleBlock title="My Referrals" sub="People you brought in, and where each one stands" />

      <Pressable onPress={() => setAddOpen(true)} accessibilityRole="button" accessibilityLabel="Add a referral" style={{ borderRadius: 13, overflow: 'hidden' }}>
        <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 13 }}>
          <Icon name="userPlus" size={15} color="#fff" strokeWidth={2.4} />
          <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: '#fff' }}>New referral</Text>
        </LinearGradient>
      </Pressable>

      {/* Derived from the loaded array — nothing is stored or counted server-side.
          Web's fourth tile is "Converted"; nothing on either platform ever writes
          that status, so a permanently-zero tile is replaced by Rejected here. */}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <StatTile value={rows.length} label="TOTAL" color={C.ink3} />
        <StatTile value={n('pending')} label="PENDING" color={C.gold} />
        <StatTile value={n('approved')} label="APPROVED" color={C.green} />
        <StatTile value={n('rejected')} label="REJECTED" color={C.red} />
      </View>

      {q.isPending ? (
        <View style={{ paddingVertical: 40, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View>
      ) : q.isError ? (
        <Body style={{ fontSize: 12, color: C.red, textAlign: 'center', paddingVertical: 20 }}>{(q.error as Error).message}</Body>
      ) : !rows.length ? (
        <Card style={{ padding: 24, alignItems: 'center', gap: 10 }}>
          <Icon name="userPlus" size={28} color={C.faint} strokeWidth={1.6} />
          <Body style={{ fontSize: 12.5, color: C.muted2, textAlign: 'center' }}>
            No referrals yet. Add someone you brought in and admin takes it from there.
          </Body>
        </Card>
      ) : (
        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
            <Mono style={{ fontSize: 8.5, letterSpacing: 1.2, color: C.muted3 }}>HISTORY</Mono>
            <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.07)' }} />
          </View>
          {rows.map((r) => <ReferralRow key={r.id} r={r} />)}
        </View>
      )}

      {userId ? <AddReferralSheet visible={addOpen} onClose={() => setAddOpen(false)} referrerId={userId} /> : null}
    </Page>
  );
}
