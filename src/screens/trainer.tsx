import React from 'react';
import { View, Text, Pressable, ScrollView, Image, Modal, TextInput, Keyboard, Platform, PanResponder, Animated, Easing, Alert, ActivityIndicator, useWindowDimensions, Linking } from 'react-native';
import { backSwipeLock } from '../gestureLock';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { trackClientTab } from '../lib/amplitude';
import { FeatureTour, TRAINER_TOUR, TourLauncher } from '../components/featureTour';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, F, hexA, ORANGE_GRAD } from '../theme';
import { Icon, TrophyIcon, IconName } from '../icons';
import { useStore } from '../store';
import {
  Serif, Body, Mono, Card, StatCard, QuickAction, IconChip, GradientButton, ProgressBar, Pill, Avatar, AvatarPhoto, CountUp,
} from '../components/primitives';
import { useSidebarProfile, useUploadAvatar } from '../lib/navQueries';
import { Page, GreetingHeader, TitleBlock, BackLink, MiniStat, Badge, SessionCard, CollapsibleSessionCard, ActionBtn, MiniAvatar, HScroll } from './common';
import { AccountSwitch } from '../components/AccountSwitch';
import { QhpReviewAlert, HeldReportsAlert } from '../components/qhpAlerts';
import { OddsWordmark } from '../components/oddsAi';
import { BloodReportSheet, QhpReportSheet } from './reportDetail';
import { useAuth } from '../auth';
import { supabase, DEV_TRAINER_ID } from '../lib/supabase';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { QhpAssessmentForm, CoachPresenceModal, fetchHasPriorCompletedQHP } from './qhpAssessmentForm';
import { useTodayRoster, useTrainerStats, useTrainerProfile, useTrainerMonthSessions, useTrainerLeaderboard, useManagerLeaderboard, useManagerTeam, useManagerTeamLeaves, useManagerTeamIncidents, useManagerTeamRetention, useManagerTeamLateLogs, useManagerTeamRoster, useManagerTeamPlanOverview, useManagerTeamAcks, useManagerTeamAppAdoption, useTrainerSessionBreakdown, useTrainerReferralBreakdown, useFirstSessionAlert, istTimeParts, istDayLabel, istDate, useCancelScheduledSession, useRequestReschedule, useAddMissedRemark, lbMonthBounds, lbMonthLabel, LbBounds, RosterRow, ManagerTeamMember, MgrMonthFilter, usePlanExpiryMap, PlanExpiry, useTrainerAckSummary, useRequestRoster, useRosterDistance, SESSION_MODALITIES, useMyMonthSessionBreakdown } from '../lib/trainerQueries';
import { useMyClients, useClientDetail, useClientSessions, useClientPlans, useClientGoals, useClientReports, useClientBioAge, useClientProgression, useCreateWorkoutSession, useModalityGate, useWorkoutTemplates, useSaveWorkoutTemplate, useDeleteWorkoutTemplate, useClientHealthCheck, useSaveHealthData, useExerciseDb, useSessionExercises, uuidv4, HealthDataInput, useWeeklyProgressionAll, ackWeeklyReport, WeeklyProgressionRow, useApprovedPlansForLogging, usePartnerInfo, usePreviousExerciseData, checkDuplicateWorkoutToday, PlanExerciseRow, useClientDailyStats, useSaveClientHomeLocation } from '../lib/clientQueries';
import * as Location from 'expo-location';
import KvStorage from 'expo-sqlite/kv-store';
import { enqueueOutbox, getIsOnline, useIsOnline, useOutbox, retryOutboxItem, removeOutboxItem, drainOutbox, submitItem, updateOutboxItem, getOutboxItem, WorkoutLogOutboxPayload, OutboxItem, useSyncedNotices, dismissSyncedNotice } from '../lib/offline';
import { useClientThreadsUnread } from '../lib/clientThreadQueries';
import { ClientThreadsCard } from '../components/clientThreadsCard';
import { useQhpAssessments, useQhpPermissions, useQhpConnectAlerts, useMarkQhpConnected, useQhpAssessors, useQhpClients, useScheduleQhp, useRequestQhpReschedule, useClientMedicalHistory, useClientHealthReports, HealthReportItem, useParqLinks, useGenerateParqLink, qhpFormatDuration, qhpUrgency, QHP_TARGET_MINS } from '../lib/qhpQueries';
import { PdfPreview } from '../components/PdfPreview';
import { useMyCapabilities } from '../lib/capabilities';
import { QhpReports } from './qhpReports';
import { ServicesButton } from '../components/servicesButton';
import { SessionHandoffPopup } from '../components/sessionHandoff';
import { useQhpManager, useResolveQhpReschedule, useSetQhpManagerReview, useHoldQhp, useRescheduleQhpAssessment, useApproveQhpRequest, useQhpTracker, useClientLinked, useClientAssignedStaff, useQhpReviewDetail, useEditQhpRequest, useClientCredentials, useQhpAssignAssessorAlert, useAssessorPendingCount, useQhpInProgress, useQhpStats, useQhpTotals, QhpTotalsRow, useAddHeartMath, useDeleteQhp, computeQhpSlaDeadline, formatSlaRemaining, formatWaiting, waitUrgency } from '../lib/qhpManagerQueries';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { ic } from '../icons';
import {
  quickActions, stats, leaders, sessionCards, clientsBase, clientBanners, clientInfo, clientTabs,
  modalities, qhpTabDefs, qhpData, mgrTabDefs, mgrData, convos, events, mgrDefs,
} from '../data';
import { tones } from '../theme';

const AV_GRADS: [string, string][] = [['#FB8B3A', '#EE5E16'], ['#57C98A', '#2E9A63'], ['#7C8FE8', '#4A5AC8'], ['#9A7BEA', '#6E5BD0'], ['#E0A53C', '#C07C1E'], ['#4FD1C5', '#2C8A86'], ['#F687B3', '#C2568A'], ['#F0883E', '#C05621']];
const avColors = (s: string): [string, string] => AV_GRADS[[...(s || '?')].reduce((a, c) => a + c.charCodeAt(0), 0) % AV_GRADS.length];

/** Signed-in trainer id — falls back to Khalid only for the shared test account. */
export function useTrainerId(): string {
  const { session } = useAuth();
  const isTestAccount = session?.user?.email?.startsWith('rn-test-trainer');
  return !session ? '' : isTestAccount ? DEV_TRAINER_ID : session.user.id;
}

/* ============ SIGN IN ============
   The workspace is decided by the ACCOUNT (profiles.role) after real
   authentication — there is no role picker. CRM accounts open the CRM
   dashboard; every other staff role opens the trainer workspace. */
export function SignIn() {
  const { go, set } = useStore();
  const insets = useSafeAreaInsets();
  const { signIn } = useAuth();
  const [email, setEmail] = React.useState<string>('');
  const [password, setPassword] = React.useState<string>('');
  // Role dropdown — cosmetic/UX only (NO credential prefill): the workspace is
  // still decided by the ACCOUNT's real profiles.role after authentication.
  const ROLE_OPTS = [['crm', 'CRM', 'userCircle'], ['trainer', 'Trainer', 'dumbbell'], ['coach', 'Coach', 'crown'], ['ops', 'Operations', 'layers'], ['admin', 'Admin', 'shield'], ['doctor', 'Doctor', 'heart'], ['marketing', 'Marketing', 'trend']] as const;
  const [fill, setFill] = React.useState<(typeof ROLE_OPTS)[number][0]>('trainer');
  const pickRole = (id: (typeof ROLE_OPTS)[number][0]) => setFill(id);
  const [rolePickerOpen, setRolePickerOpen] = React.useState(false);
  const [showPw, setShowPw] = React.useState(false);
  const [authErr, setAuthErr] = React.useState<string | null>(null);
  const [signingIn, setSigningIn] = React.useState(false);
  const doSignIn = async () => {
    if (signingIn) return;
    setAuthErr(null);
    setSigningIn(true);
    // The selected role MUST match the account's REAL role (profiles.role) —
    // auth.signIn enforces it and signs the session back out on mismatch,
    // BEFORE any state can leak (so the Router never redirects).
    const { error, role: accountRole } = await signIn(email.trim(), password, fill);
    setSigningIn(false);
    if (error) {
      if (error.startsWith('wrong-role:')) {
        const real = error.slice('wrong-role:'.length);
        const label = ROLE_OPTS.find(([id]) => id === real)?.[1] ?? real;
        setAuthErr(`These credentials belong to a ${label} account — select "${label}" as your role and try again.`);
      } else {
        setAuthErr(error);
      }
      return;
    }
    const r = accountRole ?? 'trainer';
    set({ role: r }); // drawer/nav & home routes follow the real account role
    go(r === 'crm' ? 'crm-dashboard' : r === 'coach' ? 'coach-dashboard' : r === 'ops' ? 'ops-dashboard' : r === 'admin' ? 'admin-dashboard' : r === 'doctor' ? 'doctor-dashboard' : r === 'marketing' ? 'marketing-dashboard' : 'dashboard', true);
  };
  return (
    <ScrollView contentContainerStyle={{ paddingTop: insets.top + 90, paddingBottom: 40, paddingHorizontal: 22, minHeight: '100%' }}>
      <View style={{ alignItems: 'center', marginBottom: 30 }}>
        <OddsWordmark height={50} />
        <Body style={{ fontSize: 15, color: C.muted, marginTop: 14 }}>Sign in to access your dashboard</Body>
      </View>
      <Card colors={['rgba(58,34,20,0.45)', 'rgba(20,16,15,0.5)']} border="rgba(255,150,90,0.12)" radius={24} style={{ padding: 24, paddingHorizontal: 20 }}>
        {/* Role dropdown — visual selector only; the account's real role decides the workspace */}
        <Mono style={{ fontSize: 11, letterSpacing: 1.8, color: C.mono2, marginBottom: 9 }}>YOUR ROLE</Mono>
        <View style={{ marginBottom: 18 }}>
          <Pressable onPress={() => setRolePickerOpen((o) => !o)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 13, paddingHorizontal: 14, borderRadius: rolePickerOpen ? 0 : 14, borderTopLeftRadius: 14, borderTopRightRadius: 14, borderWidth: 1, borderColor: rolePickerOpen ? hexA(C.orange, 0.45) : 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.04)' }}>
            <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: hexA(C.orange, 0.13), alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={ROLE_OPTS.find(([id]) => id === fill)![2]} size={14} color={C.orange} strokeWidth={2} />
            </View>
            <Text style={{ flex: 1, fontFamily: F.bodySemi, fontSize: 14, color: '#fff' }}>{ROLE_OPTS.find(([id]) => id === fill)![1]}</Text>
            <Icon name={rolePickerOpen ? 'chevUp' : 'chevDown'} size={14} color={C.muted2} strokeWidth={2.2} />
          </Pressable>
          {rolePickerOpen ? (
            <View style={{ borderWidth: 1, borderTopWidth: 0, borderColor: hexA(C.orange, 0.45), borderBottomLeftRadius: 14, borderBottomRightRadius: 14, backgroundColor: 'rgba(20,16,14,0.98)', overflow: 'hidden' }}>
              {ROLE_OPTS.map(([id, label, ic], i) => {
                const active = fill === id;
                return (
                  <Pressable key={id} onPress={() => { pickRole(id); setRolePickerOpen(false); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: 'rgba(255,255,255,0.06)', backgroundColor: active ? hexA(C.orange, 0.09) : 'transparent' }}>
                    <Icon name={ic} size={14} color={active ? C.orange : C.muted} strokeWidth={2} />
                    <Text style={{ flex: 1, fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 13, color: active ? C.orange : '#fff' }}>{label}</Text>
                    {active ? <Icon path="M20 6 9 17l-5-5" size={14} color={C.orange} strokeWidth={2.6} /> : null}
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </View>
        <Mono style={{ fontSize: 11, letterSpacing: 1.8, color: C.mono2, marginBottom: 9 }}>EMAIL</Mono>
        <View style={inputStyle}>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="you@odds.fit"
            placeholderTextColor={C.muted3}
            autoCapitalize="none"
            keyboardType="email-address"
            style={{ color: '#fff', fontFamily: F.body, fontSize: 15, padding: 0 }}
          />
        </View>
        <Mono style={{ fontSize: 11, letterSpacing: 1.8, color: C.mono2, marginBottom: 9, marginTop: 18 }}>PASSWORD</Mono>
        <View style={[inputStyle, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            placeholderTextColor={C.muted3}
            secureTextEntry={!showPw}
            autoCapitalize="none"
            style={{ flex: 1, color: '#fff', fontFamily: F.body, fontSize: 15, padding: 0 }}
          />
          <Pressable onPress={() => setShowPw(!showPw)}>
            <Icon name="eye" size={20} color={showPw ? C.orange : C.mono2} strokeWidth={1.8} />
          </Pressable>
        </View>
        {authErr ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, padding: 11, borderRadius: 11, backgroundColor: hexA(C.red, 0.09), borderWidth: 1, borderColor: hexA(C.red, 0.3) }}>
            <Icon name="alert" size={14} color={C.red} strokeWidth={2.2} />
            <Body style={{ flex: 1, fontSize: 12, color: '#E0A090' }}>{authErr}</Body>
          </View>
        ) : null}
        <GradientButton label={signingIn ? 'Signing in…' : 'Sign In'} onPress={doSignIn} style={{ marginTop: 24 }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16, justifyContent: 'center' }}>
          <Icon name="shield" size={12} color={C.muted3} strokeWidth={2} />
          <Body style={{ fontSize: 11, color: C.muted3 }}>Your workspace opens based on your account role.</Body>
        </View>
      </Card>
    </ScrollView>
  );
}
const inputStyle = { width: '100%' as const, paddingVertical: 15, paddingHorizontal: 16, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.03)', marginBottom: 0 };

/* ============ TODAY'S ROSTER — per-session card ============ */
const PRE_WINDOW_MS = 60 * 60 * 1000; // 1h before
const POST_WINDOW_MS = 2 * 60 * 60 * 1000; // 2h after

/* ---------- Reschedule request sheet ---------- */
const RESCHED_DAYS = 14;
const RESCHED_SLOTS: string[] = (() => {
  const out: string[] = [];
  for (let h = 6; h <= 21; h++) {
    out.push(`${String(h).padStart(2, '0')}:00`);
    if (h < 21) out.push(`${String(h).padStart(2, '0')}:30`);
  }
  return out;
})();
const slotLabel = (hm: string) => {
  const [h, m] = hm.split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};
/** "2026-07-09" + "19:00:00" → "9 Jul · 7:00 PM" (IST wall-clock values from the backend). */
const proposedSlotLabel = (d: string | null, t: string | null) => {
  if (!d) return null;
  const dateLabel = new Date(`${d}T00:00:00+05:30`).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' });
  return t ? `${dateLabel} · ${slotLabel(t.slice(0, 5))}` : dateLabel;
};

const SLOT_BANDS: { label: string; slots: string[] }[] = [
  { label: 'MORNING', slots: RESCHED_SLOTS.filter((s) => s < '12:00') },
  { label: 'AFTERNOON', slots: RESCHED_SLOTS.filter((s) => s >= '12:00' && s < '17:00') },
  { label: 'EVENING', slots: RESCHED_SLOTS.filter((s) => s >= '17:00') },
];

function RescheduleSheet({ row, visible, onClose }: { row: RosterRow; visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const scrollRef = React.useRef<ScrollView>(null);
  const reschedM = useRequestReschedule();
  const [date, setDate] = React.useState<string | null>(null);
  const [slot, setSlot] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState('');
  const [localErr, setLocalErr] = React.useState<string | null>(null);
  const busy = reschedM.isPending;
  const err = reschedM.error as Error | null;

  // Keyboard height — same manual pattern as the app's other input-bearing sheets
  // (KeyboardAvoidingView does nothing inside an RN Modal on Android/edge-to-edge).
  const [kbH, setKbH] = React.useState(0);
  React.useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const s = Keyboard.addListener(showEvt, (e: any) => setKbH(e.endCoordinates?.height ?? 0));
    const h = Keyboard.addListener(hideEvt, () => setKbH(0));
    return () => { s.remove(); h.remove(); };
  }, []);

  // Fresh form every time the sheet opens.
  React.useEffect(() => {
    if (visible) { setDate(null); setSlot(null); setReason(''); setLocalErr(null); reschedM.reset(); }
  }, [visible]);

  const days = React.useMemo(
    () =>
      Array.from({ length: RESCHED_DAYS }, (_, i) => {
        const d = new Date(Date.now() + i * 86_400_000);
        return {
          iso: istDate(d),
          dow: d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short' }).toUpperCase(),
          day: d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric' }),
          mon: d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', month: 'short' }).toUpperCase(),
          tag: i === 0 ? 'TODAY' : i === 1 ? 'TMRW' : null,
        };
      }),
    [visible]
  );
  const nowIstHM = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false, hour: '2-digit', minute: '2-digit' });
  const slotDisabled = (s: string) => date === istDate() && s <= nowIstHM;
  const noSlotsLeftToday = date === istDate() && RESCHED_SLOTS.every(slotDisabled);
  const canSend = !!date && !!slot && !!reason.trim() && !busy;
  const { time, ampm } = istTimeParts(row.scheduled_datetime);

  const send = async () => {
    if (!canSend) return; // also guards double-taps while the mutation is in flight
    // Re-validate at send time: the sheet may have sat open past IST midnight,
    // or the picked slot may have slipped into the past while typing the reason.
    const todayIso = istDate();
    const nowHM = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false, hour: '2-digit', minute: '2-digit' });
    if (date! < todayIso || (date === todayIso && slot! <= nowHM)) {
      setLocalErr('That slot has already passed — pick a new date and time.');
      setSlot(null);
      if (date! < todayIso) setDate(null);
      return;
    }
    setLocalErr(null);
    try {
      await reschedM.mutateAsync({ id: row.id, reason, proposedDate: date!, proposedTime: slot! });
      onClose();
    } catch { /* error surfaced below */ }
  };

  const label = (text: string) => <Mono style={{ fontSize: 10, letterSpacing: 1.2, color: C.mono2, marginBottom: 8 }}>{text}</Mono>;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => !busy && onClose()}>
        <Pressable onPress={() => !busy && onClose()} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}>
          <Pressable onPress={() => {}} style={{ maxHeight: Math.min(winH * 0.88, winH - kbH - insets.top - 12), backgroundColor: C.sheetBg, borderTopLeftRadius: 26, borderTopRightRadius: 26, borderWidth: 1, borderColor: 'rgba(255,150,90,0.14)', paddingHorizontal: 18, paddingTop: 9, paddingBottom: (kbH > 0 ? 12 : insets.bottom + 18), marginBottom: kbH }}>
            <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.14)', marginBottom: 14 }} />
            <ScrollView ref={scrollRef} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <IconChip icon="calendar" color={C.orange} />
                <View style={{ flex: 1 }}>
                  <Serif style={{ fontSize: 20 }}>Request Reschedule</Serif>
                  <Body style={{ fontSize: 12.5, color: C.muted, marginTop: 1 }}>{row.client_name}</Body>
                </View>
                <Pressable onPress={() => !busy && onClose()} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="close" size={15} color="#B8B2AC" strokeWidth={2.3} />
                </Pressable>
              </View>

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: 12, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.3)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', marginBottom: 16 }}>
                <Icon name="clock" size={16} color={C.orange} strokeWidth={2} />
                <View style={{ flex: 1 }}>
                  <Mono style={{ fontSize: 9.5, letterSpacing: 0.8, color: C.muted3 }}>CURRENT SLOT</Mono>
                  <Body style={{ fontSize: 14, fontFamily: F.bodySemi, color: '#fff', marginTop: 1 }}>
                    {istDayLabel(row.scheduled_datetime)} · {time} {ampm}{row.modality ? `  ·  ${row.modality}` : ''}
                  </Body>
                </View>
              </View>

              {label('NEW DATE')}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 4 }} style={{ marginBottom: 16 }}>
                {days.map((d) => {
                  const sel = date === d.iso;
                  return (
                    <Pressable key={d.iso} onPress={() => { setDate(d.iso); setSlot(null); setLocalErr(null); }} style={{ width: 58, alignItems: 'center', paddingVertical: 9, borderRadius: 13, backgroundColor: sel ? hexA(C.orange, 0.14) : 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: sel ? hexA(C.orange, 0.45) : 'rgba(255,255,255,0.08)' }}>
                      <Mono style={{ fontSize: 8.5, letterSpacing: 0.8, color: sel ? C.orange : C.muted3 }}>{d.tag ?? d.dow}</Mono>
                      <Serif style={{ fontSize: 19, color: sel ? C.orange : C.ink, marginTop: 2 }}>{d.day}</Serif>
                      <Mono style={{ fontSize: 8.5, color: sel ? hexA(C.orange, 0.8) : C.faint }}>{d.mon}</Mono>
                    </Pressable>
                  );
                })}
              </ScrollView>

              {label('NEW TIME')}
              {!date || noSlotsLeftToday ? (
                <View style={{ alignItems: 'center', paddingVertical: 14, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.02)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', marginBottom: 16 }}>
                  <Body style={{ fontSize: 12, color: C.muted3 }}>{!date ? 'Pick a date first to choose a time.' : 'No slots left today — pick another day.'}</Body>
                </View>
              ) : (
                <View style={{ gap: 10, marginBottom: 16 }}>
                  {SLOT_BANDS.map((band) => {
                    const allGone = band.slots.every(slotDisabled);
                    if (allGone) return null;
                    return (
                      <View key={band.label}>
                        <Mono style={{ fontSize: 9, letterSpacing: 1.4, color: C.muted3, marginBottom: 6 }}>{band.label}</Mono>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
                          {band.slots.map((s) => {
                            const sel = slot === s;
                            const dis = slotDisabled(s);
                            return (
                              <Pressable key={s} onPress={dis ? undefined : () => { setSlot(s); setLocalErr(null); }} style={{ width: '23%', flexGrow: 1, maxWidth: '24%', alignItems: 'center', paddingVertical: 9, borderRadius: 11, backgroundColor: sel ? hexA(C.orange, 0.14) : 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: sel ? hexA(C.orange, 0.45) : 'rgba(255,255,255,0.08)', opacity: dis ? 0.3 : 1 }}>
                                <Text style={{ fontFamily: sel ? F.bodyBold : F.bodySemi, fontSize: 12, color: sel ? C.orange : C.ink3 }}>{slotLabel(s)}</Text>
                              </Pressable>
                            );
                          })}
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}

              {label('REASON *')}
              <TextInput
                value={reason}
                onChangeText={setReason}
                onFocus={() => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120)}
                placeholder="Why does this session need to move?"
                placeholderTextColor={C.muted3}
                multiline
                style={{ minHeight: 72, textAlignVertical: 'top', paddingVertical: 12, paddingHorizontal: 13, borderRadius: 13, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.03)', color: '#fff', fontFamily: F.body, fontSize: 14, marginBottom: 6 }}
              />

              {date && slot ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 6 }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.gold }} />
                  <Body style={{ flex: 1, fontSize: 11.5, color: C.gold }}>Proposing {proposedSlotLabel(date, slot)} — the client will be asked to approve.</Body>
                </View>
              ) : null}
              {date && slot && !reason.trim() ? (
                <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 6 }}>Add a short reason to send the request.</Body>
              ) : null}
              {localErr || err ? <Body style={{ fontSize: 12, color: C.red, marginTop: 8 }}>{localErr ?? err!.message}</Body> : null}

              <View style={{ opacity: canSend ? 1 : 0.45, marginTop: 16 }} pointerEvents={canSend ? 'auto' : 'none'}>
                <GradientButton label={busy ? 'Sending…' : 'Send Reschedule Request'} onPress={send} />
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>
    </Modal>
  );
}

/* ---------- Roster distance sheet: map + km + drive time to the client's home ---------- */
export function DistanceSheet({ row, visible, onClose }: { row: { client_id: string | null; client_name: string }; visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  // Fresh device fix as the origin (real "where I am now"); null → let the server
  // fall back to the hourly location log. undefined → still resolving, hold the query.
  const [origin, setOrigin] = React.useState<{ lat: number; lng: number } | null | undefined>(undefined);
  React.useEffect(() => {
    if (!visible) { setOrigin(undefined); return; }
    let alive = true;
    (async () => {
      try {
        let perm = await Location.getForegroundPermissionsAsync();
        if (!perm.granted && perm.canAskAgain) perm = await Location.requestForegroundPermissionsAsync();
        if (!perm.granted) { if (alive) setOrigin(null); return; }
        const pos = await new Promise<any>((resolve) => {
          const t = setTimeout(() => resolve(null), 10_000);
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
            .then((p) => { clearTimeout(t); resolve(p); })
            .catch(() => { clearTimeout(t); resolve(null); });
        });
        if (alive) setOrigin(pos ? { lat: pos.coords.latitude, lng: pos.coords.longitude } : null);
      } catch { if (alive) setOrigin(null); }
    })();
    return () => { alive = false; };
  }, [visible]);
  const distQ = useRosterDistance(row.client_id, visible && origin !== undefined, origin);
  const d = distQ.data;
  const failed = distQ.isError || (d && !d.ok);
  const errCode = d?.error ?? '';
  const friendly =
    errCode === 'no_trainer_location' ? "Your location hasn't been logged yet — reopen the app with location allowed, then try again."
    : errCode === 'stale_location' ? `Your last logged location is ${d?.locationAgeMin ?? '—'} min old — reopen the app to check in, then try again.`
    : errCode === 'no_client_location' ? "This client's home location hasn't been captured yet."
    : errCode === 'not_your_client' ? 'This client is not assigned to you.'
    : distQ.isError ? (distQ.error as Error).message
    : 'Could not compute the route. Try again in a moment.';

  const navigate = () => {
    if (d?.clientLat == null || d?.clientLng == null) return;
    Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${d.clientLat},${d.clientLng}&travelmode=driving`);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}>
        <Pressable onPress={() => {}} style={{ backgroundColor: C.sheetBg, borderTopLeftRadius: 26, borderTopRightRadius: 26, borderWidth: 1, borderColor: 'rgba(255,150,90,0.14)', paddingHorizontal: 18, paddingTop: 9, paddingBottom: insets.bottom + 18 }}>
          <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.14)', marginBottom: 14 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 }}>
            <IconChip icon="map" color={C.blue} />
            <View style={{ flex: 1 }}>
              <Serif style={{ fontSize: 20 }}>Distance to {row.client_name}</Serif>
              <Body style={{ fontSize: 12, color: C.muted, marginTop: 1 }}>To the client's captured home location</Body>
            </View>
            <Pressable onPress={onClose} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="close" size={15} color="#B8B2AC" strokeWidth={2.3} />
            </Pressable>
          </View>

          {origin === undefined || distQ.isLoading ? (
            <View style={{ alignItems: 'center', gap: 10, paddingVertical: 40 }}>
              <ActivityIndicator color={C.blue} />
              <Body style={{ fontSize: 12.5, color: C.muted3 }}>{origin === undefined ? 'Getting your location…' : 'Computing route…'}</Body>
            </View>
          ) : failed ? (
            <View style={{ flexDirection: 'row', gap: 10, padding: 14, borderRadius: 14, backgroundColor: hexA(C.orange, 0.07), borderWidth: 1, borderColor: hexA(C.orange, 0.25), marginBottom: 6 }}>
              <Icon name="alert" size={16} color={C.orange} strokeWidth={2} />
              <Body style={{ flex: 1, fontSize: 12.5, color: '#F0C89C', lineHeight: 18 }}>{friendly}</Body>
            </View>
          ) : d ? (
            <View style={{ gap: 13 }}>
              {d.mapImageBase64 ? (
                <View style={{ borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
                  <Image source={{ uri: `data:image/png;base64,${d.mapImageBase64}` }} style={{ width: '100%', aspectRatio: 1.6, backgroundColor: '#000' }} resizeMode="cover" />
                  <View style={{ position: 'absolute', bottom: 8, left: 8, flexDirection: 'row', gap: 8 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 3, paddingHorizontal: 8, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.65)' }}>
                      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: C.orange }} />
                      <Text style={{ fontFamily: F.bodySemi, fontSize: 9.5, color: '#fff' }}>You</Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 3, paddingHorizontal: 8, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.65)' }}>
                      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: C.green }} />
                      <Text style={{ fontFamily: F.bodySemi, fontSize: 9.5, color: '#fff' }}>Client home</Text>
                    </View>
                  </View>
                </View>
              ) : null}

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1, alignItems: 'center', paddingVertical: 14, borderRadius: 15, backgroundColor: hexA(C.blue, 0.08), borderWidth: 1, borderColor: hexA(C.blue, 0.25) }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 24, color: C.blue }}>{d.distanceKm}<Text style={{ fontSize: 12, color: hexA(C.blue, 0.7) }}> km</Text></Text>
                  <Mono style={{ fontSize: 8, letterSpacing: 0.8, color: C.muted3, marginTop: 2 }}>DISTANCE</Mono>
                </View>
                <View style={{ flex: 1, alignItems: 'center', paddingVertical: 14, borderRadius: 15, backgroundColor: hexA(C.green, 0.08), borderWidth: 1, borderColor: hexA(C.green, 0.25) }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 24, color: C.green }}>~{d.durationMin}<Text style={{ fontSize: 12, color: hexA(C.green, 0.7) }}> min</Text></Text>
                  <Mono style={{ fontSize: 8, letterSpacing: 0.8, color: C.muted3, marginTop: 2 }}>DRIVE TIME</Mono>
                </View>
              </View>

              <View style={{ gap: 4 }}>
                {d.originName ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                    <Icon name="pin" size={12} color={C.muted3} strokeWidth={2} />
                    <Body numberOfLines={2} style={{ flex: 1, fontSize: 11.5, color: C.muted2 }}>You are near {d.originName}</Body>
                  </View>
                ) : null}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                  <Icon name="clock" size={12} color={C.muted3} strokeWidth={2} />
                  <Body style={{ fontSize: 11.5, color: C.muted2 }}>
                    {d.locationAgeMin === 0 ? 'From your current location' : `Your location as of ${d.locationAgeMin} min ago`} · {d.traffic ? 'live traffic estimate' : d.approx ? 'approximate estimate' : 'estimated drive time'}
                  </Body>
                </View>
                {d.approx ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                    <Icon name="alert" size={12} color={C.gold} strokeWidth={2} />
                    <Body style={{ fontSize: 11.5, color: C.gold }}>Straight-line estimate — road distance may differ.</Body>
                  </View>
                ) : null}
              </View>

              <GradientButton label="Navigate in Google Maps" onPress={navigate} />
            </View>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/* ---------- Request Roster from CRM (mirrors web RequestRosterDialog) ---------- */
function RequestRosterSheet({ visible, onClose, trainerId }: { visible: boolean; onClose: () => void; trainerId: string }) {
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const scrollRef = React.useRef<ScrollView>(null);
  const clientsQ = useMyClients(trainerId);
  const reqM = useRequestRoster();
  const [rosterType, setRosterType] = React.useState<'single' | 'full'>('single');
  const [clientId, setClientId] = React.useState<string | null>(null);
  const [clientQ, setClientQ] = React.useState('');
  const [date, setDate] = React.useState<string | null>(null);
  const [slot, setSlot] = React.useState<string | null>(null);
  const [modality, setModality] = React.useState<string | null>(null);
  const [remark, setRemark] = React.useState('');
  const busy = reqM.isPending;
  const err = reqM.error as Error | null;

  const [kbH, setKbH] = React.useState(0);
  React.useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const s = Keyboard.addListener(showEvt, (e: any) => setKbH(e.endCoordinates?.height ?? 0));
    const h = Keyboard.addListener(hideEvt, () => setKbH(0));
    return () => { s.remove(); h.remove(); };
  }, []);

  React.useEffect(() => {
    if (visible) { setRosterType('single'); setClientId(null); setClientQ(''); setDate(null); setSlot(null); setModality(null); setRemark(''); reqM.reset(); }
  }, [visible]);

  // useMyClients already returns only actively_training assignments (web parity).
  const clients = clientsQ.data ?? [];
  const filteredClients = clientQ.trim()
    ? clients.filter((c) => c.full_name.toLowerCase().includes(clientQ.trim().toLowerCase()))
    : clients;
  const selClient = clients.find((c) => c.client_id === clientId) ?? null;

  const days = React.useMemo(
    () =>
      Array.from({ length: RESCHED_DAYS }, (_, i) => {
        const d = new Date(Date.now() + i * 86_400_000);
        return {
          iso: istDate(d),
          dow: d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short' }).toUpperCase(),
          day: d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric' }),
          mon: d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', month: 'short' }).toUpperCase(),
          tag: i === 0 ? 'TODAY' : i === 1 ? 'TMRW' : null,
        };
      }),
    [visible]
  );

  const isFull = rosterType === 'full';
  const canSend = !!clientId && !!remark.trim() && (isFull || (!!date && !!slot && !!modality)) && !busy;

  const send = async () => {
    if (!canSend) return;
    try {
      await reqM.mutateAsync({ clientId: clientId!, rosterType, date, time: slot, remark, modality });
      onClose();
      Alert.alert('Request sent', 'Roster request sent to CRM.');
    } catch { /* error surfaced below */ }
  };

  const label = (text: string) => <Mono style={{ fontSize: 10, letterSpacing: 1.2, color: C.mono2, marginBottom: 8 }}>{text}</Mono>;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => !busy && onClose()}>
      <Pressable onPress={() => !busy && onClose()} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}>
        <Pressable onPress={() => {}} style={{ maxHeight: Math.min(winH * 0.88, winH - kbH - insets.top - 12), backgroundColor: C.sheetBg, borderTopLeftRadius: 26, borderTopRightRadius: 26, borderWidth: 1, borderColor: 'rgba(255,150,90,0.14)', paddingHorizontal: 18, paddingTop: 9, paddingBottom: (kbH > 0 ? 12 : insets.bottom + 18), marginBottom: kbH }}>
          <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.14)', marginBottom: 14 }} />
          <ScrollView ref={scrollRef} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <IconChip icon="layers" color={C.orange} />
              <View style={{ flex: 1 }}>
                <Serif style={{ fontSize: 20 }}>Request Roster from CRM</Serif>
                <Body style={{ fontSize: 12.5, color: C.muted, marginTop: 1 }}>The client's CRM will build the schedule.</Body>
              </View>
              <Pressable onPress={() => !busy && onClose()} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="close" size={15} color="#B8B2AC" strokeWidth={2.3} />
              </Pressable>
            </View>

            {label('ROSTER TYPE')}
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
              {([['single', 'Single Day Roster'], ['full', 'Full Roster Schedule']] as const).map(([id, lbl]) => {
                const sel = rosterType === id;
                return (
                  <Pressable key={id} onPress={() => setRosterType(id)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 13, backgroundColor: sel ? hexA(C.orange, 0.12) : 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: sel ? hexA(C.orange, 0.45) : 'rgba(255,255,255,0.08)' }}>
                    <View style={{ width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, borderColor: sel ? C.orange : 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center' }}>
                      {sel ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.orange }} /> : null}
                    </View>
                    <Text style={{ flex: 1, fontFamily: sel ? F.bodyBold : F.bodySemi, fontSize: 12, color: sel ? C.orange : C.ink3 }}>{lbl}</Text>
                  </Pressable>
                );
              })}
            </View>

            {label('CLIENT *')}
            {selClient ? (
              <Pressable onPress={() => setClientId(null)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 13, backgroundColor: hexA(C.green, 0.08), borderWidth: 1, borderColor: hexA(C.green, 0.35), marginBottom: 16 }}>
                <Icon name="userCircle" size={16} color={C.green} strokeWidth={2} />
                <Body style={{ flex: 1, fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{selClient.full_name}</Body>
                <Mono style={{ fontSize: 9, color: C.muted3 }}>CHANGE</Mono>
              </Pressable>
            ) : (
              <View style={{ marginBottom: 16, gap: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)' }}>
                  <Icon name="search" size={14} color={C.muted3} strokeWidth={2} />
                  <TextInput value={clientQ} onChangeText={setClientQ} placeholder="Search your clients…" placeholderTextColor={C.muted3} style={{ flex: 1, paddingVertical: 10, fontFamily: F.bodySemi, fontSize: 13, color: '#fff' }} />
                </View>
                <View style={{ maxHeight: 190, borderRadius: 13, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
                  <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled">
                    {clientsQ.isLoading ? (
                      <Body style={{ fontSize: 12, color: C.muted3, textAlign: 'center', paddingVertical: 16 }}>Loading clients…</Body>
                    ) : filteredClients.length === 0 ? (
                      <Body style={{ fontSize: 12, color: C.muted3, textAlign: 'center', paddingVertical: 16 }}>{clients.length === 0 ? 'No assigned clients' : 'No match.'}</Body>
                    ) : (
                      filteredClients.map((c, i) => (
                        <Pressable key={c.client_id} onPress={() => { setClientId(c.client_id); setClientQ(''); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 13, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: 'rgba(255,255,255,0.05)', backgroundColor: 'rgba(0,0,0,0.15)' }}>
                          <Body style={{ flex: 1, fontSize: 13, color: '#fff' }}>{c.full_name}</Body>
                          <Icon name="chevRight" size={13} color={C.muted3} strokeWidth={2.2} />
                        </Pressable>
                      ))
                    )}
                  </ScrollView>
                </View>
              </View>
            )}

            {!isFull ? (
              <>
                {label('DATE *')}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 4 }} style={{ marginBottom: 16 }}>
                  {days.map((d) => {
                    const sel = date === d.iso;
                    return (
                      <Pressable key={d.iso} onPress={() => setDate(d.iso)} style={{ width: 58, alignItems: 'center', paddingVertical: 9, borderRadius: 13, backgroundColor: sel ? hexA(C.orange, 0.14) : 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: sel ? hexA(C.orange, 0.45) : 'rgba(255,255,255,0.08)' }}>
                        <Mono style={{ fontSize: 8.5, letterSpacing: 0.8, color: sel ? C.orange : C.muted3 }}>{d.tag ?? d.dow}</Mono>
                        <Serif style={{ fontSize: 19, color: sel ? C.orange : C.ink, marginTop: 2 }}>{d.day}</Serif>
                        <Mono style={{ fontSize: 8.5, color: sel ? hexA(C.orange, 0.8) : C.faint }}>{d.mon}</Mono>
                      </Pressable>
                    );
                  })}
                </ScrollView>

                {label('TIME *')}
                {!date ? (
                  <View style={{ alignItems: 'center', paddingVertical: 14, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.02)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', marginBottom: 16 }}>
                    <Body style={{ fontSize: 12, color: C.muted3 }}>Pick a date first to choose a time.</Body>
                  </View>
                ) : (
                  <View style={{ gap: 10, marginBottom: 16 }}>
                    {SLOT_BANDS.map((band) => (
                      <View key={band.label}>
                        <Mono style={{ fontSize: 9, letterSpacing: 1.4, color: C.muted3, marginBottom: 6 }}>{band.label}</Mono>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
                          {band.slots.map((s) => {
                            const sel = slot === s;
                            return (
                              <Pressable key={s} onPress={() => setSlot(s)} style={{ width: '23%', flexGrow: 1, maxWidth: '24%', alignItems: 'center', paddingVertical: 9, borderRadius: 11, backgroundColor: sel ? hexA(C.orange, 0.14) : 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: sel ? hexA(C.orange, 0.45) : 'rgba(255,255,255,0.08)' }}>
                                <Text style={{ fontFamily: sel ? F.bodyBold : F.bodySemi, fontSize: 12, color: sel ? C.orange : C.ink3 }}>{slotLabel(s)}</Text>
                              </Pressable>
                            );
                          })}
                        </View>
                      </View>
                    ))}
                  </View>
                )}

                {label('MODALITY *')}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 16 }}>
                  {SESSION_MODALITIES.map((m) => {
                    const sel = modality === m;
                    return (
                      <Pressable key={m} onPress={() => setModality(sel ? null : m)} style={{ paddingVertical: 8, paddingHorizontal: 13, borderRadius: 999, backgroundColor: sel ? hexA(C.blue, 0.14) : 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: sel ? hexA(C.blue, 0.5) : 'rgba(255,255,255,0.08)' }}>
                        <Text style={{ fontFamily: sel ? F.bodyBold : F.bodySemi, fontSize: 12, color: sel ? C.blue : C.ink3 }}>{m}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            ) : null}

            {label('REMARK *')}
            <TextInput
              value={remark}
              onChangeText={setRemark}
              onFocus={() => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120)}
              placeholder={isFull ? 'Please try to add specific date and time as per the client information' : 'Reason / context for CRM'}
              placeholderTextColor={C.muted3}
              multiline
              style={{ minHeight: isFull ? 100 : 72, textAlignVertical: 'top', paddingVertical: 12, paddingHorizontal: 13, borderRadius: 13, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.03)', color: '#fff', fontFamily: F.body, fontSize: 14, marginBottom: 6 }}
            />

            {!isFull && date && slot ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 6 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.gold }} />
                <Body style={{ flex: 1, fontSize: 11.5, color: C.gold }}>Requesting {proposedSlotLabel(date, slot)} — the CRM will confirm the slot.</Body>
              </View>
            ) : null}
            {err ? <Body style={{ fontSize: 12, color: C.red, marginTop: 8 }}>{err.message}</Body> : null}

            <View style={{ opacity: canSend ? 1 : 0.45, marginTop: 16 }} pointerEvents={canSend ? 'auto' : 'none'}>
              <GradientButton label={busy ? 'Sending…' : 'Submit Request'} onPress={send} />
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// Same categories as the web app's MissedSessionRemarkDialog.
const MISSED_CATEGORIES = [
  { value: 'client_no_show', label: 'Client No-show' },
  { value: 'trainer_no_show', label: 'Trainer No-show' },
  { value: 'venue_issue', label: 'Venue Issue' },
  { value: 'emergency', label: 'Emergency' },
  { value: 'miscommunication', label: 'Miscommunication' },
  { value: 'forgot_to_log', label: 'Forgot to Log' },
  { value: 'other', label: 'Other' },
];

/* Gentle looping pulse around a child (used to draw the eye to a required action). */
function Pulse({ active, children }: { active: boolean; children: React.ReactNode }) {
  const v = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    if (!active) { v.setValue(0); return; }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 650, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: 650, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [active]);
  if (!active) return <>{children}</>;
  const scale = v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] });
  const opacity = v.interpolate({ inputRange: [0, 1], outputRange: [1, 0.68] });
  return <Animated.View style={{ flex: 1, transform: [{ scale }], opacity }}>{children}</Animated.View>;
}

/* Pulsing alert shown above the roster when overdue sessions still need a
   missed remark — adding the remark removes the card from the list. */
function MissedAlert({ count }: { count: number }) {
  const pulse = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 650, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 650, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);
  const iconScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] });
  const glow = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] });
  return (
    <Animated.View style={{ opacity: glow, flexDirection: 'row', alignItems: 'center', gap: 11, padding: 12, borderRadius: 14, backgroundColor: hexA(C.red, 0.09), borderWidth: 1, borderColor: hexA(C.red, 0.4), borderLeftWidth: 4, borderLeftColor: C.red }}>
      <Animated.View style={{ transform: [{ scale: iconScale }], width: 34, height: 34, borderRadius: 17, backgroundColor: hexA(C.red, 0.16), alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="alert" size={16} color={C.red} strokeWidth={2.3} />
      </Animated.View>
      <View style={{ flex: 1 }}>
        <Body style={{ fontSize: 13.5, fontFamily: F.bodyBold, color: '#fff' }}>
          {count} missed session{count === 1 ? '' : 's'} need{count === 1 ? 's' : ''} a remark
        </Body>
        <Body style={{ fontSize: 11.5, color: '#E0A090', marginTop: 1, lineHeight: 16 }}>
          Tap “Missed Remark” on each card below — once added, the card clears from this list.
        </Body>
      </View>
    </Animated.View>
  );
}

/* Radar ping around the route icon — marks the distance feature as new/live. */
export function MapPing({ color }: { color: string }) {
  const v = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 1600, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.delay(450),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);
  const scale = v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.65] });
  const opacity = v.interpolate({ inputRange: [0, 0.7, 1], outputRange: [0.5, 0.15, 0] });
  return <Animated.View style={{ position: 'absolute', width: 30, height: 30, borderRadius: 15, borderWidth: 1.5, borderColor: color, opacity, transform: [{ scale }] }} />;
}

/* Straight-line ≈ road distance (×1.35) + metro drive time (~22 km/h) — instant,
   offline, no API. The sheet gives the exact live-routed numbers on tap. */
export const approxTravel = (a: { lat: number; lng: number }, bLat: number, bLng: number) => {
  const R = 6371, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - a.lat), dLon = toRad(bLng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  const km = +(2 * R * Math.asin(Math.sqrt(h)) * 1.35).toFixed(1);
  return { km, min: Math.max(1, Math.round((km / 22) * 60)) };
};

function RosterCard({ row, trainerName, highlight, onAddWorkout, plans, devPos }: { row: RosterRow; trainerName: string; highlight?: boolean; onAddWorkout: () => void; plans?: PlanExpiry[]; devPos?: { lat: number; lng: number } | null }) {
  const cancelM = useCancelScheduledSession();
  const missedM = useAddMissedRemark();
  const [modal, setModal] = React.useState<null | 'cancel' | 'missed'>(null);
  const [reschedOpen, setReschedOpen] = React.useState(false);
  const [distOpen, setDistOpen] = React.useState(false);
  const [text, setText] = React.useState('');
  const [missedCat, setMissedCat] = React.useState<string | null>(null);
  // Cancel flow (web CancelTypePickerDialog → CancelSessionDialog): pick Normal vs Paid
  // (paid needs a second confirmation), then remark + optional photo attachment.
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [paidStep, setPaidStep] = React.useState(false);
  const [cancelPaid, setCancelPaid] = React.useState(false);
  const [att, setAtt] = React.useState<{ uri: string; name: string; mime: string } | null>(null);
  const openCancelPicker = () => {
    setText(''); setAtt(null); setCancelPaid(false); setPaidStep(false);
    cancelM.reset(); missedM.reset();
    setPickerOpen(true);
  };
  const pickAttachment = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow photo access to attach an image.'); return; }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.75 });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    setAtt({ uri: a.uri, name: a.fileName || `photo-${Date.now()}.jpg`, mime: a.mimeType || 'image/jpeg' });
  };

  const t = new Date(row.scheduled_datetime).getTime();
  const now = Date.now();
  const windowState: 'before' | 'inside' | 'after' =
    now < t - PRE_WINDOW_MS ? 'before' : now > t + POST_WINDOW_MS ? 'after' : 'inside';
  const { time, ampm } = istTimeParts(row.scheduled_datetime);

  const logged = !!row.workout_session_id;
  const isCancelled = (row.status ?? '').toLowerCase() === 'cancelled';
  const hasReq = !!row.reschedule_request;
  const rStatus = row.reschedule_status;
  const isApproved = rStatus === 'approved';
  const isRejected = rStatus === 'rejected';
  const isPending = hasReq && !rStatus;
  const trainerHasMissedRemark = Array.isArray(row.missed_remarks) && row.missed_remarks.some((r: any) => r?.by_role === 'trainer');
  const isOpenPast = row.is_open_past === true;
  const canAddWorkout = !isCancelled && !isOpenPast && (isPending || windowState === 'inside');
  const showReschedule = !logged && !isCancelled && !isPending;
  const isCarryover = istDate(new Date(row.scheduled_datetime)) !== istDate();
  const winStart = istTimeParts(new Date(t - PRE_WINDOW_MS).toISOString());
  const winEnd = istTimeParts(new Date(t + POST_WINDOW_MS).toISOString());

  // One primary state per card — drives the tint, the headline chip and the plain-language hint.
  const prime = isCancelled
    ? { label: 'Cancelled', color: C.red, hint: null as string | null }
    : logged
    ? { label: 'Logged', color: C.green, hint: null }
    : isOpenPast
    ? { label: 'Overdue', color: C.red, hint: trainerHasMissedRemark ? 'Remark saved · reschedule to put it back on the plan' : 'Missed session — reschedule it or add a remark' }
    : isPending
    ? {
        label: 'Reschedule pending',
        color: C.gold,
        hint: (() => {
          const slot = proposedSlotLabel(row.reschedule_proposed_date, row.reschedule_proposed_time);
          return slot ? `Proposed ${slot} · awaiting approval, you can still log` : 'Awaiting approval · you can still log this workout';
        })(),
      }
    : windowState === 'inside'
    ? { label: 'Ready to log', color: C.green, hint: `Log window open until ${winEnd.time} ${winEnd.ampm}` }
    : windowState === 'before'
    ? { label: 'Upcoming', color: C.blue, hint: `Logging opens at ${winStart.time} ${winStart.ampm}` }
    : { label: 'Window closed', color: C.red, hint: `Closed at ${winEnd.time} ${winEnd.ampm} — reschedule to log this session` };

  const submit = async () => {
    try {
      if (modal === 'cancel') await cancelM.mutateAsync({ id: row.id, remark: text, paid: cancelPaid, image: att ?? undefined });
      else if (modal === 'missed') await missedM.mutateAsync({ id: row.id, category: missedCat ?? '', remark: text });
      setModal(null); setText(''); setMissedCat(null); setAtt(null); setCancelPaid(false);
    } catch (e) { /* error surfaced below */ }
  };
  const busy = cancelM.isPending || missedM.isPending;
  const err = (cancelM.error || missedM.error) as Error | null;

  const chip = (label: string, color: string, filled = false) => (
    <View key={label} style={{ paddingVertical: 3, paddingHorizontal: 9, borderRadius: 999, backgroundColor: filled ? hexA(color, 0.13) : 'transparent', borderWidth: 1, borderColor: filled ? hexA(color, 0.35) : 'rgba(255,255,255,0.12)' }}>
      <Text style={{ fontFamily: F.bodySemi, fontSize: 10, color }}>{label}</Text>
    </View>
  );

  const Btn = ({ label, icon, color, onPress, disabled, primary }: { label: string; icon: any; color: string; onPress: () => void; disabled?: boolean; primary?: boolean }) => (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={{ flex: primary ? 1.45 : 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11, borderRadius: 12, borderWidth: 1, borderColor: disabled ? 'rgba(255,255,255,0.07)' : primary ? hexA(color, 0.45) : 'rgba(255,255,255,0.1)', backgroundColor: disabled ? 'rgba(255,255,255,0.03)' : primary ? hexA(color, 0.14) : 'rgba(255,255,255,0.03)', opacity: disabled ? 0.55 : 1 }}
    >
      <Icon name={icon} size={13} color={disabled ? C.muted3 : color} strokeWidth={2.2} />
      <Text style={{ fontFamily: primary ? F.bodyBold : F.bodySemi, fontSize: 12, color: disabled ? C.muted3 : color }} numberOfLines={1}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={{ borderRadius: 16, backgroundColor: highlight ? hexA(C.orange, 0.05) : 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: highlight ? hexA(C.orange, 0.4) : prime.label === 'Upcoming' ? 'rgba(255,255,255,0.08)' : hexA(prime.color, 0.3), padding: 13, gap: 10, opacity: isCancelled ? 0.6 : 1 }}>
      {/* Plan expiry strip (web PlanExpiryWarning, 42-day rule): days left per latest approved plan */}
      {plans && !isCancelled ? (
        plans.length === 0 ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 7, paddingHorizontal: 9, borderRadius: 10, backgroundColor: hexA(C.red, 0.08), borderWidth: 1, borderColor: hexA(C.red, 0.28) }}>
            <Icon name="alert" size={12} color={C.red} strokeWidth={2.2} />
            <Body style={{ flex: 1, fontSize: 10.5, color: '#E8A79A', lineHeight: 14 }}>No approved plan yet — make a training program and get it approved by coach on priority</Body>
          </View>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
            {plans.map((p) => {
              const pc = p.expired ? C.red : p.expiringSoon ? C.gold : C.green;
              const label = p.expired ? `${p.modality} plan expired` : `${p.modality} · ${p.daysLeft}d left`;
              return (
                <View key={p.modality} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 3.5, paddingHorizontal: 9, borderRadius: 999, backgroundColor: hexA(pc, p.expired ? 0.14 : 0.1), borderWidth: 1, borderColor: hexA(pc, p.expired ? 0.45 : 0.3) }}>
                  {p.expired || p.expiringSoon ? <Icon name="alert" size={10} color={pc} strokeWidth={2.4} /> : <Icon name="clock" size={10} color={pc} strokeWidth={2.2} />}
                  <Text style={{ fontFamily: p.expired ? F.bodyBold : F.bodySemi, fontSize: 10, color: pc }}>{label}</Text>
                </View>
              );
            })}
          </View>
        )
      ) : null}
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ minWidth: 64, alignItems: 'center', justifyContent: 'center', borderRadius: 12, paddingVertical: 8, paddingHorizontal: 10, backgroundColor: hexA(prime.color, 0.1), borderWidth: 1, borderColor: hexA(prime.color, 0.25) }}>
          {isCarryover ? <Mono style={{ fontSize: 8, letterSpacing: 0.8, color: C.mono2 }}>{istDayLabel(row.scheduled_datetime)}</Mono> : null}
          <Serif style={{ fontSize: 18, color: prime.color }}>{time}</Serif>
          <Mono style={{ fontSize: 8.5, color: C.mono2, marginTop: 1 }}>{ampm}</Mono>
        </View>
        <View style={{ flex: 1, justifyContent: 'center', gap: 7 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {logged ? <Icon name="checks" size={14} color={C.green} strokeWidth={2.4} /> : null}
            <Body numberOfLines={1} style={{ flex: 1, fontSize: 15, fontFamily: F.bodySemi, color: '#fff' }}>{row.client_name}</Body>
            {highlight ? (
              <View style={{ paddingVertical: 2.5, paddingHorizontal: 7, borderRadius: 6, backgroundColor: hexA(C.orange, 0.16), borderWidth: 1, borderColor: hexA(C.orange, 0.4) }}>
                <Text style={{ fontFamily: F.mono, fontSize: 8.5, letterSpacing: 1, color: C.orange }}>NEXT</Text>
              </View>
            ) : null}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
            {chip(prime.label, prime.color, true)}
            {/* Acknowledge status — only meaningful once the session is logged */}
            {logged && row.acknowledged != null ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 3, paddingHorizontal: 9, borderRadius: 999, backgroundColor: hexA(row.acknowledged ? C.green : C.gold, 0.12), borderWidth: 1, borderColor: hexA(row.acknowledged ? C.green : C.gold, 0.38) }}>
                <Icon name={row.acknowledged ? 'checks' : 'clock'} size={10} color={row.acknowledged ? C.green : C.gold} strokeWidth={2.4} />
                <Text style={{ fontFamily: F.bodySemi, fontSize: 10, color: row.acknowledged ? C.green : C.gold }}>
                  {row.acknowledged ? 'Acknowledged' : 'Ack pending'}
                </Text>
              </View>
            ) : null}
            {row.modality ? chip(row.modality, C.ink3) : null}
            {!isCancelled && !logged && row.status === 'confirmed' ? chip('Confirmed', C.green) : null}
            {isApproved ? chip('Resched approved', C.green, true) : null}
            {isRejected ? chip('Resched rejected', C.red, true) : null}
            {trainerHasMissedRemark && !isOpenPast ? chip('Remark logged', C.gold, true) : null}
            {row.paid_cancellation ? chip(
              row.admin_approval === 'approved' ? 'Paid Cancel Approved' : row.admin_approval === 'rejected' ? 'Paid Cancel Rejected' : 'Paid Cancel · Pending Admin',
              row.admin_approval === 'approved' ? C.green : row.admin_approval === 'rejected' ? C.red : C.gold,
              true
            ) : null}
          </View>
        </View>
      </View>

      {prime.hint ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 2 }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: prime.color }} />
          <Body style={{ flex: 1, fontSize: 11.5, color: hexA(prime.color, 0.95) }}>{prime.hint}</Body>
        </View>
      ) : null}

      {/* Distance strip — captured home + device fix → instant estimate; tap for live route */}
      {row.has_home_location && row.client_id && !isCancelled ? (() => {
        const est = devPos && row.home_lat != null && row.home_lng != null ? approxTravel(devPos, row.home_lat, row.home_lng) : null;
        return (
          <Pressable onPress={() => setDistOpen(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 11, borderRadius: 12, backgroundColor: hexA(C.blue, 0.06), borderWidth: 1, borderColor: hexA(C.blue, 0.26) }}>
            <View style={{ width: 30, height: 30, alignItems: 'center', justifyContent: 'center' }}>
              <MapPing color={C.blue} />
              <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: hexA(C.blue, 0.14), borderWidth: 1, borderColor: hexA(C.blue, 0.42), alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="route" size={14} color={C.blue} strokeWidth={2.1} />
              </View>
            </View>
            <View style={{ flex: 1 }}>
              {est ? (
                <>
                  <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: '#A9C6F0' }}>{est.km} km · ~{est.min} min drive</Text>
                  <Mono style={{ fontSize: 7.5, letterSpacing: 0.6, color: C.muted3, marginTop: 1 }}>FROM YOUR LOCATION · TAP FOR LIVE ROUTE</Mono>
                </>
              ) : (
                <>
                  <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: '#A9C6F0' }}>Distance to client's home</Text>
                  <Mono style={{ fontSize: 7.5, letterSpacing: 0.6, color: C.muted3, marginTop: 1 }}>TAP FOR ROUTE & DRIVE TIME</Mono>
                </>
              )}
            </View>
            <Icon name="chevRight" size={14} color={C.blue} strokeWidth={2.3} />
          </Pressable>
        );
      })() : null}

      {isCancelled || logged ? null : isOpenPast ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Btn primary label="Reschedule" icon="calendar" color={C.orange} onPress={() => setReschedOpen(true)} />
          <Pulse active={!trainerHasMissedRemark}>
            <Btn label={trainerHasMissedRemark ? 'Remark Logged' : 'Missed Remark'} icon="alert" color={C.gold} disabled={trainerHasMissedRemark} onPress={() => { setText(''); setMissedCat(null); cancelM.reset(); missedM.reset(); setModal('missed'); }} />
          </Pulse>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {canAddWorkout || windowState === 'before' ? (
            <Btn primary={canAddWorkout} label="Log Workout" icon="plus" color={C.green} disabled={!canAddWorkout} onPress={onAddWorkout} />
          ) : null}
          {showReschedule ? (
            <Btn primary={!canAddWorkout && windowState === 'after'} label="Reschedule" icon="calendar" color={C.orange} onPress={() => setReschedOpen(true)} />
          ) : null}
          <Btn label="Cancel" icon="close" color={C.red} onPress={openCancelPicker} />
        </View>
      )}

      {reschedOpen ? <RescheduleSheet row={row} visible onClose={() => setReschedOpen(false)} /> : null}
      {distOpen ? <DistanceSheet row={row} visible onClose={() => setDistOpen(false)} /> : null}

      {/* Cancel type picker (web CancelTypePickerDialog): Normal vs Paid, paid double-confirms */}
      <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
        <Pressable onPress={() => setPickerOpen(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center', padding: 22 }}>
          <Pressable onPress={() => {}} style={{ width: '100%', maxWidth: 360, backgroundColor: '#12100E', borderWidth: 1, borderColor: 'rgba(255,150,90,0.16)', borderRadius: 20, padding: 20, gap: 12 }}>
            {!paidStep ? (
              <>
                <Serif style={{ fontSize: 19 }}>Cancel Session</Serif>
                <Body style={{ fontSize: 12.5, color: C.muted2 }}>How should {row.client_name}'s session be cancelled?</Body>
                <Pressable onPress={() => { setCancelPaid(false); setPickerOpen(false); setModal('cancel'); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: 13, borderRadius: 14, backgroundColor: hexA(C.red, 0.07), borderWidth: 1, borderColor: hexA(C.red, 0.3) }}>
                  <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: hexA(C.red, 0.13), alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="close" size={15} color={C.red} strokeWidth={2.3} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: '#fff' }}>Cancel Session</Text>
                    <Body style={{ fontSize: 11, color: C.muted2, marginTop: 1 }}>Standard cancellation — no charge</Body>
                  </View>
                  <Icon name="chevRight" size={14} color={C.muted3} strokeWidth={2.2} />
                </Pressable>
                <Pressable onPress={() => setPaidStep(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: 13, borderRadius: 14, backgroundColor: hexA(C.gold, 0.07), borderWidth: 1, borderColor: hexA(C.gold, 0.3) }}>
                  <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: hexA(C.gold, 0.13), alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="rupee" size={15} color={C.gold} strokeWidth={2.2} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: '#fff' }}>Paid Cancellation</Text>
                    <Body style={{ fontSize: 11, color: C.muted2, marginTop: 1 }}>Last-moment cancel — counted as paid after admin approval</Body>
                  </View>
                  <Icon name="chevRight" size={14} color={C.muted3} strokeWidth={2.2} />
                </Pressable>
                <Pressable onPress={() => setPickerOpen(false)} style={{ alignItems: 'center', paddingVertical: 12, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
                  <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: C.ink }}>Dismiss</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Serif style={{ fontSize: 19 }}>Paid Cancellation?</Serif>
                <Body style={{ fontSize: 12.5, color: C.muted2, lineHeight: 18 }}>This marks the session as a last-moment paid cancellation and raises a claim that goes to admin for approval. Continue?</Body>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Pressable onPress={() => setPaidStep(false)} style={{ flex: 1, alignItems: 'center', paddingVertical: 13, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
                    <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: C.ink }}>Back</Text>
                  </Pressable>
                  <Pressable onPress={() => { setCancelPaid(true); setPickerOpen(false); setModal('cancel'); }} style={{ flex: 1, alignItems: 'center', paddingVertical: 13, borderRadius: 13, backgroundColor: hexA(C.gold, 0.16), borderWidth: 1, borderColor: hexA(C.gold, 0.45) }}>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: C.gold }}>Yes, continue</Text>
                  </Pressable>
                </View>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={modal !== null} transparent animationType="fade" onRequestClose={() => setModal(null)}>
        <Pressable onPress={() => !busy && setModal(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center', padding: 22 }}>
          <Pressable onPress={() => {}} style={{ width: '100%', maxWidth: 360, backgroundColor: '#12100E', borderWidth: 1, borderColor: 'rgba(255,150,90,0.16)', borderRadius: 20, padding: 20, gap: 14 }}>
            <Serif style={{ fontSize: 19 }}>{modal === 'cancel' ? (cancelPaid ? 'Paid Cancellation' : 'Cancel Session') : 'Add Missed Remark'}</Serif>
            <Body style={{ fontSize: 12.5, color: C.muted2 }}>
              {modal === 'cancel'
                ? cancelPaid
                  ? `Add a remark for ${row.client_name}'s paid cancellation — sent to admin for approval.`
                  : `Add a cancellation remark for ${row.client_name}'s session.`
                : 'Record why this session was missed.'}
            </Body>
            {modal === 'missed' ? (
              <View>
                <Mono style={{ fontSize: 10, letterSpacing: 1.2, color: C.mono2, marginBottom: 8 }}>CATEGORY *</Mono>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
                  {MISSED_CATEGORIES.map((c) => {
                    const sel = missedCat === c.value;
                    return (
                      <Pressable key={c.value} onPress={() => setMissedCat(c.value)} style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: sel ? hexA(C.gold, 0.14) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: sel ? hexA(C.gold, 0.45) : 'rgba(255,255,255,0.08)' }}>
                        <Text style={{ fontFamily: sel ? F.bodyBold : F.bodySemi, fontSize: 12, color: sel ? C.gold : C.muted }}>{c.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Remark…"
              placeholderTextColor={C.muted3}
              multiline
              style={{ minHeight: 72, textAlignVertical: 'top', paddingVertical: 12, paddingHorizontal: 13, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.03)', color: '#fff', fontFamily: F.body, fontSize: 14 }}
            />
            {modal === 'cancel' ? (
              att ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)' }}>
                  <Image source={{ uri: att.uri }} style={{ width: 42, height: 42, borderRadius: 9, backgroundColor: '#000' }} />
                  <Body style={{ flex: 1, fontSize: 11.5, color: C.ink3 }} numberOfLines={1}>{att.name}</Body>
                  <Pressable onPress={() => setAtt(null)} hitSlop={8} style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="close" size={12} color={C.muted} strokeWidth={2.3} />
                  </Pressable>
                </View>
              ) : (
                <Pressable onPress={pickAttachment} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 11, borderRadius: 12, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.14)' }}>
                  <Icon name="file" size={13} color={C.muted2} strokeWidth={2} />
                  <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: C.muted }}>Attach photo (optional)</Text>
                </Pressable>
              )
            ) : null}
            {err ? <Body style={{ fontSize: 12, color: C.red }}>{err.message}</Body> : null}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable onPress={() => !busy && setModal(null)} style={{ flex: 1, alignItems: 'center', paddingVertical: 13, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
                <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: C.ink }}>Dismiss</Text>
              </Pressable>
              {(() => {
                const blocked = busy || !text.trim() || (modal === 'missed' && !missedCat);
                return (
                  <Pressable onPress={submit} disabled={blocked} style={{ flex: 1, alignItems: 'center', paddingVertical: 13, borderRadius: 13, backgroundColor: blocked ? 'rgba(255,255,255,0.06)' : hexA(modal === 'cancel' ? C.red : C.orange, 0.16), borderWidth: 1, borderColor: blocked ? 'rgba(255,255,255,0.08)' : hexA(modal === 'cancel' ? C.red : C.orange, 0.4) }}>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: blocked ? C.muted3 : modal === 'cancel' ? C.red : C.orange }}>{busy ? 'Saving…' : 'Confirm'}</Text>
                  </Pressable>
                );
              })()}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

/* Leaderboard preview. Two deliberately distinct looks so the cards can't be
   confused: 'podium' (trainers — mini championship podium) and 'list'
   (managers — crown-badged standings rows with relative bars). */
export function LeaderboardPreview({ title, sub, accent, unit, rows, onPress, live, variant = 'podium' }: {
  title: string;
  sub: string;
  accent: string;
  unit: string;
  rows: { rank: number; name: string; value: string | number; color: string }[];
  onPress: () => void;
  live?: boolean;
  variant?: 'podium' | 'list';
}) {
  const leaderVal = Number(rows[0]?.value);
  return (
    <Card onPress={onPress} colors={['rgba(46,28,18,0.42)', 'rgba(18,14,14,0.5)']} radius={18} style={{ overflow: 'hidden' }}>
      <LinearGradient colors={[hexA(accent, 0.55), 'rgba(255,255,255,0.02)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 3 }} />
      <View style={{ padding: 15, paddingHorizontal: 16, gap: 12 }}>
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: hexA(accent, 0.13), borderWidth: 1, borderColor: hexA(accent, 0.3), alignItems: 'center', justifyContent: 'center' }}>
            {variant === 'list' ? <Icon path={ic.crown} size={19} color={accent} strokeWidth={1.9} /> : <TrophyIcon color={accent} size={19} />}
          </View>
          <View style={{ flex: 1 }}>
            <Serif style={{ fontSize: 17.5 }}>{title}</Serif>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
              {live ? <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: C.green }} /> : null}
              <Body style={{ fontSize: 11.5, color: C.muted }}>{sub}</Body>
            </View>
          </View>
          <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="chevRight" size={13} color={C.muted2} strokeWidth={2.3} />
          </View>
        </View>

        {/* LIST variant — standings rows: rank badge, name, relative bar, value */}
        {variant === 'list' && rows.length ? (
          <View style={{ borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: hexA(accent, 0.14), paddingHorizontal: 12 }}>
            {rows.map((r, i) => {
              const v = Number(r.value);
              const pct = isFinite(v) && isFinite(leaderVal) && leaderVal > 0 ? Math.max(6, Math.min(100, (v / leaderVal) * 100)) : null;
              const lead = r.rank === 1;
              return (
                <View key={r.rank} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 10, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: 'rgba(255,255,255,0.05)' }}>
                  <View style={{ width: 26, height: 26, borderRadius: 9, backgroundColor: hexA(r.color, 0.14), borderWidth: 1, borderColor: hexA(r.color, 0.45), alignItems: 'center', justifyContent: 'center' }}>
                    {lead ? <Icon path={ic.crown} size={13} color={r.color} strokeWidth={2.2} /> : <Text style={{ fontFamily: F.bodyBold, fontSize: 11.5, color: r.color }}>{r.rank}</Text>}
                  </View>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Body style={{ fontSize: 13, fontFamily: lead ? F.bodyBold : F.bodySemi, color: lead ? '#fff' : C.ink3 }} numberOfLines={1}>{r.name}</Body>
                    {pct != null ? (
                      <ProgressBar pct={pct} height={3} fill={accent} animated />
                    ) : null}
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    {typeof r.value === 'number'
                      ? <CountUp value={r.value} style={{ fontFamily: F.bodyBold, fontSize: lead ? 15 : 12.5, color: r.color }} />
                      : <Text style={{ fontFamily: F.bodyBold, fontSize: lead ? 15 : 12.5, color: r.color }}>{r.value}</Text>}
                    <Mono style={{ fontSize: 6.5, letterSpacing: 0.8, color: C.muted3 }}>{unit}</Mono>
                  </View>
                </View>
              );
            })}
          </View>
        ) : null}

        {/* PODIUM variant — 2 · 1 · 3, champion elevated with crown and glow */}
        {variant === 'podium' && rows.length ? (
          <View>
            <View pointerEvents="none" style={{ position: 'absolute', top: -6, left: '50%', marginLeft: -60, width: 120, height: 120, borderRadius: 60, backgroundColor: hexA(C.gold, 0.08) }} />
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10, marginTop: 6 }}>
              {[rows[1], rows[0], rows[2]].map((r, i) => {
                if (!r) return <View key={`empty-${i}`} style={{ flex: 1 }} />;
                const champ = i === 1;
                const colH = champ ? 54 : i === 0 ? 38 : 28;
                return (
                  <View key={r.rank} style={{ flex: 1, alignItems: 'center' }}>
                    <View style={{ paddingTop: champ ? 12 : 0 }}>
                      {champ ? (
                        <View style={{ position: 'absolute', top: -4, left: 0, right: 0, alignItems: 'center' }}>
                          <Icon path={ic.crown} size={14} color={C.gold} strokeWidth={2.2} />
                        </View>
                      ) : null}
                      <View style={{ padding: 2, borderRadius: 999, borderWidth: 1.5, borderColor: hexA(r.color, champ ? 0.7 : 0.4) }}>
                        <Avatar initial={initials(r.name)} size={champ ? 44 : 34} colors={[r.color, hexA(r.color, 0.55)]} fontSize={champ ? 15 : 12} />
                      </View>
                    </View>
                    <Body numberOfLines={1} style={{ fontSize: 11.5, fontFamily: F.bodySemi, color: champ ? '#fff' : C.ink3, marginTop: 6, maxWidth: 96 }}>
                      {r.name.split(' ')[0]}
                    </Body>
                    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3 }}>
                      {typeof r.value === 'number'
                        ? <CountUp value={r.value} style={{ fontFamily: F.bodyBold, fontSize: champ ? 15 : 12.5, color: r.color }} />
                        : <Text style={{ fontFamily: F.bodyBold, fontSize: champ ? 15 : 12.5, color: r.color }}>{r.value}</Text>}
                      <Mono style={{ fontSize: 6.5, letterSpacing: 0.8, color: C.muted3 }}>{unit}</Mono>
                    </View>
                    <LinearGradient
                      colors={[hexA(r.color, champ ? 0.55 : 0.42), hexA(r.color, 0.04)]}
                      start={{ x: 0.5, y: 0 }}
                      end={{ x: 0.5, y: 1 }}
                      style={{ width: '100%', height: colH, borderTopLeftRadius: 11, borderTopRightRadius: 11, marginTop: 7, alignItems: 'center', paddingTop: 5, borderWidth: 1, borderBottomWidth: 0, borderColor: hexA(r.color, 0.3) }}
                    >
                      <Serif style={{ fontSize: champ ? 18 : 15, color: r.color }}>{r.rank}</Serif>
                    </LinearGradient>
                  </View>
                );
              })}
            </View>
            <View style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.09)' }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingTop: 10 }}>
              <Mono style={{ fontSize: 8, letterSpacing: 1.6, color: C.muted3 }}>TAP FOR FULL STANDINGS</Mono>
              <Icon name="chevRight" size={10} color={C.muted3} strokeWidth={2.4} />
            </View>
          </View>
        ) : null}
      </View>
    </Card>
  );
}

/* ============ DASHBOARD ============ */
export function Dashboard() {
  const { firstName, set, go, rosterOpen, openClient, openWorkout } = useStore();
  const [openSession, setOpenSession] = React.useState<number | null>(null);

  // Use the signed-in trainer's own id; only fall back to the dev id (Khalid)
  // when signed in with the shared test account that has no sessions.
  const { session, dbRole: dbRoleForThreads } = useAuth();
  const isTestAccount = session?.user?.email?.startsWith('rn-test-trainer');
  const trainerId = !session ? '' : isTestAccount ? DEV_TRAINER_ID : session.user.id;

  // Offline state + pending-sync outbox.
  const netOnline = useIsOnline();
  const outbox = useOutbox();
  const [outboxOpen, setOutboxOpen] = React.useState(false);
  const outboxFailed = outbox.filter((o) => o.status === 'failed').length;
  // Opportunistic sync whenever the dashboard mounts (launch + reconnect already drain).
  React.useEffect(() => { drainOutbox(); }, []);
  // Green "saved to server" confirmations for logs that synced in the background —
  // each stays visible for 3 hours (auto-hide) or until dismissed.
  const syncedNotices = useSyncedNotices();

  // Client Threads unread total — from the dedicated client-threads backend.
  const { unread: threadUnread } = useClientThreadsUnread(session?.user?.id, dbRoleForThreads);

  // Workout Templates (accessed from the top-right 3-dots menu).
  const tplQ = useWorkoutTemplates(trainerId);
  const delTplM = useDeleteWorkoutTemplate();
  const [tplSheetOpen, setTplSheetOpen] = React.useState(false);
  // Sidebar "Workout Templates" → open the sheet (flag set by the drawer, consumed here).
  const { workoutTemplatesOpen } = useStore();
  React.useEffect(() => {
    if (workoutTemplatesOpen) { setTplSheetOpen(true); set({ workoutTemplatesOpen: false }); }
  }, [workoutTemplatesOpen]);
  const [tplBuilderOpen, setTplBuilderOpen] = React.useState(false);
  const dashInsets = useSafeAreaInsets();
  const { height: dashWinH } = useWindowDimensions();

  const [rosterDay, setRosterDay] = React.useState(0); // 0 = today, ±N days (IST)
  const [reqRosterOpen, setReqRosterOpen] = React.useState(false);
  const rosterQ = useTodayRoster(trainerId, rosterDay);
  // One silent device fix for the roster cards' inline distance estimates
  // (permission is guaranteed for trainers by the LocationGate — never prompts).
  const [devPos, setDevPos] = React.useState<{ lat: number; lng: number } | null>(null);
  const [tourOpen, setTourOpen] = React.useState(false);
  const [monthCardOpen, setMonthCardOpen] = React.useState(false);
  const monthBreakQ = useMyMonthSessionBreakdown(trainerId, monthCardOpen);
  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (!perm.granted) return;
        const pos = await new Promise<any>((resolve) => {
          const t = setTimeout(() => resolve(null), 12_000);
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
            .then((p) => { clearTimeout(t); resolve(p); })
            .catch(() => { clearTimeout(t); resolve(null); });
        });
        if (alive && pos) setDevPos({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      } catch { /* card falls back to tap-for-route */ }
    })();
    return () => { alive = false; };
  }, []);
  const statsQ = useTrainerStats(trainerId);
  const leaderboardQ = useTrainerLeaderboard();
  const firstSessionQ = useFirstSessionAlert(trainerId);

  // QHP alerts (web OnboardingAlertBanner + TrainerQHPInProgressAlert).
  // NOTE: the web shows the assign-assessor banner to canViewAllAssessments too,
  // but only real QHP Managers (can_schedule_assessments_for_others) can actually
  // assign — so we gate strictly to them (deliberate fix over web parity).
  const dashCaps = useMyCapabilities();
  const isQhpMgrAlert = dashCaps.data.isQhpManager;
  const assignAlertQ = useQhpAssignAssessorAlert(isQhpMgrAlert);
  const assessorDueQ = useAssessorPendingCount(trainerId, dashCaps.data.canConductAssessments);
  const inProgressQ = useQhpInProgress(trainerId);
  const [inProgressOpen, setInProgressOpen] = React.useState(false);
  // Total QHPs card (QHP managers): all-time pending/completed/overdue for subscribed clients.
  const qhpTotalsQ = useQhpTotals(isQhpMgrAlert);
  const [qhpBreakdown, setQhpBreakdown] = React.useState<'pending' | 'completed' | 'overdue' | null>(null);
  // Client acknowledgements — this month's ack % shown on the Acknowledge Sessions quick action.
  const ackSumQ = useTrainerAckSummary(trainerId);
  const assignAlert = assignAlertQ.data;
  const assignMsg = React.useMemo(() => {
    if (!assignAlert || assignAlert.count === 0) return null;
    const { count, names } = assignAlert;
    if (count === 1 && names[0]) return `${names[0]}'s QHP is scheduled, please assign assessor asap`;
    if (names.length > 0) {
      const preview = names.slice(0, 2).join(', ');
      const extra = count - Math.min(2, names.length);
      return `${preview}${extra > 0 ? ` +${extra} more` : ''} — QHP scheduled, please assign assessor asap`;
    }
    return `${count} client${count === 1 ? '' : 's'} QHP scheduled, please assign assessor asap`;
  }, [assignAlert]);
  const mgrLbQ = useManagerLeaderboard();
  const mgrTop3 = mgrLbQ.data?.entries?.length
    ? mgrLbQ.data.entries.slice(0, 3).map((e, i) => ({ rank: e.rank, name: e.managerName.split(' ')[0], sess: e.totalSessions, mc: [C.gold, '#B8BCC4', '#C08A52'][i] }))
    : mgrDefs.slice(0, 3).map((m) => ({ rank: m.rank, name: m.name, sess: m.sess + m.qhp, mc: m.mc }));
  const profileQ = useQuery({
    queryKey: ['trainerProfile', trainerId],
    enabled: !!trainerId,
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('first_name, last_name').eq('id', trainerId).single();
      if (error) throw new Error(error.message);
      return data as { first_name: string | null; last_name: string | null };
    },
  });
  const displayName = profileQ.data?.first_name || firstName || 'Trainer';
  const sideProf = useSidebarProfile();

  const rosterRows = rosterQ.data ?? [];
  // Plan expiry per roster client (web 42-day rule) — feeds the strip on each session card.
  const planExpQ = usePlanExpiryMap(rosterRows.map((r) => r.client_id));
  const plansFor = (clientId: string | null) => (clientId ? planExpQ.data?.[clientId] : undefined);

  // Roster at a glance: split overdue carry-overs from today's list, track progress, find the next session.
  // When browsing another day the carry-over/attention grouping doesn't apply.
  const todayIst = istDate();
  const isTodayView = rosterDay === 0;
  const attentionRows = isTodayView ? rosterRows.filter((r) => r.is_open_past || istDate(new Date(r.scheduled_datetime)) !== todayIst) : [];
  const todayRows = isTodayView ? rosterRows.filter((r) => !r.is_open_past && istDate(new Date(r.scheduled_datetime)) === todayIst) : rosterRows;
  const missedNeedingRemark = attentionRows.filter((r) => r.is_open_past).length;
  const rosterDone = rosterRows.filter((r) => !!r.workout_session_id).length;
  const rosterActive = rosterRows.filter((r) => (r.status ?? '').toLowerCase() !== 'cancelled').length;
  const nextRow = isTodayView
    ? todayRows.find(
        (r) => !r.workout_session_id && (r.status ?? '').toLowerCase() !== 'cancelled' && Date.now() <= new Date(r.scheduled_datetime).getTime() + POST_WINDOW_MS
      )
    : undefined;
  const nextParts = nextRow ? istTimeParts(nextRow.scheduled_datetime) : null;
  const rosterDayLabel = new Date(Date.now() + rosterDay * 864e5)
    .toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short' })
    .toUpperCase();
  const rosterTitle = rosterDay === 0 ? "Today's Roster" : rosterDay === -1 ? "Yesterday's Roster" : rosterDay === 1 ? "Tomorrow's Roster" : 'Roster';

  // Stat tiles: today's schedule progress (always today, even while the roster
  // card is browsing another day — same query key, so no extra fetch) + clients.
  const todayRosterQ = useTodayRoster(trainerId, 0);
  const tileRows = todayRosterQ.data ?? [];
  const tileDone = tileRows.filter((r) => !!r.workout_session_id).length;
  const tileActive = tileRows.filter((r) => (r.status ?? '').toLowerCase() !== 'cancelled').length;
  const s = statsQ.data;

  // Live leaderboard mapped to the row shape used below.
  const medalColors = [C.gold, '#B8BCC4', '#C08A52'];
  const liveLeaders = leaderboardQ.data?.map((e, i) => ({
    name: e.trainerName,
    ref: e.referralCount,
    sess: e.sessionCount + e.qhpCount, // web parity: "Sess" = sessions + QHP combined
    medal: i < 3 ? ic.crown : undefined,
    medalColor: i < 3 ? medalColors[i] : undefined,
  }));
  const leaderRows = leaderboardQ.isError || !liveLeaders ? leaders : liveLeaders;
  const istHour = Number(new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false, hour: '2-digit' }));
  const greeting = istHour < 12 ? 'Good morning' : istHour < 17 ? 'Good afternoon' : 'Good evening';
  const sectionLabel = (text: string) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
      <Mono style={{ fontSize: 10.5, letterSpacing: 1.8, color: C.mono2 }}>{text}</Mono>
      <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.06)' }} />
    </View>
  );
  return (
    <Page>
      <GreetingHeader
        date={new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: '2-digit', month: 'short' }).replace(',', ' ·').toUpperCase()}
        name={`${greeting}, ${displayName}`}
        sub="Here's your training overview"
        initial={(displayName[0] || 'T').toUpperCase()}
        avatarUrl={sideProf.avatarUrl}
        rightAction={<TourLauncher onPress={() => setTourOpen(true)} />}
      />
      <FeatureTour visible={tourOpen} steps={TRAINER_TOUR} tourName='trainer' onClose={() => setTourOpen(false)} />

      {/* Linked-account toggle (coach ⇄ Sagar) — renders only for those two accounts */}
      <AccountSwitch />

      {/* QHP review-flow alerts — reviewers see pending sign-offs, creators see held reports */}
      <HeldReportsAlert />
      <QhpReviewAlert />

      {/* Offline indicator */}
      {!netOnline ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 9, paddingHorizontal: 12, borderRadius: 13, backgroundColor: hexA(C.gold, 0.08), borderWidth: 1, borderColor: hexA(C.gold, 0.28) }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.gold }} />
          <Body style={{ flex: 1, fontSize: 11.5, color: hexA(C.gold, 0.95) }}>Offline — showing saved data. New entries sync automatically.</Body>
        </View>
      ) : null}

      {/* Synced-log confirmations — a queued workout reached the server. Visible for
          3 hours (auto-hide), dismissible earlier. */}
      {syncedNotices.map((n) => {
        const tp = istTimeParts(n.syncedAt);
        return (
          <View key={n.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: 12, borderRadius: 14, backgroundColor: hexA(C.green, 0.08), borderWidth: 1, borderColor: hexA(C.green, 0.32) }}>
            <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: hexA(C.green, 0.15), alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="checks" size={16} color={C.green} strokeWidth={2.4} />
            </View>
            <View style={{ flex: 1 }}>
              <Body style={{ fontSize: 13, fontFamily: F.bodySemi, color: '#fff' }} numberOfLines={1}>{n.label} — saved to server ✓</Body>
              <Body style={{ fontSize: 11, color: hexA(C.green, 0.9), marginTop: 1 }}>Synced {tp.time} {tp.ampm} · kept its original log time</Body>
            </View>
            <Pressable onPress={() => dismissSyncedNotice(n.id)} hitSlop={8} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="close" size={12} color={C.muted} strokeWidth={2.3} />
            </Pressable>
          </View>
        );
      })}

      {/* ---- Sessions This Month — tap for the per-client breakdown ---- */}
      {(() => {
        const count = s?.monthSessionsCount ?? 0;
        const now = new Date();
        const dayOfMonth = Number(now.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric' }));
        const pace = dayOfMonth > 0 ? (count / dayOfMonth).toFixed(1) : '0.0';
        const monthName = now.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', month: 'long' });
        return (
          <Pressable onPress={() => setMonthCardOpen(true)}>
            <View style={{ borderRadius: 19, overflow: 'hidden', borderWidth: 1, borderColor: hexA(C.orange, 0.24) }}>
              <LinearGradient colors={['rgba(58,34,20,0.6)', 'rgba(20,15,14,0.65)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
                <LinearGradient colors={[hexA(C.orange, 0.55), 'rgba(255,255,255,0.02)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 3 }} />
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 13, padding: 15 }}>
                  <View style={{ width: 52, height: 52, alignItems: 'center', justifyContent: 'center' }}>
                    <MapPing color={C.orange} />
                    <View style={{ width: 48, height: 48, borderRadius: 17, backgroundColor: hexA(C.orange, 0.13), borderWidth: 1, borderColor: hexA(C.orange, 0.4), alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name="dumbbell" size={21} color={C.orange} strokeWidth={2} />
                    </View>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Mono style={{ fontSize: 8.5, letterSpacing: 1.2, color: C.mono2 }}>SESSIONS THIS MONTH</Mono>
                    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 2 }}>
                      <Serif style={{ fontSize: 32, color: '#fff' }}>{statsQ.isLoading ? '…' : count}</Serif>
                      <View style={{ paddingVertical: 3, paddingHorizontal: 9, borderRadius: 999, backgroundColor: hexA(C.green, 0.1), borderWidth: 1, borderColor: hexA(C.green, 0.32), marginBottom: 7 }}>
                        <Text style={{ fontFamily: F.bodySemi, fontSize: 9.5, color: C.green }}>≈ {pace}/day pace</Text>
                      </View>
                    </View>
                    <Body style={{ fontSize: 10.5, color: C.muted3 }}>{monthName} · tap for the per-client breakdown</Body>
                  </View>
                  <Icon name="chevRight" size={17} color={C.orange} strokeWidth={2.3} />
                </View>
              </LinearGradient>
            </View>
          </Pressable>
        );
      })()}

      {/* Breakdown modal — per-client sessions this month */}
      <Modal visible={monthCardOpen} transparent animationType="slide" onRequestClose={() => setMonthCardOpen(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable onPress={() => setMonthCardOpen(false)} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)' }} />
          <View style={{ maxHeight: '84%', backgroundColor: C.sheetBg, borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.14)', paddingHorizontal: 18, paddingTop: 10, paddingBottom: 26 }}>
            <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.14)', marginBottom: 12 }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 6 }}>
              <View style={{ width: 38, height: 38, borderRadius: 13, backgroundColor: hexA(C.orange, 0.13), borderWidth: 1, borderColor: hexA(C.orange, 0.35), alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="dumbbell" size={16} color={C.orange} strokeWidth={2.1} />
              </View>
              <View style={{ flex: 1 }}>
                <Serif style={{ fontSize: 19 }}>This Month's Sessions</Serif>
                <Body style={{ fontSize: 11, color: C.muted2, marginTop: 1 }}>Per client · {new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', month: 'long', year: 'numeric' })}</Body>
              </View>
              <Pressable onPress={() => setMonthCardOpen(false)} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="close" size={14} color="#B8B2AC" strokeWidth={2.3} />
              </Pressable>
            </View>
            {(() => {
              const rows = monthBreakQ.data ?? [];
              const tot = (k: 'completed' | 'cancelled' | 'complimentary') => rows.reduce((n, r) => n + (r as any)[k], 0);
              return (
                <>
                  {/* Totals strip */}
                  <View style={{ flexDirection: 'row', gap: 7, marginBottom: 10 }}>
                    {([['COMPLETED', tot('completed'), C.green], ['CANCELLED', tot('cancelled'), C.red], ['COMP', tot('complimentary'), C.purple], ['CLIENTS', rows.length, C.blue]] as const).map(([lab, n, col]) => (
                      <View key={lab} style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 12, backgroundColor: hexA(col, 0.07), borderWidth: 1, borderColor: hexA(col, 0.25) }}>
                        <Text style={{ fontFamily: F.bodyBold, fontSize: 16, color: col }}>{n}</Text>
                        <Mono style={{ fontSize: 6.5, letterSpacing: 0.5, color: C.muted3, marginTop: 1 }}>{lab}</Mono>
                      </View>
                    ))}
                  </View>
                  {monthBreakQ.isLoading ? (
                    <View style={{ paddingVertical: 28, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View>
                  ) : monthBreakQ.isError ? (
                    <Body style={{ fontSize: 12, color: C.red, textAlign: 'center', paddingVertical: 18 }}>{(monthBreakQ.error as Error).message}</Body>
                  ) : rows.length === 0 ? (
                    <Body style={{ fontSize: 12, color: C.muted3, textAlign: 'center', paddingVertical: 22 }}>No sessions logged this month yet.</Body>
                  ) : (
                    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 12 }}>
                      {[...rows].sort((a, b) => b.total - a.total).map((r) => {
                        const max = Math.max(1, ...rows.map((x) => x.total));
                        return (
                          <View key={r.clientId} style={{ padding: 12, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.24)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', gap: 7 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                              <Body numberOfLines={1} style={{ flex: 1, fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{r.clientName}</Body>
                              <Text style={{ fontFamily: F.bodyBold, fontSize: 16, color: C.orange }}>{r.total}</Text>
                            </View>
                            <View style={{ height: 5, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                              <View style={{ width: `${(r.total / max) * 100}%`, height: 5, borderRadius: 999, backgroundColor: hexA(C.orange, 0.8) }} />
                            </View>
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
                              {r.completed ? <Badge text={`${r.completed} completed`} color={C.green} /> : null}
                              {r.cancelled ? <Badge text={`${r.cancelled} cancelled`} color={C.red} /> : null}
                              {r.complimentary ? <Badge text={`${r.complimentary} comp`} color={C.purple} /> : null}
                              {r.pending ? <Badge text={`${r.pending} pending`} color={C.gold} /> : null}
                              {r.lastAt ? <Mono style={{ fontSize: 8, color: C.muted3, alignSelf: 'center' }}>LAST {istDayLabel(r.lastAt).toUpperCase()}</Mono> : null}
                            </View>
                          </View>
                        );
                      })}
                    </ScrollView>
                  )}
                </>
              );
            })()}
          </View>
        </View>
      </Modal>

      {/* Pending-sync outbox chip */}
      {outbox.length ? (
        <Pressable onPress={() => setOutboxOpen(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: 12, borderRadius: 14, backgroundColor: hexA(outboxFailed ? C.red : C.blue, 0.08), borderWidth: 1, borderColor: hexA(outboxFailed ? C.red : C.blue, 0.3) }}>
          <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: hexA(outboxFailed ? C.red : C.blue, 0.15), alignItems: 'center', justifyContent: 'center' }}>
            <Icon path="M3 12a9 9 0 0 1 15-6.7L21 8M21 12a9 9 0 0 1-15 6.7L3 16M21 3v5h-5M3 21v-5h5" size={15} color={outboxFailed ? C.red : C.blue} strokeWidth={2} />
          </View>
          <View style={{ flex: 1 }}>
            <Body style={{ fontSize: 13, fontFamily: F.bodySemi, color: '#fff' }}>
              {outbox.length} entr{outbox.length === 1 ? 'y' : 'ies'} waiting to sync
            </Body>
            <Body style={{ fontSize: 11, color: C.muted2, marginTop: 1 }}>
              {outboxFailed ? `${outboxFailed} need attention · tap to review` : netOnline ? 'Syncing shortly · tap to view' : 'Will sync when back online · tap to view'}
            </Body>
          </View>
          <Icon name="chevRight" size={15} color={C.muted} strokeWidth={2.2} />
        </Pressable>
      ) : null}

      {/* First-session-in-24h alert */}
      {firstSessionQ.data ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: 13, borderRadius: 15, backgroundColor: hexA(C.blue, 0.09), borderWidth: 1, borderColor: hexA(C.blue, 0.3), borderLeftWidth: 4, borderLeftColor: C.blue }}>
          <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: hexA(C.blue, 0.16), alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="sparkle" size={16} color={C.blue} fill={C.blue} strokeWidth={0} />
          </View>
          <View style={{ flex: 1 }}>
            <Body style={{ fontSize: 13.5, fontFamily: F.bodyBold, color: '#fff' }}>First session with {firstSessionQ.data.clientName}</Body>
            <Body style={{ fontSize: 11.5, color: '#A9BCFF', marginTop: 1 }}>
              {istDayLabel(firstSessionQ.data.sessionTime)} · {istTimeParts(firstSessionQ.data.sessionTime).time} {istTimeParts(firstSessionQ.data.sessionTime).ampm} — make it count
            </Body>
          </View>
        </View>
      ) : null}

      {/* QHP Manager — assign assessor asap (web OnboardingAlertBanner coach alert).
          Render-gated on the capability too: cached data must never show it to non-managers. */}
      {isQhpMgrAlert && assignMsg ? (
        <Pressable onPress={() => go('qhp-manager')} style={{ borderRadius: 16, overflow: 'hidden', borderWidth: 1.5, borderColor: hexA(C.gold, 0.5) }}>
          <LinearGradient colors={[hexA(C.gold, 0.14), hexA(C.orange, 0.06)]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: 13 }}>
            <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, backgroundColor: C.gold }} />
            <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: hexA(C.gold, 0.18), borderWidth: 1, borderColor: hexA(C.gold, 0.4), alignItems: 'center', justifyContent: 'center', marginLeft: 4 }}>
              <Icon name="clipboard" size={16} color={C.gold} strokeWidth={2.2} />
            </View>
            <View style={{ flex: 1 }}>
              <Body style={{ fontSize: 13, fontFamily: F.bodyBold, color: '#F5D08A' }} numberOfLines={2}>{assignMsg}</Body>
              <Body style={{ fontSize: 11, color: hexA(C.gold, 0.85), marginTop: 2 }}>Open Task Pending → Not Scheduled to assign an assessor</Body>
            </View>
            <Icon name="chevRight" size={15} color={C.gold} strokeWidth={2.4} />
          </LinearGradient>
        </Pressable>
      ) : null}

      {/* Assessor — my pending QHPs due (web assessor alert) */}
      {(assessorDueQ.data ?? 0) > 0 ? (
        <Pressable onPress={() => go('qhp')} style={{ borderRadius: 16, overflow: 'hidden', borderWidth: 1.5, borderColor: hexA(C.orange, 0.45) }}>
          <LinearGradient colors={[hexA(C.orange, 0.12), 'rgba(255,255,255,0.02)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: 13 }}>
            <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, backgroundColor: C.orange }} />
            <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: hexA(C.orange, 0.16), borderWidth: 1, borderColor: hexA(C.orange, 0.4), alignItems: 'center', justifyContent: 'center', marginLeft: 4 }}>
              <Icon name="file" size={16} color={C.orange} strokeWidth={2.2} />
            </View>
            <View style={{ flex: 1 }}>
              <Body style={{ fontSize: 13, fontFamily: F.bodyBold, color: '#F0A875' }}>Your {assessorDueQ.data} new client{assessorDueQ.data === 1 ? "'s" : "s'"} QHP is due</Body>
              <Body style={{ fontSize: 11, color: hexA(C.orange, 0.85), marginTop: 2 }}>Complete pending QHP assessments assigned to you</Body>
            </View>
            <Icon name="chevRight" size={15} color={C.orange} strokeWidth={2.4} />
          </LinearGradient>
        </Pressable>
      ) : null}

      {/* QHP Assessments In Progress (web TrainerQHPInProgressAlert) */}
      {(inProgressQ.data?.length ?? 0) > 0 ? (
        <Pressable onPress={() => setInProgressOpen(true)} style={{ borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: hexA(C.blue, 0.35) }}>
          <LinearGradient colors={[hexA(C.blue, 0.12), 'rgba(255,255,255,0.02)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: 13 }}>
            <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: hexA(C.blue, 0.16), borderWidth: 1, borderColor: hexA(C.blue, 0.4), alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="activity" size={16} color={C.blue} strokeWidth={2.2} />
            </View>
            <View style={{ flex: 1 }}>
              <Body style={{ fontSize: 13.5, fontFamily: F.bodyBold, color: '#fff' }}>QHP Assessments In Progress</Body>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}>
                <View style={{ minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 10, backgroundColor: C.blue, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: '#0c0808' }}>{inProgressQ.data!.length}</Text>
                </View>
                <Body style={{ fontSize: 11.5, color: '#A9BCFF' }}>client{inProgressQ.data!.length === 1 ? ' has' : 's have'} a QHP in progress. Tap to view.</Body>
              </View>
            </View>
            <Icon name="chevRight" size={15} color={C.blue} strokeWidth={2.4} />
          </LinearGradient>
        </Pressable>
      ) : null}

      {/* Total QHPs — QHP managers only: all-time status split for subscribed clients */}
      {isQhpMgrAlert ? (
        <Card colors={['rgba(46,28,18,0.42)', 'rgba(18,14,14,0.5)']} radius={18} style={{ overflow: 'hidden' }}>
          <LinearGradient colors={[hexA(C.gold, 0.55), 'rgba(255,255,255,0.02)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 3 }} />
          <View style={{ padding: 14, gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
              <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: hexA(C.gold, 0.13), borderWidth: 1, borderColor: hexA(C.gold, 0.32), alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="clipboard" size={18} color={C.gold} strokeWidth={2} />
              </View>
              <View style={{ flex: 1 }}>
                <Serif style={{ fontSize: 17.5 }}>QHPs This Month</Serif>
                <Body style={{ fontSize: 11.5, color: C.muted, marginTop: 2 }}>Subscribed clients · tap a stat for the breakdown</Body>
              </View>
              {qhpTotalsQ.isLoading ? <ActivityIndicator size="small" color={C.gold} /> : null}
            </View>
            <View style={{ flexDirection: 'row', gap: 9 }}>
              {([
                ['completed', 'Completed', C.green, qhpTotalsQ.data?.completed],
                ['pending', 'Scheduled', C.gold, qhpTotalsQ.data?.pending],
                ['overdue', 'Overdue', C.red, qhpTotalsQ.data?.overdue],
              ] as ['pending' | 'completed' | 'overdue', string, string, number | undefined][]).map(([key, label, col, n]) => (
                <Pressable key={key} onPress={() => setQhpBreakdown(key)} style={{ flex: 1, alignItems: 'center', gap: 3, paddingVertical: 13, borderRadius: 15, backgroundColor: hexA(col, 0.08), borderWidth: 1, borderColor: hexA(col, 0.3) }}>
                  {n == null ? (
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 21, color: col }}>…</Text>
                  ) : (
                    <CountUp value={n} style={{ fontFamily: F.bodyBold, fontSize: 21, color: col }} />
                  )}
                  <Mono style={{ fontSize: 7.5, letterSpacing: 1, color: C.muted3 }}>{label.toUpperCase()}</Mono>
                </Pressable>
              ))}
            </View>
            {qhpTotalsQ.isError ? <Body style={{ fontSize: 11, color: C.red }}>{(qhpTotalsQ.error as Error).message}</Body> : null}
          </View>
        </Card>
      ) : null}

      <RequestRosterSheet visible={reqRosterOpen} onClose={() => setReqRosterOpen(false)} trainerId={trainerId} />

      <View style={{ gap: 13 }}>
        {sectionLabel('QUICK ACTIONS')}
        <View style={{ flexDirection: 'row', gap: 11 }}>
          {quickActions.map((q) => {
            const isAck = q.label === 'Acknowledge Sessions';
            const a = ackSumQ.data;
            const ackCol = a && a.pct < 100 ? C.gold : C.green;
            const hint = isAck
              ? (ackSumQ.isPending || !a ? "Confirm today's plan" : `${a.acked}/${a.total} acknowledged this month`)
              : q.label === 'Emergency Leave' ? 'Request time off' : 'Open';
            return (
              <View key={q.label} style={{ flex: 1 }}>
                <Card onPress={() => runAction(q.action, { set, go })} colors={['rgba(46,28,18,0.42)', 'rgba(18,14,14,0.5)']} radius={17} style={{ overflow: 'hidden' }}>
                  <LinearGradient colors={[hexA(q.color, 0.5), 'rgba(255,255,255,0.02)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 3 }} />
                  <View style={{ minHeight: 78, paddingHorizontal: 13, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 11 }}>
                    {isAck && a && a.total > 0 ? (
                      /* Ack card: the % IS the icon — animated, gold until 100% then green */
                      <View style={{ width: 44, height: 44, borderRadius: 13, backgroundColor: hexA(ackCol, 0.13), borderWidth: 1, borderColor: hexA(ackCol, 0.35), alignItems: 'center', justifyContent: 'center' }}>
                        <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                          <CountUp value={a.pct} style={{ fontFamily: F.bodyBold, fontSize: a.pct >= 100 ? 13 : 15, color: ackCol }} />
                          <Text style={{ fontFamily: F.bodyBold, fontSize: 9, color: ackCol }}>%</Text>
                        </View>
                        <Mono style={{ fontSize: 5.5, letterSpacing: 0.6, color: C.muted3, marginTop: -1 }}>ACK</Mono>
                      </View>
                    ) : (
                      <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: hexA(q.color, 0.13), borderWidth: 1, borderColor: hexA(q.color, 0.32), alignItems: 'center', justifyContent: 'center' }}>
                        <Icon name={q.icon} size={18} color={q.color} strokeWidth={2} />
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Body numberOfLines={2} style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff', lineHeight: 18 }}>{q.label}</Body>
                      <Body numberOfLines={1} style={{ fontSize: 10.5, color: isAck && a && a.pct < 100 ? '#F2C066' : C.muted3, marginTop: 2 }}>{hint}</Body>
                      {isAck && a && a.total > 0 ? (
                        <View style={{ marginTop: 5 }}>
                          <ProgressBar pct={a.pct} height={3} fill={ackCol} animated />
                        </View>
                      ) : null}
                    </View>
                    <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name="chevRight" size={13} color={C.muted2} strokeWidth={2.3} />
                    </View>
                  </View>
                </Card>
              </View>
            );
          })}
        </View>
      </View>

      {/* Client Threads — one team chat per client (trainers + CRMs + doctors) */}
      <ClientThreadsCard onPress={() => go('client-threads')} unread={threadUnread} />

      <View style={{ flexDirection: 'row', gap: 11 }}>
        {/* Today's sessions — circular progress against today's schedule; opens the roster. */}
        <Card onPress={() => set({ rosterOpen: true })} colors={['rgba(46,28,18,0.42)', 'rgba(18,14,14,0.5)']} radius={17} style={{ flex: 1, overflow: 'hidden' }}>
          <LinearGradient colors={[hexA(C.orange, 0.5), 'rgba(255,255,255,0.02)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 3 }} />
          <View style={{ height: 116, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <ClientRing done={tileDone} total={tileActive} />
            <View style={{ flex: 1 }}>
              <Body numberOfLines={1} style={{ fontSize: 13, fontFamily: F.bodySemi, color: '#fff' }}>Today's Sessions</Body>
              <Body numberOfLines={1} style={{ fontSize: 10.5, color: C.muted3, marginTop: 2 }}>
                {todayRosterQ.isLoading ? 'Loading…' : tileActive === 0 ? 'Nothing scheduled' : `${tileDone} logged · ${Math.max(0, tileActive - tileDone)} left`}
              </Body>
              <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 7, paddingVertical: 3, paddingHorizontal: 8, borderRadius: 999, backgroundColor: hexA(C.orange, 0.1), borderWidth: 1, borderColor: hexA(C.orange, 0.26) }}>
                <Mono style={{ fontSize: 8, letterSpacing: 0.6, color: '#F0A875' }}>ROSTER</Mono>
                <Icon name="chevDown" size={10} color="#F0A875" strokeWidth={2.4} />
              </View>
            </View>
          </View>
        </Card>

        {/* Active clients — opens My Clients. */}
        <Card onPress={() => go('clients')} colors={['rgba(46,28,18,0.42)', 'rgba(18,14,14,0.5)']} radius={17} style={{ flex: 1, overflow: 'hidden' }}>
          <LinearGradient colors={[hexA(C.blue, 0.5), 'rgba(255,255,255,0.02)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 3 }} />
          <View style={{ height: 116, padding: 13, justifyContent: 'space-between' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: hexA(C.blue, 0.13), borderWidth: 1, borderColor: hexA(C.blue, 0.32), alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="users" size={17} color={C.blue} strokeWidth={2} />
              </View>
              <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="chevRight" size={13} color={C.muted2} strokeWidth={2.3} />
              </View>
            </View>
            <View>
              {s ? <CountUp value={s.activeClientsCount} style={{ fontSize: 30, lineHeight: 34 }} /> : <Serif style={{ fontSize: 30, lineHeight: 34 }}>—</Serif>}
              <Body numberOfLines={1} style={{ fontSize: 11.5, color: C.muted, marginTop: 1 }}>Active Clients</Body>
            </View>
          </View>
        </Card>
      </View>

      {/* Today's roster (collapsible) */}
      <Card colors={['rgba(64,38,22,0.45)', 'rgba(20,16,15,0.5)']} style={{ overflow: 'hidden' }}>
        <Pressable onPress={() => set({ rosterOpen: !rosterOpen })} style={{ flexDirection: 'row', alignItems: 'center', gap: 13, padding: 16, paddingBottom: rosterRows.length ? 12 : 16 }}>
          <IconChip icon="calendar" color={C.orange} />
          <View style={{ flex: 1 }}>
            <Serif style={{ fontSize: 20 }}>{rosterTitle}</Serif>
            <Body style={{ fontSize: 13, color: C.muted }}>
              {rosterQ.isLoading
                ? 'Loading…'
                : `${isTodayView ? '' : `${rosterDayLabel} · `}${rosterRows.length} session${rosterRows.length === 1 ? '' : 's'} · ${rosterDone} logged${nextParts ? ` · next ${nextParts.time} ${nextParts.ampm}` : ''}`}
            </Body>
          </View>
          <View style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={rosterOpen ? 'chevUp' : 'chevDown'} size={18} color={C.muted} strokeWidth={2.2} />
          </View>
        </Pressable>
        {!rosterQ.isLoading && rosterRows.length ? (
          <View style={{ paddingHorizontal: 16, paddingBottom: rosterOpen ? 12 : 16 }}>
            <ProgressBar pct={rosterActive ? Math.min(100, (rosterDone / rosterActive) * 100) : 0} height={4} fill={C.green} animated />
          </View>
        ) : null}
        {rosterOpen ? (
          <View style={{ paddingHorizontal: 16, paddingBottom: 16, gap: 12 }}>
            {/* Day navigation */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Pressable onPress={() => setRosterDay((d) => Math.max(-14, d - 1))} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="chevLeft" size={16} color={C.ink2} strokeWidth={2.4} />
              </Pressable>
              <Pressable onPress={() => setRosterDay(0)} style={{ flex: 1, alignItems: 'center' }}>
                <Mono style={{ fontSize: 10.5, letterSpacing: 1.4, color: isTodayView ? C.orange : C.ink2 }}>
                  {isTodayView ? `TODAY · ${rosterDayLabel}` : rosterDayLabel}
                </Mono>
                {!isTodayView ? <Body style={{ fontSize: 10, color: C.muted3, marginTop: 2 }}>Tap to jump back to today</Body> : null}
              </Pressable>
              <Pressable onPress={() => setRosterDay((d) => Math.min(14, d + 1))} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="chevRight" size={16} color={C.ink2} strokeWidth={2.4} />
              </Pressable>
            </View>

            {!rosterQ.isLoading && missedNeedingRemark > 0 ? <MissedAlert count={missedNeedingRemark} /> : null}

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <ActionBtn label="Trial Workout" icon="sparkle" accent onPress={() => go('workout')} />
              <ActionBtn label="Request Roster" icon="layers" onPress={() => setReqRosterOpen(true)} />
            </View>
            {rosterQ.isPending && rosterQ.fetchStatus === 'paused' ? (
              /* Offline with no cached copy of this day — say so instead of spinning forever. */
              <View style={{ alignItems: 'center', gap: 8, paddingVertical: 18, paddingHorizontal: 20 }}>
                <Icon name="alert" size={22} color={C.gold} strokeWidth={1.8} />
                <Body style={{ fontSize: 12.5, color: '#F2C066', textAlign: 'center' }}>
                  You're offline and this day hasn't been synced yet. It will load the moment connection returns.
                </Body>
              </View>
            ) : rosterQ.isLoading ? (
              <View style={{ alignItems: 'center', gap: 8, paddingVertical: 18 }}>
                <Icon name="clock" size={22} color={C.muted3} strokeWidth={1.8} />
                <Body style={{ fontSize: 12.5, color: C.muted3 }}>Loading today's sessions…</Body>
              </View>
            ) : rosterQ.isError ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 11, borderRadius: 11, backgroundColor: hexA(C.red, 0.08), borderWidth: 1, borderColor: hexA(C.red, 0.25) }}>
                <Icon name="alert" size={13} color={C.red} strokeWidth={2.2} />
                <Body style={{ flex: 1, fontSize: 11.5, color: '#E0A090' }}>Couldn't load today's roster ({(rosterQ.error as Error).message}).</Body>
              </View>
            ) : rosterRows.length === 0 ? (
              <View style={{ alignItems: 'center', gap: 8, paddingVertical: 14 }}>
                <Icon name="calendar" size={22} color="#4C4640" strokeWidth={1.6} />
                <Body style={{ fontSize: 12.5, color: C.muted3 }}>{isTodayView ? 'No sessions scheduled today.' : `No sessions on ${rosterDayLabel}.`}</Body>
              </View>
            ) : (
              <>
                {attentionRows.length ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 2 }}>
                    <Mono style={{ fontSize: 9.5, letterSpacing: 1.6, color: C.red }}>NEEDS ATTENTION · {attentionRows.length}</Mono>
                    <View style={{ flex: 1, height: 1, backgroundColor: hexA(C.red, 0.18) }} />
                  </View>
                ) : null}
                {attentionRows.map((r) => (
                  <RosterCard
                    key={r.id}
                    row={r}
                    trainerName={displayName}
                    devPos={devPos}
                    plans={plansFor(r.client_id)}
                    onAddWorkout={() => { if (r.client_id) openWorkout(r.client_id, r.client_name, r.modality ?? r.session_type ?? 'strength', r.id); }}
                  />
                ))}
                {attentionRows.length && todayRows.length ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 2 }}>
                    <Mono style={{ fontSize: 9.5, letterSpacing: 1.6, color: C.muted3 }}>TODAY</Mono>
                    <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.07)' }} />
                  </View>
                ) : null}
                {todayRows.map((r) => (
                  <RosterCard
                    key={r.id}
                    row={r}
                    trainerName={displayName}
                    devPos={devPos}
                    highlight={nextRow?.id === r.id}
                    plans={plansFor(r.client_id)}
                    onAddWorkout={() => { if (r.client_id) openWorkout(r.client_id, r.client_name, r.modality ?? r.session_type ?? 'strength', r.id); }}
                  />
                ))}
                {attentionRows.length && !todayRows.length ? (
                  <Body style={{ fontSize: 12, color: C.muted3, textAlign: 'center', paddingVertical: 6 }}>No sessions scheduled today.</Body>
                ) : null}
              </>
            )}
          </View>
        ) : null}
      </Card>

      {sectionLabel('LEADERBOARDS')}

      {/* Managers dashboard entry — web gates manager pages on profile.managers */}
      {dashCaps.data.isManager ? (
        <LeaderboardPreview
          title="Managers Leaderboard"
          sub="Live · sessions + QHP"
          live
          variant="list"
          accent={C.purple}
          unit="PTS"
          onPress={() => go('mgr-dash')}
          rows={mgrTop3.map((m) => ({ rank: m.rank, name: m.name, value: m.sess, color: m.mc || C.orange }))}
        />
      ) : null}

      <LeaderboardPreview
        title="Trainer Leaderboard"
        sub={leaderboardQ.isLoading ? 'Loading…' : `${leaderRows.length} trainers · this month`}
        accent={C.gold}
        unit="SESS"
        onPress={() => go('trainer-leaderboard')}
        rows={leaderRows.slice(0, 3).map((l, i) => ({ rank: i + 1, name: l.name, value: l.sess, color: l.medalColor || C.orange }))}
      />

      {/* Total QHPs breakdown popup */}
      <Modal visible={!!qhpBreakdown} transparent animationType="slide" onRequestClose={() => setQhpBreakdown(null)}>
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable onPress={() => setQhpBreakdown(null)} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.65)' }} />
          <View style={{ maxHeight: '78%', backgroundColor: '#171210', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.15)', paddingHorizontal: 18, paddingTop: 16, paddingBottom: 28 }}>
            {(() => {
              const col = qhpBreakdown === 'completed' ? C.green : qhpBreakdown === 'overdue' ? C.red : C.gold;
              const rows: QhpTotalsRow[] = qhpBreakdown === 'completed' ? (qhpTotalsQ.data?.completedRows ?? []) : qhpBreakdown === 'overdue' ? (qhpTotalsQ.data?.overdueRows ?? []) : (qhpTotalsQ.data?.pendingRows ?? []);
              const label = qhpBreakdown === 'completed' ? 'Completed' : qhpBreakdown === 'overdue' ? 'Overdue' : 'Scheduled';
              return (
                <>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 12 }}>
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: col }} />
                    <Serif style={{ flex: 1, fontSize: 19, color: '#fff' }}>{label} QHPs</Serif>
                    <View style={{ minWidth: 26, height: 24, paddingHorizontal: 8, borderRadius: 12, backgroundColor: hexA(col, 0.15), borderWidth: 1, borderColor: hexA(col, 0.4), alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: col }}>{rows.length}</Text>
                    </View>
                    <Pressable onPress={() => setQhpBreakdown(null)} hitSlop={10} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name="close" size={15} color={C.muted2} />
                    </Pressable>
                  </View>
                  {qhpBreakdown === 'overdue' ? (
                    <Body style={{ fontSize: 10.5, color: C.muted3, marginBottom: 10 }}>Active clients (trained in the last 30 days) whose latest QHP is more than 45 days old — a refresh is due.</Body>
                  ) : qhpBreakdown === 'pending' ? (
                    <Body style={{ fontSize: 10.5, color: C.muted3, marginBottom: 10 }}>Scheduled this month, assessment not completed yet.</Body>
                  ) : (
                    <Body style={{ fontSize: 10.5, color: C.muted3, marginBottom: 10 }}>QHPs completed in the current month.</Body>
                  )}
                  {rows.length === 0 ? (
                    <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 26 }}>No {label.toLowerCase()} QHPs.</Body>
                  ) : (
                    /* flexShrink lets the list yield to the sheet's maxHeight — without it the
                       ScrollView lays out at full content height and never scrolls. */
                    <ScrollView showsVerticalScrollIndicator={false} style={{ flexShrink: 1 }} nestedScrollEnabled>
                      {rows.map((r) => (
                        <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' }}>
                          <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: hexA(col, 0.12), borderWidth: 1, borderColor: hexA(col, 0.35), alignItems: 'center', justifyContent: 'center' }}>
                            <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: col }}>{(r.clientName[0] ?? '?').toUpperCase()}</Text>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Body style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }} numberOfLines={1}>{r.clientName}</Body>
                            <Body style={{ fontSize: 10.5, color: C.muted2, marginTop: 1 }} numberOfLines={1}>
                              {r.assessorName}{r.subscription ? ` · ${r.subscription}` : ''}
                            </Body>
                          </View>
                          {r.date ? (
                            <Mono style={{ fontSize: 10, color: C.muted3 }}>
                              {new Date(r.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })}
                            </Mono>
                          ) : null}
                        </View>
                      ))}
                    </ScrollView>
                  )}
                </>
              );
            })()}
          </View>
        </View>
      </Modal>

      {/* Pending-sync outbox sheet */}
      <Modal visible={outboxOpen} transparent animationType="slide" onRequestClose={() => setOutboxOpen(false)}>
        <Pressable onPress={() => setOutboxOpen(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}>
          <Pressable onPress={() => {}} style={{ maxHeight: '80%', backgroundColor: C.sheetBg, borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.14)', paddingHorizontal: 18, paddingTop: 12, paddingBottom: 26 }}>
            <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.16)', marginBottom: 14 }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              <IconChip icon="layers" color={C.blue} />
              <View style={{ flex: 1 }}>
                <Serif style={{ fontSize: 20 }}>Waiting to Sync</Serif>
                <Body style={{ fontSize: 12, color: C.muted, marginTop: 1 }}>
                  {netOnline ? 'Online — sync runs automatically' : 'Offline — will sync when connection returns'}
                </Body>
              </View>
              <Pressable onPress={() => setOutboxOpen(false)} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="close" size={14} color="#B8B2AC" strokeWidth={2.3} />
              </Pressable>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingBottom: 8 }}>
              {outbox.length === 0 ? (
                <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 24 }}>All synced — nothing waiting.</Body>
              ) : (
                outbox.map((o) => {
                  const tp = istTimeParts(o.createdAt);
                  const failed = o.status === 'failed';
                  return (
                    <View key={o.id} style={{ padding: 12, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: failed ? hexA(C.red, 0.35) : 'rgba(255,255,255,0.08)', gap: 8 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        <View style={{ width: 32, height: 32, borderRadius: 11, backgroundColor: hexA(o.kind === 'workout-log' ? C.green : C.gold, 0.12), alignItems: 'center', justifyContent: 'center' }}>
                          <Icon name={o.kind === 'workout-log' ? 'dumbbell' : 'file'} size={14} color={o.kind === 'workout-log' ? C.green : C.gold} strokeWidth={2} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Body style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }} numberOfLines={1}>{o.label}</Body>
                          <Body style={{ fontSize: 10.5, color: C.muted3, marginTop: 1 }}>
                            Logged {istDayLabel(o.createdAt)} · {tp.time} {tp.ampm} — keeps this time when it syncs
                          </Body>
                        </View>
                        <Badge
                          text={o.status === 'syncing' ? 'Syncing…' : failed ? 'Sync failed' : netOnline ? 'Queued' : 'Waiting for network'}
                          color={o.status === 'syncing' ? C.blue : failed ? C.red : C.gold}
                        />
                      </View>
                      {failed && o.error ? (
                        <Body style={{ fontSize: 11, color: '#E0A090' }} numberOfLines={2}>{o.error}</Body>
                      ) : null}
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        {o.kind === 'workout-log' ? (
                          <Pressable
                            onPress={() => {
                              const p = o.payload as WorkoutLogOutboxPayload & { clientName?: string };
                              const known = modalities.find((mm) => mm.toLowerCase() === (p.modality ?? '').toLowerCase());
                              setOutboxOpen(false);
                              set({
                                editingOutboxId: o.id,
                                selectedClientId: p.clientId,
                                selectedClientName: p.clientName ?? o.label.split(' · ')[0] ?? 'Client',
                                workoutScheduleId: p.scheduleSessionId ?? null,
                                modality: known ?? 'custom',
                              });
                              go('workout');
                            }}
                            style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 11, backgroundColor: hexA(C.gold, 0.1), borderWidth: 1, borderColor: hexA(C.gold, 0.32) }}
                          >
                            <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: C.gold }}>Edit</Text>
                          </Pressable>
                        ) : null}
                        <Pressable
                          disabled={o.status === 'syncing'}
                          onPress={() => submitItem(o.id)}
                          style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 11, backgroundColor: hexA(C.blue, 0.1), borderWidth: 1, borderColor: hexA(C.blue, 0.3), opacity: o.status === 'syncing' ? 0.5 : 1 }}
                        >
                          <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: '#A9BCFF' }}>{o.status === 'syncing' ? 'Syncing…' : 'Retry now'}</Text>
                        </Pressable>
                        <Pressable
                          onPress={() =>
                            Alert.alert('Discard this log?', `"${o.label}" was NEVER saved to the server — it only exists on this device. Discarding permanently deletes it and it cannot be recovered.`, [
                              { text: 'Keep', style: 'cancel' },
                              { text: 'Discard permanently', style: 'destructive', onPress: () => removeOutboxItem(o.id) },
                            ])
                          }
                          style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 11, backgroundColor: hexA(C.red, 0.08), borderWidth: 1, borderColor: hexA(C.red, 0.28) }}
                        >
                          <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: C.red }}>Discard</Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                })
              )}
              {outbox.some((o) => o.status === 'pending') && netOnline ? (
                <GradientButton label="Sync Now" onPress={() => drainOutbox()} style={{ marginTop: 4 }} />
              ) : null}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Workout Templates management sheet (opened from the sidebar) */}
      <Modal visible={tplSheetOpen} transparent animationType="slide" onRequestClose={() => setTplSheetOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}>
          <View style={{ maxHeight: Math.min(dashWinH * 0.85, dashWinH - dashInsets.top - 12), backgroundColor: '#0E0A09', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: hexA(C.gold, 0.16), paddingHorizontal: 18, paddingTop: 14, paddingBottom: dashInsets.bottom + 18 }}>
            <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 14 }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
              <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: hexA(C.gold, 0.14), alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                <Icon name="file" size={19} color={C.gold} strokeWidth={1.9} />
              </View>
              <View style={{ flex: 1 }}>
                <Serif style={{ fontSize: 20 }}>Workout Templates</Serif>
                <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 2 }}>Your saved workouts · load them while logging</Body>
              </View>
              <Pressable onPress={() => setTplSheetOpen(false)} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="close" size={14} color="#B8B2AC" strokeWidth={2.3} />
              </Pressable>
            </View>

            {/* Create a new template */}
            <Pressable onPress={() => { setTplSheetOpen(false); setTplBuilderOpen(true); }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 13, borderRadius: 13, marginBottom: 14 }}>
              <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderRadius: 13 }} />
              <Icon name="plus" size={15} color="#fff" strokeWidth={2.8} />
              <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: '#fff' }}>Create New Template</Text>
            </Pressable>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20, gap: 9 }}>
              {tplQ.isLoading ? (
                <Body style={{ color: C.muted2, textAlign: 'center', paddingVertical: 24 }}>Loading templates…</Body>
              ) : (tplQ.data?.length ?? 0) === 0 ? (
                <View style={{ alignItems: 'center', gap: 8, paddingVertical: 30 }}>
                  <Icon name="file" size={28} color="#4C4640" strokeWidth={1.6} />
                  <Body style={{ fontSize: 13, color: C.muted3, textAlign: 'center' }}>No templates yet.{'\n'}Save one from the Log Workout screen (Templates button).</Body>
                </View>
              ) : (
                (tplQ.data ?? []).map((t) => (
                  <View key={t.template_id} style={{ borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                    <View style={{ height: 3, backgroundColor: hexA(C.gold, 0.4) }} />
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: 13 }}>
                      <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: hexA(C.gold, 0.12), alignItems: 'center', justifyContent: 'center' }}>
                        <Icon name="dumbbell" size={16} color={C.gold} strokeWidth={1.9} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Body style={{ fontSize: 14.5, fontFamily: F.bodySemi, color: '#fff' }} numberOfLines={1}>{t.template_name}</Body>
                        <Mono style={{ fontSize: 9.5, color: C.muted3, marginTop: 2 }}>{t.exerciseCount} exercise{t.exerciseCount === 1 ? '' : 's'}{t.description ? ` · ${t.description}` : ''}</Mono>
                      </View>
                      <View style={{ paddingVertical: 3, paddingHorizontal: 9, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
                        <Text style={{ fontFamily: F.bodySemi, fontSize: 10, color: C.ink3 }}>{t.modality}</Text>
                      </View>
                      <Pressable onPress={() => Alert.alert('Delete template?', `Remove "${t.template_name}" permanently?`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => delTplM.mutate(t.template_id) }])} hitSlop={8} style={{ width: 32, height: 32, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.04)' }}>
                        <Icon path="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" size={15} color={C.muted2} strokeWidth={2} />
                      </Pressable>
                    </View>
                  </View>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <TemplateBuilderSheet trainerId={trainerId} visible={tplBuilderOpen} onClose={() => setTplBuilderOpen(false)} onSaved={() => { setTplBuilderOpen(false); setTplSheetOpen(true); }} />

      {/* Clients with QHP In Progress (web dialog) */}
      <Modal visible={inProgressOpen} transparent animationType="fade" onRequestClose={() => setInProgressOpen(false)}>
        <Pressable onPress={() => setInProgressOpen(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', padding: 22 }}>
          <Pressable onPress={() => {}} style={{ borderRadius: 18, backgroundColor: '#141010', borderWidth: 1, borderColor: hexA(C.blue, 0.3), padding: 18, gap: 12, maxHeight: '70%' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: '#fff' }}>Clients with QHP In Progress</Text>
                <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 3 }}>These clients have an assessor assigned and the QHP is not yet completed.</Body>
              </View>
              <Pressable onPress={() => setInProgressOpen(false)} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="close" size={13} color="#B8B2AC" strokeWidth={2.3} />
              </Pressable>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              {(inProgressQ.data ?? []).map((c) => (
                <Pressable
                  key={c.clientId}
                  onPress={() => { setInProgressOpen(false); openClient(c.clientId, c.clientName); }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: 12, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', marginBottom: 8 }}
                >
                  <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: hexA(C.blue, 0.14), alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="user" size={15} color={C.blue} strokeWidth={2} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Body style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }} numberOfLines={1}>{c.clientName}</Body>
                    <Body style={{ fontSize: 11, color: C.muted2, marginTop: 1 }} numberOfLines={1}>Assessor: {c.assessorName}{c.assessmentDate ? ` · ${istDayLabel(c.assessmentDate + 'T00:00:00Z')}` : ''}</Body>
                  </View>
                  <Icon name="chevRight" size={13} color={C.muted3} strokeWidth={2.2} />
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

    </Page>
  );
}

function runAction(action: string, { set, go }: { set: (p: any) => void; go: (r: string) => void }) {
  if (action.startsWith('sheet:')) set({ sheet: action.split(':')[1] });
  else if (action.startsWith('route:')) go(action.split(':')[1]);
  else if (action === 'drawer') set({ drawerOpen: true });
}

/* ============ TRAINER LEADERBOARD (dedicated page) ============ */
/* ---------- Leaderboard micro-animations (native-driver, cheap) ---------- */
function RiseIn({ delay = 0, style, children }: { delay?: number; style?: any; children: React.ReactNode }) {
  const v = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    Animated.sequence([Animated.delay(delay), Animated.spring(v, { toValue: 1, useNativeDriver: true, speed: 13, bounciness: 7 })]).start();
  }, []);
  return (
    <Animated.View style={[style, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] }]}>
      {children}
    </Animated.View>
  );
}

/* Bottom-anchored grow (podium bars): scale around center + push down to fake origin-bottom. */
function GrowUp({ delay = 0, height, style, children }: { delay?: number; height: number; style?: any; children: React.ReactNode }) {
  const v = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    Animated.sequence([Animated.delay(delay), Animated.spring(v, { toValue: 1, useNativeDriver: true, speed: 8, bounciness: 9 })]).start();
  }, []);
  return (
    <Animated.View style={[style, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [height / 2, 0] }) }, { scaleY: v }] }]}>
      {children}
    </Animated.View>
  );
}

/* Gentle infinite float (winner's crown). */
function FloatY({ dist = 3, duration = 1300, children }: { dist?: number; duration?: number; children: React.ReactNode }) {
  const v = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, []);
  return <Animated.View style={{ transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -dist] }) }] }}>{children}</Animated.View>;
}

/* Radar-ping live dot. */
function PulseDot({ color, size = 5 }: { color: string; size?: number }) {
  const v = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 1000, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.delay(350),
      Animated.timing(v, { toValue: 0, duration: 1, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, []);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={{ position: 'absolute', width: size, height: size, borderRadius: 99, backgroundColor: color, opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.7, 0] }), transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 3] }) }] }} />
      <View style={{ width: size, height: size, borderRadius: 99, backgroundColor: color }} />
    </View>
  );
}

export function TrainerLeaderboardContent() {
  const lbPeriods = React.useMemo(() => [
    { id: 'this', label: 'This Month', bounds: lbMonthBounds(0) },
    { id: 'last', label: lbMonthLabel(1), bounds: lbMonthBounds(1) },
    { id: 'prev', label: lbMonthLabel(2), bounds: lbMonthBounds(2) },
    { id: '3m', label: '3 Months', bounds: { start: lbMonthBounds(2).start, end: lbMonthBounds(0).end } as LbBounds },
  ], []);
  const [periodId, setPeriodId] = React.useState('this');
  const sel = lbPeriods.find((p) => p.id === periodId) ?? lbPeriods[0];
  const leaderboardQ = useTrainerLeaderboard(sel.bounds);
  const medalColors = [C.gold, '#B8BCC4', '#C08A52'];
  const rows = (leaderboardQ.data && leaderboardQ.data.length
    ? leaderboardQ.data.map((e, i) => ({ name: e.trainerName, ref: e.referralCount, sess: e.sessionCount + e.qhpCount /* web parity: sessions + QHP */, medal: i < 3 ? ic.crown : undefined, medalColor: i < 3 ? medalColors[i] : undefined }))
    : (leaderboardQ.isError ? leaders : []));
  const podium = [rows[1], rows[0], rows[2]].filter(Boolean);
  const podiumHeights = [86, 112, 70];
  const maxSess = Math.max(1, rows[0]?.sess ?? 1);
  return (
    <>
      {/* Hero + podium */}
      <Card colors={['rgba(64,38,22,0.55)', 'rgba(18,14,14,0.6)']} border="rgba(255,150,90,0.16)" radius={22} style={{ overflow: 'hidden' }}>
        <LinearGradient colors={['#E0A53C', '#FB8B3A', '#EE5E16']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 4 }} />
        <View style={{ padding: 18, alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <TrophyIcon size={20} color={C.gold} />
            <Serif style={{ fontSize: 22 }}>Trainer Leaderboard</Serif>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4, paddingHorizontal: 9, borderRadius: 999, backgroundColor: hexA(C.green, 0.12), borderWidth: 1, borderColor: hexA(C.green, 0.28) }}>
              <PulseDot color={C.green} />
              <Text style={{ fontSize: 10.5, fontFamily: F.bodySemi, color: C.green }}>Live</Text>
            </View>
            <Mono style={{ fontSize: 11, color: C.mono2 }}>{sel.label} · {rows.length} trainers</Mono>
          </View>

          {/* Period filter */}
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 14, backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 999, padding: 4 }}>
            {lbPeriods.map((p) => {
              const active = periodId === p.id;
              return active ? (
                <LinearGradient key={p.id} colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ paddingVertical: 7, paddingHorizontal: 13, borderRadius: 999 }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: '#fff' }}>{p.label}</Text>
                </LinearGradient>
              ) : (
                <Pressable key={p.id} onPress={() => setPeriodId(p.id)} style={{ paddingVertical: 7, paddingHorizontal: 13, borderRadius: 999 }}>
                  <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: C.muted }}>{p.label}</Text>
                </Pressable>
              );
            })}
          </View>

          {leaderboardQ.isLoading ? (
            <Body style={{ fontSize: 13, color: C.muted3, paddingVertical: 26 }}>Loading leaderboard…</Body>
          ) : podium.length >= 3 ? (
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10, marginTop: 20, width: '100%' }}>
              {podium.map((m, i) => {
                const col = m.medalColor || C.orange;
                const isFirst = i === 1;
                const delay = isFirst ? 80 : i === 0 ? 280 : 420; // winner rises first
                return (
                  <RiseIn key={periodId + m.name} delay={delay} style={{ flex: 1, alignItems: 'center' }}>
                    {isFirst ? <FloatY><Icon path={ic.crown} size={22} color={col} strokeWidth={1.8} /></FloatY> : null}
                    <View style={{ width: isFirst ? 58 : 48, height: isFirst ? 58 : 48, borderRadius: 29, backgroundColor: hexA(col, 0.16), borderWidth: 2, borderColor: hexA(col, 0.6), alignItems: 'center', justifyContent: 'center', marginTop: 5 }}>
                      <Text style={{ fontFamily: F.bodyBold, fontSize: isFirst ? 17 : 14, color: col }}>{initials(m.name)}</Text>
                    </View>
                    <Text numberOfLines={1} style={{ fontFamily: F.bodySemi, fontSize: 12, color: '#fff', marginTop: 7 }}>{m.name.split(' ')[0]}</Text>
                    <Text style={{ fontFamily: F.mono, fontSize: 10, color: C.muted2, marginTop: 1 }}><CountUp value={m.sess} style={{ fontFamily: F.mono, fontSize: 10, color: C.muted2 }} /> sess</Text>
                    <GrowUp delay={delay + 120} height={podiumHeights[i]} style={{ width: '100%' }}>
                      <LinearGradient colors={[hexA(col, 0.35), hexA(col, 0.06)]} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={{ width: '100%', height: podiumHeights[i], borderTopLeftRadius: 12, borderTopRightRadius: 12, marginTop: 9, alignItems: 'center', paddingTop: 8, borderWidth: 1, borderBottomWidth: 0, borderColor: hexA(col, 0.25) }}>
                        <Serif style={{ fontSize: 24, color: col }}>{i === 1 ? 1 : i === 0 ? 2 : 3}</Serif>
                      </LinearGradient>
                    </GrowUp>
                  </RiseIn>
                );
              })}
            </View>
          ) : null}
        </View>
      </Card>

      {/* Full standings */}
      <Mono style={{ fontSize: 12, letterSpacing: 2.1 }}>FULL STANDINGS</Mono>
      {rows.map((l, i) => {
        const rank = i + 1;
        const top3 = rank <= 3;
        const col = l.medalColor || C.muted;
        return (
          <RiseIn key={periodId + l.name} delay={Math.min(i, 10) * 55} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 11, paddingHorizontal: 12, borderRadius: 14, borderWidth: 1, borderColor: top3 ? hexA(col, 0.3) : 'rgba(255,255,255,0.06)', backgroundColor: top3 ? hexA(col, 0.06) : 'rgba(0,0,0,0.2)' }}>
            <View style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: top3 ? hexA(col, 0.16) : 'rgba(255,255,255,0.04)' }}>
              {l.medal ? <Icon path={l.medal} size={17} color={col} strokeWidth={1.8} /> : <Text style={{ fontFamily: F.mono, fontSize: 12.5, color: C.muted }}>{rank}</Text>}
            </View>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ fontFamily: F.bodySemi, fontSize: 14.5, color: '#fff' }}>{l.name}</Text>
              <View style={{ marginTop: 6 }}>
                <ProgressBar pct={Math.round((l.sess / maxSess) * 100)} height={4} fill={top3 ? col : hexA(C.orange, 0.55)} />
              </View>
            </View>
            <View style={{ alignItems: 'center', minWidth: 34 }}>
              <Mono style={{ fontSize: 8.5, letterSpacing: 1, color: C.faint }}>REF</Mono>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: C.purple, marginTop: 1 }}>{l.ref}</Text>
            </View>
            <View style={{ alignItems: 'center', minWidth: 38 }}>
              <Mono style={{ fontSize: 8.5, letterSpacing: 1, color: C.faint }}>SESS</Mono>
              <CountUp value={l.sess} style={{ fontFamily: F.bodyBold, fontSize: 14, color: C.blue, marginTop: 1 }} />
            </View>
          </RiseIn>
        );
      })}
    </>
  );
}

export function TrainerLeaderboard() {
  return (
    <Page gap={16} pt={6}>
      <TrainerLeaderboardContent />
    </Page>
  );
}

/* Pulsing red ring for low-activity client cards (<12 sessions in 30 days). */
function LowPulseRing({ size = 60 }: { size?: number }) {
  const v = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 1100, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.delay(350),
      Animated.timing(v, { toValue: 0, duration: 1, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [v]);
  return (
    <Animated.View pointerEvents="none" style={{ position: 'absolute', width: size, height: size, borderRadius: size / 2, borderWidth: 1.5, borderColor: C.red, opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }), transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.45] }) }] }} />
  );
}

/* ============ CLIENTS LIST ============ */
const CLIENT_AVS: [string, string][] = [
  ['#F0883E', '#C05621'], ['#4FD1C5', '#2C7A7B'], ['#B794F4', '#6B46C1'],
  ['#F687B3', '#B83280'], ['#68D391', '#276749'], ['#63B3ED', '#2B6CB0'],
];

/* Circular sessions ring for the client card. */
function ClientRing({ done, total }: { done: number; total: number }) {
  const size = 62, stroke = 5.5, r = (size - stroke) / 2, cx = size / 2, cy = size / 2;
  const circ = 2 * Math.PI * r;
  const target = total > 0 ? Math.min(1, done / total) : 0;
  const col = target >= 0.8 ? C.green : target >= 0.5 ? C.gold : C.orange;
  // Animate arc fill + centre count from 0 on mount / when values change.
  const [p, setP] = React.useState(0);
  const anim = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    anim.setValue(0);
    const id = anim.addListener(({ value }) => setP(value));
    Animated.timing(anim, { toValue: target, duration: 950, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
    return () => anim.removeListener(id);
  }, [target]);
  const shownDone = total > 0 ? Math.round(p * total) : done;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size}>
        <SvgCircle cx={cx} cy={cy} r={r} stroke="rgba(255,255,255,0.09)" strokeWidth={stroke} fill="none" />
        {p > 0 ? (
          <SvgCircle cx={cx} cy={cy} r={r} stroke={col} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={`${circ * p} ${circ}`} transform={`rotate(-90 ${cx} ${cy})`} />
        ) : null}
      </Svg>
      <View style={{ position: 'absolute', alignItems: 'center' }}>
        <Text style={{ fontFamily: F.bodyBold, fontSize: 16, color: '#fff' }}>{shownDone}</Text>
        <Mono style={{ fontSize: 8.5, color: C.muted3, marginTop: -1 }}>of {total || '—'}</Mono>
      </View>
    </View>
  );
}

export function Clients() {
  const { clientsTab, set, openClient } = useStore();
  const [query, setQuery] = React.useState('');
  const trainerId = useTrainerId();
  const clientsQ = useMyClients(trainerId);
  const all = clientsQ.data ?? [];

  const isActive = (c: any) => (c.status ?? '').toLowerCase() !== 'inactive';
  const activeN = all.filter(isActive).length;
  const inactiveN = all.length - activeN;
  const q = query.trim().toLowerCase();
  const list = all
    .filter((c) => (clientsTab === 'active' ? isActive(c) : !isActive(c)))
    .filter((c) => !q || c.full_name.toLowerCase().includes(q) || (c.phone ?? '').includes(q));

  return (
    <Page gap={16} pt={6}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {[['active', 'Active Clients', activeN], ['inactive', 'Inactive Clients', inactiveN]].map(([id, label, n]) => {
          const active = clientsTab === id;
          return (
            <Pressable key={id as string} onPress={() => set({ clientsTab: id as any })}>
              {active ? (
                <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={tabRow}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: '#fff' }}>{label}</Text>
                  <View style={{ paddingVertical: 1, paddingHorizontal: 6, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.22)' }}><Text style={{ fontFamily: F.mono, fontSize: 11, color: '#fff' }}>{n}</Text></View>
                </LinearGradient>
              ) : (
                <View style={[tabRow, { backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' }]}>
                  <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: C.muted }}>{label}</Text>
                  <View style={{ paddingVertical: 1, paddingHorizontal: 6, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.06)' }}><Text style={{ fontFamily: F.mono, fontSize: 11, color: C.muted }}>{n}</Text></View>
                </View>
              )}
            </Pressable>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 13, paddingHorizontal: 16, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }}>
        <Icon name="search" size={18} color={C.muted3} strokeWidth={2} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search clients…"
          placeholderTextColor={C.muted3}
          style={{ flex: 1, fontFamily: F.body, fontSize: 15, color: C.ink, padding: 0 }}
        />
      </View>

      {clientsQ.isLoading ? (
        <Body style={{ color: C.muted2, textAlign: 'center', paddingVertical: 30 }}>Loading clients…</Body>
      ) : clientsQ.isError ? (
        <Body style={{ color: C.red, textAlign: 'center', paddingVertical: 30 }}>Couldn't load clients. Pull to refresh.</Body>
      ) : list.length === 0 ? (
        <Body style={{ color: C.muted2, textAlign: 'center', paddingVertical: 30 }}>No {clientsTab} clients{q ? ' match your search' : ''}.</Body>
      ) : (
        list.map((c, idx) => {
          const active = isActive(c);
          const pct = c.cycle_sessions > 0 ? Math.round((c.sessions_in_cycle / c.cycle_sessions) * 100) : 0;
          const lowActivity = active && c.sessions_30d < 12;
          return (
            <Card key={c.client_id} onPress={() => openClient(c.client_id, c.full_name)} colors={lowActivity ? ['rgba(74,28,20,0.5)', 'rgba(24,14,13,0.55)'] : ['rgba(56,34,21,0.42)', 'rgba(20,16,15,0.5)']} border={lowActivity ? hexA(C.red, 0.42) : undefined} radius={20} style={{ padding: 16, gap: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                {/* Avatar: gradient ring + status dot */}
                <View style={{ padding: 2.5, borderRadius: 32, borderWidth: 2, borderColor: active ? hexA(C.green, 0.5) : 'rgba(255,255,255,0.12)' }}>
                  <MiniAvatar initial={initials(c.full_name)} colors={CLIENT_AVS[idx % CLIENT_AVS.length]} size={50} />
                  <View style={{ position: 'absolute', right: -1, bottom: -1, width: 16, height: 16, borderRadius: 8, backgroundColor: active ? C.green : C.muted2, borderWidth: 2.5, borderColor: '#1A1210' }} />
                </View>
                {/* Name + meta */}
                <View style={{ flex: 1 }}>
                  <Serif style={{ fontSize: 18 }} numberOfLines={1}>{c.full_name}</Serif>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
                    {c.subscription_type ? (
                      <View style={{ paddingVertical: 3, paddingHorizontal: 9, borderRadius: 999, backgroundColor: hexA(C.orange, 0.1), borderWidth: 1, borderColor: hexA(C.orange, 0.24) }}>
                        <Text style={{ fontSize: 10.5, fontFamily: F.bodySemi, color: '#F0A875' }}>{c.subscription_type}</Text>
                      </View>
                    ) : null}
                    {c.has_plan ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 3, paddingHorizontal: 8, borderRadius: 999, backgroundColor: hexA(C.blue, 0.1), borderWidth: 1, borderColor: hexA(C.blue, 0.24) }}>
                        <Icon name="file" size={10} color={C.blue} strokeWidth={2.2} />
                        <Text style={{ fontSize: 10.5, fontFamily: F.bodySemi, color: '#8FB6F0' }}>Plan</Text>
                      </View>
                    ) : null}
                  </View>
                  <View style={{ marginTop: 6, gap: 2 }}>
                    {c.crm_name ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Icon name="userCircle" size={12} color={C.muted3} strokeWidth={1.9} />
                        <Body style={{ fontSize: 11.5, color: C.muted2 }}>CRM · {c.crm_name}</Body>
                      </View>
                    ) : null}
                    {c.crm_phone ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Icon name="phone" size={12} color={C.muted3} strokeWidth={1.9} />
                        <Body style={{ fontSize: 11.5, color: C.muted2 }}>{c.crm_phone}</Body>
                      </View>
                    ) : null}
                  </View>
                </View>
                {/* Completed sessions in the rolling last 30 days — the engagement number. */}
                <View style={{ alignItems: 'center', gap: 5 }}>
                  <View style={{ width: 60, height: 60, alignItems: 'center', justifyContent: 'center' }}>
                    {lowActivity ? <LowPulseRing size={60} /> : null}
                    <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: hexA(lowActivity ? C.red : C.orange, 0.1), borderWidth: 1.5, borderColor: hexA(lowActivity ? C.red : C.orange, lowActivity ? 0.5 : 0.32), alignItems: 'center', justifyContent: 'center' }}>
                      <CountUp value={c.sessions_30d} style={{ fontFamily: F.bodyBold, fontSize: 23, color: lowActivity ? C.red : C.orange }} />
                    </View>
                  </View>
                  <Mono style={{ fontSize: 7.5, letterSpacing: 0.6, color: lowActivity ? C.red : C.muted3 }}>LAST 30 DAYS</Mono>
                </View>
              </View>

              {/* Low-activity alert — under 12 sessions in the rolling window */}
              {lowActivity ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 11, borderRadius: 11, backgroundColor: hexA(C.red, 0.09), borderWidth: 1, borderColor: hexA(C.red, 0.32) }}>
                  <Icon name="alert" size={13} color={C.red} strokeWidth={2.2} />
                  <Body style={{ flex: 1, fontSize: 11, color: '#FF9B8F' }}>
                    Low activity — only {c.sessions_30d} session{c.sessions_30d === 1 ? '' : 's'} in the last 30 days (target 12+). Reach out and get them moving.
                  </Body>
                </View>
              ) : null}

              {/* Weekly Summary button */}
              <Pressable onPress={() => openClient(c.client_id, c.full_name, 'weekly')} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 11, borderRadius: 13, backgroundColor: hexA(C.orange, 0.08), borderWidth: 1, borderColor: hexA(C.orange, 0.26) }}>
                <Icon name="calendar" size={14} color={C.orange} strokeWidth={2} />
                <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: C.orange }}>Weekly Summary</Text>
                <Icon name="arrowRight" size={13} color={C.orange} strokeWidth={2.4} />
              </Pressable>
            </Card>
          );
        })
      )}
    </Page>
  );
}
const tabRow = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 7, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 999 };

/* ---------- Mini charts (Progression tab) ---------- */
import Svg, {
  Polyline, Polygon, Line as SvgLine, Circle as SvgCircle, Rect as SvgRect, Text as SvgText,
  Defs, LinearGradient as SvgGrad, Stop,
} from 'react-native-svg';

/* Circular age gauge — ring + big value. */
export function AgeGauge({ value, label, delta, deltaColor, color }: { value: string; label: string; delta: string; deltaColor: string; color: string }) {
  const S = 118, R = 50, CX = S / 2, CY = S / 2;
  const circ = 2 * Math.PI * R;
  const frac = 0.76; // decorative arc sweep
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 8 }}>
      <View style={{ width: S, height: S, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={S} height={S}>
          <SvgCircle cx={CX} cy={CY} r={R} stroke="rgba(255,255,255,0.06)" strokeWidth={9} fill="none" />
          <SvgCircle
            cx={CX} cy={CY} r={R}
            stroke={color} strokeWidth={9} fill="none" strokeLinecap="round"
            strokeDasharray={`${circ * frac} ${circ}`}
            transform={`rotate(-118 ${CX} ${CY})`}
          />
        </Svg>
        <View style={{ position: 'absolute', alignItems: 'center' }}>
          <Serif style={{ fontSize: 27, color }}>{value}</Serif>
          <Mono style={{ fontSize: 8.5, color: C.muted3 }}>YEARS</Mono>
        </View>
      </View>
      <Body style={{ fontSize: 12, fontFamily: F.bodySemi, color: C.ink }}>{label}</Body>
      <Badge text={delta} color={deltaColor} />
    </View>
  );
}

/* Area line chart — gradient fill + WHOOP-style scrubber: drag along the chart
   and a marker + value bubble follows your finger to read any point's value. */
export function AreaLine({ points, color, labels, id }: { points: number[]; color: string; labels: string[]; id: string }) {
  const W = 300, H = 130, PT = 26, PB = 10, PL = 36, PR = 26;
  const min = Math.min(...points), max = Math.max(...points);
  const span = max - min || 1;
  // Y-axis scale: integers when the range is wide, one decimal when tight.
  const fmtTick = (v: number) => (span >= 10 ? String(Math.round(v)) : v.toFixed(1));
  const x = (i: number) => PL + (i / (points.length - 1 || 1)) * (W - PL - PR);
  const y = (v: number) => PT + (1 - (v - min) / span) * (H - PT - PB);
  const poly = points.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  const area = `${PL},${H - PB} ${poly} ${x(points.length - 1)},${H - PB}`;
  const li = points.length - 1;

  // Touch scrubbing: map finger x → nearest data point. The PanResponder is
  // created ONCE, so locate() must read the CURRENT point count through a ref —
  // a captured points.length goes stale when the range chip (3M ↔ All) changes
  // the series size, leaving part of the chart unreachable.
  const [active, setActive] = React.useState<number | null>(null);
  const widthPx = React.useRef(1);
  const lenRef = React.useRef(points.length);
  lenRef.current = points.length;
  React.useEffect(() => { setActive(null); }, [id, points.length]);
  const locate = (lx: number) => {
    const frac = lx / (widthPx.current || 1);
    const t = Math.min(1, Math.max(0, (frac - PL / W) / ((W - PL - PR) / W)));
    return Math.min(lenRef.current - 1, Math.max(0, Math.round(t * (lenRef.current - 1))));
  };
  const pan = React.useRef(
    PanResponder.create({
      // Own the touch fully so the parent ScrollView can't scroll the page while scrubbing.
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderTerminationRequest: () => false, // never hand the gesture back to the scroll view
      onShouldBlockNativeResponder: () => true,       // block the native scroll on Android
      onPanResponderGrant: (e) => setActive(locate(e.nativeEvent.locationX)),
      onPanResponderMove: (e) => setActive(locate(e.nativeEvent.locationX)),
    })
  ).current;

  const bubbleFor = (idx: number) => {
    const bw = 46;
    const bx = Math.min(Math.max(x(idx) - bw / 2, 1), W - bw - 1);
    return { bw, bx };
  };

  return (
    <View>
      <View onLayout={(e) => { widthPx.current = e.nativeEvent.layout.width; }} {...pan.panHandlers}>
        <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
          <Defs>
            <SvgGrad id={`ag-${id}`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={color} stopOpacity={0.28} />
              <Stop offset="1" stopColor={color} stopOpacity={0.01} />
            </SvgGrad>
          </Defs>
          {/* Y-axis gridlines + tick values (top = max, bottom = min) */}
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <SvgLine key={f} x1={PL} y1={PT + f * (H - PT - PB)} x2={W - PR} y2={PT + f * (H - PT - PB)} stroke="rgba(255,255,255,0.05)" strokeWidth={1} strokeDasharray="2 6" />
          ))}
          {[0, 0.5, 1].map((f) => (
            <SvgText key={`t${f}`} x={PL - 6} y={PT + f * (H - PT - PB) + 3} fontSize={8.5} fill="#8A847E" textAnchor="end">{fmtTick(max - f * span)}</SvgText>
          ))}
          <Polygon points={area} fill={`url(#ag-${id})`} />
          <Polyline points={poly} fill="none" stroke={color} strokeWidth={2.4} strokeLinejoin="round" strokeLinecap="round" />
          {points.map((v, i) => (i === li ? null : <SvgCircle key={i} cx={x(i)} cy={y(v)} r={2.6} fill={color} opacity={0.75} />))}
          {active == null ? (
            <>
              {/* emphasized last point */}
              <SvgCircle cx={x(li)} cy={y(points[li])} r={7} fill={color} opacity={0.22} />
              <SvgCircle cx={x(li)} cy={y(points[li])} r={4} fill="#12100E" stroke={color} strokeWidth={2.2} />
              <SvgRect x={x(li) - 24} y={y(points[li]) - 24} width={38} height={16} rx={8} fill={color} />
              <SvgText x={x(li) - 5} y={y(points[li]) - 12.5} fontSize={9.5} fontWeight="bold" fill="#0c0808" textAnchor="middle">{points[li]}</SvgText>
            </>
          ) : (
            <>
              {/* scrubber: guide line + marker + value bubble at top */}
              <SvgLine x1={x(active)} y1={PT - 6} x2={x(active)} y2={H - PB} stroke={color} strokeOpacity={0.55} strokeWidth={1.2} strokeDasharray="3 3" />
              <SvgCircle cx={x(active)} cy={y(points[active])} r={7} fill={color} opacity={0.22} />
              <SvgCircle cx={x(active)} cy={y(points[active])} r={4.3} fill="#12100E" stroke={color} strokeWidth={2.4} />
              {(() => { const { bw, bx } = bubbleFor(active); return (
                <>
                  <SvgRect x={bx} y={2} width={bw} height={17} rx={8} fill={color} />
                  <SvgText x={bx + bw / 2} y={14} fontSize={10} fontWeight="bold" fill="#0c0808" textAnchor="middle">{points[active].toLocaleString()}</SvgText>
                </>
              ); })()}
            </>
          )}
        </Svg>
      </View>
      {labels.length ? (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 5, paddingLeft: 34, paddingRight: 20 }}>
          {labels.map((l, i) => (<Mono key={`${i}-${l}`} style={{ fontSize: 9, color: C.muted3 }}>{l}</Mono>))}
        </View>
      ) : null}
    </View>
  );
}

/* Gradient bars — Y-axis scale, dashed average line, and TAPPABLE bars: tap or
   drag across the chart and the touched bar highlights with a value bubble. */
function GradientBars({ data, labels, color, avg, id }: { data: number[]; labels: string[]; color: string; avg?: number; id: string }) {
  const W = 300, H = 150, PT = 20, PB = 6, PL = 30, PR = 6;
  const max = Math.max(...data) || 1;
  const n = data.length;
  const slot = (W - PL - PR) / n;
  // Cap the width so sparse ranges (1–2 sessions in Week view) render slim,
  // properly-rounded bars instead of giant blobs filling the whole slot.
  const barW = Math.min(slot * 0.56, 30);
  const barRx = Math.min(barW / 2.6, 8);
  const yv = (v: number) => H - PB - (v / max) * (H - PT - PB - 12);
  const fmtTick = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : String(Math.round(v)));

  // Tap / drag → highlight the touched bar with its value bubble.
  const [active, setActive] = React.useState<number | null>(null);
  const widthPx = React.useRef(1);
  React.useEffect(() => { setActive(null); }, [id, n]);
  const locate = (lx: number) => {
    const frac = (lx / (widthPx.current || 1)) * W;
    return Math.min(n - 1, Math.max(0, Math.floor((frac - PL) / slot)));
  };
  const pan = React.useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: (e) => setActive(locate(e.nativeEvent.locationX)),
      onPanResponderMove: (e) => setActive(locate(e.nativeEvent.locationX)),
    })
  );
  // locate() closes over n/slot which change with the range chip — keep it fresh.
  pan.current = React.useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
    onPanResponderGrant: (e) => setActive(locate(e.nativeEvent.locationX)),
    onPanResponderMove: (e) => setActive(locate(e.nativeEvent.locationX)),
  }), [n, slot]);

  return (
    <View>
      <View onLayout={(e) => { widthPx.current = e.nativeEvent.layout.width; }} {...pan.current.panHandlers}>
        <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
          <Defs>
            <SvgGrad id={`bg-${id}`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={color} stopOpacity={1} />
              <Stop offset="1" stopColor={color} stopOpacity={0.45} />
            </SvgGrad>
          </Defs>
          {/* Y-axis gridlines + tick values */}
          {[1, 0.5].map((f) => (
            <React.Fragment key={f}>
              <SvgLine x1={PL} y1={yv(max * f)} x2={W - PR} y2={yv(max * f)} stroke="rgba(255,255,255,0.05)" strokeWidth={1} strokeDasharray="2 6" />
              <SvgText x={PL - 5} y={yv(max * f) + 3} fontSize={8.5} fill="#8A847E" textAnchor="end">{fmtTick(max * f)}</SvgText>
            </React.Fragment>
          ))}
          <SvgText x={PL - 5} y={H - PB + 1} fontSize={8.5} fill="#8A847E" textAnchor="end">0</SvgText>
          {data.map((v, i) => {
            const bx = PL + i * slot + (slot - barW) / 2;
            const by = yv(v);
            const isMax = v === max && v > 0;
            const isActive = active === i;
            const showBubble = isActive || (active == null && isMax);
            return (
              <React.Fragment key={i}>
                <SvgRect
                  x={bx} y={by} width={barW} height={Math.max(H - PB - by, 2)} rx={barRx}
                  fill={v === 0 ? 'rgba(255,255,255,0.07)' : `url(#bg-${id})`}
                  opacity={active != null ? (isActive ? 1 : 0.35) : (v === 0 || isMax ? 1 : 0.72)}
                  stroke={isActive ? '#fff' : 'none'}
                  strokeWidth={isActive ? 1.2 : 0}
                />
                {showBubble ? (
                  <>
                    <SvgRect x={Math.min(Math.max(bx + barW / 2 - 20, PL), W - PR - 40)} y={Math.max(by - 18, 1)} width={40} height={14} rx={7} fill={color} />
                    <SvgText x={Math.min(Math.max(bx + barW / 2 - 20, PL), W - PR - 40) + 20} y={Math.max(by - 18, 1) + 10.5} fontSize={9} fontWeight="bold" fill="#0c0808" textAnchor="middle">{v.toLocaleString()}</SvgText>
                  </>
                ) : (
                  <SvgText x={bx + barW / 2} y={by - 5} fontSize={8.5} fill={v === 0 ? '#6E6862' : '#D8D2CC'} textAnchor="middle">{v}</SvgText>
                )}
              </React.Fragment>
            );
          })}
          {avg ? (
            <>
              <SvgLine x1={PL} y1={yv(avg)} x2={W - PR - 40} y2={yv(avg)} stroke="#fff" strokeOpacity={0.35} strokeWidth={1} strokeDasharray="4 4" />
              <SvgText x={W - PR} y={yv(avg) + 3} fontSize={8.5} fill="#B8B2AC" textAnchor="end">avg {avg}</SvgText>
            </>
          ) : null}
        </Svg>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4, paddingLeft: 28, paddingRight: 2 }}>
        {labels.map((l, i) => (<Mono key={i} style={{ fontSize: 9, color: C.muted3 }}>{l}</Mono>))}
      </View>
    </View>
  );
}

/* Build a filtered + bucketed progression series from workout_analysis rows.
   W/M = per session; 6M = per calendar month (load→avg, 1RM→max). Mirrors the web. */
const PROG_RANGE_DAYS: Record<string, number> = { W: 7, M: 30, '6M': 180 };
function istMonthShort(iso: string) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', month: 'short' }).format(new Date(iso));
}
function sampleLabels(labels: string[], max = 5): string[] {
  if (labels.length <= max) return labels;
  const step = (labels.length - 1) / (max - 1);
  const out: string[] = [];
  for (let i = 0; i < max; i++) out.push(labels[Math.round(i * step)]);
  return out;
}
export function buildProgSeries(rows: any[], range: string, field: 'session_load' | 'max_1rm', agg: 'avg' | 'max') {
  const days = PROG_RANGE_DAYS[range] ?? 30;
  const cutoff = Date.now() - days * 86400000;
  const inWin = rows.filter((r) => r[field] != null && new Date(r.created_at).getTime() >= cutoff);
  let data: number[] = [];
  let rawLabels: string[] = [];
  if (range === '6M') {
    const groups = new Map<string, { vals: number[]; iso: string }>();
    inWin.forEach((r) => {
      const d = new Date(r.created_at);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      if (!groups.has(key)) groups.set(key, { vals: [], iso: r.created_at });
      groups.get(key)!.vals.push(Number(r[field]) || 0);
    });
    for (const g of groups.values()) {
      data.push(agg === 'avg' ? Math.round(g.vals.reduce((a, b) => a + b, 0) / g.vals.length) : Math.max(...g.vals));
      rawLabels.push(istMonthShort(g.iso));
    }
  } else {
    data = inWin.map((r) => Number(r[field]) || 0);
    rawLabels = inWin.map((r) => istDayLabel(r.created_at));
  }
  const headline = data.length
    ? (agg === 'avg' ? Math.round(data.reduce((a, b) => a + b, 0) / data.length) : Math.max(...data))
    : 0;
  return { data, labels: sampleLabels(rawLabels), headline, count: data.length };
}
// Chooses bars (W/M or sparse) vs area line (6M with ≥2 pts), with an empty state.
export function ProgChart({ range, data, labels, color, avg, id }: { range: string; data: number[]; labels: string[]; color: string; avg?: number; id: string }) {
  if (!data.length) {
    return <Body style={{ color: C.muted3, textAlign: 'center', paddingVertical: 18, fontSize: 12.5 }}>No sessions in this range.</Body>;
  }
  if (range === '6M' && data.length >= 2) {
    return <AreaLine id={id} points={data} labels={labels} color={color} />;
  }
  return <GradientBars id={id} data={data} labels={labels} color={color} avg={avg} />;
}

export function RangeChips({ options, value, onChange, accent = C.orange }: { options: string[]; value: string; onChange: (v: string) => void; accent?: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 7 }}>
      {options.map((o) => {
        const active = value === o;
        return (
          <Pressable key={o} onPress={() => onChange(o)} style={{ paddingVertical: 7, paddingHorizontal: 14, borderRadius: 10, backgroundColor: active ? hexA(accent, 0.15) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(accent, 0.4) : 'rgba(255,255,255,0.07)' }}>
            <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 12, color: active ? accent : C.muted }}>{o}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function MiniLine({ points, color, labels }: { points: number[]; color: string; labels: string[] }) {
  const W = 300, H = 120, PT = 10, PB = 8, PL = 34, PR = 8;
  const min = Math.min(...points), max = Math.max(...points);
  const span = max - min || 1;
  const x = (i: number) => PL + (i / (points.length - 1)) * (W - PL - PR);
  const y = (v: number) => PT + (1 - (v - min) / span) * (H - PT - PB);
  const poly = points.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  const ticks = [max, (max + min) / 2, min];
  return (
    <View>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        {ticks.map((t, i) => (
          <React.Fragment key={i}>
            <SvgLine x1={PL} y1={y(t)} x2={W - PR} y2={y(t)} stroke="rgba(255,255,255,0.07)" strokeWidth={1} strokeDasharray="3 5" />
            <SvgText x={PL - 6} y={y(t) + 3} fontSize={9} fill="#8A847E" textAnchor="end">{t.toFixed(1)}</SvgText>
          </React.Fragment>
        ))}
        <Polyline points={poly} fill="none" stroke={color} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((v, i) => (
          <SvgCircle key={i} cx={x(i)} cy={y(v)} r={3.4} fill="#12100E" stroke={color} strokeWidth={1.8} />
        ))}
      </Svg>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingLeft: 30, marginTop: 4 }}>
        {labels.map((l, i) => (<Mono key={`${i}-${l}`} style={{ fontSize: 9, color: C.muted3 }}>{l}</Mono>))}
      </View>
    </View>
  );
}

function MiniBars({ data, labels, color = C.orange }: { data: number[]; labels: string[]; color?: string }) {
  const W = 300, H = 140, PT = 18, PB = 6, PL = 6, PR = 6;
  const max = Math.max(...data) || 1;
  const n = data.length;
  const slot = (W - PL - PR) / n;
  const barW = slot * 0.58;
  return (
    <View>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        {data.map((v, i) => {
          const h = (v / max) * (H - PT - PB - 12);
          const bx = PL + i * slot + (slot - barW) / 2;
          const by = H - PB - h;
          return (
            <React.Fragment key={i}>
              <SvgRect x={bx} y={by} width={barW} height={Math.max(h, 2)} rx={3.5} fill={v === 0 ? 'rgba(255,255,255,0.08)' : color} />
              <SvgText x={bx + barW / 2} y={by - 5} fontSize={9} fill={v === 0 ? '#8A847E' : '#EDE8E2'} textAnchor="middle" fontWeight="bold">{v}</SvgText>
            </React.Fragment>
          );
        })}
      </Svg>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4, paddingHorizontal: 2 }}>
        {labels.map((l, i) => (<Mono key={i} style={{ fontSize: 9, color: C.muted3 }}>{l}</Mono>))}
      </View>
    </View>
  );
}

/* Exercises performed in a logged session — shown under a session's "View". */
function SessionExercises({ sessionId }: { sessionId: string | null }) {
  const q = useSessionExercises(sessionId);
  if (!sessionId) {
    return <Body style={{ fontSize: 12, color: C.muted3, marginTop: 4 }}>This session hasn't been logged yet.</Body>;
  }
  if (q.isLoading) return <Body style={{ fontSize: 12, color: C.muted3, marginTop: 4 }}>Loading exercises…</Body>;
  const exs = q.data ?? [];
  if (exs.length === 0) return <Body style={{ fontSize: 12, color: C.muted3, marginTop: 4 }}>No exercises recorded.</Body>;
  return (
    <View style={{ marginTop: 6, gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <Icon name="dumbbell" size={13} color={C.orange} strokeWidth={2} />
        <Mono style={{ fontSize: 10.5, letterSpacing: 0.8, color: C.orange }}>EXERCISES · {exs.length}</Mono>
      </View>
      {exs.map((ex, i) => (
        <View key={ex.name + i} style={{ borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
          {/* header */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: hexA(C.orange, 0.05) }}>
            <View style={{ width: 24, height: 24, borderRadius: 8, backgroundColor: hexA(C.orange, 0.15), alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontFamily: F.mono, fontSize: 11, color: C.orange }}>{i + 1}</Text>
            </View>
            <Body style={{ flex: 1, fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }} numberOfLines={1}>{ex.name}</Body>
            {ex.body_part ? (
              <View style={{ paddingVertical: 2, paddingHorizontal: 8, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.06)' }}>
                <Text style={{ fontFamily: F.bodySemi, fontSize: 10, color: C.muted2 }}>{ex.body_part}</Text>
              </View>
            ) : null}
          </View>
          {/* set rows */}
          <View style={{ paddingHorizontal: 12, paddingVertical: 8 }}>
            {ex.sets.map((st, j) => {
              const meta = [
                st.duration != null ? `${st.duration}s` : null,
                st.tempo ? `@ ${st.tempo}` : null,
                st.rest != null ? `${st.rest}s rest` : null,
                st.rir != null ? `RIR ${st.rir}` : null,
              ].filter(Boolean).join(' · ');
              return (
                <View key={j} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7, borderTopWidth: j === 0 ? 0 : 1, borderTopColor: 'rgba(255,255,255,0.05)' }}>
                  <Mono style={{ width: 34, fontSize: 9.5, color: C.muted3 }}>SET {st.set_number ?? j + 1}</Mono>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4, minWidth: 70 }}>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: '#fff' }}>{st.reps ?? '—'}</Text>
                    <Mono style={{ fontSize: 9.5, color: C.muted3 }}>REPS</Mono>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4, minWidth: 70 }}>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: st.load ? C.orange : C.muted3 }}>{st.load ?? '—'}</Text>
                    <Mono style={{ fontSize: 9.5, color: C.muted3 }}>KG</Mono>
                  </View>
                  {meta ? <Mono style={{ flex: 1, textAlign: 'right', fontSize: 9.5, color: C.muted3 }}>{meta}</Mono> : <View style={{ flex: 1 }} />}
                </View>
              );
            })}
          </View>
          {ex.notes ? (
            <View style={{ paddingHorizontal: 12, paddingBottom: 10 }}>
              <Body style={{ fontSize: 11.5, color: C.muted2, fontStyle: 'italic' }}>{ex.notes}</Body>
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
}

/* Lightweight markdown renderer for the session AI analysis. */
function AiAnalysis({ text }: { text: string }) {
  const clean = (s: string) => s.replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1').trim();
  const lines = text.split('\n');
  const out: React.ReactNode[] = [];
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    if (line.startsWith('##')) {
      out.push(<Serif key={i} style={{ fontSize: 15, color: C.orange, marginTop: out.length ? 8 : 0 }}>{clean(line.replace(/^#+\s*/, ''))}</Serif>);
    } else if (/^[•\-*]\s+/.test(line)) {
      const t = clean(line.replace(/^[•\-*]\s+/, ''));
      out.push(
        <View key={i} style={{ flexDirection: 'row', gap: 8, paddingRight: 4 }}>
          <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: C.blue, marginTop: 7 }} />
          <Body style={{ flex: 1, fontSize: 12.5, color: C.ink3, lineHeight: 19 }}>{t}</Body>
        </View>
      );
    } else {
      out.push(<Body key={i} style={{ fontSize: 12.5, color: C.ink3, lineHeight: 19 }}>{clean(line)}</Body>);
    }
  });
  return <View style={{ gap: 6 }}>{out}</View>;
}

/* ============ CLIENT DETAIL ============ */
/* ---------- AI Weekly Report tab (web AIWeeklySummaryHistory port) ----------
   Pure renderer of weekly_progression_tracking.ai_weekly_summary (deterministic JSON
   written by the populate-weekly-snapshots edge fn). 1W/4W/12W comparison computed
   client-side from row columns, same maths as web. */
const wkTagColor = (t?: string | null) => {
  const s = (t ?? '').toUpperCase();
  if (s.includes('NEED') || s === 'MISSING') return C.red;
  if (s.includes('LEVER')) return C.gold;
  if (s.includes('STRONG') || s === 'POSITIVE' || s.includes('BUILDING')) return C.green;
  return C.muted;
};
const wkStatusColor = (s?: string | null) => (s === 'green' ? C.green : s === 'yellow' ? C.gold : s === 'red' ? C.red : C.muted3);
/* Renders **bold** spans in summary copy with an accent color (web parity). */
function BoldCopy({ text, size = 12.5, color = C.ink3, boldColor = C.gold, lineHeight }: { text: string; size?: number; color?: string; boldColor?: string; lineHeight?: number }) {
  return (
    <Text style={{ fontFamily: F.body, fontSize: size, color, lineHeight: lineHeight ?? size * 1.5 }}>
      {text.split(/(\*\*.*?\*\*)/g).map((part, i) =>
        part.startsWith('**') && part.endsWith('**')
          ? <Text key={i} style={{ fontFamily: F.bodySemi, color: boldColor }}>{part.slice(2, -2)}</Text>
          : part
      )}
    </Text>
  );
}
const WK_DRIVER_META: Record<string, { icon: IconName; title: string; fallbackWhy: string }> = {
  recovery: { icon: 'clock', title: 'Recovery', fallbackWhy: 'Sleep is the single highest-leverage recovery input. It governs hormonal regulation, tissue repair, neural performance, and metabolic efficiency — all systems that Odds actively tracks.' },
  strength: { icon: 'dumbbell', title: 'Strength', fallbackWhy: 'Resistance training is the primary input to your MAQ — Mechanical Health score. It governs structural integrity, functional capacity, injury resistance, and lean mass, all of which compound over time into longevity markers.' },
  movement: { icon: 'route', title: 'Movement', fallbackWhy: 'Non-exercise activity thermogenesis (NEAT) — the movement you do outside the gym — accounts for more total energy expenditure than your workouts. At your current training volume, **steps are the biggest metabolic lever you have**.' },
  nutrition: { icon: 'heart', title: 'Nutrition', fallbackWhy: 'Nutrition quality directly impacts recovery, energy, and metabolic health markers that feed into your AXION score.' },
};
function WkDetailBlock({ label, body }: { label: string; body: string }) {
  return (
    <View style={{ gap: 4 }}>
      <Mono style={{ fontSize: 8.5, letterSpacing: 1.6, color: C.muted3 }}>{label.toUpperCase()}</Mono>
      <BoldCopy text={body} size={12} color={C.ink3} boldColor="#fff" />
    </View>
  );
}
function AiWeeklyReportTab({ clientId }: { clientId: string | null }) {
  const { session } = useAuth();
  const trainerUid = session?.user?.id ?? null;
  const qc = useQueryClient();
  const q = useWeeklyProgressionAll(clientId);
  const [cmpTab, setCmpTab] = React.useState<'1W' | '4W' | '12W'>('1W');
  const [openDriver, setOpenDriver] = React.useState<string | null>(null);
  const [openSystem, setOpenSystem] = React.useState<string | null>(null);
  const ackedRef = React.useRef<Set<string>>(new Set());

  const rows = q.data ?? [];
  const todayYmd = new Date().toISOString().slice(0, 10);
  const summary = rows.find((w) => w.ai_weekly_summary != null && w.week_end <= todayYmd) ?? null;

  // Silent auto-acknowledge on first view (web parity).
  React.useEffect(() => {
    if (!summary || !trainerUid || q.isLoading) return;
    const acks: string[] = Array.isArray(summary.trainer_acknowledgements) ? summary.trainer_acknowledgements : [];
    if (acks.includes(trainerUid) || ackedRef.current.has(summary.id)) return;
    ackedRef.current.add(summary.id);
    ackWeeklyReport(summary.id, acks, trainerUid)
      .then(() => qc.invalidateQueries({ queryKey: ['weekly-progression-all', clientId] }))
      .catch(() => ackedRef.current.delete(summary.id));
  }, [summary, trainerUid, q.isLoading, clientId, qc]);

  if (q.isPending) {
    return <View style={{ paddingVertical: 30, alignItems: 'center', gap: 8 }}><ActivityIndicator color={C.orange} /><Body style={{ fontSize: 11.5, color: C.muted2 }}>Loading weekly report…</Body></View>;
  }
  if (q.isError) {
    return <Body style={{ fontSize: 12.5, color: C.red, textAlign: 'center', paddingVertical: 24 }}>Couldn't load weekly report: {(q.error as Error).message}</Body>;
  }

  let data: any = null;
  try {
    data = summary ? (typeof summary.ai_weekly_summary === 'string' ? JSON.parse(summary.ai_weekly_summary) : summary.ai_weekly_summary) : null;
  } catch { data = null; }

  if (!summary) {
    return (
      <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.09)" style={{ padding: 24, alignItems: 'center', gap: 8 }}>
        <Icon name="sparkle" size={26} color={C.muted3} strokeWidth={1.6} />
        <Body style={{ fontSize: 13, fontFamily: F.bodySemi, color: '#fff' }}>No weekly summary available</Body>
        <Body style={{ fontSize: 11.5, color: C.muted3, textAlign: 'center' }}>No weekly summary has been generated for this client yet.</Body>
      </Card>
    );
  }

  // Legacy text-format rows parse to null — web still shows the header + comparison card.
  const fmtW = (d?: string) => { try { return new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); } catch { return d ?? ''; } };
  const weekRange = data?.week_range;
  const weekLabel = weekRange ? `${fmtW(weekRange.start)} – ${fmtW(weekRange.end)}` : `${fmtW(summary.week_start)} – ${fmtW(summary.week_end)}`;
  const thisWeek = data?.this_week;
  const drivers = data?.what_moved_your_week;
  const compared = data?.compared_with_last_week;
  const systemAges = data?.system_ages;
  const trainingWeek = data?.training_week;
  const bestNextMove = data?.best_next_move;
  const keepDoing: string[] = data?.keep_doing ?? [];
  const progressions: string[] = data?.progressions ?? [];
  const declines: string[] = data?.declines ?? [];

  // ----- 1W/4W/12W comparison maths (verbatim web port) -----
  const fmtSleep = (hrs: number | null) => { if (hrs == null) return null; const h = Math.floor(hrs); const m = Math.round((hrs - h) * 60); return `${h}h ${m}m`; };
  const avgNum = (arr: (number | null)[]) => { const v = arr.filter((x): x is number => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const trendDesc = (cur: number | null, periodAvg: number | null): { text: string; dir: 'up' | 'down' | null } => {
    if (cur == null || periodAvg == null || periodAvg === 0) return { text: '', dir: null };
    const pct = ((cur - periodAvg) / periodAvg) * 100;
    if (pct > 10) return { text: '↑ strong growth', dir: 'up' };
    if (pct > 0) return { text: '↑ on track', dir: 'up' };
    if (pct > -10) return { text: '→ on track', dir: null };
    return { text: '↓ Needs improvement', dir: 'down' };
  };
  const curIdx = rows.findIndex((w) => w.id === summary.id);
  type CmpRow = { current: string | null; delta: string | null; dir: 'up' | 'down' | null; belowTarget?: boolean };
  const buildOneWeek = (): Record<string, CmpRow> | null => {
    const prev = curIdx >= 0 && curIdx + 1 < rows.length ? rows[curIdx + 1] : null;
    if (!prev) return null;
    return {
      sleep: {
        current: fmtSleep(summary.avg_sleep_hours),
        delta: summary.avg_sleep_hours != null && prev.avg_sleep_hours != null ? `${summary.avg_sleep_hours >= prev.avg_sleep_hours ? '↑' : '↓'} from ${fmtSleep(prev.avg_sleep_hours)}` : null,
        dir: summary.avg_sleep_hours != null && prev.avg_sleep_hours != null ? (summary.avg_sleep_hours >= prev.avg_sleep_hours ? 'up' : 'down') : null,
      },
      strength: {
        current: `${summary.workout_count ?? 0} sessions`,
        delta: summary.workout_count != null && prev.workout_count != null ? (summary.workout_count === prev.workout_count ? 'Steady' : `${summary.workout_count > prev.workout_count ? '↑' : '↓'} ${Math.abs(summary.workout_count - prev.workout_count)} from last`) : null,
        dir: summary.workout_count != null && prev.workout_count != null ? (summary.workout_count >= prev.workout_count ? 'up' : 'down') : null,
      },
      steps: {
        current: summary.avg_steps != null ? Math.round(summary.avg_steps).toLocaleString() : null,
        delta: summary.avg_steps != null && prev.avg_steps != null ? `${summary.avg_steps >= prev.avg_steps ? '↑' : '↓'} from ${Math.round(prev.avg_steps).toLocaleString()}` : null,
        dir: summary.avg_steps != null && prev.avg_steps != null ? (summary.avg_steps >= prev.avg_steps ? 'up' : 'down') : null,
        belowTarget: summary.avg_steps != null && summary.avg_steps < 7000,
      },
      nutrition: {
        current: summary.avg_nutrition_rating != null ? `${summary.avg_nutrition_rating.toFixed(1)}/10` : null,
        delta: summary.avg_nutrition_rating != null && prev.avg_nutrition_rating != null ? `${summary.avg_nutrition_rating >= prev.avg_nutrition_rating ? '↑' : '↓'} from ${prev.avg_nutrition_rating.toFixed(1)}` : null,
        dir: summary.avg_nutrition_rating != null && prev.avg_nutrition_rating != null ? (summary.avg_nutrition_rating >= prev.avg_nutrition_rating ? 'up' : 'down') : null,
      },
    };
  };
  const buildPeriod = (weeksBack: number): Record<string, CmpRow> | null => {
    const periodWeeks = rows.slice(curIdx + 1).slice(0, weeksBack);
    if (periodWeeks.length === 0) return null;
    const avgSleep = avgNum(periodWeeks.map((w) => w.avg_sleep_hours));
    const avgWorkout = avgNum(periodWeeks.map((w) => w.workout_count));
    const avgSteps = avgNum(periodWeeks.map((w) => w.avg_steps));
    const avgNut = avgNum(periodWeeks.map((w) => w.avg_nutrition_rating));
    const sleepT = trendDesc(summary.avg_sleep_hours, avgSleep);
    const strengthT = trendDesc(summary.workout_count, avgWorkout);
    const stepsT = trendDesc(summary.avg_steps, avgSteps);
    const nutT = trendDesc(summary.avg_nutrition_rating, avgNut);
    const sleepVals = periodWeeks.map((w) => w.avg_sleep_hours).filter((v): v is number => v != null);
    const isBestSleep = summary.avg_sleep_hours != null && sleepVals.length > 0 && sleepVals.every((s) => summary.avg_sleep_hours! >= s);
    const periodLabel = periodWeeks.length < weeksBack ? `${periodWeeks.length}` : `${weeksBack}`;
    return {
      sleep: { current: avgSleep != null ? `${fmtSleep(avgSleep)} avg` : '—', delta: isBestSleep ? `↑ best ${periodLabel} wks ahead` : (sleepT.text || '—'), dir: isBestSleep ? 'up' : sleepT.dir },
      strength: { current: avgWorkout != null ? `${avgWorkout.toFixed(1)} avg` : '—', delta: strengthT.text || '—', dir: strengthT.dir },
      steps: { current: avgSteps != null ? `${Math.round(avgSteps).toLocaleString()} avg` : '—', delta: stepsT.text || (summary.avg_steps != null && summary.avg_steps < 7000 ? 'Needs improvement' : '—'), dir: stepsT.dir, belowTarget: summary.avg_steps != null && summary.avg_steps < 7000 },
      nutrition: { current: avgNut != null ? `${avgNut.toFixed(1)}/10 avg` : '—', delta: nutT.text || '—', dir: nutT.dir },
    };
  };
  const oneWeek = buildOneWeek();
  const cmpFor = (tab: '1W' | '4W' | '12W'): Record<string, CmpRow> | null => {
    if (tab === '1W' && compared) {
      // Stored comparison wins for 1W (web parity); nutrition always computed client-side.
      return {
        sleep: { current: compared.sleep?.current || oneWeek?.sleep?.current || '—', delta: compared.sleep?.delta ?? null, dir: compared.sleep?.delta?.startsWith('↑') ? 'up' : compared.sleep?.delta?.startsWith('↓') ? 'down' : null },
        strength: { current: compared.strength?.current || oneWeek?.strength?.current || '—', delta: compared.strength?.delta ?? null, dir: compared.strength?.delta === 'Steady' ? 'up' : compared.strength?.delta?.startsWith('↑') ? 'up' : compared.strength?.delta?.startsWith('↓') ? 'down' : null },
        steps: { current: compared.steps?.current || oneWeek?.steps?.current || '—', delta: compared.steps?.delta || compared.steps?.target_note || null, dir: compared.steps?.delta?.startsWith('↑') ? 'up' : compared.steps?.delta?.startsWith('↓') ? 'down' : null, belowTarget: compared.steps?.status !== 'green' },
        nutrition: oneWeek?.nutrition ?? { current: null, delta: null, dir: null },
      };
    }
    return tab === '1W' ? oneWeek : buildPeriod(tab === '4W' ? 4 : 12);
  };
  const activeCmp = cmpFor(cmpTab);
  const sectionTitle = (text: string, color: string = C.mono) => (
    <Mono style={{ fontSize: 11, letterSpacing: 1.8, color }}>{text}</Mono>
  );

  return (
    <>
      {/* Header */}
      <View style={{ alignItems: 'center', marginBottom: 2 }}>
        <Mono style={{ fontSize: 10, letterSpacing: 2.4, color: C.mono2 }}>WEEKLY REPORT</Mono>
        <Serif style={{ fontSize: 24, marginTop: 4 }}>{weekLabel}</Serif>
      </View>

      {/* THIS WEEK hero */}
      {thisWeek ? (
        <Card colors={['rgba(64,38,22,0.5)', 'rgba(18,14,14,0.55)']} border="rgba(255,150,90,0.14)" style={{ padding: 17, gap: 12 }}>
          {sectionTitle('THIS WEEK', C.green)}
          <Serif style={{ fontSize: 19, lineHeight: 26, color: '#fff' }}>{thisWeek.headline}</Serif>
          {thisWeek.sub_headline ? <BoldCopy text={thisWeek.sub_headline} size={13} color={C.ink3} boldColor={C.gold} /> : null}
          <View style={{ flexDirection: 'row', gap: 7, flexWrap: 'wrap' }}>
            {([['sessions', thisWeek.metrics?.sessions], ['sleep', thisWeek.metrics?.sleep], ['steps', thisWeek.metrics?.steps]] as const).map(([k, m]) =>
              m?.value != null ? (
                <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, backgroundColor: hexA(wkStatusColor(m.status), 0.1), borderWidth: 1, borderColor: hexA(wkStatusColor(m.status), 0.28) }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: wkStatusColor(m.status) }} />
                  <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: C.ink }}>{m.value} {m.label ?? ''}</Text>
                </View>
              ) : null
            )}
          </View>
          {thisWeek.fastest_gain ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 13, borderRadius: 13, backgroundColor: hexA(C.orange, 0.1), borderWidth: 1, borderColor: hexA(C.orange, 0.35) }}>
              <Icon path="M13 2 4.5 13.5H11L9 22l9.5-11.5H12z" size={17} color={C.orange} strokeWidth={2} />
              <Body style={{ flex: 1, fontSize: 13, fontFamily: F.bodySemi, color: '#F0A875' }}>{thisWeek.fastest_gain.action} {thisWeek.fastest_gain.highlight}</Body>
            </View>
          ) : null}
          {thisWeek.confidence ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: thisWeek.confidence.days_logged >= 6 ? C.green : thisWeek.confidence.days_logged >= 4 ? C.gold : C.red }} />
              <Mono style={{ fontSize: 10.5, color: C.muted2 }}>{thisWeek.confidence.level} · {thisWeek.confidence.days_logged}/{thisWeek.confidence.total_days} days logged</Mono>
            </View>
          ) : null}
        </Card>
      ) : null}

      {/* WHAT MOVED YOUR WEEK */}
      {drivers ? (
        <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.09)" style={{ padding: 16, gap: 10 }}>
          {sectionTitle('WHAT MOVED YOUR WEEK')}
          {Object.entries(drivers).map(([key, drv]: [string, any]) => {
            const meta = WK_DRIVER_META[key] ?? { icon: 'sparkle' as IconName, title: key, fallbackWhy: '' };
            const col = wkTagColor(drv.label);
            const open = openDriver === key;
            const detail = drv.detail ?? {};
            const why = detail.why_it_matters || meta.fallbackWhy;
            const changed = detail.what_changed || drv.description || '';
            const action = detail.best_next_action || '';
            return (
              <Pressable key={key} onPress={() => setOpenDriver(open ? null : key)} style={{ borderRadius: 14, backgroundColor: hexA(col, 0.06), borderWidth: 1, borderColor: hexA(col, open ? 0.35 : 0.22), borderLeftWidth: 3, borderLeftColor: col, padding: 12, gap: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: hexA(col, 0.14), borderWidth: 1, borderColor: hexA(col, 0.35), alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name={meta.icon} size={16} color={col} strokeWidth={2} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Body style={{ fontSize: 14, fontFamily: F.bodyBold, color: '#fff' }}>{meta.title}</Body>
                    <Body numberOfLines={open ? undefined : 1} style={{ fontSize: 11.5, color: C.muted2, marginTop: 1 }}>{drv.description}</Body>
                  </View>
                  <View style={{ paddingVertical: 4, paddingHorizontal: 9, borderRadius: 7, backgroundColor: hexA(col, 0.18) }}>
                    <Text style={{ fontFamily: F.mono, fontSize: 8.5, letterSpacing: 0.6, color: col }}>{drv.label}</Text>
                  </View>
                  <Icon name={open ? 'chevUp' : 'chevDown'} size={13} color={C.muted3} strokeWidth={2.2} />
                </View>
                {open ? (
                  <View style={{ gap: 11, paddingTop: 10, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.07)' }}>
                    {why ? <WkDetailBlock label="Why it matters" body={why} /> : null}
                    {changed ? <WkDetailBlock label="What changed this week" body={changed} /> : null}
                    {action ? <WkDetailBlock label="Best next action" body={action} /> : null}
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </Card>
      ) : null}

      {/* COMPARED WITH LAST WEEK */}
      <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.09)" style={{ padding: 16, gap: 13 }}>
        {sectionTitle('COMPARED WITH LAST WEEK')}
        <View style={{ flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 999, padding: 3 }}>
          {(['1W', '4W', '12W'] as const).map((r) =>
            cmpTab === r ? (
              <LinearGradient key={r} colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: 999 }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: '#fff' }}>{r}</Text>
              </LinearGradient>
            ) : (
              <Pressable key={r} onPress={() => setCmpTab(r)} style={{ flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: 999 }}>
                <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: C.muted }}>{r}</Text>
              </Pressable>
            )
          )}
        </View>
        {!activeCmp ? (
          <View style={{ alignItems: 'center', paddingVertical: 16, gap: 5 }}>
            <Icon name="alert" size={16} color={C.muted3} strokeWidth={2} />
            <Body style={{ fontSize: 12, color: C.muted2 }}>Previous {cmpTab === '4W' ? '4-week' : cmpTab === '12W' ? '12-week' : 'week'} report not available</Body>
            <Body style={{ fontSize: 10.5, color: C.muted3 }}>Not enough historical data for this comparison period.</Body>
          </View>
        ) : (
          ([['Sleep', activeCmp.sleep], ['Strength', activeCmp.strength], ['Steps', activeCmp.steps], ['Nutrition', activeCmp.nutrition]] as [string, CmpRow][]).map(([lab, row], i) => {
            const deltaCol = row.belowTarget ? C.gold : row.dir === 'down' ? C.red : row.dir === 'up' ? C.green : C.muted;
            return (
              <View key={lab} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: 'rgba(255,255,255,0.05)' }}>
                <Body style={{ width: 84, fontSize: 13, color: C.muted }}>{lab}</Body>
                <Text style={{ flex: 1, fontFamily: F.bodyBold, fontSize: 14.5, color: '#fff', textAlign: 'center' }}>{row.current || '—'}</Text>
                <Text style={{ flex: 1, fontFamily: F.bodySemi, fontSize: 12, color: deltaCol, textAlign: 'right' }}>{row.belowTarget && !row.delta ? 'Below target range' : row.delta || '—'}</Text>
              </View>
            );
          })
        )}
      </Card>

      {/* SYSTEM AGES */}
      {systemAges ? (
        <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.09)" style={{ padding: 16, gap: 12 }}>
          {sectionTitle('YOUR SYSTEM AGES')}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {(['axion', 'maq'] as const).map((k) => {
              const s = systemAges[k];
              if (!s) return null;
              const bc = wkTagColor(s.tag);
              return (
                <Pressable key={k} onPress={() => setOpenSystem(openSystem === k ? null : k)} style={{ flex: 1, padding: 13, borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: hexA(bc, openSystem === k ? 0.45 : 0.22) }}>
                  <Mono style={{ fontSize: 10, letterSpacing: 1, color: C.orange }}>{s.label}</Mono>
                  <Body style={{ fontSize: 10.5, color: C.muted2, marginTop: 1 }}>{s.subtitle}</Body>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4, marginTop: 8 }}>
                    <Serif style={{ fontSize: 26 }}>{s.value != null ? Number(s.value).toFixed(1) : '—'}</Serif>
                    <Body style={{ fontSize: 11, color: C.muted2, marginBottom: 3 }}>yrs</Body>
                  </View>
                  <View style={{ alignSelf: 'flex-start', marginTop: 7, paddingVertical: 3, paddingHorizontal: 8, borderRadius: 7, backgroundColor: hexA(bc, 0.16) }}>
                    <Text style={{ fontFamily: F.mono, fontSize: 8, letterSpacing: 0.6, color: bc }}>{s.tag}</Text>
                  </View>
                  <Body style={{ fontSize: 10.5, color: C.muted2, lineHeight: 15, marginTop: 8 }}>{s.description}</Body>
                </Pressable>
              );
            })}
          </View>
          {openSystem && systemAges[openSystem] ? (() => {
            const s = systemAges[openSystem];
            const d = s.detail ?? {};
            const chrono = systemAges.chronological_age;
            const isAx = openSystem === 'axion';
            const means = d.what_it_means || (isAx
              ? `AXION tracks how efficiently your body manages energy — insulin sensitivity, mitochondrial function, body composition, and metabolic flexibility.${s.value != null && chrono != null ? ` **${Number(s.value).toFixed(1)} ${Number(s.value) <= chrono ? 'is solid for' : 'is above'} your chronological age of ${chrono}**.` : ''}`
              : `MAQ reflects your body's structural and physical capacity — strength levels, joint stability, lean mass, movement quality, and physical resilience under load.${s.value != null && chrono != null ? ` **${Number(s.value).toFixed(1)} with your training history is ${Number(s.value) <= chrono ? 'strong and trending well.' : 'reasonable, and trending in the right direction.'}**` : ''}`);
            const influenced = d.what_influenced || s.description || '';
            const improves = d.what_improves || (isAx
              ? 'Walking. Specifically, breaking sedentary time with short walks after meals. This is the most evidence-backed, cost-effective AXION input.'
              : 'Maintain 3 sessions per week minimum. Progressive overload across your compound lifts. And continued sleep quality — recovery is when MAQ adaptations actually consolidate.');
            return (
              <View style={{ gap: 11, padding: 13, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
                {means ? <WkDetailBlock label="What this score means" body={means} /> : null}
                {influenced ? <WkDetailBlock label="What influenced it this week" body={influenced} /> : null}
                {improves ? <WkDetailBlock label="What improves it fastest" body={improves} /> : null}
              </View>
            );
          })() : null}
          {systemAges.chronological_age != null ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <Body style={{ fontSize: 12, color: C.muted }}>Chronological age</Body>
              <Serif style={{ fontSize: 16 }}>{systemAges.chronological_age} yrs</Serif>
            </View>
          ) : null}
        </Card>
      ) : null}

      {/* TRAINING WEEK */}
      {trainingWeek ? (
        <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.09)" style={{ padding: 16, gap: 13 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
            <View style={{ flex: 1 }}>{sectionTitle('YOUR TRAINING WEEK')}</View>
            <Serif style={{ fontSize: 20, color: C.green }}>{trainingWeek.active_days}</Serif>
            <Body style={{ fontSize: 12, color: C.muted2 }}>/{trainingWeek.total_days} days</Body>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            {(['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const).map((dLab, i) => {
              const has = (trainingWeek.sessions ?? []).some((s: any) => { if (!s?.date) return false; const d = new Date(s.date); return !isNaN(d.getTime()) && d.getDay() === i; });
              return (
                <View key={i} style={{ alignItems: 'center', gap: 5 }}>
                  <Mono style={{ fontSize: 9, color: C.muted3 }}>{dLab}</Mono>
                  <View style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: has ? hexA(C.green, 0.14) : 'rgba(255,255,255,0.03)', borderWidth: 1.5, borderColor: has ? hexA(C.green, 0.5) : 'rgba(255,255,255,0.1)' }}>
                    {has ? <Icon path="M20 6 9 17l-5-5" size={13} color={C.green} strokeWidth={2.8} /> : null}
                  </View>
                </View>
              );
            })}
          </View>
          {(trainingWeek.sessions ?? []).length > 0 ? (
            <View style={{ gap: 2 }}>
              {(trainingWeek.sessions ?? []).map((s: any, i: number) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: 'rgba(255,255,255,0.05)' }}>
                  <Mono style={{ minWidth: 52, fontSize: 10.5, color: C.orange }}>{s.date}</Mono>
                  <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.06)' }} />
                  <Body style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{s.type || s.modality || 'Session'}</Body>
                </View>
              ))}
            </View>
          ) : null}
          {trainingWeek.summary ? <Body style={{ fontSize: 11.5, color: C.muted2, fontStyle: 'italic' }}>{trainingWeek.summary}</Body> : null}
        </Card>
      ) : null}

      {/* BEST NEXT MOVE */}
      {bestNextMove ? (
        <Card colors={['rgba(64,38,22,0.5)', 'rgba(18,14,14,0.55)']} border={hexA(C.orange, 0.3)} style={{ padding: 16, gap: 11 }}>
          {sectionTitle('YOUR BEST NEXT MOVE', C.orange)}
          <Serif style={{ fontSize: 18, lineHeight: 24 }}>{bestNextMove.headline}</Serif>
          {bestNextMove.description ? <BoldCopy text={bestNextMove.description} size={12.5} color={C.ink3} boldColor={C.gold} /> : null}
          {bestNextMove.target_highlight ? (
            <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 15, borderRadius: 999 }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 11.5, letterSpacing: 0.5, color: '#fff' }}>{String(bestNextMove.target_highlight).toUpperCase()}</Text>
            </LinearGradient>
          ) : null}
          {keepDoing.length > 0 ? (
            <>
              <Mono style={{ fontSize: 9.5, letterSpacing: 1, color: C.muted3, marginTop: 4 }}>KEEP DOING</Mono>
              <View style={{ flexDirection: 'row', gap: 7, flexWrap: 'wrap' }}>
                {keepDoing.map((k) => (
                  <View key={k} style={{ paddingVertical: 6, paddingHorizontal: 11, borderRadius: 999, backgroundColor: hexA(C.green, 0.1), borderWidth: 1, borderColor: hexA(C.green, 0.3) }}>
                    <Text style={{ fontFamily: F.bodySemi, fontSize: 11.5, color: C.green }}>{k}</Text>
                  </View>
                ))}
              </View>
            </>
          ) : null}
          {bestNextMove.expected_outcome ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 11, borderRadius: 12, backgroundColor: hexA(C.green, 0.06), borderWidth: 1, borderColor: hexA(C.green, 0.2) }}>
              <Icon name="trend" size={14} color={C.green} strokeWidth={2} />
              <Body style={{ flex: 1, fontSize: 11.5, color: '#9ED8B5', lineHeight: 16 }}>{bestNextMove.expected_outcome}</Body>
            </View>
          ) : null}
        </Card>
      ) : null}

      {/* WEEK IN NUMBERS */}
      {progressions.length > 0 || declines.length > 0 ? (
        <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.09)" style={{ padding: 16, gap: 9 }}>
          {sectionTitle('WEEK IN NUMBERS', C.gold)}
          {progressions.map((item, i) => (
            <View key={`p-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Icon name="trend" size={14} color={C.green} strokeWidth={2.2} />
              <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: C.green }}>{item}</Text>
            </View>
          ))}
          {declines.map((item, i) => (
            <View key={`d-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ transform: [{ scaleY: -1 }] }}><Icon name="trend" size={14} color={C.red} strokeWidth={2.2} /></View>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: C.red }}>{item}</Text>
            </View>
          ))}
        </Card>
      ) : null}
    </>
  );
}

export function ClientDetail() {
  const { go, selectedClientId, selectedClientName, clientInitialTab } = useStore();
  const clientId = selectedClientId;
  const detailQ = useClientDetail(clientId);
  const sessionsQ = useClientSessions(clientId);
  const plansQ = useClientPlans(clientId);
  const goalsQ = useClientGoals(clientId);
  const reportsQ = useClientReports(clientId);
  const bioQ = useClientBioAge(clientId);
  const progQ = useClientProgression(clientId);
  const dailyQ = useClientDailyStats(clientId);

  // Capture client's home location (only offered while clients.brb_location is null)
  const saveLocM = useSaveClientHomeLocation();
  const [capturingLoc, setCapturingLoc] = React.useState(false);
  const captureHomeLocation = async () => {
    if (!clientId) return;
    setCapturingLoc(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission needed', "Allow location access to capture the client's home location.");
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      await saveLocM.mutateAsync({ clientId, lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy ?? null });
      Alert.alert('Location saved', `${clientName}'s home location has been captured.`);
    } catch (e: any) {
      Alert.alert('Could not capture', e?.message ?? 'Turn on GPS and try again.');
    } finally {
      setCapturingLoc(false);
    }
  };
  const confirmCaptureLocation = () =>
    Alert.alert(
      "Capture client's home location?",
      `Do you want to capture the location of ${clientName}'s home? Your current position will be saved — make sure you are at the client's home right now.`,
      [{ text: 'Cancel', style: 'cancel' }, { text: 'OK, Capture', onPress: captureHomeLocation }]
    );
  const client = detailQ.data?.client;
  const clientName = client ? `${client.first_name ?? ''} ${client.last_name ?? ''}`.replace(/\s+/g, ' ').trim() : (selectedClientName ?? 'Client');
  const clientAge = React.useMemo(() => {
    if (!client?.date_of_birth) return null;
    const dob = new Date(client.date_of_birth);
    const now = new Date();
    let a = now.getFullYear() - dob.getFullYear();
    if (now.getMonth() < dob.getMonth() || (now.getMonth() === dob.getMonth() && now.getDate() < dob.getDate())) a--;
    return a;
  }, [client?.date_of_birth]);
  const bi = detailQ.data?.basicInfo ?? null;
  const infoFields: { label: string; value: string; icon: any; tone?: string }[] = [
    { label: 'AGE', value: clientAge != null ? `${clientAge} yrs` : (bi?.clientAge ? `${bi.clientAge}` : 'N/A'), icon: 'user', tone: clientAge == null && !bi?.clientAge ? 'na' : undefined },
    { label: 'GENDER', value: bi?.clientGender ?? (client?.client_type ?? 'N/A'), icon: 'user', tone: bi?.clientGender ? undefined : 'na' },
    { label: 'HEIGHT', value: bi?.clientHeight ? `${bi.clientHeight} cm` : 'N/A', icon: 'activity', tone: bi?.clientHeight ? undefined : 'na' },
    { label: 'WEIGHT', value: bi?.clientWeight ? `${bi.clientWeight} kg` : 'N/A', icon: 'activity', tone: bi?.clientWeight ? undefined : 'na' },
    { label: 'WAIST', value: bi?.clientWaist ? `${bi.clientWaist} cm` : 'N/A', icon: 'activity', tone: bi?.clientWaist ? undefined : 'na' },
    { label: 'VO2 MAX', value: detailQ.data?.vo2max != null ? (typeof detailQ.data.vo2max === 'number' ? `${detailQ.data.vo2max} ml/kg/min` : `${detailQ.data.vo2max}`) : 'N/A', icon: 'heart', tone: detailQ.data?.vo2max != null ? undefined : 'na' },
    { label: 'CRM', value: detailQ.data?.crm?.name ?? 'N/A', icon: 'userCircle', tone: detailQ.data?.crm ? undefined : 'na' },
    { label: 'CRM PHONE', value: detailQ.data?.crm?.phone ?? 'N/A', icon: 'phone', tone: detailQ.data?.crm?.phone ? undefined : 'na' },
  ];
  // Progression — biological age
  const bioRows: any[] = bioQ.data ?? [];
  const latestBio = bioRows[0];
  const bioAsc = [...bioRows].reverse();
  const axionPts = bioAsc.map((r) => r.metabolic_age).filter((n: any): n is number => n != null);
  const maqPts = bioAsc.map((r) => r.mechanical_age).filter((n: any): n is number => n != null);
  const fmtDelta = (age: number | null | undefined, chrono: number | null | undefined) => {
    if (age == null || chrono == null) return '—';
    const d = +(age - chrono).toFixed(1);
    return `${d >= 0 ? '+' : '−'}${Math.abs(d)} vs chrono`;
  };
  const bioUpdated = latestBio?.calculation_date ? istDayLabel(latestBio.calculation_date) : '—';

  // Weekly goals from DB
  const dbGoals = (goalsQ.data ?? []).map((g: any) => ({
    range: `${g.week_start_date ? istDayLabel(g.week_start_date) : ''}${g.week_end_date ? ' – ' + istDayLabel(g.week_end_date) : ''}`.trim() || 'Week',
    steps: g.steps_target != null ? `${g.steps_target}` : '—',
    sleep: g.sleep_target_hours != null ? `${g.sleep_target_hours}` : '—',
    nutrition: g.nutrition_target != null ? `${g.nutrition_target}` : '—',
    cardio: g.z2c_target != null ? `${g.z2c_target}` : '—',
    recovery: !!g.recommendation,
  }));

  // Plan-tab summary line (counts by status).
  const planList: any[] = plansQ.data ?? [];
  const planActive = planList.filter((p) => (p.status ?? 'approved') === 'approved' && !p.expired).length;
  const planPending = planList.filter((p) => p.status === 'pending_review').length;
  const planAttention = planList.filter((p) => p.status === 'rejected' || p.status === 'needs_revision').length;
  const planSummary = plansQ.isLoading
    ? 'Loading…'
    : planList.length === 0
    ? 'No plans yet'
    : [
        `${planList.length} plan${planList.length === 1 ? '' : 's'}`,
        planActive ? `${planActive} active` : null,
        planPending ? `${planPending} in review` : null,
        planAttention ? `${planAttention} need attention` : null,
      ].filter(Boolean).join(' · ');

  const [showInfo, setShowInfo] = React.useState(false);
  const [clientTab, setClientTab] = React.useState<'sessions' | 'plan' | 'goals' | 'reports' | 'progression' | 'trends' | 'weekly'>((clientInitialTab as any) || 'progression');
  // Analytics: which tab of which client is being viewed (fires on open + every switch).
  React.useEffect(() => { trackClientTab('client', clientTab, { id: selectedClientId, name: selectedClientName }); }, [clientTab]);
  const [cmpRange, setCmpRange] = React.useState('1W');
  const [reportsTab, setReportsTab] = React.useState<'qhp' | 'blood' | 'medical'>('qhp');
  const [bloodDetail, setBloodDetail] = React.useState<any | null>(null);
  const [qhpDetail, setQhpDetail] = React.useState<{ row: any; label: string } | null>(null);
  // Classify reports into the three buckets once, so sub-tabs can show counts
  // and we can auto-open the first tab that actually has reports. `raw` carries
  // the full row so tapping opens the right in-app detail sheet.
  type RItem = { key: string; name: string; date: string; type: string | null; metabolic: number | null; longevity: number | null; status?: string; kind: 'qhp' | 'health'; raw: any };
  const reportBuckets = React.useMemo(() => {
    const health = reportsQ.data?.health ?? [];
    const qhpReports = reportsQ.data?.qhp ?? []; // qhp_details rows (ascending → chrono index)
    const classify = (type: string): 'blood' | 'medical' => {
      const t = (type || '').toLowerCase();
      if (/mri|cect|dexa|ultrasound|imaging|x-?ray|\bct\b|ct |scan|angiograph|coronary|spine|neck|echo|medical/.test(t)) return 'medical';
      return 'blood';
    };
    const b: Record<'qhp' | 'blood' | 'medical', RItem[]> = { qhp: [], blood: [], medical: [] };
    (health as any[]).forEach((h) => {
      b[classify(h.report_type)].push({
        key: h.id, name: h.report_name || h.report_type || 'Health Report',
        date: h.test_date ? istDayLabel(h.test_date) : (h.upload_date ? istDayLabel(h.upload_date) : '—'),
        type: h.report_type ?? null, metabolic: h.metabolic_score ?? null, longevity: h.longevity_score ?? null,
        kind: 'health', raw: h,
      });
    });
    // Structured QHP reports — chrono label: index 0 = Baseline, else Refresh N. Newest first in the list.
    (qhpReports as any[]).forEach((a, i) => {
      b.qhp.push({
        key: `qhp-${a.id}`,
        name: i === 0 ? 'QHP Baseline' : `QHP Refresh ${i}`,
        date: a.created_at ? istDayLabel(a.created_at) : '—',
        type: 'QHP Assessment', metabolic: null, longevity: null,
        status: a.approved ? 'Approved' : 'Draft',
        kind: 'qhp', raw: a,
      });
    });
    b.qhp.reverse(); // newest QHP report on top
    return b;
  }, [reportsQ.data]);
  // On first load / new client, jump to the first sub-tab that has reports.
  const reportsAutoPicked = React.useRef(false);
  React.useEffect(() => { reportsAutoPicked.current = false; }, [clientId]);
  React.useEffect(() => {
    if (!reportsQ.data || reportsAutoPicked.current) return;
    reportsAutoPicked.current = true;
    if (reportBuckets[reportsTab].length === 0) {
      const first = (['blood', 'medical', 'qhp'] as const).find((k) => reportBuckets[k].length > 0);
      if (first) setReportsTab(first);
    }
  }, [reportsQ.data, reportBuckets]);
  const [bioRange, setBioRange] = React.useState('3M');
  const [ageSeries, setAgeSeries] = React.useState<'axion' | 'maq'>('axion');
  const [loadRange, setLoadRange] = React.useState('M');
  const [rmRange, setRmRange] = React.useState('M');
  // Age Scores trend, filtered by range chip. 3M = last ~92 days; All = everything.
  const bioFiltered = React.useMemo(() => {
    if (bioRange !== '3M') return bioAsc;
    const cutoff = Date.now() - 92 * 24 * 3600 * 1000;
    const within = bioAsc.filter((r) => r.calculation_date && new Date(r.calculation_date).getTime() >= cutoff);
    return within;
  }, [bioAsc, bioRange]);
  // Points + matching DATE labels (x-axis scale) per series.
  const axionRows = bioFiltered.filter((r) => r.metabolic_age != null);
  const maqRows = bioFiltered.filter((r) => r.mechanical_age != null);
  const axionPtsF: number[] = axionRows.map((r) => r.metabolic_age);
  const maqPtsF: number[] = maqRows.map((r) => r.mechanical_age);
  const ageLabelOf = (r: any) => r.calculation_date
    ? new Date(r.calculation_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
    : '';
  const axionLbls = sampleLabels(axionRows.map(ageLabelOf).filter(Boolean), 4);
  const maqLbls = sampleLabels(maqRows.map(ageLabelOf).filter(Boolean), 4);
  // Session Load + Max 1RM series, recomputed whenever the range chip changes.
  const progRows = progQ.data ?? [];
  const loadSeries = React.useMemo(() => buildProgSeries(progRows, loadRange, 'session_load', 'avg'), [progRows, loadRange]);
  const rmSeries = React.useMemo(() => buildProgSeries(progRows, rmRange, 'max_1rm', 'max'), [progRows, rmRange]);
  const rangeLabel = (r: string) => (r === 'W' ? 'Last 7 days' : r === 'M' ? 'Last 30 days' : 'Last 6 months');
  const [selWeek, setSelWeek] = React.useState(0);
  const [selDay, setSelDay] = React.useState(0);

  // 7-slot arrays (Mon..Sun); null = not logged / future day.
  type TW = {
    range: string; label: string; goals: string; done: boolean;
    dates: string[];
    workout: ('done' | 'missed' | null)[];
    steps: (number | null)[]; nutrition: (number | null)[]; sleep: (number | null)[];
  };
  const trendWeeks: TW[] = [
    {
      range: 'Jun 29 – 5', label: 'This Week', goals: '0/1', done: false,
      dates: ['Jun 29', 'Jun 30', 'Jul 1', 'Jul 2', 'Jul 3', 'Jul 4', 'Jul 5'],
      workout: ['missed', 'done', 'missed', null, null, null, null],
      steps: [5.0, 1.4, 0.2, null, null, null, null],
      nutrition: [7, 6, 1, null, null, null, null],
      sleep: [9.6, 7.9, 8.9, null, null, null, null],
    },
    {
      range: 'Jun 22 – 28', label: 'Last Week', goals: '1/1', done: true,
      dates: ['Jun 22', 'Jun 23', 'Jun 24', 'Jun 25', 'Jun 26', 'Jun 27', 'Jun 28'],
      workout: ['done', null, 'done', null, 'done', 'missed', null],
      steps: [8.2, 5.4, 6.9, 7.2, 7.9, 3.1, 6.6],
      nutrition: [8, 7, 7, 6, 8, 5, 7],
      sleep: [7.4, 8.1, 7.6, 7.9, 8.3, 6.9, 8.0],
    },
    {
      range: 'Jun 15 – 21', label: '2 wks ago', goals: '1/2', done: false,
      dates: ['Jun 15', 'Jun 16', 'Jun 17', 'Jun 18', 'Jun 19', 'Jun 20', 'Jun 21'],
      workout: ['done', 'missed', null, 'done', null, 'missed', null],
      steps: [7.1, 3.3, 4.8, 6.2, 5.1, 2.9, 4.4],
      nutrition: [6, 4, 5, 7, 6, 3, 5],
      sleep: [6.8, 7.2, 6.5, 7.8, 7.1, 6.2, 7.4],
    },
    {
      range: 'Jun 8 – 14', label: '3 wks ago', goals: '0/1', done: false,
      dates: ['Jun 8', 'Jun 9', 'Jun 10', 'Jun 11', 'Jun 12', 'Jun 13', 'Jun 14'],
      workout: ['missed', null, 'missed', null, null, 'missed', null],
      steps: [2.1, 3.4, 1.8, 2.9, 2.2, 1.5, 2.6],
      nutrition: [5, 4, 3, 5, 4, 3, 4],
      sleep: [6.5, 6.8, 6.1, 7.0, 6.4, 5.9, 6.7],
    },
  ];
  const [openClientSession, setOpenClientSession] = React.useState<number | null>(null);
  const [openClientAi, setOpenClientAi] = React.useState<number | null>(null);
  const [openPlan, setOpenPlan] = React.useState<string | null>(null);
  const [openExercise, setOpenExercise] = React.useState<string | null>(null);
  // Sessions tab pagination — 10 at a time, reset when switching clients.
  const [sessionsShown, setSessionsShown] = React.useState(10);
  // Reset per-client state when switching clients (the component stays mounted),
  // and always land on the requested tab — default Progression, never a stale tab.
  React.useEffect(() => {
    setClientTab((clientInitialTab as any) || 'progression');
    setSessionsShown(10);
    setOpenClientSession(null);
    setOpenClientAi(null);
    setOpenPlan(null);
  }, [clientId, clientInitialTab]);

  // Weekly goals
  const WEEKS = ['29 Jun – 5 Jul', '6 Jul – 12 Jul', '13 Jul – 19 Jul', '20 Jul – 26 Jul'];
  type WeekGoal = { range: string; steps: string; sleep: string; nutrition: string; cardio: string; recovery: boolean };
  const [goals, setGoals] = React.useState<WeekGoal[]>([]);
  const [goalFormOpen, setGoalFormOpen] = React.useState(false);
  const [gSteps, setGSteps] = React.useState('8000');
  const [gSleep, setGSleep] = React.useState('7.5');
  const [gNutrition, setGNutrition] = React.useState('7');
  const [gCardio, setGCardio] = React.useState('150');
  const [gRecovery, setGRecovery] = React.useState(true);
  const [gRepeat, setGRepeat] = React.useState(false);
  const saveGoals = () => {
    const existing = new Set(goals.map((g) => g.range));
    const targets = (gRepeat ? WEEKS : WEEKS.slice(0, 1)).filter((w) => !existing.has(w));
    const mk = (range: string): WeekGoal => ({ range, steps: gSteps, sleep: gSleep, nutrition: gNutrition, cardio: gCardio, recovery: gRecovery });
    setGoals((g) => [...g, ...targets.map(mk)]);
    setGoalFormOpen(false);
  };
  return (
    <Page gap={16} pt={6}>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Pressable onPress={() => go('clients')} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }}>
          <Icon name="arrowLeft" size={15} color={C.ink2} strokeWidth={2.2} />
          <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: C.ink }}>Back to Clients</Text>
        </Pressable>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: 14, backgroundColor: hexA(C.orange, 0.08), borderWidth: 1, borderColor: hexA(C.orange, 0.3) }}>
          <Icon name="layers" size={15} color={C.orange} strokeWidth={2} />
          <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: C.orange }}>Raise Ticket</Text>
        </View>
      </View>

      {false && (
      <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.09)" radius={18} style={{ padding: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 13 }}>
          <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: hexA(C.orange, 0.13), borderWidth: 1, borderColor: hexA(C.orange, 0.28), alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="alert" size={17} color={C.orange} strokeWidth={2} />
          </View>
          <Serif style={{ flex: 1, fontSize: 18 }}>Needs Attention</Serif>
          <View style={{ minWidth: 22, height: 22, paddingHorizontal: 7, borderRadius: 11, backgroundColor: hexA(C.orange, 0.16), borderWidth: 1, borderColor: hexA(C.orange, 0.3), alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontFamily: F.mono, fontSize: 11.5, color: C.orange }}>{clientBanners.length}</Text>
          </View>
        </View>
        <View style={{ gap: 10 }}>
          {clientBanners.map((b, bi) => {
            const sev = b.iconColor === C.red ? 'URGENT' : b.iconColor === C.gold ? 'DUE SOON' : 'ACTION NEEDED';
            return (
              <Pressable
                key={b.title}
                style={{
                  padding: 13, borderRadius: 14,
                  backgroundColor: hexA(b.iconColor, 0.09),
                  borderWidth: 1, borderColor: hexA(b.iconColor, 0.35),
                  borderLeftWidth: 4, borderLeftColor: b.iconColor,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
                  <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: hexA(b.iconColor, 0.2), borderWidth: 1, borderColor: hexA(b.iconColor, 0.45), alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name={b.icon} size={16} color={b.iconColor} strokeWidth={2.2} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Body style={{ fontSize: 14, fontFamily: F.bodyBold, color: '#fff' }}>{b.title}</Body>
                    <Body style={{ fontSize: 12, color: hexA(b.iconColor, 0.85), marginTop: 2 }}>{b.short}</Body>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 6 }}>
                    <View style={{ paddingVertical: 3, paddingHorizontal: 8, borderRadius: 6, backgroundColor: hexA(b.iconColor, 0.22) }}>
                      <Text style={{ fontFamily: F.mono, fontSize: 8.5, letterSpacing: 0.8, color: b.iconColor }}>{sev}</Text>
                    </View>
                    <Icon name="chevRight" size={12} color={hexA(b.iconColor, 0.7)} strokeWidth={2.4} />
                  </View>
                </View>
              </Pressable>
            );
          })}
        </View>
      </Card>
      )}

      <Card colors={['rgba(50,30,19,0.45)', 'rgba(18,14,14,0.5)']} radius={20} style={{ padding: 18, gap: 14 }}>
        {(() => {
          const isActive = (client?.status ?? '').toLowerCase() === 'active';
          const statusCol = isActive ? C.green : C.muted2;
          const memberSince = client?.created_at
            ? new Date(client.created_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', month: 'short', year: 'numeric' })
            : null;
          return (
            <>
              {/* Row 1 — avatar + FULL-WIDTH name (nothing competes with it) */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                {/* Avatar with gradient ring + status dot */}
                <View>
                  <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: 2.5, borderRadius: 34 }}>
                    <View style={{ padding: 2.5, borderRadius: 31, backgroundColor: C.bg }}>
                      <Avatar initial={initials(clientName)} size={54} colors={['#7C8FE8', '#9A7BEA']} fontSize={19} />
                    </View>
                  </LinearGradient>
                  <View style={{ position: 'absolute', right: 0, bottom: 0, width: 15, height: 15, borderRadius: 8, backgroundColor: statusCol, borderWidth: 2.5, borderColor: '#1A1210' }} />
                </View>
                <View style={{ flex: 1 }}>
                  <Serif numberOfLines={2} style={{ fontSize: 22, lineHeight: 27 }}>{clientName}</Serif>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 5 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 3, paddingHorizontal: 9, borderRadius: 999, backgroundColor: hexA(statusCol, 0.12), borderWidth: 1, borderColor: hexA(statusCol, 0.3) }}>
                      <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: statusCol }} />
                      <Text style={{ fontSize: 10.5, fontFamily: F.bodySemi, color: statusCol }}>{isActive ? 'Active' : (client?.status ?? 'Inactive')}</Text>
                    </View>
                  </View>
                </View>
              </View>

              {/* Row 2 — action strip: Services grows, capture-pin + info sit right */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{ flex: 1, flexDirection: 'row' }}>
                  <ServicesButton subscriptionType={detailQ.data?.serviceTier} />
                </View>
                {client && (client as any).brb_location == null ? (
                  <Pressable
                    onPress={capturingLoc ? undefined : confirmCaptureLocation}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: hexA(C.green, 0.13), borderWidth: 1, borderColor: hexA(C.green, 0.4) }}
                  >
                    {capturingLoc ? <ActivityIndicator size="small" color={C.green} /> : <Icon name="pin" size={14} color={C.green} strokeWidth={2.1} />}
                    <Text style={{ fontFamily: F.bodySemi, fontSize: 11.5, color: C.green }}>Pin Home</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  onPress={() => setShowInfo(true)}
                  style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: hexA(C.blue, 0.13), borderWidth: 1, borderColor: hexA(C.blue, 0.35), alignItems: 'center', justifyContent: 'center' }}
                >
                  <Icon path="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 8h.01M12 11.5V16" size={17} color={C.blue} strokeWidth={2} />
                </Pressable>
              </View>

              {memberSince || client?.location || detailQ.data?.crm ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {memberSince ? (
                    <View style={infoTag}>
                      <Icon name="calendar" size={13} color={C.muted2} strokeWidth={1.8} />
                      <Body style={{ fontSize: 12.5, color: C.ink3 }}>Since {memberSince}</Body>
                    </View>
                  ) : null}
                  {client?.location ? (
                    <View style={infoTag}>
                      <Icon name="map" size={13} color={C.muted2} strokeWidth={1.8} />
                      <Body style={{ fontSize: 12.5, color: C.ink3 }} numberOfLines={1}>{client.location}</Body>
                    </View>
                  ) : null}
                  {detailQ.data?.crm ? (
                    <View style={infoTag}>
                      <Icon name="userCircle" size={13} color={C.muted2} strokeWidth={1.8} />
                      <Body style={{ fontSize: 12.5, color: C.ink3 }} numberOfLines={1}>
                        CRM · {detailQ.data.crm.name}{detailQ.data.crm.phone ? ` · ${detailQ.data.crm.phone}` : ''}
                      </Body>
                    </View>
                  ) : null}
                </View>
              ) : null}
            </>
          );
        })()}
      </Card>

      {/* Session handoff popup — auto-opens once per trainer+client per IST day */}
      <SessionHandoffPopup clientId={clientId} />

      {/* Client info popup */}
      <Modal visible={showInfo} transparent animationType="fade" onRequestClose={() => setShowInfo(false)}>
        <Pressable onPress={() => setShowInfo(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center', padding: 22 }}>
          <Pressable onPress={() => {}} style={{ width: '100%', maxWidth: 360, backgroundColor: '#12100E', borderWidth: 1, borderColor: 'rgba(255,150,90,0.16)', borderRadius: 22, padding: 20 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: hexA(C.gold, 0.13), borderWidth: 1, borderColor: hexA(C.gold, 0.3), alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="user" size={17} color={C.gold} strokeWidth={1.9} />
              </View>
              <View style={{ flex: 1 }}>
                <Serif style={{ fontSize: 19 }}>{clientName}</Serif>
                <Body style={{ fontSize: 11.5, color: C.muted2 }}>Client details</Body>
              </View>
              <Pressable onPress={() => setShowInfo(false)} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="close" size={14} color="#B8B2AC" strokeWidth={2.3} />
              </Pressable>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 14 }}>
              {infoFields.map((ci) => (
                <View key={ci.label} style={{ width: '50%', marginBottom: 14 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 4 }}>
                    <Icon name={ci.icon} size={13} color={C.faint} strokeWidth={1.8} />
                    <Mono style={{ fontSize: 9.5, letterSpacing: 0.8, color: C.faint }}>{ci.label}</Mono>
                  </View>
                  <Text style={{ fontFamily: F.bodySemi, fontSize: 14.5, color: ci.tone === 'red' ? C.red : ci.tone === 'na' ? C.muted2 : C.ink }}>{ci.value}</Text>
                </View>
              ))}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Tabs: Sessions | Plan | Goals | Reports | Progression | Trends */}
      <HScroll>
        {([['progression', 'Progression'], ['sessions', 'Sessions'], ['plan', 'Plan'], ['goals', 'Goals'], ['reports', 'Reports'], ['trends', 'Trends'], ['weekly', 'Weekly Summary']] as const).map(([id, label]) => {
          const active = clientTab === id;
          return active ? (
            <LinearGradient key={id} colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ alignItems: 'center', paddingVertical: 11, paddingHorizontal: 18, borderRadius: 13 }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: '#fff' }}>{label}</Text>
            </LinearGradient>
          ) : (
            <Pressable key={id} onPress={() => setClientTab(id)} style={{ alignItems: 'center', paddingVertical: 11, paddingHorizontal: 18, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: C.muted }}>{label}</Text>
            </Pressable>
          );
        })}
      </HScroll>

      {clientTab === 'weekly' ? (
        <AiWeeklyReportTab clientId={clientId} />
      ) : clientTab === 'trends' ? (
        <>
          {/* Week selector */}
          <HScroll>
            {trendWeeks.map((w, wi) => {
              const active = selWeek === wi;
              return active ? (
                <LinearGradient key={w.range} colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ paddingVertical: 9, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: '#fff' }}>{w.range}</Text>
                  <Text style={{ fontFamily: F.body, fontSize: 9.5, color: 'rgba(255,255,255,0.8)', marginTop: 1 }}>{w.label}</Text>
                </LinearGradient>
              ) : (
                <Pressable key={w.range} onPress={() => { setSelWeek(wi); setSelDay(0); }} style={{ paddingVertical: 9, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }}>
                  <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: C.muted }}>{w.range}</Text>
                  <Text style={{ fontFamily: F.body, fontSize: 9.5, color: C.muted3, marginTop: 1 }}>{w.label}</Text>
                </Pressable>
              );
            })}
          </HScroll>

          {(() => {
            const w = trendWeeks[selWeek];
            const gc = w.done ? C.green : C.gold;
            const doneN = w.workout.filter((x) => x === 'done').length;
            const planned = w.workout.filter((x) => x !== null).length;
            const avg = (arr: (number | null)[]) => {
              const v = arr.filter((x): x is number => x !== null);
              return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
            };
            const cellW = { width: 30, alignItems: 'center' as const };
            const barCell = (val: number | null, maxV: number, col: string) => (
              <View style={[cellW, { height: 34, justifyContent: 'flex-end' }]}>
                {val === null ? (
                  <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.12)', marginBottom: 2 }} />
                ) : (
                  <View style={{ width: 9, height: Math.max(4, (val / maxV) * 32), borderRadius: 5, backgroundColor: col, opacity: 0.4 + 0.6 * (val / maxV) }} />
                )}
              </View>
            );
            return (
              <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.09)" style={{ padding: 16, gap: 15 }}>
                {/* header */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Serif style={{ fontSize: 21 }}>{w.range}</Serif>
                    <Body style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{w.label} · {doneN}/{planned} workouts done</Body>
                  </View>
                  <View style={{ alignItems: 'center', gap: 3 }}>
                    <View style={{ width: 54, height: 54, borderRadius: 27, borderWidth: 4, borderColor: hexA(gc, 0.9), alignItems: 'center', justifyContent: 'center', backgroundColor: hexA(gc, 0.08) }}>
                      <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: gc }}>{w.goals}</Text>
                    </View>
                    <Mono style={{ fontSize: 8, color: C.muted3 }}>GOALS</Mono>
                  </View>
                </View>

                {/* 7-day matrix */}
                <View style={{ padding: 13, borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', gap: 11 }}>
                  {/* day letters + workout status squares */}
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={{ width: 74 }}>
                      <Mono style={{ fontSize: 9, letterSpacing: 0.8, color: C.mono2 }}>WORKOUT</Mono>
                    </View>
                    <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'space-between' }}>
                      {w.workout.map((st, i) => {
                        const col = st === 'done' ? C.green : st === 'missed' ? C.red : null;
                        const sel = selDay === i;
                        return (
                          <Pressable key={i} onPress={() => setSelDay(i)} style={cellW}>
                            <View style={{ width: 24, height: 24, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: col ? hexA(col, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: sel ? 2 : 1, borderColor: sel ? C.orange : col ? hexA(col, 0.45) : 'rgba(255,255,255,0.08)' }}>
                              {col ? (
                                <Icon path={st === 'done' ? 'M20 6 9 17l-5-5' : 'M6 6l12 12M18 6 6 18'} size={11} color={col} strokeWidth={2.8} />
                              ) : null}
                            </View>
                            <Mono style={{ fontSize: 8.5, color: sel ? C.orange : C.muted3, marginTop: 4 }}>{['M', 'T', 'W', 'T', 'F', 'S', 'S'][i]}</Mono>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>

                  {/* metric bar rows */}
                  {([
                    ['STEPS', w.steps, C.blue, `${avg(w.steps).toFixed(1)}k avg`, 10],
                    ['NUTRITION', w.nutrition, C.gold, `${avg(w.nutrition).toFixed(0)}/10 avg`, 10],
                    ['SLEEP', w.sleep, C.purple, `${avg(w.sleep).toFixed(1)}h avg`, 10],
                  ] as const).map(([lab, arr, col, avgLabel, maxV]) => (
                    <View key={lab} style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
                      <View style={{ width: 74 }}>
                        <Mono style={{ fontSize: 9, letterSpacing: 0.8, color: C.mono2 }}>{lab}</Mono>
                        <Text style={{ fontFamily: F.bodyBold, fontSize: 11.5, color: col, marginTop: 2 }}>{avgLabel}</Text>
                      </View>
                      <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'space-between' }}>
                        {arr.map((v, i) => (
                          <React.Fragment key={i}>{barCell(v, maxV, col)}</React.Fragment>
                        ))}
                      </View>
                    </View>
                  ))}
                </View>

                {/* Daily summary — selected day */}
                {(() => {
                  const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
                  const st = w.workout[selDay];
                  const wc = st === 'done' ? C.green : st === 'missed' ? C.red : C.muted2;
                  const stepsV = w.steps[selDay];
                  const nutV = w.nutrition[selDay];
                  const sleepV = w.sleep[selDay];
                  const metric = (label: string, val: number | null, goal: number, unit: string, col: string) => (
                    <View key={label} style={{ gap: 6 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                        <Mono style={{ flex: 1, fontSize: 9, letterSpacing: 0.8, color: C.muted3 }}>{label}</Mono>
                        <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: val === null ? C.muted3 : col }}>
                          {val === null ? '—' : `${val}${unit}`}
                        </Text>
                        <Body style={{ fontSize: 10, color: C.muted3, marginLeft: 4 }}>/ {goal}{unit}</Body>
                      </View>
                      <ProgressBar pct={val === null ? 0 : Math.min(100, (val / goal) * 100)} height={5} fill={col} />
                    </View>
                  );
                  return (
                    <View style={{ padding: 14, borderRadius: 15, backgroundColor: hexA(wc === C.muted2 ? '#888888' : wc, 0.06), borderWidth: 1, borderColor: hexA(wc === C.muted2 ? '#888888' : wc, 0.22), gap: 12 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: hexA(wc === C.muted2 ? '#888888' : wc, 0.15), borderWidth: 1.5, borderColor: hexA(wc === C.muted2 ? '#888888' : wc, 0.45), alignItems: 'center', justifyContent: 'center' }}>
                          {st ? (
                            <Icon path={st === 'done' ? 'M20 6 9 17l-5-5' : 'M6 6l12 12M18 6 6 18'} size={16} color={wc} strokeWidth={2.6} />
                          ) : (
                            <Icon name="calendar" size={15} color={C.muted2} strokeWidth={2} />
                          )}
                        </View>
                        <View style={{ flex: 1 }}>
                          <Serif style={{ fontSize: 17 }}>{dayNames[selDay]}</Serif>
                          <Mono style={{ fontSize: 9.5, color: C.muted3, marginTop: 1 }}>{w.dates[selDay]}</Mono>
                        </View>
                        <Badge
                          text={st === 'done' ? 'Workout done' : st === 'missed' ? 'Workout missed' : 'No workout'}
                          color={wc === C.muted2 ? '#999189' : wc}
                        />
                      </View>
                      {metric('STEPS', stepsV, 8, 'k', C.blue)}
                      {metric('NUTRITION', nutV, 10, '', C.gold)}
                      {metric('SLEEP', sleepV, 8, 'h', C.purple)}
                    </View>
                  );
                })()}

                {/* legend */}
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    <View style={{ width: 9, height: 9, borderRadius: 3, backgroundColor: hexA(C.green, 0.7) }} />
                    <Mono style={{ fontSize: 9, color: C.muted2 }}>Done</Mono>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    <View style={{ width: 9, height: 9, borderRadius: 3, backgroundColor: hexA(C.red, 0.7) }} />
                    <Mono style={{ fontSize: 9, color: C.muted2 }}>Missed</Mono>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    <View style={{ width: 9, height: 9, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.12)' }} />
                    <Mono style={{ fontSize: 9, color: C.muted2 }}>No data</Mono>
                  </View>
                </View>
              </Card>
            );
          })()}
        </>
      ) : clientTab === 'progression' ? (
        <>
          {/* Age Scores — twin gauges + toggleable trend */}
          <Card colors={['rgba(64,38,22,0.5)', 'rgba(18,14,14,0.55)']} border="rgba(255,150,90,0.14)" style={{ padding: 18, gap: 16 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Icon name="activity" size={20} color={C.orange} strokeWidth={1.9} />
              <Serif style={{ flex: 1, fontSize: 19 }}>Age Scores</Serif>
              <Mono style={{ fontSize: 10, color: C.muted3 }}>Updated {bioUpdated}</Mono>
            </View>

            {bioRows.length === 0 ? (
              <Body style={{ color: C.muted2, textAlign: 'center', paddingVertical: 16 }}>No biological age data yet.</Body>
            ) : (
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <AgeGauge
                value={latestBio?.metabolic_age != null ? `${latestBio.metabolic_age}` : '—'}
                label="Axion · Metabolic"
                delta={fmtDelta(latestBio?.metabolic_age, latestBio?.chronological_age)}
                deltaColor={(latestBio?.metabolic_age ?? 0) > (latestBio?.chronological_age ?? 0) ? C.gold : C.green}
                color={C.blue}
              />
              <View style={{ width: 1, backgroundColor: 'rgba(255,255,255,0.06)' }} />
              <AgeGauge
                value={latestBio?.mechanical_age != null ? `${latestBio.mechanical_age}` : '—'}
                label="MAQ · Mechanical"
                delta={fmtDelta(latestBio?.mechanical_age, latestBio?.chronological_age)}
                deltaColor={(latestBio?.mechanical_age ?? 0) > (latestBio?.chronological_age ?? 0) ? C.gold : C.green}
                color={C.red}
              />
            </View>
            )}

            {/* series toggle + range */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ flex: 1, flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 999, padding: 3 }}>
                {([['axion', 'Axion', C.blue], ['maq', 'MAQ', C.red]] as const).map(([id, label, col]) => {
                  const active = ageSeries === id;
                  return (
                    <Pressable key={id} onPress={() => setAgeSeries(id)} style={{ flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: 999, backgroundColor: active ? hexA(col, 0.18) : 'transparent', borderWidth: 1, borderColor: active ? hexA(col, 0.45) : 'transparent' }}>
                      <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 12, color: active ? col : C.muted }}>{label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <RangeChips options={['3M', 'All']} value={bioRange} onChange={setBioRange} accent={ageSeries === 'axion' ? C.blue : C.red} />
            </View>

            {ageSeries === 'axion' ? (
              axionPtsF.length >= 2 ? <AreaLine id="axion" points={axionPtsF} color={C.blue} labels={axionLbls} /> : <Body style={{ color: C.muted3, textAlign: 'center', paddingVertical: 10 }}>{bioRange === '3M' && axionPts.length >= 2 ? 'No entries in the last 3 months.' : 'Not enough data for a trend.'}</Body>
            ) : (
              maqPtsF.length >= 2 ? <AreaLine id="maq" points={maqPtsF} color={C.red} labels={maqLbls} /> : <Body style={{ color: C.muted3, textAlign: 'center', paddingVertical: 10 }}>{bioRange === '3M' && maqPts.length >= 2 ? 'No entries in the last 3 months.' : 'Not enough data for a trend.'}</Body>
            )}
          </Card>

          {/* Daily habits — sleep / steps / nutrition (last 5 days) + latest VO₂ max */}
          <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.09)" style={{ padding: 16, gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: hexA(C.purple, 0.13), borderWidth: 1, borderColor: hexA(C.purple, 0.28), alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="clock" size={17} color={C.purple} strokeWidth={1.9} />
              </View>
              <View style={{ flex: 1 }}>
                <Serif style={{ fontSize: 18 }}>Daily Habits</Serif>
                <Body style={{ fontSize: 11, color: C.muted3 }}>Sleep · Steps · Nutrition — last 5 days</Body>
              </View>
              {detailQ.data?.vo2max != null ? (
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 17, color: C.red }}>
                    {typeof detailQ.data.vo2max === 'number' ? detailQ.data.vo2max : String(detailQ.data.vo2max).replace(/\s*ml\/kg\/min\s*/i, '')}
                  </Text>
                  <Mono style={{ fontSize: 7.5, letterSpacing: 0.6, color: C.muted3 }}>VO₂ MAX</Mono>
                </View>
              ) : null}
            </View>
            {dailyQ.isLoading ? (
              <View style={{ alignItems: 'center', paddingVertical: 16 }}><ActivityIndicator color={C.purple} /></View>
            ) : (
              <View style={{ borderRadius: 13, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
                <View style={{ flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.04)', paddingVertical: 8, paddingHorizontal: 12 }}>
                  <Mono style={{ flex: 1.3, fontSize: 8.5, letterSpacing: 0.6, color: C.muted3 }}>DAY</Mono>
                  <Mono style={{ flex: 1, fontSize: 8.5, letterSpacing: 0.6, color: C.muted3, textAlign: 'center' }}>SLEEP</Mono>
                  <Mono style={{ flex: 1, fontSize: 8.5, letterSpacing: 0.6, color: C.muted3, textAlign: 'center' }}>STEPS</Mono>
                  <Mono style={{ flex: 1, fontSize: 8.5, letterSpacing: 0.6, color: C.muted3, textAlign: 'right' }}>NUTRITION</Mono>
                </View>
                {(dailyQ.data ?? []).map((r, i) => (
                  <View key={r.ymd} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: 'rgba(255,255,255,0.05)', backgroundColor: i === 0 ? hexA(C.purple, 0.05) : 'transparent' }}>
                    <Body style={{ flex: 1.3, fontSize: 12.5, color: i === 0 ? '#fff' : C.ink3, fontFamily: i === 0 ? F.bodySemi : undefined }}>{r.label}</Body>
                    <Text style={{ flex: 1, textAlign: 'center', fontFamily: F.bodySemi, fontSize: 12.5, color: r.sleep != null ? C.blue : C.muted3 }}>{r.sleep != null ? `${r.sleep}h` : '—'}</Text>
                    <Text style={{ flex: 1, textAlign: 'center', fontFamily: F.bodySemi, fontSize: 12.5, color: r.steps != null ? C.green : C.muted3 }}>{r.steps != null ? r.steps.toLocaleString('en-IN') : '—'}</Text>
                    <Text style={{ flex: 1, textAlign: 'right', fontFamily: F.bodySemi, fontSize: 12.5, color: r.nutrition != null ? C.orange : C.muted3 }}>{r.nutrition != null ? `${r.nutrition}/10` : '—'}</Text>
                  </View>
                ))}
              </View>
            )}
          </Card>

          {/* Session Load */}
          <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.09)" style={{ padding: 16, gap: 13 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: hexA(C.orange, 0.13), borderWidth: 1, borderColor: hexA(C.orange, 0.28), alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="bars" size={17} color={C.orange} strokeWidth={1.9} />
              </View>
              <View style={{ flex: 1 }}>
                <Serif style={{ fontSize: 18 }}>Session Load</Serif>
                <Mono style={{ fontSize: 9.5, color: C.muted3 }}>{rangeLabel(loadRange)} · {loadSeries.count} session{loadSeries.count === 1 ? '' : 's'}</Mono>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4 }}>
                  <Serif style={{ fontSize: 26, color: C.orange }}>{loadSeries.headline.toLocaleString()}</Serif>
                  <Body style={{ fontSize: 11.5, color: C.muted2, marginBottom: 4 }}>kg avg</Body>
                </View>
              </View>
            </View>
            <RangeChips options={['W', 'M', '6M']} value={loadRange} onChange={setLoadRange} />
            {progQ.isLoading ? (
              <Body style={{ color: C.muted3, textAlign: 'center', paddingVertical: 18, fontSize: 12.5 }}>Loading…</Body>
            ) : (
              <ProgChart range={loadRange} id="load" data={loadSeries.data} labels={loadSeries.labels} color={C.orange} avg={loadSeries.headline || undefined} />
            )}
          </Card>

          {/* Max 1RM Progress */}
          <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.09)" style={{ padding: 16, gap: 13 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: hexA(C.green, 0.13), borderWidth: 1, borderColor: hexA(C.green, 0.28), alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="trend" size={17} color={C.green} strokeWidth={1.9} />
              </View>
              <View style={{ flex: 1 }}>
                <Serif style={{ fontSize: 18 }}>Max 1RM Progress</Serif>
                <Mono style={{ fontSize: 9.5, color: C.muted3 }}>{rangeLabel(rmRange)} · {rmSeries.count} session{rmSeries.count === 1 ? '' : 's'}</Mono>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4 }}>
                  <Serif style={{ fontSize: 26, color: C.green }}>{rmSeries.headline}</Serif>
                  <Body style={{ fontSize: 11.5, color: C.muted2, marginBottom: 4 }}>kg max</Body>
                </View>
              </View>
            </View>
            <RangeChips options={['W', 'M', '6M']} value={rmRange} onChange={setRmRange} accent={C.green} />
            {progQ.isLoading ? (
              <Body style={{ color: C.muted3, textAlign: 'center', paddingVertical: 18, fontSize: 12.5 }}>Loading…</Body>
            ) : (
              <ProgChart range={rmRange} id="rm" data={rmSeries.data} labels={rmSeries.labels} color={C.green} />
            )}
          </Card>
        </>
      ) : clientTab === 'reports' ? (
        <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.09)" style={{ padding: 16, gap: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Icon name="file" size={20} color={C.blue} strokeWidth={1.9} />
            <Serif style={{ fontSize: 19 }}>Reports</Serif>
          </View>
          {/* Sub-tabs with live counts */}
          <View style={{ flexDirection: 'row', gap: 7 }}>
            {([['qhp', 'QHP', C.gold], ['blood', 'Blood', C.blue], ['medical', 'Medical', C.purple]] as const).map(([id, label, col]) => {
              const active = reportsTab === id;
              const n = reportBuckets[id].length;
              return (
                <Pressable
                  key={id}
                  onPress={() => setReportsTab(id)}
                  style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9, borderRadius: 999, backgroundColor: active ? hexA(col, 0.14) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(col, 0.4) : 'rgba(255,255,255,0.07)' }}
                >
                  <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 12.5, color: active ? col : C.muted }}>{label}</Text>
                  {n > 0 ? (
                    <View style={{ minWidth: 17, height: 17, paddingHorizontal: 5, borderRadius: 9, backgroundColor: active ? hexA(col, 0.22) : 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ fontFamily: F.mono, fontSize: 9.5, color: active ? col : C.muted2 }}>{n}</Text>
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
          {reportsQ.isLoading ? (
            <View style={{ alignItems: 'center', gap: 8, paddingVertical: 26 }}>
              <ActivityIndicator color={C.blue} />
              <Body style={{ color: C.muted3, fontSize: 12.5 }}>Loading reports…</Body>
            </View>
          ) : reportsQ.isError ? (
            <Body style={{ color: C.red, textAlign: 'center', paddingVertical: 20 }}>Couldn't load reports.</Body>
          ) : null}
          {!reportsQ.isLoading && !reportsQ.isError ? (() => {
            const accent = reportsTab === 'qhp' ? C.gold : reportsTab === 'blood' ? C.blue : C.purple;
            const icon = reportsTab === 'qhp' ? ('heart' as const) : reportsTab === 'blood' ? ('activity' as const) : ('clipboard' as const);
            const items = reportBuckets[reportsTab];

            if (items.length === 0) {
              return (
                <View style={{ alignItems: 'center', gap: 10, paddingVertical: 30, borderRadius: 16, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.09)' }}>
                  <View style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: hexA(accent, 0.1), alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name={icon} size={19} color={accent} strokeWidth={1.8} />
                  </View>
                  <Body style={{ color: C.muted3, fontSize: 12.5 }}>No {reportsTab === 'qhp' ? 'QHP' : reportsTab === 'blood' ? 'blood' : 'medical'} reports yet.</Body>
                </View>
              );
            }

            return items.map((r) => (
                <Pressable
                  key={r.key}
                  onPress={() => { if (r.kind === 'qhp') setQhpDetail({ row: r.raw, label: r.name }); else setBloodDetail(r.raw); }}
                  style={{ borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: hexA(accent, 0.22), overflow: 'hidden' }}
                >
                  <View style={{ height: 3, backgroundColor: hexA(accent, 0.5) }} />
                  <View style={{ padding: 13, gap: 10 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                      <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: hexA(accent, 0.13), borderWidth: 1, borderColor: hexA(accent, 0.28), alignItems: 'center', justifyContent: 'center' }}>
                        <Icon name={icon} size={19} color={accent} strokeWidth={1.9} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Body numberOfLines={2} style={{ fontSize: 14, fontFamily: F.bodySemi, color: '#fff', lineHeight: 18 }}>{r.name}</Body>
                        <Mono style={{ fontSize: 10, color: C.muted3, marginTop: 3 }}>{r.date}</Mono>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999, backgroundColor: hexA(accent, 0.13), borderWidth: 1, borderColor: hexA(accent, 0.35) }}>
                        <Text style={{ fontFamily: F.bodyBold, fontSize: 10.5, color: accent }}>VIEW</Text>
                        <Icon name="chevRight" size={13} color={accent} strokeWidth={2.4} />
                      </View>
                    </View>
                    {(r.type || r.status || r.metabolic != null || r.longevity != null) ? (
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                        {r.status ? <Badge text={r.status} color={r.status === 'Approved' ? C.green : C.gold} /> : null}
                        {r.type && !r.status ? (
                          <View style={{ paddingVertical: 3, paddingHorizontal: 9, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
                            <Text numberOfLines={1} style={{ fontFamily: F.bodySemi, fontSize: 10, color: C.ink3, maxWidth: 200 }}>{r.type}</Text>
                          </View>
                        ) : null}
                        {r.metabolic != null ? <Badge text={`Metabolic ${r.metabolic}`} color={C.green} /> : null}
                        {r.longevity != null ? <Badge text={`Longevity ${r.longevity}`} color={C.orange} /> : null}
                      </View>
                    ) : null}
                  </View>
                </Pressable>
            ));
          })() : null}
        </Card>
      ) : clientTab === 'goals' ? (
        <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.09)" style={{ padding: 16, gap: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Icon name="target" size={20} color={C.green} strokeWidth={1.9} />
            <Serif style={{ flex: 1, fontSize: 19 }}>Weekly Goals</Serif>
            {!goalFormOpen ? (
              <Pressable onPress={() => setGoalFormOpen(true)}>
                <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 13, borderRadius: 11 }}>
                  <Icon name="plus" size={13} color="#fff" strokeWidth={2.6} />
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: '#fff' }}>New Week</Text>
                </LinearGradient>
              </Pressable>
            ) : null}
          </View>

          {goalFormOpen ? (
            <View style={{ padding: 14, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.28)', borderWidth: 1, borderColor: hexA(C.orange, 0.22), gap: 13 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Icon name="calendar" size={15} color={C.orange} strokeWidth={2} />
                <Body style={{ flex: 1, fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }}>Week of {WEEKS[0]}</Body>
                <Pressable onPress={() => setGoalFormOpen(false)}>
                  <Icon name="close" size={15} color={C.muted} strokeWidth={2.2} />
                </Pressable>
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                {([
                  ['STEPS / DAY', gSteps, setGSteps, 'e.g. 8000'],
                  ['SLEEP (HRS)', gSleep, setGSleep, 'e.g. 7.5'],
                  ['NUTRITION (0–10)', gNutrition, setGNutrition, '0–10'],
                  ['ZONE 2 CARDIO (MIN/WK)', gCardio, setGCardio, 'e.g. 150'],
                ] as const).map(([lab, val, setter, ph]) => (
                  <View key={lab} style={{ width: '47%', flexGrow: 1 }}>
                    <Mono style={{ fontSize: 9, letterSpacing: 0.8, color: C.mono2, marginBottom: 6 }}>{lab}</Mono>
                    <TextInput
                      value={val}
                      onChangeText={setter}
                      placeholder={ph}
                      placeholderTextColor={C.muted3}
                      keyboardType="numeric"
                      style={{ paddingVertical: 11, paddingHorizontal: 13, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.03)', color: '#fff', fontFamily: F.mono, fontSize: 14 }}
                    />
                  </View>
                ))}
              </View>
              <View>
                <Mono style={{ fontSize: 9, letterSpacing: 0.8, color: C.mono2, marginBottom: 7 }}>RECOVERY RECOMMENDED</Mono>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {([['Yes', true], ['No', false]] as const).map(([lab, v]) => (
                    <Pressable key={lab} onPress={() => setGRecovery(v)} style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 11, backgroundColor: gRecovery === v ? hexA(C.green, 0.14) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: gRecovery === v ? hexA(C.green, 0.35) : 'rgba(255,255,255,0.07)' }}>
                      <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: gRecovery === v ? C.green : C.muted }}>{lab}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              {/* Apply to the next 3 weeks */}
              <Pressable onPress={() => setGRepeat(!gRepeat)} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: 12, borderRadius: 12, backgroundColor: gRepeat ? hexA(C.blue, 0.1) : 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: gRepeat ? hexA(C.blue, 0.35) : 'rgba(255,255,255,0.07)' }}>
                <View style={{ width: 21, height: 21, borderRadius: 6, alignItems: 'center', justifyContent: 'center', borderWidth: gRepeat ? 0 : 2, borderColor: 'rgba(255,255,255,0.2)', backgroundColor: gRepeat ? C.blue : 'transparent' }}>
                  {gRepeat ? <Icon path="M20 6 9 17l-5-5" size={12} color="#0c0808" strokeWidth={3.2} /> : null}
                </View>
                <View style={{ flex: 1 }}>
                  <Body style={{ fontSize: 13, fontFamily: F.bodySemi, color: gRepeat ? '#A9BCFF' : C.ink }}>Apply to the next 3 weeks</Body>
                  <Body style={{ fontSize: 11, color: C.muted2, marginTop: 1 }}>{WEEKS.slice(1).join(' · ')}</Body>
                </View>
              </Pressable>
              <GradientButton label={gRepeat ? 'Set Goals for 4 Weeks' : 'Set Goals for This Week'} icon="checks" onPress={saveGoals} />
            </View>
          ) : null}

          {dbGoals.length === 0 && goals.length === 0 && !goalFormOpen ? (
            <View style={{ alignItems: 'center', gap: 10, paddingVertical: 14 }}>
              <Icon name="target" size={30} color="#4C4640" strokeWidth={1.6} />
              <Body style={{ fontSize: 13.5, color: C.muted3 }}>No weekly goals set yet — tap “New Week”.</Body>
            </View>
          ) : null}

          {[...dbGoals, ...goals].map((g) => (
            <View key={g.range} style={{ padding: 13, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: hexA(C.green, 0.18) }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 11 }}>
                <Icon name="calendar" size={14} color={C.green} strokeWidth={2} />
                <Body style={{ flex: 1, fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{g.range}</Body>
                {g.recovery ? <Badge text="Recovery" color={C.purple} /> : null}
                <Badge text="Set" color={C.green} />
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {([
                  ['STEPS', `${g.steps}/day`, C.orange],
                  ['SLEEP', `${g.sleep} hrs`, C.blue],
                  ['NUTRITION', `${g.nutrition}/10`, C.gold],
                  ['ZONE 2', `${g.cardio} min`, C.green],
                ] as const).map(([lab, val, col]) => (
                  <View key={lab} style={{ width: '47%', flexGrow: 1, paddingVertical: 8, paddingHorizontal: 11, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' }}>
                    <Mono style={{ fontSize: 8.5, color: C.muted3 }}>{lab}</Mono>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: col, marginTop: 2 }}>{val}</Text>
                  </View>
                ))}
              </View>
            </View>
          ))}
        </Card>
      ) : clientTab === 'sessions' ? (
        <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.09)" style={{ padding: 16, gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Icon name="bars" size={20} color={C.orange} strokeWidth={1.9} />
            <Serif style={{ fontSize: 19 }}>All Sessions ({sessionsQ.data?.length ?? 0})</Serif>
          </View>
          {sessionsQ.isLoading ? (
            <Body style={{ color: C.muted2, textAlign: 'center', paddingVertical: 20 }}>Loading sessions…</Body>
          ) : sessionsQ.isError ? (
            <Body style={{ color: C.red, textAlign: 'center', paddingVertical: 20 }}>Couldn't load sessions.</Body>
          ) : (sessionsQ.data?.length ?? 0) === 0 ? (
            <Body style={{ color: C.muted2, textAlign: 'center', paddingVertical: 20 }}>No sessions yet.</Body>
          ) : (
            <>
            {(sessionsQ.data ?? []).slice(0, sessionsShown).map((s: any, i: number) => {
              const tp = istTimeParts(s.scheduled_at);
              const st = (s.status || '').toLowerCase();
              const statusColor = st === 'completed' ? C.green : (st === 'scheduled' || st === 'upcoming') ? C.gold : C.muted2;
              const catColor = s.category === 'rehab' ? C.purple : C.blue;
              const viewOpen = openClientSession === i;
              const aiOpen = openClientAi === i;
              return (
                <View key={s.id ?? i} style={{ borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: viewOpen || aiOpen ? hexA(C.orange, 0.28) : 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
                  <View style={{ padding: 14, gap: 10 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 9 }}>
                      <View style={{ flex: 1 }}>
                        <Body numberOfLines={1} style={{ fontSize: 15, fontFamily: F.bodySemi, color: '#fff' }}>{s.session_name}</Body>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                          <Badge text={s.type_label} color={catColor} />
                          <Badge text={s.status.charAt(0).toUpperCase() + s.status.slice(1)} color={statusColor} />
                        </View>
                        <Mono style={{ fontSize: 10.5, color: C.muted3, marginTop: 7 }}>{istDayLabel(s.scheduled_at)} · {tp.time} {tp.ampm}</Mono>
                        {s.trainer_name && s.trainer_name !== 'N/A' ? (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 5 }}>
                            <Icon name="user" size={11} color={C.muted3} strokeWidth={2} />
                            <Body style={{ fontSize: 11.5, color: C.muted2 }}>{s.trainer_name}</Body>
                          </View>
                        ) : null}
                      </View>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 9 }}>
                      <Pressable
                        onPress={() => { setOpenClientSession(viewOpen ? null : i); setOpenClientAi(null); }}
                        style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 11, borderRadius: 12, borderWidth: 1, borderColor: hexA(C.orange, 0.3), backgroundColor: viewOpen ? hexA(C.orange, 0.12) : hexA(C.orange, 0.05) }}
                      >
                        <Icon path="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" size={15} color={C.orange} strokeWidth={2} />
                        <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: C.orange }}>View</Text>
                      </Pressable>
                      {s.ai_analysis ? (
                        <Pressable
                          onPress={() => { setOpenClientAi(aiOpen ? null : i); setOpenClientSession(null); }}
                          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 11, borderRadius: 12, borderWidth: 1, borderColor: hexA(C.blue, 0.3), backgroundColor: aiOpen ? hexA(C.blue, 0.12) : hexA(C.blue, 0.05) }}
                        >
                          <Icon path="M12 3a4 4 0 0 0-4 4 4 4 0 0 0-1 7.9V19a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-4.1A4 4 0 0 0 16 7a4 4 0 0 0-4-4Z" size={15} color={C.blue} strokeWidth={2} />
                          <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: C.blue }}>AI</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  </View>
                  {viewOpen ? (
                    <View style={{ paddingHorizontal: 14, paddingBottom: 14, gap: 9, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)', paddingTop: 12 }}>
                      {([
                        ['Type', s.type_label],
                        ['Status', s.status.charAt(0).toUpperCase() + s.status.slice(1)],
                        ['Trainer', s.trainer_name],
                        ['Date', `${istDayLabel(s.scheduled_at)} · ${tp.time} ${tp.ampm}`],
                      ] as [string, string][]).map(([lab, val]) => (
                        <View key={lab} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
                          <Mono style={{ fontSize: 10.5, letterSpacing: 0.5, color: C.muted3 }}>{lab.toUpperCase()}</Mono>
                          <Text style={{ flexShrink: 1, textAlign: 'right', fontFamily: F.bodySemi, fontSize: 13, color: C.ink }}>{val}</Text>
                        </View>
                      ))}
                      {s.notes ? (
                        <View style={{ marginTop: 2 }}>
                          <Mono style={{ fontSize: 10.5, letterSpacing: 0.5, color: C.muted3, marginBottom: 4 }}>NOTES</Mono>
                          <Body style={{ fontSize: 12.5, color: C.muted2 }}>{s.notes}</Body>
                        </View>
                      ) : null}
                      <SessionExercises sessionId={s.workout_session_id} />
                    </View>
                  ) : null}
                  {aiOpen ? (
                    <View style={{ paddingHorizontal: 14, paddingBottom: 14, gap: 10, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)', paddingTop: 12 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 11, borderRadius: 11, backgroundColor: hexA(C.blue, 0.08), borderWidth: 1, borderColor: hexA(C.blue, 0.22) }}>
                        <View style={{ width: 24, height: 24, borderRadius: 8, backgroundColor: hexA(C.blue, 0.16), alignItems: 'center', justifyContent: 'center' }}>
                          <Icon path="M12 3a4 4 0 0 0-4 4 4 4 0 0 0-1 7.9V19a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-4.1A4 4 0 0 0 16 7a4 4 0 0 0-4-4Z" size={14} color={C.blue} strokeWidth={2} />
                        </View>
                        <Mono style={{ flex: 1, fontSize: 10.5, letterSpacing: 0.8, color: '#8FB6F0' }}>ODDS AI · SESSION ANALYSIS</Mono>
                      </View>
                      {s.ai_analysis ? <AiAnalysis text={s.ai_analysis} /> : <Body style={{ fontSize: 12.5, color: C.muted3 }}>No analysis available.</Body>}
                    </View>
                  ) : null}
                </View>
              );
            })}
            {(sessionsQ.data?.length ?? 0) > sessionsShown ? (
              <Pressable onPress={() => setSessionsShown((n) => n + 10)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 12, borderRadius: 13, borderWidth: 1.5, borderStyle: 'dashed', borderColor: hexA(C.orange, 0.3), backgroundColor: hexA(C.orange, 0.04) }}>
                <Icon name="chevDown" size={15} color={C.orange} strokeWidth={2.4} />
                <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: C.orange }}>Load 10 more</Text>
                <Text style={{ fontFamily: F.body, fontSize: 11.5, color: C.muted2 }}>· {(sessionsQ.data?.length ?? 0) - sessionsShown} remaining</Text>
              </Pressable>
            ) : null}
            </>
          )}
        </Card>
      ) : (
        <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.09)" style={{ padding: 16, gap: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Icon name="file" size={20} color={C.gold} strokeWidth={1.9} />
            <View style={{ flex: 1 }}>
              <Serif style={{ fontSize: 19 }}>Training Plans</Serif>
              <Body style={{ fontSize: 11.5, color: C.muted, marginTop: 1 }}>{planSummary}</Body>
            </View>
            <Pressable onPress={() => go('create-plan')}>
              <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 9, paddingHorizontal: 13, borderRadius: 999 }}>
                <Icon name="plus" size={13} color="#fff" strokeWidth={2.8} />
                <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: '#fff' }}>Create Plan</Text>
              </LinearGradient>
            </Pressable>
          </View>
          {plansQ.isLoading ? (
            <Body style={{ color: C.muted2, textAlign: 'center', paddingVertical: 20 }}>Loading plans…</Body>
          ) : (plansQ.data?.length ?? 0) === 0 ? (
            <Body style={{ color: C.muted2, textAlign: 'center', paddingVertical: 20 }}>No plans yet — create one above.</Body>
          ) : (
            (plansQ.data ?? []).map((p: any, i: number) => {
              const stat = (p.status ?? 'approved') as string;
              const statMeta =
                stat === 'approved'
                  ? p.expired ? { label: 'Expired', color: C.gold } : { label: 'Active', color: C.green }
                  : stat === 'pending_review' ? { label: 'Pending review', color: C.blue }
                  : stat === 'rejected' ? { label: 'Rejected', color: C.red }
                  : stat === 'needs_revision' ? { label: 'Needs revision', color: C.gold }
                  : { label: stat, color: C.muted };
              const c = statMeta.color;
              const weeks = p.plan_duration_weeks ? `${p.plan_duration_weeks} weeks` : null;
              const exCount = p.exercises?.length ?? 0;
              const meta = [weeks, p.modality, exCount ? `${exCount} exercises` : null].filter(Boolean).join(' · ') || 'Training plan';
              const isOpen = openPlan === p.plan_id;
              // Group exercises by body part for display
              const groups: Record<string, any[]> = {};
              for (const ex of (p.exercises ?? [])) {
                const key = ex.body_part || 'General';
                (groups[key] = groups[key] || []).push(ex);
              }
              return (
                <View key={p.plan_id ?? i} style={{ borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: hexA(c, 0.2), overflow: 'hidden' }}>
                  <Pressable onPress={() => setOpenPlan(isOpen ? null : p.plan_id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13 }}>
                    <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: hexA(c, 0.13), alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name="layers" size={18} color={c} strokeWidth={1.9} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Body style={{ fontSize: 14.5, fontFamily: F.bodySemi, color: '#fff' }}>{p.plan_name || 'Training Plan'}</Body>
                      <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 1 }}>{meta}</Body>
                    </View>
                    <Badge text={statMeta.label} color={c} />
                    <Icon name={isOpen ? 'chevUp' : 'chevDown'} size={16} color={C.muted} strokeWidth={2.2} />
                  </Pressable>
                  {isOpen ? (
                    <View style={{ paddingHorizontal: 13, paddingBottom: 13, gap: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)', paddingTop: 12 }}>
                      {p.plan_description ? <Body style={{ fontSize: 12.5, color: C.muted2 }}>{p.plan_description}</Body> : null}
                      {exCount === 0 ? (
                        <Body style={{ fontSize: 12.5, color: C.muted3 }}>No exercises in this plan.</Body>
                      ) : (
                        Object.entries(groups).map(([bp, exs]) => (
                          <View key={bp} style={{ gap: 8 }}>
                            <Mono style={{ fontSize: 9.5, letterSpacing: 1, color: c }}>{bp.toUpperCase()}</Mono>
                            {exs.map((ex: any, j: number) => {
                              const exKey = `${p.plan_id}:${ex.id ?? j}`;
                              const exOpen = openExercise === exKey;
                              const setCount = ex.set_number != null && `${ex.set_number}`.trim() !== '' ? `${ex.set_number}` : null;
                              const detail: [string, string][] = [
                                ['SETS', setCount ?? '—'],
                                ...(ex.reps_target != null ? [['TARGET REPS', `${ex.reps_target}`] as [string, string]] : []),
                                ...(ex.load_target != null ? [['LOAD', `${ex.load_target} kg`] as [string, string]] : []),
                                ...(ex.rm_percentage != null ? [['RM %', `${ex.rm_percentage}%`] as [string, string]] : []),
                                ...(ex.tempo ? [['TEMPO', `${ex.tempo}`] as [string, string]] : []),
                                ...(ex.rest_period != null ? [['REST', `${ex.rest_period}s`] as [string, string]] : []),
                                ...(ex.duration ? [['DURATION', `${ex.duration}`] as [string, string]] : []),
                              ];
                              return (
                                <View key={exKey} style={{ borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: exOpen ? hexA(c, 0.3) : 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                                  <Pressable onPress={() => setOpenExercise(exOpen ? null : exKey)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 11 }}>
                                    <View style={{ flex: 1 }}>
                                      <Body style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{ex.exercise_name || ex.sub_activity || 'Exercise'}</Body>
                                      <Mono style={{ fontSize: 10, color: C.muted3, marginTop: 2 }}>{setCount ? `${setCount} sets` : 'Tap for details'}</Mono>
                                    </View>
                                    {ex.super_set_group ? <Badge text={`SS ${ex.super_set_group}`} color={C.purple} /> : null}
                                    <Icon name={exOpen ? 'chevUp' : 'chevDown'} size={14} color={C.muted} strokeWidth={2.2} />
                                  </Pressable>
                                  {exOpen ? (
                                    <View style={{ paddingHorizontal: 11, paddingBottom: 11, gap: 8, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)', paddingTop: 10 }}>
                                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                                        {detail.map(([lab, val]) => (
                                          <View key={lab} style={{ minWidth: '30%', flexGrow: 1, paddingVertical: 7, paddingHorizontal: 10, borderRadius: 9, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' }}>
                                            <Mono style={{ fontSize: 8.5, letterSpacing: 0.6, color: C.muted3 }}>{lab}</Mono>
                                            <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: C.ink, marginTop: 2 }}>{val}</Text>
                                          </View>
                                        ))}
                                      </View>
                                      {ex.exercise_notes ? (
                                        <View>
                                          <Mono style={{ fontSize: 8.5, letterSpacing: 0.6, color: C.muted3, marginBottom: 3 }}>NOTES</Mono>
                                          <Body style={{ fontSize: 12, color: C.muted2 }}>{ex.exercise_notes}</Body>
                                        </View>
                                      ) : null}
                                    </View>
                                  ) : null}
                                </View>
                              );
                            })}
                          </View>
                        ))
                      )}
                    </View>
                  ) : null}
                </View>
              );
            })
          )}
        </Card>
      )}

      {/* Report detail sheets */}
      <BloodReportSheet
        report={bloodDetail}
        accent={bloodDetail && reportsTab === 'medical' ? C.purple : C.blue}
        icon={reportsTab === 'medical' ? 'clipboard' : 'activity'}
        onClose={() => setBloodDetail(null)}
      />
      <QhpReportSheet report={qhpDetail?.row ?? null} label={qhpDetail?.label} onClose={() => setQhpDetail(null)} />
    </Page>
  );
}
const infoTag = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 7, paddingVertical: 9, paddingHorizontal: 13, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', backgroundColor: 'rgba(255,255,255,0.02)' };
const styles_trendTile = { flex: 1, alignItems: 'center' as const, gap: 4, paddingVertical: 10, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' };

/* ============ SESSIONS / ROSTER ============ */
const MODALITY_COLORS = [C.orange, C.blue, C.green, C.purple, C.gold, C.red];
const modalityColor = (m: string) => MODALITY_COLORS[Math.abs([...(m || '')].reduce((a, c) => a + c.charCodeAt(0), 0)) % MODALITY_COLORS.length];

export function Sessions() {
  const trainerId = useTrainerId();
  const [sessTab, setSessTab] = React.useState<'training' | 'roster' | 'missed'>('training');
  const [missedFilter, setMissedFilter] = React.useState<'unresolved' | 'resolved' | 'all'>('all');

  // IST "today" parts.
  const todayIso = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // YYYY-MM-DD
  const [ty, tmo, td] = todayIso.split('-').map(Number);
  const [ref, setRef] = React.useState({ year: ty, month: tmo - 1 }); // month 0-indexed
  const [selDay, setSelDay] = React.useState(td);

  const monthQ = useTrainerMonthSessions(trainerId, ref);
  const byDay = monthQ.data?.byDay ?? {};
  const missed = monthQ.data?.missed ?? [];

  const isCurrentMonth = ref.year === ty && ref.month === tmo - 1;
  const daysInMonth = new Date(ref.year, ref.month + 1, 0).getDate();
  const firstWeekday = new Date(ref.year, ref.month, 1).getDay(); // 0=Sun
  const monthLabel = new Date(ref.year, ref.month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const selDayClamped = Math.min(selDay, daysInMonth);
  const dayList = byDay[selDayClamped] ?? [];
  const selDateLabel = new Date(ref.year, ref.month, selDayClamped).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  const shiftMonth = (delta: number) => {
    const d = new Date(ref.year, ref.month + delta, 1);
    setRef({ year: d.getFullYear(), month: d.getMonth() });
    setSelDay(1);
  };
  const shiftDay = (delta: number) => {
    const n = selDayClamped + delta;
    if (n >= 1 && n <= daysInMonth) setSelDay(n);
  };

  const attendedCount = dayList.filter((s) => s.logged || s.status === 'completed').length;
  const upcomingCount = dayList.length - attendedCount;

  const missedRows = missedFilter === 'resolved' ? [] : missed;
  const now = Date.now();

  return (
    <Page gap={18} pt={6}>
      {/* Date header */}
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Pressable style={navBtn} onPress={() => shiftDay(-1)}>
          <Icon path="M15 6l-6 6 6 6" size={15} color={C.muted} strokeWidth={2.2} />
        </Pressable>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Mono style={{ fontSize: 10, letterSpacing: 2, color: C.mono2 }}>
            {isCurrentMonth && selDayClamped === td ? 'TODAY' : 'SELECTED'} · {dayList.length} SESSION{dayList.length === 1 ? '' : 'S'}
          </Mono>
          <Serif style={{ fontSize: 23, marginTop: 3 }}>{selDateLabel}</Serif>
        </View>
        <Pressable style={navBtn} onPress={() => shiftDay(1)}>
          <Icon name="chevRight" size={15} color={C.muted} strokeWidth={2.2} />
        </Pressable>
      </View>

      {/* Underline tabs */}
      <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.07)' }}>
        {([['training', 'Training'], ['roster', 'Roster'], ['missed', 'Missed']] as const).map(([id, label]) => {
          const active = sessTab === id;
          return (
            <Pressable key={id} onPress={() => setSessTab(id)} style={{ flex: 1, alignItems: 'center', paddingVertical: 11 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 14, color: active ? C.orange : C.muted }}>{label}</Text>
                {id === 'missed' && missed.length > 0 ? (
                  <Text style={{ fontFamily: F.mono, fontSize: 11, color: C.red }}>{missed.length}</Text>
                ) : null}
              </View>
              <View style={{ position: 'absolute', bottom: -1, left: '22%', right: '22%', height: 2.5, borderRadius: 2, backgroundColor: active ? C.orange : 'transparent' }} />
            </Pressable>
          );
        })}
      </View>

      {monthQ.isLoading ? (
        <View style={{ alignItems: 'center', gap: 8, paddingVertical: 26 }}>
          <Icon name="clock" size={22} color={C.muted3} strokeWidth={1.8} />
          <Body style={{ fontSize: 12.5, color: C.muted3 }}>Loading sessions…</Body>
        </View>
      ) : monthQ.isError ? (
        <Body style={{ color: C.red, textAlign: 'center', paddingVertical: 20 }}>Couldn't load sessions.</Body>
      ) : sessTab === 'training' ? (
        <>
          <Body style={{ fontSize: 12.5, color: C.muted, marginTop: -6 }}>
            <Text style={{ color: C.green }}>✓ {attendedCount} logged</Text> · {upcomingCount} upcoming
          </Body>
          <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.09)" radius={20} style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
            {dayList.length === 0 ? (
              <View style={{ alignItems: 'center', gap: 8, paddingVertical: 24 }}>
                <Icon name="calendar" size={26} color="#4C4640" strokeWidth={1.6} />
                <Body style={{ fontSize: 13, color: C.muted3 }}>No sessions on this day.</Body>
              </View>
            ) : (
              dayList.map((s, i) => {
                const tp = istTimeParts(s.scheduled_datetime);
                const attended = s.logged || s.status === 'completed';
                const cancelled = s.status === 'cancelled';
                return (
                  <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 15, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: 'rgba(255,255,255,0.05)' }}>
                    <View style={{ width: 66 }}>
                      <Mono style={{ fontSize: 12.5, color: C.orange }}>{tp.time}</Mono>
                      <Mono style={{ fontSize: 9, color: C.muted3, marginTop: 1 }}>{tp.ampm}</Mono>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Body style={{ fontSize: 15, fontFamily: F.bodySemi, color: '#fff' }}>{s.client_name}</Body>
                      <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 2 }}>{s.modality}</Body>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: cancelled ? C.red : attended ? C.green : C.blue }} />
                      <Body style={{ fontSize: 12, fontFamily: F.bodySemi, color: cancelled ? C.red : attended ? C.green : C.blue }}>
                        {cancelled ? 'Cancelled' : attended ? 'Logged' : 'Upcoming'}
                      </Body>
                    </View>
                  </View>
                );
              })
            )}
          </Card>
        </>
      ) : sessTab === 'roster' ? (
        <>
          {/* Month grid */}
          <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.09)" radius={20} style={{ padding: 16 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
              <Serif style={{ flex: 1, fontSize: 19 }}>{monthLabel}</Serif>
              <Pressable style={navBtnSm} onPress={() => shiftMonth(-1)}><Icon path="M15 6l-6 6 6 6" size={13} color={C.muted} strokeWidth={2.2} /></Pressable>
              <View style={{ width: 7 }} />
              <Pressable style={navBtnSm} onPress={() => shiftMonth(1)}><Icon name="chevRight" size={13} color={C.muted} strokeWidth={2.2} /></Pressable>
            </View>
            <View style={{ flexDirection: 'row', marginBottom: 8 }}>
              {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
                <Text key={i} style={{ flex: 1, textAlign: 'center', fontFamily: F.mono, fontSize: 9, color: C.muted3 }}>{d}</Text>
              ))}
            </View>
            {(() => {
              const cells: (number | null)[] = [];
              for (let i = 0; i < firstWeekday; i++) cells.push(null);
              for (let d = 1; d <= daysInMonth; d++) cells.push(d);
              while (cells.length % 7 !== 0) cells.push(null);
              const weeks: (number | null)[][] = [];
              for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
              return weeks.map((wk, wi) => (
                <View key={wi} style={{ flexDirection: 'row', marginBottom: 6 }}>
                  {wk.map((d, di) => {
                    const sel = d === selDayClamped;
                    const today = isCurrentMonth && d === td;
                    const dots = d && byDay[d] ? byDay[d].map((s) => modalityColor(s.modality)) : [];
                    return (
                      <Pressable key={di} disabled={!d} onPress={() => d && setSelDay(d)} style={{ flex: 1, alignItems: 'center', gap: 4, paddingVertical: 4 }}>
                        <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: sel ? C.orangeGradB : 'transparent', borderWidth: today && !sel ? 1.5 : 0, borderColor: hexA(C.orange, 0.55) }}>
                          <Text style={{ fontFamily: sel || today ? F.bodyBold : F.body, fontSize: 12.5, color: sel ? '#fff' : today ? C.orange : d ? C.ink3 : 'transparent' }}>{d ?? 0}</Text>
                        </View>
                        <View style={{ flexDirection: 'row', gap: 2.5, height: 5 }}>
                          {dots.slice(0, 3).map((c, ci) => (
                            <View key={ci} style={{ width: 4.5, height: 4.5, borderRadius: 3, backgroundColor: c }} />
                          ))}
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              ));
            })()}
          </Card>

          {/* Selected day sessions */}
          <View>
            <Mono style={{ fontSize: 11, letterSpacing: 1.8, color: C.mono, marginBottom: 10 }}>
              {monthLabel.slice(0, 3).toUpperCase()} {selDayClamped} · {dayList.length} SESSION{dayList.length === 1 ? '' : 'S'}
            </Mono>
            <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.09)" radius={20} style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
              {dayList.length === 0 ? (
                <View style={{ alignItems: 'center', gap: 8, paddingVertical: 22 }}>
                  <Icon name="calendar" size={26} color="#4C4640" strokeWidth={1.6} />
                  <Body style={{ fontSize: 13, color: C.muted3 }}>No sessions on this day.</Body>
                </View>
              ) : (
                dayList.map((s, i) => {
                  const tp = istTimeParts(s.scheduled_datetime);
                  return (
                    <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: 'rgba(255,255,255,0.05)' }}>
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: modalityColor(s.modality) }} />
                      <Mono style={{ width: 68, fontSize: 11.5, color: C.ink3 }}>{tp.time} {tp.ampm}</Mono>
                      <Body style={{ flex: 1, fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }}>{s.client_name}</Body>
                      <Body style={{ fontSize: 11.5, color: C.muted2 }}>{s.modality}</Body>
                    </View>
                  );
                })
              )}
            </Card>
          </View>
        </>
      ) : (
        <>
          {/* Month stats strip */}
          <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.09)" radius={20} style={{ padding: 16, flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Serif style={{ fontSize: 26, color: C.red }}>{monthQ.data && monthQ.data.items.length ? `${Math.round((missed.length / monthQ.data.items.length) * 100)}%` : '0%'}</Serif>
              <Mono style={{ fontSize: 8.5, color: C.muted3, marginTop: 3 }}>MISS RATE</Mono>
            </View>
            <View style={{ width: 1, height: 34, backgroundColor: 'rgba(255,255,255,0.07)' }} />
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Serif style={{ fontSize: 26 }}>{missed.length}</Serif>
              <Mono style={{ fontSize: 8.5, color: C.muted3, marginTop: 3 }}>MISSED</Mono>
            </View>
            <View style={{ width: 1, height: 34, backgroundColor: 'rgba(255,255,255,0.07)' }} />
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Serif style={{ fontSize: 26, color: C.muted }}>{monthQ.data?.items.length ?? 0}</Serif>
              <Mono style={{ fontSize: 8.5, color: C.muted3, marginTop: 3 }}>SCHEDULED</Mono>
            </View>
          </Card>

          {/* Missed list */}
          <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.09)" radius={20} style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
            {missedRows.length === 0 ? (
              <View style={{ alignItems: 'center', gap: 8, paddingVertical: 22 }}>
                <Icon name="checks" size={24} color={C.green} strokeWidth={1.9} />
                <Body style={{ fontSize: 13, color: C.muted3 }}>No missed sessions this month.</Body>
              </View>
            ) : (
              missedRows.map((m, i) => {
                const tp = istTimeParts(m.scheduled_datetime);
                const hrs = Math.floor((now - new Date(m.scheduled_datetime).getTime()) / 3.6e6);
                return (
                  <View key={m.id} style={{ paddingVertical: 14, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: 'rgba(255,255,255,0.05)' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <View style={{ flex: 1 }}>
                        <Body style={{ fontSize: 15, fontFamily: F.bodySemi, color: '#fff' }}>{m.client_name}</Body>
                        <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 2 }}>{m.modality}</Body>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Body style={{ fontSize: 12, color: C.ink3 }}>{monthLabel.slice(0, 3)} {m.day} · {tp.time} {tp.ampm}</Body>
                        <Body style={{ fontSize: 11, fontFamily: F.bodySemi, color: C.red, marginTop: 2 }}>{hrs}h overdue</Body>
                      </View>
                    </View>
                  </View>
                );
              })
            )}
          </Card>
        </>
      )}
    </Page>
  );
}
const navBtn = { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', alignItems: 'center' as const, justifyContent: 'center' as const };
const navBtnSm = { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center' as const, justifyContent: 'center' as const };

/* ============ WORKOUT FORM ============ */
type WSet = {
  reps: string; load: string; duration: string; note?: string;
  // Plan-carried per-set fields (persisted to their own columns — web parity)
  tempo?: string; rest?: string; rmPct?: string; rir?: string; superset?: string; equipment?: string;
  // Plan targets — placeholders only, never persisted directly
  repsPlan?: string; loadPlan?: string; durationPlan?: string;
};
type WExercise = { name: string; measurement: 'reps' | 'duration'; sets: WSet[]; notes: string; body_part?: string; detailsOpen?: boolean; activityType?: 'Constant' | 'Custom'; completed?: boolean; rounds?: string; durationMin?: string; collapsed?: boolean };
const PILATES_EQUIPMENT = ['Pilates Ring', 'Ball', 'Resistance Band', 'Brick']; // web Pilates equipment Select options

/* Draggable RPE slider — 1 → 10 in 0.5 steps.
   Live value stays local during the drag (only this component re-renders);
   the parent is updated once on release, so dragging is smooth. */
function RpeSlider({ value, onChange, colorFn, labelFn }: { value: number | null; onChange: (v: number) => void; colorFn: (n: number) => string; labelFn: (n: number) => string }) {
  const MIN = 1, MAX = 10;
  const wRef = React.useRef(0);
  const leftRef = React.useRef(0); // track's absolute left edge (page X)
  const viewRef = React.useRef<View>(null);
  const dragRef = React.useRef<number | null>(null);
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;
  const [drag, setDrag] = React.useState<number | null>(null);

  const measure = () => {
    viewRef.current?.measureInWindow((x, _y, w) => {
      if (w) { leftRef.current = x; wRef.current = w; }
    });
  };
  const setFromAbsX = (absX: number) => {
    const w = wRef.current;
    if (!w) return;
    const clamped = Math.max(0, Math.min(1, (absX - leftRef.current) / w));
    // Whole-number steps — training_sessions.rpe is an integer column (web slider step=1).
    const stepped = Math.max(MIN, Math.min(MAX, Math.round(MIN + clamped * (MAX - MIN))));
    if (stepped !== dragRef.current) {
      dragRef.current = stepped;
      setDrag(stepped); // re-renders only the slider, not the whole form
    }
  };
  const end = () => {
    backSwipeLock.locked = false;
    if (dragRef.current != null) onChangeRef.current(dragRef.current);
    dragRef.current = null;
    setDrag(null);
  };
  const pan = React.useRef(
    PanResponder.create({
      // Only respond to an actual drag — a plain tap must NOT change the value.
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 2,
      onMoveShouldSetPanResponderCapture: (_e, g) => Math.abs(g.dx) > 2,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => { backSwipeLock.locked = true; },
      // Use absolute screen X against the measured track edge — robust regardless
      // of which child element the touch landed on.
      onPanResponderMove: (_e, g) => setFromAbsX(g.moveX),
      onPanResponderRelease: end,
      onPanResponderTerminate: end,
    })
  ).current;

  const val = drag ?? value;
  const has = val != null;
  const frac = has ? (val - MIN) / (MAX - MIN) : 0;
  const color = has ? colorFn(val) : C.orange;
  return (
    <View
      ref={viewRef}
      style={{ paddingVertical: 16 }}
      onLayout={measure}
      onTouchStart={() => { backSwipeLock.locked = true; measure(); }}
      onTouchEnd={() => { backSwipeLock.locked = false; }}
      onTouchCancel={() => { backSwipeLock.locked = false; }}
      {...pan.panHandlers}
    >
      {/* Live readout — updates while dragging */}
      <View style={{ alignItems: 'center', marginBottom: 14 }}>
        {has ? (
          <>
            <Serif style={{ fontSize: 34, color }}>{val}<Text style={{ fontSize: 15, color: C.muted2 }}> /10</Text></Serif>
            <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color, marginTop: 1 }}>{labelFn(val)}</Text>
          </>
        ) : (
          <Serif style={{ fontSize: 22, color: C.muted3 }}>Drag to set</Serif>
        )}
      </View>
      <View style={{ height: 10, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.09)', justifyContent: 'center' }}>
        {Array.from({ length: 10 }, (_, i) => i).map((i) => (
          <View key={i} style={{ position: 'absolute', left: `${(i / 9) * 100}%`, marginLeft: i === 0 ? 0 : i === 9 ? -2 : -1, width: 2, height: 10, backgroundColor: 'rgba(255,255,255,0.14)' }} />
        ))}
        <View style={{ position: 'absolute', left: 0, height: 10, borderRadius: 5, width: `${frac * 100}%`, backgroundColor: has ? color : 'transparent' }} />
        {has ? (
          <View style={{ position: 'absolute', left: `${frac * 100}%`, marginLeft: -18, width: 36, height: 36, borderRadius: 18, backgroundColor: '#fff', borderWidth: 3, borderColor: color, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 4 }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: '#12100E' }}>{val}</Text>
          </View>
        ) : (
          <View style={{ position: 'absolute', left: 0, marginLeft: -14, width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.15)', borderWidth: 2, borderColor: 'rgba(255,255,255,0.3)' }} />
        )}
      </View>
    </View>
  );
}

export function Workout() {
  const { modality, set, selectedClientId, selectedClientName, workoutScheduleId, editingOutboxId, back, canGoBack, go } = useStore();
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const healthScrollRef = React.useRef<ScrollView>(null);
  const trainerId = useTrainerId();
  const gateQ = useModalityGate(selectedClientId, trainerId, modality || 'strength');
  const gate = gateQ.data;
  const gateBlocked = !!gate?.blocked;
  const tplQ = useWorkoutTemplates(trainerId);
  const saveTplM = useSaveWorkoutTemplate();
  const delTplM = useDeleteWorkoutTemplate();
  const [templatesOpen, setTemplatesOpen] = React.useState(false);
  const [tplSaveMode, setTplSaveMode] = React.useState(false);
  const [tplName, setTplName] = React.useState('');
  const healthQ = useClientHealthCheck(selectedClientId);
  const saveHealthM = useSaveHealthData();
  const health = healthQ.data;
  const isOnline = useIsOnline();
  // Health data entered while offline — satisfies the gate locally and syncs
  // inside the same outbox item as the workout log.
  const [offlineHealth, setOfflineHealth] = React.useState<HealthDataInput | null>(null);
  const serverGateOk = !!health && !(health.sleepMissing || health.nutritionMissing || health.stepsMissing);
  // Offline with nothing cached: the gate STILL applies — sleep/nutrition/steps
  // must be entered before the log can be saved (no offline loophole).
  const healthUnknown = !health && !isOnline;
  const gateBlocking = !serverGateOk && !offlineHealth && (!!health || healthUnknown);
  // Only treat health as "loading" when a fetch is actually running (offline = paused).
  const healthLoading = healthQ.isLoading && healthQ.fetchStatus === 'fetching';

  const [healthOpen, setHealthOpen] = React.useState(false);
  const [kbH, setKbH] = React.useState(0);
  React.useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const s = Keyboard.addListener(showEvt, (e: any) => setKbH(e.endCoordinates?.height ?? 0));
    const h = Keyboard.addListener(hideEvt, () => setKbH(0));
    return () => { s.remove(); h.remove(); };
  }, []);
  const [hSleep, setHSleep] = React.useState('');
  const [hRating, setHRating] = React.useState<number | null>(null);
  const [hSteps, setHSteps] = React.useState('');
  const saveHealth = async () => {
    const payload: HealthDataInput = {
      clientId: selectedClientId as string,
      trainerId,
      hoursSlept: hSleep.trim() ? Number(hSleep) : null,
      scheduledHours: health?.scheduledHours ?? 8,
      nutritionRating: hRating,
      stepsCount: hSteps.trim() ? Number(hSteps) : null,
    };
    if (!getIsOnline()) {
      // Same required fields as online; the data rides along in the outbox
      // payload and syncs right before the workout log.
      setOfflineHealth(payload);
      setHealthOpen(false);
      return;
    }
    try {
      await saveHealthM.mutateAsync(payload);
      setHealthOpen(false);
    } catch (e: any) {
      if (/network request failed|network error|failed to fetch|fetch failed|timeout/i.test(String(e?.message))) {
        setOfflineHealth(payload);
        setHealthOpen(false);
      }
      /* other errors shown in dialog */
    }
  };
  const healthValid = hSleep.trim() !== '' && hRating != null && hSteps.trim() !== '';
  const [sessionName, setSessionName] = React.useState('');
  const [exercises, setExercises] = React.useState<WExercise[]>([]);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [exSearch, setExSearch] = React.useState('');
  const [customFormOpen, setCustomFormOpen] = React.useState(false);
  const [customName, setCustomName] = React.useState('');
  const [customMeasure, setCustomMeasure] = React.useState<'reps' | 'duration'>('reps');
  const exDbQ = useExerciseDb(modality || 'strength');
  const [remark, setRemark] = React.useState('');
  const [rpe, setRpe] = React.useState<number | null>(null);
  const [done, setDone] = React.useState(false);
  const [savedOffline, setSavedOffline] = React.useState(false);
  // Local-first pipeline result: 'synced' only after the REAL DB insert succeeded;
  // 'queued' = safely on this device, waiting for network; 'failed' = server rejected.
  const [saving, setSaving] = React.useState(false);
  const [syncError, setSyncError] = React.useState<string | null>(null);
  // Logs are immutable — the trainer confirms date/time before anything is committed.
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  // Blank-exercise warning: lists what WILL be saved before dropping empty ones.
  const [blankOpen, setBlankOpen] = React.useState(false);

  const clientName = selectedClientName ?? 'Client';
  const modLabel = modality ? modality[0].toUpperCase() + modality.slice(1) : 'Strength';
  // Yoga & Boxing log as "activities" (mark as completed), not reps/load sets.
  const mLower = (modality || 'strength').toLowerCase();
  const isActivityModality = mLower === 'yoga' || mLower === 'boxing';
  const isBoxingModality = mLower === 'boxing';
  const isAerobicsModality = mLower === 'aerobics';
  const isPilatesModality = mLower === 'pilates';
  const isCustomModality = mLower === 'custom';

  // Approved plans (web useLocalFirstApprovedWorkoutPlans): ✅ chips, body-part
  // selector, plan pre-population, Custom-modality access.
  const plansQ = useApprovedPlansForLogging(selectedClientId);
  const plans = plansQ.data;
  const uiModalityName = (mm: string) => (mm === 'strength' ? 'Strength' : mm === 'aqua aerobics' ? 'Aqua Aerobics' : mm.replace(/\b\w/g, (c) => c.toUpperCase()));
  const hasPlanFor = (mm: string) => !!plans?.availableModalities.includes(uiModalityName(mm));
  const currentPlan = plans?.plansByModality[uiModalityName(mLower)] ?? null;
  const customAvailable = !!plans?.availableModalities.includes('Custom');
  const [customModalityName, setCustomModalityName] = React.useState('');
  const planBodyParts = React.useMemo(() => (currentPlan ? [...new Set(currentPlan.exercises.map((e) => e.body_part).filter(Boolean))] as string[] : []), [currentPlan]);

  // Previous session values (web useClientPreviousExerciseData): placeholders + ≥2× warning.
  const prevExQ = usePreviousExerciseData(selectedClientId);
  const prevSetsFor = (name: string) => prevExQ.data?.[name.toLowerCase().trim()];

  // Training partner (web checkPartner): prompt once, share one group id across both logs.
  const partnerQ = usePartnerInfo(selectedClientId);
  const [partnerAsked, setPartnerAsked] = React.useState(false);
  const [partnerPlan, setPartnerPlan] = React.useState<{ groupId: string; next: { id: string; name: string } | null } | null>(null);
  const partnerPromptVisible = !partnerAsked && !!partnerQ.data && !partnerPlan && !editingOutboxId;

  // Parallel / couple logging (web ParallelWorkoutTabs + useParallelWorkoutSessions):
  // "+ Add Client" pairs ANY second client with this session. Both logs share one
  // partner_session_group_id → downstream RPCs dedupe to a single package deduction.
  // Rides the same two-leg mechanism as the training-partner flow: save client A →
  // the form auto-switches to client B with the shared group id.
  const PARALLEL_STORE_KEY = 'parallel_workout_session';
  const PARALLEL_TTL_MS = 4 * 3_600_000; // web parity: 4-hour restore window
  const [pairNames, setPairNames] = React.useState<{ primary: { id: string; name: string }; second: { id: string; name: string } } | null>(null);
  const [pairPickerOpen, setPairPickerOpen] = React.useState(false);
  const [pairSearch, setPairSearch] = React.useState('');
  const myClientsQ = useMyClients(trainerId);
  // Which leg is on screen: 'second' after client A saved and the form switched.
  const pairLeg: 'first' | 'second' = pairNames && partnerPlan && !partnerPlan.next ? 'second' : 'first';
  const startPair = (second: { id: string; name: string }, groupId?: string) => {
    const gid = groupId ?? uuidv4();
    const primary = { id: selectedClientId as string, name: clientName };
    setPartnerPlan({ groupId: gid, next: second });
    setPartnerAsked(true);
    setPairNames({ primary, second });
    AsyncStorage.setItem(PARALLEL_STORE_KEY, JSON.stringify({ primaryId: primary.id, primaryName: primary.name, second, groupId: gid, at: Date.now() })).catch(() => {});
  };
  const removePair = () => {
    setPartnerPlan(null);
    setPairNames(null);
    AsyncStorage.removeItem(PARALLEL_STORE_KEY).catch(() => {});
  };
  // Restore a stored pair for the SAME primary client within the TTL (web localStorage parity).
  React.useEffect(() => {
    if (!selectedClientId || editingOutboxId) return;
    let alive = true;
    AsyncStorage.getItem(PARALLEL_STORE_KEY).then((raw) => {
      if (!alive || !raw) return;
      try {
        const s = JSON.parse(raw);
        if (s?.primaryId === selectedClientId && s?.second?.id && Date.now() - (s.at ?? 0) < PARALLEL_TTL_MS) {
          setPartnerPlan((prev) => prev ?? { groupId: s.groupId ?? uuidv4(), next: s.second });
          setPairNames((prev) => prev ?? { primary: { id: s.primaryId, name: s.primaryName ?? 'Client' }, second: s.second });
          setPartnerAsked(true);
        } else if (s?.primaryId !== selectedClientId) {
          // Different primary → stale pair; second-leg switches keep state in memory.
          AsyncStorage.removeItem(PARALLEL_STORE_KEY).catch(() => {});
        }
      } catch { /* corrupt store — ignore */ }
    }).catch(() => {});
    return () => { alive = false; };
  }, [selectedClientId, editingOutboxId]);

  // Duplicate-session guard (web checkDuplicateWorkoutSession): confirm before a 2nd
  // same-day session of this modality.
  const [dupOpen, setDupOpen] = React.useState(false);

  // Switching modality clears the in-progress list (its input model differs).
  const prevModalityRef = React.useRef(modality);
  React.useEffect(() => {
    if (prevModalityRef.current !== modality) {
      prevModalityRef.current = modality;
      setExercises([]);
    }
  }, [modality]);

  // ---- Edit a queued (unsynced) log in place (Home → Waiting to Sync → Edit) ----
  const editLoadedRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!editingOutboxId || editLoadedRef.current === editingOutboxId) return;
    editLoadedRef.current = editingOutboxId;
    (async () => {
      const item = getOutboxItem(editingOutboxId);
      if (!item) { set({ editingOutboxId: null }); return; }
      const p = item.payload as WorkoutLogOutboxPayload;
      // Already-synced race: a background drain may have landed it. Saved logs are
      // immutable — clean the queue entry up and bail out of edit mode.
      if (getIsOnline() && p.sessionId) {
        try {
          const { data } = await supabase.from('workout_exercises').select('id').eq('session_id', p.sessionId).limit(1);
          if (data?.length) {
            await removeOutboxItem(editingOutboxId);
            set({ editingOutboxId: null });
            Alert.alert('Already synced', 'This workout synced to the server while it was queued — saved logs can no longer be edited.', [{ text: 'OK', onPress: () => (canGoBack ? back() : go('dashboard')) }]);
            return;
          }
        } catch { /* offline blip — proceed with the edit */ }
      }
      // Rehydrate the form from the queued payload (same session id + original date stay).
      const known = modalities.find((mm) => mm.toLowerCase() === (p.modality ?? '').toLowerCase());
      const targetModality = known ?? 'custom';
      if (!known && p.modality) setCustomModalityName(p.modality);
      prevModalityRef.current = targetModality;
      if (targetModality !== modality) set({ modality: targetModality });
      setPartnerAsked(true); // partner decision was made on first submit; the group id rides in the payload
      setSessionName(p.sessionName ?? '');
      setExercises(Array.isArray(p.exercises) ? (p.exercises as WExercise[]) : []);
      setRemark(p.remark ?? '');
      setRpe(p.rpe ?? null);
    })();
  }, [editingOutboxId]);

  // Aerobics pre-population (web: plan exercises → one duration set each, minutes).
  const aerobicsPopulatedRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!isAerobicsModality || !currentPlan) return;
    const key = `${currentPlan.plan_id}`;
    if (aerobicsPopulatedRef.current === key) return;
    aerobicsPopulatedRef.current = key;
    setExercises((xs) => (xs.length ? xs : currentPlan.exercises.map((ex) => ({
      name: ex.exercise_name,
      measurement: 'duration' as const,
      body_part: ex.body_part ?? undefined,
      notes: '',
      collapsed: true,
      sets: [{ reps: '', load: '', duration: '', durationPlan: ex.duration ?? undefined, note: ex.exercise_notes ?? '' }],
    }))));
  }, [isAerobicsModality, currentPlan]);

  // Body-part pick → pre-populate from the approved plan (web handleWorkoutNameSelect).
  const populateFromPlan = (bp: string) => {
    if (!currentPlan) return;
    const rows = currentPlan.exercises.filter((e) => e.body_part === bp);
    const groups = new Map<string, PlanExerciseRow[]>();
    const order: string[] = [];
    rows.forEach((r) => { const k = r.exercise_name; if (!groups.has(k)) { groups.set(k, []); order.push(k); } groups.get(k)!.push(r); });
    const built: WExercise[] = order.map((name) => {
      const rs = groups.get(name)!.slice().sort((a, b) => (parseInt(a.set_number ?? '0', 10) || 0) - (parseInt(b.set_number ?? '0', 10) || 0));
      const isDur = (rs[0].measurement_type ?? '').toLowerCase().trim() === 'duration';
      return {
        name,
        measurement: isDur ? 'duration' as const : 'reps' as const,
        body_part: bp,
        notes: '',
        collapsed: true,
        sets: rs.map((r) => ({
          reps: '', load: '', duration: '',
          repsPlan: !isDur && r.reps_target != null ? String(r.reps_target) : undefined,
          loadPlan: !isDur && r.load_target != null ? String(r.load_target) : undefined,
          durationPlan: isDur && r.duration != null ? String(r.duration) : undefined,
          tempo: r.tempo ?? '',
          rest: r.rest_period != null ? String(r.rest_period) : '',
          rmPct: r.rm_percentage != null ? String(r.rm_percentage) : '',
          superset: r.super_set_group ?? '',
          note: r.exercise_notes ?? '',
          equipment: '',
        })),
      };
    });
    setExercises(built);
    setSessionName(bp);
  };

  const updateEx = (i: number, patch: Partial<WExercise>) => setExercises((xs) => xs.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const updateSet = (ei: number, si: number, patch: Partial<WSet>) =>
    setExercises((xs) => xs.map((x, k) => (k === ei ? { ...x, sets: x.sets.map((s, j) => (j === si ? { ...s, ...patch } : s)) } : x)));
  // New sets start prefilled from the previous set — most sets repeat reps/load/duration.
  const addSet = (ei: number) => setExercises((xs) => xs.map((x, k) => (k === ei ? { ...x, sets: [...x.sets, { ...(x.sets[x.sets.length - 1] ?? { reps: '', load: '', duration: '' }) }] } : x)));
  const removeSet = (ei: number, si: number) => setExercises((xs) => xs.map((x, k) => (k === ei ? { ...x, sets: x.sets.filter((_, j) => j !== si) } : x)));
  // Keeps the picker OPEN so several exercises can be added in a row (tap Done to close).
  const addExercise = (name: string, measurement: 'reps' | 'duration' = 'reps', activityType: 'Constant' | 'Custom' = 'Constant', bodyPart?: string) => {
    const n = name.trim();
    if (!n) return;
    // Boxing Padwork defaults to 1 round (web useBoxingActivityHandlers).
    const padwork = /pad ?work/i.test(n);
    setExercises((xs) => [...xs, { name: n, measurement, body_part: bodyPart, sets: [{ reps: '', load: '', duration: '' }], notes: '', activityType, completed: isActivityModality ? true : undefined, rounds: padwork ? '1' : '', durationMin: '', collapsed: true }]);
  };
  const removeExercise = (i: number) => setExercises((xs) => xs.filter((_, k) => k !== i));

  // Templates for the CURRENT modality (RLS already limits to my own).
  const modNorm = (s: string) => (s || '').toLowerCase().replace(/training/g, '').replace(/[^a-z]/g, '');
  const myTemplates = (tplQ.data ?? []).filter((t) => modNorm(t.modality) === modNorm(modality || 'strength'));
  const applyTemplate = (t: any) => {
    const groups = new Map<string, any[]>();
    const order: string[] = [];
    (t.rows as any[]).forEach((r) => { const k = r.exercise_name || 'Exercise'; if (!groups.has(k)) { groups.set(k, []); order.push(k); } groups.get(k)!.push(r); });
    const built: WExercise[] = order.map((name) => {
      const rs = groups.get(name)!.slice().sort((a, b) => (a.set_number ?? 0) - (b.set_number ?? 0));
      if (isActivityModality) {
        const r0 = rs[0];
        return { name, measurement: 'reps', sets: [{ reps: '', load: '', duration: '' }], notes: '', activityType: (r0.activity_type as any) || 'Constant', completed: true, rounds: r0.rounds != null ? String(r0.rounds) : '', durationMin: r0.duration_minutes != null ? String(r0.duration_minutes) : '' };
      }
      const hasDur = rs.some((r) => r.duration_seconds != null);
      return { name, measurement: hasDur ? 'duration' : 'reps', sets: rs.map((r) => ({ reps: r.reps_assigned != null ? String(r.reps_assigned) : '', load: r.load_assigned != null ? String(r.load_assigned) : '', duration: r.duration_seconds != null ? String(r.duration_seconds) : '' })), notes: '' };
    });
    setExercises(built);
    if (!isActivityModality && t.rows[0]?.body_part) setSessionName(t.rows[0].body_part);
    setTemplatesOpen(false);
    setTplSaveMode(false);
  };
  const saveTemplate = async () => {
    if (!tplName.trim() || !trainerId) return;
    try {
      await saveTplM.mutateAsync({ trainerId, name: tplName, modality: modality || 'strength', sessionName, exercises });
      setTplName('');
      setTplSaveMode(false);
    } catch { /* error surfaced in sheet */ }
  };

  // Draft auto-save (web useWorkoutAutoSave: 500ms debounce, keyed trainer+client,
  // restored once on mount, cleared on successful submit / offline enqueue).
  const draftKey = trainerId && selectedClientId ? `workout-draft:${trainerId}:${selectedClientId}` : null;
  const draftCheckedRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!draftKey || draftCheckedRef.current === draftKey || editingOutboxId) return;
    draftCheckedRef.current = draftKey;
    KvStorage.getItem(draftKey).then((raw) => {
      if (!raw) return;
      try {
        const d = JSON.parse(raw);
        if (!d || (!d.exercises?.length && !d.sessionName && !d.remark)) return;
        if (d.modality && d.modality !== modality) { prevModalityRef.current = d.modality; set({ modality: d.modality }); }
        setSessionName(d.sessionName ?? '');
        setExercises(Array.isArray(d.exercises) ? d.exercises : []);
        setRemark(d.remark ?? '');
        if (d.rpe != null) setRpe(d.rpe);
        if (d.customModalityName) setCustomModalityName(d.customModalityName);
      } catch { /* corrupt draft — ignore */ }
    }).catch(() => {});
  }, [draftKey]);
  React.useEffect(() => {
    if (!draftKey || done || editingOutboxId) return; // edits live in the outbox item, not the draft
    const meaningful = exercises.some((e) => e.name.trim()) || sessionName.trim() || remark.trim();
    if (!meaningful) return; // never overwrite a good draft with an empty form
    // SQLite draft (expo-sqlite kv-store): debounced to coalesce keystrokes, but the
    // cleanup FLUSHES the pending write instead of dropping it — an unmount, crash
    // or app kill can lose at most nothing (the newest state is written on the way
    // out). This is the "never lose an entered value" guarantee.
    const payload = JSON.stringify({ sessionName, exercises, remark, rpe, modality, customModalityName });
    let written = false;
    const write = () => { if (!written) { written = true; KvStorage.setItem(draftKey, payload).catch(() => {}); } };
    const t = setTimeout(write, 250);
    return () => { clearTimeout(t); write(); };
  }, [draftKey, sessionName, exercises, remark, rpe, modality, customModalityName, done]);
  const clearDraft = () => { if (draftKey) KvStorage.removeItem(draftKey).catch(() => {}); };

  const hasValidContent = isActivityModality
    ? exercises.some((e) => e.name.trim() && e.completed)
    : exercises.some((e) => e.name.trim() && e.sets.some((s) => s.reps.trim() || s.load.trim() || s.duration.trim()));
  // Web rule: the metric (reps, or duration for timed moves) is required per set;
  // LOAD IS OPTIONAL (bodyweight sets log without a load).
  const setIncomplete = (e: WExercise, s: WSet) => (e.measurement === 'duration' ? !s.duration.trim() : !s.reps.trim());
  // An exercise "has data" when any value was entered (or it's marked completed for
  // activity modalities). Fully-blank exercises no longer block submission — they
  // are DROPPED from the log after an explicit confirmation popup, online and
  // offline alike (the filter runs before the payload reaches the SQLite outbox).
  const exHasData = (e: WExercise) => (isActivityModality ? !!e.completed : e.sets.some((s) => s.reps.trim() || s.load.trim() || s.duration.trim()));
  const blankExercises = exercises.filter((e) => e.name.trim() && !exHasData(e));
  // Partially-filled exercises still demand every set's metric (web parity).
  const incompleteExercises = isActivityModality ? [] : exercises.filter((e) => exHasData(e) && e.sets.some((s) => setIncomplete(e, s)));
  const allExercisesComplete = incompleteExercises.length === 0;
  const customNameMissing = isCustomModality && !customModalityName.trim();
  const canSubmit = !!selectedClientId && !!trainerId && hasValidContent && allExercisesComplete && rpe != null && !customNameMissing && !saving && !gateBlocking && !healthLoading && !gateBlocked;

  const goBack = () => {
    if (editingOutboxId) set({ editingOutboxId: null }); // cancel leaves the queued item untouched
    canGoBack ? back() : go('dashboard');
  };

  // If health data is missing, open the (prefilled) health sheet straight away —
  // the trainer fills the three fields and lands right back on the unlocked form.
  const autoOpened = React.useRef(false);
  React.useEffect(() => {
    if (gateBlocking && !autoOpened.current) {
      autoOpened.current = true;
      setHSleep(health?.sleepHours != null ? String(health.sleepHours) : '');
      setHRating(health?.nutritionRating ?? null);
      setHSteps(health?.stepsCount != null ? String(health.stepsCount) : '');
      setHealthOpen(true);
    }
  }, [gateBlocking]);

  const missingHint = gateBlocked
    ? `Approved ${modLabel} plan required — limit of 3 plan-less sessions reached`
    : !gateBlocking && !saving && !done
    ? (!hasValidContent ? (isActivityModality ? 'Mark at least one activity as completed' : 'Add an exercise with reps or load to submit')
      : !allExercisesComplete ? `Fill ${incompleteExercises[0].measurement === 'duration' ? 'duration' : 'reps'} for every set — “${incompleteExercises[0].name}” is incomplete (load is optional for bodyweight)`
      : customNameMissing ? 'Name your custom modality to submit'
      : rpe == null ? 'Set the session RPE to submit'
      : blankExercises.length ? `${blankExercises.length} blank exercise${blankExercises.length === 1 ? '' : 's'} (no values) will be removed when you submit`
      : !isOnline ? 'Offline — the log saves to this device and syncs automatically' : null)
    : null;

  // After a save: hand over to the partner leg, or leave the form.
  const finishAfterSave = (offline: boolean) => {
    clearDraft();
    setDone(true);
    if (editingOutboxId) set({ editingOutboxId: null });
    if (partnerPlan?.next) {
      const next = partnerPlan.next;
      // Carry the FIRST client's exercise selection into the partner's form (couples
      // usually do the same workout): same exercises, same set counts, but VALUES
      // CLEARED — the partner's actual reps/loads get entered fresh (their own
      // "Last:" placeholders show), and any carried exercise left blank is dropped
      // by the blank-exercise popup at submit. Fully editable: add/remove/rename.
      const carried: WExercise[] = JSON.parse(JSON.stringify(exercises.filter(exHasData))).map((e: WExercise) => ({
        ...e,
        collapsed: true,
        completed: isActivityModality ? false : e.completed,
        sets: e.sets.map((s) => ({ ...s, reps: '', load: '', duration: '' })),
      }));
      const carriedName = sessionName;
      setTimeout(() => {
        // Second leg of the partner pair: same shared group id, no schedule slot.
        setPartnerPlan({ groupId: partnerPlan.groupId, next: null });
        setPartnerAsked(true);
        set({ selectedClientId: next.id, selectedClientName: next.name, workoutScheduleId: null });
        setSessionName(carriedName); setExercises(carried); setRemark(''); setRpe(null); setDone(false); setSavedOffline(false); setSyncError(null);
        aerobicsPopulatedRef.current = null;
        // The carried list IS the partner's starting state — skip their stored
        // draft restore so it can't overwrite the carry-over.
        if (trainerId) draftCheckedRef.current = `workout-draft:${trainerId}:${next.id}`;
      }, offline ? 900 : 700);
    } else {
      // Final leg saved (solo, or both halves of a pair) → the stored pair is spent.
      AsyncStorage.removeItem('parallel_workout_session').catch(() => {});
      setTimeout(goBack, offline ? 900 : 700);
    }
  };

  /* LOCAL-FIRST submit: the log is written to the SQLite outbox (awaited) BEFORE any
     network attempt — a crash or dead network can never lose it. Then a targeted
     sync reports the truth: 'synced' ONLY when the real DB insert succeeded,
     'queued' when it's safely on-device waiting for network, 'failed' when the
     server rejected it (stays visible on Home with Retry/Edit/Discard). */
  const effectiveModality = isCustomModality ? (customModalityName.trim() || 'Custom') : (modality || 'strength');
  const submit = async (skipDupCheck = false) => {
    if (gateBlocked) {
      Alert.alert('Session limit reached', `You've already logged ${gate?.loggedCount ?? 3} ${modLabel} sessions without an approved plan. A valid training plan is required to log more. Create and get a ${modLabel} plan approved to continue.`);
      return;
    }
    if (!canSubmit || saving) return;
    // Duplicate-session guard (web): a same-day session of this modality needs an
    // explicit confirmation. Online only; edits skip it (web parity).
    if (!skipDupCheck && !editingOutboxId && getIsOnline()) {
      try {
        const dup = await checkDuplicateWorkoutToday({ clientId: selectedClientId as string, trainerId, sessionModality: sessionName.trim() || modLabel });
        if (dup) { setDupOpen(true); return; }
      } catch { /* allow on error (web parity) */ }
    }
    setSaving(true);
    setSyncError(null);
    try {
      const label = `${clientName} · ${modLabel} workout`;
      // Blank exercises are dropped HERE — before the payload is built — so they
      // never reach the outbox (offline) or the server (online).
      const submitExercises = exercises.filter(exHasData);
      let itemId: string;
      if (editingOutboxId) {
        // Edit-in-place: the queued item keeps its id, session id and ORIGINAL
        // sessionDate/createdAt — only the editable fields change.
        const existing = getOutboxItem(editingOutboxId);
        const base = (existing?.payload ?? {}) as WorkoutLogOutboxPayload;
        const updated = await updateOutboxItem(editingOutboxId, {
          label,
          payload: { ...base, sessionName: sessionName.trim() || modLabel, modality: effectiveModality, exercises: submitExercises, remark, rpe, clientName },
        });
        if (!updated) {
          // The item synced or was discarded while editing — nothing left to update.
          setSaving(false);
          set({ editingOutboxId: null });
          Alert.alert('Already synced', 'This workout already reached the server — saved logs can no longer be edited.', [{ text: 'OK', onPress: () => (canGoBack ? back() : go('dashboard')) }]);
          return;
        }
        itemId = editingOutboxId;
      } else {
        // Original device timestamp + pre-generated id: a late sync keeps THIS
        // moment as the log time, and retries can never duplicate the session.
        const payload = {
          trainerId,
          clientId: selectedClientId as string,
          clientName,
          sessionName: sessionName.trim() || modLabel,
          modality: effectiveModality,
          exercises: submitExercises,
          remark,
          rpe,
          scheduleSessionId: workoutScheduleId,
          partnerSessionGroupId: partnerPlan?.groupId ?? null,
          sessionId: uuidv4(),
          sessionDate: new Date().toISOString().slice(0, 10),
          health: offlineHealth,
        };
        const item = await enqueueOutbox('workout-log', label, payload, { autoDrain: false });
        itemId = item.id;
      }
      // From here the log is durable on-device. Now try the real sync.
      const res = await submitItem(itemId);
      if (res.status === 'synced') {
        setSavedOffline(false);
        finishAfterSave(false);
      } else if (res.status === 'queued') {
        setSavedOffline(true);
        finishAfterSave(true);
      } else {
        // Server rejection: stays safely queued on this device, shown on Home.
        setSyncError(res.error ?? 'The server rejected this log.');
        if (editingOutboxId) set({ editingOutboxId: null });
      }
    } finally {
      setSaving(false);
    }
  };

  if (!selectedClientId) {
    return (
      <Page gap={16} pt={6}>
        <View style={{ alignItems: 'center', gap: 12, paddingVertical: 50 }}>
          <Icon name="user" size={30} color="#4C4640" strokeWidth={1.6} />
          <Serif style={{ fontSize: 19 }}>No client selected</Serif>
          <Body style={{ fontSize: 13, color: C.muted3, textAlign: 'center', paddingHorizontal: 30 }}>Open a session from Today's Roster or a client page to log a workout.</Body>
        </View>
      </Page>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <Page gap={14} pt={6} pb={120 + (Platform.OS === 'android' ? kbH : 0)} kbAware>
        <BackLink label="Log Workout" onPress={goBack} />
        {/* Parallel / couple tabs (web ParallelWorkoutTabs): primary client + "+ Add
            Client" (or the chosen second client). One shared group id → one package
            deduction; save A → the form auto-switches to B. */}
        {!editingOutboxId ? (
          <View style={{ gap: 6 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {/* Tab 1 — primary */}
              <View style={{ flex: 1.2, flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 13, backgroundColor: pairLeg === 'first' ? hexA(C.orange, 0.14) : hexA(C.green, 0.08), borderWidth: 1, borderColor: pairLeg === 'first' ? hexA(C.orange, 0.45) : hexA(C.green, 0.35) }}>
                {pairLeg === 'second' ? (
                  <Icon name="checks" size={13} color={C.green} strokeWidth={2.6} />
                ) : (
                  <Icon name="user" size={13} color={C.orange} strokeWidth={2.2} />
                )}
                <Text numberOfLines={1} style={{ flex: 1, fontFamily: F.bodyBold, fontSize: 12, color: pairLeg === 'first' ? C.orange : C.green }}>
                  {pairNames ? pairNames.primary.name : clientName}
                </Text>
                {pairLeg === 'second' ? <Mono style={{ fontSize: 7, color: C.green }}>SAVED</Mono> : null}
              </View>
              {/* Tab 2 — add / second client */}
              {pairNames ? (
                <View style={{ flex: 1.2, flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 13, backgroundColor: pairLeg === 'second' ? hexA(C.orange, 0.14) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: pairLeg === 'second' ? hexA(C.orange, 0.45) : hexA(C.purple, 0.35) }}>
                  <Icon name="userPlus" size={13} color={pairLeg === 'second' ? C.orange : C.purple} strokeWidth={2.2} />
                  <Text numberOfLines={1} style={{ flex: 1, fontFamily: F.bodyBold, fontSize: 12, color: pairLeg === 'second' ? C.orange : '#C9B8F5' }}>{pairNames.second.name}</Text>
                  {pairLeg === 'first' ? (
                    <>
                      <Mono style={{ fontSize: 7, color: C.muted3 }}>NEXT</Mono>
                      <Pressable onPress={removePair} hitSlop={8} style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: hexA(C.red, 0.14), alignItems: 'center', justifyContent: 'center' }}>
                        <Icon name="close" size={9} color={C.red} strokeWidth={2.6} />
                      </Pressable>
                    </>
                  ) : null}
                </View>
              ) : (
                <Pressable onPress={() => { setPairSearch(''); setPairPickerOpen(true); }} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.22)' }}>
                  <Icon name="userPlus" size={13} color={C.muted} strokeWidth={2.2} />
                  <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: C.muted }}>Add Client</Text>
                </Pressable>
              )}
            </View>
            {pairNames ? (
              <Body style={{ fontSize: 10, color: C.muted3, paddingLeft: 3 }}>
                {pairLeg === 'first'
                  ? `Parallel session — after saving ${pairNames.primary.name.split(' ')[0]}'s log, the form switches to ${pairNames.second.name.split(' ')[0]}. The pair shares one package session.`
                  : `Second leg — ${pairNames.primary.name.split(' ')[0]}'s exercises are pre-selected; enter ${pairNames.second.name.split(' ')[0]}'s values (add or remove exercises freely).`}
              </Body>
            ) : null}
          </View>
        ) : null}
      {/* Parallel-client picker (web ParallelWorkoutTabs "+ Add Client") */}
      <Modal visible={pairPickerOpen} transparent animationType="slide" onRequestClose={() => setPairPickerOpen(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable onPress={() => setPairPickerOpen(false)} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)' }} />
          <View style={{ maxHeight: '78%', backgroundColor: C.sheetBg, borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.14)', paddingHorizontal: 18, paddingTop: 12, paddingBottom: insets.bottom + 16 }}>
            <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.14)', marginBottom: 12 }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <View style={{ width: 34, height: 34, borderRadius: 12, backgroundColor: hexA(C.purple, 0.14), alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="userPlus" size={15} color={C.purple} strokeWidth={2.1} />
              </View>
              <View style={{ flex: 1 }}>
                <Serif style={{ fontSize: 18 }}>Add Parallel Client</Serif>
                <Body style={{ fontSize: 11, color: C.muted2 }}>Log a second session alongside {clientName.split(' ')[0]} — one shared package session.</Body>
              </View>
              <Pressable onPress={() => setPairPickerOpen(false)} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="close" size={13} color="#B8B2AC" strokeWidth={2.3} />
              </Pressable>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', marginBottom: 10 }}>
              <Icon name="search" size={14} color={C.muted3} strokeWidth={2} />
              <TextInput value={pairSearch} onChangeText={setPairSearch} placeholder="Search your clients…" placeholderTextColor={C.muted3} autoCorrect={false} style={{ flex: 1, fontFamily: F.body, fontSize: 13.5, color: '#fff', padding: 0 }} />
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {(myClientsQ.data ?? [])
                .filter((c) => c.client_id !== selectedClientId)
                .filter((c) => !pairSearch.trim() || c.full_name.toLowerCase().includes(pairSearch.trim().toLowerCase()))
                .map((c) => (
                  <Pressable
                    key={c.client_id}
                    onPress={() => { startPair({ id: c.client_id, name: c.full_name }); setPairPickerOpen(false); }}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' }}
                  >
                    <Avatar initial={initials(c.full_name)} size={34} colors={['#7C8FE8', '#9A7BEA']} fontSize={12} />
                    <View style={{ flex: 1 }}>
                      <Body numberOfLines={1} style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{c.full_name}</Body>
                      {c.subscription_type ? <Body style={{ fontSize: 10, color: C.muted3, marginTop: 1 }}>{c.subscription_type}</Body> : null}
                    </View>
                    <Icon name="chevRight" size={13} color={C.muted3} strokeWidth={2.2} />
                  </Pressable>
                ))}
              {myClientsQ.isLoading ? <ActivityIndicator color={C.orange} style={{ paddingVertical: 20 }} /> : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
        {/* Plan gate: without an approved valid plan for this modality, only 3 sessions may be logged. */}
        {gate && !gate.hasValidPlan ? (
          gate.blocked ? (
            <View style={{ borderRadius: 16, backgroundColor: hexA(C.red, 0.1), borderWidth: 1, borderColor: hexA(C.red, 0.4), padding: 14, gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                <Icon name="alert" size={18} color={C.red} strokeWidth={2} />
                <Text style={{ flex: 1, fontFamily: F.bodyBold, fontSize: 14.5, color: C.red }}>Session limit reached</Text>
              </View>
              <Body style={{ fontSize: 12.5, color: C.ink3, lineHeight: 18 }}>
                You've logged {gate.loggedCount} {modLabel} sessions for {clientName} without an approved training plan. An approved {modLabel} plan is required to log more.
              </Body>
              <Pressable onPress={() => go('create-plan')}>
                <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 11, borderRadius: 12 }}>
                  <Icon name="plus" size={14} color="#fff" strokeWidth={2.8} />
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: '#fff' }}>Create Training Plan</Text>
                </LinearGradient>
              </Pressable>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, backgroundColor: hexA(gate.warning ? C.gold : C.blue, 0.09), borderWidth: 1, borderColor: hexA(gate.warning ? C.gold : C.blue, 0.28), padding: 12 }}>
              <Icon name={gate.warning ? 'alert' : 'file'} size={16} color={gate.warning ? C.gold : C.blue} strokeWidth={2} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: gate.warning ? C.gold : C.blue }}>
                  {gate.warning ? `Approaching limit · ${gate.loggedCount}/${gate.limit}` : `No approved ${modLabel} plan`}
                </Text>
                <Body style={{ fontSize: 11, color: C.muted2, marginTop: 2 }}>
                  {gate.remaining} plan-less session{gate.remaining === 1 ? '' : 's'} left before a plan is required.
                </Body>
              </View>
            </View>
          )
        ) : null}
        {/* Session setup */}
        <Card colors={['rgba(50,30,19,0.45)', 'rgba(18,14,14,0.5)']} radius={20} style={{ padding: 18, gap: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Icon name="dumbbell" size={17} color={C.orange} strokeWidth={1.9} />
            <Mono style={{ fontSize: 11, letterSpacing: 1.4, color: C.mono }}>NEW SESSION</Mono>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' }}>
            <Avatar initial={initials(clientName)} size={40} colors={['#7C8FE8', '#9A7BEA']} fontSize={14} />
            <View style={{ flex: 1 }}>
              <Body style={{ fontSize: 15, fontFamily: F.bodySemi, color: '#fff' }}>{clientName}</Body>
              <Body style={{ fontSize: 12, color: C.muted }}>{workoutScheduleId ? 'From today\'s roster' : 'Trial / ad-hoc session'}</Body>
            </View>
          </View>
          {!gateBlocking ? (
            <>
              {/* Health check-in summary (server data, or values entered offline) */}
              {health || offlineHealth ? (
                <View style={{ flexDirection: 'row', gap: 7 }}>
                  {[
                    { icon: 'sparkle' as const, col: C.gold, text: `${health?.sleepHours ?? offlineHealth?.hoursSlept ?? '—'}h sleep` },
                    { icon: 'heart' as const, col: C.green, text: `${health?.nutritionRating ?? offlineHealth?.nutritionRating ?? '—'}/10 diet` },
                    { icon: 'activity' as const, col: C.blue, text: `${health?.stepsCount ?? offlineHealth?.stepsCount ?? '—'} steps` },
                  ].map((c) => (
                    <View key={c.icon} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8, borderRadius: 11, backgroundColor: hexA(c.col, 0.07), borderWidth: 1, borderColor: hexA(c.col, 0.2) }}>
                      <Icon name={c.icon} size={12} color={c.col} strokeWidth={2} />
                      <Text numberOfLines={1} style={{ fontFamily: F.bodySemi, fontSize: 11.5, color: c.col }}>{c.text}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
              {/* Modality — ✓ marks modalities with a valid approved plan (web parity) */}
              <View>
                <Mono style={{ fontSize: 10, letterSpacing: 1.2, color: C.mono2, marginBottom: 8 }}>MODALITY</Mono>
                <HScroll>
                  {[...modalities, ...(customAvailable ? ['custom'] : [])].map((m) => {
                    const active = (modality || 'strength').toLowerCase() === m.toLowerCase();
                    const planned = hasPlanFor(m);
                    const label = `${planned ? '✓ ' : ''}${m.replace(/\b\w/g, (c) => c.toUpperCase())}`;
                    return active ? (
                      <LinearGradient key={m} colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ paddingVertical: 9, paddingHorizontal: 16, borderRadius: 999 }}><Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: '#fff' }}>{label}</Text></LinearGradient>
                    ) : (
                      <Pressable key={m} onPress={() => set({ modality: m })} style={{ paddingVertical: 9, paddingHorizontal: 16, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: planned ? 1 : 0, borderColor: planned ? hexA(C.green, 0.35) : 'transparent' }}><Text style={{ fontFamily: F.body, fontSize: 13, color: planned ? C.green : C.muted }}>{label}</Text></Pressable>
                    );
                  })}
                </HScroll>
              </View>
              {/* Custom modality name (web: required, becomes the row modality) */}
              {isCustomModality ? (
                <View>
                  <Mono style={{ fontSize: 10, letterSpacing: 1.2, color: C.mono2, marginBottom: 8 }}>CUSTOM MODALITY NAME *</Mono>
                  <TextInput
                    value={customModalityName}
                    onChangeText={setCustomModalityName}
                    placeholder="e.g. HIIT, CrossFit, Dance"
                    placeholderTextColor={C.muted3}
                    style={{ paddingVertical: 13, paddingHorizontal: 14, borderRadius: 13, borderWidth: 1, borderColor: customModalityName.trim() ? hexA(C.orange, 0.4) : 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.03)', color: '#fff', fontFamily: F.body, fontSize: 15 }}
                  />
                </View>
              ) : null}
              {/* Session name / body part — plan body parts become one-tap options that
                  pre-populate the plan's exercises (web Workout Name selector) */}
              <View>
                <Mono style={{ fontSize: 10, letterSpacing: 1.2, color: C.mono2, marginBottom: 8 }}>SESSION NAME / BODY PART</Mono>
                {planBodyParts.length > 0 && !isActivityModality && !isAerobicsModality ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 9 }}>
                    {planBodyParts.map((bp) => {
                      const activeBp = sessionName === bp;
                      return (
                        <Pressable key={bp} onPress={() => populateFromPlan(bp)} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 7, paddingHorizontal: 13, borderRadius: 999, backgroundColor: activeBp ? hexA(C.orange, 0.16) : hexA(C.blue, 0.07), borderWidth: 1, borderColor: activeBp ? hexA(C.orange, 0.5) : hexA(C.blue, 0.28) }}>
                          <Icon name="file" size={11} color={activeBp ? C.orange : C.blue} strokeWidth={2.2} />
                          <Text style={{ fontFamily: activeBp ? F.bodyBold : F.bodySemi, fontSize: 12, color: activeBp ? C.orange : '#A9BCFF' }}>{bp}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}
                <TextInput
                  value={sessionName}
                  onChangeText={setSessionName}
                  placeholder="e.g. Legs, Push, Full Body"
                  placeholderTextColor={C.muted3}
                  style={{ paddingVertical: 13, paddingHorizontal: 14, borderRadius: 13, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.03)', color: '#fff', fontFamily: F.body, fontSize: 15 }}
                />
                {planBodyParts.length > 0 && !isActivityModality && !isAerobicsModality ? (
                  <Body style={{ fontSize: 10.5, color: C.muted3, marginTop: 6 }}>Tap a body part to load the approved plan's exercises with targets.</Body>
                ) : null}
              </View>
            </>
          ) : null}
        </Card>

        {gateBlocking ? (
          <Card colors={['rgba(56,34,21,0.5)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.12)" radius={22} style={{ padding: 24, alignItems: 'center', gap: 16, marginTop: 8 }}>
            {/* Icon chips */}
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <LinearGradient colors={['#E8B44A', '#B5852A']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="sparkle" size={26} color="#fff" strokeWidth={2} />
              </LinearGradient>
              <LinearGradient colors={['#57C98A', '#2E8A5B']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center', marginLeft: -14, borderWidth: 3, borderColor: '#151010' }}>
                <Icon name="heart" size={26} color="#fff" strokeWidth={2} />
              </LinearGradient>
            </View>

            <View style={{ alignItems: 'center', gap: 6 }}>
              <Mono style={{ fontSize: 10, letterSpacing: 1.6, color: C.mono2 }}>STEP 1 OF 2 · HEALTH CHECK-IN</Mono>
              <Serif style={{ fontSize: 22 }}>Quick check-in first</Serif>
              <Body style={{ fontSize: 13, color: C.muted2, textAlign: 'center', lineHeight: 19 }}>
                Log {clientName}'s sleep, nutrition and steps — the workout log unlocks right after.
              </Body>
            </View>

            {/* What's needed checklist — only the items actually missing */}
            <View style={{ width: '100%', gap: 9, marginTop: 2 }}>
              {[
                // Offline with nothing cached ⇒ everything is required (no bypass).
                { label: 'Sleep hours (last night)', missing: health ? !!health.sleepMissing : healthUnknown, icon: 'sparkle' as const, col: C.gold },
                { label: 'Nutrition rating (yesterday)', missing: health ? !!health.nutritionMissing : healthUnknown, icon: 'heart' as const, col: C.green },
                { label: 'Steps count (yesterday)', missing: health ? !!health.stepsMissing : healthUnknown, icon: 'activity' as const, col: C.blue },
              ].filter((it) => it.missing).map((it) => (
                <View key={it.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 11, paddingHorizontal: 13, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: hexA(C.red, 0.25) }}>
                  <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: hexA(it.col, 0.13), alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name={it.icon} size={15} color={it.col} strokeWidth={2} />
                  </View>
                  <Body style={{ flex: 1, fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{it.label}</Body>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.red }} />
                    <Text style={{ fontFamily: F.bodySemi, fontSize: 11.5, color: '#E0A090' }}>Missing</Text>
                  </View>
                </View>
              ))}
            </View>

            <Pressable
              onPress={() => {
                // Prefill anything already logged so only the missing field needs input.
                setHSleep(health?.sleepHours != null ? String(health.sleepHours) : '');
                setHRating(health?.nutritionRating ?? null);
                setHSteps(health?.stepsCount != null ? String(health.stepsCount) : '');
                setHealthOpen(true);
              }}
              style={{ width: '100%', marginTop: 4 }}
            >
              <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 15, borderRadius: 14 }}>
                <Icon name="plus" size={16} color="#fff" strokeWidth={2.8} />
                <Text style={{ fontFamily: F.bodyBold, fontSize: 14.5, color: '#fff' }}>Add Health Data</Text>
              </LinearGradient>
            </Pressable>
          </Card>
        ) : (
        <>
        {/* Exercises */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 2 }}>
          <Mono style={{ fontSize: 10, letterSpacing: 1.4, color: C.mono2 }}>EXERCISES{exercises.length ? ` · ${exercises.length}` : ''}</Mono>
          <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.06)' }} />
          <Pressable onPress={() => { setTplSaveMode(false); setTemplatesOpen(true); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999, backgroundColor: hexA(C.gold, 0.1), borderWidth: 1, borderColor: hexA(C.gold, 0.3) }}>
            <Icon name="file" size={12} color={C.gold} strokeWidth={2} />
            <Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: C.gold }}>Templates</Text>
          </Pressable>
        </View>
        {exercises.map((ex, ei) => (
          <Card key={ei} colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} radius={20} style={{ padding: 16, gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              {/* Tap the name row to expand/collapse the card — added exercises start
                  collapsed so a long list stays scannable. */}
              <Pressable onPress={() => updateEx(ei, { collapsed: !ex.collapsed })} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ width: 26, height: 26, borderRadius: 8, backgroundColor: hexA(C.orange, 0.13), alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontFamily: F.mono, fontSize: 12, color: C.orange }}>{ei + 1}</Text>
                </View>
                <Body style={{ flex: 1, fontSize: 15, fontFamily: F.bodySemi, color: '#fff' }} numberOfLines={1}>{ex.name}</Body>
                {ex.collapsed ? (
                  <>
                    {!isActivityModality ? (
                      <View style={{ paddingVertical: 3, paddingHorizontal: 8, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
                        <Text style={{ fontFamily: F.bodySemi, fontSize: 9.5, color: C.muted2 }}>{ex.sets.length} set{ex.sets.length === 1 ? '' : 's'}</Text>
                      </View>
                    ) : null}
                    {(isActivityModality ? !ex.completed : ex.sets.some((s) => setIncomplete(ex, s))) ? (
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.gold }} />
                    ) : (
                      <Icon name="checks" size={13} color={C.green} strokeWidth={2.5} />
                    )}
                  </>
                ) : null}
                {isActivityModality && ex.activityType && !ex.collapsed ? (
                  <View style={{ paddingVertical: 3, paddingHorizontal: 9, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
                    <Text style={{ fontFamily: F.bodySemi, fontSize: 10, color: C.muted2 }}>{ex.activityType}</Text>
                  </View>
                ) : null}
                <Icon name={ex.collapsed ? 'chevDown' : 'chevUp'} size={13} color={C.muted3} strokeWidth={2.3} />
              </Pressable>
              <Pressable onPress={() => removeExercise(ei)} hitSlop={8}><Icon name="close" size={16} color={C.muted2} strokeWidth={2.2} /></Pressable>
            </View>

            {ex.collapsed ? null : isActivityModality ? (
              <>
                {/* Mark as completed — the activity model (Yoga/Boxing) */}
                <Pressable onPress={() => updateEx(ei, { completed: !ex.completed })} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 }}>
                  <View style={{ width: 24, height: 24, borderRadius: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: ex.completed ? C.green : 'rgba(255,255,255,0.05)', borderWidth: 1.5, borderColor: ex.completed ? C.green : 'rgba(255,255,255,0.18)' }}>
                    {ex.completed ? <Icon path="M20 6 9 17l-5-5" size={14} color="#0c0808" strokeWidth={3} /> : null}
                  </View>
                  <Text style={{ fontFamily: F.bodySemi, fontSize: 13.5, color: ex.completed ? '#fff' : C.muted }}>Mark as completed</Text>
                </Pressable>
                {isBoxingModality && ex.completed ? (
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Mono style={{ fontSize: 9, letterSpacing: 0.8, color: C.mono2, marginBottom: 5 }}>DURATION (MIN)</Mono>
                      <TextInput value={ex.durationMin ?? ''} onChangeText={(t) => { const v = t.replace(/[^0-9]/g, ''); updateEx(ei, { durationMin: v || (t.trim() ? ex.durationMin ?? '' : '') }); }} keyboardType="number-pad" placeholder="—" placeholderTextColor={C.muted3} style={[cellInput, { textAlign: 'left', paddingHorizontal: 12 }]} />
                    </View>
                    {/^.*pad ?work.*$/i.test(ex.name) ? (
                      <View style={{ flex: 1 }}>
                        <Mono style={{ fontSize: 9, letterSpacing: 0.8, color: C.mono2, marginBottom: 5 }}>ROUNDS</Mono>
                        <TextInput value={ex.rounds ?? ''} onChangeText={(t) => { const v = t.replace(/[^0-9]/g, ''); updateEx(ei, { rounds: v || (t.trim() ? ex.rounds ?? '' : '') }); }} keyboardType="number-pad" placeholder="—" placeholderTextColor={C.muted3} style={[cellInput, { textAlign: 'left', paddingHorizontal: 12 }]} />
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </>
            ) : (
              <>
                <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 2 }}>
                  <Text style={[colHead, { width: 30 }]}>SET</Text>
                  <Text style={[colHead, { flex: 1 }]}>{ex.measurement === 'duration' ? (isAerobicsModality ? 'DURATION (MIN)' : 'DURATION (SEC)') : 'REPS'}</Text>
                  {!isAerobicsModality ? <Text style={[colHead, { flex: 1 }]}>LOAD (KG)</Text> : null}
                  <View style={{ width: 26 }} />
                </View>
                {ex.sets.map((st, si) => {
                  const missing = setIncomplete(ex, st); // primary metric empty → must be filled to log
                  const prevSets = prevSetsFor(ex.name);
                  const prevSet = prevSets?.[si];
                  // Placeholders: the plan target, else the last session's value (web parity).
                  const metricPh = ex.measurement === 'duration'
                    ? (st.durationPlan ? `Plan ${st.durationPlan}` : prevSet?.durationSeconds != null ? `Last: ${prevSet.durationSeconds}s` : '—')
                    : (st.repsPlan ? `Plan ${st.repsPlan}` : prevSet?.reps != null ? `Last: ${prevSet.reps}` : '—');
                  const loadPh = st.loadPlan ? `Plan ${st.loadPlan}` : prevSet?.load ? `Last: ${prevSet.load}` : '—';
                  // ≥2× sanity warning (warn-only, web getDoubleValueWarning): vs previous
                  // set, or the last session's first set for set #1.
                  const warnFor = (field: 'reps' | 'load'): string | null => {
                    const cur = parseFloat(field === 'reps' ? st.reps : st.load);
                    if (!isFinite(cur) || cur === 0) return null;
                    let ref: number | null = null;
                    if (si > 0) {
                      const p = ex.sets[si - 1];
                      const v = parseFloat(field === 'reps' ? p.reps : p.load);
                      if (isFinite(v) && v > 0) ref = v;
                    } else {
                      const p0 = prevSets?.[0];
                      const v = field === 'reps' ? p0?.reps : p0?.load != null ? parseFloat(String(p0.load)) : null;
                      if (v != null && isFinite(Number(v)) && Number(v) > 0) ref = Number(v);
                    }
                    if (ref != null && cur >= ref * 2) return `${field === 'reps' ? 'Reps' : 'Load'} is ${Math.round(cur / ref)}× the ${si > 0 ? 'previous set' : 'last session'} (${ref}) — is this correct?`;
                    return null;
                  };
                  const warn = warnFor('reps') ?? warnFor('load');
                  return (
                  <View key={si} style={{ gap: 6 }}>
                    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                      <View style={[cell, { width: 30, backgroundColor: 'rgba(255,255,255,0.04)' }]}><Text style={{ fontFamily: F.mono, fontSize: 13, color: C.muted }}>{si + 1}</Text></View>
                      {/* Keyboard-suggestion guard: an Android suggestion tap REPLACES the
                          field text with a word; stripped to digits that becomes '' and
                          silently wiped the typed value. Non-empty input that strips to
                          nothing now keeps the previous value (backspace still clears). */}
                      {ex.measurement === 'duration' ? (
                        <TextInput value={st.duration} onChangeText={(t) => { const v = t.replace(/[^0-9]/g, ''); updateSet(ei, si, { duration: v || (t.trim() ? st.duration : '') }); }} keyboardType="number-pad" placeholder={metricPh} placeholderTextColor={missing ? hexA(C.gold, 0.8) : C.muted3} style={[cellInput, missing ? { borderWidth: 1, borderColor: hexA(C.gold, 0.4) } : null]} />
                      ) : (
                        <TextInput value={st.reps} onChangeText={(t) => { const v = t.replace(/[^0-9]/g, ''); updateSet(ei, si, { reps: v || (t.trim() ? st.reps : '') }); }} keyboardType="number-pad" placeholder={metricPh} placeholderTextColor={missing ? hexA(C.gold, 0.8) : C.muted3} style={[cellInput, missing ? { borderWidth: 1, borderColor: hexA(C.gold, 0.4) } : null]} />
                      )}
                      {!isAerobicsModality ? (
                        // Free text (web parity): bodyweight expressions like "BW+5" are valid loads.
                        <TextInput value={st.load} onChangeText={(t) => updateSet(ei, si, { load: t })} autoCapitalize="characters" autoCorrect={false} placeholder={loadPh} placeholderTextColor={C.muted3} style={cellInput} />
                      ) : null}
                      <Pressable onPress={() => removeSet(ei, si)} disabled={ex.sets.length === 1} style={{ width: 26, alignItems: 'center', opacity: ex.sets.length === 1 ? 0.3 : 1 }} hitSlop={6}>
                        <Icon name="close" size={13} color={C.muted2} strokeWidth={2.2} />
                      </Pressable>
                    </View>
                    {warn ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 2 }}>
                        <Icon name="alert" size={11} color={C.gold} strokeWidth={2.2} />
                        <Body style={{ flex: 1, fontSize: 10.5, color: C.gold }}>{warn}</Body>
                      </View>
                    ) : null}
                    {ex.detailsOpen && !isAerobicsModality ? (
                      <View style={{ flexDirection: 'row', gap: 6, paddingLeft: 38 }}>
                        <TextInput value={st.rest ?? ''} onChangeText={(t) => { const v = t.replace(/[^0-9]/g, ''); updateSet(ei, si, { rest: v || (t.trim() ? st.rest ?? '' : '') }); }} keyboardType="number-pad" placeholder={prevSet?.rest ? `Rest ${prevSet.rest}` : 'Rest (s)'} placeholderTextColor={C.muted3} style={[cellInput, { flex: 1 }]} />
                        <TextInput value={st.tempo ?? ''} onChangeText={(t) => updateSet(ei, si, { tempo: t })} autoCorrect={false} placeholder={prevSet?.tempo ? `Tempo ${prevSet.tempo}` : 'Tempo 2-1-2-1'} placeholderTextColor={C.muted3} style={[cellInput, { flex: 1.2 }]} />
                        <TextInput value={st.superset ?? ''} onChangeText={(t) => updateSet(ei, si, { superset: t })} autoCapitalize="characters" autoCorrect={false} placeholder="SS A1" placeholderTextColor={C.muted3} style={[cellInput, { width: 62 }]} />
                      </View>
                    ) : null}
                    {ex.detailsOpen && !isAerobicsModality ? (
                      <View style={{ flexDirection: 'row', gap: 6, paddingLeft: 38 }}>
                        <TextInput value={st.note ?? ''} onChangeText={(t) => updateSet(ei, si, { note: t })} placeholder="Set notes" placeholderTextColor={C.muted3} style={[cellInput, { flex: 1, textAlign: 'left', paddingHorizontal: 12 }]} />
                      </View>
                    ) : null}
                    {ex.detailsOpen && isPilatesModality ? (
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingLeft: 38 }}>
                        {PILATES_EQUIPMENT.map((eq) => {
                          const sel = st.equipment === eq;
                          return (
                            <Pressable key={eq} onPress={() => updateSet(ei, si, { equipment: sel ? '' : eq })} style={{ paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999, backgroundColor: sel ? hexA(C.purple, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: sel ? hexA(C.purple, 0.45) : 'rgba(255,255,255,0.08)' }}>
                              <Text style={{ fontFamily: sel ? F.bodyBold : F.body, fontSize: 10.5, color: sel ? C.purple : C.muted }}>{eq}</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    ) : null}
                  </View>
                  );
                })}
                {ex.sets.some((s) => setIncomplete(ex, s)) ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 2 }}>
                    <Icon name="alert" size={11} color={C.gold} strokeWidth={2.2} />
                    <Body style={{ flex: 1, fontSize: 10.5, color: C.gold }}>Every set needs {ex.measurement === 'duration' ? 'duration' : 'reps'} before you can log — load is optional for bodyweight.</Body>
                  </View>
                ) : null}
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Pressable onPress={() => addSet(ei)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 10, borderRadius: 11, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.13)' }}>
                    <Icon name="plus" size={14} color={C.muted} strokeWidth={2.2} />
                    <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: C.muted }}>Add set</Text>
                  </Pressable>
                  {!isAerobicsModality ? (
                    <Pressable onPress={() => updateEx(ei, { detailsOpen: !ex.detailsOpen })} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 11, backgroundColor: ex.detailsOpen ? hexA(C.blue, 0.1) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: ex.detailsOpen ? hexA(C.blue, 0.35) : 'rgba(255,255,255,0.09)' }}>
                      <Icon name={ex.detailsOpen ? 'chevUp' : 'chevDown'} size={12} color={ex.detailsOpen ? C.blue : C.muted} strokeWidth={2.3} />
                      <Text style={{ fontFamily: F.bodySemi, fontSize: 11.5, color: ex.detailsOpen ? C.blue : C.muted }}>Details</Text>
                    </Pressable>
                  ) : null}
                </View>
              </>
            )}
          </Card>
        ))}

        {exercises.length === 0 ? (
          <View style={{ alignItems: 'center', gap: 6, paddingVertical: 18 }}>
            <Icon name="dumbbell" size={26} color="#4C4640" strokeWidth={1.6} />
            <Body style={{ fontSize: 13, color: C.muted3 }}>No exercises yet — add one below.</Body>
          </View>
        ) : null}

        <Pressable onPress={() => { setExSearch(''); setCustomFormOpen(false); setCustomName(''); setPickerOpen(true); }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 15, borderRadius: 14, borderWidth: 1.5, borderStyle: 'dashed', borderColor: hexA(C.orange, 0.32), backgroundColor: hexA(C.orange, 0.05) }}>
          <Icon name="plus" size={16} color={C.orange} strokeWidth={2.6} />
          <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: C.orange }}>Add Exercise</Text>
        </Pressable>

        {/* Wrap up — RPE (required) + remarks (optional) */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 2 }}>
          <Mono style={{ fontSize: 10, letterSpacing: 1.4, color: C.mono2 }}>WRAP UP</Mono>
          <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.06)' }} />
        </View>
        <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} radius={20} style={{ padding: 16, gap: 13 }}>
          {(() => {
            const rpeColor = (n: number) => (n <= 3 ? C.green : n <= 5 ? '#9BCB4A' : n <= 7 ? C.gold : n <= 8 ? C.orange : C.red);
            const rpeLabel = (n: number) => (n <= 2 ? 'Very Easy' : n <= 4 ? 'Easy' : n <= 6 ? 'Moderate' : n <= 8 ? 'Hard' : n === 9 ? 'Very Hard' : 'Maximal');
            return (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Mono style={{ fontSize: 10, letterSpacing: 1.2, color: C.mono2 }}>SESSION RPE</Mono>
                    <Body style={{ fontSize: 11, color: C.muted3, marginTop: 2 }}>Rate of Perceived Exertion · 1–10</Body>
                  </View>
                  {rpe == null ? <Body style={{ fontSize: 11.5, color: C.muted3 }}>Required</Body> : null}
                </View>
                {/* Slider — live value shown inside; drag for 0.5 steps, tap ± for fine control */}
                <RpeSlider value={rpe} onChange={setRpe} colorFn={rpeColor} labelFn={rpeLabel} />
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Pressable onPress={() => setRpe(Math.max(1, Math.round(rpe ?? 5) - 1))} style={{ width: 42, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)' }}>
                    <Icon path="M5 12h14" size={16} color={C.ink3} strokeWidth={2.6} />
                  </Pressable>
                  <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 2 }}>
                    <Mono style={{ fontSize: 9, color: C.muted3 }}>1 · EASY</Mono>
                    <Mono style={{ fontSize: 9, color: C.muted3 }}>5 · MODERATE</Mono>
                    <Mono style={{ fontSize: 9, color: C.muted3 }}>10 · MAX</Mono>
                  </View>
                  <Pressable onPress={() => setRpe(Math.min(10, Math.round(rpe ?? 5) + 1))} style={{ width: 42, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)' }}>
                    <Icon name="plus" size={16} color={C.ink3} strokeWidth={2.6} />
                  </Pressable>
                </View>
              </>
            );
          })()}
          <View style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.06)', marginVertical: 2 }} />
          <Mono style={{ fontSize: 10, letterSpacing: 1.2, color: C.mono2 }}>SESSION REMARKS</Mono>
          <TextInput
            value={remark}
            onChangeText={setRemark}
            placeholder="How did the session go? (optional)"
            placeholderTextColor={C.muted3}
            multiline
            style={{ minHeight: 64, textAlignVertical: 'top', paddingVertical: 12, paddingHorizontal: 13, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.03)', color: '#fff', fontFamily: F.body, fontSize: 14 }}
          />
        </Card>
        </>
        )}

        {syncError ? (
          <View style={{ padding: 12, borderRadius: 12, backgroundColor: hexA(C.red, 0.08), borderWidth: 1, borderColor: hexA(C.red, 0.28), gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Icon name="alert" size={14} color={C.red} strokeWidth={2.2} />
              <Body style={{ flex: 1, fontSize: 12, fontFamily: F.bodySemi, color: '#E0A090' }}>Sync failed — the log is saved on this device</Body>
            </View>
            <Body style={{ fontSize: 11.5, color: '#E0A090' }}>{syncError}</Body>
            <Body style={{ fontSize: 11, color: C.muted2 }}>Find it on Home → Waiting to Sync to edit, retry or discard.</Body>
          </View>
        ) : null}
      </Page>

      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 18, paddingTop: 12, paddingBottom: insets.bottom + 14, backgroundColor: 'rgba(8,6,6,0.96)', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' }}>
        {missingHint ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 9 }}>
            <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: C.gold }} />
            <Body style={{ flex: 1, fontSize: 11.5, color: C.muted2 }}>{missingHint}</Body>
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {gateBlocking ? (
            <Pressable onPress={goBack} style={{ flex: 1, alignItems: 'center', paddingVertical: 15, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 14, color: C.ink3 }}>Cancel</Text>
            </Pressable>
          ) : (
            <>
              <Pressable onPress={goBack} style={{ paddingVertical: 15, paddingHorizontal: 20, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
                <Text style={{ fontFamily: F.bodySemi, fontSize: 14, color: C.ink3 }}>Cancel</Text>
              </Pressable>
              <Pressable onPress={() => (blankExercises.length ? setBlankOpen(true) : setConfirmOpen(true))} disabled={!canSubmit} style={{ flex: 1, opacity: canSubmit ? 1 : 0.5 }}>
                <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 15, borderRadius: 14 }}>
                  <Icon name="checks" path={done ? 'M20 6 9 17l-5-5' : undefined} size={16} color="#fff" strokeWidth={2.6} />
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 14.5, color: '#fff' }}>
                    {saving ? 'Saving…' : done ? (savedOffline ? 'Saved on device ✓ syncs later' : 'Synced to server ✓') : editingOutboxId ? 'Update Pending Log' : 'Submit Workout'}
                  </Text>
                </LinearGradient>
              </Pressable>
            </>
          )}
        </View>
      </View>

      {/* Training-partner prompt (web TrainingPartnerPromptDialog) */}
      <Modal visible={partnerPromptVisible} transparent animationType="fade" onRequestClose={() => setPartnerAsked(true)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center', padding: 22 }}>
          <View style={{ width: '100%', maxWidth: 350, backgroundColor: '#12100E', borderWidth: 1, borderColor: hexA(C.purple, 0.3), borderRadius: 20, padding: 20, gap: 13 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: hexA(C.purple, 0.14), alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="users" size={17} color={C.purple} strokeWidth={2} />
              </View>
              <Serif style={{ flex: 1, fontSize: 19 }}>Training partner</Serif>
            </View>
            <Body style={{ fontSize: 12.5, color: C.ink3, lineHeight: 19 }}>
              {clientName} trains with <Text style={{ fontFamily: F.bodySemi, color: '#fff' }}>{partnerQ.data?.name}</Text>. Log {partnerQ.data?.name}'s session too? The pair shares one package session.
            </Body>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable onPress={() => setPartnerAsked(true)} style={{ flex: 1, alignItems: 'center', paddingVertical: 13, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
                <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: C.ink }}>Just {clientName.split(' ')[0]}</Text>
              </Pressable>
              <Pressable onPress={() => { if (partnerQ.data) startPair(partnerQ.data); }} style={{ flex: 1, alignItems: 'center', paddingVertical: 13, borderRadius: 13, backgroundColor: hexA(C.purple, 0.16), borderWidth: 1, borderColor: hexA(C.purple, 0.45) }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: C.purple }}>Yes, log both</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Duplicate-session confirmation (web DuplicateWorkoutSessionDialog) */}
      <Modal visible={dupOpen} transparent animationType="fade" onRequestClose={() => setDupOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center', padding: 22 }}>
          <View style={{ width: '100%', maxWidth: 350, backgroundColor: '#12100E', borderWidth: 1, borderColor: hexA(C.gold, 0.35), borderRadius: 20, padding: 20, gap: 13 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: hexA(C.gold, 0.14), alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="alert" size={17} color={C.gold} strokeWidth={2.2} />
              </View>
              <Serif style={{ flex: 1, fontSize: 19 }}>Already logged today</Serif>
            </View>
            <Body style={{ fontSize: 12.5, color: C.ink3, lineHeight: 19 }}>
              A {sessionName.trim() || modLabel} session for {clientName} was already logged today. Log another one anyway?
            </Body>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable onPress={() => setDupOpen(false)} style={{ flex: 1, alignItems: 'center', paddingVertical: 13, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
                <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: C.ink }}>Cancel</Text>
              </Pressable>
              <Pressable onPress={() => { setDupOpen(false); submit(true); }} style={{ flex: 1, alignItems: 'center', paddingVertical: 13, borderRadius: 13, backgroundColor: hexA(C.gold, 0.16), borderWidth: 1, borderColor: hexA(C.gold, 0.45) }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: C.gold }}>Log anyway</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Blank-exercise warning — only exercises WITH values are saved; the rest are dropped */}
      <Modal visible={blankOpen} transparent animationType="fade" onRequestClose={() => setBlankOpen(false)}>
        <Pressable onPress={() => setBlankOpen(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center', padding: 22 }}>
          <Pressable onPress={() => {}} style={{ width: '100%', maxWidth: 350, backgroundColor: '#12100E', borderWidth: 1, borderColor: hexA(C.gold, 0.35), borderRadius: 20, padding: 20, gap: 13 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: hexA(C.gold, 0.14), alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="alert" size={17} color={C.gold} strokeWidth={2.2} />
              </View>
              <Serif style={{ flex: 1, fontSize: 19 }}>{blankExercises.length} blank exercise{blankExercises.length === 1 ? '' : 's'}</Serif>
            </View>
            <Body style={{ fontSize: 12.5, color: C.ink3, lineHeight: 19 }}>
              Only these exercises have values and will be saved — the blank one{blankExercises.length === 1 ? '' : 's'} ({blankExercises.map((e) => e.name).join(', ')}) will be removed from this session.
            </Body>
            <ScrollView style={{ maxHeight: 190 }} showsVerticalScrollIndicator={false}>
              <View style={{ gap: 6 }}>
                {exercises.filter(exHasData).map((e, i) => (
                  <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 11, borderRadius: 11, backgroundColor: hexA(C.green, 0.06), borderWidth: 1, borderColor: hexA(C.green, 0.25) }}>
                    <Icon name="checks" size={12} color={C.green} strokeWidth={2.5} />
                    <Body numberOfLines={1} style={{ flex: 1, fontSize: 12.5, color: '#fff' }}>{e.name}</Body>
                    {!isActivityModality ? <Mono style={{ fontSize: 8, color: C.muted3 }}>{e.sets.filter((s) => s.reps.trim() || s.load.trim() || s.duration.trim()).length} SETS</Mono> : null}
                  </View>
                ))}
              </View>
            </ScrollView>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable onPress={() => setBlankOpen(false)} style={{ flex: 1, alignItems: 'center', paddingVertical: 13, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
                <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: C.ink }}>Go Back</Text>
              </Pressable>
              <Pressable onPress={() => { setBlankOpen(false); setConfirmOpen(true); }} style={{ flex: 1, alignItems: 'center', paddingVertical: 13, borderRadius: 13, backgroundColor: hexA(C.green, 0.16), borderWidth: 1, borderColor: hexA(C.green, 0.45) }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: C.green }}>OK, Save These</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Immutable-log confirmation — trainer verifies date/time before commit */}
      <Modal visible={confirmOpen} transparent animationType="fade" onRequestClose={() => setConfirmOpen(false)}>
        <Pressable onPress={() => setConfirmOpen(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center', padding: 22 }}>
          <Pressable onPress={() => {}} style={{ width: '100%', maxWidth: 350, backgroundColor: '#12100E', borderWidth: 1, borderColor: 'rgba(255,150,90,0.16)', borderRadius: 20, padding: 20, gap: 14 }}>
            <Serif style={{ fontSize: 19 }}>{editingOutboxId ? 'Update this pending log?' : 'Log this session?'}</Serif>
            {editingOutboxId ? <Body style={{ fontSize: 11.5, color: C.gold }}>This log keeps its original date & time — only the contents change.</Body> : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.3)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }}>
              <Icon name="clock" size={15} color={C.orange} strokeWidth={2} />
              <View style={{ flex: 1 }}>
                <Body style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>
                  {new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: '2-digit', month: 'short' })} · {istTimeParts(new Date().toISOString()).time} {istTimeParts(new Date().toISOString()).ampm}
                </Body>
                <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 1 }}>{clientName} · {modLabel}</Body>
              </View>
            </View>
            <Body style={{ fontSize: 12.5, color: '#E0A090', lineHeight: 18 }}>
              A saved log cannot be changed afterwards. Confirm the session date and time before saving.
            </Body>
            {!isOnline ? (
              <Body style={{ fontSize: 11.5, color: C.gold }}>You're offline — it saves to this device now and syncs automatically at this timestamp.</Body>
            ) : null}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable onPress={() => setConfirmOpen(false)} style={{ flex: 1, alignItems: 'center', paddingVertical: 13, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
                <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: C.ink }}>Review</Text>
              </Pressable>
              <Pressable onPress={() => { setConfirmOpen(false); submit(); }} style={{ flex: 1, alignItems: 'center', paddingVertical: 13, borderRadius: 13, backgroundColor: hexA(C.green, 0.16), borderWidth: 1, borderColor: hexA(C.green, 0.45) }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: C.green }}>Confirm & Save</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Health data dialog */}
      <Modal visible={healthOpen} transparent animationType="slide" onRequestClose={() => setHealthOpen(false)}>
        <Pressable onPress={() => !saveHealthM.isPending && setHealthOpen(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}>
          <Pressable onPress={() => {}} style={{ maxHeight: Math.min(winH * 0.9, winH - kbH - insets.top - 12), backgroundColor: '#0E0A09', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.14)', paddingHorizontal: 18, paddingTop: 14, paddingBottom: (kbH > 0 ? 12 : insets.bottom + 18), marginBottom: kbH }}>
            <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 16 }} />
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
              <View style={{ flexDirection: 'row' }}>
                <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: hexA(C.gold, 0.14), borderWidth: 1, borderColor: hexA(C.gold, 0.3), alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="sparkle" size={18} color={C.gold} strokeWidth={2} />
                </View>
                <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: hexA(C.green, 0.14), borderWidth: 1, borderColor: hexA(C.green, 0.3), alignItems: 'center', justifyContent: 'center', marginLeft: -10 }}>
                  <Icon name="heart" size={18} color={C.green} strokeWidth={2} />
                </View>
              </View>
              <View style={{ flex: 1 }}>
                <Serif style={{ fontSize: 20 }}>Log Health Data</Serif>
                <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 3, lineHeight: 16 }}>{clientName} hasn't logged last night's sleep or yesterday's nutrition. Enter it on their behalf.</Body>
              </View>
              <Pressable onPress={() => setHealthOpen(false)} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="close" size={14} color="#B8B2AC" strokeWidth={2.3} />
              </Pressable>
            </View>

            <ScrollView ref={healthScrollRef} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 13, paddingBottom: 24 }}>
              {/* Sleep */}
              <View style={{ padding: 15, borderRadius: 18, backgroundColor: hexA(C.gold, 0.05), borderWidth: 1, borderColor: hexA(C.gold, 0.2), gap: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                  <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: hexA(C.gold, 0.13), alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="sparkle" size={15} color={C.gold} strokeWidth={2} />
                  </View>
                  <Body style={{ flex: 1, fontSize: 14.5, fontFamily: F.bodySemi, color: '#fff' }}>Sleep</Body>
                  <View style={{ paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999, backgroundColor: hexA(C.gold, 0.12), borderWidth: 1, borderColor: hexA(C.gold, 0.25) }}>
                    <Mono style={{ fontSize: 10, color: C.gold }}>GOAL {health?.scheduledHours ?? 8}H</Mono>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', borderRadius: 13, borderWidth: 1, borderColor: hSleep ? hexA(C.gold, 0.4) : 'rgba(255,255,255,0.12)', backgroundColor: 'rgba(0,0,0,0.25)', paddingHorizontal: 14 }}>
                  <TextInput value={hSleep} onChangeText={(t) => setHSleep(t.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0.0" placeholderTextColor={C.muted3} style={{ flex: 1, paddingVertical: 13, color: '#fff', fontFamily: F.mono, fontSize: 22 }} />
                  <Mono style={{ fontSize: 12, color: C.muted2 }}>HOURS SLEPT</Mono>
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
                  {['6', '6.5', '7', '7.5', '8', '8.5'].map((v) => {
                    const active = hSleep === v;
                    return (
                      <Pressable key={v} onPress={() => setHSleep(v)} style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, backgroundColor: active ? hexA(C.gold, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.gold, 0.4) : 'rgba(255,255,255,0.07)' }}>
                        <Text style={{ fontFamily: active ? F.bodyBold : F.body, fontSize: 12.5, color: active ? C.gold : C.muted }}>{v}h</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              {/* Nutrition */}
              <View style={{ padding: 15, borderRadius: 18, backgroundColor: hexA(C.green, 0.05), borderWidth: 1, borderColor: hexA(C.green, 0.2), gap: 11 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                  <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: hexA(C.green, 0.13), alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="heart" size={15} color={C.green} strokeWidth={2} />
                  </View>
                  <Body style={{ flex: 1, fontSize: 14.5, fontFamily: F.bodySemi, color: '#fff' }}>Nutrition</Body>
                  {hRating != null ? <Serif style={{ fontSize: 18, color: C.green }}>{hRating}<Text style={{ fontSize: 12, color: C.muted2 }}>/10</Text></Serif> : null}
                </View>
                <Body style={{ fontSize: 11, color: C.muted2 }}>Rate yesterday from 1 (Poor) to 10 (Excellent)</Body>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
                    const active = hRating === n;
                    return (
                      <Pressable key={n} onPress={() => setHRating(n)} style={{ width: '18%', flexGrow: 1, height: 42, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? hexA(C.green, 0.2) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.green, 0.55) : 'rgba(255,255,255,0.07)' }}>
                        <Text style={{ fontFamily: active ? F.bodyBold : F.body, fontSize: 15, color: active ? C.green : C.muted }}>{n}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              {/* Steps */}
              <View style={{ padding: 15, borderRadius: 18, backgroundColor: hexA(C.blue, 0.05), borderWidth: 1, borderColor: hexA(C.blue, 0.2), gap: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                  <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: hexA(C.blue, 0.13), alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="activity" size={15} color={C.blue} strokeWidth={2} />
                  </View>
                  <Body style={{ flex: 1, fontSize: 14.5, fontFamily: F.bodySemi, color: '#fff' }}>Steps</Body>
                  <Mono style={{ fontSize: 10, color: C.muted3 }}>YESTERDAY</Mono>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', borderRadius: 13, borderWidth: 1, borderColor: hSteps ? hexA(C.blue, 0.4) : 'rgba(255,255,255,0.12)', backgroundColor: 'rgba(0,0,0,0.25)', paddingHorizontal: 14 }}>
                  <TextInput value={hSteps} onChangeText={(t) => setHSteps(t.replace(/[^0-9]/g, ''))} onFocus={() => setTimeout(() => healthScrollRef.current?.scrollToEnd({ animated: true }), 120)} keyboardType="number-pad" placeholder="0" placeholderTextColor={C.muted3} style={{ flex: 1, paddingVertical: 13, color: '#fff', fontFamily: F.mono, fontSize: 22 }} />
                  <Mono style={{ fontSize: 12, color: C.muted2 }}>STEPS</Mono>
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
                  {[['5,000', '5000'], ['8,000', '8000'], ['10,000', '10000'], ['12,000', '12000']].map(([label, v]) => {
                    const active = hSteps === v;
                    return (
                      <Pressable key={v} onPress={() => setHSteps(v)} style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, backgroundColor: active ? hexA(C.blue, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.blue, 0.4) : 'rgba(255,255,255,0.07)' }}>
                        <Text style={{ fontFamily: active ? F.bodyBold : F.body, fontSize: 12.5, color: active ? C.blue : C.muted }}>{label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              {saveHealthM.isError ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 12, backgroundColor: hexA(C.red, 0.08), borderWidth: 1, borderColor: hexA(C.red, 0.28) }}>
                  <Icon name="alert" size={14} color={C.red} strokeWidth={2.2} />
                  <Body style={{ flex: 1, fontSize: 12, color: '#E0A090' }}>{(saveHealthM.error as Error).message}</Body>
                </View>
              ) : null}

              <Pressable onPress={saveHealth} disabled={!healthValid || saveHealthM.isPending} style={{ opacity: !healthValid || saveHealthM.isPending ? 0.45 : 1, marginTop: 2 }}>
                <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 16, borderRadius: 14 }}>
                  <Icon name="checks" path="M20 6 9 17l-5-5" size={16} color="#fff" strokeWidth={2.8} />
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: '#fff' }}>{saveHealthM.isPending ? 'Saving…' : 'Save Health Data'}</Text>
                </LinearGradient>
              </Pressable>
              {!healthValid ? <Body style={{ fontSize: 11, color: C.muted3, textAlign: 'center' }}>Enter sleep, nutrition rating, and steps to continue.</Body> : null}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Exercise picker */}
      <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <Pressable onPress={() => setPickerOpen(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}>
          <Pressable onPress={() => {}} style={{ height: '82%', backgroundColor: '#0E0A09', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.14)', paddingHorizontal: 18, paddingTop: 14 }}>
            <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 14 }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
              <View style={{ flex: 1 }}>
                <Serif style={{ fontSize: 20 }}>Add Exercise</Serif>
                <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 2 }}>{modLabel} · tap to add as many as you need.</Body>
              </View>
              <Pressable onPress={() => setPickerOpen(false)} hitSlop={8} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="close" size={14} color="#B8B2AC" strokeWidth={2.3} />
              </Pressable>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', marginBottom: 10 }}>
              <Icon name="search" size={17} color={C.muted3} strokeWidth={2} />
              <TextInput value={exSearch} onChangeText={setExSearch} placeholder="Search exercises…" placeholderTextColor={C.muted3} autoCorrect={false} style={{ flex: 1, fontFamily: F.body, fontSize: 15, color: '#fff', padding: 0 }} />
            </View>

            {/* Add custom exercise */}
            {!customFormOpen ? (
              <Pressable onPress={() => { setCustomName(exSearch.trim()); setCustomMeasure('reps'); setCustomFormOpen(true); }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 13, borderRadius: 13, borderWidth: 1.5, borderStyle: 'dashed', borderColor: hexA(C.orange, 0.32), backgroundColor: hexA(C.orange, 0.05), marginBottom: 12 }}>
                <Icon name="plus" size={15} color={C.orange} strokeWidth={2.6} />
                <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: C.orange }}>Add Custom Exercise</Text>
              </Pressable>
            ) : (
              <View style={{ padding: 13, borderRadius: 14, backgroundColor: hexA(C.orange, 0.06), borderWidth: 1, borderColor: hexA(C.orange, 0.28), gap: 10, marginBottom: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Mono style={{ flex: 1, fontSize: 10, letterSpacing: 1, color: C.orange }}>CUSTOM EXERCISE</Mono>
                  <Pressable onPress={() => { setCustomFormOpen(false); setCustomName(''); }} hitSlop={8}><Icon name="close" size={15} color={C.muted} strokeWidth={2.3} /></Pressable>
                </View>
                <TextInput
                  value={customName}
                  onChangeText={setCustomName}
                  placeholder="Exercise name"
                  placeholderTextColor={C.muted3}
                  autoFocus
                  style={{ paddingVertical: 12, paddingHorizontal: 13, borderRadius: 11, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', backgroundColor: 'rgba(0,0,0,0.25)', color: '#fff', fontFamily: F.body, fontSize: 15 }}
                />
                {/* Measured by — reps or duration (only for set-based modalities; Yoga/Boxing are activities) */}
                {!isActivityModality ? (
                  <>
                    <Mono style={{ fontSize: 9.5, letterSpacing: 0.8, color: C.muted3 }}>MEASURED BY</Mono>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      {([['reps', 'Reps', 'dumbbell'], ['duration', 'Duration', 'clock']] as const).map(([id, lbl, ic]) => {
                        const active = customMeasure === id;
                        return (
                          <Pressable key={id} onPress={() => setCustomMeasure(id)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 11, borderRadius: 11, backgroundColor: active ? hexA(C.orange, 0.14) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.orange, 0.45) : 'rgba(255,255,255,0.1)' }}>
                            <Icon name={ic} size={14} color={active ? C.orange : C.muted} strokeWidth={2} />
                            <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 13, color: active ? C.orange : C.muted }}>{lbl}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </>
                ) : null}
                <Pressable onPress={() => { if (customName.trim()) { addExercise(customName, isActivityModality ? 'reps' : customMeasure, 'Custom'); setCustomFormOpen(false); setCustomName(''); setCustomMeasure('reps'); } }} disabled={!customName.trim()} style={{ opacity: customName.trim() ? 1 : 0.5 }}>
                  <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 12, borderRadius: 12 }}>
                    <Icon name="plus" size={14} color="#fff" strokeWidth={2.8} />
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: '#fff' }}>Add Exercise</Text>
                  </LinearGradient>
                </Pressable>
              </View>
            )}

            {(() => {
              const q = exSearch.trim().toLowerCase();
              const list = (exDbQ.data ?? []).filter((e) => !q || e.name.toLowerCase().includes(q) || (e.muscle_group ?? '').toLowerCase().includes(q));
              const exactMatch = (exDbQ.data ?? []).some((e) => e.name.toLowerCase() === q);
              const addedCounts: Record<string, number> = {};
              exercises.forEach((e) => { const k = e.name.trim().toLowerCase(); addedCounts[k] = (addedCounts[k] ?? 0) + 1; });
              return (
                <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: (kbH > 0 ? kbH : insets.bottom) + 96, gap: 8 }}>
                  {q && !exactMatch ? (
                    <Pressable onPress={() => { setCustomName(exSearch.trim()); setCustomMeasure('reps'); setCustomFormOpen(true); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: 14, borderRadius: 13, backgroundColor: hexA(C.orange, 0.08), borderWidth: 1, borderColor: hexA(C.orange, 0.3) }}>
                      <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: hexA(C.orange, 0.14), alignItems: 'center', justifyContent: 'center' }}>
                        <Icon name="plus" size={16} color={C.orange} strokeWidth={2.6} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Body style={{ fontSize: 14.5, fontFamily: F.bodySemi, color: C.orange }}>Add “{exSearch.trim()}”</Body>
                        <Body style={{ fontSize: 11.5, color: C.muted2 }}>Custom exercise</Body>
                      </View>
                    </Pressable>
                  ) : null}

                  {exDbQ.isLoading ? (
                    <Body style={{ color: C.muted2, textAlign: 'center', paddingVertical: 24 }}>Loading exercises…</Body>
                  ) : list.length === 0 && !q ? (
                    <Body style={{ color: C.muted2, textAlign: 'center', paddingVertical: 24 }}>No saved exercises for {modLabel}. Type a name above to add a custom one.</Body>
                  ) : (
                    list.map((e) => {
                      const added = addedCounts[e.name.trim().toLowerCase()] ?? 0;
                      return (
                      <Pressable key={e.name} onPress={() => addExercise(e.name, e.measurement_type === 'duration' ? 'duration' : 'reps', 'Constant', e.muscle_group ?? undefined)} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: 13, borderRadius: 13, backgroundColor: added ? hexA(C.green, 0.07) : 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: added ? hexA(C.green, 0.3) : 'rgba(255,255,255,0.07)' }}>
                        <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: hexA(C.orange, 0.1), alignItems: 'center', justifyContent: 'center' }}>
                          <Icon name={e.measurement_type === 'duration' ? 'clock' : 'dumbbell'} size={15} color={C.orange} strokeWidth={1.9} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Body style={{ fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }} numberOfLines={1}>{e.name}</Body>
                          {e.muscle_group || e.equipment || e.measurement_type === 'duration' ? <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 1 }}>{[e.measurement_type === 'duration' ? 'Duration' : null, e.muscle_group, e.equipment].filter(Boolean).join(' · ')}</Body> : null}
                        </View>
                        {added ? (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4, paddingHorizontal: 9, borderRadius: 999, backgroundColor: hexA(C.green, 0.14), borderWidth: 1, borderColor: hexA(C.green, 0.35) }}>
                            <Icon path="M20 6 9 17l-5-5" size={12} color={C.green} strokeWidth={2.6} />
                            <Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: C.green }}>Added{added > 1 ? ` ×${added}` : ''}</Text>
                          </View>
                        ) : (
                          <Icon name="plus" size={16} color={C.muted} strokeWidth={2.4} />
                        )}
                      </Pressable>
                      );
                    })
                  )}
                </ScrollView>
              );
            })()}

            {/* Bottom confirm bar — always visible, list scrolls clear of it */}
            <View style={{ position: 'absolute', left: 18, right: 18, bottom: (kbH > 0 ? kbH + 10 : insets.bottom + 12) }}>
              <Pressable onPress={() => setPickerOpen(false)}>
                {exercises.length > 0 ? (
                  <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 15, borderRadius: 14 }}>
                    <Icon name="checks" size={16} color="#fff" strokeWidth={2.6} />
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 14.5, color: '#fff' }}>{exercises.length} Selected — Continue</Text>
                  </LinearGradient>
                ) : (
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 15, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}>
                    <Text style={{ fontFamily: F.bodySemi, fontSize: 14, color: C.muted }}>Close</Text>
                  </View>
                )}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Workout Templates sheet — load a saved workout or save the current one */}
      <Modal visible={templatesOpen} transparent animationType="slide" onRequestClose={() => setTemplatesOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}>
          <View style={{ maxHeight: Math.min(winH * 0.86, winH - kbH - insets.top - 12), backgroundColor: '#0E0A09', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: hexA(C.gold, 0.16), paddingHorizontal: 18, paddingTop: 14, paddingBottom: (kbH > 0 ? 12 : insets.bottom + 18), marginBottom: kbH }}>
            <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 14 }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
              <View style={{ flex: 1 }}>
                <Serif style={{ fontSize: 20 }}>Workout Templates</Serif>
                <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 2 }}>{modLabel} · reuse a saved workout</Body>
              </View>
              <Pressable onPress={() => setTemplatesOpen(false)} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="close" size={14} color="#B8B2AC" strokeWidth={2.3} />
              </Pressable>
            </View>

            {/* Save current workout as a template */}
            {hasValidContent ? (
              tplSaveMode ? (
                <View style={{ padding: 13, borderRadius: 14, backgroundColor: hexA(C.gold, 0.06), borderWidth: 1, borderColor: hexA(C.gold, 0.28), gap: 10, marginBottom: 14 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Mono style={{ flex: 1, fontSize: 10, letterSpacing: 1, color: C.gold }}>SAVE AS TEMPLATE</Mono>
                    <Pressable onPress={() => { setTplSaveMode(false); setTplName(''); }} hitSlop={8}><Icon name="close" size={15} color={C.muted} strokeWidth={2.3} /></Pressable>
                  </View>
                  <TextInput value={tplName} onChangeText={setTplName} placeholder="Template name (e.g. Upper Body A)" placeholderTextColor={C.muted3} autoFocus style={{ paddingVertical: 12, paddingHorizontal: 13, borderRadius: 11, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', backgroundColor: 'rgba(0,0,0,0.25)', color: '#fff', fontFamily: F.body, fontSize: 15 }} />
                  {saveTplM.isError ? <Body style={{ fontSize: 11.5, color: C.red }}>{(saveTplM.error as Error).message}</Body> : null}
                  <Pressable onPress={saveTemplate} disabled={!tplName.trim() || saveTplM.isPending} style={{ opacity: tplName.trim() && !saveTplM.isPending ? 1 : 0.5 }}>
                    <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 12, borderRadius: 12 }}>
                      <Icon name="checks" size={14} color="#fff" strokeWidth={2.6} />
                      <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: '#fff' }}>{saveTplM.isPending ? 'Saving…' : 'Save Template'}</Text>
                    </LinearGradient>
                  </Pressable>
                </View>
              ) : (
                <Pressable onPress={() => { setTplName(sessionName.trim() || `${modLabel} Workout`); setTplSaveMode(true); }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 13, borderRadius: 13, borderWidth: 1.5, borderStyle: 'dashed', borderColor: hexA(C.gold, 0.35), backgroundColor: hexA(C.gold, 0.05), marginBottom: 14 }}>
                  <Icon name="plus" size={15} color={C.gold} strokeWidth={2.6} />
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: C.gold }}>Save this workout as a template</Text>
                </Pressable>
              )
            ) : null}

            <Mono style={{ fontSize: 10, letterSpacing: 1.2, color: C.mono2, marginBottom: 10 }}>YOUR {modLabel.toUpperCase()} TEMPLATES</Mono>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 20, gap: 9 }}>
              {tplQ.isLoading ? (
                <Body style={{ color: C.muted2, textAlign: 'center', paddingVertical: 24 }}>Loading templates…</Body>
              ) : myTemplates.length === 0 ? (
                <View style={{ alignItems: 'center', gap: 8, paddingVertical: 26 }}>
                  <Icon name="file" size={26} color="#4C4640" strokeWidth={1.6} />
                  <Body style={{ fontSize: 13, color: C.muted3, textAlign: 'center' }}>No {modLabel} templates yet.{'\n'}Build a workout and save it as a template.</Body>
                </View>
              ) : (
                myTemplates.map((t) => (
                  <View key={t.template_id} style={{ borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                    <View style={{ height: 3, backgroundColor: hexA(C.gold, 0.4) }} />
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: 13 }}>
                      <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: hexA(C.gold, 0.12), alignItems: 'center', justifyContent: 'center' }}>
                        <Icon name="file" size={16} color={C.gold} strokeWidth={1.9} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Body style={{ fontSize: 14.5, fontFamily: F.bodySemi, color: '#fff' }} numberOfLines={1}>{t.template_name}</Body>
                        <Mono style={{ fontSize: 9.5, color: C.muted3, marginTop: 2 }}>{t.exerciseCount} exercise{t.exerciseCount === 1 ? '' : 's'}{t.description ? ` · ${t.description}` : ''}</Mono>
                      </View>
                      <Pressable onPress={() => Alert.alert('Delete template?', `Remove "${t.template_name}" permanently?`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => delTplM.mutate(t.template_id) }])} hitSlop={8} style={{ width: 32, height: 32, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.04)' }}>
                        <Icon path="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" size={15} color={C.muted2} strokeWidth={2} />
                      </Pressable>
                      <Pressable onPress={() => applyTemplate(t)}>
                        <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 8, paddingHorizontal: 13, borderRadius: 999 }}>
                          <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: '#fff' }}>Load</Text>
                        </LinearGradient>
                      </Pressable>
                    </View>
                  </View>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}
const colHead = { fontFamily: F.mono, fontSize: 10, color: C.faint, textTransform: 'uppercase' as const, letterSpacing: 0.6 };
const cell = { height: 42, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center' as const, justifyContent: 'center' as const };
const cellInput = { flex: 1, height: 42, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.06)', textAlign: 'center' as const, fontFamily: F.mono, fontSize: 15, color: '#fff', paddingVertical: 0 };

/* ============ CREATE WORKOUT TEMPLATE (builder) ============
   Standalone builder: name + modality + exercises → saves to workout_templates.
   Mirrors the web create flow (metadata + exercise builder) in one sheet. */
function TemplateBuilderSheet({ trainerId, visible, onClose, onSaved }: { trainerId: string; visible: boolean; onClose: () => void; onSaved?: () => void }) {
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const saveM = useSaveWorkoutTemplate();
  type Section = { id: string; body_part: string; exercises: WExercise[] };
  const [name, setName] = React.useState('');
  const [modality, setModality] = React.useState('strength');
  const [sections, setSections] = React.useState<Section[]>([]);
  const [bpOpen, setBpOpen] = React.useState(false);
  const [bpName, setBpName] = React.useState('');
  const [pickerFor, setPickerFor] = React.useState<string | null>(null); // section id
  const [openId, setOpenId] = React.useState<string | null>(null); // expanded section
  const [renameId, setRenameId] = React.useState<string | null>(null);
  const [renameVal, setRenameVal] = React.useState('');
  const [exSearch, setExSearch] = React.useState('');
  const [customOpen, setCustomOpen] = React.useState(false);
  const [customName, setCustomName] = React.useState('');
  const [customMeasure, setCustomMeasure] = React.useState<'reps' | 'duration'>('reps');
  const [kbH, setKbH] = React.useState(0);
  React.useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const s = Keyboard.addListener(showEvt, (e: any) => setKbH(e.endCoordinates?.height ?? 0));
    const h = Keyboard.addListener(hideEvt, () => setKbH(0));
    return () => { s.remove(); h.remove(); };
  }, []);
  React.useEffect(() => {
    if (visible) { setName(''); setModality('strength'); setSections([]); setBpOpen(false); setBpName(''); setPickerFor(null); setExSearch(''); setCustomOpen(false); setCustomName(''); saveM.reset(); }
  }, [visible]);

  const exDbQ = useExerciseDb(modality);
  const mLower = modality.toLowerCase();
  const isActivity = mLower === 'yoga' || mLower === 'boxing';
  const modLabel = modality[0].toUpperCase() + modality.slice(1);

  // Yoga/Boxing don't use named body parts — auto-seed one activities group.
  React.useEffect(() => {
    if (visible && isActivity && sections.length === 0) { const id = uuidv4(); setSections([{ id, body_part: `${modLabel} Activities`, exercises: [] }]); setOpenId(id); }
  }, [visible, modality]);

  const setMod = (m: string) => { setModality(m); setSections([]); setPickerFor(null); setBpOpen(false); setCustomOpen(false); setCustomMeasure(m.toLowerCase() === 'yoga' || m.toLowerCase() === 'boxing' ? 'duration' : 'reps'); };

  const addBodyPart = () => { const b = bpName.trim(); if (!b) return; const id = uuidv4(); setSections((s) => [...s, { id, body_part: b, exercises: [] }]); setBpName(''); setBpOpen(false); setPickerFor(id); setOpenId(id); };
  const renameSection = (id: string) => { const v = renameVal.trim(); if (v) setSections((s) => s.map((x) => (x.id === id ? { ...x, body_part: v } : x))); setRenameId(null); setRenameVal(''); };
  const rmSection = (id: string) => { setSections((s) => s.filter((x) => x.id !== id)); if (pickerFor === id) setPickerFor(null); };
  const patchSection = (id: string, fn: (ex: WExercise[]) => WExercise[]) => setSections((s) => s.map((x) => (x.id === id ? { ...x, exercises: fn(x.exercises) } : x)));
  const secUpdSet = (id: string, ei: number, si: number, patch: Partial<WSet>) => patchSection(id, (xs) => xs.map((x, k) => (k === ei ? { ...x, sets: x.sets.map((st, j) => (j === si ? { ...st, ...patch } : st)) } : x)));
  const secAddSet = (id: string, ei: number) => patchSection(id, (xs) => xs.map((x, k) => (k === ei ? { ...x, sets: [...x.sets, { ...(x.sets[x.sets.length - 1] ?? { reps: '', load: '', duration: '', note: '' }) }] } : x)));
  const secRmSet = (id: string, ei: number, si: number) => patchSection(id, (xs) => xs.map((x, k) => (k === ei ? { ...x, sets: x.sets.filter((_, j) => j !== si) } : x)));
  const secRmEx = (id: string, ei: number) => patchSection(id, (xs) => xs.filter((_, k) => k !== ei));

  const addExercise = (n: string, measurement: 'reps' | 'duration' = 'reps') => {
    const nm = n.trim(); if (!nm || !pickerFor) return;
    patchSection(pickerFor, (xs) => [...xs, { name: nm, measurement, sets: [{ reps: '', load: '', duration: '', note: '' }], notes: '' }]);
  };

  const hasContent = sections.some((s) => s.exercises.some((e) => e.name.trim() && e.sets.some((st) => st.reps.trim() || st.load.trim() || st.duration.trim())));
  const canSave = !!name.trim() && hasContent && !saveM.isPending;
  const save = async () => {
    if (!canSave) return;
    const exercises: any[] = sections.flatMap((s) => s.exercises.map((e) => ({ ...e, body_part: s.body_part })));
    try { await saveM.mutateAsync({ trainerId, name, modality, exercises }); (onSaved ?? onClose)(); } catch { /* shown below */ }
  };

  const q = exSearch.trim().toLowerCase();
  const dbList = (exDbQ.data ?? []).filter((e) => !q || e.name.toLowerCase().includes(q) || (e.muscle_group ?? '').toLowerCase().includes(q));
  const pickerLabel = sections.find((s) => s.id === pickerFor)?.body_part ?? '';

  // Exercise card — inputs adapt to the exercise's measurement type.
  const renderSetCard = (id: string, ex: WExercise, ei: number) => {
    const isDur = ex.measurement === 'duration';
    return (
      <View key={ei} style={{ borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', padding: 12, gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
          <View style={{ width: 24, height: 24, borderRadius: 7, backgroundColor: hexA(C.orange, 0.13), alignItems: 'center', justifyContent: 'center' }}><Icon name={isDur ? 'clock' : 'dumbbell'} size={13} color={C.orange} strokeWidth={2} /></View>
          <View style={{ flex: 1 }}>
            <Body style={{ fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }} numberOfLines={1}>{ex.name}</Body>
            <Mono style={{ fontSize: 9, color: C.muted3, marginTop: 1 }}>{ex.sets.length} set{ex.sets.length === 1 ? '' : 's'}{isDur ? ' · duration' : ''}</Mono>
          </View>
          <Pressable onPress={() => secRmEx(id, ei)} hitSlop={8}><Icon name="close" size={15} color={C.muted2} strokeWidth={2.2} /></Pressable>
        </View>
        <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 2 }}>
          <Text style={[colHead, { width: 22 }]}>#</Text>
          <Text style={[colHead, { flex: 1 }]}>{isDur ? 'DURATION (SEC)' : 'REPS'}</Text>
          <Text style={[colHead, { flex: 1 }]}>{isDur ? 'NOTES' : 'LOAD (KG)'}</Text>
          <View style={{ width: 22 }} />
        </View>
        {ex.sets.map((st, si) => (
          <View key={si} style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <View style={[cell, { width: 22, backgroundColor: 'rgba(255,255,255,0.04)' }]}><Text style={{ fontFamily: F.mono, fontSize: 12, color: C.muted }}>{si + 1}</Text></View>
            {isDur ? (
              <>
                <TextInput value={st.duration} onChangeText={(t) => secUpdSet(id, ei, si, { duration: t.replace(/[^0-9]/g, '') })} keyboardType="number-pad" placeholder="—" placeholderTextColor={C.muted3} style={[cellInput]} />
                <TextInput value={st.note ?? ''} onChangeText={(t) => secUpdSet(id, ei, si, { note: t })} placeholder="Add notes" placeholderTextColor={C.muted3} style={[cellInput, { textAlign: 'left', paddingHorizontal: 12, fontFamily: F.body, fontSize: 13 }]} />
              </>
            ) : (
              <>
                <TextInput value={st.reps} onChangeText={(t) => secUpdSet(id, ei, si, { reps: t.replace(/[^0-9]/g, '') })} keyboardType="number-pad" placeholder="—" placeholderTextColor={C.muted3} style={[cellInput]} />
                <TextInput value={st.load} onChangeText={(t) => secUpdSet(id, ei, si, { load: t.replace(/[^0-9.]/g, '') })} keyboardType="decimal-pad" placeholder="—" placeholderTextColor={C.muted3} style={[cellInput]} />
              </>
            )}
            <Pressable onPress={() => secRmSet(id, ei, si)} disabled={ex.sets.length === 1} style={{ width: 22, alignItems: 'center', opacity: ex.sets.length === 1 ? 0.3 : 1 }} hitSlop={6}><Icon name="close" size={12} color={C.muted2} strokeWidth={2.2} /></Pressable>
          </View>
        ))}
        <Pressable onPress={() => secAddSet(id, ei)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8, borderRadius: 10, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.13)' }}><Icon name="plus" size={12} color={C.muted} strokeWidth={2.2} /><Text style={{ fontFamily: F.bodySemi, fontSize: 11.5, color: C.muted }}>Add set</Text></Pressable>
      </View>
    );
  };

  const pickerPanel = (
    <View style={{ borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.3)', borderWidth: 1, borderColor: hexA(C.orange, 0.25), padding: 12, gap: 9 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Mono style={{ flex: 1, fontSize: 9.5, letterSpacing: 0.6, color: C.orange }}>ADD {modLabel.toUpperCase()} EXERCISE{pickerLabel ? ` → ${pickerLabel.toUpperCase()}` : ''}</Mono>
        <Pressable onPress={() => { setPickerFor(null); setCustomOpen(false); }} hitSlop={8}><Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: C.orange }}>Done</Text></Pressable>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
        <Icon name="search" size={15} color={C.muted3} strokeWidth={2} />
        <TextInput value={exSearch} onChangeText={setExSearch} placeholder={`Search ${modLabel} exercises…`} placeholderTextColor={C.muted3} autoCorrect={false} style={{ flex: 1, fontFamily: F.body, fontSize: 14, color: '#fff', padding: 0 }} />
      </View>
      {!customOpen ? (
        <Pressable onPress={() => { setCustomName(exSearch.trim()); setCustomMeasure(isActivity ? 'duration' : 'reps'); setCustomOpen(true); }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 11, borderWidth: 1.5, borderStyle: 'dashed', borderColor: hexA(C.orange, 0.3) }}><Icon name="plus" size={13} color={C.orange} strokeWidth={2.6} /><Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: C.orange }}>Add Custom Exercise</Text></Pressable>
      ) : (
        <View style={{ padding: 10, borderRadius: 11, backgroundColor: hexA(C.orange, 0.06), borderWidth: 1, borderColor: hexA(C.orange, 0.28), gap: 8 }}>
          <TextInput value={customName} onChangeText={setCustomName} placeholder="Exercise name" placeholderTextColor={C.muted3} autoFocus style={{ paddingVertical: 10, paddingHorizontal: 11, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', backgroundColor: 'rgba(0,0,0,0.25)', color: '#fff', fontFamily: F.body, fontSize: 14 }} />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {([['reps', 'Reps', 'dumbbell'], ['duration', 'Duration', 'clock']] as const).map(([cid, lbl, ic]) => { const active = customMeasure === cid; return <Pressable key={cid} onPress={() => setCustomMeasure(cid)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9, borderRadius: 10, backgroundColor: active ? hexA(C.orange, 0.14) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.orange, 0.45) : 'rgba(255,255,255,0.1)' }}><Icon name={ic} size={12} color={active ? C.orange : C.muted} strokeWidth={2} /><Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 12, color: active ? C.orange : C.muted }}>{lbl}</Text></Pressable>; })}
          </View>
          <Pressable onPress={() => { if (customName.trim()) { addExercise(customName, customMeasure); setCustomOpen(false); setCustomName(''); } }} disabled={!customName.trim()} style={{ opacity: customName.trim() ? 1 : 0.5 }}><LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 10 }}><Icon name="plus" size={12} color="#fff" strokeWidth={2.8} /><Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: '#fff' }}>Add</Text></LinearGradient></Pressable>
        </View>
      )}
      {exDbQ.isLoading ? (
        <Body style={{ color: C.muted2, textAlign: 'center', paddingVertical: 14, fontSize: 12 }}>Loading…</Body>
      ) : (
        dbList.slice(0, 50).map((e) => (
          <Pressable key={e.name} onPress={() => addExercise(e.name, e.measurement_type === 'duration' ? 'duration' : 'reps')} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }}>
            <Icon name={e.measurement_type === 'duration' ? 'clock' : 'dumbbell'} size={14} color={C.orange} strokeWidth={1.9} />
            <View style={{ flex: 1 }}>
              <Body style={{ fontSize: 13, color: '#fff' }} numberOfLines={1}>{e.name}</Body>
              {e.measurement_type === 'duration' ? <Mono style={{ fontSize: 8.5, color: C.muted3, marginTop: 1 }}>DURATION</Mono> : null}
            </View>
            <Icon name="plus" size={14} color={C.muted} strokeWidth={2.4} />
          </Pressable>
        ))
      )}
    </View>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}>
        <View style={{ height: Math.min(winH * 0.92, winH - insets.top - 8), backgroundColor: '#0E0A09', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: hexA(C.gold, 0.16), paddingHorizontal: 18, paddingTop: 14 }}>
          <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 14 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
            <View style={{ flex: 1 }}>
              <Serif style={{ fontSize: 20 }}>New Template</Serif>
              <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 2 }}>Name it, add body parts, then exercises</Body>
            </View>
            <Pressable onPress={onClose} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="close" size={14} color="#B8B2AC" strokeWidth={2.3} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: (kbH > 0 ? kbH : insets.bottom) + 90, gap: 14 }}>
            <View>
              <Mono style={{ fontSize: 10, letterSpacing: 1.2, color: C.mono2, marginBottom: 8 }}>TEMPLATE NAME</Mono>
              <TextInput value={name} onChangeText={setName} placeholder="e.g. Push Day, Full Body A" placeholderTextColor={C.muted3} style={{ paddingVertical: 12, paddingHorizontal: 13, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', backgroundColor: 'rgba(0,0,0,0.25)', color: '#fff', fontFamily: F.body, fontSize: 15 }} />
            </View>

            <View>
              <Mono style={{ fontSize: 10, letterSpacing: 1.2, color: C.mono2, marginBottom: 8 }}>MODALITY</Mono>
              <HScroll>
                {modalities.map((m) => {
                  const active = mLower === m.toLowerCase();
                  return (
                    <Pressable key={m} onPress={() => setMod(m)} style={{ paddingVertical: 9, paddingHorizontal: 15, borderRadius: 999, backgroundColor: active ? hexA(C.orange, 0.14) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.orange, 0.45) : 'rgba(255,255,255,0.08)' }}>
                      <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 12.5, color: active ? C.orange : C.muted }}>{m[0].toUpperCase() + m.slice(1)}</Text>
                    </Pressable>
                  );
                })}
              </HScroll>
            </View>

            {sections.map((sec) => {
              const open = isActivity || openId === sec.id;
              const setCount = sec.exercises.reduce((n, e) => n + e.sets.length, 0);
              const renaming = renameId === sec.id;
              return (
              <View key={sec.id} style={{ borderRadius: 16, backgroundColor: 'rgba(46,28,18,0.4)', borderWidth: 1, borderColor: open ? hexA(C.orange, 0.22) : 'rgba(255,150,90,0.09)', overflow: 'hidden' }}>
                {/* Header */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, padding: 14 }}>
                  <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: hexA(C.orange, 0.13), alignItems: 'center', justifyContent: 'center' }}><Icon name="dumbbell" size={15} color={C.orange} strokeWidth={1.9} /></View>
                  {renaming ? (
                    <TextInput value={renameVal} onChangeText={setRenameVal} autoFocus onSubmitEditing={() => renameSection(sec.id)} onBlur={() => renameSection(sec.id)} style={{ flex: 1, fontFamily: F.bodySemi, fontSize: 15, color: '#fff', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: hexA(C.orange, 0.5) }} />
                  ) : (
                    <Pressable onPress={() => !isActivity && setOpenId(open ? null : sec.id)} style={{ flex: 1 }}>
                      <Serif style={{ fontSize: 17 }} numberOfLines={1}>{sec.body_part}</Serif>
                      <Mono style={{ fontSize: 9, color: C.muted3, marginTop: 1 }}>{sec.exercises.length} exercise{sec.exercises.length === 1 ? '' : 's'} · {setCount} set{setCount === 1 ? '' : 's'}</Mono>
                    </Pressable>
                  )}
                  {!isActivity && !renaming ? (
                    <>
                      <Pressable onPress={() => rmSection(sec.id)} hitSlop={8} style={{ width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.05)' }}><Icon path="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" size={14} color={C.muted2} strokeWidth={2} /></Pressable>
                      <Pressable onPress={() => setOpenId(open ? null : sec.id)} hitSlop={8}><Icon name={open ? 'chevUp' : 'chevDown'} size={17} color={C.muted} strokeWidth={2.2} /></Pressable>
                    </>
                  ) : null}
                </View>
                {/* Body (expanded) */}
                {open ? (
                  <View style={{ paddingHorizontal: 14, paddingBottom: 14, gap: 11 }}>
                    {sec.exercises.map((ex, ei) => renderSetCard(sec.id, ex, ei))}
                    {pickerFor === sec.id ? pickerPanel : (
                      <Pressable onPress={() => { setPickerFor(sec.id); setExSearch(''); setCustomOpen(false); }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 11, borderRadius: 12, borderWidth: 1.5, borderStyle: 'dashed', borderColor: hexA(C.orange, 0.3), backgroundColor: hexA(C.orange, 0.05) }}><Icon name="plus" size={14} color={C.orange} strokeWidth={2.6} /><Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: C.orange }}>Add Exercise</Text></Pressable>
                    )}
                  </View>
                ) : null}
              </View>
              );
            })}

            {!isActivity ? (
              bpOpen ? (
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                  <TextInput value={bpName} onChangeText={setBpName} placeholder="Body part / workout (e.g. Chest)" placeholderTextColor={C.muted3} autoFocus onSubmitEditing={addBodyPart} style={{ flex: 1, paddingVertical: 12, paddingHorizontal: 13, borderRadius: 12, borderWidth: 1, borderColor: hexA(C.orange, 0.35), backgroundColor: 'rgba(0,0,0,0.25)', color: '#fff', fontFamily: F.body, fontSize: 14.5 }} />
                  <Pressable onPress={addBodyPart} disabled={!bpName.trim()} style={{ opacity: bpName.trim() ? 1 : 0.5 }}><LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12 }}><Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: '#fff' }}>Add</Text></LinearGradient></Pressable>
                  <Pressable onPress={() => { setBpOpen(false); setBpName(''); }} hitSlop={8}><Icon name="close" size={16} color={C.muted} strokeWidth={2.3} /></Pressable>
                </View>
              ) : (
                <Pressable onPress={() => setBpOpen(true)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 14, borderWidth: 1.5, borderStyle: 'dashed', borderColor: hexA(C.orange, 0.32), backgroundColor: hexA(C.orange, 0.05) }}><Icon name="plus" size={16} color={C.orange} strokeWidth={2.6} /><Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: C.orange }}>Add Body Part / Workout</Text></Pressable>
              )
            ) : null}
            {!isActivity && sections.length === 0 && !bpOpen ? <Body style={{ fontSize: 12, color: C.muted3, textAlign: 'center', marginTop: -4 }}>Add a body part (Chest, Legs, Upper Body…), then pick exercises under it.</Body> : null}

            {saveM.isError ? <Body style={{ fontSize: 12, color: C.red }}>{(saveM.error as Error).message}</Body> : null}
          </ScrollView>

          <View style={{ position: 'absolute', left: 18, right: 18, bottom: (kbH > 0 ? kbH + 10 : insets.bottom + 12) }}>
            <Pressable onPress={save} disabled={!canSave} style={{ opacity: canSave ? 1 : 0.45 }}>
              <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 15, borderRadius: 14 }}>
                <Icon name="checks" size={16} color="#fff" strokeWidth={2.6} />
                <Text style={{ fontFamily: F.bodyBold, fontSize: 14.5, color: '#fff' }}>{saveM.isPending ? 'Saving…' : 'Save Template'}</Text>
              </LinearGradient>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/* ============ QHP / ASSESSMENTS ============ */
type QhpEntry = {
  init: string; name: string; status: string; sc: string; refresh: string; client: string;
  when: string; overdue: string; av: [string, string];
};

/* Bottom-sheet form: Schedule New QHP */
function QhpScheduleSheet({ visible, onClose, onSchedule }: { visible: boolean; onClose: () => void; onSchedule: (e: QhpEntry) => void }) {
  const insets = useSafeAreaInsets();
  const [assessor, setAssessor] = React.useState<string | null>(null);
  const [assessorOpen, setAssessorOpen] = React.useState(false);
  const [clientType, setClientType] = React.useState<'new' | 'existing'>('new');
  const [date, setDate] = React.useState('6 Jul 2026');
  const [hour, setHour] = React.useState('9');
  const [minute, setMinute] = React.useState('00');
  const [ampm, setAmpm] = React.useState<'AM' | 'PM'>('AM');
  const [loc, setLoc] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [kbH, setKbH] = React.useState(0);
  React.useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const s = Keyboard.addListener(showEvt, (e: any) => setKbH(e.endCoordinates?.height ?? 0));
    const h = Keyboard.addListener(hideEvt, () => setKbH(0));
    return () => { s.remove(); h.remove(); };
  }, []);

  const HOURS = ['6', '7', '8', '9', '10', '11', '12', '1', '2', '3', '4', '5'];
  const MINS = ['00', '15', '30', '45'];
  const cycle = (arr: string[], cur: string, set: (v: string) => void) => set(arr[(arr.indexOf(cur) + 1) % arr.length]);

  const fieldLabel = (t: string) => (
    <Mono style={{ fontSize: 10, letterSpacing: 1.4, color: C.mono2, marginBottom: 7 }}>{t}</Mono>
  );
  const inputBox = { paddingVertical: 13, paddingHorizontal: 14, borderRadius: 13, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.03)' };

  const schedule = () => {
    onSchedule({
      init: clientType === 'new' ? 'NC' : 'EC',
      name: clientType === 'new' ? 'New Client QHP' : 'Existing Client QHP',
      status: 'Scheduled', sc: C.blue,
      refresh: 'Baseline', client: clientType === 'new' ? 'New client' : 'Existing client',
      when: `${date} · ${hour}:${minute} ${ampm} · ${loc.trim() || 'Location TBD'}`,
      overdue: assessor ? `Assessor ${assessor}` : 'Unassigned',
      av: ['#7C8FE8', '#5B6FD0'],
    });
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}>
        <Pressable onPress={() => {}} style={{ height: '88%', backgroundColor: '#0E0A09', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.14)', paddingHorizontal: 18, paddingTop: 14 }}>
          <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 14 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
            <View style={{ flex: 1 }}>
              <Serif style={{ fontSize: 22 }}>Schedule New QHP</Serif>
              <Body style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>Schedule a new QHP and assign it to a trainer.</Body>
            </View>
            <Pressable onPress={onClose} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="close" size={14} color="#B8B2AC" strokeWidth={2.3} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: (kbH > 0 ? kbH : insets.bottom) + 24, gap: 15 }} keyboardShouldPersistTaps="handled">
            {/* Assessor */}
            <View>
              {fieldLabel('SELECT ASSESSOR')}
              <Pressable onPress={() => setAssessorOpen(!assessorOpen)} style={[inputBox, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
                <Body style={{ fontSize: 14, color: assessor ? '#fff' : C.muted3 }}>{assessor ?? 'Select an assessor'}</Body>
                <Icon name={assessorOpen ? 'chevUp' : 'chevDown'} size={15} color={C.muted} strokeWidth={2.2} />
              </Pressable>
              {assessorOpen ? (
                <View style={{ marginTop: 7, borderRadius: 13, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: '#14100D', overflow: 'hidden' }}>
                  {['Khalid Ahmad', 'Anil Kumar', 'Pooja Nair'].map((a, i) => (
                    <Pressable key={a} onPress={() => { setAssessor(a); setAssessorOpen(false); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 13, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: 'rgba(255,255,255,0.05)', backgroundColor: assessor === a ? hexA(C.orange, 0.08) : 'transparent' }}>
                      <Icon name="user" size={14} color={assessor === a ? C.orange : C.muted} strokeWidth={2} />
                      <Body style={{ flex: 1, fontSize: 13.5, color: assessor === a ? C.orange : C.ink }}>{a}</Body>
                      {assessor === a ? <Icon path="M20 6 9 17l-5-5" size={14} color={C.orange} strokeWidth={2.6} /> : null}
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>

            {/* Client type */}
            <View>
              {fieldLabel('CLIENT TYPE')}
              <View style={{ flexDirection: 'row', gap: 9 }}>
                {([['new', 'New Client'], ['existing', 'Existing Client']] as const).map(([id, label]) => {
                  const active = clientType === id;
                  return (
                    <Pressable key={id} onPress={() => setClientType(id)} style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 13, backgroundColor: active ? hexA(C.orange, 0.13) : 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: active ? hexA(C.orange, 0.4) : 'rgba(255,255,255,0.08)' }}>
                      <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 13, color: active ? C.orange : C.muted }}>{label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Date */}
            <View>
              {fieldLabel('QHP DATE')}
              <View style={[inputBox, { flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
                <Icon name="calendar" size={15} color={C.orange} strokeWidth={2} />
                <TextInput value={date} onChangeText={setDate} placeholder="Pick a date" placeholderTextColor={C.muted3} style={{ flex: 1, color: '#fff', fontFamily: F.body, fontSize: 14, padding: 0 }} />
              </View>
            </View>

            {/* Time */}
            <View>
              {fieldLabel('QHP TIME')}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                <Icon name="clock" size={16} color={C.muted2} strokeWidth={2} />
                <Pressable onPress={() => cycle(HOURS, hour, setHour)} style={[inputBox, { flex: 1, alignItems: 'center' }]}>
                  <Text style={{ fontFamily: F.mono, fontSize: 15, color: '#fff' }}>{hour}</Text>
                </Pressable>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 16, color: C.muted3 }}>:</Text>
                <Pressable onPress={() => cycle(MINS, minute, setMinute)} style={[inputBox, { flex: 1, alignItems: 'center' }]}>
                  <Text style={{ fontFamily: F.mono, fontSize: 15, color: '#fff' }}>{minute}</Text>
                </Pressable>
                <Pressable onPress={() => setAmpm(ampm === 'AM' ? 'PM' : 'AM')} style={[inputBox, { flex: 1, alignItems: 'center', backgroundColor: hexA(C.orange, 0.1), borderColor: hexA(C.orange, 0.35) }]}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: C.orange }}>{ampm}</Text>
                </Pressable>
              </View>
              <Mono style={{ fontSize: 9, color: C.muted3, marginTop: 6 }}>Tap hour / minutes / period to change</Mono>
            </View>

            {/* Location */}
            <View>
              {fieldLabel('LOCATION')}
              <View style={[inputBox, { flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
                <Icon name="pin" size={15} color={C.muted2} strokeWidth={2} />
                <TextInput value={loc} onChangeText={setLoc} placeholder="Enter QHP location" placeholderTextColor={C.muted3} style={{ flex: 1, color: '#fff', fontFamily: F.body, fontSize: 14, padding: 0 }} />
              </View>
            </View>

            {/* Notes */}
            <View>
              {fieldLabel('NOTES (OPTIONAL)')}
              <TextInput
                value={notes}
                onChangeText={setNotes}
                placeholder="Add any additional notes about the assessment"
                placeholderTextColor={C.muted3}
                multiline
                style={[inputBox, { minHeight: 84, textAlignVertical: 'top', color: '#fff', fontFamily: F.body, fontSize: 14 }]}
              />
            </View>

            {/* Actions */}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
              <Pressable onPress={onClose} style={{ flex: 1, alignItems: 'center', paddingVertical: 14, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
                <Text style={{ fontFamily: F.bodySemi, fontSize: 14, color: C.ink3 }}>Cancel</Text>
              </Pressable>
              <Pressable onPress={schedule} style={{ flex: 1.6 }}>
                <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ alignItems: 'center', paddingVertical: 14, borderRadius: 14 }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: '#fff' }}>Schedule Assessment</Text>
                </LinearGradient>
              </Pressable>
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/* QHP display helpers (assessment_date 'YYYY-MM-DD', assessment_time 'HH:MM:SS', IST wall values). */
const qhpDate = (d: string | null) =>
  d ? new Date(`${d}T00:00:00+05:30`).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : 'Date TBD';
/* Health-report dates arrive as either plain 'YYYY-MM-DD' or full ISO timestamps; web shows dd-MMM-yyyy. */
const repDate = (d: string | null) => {
  if (!d) return '—';
  const dt = new Date(d.includes('T') ? d : `${d}T00:00:00+05:30`);
  return isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');
};
const qhpTime = (t: string | null) => {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};
const QHP_AVS: [string, string][] = [['#9A7BEA', '#6E5BD0'], ['#57C98A', '#3A9E6E'], ['#FB8B3A', '#EE5E16'], ['#7C8FE8', '#5B6FD0'], ['#E0A53C', '#B57F1E'], ['#E75A9B', '#B03A6E']];

export function Qhp() {
  // Web shows the UNION of assessor + report-creator tabs on one page. Natively:
  // - assessor only            → assessor view
  // - reports only (Furqan)    → report-generator view
  // - BOTH (e.g. Rajat Sharma) → mode switcher between the two full views
  const qhpCaps = useMyCapabilities();
  const isAssessor = qhpCaps.data.canConductAssessments;
  const hasReports = qhpCaps.data.canViewAllAssessments || qhpCaps.data.qhpReportCreator;
  const [qhpMode, setQhpMode] = React.useState<'assess' | 'reports' | null>(null);
  // Report creators land on the Reports Desk by default (web defaults them to Without-Report).
  const mode: 'assess' | 'reports' = qhpMode ?? (qhpCaps.data.qhpReportCreator ? 'reports' : 'assess');
  if (!qhpCaps.isLoading && !isAssessor && hasReports) return <QhpReports />;
  if (!qhpCaps.isLoading && isAssessor && hasReports) {
    return (
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', gap: 6, marginHorizontal: 18, marginTop: 10, padding: 4, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.3)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }}>
          {(([['assess', 'My Assessments'], ['reports', 'Reports Desk']]) as ['assess' | 'reports', string][]).map(([id, label]) => {
            const active = mode === id;
            return (
              <Pressable key={id} onPress={() => setQhpMode(id)} style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10, overflow: 'hidden', backgroundColor: active ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                {active ? <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} /> : null}
                <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 12, color: active ? '#fff' : C.muted }}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
        {mode === 'assess' ? <QhpAssessor /> : <QhpReports />}
      </View>
    );
  }
  return <QhpAssessor />;
}

function QhpAssessor() {
  const [qhpView, setQhpView] = React.useState<'upcoming' | 'completed' | 'noreport' | 'missing'>('upcoming');
  const [formOpen, setFormOpen] = React.useState(false);

  // Assessments are keyed by the signed-in assessor (coach_id = auth uid); the
  // shared test account falls back to the dev trainer like the dashboard does.
  const { session } = useAuth();
  const isTestAccount = session?.user?.email?.startsWith('rn-test-trainer');
  const trainerId = !session ? '' : isTestAccount ? DEV_TRAINER_ID : session.user.id;

  const listsQ = useQhpAssessments(trainerId);
  const permsQ = useQhpPermissions(trainerId);
  const connectQ = useQhpConnectAlerts(trainerId);
  const connectM = useMarkQhpConnected();
  const canSchedule = !!permsQ.data?.canScheduleForOthers;

  const upcoming = listsQ.data?.upcoming ?? [];
  const completedList = listsQ.data?.completedList ?? [];
  const withoutReport = listsQ.data?.withoutReport ?? [];
  const dataMissing = listsQ.data?.dataMissing ?? [];
  const todayIso = istDate();

  // Capture client's home location from a QHP card (same flow as client detail;
  // pin shows only while clients.brb_location is null, hides once captured).
  const saveHomeLocM = useSaveClientHomeLocation();
  const [capturingHomeFor, setCapturingHomeFor] = React.useState<string | null>(null);
  const qhpQc = useQueryClient();
  const captureHomeFor = async (clientId: string, clientName: string) => {
    setCapturingHomeFor(clientId);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission needed', "Allow location access to capture the client's home location.");
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      await saveHomeLocM.mutateAsync({ clientId, lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy ?? null });
      qhpQc.invalidateQueries({ queryKey: ['qhp-assessments'] }); // hide the pin on this card
      Alert.alert('Location saved', `${clientName}'s home location has been captured.`);
    } catch (e: any) {
      Alert.alert('Could not capture', e?.message ?? 'Turn on GPS and try again.');
    } finally {
      setCapturingHomeFor(null);
    }
  };
  const confirmCaptureFor = (clientId: string, clientName: string) =>
    Alert.alert(
      "Capture client's home location?",
      `Do you want to capture the location of ${clientName}'s home? Your current position will be saved — make sure you are at the client's home right now.`,
      [{ text: 'Cancel', style: 'cancel' }, { text: 'OK, Capture', onPress: () => captureHomeFor(clientId, clientName) }]
    );

  // Web-parity card features (upcoming tab)
  const parqQ = useParqLinks(upcoming.map((u) => ({ id: u.id, client_id: u.client_id })));
  const parqGenM = useGenerateParqLink();
  const reschedReqM = useRequestQhpReschedule();
  const [reschedFor, setReschedFor] = React.useState<import('../lib/qhpQueries').QhpRow | null>(null);
  const [rrDay, setRrDay] = React.useState(0);
  const [rrHour, setRrHour] = React.useState('9');
  const [rrMin, setRrMin] = React.useState('00');
  const [rrAmpm, setRrAmpm] = React.useState<'AM' | 'PM'>('AM');
  const [rrRemark, setRrRemark] = React.useState('');
  const submitReschedReq = () => {
    if (!reschedFor || rrRemark.trim().length < 10) return;
    const d = new Date(Date.now() + rrDay * 864e5);
    const p = (n: number) => String(n).padStart(2, '0');
    let h = Number(rrHour) % 12;
    if (rrAmpm === 'PM') h += 12;
    reschedReqM.mutate(
      {
        assessmentId: reschedFor.id,
        clientName: reschedFor.client_name ?? 'Client',
        requestedBy: trainerId,
        proposedDate: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
        proposedTime: `${p(h)}:${rrMin}:00`,
        remark: rrRemark,
      },
      { onSuccess: () => { setReschedFor(null); setRrRemark(''); } }
    );
  };
  const [medFor, setMedFor] = React.useState<{ id: string; name: string } | null>(null);
  const medQ = useClientMedicalHistory(medFor?.id ?? null);
  const medRepsQ = useClientHealthReports(medFor?.id ?? null);
  const [medPreview, setMedPreview] = React.useState<HealthReportItem | null>(null);
  const closeMedSheet = () => { setMedPreview(null); setMedFor(null); };
  // Swipe-down dismiss for the report preview popup (drag zone = handle + header; the
  // WebView/Image body keeps its own touches for scrolling/zooming).
  const medPrevY = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => { if (medPreview) medPrevY.setValue(0); }, [medPreview, medPrevY]);
  const medPrevPan = React.useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => g.dy > 8 && Math.abs(g.dy) > Math.abs(g.dx) * 1.4,
      onPanResponderMove: (_e, g) => medPrevY.setValue(Math.max(0, g.dy)),
      onPanResponderRelease: (_e, g) => {
        if (g.dy > 90 || g.vy > 0.5) {
          Animated.timing(medPrevY, { toValue: 700, duration: 170, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(() => setMedPreview(null));
        } else {
          Animated.spring(medPrevY, { toValue: 0, bounciness: 5, useNativeDriver: true }).start();
        }
      },
      onPanResponderTerminate: () => { Animated.spring(medPrevY, { toValue: 0, bounciness: 5, useNativeDriver: true }).start(); },
    })
  ).current;
  const [credsQhpFor, setCredsQhpFor] = React.useState<{ clientId: string; name: string } | null>(null);
  const [credsQhpCopied, setCredsQhpCopied] = React.useState(false);
  const credsQhpQ = useClientCredentials(credsQhpFor);
  const [copiedParq, setCopiedParq] = React.useState<string | null>(null);
  // Start Now flow (web: Coach Presence Check → resolve prior QHP → standardized form)
  const [presenceFor, setPresenceFor] = React.useState<import('../lib/qhpQueries').QhpRow | null>(null);
  const [formFor, setFormFor] = React.useState<{ row: import('../lib/qhpQueries').QhpRow; isExisting: boolean } | null>(null);
  const [startingId, setStartingId] = React.useState<string | null>(null);
  const startQc = useQueryClient();
  const onPresenceConfirm = async (supportingTrainerId: string | null) => {
    const row = presenceFor;
    if (!row || startingId) return;
    // Do the async work while the presence modal is still up (spinner on its button),
    // then close it and open the form AFTER the dismiss animation settles — iOS
    // deadlocks if a new Modal presents while another is mid-dismiss.
    setStartingId(row.id);
    // Save supporting trainer (web: fire-and-log, non-blocking on failure)
    try { await supabase.from('coach_assessment').update({ supporting_trainer_id: supportingTrainerId }).eq('id', row.id); } catch {}
    let isExisting = false;
    if (row.client_id) {
      try { isExisting = await fetchHasPriorCompletedQHP(row.client_id, row.id); } catch {}
    }
    setPresenceFor(null);
    setTimeout(() => {
      setFormFor({ row, isExisting });
      setStartingId(null);
    }, 550);
  };
  // My QHPs tab (web MyAssessmentsTab parity)
  const [qhpSearch, setQhpSearch] = React.useState('');
  // HeartMath quick-add (web AddHeartMathDialog — patch a completed QHP missing HeartMath)
  const heartMathM = useAddHeartMath();
  const [hmFor, setHmFor] = React.useState<{ id: string; name: string } | null>(null);
  const [hmVals, setHmVals] = React.useState({ MHRR: '', SDNN: '', RMSSD: '', normalizedCoherence: '' });
  const [detailFor, setDetailFor] = React.useState<{ id: string; mode: 'details' | 'ai' } | null>(null);
  const qhpDetailQ = useQhpReviewDetail(detailFor?.id ?? null);
  const [briefingFor, setBriefingFor] = React.useState<import('../lib/qhpQueries').QhpRow | null>(null);

  const listState = (emptyText: string, count: number) =>
    listsQ.isLoading ? (
      <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 24 }}>Loading QHPs…</Body>
    ) : listsQ.isError ? (
      <Body style={{ fontSize: 12.5, color: C.red, textAlign: 'center', paddingVertical: 24 }}>Couldn't load ({(listsQ.error as Error).message}).</Body>
    ) : count === 0 ? (
      <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 24 }}>{emptyText}</Body>
    ) : null;

  return (
    <Page gap={18} pt={6}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Serif style={{ fontSize: 26 }}>QHP</Serif>
          <Body style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>
            {canSchedule ? 'Schedule and manage client QHPs' : 'Complete assigned client QHPs'}
          </Body>
        </View>
        {canSchedule ? (
          <Pressable onPress={() => setFormOpen(true)}>
            <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 11, paddingHorizontal: 15, borderRadius: 14 }}>
              <Icon name="plus" size={15} color="#fff" strokeWidth={2.6} />
              <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: '#fff' }}>Schedule QHP</Text>
            </LinearGradient>
          </Pressable>
        ) : null}
      </View>

      {/* Overview strip — live counts */}
      <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.09)" radius={20} style={{ padding: 16, flexDirection: 'row', alignItems: 'center' }}>
        {([
          [upcoming.length, 'UPCOMING', C.blue],
          [completedList.length, 'COMPLETED', C.green],
          [withoutReport.length, 'NO REPORT', C.gold],
          [dataMissing.length, 'MISSING', C.red],
        ] as const).map(([n, lab, col], i) => (
          <React.Fragment key={lab}>
            {i > 0 ? <View style={{ width: 1, height: 32, backgroundColor: 'rgba(255,255,255,0.07)' }} /> : null}
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Serif style={{ fontSize: 24, color: col }}>{listsQ.isLoading ? '…' : n}</Serif>
              <Mono style={{ fontSize: 8, color: C.muted3, marginTop: 3 }}>{lab}</Mono>
            </View>
          </React.Fragment>
        ))}
      </Card>

      {/* "Have you connected?" prompts — live, one row per newly assigned QHP */}
      {(connectQ.data ?? []).map((a) => (
        <View key={a.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: 12, borderRadius: 15, backgroundColor: hexA(C.blue, 0.08), borderWidth: 1, borderColor: hexA(C.blue, 0.26) }}>
          <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: hexA(C.blue, 0.16), alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="userPlus" size={15} color={C.blue} strokeWidth={2} />
          </View>
          <View style={{ flex: 1 }}>
            <Body style={{ fontSize: 12.5, fontFamily: F.bodySemi, color: '#fff' }}>New QHP assigned — {a.client_name}</Body>
            <Mono style={{ fontSize: 9.5, color: C.muted2, marginTop: 1 }}>
              {[qhpDate(a.assessment_date), qhpTime(a.assessment_time), a.location].filter(Boolean).join(' · ')}
            </Mono>
            <Mono style={{ fontSize: 9.5, color: '#A9BCFF', marginTop: 1 }}>Have you connected with the client?</Mono>
          </View>
          <Pressable
            onPress={() => connectM.mutate(a.id)}
            disabled={connectM.isPending}
            style={{ paddingVertical: 8, paddingHorizontal: 16, borderRadius: 10, backgroundColor: hexA(C.blue, 0.16), borderWidth: 1, borderColor: hexA(C.blue, 0.4), opacity: connectM.isPending ? 0.6 : 1 }}
          >
            <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: '#A9BCFF' }}>{connectM.isPending ? '…' : 'Yes'}</Text>
          </Pressable>
        </View>
      ))}

      {/* Underline tabs — live counts */}
      <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.07)' }}>
        {([
          ['upcoming', 'Upcoming', upcoming.length, C.blue],
          ['completed', 'My QHPs', completedList.length, C.green],
          ['noreport', 'No Report', withoutReport.length, C.gold],
          ['missing', 'Missing', dataMissing.length, C.red],
        ] as const).map(([id, label, count, col]) => {
          const active = qhpView === id;
          return (
            <Pressable key={id} onPress={() => setQhpView(id)} style={{ flex: 1, alignItems: 'center', paddingVertical: 11 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 12.5, color: active ? C.orange : C.muted }}>{label}</Text>
                {count && !listsQ.isLoading ? <Text style={{ fontFamily: F.mono, fontSize: 10.5, color: col }}>{count}</Text> : null}
              </View>
              <View style={{ position: 'absolute', bottom: -1, left: '18%', right: '18%', height: 2.5, borderRadius: 2, backgroundColor: active ? C.orange : 'transparent' }} />
            </Pressable>
          );
        })}
      </View>

      {qhpView === 'upcoming' ? (
        <>
          {listState('No upcoming QHPs — you are all caught up.', upcoming.length)}
          {upcoming.map((q, i) => {
            const isPastDue = !!q.assessment_date && q.assessment_date < todayIso;
            // Web timing block: assigned = assessment.created_at; onboarded = clients.created_at.
            const assignedMins = q.created_at ? Math.max(0, Math.floor((Date.now() - new Date(q.created_at).getTime()) / 60000)) : 0;
            const onboardMins = q.client_created_at ? Math.max(0, Math.floor((Date.now() - new Date(q.client_created_at).getTime()) / 60000)) : null;
            const progressMins = onboardMins ?? assignedMins;
            const overTarget = progressMins > QHP_TARGET_MINS;
            const progressPct = Math.min((progressMins / QHP_TARGET_MINS) * 100, 100);
            const remainingMins = Math.max(QHP_TARGET_MINS - progressMins, 0);
            const urg = qhpUrgency(assignedMins);
            const urgCol = urg.level === 'red' ? C.red : urg.level === 'amber' ? C.gold : C.green;
            const barCol = overTarget ? C.red : progressPct > 66 ? C.gold : C.green;
            const parqLink = parqQ.data?.linkByAssessment[q.id] ?? null;
            const parqSigned = q.client_id ? parqQ.data?.signedByClient[q.client_id] ?? null : null;
            return (
              <View key={q.id} style={{ borderRadius: 20, backgroundColor: 'rgba(20,14,12,0.72)', borderWidth: 1, borderColor: hexA(urgCol, 0.18), borderLeftWidth: 4, borderLeftColor: urgCol, padding: 16, gap: 12 }}>
                {/* Header */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <Avatar initial={initials(q.client_name ?? 'C')} size={44} colors={QHP_AVS[i % QHP_AVS.length]} fontSize={15} />
                  <View style={{ flex: 1 }}>
                    <Serif style={{ fontSize: 18 }} numberOfLines={1}>{q.client_name ?? 'Client'}</Serif>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
                      <Badge text={q.label} color={C.gold} />
                      <Badge text={q.client_type} color={q.client_type === 'New Client' ? C.green : C.blue} />
                    </View>
                  </View>
                  {q.client_id && !q.home_captured ? (
                    <Pressable
                      onPress={capturingHomeFor ? undefined : () => confirmCaptureFor(q.client_id!, q.client_name ?? 'Client')}
                      hitSlop={6}
                      style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: hexA(C.green, 0.13), borderWidth: 1, borderColor: hexA(C.green, 0.4), alignItems: 'center', justifyContent: 'center' }}
                    >
                      {capturingHomeFor === q.client_id ? <ActivityIndicator size="small" color={C.green} /> : <Icon name="pin" size={15} color={C.green} strokeWidth={2} />}
                    </Pressable>
                  ) : null}
                  {isPastDue ? <Badge text="⚠ Due" color={C.red} /> : <Badge text="Pending" color={C.gold} />}
                </View>

                {/* When / where / phone */}
                <View style={{ gap: 6 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Icon name="calendar" size={13} color={C.orange} strokeWidth={2} />
                    <Body style={{ flex: 1, fontSize: 12.5, color: '#fff', fontFamily: F.bodySemi }}>
                      {qhpDate(q.assessment_date)}{qhpTime(q.assessment_time) ? `  ·  ${qhpTime(q.assessment_time)}` : '  ·  Time not set'}
                    </Body>
                  </View>
                  {q.location ? (
                    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                      <View style={{ marginTop: 2 }}><Icon name="pin" size={13} color={C.muted2} strokeWidth={2} /></View>
                      <Body style={{ flex: 1, fontSize: 12, color: C.ink3, lineHeight: 17 }}>{q.location}</Body>
                    </View>
                  ) : null}
                </View>

                {q.reschedule_status === 'pending' ? <Badge text="Reschedule pending review" color={C.gold} /> : null}
                {q.reschedule_status === 'rejected' ? <Badge text="Reschedule rejected" color={C.red} /> : null}

                {/* Timing block — 36h target (web parity) */}
                <View style={{ gap: 7, paddingTop: 9, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' }}>
                  {onboardMins != null ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                      <Icon name="clock" size={11} color={C.muted3} strokeWidth={2} />
                      <Body style={{ fontSize: 11, color: C.muted2 }}>Client onboarded  <Text style={{ color: '#fff', fontFamily: F.bodySemi }}>{qhpFormatDuration(onboardMins)}</Text>  ago</Body>
                    </View>
                  ) : null}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                    <Icon name="clock" size={11} color={C.muted3} strokeWidth={2} />
                    <Body style={{ fontSize: 11, color: C.muted2 }}>QHP assigned  <Text style={{ color: '#fff', fontFamily: F.bodySemi }}>{qhpFormatDuration(assignedMins)}</Text>  ago</Body>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Mono style={{ fontSize: 9.5, color: overTarget ? C.red : C.muted3 }}>
                      {overTarget ? `⚠ Overdue by ${qhpFormatDuration(progressMins - QHP_TARGET_MINS)}` : `${qhpFormatDuration(remainingMins)} remaining`}
                    </Mono>
                    <Mono style={{ fontSize: 9.5, color: C.muted3 }}>36h target</Mono>
                  </View>
                  <ProgressBar pct={progressPct} height={5} fill={barCol} />
                  {urg.warning ? <Body style={{ fontSize: 11, fontFamily: F.bodySemi, color: urgCol }}>{urg.warning}</Body> : null}
                </View>

                {/* Actions */}
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Pressable onPress={() => setPresenceFor(q)} style={{ flex: 1.4, borderRadius: 11, overflow: 'hidden' }}>
                    <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10 }}>
                      <Icon name="clipboard" size={13} color="#fff" strokeWidth={2.4} />
                      <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: '#fff' }}>Start Now</Text>
                    </LinearGradient>
                  </Pressable>
                  <Pressable
                    onPress={() => { if (q.reschedule_status !== 'pending') { setReschedFor(q); setRrDay(0); setRrHour('9'); setRrMin('00'); setRrAmpm('AM'); setRrRemark(''); } }}
                    style={{ flex: 1.2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 11, backgroundColor: hexA(C.blue, 0.12), borderWidth: 1, borderColor: hexA(C.blue, 0.4), opacity: q.reschedule_status === 'pending' ? 0.55 : 1 }}
                  >
                    <Icon name="calendar" size={13} color={C.blue} strokeWidth={2.2} />
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: C.blue }}>{q.reschedule_status === 'pending' ? 'Pending' : 'Reschedule'}</Text>
                  </Pressable>
                  {q.client_id ? (
                    <Pressable onPress={() => { setCredsQhpCopied(false); setCredsQhpFor({ clientId: q.client_id!, name: q.client_name ?? 'Client' }); }} style={{ width: 40, alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}>
                      <Icon name="copy" size={14} color={C.ink3} strokeWidth={2} />
                    </Pressable>
                  ) : null}
                </View>
                {q.client_id ? (
                  <Pressable onPress={() => setMedFor({ id: q.client_id!, name: q.client_name ?? 'Client' })} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 10, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
                    <Icon name="heart" size={13} color={C.ink3} strokeWidth={2} />
                    <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: C.ink3 }}>Medical History</Text>
                  </Pressable>
                ) : null}

                {/* PAR-Q+ section (web parity) */}
                {parqSigned ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 8, paddingHorizontal: 11, borderRadius: 11, backgroundColor: hexA(C.green, 0.08), borderWidth: 1, borderColor: hexA(C.green, 0.25) }}>
                    <Icon path="M20 6 9 17l-5-5" size={13} color={C.green} strokeWidth={2.6} />
                    <Body style={{ flex: 1, fontSize: 11.5, color: C.green }}>PAR-Q+ already signed on {qhpDate(parqSigned)}</Body>
                  </View>
                ) : parqLink ? (
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <View style={{ flex: 1, justifyContent: 'center', paddingVertical: 9, paddingHorizontal: 11, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
                      <Text numberOfLines={1} style={{ fontFamily: F.mono, fontSize: 10.5, color: C.muted2 }}>{parqLink}</Text>
                    </View>
                    <Pressable
                      onPress={async () => { await Clipboard.setStringAsync(parqLink); setCopiedParq(q.id); setTimeout(() => setCopiedParq(null), 2000); }}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 13, borderRadius: 11, backgroundColor: hexA(C.blue, 0.12), borderWidth: 1, borderColor: hexA(C.blue, 0.4) }}
                    >
                      <Icon name={copiedParq === q.id ? 'checks' : 'copy'} path={copiedParq === q.id ? 'M20 6 9 17l-5-5' : undefined} size={13} color={C.blue} strokeWidth={2.2} />
                      <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: C.blue }}>{copiedParq === q.id ? 'Copied' : 'Copy'}</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Pressable
                    onPress={() => parqGenM.mutate({ assessmentId: q.id, clientId: q.client_id, clientName: q.client_name ?? 'Client', witnessId: trainerId }, { onSuccess: async (link) => { await Clipboard.setStringAsync(link); setCopiedParq(q.id); setTimeout(() => setCopiedParq(null), 2000); } })}
                    disabled={parqGenM.isPending}
                    style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 10, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', opacity: parqGenM.isPending ? 0.6 : 1 }}
                  >
                    <Icon name="layers" size={13} color={C.ink3} strokeWidth={2} />
                    <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: C.ink3 }}>{parqGenM.isPending ? 'Generating…' : copiedParq === q.id ? 'Link copied!' : 'Generate PAR-Q+ Link'}</Text>
                  </Pressable>
                )}
              </View>
            );
          })}
        </>
      ) : qhpView === 'completed' ? (
        <>
          {/* Search (web parity) */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
            <Icon name="search" size={15} color={C.muted3} strokeWidth={2} />
            <TextInput value={qhpSearch} onChangeText={setQhpSearch} placeholder="Search QHPs…" placeholderTextColor={C.muted3} style={{ flex: 1, fontFamily: F.body, fontSize: 13.5, color: '#fff', padding: 0 }} />
          </View>
          {listState('No completed QHPs yet — completed QHPs appear here with AI analysis.', completedList.length)}
          {completedList
            .filter((q) => !qhpSearch.trim() || (q.client_name ?? '').toLowerCase().includes(qhpSearch.trim().toLowerCase()))
            .slice(0, 40)
            .map((q, i) => (
              <View key={q.id} style={{ borderRadius: 18, backgroundColor: 'rgba(20,14,12,0.72)', borderWidth: 1, borderColor: hexA(C.green, 0.16), borderLeftWidth: 3, borderLeftColor: C.green, padding: 15, gap: 10 }}>
                {/* Header */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
                  <Avatar initial={initials(q.client_name ?? 'C')} size={40} colors={QHP_AVS[i % QHP_AVS.length]} fontSize={13} />
                  <View style={{ flex: 1 }}>
                    <Body style={{ fontSize: 15, fontFamily: F.bodySemi, color: '#fff' }} numberOfLines={1}>{q.client_name ?? 'Client'}</Body>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                      <Badge text={q.label} color={C.gold} />
                      {q.heartmath_missing ? (
                        <Pressable onPress={() => { setHmVals({ MHRR: '', SDNN: '', RMSSD: '', normalizedCoherence: '' }); setHmFor({ id: q.id, name: q.client_name ?? 'Client' }); }}>
                          <Badge text="HeartMath Missing · Add" color={C.red} />
                        </Pressable>
                      ) : null}
                    </View>
                  </View>
                </View>
                {/* Meta */}
                <Body style={{ fontSize: 11.5, color: C.muted2, lineHeight: 17 }}>
                  {[qhpDate(q.assessment_date), qhpTime(q.assessment_time), q.location ? `📍 ${q.location}` : null].filter(Boolean).join('  ·  ')}
                </Body>
                {q.has_ai ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10, backgroundColor: hexA(C.blue, 0.08), borderWidth: 1, borderColor: hexA(C.blue, 0.22), alignSelf: 'flex-start' }}>
                    <Icon name="sparkle" size={11} color={C.blue} fill={C.blue} strokeWidth={0} />
                    <Text style={{ fontFamily: F.bodySemi, fontSize: 10.5, color: '#A9BCFF' }}>AI Analysis Available{q.mechanical_score != null ? ` · Score ${q.mechanical_score}` : ''}</Text>
                  </View>
                ) : (
                  <Body style={{ fontSize: 10.5, color: C.muted3 }}>AI analysis processing…</Body>
                )}
                {/* Actions */}
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {q.has_ai ? (
                    <Pressable onPress={() => setDetailFor({ id: q.id, mode: 'ai' })} style={{ flex: 1.4, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9, borderRadius: 11, backgroundColor: hexA(C.blue, 0.12), borderWidth: 1, borderColor: hexA(C.blue, 0.4) }}>
                      <Icon name="sparkle" size={12} color={C.blue} fill={C.blue} strokeWidth={0} />
                      <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: C.blue }}>AI Report</Text>
                    </Pressable>
                  ) : null}
                  <Pressable onPress={() => setDetailFor({ id: q.id, mode: 'details' })} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}>
                    <Icon path="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" size={13} color={C.ink3} strokeWidth={2} />
                    <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: C.ink3 }}>Details</Text>
                  </Pressable>
                  {q.client_id ? (
                    <>
                      <Pressable onPress={() => setMedFor({ id: q.client_id!, name: q.client_name ?? 'Client' })} style={{ width: 38, alignItems: 'center', justifyContent: 'center', paddingVertical: 9, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}>
                        <Icon name="heart" size={13} color={C.ink3} strokeWidth={2} />
                      </Pressable>
                      <Pressable onPress={() => { setCredsQhpCopied(false); setCredsQhpFor({ clientId: q.client_id!, name: q.client_name ?? 'Client' }); }} style={{ width: 38, alignItems: 'center', justifyContent: 'center', paddingVertical: 9, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}>
                        <Icon name="copy" size={13} color={C.ink3} strokeWidth={2} />
                      </Pressable>
                    </>
                  ) : null}
                </View>
                {q.health_briefing && q.label !== 'QHP Baseline' ? (
                  <Pressable onPress={() => setBriefingFor(q)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9, borderRadius: 11, backgroundColor: hexA(C.purple, 0.1), borderWidth: 1, borderColor: hexA(C.purple, 0.35) }}>
                    <Icon name="file" size={12} color={C.purple} strokeWidth={2} />
                    <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: C.purple }}>View Health Briefing</Text>
                  </Pressable>
                ) : null}
              </View>
            ))}

          {/* HeartMath quick-add modal (web AddHeartMathDialog contract) */}
          <Modal visible={!!hmFor} transparent animationType="fade" onRequestClose={() => setHmFor(null)}>
            <Pressable onPress={() => setHmFor(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', padding: 22 }}>
              <Pressable onPress={() => {}} style={{ borderRadius: 18, backgroundColor: '#141010', borderWidth: 1, borderColor: hexA(C.red, 0.3), padding: 18, gap: 12 }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: '#fff' }}>Add HeartMath Report</Text>
                <Body style={{ fontSize: 12, color: C.muted2 }}>{hmFor?.name} — enter the four HeartMath values.</Body>
                {(['MHRR', 'SDNN', 'RMSSD', 'normalizedCoherence'] as const).map((k) => (
                  <View key={k} style={{ gap: 5 }}>
                    <Mono style={{ fontSize: 9, letterSpacing: 1, color: C.mono2 }}>{k === 'normalizedCoherence' ? 'NORMALIZED COHERENCE' : k}</Mono>
                    <TextInput
                      value={hmVals[k]}
                      onChangeText={(v) => setHmVals((p) => ({ ...p, [k]: v }))}
                      keyboardType="decimal-pad"
                      placeholder="0.0"
                      placeholderTextColor={C.muted3}
                      style={{ borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', padding: 12, color: '#fff', fontFamily: F.mono, fontSize: 14 }}
                    />
                  </View>
                ))}
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Pressable onPress={() => setHmFor(null)} style={{ flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}><Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: C.muted }}>Cancel</Text></Pressable>
                  <Pressable
                    disabled={heartMathM.isPending || !Object.values(hmVals).every((v) => v.trim())}
                    onPress={async () => {
                      if (!hmFor) return;
                      try {
                        await heartMathM.mutateAsync({ assessmentId: hmFor.id, ...hmVals });
                        setHmFor(null);
                        Alert.alert('HeartMath added', 'The report was attached to the assessment.');
                      } catch (e: any) { Alert.alert('Failed to add HeartMath', e?.message ?? 'Unknown error'); }
                    }}
                    style={{ flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 12, backgroundColor: hexA(C.red, Object.values(hmVals).every((v) => v.trim()) ? 0.16 : 0.06), borderWidth: 1, borderColor: hexA(C.red, 0.4) }}
                  >
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: C.red }}>{heartMathM.isPending ? 'Saving…' : 'Save'}</Text>
                  </Pressable>
                </View>
              </Pressable>
            </Pressable>
          </Modal>
        </>
      ) : qhpView === 'noreport' ? (
        <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.09)" radius={20} style={{ paddingHorizontal: 16, paddingVertical: 6 }}>
          {listState('Every completed QHP has a report. Nice.', withoutReport.length)}
          {withoutReport.map((n, i) => (
            <View key={n.id} style={{ paddingVertical: 13, gap: 10, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: 'rgba(255,255,255,0.05)' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.gold }} />
                <View style={{ flex: 1 }}>
                  <Body style={{ fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }} numberOfLines={1}>{n.client_name ?? 'Client'}</Body>
                  <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 1 }} numberOfLines={1}>
                    Assessed {[qhpDate(n.assessment_date), n.location].filter(Boolean).join(' · ')}
                  </Body>
                </View>
                <Badge text="No Report" color={C.gold} />
              </View>
              {/* View QHP → same data sheet as the web's View QHP dialog */}
              <Pressable
                onPress={() => setDetailFor({ id: n.id, mode: 'details' })}
                style={{ marginLeft: 20, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 7, paddingHorizontal: 13, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}
              >
                <Icon name="eye" size={13} color="#E8E2DC" strokeWidth={2} />
                <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: '#E8E2DC' }}>View QHP</Text>
              </Pressable>
            </View>
          ))}
        </Card>
      ) : (
        <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.09)" radius={20} style={{ paddingHorizontal: 16, paddingVertical: 6 }}>
          {listState('No QHPs with missing data.', dataMissing.length)}
          {dataMissing.map((n, i) => (
            <View key={n.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: 'rgba(255,255,255,0.05)' }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.red }} />
              <View style={{ flex: 1 }}>
                <Body style={{ fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }} numberOfLines={1}>{n.client_name ?? 'Client'}</Body>
                <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 1 }} numberOfLines={1}>
                  Scheduled {[qhpDate(n.assessment_date), qhpTime(n.assessment_time)].filter(Boolean).join(' · ')} — no data captured
                </Body>
              </View>
              <Badge text="Data Missing" color={C.red} />
            </View>
          ))}
        </Card>
      )}

      <ScheduleQhpSheet visible={formOpen} onClose={() => setFormOpen(false)} scheduledBy={trainerId} />

      {/* Request reschedule (assessor → manager review) */}
      <Modal visible={!!reschedFor} transparent animationType="fade" onRequestClose={() => setReschedFor(null)}>
        <Pressable onPress={() => setReschedFor(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', padding: 22 }}>
          <Pressable onPress={() => {}} style={{ borderRadius: 18, backgroundColor: '#141010', borderWidth: 1, borderColor: hexA(C.blue, 0.3), padding: 18, gap: 12 }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: '#fff' }}>Request Reschedule</Text>
            <Body style={{ fontSize: 12, color: C.muted2 }}>{reschedFor?.client_name} — proposes a new slot; the QHP Manager reviews it.</Body>
            <Mono style={{ fontSize: 9.5, letterSpacing: 1.2, color: C.mono2 }}>PROPOSED DATE</Mono>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 7 }}>
              {Array.from({ length: 14 }, (_, di) => di).map((di) => {
                const d = new Date(Date.now() + di * 864e5);
                const act = rrDay === di;
                return (
                  <Pressable key={di} onPress={() => setRrDay(di)} style={{ alignItems: 'center', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 11, backgroundColor: act ? hexA(C.blue, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: act ? hexA(C.blue, 0.5) : 'rgba(255,255,255,0.08)' }}>
                    <Mono style={{ fontSize: 8.5, color: act ? C.blue : C.muted3 }}>{d.toLocaleDateString('en-IN', { weekday: 'short' }).toUpperCase()}</Mono>
                    <Text style={{ fontFamily: act ? F.bodyBold : F.bodySemi, fontSize: 13.5, color: act ? C.blue : C.ink3, marginTop: 1 }}>{d.getDate()}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <Mono style={{ fontSize: 9.5, letterSpacing: 1.2, color: C.mono2 }}>PROPOSED TIME</Mono>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
              <Pressable onPress={() => { const H = ['6', '7', '8', '9', '10', '11', '12', '1', '2', '3', '4', '5']; setRrHour(H[(H.indexOf(rrHour) + 1) % H.length]); }} style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
                <Text style={{ fontFamily: F.mono, fontSize: 15, color: '#fff' }}>{rrHour}</Text>
              </Pressable>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 16, color: C.muted3 }}>:</Text>
              <Pressable onPress={() => { const M = ['00', '15', '30', '45']; setRrMin(M[(M.indexOf(rrMin) + 1) % M.length]); }} style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
                <Text style={{ fontFamily: F.mono, fontSize: 15, color: '#fff' }}>{rrMin}</Text>
              </Pressable>
              <Pressable onPress={() => setRrAmpm(rrAmpm === 'AM' ? 'PM' : 'AM')} style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: hexA(C.blue, 0.1), borderWidth: 1, borderColor: hexA(C.blue, 0.35) }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: C.blue }}>{rrAmpm}</Text>
              </Pressable>
            </View>
            <Mono style={{ fontSize: 9.5, letterSpacing: 1.2, color: C.mono2 }}>REMARK (REQUIRED, MIN 10 CHARACTERS)</Mono>
            <TextInput
              value={rrRemark}
              onChangeText={setRrRemark}
              placeholder="Why does this QHP need to move?"
              placeholderTextColor={C.muted3}
              multiline
              style={{ minHeight: 60, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: rrRemark.trim().length >= 10 ? hexA(C.blue, 0.35) : 'rgba(255,255,255,0.1)', padding: 12, color: '#fff', fontFamily: F.body, fontSize: 13, textAlignVertical: 'top' }}
            />
            {reschedReqM.isError ? <Body style={{ fontSize: 11.5, color: C.red }}>{(reschedReqM.error as Error).message}</Body> : null}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable onPress={() => setReschedFor(null)} style={{ flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}><Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: C.muted }}>Cancel</Text></Pressable>
              <Pressable onPress={submitReschedReq} disabled={reschedReqM.isPending || rrRemark.trim().length < 10} style={{ flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 12, backgroundColor: hexA(C.blue, rrRemark.trim().length >= 10 ? 0.16 : 0.06), borderWidth: 1, borderColor: hexA(C.blue, rrRemark.trim().length >= 10 ? 0.45 : 0.2) }}><Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: rrRemark.trim().length >= 10 ? C.blue : C.muted3 }}>{reschedReqM.isPending ? 'Sending…' : 'Send Request'}</Text></Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Medical History sheet */}
      <Modal visible={!!medFor} transparent animationType="slide" onRequestClose={closeMedSheet}>
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable onPress={closeMedSheet} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)' }} />
          <View style={{ height: '82%', backgroundColor: '#0E0A09', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.14)', paddingHorizontal: 18, paddingTop: 14 }}>
            <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 12 }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 10 }}>
              <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: hexA(C.red, 0.12), borderWidth: 1, borderColor: hexA(C.red, 0.3), alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="heart" size={18} color={C.red} strokeWidth={1.9} />
              </View>
              <View style={{ flex: 1 }}>
                <Serif style={{ fontSize: 20 }}>Medical History</Serif>
                <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 2 }}>Clinical record for {medFor?.name}</Body>
              </View>
              <Pressable onPress={closeMedSheet} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="close" size={14} color="#B8B2AC" strokeWidth={2.3} />
              </Pressable>
            </View>
            {medQ.isPending || medRepsQ.isPending ? (
              <View style={{ paddingVertical: 30, alignItems: 'center', gap: 8 }}>
                <ActivityIndicator color={C.orange} />
                <Body style={{ fontSize: 11.5, color: C.muted2 }}>Loading medical record…</Body>
              </View>
            ) : (medQ.data ?? []).length === 0 && (medRepsQ.data ?? []).length === 0 ? (
              <View style={{ alignItems: 'center', paddingVertical: 30, gap: 8 }}>
                <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="clipboard" size={22} color={C.muted3} strokeWidth={1.7} />
                </View>
                <Body style={{ fontSize: 13, fontFamily: F.bodySemi, color: '#fff' }}>No medical history</Body>
                <Body style={{ fontSize: 11.5, color: C.muted3, textAlign: 'center', paddingHorizontal: 20 }}>This client has no recorded medical events or uploaded health reports. The treating doctor can add entries from the doctor dashboard.</Body>
              </View>
            ) : (
              <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24, gap: 10 }}>
                {(medRepsQ.data ?? []).length > 0 ? (
                  <View style={{ gap: 9 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                      <Icon name="file" size={13} color={C.blue} strokeWidth={2} />
                      <Mono style={{ fontSize: 10.5, letterSpacing: 1.8, color: C.mono }}>UPLOADED REPORTS</Mono>
                      <View style={{ minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, backgroundColor: hexA(C.gold, 0.15), borderWidth: 1, borderColor: hexA(C.gold, 0.4), alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ fontFamily: F.bodyBold, fontSize: 10.5, color: C.gold }}>{(medRepsQ.data ?? []).length}</Text>
                      </View>
                    </View>
                    <Body style={{ fontSize: 10.5, color: C.muted3 }}>Uploaded reports are stored separately from clinical history entries.</Body>
                    {(medRepsQ.data ?? []).map((r) => (
                      <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: 12, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: hexA(C.blue, 0.18) }}>
                        <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: hexA(C.blue, 0.12), borderWidth: 1, borderColor: hexA(C.blue, 0.3), alignItems: 'center', justifyContent: 'center' }}>
                          <Icon name="file" size={16} color={C.blue} strokeWidth={1.9} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text numberOfLines={1} style={{ fontFamily: F.bodySemi, fontSize: 13, color: '#fff' }}>{r.reportName}</Text>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 4, flexWrap: 'wrap' }}>
                            {r.reportType ? <Badge text={r.reportType} color={C.blue} /> : null}
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                              <Icon name="calendar" size={10} color={C.muted3} strokeWidth={2} />
                              <Body style={{ fontSize: 10.5, color: C.muted2 }}>{repDate(r.date)}</Body>
                            </View>
                          </View>
                        </View>
                        {r.fileUrl ? (
                          <Pressable onPress={() => setMedPreview(r)} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 11, backgroundColor: hexA(C.orange, 0.13), borderWidth: 1, borderColor: hexA(C.orange, 0.38) }}>
                            <Icon name="eye" size={13} color={C.orange} strokeWidth={2.1} />
                            <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: C.orange }}>Open</Text>
                          </Pressable>
                        ) : null}
                      </View>
                    ))}
                  </View>
                ) : null}
                {medRepsQ.isError ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 11, borderRadius: 12, backgroundColor: hexA(C.red, 0.08), borderWidth: 1, borderColor: hexA(C.red, 0.26) }}>
                    <Icon name="alert" size={13} color={C.red} strokeWidth={2.2} />
                    <Body style={{ flex: 1, fontSize: 11.5, color: '#E0A090' }}>Couldn't load uploaded reports: {(medRepsQ.error as Error).message}</Body>
                  </View>
                ) : null}
                {(medQ.data ?? []).length > 0 && (medRepsQ.data ?? []).length > 0 ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 4 }}>
                    <Icon name="clipboard" size={13} color={C.orange} strokeWidth={2} />
                    <Mono style={{ fontSize: 10.5, letterSpacing: 1.8, color: C.mono }}>CLINICAL HISTORY</Mono>
                  </View>
                ) : null}
                {(medQ.data ?? []).map((m) => {
                  const sevCol = m.severity === 'high' || m.severity === 'severe' ? C.red : m.severity === 'medium' || m.severity === 'moderate' ? C.gold : C.blue;
                  return (
                    <View key={m.id} style={{ padding: 13, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: hexA(sevCol, 0.2), borderLeftWidth: 3, borderLeftColor: sevCol, gap: 6 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                        <Body style={{ flex: 1, fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }} numberOfLines={1}>{m.title ?? 'Entry'}</Body>
                        {m.severity ? <Badge text={m.severity} color={sevCol} /> : null}
                        {m.isOngoing ? <Badge text="Ongoing" color={C.orange} /> : null}
                      </View>
                      {m.category ? <Mono style={{ fontSize: 9, letterSpacing: 0.6, color: C.muted3 }}>{m.category.toUpperCase()}</Mono> : null}
                      {m.description ? <Body style={{ fontSize: 12, color: C.ink3 }}>{m.description}</Body> : null}
                      {m.diagnosis ? <Body style={{ fontSize: 11.5, color: C.muted2 }}>Diagnosis: {m.diagnosis}</Body> : null}
                      {m.treatment ? <Body style={{ fontSize: 11.5, color: C.muted2 }}>Treatment: {m.treatment}</Body> : null}
                      <Body style={{ fontSize: 10.5, color: C.muted3 }}>{m.event_date ? qhpDate(m.event_date) : ''}{m.doctorName ? ` · Dr ${m.doctorName}` : ''}</Body>
                    </View>
                  );
                })}
              </ScrollView>
            )}
            <View style={{ paddingVertical: 10, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' }}>
              <Body style={{ fontSize: 10.5, color: C.muted3, textAlign: 'center' }}>Read-only view. Updates are made by treating doctors.</Body>
            </View>
          </View>

          {/* Report preview popup (nested so it stacks above the sheet on iOS) */}
          <Modal visible={!!medPreview} transparent animationType="fade" onRequestClose={() => setMedPreview(null)}>
            <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.78)', justifyContent: 'center', padding: 14 }}>
              <Pressable onPress={() => setMedPreview(null)} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
              <Animated.View style={{ borderRadius: 20, backgroundColor: '#12100F', borderWidth: 1, borderColor: 'rgba(255,150,90,0.2)', overflow: 'hidden', transform: [{ translateY: medPrevY }] }}>
                <View {...medPrevPan.panHandlers}>
                  <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.22)', alignSelf: 'center', marginTop: 9 }} />
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 13, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.07)', backgroundColor: 'rgba(255,150,90,0.05)' }}>
                    <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: hexA(C.blue, 0.13), borderWidth: 1, borderColor: hexA(C.blue, 0.32), alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name="file" size={15} color={C.blue} strokeWidth={2} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text numberOfLines={1} style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: '#fff' }}>{medPreview?.reportName}</Text>
                      <Body style={{ fontSize: 10.5, color: C.muted2, marginTop: 1 }} numberOfLines={1}>{medPreview?.reportType ? `${medPreview.reportType} · ` : ''}{repDate(medPreview?.date ?? null)}</Body>
                    </View>
                    <Pressable onPress={() => { if (medPreview?.fileUrl) Linking.openURL(medPreview.fileUrl); }} style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: hexA(C.blue, 0.1), borderWidth: 1, borderColor: hexA(C.blue, 0.3), alignItems: 'center', justifyContent: 'center' }}>
                      <View style={{ transform: [{ rotate: '-45deg' }] }}><Icon name="arrowRight" size={14} color={C.blue} strokeWidth={2.2} /></View>
                    </Pressable>
                    <Pressable onPress={() => setMedPreview(null)} style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name="close" size={13} color="#B8B2AC" strokeWidth={2.3} />
                    </Pressable>
                  </View>
                </View>
                <View style={{ padding: 10 }}>
                  {medPreview?.fileUrl ? (
                    /\.(png|jpe?g|webp|gif)(\?|#|$)/i.test(medPreview.fileUrl) ? (
                      <Image source={{ uri: medPreview.fileUrl }} style={{ width: '100%', height: 440, borderRadius: 14, backgroundColor: '#141110' }} resizeMode="contain" />
                    ) : (
                      <PdfPreview url={medPreview.fileUrl} height={440} />
                    )
                  ) : (
                    <Body style={{ fontSize: 12, color: C.muted3, textAlign: 'center', paddingVertical: 30 }}>No file attached to this report.</Body>
                  )}
                </View>
                <View style={{ paddingHorizontal: 13, paddingBottom: 11 }}>
                  <Body style={{ fontSize: 10, color: C.muted3, textAlign: 'center' }}>If the preview appears blank, tap the ↗ button to open it in your browser.</Body>
                </View>
              </Animated.View>
            </View>
          </Modal>
        </View>
      </Modal>

      {/* B2C credentials modal */}
      <Modal visible={!!credsQhpFor} transparent animationType="fade" onRequestClose={() => setCredsQhpFor(null)}>
        <Pressable onPress={() => setCredsQhpFor(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', padding: 22 }}>
          <Pressable onPress={() => {}} style={{ borderRadius: 18, backgroundColor: '#141010', borderWidth: 1, borderColor: hexA(C.gold, 0.3), padding: 18, gap: 12 }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: '#fff' }}>App Login Credentials</Text>
            <Body style={{ fontSize: 12, color: C.muted2 }}>{credsQhpFor?.name}</Body>
            {credsQhpQ.isLoading ? (
              <View style={{ paddingVertical: 16, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View>
            ) : credsQhpQ.isError ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 12, backgroundColor: hexA(C.red, 0.08), borderWidth: 1, borderColor: hexA(C.red, 0.28) }}>
                <Icon name="alert" size={14} color={C.red} strokeWidth={2.2} />
                <Body style={{ flex: 1, fontSize: 12, color: '#E0A090' }}>{(credsQhpQ.error as Error).message}</Body>
              </View>
            ) : credsQhpQ.data ? (
              <>
                <View style={{ padding: 13, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)', gap: 10 }}>
                  <View>
                    <Mono style={{ fontSize: 9, letterSpacing: 1, color: C.muted3 }}>EMAIL</Mono>
                    <Text selectable style={{ fontFamily: F.mono, fontSize: 13.5, color: '#fff', marginTop: 3 }}>{credsQhpQ.data.email}</Text>
                  </View>
                  <View>
                    <Mono style={{ fontSize: 9, letterSpacing: 1, color: C.muted3 }}>PASSWORD</Mono>
                    <Text selectable style={{ fontFamily: F.mono, fontSize: 13.5, color: '#fff', marginTop: 3 }}>{credsQhpQ.data.password}</Text>
                  </View>
                </View>
                <Pressable
                  onPress={async () => { await Clipboard.setStringAsync(`Email: ${credsQhpQ.data!.email}\nPassword: ${credsQhpQ.data!.password}`); setCredsQhpCopied(true); setTimeout(() => setCredsQhpCopied(false), 2000); }}
                  style={{ borderRadius: 12, overflow: 'hidden' }}
                >
                  <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 12 }}>
                    <Icon name={credsQhpCopied ? 'checks' : 'copy'} path={credsQhpCopied ? 'M20 6 9 17l-5-5' : undefined} size={14} color="#fff" strokeWidth={2.4} />
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: '#fff' }}>{credsQhpCopied ? 'Copied!' : 'Copy Credentials'}</Text>
                  </LinearGradient>
                </Pressable>
              </>
            ) : null}
            <Pressable onPress={() => setCredsQhpFor(null)} style={{ alignItems: 'center', paddingVertical: 10, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}><Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: C.ink3 }}>Close</Text></Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Start Now flow — Coach Presence Check, then the standardized form.
          Never two Modals in flight at once (iOS presentation deadlock). */}
      <CoachPresenceModal visible={!!presenceFor} meId={trainerId} busy={!!startingId} onClose={() => { if (!startingId) setPresenceFor(null); }} onConfirm={onPresenceConfirm} />
      {formFor ? (
        <QhpAssessmentForm
          visible
          assessmentId={formFor.row.id}
          clientId={formFor.row.client_id}
          clientName={formFor.row.client_name ?? 'Client'}
          location={formFor.row.location ?? ''}
          isExistingClient={formFor.isExisting}
          assessorId={trainerId}
          onClose={() => setFormFor(null)}
          onSuccess={() => { setFormFor(null); startQc.invalidateQueries({ queryKey: ['qhp-assessments'] }); }}
        />
      ) : null}

      {/* QHP details / AI report sheet (web details + AI report dialogs) */}
      <Modal visible={!!detailFor} transparent animationType="slide" onRequestClose={() => setDetailFor(null)}>
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          {/* Backdrop sits BEHIND the sheet (not wrapping it) so it can never steal the scroll gesture. */}
          <Pressable onPress={() => setDetailFor(null)} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.65)' }} />
          <View style={{ height: '85%', backgroundColor: '#0E0A09', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.14)', paddingHorizontal: 18, paddingTop: 14 }}>
            <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 12 }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
              <View style={{ flex: 1 }}>
                <Serif style={{ fontSize: 20 }}>{detailFor?.mode === 'ai' ? 'AI Report' : 'QHP Details'}</Serif>
                <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 2 }}>{qhpDetailQ.data?.clientName ?? '…'}</Body>
              </View>
              <Pressable onPress={() => setDetailFor(null)} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="close" size={14} color="#B8B2AC" strokeWidth={2.3} />
              </Pressable>
            </View>
            {qhpDetailQ.isLoading ? (
              <View style={{ paddingVertical: 30, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View>
            ) : qhpDetailQ.isError ? (
              <Body style={{ fontSize: 12.5, color: C.red, textAlign: 'center', paddingVertical: 20 }}>{(qhpDetailQ.error as Error).message}</Body>
            ) : qhpDetailQ.data ? (
              <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 26, gap: 12 }}>
                {/* Overview */}
                <View style={{ padding: 13, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', gap: 7 }}>
                  {([
                    ['Assessor', qhpDetailQ.data.assessorName],
                    ['Assessment Date', qhpDetailQ.data.assessmentDate ? qhpDate(qhpDetailQ.data.assessmentDate) ?? '—' : '—'],
                    ['Mechanical Score', qhpDetailQ.data.mechanicalScore != null ? String(qhpDetailQ.data.mechanicalScore) : '—'],
                  ] as [string, string][]).map(([lab, val]) => (
                    <View key={lab} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
                      <Mono style={{ fontSize: 9.5, letterSpacing: 0.5, color: C.muted3 }}>{lab.toUpperCase()}</Mono>
                      <Text style={{ flexShrink: 1, textAlign: 'right', fontFamily: F.bodySemi, fontSize: 12.5, color: C.ink }}>{val}</Text>
                    </View>
                  ))}
                </View>
                {(detailFor?.mode === 'ai'
                  ? ([['AI Biomechanical', qhpDetailQ.data.aiBiomechanical]] as [string, any][])
                  : ([
                      ['QHP Data', qhpDetailQ.data.qhpData],
                      ['New Client Assessment', qhpDetailQ.data.newClientData],
                      ['Existing Client Assessment', qhpDetailQ.data.existingClientData],
                      ['AI Biomechanical', qhpDetailQ.data.aiBiomechanical],
                    ] as [string, any][])
                ).filter(([, v]) => v && typeof v === 'object' && Object.keys(v).length > 0).map(([title, v]) => (
                  <View key={title} style={{ padding: 13, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: hexA(C.blue, 0.2), gap: 9 }}>
                    <Serif style={{ fontSize: 15, color: C.blue }}>{title}</Serif>
                    <JsonView data={v} />
                  </View>
                ))}
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>

      {/* Health briefing sheet */}
      <Modal visible={!!briefingFor} transparent animationType="slide" onRequestClose={() => setBriefingFor(null)}>
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable onPress={() => setBriefingFor(null)} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.65)' }} />
          <View style={{ height: '80%', backgroundColor: '#0E0A09', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.14)', paddingHorizontal: 18, paddingTop: 14 }}>
            <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 12 }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
              <View style={{ flex: 1 }}>
                <Serif style={{ fontSize: 20 }}>Health Briefing</Serif>
                <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 2 }}>{briefingFor?.client_name}</Body>
              </View>
              <Pressable onPress={() => setBriefingFor(null)} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="close" size={14} color="#B8B2AC" strokeWidth={2.3} />
              </Pressable>
            </View>
            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 26 }}>
              {briefingFor?.health_briefing ? <AiAnalysis text={briefingFor.health_briefing} /> : <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 20 }}>No briefing available.</Body>}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </Page>
  );
}

/* ---------- Schedule QHP — live bottom-sheet (web CoachAssessmentSchedulingForm contract) ---------- */
function ScheduleQhpSheet({ visible, onClose, scheduledBy, prefill }: { visible: boolean; onClose: () => void; scheduledBy: string; prefill?: { clientId: string; clientName: string; date?: string | null; time?: string | null; location?: string | null; notes?: string | null; slaDeadlineIso?: string | null; clearHold?: boolean } }) {
  const insets = useSafeAreaInsets();
  const assessorsQ = useQhpAssessors();
  const clientsQ = useQhpClients();
  const scheduleM = useScheduleQhp();

  const [assessorId, setAssessorId] = React.useState<string | null>(null);
  const [assessorOpen, setAssessorOpen] = React.useState(false);
  const [clientId, setClientId] = React.useState<string | null>(null);
  const [clientName, setClientName] = React.useState('');
  const [clientOpen, setClientOpen] = React.useState(false);
  const [clientSearch, setClientSearch] = React.useState('');
  const [date, setDate] = React.useState<string | null>(null);
  const HOURS = [6, 7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5];
  const MINS = [0, 15, 30, 45];
  const [hour, setHour] = React.useState(9);
  const [minute, setMinute] = React.useState(0);
  const [ampm, setAmpm] = React.useState<'AM' | 'PM'>('AM');
  const [loc, setLoc] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [delayReason, setDelayReason] = React.useState('');
  const [kbH, setKbH] = React.useState(0);
  // SLA state — when scheduling from Task Pending past the deadline, a delay
  // reason (min 10 chars) is required and stored on the insert (web parity).
  const slaBreached = !!prefill?.slaDeadlineIso && Date.now() > new Date(prefill.slaDeadlineIso).getTime();
  React.useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const s = Keyboard.addListener(showEvt, (e: any) => setKbH(e.endCoordinates?.height ?? 0));
    const h = Keyboard.addListener(hideEvt, () => setKbH(0));
    return () => { s.remove(); h.remove(); };
  }, []);
  React.useEffect(() => {
    if (visible) {
      setAssessorId(null); setAssessorOpen(false);
      setClientId(prefill?.clientId ?? null); setClientName(prefill?.clientName ?? ''); setClientOpen(false); setClientSearch('');
      setDate(prefill?.date ?? null);
      // Ops-preference prefill (web: date/time/location/notes carried into the form)
      const pt = prefill?.time ? String(prefill.time).slice(0, 5) : null;
      if (pt && /^\d{2}:\d{2}$/.test(pt)) {
        const [hh, mm] = pt.split(':').map(Number);
        setHour(((hh + 11) % 12) + 1); setMinute([0, 15, 30, 45].includes(mm) ? mm : 0); setAmpm(hh >= 12 ? 'PM' : 'AM');
      } else { setHour(9); setMinute(0); setAmpm('AM'); }
      setLoc(prefill?.location ?? ''); setNotes(prefill?.notes ?? ''); setDelayReason('');
      scheduleM.reset();
    }
  }, [visible]);

  const days = React.useMemo(
    () =>
      Array.from({ length: 14 }, (_, i) => {
        const d = new Date(Date.now() + i * 86_400_000);
        return {
          iso: istDate(d),
          dow: d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short' }).toUpperCase(),
          day: d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric' }),
          mon: d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', month: 'short' }).toUpperCase(),
          tag: i === 0 ? 'TODAY' : i === 1 ? 'TMRW' : null,
        };
      }),
    [visible]
  );
  const cycle = <T,>(arr: readonly T[], cur: T, set: (v: T) => void) => set(arr[(arr.indexOf(cur) + 1) % arr.length]);

  const busy = scheduleM.isPending;
  const err = scheduleM.error as Error | null;
  const canSend = !!assessorId && !!clientId && !!date && !!loc.trim() && !busy && (!slaBreached || delayReason.trim().length >= 10);
  const selectedAssessor = (assessorsQ.data ?? []).find((a) => a.id === assessorId);
  const q = clientSearch.trim().toLowerCase();
  const clientOptions = (clientsQ.data ?? []).filter((c) => !q || c.name.toLowerCase().includes(q));

  const send = async () => {
    if (!canSend) return;
    const h24 = (hour % 12) + (ampm === 'PM' ? 12 : 0);
    try {
      await scheduleM.mutateAsync({
        assessorId: assessorId as string,
        scheduledBy,
        clientId,
        clientName,
        date: date as string,
        time: `${String(h24).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`,
        location: loc,
        notes,
        slaDeadlineIso: prefill?.slaDeadlineIso ?? null,
        delayReason: slaBreached ? delayReason.trim() : null,
        clearHoldForClient: prefill?.clearHold ?? false,
      });
      onClose();
    } catch { /* error surfaced below */ }
  };

  const label = (t: string) => <Mono style={{ fontSize: 10, letterSpacing: 1.4, color: C.mono2, marginBottom: 7 }}>{t}</Mono>;
  const fieldBox = { paddingVertical: 13, paddingHorizontal: 14, borderRadius: 13, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.03)' } as const;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => !busy && onClose()}>
      <Pressable onPress={() => !busy && onClose()} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}>
        <Pressable onPress={() => {}} style={{ height: '90%', backgroundColor: '#0E0A09', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.14)', paddingHorizontal: 18, paddingTop: 14 }}>
          <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 14 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
            <View style={{ flex: 1 }}>
              <Serif style={{ fontSize: 22 }}>Schedule New QHP</Serif>
              <Body style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>Schedule a QHP and assign it to an assessor.</Body>
            </View>
            <Pressable onPress={() => !busy && onClose()} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="close" size={14} color="#B8B2AC" strokeWidth={2.3} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: (kbH > 0 ? kbH : insets.bottom) + 24, gap: 15 }} keyboardShouldPersistTaps="handled">
            {/* Assessor */}
            <View>
              {label('SELECT ASSESSOR *')}
              <Pressable onPress={() => { setAssessorOpen(!assessorOpen); setClientOpen(false); }} style={[fieldBox, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
                <Body style={{ fontSize: 14, color: selectedAssessor ? '#fff' : C.muted3 }}>{selectedAssessor?.name ?? 'Select an assessor'}</Body>
                <Icon name={assessorOpen ? 'chevUp' : 'chevDown'} size={15} color={C.muted} strokeWidth={2.2} />
              </Pressable>
              {assessorOpen ? (
                <View style={{ marginTop: 7, maxHeight: 260, borderRadius: 13, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: '#14100D', overflow: 'hidden' }}>
                  <ScrollView nestedScrollEnabled>
                    {assessorsQ.isLoading ? (
                      <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 16 }}>Loading assessors…</Body>
                    ) : (
                      (assessorsQ.data ?? []).map((a, i) => (
                        <Pressable key={a.id} onPress={() => { setAssessorId(a.id); setAssessorOpen(false); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 13, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: 'rgba(255,255,255,0.05)', backgroundColor: assessorId === a.id ? hexA(C.orange, 0.08) : 'transparent' }}>
                          <Icon name="user" size={14} color={assessorId === a.id ? C.orange : C.muted} strokeWidth={2} />
                          <Body style={{ flex: 1, fontSize: 13.5, color: assessorId === a.id ? C.orange : C.ink }}>{a.name}</Body>
                          {a.role === 'doctor' ? <Badge text="Doctor" color={C.blue} /> : null}
                          {assessorId === a.id ? <Icon path="M20 6 9 17l-5-5" size={14} color={C.orange} strokeWidth={2.6} /> : null}
                        </Pressable>
                      ))
                    )}
                  </ScrollView>
                </View>
              ) : null}
            </View>

            {/* Client */}
            <View>
              {label('SELECT CLIENT *')}
              <Pressable onPress={() => { setClientOpen(!clientOpen); setAssessorOpen(false); }} style={[fieldBox, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
                <Body style={{ fontSize: 14, color: clientId ? '#fff' : C.muted3 }}>{clientId ? clientName : 'Choose a client'}</Body>
                <Icon name={clientOpen ? 'chevUp' : 'chevDown'} size={15} color={C.muted} strokeWidth={2.2} />
              </Pressable>
              {clientOpen ? (
                <View style={{ marginTop: 7, borderRadius: 13, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: '#14100D', overflow: 'hidden' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 13, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' }}>
                    <Icon name="search" size={14} color={C.muted3} strokeWidth={2} />
                    <TextInput value={clientSearch} onChangeText={setClientSearch} placeholder="Search clients…" placeholderTextColor={C.muted3} autoCorrect={false} style={{ flex: 1, fontFamily: F.body, fontSize: 14, color: '#fff', padding: 0 }} />
                  </View>
                  <ScrollView nestedScrollEnabled style={{ maxHeight: 220 }}>
                    {clientsQ.isLoading ? (
                      <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 16 }}>Loading clients…</Body>
                    ) : clientOptions.length === 0 ? (
                      <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 16 }}>No clients match.</Body>
                    ) : (
                      clientOptions.map((c, i) => (
                        <Pressable key={c.id} onPress={() => { setClientId(c.id); setClientName(c.name); setClientOpen(false); setClientSearch(''); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 13, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: 'rgba(255,255,255,0.05)', backgroundColor: clientId === c.id ? hexA(C.orange, 0.08) : 'transparent' }}>
                          <Icon name="user" size={14} color={clientId === c.id ? C.orange : C.muted} strokeWidth={2} />
                          <Body style={{ flex: 1, fontSize: 13.5, color: clientId === c.id ? C.orange : C.ink }}>{c.name}</Body>
                          {clientId === c.id ? <Icon path="M20 6 9 17l-5-5" size={14} color={C.orange} strokeWidth={2.6} /> : null}
                        </Pressable>
                      ))
                    )}
                  </ScrollView>
                </View>
              ) : null}
            </View>

            {/* Date */}
            <View>
              {label('QHP DATE *')}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 4 }}>
                {days.map((d) => {
                  const sel = date === d.iso;
                  return (
                    <Pressable key={d.iso} onPress={() => setDate(d.iso)} style={{ width: 58, alignItems: 'center', paddingVertical: 9, borderRadius: 13, backgroundColor: sel ? hexA(C.orange, 0.14) : 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: sel ? hexA(C.orange, 0.45) : 'rgba(255,255,255,0.08)' }}>
                      <Mono style={{ fontSize: 8.5, letterSpacing: 0.8, color: sel ? C.orange : C.muted3 }}>{d.tag ?? d.dow}</Mono>
                      <Serif style={{ fontSize: 19, color: sel ? C.orange : C.ink, marginTop: 2 }}>{d.day}</Serif>
                      <Mono style={{ fontSize: 8.5, color: sel ? hexA(C.orange, 0.8) : C.faint }}>{d.mon}</Mono>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>

            {/* Time — tap each part to cycle */}
            <View>
              {label('QHP TIME')}
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {([
                  [String(hour), () => cycle(HOURS, hour, setHour)],
                  [String(minute).padStart(2, '0'), () => cycle(MINS, minute, setMinute)],
                  [ampm, () => setAmpm(ampm === 'AM' ? 'PM' : 'AM')],
                ] as const).map(([val, fn], i) => (
                  <Pressable key={i} onPress={fn} style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 13, backgroundColor: hexA(C.gold, 0.08), borderWidth: 1, borderColor: hexA(C.gold, 0.28) }}>
                    <Serif style={{ fontSize: 20, color: C.gold }}>{val}</Serif>
                    <Mono style={{ fontSize: 7.5, letterSpacing: 0.8, color: C.muted3, marginTop: 2 }}>{i === 0 ? 'HOUR' : i === 1 ? 'MIN' : 'AM/PM'}</Mono>
                  </Pressable>
                ))}
              </View>
              <Body style={{ fontSize: 10.5, color: C.muted3, marginTop: 6, textAlign: 'center' }}>Tap a box to change · {hour}:{String(minute).padStart(2, '0')} {ampm}</Body>
            </View>

            {/* Location + notes */}
            <View>
              {label('LOCATION *')}
              <TextInput value={loc} onChangeText={setLoc} placeholder="e.g. Coral Gym, Indiranagar" placeholderTextColor={C.muted3} style={[fieldBox, { color: '#fff', fontFamily: F.body, fontSize: 14 }]} />
            </View>
            <View>
              {label('NOTES')}
              <TextInput value={notes} onChangeText={setNotes} placeholder="Anything the assessor should know (optional)" placeholderTextColor={C.muted3} multiline style={[fieldBox, { minHeight: 64, textAlignVertical: 'top', color: '#fff', fontFamily: F.body, fontSize: 14 }]} />
            </View>

            {/* SLA breached — delay reason required (web LateAssignmentReasonDialog parity) */}
            {slaBreached ? (
              <View style={{ padding: 13, borderRadius: 14, backgroundColor: hexA(C.red, 0.07), borderWidth: 1, borderColor: hexA(C.red, 0.3), gap: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                  <Icon name="alert" size={14} color={C.red} strokeWidth={2.2} />
                  <Mono style={{ fontSize: 10, letterSpacing: 1, color: C.red }}>SLA BREACHED — DELAY REASON REQUIRED</Mono>
                </View>
                <Body style={{ fontSize: 11.5, color: C.muted2 }}>This client's 3-working-hour SLA has passed. Explain the delay (min 10 characters) — it's stored on the assignment.</Body>
                <TextInput
                  value={delayReason}
                  onChangeText={setDelayReason}
                  placeholder="Why is this assignment late?"
                  placeholderTextColor={C.muted3}
                  multiline
                  style={[fieldBox, { minHeight: 56, textAlignVertical: 'top', color: '#fff', fontFamily: F.body, fontSize: 13, borderColor: delayReason.trim().length >= 10 ? hexA(C.green, 0.35) : hexA(C.red, 0.3) }]}
                />
              </View>
            ) : null}

            {err ? <Body style={{ fontSize: 12, color: C.red }}>{err.message}</Body> : null}
            <View style={{ opacity: canSend ? 1 : 0.45 }} pointerEvents={canSend ? 'auto' : 'none'}>
              <GradientButton label={busy ? 'Scheduling…' : 'Schedule QHP'} onPress={send} />
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/* Pretty-print a QHP data JSON blob (web QHPReviewTab PrettyValue equivalent). */
function prettyKey(k: string) {
  return k.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\b\w/g, (c) => c.toUpperCase());
}
function JsonView({ data, depth = 0 }: { data: any; depth?: number }) {
  if (data == null) return null;
  if (typeof data !== 'object') return <Body style={{ fontSize: 12, color: C.ink3 }}>{String(data)}</Body>;
  if (depth > 4) return <Body style={{ fontSize: 11, color: C.muted3 }}>…</Body>;
  const entries = Array.isArray(data) ? data.map((v, i) => [String(i + 1), v] as [string, any]) : Object.entries(data);
  return (
    <View style={{ gap: 6 }}>
      {entries.map(([k, v]) => {
        if (v == null || v === '') return null;
        if (typeof v === 'boolean') {
          return (
            <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Mono style={{ fontSize: 9.5, color: C.muted3, flexShrink: 1 }}>{prettyKey(k).toUpperCase()}</Mono>
              <Badge text={v ? 'Yes' : 'No'} color={v ? C.green : C.muted2} />
            </View>
          );
        }
        if (typeof v !== 'object') {
          return (
            <View key={k} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
              <Mono style={{ fontSize: 9.5, color: C.muted3, width: 120 }}>{prettyKey(k).toUpperCase()}</Mono>
              <Body style={{ flex: 1, fontSize: 12, color: C.ink }}>{String(v)}</Body>
            </View>
          );
        }
        if (Array.isArray(v) && v.every((x) => typeof x !== 'object')) {
          return (
            <View key={k} style={{ gap: 4 }}>
              <Mono style={{ fontSize: 9.5, color: C.muted3 }}>{prettyKey(k).toUpperCase()}</Mono>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
                {v.map((x, i) => <Badge key={i} text={String(x)} color={C.blue} />)}
              </View>
            </View>
          );
        }
        return (
          <View key={k} style={{ borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', padding: 9, gap: 5 }}>
            <Mono style={{ fontSize: 9.5, letterSpacing: 0.6, color: C.orange }}>{prettyKey(k).toUpperCase()}</Mono>
            <JsonView data={v} depth={depth + 1} />
          </View>
        );
      })}
    </View>
  );
}

/* ============ QHP MANAGER ============ */
type MgrQhp = { id: string; init: string; name: string; refresh: string; client: string; av: [string, string]; when?: string; holdReason?: string };
type ReschedReq = { id: string; name: string; from: string; to: string; reason: string; by: string };

export function QhpManager() {
  const caps = useMyCapabilities();
  const isMgr = caps.data.isQhpManager;
  const q = useQhpManager(isMgr);
  const resolveM = useResolveQhpReschedule();
  const reviewM = useSetQhpManagerReview();
  const holdM = useHoldQhp();
  const reschedM = useRescheduleQhpAssessment();
  const deleteQhpM = useDeleteQhp();
  const { session } = useAuth();
  const { set, go } = useStore();
  const [tab, setTab] = React.useState<'task' | 'manager' | 'tracker' | 'requests' | 'linked' | 'review'>('task');
  const [mgrAddOpen, setMgrAddOpen] = React.useState(false); // calendar "Add QHP"
  const [sub, setSub] = React.useState<'notsched' | 'sched' | 'hold' | 'resched'>('notsched');
  // Overdue card on the landing tab — same all-time subscribed-clients logic as the home card.
  const totalsQ = useQhpTotals(isMgr);
  const [overdueOpen, setOverdueOpen] = React.useState(false);
  // Tracker tab state
  const [trkFilter45, setTrkFilter45] = React.useState(true);
  const [trkStatus, setTrkStatus] = React.useState<'all' | 'not-done' | 'overdue' | 'due-soon' | 'completed'>('all');
  const [trkSearch, setTrkSearch] = React.useState('');
  const trackerQ = useQhpTracker(isMgr && tab === 'tracker', trkFilter45);
  // Client Linked tab state
  const [linkSearch, setLinkSearch] = React.useState('');
  const [linkedFor, setLinkedFor] = React.useState<import('../lib/qhpManagerQueries').LinkedClient | null>(null);
  const linkedQ = useClientLinked(isMgr && tab === 'linked');
  const staffQ = useClientAssignedStaff(linkedFor?.id ?? null);
  // Requests approve state
  const approveM = useApproveQhpRequest();
  const assessorsQ = useQhpAssessors();
  const [approveFor, setApproveFor] = React.useState<import('../lib/qhpManagerQueries').QhpRequest | null>(null);
  const [approveAssessor, setApproveAssessor] = React.useState<string | null>(null);
  // Requests edit state
  const editM = useEditQhpRequest();
  const [editFor, setEditFor] = React.useState<import('../lib/qhpManagerQueries').QhpRequest | null>(null);
  const [eDate, setEDate] = React.useState('');
  const [eTime, setETime] = React.useState('');
  const [eAddress, setEAddress] = React.useState('');
  const [eNotes, setENotes] = React.useState('');
  const openEdit = (r: import('../lib/qhpManagerQueries').QhpRequest) => {
    setEditFor(r);
    setEDate(r.date ?? '');
    setETime(r.time ? String(r.time).slice(0, 5) : '09:00');
    setEAddress(r.address ?? '');
    setENotes(r.notes ?? '');
  };
  const submitEdit = () => {
    if (!editFor || !/^\d{4}-\d{2}-\d{2}$/.test(eDate.trim()) || !/^\d{2}:\d{2}$/.test(eTime.trim()) || !eAddress.trim()) return;
    editM.mutate(
      { id: editFor.id, date: eDate.trim(), time: eTime.trim(), address: eAddress.trim(), notes: eNotes.trim() || null },
      { onSuccess: () => setEditFor(null) }
    );
  };
  // Credentials modal state (Scheduled cards — copies B2C app login)
  const [credsFor, setCredsFor] = React.useState<import('../lib/qhpManagerQueries').PendingClient | null>(null);
  const [credsCopied, setCredsCopied] = React.useState(false);
  const credsQ = useClientCredentials(credsFor ? { clientId: credsFor.clientId, name: credsFor.name } : null);
  // Review dialog state
  const [reviewFor, setReviewFor] = React.useState<string | null>(null);
  const reviewDetailQ = useQhpReviewDetail(reviewFor);
  // Manager tab view (list / calendar)
  const [mgrView, setMgrView] = React.useState<'list' | 'calendar'>('list');
  const [calCursor, setCalCursor] = React.useState(() => { const n = new Date(); return { y: n.getFullYear(), m: n.getMonth() }; });
  const [calSelDay, setCalSelDay] = React.useState<number | null>(null);
  // Manager tab filters (web QHPFilters: search / status / client / trainer)
  const [mgrSearch, setMgrSearch] = React.useState('');
  const [mgrStatus, setMgrStatus] = React.useState<'all' | 'completed' | 'pending' | 'overdue'>('all');
  const [mgrClient, setMgrClient] = React.useState<string>('all');
  const [mgrAssessor, setMgrAssessor] = React.useState<string>('all');
  const [mgrPick, setMgrPick] = React.useState<'client' | 'assessor' | null>(null);
  const [mgrPickSearch, setMgrPickSearch] = React.useState('');
  const mgrAll = q.data?.assessments ?? [];
  const mgrClientOpts = React.useMemo(() => {
    const m = new Map<string, string>();
    mgrAll.forEach((a) => { if (a.clientId && !m.has(a.clientId)) m.set(a.clientId, a.clientName); });
    return [...m.entries()].map(([id, name]) => ({ id, name })).sort((x, y) => x.name.localeCompare(y.name));
  }, [mgrAll]);
  const mgrAssessorOpts = React.useMemo(
    () => [...new Set(mgrAll.map((a) => a.assessorName).filter((n) => n && n !== '—'))].sort(),
    [mgrAll]
  );
  const mgrHasFilters = mgrSearch.trim() !== '' || mgrStatus !== 'all' || mgrClient !== 'all' || mgrAssessor !== 'all';
  const mgrFiltered = React.useMemo(() => {
    const sq = mgrSearch.trim().toLowerCase();
    return mgrAll.filter((a) => {
      if (sq && !a.clientName.toLowerCase().includes(sq)) return false;
      // web: "Overdue" filter = isValidityOverdue; completed/pending from calculateQHPStatus
      if (mgrStatus === 'overdue' && !a.validityOverdue) return false;
      if (mgrStatus === 'completed' && a.status !== 'completed') return false;
      if (mgrStatus === 'pending' && a.status !== 'pending') return false;
      if (mgrClient !== 'all' && a.clientId !== mgrClient) return false;
      if (mgrAssessor !== 'all' && a.assessorName !== mgrAssessor) return false;
      return true;
    });
  }, [mgrAll, mgrSearch, mgrStatus, mgrClient, mgrAssessor]);
  const clearMgrFilters = () => { setMgrSearch(''); setMgrStatus('all'); setMgrClient('all'); setMgrAssessor('all'); };
  const [holdFor, setHoldFor] = React.useState<import('../lib/qhpManagerQueries').PendingClient | null>(null);
  const [holdReason, setHoldReason] = React.useState('');
  const [holdHours, setHoldHours] = React.useState(24); // web: resolve deadline user-picked, ≤24h
  const [scheduleFor, setScheduleFor] = React.useState<import('../lib/qhpManagerQueries').PendingClient | null>(null);
  const [reschedFor, setReschedFor] = React.useState<import('../lib/qhpManagerQueries').PendingClient | null>(null);
  // Reschedule modal date/time (14-day picker + tap-to-cycle time, same pattern as ScheduleQhpSheet)
  const [rDay, setRDay] = React.useState(0);
  const [rHour, setRHour] = React.useState('9');
  const [rMin, setRMin] = React.useState('00');
  const [rAmpm, setRAmpm] = React.useState<'AM' | 'PM'>('AM');
  const [rReason, setRReason] = React.useState('');
  const submitResched = () => {
    if (!reschedFor?.assessmentId || rReason.trim().length < 10) return;
    const d = new Date(Date.now() + rDay * 864e5);
    const p = (n: number) => String(n).padStart(2, '0');
    const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    let h = Number(rHour) % 12;
    if (rAmpm === 'PM') h += 12;
    reschedM.mutate(
      {
        id: reschedFor.assessmentId,
        date,
        time: `${p(h)}:${rMin}:00`,
        reason: rReason,
        managerId: session?.user?.id ?? '',
        clientName: reschedFor.name,
        currentDate: reschedFor.assessmentDate ?? null,
        currentTime: reschedFor.assessmentTime ?? null,
      },
      { onSuccess: () => { setReschedFor(null); setRReason(''); } }
    );
  };
  const submitHold = () => {
    if (!holdFor || !holdReason.trim()) return;
    const resolvingAt = new Date(Date.now() + holdHours * 3600 * 1000).toISOString();
    holdM.mutate({ clientId: holdFor.clientId, reason: holdReason, resolvingAt }, { onSuccess: () => { setHoldFor(null); setHoldReason(''); setHoldHours(24); } });
  };

  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : '—');
  const fmtT = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase() : '');

  if (caps.isLoading) {
    return <Page gap={16} pt={6}><View style={{ paddingVertical: 50, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View></Page>;
  }
  if (!isMgr) {
    return (
      <Page gap={16} pt={6}>
        <TitleBlock title="QHP Manager" sub="Assessment oversight" />
        <View style={{ alignItems: 'center', gap: 10, paddingVertical: 44 }}>
          <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: hexA(C.gold, 0.12), borderWidth: 1, borderColor: hexA(C.gold, 0.3), alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="shield" size={22} color={C.gold} strokeWidth={2} />
          </View>
          <Body style={{ fontSize: 13, color: C.muted2, textAlign: 'center' }}>This area is for QHP Managers only.</Body>
        </View>
      </Page>
    );
  }

  const d = q.data;

  return (
    <Page gap={13} pt={6}>
      <TitleBlock title="QHP Manager" sub="Assessment oversight across your trainers" />

      {q.isLoading || !d ? (
        <View style={{ paddingVertical: 34, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View>
      ) : (
        <>
          {/* Main tabs */}
          <HScroll gap={7}>
            {(([['task', 'Task Pending', d.counts.taskPending, C.orange], ['manager', 'Manager', d.counts.total, C.blue], ['tracker', 'Tracker', 0, C.purple], ['requests', 'Requests', d.counts.requests, C.gold], ['linked', 'Client Linked', 0, C.blue], ['review', 'QHP Review', d.counts.reviewPending, C.green]]) as [string, string, number, string][]).map(([id, label, n, col]) => {
              const active = tab === id;
              return (
                <Pressable key={id} onPress={() => setTab(id as any)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 9, paddingHorizontal: 13, borderRadius: 12, backgroundColor: active ? hexA(col, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(col, 0.5) : 'rgba(255,255,255,0.09)' }}>
                  <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 12.5, color: active ? col : C.muted }}>{label}</Text>
                  {n > 0 ? <View style={{ minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, backgroundColor: active ? col : 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontFamily: F.bodyBold, fontSize: 9.5, color: active ? '#0c0808' : C.muted }}>{n}</Text></View> : null}
                </Pressable>
              );
            })}
          </HScroll>

          {/* ===== TASK PENDING ===== */}
          {tab === 'task' ? (
            <>
              {/* Overdue QHPs — conducted 45+ days ago, never filled in (subscribed clients) */}
              <Pressable onPress={() => setOverdueOpen(true)} style={{ borderRadius: 16, overflow: 'hidden', borderWidth: 1.5, borderColor: hexA(C.red, 0.4) }}>
                <LinearGradient colors={[hexA(C.red, 0.13), 'rgba(255,255,255,0.02)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 }}>
                  <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, backgroundColor: C.red }} />
                  <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: hexA(C.red, 0.14), borderWidth: 1, borderColor: hexA(C.red, 0.4), alignItems: 'center', justifyContent: 'center', marginLeft: 4 }}>
                    <Icon name="alert" size={18} color={C.red} strokeWidth={2.1} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: '#FF9B8F' }}>
                      {totalsQ.isLoading ? 'Overdue QHPs…' : `${totalsQ.data?.overdue ?? 0} Overdue QHP${(totalsQ.data?.overdue ?? 0) === 1 ? '' : 's'}`}
                    </Text>
                    <Text style={{ fontFamily: F.body, fontSize: 11, color: hexA(C.red, 0.85), marginTop: 1 }}>Conducted 45+ days ago, never filled in · subscribed clients · tap for breakdown</Text>
                  </View>
                  <Icon name="chevRight" size={15} color={C.red} strokeWidth={2.4} />
                </LinearGradient>
              </Pressable>

              {/* Overdue breakdown popup */}
              <Modal visible={overdueOpen} transparent animationType="slide" onRequestClose={() => setOverdueOpen(false)}>
                <Pressable onPress={() => setOverdueOpen(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' }}>
                  <Pressable onPress={() => {}} style={{ maxHeight: '78%', backgroundColor: '#171210', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.15)', paddingHorizontal: 18, paddingTop: 16, paddingBottom: 28 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 12 }}>
                      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: C.red }} />
                      <Serif style={{ flex: 1, fontSize: 19, color: '#fff' }}>Overdue QHPs</Serif>
                      <View style={{ minWidth: 26, height: 24, paddingHorizontal: 8, borderRadius: 12, backgroundColor: hexA(C.red, 0.15), borderWidth: 1, borderColor: hexA(C.red, 0.4), alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: C.red }}>{(totalsQ.data?.overdueRows ?? []).length}</Text>
                      </View>
                      <Pressable onPress={() => setOverdueOpen(false)} hitSlop={10} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
                        <Icon name="close" size={15} color={C.muted2} />
                      </Pressable>
                    </View>
                    <Body style={{ fontSize: 10.5, color: C.muted3, marginBottom: 10 }}>Assigned & conducted over 45 days ago but the assessment was never filled in.</Body>
                    {(totalsQ.data?.overdueRows ?? []).length === 0 ? (
                      <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 26 }}>No overdue QHPs.</Body>
                    ) : (
                      <ScrollView showsVerticalScrollIndicator={false} style={{ flexShrink: 1 }} nestedScrollEnabled>
                        {(totalsQ.data?.overdueRows ?? []).map((r) => (
                          <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' }}>
                            <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: hexA(C.red, 0.12), borderWidth: 1, borderColor: hexA(C.red, 0.35), alignItems: 'center', justifyContent: 'center' }}>
                              <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: C.red }}>{(r.clientName[0] ?? '?').toUpperCase()}</Text>
                            </View>
                            <View style={{ flex: 1 }}>
                              <Body style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }} numberOfLines={1}>{r.clientName}</Body>
                              <Body style={{ fontSize: 10.5, color: C.muted2, marginTop: 1 }} numberOfLines={1}>{r.assessorName}{r.subscription ? ` · ${r.subscription}` : ''}</Body>
                            </View>
                            {r.date ? (
                              <Mono style={{ fontSize: 10, color: C.muted3 }}>{new Date(r.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })}</Mono>
                            ) : null}
                          </View>
                        ))}
                      </ScrollView>
                    )}
                  </Pressable>
                </Pressable>
              </Modal>

              {d.reschedules.length ? (
                <Pressable onPress={() => setSub('resched')} style={{ borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: hexA(C.orange, 0.4) }}>
                  <LinearGradient colors={[C.orangeGradA, C.orangeGradB]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 }}>
                    <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' }}><Icon name="calendar" size={19} color="#fff" strokeWidth={2.2} /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: F.bodyBold, fontSize: 14.5, color: '#fff' }}>{d.reschedules.length} Pending QHP Reschedule Request{d.reschedules.length === 1 ? '' : 's'}</Text>
                      <Text style={{ fontFamily: F.body, fontSize: 11.5, color: 'rgba(255,255,255,0.9)', marginTop: 1 }}>Assessors have asked to move QHPs — review and approve.</Text>
                    </View>
                    <Icon name="chevRight" size={16} color="#fff" strokeWidth={2.4} />
                  </LinearGradient>
                </Pressable>
              ) : null}

              <Card colors={['rgba(74,42,24,0.4)', 'rgba(22,16,15,0.5)']} border={hexA(C.gold, 0.22)} radius={14} style={{ padding: 13 }}>
                <Body style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: C.gold }}>{d.counts.taskPending} client{d.counts.taskPending === 1 ? '' : 's'} pending QHP</Body>
                <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 2 }}>Active clients who need their QHP scheduled or completed.</Body>
              </Card>

              {/* Sub-tabs */}
              <View style={{ flexDirection: 'row', gap: 6, padding: 4, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.28)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' }}>
                {(([['notsched', 'Not Scheduled', d.counts.notScheduled], ['sched', 'Scheduled', d.counts.scheduled], ['hold', 'On Hold', d.counts.holds], ['resched', 'Reschedule', d.counts.reschedules]]) as [string, string, number][]).map(([id, label, n]) => {
                  const active = sub === id;
                  return (
                    <Pressable key={id} onPress={() => setSub(id as any)} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 9, borderRadius: 10, overflow: 'hidden', backgroundColor: active ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                      {active ? <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} /> : null}
                      <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 10, color: active ? '#fff' : C.muted, textAlign: 'center' }}>{label}</Text>
                      <Text style={{ fontFamily: F.mono, fontSize: 9, color: active ? 'rgba(255,255,255,0.85)' : C.muted3 }}>{n}</Text>
                    </Pressable>
                  );
                })}
              </View>

              {sub === 'notsched' ? (
                d.taskNotScheduled.length === 0 ? <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 18 }}>Nothing waiting to be scheduled.</Body> :
                d.taskNotScheduled.slice(0, 120).map((c) => {
                  const sla = formatSlaRemaining(computeQhpSlaDeadline(c.joinedAt));
                  const slaCol = sla.level === 'red' ? C.red : sla.level === 'amber' ? C.gold : C.green;
                  const urg = waitUrgency(c.joinedAt);
                  const urgCol = urg.level === 'red' ? C.red : urg.level === 'amber' ? C.gold : C.muted2;
                  return (
                    <View key={c.clientId} style={{ padding: 12, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: hexA(slaCol, 0.2), borderLeftWidth: 3, borderLeftColor: slaCol, gap: 6 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <Body numberOfLines={1} style={{ fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }}>{c.name}</Body>
                        <Badge text="Not scheduled" color={C.gold} />
                        <Badge text={sla.text} color={slaCol} />
                      </View>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                        <Body style={{ fontSize: 11, color: C.muted2 }}>Joined {fmt(c.joinedAt)}</Body>
                        <Body style={{ fontSize: 11, color: urgCol, fontFamily: urg.level === 'green' ? F.body : F.bodySemi }}>Waiting {formatWaiting(c.joinedAt)}</Body>
                      </View>
                      {sla.overdue ? <Mono style={{ fontSize: 8.5, letterSpacing: 0.5, color: C.red }}>SLA BREACHED — SCHEDULE IMMEDIATELY</Mono> : null}
                      {urg.warning ? <Body style={{ fontSize: 10.5, color: urgCol }}>{urg.warning}</Body> : null}
                      {c.opsPrefs && (c.opsPrefs.notes || c.opsPrefs.date || c.opsPrefs.timeFrom || c.opsPrefs.location) ? (
                        <View style={{ padding: 9, borderRadius: 10, backgroundColor: hexA(C.blue, 0.06), borderWidth: 1, borderColor: hexA(C.blue, 0.2) }}>
                          <Mono style={{ fontSize: 8, letterSpacing: 0.7, color: C.blue }}>NOTES FROM OPS</Mono>
                          {c.opsPrefs.date || c.opsPrefs.timeFrom ? <Body style={{ fontSize: 11, color: C.ink3, marginTop: 2 }}>Preferred: {c.opsPrefs.date ?? '—'}{c.opsPrefs.timeFrom ? ` · ${String(c.opsPrefs.timeFrom).slice(0, 5)}` : ''}</Body> : null}
                          {c.opsPrefs.location ? <Body style={{ fontSize: 11, color: C.ink3, marginTop: 1 }}>Location: {c.opsPrefs.location}</Body> : null}
                          {c.opsPrefs.notes ? <Body style={{ fontSize: 11, color: C.ink3, marginTop: 1 }}>{c.opsPrefs.notes}</Body> : null}
                        </View>
                      ) : null}
                      <View style={{ flexDirection: 'row', gap: 8, marginTop: 2 }}>
                        <Pressable onPress={() => setScheduleFor(c)} style={{ flex: 1.6, borderRadius: 11, overflow: 'hidden' }}>
                          <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9 }}>
                            <Icon name="calendar" size={13} color="#fff" strokeWidth={2.4} />
                            <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: '#fff' }}>Schedule QHP</Text>
                          </LinearGradient>
                        </Pressable>
                        <Pressable onPress={() => setHoldFor(c)} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 9, borderRadius: 11, backgroundColor: hexA(C.purple, 0.12), borderWidth: 1, borderColor: hexA(C.purple, 0.4) }}><Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: C.purple }}>Hold</Text></Pressable>
                      </View>
                    </View>
                  );
                })
              ) : sub === 'sched' ? (
                d.taskScheduled.length === 0 ? <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 18 }}>No scheduled QHPs.</Body> :
                d.taskScheduled.slice(0, 120).map((c) => {
                  const at = c.assessmentDate ? `${String(c.assessmentDate).slice(0, 10)}T${c.assessmentTime ? String(c.assessmentTime) : '00:00:00'}` : null;
                  const waitMins = at ? Math.round((Date.now() - new Date(at).getTime()) / 60000) : null;
                  const upcoming = waitMins != null && waitMins < 0;
                  const delayed = waitMins != null && waitMins > 240;
                  return (
                    <View key={c.clientId} style={{ padding: 12, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: hexA(C.blue, 0.2), borderLeftWidth: 3, borderLeftColor: delayed ? C.red : C.blue, gap: 6 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <Body numberOfLines={1} style={{ fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }}>{c.name}</Body>
                        <Badge text={upcoming ? 'Upcoming' : 'Scheduled'} color={upcoming ? C.green : C.blue} />
                      </View>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                        <Body style={{ fontSize: 11, color: C.muted2 }}>Joined {fmt(c.joinedAt)}</Body>
                        {at ? <Body style={{ fontSize: 11.5, color: C.muted2 }}>QHP {fmt(at)}{c.assessmentTime ? ` · ${fmtT(at)}` : ''}</Body> : <Body style={{ fontSize: 11.5, color: C.muted3 }}>Awaiting date</Body>}
                      </View>
                      {delayed ? <Body style={{ fontSize: 10.5, color: C.red }}>⚠️ Delayed — this is slowing down the onboarding process</Body> : null}
                      <View style={{ flexDirection: 'row', gap: 8, marginTop: 2 }}>
                        <Pressable
                          onPress={() => { setReschedFor(c); setRDay(0); setRHour('9'); setRMin('00'); setRAmpm('AM'); }}
                          disabled={!c.assessmentId}
                          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9, borderRadius: 11, backgroundColor: hexA(C.blue, 0.12), borderWidth: 1, borderColor: hexA(C.blue, 0.4), opacity: c.assessmentId ? 1 : 0.5 }}
                        >
                          <Icon name="calendar" size={13} color={C.blue} strokeWidth={2.2} />
                          <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: C.blue }}>Reschedule QHP</Text>
                        </Pressable>
                        <Pressable onPress={() => { setCredsCopied(false); setCredsFor(c); }} style={{ width: 40, alignItems: 'center', justifyContent: 'center', paddingVertical: 9, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}>
                          <Icon name="copy" size={14} color={C.ink3} strokeWidth={2} />
                        </Pressable>
                      </View>
                    </View>
                  );
                })
              ) : sub === 'hold' ? (
                d.taskOnHold.length === 0 ? <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 18 }}>Nothing on hold.</Body> :
                d.taskOnHold.slice(0, 120).map((c) => (
                  <View key={c.clientId} style={{ padding: 12, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: hexA(c.holdOverdue ? C.red : C.purple, 0.2), borderLeftWidth: 3, borderLeftColor: c.holdOverdue ? C.red : C.purple, gap: 5 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Body numberOfLines={1} style={{ flex: 1, fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }}>{c.name}</Body>
                      <Badge text={c.holdOverdue ? 'Overdue' : 'On hold'} color={c.holdOverdue ? C.red : C.purple} />
                    </View>
                    {c.holdReason ? <Body style={{ fontSize: 11.5, color: C.muted2 }}>{c.holdReason}</Body> : null}
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                      <Body style={{ fontSize: 11, color: C.muted3 }}>Joined {fmt(c.joinedAt)}</Body>
                      {c.holdResolvingAt ? <Body style={{ fontSize: 11, color: c.holdOverdue ? C.red : C.purple }}>Resolving by {fmt(c.holdResolvingAt)} {fmtT(c.holdResolvingAt)}</Body> : null}
                    </View>
                    {/* web renders on-hold cards WITH the schedule action; scheduling clears the hold */}
                    <Pressable onPress={() => setScheduleFor(c)} style={{ borderRadius: 11, overflow: 'hidden', marginTop: 2 }}>
                      <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9 }}>
                        <Icon name="calendar" size={13} color="#fff" strokeWidth={2.4} />
                        <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: '#fff' }}>Schedule QHP</Text>
                      </LinearGradient>
                    </Pressable>
                  </View>
                ))
              ) : (
                d.reschedules.length === 0 ? <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 18 }}>No reschedule requests.</Body> :
                d.reschedules.map((r) => (
                  <View key={r.id} style={{ padding: 13, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: hexA(C.gold, 0.25), gap: 8 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Body numberOfLines={1} style={{ flex: 1, fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }}>{r.clientName}</Body>
                      <Badge text="Reschedule" color={C.gold} />
                    </View>
                    <Body style={{ fontSize: 11.5, color: C.muted2 }}>Assessor {r.assessorName}{r.requestedAt ? ` · Requested ${fmt(r.requestedAt)} ${fmtT(r.requestedAt)}` : ''}</Body>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <Body style={{ fontSize: 11.5, color: C.muted2 }}>Current {fmt(r.currentAt)} {fmtT(r.currentAt)}</Body>
                      <Icon name="chevRight" size={13} color={C.muted3} strokeWidth={2.2} />
                      <Body style={{ fontSize: 11.5, color: C.gold, fontFamily: F.bodySemi }}>Proposed {r.proposedAt ? `${fmt(r.proposedAt)} ${fmtT(r.proposedAt)}` : '—'}</Body>
                    </View>
                    {r.remark ? (
                      <View style={{ padding: 9, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }}>
                        <Mono style={{ fontSize: 8, letterSpacing: 0.7, color: C.muted3 }}>REMARK</Mono>
                        <Body style={{ fontSize: 11.5, color: C.ink3, marginTop: 2 }}>{r.remark}</Body>
                      </View>
                    ) : null}
                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 2 }}>
                      <Pressable onPress={() => resolveM.mutate({ id: r.id, approve: true })} disabled={resolveM.isPending} style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 11, backgroundColor: hexA(C.green, 0.14), borderWidth: 1, borderColor: hexA(C.green, 0.4) }}><Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: C.green }}>Approve</Text></Pressable>
                      <Pressable onPress={() => resolveM.mutate({ id: r.id, approve: false })} disabled={resolveM.isPending} style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 11, backgroundColor: hexA(C.red, 0.12), borderWidth: 1, borderColor: hexA(C.red, 0.4) }}><Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: C.red }}>Reject</Text></Pressable>
                    </View>
                  </View>
                ))
              )}
            </>
          ) : tab === 'manager' ? (
            /* ===== MANAGER — every QHP across trainers (list ⇄ calendar) ===== */
            <>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                {(([['SCHEDULED', d.counts.assessScheduled, C.blue], ['COMPLETED', d.counts.completed, C.green], ['OVERDUE', d.counts.overdue, C.red], ['TOTAL', d.counts.total, '#fff']]) as [string, number, string][]).map(([lab, val, col]) => (
                  <View key={lab} style={{ width: '47.5%', flexGrow: 1, paddingVertical: 10, borderRadius: 12, backgroundColor: hexA(col === '#fff' ? C.orange : col, 0.07), borderWidth: 1, borderColor: hexA(col === '#fff' ? C.orange : col, 0.22), alignItems: 'center' }}>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 18, color: col }}>{val}</Text>
                    <Mono style={{ fontSize: 8, letterSpacing: 0.8, color: C.muted3, marginTop: 1 }}>{lab}</Mono>
                  </View>
                ))}
              </View>
              {/* Filters (web QHPFilters: search / status / client / trainer) */}
              <View style={{ padding: 12, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', gap: 9 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Mono style={{ flex: 1, fontSize: 10, letterSpacing: 1.2, color: C.mono2 }}>FILTERS</Mono>
                  {mgrHasFilters ? (
                    <Pressable onPress={clearMgrFilters} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Icon name="close" size={11} color={C.orange} strokeWidth={2.4} />
                      <Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: C.orange }}>Clear All</Text>
                    </Pressable>
                  ) : null}
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, paddingHorizontal: 11, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
                  <Icon name="search" size={14} color={C.muted3} strokeWidth={2} />
                  <TextInput value={mgrSearch} onChangeText={setMgrSearch} placeholder="Search by client name…" placeholderTextColor={C.muted3} style={{ flex: 1, fontFamily: F.body, fontSize: 13, color: '#fff', padding: 0 }} />
                </View>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  {(([['all', 'All'], ['completed', 'Completed'], ['pending', 'Pending'], ['overdue', 'Overdue']]) as ['all' | 'completed' | 'pending' | 'overdue', string][]).map(([id, label]) => {
                    const active = mgrStatus === id;
                    const col = id === 'completed' ? C.green : id === 'pending' ? C.gold : id === 'overdue' ? C.red : C.blue;
                    return (
                      <Pressable key={id} onPress={() => setMgrStatus(id)} style={{ flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 10, backgroundColor: active ? hexA(col, 0.15) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(col, 0.45) : 'rgba(255,255,255,0.07)' }}>
                        <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 10.5, color: active ? col : C.muted }}>{label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Pressable onPress={() => { setMgrPick('client'); setMgrPickSearch(''); }} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 10, paddingHorizontal: 11, borderRadius: 11, backgroundColor: mgrClient !== 'all' ? hexA(C.orange, 0.1) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: mgrClient !== 'all' ? hexA(C.orange, 0.35) : 'rgba(255,255,255,0.08)' }}>
                    <Icon name="user" size={13} color={mgrClient !== 'all' ? C.orange : C.muted3} strokeWidth={2} />
                    <Body numberOfLines={1} style={{ flex: 1, fontSize: 12, color: mgrClient !== 'all' ? C.orange : C.muted }}>{mgrClient === 'all' ? 'All Clients' : mgrClientOpts.find((c) => c.id === mgrClient)?.name ?? 'Client'}</Body>
                    <Icon name="chevDown" size={12} color={C.muted3} strokeWidth={2.2} />
                  </Pressable>
                  <Pressable onPress={() => { setMgrPick('assessor'); setMgrPickSearch(''); }} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 10, paddingHorizontal: 11, borderRadius: 11, backgroundColor: mgrAssessor !== 'all' ? hexA(C.blue, 0.1) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: mgrAssessor !== 'all' ? hexA(C.blue, 0.35) : 'rgba(255,255,255,0.08)' }}>
                    <Icon name="users" size={13} color={mgrAssessor !== 'all' ? C.blue : C.muted3} strokeWidth={2} />
                    <Body numberOfLines={1} style={{ flex: 1, fontSize: 12, color: mgrAssessor !== 'all' ? C.blue : C.muted }}>{mgrAssessor === 'all' ? 'All Trainers' : mgrAssessor}</Body>
                    <Icon name="chevDown" size={12} color={C.muted3} strokeWidth={2.2} />
                  </Pressable>
                </View>
                {mgrHasFilters ? <Body style={{ fontSize: 10.5, color: C.muted3 }}>Showing {mgrFiltered.length} of {mgrAll.length}</Body> : null}
              </View>

              {/* View toggle */}
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {(([['list', 'List', 'bars'], ['calendar', 'Calendar', 'calendar']]) as ['list' | 'calendar', string, any][]).map(([id, label, icon]) => {
                  const active = mgrView === id;
                  return (
                    <Pressable key={id} onPress={() => { setMgrView(id); setCalSelDay(null); }} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9, borderRadius: 11, backgroundColor: active ? hexA(C.blue, 0.13) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.blue, 0.4) : 'rgba(255,255,255,0.07)' }}>
                      <Icon name={icon} size={13} color={active ? C.blue : C.muted} strokeWidth={2} />
                      <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 12, color: active ? C.blue : C.muted }}>{label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              {mgrView === 'calendar' ? (
                (() => {
                  // Month calendar of QHPs (filtered manager dataset).
                  const istDay = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
                  const byDay = new Map<string, typeof mgrFiltered>();
                  mgrFiltered.forEach((a) => {
                    if (!a.scheduledAt) return;
                    const k = istDay(a.scheduledAt);
                    if (!byDay.has(k)) byDay.set(k, [] as any);
                    (byDay.get(k) as any).push(a);
                  });
                  // web QHPCalendar: pending qhp_schedule requests overlay as amber markers
                  const reqByDay = new Map<string, typeof d.requests>();
                  d.requests.forEach((r) => {
                    if (!r.date) return;
                    const k = String(r.date).slice(0, 10);
                    if (!reqByDay.has(k)) reqByDay.set(k, [] as any);
                    (reqByDay.get(k) as any).push(r);
                  });
                  const daysInMonth = new Date(calCursor.y, calCursor.m + 1, 0).getDate();
                  const firstWeekday = new Date(calCursor.y, calCursor.m, 1).getDay();
                  const monthLabel = new Date(calCursor.y, calCursor.m, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
                  const p2 = (n: number) => String(n).padStart(2, '0');
                  const keyOf = (day: number) => `${calCursor.y}-${p2(calCursor.m + 1)}-${p2(day)}`;
                  const shift = (delta: number) => { const dd = new Date(calCursor.y, calCursor.m + delta, 1); setCalCursor({ y: dd.getFullYear(), m: dd.getMonth() }); setCalSelDay(null); };
                  const todayIso = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
                  const cells: (number | null)[] = [];
                  for (let i = 0; i < firstWeekday; i++) cells.push(null);
                  for (let day = 1; day <= daysInMonth; day++) cells.push(day);
                  while (cells.length % 7 !== 0) cells.push(null);
                  const weeks: (number | null)[][] = [];
                  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
                  const selList = calSelDay != null ? (byDay.get(keyOf(calSelDay)) ?? []) : [];
                  return (
                    <>
                      <View style={{ padding: 14, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                          <Serif style={{ flex: 1, fontSize: 17 }}>{monthLabel}</Serif>
                          <Pressable onPress={() => setMgrAddOpen(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10, backgroundColor: hexA(C.orange, 0.12), borderWidth: 1, borderColor: hexA(C.orange, 0.4), marginRight: 8 }}>
                            <Icon name="plus" size={11} color={C.orange} strokeWidth={2.5} />
                            <Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: C.orange }}>Add QHP</Text>
                          </Pressable>
                          <Pressable onPress={() => shift(-1)} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' }}><Icon path="M15 6l-6 6 6 6" size={13} color={C.muted} strokeWidth={2.2} /></Pressable>
                          <View style={{ width: 7 }} />
                          <Pressable onPress={() => shift(1)} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' }}><Icon name="chevRight" size={13} color={C.muted} strokeWidth={2.2} /></Pressable>
                        </View>
                        <View style={{ flexDirection: 'row', marginBottom: 7 }}>
                          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((w, i) => <Text key={i} style={{ flex: 1, textAlign: 'center', fontFamily: F.mono, fontSize: 9, color: C.muted3 }}>{w}</Text>)}
                        </View>
                        {weeks.map((wk, wi) => (
                          <View key={wi} style={{ flexDirection: 'row', marginBottom: 5 }}>
                            {wk.map((day, di) => {
                              const list = day ? byDay.get(keyOf(day)) ?? [] : [];
                              const sel = day != null && day === calSelDay;
                              const isToday = day != null && keyOf(day) === todayIso;
                              const anyOver = list.some((a: any) => a.overdue);
                              const allDone = list.length > 0 && list.every((a: any) => a.stage === 'completed');
                              const dotCol = anyOver ? C.red : allDone ? C.green : C.blue;
                              return (
                                <Pressable key={di} disabled={!day} onPress={() => day && setCalSelDay(sel ? null : day)} style={{ flex: 1, alignItems: 'center', gap: 3, paddingVertical: 3 }}>
                                  <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: sel ? C.orangeGradB : 'transparent', borderWidth: isToday && !sel ? 1.5 : 0, borderColor: hexA(C.orange, 0.55) }}>
                                    <Text style={{ fontFamily: sel || isToday ? F.bodyBold : F.body, fontSize: 12, color: sel ? '#fff' : isToday ? C.orange : day ? C.ink3 : 'transparent' }}>{day ?? 0}</Text>
                                  </View>
                                  <View style={{ height: 12, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 2 }}>
                                    {list.length ? (
                                      <View style={{ paddingHorizontal: 5, borderRadius: 7, backgroundColor: hexA(dotCol, 0.18) }}>
                                        <Text style={{ fontFamily: F.mono, fontSize: 8.5, color: dotCol }}>{list.length}</Text>
                                      </View>
                                    ) : null}
                                    {day && (reqByDay.get(keyOf(day))?.length ?? 0) > 0 ? (
                                      <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: C.gold }} />
                                    ) : null}
                                  </View>
                                </Pressable>
                              );
                            })}
                          </View>
                        ))}
                      </View>
                      {calSelDay != null ? (
                        <>
                          {selList.length === 0 && (reqByDay.get(keyOf(calSelDay))?.length ?? 0) === 0 ? <Body style={{ fontSize: 12, color: C.muted3, textAlign: 'center', paddingVertical: 10 }}>No QHPs on this day.</Body> : null}
                          {(selList as any[]).map((a) => {
                            const col = a.status === 'overdue' ? C.red : a.status === 'completed' ? C.green : C.blue;
                            const lab = a.status === 'overdue' ? 'Overdue' : a.status === 'completed' ? 'Completed' : 'Pending';
                            return (
                              <Pressable key={a.id} onPress={() => { set({ selectedClientId: a.id, selectedClientName: a.clientName }); go('qhp-assessment-detail'); }} style={{ padding: 12, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: hexA(col, 0.2), borderLeftWidth: 3, borderLeftColor: col, gap: 5 }}>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                  <Body numberOfLines={1} style={{ flex: 1, fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }}>{a.clientName}</Body>
                                  <Badge text={lab} color={col} />
                                  <Pressable hitSlop={8} onPress={() => Alert.alert('Delete QHP?', `${a.clientName}'s assessment will be permanently removed.`, [
                                    { text: 'Cancel', style: 'cancel' },
                                    { text: 'Delete', style: 'destructive', onPress: () => deleteQhpM.mutate(a.id) },
                                  ])}>
                                    <Icon name="close" size={14} color={C.red} strokeWidth={2.2} />
                                  </Pressable>
                                </View>
                                <Body style={{ fontSize: 11.5, color: C.muted2 }}>Assessor {a.assessorName}{a.scheduledAt ? ` · ${fmtT(a.scheduledAt) || fmt(a.scheduledAt)}` : ''}</Body>
                              </Pressable>
                            );
                          })}
                          {(reqByDay.get(keyOf(calSelDay)) ?? []).map((r: any) => (
                            <View key={`req-${r.id}`} style={{ padding: 12, borderRadius: 13, backgroundColor: hexA(C.gold, 0.05), borderWidth: 1, borderColor: hexA(C.gold, 0.3), borderLeftWidth: 3, borderLeftColor: C.gold, gap: 5 }}>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                <Body numberOfLines={1} style={{ flex: 1, fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }}>{r.clientName}</Body>
                                <Badge text="Pending Approval" color={C.gold} />
                              </View>
                              <Body style={{ fontSize: 11.5, color: C.muted2 }}>{r.time ? `${String(r.time).slice(0, 5)} · ` : ''}Awaiting manager approval — see the Requests tab</Body>
                            </View>
                          ))}
                        </>
                      ) : (
                        <Body style={{ fontSize: 11.5, color: C.muted3, textAlign: 'center' }}>Tap a day to see its QHPs.</Body>
                      )}
                    </>
                  );
                })()
              ) : mgrFiltered.length === 0 ? (
                <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 18 }}>No QHPs match the filters.</Body>
              ) : (
              mgrFiltered.slice(0, 80).map((a) => {
                // web QHPListView: badge = calculateQHPStatus (Completed / Pending / Overdue)
                const col = a.status === 'overdue' ? C.red : a.status === 'completed' ? C.green : a.stage === 'scheduled' ? C.blue : C.gold;
                const lab = a.status === 'overdue' ? 'Overdue' : a.status === 'completed' ? 'Completed' : 'Pending';
                return (
                  <Pressable key={a.id} onPress={() => { set({ selectedClientId: a.id, selectedClientName: a.clientName }); go('qhp-assessment-detail'); }} style={{ padding: 12, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: hexA(col, 0.2), borderLeftWidth: 3, borderLeftColor: col, gap: 6 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <Body numberOfLines={1} style={{ flex: 1, fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }}>{a.clientName}</Body>
                      <Badge text={lab} color={col} />
                      {a.validityOverdue ? <Badge text="Validity Overdue" color={C.red} /> : null}
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                      <Body style={{ fontSize: 11.5, color: C.muted2 }}>Assessor {a.assessorName}</Body>
                      {a.scheduledAt ? <Body style={{ fontSize: 11.5, color: C.muted2 }}>{fmt(a.scheduledAt)}</Body> : null}
                      <View style={{ flex: 1 }} />
                      <Icon name="chevRight" size={13} color={C.muted3} strokeWidth={2.2} />
                    </View>
                  </Pressable>
                );
              })
              )}
            </>
          ) : tab === 'tracker' ? (
            /* ===== TRACKER — per-client QHP compliance (web QHPTrackerTab) ===== */
            <>
              {(() => {
                const rows = trackerQ.data ?? [];
                const counts = {
                  'not-done': rows.filter((r) => r.status === 'not-done').length,
                  overdue: rows.filter((r) => r.status === 'overdue').length,
                  'due-soon': rows.filter((r) => r.status === 'due-soon').length,
                  completed: rows.filter((r) => r.status === 'completed').length,
                };
                const tq = trkSearch.trim().toLowerCase();
                const filtered = rows
                  .filter((r) => trkStatus === 'all' || r.status === trkStatus)
                  .filter((r) => !tq || r.name.toLowerCase().includes(tq) || r.trainers.some((t) => t.toLowerCase().includes(tq)));
                const stCol = (s: string) => (s === 'not-done' ? C.blue : s === 'overdue' ? C.red : s === 'due-soon' ? C.gold : C.green);
                const stLab = (s: string) => (s === 'not-done' ? 'Not Done' : s === 'overdue' ? 'Overdue' : s === 'due-soon' ? 'Due Soon' : 'On Track');
                return (
                  <>
                    {/* Stat chips (tap to filter) */}
                    <View style={{ flexDirection: 'row', gap: 7 }}>
                      {(['not-done', 'overdue', 'due-soon', 'completed'] as const).map((s) => {
                        const active = trkStatus === s;
                        return (
                          <Pressable key={s} onPress={() => setTrkStatus(active ? 'all' : s)} style={{ flex: 1, paddingVertical: 8, borderRadius: 11, backgroundColor: hexA(stCol(s), active ? 0.18 : 0.07), borderWidth: 1, borderColor: hexA(stCol(s), active ? 0.5 : 0.22), alignItems: 'center' }}>
                            <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: stCol(s) }}>{counts[s]}</Text>
                            <Mono style={{ fontSize: 7.5, color: C.muted3, marginTop: 1 }}>{stLab(s).toUpperCase()}</Mono>
                          </Pressable>
                        );
                      })}
                    </View>
                    {/* Search + 45d toggle */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
                        <Icon name="search" size={15} color={C.muted3} strokeWidth={2} />
                        <TextInput value={trkSearch} onChangeText={setTrkSearch} placeholder="Search client or trainer…" placeholderTextColor={C.muted3} style={{ flex: 1, fontFamily: F.body, fontSize: 13.5, color: '#fff', padding: 0 }} />
                      </View>
                      <Pressable onPress={() => setTrkFilter45(!trkFilter45)} style={{ paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, backgroundColor: trkFilter45 ? hexA(C.purple, 0.14) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: trkFilter45 ? hexA(C.purple, 0.4) : 'rgba(255,255,255,0.08)' }}>
                        <Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: trkFilter45 ? C.purple : C.muted }}>45d</Text>
                      </Pressable>
                    </View>
                    {trackerQ.isLoading ? (
                      <View style={{ paddingVertical: 26, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View>
                    ) : filtered.length === 0 ? (
                      <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 18 }}>No clients match the filters.</Body>
                    ) : (
                      <>
                        <Body style={{ fontSize: 11, color: C.muted3 }}>Showing {Math.min(filtered.length, 60)} of {rows.length}</Body>
                        {filtered.slice(0, 60).map((r) => {
                          const col = stCol(r.status);
                          return (
                            <View key={r.clientId} style={{ padding: 12, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: hexA(col, 0.2), borderLeftWidth: 3, borderLeftColor: col, gap: 6 }}>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                <Body numberOfLines={1} style={{ flex: 1, fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }}>{r.name}</Body>
                                {r.subscription ? <Badge text={r.subscription} color={C.orange} /> : null}
                                <Badge text={stLab(r.status)} color={col} />
                              </View>
                              {(r.trainers.length || r.crm) ? (
                                <Body style={{ fontSize: 11, color: C.muted2 }} numberOfLines={1}>
                                  {r.trainers.length ? (r.trainers.length === 1 ? r.trainers[0] : `${r.trainers.length} trainers`) : 'No trainer'}{r.crm ? ` · CRM ${r.crm}` : ''}
                                </Body>
                              ) : null}
                              <View style={{ flexDirection: 'row', gap: 8 }}>
                                {([['LAST WORKOUT', r.lastWorkout ? fmt(r.lastWorkout) : 'Never'], ['LAST QHP', r.lastQhp ? fmt(r.lastQhp) : 'Not Done'], ['NEXT DUE', r.nextDue ? fmt(r.nextDue) : 'Due Now']] as [string, string][]).map(([lab, val]) => (
                                  <View key={lab} style={{ flex: 1 }}>
                                    <Mono style={{ fontSize: 7.5, letterSpacing: 0.5, color: C.muted3 }}>{lab}</Mono>
                                    <Body style={{ fontSize: 11, color: C.ink3, marginTop: 1 }} numberOfLines={1}>{val}</Body>
                                  </View>
                                ))}
                              </View>
                              {r.daysUntilDue != null ? (
                                <Body style={{ fontSize: 10.5, color: r.daysUntilDue < 0 ? C.red : r.daysUntilDue <= 7 ? C.gold : C.muted3 }}>
                                  {r.daysUntilDue < 0 ? `${Math.abs(r.daysUntilDue)} days overdue` : r.daysUntilDue === 0 ? 'Due today' : `${r.daysUntilDue} days left`}{r.qhpBy ? ` · QHP by ${r.qhpBy}` : ''}
                                </Body>
                              ) : null}
                            </View>
                          );
                        })}
                      </>
                    )}
                  </>
                );
              })()}
            </>
          ) : tab === 'requests' ? (
            /* ===== REQUESTS — qhp_schedule pending, Approve & Schedule (web parity) ===== */
            d.requests.length === 0 ? <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 20 }}>No scheduling requests pending.</Body> :
            d.requests.map((r) => (
              <View key={r.id} style={{ padding: 12, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: hexA(C.gold, 0.2), borderLeftWidth: 3, borderLeftColor: C.gold, gap: 7 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Body numberOfLines={1} style={{ flex: 1, fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }}>{r.clientName}</Body>
                  <Badge text="Pending" color={C.gold} />
                </View>
                <Body style={{ fontSize: 11.5, color: C.muted2 }}>{r.date ? `${fmt(r.date)} ${r.time ? '· ' + String(r.time).slice(0, 5) : ''}` : 'Date TBD'}{r.address ? ` · ${r.address}` : ''}</Body>
                {r.scheduledByName ? <Body style={{ fontSize: 11, color: C.muted3 }}>Scheduled by: {r.scheduledByName}</Body> : null}
                {r.notes ? <Body style={{ fontSize: 11, color: C.muted3 }} numberOfLines={2}>{r.notes}</Body> : null}
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 2 }}>
                  <Pressable onPress={() => { setApproveFor(r); setApproveAssessor(null); }} style={{ flex: 1.6, borderRadius: 11, overflow: 'hidden' }}>
                    <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9 }}>
                      <Icon name="checks" size={13} color="#fff" strokeWidth={2.4} />
                      <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: '#fff' }}>Approve & Schedule</Text>
                    </LinearGradient>
                  </Pressable>
                  <Pressable onPress={() => openEdit(r)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9, borderRadius: 11, backgroundColor: hexA(C.blue, 0.12), borderWidth: 1, borderColor: hexA(C.blue, 0.4) }}>
                    <Icon name="clipboard" size={13} color={C.blue} strokeWidth={2} />
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: C.blue }}>Edit</Text>
                  </Pressable>
                </View>
              </View>
            ))
          ) : tab === 'linked' ? (
            /* ===== CLIENT LINKED — B2C clients → assigned staff (web ClientLinkedTab) ===== */
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
                <Icon name="search" size={15} color={C.muted3} strokeWidth={2} />
                <TextInput value={linkSearch} onChangeText={setLinkSearch} placeholder="Search B2C clients…" placeholderTextColor={C.muted3} style={{ flex: 1, fontFamily: F.body, fontSize: 13.5, color: '#fff', padding: 0 }} />
              </View>
              {(() => {
                const lq = linkSearch.trim().toLowerCase();
                const list = (linkedQ.data ?? []).filter((c) => !lq || c.name.toLowerCase().includes(lq));
                if (linkedQ.isLoading) return <View style={{ paddingVertical: 26, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View>;
                if (!list.length) return <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 18 }}>No clients found.</Body>;
                return (
                  <>
                    <Body style={{ fontSize: 11, color: C.muted3 }}>{list.length} client{list.length === 1 ? '' : 's'} found</Body>
                    {list.slice(0, 80).map((c) => (
                      <Pressable key={c.id} onPress={() => setLinkedFor(c)} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: 12, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
                        <MiniAvatar initial={c.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()} colors={['#7C8FE8', '#5B6FD0']} size={34} />
                        <Body numberOfLines={1} style={{ flex: 1, fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{c.name}</Body>
                        <Badge text={(c.status || 'Unknown').replace(/_/g, ' ')} color={c.status === 'actively_training' ? C.green : C.muted2} />
                        <Icon name="chevRight" size={13} color={C.muted3} strokeWidth={2.2} />
                      </Pressable>
                    ))}
                    {list.length > 80 ? <Body style={{ fontSize: 11, color: C.muted3, textAlign: 'center' }}>+{list.length - 80} more — refine your search</Body> : null}
                  </>
                );
              })()}
            </>
          ) : (
            /* ===== QHP REVIEW — manager approve / not-approve ===== */
            <>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {(([['Pending', d.review.pending.length, C.gold], ['Approved', d.review.approvedCount, C.green], ['Not approved', d.review.notApprovedCount, C.red]]) as [string, number, string][]).map(([lab, val, col]) => (
                  <View key={lab} style={{ flex: 1, paddingVertical: 9, borderRadius: 12, backgroundColor: hexA(col, 0.07), borderWidth: 1, borderColor: hexA(col, 0.22), alignItems: 'center' }}>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 17, color: col }}>{val}</Text>
                    <Mono style={{ fontSize: 8, letterSpacing: 0.6, color: C.muted3, marginTop: 1 }}>{lab.toUpperCase()}</Mono>
                  </View>
                ))}
              </View>
              {d.review.all.length === 0 ? <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 18 }}>No completed QHPs yet.</Body> :
                [...d.review.pending, ...d.review.all.filter((a) => a.managerReview !== null)].slice(0, 60).map((a) => {
                  const col = a.managerReview === 'approved' ? C.green : a.managerReview === 'not_approved' ? C.red : C.gold;
                  const lab = a.managerReview === 'approved' ? 'Approved' : a.managerReview === 'not_approved' ? 'Not approved' : 'Pending review';
                  return (
                    <View key={a.id} style={{ padding: 12, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: hexA(col, 0.2), borderLeftWidth: 3, borderLeftColor: col, gap: 8 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Body numberOfLines={1} style={{ flex: 1, fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }}>{a.clientName}</Body>
                        <Badge text={lab} color={col} />
                      </View>
                      <Body style={{ fontSize: 11.5, color: C.muted2 }}>Assessor {a.assessorName}{a.completedAt ? ` · Conducted ${fmt(a.completedAt)}` : a.scheduledAt ? ` · ${fmt(a.scheduledAt)}` : ''}</Body>
                      <Pressable onPress={() => setReviewFor(a.id)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9, borderRadius: 11, backgroundColor: hexA(C.blue, 0.12), borderWidth: 1, borderColor: hexA(C.blue, 0.4), marginTop: 2 }}>
                        <Icon path="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" size={14} color={C.blue} strokeWidth={2} />
                        <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: C.blue }}>Review</Text>
                      </Pressable>
                    </View>
                  );
                })}
            </>
          )}
        </>
      )}

      {/* Hold modal */}
      <Modal visible={!!holdFor} transparent animationType="fade" onRequestClose={() => setHoldFor(null)}>
        <Pressable onPress={() => setHoldFor(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', padding: 22 }}>
          <Pressable onPress={() => {}} style={{ borderRadius: 18, backgroundColor: '#141010', borderWidth: 1, borderColor: hexA(C.purple, 0.3), padding: 18, gap: 12 }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: '#fff' }}>Hold QHP</Text>
            <Body style={{ fontSize: 12, color: C.muted2 }}>{holdFor?.name} — reason for putting this client's QHP on hold.</Body>
            <TextInput
              value={holdReason}
              onChangeText={setHoldReason}
              placeholder="e.g. Client travelling, unreachable…"
              placeholderTextColor={C.muted3}
              multiline
              maxLength={500}
              style={{ minHeight: 70, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', padding: 12, color: '#fff', fontFamily: F.body, fontSize: 13, textAlignVertical: 'top' }}
            />
            <Mono style={{ fontSize: 9.5, letterSpacing: 1.2, color: C.mono2 }}>RESOLVE WITHIN (MAX 24H)</Mono>
            <View style={{ flexDirection: 'row', gap: 7 }}>
              {[1, 3, 6, 12, 24].map((h) => {
                const active = holdHours === h;
                return (
                  <Pressable key={h} onPress={() => setHoldHours(h)} style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 11, backgroundColor: hexA(C.purple, active ? 0.18 : 0.06), borderWidth: 1, borderColor: hexA(C.purple, active ? 0.5 : 0.2) }}>
                    <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 12, color: active ? C.purple : C.muted }}>{h}h</Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable onPress={() => { setHoldFor(null); setHoldReason(''); }} style={{ flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}><Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: C.muted }}>Cancel</Text></Pressable>
              <Pressable onPress={submitHold} disabled={!holdReason.trim() || holdM.isPending} style={{ flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 12, backgroundColor: hexA(C.purple, holdReason.trim() ? 0.16 : 0.06), borderWidth: 1, borderColor: hexA(C.purple, holdReason.trim() ? 0.45 : 0.2) }}><Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: holdReason.trim() ? C.purple : C.muted3 }}>{holdM.isPending ? 'Holding…' : 'Put on hold'}</Text></Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Approve & Schedule modal — pick assessor, then insert coach_assessment + mark request approved */}
      <Modal visible={!!approveFor} transparent animationType="fade" onRequestClose={() => setApproveFor(null)}>
        <Pressable onPress={() => setApproveFor(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', padding: 22 }}>
          <Pressable onPress={() => {}} style={{ borderRadius: 18, backgroundColor: '#141010', borderWidth: 1, borderColor: hexA(C.gold, 0.3), padding: 18, gap: 12, maxHeight: '80%' }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: '#fff' }}>Approve & Schedule</Text>
            <Body style={{ fontSize: 12, color: C.muted2 }}>
              {approveFor?.clientName} · {approveFor?.date ? fmt(approveFor.date) : 'Date TBD'}{approveFor?.time ? ` · ${String(approveFor.time).slice(0, 5)}` : ''} — pick the assessor who will conduct this QHP.
            </Body>
            <Mono style={{ fontSize: 9.5, letterSpacing: 1.2, color: C.mono2 }}>ASSESSOR (REQUIRED)</Mono>
            <ScrollView style={{ maxHeight: 260 }} showsVerticalScrollIndicator={false}>
              {(assessorsQ.data ?? []).map((a: any) => {
                const sel = approveAssessor === a.id;
                return (
                  <Pressable key={a.id} onPress={() => setApproveAssessor(a.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 11, backgroundColor: sel ? hexA(C.gold, 0.12) : 'transparent', borderWidth: 1, borderColor: sel ? hexA(C.gold, 0.4) : 'rgba(255,255,255,0.06)', marginBottom: 6 }}>
                    <Icon name="user" size={14} color={sel ? C.gold : C.muted} strokeWidth={2} />
                    <Body style={{ flex: 1, fontSize: 13.5, color: sel ? C.gold : C.ink }}>{a.name}{a.role === 'doctor' ? ' (Doctor)' : ''}</Body>
                    {sel ? <Icon path="M20 6 9 17l-5-5" size={14} color={C.gold} strokeWidth={2.6} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
            {approveM.isError ? <Body style={{ fontSize: 11.5, color: C.red }}>{(approveM.error as Error).message}</Body> : null}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable onPress={() => setApproveFor(null)} style={{ flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}><Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: C.muted }}>Cancel</Text></Pressable>
              <Pressable
                onPress={() => approveFor && approveAssessor && approveM.mutate({ request: approveFor, assessorId: approveAssessor, approverId: session?.user?.id ?? '' }, { onSuccess: () => setApproveFor(null) })}
                disabled={!approveAssessor || approveM.isPending}
                style={{ flex: 1.4, alignItems: 'center', paddingVertical: 11, borderRadius: 12, backgroundColor: hexA(C.gold, approveAssessor ? 0.16 : 0.06), borderWidth: 1, borderColor: hexA(C.gold, approveAssessor ? 0.45 : 0.2) }}
              >
                <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: approveAssessor ? C.gold : C.muted3 }}>{approveM.isPending ? 'Approving…' : 'Approve & Schedule'}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Client Linked — staff dialog */}
      <Modal visible={!!linkedFor} transparent animationType="fade" onRequestClose={() => setLinkedFor(null)}>
        <Pressable onPress={() => setLinkedFor(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', padding: 22 }}>
          <Pressable onPress={() => {}} style={{ borderRadius: 18, backgroundColor: '#141010', borderWidth: 1, borderColor: hexA(C.blue, 0.3), padding: 18, gap: 12, maxHeight: '75%' }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: '#fff' }}>Staff Assigned to {linkedFor?.name}</Text>
            {staffQ.isLoading ? (
              <View style={{ paddingVertical: 20, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View>
            ) : (staffQ.data ?? []).length === 0 ? (
              <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 14 }}>No staff assigned to this client.</Body>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false}>
                {(staffQ.data ?? []).map((s) => (
                  <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' }}>
                    <MiniAvatar initial={s.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()} colors={['#7C8FE8', '#5B6FD0']} size={34} />
                    <View style={{ flex: 1 }}>
                      <Body numberOfLines={1} style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{s.name}</Body>
                      {s.specializations.length ? <Body style={{ fontSize: 10.5, color: C.muted2, marginTop: 1 }} numberOfLines={1}>{s.specializations.join(' · ')}</Body> : null}
                    </View>
                    {s.role ? <Badge text={s.role.charAt(0).toUpperCase() + s.role.slice(1)} color={C.blue} /> : null}
                  </View>
                ))}
              </ScrollView>
            )}
            <Pressable onPress={() => setLinkedFor(null)} style={{ alignItems: 'center', paddingVertical: 11, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}><Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: C.ink3 }}>Close</Text></Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Manager filter picker (client / trainer) — keyboard dismissed before the Modal
          unmounts (new-arch crash) and taps select even while the keyboard is open */}
      <Modal visible={!!mgrPick} transparent animationType="fade" onRequestClose={() => { Keyboard.dismiss(); setMgrPick(null); }}>
        <Pressable onPress={() => { Keyboard.dismiss(); setMgrPick(null); }} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', padding: 22 }}>
          <Pressable onPress={() => {}} style={{ borderRadius: 18, backgroundColor: '#141010', borderWidth: 1, borderColor: 'rgba(255,150,90,0.2)', padding: 16, gap: 10, maxHeight: '75%' }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: '#fff' }}>{mgrPick === 'client' ? 'Filter by Client' : 'Filter by Trainer'}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, paddingHorizontal: 11, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
              <Icon name="search" size={14} color={C.muted3} strokeWidth={2} />
              <TextInput value={mgrPickSearch} onChangeText={setMgrPickSearch} placeholder="Search…" placeholderTextColor={C.muted3} autoCorrect={false} style={{ flex: 1, fontFamily: F.body, fontSize: 13, color: '#fff', padding: 0 }} />
            </View>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Pressable
                onPress={() => { Keyboard.dismiss(); if (mgrPick === 'client') setMgrClient('all'); else setMgrAssessor('all'); setMgrPick(null); }}
                style={{ paddingVertical: 11, paddingHorizontal: 12, borderRadius: 11, backgroundColor: (mgrPick === 'client' ? mgrClient : mgrAssessor) === 'all' ? hexA(C.orange, 0.1) : 'transparent', borderWidth: 1, borderColor: (mgrPick === 'client' ? mgrClient : mgrAssessor) === 'all' ? hexA(C.orange, 0.35) : 'rgba(255,255,255,0.06)', marginBottom: 6 }}
              >
                <Body style={{ fontSize: 13.5, color: C.orange }}>{mgrPick === 'client' ? 'All Clients' : 'All Trainers'}</Body>
              </Pressable>
              {(() => {
                const pq = mgrPickSearch.trim().toLowerCase();
                if (mgrPick === 'client') {
                  return mgrClientOpts.filter((c) => !pq || c.name.toLowerCase().includes(pq)).slice(0, 120).map((c) => {
                    const sel = mgrClient === c.id;
                    return (
                      <Pressable key={c.id} onPress={() => { Keyboard.dismiss(); setMgrClient(c.id); setMgrPick(null); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 11, backgroundColor: sel ? hexA(C.orange, 0.1) : 'transparent', borderWidth: 1, borderColor: sel ? hexA(C.orange, 0.35) : 'rgba(255,255,255,0.05)', marginBottom: 5 }}>
                        <Body numberOfLines={1} style={{ flex: 1, fontSize: 13, color: sel ? C.orange : C.ink }}>{c.name}</Body>
                        {sel ? <Icon path="M20 6 9 17l-5-5" size={13} color={C.orange} strokeWidth={2.6} /> : null}
                      </Pressable>
                    );
                  });
                }
                return mgrAssessorOpts.filter((n) => !pq || n.toLowerCase().includes(pq)).map((n) => {
                  const sel = mgrAssessor === n;
                  return (
                    <Pressable key={n} onPress={() => { Keyboard.dismiss(); setMgrAssessor(n); setMgrPick(null); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 11, backgroundColor: sel ? hexA(C.blue, 0.1) : 'transparent', borderWidth: 1, borderColor: sel ? hexA(C.blue, 0.35) : 'rgba(255,255,255,0.05)', marginBottom: 5 }}>
                      <Body numberOfLines={1} style={{ flex: 1, fontSize: 13, color: sel ? C.blue : C.ink }}>{n}</Body>
                      {sel ? <Icon path="M20 6 9 17l-5-5" size={13} color={C.blue} strokeWidth={2.6} /> : null}
                    </Pressable>
                  );
                });
              })()}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Edit request modal (web edit contract: qhp_schedule date/time/address/notes) */}
      <Modal visible={!!editFor} transparent animationType="fade" onRequestClose={() => setEditFor(null)}>
        <Pressable onPress={() => setEditFor(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', padding: 22 }}>
          <Pressable onPress={() => {}} style={{ borderRadius: 18, backgroundColor: '#141010', borderWidth: 1, borderColor: hexA(C.blue, 0.3), padding: 18, gap: 11 }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: '#fff' }}>Edit Request</Text>
            <Body style={{ fontSize: 12, color: C.muted2 }}>{editFor?.clientName}</Body>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Mono style={{ fontSize: 9, letterSpacing: 1, color: C.mono2, marginBottom: 5 }}>DATE (YYYY-MM-DD)</Mono>
                <TextInput value={eDate} onChangeText={setEDate} placeholder="2026-07-20" placeholderTextColor={C.muted3} style={{ paddingVertical: 11, paddingHorizontal: 12, borderRadius: 11, borderWidth: 1, borderColor: /^\d{4}-\d{2}-\d{2}$/.test(eDate.trim()) ? hexA(C.blue, 0.35) : 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.04)', color: '#fff', fontFamily: F.mono, fontSize: 13 }} />
              </View>
              <View style={{ width: 110 }}>
                <Mono style={{ fontSize: 9, letterSpacing: 1, color: C.mono2, marginBottom: 5 }}>TIME (HH:MM)</Mono>
                <TextInput value={eTime} onChangeText={setETime} placeholder="09:30" placeholderTextColor={C.muted3} style={{ paddingVertical: 11, paddingHorizontal: 12, borderRadius: 11, borderWidth: 1, borderColor: /^\d{2}:\d{2}$/.test(eTime.trim()) ? hexA(C.blue, 0.35) : 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.04)', color: '#fff', fontFamily: F.mono, fontSize: 13 }} />
              </View>
            </View>
            <View>
              <Mono style={{ fontSize: 9, letterSpacing: 1, color: C.mono2, marginBottom: 5 }}>ADDRESS</Mono>
              <TextInput value={eAddress} onChangeText={setEAddress} placeholder="Location" placeholderTextColor={C.muted3} style={{ paddingVertical: 11, paddingHorizontal: 12, borderRadius: 11, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.04)', color: '#fff', fontFamily: F.body, fontSize: 13 }} />
            </View>
            <View>
              <Mono style={{ fontSize: 9, letterSpacing: 1, color: C.mono2, marginBottom: 5 }}>NOTES</Mono>
              <TextInput value={eNotes} onChangeText={setENotes} placeholder="Optional" placeholderTextColor={C.muted3} multiline style={{ minHeight: 56, textAlignVertical: 'top', paddingVertical: 11, paddingHorizontal: 12, borderRadius: 11, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.04)', color: '#fff', fontFamily: F.body, fontSize: 13 }} />
            </View>
            {editM.isError ? <Body style={{ fontSize: 11.5, color: C.red }}>{(editM.error as Error).message}</Body> : null}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable onPress={() => setEditFor(null)} style={{ flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}><Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: C.muted }}>Cancel</Text></Pressable>
              <Pressable onPress={submitEdit} disabled={editM.isPending} style={{ flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 12, backgroundColor: hexA(C.blue, 0.16), borderWidth: 1, borderColor: hexA(C.blue, 0.45) }}><Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: C.blue }}>{editM.isPending ? 'Saving…' : 'Save Changes'}</Text></Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* B2C credentials modal (web ClientCredentialsDialog) */}
      <Modal visible={!!credsFor} transparent animationType="fade" onRequestClose={() => setCredsFor(null)}>
        <Pressable onPress={() => setCredsFor(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', padding: 22 }}>
          <Pressable onPress={() => {}} style={{ borderRadius: 18, backgroundColor: '#141010', borderWidth: 1, borderColor: hexA(C.gold, 0.3), padding: 18, gap: 12 }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: '#fff' }}>App Login Credentials</Text>
            <Body style={{ fontSize: 12, color: C.muted2 }}>{credsFor?.name}</Body>
            {credsQ.isLoading ? (
              <View style={{ paddingVertical: 16, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View>
            ) : credsQ.isError ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 12, backgroundColor: hexA(C.red, 0.08), borderWidth: 1, borderColor: hexA(C.red, 0.28) }}>
                <Icon name="alert" size={14} color={C.red} strokeWidth={2.2} />
                <Body style={{ flex: 1, fontSize: 12, color: '#E0A090' }}>{(credsQ.error as Error).message}</Body>
              </View>
            ) : credsQ.data ? (
              <>
                <View style={{ padding: 13, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)', gap: 10 }}>
                  <View>
                    <Mono style={{ fontSize: 9, letterSpacing: 1, color: C.muted3 }}>EMAIL</Mono>
                    <Text selectable style={{ fontFamily: F.mono, fontSize: 13.5, color: '#fff', marginTop: 3 }}>{credsQ.data.email}</Text>
                  </View>
                  <View>
                    <Mono style={{ fontSize: 9, letterSpacing: 1, color: C.muted3 }}>PASSWORD</Mono>
                    <Text selectable style={{ fontFamily: F.mono, fontSize: 13.5, color: '#fff', marginTop: 3 }}>{credsQ.data.password}</Text>
                  </View>
                </View>
                <Body style={{ fontSize: 10.5, color: C.muted3 }}>Default provisioning password — if the client changed it, this value is out of date.</Body>
                <Pressable
                  onPress={async () => { await Clipboard.setStringAsync(`Email: ${credsQ.data!.email}\nPassword: ${credsQ.data!.password}`); setCredsCopied(true); setTimeout(() => setCredsCopied(false), 2000); }}
                  style={{ borderRadius: 12, overflow: 'hidden' }}
                >
                  <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 12 }}>
                    <Icon name={credsCopied ? 'checks' : 'copy'} path={credsCopied ? 'M20 6 9 17l-5-5' : undefined} size={14} color="#fff" strokeWidth={2.4} />
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: '#fff' }}>{credsCopied ? 'Copied!' : 'Copy Credentials'}</Text>
                  </LinearGradient>
                </Pressable>
              </>
            ) : null}
            <Pressable onPress={() => setCredsFor(null)} style={{ alignItems: 'center', paddingVertical: 10, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}><Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: C.ink3 }}>Close</Text></Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* QHP review dialog — full data + decision (web QHPReviewTab dialog) */}
      <Modal visible={!!reviewFor} transparent animationType="slide" onRequestClose={() => setReviewFor(null)}>
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable onPress={() => setReviewFor(null)} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.65)' }} />
          <View style={{ height: '88%', backgroundColor: '#0E0A09', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.14)', paddingHorizontal: 18, paddingTop: 14 }}>
            <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 12 }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
              <View style={{ flex: 1 }}>
                <Serif style={{ fontSize: 20 }}>QHP Review</Serif>
                <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 2 }}>{reviewDetailQ.data?.clientName ?? '…'}</Body>
              </View>
              <Pressable onPress={() => setReviewFor(null)} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="close" size={14} color="#B8B2AC" strokeWidth={2.3} />
              </Pressable>
            </View>
            {reviewDetailQ.isLoading ? (
              <View style={{ paddingVertical: 30, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View>
            ) : reviewDetailQ.isError ? (
              <Body style={{ fontSize: 12.5, color: C.red, textAlign: 'center', paddingVertical: 20 }}>{(reviewDetailQ.error as Error).message}</Body>
            ) : reviewDetailQ.data ? (
              <>
                <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 16, gap: 12 }}>
                  {/* Overview */}
                  <View style={{ padding: 13, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', gap: 7 }}>
                    {([
                      ['Assessor', reviewDetailQ.data.assessorName],
                      ['Conducted', reviewDetailQ.data.completed ? `${fmt(reviewDetailQ.data.completed)} ${fmtT(reviewDetailQ.data.completed)}` : '—'],
                      ['Assessment Date', reviewDetailQ.data.assessmentDate ? fmt(reviewDetailQ.data.assessmentDate) : '—'],
                      ['Mechanical Score', reviewDetailQ.data.mechanicalScore != null ? String(reviewDetailQ.data.mechanicalScore) : '—'],
                    ] as [string, string][]).map(([lab, val]) => (
                      <View key={lab} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
                        <Mono style={{ fontSize: 9.5, letterSpacing: 0.5, color: C.muted3 }}>{lab.toUpperCase()}</Mono>
                        <Text style={{ flexShrink: 1, textAlign: 'right', fontFamily: F.bodySemi, fontSize: 12.5, color: C.ink }}>{val}</Text>
                      </View>
                    ))}
                  </View>
                  {/* Data sections */}
                  {([
                    ['QHP Data', reviewDetailQ.data.qhpData],
                    ['New Client Assessment', reviewDetailQ.data.newClientData],
                    ['Existing Client Assessment', reviewDetailQ.data.existingClientData],
                    ['AI Biomechanical', reviewDetailQ.data.aiBiomechanical],
                  ] as [string, any][]).filter(([, v]) => v && typeof v === 'object' && Object.keys(v).length > 0).map(([title, v]) => (
                    <View key={title} style={{ padding: 13, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: hexA(C.purple, 0.2), gap: 9 }}>
                      <Serif style={{ fontSize: 15, color: C.purple }}>{title}</Serif>
                      <JsonView data={v} />
                    </View>
                  ))}
                </ScrollView>
                {/* Decision bar */}
                <View style={{ flexDirection: 'row', gap: 8, paddingVertical: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.07)' }}>
                  <Pressable onPress={() => reviewM.mutate({ id: reviewDetailQ.data!.id, approve: true }, { onSuccess: () => setReviewFor(null) })} disabled={reviewM.isPending} style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: hexA(C.green, 0.14), borderWidth: 1, borderColor: hexA(C.green, 0.4) }}>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: C.green }}>{reviewM.isPending ? '…' : 'Approve'}</Text>
                  </Pressable>
                  <Pressable onPress={() => reviewM.mutate({ id: reviewDetailQ.data!.id, approve: false }, { onSuccess: () => setReviewFor(null) })} disabled={reviewM.isPending} style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: hexA(C.red, 0.12), borderWidth: 1, borderColor: hexA(C.red, 0.4) }}>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: C.red }}>Not approve</Text>
                  </Pressable>
                </View>
                {reviewDetailQ.data.managerReview ? <Body style={{ fontSize: 10.5, color: C.muted3, textAlign: 'center', paddingBottom: 10 }}>Current decision: {reviewDetailQ.data.managerReview === 'approved' ? 'Approved' : 'Not approved'} — you can change it above.</Body> : null}
              </>
            ) : null}
          </View>
        </View>
      </Modal>

      {/* Schedule QHP sheet (prefilled with the pending client + ops prefs; clears the hold on success) */}
      <ScheduleQhpSheet
        visible={!!scheduleFor}
        onClose={() => setScheduleFor(null)}
        scheduledBy={session?.user?.id ?? ''}
        prefill={scheduleFor ? {
          clientId: scheduleFor.clientId, clientName: scheduleFor.name,
          date: scheduleFor.opsPrefs?.date ?? null,
          time: scheduleFor.opsPrefs?.timeFrom ?? null,
          location: scheduleFor.opsPrefs?.location ?? null,
          notes: scheduleFor.opsPrefs?.notes ?? null,
          slaDeadlineIso: computeQhpSlaDeadline(scheduleFor.joinedAt).toISOString(),
          clearHold: !!(d && d.taskOnHold.some((h) => h.clientId === scheduleFor.clientId)),
        } : undefined}
      />

      {/* Manager calendar "Add QHP" — blank sheet with its own client picker */}
      <ScheduleQhpSheet visible={mgrAddOpen} onClose={() => setMgrAddOpen(false)} scheduledBy={session?.user?.id ?? ''} />

      {/* Manager reschedule modal — 14-day picker + tap-to-cycle time */}
      <Modal visible={!!reschedFor} transparent animationType="fade" onRequestClose={() => setReschedFor(null)}>
        <Pressable onPress={() => setReschedFor(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', padding: 22 }}>
          <Pressable onPress={() => {}} style={{ borderRadius: 18, backgroundColor: '#141010', borderWidth: 1, borderColor: hexA(C.blue, 0.3), padding: 18, gap: 13 }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: '#fff' }}>Reschedule QHP</Text>
            <Body style={{ fontSize: 12, color: C.muted2 }}>{reschedFor?.name} — pick the new date & time.</Body>
            <Mono style={{ fontSize: 9.5, letterSpacing: 1.2, color: C.mono2 }}>NEW DATE</Mono>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 7 }}>
              {Array.from({ length: 14 }, (_, i) => i).map((i) => {
                const d = new Date(Date.now() + i * 864e5);
                const activeDay = rDay === i;
                return (
                  <Pressable key={i} onPress={() => setRDay(i)} style={{ alignItems: 'center', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 11, backgroundColor: activeDay ? hexA(C.blue, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: activeDay ? hexA(C.blue, 0.5) : 'rgba(255,255,255,0.08)' }}>
                    <Mono style={{ fontSize: 8.5, color: activeDay ? C.blue : C.muted3 }}>{d.toLocaleDateString('en-IN', { weekday: 'short' }).toUpperCase()}</Mono>
                    <Text style={{ fontFamily: activeDay ? F.bodyBold : F.bodySemi, fontSize: 13.5, color: activeDay ? C.blue : C.ink3, marginTop: 1 }}>{d.getDate()}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <Mono style={{ fontSize: 9.5, letterSpacing: 1.2, color: C.mono2 }}>NEW TIME</Mono>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
              <Pressable onPress={() => { const H = ['6', '7', '8', '9', '10', '11', '12', '1', '2', '3', '4', '5']; setRHour(H[(H.indexOf(rHour) + 1) % H.length]); }} style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
                <Text style={{ fontFamily: F.mono, fontSize: 15, color: '#fff' }}>{rHour}</Text>
              </Pressable>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 16, color: C.muted3 }}>:</Text>
              <Pressable onPress={() => { const M = ['00', '15', '30', '45']; setRMin(M[(M.indexOf(rMin) + 1) % M.length]); }} style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
                <Text style={{ fontFamily: F.mono, fontSize: 15, color: '#fff' }}>{rMin}</Text>
              </Pressable>
              <Pressable onPress={() => setRAmpm(rAmpm === 'AM' ? 'PM' : 'AM')} style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: hexA(C.blue, 0.1), borderWidth: 1, borderColor: hexA(C.blue, 0.35) }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: C.blue }}>{rAmpm}</Text>
              </Pressable>
            </View>
            <Mono style={{ fontSize: 8.5, color: C.muted3 }}>Tap hour / minutes / period to change</Mono>
            <Mono style={{ fontSize: 9.5, letterSpacing: 1.2, color: C.mono2 }}>REASON (REQUIRED, MIN 10 CHARACTERS)</Mono>
            <TextInput
              value={rReason}
              onChangeText={setRReason}
              placeholder="Why is this QHP being rescheduled?"
              placeholderTextColor={C.muted3}
              multiline
              style={{ minHeight: 60, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: rReason.trim().length >= 10 ? hexA(C.blue, 0.35) : 'rgba(255,255,255,0.1)', padding: 12, color: '#fff', fontFamily: F.body, fontSize: 13, textAlignVertical: 'top' }}
            />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable onPress={() => { setReschedFor(null); setRReason(''); }} style={{ flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}><Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: C.muted }}>Cancel</Text></Pressable>
              <Pressable onPress={submitResched} disabled={reschedM.isPending || rReason.trim().length < 10} style={{ flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 12, backgroundColor: hexA(C.blue, rReason.trim().length >= 10 ? 0.16 : 0.06), borderWidth: 1, borderColor: hexA(C.blue, rReason.trim().length >= 10 ? 0.45 : 0.2), opacity: reschedM.isPending ? 0.6 : 1 }}><Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: rReason.trim().length >= 10 ? C.blue : C.muted3 }}>{reschedM.isPending ? 'Saving…' : 'Reschedule'}</Text></Pressable>
            </View>
            {reschedM.isError ? <Body style={{ fontSize: 11.5, color: C.red }}>{(reschedM.error as Error).message}</Body> : null}
          </Pressable>
        </Pressable>
      </Modal>
    </Page>
  );
}

/* ============ QHP STATS ============ */
export function QhpStats() {
  const [period, setPeriod] = React.useState<'week' | 'month'>('week');
  const [segment, setSegment] = React.useState<'planned' | 'pending' | 'completed'>('completed');
  const [openAssessor, setOpenAssessor] = React.useState<string | null>(null);
  const statsQ = useQhpStats(period, true);
  const d = statsQ.data;

  const fmtYmd = (ymd: string | null | undefined) => {
    if (!ymd) return '—';
    const [y, m, day] = ymd.split('-').map(Number);
    if (!y || !m || !day) return ymd;
    return `${day} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]}`;
  };
  const fmtTime = (t: string | null) => {
    if (!t) return null;
    const [h, m] = t.split(':').map(Number);
    if (Number.isNaN(h)) return t;
    const ampm = h >= 12 ? 'PM' : 'AM';
    return `${((h + 11) % 12) + 1}:${String(m ?? 0).padStart(2, '0')} ${ampm}`;
  };
  const initialsOf = (name: string) => name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';

  const total = (d?.planned ?? 0) + (d?.pending ?? 0) + (d?.completed ?? 0);
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
  const SEGMENTS = [
    { key: 'planned' as const, label: 'Planned', sub: 'Booked, no assessor yet', count: d?.planned ?? 0, color: C.blue },
    { key: 'pending' as const, label: 'Pending', sub: 'Assessor assigned, in progress', count: d?.pending ?? 0, color: C.gold },
    { key: 'completed' as const, label: 'Completed', sub: 'Done in this period', count: d?.completed ?? 0, color: C.green },
  ];
  const seg = SEGMENTS.find((s) => s.key === segment)!;

  return (
    <Page gap={14} pt={6}>
      <TitleBlock title="QHP Stats" sub={d ? `${fmtYmd(d.rangeStart)} — ${fmtYmd(d.rangeEnd)} · IST` : 'Planned, pending & completed QHPs'} />

      {/* Period switch */}
      <View style={{ flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 14, padding: 4, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }}>
        {(['week', 'month'] as const).map((p) => {
          const on = period === p;
          const lab = p === 'week' ? 'This Week' : 'This Month';
          return (
            <Pressable key={p} onPress={() => setPeriod(p)} style={{ flex: 1, borderRadius: 11, overflow: 'hidden' }}>
              {on ? (
                <LinearGradient colors={[C.orangeGradA, C.orangeGradB]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ paddingVertical: 9, alignItems: 'center' }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: '#1A0D05' }}>{lab}</Text>
                </LinearGradient>
              ) : (
                <View style={{ paddingVertical: 9, alignItems: 'center' }}>
                  <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: C.muted3 }}>{lab}</Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </View>

      {statsQ.isLoading ? (
        <View style={{ paddingVertical: 46, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View>
      ) : statsQ.isError ? (
        <Body style={{ fontSize: 12.5, color: C.red, textAlign: 'center', paddingVertical: 24 }}>{(statsQ.error as Error).message}</Body>
      ) : d ? (
        <>
          {/* Summary — total + stacked share bar + tappable legend */}
          <Card colors={['rgba(46,28,18,0.45)', 'rgba(18,14,14,0.55)']} border="rgba(255,150,90,0.12)" radius={20} style={{ padding: 16, gap: 13 }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
              <View style={{ flex: 1 }}>
                <Mono style={{ fontSize: 10, letterSpacing: 1.6, color: C.mono }}>TOTAL QHPS</Mono>
                <Serif style={{ fontSize: 38, color: '#fff', marginTop: 2 }}>{total}</Serif>
              </View>
              <View style={{ alignItems: 'flex-end', paddingBottom: 5 }}>
                <Serif style={{ fontSize: 21, color: C.green }}>{pct(d.completed)}%</Serif>
                <Mono style={{ fontSize: 8.5, letterSpacing: 0.8, color: C.muted3, marginTop: 1 }}>COMPLETED</Mono>
              </View>
            </View>
            {/* Stacked bar */}
            <View style={{ height: 9, borderRadius: 5, overflow: 'hidden', flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.06)' }}>
              {total > 0 ? SEGMENTS.map((s) => (s.count > 0 ? <View key={s.key} style={{ flex: s.count, backgroundColor: s.color }} /> : null)) : null}
            </View>
            {/* Legend chips — tap to inspect */}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {SEGMENTS.map((s) => {
                const on = segment === s.key;
                return (
                  <Pressable key={s.key} onPress={() => setSegment(s.key)} style={{ flex: 1, alignItems: 'center', gap: 3, paddingVertical: 9, borderRadius: 13, backgroundColor: on ? hexA(s.color, 0.13) : 'rgba(255,255,255,0.025)', borderWidth: 1, borderColor: on ? hexA(s.color, 0.5) : 'rgba(255,255,255,0.06)' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: s.color }} />
                      <Text style={{ fontFamily: F.bodyBold, fontSize: 16, color: on ? '#fff' : C.muted2 }}>{s.count}</Text>
                    </View>
                    <Body style={{ fontSize: 10, color: on ? s.color : C.muted3 }}>{s.label}</Body>
                  </Pressable>
                );
              })}
            </View>
          </Card>

          {/* Selected segment detail */}
          <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border={hexA(seg.color, 0.15)} radius={20} style={{ padding: 15 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 4 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: seg.color }} />
              <Text style={{ flex: 1, fontFamily: F.bodyBold, fontSize: 14, color: '#fff' }}>{seg.label} <Text style={{ color: seg.color }}>· {seg.count}</Text></Text>
              <Body style={{ fontSize: 10.5, color: C.muted3 }}>{seg.sub}</Body>
            </View>
            {segment === 'planned' && (d.plannedRows.length === 0 ? (
              <Body style={{ fontSize: 12, color: C.muted3, textAlign: 'center', paddingVertical: 16 }}>Nothing planned in this period.</Body>
            ) : d.plannedRows.map((r, i) => (
              <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 10, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: 'rgba(255,255,255,0.05)' }}>
                <Avatar initial={initialsOf(r.clientName)} size={34} colors={[hexA(C.blue, 0.85), '#4C5FB8']} fontSize={12} />
                <View style={{ flex: 1 }}>
                  <Body numberOfLines={1} style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{r.clientName}</Body>
                  <Body numberOfLines={1} style={{ fontSize: 10.5, color: C.muted3, marginTop: 1 }}>Booked by {r.bookedByName}</Body>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Body style={{ fontSize: 12, fontFamily: F.bodySemi, color: C.blue }}>{fmtYmd(r.date)}</Body>
                  {fmtTime(r.time) ? <Mono style={{ fontSize: 9, color: C.muted3, marginTop: 1 }}>{fmtTime(r.time)}</Mono> : null}
                </View>
              </View>
            )))}
            {segment === 'pending' && (d.pendingRows.length === 0 ? (
              <Body style={{ fontSize: 12, color: C.muted3, textAlign: 'center', paddingVertical: 16 }}>Nothing pending in this period.</Body>
            ) : d.pendingRows.map((r, i) => (
              <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 10, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: 'rgba(255,255,255,0.05)' }}>
                <Avatar initial={initialsOf(r.clientName)} size={34} colors={[hexA(C.gold, 0.9), '#B8860B']} fontSize={12} />
                <View style={{ flex: 1 }}>
                  <Body numberOfLines={1} style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{r.clientName}</Body>
                  <Body numberOfLines={1} style={{ fontSize: 10.5, color: C.muted3, marginTop: 1 }}>Assessor · {r.assessorName}</Body>
                </View>
                <Body style={{ fontSize: 12, fontFamily: F.bodySemi, color: C.gold }}>{r.assessmentDate ? fmtYmd(r.assessmentDate) : 'No date'}</Body>
              </View>
            )))}
            {segment === 'completed' && (d.completedRows.length === 0 ? (
              <Body style={{ fontSize: 12, color: C.muted3, textAlign: 'center', paddingVertical: 16 }}>Nothing completed in this period.</Body>
            ) : d.completedRows.map((r, i) => (
              <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 10, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: 'rgba(255,255,255,0.05)' }}>
                <Avatar initial={initialsOf(r.clientName)} size={34} colors={[hexA(C.green, 0.85), '#2F8A5C']} fontSize={12} />
                <View style={{ flex: 1 }}>
                  <Body numberOfLines={1} style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{r.clientName}</Body>
                  <Body numberOfLines={1} style={{ fontSize: 10.5, color: C.muted3, marginTop: 1 }}>Assessor · {r.assessorName}</Body>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Body style={{ fontSize: 12, fontFamily: F.bodySemi, color: C.green }}>{istDayLabel(r.completed)}</Body>
                  <Mono style={{ fontSize: 9, color: C.muted3, marginTop: 1 }}>{istTimeParts(r.completed).time} {istTimeParts(r.completed).ampm}</Mono>
                </View>
              </View>
            )))}
          </Card>

          {/* Breakdown by assessor */}
          <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.09)" radius={20} style={{ padding: 15 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', marginBottom: 4 }}>
              <Mono style={{ flex: 1, fontSize: 10.5, letterSpacing: 1.6, color: C.mono }}>BY ASSESSOR</Mono>
              <Body style={{ fontSize: 10, color: C.muted3 }}>tap to expand</Body>
            </View>
            {d.byAssessor.length === 0 ? (
              <Body style={{ fontSize: 12, color: C.muted3, textAlign: 'center', paddingVertical: 16 }}>No assessor activity in this period.</Body>
            ) : d.byAssessor.map((a, i) => {
              const t = a.pending + a.completed;
              const donePct = t > 0 ? Math.round((a.completed / t) * 100) : 0;
              const open = openAssessor === a.assessorId;
              return (
                <View key={a.assessorId} style={{ borderTopWidth: i === 0 ? 0 : 1, borderTopColor: 'rgba(255,255,255,0.05)' }}>
                  <Pressable onPress={() => setOpenAssessor(open ? null : a.assessorId)} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 11 }}>
                    <Avatar initial={initialsOf(a.assessorName)} size={36} colors={[hexA(C.orange, 0.85), '#B24E12']} fontSize={12.5} />
                    <View style={{ flex: 1 }}>
                      <Body numberOfLines={1} style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{a.assessorName}</Body>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                        {a.pending > 0 ? <Body style={{ fontSize: 10.5, color: C.gold }}>{a.pending} pending</Body> : null}
                        {a.pending > 0 && a.completed > 0 ? <Body style={{ fontSize: 10.5, color: C.muted3 }}>·</Body> : null}
                        {a.completed > 0 ? <Body style={{ fontSize: 10.5, color: C.green }}>{a.completed} done</Body> : null}
                      </View>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      <Text style={{ fontFamily: F.bodyBold, fontSize: 16, color: '#fff' }}>{t}</Text>
                      <View style={{ width: 52 }}>
                        <ProgressBar pct={donePct} height={4} fill={donePct >= 80 ? C.green : donePct >= 50 ? C.gold : C.red} />
                      </View>
                    </View>
                    <View style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}>
                      <Icon name="chevRight" size={12} color={C.muted3} strokeWidth={2.2} />
                    </View>
                  </Pressable>
                  {open ? (
                    <View style={{ marginBottom: 12, marginLeft: 47, gap: 6 }}>
                      {a.pendingRows.map((r) => (
                        <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.gold }} />
                          <Body numberOfLines={1} style={{ flex: 1, fontSize: 11.5, color: C.muted2 }}>{r.clientName}</Body>
                          <Mono style={{ fontSize: 9, color: C.gold }}>{r.assessmentDate ? fmtYmd(r.assessmentDate) : 'pending'}</Mono>
                        </View>
                      ))}
                      {a.completedRows.map((r) => (
                        <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <Icon path="M20 6 9 17l-5-5" size={10} color={C.green} strokeWidth={2.6} />
                          <Body numberOfLines={1} style={{ flex: 1, fontSize: 11.5, color: C.muted2 }}>{r.clientName}</Body>
                          <Mono style={{ fontSize: 9, color: C.green }}>{istDayLabel(r.completed)}</Mono>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </Card>
        </>
      ) : null}
    </Page>
  );
}
/* ============ MANAGERS OVERVIEW ============ */
/* Expandable team-member rank row — tap to load the per-client session breakdown
   or referral detail for the competition window (web TrainerSessionRow /
   TrainerReferralRow parity, via the same SECURITY DEFINER RPCs). */
function MgrMemberRow({ member, rank, metric, value, unit, first, periodStart, periodEnd }: {
  member: { id: string; name: string; sessions: number; qhps: number; isManager: boolean };
  rank: number; metric: 'sessions' | 'qhps' | 'referrals'; value: number; unit: string; first: boolean;
  periodStart: string | null; periodEnd: string | null;
}) {
  const [open, setOpen] = React.useState(false);
  const expandable = metric === 'sessions' || metric === 'referrals';
  const sessQ = useTrainerSessionBreakdown(member.id, periodStart, periodEnd, open && metric === 'sessions');
  const refQ = useTrainerReferralBreakdown(member.id, periodStart, periodEnd, open && metric === 'referrals');
  const refStatusCol = (s: string | null) => { const t = (s ?? '').toLowerCase(); return t.includes('reject') ? C.red : t.includes('convert') || t.includes('approve') || t.includes('join') ? C.green : C.gold; };

  return (
    <View style={{ borderTopWidth: first ? 0 : 1, borderTopColor: 'rgba(255,255,255,0.05)' }}>
      <Pressable disabled={!expandable} onPress={() => setOpen((o) => !o)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 }}>
        <Mono style={{ width: 16, fontSize: 11, color: C.muted3 }}>{rank}</Mono>
        <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: C.ink3 }}>{initials(member.name)}</Text></View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Body numberOfLines={1} style={{ fontSize: 14, fontFamily: F.bodySemi }}>{member.name}</Body>
            {member.isManager ? <Badge text="Manager" color={C.gold} /> : null}
          </View>
          <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 1 }}>{member.sessions} sess · {member.qhps} QHP</Body>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Serif style={{ fontSize: 18 }}>{value}</Serif>
          <Mono style={{ fontSize: 9, color: C.muted3 }}>{unit.toUpperCase()}</Mono>
        </View>
        {expandable ? <Icon name={open ? 'chevUp' : 'chevDown'} size={14} color={C.muted3} strokeWidth={2.2} /> : null}
      </Pressable>

      {open && metric === 'sessions' ? (
        <View style={{ paddingBottom: 14, gap: 8 }}>
          {sessQ.isLoading ? <Body style={{ fontSize: 11.5, color: C.muted3, textAlign: 'center', paddingVertical: 8 }}>Loading breakdown…</Body>
          : sessQ.isError ? <Body style={{ fontSize: 11, color: C.red, textAlign: 'center' }}>{(sessQ.error as Error).message}</Body>
          : (sessQ.data ?? []).length === 0 ? <Body style={{ fontSize: 11.5, color: C.muted3, textAlign: 'center', paddingVertical: 6 }}>No sessions logged in this period.</Body>
          : (
            <>
              <Mono style={{ fontSize: 8.5, letterSpacing: 0.8, color: C.mono2 }}>PER-CLIENT BREAKDOWN · {(sessQ.data ?? []).length} CLIENTS</Mono>
              {(sessQ.data ?? []).map((r) => (
                <View key={r.clientId} style={{ padding: 11, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', gap: 6 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Body numberOfLines={1} style={{ fontSize: 12.5, fontFamily: F.bodySemi, color: '#fff' }}>{r.clientName}</Body>
                      <Mono style={{ fontSize: 8, color: C.muted3, marginTop: 1 }}>LAST {r.lastAt ? istDayLabel(r.lastAt).toUpperCase() : '—'}</Mono>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: '#fff' }}>{r.total}</Text>
                      <Mono style={{ fontSize: 7.5, color: C.muted3 }}>TOTAL</Mono>
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
                    {(([['Completed', r.completed, C.green], ['Cancelled', r.cancelled, C.red], ['Parked', r.parked, C.muted2], ['Pending', r.pending, C.gold], ['Comp', r.complimentary, C.blue]]) as [string, number, string][]).filter(([, n]) => n > 0).map(([lab, n, col]) => (
                      <Badge key={lab} text={`${lab} ${n}`} color={col} />
                    ))}
                  </View>
                </View>
              ))}
            </>
          )}
        </View>
      ) : null}

      {open && metric === 'referrals' ? (
        <View style={{ paddingBottom: 14, gap: 8 }}>
          {refQ.isLoading ? <Body style={{ fontSize: 11.5, color: C.muted3, textAlign: 'center', paddingVertical: 8 }}>Loading referrals…</Body>
          : refQ.isError ? <Body style={{ fontSize: 11, color: C.red, textAlign: 'center' }}>{(refQ.error as Error).message}</Body>
          : (refQ.data ?? []).length === 0 ? <Body style={{ fontSize: 11.5, color: C.muted3, textAlign: 'center', paddingVertical: 6 }}>No referrals in this period.</Body>
          : (refQ.data ?? []).map((r) => (
            <View key={r.id} style={{ padding: 11, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', gap: 5 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Body numberOfLines={1} style={{ flex: 1, fontSize: 12.5, fontFamily: F.bodySemi, color: '#fff' }}>{r.name}</Body>
                {r.status ? <Badge text={r.status} color={refStatusCol(r.status)} /> : null}
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                {r.source ? <Body style={{ fontSize: 10.5, color: C.muted2 }}>Source {r.source}</Body> : null}
                <Mono style={{ fontSize: 8, color: C.muted3 }}>{istDayLabel(r.createdAt).toUpperCase()}</Mono>
              </View>
              {r.linkedClientName ? <Body style={{ fontSize: 10.5, color: C.green }}>Linked to {r.linkedClientName}</Body> : null}
              {r.rejectionReason ? <Body style={{ fontSize: 10.5, color: C.red }}>Rejected: {r.rejectionReason}</Body> : null}
              {r.notes ? <Body numberOfLines={2} style={{ fontSize: 10.5, color: C.muted3, fontStyle: 'italic' }}>{r.notes}</Body> : null}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export function Managers() {
  const { mgrTab, set } = useStore();
  const trainerId = useTrainerId();
  const mgrCaps = useMyCapabilities();
  const teamQ = useManagerTeam(trainerId);
  const teams = teamQ.data?.teams ?? [];
  const [selTeamId, setSelTeamId] = React.useState<string | null>(null);
  const selTeamIdx = Math.max(0, teams.findIndex((t) => t.id === selTeamId));
  const team = teams[selTeamIdx] ?? teams[0];
  const members = team?.members ?? [];
  const trainers = members.filter((m) => !m.isManager);

  // Panel data for the selected team (hooks self-disable until ids+period are ready).
  const panelParams = { memberIds: members.map((m) => m.id), periodStart: team?.periodStart ?? null, periodEnd: team?.periodEnd ?? null };
  const leavesQ = useManagerTeamLeaves(panelParams);
  const incidentsQ = useManagerTeamIncidents(panelParams);
  const retentionQ = useManagerTeamRetention(panelParams);
  const lateLogsQ = useManagerTeamLateLogs(panelParams);
  const leaves = leavesQ.data ?? [];
  const incidents = incidentsQ.data ?? [];
  const retention = retentionQ.data ?? [];
  const lateLogs = lateLogsQ.data ?? [];

  const memberSimple = members.map((m) => ({ id: m.id, name: m.name, isManager: m.isManager }));
  const trainerIds = members.map((m) => m.id);
  const rosterTabQ = useManagerTeamRoster(trainerIds, team?.periodStart ?? null, team?.periodEnd ?? null);
  const planQ = useManagerTeamPlanOverview(memberSimple);
  const acksQ = useManagerTeamAcks(memberSimple);
  const appQ = useManagerTeamAppAdoption(memberSimple);
  const [ackOpenT, setAckOpenT] = React.useState<string | null>(null);
  const [ackOpenD, setAckOpenD] = React.useState<string | null>(null);

  const metric: 'sessions' | 'qhps' | 'referrals' = mgrTab === 'qhp' ? 'qhps' : mgrTab === 'referrals' ? 'referrals' : 'sessions';
  const ranked = [...members].sort((a, b) => b[metric] - a[metric]);
  const totalSessions = members.reduce((n, m) => n + m.sessions, 0);
  const totalQhp = members.reduce((n, m) => n + m.qhps, 0);
  const totalRefs = members.reduce((n, m) => n + m.referrals, 0);
  const fmtK = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
  const periodLabel = team?.periodStart
    ? `${istDayLabel(team.periodStart + 'T00:00:00Z')}${team.periodEnd ? ' – ' + istDayLabel(team.periodEnd + 'T00:00:00Z') : ''}`
    : 'Current period';

  if (teamQ.isLoading) {
    return (
      <Page gap={16} pt={6}>
        <View style={{ alignItems: 'center', gap: 8, paddingVertical: 40 }}>
          <Icon name="clock" size={22} color={C.muted3} strokeWidth={1.8} />
          <Body style={{ fontSize: 12.5, color: C.muted3 }}>Loading your team…</Body>
        </View>
      </Page>
    );
  }
  if (teamQ.isError || !team) {
    return (
      <Page gap={16} pt={6}>
        <View style={{ alignItems: 'center', gap: 10, paddingVertical: 44 }}>
          <Icon name="crown" size={30} color="#4C4640" strokeWidth={1.6} />
          <Serif style={{ fontSize: 19 }}>No team to manage</Serif>
          <Body style={{ fontSize: 13, color: C.muted3, textAlign: 'center', paddingHorizontal: 30 }}>
            {teamQ.isError ? "Couldn't load your team right now." : "You're not part of any manager competition yet."}
          </Body>
        </View>
      </Page>
    );
  }

  const tabs: { id: string; label: string; count: number | null }[] = [
    { id: 'sessions', label: 'Sessions', count: null as number | null },
    { id: 'qhp', label: 'QHP', count: totalQhp || null },
    { id: 'referrals', label: 'Referrals', count: totalRefs || null },
    { id: 'leaves', label: 'Leaves', count: leaves.length || null },
    { id: 'incidents', label: 'Incidents', count: incidents.length || null },
    { id: 'retention', label: 'Retention', count: null as number | null },
    { id: 'late-logs', label: 'Late Logs', count: lateLogs.length || null },
    { id: 'roster', label: 'Roster', count: null as number | null },
    { id: 'plan-overview', label: 'Plan Overview', count: planQ.data?.totals.pending || null },
    { id: 'acknowledgments', label: 'Acknowledgments', count: null as number | null },
    { id: 'app-compliance', label: 'Clients on App', count: null as number | null },
  ];
  const isRankTab = mgrTab === 'sessions' || mgrTab === 'qhp' || mgrTab === 'referrals';

  // Web parity: ManagersOverview redirects non-managers away (profile.managers gate).
  if (!mgrCaps.isLoading && !mgrCaps.data.isManager) {
    return (
      <Page gap={16} pt={6}>
        <TitleBlock title="Managers Overview" sub="Manager access required" />
        <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 30 }}>This page is only available to managers.</Body>
      </Page>
    );
  }

  return (
    <Page gap={16} pt={6}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 15, borderRadius: 18, backgroundColor: hexA(C.orange, 0.08), borderWidth: 1, borderColor: hexA(C.orange, 0.26) }}>
        <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: hexA(C.orange, 0.16), alignItems: 'center', justifyContent: 'center' }}><TrophyIcon color={C.orange} size={20} /></View>
        <View style={{ flex: 1 }}>
          <Mono style={{ fontSize: 10, letterSpacing: 1, color: C.mono2, textTransform: 'uppercase' }}>{periodLabel}{team.isOngoing ? ' · LIVE' : ''}</Mono>
          <Serif style={{ fontSize: 18 }}>{team.teamName || 'My Team'}</Serif>
        </View>
      </View>
      {teams.length > 1 ? (
        <HScroll>
          {teams.map((t) => {
            const active = t.id === team.id;
            return (
              <Pressable key={t.id} onPress={() => setSelTeamId(t.id)} style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: active ? hexA(C.orange, 0.14) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.orange, 0.35) : 'rgba(255,255,255,0.07)' }}>
                <Text style={{ fontFamily: active ? F.bodyBold : F.body, fontSize: 12.5, color: active ? C.orange : C.muted }}>{t.teamName}</Text>
              </Pressable>
            );
          })}
        </HScroll>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <MiniStat value={String(trainers.length)} label="Trainers" />
        <MiniStat value={fmtK(totalSessions)} label="Sessions" color={C.green} />
        <MiniStat value={String(totalQhp)} label="QHPs" color={C.gold} />
        <MiniStat value={String(totalRefs)} label="Referrals" color={C.blue} />
      </View>
      <HScroll>
        {tabs.map((t) => {
          const active = mgrTab === t.id;
          return (
            <Pressable key={t.id} onPress={() => set({ mgrTab: t.id as any })} style={{ flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 9, paddingHorizontal: 14, borderRadius: 999, backgroundColor: active ? hexA(C.orange, 0.13) : 'transparent', borderWidth: 1, borderColor: active ? hexA(C.orange, 0.3) : 'rgba(255,255,255,0.05)' }}>
              <Text style={{ fontFamily: active ? F.bodySemi : F.body, fontSize: 13, color: active ? C.orange : C.muted }}>{t.label}</Text>
              {t.count ? <View style={{ paddingVertical: 1, paddingHorizontal: 6, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.06)' }}><Text style={{ fontFamily: F.mono, fontSize: 11, color: active ? C.orange : C.muted2 }}>{t.count}</Text></View> : null}
            </Pressable>
          );
        })}
      </HScroll>

      <Card colors={['rgba(46,28,18,0.42)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.09)" radius={20} style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
        {isRankTab ? (
          ranked.length === 0 ? (
            <EmptyRow icon="users" text="No team members yet." />
          ) : (
            ranked.map((m, i) => (
              <MgrMemberRow
                key={m.id}
                member={m}
                rank={i + 1}
                metric={metric}
                value={m[metric]}
                unit={metric === 'sessions' ? 'sessions' : metric === 'qhps' ? 'QHPs' : 'referrals'}
                first={i === 0}
                periodStart={team?.periodStart ?? null}
                periodEnd={team?.periodEnd ?? null}
              />
            ))
          )
        ) : mgrTab === 'leaves' ? (
          leavesQ.isLoading ? <LoadingRow /> : leaves.length === 0 ? <EmptyRow icon="calendar" text="No leaves in this period." /> : (
            leaves.map((l, i) => (
              <View key={l.id} style={{ paddingVertical: 14, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: 'rgba(255,255,255,0.05)' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Body style={{ fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }}>{l.trainer_name}</Body>
                  <Badge text="Leave" color={C.gold} />
                </View>
                <Body style={{ fontSize: 12, color: C.ink3, marginTop: 3 }}>{istDayLabel(l.start_date + 'T00:00:00Z')} {l.start_time ?? ''} → {istDayLabel(l.end_date + 'T00:00:00Z')} {l.end_time ?? ''}</Body>
                {l.reason ? <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 2 }}>{l.reason}</Body> : null}
              </View>
            ))
          )
        ) : mgrTab === 'incidents' ? (
          incidentsQ.isLoading ? <LoadingRow /> : incidents.length === 0 ? <EmptyRow icon="checks" text="No incidents reported." /> : (
            incidents.map((inc, i) => (
              <View key={inc.id} style={{ paddingVertical: 14, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: 'rgba(255,255,255,0.05)' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Body style={{ fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }}>{inc.trainer_name}</Body>
                  <Mono style={{ fontSize: 10, color: C.muted3 }}>{istDayLabel(inc.created_at)}</Mono>
                </View>
                <Body style={{ fontSize: 12.5, color: C.ink3, marginTop: 4 }}>{inc.message}</Body>
                <Body style={{ fontSize: 11, color: C.muted2, marginTop: 3 }}>— {inc.author_name} ({inc.author_role})</Body>
              </View>
            ))
          )
        ) : mgrTab === 'retention' ? (
          retentionQ.isLoading ? <LoadingRow /> : retention.length === 0 ? <EmptyRow icon="users" text="No retention data." /> : (
            retention.map((r, i) => {
              const rate = r.retention_rate;
              const col = rate == null ? C.muted : rate >= 80 ? C.green : rate >= 60 ? C.gold : C.red;
              return (
                <View key={r.trainer_id} style={{ paddingVertical: 14, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: 'rgba(255,255,255,0.05)' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={{ flex: 1 }}>
                      <Body style={{ fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }}>{r.trainer_name}</Body>
                      <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 1 }}>{r.active_at_start} at start · {r.lost_in_period} lost</Body>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Serif style={{ fontSize: 18, color: col }}>{rate == null ? '—' : `${rate}%`}</Serif>
                      <Mono style={{ fontSize: 9, color: C.muted3 }}>RETENTION</Mono>
                    </View>
                  </View>
                </View>
              );
            })
          )
        ) : mgrTab === 'late-logs' ? (
          lateLogsQ.isLoading ? <LoadingRow /> : lateLogsQ.isError ? (
            <View style={{ paddingVertical: 18, gap: 4, alignItems: 'center' }}>
              <Body style={{ fontSize: 12, color: C.red, textAlign: 'center' }}>Late logs couldn't load — the server function returned an error.</Body>
              <Mono style={{ fontSize: 9, color: C.muted3, textAlign: 'center' }}>{String((lateLogsQ.error as Error)?.message ?? '').slice(0, 90)}</Mono>
            </View>
          ) : lateLogs.length === 0 ? <EmptyRow icon="checks" text="No late logs in this period." /> : (
            lateLogs.map((lg, i) => (
              <View key={lg.id} style={{ paddingVertical: 14, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: 'rgba(255,255,255,0.05)' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Body style={{ fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }}>{lg.trainer_name}</Body>
                  {lg.status_late_log ? <Badge text={lg.status_late_log} color={lg.status_late_log === 'approved' ? C.green : lg.status_late_log === 'rejected' ? C.red : C.gold} /> : <Badge text="Late" color={C.red} />}
                </View>
                <Body style={{ fontSize: 12, color: C.ink3, marginTop: 3 }}>{lg.client_name}{lg.session_name ? ` · ${lg.session_name}` : ''}</Body>
                <Body style={{ fontSize: 11, color: C.muted2, marginTop: 2 }}>Logged {istDayLabel(lg.logged_at)} · {istTimeParts(lg.logged_at).time} {istTimeParts(lg.logged_at).ampm}</Body>
                {lg.late_log_reason ? <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 2 }}>{lg.late_log_reason}</Body> : null}
              </View>
            ))
          )
        ) : mgrTab === 'roster' ? (
          rosterTabQ.isLoading ? <LoadingRow /> : (
            (() => {
              const bt = rosterTabQ.data?.byTrainer ?? {};
              const tt = rosterTabQ.data?.totals ?? {};
              const list = members.filter((m) => (tt[m.id]?.total ?? 0) > 0 || !m.isManager);
              if (list.every((m) => (tt[m.id]?.total ?? 0) === 0)) return <EmptyRow icon="calendar" text="No sessions in the competition window." />;
              return list.map((m, i) => {
                const t = tt[m.id] ?? { total: 0, scheduled: 0, completed: 0, cancelled: 0 };
                return (
                  <View key={m.id} style={{ paddingVertical: 14, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: 'rgba(255,255,255,0.05)' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center', marginRight: 11 }}><Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: C.ink3 }}>{initials(m.name)}</Text></View>
                      <Body style={{ flex: 1, fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }}>{m.name}</Body>
                      <Serif style={{ fontSize: 18 }}>{t.total}</Serif>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 7, marginTop: 9 }}>
                      <StatChip label="Scheduled" value={t.scheduled} color={C.blue} />
                      <StatChip label="Completed" value={t.completed} color={C.green} />
                      <StatChip label="Cancelled" value={t.cancelled} color={C.red} />
                    </View>
                  </View>
                );
              });
            })()
          )
        ) : mgrTab === 'plan-overview' ? (
          planQ.isLoading ? <LoadingRow /> : (planQ.data?.summaries.length ?? 0) === 0 ? <EmptyRow icon="dumbbell" text="No plan data." /> : (
            (planQ.data?.summaries ?? []).map((s, i) => (
              <View key={s.trainerId} style={{ paddingVertical: 14, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: 'rgba(255,255,255,0.05)' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center', marginRight: 11 }}><Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: C.ink3 }}>{initials(s.trainerName)}</Text></View>
                  <Body style={{ flex: 1, fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }}>{s.trainerName}</Body>
                  <Body style={{ fontSize: 11.5, color: C.muted2 }}>{s.assigned} clients</Body>
                </View>
                <View style={{ flexDirection: 'row', gap: 7, marginTop: 9 }}>
                  <StatChip label="Active" value={s.active} color={C.green} />
                  <StatChip label="Expired" value={s.expired} color={C.gold} />
                  <StatChip label="No plan" value={s.noPlan} color={C.red} />
                </View>
              </View>
            ))
          )
        ) : mgrTab === 'acknowledgments' ? (
          acksQ.isLoading ? <LoadingRow /> : (acksQ.data?.trainers.length ?? 0) === 0 ? <EmptyRow icon="checks" text="No logged sessions in the last 7 days." /> : (
            <>
              {/* Team summary */}
              <View style={{ flexDirection: 'row', gap: 7, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' }}>
                <StatChip label="Sessions" value={acksQ.data?.totalSessions ?? 0} color={C.blue} />
                <StatChip label="Acknowledged" value={acksQ.data?.totalAcknowledged ?? 0} color={C.green} />
                <View style={{ flex: 1, paddingVertical: 7, paddingHorizontal: 9, borderRadius: 10, backgroundColor: hexA(C.orange, 0.08), borderWidth: 1, borderColor: hexA(C.orange, 0.22), alignItems: 'center' }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: C.orange }}>{acksQ.data?.pct ?? 0}%</Text>
                  <Mono style={{ fontSize: 8, color: C.muted3, marginTop: 1 }}>ADHERENCE</Mono>
                </View>
              </View>
              {(acksQ.data?.trainers ?? []).map((t, i) => {
                const col = t.pct >= 75 ? C.green : t.pct >= 50 ? C.gold : C.red;
                const tOpen = ackOpenT === t.trainerId;
                return (
                  <View key={t.trainerId} style={{ borderTopWidth: i === 0 ? 0 : 1, borderTopColor: 'rgba(255,255,255,0.05)' }}>
                    <Pressable onPress={() => { setAckOpenT(tOpen ? null : t.trainerId); setAckOpenD(null); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14 }}>
                      <Icon name={tOpen ? 'chevUp' : 'chevDown'} size={15} color={C.muted} strokeWidth={2.2} />
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                          <Body style={{ fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }}>{t.trainerName}</Body>
                          {t.isManager ? <View style={{ paddingVertical: 1, paddingHorizontal: 6, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.06)' }}><Text style={{ fontSize: 9, fontFamily: F.bodySemi, color: C.muted2 }}>Manager</Text></View> : null}
                        </View>
                        <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 1 }}>{t.acknowledged} / {t.total} acknowledged</Body>
                      </View>
                      <Serif style={{ fontSize: 18, color: col }}>{t.pct}%</Serif>
                    </Pressable>
                    {tOpen ? (
                      <View style={{ paddingBottom: 12, gap: 8 }}>
                        {t.days.length === 0 ? (
                          <Body style={{ fontSize: 12, color: C.muted3, paddingLeft: 25 }}>No sessions in this window.</Body>
                        ) : t.days.map((d) => {
                          const key = `${t.trainerId}_${d.date}`;
                          const dOpen = ackOpenD === key;
                          const dPct = d.total > 0 ? Math.round((d.acknowledged / d.total) * 100) : 0;
                          const dCol = dPct >= 75 ? C.green : dPct >= 50 ? C.gold : C.red;
                          return (
                            <View key={key} style={{ borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                              <Pressable onPress={() => setAckOpenD(dOpen ? null : key)} style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 10, paddingHorizontal: 12 }}>
                                <Icon name={dOpen ? 'chevUp' : 'chevDown'} size={13} color={C.muted} strokeWidth={2.2} />
                                <Body style={{ flex: 1, fontSize: 13, fontFamily: F.bodySemi, color: C.ink }}>{istDayLabel(d.date + 'T00:00:00Z')}</Body>
                                <Mono style={{ fontSize: 10.5, color: C.muted2 }}>{d.acknowledged}/{d.total}</Mono>
                                <View style={{ paddingVertical: 2, paddingHorizontal: 7, borderRadius: 999, backgroundColor: hexA(dCol, 0.14) }}><Text style={{ fontFamily: F.bodySemi, fontSize: 10, color: dCol }}>{dPct}%</Text></View>
                              </Pressable>
                              {dOpen ? (
                                <View style={{ borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' }}>
                                  {d.sessions.map((s, si) => (
                                    <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, paddingHorizontal: 12, borderTopWidth: si === 0 ? 0 : 1, borderTopColor: 'rgba(255,255,255,0.04)' }}>
                                      <View style={{ flex: 1 }}>
                                        <Body style={{ fontSize: 13, fontFamily: F.bodySemi, color: '#fff' }} numberOfLines={1}>{s.clientName}</Body>
                                        <Mono style={{ fontSize: 9.5, color: C.muted3, marginTop: 1 }}>{istTimeParts(s.createdAt).time} {istTimeParts(s.createdAt).ampm}</Mono>
                                      </View>
                                      {s.acknowledgedAt ? (
                                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                          <Icon path="M20 6 9 17l-5-5" size={13} color={C.green} strokeWidth={2.6} />
                                          <Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: C.green }}>Acknowledged</Text>
                                        </View>
                                      ) : (
                                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                          <Icon name="close" size={13} color={C.red} strokeWidth={2.6} />
                                          <Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: C.red }}>Pending</Text>
                                        </View>
                                      )}
                                    </View>
                                  ))}
                                </View>
                              ) : null}
                            </View>
                          );
                        })}
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </>
          )
        ) : (
          appQ.isLoading ? <LoadingRow /> : (appQ.data?.rows.length ?? 0) === 0 ? <EmptyRow icon="users" text="No app-eligible clients." /> : (
            (appQ.data?.rows ?? []).map((r, i) => {
              const pct = r.total > 0 ? Math.round((r.onApp / r.total) * 100) : 0;
              const col = pct >= 80 ? C.green : pct >= 50 ? C.gold : C.red;
              return (
                <View key={r.trainerId} style={{ paddingVertical: 14, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: 'rgba(255,255,255,0.05)' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={{ flex: 1 }}>
                      <Body style={{ fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }}>{r.trainerName}</Body>
                      <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 1 }}>{r.onApp} on app · {r.notOnApp} off · {r.total} total</Body>
                    </View>
                    <Serif style={{ fontSize: 18, color: col }}>{pct}%</Serif>
                  </View>
                  <View style={{ marginTop: 9 }}><ProgressBar pct={pct} height={5} fill={col} /></View>
                </View>
              );
            })
          )
        )}
      </Card>
    </Page>
  );
}
function StatChip({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={{ flex: 1, paddingVertical: 7, paddingHorizontal: 9, borderRadius: 10, backgroundColor: hexA(color, 0.08), borderWidth: 1, borderColor: hexA(color, 0.22), alignItems: 'center' }}>
      <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color }}>{value}</Text>
      <Mono style={{ fontSize: 8, color: C.muted3, marginTop: 1 }}>{label.toUpperCase()}</Mono>
    </View>
  );
}
function EmptyRow({ icon, text }: { icon: any; text: string }) {
  return (
    <View style={{ alignItems: 'center', gap: 8, paddingVertical: 22 }}>
      <Icon name={icon} size={24} color="#4C4640" strokeWidth={1.6} />
      <Body style={{ fontSize: 13, color: C.muted3 }}>{text}</Body>
    </View>
  );
}
function LoadingRow() {
  return (
    <View style={{ alignItems: 'center', gap: 8, paddingVertical: 22 }}>
      <Icon name="clock" size={20} color={C.muted3} strokeWidth={1.8} />
      <Body style={{ fontSize: 12.5, color: C.muted3 }}>Loading…</Body>
    </View>
  );
}

/* ============ MESSENGER ============ */
/* ============ PROFILE ============ */
type Cert = { name: string; issuer: string; year: string; verified: boolean };

export function Profile() {
  const { firstName } = useStore();
  const trainerId = useTrainerId();
  const profileQ = useTrainerProfile(trainerId);
  const p = profileQ.data?.profile;
  // Own avatar (signed-in account) + upload (web uploadAvatar contract).
  const sideProf = useSidebarProfile();
  const uploadAvatarM = useUploadAvatar();
  const pickAvatar = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow photo access to change your profile picture.'); return; }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.85 });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    try {
      await uploadAvatarM.mutateAsync({ uri: a.uri, mime: a.mimeType ?? 'image/jpeg', fileName: a.fileName ?? null });
      Alert.alert('Profile photo updated');
    } catch (e: any) { Alert.alert('Upload failed', e?.message ?? 'Unknown error'); }
  };
  const fullName = p ? `${p.first_name ?? ''} ${p.last_name ?? ''}`.replace(/\s+/g, ' ').trim() : firstName;
  const roleLabel = p?.role ? p.role.charAt(0).toUpperCase() + p.role.slice(1) : 'Trainer';
  const specs = p?.specializations ?? [];
  const [certs, setCerts] = React.useState<Cert[]>([
    { name: 'ACE Certified Personal Trainer', issuer: 'American Council on Exercise', year: '2021', verified: true },
    { name: 'Strength & Conditioning Specialist', issuer: 'NSCA', year: '2022', verified: true },
    { name: 'Sports Nutrition Level 2', issuer: 'ISSA', year: '2023', verified: true },
  ]);
  const uploadCert = () =>
    setCerts((c) => [...c, { name: `New Certification ${c.length + 1}.pdf`, issuer: 'Uploaded by you', year: '2026', verified: false }]);

  const totalSessions = profileQ.data?.totalSessions ?? 0;
  const activeClients = profileQ.data?.activeClients ?? 0;
  const certCount = profileQ.data?.certifications ?? 0;
  const fmtK = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

  return (
    <Page gap={16} pt={6}>
      {/* Hero */}
      <Card colors={['rgba(64,38,22,0.5)', 'rgba(18,14,14,0.55)']} border="rgba(255,150,90,0.14)" style={{ padding: 22, alignItems: 'center', overflow: 'hidden' }}>
        <View style={{ padding: 4, borderRadius: 48, borderWidth: 2, borderColor: hexA(C.orange, 0.5) }}>
          <AvatarPhoto url={sideProf.avatarUrl} initial={(fullName[0] || 'T').toUpperCase()} size={80} fontSize={30} />
          <Pressable onPress={pickAvatar} disabled={uploadAvatarM.isPending} hitSlop={8} style={{ position: 'absolute', right: -4, bottom: -4, width: 30, height: 30, borderRadius: 15, backgroundColor: C.orange, borderWidth: 2.5, borderColor: '#181210', alignItems: 'center', justifyContent: 'center' }}>
            {uploadAvatarM.isPending ? <ActivityIndicator size="small" color="#fff" /> : <Icon name="plus" size={14} color="#fff" strokeWidth={2.6} />}
          </Pressable>
        </View>
        <Pressable onPress={pickAvatar} disabled={uploadAvatarM.isPending} style={{ marginTop: 9, paddingVertical: 5, paddingHorizontal: 12, borderRadius: 999, backgroundColor: hexA(C.orange, 0.1), borderWidth: 1, borderColor: hexA(C.orange, 0.32) }}>
          <Text style={{ fontFamily: F.bodySemi, fontSize: 10.5, color: C.orange }}>{uploadAvatarM.isPending ? 'Uploading…' : sideProf.avatarUrl ? 'Change photo' : 'Add photo'}</Text>
        </Pressable>
        <Serif style={{ fontSize: 25, marginTop: 13 }}>{fullName || 'Trainer'}</Serif>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 5, flexWrap: 'wrap', justifyContent: 'center' }}>
          <View style={{ paddingVertical: 4, paddingHorizontal: 11, borderRadius: 999, backgroundColor: hexA(C.orange, 0.12), borderWidth: 1, borderColor: hexA(C.orange, 0.3) }}>
            <Text style={{ fontFamily: F.bodySemi, fontSize: 11.5, color: C.orange }}>{roleLabel}</Text>
          </View>
          {p?.location ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 11, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
              <Icon name="pin" size={11} color={C.muted} strokeWidth={2} />
              <Text style={{ fontFamily: F.body, fontSize: 11.5, color: C.ink3 }}>{p.location}</Text>
            </View>
          ) : null}
        </View>
        {p?.email || p?.phone ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
            {p?.email ? <Body style={{ fontSize: 12, color: C.muted2 }}>{p.email}</Body> : null}
            {p?.email && p?.phone ? <Body style={{ fontSize: 12, color: C.muted3 }}>·</Body> : null}
            {p?.phone ? <Body style={{ fontSize: 12, color: C.muted2 }}>{p.phone}</Body> : null}
          </View>
        ) : null}
        {/* Stats */}
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 20, width: '100%' }}>
          {[
            { v: fmtK(totalSessions), l: 'Total Sessions', icon: 'dumbbell' as const, c: C.orange },
            { v: String(certCount), l: 'Certifications', icon: 'award' as const, c: C.gold },
            { v: String(activeClients), l: 'Active Clients', icon: 'users' as const, c: C.green },
          ].map((s) => (
            <View key={s.l} style={{ flex: 1, paddingVertical: 14, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.3)', borderWidth: 1, borderColor: hexA(s.c, 0.2), alignItems: 'center', gap: 6 }}>
              <Icon name={s.icon} size={17} color={s.c} strokeWidth={1.9} />
              <Serif style={{ fontSize: 22, color: s.c }}>{profileQ.isLoading ? '—' : s.v}</Serif>
              <Body style={{ fontSize: 10.5, color: C.muted2, textAlign: 'center' }}>{s.l}</Body>
            </View>
          ))}
        </View>
      </Card>

      {/* Bio */}
      {p?.bio ? (
        <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.09)" radius={20} style={{ padding: 18 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 11 }}>
            <Icon name="userCircle" size={16} color={C.orange} strokeWidth={1.9} />
            <Mono style={{ fontSize: 11, letterSpacing: 1.4, color: C.mono }}>TRAINER BIO</Mono>
          </View>
          <Body style={{ fontSize: 13.5, color: C.ink3, lineHeight: 21 }}>{p.bio}</Body>
        </Card>
      ) : null}

      {/* Specializations */}
      {specs.length > 0 ? (
        <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.09)" radius={20} style={{ padding: 18 }}>
          <Mono style={{ fontSize: 11, letterSpacing: 1.4, color: C.mono, marginBottom: 12 }}>SPECIALIZATIONS</Mono>
          <View style={{ flexDirection: 'row', gap: 9, flexWrap: 'wrap' }}>
            {specs.map((s: string, i: number) => (
              <View key={s + i} style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: i === 0 ? hexA(C.orange, 0.3) : 'rgba(255,255,255,0.08)', backgroundColor: i === 0 ? hexA(C.orange, 0.06) : 'transparent' }}>
                <Text style={{ fontFamily: F.body, fontSize: 13, color: i === 0 ? '#F0875A' : C.ink3 }}>{s}</Text>
              </View>
            ))}
          </View>
        </Card>
      ) : null}

      {/* Certifications */}
      <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.09)" radius={20} style={{ padding: 18 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Icon name="award" size={16} color={C.gold} strokeWidth={1.9} />
            <Mono style={{ fontSize: 11, letterSpacing: 1.4, color: C.mono }}>CERTIFICATIONS</Mono>
          </View>
          <Pressable onPress={uploadCert}>
            <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 13, borderRadius: 11 }}>
              <Icon name="plus" size={13} color="#fff" strokeWidth={2.6} />
              <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: '#fff' }}>Upload</Text>
            </LinearGradient>
          </Pressable>
        </View>
        <View style={{ gap: 10 }}>
          {certs.map((cert, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: cert.verified ? 'rgba(255,255,255,0.06)' : hexA(C.gold, 0.25) }}>
              <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: hexA(cert.verified ? C.gold : C.blue, 0.13), alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={cert.verified ? 'award' : 'file'} size={19} color={cert.verified ? C.gold : C.blue} strokeWidth={1.9} />
              </View>
              <View style={{ flex: 1 }}>
                <Body numberOfLines={1} style={{ fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }}>{cert.name}</Body>
                <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 1 }}>{cert.issuer} · {cert.year}</Body>
              </View>
              <Badge text={cert.verified ? 'Verified' : 'Pending review'} color={cert.verified ? C.green : C.gold} />
            </View>
          ))}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 12, paddingVertical: 12, borderRadius: 12, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.12)' }}>
          <Icon name="file" size={14} color={C.muted3} strokeWidth={1.8} />
          <Body style={{ fontSize: 12, color: C.muted3 }}>PDF, JPG or PNG · max 10 MB</Body>
        </View>
      </Card>
    </Page>
  );
}

/* ============ EVENTS ============ */
export function Events() {
  return (
    <Page gap={16} pt={6}>
      <Serif style={{ fontSize: 26 }}>My Events</Serif>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 12 }}><Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: '#fff' }}>Active · 2</Text></LinearGradient>
        <View style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)' }}><Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: C.muted }}>Completed · 14</Text></View>
      </View>
      {events.map((ev) => (
        <Card key={ev.title} colors={['rgba(56,34,21,0.45)', 'rgba(18,14,14,0.5)']} radius={20} style={{ padding: 18 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <View style={{ paddingVertical: 3, paddingHorizontal: 10, borderRadius: 999, backgroundColor: hexA(ev.color, 0.14), borderWidth: 1, borderColor: hexA(ev.color, 0.3) }}><Text style={{ fontSize: 11, fontFamily: F.bodySemi, color: ev.color }}>{ev.tag}</Text></View>
            <Mono style={{ fontSize: 11, color: C.mono }}>{ev.date}</Mono>
          </View>
          <Serif style={{ fontSize: 20 }}>{ev.title}</Serif>
          <Body style={{ fontSize: 13.5, color: C.muted, marginTop: 5 }}>{ev.meta}</Body>
        </Card>
      ))}
    </Page>
  );
}

/* ============ MANAGERS DASHBOARD ============ */
function initials(name: string) {
  return name.split(/[\s,]+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

export function MgrDash() {
  const { mgrDashTab, set, mgrRow } = useStore();
  const dashMgrCaps = useMyCapabilities();
  // Month tabs are COMPETITION months carved from the period's team_start (web parity),
  // not calendar months back from today.
  const monthFilter: MgrMonthFilter = mgrDashTab === 'month1' || mgrDashTab === 'month2' || mgrDashTab === 'month3' ? mgrDashTab : 'overall';
  const mgrLbQ = useManagerLeaderboard(monthFilter);
  const lb = mgrLbQ.data;
  const lbPeriods = [
    { id: 'overall', label: 'Overall' },
    { id: 'month1', label: lb?.monthLabels?.[0] ?? 'M1' },
    { id: 'month2', label: lb?.monthLabels?.[1] ?? 'M2' },
    { id: 'month3', label: lb?.monthLabels?.[2] ?? 'M3' },
  ];
  const medalP = [ic.crown, ic.award, ic.award];
  const medalC = [C.gold, '#B8BCC4', '#C08A52'];
  const liveMgr = lb?.entries?.map((e) => ({
    rank: e.rank,
    name: e.managerName.split(' ')[0],
    sub: e.managerName,
    team: e.teamSize,
    sess: e.totalSessions, // web parity: sessions + QHPs combined
    rawSess: e.rawSessions,
    qhp: e.qhpCount,
    score: e.totalSessions, // web ranks by weighted but displays the combined figure
    refs: e.referralsCount,
    medal: e.rank <= 3 ? medalP[e.rank - 1] : null,
    mc: e.rank <= 3 ? medalC[e.rank - 1] : null,
    members: e.members ?? [], // ?? []: tolerate pre-`members` rows hydrated from the persisted cache
    teamStart: e.teamStart as string | null,
    teamEnd: e.teamEnd,
    expected: e.expectedSessions,
  }));
  const mgrRows = mgrLbQ.isError || !liveMgr || liveMgr.length === 0
    ? mgrDefs.map((m) => ({ ...m, score: m.sess + m.qhp, sess: m.sess + m.qhp, rawSess: m.sess, members: [] as ManagerTeamMember[], teamStart: null as string | null, teamEnd: null as string | null, expected: null as number | null }))
    : liveMgr;
  const podium = [mgrRows[1], mgrRows[0], mgrRows[2]].filter(Boolean); // 2nd · 1st · 3rd
  const podiumHeights = [86, 112, 70];

  // Manager pages are gated on profile.managers (web sidebar rule).
  if (!dashMgrCaps.isLoading && !dashMgrCaps.data.isManager) {
    return (
      <Page gap={16} pt={6}>
        <TitleBlock title="Managers Dashboard" sub="Manager access required" />
        <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 30 }}>This page is only available to managers.</Body>
      </Page>
    );
  }

  return (
    <Page gap={16} pt={6}>
      {/* Hero */}
      <Card colors={['rgba(64,38,22,0.55)', 'rgba(18,14,14,0.6)']} border="rgba(255,150,90,0.16)" radius={22} style={{ overflow: 'hidden' }}>
        <LinearGradient colors={['#E0A53C', '#9A7BEA', '#EE5E16', '#E75A9B']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 4 }} />
        <View style={{ padding: 18, alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <TrophyIcon size={20} color={C.gold} />
            <Serif style={{ fontSize: 22 }}>Managers Leaderboard</Serif>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4, paddingHorizontal: 9, borderRadius: 999, backgroundColor: hexA(C.green, 0.12), borderWidth: 1, borderColor: hexA(C.green, 0.28) }}>
              <PulseDot color={C.green} />
              <Text style={{ fontSize: 10.5, fontFamily: F.bodySemi, color: C.green }}>Live</Text>
            </View>
            <Mono style={{ fontSize: 11, color: C.mono2 }}>{lb?.periodLabel ?? 'Competition period'}</Mono>
          </View>

          {/* Period segmented control */}
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 16, backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 999, padding: 4 }}>
            {lbPeriods.map((t) => {
              const active = mgrDashTab === t.id;
              return active ? (
                <LinearGradient key={t.id} colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ paddingVertical: 7, paddingHorizontal: 15, borderRadius: 999 }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: '#fff' }}>{t.label}</Text>
                </LinearGradient>
              ) : (
                <Pressable key={t.id} onPress={() => set({ mgrDashTab: t.id })} style={{ paddingVertical: 7, paddingHorizontal: 15, borderRadius: 999 }}>
                  <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: C.muted }}>{t.label}</Text>
                </Pressable>
              );
            })}
          </View>

          {/* Podium */}
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10, marginTop: 20, width: '100%' }}>
            {podium.map((m, i) => {
              const col = m.mc || C.orange;
              const isFirst = m.rank === 1;
              const delay = isFirst ? 80 : i === 0 ? 280 : 420; // winner rises first
              return (
                <RiseIn key={mgrDashTab + m.name + m.rank} delay={delay} style={{ flex: 1, alignItems: 'center' }}>
                  {isFirst && m.medal ? <FloatY><Icon path={m.medal} size={22} color={col} strokeWidth={1.8} /></FloatY> : null}
                  <View style={{ width: isFirst ? 58 : 48, height: isFirst ? 58 : 48, borderRadius: 29, backgroundColor: hexA(col, 0.16), borderWidth: 2, borderColor: hexA(col, 0.6), alignItems: 'center', justifyContent: 'center', marginTop: 5 }}>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: isFirst ? 17 : 14, color: col }}>{initials(m.sub)}</Text>
                  </View>
                  <Text numberOfLines={1} style={{ fontFamily: F.bodySemi, fontSize: 12, color: '#fff', marginTop: 7 }}>{m.name}</Text>
                  <Text style={{ fontFamily: F.mono, fontSize: 10, color: C.muted2, marginTop: 1 }}><CountUp value={m.score} style={{ fontFamily: F.mono, fontSize: 10, color: C.muted2 }} /> pts</Text>
                  <GrowUp delay={delay + 120} height={podiumHeights[i]} style={{ width: '100%' }}>
                    <LinearGradient
                      colors={[hexA(col, 0.35), hexA(col, 0.06)]}
                      start={{ x: 0.5, y: 0 }}
                      end={{ x: 0.5, y: 1 }}
                      style={{ width: '100%', height: podiumHeights[i], borderTopLeftRadius: 12, borderTopRightRadius: 12, marginTop: 9, alignItems: 'center', paddingTop: 8, borderWidth: 1, borderBottomWidth: 0, borderColor: hexA(col, 0.25) }}
                    >
                      <Serif style={{ fontSize: 24, color: col }}>{m.rank}</Serif>
                    </LinearGradient>
                  </GrowUp>
                </RiseIn>
              );
            })}
          </View>
        </View>
      </Card>

      {/* Full standings — expandable run-rate details */}
      <Mono style={{ fontSize: 12, letterSpacing: 2.1 }}>FULL STANDINGS</Mono>
      {mgrRows.map((m) => {
        const open = mgrRow === m.rank;
        // Run rate — web RunRateSection math: target is the manager's profiles.expected_sessions
        // over the competition window (team_start..team_end/today); hidden when no target is set.
        const rr = (() => {
          if (!m.expected || m.expected <= 0 || !m.teamStart) return null;
          const MS = 86400000;
          const today = new Date(); today.setHours(0, 0, 0, 0);
          const startD = new Date(m.teamStart + 'T00:00:00');
          const endD = m.teamEnd ? new Date(m.teamEnd + 'T00:00:00') : today;
          const totalDays = Math.max(1, Math.round((endD.getTime() - startD.getTime()) / MS) + 1);
          const capped = today < endD ? today : endD;
          const elapsed = Math.max(1, Math.min(totalDays, Math.round((capped.getTime() - startD.getTime()) / MS) + 1));
          const targetPerDay = m.expected / totalDays;
          const actualPerDay = m.sess / elapsed;
          const pacePct = targetPerDay > 0 ? (actualPerDay / targetPerDay) * 100 : 0;
          const remaining = Math.max(0, m.expected - m.sess);
          const completionPct = Math.min(100, (m.sess / m.expected) * 100);
          const requiredPerDay = remaining / Math.max(1, totalDays - elapsed);
          const projected = Math.round(actualPerDay * totalDays);
          const status = pacePct >= 100 ? 'On Pace' : pacePct >= 80 ? 'Slightly Behind' : 'Behind';
          return { totalDays, elapsed, actualPerDay, pacePct, remaining, completionPct, requiredPerDay, projected, status, expected: m.expected };
        })();
        const barColor = rr ? (rr.pacePct >= 100 ? C.green : rr.pacePct >= 80 ? C.gold : C.red) : C.muted3;
        const col = m.mc || C.muted;
        return (
          <RiseIn key={mgrDashTab + m.rank} delay={Math.min(m.rank - 1, 10) * 55}>
          <Pressable onPress={() => set({ mgrRow: open ? null : m.rank })}>
            <Card
              colors={open ? ['rgba(64,38,22,0.6)', 'rgba(20,16,15,0.6)'] : ['rgba(46,28,18,0.42)', 'rgba(18,14,14,0.5)']}
              border={open ? hexA(C.orange, 0.3) : 'rgba(255,150,90,0.09)'}
              radius={18}
              style={{ padding: 14 }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: m.mc ? hexA(m.mc, 0.16) : 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: m.mc ? hexA(m.mc, 0.4) : 'rgba(255,255,255,0.08)' }}>
                  {m.medal ? <Icon path={m.medal} size={19} color={col} strokeWidth={1.8} /> : <Text style={{ fontFamily: F.mono, fontSize: 14, color: C.muted }}>{m.rank}</Text>}
                </View>
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={{ fontFamily: F.bodyBold, fontSize: 15, color: '#fff' }}>{m.name}</Text>
                  <Text numberOfLines={1} style={{ fontFamily: F.body, fontSize: 11.5, color: C.muted2 }}>{m.sub}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <CountUp value={m.score} style={{ fontSize: 20 }} />
                  <Mono style={{ fontSize: 9.5, color: C.muted3 }}>SCORE</Mono>
                </View>
                <Icon name={open ? 'chevUp' : 'chevDown'} size={17} color={C.muted} strokeWidth={2.2} />
              </View>

              {/* compact progress toward target (hidden while expanded — the detail view has its own) */}
              {!open && rr ? (
                <View style={{ marginTop: 12 }}>
                  <ProgressBar pct={Math.round(rr.completionPct)} height={5} fill={barColor} />
                </View>
              ) : null}

              {open ? (
                <View style={{ marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.07)', gap: 13 }}>
                  {/* score breakdown */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 11, borderRadius: 999, backgroundColor: hexA(C.orange, 0.1), borderWidth: 1, borderColor: hexA(C.orange, 0.25) }}>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: C.orange }}>Sessions {m.sess}</Text>
                    <Text style={{ fontFamily: F.body, fontSize: 11.5, color: C.muted2 }}>= {m.rawSess} training + {m.qhp} QHP</Text>
                  </View>

                  {rr ? (
                    <>
                      {/* header */}
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Mono style={{ flex: 1, fontSize: 10.5, letterSpacing: 1.8, color: C.mono }}>RUN RATE</Mono>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 3, paddingHorizontal: 9, borderRadius: 999, backgroundColor: hexA(barColor, 0.14), borderWidth: 1, borderColor: hexA(barColor, 0.35) }}>
                          <PulseDot color={barColor} />
                          <Text style={{ fontFamily: F.bodyBold, fontSize: 10, color: barColor }}>{rr.status} · {Math.round(rr.pacePct)}%</Text>
                        </View>
                        <Mono style={{ fontSize: 10, color: C.muted3 }}>Day {rr.elapsed} / {rr.totalDays}</Mono>
                      </View>

                      {/* big figure + pace ring */}
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 5 }}>
                            <Serif style={{ fontSize: 30 }}>{m.sess}</Serif>
                            <Body style={{ fontSize: 13, color: C.muted2, marginBottom: 4 }}>/ {rr.expected} expected</Body>
                          </View>
                          <View style={{ marginTop: 8 }}>
                            <ProgressBar pct={Math.round(rr.completionPct)} height={7} fill={barColor} />
                          </View>
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                            <Mono style={{ fontSize: 9.5, color: C.muted2 }}>{Math.round(rr.completionPct)}% complete</Mono>
                            <Mono style={{ fontSize: 9.5, color: barColor }}>{rr.remaining} left · proj. {rr.projected}</Mono>
                          </View>
                        </View>
                        <View style={{ width: 62, height: 62, borderRadius: 31, borderWidth: 5, borderColor: hexA(barColor, 0.85), alignItems: 'center', justifyContent: 'center', backgroundColor: hexA(barColor, 0.08) }}>
                          <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: barColor }}>{Math.round(rr.pacePct)}%</Text>
                          <Mono style={{ fontSize: 7.5, color: C.muted3 }}>PACE</Mono>
                        </View>
                      </View>

                      {/* pace comparison */}
                      <View style={{ flexDirection: 'row', alignItems: 'center', borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', paddingVertical: 12 }}>
                        <View style={{ flex: 1, alignItems: 'center' }}>
                          <Mono style={{ fontSize: 8.5, color: C.muted3 }}>CURRENT PACE</Mono>
                          <Text style={{ fontFamily: F.bodyBold, fontSize: 17, color: '#fff', marginTop: 3 }}>
                            {rr.actualPerDay.toFixed(1)}<Text style={{ fontSize: 10.5, color: C.muted2, fontFamily: F.body }}>/day</Text>
                          </Text>
                        </View>
                        <Icon name="arrowRight" size={15} color={C.muted3} strokeWidth={2.2} />
                        <View style={{ flex: 1, alignItems: 'center' }}>
                          <Mono style={{ fontSize: 8.5, color: C.muted3 }}>NEEDED PACE</Mono>
                          <Text style={{ fontFamily: F.bodyBold, fontSize: 17, color: C.orange, marginTop: 3 }}>
                            {rr.requiredPerDay.toFixed(1)}<Text style={{ fontSize: 10.5, color: C.muted2, fontFamily: F.body }}>/day</Text>
                          </Text>
                        </View>
                      </View>
                    </>
                  ) : (
                    <Body style={{ fontSize: 11, color: C.muted3 }}>No expected-sessions target set for this manager — run rate unavailable.</Body>
                  )}

                  {/* inline meta */}
                  <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 16 }}>
                    {([
                      ['TEAM', String(m.team), C.purple],
                      ['QHP', String(m.qhp), C.gold],
                      ['REFERRALS', String(m.refs), C.green],
                    ] as const).map(([lab, val, col]) => (
                      <View key={lab} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: col }} />
                        <Mono style={{ fontSize: 9.5, color: C.muted2 }}>{lab}</Mono>
                        <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: col }}>{val}</Text>
                      </View>
                    ))}
                  </View>

                  {/* team breakdown — every member with their own counts */}
                  {m.members.length > 0 ? (
                    <View style={{ gap: 7 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Mono style={{ flex: 1, fontSize: 10.5, letterSpacing: 1.8, color: C.mono }}>TEAM BREAKDOWN</Mono>
                        <Mono style={{ fontSize: 9.5, color: C.muted3 }}>SESS · QHP · REF</Mono>
                      </View>
                      {m.members.map((tm) => {
                        const ac = avColors(tm.name);
                        return (
                          <View key={tm.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 13, backgroundColor: tm.isManager ? hexA(C.purple, 0.07) : 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: tm.isManager ? hexA(C.purple, 0.22) : 'rgba(255,255,255,0.06)', paddingVertical: 9, paddingHorizontal: 11 }}>
                            <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: hexA(ac[0], 0.18), borderWidth: 1, borderColor: hexA(ac[0], 0.4) }}>
                              <Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: ac[0] }}>{tm.name.trim().charAt(0).toUpperCase() || '?'}</Text>
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text numberOfLines={1} style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: '#fff' }}>{tm.name}</Text>
                              {tm.isManager ? (
                                <Text style={{ fontFamily: F.body, fontSize: 9.5, color: C.purple }}>Manager · not counted in totals</Text>
                              ) : null}
                            </View>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                              {([
                                [tm.sessions, C.orange],
                                [tm.qhps, C.gold],
                                [tm.referrals, C.green],
                              ] as const).map(([val, col], i) => (
                                <Text key={i} style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: val > 0 ? col : C.muted3, minWidth: 22, textAlign: 'right' }}>{val}</Text>
                              ))}
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  ) : null}
                </View>
              ) : null}
            </Card>
          </Pressable>
          </RiseIn>
        );
      })}
    </Page>
  );
}
