import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { withTimeout, NET_MS } from './withTimeout';

/* ============ Trainer incentives: UGC submissions (Incentive page) ============
   Separate from incentiveQueries.ts, which is the CRM incentive-request feature.
   One table, `incentive_events`. Until now every row was written by an ADMIN
   approval (referral / cross_sell / package_upgrade / subscription_upgrade) and
   meant "already earned": `status` is NULL on those. The Incentive page lets a
   trainer SELF-SUBMIT a User Generated Content (UGC) event, which is written
   with `event_type = 'ugc'` and `status = 'pending'` for admin review.

   Requires the 19 Sep 2026 migration (odds-app/supabase/incentive_ugc_migration.sql):
   `status text`, `details jsonb`, and 'ugc' in the event_type CHECK. RLS: a
   user reads their own rows (admin reads all); INSERT is open to authenticated
   users, so the caller must pass the real signed-in id (never DEV_TRAINER_ID). */

export type IncentiveStatus = 'pending' | 'approved' | 'rejected' | null;
export type UgcContentType = 'reel_collab' | 'reel_no_collab' | 'stories';

/* The three UGC tiers on the web's Incentive Payout card (static amounts). */
export const UGC_TYPES: { value: UgcContentType; label: string; amount: number; blurb: string }[] = [
  { value: 'reel_collab', label: 'Reel with collaboration', amount: 3000, blurb: 'Client shoots and posts a reel in collaboration with ODDSFITNESS' },
  { value: 'reel_no_collab', label: 'Reel without collaboration', amount: 1500, blurb: 'Client posts a reel but does not accept the collaboration tag' },
  { value: 'stories', label: '2+ stories tagging ODDSFITNESS', amount: 2000, blurb: 'Client posts two or more stories tagging ODDSFITNESS' },
];
export const ugcTypeOf = (v: string | null | undefined) => UGC_TYPES.find((t) => t.value === v) ?? null;
export const fmtInr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

export const EVENT_TYPE_LABEL: Record<string, string> = {
  ugc: 'UGC',
  referral: 'Referral',
  cross_sell: 'Cross-sell',
  package_upgrade: 'Package upgrade',
  subscription_upgrade: 'Subscription upgrade',
};

export type MyIncentiveEvent = {
  id: string;
  eventType: string;
  status: IncentiveStatus;   // null = created by an admin approval (already earned)
  eventDate: string;
  eventMonth: string | null;
  clientName: string | null;
  newValue: string | null;   // UGC: the content type; upgrades: the new tier
  details: { content_type?: UgcContentType; post_url?: string; notes?: string | null; platform?: string } | null;
  createdAt: string;
};

const fullName = (p: any) => `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.replace(/\s+/g, ' ').trim();

/** My incentive events, newest first (every type, like the web's useMyIncentives). */
export function useMyIncentiveEvents(userId: string | null) {
  return useQuery({
    queryKey: ['my-incentive-events', userId],
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async (): Promise<MyIncentiveEvent[]> => {
      // `status` / `details` only exist after the migration; fall back to the old
      // column list so the page still renders its earned rows before it is run.
      const FULL = 'id, event_type, status, event_date, event_month, new_value, details, created_at, client:client_id ( first_name, last_name )';
      const OLD = 'id, event_type, event_date, event_month, new_value, created_at, client:client_id ( first_name, last_name )';
      let res: any = await withTimeout<any>(Promise.resolve(supabase.from('incentive_events').select(FULL).eq('user_id', userId as string).order('event_date', { ascending: false })) as Promise<any>, NET_MS, 'Incentives');
      if (res.error && /status|details/.test(res.error.message)) {
        res = await withTimeout<any>(Promise.resolve(supabase.from('incentive_events').select(OLD).eq('user_id', userId as string).order('event_date', { ascending: false })) as Promise<any>, NET_MS, 'Incentives');
      }
      if (res.error) throw new Error(res.error.message);
      return ((res.data ?? []) as any[]).map((r) => {
        const c = Array.isArray(r.client) ? r.client[0] : r.client;
        return {
          id: r.id,
          eventType: r.event_type,
          status: (r.status ?? null) as IncentiveStatus,
          eventDate: r.event_date,
          eventMonth: r.event_month ?? null,
          clientName: c ? fullName(c) || null : null,
          newValue: r.new_value ?? null,
          details: r.details ?? null,
          createdAt: r.created_at,
        };
      });
    },
  });
}

/* IST calendar helpers: event_month is the first of the month the event belongs to. */
const istYmd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
export const monthStartOf = (ymd: string) => `${ymd.slice(0, 7)}-01`;

export type SubmitUgcInput = {
  userId: string;
  clientId: string | null;
  contentType: UgcContentType;
  postUrl: string;
  postedOn: string; // yyyy-MM-dd (IST)
  notes: string;
};

/** Self-submitted UGC: status 'pending' until admin approves. */
export function useSubmitUgc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SubmitUgcInput) => {
      const url = input.postUrl.trim();
      if (!/^https?:\/\/\S+\.\S+/i.test(url)) throw new Error('Paste the full link to the post (starts with https://).');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.postedOn)) throw new Error('Pick the date it was posted.');
      const row = {
        user_id: input.userId,
        client_id: input.clientId,
        event_type: 'ugc',
        new_value: input.contentType,
        event_date: `${input.postedOn}T00:00:00+05:30`,
        event_month: monthStartOf(input.postedOn),
        status: 'pending',
        details: { content_type: input.contentType, post_url: url, notes: input.notes.trim() || null, platform: 'instagram' },
      };
      const { error } = await withTimeout<any>(Promise.resolve(supabase.from('incentive_events').insert(row)) as Promise<any>, NET_MS, 'Submit');
      if (error) {
        // 23514 = CHECK violation, 42703 = unknown column: the UGC migration has not been run yet.
        if (error.code === '23514' || error.code === '42703' || /status|details|event_type/.test(error.message)) {
          throw new Error('UGC incentives are not enabled on the backend yet (incentive_ugc_migration.sql). Ask admin.');
        }
        throw new Error(error.message);
      }
    },
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ['my-incentive-events', v.userId] });
      qc.invalidateQueries({ queryKey: ['incentive-metrics'] });
      qc.invalidateQueries({ queryKey: ['incentive-leaderboard'] });
    },
  });
}

export { istYmd as incentiveTodayYmd };
