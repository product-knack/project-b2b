import { useMutation, useQuery, useQueryClient, QueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { withTimeout, NET_MS } from './withTimeout';
import { invokeFn } from './doctorQueries';

/* ============ Consultant doctor: booked slots, calls, prescriptions ============
   Port of hub-track hooks/useConsultationSlots.ts plus the query halves of
   pages/doctor/ConsultantDashboard.tsx and ConsultantCalls.tsx (22 Sep 2026).
   Same table (doctor_consultation_details), the same SELECT string, the same
   query keys and stale times, so the two apps read the same rows the same way.

   WRITE RULES (guard triggers on the table): the app writes `status` directly
   (Complete) and nothing else. `prescription`, `edit_history`,
   `prescription_approval`, `next_follow_up`, `ai_notes`, `meeting_summary` are
   RPC- or edge-function-maintained; the after-call edit goes through
   amend_prescription and leaving a call through consultation_call_ended.
   Keys are per user and NOT in PERSIST_PREFIXES; no realtime channel (the
   web's channel may receive nothing either, doc s10), the 60 s poll covers. */

export type SlotStatus = 'scheduled' | 'completed' | 'cancelled';

/* ---------- prescription jsonb (doctor_consultation_details.prescription) ---------- */
export interface RxMedicineLine {
  line_id: string;
  medicine_id: string | null;
  name: string;
  strength: string | null;
  dose_amount: string;
  frequency: string;
  timing: string;
  duration_value: number | null;
  duration_unit: string;
  is_sos: boolean;
  instruction: string;
  sort_order: number;
}
export interface RxData {
  schema_version?: number;
  status: 'draft' | 'finalized';
  version?: number;
  date?: string;
  finalized_at?: string;
  updated_at?: string;
  doctor?: { id: string; name: string };
  patient?: { name: string; dob: string | null; age: number | null };
  medicines: RxMedicineLine[];
  lab_tests: Array<{ line_id: string; name: string; test_id?: string | null; sort_order: number }>;
  advice: Array<{ line_id: string; text: string; sort_order: number }>;
  follow_up?: { after_value: number | null; after_unit: string; note: string };
  history?: unknown[];
  last_edited_by?: string;
  last_edited_at?: string;
}
/** prescription_approval: the CRM's approval; once set the prescription is locked and the client sees it. */
export interface RxApproval {
  approved: boolean;
  approved_at: string;
  approved_by: string | null;
  approved_by_name: string | null;
  approved_by_role: string | null;
  version: number | null;
  note: string | null;
}
/** One entry of edit_history (RPC-maintained). */
export interface RxEditEntry {
  id: string;
  at: string;
  editor_id: string | null;
  editor_name: string | null;
  editor_role: string | null;
  action: 'finalize' | 'amend' | 'approve';
  from_version: number | null;
  to_version: number | null;
  note: string | null;
  medicines_before: string[];
  medicines_after: string[];
  tests_before: string[];
  tests_after: string[];
}
/** meeting_summary, written by consult-meeting-summary; every field optional (no guard trigger). */
export interface MeetingSummary {
  key_takeaways?: { title: string; text: string }[];
  sections?: { heading: string; overview?: string; timestamp?: string; points?: { text: string; subpoints?: string[] }[] }[];
  action_items?: { person: string; items: { text: string; timestamp?: string }[] }[];
  generated_at?: string;
}
/** ai_notes, written by consult-ai-notes. */
export interface ConsultAINotes {
  short_summary?: string;
  summary_points?: string[];
  clinical_impression?: string;
  red_flags?: string[];
  tests_suggested?: string[];
  recommendations?: string[];
  medications?: Array<{ name: string; reason?: string; dosage_note?: string }>;
  generated_at?: string;
}

export type PersonName = { first_name: string | null; last_name: string | null } | null;

export interface ConsultationSlot {
  id: string;
  client_id: string;
  doctor_id: string;
  booked_by: string | null;
  consultation_date: string; // yyyy-MM-dd (plain date)
  start_time: string; // HH:mm:ss
  end_time: string;
  description: string | null;
  meet_url: string | null;
  status: SlotStatus;
  created_at: string;
  next_follow_up: unknown;
  prescription: RxData | null;
  prescription_approval: RxApproval | null;
  doctor: PersonName;
  client: PersonName;
}
/** All Calls row: the slot plus the three after-call columns. */
export interface CallRow extends ConsultationSlot {
  ai_notes: ConsultAINotes | null;
  meeting_summary: MeetingSummary | null;
  edit_history: RxEditEntry[] | null;
}
/** medical_diagnosis request (the older "book a doctor" flow), matched by the doctor's name. */
export interface DiagnosisRow {
  id: string;
  client_id: string;
  problem_statement: string;
  status: string; // pending | scheduled | completed | cancelled
  scheduled_at: string | null;
  completed_at: string | null;
  assigned_doctor: string | null;
  created_at: string;
}
export interface MedicineItem {
  id: string;
  name: string;
  strength: string | null;
  item_type: 'medicine' | 'blood_test' | string;
  form?: string | null;
  generic_name?: string | null;
  category?: string | null;
}

/** Verbatim copy of the web SLOT_SELECT (hooks/useConsultationSlots.ts). */
export const SLOT_SELECT =
  'id, client_id, doctor_id, booked_by, consultation_date, start_time, end_time, description, meet_url, status, created_at, next_follow_up, prescription, prescription_approval, doctor:profiles!doctor_consultation_details_doctor_id_fkey(first_name, last_name), client:clients!doctor_consultation_details_client_id_fkey(first_name, last_name)';

/* ---------- pure helpers (date-fns free) ---------- */
export const pad2 = (n: number) => String(n).padStart(2, '0');
export const ymdLocal = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
/** Local midnight of a plain date, like date-fns parseISO('yyyy-MM-dd'). */
export const dateFromYmd = (ymd: string) => {
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};
export const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
export const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
/** Sunday-first start of the week holding d. */
export const startOfWeekSun = (d: Date) => addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()), -d.getDay());
/** Monday-first start of the week (All Calls "This week", web weekStartsOn 1). */
export const startOfWeekMon = (d: Date) => addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()), -((d.getDay() + 6) % 7));
export const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** "7:30 PM" from "19:30:00". */
export const timeLabel = (t: string) => {
  const [h, m] = (t || '').split(':').map(Number);
  if (!Number.isFinite(h)) return (t || '').slice(0, 5);
  const ap = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${pad2(m || 0)} ${ap}`;
};
/** "h:mm a" of a Date (local). */
export const clockLabel = (d: Date) => `${d.getHours() % 12 === 0 ? 12 : d.getHours() % 12}:${pad2(d.getMinutes())} ${d.getHours() >= 12 ? 'PM' : 'AM'}`;
/** "EEE, d MMM yyyy" of a plain date. */
export const fmtLongDate = (ymd: string) => { const d = dateFromYmd(ymd); return `${DAYS_SHORT[d.getDay()]}, ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`; };
/** "d MMM" of a plain date. */
export const fmtDayMonth = (ymd: string) => { const d = dateFromYmd(ymd); return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`; };
/** "MMM d, yyyy · h:mm a" (the dashboard clock). */
export const fmtStampLocal = (d: Date) => `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} · ${clockLabel(d)}`;
/** "dd-MMM-yyyy h:mm a" in IST (the record views' generated_at stamps). */
export const istStamp = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')}-${get('month')}-${get('year')} ${get('hour')}:${get('minute')} ${get('dayPeriod').toUpperCase()}`;
};
/** IST calendar day of an instant, yyyy-MM-dd. */
export const istYmdOf = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));

export const slotPersonName = (p: PersonName): string => [p?.first_name, p?.last_name].filter(Boolean).join(' ').trim() || 'Unknown';
/** Scheduled and the end time (device local, like the web) has passed. */
export const isSlotElapsed = (s: Pick<ConsultationSlot, 'status' | 'consultation_date' | 'end_time'>, now: number = Date.now()) =>
  s.status === 'scheduled' && new Date(`${s.consultation_date}T${s.end_time}`).getTime() < now;

export const rxState = (rx: RxData | null | undefined): 'none' | 'draft' | 'finalized' => {
  if (!rx || !Array.isArray(rx.medicines)) return 'none';
  const hasContent = rx.medicines.some((m) => (m?.name ?? '').trim() !== '') || (rx.lab_tests?.length ?? 0) > 0 || (rx.advice?.length ?? 0) > 0;
  if (rx.status === 'finalized') return 'finalized';
  return hasContent ? 'draft' : 'none';
};
export const isRxApproved = (a: RxApproval | null | undefined): boolean => a?.approved === true;
export const hasMeetingNotes = (s: MeetingSummary | null | undefined): boolean =>
  !!s && ((s.key_takeaways?.length ?? 0) > 0 || (s.sections?.length ?? 0) > 0 || (s.action_items?.length ?? 0) > 0);
export const hasAiNotes = (n: ConsultAINotes | null | undefined): boolean =>
  !!n && (!!n.short_summary || (n.summary_points?.length ?? 0) > 0 || !!n.clinical_impression || (n.red_flags?.length ?? 0) > 0
    || (n.recommendations?.length ?? 0) > 0 || (n.tests_suggested?.length ?? 0) > 0 || (n.medications?.length ?? 0) > 0);

/* ---------- next_follow_up (port of lib/consultationFollowUp.ts) ---------- */
export interface NextFollowUp { status: 'date' | 'not_decided'; date: string | null; note: string | null; by: string; by_name: string | null; by_role: string | null; at: string }
export const parseNextFollowUp = (raw: unknown): NextFollowUp | null => {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const status = r.status === 'date' || r.status === 'not_decided' ? r.status : null;
  if (!status) return null;
  return {
    status,
    date: typeof r.date === 'string' && r.date ? r.date.slice(0, 10) : null,
    note: typeof r.note === 'string' && r.note ? r.note : null,
    by: typeof r.by === 'string' ? r.by : '',
    by_name: typeof r.by_name === 'string' ? r.by_name : null,
    by_role: typeof r.by_role === 'string' ? r.by_role : null,
    at: typeof r.at === 'string' ? r.at : '',
  };
};
/** "15 Sep 2026" or "Not decided yet". */
export const followUpLabel = (fu: NextFollowUp | null | undefined): string => {
  if (!fu) return 'Not recorded';
  if (fu.status === 'date' && fu.date) { const d = dateFromYmd(fu.date); return `${pad2(d.getDate())} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`; }
  return 'Not decided yet';
};

/* ---------- reads ---------- */
const run = <T,>(q: any, label: string): Promise<{ data: T; error: any }> => withTimeout<any>(Promise.resolve(q) as Promise<any>, NET_MS, label);

/** The doctor's bookings, date asc (dashboard). Key + 60 s poll as on the web. */
export function useDoctorConsultationSlots(doctorId: string | null | undefined) {
  return useQuery({
    queryKey: ['doctor-consultation-slots', doctorId],
    enabled: !!doctorId,
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async (): Promise<ConsultationSlot[]> => {
      const { data, error } = await run<any[]>(
        supabase.from('doctor_consultation_details').select(SLOT_SELECT).eq('doctor_id', doctorId).order('consultation_date', { ascending: true }).order('start_time', { ascending: true }),
        'Consultations');
      if (error) throw error;
      return (data ?? []) as ConsultationSlot[];
    },
  });
}

/** Every booking with the after-call columns, newest first (All Calls). Shares the key prefix on purpose. */
export function useDoctorCalls(doctorId: string | null | undefined) {
  return useQuery({
    queryKey: ['doctor-consultation-slots', doctorId, 'with-rx'],
    enabled: !!doctorId,
    staleTime: 30_000,
    queryFn: async (): Promise<CallRow[]> => {
      const { data, error } = await run<any[]>(
        supabase.from('doctor_consultation_details').select(`${SLOT_SELECT}, ai_notes, meeting_summary, edit_history`).eq('doctor_id', doctorId)
          .order('consultation_date', { ascending: false }).order('start_time', { ascending: false }),
        'Calls');
      if (error) throw error;
      return (data ?? []) as CallRow[];
    },
  });
}

/** medical_diagnosis requests naming this doctor (free-typed assigned_doctor; full name or surname, "Dr." ignored). */
export function useConsultantConsultations(doctorName: string) {
  return useQuery({
    queryKey: ['consultant-dashboard', doctorName],
    enabled: doctorName.trim().length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<{ consultations: DiagnosisRow[]; clientNames: Record<string, string> }> => {
      const { data, error } = await run<any[]>(
        supabase.from('medical_diagnosis').select('id, client_id, problem_statement, status, scheduled_at, completed_at, assigned_doctor, created_at')
          .not('assigned_doctor', 'is', null).order('scheduled_at', { ascending: true }),
        'Consultation requests');
      if (error) throw error;
      const strip = (s: string) => s.toLowerCase().replace(/\bdr\.?(?:\s+|$)/g, '').trim();
      const full = strip(doctorName);
      const surname = full.split(/\s+/).filter(Boolean).pop() ?? '';
      const mine = ((data ?? []) as DiagnosisRow[]).filter((d) => {
        const who = strip(d.assigned_doctor ?? '');
        return !!full && (who.includes(full) || (surname.length >= 3 && who.includes(surname)));
      });
      const ids = Array.from(new Set(mine.map((d) => d.client_id).filter(Boolean)));
      const clientNames: Record<string, string> = {};
      for (let i = 0; i < ids.length; i += 100) {
        const { data: cs, error: ce } = await run<any[]>(supabase.from('clients').select('id, first_name, last_name').in('id', ids.slice(i, i + 100)), 'Clients');
        if (ce) throw ce;
        for (const c of cs ?? []) clientNames[c.id] = [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || 'Client';
      }
      return { consultations: mine, clientNames };
    },
  });
}

/** The active medicines catalog (item_type medicine | blood_test), 5 min. */
export function useMedicinesCatalog(enabled = true) {
  return useQuery({
    queryKey: ['medicines-catalog'],
    enabled,
    staleTime: 300_000,
    queryFn: async (): Promise<MedicineItem[]> => {
      const { data, error } = await run<any[]>(supabase.from('medicines').select('*').eq('is_active', true).order('name', { ascending: true }), 'Medicines');
      if (error) throw error;
      return (data ?? []) as MedicineItem[];
    },
  });
}

/** clients.date_of_birth for the frozen patient block of an amended prescription. */
export function useClientDob(clientId: string | null | undefined) {
  return useQuery({
    queryKey: ['consult-client-dob', clientId],
    enabled: !!clientId,
    staleTime: 600_000,
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await run<any>(supabase.from('clients').select('date_of_birth').eq('id', clientId).maybeSingle(), 'Client');
      if (error) throw error;
      return (data?.date_of_birth as string | null) ?? null;
    },
  });
}

/* ---------- writes ---------- */
export const invalidateSlots = (qc: QueryClient) => {
  for (const k of ['consultation-slots', 'doctor-consultation-slots', 'consultation-slots-for-clients', 'consultation-room-slot', 'consultant-dashboard']) {
    qc.invalidateQueries({ queryKey: [k] });
  }
};

/** Complete (or cancel) a booking: the one direct column write the app makes. */
export function useUpdateSlotStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: SlotStatus }) => {
      const { error } = await run<any>(supabase.from('doctor_consultation_details').update({ status }).eq('id', id), 'Update');
      if (error) throw error;
    },
    onSuccess: () => invalidateSlots(qc),
  });
}

/** Ask the edge function to create the 100ms room and meet_url for a booking that has none. */
export function useProvisionRoom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (slotId: string) => {
      const res = await invokeFn('provision-consultation-room', { slotId });
      if (res.error) throw res.error;
      if ((res.data as any)?.ok === false) throw new Error(String((res.data as any)?.error ?? 'Could not create the video link'));
      return res.data;
    },
    onSuccess: () => invalidateSlots(qc),
  });
}

/** After-call prescription edit (doctor or CRM). Returns the saved prescription and the edit trail. */
export function useAmendPrescription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { slotId: string; payload: RxData; note: string | null }): Promise<{ prescription: RxData; edit_history: RxEditEntry[] }> => {
      const { data, error } = await run<any>(supabase.rpc('amend_prescription', { p_slot_id: v.slotId, p_payload: v.payload, p_note: v.note }), 'Save prescription');
      if (error) throw error;
      return data as { prescription: RxData; edit_history: RxEditEntry[] };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['doctor-consultation-slots'] }),
  });
}

/** The doctor left the call: starts the AI notes and meeting summary in the background (SQL decides what to generate). */
export function useCallEnded() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (slotId: string) => {
      const { data, error } = await run<any>(supabase.rpc('consultation_call_ended', { p_slot_id: slotId }), 'Call ended');
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateSlots(qc),
  });
}

/** Handoff for the Join screen (set before go('doctor-consultation-join'), cleared on leave). */
export const joinTargetRef: { current: { slotId: string; url: string; clientName: string } | null } = { current: null };

/* ---------- counting rules (web ConsultantDashboard, since 2026-09-17) ---------- */
export interface ConsultantStats {
  pendingCount: number; scheduledCount: number; elapsedCount: number; completedCount: number; completedThisMonth: number;
  pendingRequests: number; todayTotal: number; todayDone: number; busyness: number; total: number; activeTotal: number;
}
/**
 * The active set (non-cancelled slots + non-cancelled diagnosis rows) is
 * partitioned into upcoming, elapsed, completed and pending requests, so the
 * Scheduled card, the bars, the bell and All Calls agree.
 */
export function computeConsultantStats(slots: ConsultationSlot[], consultations: DiagnosisRow[], now: Date = new Date()): ConsultantStats {
  const nowMs = now.getTime();
  const diagActive = consultations.filter((d) => d.status !== 'cancelled');
  const pending = diagActive.filter((d) => d.status === 'pending');
  const completed = diagActive.filter((d) => d.status === 'completed');
  const scheduledDiag = diagActive.filter((d) => d.status === 'scheduled');
  const diagElapsed = scheduledDiag.filter((d) => { const t = d.scheduled_at ? new Date(d.scheduled_at).getTime() : NaN; return Number.isFinite(t) && t < nowMs; });
  const diagUpcoming = scheduledDiag.filter((d) => !diagElapsed.includes(d));
  const activeSlots = slots.filter((s) => s.status !== 'cancelled');
  const slotsElapsed = activeSlots.filter((s) => isSlotElapsed(s, nowMs));
  const slotsUpcoming = activeSlots.filter((s) => s.status === 'scheduled' && !isSlotElapsed(s, nowMs));
  const slotsCompleted = activeSlots.filter((s) => s.status === 'completed');
  const month = ymdLocal(now).slice(0, 7);
  const completedThisMonth =
    completed.filter((d) => { const ts = d.completed_at ?? d.scheduled_at; if (!ts) return false; const dt = new Date(ts); return !isNaN(dt.getTime()) && ymdLocal(dt).slice(0, 7) === month; }).length
    + slotsCompleted.filter((s) => s.consultation_date.slice(0, 7) === month).length;
  const todaysEvents = consultations.filter((d) => d.scheduled_at && sameDay(new Date(d.scheduled_at), now));
  const todaysDone = todaysEvents.filter((d) => d.status === 'completed');
  const todaysSlots = activeSlots.filter((s) => sameDay(dateFromYmd(s.consultation_date), now));
  const todaysSlotsDone = todaysSlots.filter((s) => s.status === 'completed');
  const todayTotal = todaysEvents.length + todaysSlots.length;
  const todayDone = todaysDone.length + todaysSlotsDone.length;
  return {
    pendingCount: pending.length + slotsElapsed.length + diagElapsed.length,
    scheduledCount: diagUpcoming.length + slotsUpcoming.length,
    elapsedCount: slotsElapsed.length + diagElapsed.length,
    completedCount: completed.length + slotsCompleted.length,
    completedThisMonth,
    pendingRequests: pending.length,
    todayTotal, todayDone,
    busyness: todayTotal > 0 ? (todayDone / todayTotal) * 100 : 0,
    total: diagActive.length + activeSlots.length || 1,
    activeTotal: diagActive.length + activeSlots.length,
  };
}

export interface DayCounts { total: number; done: number; elapsed: number; upcoming: number }
/** Per-day counts for the month grid (web ConsultantCalendarDialog). */
export function dayCountsOf(slots: ConsultationSlot[], consultations: DiagnosisRow[], now: number = Date.now()): Record<string, DayCounts> {
  const map: Record<string, DayCounts> = {};
  const bump = (key: string, kind: 'done' | 'elapsed' | 'upcoming') => {
    const c = map[key] ?? { total: 0, done: 0, elapsed: 0, upcoming: 0 };
    c.total += 1; c[kind] += 1; map[key] = c;
  };
  for (const s of slots) { if (s.status === 'cancelled') continue; bump(s.consultation_date, s.status === 'completed' ? 'done' : isSlotElapsed(s, now) ? 'elapsed' : 'upcoming'); }
  for (const e of consultations) {
    if (e.status === 'cancelled' || !e.scheduled_at) continue;
    const d = new Date(e.scheduled_at); if (isNaN(d.getTime())) continue;
    bump(ymdLocal(d), e.status === 'completed' ? 'done' : e.status === 'pending' ? 'elapsed' : 'upcoming');
  }
  return map;
}

/** Plain-English reason for a failed call, naming the migration the web ships when the trigger is the cause. */
export function describeConsultError(error: unknown): string {
  const e = error as { code?: string; message?: string; name?: string } | null;
  const msg = e?.message ?? '';
  if (/malformed array literal/i.test(msg)) return 'Marking complete failed inside the autogenerate trigger. Ask the admin to run migration 20260921160000_consult_autogen_fix.sql in the SQL editor, then retry.';
  if (/Booking not found/i.test(msg)) return 'This booking no longer exists. Pull to refresh.';
  if (e?.code === '42501' || /row-level security|not allowed|not authori[sz]ed/i.test(msg)) return 'You are not allowed to do this. Sign in again and retry.';
  if (e?.name === 'TimeoutError') return 'The network is slow right now. Check your connection and try again.';
  return msg || 'Something went wrong. Please try again.';
}
