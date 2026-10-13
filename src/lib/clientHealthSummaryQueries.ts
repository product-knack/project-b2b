/* Data for "Listen before the session" (9 Oct 2026). Read: the client's
   client_health_summary row (RLS can_listen_client_summary: admin, the client's
   trainers, any doctor or therapist, CRM and managers; an unauthorised user
   simply gets no row). Write: the listen trail through log_summary_listen. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { withTimeout, NET_MS } from './withTimeout';
import type { ClientHealthSummaryRow, ListenEntry, Which } from './clientHealthSummary';

export const HEALTH_SUMMARY_KEY = 'client-health-summary';
const SELECT = 'client_id, weekly_summary, weekly_generated_at, context_summary, context_generated_at, context_dirty, listen_history';

export async function fetchClientHealthSummary(clientId: string): Promise<ClientHealthSummaryRow | null> {
  const { data, error } = await withTimeout(
    Promise.resolve(supabase.from('client_health_summary').select(SELECT).eq('client_id', clientId).maybeSingle()),
    NET_MS, 'Client summary',
  );
  if (error) {
    if (error.code === '42P01') return null; // table not there yet: "nothing yet"
    throw new Error(error.message);
  }
  return (data as ClientHealthSummaryRow | null) ?? null;
}

/** Key ['client-health-summary', clientId], 60 s stale (persisted under the client- prefix). */
export function useClientHealthSummary(clientId: string | null | undefined, enabled: boolean = true) {
  return useQuery({
    queryKey: [HEALTH_SUMMARY_KEY, clientId ?? null],
    enabled: !!clientId && enabled,
    staleTime: 60_000,
    queryFn: () => fetchClientHealthSummary(clientId as string),
  });
}

const friendlyListenError = (e: { code?: string; message: string }): string =>
  e.code === 'PGRST202' ? 'The listen trail is not set up on the server yet.' : e.message;

/** log_summary_listen(p_client_id, p_which): appends {at, by, by_name, role, which, version}. */
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
