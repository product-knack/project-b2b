import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';

/* ============ Admin — Renewals page (web admin "Sessions" tab port) ============
   Source: web ClientSessionsOverview.tsx + useClientSessionsOverview.ts +
   RenewPackageDialog.tsx. Two-phase fetch: paginated basic info (10/page),
   then session metrics for the visible page only. Package deduction counts
   completed + cancelled sessions (complimentary/parked excluded). */

export type RenewalHistoryRow = { renewed_at: string; package_sessions: number | null };
export type ClientBasicInfo = {
  id: string; first_name: string; last_name: string; phone: string | null;
  package_type: string | null; package_sessions: number; session_package: string | null;
  renewal_date: string | null;
  /** Full renewal history, newest first (index 0 = the latest renewal). */
  renewal_history: RenewalHistoryRow[];
};
export type ClientSessionMetrics = { session_count: number; sessions_after_renewal: number; remaining_sessions: number };

const latestRenewalMap = (renewals: any[] | null) => {
  const m = new Map<string, { renewed_at: string; package_sessions: number | null }>();
  (renewals ?? []).forEach((r: any) => {
    if (!m.has(r.client_id)) m.set(r.client_id, { renewed_at: r.renewed_at, package_sessions: r.package_sessions });
  });
  return m;
};
const chunk = <T,>(a: T[], n = 100): T[][] => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

/* Phase 1 — paginated basic info (web useClientBasicInfo, exact port). */
export function useClientBasicInfo(opts: { page: number; pageSize: number; searchTerm: string; withoutSubscription: boolean }) {
  return useQuery({
    queryKey: ['admin-clients-basic-info', opts.page, opts.pageSize, opts.searchTerm, opts.withoutSubscription],
    staleTime: 30_000,
    queryFn: async (): Promise<{ clients: ClientBasicInfo[]; totalCount: number }> => {
      let query = supabase.from('clients')
        .select('id, first_name, last_name, phone, session_package, created_at, subscription_type', { count: 'exact' })
        .eq('status', 'active')
        .order('first_name', { ascending: true });
      query = opts.withoutSubscription ? query.is('subscription_type', null) : query.not('subscription_type', 'is', null);
      const term = opts.searchTerm.trim();
      if (term) query = query.or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%`);
      const from = (opts.page - 1) * opts.pageSize;
      const { data: clients, error, count } = await query.range(from, from + opts.pageSize - 1);
      if (error) throw new Error(error.message);
      if (!clients?.length) return { clients: [], totalCount: count ?? 0 };

      const { data: renewals, error: rErr } = await supabase.from('client_renewals')
        .select('client_id, renewed_at, package_sessions')
        .in('client_id', clients.map((c: any) => c.id))
        .order('renewed_at', { ascending: false });
      if (rErr) throw new Error(rErr.message);
      const latest = latestRenewalMap(renewals);
      // Full history per client (rows already arrive newest-first).
      const historyByClient = new Map<string, RenewalHistoryRow[]>();
      (renewals ?? []).forEach((r: any) => {
        if (!r.client_id || !r.renewed_at) return;
        const arr = historyByClient.get(r.client_id) ?? [];
        arr.push({ renewed_at: r.renewed_at, package_sessions: r.package_sessions ?? null });
        historyByClient.set(r.client_id, arr);
      });

      return {
        totalCount: count ?? 0,
        clients: (clients as any[]).map((c) => {
          const renewal = latest.get(c.id);
          return {
            id: c.id, first_name: c.first_name, last_name: c.last_name, phone: c.phone,
            package_type: c.session_package ? `${c.session_package} sessions` : null,
            package_sessions: renewal?.package_sessions || (c.session_package ? parseInt(c.session_package, 10) || 0 : 0),
            session_package: c.session_package ?? null,
            renewal_date: renewal?.renewed_at ?? null,
            renewal_history: historyByClient.get(c.id) ?? [],
          };
        }),
      };
    },
  });
}

/* Phase 2 — session metrics for the visible page only (web useClientSessionMetrics, exact port). */
export function useClientSessionMetrics(clientIds: string[]) {
  return useQuery({
    queryKey: ['admin-clients-session-metrics', clientIds],
    enabled: clientIds.length > 0,
    staleTime: 30_000,
    // Plain object, NOT a Map — the query cache is persisted to disk and a Map
    // rehydrates as {} (".get is not a function" crash on next app launch).
    queryFn: async (): Promise<Record<string, ClientSessionMetrics>> => {
      const [{ data: renewals, error: rErr }, { data: clientsData, error: cErr }, { data: allSessions, error: sErr }] = await Promise.all([
        supabase.from('client_renewals').select('client_id, renewed_at, package_sessions').in('client_id', clientIds).order('renewed_at', { ascending: false }),
        supabase.from('clients').select('id, created_at, session_package').in('id', clientIds),
        supabase.from('training_sessions').select('id, client_id, scheduled_at').in('client_id', clientIds).or('status.eq.completed,status.eq.cancelled,cancelled.eq.true'),
      ]);
      if (rErr) throw new Error(rErr.message);
      if (cErr) throw new Error(cErr.message);
      if (sErr) throw new Error(sErr.message);
      const latest = latestRenewalMap(renewals);
      const clientMap = new Map((clientsData ?? []).map((c: any) => [c.id, c]));
      const out: Record<string, ClientSessionMetrics> = {};
      for (const id of clientIds) {
        const sessions = (allSessions ?? []).filter((s: any) => s.client_id === id);
        const renewal = latest.get(id);
        const info: any = clientMap.get(id);
        const packageStart = renewal?.renewed_at || info?.created_at || new Date().toISOString();
        const packageSessions = renewal?.package_sessions || (info?.session_package ? parseInt(info.session_package, 10) || 0 : 0);
        const after = sessions.filter((s: any) => new Date(s.scheduled_at) >= new Date(packageStart)).length;
        out[id] = { session_count: sessions.length, sessions_after_renewal: after, remaining_sessions: packageSessions - after };
      }
      return out;
    },
  });
}

/* Generation admin → members map (web batch query): members can't be renewed individually. */
export function useGenerationMemberMap() {
  return useQuery({
    queryKey: ['generation-member-admin-map'],
    staleTime: 60_000,
    // Plain object, NOT a Map — persisted-cache safe (see useClientSessionMetrics).
    queryFn: async (): Promise<Record<string, string>> => {
      const { data, error } = await supabase.from('clients')
        .select('id, first_name, last_name, generation_members')
        .eq('generation_admin', true);
      if (error) throw new Error(error.message);
      const map: Record<string, string> = {};
      (data ?? []).forEach((a: any) => {
        const adminName = `${a.first_name ?? ''} ${a.last_name ?? ''}`.replace(/\s+/g, ' ').trim();
        (Array.isArray(a.generation_members) ? a.generation_members : []).forEach((m: any) => {
          if (typeof m === 'string') map[m] = adminName;
        });
      });
      return map;
    },
  });
}

const invalidateRenewals = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: ['admin-clients-basic-info'] });
  qc.invalidateQueries({ queryKey: ['admin-clients-session-metrics'] });
  qc.invalidateQueries({ queryKey: ['admin-renewal-opportunities'] });
};

/* Renewal-date edit (web handleRenewalDateUpdate): update latest renewal's renewed_at,
   else insert a stub renewal. Web's package_duration is always null here → cycle_type 'custom'. */
export function useUpdateRenewalDate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { clientId: string; dateYmd: string; packageSessions: number; packageType: string | null }) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dateYmd)) throw new Error('Enter the date as YYYY-MM-DD.');
      const iso = new Date(`${input.dateYmd}T12:00:00`).toISOString();
      const { data: existing, error: fErr } = await supabase.from('client_renewals')
        .select('id, renewed_at').eq('client_id', input.clientId)
        .order('renewed_at', { ascending: false }).limit(1);
      if (fErr) throw new Error(fErr.message);
      if (existing?.length) {
        const { error } = await supabase.from('client_renewals').update({ renewed_at: iso }).eq('id', existing[0].id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase.from('client_renewals').insert({
          client_id: input.clientId, renewed_at: iso,
          package_sessions: input.packageSessions || 0,
          new_package: input.packageType || 'Unknown',
          cycle_type: 'custom',
        });
        if (error) throw new Error(error.message);
      }
    },
    onSuccess: () => { const q = qc; invalidateRenewals(q); },
  });
}

/* Renew package (web RenewPackageDialog, single-client port): re-reads session_package,
   counts consumed sessions all-time, inserts a full client_renewals row and appends the
   overdue-carry-forward note to clients.notes. Generation members are blocked by the caller. */
export function useRenewPackage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { clientId: string; packageSessions: number; cycleSessions: number; packageDuration: number; packageAmount: number | null; cycleType: string; notes: string }) => {
      if (!(input.packageSessions > 0) || !(input.cycleSessions > 0) || !(input.packageDuration > 0)) {
        throw new Error('Please fill in all required fields.');
      }
      const { data: client, error: cErr } = await supabase.from('clients')
        .select('id, first_name, last_name, session_package').eq('id', input.clientId).single();
      if (cErr) throw new Error(cErr.message);
      const { data: sessionsData, error: sErr } = await supabase.from('training_sessions')
        .select('id').eq('client_id', input.clientId)
        .or('status.eq.completed,status.eq.cancelled,cancelled.eq.true');
      if (sErr) throw new Error(sErr.message);
      const consumed = sessionsData?.length ?? 0;
      const prevSize = parseInt((client as any)?.session_package ?? '') || 0;
      const overdue = prevSize > 0 ? Math.max(0, consumed - prevSize) : 0;

      const { error: rErr } = await supabase.from('client_renewals').insert({
        client_id: input.clientId,
        previous_package: (client as any)?.session_package ?? null,
        new_package: `${input.packageSessions} sessions`,
        package_sessions: input.packageSessions,
        cycle_sessions: input.cycleSessions,
        package_amount: input.packageAmount,
        package_duration: input.packageDuration,
        cycle_type: input.cycleType,
        renewed_at: new Date().toISOString(),
      });
      if (rErr) throw new Error(rErr.message);

      // Initial package on the clients row stays frozen (web comment) — only the note updates.
      const overdueNote = `Package renewed on ${new Date().toLocaleDateString()}. Carried forward ${overdue} overdue sessions from previous package`;
      const finalNote = input.notes.trim() ? `${input.notes.trim()}\n(${overdueNote})` : overdueNote;
      const { error: nErr } = await supabase.from('clients').update({ notes: finalNote }).eq('id', input.clientId);
      if (nErr) throw new Error(nErr.message);
    },
    onSuccess: () => invalidateRenewals(qc),
  });
}

/* ---------------- Renewal Opportunities (new tab, user-requested) ----------------
   Every active subscribed client with remaining sessions < 3 in the current package —
   same metric formula as the Sessions tab, computed across ALL clients (paginated +
   chunked), sorted most-exhausted first. */
export type RenewalOpportunity = {
  id: string; name: string; phone: string | null; subscription: string | null;
  package_sessions: number; sessions_after_renewal: number; remaining_sessions: number;
  renewal_date: string | null; session_package: string | null; package_type: string | null;
};
export function useRenewalOpportunities(enabled: boolean) {
  return useQuery({
    queryKey: ['admin-renewal-opportunities'],
    enabled,
    staleTime: 120_000,
    queryFn: async (): Promise<RenewalOpportunity[]> => {
      const clients: any[] = [];
      for (let from = 0; ; from += 1000) {
        const { data: page, error } = await supabase.from('clients')
          .select('id, first_name, last_name, phone, session_package, created_at, subscription_type')
          .eq('status', 'active').not('subscription_type', 'is', null)
          .neq('subscription_type', 'Staff') // staff accounts never renew — exclude from the pipeline
          .order('first_name', { ascending: true })
          .range(from, from + 999);
        if (error) throw new Error(error.message);
        clients.push(...(page ?? []));
        if (!page || page.length < 1000) break;
      }
      if (!clients.length) return [];
      const ids = clients.map((c) => c.id);

      const renewalRows: any[] = [];
      const sessionRows: any[] = [];
      for (const part of chunk(ids)) {
        const [{ data: ren, error: rErr }, { data: ses, error: sErr }] = await Promise.all([
          supabase.from('client_renewals').select('client_id, renewed_at, package_sessions').in('client_id', part).order('renewed_at', { ascending: false }),
          supabase.from('training_sessions').select('client_id, scheduled_at').in('client_id', part).or('status.eq.completed,status.eq.cancelled,cancelled.eq.true').limit(50000),
        ]);
        if (rErr) throw new Error(rErr.message);
        if (sErr) throw new Error(sErr.message);
        renewalRows.push(...(ren ?? []));
        sessionRows.push(...(ses ?? []));
      }
      const latest = latestRenewalMap(renewalRows);
      const sessionsByClient = new Map<string, string[]>();
      sessionRows.forEach((s) => {
        if (!s.client_id || !s.scheduled_at) return;
        const arr = sessionsByClient.get(s.client_id) ?? [];
        arr.push(s.scheduled_at);
        sessionsByClient.set(s.client_id, arr);
      });

      const out: RenewalOpportunity[] = [];
      for (const c of clients) {
        const renewal = latest.get(c.id);
        const packageSessions = renewal?.package_sessions || (c.session_package ? parseInt(c.session_package, 10) || 0 : 0);
        if (packageSessions <= 0) continue; // no package on file — nothing to renew against
        const packageStart = renewal?.renewed_at || c.created_at;
        const after = (sessionsByClient.get(c.id) ?? []).filter((d) => new Date(d) >= new Date(packageStart)).length;
        const remaining = packageSessions - after;
        if (remaining >= 3) continue;
        out.push({
          id: c.id, name: `${c.first_name ?? ''} ${c.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || '—',
          phone: c.phone ?? null, subscription: c.subscription_type ?? null,
          package_sessions: packageSessions, sessions_after_renewal: after, remaining_sessions: remaining,
          renewal_date: renewal?.renewed_at ?? null, session_package: c.session_package ?? null,
          package_type: c.session_package ? `${c.session_package} sessions` : null,
        });
      }
      return out.sort((a, b) => a.remaining_sessions - b.remaining_sessions);
    },
  });
}
