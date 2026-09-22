import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { useAuth } from '../auth';
import { uuidv4 } from './clientQueries';
import { withTimeout, uploadWithTimeout, NET_MS } from './withTimeout';
import { invalidateDebounced } from './invalidateDebounced';
import {
  TechAckVerdict, TechFile, TechMessage, TechPerson, TechPlatform, TechPriority, TechResolution,
  TechStatus, TechTicket, TechType, customTypeLabels, describeTechEvent, fileKindOf, freshAck, isNewForStaff,
  personName, stampMs,
} from './techDesk';

/* ============ Tech Desk data layer ============
   The backend is live and shared with the web client; these calls mirror the web's
   PostgREST shapes exactly so both clients read each other's rows. RLS already
   scopes reads (reporters see their own tickets, tech/admin see everything) — the
   eq() on "mine" is belt-and-braces, not the security boundary.
   House rules applied here: every network call is bounded by withTimeout, realtime
   invalidations go through invalidateDebounced, and none of these keys belong in
   the persisted cache allow-list (derived, per-user, cheap to refetch). */

// Both FK hints are required: tech_tickets has TWO foreign keys to profiles.
const TICKET_SELECT = `
  *,
  creator:profiles!tech_tickets_created_by_fkey ( id, first_name, last_name, role, avatar_url ),
  assignee:profiles!tech_tickets_assigned_to_fkey ( id, first_name, last_name, role, avatar_url )
`;
const MESSAGE_SELECT = `
  *,
  sender:profiles!tech_ticket_messages_sender_id_fkey ( id, first_name, last_name, role, avatar_url )
`;

const q = <T,>(builder: any, label: string) => withTimeout<T>(Promise.resolve(builder) as Promise<T>, NET_MS, label);

/** Staff = the Tech Desk side of the conversation (can see and patch every ticket). */
export const isTechStaffRole = (dbRole: string | null | undefined) => dbRole === 'tech' || dbRole === 'admin';
/** Everyone except super_admin gets a Tech Desk entry. */
export const canUseTechDesk = (dbRole: string | null | undefined) => !!dbRole && dbRole !== 'super_admin' && dbRole !== 'client';

/* ---------- tickets ---------- */
export function useTechTickets(scope: 'mine' | 'all') {
  const { session } = useAuth();
  const me = session?.user?.id ?? null;
  return useQuery({
    queryKey: ['tech-tickets', scope, me],
    enabled: !!me,
    staleTime: 15_000,
    refetchInterval: 60_000, // reliability floor — realtime is a convenience, not a guarantee
    queryFn: async (): Promise<TechTicket[]> => {
      let builder = supabase.from('tech_tickets').select(TICKET_SELECT).order('created_at', { ascending: false }).limit(1000);
      if (scope === 'mine') builder = builder.eq('created_by', me as string);
      const { data, error } = await q<any>(builder, 'Tickets');
      if (error) throw new Error(error.message);
      return (data ?? []) as TechTicket[];
    },
  });
}

export function useTechTicket(id: string | null) {
  return useQuery({
    queryKey: ['tech-ticket', id],
    enabled: !!id,
    staleTime: 15_000,
    queryFn: async (): Promise<TechTicket | null> => {
      const { data, error } = await q<any>(
        supabase.from('tech_tickets').select(TICKET_SELECT).eq('id', id as string).maybeSingle(), 'Ticket');
      if (error) throw new Error(error.message);
      return (data ?? null) as TechTicket | null;
    },
  });
}

export function useTechMessages(ticketId: string | null) {
  return useQuery({
    queryKey: ['tech-ticket-messages', ticketId],
    enabled: !!ticketId,
    staleTime: 5_000,
    refetchInterval: 30_000,
    queryFn: async (): Promise<TechMessage[]> => {
      const { data, error } = await q<any>(
        supabase.from('tech_ticket_messages').select(MESSAGE_SELECT)
          .eq('ticket_id', ticketId as string).order('created_at', { ascending: true }).limit(1000), 'Thread');
      if (error) throw new Error(error.message);
      return (data ?? []) as TechMessage[];
    },
  });
}

/** Tech profiles for the assignee picker. */
export function useTechStaff() {
  return useQuery({
    queryKey: ['tech-desk-staff'],
    staleTime: 300_000,
    queryFn: async (): Promise<TechPerson[]> => {
      const { data, error } = await q<any>(
        supabase.from('profiles').select('id, first_name, last_name, role, avatar_url').in('role', ['tech']).order('first_name'), 'Staff');
      if (error) throw new Error(error.message);
      return (data ?? []) as TechPerson[];
    },
  });
}

/* ---------- activity → unread dots (§4.1) ---------- */
export type TicketActivity = { lastReporterAt: number; lastOtherAt: number };

export function useTechActivity(tickets: TechTicket[]) {
  const ids = React.useMemo(() => tickets.map((t) => t.id).sort(), [tickets]);
  const creatorById = React.useMemo(() => {
    const m = new Map<string, string>();
    tickets.forEach((t) => m.set(t.id, t.created_by));
    return m;
  }, [tickets]);
  return useQuery({
    queryKey: ['tech-ticket-activity', ids.join(',')],
    enabled: ids.length > 0,
    staleTime: 10_000,
    refetchInterval: 60_000,
    queryFn: async (): Promise<Record<string, TicketActivity>> => {
      const out: Record<string, TicketActivity> = {};
      // PostgREST caps a response at 1000 rows — chunk the id list (web parity).
      for (let i = 0; i < ids.length; i += 100) {
        const { data, error } = await q<any>(
          supabase.from('tech_ticket_messages').select('ticket_id, sender_id, created_at')
            .in('ticket_id', ids.slice(i, i + 100)).order('created_at', { ascending: false }).limit(1000), 'Activity');
        if (error) throw new Error(error.message);
        for (const m of (data ?? []) as any[]) {
          const a = (out[m.ticket_id] ??= { lastReporterAt: 0, lastOtherAt: 0 });
          const ts = new Date(m.created_at).getTime();
          if (m.sender_id && m.sender_id === creatorById.get(m.ticket_id)) a.lastReporterAt = Math.max(a.lastReporterAt, ts);
          else a.lastOtherAt = Math.max(a.lastOtherAt, ts); // staff, or a system row with no sender
        }
      }
      return out;
    },
  });
}
export const reporterHasUnread = (t: TechTicket, a?: TicketActivity) => !!a && a.lastOtherAt > stampMs(t.timeline?.reporter_seen_at);
export const staffHasUnread = (t: TechTicket, a?: TicketActivity) => !!a && a.lastReporterAt > stampMs(t.timeline?.tech_seen_at);

/* ---------- console alerts (the Tech side of the banner) ----------
   Derived from the tickets + activity the console already holds, so this costs no
   extra query. Three things a tech person must not miss, in this order: the
   reporter's answer to a resolution (it either closed the ticket or handed it
   back), a ticket nobody on the team has opened yet, and a new reply. */
export type StaffAlertKind = 'ack' | 'new' | 'reply';
export type StaffAlert = {
  ticketId: string; serialNo: number; title: string;
  kind: StaffAlertKind; verdict?: TechAckVerdict; who: string; text: string; at: number;
};
const STAFF_ALERT_RANK: Record<StaffAlertKind, number> = { ack: 0, new: 1, reply: 2 };

export function staffAlerts(tickets: TechTicket[], act: Record<string, TicketActivity>): StaffAlert[] {
  const out: StaffAlert[] = [];
  for (const t of tickets) {
    const base = { ticketId: t.id, serialNo: t.serial_no, title: t.title, who: personName(t.creator).split(' ')[0] };
    // One alert per ticket: the most consequential thing that happened to it.
    const a = freshAck(t);
    if (a) {
      out.push({
        ...base, kind: 'ack', verdict: a.verdict, at: stampMs(a.at),
        text: a.verdict === 'confirmed'
          ? 'confirmed the fix, so this closed itself'
          : `sent this back${a.note ? `: ${a.note.slice(0, 70)}` : ''}`,
      });
      continue;
    }
    if (isNewForStaff(t)) {
      out.push({ ...base, kind: 'new', at: new Date(t.created_at).getTime(), text: 'raised this. Nobody has opened it yet.' });
      continue;
    }
    if (staffHasUnread(t, act[t.id])) {
      out.push({ ...base, kind: 'reply', at: act[t.id]?.lastReporterAt ?? 0, text: 'replied' });
    }
  }
  return out.sort((x, y) => STAFF_ALERT_RANK[x.kind] - STAFF_ALERT_RANK[y.kind] || y.at - x.at);
}

/* ---------- nav badge (§4.2) ---------- */
export function useTechDeskBadge() {
  const { session, dbRole } = useAuth();
  const me = session?.user?.id ?? null;
  const staff = isTechStaffRole(dbRole);
  return useQuery({
    queryKey: ['tech-desk-badge', me, staff],
    enabled: !!me && canUseTechDesk(dbRole),
    refetchInterval: 60_000,
    queryFn: async (): Promise<{ count: number; dot: boolean }> => {
      if (staff) {
        // Was the whole open-queue count, which is never zero and so read as decoration.
        // Now it counts what nobody has looked at: a ticket the team has not opened, a
        // reporter's answer to a resolution, or a reply since the last look. The queue
        // size is still on the console as IN QUEUE.
        const { data: rows, error } = await q<any>(
          supabase.from('tech_tickets').select('id, status, created_by, timeline, acknowledgement')
            .order('created_at', { ascending: false }).limit(1000), 'Badge');
        if (error) throw new Error(error.message);
        const list = (rows ?? []) as TechTicket[];
        if (!list.length) return { count: 0, dot: false };
        const { data: msgs } = await q<any>(
          supabase.from('tech_ticket_messages').select('ticket_id, sender_id, created_at')
            .in('ticket_id', list.map((r) => r.id).slice(0, 100)).order('created_at', { ascending: false }).limit(1000), 'Badge');
        const mlist = (msgs ?? []) as any[];
        const needs = new Set<string>();
        for (const t of list) {
          const seen = stampMs(t.timeline?.tech_seen_at);
          if (isNewForStaff(t)) needs.add(t.id);
          if (freshAck(t)) needs.add(t.id);
          if (mlist.some((m) => m.ticket_id === t.id && m.sender_id === t.created_by && new Date(m.created_at).getTime() > seen)) needs.add(t.id);
        }
        return { count: needs.size, dot: needs.size > 0 };
      }
      const { data: mine, error } = await q<any>(
        supabase.from('tech_tickets').select('id, status, created_by, timeline').eq('created_by', me as string).neq('status', 'closed'), 'Badge');
      if (error) throw new Error(error.message);
      const rows = (mine ?? []) as any[];
      if (!rows.length) return { count: 0, dot: false };
      const { data: msgs } = await q<any>(
        supabase.from('tech_ticket_messages').select('ticket_id, sender_id, created_at')
          .in('ticket_id', rows.map((r) => r.id).slice(0, 100)).order('created_at', { ascending: false }).limit(1000), 'Badge');
      const list = (msgs ?? []) as any[];
      // A ticket needs me if Tech has replied since I last looked OR it is sitting
      // in Resolved waiting for me to say the fix landed. One badge, one Set, so a
      // ticket that is both does not count twice.
      const needsMe = new Set<string>(rows.filter((t) => t.status === 'resolved').map((t) => t.id as string));
      rows.forEach((t) => {
        if (list.some((m) => m.ticket_id === t.id && m.sender_id !== t.created_by
          && new Date(m.created_at).getTime() > stampMs(t.timeline?.reporter_seen_at))) needsMe.add(t.id);
      });
      return { count: needsMe.size, dot: needsMe.size > 0 };
    },
  });
}

/* ---------- reporter alerts (§4.3) ---------- */
export type TechAlert = {
  ticketId: string; serialNo: number; title: string; status: TechStatus;
  actor: string; text: string; at: number;
  /** A resolution waiting on this reporter. Outranks replies and survives opening the ticket. */
  needsAck?: boolean;
};

export function useTechAlerts() {
  const { session, dbRole } = useAuth();
  const me = session?.user?.id ?? null;
  return useQuery({
    queryKey: ['tech-desk-alerts', me],
    // The tech role IS the Tech Desk — they don't get reporter alerts about their own queue.
    enabled: !!me && canUseTechDesk(dbRole) && dbRole !== 'tech',
    staleTime: 15_000,
    refetchInterval: 60_000,
    queryFn: async (): Promise<TechAlert[]> => {
      const { data: mine, error } = await q<any>(
        supabase.from('tech_tickets').select('id, serial_no, title, status, created_by, timeline')
          .eq('created_by', me as string).neq('status', 'closed').limit(200), 'Alerts');
      if (error) throw new Error(error.message);
      const rows = (mine ?? []) as any[];
      if (!rows.length) return [];
      const { data: msgs } = await q<any>(
        supabase.from('tech_ticket_messages').select(MESSAGE_SELECT)
          .in('ticket_id', rows.map((r) => r.id).slice(0, 100)).order('created_at', { ascending: false }).limit(1000), 'Alerts');
      const list = (msgs ?? []) as TechMessage[];
      const out: TechAlert[] = [];
      for (const t of rows) {
        // A resolution nobody has answered is a standing job, not news: it stays on
        // the banner until the reporter acknowledges, where a reply alert clears the
        // moment they open the ticket.
        if (t.status === 'resolved') {
          out.push({
            ticketId: t.id, serialNo: t.serial_no, title: t.title, status: t.status,
            actor: 'Tech Desk', text: 'says this is fixed. Confirm it to close the ticket.',
            at: stampMs(t.timeline?.resolved_at) || new Date(t.created_at).getTime(), needsAck: true,
          });
          continue;
        }
        const seen = stampMs(t.timeline?.reporter_seen_at);
        // newest message from someone else, newer than the reporter's last look
        const newest = list.find((m) => m.ticket_id === t.id && m.sender_id !== t.created_by && new Date(m.created_at).getTime() > seen);
        if (!newest) continue;
        const d = describeTechEvent(newest.message);
        out.push({
          ticketId: t.id, serialNo: t.serial_no, title: t.title, status: t.status,
          actor: newest.sender ? personName(newest.sender) : 'Tech Desk',
          text: d.text, at: new Date(newest.created_at).getTime(),
        });
      }
      // Something waiting on me outranks something merely telling me.
      return out.sort((a, b) => (a.needsAck === b.needsAck ? b.at - a.at : a.needsAck ? -1 : 1));
    },
  });
}

/* ---------- mutations ---------- */
export type RaiseTicketInput = {
  type: TechType; priority: TechPriority; title: string; description: string;
  platforms: TechPlatform[]; route: string | null; files: PickedTechFile[];
};

export function useRaiseTicket() {
  const qc = useQueryClient();
  const { session } = useAuth();
  const me = session?.user?.id ?? null;
  return useMutation({
    mutationFn: async (i: RaiseTicketInput): Promise<TechTicket> => {
      if (!me) throw new Error('Not signed in');
      // serial_no, status, assigned_to and timeline are owned by triggers/defaults — never send them.
      const { data, error } = await q<any>(supabase.from('tech_tickets').insert({
        type: i.type, priority: i.priority, title: i.title.trim(), description: i.description.trim(),
        platforms: i.platforms, route: i.route, created_by: me,
      }).select(TICKET_SELECT).single(), 'Raise ticket');
      if (error) throw new Error(error.message);
      const ticket = data as TechTicket;
      // Attachments become file messages on the new thread (sequential, web parity).
      for (const f of i.files) {
        const meta = await uploadTechFile(ticket.id, f);
        const { error: mErr } = await q<any>(supabase.from('tech_ticket_messages')
          .insert({ ticket_id: ticket.id, sender_id: me, message: { type: 'file', file: meta } }), 'Attachment');
        if (mErr) throw new Error(mErr.message);
      }
      return ticket;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tech-tickets'] });
      qc.invalidateQueries({ queryKey: ['tech-desk-badge'] });
    },
  });
}

export function useSendTechMessage() {
  const qc = useQueryClient();
  const { session } = useAuth();
  const me = session?.user?.id ?? null;
  return useMutation({
    mutationFn: async (i: { ticketId: string; text?: string; file?: PickedTechFile }) => {
      if (!me) throw new Error('Not signed in');
      const trimmed = (i.text ?? '').trim();
      let payload: any;
      if (i.file) {
        const meta = await uploadTechFile(i.ticketId, i.file);
        payload = trimmed ? { type: 'file', file: meta, text: trimmed } : { type: 'file', file: meta };
      } else {
        if (!trimmed) return;
        payload = { type: 'text', text: trimmed };
      }
      const { error } = await q<any>(supabase.from('tech_ticket_messages')
        .insert({ ticket_id: i.ticketId, sender_id: me, message: payload }), 'Send');
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['tech-ticket-messages', v.ticketId] });
      qc.invalidateQueries({ queryKey: ['tech-ticket-activity'] });
    },
  });
}

/** Staff patch — send ONLY the changed keys; triggers write the system rows and stamps.
    A TYPE change is the one exception: always send `type` and `type_label` together
    (`{type:'bug', type_label:null}` or `{type:'other', type_label:'Hardware'}`), or the
    row keeps a stale written label over a new enum kind. */
export function useUpdateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (i: { id: string; patch: Partial<Pick<TechTicket, 'status' | 'priority' | 'assigned_to' | 'resolution' | 'type' | 'type_label'>> }) => {
      const { error } = await q<any>(supabase.from('tech_tickets').update(i.patch).eq('id', i.id), 'Update ticket');
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['tech-tickets'] });
      qc.invalidateQueries({ queryKey: ['tech-ticket', v.id] });
      qc.invalidateQueries({ queryKey: ['tech-ticket-messages', v.id] });
      qc.invalidateQueries({ queryKey: ['tech-desk-badge'] });
    },
  });
}

/** Reporters cannot UPDATE tech_tickets (RLS) — closing goes through the RPC. */
export function useCloseTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await q<any>(supabase.rpc('tech_ticket_close', { _id: id }), 'Close ticket');
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ['tech-tickets'] });
      qc.invalidateQueries({ queryKey: ['tech-ticket', id] });
      qc.invalidateQueries({ queryKey: ['tech-ticket-messages', id] });
      qc.invalidateQueries({ queryKey: ['tech-desk-badge'] });
    },
  });
}

/** Staff log the effort a ticket took. NULL minutes clears it. Staff-only server-side
    (42501 otherwise), any status, and deliberately silent: no thread row, so the
    reporter's unread dot never moves for bookkeeping. */
export function useSetTimeTaken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (i: { id: string; minutes: number | null }) => {
      const { error } = await q<any>(supabase.rpc('tech_ticket_set_time_taken', { _id: i.id, _minutes: i.minutes }), 'Time taken');
      if (error) {
        if ((error as any).code === 'PGRST202') throw new Error('Time logging is not enabled yet. Run the Tech Desk time-taken script.');
        throw new Error(error.message);
      }
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['tech-tickets'] });
      qc.invalidateQueries({ queryKey: ['tech-ticket', v.id] });
    },
  });
}

/** Closing needs a reason. Replaces `tech_ticket_close` on the member side: the RPC posts
    "Closed this ticket. Reason: ..." as a text message from the closer, then sets closed
    and writes `closure`. That text row is reporter activity, so the console's unread
    badge and NEW REPLY alert pick it up with no new alert kind. */
export function useCloseTicketWithReason() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (i: { id: string; reason: string }) => {
      const { error } = await q<any>(
        supabase.rpc('tech_ticket_close_with_reason', { _id: i.id, _reason: i.reason.trim() }), 'Close ticket');
      if (error) {
        if ((error as any).code === 'PGRST202') throw new Error('Closing with a reason is not enabled yet. Run the Tech Desk close-reason script.');
        throw new Error(error.message);
      }
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['tech-tickets'] });
      qc.invalidateQueries({ queryKey: ['tech-ticket', v.id] });
      qc.invalidateQueries({ queryKey: ['tech-ticket-messages', v.id] });
      qc.invalidateQueries({ queryKey: ['tech-ticket-activity'] });
      qc.invalidateQueries({ queryKey: ['tech-desk-badge'] });
      qc.invalidateQueries({ queryKey: ['tech-desk-alerts'] });
    },
  });
}

/** Staff delete: the ticket, its whole thread and every attachment, for everyone.
    There is deliberately NO delete policy on either table, so this RPC is the only
    path; messages cascade through the FK and the file-cleanup trigger empties the
    bucket in the same transaction. Irreversible. */
export function useDeleteTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await q<any>(supabase.rpc('tech_ticket_delete', { _id: id }), 'Delete ticket');
      if (error) {
        if ((error as any).code === 'PGRST202') throw new Error('Deleting is not enabled yet. Run the Tech Desk delete script.');
        throw new Error(error.message);
      }
      return (data ?? null) as { serial_no: number; title: string; files: number } | null;
    },
    onSuccess: (_d, id) => {
      // Drop the dead row's caches instead of invalidating them: an invalidate would
      // refetch a ticket that no longer exists and paint "no longer available".
      qc.removeQueries({ queryKey: ['tech-ticket', id] });
      qc.removeQueries({ queryKey: ['tech-ticket-messages', id] });
      qc.invalidateQueries({ queryKey: ['tech-tickets'] });
      qc.invalidateQueries({ queryKey: ['tech-ticket-activity'] });
      qc.invalidateQueries({ queryKey: ['tech-desk-badge'] });
      qc.invalidateQueries({ queryKey: ['tech-desk-alerts'] });
    },
  });
}

/** Written type names already in use, for the picker's reuse chips. Reads whatever
    ticket lists are already in the query cache rather than firing a query of its own. */
export function useCustomTypeLabels(): string[] {
  const qc = useQueryClient();
  const lists = qc.getQueriesData<TechTicket[]>({ queryKey: ['tech-tickets'] });
  const all: TechTicket[] = [];
  for (const [, rows] of lists) if (Array.isArray(rows)) all.push(...rows);
  return customTypeLabels(all);
}

/** The reporter answers a resolution: 'confirmed' closes the ticket, 'reopened' sends it
    back to In Progress. Reporters have no UPDATE on tech_tickets, so this is an RPC —
    and the RPC, not this hook, is where the rules are enforced. */
export function useAcknowledgeTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (i: { id: string; verdict: TechAckVerdict; note?: string }) => {
      const { error } = await q<any>(supabase.rpc('tech_ticket_acknowledge', {
        _id: i.id, _verdict: i.verdict, _note: (i.note ?? '').trim() || null,
      }), 'Acknowledge');
      if (error) {
        // The SQL in docs/tech-desk-acknowledgement.sql has not been run yet.
        if ((error as any).code === 'PGRST202') throw new Error('Acknowledging is not enabled yet. Ask the tech team to finish the setup.');
        throw new Error(error.message);
      }
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['tech-tickets'] });
      qc.invalidateQueries({ queryKey: ['tech-ticket', v.id] });
      qc.invalidateQueries({ queryKey: ['tech-ticket-messages', v.id] });
      qc.invalidateQueries({ queryKey: ['tech-ticket-activity'] });
      qc.invalidateQueries({ queryKey: ['tech-desk-badge'] });
      qc.invalidateQueries({ queryKey: ['tech-desk-alerts'] });
    },
  });
}

/** Stamps reporter_seen_at / tech_seen_at — this is what clears the unread dots. Silent. */
export function useMarkTicketSeen(ticketId: string | null, messageCount: number) {
  const qc = useQueryClient();
  React.useEffect(() => {
    if (!ticketId) return;
    let cancelled = false;
    (async () => {
      try {
        await q<any>(supabase.rpc('tech_ticket_mark_seen', { _id: ticketId }), 'Mark seen');
        if (cancelled) return;
        qc.invalidateQueries({ queryKey: ['tech-desk-badge'] });
        qc.invalidateQueries({ queryKey: ['tech-desk-alerts'] });
        qc.invalidateQueries({ queryKey: ['tech-ticket-activity'] });
      } catch { /* seen-stamps are best effort; never surface an error for this */ }
    })();
    return () => { cancelled = true; };
  }, [ticketId, messageCount, qc]);
}

/* ---------- realtime (§5) ---------- */
export function useTechDeskRealtime() {
  const qc = useQueryClient();
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;
  React.useEffect(() => {
    if (!uid) return;
    const ch = supabase.channel(`tech-desk-live-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tech_tickets' }, () => {
        invalidateDebounced(qc, ['tech-tickets'], 400);
        invalidateDebounced(qc, ['tech-desk-badge'], 400);
        invalidateDebounced(qc, ['tech-desk-alerts'], 400);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tech_ticket_messages' }, (p: any) => {
        const tid = p?.new?.ticket_id;
        if (tid) invalidateDebounced(qc, ['tech-ticket-messages', tid], 300);
        invalidateDebounced(qc, ['tech-ticket-activity'], 400);
        invalidateDebounced(qc, ['tech-desk-badge'], 400);
        invalidateDebounced(qc, ['tech-desk-alerts'], 400);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [uid, qc]);
}

/* ---------- storage (§7) ---------- */
export type PickedTechFile = { uri: string; name: string; mime: string; size: number };
export const TECH_BUCKET = 'tech-ticket-files';
export const MAX_TECH_FILE = 25 * 1024 * 1024;

export async function uploadTechFile(ticketId: string, f: PickedTechFile): Promise<TechFile> {
  if (f.size > MAX_TECH_FILE) throw new Error(`${f.name} is over 25 MB`);
  const safeName = f.name.replace(/[^\w.\-()+ ]+/g, '_').slice(0, 80);
  // The storage policy authorises by the first 36 chars of the path — the ticket id.
  const path = `${ticketId}/${uuidv4()}-${safeName}`;
  // fetch → arrayBuffer is the RN-safe route for file:// and content:// picker uris.
  const body = await (await fetch(f.uri)).arrayBuffer();
  const { error } = await uploadWithTimeout(TECH_BUCKET, path, body, { contentType: f.mime, upsert: false });
  if (error) throw new Error(error.message);
  return { path, name: f.name, mime: f.mime, size: f.size || body.byteLength, kind: fileKindOf(f.mime) };
}

/** Signed URLs are short-lived (10 min) — resolve them at render time, never store them. */
export function useSignedTechUrl(path: string | null) {
  return useQuery({
    queryKey: ['tech-file-url', path],
    enabled: !!path,
    staleTime: 8 * 60_000,
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await q<any>(supabase.storage.from(TECH_BUCKET).createSignedUrl(path as string, 600), 'File');
      if (error) throw new Error(error.message);
      return data?.signedUrl ?? null;
    },
  });
}

export type { TechResolution, TechStatus, TechPriority, TechType, TechPlatform };
