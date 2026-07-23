import React from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator, Linking, Switch, Modal, ScrollView } from 'react-native';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono, Card, Avatar, ProgressBar } from '../components/primitives';
import { Page, Badge, BackLink, HScroll } from './common';
import { useStore } from '../store';
import { trackClientTab } from '../lib/amplitude';
import { useAuth } from '../auth';
import {
  useClientDetail, useActivePause, useClientRemarks, useAddClientRemark,
  useToggleTrainerActive, useRemoveTrainer, useAssignableTrainers, useAssignTrainer, useSetClientStatus,
  useSessionsByCycle, useWorkoutSessions, useSaveSession, useDeleteSession, useToggleComplimentary,
  useSetMonthly, usePauseJourney, useEndPause, useWeeklyGoals, useGenerationMembers, useSearchClients, useUpdateGeneration,
  SESSION_STATUSES, SESSION_FOCUS_OPTIONS, useCreateAdditionalPackage, type SessionRow,
} from '../lib/adminClientDetailQueries';
import { useUpdateClientSubscription, useToggleOddsConversion, SUBSCRIPTION_OPTIONS, type UnifiedClient } from '../lib/adminClientQueries';
import { ServicesButton } from '../components/servicesButton';

/* ============ ADMIN — Client detail (web /admin/clients/:id port) ============ */

const AV_GRADS: [string, string][] = [['#FB8B3A', '#EE5E16'], ['#57C98A', '#2E9A63'], ['#7C8FE8', '#4A5AC8'], ['#9A7BEA', '#6E5BD0'], ['#E0A53C', '#C07C1E'], ['#4FD1C5', '#2C8A86'], ['#F687B3', '#C2568A'], ['#F0883E', '#C05621']];
const avColors = (s: string): [string, string] => AV_GRADS[[...(s || '?')].reduce((a, c) => a + c.charCodeAt(0), 0) % AV_GRADS.length];
const fmtDay = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const fmtAt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }) : '—');

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      <Mono style={{ width: 108, fontSize: 8.5, letterSpacing: 0.6, color: C.muted3, marginTop: 2 }}>{label}</Mono>
      <Body style={{ flex: 1, fontSize: 12, color: C.ink2 }}>{value}</Body>
    </View>
  );
}

const inpSt = { borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 11, paddingVertical: 10, color: '#fff', fontFamily: F.body, fontSize: 13 } as const;
const todayYmd = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.62)', justifyContent: 'flex-end' }}>
        <View style={{ maxHeight: '90%', backgroundColor: '#0E0A09', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.14)', paddingHorizontal: 18, paddingTop: 14, paddingBottom: 24 }}>
          <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 12 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 10 }}>
            <Serif style={{ flex: 1, fontSize: 18 }}>{title}</Serif>
            <Pressable onPress={onClose} hitSlop={8} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="close" size={13} color="#B8B2AC" strokeWidth={2.3} />
            </Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 10, paddingBottom: 8 }}>{children}</ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/* Create/edit training session (web SessionDialog core fields). */
function SessionSheet({ clientId, existing, profileId, onClose }: { clientId: string; existing: SessionRow | null; profileId: string | null; onClose: () => void }) {
  const save = useSaveSession();
  const trainersQ = useAssignableTrainers(true);
  const d = existing ? new Date(existing.scheduled_at) : null;
  const [date, setDate] = React.useState(d ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d) : todayYmd());
  const [time, setTime] = React.useState(d ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(d) : '10:00');
  const [trainerId, setTrainerId] = React.useState<string | null>(existing?.trainer_id ?? profileId);
  const [type, setType] = React.useState(existing?.session_type ?? 'training');
  const [status, setStatus] = React.useState(existing ? (existing.cancelled ? 'cancelled' : existing.status ?? 'scheduled') : 'completed');
  const [location, setLocation] = React.useState(existing?.location ?? '');
  const [notes, setNotes] = React.useState(existing?.notes ?? '');
  const [comp, setComp] = React.useState(existing?.complimentary_session ?? false);
  const [err, setErr] = React.useState<string | null>(null);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}$/.test(time) && !!trainerId;
  return (
    <Sheet title={existing ? 'Edit session' : 'Add session'} onClose={onClose}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TextInput value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" placeholderTextColor={C.muted3} style={[inpSt, { flex: 1 }]} />
        <TextInput value={time} onChangeText={setTime} placeholder="HH:MM" placeholderTextColor={C.muted3} style={[inpSt, { width: 90 }]} />
      </View>
      <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.mono2 }}>TRAINER</Mono>
      <HScroll gap={6}>
        {(trainersQ.data ?? []).map((t) => (
          <Pressable key={t.id} onPress={() => setTrainerId(t.id)} style={{ paddingVertical: 7, paddingHorizontal: 11, borderRadius: 999, backgroundColor: trainerId === t.id ? hexA(C.orange, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: trainerId === t.id ? hexA(C.orange, 0.5) : 'rgba(255,255,255,0.09)' }}>
            <Text style={{ fontFamily: trainerId === t.id ? F.bodyBold : F.bodySemi, fontSize: 10.5, color: trainerId === t.id ? C.orange : C.muted }}>{t.name}</Text>
          </Pressable>
        ))}
      </HScroll>
      <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.mono2 }}>STATUS</Mono>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {SESSION_STATUSES.map((s) => (
          <Pressable key={s} onPress={() => setStatus(s)} style={{ paddingVertical: 7, paddingHorizontal: 11, borderRadius: 999, backgroundColor: status === s ? hexA(C.gold, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: status === s ? hexA(C.gold, 0.5) : 'rgba(255,255,255,0.09)' }}>
            <Text style={{ fontFamily: status === s ? F.bodyBold : F.bodySemi, fontSize: 10.5, color: status === s ? C.gold : C.muted }}>{s}</Text>
          </Pressable>
        ))}
      </View>
      <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.mono2 }}>SESSION FOCUS</Mono>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {SESSION_FOCUS_OPTIONS.map((f) => (
          <Pressable key={f} onPress={() => setType(f)} style={{ paddingVertical: 7, paddingHorizontal: 10, borderRadius: 999, backgroundColor: type === f ? hexA(C.blue, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: type === f ? hexA(C.blue, 0.5) : 'rgba(255,255,255,0.09)' }}>
            <Text style={{ fontFamily: type === f ? F.bodyBold : F.bodySemi, fontSize: 10, color: type === f ? C.blue : C.muted }}>{f.replace(/_/g, ' ')}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput value={location} onChangeText={setLocation} placeholder="Location" placeholderTextColor={C.muted3} style={inpSt} />
      <TextInput value={notes} onChangeText={setNotes} multiline placeholder="Notes" placeholderTextColor={C.muted3} style={[inpSt, { minHeight: 56, textAlignVertical: 'top' }]} />
      <Pressable onPress={() => setComp((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ width: 18, height: 18, borderRadius: 5, backgroundColor: comp ? hexA(C.purple, 0.3) : 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: comp ? C.purple : 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' }}>
          {comp ? <Icon name="checks" size={11} color={C.purple} strokeWidth={2.6} /> : null}
        </View>
        <Body style={{ fontSize: 11.5, color: C.ink2 }}>Complimentary (not counted toward package)</Body>
      </Pressable>
      {err ? <Body style={{ fontSize: 10.5, color: C.red }}>{err}</Body> : null}
      <Pressable disabled={save.isPending || !valid} onPress={() => {
        setErr(null);
        save.mutate({ id: existing?.id, clientId, scheduledAtIso: new Date(`${date}T${time}:00`).toISOString(), trainerId: trainerId!, sessionType: type, status, location, notes, complimentary: comp },
          { onSuccess: onClose, onError: (e: any) => setErr(e?.message ?? 'Failed') });
      }} style={{ alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: hexA(C.green, save.isPending || !valid ? 0.06 : 0.16), borderWidth: 1, borderColor: hexA(C.green, save.isPending || !valid ? 0.2 : 0.5) }}>
        <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: save.isPending || !valid ? C.muted3 : C.green }}>{save.isPending ? 'Saving…' : existing ? 'Save changes' : 'Add session'}</Text>
      </Pressable>
    </Sheet>
  );
}

/* Assign Trainers & Doctors (web AssignTrainerDialog UI): currently-active chips +
   sectioned checklists; checking assigns, unchecking removes the assignment. */
function AssignSheet({ clientId, assigned, onClose }: { clientId: string; assigned: { rowId: string; trainerId: string; name: string; role: string; actively_training: boolean }[]; onClose: () => void }) {
  const rosterQ = useAssignableTrainers(true);
  const assign = useAssignTrainer();
  const remove = useRemoveTrainer();
  const [search, setSearch] = React.useState('');
  const [err, setErr] = React.useState<string | null>(null);
  const busy = assign.isPending || remove.isPending;
  const term = search.trim().toLowerCase();
  const roster = (rosterQ.data ?? []).filter((t) => !term || t.name.toLowerCase().includes(term));
  const sections: [string, string][] = [['trainer', 'Select Trainers'], ['doctor', 'Select Doctors'], ['crm', 'Select CRMs']];
  const assignedBy = new Map(assigned.map((a) => [a.trainerId, a]));
  const active = assigned.filter((a) => a.actively_training);
  return (
    <Sheet title="Assign Trainers & Doctors" onClose={onClose}>
      {active.length ? (
        <>
          <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.mono2 }}>CURRENTLY ACTIVE</Mono>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {active.map((a) => (
              <View key={a.rowId} style={{ paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999, backgroundColor: hexA(C.gold, 0.16), borderWidth: 1, borderColor: hexA(C.gold, 0.45) }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 10, color: C.gold }}>{a.name}</Text>
              </View>
            ))}
          </View>
        </>
      ) : null}
      <TextInput value={search} onChangeText={setSearch} placeholder="Search staff…" placeholderTextColor={C.muted3} style={inpSt} />
      {err ? <Body style={{ fontSize: 10.5, color: C.red }}>{err}</Body> : null}
      {rosterQ.isPending ? <ActivityIndicator color={C.orange} style={{ paddingVertical: 20 }} /> : sections.map(([role, label]) => {
        const list = roster.filter((t) => t.role === role);
        if (!list.length) return null;
        return (
          <View key={role} style={{ gap: 6 }}>
            <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.mono2 }}>{label.toUpperCase()}</Mono>
            <View style={{ borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' }}>
              {list.slice(0, 40).map((t, i) => {
                const cur = assignedBy.get(t.id);
                const checked = !!cur;
                return (
                  <Pressable key={t.id} disabled={busy} onPress={() => {
                    setErr(null);
                    const fail = (e: any) => setErr(e?.message ?? 'Failed');
                    if (checked) remove.mutate({ rowId: cur!.rowId, clientId }, { onError: fail });
                    else assign.mutate({ clientId, trainerId: t.id }, { onError: fail });
                  }} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 11, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: 'rgba(255,255,255,0.05)' }}>
                    <View style={{ width: 19, height: 19, borderRadius: 6, backgroundColor: checked ? hexA(C.green, 0.3) : 'rgba(255,255,255,0.05)', borderWidth: 1.5, borderColor: checked ? C.green : 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' }}>
                      {checked ? <Icon name="checks" size={11} color={C.green} strokeWidth={2.8} /> : null}
                    </View>
                    <Body numberOfLines={1} style={{ flex: 1, fontSize: 12.5, color: checked ? '#fff' : C.ink2, fontFamily: checked ? F.bodySemi : F.body }}>{t.name}</Body>
                    {checked && !cur!.actively_training ? <Badge text="Inactive" color="#94A3B8" /> : null}
                  </Pressable>
                );
              })}
            </View>
          </View>
        );
      })}
      <Body style={{ fontSize: 9.5, color: C.muted3 }}>Checking assigns immediately; unchecking removes the assignment.</Body>
    </Sheet>
  );
}

/* Additional package (web AdditionalPackageDialog, core create flow). */
function AdditionalPackageSheet({ clientId, profileId, onClose }: { clientId: string; profileId: string | null; onClose: () => void }) {
  const create = useCreateAdditionalPackage();
  const [service, setService] = React.useState<'reset' | 'nutrition_package'>('reset');
  const [sessions, setSessions] = React.useState('');
  const [duration, setDuration] = React.useState('');
  const [nutMonths, setNutMonths] = React.useState('');
  const [amount, setAmount] = React.useState('');
  const [start, setStart] = React.useState(todayYmd());
  const [notes, setNotes] = React.useState('');
  const [method, setMethod] = React.useState<'razorpay' | 'cash' | 'bank_transfer'>('cash');
  const [url, setUrl] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const isNutrition = service === 'nutrition_package';
  const valid = (isNutrition ? Number(nutMonths) > 0 : Number(sessions) > 0 && duration.trim().length > 0)
    && (method !== 'razorpay' || Number(amount) > 0);
  return (
    <Sheet title="Add Additional Package" onClose={onClose}>
      <Body style={{ fontSize: 11, color: C.muted2, marginTop: -4 }}>Service: <Text style={{ fontFamily: F.bodySemi, color: C.ink2 }}>{isNutrition ? 'Nutrition Package' : 'Reset'}</Text></Body>
      <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.mono2 }}>SERVICE TYPE</Mono>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {(([['reset', 'Reset', 'layers'], ['nutrition_package', 'Nutrition Package', 'gift']]) as ['reset' | 'nutrition_package', string, any][]).map(([id, label, icon]) => (
          <Pressable key={id} onPress={() => setService(id)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11, borderRadius: 12, backgroundColor: service === id ? hexA(C.purple, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: service === id ? hexA(C.purple, 0.5) : 'rgba(255,255,255,0.09)' }}>
            <Icon name={icon} size={13} color={service === id ? C.purple : C.muted} strokeWidth={2} />
            <Text style={{ fontFamily: service === id ? F.bodyBold : F.bodySemi, fontSize: 11, color: service === id ? C.purple : C.muted }}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {isNutrition ? (
        <>
          <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.mono2 }}>DURATION (MONTHS) *</Mono>
          <TextInput value={nutMonths} onChangeText={setNutMonths} keyboardType="numeric" placeholder="e.g. 3" placeholderTextColor={C.muted3} style={inpSt} />
        </>
      ) : (
        <>
          <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.mono2 }}>PACKAGE SESSIONS *</Mono>
          <TextInput value={sessions} onChangeText={setSessions} keyboardType="numeric" placeholder="e.g. 8" placeholderTextColor={C.muted3} style={inpSt} />
          <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.mono2 }}>PACKAGE DURATION *</Mono>
          <TextInput value={duration} onChangeText={setDuration} placeholder="e.g. 1 month, 3 months" placeholderTextColor={C.muted3} style={inpSt} />
        </>
      )}
      <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.mono2 }}>AMOUNT {method === 'razorpay' ? '*' : '(OPTIONAL)'}</Mono>
      <TextInput value={amount} onChangeText={setAmount} keyboardType="numeric" placeholder="0" placeholderTextColor={C.muted3} style={inpSt} />
      <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.mono2 }}>START DATE</Mono>
      <TextInput value={start} onChangeText={setStart} placeholder="YYYY-MM-DD" placeholderTextColor={C.muted3} style={inpSt} />
      <TextInput value={notes} onChangeText={setNotes} multiline placeholder="Notes (optional)" placeholderTextColor={C.muted3} style={[inpSt, { minHeight: 48, textAlignVertical: 'top' }]} />
      <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.mono2 }}>PAYMENT METHOD</Mono>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {(([['cash', 'Cash'], ['bank_transfer', 'Bank NEFT/IMPS'], ['razorpay', 'Razorpay']]) as ['cash' | 'bank_transfer' | 'razorpay', string][]).map(([m, label]) => (
          <Pressable key={m} onPress={() => setMethod(m)} style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10, backgroundColor: method === m ? hexA(C.gold, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: method === m ? hexA(C.gold, 0.5) : 'rgba(255,255,255,0.09)' }}>
            <Text style={{ fontFamily: method === m ? F.bodyBold : F.bodySemi, fontSize: 9.5, color: method === m ? C.gold : C.muted, textAlign: 'center' }}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {method === 'razorpay' ? <Body style={{ fontSize: 9.5, color: C.muted3 }}>A payment link will be generated and shown here to share.</Body> : null}
      {url ? (
        <View style={{ padding: 10, borderRadius: 11, backgroundColor: hexA(C.green, 0.08), borderWidth: 1, borderColor: hexA(C.green, 0.35), gap: 3 }}>
          <Mono style={{ fontSize: 8, letterSpacing: 0.6, color: C.green }}>PAYMENT LINK</Mono>
          <Text selectable style={{ fontFamily: F.body, fontSize: 11, color: C.ink2 }}>{url}</Text>
        </View>
      ) : null}
      {err ? <Body style={{ fontSize: 10.5, color: C.red }}>{err}</Body> : null}
      <Pressable disabled={create.isPending || !valid} onPress={() => {
        setErr(null);
        create.mutate({ clientId, serviceName: service, sessions: isNutrition ? null : Number(sessions), durationText: duration, nutritionMonths: isNutrition ? Number(nutMonths) : null, amount: amount.trim() ? Number(amount) : null, startYmd: start, notes, method, profileId },
          { onSuccess: (res) => { if (res.paymentUrl) setUrl(res.paymentUrl); else onClose(); }, onError: (e: any) => setErr(e?.message ?? 'Failed') });
      }} style={{ alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: hexA(C.purple, create.isPending || !valid ? 0.06 : 0.16), borderWidth: 1, borderColor: hexA(C.purple, create.isPending || !valid ? 0.2 : 0.5) }}>
        <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: create.isPending || !valid ? C.muted3 : C.purple }}>{create.isPending ? 'Creating…' : 'Create package'}</Text>
      </Pressable>
    </Sheet>
  );
}

function PauseSheet({ clientId, profileId, onClose }: { clientId: string; profileId: string | null; onClose: () => void }) {
  const pause = usePauseJourney();
  const [start, setStart] = React.useState(todayYmd());
  const [end, setEnd] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [err, setErr] = React.useState<string | null>(null);
  return (
    <Sheet title="Pause journey" onClose={onClose}>
      <TextInput value={start} onChangeText={setStart} placeholder="Start YYYY-MM-DD" placeholderTextColor={C.muted3} style={inpSt} />
      <TextInput value={end} onChangeText={setEnd} placeholder="End YYYY-MM-DD" placeholderTextColor={C.muted3} style={inpSt} />
      <TextInput value={reason} onChangeText={setReason} multiline placeholder="Reason" placeholderTextColor={C.muted3} style={[inpSt, { minHeight: 52, textAlignVertical: 'top' }]} />
      {err ? <Body style={{ fontSize: 10.5, color: C.red }}>{err}</Body> : null}
      <Pressable disabled={pause.isPending} onPress={() => { setErr(null); pause.mutate({ clientId, startYmd: start, endYmd: end, reason, profileId }, { onSuccess: onClose, onError: (e: any) => setErr(e?.message ?? 'Failed') }); }}
        style={{ alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: hexA(C.blue, 0.16), borderWidth: 1, borderColor: hexA(C.blue, 0.5) }}>
        <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: C.blue }}>{pause.isPending ? 'Pausing…' : 'Pause journey'}</Text>
      </Pressable>
    </Sheet>
  );
}

export function AdminClientDetail() {
  const { selectedClientId } = useStore();
  const { session } = useAuth();
  const profileId = session?.user?.id ?? null;
  const q = useClientDetail(selectedClientId);
  const pauseQ = useActivePause(selectedClientId);
  const [tab, setTab] = React.useState<'overview' | 'sessions' | 'remarks' | 'goals' | 'circle'>('overview');
  React.useEffect(() => { trackClientTab('admin-client-detail', tab, { id: selectedClientId }); }, [tab]);
  const setMonthly = useSetMonthly();
  const endPause = useEndPause();
  const [pauseOpen, setPauseOpen] = React.useState(false);
  const [pkgOpen, setPkgOpen] = React.useState(false);
  const [sessTab, setSessTab] = React.useState<'training' | 'workout'>('training');
  const [openPkg, setOpenPkg] = React.useState<number | null>(1);
  const [openCycle, setOpenCycle] = React.useState<string | null>(null);
  const [sessSheet, setSessSheet] = React.useState<{ mode: 'add' } | { mode: 'edit'; s: SessionRow } | null>(null);
  const [delArm, setDelArm] = React.useState<string | null>(null);
  const cycleQ = useSessionsByCycle(tab === 'sessions' && sessTab === 'training' ? selectedClientId : null);
  const workoutQ = useWorkoutSessions(tab === 'sessions' && sessTab === 'workout' ? selectedClientId : null);
  const delSession = useDeleteSession();
  const toggleComp = useToggleComplimentary();
  const goalsQ = useWeeklyGoals(tab === 'goals' ? selectedClientId : null);
  const memberIds: string[] = Array.isArray((q.data as any)?.generation_members) ? (q.data as any).generation_members : [];
  const membersQ = useGenerationMembers(tab === 'circle' ? memberIds : []);
  const [memberSearch, setMemberSearch] = React.useState('');
  const searchQ = useSearchClients(tab === 'circle' ? memberSearch : '');
  const updateGen = useUpdateGeneration();
  const [err, setErr] = React.useState<string | null>(null);
  const c = q.data;

  const setStatus = useSetClientStatus();
  const updateSub = useUpdateClientSubscription();
  const toggleOdds = useToggleOddsConversion();
  const toggleTrainer = useToggleTrainerActive();
  const removeTrainer = useRemoveTrainer();
  const assign = useAssignTrainer();
  const [subOpen, setSubOpen] = React.useState(false);
  const [assignOpen, setAssignOpen] = React.useState(false);
  const [removeArm, setRemoveArm] = React.useState<string | null>(null);
  const trainersQ = useAssignableTrainers(assignOpen);
  const fail = (e: any) => setErr(e?.message ?? 'Failed');
  const asUnified = c ? ({ ...c } as unknown as UnifiedClient) : null;

  const remarksQ = useClientRemarks(tab === 'remarks' ? selectedClientId : null);
  const addRemark = useAddClientRemark();
  const [remark, setRemark] = React.useState('');

  if (!selectedClientId) return <Page><Body style={{ color: C.muted3, textAlign: 'center', paddingVertical: 40 }}>No client selected.</Body></Page>;
  const name = c ? `${c.first_name ?? ''} ${c.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || '—' : '';
  const remaining = c ? c.pkg.total - c.pkg.used : 0;

  return (
    <Page gap={13}>
      <BackLink label="All clients" />
      {q.isPending ? <View style={{ paddingVertical: 40, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View>
      : q.isError ? <Body style={{ fontSize: 11.5, color: C.red, textAlign: 'center' }}>{(q.error as Error).message}</Body>
      : c ? (
        <>
          {/* Hero */}
          <Card colors={['rgba(64,38,22,0.5)', 'rgba(20,16,15,0.55)']} border={hexA(C.orange, 0.22)} radius={18} style={{ padding: 14, gap: 11 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
              <Avatar initial={(name[0] ?? '?').toUpperCase()} size={44} colors={avColors(name)} fontSize={17} />
              <View style={{ flex: 1 }}>
                <Serif numberOfLines={1} style={{ fontSize: 19 }}>{name}</Serif>
                {c.email ? <Body numberOfLines={1} style={{ fontSize: 10.5, color: C.muted2 }}>{c.email}</Body> : null}
                {c.phone ? (
                  <Pressable onPress={() => Linking.openURL(`tel:${c.phone}`)} hitSlop={6}>
                    <Body style={{ fontSize: 10.5, color: C.blue }}>{c.phone}</Body>
                  </Pressable>
                ) : null}
              </View>
              <View style={{ alignItems: 'center', gap: 2 }}>
                <Switch value={c.status !== 'inactive' && c.status !== 'discontinued'} disabled={setStatus.isPending || c.status === 'discontinued'}
                  onValueChange={(v) => { setErr(null); setStatus.mutate({ clientId: c.id, status: v ? 'active' : 'inactive', prev: c.status, profileId }, { onError: fail }); }}
                  trackColor={{ false: 'rgba(255,255,255,0.15)', true: hexA(C.green, 0.5) }} thumbColor={c.status !== 'inactive' ? C.green : C.muted3} />
                <Mono style={{ fontSize: 7, letterSpacing: 0.5, color: C.muted3 }}>{(c.status ?? 'active').toUpperCase()}</Mono>
              </View>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
              <Badge text={c.client_source} color={c.client_source === 'B2C' ? C.blue : C.purple} />
              {c.subscription_type ? <Badge text={c.subscription_type} color={C.gold} /> : <Badge text="No sub" color="#94A3B8" />}
              {c.is_odds_converted ? <Badge text="ODDS Converted" color={C.green} /> : null}
              {c.goal ? <Badge text={c.goal} color={C.blue} /> : null}
              <ServicesButton subscriptionType={c.subscription_type} />
            </View>
            {/* Toggles + actions row */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4, paddingHorizontal: 9, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)' }}>
                <Mono style={{ fontSize: 7.5, letterSpacing: 0.5, color: C.muted3 }}>MONTHLY</Mono>
                <Switch value={!!(c as any).is_monthly_subscription} disabled={setMonthly.isPending}
                  onValueChange={(v) => { setErr(null); setMonthly.mutate({ clientId: c.id, next: v }, { onError: fail }); }}
                  trackColor={{ false: 'rgba(255,255,255,0.15)', true: hexA(C.gold, 0.5) }} thumbColor={(c as any).is_monthly_subscription ? C.gold : C.muted3}
                  style={{ transform: [{ scale: 0.75 }] }} />
              </View>
              {pauseQ.data ? (
                <Pressable disabled={endPause.isPending} onPress={() => { setErr(null); endPause.mutate({ pauseId: pauseQ.data.id, clientId: c.id }, { onError: fail }); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 7, paddingHorizontal: 11, borderRadius: 10, backgroundColor: hexA(C.green, 0.12), borderWidth: 1, borderColor: hexA(C.green, 0.4) }}>
                  <Icon name="clock" size={11} color={C.green} strokeWidth={2.2} />
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 10.5, color: C.green }}>{endPause.isPending ? '…' : 'Resume'}</Text>
                </Pressable>
              ) : (
                <Pressable onPress={() => setPauseOpen(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 7, paddingHorizontal: 11, borderRadius: 10, backgroundColor: hexA(C.blue, 0.12), borderWidth: 1, borderColor: hexA(C.blue, 0.4) }}>
                  <Icon name="clock" size={11} color={C.blue} strokeWidth={2.2} />
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 10.5, color: C.blue }}>Pause</Text>
                </Pressable>
              )}
              <Pressable onPress={() => setPkgOpen(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 7, paddingHorizontal: 11, borderRadius: 10, backgroundColor: hexA(C.purple, 0.12), borderWidth: 1, borderColor: hexA(C.purple, 0.4) }}>
                <Icon name="plus" size={11} color={C.purple} strokeWidth={2.4} />
                <Text style={{ fontFamily: F.bodyBold, fontSize: 10.5, color: C.purple }}>Additional Package</Text>
              </Pressable>
            </View>
            {/* KPI strip */}
            <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)', paddingTop: 10 }}>
              {(([['ONBOARDED', fmtDay(c.created_at)], ['PACKAGE', c.pkg.total ? `${c.pkg.used}/${c.pkg.total}` : '—'], ['TOTAL SESSIONS', String(c.completed_sessions)], ['TYPE', c.is_hybrid ? 'Hybrid' : 'In-Person']]) as [string, string][]).map(([lab, val], i) => (
                <View key={lab} style={{ flex: 1, alignItems: 'center', gap: 2, borderLeftWidth: i === 0 ? 0 : 1, borderLeftColor: 'rgba(255,255,255,0.06)' }}>
                  <Serif style={{ fontSize: 14 }}>{val}</Serif>
                  <Mono style={{ fontSize: 7, letterSpacing: 0.4, color: C.muted3 }}>{lab}</Mono>
                </View>
              ))}
            </View>
            {c.pkg.total > 0 ? (
              <View style={{ gap: 4 }}>
                <ProgressBar pct={Math.min(100, (c.pkg.used / c.pkg.total) * 100)} height={6} animated fill={remaining <= 0 ? C.red : undefined} />
                <Body style={{ fontSize: 9.5, color: remaining <= 0 ? C.red : C.muted3 }}>
                  {remaining <= 0 ? 'Renewal Pending' : `${remaining} sessions left in current package`}{c.pkg.renewedAt ? ` · renewed ${fmtDay(c.pkg.renewedAt)}` : ''}
                </Body>
              </View>
            ) : null}
          </Card>

          {/* Active pause banner */}
          {pauseQ.data ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, padding: 11, borderRadius: 13, backgroundColor: hexA(C.blue, 0.09), borderWidth: 1, borderColor: hexA(C.blue, 0.35) }}>
              <Icon name="clock" size={14} color={C.blue} strokeWidth={2.2} />
              <Body style={{ flex: 1, fontSize: 11, color: '#A9BCFF' }}>
                Journey paused {fmtDay(pauseQ.data.pause_start)} – {fmtDay(pauseQ.data.pause_end)}{(pauseQ.data.reason_admin || pauseQ.data.reason) ? ` · ${pauseQ.data.reason_admin || pauseQ.data.reason}` : ''}
              </Body>
              <Pressable disabled={endPause.isPending} onPress={() => { setErr(null); endPause.mutate({ pauseId: pauseQ.data.id, clientId: c.id }, { onError: fail }); }} style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 9, backgroundColor: hexA(C.blue, 0.16), borderWidth: 1, borderColor: hexA(C.blue, 0.45) }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 10, color: C.blue }}>{endPause.isPending ? '…' : 'End pause'}</Text>
              </Pressable>
            </View>
          ) : null}

          {/* Tabs */}
          <HScroll gap={7}>
            {(([['overview', 'Overview'], ['sessions', 'Sessions'], ['remarks', 'Remarks'], ['goals', 'Goals'], ['circle', 'Odds Generation']]) as [typeof tab, string][]).map(([id, label]) => {
              const active = tab === id;
              return (
                <Pressable key={id} onPress={() => setTab(id)} style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: active ? hexA(C.orange, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.orange, 0.5) : 'rgba(255,255,255,0.09)' }}>
                  <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 11.5, color: active ? C.orange : C.muted }}>{label}</Text>
                </Pressable>
              );
            })}
          </HScroll>
          {err ? <Body style={{ fontSize: 10.5, color: C.red, textAlign: 'center' }}>{err}</Body> : null}

          {tab === 'overview' ? (
            <>
              <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.12)" radius={15} style={{ padding: 13, gap: 8 }}>
                <Mono style={{ fontSize: 9.5, letterSpacing: 1.2, color: C.mono }}>CLIENT INFORMATION</Mono>
                <InfoRow label="GOAL" value={c.goal ?? '—'} />
                <InfoRow label="PACKAGE" value={c.session_package ? `${c.session_package} sessions` : '—'} />
                <InfoRow label="DURATION" value={c.package_duration ?? '—'} />
                <InfoRow label="PER CYCLE" value={c.sessions_per_cycle != null ? String(c.sessions_per_cycle) : '—'} />
                <InfoRow label="SESSION TYPE" value={c.is_hybrid ? 'Hybrid' : 'In-Person'} />
                {c.notes ? <InfoRow label="NOTES" value={c.notes} /> : null}
              </Card>

              <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.12)" radius={15} style={{ padding: 13, gap: 9 }}>
                <Mono style={{ fontSize: 9.5, letterSpacing: 1.2, color: C.mono }}>SUBSCRIPTION & STATUS</Mono>
                <View style={{ flexDirection: 'row', gap: 7, flexWrap: 'wrap' }}>
                  <Pressable onPress={() => setSubOpen((v) => !v)} style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, backgroundColor: hexA(C.gold, 0.12), borderWidth: 1, borderColor: hexA(C.gold, 0.4) }}>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: C.gold }}>Change subscription {subOpen ? '▴' : '▾'}</Text>
                  </Pressable>
                  <Pressable disabled={toggleOdds.isPending} onPress={() => { setErr(null); asUnified && toggleOdds.mutate(asUnified, { onError: fail }); }} style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, backgroundColor: hexA(C.purple, 0.12), borderWidth: 1, borderColor: hexA(C.purple, 0.4) }}>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: C.purple }}>{toggleOdds.isPending ? 'Working…' : c.is_odds_converted ? 'Remove ODDS conversion' : 'Mark as ODDS Converted'}</Text>
                  </Pressable>
                </View>
                {subOpen ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {['none', ...SUBSCRIPTION_OPTIONS].map((s) => {
                      const active = s === 'none' ? c.subscription_type == null : c.subscription_type === s;
                      return (
                        <Pressable key={s} disabled={active || updateSub.isPending} onPress={() => { setErr(null); asUnified && updateSub.mutate({ client: asUnified, type: s === 'none' ? null : s }, { onSuccess: () => setSubOpen(false), onError: fail }); }}
                          style={{ paddingVertical: 7, paddingHorizontal: 11, borderRadius: 999, backgroundColor: active ? hexA(C.gold, 0.2) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.gold, 0.6) : 'rgba(255,255,255,0.09)' }}>
                          <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 10.5, color: active ? C.gold : C.muted }}>{s === 'none' ? 'None' : s}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}
                {c.client_source === 'B2C' ? <Body style={{ fontSize: 9.5, color: C.muted3 }}>B2C client — changes dual-write to the client's profile.</Body> : null}
              </Card>

              <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.12)" radius={15} style={{ padding: 13, gap: 9 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Mono style={{ flex: 1, fontSize: 9.5, letterSpacing: 1.2, color: C.mono }}>ASSIGNED TRAINERS · {c.trainers.length}</Mono>
                  <Pressable onPress={() => setAssignOpen(true)} style={{ paddingVertical: 6, paddingHorizontal: 11, borderRadius: 999, backgroundColor: hexA(C.orange, 0.13), borderWidth: 1, borderColor: hexA(C.orange, 0.4) }}>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 10, color: C.orange }}>+ Assign</Text>
                  </Pressable>
                </View>
                {c.trainers.length === 0 ? <Body style={{ fontSize: 11, color: C.muted3 }}>No trainers assigned.</Body> : c.trainers.map((t) => (
                  <View key={t.rowId} style={{ flexDirection: 'row', alignItems: 'center', gap: 9, padding: 9, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.22)' }}>
                    <Avatar initial={(t.name[0] ?? '?').toUpperCase()} size={30} colors={avColors(t.name)} fontSize={11} />
                    <View style={{ flex: 1 }}>
                      <Body numberOfLines={1} style={{ fontSize: 12, fontFamily: F.bodySemi, color: '#fff' }}>{t.name}</Body>
                      <View style={{ flexDirection: 'row', gap: 5, marginTop: 2 }}>
                        <Badge text={t.role} color={t.role === 'doctor' ? C.blue : C.orange} />
                        <Badge text={t.actively_training ? 'Active' : 'Inactive'} color={t.actively_training ? C.green : '#94A3B8'} />
                      </View>
                    </View>
                    <Switch value={t.actively_training} disabled={toggleTrainer.isPending}
                      onValueChange={(v) => { setErr(null); toggleTrainer.mutate({ rowId: t.rowId, next: v, clientId: c.id }, { onError: fail }); }}
                      trackColor={{ false: 'rgba(255,255,255,0.15)', true: hexA(C.green, 0.5) }} thumbColor={t.actively_training ? C.green : C.muted3} />
                    <Pressable disabled={removeTrainer.isPending} onPress={() => {
                      setErr(null);
                      if (removeArm === t.rowId) removeTrainer.mutate({ rowId: t.rowId, clientId: c.id }, { onSuccess: () => setRemoveArm(null), onError: fail });
                      else setRemoveArm(t.rowId);
                    }} hitSlop={6} style={{ width: 28, height: 28, borderRadius: 10, backgroundColor: hexA(C.red, removeArm === t.rowId ? 0.25 : 0.1), borderWidth: 1, borderColor: hexA(C.red, 0.4), alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name="close" size={11} color={C.red} strokeWidth={2.5} />
                    </Pressable>
                  </View>
                ))}
                {removeArm ? <Body style={{ fontSize: 9.5, color: C.red }}>Tap ✕ again to confirm removing the trainer.</Body> : null}
              </Card>
            </>
          ) : tab === 'sessions' ? (
            <>
              <View style={{ flexDirection: 'row', gap: 7, alignItems: 'center' }}>
                {(([['training', 'Training Sessions'], ['workout', 'Workout Sessions']]) as ['training' | 'workout', string][]).map(([f, label]) => (
                  <Pressable key={f} onPress={() => setSessTab(f)} style={{ paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, backgroundColor: sessTab === f ? hexA(C.orange, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: sessTab === f ? hexA(C.orange, 0.5) : 'rgba(255,255,255,0.09)' }}>
                    <Text style={{ fontFamily: sessTab === f ? F.bodyBold : F.bodySemi, fontSize: 10.5, color: sessTab === f ? C.orange : C.muted }}>{label}</Text>
                  </Pressable>
                ))}
                <View style={{ flex: 1 }} />
                {sessTab === 'training' ? (
                  <Pressable onPress={() => setSessSheet({ mode: 'add' })} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 7, paddingHorizontal: 11, borderRadius: 10, backgroundColor: hexA(C.green, 0.13), borderWidth: 1, borderColor: hexA(C.green, 0.4) }}>
                    <Icon name="plus" size={11} color={C.green} strokeWidth={2.6} />
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 10.5, color: C.green }}>Add</Text>
                  </Pressable>
                ) : null}
              </View>
              {sessTab === 'training' ? (
                cycleQ.isPending ? <ActivityIndicator color={C.orange} style={{ paddingVertical: 24 }} />
                : cycleQ.isError ? <Body style={{ fontSize: 11, color: C.red, textAlign: 'center' }}>{(cycleQ.error as Error).message}</Body>
                : (cycleQ.data?.packages ?? []).map((p) => (
                  <Card key={p.n} colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border={hexA(p.isCurrent ? C.orange : '#94A3B8', p.isCurrent ? 0.3 : 0.12)} radius={15} style={{ padding: 12, gap: 8 }}>
                    <Pressable onPress={() => setOpenPkg(openPkg === p.n ? null : p.n)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Serif style={{ fontSize: 14 }}>Package {p.n}</Serif>
                      {p.isCurrent ? <Badge text="Current" color={C.orange} /> : null}
                      <View style={{ flex: 1 }} />
                      <Mono style={{ fontSize: 8, letterSpacing: 0.4, color: C.muted3 }}>{p.countable}/{p.total || '∞'} · {p.perCycle}/CYCLE</Mono>
                      <Icon name={openPkg === p.n ? 'chevUp' : 'chevDown'} size={12} color={C.muted3} strokeWidth={2.3} />
                    </Pressable>
                    <Body style={{ fontSize: 9.5, color: C.muted3 }}>{fmtDay(p.start)} – {p.end ? fmtDay(p.end) : 'ongoing'}</Body>
                    {openPkg === p.n ? p.cycles.map((cy) => {
                      const key = `${p.n}-${cy.n}`;
                      const open = openCycle === key || (openCycle === null && cy.isCurrent);
                      return (
                        <View key={key} style={{ borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.2)', padding: 9, gap: 7 }}>
                          <Pressable onPress={() => setOpenCycle(open ? `${key}-closed` : key)} style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                            <Body style={{ fontSize: 12, fontFamily: F.bodySemi, color: '#fff' }}>Cycle {cy.n}</Body>
                            {cy.isCurrent ? <Badge text="Current" color={C.green} /> : null}
                            <View style={{ flex: 1 }} />
                            <Mono style={{ fontSize: 7.5, letterSpacing: 0.4, color: C.muted3 }}>{cy.sessions.length} SESSIONS</Mono>
                            <Icon name={open ? 'chevUp' : 'chevDown'} size={11} color={C.muted3} strokeWidth={2.3} />
                          </Pressable>
                          {open ? cy.sessions.map((s) => {
                            const col = s.cancelled || s.status === 'cancelled' ? C.red : C.green;
                            return (
                              <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 7, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)' }}>
                                <View style={{ flex: 1 }}>
                                  <Body style={{ fontSize: 11, fontFamily: F.bodySemi, color: '#fff' }}>{fmtAt(s.scheduled_at)}</Body>
                                  <Body numberOfLines={1} style={{ fontSize: 9.5, color: C.muted3, marginTop: 1 }}>{s.trainerName} · {s.session_type ?? '—'}</Body>
                                </View>
                                {s.complimentary_session ? <Badge text="Comp" color={C.purple} /> : null}
                                <Badge text={s.cancelled || s.status === 'cancelled' ? 'cancelled' : 'completed'} color={col} />
                                <Pressable disabled={toggleComp.isPending} onPress={() => { setErr(null); toggleComp.mutate({ id: s.id, next: !s.complimentary_session, clientId: c.id }, { onError: fail }); }} hitSlop={5} style={{ width: 26, height: 26, borderRadius: 9, backgroundColor: hexA(C.purple, s.complimentary_session ? 0.25 : 0.08), borderWidth: 1, borderColor: hexA(C.purple, 0.4), alignItems: 'center', justifyContent: 'center' }}>
                                  <Icon name="gift" size={11} color={C.purple} strokeWidth={2.2} />
                                </Pressable>
                                <Pressable onPress={() => setSessSheet({ mode: 'edit', s })} hitSlop={5} style={{ width: 26, height: 26, borderRadius: 9, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}>
                                  <Icon name="clipboard" size={11} color={C.muted} strokeWidth={2} />
                                </Pressable>
                                <Pressable disabled={delSession.isPending} onPress={() => {
                                  setErr(null);
                                  if (delArm === s.id) delSession.mutate({ id: s.id, clientId: c.id }, { onSuccess: () => setDelArm(null), onError: fail });
                                  else setDelArm(s.id);
                                }} hitSlop={5} style={{ width: 26, height: 26, borderRadius: 9, backgroundColor: hexA(C.red, delArm === s.id ? 0.3 : 0.08), borderWidth: 1, borderColor: hexA(C.red, 0.4), alignItems: 'center', justifyContent: 'center' }}>
                                  <Icon name="close" size={10} color={C.red} strokeWidth={2.5} />
                                </Pressable>
                              </View>
                            );
                          }) : null}
                        </View>
                      );
                    }) : null}
                  </Card>
                ))
              ) : (
                workoutQ.isPending ? <ActivityIndicator color={C.orange} style={{ paddingVertical: 24 }} />
                : (workoutQ.data ?? []).length === 0 ? <Body style={{ fontSize: 11.5, color: C.muted3, textAlign: 'center', paddingVertical: 18 }}>No logged workouts.</Body>
                : (workoutQ.data ?? []).slice(0, 50).map((w: any) => (
                  <View key={w.session_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 9, padding: 10, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.22)', borderLeftWidth: 3, borderLeftColor: C.blue }}>
                    <View style={{ flex: 1 }}>
                      <Body numberOfLines={1} style={{ fontSize: 11.5, fontFamily: F.bodySemi, color: '#fff' }}>{w.session_name ?? 'Workout'}</Body>
                      <Body numberOfLines={1} style={{ fontSize: 10, color: C.muted3, marginTop: 1 }}>{w.trainerName} · {fmtDay(w.session_date)}</Body>
                    </View>
                    {w.modality ? <Badge text={w.modality} color={C.blue} /> : null}
                  </View>
                ))
              )}
              {delArm ? <Body style={{ fontSize: 9.5, color: C.red }}>Tap ✕ again to confirm deleting the session.</Body> : null}
            </>
          ) : tab === 'goals' ? (
            goalsQ.isPending ? <ActivityIndicator color={C.orange} style={{ paddingVertical: 24 }} />
            : (goalsQ.data ?? []).length === 0 ? <Body style={{ fontSize: 11.5, color: C.muted3, textAlign: 'center', paddingVertical: 18 }}>No weekly goals set.</Body>
            : (goalsQ.data ?? []).map((g: any) => (
              <Card key={g.id} colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.12)" radius={15} style={{ padding: 12, gap: 8 }}>
                <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.mono }}>WEEK {fmtDay(g.week_start_date).toUpperCase()} – {fmtDay(g.week_end_date).toUpperCase()}</Mono>
                <View style={{ flexDirection: 'row' }}>
                  {(([['SLEEP', g.sleep_target_hours != null ? `${g.sleep_target_hours}h` : '—'], ['STEPS', g.steps_target != null ? String(g.steps_target) : '—'], ['ZONE 2', g.z2c_target != null ? String(g.z2c_target) : '—']]) as [string, string][]).map(([lab, val], i) => (
                    <View key={lab} style={{ flex: 1, alignItems: 'center', gap: 2, borderLeftWidth: i === 0 ? 0 : 1, borderLeftColor: 'rgba(255,255,255,0.06)' }}>
                      <Serif style={{ fontSize: 15 }}>{val}</Serif>
                      <Mono style={{ fontSize: 7, letterSpacing: 0.4, color: C.muted3 }}>{lab}</Mono>
                    </View>
                  ))}
                </View>
                {g.nutrition_target ? <Body style={{ fontSize: 10.5, color: C.muted2 }}>Nutrition: <Text style={{ color: C.ink2 }}>{g.nutrition_target}</Text></Body> : null}
                {g.recommendation ? <Body style={{ fontSize: 10.5, color: C.muted2 }}>Note: <Text style={{ color: C.ink2 }}>{g.recommendation}</Text></Body> : null}
              </Card>
            ))
          ) : tab === 'circle' ? (
            <>
              <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.12)" radius={15} style={{ padding: 12, gap: 9 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                  <Body style={{ flex: 1, fontSize: 12.5, fontFamily: F.bodySemi, color: '#fff' }}>Generation Admin</Body>
                  <Switch value={!!(c as any).generation_admin} disabled={updateGen.isPending}
                    onValueChange={(v) => { setErr(null); updateGen.mutate({ clientId: c.id, generationAdmin: v, members: memberIds }, { onError: fail }); }}
                    trackColor={{ false: 'rgba(255,255,255,0.15)', true: hexA(C.purple, 0.5) }} thumbColor={(c as any).generation_admin ? C.purple : C.muted3} />
                </View>
                <Body style={{ fontSize: 10, color: C.muted3 }}>Circle members' sessions are billed from this client's shared package pool.</Body>
              </Card>
              {(c as any).generation_admin ? (
                <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.12)" radius={15} style={{ padding: 12, gap: 9 }}>
                  <Mono style={{ fontSize: 9.5, letterSpacing: 1.2, color: C.mono }}>CIRCLE MEMBERS · {memberIds.length}</Mono>
                  {(membersQ.data ?? []).map((m) => (
                    <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 9, padding: 8, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.22)' }}>
                      <Body style={{ flex: 1, fontSize: 12, color: '#fff' }}>{m.name}</Body>
                      <Pressable disabled={updateGen.isPending} onPress={() => { setErr(null); updateGen.mutate({ clientId: c.id, generationAdmin: true, members: memberIds.filter((x) => x !== m.id) }, { onError: fail }); }} hitSlop={6} style={{ width: 26, height: 26, borderRadius: 9, backgroundColor: hexA(C.red, 0.1), borderWidth: 1, borderColor: hexA(C.red, 0.4), alignItems: 'center', justifyContent: 'center' }}>
                        <Icon name="close" size={10} color={C.red} strokeWidth={2.5} />
                      </Pressable>
                    </View>
                  ))}
                  <TextInput value={memberSearch} onChangeText={setMemberSearch} placeholder="Search clients to add…" placeholderTextColor={C.muted3} style={inpSt} />
                  {(searchQ.data ?? []).filter((r) => r.id !== c.id && !memberIds.includes(r.id)).map((r) => (
                    <Pressable key={r.id} disabled={updateGen.isPending} onPress={() => { setErr(null); updateGen.mutate({ clientId: c.id, generationAdmin: true, members: [...memberIds, r.id] }, { onSuccess: () => setMemberSearch(''), onError: fail }); }}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 7, padding: 9, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)' }}>
                      <Icon name="userPlus" size={12} color={C.green} strokeWidth={2.2} />
                      <Body style={{ fontSize: 11.5, color: C.ink2 }}>{r.name}</Body>
                    </Pressable>
                  ))}
                </Card>
              ) : null}
            </>
          ) : (
            <>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
                <TextInput value={remark} onChangeText={(v) => setRemark(v.slice(0, 600))} multiline placeholder="Add a remark…" placeholderTextColor={C.muted3}
                  style={{ flex: 1, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 11, paddingVertical: 10, color: '#fff', fontFamily: F.body, fontSize: 13, minHeight: 44, maxHeight: 100 }} />
                <Pressable disabled={addRemark.isPending || remark.trim().length < 3} onPress={() => { setErr(null); addRemark.mutate({ clientId: c.id, content: remark, profileId }, { onSuccess: () => setRemark(''), onError: fail }); }}
                  style={{ paddingVertical: 11, paddingHorizontal: 13, borderRadius: 11, backgroundColor: hexA(C.orange, remark.trim().length < 3 ? 0.06 : 0.16), borderWidth: 1, borderColor: hexA(C.orange, remark.trim().length < 3 ? 0.2 : 0.5) }}>
                  <Icon name="send" size={14} color={remark.trim().length < 3 ? C.muted3 : C.orange} strokeWidth={2.2} />
                </Pressable>
              </View>
              {remarksQ.isPending ? <ActivityIndicator color={C.orange} style={{ paddingVertical: 24 }} /> : (remarksQ.data ?? []).length === 0 ? (
                <Body style={{ fontSize: 11.5, color: C.muted3, textAlign: 'center', paddingVertical: 18 }}>No remarks yet.</Body>
              ) : (remarksQ.data ?? []).map((r: any) => (
                <View key={r.id} style={{ padding: 11, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.22)', gap: 4 }}>
                  <Body style={{ fontSize: 12, color: C.ink2, lineHeight: 17 }}>{r.content}</Body>
                  <Mono style={{ fontSize: 7.5, letterSpacing: 0.4, color: C.muted3 }}>{(r.authorName ?? '—').toUpperCase()}{r.authorRole ? ` · ${String(r.authorRole).toUpperCase()}` : ''} · {fmtAt(r.created_at).toUpperCase()}</Mono>
                </View>
              ))}
            </>
          )}
        </>
      ) : null}
      {c && pauseOpen ? <PauseSheet clientId={c.id} profileId={profileId} onClose={() => setPauseOpen(false)} /> : null}
      {c && pkgOpen ? <AdditionalPackageSheet clientId={c.id} profileId={profileId} onClose={() => setPkgOpen(false)} /> : null}
      {c && assignOpen ? <AssignSheet clientId={c.id} assigned={c.trainers} onClose={() => setAssignOpen(false)} /> : null}
      {c && sessSheet ? <SessionSheet clientId={c.id} existing={sessSheet.mode === 'edit' ? sessSheet.s : null} profileId={profileId} onClose={() => setSessSheet(null)} /> : null}
    </Page>
  );
}
