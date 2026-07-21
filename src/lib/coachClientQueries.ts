import { useQuery, useMutation } from '@tanstack/react-query';
import { supabase } from './supabase';

/* ============ Coach → Clients Overview → client detail sections ============
   Ports the web CoachClientOverviewDetail sections with EXACT backend contracts:
   - QHP Comparison        → coach_assessment + edge fn 'compare-qhps'
   - Workout Volume        → training_sessions months + edge fn 'analyse-workout-volume'
   - Improvements          → workout_exercises (paged) bucketed per modality/month
   - AI Workout Plan       → edge fn 'coach-ai-workout-plan'
   All verified live as the coach account (reads + fn reachability). */

const IST = 'Asia/Kolkata';
const PAGE = 1000;

/* "YYYY-MM" in IST for a timestamp; date-only strings pass through. */
export const monthKeyIST = (dateStr: string): string => {
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr) && dateStr.length <= 10) return dateStr.slice(0, 7);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: IST, year: 'numeric', month: '2-digit' }).formatToParts(new Date(dateStr));
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  return `${y}-${m}`;
};
export const monthLabel = (key: string) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
};
/* Oldest QHP = "QHP Baseline", later ones "QHP Refresh N" (space, not hyphen — web rule). */
export const qhpFullLabel = (chronoIndex: number) => (chronoIndex === 1 ? 'QHP Baseline' : `QHP Refresh ${chronoIndex - 1}`);

/* Edge-function errors come back as a Response in error.context — surface the fn's message. */
async function fnMessage(error: any, fallback: string): Promise<string> {
  try {
    if (error?.context?.text) {
      const t = await error.context.text();
      const j = JSON.parse(t);
      if (j?.error) return String(j.error);
    }
  } catch {}
  return error?.message || fallback;
}

/* ---------------- QHP Comparison ---------------- */
export type QhpItem = { id: string; date: string; label: string };
export function useClientQhps(clientId: string | null) {
  return useQuery({
    queryKey: ['client-qhps-chronological', clientId],
    enabled: !!clientId,
    staleTime: 300_000,
    queryFn: async (): Promise<QhpItem[]> => {
      const { data, error } = await supabase
        .from('coach_assessment')
        .select('id, assessment_date, mechanical_score, qhp_data, new_client_assessment_data, existing_client_assessment_data')
        .eq('client_id', clientId!)
        .order('assessment_date', { ascending: true });
      if (error) throw new Error(error.message);
      const completed = (data ?? []).filter((r: any) => r.mechanical_score || r.qhp_data || r.new_client_assessment_data || r.existing_client_assessment_data);
      return completed.map((r: any, idx: number) => ({ id: r.id, date: r.assessment_date, label: qhpFullLabel(idx + 1) }));
    },
  });
}
export function useCompareQhps() {
  return useMutation({
    /* The edge fn returns 200 with the literal "(No comparison generated)" when the AI
       gateway reply is empty (intermittent). Treat that as a failure so react-query
       retries instead of rendering the placeholder. */
    retry: 2,
    retryDelay: 1500,
    mutationFn: async (input: { items: QhpItem[] }): Promise<string> => {
      if (input.items.length < 2) throw new Error('Select at least two QHPs');
      const labels: Record<string, string> = {};
      input.items.forEach((q) => { labels[q.id] = q.label; });
      const { data, error } = await supabase.functions.invoke('compare-qhps', { body: { qhp_ids: input.items.map((q) => q.id), qhp_labels: labels } });
      if (error) throw new Error(await fnMessage(error, 'Failed to generate comparison'));
      if ((data as any)?.error) throw new Error((data as any).error);
      const md = ((data as any).comparison_markdown ?? '') as string;
      if (!md.trim() || /no comparison generated/i.test(md)) throw new Error('The AI returned an empty comparison. Tap Generate to try again.');
      return md;
    },
  });
}

/* ---------------- Workout Volume Analysis ---------------- */
export type MonthAgg = {
  month: string; sessions: number; totalSessionMinutes: number; totalSets: number;
  totalReps: number; totalLoadVolume: number; totalDurationMinutes: number;
  topBodyParts: { name: string; sets: number }[]; topModalities: { name: string; sets: number }[];
};
export type VolumeResult = { summary: string; months: MonthAgg[] };
export function useClientWorkoutMonths(clientId: string | null) {
  return useQuery({
    queryKey: ['client-workout-months', clientId],
    enabled: !!clientId,
    staleTime: 300_000,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase
        .from('training_sessions')
        .select('scheduled_at, status, cancelled')
        .eq('client_id', clientId!)
        .eq('status', 'completed')
        .order('scheduled_at', { ascending: false });
      if (error) throw new Error(error.message);
      const set = new Set<string>();
      (data ?? []).forEach((r: any) => { if (!r.cancelled && r.scheduled_at) set.add(monthKeyIST(r.scheduled_at)); });
      return [...set].sort((a, b) => (a < b ? 1 : -1));
    },
  });
}
export function useAnalyseVolume() {
  return useMutation({
    mutationFn: async (input: { clientId: string; months: string[] }): Promise<VolumeResult> => {
      if (input.months.length < 2 || new Set(input.months).size !== input.months.length) throw new Error('Pick at least 2 unique months');
      const { data, error } = await supabase.functions.invoke('analyse-workout-volume', { body: { clientId: input.clientId, months: input.months } });
      if (error) throw new Error(await fnMessage(error, 'Failed to analyse'));
      const d = data as any;
      const months: MonthAgg[] = d?.months?.length ? d.months : [d?.monthA, d?.monthB].filter(Boolean);
      return { summary: d?.summary_markdown ?? '', months };
    },
  });
}

/* ---------------- Improvements (workout_exercises) ---------------- */
export type ModalityBucket = 'Strength' | 'YogaPilates' | 'Aerobics';
export const bucketFor = (raw: string | null | undefined): ModalityBucket | null => {
  if (!raw) return null;
  const m = raw.trim().toLowerCase();
  if (!m) return null;
  if (/(yoga|pilates)/.test(m)) return 'YogaPilates';
  if (/(aerobic|hiit|cardio|boxing)/.test(m)) return 'Aerobics';
  if (/(strength|push|pull|full\s*body|upper\s*body|lower\s*body|legs?\b|fb\s*strength)/.test(m)) return 'Strength';
  return null;
};
export type ModalityMonthAgg = {
  month: string; sessions: number; totalSets: number; totalReps: number; totalLoadVolume: number;
  totalDurationMinutes: number; totalRounds: number; avgRIR: number | null; topExercises: { name: string; sets: number }[];
};
export type ModalityImprovements = Record<ModalityBucket, ModalityMonthAgg[]>;
export function useClientModalityImprovements(clientId: string | null) {
  return useQuery({
    queryKey: ['client-modality-improvements', clientId],
    enabled: !!clientId,
    staleTime: 300_000,
    queryFn: async (): Promise<ModalityImprovements> => {
      const all: any[] = [];
      for (let from = 0; from < 30 * PAGE; from += PAGE) {
        const { data, error } = await supabase
          .from('workout_exercises')
          .select('modality, session_date, session_id, reps_performed, load_performed, duration_seconds, rounds, rir_performed, exercise_name')
          .eq('client_id', clientId!)
          .not('session_date', 'is', null)
          .order('session_date', { ascending: false })
          .range(from, from + PAGE - 1);
        if (error) throw new Error(error.message);
        all.push(...(data ?? []));
        if ((data ?? []).length < PAGE) break;
      }
      type Acc = { sessions: Set<string>; sets: number; reps: number; load: number; durationSec: number; rounds: number; rirSum: number; rirCount: number; exercises: Map<string, number> };
      const newAcc = (): Acc => ({ sessions: new Set(), sets: 0, reps: 0, load: 0, durationSec: 0, rounds: 0, rirSum: 0, rirCount: 0, exercises: new Map() });
      const buckets: Record<ModalityBucket, Map<string, Acc>> = { Strength: new Map(), YogaPilates: new Map(), Aerobics: new Map() };
      for (const row of all) {
        const b = bucketFor(row.modality);
        if (!b || !row.session_date) continue;
        const month = monthKeyIST(row.session_date);
        let acc = buckets[b].get(month);
        if (!acc) { acc = newAcc(); buckets[b].set(month, acc); }
        acc.sets += 1;
        if (row.session_id) acc.sessions.add(row.session_id);
        if (typeof row.reps_performed === 'number') acc.reps += row.reps_performed;
        const load = row.load_performed ? parseFloat(row.load_performed) : NaN;
        if (!isNaN(load) && typeof row.reps_performed === 'number') acc.load += load * row.reps_performed;
        const dur = row.duration_seconds ? parseFloat(row.duration_seconds) : NaN;
        if (!isNaN(dur)) acc.durationSec += dur;
        if (typeof row.rounds === 'number') acc.rounds += row.rounds;
        if (typeof row.rir_performed === 'number') { acc.rirSum += row.rir_performed; acc.rirCount += 1; }
        const k = (row.exercise_name ?? '').trim();
        if (k) acc.exercises.set(k, (acc.exercises.get(k) ?? 0) + 1);
      }
      const finalize = (map: Map<string, Acc>): ModalityMonthAgg[] => [...map.entries()].map(([month, a]) => ({
        month, sessions: a.sessions.size, totalSets: a.sets, totalReps: a.reps,
        totalLoadVolume: Math.round(a.load), totalDurationMinutes: Math.round(a.durationSec / 60), totalRounds: a.rounds,
        avgRIR: a.rirCount ? +(a.rirSum / a.rirCount).toFixed(1) : null,
        topExercises: [...a.exercises.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([name, sets]) => ({ name, sets })),
      })).sort((x, y) => (x.month < y.month ? 1 : -1));
      return { Strength: finalize(buckets.Strength), YogaPilates: finalize(buckets.YogaPilates), Aerobics: finalize(buckets.Aerobics) };
    },
  });
}

export type MonthSessionDetail = {
  sessionId: string; sessionName: string | null; sessionDate: string; trainerName: string | null;
  totalSets: number; totalReps: number; totalLoadVolume: number; totalDurationMinutes: number; totalRounds: number;
  exercises: { name: string; sets: number; reps: number; loadVolume: number; durationMinutes: number }[];
};
const lastDayOfMonth = (month: string) => { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
export function useClientModalityMonthDetail(clientId: string | null, bucket: ModalityBucket | null, month: string | null) {
  return useQuery({
    queryKey: ['client-modality-month-detail', clientId, bucket, month],
    enabled: !!clientId && !!bucket && !!month,
    staleTime: 300_000,
    queryFn: async (): Promise<MonthSessionDetail[]> => {
      const start = `${month}-01`;
      const end = `${month}-${String(lastDayOfMonth(month!)).padStart(2, '0')}`;
      const all: any[] = [];
      for (let from = 0; from < 10 * PAGE; from += PAGE) {
        const { data, error } = await supabase
          .from('workout_exercises')
          .select('modality, session_date, session_id, session_name, trainer_id, exercise_name, reps_performed, load_performed, duration_seconds, rounds')
          .eq('client_id', clientId!)
          .gte('session_date', start)
          .lte('session_date', end)
          .order('session_date', { ascending: false })
          .range(from, from + PAGE - 1);
        if (error) throw new Error(error.message);
        all.push(...(data ?? []));
        if ((data ?? []).length < PAGE) break;
      }
      const filtered = all.filter((r) => bucketFor(r.modality) === bucket);
      type Sess = { sessionId: string; sessionName: string | null; sessionDate: string; trainerId: string | null; sets: number; reps: number; load: number; durationSec: number; rounds: number; exercises: Map<string, { sets: number; reps: number; load: number; durationSec: number }> };
      const sessions = new Map<string, Sess>();
      for (const r of filtered) {
        if (!r.session_id || !r.session_date) continue;
        let acc = sessions.get(r.session_id);
        if (!acc) { acc = { sessionId: r.session_id, sessionName: r.session_name, sessionDate: r.session_date, trainerId: r.trainer_id, sets: 0, reps: 0, load: 0, durationSec: 0, rounds: 0, exercises: new Map() }; sessions.set(r.session_id, acc); }
        acc.sets += 1;
        const load = r.load_performed ? parseFloat(r.load_performed) : NaN;
        const dur = r.duration_seconds ? parseFloat(r.duration_seconds) : NaN;
        if (typeof r.reps_performed === 'number') acc.reps += r.reps_performed;
        if (!isNaN(load) && typeof r.reps_performed === 'number') acc.load += load * r.reps_performed;
        if (!isNaN(dur)) acc.durationSec += dur;
        if (typeof r.rounds === 'number') acc.rounds += r.rounds;
        const exName = (r.exercise_name ?? '').trim() || 'Unnamed';
        let ex = acc.exercises.get(exName);
        if (!ex) { ex = { sets: 0, reps: 0, load: 0, durationSec: 0 }; acc.exercises.set(exName, ex); }
        ex.sets += 1;
        if (typeof r.reps_performed === 'number') ex.reps += r.reps_performed;
        if (!isNaN(load) && typeof r.reps_performed === 'number') ex.load += load * r.reps_performed;
        if (!isNaN(dur)) ex.durationSec += dur;
      }
      const trainerIds = [...new Set([...sessions.values()].map((s) => s.trainerId).filter(Boolean))] as string[];
      const tNames = new Map<string, string>();
      if (trainerIds.length) {
        const { data } = await supabase.from('profiles').select('id, first_name, last_name').in('id', trainerIds);
        (data ?? []).forEach((t: any) => tNames.set(t.id, `${t.first_name ?? ''} ${t.last_name ?? ''}`.trim() || 'Trainer'));
      }
      return [...sessions.values()].map((s): MonthSessionDetail => ({
        sessionId: s.sessionId, sessionName: s.sessionName, sessionDate: s.sessionDate,
        trainerName: s.trainerId ? tNames.get(s.trainerId) ?? null : null,
        totalSets: s.sets, totalReps: s.reps, totalLoadVolume: Math.round(s.load),
        totalDurationMinutes: Math.round(s.durationSec / 60), totalRounds: s.rounds,
        exercises: [...s.exercises.entries()].map(([name, e]) => ({ name, sets: e.sets, reps: e.reps, loadVolume: Math.round(e.load), durationMinutes: Math.round(e.durationSec / 60) })).sort((a, b) => b.sets - a.sets),
      })).sort((a, b) => (a.sessionDate < b.sessionDate ? 1 : -1));
    },
  });
}

/* ---------------- AI Workout Plan ---------------- */
export type AiPlanDay = { day_label: string; focus: string; blocks: { name: string; details: string }[]; references: string[] };
export type AiPlan = {
  summary: string; weekly_focus: string[]; days: AiPlanDay[]; references_global: string[];
  rationale?: { decision: string; evidence: string; theory: string }[]; caveats: string[];
};
export type AiPlanContext = { workout_days_14d?: number; abnormal_marker_count?: number; medical_condition_count?: number; avg_sleep_hours_7d?: number | null };
export function useGenerateAiPlan() {
  return useMutation({
    mutationFn: async (input: { clientId: string }): Promise<{ plan: AiPlan; context: AiPlanContext | null }> => {
      const { data, error } = await supabase.functions.invoke('coach-ai-workout-plan', { body: { client_id: input.clientId } });
      if (error) throw new Error(await fnMessage(error, 'Could not generate plan'));
      if ((data as any)?.error) throw new Error((data as any).error);
      return { plan: (data as any).plan as AiPlan, context: ((data as any).context_summary ?? null) as AiPlanContext | null };
    },
  });
}
export function aiPlanToText(plan: AiPlan, clientName: string): string {
  const L: string[] = [`AI WORKOUT PLAN — ${clientName}`, '='.repeat(50), '', 'SUMMARY', plan.summary, ''];
  if (plan.weekly_focus?.length) { L.push('WEEKLY FOCUS'); plan.weekly_focus.forEach((f) => L.push(`- ${f}`)); L.push(''); }
  plan.days?.forEach((d) => {
    L.push(`${d.day_label.toUpperCase()} — ${d.focus}`);
    d.blocks?.forEach((b) => L.push(`  ${b.name}: ${b.details}`));
    if (d.references?.length) L.push(`  References: ${d.references.join('; ')}`);
    L.push('');
  });
  if (plan.references_global?.length) { L.push('DATA REFERENCES (whole plan)'); plan.references_global.forEach((r) => L.push(`- ${r}`)); L.push(''); }
  if (plan.rationale?.length) { L.push('WHY THIS PLAN — RATIONALE & THEORY'); plan.rationale.forEach((r) => { L.push(`- Decision: ${r.decision}`); L.push(`  Evidence: ${r.evidence}`); L.push(`  Theory: ${r.theory}`); }); L.push(''); }
  if (plan.caveats?.length) { L.push('CAVEATS'); plan.caveats.forEach((c) => L.push(`- ${c}`)); }
  return L.join('\n');
}

/* ---------------- Markdown → toned sections (for the AI outputs) ---------------- */
export type MdTone = 'positive' | 'negative' | 'action' | 'neutral';
export type MdSection = { heading: string; body: string; tone: MdTone };
const toneFor = (heading: string): MdTone => {
  const h = heading.toLowerCase();
  if (/(improvement|gain|progress|increase|better|win|up\b)/.test(h)) return 'positive';
  if (/(regression|concern|decline|drop|worsen|risk|issue|down\b)/.test(h)) return 'negative';
  if (/(recommend|next|action|focus|plan)/.test(h)) return 'action';
  return 'neutral';
};
export function splitMdSections(md: string): MdSection[] {
  const out: MdSection[] = [];
  let cur: MdSection | null = null;
  const pre: string[] = [];
  for (const line of md.split(/\r?\n/)) {
    const m = line.match(/^#{2,3}\s+(.*)$/);
    if (m) { if (cur) out.push(cur); cur = { heading: m[1].trim(), body: '', tone: toneFor(m[1]) }; }
    else if (cur) cur.body += (cur.body ? '\n' : '') + line;
    else pre.push(line);
  }
  if (cur) out.push(cur);
  const preText = pre.join('\n').trim();
  if (preText) out.unshift({ heading: '', body: preText, tone: 'neutral' });
  return out.length ? out : [{ heading: '', body: md, tone: 'neutral' }];
}
