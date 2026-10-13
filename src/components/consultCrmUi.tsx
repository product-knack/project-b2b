/* CRM Doctor Consultation UI (6 Oct 2026): the slot row shared by Scheduled Calls
   and the client page, the record popup (prescription / transcript / AI summary /
   meeting notes, with Approve), the Book and Reschedule sheets, the mandatory
   next-follow-up dialog and the CRM home banner. Dark CRM theme; the record popup
   is a light "document" surface so it reads like the consultant's own views. */
import React from 'react';
import { View, Text, Pressable, Modal, ScrollView, TextInput, ActivityIndicator, Alert, Animated, Easing } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { C, F, hexA } from '../theme';
import { Icon, IconName } from '../icons';
import { Serif, Body, Mono } from './primitives';
import { ReplayMask } from './ReplayShield';
import { HScroll } from '../screens/common';
import { SheetShell } from '../screens/reportDetail';
import { useStore } from '../store';
import { useKeyboardHeight } from '../lib/useKeyboardHeight';
import {
  ConsultationSlot, isSlotElapsed, rxState, isRxApproved, timeLabel, fmtLongDate, fmtDayMonth, slotPersonName, parseNextFollowUp, followUpLabel,
  describeConsultError, joinTargetRef, useProvisionRoom, useUpdateSlotStatus, ymdLocal, addDays, DAYS_SHORT, MONTHS_SHORT, pad2, istStamp,
} from '../lib/consultantQueries';
import { CX, PrescriptionView, AiNotesView, MeetingNotesView, ApprovedBadge, EditHistoryList } from './consultantUi';
import {
  useConsultRecord, useConsultantDoctors, useBookConsultSlot, useRescheduleConsultSlot, useApprovePrescription, useSetNextFollowUp,
  useConsultationFollowUpsDue, TranscriptChunk,
} from '../lib/crmConsultQueries';

export const DOC = C.purple;
export const BLOOD = '#2FB7A3';
export const RECORD = C.gold;

/* ---------- time helpers (30-minute grid, 06:00 to 22:30) ---------- */
export const TIME_OPTIONS: string[] = [];
for (let h = 6; h <= 22; h++) for (const m of [0, 30]) TIME_OPTIONS.push(`${pad2(h)}:${pad2(m)}`);
export const toHms = (hhmm: string) => (hhmm.length === 5 ? `${hhmm}:00` : hhmm);
export const toHm = (t: string) => t.slice(0, 5);
export const addMinutes = (hhmm: string, n: number) => {
  const [h, m] = hhmm.split(':').map(Number);
  const tot = Math.min(23 * 60 + 30, h * 60 + m + n);
  return `${pad2(Math.floor(tot / 60))}:${pad2(tot % 60)}`;
};
const dayChipLabel = (d: Date) => `${DAYS_SHORT[d.getDay()]} ${d.getDate()}`;

/** Where the list page should land when opened from a banner (tab + client to book). */
export const consultLandingRef: { current: { tab?: 'clients' | 'calls' | 'tracker'; bookClientId?: string } | null } = { current: null };

/* ---------- small bits ---------- */
export function Chip({ label, icon, color, onPress, disabled, busy, filled }: { label: string; icon?: IconName; color: string; onPress?: () => void; disabled?: boolean; busy?: boolean; filled?: boolean }) {
  return (
    <Pressable onPress={disabled || busy ? undefined : onPress} hitSlop={6} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6, paddingHorizontal: 11, borderRadius: 999, opacity: disabled ? 0.45 : pressed ? 0.8 : 1, backgroundColor: filled ? hexA(color, 0.9) : hexA(color, 0.12), borderWidth: 1, borderColor: filled ? hexA(color, 0.9) : hexA(color, 0.45) })}>
      {busy ? <ActivityIndicator size="small" color={filled ? '#fff' : color} /> : icon ? <Icon name={icon} size={11} color={filled ? '#fff' : color} strokeWidth={2.3} /> : null}
      <Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: filled ? '#fff' : color }}>{label}</Text>
    </Pressable>
  );
}
export function Pill({ text, color }: { text: string; color: string }) {
  return (
    <View style={{ paddingVertical: 2.5, paddingHorizontal: 8, borderRadius: 999, backgroundColor: hexA(color, 0.14), borderWidth: 1, borderColor: hexA(color, 0.45) }}>
      <Mono style={{ fontSize: 7.5, letterSpacing: 1, color }}>{text}</Mono>
    </View>
  );
}
export const slotState = (s: ConsultationSlot, now: number) =>
  s.status === 'cancelled' ? { label: 'CANCELLED', color: C.muted2 } : s.status === 'completed' ? { label: 'COMPLETED', color: C.green } : isSlotElapsed(s, now) ? { label: 'ELAPSED', color: C.gold } : { label: 'SCHEDULED', color: C.blue };

/* ---------- actions shared by both lists ---------- */
export function useCrmSlotActions() {
  const { go } = useStore();
  const provision = useProvisionRoom();
  const status = useUpdateSlotStatus();
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const join = (s: ConsultationSlot) => {
    if (!s.meet_url) return;
    joinTargetRef.current = { slotId: s.id, url: s.meet_url, clientName: slotPersonName(s.client) };
    go('doctor-consultation-join');
  };
  const generateLink = (s: ConsultationSlot) => {
    if (provision.isPending) return;
    setBusyId(s.id);
    provision.mutate(s.id, { onError: (e) => Alert.alert("Couldn't create the video link", describeConsultError(e)), onSettled: () => setBusyId(null) });
  };
  const cancel = (s: ConsultationSlot) => {
    Alert.alert('Cancel this consultation?', `${slotPersonName(s.client)} with Dr ${slotPersonName(s.doctor)} · ${fmtLongDate(s.consultation_date)} · ${timeLabel(s.start_time)}`, [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Cancel consultation', style: 'destructive', onPress: () => { setBusyId(s.id); status.mutate({ id: s.id, status: 'cancelled' }, { onError: (e) => Alert.alert("Couldn't cancel", describeConsultError(e)), onSettled: () => setBusyId(null) }); } },
    ]);
  };
  return { join, generateLink, cancel, busyId };
}
export type CrmSlotActions = ReturnType<typeof useCrmSlotActions>;

/* ---------- one booking ---------- */
export function SlotRow({ slot, now, showClient, actions, onRecord, onReschedule, onApprove, canCancel }: {
  slot: ConsultationSlot; now: number; showClient?: boolean; actions: CrmSlotActions;
  onRecord: (slot: ConsultationSlot, tab: RecordTab) => void; onReschedule: (slot: ConsultationSlot) => void; onApprove: (slot: ConsultationSlot) => void; canCancel?: boolean;
}) {
  const st = slotState(slot, now);
  const busy = actions.busyId === slot.id;
  const rx = rxState(slot.prescription);
  const approved = isRxApproved(slot.prescription_approval);
  const fu = parseNextFollowUp(slot.next_follow_up);
  const d = new Date(`${slot.consultation_date}T00:00:00`);
  const scheduled = slot.status === 'scheduled';
  return (
    <View style={{ borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.24)', borderWidth: 1, borderColor: hexA(st.color, slot.status === 'cancelled' ? 0.18 : 0.35), overflow: 'hidden', opacity: slot.status === 'cancelled' ? 0.6 : 1 }}>
      <View style={{ height: 3, backgroundColor: hexA(st.color, 0.6) }} />
      <View style={{ padding: 13, gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 52, alignItems: 'center', paddingVertical: 6, borderRadius: 12, backgroundColor: hexA(st.color, 0.1), borderWidth: 1, borderColor: hexA(st.color, 0.3) }}>
            <Mono style={{ fontSize: 8, letterSpacing: 1, color: st.color }}>{MONTHS_SHORT[d.getMonth()].toUpperCase()}</Mono>
            <Serif style={{ fontSize: 22, lineHeight: 26 }}>{d.getDate()}</Serif>
            <Mono style={{ fontSize: 7.5, color: C.muted3 }}>{DAYS_SHORT[d.getDay()].toUpperCase()}</Mono>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            {showClient ? <Body numberOfLines={1} style={{ fontSize: 14.5, fontFamily: F.bodySemi, color: '#fff' }}>{slotPersonName(slot.client)}</Body> : null}
            <Body numberOfLines={1} style={{ fontSize: showClient ? 12 : 14, fontFamily: showClient ? F.body : F.bodySemi, color: showClient ? C.ink3 : '#fff' }}>Dr {slotPersonName(slot.doctor)}</Body>
            <Mono style={{ fontSize: 9.5, color: C.muted2 }}>{timeLabel(slot.start_time)} TO {timeLabel(slot.end_time)}</Mono>
            {slot.description ? <Body numberOfLines={2} style={{ fontSize: 11.5, color: C.muted2, marginTop: 2 }}>{slot.description}</Body> : null}
          </View>
          <View style={{ alignItems: 'flex-end', gap: 5 }}>
            <Pill text={st.label} color={st.color} />
            {rx !== 'none' ? <Pill text={approved ? 'RX APPROVED' : rx === 'finalized' ? 'RX SAVED' : 'RX DRAFT'} color={approved ? C.green : rx === 'finalized' ? DOC : C.gold} /> : null}
          </View>
        </View>
        {fu ? <Mono numberOfLines={1} style={{ fontSize: 8.5, letterSpacing: 0.5, color: C.gold }}>NEXT FOLLOW-UP · {followUpLabel(fu).toUpperCase()}</Mono> : null}
        {slot.status !== 'cancelled' ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {scheduled ? (slot.meet_url
              ? <Chip label="Join call" icon="phone" color={C.green} filled onPress={() => actions.join(slot)} />
              : <Chip label="Generate link" icon="sparkle" color={C.blue} onPress={() => actions.generateLink(slot)} busy={busy} />) : null}
            <Chip label={rx === 'none' ? 'Prescription' : rx === 'draft' ? 'Draft prescription' : 'Prescription'} icon="clipboard" color={DOC} onPress={() => onRecord(slot, 'rx')} />
            {rx === 'finalized' && !approved ? <Chip label="Approve" icon="checks" color={C.green} onPress={() => onApprove(slot)} /> : null}
            {slot.status === 'completed' ? <Chip label="Meeting summary" icon="file" color={C.ink3} onPress={() => onRecord(slot, 'notes')} /> : null}
            {slot.status === 'completed' ? <Chip label="AI notes" icon="sparkle" color={C.ink3} onPress={() => onRecord(slot, 'ai')} /> : null}
            {scheduled ? <Chip label="Reschedule" icon="swap" color={C.gold} onPress={() => onReschedule(slot)} /> : null}
            {scheduled && canCancel ? <Chip label="Cancel" icon="close" color={C.red} onPress={() => actions.cancel(slot)} busy={busy} /> : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

/* ---------- the record popup (light document surface) ---------- */
export type RecordTab = 'rx' | 'transcript' | 'ai' | 'notes';
const TABS: { id: RecordTab; label: string }[] = [{ id: 'rx', label: 'Prescription' }, { id: 'transcript', label: 'Transcript' }, { id: 'ai', label: 'AI summary' }, { id: 'notes', label: 'Meeting notes' }];
function TranscriptList({ chunks }: { chunks: TranscriptChunk[] | null }) {
  if (!chunks || !chunks.length) return <Text style={{ fontFamily: F.body, fontSize: 13, color: CX.slate500 }}>No transcript for this call. Calls joined from the phone leave no transcript; the CRM's browser records one when present.</Text>;
  return (
    <View style={{ gap: 10 }}>
      {chunks.map((c, i) => {
        const who = c.speaker || c.name || c.role || 'Speaker';
        const text = c.text || c.content || '';
        if (!text) return null;
        return (
          <View key={i} style={{ gap: 2 }}>
            <Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: CX.indigo }}>{who}{c.at ? ` · ${istStamp(c.at) ?? ''}` : ''}</Text>
            <Text style={{ fontFamily: F.body, fontSize: 13, color: CX.slate900, lineHeight: 19 }}>{text}</Text>
          </View>
        );
      })}
    </View>
  );
}
export function ConsultRecordSheet({ slot, initialTab, onClose }: { slot: ConsultationSlot | null; initialTab: RecordTab; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = React.useState<RecordTab>(initialTab);
  React.useEffect(() => { if (slot) setTab(initialTab); }, [slot?.id, initialTab]);
  const q = useConsultRecord(slot?.id ?? null);
  const approveM = useApprovePrescription();
  const rec = q.data;
  const rx = rec?.prescription ?? slot?.prescription ?? null;
  const approval = rec?.prescription_approval ?? slot?.prescription_approval ?? null;
  const approve = () => {
    if (!slot) return;
    Alert.alert('Approve this prescription?', 'It will be locked: nobody can edit it any more, and the client sees it right away.', [
      { text: 'Not now', style: 'cancel' },
      { text: 'Approve', onPress: () => approveM.mutate({ slotId: slot.id, note: null }, { onSuccess: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}), onError: (e) => Alert.alert("Couldn't approve", describeConsultError(e)) }) },
    ]);
  };
  return (
    <Modal visible={!!slot} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.66)', justifyContent: 'flex-end' }}>
        <Pressable onPress={onClose} accessibilityLabel="Close" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
        {slot ? (
          <ReplayMask style={{ height: '92%' }}>
            <View style={{ flex: 1, backgroundColor: CX.white, borderTopLeftRadius: 26, borderTopRightRadius: 26, overflow: 'hidden' }}>
              <View style={{ paddingTop: 9, paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: CX.slate100, backgroundColor: CX.white }}>
                <View style={{ alignSelf: 'center', width: 38, height: 4, borderRadius: 999, backgroundColor: CX.slate200 }} />
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 }}>
                  <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: CX.indigo50, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="clipboard" size={18} color={CX.indigo} strokeWidth={2} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={{ fontFamily: F.bodyBold, fontSize: 15, color: CX.slate900 }}>{slotPersonName(slot.client)}</Text>
                    <Text numberOfLines={1} style={{ fontFamily: F.body, fontSize: 11.5, color: CX.slate500 }}>Dr {slotPersonName(slot.doctor)} · {fmtLongDate(slot.consultation_date)} · {timeLabel(slot.start_time)}</Text>
                  </View>
                  <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close" style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: CX.slate100, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="close" size={15} color={CX.slate600} strokeWidth={2.3} />
                  </Pressable>
                </View>
                <View style={{ marginTop: 12 }}>
                  <HScroll gap={6}>
                    {TABS.map((t) => (
                      <Pressable key={t.id} onPress={() => setTab(t.id)} hitSlop={6} accessibilityRole="tab" accessibilityState={{ selected: tab === t.id }}
                        style={{ paddingVertical: 7, paddingHorizontal: 13, borderRadius: 999, backgroundColor: tab === t.id ? CX.indigo : CX.slate100 }}>
                        <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: tab === t.id ? '#fff' : CX.slate600 }}>{t.label}</Text>
                      </Pressable>
                    ))}
                  </HScroll>
                </View>
              </View>
              <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 30, gap: 14 }} showsVerticalScrollIndicator={false}>
                {q.isPending ? <ActivityIndicator color={CX.indigo} style={{ paddingVertical: 24 }} /> : q.isError ? (
                  <Text style={{ fontFamily: F.body, fontSize: 13, color: CX.rose }}>{(q.error as Error).message}</Text>
                ) : tab === 'rx' ? (
                  <View style={{ gap: 14 }}>
                    {approval && isRxApproved(approval) ? <ApprovedBadge approval={approval} /> : rxState(rx) === 'finalized' ? (
                      <Pressable onPress={approve} disabled={approveM.isPending} accessibilityRole="button" style={{ borderRadius: 14, overflow: 'hidden', opacity: approveM.isPending ? 0.6 : 1 }}>
                        <LinearGradient colors={[CX.emerald, '#0E9F6E']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12 }}>
                          {approveM.isPending ? <ActivityIndicator color="#fff" /> : <Icon name="checks" size={15} color="#fff" strokeWidth={2.6} />}
                          <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: '#fff' }}>Approve prescription</Text>
                        </LinearGradient>
                      </Pressable>
                    ) : null}
                    <PrescriptionView rx={rx} />
                    {rec?.referral && (rec.referral.speciality || rec.referral.reason) ? (
                      <View style={{ padding: 12, borderRadius: 12, backgroundColor: '#F5F3FF', borderWidth: 1, borderColor: '#DDD6FE' }}>
                        <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: '#6D28D9' }}>Refer to: {rec.referral.speciality || 'a specialist'}{rec.referral.reason ? ` · ${rec.referral.reason}` : ''}</Text>
                      </View>
                    ) : null}
                    {rec?.edit_history?.length ? <EditHistoryList entries={rec.edit_history} /> : null}
                  </View>
                ) : tab === 'transcript' ? <TranscriptList chunks={rec?.transcript ?? null} />
                : tab === 'ai' ? <AiNotesView notes={rec?.ai_notes ?? null} />
                : <MeetingNotesView summary={rec?.meeting_summary ?? null} />}
              </ScrollView>
            </View>
          </ReplayMask>
        ) : null}
      </View>
    </Modal>
  );
}

/* ---------- day + time pickers ---------- */
function DayStrip({ value, onChange, days = 30, fromToday = true }: { value: string; onChange: (ymd: string) => void; days?: number; fromToday?: boolean }) {
  const base = new Date(); base.setHours(0, 0, 0, 0);
  const list = Array.from({ length: days }, (_, i) => addDays(base, i));
  if (!fromToday && !list.some((d) => ymdLocal(d) === value)) list.unshift(new Date(`${value}T00:00:00`));
  return (
    <HScroll gap={6}>
      {list.map((d) => {
        const ymd = ymdLocal(d); const active = ymd === value;
        return (
          <Pressable key={ymd} onPress={() => onChange(ymd)} hitSlop={4} accessibilityRole="button" accessibilityState={{ selected: active }}
            style={{ alignItems: 'center', paddingVertical: 7, paddingHorizontal: 11, borderRadius: 12, backgroundColor: active ? hexA(DOC, 0.2) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(DOC, 0.6) : 'rgba(255,255,255,0.1)' }}>
            <Mono style={{ fontSize: 7.5, letterSpacing: 0.8, color: active ? '#fff' : C.muted3 }}>{MONTHS_SHORT[d.getMonth()].toUpperCase()}</Mono>
            <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: active ? '#fff' : C.ink3 }}>{dayChipLabel(d)}</Text>
          </Pressable>
        );
      })}
    </HScroll>
  );
}
function TimeGrid({ value, onChange, color = DOC }: { value: string; onChange: (hhmm: string) => void; color?: string }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {TIME_OPTIONS.map((t) => {
        const active = t === value;
        return (
          <Pressable key={t} onPress={() => onChange(t)} hitSlop={2} accessibilityRole="button" accessibilityState={{ selected: active }}
            style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, backgroundColor: active ? hexA(color, 0.22) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(color, 0.65) : 'rgba(255,255,255,0.1)' }}>
            <Text style={{ fontFamily: active ? F.bodyBold : F.body, fontSize: 11.5, color: active ? '#fff' : C.muted }}>{timeLabel(toHms(t))}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <Mono style={{ fontSize: 9, letterSpacing: 1, color: C.muted3 }}>{label}</Mono>
      {children}
    </View>
  );
}
const durationText = (start: string, end: string) => { const m = (Number(end.slice(0, 2)) * 60 + Number(end.slice(3, 5))) - (Number(start.slice(0, 2)) * 60 + Number(start.slice(3, 5))); return m <= 0 ? 'End must be after the start' : m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} hr ${m % 60} min` : `${m / 60} hr`; };

/* ---------- Book a consultant slot ---------- */
export function BookSlotSheet({ visible, onClose, clientId, clientName, bookedBy, onBooked }: { visible: boolean; onClose: () => void; clientId: string | null; clientName: string; bookedBy: string | null; onBooked?: (r: { slotId: string; linkCreated: boolean }) => void }) {
  const kbH = useKeyboardHeight();
  const docsQ = useConsultantDoctors();
  const bookM = useBookConsultSlot();
  const [doctorId, setDoctorId] = React.useState<string | null>(null);
  const [date, setDate] = React.useState(ymdLocal(new Date()));
  const [start, setStart] = React.useState('10:00');
  const [end, setEnd] = React.useState('11:00');
  const [desc, setDesc] = React.useState('');
  const [err, setErr] = React.useState<string | null>(null);
  React.useEffect(() => { if (visible) { setErr(null); setDesc(''); setDate(ymdLocal(new Date())); setStart('10:00'); setEnd('11:00'); } }, [visible]);
  React.useEffect(() => { if (!doctorId && docsQ.data?.length === 1) setDoctorId(docsQ.data[0].id); }, [docsQ.data, doctorId]);
  const pickStart = (t: string) => { setStart(t); setEnd(addMinutes(t, 60)); };
  const valid = !!doctorId && !!clientId && !!bookedBy && date >= ymdLocal(new Date()) && end > start;
  const book = () => {
    if (!valid || bookM.isPending) return;
    setErr(null);
    bookM.mutate({ clientId: clientId!, doctorId: doctorId!, bookedBy: bookedBy!, date, start: toHms(start), end: toHms(end), description: desc.trim() || null }, {
      onSuccess: (r) => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); onClose(); onBooked?.(r); },
      onError: (e) => setErr(describeConsultError(e)),
    });
  };
  return (
    <SheetShell visible={visible} onClose={bookM.isPending ? () => {} : onClose} accent={DOC} icon="calendar" title="Book consultant slot" subtitle={clientName.toUpperCase()}>
      <View style={{ gap: 16, paddingBottom: kbH }}>
        <Field label="CONSULTANT DOCTOR">
          {docsQ.isPending ? <ActivityIndicator color={DOC} /> : !docsQ.data?.length ? <Body style={{ fontSize: 12, color: C.muted2 }}>No consultant doctor on file.</Body> : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {docsQ.data.map((d) => (
                <Pressable key={d.id} onPress={() => setDoctorId(d.id)} accessibilityRole="button" accessibilityState={{ selected: doctorId === d.id }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: doctorId === d.id ? hexA(DOC, 0.22) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: doctorId === d.id ? hexA(DOC, 0.65) : 'rgba(255,255,255,0.12)' }}>
                  <Icon name="userCircle" size={13} color={doctorId === d.id ? '#fff' : C.muted2} strokeWidth={2} />
                  <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: doctorId === d.id ? '#fff' : C.ink3 }}>Dr {d.name}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </Field>
        <Field label="DAY"><DayStrip value={date} onChange={setDate} /></Field>
        <Field label={`START · ${timeLabel(toHms(start))}`}><TimeGrid value={start} onChange={pickStart} /></Field>
        <Field label={`END · ${timeLabel(toHms(end))} · ${durationText(start, end)}`}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {[30, 60, 90, 120].map((n) => { const t = addMinutes(start, n); const active = t === end; return (
              <Pressable key={n} onPress={() => setEnd(t)} accessibilityRole="button" style={{ paddingVertical: 6, paddingHorizontal: 11, borderRadius: 999, backgroundColor: active ? hexA(DOC, 0.22) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(DOC, 0.65) : 'rgba(255,255,255,0.1)' }}>
                <Text style={{ fontFamily: active ? F.bodyBold : F.body, fontSize: 11.5, color: active ? '#fff' : C.muted }}>{n} min · till {timeLabel(toHms(t))}</Text>
              </Pressable>); })}
          </View>
        </Field>
        <Field label="DESCRIPTION (OPTIONAL)">
          <TextInput value={desc} onChangeText={setDesc} placeholder="What the doctor should look at" placeholderTextColor={C.muted3} multiline maxLength={500}
            style={{ minHeight: 70, padding: 12, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', color: '#fff', fontFamily: F.body, fontSize: 13.5, textAlignVertical: 'top' }} />
        </Field>
        {err ? <View style={{ padding: 11, borderRadius: 12, backgroundColor: hexA(C.red, 0.1), borderWidth: 1, borderColor: hexA(C.red, 0.4) }}><Body style={{ fontSize: 12, color: '#fff' }}>{err}</Body></View> : null}
        <Pressable onPress={book} disabled={!valid || bookM.isPending} accessibilityRole="button" style={{ borderRadius: 14, overflow: 'hidden', opacity: !valid || bookM.isPending ? 0.5 : 1 }}>
          <LinearGradient colors={[hexA(DOC, 0.95), '#6E5BD0']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14 }}>
            {bookM.isPending ? <ActivityIndicator color="#fff" /> : <Icon name="calPlus" size={15} color="#fff" strokeWidth={2.4} />}
            <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: '#fff' }}>{bookM.isPending ? 'Booking…' : 'Book slot'}</Text>
          </LinearGradient>
        </Pressable>
        <Body style={{ fontSize: 10.5, color: C.muted3, textAlign: 'center', lineHeight: 15 }}>The doctor's calendar is checked for overlaps; the video link is created with the booking and the client is notified.</Body>
      </View>
    </SheetShell>
  );
}

/* ---------- Reschedule ---------- */
export function RescheduleSheet({ slot, onClose, onMoved }: { slot: ConsultationSlot | null; onClose: () => void; onMoved?: () => void }) {
  const kbH = useKeyboardHeight();
  const m = useRescheduleConsultSlot();
  const [date, setDate] = React.useState('');
  const [start, setStart] = React.useState('10:00');
  const [end, setEnd] = React.useState('11:00');
  const [reason, setReason] = React.useState('');
  const [err, setErr] = React.useState<string | null>(null);
  React.useEffect(() => { if (slot) { setDate(slot.consultation_date); setStart(toHm(slot.start_time)); setEnd(toHm(slot.end_time)); setReason(''); setErr(null); } }, [slot?.id]);
  if (!slot) return <SheetShell visible={false} onClose={onClose} accent={C.gold} icon="swap" title="Reschedule"><View /></SheetShell>;
  const changed = date !== slot.consultation_date || toHms(start) !== slot.start_time || toHms(end) !== slot.end_time;
  const valid = changed && date >= ymdLocal(new Date()) && end > start;
  const moves = Array.isArray((slot as any).reschedule_history) ? (slot as any).reschedule_history.length : 0;
  const move = () => {
    if (!valid || m.isPending) return;
    setErr(null);
    m.mutate({ slotId: slot.id, date, start: toHms(start), end: toHms(end), reason: reason.trim() || null }, {
      onSuccess: () => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); onClose(); onMoved?.(); },
      onError: (e) => setErr(describeConsultError(e)),
    });
  };
  return (
    <SheetShell visible={!!slot} onClose={m.isPending ? () => {} : onClose} accent={C.gold} icon="swap" title="Reschedule the call"
      subtitle={`${slotPersonName(slot.client).toUpperCase()} WITH DR ${slotPersonName(slot.doctor).toUpperCase()}`}>
      <View style={{ gap: 16, paddingBottom: kbH }}>
        <View style={{ padding: 11, borderRadius: 12, backgroundColor: hexA(C.gold, 0.08), borderWidth: 1, borderColor: hexA(C.gold, 0.3) }}>
          <Body style={{ fontSize: 12, color: C.ink3 }}>Currently {fmtLongDate(slot.consultation_date)}, {timeLabel(slot.start_time)} to {timeLabel(slot.end_time)}. The doctor and the video link stay.{moves ? ` Moved ${moves} time${moves === 1 ? '' : 's'} before.` : ''}</Body>
        </View>
        <Field label="DAY"><DayStrip value={date} onChange={setDate} fromToday={false} /></Field>
        <Field label={`START · ${timeLabel(toHms(start))}`}><TimeGrid value={start} onChange={(t) => { setStart(t); setEnd(addMinutes(t, 60)); }} color={C.gold} /></Field>
        <Field label={`END · ${timeLabel(toHms(end))} · ${durationText(start, end)}`}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {[30, 60, 90, 120].map((n) => { const t = addMinutes(start, n); const active = t === end; return (
              <Pressable key={n} onPress={() => setEnd(t)} accessibilityRole="button" style={{ paddingVertical: 6, paddingHorizontal: 11, borderRadius: 999, backgroundColor: active ? hexA(C.gold, 0.2) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.gold, 0.6) : 'rgba(255,255,255,0.1)' }}>
                <Text style={{ fontFamily: active ? F.bodyBold : F.body, fontSize: 11.5, color: active ? '#fff' : C.muted }}>{n} min · till {timeLabel(toHms(t))}</Text>
              </Pressable>); })}
          </View>
        </Field>
        <Field label="REASON (OPTIONAL)">
          <TextInput value={reason} onChangeText={(t) => setReason(t.slice(0, 200))} placeholder="Why the call moves" placeholderTextColor={C.muted3} maxLength={200}
            style={{ padding: 12, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', color: '#fff', fontFamily: F.body, fontSize: 13.5 }} />
        </Field>
        {err ? <View style={{ padding: 11, borderRadius: 12, backgroundColor: hexA(C.red, 0.1), borderWidth: 1, borderColor: hexA(C.red, 0.4) }}><Body style={{ fontSize: 12, color: '#fff' }}>{err}</Body></View> : null}
        <Pressable onPress={move} disabled={!valid || m.isPending} accessibilityRole="button" style={{ borderRadius: 14, overflow: 'hidden', opacity: !valid || m.isPending ? 0.5 : 1 }}>
          <LinearGradient colors={['#F2C14E', '#D98B1C']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14 }}>
            {m.isPending ? <ActivityIndicator color="#1A1200" /> : <Icon name="swap" size={15} color="#1A1200" strokeWidth={2.4} />}
            <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: '#1A1200' }}>{m.isPending ? 'Moving…' : 'Move call'}</Text>
          </LinearGradient>
        </Pressable>
      </View>
    </SheetShell>
  );
}

/* ---------- the mandatory next-follow-up dialog (CRM leaving a call) ---------- */
export function NextFollowUpDialog({ slotId, clientName, onDone }: { slotId: string | null; clientName: string; onDone: () => void }) {
  const kbH = useKeyboardHeight();
  const m = useSetNextFollowUp();
  const [choice, setChoice] = React.useState<'date' | 'not_decided' | null>(null);
  const [date, setDate] = React.useState(ymdLocal(addDays(new Date(), 7)));
  const [note, setNote] = React.useState('');
  const [err, setErr] = React.useState<string | null>(null);
  React.useEffect(() => { if (slotId) { setChoice(null); setNote(''); setErr(null); setDate(ymdLocal(addDays(new Date(), 7))); } }, [slotId]);
  const save = () => {
    if (!slotId || !choice || m.isPending) return;
    m.mutate({ slotId, date: choice === 'date' ? date : null, notDecided: choice === 'not_decided', note: note.trim() || null }, {
      onSuccess: () => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); onDone(); },
      onError: (e) => setErr(describeConsultError(e)),
    });
  };
  return (
    <Modal visible={!!slotId} transparent animationType="fade" onRequestClose={() => {}}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', padding: 18 }}>
        <ReplayMask>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: kbH }}>
            <View style={{ borderRadius: 24, backgroundColor: '#12100E', borderWidth: 1, borderColor: hexA(DOC, 0.5), padding: 18, gap: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: hexA(DOC, 0.16), borderWidth: 1, borderColor: hexA(DOC, 0.45), alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="calendar" size={18} color={DOC} strokeWidth={2} />
                </View>
                <View style={{ flex: 1 }}>
                  <Serif style={{ fontSize: 19 }}>Next follow-up</Serif>
                  <Body style={{ fontSize: 11.5, color: C.muted2 }} numberOfLines={1}>{clientName} · needed before you leave</Body>
                </View>
              </View>
              {([['date', 'Pick a date', 'The client comes back on a day you choose.'], ['not_decided', 'Not decided yet', 'Waiting on something, for example the blood report.']] as const).map(([id, title, sub]) => (
                <Pressable key={id} onPress={() => setChoice(id)} accessibilityRole="button" accessibilityState={{ selected: choice === id }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 14, backgroundColor: choice === id ? hexA(DOC, 0.16) : 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: choice === id ? hexA(DOC, 0.6) : 'rgba(255,255,255,0.1)' }}>
                  <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: choice === id ? DOC : C.muted2, alignItems: 'center', justifyContent: 'center' }}>{choice === id ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: DOC }} /> : null}</View>
                  <View style={{ flex: 1 }}>
                    <Body style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{title}</Body>
                    <Body style={{ fontSize: 11, color: C.muted2 }}>{sub}</Body>
                  </View>
                </Pressable>
              ))}
              {choice === 'date' ? (
                <View style={{ gap: 8 }}>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    {[7, 14, 30].map((n) => { const v = ymdLocal(addDays(new Date(), n)); const active = v === date; return (
                      <Pressable key={n} onPress={() => setDate(v)} accessibilityRole="button" style={{ paddingVertical: 6, paddingHorizontal: 11, borderRadius: 999, backgroundColor: active ? hexA(DOC, 0.22) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(DOC, 0.65) : 'rgba(255,255,255,0.1)' }}>
                        <Text style={{ fontFamily: active ? F.bodyBold : F.body, fontSize: 11.5, color: active ? '#fff' : C.muted }}>In {n} days</Text>
                      </Pressable>); })}
                  </View>
                  <DayStrip value={date} onChange={setDate} days={60} />
                  <Mono style={{ fontSize: 9, letterSpacing: 0.8, color: DOC }}>{fmtLongDate(date).toUpperCase()}</Mono>
                </View>
              ) : null}
              <TextInput value={note} onChangeText={(t) => setNote(t.slice(0, 300))} placeholder="Note (optional), e.g. waiting for the blood report" placeholderTextColor={C.muted3} multiline maxLength={300}
                style={{ minHeight: 60, padding: 12, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', color: '#fff', fontFamily: F.body, fontSize: 13, textAlignVertical: 'top' }} />
              {err ? <Body style={{ fontSize: 12, color: C.red }}>{err}</Body> : null}
              <Pressable onPress={save} disabled={!choice || m.isPending} accessibilityRole="button" style={{ borderRadius: 14, overflow: 'hidden', opacity: !choice || m.isPending ? 0.5 : 1 }}>
                <LinearGradient colors={[hexA(DOC, 0.95), '#6E5BD0']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14 }}>
                  {m.isPending ? <ActivityIndicator color="#fff" /> : <Icon name="checks" size={15} color="#fff" strokeWidth={2.6} />}
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: '#fff' }}>Save and leave</Text>
                </LinearGradient>
              </Pressable>
              <Body style={{ fontSize: 10.5, color: C.muted3, textAlign: 'center' }}>This answer is a plan, not a booking; it shows on the Consultation Tracker.</Body>
            </View>
          </ScrollView>
        </ReplayMask>
      </View>
    </Modal>
  );
}

/* ---------- CRM home banner: follow-ups due ---------- */
export function ConsultFollowUpBanner({ crmId }: { crmId: string | null }) {
  const { go } = useStore();
  const { rows } = useConsultationFollowUpsDue(crmId);
  const enter = React.useRef(new Animated.Value(0)).current;
  const show = rows.length > 0;
  React.useEffect(() => { if (show) Animated.spring(enter, { toValue: 1, friction: 7, tension: 55, useNativeDriver: true }).start(); }, [show, enter]);
  if (!show) return null;
  const overdue = rows.filter((r) => r.status === 'overdue').length;
  const names = rows.slice(0, 3).map((r) => r.client.name.split(' ')[0]).join(', ') + (rows.length > 3 ? ` +${rows.length - 3}` : '');
  const col = overdue ? C.red : C.gold;
  return (
    <Animated.View style={{ opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }] }}>
      <Pressable onPress={() => { consultLandingRef.current = { tab: 'tracker' }; go('crm-doctor-consult'); }} accessibilityRole="button"
        style={{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: 12, borderRadius: 15, backgroundColor: hexA(col, 0.08), borderWidth: 1, borderColor: hexA(col, 0.35) }}>
        <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: hexA(col, 0.15), alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="heart" size={16} color={col} strokeWidth={2.1} />
        </View>
        <View style={{ flex: 1 }}>
          <Body style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>Doctor follow-ups due · {rows.length}</Body>
          <Body numberOfLines={1} style={{ fontSize: 11, color: C.muted2 }}>{overdue ? `${overdue} overdue · ` : ''}{names} · 30 days since the last consultation</Body>
        </View>
        <Icon name="chevRight" size={15} color={col} strokeWidth={2.3} />
      </Pressable>
    </Animated.View>
  );
}
