import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';

/* ============ Admin — ODDS Certifications (web /admin/certifications port) ============
   Single table odds_certifications. WEB QUIRK kept for parity: the table shows a WEIGHTED
   overall % (sum/106) while the stored grade uses the UNWEIGHTED average of the three
   sub-scores — same certificate can read 88% with grade A. */

export type Certification = {
  id: string; trainer_id: string; course_name: string | null;
  written_test: number | null; viva: number | null; english_spoken: number | null;
  grade: string | null; created_at: string;
  profiles: { first_name: string | null; last_name: string | null } | null;
};
export const certTrainerName = (c: Certification) => `${c.profiles?.first_name ?? ''} ${c.profiles?.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || 'Unknown';
export const overallPct = (c: { written_test: number | null; viva: number | null; english_spoken: number | null }) =>
  Math.round((((c.written_test ?? 0) + (c.viva ?? 0) + (c.english_spoken ?? 0)) / 106) * 1000) / 10;
export const unweightedGrade = (written: number, viva: number, english: number) => {
  const avg = ((written / 90 + viva / 6 + english / 10) / 3) * 100;
  const grade = avg >= 90 ? 'A' : avg >= 80 ? 'B' : avg >= 70 ? 'C' : avg >= 60 ? 'D' : 'F';
  return { avg: Math.round(avg * 10) / 10, grade };
};

export function useCertifications() {
  return useQuery({
    queryKey: ['odds-certifications'],
    staleTime: 30_000,
    queryFn: async (): Promise<Certification[]> => {
      const { data, error } = await supabase.from('odds_certifications')
        .select('*, profiles:trainer_id ( first_name, last_name )')
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as any[] as Certification[];
    },
  });
}

const clamp = (v: number, max: number) => Math.max(0, Math.min(max, Number.isFinite(v) ? v : 0));
/* Insert/update with a CLEAN payload of known columns only (fixes the web's
   whole-object-with-joined-profiles update leak). Grade recomputed on save. */
export function useSaveCertification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id?: string; trainerId: string; courseName: string; written: number; viva: number; english: number }) => {
      if (!input.trainerId) throw new Error('Pick a trainer.');
      if (!input.courseName.trim()) throw new Error('Course name is required.');
      const written = clamp(input.written, 90); const viva = clamp(input.viva, 6); const english = clamp(input.english, 10);
      const payload = {
        trainer_id: input.trainerId, course_name: input.courseName.trim(),
        written_test: written, viva, english_spoken: english,
        grade: unweightedGrade(written, viva, english).grade,
      };
      const { error } = input.id
        ? await supabase.from('odds_certifications').update(payload).eq('id', input.id)
        : await supabase.from('odds_certifications').insert(payload as any);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['odds-certifications'] }),
  });
}
export function useDeleteCertification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('odds_certifications').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['odds-certifications'] }),
  });
}
export function useCertTrainers() {
  return useQuery({
    queryKey: ['cert-trainers'],
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('id, first_name, last_name').eq('role', 'trainer').order('first_name');
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map((p) => ({ id: p.id, name: `${p.first_name ?? ''} ${p.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || '—' }));
    },
  });
}
