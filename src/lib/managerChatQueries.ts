import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { useAuth } from '../auth';
import { getIsOnline } from './offline';
import { invalidateDebounced } from './invalidateDebounced';

/* ============================================================================
   Managers Messenger — one chat thread per competition team (manager_score row).
   Spec: docs/managers-messenger-spec.md. The window/membership rules are enforced
   by RLS (supabase/manager_messenger_migration.sql); the UI states here mirror
   them, they don't implement them.
   ========================================================================== */

const fullName = (p: any) => `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.replace(/\s+/g, ' ').trim();

/* ---------- server-anchored clock ----------
   Device clocks drift (a test machine here ran a full DAY ahead), which made
   "tomorrow" differ between devices — plans saved under one date failed the
   add-only lock check on another. All messenger dates now come from serverNow():
   the Supabase REST Date header, sampled once per session (offset cached). */
let serverOffsetMs = 0;
let clockSynced = false;
export async function syncServerClock(): Promise<void> {
  if (clockSynced) return;
  try {
    const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
    const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
    if (!url) return;
    const r = await fetch(`${url}/rest/v1/`, { method: 'HEAD', headers: { apikey: key } });
    const d = r.headers.get('date');
    if (d) {
      serverOffsetMs = new Date(d).getTime() - Date.now();
      clockSynced = true;
    }
  } catch { /* offline: fall back to the device clock */ }
}
export const serverNow = () => new Date(Date.now() + serverOffsetMs);

const todayYmd = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(serverNow());

/* ---------- my current team (leaderboard's ongoing-else-latest rule) ---------- */
export type ManagerTeamMember = { id: string; name: string; role: string | null; isManager: boolean; avatarUrl?: string | null };
export type ManagerTeamInfo = {
  scoreId: string;
  teamName: string;
  managerId: string;
  isManager: boolean;
  start: string;
  end: string | null;
  active: boolean;      // today inside [start, end] — mirrors the RLS INSERT window
  daysLeft: number | null;
  pctElapsed: number;   // 0..100 for the competition progress bar
  members: ManagerTeamMember[];
};

export function useMyManagerTeam() {
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;
  return useQuery({
    queryKey: ['my-manager-team', uid],
    enabled: !!uid,
    staleTime: 120_000,
    queryFn: async (): Promise<ManagerTeamInfo | null> => {
      // EXACTLY the leaderboard's competition resolution (useManagerLeaderboard):
      // ongoing rows (team_end null or >= today), else the latest team_start batch.
      await syncServerClock(); // date logic below must not trust the device clock
      // Fetched via the messenger_teams() definer RPC: manager_score RLS does
      // not let doctor accounts read the table directly.
      const { data: rpcTeams, error } = await supabase.rpc('messenger_teams');
      if (error) throw new Error(error.message);
      const allTeams = (rpcTeams ?? []) as any[];
      if (!allTeams.length) return null;
      const today = todayYmd();
      let teams = (allTeams as any[]).filter((t) => !t.team_end || t.team_end >= today);
      if (!teams.length) {
        const latest = (allTeams as any[]).reduce((mx: string, t: any) => (t.team_start > mx ? t.team_start : mx), '');
        teams = (allTeams as any[]).filter((t) => t.team_start === latest);
      }
      const mine = teams.find((t) => t.manager_id === uid || (Array.isArray(t.team_json) && t.team_json.includes(uid)));
      if (!mine) return null;

      const ids = [...new Set([mine.manager_id, ...(Array.isArray(mine.team_json) ? mine.team_json : [])])].filter(Boolean) as string[];
      const { data: profs } = await supabase.from('profiles').select('id, first_name, last_name, role, avatar_url').in('id', ids);
      const members: ManagerTeamMember[] = ids.map((id) => {
        const p = (profs ?? []).find((x: any) => x.id === id);
        return { id, name: fullName(p) || 'Team member', role: p?.role ?? null, isManager: id === mine.manager_id, avatarUrl: p?.avatar_url ?? null };
      }).sort((a, b) => Number(b.isManager) - Number(a.isManager) || a.name.localeCompare(b.name));

      const start: string = mine.team_start;
      const end: string | null = mine.team_end || null;
      const active = start <= today && (!end || end >= today);
      const dayMs = 864e5;
      const endT = end ? new Date(end + 'T23:59:59+05:30').getTime() : null;
      const startT = new Date(start + 'T00:00:00+05:30').getTime();
      const daysLeft = endT ? Math.max(0, Math.ceil((endT - Date.now()) / dayMs)) : null;
      const pctElapsed = endT ? Math.max(0, Math.min(100, ((Date.now() - startT) / (endT - startT)) * 100)) : 0;
      return { scoreId: mine.id, teamName: mine.team_name || 'Team', managerId: mine.manager_id, isManager: mine.manager_id === uid, start, end, active, daysLeft, pctElapsed, members };
    },
  });
}

/* ---------- messages ---------- */
// schedule_id/roster arrive from plan_sync_roster: the entry's linked
// session_schedule row and how it got there ('created' | 'linked' | 'moved' | 'conflict').
export type TomorrowPlanEntry = { client_id: string | null; name: string; time: string; modality?: string | null; schedule_id?: string | null; roster?: string | null }; // time 'HH:mm'

/* Modality options per role + normalizer for the mixed-case session_type values
   that exist in training_sessions ('Strength', 'strength', 'recovery', …). */
export const TRAINER_MODALITIES = ['Strength', 'Aerobics', 'Aqua Aerobics', 'Boxing', 'Yoga', 'Pilates', 'Other'];
export const DOCTOR_MODALITIES = ['Rehabilitation', 'Recovery', 'Physiotherapy'];
export const THERAPIST_MODALITIES = ['Therapy']; // fixed for therapist sessions
/* Doctor-LIKE members: their crew sections belong to the physio HOD (manager
   is view-only). Therapists get the exact doctor treatment. */
export const isHodManagedRole = (role: string | null | undefined): boolean =>
  role === 'doctor' || role === 'therapist';
export const normalizeModality = (v: string | null | undefined): string | null => {
  if (!v) return null;
  const k = v.trim().toLowerCase();
  const MAP: Record<string, string> = {
    strength: 'Strength', boxing: 'Boxing', yoga: 'Yoga', pilates: 'Pilates', aerobics: 'Aerobics',
    'aqua aerobics': 'Aqua Aerobics', recovery: 'Recovery', rehabilitation: 'Rehabilitation',
    physiotherapy: 'Physiotherapy', therapy: 'Therapy', other: 'Other',
  };
  return MAP[k] ?? v.trim().replace(/\b\w/g, (c) => c.toUpperCase());
};
export type TeamFlagClient = {
  client_id: string | null;
  name: string;
  sessions_per_week: number;
  modality?: string | null;
  gap_days: number;
};
// remark* fields: the manager's mandatory closing remark per trainer block —
// written by updating the message payload in place (RLS: manager, team_flags only).
// Edits keep every prior version in remark_history (durable trail inside the
// payload); the UI shows only the latest remark with an EDITED tag.
export type TeamFlagRemarkVersion = { remark: string; by?: string | null; at?: string | null };
export type TeamFlagTrainer = {
  trainer_id: string;
  trainer_name: string;
  clients: TeamFlagClient[];
  remark?: string | null;
  remark_by?: string | null;
  remark_at?: string | null;
  remark_history?: TeamFlagRemarkVersion[];
  closed?: boolean;
};
export type PlanRescheduleHop = {
  from_time?: string; to_time?: string;
  from_modality?: string | null; to_modality?: string | null;
  remark?: string | null; by?: string | null; at?: string;
};
export type ManagerChatMessage = {
  id: string;
  teamId?: string; // present on cross-team HOD feed messages
  senderId: string;
  senderName: string;
  senderRole: string | null;
  // plan_add (manager-only): {date, client_id, name, trainer_id, time, modality,
  //   schedule_id} — a session the MANAGER added into a member's day.
  // team_flags (manager-only, cron-posted at 7 PM IST): {date, flags:[{trainer_id,
  //   trainer_name, clients:[{client_id, name, sessions_per_week, modality, gap_days}]}]}
  kind: 'text' | 'tomorrow_plan' | 'plan_remark' | 'plan_time_edit' | 'plan_reschedule_request' | 'plan_reschedule_decision' | 'plan_add' | 'team_flags' | 'session_update';
  // tomorrow_plan: {date, entries}. plan_remark: {date, client_id, name, trainer_id, remark}.
  // plan_time_edit: {date, client_id, name, trainer_id, time} — manager reschedules a member's plan entry.
  // plan_time_edit also carries `history`: the cumulative reschedule chain for
  // that entry (session_schedule keeps only the LATEST approval — the immutable
  // message payload is the durable history).
  // plan_reschedule_request (member): {date, client_id, name, trainer_id, schedule_id,
  //   from_time, to_time, from_modality, to_modality, reason} — PENDING until the manager acts.
  // Approval = a plan_time_edit carrying request_id; rejection = plan_reschedule_decision
  //   {request_id, approved:false} (manager-only kind).
  // reply_to (kind 'text'): WhatsApp-style quoted reply — { id, name, body } of
  // the original message (body truncated to 120 chars). Interop with iOS.
  payload: { date?: string; entries?: TomorrowPlanEntry[]; client_id?: string | null; name?: string; trainer_id?: string; remark?: string; time?: string; modality?: string | null; schedule_id?: string | null; history?: PlanRescheduleHop[]; request_id?: string; approved?: boolean; from_time?: string; to_time?: string; from_modality?: string | null; to_modality?: string | null; reason?: string; flags?: TeamFlagTrainer[]; reply_to?: { id: string; name: string; body: string } } | null;
  body: string;
  createdAt: string;
  /** Screen-local: a send that failed (offline / rejected) — rendered with a Retry. Never from the server. */
  _failed?: boolean;
};

export function useManagerTeamMessages(scoreId: string | null) {
  return useQuery({
    queryKey: ['manager-chat', scoreId],
    enabled: !!scoreId,
    staleTime: 15_000,
    refetchInterval: 60_000, // belt-and-braces; realtime is the fast path
    queryFn: async (): Promise<ManagerChatMessage[]> => {
      const { data, error } = await supabase
        .from('manager_team_messages')
        .select('id, sender_id, kind, payload, body, created_at')
        .eq('team_id', scoreId)
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message);
      const rows = (data ?? []).reverse();
      const senderIds = [...new Set(rows.map((m: any) => m.sender_id))];
      const profById = new Map<string, any>();
      if (senderIds.length) {
        const { data: profs } = await supabase.from('profiles').select('id, first_name, last_name, role').in('id', senderIds);
        (profs ?? []).forEach((p: any) => profById.set(p.id, p));
      }
      return rows.map((m: any) => {
        const p = profById.get(m.sender_id);
        return {
          id: m.id,
          senderId: m.sender_id,
          senderName: fullName(p) || 'Team member',
          senderRole: p?.role ?? null,
          kind: ['tomorrow_plan', 'plan_remark', 'plan_time_edit', 'plan_reschedule_request', 'plan_reschedule_decision', 'plan_add', 'team_flags', 'session_update'].includes(m.kind) ? m.kind : 'text',
          payload: m.payload ?? null,
          body: m.body ?? '',
          createdAt: m.created_at,
        };
      });
    },
  });
}

/* Realtime: new messages in THIS thread refresh the list. postgres_changes only —
   the subscriber's RLS SELECT policy is enforced server-side per change (WALRUS);
   the team_id filter is convenience, not the security boundary.
   `tag` keeps channel names unique per consumer (home card + chat screen can be
   mounted at the same moment during a transition; duplicate topics won't join). */
export function useManagerChatRealtime(scoreId: string | null, tag: string = 'screen') {
  const qc = useQueryClient();
  React.useEffect(() => {
    if (!scoreId) return;
    const ch = supabase
      .channel(`manager-chat-${tag}-${scoreId}`)
      // UPDATE: team_flags remarks are payload updates in place — members see
      // the manager's remark land live.
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'manager_team_messages', filter: `team_id=eq.${scoreId}` }, () => {
        invalidateDebounced(qc, ['manager-chat', scoreId], 400);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'manager_team_messages', filter: `team_id=eq.${scoreId}` }, (payload: any) => {
        invalidateDebounced(qc, ['manager-chat', scoreId], 400);
        const kind = payload?.new?.kind;
        if (kind === 'tomorrow_plan' || kind === 'plan_time_edit') {
          // These messages always ride along a session_schedule write — refresh
          // every roster surface in real time (dashboard Today's Sessions,
          // roster sheets, doctor + CRM calendars). Debounced app-wide so the
          // overlapping HOD / card / screen subscriptions cost one refetch each.
          ['mgr-plan-sched', 'trainer-roster', 'doctor-roster', 'crm-month-roster', 'crm-client-roster'].forEach((k) => invalidateDebounced(qc, [k]));
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [scoreId, tag, qc]);
}

/* ---------- send (optimistic, network-retry) ----------
   Network-class insert failures retry automatically (5 attempts, 1.5s → 3s →
   6s → 10s → 10s backoff) while the optimistic bubble stays visible; server
   rejections (RLS/constraint) fail immediately with no retry. */
const NET_ERR = /network|fetch|timeout|connection|socket|abort/i;
const SEND_BACKOFF_MS = [1500, 3000, 6000, 10000, 10000];
export function useSendManagerTeamMessage(meId: string | null | undefined, meName: string, meRole: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { scoreId: string; body: string; kind?: ManagerChatMessage['kind']; payload?: any }) => {
      if (!meId) throw new Error('Not signed in');
      if (!input.body.trim()) throw new Error('Message is empty');
      // Fail fast while offline: the 30 s retry loop froze the composer (every
      // action is disabled on isPending) and then lost the message anyway. The
      // screen keeps the failed bubble with a Retry instead.
      if (!getIsOnline()) throw new Error("You're offline. Reconnect and tap the message to retry.");
      let lastErr: any = null;
      for (let attempt = 0; attempt <= SEND_BACKOFF_MS.length; attempt++) {
        if (attempt > 0 && !getIsOnline()) throw lastErr ?? new Error("You're offline. Reconnect and tap the message to retry.");
        try {
          const { error } = await supabase.from('manager_team_messages').insert({
            team_id: input.scoreId,
            sender_id: meId,
            kind: input.kind ?? 'text',
            payload: input.payload ?? null,
            body: input.body.trim(),
          });
          if (error) throw new Error(error.message);
          return;
        } catch (e: any) {
          lastErr = e;
          const retriable = NET_ERR.test(String(e?.message ?? e));
          if (!retriable || attempt === SEND_BACKOFF_MS.length) throw e;
          await new Promise((res) => setTimeout(res, SEND_BACKOFF_MS[attempt]));
        }
      }
      throw lastErr;
    },
    onMutate: async (input) => {
      const key = ['manager-chat', input.scoreId];
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<ManagerChatMessage[]>(key);
      const temp: ManagerChatMessage = {
        id: `temp-${Date.now()}`,
        senderId: meId ?? '',
        senderName: meName || 'You',
        senderRole: meRole,
        kind: input.kind ?? 'text',
        payload: input.payload ?? null,
        body: input.body.trim(),
        createdAt: new Date().toISOString(),
      };
      qc.setQueryData<ManagerChatMessage[]>(key, (old) => [...(old ?? []), temp]);
      return { prev, key };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev); },
    onSettled: (_d, _e, v) => qc.invalidateQueries({ queryKey: ['manager-chat', v.scoreId] }),
  });
}

/* ---------- unread without a second table: on-device last-read marker ----------
   The marker stores the SERVER timestamp of the newest message seen (never the
   device clock — a device running fast would silently swallow fresh unreads),
   and comparisons go through Date.parse so the DB's '+00:00' format and JS
   'Z' format compare numerically, not as strings. */
const lastReadKey = (scoreId: string) => `mgr-chat:last-read:${scoreId}`;
export async function markManagerChatRead(scoreId: string, upToCreatedAt?: string | null) {
  try { await AsyncStorage.setItem(lastReadKey(scoreId), upToCreatedAt ?? new Date().toISOString()); } catch { /* best-effort */ }
}
export function useManagerChatUnread(scoreId: string | null, meId: string | null | undefined) {
  const msgsQ = useManagerTeamMessages(scoreId);
  const [lastRead, setLastRead] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!scoreId) return;
    AsyncStorage.getItem(lastReadKey(scoreId)).then(setLastRead).catch(() => {});
  }, [scoreId, msgsQ.dataUpdatedAt]);
  const lastReadMs = lastRead ? Date.parse(lastRead) : 0;
  const unread = (msgsQ.data ?? []).filter((m) => m.senderId !== meId && Date.parse(m.createdAt) > lastReadMs).length;
  return { unread, lastMessage: (msgsQ.data ?? [])[msgsQ.data ? msgsQ.data.length - 1 : 0] ?? null };
}

/* ---------- "Tomorrow's Plan" compose data ----------
   session_schedule is the SOURCE OF TRUTH: every non-cancelled tomorrow-IST slot
   of mine becomes a pre-selected row with its real time — whether or not the
   client is in my actively-training book. Book clients without a slot follow as
   manually-selectable extras. */
export type TomorrowComposeRow = { clientId: string; name: string; slotTime: string | null; scheduled: boolean; lastModality: string | null }; // slotTime 'HH:mm' IST
export function useTomorrowCompose(open: boolean) {
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;
  const tomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(serverNow().getTime() + 864e5));
  return useQuery({
    queryKey: ['mgr-chat-tomorrow-v2', uid, tomorrow],
    enabled: open && !!uid,
    staleTime: 30_000,
    queryFn: async (): Promise<{ date: string; rows: TomorrowComposeRow[] }> => {
      const d90 = new Date(Date.now() - 90 * 864e5).toISOString();
      const [slotsR, bookR, histR] = await Promise.all([
        supabase.from('session_schedule')
          .select('client_id, scheduled_datetime, status, clients:client_id(id, first_name, last_name)')
          .eq('trainer_id', uid)
          .gte('scheduled_datetime', `${tomorrow}T00:00:00+05:30`)
          .lte('scheduled_datetime', `${tomorrow}T23:59:59+05:30`)
          .neq('status', 'cancelled')
          .order('scheduled_datetime', { ascending: true }),
        supabase.from('trainer_clients').select('client_id, clients:client_id(id, first_name, last_name, status)').eq('trainer_id', uid).eq('actively_training', true),
        // Modality prefill: this trainer's most recent session_type per client (90d)
        supabase.from('training_sessions')
          .select('client_id, session_type, scheduled_at')
          .eq('trainer_id', uid)
          .gte('scheduled_at', d90)
          .order('scheduled_at', { ascending: false })
          .limit(1000),
      ]);
      if (slotsR.error) throw new Error(slotsR.error.message);
      if (bookR.error) throw new Error(bookR.error.message);
      const lastModByClient = new Map<string, string>();
      (histR.data ?? []).forEach((r: any) => {
        if (!r.client_id || lastModByClient.has(r.client_id)) return; // desc order → first seen = latest
        const m = normalizeModality(r.session_type);
        if (m) lastModByClient.set(r.client_id, m);
      });
      const emb = (v: any) => (Array.isArray(v) ? v[0] : v); // embed shape can vary by relationship
      const hm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
      const rows: TomorrowComposeRow[] = [];
      const seen = new Set<string>();
      (slotsR.data ?? []).forEach((s: any) => {
        if (!s.client_id || seen.has(s.client_id)) return; // earliest slot wins
        seen.add(s.client_id);
        const c = emb(s.clients);
        rows.push({ clientId: s.client_id, name: fullName(c) || 'Client', slotTime: hm.format(new Date(s.scheduled_datetime)), scheduled: true, lastModality: lastModByClient.get(s.client_id) ?? null });
      });
      (bookR.data ?? []).forEach((r: any) => {
        const c = emb(r.clients);
        if (!c?.id || seen.has(c.id)) return;
        if (['inactive', 'discontinued'].includes((c.status ?? '').toLowerCase())) return;
        seen.add(c.id);
        rows.push({ clientId: c.id, name: fullName(c) || 'Client', slotTime: null, scheduled: false, lastModality: lastModByClient.get(c.id) ?? null });
      });
      rows.sort((a, b) =>
        a.scheduled && !b.scheduled ? -1 : !a.scheduled && b.scheduled ? 1 :
        a.scheduled ? (a.slotTime!.localeCompare(b.slotTime!) || a.name.localeCompare(b.name)) : a.name.localeCompare(b.name));
      return { date: tomorrow, rows };
    },
  });
}

/* ---------- Plan outcome: which claimed sessions actually happened ----------
   Derived-only, computed on every viewer's device (trainers can read other
   trainers' training_sessions rows — probed live). A claim counts as DONE when
   the SECTION OWNER has a completed, non-cancelled training_sessions row for
   that client on the plan's IST date — time-flexible but TRAINER-SCOPED: a
   client can have a trainer session AND a doctor (physio) session on the same
   day, so another member's log must never tick this member's row. (The v2
   trainer-agnostic map did exactly that — a trainer's workout showed 'logged'
   on the doctor's session.) The map is keyed `${trainerId}:${clientId}`. */
export const istToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(serverNow());
export function usePlanOutcome(date: string | undefined, clientIds: string[], enabled: boolean, live: boolean) {
  return useQuery({
    // v5: reads via the crew_plan_outcome DEFINER RPC (direct training_sessions
    // selects are RLS-scoped to YOUR OWN clients). Map value gained the client
    // ACK flag: `${trainerId}:${clientId}` -> { time: 'HH:mm', acked } — acked
    // null until the crew_outcome_ack.sql migration is live.
    queryKey: ['mgr-plan-outcome-v5', date, [...clientIds].sort().join(',')],
    enabled: enabled && !!date && clientIds.length > 0,
    staleTime: 60_000,
    refetchInterval: live ? 120_000 : false, // keeps today's card updating as sessions get logged
    queryFn: async (): Promise<Record<string, PlanOutcomeInfo>> => {
      const { data, error } = await supabase.rpc('crew_plan_outcome', { p_date: date, p_clients: [...new Set(clientIds)] });
      if (error) throw new Error(error.message);
      const hm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
      const done: Record<string, PlanOutcomeInfo> = {};
      ((data ?? []) as any[]).forEach((r: any) => {
        if (!(r.client_id && r.trainer_id && r.at)) return;
        const key = `${r.trainer_id}:${r.client_id}`;
        const t = hm.format(new Date(r.at));
        if (!done[key] || t < done[key].time) done[key] = { time: t, acked: typeof r.acked === 'boolean' ? r.acked : null };
      });
      return done;
    },
  });
}
export type PlanOutcomeInfo = { time: string; acked: boolean | null };

/* ---------- A member's client book (for the manager's Add Session picker) ----------
   Trainers can read other trainers' trainer_clients rows (verified live). */
export function useMemberClients(trainerId: string | null, open: boolean) {
  return useQuery({
    queryKey: ['mgr-member-clients', trainerId],
    enabled: open && !!trainerId,
    staleTime: 120_000,
    queryFn: async (): Promise<{ clientId: string; name: string }[]> => {
      const { data, error } = await supabase
        .from('trainer_clients')
        .select('client_id, clients:client_id(id, first_name, last_name, status)')
        .eq('trainer_id', trainerId)
        .eq('actively_training', true);
      if (error) throw new Error(error.message);
      const emb = (v: any) => (Array.isArray(v) ? v[0] : v);
      return (data ?? [])
        .map((r: any) => emb(r.clients))
        .filter((c: any) => c?.id && !['inactive', 'discontinued'].includes((c.status ?? '').toLowerCase()))
        .map((c: any) => ({ clientId: c.id, name: fullName(c) || 'Client' }))
        .sort((a: any, b: any) => a.name.localeCompare(b.name));
    },
  });
}

/* ---------- Live roster rows for plan cards ----------
   The card displays time/modality/status FROM session_schedule (source of
   truth) for every linked entry — the frozen message payload is only the
   fallback for legacy/unlinked entries. Plain object, never a Map (RQ persist). */
export type PlanSchedRow = {
  time: string; modality: string | null; status: string | null;
  // THIS exact roster session got logged (workout_session_id back-link) — the
  // most precise done-signal, immune to same-day sessions by other members.
  logged: boolean;
  // Latest session_schedule.missed_remarks entry (trainer logs it from the
  // Today's Roster "Missed Remark" flow) — Team Messenger displays it.
  missedRemark: { remark: string; category: string | null; by_name: string | null; by_role: string | null; at: string | null } | null;
};
export function usePlanScheduleRows(ids: string[], intervalMs: number | false) {
  const key = [...ids].sort().join(',');
  return useQuery({
    // 'v3': reads via the crew_sched_rows DEFINER RPC — direct session_schedule
    // selects are RLS-scoped to your own rows, so teammates' linked entries were
    // invisible (times fell back to the frozen payload, logged/missed remarks
    // never showed cross-member). First key element stays 'mgr-plan-sched'
    // (invalidation prefix used app-wide).
    queryKey: ['mgr-plan-sched', 'v3', key],
    enabled: ids.length > 0,
    staleTime: 30_000,
    refetchInterval: intervalMs,
    queryFn: async (): Promise<Record<string, PlanSchedRow>> => {
      const { data, error } = await supabase.rpc('crew_sched_rows', { p_ids: [...new Set(ids)] });
      if (error) throw new Error(error.message);
      const hm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
      const out: Record<string, PlanSchedRow> = {};
      Object.entries((data ?? {}) as Record<string, any>).forEach(([id, r]: [string, any]) => {
        const arr = Array.isArray(r.missed_remarks) ? r.missed_remarks : [];
        const last = arr.length ? arr[arr.length - 1] : null;
        out[id] = {
          time: hm.format(new Date(r.scheduled_datetime)),
          modality: normalizeModality(r.modality),
          status: r.status ?? null,
          logged: !!r.logged,
          missedRemark: last?.remark ? { remark: String(last.remark), category: last.category ?? null, by_name: last.by_name ?? null, by_role: last.by_role ?? null, at: last.at ?? null } : null,
        };
      });
      return out;
    },
  });
}

/* Plain-text fallback body for a tomorrow_plan message (readable anywhere). */
export const fmt12h = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
export function tomorrowPlanBody(date: string, entries: TomorrowPlanEntry[]): string {
  const day = new Date(date + 'T12:00:00Z').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  return `Tomorrow's plan (${day}): ` + entries.map((e) => `${e.name} ${fmt12h(e.time)}`).join(' · ');
}

/* ============ Physio HOD (doctor sessions authority) ============
   profiles.role_specialization containing 'physio_hod' marks the HOD. She is
   not a team member: her surface is the Physio Day Plans screen; her actions
   go through SECURITY DEFINER RPCs (supabase/physio_hod_migration.sql). In the
   team card, doctor sections are HOD territory — the manager is view-only. */
export function usePhysioHod() {
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;
  return useQuery({
    queryKey: ['physio-hod-identity', uid],
    enabled: !!uid,
    staleTime: 600_000,
    queryFn: async (): Promise<{ hodId: string | null; meIsHod: boolean }> => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, role_specialization')
        .eq('role', 'doctor')
        .not('role_specialization', 'is', null);
      if (error) throw new Error(error.message);
      const hod = (data ?? []).find((p: any) => JSON.stringify(p.role_specialization ?? '').toLowerCase().includes('physio_hod'));
      return { hodId: hod?.id ?? null, meIsHod: hod?.id === uid };
    },
  });
}

export type HodSessionRow = {
  scheduleId: string;
  trainerId: string;
  clientId: string | null;
  clientName: string;
  datetime: string;
  time: string;         // 'HH:mm' IST
  modality: string | null;
  status: string | null;
  logged: boolean;      // workout_session_id set — session completed
  missedRemark: { remark: string; category: string | null; by_name: string | null; by_role: string | null } | null;
};
export type HodDoctorSection = { doctorId: string; doctorName: string; sessions: HodSessionRow[] };
export type HodRequest = {
  messageId: string; teamId: string; senderId: string;
  payload: NonNullable<ManagerChatMessage['payload']>;
  createdAt: string;
};
export type HodFlagBlock = { messageId: string; teamId: string; date: string | null; trainer: TeamFlagTrainer };
export function usePhysioHodBoard(open: boolean) {
  return useQuery({
    queryKey: ['physio-hod-board'],
    enabled: open,
    staleTime: 60_000,
    refetchInterval: open ? 120_000 : false,
    queryFn: async (): Promise<{ physios: { id: string; name: string }[]; today: HodDoctorSection[]; tomorrow: HodDoctorSection[]; requests: HodRequest[]; flags: HodFlagBlock[] }> => {
      const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
      const today = ymd(new Date());
      const tomorrow = ymd(new Date(Date.now() + 864e5));
      const hm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
      const { data: physios, error: pErr } = await supabase
        .from('profiles')
        .select('id, first_name, last_name')
        .eq('role', 'doctor')
        .eq('doctor_specialization_tag', 'physiotherapist');
      if (pErr) throw new Error(pErr.message);
      const physioList = (physios ?? []).map((p: any) => ({ id: p.id, name: fullName(p) || 'Doctor' }));
      const ids = physioList.map((p) => p.id);
      if (!ids.length) return { physios: [], today: [], tomorrow: [], requests: [], flags: [] };

      // Roster truth: the doctors' sessions for today + tomorrow (IST).
      const { data: sess, error: sErr } = await supabase
        .from('session_schedule')
        .select('id, trainer_id, client_id, scheduled_datetime, modality, status, workout_session_id, missed_remarks, clients:client_id(first_name, last_name)')
        .in('trainer_id', ids)
        .gte('scheduled_datetime', `${today}T00:00:00+05:30`)
        .lte('scheduled_datetime', `${tomorrow}T23:59:59+05:30`)
        .order('scheduled_datetime', { ascending: true });
      if (sErr) throw new Error(sErr.message);
      const emb = (v: any) => (Array.isArray(v) ? v[0] : v);
      const toRow = (r: any): HodSessionRow => {
        const arr = Array.isArray(r.missed_remarks) ? r.missed_remarks : [];
        const last = arr.length ? arr[arr.length - 1] : null;
        const c = emb(r.clients);
        return {
          scheduleId: r.id, trainerId: r.trainer_id, clientId: r.client_id ?? null,
          clientName: fullName(c) || 'Client',
          datetime: r.scheduled_datetime, time: hm.format(new Date(r.scheduled_datetime)),
          modality: normalizeModality(r.modality), status: r.status ?? null,
          logged: !!r.workout_session_id,
          missedRemark: last?.remark ? { remark: String(last.remark), category: last.category ?? null, by_name: last.by_name ?? null, by_role: last.by_role ?? null } : null,
        };
      };
      const rows = (sess ?? []).filter((r: any) => r.status !== 'cancelled').map(toRow);
      const dayOf = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(iso));
      const group = (day: string): HodDoctorSection[] =>
        physioList
          .map((p) => ({ doctorId: p.id, doctorName: p.name, sessions: rows.filter((r) => r.trainerId === p.id && dayOf(r.datetime) === day) }))
          .filter((s) => s.sessions.length > 0);

      // Pending doctor reschedule requests across ALL team threads (HOD read
      // policy). Status derives from any later message carrying request_id.
      const d7 = new Date(Date.now() - 7 * 864e5).toISOString();
      const { data: msgs } = await supabase
        .from('manager_team_messages')
        .select('id, team_id, sender_id, kind, payload, created_at')
        .in('kind', ['plan_reschedule_request', 'plan_reschedule_decision', 'plan_time_edit', 'team_flags'])
        .gte('created_at', d7)
        .order('created_at', { ascending: true });
      const acted = new Set<string>();
      (msgs ?? []).forEach((m: any) => { const rid = m.payload?.request_id; if (rid) acted.add(rid); });
      const requests: HodRequest[] = (msgs ?? [])
        .filter((m: any) => m.kind === 'plan_reschedule_request' && ids.includes(m.payload?.trainer_id) && !acted.has(m.id))
        .map((m: any) => ({ messageId: m.id, teamId: m.team_id, senderId: m.sender_id, payload: m.payload ?? {}, createdAt: m.created_at }));

      // Doctor blocks from Team Flags cards (7 PM cron): the HOD closes these
      // with a remark; open blocks first, newest cards last within each state.
      const flags: HodFlagBlock[] = (msgs ?? [])
        .filter((m: any) => m.kind === 'team_flags')
        .flatMap((m: any) => ((m.payload?.flags ?? []) as TeamFlagTrainer[])
          .filter((t) => ids.includes(t.trainer_id))
          .map((t) => ({ messageId: m.id, teamId: m.team_id, date: m.payload?.date ?? null, trainer: t })))
        .sort((a, b) => Number(!!a.trainer.remark) - Number(!!b.trainer.remark));

      return { physios: physioList, today: group(today), tomorrow: group(tomorrow), requests, flags };
    },
  });
}

/* ---------- Weekly protocol chips (clients.weekly_protocol) ----------
   Batch-fetch for every visible client id; the column can arrive as jsonb OR a
   json STRING (older CRM writes) — parse both. Only clients with entries get a
   chip. Plain objects only (RQ persist).
   Protocol v2 (Aug 2026): entries carry `frequency` 'weekly'|'monthly' (monthly
   only for doctor-led Rehab/Recovery; days always [] for monthly). The legacy
   combined modality 'Rehab / Recovery' displays as 'Rehab'. total_per_week can
   be fractional (monthly entries count divided by 4). */
export const protoModalityLabel = (m: string | null | undefined): string | null =>
  m === 'Rehab / Recovery' ? 'Rehab' : (m ?? null);
export type ProtocolEntry = { days?: string[] | null; modality?: string | null; trainer_name?: string | null; sessions_per_week?: number | null; monthly_session_count?: number | null; frequency?: string | null };
export type ClientProtocol = { entries: ProtocolEntry[]; total_per_week: number | null; total_per_month: number | null };
/* An entry's session count: monthly entries store `monthly_session_count`
   (transitional v2 rows stored monthly counts in sessions_per_week — fall back). */
export const protoEntryCount = (e: ProtocolEntry): number =>
  e.frequency === 'monthly'
    ? (e.monthly_session_count ?? e.sessions_per_week ?? 0)
    : (e.sessions_per_week ?? 0);
export function useClientProtocols(clientIds: string[]) {
  const key = [...new Set(clientIds)].sort().join(',');
  return useQuery({
    // v3: monthly entries keyed by monthly_session_count + total_per_month at top level.
    queryKey: ['mgr-client-protocols-v3', key],
    enabled: clientIds.length > 0,
    staleTime: 300_000,
    queryFn: async (): Promise<Record<string, ClientProtocol>> => {
      const ids = [...new Set(clientIds)];
      const { data, error } = await supabase.from('clients').select('id, weekly_protocol').in('id', ids);
      if (error) throw new Error(error.message);
      const out: Record<string, ClientProtocol> = {};
      (data ?? []).forEach((r: any) => {
        let wp = r.weekly_protocol;
        if (typeof wp === 'string') { try { wp = JSON.parse(wp); } catch { wp = null; } }
        const entries: ProtocolEntry[] = Array.isArray(wp?.entries)
          ? wp.entries
              .map((e: any) => ({
                ...e,
                modality: protoModalityLabel(e.modality),
                frequency: e.frequency === 'monthly' ? 'monthly' : 'weekly',
              }))
              .filter((e: any) => protoEntryCount(e) > 0)
          : [];
        if (!entries.length) return;
        out[r.id] = { entries, total_per_week: wp?.total_per_week ?? null, total_per_month: wp?.total_per_month ?? null };
      });
      return out;
    },
  });
}

/* ---------- HOD team resolution: every current team containing a doctor ----------
   The physios sit in DIFFERENT teams, so the HOD's Team Messenger carries a
   team switcher: same chat UI, one thread per selected team, isManager=false
   (her authority is per-section, doctor sections only). */
export function useHodTeams(enabled: boolean) {
  return useQuery({
    queryKey: ['hod-teams'],
    enabled,
    staleTime: 300_000,
    queryFn: async (): Promise<ManagerTeamInfo[]> => {
      const { data: rpcTeams, error } = await supabase.rpc('messenger_teams');
      if (error) throw new Error(error.message);
      const today = todayYmd();
      const teams = ((rpcTeams ?? []) as any[]).filter((t: any) => !t.team_end || t.team_end >= today);
      if (!teams.length) return [];
      const allIds = [...new Set(teams.flatMap((t: any) => [t.manager_id, ...(Array.isArray(t.team_json) ? t.team_json : [])]))].filter(Boolean) as string[];
      const { data: profs } = await supabase.from('profiles').select('id, first_name, last_name, role, avatar_url').in('id', allIds);
      const profById = new Map((profs ?? []).map((p: any) => [p.id, p]));
      const out: ManagerTeamInfo[] = [];
      for (const t of teams as any[]) {
        const ids = [...new Set([t.manager_id, ...(Array.isArray(t.team_json) ? t.team_json : [])])].filter(Boolean) as string[];
        const members: ManagerTeamMember[] = ids.map((id) => {
          const p = profById.get(id) as any;
          return { id, name: fullName(p) || 'Team member', role: p?.role ?? null, isManager: id === t.manager_id, avatarUrl: p?.avatar_url ?? null };
        }).sort((a, b) => Number(b.isManager) - Number(a.isManager) || a.name.localeCompare(b.name));
        if (!members.some((m) => isHodManagedRole(m.role))) continue;
        const start: string = t.team_start;
        const end: string | null = t.team_end || null;
        const active = start <= today && (!end || end >= today);
        const endT = end ? new Date(end + 'T23:59:59+05:30').getTime() : null;
        const startT = new Date(start + 'T00:00:00+05:30').getTime();
        out.push({
          scoreId: t.id, teamName: t.team_name || 'Team', managerId: t.manager_id, isManager: false,
          start, end, active,
          daysLeft: endT ? Math.max(0, Math.ceil((endT - Date.now()) / 864e5)) : null,
          pctElapsed: endT ? Math.max(0, Math.min(100, ((Date.now() - startT) / (endT - startT)) * 100)) : 0,
          members,
        });
      }
      return out.sort((a, b) => a.teamName.localeCompare(b.teamName));
    },
  });
}

/* ---------- HOD combined feed: one query across every doctor-containing team ----------
   Single unfiltered realtime channel: WALRUS delivers only rows the HOD may
   read (all, via her read arm), so one subscription covers every team. */
export function useHodFeedMessages(teamIds: string[], enabled: boolean) {
  const qc = useQueryClient();
  const key = [...teamIds].sort().join(',');
  const q = useQuery({
    queryKey: ['hod-feed-msgs', key],
    enabled: enabled && teamIds.length > 0,
    staleTime: 20_000,
    refetchInterval: enabled ? 60_000 : false,
    queryFn: async (): Promise<ManagerChatMessage[]> => {
      const d3 = new Date(serverNow().getTime() - 3 * 864e5).toISOString();
      const { data, error } = await supabase.from('manager_team_messages')
        .select('id, team_id, sender_id, kind, payload, body, created_at')
        .in('team_id', teamIds)
        .in('kind', ['tomorrow_plan', 'plan_add', 'plan_time_edit', 'plan_reschedule_request', 'plan_reschedule_decision'])
        .gte('created_at', d3)
        .order('created_at', { ascending: true });
      if (error) throw new Error(error.message);
      const senderIds = [...new Set((data ?? []).map((m: any) => m.sender_id))];
      let profById = new Map<string, any>();
      if (senderIds.length) {
        const { data: profs } = await supabase.from('profiles').select('id, first_name, last_name, role').in('id', senderIds);
        profById = new Map((profs ?? []).map((p: any) => [p.id, p]));
      }
      return (data ?? []).map((m: any) => ({
        id: m.id, teamId: m.team_id, senderId: m.sender_id,
        senderName: fullName(profById.get(m.sender_id)) || 'Team member',
        senderRole: profById.get(m.sender_id)?.role ?? null,
        kind: ['tomorrow_plan', 'plan_add', 'plan_time_edit', 'plan_reschedule_request', 'plan_reschedule_decision'].includes(m.kind) ? m.kind : 'text',
        payload: m.payload ?? null, body: m.body ?? '', createdAt: m.created_at,
      })) as ManagerChatMessage[];
    },
  });
  React.useEffect(() => {
    if (!enabled) return;
    // ONE subscription for the whole HOD view: it also refreshes every per-team
    // chat cache (prefix), so the per-team cards no longer open their own channels.
    const ch = supabase.channel('hod-feed-all')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'manager_team_messages' }, () => {
        invalidateDebounced(qc, ['hod-feed-msgs'], 400);
        invalidateDebounced(qc, ['manager-chat'], 400);
        invalidateDebounced(qc, ['mgr-plan-sched']);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [enabled, qc]);
  return q;
}
