import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';

/* ============ Admin workspace — data layer (web /admin AdminDashboard port) ============
   KPIs come from two super-admin RPCs (verified live as oddsfitnessapp@gmail.com):
   get_super_admin_active_clients_breakdown(p_range:'month') and
   get_super_admin_analytics(p_range:'month'). Alert hooks port the web banner
   components' exact queries + client-side filters. */

export type BarPoint = { label: string; value: number };

/* Web useSuperAdminAnalytics pctDelta: one decimal; prev=0 → 100 if curr else 0. */
export const pctDelta = (curr: number, prev: number): number => {
  if (!prev) return curr ? 100 : 0;
  return Math.round(((curr - prev) / prev) * 1000) / 10;
};

/* Web SuperAdminRevenue `inr` compact formatter. */
export const inr = (n: number): string =>
  n >= 1e7 ? `₹${(n / 1e7).toFixed(2)}Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(2)}L` : n >= 1e3 ? `₹${(n / 1e3).toFixed(1)}K` : `₹${Math.round(n)}`;

/* ---------------- KPI 1+3: Active clients breakdown (this month, IST windows server-side) ---------------- */
export type ActiveClientRow = {
  clientId: string; clientName: string | null; subscription: string | null; lastSessionAt: string | null;
  isActive: boolean; isTraining: boolean; isPullback: boolean; isPaused: boolean;
  pauseStart: string | null; pauseEnd: string | null; pauseReason: string | null;
};
export type ActiveClientsBreakdown = { activePaying: number; activeTraining: number; pullback: number; series: BarPoint[]; clients: ActiveClientRow[] };
export function useActiveClientsBreakdown() {
  return useQuery({
    queryKey: ['admin-active-clients-breakdown', 'month'],
    staleTime: 300_000,
    queryFn: async (): Promise<ActiveClientsBreakdown> => {
      const { data, error } = await supabase.rpc('get_super_admin_active_clients_breakdown', { p_range: 'month' });
      if (error) throw new Error(error.message);
      const r: any = data ?? {};
      return {
        activePaying: Number(r.activePaying ?? 0),
        activeTraining: Number(r.activeTraining ?? 0), // same value as activePaying (two aliases, web parity)
        pullback: Number(r.pullback ?? 0),
        series: Array.isArray(r.series) ? r.series.map((b: any) => ({ label: String(b.label ?? ''), value: Number(b.value ?? 0) })) : [],
        clients: Array.isArray(r.clients) ? r.clients.map((c: any): ActiveClientRow => ({
          clientId: String(c.clientId ?? ''), clientName: c.clientName ?? null, subscription: c.subscription ?? null,
          lastSessionAt: c.lastSessionAt ?? null, isActive: Boolean(c.isActive), isTraining: Boolean(c.isTraining),
          isPullback: Boolean(c.isPullback), isPaused: Boolean(c.isPaused),
          pauseStart: c.pauseStart ?? null, pauseEnd: c.pauseEnd ?? null, pauseReason: c.pauseReason ?? null,
        })) : [],
      };
    },
  });
}

/* ---------------- KPI 2: Revenue (this month vs previous, weekly buckets W1..W5) ---------------- */
export type RevenueBlock = { total: number; prevTotal: number; deltaPct: number; data: BarPoint[] };
export function useAdminRevenue() {
  return useQuery({
    queryKey: ['admin-analytics', 'month'],
    staleTime: 300_000,
    queryFn: async (): Promise<RevenueBlock> => {
      const { data, error } = await supabase.rpc('get_super_admin_analytics', { p_range: 'month' });
      if (error) throw new Error(error.message);
      const m: any = (data as any)?.revenue ?? {};
      const total = Number(m.currTotal ?? 0);
      const prevTotal = Number(m.prevTotal ?? 0);
      return {
        total, prevTotal, deltaPct: pctDelta(total, prevTotal),
        data: Array.isArray(m.data) ? m.data.map((d: any) => ({ label: String(d.label ?? ''), value: Number(d.value ?? 0) })) : [],
      };
    },
  });
}

/* ---------------- Revenue stream breakdown (web RevenueBreakdownCard) ----------------
   get_super_admin_metric_details {p_metric:'revenue'} → breakdown [{label,value}] —
   streams like Renewal / New / Misc / Add-on; only the `breakdown` key is consumed (web parity).
   Verified live: [{label:'Renewal',value:1871328},{label:'New',value:346239}]. */
export function useRevenueBreakdown(enabled: boolean) {
  return useQuery({
    queryKey: ['admin-revenue-breakdown', 'month'],
    enabled,
    staleTime: 300_000,
    queryFn: async (): Promise<BarPoint[]> => {
      const { data, error } = await supabase.rpc('get_super_admin_metric_details', { p_metric: 'revenue', p_range: 'month' });
      if (error) throw new Error(error.message);
      const r: any = data ?? {};
      return Array.isArray(r.breakdown) ? r.breakdown.map((b: any) => ({ label: String(b.label ?? '—'), value: Number(b.value ?? 0) })) : [];
    },
  });
}

/* ---------------- Alert A: new client-card requests from Ops (web useAdminNewLeads) ----------------
   Full port: QHP-Booked stage_history cutoff (2026-05-31 IST) + phone/name self-heal filter.
   DIVERGENCE (deliberate): web also fire-and-forget backfills client_id on confident matches;
   this read-only dashboard only HIDES them — the visible count is identical. */
const QHP_BOOKED_CUTOFF_MS = new Date('2026-05-30T18:30:00.000Z').getTime(); // 2026-05-31 00:00 IST
export function useAdminNewLeads() {
  return useQuery({
    queryKey: ['admin-new-leads'],
    refetchInterval: 30_000,
    staleTime: 0,
    queryFn: async (): Promise<number> => {
      const { data, error } = await supabase.from('leads')
        .select('id, name, contact_no, stage, stage_history, updated_at, invoice_details, client_id')
        .in('stage', ['QHP Booked', 'Raise invoice'])
        .is('client_id', null)
        .order('updated_at', { ascending: false });
      if (error) throw new Error(error.message);
      const all = (data ?? []) as any[];
      if (!all.length) return 0;
      const qhpBookedAtMs = (l: any): number | null => {
        const entries = (Array.isArray(l.stage_history) ? l.stage_history : []).filter((h: any) => h?.stage === 'QHP Booked' && h?.at);
        if (entries.length) return entries.reduce((max: number, h: any) => Math.max(max, new Date(h.at).getTime()), 0);
        return l.updated_at ? new Date(l.updated_at).getTime() : null; // legacy fallback
      };
      const leads = all.filter((l) => {
        if (l.stage === 'Raise invoice') return true; // new flow, no cutoff
        const at = qhpBookedAtMs(l);
        return at !== null && at >= QHP_BOOKED_CUTOFF_MS;
      });
      if (!leads.length) return 0;

      // Self-heal filter: hide leads whose phone suffix matches exactly ONE client with a matching name.
      const normalize = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');
      const suffixes = [...new Set(leads.map((l) => normalize(l.contact_no)).filter((p) => p.length >= 10).map((p) => p.slice(-10)))];
      type ClientMatch = { id: string; first_name: string | null; last_name: string | null };
      const phoneToClients = new Map<string, ClientMatch[]>();
      for (let i = 0; i < suffixes.length; i += 200) {
        const slice = suffixes.slice(i, i + 200);
        const { data: rows } = await supabase.from('clients').select('id, phone, first_name, last_name').or(slice.map((s) => `phone.ilike.%${s}`).join(','));
        for (const row of (rows ?? []) as any[]) {
          const suffix = normalize(row.phone).slice(-10);
          if (suffix.length !== 10) continue;
          const list = phoneToClients.get(suffix) ?? [];
          if (!list.some((r) => r.id === row.id)) list.push({ id: row.id, first_name: row.first_name, last_name: row.last_name });
          phoneToClients.set(suffix, list);
        }
      }
      const normalizeName = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
      const nameMatches = (leadName: string | null, c: ClientMatch): boolean => {
        const ln = normalizeName(leadName);
        const cn = normalizeName(`${c.first_name ?? ''} ${c.last_name ?? ''}`);
        if (!ln || !cn) return false;
        if (ln === cn) return true;
        const lnTokens = new Set(ln.split(' ').filter(Boolean));
        const cnTokens = cn.split(' ').filter(Boolean);
        return cnTokens.length > 0 && cnTokens.every((t) => lnTokens.has(t));
      };
      return leads.filter((l) => {
        const suffix = normalize(l.contact_no).slice(-10);
        const matches = suffix.length === 10 ? phoneToClients.get(suffix) ?? [] : [];
        return !(matches.length === 1 && nameMatches(l.name, matches[0]));
      }).length;
    },
  });
}

/* ---------------- Alert B: invoice-raised leads awaiting payment generation ---------------- */
const BUSY_STATUSES = ['awaiting_approval', 'awaiting_payment', 'failed', 'paid'];
export function useInvoiceRaisedLeads() {
  return useQuery({
    queryKey: ['admin-invoice-raised'],
    refetchInterval: 30_000,
    queryFn: async (): Promise<{ count: number; total: number }> => {
      const { data, error } = await supabase.from('leads')
        .select('id, client_id, invoice_details, updated_at')
        .eq('stage', 'Raise invoice')
        .not('invoice_details', 'is', null)
        .not('client_id', 'is', null)
        .order('updated_at', { ascending: false });
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as any[];
      if (!rows.length) return { count: 0, total: 0 };
      const clientIds = [...new Set(rows.map((l) => l.client_id).filter(Boolean))];
      const busy = new Set<string>();
      if (clientIds.length) {
        const { data: reqs } = await supabase.from('renewal_payment_requests')
          .select('client_id, payment_status, request_notes')
          .in('client_id', clientIds)
          .ilike('request_notes', '%"kind":"lead_invoice"%');
        (reqs ?? []).forEach((r: any) => { if (BUSY_STATUSES.includes(r.payment_status)) busy.add(r.client_id); });
      }
      const surviving = rows.filter((l) => !l.client_id || !busy.has(l.client_id));
      return { count: surviving.length, total: surviving.reduce((s, l) => s + (Number(l.invoice_details?.amount) || 0), 0) };
    },
  });
}

/* ---------------- Alert C: paid cancellation requests pending admin approval ---------------- */
export function usePaidCancellationsPending() {
  return useQuery({
    queryKey: ['admin-paid-cancellations', 'pending'],
    staleTime: 60_000,
    queryFn: async (): Promise<number> => {
      // Banner only needs the row count (web fetches rows + names for its tab; same number).
      const { count, error } = await supabase.from('session_schedule')
        .select('id', { count: 'exact', head: true })
        .eq('paid_cancellation', true)
        .eq('admin_approval', 'pending');
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
  });
}

/* ---------------- Alerts D–G: onboarding urgent alerts (web UnassignedClientsAlert +
   AdminOnboardingUrgentAlerts, both fed by useAdminClientOnboarding).
   All four only look at clients created on/after the web CUTOFF (2026-03-04 IST) that are
   not fully onboarded, so the primary query is pre-filtered to that window — same results,
   far less data. is_fully_onboarded = all 6 stages complete (qhp_scheduled, qhp_done,
   qhp_report, roster, workout_plan, first_session). ---------------- */
export const ONBOARDING_CUTOFF = '2026-03-04T00:00:00+05:30';
const EXCLUDED_TRAINER_IDS = ['782fe016-4ecc-4ebd-8de1-6554f2079feb']; // Mohit Rawat (web parity)
const isCompletedValue = (val: string | null | undefined): boolean => {
  if (!val) return false;
  const lower = String(val).toLowerCase().trim();
  return lower === 'yes' || lower === 'true' || /^\d{4}-\d{2}/.test(String(val));
};
const chunk = <T,>(a: T[], n = 80): T[][] => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

export type AdminUrgentAlerts = { noTrainer: number; noCrm: number; qhpNotScheduled: number; assessorDelayed: string[] };
export function useAdminUrgentAlerts() {
  return useQuery({
    queryKey: ['admin-urgent-alerts'],
    staleTime: 60_000,
    refetchInterval: 60_000,
    queryFn: async (): Promise<AdminUrgentAlerts> => {
      // Paginate past the PostgREST 1000-row cap (a single .limit() is server-clamped).
      const rows: any[] = [];
      for (let from = 0; ; from += 1000) {
        const { data: page, error } = await supabase.from('clients')
          .select('id, first_name, last_name, created_at, subscription_type')
          .eq('status', 'active')
          .not('subscription_type', 'is', null)
          .neq('subscription_type', 'Staff')
          .gte('created_at', ONBOARDING_CUTOFF)
          .order('created_at', { ascending: false })
          .range(from, from + 999);
        if (error) throw new Error(error.message);
        rows.push(...(page ?? []));
        if (!page || page.length < 1000) break;
      }
      if (!rows.length) return { noTrainer: 0, noCrm: 0, qhpNotScheduled: 0, assessorDelayed: [] };
      const ids = rows.map((c) => c.id);

      // Every sub-query THROWS on error — a silently-failed chunk would otherwise
      // fabricate counts (e.g. an empty trainer set flags every client as unassigned).
      const collect = async (parts: Promise<any[]>[]) => (await Promise.all(parts)).flat();
      const rpcRows = (fn: string) => supabase.rpc(fn, { p_client_ids: ids }).then((r: any) => {
        if (r.error) throw new Error(r.error.message);
        return r.data ?? [];
      });
      const [assessments, qhpDetailRows, rosters, plans, firstSessions, trainerAssignments] = await Promise.all([
        collect(chunk(ids).map(async (part) => {
          const { data, error } = await supabase.from('coach_assessment')
            .select('client_id, completed, assessment_scheduled, created_at')
            .in('client_id', part).order('assessment_date', { ascending: false });
          if (error) throw new Error(error.message);
          return data ?? [];
        })),
        // qhp_details: JS truthiness on the jsonb cols (web parity — a jsonb '""'/'0'/'false'
        // row must NOT count as a created report, so SQL not-null filtering isn't equivalent).
        collect(chunk(ids).map(async (part) => {
          const { data, error } = await supabase.from('qhp_details')
            .select('client_id, preapproved_qhp, qhp_json')
            .in('client_id', part);
          if (error) throw new Error(error.message);
          return data ?? [];
        })),
        rpcRows('get_client_roster_created'),
        rpcRows('get_client_workout_plan_created'),
        rpcRows('get_client_first_session'),
        collect(chunk(ids).map(async (part) => {
          const { data, error } = await supabase.from('trainer_clients')
            .select('client_id, trainer_id, actively_training, profiles:trainer_id(id, first_name, last_name, role)')
            .in('client_id', part).eq('actively_training', true);
          if (error) throw new Error(error.message);
          return data ?? [];
        })),
      ]);

      const assessmentMap = new Map<string, { scheduled: boolean; done: boolean }>();
      (assessments as any[]).forEach((a) => {
        const e = assessmentMap.get(a.client_id) ?? { scheduled: false, done: false };
        if (a.assessment_scheduled) e.scheduled = true;
        if (isCompletedValue(a.completed)) e.done = true;
        assessmentMap.set(a.client_id, e);
      });
      const qhpReportSet = new Set((qhpDetailRows as any[]).filter((q) => q.preapproved_qhp || q.qhp_json).map((q) => q.client_id));
      const rosterSet = new Set((rosters as any[]).map((r) => r.client_id));
      const planSet = new Set((plans as any[]).filter((p) => p.client_id).map((p) => p.client_id));
      const firstSessionSet = new Set((firstSessions as any[]).filter((f) => f.client_id).map((f) => f.client_id));
      const hasTrainer = new Set<string>();
      const hasCrm = new Set<string>();
      (trainerAssignments as any[]).forEach((ta) => {
        const p = ta?.profiles;
        if (!ta?.client_id || !p) return;
        if (p.role === 'trainer' && !EXCLUDED_TRAINER_IDS.includes(ta.trainer_id)) hasTrainer.add(ta.client_id);
        if (p.role === 'crm') hasCrm.add(ta.client_id);
      });

      const isFullyOnboarded = (id: string) => {
        const a = assessmentMap.get(id) ?? { scheduled: false, done: false };
        return (a.scheduled || a.done) && a.done && qhpReportSet.has(id) && rosterSet.has(id) && planSet.has(id) && firstSessionSet.has(id);
      };
      const newClients = rows.filter((c) => !isFullyOnboarded(c.id));
      const newIds = newClients.map((c) => c.id);
      const nameOf = new Map(newClients.map((c) => [c.id, `${c.first_name ?? ''} ${c.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || 'Client']));

      const noTrainer = newClients.filter((c) => !hasTrainer.has(c.id)).length;
      const noCrm = newClients.filter((c) => {
        if (hasCrm.has(c.id)) return false;
        const sub = c.subscription_type;
        return !!sub && sub !== 'Trial' && sub !== 'Opportunity';
      }).length;
      const qhpNotScheduled = newClients.filter((c) => {
        const a = assessmentMap.get(c.id);
        return !(a?.scheduled || a?.done);
      }).length;

      // Assessor delayed: latest scheduled assessment per new client, no data captured, assigned 6+h ago.
      // DIVERGENCE (deliberate improvement): web pulls ALL scheduled assessments in one query that
      // PostgREST caps at 1000 rows — older rows silently vanish. Chunking .in(newIds) sees them all.
      const assessorRows = await collect(chunk(newIds).map(async (part) => {
        if (!part.length) return [];
        const { data, error } = await supabase.from('coach_assessment')
          .select('client_id, coach_id, created_at, assessment_scheduled, new_client_assessment_data, existing_client_assessment_data, qhp_data')
          .eq('assessment_scheduled', true).not('coach_id', 'is', null)
          .in('client_id', part).order('created_at', { ascending: false });
        if (error) throw new Error(error.message);
        return data ?? [];
      }));
      const sixHoursAgo = Date.now() - 6 * 3600e3;
      const seen = new Set<string>();
      const assessorDelayed: string[] = [];
      // Global recency order across chunks (web iterates a single desc-ordered list).
      (assessorRows as any[]).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).forEach((a) => {
        if (!a.client_id || seen.has(a.client_id)) return;
        seen.add(a.client_id);
        const hasData = a.new_client_assessment_data || a.existing_client_assessment_data || a.qhp_data;
        if (hasData) return;
        if (new Date(a.created_at).getTime() <= sixHoursAgo) assessorDelayed.push(nameOf.get(a.client_id) ?? 'Client');
      });

      return { noTrainer, noCrm, qhpNotScheduled, assessorDelayed };
    },
  });
}
