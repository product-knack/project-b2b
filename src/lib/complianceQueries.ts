import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';

/* ============ Workout Plans Analyst (compliance) ============
   Ports the web hooks EXACTLY:
   - useTrainerClientsForAnalyst → useComplianceClients (all subscribed clients +
     selectedGoal from the latest coach_assessment; optional trainer filter).
   - useClientWorkoutCompliance → useClientCompliance (per-session % of performed
     exercises that match the plan active on that date, strict modality matching).
   Gated by profiles.workout_compliances_analyst (capabilities.workoutComplianceAnalyst). */

const nm = (p: any) => `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || '—';

/* selectedGoal lives at various depths inside the assessment jsonb (web contract). */
const extractSelectedGoal = (a: any): string | null => {
  for (const src of [a.qhp_data, a.new_client_assessment_data, a.existing_client_assessment_data]) {
    if (src && typeof src === 'object') {
      if (src['Standardized Assessment']?.selectedGoal) return src['Standardized Assessment'].selectedGoal;
      if (src['Existing Client Re-Assessment']?.selectedGoal) return src['Existing Client Re-Assessment'].selectedGoal;
      if (src.selectedGoal) return src.selectedGoal;
      if (src.goalSelection?.selectedGoal) return src.goalSelection.selectedGoal;
    }
  }
  return null;
};

export type ComplianceClient = { id: string; name: string; initial: string; goal: string | null };
export function useComplianceClients(trainerId: string | null) {
  return useQuery({
    queryKey: ['compliance-clients', trainerId],
    staleTime: 120_000,
    refetchInterval: false,
    queryFn: async (): Promise<{ clients: ComplianceClient[]; goals: string[] }> => {
      let builder: any = supabase.from('clients').select('id, first_name, last_name').not('subscription_type', 'is', null);
      if (trainerId) {
        const { data: tc } = await supabase.from('trainer_clients').select('client_id').eq('trainer_id', trainerId).eq('actively_training', true);
        const ids = (tc ?? []).map((r: any) => r.client_id).filter(Boolean);
        if (!ids.length) return { clients: [], goals: [] };
        builder = builder.in('id', ids);
      }
      const { data: clients, error } = await builder.order('first_name', { ascending: true });
      if (error) throw new Error(error.message);
      if (!clients?.length) return { clients: [], goals: [] };

      // Latest assessment per client → selectedGoal (web fetches all, newest first).
      const goalMap = new Map<string, string | null>();
      const goals = new Set<string>();
      const ids = (clients as any[]).map((c) => c.id);
      for (let i = 0; i < ids.length; i += 100) {
        const { data: assessments } = await supabase
          .from('coach_assessment')
          .select('client_id, qhp_data, new_client_assessment_data, existing_client_assessment_data, created_at')
          .in('client_id', ids.slice(i, i + 100))
          .order('created_at', { ascending: false });
        (assessments ?? []).forEach((a: any) => {
          if (!a.client_id || goalMap.has(a.client_id)) return;
          const g = extractSelectedGoal(a);
          goalMap.set(a.client_id, g);
          if (g) goals.add(g);
        });
      }
      return {
        clients: (clients as any[]).map((c) => { const name = nm(c); return { id: c.id, name, initial: (name[0] ?? '?').toUpperCase(), goal: goalMap.get(c.id) ?? null }; }),
        goals: [...goals].sort(),
      };
    },
  });
}

/* ---------------- per-client compliance ---------------- */
const normalizeExercise = (name: string) => name.toLowerCase().trim().replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim().replace(/s\s*$/i, '');
const normalizeModality = (m: string | null) => (m ? m.toLowerCase().replace(/\s+/g, '').trim() : '');

export type ComplianceRow = { date: string; matched: number; total: number; percentage: number; modality: string | null; trainerId: string | null; trainerName: string };
export function useClientCompliance(clientId: string | null) {
  return useQuery({
    queryKey: ['client-workout-compliance', clientId],
    enabled: !!clientId,
    staleTime: 120_000,
    queryFn: async (): Promise<ComplianceRow[]> => {
      // Approved plans (web caps at 1000 exercise rows) + performed exercises (web caps 2000).
      const [{ data: planEx, error: e1 }, { data: doneEx, error: e2 }] = await Promise.all([
        supabase.from('workout_plan_exercises').select('plan_id, exercise_name, modality, approved_at').eq('client_id', clientId!).eq('status', 'approved').order('approved_at', { ascending: true }).limit(1000),
        supabase.from('workout_exercises').select('exercise_name, session_date, session_id, modality, trainer_id, created_at').eq('client_id', clientId!).not('session_date', 'is', null).order('session_date', { ascending: false }).limit(2000),
      ]);
      if (e1) throw new Error(e1.message);
      if (e2) throw new Error(e2.message);

      type Plan = { plan_id: string; approved_at: string; exercises: { exercise_name: string; modality: string | null }[] };
      const plansMap = new Map<string, Plan>();
      (planEx ?? []).forEach((pe: any) => {
        if (!plansMap.has(pe.plan_id)) plansMap.set(pe.plan_id, { plan_id: pe.plan_id, approved_at: pe.approved_at, exercises: [] });
        plansMap.get(pe.plan_id)!.exercises.push({ exercise_name: pe.exercise_name, modality: pe.modality });
      });
      const sortedPlans = [...plansMap.values()].sort((a, b) => new Date(a.approved_at).getTime() - new Date(b.approved_at).getTime());

      type Sess = { date: string; exercises: string[]; modalities: string[]; trainerId: string | null; createdAt: string | null };
      const sessions = new Map<string, Sess>();
      (doneEx ?? []).forEach((ce: any) => {
        if (!ce.session_date || !ce.session_id) return;
        if (!sessions.has(ce.session_id)) sessions.set(ce.session_id, { date: ce.session_date, exercises: [], modalities: [], trainerId: ce.trainer_id || null, createdAt: ce.created_at || null });
        const s = sessions.get(ce.session_id)!;
        s.exercises.push(normalizeExercise(ce.exercise_name));
        if (ce.modality) s.modalities.push(ce.modality);
      });

      const trainerIds = [...new Set([...sessions.values()].map((s) => s.trainerId).filter(Boolean))] as string[];
      const tNames = new Map<string, string>();
      if (trainerIds.length) {
        const { data: ts } = await supabase.from('profiles').select('id, first_name, last_name').in('id', trainerIds);
        (ts ?? []).forEach((t: any) => tNames.set(t.id, nm(t)));
      }

      const earliestPlan = sortedPlans.length ? new Date(sortedPlans[0].approved_at).getTime() : null;
      const findActivePlan = (sessTime: number, modalities: string[]): Plan | null => {
        const eligible = sortedPlans.filter((p) => sessTime >= new Date(p.approved_at).getTime());
        if (!eligible.length) return null;
        const sessMods = [...new Set(modalities.filter(Boolean))];
        if (!sessMods.length) return null; // strict modality matching — no modality, no match (web rule)
        const sm = normalizeModality(sessMods[0]);
        const matching = eligible.filter((p) => p.exercises.map((e) => normalizeModality(e.modality)).filter(Boolean).some((pm) => pm === sm || pm.includes(sm) || sm.includes(pm)));
        return matching.length ? matching[matching.length - 1] : null;
      };

      const rows: ComplianceRow[] = [];
      for (const s of sessions.values()) {
        const sessTime = s.createdAt ? new Date(s.createdAt).getTime() : new Date(s.date).getTime();
        if (!earliestPlan || sessTime < earliestPlan) continue; // sessions before any plan are excluded (web rule)
        const distinct = new Set(s.exercises);
        const totalDone = distinct.size;
        const modality = s.modalities.find(Boolean) ?? null;
        const plan = findActivePlan(sessTime, s.modalities);
        let matched = 0;
        if (plan) {
          const planned = new Set(plan.exercises.map((e) => normalizeExercise(e.exercise_name)));
          distinct.forEach((e) => { if (planned.has(e)) matched++; });
        }
        rows.push({
          date: s.date, matched, total: totalDone,
          percentage: plan && totalDone > 0 ? Math.round((matched / totalDone) * 100) : 0,
          modality: modality ?? (plan?.exercises.find((e) => e.modality)?.modality ?? null),
          trainerId: s.trainerId, trainerName: s.trainerId ? tNames.get(s.trainerId) ?? 'Unknown' : 'Unknown',
        });
      }
      return rows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    },
  });
}

/* Planned exercises for a session date — the web "Planned Exercises" dialog:
   find the approved plan active at the session's timestamp (strict modality match),
   return its deduped exercise list. Each planned exercise carries `done` (was it
   actually performed that day — same normalizeExercise matching the compliance %
   uses), plus `extras`: exercises performed that day that are NOT in the plan. */
export type PlannedExercise = { name: string; modality: string | null; done: boolean };
export type PlannedExercisesResult = { planned: PlannedExercise[]; extras: string[] };
export function usePlannedExercises(clientId: string | null, date: string | null, modality: string | null) {
  return useQuery({
    queryKey: ['planned-exercises', 'v2', clientId, date, modality], // v2: result gained done/extras
    enabled: !!clientId && !!date,
    staleTime: 300_000,
    queryFn: async (): Promise<PlannedExercisesResult | null> => {
      // Session rows for that day: real timestamp + the performed exercise names.
      const { data: we } = await supabase.from('workout_exercises').select('exercise_name, created_at').eq('client_id', clientId!).eq('session_date', date!).limit(500);
      const weRows = (we ?? []) as any[];
      const selectedTime = weRows[0]?.created_at ? new Date(weRows[0].created_at).getTime() : new Date(date!).getTime();
      const performed = new Map<string, string>(); // normalized -> display name
      weRows.forEach((r) => { if (r.exercise_name) performed.set(normalizeExercise(r.exercise_name), r.exercise_name); });

      const { data: planEx, error } = await supabase
        .from('workout_plan_exercises')
        .select('plan_id, exercise_name, modality, approved_at')
        .eq('client_id', clientId!).eq('status', 'approved')
        .order('approved_at', { ascending: true }).limit(1000);
      if (error) throw new Error(error.message);
      if (!planEx?.length) return null;

      type Plan = { plan_id: string; approved_at: string; exercises: { name: string; modality: string | null }[]; seen: Set<string> };
      const plansMap = new Map<string, Plan>();
      (planEx as any[]).forEach((pe) => {
        if (!plansMap.has(pe.plan_id)) plansMap.set(pe.plan_id, { plan_id: pe.plan_id, approved_at: pe.approved_at, exercises: [], seen: new Set() });
        const p = plansMap.get(pe.plan_id)!;
        if (!p.seen.has(pe.exercise_name)) { p.seen.add(pe.exercise_name); p.exercises.push({ name: pe.exercise_name, modality: pe.modality }); }
      });
      const sorted = [...plansMap.values()].sort((a, b) => new Date(a.approved_at).getTime() - new Date(b.approved_at).getTime());
      const eligible = sorted.filter((p) => selectedTime >= new Date(p.approved_at).getTime());
      if (!eligible.length || !modality) return null;
      const sm = normalizeModality(modality);
      const matching = eligible.filter((p) => p.exercises.map((e) => normalizeModality(e.modality)).filter(Boolean).some((pm) => pm === sm || pm.includes(sm) || sm.includes(pm)));
      if (!matching.length) return null;

      const plan = matching[matching.length - 1];
      const plannedNorm = new Set(plan.exercises.map((e) => normalizeExercise(e.name)));
      const planned: PlannedExercise[] = plan.exercises.map((e) => ({ ...e, done: performed.has(normalizeExercise(e.name)) }));
      const extras = [...performed.entries()].filter(([norm]) => !plannedNorm.has(norm)).map(([, display]) => display);
      return { planned, extras };
    },
  });
}
