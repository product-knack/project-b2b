import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';

/* ---------- IST helpers (mirror the web app's istDateTime) ---------- */
const IST_OFFSET_MIN = 330;
export const istDate = (d: Date = new Date()) =>
  new Date(d.getTime() + IST_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
const istDayStartUtcISO = (d: Date = new Date()) =>
  new Date(new Date(`${istDate(d)}T00:00:00.000Z`).getTime() - IST_OFFSET_MIN * 60_000).toISOString();
const istDayEndUtcISO = (d: Date = new Date()) =>
  new Date(new Date(`${istDate(d)}T23:59:59.999Z`).getTime() - IST_OFFSET_MIN * 60_000).toISOString();
const istMonthBounds = (d: Date = new Date()) => {
  const ymd = istDate(d); // YYYY-MM-DD
  const [y, m] = ymd.split('-').map(Number);
  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const end = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return {
    startUtc: new Date(new Date(`${start}T00:00:00.000Z`).getTime() - IST_OFFSET_MIN * 60_000).toISOString(),
    endUtc: new Date(new Date(`${end}T23:59:59.999Z`).getTime() - IST_OFFSET_MIN * 60_000).toISOString(),
    start,
    end,
  };
};

/* ---------- Leaderboard period helpers (calendar months, IST) ----------
   offset 0 = current month, 1 = last month, … Returns YYYY-MM-DD bounds + a short label. */
export type LbBounds = { start: string; end: string };
const monthDate = (offset: number) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - offset); return d; };
export const lbMonthBounds = (offset = 0): LbBounds => { const { start, end } = istMonthBounds(monthDate(offset)); return { start, end }; };
export const lbMonthLabel = (offset = 0): string => new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', month: 'short' }).format(monthDate(offset));

/* Display a UTC ISO timestamp in IST time / date parts. */
export const istTimeParts = (iso: string) => {
  const parts = new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true });
  // Device ICU (Android 14/15, iOS 17/18) separates am/pm with U+202F, not an ASCII space.
  const [t, ap] = parts.split(/\s+/);
  return { time: t, ampm: (ap ?? '').toUpperCase() };
};
export const istDayLabel = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' }).toUpperCase();

/* ---------- Types ---------- */
export type RosterRow = {
  id: string;
  scheduled_datetime: string;
  session_type: string | null;
  modality: string | null;
  status: string | null;
  client_id: string | null;
  client_name: string;
  workout_session_id: string | null;
  reschedule_request: string | null;
  reschedule_status: string | null;
  reschedule_proposed_date: string | null;
  reschedule_proposed_time: string | null;
  missed_remarks: any[] | null;
  paid_cancellation: boolean;
  admin_approval: string | null;
  is_open_past: boolean;
  /** Client ack on the logged training_sessions row: true/false once logged, null when not logged. */
  acknowledged: boolean | null;
  /** clients.brb_location captured → the distance/map icon can be offered. */
  has_home_location: boolean;
  home_lat: number | null;
  home_lng: number | null;
  clients: { first_name: string | null; last_name: string | null } | null;
};
export type TrainerStats = {
  todaySessionsCount: number;
  activeClientsCount: number;
  monthSessionsCount: number;
  certificationsCount: number;
};
export type LeaderboardEntry = {
  trainerId: string;
  trainerName: string;
  sessionCount: number;
  qhpCount: number;
  referralCount: number;
  weightedScore: number;
  rank: number;
};
export type MgrMonthFilter = 'overall' | 'month1' | 'month2' | 'month3';
export type ManagerEntry = {
  managerId: string;
  managerName: string;
  teamName: string;
  teamSize: number;
  totalSessions: number; // web parity: sessions + QHPs combined (what the web card shows as "Sess")
  rawSessions: number; // training sessions only
  qhpCount: number;
  referralsCount: number;
  members: ManagerTeamMember[];
  teamStart: string;
  teamEnd: string | null;
  expectedSessions: number | null; // manager's profiles.expected_sessions — run-rate target
  rank: number;
};
export type ManagerLeaderboard = {
  entries: ManagerEntry[];
  periodStart: string;
  periodEnd: string | null;
  periodLabel: string;
  monthLabels: [string, string, string];
};

/* ---------- Hooks ---------- */

// Today's roster — composed exactly like the web TodayRosterCard:
//   [ Open Past (overdue, no action) ] + [ Pending Reschedule Carry-Over ] + [ Today's day list ]
const ROSTER_SELECT =
  'id, scheduled_datetime, session_type, modality, status, client_id, workout_session_id, reschedule_request, reschedule_requested_at, reschedule_status, reschedule_proposed_date, reschedule_proposed_time, missed_remarks, paid_cancellation, admin_approval, clients:client_id(first_name, last_name, status, brb_location)';
const OPEN_PAST_CUTOFF_ISO = '2026-06-12T00:00:00+05:30';
const notInactiveClient = (s: any) => !['inactive', 'discontinued'].includes((s.clients?.status ?? '').toLowerCase());
const mapRosterRow = (s: any, isOpenPast: boolean): RosterRow => ({
  id: s.id,
  scheduled_datetime: s.scheduled_datetime,
  session_type: s.session_type ?? null,
  modality: s.modality ?? null,
  status: s.status ?? null,
  client_id: s.client_id ?? null,
  client_name: `${s.clients?.first_name ?? ''} ${s.clients?.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || 'Client',
  workout_session_id: s.workout_session_id ?? null,
  reschedule_request: s.reschedule_request ?? null,
  reschedule_status: s.reschedule_status ?? null,
  reschedule_proposed_date: s.reschedule_proposed_date ?? null,
  reschedule_proposed_time: s.reschedule_proposed_time ?? null,
  missed_remarks: Array.isArray(s.missed_remarks) ? s.missed_remarks : null,
  paid_cancellation: s.paid_cancellation === true,
  admin_approval: s.admin_approval ?? null,
  is_open_past: isOpenPast,
  acknowledged: null,
  has_home_location: s.clients?.brb_location != null,
  home_lat: isFinite(Number(s.clients?.brb_location?.lat)) ? Number(s.clients.brb_location.lat) : null,
  home_lng: isFinite(Number(s.clients?.brb_location?.lng)) ? Number(s.clients.brb_location.lng) : null,
  clients: s.clients ?? null,
});

// dayOffset lets the dashboard browse other days (±N days from today, IST).
// Overdue carry-overs (open past + pending reschedules) only join the list for
// today's view — they are operational "needs attention" items, not history.
export function useTodayRoster(trainerId: string, dayOffset = 0) {
  return useQuery({
    // NOTE: no date in the key — the day window is computed inside queryFn at
    // fetch time. A dated key made the roster unreachable OFFLINE the moment
    // the date rolled over (fresh key → no persisted cache → infinite spinner).
    // Online freshness is preserved by the short staleTime + explicit
    // invalidations after logging/cancelling/rescheduling.
    queryKey: ['trainer-roster', trainerId, dayOffset],
    enabled: !!trainerId,
    staleTime: 120_000,
    queryFn: async (): Promise<RosterRow[]> => {
      const targetDay = new Date(Date.now() + dayOffset * 864e5);
      const startOfToday = istDayStartUtcISO(targetDay);
      const endOfToday = istDayEndUtcISO(targetDay);
      const noRows = Promise.resolve({ data: [], error: null } as any);

      const [dayR, openPastR, carryR, loggedR] = await Promise.all([
        // The day's list (keep cancelled / logged / pending — full activity).
        supabase.from('session_schedule').select(ROSTER_SELECT)
          .eq('trainer_id', trainerId)
          .gte('scheduled_datetime', startOfToday).lte('scheduled_datetime', endOfToday)
          .order('scheduled_datetime', { ascending: true }),
        // Open past: overdue, not logged, not cancelled, NO reschedule raised yet.
        dayOffset !== 0 ? noRows : supabase.from('session_schedule').select(ROSTER_SELECT)
          .eq('trainer_id', trainerId)
          .gte('scheduled_datetime', OPEN_PAST_CUTOFF_ISO).lt('scheduled_datetime', startOfToday)
          .is('workout_session_id', null).neq('status', 'cancelled')
          .is('reschedule_requested_at', null).is('reschedule_status', null).is('reschedule_request', null)
          .order('scheduled_datetime', { ascending: true }),
        // Pending reschedule carry-over: overdue, not logged, not cancelled, request raised & still pending.
        dayOffset !== 0 ? noRows : supabase.from('session_schedule').select(ROSTER_SELECT)
          .eq('trainer_id', trainerId)
          .lt('scheduled_datetime', startOfToday)
          .is('workout_session_id', null).neq('status', 'cancelled')
          .not('reschedule_requested_at', 'is', null).is('reschedule_status', null)
          .order('scheduled_datetime', { ascending: true }),
        // The day's LOGGED workouts — completed training_sessions (may be ad-hoc with no schedule slot).
        supabase.from('training_sessions')
          .select('id, scheduled_at, session_type, status, workout_session_id, schedule_session_id, client_id, session_acknowledged_at, clients:client_id(first_name, last_name, status, brb_location)')
          .eq('trainer_id', trainerId)
          .gte('scheduled_at', startOfToday).lte('scheduled_at', endOfToday)
          .not('workout_session_id', 'is', null)
          .neq('status', 'parked')
          .order('scheduled_at', { ascending: true }),
      ]);
      if (dayR.error) throw new Error(dayR.error.message);

      const day = (dayR.data ?? []).filter(notInactiveClient).map((s) => mapRosterRow(s, false));

      // Ack status per logged session: session_acknowledged_at on the day's
      // training_sessions rows, matched back by schedule id or workout id.
      const ackBySchedule = new Map<string, boolean>();
      const ackByWorkout = new Map<string, boolean>();
      (loggedR.data ?? []).forEach((t: any) => {
        const acked = !!t.session_acknowledged_at;
        if (t.schedule_session_id) ackBySchedule.set(t.schedule_session_id, acked);
        if (t.workout_session_id) ackByWorkout.set(t.workout_session_id, acked);
      });
      day.forEach((r) => {
        if (!r.workout_session_id) return; // not logged → ack not applicable
        r.acknowledged = ackBySchedule.get(r.id) ?? ackByWorkout.get(r.workout_session_id) ?? null;
      });

      // Merge today's logged workouts that aren't already represented by a schedule row.
      const scheduleIds = new Set((dayR.data ?? []).map((s: any) => s.id));
      const linkedWorkoutIds = new Set((dayR.data ?? []).map((s: any) => s.workout_session_id).filter(Boolean));
      const loggedExtra = (loggedR.data ?? [])
        .filter(notInactiveClient)
        .filter((t: any) => !(t.schedule_session_id && scheduleIds.has(t.schedule_session_id)) && !(t.workout_session_id && linkedWorkoutIds.has(t.workout_session_id)))
        .map((t: any) => {
          const row = mapRosterRow({
            id: `ts-${t.id}`,
            scheduled_datetime: t.scheduled_at,
            session_type: t.session_type,
            modality: t.session_type,
            status: t.status,
            client_id: t.client_id,
            workout_session_id: t.workout_session_id,
            reschedule_request: null,
            reschedule_requested_at: null,
            reschedule_status: null,
            missed_remarks: null,
            clients: t.clients,
          }, false);
          row.acknowledged = !!t.session_acknowledged_at;
          return row;
        });
      day.push(...loggedExtra);
      day.sort((a, b) => new Date(a.scheduled_datetime).getTime() - new Date(b.scheduled_datetime).getTime());

      // Open-past: drop rows where the trainer already logged a missed remark.
      const openPast = (openPastR.data ?? [])
        .filter(notInactiveClient)
        .filter((s: any) => !(Array.isArray(s.missed_remarks) && s.missed_remarks.some((r: any) => r?.by_role === 'trainer')))
        .map((s: any) => mapRosterRow(s, true));
      const openPastIds = new Set(openPast.map((s: RosterRow) => s.id));

      const carry = (carryR.data ?? [])
        .filter(notInactiveClient)
        .filter((s: any) => !openPastIds.has(s.id))
        .map((s: any) => mapRosterRow(s, false));

      return [...openPast, ...carry, ...day];
    },
  });
}

/* ---------- Session acknowledgements per client ----------
   Mirrors the web AcknowledgeSessionsDialog: sessions since 1 May count as
   acknowledged when session_acknowledged_at is set OR their workout_analysis
   row has acknowledged_at. */
export type AckSessionItem = { id: string; scheduled_at: string | null; acknowledged: boolean };
export type AckClientRow = {
  client_id: string;
  client_name: string;
  trainers: string[]; // all actively-training staff assigned to this client
  total: number;
  acked: number;
  pct: number;
  sessions: AckSessionItem[];
};
const ACK_SESSIONS_FROM = '2026-05-01T00:00:00+05:30';
async function fetchAllRows(q: (from: number, to: number) => any): Promise<any[]> {
  const out: any[] = [];
  const page = 1000;
  for (let i = 0; ; i += page) {
    const { data, error } = await q(i, i + page - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < page) break;
  }
  return out;
}
export function useAckSessions(trainerId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['trainer-ack-sessions', 'v2', trainerId], // v2: rows gained `trainers` — old persisted shape must not hydrate
    enabled: enabled && !!trainerId,
    staleTime: 300_000,
    queryFn: async (): Promise<AckClientRow[]> => {
      const { data: assigned, error } = await supabase
        .from('trainer_clients')
        .select('client_id, clients!trainer_clients_client_id_fkey(id, first_name, last_name)')
        .eq('trainer_id', trainerId)
        .eq('actively_training', true);
      if (error) throw new Error(error.message);
      if (!assigned?.length) return [];
      const clientIds = assigned.map((a: any) => a.client_id);
      const nameMap = new Map<string, string>();
      assigned.forEach((a: any) => {
        const c = a.clients;
        if (c) nameMap.set(c.id, `${c.first_name ?? ''} ${c.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || 'Unnamed');
      });

      // All assigned staff per client (for the "assigned trainer" line on each row).
      const trainersByClient = new Map<string, string[]>();
      {
        const { data: tcs } = await supabase
          .from('trainer_clients')
          .select('client_id, profiles:trainer_id (first_name, last_name)')
          .in('client_id', clientIds)
          .eq('actively_training', true);
        (tcs ?? []).forEach((t: any) => {
          const n = `${t.profiles?.first_name ?? ''} ${t.profiles?.last_name ?? ''}`.replace(/\s+/g, ' ').trim();
          if (!n) return;
          const arr = trainersByClient.get(t.client_id) ?? [];
          if (!arr.includes(n)) arr.push(n);
          trainersByClient.set(t.client_id, arr);
        });
      }

      const sessions = await fetchAllRows((from, to) =>
        supabase
          .from('training_sessions')
          .select('id, client_id, session_acknowledged_at, scheduled_at')
          .eq('trainer_id', trainerId)
          .in('client_id', clientIds)
          .gte('scheduled_at', ACK_SESSIONS_FROM)
          .range(from, to)
      );

      const ackedIds = new Set<string>();
      const ids = sessions.map((s: any) => s.id);
      for (let i = 0; i < ids.length; i += 200) {
        const { data: wa, error: e2 } = await supabase
          .from('workout_analysis')
          .select('session_id, acknowledged_at')
          .in('session_id', ids.slice(i, i + 200))
          .not('acknowledged_at', 'is', null);
        if (e2) throw new Error(e2.message);
        (wa ?? []).forEach((w: any) => ackedIds.add(w.session_id));
      }

      const agg = new Map<string, { total: number; acked: number; sessions: AckSessionItem[] }>();
      clientIds.forEach((id: string) => agg.set(id, { total: 0, acked: 0, sessions: [] }));
      sessions.forEach((s: any) => {
        const a = agg.get(s.client_id);
        if (!a) return;
        const acknowledged = !!(s.session_acknowledged_at || ackedIds.has(s.id));
        a.total += 1;
        if (acknowledged) a.acked += 1;
        a.sessions.push({ id: s.id, scheduled_at: s.scheduled_at, acknowledged });
      });
      return Array.from(agg.entries())
        .map(([client_id, v]) => ({
          client_id,
          client_name: nameMap.get(client_id) || 'Unnamed',
          trainers: trainersByClient.get(client_id) ?? [],
          total: v.total,
          acked: v.acked,
          pct: v.total > 0 ? Math.round((v.acked / v.total) * 100) : 0,
          sessions: v.sessions.sort((x, y) => (y.scheduled_at ?? '').localeCompare(x.scheduled_at ?? '')),
        }))
        .sort((x, y) => y.pct - x.pct);
    },
  });
}

/* ---------- Cancel a scheduled session (Trainer) ---------- */
/* Web useCancelScheduledSession contract: optional photo → session-attachments bucket
   (`roster-cancel-<ts>-<rand>-<name>`), UPDATE session_schedule (status/remark/canceled_by
   ='Trainer', + paid_cancellation=true & admin_approval='pending' for paid cancels), then a
   fire-and-forget push to the client's CRMs via the notify-session-cancelled edge fn.
   Paid cancels land in the admin Requests → Paid Cancel queue for approval. */
export type CancelSessionInput = {
  id: string;
  remark: string;
  paid?: boolean;
  image?: { uri: string; name: string; mime: string };
};
export function useCancelScheduledSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, remark, paid = false, image }: CancelSessionInput) => {
      if (!remark.trim()) throw new Error('Cancellation remark is required');

      let attachment_url: string | null = null;
      if (image) {
        const sanitizedName = image.name.replace(/[^a-zA-Z0-9.-]/g, '_');
        const fileName = `roster-cancel-${Date.now()}-${Math.random().toString(36).substring(2, 10)}-${sanitizedName}`;
        const buf = await (await fetch(image.uri)).arrayBuffer(); // Hermes-safe (no blobs)
        const { error: upErr } = await supabase.storage.from('session-attachments').upload(fileName, buf, { contentType: image.mime, upsert: false });
        if (upErr) throw new Error(`Attachment upload failed: ${upErr.message}`);
        attachment_url = supabase.storage.from('session-attachments').getPublicUrl(fileName).data.publicUrl;
      }

      const updates: Record<string, any> = { status: 'cancelled', cancellation_remark: remark.trim(), canceled_by: 'Trainer' };
      if (attachment_url) updates.cancellation_attachment_url = attachment_url;
      if (paid) {
        updates.paid_cancellation = true;
        updates.admin_approval = 'pending';
      }

      const { data, error } = await supabase
        .from('session_schedule')
        .update(updates)
        .eq('id', id)
        .select()
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error('Session not found or could not be cancelled');
      return data;
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['trainer-roster'] });
      // Best-effort push to assigned CRMs — a failed push never blocks the cancellation.
      if (data?.client_id && data?.trainer_id) {
        supabase.functions
          .invoke('notify-session-cancelled', {
            body: {
              client_id: data.client_id,
              trainer_id: data.trainer_id,
              scheduled_datetime: data.scheduled_datetime,
              remark: data.cancellation_remark,
              session_id: data.id,
            },
          })
          .catch(() => {});
      }
    },
  });
}

/* ---------- Request a reschedule (Trainer) ---------- */
// Mirrors the web flow: the request carries a proposed new slot (IST date + time)
// plus a reason, and re-raising after a rejection resets the approval fields.
export function useRequestReschedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason, proposedDate, proposedTime }: { id: string; reason: string; proposedDate: string; proposedTime: string }) => {
      if (!reason.trim()) throw new Error('A reason is required');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(proposedDate)) throw new Error('Pick a new date');
      if (!/^\d{2}:\d{2}(:\d{2})?$/.test(proposedTime)) throw new Error('Pick a new time');
      const { data, error } = await supabase
        .from('session_schedule')
        .update({
          reschedule_request: reason.trim(),
          reschedule_requested_at: new Date().toISOString(),
          reschedule_proposed_date: proposedDate,
          reschedule_proposed_time: proposedTime.length === 5 ? `${proposedTime}:00` : proposedTime,
          reschedule_status: null,
          reschedule_approved_by: null,
          reschedule_processed_at: null,
        })
        .eq('id', id)
        .select()
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error('Session not found');
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trainer-roster'] }),
  });
}

/* ---------- Roster distance: trainer's latest logged location → client home ----------
   All the heavy lifting (trainer_location_logs read via service role, Google
   Routes + Static Maps with the server-side GOOGLE_API_KEY) happens in the
   roster-distance edge function — the app only renders the result. */
export type RosterDistance = {
  ok: boolean; error?: string;
  /** true → straight-line fallback estimate (no road routing available at all) */
  approx?: boolean;
  /** true → duration is Google traffic-aware; false → road routing without live traffic */
  traffic?: boolean;
  distanceKm?: number; durationMin?: number; locationAgeMin?: number;
  /** Reverse-geocoded place name of the trainer's origin point (e.g. "Hauz Khas, New Delhi"). */
  originName?: string | null;
  clientLat?: number; clientLng?: number; clientName?: string; clientAddress?: string | null;
  mapImageBase64?: string | null;
};

async function invokeFnWithToken(name: string, body: any) {
  let { data } = await supabase.auth.getSession();
  if (!data.session) {
    await new Promise((r) => setTimeout(r, 450));
    ({ data } = await supabase.auth.getSession());
  }
  const token = data.session?.access_token;
  return supabase.functions.invoke(name, { body, ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}) });
}

export function useRosterDistance(clientId: string | null, enabled: boolean, origin?: { lat: number; lng: number } | null) {
  // origin: fresh device fix (preferred). null → device fix unavailable, server falls
  // back to the hourly log. undefined → still resolving; the caller keeps enabled=false.
  const originKey = origin ? `${origin.lat.toFixed(4)},${origin.lng.toFixed(4)}` : 'log';
  return useQuery({
    queryKey: ['roster-distance', clientId, originKey],
    enabled: !!clientId && enabled,
    staleTime: 5 * 60 * 1000, // trainer moves — keep it fresh-ish, but no spam on re-taps
    retry: false,
    queryFn: async (): Promise<RosterDistance> => {
      const { data, error } = await invokeFnWithToken('roster-distance', { client_id: clientId, origin: origin ?? undefined });
      if (error) {
        // supabase-js hides the response behind error.context — surface something useful.
        const res: Response | undefined = (error as any)?.context;
        if (res?.status === 404) throw new Error('The distance service is not deployed yet. Ask admin to deploy the roster-distance function.');
        let code = '';
        try { code = (await res?.clone().json())?.error ?? ''; } catch { /* non-JSON body */ }
        if (code === 'not_your_client') throw new Error('This client is not assigned to you.');
        if (code) throw new Error(code);
        throw new Error(error.message ?? 'Distance service unavailable');
      }
      return data as RosterDistance;
    },
  });
}

/* ---------- Request Roster from CRM (mirrors web RequestRosterDialog) ----------
   One all_requests insert (request_type 'roster_request', status 'pending') +
   a fire-and-forget notify-roster-request edge call that pushes to the client's
   assigned CRM(s). 'single' carries requested_datetime; 'full' leaves it null —
   the CRM builds the slots from the remark. */
/* Session modalities — web CreateSessionDialog MODALITIES verbatim. Shared by the
   trainer's request sheet and the CRM's schedule-on-approve sheet. */
export const SESSION_MODALITIES = ['Strength', 'Yoga', 'Boxing', 'HIIT', 'Cardio', 'Pilates', 'Functional', 'CrossFit', 'Physiotherapy'] as const;

export function useRequestRoster() {
  return useMutation({
    mutationFn: async ({ clientId, rosterType, date, time, remark, modality }: {
      clientId: string; rosterType: 'single' | 'full'; date?: string | null; time?: string | null; remark: string; modality?: string | null;
    }) => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) throw new Error('Not signed in');
      if (!clientId || !remark.trim()) throw new Error('Please fill all fields');
      if (rosterType === 'single' && (!date || !time)) throw new Error('Please pick date and time');

      let requestedDatetime: string | null = null;
      if (rosterType === 'single' && date && time) {
        // Local (IST device) date+time → UTC ISO, same as the web dialog.
        const [h, m] = time.split(':').map(Number);
        const dt = new Date(`${date}T00:00:00`);
        dt.setHours(h, m, 0, 0);
        requestedDatetime = dt.toISOString();
      }

      const basePayload: any = {
        request_type: 'roster_request',
        requested_by: uid,
        client_id: clientId,
        requested_datetime: requestedDatetime,
        remark: remark.trim(),
        status: 'pending',
        roster_type: rosterType,
      };
      // Trainer's chosen modality rides on the request so the CRM's approve
      // dialog prefills it. Falls back gracefully if the all_requests.modality
      // column migration hasn't been run yet.
      let ins = await supabase.from('all_requests').insert({ ...basePayload, modality: modality ?? null }).select('id').maybeSingle();
      if (ins.error && /modality/.test(ins.error.message)) {
        ins = await supabase.from('all_requests').insert(basePayload).select('id').maybeSingle();
      }
      const { data: inserted, error } = ins;
      if (error) throw new Error(error.message);

      // Non-blocking CRM push — insert success is what matters.
      if (inserted?.id) {
        supabase.functions.invoke('notify-roster-request', { body: { request_id: inserted.id } }).catch(() => {});
      }
      return inserted;
    },
  });
}

/* ---------- Add a missed-session remark (Trainer) ----------
   Uses the same server RPC as the web app — it appends
   { by, by_name, by_role, category, remark, at } to missed_remarks server-side,
   so remarks from the app and web carry identical data (incl. the category). */
export function useAddMissedRemark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, category, remark }: { id: string; category: string; remark: string }) => {
      if (!category) throw new Error('Pick a category');
      if (!remark.trim()) throw new Error('A remark is required');
      const { data, error } = await supabase.rpc('append_missed_session_remark', {
        p_session_id: id,
        p_category: category,
        p_remark: remark.trim(),
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trainer-roster'] }),
  });
}

// 4 stat counts — four parallel head/count queries.
/* ---------- Trainer profile (self) ---------- */
export type TrainerProfile = {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  bio: string | null;
  specializations: string[] | null;
  role: string | null;
};
export function useTrainerProfile(trainerId: string) {
  return useQuery({
    queryKey: ['trainer-profile', trainerId],
    enabled: !!trainerId,
    staleTime: 300_000,
    queryFn: async () => {
      const cnt = (q: any) => q.then((r: any) => (r.error ? 0 : (r.count ?? 0)));
      const [profileR, totalSessions, activeClients, certs] = await Promise.all([
        supabase.from('profiles').select('first_name, last_name, email, phone, location, bio, specializations, role').eq('id', trainerId).maybeSingle(),
        cnt(supabase.from('training_sessions').select('id', { count: 'exact', head: true }).eq('trainer_id', trainerId).eq('status', 'completed')),
        cnt(supabase.from('trainer_clients').select('id', { count: 'exact', head: true }).eq('trainer_id', trainerId).eq('actively_training', true)),
        cnt(supabase.from('odds_certifications').select('id', { count: 'exact', head: true }).eq('trainer_id', trainerId)),
      ]);
      if (profileR.error) throw new Error(profileR.error.message);
      const p: any = profileR.data ?? {};
      const specs = Array.isArray(p.specializations)
        ? p.specializations
        : typeof p.specializations === 'string' && p.specializations
        ? p.specializations.split(',').map((s: string) => s.trim()).filter(Boolean)
        : null;
      return {
        profile: { ...p, specializations: specs } as TrainerProfile,
        totalSessions,
        activeClients,
        certifications: certs,
      };
    },
  });
}

/* ---------- Client acknowledgements (this IST month) — home-card + breakdown ----------
   pct = sessions with session_acknowledged_at ÷ non-cancelled sessions this month. */
export type TrainerAckRow = { id: string; clientName: string; scheduledAt: string; sessionType: string | null; acknowledged: boolean; cancelled: boolean };
export function useTrainerAckSummary(trainerId: string | null) {
  return useQuery({
    queryKey: ['trainer-ack-summary', trainerId],
    enabled: !!trainerId,
    staleTime: 120_000,
    queryFn: async () => {
      const [y, m] = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).split('-').map(Number);
      const IST = 5.5 * 3600 * 1000;
      const startISO = new Date(Date.UTC(y, m - 1, 1) - IST).toISOString();
      const endISO = new Date(Date.UTC(y, m, 1) - IST).toISOString();
      const { data, error } = await supabase.from('training_sessions')
        .select('id, scheduled_at, session_type, session_acknowledged_at, cancelled, status, clients (first_name, last_name)')
        .eq('trainer_id', trainerId).gte('scheduled_at', startISO).lt('scheduled_at', endISO)
        .order('scheduled_at', { ascending: false }).limit(1000);
      if (error) throw new Error(error.message);
      const rows: TrainerAckRow[] = ((data ?? []) as any[]).map((s) => ({
        id: s.id,
        clientName: s.clients ? `${s.clients.first_name ?? ''} ${s.clients.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || '—' : '—',
        scheduledAt: s.scheduled_at, sessionType: s.session_type ?? null,
        acknowledged: !!s.session_acknowledged_at,
        cancelled: s.cancelled === true || s.status === 'cancelled',
      }));
      const counted = rows.filter((r) => !r.cancelled);
      const acked = counted.filter((r) => r.acknowledged).length;
      return { rows: counted, total: counted.length, acked, pct: counted.length ? Math.round((acked / counted.length) * 100) : 0 };
    },
  });
}

export function useTrainerStats(trainerId: string) {
  return useQuery({
    queryKey: ['trainer-stats', trainerId, istDate()],
    enabled: !!trainerId,
    staleTime: 60_000,
    queryFn: async (): Promise<TrainerStats> => {
      const month = istMonthBounds();
      const cnt = (q: any) => q.then((r: any) => (r.error ? Promise.reject(new Error(r.error.message)) : (r.count ?? 0)));
      const [today, active, monthCount, certs] = await Promise.all([
        cnt(supabase.from('training_sessions').select('id', { count: 'exact', head: true })
          .eq('trainer_id', trainerId).gte('scheduled_at', istDayStartUtcISO()).lte('scheduled_at', istDayEndUtcISO())),
        cnt(supabase.from('trainer_clients').select('id', { count: 'exact', head: true })
          .eq('trainer_id', trainerId).eq('actively_training', true)),
        cnt(supabase.from('training_sessions').select('id', { count: 'exact', head: true })
          .eq('trainer_id', trainerId).neq('status', 'parked').gte('scheduled_at', month.startUtc).lte('scheduled_at', month.endUtc)),
        cnt(supabase.from('odds_certifications').select('id', { count: 'exact', head: true })
          .eq('trainer_id', trainerId)),
      ]);
      return { todaySessionsCount: today, activeClientsCount: active, monthSessionsCount: monthCount, certificationsCount: certs };
    },
  });
}

// Trainer leaderboard — get_trainer_leaderboard RPC + approved referrals + weighted score.
export function useTrainerLeaderboard(bounds?: LbBounds) {
  const b = bounds ?? { start: istMonthBounds().start, end: istMonthBounds().end };
  return useQuery({
    queryKey: ['trainer-leaderboard', b.start, b.end],
    staleTime: 120_000,
    queryFn: async (): Promise<LeaderboardEntry[]> => {
      const { start, end } = b;
      const { data: rows, error } = await supabase.rpc('get_trainer_leaderboard', { start_date: start, end_date: end });
      if (error) throw new Error(error.message);

      // Approved referrals this month → count per referrer.
      const { data: refs } = await supabase
        .from('referrals')
        .select('referrer_id')
        .eq('status', 'approved')
        .gte('approved_at', `${start}T00:00:00+05:30`)
        .lte('approved_at', `${end}T23:59:59+05:30`);
      const refCount = new Map<string, number>();
      for (const r of refs ?? []) refCount.set((r as any).referrer_id, (refCount.get((r as any).referrer_id) ?? 0) + 1);

      const entries: Omit<LeaderboardEntry, 'rank'>[] = (rows ?? []).map((r: any) => {
        const referralCount = refCount.get(r.trainer_id) ?? 0;
        const combined = Number(r.session_count) + Number(r.qhp_count);
        return {
          trainerId: r.trainer_id,
          trainerName: (r.trainer_name ?? '').replace(/\s+/g, ' ').trim() || 'Trainer',
          sessionCount: Number(r.session_count),
          qhpCount: Number(r.qhp_count),
          referralCount,
          weightedScore: combined * 0.7 + referralCount * 0.3,
        };
      });
      entries.sort((a, b) => b.weightedScore - a.weightedScore || a.trainerName.localeCompare(b.trainerName));
      return entries.map((e, i) => ({ ...e, rank: i + 1 }));
    },
  });
}

// Sessions chart — per-IST-day counts over a tenure window (15/30/90d), zero-filled.
export function useSessionsChart(trainerId: string, tenureDays: number) {
  return useQuery({
    queryKey: ['trainer-sessions-chart', trainerId, tenureDays, istDate()],
    enabled: !!trainerId,
    staleTime: 120_000,
    queryFn: async (): Promise<{ day: string; sessions: number }[]> => {
      const from = new Date();
      from.setDate(from.getDate() - tenureDays);
      const { data, error } = await supabase
        .from('training_sessions')
        .select('id, scheduled_at, status')
        .eq('trainer_id', trainerId)
        .neq('status', 'parked')
        .gte('scheduled_at', istDayStartUtcISO(from))
        .lte('scheduled_at', new Date().toISOString());
      if (error) throw new Error(error.message);
      const perDay = new Map<string, number>();
      for (const r of data ?? []) {
        const d = istDate(new Date((r as any).scheduled_at));
        perDay.set(d, (perDay.get(d) ?? 0) + 1);
      }
      // zero-fill each day in the window
      const out: { day: string; sessions: number }[] = [];
      for (let i = tenureDays; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = istDate(d);
        out.push({ day: key, sessions: perDay.get(key) ?? 0 });
      }
      return out;
    },
  });
}

export type IncidentRow = { id: string; author_role: string | null; message: string; created_at: string };
export function useTrainerIncidents(trainerId: string) {
  return useQuery({
    queryKey: ['trainer-incidents', trainerId],
    enabled: !!trainerId,
    staleTime: 300_000,
    queryFn: async (): Promise<IncidentRow[]> => {
      const { data, error } = await supabase
        .from('trainers_incidents')
        .select('id, author_role, message, created_at')
        .eq('trainer_id', trainerId)
        .order('created_at', { ascending: false })
        .limit(5);
      if (error) throw new Error(error.message);
      return (data ?? []) as IncidentRow[];
    },
  });
}

/* ---------- Sessions page: month schedule for the trainer ---------- */
export type TrainerSessionItem = {
  id: string;
  scheduled_datetime: string;
  day: number; // IST day-of-month
  client_name: string;
  modality: string;
  status: string;
  logged: boolean;
  is_past: boolean;
};
export function useTrainerMonthSessions(trainerId: string, ref: { year: number; month: number }) {
  return useQuery({
    queryKey: ['trainer-month-sessions', trainerId, ref.year, ref.month],
    enabled: !!trainerId,
    staleTime: 60_000,
    queryFn: async () => {
      const refDate = new Date(Date.UTC(ref.year, ref.month, 15));
      const bounds = istMonthBounds(refDate);
      const [schedR, loggedR] = await Promise.all([
        supabase
          .from('session_schedule')
          .select('id, scheduled_datetime, modality, session_type, status, workout_session_id, client_id, clients:client_id(first_name, last_name)')
          .eq('trainer_id', trainerId)
          .gte('scheduled_datetime', bounds.startUtc)
          .lte('scheduled_datetime', bounds.endUtc)
          .order('scheduled_datetime', { ascending: true }),
        // Ad-hoc logged workouts (no schedule slot) — e.g. trial sessions or logs made
        // offline without a roster slot. Shown on the day they were logged.
        supabase
          .from('training_sessions')
          .select('id, scheduled_at, session_type, session_name, status, workout_session_id, client_id, clients:client_id(first_name, last_name)')
          .eq('trainer_id', trainerId)
          .gte('scheduled_at', bounds.startUtc)
          .lte('scheduled_at', bounds.endUtc)
          .not('workout_session_id', 'is', null)
          .neq('status', 'parked')
          .order('scheduled_at', { ascending: true }),
      ]);
      if (schedR.error) throw new Error(schedR.error.message);
      const now = Date.now();
      const items: TrainerSessionItem[] = (schedR.data ?? []).map((s: any) => ({
        id: s.id,
        scheduled_datetime: s.scheduled_datetime,
        day: Number(istDate(new Date(s.scheduled_datetime)).split('-')[2]),
        client_name: `${s.clients?.first_name ?? ''} ${s.clients?.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || 'Client',
        modality: s.modality || s.session_type || 'Session',
        status: s.status || 'scheduled',
        logged: !!s.workout_session_id,
        is_past: new Date(s.scheduled_datetime).getTime() < now,
      }));
      // Merge logged training_sessions (web Training-tab behavior: a session shows on
      // the day it was LOGGED). Dedup only when its schedule slot is on the SAME day —
      // a late-logged old slot still appears on today's list (web parity), while the
      // old slot itself shows as Logged on its own day.
      const slotDayByWorkoutId = new Map<string, number>();
      for (const s of (schedR.data ?? []) as any[]) {
        if (s.workout_session_id) slotDayByWorkoutId.set(s.workout_session_id, Number(istDate(new Date(s.scheduled_datetime)).split('-')[2]));
      }
      for (const t of (loggedR.data ?? []) as any[]) {
        const tDay = Number(istDate(new Date(t.scheduled_at)).split('-')[2]);
        if (t.workout_session_id && slotDayByWorkoutId.get(t.workout_session_id) === tDay) continue;
        items.push({
          id: t.id,
          scheduled_datetime: t.scheduled_at,
          day: Number(istDate(new Date(t.scheduled_at)).split('-')[2]),
          client_name: `${t.clients?.first_name ?? ''} ${t.clients?.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || 'Client',
          modality: t.session_type || t.session_name || 'Session',
          status: t.status || 'completed',
          logged: true,
          is_past: new Date(t.scheduled_at).getTime() < now,
        });
      }
      items.sort((a, b) => new Date(a.scheduled_datetime).getTime() - new Date(b.scheduled_datetime).getTime());
      const byDay: Record<number, TrainerSessionItem[]> = {};
      for (const it of items) (byDay[it.day] = byDay[it.day] || []).push(it);
      const missed = items.filter(
        (it) => it.is_past && !it.logged && it.status !== 'cancelled' && it.status !== 'completed',
      );
      return { items, byDay, missed };
    },
  });
}

export type FirstSessionAlert = { clientName: string; sessionTime: string } | null;
export function useFirstSessionAlert(trainerId: string) {
  return useQuery({
    queryKey: ['trainer-first-session', trainerId],
    enabled: !!trainerId,
    staleTime: 300_000,
    queryFn: async (): Promise<FirstSessionAlert> => {
      const { data: tc } = await supabase
        .from('trainer_clients')
        .select('client_id')
        .eq('trainer_id', trainerId)
        .eq('actively_training', true);
      const ids = (tc ?? []).map((r: any) => r.client_id).filter(Boolean);
      if (ids.length === 0) return null;
      const now = new Date();
      const in24 = new Date(now.getTime() + 24 * 3600_000);
      const { data: cand } = await supabase
        .from('session_schedule')
        .select('id, client_id, scheduled_datetime, clients:client_id(first_name, last_name)')
        .in('client_id', ids)
        .gte('scheduled_datetime', now.toISOString())
        .lte('scheduled_datetime', in24.toISOString())
        .order('scheduled_datetime', { ascending: true });
      for (const s of cand ?? []) {
        const { count } = await supabase
          .from('session_schedule')
          .select('id', { count: 'exact', head: true })
          .eq('client_id', (s as any).client_id)
          .lt('scheduled_datetime', (s as any).scheduled_datetime);
        if ((count ?? 0) === 0) {
          const c = (s as any).clients;
          return { clientName: `${c?.first_name ?? ''} ${c?.last_name ?? ''}`.trim() || 'A client', sessionTime: (s as any).scheduled_datetime };
        }
      }
      return null;
    },
  });
}

/* ---------- Manager's own team overview (mirrors useMyManagerTeams) ---------- */
export type ManagerTeamMember = {
  id: string;
  name: string;
  sessions: number;
  qhps: number;
  referrals: number;
  isManager: boolean;
};
export type ManagerTeam = {
  id: string;
  teamName: string;
  periodStart: string | null;
  periodEnd: string | null;
  isOngoing: boolean;
  members: ManagerTeamMember[];
};
export function useManagerTeam(managerId: string) {
  return useQuery({
    queryKey: ['manager-team', managerId],
    enabled: !!managerId,
    staleTime: 120_000,
    queryFn: async (): Promise<{ hasTeam: boolean; teams: ManagerTeam[] }> => {
      // Match teams this user manages OR is a member of (team_json contains id).
      const { data: teamRows, error } = await supabase
        .from('manager_score')
        .select('*')
        .or(`manager_id.eq.${managerId},team_json.cs.["${managerId}"]`)
        .order('team_start', { ascending: false });
      if (error) throw new Error(error.message);
      const allTeams = (teamRows as any[]) ?? [];
      if (allTeams.length === 0) return { hasTeam: false, teams: [] };

      const today = new Date().toISOString().slice(0, 10);
      const teams: ManagerTeam[] = [];
      for (const team of allTeams) {
        const memberIdsRaw: string[] = Array.isArray(team.team_json) ? team.team_json : [];
        const memberIds = Array.from(new Set([team.manager_id, ...memberIdsRaw].filter(Boolean)));

        const cMap = new Map<string, { sessions: number; referrals: number; qhps: number }>();
        if (memberIds.length > 0) {
          const { data: counts } = await supabase.rpc('get_manager_team_counts', {
            member_ids: memberIds,
            period_start: team.team_start,
            period_end: team.team_end || null,
          });
          for (const r of (counts ?? []) as any[]) cMap.set(r.member_id, { sessions: Number(r.session_count) || 0, referrals: Number(r.referral_count) || 0, qhps: Number(r.qhp_count) || 0 });
        }

        const pMap = new Map<string, any>();
        if (memberIds.length > 0) {
          const { data: profs } = await supabase.from('profiles').select('id, first_name, last_name, managers').in('id', memberIds);
          (profs ?? []).forEach((p: any) => pMap.set(p.id, p));
        }

        const members: ManagerTeamMember[] = memberIds.map((id) => {
          const p = pMap.get(id);
          const c = cMap.get(id) || { sessions: 0, referrals: 0, qhps: 0 };
          return {
            id,
            name: p ? `${p.first_name ?? ''} ${p.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || 'Member' : 'Unknown',
            sessions: c.sessions,
            qhps: c.qhps,
            referrals: c.referrals,
            isManager: p?.managers === true || id === team.manager_id,
          };
        }).sort((a, b) => b.sessions - a.sessions);

        teams.push({
          id: team.id,
          teamName: team.team_name ?? 'My Team',
          periodStart: team.team_start ?? null,
          periodEnd: team.team_end || null,
          isOngoing: !team.team_end || team.team_end >= today,
          members,
        });
      }
      return { hasTeam: teams.length > 0, teams };
    },
  });
}

/* ---------- Per-trainer drill-downs (the web's expandable rank rows) ----------
   Session breakdown: get_manager_trainer_session_breakdown (per-client totals by
   status). Referral breakdown: get_manager_trainer_referral_breakdown. Both
   SECURITY DEFINER, authorized server-side; verified live. Fetched lazily —
   only when a row is expanded. */
export type SessionBreakdownRow = { clientId: string; clientName: string; total: number; completed: number; cancelled: number; parked: number; pending: number; complimentary: number; lastAt: string | null };

/* SELF month breakdown — direct queries on the trainer's OWN sessions (RLS-safe
   for every trainer). The manager RPC (get_manager_trainer_session_breakdown)
   is guarded to managers and raises "unauthorized" for regular trainers, so the
   dashboard's own-sessions card must NOT use it. */
export function useMyMonthSessionBreakdown(trainerId: string, enabled: boolean) {
  const month = istMonthBounds();
  return useQuery({
    queryKey: ['my-month-session-breakdown', trainerId, month.start],
    enabled: enabled && !!trainerId,
    staleTime: 120_000,
    queryFn: async (): Promise<SessionBreakdownRow[]> => {
      const { data, error } = await supabase
        .from('training_sessions')
        .select('client_id, status, cancelled, complimentary_session, scheduled_at')
        .eq('trainer_id', trainerId)
        .neq('status', 'parked')
        .gte('scheduled_at', month.startUtc)
        .lte('scheduled_at', month.endUtc)
        .limit(2000);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as any[];
      const byClient = new Map<string, SessionBreakdownRow>();
      rows.forEach((r) => {
        const id = r.client_id ?? 'unknown';
        let g = byClient.get(id);
        if (!g) { g = { clientId: id, clientName: '—', total: 0, completed: 0, cancelled: 0, parked: 0, pending: 0, complimentary: 0, lastAt: null }; byClient.set(id, g); }
        g.total += 1;
        const cancelled = r.cancelled || r.status === 'cancelled';
        if (cancelled) g.cancelled += 1;
        else if (r.status === 'completed') g.completed += 1;
        else g.pending += 1;
        if (r.complimentary_session) g.complimentary += 1;
        if (!g.lastAt || r.scheduled_at > g.lastAt) g.lastAt = r.scheduled_at;
      });
      const ids = [...byClient.keys()].filter((k) => k !== 'unknown');
      if (ids.length) {
        const { data: cls } = await supabase.from('clients').select('id, first_name, last_name').in('id', ids);
        (cls ?? []).forEach((c: any) => {
          const g = byClient.get(c.id);
          if (g) g.clientName = `${c.first_name ?? ''} ${c.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || '—';
        });
      }
      return [...byClient.values()];
    },
  });
}
export function useTrainerSessionBreakdown(trainerId: string, periodStart: string | null, periodEnd: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['trainer-session-breakdown', trainerId, periodStart, periodEnd],
    enabled: enabled && !!trainerId && !!periodStart,
    staleTime: 120_000,
    queryFn: async (): Promise<SessionBreakdownRow[]> => {
      const { data, error } = await supabase.rpc('get_manager_trainer_session_breakdown', { trainer_id_input: trainerId, period_start: periodStart, period_end: periodEnd });
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map((r) => ({
        clientId: r.client_id, clientName: r.client_name || '—',
        total: Number(r.total_sessions) || 0, completed: Number(r.completed_sessions) || 0,
        cancelled: Number(r.cancelled_sessions) || 0, parked: Number(r.parked_sessions) || 0,
        pending: Number(r.pending_sessions) || 0, complimentary: Number(r.complimentary_sessions) || 0,
        lastAt: r.last_session_at ?? null,
      }));
    },
  });
}
export type ReferralBreakdownRow = { id: string; name: string; phone: string | null; source: string | null; status: string | null; rejectionReason: string | null; notes: string | null; linkedClientName: string | null; createdAt: string };
export function useTrainerReferralBreakdown(trainerId: string, periodStart: string | null, periodEnd: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['trainer-referral-breakdown', trainerId, periodStart, periodEnd],
    enabled: enabled && !!trainerId && !!periodStart,
    staleTime: 120_000,
    queryFn: async (): Promise<ReferralBreakdownRow[]> => {
      const { data, error } = await supabase.rpc('get_manager_trainer_referral_breakdown', { trainer_id_input: trainerId, period_start: periodStart, period_end: periodEnd });
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map((r) => ({
        id: r.id, name: r.referred_client_name || '—', phone: r.referred_client_phone ?? null,
        source: r.trainer_source ?? null, status: r.status ?? null, rejectionReason: r.rejection_reason ?? null,
        notes: r.notes ?? null, linkedClientName: r.linked_client_name ?? null, createdAt: r.created_at,
      }));
    },
  });
}

/* ---------- Manager team panels (leaves / incidents / retention / late-logs) ---------- */
type TeamPanelParams = { memberIds: string[]; periodStart: string | null; periodEnd: string | null };
function useTeamPanel<T = any>(key: string, rpc: string, { memberIds, periodStart, periodEnd }: TeamPanelParams) {
  const sortedKey = [...memberIds].sort().join(',');
  return useQuery({
    queryKey: [key, sortedKey, periodStart, periodEnd],
    enabled: memberIds.length > 0 && !!periodStart,
    staleTime: 60_000,
    queryFn: async (): Promise<T[]> => {
      const { data, error } = await supabase.rpc(rpc, { member_ids: memberIds, period_start: periodStart, period_end: periodEnd });
      if (error) throw new Error(error.message);
      return (data as T[]) ?? [];
    },
  });
}
export type TeamLeave = { id: string; trainer_name: string; start_date: string; start_time: string; end_date: string; end_time: string; reason: string | null };
export const useManagerTeamLeaves = (p: TeamPanelParams) => useTeamPanel<TeamLeave>('manager-team-leaves', 'get_manager_team_leaves', p);
export type TeamIncident = { id: string; trainer_name: string; author_name: string; author_role: string; message: string; created_at: string };
export const useManagerTeamIncidents = (p: TeamPanelParams) => useTeamPanel<TeamIncident>('manager-team-incidents', 'get_manager_team_incidents', p);
export type TeamRetentionRow = { trainer_id: string; trainer_name: string; active_at_start: number; lost_in_period: number; retention_rate: number | null; lost_clients: { client_name: string; lost_at: string }[] };
export function useManagerTeamRetention(p: TeamPanelParams) {
  const q = useTeamPanel<any>('manager-team-retention', 'get_manager_team_retention', p);
  return {
    ...q,
    data: (q.data ?? []).map((r: any) => ({ ...r, retention_rate: r.retention_rate == null ? null : Number(r.retention_rate), lost_clients: Array.isArray(r.lost_clients) ? r.lost_clients : [] })) as TeamRetentionRow[],
  };
}
export type TeamLateLog = { id: string; trainer_name: string; client_name: string; session_name: string | null; session_type: string | null; scheduled_at: string | null; logged_at: string; late_log_reason: string | null; status_late_log: string | null };
export const useManagerTeamLateLogs = (p: TeamPanelParams) => useTeamPanel<TeamLateLog>('manager-team-late-logs', 'get_manager_team_late_logs', p);

const istDateToUtcISO = (ymd: string, time: '00:00' | '23:59') =>
  new Date(new Date(`${ymd}T${time}:${time === '00:00' ? '00.000' : '59.999'}Z`).getTime() - IST_OFFSET_MIN * 60_000).toISOString();

/* ---------- Roster: sessions per trainer over the competition window ---------- */
export type RosterTotals = { total: number; scheduled: number; completed: number; cancelled: number };
export type ManagerRosterSession = { id: string; trainer_id: string; scheduled_datetime: string; modality: string | null; status: string; client_name: string };
export function useManagerTeamRoster(trainerIds: string[], periodStart: string | null, periodEnd: string | null) {
  const sortedKey = [...trainerIds].sort().join(',');
  return useQuery({
    queryKey: ['manager-team-roster', sortedKey, periodStart, periodEnd],
    enabled: trainerIds.length > 0 && !!periodStart,
    staleTime: 60_000,
    queryFn: async () => {
      const startUtc = istDateToUtcISO(periodStart as string, '00:00');
      const endUtc = periodEnd ? istDateToUtcISO(periodEnd, '23:59') : new Date().toISOString();
      const { data, error } = await supabase.rpc('get_manager_team_sessions', { _trainer_ids: trainerIds, _start: startUtc, _end: endUtc });
      if (error) throw new Error(error.message);
      const sessions = (data ?? []) as any[];

      const clientIds = Array.from(new Set(sessions.map((s) => s.client_id).filter(Boolean)));
      const nameMap = new Map<string, string>();
      if (clientIds.length > 0) {
        const { data: cs } = await supabase.from('clients').select('id, first_name, last_name').in('id', clientIds);
        (cs ?? []).forEach((c: any) => nameMap.set(c.id, `${c.first_name ?? ''} ${c.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || 'Client'));
      }

      const byTrainer: Record<string, ManagerRosterSession[]> = {};
      const totals: Record<string, RosterTotals> = {};
      trainerIds.forEach((id) => { byTrainer[id] = []; totals[id] = { total: 0, scheduled: 0, completed: 0, cancelled: 0 }; });
      for (const s of sessions) {
        if (!byTrainer[s.trainer_id]) { byTrainer[s.trainer_id] = []; totals[s.trainer_id] = { total: 0, scheduled: 0, completed: 0, cancelled: 0 }; }
        byTrainer[s.trainer_id].push({ id: s.id, trainer_id: s.trainer_id, scheduled_datetime: s.scheduled_datetime, modality: s.modality, status: s.status, client_name: nameMap.get(s.client_id) || 'Client' });
        const t = totals[s.trainer_id];
        t.total += 1;
        const st = String(s.status || '').toLowerCase();
        if (st === 'completed') t.completed += 1;
        else if (st === 'cancelled' || st === 'canceled') t.cancelled += 1;
        else t.scheduled += 1;
      }
      return { byTrainer, totals };
    },
  });
}

/* ---------- Plan overview: workout-plan status per trainer's clients (42-day rule) ---------- */
export const PLAN_EXPIRY_DAYS = 42;
export type PlanSummary = { trainerId: string; trainerName: string; isManager: boolean; assigned: number; noPlan: number; expired: number; active: number };
export function useManagerTeamPlanOverview(members: { id: string; name: string; isManager: boolean }[]) {
  const memberIds = members.map((m) => m.id);
  return useQuery({
    queryKey: ['manager-team-plan-overview', [...memberIds].sort().join(',')],
    enabled: memberIds.length > 0,
    staleTime: 120_000,
    queryFn: async () => {
      const { data: assignments, error } = await supabase
        .from('trainer_clients')
        .select('trainer_id, client_id')
        .in('trainer_id', memberIds)
        .eq('actively_training', true);
      if (error) throw new Error(error.message);
      const rowsRaw = (assignments ?? []) as any[];
      const clientIds = Array.from(new Set(rowsRaw.map((a) => a.client_id)));

      const planMap = new Map<string, string>(); // clientId -> approved_at
      if (clientIds.length > 0) {
        const { data: plans } = await supabase.rpc('get_manager_team_plan_overview', { p_client_ids: clientIds });
        (plans ?? []).forEach((p: any) => { if (p.approved_at) planMap.set(p.client_id, p.approved_at); });
      }
      const now = Date.now();
      const statusOf = (clientId: string): 'no_plan' | 'expired' | 'active' => {
        const a = planMap.get(clientId);
        if (!a) return 'no_plan';
        return new Date(a).getTime() + PLAN_EXPIRY_DAYS * 864e5 < now ? 'expired' : 'active';
      };
      const summaries: PlanSummary[] = members.map((m) => {
        const mine = rowsRaw.filter((r) => r.trainer_id === m.id);
        let noPlan = 0, expired = 0, active = 0;
        for (const r of mine) { const s = statusOf(r.client_id); if (s === 'no_plan') noPlan++; else if (s === 'expired') expired++; else active++; }
        return { trainerId: m.id, trainerName: m.name, isManager: m.isManager, assigned: mine.length, noPlan, expired, active };
      }).sort((a, b) => b.assigned - a.assigned);
      const totals = {
        pending: summaries.reduce((n, s) => n + s.noPlan, 0),
        expired: summaries.reduce((n, s) => n + s.expired, 0),
        active: summaries.reduce((n, s) => n + s.active, 0),
      };
      return { summaries, totals };
    },
  });
}

/* ---------- Acknowledgments: logged sessions & client acks, with per-day/session breakdown ---------- */
export type AckSession = { id: string; clientName: string; createdAt: string; acknowledgedAt: string | null };
export type AckDay = { date: string; total: number; acknowledged: number; sessions: AckSession[] };
export type AckTrainer = { trainerId: string; trainerName: string; isManager: boolean; total: number; acknowledged: number; pct: number; days: AckDay[] };
export function useManagerTeamAcks(members: { id: string; name: string; isManager: boolean }[], days = 7) {
  const memberIds = members.map((m) => m.id).sort();
  return useQuery({
    queryKey: ['manager-team-acks', memberIds, days],
    enabled: memberIds.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const startTs = new Date(Date.now() - (days - 1) * 864e5);
      startTs.setHours(0, 0, 0, 0);
      const { data, error } = await supabase.rpc('get_team_sessions_with_acks', { member_ids: memberIds, start_ts: startTs.toISOString() });
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as any[];
      const istDay = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

      // trainer -> date -> sessions
      const byTrainer = new Map<string, Map<string, AckSession[]>>();
      for (const r of rows) {
        const tId = r.trainer_id;
        const d = istDay(r.created_at);
        if (!byTrainer.has(tId)) byTrainer.set(tId, new Map());
        const dayMap = byTrainer.get(tId)!;
        if (!dayMap.has(d)) dayMap.set(d, []);
        dayMap.get(d)!.push({ id: r.id, clientName: r.client_name ?? 'Unknown', createdAt: r.created_at, acknowledgedAt: r.acknowledged_at ?? null });
      }

      const trainers: AckTrainer[] = members.map((m) => {
        const dayMap = byTrainer.get(m.id) ?? new Map<string, AckSession[]>();
        const dayList: AckDay[] = Array.from(dayMap.entries())
          .map(([date, sessions]) => ({ date, total: sessions.length, acknowledged: sessions.filter((s) => !!s.acknowledgedAt).length, sessions }))
          .sort((a, b) => (a.date < b.date ? 1 : -1));
        const total = dayList.reduce((s, d) => s + d.total, 0);
        const acknowledged = dayList.reduce((s, d) => s + d.acknowledged, 0);
        return { trainerId: m.id, trainerName: m.name, isManager: m.isManager, total, acknowledged, pct: total > 0 ? Math.round((acknowledged / total) * 100) : 0, days: dayList };
      }).sort((a, b) => b.total - a.total);

      const totalSessions = trainers.reduce((s, t) => s + t.total, 0);
      const totalAck = trainers.reduce((s, t) => s + t.acknowledged, 0);
      return { trainers, totalSessions, totalAcknowledged: totalAck, pct: totalSessions > 0 ? Math.round((totalAck / totalSessions) * 100) : 0 };
    },
  });
}

/* ---------- App adoption: how many of each trainer's clients are on the app ---------- */
export type AppAdoptionRow = { trainerId: string; trainerName: string; isManager: boolean; total: number; onApp: number; notOnApp: number };
const ALLOWED_SUBSCRIPTIONS = ['Odds basic', 'Odds plus', 'Odds pro', 'Odds lux', 'Odds Prive', 'Virtual Training', 'Influencer'];
export function useManagerTeamAppAdoption(members: { id: string; name: string; isManager: boolean }[]) {
  const memberIds = members.map((m) => m.id);
  return useQuery({
    queryKey: ['manager-team-app-adoption', [...memberIds].sort().join(',')],
    enabled: memberIds.length > 0,
    staleTime: 300_000,
    queryFn: async () => {
      const { data: assignments, error } = await supabase
        .from('trainer_clients')
        .select('trainer_id, client_id')
        .in('trainer_id', memberIds)
        .eq('actively_training', true);
      if (error) throw new Error(error.message);
      const rowsRaw = (assignments ?? []) as any[];
      const clientIds = Array.from(new Set(rowsRaw.map((a) => a.client_id)));

      const clientMap = new Map<string, any>();
      if (clientIds.length > 0) {
        const { data: cs } = await supabase
          .from('clients')
          .select('id, profile_id, status, subscription_type')
          .in('id', clientIds)
          .eq('status', 'active')
          .in('subscription_type', ALLOWED_SUBSCRIPTIONS);
        (cs ?? []).forEach((c: any) => clientMap.set(c.id, c));
      }
      const profileIds = Array.from(new Set([...clientMap.values()].map((c) => c.profile_id).filter(Boolean)));
      const consented = new Set<string>();
      if (profileIds.length > 0) {
        const { data: profs } = await supabase.from('profiles').select('id, health_data_consent').in('id', profileIds);
        (profs ?? []).forEach((p: any) => { if (p.health_data_consent === true) consented.add(p.id); });
      }
      const onApp = (clientId: string) => {
        const c = clientMap.get(clientId);
        return !!c && !!c.profile_id && consented.has(c.profile_id);
      };
      const rows: AppAdoptionRow[] = members.map((m) => {
        const mine = rowsRaw.filter((r) => r.trainer_id === m.id && clientMap.has(r.client_id));
        const on = mine.filter((r) => onApp(r.client_id)).length;
        return { trainerId: m.id, trainerName: m.name, isManager: m.isManager, total: mine.length, onApp: on, notOnApp: mine.length - on };
      }).sort((a, b) => b.total - a.total);
      const totalClients = rows.reduce((s, r) => s + r.total, 0);
      const totalOnApp = rows.reduce((s, r) => s + r.onApp, 0);
      return { rows, totalClients, totalOnApp, pct: totalClients > 0 ? Math.round((totalOnApp / totalClients) * 100) : 0 };
    },
  });
}

// Managers leaderboard — verbatim port of the web useManagerLeaderboard:
// manager_score (default period = ongoing rows, else latest team_start) + month filter carved
// from the COMPETITION start (computeMonthRange) + get_manager_team_counts RPC + profiles.
// Aggregates exclude manager-flagged members; totalSessions = sessions + QHPs (web "Sess" figure);
// rank by weighted = combined*0.7 + referrals*0.3.
const mgrFmtDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function mgrMonthRange(periodStart: string, periodEnd: string | null, monthFilter: MgrMonthFilter): { start: string; end: string | null } {
  if (monthFilter === 'overall') return { start: periodStart, end: periodEnd };
  const startDate = new Date(periodStart + 'T00:00:00');
  const monthOffset = monthFilter === 'month1' ? 0 : monthFilter === 'month2' ? 1 : 2;
  const rangeStart = new Date(startDate.getFullYear(), startDate.getMonth() + monthOffset, 1);
  const rangeEnd = new Date(rangeStart.getFullYear(), rangeStart.getMonth() + 1, 0); // last day of month
  const startStr = mgrFmtDay(rangeStart);
  let endStr = mgrFmtDay(rangeEnd);
  if (periodEnd && endStr > periodEnd) endStr = periodEnd; // cap at period end
  if (startStr < periodStart) return { start: periodStart, end: endStr }; // don't go before period start
  return { start: startStr, end: endStr };
}
export function useManagerLeaderboard(monthFilter: MgrMonthFilter = 'overall') {
  return useQuery({
    queryKey: ['manager-leaderboard', 'v3', monthFilter], // v3: web-parity rework (object result, combined sessions, competition months)
    staleTime: 120_000,
    queryFn: async (): Promise<ManagerLeaderboard | null> => {
      const { data: allTeams, error } = await supabase.from('manager_score').select('*').order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      if (!allTeams || allTeams.length === 0) return null;

      const now = new Date().toISOString().slice(0, 10);
      let teams = (allTeams as any[]).filter((t) => !t.team_end || t.team_end >= now);
      if (teams.length === 0) {
        const latest = (allTeams as any[]).reduce((mx: string, t: any) => (t.team_start > mx ? t.team_start : mx), '');
        teams = (allTeams as any[]).filter((t) => t.team_start === latest);
      }
      if (teams.length === 0) return null;

      const memberIds = new Set<string>();
      for (const t of teams) {
        (Array.isArray(t.team_json) ? t.team_json : []).forEach((m: string) => memberIds.add(m));
        if (t.manager_id) memberIds.add(t.manager_id);
      }
      // All filtered teams share the same period (web takes it from the first row).
      const periodStart: string = teams[0].team_start;
      const periodEnd: string | null = teams[0].team_end || null;
      const { start: rpcStart, end: rpcEnd } = mgrMonthRange(periodStart, periodEnd, monthFilter);

      const { data: counts, error: cErr } = await supabase.rpc('get_manager_team_counts', {
        member_ids: [...memberIds],
        period_start: rpcStart,
        period_end: rpcEnd,
      });
      if (cErr) throw new Error(cErr.message);
      const cMap = new Map<string, { sessions: number; referrals: number; qhps: number }>();
      for (const r of (counts ?? []) as any[]) cMap.set(r.member_id, { sessions: Number(r.session_count) || 0, referrals: Number(r.referral_count) || 0, qhps: Number(r.qhp_count) || 0 });

      const { data: profs } = await supabase.from('profiles').select('id, first_name, last_name, managers, expected_sessions').in('id', [...memberIds]);
      const nameMap = new Map<string, string>();
      const isMgrMap = new Map<string, boolean>();
      const expectedMap = new Map<string, number | null>();
      (profs ?? []).forEach((p: any) => {
        nameMap.set(p.id, `${p.first_name ?? ''} ${p.last_name ?? ''}`.replace(/\s+/g, ' ').trim());
        isMgrMap.set(p.id, p.managers === true);
        expectedMap.set(p.id, p.expected_sessions ?? null);
      });

      const rows = teams.map((t) => {
        const members: string[] = Array.isArray(t.team_json) ? t.team_json : [];
        const all = t.manager_id ? [t.manager_id, ...members] : members;
        let sessions = 0, referrals = 0, qhps = 0;
        const memberRows: ManagerTeamMember[] = [];
        for (const id of all) {
          const c = cMap.get(id) || { sessions: 0, referrals: 0, qhps: 0 };
          const isMgr = isMgrMap.get(id) === true;
          memberRows.push({ id, name: nameMap.get(id) || 'Member', sessions: c.sessions, qhps: c.qhps, referrals: c.referrals, isManager: isMgr });
          if (isMgr) continue; // exclude manager-flagged from aggregates
          sessions += c.sessions; referrals += c.referrals; qhps += c.qhps;
        }
        memberRows.sort((a, b) => b.sessions - a.sessions); // web sorts the breakdown by raw sessions
        const combined = sessions + qhps; // web: totalSessions = sessions + QHPs
        return {
          managerId: t.manager_id,
          managerName: nameMap.get(t.manager_id) || t.team_name || 'Manager',
          teamName: t.team_name || nameMap.get(t.manager_id) || 'Team',
          teamSize: all.length,
          totalSessions: combined,
          rawSessions: sessions,
          qhpCount: qhps,
          referralsCount: referrals,
          members: memberRows,
          teamStart: t.team_start as string,
          teamEnd: (t.team_end || null) as string | null,
          expectedSessions: expectedMap.get(t.manager_id) ?? null,
          weighted: combined * 0.7 + referrals * 0.3,
        };
      });
      rows.sort((a, b) => b.weighted - a.weighted);
      const entries = rows.map(({ weighted, ...r }, i) => ({ ...r, rank: i + 1 }));

      const fmtLbl = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      const startD = new Date(periodStart + 'T00:00:00');
      const monthLabels = [0, 1, 2].map((off) => new Date(startD.getFullYear(), startD.getMonth() + off, 1).toLocaleDateString('en-GB', { month: 'short' })) as [string, string, string];
      return {
        entries,
        periodStart,
        periodEnd,
        periodLabel: periodEnd ? `${fmtLbl(periodStart)} – ${fmtLbl(periodEnd)}` : `${fmtLbl(periodStart)} – Present`,
        monthLabels,
      };
    },
  });
}

/* ---------- Plan expiry (web planExpiryUtils + usePlanExpiryStatus) ----------
   An approved workout plan is valid PLAN_EXPIRY_DAYS (42) days from approved_at;
   the final PLAN_EXPIRY_WARNING_DAYS (3) days are a warning. Per client we keep
   only the LATEST approved plan per normalized modality ("Strength Training" →
   "Strength"), exactly like the web hook. Client-level (not trainer-scoped) —
   session logging is blocked on the client's plan regardless of who approved it.
   Returns a plain Record (NOT a Map — Maps don't survive the persisted cache). */
export const PLAN_EXPIRY_WARNING_DAYS = 3; // PLAN_EXPIRY_DAYS (42) is declared with the team plan overview above
export type PlanExpiry = { modality: string; daysLeft: number; expired: boolean; expiringSoon: boolean };
export function usePlanExpiryMap(clientIds: (string | null)[]) {
  const ids = [...new Set(clientIds.filter(Boolean) as string[])].sort();
  return useQuery({
    queryKey: ['plan-expiry-map', ids.join(',')],
    enabled: ids.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<Record<string, PlanExpiry[]>> => {
      // workout_plan_exercises is one row per set — page past the 1000-row cap.
      const rows: any[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
          .from('workout_plan_exercises')
          .select('client_id, modality, approved_at')
          .in('client_id', ids)
          .eq('status', 'approved')
          .not('approved_at', 'is', null)
          .range(from, from + 999);
        if (error) throw new Error(error.message);
        rows.push(...(data ?? []));
        if (!data || data.length < 1000) break;
      }
      const latest = new Map<string, Map<string, string>>(); // client -> modality -> newest approved_at
      for (const r of rows) {
        if (!r.client_id || !r.approved_at) continue;
        const mod = r.modality === 'Strength Training' ? 'Strength' : (r.modality || 'Training');
        let m = latest.get(r.client_id);
        if (!m) { m = new Map(); latest.set(r.client_id, m); }
        const prev = m.get(mod);
        if (!prev || r.approved_at > prev) m.set(mod, r.approved_at);
      }
      const now = Date.now();
      const out: Record<string, PlanExpiry[]> = {};
      for (const id of ids) {
        const m = latest.get(id);
        if (!m) { out[id] = []; continue; } // [] ⇒ no approved plan at all
        out[id] = [...m.entries()]
          .map(([modality, at]) => {
            const expiry = new Date(at).getTime() + PLAN_EXPIRY_DAYS * 86400000;
            const daysLeft = Math.ceil((expiry - now) / 86400000);
            return { modality, daysLeft, expired: now > expiry, expiringSoon: daysLeft > 0 && daysLeft <= PLAN_EXPIRY_WARNING_DAYS };
          })
          .sort((a, b) => a.daysLeft - b.daysLeft); // most urgent first
      }
      return out;
    },
  });
}
