/* Essentials by Odds trainer auction (1 Oct 2026; bids by questions since 10 Oct
   2026, hub-track migration 20261010120000_essentials_auction_bids.sql), same
   contract as the web's src/hooks/useEssentialsAuction.ts. The lots refresh every
   20 s while the screen is open so other trainers' bids and the 4 PM decision
   show up without a reload. Keys carry no persisted prefix: the auction is always
   read fresh. grab_essentials_session is retired (the server refuses it) and is
   not called anywhere in the app. */
import React from 'react';
import { AppState } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { withTimeout, NET_MS } from './withTimeout';
import type { EssentialsCancellation } from './essentialsAuction';
import {
  AuctionConfig, AuctionLot, AuctionQuiz, AuctionResult, BidResult, DEFAULT_AUCTION_CONFIG, EtaSession, LotEta,
  computeLotEta, describeGrabError, geoFromBrb,
} from './essentialsAuction';

type RpcResult = { data: any; error: any };
const num = (v: unknown): number | null => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/** The window and the preferred trainer's head start, from the database (one source of truth); the defaults
    until the SQL is run. Re-read every 10 minutes so a window change in the database reaches open apps. */
export function useAuctionConfig() {
  return useQuery({
    queryKey: ['essentials-auction-config'],
    staleTime: 10 * 60_000,
    refetchInterval: 10 * 60_000,
    queryFn: async (): Promise<AuctionConfig> => {
      const { data, error } = await withTimeout(Promise.resolve(supabase.rpc('essentials_auction_config')) as Promise<RpcResult>, NET_MS, 'Auction config');
      if (error || !data || typeof data !== 'object') return DEFAULT_AUCTION_CONFIG;
      return {
        open: typeof data.open === 'string' ? data.open : DEFAULT_AUCTION_CONFIG.open,
        close: typeof data.close === 'string' ? data.close : DEFAULT_AUCTION_CONFIG.close,
        reserve_minutes: Number.isFinite(Number(data.reserve_minutes)) ? Number(data.reserve_minutes) : DEFAULT_AUCTION_CONFIG.reserve_minutes,
      };
    },
  });
}

/** Tomorrow's lots. Trainers pass no date: the database takes tomorrow in India time
    itself, so a phone whose clock sits on the wrong day still gets the right lots.
    `date` (the app's own tomorrow) only keys the cache so it rolls at IST midnight. */
export function useEssentialsAuction(date: string, enabled = true) {
  return useQuery({
    queryKey: ['essentials-auction', date],
    enabled,
    staleTime: 10_000,
    refetchInterval: enabled ? 20_000 : false,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<AuctionLot[]> => {
      const { data, error } = await withTimeout(Promise.resolve(supabase.rpc('get_essentials_auction')) as Promise<RpcResult>, NET_MS, 'Auction');
      if (error) throw new Error(describeGrabError(error));
      return ((data ?? []) as any[]).map((r) => ({
        auction_date: r.auction_date,
        client_id: r.client_id,
        client_name: r.client_name ?? 'Client',
        modality: r.modality ?? '',
        slot_time: String(r.slot_time ?? '').slice(0, 5),
        scheduled_for: r.scheduled_for,
        status: (r.status ?? 'open') as AuctionLot['status'],
        trainer_id: r.trainer_id ?? null,
        trainer_name: r.trainer_name ?? null,
        grabbed_at: r.grabbed_at ?? null,
        session_id: r.session_id ?? null,
        preferred_trainer_id: r.preferred_trainer_id ?? null,
        preferred_trainer_name: r.preferred_trainer_name ?? null,
        reserved_until: r.reserved_until ?? null,
        bids_count: num(r.bids_count) ?? 0,
        question_count: num(r.question_count) ?? 0,
        my_points: num(r.my_points),
        my_submitted_at: r.my_submitted_at ?? null,
        winner_trainer_id: r.winner_trainer_id ?? null,
        winner_name: r.winner_name ?? null,
        winner_points: num(r.winner_points),
        round_result: (r.round_result ?? null) as AuctionLot['round_result'],
        evaluated_at: r.evaluated_at ?? null,
      }));
    },
  });
}

/** The client's five questions, without answers, plus whether the caller may bid and already did.
    No date is sent: the database takes tomorrow in India time, like the lots. Never cached across opens. */
export function useAuctionQuiz(clientId: string | null, date: string) {
  return useQuery({
    queryKey: ['essentials-auction-quiz', clientId, date],
    enabled: !!clientId,
    staleTime: 0,
    gcTime: 0,
    queryFn: async (): Promise<AuctionQuiz> => {
      const { data, error } = await withTimeout(
        Promise.resolve(supabase.rpc('get_essentials_auction_quiz', { p_client_id: clientId })) as Promise<RpcResult>,
        NET_MS, 'Auction questions');
      if (error) throw new Error(describeGrabError(error));
      const d = (data ?? {}) as any;
      return {
        client_id: d.client_id ?? clientId,
        training_date: d.training_date ?? date,
        blocked: typeof d.blocked === 'string' && d.blocked.trim() ? d.blocked : null,
        questionnaire_version: num(d.questionnaire_version),
        question_count: num(d.question_count) ?? 0,
        questions: Array.isArray(d.questions)
          ? d.questions.map((q: any, i: number) => ({
              n: num(q.n) ?? i + 1,
              source: q.source === 'context' ? 'context' : 'weekly',
              question: String(q.question ?? ''),
              options: Array.isArray(q.options) ? q.options.map(String) : [],
            }))
          : [],
        already_bid: !!d.already_bid,
        my_bid: d.my_bid
          ? { points: num(d.my_bid.points) ?? 0, submitted_at: d.my_bid.submitted_at, correct: Array.isArray(d.my_bid.correct) ? d.my_bid.correct.map(Boolean) : [] }
          : null,
        bids_count: num(d.bids_count) ?? 0,
      };
    },
  });
}

/** One attempt: every answer at once (0-based option indexes, in question order; [] when there are no
    questions); the server scores them and keeps the bid with its time. p_client_id and p_answers only. */
export function useSubmitEssentialsBid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (i: { clientId: string; answers: number[] }): Promise<BidResult> => {
      const { data, error } = await withTimeout(
        Promise.resolve(supabase.rpc('submit_essentials_bid', { p_client_id: i.clientId, p_answers: i.answers })) as Promise<RpcResult>,
        NET_MS, 'Place my bid');
      if (error) throw new Error(describeGrabError(error));
      const d = (data ?? {}) as any;
      return {
        client_id: d.client_id ?? i.clientId,
        client_name: d.client_name ?? 'Client',
        training_date: d.training_date ?? '',
        slot_time: String(d.slot_time ?? '').slice(0, 5),
        modality: d.modality ?? '',
        points: num(d.points) ?? 0,
        question_count: num(d.question_count) ?? 0,
        correct: Array.isArray(d.correct) ? d.correct.map(Boolean) : [],
        submitted_at: d.submitted_at ?? new Date().toISOString(),
        bids_count: num(d.bids_count) ?? 0,
        instant_win: d.instant_win === true,
        session_id: typeof d.session_id === 'string' ? d.session_id : null,
        winner_name: typeof d.winner_name === 'string' ? d.winner_name : null,
        instant_blocked: typeof d.instant_blocked === 'string' && d.instant_blocked ? d.instant_blocked : null,
      };
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['essentials-auction'] });
      qc.invalidateQueries({ queryKey: ['essentials-auction-quiz'] });
      // An instant win is a decided round and a booked session: the won card and the roster must follow at once.
      qc.invalidateQueries({ queryKey: ['essentials-auction-results'] });
      qc.invalidateQueries({ queryKey: ['trainer-roster'] });
    },
  });
}

/** The caller's decided rounds of the last N hours (the server stops listing a round after that, so the
    app needs no expiry logic). 60 s stale, every 5 minutes, on focus and on foreground. A missing
    function (PGRST202) reads as "no results" so an older server shows nothing. */
export function useMyAuctionResults(hours = 4, enabled = true) {
  const q = useQuery({
    queryKey: ['essentials-auction-results', hours],
    enabled,
    staleTime: 60_000,
    refetchInterval: enabled ? 5 * 60_000 : false,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<AuctionResult[]> => {
      const { data, error } = await withTimeout(
        Promise.resolve(supabase.rpc('get_my_auction_results', { p_hours: hours })) as Promise<RpcResult>,
        NET_MS, 'Auction results');
      if (error) {
        if (error.code === 'PGRST202' || /PGRST202|could not find the function/i.test(String(error.message ?? ''))) return [];
        throw new Error(describeGrabError(error));
      }
      return ((data ?? []) as any[]).map((r) => ({
        round_key: String(r.round_key ?? `${r.client_id}:${r.training_date}`),
        client_id: r.client_id,
        client_name: r.client_name ?? 'Client',
        training_date: r.training_date,
        slot_time: String(r.slot_time ?? '').slice(0, 5),
        modality: r.modality ?? '',
        won: !!r.won,
        result: (r.result ?? null) as AuctionResult['result'],
        my_points: num(r.my_points) ?? 0,
        question_count: num(r.question_count) ?? 0,
        my_submitted_at: r.my_submitted_at,
        winner_trainer_id: r.winner_trainer_id ?? null,
        winner_name: r.winner_name ?? null,
        winner_points: num(r.winner_points),
        bids_count: num(r.bids_count) ?? 0,
        session_id: r.session_id ?? null,
        evaluated_at: r.evaluated_at,
      }));
    },
  });
  const refetch = q.refetch;
  React.useEffect(() => {
    if (!enabled) return;
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') refetch(); });
    return () => sub.remove();
  }, [enabled, refetch]);
  return q;
}

/** The client's latest QHP front-view photo (1 Oct 2026, user request): recent reports store a public
    `qhp-images` URL in qhp_details.qhp_json.postural_assessment.front_view.photo_reference (older ones hold
    a placeholder word, skipped). Read directly: trainers and physios can read qhp_details. A nicety: on any
    error the map is empty and the card falls back to initials. */
export function useAuctionClientPhotos(clientIds: string[]) {
  const key = [...new Set(clientIds)].sort().join(',');
  return useQuery({
    queryKey: ['essentials-auction-photos', key],
    enabled: clientIds.length > 0,
    staleTime: 300_000,
    queryFn: async (): Promise<Record<string, string>> => {
      const ids = [...new Set(clientIds)];
      const { data, error } = await withTimeout(
        Promise.resolve(
          supabase
            .from('qhp_details')
            .select('client_id, created_at, ref:qhp_json->postural_assessment->front_view->>photo_reference, url:qhp_json->postural_assessment->front_view->>photo_url')
            .in('client_id', ids)
            .order('created_at', { ascending: false })
            .limit(ids.length * 6),
        ) as Promise<{ data: any[] | null; error: any }>,
        NET_MS, 'QHP photos');
      if (error) return {};
      const out: Record<string, string> = {};
      (data ?? []).forEach((r) => {
        if (out[r.client_id]) return;
        const u = [r.ref, r.url].find((v) => typeof v === 'string' && /^https?:\/\//i.test(v));
        if (u) out[r.client_id] = u;
      });
      return out;
    },
  });
}

/** ETA per lot (1 Oct 2026, user request): the signed-in trainer's own sessions of the auction day
    within 3 hours either side of the lot, the drive between those clients and the lot's client
    (clients.brb_location pins, road estimate), and the lot client's location text when there is
    no pin (clients.location, else the latest QHP's coach_assessment.location). Read-only, three
    selects trainers and physios are allowed; any error leaves the map empty (the card simply
    shows no ETA block). Key rolls with the lots and the day. */
export function useAuctionEta(lots: AuctionLot[], me: string | null, date: string) {
  const ids = [...new Set(lots.map((l) => l.client_id))].sort();
  const key = `${date}|${ids.join(',')}|${lots.map((l) => `${l.client_id}@${l.slot_time}`).sort().join(',')}`;
  return useQuery({
    queryKey: ['essentials-auction-eta', me, key],
    enabled: !!me && lots.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<Record<string, LotEta>> => {
      // The auction day in IST: [00:00, 24:00) of `date`.
      const dayStart = new Date(`${date}T00:00:00+05:30`).toISOString();
      const dayEnd = new Date(`${date}T23:59:59.999+05:30`).toISOString();
      const [clientsR, qhpR, mineR] = await Promise.all([
        withTimeout(Promise.resolve(supabase.from('clients').select('id, brb_location, location').in('id', ids)) as Promise<{ data: any[] | null; error: any }>, NET_MS, 'Client locations'),
        withTimeout(Promise.resolve(supabase.from('coach_assessment').select('client_id, assessment_date, location').in('client_id', ids).not('location', 'is', null).order('assessment_date', { ascending: false }).limit(ids.length * 4)) as Promise<{ data: any[] | null; error: any }>, NET_MS, 'QHP locations'),
        withTimeout(Promise.resolve(
          supabase.from('session_schedule')
            .select('id, scheduled_datetime, modality, status, client_id, clients:client_id(first_name, last_name, brb_location, location)')
            .eq('trainer_id', me!)
            .gte('scheduled_datetime', dayStart).lte('scheduled_datetime', dayEnd)
            .neq('status', 'cancelled')
            .order('scheduled_datetime', { ascending: true }),
        ) as Promise<{ data: any[] | null; error: any }>, NET_MS, 'Your sessions'),
      ]);
      const clientRows = clientsR.error ? [] : (clientsR.data ?? []);
      const qhpLoc: Record<string, string> = {};
      (qhpR.error ? [] : (qhpR.data ?? [])).forEach((r: any) => {
        const v = String(r.location ?? '').trim();
        if (v && !qhpLoc[r.client_id]) qhpLoc[r.client_id] = v;
      });
      const mine: EtaSession[] = (mineR.error ? [] : (mineR.data ?? [])).map((s: any) => ({
        id: s.id,
        start: s.scheduled_datetime,
        name: `${s.clients?.first_name ?? ''} ${s.clients?.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || 'Client',
        modality: s.modality ?? null,
        loc: geoFromBrb(s.clients?.brb_location),
        locText: (s.clients?.location && String(s.clients.location).trim()) || null,
      }));
      const out: Record<string, LotEta> = {};
      lots.forEach((lot) => {
        const c = clientRows.find((r: any) => r.id === lot.client_id);
        const loc = geoFromBrb(c?.brb_location);
        const locText = (c?.location && String(c.location).trim()) || qhpLoc[lot.client_id] || null;
        // Never count the lot's own slot: the trainer cannot already hold it (the list would say grabbed).
        out[`${lot.client_id}@${lot.slot_time}`] = computeLotEta(lot.scheduled_for, loc, locText, mine.filter((s) => s.start !== lot.scheduled_for));
      });
      return out;
    },
  });
}

/* ---------- the client cancelled a session of mine (26 Oct 2026) ---------- */
/** get_my_essentials_cancellations: my sessions the client cancelled in the Essentials app in the last hours (the dashboard alert). */
export function useMyEssentialsCancellations(hours = 48, enabled = true) {
  return useQuery({
    queryKey: ['essentials-cancellations', hours],
    enabled,
    staleTime: 60_000,
    refetchInterval: enabled ? 5 * 60_000 : false,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<EssentialsCancellation[]> => {
      const { data, error } = await withTimeout(
        Promise.resolve(supabase.rpc('get_my_essentials_cancellations', { p_hours: hours })) as Promise<RpcResult>,
        NET_MS, 'Essentials cancellations');
      if (error) {
        if (error.code === 'PGRST202' || /PGRST202|could not find the function/i.test(String(error.message ?? ''))) return [];
        throw new Error(describeGrabError(error));
      }
      return ((data ?? []) as any[]).map((r) => ({
        round_key: String(r.round_key ?? `${r.client_id}:${r.training_date}`),
        client_id: String(r.client_id),
        client_name: r.client_name ?? 'Client',
        training_date: String(r.training_date),
        slot_time: String(r.slot_time ?? '').slice(0, 5),
        modality: r.modality ?? '',
        cancelled_at: String(r.cancelled_at),
        session_id: r.session_id ?? null,
        was_winner: !!r.was_winner,
      }));
    },
  });
}
