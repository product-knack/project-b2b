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

/* ---------- Pending requests (4 tables, mine, status pending) ---------- */
export type PendingRequest = { id: string; type: string; clientName: string; details: string; createdAt: string };
export function usePendingIncentiveRequests(crmId: string | null) {
  return useQuery({
    queryKey: ['crm-pending-incentive-requests', crmId],
    enabled: !!crmId,
    staleTime: 30_000,
    queryFn: async (): Promise<PendingRequest[]> => {
      const [refR, subR, xR, pkgR] = await Promise.all([
        supabase.from('referrals').select('id, referred_client_name, created_at, status').eq('referrer_id', crmId).eq('status', 'pending'),
        supabase.from('client_subscription_history').select('id, previous_subscription_type, new_subscription_type, created_at, status, client:client_id(first_name, last_name)').eq('requested_by', crmId).eq('status', 'pending'),
        supabase.from('client_packages').select('id, service_name, sessions_total, created_at, request_status, client:client_id(first_name, last_name)').eq('requested_by', crmId).eq('request_status', 'pending'),
        supabase.from('client_renewals').select('id, previous_package, new_package, package_duration, created_at, request_status, client:client_id(first_name, last_name)').eq('requested_by', crmId).eq('request_status', 'pending'),
      ]);
      const out: PendingRequest[] = [];
      (refR.data ?? []).forEach((r: any) => out.push({ id: r.id, type: 'referral', clientName: r.referred_client_name, details: 'New client referral', createdAt: r.created_at }));
      (subR.data ?? []).forEach((r: any) => out.push({ id: r.id, type: 'subscription_upgrade', clientName: fullName(r.client) || 'Client', details: `${r.previous_subscription_type ?? '—'} → ${r.new_subscription_type}`, createdAt: r.created_at }));
      (xR.data ?? []).forEach((r: any) => out.push({ id: r.id, type: 'cross_sell', clientName: fullName(r.client) || 'Client', details: `${r.service_name}${r.sessions_total ? ` — ${r.sessions_total} sessions` : ''}`, createdAt: r.created_at }));
      (pkgR.data ?? []).forEach((r: any) => out.push({ id: r.id, type: 'package_upgrade', clientName: fullName(r.client) || 'Client', details: `Package upgrade to ${r.new_package}${r.package_duration ? ` · ${r.package_duration} months` : ''}`, createdAt: r.created_at }));
      return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
      let refQ = supabase.from('referrals').select('referrer_id, status, created_at').eq('status', 'approved');
      if (period === 'month') refQ = refQ.gte('created_at', monthStart);
      let evQ = supabase.from('incentive_events').select('user_id, event_type, event_date');
      if (period === 'month') evQ = evQ.gte('event_date', monthStart);
      const [refR, evR, crmR] = await Promise.all([refQ, evQ, supabase.from('profiles').select('id, first_name, last_name, role').eq('role', 'crm')]);

      const rows = new Map<string, LeaderRow>();
      ((crmR.data ?? []) as any[]).forEach((p) => rows.set(p.id, { userId: p.id, name: fullName(p) || 'CRM', referrals: 0, crossSells: 0, packageUpgrades: 0, subscriptionUpgrades: 0, total: 0, rank: 0 }));
      ((refR.data ?? []) as any[]).forEach((r) => { const e = rows.get(r.referrer_id); if (e) e.referrals++; });
      ((evR.data ?? []) as any[]).forEach((r) => {
        const e = rows.get(r.user_id); if (!e) return;
        if (r.event_type === 'cross_sell') e.crossSells++;
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

/* ---------- Raise request (4 insert paths, exact web payloads) ---------- */
export function useRaiseIncentiveRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input:
      | { kind: 'referral'; crmId: string; name: string; phone?: string; email?: string; notes?: string }
      | { kind: 'subscription_upgrade'; crmId: string; clientId: string; previous: string | null; next: string; reason?: string }
      | { kind: 'cross_sell'; crmId: string; clientId: string; service: string; sessions?: number; notes?: string }
      | { kind: 'package_upgrade'; crmId: string; clientId: string; previousSessions: string | null; newSessions: string; durationMonths: string }
    ) => {
      if (input.kind === 'referral') {
        if (!input.name.trim()) throw new Error('Referred client name is required');
        const { error } = await supabase.from('referrals').insert({
          referrer_id: input.crmId,
          referred_client_name: input.name.trim(),
          referred_client_phone: input.phone?.trim() || null,
          referred_client_email: input.email?.trim() || null,
          notes: input.notes?.trim() || null,
          status: 'pending',
        });
        if (error) throw new Error(error.message);
      } else if (input.kind === 'subscription_upgrade') {
        const { error } = await supabase.from('client_subscription_history').insert({
          client_id: input.clientId,
          previous_subscription_type: input.previous,
          new_subscription_type: input.next,
          requested_by: input.crmId,
          change_reason: input.reason?.trim() || null,
          status: 'pending',
        });
        if (error) throw new Error(error.message);
      } else if (input.kind === 'cross_sell') {
        const { error } = await supabase.from('client_packages').insert({
          client_id: input.clientId,
          service_name: input.service,
          request_status: 'pending',
          requested_by: input.crmId,
          notes: input.notes?.trim() || null,
          sessions_total: input.sessions ?? null,
          expiry_date: new Date(Date.now() + 30 * 864e5).toISOString(),
          status: 'active',
        });
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase.from('client_renewals').insert({
          client_id: input.clientId,
          previous_package: input.previousSessions,
          new_package: input.newSessions,
          package_duration: parseInt(input.durationMonths) || null,
          package_sessions: parseInt(input.newSessions) || null,
          request_status: 'pending',
          requested_by: input.crmId,
        });
        if (error) throw new Error(error.message);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['crm-pending-incentive-requests'] });
      qc.invalidateQueries({ queryKey: ['crm-my-incentives'] });
      qc.invalidateQueries({ queryKey: ['crm-incentives'] });
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
