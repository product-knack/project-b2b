import React from 'react';
import { View, Text, Pressable, TextInput, Modal, ScrollView, ActivityIndicator, Alert, Keyboard } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { C, F, hexA, ORANGE_GRAD } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono, Card } from '../components/primitives';
import { Page, TitleBlock, AccessPending, Badge } from './common';
import { useAuth } from '../auth';
import { useKeyboardHeight } from '../lib/useKeyboardHeight';
import { useMyReferralClients, ReferralClientOption } from '../lib/referralQueries';
import {
  UGC_TYPES, UgcContentType, MyIncentiveEvent, EVENT_TYPE_LABEL,
  useMyIncentiveEvents, useSubmitUgc, ugcTypeOf, fmtInr, incentiveTodayYmd,
} from '../lib/incentiveUgcQueries';

/* ============ Incentive (trainer sidebar page) ============
   Cards, one per incentive programme a trainer can claim from the app. Today
   that is User Generated Content (UGC): a client posts a reel or stories with
   ODDSFITNESS, the trainer submits the link, admin approves, the payout follows.
   Every submission lands in incentive_events (event_type 'ugc', status
   'pending'); the earned rows admin approvals create for referrals and upgrades
   show below it with a NULL status, so this page doubles as "my incentives". */

const UGC_ACCENT = '#E879F9';

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' });
const STATUS_META: Record<string, { label: string; color: string }> = {
  pending: { label: 'Pending', color: C.gold },
  approved: { label: 'Approved', color: C.green },
  rejected: { label: 'Rejected', color: C.red },
  earned: { label: 'Earned', color: C.green }, // status NULL: written by an admin approval
};

function EventRow({ e }: { e: MyIncentiveEvent }) {
  const meta = STATUS_META[e.status ?? 'earned'];
  const ugc = e.eventType === 'ugc' ? ugcTypeOf(e.details?.content_type ?? e.newValue) : null;
  const title = ugc ? ugc.label : EVENT_TYPE_LABEL[e.eventType] ?? e.eventType;
  const sub = [e.clientName, fmtDay(e.eventDate)].filter(Boolean).join(' · ');
  return (
    <View style={{ padding: 12, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: hexA(meta.color, 0.22), borderLeftWidth: 3, borderLeftColor: meta.color, gap: 5 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Body numberOfLines={1} style={{ flex: 1, fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{title}</Body>
        {ugc ? <Mono style={{ fontSize: 10, color: UGC_ACCENT }}>{fmtInr(ugc.amount)}</Mono> : null}
        <Badge text={meta.label} color={meta.color} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <Mono style={{ fontSize: 8.5, letterSpacing: 0.5, color: C.muted3 }}>{(EVENT_TYPE_LABEL[e.eventType] ?? e.eventType).toUpperCase()}</Mono>
        {sub ? <Body style={{ fontSize: 11, color: C.muted2 }}>· {sub}</Body> : null}
      </View>
      {e.details?.post_url ? <Body numberOfLines={1} style={{ fontSize: 10.5, color: C.muted3 }}>{e.details.post_url}</Body> : null}
      {e.details?.notes ? <Body numberOfLines={2} style={{ fontSize: 11, color: C.muted2 }}>{e.details.notes}</Body> : null}
    </View>
  );
}

/* ---------- UGC submission sheet ---------- */
function UgcSheet({ visible, onClose, userId }: { visible: boolean; onClose: () => void; userId: string }) {
  const insets = useSafeAreaInsets();
  const kbH = useKeyboardHeight();
  const clientsQ = useMyReferralClients(visible ? userId : null);
  const submitM = useSubmitUgc();
  const [type, setType] = React.useState<UgcContentType | null>(null);
  const [clientId, setClientId] = React.useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [clientQ, setClientQ] = React.useState('');
  const [url, setUrl] = React.useState('');
  const [postedOn, setPostedOn] = React.useState(incentiveTodayYmd(new Date()));
  const [notes, setNotes] = React.useState('');
  const sentRef = React.useRef(false);

  React.useEffect(() => {
    if (visible) {
      setType(null); setClientId(null); setPickerOpen(false); setClientQ(''); setUrl(''); setNotes('');
      setPostedOn(incentiveTodayYmd(new Date())); sentRef.current = false; submitM.reset();
    }
  }, [visible]);

  // Last 14 days, today first: a post is submitted soon after it goes up.
  const days = React.useMemo(() => Array.from({ length: 14 }, (_, i) => {
    const d = new Date(Date.now() - i * 86_400_000);
    return {
      iso: incentiveTodayYmd(d),
      dow: i === 0 ? 'TODAY' : i === 1 ? 'YDAY' : d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short' }).toUpperCase(),
      day: d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric' }),
      mon: d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', month: 'short' }).toUpperCase(),
    };
  }), [visible]);

  const clients = clientsQ.data ?? [];
  const client = clients.find((c) => c.id === clientId) ?? null;
  const q = clientQ.trim().toLowerCase();
  const shown = q ? clients.filter((c) => c.name.toLowerCase().includes(q)) : clients;
  const urlOk = /^https?:\/\/\S+\.\S+/i.test(url.trim());
  const canSave = !!type && !!clientId && urlOk && !submitM.isPending;

  const submit = () => {
    if (!canSave || sentRef.current || !type) return;
    Keyboard.dismiss();
    sentRef.current = true;
    submitM.mutate({ userId, clientId, contentType: type, postUrl: url, postedOn, notes }, {
      onSuccess: () => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        onClose();
        Alert.alert('Submitted for approval', 'Admin reviews the post. Once approved it counts towards your incentive payout.');
      },
      onError: (e: any) => { sentRef.current = false; Alert.alert("Couldn't submit", e?.message ?? 'Check your connection and try again.'); },
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
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" importantForAccessibility="no-hide-descendants"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.64)' }} />
        <View accessibilityViewIsModal style={{ maxHeight: kbH > 0 ? '95%' : '90%', backgroundColor: C.sheetBg, borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: hexA(UGC_ACCENT, 0.22), paddingHorizontal: 18, paddingTop: 14, paddingBottom: 14 + insets.bottom + kbH }}>
          <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 12 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 4 }}>
            <Serif style={{ flex: 1, fontSize: 19 }}>Submit UGC</Serif>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close"
              style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)' }}>
              <Icon name="close" size={14} color={C.muted} strokeWidth={2.2} />
            </Pressable>
          </View>
          <Body style={{ fontSize: 12, color: C.muted2, lineHeight: 17, marginBottom: 12 }}>
            A client posted a reel or stories with ODDSFITNESS. Admin checks the post; once approved it counts towards your payout.
          </Body>

          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 13, paddingBottom: 8 }}>
            <View style={{ gap: 7 }}>
              {label('WHAT WAS POSTED *')}
              {UGC_TYPES.map((t) => {
                const on = type === t.value;
                return (
                  <Pressable key={t.value} onPress={() => setType(t.value)} accessibilityRole="button" accessibilityState={{ selected: on }}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 11, borderRadius: 13, backgroundColor: on ? hexA(UGC_ACCENT, 0.12) : 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: on ? hexA(UGC_ACCENT, 0.5) : 'rgba(255,255,255,0.09)' }}>
                    <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: on ? 0 : 2, borderColor: 'rgba(255,255,255,0.2)', backgroundColor: on ? UGC_ACCENT : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                      {on ? <Icon name="checks" size={11} color="#1A1206" strokeWidth={3} /> : null}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: on ? F.bodyBold : F.bodySemi, fontSize: 13, color: on ? '#fff' : C.ink }}>{t.label}</Text>
                      <Body style={{ fontSize: 10.5, color: C.muted3, marginTop: 1 }}>{t.blurb}</Body>
                    </View>
                    <Mono style={{ fontSize: 11, color: on ? UGC_ACCENT : C.muted2 }}>{fmtInr(t.amount)}</Mono>
                  </Pressable>
                );
              })}
            </View>

            <View style={{ gap: 6 }}>
              {label('CLIENT WHO POSTED *')}
              <Pressable onPress={() => setPickerOpen((v) => !v)} accessibilityRole="button" accessibilityLabel="Pick the client"
                style={[field, { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 46 }]}>
                <Body style={{ flex: 1, fontSize: 14, color: client ? '#fff' : C.muted3 }}>{client ? client.name : 'Select a client'}</Body>
                {client ? (
                  <Pressable onPress={() => setClientId(null)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear">
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
                      autoCorrect={false} accessibilityLabel="Search clients" style={{ flex: 1, fontFamily: F.body, fontSize: 13.5, color: '#fff', padding: 0 }} />
                  </View>
                  <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled style={{ maxHeight: 200 }}>
                    {clientsQ.isPending ? (
                      <View style={{ paddingVertical: 16, alignItems: 'center' }}><ActivityIndicator color={UGC_ACCENT} /></View>
                    ) : !shown.length ? (
                      <Body style={{ fontSize: 12, color: C.muted3, textAlign: 'center', paddingVertical: 16 }}>No clients match.</Body>
                    ) : shown.map((c: ReferralClientOption) => {
                      const on = c.id === clientId;
                      return (
                        <Pressable key={c.id} onPress={() => { setClientId(c.id); setPickerOpen(false); setClientQ(''); }}
                          accessibilityRole="button" accessibilityState={{ selected: on }}
                          style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 11, paddingHorizontal: 12, backgroundColor: on ? hexA(UGC_ACCENT, 0.12) : 'transparent' }}>
                          <Text style={{ flex: 1, fontFamily: on ? F.bodyBold : F.body, fontSize: 13.5, color: on ? UGC_ACCENT : C.ink }}>{c.name}</Text>
                          {on ? <Icon name="checks" size={13} color={UGC_ACCENT} strokeWidth={2.6} /> : null}
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>
              ) : null}
            </View>

            <View style={{ gap: 6 }}>
              {label('LINK TO THE POST *')}
              <TextInput value={url} onChangeText={setUrl} placeholder="https://www.instagram.com/reel/…" placeholderTextColor={C.muted3}
                autoCapitalize="none" autoCorrect={false} keyboardType="url" accessibilityLabel="Post link"
                style={[field, { borderColor: url && !urlOk ? hexA(C.red, 0.5) : 'rgba(255,255,255,0.1)' }]} />
            </View>

            <View style={{ gap: 6 }}>
              {label('POSTED ON · SWIPE FOR EARLIER')}
              <ScrollView keyboardShouldPersistTaps="handled" horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 4 }}>
                {days.map((d) => {
                  const on = postedOn === d.iso;
                  return (
                    <Pressable key={d.iso} onPress={() => setPostedOn(d.iso)} accessibilityRole="button" accessibilityState={{ selected: on }}
                      style={{ width: 62, alignItems: 'center', paddingVertical: 9, borderRadius: 13, backgroundColor: on ? hexA(UGC_ACCENT, 0.14) : 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: on ? hexA(UGC_ACCENT, 0.45) : 'rgba(255,255,255,0.08)' }}>
                      <Mono style={{ fontSize: 8.5, letterSpacing: 0.8, color: on ? UGC_ACCENT : C.muted3 }}>{d.dow}</Mono>
                      <Serif style={{ fontSize: 19, color: on ? UGC_ACCENT : C.ink, marginTop: 2 }}>{d.day}</Serif>
                      <Mono style={{ fontSize: 8.5, color: on ? hexA(UGC_ACCENT, 0.8) : C.faint }}>{d.mon}</Mono>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>

            <View style={{ gap: 6 }}>
              {label('NOTES')}
              <TextInput value={notes} onChangeText={setNotes} placeholder="Anything admin should know (optional)" placeholderTextColor={C.muted3}
                multiline accessibilityLabel="Notes" style={[field, { minHeight: 70, textAlignVertical: 'top' }]} />
            </View>
          </ScrollView>

          <View style={{ flexDirection: 'row', gap: 10, paddingTop: 12 }}>
            <Pressable onPress={onClose} accessibilityRole="button"
              style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: C.muted }}>Cancel</Text>
            </Pressable>
            <Pressable onPress={submit} disabled={!canSave} accessibilityRole="button" accessibilityLabel="Submit for approval"
              style={{ flex: 1.4, borderRadius: 12, overflow: 'hidden', opacity: canSave ? 1 : 0.5 }}>
              <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ minHeight: 46, alignItems: 'center', justifyContent: 'center' }}>
                {submitM.isPending ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: '#fff' }}>Submit for approval</Text>}
              </LinearGradient>
            </Pressable>
          </View>
          {!canSave && !submitM.isPending ? <Mono style={{ fontSize: 8.5, color: C.faint, textAlign: 'center', marginTop: 7 }}>CONTENT TYPE, CLIENT AND LINK ARE REQUIRED</Mono> : null}
        </View>
      </View>
    </Modal>
  );
}

/* ================= SCREEN ================= */
export function Incentives() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null; // RLS reads `user_id = auth.uid()`: never DEV_TRAINER_ID here
  const q = useMyIncentiveEvents(userId);
  const [ugcOpen, setUgcOpen] = React.useState(false);

  if (!session) return <AccessPending />;

  const rows = q.data ?? [];
  const ugcRows = rows.filter((r) => r.eventType === 'ugc');
  const pending = ugcRows.filter((r) => r.status === 'pending').length;
  const approvedAmount = ugcRows.filter((r) => r.status === 'approved').reduce((s, r) => s + (ugcTypeOf(r.details?.content_type ?? r.newValue)?.amount ?? 0), 0);

  return (
    <Page gap={16} pt={6}>
      <TitleBlock title="Incentive" sub="Programmes you can claim from the app" />

      {/* Programme cards. One today; each new programme is one more card here. */}
      <Card onPress={() => setUgcOpen(true)} colors={['rgba(58,24,66,0.55)', 'rgba(20,14,22,0.6)']} border={hexA(UGC_ACCENT, 0.3)} radius={19} style={{ overflow: 'hidden' }}>
        <LinearGradient colors={[hexA(UGC_ACCENT, 0.6), 'rgba(255,255,255,0.02)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 3 }} />
        <View style={{ padding: 15, gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: hexA(UGC_ACCENT, 0.14), borderWidth: 1, borderColor: hexA(UGC_ACCENT, 0.4), alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="sparkle" size={20} color={UGC_ACCENT} fill={UGC_ACCENT} strokeWidth={0} />
            </View>
            <View style={{ flex: 1 }}>
              <Mono style={{ fontSize: 8.5, letterSpacing: 1.2, color: UGC_ACCENT }}>UGC</Mono>
              <Serif style={{ fontSize: 18, marginTop: 1 }}>User Generated Content</Serif>
              <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 2 }}>A client posts a reel or stories with ODDSFITNESS; you submit the link.</Body>
            </View>
            <Icon name="chevRight" size={16} color={UGC_ACCENT} strokeWidth={2.3} />
          </View>
          <View style={{ gap: 6 }}>
            {UGC_TYPES.map((t) => (
              <View key={t.value} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: UGC_ACCENT }} />
                <Body style={{ flex: 1, fontSize: 12, color: C.ink3 }}>{t.label}</Body>
                <Mono style={{ fontSize: 10.5, color: UGC_ACCENT }}>{fmtInr(t.amount)}</Mono>
              </View>
            ))}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {pending ? <Badge text={`${pending} pending review`} color={C.gold} /> : null}
              {approvedAmount ? <Badge text={`${fmtInr(approvedAmount)} approved`} color={C.green} /> : null}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, backgroundColor: hexA(UGC_ACCENT, 0.14), borderWidth: 1, borderColor: hexA(UGC_ACCENT, 0.45) }}>
              <Icon name="plus" size={12} color={UGC_ACCENT} strokeWidth={2.6} />
              <Text style={{ fontFamily: F.bodyBold, fontSize: 11.5, color: UGC_ACCENT }}>Submit UGC</Text>
            </View>
          </View>
        </View>
      </Card>

      {/* My incentive events: submissions with their review state + earned rows from admin approvals. */}
      {q.isPending ? (
        <View style={{ paddingVertical: 30, alignItems: 'center' }}><ActivityIndicator color={UGC_ACCENT} /></View>
      ) : q.isError ? (
        <Body style={{ fontSize: 12, color: C.red, textAlign: 'center', paddingVertical: 20 }}>{(q.error as Error).message}</Body>
      ) : !rows.length ? (
        <Card style={{ padding: 22, alignItems: 'center', gap: 9 }}>
          <Icon name="gift" size={26} color={C.faint} strokeWidth={1.6} />
          <Body style={{ fontSize: 12.5, color: C.muted2, textAlign: 'center' }}>No incentive events yet. Submit a UGC post above, or earn one through referrals and upgrades.</Body>
        </Card>
      ) : (
        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
            <Mono style={{ fontSize: 8.5, letterSpacing: 1.2, color: C.muted3 }}>MY INCENTIVES · {rows.length}</Mono>
            <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.07)' }} />
          </View>
          {rows.map((e) => <EventRow key={e.id} e={e} />)}
        </View>
      )}

      {userId ? <UgcSheet visible={ugcOpen} onClose={() => setUgcOpen(false)} userId={userId} /> : null}
    </Page>
  );
}
