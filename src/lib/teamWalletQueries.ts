/* Team Wallet data (2 Nov 2026). The read is the definer RPC get_my_team_wallet (own rows only); money moves only
   through the edge functions wallet-create-order / wallet-verify-payment (top-ups) and wallet-settle-ai-plan /
   wallet-discard-ai-plan (the Odds AI plan bill). Server refusals arrive as 'WALLET_CODE: sentence' and are shown
   through walletErrorText. Key 'my-team-wallet' persists (the balance shows offline, read-only). */
import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { invokeWithTimeout, withTimeout, NET_MS } from './withTimeout';
import { invalidateDebounced } from './invalidateDebounced';
import { friendlyError } from './friendlyError';
import { codedWalletSentence, parseWalletRead, parseWalletRow, type TeamWalletRead, type WalletRow } from './teamWallet';
import type { AiPlanResult } from './aiPlanDraft';

export const WALLET_KEY = ['my-team-wallet'] as const;
export const walletErrorText = (e: unknown, fallback: string): string => codedWalletSentence(e) ?? friendlyError(e, fallback);

/* functions.invoke can keep the anon-key Authorization header when the session was restored from storage, so the
   live access token is attached (same as aiPlanQueries.callPlanFn). A refusal becomes an Error carrying the server's
   'WALLET_CODE: sentence' so the screens can show the sentence. */
export async function callWalletFn(name: string, body: Record<string, unknown>, ms: number = NET_MS): Promise<any> {
  let { data } = await supabase.auth.getSession();
  if (!data.session) {
    await new Promise((r) => setTimeout(r, 450));
    ({ data } = await supabase.auth.getSession());
  }
  const token = data.session?.access_token;
  const { data: out, error } = await invokeWithTimeout(name, { body, ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}) }, ms);
  if (error) {
    let m = error?.message ?? 'The wallet is not reachable right now.';
    try {
      const ctx = (error as any).context;
      if (ctx && typeof ctx.json === 'function') m = (await ctx.json())?.error ?? m;
    } catch { /* keep the generic message */ }
    if (/PGRST202|not found|404/i.test(m) && /function/i.test(m)) m = 'WALLET_NOT_SET_UP: The wallet is not set up on the server yet.';
    throw new Error(m);
  }
  if (out?.error) throw new Error(out.error);
  return out;
}

/** My balance, today's room and my newest 50 rows. staleTime 15 s, refetch on focus; persisted under 'my-'. */
export function useTeamWallet(enabled = true) {
  return useQuery({
    queryKey: [...WALLET_KEY],
    enabled,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    queryFn: async (): Promise<TeamWalletRead> => {
      const { data, error } = await withTimeout(
        Promise.resolve((supabase.rpc as any)('get_my_team_wallet', { p_limit: 50 })) as Promise<{ data: any; error: any }>,
        NET_MS, 'Wallet');
      if (error) {
        if (error.code === 'PGRST202' || /could not find the function/i.test(String(error.message ?? ''))) throw new Error('WALLET_NOT_SET_UP: The wallet is not set up on the server yet.');
        throw new Error(error.message);
      }
      return parseWalletRead(data);
    },
  });
}

/** The next page: rows older than `before` (the last row's created_at). Not persisted (key prefix differs). */
export function useTeamWalletPage(before: string | null) {
  return useQuery({
    queryKey: ['team-wallet-page', before],
    enabled: !!before,
    staleTime: 60_000,
    queryFn: async (): Promise<WalletRow[]> => {
      const { data, error } = await withTimeout(
        Promise.resolve((supabase.rpc as any)('get_my_team_wallet', { p_limit: 50, p_before: before })) as Promise<{ data: any; error: any }>,
        NET_MS, 'Wallet');
      if (error) throw new Error(error.message);
      return parseWalletRead(data).rows;
    },
  });
}

/** Everything the inline checkout page needs (walletCheckoutHtml); checkout_url is the server page, which the gateway
    serves as sandboxed text/plain, so the app no longer loads it. */
export type TopupOrder = { tx_id: string; order_id: string; amount_paise: number; checkout_url: string; key_id: string; name: string; email: string; contact: string };
const parseOrder = (d: any): TopupOrder => {
  if (!d?.tx_id || !d?.order_id || !d?.key_id) throw new Error('The checkout could not be prepared. Try again.');
  const p = d.prefill && typeof d.prefill === 'object' ? d.prefill : {};
  return {
    tx_id: String(d.tx_id), order_id: String(d.order_id), amount_paise: Number(d.amount_paise) || 0, checkout_url: String(d.checkout_url ?? ''), key_id: String(d.key_id),
    name: String(p.name ?? ''), email: String(p.email ?? ''), contact: String(p.contact ?? ''),
  };
};
/** Add money: the pending row and the Razorpay order. { amount_inr } for a new top-up, { reopen_tx_id } to reopen a
    pending one from the history. */
export function useCreateTopup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (r: { amount_inr: number } | { reopen_tx_id: string }): Promise<TopupOrder> => parseOrder(await callWalletFn('wallet-create-order', r)),
    onSettled: () => { qc.invalidateQueries({ queryKey: [...WALLET_KEY] }); },
  });
}

export type VerifyInput = { tx_id: string; razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string };
/** After the checkout's message: credit the top-up (the webhook may already have; both land on the same locked function). */
export function useVerifyTopup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (r: VerifyInput): Promise<{ row: WalletRow | null; balance_paise: number; credited_now: boolean }> => {
      const d = await callWalletFn('wallet-verify-payment', r);
      return { row: parseWalletRow(d?.row), balance_paise: Number(d?.balance_paise) || 0, credited_now: d?.credited_now === true };
    },
    onSettled: () => { qc.invalidateQueries({ queryKey: [...WALLET_KEY] }); },
  });
}

/** The ai-plan-draft answer shape, also what the settle call returns. */
export const parseAiPlanResult = (d: any): AiPlanResult => {
  if (!d?.draft || !Array.isArray(d.draft.sections)) throw new Error('Odds AI returned no plan. Try Generate again.');
  const w = d.wallet && typeof d.wallet === 'object' ? d.wallet : null;
  return {
    draft: d.draft,
    dropped: Array.isArray(d.dropped) ? d.dropped : [],
    sources: d.sources ?? null,
    model: String(d.model ?? ''),
    generated_at: String(d.generated_at ?? new Date().toISOString()),
    // 3 Nov 2026 (final rule): the standing for this plan; charge_at 'plan_create' = nothing charged for the draft
    wallet: w ? {
      charged: w.charged === true, charged_paise: Number(w.charged_paise) || 0,
      charge_at: w.charge_at === 'draft' ? 'draft' : 'plan_create', price_paise: w.price_paise == null ? null : Number(w.price_paise),
      balance_paise: Number(w.balance_paise) || 0, negative: w.negative === true, essentials: w.essentials === true,
      free_this: w.free_this === true || w.free === true, free_left: w.free_left == null ? null : Number(w.free_left), error: w.error ? String(w.error) : null,
    } : null,
  };
};
/** Deduct from wallet: the bill becomes paid and the held draft comes back. */
export function useSettleAiBill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (r: { tx_id: string }): Promise<{ result: AiPlanResult; balance_paise: number; already: boolean }> => {
      const d = await callWalletFn('wallet-settle-ai-plan', r);
      return { result: parseAiPlanResult(d?.result), balance_paise: Number(d?.balance_paise) || 0, already: d?.already === true };
    },
    onSettled: () => { qc.invalidateQueries({ queryKey: [...WALLET_KEY] }); qc.invalidateQueries({ queryKey: ['ai-plan-preview'] }); },
  });
}
/** Discard the draft: nothing charged (at most 3 a day). */
export function useDiscardAiBill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (r: { tx_id: string }): Promise<{ already: boolean }> => {
      const d = await callWalletFn('wallet-discard-ai-plan', r);
      return { already: d?.already === true };
    },
    onSettled: () => { qc.invalidateQueries({ queryKey: [...WALLET_KEY] }); qc.invalidateQueries({ queryKey: ['ai-plan-preview'] }); },
  });
}

/** While a row of mine is pending: my team_wallet rows stream (RLS scopes them); any change refreshes the read and a
    top-up that turned paid is reported once (the webhook may credit after the checkout sheet was closed). */
export function useWalletRealtime(uid: string | null | undefined, enabled: boolean, onTopupPaid?: (row: WalletRow) => void) {
  const qc = useQueryClient();
  const cbRef = React.useRef(onTopupPaid);
  cbRef.current = onTopupPaid;
  const seen = React.useRef(new Set<string>());
  React.useEffect(() => {
    if (!uid || !enabled) return;
    const ch = supabase
      .channel(`team-wallet-${uid}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'team_wallet', filter: `user_id=eq.${uid}` }, (p: any) => {
        invalidateDebounced(qc, [...WALLET_KEY], 300);
        const row = parseWalletRow(p?.new);
        if (row && row.kind === 'topup' && row.status === 'paid' && !seen.current.has(row.id)) { seen.current.add(row.id); cbRef.current?.(row); }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [uid, enabled]);
}
