import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { withTimeout, NET_MS } from './withTimeout';
import type { MyReferral } from './staffReferral';

/* ============ Staff referrals that go straight to the Leads page (21 Nov 2026) ============
   Web parity: src/hooks/useStaffReferrals.ts. The rules and the words are in staffReferral.ts (byte for byte
   with the web). The server does the work: submit_staff_referral makes a lead or adds the referral to an
   existing lead; get_my_referrals returns the member's list with a status for each. */

/** The signed-in member's referrals. The key carries the user id: the cache outlives a sign-out on this phone. */
export function useMyStaffReferrals(userId: string | null) {
  return useQuery({
    queryKey: ['staff-referrals', 'mine', userId],
    enabled: !!userId,
    staleTime: 30_000,
    queryFn: async (): Promise<MyReferral[]> => {
      const { data, error } = await withTimeout<any>(
        Promise.resolve(supabase.rpc('get_my_referrals')) as Promise<any>, NET_MS, 'Referrals');
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]) as MyReferral[];
    },
  });
}

export type ReferralClientChoice = { id: string; name: string; mine: boolean };

/** The clients a member can pick as "the client whose referral this is" (24 Nov 2026). Nothing typed: the
    member's own clients. Two letters or more: any client by name (names only), the member's own first. */
export function useReferralClientChoices(userId: string | null, search: string) {
  const q = search.replace(/\s+/g, ' ').trim();
  const term = q.length >= 2 ? q : '';
  return useQuery({
    queryKey: ['staff-referrals', 'client-choices', userId, term],
    enabled: !!userId,
    staleTime: 60_000,
    placeholderData: (previous: ReferralClientChoice[] | undefined) => previous,
    queryFn: async (): Promise<ReferralClientChoice[]> => {
      const { data, error } = await withTimeout<any>(
        Promise.resolve(supabase.rpc('get_referral_client_choices', { p_q: term || null })) as Promise<any>, NET_MS, 'Clients');
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map((c) => ({ id: String(c.id), name: String(c.name ?? 'No name'), mine: c.mine === true }));
    },
  });
}

export type StaffReferralInput = {
  id: string; name: string; phone: string;
  note?: string | null; clientId?: string | null; source?: string | null;
};

/** Sends a referral. Resolves with the server's answer ({ok, case | reason}); a refusal is not thrown. */
export function useSubmitStaffReferral() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: StaffReferralInput): Promise<unknown> => {
      const { data, error } = await withTimeout<any>(
        Promise.resolve(supabase.rpc('submit_staff_referral', {
          p_name: input.name,
          p_phone: input.phone,
          p_note: input.note?.trim() || null,
          p_client: input.clientId || null,
          p_source: input.source?.trim() || null,
          p_id: input.id,
        })) as Promise<any>, NET_MS, 'Referral');
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff-referrals'] });
      qc.invalidateQueries({ queryKey: ['my-referrals'] });
    },
  });
}
