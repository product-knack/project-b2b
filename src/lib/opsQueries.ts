import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';

/* ============ Ops workspace — misc pages (contracts from the web ops surface) ============
   Sales targets (sales_tracker + append_sales_target_note), QHP holds
   (get_qhp_holds + add_qhp_hold_reply — verified live), CRM pending assignments,
   paid-clients roster, baseline-explanation tracker. */

const nm = (p: any) => `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.replace(/\s+/g, ' ').trim();
const chunk = <T,>(a: T[], n = 100): T[][] => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
const PAGE = 1000;
async function fetchAll<T = any>(make: (from: number, to: number) => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 200_000; from += PAGE) {
    const { data, error } = await make(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as T[]));
    if ((data ?? []).length < PAGE) break;
  }
  return out;
}

/* ---------------- Sales targets (web useSalesTargetsOverview) ---------------- */
export type OpsNote = { id: string; by: string; by_name: string; by_role: string; category: string; note: string; at: string };
export type SalesTargetRow = {
  id: string; clientName: string; ownerName: string; targetType: string; targetValue: any;
  status: 'open' | 'won' | 'lost'; lostReason: string | null; expectedCloseDate: string | null;
  closedAt: string | null; createdAt: string; notes: any; opsNotes: OpsNote[]; stale: boolean;
};
// Web parity (2026-08): cross_sell keeps its stored VALUE but displays as "Up sell".
export const NOTE_CATEGORIES = [['price_strategy', 'Price strategy'], ['objection_handling', 'Objection handling'], ['timing', 'Timing'], ['cross_sell', 'Up sell'], ['general', 'General']] as const;
export function useSalesTargetsOverview(enabled: boolean) {
  return useQuery({
    queryKey: ['sales-targets-overview'],
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<SalesTargetRow[]> => {
      const { data, error } = await supabase.from('sales_tracker')
        .select('id, client_id, created_by, target_type, target_value, status, lost_reason, expected_close_date, closed_at, notes, ops_notes, created_at, updated_at, clients:client_id(first_name, last_name)')
        .order('created_at', { ascending: true });
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as any[];
      const ownerIds = [...new Set(rows.map((r) => r.created_by).filter(Boolean))];
      const owners = new Map<string, string>();
      for (const part of chunk(ownerIds)) {
        const { data: profs } = await supabase.from('profiles').select('id, first_name, last_name, email').in('id', part);
        (profs ?? []).forEach((p: any) => owners.set(p.id, nm(p) || p.email || '—'));
      }
      const now = Date.now();
      return rows.map((r) => ({
        id: r.id, clientName: nm(r.clients) || '—', ownerName: owners.get(r.created_by) ?? '—',
        targetType: r.target_type, targetValue: r.target_value, status: r.status, lostReason: r.lost_reason ?? null,
        expectedCloseDate: r.expected_close_date ?? null, closedAt: r.closed_at ?? null, createdAt: r.created_at,
        notes: r.notes, opsNotes: Array.isArray(r.ops_notes) ? r.ops_notes : [],
        stale: r.status === 'open' && (now - new Date(r.created_at).getTime()) / 86400000 >= 14,
      }));
    },
  });
}
export function useAppendSalesTargetNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { targetId: string; category: string; note: string }) => {
      const note = input.note.trim();
      if (note.length < 5) throw new Error('Note must be at least 5 characters.');
      if (note.length > 1000) throw new Error('Note is too long (max 1000).');
      const { error } = await supabase.rpc('append_sales_target_note', { p_target_id: input.targetId, p_category: input.category, p_note: note });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sales-targets-overview'] }),
  });
}

/* ---------------- QHP holds (get_qhp_holds RPC; replies embedded) ---------------- */
export type HoldReply = { id: string; author_id: string; author_name: string; author_role: string; message: string; created_at: string };
export type QhpHoldRow = {
  lead_id: string; client_id: string | null; client_name: string; phone: string | null; reason: string | null;
  resolving_at: string | null; held_at: string | null; held_by: string | null; held_by_name: string | null;
  is_overdue: boolean; replies: HoldReply[]; replies_count: number | null; last_reply_at: string | null;
};
export function useQhpHolds(enabled: boolean) {
  return useQuery({
    queryKey: ['qhp-holds'],
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async (): Promise<QhpHoldRow[]> => {
      const { data, error } = await supabase.rpc('get_qhp_holds');
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map((h) => ({ ...h, replies: Array.isArray(h.replies) ? h.replies : [] }));
    },
  });
}
export function useAddHoldReply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { leadId: string; message: string }) => {
      const msg = input.message.trim();
      if (!msg) throw new Error('Reply is required.');
      if (msg.length > 1000) throw new Error('Reply is too long (max 1000).');
      const { error } = await supabase.rpc('add_qhp_hold_reply', { _lead_id: input.leadId, _message: msg });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['qhp-holds'] }),
  });
}

/* ---------------- QHP hold history (resolved holds via get_qhp_hold_history RPC) ---------------- */
export type QhpHoldHistoryRow = {
  assessment_id: string; lead_id: string | null; client_id: string | null; client_name: string | null;
  reason: string | null; held_by: string | null; held_by_name: string | null; held_at: string | null;
  resolving_at: string | null; was_overdue: boolean; replies: any[]; replies_count: number;
  outcome: 'completed' | 'rescheduled' | 'cancelled'; resolved_at: string | null;
  resolved_by: string | null; resolved_by_name: string | null;
};
export function useQhpHoldHistory(enabled: boolean) {
  return useQuery({
    queryKey: ['qhp-hold-history'],
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<QhpHoldHistoryRow[]> => {
      const { data, error } = await supabase.rpc('get_qhp_hold_history');
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map((r) => ({
        ...r,
        replies: Array.isArray(r.replies) ? r.replies : [],
        replies_count: Number(r.replies_count) || 0,
        // Missing/unknown outcome coerces to cancelled (web parity).
        outcome: r.outcome === 'completed' || r.outcome === 'rescheduled' ? r.outcome : 'cancelled',
      }));
    },
  });
}

/* ---------------- CRM pending assignments (3h+ unassigned after payment) ---------------- */
export type CrmPendingRow = { id: string; clientId: string; clientName: string; phone: string | null; email: string | null; paymentReceivedAt: string; overdue: boolean };
export function useCrmPendingAssignments(enabled: boolean) {
  return useQuery({
    queryKey: ['crm-pending-assignments'],
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async (): Promise<CrmPendingRow[]> => {
      const cutoff = new Date(Date.now() - 3 * 3600e3).toISOString();
      const { data, error } = await supabase.from('payment_crm_assignment_pending')
        .select('id, client_id, payment_date, payment_received_at, resolved_at, client:clients!payment_crm_assignment_pending_client_id_fkey(id, first_name, last_name, phone, email)')
        .is('resolved_at', null).lte('payment_received_at', cutoff)
        .order('payment_received_at', { ascending: true });
      if (error) throw new Error(error.message);
      const now = Date.now();
      return ((data ?? []) as any[]).map((r) => ({
        id: r.id, clientId: r.client_id, clientName: nm(r.client) || '—', phone: r.client?.phone ?? null, email: r.client?.email ?? null,
        paymentReceivedAt: r.payment_received_at, overdue: now - new Date(r.payment_received_at).getTime() > 24 * 3600e3,
      }));
    },
  });
}

/* ---------------- Paid clients roster (web OpsClients) ---------------- */
const EXCLUDED_SUBS = new Set(['staff', 'trial', 'opportunity']);
export type OpsClientRow = {
  id: string; name: string; initial: string; subscription: string; status: string;
  assignedCrm: string | null; lastPackage: string | null; paymentDate: string | null;
  sessionsLeft: number | null; lastCompletedAt: string | null;
};
export function useOpsPaidClients(enabled: boolean) {
  return useQuery({
    queryKey: ['ops-paid-clients'],
    enabled,
    staleTime: 300_000,
    refetchInterval: false,
    queryFn: async (): Promise<OpsClientRow[]> => {
      const all = await fetchAll((f, t) => supabase.from('clients').select('id, first_name, last_name, subscription_type, session_package, sessions_per_cycle, payment_date, status, created_at').not('subscription_type', 'is', null).range(f, t));
      const clients = (all as any[]).filter((c) => {
        if (EXCLUDED_SUBS.has(String(c.subscription_type ?? '').trim().toLowerCase())) return false;
        // Hide merged duplicate placeholder clients (web parity).
        const fn = String(c.first_name ?? '').trim().toLowerCase();
        const ln = String(c.last_name ?? '').trim().toLowerCase();
        return !fn.startsWith('[merged]') && !ln.includes('(dup of');
      });
      const ids = clients.map((c) => c.id);
      const latestRenewal = new Map<string, any>();
      const crmMap = new Map<string, string>();
      const usage = new Map<string, { scheduled_at: string; status: string | null }[]>();
      for (const part of chunk(ids)) {
        const [ren, sess, { data: tc }] = await Promise.all([
          fetchAll((f, t) => supabase.from('client_renewals').select('client_id, new_package, package_amount, package_sessions, cycle_sessions, payment_date, renewed_at').in('client_id', part).eq('request_status', 'approved').order('renewed_at', { ascending: false }).range(f, t)),
          // Session usage RPC (completed + cancelled — cancelled counts as used).
          // PostgREST caps RPC responses at 1000 rows, so page it like a table read.
          fetchAll((f, t) => supabase.rpc('get_ops_client_session_usage', { _client_ids: part }).range(f, t)),
          supabase.from('trainer_clients').select('client_id, trainer_id, actively_training, profiles:trainer_id(id, first_name, last_name, role)').in('client_id', part).eq('actively_training', true),
        ]);
        (ren as any[]).forEach((r) => { if (r.client_id && !latestRenewal.has(r.client_id)) latestRenewal.set(r.client_id, r); });
        (sess as any[]).forEach((r) => { if (!r.client_id || !r.scheduled_at) return; const arr = usage.get(r.client_id) ?? []; arr.push(r); usage.set(r.client_id, arr); });
        (tc ?? []).forEach((r: any) => { if (r.profiles?.role === 'crm') crmMap.set(r.client_id, nm(r.profiles) || 'CRM'); });
      }
      const fmtPackage = (v: any) => { const s = String(v ?? '').trim(); if (!s) return null; return /^\d+$/.test(s) ? `${s} sessions` : s; };
      return clients.map((c) => {
        const ren = latestRenewal.get(c.id);
        const name = nm(c) || '—';
        const rows = usage.get(c.id) ?? [];
        // Sessions left — mirrors web remainingSessionsFor (per-cycle remaining preferred).
        let sessionsLeft: number | null = null;
        const pkg = ren?.package_sessions ?? (c.session_package ? parseInt(String(c.session_package), 10) : 0);
        if (pkg && pkg > 0) {
          const startIso = ren?.renewed_at ?? c.created_at;
          if (!startIso) sessionsLeft = pkg;
          else {
            const start = new Date(startIso).getTime();
            const used = rows.filter((s) => new Date(s.scheduled_at).getTime() >= start).length;
            const cyc = ren?.cycle_sessions ?? c.sessions_per_cycle ?? 0;
            if (cyc > 0) sessionsLeft = used === 0 ? cyc : used % cyc === 0 ? 0 : cyc - (used % cyc);
            else sessionsLeft = Math.max(pkg - used, 0);
          }
        }
        let lastCompletedAt: string | null = null;
        rows.forEach((s) => {
          if (String(s.status ?? '').toLowerCase() !== 'completed') return;
          if (!lastCompletedAt || new Date(s.scheduled_at).getTime() > new Date(lastCompletedAt).getTime()) lastCompletedAt = s.scheduled_at;
        });
        return {
          id: c.id, name, initial: (name[0] ?? '?').toUpperCase(), subscription: c.subscription_type,
          status: String(c.status ?? '').toLowerCase(),
          assignedCrm: crmMap.get(c.id) ?? null,
          lastPackage: fmtPackage(ren?.new_package ?? c.session_package),
          paymentDate: ren?.payment_date ?? c.payment_date ?? null,
          sessionsLeft, lastCompletedAt,
        };
      }).sort((a, b) => a.name.localeCompare(b.name));
    },
  });
}

/* ---------------- Baseline-explanation tracker (web OpsBaselineExplanation) ---------------- */
const BASELINE_CUTOFF_MS = new Date('2026-05-28T23:59:59+05:30').getTime();
export const baselineMonths = (): { key: string; label: string }[] => {
  const out: { key: string; label: string }[] = [];
  const now = new Date();
  for (let y = 2026, m = 2; y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth() + 1); m === 12 ? (y++, m = 1) : m++) {
    out.push({ key: `${y}-${String(m).padStart(2, '0')}`, label: new Date(y, m - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) });
  }
  return out.reverse();
};
export type BaselineRow = { clientId: string; name: string; subscription: string; assignedCrm: string | null; onboardedAt: string; explained: boolean; source: 'journey' | 'qhp_details' | null; explainedBy: string | null; explainedAt: string | null };
export function useBaselineExplanation(monthKey: string, enabled: boolean) {
  return useQuery({
    queryKey: ['ops-baseline-explanation', monthKey],
    enabled: enabled && !!monthKey,
    staleTime: 120_000,
    queryFn: async (): Promise<BaselineRow[]> => {
      const [y, m] = monthKey.split('-').map(Number);
      const startIso = new Date(y, m - 1, 1).toISOString();
      const endIso = new Date(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1).toISOString();
      const clients = await fetchAll((f, t) => supabase.from('clients')
        .select('id, first_name, last_name, created_at, client_onboard_journey, subscription_type')
        .not('subscription_type', 'is', null)
        .or('subscription_type.ilike.Odds%,subscription_type.eq.Virtual Training')
        .gte('created_at', startIso).lt('created_at', endIso).range(f, t));
      const ids = (clients as any[]).map((c) => c.id);
      if (!ids.length) return [];
      const latestQhp = new Map<string, any>();
      const crmMap = new Map<string, string>();
      for (const part of chunk(ids)) {
        const [{ data: qd }, { data: tc }] = await Promise.all([
          supabase.from('qhp_details').select('id, client_id, qhp_explained_to_client_at, qhp_explained_by, created_at').in('client_id', part),
          supabase.from('trainer_clients').select('client_id, trainer_id, actively_training, profiles:trainer_id(id, first_name, last_name, role)').in('client_id', part),
        ]);
        (qd ?? []).forEach((r: any) => {
          const cur = latestQhp.get(r.client_id);
          const key = r.qhp_explained_to_client_at ?? r.created_at ?? '';
          const curKey = cur ? (cur.qhp_explained_to_client_at ?? cur.created_at ?? '') : '';
          if (!cur || key > curKey) latestQhp.set(r.client_id, r);
        });
        (tc ?? []).forEach((r: any) => { if (r.profiles?.role === 'crm' && !crmMap.has(r.client_id)) crmMap.set(r.client_id, nm(r.profiles) || 'CRM'); });
      }
      const explainerIds = [...new Set([...latestQhp.values()].map((r: any) => r.qhp_explained_by).filter(Boolean))];
      const explainers = new Map<string, string>();
      for (const part of chunk(explainerIds)) {
        const { data: profs } = await supabase.from('profiles').select('id, first_name, last_name').in('id', part);
        (profs ?? []).forEach((p: any) => explainers.set(p.id, nm(p)));
      }
      return (clients as any[]).map((c) => {
        const crm = crmMap.get(c.id) ?? null;
        const journeyExplained = c.client_onboard_journey?.qhp_discussed === true;
        const beforeCutoff = new Date(c.created_at).getTime() <= BASELINE_CUTOFF_MS;
        const qhp = latestQhp.get(c.id);
        let explained = false, source: BaselineRow['source'] = null, explainedBy: string | null = null, explainedAt: string | null = null;
        if (beforeCutoff) {
          if (journeyExplained) { explained = true; source = 'journey'; explainedBy = crm; }
        } else if (qhp?.qhp_explained_to_client_at) {
          explained = true; source = 'qhp_details'; explainedAt = qhp.qhp_explained_to_client_at; explainedBy = explainers.get(qhp.qhp_explained_by) ?? null;
        } else if (journeyExplained) {
          explained = true; source = 'journey'; explainedBy = crm;
        }
        return { clientId: c.id, name: nm(c) || '—', subscription: c.subscription_type, assignedCrm: crm, onboardedAt: c.created_at, explained, source, explainedBy, explainedAt };
      }).sort((a, b) => b.onboardedAt.localeCompare(a.onboardedAt));
    },
  });
}
