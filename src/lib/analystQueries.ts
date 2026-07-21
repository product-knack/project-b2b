import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';

/* ============ Workout Analyst — mirrors the web WorkoutAnalyst page ============
   Flow: all trainers → a trainer's actively-training clients → a client's
   workout history (workout_exercises grouped by session) → session detail. */

export type AnalystTrainer = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
};

export function useAnalystTrainers() {
  return useQuery({
    queryKey: ['workout-analyst-trainers'],
    staleTime: 300_000,
    queryFn: async (): Promise<AnalystTrainer[]> => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, email, phone')
        .eq('role', 'trainer')
        .order('first_name', { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []).map((t: any) => ({
        id: t.id,
        name: `${t.first_name ?? ''} ${t.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || 'Trainer',
        email: t.email ?? null,
        phone: t.phone ?? null,
      }));
    },
  });
}

export type AnalystClient = {
  id: string;
  name: string;
  status: string | null;
};

export function useAnalystTrainerClients(trainerId: string | null) {
  return useQuery({
    queryKey: ['analyst-trainer-clients', trainerId],
    enabled: !!trainerId,
    staleTime: 120_000,
    queryFn: async (): Promise<AnalystClient[]> => {
      const { data, error } = await supabase
        .from('trainer_clients')
        .select('client_id, actively_training, clients (id, first_name, last_name, status)')
        .eq('trainer_id', trainerId)
        .eq('actively_training', true);
      if (error) throw new Error(error.message);
      return (data ?? [])
        .filter((tc: any) => tc.clients)
        .map((tc: any) => ({
          id: tc.clients.id,
          name: `${tc.clients.first_name ?? ''} ${tc.clients.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || 'Client',
          status: tc.clients.status ?? null,
        }));
    },
  });
}

export type AnalystExercise = {
  id: string;
  exercise_name: string;
  set_number: number | null;
  reps_performed: number | null;
  load_performed: string | null;
  duration_seconds: string | null;
  exercise_notes: string | null;
  remark: string | null;
  body_part: string | null;
  equipment: string | null;
  super_set_group: string | null;
};
export type AnalystSession = {
  sessionId: string;
  sessionName: string;
  sessionDate: string;
  trainerName: string;
  exercises: AnalystExercise[];
};

export function useAnalystClientWorkouts(clientId: string | null) {
  return useQuery({
    queryKey: ['analyst-client-workouts', clientId],
    enabled: !!clientId,
    staleTime: 30_000,
    queryFn: async (): Promise<AnalystSession[]> => {
      const { data, error } = await supabase
        .from('workout_exercises')
        .select('id, exercise_name, set_number, reps_performed, load_performed, exercise_notes, remark, created_at, session_id, session_date, session_name, body_part, equipment, duration_seconds, trainer_id, super_set_group')
        .eq('client_id', clientId)
        .order('session_date', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as any[];
      if (!rows.length) return [];

      // Trainer names for all rows (like the web page's second lookup).
      const trainerIds = [...new Set(rows.map((r) => r.trainer_id).filter(Boolean))];
      const trainerMap = new Map<string, string>();
      if (trainerIds.length) {
        const { data: trainers } = await supabase
          .from('profiles')
          .select('id, first_name, last_name')
          .in('id', trainerIds);
        (trainers ?? []).forEach((t: any) => {
          const nm = `${t.first_name ?? ''} ${t.last_name ?? ''}`.replace(/\s+/g, ' ').trim();
          if (nm) trainerMap.set(t.id, nm);
        });
      }

      // Group by session (web logic: key session_id, fall back to 'no-session').
      const grouped = new Map<string, AnalystSession>();
      rows.forEach((r) => {
        const key = r.session_id || 'no-session';
        if (!grouped.has(key)) {
          grouped.set(key, {
            sessionId: key,
            sessionName: r.session_name || 'Unnamed Workout',
            sessionDate: r.session_date || r.created_at,
            trainerName: (r.trainer_id && trainerMap.get(r.trainer_id)) || 'Not Available',
            exercises: [],
          });
        }
        grouped.get(key)!.exercises.push({
          id: r.id,
          exercise_name: r.exercise_name,
          set_number: r.set_number ?? null,
          reps_performed: r.reps_performed ?? null,
          load_performed: r.load_performed ?? null,
          duration_seconds: r.duration_seconds ?? null,
          exercise_notes: r.exercise_notes ?? null,
          remark: r.remark ?? null,
          body_part: r.body_part ?? null,
          equipment: r.equipment ?? null,
          super_set_group: r.super_set_group ?? null,
        });
      });
      return Array.from(grouped.values()).sort(
        (a, b) => new Date(b.sessionDate).getTime() - new Date(a.sessionDate).getTime()
      );
    },
  });
}
