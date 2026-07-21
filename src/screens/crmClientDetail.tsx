import React from 'react';
import { View, Text, Pressable, TextInput, Alert, ActivityIndicator, Linking, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C, F, hexA, ORANGE_GRAD } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono, Card, ProgressBar } from '../components/primitives';
import { Page, BackLink, Badge, MiniAvatar, HScroll, AnimChip } from './common';
import { useStore } from '../store';
import { useAuth } from '../auth';
import {
  useCrmClientDetail, usePackageCycle, useCrmClientSessions, useTrainingFrequency, useClientWorkoutLog,
  useClientComms, useLogCommunication, useMarkCommDone, useSetClientStatus,
  COMM_CATEGORIES, COMM_STATUSES, COMM_MEDIUMS, FREQ_PERIODS, FreqPeriod, SessionCategory,
} from '../lib/crmClientQueries';
import {
  useClientWhoop, useClientHeartMath, useClientNutritionMonth,
  useClientMedicalHistory, useClientDiagnoses, useBookConsultation, useClientAssessments,
  useClientRemarks, useAddRemark, useClientStatements, useAddStatement, useClientTickets,
  useClientBio, useSaveBio, BIO_SELECTS,
  useActivePause, usePauseJourney, useResumeJourney,
  useDiscontinuationRequests, useRequestDiscontinuation, DISCONTINUE_REASONS,
  useCreateCrmTask, TASK_PRIORITIES, TASK_CATEGORIES,
  useStaffDirectory, useClientAssignments, useToggleAssignment,
  useClientCredentials, useTenDayInsight, useUpcomingRoster,
} from '../lib/crmClientDetailQueries';
import { useClientReports, useClientGoals, useClientBioAge, useClientProgression } from '../lib/clientQueries';
import { useCrmProfile } from '../lib/crmQueries';
import { BloodReportSheet, QhpReportSheet, SheetShell } from './reportDetail';
import { AreaLine } from './trainer';
import { JOURNEY_CATEGORIES, useToggleJourneyStep } from '../lib/journeyQueries';
import { CreateRosterSheet } from './crmRoster';
import { ServicesButton } from '../components/servicesButton';
import { useRosterPeople } from '../lib/rosterQueries';
import * as Clipboard from 'expo-clipboard';

/* ============ CRM Client Detail — full web-parity page: 11 tabs + action rail.
   Mirrors CRMClientDetails.tsx (old app) restyled for obsidian/ember. ============ */

const istD = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const istDT = (iso: string | null) => (iso ? `${new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' })} · ${new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase()}` : '—');
const initials = (n: string) => n.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
const AVS: [string, string][] = [['#F0883E', '#C05621'], ['#4FD1C5', '#2C7A7B'], ['#B794F4', '#6B46C1'], ['#F687B3', '#B83280'], ['#68D391', '#276749'], ['#63B3ED', '#2B6CB0']];
const pretty = (t: string | null) => (t || '—').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const INPUT = {
  paddingVertical: 9, paddingHorizontal: 11, borderRadius: 11,
  borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', backgroundColor: 'rgba(0,0,0,0.25)',
  color: '#fff', fontFamily: F.body, fontSize: 13.5,
} as const;

function Field({ label, value }: { label: string; value: any }) {
  const v = value == null || value === '' ? null : String(value);
  if (!v) return null;
  return (
    <View style={{ width: '47%', flexGrow: 1 }}>
      <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.muted3, textTransform: 'uppercase' }}>{label}</Mono>
      <Body style={{ fontSize: 13.5, color: '#fff', marginTop: 2 }}>{v}</Body>
    </View>
  );
}
function ChipRow({ items, sel, onSel, color = C.orange }: { items: readonly string[] | string[]; sel: string; onSel: (v: string) => void; color?: string }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {items.map((it) => {
        const active = sel === it;
        return (
          <AnimChip key={it} active={active} onPress={() => onSel(it)} style={{ paddingVertical: 7, paddingHorizontal: 11, borderRadius: 999, backgroundColor: active ? hexA(color, 0.14) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(color, 0.45) : 'rgba(255,255,255,0.09)' }}>
            <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 11, color: active ? color : C.muted }}>{pretty(it)}</Text>
          </AnimChip>
        );
      })}
    </View>
  );
}
function GradientBtn({ label, onPress, disabled, busy }: { label: string; onPress: () => void; disabled?: boolean; busy?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled || busy} style={{ opacity: disabled || busy ? 0.5 : 1 }}>
      <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ alignItems: 'center', paddingVertical: 12, borderRadius: 12 }}>
        <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: '#fff' }}>{busy ? 'Working…' : label}</Text>
      </LinearGradient>
    </Pressable>
  );
}
function TabCard({ children, accent = C.orange }: { children: React.ReactNode; accent?: string }) {
  return (
    <Card colors={['rgba(46,28,18,0.4)', 'rgba(16,12,11,0.55)']} border={hexA(accent, 0.13)} radius={18} style={{ overflow: 'hidden' }}>
      <LinearGradient colors={[hexA(accent, 0.55), 'rgba(255,255,255,0.02)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 2.5 }} />
      <View style={{ padding: 14, gap: 10 }}>{children}</View>
    </Card>
  );
}

/* Consistent section header used inside cards: tinted icon chip + title + right meta. */
function SectionHead({ icon, color, title, meta }: { icon: string; color: string; title: string; meta?: string | null }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
      <View style={{ width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: hexA(color, 0.12), borderWidth: 1, borderColor: hexA(color, 0.28) }}>
        <Icon name={icon as any} size={15} color={color} strokeWidth={2.1} />
      </View>
      <Body style={{ flex: 1, fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{title}</Body>
      {meta ? <Mono style={{ fontSize: 9, color: C.muted3 }}>{meta}</Mono> : null}
    </View>
  );
}
function Empty({ text }: { text: string }) {
  return <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 14 }}>{text}</Body>;
}
function Metric({ label, value, unit, color }: { label: string; value: any; unit?: string; color: string }) {
  // Only render primitives — live JSON fields can carry '' or nested objects.
  const v = value == null || value === '' || (typeof value !== 'string' && typeof value !== 'number') ? null : String(value);
  return (
    <View style={{ flexGrow: 1, minWidth: '29%', padding: 11, borderRadius: 13, backgroundColor: hexA(color, 0.06), borderWidth: 1, borderColor: hexA(color, 0.22), gap: 3 }}>
      <Mono style={{ fontSize: 8, letterSpacing: 0.6, color: C.muted3, textTransform: 'uppercase' }}>{label}</Mono>
      <Text style={{ fontFamily: F.bodyBold, fontSize: 17, color: v == null ? C.muted3 : color }}>
        {v == null ? '—' : v}{v != null && unit ? <Text style={{ fontSize: 10.5, color: C.muted2 }}> {unit}</Text> : null}
      </Text>
    </View>
  );
}

/* Any render error inside a tab shows a friendly card instead of killing the app. */
class TabErrorBoundary extends React.Component<{ resetKey: string; children: React.ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: any) { return { error: e?.message ?? 'Something went wrong' }; }
  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  render() {
    if (this.state.error) {
      return (
        <TabCard>
          <View style={{ alignItems: 'center', gap: 8, paddingVertical: 14 }}>
            <Icon name="alert" size={22} color={C.red} strokeWidth={2} />
            <Body style={{ fontSize: 13, color: C.ink3, textAlign: 'center' }}>This section hit a snag rendering its data.</Body>
            <Mono style={{ fontSize: 9, color: C.muted3, textAlign: 'center' }}>{this.state.error}</Mono>
            <Pressable onPress={() => this.setState({ error: null })} style={{ paddingVertical: 8, paddingHorizontal: 16, borderRadius: 999, backgroundColor: hexA(C.orange, 0.14), borderWidth: 1, borderColor: hexA(C.orange, 0.4) }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: C.orange }}>Retry</Text>
            </Pressable>
          </View>
        </TabCard>
      );
    }
    return this.props.children as any;
  }
}

/* ============================== TABS ============================== */
const TABS = [
  ['sessions', 'Sessions', 'dumbbell'], ['comms', 'Comms', 'phone'], ['progression', 'Progression', 'chart'],
  ['health', 'Health', 'activity'], ['reports', 'Reports', 'file'], ['qhp', 'QHP', 'heart'],
  ['goals', 'Goals', 'target'], ['medical', 'Medical History', 'clipboard'],
  ['diagnoses', 'Diagnoses', 'shield'], ['notes', 'Notes', 'bubble'],
] as const;
type TabId = typeof TABS[number][0];

/* ============================== ACTIONS ============================== */
type SheetId = 'roster' | 'roster-create' | 'task' | 'consult' | 'bio' | 'creds' | 'assign' | 'insight' | 'pause' | 'discontinue';

export function CrmClientDetail() {
  const { selectedClientId: clientId, selectedClientName, back, canGoBack, go, clientInitialTab, set } = useStore();
  const { session } = useAuth();
  const crmId = session?.user?.id ?? null;
  const profileQ = useCrmProfile(crmId);
  const detailQ = useCrmClientDetail(clientId);
  const pkgQ = usePackageCycle(clientId);
  const pauseQ = useActivePause(clientId);
  const statusM = useSetClientStatus();
  const rosterPeopleQ = useRosterPeople(crmId);

  // Deep-link: workspace rows (e.g. "No Comms 7d+") can land directly on a tab.
  const initialTab = TABS.some(([id]) => id === clientInitialTab) ? (clientInitialTab as TabId) : 'sessions';
  const [tab, setTab] = React.useState<TabId>(initialTab);
  React.useEffect(() => { if (clientInitialTab) set({ clientInitialTab: null }); }, []);
  const pageRef = React.useRef<any>(null);
  const recordY = React.useRef(0); // Y of the tab bar + content section within the page
  // Jump to a given tab and scroll it into view (used by quick actions like Call Log).
  const goToTab = (id: TabId) => {
    setTab(id);
    requestAnimationFrame(() => pageRef.current?.scrollTo({ y: Math.max(recordY.current - 12, 0), animated: true }));
  };
  const [sheet, setSheet] = React.useState<SheetId | null>(null);
  const [inactivating, setInactivating] = React.useState(false);
  const [inactiveReason, setInactiveReason] = React.useState('');
  const [commFormOpen, setCommFormOpen] = React.useState(false);
  const [journeyOpen, setJourneyOpen] = React.useState(false);
  const journeyToggleM = useToggleJourneyStep();
  const [detailsOpen, setDetailsOpen] = React.useState(false);

  const d = detailQ.data;
  const client = d?.client;
  const name = selectedClientName ?? (client ? `${client.first_name ?? ''} ${client.last_name ?? ''}`.trim() : 'Client');
  const isActive = (client?.status ?? 'active') === 'active';
  const pkg = pkgQ.data;
  const activePause = pauseQ.data;

  const toggleStatus = () => {
    if (!client || !crmId) return;
    if (isActive) { setInactivating(true); return; }
    Alert.alert('Reactivate client?', `${name} will be marked active again.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Mark Active', onPress: () => statusM.mutate({ clientId: client.id, crmId, toStatus: 'active', crmName: profileQ.data?.firstName }) },
    ]);
  };
  const confirmInactive = () => {
    if (!client || !crmId || !inactiveReason.trim()) return;
    statusM.mutate({ clientId: client.id, crmId, toStatus: 'inactive', reason: inactiveReason.trim(), crmName: profileQ.data?.firstName });
    setInactivating(false);
    setInactiveReason('');
  };
  const callClient = () => {
    if (!client?.phone) { Alert.alert('No phone number', 'This client has no phone number on file.'); return; }
    Linking.openURL(`tel:${String(client.phone).replace(/\s+/g, '')}`).catch(() => Alert.alert("Couldn't open dialer"));
  };

  const ACTIONS: { id: string; label: string; icon: string; color: string; onPress: () => void }[] = [
    { id: 'call', label: 'Call', icon: 'phone', color: C.green, onPress: callClient },
    { id: 'log', label: 'Call Log', icon: 'bubble', color: C.orange, onPress: () => { goToTab('comms'); setCommFormOpen(true); } },
    { id: 'pause', label: activePause ? 'Resume' : 'Pause', icon: 'clock', color: C.purple, onPress: () => setSheet('pause') },
    { id: 'roster', label: 'Roster', icon: 'calendar', color: C.gold, onPress: () => setSheet('roster') },
    { id: 'task', label: 'Task', icon: 'checks', color: C.blue, onPress: () => setSheet('task') },
    { id: 'consult', label: 'Doctor', icon: 'heart', color: C.red, onPress: () => setSheet('consult') },
    { id: 'assign', label: 'Assign', icon: 'userPlus', color: C.orange, onPress: () => setSheet('assign') },
    { id: 'insight', label: 'AI Insight', icon: 'sparkle', color: C.gold, onPress: () => setSheet('insight') },
    { id: 'bio', label: 'Bio', icon: 'user', color: C.blue, onPress: () => setSheet('bio') },
    { id: 'creds', label: 'Credentials', icon: 'shield', color: C.green, onPress: () => setSheet('creds') },
    { id: 'discontinue', label: 'Discontinue', icon: 'alert', color: C.red, onPress: () => setSheet('discontinue') },
  ];

  return (
    <Page ref={pageRef} gap={14} pt={6}>
      <BackLink label="My Clients" onPress={() => (canGoBack ? back() : go('crm-clients'))} />

      {detailQ.isLoading ? (
        <View style={{ alignItems: 'center', gap: 8, paddingVertical: 40 }}>
          <ActivityIndicator color={C.orange} />
          <Body style={{ fontSize: 12.5, color: C.muted3 }}>Loading client…</Body>
        </View>
      ) : !client ? (
        <Body style={{ color: C.red, textAlign: 'center', paddingVertical: 30 }}>Couldn't load this client.</Body>
      ) : (
        <>
          {/* ---------- Hero header ---------- */}
          <Card colors={['rgba(72,40,22,0.55)', 'rgba(15,11,10,0.62)']} border="rgba(255,150,90,0.18)" radius={22} style={{ overflow: 'hidden' }}>
            <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 3 }} />
            <View style={{ padding: 16, gap: 13 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 13 }}>
              <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' }}>
                <View style={{ width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1A120D' }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 19, color: C.orange }}>{initials(name)}</Text>
                </View>
              </LinearGradient>
              <View style={{ flex: 1 }}>
                <Serif numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.55} style={{ fontSize: 22 }}>{name}</Serif>
                {client.created_at ? <Mono style={{ fontSize: 8.5, letterSpacing: 0.8, color: C.muted3, marginTop: 3 }}>CLIENT SINCE {istD(client.created_at).toUpperCase()}</Mono> : null}
              </View>
              <Pressable onPress={toggleStatus} disabled={statusM.isPending} style={{ alignItems: 'center', gap: 4 }}>
                <View style={{ width: 46, height: 26, borderRadius: 13, padding: 3, backgroundColor: isActive ? hexA(C.green, 0.3) : 'rgba(255,255,255,0.1)', alignItems: isActive ? 'flex-end' : 'flex-start' }}>
                  <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: isActive ? C.green : C.muted2 }} />
                </View>
                <Mono style={{ fontSize: 7.5, letterSpacing: 0.5, color: C.muted3 }}>{isActive ? 'ACTIVE' : 'INACTIVE'}</Mono>
              </Pressable>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
              <Badge text={isActive ? 'Active' : 'Inactive'} color={isActive ? C.green : C.muted2} />
              {d!.subscription ? <Badge text={d!.subscription} color={C.gold} /> : null}
              {d!.appUser ? <Badge text="App User" color={C.blue} /> : null}
              {pkg?.renewalPending ? <Badge text="Renewal Pending" color={C.red} /> : null}
              {activePause ? <Badge text="Paused" color={C.purple} /> : null}
              <ServicesButton subscriptionType={d!.subscription} />
            </View>
            {(client.phone || client.location) ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {client.phone ? (
                  <Pressable onPress={callClient} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 11, borderRadius: 999, backgroundColor: hexA(C.green, 0.08), borderWidth: 1, borderColor: hexA(C.green, 0.25) }}>
                    <Icon name="phone" size={11} color={C.green} strokeWidth={2.3} />
                    <Text style={{ fontFamily: F.bodySemi, fontSize: 11.5, color: C.ink3 }}>Call client</Text>
                  </Pressable>
                ) : null}
                {client.location ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 11, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
                    <Icon name="pin" size={11} color={C.muted} strokeWidth={2.2} />
                    <Text style={{ fontFamily: F.bodySemi, fontSize: 11.5, color: C.muted }}>{client.location}</Text>
                  </View>
                ) : null}
              </View>
            ) : null}
            {/* Glance strip — live numbers from package + journey */}
            <View style={{ flexDirection: 'row', borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.3)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
              {([
                ['SESSIONS', pkg ? `${pkg.completed}${pkg.totalSessions ? ` / ${pkg.totalSessions}` : ''}` : '…', pkg?.renewalPending ? C.red : C.green],
                ['JOURNEY', `${d!.journeyPct}%`, C.blue],
                ['CYCLE', pkg ? `${pkg.currentCycle}` : '…', C.gold],
              ] as [string, string, string][]).map(([lab, val, col], i) => (
                <View key={lab} style={{ flex: 1, alignItems: 'center', paddingVertical: 11, gap: 3, borderLeftWidth: i ? 1 : 0, borderLeftColor: 'rgba(255,255,255,0.06)' }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 16.5, color: col }}>{val}</Text>
                  <Mono style={{ fontSize: 7.5, letterSpacing: 1, color: C.muted3 }}>{lab}</Mono>
                </View>
              ))}
            </View>
            {activePause ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 12, backgroundColor: hexA(C.purple, 0.08), borderWidth: 1, borderColor: hexA(C.purple, 0.3) }}>
                <Icon name="clock" size={14} color={C.purple} strokeWidth={2.2} />
                <Body style={{ flex: 1, fontSize: 11.5, color: C.ink3 }}>Journey paused since {istD(activePause.pause_start)}{activePause.pause_end ? ` · until ${istD(activePause.pause_end)}` : ' · open-ended'}</Body>
              </View>
            ) : null}
            {inactivating ? (
              <View style={{ gap: 8, padding: 11, borderRadius: 13, backgroundColor: hexA(C.red, 0.07), borderWidth: 1, borderColor: hexA(C.red, 0.3) }}>
                <Mono style={{ fontSize: 9, letterSpacing: 0.8, color: C.red }}>REASON FOR MARKING INACTIVE (REQUIRED)</Mono>
                <TextInput value={inactiveReason} onChangeText={setInactiveReason} placeholder="Why is this client going inactive?" placeholderTextColor={C.muted3} multiline autoFocus style={[INPUT, { minHeight: 50, textAlignVertical: 'top' }]} />
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Pressable onPress={() => { setInactivating(false); setInactiveReason(''); }} style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.05)' }}><Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: C.muted }}>Cancel</Text></Pressable>
                  <Pressable onPress={confirmInactive} disabled={!inactiveReason.trim()} style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10, backgroundColor: hexA(C.red, 0.16), borderWidth: 1, borderColor: hexA(C.red, 0.4), opacity: inactiveReason.trim() ? 1 : 0.5 }}><Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: C.red }}>Mark Inactive</Text></Pressable>
                </View>
              </View>
            ) : null}
            </View>
          </Card>

          {/* ---------- Action rail ---------- */}
          <View style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 2 }}>
              <Mono style={{ fontSize: 9, letterSpacing: 1.4, color: '#8A6A4E' }}>QUICK ACTIONS</Mono>
              <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.05)' }} />
            </View>
            <HScroll gap={9}>
              {ACTIONS.map((a) => (
                <AnimChip key={a.id} onPress={a.onPress} style={{ alignItems: 'center', gap: 6, width: 68 }}>
                  <View style={{ width: 50, height: 50, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: hexA(a.color, 0.1), borderWidth: 1, borderColor: hexA(a.color, 0.32), overflow: 'hidden' }}>
                    <LinearGradient colors={[hexA(a.color, 0.16), 'rgba(0,0,0,0)']} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={StyleSheet.absoluteFill as any} />
                    <Icon name={a.icon as any} size={20} color={a.color} strokeWidth={2} />
                  </View>
                  <Text numberOfLines={1} style={{ fontFamily: F.bodySemi, fontSize: 9.5, color: C.muted }}>{a.label}</Text>
                </AnimChip>
              ))}
            </HScroll>
          </View>

          {/* ---------- Journey / Package / Basic details ---------- */}
          <TabCard accent={C.blue}>
            <Pressable onPress={() => setJourneyOpen(!journeyOpen)} style={{ gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                <View style={{ width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: hexA(C.blue, 0.12), borderWidth: 1, borderColor: hexA(C.blue, 0.28) }}>
                  <Icon name="route" size={15} color={C.blue} strokeWidth={2.1} />
                </View>
                <Body style={{ flex: 1, fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>Onboarding Journey</Body>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 16, color: C.blue }}>{d!.journeyPct}%</Text>
                <Icon name={journeyOpen ? 'chevUp' : 'chevDown'} size={14} color={C.muted2} strokeWidth={2.2} />
              </View>
              <ProgressBar pct={d!.journeyPct} height={7} fill={C.blue} />
              <Mono style={{ fontSize: 9, color: C.muted3 }}>{d!.journeyDone} OF {d!.journeyTotal} STEPS COMPLETE{journeyOpen ? '' : ' · TAP FOR DETAILS'}</Mono>
            </Pressable>
            {journeyOpen ? (
              /* Full canonical checklist (17 steps · 5 categories) — TAP a step to
                 mark/unmark it; read-merge-write on clients.client_onboard_journey. */
              <View style={{ gap: 12, marginTop: 3 }}>
                {JOURNEY_CATEGORIES.map((cat) => {
                  const j = (client.client_onboard_journey ?? {}) as Record<string, boolean>;
                  const catDone = cat.steps.filter((s) => j[s.key] === true).length;
                  return (
                    <View key={cat.id} style={{ gap: 6 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Mono style={{ flex: 1, fontSize: 8.5, letterSpacing: 0.8, color: C.muted2 }}>{cat.title.toUpperCase()}</Mono>
                        <View style={{ paddingVertical: 2, paddingHorizontal: 8, borderRadius: 999, backgroundColor: hexA(catDone === cat.steps.length ? C.green : C.blue, 0.12), borderWidth: 1, borderColor: hexA(catDone === cat.steps.length ? C.green : C.blue, 0.35) }}>
                          <Text style={{ fontFamily: F.bodyBold, fontSize: 9, color: catDone === cat.steps.length ? C.green : C.blue }}>{catDone}/{cat.steps.length}</Text>
                        </View>
                      </View>
                      {cat.steps.map((s) => {
                        const done = j[s.key] === true;
                        const busy = journeyToggleM.isPending && journeyToggleM.variables?.stepKey === s.key;
                        return (
                          <Pressable
                            key={s.key}
                            disabled={journeyToggleM.isPending || !crmId}
                            onPress={() => journeyToggleM.mutate({ crmId: crmId!, clientId: client.id, stepKey: s.key, value: !done })}
                            style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: done ? hexA(C.green, 0.05) : hexA(C.gold, 0.05), borderWidth: 1, borderColor: done ? hexA(C.green, 0.16) : hexA(C.gold, 0.22), opacity: journeyToggleM.isPending && !busy ? 0.6 : 1 }}
                          >
                            <View style={{ width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: done ? hexA(C.green, 0.18) : 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: done ? hexA(C.green, 0.5) : hexA(C.gold, 0.4) }}>
                              {busy ? <ActivityIndicator size={10} color={done ? C.gold : C.green} />
                                : done ? <Icon name="checks" size={11} color={C.green} strokeWidth={2.8} /> : null}
                            </View>
                            <Body style={{ flex: 1, fontSize: 12, color: done ? C.ink3 : '#fff' }}>{s.label}</Body>
                            {!done ? <Mono style={{ fontSize: 8, color: C.gold }}>TAP TO MARK</Mono> : null}
                          </Pressable>
                        );
                      })}
                    </View>
                  );
                })}
                {journeyToggleM.isError ? (
                  <Body style={{ fontSize: 11, color: C.red }}>{(journeyToggleM.error as Error).message}</Body>
                ) : null}
              </View>
            ) : null}
          </TabCard>

          <TabCard accent={C.orange}>
            <SectionHead icon="layers" color={C.orange} title="Package & Cycle" meta={pkg?.monthly ? 'MONTHLY' : null} />
            {pkgQ.isLoading ? <Empty text="Computing…" /> : pkg ? (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
                  <Body style={{ fontSize: 12.5, color: C.ink3 }}>Sessions used</Body>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 20, color: pkg.renewalPending ? C.red : C.green }}>{pkg.completed}<Text style={{ fontSize: 13, color: C.muted2 }}> / {pkg.totalSessions || '—'}</Text></Text>
                </View>
                <ProgressBar pct={pkg.totalSessions ? Math.min(100, Math.round((pkg.completed / pkg.totalSessions) * 100)) : 0} height={7} fill={pkg.renewalPending ? C.red : C.green} />
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2 }}>
                  <Metric label="Package start" value={istD(pkg.packageStart)} color={C.gold} />
                  <Metric label="Current cycle" value={`Cycle ${pkg.currentCycle}`} color={C.blue} />
                  <Metric label="In this cycle" value={pkg.sessionsPerCycle ? `${pkg.inCycle} / ${pkg.sessionsPerCycle}` : String(pkg.inCycle)} color={C.orange} />
                  <Metric label="Left in cycle" value={pkg.sessionsPerCycle ? String(pkg.remainingInCycle) : null} color={C.green} />
                </View>
              </>
            ) : null}
          </TabCard>

          <TabCard accent={C.gold}>
            <Pressable onPress={() => setDetailsOpen(!detailsOpen)} style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
              <View style={{ width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: hexA(C.gold, 0.12), borderWidth: 1, borderColor: hexA(C.gold, 0.28) }}>
                <Icon name="user" size={15} color={C.gold} strokeWidth={2.1} />
              </View>
              <Body style={{ flex: 1, fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>Basic Details</Body>
              <Mono style={{ fontSize: 8.5, color: C.muted3 }}>{detailsOpen ? 'HIDE' : 'SHOW'}</Mono>
              <Icon name={detailsOpen ? 'chevUp' : 'chevDown'} size={14} color={C.muted2} strokeWidth={2.2} />
            </Pressable>
            {detailsOpen ? (<>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, padding: 12, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.24)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' }}>
              <Field label="Age" value={d!.basicInfo?.clientAge} />
              <Field label="Gender" value={d!.basicInfo?.clientGender} />
              <Field label="Height" value={d!.basicInfo?.clientHeight} />
              <Field label="Weight" value={d!.basicInfo?.clientWeight ? `${d!.basicInfo?.clientWeight} kg` : null} />
              <Field label="DOB" value={client.date_of_birth ? istD(client.date_of_birth) : d!.basicInfo?.clientDob} />
              <Field label="Package" value={client.session_package} />
              <Field label="Cycle type" value={client.cycle_type} />
              <Field label="Sessions / cycle" value={client.sessions_per_cycle} />
              <Field label="Duration" value={client.package_duration} />
              <Field label="Mode" value={client.is_hybrid ? 'Hybrid' : 'Non-Hybrid'} />
            </View>
            {(d!.trainers.length || d!.crms.length) ? (
              <View style={{ gap: 7 }}>
                <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.muted3 }}>ASSIGNED TEAM</Mono>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {d!.trainers.map((t) => <Badge key={t.id} text={`${t.name} · Trainer`} color={C.orange} />)}
                  {d!.crms.map((t) => <Badge key={t.id} text={`${t.name} · CRM`} color={C.gold} />)}
                </View>
              </View>
            ) : null}
            {(client.short_term_goal || client.goal) ? (
              <View style={{ gap: 7 }}>
                {client.short_term_goal ? (
                  <View style={{ padding: 10, borderRadius: 11, backgroundColor: hexA(C.green, 0.05), borderLeftWidth: 3, borderLeftColor: hexA(C.green, 0.6) }}>
                    <Mono style={{ fontSize: 7.5, letterSpacing: 0.8, color: C.muted3 }}>SHORT-TERM GOAL</Mono>
                    <Body style={{ fontSize: 12, color: C.ink3, marginTop: 3 }}>{client.short_term_goal}</Body>
                  </View>
                ) : null}
                {client.goal ? (
                  <View style={{ padding: 10, borderRadius: 11, backgroundColor: hexA(C.blue, 0.05), borderLeftWidth: 3, borderLeftColor: hexA(C.blue, 0.6) }}>
                    <Mono style={{ fontSize: 7.5, letterSpacing: 0.8, color: C.muted3 }}>LONG-TERM GOAL</Mono>
                    <Body style={{ fontSize: 12, color: C.ink3, marginTop: 3 }}>{client.goal}</Body>
                  </View>
                ) : null}
              </View>
            ) : null}
            </>) : null}
          </TabCard>

          {/* ---------- Tab bar ---------- */}
          <View style={{ gap: 8 }} onLayout={(e) => { recordY.current = e.nativeEvent.layout.y; }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 2 }}>
              <Mono style={{ fontSize: 9, letterSpacing: 1.4, color: '#8A6A4E' }}>CLIENT RECORD</Mono>
              <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.05)' }} />
            </View>
            <HScroll gap={7}>
              {TABS.map(([id, label, icon]) => {
                const active = tab === id;
                return (
                  <AnimChip key={id} active={active} onPress={() => setTab(id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 9, paddingHorizontal: 13, borderRadius: 12, overflow: 'hidden', backgroundColor: active ? 'transparent' : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? 'transparent' : 'rgba(255,255,255,0.08)' }}>
                    {active ? <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill as any} /> : null}
                    <Icon name={icon as any} size={13} color={active ? '#fff' : C.muted2} strokeWidth={2.2} />
                    <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 12.5, color: active ? '#fff' : C.muted }}>{label}</Text>
                  </AnimChip>
                );
              })}
            </HScroll>
          </View>

          {/* ---------- Tab content ---------- */}
          <TabErrorBoundary resetKey={`${tab}-${clientId}`}>
            <TabContent tab={tab} clientId={clientId!} crmId={crmId} commFormOpen={commFormOpen} setCommFormOpen={setCommFormOpen} onBookConsult={() => setSheet('consult')} />
          </TabErrorBoundary>

          {/* ---------- Action sheets ---------- */}
          <RosterSheet visible={sheet === 'roster'} onClose={() => setSheet(null)} clientId={clientId!} onCreate={() => setSheet('roster-create')} />
          <CreateRosterSheet visible={sheet === 'roster-create'} onClose={() => setSheet(null)} crmId={crmId} people={rosterPeopleQ.data} presetClient={clientId ? { id: clientId, name } : null} />
          <TaskSheet visible={sheet === 'task'} onClose={() => setSheet(null)} crmId={crmId} taggedId={client.profile_id || client.id} clientName={name} />
          <ConsultSheet visible={sheet === 'consult'} onClose={() => setSheet(null)} clientId={clientId!} crmId={crmId} clientName={name} />
          <BioSheet visible={sheet === 'bio'} onClose={() => setSheet(null)} clientId={clientId!} />
          <CredsSheet visible={sheet === 'creds'} onClose={() => setSheet(null)} client={client} />
          <AssignSheet visible={sheet === 'assign'} onClose={() => setSheet(null)} clientId={clientId!} />
          <InsightSheet visible={sheet === 'insight'} onClose={() => setSheet(null)} clientId={clientId!} clientName={name} />
          <PauseSheet visible={sheet === 'pause'} onClose={() => setSheet(null)} clientId={clientId!} crmId={crmId} activePause={activePause ?? null} />
          <DiscontinueSheet visible={sheet === 'discontinue'} onClose={() => setSheet(null)} clientId={clientId!} crmId={crmId} clientName={name} />
        </>
      )}
    </Page>
  );
}

/* ============================== TAB CONTENT ============================== */
function TabContent({ tab, clientId, crmId, commFormOpen, setCommFormOpen, onBookConsult }: {
  tab: TabId; clientId: string; crmId: string | null;
  commFormOpen: boolean; setCommFormOpen: (v: boolean) => void; onBookConsult: () => void;
}) {
  switch (tab) {
    case 'sessions': return <SessionsTab clientId={clientId} />;
    case 'comms': return <CommsTab clientId={clientId} crmId={crmId} formOpen={commFormOpen} setFormOpen={setCommFormOpen} />;
    case 'health': return <HealthTab clientId={clientId} />;
    case 'reports': return <ReportsTab clientId={clientId} kind="reports" />;
    case 'qhp': return <ReportsTab clientId={clientId} kind="qhp" />;
    case 'goals': return <GoalsTab clientId={clientId} />;
    // Merged tab: workout progression (load + 1RM) followed by bio-age trends.
    case 'progression': return (
      <>
        <ProgressionTab clientId={clientId} />
        <TrendsTab clientId={clientId} />
      </>
    );
    case 'medical': return <MedicalTab clientId={clientId} />;
    case 'diagnoses': return <DiagnosesTab clientId={clientId} onBook={onBookConsult} />;
    case 'notes': return <NotesTab clientId={clientId} crmId={crmId} />;
  }
}

/* ---------- Sessions — web-parity breakdown:
   Training Sessions (All/Workout/Rehab/Cancelled) + Training Frequency by modality. ---------- */
const CATEGORY_META: Record<SessionCategory, { label: string; color: string }> = {
  workout: { label: 'Workout', color: C.blue },
  rehab: { label: 'Rehab', color: C.purple },
  cancelled: { label: 'Cancelled', color: C.red },
  other: { label: 'Other', color: C.gold },
};
const PAGE = 10;
function modalityColor(m: string) {
  const s = m.toLowerCase();
  if (s.includes('boxing')) return C.red;
  if (s.includes('yoga')) return C.purple;
  if (s.includes('strength')) return C.blue;
  if (s.includes('hiit')) return C.orange;
  if (s.includes('cardio')) return C.green;
  return C.gold;
}
function WorkoutLogList({ clientId }: { clientId: string }) {
  const logQ = useClientWorkoutLog(clientId);
  const [count, setCount] = React.useState(PAGE);
  const [open, setOpen] = React.useState<string | null>(null);
  const rows = logQ.data ?? [];
  if (logQ.isLoading) return <Empty text="Loading workout log…" />;
  if (!rows.length) return <Empty text="No logged workouts yet." />;
  return (
    <>
      <Mono style={{ fontSize: 8.5, color: C.muted3 }}>SHOWING {Math.min(count, rows.length)} OF {rows.length} LOGGED WORKOUTS</Mono>
      {rows.slice(0, count).map((w) => {
        const expanded = open === w.id;
        return (
          <Pressable key={w.id} onPress={() => setOpen(expanded ? null : w.id)} style={{ padding: 12, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: hexA(C.blue, 0.18), borderLeftWidth: 3, borderLeftColor: C.blue, gap: 7 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Body style={{ flex: 1, fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }} numberOfLines={1}>{w.name || 'Workout Session'}</Body>
              <Badge text={`${w.exercises.length} exercises`} color={C.blue} />
              <Icon name={expanded ? 'chevUp' : 'chevDown'} size={13} color={C.muted2} strokeWidth={2.2} />
            </View>
            <Body style={{ fontSize: 11.5, color: C.muted2 }}>{istD(w.date)} · {w.trainerName}</Body>
            {expanded ? (
              <View style={{ gap: 5, marginTop: 2 }}>
                {w.exercises.map((ex) => (
                  <View key={ex.name} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingHorizontal: 9, borderRadius: 9, backgroundColor: 'rgba(255,255,255,0.03)' }}>
                    <Body style={{ flex: 1, fontSize: 11.5, color: C.ink3 }} numberOfLines={1}>{ex.name}</Body>
                    <Mono style={{ fontSize: 9, color: C.muted2 }}>
                      {ex.sets} SET{ex.sets > 1 ? 'S' : ''}{ex.topReps ? ` · ${ex.topReps} REPS` : ''}{ex.topLoad ? ` · ${ex.topLoad}KG` : ''}
                    </Mono>
                  </View>
                ))}
                {w.remark ? <Body style={{ fontSize: 11, color: C.muted3 }} numberOfLines={3}>{w.remark}</Body> : null}
              </View>
            ) : null}
          </Pressable>
        );
      })}
      {rows.length > count ? (
        <Pressable onPress={() => setCount(count + PAGE)} style={{ alignItems: 'center', paddingVertical: 10, borderRadius: 12, backgroundColor: hexA(C.blue, 0.08), borderWidth: 1, borderColor: hexA(C.blue, 0.3) }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: C.blue }}>Load More ({rows.length - count} left)</Text>
        </Pressable>
      ) : null}
    </>
  );
}
function SessionsTab({ clientId }: { clientId: string }) {
  const sessionsQ = useCrmClientSessions(clientId);
  const [filter, setFilter] = React.useState<'all' | SessionCategory>('all');
  const [count, setCount] = React.useState(PAGE);
  const [period, setPeriod] = React.useState<FreqPeriod>('monthly');
  const freqQ = useTrainingFrequency(clientId, period);

  const all = sessionsQ.data ?? [];
  const byCat = (c: SessionCategory) => all.filter((s) => s.category === c).length;
  const filtered = filter === 'all' ? all : all.filter((s) => s.category === filter);
  const visible = filtered.slice(0, count);
  const freq = freqQ.data;
  const maxCount = Math.max(1, ...(freq?.frequencies ?? []).map((f) => f.count));

  return (
    <View style={{ gap: 14 }}>
      {/* ---- Training Sessions ---- */}
      <TabCard accent={C.orange}>
        <SectionHead icon="dumbbell" color={C.orange} title="Training Sessions" meta={sessionsQ.data ? `${all.length} TOTAL` : null} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {([['all', 'All', all.length, C.orange], ['workout', 'Workout', null, C.blue], ['rehab', 'Rehab', byCat('rehab'), C.purple], ['cancelled', 'Cancelled', byCat('cancelled'), C.red]] as const).map(([id, label, n, col]) => {
            const active = filter === id;
            return (
              <AnimChip key={id} active={active} onPress={() => { setFilter(id as any); setCount(PAGE); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: active ? hexA(col, 0.15) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(col, 0.5) : 'rgba(255,255,255,0.09)' }}>
                <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 11.5, color: active ? col : C.muted }}>{label}</Text>
                {sessionsQ.data && n != null ? <Text style={{ fontFamily: F.mono, fontSize: 9.5, color: active ? col : C.muted3 }}>{n}</Text> : null}
              </AnimChip>
            );
          })}
        </View>
        {filter === 'workout' ? <WorkoutLogList clientId={clientId} />
          : sessionsQ.isLoading ? <Empty text="Loading…" />
          : filtered.length === 0 ? <Empty text={filter === 'all' ? 'No sessions recorded yet.' : `No ${filter} sessions.`} />
          : (
            <>
              <Mono style={{ fontSize: 8.5, color: C.muted3 }}>SHOWING {visible.length} OF {filtered.length}</Mono>
              {visible.map((s) => {
                const cat = CATEGORY_META[s.category] ?? CATEGORY_META.other;
                const stCol = s.cancelled ? C.red : s.status === 'completed' ? C.green : C.gold;
                return (
                  <View key={s.id} style={{ padding: 12, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: hexA(cat.color, 0.18), borderLeftWidth: 3, borderLeftColor: cat.color, gap: 7 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <Badge text={cat.label} color={cat.color} />
                      <Badge text={s.cancelled ? 'Cancelled' : pretty(s.status)} color={stCol} />
                      <View style={{ paddingVertical: 3, paddingHorizontal: 9, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
                        <Text style={{ fontFamily: F.bodySemi, fontSize: 10, color: C.ink3 }}>{s.type}</Text>
                      </View>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                        <Icon name="calendar" size={11} color={C.muted3} strokeWidth={2} />
                        <Body style={{ fontSize: 11.5, color: C.muted2 }}>{istDT(s.when)}</Body>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                        <Icon name="user" size={11} color={C.muted3} strokeWidth={2} />
                        <Body style={{ fontSize: 11.5, color: C.muted2 }}>{s.trainerName}</Body>
                      </View>
                    </View>
                    {s.notes ? (
                      <View style={{ flexDirection: 'row', gap: 6, padding: 9, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.03)' }}>
                        <Icon name="file" size={11} color={C.muted3} strokeWidth={2} />
                        <Body style={{ flex: 1, fontSize: 11.5, color: C.muted2, lineHeight: 17 }} numberOfLines={4}>{s.notes}</Body>
                      </View>
                    ) : null}
                  </View>
                );
              })}
              {filtered.length > count ? (
                <Pressable onPress={() => setCount(count + PAGE)} style={{ alignItems: 'center', paddingVertical: 10, borderRadius: 12, backgroundColor: hexA(C.orange, 0.08), borderWidth: 1, borderColor: hexA(C.orange, 0.3) }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: C.orange }}>Load More ({filtered.length - count} left)</Text>
                </Pressable>
              ) : null}
            </>
          )}
      </TabCard>

      {/* ---- Training Frequency by Modality ---- */}
      <TabCard accent={C.green}>
        <SectionHead icon="activity" color={C.green} title="Training Frequency" meta={freq ? `${freq.totalSessions} SESSIONS` : null} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {FREQ_PERIODS.map(([id, label]) => {
            const active = period === id;
            return (
              <AnimChip key={id} active={active} onPress={() => setPeriod(id)} style={{ paddingVertical: 7, paddingHorizontal: 11, borderRadius: 999, backgroundColor: active ? hexA(C.green, 0.14) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.green, 0.45) : 'rgba(255,255,255,0.09)' }}>
                <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 11, color: active ? C.green : C.muted }}>{label}</Text>
              </AnimChip>
            );
          })}
        </View>
        {freqQ.isLoading ? <Empty text="Computing…" />
          : !freq || freq.frequencies.length === 0 ? <Empty text="No logged workouts in this period." />
          : freq.frequencies.map((f) => {
            const col = modalityColor(f.modality);
            return (
              <View key={f.modality} style={{ gap: 6 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: col }} />
                  <Body style={{ flex: 1, fontSize: 12.5, fontFamily: F.bodySemi, color: '#fff' }} numberOfLines={1}>{pretty(f.modality)}</Body>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: col }}>{f.count}</Text>
                  <Mono style={{ fontSize: 8.5, color: C.muted3 }}>{f.weekly.toFixed(1)}×/WK</Mono>
                </View>
                <View style={{ height: 5, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.05)', overflow: 'hidden' }}>
                  <View style={{ width: `${Math.round((f.count / maxCount) * 100)}%`, height: 5, borderRadius: 999, backgroundColor: hexA(col, 0.75) }} />
                </View>
              </View>
            );
          })}
      </TabCard>
    </View>
  );
}

/* ---------- Comms (log form + history) ---------- */
function CommsTab({ clientId, crmId, formOpen, setFormOpen }: { clientId: string; crmId: string | null; formOpen: boolean; setFormOpen: (v: boolean) => void }) {
  const commsQ = useClientComms(clientId);
  const logM = useLogCommunication();
  const doneM = useMarkCommDone();
  const [cat, setCat] = React.useState<string>(COMM_CATEGORIES[0]);
  const [status, setStatus] = React.useState<string>('Follow Up Done');
  const [medium, setMedium] = React.useState<string | null>('phone');
  const [remarks, setRemarks] = React.useState('');
  const [followDays, setFollowDays] = React.useState<number | null>(null);

  const submit = async () => {
    if (!crmId || !remarks.trim()) return;
    const followUpDate = followDays != null ? new Date(Date.now() + followDays * 864e5).toISOString() : null;
    try {
      await logM.mutateAsync({ crmId, clientId, category: cat, status, medium, remarks, followUpDate });
      setFormOpen(false); setRemarks(''); setFollowDays(null); setStatus('Follow Up Done');
    } catch (e: any) { Alert.alert("Couldn't log", e?.message ?? 'Try again.'); }
  };

  return (
    <TabCard accent={C.blue}>
      <SectionHead icon="phone" color={C.blue} title="Communications" meta={commsQ.data ? `${commsQ.data.length} LOGGED` : null} />
      {!formOpen ? (
        <Pressable onPress={() => setFormOpen(true)}>
          <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 12, borderRadius: 12 }}>
            <Icon name="phone" size={14} color="#fff" strokeWidth={2.4} />
            <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: '#fff' }}>Log Communication</Text>
          </LinearGradient>
        </Pressable>
      ) : (
        <View style={{ padding: 12, borderRadius: 14, backgroundColor: hexA(C.orange, 0.06), borderWidth: 1, borderColor: hexA(C.orange, 0.28), gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Mono style={{ flex: 1, fontSize: 9.5, letterSpacing: 1, color: C.orange }}>NEW COMMUNICATION</Mono>
            <Pressable onPress={() => setFormOpen(false)} hitSlop={8}><Icon name="close" size={14} color={C.muted} strokeWidth={2.3} /></Pressable>
          </View>
          <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.muted3 }}>CATEGORY</Mono>
          <ChipRow items={COMM_CATEGORIES} sel={cat} onSel={setCat} />
          <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.muted3 }}>STATUS</Mono>
          <ChipRow items={COMM_STATUSES} sel={status} onSel={setStatus} color={C.blue} />
          <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.muted3 }}>MEDIUM</Mono>
          <ChipRow items={COMM_MEDIUMS} sel={medium ?? ''} onSel={(v) => setMedium(v)} color={C.green} />
          <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.muted3 }}>REMARKS *</Mono>
          <TextInput value={remarks} onChangeText={setRemarks} placeholder="What was discussed?" placeholderTextColor={C.muted3} multiline style={[INPUT, { minHeight: 60, textAlignVertical: 'top' }]} />
          <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.muted3 }}>FOLLOW-UP</Mono>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {([[null, 'None'], [1, '+1 day'], [3, '+3 days'], [7, '+7 days']] as [number | null, string][]).map(([v, lbl]) => {
              const active = followDays === v;
              return (
                <AnimChip key={lbl} grow active={active} onPress={() => setFollowDays(v)} style={{ alignItems: 'center', paddingVertical: 8, borderRadius: 10, backgroundColor: active ? hexA(C.gold, 0.14) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.gold, 0.45) : 'rgba(255,255,255,0.09)' }}>
                  <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 11.5, color: active ? C.gold : C.muted }}>{lbl}</Text>
                </AnimChip>
              );
            })}
          </View>
          <GradientBtn label="Save Communication" onPress={submit} disabled={!remarks.trim()} busy={logM.isPending} />
        </View>
      )}
      {commsQ.isLoading ? <Empty text="Loading…" />
        : (commsQ.data ?? []).length === 0 ? <Empty text="No communications logged yet." />
        : (commsQ.data ?? []).map((cm) => {
          const col = cm.overdue ? C.red : cm.status === 'Follow Up Done' ? C.green : C.blue;
          return (
            <View key={cm.id} style={{ padding: 11, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: hexA(col, 0.2), borderLeftWidth: 3, borderLeftColor: col, gap: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                <Mono style={{ flex: 1, fontSize: 9.5, color: C.muted3 }}>{istDT(cm.callDate)}</Mono>
                {cm.category ? <Badge text={cm.category} color={C.gold} /> : null}
                {cm.status ? <Badge text={cm.status} color={col} /> : null}
                {cm.overdue ? <Badge text="Overdue" color={C.red} /> : null}
              </View>
              {cm.remarks ? <Body style={{ fontSize: 12.5, color: C.ink3 }}>{cm.remarks}</Body> : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {cm.followUp ? <Body style={{ flex: 1, fontSize: 10.5, color: C.muted3 }}>Follow-up {istD(cm.followUp)}{cm.medium ? ` · ${cm.medium}` : ''}</Body> : <View style={{ flex: 1 }} />}
                {cm.status !== 'Follow Up Done' ? (
                  <Pressable onPress={() => doneM.mutate({ id: cm.id, clientId })} style={{ paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999, backgroundColor: hexA(C.green, 0.12), borderWidth: 1, borderColor: hexA(C.green, 0.35) }}>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 10.5, color: C.green }}>Mark Done</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          );
        })}
    </TabCard>
  );
}

/* ---------- Health (Whoop + HeartMath + Nutrition month) ---------- */
function HealthTab({ clientId }: { clientId: string }) {
  const whoopQ = useClientWhoop(clientId);
  const hmQ = useClientHeartMath(clientId);
  const [nutOpen, setNutOpen] = React.useState(false);
  const [monthOffset, setMonthOffset] = React.useState(0);
  const nutQ = useClientNutritionMonth(clientId, monthOffset);
  const latest: any = whoopQ.data?.[0] ?? null;
  const hm = hmQ.data;
  const nut = nutQ.data;
  const num = (v: any, d = 0) => (v == null || isNaN(Number(v)) ? null : Number(v).toFixed(d));
  return (
    <TabCard accent={C.green}>
      <SectionHead icon="activity" color={C.green} title="Device Recovery" meta={latest ? istD(latest.metric_date).toUpperCase() : null} />
      {whoopQ.isLoading ? <Empty text="Loading…" /> : !latest ? <Empty text="No device data synced yet." /> : (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Metric label="Recovery" value={num(latest.recovery_score)} unit="%" color={C.green} />
            <Metric label="Sleep" value={num(latest.sleep_score)} unit="%" color={C.blue} />
            <Metric label="Strain" value={num(latest.strain_score, 1)} color={C.orange} />
            <Metric label="HRV" value={num(latest.hrv_rmssd, 1)} unit="ms" color={C.purple} />
            <Metric label="Resting HR" value={num(latest.resting_heart_rate)} unit="bpm" color={C.red} />
            <Metric label="Steps" value={latest.steps_count != null ? Number(latest.steps_count).toLocaleString('en-IN') : null} color={C.gold} />
          </View>
          {(whoopQ.data ?? []).slice(1, 8).map((r: any) => (
            <View key={r.metric_date} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 7, paddingHorizontal: 10, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.22)', gap: 8 }}>
              <Mono style={{ width: 66, fontSize: 9.5, color: C.muted2 }}>{istD(r.metric_date).slice(0, 6)}</Mono>
              <Body style={{ flex: 1, fontSize: 11.5, color: C.ink3 }}>Rec {num(r.recovery_score) ?? '—'}% · Sleep {num(r.sleep_score) ?? '—'}%</Body>
              <Body style={{ fontSize: 11.5, color: C.muted2 }}>HRV {num(r.hrv_rmssd, 0) ?? '—'}</Body>
            </View>
          ))}
        </>
      )}

      <View style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.06)' }} />
      <SectionHead icon="heart" color={C.red} title="HeartMath" meta={hm?.date ? istD(hm.date).toUpperCase() : null} />
      {hmQ.isLoading ? <Empty text="Loading…" /> : !hm || (hm.rmssd == null && hm.sdnn == null && hm.coherence == null) ? <Empty text="No HeartMath assessment on file." /> : (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Metric label="RMSSD" value={hm.rmssd} color={C.red} />
            <Metric label="SDNN" value={hm.sdnn} color={C.orange} />
            <Metric label="MHRR" value={hm.mhrr} color={C.gold} />
            <Metric label="Coherence" value={hm.coherence} color={C.purple} />
          </View>
          {hm.analysis ? <Body style={{ fontSize: 11.5, color: C.muted2 }} numberOfLines={6}>{hm.analysis}</Body> : null}
        </>
      )}

      <View style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.06)' }} />
      <Pressable onPress={() => setNutOpen(!nutOpen)} style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
        <View style={{ width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: hexA(C.gold, 0.12), borderWidth: 1, borderColor: hexA(C.gold, 0.28) }}>
          <Icon name="target" size={15} color={C.gold} strokeWidth={2.1} />
        </View>
        <Body style={{ flex: 1, fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>Nutrition & Supplements</Body>
        <Mono style={{ fontSize: 8.5, color: C.muted3 }}>{nutOpen ? 'HIDE DAYS' : 'MONTH-WISE'}</Mono>
        <Icon name={nutOpen ? 'chevUp' : 'chevDown'} size={14} color={C.muted2} strokeWidth={2.2} />
      </Pressable>
      {/* Month navigation (like the web's ‹ Month › pager; next disabled at current month) */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Pressable onPress={() => setMonthOffset(monthOffset - 1)} hitSlop={8} style={{ width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
          <Icon name="chevLeft" size={14} color={C.muted} strokeWidth={2.3} />
        </Pressable>
        <Body style={{ flex: 1, fontSize: 13, fontFamily: F.bodySemi, color: '#fff', textAlign: 'center' }}>{nut?.monthLabel ?? '…'}</Body>
        <Pressable onPress={() => setMonthOffset(Math.min(0, monthOffset + 1))} disabled={monthOffset >= 0} hitSlop={8} style={{ width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', opacity: monthOffset >= 0 ? 0.35 : 1 }}>
          <Icon name="chevRight" size={14} color={C.muted} strokeWidth={2.3} />
        </Pressable>
      </View>
      {nutQ.isLoading ? <Empty text="Loading…" /> : (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Metric label="Avg nutrition rating" value={nut?.avgRating} unit="/ 10" color={C.gold} />
            <Metric label="Days logged" value={nut?.daysLogged || null} color={C.blue} />
            <Metric label="Supplement adherence" value={nut?.suppPct} unit="%" color={C.green} />
          </View>
          {nutOpen ? (
            (nut?.days ?? []).every((dy) => !dy.ratings.length && !dy.hasResponse) ? (
              <Empty text="Nothing logged this month." />
            ) : (
              <View style={{ gap: 5 }}>
                {(nut?.days ?? []).map((dy) => {
                  const dt = new Date(dy.date + 'T00:00:00');
                  const logged = dy.ratings.length > 0;
                  const future = dt.getTime() > Date.now();
                  if (future) return null;
                  return (
                    <View key={dy.date} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7, paddingHorizontal: 10, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: logged ? hexA(C.green, 0.14) : 'rgba(255,255,255,0.05)' }}>
                      <View style={{ width: 36, alignItems: 'center' }}>
                        <Mono style={{ fontSize: 7.5, color: C.muted3 }}>{dt.toLocaleDateString('en-IN', { weekday: 'short' }).toUpperCase()}</Mono>
                        <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: logged ? '#fff' : C.muted3 }}>{dt.getDate()}</Text>
                      </View>
                      <View style={{ flex: 1, gap: 2 }}>
                        {logged ? (
                          <Body style={{ fontSize: 12, color: C.green, fontFamily: F.bodySemi }}>Nutrition {dy.ratings.join(', ')}/10</Body>
                        ) : (
                          <Body style={{ fontSize: 11.5, color: C.red }}>Not logged</Body>
                        )}
                        {dy.supplements.length ? (
                          <Body style={{ fontSize: 10.5, color: C.muted2 }} numberOfLines={2}>{dy.supplements.join(' · ')}</Body>
                        ) : dy.hasResponse ? (
                          <Body style={{ fontSize: 10.5, color: C.muted3 }}>No supplements taken</Body>
                        ) : null}
                      </View>
                      {dy.supplements.length ? (
                        <View style={{ paddingVertical: 3, paddingHorizontal: 8, borderRadius: 999, backgroundColor: hexA(C.green, 0.1), borderWidth: 1, borderColor: hexA(C.green, 0.3) }}>
                          <Text style={{ fontFamily: F.bodyBold, fontSize: 9.5, color: C.green }}>{dy.supplements.length}</Text>
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            )
          ) : null}
        </>
      )}
    </TabCard>
  );
}

/* ---------- Reports / QHP ---------- */
function ReportsTab({ clientId, kind }: { clientId: string; kind: 'reports' | 'qhp' }) {
  const reportsQ = useClientReports(clientId);
  const assessQ = useClientAssessments(kind === 'qhp' ? clientId : null);
  const [bloodDetail, setBloodDetail] = React.useState<any | null>(null);
  const [qhpDetail, setQhpDetail] = React.useState<{ row: any; label: string } | null>(null);
  const classify = (type: string): 'blood' | 'medical' => {
    const t = (type || '').toLowerCase();
    if (/mri|cect|dexa|ultrasound|imaging|x-?ray|\bct\b|ct |scan|angiograph|coronary|spine|neck|echo|medical/.test(t)) return 'medical';
    return 'blood';
  };
  const healthReports = (reportsQ.data?.health ?? []) as any[];
  const qhpReports = (reportsQ.data?.qhp ?? []) as any[];
  const accent = kind === 'qhp' ? C.gold : C.blue;
  // Structured qhp_details rows, keyed by their assessment (for tap-through).
  const qhpByAssessment = new Map(qhpReports.map((r: any) => [r.coach_assessment_id, r]));
  const openAssessment = (a: any) => {
    const structured = qhpByAssessment.get(a.id);
    if (structured) setQhpDetail({ row: structured, label: a.label });
    else Alert.alert(a.label, `Assessed ${istD(a.date)}${a.coachName ? ` by ${a.coachName}` : ''}.\n\nThe structured QHP report for this assessment hasn't been generated yet.`);
  };
  return (
    <TabCard accent={accent}>
      <SectionHead icon={kind === 'qhp' ? 'heart' : 'file'} color={accent} title={kind === 'qhp' ? 'QHP Assessments' : 'Health Reports'} meta={kind === 'qhp' ? (assessQ.data ? `${assessQ.data.length} ON FILE` : null) : (reportsQ.data ? `${healthReports.length} ON FILE` : null)} />
      {kind === 'qhp' ? (
        assessQ.isLoading ? <Empty text="Loading assessments…" /> :
        (assessQ.data ?? []).length === 0 ? <Empty text="No QHP assessments yet." /> :
        (assessQ.data ?? []).map((a) => {
          const hasReport = qhpByAssessment.has(a.id);
          return (
            <Pressable key={a.id} onPress={() => openAssessment(a)} style={{ padding: 12, borderRadius: 13, backgroundColor: hexA(C.gold, 0.06), borderWidth: 1, borderColor: hexA(C.gold, 0.25), gap: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Icon name="heart" size={16} color={C.gold} strokeWidth={2} />
                <Body style={{ flex: 1, fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{a.label}</Body>
                {hasReport ? <Badge text="Report Ready" color={C.green} /> : <Badge text="Assessment Only" color={C.muted2} />}
                <Icon name="chevRight" size={14} color={C.gold} strokeWidth={2.2} />
              </View>
              <Mono style={{ fontSize: 9, color: C.muted3 }}>{istD(a.date)}{a.coachName ? ` · ${a.coachName.toUpperCase()}` : ''}</Mono>
              {a.metrics.length ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {a.metrics.map((m: string) => (
                    <View key={m} style={{ paddingVertical: 3, paddingHorizontal: 9, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
                      <Text style={{ fontFamily: F.bodySemi, fontSize: 10, color: C.ink3 }}>{m}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </Pressable>
          );
        })
      ) : reportsQ.isLoading ? <Empty text="Loading reports…" /> : (
        healthReports.length === 0 ? <Empty text="No reports yet." /> : healthReports.map((h: any) => {
          const k = classify(h.report_type);
          const col = k === 'medical' ? C.purple : C.blue;
          return (
            <Pressable key={h.id} onPress={() => setBloodDetail(h)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 13, backgroundColor: hexA(col, 0.06), borderWidth: 1, borderColor: hexA(col, 0.25) }}>
              <Icon name={k === 'medical' ? 'clipboard' : 'activity'} size={16} color={col} strokeWidth={2} />
              <View style={{ flex: 1 }}>
                <Body numberOfLines={1} style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{h.report_name || h.report_type}</Body>
                <Mono style={{ fontSize: 9, color: C.muted3, marginTop: 1 }}>{istD(h.test_date || h.upload_date)}</Mono>
              </View>
              <Icon name="chevRight" size={14} color={col} strokeWidth={2.2} />
            </Pressable>
          );
        })
      )}
      <BloodReportSheet report={bloodDetail} onClose={() => setBloodDetail(null)} />
      <QhpReportSheet report={qhpDetail?.row ?? null} label={qhpDetail?.label} onClose={() => setQhpDetail(null)} />
    </TabCard>
  );
}

/* ---------- Trends (biological age history — scrubbable charts like the live app) ---------- */
function AgeChart({ title, color, series, id }: { title: string; color: string; series: { date: string; value: number }[]; id: string }) {
  if (series.length < 2) return null;
  const points = series.map((s) => Math.round(s.value * 10) / 10);
  const first = points[0], last = points[points.length - 1];
  const delta = Math.round((last - first) * 10) / 10;
  const lab = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' });
  const labels = [lab(series[0].date), lab(series[Math.floor(series.length / 2)].date), lab(series[series.length - 1].date)];
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
        <Body style={{ flex: 1, fontSize: 12.5, fontFamily: F.bodySemi, color: '#fff' }}>{title}</Body>
        <Badge text={`${delta > 0 ? '+' : ''}${delta} yrs`} color={delta <= 0 ? C.green : C.red} />
      </View>
      <AreaLine points={points} color={color} labels={labels} id={id} />
    </View>
  );
}
function TrendsTab({ clientId }: { clientId: string }) {
  const bioQ = useClientBioAge(clientId);
  const rows = [...((bioQ.data ?? []) as any[])].reverse(); // hook returns newest-first → chart wants oldest-first
  const latest = rows[rows.length - 1];
  const series = (key: string) => rows.filter((r) => r[key] != null && isFinite(Number(r[key]))).map((r) => ({ date: r.calculation_date, value: Number(r[key]) }));
  const mech = series('mechanical_age');
  const metab = series('metabolic_age');
  return (
    <TabCard accent={C.purple}>
      <SectionHead icon="trend" color={C.purple} title="Biological Age Trends" meta={rows.length ? `${rows.length} CALCULATIONS` : null} />
      {bioQ.isLoading ? <Empty text="Loading…" /> : !latest ? <Empty text="No biological-age calculations yet." /> : (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Metric label="Chronological" value={latest.chronological_age != null ? Number(latest.chronological_age).toFixed(0) : null} unit="yrs" color={C.blue} />
            <Metric label="MAQ" value={latest.mechanical_age != null ? Number(latest.mechanical_age).toFixed(1) : null} unit="yrs" color={C.orange} />
            <Metric label="AXION" value={latest.metabolic_age != null ? Number(latest.metabolic_age).toFixed(1) : null} unit="yrs" color={C.green} />
          </View>
          {latest.is_provisional ? <Body style={{ fontSize: 10.5, color: C.gold }}>Latest calculation is provisional.</Body> : null}
          <AgeChart title="MAQ" color={C.orange} series={mech} id={`mech-${clientId}`} />
          <AgeChart title="AXION" color={C.green} series={metab} id={`metab-${clientId}`} />
          {mech.length < 2 && metab.length < 2 ? <Empty text="Charts appear after two or more calculations." /> : (
            <Mono style={{ fontSize: 8.5, color: C.muted3, textAlign: 'center' }}>DRAG ON A CHART TO SCRUB VALUES · {rows.length} CALCULATIONS</Mono>
          )}
        </>
      )}
    </TabCard>
  );
}

/* ---------- Goals (weekly daily_goals) ---------- */
function GoalsTab({ clientId }: { clientId: string }) {
  const goalsQ = useClientGoals(clientId);
  const rows = [...((goalsQ.data ?? []) as any[])].reverse();
  return (
    <TabCard accent={C.gold}>
      <SectionHead icon="target" color={C.gold} title="Weekly Goals" meta={rows.length ? `${rows.length} WEEKS` : null} />
      {goalsQ.isLoading ? <Empty text="Loading…" /> : rows.length === 0 ? <Empty text="No weekly goals set yet." /> : rows.slice(0, 8).map((g) => (
        <View key={g.id} style={{ padding: 11, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: hexA(C.gold, 0.18), borderLeftWidth: 3, borderLeftColor: C.gold, gap: 7 }}>
          <Mono style={{ fontSize: 9.5, color: C.gold }}>{istD(g.week_start_date)} → {istD(g.week_end_date)}</Mono>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            <Field label="Sleep" value={g.sleep_target_hours ? `${g.sleep_target_hours} h` : null} />
            <Field label="Steps" value={g.steps_target ? Number(g.steps_target).toLocaleString('en-IN') : null} />
            <Field label="Nutrition" value={g.nutrition_target} />
            <Field label="Zone-2 cardio" value={g.z2c_target} />
          </View>
          {g.recommendation ? <Body style={{ fontSize: 11.5, color: C.muted2 }} numberOfLines={3}>{g.recommendation}</Body> : null}
        </View>
      ))}
    </TabCard>
  );
}

/* ---------- Progression (workout_analysis — load & 1RM charts like the live app) ---------- */
function ProgressionTab({ clientId }: { clientId: string }) {
  const progQ = useClientProgression(clientId);
  const rows = (progQ.data ?? []) as any[]; // hook returns oldest-first
  const lab = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' });
  const labelsFor = (s: any[]) => (s.length < 2 ? [] : [lab(s[0].created_at), lab(s[Math.floor(s.length / 2)].created_at), lab(s[s.length - 1].created_at)]);
  // Session load: only real logged loads (>0) — zeros are non-strength sessions and skew the trend.
  const loadRows = rows.filter((r) => r.session_load != null && Number(r.session_load) > 0).slice(-20);
  const rmRows = rows.filter((r) => r.max_1rm != null && Number(r.max_1rm) > 0).slice(-20);
  const latest = loadRows[loadRows.length - 1];
  const avgLoad = loadRows.length ? Math.round(loadRows.slice(-10).reduce((a, b) => a + Number(b.session_load), 0) / Math.min(loadRows.length, 10)) : null;
  const best1rm = rmRows.length ? Math.max(...rmRows.map((r) => Number(r.max_1rm))) : null;
  return (
    <TabCard accent={C.orange}>
      <SectionHead icon="chart" color={C.orange} title="Workout Progression" meta={rows.length ? `${rows.length} ANALYSED` : null} />
      {progQ.isLoading ? <Empty text="Loading…" /> : rows.length === 0 ? <Empty text="No analysed workouts yet." /> : (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Metric label="Last session load" value={latest ? Math.round(Number(latest.session_load)) : null} color={C.orange} />
            <Metric label="Avg load · last 10" value={avgLoad} color={C.blue} />
            <Metric label="Best 1RM" value={best1rm != null ? Math.round(best1rm) : null} unit="kg" color={C.green} />
          </View>
          {loadRows.length >= 2 ? (
            <View style={{ gap: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.orange }} />
                <Body style={{ flex: 1, fontSize: 12.5, fontFamily: F.bodySemi, color: '#fff' }}>Session Load</Body>
                <Mono style={{ fontSize: 8.5, color: C.muted3 }}>LAST {loadRows.length}</Mono>
              </View>
              <AreaLine points={loadRows.map((r) => Math.round(Number(r.session_load)))} color={C.orange} labels={labelsFor(loadRows)} id={`load-${clientId}`} />
            </View>
          ) : null}
          {rmRows.length >= 2 ? (
            <View style={{ gap: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.green }} />
                <Body style={{ flex: 1, fontSize: 12.5, fontFamily: F.bodySemi, color: '#fff' }}>Max 1RM (kg)</Body>
                <Mono style={{ fontSize: 8.5, color: C.muted3 }}>LAST {rmRows.length}</Mono>
              </View>
              <AreaLine points={rmRows.map((r) => Math.round(Number(r.max_1rm)))} color={C.green} labels={labelsFor(rmRows)} id={`rm-${clientId}`} />
            </View>
          ) : null}
          {loadRows.length < 2 && rmRows.length < 2 ? <Empty text="Charts appear after two or more strength sessions." /> : (
            <Mono style={{ fontSize: 8.5, color: C.muted3, textAlign: 'center' }}>DRAG ON A CHART TO SCRUB VALUES</Mono>
          )}
          <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.muted3, marginTop: 4 }}>RECENT SESSIONS</Mono>
          {[...rows].reverse().slice(0, 6).map((r) => (
            <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 7, paddingHorizontal: 10, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.22)', gap: 8 }}>
              <Mono style={{ width: 78, fontSize: 9.5, color: C.muted2 }}>{istD(r.created_at)}</Mono>
              <Body style={{ flex: 1, fontSize: 11.5, color: C.ink3 }} numberOfLines={1}>{pretty(r.workout_type)}</Body>
              <Body style={{ fontSize: 11.5, color: C.muted2 }}>{r.session_load != null && Number(r.session_load) > 0 ? `Load ${Math.round(Number(r.session_load))}` : '—'}</Body>
            </View>
          ))}
        </>
      )}
    </TabCard>
  );
}

/* ---------- Medical History ---------- */
function MedicalTab({ clientId }: { clientId: string }) {
  const medQ = useClientMedicalHistory(clientId);
  const sevCol = (s: string | null) => (/high|severe|critical/i.test(s ?? '') ? C.red : /med|moderate/i.test(s ?? '') ? C.orange : C.green);
  return (
    <TabCard accent={C.red}>
      <SectionHead icon="clipboard" color={C.red} title="Medical History" meta={medQ.data ? `${medQ.data.length} ENTRIES` : null} />
      {medQ.isLoading ? <Empty text="Loading…" /> : (medQ.data ?? []).length === 0 ? <Empty text="No medical history recorded." /> : (medQ.data ?? []).map((m: any) => (
        <View key={m.id} style={{ padding: 11, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: hexA(sevCol(m.severity), 0.2), borderLeftWidth: 3, borderLeftColor: sevCol(m.severity), gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
            <Body style={{ flex: 1, fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }} numberOfLines={2}>{m.title || pretty(m.category)}</Body>
            {m.is_ongoing ? <Badge text="Ongoing" color={C.red} /> : null}
            {m.severity ? <Badge text={pretty(m.severity)} color={sevCol(m.severity)} /> : null}
          </View>
          <Mono style={{ fontSize: 9, color: C.muted3 }}>{istD(m.event_date)}{m.end_date ? ` → ${istD(m.end_date)}` : ''}{m.category ? ` · ${pretty(m.category)}` : ''}</Mono>
          {m.description || m.problem_description ? <Body style={{ fontSize: 12, color: C.ink3 }} numberOfLines={4}>{m.description || m.problem_description}</Body> : null}
          {m.diagnosis ? <Body style={{ fontSize: 11.5, color: C.muted2 }}><Text style={{ color: C.muted3, fontFamily: F.bodySemi }}>Diagnosis: </Text>{m.diagnosis}</Body> : null}
          {m.treatment_given ? <Body style={{ fontSize: 11.5, color: C.muted2 }}><Text style={{ color: C.muted3, fontFamily: F.bodySemi }}>Treatment: </Text>{m.treatment_given}</Body> : null}
          {(m.doctorName || m.treating_doctor || m.hospital_name) ? <Mono style={{ fontSize: 9, color: C.muted3 }}>{[m.doctorName || m.treating_doctor, m.hospital_name].filter(Boolean).join(' · ')}</Mono> : null}
        </View>
      ))}
    </TabCard>
  );
}

/* ---------- Medical Diagnoses ---------- */
function DiagnosesTab({ clientId, onBook }: { clientId: string; onBook: () => void }) {
  const diagQ = useClientDiagnoses(clientId);
  const stCol = (s: string) => (s === 'completed' ? C.green : s === 'scheduled' ? C.blue : s === 'pending' ? C.gold : C.muted2);
  return (
    <TabCard accent={C.red}>
      <SectionHead icon="shield" color={C.red} title="Doctor Consultations" meta={diagQ.data ? `${diagQ.data.length} REQUESTS` : null} />
      <Pressable onPress={onBook}>
        <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 12, borderRadius: 12 }}>
          <Icon name="heart" size={14} color="#fff" strokeWidth={2.4} />
          <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: '#fff' }}>Book Doctor Consultation</Text>
        </LinearGradient>
      </Pressable>
      {diagQ.isLoading ? <Empty text="Loading…" /> : (diagQ.data ?? []).length === 0 ? <Empty text="No consultation requests yet." /> : (diagQ.data ?? []).map((r: any) => (
        <View key={r.id} style={{ padding: 11, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: hexA(stCol(r.status), 0.2), borderLeftWidth: 3, borderLeftColor: stCol(r.status), gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
            <Mono style={{ flex: 1, fontSize: 9.5, color: C.muted3 }}>{istD(r.created_at)}</Mono>
            <Badge text={pretty(r.status)} color={stCol(r.status)} />
          </View>
          <Body style={{ fontSize: 12.5, color: '#fff' }}>{r.problem_statement}</Body>
          {r.remark ? <Body style={{ fontSize: 11.5, color: C.muted2 }}>{r.remark}</Body> : null}
          {r.assigned_doctor ? <Body style={{ fontSize: 11, color: C.blue }}>Dr. {r.assigned_doctor}{r.scheduled_at ? ` · ${istDT(r.scheduled_at)}` : ''}</Body> : null}
          {r.doctor_notes ? <Body style={{ fontSize: 11.5, color: C.muted2 }} numberOfLines={4}><Text style={{ color: C.muted3, fontFamily: F.bodySemi }}>Doctor notes: </Text>{r.doctor_notes}</Body> : null}
          {r.requesterName ? <Mono style={{ fontSize: 8.5, color: C.muted3 }}>REQUESTED BY {r.requesterName.toUpperCase()}</Mono> : null}
        </View>
      ))}
    </TabCard>
  );
}

/* ---------- Notes (remarks + statements + tickets) ---------- */
function NotesTab({ clientId, crmId }: { clientId: string; crmId: string | null }) {
  const remarksQ = useClientRemarks(clientId);
  const stmtsQ = useClientStatements(clientId);
  const ticketsQ = useClientTickets(clientId);
  const addRemarkM = useAddRemark();
  const addStmtM = useAddStatement();
  const [note, setNote] = React.useState('');
  const [stmtOpen, setStmtOpen] = React.useState(false);
  const [stmt, setStmt] = React.useState('');
  const [stmtCtx, setStmtCtx] = React.useState('');
  const [stmtApproved, setStmtApproved] = React.useState(false);

  const addNote = async () => {
    if (!crmId || !note.trim()) return;
    try { await addRemarkM.mutateAsync({ clientId, authorId: crmId, content: note }); setNote(''); }
    catch (e: any) { Alert.alert("Couldn't save note", e?.message ?? 'Try again.'); }
  };
  const addStatement = async () => {
    if (!crmId || !stmt.trim()) return;
    try {
      await addStmtM.mutateAsync({ clientId, crmId, statement: stmt, context: stmtCtx || null, approved: stmtApproved });
      setStmt(''); setStmtCtx(''); setStmtApproved(false); setStmtOpen(false);
    } catch (e: any) { Alert.alert("Couldn't save statement", e?.message ?? 'Try again.'); }
  };

  return (
    <TabCard accent={C.gold}>
      {/* Internal notes */}
      <SectionHead icon="bubble" color={C.gold} title="Notes & Statements" />
      <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.muted3 }}>INTERNAL NOTES</Mono>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
        <TextInput value={note} onChangeText={setNote} placeholder="Add a note about this client…" placeholderTextColor={C.muted3} multiline style={[INPUT, { flex: 1, minHeight: 44, textAlignVertical: 'top' }]} />
        <Pressable onPress={addNote} disabled={!note.trim() || addRemarkM.isPending} style={{ width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: hexA(C.orange, 0.14), borderWidth: 1, borderColor: hexA(C.orange, 0.4), opacity: note.trim() ? 1 : 0.5 }}>
          <Icon name="send" size={17} color={C.orange} strokeWidth={2.2} />
        </Pressable>
      </View>
      {remarksQ.isLoading ? <Empty text="Loading…" /> : (remarksQ.data ?? []).length === 0 ? <Empty text="No notes yet." /> : (remarksQ.data ?? []).slice(0, 15).map((r: any) => (
        <View key={r.id} style={{ padding: 10, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.22)', gap: 4 }}>
          <Body style={{ fontSize: 12.5, color: C.ink3 }}>{r.content}</Body>
          <Mono style={{ fontSize: 8.5, color: C.muted3 }}>{r.authorName ? `${r.authorName.toUpperCase()} · ` : ''}{istDT(r.created_at)}</Mono>
        </View>
      ))}

      {/* Statements */}
      <View style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.06)' }} />
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Mono style={{ flex: 1, fontSize: 8.5, letterSpacing: 0.7, color: C.muted3 }}>CLIENT STATEMENTS</Mono>
        <Pressable onPress={() => setStmtOpen(!stmtOpen)} style={{ paddingVertical: 5, paddingHorizontal: 11, borderRadius: 999, backgroundColor: hexA(C.gold, 0.12), borderWidth: 1, borderColor: hexA(C.gold, 0.35) }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 10.5, color: C.gold }}>{stmtOpen ? 'Close' : '+ Record'}</Text>
        </Pressable>
      </View>
      {stmtOpen ? (
        <View style={{ padding: 11, borderRadius: 13, backgroundColor: hexA(C.gold, 0.05), borderWidth: 1, borderColor: hexA(C.gold, 0.25), gap: 8 }}>
          <TextInput value={stmt} onChangeText={setStmt} placeholder="What did the client say? *" placeholderTextColor={C.muted3} multiline style={[INPUT, { minHeight: 54, textAlignVertical: 'top' }]} />
          <TextInput value={stmtCtx} onChangeText={setStmtCtx} placeholder="Context (optional)" placeholderTextColor={C.muted3} style={INPUT} />
          <Pressable onPress={() => setStmtApproved(!stmtApproved)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ width: 18, height: 18, borderRadius: 5, borderWidth: 1.5, borderColor: stmtApproved ? C.gold : C.muted3, backgroundColor: stmtApproved ? hexA(C.gold, 0.3) : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
              {stmtApproved ? <Icon name="checks" size={11} color={C.gold} strokeWidth={2.6} /> : null}
            </View>
            <Body style={{ fontSize: 11.5, color: C.muted }}>Approved for marketing use</Body>
          </Pressable>
          <GradientBtn label="Save Statement" onPress={addStatement} disabled={!stmt.trim()} busy={addStmtM.isPending} />
        </View>
      ) : null}
      {(stmtsQ.data ?? []).length === 0 ? (stmtsQ.isLoading ? <Empty text="Loading…" /> : <Empty text="No statements recorded." />) : (stmtsQ.data ?? []).slice(0, 10).map((s: any) => (
        <View key={s.id} style={{ padding: 10, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.22)', borderLeftWidth: 3, borderLeftColor: C.gold, gap: 4 }}>
          <Body style={{ fontSize: 12.5, color: '#fff', fontStyle: 'italic' }}>“{s.statement}”</Body>
          {s.context ? <Body style={{ fontSize: 11, color: C.muted2 }}>{s.context}</Body> : null}
          <Mono style={{ fontSize: 8.5, color: C.muted3 }}>{istD(s.recorded_at)}{s.is_approved_for_marketing ? ' · MARKETING OK' : ''}</Mono>
        </View>
      ))}

      {/* Tickets */}
      <View style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.06)' }} />
      <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.muted3 }}>SUPPORT TICKETS</Mono>
      {ticketsQ.isLoading ? <Empty text="Loading…" /> : (ticketsQ.data ?? []).length === 0 ? <Empty text="No tickets raised." /> : (ticketsQ.data ?? []).slice(0, 10).map((t: any) => {
        const col = t.status === 'resolved' || t.status === 'closed' ? C.green : t.escalated ? C.red : C.blue;
        return (
          <View key={t.id} style={{ padding: 10, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.22)', borderLeftWidth: 3, borderLeftColor: col, gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
              <Body style={{ flex: 1, fontSize: 12.5, fontFamily: F.bodySemi, color: '#fff' }} numberOfLines={1}>{t.subject || pretty(t.category)}</Body>
              <Badge text={pretty(t.status)} color={col} />
            </View>
            {t.description ? <Body style={{ fontSize: 11.5, color: C.muted2 }} numberOfLines={2}>{t.description}</Body> : null}
            <Mono style={{ fontSize: 8.5, color: C.muted3 }}>{istD(t.created_at)}{t.escalated ? ' · ESCALATED' : ''}</Mono>
          </View>
        );
      })}
    </TabCard>
  );
}

/* ============================== SHEETS ============================== */
function RosterSheet({ visible, onClose, clientId, onCreate }: { visible: boolean; onClose: () => void; clientId: string; onCreate: () => void }) {
  const rosterQ = useUpcomingRoster(visible ? clientId : null);
  return (
    <SheetShell visible={visible} onClose={onClose} accent={C.gold} icon="calendar" title="Upcoming Roster" subtitle="SCHEDULED SESSIONS">
      <Pressable onPress={onCreate}>
        <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 12, borderRadius: 12 }}>
          <Icon name="calPlus" size={14} color="#fff" strokeWidth={2.4} />
          <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: '#fff' }}>Create Roster</Text>
        </LinearGradient>
      </Pressable>
      {rosterQ.isLoading ? <Empty text="Loading…" /> : (rosterQ.data ?? []).length === 0 ? <Empty text="No upcoming sessions scheduled." /> : (rosterQ.data ?? []).map((s: any) => (
        <View key={s.id} style={{ padding: 12, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: hexA(C.gold, 0.2), borderLeftWidth: 3, borderLeftColor: C.gold, gap: 5 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Body style={{ flex: 1, fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{pretty(s.modality || s.session_type)}</Body>
            <Badge text={pretty(s.status)} color={C.gold} />
          </View>
          <Body style={{ fontSize: 12, color: C.muted2 }}>{istDT(s.scheduled_datetime)} · {s.trainerName}</Body>
        </View>
      ))}
    </SheetShell>
  );
}

function TaskSheet({ visible, onClose, crmId, taggedId, clientName }: { visible: boolean; onClose: () => void; crmId: string | null; taggedId: string; clientName: string }) {
  const createM = useCreateCrmTask();
  const [title, setTitle] = React.useState('');
  const [desc, setDesc] = React.useState('');
  const [priority, setPriority] = React.useState<string>('medium');
  const [category, setCategory] = React.useState<string>('client_follow_up');
  const [dueDays, setDueDays] = React.useState<number | null>(null);
  const submit = async () => {
    if (!crmId || !title.trim()) return;
    const dueDate = dueDays != null ? new Date(Date.now() + dueDays * 864e5).toISOString() : null;
    try {
      await createM.mutateAsync({ crmId, taggedId, title, description: desc, priority, category, dueDate });
      setTitle(''); setDesc(''); setPriority('medium'); setDueDays(null);
      onClose();
      Alert.alert('Task created', `Task added for ${clientName}.`);
    } catch (e: any) { Alert.alert("Couldn't create task", e?.message ?? 'Try again.'); }
  };
  return (
    <SheetShell visible={visible} onClose={onClose} accent={C.blue} icon="checks" title="New Task" subtitle={`TAGGED · ${clientName.toUpperCase()}`}>
      <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.muted3 }}>TITLE *</Mono>
      <TextInput value={title} onChangeText={setTitle} placeholder="What needs doing?" placeholderTextColor={C.muted3} style={INPUT} />
      <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.muted3 }}>DESCRIPTION</Mono>
      <TextInput value={desc} onChangeText={setDesc} placeholder="Details (optional)" placeholderTextColor={C.muted3} multiline style={[INPUT, { minHeight: 60, textAlignVertical: 'top' }]} />
      <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.muted3 }}>PRIORITY</Mono>
      <ChipRow items={TASK_PRIORITIES} sel={priority} onSel={setPriority} color={priority === 'urgent' ? C.red : priority === 'high' ? C.orange : C.blue} />
      <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.muted3 }}>CATEGORY</Mono>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {TASK_CATEGORIES.map(([id, label]) => {
          const active = category === id;
          return (
            <AnimChip key={id} active={active} onPress={() => setCategory(id)} style={{ paddingVertical: 7, paddingHorizontal: 11, borderRadius: 999, backgroundColor: active ? hexA(C.gold, 0.14) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.gold, 0.45) : 'rgba(255,255,255,0.09)' }}>
              <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 11, color: active ? C.gold : C.muted }}>{label}</Text>
            </AnimChip>
          );
        })}
      </View>
      <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.muted3 }}>DUE</Mono>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {([[null, 'None'], [0, 'Today'], [1, '+1 day'], [3, '+3 days'], [7, '+7 days']] as [number | null, string][]).map(([v, lbl]) => {
          const active = dueDays === v;
          return (
            <AnimChip key={lbl} grow active={active} onPress={() => setDueDays(v)} style={{ alignItems: 'center', paddingVertical: 8, borderRadius: 10, backgroundColor: active ? hexA(C.blue, 0.14) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.blue, 0.45) : 'rgba(255,255,255,0.09)' }}>
              <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 10.5, color: active ? C.blue : C.muted }}>{lbl}</Text>
            </AnimChip>
          );
        })}
      </View>
      <GradientBtn label="Create Task" onPress={submit} disabled={!title.trim()} busy={createM.isPending} />
    </SheetShell>
  );
}

function ConsultSheet({ visible, onClose, clientId, crmId, clientName }: { visible: boolean; onClose: () => void; clientId: string; crmId: string | null; clientName: string }) {
  const bookM = useBookConsultation();
  const [problem, setProblem] = React.useState('');
  const [remark, setRemark] = React.useState('');
  const submit = async () => {
    if (!crmId || !problem.trim()) return;
    try {
      await bookM.mutateAsync({ clientId, requestedBy: crmId, problem, remark: remark || null });
      setProblem(''); setRemark('');
      onClose();
      Alert.alert('Request sent', 'The doctor team will schedule this consultation.');
    } catch (e: any) { Alert.alert("Couldn't book", e?.message ?? 'Try again.'); }
  };
  return (
    <SheetShell visible={visible} onClose={onClose} accent={C.red} icon="heart" title="Book Doctor Consultation" subtitle={clientName.toUpperCase()}>
      <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.muted3 }}>PROBLEM STATEMENT *</Mono>
      <TextInput value={problem} onChangeText={setProblem} placeholder="Describe the concern the doctor should look at…" placeholderTextColor={C.muted3} multiline maxLength={1000} style={[INPUT, { minHeight: 90, textAlignVertical: 'top' }]} />
      <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.muted3 }}>REMARK (OPTIONAL)</Mono>
      <TextInput value={remark} onChangeText={setRemark} placeholder="Anything else the doctor should know" placeholderTextColor={C.muted3} multiline maxLength={500} style={[INPUT, { minHeight: 54, textAlignVertical: 'top' }]} />
      <Body style={{ fontSize: 11, color: C.muted3 }}>A pending request is created — the medical team assigns a doctor and schedules the slot.</Body>
      <GradientBtn label="Send Request" onPress={submit} disabled={!problem.trim()} busy={bookM.isPending} />
    </SheetShell>
  );
}

function BioSheet({ visible, onClose, clientId }: { visible: boolean; onClose: () => void; clientId: string }) {
  const bioQ = useClientBio(visible ? clientId : null);
  const saveM = useSaveBio();
  const [values, setValues] = React.useState<Record<string, string | null>>({});
  const [notes, setNotes] = React.useState('');
  const [family, setFamily] = React.useState<{ id: string; name: string; relationship: string }[]>([]);
  const [seeded, setSeeded] = React.useState(false);
  React.useEffect(() => {
    if (visible && !bioQ.isLoading && !seeded) {
      const v: Record<string, string | null> = {};
      BIO_SELECTS.forEach(([k]) => { v[k] = bioQ.data?.[k] ?? null; });
      setValues(v);
      setNotes(bioQ.data?.notes ?? '');
      setFamily(Array.isArray(bioQ.data?.family_members) ? bioQ.data.family_members.map((m: any) => ({ id: m.id ?? String(Math.random()), name: m.name ?? '', relationship: m.relationship ?? '' })) : []);
      setSeeded(true);
    }
    if (!visible && seeded) setSeeded(false);
  }, [visible, bioQ.isLoading, bioQ.data, seeded]);
  const submit = async () => {
    try {
      await saveM.mutateAsync({
        clientId,
        existingId: bioQ.data?.id ?? null,
        values: {
          ...values,
          notes: notes.trim() || null,
          family_members: family.filter((m) => m.name.trim()).map((m) => ({ id: m.id, name: m.name.trim(), relationship: m.relationship.trim() })),
        },
      });
      onClose();
    } catch (e: any) { Alert.alert("Couldn't save bio", e?.message ?? 'Try again.'); }
  };
  const GROUPS: { title: string; icon: string; color: string; keys: string[] }[] = [
    { title: 'Personality', icon: 'user', color: C.blue, keys: ['behaviour_type', 'decision_making_style', 'communication_preference'] },
    { title: 'Lifestyle', icon: 'activity', color: C.orange, keys: ['lifestyle_type', 'eating_preference', 'eating_out_frequency', 'travel_frequency', 'travel_type'] },
    { title: 'Social', icon: 'users', color: C.gold, keys: ['social_activity_level', 'network_size'] },
  ];
  const fieldOf = (key: string) => BIO_SELECTS.find(([k]) => k === key)!;
  const filled = BIO_SELECTS.filter(([k]) => values[k]).length;
  return (
    <SheetShell visible={visible} onClose={onClose} accent={C.blue} icon="user" title="Client Bio" subtitle={`LIFESTYLE & PERSONALITY · ${filled}/${BIO_SELECTS.length} FILLED`}>
      {bioQ.isLoading ? <Empty text="Loading…" /> : (
        <>
          {GROUPS.map((g) => (
            <View key={g.title} style={{ borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.26)', borderWidth: 1, borderColor: hexA(g.color, 0.18), overflow: 'hidden' }}>
              <View style={{ height: 2.5, backgroundColor: hexA(g.color, 0.45) }} />
              <View style={{ padding: 13, gap: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{ width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: hexA(g.color, 0.12) }}>
                    <Icon name={g.icon as any} size={14} color={g.color} strokeWidth={2.1} />
                  </View>
                  <Body style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{g.title}</Body>
                </View>
                {g.keys.map((key) => {
                  const [, label, options] = fieldOf(key);
                  return (
                    <View key={key} style={{ gap: 6 }}>
                      <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.muted3, textTransform: 'uppercase' }}>{label}</Mono>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                        {options.map((opt) => {
                          const active = values[key] === opt;
                          return (
                            <AnimChip key={opt} active={active} onPress={() => setValues((v) => ({ ...v, [key]: active ? null : opt }))} style={{ paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, backgroundColor: active ? hexA(g.color, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(g.color, 0.5) : 'rgba(255,255,255,0.09)' }}>
                              <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 11.5, color: active ? g.color : C.muted }}>{pretty(opt)}</Text>
                            </AnimChip>
                          );
                        })}
                      </View>
                    </View>
                  );
                })}
                {g.title === 'Social' ? (
                  <View style={{ gap: 7 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Mono style={{ flex: 1, fontSize: 8.5, letterSpacing: 0.7, color: C.muted3 }}>FAMILY MEMBERS</Mono>
                      <Pressable onPress={() => setFamily((f) => [...f, { id: String(Date.now()), name: '', relationship: '' }])} style={{ paddingVertical: 5, paddingHorizontal: 11, borderRadius: 999, backgroundColor: hexA(g.color, 0.12), borderWidth: 1, borderColor: hexA(g.color, 0.35) }}>
                        <Text style={{ fontFamily: F.bodyBold, fontSize: 10.5, color: g.color }}>+ Add</Text>
                      </Pressable>
                    </View>
                    {family.length === 0 ? <Body style={{ fontSize: 11, color: C.muted3 }}>None added yet.</Body> : family.map((m, i) => (
                      <View key={m.id} style={{ flexDirection: 'row', gap: 7, alignItems: 'center' }}>
                        <TextInput value={m.name} onChangeText={(t) => setFamily((f) => f.map((x, j) => (j === i ? { ...x, name: t } : x)))} placeholder="Name" placeholderTextColor={C.muted3} style={[INPUT, { flex: 1.2 }]} />
                        <TextInput value={m.relationship} onChangeText={(t) => setFamily((f) => f.map((x, j) => (j === i ? { ...x, relationship: t } : x)))} placeholder="Relation" placeholderTextColor={C.muted3} style={[INPUT, { flex: 1 }]} />
                        <Pressable onPress={() => setFamily((f) => f.filter((_x, j) => j !== i))} hitSlop={8} style={{ width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: hexA(C.red, 0.1) }}>
                          <Icon name="close" size={13} color={C.red} strokeWidth={2.3} />
                        </Pressable>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            </View>
          ))}
          <View style={{ gap: 6 }}>
            <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.muted3 }}>NOTES</Mono>
            <TextInput value={notes} onChangeText={setNotes} placeholder="Anything else worth remembering…" placeholderTextColor={C.muted3} multiline style={[INPUT, { minHeight: 70, textAlignVertical: 'top' }]} />
          </View>
          <GradientBtn label={bioQ.data ? 'Update Bio' : 'Save Bio'} onPress={submit} busy={saveM.isPending} />
        </>
      )}
    </SheetShell>
  );
}

function CredsSheet({ visible, onClose, client }: { visible: boolean; onClose: () => void; client: any }) {
  const credsQ = useClientCredentials(visible ? client : null);
  const c = credsQ.data;
  const [copied, setCopied] = React.useState<string | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const copy = async (what: string, text: string) => {
    try {
      await Clipboard.setStringAsync(text);
      setCopied(what);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(null), 1600);
    } catch { Alert.alert("Couldn't copy", 'Long-press the value to copy manually.'); }
  };
  const CredRow = ({ label, value, mono, id }: { label: string; value: string; mono?: boolean; id: string }) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <View style={{ flex: 1 }}>
        <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.muted3 }}>{label}</Mono>
        <Text selectable numberOfLines={1} style={{ fontSize: 14.5, color: '#fff', marginTop: 3, fontFamily: mono ? F.mono : F.bodySemi }}>{value}</Text>
      </View>
      <Pressable onPress={() => copy(id, value)} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 11, backgroundColor: copied === id ? hexA(C.green, 0.16) : 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: copied === id ? hexA(C.green, 0.5) : 'rgba(255,255,255,0.12)' }}>
        <Icon name={copied === id ? 'checks' : 'file'} size={13} color={copied === id ? C.green : C.muted} strokeWidth={2.2} />
        <Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: copied === id ? C.green : C.muted }}>{copied === id ? 'Copied' : 'Copy'}</Text>
      </Pressable>
    </View>
  );
  return (
    <SheetShell visible={visible} onClose={onClose} accent={C.green} icon="shield" title="App Credentials" subtitle="CLIENT LOGIN">
      {credsQ.isLoading ? <Empty text="Loading…" /> : !c ? <Empty text="Couldn't resolve credentials." /> : (
        <>
          {!c.onApp ? (
            <View style={{ padding: 11, borderRadius: 12, backgroundColor: hexA(C.gold, 0.07), borderWidth: 1, borderColor: hexA(C.gold, 0.3) }}>
              <Body style={{ fontSize: 12, color: C.gold }}>This client isn't on the app yet — these are the credentials to share when onboarding them.</Body>
            </View>
          ) : null}
          <View style={{ padding: 13, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.28)', borderWidth: 1, borderColor: hexA(C.green, 0.22), gap: 12 }}>
            <CredRow id="email" label="EMAIL" value={c.email} />
            <View style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.06)' }} />
            <CredRow id="pass" label="DEFAULT PASSWORD" value={c.password} mono />
          </View>
          <Pressable onPress={() => copy('both', `Email: ${c.email}\nPassword: ${c.password}`)}>
            <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 12, borderRadius: 12 }}>
              <Icon name={copied === 'both' ? 'checks' : 'file'} size={14} color="#fff" strokeWidth={2.4} />
              <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: '#fff' }}>{copied === 'both' ? 'Copied Both ✓' : 'Copy Email + Password'}</Text>
            </LinearGradient>
          </Pressable>
          <Body style={{ fontSize: 10.5, color: C.muted3 }}>The password follows the standard pattern; if the client changed it, they must use their own.</Body>
        </>
      )}
    </SheetShell>
  );
}

function AssignSheet({ visible, onClose, clientId }: { visible: boolean; onClose: () => void; clientId: string }) {
  const staffQ = useStaffDirectory();
  const assignQ = useClientAssignments(visible ? clientId : null);
  const toggleM = useToggleAssignment();
  const [query, setQuery] = React.useState('');
  const rows = new Map((assignQ.data ?? []).map((r) => [r.trainer_id, r]));
  const q = query.trim().toLowerCase();
  const staff = (staffQ.data ?? []).filter((s) => !q || s.name.toLowerCase().includes(q));
  const toggle = (staffId: string) => {
    const existing = rows.get(staffId);
    toggleM.mutate(
      { clientId, trainerId: staffId, existingRowId: existing?.id ?? null, makeActive: !(existing?.actively_training ?? false) },
      { onError: (e: any) => Alert.alert("Couldn't update", e?.message ?? 'Try again.') },
    );
  };
  return (
    <SheetShell visible={visible} onClose={onClose} accent={C.orange} icon="userPlus" title="Assign Team" subtitle="TRAINERS & DOCTORS">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 13, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
        <Icon name="search" size={15} color={C.muted3} strokeWidth={2} />
        <TextInput value={query} onChangeText={setQuery} placeholder="Search staff…" placeholderTextColor={C.muted3} autoCorrect={false} style={{ flex: 1, fontFamily: F.body, fontSize: 13.5, color: '#fff', padding: 0 }} />
      </View>
      {staffQ.isLoading || assignQ.isLoading ? <Empty text="Loading staff…" /> : staff.length === 0 ? <Empty text="No staff match." /> : staff.map((s) => {
        const active = rows.get(s.id)?.actively_training === true;
        return (
          <Pressable key={s.id} onPress={() => toggle(s.id)} disabled={toggleM.isPending} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: 12, borderRadius: 13, backgroundColor: active ? hexA(C.orange, 0.09) : 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: active ? hexA(C.orange, 0.4) : 'rgba(255,255,255,0.07)' }}>
            <MiniAvatar initial={initials(s.name)} colors={s.role === 'doctor' ? AVS[3] : AVS[0]} size={36} />
            <View style={{ flex: 1 }}>
              <Body style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{s.name}</Body>
              <Mono style={{ fontSize: 8.5, color: C.muted3, marginTop: 1 }}>{s.role.toUpperCase()}</Mono>
            </View>
            <View style={{ paddingVertical: 5, paddingHorizontal: 11, borderRadius: 999, backgroundColor: active ? hexA(C.orange, 0.16) : 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: active ? hexA(C.orange, 0.45) : 'rgba(255,255,255,0.1)' }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 10.5, color: active ? C.orange : C.muted }}>{active ? 'Assigned ✓' : 'Assign'}</Text>
            </View>
          </Pressable>
        );
      })}
    </SheetShell>
  );
}

function InsightSheet({ visible, onClose, clientId, clientName }: { visible: boolean; onClose: () => void; clientId: string; clientName: string }) {
  const insightM = useTenDayInsight();
  const ranFor = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (visible && ranFor.current !== clientId) {
      ranFor.current = clientId;
      insightM.mutate(clientId);
    }
    if (!visible) ranFor.current = null;
  }, [visible, clientId]);
  const data = insightM.data;
  const starters = Array.isArray(data?.conversation_starters) ? data!.conversation_starters : data?.conversation_starters ? [String(data.conversation_starters)] : [];
  return (
    <SheetShell visible={visible} onClose={onClose} accent={C.gold} icon="sparkle" title="10-Day AI Insight" subtitle={clientName.toUpperCase()}>
      {insightM.isPending ? (
        <View style={{ alignItems: 'center', gap: 10, paddingVertical: 30 }}>
          <ActivityIndicator color={C.gold} />
          <Body style={{ fontSize: 12.5, color: C.muted3 }}>Analysing the last 10 days…</Body>
        </View>
      ) : insightM.isError ? (
        <>
          <Empty text={`Couldn't generate insight: ${(insightM.error as any)?.message ?? 'service unavailable'}`} />
          <GradientBtn label="Retry" onPress={() => insightM.mutate(clientId)} />
        </>
      ) : data ? (
        <>
          {data.activity_snapshot ? (
            <View style={{ gap: 6 }}>
              <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.gold }}>ACTIVITY SNAPSHOT</Mono>
              <Body style={{ fontSize: 12.5, color: C.ink3, lineHeight: 19 }}>{data.activity_snapshot}</Body>
            </View>
          ) : null}
          {data.doctor_notes ? (
            <View style={{ gap: 6 }}>
              <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.red }}>DOCTOR NOTES</Mono>
              <Body style={{ fontSize: 12.5, color: C.ink3, lineHeight: 19 }}>{data.doctor_notes}</Body>
            </View>
          ) : null}
          {starters.length ? (
            <View style={{ gap: 8 }}>
              <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.blue }}>CONVERSATION STARTERS</Mono>
              {starters.map((s, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: 8, padding: 10, borderRadius: 12, backgroundColor: hexA(C.blue, 0.06), borderWidth: 1, borderColor: hexA(C.blue, 0.2) }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: C.blue }}>{i + 1}.</Text>
                  <Body style={{ flex: 1, fontSize: 12.5, color: C.ink3 }}>{String(s)}</Body>
                </View>
              ))}
            </View>
          ) : null}
          {!data.activity_snapshot && !data.doctor_notes && !starters.length ? <Empty text="No insight returned for this client." /> : null}
        </>
      ) : null}
    </SheetShell>
  );
}

function PauseSheet({ visible, onClose, clientId, crmId, activePause }: { visible: boolean; onClose: () => void; clientId: string; crmId: string | null; activePause: any | null }) {
  const pauseM = usePauseJourney();
  const resumeM = useResumeJourney();
  const [days, setDays] = React.useState<number | null>(14);
  const [reason, setReason] = React.useState('');
  const submit = async () => {
    if (!crmId || !reason.trim()) return;
    const today = new Date().toISOString().slice(0, 10);
    const end = days != null ? new Date(Date.now() + days * 864e5).toISOString().slice(0, 10) : null;
    try {
      await pauseM.mutateAsync({ clientId, crmId, pauseStart: today, pauseEnd: end, reason });
      setReason(''); onClose();
    } catch (e: any) { Alert.alert("Couldn't pause", e?.message ?? 'Try again.'); }
  };
  const resume = () => {
    if (!crmId || !activePause) return;
    Alert.alert('Resume journey?', 'The client will be marked active again and notified.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Resume', onPress: async () => {
          try {
            await resumeM.mutateAsync({ pauseId: activePause.id, clientId, crmId, pausedSince: activePause.pause_start });
            onClose();
          } catch (e: any) { Alert.alert("Couldn't resume", e?.message ?? 'Try again.'); }
        },
      },
    ]);
  };
  return (
    <SheetShell visible={visible} onClose={onClose} accent={C.purple} icon="clock" title={activePause ? 'Journey Paused' : 'Pause Journey'} subtitle={activePause ? `SINCE ${istD(activePause.pause_start).toUpperCase()}` : 'TEMPORARY HOLD'}>
      {activePause ? (
        <>
          <View style={{ padding: 13, borderRadius: 14, backgroundColor: hexA(C.purple, 0.07), borderWidth: 1, borderColor: hexA(C.purple, 0.3), gap: 8 }}>
            <Field label="Paused from" value={istD(activePause.pause_start)} />
            <Field label="Until" value={activePause.pause_end ? istD(activePause.pause_end) : 'Open-ended'} />
            {activePause.reason ? <Field label="Reason" value={activePause.reason} /> : null}
          </View>
          <GradientBtn label="Resume Journey" onPress={resume} busy={resumeM.isPending} />
        </>
      ) : (
        <>
          <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.muted3 }}>PAUSE FOR</Mono>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {([[7, '1 week'], [14, '2 weeks'], [30, '1 month'], [null, 'Open-ended']] as [number | null, string][]).map(([v, lbl]) => {
              const active = days === v;
              return (
                <AnimChip key={lbl} grow active={active} onPress={() => setDays(v)} style={{ alignItems: 'center', paddingVertical: 9, borderRadius: 11, backgroundColor: active ? hexA(C.purple, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.purple, 0.5) : 'rgba(255,255,255,0.09)' }}>
                  <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 10.5, color: active ? C.purple : C.muted }}>{lbl}</Text>
                </AnimChip>
              );
            })}
          </View>
          <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.muted3 }}>REASON *</Mono>
          <TextInput value={reason} onChangeText={setReason} placeholder="Why is the journey being paused?" placeholderTextColor={C.muted3} multiline style={[INPUT, { minHeight: 60, textAlignVertical: 'top' }]} />
          <Body style={{ fontSize: 11, color: C.muted3 }}>Pausing logs a communication entry automatically. Any sessions already on the roster stay scheduled — cancel them separately if needed.</Body>
          <GradientBtn label="Pause Journey" onPress={submit} disabled={!reason.trim()} busy={pauseM.isPending} />
        </>
      )}
    </SheetShell>
  );
}

function DiscontinueSheet({ visible, onClose, clientId, crmId, clientName }: { visible: boolean; onClose: () => void; clientId: string; crmId: string | null; clientName: string }) {
  const reqsQ = useDiscontinuationRequests(visible ? clientId : null);
  const reqM = useRequestDiscontinuation();
  const [category, setCategory] = React.useState<string>(DISCONTINUE_REASONS[0]);
  const [details, setDetails] = React.useState('');
  const pending = (reqsQ.data ?? []).find((r: any) => r.status === 'pending');
  const submit = () => {
    if (!crmId || !details.trim()) return;
    Alert.alert('Request discontinuation?', `This flags ${clientName} for discontinuation review. An admin will approve or reject it.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Send Request', style: 'destructive', onPress: async () => {
          try {
            await reqM.mutateAsync({ clientId, requestedBy: crmId, category, details });
            setDetails('');
          } catch (e: any) { Alert.alert("Couldn't send", e?.message ?? 'Try again.'); }
        },
      },
    ]);
  };
  const stCol = (s: string) => (s === 'approved' ? C.green : s === 'rejected' ? C.red : C.gold);
  return (
    <SheetShell visible={visible} onClose={onClose} accent={C.red} icon="alert" title="Request Discontinuation" subtitle={clientName.toUpperCase()}>
      {pending ? (
        <View style={{ padding: 12, borderRadius: 13, backgroundColor: hexA(C.gold, 0.07), borderWidth: 1, borderColor: hexA(C.gold, 0.35), gap: 4 }}>
          <Body style={{ fontSize: 12.5, color: C.gold, fontFamily: F.bodySemi }}>A request is already pending review.</Body>
          <Body style={{ fontSize: 11.5, color: C.muted2 }}>{pending.reason_category} — {pending.reason_details}</Body>
        </View>
      ) : (
        <>
          <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.muted3 }}>REASON CATEGORY</Mono>
          <ChipRow items={DISCONTINUE_REASONS} sel={category} onSel={setCategory} color={C.red} />
          <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.muted3 }}>DETAILS *</Mono>
          <TextInput value={details} onChangeText={setDetails} placeholder="Explain why this client should be discontinued…" placeholderTextColor={C.muted3} multiline style={[INPUT, { minHeight: 70, textAlignVertical: 'top' }]} />
          <GradientBtn label="Send for Review" onPress={submit} disabled={!details.trim()} busy={reqM.isPending} />
        </>
      )}
      {(reqsQ.data ?? []).length ? (
        <>
          <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.muted3, marginTop: 4 }}>PAST REQUESTS</Mono>
          {(reqsQ.data ?? []).map((r: any) => (
            <View key={r.id} style={{ padding: 10, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.22)', borderLeftWidth: 3, borderLeftColor: stCol(r.status), gap: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                <Body style={{ flex: 1, fontSize: 12, fontFamily: F.bodySemi, color: '#fff' }}>{r.reason_category}</Body>
                <Badge text={pretty(r.status)} color={stCol(r.status)} />
              </View>
              {r.reason_details ? <Body style={{ fontSize: 11.5, color: C.muted2 }} numberOfLines={3}>{r.reason_details}</Body> : null}
              <Mono style={{ fontSize: 8.5, color: C.muted3 }}>{istD(r.request_date || r.created_at)}</Mono>
            </View>
          ))}
        </>
      ) : null}
    </SheetShell>
  );
}
