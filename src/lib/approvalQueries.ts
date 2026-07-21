import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';

/* ============ CRM Pending Approvals — mirrors the web PendingSessionApprovals ============
   Rescheduling: session_schedule reschedule_* columns (pending = reschedule_request
   set + reschedule_status null; approve moves the SAME row to the new slot).
   Roster requests: all_requests (request_type 'roster_request'); approving a single-day
   request creates the session_schedule row, then marks the request approved. */

const fullName = (p: any) => `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || null;

const myClientIds = async (crmId: string) => {
  const { data, error } = await supabase
    .from('trainer_clients')
    .select('client_id')
    .eq('trainer_id', crmId)
    .eq('actively_training', true);
  if (error) throw new Error(error.message);
  return [...new Set((data ?? []).map((r: any) => r.client_id))];
};

const nameMaps = async (clientIds: string[], profileIds: string[]) => {
  const [cR, pR] = await Promise.all([
    clientIds.length ? supabase.from('clients').select('id, first_name, last_name').in('id', clientIds) : Promise.resolve({ data: [] as any[] }),
    profileIds.length ? supabase.from('profiles').select('id, first_name, last_name').in('id', profileIds) : Promise.resolve({ data: [] as any[] }),
  ]);
  return {
    client: new Map((cR.data ?? []).map((c: any) => [c.id, fullName(c)])),
    profile: new Map((pR.data ?? []).map((p: any) => [p.id, fullName(p)])),
  };
};

/* ---------- Rescheduling ---------- */
export type RescheduleReq = {
  id: string; clientId: string; clientName: string; trainerId: string | null; trainerName: string;
  currentAt: string; proposedDate: string | null; proposedTime: string | null;
  reason: string; requestedAt: string | null; modality: string | null;
  status: 'pending' | 'approved' | 'rejected'; processedAt: string | null; notes: string | null;
};
export function useRescheduleRequests(crmId: string | null) {
  return useQuery({
    queryKey: ['crm-reschedule-requests', crmId],
    enabled: !!crmId,
    staleTime: 15_000,
    refetchInterval: 30_000, // backstop; realtime invalidates instantly
    queryFn: async (): Promise<{ pending: RescheduleReq[]; processed: RescheduleReq[] }> => {
      const ids = await myClientIds(crmId!);
      if (!ids.length) return { pending: [], processed: [] };
      const SEL = 'id, client_id, trainer_id, scheduled_datetime, modality, reschedule_request, reschedule_requested_at, reschedule_status, reschedule_processed_at, reschedule_proposed_date, reschedule_proposed_time, notes';
      const [pendR, procR] = await Promise.all([
        supabase.from('session_schedule').select(SEL).in('client_id', ids).not('reschedule_request', 'is', null).order('reschedule_requested_at', { ascending: false }),
        supabase.from('session_schedule').select(SEL).in('client_id', ids).in('reschedule_status', ['approved', 'rejected']).order('reschedule_processed_at', { ascending: false }).limit(10),
      ]);
      if (pendR.error) throw new Error(pendR.error.message);
      const rows = [...(pendR.data ?? []), ...(procR.data ?? [])] as any[];
      const maps = await nameMaps([...new Set(rows.map((r) => r.client_id))], [...new Set(rows.map((r) => r.trainer_id).filter(Boolean))]);
      const toReq = (r: any): RescheduleReq => ({
        id: r.id, clientId: r.client_id, clientName: maps.client.get(r.client_id) ?? 'Client',
        trainerId: r.trainer_id ?? null, trainerName: (r.trainer_id && maps.profile.get(r.trainer_id)) || 'Trainer',
        currentAt: r.scheduled_datetime,
        proposedDate: r.reschedule_proposed_date ?? null, proposedTime: r.reschedule_proposed_time ?? null,
        reason: r.reschedule_request ?? '', requestedAt: r.reschedule_requested_at ?? null, modality: r.modality ?? null,
        status: r.reschedule_status === 'approved' ? 'approved' : r.reschedule_status === 'rejected' ? 'rejected' : 'pending',
        processedAt: r.reschedule_processed_at ?? null, notes: r.notes ?? null,
      });
      // Web split: pending = status null; processed = approved/rejected (deduped by id).
      const seen = new Set<string>();
      const pending: RescheduleReq[] = [];
      const processed: RescheduleReq[] = [];
      for (const r of rows) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        const req = toReq(r);
        (req.status === 'pending' ? pending : processed).push(req);
      }
      return { pending, processed };
    },
  });
}

export function useApproveReschedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { req: RescheduleReq; crmId: string }) => {
      const { req, crmId } = input;
      if (!req.proposedDate || !req.proposedTime) throw new Error('The trainer did not propose a new slot.');
      const newDatetime = new Date(`${req.proposedDate}T${req.proposedTime.length === 5 ? req.proposedTime + ':00' : req.proposedTime}+05:30`).toISOString();
      // Conflict check (mirrors web): same trainer already booked at that slot.
      if (req.trainerId) {
        const { data: clash } = await supabase
          .from('session_schedule')
          .select('id')
          .eq('trainer_id', req.trainerId)
          .eq('scheduled_datetime', newDatetime)
          .in('status', ['scheduled', 'confirmed'])
          .neq('id', req.id)
          .limit(1);
        if ((clash?.length ?? 0) > 0) throw new Error('The trainer already has a session at that slot. Ask for a different time.');
      }
      const { error } = await supabase.from('session_schedule').update({
        scheduled_datetime: newDatetime,
        reschedule_request: null,
        reschedule_requested_at: null,
        reschedule_status: 'approved', // DB trigger nulls this after the move + audit-logs it
        reschedule_approved_by: crmId,
        reschedule_processed_at: new Date().toISOString(),
      }).eq('id', req.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['crm-reschedule-requests'] }),
  });
}

export function useRejectReschedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; crmId: string; reason: string }) => {
      if (!input.reason.trim()) throw new Error('A rejection reason is required');
      const { error } = await supabase.from('session_schedule').update({
        reschedule_request: null,
        reschedule_requested_at: null,
        reschedule_status: 'rejected',
        reschedule_approved_by: input.crmId,
        reschedule_processed_at: new Date().toISOString(),
        notes: input.reason.trim(),
      }).eq('id', input.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['crm-reschedule-requests'] }),
  });
}

/* ---------- Roster requests (all_requests) ---------- */
export type RosterReq = {
  id: string; type: string; rosterType: 'single' | 'full' | null;
  clientId: string | null; clientName: string; trainerId: string; trainerName: string;
  requestedAt: string; slotAt: string | null; remark: string | null;
  status: string; reviewNote: string | null; reviewedAt: string | null;
};
export function useRosterRequests(crmId: string | null) {
  return useQuery({
    queryKey: ['crm-roster-requests', crmId],
    enabled: !!crmId,
    staleTime: 15_000,
    refetchInterval: 30_000,
    queryFn: async (): Promise<RosterReq[]> => {
      const ids = await myClientIds(crmId!);
      if (!ids.length) return [];
      // No FK from all_requests.requested_by → profiles in the live DB: fetch plain,
      // enrich names separately (the web app's fallback path does the same).
      const { data, error } = await supabase
        .from('all_requests')
        .select('id, request_type, requested_by, client_id, requested_datetime, remark, status, review_note, reviewed_at, created_at, roster_type')
        .in('client_id', ids)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as any[];
      const maps = await nameMaps([...new Set(rows.map((r) => r.client_id).filter(Boolean))], [...new Set(rows.map((r) => r.requested_by).filter(Boolean))]);
      return rows.map((r) => ({
        id: r.id, type: String(r.request_type || 'request').replace(/_/g, ' '),
        rosterType: r.roster_type === 'single' || r.roster_type === 'full' ? r.roster_type : null,
        clientId: r.client_id ?? null, clientName: (r.client_id && maps.client.get(r.client_id)) || 'Client',
        trainerId: r.requested_by, trainerName: maps.profile.get(r.requested_by) ?? 'Trainer',
        requestedAt: r.created_at, slotAt: r.requested_datetime ?? null, remark: r.remark ?? null,
        status: r.status ?? 'pending', reviewNote: r.review_note ?? null, reviewedAt: r.reviewed_at ?? null,
      }));
    },
  });
}

export function useReviewRosterRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { req: RosterReq; crmId: string; action: 'approve' | 'reject'; note?: string }) => {
      const { req, crmId, action, note } = input;
      if (action === 'approve' && req.rosterType === 'single') {
        // Single-day roster: create the actual session first (mirrors the web's
        // CreateSessionDialog essence), then mark the request approved.
        if (!req.slotAt || !req.clientId) throw new Error('This request has no client/slot to schedule.');
        const { error: insErr } = await supabase.from('session_schedule').insert({
          client_id: req.clientId,
          trainer_id: req.trainerId,
          scheduled_datetime: req.slotAt,
          status: 'scheduled',
          notes: req.remark ?? null,
        });
        if (insErr) throw new Error(insErr.message);
      }
      const { error } = await supabase.from('all_requests').update({
        status: action === 'approve' ? 'approved' : 'rejected',
        reviewed_by: crmId,
        reviewed_at: new Date().toISOString(),
        review_note: note?.trim() || null,
      }).eq('id', req.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['crm-roster-requests'] });
      qc.invalidateQueries({ queryKey: ['crm-upcoming-sessions'] });
    },
  });
}
