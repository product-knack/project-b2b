import React from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Modal, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C, F, hexA, ORANGE_GRAD } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono, Card, ProgressBar } from '../components/primitives';
import { Page, TitleBlock, BackLink, Badge } from './common';
import { useStore } from '../store';
import { ManagerTeamChatCard } from './managerChat';
import { DoctorTodayRoster } from './doctor';
import { useKeyboardHeight } from '../lib/useKeyboardHeight';
import {
  useTherapistId, useTherapistClients, useTherapistTodayRoster, useTherapySessions,
  useAddTherapySession, fmtTherapyAt, fmtTherapyTime, TherapistClient, THERAPY_MODALITIES,
} from '../lib/therapistQueries';

/* ============ Therapist workspace — web /therapist parity ============
   Identity: PURPLE ("Therapy" chip is a purple outline everywhere). Sessions
   are always logged AT the current moment (no scheduling) with a mandatory
   note; they surface in Today's Roster, CRM/admin session lists and the
   doctor Rehab section via the shared tables. */
const ACC = C.purple;

const initials = (name: string) => name.split(' ').filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?';
function AvatarDot({ name, size = 26 }: { name: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: hexA(ACC, 0.25), borderWidth: 1, borderColor: hexA(ACC, 0.5), alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontFamily: F.bodyBold, fontSize: size * 0.36, color: '#E4DBFF' }}>{initials(name)}</Text>
    </View>
  );
}
function TherapyChip() {
  return (
    <View style={{ paddingVertical: 2.5, paddingHorizontal: 9, borderRadius: 999, borderWidth: 1, borderColor: hexA(ACC, 0.55), backgroundColor: hexA(ACC, 0.08) }}>
      <Mono style={{ fontSize: 8.5, letterSpacing: 0.6, color: ACC }}>THERAPY</Mono>
    </View>
  );
}
const rosterStatusColor = (s: string | null) =>
  s === 'completed' ? C.green : s === 'cancelled' || s === 'canceled' ? C.red : C.blue;

/* ---------- Add Session sheet ----------
   Fields: REQUIRED therapy type (Massage Therapy / Lymphatic Drainage),
   duration (default 60, min 5, step 5), REQUIRED note. Always stamped now() —
   no date/time picker (web spec v2 §2.1). */
function AddTherapySessionSheet({ open, clients, presetClient, onClose }: {
  open: boolean;
  clients: TherapistClient[];
  presetClient: { id: string; name: string } | null; // client detail preselects
  onClose: () => void;
}) {
  const addM = useAddTherapySession();
  const kb = useKeyboardHeight();
  const [clientId, setClientId] = React.useState<string | null>(null);
  const [therapyType, setTherapyType] = React.useState<string | null>(null);
  const [duration, setDuration] = React.useState(60);
  const [note, setNote] = React.useState('');
  const [pickerOpen, setPickerOpen] = React.useState(false);
  React.useEffect(() => {
    if (open) { setClientId(presetClient?.id ?? null); setTherapyType(null); setDuration(60); setNote(''); setPickerOpen(false); addM.reset(); }
  }, [open, presetClient?.id]);
  const selName = presetClient?.id === clientId ? presetClient?.name : clients.find((c) => c.clientId === clientId)?.name;
  const canSave = !!clientId && !!therapyType && note.trim().length > 0 && duration > 0 && !addM.isPending;
  const save = () => {
    if (!canSave || !clientId || !therapyType) return;
    addM.mutate({ clientId, durationMinutes: duration, note, therapyType }, {
      onSuccess: () => onClose(),
      onError: (e: any) => Alert.alert('Could not save session', e?.message ?? 'Please try again.'),
    });
  };
  const scrollRef = React.useRef<ScrollView>(null);
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      {/* KeyboardAvoidingView lifts the whole sheet above the keyboard so the
          note input and Save button stay visible while typing. */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable onPress={onClose} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.65)' }} />
        {/* Android edge-to-edge: KeyboardAvoidingView is unreliable there, so the sheet
            pads itself by the measured keyboard height instead (iOS keeps 'padding'). */}
        <View style={{ maxHeight: '88%', backgroundColor: '#0E0A12', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: hexA(ACC, 0.25), padding: 18, gap: 12, paddingBottom: Platform.OS === 'android' && kb > 0 ? kb + 18 : 18 }}>
          <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)' }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
            <View style={{ width: 38, height: 38, borderRadius: 13, backgroundColor: hexA(ACC, 0.14), borderWidth: 1, borderColor: hexA(ACC, 0.4), alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="heart" size={16} color={ACC} strokeWidth={2.1} />
            </View>
            <View style={{ flex: 1 }}>
              <Serif style={{ fontSize: 20 }}>Add Session</Serif>
              <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 2 }}>Logged at the current time, marked completed.</Body>
            </View>
            <Pressable onPress={onClose} hitSlop={8} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="close" size={14} color={C.muted} strokeWidth={2.3} />
            </Pressable>
          </View>

          <ScrollView ref={scrollRef} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12, paddingBottom: 24 }}>
            {/* Client (dropdown; preselected + locked from client detail) */}
            <View style={{ gap: 6 }}>
              <Mono style={{ fontSize: 8.5, letterSpacing: 0.8, color: C.muted3 }}>CLIENT</Mono>
              <Pressable
                disabled={!!presetClient}
                onPress={() => setPickerOpen((v) => !v)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 9, padding: 11, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: clientId ? hexA(ACC, 0.45) : 'rgba(255,255,255,0.1)', opacity: presetClient ? 0.85 : 1 }}
              >
                {clientId && selName ? <AvatarDot name={selName} size={24} /> : <Icon name="users" size={15} color={C.muted3} strokeWidth={2} />}
                <Body style={{ flex: 1, fontSize: 13.5, fontFamily: F.bodySemi, color: clientId ? '#fff' : C.muted3 }}>{selName ?? 'Pick a client…'}</Body>
                {!presetClient ? <Icon name="chevDown" size={13} color={C.muted2} strokeWidth={2.3} /> : null}
              </Pressable>
              {pickerOpen && !presetClient ? (
                <View style={{ maxHeight: 300, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.3)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
                  <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={false}>
                    {clients.map((c) => (
                      <Pressable key={c.clientId} onPress={() => { setClientId(c.clientId); setPickerOpen(false); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 9, paddingHorizontal: 11, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' }}>
                        <AvatarDot name={c.name} size={22} />
                        <Body style={{ flex: 1, fontSize: 13, fontFamily: F.bodySemi, color: '#fff' }} numberOfLines={1}>{c.name}</Body>
                        {clientId === c.clientId ? <Icon path="M20 6 9 17l-5-5" size={13} color={ACC} strokeWidth={3} /> : null}
                      </Pressable>
                    ))}
                    {clients.length === 0 ? <Body style={{ fontSize: 12, color: C.muted3, textAlign: 'center', paddingVertical: 14 }}>No assigned clients.</Body> : null}
                  </ScrollView>
                </View>
              ) : null}
            </View>

            {/* Therapy Type — REQUIRED (web spec v2 §2.1: two selectable cards) */}
            <View style={{ gap: 6 }}>
              <Mono style={{ fontSize: 8.5, letterSpacing: 0.8, color: therapyType ? C.muted3 : C.red }}>THERAPY TYPE · REQUIRED</Mono>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {THERAPY_MODALITIES.map((m) => {
                  const on = therapyType === m.value;
                  return (
                    <Pressable key={m.value} onPress={() => setTherapyType(m.value)} style={{ flex: 1, alignItems: 'center', gap: 6, paddingVertical: 13, paddingHorizontal: 8, borderRadius: 13, backgroundColor: on ? hexA(ACC, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1.5, borderColor: on ? hexA(ACC, 0.65) : 'rgba(255,255,255,0.1)' }}>
                      <Icon name={m.value === 'massage_therapy' ? 'heart' : 'sparkle'} size={16} color={on ? ACC : C.muted2} strokeWidth={2.1} />
                      <Text style={{ fontFamily: on ? F.bodyBold : F.bodySemi, fontSize: 12, color: on ? '#fff' : C.muted, textAlign: 'center' }}>{m.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Duration — stepper, min 5, step 5 */}
            <View style={{ gap: 6 }}>
              <Mono style={{ fontSize: 8.5, letterSpacing: 0.8, color: C.muted3 }}>DURATION · MINUTES</Mono>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Pressable onPress={() => setDuration((d) => Math.max(5, d - 5))} style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 18, color: C.ink }}>−</Text>
                </Pressable>
                <View style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: hexA(ACC, 0.3) }}>
                  <Serif style={{ fontSize: 22, color: '#fff' }}>{duration}</Serif>
                  <Mono style={{ fontSize: 7.5, letterSpacing: 0.8, color: C.muted3 }}>MINUTES</Mono>
                </View>
                <Pressable onPress={() => setDuration((d) => d + 5)} style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: hexA(ACC, 0.12), borderWidth: 1, borderColor: hexA(ACC, 0.4), alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 18, color: ACC }}>+</Text>
                </Pressable>
              </View>
            </View>

            {/* Note — REQUIRED */}
            <View style={{ gap: 6 }}>
              <Mono style={{ fontSize: 8.5, letterSpacing: 0.8, color: note.trim() ? C.muted3 : C.red }}>SESSION NOTE · REQUIRED</Mono>
              <View style={{ borderRadius: 13, borderWidth: 1, borderColor: note.trim() ? 'rgba(255,255,255,0.12)' : hexA(C.red, 0.35), backgroundColor: 'rgba(0,0,0,0.25)', paddingHorizontal: 12, paddingVertical: 10 }}>
                <TextInput
                  value={note}
                  onChangeText={setNote}
                  placeholder="What happened in this session?"
                  placeholderTextColor={C.muted3}
                  multiline
                  autoCorrect={false}
                  onFocus={() => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), Platform.OS === 'ios' ? 90 : 300)}
                  style={{ fontFamily: F.body, fontSize: 13.5, color: '#fff', minHeight: 84, maxHeight: 160, textAlignVertical: 'top', paddingTop: 0 }}
                />
              </View>
            </View>

            <Pressable onPress={save} disabled={!canSave} style={{ borderRadius: 14, overflow: 'hidden', opacity: canSave ? 1 : 0.5 }}>
              <LinearGradient colors={[hexA(ACC, 0.95), '#6D4AE0']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14 }}>
                <Icon name="checks" size={15} color="#fff" strokeWidth={2.4} />
                <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: '#fff' }}>{addM.isPending ? 'Saving…' : 'Save Session'}</Text>
              </LinearGradient>
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/* ---------- shared client row ---------- */
function ClientRow({ c, onPress }: { c: TherapistClient; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 11, paddingHorizontal: 12, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }}>
      <AvatarDot name={c.name} size={34} />
      <View style={{ flex: 1 }}>
        <Body numberOfLines={1} style={{ fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }}>{c.name}</Body>
        <Body numberOfLines={1} style={{ fontSize: 11, color: C.muted2, marginTop: 1 }}>
          {c.subscription ?? 'No subscription'}{c.sessionsTotal != null ? ` · ${c.sessionsTotal} sessions` : ''}
        </Body>
      </View>
      <Icon name="chevRight" size={15} color={hexA(ACC, 0.8)} strokeWidth={2.3} />
    </Pressable>
  );
}

/* ============ A. Dashboard ============ */
export function TherapistDashboard() {
  const { go, set } = useStore();
  const meId = useTherapistId();
  const clientsQ = useTherapistClients(meId);
  const clients = clientsQ.data ?? [];
  const [addOpen, setAddOpen] = React.useState(false);
  // Log Session straight from a roster row (preselects that client).
  const [addFor, setAddFor] = React.useState<{ id: string; name: string } | null>(null);
  return (
    <Page gap={18}>
      <TitleBlock title="Therapy Desk" sub="Your clients and today's sessions" />

      {/* Assigned Clients count card */}
      <Card onPress={() => go('therapist-clients')} colors={['rgba(44,30,66,0.5)', 'rgba(18,14,22,0.55)']} border={hexA(ACC, 0.28)} radius={19} style={{ padding: 15 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 13 }}>
          <View style={{ width: 46, height: 46, borderRadius: 15, backgroundColor: hexA(ACC, 0.14), borderWidth: 1, borderColor: hexA(ACC, 0.45), alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="users" size={20} color={ACC} strokeWidth={2} />
          </View>
          <View style={{ flex: 1 }}>
            <Mono style={{ fontSize: 8.5, letterSpacing: 1.2, color: C.mono2 }}>ASSIGNED CLIENTS</Mono>
            <Serif style={{ fontSize: 30, color: '#fff', marginTop: 1 }}>{clientsQ.isPending ? '…' : clients.length}</Serif>
          </View>
          <Icon name="chevRight" size={16} color={ACC} strokeWidth={2.3} />
        </View>
      </Card>

      {/* My Crew — therapist sits in a competition team like any member */}
      <ManagerTeamChatCard />

      {/* Today's Roster: the doctor's card, shared. Summary, NEXT badge, distance
          strip, Log Session (opens the therapy log sheet) and the same
          Cancel / Paid Cancellation flow the trainers and doctors use. */}
      <DoctorTodayRoster accent={ACC} onLog={(c) => setAddFor({ id: c.clientId, name: c.clientName })} />

      <AddTherapySessionSheet open={addOpen || !!addFor} clients={clients} presetClient={addFor} onClose={() => { setAddOpen(false); setAddFor(null); }} />
    </Page>
  );
}

/* ============ B. My Clients ============ */
export function TherapistClients() {
  const { go, set, back, canGoBack } = useStore();
  const meId = useTherapistId();
  const clientsQ = useTherapistClients(meId);
  const clients = clientsQ.data ?? [];
  const [addOpen, setAddOpen] = React.useState(false);
  return (
    <Page gap={16}>
      <BackLink label="Dashboard" onPress={() => (canGoBack ? back() : go('therapist-dashboard'))} />
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <TitleBlock title="My Clients" sub={`${clients.length} assigned client${clients.length === 1 ? '' : 's'}`} />
        </View>
        <Pressable onPress={() => setAddOpen(true)} style={{ borderRadius: 12, overflow: 'hidden' }}>
          <LinearGradient colors={[hexA(ACC, 0.95), '#6D4AE0']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 13 }}>
            <Icon name="plus" size={13} color="#fff" strokeWidth={2.6} />
            <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: '#fff' }}>Add Session</Text>
          </LinearGradient>
        </Pressable>
      </View>
      {clientsQ.isPending ? (
        <ActivityIndicator color={ACC} style={{ paddingVertical: 22 }} />
      ) : clients.length === 0 ? (
        <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 22 }}>No clients are assigned to you yet.</Body>
      ) : clients.map((c) => (
        <ClientRow key={c.clientId} c={c} onPress={() => { set({ selectedClientId: c.clientId, selectedClientName: c.name }); go('therapist-client-detail'); }} />
      ))}
      <AddTherapySessionSheet open={addOpen} clients={clients} presetClient={null} onClose={() => setAddOpen(false)} />
    </Page>
  );
}

/* ============ C. Client Detail ============ */
export function TherapistClientDetail() {
  const { go, back, canGoBack, selectedClientId, selectedClientName } = useStore();
  const meId = useTherapistId();
  const clientsQ = useTherapistClients(meId);
  const sessionsQ = useTherapySessions(selectedClientId);
  const sessions = sessionsQ.data ?? [];
  const me = (clientsQ.data ?? []).find((c) => c.clientId === selectedClientId) ?? null;
  const name = me?.name ?? selectedClientName ?? 'Client';
  const [addOpen, setAddOpen] = React.useState(false);
  return (
    <Page gap={16}>
      <BackLink label="My Clients" onPress={() => (canGoBack ? back() : go('therapist-clients'))} />
      <Card colors={['rgba(44,30,66,0.5)', 'rgba(18,14,22,0.55)']} border={hexA(ACC, 0.28)} radius={19} style={{ padding: 15, gap: 11 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <AvatarDot name={name} size={44} />
          <View style={{ flex: 1 }}>
            <Serif style={{ fontSize: 21 }}>{name}</Serif>
            <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 2 }}>
              {me?.subscription ?? 'No subscription'}{me?.sessionsTotal != null ? ` · ${me.sessionsTotal} package sessions` : ''}
            </Body>
          </View>
          <TherapyChip />
        </View>
        <Pressable onPress={() => setAddOpen(true)} style={{ borderRadius: 12, overflow: 'hidden' }}>
          <LinearGradient colors={[hexA(ACC, 0.95), '#6D4AE0']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 12 }}>
            <Icon name="plus" size={14} color="#fff" strokeWidth={2.6} />
            <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: '#fff' }}>Add Session</Text>
          </LinearGradient>
        </Pressable>
      </Card>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name="heart" size={13} color={ACC} strokeWidth={2.1} />
        <Mono style={{ flex: 1, fontSize: 9, letterSpacing: 1, color: C.mono2 }}>THERAPY SESSIONS</Mono>
        <Mono style={{ fontSize: 9, color: C.muted3 }}>{sessions.length}</Mono>
      </View>
      {sessionsQ.isPending ? (
        <ActivityIndicator color={ACC} style={{ paddingVertical: 20 }} />
      ) : sessions.length === 0 ? (
        <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 20 }}>No therapy sessions logged yet.</Body>
      ) : sessions.map((s) => (
        <View key={s.id} style={{ padding: 12, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: hexA(ACC, 0.2), gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Body style={{ flex: 1, fontSize: 12.5, fontFamily: F.bodySemi, color: '#fff' }}>{fmtTherapyAt(s.scheduledAt)}</Body>
            {s.sessionName ? <Badge text={s.sessionName} color={ACC} /> : null}
            {s.durationMinutes != null ? <Mono style={{ fontSize: 9.5, color: C.muted2 }}>{s.durationMinutes} MIN</Mono> : null}
            <Badge text={s.status ?? 'completed'} color={s.status === 'completed' ? C.green : C.blue} />
          </View>
          <Body style={{ fontSize: 10.5, color: C.muted3 }}>By {s.therapistName}</Body>
          {s.note ? <Body style={{ fontSize: 12.5, color: C.ink, lineHeight: 18 }}>{s.note}</Body> : null}
        </View>
      ))}

      <AddTherapySessionSheet
        open={addOpen}
        clients={clientsQ.data ?? []}
        presetClient={selectedClientId ? { id: selectedClientId, name } : null}
        onClose={() => setAddOpen(false)}
      />
    </Page>
  );
}
