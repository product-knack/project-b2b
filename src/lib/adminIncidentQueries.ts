import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';

/* ============ Admin — Trainer incidents (web TrainerIncidentsPanel/Dialog port) ============ */

export type IncidentTrainer = { id: string; first_name: string | null; last_name: string | null };
export function useIncidentTrainers() {
  return useQuery({
    queryKey: ['trainers-list-for-incidents'],
    staleTime: 300_000,
    queryFn: async (): Promise<IncidentTrainer[]> => {
      const rows: IncidentTrainer[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from('profiles').select('id, first_name, last_name')
          .eq('role', 'trainer').order('first_name', { ascending: true }).order('last_name', { ascending: true })
          .range(from, from + 999);
        if (error) throw new Error(error.message);
        rows.push(...((data ?? []) as any[]));
        if (!data || data.length < 1000) break;
      }
      return rows;
    },
  });
}

/* Count badge per trainer — incidents logged by the CURRENT author (web parity). */
export function useMyIncidentCounts(profileId: string | null) {
  return useQuery({
    queryKey: ['incident-counts-by-author', profileId],
    enabled: !!profileId,
    staleTime: 60_000,
    // Plain object, NOT a Map — the persisted query cache rehydrates Maps as {}.
    queryFn: async (): Promise<Record<string, number>> => {
      const { data, error } = await supabase.from('trainers_incidents')
        .select('trainer_id').eq('author_id', profileId!);
      if (error) throw new Error(error.message);
      const m: Record<string, number> = {};
      (data ?? []).forEach((r: any) => { m[r.trainer_id] = (m[r.trainer_id] ?? 0) + 1; });
      return m;
    },
  });
}

export type TrainerIncident = { id: string; trainer_id: string; author_id: string | null; author_role: string; message: string; created_at: string; authorName: string | null };
export function useTrainerIncidents(trainerId: string | null) {
  return useQuery({
    queryKey: ['trainer-incidents', trainerId],
    enabled: !!trainerId,
    staleTime: 30_000,
    queryFn: async (): Promise<TrainerIncident[]> => {
      const { data, error } = await supabase.from('trainers_incidents')
        .select('id, trainer_id, author_id, author_role, message, created_at')
        .eq('trainer_id', trainerId!).order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as any[];
      const authorIds = [...new Set(rows.map((r) => r.author_id).filter(Boolean))];
      const names = new Map<string, string>();
      if (authorIds.length) {
        const { data: profs } = await supabase.from('profiles').select('id, first_name, last_name').in('id', authorIds);
        (profs ?? []).forEach((p: any) => names.set(p.id, `${p.first_name ?? ''} ${p.last_name ?? ''}`.replace(/\s+/g, ' ').trim()));
      }
      return rows.map((r) => ({ ...r, authorName: r.author_id ? names.get(r.author_id) ?? null : null }));
    },
  });
}

export function useAddIncident() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { trainerId: string; message: string; profileId: string | null }) => {
      if (!input.profileId) throw new Error('Not authenticated');
      const msg = input.message.trim();
      if (msg.length < 5) throw new Error('Incident note must be at least 5 characters.');
      const { error } = await supabase.from('trainers_incidents').insert({
        trainer_id: input.trainerId, author_id: input.profileId, author_role: 'admin', message: msg,
      } as any);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['trainer-incidents', v.trainerId] });
      qc.invalidateQueries({ queryKey: ['incident-counts-by-author'] });
    },
  });
}
