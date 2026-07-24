import React from 'react';
import { View, Text, Pressable, Modal, Animated, Easing, Dimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, F, hexA, ORANGE_GRAD } from '../theme';
import { Icon, IconName } from '../icons';
import { Serif, Body, Mono } from './primitives';
import { trackEvent } from '../lib/amplitude';

/* ============ Feature Tour — futuristic guided walkthrough ============
   Full-screen animated tour: drifting gradient orbs, a glowing icon core with
   an orbiting ring per step, spring transitions, progress rail, and a "where
   to find it" chip. Role-agnostic engine — pass any step list. */

export type TourStep = {
  icon: IconName;
  color: string;
  title: string;
  body: string;
  where?: string; // "SIDEBAR → MESSENGER" style locator chip
  preview?: string; // key into PREVIEWS — live mock with sample data
};

export const TRAINER_TOUR: TourStep[] = [
  { icon: 'sparkle', color: C.orange, title: 'Welcome to Odds Passport', body: 'Your complete training workspace. Sessions, clients, plans and your team, all in one place. Here is a quick tour of everything you can do.' },
  { icon: 'pin', color: C.green, title: 'Pin the Client Home First', preview: 'pinHome', body: 'Make this your first move with every client. While you are at their home, open their page and tap the green Pin Home button. One capture unlocks live distance and drive time on every roster card, a full route map with one tap navigation, and smarter day planning. Pin once and it works for the whole team forever.', where: 'CLIENT PAGE · PIN HOME' },
  { icon: 'calendar', color: C.gold, title: "Today's Roster", preview: 'roster', body: 'Your day at a glance. Every session card shows the client, time and acknowledge status. Log the workout, cancel with a reason, or request a reschedule right from the card.', where: "HOME · TODAY'S ROSTER" },
  { icon: 'route', color: C.blue, title: 'Distance to Client', preview: 'distance', body: 'When a client home is pinned, the card shows live distance and drive time. Tap it for the full route map and one tap Google Maps navigation.', where: 'ROSTER CARD · MAP ICON' },
  { icon: 'dumbbell', color: C.green, title: 'Log Workout', preview: 'workout', body: 'Offline first logging that never loses a value. Exercises collapse into clean rows, every set shows the client previous numbers, blank exercises drop automatically, and RPE wraps it up.', where: 'ROSTER · LOG WORKOUT' },
  { icon: 'users', color: C.purple, title: 'Parallel Sessions', preview: 'parallel', body: 'Training a couple? Tap Add Client in the workout form. Log the first client and the form flips to their partner with the same exercises pre selected. One shared package deduction.', where: 'LOG WORKOUT · ADD CLIENT' },
  { icon: 'layers', color: C.orange, title: 'Request Roster', preview: 'requestRoster', body: 'Need sessions scheduled? Send the CRM a single day request with date, time and modality, or ask for a full schedule. Approval status shows live.', where: "TODAY'S ROSTER · REQUEST" },
  { icon: 'target', color: C.blue, title: 'Your Clients', preview: 'clients', body: 'Full client profiles: progression charts with age scores, plans, goals, health reports, session history and services. Everything you need before a session, in one page.', where: 'SIDEBAR · MY CLIENTS' },
  { icon: 'heart', color: C.red, title: 'QHP Assessments', preview: 'qhp', body: 'Track every client QHP journey: upcoming, completed and overdue. Capture the client home location straight from the assessment card with the green pin.', where: 'SIDEBAR · QHP' },
  { icon: 'chat', color: C.gold, title: 'Messenger', preview: 'messenger', body: 'Chat with your team and client groups. Hold the mic for voice notes, share photos and documents, and everything opens inside the app.', where: 'SIDEBAR · MESSENGER' },
  { icon: 'atSign', color: C.purple, title: 'Client Threads', preview: 'threads', body: 'A private team only thread for every client. Trainers, CRMs and doctors in one place, with mentions and swipe to reply. Clients never see these.', where: 'SIDEBAR · CLIENT THREADS' },
  { icon: 'clipboard', color: C.blue, title: 'Training Plans', preview: 'plans', body: 'Build structured training plans for your clients and send them for coach approval. Approved plans pre fill the workout form automatically.', where: 'SIDEBAR · CREATE PLAN' },
  { icon: 'crown', color: C.gold, title: 'Leaderboard', preview: 'leaderboard', body: 'See where you stand. Every session and QHP you log pushes you up the trainer leaderboard, refreshed all month.', where: 'SIDEBAR · LEADERBOARD' },
  { icon: 'rupee', color: C.green, title: 'Payouts', preview: 'payouts', body: 'Track your earnings: per session payouts, incentives and monthly totals, always up to date.', where: 'SIDEBAR · PAYOUTS' },
  { icon: 'checks', color: C.green, title: 'You are all set!', body: 'That is the essentials. Explore freely. Everything you just saw is one or two taps from Home. Let us train.' },
];


export const CRM_TOUR: TourStep[] = [
  { icon: 'sparkle', color: C.orange, title: 'Welcome to Odds Passport', body: 'Your client success workspace. Approvals, rosters, QHPs, medical records and every client conversation in one place. Here is a quick tour.' },
  { icon: 'alert', color: C.red, title: 'Pending Approvals', preview: 'requestRoster', body: 'Trainer requests land here live: reschedules and roster requests. Approving a single day request opens the schedule sheet with the trainer, time and modality prefilled.', where: 'SIDEBAR · PENDING APPROVALS' },
  { icon: 'target', color: C.blue, title: 'My Clients', preview: 'clients', body: 'Full client profiles: sessions with paid and unpaid cancel labels, package and cycle info, journey checklist, health tabs and notes.', where: 'SIDEBAR · MY CLIENTS' },
  { icon: 'clipboard', color: C.red, title: 'Medical Records', preview: 'medical', body: 'Upload client reports from the Medical History tab. Manual entries with attachments, or AI extraction from a PDF that files everything automatically.', where: 'CLIENT · MEDICAL HISTORY' },
  { icon: 'heart', color: C.gold, title: 'QHP Scheduling', preview: 'qhp', body: 'Schedule QHPs from the QHP page or straight from a client detail page. Track explained, scheduled and completed stages in one list.', where: 'SIDEBAR · QHP' },
  { icon: 'calendar', color: C.green, title: 'Roster Management', preview: 'roster', body: 'The full calendar of sessions. Create rosters, reschedule with conflict checks, cancel with reasons, and manage upcoming sessions from a client page too.', where: 'SIDEBAR · ROSTER' },
  { icon: 'msgAlert', color: C.red, title: 'Longevity Team Alerts', preview: 'messenger', body: 'Clients expect a reply within two minutes. New Longevity group messages trigger a long alert and a banner on your home page that jumps straight into the chat.', where: 'HOME · ALERT BANNER' },
  { icon: 'atSign', color: C.purple, title: 'Client Threads', preview: 'threads', body: 'A private team only thread for every client, shared with trainers and doctors. Clients never see these.', where: 'SIDEBAR · CLIENT THREADS' },
  { icon: 'checks', color: C.green, title: 'You are all set!', body: 'That is the essentials. Everything you just saw is one or two taps from Home. Your clients are waiting.' },
];

export const COACH_TOUR: TourStep[] = [
  { icon: 'sparkle', color: C.orange, title: 'Welcome to Odds Passport', body: 'Your head of training workspace. Plans, trainers, clients and assessments across the whole floor. Here is a quick tour.' },
  { icon: 'clipboard', color: C.blue, title: 'Plan Reviews', preview: 'plans', body: 'Every trainer plan lands here for approval. Open a plan to see each exercise grouped with its sets, then approve or send it back.', where: 'SIDEBAR · PLANS' },
  { icon: 'crown', color: C.gold, title: 'Trainer Leaderboard', preview: 'leaderboard', body: 'Sessions, QHPs and referrals ranked across all trainers, refreshed all month.', where: 'SIDEBAR · TRAINERS' },
  { icon: 'target', color: C.blue, title: 'Clients Overview', preview: 'clients', body: 'Every active client with their trainer, progression and session history. Drill into any client for the full picture.', where: 'SIDEBAR · CLIENTS' },
  { icon: 'heart', color: C.red, title: 'Assessments', preview: 'qhp', body: 'QHP assessments across the floor: upcoming, completed and overdue, with assessor assignment.', where: 'SIDEBAR · ASSESSMENTS' },
  { icon: 'chat', color: C.gold, title: 'Messenger', preview: 'messenger', body: 'Chat with trainers and client groups. Voice notes, photos and documents, all inside the app.', where: 'SIDEBAR · MESSENGER' },
  { icon: 'checks', color: C.green, title: 'You are all set!', body: 'That is the essentials. The whole floor is one or two taps from Home.' },
];

export const OPS_TOUR: TourStep[] = [
  { icon: 'sparkle', color: C.orange, title: 'Welcome to Odds Passport', body: 'Your operations workspace. Leads, escalations, CRM activity and targets in one place. Here is a quick tour.' },
  { icon: 'userPlus', color: C.blue, title: 'Leads Pipeline', preview: 'leads', body: 'The full sales pipeline with stages, sources and follow ups. Move leads through New, QHP Booked and Converted with complete history.', where: 'SIDEBAR · LEADS' },
  { icon: 'alert', color: C.red, title: 'Escalations', body: 'Client escalations with severity, owner and resolution tracking, so nothing slips.', where: 'SIDEBAR · ESCALATIONS' },
  { icon: 'users', color: C.gold, title: 'CRM Activity', body: 'Pending CRM work and daily activity across the team, with targets and baselines to keep everyone on pace.', where: 'SIDEBAR · CRM PENDING' },
  { icon: 'chat', color: C.gold, title: 'Messenger', preview: 'messenger', body: 'Chat with the team. Voice notes, photos and documents, all inside the app.', where: 'SIDEBAR · MESSENGER' },
  { icon: 'checks', color: C.green, title: 'You are all set!', body: 'That is the essentials. Everything is one or two taps from Home.' },
];

export const ADMIN_TOUR: TourStep[] = [
  { icon: 'sparkle', color: C.orange, title: 'Welcome to Odds Passport', body: 'Your control room. Live KPIs, renewals, clients, users and revenue in one place. Here is a quick tour.' },
  { icon: 'trend', color: C.blue, title: 'Live Dashboard', body: 'Active clients, leads, conversions, sessions and revenue with month on month deltas, plus urgent alerts that need attention today.', where: 'HOME' },
  { icon: 'swap', color: C.gold, title: 'Renewals', body: 'Renewal opportunities and payment requests with full history per client. Approve, track and follow up.', where: 'SIDEBAR · RENEWALS' },
  { icon: 'target', color: C.blue, title: 'Clients', preview: 'clients', body: 'Every client across the business with filters, subscriptions, sessions by cycle and full detail pages.', where: 'SIDEBAR · CLIENTS' },
  { icon: 'users', color: C.purple, title: 'Users and Teams', body: 'Create staff accounts, manage roles and assignments, and keep coach and trainer mappings current.', where: 'SIDEBAR · USERS' },
  { icon: 'rupee', color: C.green, title: 'Revenue', preview: 'payouts', body: 'Revenue tracker and monthly summaries: new clients, renewals, add ons and pending payments.', where: 'SIDEBAR · REVENUE' },
  { icon: 'checks', color: C.green, title: 'You are all set!', body: 'That is the essentials. The whole business is one or two taps from Home.' },
];

export const DOCTOR_TOUR: TourStep[] = [
  { icon: 'sparkle', color: C.orange, title: 'Welcome to Odds Passport', body: 'Your clinical workspace. Rosters, physio sessions, protocols and medical records in one place. Here is a quick tour.' },
  { icon: 'pin', color: C.green, title: 'Pin the Client Home First', preview: 'pinHome', body: 'Make this your first move with every client. While you are at their home, open their page and tap the green Pin Home button. One capture unlocks live distance and drive time on your roster cards, a full route map with one tap navigation, and smarter day planning. Pin once and it works for the whole care team forever.', where: 'CLIENT PAGE · PIN HOME' },
  { icon: 'calendar', color: C.gold, title: "Today's Roster", preview: 'roster', body: 'Your own schedule for the day, built by the head doctor. Log the session or cancel with a reason right from the card.', where: 'HOME' },
  { icon: 'route', color: C.blue, title: 'Distance to Client', preview: 'distance', body: 'When a client home is pinned, the card shows live distance and drive time with a full route map on tap.', where: 'ROSTER CARD' },
  { icon: 'activity', color: C.green, title: 'Log Physio Session', body: 'Rehab with or without a plan, recovery modalities and cognitive checks, all in one structured sheet.', where: 'SIDEBAR · SESSIONS' },
  { icon: 'target', color: C.blue, title: 'My Clients', preview: 'clients', body: 'Assigned clients with protocols, rehab sessions, counselling notes and findings.', where: 'SIDEBAR · MY CLIENTS' },
  { icon: 'clipboard', color: C.red, title: 'Medical History', preview: 'medical', body: 'Add entries manually with attachments or upload documents for AI extraction. Everything files into the client timeline.', where: 'CLIENT · MEDICAL' },
  { icon: 'atSign', color: C.purple, title: 'Client Threads', preview: 'threads', body: 'A private team only thread for every client, shared with trainers and CRMs.', where: 'SIDEBAR · CLIENT THREADS' },
  { icon: 'checks', color: C.green, title: 'You are all set!', body: 'That is the essentials. Everything is one or two taps from Home.' },
];

export const MARKETING_TOUR: TourStep[] = [
  { icon: 'sparkle', color: C.orange, title: 'Welcome to Odds Passport', body: 'Your influencer and growth workspace. Campaign tracking, content targets, tickets and the leads pipeline. Here is a quick tour.' },
  { icon: 'trend', color: C.blue, title: 'Marketing Dashboard', body: 'Monthly content delivery at a glance: the completion ring, stories and reels chart, top performers and smart insights.', where: 'HOME' },
  { icon: 'users', color: C.purple, title: 'Influencer Clients', preview: 'clients', body: 'Every influencer with their score, sessions, content delivered against target, Instagram and reports.', where: 'SIDEBAR · INFLUENCERS' },
  { icon: 'inbox', color: C.gold, title: 'Tickets', body: 'Raise tickets to the CRM team on any influencer and track replies until closed.', where: 'INFLUENCER · TICKETS' },
  { icon: 'userPlus', color: C.blue, title: 'Leads', preview: 'leads', body: 'The sales pipeline with sources, stages and analytics: leads over time, by source, by stage and ad attribution.', where: 'SIDEBAR · LEADS' },
  { icon: 'checks', color: C.green, title: 'You are all set!', body: 'That is the essentials. Everything is one or two taps from Home.' },
];

const { width: SCREEN_W } = Dimensions.get('window');

/* Slowly drifting ambient orb (pure decoration). */
function Orb({ color, size, x, y, dur }: { color: string; size: number; x: number; y: number; dur: number }) {
  const v = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: dur, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: dur, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, []);
  return (
    <Animated.View pointerEvents="none" style={{
      position: 'absolute', left: x, top: y, width: size, height: size, borderRadius: size / 2,
      opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.22, 0.4] }),
      transform: [
        { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, 26] }) },
        { translateX: v.interpolate({ inputRange: [0, 1], outputRange: [0, -18] }) },
      ],
    }}>
      <LinearGradient colors={[hexA(color, 0.5), 'rgba(0,0,0,0)']} start={{ x: 0.5, y: 0.2 }} end={{ x: 0.5, y: 1 }} style={{ flex: 1, borderRadius: size / 2 }} />
    </Animated.View>
  );
}

/* ============ Live previews — miniature feature mockups with sample data ============
   Each preview is a self-contained dummy render of the real feature's UI. */
const pvCard = { borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.35)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)', padding: 12 } as const;
const PvChip = ({ text, color, filled = true }: { text: string; color: string; filled?: boolean }) => (
  <View style={{ paddingVertical: 3, paddingHorizontal: 8, borderRadius: 999, backgroundColor: filled ? hexA(color, 0.13) : 'transparent', borderWidth: 1, borderColor: hexA(color, 0.4) }}>
    <Text style={{ fontFamily: F.bodySemi, fontSize: 9.5, color }}>{text}</Text>
  </View>
);
const PvBtn = ({ label, color, icon, grow }: { label: string; color: string; icon?: IconName; grow?: boolean }) => (
  <View style={{ flex: grow ? 1.4 : 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 8, borderRadius: 10, backgroundColor: hexA(color, 0.13), borderWidth: 1, borderColor: hexA(color, 0.4) }}>
    {icon ? <Icon name={icon} size={11} color={color} strokeWidth={2.3} /> : null}
    <Text style={{ fontFamily: F.bodyBold, fontSize: 10.5, color }}>{label}</Text>
  </View>
);

const PREVIEWS: Record<string, () => React.ReactElement> = {
  pinHome: () => (
    <View style={{ gap: 8 }}>
      {/* client hero with the green Pin Home pill */}
      <View style={[pvCard, { gap: 8 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
          <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: hexA(C.purple, 0.2), borderWidth: 1, borderColor: hexA(C.purple, 0.45), alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: C.purple }}>A</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Body style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>Aarav Mehta</Body>
            <Mono style={{ fontSize: 7.5, color: C.muted3 }}>CLIENT PAGE</Mono>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6, paddingHorizontal: 11, borderRadius: 999, backgroundColor: hexA(C.green, 0.15), borderWidth: 1, borderColor: hexA(C.green, 0.5) }}>
            <Icon name="pin" size={11} color={C.green} strokeWidth={2.2} />
            <Text style={{ fontFamily: F.bodyBold, fontSize: 10.5, color: C.green }}>Pin Home</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8, borderRadius: 10, backgroundColor: hexA(C.green, 0.07), borderWidth: 1, borderColor: hexA(C.green, 0.25) }}>
          <Icon name="checks" size={11} color={C.green} strokeWidth={2.4} />
          <Text style={{ flex: 1, fontFamily: F.bodySemi, fontSize: 9.5, color: C.green }}>Home location saved. One time only, at the client home.</Text>
        </View>
      </View>
      {/* what it unlocks */}
      <Mono style={{ fontSize: 7.5, letterSpacing: 1, color: C.muted3 }}>WHAT PINNING UNLOCKS</Mono>
      <View style={[pvCard, { flexDirection: 'row', alignItems: 'center', gap: 9, borderColor: hexA(C.blue, 0.3), backgroundColor: hexA(C.blue, 0.06) }]}>
        <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: hexA(C.blue, 0.15), borderWidth: 1, borderColor: hexA(C.blue, 0.45), alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="route" size={12} color={C.blue} strokeWidth={2.1} />
        </View>
        <View style={{ flex: 1 }}>
          <Body style={{ fontSize: 11.5, fontFamily: F.bodySemi, color: '#fff' }}>4.2 km · 15 min drive</Body>
          <Mono style={{ fontSize: 7.5, color: C.muted3 }}>LIVE ON EVERY ROSTER CARD</Mono>
        </View>
        <PvChip text="Route map" color={C.blue} />
      </View>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        <PvChip text="One tap navigation" color={C.green} />
        <PvChip text="Plan your day" color={C.gold} />
        <PvChip text="Whole team" color={C.purple} />
      </View>
    </View>
  ),
  roster: () => (
    <View style={[pvCard, { gap: 9 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
        <View style={{ alignItems: 'center' }}>
          <Serif style={{ fontSize: 16 }}>6:00</Serif>
          <Mono style={{ fontSize: 7, color: C.gold }}>PM</Mono>
        </View>
        <View style={{ width: 1, alignSelf: 'stretch', backgroundColor: 'rgba(255,255,255,0.08)' }} />
        <View style={{ flex: 1, gap: 4 }}>
          <Body style={{ fontSize: 13, fontFamily: F.bodySemi, color: '#fff' }}>Aarav Mehta</Body>
          <View style={{ flexDirection: 'row', gap: 5 }}>
            <PvChip text="Strength" color={C.blue} />
            <PvChip text="Ready to log" color={C.green} />
          </View>
        </View>
        <PvChip text="ACK ✓" color={C.green} />
      </View>
      <View style={{ flexDirection: 'row', gap: 7 }}>
        <PvBtn grow label="Log Workout" color={C.green} icon="plus" />
        <PvBtn label="Reschedule" color={C.orange} icon="calendar" />
        <PvBtn label="Cancel" color={C.red} icon="close" />
      </View>
    </View>
  ),
  distance: () => (
    <View style={{ gap: 8 }}>
      <View style={[pvCard, { flexDirection: 'row', alignItems: 'center', gap: 10, borderColor: hexA(C.blue, 0.3), backgroundColor: hexA(C.blue, 0.06) }]}>
        <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: hexA(C.blue, 0.15), borderWidth: 1, borderColor: hexA(C.blue, 0.45), alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="route" size={14} color={C.blue} strokeWidth={2.1} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: '#A9C6F0' }}>4.2 km · ~18 min drive</Text>
          <Mono style={{ fontSize: 7, letterSpacing: 0.5, color: C.muted3, marginTop: 1 }}>FROM YOUR LOCATION · TAP FOR LIVE ROUTE</Mono>
        </View>
        <Icon name="chevRight" size={13} color={C.blue} strokeWidth={2.3} />
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 12, backgroundColor: hexA(C.blue, 0.08), borderWidth: 1, borderColor: hexA(C.blue, 0.25) }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 17, color: C.blue }}>4.2<Text style={{ fontSize: 10 }}> km</Text></Text>
          <Mono style={{ fontSize: 6.5, color: C.muted3 }}>DISTANCE</Mono>
        </View>
        <View style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 12, backgroundColor: hexA(C.green, 0.08), borderWidth: 1, borderColor: hexA(C.green, 0.25) }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 17, color: C.green }}>~18<Text style={{ fontSize: 10 }}> min</Text></Text>
          <Mono style={{ fontSize: 6.5, color: C.muted3 }}>DRIVE TIME</Mono>
        </View>
      </View>
    </View>
  ),
  workout: () => (
    <View style={[pvCard, { gap: 8 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ width: 22, height: 22, borderRadius: 7, backgroundColor: hexA(C.orange, 0.14), alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontFamily: F.mono, fontSize: 10, color: C.orange }}>1</Text>
        </View>
        <Body style={{ flex: 1, fontSize: 13, fontFamily: F.bodySemi, color: '#fff' }}>Barbell Bench Press</Body>
        <Icon name="chevUp" size={12} color={C.muted3} strokeWidth={2.2} />
      </View>
      {[['1', '12', '40'], ['2', '10', '45']].map(([s, r, l]) => (
        <View key={s} style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
          <View style={{ width: 24, alignItems: 'center', paddingVertical: 7, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.04)' }}><Text style={{ fontFamily: F.mono, fontSize: 10, color: C.muted }}>{s}</Text></View>
          <View style={{ flex: 1, paddingVertical: 7, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center' }}><Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: '#fff' }}>{r} <Text style={{ color: C.muted3, fontSize: 9 }}>reps · Last: {r}</Text></Text></View>
          <View style={{ flex: 1, paddingVertical: 7, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center' }}><Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: '#fff' }}>{l} <Text style={{ color: C.muted3, fontSize: 9 }}>kg</Text></Text></View>
        </View>
      ))}
      <View style={{ gap: 4 }}>
        <Mono style={{ fontSize: 7, letterSpacing: 0.7, color: C.mono2 }}>SESSION RPE · 7.5</Mono>
        <View style={{ height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.06)' }}>
          <View style={{ width: '75%', height: 6, borderRadius: 3, backgroundColor: C.gold }} />
        </View>
      </View>
    </View>
  ),
  parallel: () => (
    <View style={{ gap: 7 }}>
      <View style={{ flexDirection: 'row', gap: 7 }}>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 9, paddingHorizontal: 10, borderRadius: 11, backgroundColor: hexA(C.green, 0.09), borderWidth: 1, borderColor: hexA(C.green, 0.4) }}>
          <Icon name="checks" size={11} color={C.green} strokeWidth={2.6} />
          <Text style={{ flex: 1, fontFamily: F.bodyBold, fontSize: 11, color: C.green }}>Aarav Mehta</Text>
          <Mono style={{ fontSize: 6.5, color: C.green }}>SAVED</Mono>
        </View>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 9, paddingHorizontal: 10, borderRadius: 11, backgroundColor: hexA(C.orange, 0.13), borderWidth: 1, borderColor: hexA(C.orange, 0.45) }}>
          <Icon name="userPlus" size={11} color={C.orange} strokeWidth={2.2} />
          <Text style={{ flex: 1, fontFamily: F.bodyBold, fontSize: 11, color: C.orange }}>Meera Kapoor</Text>
        </View>
      </View>
      <Body style={{ fontSize: 10, color: C.muted3 }}>Second leg — Aarav's exercises are pre-selected; enter Meera's values. The pair shares one package session.</Body>
    </View>
  ),
  requestRoster: () => (
    <View style={[pvCard, { gap: 9 }]}>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 9, borderRadius: 10, backgroundColor: hexA(C.orange, 0.12), borderWidth: 1, borderColor: hexA(C.orange, 0.45) }}>
          <View style={{ width: 12, height: 12, borderRadius: 6, borderWidth: 1.5, borderColor: C.orange, alignItems: 'center', justifyContent: 'center' }}><View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: C.orange }} /></View>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 10, color: C.orange }}>Single Day</Text>
        </View>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 9, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)' }}>
          <View style={{ width: 12, height: 12, borderRadius: 6, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.3)' }} />
          <Text style={{ fontFamily: F.bodySemi, fontSize: 10, color: C.ink3 }}>Full Roster</Text>
        </View>
      </View>
      <Mono style={{ fontSize: 7, letterSpacing: 0.8, color: C.mono2 }}>MODALITY *</Mono>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
        {['Strength', 'Yoga', 'HIIT', 'Pilates'].map((m, k) => (
          <View key={m} style={{ paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999, backgroundColor: k === 0 ? hexA(C.blue, 0.14) : 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: k === 0 ? hexA(C.blue, 0.5) : 'rgba(255,255,255,0.08)' }}>
            <Text style={{ fontFamily: k === 0 ? F.bodyBold : F.bodySemi, fontSize: 9.5, color: k === 0 ? C.blue : C.ink3 }}>{m}</Text>
          </View>
        ))}
      </View>
    </View>
  ),
  clients: () => (
    <View style={[pvCard, { gap: 10 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: hexA(C.purple, 0.3), borderWidth: 2, borderColor: C.orange, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: '#fff' }}>AM</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Body style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>Aarav Mehta</Body>
          <View style={{ flexDirection: 'row', gap: 5, marginTop: 2 }}><PvChip text="Active" color={C.green} /><PvChip text="Premium" color={C.gold} /></View>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {[['28.4', 'AXION · METABOLIC', C.blue], ['31.2', 'MAQ · MECHANICAL', C.red]].map(([v, l, col]) => (
          <View key={l as string} style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 12, backgroundColor: hexA(col as string, 0.07), borderWidth: 1, borderColor: hexA(col as string, 0.28) }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 17, color: col as string }}>{v}</Text>
            <Mono style={{ fontSize: 6, letterSpacing: 0.4, color: C.muted3, marginTop: 1 }}>{l}</Mono>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: 5 }}>
        {['Progression', 'Sessions', 'Plan', 'Reports'].map((t, k) => (
          <View key={t} style={{ paddingVertical: 5, paddingHorizontal: 9, borderRadius: 999, backgroundColor: k === 0 ? hexA(C.orange, 0.16) : 'rgba(255,255,255,0.04)' }}>
            <Text style={{ fontFamily: k === 0 ? F.bodyBold : F.body, fontSize: 9, color: k === 0 ? C.orange : C.muted }}>{t}</Text>
          </View>
        ))}
      </View>
    </View>
  ),
  qhp: () => (
    <View style={[pvCard, { gap: 8, borderColor: hexA(C.gold, 0.25) }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
        <Icon name="heart" size={15} color={C.gold} strokeWidth={2} />
        <Body style={{ flex: 1, fontSize: 13, fontFamily: F.bodySemi, color: '#fff' }}>Meera Kapoor</Body>
        <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: hexA(C.green, 0.14), borderWidth: 1, borderColor: hexA(C.green, 0.45), alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="pin" size={12} color={C.green} strokeWidth={2.2} />
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 5 }}>
        <PvChip text="Tomorrow · 10:00 AM" color={C.blue} />
        <PvChip text="Baseline QHP" color={C.gold} />
      </View>
      <Body style={{ fontSize: 10, color: C.muted3 }}>Green pin = capture the client's home location for distance & far-session alerts.</Body>
    </View>
  ),
  messenger: () => (
    <View style={{ gap: 7 }}>
      <View style={{ alignSelf: 'flex-start', maxWidth: '85%', borderRadius: 13, borderBottomLeftRadius: 4, paddingVertical: 7, paddingHorizontal: 11, backgroundColor: 'rgba(255,255,255,0.06)' }}>
        <Text style={{ fontFamily: F.body, fontSize: 11.5, color: C.ink }}>Can we move tomorrow's session to 7 AM?</Text>
      </View>
      <View style={{ alignSelf: 'flex-end', maxWidth: '85%', flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 13, borderBottomRightRadius: 4, padding: 9, backgroundColor: hexA(C.orange, 0.9) }}>
        <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center' }}>
          <Icon path="M8 5v14l11-7z" size={11} color="#fff" strokeWidth={0} fill="#fff" />
        </View>
        <View style={{ gap: 3 }}>
          <View style={{ width: 90, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)' }}><View style={{ width: '45%', height: 3, borderRadius: 2, backgroundColor: '#fff' }} /></View>
          <Text style={{ fontFamily: F.mono, fontSize: 7.5, color: 'rgba(255,255,255,0.8)' }}>0:05 / 0:12</Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <View style={{ flex: 1, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', justifyContent: 'center', paddingHorizontal: 12 }}>
          <Text style={{ fontFamily: F.body, fontSize: 10.5, color: C.muted3 }}>Message…</Text>
        </View>
        <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: C.orange, alignItems: 'center', justifyContent: 'center' }}>
          <Icon path="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3ZM19 11a7 7 0 0 1-14 0M12 18v3M8 21h8" size={14} color="#fff" strokeWidth={2.1} />
        </View>
      </View>
    </View>
  ),
  threads: () => (
    <View style={[pvCard, { gap: 8, borderColor: hexA(C.purple, 0.3) }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <Icon name="atSign" size={13} color={C.purple} strokeWidth={2.2} />
        <Body style={{ flex: 1, fontSize: 12, fontFamily: F.bodySemi, color: '#fff' }}>Aarav Mehta · Team Thread</Body>
        <PvChip text="TEAM ONLY" color={C.purple} />
      </View>
      <View style={{ alignSelf: 'flex-start', borderRadius: 12, padding: 9, backgroundColor: 'rgba(255,255,255,0.05)' }}>
        <Text style={{ fontFamily: F.body, fontSize: 11, color: C.ink }}>
          <Text style={{ color: C.purple, fontFamily: F.bodySemi }}>@Dr.Anjana</Text> knee mobility improving — reduce load next week?
        </Text>
        <Mono style={{ fontSize: 7, color: C.muted3, marginTop: 3 }}>RAHUL · TRAINER</Mono>
      </View>
      <Body style={{ fontSize: 9.5, color: C.muted3 }}>Clients never see these threads.</Body>
    </View>
  ),
  plans: () => (
    <View style={[pvCard, { gap: 9 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name="clipboard" size={13} color={C.blue} strokeWidth={2.1} />
        <Body style={{ flex: 1, fontSize: 12.5, fontFamily: F.bodySemi, color: '#fff' }}>Hypertrophy Block A</Body>
        <PvChip text="Approved" color={C.green} />
      </View>
      <View style={{ flexDirection: 'row', gap: 5 }}>
        <PvChip text="Strength" color={C.blue} />
        <PvChip text="6 weeks" color={C.gold} />
        <PvChip text="24 exercises" color={C.purple} />
      </View>
      <View style={{ borderRadius: 10, overflow: 'hidden' }}>
        <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9 }}>
          <Icon name="plus" size={12} color="#fff" strokeWidth={2.6} />
          <Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: '#fff' }}>Create Training Plan</Text>
        </LinearGradient>
      </View>
    </View>
  ),
  leaderboard: () => (
    <View style={{ gap: 7 }}>
      {[['1', 'Rahul S.', '312', C.gold], ['2', 'Priya M.', '288', '#B8BCC4'], ['3', 'You', '265', '#C08A52']].map(([r, n, v, col]) => (
        <View key={r} style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 11, backgroundColor: n === 'You' ? hexA(C.orange, 0.08) : 'rgba(0,0,0,0.3)', borderWidth: 1, borderColor: n === 'You' ? hexA(C.orange, 0.35) : 'rgba(255,255,255,0.06)' }}>
          <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: hexA(col, 0.18), borderWidth: 1, borderColor: hexA(col, 0.5), alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="crown" size={10} color={col} strokeWidth={2.2} />
          </View>
          <Body style={{ flex: 1, fontSize: 12, fontFamily: F.bodySemi, color: '#fff' }}>{n}</Body>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: col }}>{v}</Text>
          <Mono style={{ fontSize: 6.5, color: C.muted3 }}>SESSIONS</Mono>
        </View>
      ))}
    </View>
  ),
  payouts: () => (
    <View style={[pvCard, { gap: 9, borderColor: hexA(C.green, 0.25) }]}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <View>
          <Mono style={{ fontSize: 7, letterSpacing: 0.8, color: C.mono2 }}>THIS MONTH</Mono>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 22, color: C.green, marginTop: 2 }}>₹ 12,400</Text>
        </View>
        <PvChip text="+ ₹1,150 vs last month" color={C.green} />
      </View>
      {[['45 sessions × ₹250', '₹ 11,250'], ['Referral incentive', '₹ 1,000'], ['QHP bonus', '₹ 150']].map(([l, v]) => (
        <View key={l} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)' }}>
          <Body style={{ fontSize: 11, color: C.ink3 }}>{l}</Body>
          <Text style={{ fontFamily: F.bodySemi, fontSize: 11.5, color: '#fff' }}>{v}</Text>
        </View>
      ))}
    </View>
  ),
  medical: () => (
    <View style={[pvCard, { gap: 9, borderColor: hexA(C.red, 0.25) }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name="clipboard" size={13} color={C.red} strokeWidth={2.1} />
        <Body style={{ flex: 1, fontSize: 12.5, fontFamily: F.bodySemi, color: '#fff' }}>Medical History</Body>
        <PvChip text="3 ENTRIES" color={C.red} />
      </View>
      <View style={{ flexDirection: 'row', gap: 5 }}>
        <PvChip text="Upload Document (AI)" color={C.purple} />
        <PvChip text="Manual Entry" color={C.blue} />
      </View>
      <View style={{ padding: 9, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.3)', borderLeftWidth: 3, borderLeftColor: C.gold }}>
        <Body style={{ fontSize: 11, fontFamily: F.bodySemi, color: '#fff' }}>Shoulder impingement</Body>
        <Mono style={{ fontSize: 7, color: C.muted3, marginTop: 2 }}>INJURY · MODERATE · ONGOING</Mono>
      </View>
      <View style={{ borderRadius: 10, overflow: 'hidden' }}>
        <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9 }}>
          <Icon name="plus" size={12} color="#fff" strokeWidth={2.6} />
          <Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: '#fff' }}>Upload Reports</Text>
        </LinearGradient>
      </View>
    </View>
  ),
  leads: () => (
    <View style={{ gap: 7 }}>
      {[['Rohan Verma', 'New', C.blue, 'Instagram'], ['Sneha Patel', 'QHP Booked', '#4FD1C5', 'Referral'], ['Karan Johar', 'Converted', C.green, 'Direct']].map(([n, st, col, src]) => (
        <View key={n} style={[pvCard, { flexDirection: 'row', alignItems: 'center', gap: 9, padding: 10 }]}>
          <Body style={{ flex: 1, fontSize: 12, fontFamily: F.bodySemi, color: '#fff' }}>{n}</Body>
          <PvChip text={src} color={C.muted2} />
          <PvChip text={st} color={col} />
        </View>
      ))}
    </View>
  ),
};


/* Animated tour launcher — gradient core, rotating dashed halo, breathing glow. */
export function TourLauncher({ onPress }: { onPress: () => void }) {
  const spin = React.useRef(new Animated.Value(0)).current;
  const glow = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    const loops = [
      Animated.loop(Animated.timing(spin, { toValue: 1, duration: 7000, easing: Easing.linear, useNativeDriver: true })),
      Animated.loop(Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0, duration: 1200, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])),
    ];
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, []);
  return (
    <Pressable onPress={onPress} hitSlop={8} style={{ marginLeft: 8, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={{ position: 'absolute', width: 44, height: 44, borderRadius: 22, borderWidth: 1.3, borderStyle: 'dashed', borderColor: hexA(C.orange, 0.6), transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }} />
      <Animated.View style={{ position: 'absolute', width: 40, height: 40, borderRadius: 20, backgroundColor: hexA(C.orange, 0.16), transform: [{ scale: glow.interpolate({ inputRange: [0, 1], outputRange: [1, 1.16] }) }], opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0.15] }) }} />
      <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' }}>
        <Icon path="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09zM12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2zM9 12H4s.55-3.03 2-4c1.62-1.09 5 0 5 0M12 15v5s3.03-.55 4-2c1.09-1.62 0-5 0-5" size={17} color="#fff" strokeWidth={1.9} />
      </LinearGradient>
    </Pressable>
  );
}

export function FeatureTour({ visible, steps, tourName, onClose }: { visible: boolean; steps: TourStep[]; tourName: string; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [i, setI] = React.useState(0);
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const step = steps[Math.min(i, steps.length - 1)];
  const last = i === steps.length - 1;

  // Per-step entrance + continuous icon animations.
  const enter = React.useRef(new Animated.Value(0)).current;
  const pulse = React.useRef(new Animated.Value(0)).current;
  const spin = React.useRef(new Animated.Value(0)).current;
  const prog = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    if (!visible) return;
    setI(0);
    trackEvent('Feature Tour Started', { tour: tourName });
    const loops = [
      Animated.loop(Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])),
      Animated.loop(Animated.timing(spin, { toValue: 1, duration: 9000, easing: Easing.linear, useNativeDriver: true })),
    ];
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [visible]);

  React.useEffect(() => {
    if (!visible) return;
    setPreviewOpen(false);
    enter.setValue(0);
    Animated.spring(enter, { toValue: 1, useNativeDriver: true, speed: 13, bounciness: 8 }).start();
    Animated.timing(prog, { toValue: (i + 1) / steps.length, duration: 350, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [i, visible]);

  if (!visible) return null;

  const finish = (skipped: boolean) => {
    trackEvent(skipped ? 'Feature Tour Skipped' : 'Feature Tour Completed', { tour: tourName, step: i + 1, total: steps.length });
    onClose();
  };

  return (
    <Modal visible transparent={false} animationType="fade" onRequestClose={() => finish(true)}>
      <View style={{ flex: 1, backgroundColor: '#070505' }}>
        {/* ambient orbs */}
        <Orb color={step.color} size={SCREEN_W * 0.95} x={-SCREEN_W * 0.3} y={-60} dur={5200} />
        <Orb color={C.orange} size={SCREEN_W * 0.7} x={SCREEN_W * 0.55} y={420} dur={6800} />

        {/* top bar: counter + skip */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: insets.top + 14, paddingHorizontal: 22 }}>
          <Mono style={{ flex: 1, fontSize: 11, letterSpacing: 2, color: hexA(step.color, 0.9) }}>
            {String(i + 1).padStart(2, '0')} / {String(steps.length).padStart(2, '0')}
          </Mono>
          {!last ? (
            <Pressable onPress={() => finish(true)} hitSlop={10} style={{ paddingVertical: 6, paddingHorizontal: 14, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 11.5, color: C.muted }}>Skip Tour</Text>
            </Pressable>
          ) : null}
        </View>

        {/* progress rail */}
        <View style={{ marginTop: 12, marginHorizontal: 22, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
          <Animated.View style={{ height: 3, borderRadius: 2, backgroundColor: step.color, width: prog.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }} />
        </View>

        {/* step content */}
        <Animated.View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30, opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [34, 0] }) }, { scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }] }}>
          {previewOpen && step.preview && PREVIEWS[step.preview] ? (
            /* live mock with sample data — framed device card */
            <View style={{ width: '100%', maxWidth: 340, marginBottom: 22, borderRadius: 20, borderWidth: 1.5, borderColor: hexA(step.color, 0.4), backgroundColor: 'rgba(10,7,6,0.92)', padding: 13, gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: step.color }} />
                <Mono style={{ flex: 1, fontSize: 8, letterSpacing: 1, color: hexA(step.color, 0.9) }}>FEATURE PREVIEW · SAMPLE DATA</Mono>
                <Pressable onPress={() => setPreviewOpen(false)} hitSlop={8}><Icon name='close' size={12} color={C.muted2} strokeWidth={2.4} /></Pressable>
              </View>
              {PREVIEWS[step.preview]()}
            </View>
          ) : (<>
          {/* glowing core + orbit ring */}
          <View style={{ width: 168, height: 168, alignItems: 'center', justifyContent: 'center', marginBottom: 30 }}>
            <Animated.View style={{ position: 'absolute', width: 168, height: 168, borderRadius: 84, borderWidth: 1, borderColor: hexA(step.color, 0.35), borderStyle: 'dashed', transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }}>
              {/* orbit satellite */}
              <View style={{ position: 'absolute', top: -5, left: 79, width: 10, height: 10, borderRadius: 5, backgroundColor: step.color }} />
            </Animated.View>
            <Animated.View style={{ position: 'absolute', width: 128, height: 128, borderRadius: 64, backgroundColor: hexA(step.color, 0.09), transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] }) }] }} />
            <View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: hexA(step.color, 0.13), borderWidth: 1.5, borderColor: hexA(step.color, 0.5), alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={step.icon} size={40} color={step.color} strokeWidth={1.8} />
            </View>
          </View>

          </>)}

          <Serif style={{ fontSize: 26, textAlign: 'center' }}>{step.title}</Serif>
          <Body style={{ fontSize: 14, color: C.ink3, textAlign: 'center', lineHeight: 21, marginTop: 12, maxWidth: 330 }}>{step.body}</Body>
          {step.where ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 16, paddingVertical: 6, paddingHorizontal: 13, borderRadius: 999, backgroundColor: hexA(step.color, 0.1), borderWidth: 1, borderColor: hexA(step.color, 0.35) }}>
              <Icon name="pin" size={11} color={step.color} strokeWidth={2.2} />
              <Mono style={{ fontSize: 9.5, letterSpacing: 1.2, color: step.color }}>{step.where}</Mono>
            </View>
          ) : null}
          {step.preview && !previewOpen ? (
            <Pressable onPress={() => setPreviewOpen(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 14, paddingVertical: 9, paddingHorizontal: 18, borderRadius: 999, backgroundColor: hexA(step.color, 0.14), borderWidth: 1.5, borderColor: hexA(step.color, 0.5) }}>
              <Icon name="eye" size={13} color={step.color} strokeWidth={2} />
              <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: step.color }}>See preview</Text>
            </Pressable>
          ) : null}
        </Animated.View>

        {/* dots + nav */}
        <View style={{ paddingHorizontal: 22, paddingBottom: insets.bottom + 20, gap: 16 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6 }}>
            {steps.map((_, d) => (
              <View key={d} style={{ width: d === i ? 18 : 6, height: 6, borderRadius: 3, backgroundColor: d === i ? step.color : d < i ? hexA(step.color, 0.45) : 'rgba(255,255,255,0.14)' }} />
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {i > 0 ? (
              <Pressable onPress={() => setI(i - 1)} style={{ paddingVertical: 15, paddingHorizontal: 22, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}>
                <Icon name="arrowLeft" size={17} color={C.ink3} strokeWidth={2.2} />
              </Pressable>
            ) : null}
            <Pressable onPress={() => (last ? finish(false) : setI(i + 1))} style={{ flex: 1, borderRadius: 15, overflow: 'hidden' }}>
              <LinearGradient colors={last ? ['#3FBF77', '#2E9A5D'] : ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 15 }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: '#fff' }}>{last ? 'Finish Tour' : i === 0 ? 'Start the Tour' : 'Next'}</Text>
                {!last ? <Icon name="chevRight" size={15} color="#fff" strokeWidth={2.6} /> : <Icon name="checks" size={16} color="#fff" strokeWidth={2.6} />}
              </LinearGradient>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
