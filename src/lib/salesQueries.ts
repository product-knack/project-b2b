import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { C } from '../theme';

/* ============ CRM Sales Tracker — mirrors the web useSalesTargetsOverview /
   useSalesTrackerTargets contracts on sales_tracker.
   Note: append_sales_target_note RPC is Ops-only (DB enforced) — ops_notes are
   read-only for CRMs here, same as production permissions. ============ */

export type SalesStatus = 'open' | 'won' | 'lost';
export type SalesTargetType = 'package' | 'subscription' | 'service';

export const TARGET_TYPES: { id: SalesTargetType; label: string; color: string }[] = [
  { id: 'package', label: 'Package', color: C.orange },
  { id: 'subscription', label: 'Subscription', color: C.blue },
  { id: 'service', label: 'Service', color: C.gold },
];

export type OpsNote = { id: string; by_name: string; by_role: string; category: string; note: string; at: string };
export type SalesTarget = {
  id: string; clientId: string; clientName: string; ownerName: string;
  type: SalesTargetType; value: string; status: SalesStatus;
  lostReason: string | null; expectedClose: string | null; closedAt: string | null;
  notes: string | null; opsNotes: OpsNote[]; createdAt: string; updatedAt: string;
  overdue: boolean; closingSoon: boolean;
};

const fullName = (p: any) => `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || '—';

export function useSalesTargets(crmId: string | null) {
  return useQuery({
    queryKey: ['sales-targets', crmId],
    enabled: !!crmId,
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async (): Promise<SalesTarget[]> => {
      // Restrict to this CRM's book (the web filters by its client tabs).
      const { data: book, error: bErr } = await supabase
        .from('trainer_clients').select('client_id').eq('trainer_id', crmId).eq('actively_training', true);
      if (bErr) throw new Error(bErr.message);
      const ids = [...new Set((book ?? []).map((r: any) => r.client_id))];
      if (!ids.length) return [];
      const { data, error } = await supabase
        .from('sales_tracker')
        .select('id, client_id, created_by, target_type, target_value, status, lost_reason, expected_close_date, closed_at, notes, ops_notes, created_at, updated_at, clients:client_id(first_name, last_name)')
        .in('client_id', ids)
        .order('created_at', { ascending: true });
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as any[];
      const ownerIds = [...new Set(rows.map((r) => r.created_by).filter(Boolean))];
      const owners = new Map<string, string>();
      if (ownerIds.length) {
        const { data: profs } = await supabase.from('profiles').select('id, first_name, last_name').in('id', ownerIds);
        (profs ?? []).forEach((p: any) => owners.set(p.id, fullName(p)));
      }
      const today = new Date(); today.setHours(0, 0, 0, 0);
      return rows.map((r) => {
        const due = r.expected_close_date ? new Date(r.expected_close_date + 'T00:00:00') : null;
        const days = due ? Math.round((due.getTime() - today.getTime()) / 864e5) : null;
        return {
          id: r.id, clientId: r.client_id, clientName: fullName(r.clients),
          ownerName: r.created_by ? owners.get(r.created_by) ?? '—' : '—',
          type: r.target_type, value: r.target_value ?? '', status: r.status,
          lostReason: r.lost_reason ?? null, expectedClose: r.expected_close_date ?? null,
          closedAt: r.closed_at ?? null, notes: r.notes ?? null,
          opsNotes: Array.isArray(r.ops_notes) ? r.ops_notes : [],
          createdAt: r.created_at, updatedAt: r.updated_at,
          // Web rule: open with no date OR past date = overdue; within 7 days = closing soon.
          overdue: r.status === 'open' && (days == null || days < 0),
          closingSoon: r.status === 'open' && days != null && days >= 0 && days <= 7,
        };
      });
    },
  });
}

export function useCreateSalesTarget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { crmId: string; clientId: string; type: SalesTargetType; value: string; status: SalesStatus; lostReason: string | null; expectedClose: string | null; notes: string | null }) => {
      if (!input.value.trim()) throw new Error('Target value is required');
      const { error } = await supabase.from('sales_tracker').insert({
        client_id: input.clientId,
        created_by: input.crmId,
        target_type: input.type,
        target_value: input.value.trim(),
        status: input.status,
        expected_close_date: input.expectedClose,
        notes: input.notes?.trim() || null,
        lost_reason: input.status === 'lost' ? input.lostReason : null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sales-targets'] }),
  });
}

/* Generation pooling notice (web: "Sessions shared from X's generation pool"). */
export function useGenerationInfo(clientId: string | null) {
  return useQuery({
    queryKey: ['sales-generation-info', clientId],
    enabled: !!clientId,
    staleTime: 300_000,
    queryFn: async (): Promise<{ pooled: boolean; adminName: string | null }> => {
      try {
        const { data: adminId } = await supabase.rpc('get_generation_admin_for_client', { p_client_id: clientId });
        if (!adminId || adminId === clientId) return { pooled: false, adminName: null };
        const { data: admin } = await supabase.from('clients').select('first_name, last_name').eq('id', adminId).maybeSingle();
        return { pooled: true, adminName: admin ? fullName(admin) : null };
      } catch {
        return { pooled: false, adminName: null };
      }
    },
  });
}

export function useUpdateSalesTarget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; status: SalesStatus; lostReason?: string | null }) => {
      const patch: any = { status: input.status, lost_reason: input.status === 'lost' ? (input.lostReason ?? null) : null };
      if (input.status === 'open') patch.closed_at = null; // reopen
      const { error } = await supabase.from('sales_tracker').update(patch).eq('id', input.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sales-targets'] }),
  });
}
