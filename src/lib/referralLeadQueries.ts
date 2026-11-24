import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { withTimeout, NET_MS } from './withTimeout';
import { istDay, readCreditQueue, type CreditQueueItem } from './staffReferral';
import { readReferralWins, type ReferralWin } from './referralWins';
import { hotLeadsFrom, hotLeadsSince, type HotReferralLead } from './referralLeadView';

/* ============ Staff referrals: what the leads team and the client's CRM see (24 Nov 2026) ============
   Web parity: src/hooks/useHotReferralLeads.ts and the second half of src/hooks/useStaffReferrals.ts.
   The member's own side (add a referral, My Referrals) is in staffReferralQueries.ts. */

/**
 * The hot leads: leads a team member referred AGAIN in the last 7 days and that are still open. The server
 * moved such a lead to the day of the referral, so only the last days of the leads table are read. The
 * database's own rules decide which leads a person may see, here as on the rest of the Leads screen.
 */
export function useHotReferralLeads(enabled = true) {
  return useQuery({
    // starts with 'leads', so every change made on the Leads screen refreshes it with the rest
    queryKey: ['leads', 'hot-referrals'],
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async (): Promise<HotReferralLead[]> => {
      const today = istDay(new Date().toISOString());
      const { data, error } = await withTimeout<any>(
        Promise.resolve(
          supabase.from('leads')
            .select('id,name,contact_no,stage,lead_date,remarks')
            .gte('lead_date', hotLeadsSince(today))
            .eq('is_spam', false)
            .is('applicant_lead', null)
            // a JSON text, not an array: this is a jsonb column
            .contains('remarks', JSON.stringify([{ kind: 'staff_referral', duplicate: true }]))
            .order('lead_date', { ascending: false })
            .limit(100),
        ) as Promise<any>, NET_MS, 'Hot leads');
      if (error) throw new Error(error.message);
      return hotLeadsFrom(data, today);
    },
  });
}

/**
 * The referrals given by the signed-in CRM's own clients that have joined Odds and are not marked as
 * congratulated yet, for the celebration on the CRM dashboard. An error simply shows nothing.
 */
export function useMyClientReferralWins(userId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['staff-referrals', 'client-wins', userId],
    enabled: enabled && !!userId,
    staleTime: 60_000,
    refetchInterval: 300_000,
    retry: false,
    queryFn: async (): Promise<ReferralWin[]> => {
      const { data, error } = await withTimeout<any>(
        Promise.resolve(supabase.rpc('get_my_client_referral_wins')) as Promise<any>, NET_MS, 'Referrals');
      if (error) throw new Error(error.message);
      return readReferralWins(data);
    },
  });
}

/** Saves that the client was congratulated for this referral (who and when). The card then goes away. */
export function useMarkReferralCongratulated() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { leadId: string; clientId: string }) => {
      const { data, error } = await withTimeout<any>(
        Promise.resolve(supabase.rpc('mark_referral_congratulated', { p_lead: input.leadId, p_client: input.clientId })) as Promise<any>, NET_MS, 'Referral');
      if (error) throw new Error(error.message);
      return data as { ok: boolean; already: boolean };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff-referrals', 'client-wins'] });
    },
  });
}

/** Ops / admin: converted leads whose referral credit is still to be decided. Empty for everyone else. */
export function useReferralCreditQueue(userId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['staff-referrals', 'credit-queue', userId],
    enabled: enabled && !!userId,
    staleTime: 30_000,
    refetchInterval: 120_000,
    retry: false,
    queryFn: async (): Promise<CreditQueueItem[]> => {
      const { data, error } = await withTimeout<any>(
        Promise.resolve(supabase.rpc('get_referral_credit_queue')) as Promise<any>, NET_MS, 'Referrals');
      if (error) throw new Error(error.message);
      return readCreditQueue(data);
    },
  });
}

/** Ops / admin: credit one member's referral for a lead, or nobody (referralId null). */
export function useDecideReferralCredit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { leadId: string; referralId: string | null }) => {
      const { data, error } = await withTimeout<any>(
        Promise.resolve(supabase.rpc('decide_referral_credit', { p_lead: input.leadId, p_referral: input.referralId })) as Promise<any>, NET_MS, 'Referral');
      if (error) throw new Error(error.message);
      return data as { ok: boolean; credited: boolean };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff-referrals'] });
    },
  });
}
