import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';

/* ============ CRM Client Detail — tabs + actions data layer.
   Mirrors the web CRMClientDetails contracts:
   WhoopRecoverySection, HeartMathMetricsSection, MonthlyNutritionSupplementOverview,
   MedicalHistoryTimeline, MedicalDiagnosisHistory, ClientStatements, TaskDialog,
   AssignTrainerDialog, PauseJourneyDialog, BookDoctorConsultationDialog,
   CRMCredentialsButton, crm-client-10day-summary edge function. ============ */

const fullName = (p: any) => `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || '—';

async function namesFor(ids: (string | null | undefined)[]) {
  const uniq = [...new Set(ids.filter(Boolean))] as string[];
  const map = new Map<string, string>();
  if (uniq.length) {
    const { data } = await supabase.from('profiles').select('id, first_name, last_name').in('id', uniq);
    (data ?? []).forEach((p: any) => map.set(p.id, fullName(p)));
  }
  return map;
}

/* ---------- Health tab: Whoop / device metrics ---------- */
export function useClientWhoop(clientId: string | null) {
  return useQuery({
    queryKey: ['crm-client-whoop', clientId],
    enabled: !!clientId,
    staleTime: 120_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('daily_health_metrics')
        .select('metric_date, recovery_score, hrv_rmssd, resting_heart_rate, strain_score, sleep_score, sleep_duration_minutes, steps_count')
        .eq('client_id', clientId)
        .not('recovery_score', 'is', null)
        .order('metric_date', { ascending: false })
        .limit(14);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

/* ---------- Health tab: HeartMath (latest coach_assessment JSON) ---------- */
export function useClientHeartMath(clientId: string | null) {
  return useQuery({
    queryKey: ['crm-client-heartmath', clientId],
    enabled: !!clientId,
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coach_assessment')
        .select('id, assessment_date, new_client_assessment_data, existing_client_assessment_data, heartmath_ai_analysis')
        .eq('client_id', clientId)
        .order('assessment_date', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      const raw: any = data.new_client_assessment_data ?? data.existing_client_assessment_data ?? null;
      const hm = raw?.['Standardized Assessment']?.heartMathReport ?? raw?.heartMathReport ?? null;
      // Live values are free-form JSON (often "" or nested objects) — only pass
      // through finite numbers so the UI never tries to render an object.
      const num = (v: any): number | null => {
        if (v == null || v === '' || typeof v === 'object') return null;
        const n = Number(v);
        return isFinite(n) ? n : null;
      };
      return {
        date: data.assessment_date as string | null,
        rmssd: num(hm?.RMSSD ?? hm?.rmssd),
        sdnn: num(hm?.SDNN ?? hm?.sdnn),
        mhrr: num(hm?.MHRR ?? hm?.mhrr),
        coherence: num(hm?.normalizedCoherence),
        analysis: typeof data.heartmath_ai_analysis === 'string' && data.heartmath_ai_analysis.trim() ? data.heartmath_ai_analysis : null,
      };
    },
  });
}

/* ---------- Health tab: monthly nutrition + supplements (mirrors
   MonthlyNutritionSupplementOverview — month-paged, day-wise breakdown). ----------
   monthOffset: 0 = current month, -1 = last month, … */
export type NutritionDay = { date: string; ratings: number[]; supplements: string[]; hasResponse: boolean };
export function useClientNutritionMonth(clientId: string | null, monthOffset: number) {
  return useQuery({
    queryKey: ['crm-client-nutrition', clientId, monthOffset],
    enabled: !!clientId,
    staleTime: 120_000,
    queryFn: async () => {
      const now = new Date();
      const base = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
      // Local date strings — toISOString() would roll IST midnight back a day.
      const ymd = (dt: Date) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      const start = ymd(base);
      const endDate = new Date(base.getFullYear(), base.getMonth() + 1, 0);
      const end = ymd(endDate);

      const { data: nut } = await supabase
        .from('nutrition_tracker').select('rating_date, nutrition_rating')
        .eq('client_id', clientId).gte('rating_date', start).lte('rating_date', end);
      // Supplements — active questionnaire (question texts) + daily boolean responses.
      // limit(1) rather than maybeSingle — some clients have >1 active questionnaire.
      const { data: qns } = await supabase
        .from('health_questionnaires').select('*').eq('client_id', clientId).eq('is_active', true).limit(1);
      const qn: any = qns?.[0];
      let responses: any[] = [];
      if (qn?.id) {
        const { data: resp } = await supabase
          .from('daily_health_responses').select('*')
          .eq('questionnaire_id', qn.id).gte('response_date', start).lte('response_date', end);
        responses = (resp ?? []) as any[];
      }

      // Day-wise breakdown for every day of the month (ascending, like the web table).
      const nutByDate = new Map<string, number[]>();
      ((nut ?? []) as any[]).forEach((r) => {
        const n = Number(r.nutrition_rating);
        if (!isNaN(n)) nutByDate.set(r.rating_date, [...(nutByDate.get(r.rating_date) ?? []), n]);
      });
      const respByDate = new Map<string, any[]>();
      responses.forEach((r) => respByDate.set(r.response_date, [...(respByDate.get(r.response_date) ?? []), r]));

      const days: NutritionDay[] = [];
      for (let d = 1; d <= endDate.getDate(); d++) {
        const date = `${start.slice(0, 8)}${String(d).padStart(2, '0')}`;
        const dayResp = respByDate.get(date) ?? [];
        const supplements: string[] = [];
        dayResp.forEach((r) => {
          for (let i = 1; i <= 10; i++) {
            if (r[`question_${i}`] === true) {
              const label = qn?.[`question_${i}_text`];
              if (typeof label === 'string' && label.trim()) supplements.push(label.trim());
            }
          }
        });
        days.push({ date, ratings: nutByDate.get(date) ?? [], supplements: [...new Set(supplements)], hasResponse: dayResp.length > 0 });
      }

      // Month summary (same formulas as before).
      let yes = 0, total = 0;
      responses.forEach((r) => {
        for (let i = 1; i <= 10; i++) {
          const v = r[`question_${i}`];
          if (typeof v === 'boolean') { total++; if (v) yes++; }
        }
      });
      const ratings = [...nutByDate.values()].flat();
      return {
        monthLabel: base.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', month: 'long', year: 'numeric' }),
        daysLogged: nutByDate.size,
        avgRating: ratings.length ? +(ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1) : null,
        suppPct: total ? Math.round((yes / total) * 100) : null,
        days,
      };
    },
  });
}

/* ---------- QHP tab: all coach assessments (mirrors ClientAssessmentsSection):
   every coach_assessment with data, numbered chronologically → Baseline / Refresh n. ---------- */
export type ClientAssessment = {
  id: string; date: string | null; label: string; coachName: string | null;
  metrics: string[]; hasQhpJson: boolean;
};
export function useClientAssessments(clientId: string | null) {
  return useQuery({
    queryKey: ['crm-client-assessments', clientId],
    enabled: !!clientId,
    staleTime: 120_000,
    queryFn: async (): Promise<ClientAssessment[]> => {
      const { data, error } = await supabase
        .from('coach_assessment')
        .select('id, assessment_date, coach_id, mechanical_score, new_client_assessment_data, existing_client_assessment_data, qhp_data')
        .eq('client_id', clientId)
        .order('assessment_date', { ascending: true });
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as any[];
      const names = await namesFor(rows.map((r) => r.coach_id));
      const hasObj = (v: any) => v && typeof v === 'object' && Object.keys(v).length > 0;
      // Number chronologically over ALL rows (like the web), then keep only rows with data.
      return rows
        .map((r, i) => ({ r, n: i + 1 }))
        .filter(({ r }) => hasObj(r.new_client_assessment_data) || hasObj(r.existing_client_assessment_data) || hasObj(r.qhp_data))
        .map(({ r, n }) => {
          const nd = r.new_client_assessment_data ?? {};
          const ed = r.existing_client_assessment_data ?? {};
          const metrics: string[] = [];
          if (r.mechanical_score) metrics.push(`Mechanical ${r.mechanical_score}/100`);
          if (nd.client_weight) metrics.push(`Weight ${nd.client_weight}kg`);
          if (nd.client_height) metrics.push(`Height ${nd.client_height}cm`);
          if (nd.waist_measurement) metrics.push(`Waist ${nd.waist_measurement}cm`);
          if (ed.current_weight) metrics.push(`Weight ${ed.current_weight}kg`);
          if (ed.waist_circumference) metrics.push(`Waist ${ed.waist_circumference}cm`);
          if (ed.body_fat_percentage) metrics.push(`Body Fat ${ed.body_fat_percentage}%`);
          return {
            id: r.id,
            date: r.assessment_date ?? null,
            label: n === 1 ? 'QHP Baseline' : `QHP Refresh ${n - 1}`,
            coachName: r.coach_id ? names.get(r.coach_id) ?? null : null,
            metrics: metrics.slice(0, 3),
            hasQhpJson: hasObj(r.qhp_data),
          };
        })
        .reverse(); // newest first for display
    },
  });
}

/* ---------- Medical History tab (client_medical_history) ---------- */
export function useClientMedicalHistory(clientId: string | null) {
  return useQuery({
    queryKey: ['crm-client-medhistory', clientId],
    enabled: !!clientId,
    staleTime: 120_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_medical_history').select('*')
        .eq('client_id', clientId).order('event_date', { ascending: false });
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as any[];
      const names = await namesFor(rows.map((r) => r.doctor_id));
      return rows.map((r) => ({ ...r, doctorName: r.doctor_id ? names.get(r.doctor_id) ?? null : null }));
    },
  });
}

/* ---------- Medical Diagnoses tab + Book Doctor Consultation ---------- */
export function useClientDiagnoses(clientId: string | null) {
  return useQuery({
    queryKey: ['crm-client-diagnoses', clientId],
    enabled: !!clientId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('medical_diagnosis').select('*')
        .eq('client_id', clientId).order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as any[];
      const names = await namesFor(rows.map((r) => r.requested_by));
      return rows.map((r) => ({ ...r, requesterName: r.requested_by ? names.get(r.requested_by) ?? null : null }));
    },
  });
}
export function useBookConsultation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { clientId: string; requestedBy: string; problem: string; remark: string | null }) => {
      if (!input.problem.trim()) throw new Error('Problem statement is required');
      const { error } = await supabase.from('medical_diagnosis').insert({
        client_id: input.clientId,
        requested_by: input.requestedBy,
        problem_statement: input.problem.trim().slice(0, 1000),
        remark: input.remark?.trim() ? input.remark.trim().slice(0, 500) : null,
        status: 'pending',
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: (_r, v) => qc.invalidateQueries({ queryKey: ['crm-client-diagnoses', v.clientId] }),
  });
}

/* ---------- Notes tab: remarks + statements + tickets ---------- */
export function useClientRemarks(clientId: string | null) {
  return useQuery({
    queryKey: ['crm-client-remarks', clientId],
    enabled: !!clientId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_remarks').select('id, author_id, content, created_at')
        .eq('client_id', clientId).order('created_at', { ascending: false }).limit(40);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as any[];
      const names = await namesFor(rows.map((r) => r.author_id));
      return rows.map((r) => ({ ...r, authorName: r.author_id ? names.get(r.author_id) ?? null : null }));
    },
  });
}
export function useAddRemark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { clientId: string; authorId: string; content: string }) => {
      if (!input.content.trim()) throw new Error('Note is required');
      const { error } = await supabase.from('client_remarks').insert({
        client_id: input.clientId, author_id: input.authorId, content: input.content.trim(),
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: (_r, v) => qc.invalidateQueries({ queryKey: ['crm-client-remarks', v.clientId] }),
  });
}
export function useClientStatements(clientId: string | null) {
  return useQuery({
    queryKey: ['crm-client-statements', clientId],
    enabled: !!clientId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_statements').select('id, statement, context, is_approved_for_marketing, recorded_at')
        .eq('client_id', clientId).order('recorded_at', { ascending: false }).limit(40);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}
export function useAddStatement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { clientId: string; crmId: string; statement: string; context: string | null; approved: boolean }) => {
      if (!input.statement.trim()) throw new Error('Statement is required');
      const { error } = await supabase.from('client_statements').insert({
        client_id: input.clientId,
        crm_id: input.crmId,
        statement: input.statement.trim(),
        context: input.context?.trim() || null,
        is_approved_for_marketing: input.approved,
        recorded_at: new Date().toISOString(),
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: (_r, v) => qc.invalidateQueries({ queryKey: ['crm-client-statements', v.clientId] }),
  });
}
export function useClientTickets(clientId: string | null) {
  return useQuery({
    queryKey: ['crm-client-tickets', clientId],
    enabled: !!clientId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('support_tickets').select('id, category, subject, description, status, created_at, resolved_at, escalated')
        .eq('client_id', clientId).order('created_at', { ascending: false }).limit(30);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

/* ---------- Bio (client_bio — read + save) ----------
   Every select field carries a DB CHECK constraint — values must match exactly
   (clientBioTypes.ts in the old app). */
export const BIO_SELECTS: [string, string, string[]][] = [
  ['behaviour_type', 'Behaviour', ['introvert', 'extrovert', 'ambivert']],
  ['decision_making_style', 'Decision-making', ['fast', 'analytical', 'consensus']],
  ['communication_preference', 'Communication', ['email', 'call', 'whatsapp', 'in-person']],
  ['lifestyle_type', 'Lifestyle', ['simple', 'balanced', 'premium']],
  ['eating_preference', 'Eating', ['veg', 'non-veg', 'vegan', 'mixed']],
  ['eating_out_frequency', 'Eating out', ['rare', 'weekly', 'frequent']],
  ['travel_frequency', 'Travel frequency', ['rare', 'occasional', 'frequent']],
  ['travel_type', 'Travel type', ['business', 'leisure', 'mixed']],
  ['social_activity_level', 'Social activity', ['low', 'medium', 'high']],
  ['network_size', 'Network size', ['few close', 'mixed', 'many connections']],
];
export function useClientBio(clientId: string | null) {
  return useQuery({
    queryKey: ['crm-client-bio', clientId],
    enabled: !!clientId,
    staleTime: 120_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_bio').select('*').eq('client_id', clientId).maybeSingle();
      if (error) throw new Error(error.message);
      return data ?? null;
    },
  });
}
export function useSaveBio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { clientId: string; existingId: string | null; values: Record<string, any> }) => {
      if (input.existingId) {
        const { error } = await supabase.from('client_bio').update(input.values).eq('id', input.existingId);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase.from('client_bio').insert({ client_id: input.clientId, ...input.values });
        if (error) throw new Error(error.message);
      }
    },
    onSuccess: (_r, v) => qc.invalidateQueries({ queryKey: ['crm-client-bio', v.clientId] }),
  });
}

/* ---------- Pause / Resume journey ---------- */
export function useActivePause(clientId: string | null) {
  return useQuery({
    queryKey: ['crm-client-pause', clientId],
    enabled: !!clientId,
    staleTime: 60_000,
    queryFn: async () => {
      try { await supabase.rpc('expire_due_client_pauses'); } catch { /* best-effort */ }
      const { data, error } = await supabase
        .from('client_pause_history').select('id, pause_start, pause_end, reason, paused_by')
        .eq('client_id', clientId).eq('is_active', true).maybeSingle();
      if (error) throw new Error(error.message);
      return data ?? null;
    },
  });
}
const pauseCommLog = (clientId: string, crmId: string, category: string, remarks: string) =>
  supabase.from('crm_communications').insert({
    client_id: clientId, crm_id: crmId,
    call_date: new Date().toISOString(),
    call_status: 'Follow Up Done', call_medium: null,
    category, remarks,
  });
export function usePauseJourney() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { clientId: string; crmId: string; pauseStart: string; pauseEnd: string | null; reason: string }) => {
      if (!input.reason.trim()) throw new Error('Reason is required');
      const { data: existing } = await supabase
        .from('client_pause_history').select('id').eq('client_id', input.clientId).eq('is_active', true).maybeSingle();
      if (existing) throw new Error('This client already has an active pause.');
      const today = new Date().toISOString().slice(0, 10);
      const isActive = !input.pauseEnd || input.pauseEnd >= today;
      const { error } = await supabase.from('client_pause_history').insert({
        client_id: input.clientId,
        pause_start: input.pauseStart,
        pause_end: input.pauseEnd,
        reason: input.reason.trim(),
        reason_admin: input.reason.trim(),
        is_active: isActive,
        paused_by: input.crmId,
      });
      if (error) throw new Error(error.message);
      await pauseCommLog(input.clientId, input.crmId, 'Journey Paused',
        `Journey Paused from ${input.pauseStart} until ${input.pauseEnd || 'TBD'} — ${input.reason.trim()}`);
    },
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ['crm-client-pause', v.clientId] });
      qc.invalidateQueries({ queryKey: ['crm-client-comms', v.clientId] });
      qc.invalidateQueries({ queryKey: ['crm-client-list'] });
    },
  });
}
export function useResumeJourney() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { pauseId: string; clientId: string; crmId: string; pausedSince: string | null }) => {
      const today = new Date().toISOString().slice(0, 10);
      const { error } = await supabase
        .from('client_pause_history').update({ is_active: false, pause_end: today }).eq('id', input.pauseId);
      if (error) throw new Error(error.message);
      try { await supabase.functions.invoke('notify-pause-ended', { body: { pause_id: input.pauseId } }); } catch { /* best-effort */ }
      await pauseCommLog(input.clientId, input.crmId, 'Journey Resumed',
        `Journey Resumed on ${today}${input.pausedSince ? ` (was paused since ${input.pausedSince})` : ''}`);
    },
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ['crm-client-pause', v.clientId] });
      qc.invalidateQueries({ queryKey: ['crm-client-comms', v.clientId] });
      qc.invalidateQueries({ queryKey: ['crm-client-list'] });
    },
  });
}

/* ---------- Discontinuation request ---------- */
export const DISCONTINUE_REASONS = ['Relocation', 'Financial', 'Health Issues', 'Not Satisfied', 'Schedule Conflict', 'Personal Reasons', 'Other'] as const;
export function useDiscontinuationRequests(clientId: string | null) {
  return useQuery({
    queryKey: ['crm-client-discontinue', clientId],
    enabled: !!clientId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_discontinuation_requests')
        .select('id, reason_category, reason_details, status, request_date, created_at')
        .eq('client_id', clientId).order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}
export function useRequestDiscontinuation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { clientId: string; requestedBy: string; category: string; details: string }) => {
      if (!input.details.trim()) throw new Error('Details are required');
      const { data: pending } = await supabase
        .from('client_discontinuation_requests').select('id')
        .eq('client_id', input.clientId).eq('status', 'pending').limit(1);
      if (pending?.length) throw new Error('A discontinuation request is already pending for this client.');
      const { error } = await supabase.from('client_discontinuation_requests').insert({
        client_id: input.clientId,
        requested_by: input.requestedBy,
        reason_category: input.category,
        reason_details: input.details.trim(),
        status: 'pending',
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: (_r, v) => qc.invalidateQueries({ queryKey: ['crm-client-discontinue', v.clientId] }),
  });
}

/* ---------- Task (crm_tasks — tagged_clients carries the client) ---------- */
export const TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export const TASK_CATEGORIES = [
  ['client_follow_up', 'Client Follow-up'],
  ['session_schedules', 'Session Schedules'],
  ['client_roster', 'Client Roster'],
  ['others', 'Others'],
] as const;
export function useCreateCrmTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { crmId: string; taggedId: string; title: string; description: string; priority: string; category: string; dueDate: string | null }) => {
      if (!input.title.trim()) throw new Error('Title is required');
      const { error } = await supabase.from('crm_tasks').insert({
        crm_id: input.crmId,
        title: input.title.trim(),
        description: input.description.trim() || null,
        priority: input.priority,
        status: 'pending',
        category: input.category,
        due_date: input.dueDate,
        tagged_clients: [input.taggedId],
        tagged_trainers: [],
        subtasks: [],
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['crm-tasks'] }),
  });
}

/* ---------- Assign trainers (trainer_clients toggle/insert) ---------- */
export function useStaffDirectory() {
  return useQuery({
    queryKey: ['crm-staff-directory'],
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles').select('id, first_name, last_name, role')
        .in('role', ['trainer', 'doctor']).order('first_name', { ascending: true });
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map((p) => ({ id: p.id, name: fullName(p), role: p.role as string }));
    },
  });
}
export function useClientAssignments(clientId: string | null) {
  return useQuery({
    queryKey: ['crm-client-assignments', clientId],
    enabled: !!clientId,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trainer_clients').select('id, trainer_id, actively_training').eq('client_id', clientId);
      if (error) throw new Error(error.message);
      return (data ?? []) as { id: string; trainer_id: string; actively_training: boolean }[];
    },
  });
}
export function useToggleAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { clientId: string; trainerId: string; existingRowId: string | null; makeActive: boolean }) => {
      if (input.existingRowId) {
        const { error } = await supabase
          .from('trainer_clients').update({ actively_training: input.makeActive }).eq('id', input.existingRowId);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase
          .from('trainer_clients').insert({ trainer_id: input.trainerId, client_id: input.clientId, actively_training: true });
        if (error) throw new Error(error.message);
      }
    },
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ['crm-client-assignments', v.clientId] });
      qc.invalidateQueries({ queryKey: ['crm-client-detail', v.clientId] });
    },
  });
}

/* ---------- Credentials (email from profiles + deterministic password, like the web) ---------- */
export function useClientCredentials(client: { id: string; profile_id: string | null; first_name: string | null; last_name: string | null } | null | undefined) {
  return useQuery({
    queryKey: ['crm-client-credentials', client?.id],
    enabled: !!client?.id,
    staleTime: 300_000,
    queryFn: async () => {
      let email: string | null = null;
      if (client!.profile_id) {
        const { data } = await supabase.from('profiles').select('email').eq('id', client!.profile_id).maybeSingle();
        email = data?.email ?? null;
      }
      const first = (client!.first_name || 'client').trim();
      const last = (client!.last_name || '').trim();
      if (!email || email.endsWith('@oddsapp.com')) {
        email = `${first.toLowerCase()}${last ? '.' + last.toLowerCase() : ''}@oddsapp.com`.replace(/\s+/g, '');
      }
      const password = `${first[0].toUpperCase()}${first.slice(1).toLowerCase()}@${client!.id.substring(0, 4)}`;
      return { email, password, onApp: !!client!.profile_id };
    },
  });
}

/* ---------- 10-Day AI Insight (edge function) ---------- */
export function useTenDayInsight() {
  return useMutation({
    mutationFn: async (clientId: string) => {
      const { data, error } = await supabase.functions.invoke('crm-client-10day-summary', { body: { client_id: clientId } });
      if (error) throw new Error(error.message ?? 'Insight service unavailable');
      return data as { activity_snapshot?: string; doctor_notes?: string; conversation_starters?: string[] | string };
    },
  });
}

/* ---------- Upcoming roster (session_schedule) ---------- */
export function useUpcomingRoster(clientId: string | null) {
  return useQuery({
    queryKey: ['crm-client-roster', clientId],
    enabled: !!clientId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('session_schedule')
        .select('id, scheduled_datetime, session_type, modality, status, trainer_id')
        .eq('client_id', clientId)
        .gte('scheduled_datetime', new Date().toISOString())
        .in('status', ['scheduled', 'confirmed'])
        .order('scheduled_datetime', { ascending: true })
        .limit(20);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as any[];
      const names = await namesFor(rows.map((r) => r.trainer_id));
      return rows.map((r) => ({ ...r, trainerName: r.trainer_id ? names.get(r.trainer_id) ?? 'Trainer' : 'N/A' }));
    },
  });
}
