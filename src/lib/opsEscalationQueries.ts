import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { profileName } from './opsLeadQueries';

/* ============ Ops — Escalations desk (web src/hooks/use*Escalations.ts port) ============
   All 8 category hooks share one pattern: escalations WHERE source_type = X AND
   escalated_at >= ESCALATIONS_SINCE (+ status), my_tier derived from
   level1_user_id/level2_user_id. QHP remarks append into details.remarks.{t1|t2};
   the generic resolve writes status/completed_at/completed_by/remark. */

export const ESCALATIONS_SINCE = '2026-06-01T00:00:00+05:30';

export type EscalationRow = {
  id: string; source_id: string | null; title: string | null; status: 'open' | 'completed';
  current_level: number | null; due_at: string | null; escalated_at: string;
  level1_user_id: string | null; level2_user_id: string | null; details: any; my_tier: 1 | 2 | null;
};
export type EscCategory = {
  key: string; sourceType: string; label: string; rule: string; ladder: string; resolves: string;
  orderBy: 'due_at' | 'escalated_at'; desc?: boolean; countMode: 'tier2' | 'tier2_level2' | 'tier2_level2plus' | 'all';
};
export const ESC_CATEGORIES: EscCategory[] = [
  { key: 'qhp_overdue', sourceType: 'qhp_scheduled_pending', label: 'QHP Overdue', rule: 'QHP scheduled but still pending 9h after the scheduled time.', ladder: 'T1 CRM → Ops (9h) → Super Admin (24h)', resolves: 'QHP is conducted / marked complete.', orderBy: 'due_at', countMode: 'tier2' },
  { key: 'comm_log', sourceType: 'communication_log_missing', label: 'Communication Logs', rule: 'Active paying client with no Counselling Done logged in 11+ days.', ladder: 'T1 CRM (day 10) → Ops (day 11) → Super Admin (day 12)', resolves: 'A counselling log is recorded.', orderBy: 'escalated_at', countMode: 'tier2_level2' },
  { key: 'no_session', sourceType: 'no_recent_session', label: 'No Recent Sessions', rule: 'Active paying client with no completed session in 9+ days.', ladder: 'T1 CRM (day 7) → Ops (day 9) → Super Admin (day 12)', resolves: 'A session is completed.', orderBy: 'escalated_at', countMode: 'tier2_level2plus' },
  { key: 'roster_expired', sourceType: 'roster_expired_no_session', label: 'Roster Expired', rule: 'Roster expired and no session scheduled for tomorrow.', ladder: 'T1 CRM → Ops (24h) → Super Admin (48h)', resolves: 'A future session is scheduled.', orderBy: 'escalated_at', countMode: 'tier2_level2plus' },
  { key: 'single_trainer_14d', sourceType: 'single_trainer_first_14d', label: 'Single Trainer 14d', rule: "Only one non-doctor trainer in the client's first 14 days.", ladder: 'T1 CRM → Ops (24h) → Super Admin (48h)', resolves: 'A second distinct trainer logs a session.', orderBy: 'escalated_at', countMode: 'tier2_level2plus' },
  { key: 'multi_trainer_modality', sourceType: 'multi_trainer_same_modality', label: 'Multi-Trainer Modality', rule: '3+ distinct non-doctor trainers on the same modality.', ladder: 'T1 CRM → Ops (48h) → Super Admin (96h)', resolves: 'Distinct trainer count drops below 3.', orderBy: 'escalated_at', countMode: 'tier2_level2plus' },
  { key: 'renewal_pending', sourceType: 'package_exhausted_renewal_pending', label: 'Renewal Pending', rule: '0 sessions left and no renewal payment received.', ladder: 'T1 CRM → Ops (6h) → Super Admin (30h)', resolves: 'Renewal payment received / approved.', orderBy: 'escalated_at', countMode: 'tier2_level2plus' },
  { key: 'subscription_downgrade', sourceType: 'subscription_downgrade', label: 'Subscription Downgrades', rule: 'Client subscription tier was reduced.', ladder: 'Visible to Ops and Super Admin', resolves: 'Manually acknowledged.', orderBy: 'escalated_at', desc: true, countMode: 'all' },
];

export function useEscCategory(cat: EscCategory, status: 'open' | 'completed' | 'all', enabled: boolean) {
  return useQuery({
    queryKey: ['ops-esc', cat.sourceType, status],
    enabled,
    staleTime: 60_000,
    refetchInterval: 120_000,
    queryFn: async (): Promise<EscalationRow[]> => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id ?? null;
      const sel = cat.sourceType === 'subscription_downgrade'
        ? 'id, source_id, title, status, current_level, escalated_at, details'
        : 'id, source_id, title, status, current_level, due_at, escalated_at, level1_user_id, level2_user_id, details';
      let q: any = supabase.from('escalations').select(sel).eq('source_type', cat.sourceType).gte('escalated_at', ESCALATIONS_SINCE);
      if (status !== 'all') q = q.eq('status', status);
      q = q.order(cat.orderBy, { ascending: !cat.desc });
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map((r) => ({
        due_at: null, level1_user_id: null, level2_user_id: null, ...r,
        my_tier: uid && r.level1_user_id === uid ? 1 : uid && r.level2_user_id === uid ? 2 : null,
      }));
    },
  });
}
export const escCountFor = (rows: EscalationRow[], mode: EscCategory['countMode']): number => {
  if (mode === 'all') return rows.length;
  if (mode === 'tier2') return rows.filter((r) => r.my_tier === 2).length;
  if (mode === 'tier2_level2') return rows.filter((r) => r.my_tier === 2 && r.current_level === 2).length;
  return rows.filter((r) => r.my_tier === 2 && (r.current_level ?? 0) >= 2).length;
};

/* QHP tier remark — details.remarks.{t1|t2} = {text, by, by_name, at} (web useSaveQhpRemark). */
export function useSaveQhpEscRemark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; tier: 1 | 2; text: string; profile: any }) => {
      const trimmed = input.text.trim();
      if (trimmed.length < 3) throw new Error('Remark must be at least 3 characters.');
      const { data: row, error: rErr } = await supabase.from('escalations').select('details').eq('id', input.id).single();
      if (rErr) throw new Error(rErr.message);
      const existing = (row?.details ?? {}) as any;
      const nextDetails = { ...existing, remarks: { ...(existing.remarks ?? {}), [input.tier === 1 ? 't1' : 't2']: { text: trimmed, by: input.profile?.id, by_name: profileName(input.profile), at: new Date().toISOString() } } };
      const { error } = await supabase.from('escalations').update({ details: nextDetails }).eq('id', input.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ops-esc'] }),
  });
}
/* Generic resolve / flag / flat remark (web useUpdateEscalation). */
export function useUpdateEscalation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; status?: 'open' | 'completed'; is_flagged?: boolean; remark?: string; profileId?: string | null }) => {
      const patch: any = {};
      if (input.status !== undefined) {
        patch.status = input.status;
        if (input.status === 'completed') { patch.completed_at = new Date().toISOString(); patch.completed_by = input.profileId ?? null; }
      }
      if (input.is_flagged !== undefined) patch.is_flagged = input.is_flagged;
      if (input.remark !== undefined) patch.remark = input.remark;
      const { error } = await supabase.from('escalations').update(patch).eq('id', input.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ops-esc'] }),
  });
}

/* ---------------- Renewals Pending (derived, web useOpsRenewalsPending) ---------------- */
export type RenewalPendingRow = { clientId: string; clientName: string; assignedCrmName: string | null; packageSize: number; consumed: number; exhaustedAt: string; daysPending: number; lastRenewalAt: string | null };
export function useOpsRenewalsPending(enabled: boolean) {
  return useQuery({
    queryKey: ['ops-renewals-pending'],
    enabled,
    staleTime: 120_000,
    refetchInterval: 300_000,
    queryFn: async (): Promise<RenewalPendingRow[]> => {
      const { data: clients, error } = await supabase.from('clients').select('id, first_name, last_name, session_package, created_at, status').eq('status', 'active').limit(5000);
      if (error) throw new Error(error.message);
      const ids = (clients ?? []).map((c: any) => c.id);
      if (!ids.length) return [];
      const chunk = <T,>(a: T[], n = 100) => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
      const latestRenewal = new Map<string, { package_sessions: number; renewed_at: string }>();
      const sessionsByClient = new Map<string, string[]>();
      const crmByClient = new Map<string, string>();
      const trainerIdsAll = new Set<string>();
      const tcRows: any[] = [];
      for (const part of chunk(ids)) {
        const [{ data: ren }, { data: ts }, { data: tc }] = await Promise.all([
          supabase.from('client_renewals').select('client_id, package_sessions, renewed_at').in('client_id', part).eq('request_status', 'approved').order('renewed_at', { ascending: false }).limit(10000),
          supabase.from('training_sessions').select('client_id, scheduled_at').in('client_id', part).or('status.eq.completed,status.eq.cancelled,cancelled.eq.true').limit(50000),
          supabase.from('trainer_clients').select('client_id, trainer_id').in('client_id', part).eq('actively_training', true).limit(20000),
        ]);
        (ren ?? []).forEach((r: any) => { if (r.client_id && !latestRenewal.has(r.client_id)) latestRenewal.set(r.client_id, r); });
        (ts ?? []).forEach((r: any) => { if (!r.client_id || !r.scheduled_at) return; const arr = sessionsByClient.get(r.client_id) ?? []; arr.push(r.scheduled_at); sessionsByClient.set(r.client_id, arr); });
        (tc ?? []).forEach((r: any) => { if (r.trainer_id) trainerIdsAll.add(r.trainer_id); tcRows.push(r); });
      }
      const crmProfiles = new Map<string, string>();
      for (const part of chunk([...trainerIdsAll])) {
        const { data: profs } = await supabase.from('profiles').select('id, first_name, last_name, role').in('id', part);
        (profs ?? []).forEach((p: any) => { if (p.role === 'crm') crmProfiles.set(p.id, `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || 'CRM'); });
      }
      tcRows.forEach((r) => { if (r.client_id && crmProfiles.has(r.trainer_id) && !crmByClient.has(r.client_id)) crmByClient.set(r.client_id, crmProfiles.get(r.trainer_id)!); });

      const now = Date.now();
      const out: RenewalPendingRow[] = [];
      for (const c of (clients ?? []) as any[]) {
        const latest = latestRenewal.get(c.id) ?? null;
        const packageSize = latest ? Number(latest.package_sessions) || 0 : parseInt(String(c.session_package ?? ''), 10) || 0;
        if (packageSize <= 0) continue;
        const countFrom = latest ? latest.renewed_at : c.created_at;
        const dates = (sessionsByClient.get(c.id) ?? []).filter((d) => d >= countFrom).sort();
        if (dates.length < packageSize) continue;
        const exhaustedAt = dates[packageSize - 1];
        const exhaustedMs = new Date(exhaustedAt).getTime();
        if (now - exhaustedMs < 24 * 3600e3) continue;
        if (latest && new Date(latest.renewed_at).getTime() > exhaustedMs) continue;
        out.push({
          clientId: c.id, clientName: `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || '—',
          assignedCrmName: crmByClient.get(c.id) ?? null, packageSize, consumed: dates.length,
          exhaustedAt, daysPending: Math.floor((now - exhaustedMs) / 86400000), lastRenewalAt: latest?.renewed_at ?? null,
        });
      }
      return out.sort((a, b) => b.daysPending - a.daysPending);
    },
  });
}
