import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { useAuth } from '../auth';

/* ============ DOCTOR WORKSPACE DATA LAYER ============
   Verbatim port of the web /doctor/* hooks (usePhysiotherapistMetrics,
   useSeniorPhysiotherapistDashboardData, useDoctorSessions, useNeuralCheck,
   usePhysioProtocols, useHeadDoctorRosterManagement, useDoctorClientSessionCounts,
   PhysioSessionDialog submit pipeline). Do not change payloads without re-checking
   the web source — several column mappings are non-obvious (e.g. RLT temperature
   is stored in physio_session_exercises.modality_frequency). */

/* ---------- Hardcoded identities (web contract — do NOT parameterize) ---------- */
export const HEAD_DOCTOR_ID = '30df5c2b-0f40-4736-9f41-7cbc830a191a';
export const ALLOWED_DOCTOR_IDS = [HEAD_DOCTOR_ID, '0447fc2d-92be-4885-bf2c-ab7a505e44d3'];
export const FULL_ACCESS_PHYSIO_IDS = [HEAD_DOCTOR_ID];

/* ---------- Canonical session-type whitelist (mirrors src/lib/doctorSessionTypes.ts) ---------- */
export const DOCTOR_SESSION_TYPES = [
  'rehabilitation', 'physiotherapy', 'massage_therapy', 'red_light_therapy',
  'cold_bath_therapy', 'pneumatic_therapy', 'cupping_therapy', 'dry_needling',
  'cryotherapy', 'pneumatic_compression_therapy', 'cognitive_entrainment_device',
  'pemf_mat_therapy', 'mayo_facial_release', 'tapping', 'stretching',
  'strengthening_exercises', 'manual_releases', 'neural_check', 'other', 'recovery',
] as const;
export const DOCTOR_ROSTER_CREATE_MODALITIES = ['rehabilitation', 'recovery'] as const;
/* RehabSessionsSection uses this NARROWER list (web parity). */
export const REHAB_SESSION_TYPES = [
  'physiotherapy', 'rehabilitation', 'massage_therapy', 'red_light_therapy',
  'cold_bath_therapy', 'pneumatic_therapy', 'cupping_therapy', 'dry_needling', 'cryotherapy',
] as const;
export const RECOVERY_MODALITIES = [
  { value: 'red_light_therapy', label: 'Red Light Therapy' },
  { value: 'pneumatic_compression', label: 'Pneumatic Compression' },
  { value: 'cognitive_entrainment', label: 'Cognitive Entrainment' },
  { value: 'manual_release', label: 'Manual Release' },
  { value: 'dry_needling', label: 'Dry Needling' },
  { value: 'pemf_mat_therapy', label: 'PEMF Mat' },
] as const;
export const COGNITIVE_TRAINING_TYPES = ['SMR', 'Delta', 'Theta', 'Motherhood', 'Alpha', 'Gamma', 'Beta', 'Piano', 'Breath Work', 'Musical'] as const;

const ACRONYMS = new Set(['pemf']);
export const formatDoctorSessionType = (type: string | null | undefined) =>
  (type ?? '').split('_').map((w) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1))).join(' ') || '—';

export const personName = (p: any) => `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || 'Unknown';

/* functions.invoke can keep the anon-key Authorization header when the session was
   RESTORED from storage (vs a fresh sign-in) — the edge fn then replies "Unauthorized".
   Always attach the live access token; getSession() refreshes an expired one first.
   Extra hardening: on cold start AsyncStorage may not have hydrated yet (null session),
   so wait once; and if the fn still says Unauthorized, force-refresh and retry once. */
async function invokeFn(name: string, body: any) {
  let { data } = await supabase.auth.getSession();
  if (!data.session) {
    await new Promise((r) => setTimeout(r, 450));
    ({ data } = await supabase.auth.getSession());
  }
  let token = data.session?.access_token;
  let res = await supabase.functions.invoke(name, { body, ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}) });
  const saysUnauthorized = !res.error && (res.data as any)?.ok === false && /unauthori[sz]ed/i.test(String((res.data as any)?.error ?? ''));
  if (saysUnauthorized) {
    const { data: refreshed } = await supabase.auth.refreshSession();
    token = refreshed.session?.access_token;
    if (token) res = await supabase.functions.invoke(name, { body, headers: { Authorization: `Bearer ${token}` } });
  }
  return res;
}

/* ---------- IST boundaries (web uses date-fns-tz; IST is fixed +05:30, no DST) ---------- */
const IST_OFFSET_MS = 5.5 * 3600 * 1000;
const istYmd = (d: Date) => {
  const [y, m, day] = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).split('-').map(Number);
  return { y, m: m - 1, day };
};
export const istDayBoundsUTC = (d: Date) => {
  const { y, m, day } = istYmd(d);
  return {
    startISO: new Date(Date.UTC(y, m, day) - IST_OFFSET_MS).toISOString(),
    endISO: new Date(Date.UTC(y, m, day + 1) - IST_OFFSET_MS).toISOString(),
  };
};
export const istMonthBoundsUTC = (d: Date) => {
  const { y, m } = istYmd(d);
  return {
    startISO: new Date(Date.UTC(y, m, 1) - IST_OFFSET_MS).toISOString(),
    endISO: new Date(Date.UTC(y, m + 1, 1) - IST_OFFSET_MS).toISOString(),
  };
};

/* ---------- Identity: role flags for the signed-in doctor ---------- */
export type DoctorIdentity = { isPhysio: boolean; isNutritionist: boolean; isHeadDoctor: boolean; specialization: string | null };
export function useDoctorIdentity(): { data: DoctorIdentity; isLoading: boolean } {
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;
  const q = useQuery({
    queryKey: ['doctor-identity', uid],
    enabled: !!uid,
    staleTime: 600_000,
    queryFn: async (): Promise<DoctorIdentity> => {
      const { data, error } = await supabase.from('profiles').select('doctor_specialization_tag').eq('id', uid).maybeSingle();
      if (error) throw new Error(error.message);
      const tag = (data as any)?.doctor_specialization_tag ?? null;
      return { isPhysio: tag === 'physiotherapist', isNutritionist: tag === 'nutritionist', isHeadDoctor: uid === HEAD_DOCTOR_ID, specialization: tag };
    },
  });
  return { data: q.data ?? { isPhysio: false, isNutritionist: false, isHeadDoctor: uid === HEAD_DOCTOR_ID, specialization: null }, isLoading: q.isLoading };
}

/* ---------- Dashboard: personal metrics (web usePhysiotherapistMetrics) ---------- */
export function usePhysioMetrics(doctorId: string | null, selectedMonth: Date) {
  const month = istMonthBoundsUTC(selectedMonth);
  const day = istDayBoundsUTC(new Date());
  const monthlyQ = useQuery({
    queryKey: ['physiotherapist-monthly-sessions', doctorId, month.startISO],
    enabled: !!doctorId,
    queryFn: async () => {
      const { count, error } = await supabase.from('training_sessions').select('id', { count: 'exact', head: true })
        .eq('trainer_id', doctorId).gte('scheduled_at', month.startISO).lt('scheduled_at', month.endISO);
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
  });
  const todayQ = useQuery({
    queryKey: ['physiotherapist-today-sessions', doctorId, day.startISO],
    enabled: !!doctorId,
    queryFn: async () => {
      const { count, error } = await supabase.from('training_sessions').select('id', { count: 'exact', head: true })
        .eq('trainer_id', doctorId).gte('scheduled_at', day.startISO).lt('scheduled_at', day.endISO);
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
  });
  return { monthlySessions: monthlyQ.data ?? 0, todaySessions: todayQ.data ?? 0, isLoading: monthlyQ.isPending || todayQ.isPending };
}

/* ---------- Dashboard: senior/HOD data via edge fn (web useSeniorPhysiotherapistDashboardData) ----------
   The edge fn itself rejects everyone except the HEAD doctor with {ok:false,error:'Forbidden'}. */
export type SeniorLeaderboardEntry = { id: string; name: string; sessions: number; acknowledged: number };
export type TodayDoctorEntry = { id: string; name: string; sessions: number };
export type SeniorDashboardData = { monthlyCount: number; todayCount: number; leaderboard: SeniorLeaderboardEntry[]; todayByDoctor: TodayDoctorEntry[] };
export function useSeniorDashboard(selectedMonth: Date, enabled: boolean, selectedDay?: Date | null) {
  const month = istMonthBoundsUTC(selectedMonth);
  const rangeStart = selectedDay ? istDayBoundsUTC(selectedDay).startISO : month.startISO;
  const rangeEnd = selectedDay ? istDayBoundsUTC(selectedDay).endISO : month.endISO;
  const day = istDayBoundsUTC(new Date());
  return useQuery({
    queryKey: ['senior-physio-dashboard', rangeStart, rangeEnd, day.startISO],
    enabled,
    // web staleTime is 0 — always refetch on mount so the HOD numbers are live
    queryFn: async (): Promise<SeniorDashboardData> => {
      const { data, error } = await invokeFn('physio-senior-dashboard', {
        monthStartUTC: rangeStart, nextMonthStartUTC: rangeEnd, dayStartUTC: day.startISO, nextDayStartUTC: day.endISO,
      });
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error ?? 'Failed to load senior physio dashboard');
      return {
        monthlyCount: data.monthlyCount ?? 0,
        todayCount: data.todayCount ?? 0,
        leaderboard: data.leaderboard ?? [],
        todayByDoctor: data.todayByDoctor ?? [],
      };
    },
  });
}

/* ---------- Run rate: month-to-date sessions per doctor + month-end projection ----------
   projected = (sessions so far ÷ IST days elapsed) × days in month. Visible to every
   doctor (direct training_sessions reads — no HOD-gated edge fn involved). */
export type DoctorRunRateRow = { id: string; name: string; current: number; perDay: number; projected: number };
export type DoctorsRunRate = { daysElapsed: number; daysInMonth: number; rows: DoctorRunRateRow[] };
export function useDoctorsRunRate(enabled = true) {
  return useQuery({
    queryKey: ['doctors-run-rate'],
    enabled,
    staleTime: 120_000,
    queryFn: async (): Promise<DoctorsRunRate> => {
      const now = new Date();
      const { y, m, day } = istYmd(now);
      const daysInMonth = new Date(y, m + 1, 0).getDate();
      const daysElapsed = Math.max(1, day);
      const month = istMonthBoundsUTC(now);
      const { data: doctors, error: dErr } = await supabase.from('profiles').select('id, first_name, last_name').eq('role', 'doctor');
      if (dErr) throw new Error(dErr.message);
      const docs = (doctors ?? []) as any[];
      if (!docs.length) return { daysElapsed, daysInMonth, rows: [] };
      const ids = docs.map((d) => d.id);
      const counts = new Map<string, number>();
      for (let page = 0; page < 10; page++) {
        const { data: rows, error } = await supabase
          .from('training_sessions').select('trainer_id')
          .in('trainer_id', ids).gte('scheduled_at', month.startISO).lt('scheduled_at', month.endISO)
          .range(page * 1000, page * 1000 + 999);
        if (error) throw new Error(error.message);
        const chunk = (rows ?? []) as any[];
        chunk.forEach((r) => { if (r.trainer_id) counts.set(r.trainer_id, (counts.get(r.trainer_id) ?? 0) + 1); });
        if (chunk.length < 1000) break;
      }
      const rows: DoctorRunRateRow[] = docs.map((d) => {
        const current = counts.get(d.id) ?? 0;
        const perDay = current / daysElapsed;
        return { id: d.id, name: personName(d), current, perDay, projected: Math.round(perDay * daysInMonth) };
      }).sort((a, b) => b.projected - a.projected);
      return { daysElapsed, daysInMonth, rows };
    },
  });
}

/* ---------- Sessions day list (web useDoctorSessions) ---------- */
export type DoctorDaySession = {
  id: string; clientName: string; clientId: string; time: string; location: string | null;
  focus: string | null; attended: boolean | null; remarks: string | null; date: string;
  cancelled: boolean | null; isUnique: boolean | null; sessionName: string | null; hasPhysioExercises: boolean;
};
export function useDoctorDaySessions(date: Date) {
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;
  return useQuery({
    queryKey: ['doctor-sessions', date.toDateString(), uid],
    enabled: !!uid,
    staleTime: 30_000,
    queryFn: async (): Promise<DoctorDaySession[]> => {
      const { data, error } = await supabase
        .from('training_sessions')
        .select('id, scheduled_at, session_type, location, cancelled, notes, attendance_marked, client_id, unique, session_name, workout_session_id, clients (id, first_name, last_name)')
        .eq('trainer_id', uid)
        .in('session_type', DOCTOR_SESSION_TYPES as any);
      if (error) throw new Error(error.message);
      const target = date.toDateString();
      return ((data ?? []) as any[])
        .filter((s) => new Date(s.scheduled_at).toDateString() === target)
        .map((s) => ({
          id: s.id,
          clientName: s.clients ? personName(s.clients) : (s.session_name || s.location || 'Personal Session'),
          clientId: s.clients?.id || '',
          time: new Date(s.scheduled_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }),
          location: s.location ?? null,
          focus: s.session_type ?? null,
          attended: s.attendance_marked ?? null,
          remarks: s.notes ?? null,
          date: s.scheduled_at,
          cancelled: s.cancelled ?? null,
          isUnique: s.unique ?? null,
          sessionName: s.session_name ?? null,
          hasPhysioExercises: !!s.workout_session_id,
        }));
    },
  });
}

/* ---------- Neural checks for a day (HOD only — web getNeuralChecksByDoctorAndDate) ---------- */
export type NeuralCheckRow = {
  id: string; session_id: string | null; client_id: string | null; client_name: string | null;
  psychoemotional_state_index: number | null; delta: number | null; theta: number | null;
  alpha: number | null; beta: number | null; gamma: number | null; created_at: string; resolvedName: string;
};
export function useNeuralChecksForDay(doctorId: string | null, date: Date, enabled: boolean) {
  return useQuery({
    queryKey: ['neural-checks', doctorId, date.toDateString()],
    enabled: enabled && !!doctorId,
    staleTime: 30_000,
    queryFn: async (): Promise<NeuralCheckRow[]> => {
      const start = new Date(date); start.setHours(0, 0, 0, 0);
      const end = new Date(date); end.setHours(23, 59, 59, 999);
      const { data, error } = await supabase
        .from('neural_check')
        .select('id, session_id, client_id, doctor_id, client_name, psychoemotional_state_index, delta, theta, alpha, beta, gamma, created_at')
        .eq('doctor_id', doctorId)
        .gte('created_at', start.toISOString())
        .lte('created_at', end.toISOString())
        .order('created_at', { ascending: false });
      if (error) return [];
      const rows = (data ?? []) as any[];
      const clientIds = [...new Set(rows.map((r) => r.client_id).filter(Boolean))] as string[];
      const nameMap = new Map<string, string>();
      if (clientIds.length) {
        const { data: cls } = await supabase.from('clients').select('id, first_name, last_name').in('id', clientIds);
        (cls ?? []).forEach((c: any) => nameMap.set(c.id, personName(c)));
      }
      return rows.map((r) => ({ ...r, resolvedName: r.client_id ? (nameMap.get(r.client_id) || r.client_name || 'Unknown Client') : (r.client_name || 'Unknown Client') }));
    },
  });
}

/* ---------- Session exercise details (web PhysioSessionExerciseDetails) ---------- */
export function usePhysioSessionExercises(sessionId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['physio-session-exercises', sessionId],
    enabled: enabled && !!sessionId,
    staleTime: 120_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('physio_session_exercises')
        .select('*')
        .eq('session_id', sessionId)
        .order('exercise_order', { ascending: true })
        .order('set_number', { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as any[];
    },
  });
}

/* ---------- HOD breakdown dialog (web useDoctorSessionDetails) ---------- */
export function useDoctorSessionDetails(doctorId: string | null, selectedMonth: Date, enabled: boolean, selectedDay?: Date | null) {
  const month = istMonthBoundsUTC(selectedMonth);
  const startISO = selectedDay ? istDayBoundsUTC(selectedDay).startISO : month.startISO;
  const endISO = selectedDay ? istDayBoundsUTC(selectedDay).endISO : month.endISO;
  return useQuery({
    queryKey: ['doctor-session-details', doctorId, startISO, endISO],
    enabled: enabled && !!doctorId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('training_sessions')
        .select('id, scheduled_at, session_type, location, session_name, attendance_marked, cancelled, notes, session_acknowledged_at, clients (first_name, last_name)')
        .eq('trainer_id', doctorId)
        .gte('scheduled_at', startISO)
        .lt('scheduled_at', endISO)
        .order('scheduled_at', { ascending: false });
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map((s) => ({
        id: s.id, scheduled_at: s.scheduled_at, session_type: s.session_type, location: s.location,
        session_name: s.session_name, client_name: s.clients ? personName(s.clients) : null,
        attendance_marked: s.attendance_marked, cancelled: s.cancelled, notes: s.notes,
        session_acknowledged_at: s.session_acknowledged_at,
      }));
    },
  });
}

/* ---------- Physio session dialog: client picker (web contract) ---------- */
export function usePhysioDialogClients(uid: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['physio-dialog-clients', uid],
    enabled: enabled && !!uid,
    staleTime: 120_000,
    queryFn: async (): Promise<{ id: string; name: string }[]> => {
      if (FULL_ACCESS_PHYSIO_IDS.includes(uid!)) {
        const { data, error } = await supabase.from('clients').select('id, first_name, last_name').eq('status', 'active').order('first_name');
        if (error) throw new Error(error.message);
        return ((data ?? []) as any[]).map((c) => ({ id: c.id, name: personName(c) }));
      }
      const { data, error } = await supabase
        .from('trainer_clients')
        .select('client_id, clients!inner(id, first_name, last_name, status)')
        .eq('trainer_id', uid)
        .eq('clients.status', 'active');
      if (error) throw new Error(error.message);
      const mapped = ((data ?? []) as any[]).map((tc) => ({ id: tc.clients.id, name: personName(tc.clients) }));
      return [...new Map(mapped.map((c) => [c.id, c])).values()].sort((a, b) => a.name.localeCompare(b.name));
    },
  });
}

/* ---------- Rehab exercise picker list (web RehabExercisePicker) ---------- */
export function useRehabExerciseList(enabled: boolean) {
  return useQuery({
    queryKey: ['rehab-exercises'],
    enabled,
    staleTime: 600_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('exercises_db')
        .select('id, exercise, muscle_group, equipment')
        .eq('modality', 'Rehab')
        .order('muscle_group')
        .order('exercise');
      if (error) throw new Error(error.message);
      return (data ?? []) as any[];
    },
  });
}

/* ---------- Physio session submit (verbatim web PhysioSessionDialog handleSubmit) ---------- */
export type PhysioSet = { reps: string; weight_kg: string; duration: string };
export type PhysioSubmitInput = {
  doctorId: string;
  clientId: string;
  clientName: string;
  category: 'rehab' | 'recovery' | '';
  cancelled: boolean;
  // rehab with-plan
  tab: 'with-plan' | 'log-session';
  protocolId: string;
  protocolComplaint: string | null;
  rehabPhase: string;
  rehabNotes: string;
  checkedExercises: { exercise_name: string; exercise_order: number; sets: PhysioSet[] }[];
  // rehab without-plan
  wpForm: {
    chief_complaint: string; current_status: string; pain_pre: string; pain_post: string;
    areas_treated: string; clinical_observation: string;
    treatments: { technique: string; target_area: string; reasoning: string }[];
    immediate_response: string; home_care: string; plan_next_session: string;
  };
  wpExercises: { exercise_name: string; sets: PhysioSet[] }[];
  // recovery
  selectedModalities: string[];
  modalityDetails: Record<string, { area_focused?: string; rlt_duration?: string; rlt_temperature?: string; pc_duration?: string; pc_pressure?: string; ce_training_type?: string; modality_notes?: string }>;
  // cognitive
  cognitiveEnabled: boolean;
  markAsSession: boolean;
  cognitive: { psychoemotional_state_index: number | null; delta: number | null; theta: number | null; alpha: number | null; beta: number | null; gamma: number | null };
};

export function buildStructuredNotes(i: PhysioSubmitInput): string {
  if (i.category === 'rehab') {
    if (i.tab === 'with-plan') {
      const parts = ['Category: Rehab'];
      if (i.protocolComplaint) parts.push(`Protocol: ${i.protocolComplaint}`);
      parts.push(`Phase: ${i.rehabPhase}`);
      if (i.rehabNotes.trim()) parts.push(`\nNotes: ${i.rehabNotes.trim()}`);
      return parts.join('\n');
    }
    const w = i.wpForm;
    const parts: string[] = ['Category: Rehab (Without Plan)'];
    if (w.chief_complaint) parts.push(`\nChief Complaint: ${w.chief_complaint}`);
    if (w.current_status) parts.push(`Current Status / Progress: ${w.current_status}`);
    if (w.pain_pre || w.pain_post) parts.push(`Pain Assessment (VAS): Pre: ${w.pain_pre || '-'}/10, Post: ${w.pain_post || '-'}/10`);
    if (w.areas_treated) parts.push(`Area(s) Treated: ${w.areas_treated}`);
    if (w.clinical_observation) parts.push(`Clinical Observation: ${w.clinical_observation}`);
    const validTreatments = w.treatments.filter((t) => t.technique.trim());
    if (validTreatments.length > 0) {
      parts.push(`\nTreatment Administered:`);
      validTreatments.forEach((t, idx) => {
        parts.push(`${idx + 1}. ${t.technique}${t.target_area ? ` – ${t.target_area}` : ''}${t.reasoning ? `: ${t.reasoning}` : ''}`);
      });
    }
    if (w.immediate_response) parts.push(`\nImmediate Response: ${w.immediate_response}`);
    if (w.home_care) parts.push(`Home Care / Advice: ${w.home_care}`);
    if (w.plan_next_session) parts.push(`Plan for Next Session: ${w.plan_next_session}`);
    return parts.join('\n');
  }
  if (i.category === 'recovery') {
    const parts = ['Category: Recovery'];
    i.selectedModalities.forEach((modKey) => {
      const detail = i.modalityDetails[modKey] || {};
      const label = RECOVERY_MODALITIES.find((m) => m.value === modKey)?.label || modKey;
      parts.push(`\n--- ${label} ---`);
      if (modKey === 'red_light_therapy') {
        if (detail.area_focused) parts.push(`Area Focused: ${detail.area_focused}`);
        if (detail.rlt_duration) parts.push(`Duration: ${detail.rlt_duration}`);
        if (detail.rlt_temperature) parts.push(`Temperature: ${detail.rlt_temperature}`);
      } else if (modKey === 'pneumatic_compression') {
        if (detail.pc_duration) parts.push(`Duration: ${detail.pc_duration}`);
        if (detail.pc_pressure) parts.push(`Pressure: ${detail.pc_pressure}`);
      } else if (modKey === 'cognitive_entrainment') {
        if (detail.ce_training_type) parts.push(`Training: ${detail.ce_training_type}`);
      }
      if (detail.modality_notes?.trim()) parts.push(`Notes: ${detail.modality_notes.trim()}`);
    });
    return parts.join('\n');
  }
  return '';
}

export async function submitPhysioSession(i: PhysioSubmitInput): Promise<{ sessionId: string | null }> {
  const isCognitiveOnly = i.cognitiveEnabled && !i.category;

  // Cognitive-only paths
  if (isCognitiveOnly) {
    if (i.markAsSession) {
      const now = new Date().toISOString();
      const { data: sessionData, error: sessionError } = await supabase.from('training_sessions').insert([{
        client_id: i.clientId, trainer_id: i.doctorId, scheduled_at: now, duration_minutes: 60,
        status: 'completed', session_type: 'neural_check', session_name: 'Neural Check', notes: 'Neural Check',
        attendance_marked: true, cancelled: false, location: '',
      }] as any).select('id').single();
      if (sessionError) throw new Error(sessionError.message);
      const sessionId = (sessionData as any).id as string;
      await supabase.from('training_sessions').update({ workout_session_id: sessionId } as any).eq('id', sessionId);
      const { error: ncErr } = await supabase.from('neural_check').insert({
        session_id: sessionId,
        psychoemotional_state_index: i.cognitive.psychoemotional_state_index,
        delta: i.cognitive.delta, theta: i.cognitive.theta, alpha: i.cognitive.alpha,
        beta: i.cognitive.beta, gamma: i.cognitive.gamma,
      });
      if (ncErr) throw new Error(ncErr.message);
      return { sessionId };
    }
    const { error } = await supabase.from('neural_check').insert({
      client_id: i.clientId || null, client_name: i.clientName || null, doctor_id: i.doctorId,
      psychoemotional_state_index: i.cognitive.psychoemotional_state_index,
      delta: i.cognitive.delta, theta: i.cognitive.theta, alpha: i.cognitive.alpha,
      beta: i.cognitive.beta, gamma: i.cognitive.gamma,
    });
    if (error) throw new Error(error.message);
    return { sessionId: null };
  }

  // Rehab / Recovery session
  const sessionType = i.category === 'rehab' ? 'rehabilitation' : i.category === 'recovery' ? 'recovery' : 'physiotherapy';
  const now = new Date().toISOString();
  const { data: sessionData, error } = await supabase.from('training_sessions').insert([{
    client_id: i.clientId, trainer_id: i.doctorId, scheduled_at: now, duration_minutes: 60,
    status: i.cancelled ? 'cancelled' : 'completed', session_type: sessionType,
    session_name: `${i.category === 'rehab' ? 'Rehab' : 'Recovery'} Session`,
    notes: buildStructuredNotes(i), attendance_marked: !i.cancelled, cancelled: i.cancelled, location: '',
  }] as any).select('id').single();
  if (error) throw new Error(error.message);
  const sessionId = (sessionData as any).id as string;
  await supabase.from('training_sessions').update({ workout_session_id: sessionId } as any).eq('id', sessionId);

  // Exercise rows (non-fatal on failure — web parity)
  try {
    if (i.category === 'rehab' && i.tab === 'with-plan') {
      const checked = [...i.checkedExercises].sort((a, b) => a.exercise_order - b.exercise_order);
      if (checked.length) {
        const rows: any[] = [];
        checked.forEach((ex) => ex.sets.forEach((s, setIdx) => rows.push({
          session_id: sessionId, protocol_id: i.protocolId || null, phase: i.rehabPhase || null,
          exercise_name: ex.exercise_name, set_number: setIdx + 1,
          reps: s.reps ? parseInt(s.reps, 10) : null, weight_kg: s.weight_kg ? parseFloat(s.weight_kg) : null,
          duration: s.duration || null, exercise_order: ex.exercise_order, session_type: 'rehab',
        })));
        await supabase.from('physio_session_exercises').insert(rows);
      }
    }
    if (i.category === 'rehab' && i.tab === 'log-session') {
      const valid = i.wpExercises.filter((e) => e.exercise_name.trim());
      if (valid.length) {
        const rows: any[] = [];
        valid.forEach((ex, exIdx) => ex.sets.forEach((s, setIdx) => rows.push({
          session_id: sessionId, protocol_id: null, phase: null,
          exercise_name: ex.exercise_name.trim(), set_number: setIdx + 1,
          reps: s.reps ? parseInt(s.reps, 10) : null, weight_kg: s.weight_kg ? parseFloat(s.weight_kg) : null,
          duration: s.duration || null, exercise_order: exIdx, session_type: 'rehab',
        })));
        await supabase.from('physio_session_exercises').insert(rows);
      }
    }
    if (i.category === 'recovery' && i.selectedModalities.length) {
      const rows = i.selectedModalities.map((modKey, idx) => {
        const d = i.modalityDetails[modKey] || {};
        return {
          session_id: sessionId,
          exercise_name: RECOVERY_MODALITIES.find((m) => m.value === modKey)?.label || modKey,
          exercise_order: idx, set_number: 1, modality_type: modKey,
          area_focused: d.area_focused || null,
          modality_duration: modKey === 'red_light_therapy' ? (d.rlt_duration || null) : (d.pc_duration || null),
          modality_pressure: d.pc_pressure || null,
          modality_frequency: d.rlt_temperature || null, // web: RLT temperature lives in modality_frequency
          training_type: d.ce_training_type || null,
          modality_notes: d.modality_notes || null,
          session_type: 'recovery',
        };
      });
      await supabase.from('physio_session_exercises').insert(rows);
    }
  } catch { /* web: session logged but details failed to save — non-fatal */ }

  // Linked cognitive metrics
  if (i.cognitiveEnabled) {
    try {
      await supabase.from('neural_check').insert({
        session_id: sessionId,
        psychoemotional_state_index: i.cognitive.psychoemotional_state_index,
        delta: i.cognitive.delta, theta: i.cognitive.theta, alpha: i.cognitive.alpha,
        beta: i.cognitive.beta, gamma: i.cognitive.gamma,
      });
    } catch { /* non-fatal */ }
  }

  // Fire-and-forget AI (web: only when not cancelled)
  if (!i.cancelled) {
    try { invokeFn('generate-rehab-ai-analysis', { sessionId }).catch(() => {}); } catch { /* ignore */ }
  }
  return { sessionId };
}

export function useSubmitPhysioSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: submitPhysioSession,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor-sessions'] });
      qc.invalidateQueries({ queryKey: ['neural-checks'] });
      qc.invalidateQueries({ queryKey: ['rehab-sessions'] });
      qc.invalidateQueries({ queryKey: ['doctor-client-session-counts'] });
    },
  });
}

/* ---------- Protocols (web usePhysioProtocols) ---------- */
const PROTOCOL_JOIN = '*, client:clients!physio_protocols_client_id_fkey(first_name, last_name), physio:profiles!physio_protocols_physio_id_fkey(first_name, last_name)';
export function usePhysioProtocols(clientId?: string | null) {
  return useQuery({
    queryKey: ['physio-protocols', clientId],
    staleTime: 60_000,
    queryFn: async () => {
      let q = supabase.from('physio_protocols').select(PROTOCOL_JOIN).order('created_at', { ascending: false });
      if (clientId) q = q.eq('client_id', clientId);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []) as any[];
    },
  });
}
export function useApprovedProtocols(clientId: string | null) {
  return useQuery({
    queryKey: ['physio-protocols-approved', clientId],
    enabled: !!clientId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('physio_protocols').select('*')
        .eq('client_id', clientId).eq('status', 'approved').order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as any[];
    },
  });
}
export function usePendingProtocols() {
  return useQuery({
    queryKey: ['physio-protocols-pending'],
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('physio_protocols').select(PROTOCOL_JOIN)
        .eq('status', 'pending').order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as any[];
    },
  });
}
export function useProtocolExercises(protocolId: string | null, phase?: string) {
  return useQuery({
    queryKey: ['protocol-exercises', protocolId, phase],
    enabled: !!protocolId,
    staleTime: 60_000,
    queryFn: async () => {
      let q = supabase.from('physio_protocol_exercises').select('*')
        .eq('protocol_id', protocolId)
        .order('exercise_order', { ascending: true })
        .order('created_at', { ascending: true });
      if (phase) q = q.eq('phase', phase);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []) as any[];
    },
  });
}
export type ProtocolExerciseInput = {
  phase: 'initial' | 'intermediate' | 'advanced'; exercise_name: string; sets: number | null;
  exercise_order: number; load_kg?: number | null; reps?: number | null; duration?: string | null;
};
export function useCreateProtocol() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      client_id: string; physio_id: string; complaint: string;
      initial_rehab_sessions: number; initial_rehab_treatment: string;
      intermediate_rehab_sessions: number; intermediate_rehab_treatment: string;
      advanced_rehab_sessions: number; advanced_rehab_treatment: string;
      exercises?: ProtocolExerciseInput[];
    }) => {
      const { exercises, ...protocol } = payload;
      const { data, error } = await supabase.from('physio_protocols').insert(protocol as any).select().single();
      if (error) throw new Error(error.message);
      if (exercises && exercises.length > 0 && data) {
        const rows = exercises.map((ex) => ({
          protocol_id: (data as any).id, phase: ex.phase, exercise_name: ex.exercise_name,
          sets: ex.sets, exercise_order: ex.exercise_order,
          load_kg: ex.load_kg ?? null, reps: ex.reps ?? null, duration: ex.duration ?? null,
        }));
        const { error: exError } = await supabase.from('physio_protocol_exercises').insert(rows);
        if (exError) throw new Error(exError.message);
      }
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['physio-protocols'] }),
  });
}
export function useApproveProtocol() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; approved_by: string }) => {
      const { error } = await supabase.from('physio_protocols')
        .update({ status: 'approved', approved_by: input.approved_by, approved_at: new Date().toISOString() })
        .eq('id', input.id).select().single();
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['physio-protocols'] });
      qc.invalidateQueries({ queryKey: ['physio-protocols-pending'] });
      qc.invalidateQueries({ queryKey: ['physio-protocols-approved'] });
    },
  });
}
export function useRejectProtocol() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; rejection_notes: string }) => {
      const { error } = await supabase.from('physio_protocols')
        .update({ status: 'rejected', rejection_notes: input.rejection_notes })
        .eq('id', input.id).select().single();
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['physio-protocols'] });
      qc.invalidateQueries({ queryKey: ['physio-protocols-pending'] });
      qc.invalidateQueries({ queryKey: ['physio-protocols-approved'] });
    },
  });
}

/* ---------- Clients (assigned + counts + HOD all-clients + assignment) ---------- */
export function useDoctorAssignedClients() {
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;
  return useQuery({
    queryKey: ['doctor-clients', uid],
    enabled: !!uid,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trainer_clients')
        .select('client:clients(id, first_name, last_name, email, status, subscription_type)')
        .eq('trainer_id', uid)
        .eq('actively_training', true);
      if (error) throw new Error(error.message);
      const mapped = ((data ?? []) as any[]).filter((r) => r.client).map((r) => ({
        id: r.client.id as string, name: personName(r.client), status: r.client.status ?? null,
        subscription: r.client.subscription_type ?? null,
        crmName: null as string | null, crmPhone: null as string | null,
      }));
      const unique = [...new Map(mapped.map((c) => [c.id, c])).values()].sort((a, b) => a.name.localeCompare(b.name));
      // Assigned CRM per client — one batched query over the same clients.
      if (unique.length) {
        const { data: crmRows } = await supabase
          .from('trainer_clients')
          .select('client_id, profiles:trainer_id(first_name, last_name, role, phone)')
          .in('client_id', unique.map((c) => c.id))
          .eq('actively_training', true);
        const crmByClient = new Map<string, { name: string; phone: string | null }>();
        (crmRows ?? []).forEach((r: any) => {
          if (r.profiles?.role === 'crm' && !crmByClient.has(r.client_id)) {
            const nm = personName(r.profiles);
            if (nm && nm !== 'Unknown') crmByClient.set(r.client_id, { name: nm, phone: r.profiles.phone ?? null });
          }
        });
        unique.forEach((c) => {
          const crm = crmByClient.get(c.id);
          if (crm) { c.crmName = crm.name; c.crmPhone = crm.phone; }
        });
      }
      return unique;
    },
  });
}

/* Assigned CRM (name + phone) for one client — doctor client-detail hero. */
export function useClientCrm(clientId: string | null) {
  return useQuery({
    queryKey: ['client-crm', clientId],
    enabled: !!clientId,
    staleTime: 120_000,
    queryFn: async (): Promise<{ name: string; phone: string | null } | null> => {
      const { data, error } = await supabase
        .from('trainer_clients')
        .select('profiles:trainer_id(first_name, last_name, role, phone)')
        .eq('client_id', clientId)
        .eq('actively_training', true);
      if (error) throw new Error(error.message);
      const p = (data ?? []).map((r: any) => r.profiles).find((x: any) => x?.role === 'crm') ?? null;
      if (!p) return null;
      const nm = personName(p);
      return nm && nm !== 'Unknown' ? { name: nm, phone: p.phone ?? null } : null;
    },
  });
}

export function useDoctorClientSessionCounts(clientIds: string[], selectedMonths: string, enabled = true) {
  return useQuery({
    queryKey: ['doctor-client-session-counts', clientIds, selectedMonths],
    enabled: enabled && clientIds.length > 0,
    staleTime: 30_000,
    queryFn: async (): Promise<Record<string, number>> => {
      const CHUNK = 100;
      const chunks: string[][] = [];
      for (let idx = 0; idx < clientIds.length; idx += CHUNK) chunks.push(clientIds.slice(idx, idx + CHUNK));
      // web: subMonths(now, N).toISOString() — calendar-month subtraction.
      const start = selectedMonths !== 'overall' ? (() => { const d = new Date(); d.setMonth(d.getMonth() - parseInt(selectedMonths, 10)); return d.toISOString(); })() : null;
      const results = await Promise.all(chunks.map((chunk) => {
        let q = supabase.from('training_sessions').select('client_id').in('client_id', chunk).in('session_type', DOCTOR_SESSION_TYPES as any);
        if (start) q = q.gte('scheduled_at', start);
        return q;
      }));
      const countMap: Record<string, number> = {};
      for (const { data, error } of results) {
        if (error) continue;
        ((data ?? []) as any[]).forEach((row) => { if (row.client_id) countMap[row.client_id] = (countMap[row.client_id] || 0) + 1; });
      }
      return countMap;
    },
  });
}

export function useAllClientsForDoctor(enabled: boolean) {
  const { session } = useAuth();
  return useQuery({
    queryKey: ['doctor-all-clients', session?.user?.id],
    enabled: enabled && !!session?.user?.id,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('id, first_name, last_name, email, subscription_type, created_at, status')
        .eq('status', 'active')
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      const clients = (data ?? []) as any[];
      const clientIds = clients.map((c) => c.id);
      const crmByClient = new Map<string, string>();
      const crmName = new Map<string, string>();
      for (let idx = 0; idx < clientIds.length; idx += 100) {
        const slice = clientIds.slice(idx, idx + 100);
        const { data: assignments } = await supabase
          .from('trainer_clients')
          .select('client_id, trainer_id, profiles!inner(id, first_name, last_name, role)')
          .in('client_id', slice)
          .eq('profiles.role', 'crm');
        ((assignments ?? []) as any[]).forEach((a) => {
          if (a.client_id && a.trainer_id && !crmByClient.has(a.client_id)) {
            crmByClient.set(a.client_id, a.trainer_id);
            if (a.profiles) crmName.set(a.trainer_id, personName(a.profiles));
          }
        });
      }
      return clients.map((c) => ({
        id: c.id as string, name: personName(c), email: c.email ?? null,
        subscription: c.subscription_type ?? null, createdAt: c.created_at ?? null,
        crmId: crmByClient.get(c.id) ?? null, crmName: crmByClient.get(c.id) ? (crmName.get(crmByClient.get(c.id)!) ?? null) : null,
      }));
    },
  });
}

export function useAssignableDoctors(viewerId: string | null) {
  return useQuery({
    queryKey: ['available-doctors-for-assignment', viewerId],
    enabled: !!viewerId,
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('id, first_name, last_name, email, role')
        .eq('role', 'doctor').order('first_name');
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as any[];
      if (viewerId === HEAD_DOCTOR_ID) return rows;
      return rows.filter((d) => d.id !== HEAD_DOCTOR_ID);
    },
  });
}

export function useAssignDoctors() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { clientId: string; selectedDoctors: string[] }) => {
      const { data: existing, error: fetchError } = await supabase
        .from('trainer_clients').select('id, trainer_id, actively_training').eq('client_id', input.clientId);
      if (fetchError) throw new Error(fetchError.message);
      const { data: allDoctorProfiles, error: dErr } = await supabase.from('profiles').select('id').eq('role', 'doctor');
      if (dErr) throw new Error(dErr.message);
      const allDoctorIds = new Set(((allDoctorProfiles ?? []) as any[]).map((d) => d.id));
      const existingRows = (existing ?? []) as any[];
      const existingTrainerIds = new Set(existingRows.map((r) => r.trainer_id));
      // Diff: only doctor rows are touched; deselect = soft delete (actively_training=false).
      for (const row of existingRows) {
        if (!allDoctorIds.has(row.trainer_id)) continue;
        const shouldBeActive = input.selectedDoctors.includes(row.trainer_id);
        if (shouldBeActive !== row.actively_training) {
          const { data: upd, error } = await supabase.from('trainer_clients')
            .update({ actively_training: shouldBeActive }).eq('id', row.id).select();
          if (error) throw new Error(error.message);
          if (!upd || upd.length === 0) throw new Error('Failed to update assignment — you may not have permission to modify this record');
        }
      }
      const inserts = input.selectedDoctors.filter((id) => !existingTrainerIds.has(id))
        .map((trainer_id) => ({ trainer_id, client_id: input.clientId, actively_training: true }));
      if (inserts.length) {
        const { data: ins, error } = await supabase.from('trainer_clients').insert(inserts).select();
        if (error) throw new Error(error.message);
        if (!ins || ins.length === 0) throw new Error('Failed to insert new assignments — you may not have permission');
      }
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['doctor-clients'] });
      qc.invalidateQueries({ queryKey: ['doctor-all-clients'] });
      qc.invalidateQueries({ queryKey: ['client', v.clientId] });
    },
  });
}

/* ---------- Roster: own + HOD management (web useHeadDoctorRosterManagement) ---------- */
export function useDoctorOwnRoster(monthDate: Date) {
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;
  const { y, m } = istYmd(monthDate);
  const monthStart = new Date(y, m, 1);
  const monthEnd = new Date(y, m + 1, 0, 23, 59, 59, 999);
  return useQuery({
    queryKey: ['doctor-roster', uid, monthStart.toISOString()],
    enabled: !!uid,
    staleTime: 60_000,
    queryFn: async () => {
      const { data: sessions, error } = await supabase
        .from('session_schedule')
        .select('id, scheduled_datetime, modality, status, session_type, client_id')
        .eq('trainer_id', uid)
        .gte('scheduled_datetime', monthStart.toISOString())
        .lte('scheduled_datetime', monthEnd.toISOString())
        .order('scheduled_datetime', { ascending: true });
      if (error) throw new Error(error.message);
      const rows = (sessions ?? []) as any[];
      const clientIds = [...new Set(rows.map((s) => s.client_id).filter(Boolean))];
      const nameMap = new Map<string, string>();
      if (clientIds.length) {
        const { data: cls } = await supabase.from('clients').select('id, first_name, last_name').in('id', clientIds);
        (cls ?? []).forEach((c: any) => nameMap.set(c.id, personName(c)));
      }
      return rows.map((s) => ({ ...s, client_name: s.client_id ? (nameMap.get(s.client_id) ?? 'Unknown') : 'Unknown' }));
    },
  });
}

/* ---------- Today's roster (doctor's OWN sessions — HOD creates them) ----------
   Mirrors the trainer dashboard's Today's Roster: session_schedule rows where
   trainer_id = me for the current day, with the client's captured home location
   (clients.brb_location) so cards can offer the distance/map strip. */
export type DoctorRosterRow = {
  id: string; scheduled_datetime: string; modality: string | null; session_type: string | null;
  status: string | null; client_id: string | null; client_name: string;
  has_home_location: boolean; home_lat: number | null; home_lng: number | null;
};
export function useDoctorTodayRoster() {
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;
  return useQuery({
    queryKey: ['doctor-today-roster', uid],
    enabled: !!uid,
    staleTime: 60_000,
    refetchInterval: 120_000,
    queryFn: async (): Promise<DoctorRosterRow[]> => {
      const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(); dayEnd.setHours(23, 59, 59, 999);
      const { data, error } = await supabase
        .from('session_schedule')
        .select('id, scheduled_datetime, modality, session_type, status, client_id, clients:client_id(first_name, last_name, brb_location)')
        .eq('trainer_id', uid)
        .gte('scheduled_datetime', dayStart.toISOString())
        .lte('scheduled_datetime', dayEnd.toISOString())
        .order('scheduled_datetime', { ascending: true });
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map((s) => ({
        id: s.id,
        scheduled_datetime: s.scheduled_datetime,
        modality: s.modality ?? null,
        session_type: s.session_type ?? null,
        status: s.status ?? null,
        client_id: s.client_id ?? null,
        client_name: s.clients ? personName(s.clients) : 'Unknown Client',
        has_home_location: s.clients?.brb_location != null,
        home_lat: isFinite(Number(s.clients?.brb_location?.lat)) ? Number(s.clients.brb_location.lat) : null,
        home_lng: isFinite(Number(s.clients?.brb_location?.lng)) ? Number(s.clients.brb_location.lng) : null,
      }));
    },
  });
}

export function useHeadDoctorMonthSessions(monthDate: Date, doctorId: string | 'all') {
  const { session } = useAuth();
  const isHead = session?.user?.id === HEAD_DOCTOR_ID;
  const { y, m } = istYmd(monthDate);
  const monthStart = new Date(y, m, 1);
  const monthEnd = new Date(y, m + 1, 0, 23, 59, 59, 999);
  return useQuery({
    queryKey: ['head-doctor-month-sessions', `${y}-${m + 1}`, doctorId],
    enabled: isHead,
    staleTime: 30_000,
    queryFn: async () => {
      const { data: doctors, error: dErr } = await supabase.from('profiles').select('id').eq('role', 'doctor');
      if (dErr) throw new Error(dErr.message);
      const doctorIds = ((doctors ?? []) as any[]).map((d) => d.id);
      if (!doctorIds.length) return [];
      let q = supabase
        .from('session_schedule')
        .select('*, clients:client_id (id, first_name, last_name), profiles:trainer_id (id, first_name, last_name)')
        .in('trainer_id', doctorIds)
        .gte('scheduled_datetime', monthStart.toISOString())
        .lte('scheduled_datetime', monthEnd.toISOString())
        .order('scheduled_datetime', { ascending: true });
      if (doctorId && doctorId !== 'all') q = q.eq('trainer_id', doctorId);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map((s) => ({
        ...s,
        client_name: s.clients ? personName(s.clients) : 'Unknown Client',
        trainer_name: s.profiles ? personName(s.profiles) : 'Unknown Doctor',
      }));
    },
  });
}

/* Client filter source (web useHeadDoctorClients — full client list) */
export function useHeadDoctorClients(enabled: boolean) {
  return useQuery({
    queryKey: ['head-doctor-clients'],
    enabled,
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('id, first_name, last_name').order('first_name');
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map((c) => ({ id: c.id as string, name: personName(c) }));
    },
  });
}

/* Replicate prefill (web HeadDoctorBulkSessionCreator Replicate tab):
   anchor = latest non-cancelled doctor session; look back 35 days; bucket by weekday;
   most-frequent doctor/modality overall + per-day time/doctor/modality. */
export async function fetchRosterReplicatePrefill(clientId: string): Promise<null | {
  defaultDoctor: string | null; defaultModality: string | null;
  days: Record<number, { time: string; doctor?: string; modality?: string }>;
}> {
  const { data: doctors } = await supabase.from('profiles').select('id').eq('role', 'doctor');
  const dIds = ((doctors ?? []) as any[]).map((d) => d.id);
  if (!dIds.length) return null;
  const { data: anchorRows } = await supabase.from('session_schedule')
    .select('scheduled_datetime').eq('client_id', clientId).in('trainer_id', dIds)
    .neq('status', 'cancelled').order('scheduled_datetime', { ascending: false }).limit(1);
  const anchor = (anchorRows as any[])?.[0]?.scheduled_datetime;
  if (!anchor) return null;
  const from = new Date(new Date(anchor).getTime() - 35 * 864e5).toISOString();
  const { data: rows } = await supabase.from('session_schedule')
    .select('scheduled_datetime, trainer_id, modality').eq('client_id', clientId).in('trainer_id', dIds)
    .neq('status', 'cancelled').gte('scheduled_datetime', from).lte('scheduled_datetime', anchor);
  const most = (arr: string[]) => {
    const m = new Map<string, number>();
    arr.forEach((x) => m.set(x, (m.get(x) ?? 0) + 1));
    let best: string | null = null, n = 0;
    m.forEach((v, k) => { if (v > n) { n = v; best = k; } });
    return best;
  };
  const byDay = new Map<number, { times: string[]; doctors: string[]; mods: string[] }>();
  const allDocs: string[] = [], allMods: string[] = [];
  ((rows ?? []) as any[]).forEach((r) => {
    const d = new Date(r.scheduled_datetime);
    const day = d.getDay();
    const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    if (!byDay.has(day)) byDay.set(day, { times: [], doctors: [], mods: [] });
    const b = byDay.get(day)!;
    b.times.push(hm);
    if (r.trainer_id) { b.doctors.push(r.trainer_id); allDocs.push(r.trainer_id); }
    if (r.modality) { b.mods.push(r.modality); allMods.push(r.modality); }
  });
  const days: Record<number, { time: string; doctor?: string; modality?: string }> = {};
  byDay.forEach((b, day) => {
    days[day] = { time: most(b.times) ?? '09:00', doctor: most(b.doctors) ?? undefined, modality: most(b.mods) ?? undefined };
  });
  return { defaultDoctor: most(allDocs), defaultModality: most(allMods), days };
}

export function useHeadDoctorDoctors(enabled: boolean) {
  return useQuery({
    queryKey: ['head-doctor-doctors'],
    enabled,
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('id, first_name, last_name').eq('role', 'doctor').order('first_name');
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map((d) => ({ id: d.id as string, name: personName(d) }));
    },
  });
}

export type BulkSessionData = {
  client_id: string; trainer_id: string; modality: string;
  preferences: { day_of_week: number; preferred_time: string; preferred_trainer_id?: string; preferred_modality?: string }[];
  weeks: number; startDate?: Date;
};
export function useBulkCreateRoster() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (bulk: BulkSessionData) => {
      const { client_id, trainer_id, modality, preferences, weeks, startDate } = bulk;
      const today = startDate ? new Date(startDate) : new Date();
      today.setHours(0, 0, 0, 0);
      const endDate = new Date(today); endDate.setDate(endDate.getDate() + weeks * 7);
      const allDates: Date[] = [];
      for (let d = new Date(today); d <= endDate; d.setDate(d.getDate() + 1)) allDates.push(new Date(d));
      const sessionsToCreate = allDates
        .filter((date) => preferences.some((p) => p.day_of_week === date.getDay()))
        .map((date) => {
          const pref = preferences.find((p) => p.day_of_week === date.getDay());
          if (!pref) return null;
          const [hh, mm] = pref.preferred_time.split(':');
          const dt = new Date(date); dt.setHours(parseInt(hh, 10), parseInt(mm, 10), 0, 0);
          return {
            trainer_id: pref.preferred_trainer_id || trainer_id,
            client_id,
            scheduled_datetime: dt.toISOString(),
            modality: pref.preferred_modality || modality,
            status: 'scheduled',
          };
        })
        .filter(Boolean) as any[];
      if (!sessionsToCreate.length) throw new Error('No sessions to create based on preferences');
      const conflicts: any[] = [];
      const valid: any[] = [];
      for (const s of sessionsToCreate) {
        const { data: tConf } = await supabase.from('session_schedule').select('id')
          .eq('trainer_id', s.trainer_id).eq('scheduled_datetime', s.scheduled_datetime).neq('status', 'cancelled');
        if (tConf && tConf.length) { conflicts.push({ ...s, reason: 'Doctor already booked at this time' }); continue; }
        const { data: cConf } = await supabase.from('session_schedule').select('id')
          .eq('client_id', s.client_id).eq('scheduled_datetime', s.scheduled_datetime).neq('status', 'cancelled');
        if (cConf && cConf.length) { conflicts.push({ ...s, reason: 'Client already has a session at this time' }); continue; }
        valid.push(s);
      }
      let created = 0;
      if (valid.length) {
        const { data, error } = await supabase.from('session_schedule').insert(valid).select();
        if (error) throw new Error(error.message);
        created = (data ?? []).length;
      }
      return { created, conflicts };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['head-doctor-month-sessions'] }),
  });
}

export function useCancelRosterSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { session_id: string; canceled_by: string; cancellation_remark: string }) => {
      const { error } = await supabase.from('session_schedule')
        .update({ status: 'cancelled', canceled_by: input.canceled_by, cancellation_remark: input.cancellation_remark, updated_at: new Date().toISOString() })
        .eq('id', input.session_id).select().single();
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['head-doctor-month-sessions'] }); qc.invalidateQueries({ queryKey: ['doctor-today-roster'] }); },
  });
}
export function useRescheduleRosterSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { session_id: string; new_datetime: string }) => {
      const { error } = await supabase.from('session_schedule')
        .update({ scheduled_datetime: input.new_datetime, updated_at: new Date().toISOString() })
        .eq('id', input.session_id).select().single();
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['head-doctor-month-sessions'] }),
  });
}
/* Permanently delete ONE roster session (head-doctor page card action). */
export function useDeleteRosterSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (sessionId: string) => {
      const { error, count } = await supabase.from('session_schedule').delete({ count: 'exact' }).eq('id', sessionId);
      if (error) throw new Error(error.message);
      if (!count) throw new Error('Could not delete this session (not permitted).');
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['head-doctor-month-sessions'] }); qc.invalidateQueries({ queryKey: ['doctor-today-roster'] }); },
  });
}

export function useDeleteFutureRoster() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { doctor_id?: string; client_id: string }) => {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      let q = supabase.from('session_schedule').delete()
        .eq('client_id', input.client_id)
        .gte('scheduled_datetime', today.toISOString())
        .neq('status', 'cancelled');
      if (input.doctor_id) q = q.eq('trainer_id', input.doctor_id);
      const { error } = await q;
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['head-doctor-month-sessions'] }),
  });
}

/* ---------- Client detail sections (doctor tabs) ---------- */
export function useRehabSessions(clientId: string | null) {
  return useQuery({
    queryKey: ['rehab-sessions', clientId],
    enabled: !!clientId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data: sessions, error } = await supabase
        .from('training_sessions')
        .select('id, session_type, scheduled_at, notes, notes_ai_analysis, rehab_ai_analysis, trainer_id, status, profiles!trainer_id(first_name, last_name)')
        .eq('client_id', clientId)
        .in('session_type', REHAB_SESSION_TYPES as any)
        .order('scheduled_at', { ascending: false });
      if (error) throw new Error(error.message);
      const rows = (sessions ?? []) as any[];
      if (!rows.length) return [];
      const ids = rows.map((s) => s.id);
      const { data: exercises } = await supabase
        .from('physio_session_exercises')
        .select('id, session_id, exercise_name, exercise_order, set_number, reps, weight_kg, duration, session_type, phase, area_focused, modality_duration, modality_frequency, modality_notes, modality_pressure, modality_type, training_type')
        .in('session_id', ids)
        .order('exercise_order', { ascending: true })
        .order('set_number', { ascending: true });
      const exBySession = new Map<string, any[]>();
      ((exercises ?? []) as any[]).forEach((e) => {
        if (!exBySession.has(e.session_id)) exBySession.set(e.session_id, []);
        exBySession.get(e.session_id)!.push(e);
      });
      return rows.map((s) => ({ ...s, trainer_name: s.profiles ? personName(s.profiles) : 'Unknown', exercises: exBySession.get(s.id) ?? [] }));
    },
  });
}

export function usePhysioCounselling(clientId: string | null) {
  return useQuery({
    queryKey: ['physiotherapy-counselling', clientId],
    enabled: !!clientId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('physiotherapy_counselling')
        .select('*, profiles!physiotherapist_id(first_name, last_name)')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map((r) => ({ ...r, doctor_name: r.profiles ? personName(r.profiles) : '—' }));
    },
  });
}
export function useAddPhysioCounselling() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { clientId: string; doctorId: string; counsellingDetails: string }) => {
      const { error } = await supabase.from('physiotherapy_counselling')
        .insert({ client_id: input.clientId, physiotherapist_id: input.doctorId, counselling_details: input.counsellingDetails })
        .select().single();
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['physiotherapy-counselling'] }),
  });
}
export function useGenerateCounsellingAI() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; counsellingDetails: string }) => {
      const { data, error } = await invokeFn('analyze-physiotherapy-counselling', { counsellingDetails: input.counsellingDetails });
      if (error) throw new Error(error.message);
      const simplified = (data as any)?.simplifiedAnalysis;
      if (!simplified) throw new Error('AI analysis returned no content');
      const { error: uErr } = await supabase.from('physiotherapy_counselling').update({ ai_simplified_analysis: simplified }).eq('id', input.id);
      if (uErr) throw new Error(uErr.message);
      return simplified as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['physiotherapy-counselling'] }),
  });
}

export function useCancelledClientSessions(clientId: string | null) {
  return useQuery({
    queryKey: ['cancelled-sessions', clientId],
    enabled: !!clientId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('training_sessions')
        .select('id, client_id, trainer_id, scheduled_at, session_type, status, cancelled, attachment_url, notes, created_at, profiles!trainer_id (first_name, last_name)')
        .eq('client_id', clientId)
        .or('status.eq.cancelled,cancelled.eq.true')
        .order('scheduled_at', { ascending: false });
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map((s) => ({ ...s, trainer_name: s.profiles ? personName(s.profiles) : '—' }));
    },
  });
}

/* ---------- Workout session exercise details (web ClientWorkoutSessions expander) ---------- */
export function useWorkoutSessionExercises(sessionId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['workout-session-exercises', sessionId],
    enabled: enabled && !!sessionId,
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('workout_exercises')
        .select('exercise_name, set_number, reps_performed, load_performed, duration_seconds, body_part, exercise_notes, remark, rounds, sub_activity, modality, measurement_type')
        .eq('session_id', sessionId)
        .order('set_number', { ascending: true, nullsFirst: false });
      if (error) throw new Error(error.message);
      // group by exercise, preserving first-seen order
      const groups = new Map<string, any[]>();
      ((data ?? []) as any[]).forEach((r) => {
        const k = r.exercise_name ?? '—';
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k)!.push(r);
      });
      return [...groups.entries()].map(([name, sets]) => ({ name, sets }));
    },
  });
}

/* ---------- Client detail: header (web useClientDetail subset) ---------- */
export type DoctorClientHeader = {
  id: string; name: string; email: string | null; status: string | null; subscription: string | null;
  goal: string | null; location: string | null; isHybrid: boolean | null; createdAt: string | null;
  trainers: { id: string; name: string; role: string | null }[];
  completedSessions: number;
  assessment: { age: string | null; gender: string | null; height: string | null; weight: string | null };
  assessmentMedicalHistory: string | null;
};
/* web useClientDetail formatMedicalHistory — verbatim field list */
const formatAssessmentMedicalHistory = (data: any): string | null => {
  if (!data || typeof data !== 'object') return null;
  const formatValue = (value: any): string | null => {
    if (!value) return null;
    if (typeof value === 'string') return value.trim() || null;
    if (Array.isArray(value)) { const f = value.filter((v) => v); return f.length ? f.join(', ') : null; }
    if (typeof value === 'object') { const vs = Object.values(value).filter((v) => v && v !== ''); return vs.length ? vs.join(', ') : null; }
    return String(value);
  };
  const parts: string[] = [];
  const push = (label: string, v: any) => { const s = formatValue(v); if (s) parts.push(`${label}: ${s}`); };
  push('Past Injuries', data.pastInjuries);
  push('Surgical History', data.surgicalHistory);
  push('Chronic Conditions', data.chronicConditions);
  push('Other Conditions', data.chronicConditionsOther);
  push('Current Medications', data.currentMedications);
  push('Other Medications', data.currentMedicationsOther);
  push('Pain/Discomfort Areas', data.painDiscomfortAreas);
  return parts.length ? parts.join('\n\n') : null;
};
export function useDoctorClientHeader(clientId: string | null) {
  return useQuery({
    queryKey: ['doctor-client-header', clientId],
    enabled: !!clientId,
    staleTime: 60_000,
    queryFn: async (): Promise<DoctorClientHeader | null> => {
      const { data: c, error } = await supabase.from('clients').select('*').eq('id', clientId).maybeSingle();
      if (error) throw new Error(error.message);
      if (!c) return null;
      const [tcR, cntR, caR] = await Promise.all([
        supabase.from('trainer_clients')
          .select('trainer_id, actively_training, profiles!trainer_clients_trainer_id_fkey(id, first_name, last_name, role)')
          .eq('client_id', clientId).eq('actively_training', true),
        supabase.from('training_sessions').select('id', { count: 'exact', head: true })
          .eq('client_id', clientId).neq('status', 'parked').eq('complimentary_session', false)
          .gte('scheduled_at', (c as any).created_at),
        supabase.from('coach_assessment')
          .select('new_client_assessment_data, existing_client_assessment_data, assessment_date')
          .eq('client_id', clientId).order('assessment_date', { ascending: false }).limit(1),
      ]);
      const trainers = ((tcR.data ?? []) as any[]).filter((r) => r.profiles).map((r) => ({
        id: r.profiles.id as string, name: personName(r.profiles), role: r.profiles.role ?? null,
      }));
      const ca = (caR.data ?? [])[0] as any;
      // web: try 'Standardized Assessment' wrapper first, then flat clientProfile
      const full = ca?.new_client_assessment_data ?? ca?.existing_client_assessment_data;
      const basic = full?.['Standardized Assessment']?.clientProfile?.basicInfo ?? full?.clientProfile?.basicInfo ?? {};
      const medHist = full?.['Standardized Assessment']?.medicalHistory ?? full?.medicalHistory;
      return {
        id: (c as any).id, name: personName(c), email: (c as any).email ?? null,
        status: (c as any).status ?? null, subscription: (c as any).subscription_type ?? null,
        goal: (c as any).goal ?? null, location: (c as any).location ?? null,
        isHybrid: (c as any).is_hybrid ?? null, createdAt: (c as any).created_at ?? null,
        trainers: [...new Map(trainers.map((t) => [t.id, t])).values()],
        completedSessions: cntR.count ?? 0,
        // web: assessment_age = clientBasicInfo?.clientAge || null (empty string → null)
        assessment: {
          age: basic.clientAge ? String(basic.clientAge) : null,
          gender: basic.clientGender || null,
          height: basic.clientHeight ? String(basic.clientHeight) : null,
          weight: basic.clientWeight ? String(basic.clientWeight) : null,
        },
        assessmentMedicalHistory: formatAssessmentMedicalHistory(medHist),
      };
    },
  });
}

/* ---------- AssignDoctorDialog prefill: which doctors are actively assigned ---------- */
export function useClientDoctorAssignments(clientId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['client-doctor-assignments', clientId],
    enabled: enabled && !!clientId,
    staleTime: 30_000,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase
        .from('trainer_clients')
        .select('trainer_id, actively_training, profiles!inner(id, role)')
        .eq('client_id', clientId)
        .eq('profiles.role', 'doctor');
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).filter((r) => r.actively_training).map((r) => r.trainer_id as string);
    },
  });
}

/* ---------- Medical history (web useClientMedicalHistory) ---------- */
export const MEDICAL_CATEGORIES = [
  'hospitalization', 'surgery', 'injury', 'illness', 'disease', 'medication', 'allergy',
  'vaccination', 'congenital', 'mental_health', 'dental', 'vision', 'other',
] as const;
export const MEDICAL_CATEGORY_LABELS: Record<string, string> = {
  hospitalization: 'Hospitalization', surgery: 'Surgery', injury: 'Injury', illness: 'Illness',
  disease: 'Disease', medication: 'Medication', allergy: 'Allergy', vaccination: 'Vaccination',
  congenital: 'Congenital Condition', mental_health: 'Mental Health', dental: 'Dental',
  vision: 'Vision', other: 'Other',
};
export const MEDICAL_SEVERITIES = ['mild', 'moderate', 'severe', 'critical'] as const;
export function useClientMedicalHistory(clientId: string | null) {
  return useQuery({
    queryKey: ['client-medical-history', clientId],
    enabled: !!clientId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_medical_history')
        .select('*, doctor:profiles!client_medical_history_doctor_id_fkey(first_name, last_name)')
        .eq('client_id', clientId)
        .order('event_date', { ascending: false });
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map((r) => ({ ...r, doctor_name: r.doctor ? personName(r.doctor) : '—' }));
    },
  });
}
export type PickedDoc = { uri: string; name: string; mime: string; size: number | null };
export type MedicalEntryInput = {
  clientId: string; doctorId: string; category: string; severity: string; title: string;
  description: string; event_date: string; end_date: string; is_ongoing: boolean;
  problem_description: string; diagnosis: string; treatment_given: string;
  medicines_taken: string; hospital_name: string; treating_doctor: string;
  tags: string[]; files: PickedDoc[];
};
/* RN-safe storage upload (fetch local uri → ArrayBuffer; blob() unreliable on Hermes) */
async function uploadToBucket(bucket: string, path: string, file: PickedDoc): Promise<string> {
  const res = await fetch(file.uri);
  const buf = await res.arrayBuffer();
  const { error } = await supabase.storage.from(bucket).upload(path, buf, { contentType: file.mime, upsert: false });
  if (error) throw new Error(error.message);
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}
export function useAddMedicalHistory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (f: MedicalEntryInput) => {
      // web useAddMedicalHistoryEntry: upload to medical-history-files at `${clientId}/${Date.now()}_${name}`
      const attachments: any[] = [];
      for (const file of f.files) {
        const path = `${f.clientId}/${Date.now()}_${file.name}`;
        const url = await uploadToBucket('medical-history-files', path, file);
        attachments.push({ file_name: file.name, file_path: path, file_url: url, file_type: file.mime, uploaded_at: new Date().toISOString() });
      }
      const { error } = await supabase.from('client_medical_history').insert({
        client_id: f.clientId, doctor_id: f.doctorId,
        category: f.category, severity: f.severity,
        title: f.title, description: f.description || null,
        event_date: f.event_date, end_date: f.end_date || null,
        is_ongoing: f.is_ongoing,
        problem_description: f.problem_description || null,
        diagnosis: f.diagnosis || null,
        treatment_given: f.treatment_given || null,
        medicines_taken: f.medicines_taken || null,
        hospital_name: f.hospital_name || null,
        treating_doctor: f.treating_doctor || null,
        tags: f.tags, attachments,
      } as any);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['client-medical-history', v.clientId] }),
  });
}

/* ---------- AI document upload (verbatim web MedicalHistoryFormDialog handleAiUpload) ----------
   Per file: upload to client-documents at `${clientId}/findings/${ts}-${safeName}`, insert a
   placeholder client_findings row, then ONE process-finding-batch invoke (202-accepted background
   job). Refetch now / +30s / +75s so the extracted rows appear without a manual reload. */
export function useAiUploadMedicalDocs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { clientId: string; doctorId: string; docType: 'lab_report' | 'other'; files: PickedDoc[] }) => {
      const uploadedFiles: { findingId: string; fileUrl: string; fileName: string; filePath: string }[] = [];
      for (const aiFile of input.files) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const safeName = aiFile.name.replace(/[^a-zA-Z0-9._-]+/g, '_');
        const fileName = `${input.clientId}/findings/${timestamp}-${safeName}`;
        const publicUrl = await uploadToBucket('client-documents', fileName, aiFile);
        const { data: findingData, error: findingError } = await supabase
          .from('client_findings')
          .insert({
            client_id: input.clientId,
            doctor_id: input.doctorId,
            title: aiFile.name.split('.').slice(0, -1).join('.') || aiFile.name,
            description: 'AI processing (batch)...',
            file_name: aiFile.name,
            file_path: fileName,
            file_url: publicUrl,
            file_size: aiFile.size,
            file_type: aiFile.mime,
          } as any)
          .select('id')
          .single();
        if (findingError) throw new Error(findingError.message);
        uploadedFiles.push({ findingId: (findingData as any).id, fileUrl: publicUrl, fileName: aiFile.name, filePath: fileName });
      }
      const { data: batchResult, error: batchError } = await invokeFn('process-finding-batch', {
        files: uploadedFiles, clientId: input.clientId, doctorId: input.doctorId, documentType: input.docType,
      });
      // web: a missing acknowledgement is a soft warning, not a failure — the job may still run
      return { count: uploadedFiles.length, softWarn: !!batchError, accepted: !!(batchResult as any)?.accepted || !!(batchResult as any)?.success };
    },
    onSuccess: (_d, v) => {
      const refresh = () => {
        qc.invalidateQueries({ queryKey: ['client-findings', v.clientId] });
        qc.invalidateQueries({ queryKey: ['client-health-reports', v.clientId] });
        qc.invalidateQueries({ queryKey: ['client-medical-history', v.clientId] });
      };
      refresh();
      setTimeout(refresh, 30_000);
      setTimeout(refresh, 75_000);
    },
  });
}
export function useDeleteMedicalHistory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; clientId: string }) => {
      const { error } = await supabase.from('client_medical_history').delete().eq('id', input.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['client-medical-history', v.clientId] }),
  });
}

/* ---------- Findings (web useClientFindings — list/view/share; upload stays web-side) ---------- */
export function useClientFindings(clientId: string | null) {
  return useQuery({
    queryKey: ['client-findings', clientId],
    enabled: !!clientId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_findings')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as any[];
    },
  });
}
export function useToggleFindingShared() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; clientId: string; shared: boolean }) => {
      const { error } = await supabase.from('client_findings')
        .update({ shared_with_client: input.shared } as any).eq('id', input.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['client-findings', v.clientId] }),
  });
}

/* ---------- Team remarks (web ClientRemarksSection — 7/page, edit/delete own only) ---------- */
export const REMARKS_PER_PAGE = 7;
export function useDoctorClientRemarks(clientId: string | null) {
  return useQuery({
    queryKey: ['doctor-client-remarks', clientId],
    enabled: !!clientId,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_remarks')
        .select('id, client_id, author_id, content, created_at, updated_at, attachment_url, profiles!author_id(first_name, last_name, role)')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map((r) => ({
        ...r, author_name: r.profiles ? personName(r.profiles) : 'Unknown', author_role: r.profiles?.role ?? null,
      }));
    },
  });
}
export function useAddClientRemark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { clientId: string; authorId: string; content: string }) => {
      const { error } = await supabase.from('client_remarks')
        .insert({ client_id: input.clientId, author_id: input.authorId, content: input.content.trim(), attachment_url: null } as any);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['doctor-client-remarks', v.clientId] }),
  });
}
export function useUpdateClientRemark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; clientId: string; content: string }) => {
      const { error } = await supabase.from('client_remarks')
        .update({ content: input.content.trim() } as any).eq('id', input.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['doctor-client-remarks', v.clientId] }),
  });
}
export function useDeleteClientRemark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; clientId: string }) => {
      const { error } = await supabase.from('client_remarks').delete().eq('id', input.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['doctor-client-remarks', v.clientId] }),
  });
}
