import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';

/* ============ CRM Dashboard — mirrors the web CRM home data contracts ============
   Scoping: a CRM's clients live in trainer_clients exactly like a trainer's
   (trainer_id = the CRM's profile id, actively_training = true). Most lists also
   exclude paused clients (client_pause_history.is_active) and, for renewals,
   "generation members". */

export type CrmClient = { id: string; name: string; session_package: number | null; created_at: string | null; status: string | null; dob: string | null; phone: string | null; subscription: string | null };

const fullName = (c: any) => `${c.first_name ?? ''} ${c.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || 'Client';

/* My active clients + paused set + generation-member set (one fetch, shared). */
export function useCrmClients(crmId: string | null) {
  return useQuery({
    queryKey: ['crm-clients', crmId],
    enabled: !!crmId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trainer_clients')
        .select('client_id, clients!inner(id, first_name, last_name, status, session_package, created_at, date_of_birth, phone, subscription_type)')
        .eq('trainer_id', crmId)
        .eq('actively_training', true)
        .eq('clients.status', 'active');
      if (error) throw new Error(error.message);
      const clients: CrmClient[] = (data ?? []).map((r: any) => ({
        id: r.clients.id, name: fullName(r.clients), session_package: r.clients.session_package ?? null,
        created_at: r.clients.created_at ?? null, status: r.clients.status ?? null,
        dob: r.clients.date_of_birth ?? null, phone: r.clients.phone ?? null,
        subscription: r.clients.subscription_type ?? null,
      }));
      const ids = clients.map((c) => c.id);

      // Paused clients (excluded from alert/idle lists — mirrors the web).
      const paused = new Set<string>();
      if (ids.length) {
        const { data: ph } = await supabase.from('client_pause_history').select('client_id').in('client_id', ids).eq('is_active', true);
        (ph ?? []).forEach((p: any) => paused.add(p.client_id));
      }
      // Generation members (excluded from renewal computations — mirrors the web).
      const genMembers = new Set<string>();
      const { data: gens } = await supabase.from('clients').select('generation_members').eq('generation_admin', true);
      (gens ?? []).forEach((g: any) => (Array.isArray(g.generation_members) ? g.generation_members : []).forEach((m: string) => genMembers.add(m)));

      return { clients, ids, paused, genMembers };
    },
  });
}

/* ---------- KPI metrics (mirrors useCRMMetrics) ----------
   NOTE: the web metrics hook counts ALL actively-training assignments — it does
   NOT filter by clients.status (unlike the other tabs). Verified: 77 vs 68. */
export function useCrmMetrics(crmId: string | null) {
  return useQuery({
    queryKey: ['crm-metrics', crmId],
    enabled: !!crmId,
    staleTime: 120_000,
    queryFn: async () => {
      const { data: assigned, error } = await supabase
        .from('trainer_clients')
        .select('client_id')
        .eq('trainer_id', crmId)
        .eq('actively_training', true);
      if (error) throw new Error(error.message);
      const ids = (assigned ?? []).map((r: any) => r.client_id);
      const total = ids.length;
      let retained = 0, tickets = 0, qhpMonth = 0;
      if (ids.length) {
        const cut30 = new Date(Date.now() - 30 * 864e5).toISOString();
        const [sess, tick, qhp] = await Promise.all([
          supabase.from('training_sessions').select('client_id').in('client_id', ids).eq('status', 'completed').gte('scheduled_at', cut30),
          supabase.from('support_tickets').select('id', { count: 'exact', head: true }).in('client_id', ids),
          (() => {
            // Web-faithful month bounds: the web converts local month edges via
            // toISOString(), which in IST shifts both back a day (verified: 10 vs 9).
            const now = new Date();
            const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
            const endS = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
            return supabase.from('coach_assessment').select('id', { count: 'exact', head: true }).in('client_id', ids).gte('assessment_date', start).lte('assessment_date', endS);
          })(),
        ]);
        retained = new Set((sess.data ?? []).map((s: any) => s.client_id)).size;
        tickets = tick.count ?? 0;
        qhpMonth = qhp.count ?? 0;
      }
      return {
        totalClients: total,
        activeLast30: retained, // distinct clients with a completed session in the last 30 days
        retentionPct: total ? Math.round((retained / total) * 100) : 0,
        ticketsRaised: tickets,
        qhpThisMonth: qhpMonth,
      };
    },
  });
}

/* ---------- Referrals raised by this CRM (dashboard card drill-down) ---------- */
export type CrmReferralRow = { id: string; name: string; status: string; createdAt: string | null };
export function useCrmReferralsList(crmId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['crm-referrals-list', crmId],
    enabled: enabled && !!crmId,
    staleTime: 120_000,
    queryFn: async (): Promise<CrmReferralRow[]> => {
      const { data, error } = await supabase
        .from('referrals')
        .select('id, referred_client_name, status, created_at')
        .eq('referrer_id', crmId)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map((r) => ({
        id: r.id, name: r.referred_client_name || 'Unknown', status: String(r.status ?? 'pending'), createdAt: r.created_at ?? null,
      }));
    },
  });
}

/* ---------- Package upsell events for this CRM (dashboard card drill-down) ----------
   incentive_events: package_upgrade / subscription_upgrade / cross_sell rows. */
export type CrmUpsellRow = { id: string; type: 'package_upgrade' | 'subscription_upgrade' | 'cross_sell'; clientName: string | null; date: string | null; detail: string | null };
export function useCrmUpsellEvents(crmId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['crm-upsell-events', crmId],
    enabled: enabled && !!crmId,
    staleTime: 120_000,
    queryFn: async (): Promise<CrmUpsellRow[]> => {
      const { data, error } = await supabase
        .from('incentive_events')
        .select('id, event_type, event_date, new_value, client:client_id(first_name, last_name)')
        .eq('user_id', crmId)
        .in('event_type', ['package_upgrade', 'subscription_upgrade', 'cross_sell'])
        .order('event_date', { ascending: false })
        .limit(100);
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map((e) => ({
        id: e.id, type: e.event_type,
        clientName: e.client ? `${e.client.first_name ?? ''} ${e.client.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || null : null,
        date: e.event_date ?? null, detail: e.new_value ?? null,
      }));
    },
  });
}

/* ---------- Churn so far (dashboard card) — this CRM's clients now discontinued ----------
   Scope: ALL trainer_clients rows for the CRM (assignments usually go inactive on churn,
   so no actively_training filter). Reason/date from the latest 'discontinued' entry in
   client_status_history (same contract as the admin churn page). */
export type CrmChurnRow = { clientId: string; name: string; subscription: string | null; reason: string | null; details: string | null; discontinuedAt: string | null };
export function useCrmChurnList(crmId: string | null) {
  return useQuery({
    queryKey: ['crm-churn-list', crmId],
    enabled: !!crmId,
    staleTime: 300_000,
    queryFn: async (): Promise<CrmChurnRow[]> => {
      const { data: assigned, error } = await supabase.from('trainer_clients').select('client_id').eq('trainer_id', crmId);
      if (error) throw new Error(error.message);
      const ids = [...new Set((assigned ?? []).map((r: any) => r.client_id).filter(Boolean))] as string[];
      if (!ids.length) return [];
      const churned: any[] = [];
      for (let i = 0; i < ids.length; i += 200) {
        const { data: cl, error: cErr } = await supabase
          .from('clients').select('id, first_name, last_name, subscription_type')
          .eq('status', 'discontinued').in('id', ids.slice(i, i + 200));
        if (cErr) throw new Error(cErr.message);
        churned.push(...(cl ?? []));
      }
      if (!churned.length) return [];
      const cIds = churned.map((c) => c.id);
      const histBy = new Map<string, any>();
      for (let i = 0; i < cIds.length; i += 200) {
        const { data: h } = await supabase
          .from('client_status_history').select('client_id, reason, notes, created_at')
          .eq('new_status', 'discontinued').in('client_id', cIds.slice(i, i + 200))
          .order('created_at', { ascending: false });
        (h ?? []).forEach((row: any) => { if (!histBy.has(row.client_id)) histBy.set(row.client_id, row); });
      }
      return churned
        .map((c) => {
          const h = histBy.get(c.id);
          return {
            clientId: c.id,
            name: `${c.first_name ?? ''} ${c.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || 'Unknown',
            subscription: c.subscription_type ?? null,
            reason: h?.reason ?? null, details: h?.notes ?? null, discontinuedAt: h?.created_at ?? null,
          };
        })
        .sort((a, b) => String(b.discontinuedAt ?? '').localeCompare(String(a.discontinuedAt ?? '')));
    },
  });
}

/* ---------- Retention breakdown (last 30 days) — powers the metrics-card drill-down ----------
   Denominator = actively-training assignments for this CRM; numerator = those with a
   completed session in the last 30 days (web useCRMRetentionRate). Returns each client
   flagged retained/lapsed with their last completed-session date. */
export type RetentionClientRow = { clientId: string; name: string; subscription: string | null; retained: boolean; lastCompletedAt: string | null };
export type RetentionBreakdown = { total: number; retained: number; pct: number; rows: RetentionClientRow[] };
export function useCrmRetentionBreakdown(crmId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['crm-retention-breakdown', crmId],
    enabled: enabled && !!crmId,
    staleTime: 120_000,
    queryFn: async (): Promise<RetentionBreakdown> => {
      const { data: assigned, error } = await supabase
        .from('trainer_clients')
        .select('client_id')
        .eq('trainer_id', crmId)
        .eq('actively_training', true);
      if (error) throw new Error(error.message);
      const ids = [...new Set((assigned ?? []).map((r: any) => r.client_id).filter(Boolean))] as string[];
      if (!ids.length) return { total: 0, retained: 0, pct: 0, rows: [] };
      const cut30 = new Date(Date.now() - 30 * 864e5).toISOString();
      const [sessR, clientR] = await Promise.all([
        supabase.from('training_sessions').select('client_id, scheduled_at').in('client_id', ids).eq('status', 'completed').gte('scheduled_at', cut30),
        supabase.from('clients').select('id, first_name, last_name, subscription_type').in('id', ids),
      ]);
      // latest completed session per client (within window)
      const lastByClient = new Map<string, string>();
      (sessR.data ?? []).forEach((s: any) => {
        if (!s.client_id) return;
        const prev = lastByClient.get(s.client_id);
        if (!prev || new Date(s.scheduled_at).getTime() > new Date(prev).getTime()) lastByClient.set(s.client_id, s.scheduled_at);
      });
      const byId = new Map<string, any>();
      (clientR.data ?? []).forEach((c: any) => byId.set(c.id, c));
      const rows: RetentionClientRow[] = ids.map((id) => {
        const c = byId.get(id);
        const name = `${c?.first_name ?? ''} ${c?.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || 'Unknown';
        const lastCompletedAt = lastByClient.get(id) ?? null;
        return { clientId: id, name, subscription: c?.subscription_type ?? null, retained: !!lastCompletedAt, lastCompletedAt };
      });
      // retained first, then most-recent session; lapsed grouped after, alphabetical
      rows.sort((a, b) => {
        if (a.retained !== b.retained) return a.retained ? -1 : 1;
        if (a.retained && b.retained) return new Date(b.lastCompletedAt!).getTime() - new Date(a.lastCompletedAt!).getTime();
        return a.name.localeCompare(b.name);
      });
      const retained = rows.filter((r) => r.retained).length;
      return { total: ids.length, retained, pct: ids.length ? Math.round((retained / ids.length) * 100) : 0, rows };
    },
  });
}

/* ---------- Renewals (mirrors useCRMPendingRenewals / useCRMRenewalAlert) ----------
   remaining = package − consumed since the latest approved renewal (or signup).
   Alert threshold: remaining < 2. Pending list: remaining <= 3. */
export type CrmRenewal = { clientId: string; name: string; packageSize: number; completed: number; remaining: number; pct: number };
export function useCrmRenewals(crmId: string | null) {
  const base = useCrmClients(crmId);
  return useQuery({
    queryKey: ['crm-renewals', crmId, base.data?.ids.length ?? -1],
    enabled: !!crmId && !!base.data,
    staleTime: 120_000,
    queryFn: async (): Promise<CrmRenewal[]> => {
      const { clients, ids, genMembers } = base.data!;
      const eligible = clients.filter((c) => !genMembers.has(c.id));
      if (!eligible.length) return [];
      const eIds = eligible.map((c) => c.id);
      const [renewals, sessions] = await Promise.all([
        supabase.from('client_renewals').select('client_id, package_sessions, renewed_at').in('client_id', eIds).eq('request_status', 'approved').order('renewed_at', { ascending: false }),
        supabase.from('training_sessions').select('client_id, scheduled_at').in('client_id', eIds).or('status.eq.completed,status.eq.cancelled,cancelled.eq.true'),
      ]);
      const latestRenewal = new Map<string, { pkg: number; from: string }>();
      (renewals.data ?? []).forEach((r: any) => {
        if (!latestRenewal.has(r.client_id)) latestRenewal.set(r.client_id, { pkg: Number(r.package_sessions) || 0, from: r.renewed_at });
      });
      const out: CrmRenewal[] = [];
      for (const c of eligible) {
        const ren = latestRenewal.get(c.id);
        const pkg = ren?.pkg || Number(c.session_package) || 0;
        if (!pkg) continue;
        const from = ren?.from || c.created_at || '1970-01-01';
        const consumed = (sessions.data ?? []).filter((s: any) => s.client_id === c.id && s.scheduled_at >= from).length;
        const remaining = pkg - consumed;
        out.push({ clientId: c.id, name: c.name, packageSize: pkg, completed: consumed, remaining, pct: Math.min(100, Math.round((consumed / pkg) * 100)) });
      }
      return out.sort((a, b) => a.remaining - b.remaining);
    },
  });
}

/* ---------- Needs-attention alerts ----------
   idle15d  → active, non-paused clients with no training_sessions in 15 days
   missing  → session_schedule rows (last 7d, ≥3h past, not cancelled) with no
              training_sessions log from the same trainer within ±3h
   noTrainer→ my clients with no active *trainer-role* assignment */
export function useCrmAlerts(crmId: string | null) {
  const base = useCrmClients(crmId);
  return useQuery({
    queryKey: ['crm-alerts', crmId, base.data?.ids.length ?? -1],
    enabled: !!crmId && !!base.data,
    staleTime: 120_000,
    queryFn: async () => {
      const { clients, ids, paused } = base.data!;
      const activeIds = ids.filter((id) => !paused.has(id));
      if (!activeIds.length) return { idle15d: [] as { id: string; name: string; lastSession: string | null }[], missingLogs: 0, noTrainer: [] as string[] };

      const cut15 = new Date(Date.now() - 15 * 864e5).toISOString();
      const cut7 = new Date(Date.now() - 7 * 864e5).toISOString();
      const nameOf = new Map(clients.map((c) => [c.id, c.name]));

      const [recent, sched, assigns] = await Promise.all([
        supabase.from('training_sessions').select('client_id, scheduled_at').in('client_id', activeIds).gte('scheduled_at', cut15),
        supabase.from('session_schedule').select('id, client_id, trainer_id, scheduled_datetime, status').in('client_id', activeIds).gte('scheduled_datetime', cut7).lte('scheduled_datetime', new Date(Date.now() - 3 * 3600e3).toISOString()).neq('status', 'cancelled'),
        supabase.from('trainer_clients').select('client_id, profiles:trainer_id(role)').in('client_id', activeIds).eq('actively_training', true),
      ]);

      // Idle 15d
      const withRecent = new Set((recent.data ?? []).map((s: any) => s.client_id));
      const idle15d = activeIds.filter((id) => !withRecent.has(id)).map((id) => ({ id, name: nameOf.get(id) ?? 'Client', lastSession: null as string | null }));

      // Missing session logs: match schedule ↔ logged sessions (same trainer, ±3h)
      let missingLogs = 0;
      const schedRows = (sched.data ?? []) as any[];
      if (schedRows.length) {
        const trainerIds = [...new Set(schedRows.map((r) => r.trainer_id).filter(Boolean))];
        const { data: logs } = await supabase.from('training_sessions').select('trainer_id, scheduled_at').in('trainer_id', trainerIds).gte('scheduled_at', cut7);
        missingLogs = schedRows.filter((r) => {
          const t = new Date(r.scheduled_datetime).getTime();
          return !(logs ?? []).some((l: any) => l.trainer_id === r.trainer_id && Math.abs(new Date(l.scheduled_at).getTime() - t) <= 3 * 3600e3);
        }).length;
      }

      // Clients without a trainer-role assignment
      const hasTrainer = new Set<string>();
      (assigns.data ?? []).forEach((a: any) => { if (a.profiles?.role === 'trainer') hasTrainer.add(a.client_id); });
      const noTrainer = activeIds.filter((id) => !hasTrainer.has(id)).map((id) => nameOf.get(id) ?? 'Client');

      return { idle15d, missingLogs, noTrainer };
    },
  });
}

/* ---------- Birthdays (today / this week, IST) ---------- */
export function useCrmBirthdays(crmId: string | null) {
  const base = useCrmClients(crmId);
  return useQuery({
    queryKey: ['crm-birthdays', crmId, base.data?.ids.length ?? -1],
    enabled: !!crmId && !!base.data,
    staleTime: 600_000,
    queryFn: async () => {
      const { clients } = base.data!;
      const istNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      const mdKey = (d: Date) => `${d.getMonth() + 1}-${d.getDate()}`;
      const week = new Set<string>();
      for (let i = 0; i < 7; i++) week.add(mdKey(new Date(istNow.getTime() + i * 864e5)));
      const today: { id: string; name: string }[] = [];
      const thisWeek: { id: string; name: string; day: string }[] = [];
      clients.forEach((c) => {
        if (!c.dob) return;
        const d = new Date(c.dob + 'T00:00:00');
        const key = mdKey(d);
        if (key === mdKey(istNow)) today.push({ id: c.id, name: c.name });
        else if (week.has(key)) thisWeek.push({ id: c.id, name: c.name, day: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) });
      });
      return { today, thisWeek };
    },
  });
}

/* ---------- CRM profile (greeting name) ---------- */
export function useCrmProfile(crmId: string | null) {
  return useQuery({
    queryKey: ['crm-profile', crmId],
    enabled: !!crmId,
    staleTime: 600_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('first_name, last_name').eq('id', crmId).single();
      if (error) throw new Error(error.message);
      return { firstName: (data?.first_name ?? 'there').trim() || 'there' };
    },
  });
}

/* ---------- Recently-ended pauses (mirrors web useRecentlyEndedPauses):
   clients whose pause period ended in the last 14 days and are active again. ---------- */
export type EndedPause = { id: string; clientId: string; clientName: string; pauseStart: string; pauseEnd: string; reason: string | null };
export function useCrmEndedPauses(crmId: string | null) {
  return useQuery({
    queryKey: ['crm-ended-pauses', crmId],
    enabled: !!crmId,
    staleTime: 60_000,
    refetchInterval: 120_000,
    queryFn: async (): Promise<EndedPause[]> => {
      const { data: assigned, error: aErr } = await supabase
        .from('trainer_clients').select('client_id').eq('trainer_id', crmId).eq('actively_training', true);
      if (aErr) throw new Error(aErr.message);
      const ids = [...new Set((assigned ?? []).map((r: any) => r.client_id))];
      if (!ids.length) return [];
      // Window: pauses that ended between 14 days ago and today (IST), now inactive.
      const istToday = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      const cutoff = new Date(istToday); cutoff.setDate(cutoff.getDate() - 14);
      const cutoffStr = cutoff.toISOString().slice(0, 10);
      const todayStr = istToday.toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from('client_pause_history')
        .select('id, client_id, pause_start, pause_end, reason, clients!inner(first_name, last_name, status)')
        .in('client_id', ids)
        .eq('is_active', false)
        .not('pause_end', 'is', null)
        .gte('pause_end', cutoffStr)
        .lte('pause_end', todayStr)
        .eq('clients.status', 'active')
        .order('pause_end', { ascending: false });
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map((r) => ({
        id: r.id, clientId: r.client_id,
        clientName: `${r.clients?.first_name ?? ''} ${r.clients?.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || 'Client',
        pauseStart: r.pause_start, pauseEnd: r.pause_end, reason: r.reason ?? null,
      }));
    },
  });
}

/* ---------- Birthdays (mirrors web useCRMBirthdays): active subscribed clients,
   DOB from clients.date_of_birth with profiles.date_of_birth fallback. ---------- */
export type BirthdayClient = { id: string; name: string; ageTurning: number; daysUntil: number; date: string; bMonth: number; bDay: number };
export type BirthdayBook = { today: BirthdayClient[]; week: BirthdayClient[]; month: BirthdayClient[]; all: BirthdayClient[]; weekCount: number; missingDob: number; missingDobClients: { id: string; name: string }[] };
const NO_BIRTHDAYS: BirthdayBook = { today: [], week: [], month: [], all: [], weekCount: 0, missingDob: 0, missingDobClients: [] };
export function useBirthdaysToday(crmId: string | null) {
  return useQuery({
    queryKey: ['crm-birthdays', crmId],
    enabled: !!crmId,
    staleTime: 300_000,
    queryFn: async (): Promise<BirthdayBook> => {
      const { data: assigned, error: aErr } = await supabase
        .from('trainer_clients').select('client_id').eq('trainer_id', crmId).eq('actively_training', true);
      if (aErr) throw new Error(aErr.message);
      const ids = [...new Set((assigned ?? []).map((r: any) => r.client_id))];
      if (!ids.length) return NO_BIRTHDAYS;
      const { data: clients, error } = await supabase
        .from('clients')
        .select('id, first_name, last_name, date_of_birth, profile_id, status, subscription_type')
        .in('id', ids).eq('status', 'active').not('subscription_type', 'is', null);
      if (error) throw new Error(error.message);
      // Paying clients only — the query drops null subscriptions; also drop Staff
      // (same eligibility rule as Client Overview / the escalation engine).
      const rows = ((clients ?? []) as any[]).filter((c) => (c.subscription_type ?? '').trim().toLowerCase() !== 'staff');
      // Fallback DOB from profiles.
      const missing = rows.filter((c) => !c.date_of_birth && c.profile_id).map((c) => c.profile_id);
      const profDob = new Map<string, string>();
      if (missing.length) {
        const { data: profs } = await supabase.from('profiles').select('id, date_of_birth').in('id', missing);
        (profs ?? []).forEach((p: any) => { if (p.date_of_birth) profDob.set(p.id, p.date_of_birth); });
      }
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const out: BirthdayClient[] = [];
      let missingDob = 0;
      const missingDobClients: { id: string; name: string }[] = [];
      const nameOf = (c: any) => `${c.first_name ?? ''} ${c.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || 'Client';
      rows.forEach((c) => {
        const dobStr = c.date_of_birth || (c.profile_id ? profDob.get(c.profile_id) : null);
        if (!dobStr) { missingDob++; missingDobClients.push({ id: c.id, name: nameOf(c) }); return; }
        const dob = new Date(dobStr + (dobStr.length === 10 ? 'T00:00:00' : ''));
        if (isNaN(dob.getTime())) { missingDob++; missingDobClients.push({ id: c.id, name: nameOf(c) }); return; }
        let next = new Date(today.getFullYear(), dob.getMonth(), dob.getDate());
        if (next < today) next = new Date(today.getFullYear() + 1, dob.getMonth(), dob.getDate());
        const daysUntil = Math.round((next.getTime() - today.getTime()) / 864e5);
        out.push({
          id: c.id,
          name: `${c.first_name ?? ''} ${c.last_name ?? ''}`.replace(/\s+/g, ' ').trim(),
          ageTurning: next.getFullYear() - dob.getFullYear(),
          daysUntil,
          date: `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`,
          bMonth: dob.getMonth(),
          bDay: dob.getDate(),
        });
      });
      out.sort((a, b) => a.daysUntil - b.daysUntil || a.name.localeCompare(b.name));
      return {
        today: out.filter((b) => b.daysUntil === 0),
        week: out.filter((b) => b.daysUntil > 0 && b.daysUntil <= 7),
        month: out.filter((b) => b.daysUntil > 7 && b.daysUntil <= 31),
        all: out,
        weekCount: out.filter((b) => b.daysUntil > 0 && b.daysUntil <= 7).length,
        missingDob,
        missingDobClients: missingDobClients.sort((a, b) => a.name.localeCompare(b.name)),
      };
    },
  });
}

/* ---------- Save a client's date of birth (clients.date_of_birth) ---------- */
export function useSetClientDob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { clientId: string; dob: string }) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dob)) throw new Error('Invalid date');
      const { error } = await supabase.from('clients').update({ date_of_birth: input.dob }).eq('id', input.clientId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['crm-birthdays'] });
      qc.invalidateQueries({ queryKey: ['crm-clients'] });
      qc.invalidateQueries({ queryKey: ['crm-client-detail'] });
    },
  });
}
