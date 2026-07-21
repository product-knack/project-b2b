import React, { useRef, useEffect, useState, useLayoutEffect } from 'react';
import { View, PanResponder, Animated, Easing, StyleSheet, Dimensions, BackHandler } from 'react-native';
import { C } from './theme';
import { useStore } from './store';
import { useAuth } from './auth';
import { Header, Drawer } from './components/chrome';
import { ScreenErrorBoundary } from './components/errorBoundary';
import { LocationCapture, LocationGate } from './components/LocationCapture';
import { OfflineWarmup } from './components/OfflineWarmup';
import { PushTokenManager } from './components/PushTokenManager';
import { UpdateGate } from './components/UpdateGate';
import { LiveSync } from './lib/liveSync';
import { Overlays } from './components/overlays';
import { OddsAiBar, OddsAiChat } from './components/oddsAi';
import {
  SignIn, Dashboard, Clients, ClientDetail, Sessions, Workout, Qhp, QhpManager, QhpStats, Managers, Profile, MgrDash, TrainerLeaderboard,
} from './screens/trainer';
import { CreatePlan } from './screens/createPlan';
import { Payouts } from './screens/payouts';
import { WorkoutAnalyst } from './screens/workoutAnalyst';
import { Messenger, ChatNotifications } from './screens/messenger';
import { ClientThreads } from './screens/clientThreads';
import {
  CrmDashboard, CrmRoadmap, CrmComms,
  CrmApprovals, CrmAssessment, CrmHealth,
} from './screens/crm';
import { CrmEsc } from './screens/crmEsc';
import { CrmTools, CrmBloodReports } from './screens/crmTools';
import { CrmQhp } from './screens/crmQhp';
import { CrmRoster } from './screens/crmRoster';
import { CrmTasks } from './screens/crmTasks';
import { CrmService } from './screens/crmService';
import { CrmBirthdays } from './screens/crmBirthdays';
import { CrmConsume } from './screens/crmConsume';
import { CrmSales, CrmSalesDetail } from './screens/crmSales';
import { CrmJourney, CrmJourneyDetail } from './screens/crmJourney';
import { CrmSectionPage } from './screens/crmTabs';
import { CrmClients } from './screens/crmClients';
import { CrmClientDetail } from './screens/crmClientDetail';
import { CrmDistribution } from './screens/crmDistribution';
import {
  CoachDashboard, CoachClients, CoachClientsOverview, CoachClientOverviewDetail, CoachTrainers, CoachTrainerDetail, CoachAssessments,
  CoachPrograms, CoachProgression, CoachPlansOverview, CoachApprovedPlans,
} from './screens/coach';
import { PlansAnalyst, PlansAnalystClient } from './screens/plansAnalyst';
import { QhpAssessmentDetail } from './screens/qhpAssessmentDetail';
import { QhpReviewCenter } from './screens/qhpReview';
import { B2cReports } from './screens/b2cReports';
import { OpsDashboard, OpsClients, OpsCrmPending, OpsCrmActivity, OpsBaseline, OpsTargets, OpsQhpHold } from './screens/ops';
import { OpsLeads } from './screens/opsLeads';
import { OpsEscalations } from './screens/opsEscalations';
import { AdminDashboard } from './screens/admin';
import { DoctorDashboard, DoctorSessions, DoctorClients, DoctorAllClients, DoctorRoster, DoctorProtocolApprovals } from './screens/doctor';
import { DoctorClientDetail } from './screens/doctorClientDetail';
import { AdminRenewals } from './screens/adminRenewals';
import { AdminRequests } from './screens/adminRequests';
import { AdminIncidents } from './screens/adminIncidents';
import { AdminClients } from './screens/adminClients';
import { AdminClientDetail } from './screens/adminClientDetail';
import { AdminUsers } from './screens/adminUsers';
import { AdminPerformance } from './screens/adminPerformance';
import { AdminCertifications } from './screens/adminCertifications';
import { AdminTools, AdminTrainerFees, AdminManageTeams } from './screens/adminTools';
import { AdminChurn } from './screens/adminChurn';
import { AdminRevenueTracker, AdminRevenueSummary } from './screens/adminRevenue';
import { MarketingDashboard, MarketingClients, MarketingClientDetail, MarketingLeads, MarketingLeadAnalytics } from './screens/marketing';

const SCREENS: Record<string, React.ComponentType> = {
  dashboard: Dashboard,
  clients: Clients,
  client: ClientDetail,
  sessions: Sessions,
  workout: Workout,
  'create-plan': CreatePlan,
  'workout-analyst': WorkoutAnalyst,
  payouts: Payouts,
  qhp: Qhp,
  'qhp-manager': QhpManager,
  'qhp-stats': QhpStats,
  managers: Managers,
  messenger: Messenger,
  'client-threads': ClientThreads,
  profile: Profile,
  'mgr-dash': MgrDash,
  'trainer-leaderboard': TrainerLeaderboard,
  'crm-dashboard': CrmDashboard,
  'crm-section': CrmSectionPage,
  'crm-clients': CrmClients,
  'crm-client': CrmClientDetail,
  'crm-distribution': CrmDistribution,
  'crm-birthdays': CrmBirthdays,
  'crm-sales': CrmSales,
  'crm-sales-detail': CrmSalesDetail,
  'crm-journey': CrmJourney,
  'crm-journey-client': CrmJourneyDetail,
  'crm-roadmap': CrmRoadmap,
  'crm-consume': CrmConsume,
  'crm-comms': CrmComms,
  'crm-service': CrmService,
  'crm-approvals': CrmApprovals,
  'crm-roster': CrmRoster,
  'crm-qhp': CrmQhp,
  'crm-blood': CrmBloodReports,
  'crm-esc': CrmEsc,
  'crm-tasks': CrmTasks,
  'crm-tools': CrmTools,
  'crm-assessment': CrmAssessment,
  'crm-health': CrmHealth,
  'coach-dashboard': CoachDashboard,
  'coach-trainers': CoachTrainers,
  'coach-trainer-detail': CoachTrainerDetail,
  'coach-assessments': CoachAssessments,
  'coach-clients': CoachClients,
  'coach-clients-overview': CoachClientsOverview,
  'coach-client-overview': CoachClientOverviewDetail,
  'coach-progression': CoachProgression,
  'coach-programs': CoachPrograms,
  'coach-plans-overview': CoachPlansOverview,
  'coach-approved-plans': CoachApprovedPlans,
  'plans-analyst': PlansAnalyst,
  'plans-analyst-client': PlansAnalystClient,
  'qhp-assessment-detail': QhpAssessmentDetail,
  'qhp-review': QhpReviewCenter,
  'b2c-reports': B2cReports,
  'ops-dashboard': OpsDashboard,
  'ops-leads': OpsLeads,
  'ops-clients': OpsClients,
  'ops-crm-pending': OpsCrmPending,
  'ops-activity': OpsCrmActivity,
  'ops-baseline': OpsBaseline,
  'ops-targets': OpsTargets,
  'ops-qhp-hold': OpsQhpHold,
  'ops-escalations': OpsEscalations,
  'admin-dashboard': AdminDashboard,
  'doctor-dashboard': DoctorDashboard,
  'doctor-sessions': DoctorSessions,
  'doctor-clients': DoctorClients,
  'doctor-client-detail': DoctorClientDetail,
  'doctor-all-clients': DoctorAllClients,
  'doctor-roster': DoctorRoster,
  'doctor-protocol-approvals': DoctorProtocolApprovals,
  'admin-renewals': AdminRenewals,
  'admin-requests': AdminRequests,
  'admin-incidents': AdminIncidents,
  'admin-clients': AdminClients,
  'admin-client-detail': AdminClientDetail,
  'admin-users': AdminUsers,
  'admin-performance': AdminPerformance,
  'admin-certifications': AdminCertifications,
  'admin-tools': AdminTools,
  'admin-trainer-fees': AdminTrainerFees,
  'admin-manage-teams': AdminManageTeams,
  'admin-churn': AdminChurn,
  'admin-revenue-tracker': AdminRevenueTracker,
  'admin-revenue-summary': AdminRevenueSummary,
  'marketing-dashboard': MarketingDashboard,
  'marketing-clients': MarketingClients,
  'marketing-client-detail': MarketingClientDetail,
  'marketing-leads': MarketingLeads,
  'marketing-lead-analytics': MarketingLeadAnalytics,
};

function RouteScreen({ route }: { route: string }) {
  const Screen = SCREENS[route] ?? Dashboard;
  return (
    <ScreenErrorBoundary resetKey={route}>
      <Screen />
    </ScreenErrorBoundary>
  );
}

const SCREEN_W = Dimensions.get('window').width;
import { backSwipeLock, backOverride } from './gestureLock';

/* Direction-aware transitions + swipe-back.
   - Forward (push): the new screen slides in from the right over the current one.
   - Back: the target is shown directly with a gentle fade + slide from the left —
     the old screen is NOT layered on top, so you never see the page you just left. */
type TState = { layers: { key: number; route: string }[]; anim: 'push' | 'back' | null; prevRoute: string; tid: number };

function ScreenHost({ route }: { route: string }) {
  const { canGoBack, back, navDir } = useStore();
  const enter = useRef(new Animated.Value(1)).current; // drives the moving (top) layer
  const drag = useRef(new Animated.Value(0)).current;
  const idRef = useRef(0);

  const [t, setT] = useState<TState>({ layers: [{ key: 0, route }], anim: null, prevRoute: route, tid: 0 });

  // Derive the new layer stack SYNCHRONOUSLY when the route changes (during render),
  // so there is never a frame where the route changed but the old page is still shown.
  // Both directions render the target ALONE — screens have transparent backgrounds
  // (for the ambient glow), so layering old under new shows through and looks broken.
  if (route !== t.prevRoute) {
    const key = ++idRef.current;
    enter.setValue(0);
    setT({ layers: [{ key, route }], anim: navDir, prevRoute: route, tid: key });
  }

  // Kick off the entrance animation once per transition (after the new layers paint).
  useEffect(() => {
    if (!t.anim) return;
    const raf = requestAnimationFrame(() => {
      Animated.timing(enter, {
        toValue: 1,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setT((s) => (s.tid === t.tid ? { ...s, layers: [s.layers[s.layers.length - 1]], anim: null } : s));
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [t.tid]);

  // Reset any swipe offset before the committed target paints.
  useLayoutEffect(() => {
    drag.setValue(0);
  }, [route]);

  const canBackRef = useRef(canGoBack);
  canBackRef.current = canGoBack;

  const pan = useRef(
    PanResponder.create({
      // No capture phase here: horizontal ScrollViews (tab rows, chip rows) must win
      // the gesture when the touch starts on them — otherwise scrolling tabs would
      // trigger page navigation. Swipe-back still works from any non-scrolling area.
      // Rightward swipes only (standard back gesture) — leftward drags stay inert so
      // horizontal finger travel over lists/tabs can't accidentally change the page.
      onMoveShouldSetPanResponder: (_e, g) =>
        !backSwipeLock.locked && (canBackRef.current || !!backOverride.handler) && g.dx > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.3,
      onPanResponderMove: (_e, g) => drag.setValue(Math.max(0, g.dx)),
      onPanResponderRelease: (_e, g) => {
        if (g.dx > 48 || g.vx > 0.3) {
          const dir = 1;
          Animated.timing(drag, {
            toValue: dir * SCREEN_W,
            duration: 160,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: false,
          }).start(() => {
            // A screen-level override (e.g. an open chat) intercepts the back
            // gesture: close the sub-view instead of popping the route.
            if (backOverride.handler) {
              const h = backOverride.handler;
              h();
              drag.setValue(0);
            } else {
              back();
            }
          });
        } else {
          Animated.spring(drag, { toValue: 0, useNativeDriver: false, speed: 20, bounciness: 3 }).start();
        }
      },
      onPanResponderTerminationRequest: () => false,
    })
  ).current;

  const topStyle =
    t.anim === 'push'
      ? { opacity: enter, transform: [{ translateX: enter.interpolate({ inputRange: [0, 1], outputRange: [28, 0] }) }] }
      : t.anim === 'back'
      ? { opacity: enter, transform: [{ translateX: enter.interpolate({ inputRange: [0, 1], outputRange: [-28, 0] }) }] }
      : null;

  return (
    <Animated.View style={{ flex: 1, transform: [{ translateX: drag }] }} {...pan.panHandlers}>
      {t.layers.map((l, i) => {
        const isTop = i === t.layers.length - 1;
        return (
          <Animated.View key={l.key} style={[StyleSheet.absoluteFill, isTop ? topStyle : null]}>
            <RouteScreen route={l.route} />
          </Animated.View>
        );
      })}
    </Animated.View>
  );
}

export function Router() {
  const { route, go, set, back, canGoBack, drawerOpen, closeDrawer, aiOpen, closeAi, role, threadViewOpen } = useStore();
  const { session, loading, role: accountRole } = useAuth();

  // Android system back: close overlays first, then pop in-app history, then land on
  // the role's dashboard; only exit the app from the dashboard itself. (Modals with
  // onRequestClose intercept the button themselves while visible.)
  const backState = useRef({ route, canGoBack, drawerOpen, aiOpen, role });
  backState.current = { route, canGoBack, drawerOpen, aiOpen, role };
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const s = backState.current;
      if (s.aiOpen) { closeAi(); return true; }
      if (s.drawerOpen) { closeDrawer(); return true; }
      const home =
        s.role === 'crm' ? 'crm-dashboard'
        : s.role === 'coach' ? 'coach-dashboard'
        : s.role === 'ops' ? 'ops-dashboard'
        : s.role === 'admin' ? 'admin-dashboard'
        : s.role === 'doctor' ? 'doctor-dashboard'
        : s.role === 'marketing' ? 'marketing-dashboard'
        : 'dashboard';
      if (s.route === home || s.route === 'signin') return false; // default: background the app
      back(); // pops history, or falls back to the dashboard when the stack is empty
      return true;
    });
    return () => sub.remove();
  }, []);

  // Session gate: if already signed in (persisted session), skip the login screen —
  // but only once the ACCOUNT's role (profiles.role) has resolved, so a CRM never
  // lands on the trainer workspace (and vice versa).
  useEffect(() => {
    if (!loading && session && accountRole && route === 'signin') {
      set({ role: accountRole });
      go(accountRole === 'crm' ? 'crm-dashboard' : accountRole === 'coach' ? 'coach-dashboard' : accountRole === 'ops' ? 'ops-dashboard' : accountRole === 'admin' ? 'admin-dashboard' : accountRole === 'doctor' ? 'doctor-dashboard' : accountRole === 'marketing' ? 'marketing-dashboard' : 'dashboard', true);
    }
  }, [loading, session, accountRole]);

  // REVERSE gate: if the session dies mid-use (refresh-token failure, sign-out
  // elsewhere, revoked session), land back on Sign In. Without this the app kept
  // showing a "zombie" dashboard — no session → every query disabled (blank
  // pages) and the greeting fell back to a placeholder name.
  useEffect(() => {
    if (!loading && !session && route !== 'signin') go('signin', true);
  }, [loading, session, route]);

  if (route === 'signin') {
    return (
      <View style={{ flex: 1, backgroundColor: 'transparent' }}>
        <SignIn />
      </View>
    );
  }

  return (
    <UpdateGate>
    <LocationGate>
      <View style={{ flex: 1, backgroundColor: 'transparent' }}>
        <LiveSync />
        <LocationCapture />
        <OfflineWarmup />
        <PushTokenManager />
        <Header />
        <View style={{ flex: 1 }}>
          <ScreenHost route={route} />
        </View>
        {/* Floating launcher — overlays the content so the background stays continuous
            (no opaque bottom strip). Hidden on forms with their own submit bar. */}
        {route !== 'workout' && route !== 'create-plan' && route !== 'messenger' && !threadViewOpen ? (
          <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
            <OddsAiBar />
          </View>
        ) : null}
        <Drawer />
        <Overlays />
        <OddsAiChat />
        <ChatNotifications />
      </View>
    </LocationGate>
    </UpdateGate>
  );
}
