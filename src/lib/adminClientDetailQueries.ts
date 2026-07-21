import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';

/* ============ Admin — Client detail (web /admin/clients/:id port) ============ */

const nameOf = (p: any) => `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || '—';
const normalizeRole = (r: string | null) => (r === 'others' ? 'doctor' : r ?? 'trainer');

export type DetailTrainer = { rowId: string; trainerId: string; name: string; role: string; actively_training: boolean };
export type ClientDetail = {
  id: string; first_name: string | null; last_name: string | null; email: string | null; phone: string | null;
  goal: string | null; notes: string | null; status: string | null; subscription_type: string | null;
  session_package: string | null; package_duration: string | null; sessions_per_cycle: number | null;
  is_hybrid: boolean | null; is_odds_converted: boolean; profile_id: string | null; client_source: 'B2B' | 'B2C';
  created_at: string; trainers: DetailTrainer[]; completed_sessions: number;
  pkg: { total: number; used: number; renewedAt: string | null };
};

export function useClientDetail(clientId: string | null) {
  return useQuery({
    queryKey: ['client', clientId],
    enabled: !!clientId,
    staleTime: 120_000,
    queryFn: async (): Promise<ClientDetail> => {
      const { data: c, error } = await supabase.from('clients').select('*').eq('id', clientId!).single();
      if (error) throw new Error(error.message);
      const client: any = { ...c, client_source: (c as any).profile_id ? 'B2C' : 'B2B' };
      if (client.profile_id) {
        const { data: p } = await supabase.from('profiles').select('is_odds_converted, conversion_date').eq('id', client.profile_id).maybeSingle();
        if (p) { client.is_odds_converted = (p as any).is_odds_converted ?? client.is_odds_converted; }
      }
      const [{ data: tcs }, { count: sess }, renewal] = await Promise.all([
        supabase.from('trainer_clients').select('id, trainer_id, actively_training, profiles:trainer_id (first_name, last_name, role)').eq('client_id', clientId!),
        supabase.from('training_sessions').select('id', { count: 'exact', head: true }).eq('client_id', clientId!)
          .neq('status', 'parked').eq('complimentary_session', false).gte('scheduled_at', client.created_at),
        supabase.from('client_renewals').select('renewed_at, package_sessions').eq('client_id', clientId!).order('renewed_at', { ascending: false }).limit(1),
      ]);
      const latest: any = renewal.data?.[0] ?? null;
      const total = latest?.package_sessions || parseInt(String(client.session_package ?? '')) || 0;
      const start = latest?.renewed_at || client.created_at;
      const { data: consuming } = await supabase.from('training_sessions').select('scheduled_at').eq('client_id', clientId!)
        .or('status.eq.completed,status.eq.cancelled,cancelled.eq.true').gte('scheduled_at', start).limit(10000);
      return {
        ...client,
        trainers: ((tcs ?? []) as any[]).map((t) => ({ rowId: t.id, trainerId: t.trainer_id, name: nameOf(t.profiles), role: normalizeRole(t.profiles?.role), actively_training: !!t.actively_training })),
        completed_sessions: sess ?? 0,
        pkg: { total, used: (consuming ?? []).length, renewedAt: latest?.renewed_at ?? null },
      };
    },
  });
}

export function useActivePause(clientId: string | null) {
  return useQuery({
    queryKey: ['client-pause', clientId],
    enabled: !!clientId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('client_pause_history').select('*').eq('client_id', clientId!).eq('is_active', true).limit(1);
      if (error) throw new Error(error.message);
      return (data?.[0] as any) ?? null;
    },
  });
}

export function useClientSessionList(clientId: string | null) {
  return useQuery({
    queryKey: ['client-sessions', clientId],
    enabled: !!clientId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('training_sessions')
        .select('id, scheduled_at, status, cancelled, session_type, location, complimentary_session, profiles:trainer_id (first_name, last_name)')
        .eq('client_id', clientId!).order('scheduled_at', { ascending: true }).limit(2000);
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map((s) => ({ ...s, trainerName: nameOf(s.profiles) }));
    },
  });
}

export function useClientRemarks(clientId: string | null) {
  return useQuery({
    queryKey: ['client-remarks', clientId],
    enabled: !!clientId,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('client_remarks')
        .select('id, content, created_at, author_id, profiles:author_id (first_name, last_name, role)')
        .eq('client_id', clientId!).order('created_at', { ascending: false }).limit(200);
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map((r) => ({ ...r, authorName: nameOf(r.profiles), authorRole: r.profiles?.role ?? null }));
    },
  });
}
export function useAddClientRemark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { clientId: string; content: string; profileId: string | null }) => {
      const c = input.content.trim();
      if (c.length < 3) throw new Error('Remark too short.');
      const { error } = await supabase.from('client_remarks').insert({ client_id: input.clientId, author_id: input.profileId, content: c } as any);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['client-remarks', v.clientId] }),
  });
}

const invalidateDetail = (qc: ReturnType<typeof useQueryClient>, clientId: string) => {
  qc.invalidateQueries({ queryKey: ['client', clientId] });
  qc.invalidateQueries({ queryKey: ['admin-clients'] });
};

/* Toggle trainer_clients.actively_training (web TrainerStatusToggleDialog). */
export function useToggleTrainerActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { rowId: string; next: boolean; clientId: string }) => {
      const { error } = await supabase.from('trainer_clients').update({ actively_training: input.next }).eq('id', input.rowId);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, v) => invalidateDetail(qc, v.clientId),
  });
}
export function useRemoveTrainer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { rowId: string; clientId: string }) => {
      const { error } = await supabase.from('trainer_clients').delete().eq('id', input.rowId);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, v) => invalidateDetail(qc, v.clientId),
  });
}
export function useAssignableTrainers(enabled: boolean) {
  return useQuery({
    queryKey: ['assignable-trainers'],
    enabled,
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('id, first_name, last_name, role')
        .in('role', ['trainer', 'doctor', 'others', 'crm']).order('first_name', { ascending: true }).limit(1000);
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map((p) => ({ id: p.id, name: nameOf(p), role: normalizeRole(p.role) }));
    },
  });
}
export function useAssignTrainer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { clientId: string; trainerId: string }) => {
      const { error } = await supabase.from('trainer_clients').insert({ client_id: input.clientId, trainer_id: input.trainerId, actively_training: true } as any);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, v) => invalidateDetail(qc, v.clientId),
  });
}
/* Status switch (clients.status) + best-effort history log. */
export function useSetClientStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { clientId: string; status: 'active' | 'inactive'; prev: string | null; profileId: string | null }) => {
      const { error } = await supabase.from('clients').update({ status: input.status }).eq('id', input.clientId);
      if (error) throw new Error(error.message);
      try {
        await supabase.from('client_status_history').insert({ client_id: input.clientId, previous_status: input.prev, new_status: input.status, changed_by: input.profileId } as any);
      } catch { /* best-effort */ }
    },
    onSuccess: (_d, v) => invalidateDetail(qc, v.clientId),
  });
}

/* ================= Sessions tab (cycle tree + CRUD), toggles, goals, circle ================= */

export type SessionRow = { id: string; scheduled_at: string; status: string | null; cancelled: boolean | null; session_type: string | null; location: string | null; notes: string | null; complimentary_session: boolean; trainer_id: string | null; trainerName: string };
export type CycleGroup = { n: number; sessions: SessionRow[]; isCurrent: boolean };
export type PackageGroup = { n: number; start: string; end: string | null; total: number; perCycle: number; cycles: CycleGroup[]; countable: number; isCurrent: boolean };

/* Simplified-but-faithful port of useClientSessionsByCycle: packages from client_renewals
   boundaries (P1 total = first renewal's previous_package || clients.session_package),
   countable = completed+cancelled excl complimentary; physio/RLT on 'odds basic' → other.
   NOT ported: reset-window gating + Odds-Generation shared pool. */
export function useSessionsByCycle(clientId: string | null) {
  return useQuery({
    queryKey: ['client-sessions-by-cycle', clientId],
    enabled: !!clientId,
    staleTime: 60_000,
    queryFn: async () => {
      const [{ data: c, error: cErr }, { data: rens, error: rErr }, { data: sess, error: sErr }] = await Promise.all([
        supabase.from('clients').select('sessions_per_cycle, created_at, session_package, subscription_type').eq('id', clientId!).single(),
        supabase.from('client_renewals').select('renewed_at, previous_package, package_sessions, cycle_sessions').eq('client_id', clientId!).order('renewed_at', { ascending: true }),
        supabase.from('training_sessions').select('id, scheduled_at, status, cancelled, session_type, location, notes, complimentary_session, trainer_id, profiles:trainer_id (first_name, last_name)')
          .eq('client_id', clientId!).or('status.eq.completed,status.eq.cancelled,cancelled.eq.true').order('scheduled_at', { ascending: true }).limit(5000),
      ]);
      const err = cErr ?? rErr ?? sErr;
      if (err) throw new Error(err.message);
      const client: any = c;
      const rows: SessionRow[] = ((sess ?? []) as any[]).map((s) => ({ ...s, complimentary_session: !!s.complimentary_session, trainerName: `${s.profiles?.first_name ?? ''} ${s.profiles?.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || '—' }));
      const isBasic = String(client.subscription_type ?? '').toLowerCase() === 'odds basic';
      const other = rows.filter((s) => isBasic && ['physiotherapy', 'red light therapy'].includes(String(s.session_type ?? '').toLowerCase()));
      const pool = rows.filter((s) => !other.includes(s));
      const countable = pool.filter((s) => !s.complimentary_session);
      const comps = pool.filter((s) => s.complimentary_session);
      const renewals = (rens ?? []) as any[];
      const bounds: { start: string; end: string | null; total: number; perCycle: number }[] = [];
      const p1Total = parseInt(String(renewals[0]?.previous_package ?? '')) || parseInt(String(client.session_package ?? '')) || 0;
      const spc = client.sessions_per_cycle || 12;
      bounds.push({ start: client.created_at, end: renewals[0]?.renewed_at ?? null, total: p1Total, perCycle: Math.min(spc, p1Total || spc) });
      renewals.forEach((r, i) => bounds.push({ start: r.renewed_at, end: renewals[i + 1]?.renewed_at ?? null, total: r.package_sessions || 0, perCycle: r.cycle_sessions || spc }));
      const inRange = (d: string, b: { start: string; end: string | null }) => d >= b.start && (!b.end || d < b.end);
      const packages: PackageGroup[] = bounds.map((b, i) => {
        const inPkg = countable.filter((s) => inRange(s.scheduled_at, b));
        const cycles: CycleGroup[] = [];
        for (let j = 0; j < Math.max(1, Math.ceil(inPkg.length / b.perCycle)); j++) {
          const slice = inPkg.slice(j * b.perCycle, (j + 1) * b.perCycle);
          const cStart = slice[0]?.scheduled_at ?? b.start;
          const cEnd = inPkg[(j + 1) * b.perCycle]?.scheduled_at ?? b.end;
          const cComps = comps.filter((s) => inRange(s.scheduled_at, b) && s.scheduled_at >= cStart && (!cEnd || s.scheduled_at < cEnd));
          cycles.push({ n: j + 1, sessions: [...slice, ...cComps].sort((a, z) => a.scheduled_at.localeCompare(z.scheduled_at)), isCurrent: false });
        }
        const isCurrent = i === bounds.length - 1;
        if (isCurrent && cycles.length) cycles[cycles.length - 1].isCurrent = inPkg.length < b.total || b.total === 0;
        return { n: i + 1, start: b.start, end: b.end, total: b.total, perCycle: b.perCycle, cycles: cycles.reverse(), countable: inPkg.length, isCurrent };
      }).filter((p) => p.isCurrent || p.countable > 0).reverse();
      return { packages, other };
    },
  });
}

export function useWorkoutSessions(clientId: string | null) {
  return useQuery({
    queryKey: ['client-workout-sessions', clientId],
    enabled: !!clientId,
    staleTime: 120_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('workout_exercises')
        .select('session_id, session_date, session_name, modality, trainer_id')
        .eq('client_id', clientId!).order('session_date', { ascending: false }).limit(3000);
      if (error) throw new Error(error.message);
      const seen = new Map<string, any>();
      (data ?? []).forEach((r: any) => { if (r.session_id && !seen.has(r.session_id)) seen.set(r.session_id, r); });
      const list = [...seen.values()];
      const tids = [...new Set(list.map((r) => r.trainer_id).filter(Boolean))];
      const names = new Map<string, string>();
      if (tids.length) {
        const { data: ps } = await supabase.from('profiles').select('id, first_name, last_name').in('id', tids);
        (ps ?? []).forEach((p: any) => names.set(p.id, `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim()));
      }
      return list.map((r) => ({ ...r, trainerName: r.trainer_id ? names.get(r.trainer_id) ?? '—' : '—' }));
    },
  });
}

const invalidateSessions = (qc: ReturnType<typeof useQueryClient>, clientId: string) => {
  ['client-sessions-by-cycle', 'client-sessions', 'client'].forEach((k) => qc.invalidateQueries({ queryKey: [k, clientId] }));
};
export const SESSION_STATUSES = ['scheduled', 'completed', 'cancelled', 'parked'] as const;
/* Web SessionDialog "Session Focus" options (verbatim values). */
export const SESSION_FOCUS_OPTIONS = ['strength', 'mobility', 'endurance', 'hiit', 'rehabilitation', 'assessment', 'physiotherapy', 'massage_therapy', 'red_light_therapy', 'cold_bath_therapy'] as const;

/* Additional package (web useCreateAdditionalPackage, full port): additional_packages insert
   → tagged renewal_payment_requests insert → razorpay edge fn; orphan pkg row rolled back on failure. */
export function useCreateAdditionalPackage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { clientId: string; serviceName: 'reset' | 'nutrition_package'; sessions: number | null; durationText: string; nutritionMonths: number | null; amount: number | null; startYmd: string; notes: string; method: 'razorpay' | 'cash' | 'bank_transfer'; profileId: string | null }): Promise<{ paymentUrl: string | null }> => {
      if (!input.profileId) throw new Error('Not authenticated');
      const isNutrition = input.serviceName === 'nutrition_package';
      if (isNutrition && !(input.nutritionMonths && input.nutritionMonths > 0)) throw new Error('Enter the nutrition duration in months.');
      if (!isNutrition && (!(input.sessions && input.sessions > 0) || !input.durationText.trim())) throw new Error('Sessions and duration are required.');
      if (input.method === 'razorpay' && !(input.amount && input.amount > 0)) throw new Error('Amount is required for a Razorpay link.');
      const startDate = /^\d{4}-\d{2}-\d{2}$/.test(input.startYmd) ? input.startYmd : new Date().toISOString().slice(0, 10);
      const serviceName = input.serviceName;
      const durationText = isNutrition ? `${input.nutritionMonths} month(s)` : input.durationText.trim();
      const sessionsToSave = isNutrition ? null : input.sessions;
      const { data: pkg, error: pkgErr } = await supabase.from('additional_packages').insert({
        client_id: input.clientId, service_name: serviceName, package_sessions: sessionsToSave,
        package_duration: durationText, package_amount: input.amount, payment_date: null,
        start_date: startDate, notes: input.notes.trim() || null, created_by: input.profileId,
        nutrition_duration: isNutrition ? input.nutritionMonths : null,
      } as any).select().single();
      if (pkgErr) throw new Error(pkgErr.message);
      try {
        const notes = JSON.stringify({ kind: 'additional_package', additional_package_id: (pkg as any).id, service_name: serviceName });
        const { data: reqRow, error: reqErr } = await supabase.from('renewal_payment_requests').insert({
          client_id: input.clientId, new_subscription_type: serviceName, new_sessions_per_cycle: sessionsToSave ?? 0,
          new_package_amount: input.amount ?? 0, new_cycle_type: 'Custom', package_duration: parseInt(durationText) || null,
          session_package: sessionsToSave, cycle_start_date: startDate, payment_method: input.method,
          payment_status: 'awaiting_payment', admin_decision: 'approved', admin_id: input.profileId,
          requested_by: input.profileId, request_notes: notes,
        } as any).select('id').single();
        if (reqErr) throw new Error(reqErr.message);
        let paymentUrl: string | null = null;
        if (input.method === 'razorpay') {
          const { data: res, error: fnErr } = await supabase.functions.invoke('create-additional-package-razorpay-link', { body: { request_id: (reqRow as any).id } });
          const errMsg = fnErr?.message || (res as any)?.error;
          if (errMsg) {
            await supabase.from('renewal_payment_requests').update({ payment_status: 'failed' }).eq('id', (reqRow as any).id);
            throw new Error(errMsg);
          }
          paymentUrl = (res as any)?.url ?? null;
        }
        return { paymentUrl };
      } catch (e) {
        try { await supabase.from('additional_packages').delete().eq('id', (pkg as any).id); } catch { /* ignore */ }
        throw e;
      }
    },
    onSuccess: (_d, v) => {
      ['client-sessions-by-cycle', 'client'].forEach((k) => qc.invalidateQueries({ queryKey: [k, v.clientId] }));
      qc.invalidateQueries({ queryKey: ['admin-renewal-pay-requests'] });
    },
  });
}
/* Create/update training_sessions (web useSessionOperations core; attachments/AI/unique not ported).
   status 'cancelled' also sets cancelled=true; attendance_marked always true (web parity). */
export function useSaveSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id?: string; clientId: string; scheduledAtIso: string; trainerId: string; sessionType: string; status: string; location: string; notes: string; complimentary: boolean }) => {
      const payload: any = {
        scheduled_at: input.scheduledAtIso, status: input.status, location: input.location.trim() || null,
        notes: input.notes.trim() || null, trainer_id: input.trainerId, client_id: input.clientId,
        session_type: input.sessionType.trim() || 'training', cancelled: input.status === 'cancelled',
        attendance_marked: true, complimentary_session: input.complimentary,
      };
      const { error } = input.id
        ? await supabase.from('training_sessions').update(payload).eq('id', input.id)
        : await supabase.from('training_sessions').insert(payload);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, v) => invalidateSessions(qc, v.clientId),
  });
}
export function useDeleteSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; clientId: string }) => {
      const { error } = await supabase.from('training_sessions').delete().eq('id', input.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, v) => invalidateSessions(qc, v.clientId),
  });
}
export function useToggleComplimentary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; next: boolean; clientId: string }) => {
      const { error } = await supabase.from('training_sessions').update({ complimentary_session: input.next }).eq('id', input.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, v) => invalidateSessions(qc, v.clientId),
  });
}
export function useSetMonthly() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { clientId: string; next: boolean }) => {
      const { error } = await supabase.from('clients').update({ is_monthly_subscription: input.next }).eq('id', input.clientId);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['client', v.clientId] }),
  });
}
export function usePauseJourney() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { clientId: string; startYmd: string; endYmd: string; reason: string; profileId: string | null }) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startYmd) || !/^\d{4}-\d{2}-\d{2}$/.test(input.endYmd)) throw new Error('Dates must be YYYY-MM-DD.');
      const { error } = await supabase.from('client_pause_history').insert({
        client_id: input.clientId, pause_start: input.startYmd, pause_end: input.endYmd,
        reason_admin: input.reason.trim() || null, is_active: true, paused_by: input.profileId,
      } as any);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['client-pause', v.clientId] }),
  });
}
export function useEndPause() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { pauseId: string; clientId: string }) => {
      const { error } = await supabase.from('client_pause_history').update({ is_active: false }).eq('id', input.pauseId);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['client-pause', v.clientId] }),
  });
}
export function useWeeklyGoals(clientId: string | null) {
  return useQuery({
    queryKey: ['client-weekly-goals', clientId],
    enabled: !!clientId,
    staleTime: 120_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('daily_goals').select('*').eq('client_id', clientId!).order('week_start_date', { ascending: false }).limit(4);
      if (error) throw new Error(error.message);
      return (data ?? []) as any[];
    },
  });
}
/* Odds Generation circle: toggle admin flag + manage member ids on the clients row. */
export function useGenerationMembers(memberIds: string[]) {
  return useQuery({
    queryKey: ['generation-members', memberIds],
    enabled: memberIds.length > 0,
    staleTime: 120_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('id, first_name, last_name').in('id', memberIds);
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map((c) => ({ id: c.id, name: `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || '—' }));
    },
  });
}
export function useSearchClients(term: string) {
  return useQuery({
    queryKey: ['client-search-mini', term],
    enabled: term.trim().length >= 2,
    staleTime: 30_000,
    queryFn: async () => {
      const t = term.trim();
      const { data, error } = await supabase.from('clients').select('id, first_name, last_name')
        .or(`first_name.ilike.%${t}%,last_name.ilike.%${t}%`).eq('status', 'active').limit(10);
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map((c) => ({ id: c.id, name: `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || '—' }));
    },
  });
}
export function useUpdateGeneration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { clientId: string; generationAdmin: boolean; members: string[] }) => {
      const patch: any = { generation_admin: input.generationAdmin, generation_members: input.members };
      if (input.generationAdmin) patch.generation_enrollment_date = new Date().toISOString();
      const { error } = await supabase.from('clients').update(patch).eq('id', input.clientId);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, v) => { qc.invalidateQueries({ queryKey: ['client', v.clientId] }); qc.invalidateQueries({ queryKey: ['generation-member-admin-map'] }); },
  });
}
