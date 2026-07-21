import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';

/* ============ Admin — Clients page (web /admin/clients port) ============
   Reads the unified_clients VIEW (B2B clients + B2C profile-backed rows).
   Filter pipeline, tabs and enrichment ported verbatim from ClientsPage.tsx. */

export const SUBSCRIPTION_OPTIONS = ['Staff', 'Opportunity', 'Trial', 'Odds basic', 'Odds plus', 'Odds pro', 'Odds lux', 'Odds Prive', 'Odds APEX', 'Virtual Training', 'Influencer'] as const;
export type ClientFilter = 'all' | 'b2b' | 'b2c' | 'odds_converted' | 'paused';
export type StatusTab = 'active' | 'without_subscription' | 'inactive' | 'discontinued';
export const CLIENTS_PER_PAGE = 30;

export type UnifiedClient = {
  id: string; first_name: string | null; last_name: string | null; email: string | null; phone: string | null;
  status: string | null; subscription_type: string | null; client_source: 'B2B' | 'B2C'; is_odds_converted: boolean;
  profile_id: string | null; created_at: string;
  sessions: number; trainers: string[]; is_paused: boolean;
  pause_start: string | null; pause_end: string | null;
};

const applyFilters = (q: any, clientFilter: ClientFilter, statusTab: StatusTab, sub: string, pausedIds: string[] | null) => {
  if (clientFilter === 'b2b') q = q.eq('client_source', 'B2B');
  else if (clientFilter === 'b2c') q = q.eq('client_source', 'B2C').eq('is_odds_converted', false);
  else if (clientFilter === 'odds_converted') q = q.eq('is_odds_converted', true);
  else if (clientFilter === 'paused') q = q.in('id', pausedIds ?? []);
  if (statusTab === 'active') q = q.or('status.eq.active,status.is.null').not('subscription_type', 'is', null);
  else if (statusTab === 'without_subscription') q = q.or('status.eq.active,status.is.null').is('subscription_type', null);
  else q = q.eq('status', statusTab);
  if (sub === 'none') q = q.is('subscription_type', null);
  else if (sub !== 'all') q = q.eq('subscription_type', sub);
  return q;
};

export function useAdminClients(opts: { page: number; search: string; clientFilter: ClientFilter; statusTab: StatusTab; subscriptionFilter: string }) {
  return useQuery({
    queryKey: ['admin-clients', opts.page, opts.search, opts.clientFilter, opts.statusTab, opts.subscriptionFilter],
    staleTime: 30_000,
    queryFn: async (): Promise<{ rows: UnifiedClient[]; total: number }> => {
      let pausedIds: string[] | null = null;
      if (opts.clientFilter === 'paused') {
        const { data: ph, error } = await supabase.from('client_pause_history').select('client_id').eq('is_active', true);
        if (error) throw new Error(error.message);
        pausedIds = [...new Set((ph ?? []).map((r: any) => r.client_id).filter(Boolean))];
        if (!pausedIds.length) return { rows: [], total: 0 };
      }
      let q: any = supabase.from('unified_clients')
        .select('id, first_name, last_name, email, phone, status, subscription_type, client_source, is_odds_converted, profile_id, created_at', { count: 'exact' });
      q = applyFilters(q, opts.clientFilter, opts.statusTab, opts.subscriptionFilter, pausedIds);
      const term = opts.search.trim();
      if (term) q = q.or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%,email.ilike.%${term}%`);
      q = q.order('created_at', { ascending: false });
      if (!term) { const from = (opts.page - 1) * CLIENTS_PER_PAGE; q = q.range(from, from + CLIENTS_PER_PAGE - 1); }
      const { data, error, count } = await q;
      if (error) throw new Error(error.message);
      const base = (data ?? []) as any[];
      if (!base.length) return { rows: [], total: count ?? 0 };
      const ids = base.map((c) => c.id);
      const [{ data: sess }, { data: tcs }, { data: ph2 }] = await Promise.all([
        supabase.from('training_sessions').select('client_id').eq('status', 'completed').in('client_id', ids).limit(50000),
        supabase.from('trainer_clients').select('client_id, profiles:trainer_id (first_name, last_name)').eq('actively_training', true).in('client_id', ids),
        supabase.from('client_pause_history').select('client_id, pause_start, pause_end').eq('is_active', true).in('client_id', ids),
      ]);
      const sessCount = new Map<string, number>();
      (sess ?? []).forEach((s: any) => sessCount.set(s.client_id, (sessCount.get(s.client_id) ?? 0) + 1));
      const trainersBy = new Map<string, string[]>();
      (tcs ?? []).forEach((t: any) => {
        const n = `${t.profiles?.first_name ?? ''} ${t.profiles?.last_name ?? ''}`.replace(/\s+/g, ' ').trim();
        if (!n) return;
        const arr = trainersBy.get(t.client_id) ?? [];
        if (!arr.includes(n)) arr.push(n);
        trainersBy.set(t.client_id, arr);
      });
      const pauseBy = new Map<string, { start: string | null; end: string | null }>();
      (ph2 ?? []).forEach((p: any) => { if (p.client_id && !pauseBy.has(p.client_id)) pauseBy.set(p.client_id, { start: p.pause_start ?? null, end: p.pause_end ?? null }); });
      return {
        total: count ?? 0,
        rows: base.map((c) => ({
          ...c, sessions: sessCount.get(c.id) ?? 0, trainers: trainersBy.get(c.id) ?? [],
          is_paused: pauseBy.has(c.id), pause_start: pauseBy.get(c.id)?.start ?? null, pause_end: pauseBy.get(c.id)?.end ?? null,
        })),
      };
    },
  });
}

/* Tab counts — web parity: keyed by clientFilter and apply ONLY the b2b/b2c/odds_converted
   branches (web's count queries ignore 'paused' and the subscription filter; the Active tab
   shows no count at all). */
export function useClientTabCounts(clientFilter: ClientFilter) {
  return useQuery({
    queryKey: ['admin-clients-tab-counts', clientFilter],
    refetchInterval: 30_000,
    queryFn: async (): Promise<Partial<Record<StatusTab, number>>> => {
      const head = () => {
        let q: any = supabase.from('unified_clients').select('id', { count: 'exact', head: true });
        if (clientFilter === 'b2b') q = q.eq('client_source', 'B2B');
        else if (clientFilter === 'b2c') q = q.eq('client_source', 'B2C').eq('is_odds_converted', false);
        else if (clientFilter === 'odds_converted') q = q.eq('is_odds_converted', true);
        return q;
      };
      const [w, i, d] = await Promise.all([
        head().or('status.eq.active,status.is.null').is('subscription_type', null),
        head().eq('status', 'inactive'),
        head().eq('status', 'discontinued'),
      ]);
      const err = w.error ?? i.error ?? d.error;
      if (err) throw new Error(err.message);
      return { without_subscription: w.count ?? 0, inactive: i.count ?? 0, discontinued: d.count ?? 0 };
    },
  });
}

const invalidate = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: ['admin-clients'] });
  qc.invalidateQueries({ queryKey: ['admin-clients-tab-counts'] });
};

/* Delete — B2B only (web blocks B2C): trainer_clients rows first, then the clients row. */
export function useDeleteClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (c: UnifiedClient) => {
      if (c.client_source === 'B2C') throw new Error('B2C clients cannot be deleted.');
      const { error: tErr } = await supabase.from('trainer_clients').delete().eq('client_id', c.id);
      if (tErr) throw new Error(tErr.message);
      const { error } = await supabase.from('clients').delete().eq('id', c.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => invalidate(qc),
  });
}

/* Toggle ODDS conversion — B2C dual-writes clients + profiles (web parity). */
export function useToggleOddsConversion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (c: UnifiedClient) => {
      const next = !c.is_odds_converted;
      const patch = { is_odds_converted: next, conversion_date: next ? new Date().toISOString() : null };
      const { error } = await supabase.from('clients').update(patch).eq('id', c.id);
      if (error) throw new Error(error.message);
      if (c.client_source === 'B2C' && c.profile_id) {
        const { error: pErr } = await supabase.from('profiles').update(patch).eq('id', c.profile_id);
        if (pErr) throw new Error(pErr.message);
      }
    },
    onSuccess: () => invalidate(qc),
  });
}

/* Change subscription — same B2C dual-write pattern. */
export function useUpdateClientSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { client: UnifiedClient; type: string | null }) => {
      const { error } = await supabase.from('clients').update({ subscription_type: input.type }).eq('id', input.client.id);
      if (error) throw new Error(error.message);
      if (input.client.client_source === 'B2C' && input.client.profile_id) {
        const { error: pErr } = await supabase.from('profiles').update({ subscription_type: input.type }).eq('id', input.client.profile_id);
        if (pErr) throw new Error(pErr.message);
      }
    },
    onSuccess: () => invalidate(qc),
  });
}

/* Reactivate a discontinued client + best-effort status-history log (web parity). */
export function useReactivateClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { clientId: string; profileId: string | null }) => {
      const { error } = await supabase.from('clients').update({ status: 'active' }).eq('id', input.clientId);
      if (error) throw new Error(error.message);
      try {
        await supabase.from('client_status_history').insert({
          client_id: input.clientId, previous_status: 'discontinued', new_status: 'active', changed_by: input.profileId,
        } as any);
      } catch { /* best-effort log only */ }
    },
    onSuccess: () => invalidate(qc),
  });
}
