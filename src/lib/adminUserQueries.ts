import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';

/* ============ Admin — User Management (web /admin/users port) ============
   Creation/updates go through the service-role edge functions (admin-create-user /
   admin-update-user); deletes hit profiles directly behind the web's role guards. */

export const USER_ROLES = [
  ['coach', 'Coaches'], ['trainer', 'Trainers'], ['doctor', 'Doctors'], ['crm', 'CRM'],
  ['marketing', 'Marketing'], ['academy', 'Academy'], ['super_admin', 'Super Admin'], ['ops', 'Ops'],
] as const;
export type ManagedRole = (typeof USER_ROLES)[number][0];
export const DOCTOR_SPECIALIZATIONS = ['physiotherapist', 'nutritionist'] as const;

export type ManagedUser = { id: string; email: string | null; first_name: string | null; last_name: string | null; created_at: string; doctor_specialization_tag: string | null };
export const userName = (u: { first_name: string | null; last_name: string | null }) => `${u.first_name ?? ''} ${u.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || '—';

export function useUsersByRole(role: ManagedRole) {
  return useQuery({
    queryKey: ['admin-users', role],
    staleTime: 30_000,
    queryFn: async (): Promise<ManagedUser[]> => {
      const { data, error } = await supabase.from('profiles').select('*').eq('role', role).order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as any[] as ManagedUser[];
    },
  });
}

/* Edge fn admin-create-user: {email, password, first_name, last_name, role, doctor_specialization_tag}.
   NOTE (web gotcha): if the email already exists the fn UPDATES that user's role. */
export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { email: string; password: string; firstName: string; lastName: string; role: ManagedRole; specialization: string | null }) => {
      if (!/.+@.+\..+/.test(input.email.trim())) throw new Error('Enter a valid email.');
      if (input.password.length < 6) throw new Error('Password must be at least 6 characters.');
      if (!input.firstName.trim() || !input.lastName.trim()) throw new Error('First and last name are required.');
      if (input.role === 'doctor' && !input.specialization) throw new Error('Pick a doctor specialization.');
      const { data, error } = await supabase.functions.invoke('admin-create-user', {
        body: {
          email: input.email.trim().toLowerCase(), password: input.password,
          first_name: input.firstName.trim(), last_name: input.lastName.trim(),
          role: input.role, doctor_specialization_tag: input.role === 'doctor' ? input.specialization : null,
        },
      });
      const errMsg = error?.message || (data as any)?.error;
      if (errMsg) throw new Error(errMsg);
      if (!(data as any)?.success) throw new Error('User creation failed.');
      return (data as any)?.message ?? 'User created.';
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });
}

/* Edge fn admin-update-user: {userId, email?, password?} (admin-gated server-side). */
export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { userId: string; email?: string; password?: string }) => {
      if (!input.email && !input.password) throw new Error('No changes to save.');
      const { data, error } = await supabase.functions.invoke('admin-update-user', {
        body: { userId: input.userId, ...(input.email ? { email: input.email.trim().toLowerCase() } : {}), ...(input.password ? { password: input.password } : {}) },
      });
      const errMsg = error?.message || (data as any)?.error;
      if (errMsg) throw new Error(errMsg);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });
}

export function useUpdateSpecialization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { userId: string; tag: string }) => {
      const { error } = await supabase.from('profiles').update({ doctor_specialization_tag: input.tag }).eq('id', input.userId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });
}

/* Delete with the web's role guards (coach/trainer FK pre-checks). Client-side
   auth.admin.deleteUser is skipped — it silently no-ops without a service role (web gotcha). */
export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { userId: string; role: ManagedRole }) => {
      const has = async (q: any) => ((await q.limit(1)).data ?? []).length > 0;
      if (input.role === 'coach') {
        if (await has(supabase.from('coach_trainers').select('id').eq('coach_id', input.userId)))
          throw new Error('This coach has assigned trainers — remove the assignments first.');
      }
      if (input.role === 'trainer') {
        if (await has(supabase.from('training_sessions').select('id').eq('trainer_id', input.userId)))
          throw new Error('This trainer has training sessions and cannot be deleted.');
        if (await has(supabase.from('coach_trainers').select('id').eq('trainer_id', input.userId)))
          throw new Error('This trainer is assigned to a coach — remove the assignment first.');
        if (await has(supabase.from('trainer_clients').select('id').eq('trainer_id', input.userId).eq('actively_training', true)))
          throw new Error('This trainer is actively training clients.');
      }
      const { error } = await supabase.from('profiles').delete().eq('id', input.userId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });
}

/* ---------------- Coach ↔ Trainer assignments (coach_trainers) ---------------- */
export type Assignment = { id: string; coach_id: string; trainer_id: string; assigned_at: string | null; coachName: string; trainerName: string };
export function useAssignments() {
  return useQuery({
    queryKey: ['coach-trainer-assignments'],
    staleTime: 30_000,
    queryFn: async (): Promise<Assignment[]> => {
      // Single joined read (fixes the web's N+1 per-row lookups).
      const { data, error } = await supabase.from('coach_trainers')
        .select('id, coach_id, trainer_id, assigned_at, coach:profiles!coach_id (first_name, last_name), trainer:profiles!trainer_id (first_name, last_name)')
        .order('assigned_at', { ascending: false });
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map((r) => ({ ...r, coachName: userName(r.coach ?? {}), trainerName: userName(r.trainer ?? {}) }));
    },
  });
}
export function useAssignmentOptions() {
  return useQuery({
    queryKey: ['assignment-options'],
    staleTime: 300_000,
    queryFn: async () => {
      // Doctors intentionally appear in both dropdowns (web parity).
      const [{ data: coaches, error: e1 }, { data: trainers, error: e2 }] = await Promise.all([
        supabase.from('profiles').select('id, first_name, last_name, role').in('role', ['coach', 'doctor']).order('first_name'),
        supabase.from('profiles').select('id, first_name, last_name, role').in('role', ['trainer', 'doctor']).order('first_name'),
      ]);
      const err = e1 ?? e2;
      if (err) throw new Error(err.message);
      const map = (rows: any[]) => rows.map((p) => ({ id: p.id, name: userName(p), role: p.role }));
      return { coaches: map(coaches ?? []), trainers: map(trainers ?? []) };
    },
  });
}
export function useAssignTrainerToCoach() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { coachId: string; trainerId: string }) => {
      if (input.coachId === input.trainerId) throw new Error('Cannot assign someone to themselves.');
      const { data: existing } = await supabase.from('coach_trainers').select('id').eq('coach_id', input.coachId).eq('trainer_id', input.trainerId).limit(1);
      if (existing?.length) throw new Error('This assignment already exists.');
      const { error } = await supabase.from('coach_trainers').insert({ coach_id: input.coachId, trainer_id: input.trainerId } as any);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['coach-trainer-assignments'] }),
  });
}
export function useRemoveAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('coach_trainers').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['coach-trainer-assignments'] }),
  });
}
