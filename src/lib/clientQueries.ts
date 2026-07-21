import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';

/* ---------- Create a workout session (strength) ---------- */
// RFC4122-ish v4 uuid (Hermes has no crypto.randomUUID).
export function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Local (device = IST) yesterday as YYYY-MM-DD — sleep/nutrition are logged against yesterday.
function localYesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* ---------- Health-data gate (sleep + nutrition for yesterday) ---------- */
export function useClientHealthCheck(clientId: string | null) {
  return useQuery({
    queryKey: ['client-health-check', clientId],
    enabled: !!clientId,
    staleTime: 60_000,
    queryFn: async () => {
      const yesterday = localYesterday();
      const now = new Date();
      const [hmR, slR, nutR, schedR] = await Promise.all([
        supabase.from('daily_health_metrics').select('sleep_duration_minutes').eq('client_id', clientId).eq('metric_date', yesterday).limit(1),
        supabase.from('daily_sleep_logs').select('hours_slept').eq('client_id', clientId).eq('log_date', yesterday).limit(1),
        supabase.from('nutrition_tracker').select('nutrition_rating, steps_by_trainer').eq('client_id', clientId).eq('rating_date', yesterday).limit(1),
        supabase.from('monthly_sleep_schedules').select('average_sleep_hours').eq('client_id', clientId).eq('month', now.getMonth() + 1).eq('year', now.getFullYear()).limit(1),
      ]);
      const hmMins = hmR.data?.[0]?.sleep_duration_minutes;
      const slHours = slR.data?.[0]?.hours_slept;
      const rating = nutR.data?.[0]?.nutrition_rating;
      const steps = nutR.data?.[0]?.steps_by_trainer;
      const sleepHours = hmMins != null ? Math.round((hmMins / 60) * 10) / 10 : slHours != null ? Number(slHours) : null;
      return {
        sleepMissing: sleepHours == null,
        nutritionMissing: rating == null,
        stepsMissing: steps == null,
        sleepHours,
        nutritionRating: rating ?? null,
        stepsCount: steps ?? null,
        scheduledHours: schedR.data?.[0]?.average_sleep_hours ?? 8,
      };
    },
  });
}

export type HealthDataInput = {
  clientId: string;
  trainerId: string;
  hoursSlept?: number | null;
  scheduledHours: number;
  nutritionRating?: number | null;
  stepsCount?: number | null;
  /** Offline sync: the device date the data was entered for (defaults to yesterday-now). */
  logDate?: string;
};

// Plain submit fn — used by the mutation hook AND the offline outbox drainer.
// All writes are upserts keyed on (client, date), so retries are idempotent.
export async function submitHealthData(args: HealthDataInput) {
  const { clientId, trainerId, hoursSlept, scheduledHours, nutritionRating, stepsCount } = args;
  const yesterday = args.logDate ?? localYesterday();

  if (hoursSlept != null) {
    const { error } = await supabase.from('daily_sleep_logs').upsert(
      { client_id: clientId, log_date: yesterday, hours_slept: hoursSlept, scheduled_hours: scheduledHours, deviation_hours: hoursSlept - scheduledHours, trainer_id: trainerId || null },
      { onConflict: 'client_id,log_date' }
    );
    if (error) throw new Error(error.message);
  }

  if (nutritionRating != null || stepsCount != null) {
    const payload: Record<string, any> = { updated_at: new Date().toISOString() };
    if (nutritionRating != null) payload.nutrition_rating = nutritionRating;
    if (stepsCount != null) payload.steps_by_trainer = stepsCount;
    const { data: existing } = await supabase.from('nutrition_tracker').select('id').eq('client_id', clientId).eq('rating_date', yesterday).limit(1);
    if (existing && existing.length > 0) {
      const { error } = await supabase.from('nutrition_tracker').update(payload).eq('client_id', clientId).eq('rating_date', yesterday);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase.from('nutrition_tracker').insert({ client_id: clientId, rating_date: yesterday, ...payload });
      if (error) throw new Error(error.message);
    }
  }
}

export function useSaveHealthData() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: submitHealthData,
    onSuccess: (_res, vars) => qc.invalidateQueries({ queryKey: ['client-health-check', vars.clientId] }),
  });
}

/* ---------- Exercise DB (for the Add-Exercise picker) ---------- */
export type DbExercise = { name: string; muscle_group: string | null; equipment: string | null; measurement_type: string | null };

// Maps the app modality → the exercises_db `modality` value(s) to pull. The web
// logging form filters by an exact Title-Case `.eq('modality', X)` per modality,
// so each maps to its own DB modality (no cross-modality mixing on the log form).
const EXERCISE_MODALITY_MAP: Record<string, string[]> = {
  strength: ['Strength'],
  yoga: ['Yoga'],
  boxing: ['Boxing'],
  pilates: ['Pilates'],
  aerobics: ['Aerobics'],
};
// Aqua Aerobics has no rows in exercises_db — served from a fixed list (web
// AQUA_AEROBICS_DEFAULT_EXERCISES, incl. each entry's own measurement type).
const AQUA_MEASUREMENTS: Record<string, 'reps' | 'duration'> = {
  'Water Ski': 'duration', 'Squat Jump (Time)': 'duration', 'Flutter Kicks': 'duration', 'Pool Plank': 'duration',
};
const AQUA_AEROBICS_EXERCISES: DbExercise[] = [
  'Noodle Pushdown', 'Water Ski', 'Squat Jump (Reps)', 'Squat Jump (Time)', 'Power Lunges',
  'Flutter Kicks', 'Cross Country Ski', 'Burpee Variation', 'Tuck Jump', 'Water Sprint',
  'Standing Knee Tuck', 'Single Leg Raise', 'Pool Plank', 'DB Tricep Pushdown', 'Pool Crunch', 'Reverse Fly',
].map((n) => ({ name: n, muscle_group: 'Aqua Aerobics Activity', equipment: 'Pool', measurement_type: AQUA_MEASUREMENTS[n] ?? 'reps' }));

export function useExerciseDb(modality: string) {
  const key = (modality || 'strength').toLowerCase();
  return useQuery({
    queryKey: ['exercise-db', key],
    enabled: !!modality,
    staleTime: 600_000,
    queryFn: async (): Promise<DbExercise[]> => {
      if (key === 'aqua aerobics') return AQUA_AEROBICS_EXERCISES;
      const dbModalities = EXERCISE_MODALITY_MAP[key] ?? [key.replace(/\b\w/g, (c) => c.toUpperCase())];
      const { data, error } = await supabase
        .from('exercises_db')
        .select('exercise, muscle_group, equipment, measurement_type')
        .in('modality', dbModalities)
        .order('exercise');
      if (error) throw new Error(error.message);
      const seen = new Set<string>();
      const out: DbExercise[] = [];
      for (const r of (data ?? []) as any[]) {
        const name = (r.exercise ?? '').trim();
        if (!name || seen.has(name.toLowerCase())) continue;
        seen.add(name.toLowerCase());
        out.push({ name, muscle_group: r.muscle_group ?? null, equipment: r.equipment ?? null, measurement_type: r.measurement_type ?? null });
      }
      return out;
    },
  });
}

export type WorkoutSetInput = {
  reps: string;
  load: string;
  duration?: string;
  note?: string;
  // Plan-carried per-set fields (web parity — persisted to their own columns):
  tempo?: string;
  rest?: string;      // rest_period
  rmPct?: string;     // rm_percentage
  rir?: string;       // rir_performed
  superset?: string;  // super_set_group
  equipment?: string;
  // Plan targets shown as placeholders in the UI — never persisted directly.
  repsPlan?: string;
  loadPlan?: string;
  durationPlan?: string;
};
export type WorkoutExerciseInput = {
  name: string;
  measurement?: 'reps' | 'duration';
  sets: WorkoutSetInput[];
  notes?: string;
  body_part?: string;   // Per-exercise body part (plan/picker) — falls back to session name
  // Activity modalities (Yoga/Boxing): the row's existence = completed.
  completed?: boolean;
  activityType?: 'Constant' | 'Custom';
  rounds?: string;      // Boxing padwork
  durationMin?: string; // Boxing/Aerobics duration in minutes (→ duration_seconds)
};

export type WorkoutLogInput = {
  trainerId: string;
  clientId: string;
  sessionName: string;
  modality: string;
  exercises: WorkoutExerciseInput[];
  remark?: string;
  rpe?: number | null;
  scheduleSessionId?: string | null;
  /** Training-partner parallel sessions share one group id (web contract:
      post-insert UPDATE on training_sessions.partner_session_group_id). */
  partnerSessionGroupId?: string | null;
  /** Offline sync: pre-generated id + the ORIGINAL device date of the log.
      The id makes retries idempotent; the date keeps a late-synced log at the
      time the trainer actually logged it, never the sync time. */
  sessionId?: string;
  sessionDate?: string;
};

// Plain submit fn — used by the mutation hook AND the offline outbox drainer.
// Row construction is a verbatim port of the web useWorkoutFormSubmission +
// useWorkoutSession: workout_exercises is the ONLY session write (training_sessions
// is created DB-side); the session remark lives on the FIRST row only; yoga/boxing
// are activity rows (set_number null); aerobics rows are minutes→seconds with
// body_part 'Aerobics Activity'; everything else is the reps/load/duration set model
// with the plan-carried per-set columns (tempo/rest/%RM/RIR/superset/equipment).
export async function submitWorkoutLog(args: WorkoutLogInput) {
  const { trainerId, clientId, sessionName, modality, exercises, remark, rpe, scheduleSessionId, partnerSessionGroupId } = args;
  const m = (modality || '').toLowerCase();
  const isYoga = m === 'yoga';
  const isBoxing = m === 'boxing';
  const isAerobics = m === 'aerobics';
  const isActivity = isYoga || isBoxing;

  const validActs = exercises.filter((e) => e.name.trim() && e.completed !== false);
  const validSets = exercises.filter((e) => e.name.trim() && e.sets.some((s) => s.reps.trim() || s.load.trim() || (s.duration ?? '').trim()));
  if (isActivity) {
    if (!validActs.length) throw new Error('Mark at least one activity as completed');
  } else if (!validSets.length) {
    throw new Error('Add at least one exercise with a set');
  }

  const sessionId = args.sessionId ?? uuidv4();
  const sessionDate = args.sessionDate ?? new Date().toISOString().slice(0, 10);

  // Idempotency guard: if a previous attempt already landed (double submit, or an
  // offline retry after a lost response), skip the insert entirely.
  const { data: existing, error: exErr } = await supabase
    .from('workout_exercises')
    .select('id')
    .eq('session_id', sessionId)
    .limit(1);
  if (exErr) throw new Error(exErr.message);
  const alreadyInserted = (existing?.length ?? 0) > 0;

  if (!alreadyInserted) {
    const rows: any[] = [];
    let remarkPlaced = false; // web: session remark stored on the FIRST exercise row only
    const takeRemark = () => {
      if (remarkPlaced || !remark?.trim()) return null;
      remarkPlaced = true;
      return remark.trim();
    };
    const s = (v?: string | null) => {
      const t = (v ?? '').trim();
      return t || null;
    };

    if (isActivity) {
      // One row per completed activity; the row's existence IS the completion.
      validActs.forEach((ex) => {
        rows.push({
          session_id: sessionId,
          session_name: sessionName || (isYoga ? 'Yoga Session' : 'Boxing Session'),
          session_date: sessionDate,
          body_part: isYoga ? 'Yoga Activity' : 'Boxing Activity',
          exercise_name: ex.name.trim(),
          measurement_type: 'reps',
          set_number: null,
          reps_performed: null,
          duration_seconds: isBoxing && (ex.durationMin ?? '').trim() ? Number(ex.durationMin) * 60 : null,
          load_performed: null,
          rounds: isBoxing && (ex.rounds ?? '').trim() ? Number(ex.rounds) : null,
          sub_activity: null,
          exercise_notes: ex.notes?.trim() || null,
          remark: takeRemark(),
          modality,
          client_id: clientId,
          trainer_id: trainerId,
        });
      });
    } else if (isAerobics) {
      // Web aerobics branch: duration entered in MINUTES → duration_seconds ×60,
      // body_part 'Aerobics Activity', set_number kept.
      for (const ex of validSets) {
        const sets = ex.sets.filter((st) => (st.duration ?? '').trim());
        sets.forEach((st, i) => {
          rows.push({
            session_id: sessionId,
            session_name: sessionName || 'Workout Session',
            session_date: sessionDate,
            body_part: 'Aerobics Activity',
            exercise_name: ex.name.trim(),
            measurement_type: 'reps', // web omits it on this branch → DB default 'reps' (kept for data parity)
            set_number: i + 1,
            reps_performed: null,
            duration_seconds: parseInt(st.duration!, 10) * 60,
            load_performed: null,
            sub_activity: null,
            exercise_notes: s(st.note) ?? (ex.notes?.trim() || null),
            remark: takeRemark(),
            modality,
            client_id: clientId,
            trainer_id: trainerId,
          });
        });
      }
    } else {
      // Strength / Pilates / Aqua Aerobics / Custom — the generic set model.
      for (const ex of validSets) {
        const isDur = ex.measurement === 'duration';
        const sets = ex.sets.filter((st) => st.reps.trim() || st.load.trim() || (st.duration ?? '').trim());
        sets.forEach((st, i) => {
          rows.push({
            session_id: sessionId,
            session_name: sessionName || 'Workout Session',
            session_date: sessionDate,
            body_part: s(ex.body_part) ?? (sessionName || null),
            exercise_name: ex.name.trim(),
            measurement_type: isDur ? 'duration' : 'reps',
            set_number: i + 1,
            tempo: s(st.tempo),
            rest_period: s(st.rest),
            rm_percentage: s(st.rmPct),
            reps_performed: isDur ? null : (st.reps.trim() ? Number(st.reps) : null),
            duration_seconds: isDur ? ((st.duration ?? '').trim() ? Number(st.duration) : null) : null,
            load_performed: st.load.trim() ? String(st.load.trim()) : null, // free text — bodyweight expressions allowed
            rir_performed: s(st.rir),
            super_set_group: s(st.superset),
            equipment: s(st.equipment),
            sub_activity: null,
            exercise_notes: s(st.note) ?? (ex.notes?.trim() || null),
            remark: takeRemark(),
            modality,
            client_id: clientId,
            trainer_id: trainerId,
          });
        });
      }
    }
    const { error } = await supabase.from('workout_exercises').insert(rows);
    if (error) throw new Error(error.message);
  }

  // Web post-insert steps (non-fatal, idempotent):
  // 1. Link the schedule slot on training_sessions, then patch session_schedule so
  //    Today's Roster flips to "Logged" (guarded — never clobbers an existing link).
  if (scheduleSessionId) {
    try {
      await supabase.from('training_sessions').update({ schedule_session_id: scheduleSessionId }).eq('workout_session_id', sessionId);
    } catch { /* non-fatal (web parity) */ }
    try {
      await supabase.from('session_schedule').update({ workout_session_id: sessionId }).eq('id', scheduleSessionId).is('workout_session_id', null);
    } catch { /* non-fatal */ }
  }
  // 2. RPE on the auto-created training_sessions row (integer, web parity).
  if (rpe != null) {
    await supabase.from('training_sessions').update({ rpe: Math.round(rpe) }).eq('workout_session_id', sessionId);
  }
  // 3. Training-partner group id (shared across the two parallel sessions).
  if (partnerSessionGroupId) {
    try {
      await supabase.from('training_sessions').update({ partner_session_group_id: partnerSessionGroupId }).eq('workout_session_id', sessionId);
    } catch { /* non-fatal */ }
  }
  return { sessionId };
}

/* Web checkDuplicateWorkoutSession: is there already a session TODAY (local-day
   boundary on created_at) for this client+trainer that matches the modality?
   Yoga/Boxing match by activity body_part or a name containing yoga/boxing;
   everything else matches session_name === the would-be session name. */
export async function checkDuplicateWorkoutToday(input: { clientId: string; trainerId: string; sessionModality: string }): Promise<boolean> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const { data, error } = await supabase
    .from('workout_exercises')
    .select('session_id, session_name, body_part')
    .eq('client_id', input.clientId)
    .eq('trainer_id', input.trainerId)
    .gte('created_at', today.toISOString())
    .lt('created_at', tomorrow.toISOString());
  if (error) return false; // web behavior: allow on error, never block on the guard
  const target = input.sessionModality;
  const tLower = target.toLowerCase();
  return ((data ?? []) as any[]).some((row) => {
    const nameLower = (row.session_name ?? '').toLowerCase();
    if (tLower.includes('yoga')) return row.body_part === 'Yoga Activity' || nameLower.includes('yoga');
    if (tLower.includes('boxing')) return row.body_part === 'Boxing Activity' || nameLower.includes('boxing');
    return row.session_name === target;
  });
}

/* Training partner detection (web WorkoutSessionForm checkPartner): the client's
   clients.training_partner_id, then the OTHER client sharing that id. */
export function usePartnerInfo(clientId: string | null) {
  return useQuery({
    queryKey: ['training-partner', clientId],
    enabled: !!clientId,
    staleTime: 300_000,
    queryFn: async (): Promise<{ id: string; name: string } | null> => {
      const { data: me, error } = await supabase.from('clients').select('training_partner_id').eq('id', clientId).maybeSingle();
      if (error) throw new Error(error.message);
      if (!me?.training_partner_id) return null;
      const { data: partner } = await supabase
        .from('clients')
        .select('id, first_name, last_name')
        .eq('training_partner_id', me.training_partner_id)
        .neq('id', clientId)
        .maybeSingle();
      if (!partner) return null;
      const name = `${partner.first_name ?? ''} ${partner.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || 'Partner';
      return { id: partner.id, name };
    },
  });
}

/* ---------- Approved plans for the logging form (web useLocalFirstApprovedWorkoutPlans) ----------
   workout_plan_exercises status='approved', grouped per plan_id, EXPIRED PLANS DROPPED
   (42-day isPlanValid rule — the canonical web behavior since availableModalities is
   filtered on it). plansByModality keyed by BOTH the DB modality ('Strength Training')
   and the UI name ('Strength'), newest-approved plan first-wins. Feeds: ✅ modality
   indicators, the body-part selector, plan pre-population, and Custom-modality access. */
export type PlanExerciseRow = {
  body_part: string | null; exercise_name: string; set_number: string | null;
  tempo: string | null; rest_period: string | null; rm_percentage: string | null;
  reps_target: string | null; load_target: string | null; super_set_group: string | null;
  exercise_notes: string | null; duration: string | null; measurement_type: string | null;
  created_at: string | null;
};
export type ApprovedPlanForLogging = { plan_id: string; modality: string | null; approved_at: string | null; exercises: PlanExerciseRow[] };
export type ApprovedPlansData = {
  availableModalities: string[];
  plansByModality: Record<string, ApprovedPlanForLogging>;
};
const DB_TO_UI_MODALITY: Record<string, string> = {
  'Strength Training': 'Strength', Yoga: 'Yoga', Boxing: 'Boxing', Pilates: 'Pilates', Aerobics: 'Aerobics', Custom: 'Custom',
};
export function useApprovedPlansForLogging(clientId: string | null) {
  return useQuery({
    queryKey: ['approved-plans-logging', clientId],
    enabled: !!clientId,
    staleTime: 60_000,
    queryFn: async (): Promise<ApprovedPlansData> => {
      const { data, error } = await supabase
        .from('workout_plan_exercises')
        .select('plan_id, modality, approved_at, body_part, exercise_name, set_number, tempo, rest_period, rm_percentage, reps_target, load_target, super_set_group, exercise_notes, duration, measurement_type, created_at')
        .eq('client_id', clientId)
        .eq('status', 'approved')
        .order('approved_at', { ascending: false })
        .order('plan_id')
        .order('created_at', { ascending: true });
      if (error) throw new Error(error.message);
      const planMap = new Map<string, ApprovedPlanForLogging>();
      for (const r of (data ?? []) as any[]) {
        if (!planMap.has(r.plan_id)) planMap.set(r.plan_id, { plan_id: r.plan_id, modality: r.modality ?? null, approved_at: r.approved_at ?? null, exercises: [] });
        planMap.get(r.plan_id)!.exercises.push(r);
      }
      const now = Date.now();
      // isPlanValid: approved within PLAN_VALID_DAYS (42) — the canonical web rule.
      let allPlans = [...planMap.values()].filter((p) => p.approved_at && new Date(p.approved_at).getTime() + PLAN_VALID_DAYS * 864e5 > now);
      allPlans.sort((a, b) => new Date(b.approved_at || '').getTime() - new Date(a.approved_at || '').getTime());
      const plansByModality: Record<string, ApprovedPlanForLogging> = {};
      const availableModalities: string[] = [];
      allPlans.forEach((plan) => {
        const dbModality = plan.modality || 'Other';
        const uiModality = DB_TO_UI_MODALITY[dbModality] || dbModality;
        if (!plansByModality[dbModality]) plansByModality[dbModality] = plan;
        if (!plansByModality[uiModality]) plansByModality[uiModality] = plan;
        if (!availableModalities.includes(uiModality)) availableModalities.push(uiModality);
      });
      return { availableModalities, plansByModality };
    },
  });
}

/* ---------- Previous-session values per exercise (web useClientPreviousExerciseData) ----------
   client_id only (no trainer/modality filter), newest first; the FIRST session seen per
   exercise name wins; sets sorted by set_number and matched by POSITIONAL index. Feeds
   the "Last: X" placeholders and the ≥2× sanity warning. */
export type PrevSet = { load: string | null; reps: number | null; rest: string | null; tempo: string | null; durationSeconds: number | null };
export function usePreviousExerciseData(clientId: string | null) {
  return useQuery({
    queryKey: ['prev-exercise-data', clientId],
    enabled: !!clientId,
    staleTime: 0,
    queryFn: async (): Promise<Record<string, PrevSet[]>> => {
      const { data, error } = await supabase
        .from('workout_exercises')
        .select('exercise_name, set_number, load_performed, reps_performed, rest_period, tempo, duration_seconds, session_date, session_id, created_at')
        .eq('client_id', clientId)
        .order('session_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1000);
      if (error) throw new Error(error.message);
      const byExercise = new Map<string, { key: string; sets: any[] }>();
      for (const r of (data ?? []) as any[]) {
        const name = (r.exercise_name ?? '').toLowerCase().trim();
        if (!name) continue;
        const sessionKey = r.session_id ?? r.session_date;
        let e = byExercise.get(name);
        if (!e) { e = { key: sessionKey, sets: [] }; byExercise.set(name, e); }
        if (e.key === sessionKey) e.sets.push(r);
      }
      const out: Record<string, PrevSet[]> = {};
      for (const [name, e] of byExercise) {
        // Legacy sessions can contain ghost rows — a duplicate set_number with
        // reps/load/duration ALL null (seen live: 4 rows for a 3-set exercise).
        // Index-mapping those into placeholders shifts every "Last:" value by
        // one and blanks set 1, so drop value-less rows and dedupe set numbers
        // (rows arrive latest-first; the first kept row wins).
        const meaningful = e.sets.filter((r) => r.reps_performed != null || r.load_performed != null || r.duration_seconds != null);
        const bySetNo = new Map<number, any>();
        for (const r of meaningful) { const k = r.set_number ?? 0; if (!bySetNo.has(k)) bySetNo.set(k, r); }
        e.sets = [...bySetNo.values()];
        e.sets.sort((a, b) => (a.set_number ?? 0) - (b.set_number ?? 0));
        out[name] = e.sets.map((r) => ({
          load: r.load_performed ?? null,
          reps: r.reps_performed ?? null,
          rest: r.rest_period != null ? String(r.rest_period) : null,
          tempo: r.tempo ?? null,
          durationSeconds: r.duration_seconds ?? null,
        }));
      }
      return out;
    },
  });
}

/* ---------- Plan gate for logging (mirrors the web "3 plan-less sessions" rule) ----------
   Without an approved, non-expired plan for the selected modality (or an approved
   document plan), a trainer may log at most 3 sessions of that modality for the
   client. Count = distinct workout_exercises.session_id for client+trainer+modality
   (Strength also counts legacy rows: null modality + a body_part). Plan validity =
   workout_plan_exercises status 'approved' and approved_at within 42 days. */
const PLAN_VALID_DAYS = 42;
const PLANLESS_LIMIT = 3;
const normModality = (m?: string | null) => (m || '').toLowerCase().replace(/training/g, '').replace(/[^a-z]/g, '');

export type ModalityGate = {
  hasValidPlan: boolean;
  loggedCount: number;
  limit: number;
  remaining: number;
  blocked: boolean;
  warning: boolean;
};
export function useModalityGate(clientId: string | null, trainerId: string | null, modality: string | null) {
  return useQuery({
    queryKey: ['modality-gate', clientId, trainerId, normModality(modality)],
    enabled: !!clientId && !!trainerId && !!modality,
    staleTime: 30_000,
    queryFn: async (): Promise<ModalityGate> => {
      const target = normModality(modality);
      const isStrength = target === 'strength';
      // 1. Distinct logged sessions for this modality (plan-less grace counter).
      //    Paged past the 1000-row cap — undercounting would wrongly reopen the gate.
      const exRows: any[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error: exErr } = await supabase
          .from('workout_exercises')
          .select('session_id, modality, body_part')
          .eq('client_id', clientId)
          .eq('trainer_id', trainerId)
          .not('session_id', 'is', null)
          .range(from, from + 999);
        if (exErr) throw new Error(exErr.message);
        exRows.push(...(data ?? []));
        if (!data || data.length < 1000) break;
      }
      const sessions = new Set<string>();
      for (const r of (exRows ?? []) as any[]) {
        const rm = normModality(r.modality);
        if (rm === target || (isStrength && !r.modality && r.body_part)) sessions.add(r.session_id);
      }
      const loggedCount = sessions.size;
      // 2. Approved, non-expired exercise plan for this modality.
      const { data: planRows } = await supabase
        .from('workout_plan_exercises')
        .select('modality, approved_at')
        .eq('client_id', clientId)
        .eq('status', 'approved');
      const now = Date.now();
      const hasExercisePlan = (planRows ?? []).some(
        (p: any) => normModality(p.modality) === target && p.approved_at && new Date(p.approved_at).getTime() + PLAN_VALID_DAYS * 864e5 > now
      );
      // 3. Approved document plan (any modality) also counts as "has plan".
      const { data: docRows } = await supabase
        .from('client_training_plans')
        .select('id')
        .eq('client_id', clientId)
        .eq('status', 'approved')
        .limit(1);
      const hasValidPlan = hasExercisePlan || (docRows?.length ?? 0) > 0;
      return {
        hasValidPlan,
        loggedCount,
        limit: PLANLESS_LIMIT,
        remaining: Math.max(0, PLANLESS_LIMIT - loggedCount),
        blocked: !hasValidPlan && loggedCount >= PLANLESS_LIMIT,
        warning: !hasValidPlan && loggedCount === PLANLESS_LIMIT - 1,
      };
    },
  });
}

/* ---------- Workout Templates ----------
   Single denormalized table `workout_templates`: one row per set/activity, grouped
   by `template_id`; metadata (name/modality/description/trainer_id) duplicated on
   every row. RLS restricts to the trainer's own (auth.uid() = trainer_id). */
export type WorkoutTemplate = {
  template_id: string;
  template_name: string;
  modality: string;
  description: string | null;
  created_at: string | null;
  exerciseCount: number;
  rows: any[]; // ordered by exercise_order, then set_number
};
// App modality (lowercase) → template modality (matches the web CHECK constraint).
const APP_TO_TPL_MODALITY: Record<string, string> = {
  strength: 'Strength Training', yoga: 'Yoga', boxing: 'Boxing', pilates: 'Pilates', aerobics: 'Aerobics', 'aqua aerobics': 'Custom',
};

export function useWorkoutTemplates(trainerId: string | null) {
  return useQuery({
    queryKey: ['workout-templates', trainerId],
    enabled: !!trainerId,
    staleTime: 60_000,
    queryFn: async (): Promise<WorkoutTemplate[]> => {
      const { data, error } = await supabase
        .from('workout_templates')
        .select('*')
        .eq('trainer_id', trainerId)
        .order('created_at', { ascending: false })
        .order('exercise_order', { ascending: true })
        .order('set_number', { ascending: true, nullsFirst: true });
      if (error) throw new Error(error.message);
      const map = new Map<string, WorkoutTemplate>();
      for (const r of (data ?? []) as any[]) {
        const tid = r.template_id || r.id;
        if (!map.has(tid)) map.set(tid, { template_id: tid, template_name: r.template_name, modality: r.modality, description: r.description ?? null, created_at: r.created_at ?? null, exerciseCount: 0, rows: [] });
        map.get(tid)!.rows.push(r);
      }
      const out = Array.from(map.values());
      out.forEach((t) => { t.exerciseCount = new Set(t.rows.map((r) => (r.exercise_name || '').toLowerCase())).size; });
      return out;
    },
  });
}

export function useSaveWorkoutTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { trainerId: string; name: string; modality: string; description?: string; sessionName?: string; exercises: WorkoutExerciseInput[] }) => {
      const { trainerId, name, modality, description, sessionName, exercises } = input;
      if (!name.trim()) throw new Error('Enter a template name');
      const templateId = uuidv4();
      const m = modality.toLowerCase();
      const dbModality = APP_TO_TPL_MODALITY[m] ?? 'Custom';
      const isYoga = m === 'yoga', isBoxing = m === 'boxing', isActivity = isYoga || isBoxing;
      const base = { template_id: templateId, trainer_id: trainerId, template_name: name.trim(), modality: dbModality, description: description?.trim() || null };
      const rows: any[] = [];
      if (isActivity) {
        exercises.filter((e) => e.name.trim() && e.completed !== false).forEach((ex, i) => {
          rows.push({
            ...base, body_part: isBoxing ? 'Boxing Activity' : 'Yoga Activity',
            exercise_name: ex.name.trim(), exercise_order: i, set_number: null,
            activity_type: ex.activityType || 'Constant',
            duration_minutes: isBoxing && (ex.durationMin ?? '').trim() ? Number(ex.durationMin) : null,
            rounds: isBoxing && (ex.rounds ?? '').trim() ? Number(ex.rounds) : null,
          });
        });
      } else {
        exercises.filter((e) => e.name.trim() && e.sets.some((s) => s.reps.trim() || s.load.trim() || (s.duration ?? '').trim())).forEach((ex, i) => {
          const isDur = ex.measurement === 'duration';
          ex.sets.filter((s) => s.reps.trim() || s.load.trim() || (s.duration ?? '').trim()).forEach((st, si) => {
            const loadNum = st.load.trim() && !isNaN(Number(st.load)) ? Number(st.load) : null;
            rows.push({
              ...base, body_part: (ex.body_part || '').trim() || (sessionName || '').trim() || ex.name.trim(),
              exercise_name: ex.name.trim(), exercise_order: i, set_number: si + 1,
              reps_assigned: !isDur && st.reps.trim() ? Number(st.reps) : null,
              load_assigned: loadNum,
              duration_seconds: isDur && (st.duration ?? '').trim() ? Number(st.duration) : null,
              exercise_notes: (st.note ?? '').trim() || null,
            });
          });
        });
      }
      if (!rows.length) throw new Error('Nothing to save — add exercises first');
      const { error } = await supabase.from('workout_templates').insert(rows);
      if (error) throw new Error(error.message);
      return { templateId };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workout-templates'] }),
  });
}

export function useDeleteWorkoutTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (templateId: string) => {
      const { error } = await supabase.from('workout_templates').delete().eq('template_id', templateId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workout-templates'] }),
  });
}

export function useCreateWorkoutSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: submitWorkoutLog,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trainer-roster'] });
      qc.invalidateQueries({ queryKey: ['client-sessions'] });
      qc.invalidateQueries({ queryKey: ['trainer-month-sessions'] });
    },
  });
}

/* ---------- My Clients list (mirrors useLocalFirstTrainerClients) ---------- */
export type MyClientRow = {
  client_id: string;
  full_name: string;
  phone: string | null;
  status: string | null;
  subscription_type: string | null;
  cycle_sessions: number;
  sessions_in_cycle: number;
  sessions_30d: number; // completed non-rehab sessions in the rolling last 30 days
  has_plan: boolean;
  crm_name: string | null;
  crm_phone: string | null;
};

export function useMyClients(trainerId: string) {
  return useQuery({
    queryKey: ['my-clients', trainerId],
    enabled: !!trainerId,
    staleTime: 60_000,
    queryFn: async (): Promise<MyClientRow[]> => {
      const { data: assigned, error } = await supabase
        .from('trainer_clients')
        .select('client:clients(id, first_name, last_name, phone, status, subscription_type, sessions_per_cycle, created_at, client_training_plans(id))')
        .eq('actively_training', true)
        .eq('trainer_id', trainerId);
      if (error) throw new Error(error.message);

      const clientIds = (assigned ?? []).map((a: any) => a.client?.id).filter(Boolean);

      // Completed sessions in the LAST 30 DAYS (rolling window), counted per client in one query.
      const monthStartISO = new Date(Date.now() - 30 * 864e5).toISOString();
      const nextStartISO = new Date().toISOString();
      // Rehab / recovery modalities are NOT training sessions — they must not
      // inflate the client card's monthly session count.
      const REHAB_SESSION_TYPES = new Set([
        'rehabilitation', 'recovery', 'physiotherapy', 'massage_therapy', 'red_light_therapy',
        'cold_bath_therapy', 'pneumatic_therapy', 'cupping_therapy', 'dry_needling', 'cryotherapy',
      ]);
      const monthCount = new Map<string, number>();
      if (clientIds.length > 0) {
        const { data: monthSess } = await supabase
          .from('training_sessions')
          .select('client_id, session_type')
          .in('client_id', clientIds)
          .eq('status', 'completed')
          .gte('scheduled_at', monthStartISO)
          .lt('scheduled_at', nextStartISO);
        (monthSess ?? []).forEach((r: any) => {
          if (REHAB_SESSION_TYPES.has(r.session_type)) return; // skip rehab/recovery
          monthCount.set(r.client_id, (monthCount.get(r.client_id) ?? 0) + 1);
        });
      }

      // Assigned CRM per client: a trainer_clients row whose linked profile has role 'crm'.
      const crmMap = new Map<string, { name: string; phone: string | null }>();
      if (clientIds.length > 0) {
        const { data: crmRows } = await supabase
          .from('trainer_clients')
          .select('client_id, profiles:trainer_id(first_name, last_name, role, phone)')
          .in('client_id', clientIds)
          .eq('actively_training', true);
        (crmRows ?? []).forEach((r: any) => {
          if (r.profiles?.role === 'crm' && !crmMap.has(r.client_id)) {
            const nm = `${r.profiles.first_name ?? ''} ${r.profiles.last_name ?? ''}`.replace(/\s+/g, ' ').trim();
            if (nm) crmMap.set(r.client_id, { name: nm, phone: r.profiles.phone ?? null });
          }
        });
      }

      const rows = await Promise.all(
        (assigned ?? []).map(async (item: any) => {
          const c = item.client;
          if (!c) return null;
          const { data: renewals } = await supabase
            .from('client_renewals')
            .select('renewed_at, cycle_sessions')
            .eq('client_id', c.id)
            .order('renewed_at', { ascending: false })
            .limit(1);
          const latest = renewals?.[0];
          const startDate = latest?.renewed_at || c.created_at;
          const perCycle = latest?.cycle_sessions || c.sessions_per_cycle || 0;
          const { data: sess } = await supabase
            .from('training_sessions')
            .select('id')
            .eq('client_id', c.id)
            .or('status.eq.completed,status.eq.cancelled,cancelled.eq.true')
            .gte('scheduled_at', startDate);
          const used = sess?.length ?? 0;
          const inCycle = perCycle > 0 ? used % perCycle : used;
          return {
            client_id: c.id,
            full_name: `${c.first_name ?? ''} ${c.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || 'Client',
            phone: c.phone ?? null,
            status: c.status ?? null,
            subscription_type: c.subscription_type ?? null,
            cycle_sessions: perCycle,
            sessions_in_cycle: inCycle,
            sessions_30d: monthCount.get(c.id) ?? 0,
            has_plan: (c.client_training_plans?.length ?? 0) > 0,
            crm_name: crmMap.get(c.id)?.name ?? null,
            crm_phone: crmMap.get(c.id)?.phone ?? null,
          } as MyClientRow;
        })
      );
      return rows.filter(Boolean) as MyClientRow[];
    },
  });
}

/* ---------- Client Detail: info grid ---------- */
export type ClientDetail = {
  client: any;
  basicInfo: { clientAge?: any; clientGender?: any; clientHeight?: any; clientWeight?: any; clientWaist?: any } | null;
  vo2max: number | string | null;
  renewal: any | null;
  crm: { name: string; phone: string | null } | null;
  /** Tier for the Services drawer: profiles.subscription_type wins for app (B2C) clients, else clients.subscription_type. */
  serviceTier: string | null;
};

export function useClientDetail(clientId: string | null) {
  return useQuery({
    queryKey: ['client-detail', clientId],
    enabled: !!clientId,
    staleTime: 120_000,
    queryFn: async (): Promise<ClientDetail> => {
      const [clientR, assessR, bioR, renewR, qhpR, crmR, progR, dhmR] = await Promise.all([
        supabase.from('clients').select('id, profile_id, first_name, last_name, email, phone, date_of_birth, status, session_package, sessions_per_cycle, cycle_type, package_duration, subscription_type, client_type, location, brb_location, is_monthly_subscription, is_hybrid, created_at').eq('id', clientId).maybeSingle(),
        supabase.from('coach_assessment').select('qhp_data, new_client_assessment_data, existing_client_assessment_data, assessment_date').eq('client_id', clientId).order('assessment_date', { ascending: false }).limit(10),
        supabase.from('biological_age_history').select('vo2_max, calculation_date').eq('client_id', clientId).not('vo2_max', 'is', null).order('calculation_date', { ascending: false }).limit(1),
        supabase.from('client_renewals').select('renewed_at, package_sessions, cycle_sessions, package_duration, cycle_type').eq('client_id', clientId).order('renewed_at', { ascending: false }).limit(1),
        // VO₂ max fallback: latest QHP report's cardiovascular marker (text like "28.5 ml/kg/min")
        supabase.from('qhp_details').select('vo2:qhp_json->cardiovascular_markers->>vo2_max, created_at').eq('client_id', clientId).order('created_at', { ascending: false }).limit(1),
        // Assigned CRM: a trainer_clients row whose linked profile has role 'crm'.
        supabase.from('trainer_clients').select('profiles:trainer_id(first_name, last_name, role, phone)').eq('client_id', clientId).eq('actively_training', true),
        // VO₂ max source #1: latest non-null client_progress entry (trainer-logged / QHP-seeded)
        supabase.from('client_progress').select('vo2_max, created_at').eq('client_id', clientId).not('vo2_max', 'is', null).order('created_at', { ascending: false }).limit(1),
        // VO₂ max source #4: device-derived (WHOOP / Apple Health) daily metric
        supabase.from('daily_health_metrics').select('vo2_max, metric_date').eq('client_id', clientId).not('vo2_max', 'is', null).order('metric_date', { ascending: false }).limit(1),
      ]);
      if (clientR.error) throw new Error(clientR.error.message);
      const a: any = assessR.data?.[0]?.new_client_assessment_data ?? assessR.data?.[0]?.existing_client_assessment_data ?? null;
      const basicInfo = a?.['Standardized Assessment']?.clientProfile?.basicInfo ?? a?.clientProfile?.basicInfo ?? null;
      const qhpVo2 = String((qhpR.data?.[0] as any)?.vo2 ?? '').trim();
      const crmProfile = (crmR.data ?? []).map((r: any) => r.profiles).find((p: any) => p?.role === 'crm') ?? null;
      const crmName = crmProfile ? `${crmProfile.first_name ?? ''} ${crmProfile.last_name ?? ''}`.replace(/\s+/g, ' ').trim() : '';
      // Services tier: for app-linked (B2C) clients the profile's subscription wins over the clients row.
      let serviceTier: string | null = clientR.data?.subscription_type ?? null;
      if (clientR.data?.profile_id) {
        const { data: prof } = await supabase.from('profiles').select('subscription_type').eq('id', clientR.data.profile_id).maybeSingle();
        if (prof?.subscription_type) serviceTier = prof.subscription_type;
      }
      // VO₂ max from coach_assessment QHP JSONs: the value lives at goal-dependent
      // paths (e.g. Standardized Assessment → assessmentTests → goalBasedTests →
      // <goal> → vo2MaxPerformance, or Existing Client Re-Assessment →
      // biomechanicalAssessment → vo2MaxLongevity), so deep-scan every assessment
      // newest-first across all three JSON columns and take the first real value.
      const vo2FromAssessments = (() => {
        const skip = /method|heart|time|duration|rate|unit/i; // vo2MaxHeartRate etc. are NOT vo2 values
        const scan = (obj: any, depth = 0): number | null => {
          if (!obj || typeof obj !== 'object' || depth > 8) return null;
          for (const [k, v] of Object.entries(obj)) {
            if (/vo2/i.test(k) && !skip.test(k)) {
              const n = parseFloat(String(v));
              if (isFinite(n) && n >= 10 && n <= 95) return n; // plausible ml/kg/min
            }
            if (v && typeof v === 'object') {
              const r = scan(v, depth + 1);
              if (r != null) return r;
            }
          }
          return null;
        };
        for (const row of (assessR.data ?? []) as any[]) {
          for (const col of ['qhp_data', 'new_client_assessment_data', 'existing_client_assessment_data']) {
            const r = scan(row[col]);
            if (r != null) return r;
          }
        }
        return null;
      })();

      // VO₂ max resolution order:
      // client_progress → coach_assessment (latest with a value) → QHP report marker
      // → biological_age_history → device metric
      const vo2max =
        progR.data?.[0]?.vo2_max ??
        vo2FromAssessments ??
        (qhpVo2 || null) ??
        bioR.data?.[0]?.vo2_max ??
        dhmR.data?.[0]?.vo2_max ??
        null;
      return {
        client: clientR.data,
        basicInfo,
        vo2max,
        renewal: renewR.data?.[0] ?? null,
        crm: crmName ? { name: crmName, phone: crmProfile.phone ?? null } : null,
        serviceTier,
      };
    },
  });
}

/* ---------- Daily habit stats: sleep / steps / nutrition, last 5 IST days ----------
   Mirrors the web useLatestClientStats:
   • sleep     → daily_health_metrics.sleep_duration_minutes (÷60), fallback daily_sleep_logs.hours_slept
   • steps     → daily_health_metrics.steps_count, fallback nutrition_tracker.steps_by_trainer
   • nutrition → nutrition_tracker.nutrition_rating
   Multiple rows can exist per date; first non-null in (date desc, created_at desc) order wins. */
export type DailyStatRow = { ymd: string; label: string; sleep: number | null; steps: number | null; nutrition: number | null };

const istYmdOfDate = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

export function useClientDailyStats(clientId: string | null) {
  return useQuery({
    queryKey: ['client-daily-stats', clientId],
    enabled: !!clientId,
    queryFn: async (): Promise<DailyStatRow[]> => {
      const [nutR, dhmR, slpR] = await Promise.all([
        supabase.from('nutrition_tracker').select('rating_date, nutrition_rating, steps_by_trainer, created_at').eq('client_id', clientId).order('rating_date', { ascending: false }).order('created_at', { ascending: false }).limit(25),
        supabase.from('daily_health_metrics').select('metric_date, sleep_duration_minutes, steps_count, created_at').eq('client_id', clientId).order('metric_date', { ascending: false }).order('created_at', { ascending: false }).limit(25),
        supabase.from('daily_sleep_logs').select('log_date, hours_slept').eq('client_id', clientId).order('log_date', { ascending: false }).limit(25),
      ]);
      const pick = (rows: any[] | null | undefined, dateKey: string, ymd: string, val: (r: any) => any): any => {
        for (const r of rows ?? []) {
          if (String(r[dateKey] ?? '').slice(0, 10) !== ymd) continue;
          const v = val(r);
          if (v != null) return v;
        }
        return null;
      };
      const out: DailyStatRow[] = [];
      for (let i = 0; i < 5; i++) {
        const d = new Date(Date.now() - i * 864e5);
        const ymd = istYmdOfDate(d);
        const sleepMin = pick(dhmR.data, 'metric_date', ymd, (r) => r.sleep_duration_minutes);
        const sleep = sleepMin != null ? +((sleepMin as number) / 60).toFixed(1) : pick(slpR.data, 'log_date', ymd, (r) => r.hours_slept);
        const steps = pick(dhmR.data, 'metric_date', ymd, (r) => r.steps_count) ?? pick(nutR.data, 'rating_date', ymd, (r) => r.steps_by_trainer);
        const nutrition = pick(nutR.data, 'rating_date', ymd, (r) => r.nutrition_rating);
        const label = i === 0 ? 'Today' : i === 1 ? 'Yesterday' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
        out.push({ ymd, label, sleep, steps, nutrition });
      }
      return out;
    },
  });
}

/* ---------- Session Handoff popup (mirrors usePreviousTrainerSession) ----------
   Shown when a trainer opens a client page and (a) the client's last workout was
   logged by a DIFFERENT trainer than today's scheduled one, or (b) the client has
   a doctor/physio session to hand off. One popup per trainer+client per IST day,
   gated by an event_acknowledgement row (title 'Session Summary'). */

// Canonical doctor/physio whitelist — keep in sync with doctorQueries.DOCTOR_SESSION_TYPES.
const HANDOFF_DOCTOR_SESSION_TYPES = [
  'rehabilitation', 'physiotherapy', 'massage_therapy', 'red_light_therapy',
  'cold_bath_therapy', 'pneumatic_therapy', 'cupping_therapy', 'dry_needling',
  'cryotherapy', 'pneumatic_compression_therapy', 'cognitive_entrainment_device',
  'pemf_mat_therapy', 'mayo_facial_release', 'tapping', 'stretching',
  'strengthening_exercises', 'manual_releases', 'neural_check', 'other', 'recovery',
];

/* functions.invoke can keep the anon-key Authorization header when the session was
   restored from storage — always attach the live access token (same fix as doctorQueries). */
async function invokeEdgeFn(name: string, body: any) {
  let { data } = await supabase.auth.getSession();
  if (!data.session) {
    await new Promise((r) => setTimeout(r, 450));
    ({ data } = await supabase.auth.getSession());
  }
  const token = data.session?.access_token;
  return supabase.functions.invoke(name, { body, ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}) });
}

export type HandoffDoctorSession = { sessionTypes: string[]; sessionDate: string; doctorName: string; notes: string | null };
export type HandoffData = {
  sessionDate: string; trainerName: string; trainerId: string; sessionName: string;
  exercises: any[]; aiSummary?: string; lastDoctorSession?: HandoffDoctorSession; doctorSummary?: string;
};

export function usePreviousTrainerSession(clientId: string | null) {
  const istToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return useQuery({
    queryKey: ['previous-trainer-session', clientId, istToday],
    enabled: !!clientId,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<{ showPreviousSession: boolean; previousSession: HandoffData | null }> => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!clientId || !uid) return { showPreviousSession: false, previousSession: null };

      // Step 0 — per-day dedupe: already acknowledged today (IST window → UTC bounds)?
      const istStartUtcMs = Date.UTC(+istToday.slice(0, 4), +istToday.slice(5, 7) - 1, +istToday.slice(8, 10)) - 330 * 60 * 1000;
      const istStartIso = new Date(istStartUtcMs).toISOString();
      const istEndIso = new Date(istStartUtcMs + 24 * 60 * 60 * 1000).toISOString();
      const { data: ackRows } = await supabase
        .from('event_acknowledgement').select('id')
        .eq('user_id', uid).eq('reference_id', clientId).eq('title', 'Session Summary')
        .gte('created_at', istStartIso).lt('created_at', istEndIso).limit(1);
      if (ackRows && ackRows.length > 0) return { showPreviousSession: false, previousSession: null };

      // Step 1 — last doctor/physio session (only rows logged by an actual doctor profile)
      const { data: doctorSessions } = await supabase
        .from('training_sessions').select('session_type, scheduled_at, trainer_id, notes')
        .eq('client_id', clientId).in('session_type', HANDOFF_DOCTOR_SESSION_TYPES)
        .order('scheduled_at', { ascending: false }).limit(50);
      let lastDoctorSession: HandoffDoctorSession | undefined;
      if (doctorSessions && doctorSessions.length > 0) {
        const trainerIds = [...new Set(doctorSessions.map((s: any) => s.trainer_id).filter(Boolean))] as string[];
        let doctorIds = new Set<string>();
        if (trainerIds.length > 0) {
          const { data: doctorProfiles } = await supabase.from('profiles').select('id, role').in('id', trainerIds).eq('role', 'doctor');
          doctorIds = new Set((doctorProfiles || []).map((p: any) => p.id));
        }
        const doctorOnly = doctorSessions.filter((s: any) => s.trainer_id && doctorIds.has(s.trainer_id));
        if (doctorOnly.length > 0) {
          const latest: any = doctorOnly[0];
          const latestDate = latest.scheduled_at?.split('T')[0];
          const sameDoctorSameDay = doctorOnly.filter((s: any) => s.scheduled_at?.split('T')[0] === latestDate && s.trainer_id === latest.trainer_id);
          const sessionTypes = [...new Set(sameDoctorSameDay.map((s: any) => s.session_type).filter(Boolean))] as string[];
          const allNotes = sameDoctorSameDay.map((s: any) => s.notes).filter(Boolean).join('; ');
          let doctorName = 'Unknown';
          const { data: docProfile } = await supabase.from('profiles').select('first_name, last_name').eq('id', latest.trainer_id).single();
          if (docProfile) doctorName = `${docProfile.first_name ?? ''} ${docProfile.last_name ?? ''}`.replace(/\s+/g, ' ').trim();
          lastDoctorSession = { sessionTypes, sessionDate: latestDate || '', doctorName, notes: allNotes || null };
        }
      }

      // Step 2 — today's scheduled trainer (fallback: the viewer)
      const today = new Date();
      const todayDateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowDateStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
      const { data: todaySession } = await supabase
        .from('session_schedule').select('trainer_id').eq('client_id', clientId)
        .gte('scheduled_datetime', todayDateStr).lt('scheduled_datetime', tomorrowDateStr)
        .order('scheduled_datetime', { ascending: true }).limit(1).maybeSingle();
      const todayTrainerId = todaySession?.trainer_id || uid;

      // Step 3 — most recent workout session before today
      const { data: lastExercises, error } = await supabase
        .from('workout_exercises').select('session_id, session_name, session_date, trainer_id')
        .eq('client_id', clientId).lt('session_date', todayDateStr)
        .order('session_date', { ascending: false }).limit(1);

      if (error || !lastExercises?.length) {
        if (lastDoctorSession) {
          let doctorSummary = '';
          try {
            const { data: fnData } = await invokeEdgeFn('summarize-previous-session', { exercises: [], trainerName: '', sessionDate: '', sessionName: '', lastDoctorSession });
            doctorSummary = (fnData as any)?.doctorSummary || '';
          } catch {}
          return {
            showPreviousSession: true,
            previousSession: { sessionDate: '', trainerName: '', trainerId: '', sessionName: '', exercises: [], aiSummary: '', lastDoctorSession, doctorSummary },
          };
        }
        return { showPreviousSession: false, previousSession: null };
      }

      const lastSession: any = lastExercises[0];
      const lastTrainerId = lastSession.trainer_id;

      // Step 4 — handoff decision
      const trainerChanged = lastTrainerId && lastTrainerId !== todayTrainerId;
      if (!trainerChanged && !lastDoctorSession) return { showPreviousSession: false, previousSession: null };

      // Step 5 — full previous workout + trainer name (only when trainer changed)
      let trainerName = '', sessionDate = '', sessionName = '', aiSummary = '';
      let exercises: any[] = [];
      if (trainerChanged) {
        const [exR, trR] = await Promise.all([
          supabase.from('workout_exercises')
            .select('exercise_name, body_part, set_number, reps_performed, load_performed, rest_period, remark, exercise_notes, tempo, rir_performed')
            .eq('session_id', lastSession.session_id).order('body_part').order('exercise_name').order('set_number'),
          supabase.from('profiles').select('first_name, last_name').eq('id', lastTrainerId).single(),
        ]);
        trainerName = trR.data ? `${trR.data.first_name ?? ''} ${trR.data.last_name ?? ''}`.replace(/\s+/g, ' ').trim() : 'Unknown Trainer';
        exercises = exR.data || [];
        sessionDate = lastSession.session_date || '';
        sessionName = lastSession.session_name || 'Workout Session';
      }

      // Step 6 — AI summaries
      let doctorSummary = '';
      try {
        const { data: fnData, error: fnError } = await invokeEdgeFn('summarize-previous-session', { exercises, trainerName, sessionDate, sessionName, lastDoctorSession });
        if (!fnError) {
          aiSummary = (fnData as any)?.summary || '';
          doctorSummary = (fnData as any)?.doctorSummary || '';
        }
      } catch {}

      return {
        showPreviousSession: true,
        previousSession: { sessionDate, trainerName, trainerId: lastTrainerId || '', sessionName, exercises, aiSummary, lastDoctorSession, doctorSummary },
      };
    },
  });
}

/* ---------- Capture client's home coordinates into clients.brb_location ----------
   Trainer taps the pin button while AT the client's home; we save the device fix.
   Guarded with .is('brb_location', null) so a second trainer can't overwrite an
   existing capture — the button is only shown while the column is null anyway. */
export function useSaveClientHomeLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ clientId, lat, lng, accuracy }: { clientId: string; lat: number; lng: number; accuracy?: number | null }) => {
      const { data: userData } = await supabase.auth.getUser();
      const payload = {
        lat, lng,
        accuracy: accuracy ?? null,
        method: 'trainer_device_capture',
        captured_by: userData.user?.id ?? null,
        updated_at: new Date().toISOString(),
      };
      const { data, error } = await supabase
        .from('clients')
        .update({ brb_location: payload })
        .eq('id', clientId)
        .is('brb_location', null)
        .select('id, brb_location')
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error('Location was already captured for this client.');
      return data;
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['client-detail', v.clientId] }),
  });
}

export function useAckSessionSummary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ clientId }: { clientId: string }) => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) throw new Error('Not signed in');
      const { error } = await supabase.from('event_acknowledgement').insert({ user_id: uid, title: 'Session Summary', reference_id: clientId });
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, v) => { qc.invalidateQueries({ queryKey: ['previous-trainer-session', v.clientId] }); },
  });
}

/* ---------- Sessions (mirrors ClientAllSessionsSection) ---------- */
const prettyType = (t: string | null) =>
  (t || 'session').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export type ClientSessionRow = {
  id: string;
  session_name: string;
  session_type: string;
  type_label: string;
  status: string;
  scheduled_at: string;
  trainer_name: string;
  notes: string | null;
  category: 'workout' | 'rehab';
  ai_analysis: string | null;
  workout_session_id: string | null;
};

export function useClientSessions(clientId: string | null) {
  return useQuery({
    queryKey: ['client-sessions', clientId],
    enabled: !!clientId,
    staleTime: 60_000,
    queryFn: async (): Promise<ClientSessionRow[]> => {
      const { data, error } = await supabase
        .from('training_sessions')
        .select('id, scheduled_at, session_type, status, trainer_id, notes, session_name, workout_session_id, rehab_ai_analysis, created_at')
        .eq('client_id', clientId)
        .neq('status', 'parked')
        .neq('status', 'cancelled')
        .order('scheduled_at', { ascending: false });
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as any[];

      const trainerIds = new Set<string>();
      const workoutSessionIds = new Set<string>();
      rows.forEach((r) => {
        if (r.trainer_id) trainerIds.add(r.trainer_id);
        if (r.workout_session_id) workoutSessionIds.add(r.workout_session_id);
      });

      const trainerMap: Record<string, string> = {};
      if (trainerIds.size > 0) {
        const { data: trainers } = await supabase
          .from('profiles')
          .select('id, first_name, last_name')
          .in('id', Array.from(trainerIds));
        (trainers ?? []).forEach((t: any) => {
          trainerMap[t.id] = `${t.first_name ?? ''} ${t.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || 'Unknown';
        });
      }

      const analysisMap: Record<string, string> = {};
      if (workoutSessionIds.size > 0) {
        const { data: analysisData } = await supabase
          .from('workout_analysis')
          .select('session_id, analysis_data')
          .in('session_id', Array.from(workoutSessionIds));
        (analysisData ?? []).forEach((item: any) => {
          const a = item.analysis_data;
          if (a && typeof a === 'object' && a.analysis) analysisMap[item.session_id] = a.analysis;
        });
      }

      return rows.map((r) => {
        const name = (r.session_name || '').trim().toLowerCase();
        const category: 'workout' | 'rehab' =
          name === 'recovery session' || name === 'rehab session' || name === 'rehab' ? 'rehab' : 'workout';
        let ai: string | null = r.workout_session_id ? analysisMap[r.workout_session_id] ?? null : null;
        if (category === 'rehab' && r.rehab_ai_analysis) ai = r.rehab_ai_analysis;
        return {
          id: r.id,
          session_name: r.session_name || prettyType(r.session_type),
          session_type: r.session_type || 'session',
          type_label: prettyType(r.session_type),
          status: r.status || 'scheduled',
          scheduled_at: r.scheduled_at || r.created_at,
          trainer_name: r.trainer_id ? trainerMap[r.trainer_id] || 'Unknown' : 'N/A',
          notes: r.notes ?? null,
          category,
          ai_analysis: ai,
          workout_session_id: r.workout_session_id ?? null,
        };
      });
    },
  });
}

/* ---------- Exercises performed in a logged session (workout_exercises) ---------- */
export type SessionExercise = {
  name: string;
  body_part: string | null;
  sets: { set_number: number | null; reps: number | null; load: string | null; duration: number | null; tempo: string | null; rest: number | null; rir: number | null }[];
  notes: string | null;
};
export function useSessionExercises(sessionId: string | null) {
  return useQuery({
    queryKey: ['session-exercises', sessionId],
    enabled: !!sessionId,
    staleTime: 120_000,
    queryFn: async (): Promise<SessionExercise[]> => {
      const { data, error } = await supabase
        .from('workout_exercises')
        .select('exercise_name, body_part, set_number, reps_performed, load_performed, duration_seconds, tempo, rest_period, rir_performed, exercise_notes, sub_activity, rounds')
        .eq('session_id', sessionId)
        .order('set_number', { ascending: true });
      if (error) throw new Error(error.message);
      const map = new Map<string, SessionExercise>();
      for (const r of (data ?? []) as any[]) {
        const name = (r.exercise_name || r.sub_activity || 'Exercise').trim();
        if (!map.has(name)) map.set(name, { name, body_part: r.body_part ?? null, sets: [], notes: r.exercise_notes ?? null });
        const ex = map.get(name)!;
        ex.sets.push({
          set_number: r.set_number ?? null,
          reps: r.reps_performed ?? null,
          load: r.load_performed ?? null,
          duration: r.duration_seconds ?? null,
          tempo: r.tempo ?? null,
          rest: r.rest_period ?? null,
          rir: r.rir_performed ?? null,
        });
        if (!ex.notes && r.exercise_notes) ex.notes = r.exercise_notes;
      }
      return Array.from(map.values());
    },
  });
}

/* ---------- Plans (ALL statuses, grouped by plan_id with exercises) ----------
   Includes pending_review / rejected / needs_revision so a freshly created plan
   is visible immediately (it only becomes active once the CRM approves it). */
export function useClientPlans(clientId: string | null) {
  return useQuery({
    queryKey: ['client-plans', clientId],
    enabled: !!clientId,
    staleTime: 120_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('workout_plan_exercises')
        .select('id, plan_id, plan_name, plan_description, plan_duration_weeks, modality, status, approved_at, created_at, order_index, body_part, exercise_name, set_number, tempo, rest_period, rm_percentage, reps_target, load_target, super_set_group, exercise_notes, activity_type, sub_activity, duration')
        .eq('client_id', clientId)
        .order('created_at', { ascending: true })
        .order('order_index', { ascending: true });
      if (error) throw new Error(error.message);

      const now = Date.now();
      const map = new Map<string, any>();
      for (const r of (data ?? []) as any[]) {
        const pid = r.plan_id;
        if (!map.has(pid)) {
          const approved = r.approved_at ? new Date(r.approved_at).getTime() : 0;
          map.set(pid, {
            plan_id: pid,
            plan_name: r.plan_name,
            plan_description: r.plan_description ?? null,
            plan_duration_weeks: r.plan_duration_weeks ?? null,
            modality: r.modality ?? null,
            status: r.status ?? null,
            approved_at: r.approved_at ?? null,
            created_at: r.created_at ?? null,
            expired: approved > 0 ? approved + 45 * 864e5 < now : false,
            exercises: [] as any[],
          });
        }
        map.get(pid).exercises.push({
          id: r.id,
          body_part: r.body_part ?? null,
          exercise_name: r.exercise_name ?? null,
          set_number: r.set_number ?? null,
          tempo: r.tempo ?? null,
          rest_period: r.rest_period ?? null,
          rm_percentage: r.rm_percentage ?? null,
          reps_target: r.reps_target ?? null,
          load_target: r.load_target ?? null,
          super_set_group: r.super_set_group ?? null,
          exercise_notes: r.exercise_notes ?? null,
          activity_type: r.activity_type ?? null,
          sub_activity: r.sub_activity ?? null,
          duration: r.duration ?? null,
        });
      }
      // Newest plan first.
      return Array.from(map.values()).sort(
        (a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()
      );
    },
  });
}

/* ---------- Create a workout plan ----------
   Mirrors the web app's useWorkoutPlanSubmit exactly: one row per set (strength)
   or per activity (yoga/boxing) in workout_plan_exercises. status defaults to
   'pending_review' server-side, so new plans go to the CRM for approval. */
export type PlanSetInput = {
  load: string;       // numeric or free text ("Body Weight")
  reps: string;       // used when measurement === 'reps'
  duration: string;   // used when measurement === 'duration' (minutes, free text)
  rest: string;       // seconds
  tempo: string;      // e.g. 3-0-1-0
  rm: string;         // % RM
  rir: string;        // reps in reserve
  ss: string;         // super-set group (A/B/…)
  notes: string;
};
export type PlanExerciseInput = { name: string; measurement: 'reps' | 'duration'; sets: PlanSetInput[] };
export type PlanBodyPartInput = { body_part: string; exercises: PlanExerciseInput[] };
export type PlanYogaInput = { name: string; type: 'Constant' | 'Custom' };
export type PlanBoxingSelection = { category: string; exercise: string };
export type PlanBoxingCustom = { category: string; name: string };

export const emptyPlanSet = (): PlanSetInput => ({ load: '', reps: '', duration: '', rest: '', tempo: '', rm: '', rir: '', ss: '', notes: '' });

/* Exercise pool for the plan form's picker — same fallback pools as the web
   ExerciseSelection page: Strength adds Cardio, Pilates adds Yoga. */
const PLAN_POOL_MAP: Record<string, string[]> = {
  'Strength Training': ['Strength', 'Cardio'],
  Pilates: ['Pilates', 'Yoga'],
  Aerobics: ['Aerobics'],
};
export function usePlanExerciseDb(planModality: string | null) {
  const key = planModality ?? '';
  return useQuery({
    queryKey: ['plan-exercise-db', key],
    enabled: !!key,
    staleTime: 600_000,
    queryFn: async (): Promise<DbExercise[]> => {
      if (key === 'Aqua Aerobics') return AQUA_AEROBICS_EXERCISES;
      const pools = PLAN_POOL_MAP[key] ?? ['Strength', 'Cardio'];
      const { data, error } = await supabase
        .from('exercises_db')
        .select('exercise, muscle_group, equipment, measurement_type')
        .in('modality', pools)
        .order('exercise');
      if (error) throw new Error(error.message);
      const seen = new Set<string>();
      const out: DbExercise[] = [];
      for (const r of (data ?? []) as any[]) {
        const name = (r.exercise ?? '').trim();
        if (!name || seen.has(name.toLowerCase())) continue;
        seen.add(name.toLowerCase());
        out.push({ name, muscle_group: r.muscle_group ?? null, equipment: r.equipment ?? null, measurement_type: r.measurement_type ?? null });
      }
      return out;
    },
  });
}

/* Boxing exercises grouped by exercise_type — used by the plan form's picker. */
export function useBoxingPlanExercises() {
  return useQuery({
    queryKey: ['boxing-plan-exercises'],
    staleTime: 600_000,
    queryFn: async (): Promise<{ category: string; exercises: string[] }[]> => {
      const { data, error } = await supabase
        .from('exercises_db')
        .select('exercise, exercise_type')
        .eq('modality', 'Boxing')
        .order('exercise');
      if (error) throw new Error(error.message);
      const groups = new Map<string, string[]>();
      for (const r of (data ?? []) as any[]) {
        const name = (r.exercise ?? '').trim();
        if (!name) continue;
        const cat = (r.exercise_type ?? '').trim() || 'General';
        if (!groups.has(cat)) groups.set(cat, []);
        if (!groups.get(cat)!.includes(name)) groups.get(cat)!.push(name);
      }
      // Named categories first, General last.
      return Array.from(groups.entries())
        .sort(([a], [b]) => (a === 'General' ? 1 : b === 'General' ? -1 : a.localeCompare(b)))
        .map(([category, exercises]) => ({ category, exercises }));
    },
  });
}

export type WorkoutPlanCreateInput = {
  trainerId: string;
  clientId: string;
  planName: string;
  planDescription: string;
  durationWeeks: number;
  modality: string; // 'Strength Training' | 'Boxing' | 'Yoga' (stored verbatim, like the web form)
  bodyParts: PlanBodyPartInput[];
  yoga: PlanYogaInput[];
  boxing: { selected: PlanBoxingSelection[]; custom: PlanBoxingCustom[]; padwork: boolean };
  /** Offline sync: pre-generated plan id so retries can never duplicate the plan. */
  planId?: string;
};

// Plain submit fn — used by the mutation hook AND the offline outbox drainer.
export async function submitWorkoutPlan(input: WorkoutPlanCreateInput) {
      const { trainerId, clientId, planName, planDescription, durationWeeks, modality, bodyParts, yoga, boxing } = input;
      if (!clientId) throw new Error('Select a client first');
      if (!planName.trim()) throw new Error('Enter a plan name');
      if (!modality) throw new Error('Select a modality');

      const planId = input.planId ?? uuidv4();

      // Idempotency guard: a retried sync after a lost response must not re-insert.
      const { data: existingPlan, error: exErr } = await supabase
        .from('workout_plan_exercises')
        .select('id')
        .eq('plan_id', planId)
        .limit(1);
      if (exErr) throw new Error(exErr.message);
      if ((existingPlan?.length ?? 0) > 0) return { planId, count: 0 };
      const meta = {
        plan_id: planId,
        client_id: clientId,
        trainer_id: trainerId,
        plan_name: planName.trim(),
        plan_description: planDescription.trim() || null,
        plan_duration_weeks: durationWeeks,
        modality,
      };

      let rows: any[] = [];
      if (modality === 'Yoga') {
        rows = yoga
          .filter((a) => a.name.trim())
          .map((a, i) => ({
            ...meta,
            body_part: 'Yoga Activities',
            exercise_name: a.name.trim(),
            sub_activity: a.name.trim(),
            activity_type: 'Constant', // web stores all yoga activities as Constant
            set_number: '1',
            order_index: i,
          }));
      } else if (modality === 'Boxing') {
        let orderIndex = 0;
        if (boxing.padwork) {
          rows.push({ ...meta, body_part: 'Boxing Activity', exercise_name: 'Pad work', sub_activity: null, activity_type: 'Custom', set_number: '1', order_index: orderIndex++ });
        }
        for (const c of boxing.custom) {
          if (!c.category.trim() || !c.name.trim()) continue;
          rows.push({ ...meta, body_part: 'Boxing Activity', exercise_name: c.category.trim(), sub_activity: c.name.trim(), activity_type: 'Custom', set_number: '1', order_index: orderIndex++ });
        }
        for (const s of boxing.selected) {
          rows.push({ ...meta, body_part: 'Boxing Activity', exercise_name: s.category, sub_activity: s.exercise, activity_type: 'Constant', set_number: '1', order_index: orderIndex++ });
        }
      } else {
        // Strength training — one row per set, order_index increments across all rows.
        let orderIndex = 0;
        rows = bodyParts.flatMap((bp) =>
          bp.exercises
            .filter((ex) => ex.name.trim())
            .flatMap((ex) => {
              const isDuration = ex.measurement === 'duration';
              return ex.sets.map((set, si) => {
                const loadRaw = set.load.trim();
                const loadVal = loadRaw === '' ? null : isNaN(Number(loadRaw)) ? loadRaw : parseFloat(loadRaw);
                return {
                  ...meta,
                  body_part: bp.body_part.trim(),
                  exercise_name: ex.name.trim(),
                  set_number: String(si + 1),
                  tempo: set.tempo.trim() || null,
                  rest_period: set.rest.trim() ? parseInt(set.rest, 10) || null : null,
                  rm_percentage: set.rm.trim() ? parseFloat(set.rm) || null : null,
                  reps_target: isDuration ? null : set.reps.trim() ? parseInt(set.reps, 10) || null : null,
                  super_set_group: set.ss.trim() || null,
                  exercise_notes: set.notes.trim() || null,
                  load_target: isDuration ? null : loadVal,
                  rir_target: set.rir.trim() ? parseInt(set.rir, 10) || null : null,
                  duration: isDuration ? (set.duration.trim() || null) : null,
                  measurement_type: ex.measurement,
                  order_index: orderIndex++,
                };
              });
            })
        );
      }

      if (rows.length === 0) throw new Error('Add at least one exercise or activity');

      const { error } = await supabase.from('workout_plan_exercises').insert(rows);
      if (error) {
        throw new Error(
          /row-level security/i.test(error.message)
            ? 'Not allowed: plans must be created from the trainer account that owns this client.'
            : error.message
        );
      }
      return { planId, count: rows.length };
}

export function useCreateWorkoutPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: submitWorkoutPlan,
    onSuccess: (_r, vars) => qc.invalidateQueries({ queryKey: ['client-plans', vars.clientId] }),
  });
}

/* ---------- Weekly goals ---------- */
export function useClientGoals(clientId: string | null) {
  return useQuery({
    queryKey: ['client-goals', clientId],
    enabled: !!clientId,
    staleTime: 120_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('daily_goals')
        .select('id, week_start_date, week_end_date, sleep_target_hours, steps_target, nutrition_target, z2c_target, recommendation')
        .eq('client_id', clientId)
        .order('week_start_date', { ascending: true });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

/* ---------- Reports: QHP + health (blood/lab) ---------- */
export function useClientReports(clientId: string | null) {
  return useQuery({
    queryKey: ['client-reports', clientId],
    enabled: !!clientId,
    staleTime: 120_000,
    queryFn: async () => {
      const [qhpR, healthR] = await Promise.all([
        // Structured QHP reports (qhp_json is the normalized schema the detail view renders).
        // Ordered ascending so index → chrono label (Baseline / Refresh N).
        supabase.from('qhp_details').select('id, coach_assessment_id, created_at, approved, pdf_storage_path, qhp_json').eq('client_id', clientId).order('created_at', { ascending: true }),
        supabase.from('health_reports').select('id, report_name, report_type, test_date, upload_date, file_url, metabolic_score, longevity_score, notes, extracted_data, biomarkers, measurements, ai_analysis').eq('client_id', clientId).eq('is_active', true).order('upload_date', { ascending: false }),
      ]);
      if (qhpR.error) throw new Error(qhpR.error.message);
      if (healthR.error) throw new Error(healthR.error.message);
      return { qhp: qhpR.data ?? [], health: healthR.data ?? [] };
    },
  });
}

/* ---------- Progression: session load + 1RM (mirrors web ProgressionSection) ----------
   Reads pre-computed values from workout_analysis (session_load, max_1rm), written by
   the analyze-workout edge function. Filtering/bucketing by created_at is done client-side. */
export function useClientProgression(clientId: string | null) {
  return useQuery({
    queryKey: ['client-progression', clientId],
    enabled: !!clientId,
    staleTime: 120_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('workout_analysis')
        .select('id, created_at, session_load, max_1rm, workout_type')
        .eq('client_id', clientId)
        .order('created_at', { ascending: true });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

/* ---------- Progression: biological age history (Axion) ---------- */
export function useClientBioAge(clientId: string | null) {
  return useQuery({
    queryKey: ['client-bioage', clientId],
    enabled: !!clientId,
    staleTime: 120_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('biological_age_history')
        .select('id, calculation_date, chronological_age, mechanical_age, metabolic_age, vo2_max, is_provisional')
        .eq('client_id', clientId)
        .order('calculation_date', { ascending: false })
        .limit(60);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

/* ---------- Weekly Health Summary (web WeeklyHealthSummary.tsx, 5 sources) ----------
   Last 4 Monday-start weeks. Per day: workouts (workout_analysis count on local date),
   steps + nutrition rating + meals (nutrition_tracker.steps_by_trainer / nutrition_rating /
   meals_analysis), sleep (daily_health_metrics.sleep_duration_minutes/60 primary,
   daily_sleep_logs.hours_slept fallback). Targets per week from daily_goals keyed by
   week_start_date; workout target is the web's hardcoded 4/week. Zone 2 shown only when
   z2c_target is set; sessions live in daily_goals.zone_2_did.sessions [{date, duration_minutes}]. */
const wkFmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export type WeeklyDay = {
  date: string; // local YYYY-MM-DD
  dayLabel: string; // Mon
  dateLabel: string; // 14 Jul
  isToday: boolean;
  isFuture: boolean;
  workoutCount: number;
  steps: number | null;
  nutrition: number | null;
  meals: any[];
  sleepHours: number | null;
  z2Minutes: number | null; // duration when a zone-2 session is logged this day
};
export type WeeklyWeek = {
  weekStart: string;
  label: string; // "14 Jul – 20"
  subLabel: string; // This Week / Last Week / N weeks ago
  days: WeeklyDay[];
  summary: { workoutCount: number; stepsAvg: number | null; nutritionAvg: number | null; sleepAvg: number | null };
  goal: { stepsTarget: number | null; nutritionTarget: number | null; sleepTarget: number | null; workoutTarget: number; z2cTarget: number | null; z2cDone: number };
  achieved: { workout: boolean; steps: boolean | null; nutrition: boolean | null; sleep: boolean | null; z2c: boolean | null };
  goalsHit: number;
  goalsTotal: number;
  hasGoalRow: boolean;
};
export function useWeeklyHealthSummary(clientId: string | null) {
  return useQuery({
    queryKey: ['weekly-health-summary', clientId, wkFmt(new Date())],
    enabled: !!clientId,
    staleTime: 60_000,
    queryFn: async (): Promise<WeeklyWeek[]> => {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const dow = (today.getDay() + 6) % 7; // Mon=0
      const weeks = Array.from({ length: 4 }, (_, i) => {
        const start = new Date(today); start.setDate(today.getDate() - dow - i * 7);
        const end = new Date(start); end.setDate(start.getDate() + 6);
        return { start, end };
      });
      const fourWeeksAgo = weeks[3].start;
      const fromYmd = wkFmt(fourWeeksAgo);

      const [workoutsR, nutritionR, metricsR, sleepLogsR, goalsR] = await Promise.all([
        supabase.from('workout_analysis').select('created_at, workout_type').eq('client_id', clientId).gte('created_at', fourWeeksAgo.toISOString()),
        supabase.from('nutrition_tracker').select('rating_date, nutrition_rating, meals_analysis, steps_by_trainer').eq('client_id', clientId).gte('rating_date', fromYmd),
        supabase.from('daily_health_metrics').select('metric_date, sleep_duration_minutes').eq('client_id', clientId).gte('metric_date', fromYmd),
        supabase.from('daily_sleep_logs').select('log_date, hours_slept').eq('client_id', clientId).gte('log_date', fromYmd),
        supabase.from('daily_goals').select('week_start_date, steps_target, nutrition_target, sleep_target_hours, z2c_target, zone_2_did').eq('client_id', clientId).gte('week_start_date', wkFmt(weeks[3].start)).lte('week_start_date', wkFmt(weeks[0].start)),
      ]);
      for (const r of [workoutsR, nutritionR, metricsR, sleepLogsR, goalsR]) {
        if (r.error) throw new Error(r.error.message);
      }

      const workoutsByDay = new Map<string, number>();
      for (const w of (workoutsR.data ?? []) as any[]) {
        const d = wkFmt(new Date(w.created_at));
        workoutsByDay.set(d, (workoutsByDay.get(d) ?? 0) + 1);
      }
      const nutritionByDay = new Map<string, any>();
      for (const n of (nutritionR.data ?? []) as any[]) nutritionByDay.set(n.rating_date, n);
      const metricSleepByDay = new Map<string, number>();
      for (const m of (metricsR.data ?? []) as any[]) {
        if (m.sleep_duration_minutes != null) metricSleepByDay.set(m.metric_date, Number((m.sleep_duration_minutes / 60).toFixed(1)));
      }
      const logSleepByDay = new Map<string, number>();
      for (const s of (sleepLogsR.data ?? []) as any[]) {
        if (s.hours_slept != null) logSleepByDay.set(s.log_date, s.hours_slept);
      }
      const goalByWeek = new Map<string, any>();
      for (const g of (goalsR.data ?? []) as any[]) goalByWeek.set(g.week_start_date, g);

      const mon = (d: Date) => d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
      const todayYmd = wkFmt(today);

      return weeks.map(({ start, end }, idx) => {
        const weekStart = wkFmt(start);
        const g = goalByWeek.get(weekStart);
        const z2Sessions: { date: string; duration_minutes?: number }[] = g?.zone_2_did?.sessions ?? [];
        const days: WeeklyDay[] = Array.from({ length: 7 }, (_, di) => {
          const d = new Date(start); d.setDate(start.getDate() + di);
          const ymd = wkFmt(d);
          const nut = nutritionByDay.get(ymd);
          const z2 = z2Sessions.find((s) => s.date === ymd);
          return {
            date: ymd,
            dayLabel: d.toLocaleDateString('en-GB', { weekday: 'short' }),
            dateLabel: mon(d),
            isToday: ymd === todayYmd,
            isFuture: ymd > todayYmd,
            workoutCount: workoutsByDay.get(ymd) ?? 0,
            steps: nut?.steps_by_trainer ?? null,
            nutrition: nut?.nutrition_rating ?? null,
            meals: Array.isArray(nut?.meals_analysis) ? nut.meals_analysis : [],
            sleepHours: metricSleepByDay.get(ymd) ?? logSleepByDay.get(ymd) ?? null,
            z2Minutes: z2 ? (z2.duration_minutes ?? 0) : null,
          };
        });

        const workoutCount = days.reduce((a, d) => a + d.workoutCount, 0);
        const avgOf = (vals: (number | null)[]) => {
          const v = vals.filter((x): x is number => x !== null);
          return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
        };
        const stepsAvgRaw = avgOf(days.map((d) => d.steps));
        const summary = {
          workoutCount,
          stepsAvg: stepsAvgRaw !== null ? Math.round(stepsAvgRaw) : null,
          nutritionAvg: avgOf(days.map((d) => d.nutrition)),
          sleepAvg: avgOf(days.map((d) => d.sleepHours)),
        };
        const goal = {
          stepsTarget: g?.steps_target ?? null,
          nutritionTarget: g?.nutrition_target ?? null,
          sleepTarget: g?.sleep_target_hours ?? null,
          workoutTarget: 4, // web hardcode
          z2cTarget: g?.z2c_target ?? null,
          z2cDone: z2Sessions.length,
        };
        const achieved = {
          workout: summary.workoutCount >= goal.workoutTarget,
          steps: goal.stepsTarget !== null && summary.stepsAvg !== null ? summary.stepsAvg >= goal.stepsTarget : null,
          nutrition: goal.nutritionTarget !== null && summary.nutritionAvg !== null ? summary.nutritionAvg >= goal.nutritionTarget : null,
          sleep: goal.sleepTarget !== null && summary.sleepAvg !== null ? summary.sleepAvg >= goal.sleepTarget : null,
          z2c: goal.z2cTarget !== null ? goal.z2cDone >= goal.z2cTarget : null,
        };
        const goalsHit = [achieved.workout, achieved.steps, achieved.nutrition, achieved.sleep, achieved.z2c].filter((v) => v === true).length;
        const goalsTotal = [true, achieved.steps !== null, achieved.nutrition !== null, achieved.sleep !== null, achieved.z2c !== null].filter(Boolean).length;

        return {
          weekStart,
          label: `${mon(start)} – ${end.getDate()}`,
          subLabel: idx === 0 ? 'This Week' : idx === 1 ? 'Last Week' : `${idx} weeks ago`,
          days,
          summary,
          goal,
          achieved,
          goalsHit,
          goalsTotal,
          hasGoalRow: !!g,
        };
      });
    },
  });
}

/* Trainer logs/edits/removes a client's Zone 2 Cardio entry for a day — web handleZ2cSave/Delete:
   read-modify-write of daily_goals.zone_2_did.sessions for that client+week (fresh read here
   so a stale UI never clobbers sessions written elsewhere). minutes null/0 ⇒ remove the entry. */
export function useSaveZone2(clientId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ weekStart, date, minutes }: { weekStart: string; date: string; minutes: number | null }) => {
      const { data: row, error: rErr } = await supabase
        .from('daily_goals')
        .select('id, zone_2_did')
        .eq('client_id', clientId)
        .eq('week_start_date', weekStart)
        .maybeSingle();
      if (rErr) throw new Error(rErr.message);
      if (!row) throw new Error('No weekly goal row exists for this week yet.');
      const sessions: { date: string; duration_minutes?: number }[] = (row as any).zone_2_did?.sessions ?? [];
      let updated: { date: string; duration_minutes?: number }[];
      if (!minutes) {
        updated = sessions.filter((s) => s.date !== date);
      } else {
        const idx = sessions.findIndex((s) => s.date === date);
        updated = idx >= 0
          ? sessions.map((s, i) => (i === idx ? { date, duration_minutes: minutes } : s))
          : [...sessions, { date, duration_minutes: minutes }];
      }
      const { error } = await supabase
        .from('daily_goals')
        .update({ zone_2_did: { sessions: updated } })
        .eq('client_id', clientId)
        .eq('week_start_date', weekStart);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['weekly-health-summary', clientId] });
    },
  });
}

/* ---------- AI Weekly Report (web AIWeeklySummaryHistory) ----------
   weekly_progression_tracking: one row per client per Sunday-start week; the whole
   card renders from the ai_weekly_summary JSONB (written deterministically by the
   populate-weekly-snapshots edge fn, Sundays via cron). The shown report = newest
   row with a non-null summary whose week_end is already past. Row columns
   (avg_sleep_hours/workout_count/avg_steps/avg_nutrition_rating) feed the
   1W/4W/12W comparison maths client-side, exactly like the web. */
export type WeeklyProgressionRow = {
  id: string;
  week_start: string;
  week_end: string;
  ai_weekly_summary: any;
  trainer_acknowledgements: any;
  workout_count: number | null;
  avg_sleep_hours: number | null;
  avg_steps: number | null;
  avg_nutrition_rating: number | null;
};
export function useWeeklyProgressionAll(clientId: string | null) {
  return useQuery({
    queryKey: ['weekly-progression-all', clientId],
    enabled: !!clientId,
    staleTime: 120_000,
    queryFn: async (): Promise<WeeklyProgressionRow[]> => {
      const { data, error } = await supabase
        .from('weekly_progression_tracking')
        .select('*')
        .eq('client_id', clientId)
        .order('week_start', { ascending: false })
        .limit(15);
      if (error) throw new Error(error.message);
      return (data ?? []) as any;
    },
  });
}
/* Silent auto-acknowledge on first view (web behavior): append the trainer's id to
   the row's trainer_acknowledgements array. */
export async function ackWeeklyReport(rowId: string, acks: string[], trainerId: string) {
  const newAcks = [...new Set([...acks, trainerId])];
  const { error } = await supabase
    .from('weekly_progression_tracking')
    .update({ trainer_acknowledgements: newAcks })
    .eq('id', rowId);
  if (error) throw new Error(error.message);
}
