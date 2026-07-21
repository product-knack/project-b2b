import React, { createContext, useContext, useMemo, useState, useCallback } from 'react';

export type Role = 'trainer' | 'crm' | 'coach' | 'ops' | 'admin' | 'doctor' | 'marketing';
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
  openClient: (id: string, name: string, tab?: string) => void;
  workoutScheduleId: string | null;
  /** When set, the Workout form edits this queued (unsynced) outbox log in place. */
  editingOutboxId: string | null;
  openWorkout: (clientId: string, name: string, modality: string, scheduleId: string | null) => void;
  navDir: 'push' | 'back';
  aiOpen: boolean;
  openChatId: string | null;
  setOpenChat: (id: string | null) => void;
  crmSection: string | null; // which CRM workspace section the crm-section route shows
  threadViewOpen: boolean; // a client-thread chat is fullscreen → hide the floating home bar
  workoutTemplatesOpen: boolean; // sidebar "Workout Templates" → dashboard opens the sheet

  go: (r: string, reset?: boolean) => void;
  back: () => void;
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

const Ctx = createContext<Store>(null as any);
export const useStore = () => useContext(Ctx);

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
    selectedClientName: null as string | null,
    clientInitialTab: null as string | null,
    workoutScheduleId: null as string | null,
    editingOutboxId: null as string | null,
    openChatId: null as string | null,
    crmSection: null as string | null,
    threadViewOpen: false,
    workoutTemplatesOpen: false,
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
          const home =
            prev.role === 'crm' ? 'crm-dashboard'
            : prev.role === 'coach' ? 'coach-dashboard'
            : prev.role === 'ops' ? 'ops-dashboard'
            : prev.role === 'admin' ? 'admin-dashboard'
            : prev.role === 'doctor' ? 'doctor-dashboard'
            : prev.role === 'marketing' ? 'marketing-dashboard'
            : 'dashboard';
          if (prev.route === home || prev.route === 'signin') return prev;
          return { ...prev, route: home, navDir: 'back', drawerOpen: false, sheet: null };
        }
        const h = [...prev.history];
        const route = h.pop() as string;
        return { ...prev, route, navDir: 'back', history: h, drawerOpen: false, sheet: null };
      }),
    []
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
      go,
      back,
      set,
      openClient: (id: string, name: string, tab?: string) =>
        setS((prev) => ({ ...prev, selectedClientId: id, selectedClientName: name, clientInitialTab: tab ?? null, route: 'client', navDir: 'push', history: [...prev.history, prev.route], drawerOpen: false, sheet: null })),
      openWorkout: (clientId: string, name: string, modality: string, scheduleId: string | null) =>
        setS((prev) => ({ ...prev, selectedClientId: clientId, selectedClientName: name, modality: modality || prev.modality, workoutScheduleId: scheduleId, editingOutboxId: null, route: 'workout', navDir: 'push', history: [...prev.history, prev.route], drawerOpen: false, sheet: null })),
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
      approve: (id: string) => setS((prev) => ({ ...prev, crmApproved: { ...prev.crmApproved, [id]: 'forwarded' }, crmDialog: null })),
      reject: (id: string) => setS((prev) => ({ ...prev, crmApproved: { ...prev.crmApproved, [id]: 'parked' }, crmDialog: null })),
    }),
    [s, go, back, set]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
