import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { C } from '../theme';

/* ============ CRM Incentives + Incidents — mirrors the web:
   useMyIncentives / useCRMPendingRequests / useIncentiveLeaderboard /
   RaiseRequestDialog inserts / useSubmitTrainerIncident. ============ */

const fullName = (p: any) => (p ? `${p.first_name ?? ''} ${p.last_name ?? ''}`.replace(/\s+/g, ' ').trim() : '');

export const EVENT_META: Record<string, { label: string; color: string; icon: string }> = {
  referral: { label: 'Referral', color: C.green, icon: 'userPlus' },
  subscription_upgrade: { label: 'Subscription Upgrade', color: C.purple, icon: 'trend' },
  cross_sell: { label: 'Cross-sell', color: C.blue, icon: 'layers' },
  package_upgrade: { label: 'Package Upgrade', color: C.gold, icon: 'rupee' },
};

/* ---------- My Incentives (incentive_events) ---------- */
export type IncentiveEvent = { id: string; type: string; name: string; date: string };
export function useMyIncentives(crmId: string | null) {
  return useQuery({
    queryKey: ['crm-my-incentives', crmId],
    enabled: !!crmId,
    staleTime: 60_000,
    queryFn: async (): Promise<IncentiveEvent[]> => {
      const { data, error } = await supabase
        .from('incentive_events')
        .select('*, client:client_id(first_name, last_name)')
        .eq('user_id', crmId)
        .order('event_date', { ascending: false });
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as any[];
      // Referral rows: pull the referred client's name off the referrals row.
      const refIds = rows.filter((r) => r.event_type === 'referral' && r.reference_id).map((r) => r.reference_id);
      const refNames = new Map<string, string>();
      if (refIds.length) {
        const { data: refs } = await supabase.from('referrals').select('id, referred_client_name').in('id', refIds);
        (refs ?? []).forEach((r: any) => refNames.set(r.id, r.referred_client_name));
      }
      return rows.map((r) => ({
        id: r.id,
        type: r.event_type,
        name: (r.event_type === 'referral' && r.reference_id && refNames.get(r.reference_id)) || fullName(r.client) || r.new_value || 'Unknown',
        date: r.event_date,
      }));
    },
  });
}

/* ---------- Incentive month/date helpers (web utils/incentiveMonth.ts) ---------- */
export const currentIncentiveMonthValue = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
export const monthValueToDate = (ym: string) => `${ym}-01`;
export const todayDateValue = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const formatIncentiveMonth = (ymd: string | null) => {
  if (!ymd) return '—';
  const [y, m] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, 1)).toLocaleDateString('en-IN', { timeZone: 'UTC', month: 'short', year: 'numeric' });
};
export const formatIncentiveDate = (ymd: string | null) => {
  if (!ymd) return '—';
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1)).toLocaleDateString('en-IN', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' });
};

/* ---------- My requests (single table crm_incentive_request, ALL statuses) ----------
   The new architecture: a request is ONLY a request. It never touches
   renewal/subscription/package tables — admin approval writes the
   incentive_events ledger and nothing else. */
export type MyIncentiveRequest = {
  id: string; type: string; clientName: string; details: string; status: 'pending' | 'approved' | 'rejected';
  adminNotes: string | null; incentiveMonth: string | null; incentiveDate: string | null; createdAt: string;
};
export const describeIncentiveDetails = (type: string, d: any): string =>
  type === 'referral' ? [d?.referred_client_phone, d?.referred_client_email].filter(Boolean).join(' · ') || 'New client referral'
  : type === 'subscription_upgrade' ? `${d?.previous_subscription_type ?? '—'} → ${d?.new_subscription_type ?? '—'}`
  : type === 'cross_sell' ? `${d?.service_name ?? 'Service'}${d?.sessions_total ? ` — ${d.sessions_total} sessions` : ''}`
  : `${d?.previous_package ?? '—'} → ${d?.new_package ?? '—'} sessions${d?.package_duration ? ` · ${d.package_duration} months` : ''}`;

export function useMyIncentiveRequests(crmId: string | null) {
  return useQuery({
    queryKey: ['crm-pending-incentive-requests', crmId],
    enabled: !!crmId,
    staleTime: 30_000,
    queryFn: async (): Promise<MyIncentiveRequest[]> => {
      const { data, error } = await supabase
        .from('crm_incentive_request')
        .select('id, request_type, client_id, incentive_month, incentive_date, details, status, admin_notes, created_at')
        .eq('requested_by', crmId)
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as any[];
      const clientIds = [...new Set(rows.map((r) => r.client_id).filter(Boolean))];
      const names = new Map<string, string>();
      if (clientIds.length) {
        const { data: cs } = await supabase.from('clients').select('id, first_name, last_name').in('id', clientIds);
        (cs ?? []).forEach((c: any) => names.set(c.id, fullName(c) || 'Client'));
      }
      return rows.map((r) => ({
        id: r.id, type: r.request_type,
        clientName: r.client_id ? (names.get(r.client_id) ?? 'Client') : (r.details?.referred_client_name ?? 'Referral'),
        details: describeIncentiveDetails(r.request_type, r.details),
        status: r.status, adminNotes: r.admin_notes ?? null,
        incentiveMonth: r.incentive_month ?? null, incentiveDate: r.incentive_date ?? null,
        createdAt: r.created_at,
      }));
    },
  });
}

/* ---------- Leaderboard (approved referrals + incentive_events, all CRMs) ---------- */
export type LeaderRow = { userId: string; name: string; referrals: number; crossSells: number; packageUpgrades: number; subscriptionUpgrades: number; total: number; rank: number };
export function useIncentiveLeaderboard(period: 'month' | 'all') {
  return useQuery({
    queryKey: ['crm-incentive-leaderboard', period],
    staleTime: 120_000,
    queryFn: async (): Promise<LeaderRow[]> => {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      // Everything tallies from the incentive_events ledger only (new architecture):
      // legacy referral approvals also wrote events, so referrals count across eras.
      let evQ = supabase.from('incentive_events').select('user_id, event_type, event_date');
      if (period === 'month') evQ = evQ.gte('event_date', monthStart);
      const [evR, crmR] = await Promise.all([evQ, supabase.from('profiles').select('id, first_name, last_name, role').eq('role', 'crm')]);

      const rows = new Map<string, LeaderRow>();
      ((crmR.data ?? []) as any[]).forEach((p) => rows.set(p.id, { userId: p.id, name: fullName(p) || 'CRM', referrals: 0, crossSells: 0, packageUpgrades: 0, subscriptionUpgrades: 0, total: 0, rank: 0 }));
      ((evR.data ?? []) as any[]).forEach((r) => {
        const e = rows.get(r.user_id); if (!e) return;
        if (r.event_type === 'referral') e.referrals++;
        else if (r.event_type === 'cross_sell') e.crossSells++;
        else if (r.event_type === 'package_upgrade') e.packageUpgrades++;
        else if (r.event_type === 'subscription_upgrade') e.subscriptionUpgrades++;
      });
      return [...rows.values()]
        .map((e) => ({ ...e, total: e.referrals + e.crossSells + e.packageUpgrades + e.subscriptionUpgrades }))
        .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
        .map((e, i) => ({ ...e, rank: i + 1 }));
    },
  });
}

/* ---------- Raise request — ONE insert into crm_incentive_request ----------
   New architecture (web parity): the request has no domain side effects.
   No renewal row, no package row, no subscription-history row is created;
   admin approval writes the incentive_events ledger and nothing else. */
export function useRaiseIncentiveRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input:
      | { kind: 'referral'; crmId: string; month: string; date: string; name: string; phone?: string; email?: string; notes?: string }
      | { kind: 'subscription_upgrade'; crmId: string; month: string; date: string; clientId: string; previous: string | null; next: string; reason?: string }
      | { kind: 'cross_sell'; crmId: string; month: string; date: string; clientId: string; service: string; sessions?: number; notes?: string }
      | { kind: 'package_upgrade'; crmId: string; month: string; date: string; clientId: string; previousSessions: string | null; newSessions: string; durationMonths: string; notes?: string }
    ) => {
      const details =
        input.kind === 'referral' ? {
          referred_client_name: input.name.trim(),
          referred_client_phone: input.phone?.trim() || null,
          referred_client_email: input.email?.trim() || null,
          notes: input.notes?.trim() || null,
        } : input.kind === 'subscription_upgrade' ? {
          previous_subscription_type: input.previous,
          new_subscription_type: input.next.trim(),
          reason: input.reason?.trim() || null,
        } : input.kind === 'cross_sell' ? {
          service_name: input.service.trim(),
          sessions_total: input.sessions ?? null,
          notes: input.notes?.trim() || null,
        } : {
          previous_package: input.previousSessions,
          new_package: input.newSessions.trim(),
          package_duration: parseInt(input.durationMonths) || null,
          package_sessions: parseInt(input.newSessions) || null,
          notes: input.notes?.trim() || null,
        };
      const { error } = await supabase.from('crm_incentive_request').insert({
        request_type: input.kind,
        requested_by: input.crmId,
        client_id: input.kind === 'referral' ? null : input.clientId,
        incentive_month: monthValueToDate(input.month),
        incentive_date: input.date,
        details,
        status: 'pending',
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['crm-pending-incentive-requests'] });
      qc.invalidateQueries({ queryKey: ['crm-my-incentives'] });
      qc.invalidateQueries({ queryKey: ['crm-incentives'] });
      qc.invalidateQueries({ queryKey: ['admin-incentive-requests'] });
      qc.invalidateQueries({ queryKey: ['pending-incentive-count'] });
    },
  });
}

/* ---------- Admin: request list / review / pending count ---------- */
export type AdminIncentiveRequest = {
  id: string; type: string; requesterId: string; requesterName: string;
  clientId: string | null; clientName: string; details: any; detailsText: string;
  incentiveMonth: string | null; incentiveDate: string | null;
  status: 'pending' | 'approved' | 'rejected'; adminNotes: string | null; createdAt: string;
};
export function useAdminIncentiveRequests(status: 'pending' | 'approved' | 'rejected' | 'all') {
  return useQuery({
    queryKey: ['admin-incentive-requests', status],
    staleTime: 20_000,
    queryFn: async (): Promise<AdminIncentiveRequest[]> => {
      let q = supabase
        .from('crm_incentive_request')
        .select('id, request_type, requested_by, client_id, incentive_month, incentive_date, details, status, admin_notes, created_at')
        .order('created_at', { ascending: false })
        .limit(300);
      if (status !== 'all') q = q.eq('status', status);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as any[];
      // Separate .in() lookups, no joins (web parity — avoids RLS join failures).
      const userIds = [...new Set(rows.map((r) => r.requested_by).filter(Boolean))];
      const clientIds = [...new Set(rows.map((r) => r.client_id).filter(Boolean))];
      const [pr, cr] = await Promise.all([
        userIds.length ? supabase.from('profiles').select('id, first_name, last_name').in('id', userIds) : Promise.resolve({ data: [] } as any),
        clientIds.length ? supabase.from('clients').select('id, first_name, last_name').in('id', clientIds) : Promise.resolve({ data: [] } as any),
      ]);
      const pName = new Map(((pr.data ?? []) as any[]).map((p) => [p.id, fullName(p) || 'CRM']));
      const cName = new Map(((cr.data ?? []) as any[]).map((c) => [c.id, fullName(c) || 'Client']));
      return rows.map((r) => ({
        id: r.id, type: r.request_type, requesterId: r.requested_by,
        requesterName: pName.get(r.requested_by) ?? 'CRM',
        clientId: r.client_id ?? null,
        clientName: r.client_id ? (cName.get(r.client_id) ?? 'Client') : (r.details?.referred_client_name ?? 'Referral'),
        details: r.details ?? {}, detailsText: describeIncentiveDetails(r.request_type, r.details),
        incentiveMonth: r.incentive_month ?? null, incentiveDate: r.incentive_date ?? null,
        status: r.status, adminNotes: r.admin_notes ?? null, createdAt: r.created_at,
      }));
    },
  });
}

export function usePendingIncentiveCount() {
  return useQuery({
    queryKey: ['pending-incentive-count'],
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from('crm_incentive_request')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending');
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
  });
}

/* Approval mapping (§1.5): update the request, then ONE ledger insert. */
export function useReviewIncentiveRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { request: AdminIncentiveRequest; decision: 'approved' | 'rejected'; adminId: string; adminNotes?: string }) => {
      const { request, decision } = input;
      const { error } = await supabase.from('crm_incentive_request').update({
        status: decision,
        admin_notes: input.adminNotes?.trim() || null,
        reviewed_by: input.adminId,
        reviewed_at: new Date().toISOString(),
      }).eq('id', request.id);
      if (error) throw new Error(error.message);
      if (decision === 'approved') {
        const d = request.details ?? {};
        const { error: eErr } = await supabase.from('incentive_events').insert({
          user_id: request.requesterId,
          event_type: request.type,
          client_id: request.clientId,
          reference_id: request.id,
          reference_table: 'crm_incentive_request',
          event_month: request.incentiveMonth,
          // IST midnight of the event date (web parity) — falls back to now.
          event_date: request.incentiveDate ? new Date(`${request.incentiveDate}T00:00:00+05:30`).toISOString() : new Date().toISOString(),
          new_value: request.type === 'referral'
            ? (d.referred_client_name ?? null)
            : (d.new_subscription_type ?? d.service_name ?? d.new_package ?? null),
          previous_value: d.previous_subscription_type ?? d.previous_package ?? null,
        });
        if (eErr) throw new Error(`Approved, but the incentive event failed: ${eErr.message}`);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-incentive-requests'] });
      qc.invalidateQueries({ queryKey: ['pending-incentive-count'] });
      qc.invalidateQueries({ queryKey: ['crm-pending-incentive-requests'] });
      qc.invalidateQueries({ queryKey: ['crm-incentive-leaderboard'] });
      qc.invalidateQueries({ queryKey: ['crm-my-incentives'] });
      qc.invalidateQueries({ queryKey: ['crm-incentives'] });
      qc.invalidateQueries({ queryKey: ['incentive-leaderboard'] });
    },
  });
}

/* ---------- Report a trainer incident (web useSubmitTrainerIncident) ---------- */
export function useSubmitIncident() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { crmId: string; trainerId: string; message: string }) => {
      const msg = input.message.trim();
      if (!msg) throw new Error('Describe the incident first');
      if (msg.length > 2000) throw new Error('Keep it under 2000 characters');
      const { error } = await supabase.from('trainers_incidents').insert({
        trainer_id: input.trainerId,
        author_id: input.crmId,
        author_role: 'crm',
        message: msg,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['crm-incident-trainers'] });
      qc.invalidateQueries({ queryKey: ['crm-trainer-incidents'] });
    },
  });
}
