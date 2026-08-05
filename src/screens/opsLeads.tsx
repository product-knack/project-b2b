import React from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator, Modal, ScrollView, Linking, Alert, Keyboard } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C, F, hexA, ORANGE_GRAD } from '../theme';
import { Icon, IconName } from '../icons';
import { Serif, Body, Mono, Card } from '../components/primitives';
import { useKeyboardHeight } from '../lib/useKeyboardHeight';
import { Page, TitleBlock, Badge, HScroll } from './common';
import { useStore } from '../store';
import { OpsSearch } from './ops';
import {
  LEAD_STAGES, LEAD_SOURCES, CANDIDATE_TYPES, SUBSCRIPTION_TYPES, LEAD_CATEGORIES, RESCHEDULE_REASONS, LEAD_ASSIGNEES,
  useLeadsList, useLeadStats, useColdLeads, useDumpLeadsCount, useMyOpsProfile, useLeadOptions, useAddLeadOption, useDeleteLeadOption,
  useCreateLead, useUpdateLead, useScheduleFollowUp, useCompleteFollowUp, useAddLeadRemark, useConvertWithPackage,
  useToggleLeadSpam, useMarkLeadAsApplicant, useOpsFollowUpReminders, canEditLead, canMarkLeadSpam, canRescheduleQHP,
  useToggleLeadPotential, useMarkLeadAttempt, useRestoreLeadFromDump, useAssignLead, useSetLeadPartner, useClearLeadPartner,
  useLeadPartnerSearch, usePartnerNames, useLeadMonthlySerials, assigneeFirstName, profileName,
  type Lead, type LeadFilters, type RemarkEntry, type FollowUpEntry, type FollowUpReminder, type CallAttemptEntry,
} from '../lib/opsLeadQueries';

/* ============ OPS — Leads pipeline (web /ops/leads) ============ */

// Web parity (2026-08): Reschedule QHP red, QHP Completed / Trial teal,
// Decision Awaiting purple. Old "Potential" / "Trail" rows (legacy data) fall
// back to the slate default.
const STAGE_COLORS: Record<string, string> = {
  New: C.blue, 'Not Picked': '#9AA0A6', 'Follow Up': C.gold,
  'QHP Booked': C.orange, 'Reschedule QHP': '#EF4444', 'QHP Completed': '#4FD1C5',
  'Decision Awaiting': C.purple, Trial: '#4FD1C5', 'Raise invoice': '#E879F9',
  Converted: C.green, Refunded: '#94A3B8', Lost: C.red,
};
const stageColor = (s: string) => STAGE_COLORS[s] ?? '#94A3B8';
const AMBER = '#F0B03C';
const PINK = '#EC6A9C';
// Android new-arch crash guard: dismiss the keyboard, then close the sheet a
// beat later. Every sheet/dialog that hosts a TextInput must route ALL of its
// close paths through this.
const kbClose = (fn: () => void) => () => { Keyboard.dismiss(); setTimeout(fn, 80); };
/* QHP payment chip (web QHPPaymentChip, condensed). */
function QhpPayChip({ details }: { details: any }) {
  if (!details?.type) return null;
  if (details.type === 'complimentary') return <Badge text="Complimentary QHP" color={C.muted2} />;
  const money = `₹${Number(details.amount ?? 0).toLocaleString('en-IN')}`;
  return details.collected ? <Badge text={`Paid ${money} · collected`} color={C.green} /> : <Badge text={`Paid ${money} · to collect`} color={C.red} />;
}
/* Status-specific Alert copy for couple-link sync results (web toasts). */
const partnerSyncAlert = (status: string | null) => {
  if (status === 'linked') Alert.alert('Marked as couple', 'Training partner linked on both clients');
  else if (status === 'already_linked') Alert.alert('Marked as couple', 'One client already has a different training partner - resolve from the client page.');
  else if (status === 'pending_partner') Alert.alert('Marked as couple', "Link will apply once the partner's client card is created");
};
const fmtDay = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const fmtAt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }) : '—');
const todayYmd = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const plusDaysYmd = (n: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + n * 864e5));
const toNoonIso = (ymd: string) => new Date(`${ymd}T12:00:00`).toISOString();

function Loading() {
  return <View style={{ paddingVertical: 36, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <View style={{ gap: 5 }}><Mono style={{ fontSize: 8.5, letterSpacing: 0.8, color: C.mono2 }}>{label}</Mono>{children}</View>;
}
const inputSt = { borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 11, paddingVertical: 10, color: '#fff', fontFamily: F.body, fontSize: 13 } as const;
function Inp(props: any) {
  return <TextInput placeholderTextColor={C.muted3} autoCorrect={false} {...props} style={[inputSt, props.style]} />;
}
function ChipRow<T extends string>({ options, value, onChange, color = C.orange }: { options: readonly T[] | T[]; value: T | null; onChange: (v: T) => void; color?: string }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {options.map((o) => {
        const active = value === o;
        return (
          <Pressable key={o} onPress={() => onChange(o)} style={{ paddingVertical: 7, paddingHorizontal: 11, borderRadius: 999, backgroundColor: active ? hexA(color, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(color, 0.5) : 'rgba(255,255,255,0.09)' }}>
            <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 11, color: active ? color : C.muted }}>{o}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
function SheetShell({ title, sub, onClose, children, badge }: { title: string; sub?: string | null; onClose: () => void; children: React.ReactNode; badge?: React.ReactNode }) {
  const kb = useKeyboardHeight();
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.62)', justifyContent: 'flex-end' }}>
        <View style={{ maxHeight: '92%', backgroundColor: '#0E0A09', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.14)', paddingHorizontal: 18, paddingTop: 14, paddingBottom: kb > 0 ? kb + 14 : 22 }}>
          <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 12 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 10 }}>
            <View style={{ flex: 1 }}>
              <Serif numberOfLines={1} style={{ fontSize: 18 }}>{title}</Serif>
              {sub ? <Body numberOfLines={1} style={{ fontSize: 10.5, color: C.muted2, marginTop: 1 }}>{sub}</Body> : null}
            </View>
            {badge}
            <Pressable onPress={onClose} hitSlop={8} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="close" size={13} color="#B8B2AC" strokeWidth={2.3} />
            </Pressable>
          </View>
          {children}
        </View>
      </View>
    </Modal>
  );
}
function PrimaryBtn({ label, onPress, disabled, color = C.orange }: { label: string; onPress: () => void; disabled?: boolean; color?: string }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={{ alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: hexA(color, disabled ? 0.06 : 0.16), borderWidth: 1, borderColor: hexA(color, disabled ? 0.2 : 0.5) }}>
      <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: disabled ? C.muted3 : color }}>{label}</Text>
    </Pressable>
  );
}

/* ---------------- Stage-change flow sheet (web dialogs, one per flow) ---------------- */
type FlowKind = 'followup' | 'lost' | 'converted_date' | 'converted_package' | 'qhp_booking' | 'qhp_reschedule' | 'raise_invoice' | 'applicant';
function StageFlowSheet({ kind, lead, profile, onClose }: { kind: FlowKind; lead: Lead; profile: any; onClose: () => void }) {
  const update = useUpdateLead();
  const schedule = useScheduleFollowUp();
  const addRemark = useAddLeadRemark();
  const convertPkg = useConvertWithPackage();
  const markApplicant = useMarkLeadAsApplicant();
  const [err, setErr] = React.useState<string | null>(null);
  const busy = update.isPending || schedule.isPending || addRemark.isPending || convertPkg.isPending || markApplicant.isPending;
  const fail = (e: any) => setErr(e?.message ?? 'Failed.');
  const close = kbClose(onClose);
  const ok = () => close();

  // follow-up
  const [fuDate, setFuDate] = React.useState(plusDaysYmd(1));
  const [fuTime, setFuTime] = React.useState('10:00');
  const [fuNote, setFuNote] = React.useState(lead.next_follow_up_note ?? '');
  // lost / remark
  const [remark, setRemark] = React.useState('');
  // converted
  const [convDate, setConvDate] = React.useState(todayYmd());
  const [pkgSessions, setPkgSessions] = React.useState('');
  const [pkgAmount, setPkgAmount] = React.useState('');
  const [pkgPerCycle, setPkgPerCycle] = React.useState('');
  const [pkgDuration, setPkgDuration] = React.useState('');
  // qhp booking / reschedule (reschedule pre-fills the existing slot — web parity)
  const [qDate, setQDate] = React.useState(lead.qhp_pref_date ?? todayYmd());
  const [qTime, setQTime] = React.useState(String(lead.qhp_pref_time_from ?? '').slice(0, 5) || '09:00');
  const [qLocation, setQLocation] = React.useState(lead.qhp_pref_location ?? '');
  const [qNotes, setQNotes] = React.useState(lead.qhp_pref_notes ?? '');
  // qhp payment (booking only, web QHPBookingDialog)
  const [payType, setPayType] = React.useState<'Complimentary' | 'Paid' | null>(null);
  const [payAmount, setPayAmount] = React.useState('');
  const [collectBy, setCollectBy] = React.useState<'Ops' | 'Assessor' | null>(null);
  const [payMode, setPayMode] = React.useState<string>('Cash');
  const [payNote, setPayNote] = React.useState('');
  // reschedule reason
  const [reschedReason, setReschedReason] = React.useState<string | null>(null);
  const [reschedNote, setReschedNote] = React.useState('');
  // invoice
  const [invAmount, setInvAmount] = React.useState('');
  const [invDuration, setInvDuration] = React.useState('');
  const [invSessions, setInvSessions] = React.useState('');
  const [invSub, setInvSub] = React.useState<string | null>(null);
  const [invNotes, setInvNotes] = React.useState('');
  // applicant
  const [candidateType, setCandidateType] = React.useState<string | null>(null);

  const titles: Record<FlowKind, string> = {
    followup: 'Schedule follow-up', lost: 'Mark as Lost', converted_date: 'Mark Converted', converted_package: 'Converted — package details',
    qhp_booking: 'Book QHP', qhp_reschedule: 'Reschedule QHP', raise_invoice: 'Raise invoice', applicant: 'Mark as applicant',
  };

  const paid = payType === 'Paid';
  const opsCollects = paid && collectBy === 'Ops';
  const slotValid = /^\d{4}-\d{2}-\d{2}$/.test(qDate) && /^\d{2}:\d{2}$/.test(qTime) && qLocation.trim().length >= 2;
  const payValid = payType === 'Complimentary' || (paid && Number(payAmount) > 0 && !!collectBy);
  const reasonValid = !!reschedReason && (reschedReason !== 'Other' || reschedNote.trim().length >= 5);

  const saveBooking = () => {
    setErr(null);
    const nowIso = new Date().toISOString();
    const byName = profileName(profile);
    update.mutate({
      id: lead.id,
      patch: {
        stage: 'QHP Booked',
        qhp_pref_date: qDate, qhp_pref_time_from: `${qTime}:00`, qhp_pref_time_to: `${qTime}:00`,
        qhp_pref_location: qLocation.trim(), qhp_pref_notes: qNotes.trim() || null,
        qhp_details: {
          type: paid ? 'paid' : 'complimentary',
          amount: paid ? Number(payAmount) : null,
          collect_by: paid ? (collectBy === 'Ops' ? 'ops' : 'assessor') : null,
          collected: opsCollects,
          mode: opsCollects ? payMode : null,
          note: paid && payNote.trim() ? payNote.trim() : null,
          collected_by: opsCollects ? profile?.id ?? null : null,
          collected_by_name: opsCollects ? byName : null,
          collected_at: opsCollects ? nowIso : null,
          booked_by: profile?.id ?? null,
          booked_at: nowIso,
          history: opsCollects
            ? [{ action: 'collected', by: profile?.id ?? null, by_name: byName, at: nowIso, mode: payMode, note: payNote.trim() || null, source: 'ops_booking' }]
            : [],
        },
        qhp_booked_by: profile?.id ?? null,
        qhp_booked_by_role: profile?.role === 'marketing' ? 'marketing' : 'ops',
      },
    }, { onSuccess: ok, onError: fail });
  };

  const saveReschedule = () => {
    setErr(null);
    const note = reschedNote.trim();
    const existing = (lead.qhp_details ?? {}) as any;
    const entry = {
      previous_date: lead.qhp_pref_date ?? null,
      previous_time: lead.qhp_pref_time_from ?? null,
      previous_location: lead.qhp_pref_location ?? null,
      new_date: qDate, new_time: `${qTime}:00`, new_location: qLocation.trim(),
      reason: reschedReason === 'Other' ? note : note ? `${reschedReason} - ${note}` : reschedReason,
      by: profile?.id ?? null, by_name: profileName(profile), at: new Date().toISOString(),
    };
    update.mutate({
      id: lead.id,
      patch: {
        stage: 'Reschedule QHP',
        qhp_pref_date: qDate, qhp_pref_time_from: `${qTime}:00`, qhp_pref_time_to: `${qTime}:00`,
        qhp_pref_location: qLocation.trim(), qhp_pref_notes: qNotes.trim() || null,
        qhp_details: { ...existing, reschedules: [...(Array.isArray(existing.reschedules) ? existing.reschedules : []), entry] },
      },
    }, { onSuccess: ok, onError: fail });
  };

  return (
    <SheetShell title={titles[kind]} sub={lead.name} onClose={close}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 11, paddingBottom: 10 }}>
        {kind === 'followup' ? (
          <>
            <Field label="DATE (YYYY-MM-DD · IST)"><Inp value={fuDate} onChangeText={setFuDate} placeholder="2026-07-17" /></Field>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {(([['Today', 0], ['Tomorrow', 1], ['+3 days', 3]]) as [string, number][]).map(([lab, n]) => (
                <Pressable key={lab} onPress={() => setFuDate(plusDaysYmd(n))} style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
                  <Text style={{ fontFamily: F.bodySemi, fontSize: 10.5, color: C.muted }}>{lab}</Text>
                </Pressable>
              ))}
            </View>
            <Field label="TIME (HH:MM · IST)"><Inp value={fuTime} onChangeText={setFuTime} placeholder="10:00" /></Field>
            <Field label="NOTE (OPTIONAL)"><Inp value={fuNote} onChangeText={setFuNote} placeholder="What to discuss…" multiline style={{ minHeight: 60, textAlignVertical: 'top' }} /></Field>
            {err ? <Body style={{ fontSize: 11, color: C.red }}>{err}</Body> : null}
            <PrimaryBtn label={busy ? 'Scheduling…' : 'Schedule & set stage to Follow Up'} disabled={busy || !/^\d{4}-\d{2}-\d{2}$/.test(fuDate) || !/^\d{2}:\d{2}$/.test(fuTime)}
              onPress={() => { setErr(null); schedule.mutate({ lead, dateStr: fuDate, timeStr: fuTime, note: fuNote.trim(), profile }, { onSuccess: ok, onError: fail }); }} />
          </>
        ) : kind === 'lost' ? (
          <>
            <Field label="REMARK (REQUIRED · MIN 3 CHARS)"><Inp value={remark} onChangeText={(v: string) => setRemark(v.slice(0, 600))} placeholder="Why was this lead lost?" multiline style={{ minHeight: 70, textAlignVertical: 'top' }} /></Field>
            {err ? <Body style={{ fontSize: 11, color: C.red }}>{err}</Body> : null}
            <PrimaryBtn label={busy ? 'Saving…' : 'Mark Lost'} color={C.red} disabled={busy || remark.trim().length < 3}
              onPress={() => { setErr(null); addRemark.mutate({ lead, text: remark, profile, extraPatch: { stage: 'Lost' } }, { onSuccess: ok, onError: fail }); }} />
          </>
        ) : kind === 'converted_date' ? (
          <>
            <Field label="CONVERTED ON (YYYY-MM-DD)"><Inp value={convDate} onChangeText={setConvDate} /></Field>
            {err ? <Body style={{ fontSize: 11, color: C.red }}>{err}</Body> : null}
            <PrimaryBtn label={busy ? 'Saving…' : 'Mark Converted'} color={C.green} disabled={busy || !/^\d{4}-\d{2}-\d{2}$/.test(convDate)}
              onPress={() => { setErr(null); update.mutate({ id: lead.id, patch: { stage: 'Converted', converted_at: toNoonIso(convDate), converted_by: lead.converted_by ?? profile?.id ?? null } }, { onSuccess: ok, onError: fail }); }} />
          </>
        ) : kind === 'converted_package' ? (
          <>
            <Body style={{ fontSize: 11, color: C.muted2 }}>This lead is linked to a client — the package writes to the client record first (web parity).</Body>
            <Field label="SESSIONS IN PACKAGE"><Inp value={pkgSessions} onChangeText={setPkgSessions} keyboardType="numeric" placeholder="12" /></Field>
            <Field label="PACKAGE AMOUNT (₹)"><Inp value={pkgAmount} onChangeText={setPkgAmount} keyboardType="numeric" placeholder="25000" /></Field>
            <Field label="SESSIONS PER CYCLE"><Inp value={pkgPerCycle} onChangeText={setPkgPerCycle} keyboardType="numeric" placeholder="12" /></Field>
            <Field label="PACKAGE DURATION"><Inp value={pkgDuration} onChangeText={setPkgDuration} placeholder="1 month" /></Field>
            <Field label="CYCLE"><Body style={{ fontSize: 12, color: C.ink2 }}>Monthly (locked)</Body></Field>
            <Field label="CONVERTED ON (YYYY-MM-DD)"><Inp value={convDate} onChangeText={setConvDate} /></Field>
            {err ? <Body style={{ fontSize: 11, color: C.red }}>{err}</Body> : null}
            <PrimaryBtn label={busy ? 'Saving…' : 'Save package & mark Converted'} color={C.green}
              disabled={busy || !(Number(pkgSessions) > 0) || !(Number(pkgAmount) > 0) || !(Number(pkgPerCycle) > 0) || pkgDuration.trim().length < 2 || !/^\d{4}-\d{2}-\d{2}$/.test(convDate)}
              onPress={() => { setErr(null); convertPkg.mutate({ lead, clientPatch: { session_package: String(Number(pkgSessions)), package_amount: Number(pkgAmount), sessions_per_cycle: Number(pkgPerCycle), package_duration: pkgDuration.trim(), cycle_type: 'monthly' }, convertedAt: toNoonIso(convDate), profile }, { onSuccess: (syncStatus) => { ok(); if (syncStatus) setTimeout(() => partnerSyncAlert(syncStatus), 350); }, onError: fail }); }} />
          </>
        ) : kind === 'qhp_booking' ? (
          <>
            <Field label="QHP DATE (YYYY-MM-DD)"><Inp value={qDate} onChangeText={setQDate} /></Field>
            <Field label="TIME (HH:MM · IST)"><Inp value={qTime} onChangeText={setQTime} placeholder="09:00" /></Field>
            <Field label="LOCATION"><Inp value={qLocation} onChangeText={setQLocation} placeholder="Studio / address" /></Field>
            {/* QHP payment (web QHPBookingDialog): required type; Paid needs amount + collector. */}
            <Field label="QHP TYPE (REQUIRED)"><ChipRow options={['Complimentary', 'Paid'] as const} value={payType} onChange={(v) => setPayType(v)} color={C.gold} /></Field>
            {paid ? (
              <>
                <Field label="AMOUNT (₹)"><Inp value={payAmount} onChangeText={setPayAmount} keyboardType="numeric" placeholder="2500" /></Field>
                <Field label="PAYMENT COLLECTION">
                  <ChipRow options={['Ops', 'Assessor'] as const} value={collectBy} onChange={(v) => setCollectBy(v)} color={C.green} />
                  <Body style={{ fontSize: 10, color: C.muted3 }}>{collectBy === 'Ops' ? 'Marks the payment as already collected by you.' : collectBy === 'Assessor' ? 'Assessor marks it collected on their QHP card.' : 'Who collects the payment?'}</Body>
                </Field>
                {opsCollects ? (
                  <Field label="MODE"><ChipRow options={['Cash', 'UPI', 'Card', 'Bank transfer', 'Other'] as const} value={payMode as any} onChange={(v) => setPayMode(v)} color={C.green} /></Field>
                ) : null}
                <Field label="PAYMENT NOTE (OPTIONAL)"><Inp value={payNote} onChangeText={(v: string) => setPayNote(v.slice(0, 200))} placeholder="UPI ref, receipt no, remark…" /></Field>
              </>
            ) : null}
            <Field label="NOTES (OPTIONAL)"><Inp value={qNotes} onChangeText={(v: string) => setQNotes(v.slice(0, 500))} multiline style={{ minHeight: 56, textAlignVertical: 'top' }} /></Field>
            {err ? <Body style={{ fontSize: 11, color: C.red }}>{err}</Body> : null}
            <PrimaryBtn label={busy ? 'Booking…' : 'Save & Mark QHP Booked'} disabled={busy || !slotValid || !payValid} onPress={saveBooking} />
          </>
        ) : kind === 'qhp_reschedule' ? (
          <>
            <Body style={{ fontSize: 11, color: C.muted2 }}>Pick the new slot. The QHP Manager will re-assign an assessor.</Body>
            <Field label="NEW QHP DATE (YYYY-MM-DD)"><Inp value={qDate} onChangeText={setQDate} /></Field>
            <Field label="TIME (HH:MM · IST)"><Inp value={qTime} onChangeText={setQTime} placeholder="09:00" /></Field>
            <Field label="LOCATION"><Inp value={qLocation} onChangeText={setQLocation} placeholder="Studio / address" /></Field>
            <Field label="REASON FOR RESCHEDULE (REQUIRED)"><ChipRow options={RESCHEDULE_REASONS} value={reschedReason as any} onChange={(v) => setReschedReason(v)} color={'#EF4444'} /></Field>
            <Field label={reschedReason === 'Other' ? 'DESCRIBE THE REASON (REQUIRED · MIN 5 CHARS)' : 'NOTE (OPTIONAL)'}>
              <Inp value={reschedNote} onChangeText={(v: string) => setReschedNote(v.slice(0, 200))} placeholder={reschedReason === 'Other' ? 'Describe the reason' : 'Add a note'} />
            </Field>
            <Field label="NOTES FOR ASSESSOR (OPTIONAL)"><Inp value={qNotes} onChangeText={(v: string) => setQNotes(v.slice(0, 500))} multiline style={{ minHeight: 56, textAlignVertical: 'top' }} /></Field>
            {err ? <Body style={{ fontSize: 11, color: C.red }}>{err}</Body> : null}
            <PrimaryBtn label={busy ? 'Saving…' : 'Save & Mark Reschedule QHP'} color={'#EF4444'} disabled={busy || !slotValid || !reasonValid} onPress={saveReschedule} />
          </>
        ) : kind === 'raise_invoice' ? (
          <>
            <Field label="AMOUNT (₹)"><Inp value={invAmount} onChangeText={setInvAmount} keyboardType="numeric" placeholder="25000" /></Field>
            <Field label="DURATION"><Inp value={invDuration} onChangeText={setInvDuration} placeholder="1 month" /></Field>
            <Field label="SESSIONS IN PACKAGE"><Inp value={invSessions} onChangeText={setInvSessions} keyboardType="numeric" placeholder="12" /></Field>
            <Field label="SUBSCRIPTION TYPE"><ChipRow options={SUBSCRIPTION_TYPES} value={invSub as any} onChange={(v) => setInvSub(v)} /></Field>
            <Field label="NOTES (OPTIONAL)"><Inp value={invNotes} onChangeText={setInvNotes} multiline style={{ minHeight: 52, textAlignVertical: 'top' }} /></Field>
            {err ? <Body style={{ fontSize: 11, color: C.red }}>{err}</Body> : null}
            <PrimaryBtn label={busy ? 'Saving…' : 'Raise invoice'} color={'#E879F9'}
              disabled={busy || !(Number(invAmount) > 0) || !invDuration.trim() || !(Number(invSessions) > 0) || !invSub}
              onPress={() => {
                setErr(null);
                update.mutate({ id: lead.id, patch: { stage: 'Raise invoice', invoice_details: { amount: Number(invAmount), duration: invDuration.trim(), sessions_in_package: Number(invSessions), cycle: 'Monthly', subscription_type: invSub, raised_at: new Date().toISOString(), notes: invNotes.trim() || undefined, generation_admin_id: null, generation_admin_name: null, generation_member_id: null, generation_member_name: null, generation_members: [] } } }, { onSuccess: ok, onError: fail });
              }} />
          </>
        ) : (
          <>
            <Field label="CANDIDATE TYPE"><ChipRow options={CANDIDATE_TYPES} value={candidateType as any} onChange={(v) => setCandidateType(v)} /></Field>
            {err ? <Body style={{ fontSize: 11, color: C.red }}>{err}</Body> : null}
            <PrimaryBtn label={busy ? 'Saving…' : 'Move to Applicants'} disabled={busy || !candidateType}
              onPress={() => { setErr(null); markApplicant.mutate({ id: lead.id, candidateType: candidateType! }, { onSuccess: ok, onError: fail }); }} />
          </>
        )}
      </ScrollView>
    </SheetShell>
  );
}

/* ---------------- Lead create/edit form ---------------- */
function LeadFormSheet({ lead, profile, onClose }: { lead: Lead | null; profile: any; onClose: () => void }) {
  const create = useCreateLead();
  const update = useUpdateLead();
  const influencers = useLeadOptions('influencer');
  const creatives = useLeadOptions('ads_creative');
  const [name, setName] = React.useState(lead?.name ?? '');
  const [contact, setContact] = React.useState(lead?.contact_no ?? '');
  const [source, setSource] = React.useState<string>(lead?.source ?? 'Direct');
  const [influencer, setInfluencer] = React.useState<string>(lead?.influencer ?? 'NA');
  const [creative, setCreative] = React.useState<string>(lead?.ads_creative ?? 'NA');
  const [referral, setReferral] = React.useState<string>(lead?.referral_name ?? '');
  const [leadDate, setLeadDate] = React.useState<string>(lead?.lead_date ?? todayYmd());
  const [desc, setDesc] = React.useState<string>(lead?.description ?? '');
  const [isInfluencerType, setIsInfluencerType] = React.useState(lead?.lead_type === 'influencer');
  const [err, setErr] = React.useState<string | null>(null);
  const busy = create.isPending || update.isPending;
  const close = kbClose(onClose);

  const valid = name.trim().length >= 2 && contact.trim().length >= 1 && /^\d{4}-\d{2}-\d{2}$/.test(leadDate)
    && (source !== 'Referral' || referral.trim().length >= 2);

  const submit = () => {
    setErr(null);
    if (lead) {
      update.mutate({
        id: lead.id,
        patch: {
          name: name.trim(), contact_no: contact.trim(), source, lead_date: leadDate, description: desc.trim() || null,
          influencer: source === 'Influencer' ? influencer || 'NA' : 'NA',
          ads_creative: source === 'Instagram' ? creative || 'NA' : 'NA',
          referral_name: source === 'Referral' ? referral.trim() || null : null,
          lead_type: isInfluencerType ? 'influencer' : null,
        },
      }, { onSuccess: close, onError: (e: any) => setErr(e?.message ?? 'Failed') });
    } else {
      create.mutate({ name, contact_no: contact.trim(), source, lead_date: leadDate, stage: 'New', description: desc.trim() || null, influencer, ads_creative: creative, referral_name: referral, lead_type: isInfluencerType ? 'influencer' : null, profile },
        { onSuccess: close, onError: (e: any) => setErr(e?.message ?? 'Failed') });
    }
  };

  return (
    <SheetShell title={lead ? 'Edit lead' : 'Add lead'} sub={lead ? lead.name : null} onClose={close}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 11, paddingBottom: 12 }}>
        <Field label="NAME"><Inp value={name} onChangeText={(v: string) => setName(v.slice(0, 100))} placeholder="Lead name" /></Field>
        <Field label="CONTACT NUMBER"><Inp value={contact} onChangeText={setContact} keyboardType="phone-pad" placeholder="10-digit phone" /></Field>
        <Field label="SOURCE"><ChipRow options={LEAD_SOURCES} value={source as any} onChange={(v) => setSource(v)} /></Field>
        {source === 'Influencer' ? (
          <Field label="INFLUENCER"><ChipRow options={['NA', ...(influencers.data ?? []).map((o) => o.name)]} value={influencer} onChange={setInfluencer} color={C.purple} /></Field>
        ) : null}
        {source === 'Instagram' ? (
          <Field label="ADS CREATIVE"><ChipRow options={['NA', ...(creatives.data ?? []).map((o) => o.name)]} value={creative} onChange={setCreative} color={C.purple} /></Field>
        ) : null}
        {source === 'Referral' ? (
          <Field label="REFERRAL NAME"><Inp value={referral} onChangeText={setReferral} placeholder="Who referred them?" /></Field>
        ) : null}
        <Field label="LEAD DATE (YYYY-MM-DD)"><Inp value={leadDate} onChangeText={setLeadDate} /></Field>
        <Field label="DESCRIPTION (OPTIONAL)"><Inp value={desc} onChangeText={(v: string) => setDesc(v.slice(0, 1000))} multiline style={{ minHeight: 64, textAlignVertical: 'top' }} placeholder="Context, goals, notes…" /></Field>
        {/* Influencer type (web LeadFormPanel toggle) — written via the normal payload. */}
        <Field label="LEAD TYPE">
          <Pressable onPress={() => setIsInfluencerType((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: isInfluencerType ? hexA(PINK, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: isInfluencerType ? hexA(PINK, 0.5) : 'rgba(255,255,255,0.09)' }}>
            <View style={{ width: 6, height: 6, borderRadius: 99, backgroundColor: isInfluencerType ? PINK : C.muted3 }} />
            <Text style={{ fontFamily: isInfluencerType ? F.bodyBold : F.bodySemi, fontSize: 11, color: isInfluencerType ? PINK : C.muted }}>Mark as Influencer</Text>
          </Pressable>
          <Body style={{ fontSize: 10, color: C.muted3 }}>Shows a pink Influencer tag on the lead row and excludes it from conversion metrics.</Body>
        </Field>
        {err ? <Body style={{ fontSize: 11, color: C.red }}>{err}</Body> : null}
        <PrimaryBtn label={busy ? 'Saving…' : lead ? 'Save changes' : 'Create lead'} disabled={busy || !valid} onPress={submit} />
      </ScrollView>
    </SheetShell>
  );
}

/* ---------------- Assigned-to picker sheet (web AssignedToPicker, whitelist) ---------------- */
function AssignSheet({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const assign = useAssignLead();
  const [err, setErr] = React.useState<string | null>(null);
  const close = kbClose(onClose);
  const pick = (assignee: string | null) => {
    setErr(null);
    assign.mutate({ leadId: lead.id, assignee }, { onSuccess: close, onError: (e: any) => setErr(e?.message ?? 'Failed.') });
  };
  return (
    <SheetShell title="Assign lead" sub={lead.name} onClose={close}>
      <View style={{ gap: 8, paddingBottom: 8 }}>
        {LEAD_ASSIGNEES.map((a) => {
          const active = lead.assigned_to === a.id;
          return (
            <Pressable key={a.id} disabled={assign.isPending} onPress={() => pick(a.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 12, paddingHorizontal: 13, borderRadius: 12, backgroundColor: active ? hexA(C.blue, 0.14) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.blue, 0.5) : 'rgba(255,255,255,0.09)' }}>
              <Icon name="user" size={14} color={active ? C.blue : C.muted} strokeWidth={2} />
              <Text style={{ flex: 1, fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 12.5, color: active ? C.blue : C.ink2 }}>{a.name}</Text>
              {active ? <Icon name="checks" size={13} color={C.blue} strokeWidth={2.3} /> : null}
            </Pressable>
          );
        })}
        {lead.assigned_to ? (
          <Pressable disabled={assign.isPending} onPress={() => pick(null)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 11, borderRadius: 12, backgroundColor: hexA(C.red, 0.08), borderWidth: 1, borderColor: hexA(C.red, 0.3) }}>
            <Icon name="close" size={12} color={C.red} strokeWidth={2.3} />
            <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: C.red }}>Unassign</Text>
          </Pressable>
        ) : null}
        {assign.isPending ? <Loading /> : null}
        {err ? <Body style={{ fontSize: 11, color: C.red }}>{err}</Body> : null}
      </View>
    </SheetShell>
  );
}

/* ---------------- Couple pairing sheet (web LeadCoupleToggle) ---------------- */
function CoupleSheet({ lead, partnerName, onClose }: { lead: Lead; partnerName: string | null; onClose: () => void }) {
  const setPartner = useSetLeadPartner();
  const clearPartner = useClearLeadPartner();
  const [term, setTerm] = React.useState('');
  const searchQ = useLeadPartnerSearch(term, lead.id);
  const [err, setErr] = React.useState<string | null>(null);
  const busy = setPartner.isPending || clearPartner.isPending;
  const close = kbClose(onClose);

  const link = (p: { id: string; name: string; partner_lead_id: string | null }) => {
    if (p.partner_lead_id && p.partner_lead_id !== lead.id) {
      setErr(`${p.name} is already marked as a couple with another lead.`);
      return;
    }
    setErr(null);
    setPartner.mutate({ leadId: lead.id, partnerLeadId: p.id }, {
      onSuccess: (status) => { close(); setTimeout(() => partnerSyncAlert(status), 350); },
      onError: (e: any) => setErr(e?.message ?? 'Failed.'),
    });
  };
  const unlink = () => {
    Alert.alert('Remove couple marking?', 'This removes the couple link between both leads. Client cards already linked as training partners are not changed.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Unlink', style: 'destructive', onPress: () => clearPartner.mutate({ leadId: lead.id }, { onSuccess: close, onError: (e: any) => setErr(e?.message ?? 'Failed.') }) },
    ]);
  };

  return (
    <SheetShell title="Couple" sub={lead.name} onClose={close}>
      <View style={{ gap: 10, paddingBottom: 8 }}>
        {lead.partner_lead_id ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, padding: 12, borderRadius: 12, backgroundColor: hexA(C.blue, 0.08), borderWidth: 1, borderColor: hexA(C.blue, 0.35) }}>
              <Icon name="users" size={15} color={C.blue} strokeWidth={2} />
              <Body style={{ flex: 1, fontSize: 12.5, fontFamily: F.bodySemi, color: C.blue }}>Marked as couple with {partnerName ?? 'partner lead'}</Body>
            </View>
            <PrimaryBtn label={busy ? 'Removing…' : 'Unlink couple'} color={C.red} disabled={busy} onPress={unlink} />
          </>
        ) : (
          <>
            <Field label="SEARCH PARTNER LEAD (NAME OR PHONE)"><Inp value={term} onChangeText={setTerm} placeholder="Search leads…" /></Field>
            {searchQ.isFetching ? <Loading /> : null}
            {(searchQ.data ?? []).map((p) => {
              const taken = !!p.partner_lead_id && p.partner_lead_id !== lead.id;
              return (
                <Pressable key={p.id} disabled={busy || taken} onPress={() => link(p)} style={{ padding: 11, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)', opacity: taken ? 0.5 : 1, gap: 3 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Body numberOfLines={1} style={{ flex: 1, fontSize: 12.5, fontFamily: F.bodySemi, color: '#fff' }}>{p.name}</Body>
                    {p.stage ? <Badge text={p.stage} color={stageColor(p.stage)} /> : null}
                  </View>
                  <Body style={{ fontSize: 10.5, color: C.muted2 }}>{p.contact_no ?? '-'}{taken ? ' · already paired' : ''}</Body>
                </Pressable>
              );
            })}
            {!searchQ.isFetching && term.trim() && (searchQ.data ?? []).length === 0 ? (
              <Body style={{ fontSize: 11, color: C.muted3 }}>No matching leads.</Body>
            ) : null}
          </>
        )}
        {err ? <Body style={{ fontSize: 11, color: C.red }}>{err}</Body> : null}
      </View>
    </SheetShell>
  );
}

/* ---------------- Lead detail sheet ---------------- */
function LeadSheet({ leadId, rows, profile, partnerName, onClose }: { leadId: string; rows: Lead[]; profile: any; partnerName: string | null; onClose: () => void }) {
  const lead = rows.find((l) => l.id === leadId);
  const [flow, setFlow] = React.useState<FlowKind | null>(null);
  const [editOpen, setEditOpen] = React.useState(false);
  const [assignOpen, setAssignOpen] = React.useState(false);
  const [coupleOpen, setCoupleOpen] = React.useState(false);
  const [newRemark, setNewRemark] = React.useState('');
  const addRemark = useAddLeadRemark();
  const update = useUpdateLead();
  const toggleSpam = useToggleLeadSpam();
  const togglePotential = useToggleLeadPotential();
  const completeFu = useCompleteFollowUp();
  const [err, setErr] = React.useState<string | null>(null);
  const close = kbClose(onClose);
  if (!lead) return null;
  const editable = canEditLead(profile, lead);
  const spamAllowed = canMarkLeadSpam(profile);
  const isPotential = !!lead.potential?.marked;
  const remarks: RemarkEntry[] = Array.isArray(lead.remarks) ? [...lead.remarks].reverse() : lead.remark ? [{ text: lead.remark, date: '' }] : [];
  const followUps: FollowUpEntry[] = Array.isArray(lead.follow_ups) ? [...lead.follow_ups].reverse() : [];
  const pendingFu = followUps.find((f) => f.status === 'pending');
  const selCats: string[] = Array.isArray(lead.categories) && lead.categories.length
    ? lead.categories.filter((c: string) => c && c !== 'not_defined')
    : lead.category && lead.category !== 'not_defined' ? [lead.category] : [];
  // Multi-categories (web CategoryPill): jsonb array + legacy `category` kept in
  // sync with the first item.
  const toggleCategory = (val: string) => {
    if (!editable) return;
    const next = val === 'not_defined' ? [] : selCats.includes(val) ? selCats.filter((c) => c !== val) : [...selCats, val];
    update.mutate({ id: lead.id, patch: { categories: next, category: next[0] ?? 'not_defined' } }, { onError: (e: any) => setErr(e?.message) });
  };

  /* Web stage-change interception, ported (2026-08 delta: Potential is no longer
     a stage; Reschedule QHP always opens the reschedule dialog). */
  const changeStage = (stage: string) => {
    setErr(null);
    if (stage === lead.stage) return;
    if (!editable) { setErr("You don't have permission to edit this lead."); return; }
    if (stage === 'Converted') return setFlow(lead.client_id ? 'converted_package' : 'converted_date');
    if (stage === 'QHP Booked') {
      if (lead.qhp_pref_date && lead.qhp_pref_location) {
        update.mutate({ id: lead.id, patch: { stage: 'QHP Booked' } }, { onError: (e: any) => setErr(e?.message) });
        return;
      }
      return setFlow('qhp_booking');
    }
    if (stage === 'Reschedule QHP') return setFlow('qhp_reschedule');
    if (stage === 'Follow Up') return setFlow('followup');
    if (stage === 'Lost') return setFlow('lost');
    if (stage === 'Raise invoice') return setFlow('raise_invoice');
    update.mutate({ id: lead.id, patch: { stage } }, { onError: (e: any) => setErr(e?.message) });
  };

  return (
    <SheetShell title={lead.name} sub={`${lead.source ?? '—'} · lead ${fmtDay(lead.lead_date)}`} onClose={close}
      badge={<Badge text={lead.stage} color={stageColor(lead.stage)} />}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingBottom: 12 }}>
        {/* status chips */}
        {isPotential || lead.is_dump || lead.lead_type === 'influencer' || lead.qhp_details?.type || lead.partner_lead_id ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            {isPotential ? <Badge text="Potential" color={AMBER} /> : null}
            {lead.is_dump ? <Badge text="Dump" color={C.muted2} /> : null}
            {lead.lead_type === 'influencer' ? <Badge text="Influencer" color={PINK} /> : null}
            <QhpPayChip details={lead.qhp_details} />
            {lead.partner_lead_id ? <Badge text={`Couple · ${partnerName ?? '…'}`} color={C.blue} /> : null}
          </View>
        ) : null}

        {/* contact + actions */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          {lead.contact_no ? (
            <Pressable onPress={() => Linking.openURL(`tel:${lead.contact_no}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 7, paddingHorizontal: 11, borderRadius: 10, backgroundColor: hexA(C.blue, 0.1), borderWidth: 1, borderColor: hexA(C.blue, 0.35) }}>
              <Icon name="phone" size={12} color={C.blue} strokeWidth={2.2} />
              <Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: C.blue }}>{lead.contact_no}</Text>
            </Pressable>
          ) : null}
          {editable ? (
            <Pressable onPress={() => setEditOpen(true)} style={{ paddingVertical: 7, paddingHorizontal: 11, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: C.muted }}>Edit details</Text>
            </Pressable>
          ) : null}
          {editable ? (
            <Pressable disabled={togglePotential.isPending} onPress={() => togglePotential.mutate({ lead, profile }, { onError: (e: any) => setErr(e?.message) })} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 7, paddingHorizontal: 11, borderRadius: 10, backgroundColor: hexA(AMBER, isPotential ? 0.16 : 0.06), borderWidth: 1, borderColor: hexA(AMBER, isPotential ? 0.5 : 0.28) }}>
              <Icon path="M12 3l2.5 5.6 6.1.6-4.6 4.1 1.3 6L12 16.2 6.7 19.3 8 13.3 3.4 9.2l6.1-.6z" size={11} color={AMBER} strokeWidth={2} />
              <Text style={{ fontFamily: isPotential ? F.bodyBold : F.bodySemi, fontSize: 11, color: AMBER }}>{togglePotential.isPending ? '…' : isPotential ? 'Unmark Potential' : 'Mark as Potential'}</Text>
            </Pressable>
          ) : null}
          {editable ? (
            <Pressable onPress={() => setAssignOpen(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 7, paddingHorizontal: 11, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}>
              <Icon name="userPlus" size={11} color={C.muted} strokeWidth={2.1} />
              <Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: C.muted }}>{assigneeFirstName(lead.assigned_to) ?? 'Assign'}</Text>
            </Pressable>
          ) : null}
          {editable ? (
            <Pressable onPress={() => setCoupleOpen(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 7, paddingHorizontal: 11, borderRadius: 10, backgroundColor: hexA(C.blue, lead.partner_lead_id ? 0.1 : 0.04), borderWidth: 1, borderColor: hexA(C.blue, lead.partner_lead_id ? 0.4 : 0.2) }}>
              <Icon name="users" size={11} color={lead.partner_lead_id ? C.blue : C.muted} strokeWidth={2.1} />
              <Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: lead.partner_lead_id ? C.blue : C.muted }}>Couple</Text>
            </Pressable>
          ) : null}
          {editable && !lead.applicant_lead ? (
            <Pressable onPress={() => setFlow('applicant')} style={{ paddingVertical: 7, paddingHorizontal: 11, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: C.muted }}>→ Applicant</Text>
            </Pressable>
          ) : null}
          {spamAllowed ? (
            <Pressable onPress={() => toggleSpam.mutate(lead.id, { onError: (e: any) => setErr(e?.message) })} style={{ paddingVertical: 7, paddingHorizontal: 11, borderRadius: 10, backgroundColor: hexA(C.red, 0.08), borderWidth: 1, borderColor: hexA(C.red, 0.3) }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: C.red }}>{lead.is_spam ? 'Unmark spam' : 'Mark spam'}</Text>
            </Pressable>
          ) : null}
        </View>

        {lead.description ? <Body style={{ fontSize: 12, color: C.ink2, lineHeight: 17 }}>{lead.description}</Body> : null}

        {/* pending follow-up */}
        {pendingFu ? (
          <View style={{ padding: 11, borderRadius: 12, backgroundColor: hexA(C.gold, 0.07), borderWidth: 1, borderColor: hexA(C.gold, 0.35), gap: 7 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
              <Icon name="clock" size={13} color={C.gold} strokeWidth={2.2} />
              <Body style={{ flex: 1, fontSize: 11.5, fontFamily: F.bodySemi, color: C.gold }}>Follow-up {fmtAt(pendingFu.scheduled_at)}</Body>
              <Pressable onPress={() => completeFu.mutate({ leadId: lead.id, entryId: pendingFu.id, profile }, { onError: (e: any) => setErr(e?.message) })} style={{ paddingVertical: 5, paddingHorizontal: 10, borderRadius: 9, backgroundColor: hexA(C.green, 0.14), borderWidth: 1, borderColor: hexA(C.green, 0.45) }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 10, color: C.green }}>{completeFu.isPending ? '…' : 'Mark done'}</Text>
              </Pressable>
            </View>
            {pendingFu.note ? <Body style={{ fontSize: 11, color: C.ink2 }}>{pendingFu.note}</Body> : null}
          </View>
        ) : null}

        {/* QHP prefs / invoice summary */}
        {(lead.stage === 'QHP Booked' || lead.stage === 'Reschedule QHP') && lead.qhp_pref_date ? (
          <Body style={{ fontSize: 11, color: C.muted2 }}>QHP {fmtDay(lead.qhp_pref_date)} · {String(lead.qhp_pref_time_from ?? '').slice(0, 5)} · {lead.qhp_pref_location ?? '—'}{Array.isArray(lead.qhp_details?.reschedules) && lead.qhp_details.reschedules.length ? ` · rescheduled ×${lead.qhp_details.reschedules.length}` : ''}</Body>
        ) : null}
        {lead.invoice_details?.amount ? (
          <Body style={{ fontSize: 11, color: C.muted2 }}>Invoice ₹{lead.invoice_details.amount} · {lead.invoice_details.sessions_in_package} sessions · {lead.invoice_details.subscription_type}</Body>
        ) : null}

        {/* stage change — "Reschedule QHP" only offered once a QHP was booked (web parity) */}
        <View style={{ gap: 7 }}>
          <Mono style={{ fontSize: 9, letterSpacing: 0.9, color: C.muted3 }}>MOVE TO STAGE</Mono>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {LEAD_STAGES.filter((s) => s !== 'Reschedule QHP' || canRescheduleQHP(lead)).map((s) => {
              const active = lead.stage === s;
              const col = stageColor(s);
              return (
                <Pressable key={s} onPress={() => changeStage(s)} disabled={active || update.isPending} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 8, paddingHorizontal: 11, borderRadius: 999, backgroundColor: active ? hexA(col, 0.2) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(col, 0.6) : 'rgba(255,255,255,0.09)' }}>
                  <View style={{ width: 6, height: 6, borderRadius: 99, backgroundColor: col }} />
                  <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 10.5, color: active ? col : C.muted }}>{s}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* categories — multi-select, legacy `category` kept in sync (web parity) */}
        <View style={{ gap: 7 }}>
          <Mono style={{ fontSize: 9, letterSpacing: 0.9, color: C.muted3 }}>CATEGORIES</Mono>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {LEAD_CATEGORIES.map((c) => {
              const active = c.value === 'not_defined' ? selCats.length === 0 : selCats.includes(c.value);
              return (
                <Pressable key={c.value} disabled={!editable || update.isPending} onPress={() => toggleCategory(c.value)} style={{ paddingVertical: 7, paddingHorizontal: 11, borderRadius: 999, backgroundColor: active ? hexA(C.purple, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.purple, 0.5) : 'rgba(255,255,255,0.09)' }}>
                  <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 10.5, color: active ? C.purple : C.muted }}>{c.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {err ? <Body style={{ fontSize: 11, color: C.red }}>{err}</Body> : null}

        {/* remarks */}
        <View style={{ gap: 7 }}>
          <Mono style={{ fontSize: 9, letterSpacing: 0.9, color: C.muted3 }}>REMARKS · {remarks.length}</Mono>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
            <TextInput value={newRemark} onChangeText={(v) => setNewRemark(v.slice(0, 600))} placeholder="Add a remark…" placeholderTextColor={C.muted3} multiline style={[inputSt, { flex: 1, minHeight: 42, maxHeight: 90 }]} />
            <Pressable onPress={() => addRemark.mutate({ lead, text: newRemark, profile }, { onSuccess: () => setNewRemark(''), onError: (e: any) => setErr(e?.message) })} disabled={addRemark.isPending || newRemark.trim().length < 3} style={{ paddingVertical: 11, paddingHorizontal: 13, borderRadius: 11, backgroundColor: hexA(C.orange, newRemark.trim().length < 3 ? 0.06 : 0.16), borderWidth: 1, borderColor: hexA(C.orange, newRemark.trim().length < 3 ? 0.2 : 0.5) }}>
              <Icon name="send" size={14} color={newRemark.trim().length < 3 ? C.muted3 : C.orange} strokeWidth={2.2} />
            </Pressable>
          </View>
          {remarks.slice(0, 6).map((r, i) => (
            <View key={i} style={{ padding: 9, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.22)', gap: 2 }}>
              <Body style={{ fontSize: 11.5, color: C.ink2, lineHeight: 16 }}>{r.text}</Body>
              <Mono style={{ fontSize: 7.5, letterSpacing: 0.4, color: C.muted3 }}>{(r.author_name ?? '—').toUpperCase()}{r.date ? ` · ${fmtAt(r.date).toUpperCase()}` : ''}</Mono>
            </View>
          ))}
        </View>

        {/* follow-up history */}
        {followUps.length ? (
          <View style={{ gap: 7 }}>
            <Mono style={{ fontSize: 9, letterSpacing: 0.9, color: C.muted3 }}>FOLLOW-UP HISTORY</Mono>
            {followUps.slice(0, 5).map((f) => (
              <View key={f.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 9, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.22)' }}>
                <Badge text={f.status} color={f.status === 'pending' ? C.gold : f.status === 'done' ? C.green : C.muted2} />
                <Body style={{ flex: 1, fontSize: 10.5, color: C.muted2 }}>{fmtAt(f.scheduled_at)}{f.note ? ` — ${f.note}` : ''}</Body>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
      {flow ? <StageFlowSheet kind={flow} lead={lead} profile={profile} onClose={() => setFlow(null)} /> : null}
      {editOpen ? <LeadFormSheet lead={lead} profile={profile} onClose={() => setEditOpen(false)} /> : null}
      {assignOpen ? <AssignSheet lead={lead} onClose={() => setAssignOpen(false)} /> : null}
      {coupleOpen ? <CoupleSheet lead={lead} partnerName={partnerName} onClose={() => setCoupleOpen(false)} /> : null}
    </SheetShell>
  );
}

/* ---------------- Follow-up reminder panel (web OpsFollowUpNotificationBanner) ---------------- */
/* Web parity notes: stage change here is a DIRECT update (bypasses the table's interception
   dialogs); "Add remark" text is only written when Mark as Done fires (as manualRemark);
   panel hides entirely when there are no reminders; cards cap at 8 with a "+N more" footer. */
const relSpan = (iso: string) => {
  const diffMs = new Date(iso).getTime() - Date.now();
  const mins = Math.max(1, Math.round(Math.abs(diffMs) / 60000));
  const span = mins < 60 ? `${mins} min` : mins < 48 * 60 ? `about ${Math.round(mins / 60)} hour${Math.round(mins / 60) === 1 ? '' : 's'}` : `${Math.round(mins / 1440)} days`;
  return diffMs < 0 ? `Overdue ${span} ago` : `Due in ${span}`;
};

function SmallBtn({ label, icon, color, solid, disabled, onPress }: { label: string; icon: IconName; color: string; solid?: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 8, paddingHorizontal: 9, borderRadius: 10, backgroundColor: solid ? hexA(color, disabled ? 0.06 : 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: solid ? hexA(color, disabled ? 0.2 : 0.5) : 'rgba(255,255,255,0.1)', opacity: disabled && !solid ? 0.5 : 1 }}>
      <Icon name={icon} size={12} color={solid ? (disabled ? C.muted3 : color) : C.muted} strokeWidth={2.2} />
      <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: solid ? F.bodyBold : F.bodySemi, fontSize: 10.5, color: solid ? (disabled ? C.muted3 : color) : C.muted }}>{label}</Text>
    </Pressable>
  );
}

function ReminderCard({ r, profile }: { r: FollowUpReminder; profile: any }) {
  const update = useUpdateLead();
  const complete = useCompleteFollowUp();
  const markApplicant = useMarkLeadAsApplicant();
  const [stageOpen, setStageOpen] = React.useState(false);
  const [remarkOpen, setRemarkOpen] = React.useState(false);
  const [remark, setRemark] = React.useState('');
  const [applicantOpen, setApplicantOpen] = React.useState(false);
  const [candidateType, setCandidateType] = React.useState<string>('Trainer');
  const [err, setErr] = React.useState<string | null>(null);
  // Overdue derived at render time (not the fetch-time flag) so the color can't contradict relSpan.
  const isOverdue = new Date(r.next_follow_up_at).getTime() < Date.now();
  const col = isOverdue ? C.red : C.gold;
  const stCol = stageColor(r.stage);
  const pending = [...(r.follow_ups ?? [])].reverse().find((e) => e.status === 'pending');
  const busy = update.isPending || complete.isPending || markApplicant.isPending;
  const fail = (e: any) => setErr(e?.message ?? 'Failed.');

  return (
    <View style={{ borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: hexA(col, 0.18), padding: 11, gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Body numberOfLines={1} style={{ fontSize: 13, fontFamily: F.bodySemi, color: '#fff' }}>{r.name}</Body>
          {r.contact_no ? (
            <Pressable onPress={() => Linking.openURL(`tel:${r.contact_no}`)} hitSlop={6} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 }}>
              <Icon name="phone" size={10} color={C.blue} strokeWidth={2.2} />
              <Body style={{ fontSize: 10.5, color: C.blue }}>{r.contact_no}</Body>
            </Pressable>
          ) : null}
        </View>
        {/* Stage dropdown — direct update, web parity */}
        <Pressable onPress={() => setStageOpen((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, backgroundColor: hexA(stCol, 0.13), borderWidth: 1, borderColor: hexA(stCol, 0.4) }}>
          <View style={{ width: 6, height: 6, borderRadius: 99, backgroundColor: stCol }} />
          <Text style={{ fontFamily: F.bodySemi, fontSize: 10.5, color: stCol }}>{r.stage}</Text>
          <Icon name={stageOpen ? 'chevUp' : 'chevDown'} size={10} color={stCol} strokeWidth={2.4} />
        </Pressable>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Icon name="alert" size={11} color={col} strokeWidth={2.2} />
        <Body style={{ flex: 1, fontSize: 10.5, fontFamily: F.bodySemi, color: col }}>{relSpan(r.next_follow_up_at)} · {fmtAt(r.next_follow_up_at)}</Body>
      </View>
      {r.next_follow_up_note ? (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
          <Icon name="file" size={11} color={C.muted3} strokeWidth={2} />
          <Body numberOfLines={2} style={{ flex: 1, fontSize: 10.5, color: C.muted2 }}>{r.next_follow_up_note}</Body>
        </View>
      ) : null}

      {stageOpen ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {/* Direct updates here bypass the booking dialogs (web parity), so
              Reschedule QHP — which must capture a new slot + reason — is excluded. */}
          {LEAD_STAGES.filter((s) => s !== 'New' && s !== 'Reschedule QHP').map((s) => {
            const active = r.stage === s;
            const c = stageColor(s);
            return (
              <Pressable key={s} disabled={active || busy} onPress={() => { setErr(null); update.mutate({ id: r.id, patch: { stage: s } }, { onSuccess: () => setStageOpen(false), onError: fail }); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, backgroundColor: active ? hexA(c, 0.2) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(c, 0.6) : 'rgba(255,255,255,0.09)' }}>
                <View style={{ width: 5, height: 5, borderRadius: 99, backgroundColor: c }} />
                <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 10, color: active ? c : C.muted }}>{s}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {remarkOpen ? (
        <View style={{ gap: 4 }}>
          <Inp value={remark} onChangeText={(v: string) => setRemark(v.slice(0, 280))} placeholder="Remark — saved when you Mark as Done…" multiline style={{ minHeight: 48, textAlignVertical: 'top' }} />
          <Mono style={{ fontSize: 7.5, letterSpacing: 0.5, color: C.muted3 }}>SAVED WITH “MARK AS DONE” · {remark.length}/280</Mono>
        </View>
      ) : null}

      {applicantOpen ? (
        <View style={{ gap: 7 }}>
          <ChipRow options={CANDIDATE_TYPES} value={candidateType as any} onChange={(v) => setCandidateType(v)} color={C.purple} />
          <View style={{ flexDirection: 'row' }}>
            <SmallBtn label={busy ? 'Saving…' : `Confirm ${candidateType} applicant`} icon="userPlus" color={C.purple} solid disabled={busy}
              onPress={() => { setErr(null); markApplicant.mutate({ id: r.id, candidateType }, { onSuccess: () => setApplicantOpen(false), onError: fail }); }} />
          </View>
        </View>
      ) : null}

      {err ? <Body style={{ fontSize: 10.5, color: C.red }}>{err}</Body> : null}

      <View style={{ flexDirection: 'row', gap: 7 }}>
        <SmallBtn label="Applicant" icon="userPlus" color={C.purple} onPress={() => { setApplicantOpen((v) => !v); }} />
        <SmallBtn label="Remark" icon="file" color={C.orange} onPress={() => setRemarkOpen((v) => !v)} />
        <SmallBtn label={complete.isPending ? 'Saving…' : 'Done'} icon="checks" color={C.green} solid disabled={!pending || busy}
          onPress={() => { setErr(null); complete.mutate({ leadId: r.id, entryId: pending?.id, manualRemark: remark.trim() || undefined, profile }, { onError: fail }); }} />
      </View>
    </View>
  );
}

function FollowUpReminderPanel({ profile }: { profile: any }) {
  const q = useOpsFollowUpReminders(true);
  const [expanded, setExpanded] = React.useState(true);
  const all = q.data ?? [];
  if (!all.length) return null; // web: banner hidden when there are no reminders
  const overdue = all.filter((r) => r.overdue);
  const dueSoon = all.filter((r) => !r.overdue);
  const col = overdue.length ? C.red : C.gold;
  const shown = all.slice(0, 8);
  return (
    <Card colors={[hexA(col, 0.08), 'rgba(18,14,14,0.55)']} border={hexA(col, 0.32)} radius={16} style={{ padding: 12, gap: 10 }}>
      <Pressable onPress={() => setExpanded((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: hexA(col, 0.15), borderWidth: 1, borderColor: hexA(col, 0.45), alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="bell" size={16} color={col} strokeWidth={2.1} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
            <Body numberOfLines={1} style={{ flexShrink: 1, fontSize: 13, fontFamily: F.bodyBold, color: col }}>Lead Follow-up Reminder</Body>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 2.5, paddingHorizontal: 7, borderRadius: 999, backgroundColor: hexA(C.green, 0.1), borderWidth: 1, borderColor: hexA(C.green, 0.3) }}>
              <Icon name="bell" size={8.5} color={C.green} strokeWidth={2.4} />
              <Text style={{ fontFamily: F.bodySemi, fontSize: 8.5, color: C.green }}>Notifications: On</Text>
            </View>
          </View>
          <Body style={{ fontSize: 11, fontFamily: F.bodySemi, color: hexA(col, 0.9), marginTop: 2 }}>
            {[overdue.length ? `${overdue.length} overdue` : null, dueSoon.length ? `${dueSoon.length} due in next 24h` : null].filter(Boolean).join(' · ')}
          </Body>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
          <Icon name={expanded ? 'chevUp' : 'chevDown'} size={11} color={C.muted} strokeWidth={2.4} />
          <Text style={{ fontFamily: F.bodySemi, fontSize: 10.5, color: C.muted }}>{expanded ? 'Hide' : 'Show'}</Text>
        </View>
      </Pressable>
      {expanded ? shown.map((r) => <ReminderCard key={r.id} r={r} profile={profile} />) : null}
      {expanded && all.length > shown.length ? (
        <Mono style={{ fontSize: 8.5, letterSpacing: 0.6, color: C.muted3, textAlign: 'center' }}>+{all.length - shown.length} MORE FOLLOW-UPS — SORTED SOONEST FIRST</Mono>
      ) : null}
    </Card>
  );
}

/* ---------------- Main screen ---------------- */
type QuickFilter = 'all' | 'week' | 'pipeline' | 'cold' | 'dump' | 'potential' | 'converted';
export function OpsLeads() {
  const { crmSection, set } = useStore();
  const profQ = useMyOpsProfile();
  const statsQ = useLeadStats();
  const coldQ = useColdLeads();
  const dumpQ = useDumpLeadsCount();
  const serialQ = useLeadMonthlySerials();
  const markAttempt = useMarkLeadAttempt();
  const restoreDump = useRestoreLeadFromDump();
  const [tab, setTab] = React.useState<'leads' | 'applicants'>('leads');
  const [spamOnly, setSpamOnly] = React.useState(false);
  const [quick, setQuick] = React.useState<QuickFilter>('all');
  const [search, setSearch] = React.useState('');
  const [stageFilter, setStageFilter] = React.useState<string | null>(null);
  const [page, setPage] = React.useState(1);
  const [openLeadId, setOpenLeadId] = React.useState<string | null>(null);
  const [addOpen, setAddOpen] = React.useState(false);
  const profile = profQ.data;

  // Deep-link from the dashboard tiles (crmSection carries the quick filter).
  React.useEffect(() => {
    if (crmSection && ['week', 'pipeline', 'cold', 'dump', 'potential', 'converted'].includes(crmSection)) { setQuick(crmSection as QuickFilter); set({ crmSection: null }); }
  }, [crmSection]); // eslint-disable-line react-hooks/exhaustive-deps

  const filters: LeadFilters = React.useMemo(() => {
    const f: LeadFilters = { search, page, pageSize: 25, applicantLeadsOnly: tab === 'applicants', spamOnly };
    if (stageFilter) f.stages = [stageFilter];
    else if (quick === 'week') { f.dateFrom = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10); f.dateTo = new Date().toISOString().slice(0, 10); }
    // Web parity: Potential left the stage list, so the pipeline is New + QHP Booked + QHP Completed.
    else if (quick === 'pipeline') f.stages = ['New', 'QHP Booked', 'QHP Completed'];
    else if (quick === 'converted') f.stages = ['Converted'];
    else if (quick === 'cold') { f.stages = ['Not Picked']; f.onlyIds = coldQ.data?.ids ?? []; f.sortBy = 'lead_date'; f.sortDir = 'asc'; }
    else if (quick === 'dump') { f.dumpOnly = true; f.sortBy = 'updated_at'; f.sortDir = 'desc'; }
    else if (quick === 'potential') f.potentialOnly = true;
    return f;
  }, [search, page, tab, spamOnly, quick, stageFilter, coldQ.data?.ids]);
  const q = useLeadsList(filters);
  const s = statsQ.data;
  const rows = q.data?.rows ?? [];
  const total = q.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / 25));
  const setQuickFilter = (f: QuickFilter) => { setQuick((cur) => (cur === f ? 'all' : f)); setStageFilter(null); setPage(1); };

  // Partner (couple) names for the visible page, one batched query.
  const partnerIds = React.useMemo(() => Array.from(new Set(rows.map((r) => r.partner_lead_id).filter(Boolean))) as string[], [rows]);
  const partnerNamesQ = usePartnerNames(partnerIds);
  const partnerName = (id: string | null | undefined) => (id ? partnerNamesQ.data?.[id] ?? null : null);

  /* Mark call attempt — cold view only. Confirm first (web MarkAttemptDialog),
     listing previous attempts; the DB trigger may auto-dump on the 2nd attempt. */
  const openAttempt = (l: Lead) => {
    const attempts: CallAttemptEntry[] = Array.isArray(l.call_attempts) ? l.call_attempts : [];
    const hist = attempts.length
      ? `\n\nPrevious attempts (${attempts.length}):\n` + [...attempts].reverse().map((a) => `· ${fmtAt(a.at)} · ${a.day}${a.by_name ? ` · ${a.by_name}` : ''}`).join('\n')
      : '';
    Alert.alert('Mark call attempt?', `Log a call attempt for ${l.name} (${l.contact_no ?? 'no phone'}).${hist}`, [
      { text: 'No', style: 'cancel' },
      {
        text: 'Yes, mark attempt',
        onPress: () => markAttempt.mutate({ lead: l, profile }, {
          onSuccess: (row) => {
            if (row.is_dump) Alert.alert('Moved to Dump Leads', `${row.name} auto-moved after 2 attempts on a cold lead`);
            else Alert.alert('Attempt logged', 'Call attempt saved');
          },
          onError: (e: any) => Alert.alert('Could not log attempt', e?.message ?? 'Please try again'),
        }),
      },
    ]);
  };
  const openRestore = (l: Lead) => {
    Alert.alert('Restore from Dump?', `${l.name} moves back to the Cold list.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Restore',
        onPress: () => restoreDump.mutate({ leadId: l.id, profile }, {
          onSuccess: () => Alert.alert('Restored from Dump', 'Lead moved back to Cold list'),
          onError: (e: any) => Alert.alert('Restore failed', e?.message ?? 'Please try again'),
        }),
      },
    ]);
  };

  return (
    <Page gap={13}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <View style={{ flex: 1 }}><TitleBlock title="Leads" sub="Lead-to-client pipeline" /></View>
        <Pressable onPress={() => setAddOpen(true)} style={{ overflow: 'hidden', borderRadius: 12 }}>
          <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 14 }}>
            <Icon name="plus" size={13} color="#fff" strokeWidth={2.6} />
            <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: '#fff' }}>Add Lead</Text>
          </LinearGradient>
        </Pressable>
      </View>

      {/* Follow-up reminders — expandable, web OpsFollowUpNotificationBanner */}
      <FollowUpReminderPanel profile={profQ.data} />

      {/* quick-filter stat strip (web StatsCards: Month / Week / Pipeline / Cold / Dump / Potential / Converted) */}
      {s ? (
        <HScroll gap={8}>
          {(([['all', 'This Month', s.thisMonth, C.blue], ['week', 'This Week', s.newThisWeek, C.green], ['pipeline', 'In Pipeline', s.activePipeline, C.orange], ['cold', 'Cold Leads', coldQ.data?.count ?? 0, C.red], ['dump', 'Dump Leads', dumpQ.data?.count ?? 0, '#9AA0A6'], ['potential', 'Potential', s.potential ?? 0, AMBER], ['converted', 'Converted', s.converted, C.green]]) as [QuickFilter, string, number, string][]).map(([id, label, n, col]) => {
            const active = quick === id && !stageFilter;
            return (
              <Pressable key={id} onPress={() => setQuickFilter(id)}>
                <Card colors={['rgba(56,34,21,0.5)', 'rgba(20,16,15,0.5)']} border={hexA(col, active ? 0.55 : 0.2)} radius={14} style={{ paddingVertical: 10, paddingHorizontal: 14, alignItems: 'center', gap: 2, minWidth: 96 }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 17, color: col }}>{n}</Text>
                  <Mono style={{ fontSize: 7.5, letterSpacing: 0.5, color: active ? col : C.muted3 }}>{label.toUpperCase()}</Mono>
                </Card>
              </Pressable>
            );
          })}
        </HScroll>
      ) : null}

      {/* tabs + spam */}
      <View style={{ flexDirection: 'row', gap: 7, alignItems: 'center' }}>
        {(([['leads', 'Leads'], ['applicants', 'Applicants']]) as ['leads' | 'applicants', string][]).map(([id, label]) => {
          const active = tab === id;
          return (
            <Pressable key={id} onPress={() => { setTab(id); setPage(1); }} style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: active ? hexA(C.orange, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.orange, 0.5) : 'rgba(255,255,255,0.09)' }}>
              <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 11.5, color: active ? C.orange : C.muted }}>{label}</Text>
            </Pressable>
          );
        })}
        <View style={{ flex: 1 }} />
        <Pressable onPress={() => { setSpamOnly((v) => !v); setPage(1); }} style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: spamOnly ? hexA(C.red, 0.14) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: spamOnly ? hexA(C.red, 0.5) : 'rgba(255,255,255,0.09)' }}>
          <Text style={{ fontFamily: spamOnly ? F.bodyBold : F.bodySemi, fontSize: 11, color: spamOnly ? C.red : C.muted }}>Spam</Text>
        </Pressable>
      </View>

      <OpsSearch value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search by name or phone…" />
      <HScroll gap={6}>
        {LEAD_STAGES.map((st) => {
          const active = stageFilter === st;
          const col = stageColor(st);
          return (
            <Pressable key={st} onPress={() => { setStageFilter(active ? null : st); setQuick('all'); setPage(1); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 7, paddingHorizontal: 11, borderRadius: 999, backgroundColor: active ? hexA(col, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(col, 0.5) : 'rgba(255,255,255,0.09)' }}>
              <View style={{ width: 6, height: 6, borderRadius: 99, backgroundColor: col }} />
              <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 10.5, color: active ? col : C.muted }}>{st}</Text>
            </Pressable>
          );
        })}
      </HScroll>

      {q.isError ? <Body style={{ fontSize: 11.5, color: C.red, textAlign: 'center' }}>{(q.error as Error).message}</Body> : null}
      {q.isLoading ? <Loading /> : rows.length === 0 ? <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 24 }}>No leads match this view.</Body> : (
        <>
          <Body style={{ fontSize: 10.5, color: C.muted3 }}>Page {page} of {pages} · {total} lead{total === 1 ? '' : 's'}</Body>
          {rows.map((l) => {
            const col = stageColor(l.stage);
            const fuAt = l.next_follow_up_at ? new Date(l.next_follow_up_at).getTime() : null;
            const fuOverdue = fuAt != null && fuAt < Date.now();
            const serial = serialQ.data?.get(l.id);
            const isPotential = !!l.potential?.marked;
            const assignee = assigneeFirstName(l.assigned_to);
            const pName = partnerName(l.partner_lead_id);
            const showAttempt = quick === 'cold' && !stageFilter && !l.applicant_lead;
            return (
              <Card key={l.id} onPress={() => setOpenLeadId(l.id)} colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border={hexA(isPotential ? AMBER : col, 0.18)} radius={14} style={{ padding: 12, borderLeftWidth: 3, borderLeftColor: isPotential ? AMBER : col, gap: 6 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  {/* monthly serial — avatar slot (web LeadCard #N, restarts every month) */}
                  {serial != null ? (
                    <View style={{ minWidth: 30, height: 30, borderRadius: 15, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center', backgroundColor: hexA(C.orange, 0.1), borderWidth: 1, borderColor: hexA(C.orange, 0.3) }}>
                      <Mono style={{ fontSize: 9.5, color: C.orange }}>#{serial}</Mono>
                    </View>
                  ) : null}
                  <Body numberOfLines={1} style={{ flex: 1, fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{l.name}</Body>
                  {l.is_spam ? <Badge text="Spam" color={C.red} /> : null}
                  {l.applicant_lead?.candidate_type ? <Badge text={l.applicant_lead.candidate_type} color={C.purple} /> : null}
                  <Badge text={l.stage} color={col} />
                </View>
                {isPotential || l.is_dump || l.lead_type === 'influencer' || l.qhp_details?.type || pName || assignee ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                    {isPotential ? <Badge text="Potential" color={AMBER} /> : null}
                    {l.is_dump ? <Badge text="Dump" color={C.muted2} /> : null}
                    {l.lead_type === 'influencer' ? <Badge text="Influencer" color={PINK} /> : null}
                    <QhpPayChip details={l.qhp_details} />
                    {pName ? <Badge text={`Couple · ${pName}`} color={C.blue} /> : null}
                    {assignee ? <Badge text={assignee} color={C.blue} /> : null}
                  </View>
                ) : null}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                  {l.contact_no ? <Body style={{ fontSize: 11, color: C.muted2 }}>{l.contact_no}</Body> : null}
                  {l.source ? <Body style={{ fontSize: 11, color: C.muted2 }}>{l.source}</Body> : null}
                  <Mono style={{ fontSize: 8, letterSpacing: 0.4, color: C.muted3 }}>{fmtDay(l.lead_date).toUpperCase()}</Mono>
                  {fuAt != null ? <Badge text={`FU ${fmtAt(l.next_follow_up_at)}`} color={fuOverdue ? C.red : C.gold} /> : null}
                </View>
                {showAttempt || l.is_dump ? (
                  <View style={{ flexDirection: 'row', gap: 7 }}>
                    {showAttempt ? (
                      <SmallBtn label={markAttempt.isPending ? 'Saving…' : `Mark attempt${Array.isArray(l.call_attempts) && l.call_attempts.length ? ` (${l.call_attempts.length})` : ''}`} icon="phone" color={C.red} solid disabled={markAttempt.isPending} onPress={() => openAttempt(l)} />
                    ) : null}
                    {l.is_dump && !l.applicant_lead ? (
                      <SmallBtn label={restoreDump.isPending ? 'Restoring…' : 'Restore'} icon="checks" color={C.green} solid disabled={restoreDump.isPending} onPress={() => openRestore(l)} />
                    ) : null}
                  </View>
                ) : null}
              </Card>
            );
          })}
          {pages > 1 ? (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {(([['Previous', -1, page <= 1], ['Next', 1, page >= pages]]) as [string, number, boolean][]).map(([lab, dir, disabled]) => (
                <Pressable key={lab} disabled={disabled} onPress={() => setPage((p) => p + dir)} style={{ flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)', opacity: disabled ? 0.4 : 1 }}>
                  <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: C.orange }}>{lab}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </>
      )}
      {openLeadId ? <LeadSheet leadId={openLeadId} rows={rows} profile={profQ.data} partnerName={partnerName(rows.find((l) => l.id === openLeadId)?.partner_lead_id)} onClose={() => setOpenLeadId(null)} /> : null}
      {addOpen ? <LeadFormSheet lead={null} profile={profQ.data} onClose={() => setAddOpen(false)} /> : null}
    </Page>
  );
}
