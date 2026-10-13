import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';
import { withTimeout, NET_MS } from './withTimeout';
import { computeCycleStatus, summariseFeel, CycleStatus, FeelDay, PeriodLog, FeelLog } from './cycleStatus';

/* ============ Cycle phase label data (25 Sep 2026) ============
   One call per screen: get_clients_cycle_status(p_client_ids) (hub-track migration
   20260925140000, SECURITY DEFINER). It returns a row only for an eligible client
   (female, DOB known, under 50, at least one period log) that the caller may see
   (her active trainer, her trainer's crew manager, the physio HOD for doctor /
   therapist clients, admin). Everyone else simply gets no row, so screens just
   render no label. Until the SQL is run the RPC is missing (PGRST202): treated as
   "no labels", never an error on the roster or My Crew.
   The key is in NEVER_PERSIST (App.tsx): cycle data never lands in the on-device
   query cache. */

export type ClientCycle = { status: CycleStatus; feel: FeelDay[]; today: string };

export function useClientCycleStatus(clientIds: string[], enabled = true) {
  const ids = [...new Set(clientIds.filter(Boolean))].sort();
  return useQuery({
    queryKey: ['client-cycle-status', ids.join(',')],
    enabled: enabled && ids.length > 0,
    staleTime: 600_000,
    queryFn: async (): Promise<Record<string, ClientCycle>> => {
      const { data, error } = await withTimeout(
        Promise.resolve(supabase.rpc('get_clients_cycle_status', { p_client_ids: ids })),
        NET_MS,
        'Cycle status',
      );
      if (error) {
        if ((error as any).code === 'PGRST202') return {}; // function not installed yet
        throw new Error(error.message);
      }
      const out: Record<string, ClientCycle> = {};
      ((data ?? []) as { client_id: string; today: string; periods: PeriodLog[] | null; feel: FeelLog[] | null }[]).forEach((r) => {
        const status = computeCycleStatus(r.periods ?? [], r.today);
        if (status) out[r.client_id] = { status, feel: summariseFeel(r.feel ?? [], r.today), today: r.today };
      });
      return out;
    },
  });
}
