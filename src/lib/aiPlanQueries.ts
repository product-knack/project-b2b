/* Odds AI plan assistant data (16 Oct 2026). The edge function ai-plan-draft (hub-track) reads the
   client's latest QHP, medical history, blood markers and health context and drafts a plan from
   exercises_db; it writes nothing. The plan is saved by Create Plan exactly as before. The home alert
   list is the definer RPC get_my_essentials_plan_gaps (migration 20261016150000). */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { invokeWithTimeout, withTimeout, NET_MS } from './withTimeout';
import type { AiPlanPreview, AiPlanResult, EssentialsPlanGap, SplitKey } from './aiPlanDraft';
import { parseWalletGate, type AiBill, type BillPreview } from './teamWallet';
import { parseAiPlanResult } from './teamWalletQueries';

/** Generating takes 20 to 40 seconds (Gemini reads the QHP and picks from about 230 exercises). */
export const AI_PLAN_MS = 100_000;
export const PLAN_GAPS_KEY = ['trainer-essentials-plan-gaps'] as const;

/* functions.invoke can keep the anon-key Authorization header when the session was restored
   from storage, so the live access token is attached (same as clientQueries.invokeEdgeFn). */
async function callPlanFn(body: Record<string, unknown>, ms: number): Promise<any> {
  let { data } = await supabase.auth.getSession();
  if (!data.session) {
    await new Promise((r) => setTimeout(r, 450));
    ({ data } = await supabase.auth.getSession());
  }
  const token = data.session?.access_token;
  const { data: out, error } = await invokeWithTimeout('ai-plan-draft', { body, ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}) }, ms);
  if (error) {
    let m = error?.message ?? 'Odds AI is not reachable right now.';
    try {
      const ctx = (error as any).context;
      if (ctx && typeof ctx.json === 'function') m = (await ctx.json())?.error ?? m;
    } catch { /* keep the generic message */ }
    if (/PGRST202|not found|404/i.test(m) && /function/i.test(m)) m = 'The AI plan assistant is not set up on the server yet.';
    throw new Error(m);
  }
  if (out?.error) throw new Error(out.error);
  return out;
}

/** Is the assistant available for this client (an Essentials client the caller may plan for), and what
    will it read. No AI call; key ['ai-plan-preview', clientId], 5 min stale, not persisted. */
export function useAiPlanPreview(clientId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ['ai-plan-preview', clientId ?? null],
    enabled: !!clientId && enabled,
    staleTime: 5 * 60_000,
    retry: 1,
    queryFn: async (): Promise<AiPlanPreview> => {
      const d = await callPlanFn({ client_id: clientId, preview: true }, NET_MS);
      return {
        eligible: d?.eligible === true,
        allowed: d?.allowed === true,
        essentials: d?.essentials === true,
        client_name: String(d?.client_name ?? ''),
        sources: d?.sources ?? null,
        model: String(d?.model ?? ''),
        wallet: parseWalletGate(d?.wallet),
      };
    },
  });
}

/** sessionsPerWeek is optional: without it the server uses the client's weekly slot count (the app sends none since 16 Oct 2026). */
export type AiPlanRequest = { clientId: string; split: SplitKey; sessionsPerWeek?: number; note?: string };
/** The draft call's answer: the draft itself, or (a trainer, Team Wallet 2 Nov 2026) a bill holding it until
    Deduct from wallet (wallet-settle-ai-plan returns the same AiPlanResult). */
export type AiPlanAnswer = { kind: 'draft'; result: AiPlanResult } | { kind: 'bill'; bill: AiBill; preview: BillPreview | null };
/** One draft (20 to 40 s). Throws the server's sentence on refusal. */
export function useAiPlanDraft() {
  const qc = useQueryClient();
  return useMutation({
    // A free draft or a bill changes the preview's wallet line and the Wallet history.
    onSettled: () => { qc.invalidateQueries({ queryKey: ['ai-plan-preview'] }); qc.invalidateQueries({ queryKey: ['my-team-wallet'] }); },
    mutationFn: async (r: AiPlanRequest): Promise<AiPlanAnswer> => {
      const d = await callPlanFn({ client_id: r.clientId, split: r.split, sessions_per_week: r.sessionsPerWeek ?? undefined, note: r.note?.trim() || undefined }, AI_PLAN_MS);
      if (d?.bill?.tx_id) {
        const p = d.preview && typeof d.preview === 'object' ? d.preview : null;
        return {
          kind: 'bill',
          bill: { tx_id: String(d.bill.tx_id), bill_paise: Number(d.bill.bill_paise) || 0, balance_paise: Number(d.bill.balance_paise) || 0, blocks: Array.isArray(d.bill.blocks) ? d.bill.blocks.map(String) : [] },
          preview: p ? { sections: Array.isArray(p.sections) ? p.sections.map(String) : [], exercise_count: Number(p.exercise_count) || 0, split_label: p.split_label ?? null } : null,
        };
      }
      return { kind: 'draft', result: parseAiPlanResult(d) };
    },
  });
}

/** The trainer's upcoming Essentials clients with no valid Strength Training plan (home alert).
    Persisted under the 'trainer-' prefix so the card shows offline; [] while the RPC is missing. */
export function useEssentialsPlanGaps(enabled = true) {
  return useQuery({
    queryKey: PLAN_GAPS_KEY,
    enabled,
    staleTime: 60_000,
    refetchOnMount: true,
    queryFn: async (): Promise<EssentialsPlanGap[]> => {
      const { data, error } = await withTimeout(
        Promise.resolve((supabase.rpc as any)('get_my_essentials_plan_gaps')) as Promise<{ data: any; error: any }>,
        NET_MS, 'Plan alerts');
      if (error) {
        if (error.code === 'PGRST202' || /could not find the function/i.test(String(error.message ?? ''))) return [];
        throw new Error(error.message);
      }
      return ((data ?? []) as any[]).map((r) => ({
        client_id: String(r.client_id),
        client_name: String(r.client_name ?? 'Client'),
        next_session_at: String(r.next_session_at),
        next_modality: r.next_modality ?? null,
        sessions_upcoming: Number(r.sessions_upcoming) || 0,
        plan_state: r.plan_state === 'in_review' || r.plan_state === 'needs_revision' ? r.plan_state : 'none',
        review_plan_id: r.review_plan_id ?? null,
        review_plan_name: r.review_plan_name ?? null,
        review_since: r.review_since ?? null,
        review_by_me: typeof r.review_by_me === 'boolean' ? r.review_by_me : null,
        last_approved_at: r.last_approved_at ?? null,
      }));
    },
  });
}
