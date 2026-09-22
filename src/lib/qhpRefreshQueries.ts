import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';
import { istDate } from './trainerQueries';

/* ============ QHP refresh pending (trainer dashboard) ============
   Which of my clients are overdue for a refresh QHP: the client's LATEST
   completed QHP was held QHP_REFRESH_DAYS (40) or more days ago, and no refresh
   is already on the calendar. The trainer proposes a slot from the card and the
   proposal lands in the client's internal thread, tagging the client's CRM.
   A client with a proposal already in the thread (newer than the last QHP)
   shows as PROPOSED and cannot be proposed again; the CRM scheduling the QHP
   removes the client from the list. Android-only (no web equivalent, 15 Sep 2026). */

export const QHP_REFRESH_DAYS = 40;
/* Fixed phrase every proposal carries; the pending query finds proposals by it. */
export const QHP_PROPOSAL_MARK = 'QHP refresh due for';

export type QhpRefreshProposal = { at: string; slot: string | null; mine: boolean };
export type QhpRefreshRow = {
  clientId: string;
  clientName: string;
  lastQhpDate: string;   // YYYY-MM-DD (IST) when the last QHP was completed; assessment_date only if never stamped
  daysSince: number;
  crmId: string | null;  // assigned CRM (trainer_clients row whose profile role is crm)
  crmName: string | null;
  proposal: QhpRefreshProposal | null; // latest proposal in the thread since the last QHP
};

const fullName = (p: any) => `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.replace(/\s+/g, ' ').trim();
const nonEmpty = (v: any) => !!v && typeof v === 'object' && Object.keys(v).length > 0;
/* Web isAssessmentCompleted: a file upload or any of the three data blobs. */
const hasQhpData = (a: any) =>
  !!a.assessment_file_url || nonEmpty(a.qhp_data) || nonEmpty(a.new_client_assessment_data) || nonEmpty(a.existing_client_assessment_data);
/* Whole days between two YYYY-MM-DD strings (both read as UTC midnight, so DST never bites). */
export const daysBetween = (fromYmd: string, toYmd: string) =>
  Math.floor((Date.parse(`${toYmd}T00:00:00Z`) - Date.parse(`${fromYmd}T00:00:00Z`)) / 864e5);
/* "Proposed slot: Wed, 18 Sept 2026, 10:00 am" → the slot text, if the body has one. */
export const parseProposalSlot = (body: string | null | undefined) => {
  const m = /Proposed slot:\s*(.+)/.exec(body ?? '');
  return m ? m[1].trim() : null;
};

export function useQhpRefreshPending(trainerId: string) {
  return useQuery({
    queryKey: ['trainer-qhp-refresh-pending', trainerId],
    enabled: !!trainerId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<QhpRefreshRow[]> => {
      // 1. My active clients (same universe as the client threads list).
      const { data: assigned, error } = await supabase
        .from('trainer_clients')
        .select('client_id, clients:client_id(id, first_name, last_name, status)')
        .eq('trainer_id', trainerId)
        .eq('actively_training', true);
      if (error) throw new Error(error.message);
      const clients = new Map<string, string>();
      (assigned ?? []).forEach((r: any) => {
        const c = r.clients;
        if (!c || ['inactive', 'discontinued'].includes(String(c.status ?? '').toLowerCase())) return;
        clients.set(c.id, fullName(c) || 'Client');
      });
      const ids = [...clients.keys()];
      if (!ids.length) return [];

      // 2. Every QHP of those clients (any assessor): latest completed date, and
      //    whether a refresh is already scheduled. The data blobs are needed to
      //    tell "completed" (data present), same rule as the CRM QHP tab.
      const today = istDate();
      const latestDone = new Map<string, string>();
      const upcoming = new Set<string>();
      for (let i = 0; i < ids.length; i += 200) {
        const { data: rows, error: e2 } = await supabase
          .from('coach_assessment')
          .select('client_id, assessment_date, completed, assessment_scheduled, assessment_file_url, qhp_data, new_client_assessment_data, existing_client_assessment_data')
          .in('client_id', ids.slice(i, i + 200));
        if (e2) throw new Error(e2.message);
        (rows ?? []).forEach((a: any) => {
          if (!a.client_id) return;
          if (hasQhpData(a)) {
            // The 40-day clock runs from `completed` (when the assessor finished
            // it, as an IST date); rows never stamped fall back to the held date.
            const done = a.completed ? istDate(new Date(a.completed)) : a.assessment_date;
            if (done && (latestDone.get(a.client_id) ?? '') < done) latestDone.set(a.client_id, done);
          } else if (a.assessment_scheduled === true && a.assessment_date && a.assessment_date >= today) {
            upcoming.add(a.client_id); // a refresh is already on the calendar
          }
        });
      }

      const due = ids.filter((id) => {
        const last = latestDone.get(id);
        return !!last && !upcoming.has(id) && daysBetween(last, today) >= QHP_REFRESH_DAYS;
      });
      if (!due.length) return [];

      // 3. The client's CRM: first actively_training trainer_clients row whose profile is a crm.
      const crmOf = new Map<string, { id: string; name: string }>();
      for (let i = 0; i < due.length; i += 200) {
        const { data: crmRows } = await supabase
          .from('trainer_clients')
          .select('client_id, profiles:trainer_id(id, first_name, last_name, role)')
          .in('client_id', due.slice(i, i + 200))
          .eq('actively_training', true);
        (crmRows ?? []).forEach((r: any) => {
          const p = r.profiles;
          if (p?.role === 'crm' && !crmOf.has(r.client_id)) crmOf.set(r.client_id, { id: p.id, name: fullName(p) || 'CRM' });
        });
      }

      // 4. Proposals already in the client threads (any teammate), newer than the
      //    last QHP so a proposal made before a later QHP never blocks a new one.
      const proposalOf = new Map<string, QhpRefreshProposal>();
      const { data: threads } = await supabase.from('client_threads').select('id, client_id').in('client_id', due);
      const clientOfThread = new Map<string, string>();
      (threads ?? []).forEach((t: any) => { if (t.client_id) clientOfThread.set(t.id, t.client_id); });
      const threadIds = [...clientOfThread.keys()];
      if (threadIds.length) {
        const { data: msgs } = await supabase
          .from('client_thread_messages')
          .select('thread_id, sender_id, body, created_at')
          .in('thread_id', threadIds)
          .ilike('body', `%${QHP_PROPOSAL_MARK}%`)
          .order('created_at', { ascending: false })
          .limit(500);
        (msgs ?? []).forEach((m: any) => {
          const clientId = clientOfThread.get(m.thread_id);
          if (!clientId || proposalOf.has(clientId)) return; // newest first: first hit wins
          const last = latestDone.get(clientId)!;
          if (istDate(new Date(m.created_at)) < last) return; // older than the latest QHP
          proposalOf.set(clientId, { at: m.created_at, slot: parseProposalSlot(m.body), mine: m.sender_id === trainerId });
        });
      }

      return due
        .map((id) => {
          const last = latestDone.get(id)!;
          const crm = crmOf.get(id);
          return {
            clientId: id, clientName: clients.get(id)!, lastQhpDate: last, daysSince: daysBetween(last, today),
            crmId: crm?.id ?? null, crmName: crm?.name ?? null, proposal: proposalOf.get(id) ?? null,
          };
        })
        // Actionable clients first, then the ones already proposed; most overdue on top within each.
        .sort((a, b) => Number(!!a.proposal) - Number(!!b.proposal) || b.daysSince - a.daysSince || a.clientName.localeCompare(b.clientName));
    },
  });
}

/* The thread message. Leads with the CRM's @mention so the thread highlights it
   and the CRM's push shows who it is for; the standing members (Ops Head +
   admin) receive it too, so a client without a CRM still reaches someone. The
   "Proposed slot:" line is what the card reads back as the proposal. */
export function fmtProposedSlot(slot: { date: string; time: string }) {
  return new Date(`${slot.date}T${slot.time}:00+05:30`).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
}
export function buildQhpRefreshMessage(row: QhpRefreshRow, slot: { date: string; time: string }, note: string): string {
  const last = new Date(`${row.lastQhpDate}T00:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
  const lines = [
    `${row.crmName ? `@${row.crmName} ` : ''}${QHP_PROPOSAL_MARK} ${row.clientName}. Last QHP on ${last} (${row.daysSince} days ago).`,
    `Proposed slot: ${fmtProposedSlot(slot)}`,
  ];
  if (note.trim()) lines.push(`Note: ${note.trim()}`);
  return lines.join('\n');
}
