import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { C } from '../theme';

/* ============ CRM Roster Management — mirrors useCRMRosterManagement +
   BulkSessionCreator (web): month sessions, bulk "Create Roster" with the
   web's exact conflict rules, reschedule, cancel, delete-future. ============ */

export const MODALITIES = ['Strength', 'Yoga', 'Boxing', 'HIIT', 'Cardio', 'Physiotherapy', 'Pilates'] as const;
export function modalityColor(m: string | null) {
  const s = (m ?? '').toLowerCase();
  if (s.includes('boxing')) return C.red;
  if (s.includes('yoga')) return C.purple;
  if (s.includes('strength')) return C.blue;
  if (s.includes('hiit')) return C.orange;
  if (s.includes('cardio')) return C.green;
  if (s.includes('physio')) return '#4FD1C5';
  if (s.includes('pilates')) return C.gold;
  return C.muted2;
}

const fullName = (p: any) => `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || '—';

export type RosterSession = {
  id: string; clientId: string; clientName: string; trainerId: string | null; trainerName: string;
  when: string; modality: string | null; status: string; notes: string | null;
  cancelled: boolean; completed: boolean; hasRescheduleReq: boolean;
};

/* ---------- Month sessions (book-scoped, like the web with assignedOnly) ---------- */
export function useMonthRoster(crmId: string | null, monthOffset: number, trainerId: string | null) {
  return useQuery({
    queryKey: ['crm-month-roster', crmId, monthOffset, trainerId],
    enabled: !!crmId,
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async (): Promise<{ sessions: RosterSession[]; monthLabel: string }> => {
      const now = new Date();
      const base = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
      const monthStart = new Date(base.getFullYear(), base.getMonth(), 1);
      const monthEnd = new Date(base.getFullYear(), base.getMonth() + 1, 0, 23, 59, 59);
      const monthLabel = base.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', month: 'long', year: 'numeric' });

      const { data: book, error: bErr } = await supabase
        .from('trainer_clients').select('client_id').eq('trainer_id', crmId).eq('actively_training', true);
      if (bErr) throw new Error(bErr.message);
      const ids = [...new Set((book ?? []).map((r: any) => r.client_id))];
      if (!ids.length) return { sessions: [], monthLabel };

      let q = supabase
        .from('session_schedule')
        .select('*, clients:client_id!inner(id, first_name, last_name, status), profiles:trainer_id(id, first_name, last_name)')
        .in('client_id', ids)
        .eq('clients.status', 'active')
        .gte('scheduled_datetime', monthStart.toISOString())
        .lte('scheduled_datetime', monthEnd.toISOString())
        .order('scheduled_datetime', { ascending: true })
        .limit(2000);
      if (trainerId) q = q.eq('trainer_id', trainerId);
      const { data, error } = await q;
      if (error) throw new Error(error.message);

      return {
        monthLabel,
        sessions: ((data ?? []) as any[]).map((r) => ({
          id: r.id, clientId: r.client_id, clientName: fullName(r.clients),
          trainerId: r.trainer_id ?? null, trainerName: r.profiles ? fullName(r.profiles) : 'Unknown Trainer',
          when: r.scheduled_datetime, modality: r.modality ?? null, status: r.status ?? 'scheduled',
          notes: r.notes ?? null, cancelled: r.status === 'cancelled',
          // A session counts as done once it's been logged as a workout.
          completed: r.status !== 'cancelled' && r.workout_session_id != null,
          hasRescheduleReq: !!r.reschedule_request && !r.reschedule_status,
        })),
      };
    },
  });
}

/* ---------- People (book clients + trainers + doctors) ---------- */
export function useRosterPeople(crmId: string | null) {
  return useQuery({
    queryKey: ['crm-roster-people', crmId],
    enabled: !!crmId,
    staleTime: 300_000,
    queryFn: async () => {
      const { data: book } = await supabase
        .from('trainer_clients').select('client_id').eq('trainer_id', crmId).eq('actively_training', true);
      const ids = [...new Set((book ?? []).map((r: any) => r.client_id))];
      const [clientsR, trainersR, doctorsR] = await Promise.all([
        ids.length
          ? supabase.from('clients').select('id, first_name, last_name').in('id', ids).eq('status', 'active').order('first_name')
          : Promise.resolve({ data: [] as any[] }),
        supabase.from('profiles').select('id, first_name, last_name').eq('role', 'trainer').order('first_name'),
        supabase.from('profiles').select('id, first_name, last_name').eq('role', 'doctor').order('first_name'),
      ]);
      const mk = (rows: any[]) => (rows ?? []).map((p) => ({ id: p.id, name: fullName(p) }));
      return { clients: mk(clientsR.data as any[]), trainers: mk(trainersR.data as any[]), doctors: mk(doctorsR.data as any[]) };
    },
  });
}

/* ---------- Bulk create ("Create Roster") — the web's exact rules.
   schedules: one entry per weekday, each with its own time and optional
   trainer/modality override (mirrors the web's daySchedules). ---------- */
export type RosterConflict = { kind: 'trainer' | 'trainer_forced' | 'client' | 'leave'; when: string; detail: string };
export type DaySchedule = { day: number; time: string; trainerId?: string | null; modality?: string | null };
export type BulkInput = {
  clientId: string; trainerId: string; modality: string; weeks: number;
  schedules: DaySchedule[];
  startDate?: string | null; // 'YYYY-MM-DD' — replicate mode; default today
  forceProceed?: boolean;
};
export function useBulkCreateRoster() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: BulkInput): Promise<{ created: number; conflicts: RosterConflict[] }> => {
      if (!input.schedules.length) throw new Error('Pick at least one day of the week');
      const start = input.startDate ? new Date(input.startDate + 'T00:00:00') : new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date(start.getTime() + (input.weeks * 7 - 1) * 864e5);
      const byDow = new Map<number, DaySchedule>();
      input.schedules.forEach((s) => byDow.set(s.day, s));

      // Trainer leave windows — for every trainer involved (web: skip, kind 'leave').
      const trainerIds = [...new Set([input.trainerId, ...input.schedules.map((s) => s.trainerId).filter(Boolean) as string[]])];
      const todayStr = new Date().toISOString().slice(0, 10);
      const { data: leaves } = await supabase
        .from('leave_request')
        .select('trainer_id, start_date, start_time, end_date, end_time')
        .in('trainer_id', trainerIds)
        .gte('end_date', todayStr);
      const leaveWindows = ((leaves ?? []) as any[]).map((l) => ({
        trainerId: l.trainer_id,
        start: new Date(`${l.start_date}T${l.start_time || '00:00:00'}`),
        end: new Date(`${l.end_date}T${l.end_time || '23:59:59'}`),
      }));

      // Candidate slots: every matching weekday from start through end, at that day's time.
      const candidates: { at: Date; sched: DaySchedule }[] = [];
      for (let d = new Date(start); d <= end; d = new Date(d.getTime() + 864e5)) {
        const sched = byDow.get(d.getDay());
        if (!sched) continue;
        const [hh, mm] = sched.time.split(':').map(Number);
        const at = new Date(d); at.setHours(hh, mm, 0, 0);
        if (at < new Date()) continue; // skip already-past slots
        candidates.push({ at, sched });
      }

      const conflicts: RosterConflict[] = [];
      const rows: { trainer_id: string; client_id: string; scheduled_datetime: string; modality: string; status: string }[] = [];
      const seen = new Set<string>();
      const fmt = (d: Date) => d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: '2-digit', month: 'short' }) + ' · ' + d.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true });

      for (const { at, sched } of candidates) {
        const slotTrainer = sched.trainerId || input.trainerId;
        const slotModality = sched.modality || input.modality;
        // Leave window (for this slot's trainer) → always skip.
        if (leaveWindows.some((w) => w.trainerId === slotTrainer && at >= w.start && at <= w.end)) {
          conflicts.push({ kind: 'leave', when: at.toISOString(), detail: `${fmt(at)} — trainer on leave` });
          continue;
        }
        const winStart = new Date(at.getTime() - 60 * 60000).toISOString();
        const winEnd = new Date(at.getTime() + 60 * 60000).toISOString();
        // Trainer clash ±60min (skippable with force).
        const { data: tClash } = await supabase
          .from('session_schedule').select('id')
          .eq('trainer_id', slotTrainer).neq('status', 'cancelled')
          .gte('scheduled_datetime', winStart).lt('scheduled_datetime', winEnd).limit(1);
        if (tClash?.length) {
          if (!input.forceProceed) { conflicts.push({ kind: 'trainer', when: at.toISOString(), detail: `${fmt(at)} — trainer already booked` }); continue; }
          conflicts.push({ kind: 'trainer_forced', when: at.toISOString(), detail: `${fmt(at)} — double-booked trainer (forced)` });
        }
        // Client clash ±60min → always hard-skip.
        const { data: cClash } = await supabase
          .from('session_schedule').select('id')
          .eq('client_id', input.clientId).neq('status', 'cancelled')
          .gte('scheduled_datetime', winStart).lt('scheduled_datetime', winEnd).limit(1);
        if (cClash?.length) { conflicts.push({ kind: 'client', when: at.toISOString(), detail: `${fmt(at)} — client already has a session` }); continue; }

        const key = `${input.clientId}|${at.toISOString()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push({ trainer_id: slotTrainer, client_id: input.clientId, scheduled_datetime: at.toISOString(), modality: slotModality, status: 'scheduled' });
      }

      let created = 0;
      if (rows.length) {
        const { data: ins, error } = await supabase.from('session_schedule').insert(rows).select();
        if (error) {
          // Unique-violation fallback: retry per-row like the web.
          if ((error as any).code === '23505') {
            for (const row of rows) {
              const { error: e2 } = await supabase.from('session_schedule').insert(row);
              if (e2) conflicts.push({ kind: 'client', when: row.scheduled_datetime, detail: 'Already scheduled at this time' });
              else created++;
            }
          } else throw new Error(error.message);
        } else created = (ins ?? []).length;
      }
      return { created, conflicts };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['crm-month-roster'] });
      qc.invalidateQueries({ queryKey: ['crm-client-roster'] });
    },
  });
}

/* ---------- Replicate: infer the client's previous roster pattern.
   Looks at the last 28 days of non-cancelled sessions and derives the weekly
   slots (weekday + time), each with its usual trainer + modality. ---------- */
export type InferredSlot = { day: number; time: string; trainerId: string | null; trainerName: string; modality: string | null; count: number };
export function useInferRoster(clientId: string | null) {
  return useQuery({
    queryKey: ['crm-infer-roster', clientId],
    enabled: !!clientId,
    staleTime: 60_000,
    queryFn: async (): Promise<InferredSlot[]> => {
      const since = new Date(Date.now() - 28 * 864e5).toISOString();
      const { data, error } = await supabase
        .from('session_schedule')
        .select('scheduled_datetime, trainer_id, modality, status, profiles:trainer_id(first_name, last_name)')
        .eq('client_id', clientId)
        .or('status.is.null,status.not.eq.cancelled')
        .gte('scheduled_datetime', since)
        .order('scheduled_datetime', { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message);
      // Group by weekday+time (IST); pick the most common trainer/modality per slot.
      const slots = new Map<string, { day: number; time: string; picks: Map<string, { trainerId: string | null; trainerName: string; modality: string | null; n: number }> }>();
      ((data ?? []) as any[]).forEach((r) => {
        const d = new Date(r.scheduled_datetime);
        const ist = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
        const day = ist.getDay();
        const time = `${String(ist.getHours()).padStart(2, '0')}:${String(ist.getMinutes()).padStart(2, '0')}`;
        const key = `${day}|${time}`;
        if (!slots.has(key)) slots.set(key, { day, time, picks: new Map() });
        const pk = `${r.trainer_id ?? ''}|${r.modality ?? ''}`;
        const slot = slots.get(key)!;
        const cur = slot.picks.get(pk) ?? { trainerId: r.trainer_id ?? null, trainerName: r.profiles ? fullName(r.profiles) : '—', modality: r.modality ?? null, n: 0 };
        cur.n++; slot.picks.set(pk, cur);
      });
      return [...slots.values()]
        .map((s) => {
          const best = [...s.picks.values()].sort((a, b) => b.n - a.n)[0];
          const count = [...s.picks.values()].reduce((a, b) => a + b.n, 0);
          return { day: s.day, time: s.time, trainerId: best.trainerId, trainerName: best.trainerName, modality: best.modality, count };
        })
        .filter((s) => s.count >= 2) // a real weekly pattern, not a one-off
        .sort((a, b) => a.day - b.day || a.time.localeCompare(b.time));
    },
  });
}

/* ---------- Reschedule (web RescheduleSessionDialog contract) ---------- */
export function useRescheduleRosterSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; clientId: string; trainerId: string | null; newDateTime: string; force?: boolean }) => {
      const at = new Date(input.newDateTime);
      const winStart = new Date(at.getTime() - 60 * 60000).toISOString();
      const winEnd = new Date(at.getTime() + 60 * 60000).toISOString();
      // Client double-booking → hard block.
      const { data: cClash } = await supabase
        .from('session_schedule').select('id')
        .eq('client_id', input.clientId).neq('status', 'cancelled').neq('id', input.id)
        .gte('scheduled_datetime', winStart).lt('scheduled_datetime', winEnd).limit(1);
      if (cClash?.length) throw new Error('The client already has a session within an hour of that slot.');
      // Trainer overlap → soft (needs force).
      if (input.trainerId && !input.force) {
        const { data: tClash } = await supabase
          .from('session_schedule').select('id')
          .eq('trainer_id', input.trainerId).neq('status', 'cancelled').neq('id', input.id)
          .gte('scheduled_datetime', winStart).lt('scheduled_datetime', winEnd).limit(1);
        if (tClash?.length) throw new Error('TRAINER_OVERLAP');
      }
      const { error } = await supabase.from('session_schedule').update({
        scheduled_datetime: at.toISOString(),
        reschedule_request: null,
        reschedule_requested_at: null,
        updated_at: new Date().toISOString(),
      }).eq('id', input.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['crm-month-roster'] }),
  });
}

/* ---------- Cancel one session ---------- */
export function useCancelRosterSession() {
  const qc = useQueryClient();
  return useMutation({
    // canceled_by carries WHO asked for the cancellation — the DB CHECK
    // constraint only allows 'Client' or 'Trainer' (same as the web dialog).
    mutationFn: async (input: { id: string; canceledBy: 'Client' | 'Trainer'; remark: string }) => {
      const { error } = await supabase.from('session_schedule').update({
        status: 'cancelled',
        cancellation_remark: input.remark.trim() || null,
        canceled_by: input.canceledBy,
        updated_at: new Date().toISOString(),
      }).eq('id', input.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['crm-month-roster'] }),
  });
}

/* ---------- Delete all future sessions for a client (hard delete, like web) ---------- */
export function useDeleteFutureSessions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { clientId: string }): Promise<number> => {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const { data, error } = await supabase
        .from('session_schedule').delete()
        .eq('client_id', input.clientId)
        .gte('scheduled_datetime', today.toISOString())
        .select();
      if (error) throw new Error(error.message);
      return (data ?? []).length;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['crm-month-roster'] }),
  });
}
