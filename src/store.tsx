import React, { createContext, useContext, useMemo, useState, useCallback } from 'react';

/* THE canonical role -> home-route map. Every 'go home' path (back-fallback,
   floating Home button, hardware back, router fallback, post-login redirect)
   must use this — per-site copies kept drifting and dumped non-trainer roles
   onto the trainer dashboard. */
export const homeRouteFor = (role: string | null | undefined): string =>
  role === 'crm' ? 'crm-dashboard'
  : role === 'coach' ? 'coach-dashboard'
  : role === 'ops' ? 'ops-dashboard'
  : role === 'admin' ? 'admin-dashboard'
  : role === 'doctor' ? 'doctor-dashboard'
  : role === 'therapist' ? 'therapist-dashboard'
  : role === 'marketing' ? 'marketing-dashboard'
  : role === 'academy' ? 'academy-dashboard'
  : role === 'tech' ? 'tech-desk-inbox'
  : 'dashboard';

export type Role = 'trainer' | 'crm' | 'coach' | 'ops' | 'admin' | 'doctor' | 'therapist' | 'marketing' | 'academy' | 'tech';
export type SheetKind = 'ack' | 'leave' | 'schedule' | null;
export type CrmDialog =
  | { kind: 'approve'; id: string }
  | { kind: 'reject'; id: string }
  | { kind: 'markers'; i: number }
  | { kind: 'cta' }
  | null;

type Store = {
  route: string;
  role: Role;
  drawerOpen: boolean;
  sheet: SheetKind;
  crmDialog: CrmDialog;
  // per-screen local state
  clientsTab: 'active' | 'inactive';
  qhpTab: string;
  mgrTab: string;
  mgrDashTab: string;
  mgrRow: number | null;
  crmApprovalsTab: string;
  crmBloodTab: string;
  crmEscTab: string;
  modality: string;
  sets: number;
  showPrompt: boolean;
  rosterOpen: boolean;
  roleOpen: boolean;
  roadmap: Record<number, boolean[]>;
  onboardOpen: Record<string, boolean>;
  crmApproved: Record<string, 'forwarded' | 'parked'>;

  firstName: string;
  crmFirstName: string;
  history: string[];
  canGoBack: boolean;
  selectedClientId: string | null;
  selectedClientName: string | null;
  clientInitialTab: string | null;
  /** Deep-link target tab for the admin Requests page (consumed on mount). */
  adminRequestsTab: string | null;
  /** Deep-link target tab for the admin Performance page (consumed on mount). */
  adminPerfTab: string | null;
  openClient: (id: string, name: string, tab?: string) => void;
  workoutScheduleId: string | null;
  /** When set, the Workout form edits this queued (unsynced) outbox log in place. */
  editingOutboxId: string | null;
  /** When set, the Create Plan screen opens in EDIT mode for this plan (only the
      signed-in trainer's own rows of a possibly-shared plan). */
  editingPlan: {
    planId: string; planName: string; planDescription: string;
    durationWeeks: number; modality: string; rows: any[];
  } | null;
  openWorkout: (clientId: string, name: string, modality: string, scheduleId: string | null) => void;
  navDir: 'push' | 'back';
  aiOpen: boolean;
  openChatId: string | null;
  setOpenChat: (id: string | null) => void;
  crmSection: string | null; // which CRM workspace section the crm-section route shows
  threadViewOpen: boolean; // a client-thread chat is fullscreen → hide the floating home bar
  workoutTemplatesOpen: boolean; // sidebar "Workout Templates" → dashboard opens the sheet
  /** Tech Desk: which ticket the detail screens show. */
  selectedTicketId: string | null;

  go: (r: string, reset?: boolean) => void;
  back: () => void;
  resetSession: () => void; // sign-out / account switch: forget every per-user selection
  openAi: () => void;
  closeAi: () => void;
  set: (patch: Partial<Store>) => void;
  openDrawer: () => void;
  closeDrawer: () => void;
  openSheet: (s: SheetKind) => void;
  closeSheet: () => void;
  setDialog: (d: CrmDialog) => void;
  toggleRoadmap: (ci: number, si: number) => void;
  toggleOnboard: (id: string) => void;
  approve: (id: string) => void;
  reject: (id: string) => void;
};

/* The actions never change identity, so they live in their own context:
   a component that only needs to navigate / open a sheet can subscribe to
   `useStoreActions()` and stay untouched by every state change (drawer toggles,
   tab switches, route pushes) that re-renders every `useStore()` consumer. */
type StoreActions = Pick<Store,
  'go' | 'back' | 'set' | 'openClient' | 'openWorkout' | 'openAi' | 'closeAi' | 'setOpenChat' | 'openDrawer' | 'closeDrawer'
  | 'openSheet' | 'closeSheet' | 'setDialog' | 'toggleRoadmap' | 'toggleOnboard' | 'resetSession' | 'approve' | 'reject'>;

const Ctx = createContext<Store>(null as any);
const ActionsCtx = createContext<StoreActions>(null as any);
export const useStore = () => useContext(Ctx);
export const useStoreActions = () => useContext(ActionsCtx);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [s, setS] = useState({
    route: 'signin',
    role: 'crm' as Role, // temp default for CRM build-out

    drawerOpen: false,
    sheet: null as SheetKind,
    crmDialog: null as CrmDialog,
    clientsTab: 'active' as 'active' | 'inactive',
    qhpTab: 'upcoming',
    mgrTab: 'sessions',
    mgrDashTab: 'overall',
    mgrRow: 1 as number | null,
    crmApprovalsTab: 'sessions',
    crmBloodTab: 'all',
    crmEscTab: 'all',
    modality: 'strength',
    sets: 3,
    showPrompt: true,
    rosterOpen: false,
    roleOpen: false,
    roadmap: { 0: [true, true, true, true], 1: [true, true, false], 2: [true, false, false], 3: [false, false] } as Record<number, boolean[]>,
    onboardOpen: { aarav: true } as Record<string, boolean>,
    crmApproved: {} as Record<string, 'forwarded' | 'parked'>,
    history: [] as string[],
    navDir: 'push' as 'push' | 'back',
    aiOpen: false,
    selectedClientId: null as string | null,
    adminRequestsTab: null as string | null,
    adminPerfTab: null as string | null,
    selectedClientName: null as string | null,
    clientInitialTab: null as string | null,
    workoutScheduleId: null as string | null,
    editingOutboxId: null as string | null,
    editingPlan: null as any,
    openChatId: null as string | null,
    crmSection: null as string | null,
    threadViewOpen: false,
    workoutTemplatesOpen: false,
    selectedTicketId: null as string | null,
  });

  const set = useCallback((patch: any) => setS((prev) => ({ ...prev, ...patch })), []);
  // go() pushes the current route onto the history stack (unless navigating to the
  // same route, or reset=true which clears history — used right after sign-in).
  const go = useCallback(
    (route: string, reset = false) =>
      setS((prev) => ({
        ...prev,
        route,
        navDir: 'push',
        history: reset ? [] : route === prev.route ? prev.history : [...prev.history, prev.route],
        drawerOpen: false,
        sheet: null,
      })),
    []
  );
  // back() pops the last route off the stack. With an empty stack it falls back to
  // the role's dashboard instead of silently doing nothing (dead back buttons on
  // pages reached without a push — e.g. after a history reset).
  const back = useCallback(
    () =>
      setS((prev) => {
        if (prev.history.length === 0) {
          const home = homeRouteFor(prev.role);
          if (prev.route === home || prev.route === 'signin') return prev;
          return { ...prev, route: home, navDir: 'back', drawerOpen: false, sheet: null };
        }
        const h = [...prev.history];
        const route = h.pop() as string;
        return { ...prev, route, navDir: 'back', history: h, drawerOpen: false, sheet: null };
      }),
    []
  );

  // Built once: every action closes over the stable setS/set, never over `s`.
  const actions = useMemo<StoreActions>(
    () => ({
      go,
      back,
      set,
      // Same-route dedupe (like go()): two taps in one frame must not push
      // 'client' onto 'client' — swiping back onto an unchanged route left the
      // page translated off-canvas.
      openClient: (id: string, name: string, tab?: string) =>
        setS((prev) => ({ ...prev, selectedClientId: id, selectedClientName: name, clientInitialTab: tab ?? null, route: 'client', navDir: 'push', history: prev.route === 'client' ? prev.history : [...prev.history, prev.route], drawerOpen: false, sheet: null })),
      openWorkout: (clientId: string, name: string, modality: string, scheduleId: string | null) =>
        setS((prev) => ({ ...prev, selectedClientId: clientId, selectedClientName: name, modality: modality || prev.modality, workoutScheduleId: scheduleId, editingOutboxId: null, route: 'workout', navDir: 'push', history: prev.route === 'workout' ? prev.history : [...prev.history, prev.route], drawerOpen: false, sheet: null })),
      openAi: () => set({ aiOpen: true }),
      closeAi: () => set({ aiOpen: false }),
      setOpenChat: (openChatId: string | null) => set({ openChatId }),
      openDrawer: () => set({ drawerOpen: true }),
      closeDrawer: () => set({ drawerOpen: false }),
      openSheet: (sheet: SheetKind) => set({ sheet }),
      closeSheet: () => set({ sheet: null }),
      setDialog: (crmDialog: CrmDialog) => set({ crmDialog }),
      toggleRoadmap: (ci: number, si: number) =>
        setS((prev) => {
          const r = JSON.parse(JSON.stringify(prev.roadmap));
          r[ci][si] = !r[ci][si];
          return { ...prev, roadmap: r };
        }),
      toggleOnboard: (id: string) => setS((prev) => ({ ...prev, onboardOpen: { ...prev.onboardOpen, [id]: !prev.onboardOpen[id] } })),
      // Per-user state that must not leak to the next account on this device.
      resetSession: () => setS((prev) => ({
        ...prev, history: [], drawerOpen: false, aiOpen: false, sheet: null, crmDialog: null,
        selectedClientId: null, selectedClientName: null, clientInitialTab: null, workoutScheduleId: null,
        editingOutboxId: null, editingPlan: null, openChatId: null, crmSection: null, threadViewOpen: false, workoutTemplatesOpen: false, selectedTicketId: null,
      })),
      approve: (id: string) => setS((prev) => ({ ...prev, crmApproved: { ...prev.crmApproved, [id]: 'forwarded' }, crmDialog: null })),
      reject: (id: string) => setS((prev) => ({ ...prev, crmApproved: { ...prev.crmApproved, [id]: 'parked' }, crmDialog: null })),
    }),
    [go, back, set]
  );

  const value = useMemo<Store>(
    () => ({
      ...s,
      // Neutral fallbacks only — real names come from the profile query. (These
      // were prototype placeholders; 'Divya' leaked into the UI whenever the
      // profile hadn't loaded, looking like the wrong account.)
      firstName: '',
      crmFirstName: '',
      canGoBack: s.history.length > 0,
      ...actions,
    }),
    [s, actions]
  );

  return (
    <ActionsCtx.Provider value={actions}>
      <Ctx.Provider value={value}>{children}</Ctx.Provider>
    </ActionsCtx.Provider>
  );
}
