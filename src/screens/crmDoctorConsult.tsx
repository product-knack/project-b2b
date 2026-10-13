import React from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator, Linking, Alert } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { C, F, hexA } from '../theme';
import { Icon, IconName } from '../icons';
import { Serif, Body, Mono, Card } from '../components/primitives';
import { Page, TitleBlock, BackLink, Badge, MiniAvatar, AnimChip, HScroll } from './common';
import { useStore } from '../store';
import { useAuth } from '../auth';
import { MedicalEntrySheet } from './doctorClientDetail';
import { useClientMedicalHistory, useClientAssessments } from '../lib/crmClientDetailQueries';
import { ConsultationSlot, isSlotElapsed, fmtDayMonth, fmtLongDate, timeLabel, slotPersonName, followUpLabel, istStamp, rxState, isRxApproved } from '../lib/consultantQueries';
import {
  useConsultClients, useConsultSlotsForClients, useConsultSlots, useCrmMedicalRecord, useClientBloodReports, useAddConsultRemark, useGenerateAiSummary, useMyName,
  deriveTracker, trackerCounts, ConsultClientRow, TrackerRow, TrackerStatus,
} from '../lib/crmConsultQueries';
import {
  DOC, BLOOD, RECORD, Pill, Chip, SlotRow, useCrmSlotActions, ConsultRecordSheet, RecordTab, BookSlotSheet, RescheduleSheet, consultLandingRef,
} from '../components/consultCrmUi';
import { useNow } from '../components/consultantUi';

/* ============ CRM Doctor Consultation (6 Oct 2026) ============
   Port of hub-track /crm/doctor-consultation (Clients, Scheduled Calls, Consultation
   Tracker) and /crm/doctor-consultation/:clientId (AI summary, Medical Journey,
   Consultant Slots, CRM Remarks, Add Medical Record, Book Consultant Slot). The
   doctor's side already lives in consultantDashboard.tsx / consultantCalls.tsx. */

const initials = (name: string) => name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
const AVS: [string, string][] = [['#7C8FE8', '#9A7BEA'], ['#F47A2A', '#D95C1A'], ['#2FB7A3', '#1E8C7A'], ['#E0A53C', '#B3771C'], ['#E76A52', '#B03A2E']];
const STATUS_META: Record<TrackerStatus, { label: string; color: string }> = {
  overdue: { label: 'Overdue', color: C.red }, due: { label: 'Due today', color: C.gold }, upcoming: { label: 'Upcoming', color: C.blue }, on_track: { label: 'On track', color: C.green }, not_started: { label: 'Not started', color: C.muted2 },
};
const slotOrder = (a: ConsultationSlot, b: ConsultationSlot, now: number) => {
  const rank = (s: ConsultationSlot) => (s.status === 'scheduled' && !isSlotElapsed(s, now) ? 0 : s.status === 'scheduled' ? 1 : s.status === 'completed' ? 2 : 3);
  const ra = rank(a), rb = rank(b);
  if (ra !== rb) return ra - rb;
  const ta = Date.parse(`${a.consultation_date}T${a.start_time}`), tb = Date.parse(`${b.consultation_date}T${b.start_time}`);
  return ra === 0 ? ta - tb : tb - ta;
};

function SectionHead({ icon, color, title, right }: { icon: IconName; color: string; title: string; right?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Icon name={icon} size={13} color={color} strokeWidth={2.1} />
      <Mono style={{ flex: 1, fontSize: 9, letterSpacing: 1, color: C.mono2 }}>{title}</Mono>
      {right}
    </View>
  );
}
function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}>
      <Icon name="search" size={14} color={C.muted2} strokeWidth={2.2} />
      <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={C.muted3} autoCorrect={false} style={{ flex: 1, paddingVertical: 10, color: '#fff', fontFamily: F.body, fontSize: 13.5 }} />
      {value ? <Pressable onPress={() => onChange('')} hitSlop={10}><Icon name="close" size={13} color={C.muted2} strokeWidth={2.3} /></Pressable> : null}
    </View>
  );
}
function StatTile({ label, value, color, active, onPress, grow }: { label: string; value: number; color: string; active?: boolean; onPress?: () => void; grow?: boolean }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: !!active }} style={{ flex: grow ? 1 : undefined, minWidth: grow ? undefined : 96, padding: 11, borderRadius: 14, backgroundColor: hexA(color, active ? 0.18 : 0.07), borderWidth: 1, borderColor: hexA(color, active ? 0.6 : 0.25), gap: 2 }}>
      <Serif style={{ fontSize: 22, color }}>{value}</Serif>
      <Mono style={{ fontSize: 7.5, letterSpacing: 1, color: C.muted3 }}>{label}</Mono>
    </Pressable>
  );
}

/* ================= list page ================= */
type Tab = 'clients' | 'calls' | 'tracker';
type ClientFilter = 'all' | 'blood' | 'medical' | 'both';
type CallFilter = 'all' | 'upcoming' | 'elapsed' | 'completed';
type TrackerFilter = 'all' | 'needs' | 'upcoming' | 'on_track' | 'not_started';

export function CrmDoctorConsultation() {
  const { go, set } = useStore();
  const { session } = useAuth();
  const crmId = session?.user?.id ?? null;
  const now = useNow(60_000).getTime();
  const landing = consultLandingRef.current;
  const [tab, setTab] = React.useState<Tab>(landing?.tab ?? 'clients');
  const [bookFor, setBookFor] = React.useState<ConsultClientRow | null>(null);
  React.useEffect(() => { consultLandingRef.current = null; }, []);

  const clientsQ = useConsultClients(crmId);
  const clients = clientsQ.data ?? [];
  const slotsQ = useConsultSlotsForClients(clients.map((c) => c.id));
  const slots = slotsQ.data ?? [];
  const actions = useCrmSlotActions();

  // Clients tab
  const [cFilter, setCFilter] = React.useState<ClientFilter>('all');
  const [cSearch, setCSearch] = React.useState('');
  const withBlood = clients.filter((c) => c.bloodCount > 0).length;
  const withMedical = clients.filter((c) => c.recordCount > 0).length;
  const withBoth = clients.filter((c) => c.bloodCount > 0 && c.recordCount > 0).length;
  const clientList = clients.filter((c) => {
    if (cFilter === 'blood' && !(c.bloodCount > 0 && c.recordCount === 0)) return false;
    if (cFilter === 'medical' && !(c.recordCount > 0 && c.bloodCount === 0)) return false;
    if (cFilter === 'both' && !(c.bloodCount > 0 && c.recordCount > 0)) return false;
    const q = cSearch.trim().toLowerCase();
    return !q || c.name.toLowerCase().includes(q) || (c.email ?? '').toLowerCase().includes(q);
  });

  // Calls tab
  const [callFilter, setCallFilter] = React.useState<CallFilter>('all');
  const [record, setRecord] = React.useState<{ slot: ConsultationSlot; tab: RecordTab } | null>(null);
  const [resched, setResched] = React.useState<ConsultationSlot | null>(null);
  const callRows = [...slots].sort((a, b) => slotOrder(a, b, now)).filter((s) => {
    if (callFilter === 'upcoming') return s.status === 'scheduled' && !isSlotElapsed(s, now);
    if (callFilter === 'elapsed') return s.status === 'scheduled' && isSlotElapsed(s, now);
    if (callFilter === 'completed') return s.status === 'completed';
    return true;
  });
  const openCalls = slots.filter((s) => s.status === 'scheduled').length;

  // Tracker tab
  const [tFilter, setTFilter] = React.useState<TrackerFilter>('all');
  const [tSearch, setTSearch] = React.useState('');
  const tracker = React.useMemo(() => deriveTracker(clients, slots, now), [clients, slots, now]);
  const counts = trackerCounts(tracker);
  const trackerRows = tracker.filter((r) => {
    if (tFilter === 'needs' && !(r.status === 'overdue' || r.status === 'due')) return false;
    if (tFilter === 'upcoming' && r.status !== 'upcoming') return false;
    if (tFilter === 'on_track' && r.status !== 'on_track') return false;
    if (tFilter === 'not_started' && r.status !== 'not_started') return false;
    const q = tSearch.trim().toLowerCase();
    return !q || r.client.name.toLowerCase().includes(q);
  });
  const dueCount = counts.overdue + counts.due;

  const openClient = (c: ConsultClientRow) => { set({ selectedClientId: c.id, selectedClientName: c.name }); go('crm-doctor-consult-client'); };

  return (
    <Page gap={14} pt={6}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <TitleBlock title="Doctor Consultation" sub="Reports, records and consultant calls for your clients" />
        </View>
        <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: hexA(DOC, 0.14), borderWidth: 1, borderColor: hexA(DOC, 0.4), alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="heart" size={20} color={DOC} strokeWidth={2} />
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: 6 }}>
        {([['clients', 'Clients', clients.length], ['calls', 'Calls', openCalls], ['tracker', 'Tracker', dueCount]] as const).map(([id, label, n]) => (
          <AnimChip key={id} active={tab === id} onPress={() => setTab(id)} grow
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9, borderRadius: 12, backgroundColor: tab === id ? hexA(DOC, 0.2) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: tab === id ? hexA(DOC, 0.6) : 'rgba(255,255,255,0.1)' }}>
            <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: tab === id ? '#fff' : C.muted2 }}>{label}</Text>
            {n > 0 ? <View style={{ minWidth: 18, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 999, backgroundColor: id === 'tracker' ? hexA(counts.overdue ? C.red : C.gold, 0.9) : hexA(DOC, tab === id ? 0.9 : 0.35), alignItems: 'center' }}><Text style={{ fontFamily: F.bodyBold, fontSize: 9.5, color: '#fff' }}>{n}</Text></View> : null}
          </AnimChip>
        ))}
      </View>

      {clientsQ.isPending ? <ActivityIndicator color={DOC} style={{ paddingVertical: 30 }} /> : clientsQ.isError ? (
        <Body style={{ fontSize: 12.5, color: C.red, textAlign: 'center', paddingVertical: 20 }}>{(clientsQ.error as Error).message}</Body>
      ) : tab === 'clients' ? (
        <>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <StatTile grow label="TOTAL" value={clients.length} color={DOC} active={cFilter === 'all'} onPress={() => setCFilter('all')} />
            <StatTile grow label="BLOOD ONLY" value={clients.filter((c) => c.bloodCount > 0 && c.recordCount === 0).length} color={BLOOD} active={cFilter === 'blood'} onPress={() => setCFilter('blood')} />
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <StatTile grow label="RECORDS ONLY" value={clients.filter((c) => c.recordCount > 0 && c.bloodCount === 0).length} color={RECORD} active={cFilter === 'medical'} onPress={() => setCFilter('medical')} />
            <StatTile grow label="BOTH" value={withBoth} color={C.green} active={cFilter === 'both'} onPress={() => setCFilter('both')} />
          </View>
          <SearchInput value={cSearch} onChange={setCSearch} placeholder="Search by name or email" />
          <Mono style={{ fontSize: 8.5, letterSpacing: 0.8, color: C.muted3 }}>{clientList.length} CLIENT{clientList.length === 1 ? '' : 'S'} · {withBlood} WITH BLOOD REPORTS · {withMedical} WITH RECORDS</Mono>
          {clientList.length === 0 ? <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 24 }}>No clients in this view.</Body> : clientList.map((c, i) => (
            <Pressable key={c.id} onPress={() => openClient(c)} accessibilityRole="button" style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
              <Card radius={18} style={{ padding: 13, gap: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <MiniAvatar initial={initials(c.name)} colors={AVS[i % AVS.length]} size={42} />
                  <View style={{ flex: 1 }}>
                    <Body numberOfLines={1} style={{ fontSize: 15, fontFamily: F.bodySemi, color: '#fff' }}>{c.name}</Body>
                    <Body numberOfLines={1} style={{ fontSize: 11, color: C.muted2 }}>{c.email ?? c.phone ?? 'No contact on file'}</Body>
                  </View>
                  <Icon name="chevRight" size={15} color={C.muted} strokeWidth={2.2} />
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  <Badge text={(c.status ?? 'active') === 'active' ? 'Active' : String(c.status)} color={(c.status ?? 'active') === 'active' ? C.green : C.muted2} />
                  {c.subscription ? <Badge text={c.subscription} color={C.gold} /> : null}
                  <Badge text={`${c.bloodCount} blood`} color={c.bloodCount ? BLOOD : C.muted2} />
                  <Badge text={`${c.recordCount} record${c.recordCount === 1 ? '' : 's'}`} color={c.recordCount ? RECORD : C.muted2} />
                  <Badge text={`${c.noteCount} note${c.noteCount === 1 ? '' : 's'}`} color={c.noteCount ? DOC : C.muted2} />
                </View>
              </Card>
            </Pressable>
          ))}
        </>
      ) : tab === 'calls' ? (
        <>
          <HScroll gap={6}>
            {([['all', 'All'], ['upcoming', 'Upcoming'], ['elapsed', 'Elapsed'], ['completed', 'Completed']] as const).map(([id, label]) => (
              <Pressable key={id} onPress={() => setCallFilter(id)} accessibilityRole="button" style={{ paddingVertical: 7, paddingHorizontal: 13, borderRadius: 999, backgroundColor: callFilter === id ? hexA(DOC, 0.2) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: callFilter === id ? hexA(DOC, 0.6) : 'rgba(255,255,255,0.1)' }}>
                <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: callFilter === id ? '#fff' : C.muted2 }}>{label}</Text>
              </Pressable>
            ))}
          </HScroll>
          {slotsQ.isPending && clients.length ? <ActivityIndicator color={DOC} style={{ paddingVertical: 20 }} /> : callRows.length === 0 ? (
            <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 24 }}>No consultant calls {callFilter === 'all' ? 'booked for your clients yet' : 'in this view'}.</Body>
          ) : callRows.map((s) => (
            <SlotRow key={s.id} slot={s} now={now} showClient actions={actions} onRecord={(slot, t) => setRecord({ slot, tab: t })} onReschedule={setResched} onApprove={(slot) => setRecord({ slot, tab: 'rx' })} />
          ))}
        </>
      ) : (
        <>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <StatTile grow label="OVERDUE" value={counts.overdue} color={C.red} active={tFilter === 'needs' && counts.overdue > 0} onPress={() => setTFilter('needs')} />
            <StatTile grow label="DUE TODAY" value={counts.due} color={C.gold} active={tFilter === 'needs' && counts.overdue === 0} onPress={() => setTFilter('needs')} />
            <StatTile grow label="UPCOMING" value={counts.upcoming} color={C.blue} active={tFilter === 'upcoming'} onPress={() => setTFilter('upcoming')} />
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <StatTile grow label="ON TRACK" value={counts.onTrack} color={C.green} active={tFilter === 'on_track'} onPress={() => setTFilter('on_track')} />
            <StatTile grow label="NOT STARTED" value={counts.notStarted} color={C.muted2} active={tFilter === 'not_started'} onPress={() => setTFilter('not_started')} />
            <StatTile grow label="CLIENTS" value={counts.clients} color={DOC} active={tFilter === 'all'} onPress={() => setTFilter('all')} />
          </View>
          {dueCount > 0 ? (
            <Pressable onPress={() => setTFilter('needs')} style={{ flexDirection: 'row', alignItems: 'center', gap: 9, padding: 11, borderRadius: 13, backgroundColor: hexA(C.gold, 0.08), borderWidth: 1, borderColor: hexA(C.gold, 0.35) }}>
              <Icon name="alert" size={14} color={C.gold} strokeWidth={2.2} />
              <Body style={{ flex: 1, fontSize: 12, color: '#fff' }}>{dueCount} client{dueCount === 1 ? ' is' : 's are'} past the 30-day mark with no follow-up booked.</Body>
              <Mono style={{ fontSize: 8.5, letterSpacing: 0.8, color: C.gold }}>SHOW</Mono>
            </Pressable>
          ) : null}
          <SearchInput value={tSearch} onChange={setTSearch} placeholder="Search a client" />
          {slotsQ.isPending && clients.length ? <ActivityIndicator color={DOC} style={{ paddingVertical: 20 }} /> : trackerRows.length === 0 ? (
            <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 24 }}>No clients in this view.</Body>
          ) : trackerRows.map((r, i) => <TrackerCard key={r.client.id} row={r} index={i} onOpen={() => openClient(r.client)} onBook={() => setBookFor(r.client)} />)}
        </>
      )}

      <ConsultRecordSheet slot={record?.slot ?? null} initialTab={record?.tab ?? 'rx'} onClose={() => setRecord(null)} />
      <RescheduleSheet slot={resched} onClose={() => setResched(null)} />
      <BookSlotSheet visible={!!bookFor} onClose={() => setBookFor(null)} clientId={bookFor?.id ?? null} clientName={bookFor?.name ?? ''} bookedBy={crmId}
        onBooked={(r) => Alert.alert('Slot booked', r.linkCreated ? 'The video link is ready and the client has been told.' : 'Booked, but the video link could not be created yet. Use Generate link on the call.')} />
    </Page>
  );
}

function TrackerCard({ row, index, onOpen, onBook }: { row: TrackerRow; index: number; onOpen: () => void; onBook: () => void }) {
  const meta = STATUS_META[row.status];
  const slotLine = (s: ConsultationSlot | null) => (s ? `${fmtDayMonth(s.consultation_date)} · ${timeLabel(s.start_time)} · Dr ${slotPersonName(s.doctor)}${s.status === 'scheduled' ? ' · not marked complete' : ''}` : 'None');
  const dueText = row.status === 'overdue' ? `Overdue by ${row.daysOver} day${row.daysOver === 1 ? '' : 's'}` : row.status === 'due' ? 'Due today' : row.status === 'on_track' && row.dueDate ? `Due ${fmtDayMonth(row.dueDate)} · ${-row.daysOver} day${row.daysOver === -1 ? '' : 's'} left` : null;
  return (
    <Card radius={18} border={hexA(meta.color, 0.35)} style={{ padding: 13, gap: 9 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <MiniAvatar initial={initials(row.client.name)} colors={AVS[index % AVS.length]} size={36} />
        <View style={{ flex: 1 }}>
          <Body numberOfLines={1} style={{ fontSize: 14.5, fontFamily: F.bodySemi, color: '#fff' }}>{row.client.name}</Body>
          {row.client.subscription ? <Body style={{ fontSize: 10.5, color: C.muted2 }}>{row.client.subscription}</Body> : null}
        </View>
        <Pill text={meta.label.toUpperCase()} color={meta.color} />
      </View>
      <View style={{ gap: 4 }}>
        {([['FIRST', slotLine(row.first)], ['HELD', String(row.held)], ['LAST', slotLine(row.last)], ['NEXT', row.next ? slotLine(row.next) : row.plannedFollowUp ? `Not booked · CRM plan: ${followUpLabel(row.plannedFollowUp)}` : 'Not booked']] as const).map(([k, v]) => (
          <View key={k} style={{ flexDirection: 'row', gap: 8 }}>
            <Mono style={{ width: 44, fontSize: 8, letterSpacing: 0.8, color: C.muted3, marginTop: 2 }}>{k}</Mono>
            <Body style={{ flex: 1, fontSize: 11.5, color: v === 'None' || v.startsWith('Not booked') ? C.muted2 : C.ink3 }}>{v}</Body>
          </View>
        ))}
        {dueText ? <Mono style={{ fontSize: 8.5, letterSpacing: 0.6, color: meta.color }}>{dueText.toUpperCase()}</Mono> : null}
      </View>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {row.status !== 'upcoming' ? <Chip label={row.held ? 'Book follow-up' : 'Book first'} icon="calPlus" color={meta.color === C.muted2 ? DOC : meta.color} filled={row.status === 'overdue' || row.status === 'due'} onPress={onBook} /> : null}
        <Chip label="Open" icon="chevRight" color={C.ink3} onPress={onOpen} />
      </View>
    </Card>
  );
}

/* ================= client page ================= */
type JourneyItem = { id: string; kind: 'blood' | 'record' | 'qhp'; date: string | null; title: string; sub: string | null; url: string | null; detail?: string | null };

export function CrmDoctorConsultClient() {
  const { go, back, canGoBack, selectedClientId, selectedClientName } = useStore();
  const { session } = useAuth();
  const crmId = session?.user?.id ?? null;
  const clientId = selectedClientId;
  const name = selectedClientName ?? 'Client';
  const now = useNow(60_000).getTime();
  const myNameQ = useMyName(crmId);
  const clientsQ = useConsultClients(crmId);
  const client = (clientsQ.data ?? []).find((c) => c.id === clientId) ?? null;
  const recQ = useCrmMedicalRecord(clientId);
  const bloodQ = useClientBloodReports(clientId);
  const histQ = useClientMedicalHistory(clientId);
  const qhpQ = useClientAssessments(clientId);
  const slotsQ = useConsultSlots(clientId);
  const actions = useCrmSlotActions();
  const aiM = useGenerateAiSummary();
  const remarkM = useAddConsultRemark();
  const [remark, setRemark] = React.useState('');
  const [addOpen, setAddOpen] = React.useState(false);
  const [bookOpen, setBookOpen] = React.useState(false);
  const [record, setRecord] = React.useState<{ slot: ConsultationSlot; tab: RecordTab } | null>(null);
  const [resched, setResched] = React.useState<ConsultationSlot | null>(null);
  const [openItem, setOpenItem] = React.useState<string | null>(null);

  const journey: JourneyItem[] = React.useMemo(() => {
    const items: JourneyItem[] = [];
    (bloodQ.data ?? []).forEach((r) => items.push({ id: `b-${r.id}`, kind: 'blood', date: r.date, title: r.name, sub: [r.type, r.metabolic != null ? `Metabolic ${r.metabolic}` : null, r.longevity != null ? `Longevity ${r.longevity}` : null].filter(Boolean).join(' · ') || null, url: r.fileUrl }));
    ((histQ.data ?? []) as any[]).forEach((h) => items.push({ id: `r-${h.id}`, kind: 'record', date: h.event_date ? String(h.event_date).slice(0, 10) : (h.created_at ? String(h.created_at).slice(0, 10) : null), title: h.title || h.category || 'Medical record', sub: [h.category, h.severity, h.is_ongoing ? 'ongoing' : null].filter(Boolean).join(' · ') || null, url: Array.isArray(h.attachments) && h.attachments[0] ? (typeof h.attachments[0] === 'string' ? h.attachments[0] : h.attachments[0]?.url ?? null) : null, detail: [h.description, h.diagnosis ? `Diagnosis: ${h.diagnosis}` : null, h.treatment_given ? `Treatment: ${h.treatment_given}` : null, h.medicines_taken ? `Medicines: ${h.medicines_taken}` : null, h.hospital_name ? `Hospital: ${h.hospital_name}` : null, h.treating_doctor ? `Doctor: ${h.treating_doctor}` : null].filter(Boolean).join('\n') || null }));
    (qhpQ.data ?? []).forEach((a) => items.push({ id: `q-${a.id}`, kind: 'qhp', date: a.date, title: a.label, sub: [a.coachName ? `by ${a.coachName}` : null, ...a.metrics].filter(Boolean).join(' · ') || null, url: null }));
    return items.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  }, [bloodQ.data, histQ.data, qhpQ.data]);
  const slots = [...(slotsQ.data ?? [])].sort((a, b) => slotOrder(a, b, now));
  const ai = recQ.data?.ai_summary ?? null;

  const generate = (force: boolean) => {
    if (!clientId || aiM.isPending) return;
    aiM.mutate({ clientId, force }, { onSuccess: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}), onError: (e) => Alert.alert('Summary not generated', (e as Error).message) });
  };
  const addRemark = () => {
    if (!clientId || !crmId || !remark.trim() || remarkM.isPending) return;
    remarkM.mutate({ clientId, text: remark, by: crmId, byName: myNameQ.data ?? 'CRM' }, { onSuccess: () => setRemark(''), onError: (e) => Alert.alert("Couldn't save the remark", (e as Error).message) });
  };
  const kindMeta = { blood: { color: BLOOD, icon: 'activity' as IconName, label: 'BLOOD REPORT' }, record: { color: RECORD, icon: 'file' as IconName, label: 'MEDICAL RECORD' }, qhp: { color: DOC, icon: 'heart' as IconName, label: 'QHP' } };

  return (
    <Page gap={16}>
      <BackLink label="Doctor Consultation" onPress={() => (canGoBack ? back() : go('crm-doctor-consult'))} />
      <Card colors={['rgba(44,30,66,0.5)', 'rgba(18,14,22,0.55)']} border={hexA(DOC, 0.3)} radius={19} style={{ padding: 15, gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <MiniAvatar initial={initials(name)} colors={AVS[0]} size={46} />
          <View style={{ flex: 1 }}>
            <Serif style={{ fontSize: 21 }}>{name}</Serif>
            <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 2 }} numberOfLines={1}>{client?.email ?? client?.phone ?? 'Client'}{client?.subscription ? ` · ${client.subscription}` : ''}</Body>
          </View>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          <Badge text={`${bloodQ.data?.length ?? client?.bloodCount ?? 0} blood reports`} color={BLOOD} />
          <Badge text={`${histQ.data?.length ?? client?.recordCount ?? 0} medical records`} color={RECORD} />
          <Badge text={`${qhpQ.data?.length ?? 0} QHP`} color={DOC} />
          <Badge text={`${slots.length} consultation${slots.length === 1 ? '' : 's'}`} color={C.blue} />
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable onPress={() => setAddOpen(true)} accessibilityRole="button" style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11, borderRadius: 12, backgroundColor: hexA(RECORD, 0.12), borderWidth: 1, borderColor: hexA(RECORD, 0.45) }}>
            <Icon name="plus" size={13} color={RECORD} strokeWidth={2.6} />
            <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: RECORD }}>Medical record</Text>
          </Pressable>
          <Pressable onPress={() => setBookOpen(true)} accessibilityRole="button" style={{ flex: 1.2, borderRadius: 12, overflow: 'hidden' }}>
            <LinearGradient colors={[hexA(DOC, 0.95), '#6E5BD0']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11 }}>
              <Icon name="calPlus" size={13} color="#fff" strokeWidth={2.4} />
              <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: '#fff' }}>Book consultant slot</Text>
            </LinearGradient>
          </Pressable>
        </View>
      </Card>

      {/* AI summary */}
      <SectionHead icon="sparkle" color={DOC} title="AI SUMMARY" right={ai?.generated_at ? <Mono style={{ fontSize: 8, color: C.muted3 }}>{(istStamp(ai.generated_at) ?? '').toUpperCase()}</Mono> : null} />
      <Card radius={18} border={hexA(DOC, 0.3)} style={{ padding: 14, gap: 12 }}>
        {recQ.isPending ? <ActivityIndicator color={DOC} /> : ai ? (
          <View style={{ gap: 12 }}>
            {ai.overview ? <Body style={{ fontSize: 13, color: '#fff', lineHeight: 19 }}>{ai.overview}</Body> : null}
            {([['BLOOD REPORT FINDINGS', ai.blood_key_points, BLOOD], ['MEDICAL HISTORY POINTS', ai.medical_key_points, RECORD], ['CONCERNS', ai.concerns, C.red], ['RECOMMENDATIONS', ai.recommendations, C.green]] as const).map(([title, items, color]) => (items && items.length ? (
              <View key={title} style={{ gap: 5, paddingLeft: 10, borderLeftWidth: 2, borderLeftColor: hexA(color, 0.6) }}>
                <Mono style={{ fontSize: 8.5, letterSpacing: 1, color }}>{title} · {items.length}</Mono>
                {items.map((t, i) => <Body key={i} style={{ fontSize: 12.5, color: C.ink3, lineHeight: 18 }}>• {t}</Body>)}
              </View>
            ) : null))}
          </View>
        ) : (
          <Body style={{ fontSize: 12.5, color: C.muted2, lineHeight: 18 }}>No summary yet. Generate one from the client's blood reports and medical records (Gemini, about 15 seconds).</Body>
        )}
        <Pressable onPress={() => generate(!!ai)} disabled={aiM.isPending} accessibilityRole="button" style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 13, borderRadius: 999, backgroundColor: hexA(DOC, 0.16), borderWidth: 1, borderColor: hexA(DOC, 0.5), opacity: aiM.isPending ? 0.6 : 1 }}>
          {aiM.isPending ? <ActivityIndicator size="small" color={DOC} /> : <Icon name="sparkle" size={12} color={DOC} strokeWidth={2.3} />}
          <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: DOC }}>{aiM.isPending ? 'Generating…' : ai ? 'Regenerate summary' : 'Generate summary'}</Text>
        </Pressable>
      </Card>

      {/* Medical journey */}
      <SectionHead icon="layers" color={BLOOD} title="MEDICAL JOURNEY" right={<Mono style={{ fontSize: 9, color: C.muted3 }}>{journey.length}</Mono>} />
      {bloodQ.isPending || histQ.isPending || qhpQ.isPending ? <ActivityIndicator color={BLOOD} /> : journey.length === 0 ? (
        <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 14 }}>No blood reports, records or QHPs yet.</Body>
      ) : (
        <View style={{ gap: 8 }}>
          {journey.map((it) => {
            const m = kindMeta[it.kind];
            const open = openItem === it.id;
            return (
              <Pressable key={it.id} onPress={() => { if (it.detail) setOpenItem(open ? null : it.id); else if (it.url) Linking.openURL(it.url).catch(() => {}); }} accessibilityRole="button"
                style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: hexA(m.color, 0.25), borderLeftWidth: 3, borderLeftColor: m.color }}>
                <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: hexA(m.color, 0.13), alignItems: 'center', justifyContent: 'center' }}><Icon name={m.icon} size={14} color={m.color} strokeWidth={2.2} /></View>
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Mono style={{ fontSize: 7.5, letterSpacing: 0.8, color: m.color }}>{m.label}</Mono>
                    <Mono style={{ fontSize: 7.5, letterSpacing: 0.5, color: C.muted3 }}>{it.date ? fmtLongDate(it.date).toUpperCase() : 'UNDATED'}</Mono>
                  </View>
                  <Body style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{it.title}</Body>
                  {it.sub ? <Body style={{ fontSize: 11, color: C.muted2 }}>{it.sub}</Body> : null}
                  {open && it.detail ? <Body style={{ fontSize: 12, color: C.ink3, lineHeight: 17, marginTop: 4 }}>{it.detail}</Body> : null}
                  {open && it.url ? <Pressable onPress={() => Linking.openURL(it.url!).catch(() => {})} hitSlop={8} style={{ marginTop: 6, alignSelf: 'flex-start' }}><Mono style={{ fontSize: 8.5, letterSpacing: 0.8, color: m.color }}>OPEN ATTACHMENT</Mono></Pressable> : null}
                </View>
                {it.url && !it.detail ? <Icon name="arrowRight" size={13} color={C.muted2} strokeWidth={2.2} /> : it.detail ? <Icon name={open ? 'chevUp' : 'chevDown'} size={13} color={C.muted2} strokeWidth={2.2} /> : null}
              </Pressable>
            );
          })}
        </View>
      )}

      {/* Consultant slots */}
      <SectionHead icon="calendar" color={C.blue} title="CONSULTANT SLOTS" right={<Mono style={{ fontSize: 9, color: C.muted3 }}>{slots.length}</Mono>} />
      {slotsQ.isPending ? <ActivityIndicator color={C.blue} /> : slots.length === 0 ? (
        <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 14 }}>No consultant slot booked yet.</Body>
      ) : slots.map((s) => <SlotRow key={s.id} slot={s} now={now} actions={actions} canCancel onRecord={(slot, t) => setRecord({ slot, tab: t })} onReschedule={setResched} onApprove={(slot) => setRecord({ slot, tab: 'rx' })} />)}

      {/* CRM remarks */}
      <SectionHead icon="chat" color={C.gold} title="CRM REMARKS" right={<Mono style={{ fontSize: 9, color: C.muted3 }}>{recQ.data?.remarks.length ?? 0}</Mono>} />
      <Card radius={18} border={hexA(C.gold, 0.25)} style={{ padding: 13, gap: 10 }}>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
          <TextInput value={remark} onChangeText={setRemark} placeholder="Add a remark for the doctor" placeholderTextColor={C.muted3} multiline maxLength={1000}
            style={{ flex: 1, minHeight: 44, maxHeight: 120, padding: 11, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', color: '#fff', fontFamily: F.body, fontSize: 13, textAlignVertical: 'top' }} />
          <Pressable onPress={addRemark} disabled={!remark.trim() || remarkM.isPending} accessibilityRole="button" style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: hexA(C.gold, remark.trim() ? 0.9 : 0.2), alignItems: 'center', justifyContent: 'center' }}>
            {remarkM.isPending ? <ActivityIndicator size="small" color="#1A1200" /> : <Icon name="send" size={15} color={remark.trim() ? '#1A1200' : C.muted2} strokeWidth={2.4} />}
          </Pressable>
        </View>
        {!recQ.data && !recQ.isPending ? <Body style={{ fontSize: 11, color: C.muted3 }}>This client has no CRM record row yet (it appears once a CRM is actively assigned); the first remark creates it.</Body> : null}
        {(recQ.data?.remarks ?? []).slice().reverse().map((r) => (
          <View key={r.id} style={{ gap: 2, paddingTop: 8, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' }}>
            <Body style={{ fontSize: 12.5, color: '#fff', lineHeight: 18 }}>{r.text}</Body>
            <Mono style={{ fontSize: 8, letterSpacing: 0.5, color: C.muted3 }}>{(r.by_name ?? 'CRM').toUpperCase()} · {(istStamp(r.at) ?? '').toUpperCase()}</Mono>
          </View>
        ))}
      </Card>

      {clientId && crmId ? <MedicalEntrySheet visible={addOpen} onClose={() => { setAddOpen(false); histQ.refetch(); recQ.refetch(); }} clientId={clientId} doctorId={crmId} /> : null}
      <BookSlotSheet visible={bookOpen} onClose={() => setBookOpen(false)} clientId={clientId} clientName={name} bookedBy={crmId}
        onBooked={(r) => Alert.alert('Slot booked', r.linkCreated ? 'The video link is ready and the client has been told.' : 'Booked, but the video link could not be created yet. Use Generate link on the call.')} />
      <ConsultRecordSheet slot={record?.slot ?? null} initialTab={record?.tab ?? 'rx'} onClose={() => setRecord(null)} />
      <RescheduleSheet slot={resched} onClose={() => setResched(null)} />
    </Page>
  );
}
