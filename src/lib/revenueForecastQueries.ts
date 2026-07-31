import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';

/* ============ Revenue Forecast (Admin + CRM) ============
   Native port of the web feature (doc: revenue-forecast-architecture.md).
   Backend (table revenue_forecast + RPCs sync_priority_achievements /
   append_revenue_forecast_remark + edge notify-priority-forecast) already
   exists — live-verified 2026-07-31. The pure functions below (sessions-left,
   remark-due) are ported VERBATIM from the doc; they are the only places
   behaviour can drift between web and native. */

/* ---------- month helpers ---------- */
export const monthKey = (d = new Date()) => {
  const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
};
export const monthLabel = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, 1)).toLocaleDateString('en-IN', { timeZone: 'UTC', month: 'long', year: 'numeric' });
};
export const shiftMonth = (ym: string, delta: number) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, (m || 1) - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
};

const chunk = <T,>(xs: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

/* ---------- JSONB shapes ---------- */
export type RemarkEntry = {
  id: string; author_id: string; author_name: string; author_role: string;
  type: 'remark' | 'reply'; parent_id: string | null;
  reason?: string; plan?: string; message?: string; created_at: string;
};
export type Achievement = {
  status: 'pending' | 'achieved';
  achieved_at?: string; source?: string; ref_id?: string; amount?: number;
  detected_at?: string; history?: any[];
};
export type FallShort = {
  status: 'fall_short' | 'reassigned';
  reason?: string; marked_at?: string; marked_by?: string; history?: any[];
} | null;
export type PriorityRow = {
  id: string; client_id: string; priority_month: string; marked_by: string | null;
  created_at: string; achievement: Achievement; baseline: { sessions_left_at_mark?: number | null; marked_at?: string } | null;
  remarks: RemarkEntry[]; fall_short: FallShort;
};

export const SOURCE_LABEL: Record<string, string> = {
  client_renewals: 'Renewal',
  additional_packages: 'Add-on package',
  additional_service_renewals: 'Add-on renewal',
};

/* ---------- §3 sessions-left math (verbatim) ---------- */
export function computeSessionsLeft(input: {
  packageSessions: number | null; cycleSessions: number | null; used: number;
}): { sessionsLeft: number | null; usedInCycle: number; cycleSessions: number | null; cycleNumber: number } {
  const { packageSessions, cycleSessions, used } = input;
  if (cycleSessions && cycleSessions > 0) {
    const remainder = used % cycleSessions;
    const usedInCycle = used === 0 ? 0 : remainder === 0 ? cycleSessions : remainder;
    const sessionsLeft = used === 0 ? cycleSessions : remainder === 0 ? 0 : cycleSessions - remainder;
    const cycleNumber = used === 0 ? 1 : Math.floor((used - 1) / cycleSessions) + 1;
    return { sessionsLeft, usedInCycle, cycleSessions, cycleNumber };
  }
  const usedInCycle = used;
  const sessionsLeft = packageSessions != null ? Math.max(packageSessions - used, 0) : null;
  return { sessionsLeft, usedInCycle, cycleSessions: packageSessions, cycleNumber: 1 };
}

/* ---------- §5.1 remark-due rule (verbatim) ---------- */
export function remarkDue(input: {
  baseline: { sessions_left_at_mark?: number | null } | null;
  liveSessionsLeft: number | null;
  consumedSinceMark: number;
  remarks: RemarkEntry[];
  achieved: boolean;
}): { due: boolean; pending: number; required: number; given: number; reason: 'sessions_consumed' | 'zero_at_mark' } {
  const baseLeft = input.baseline?.sessions_left_at_mark ?? input.liveSessionsLeft ?? null;
  const zeroAtMark = baseLeft !== null && baseLeft <= 0;
  const required = (zeroAtMark ? 1 : 0) + Math.max(0, input.consumedSinceMark);
  const given = input.remarks.filter((r) => r.type === 'remark').length;
  const pending = Math.max(0, required - given);
  const due = pending > 0 && !input.achieved;
  return { due, pending, required, given, reason: input.consumedSinceMark > 0 ? 'sessions_consumed' : 'zero_at_mark' };
}
export const latestCrmRemark = (remarks: RemarkEntry[]) =>
  remarks.filter((r) => r.type === 'remark').sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))[0] ?? null;
export const hasUnansweredRemark = (remarks: RemarkEntry[]) => {
  const last = latestCrmRemark(remarks);
  if (!last) return false;
  return !remarks.some((r) => r.type === 'reply' && (r.created_at || '') > (last.created_at || ''));
};
export const latestRemarkAt = (remarks: RemarkEntry[]) => latestCrmRemark(remarks)?.created_at ?? null;

/* ---------- §3 master client list ---------- */
export type ForecastClient = {
  clientId: string; name: string; email: string | null;
  statusBucket: 'active' | 'without_subscription' | 'inactive' | 'discontinued' | 'other';
  subscriptionType: string | null;
  sessionsLeft: number | null; usedInCycle: number; cycleSessions: number | null; cycleNumber: number;
  lastRenewalDate: string | null;
  crmId: string | null; crmName: string | null;
};

export function useRevenueForecastClients() {
  return useQuery({
    queryKey: ['rev-forecast-clients'],
    staleTime: 120_000,
    queryFn: async (): Promise<ForecastClient[]> => {
      // 1. unified_clients, paginated past the PostgREST 1000-row cap.
      const clients: any[] = [];
      for (let fromIdx = 0; ; fromIdx += 1000) {
        const { data, error } = await supabase
          .from('unified_clients')
          .select('id, first_name, last_name, email, status, subscription_type, session_package, sessions_per_cycle, created_at')
          .range(fromIdx, fromIdx + 999);
        if (error) throw new Error(error.message);
        clients.push(...(data ?? []));
        if ((data ?? []).length < 1000) break;
      }
      const rows = clients.filter((c) => {
        const name = `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim();
        if (name.startsWith('[merged]') || name.includes('(dup of')) return false;
        const sub = (c.subscription_type ?? '').toLowerCase();
        return sub !== 'trial' && sub !== 'influencer';
      });
      const ids = rows.map((c) => c.id);

      // 2-5. Renewals, payment-date fallback, session usage, CRM assignment — all chunked.
      const renewalByClient = new Map<string, any>();
      const payDateByClient = new Map<string, string>();
      const usageByClient = new Map<string, { scheduled_at: string; status: string }[]>();
      const crmByClient = new Map<string, { id: string; name: string }>();
      await Promise.all([
        (async () => {
          for (const ch of chunk(ids, 100)) {
            const { data, error } = await supabase
              .from('client_renewals')
              .select('client_id, renewed_at, payment_date, package_sessions, cycle_sessions')
              .eq('request_status', 'approved')
              .in('client_id', ch)
              .order('renewed_at', { ascending: false });
            if (error) throw new Error(error.message);
            (data ?? []).forEach((r: any) => { if (!renewalByClient.has(r.client_id)) renewalByClient.set(r.client_id, r); });
          }
        })(),
        (async () => {
          for (const ch of chunk(ids, 100)) {
            const { data } = await supabase.from('clients').select('id, payment_date').in('id', ch);
            (data ?? []).forEach((r: any) => { if (r.payment_date) payDateByClient.set(r.id, r.payment_date); });
          }
        })(),
        (async () => {
          for (const ch of chunk(ids, 200)) {
            const { data, error } = await supabase.rpc('get_ops_client_session_usage', { _client_ids: ch });
            if (error) throw new Error(error.message);
            (data ?? []).forEach((r: any) => {
              if (!usageByClient.has(r.client_id)) usageByClient.set(r.client_id, []);
              usageByClient.get(r.client_id)!.push({ scheduled_at: r.scheduled_at, status: r.status });
            });
          }
        })(),
        (async () => {
          for (const ch of chunk(ids, 100)) {
            const { data } = await supabase
              .from('trainer_clients')
              .select('client_id, trainer_id, profiles:trainer_id(id, first_name, last_name, role)')
              .eq('actively_training', true)
              .in('client_id', ch);
            (data ?? []).forEach((r: any) => {
              const p = r.profiles;
              if (p?.role === 'crm' && !crmByClient.has(r.client_id)) {
                crmByClient.set(r.client_id, { id: p.id, name: `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || 'CRM' });
              }
            });
          }
        })(),
      ]);

      return rows.map((c) => {
        const renewal = renewalByClient.get(c.id) ?? null;
        const start = renewal?.renewed_at ?? c.created_at;
        const used = (usageByClient.get(c.id) ?? []).filter((s) => s.scheduled_at >= start).length;
        const pkgRaw = renewal?.package_sessions ?? (c.session_package != null ? parseInt(String(c.session_package), 10) : null);
        const math = computeSessionsLeft({
          packageSessions: Number.isFinite(pkgRaw) ? pkgRaw : null,
          cycleSessions: renewal?.cycle_sessions ?? c.sessions_per_cycle ?? null,
          used,
        });
        const st = (c.status ?? '') as string;
        const statusBucket: ForecastClient['statusBucket'] =
          st === 'inactive' ? 'inactive'
          : st === 'discontinued' ? 'discontinued'
          : st === 'active' || st === '' ? (c.subscription_type ? 'active' : 'without_subscription')
          : 'other';
        const crm = crmByClient.get(c.id) ?? null;
        return {
          clientId: c.id,
          name: `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'Client',
          email: c.email ?? null,
          statusBucket,
          subscriptionType: c.subscription_type ?? null,
          ...math,
          lastRenewalDate: renewal?.renewed_at ?? renewal?.payment_date ?? payDateByClient.get(c.id) ?? null,
          crmId: crm?.id ?? null, crmName: crm?.name ?? null,
        };
      });
    },
  });
}

/* ---------- §4 priority lifecycle ---------- */
export function usePriorityRows(month: string) {
  return useQuery({
    queryKey: ['rev-forecast-rows', month],
    staleTime: 30_000,
    queryFn: async (): Promise<PriorityRow[]> => {
      // Sync achievements first (idempotent, safe to repeat) — page-load contract.
      await supabase.rpc('sync_priority_achievements', { p_month: month }).then(() => {}, () => {});
      const { data, error } = await supabase
        .from('revenue_forecast')
        .select('id, client_id, priority_month, marked_by, created_at, achievement, baseline, remarks, fall_short')
        .eq('priority_month', month);
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map((r) => ({
        ...r,
        achievement: r.achievement ?? { status: 'pending' },
        remarks: Array.isArray(r.remarks) ? r.remarks : [],
        fall_short: r.fall_short ?? null,
      })) as PriorityRow[];
    },
  });
}

export function useForecastMonths(current: string) {
  return useQuery({
    queryKey: ['rev-forecast-months'],
    staleTime: 60_000,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase
        .from('revenue_forecast')
        .select('priority_month')
        .order('priority_month', { ascending: false })
        .limit(2000);
      if (error) throw new Error(error.message);
      const set = new Set<string>((data ?? []).map((r: any) => r.priority_month));
      set.add(current);
      return [...set].sort().reverse();
    },
  });
}

/* Derived sets (§4) — pure so both dashboards share it. */
export function derivePrioritySets(rows: PriorityRow[]) {
  const fallShortRows = rows.filter((r) => r.fall_short?.status === 'fall_short');
  const priorityRowsActive = rows.filter((r) => r.fall_short?.status !== 'fall_short');
  const achievedIds = new Set(priorityRowsActive.filter((r) => r.achievement.status === 'achieved').map((r) => r.client_id));
  const pendingIds = new Set(priorityRowsActive.filter((r) => r.achievement.status !== 'achieved').map((r) => r.client_id));
  const fallShortAnyIds = new Set(rows.filter((r) => !!r.fall_short?.status).map((r) => r.client_id));
  const byClient = new Map(rows.map((r) => [r.client_id, r]));
  return {
    fallShortRows, priorityRowsActive,
    priorityIds: new Set(priorityRowsActive.map((r) => r.client_id)),
    achievedIds, pendingIds,
    fallShortIds: new Set(fallShortRows.map((r) => r.client_id)),
    fallShortAnyIds, byClient,
  };
}

const invalidateForecast = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: ['rev-forecast-rows'] });
  qc.invalidateQueries({ queryKey: ['rev-forecast-months'] });
  qc.invalidateQueries({ queryKey: ['rev-forecast-consumed'] });
};

export function useMarkPriority() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { clientIds: string[]; month: string; markedBy: string; sessionsLeft: Map<string, number | null> }) => {
      const now = new Date().toISOString();
      const payload = input.clientIds.map((id) => ({
        client_id: id, priority_month: input.month, marked_by: input.markedBy,
        achievement: { status: 'pending' },
        baseline: { sessions_left_at_mark: input.sessionsLeft.get(id) ?? null, marked_at: now },
      }));
      const { error } = await supabase
        .from('revenue_forecast')
        .upsert(payload, { onConflict: 'client_id,priority_month', ignoreDuplicates: true });
      if (error) throw new Error(error.message);
      // Re-marking someone who fell short archives the fall-short record —
      // history is never destroyed (web parity).
      const { data: fsRows } = await supabase
        .from('revenue_forecast')
        .select('id, fall_short')
        .eq('priority_month', input.month)
        .in('client_id', input.clientIds);
      for (const r of (fsRows ?? []) as any[]) {
        const fs = r.fall_short;
        if (fs?.status === 'fall_short') {
          const history = [...(fs.history ?? []), { reason: fs.reason, marked_at: fs.marked_at, marked_by: fs.marked_by }];
          await supabase.from('revenue_forecast').update({ fall_short: { status: 'reassigned', history } }).eq('id', r.id);
        }
      }
      // Fire-and-forget push fan-out (edge function has its own de-dupe stamps).
      supabase.functions.invoke('notify-priority-forecast', {
        body: { mode: 'assigned', month: input.month, client_ids: input.clientIds },
      }).catch(() => {});
    },
    onSuccess: () => invalidateForecast(qc),
  });
}

export function useRemovePriority() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { clientId: string; month: string }) => {
      const { error } = await supabase
        .from('revenue_forecast').delete()
        .eq('client_id', input.clientId).eq('priority_month', input.month);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => invalidateForecast(qc),
  });
}

export function useMarkFallShort() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { row: PriorityRow; reason: string; markedBy: string }) => {
      const prev = input.row.fall_short;
      const history = [
        ...((prev?.history ?? []) as any[]),
        ...(prev?.reason ? [{ reason: prev.reason, marked_at: prev.marked_at, marked_by: prev.marked_by }] : []),
      ];
      const { error } = await supabase.from('revenue_forecast').update({
        fall_short: { status: 'fall_short', reason: input.reason.trim(), marked_at: new Date().toISOString(), marked_by: input.markedBy, history },
      }).eq('id', input.row.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => invalidateForecast(qc),
  });
}

/* ---------- §5.2 consumedSinceMark ---------- */
export function useConsumedSinceMark(rows: PriorityRow[]) {
  const active = rows.filter((r) => r.fall_short?.status !== 'fall_short');
  const key = active.map((r) => r.client_id).sort().join(',');
  return useQuery({
    queryKey: ['rev-forecast-consumed', key],
    enabled: active.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<Map<string, number>> => {
      const now = new Date().toISOString();
      const out = new Map<string, number>();
      const markAt = new Map(active.map((r) => [r.client_id, r.baseline?.marked_at ?? r.created_at]));
      for (const ch of chunk(active.map((r) => r.client_id), 100)) {
        const { data, error } = await supabase
          .from('session_schedule')
          .select('client_id, scheduled_datetime, status')
          .in('client_id', ch)
          .lte('scheduled_datetime', now);
        if (error) throw new Error(error.message);
        (data ?? []).forEach((s: any) => {
          if (s.status === 'completed') return; // completed slots never require a remark
          const from = markAt.get(s.client_id);
          if (from && s.scheduled_datetime >= from) out.set(s.client_id, (out.get(s.client_id) ?? 0) + 1);
        });
      }
      return out;
    },
  });
}

/* ---------- §5.3 remark writes ---------- */
export function useAddForecastRemark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      clientId: string; month: string; authorName: string;
      entry: { type: 'remark'; reason: string; plan: string } | { type: 'reply'; parent_id: string; message: string };
    }) => {
      const { error } = await supabase.rpc('append_revenue_forecast_remark', {
        p_client_id: input.clientId, p_month: input.month,
        p_entry: { ...input.entry, author_name: input.authorName },
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => invalidateForecast(qc),
  });
}

/* ---------- §6 CRM scoping ---------- */
export function useMyCrmClientIds(crmId: string | null) {
  return useQuery({
    queryKey: ['rev-forecast-my-clients', crmId],
    enabled: !!crmId,
    staleTime: 120_000,
    queryFn: async (): Promise<Set<string>> => {
      const out = new Set<string>();
      // A CRM's book is bounded (few hundred) — one filtered read is enough.
      const { data, error } = await supabase
        .from('trainer_clients')
        .select('client_id')
        .eq('trainer_id', crmId!)
        .eq('actively_training', true)
        .limit(2000);
      if (error) throw new Error(error.message);
      (data ?? []).forEach((r: any) => out.add(r.client_id));
      return out;
    },
  });
}

/* Banner counts (§1/§6): my non-achieved, non-fall-short priority rows this month. */
export function useCrmForecastBanner(crmId: string | null) {
  const month = monthKey();
  const rowsQ = usePriorityRows(month);
  const mineQ = useMyCrmClientIds(crmId);
  const consumedQ = useConsumedSinceMark(rowsQ.data ?? []);
  const rows = (rowsQ.data ?? []).filter(
    (r) => r.achievement.status !== 'achieved' && r.fall_short?.status !== 'fall_short' && mineQ.data?.has(r.client_id)
  );
  const threeDaysAgo = new Date(Date.now() - 3 * 864e5).toISOString();
  const newCount = rows.filter((r) => r.created_at >= threeDaysAgo).length;
  const dueCount = rows.filter((r) =>
    remarkDue({ baseline: r.baseline, liveSessionsLeft: null, consumedSinceMark: consumedQ.data?.get(r.client_id) ?? 0, remarks: r.remarks, achieved: false }).due
  ).length;
  return { total: rows.length, newCount, dueCount, isLoading: rowsQ.isLoading || mineQ.isLoading, month };
}
