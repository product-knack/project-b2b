import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { useAuth } from '../auth';

/* ============================================================================
   Therapist workspace — web /therapist parity.
   Therapists are stored exactly like trainers: assignments in trainer_clients
   (trainer_id = therapist id), sessions in training_sessions with
   session_type='therapy', roster rows in session_schedule. RLS already scopes
   every read/write to the signed-in therapist (web build) — no workarounds.
   ========================================================================== */

const fullName = (p: any) => `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.replace(/\s+/g, ' ').trim();

/* Therapy sub-modalities (web spec v2 §1.1). The enum value goes to the RPC;
   the DB stores the LABEL in training_sessions.session_name. Labels on old
   rows are frozen text by design — never backfill or "correct" them. */
export const THERAPY_MODALITIES: { value: string; label: string }[] = [
  { value: 'massage_therapy', label: 'Massage Therapy' },
  { value: 'lymphatic_drainage', label: 'Lymphatic Drainage' },
];
export const therapyModalityLabel = (value: string | null | undefined): string =>
  THERAPY_MODALITIES.find((m) => m.value === value)?.label ?? '';

/* Roster fresh start (requested 31 Aug 2026): unlogged roster rows dated
   BEFORE 1 Sept 2026 IST are hidden from Today's Roster — the August backlog
   of never-logged sessions stays in the DB but out of the view. From 1 Sept
   the cutoff is in the past, so everything shows normally again. */
export const ROSTER_FRESH_START_MS = Date.parse('2026-08-31T18:30:00Z'); // 2026-09-01 00:00 IST
/** Same instant as an ISO string, for PostgREST range filters. */
export const ROSTER_FRESH_START_ISO = '2026-08-31T18:30:00Z';

/* IST day window as UTC ISO bounds (web convention). */
const istDayWindow = (d: Date = new Date()) => {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
  return {
    ymd,
    startUtc: new Date(`${ymd}T00:00:00+05:30`).toISOString(),
    endUtc: new Date(new Date(`${ymd}T00:00:00+05:30`).getTime() + 86_400_000).toISOString(),
  };
};

/* Web display convention: dd-MMM-yyyy h:mm a; roster rows show only h:mm a. */
export const fmtTherapyAt = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  const day = d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');
  return `${day} ${fmtTherapyTime(iso)}`;
};
export const fmtTherapyTime = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase() : '—';

export function useTherapistId() {
  const { session } = useAuth();
  return session?.user?.id ?? null;
}

/* ---------- Assigned clients (trainer_clients, actively_training) ---------- */
export type TherapistClient = {
  clientId: string;
  name: string;
  subscription: string | null;
  status: string | null;
  sessionsTotal: number | null; // sum of client_packages.sessions_total
  sessionsUsed: number | null;
};
export function useTherapistClients(therapistId: string | null) {
  return useQuery({
    queryKey: ['therapist-clients', therapistId],
    enabled: !!therapistId,
    staleTime: 60_000,
    queryFn: async (): Promise<TherapistClient[]> => {
      const { data, error } = await supabase
        .from('trainer_clients')
        .select('client_id, client:clients(id, first_name, last_name, status, subscription_type, client_packages(sessions_total, sessions_used))')
        .eq('trainer_id', therapistId)
        .eq('actively_training', true);
      if (error) throw new Error(error.message);
      const emb = (v: any) => (Array.isArray(v) ? v[0] : v);
      return (data ?? [])
        .map((r: any) => emb(r.client))
        .filter((c: any) => c?.id)
        .map((c: any) => {
          const pkgs = Array.isArray(c.client_packages) ? c.client_packages : [];
          const tot = pkgs.reduce((n: number, p: any) => n + (p?.sessions_total ?? 0), 0);
          const used = pkgs.reduce((n: number, p: any) => n + (p?.sessions_used ?? 0), 0);
          return {
            clientId: c.id, name: fullName(c) || 'Client',
            subscription: c.subscription_type ?? null, status: c.status ?? null,
            sessionsTotal: pkgs.length ? tot : null, sessionsUsed: pkgs.length ? used : null,
          };
        })
        .sort((a: TherapistClient, b: TherapistClient) => a.name.localeCompare(b.name));
    },
  });
}

/* ---------- Today's roster (IST) ---------- */
export type TherapistRosterRow = {
  id: string; scheduledAt: string; modality: string | null; sessionType: string | null;
  status: string | null; notes: string | null; clientId: string | null; clientName: string;
};
export function useTherapistTodayRoster(therapistId: string | null) {
  return useQuery({
    queryKey: ['therapist-roster-today', therapistId],
    enabled: !!therapistId,
    staleTime: 30_000,
    refetchInterval: 120_000,
    queryFn: async (): Promise<TherapistRosterRow[]> => {
      const w = istDayWindow();
      const { data, error } = await supabase
        .from('session_schedule')
        .select('id, scheduled_datetime, modality, session_type, status, notes, workout_session_id, client_id, client:client_id(id, first_name, last_name)')
        .eq('trainer_id', therapistId)
        .gte('scheduled_datetime', w.startUtc)
        .lt('scheduled_datetime', w.endUtc)
        .order('scheduled_datetime', { ascending: true });
      if (error) throw new Error(error.message);
      const emb = (v: any) => (Array.isArray(v) ? v[0] : v);
      return (data ?? [])
        .filter((r: any) => r.workout_session_id || new Date(r.scheduled_datetime).getTime() >= ROSTER_FRESH_START_MS)
        .map((r: any) => ({
        id: r.id, scheduledAt: r.scheduled_datetime, modality: r.modality ?? null,
        sessionType: r.session_type ?? null,
        // The roster status column can't say 'completed' (CHECK constraint) —
        // logged state IS the workout_session_id link, same as everywhere else.
        status: r.workout_session_id ? 'completed' : (r.status ?? null),
        notes: r.notes ?? null,
        clientId: r.client_id ?? null, clientName: fullName(emb(r.client)) || 'Client',
      }));
    },
  });
}

/* ---------- Therapy sessions of one client ---------- */
export type TherapySessionRow = {
  id: string; scheduledAt: string | null; durationMinutes: number | null;
  status: string | null; note: string | null; therapistName: string;
  sessionName: string | null; // sub-modality label, e.g. "Massage Therapy" (null on legacy rows)
};
export function useTherapySessions(clientId: string | null) {
  return useQuery({
    queryKey: ['therapy-sessions', clientId],
    enabled: !!clientId,
    staleTime: 30_000,
    queryFn: async (): Promise<TherapySessionRow[]> => {
      const { data, error } = await supabase
        .from('training_sessions')
        .select('id, scheduled_at, duration_minutes, status, session_name, notes, trainer:trainer_id(first_name, last_name)')
        .eq('client_id', clientId)
        .eq('session_type', 'therapy')
        .order('scheduled_at', { ascending: false });
      if (error) throw new Error(error.message);
      const emb = (v: any) => (Array.isArray(v) ? v[0] : v);
      return (data ?? []).map((r: any) => ({
        id: r.id, scheduledAt: r.scheduled_at ?? null, durationMinutes: r.duration_minutes ?? null,
        // therapist_notes was dropped — the session note now lives in notes.
        status: r.status ?? null, note: r.notes ?? null,
        therapistName: fullName(emb(r.trainer)) || 'Therapist',
        sessionName: r.session_name ?? null,
      }));
    },
  });
}

/* ---------- Save a therapy session (definer RPC) ----------
   No date/time picker: always stamped now(). The therapist_log_session RPC
   does the whole save server-side: inserts the training_sessions row AND
   marks today's scheduled (crew) session_schedule row completed when one
   exists — so My Crew shows LOGGED — else inserts a completed roster row.
   (The old client-side session_schedule mirror insert silently failed under
   RLS, leaving roster holes.) */
export function useAddTherapySession() {
  const qc = useQueryClient();
  const { session } = useAuth();
  const meId = session?.user?.id ?? null;
  return useMutation({
    mutationFn: async (input: { clientId: string; durationMinutes: number; note: string; therapyType: string }) => {
      if (!meId) throw new Error('Not signed in');
      // Validation order per web spec §2.1: therapy type → note → duration.
      if (!THERAPY_MODALITIES.some((m) => m.value === input.therapyType)) throw new Error('Pick a therapy type');
      const note = input.note.trim();
      if (!note) throw new Error('Session note is required');
      if (!(input.durationMinutes > 0)) throw new Error('Duration must be greater than 0');
      const { data, error } = await supabase.rpc('therapist_log_session', {
        p_client: input.clientId,
        p_duration: input.durationMinutes,
        p_note: note,
        p_therapy_type: input.therapyType,
      });
      if (error) throw new Error(error.message);
      // roster_error non-null = session saved, roster step failed — the RPC has
      // already written the ops_alerts row, so we do NOT retry or double-report.
      return data as { session_id: string; schedule_id: string | null; roster_error: string | null } | null;
    },
    onSuccess: (d, v) => {
      qc.invalidateQueries({ queryKey: ['therapy-sessions', v.clientId] });
      qc.invalidateQueries({ queryKey: ['therapist-roster-today'] });
      qc.invalidateQueries({ queryKey: ['doctor-today-roster'] }); // the shared Today's Roster card (16 Sep 2026)
      // My Crew surfaces re-read the linked roster row + outcome instantly.
      qc.invalidateQueries({ queryKey: ['mgr-plan-sched'] });
      qc.invalidateQueries({ queryKey: ['mgr-plan-outcome-v5'] });
      // Rehab AI analysis (fire-and-forget, web parity): reads the session's
      // notes and writes training_sessions.rehab_ai_analysis.
      const sid = (d as any)?.session_id;
      if (sid) {
        try {
          void supabase.functions.invoke('generate-rehab-ai-analysis', { body: { sessionId: sid } }).then(() => {}, () => {});
        } catch { /* never block the save */ }
      }
    },
  });
}
