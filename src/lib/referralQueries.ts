import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { withTimeout, NET_MS } from './withTimeout';

/* ============ Staff referrals — "I brought this person in" ============
   Port of the web's useTrainerReferrals.ts. A staff member records someone they
   referred; it sits at `pending` until an ADMIN approves or rejects it, and
   approval writes the `incentive_events` row the incentive and leaderboard
   surfaces count. The admin side already exists on native (adminRequestQueries
   + adminRequests) — this file is only the submitter's half.

   THREE DIFFERENT THINGS ARE CALLED "REFERRAL" in this backend. This is the
   `referrals` table only. `crm_incentive_request` (request_type 'referral') and
   `referred_leads` / clients.professional_referrals are unrelated features.

   THERE IS NO RPC: create is a direct insert, and RLS is the whole gate —
   INSERT is checked as `referrer_id = auth.uid()`, SELECT as your own rows (plus
   literal role 'admin' for everything). So the caller MUST pass the real signed
   in user id. Never substitute DEV_TRAINER_ID here the way payouts.tsx does for
   the shared test account: the SELECT would return an empty list and the insert
   would be rejected with 42501.
   Verified live 2026-09-10: both FK embed hints below resolve; 53 rows exist
   (40 approved, 6 rejected, 7 pending, 0 converted). */

export type ReferralStatus = 'pending' | 'approved' | 'rejected' | 'converted';

export type MyReferral = {
  id: string;
  referred_client_name: string;
  status: ReferralStatus;
  trainer_source: string | null;
  notes: string | null;
  rejection_reason: string | null;
  created_at: string;
  approved_at: string | null;
  linkedClientName: string | null;
};

export type ReferralClientOption = { id: string; name: string };

const fullName = (p: any) => `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.trim();

/* The embed is a CONSTRAINT name, not a column — copy it exactly. `referrals` has
   two FKs to clients (referred_client_id and linked_existing_client), so without
   the hint PostgREST errors with "more than one relationship". */
const REFERRAL_SELECT = `
  id, referred_client_name, status, trainer_source, notes, rejection_reason, created_at, approved_at,
  linked_client:clients!referrals_linked_existing_client_fkey ( first_name, last_name )
`;

/** My own referrals, newest first. Empty for a signed-out user rather than throwing. */
export function useMyReferrals(userId: string | null) {
  return useQuery({
    queryKey: ['my-referrals', userId],
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async (): Promise<MyReferral[]> => {
      const { data, error } = await withTimeout<any>(
        Promise.resolve(
          supabase.from('referrals').select(REFERRAL_SELECT)
            .eq('referrer_id', userId as string)
            .order('created_at', { ascending: false })
            .limit(500),
        ) as Promise<any>,
        NET_MS, 'Referrals');
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map((r) => {
        // The embed comes back as an object or a one-element array depending on
        // how PostgREST resolves the relationship — normalise both.
        const lc = Array.isArray(r.linked_client) ? r.linked_client[0] : r.linked_client;
        return {
          id: r.id,
          referred_client_name: r.referred_client_name ?? '',
          status: (r.status ?? 'pending') as ReferralStatus,
          trainer_source: r.trainer_source ?? null,
          notes: r.notes ?? null,
          rejection_reason: r.rejection_reason ?? null,
          created_at: r.created_at,
          approved_at: r.approved_at ?? null,
          linkedClientName: lc ? fullName(lc) || null : null,
        };
      });
    },
  });
}

/** My assigned clients, for the "who introduced them" picker.
    Web deliberately does NOT filter actively_training here (a client who has
    moved on can still have made the introduction), so neither do we; we only
    de-duplicate and sort, which changes no rows. */
export function useMyReferralClients(userId: string | null) {
  return useQuery({
    queryKey: ['my-referral-clients', userId],
    enabled: !!userId,
    staleTime: 300_000,
    queryFn: async (): Promise<ReferralClientOption[]> => {
      const { data, error } = await withTimeout<any>(
        Promise.resolve(
          supabase.from('trainer_clients')
            .select('client_id, clients ( id, first_name, last_name )')
            .eq('trainer_id', userId as string),
        ) as Promise<any>,
        NET_MS, 'Clients');
      if (error) throw new Error(error.message);
      const seen = new Map<string, ReferralClientOption>();
      for (const row of (data ?? []) as any[]) {
        const c = Array.isArray(row.clients) ? row.clients[0] : row.clients;
        if (!c?.id || seen.has(c.id)) continue;
        seen.set(c.id, { id: c.id, name: fullName(c) || 'Client' });
      }
      return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
    },
  });
}

export type CreateReferralInput = {
  referrerId: string;
  name: string;
  source?: string;
  linkedClientId?: string | null;
  notes?: string;
};

/** Direct insert — the web path verbatim. Phone and email are OMITTED (not sent
    as ''), so an admin card renders the same blanks for a trainer-submitted
    referral on both platforms. */
export function useCreateReferral() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (i: CreateReferralInput) => {
      if (!i.referrerId) throw new Error('Not signed in');
      const name = i.name.trim();
      if (!name) throw new Error('Add the referral name');
      const { error } = await withTimeout<any>(
        Promise.resolve(
          supabase.from('referrals').insert({
            referrer_id: i.referrerId,           // must equal auth.uid() or RLS rejects with 42501
            referred_client_name: name,
            trainer_source: i.source?.trim() || null,
            linked_existing_client: i.linkedClientId || null,
            notes: i.notes?.trim() || null,
            status: 'pending',
          }),
        ) as Promise<any>,
        NET_MS, 'Add referral');
      if (error) {
        if ((error as any).code === '42501') throw new Error('This account cannot add a referral for someone else.');
        throw new Error(error.message);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-referrals'] });
      qc.invalidateQueries({ queryKey: ['admin-referrals'] }); // the approvals queue
    },
  });
}
