import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { C } from '../theme';

/* ============ CRM Client Distribution — mirrors useCRMClientDistribution (web):
   crm_client_distribution {client_id, crm_id, category}, upsert on client_id+crm_id. ============ */

export type DistributionCategory = 'critical_care' | 'highly_engaged' | 'active_watch' | 'cruise_mode';

export const DIST_CATEGORIES: { id: DistributionCategory; label: string; color: string; hint: string }[] = [
  { id: 'critical_care', label: 'Critical Care', color: C.purple, hint: 'Needs close attention right now' },
  { id: 'highly_engaged', label: 'Highly Engaged', color: C.red, hint: 'High-touch, very invested clients' },
  { id: 'active_watch', label: 'Active Watch', color: C.gold, hint: 'Stable but keep an eye on them' },
  { id: 'cruise_mode', label: 'Cruise Mode', color: C.green, hint: 'Running smoothly on their own' },
];

export function useClientDistribution(crmId: string | null) {
  return useQuery({
    queryKey: ['crm-client-distribution', crmId],
    enabled: !!crmId,
    staleTime: 30_000,
    queryFn: async (): Promise<Record<string, DistributionCategory>> => {
      const { data, error } = await supabase
        .from('crm_client_distribution')
        .select('client_id, category')
        .eq('crm_id', crmId);
      if (error) throw new Error(error.message);
      const map: Record<string, DistributionCategory> = {};
      ((data ?? []) as any[]).forEach((r) => { map[r.client_id] = r.category; });
      return map;
    },
  });
}

export function useUpsertDistribution() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { crmId: string; clientId: string; category: DistributionCategory }) => {
      const { error } = await supabase
        .from('crm_client_distribution')
        .upsert(
          { client_id: input.clientId, crm_id: input.crmId, category: input.category },
          { onConflict: 'client_id,crm_id' },
        );
      if (error) throw new Error(error.message);
    },
    // Optimistic: flip the local map immediately, roll back on error.
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: ['crm-client-distribution', input.crmId] });
      const prev = qc.getQueryData<Record<string, DistributionCategory>>(['crm-client-distribution', input.crmId]);
      qc.setQueryData(['crm-client-distribution', input.crmId], { ...(prev ?? {}), [input.clientId]: input.category });
      return { prev };
    },
    onError: (_e, input, ctx) => {
      if (ctx?.prev) qc.setQueryData(['crm-client-distribution', input.crmId], ctx.prev);
    },
    onSettled: (_r, _e, input) => qc.invalidateQueries({ queryKey: ['crm-client-distribution', input.crmId] }),
  });
}
