/* Data for "Listen before the session" (9 Oct 2026). Since 10 Oct 2026 the backend holds
   one client_health_summary row per client per training day (hub-track migration
   20261010160000), so the app reads the row in effect through the RPC
   get_client_health_summary (RLS can_listen_client_summary: admin, the client's
   trainers, any doctor or therapist, CRM and managers, and whoever the server lets
   listen; an unauthorised user simply gets no row). The direct table read of 9 Oct
   broke on 10 Oct (42703: weekly_generated_at no longer exists) and hid the card on
   every client page until 15 Oct 2026. Write: the listen trail through log_summary_listen. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { withTimeout, NET_MS } from './withTimeout';
import type { ClientHealthSummaryRow, ListenEntry, Which, ListenStatusRow } from './clientHealthSummary';
import { friendlyError } from './friendlyError';

export const HEALTH_SUMMARY_KEY = 'client-health-summary';

/** The RPC's row, mapped to the app's shape (the old generated_at columns now mirror the summaries). */
const toRow = (d: any): ClientHealthSummaryRow => ({
  client_id: d.client_id,
  weekly_summary: d.weekly_summary ?? null,
  weekly_generated_at: d.weekly_summary?.generated_at ?? null,
  context_summary: d.context_summary ?? null,
  context_generated_at: d.context_summary?.generated_at ?? null,
  context_dirty: d.context_dirty ?? null,
  listen_history: Array.isArray(d.listen_history) ? d.listen_history : [],
  briefing_date: d.briefing_date ?? null,
  status: d.status === 'ready' ? 'ready' : d.status === 'building' ? 'building' : null,
  built_at: d.built_at ?? null,
});

/** The row in effect for a day (today by default): the latest row with briefing_date <= date.
    Null when there is none, when the function is missing (PGRST202) or when the caller may not listen. */
export async function fetchClientHealthSummary(clientId: string, date?: string | null): Promise<ClientHealthSummaryRow | null> {
  const { data, error } = await withTimeout(
    Promise.resolve(supabase.rpc('get_client_health_summary', { p_client_id: clientId, p_date: date ?? null })),
    NET_MS, 'Client summary',
  );
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42P01' || error.code === '42501') return null;
    throw new Error(error.message);
  }
  const row = Array.isArray(data) ? data[0] : data;
  return row ? toRow(row) : null;
}

/** Key ['client-health-summary', clientId, date | 'today'], 60 s stale (persisted under the client- prefix).
    `date` (YYYY-MM-DD IST) asks for another training day's row, e.g. the auction's target day. */
export function useClientHealthSummary(clientId: string | null | undefined, enabled: boolean = true, date?: string | null) {
  return useQuery({
    queryKey: [HEALTH_SUMMARY_KEY, clientId ?? null, date ?? 'today'],
    enabled: !!clientId && enabled,
    staleTime: 60_000,
    queryFn: () => fetchClientHealthSummary(clientId as string, date ?? null),
  });
}

const friendlyListenError = (e: { code?: string; message: string }): string =>
  e.code === 'PGRST202' ? 'Listening is not set up on the server yet. Tell the tech team.' : e.message;

/** log_summary_listen(p_client_id, p_which): appends {at, by, by_name, role, which, version, briefing_date}
    to the row in effect today. */
export function useLogSummaryListen(clientId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (which: Which): Promise<ListenEntry> => {
      if (!clientId) throw new Error('No client selected.');
      const { data, error } = await withTimeout(
        Promise.resolve(supabase.rpc('log_summary_listen', { p_client_id: clientId, p_which: which })),
        NET_MS, 'Listen',
      );
      if (error) throw new Error(friendlyListenError(error));
      return data as ListenEntry;
    },
    onSettled: () => { qc.invalidateQueries({ queryKey: [HEALTH_SUMMARY_KEY, clientId ?? null] }); },
  });
}

/** My Crew (27 Oct 2026): the listen gate inputs for a list of clients in one call (get_my_listen_status). A client the
    caller may not listen to is missing from the map; before the migration (PGRST202) the map is empty, no chips. */
export function useMyListenStatuses(clientIds: string[], enabled: boolean) {
  const ids = [...new Set(clientIds.filter(Boolean))].sort();
  return useQuery({
    queryKey: ['listen-status', ids.join(',')],
    enabled: enabled && ids.length > 0,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<Record<string, ListenStatusRow>> => {
      const { data, error } = await withTimeout(
        Promise.resolve(supabase.rpc('get_my_listen_status', { p_client_ids: ids })) as Promise<{ data: any; error: any }>,
        NET_MS, 'Listen status');
      if (error) {
        if (error.code === 'PGRST202' || /could not find the function/i.test(String(error.message ?? ''))) return {};
        throw new Error(friendlyError(error, 'Could not read the listen status.'));
      }
      const out: Record<string, ListenStatusRow> = {};
      for (const r of (data ?? []) as any[]) {
        out[String(r.client_id)] = {
          client_id: String(r.client_id), has_weekly: r.has_weekly === true, has_context: r.has_context === true,
          weekly_generated_at: r.weekly_generated_at ?? null, context_generated_at: r.context_generated_at ?? null,
          my_last_weekly_at: r.my_last_weekly_at ?? null, my_last_context_at: r.my_last_context_at ?? null,
        };
      }
      return out;
    },
  });
}
