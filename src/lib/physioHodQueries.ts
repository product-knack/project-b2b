import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';

/* ============================================================================
   Push to Physio HOD + Rehab Recommendation — shared state on qhp_details:
     physio_hod_push  jsonb[]  append-only push events (latest wins)
     physio_hod_notes jsonb[]  threaded notes, both sides
   All writes go through SECURITY DEFINER RPCs (live-verified):
     qhp_push_to_physio_hod(_id,_note)  — anyone on the review page (UI gates HOD)
     qhp_physio_mark_seen(_id,_note)    — server-guarded to physio_hod tag
     qhp_add_physio_thread_note(_id,_message) — author_side derived server-side
   Realtime is on for qhp_details, so both dashboards refresh automatically.
   ========================================================================== */

export type PhysioHodPushEntry = {
  id: string; pushed_by: string; pushed_by_name: string; pushed_at: string;
  status: 'pending' | 'seen';
  seen_at?: string; seen_by?: string; seen_by_name?: string;
};
export type PhysioHodNote = {
  id: string; author_id: string; author_name: string;
  author_side: 'academy_hod' | 'physio_hod';
  message: string; at: string;
};

export const latestPush = (push: any): PhysioHodPushEntry | null =>
  Array.isArray(push) && push.length ? (push[push.length - 1] as PhysioHodPushEntry) : null;
export const pushStatus = (push: any): 'none' | 'pending' | 'seen' => {
  const last = latestPush(push);
  return !last ? 'none' : last.status === 'seen' ? 'seen' : 'pending';
};

export const PHYSIO_NOTE_MAX = 1000;

const REVIEW_QK = ['qhp-report-review-queue'];
const REHAB_QK = ['rehab-recommendation-queue'];
const invalidateBoth = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: REVIEW_QK });
  qc.invalidateQueries({ queryKey: REHAB_QK });
};

/* ---------- Mutations ---------- */
export function usePushToPhysioHod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; note?: string | null }) => {
      const { error } = await supabase.rpc('qhp_push_to_physio_hod', { _id: input.id, _note: input.note?.trim() || null });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => invalidateBoth(qc),
  });
}
export function usePhysioMarkSeen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; note?: string | null }) => {
      const { error } = await supabase.rpc('qhp_physio_mark_seen', { _id: input.id, _note: input.note?.trim() || null });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => invalidateBoth(qc),
  });
}
export function useAddPhysioThreadNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; message: string }) => {
      const msg = input.message.trim();
      if (!msg) throw new Error('Message required');
      if (msg.length > PHYSIO_NOTE_MAX) throw new Error(`Notes are limited to ${PHYSIO_NOTE_MAX} characters`);
      const { error } = await supabase.rpc('qhp_add_physio_thread_note', { _id: input.id, _message: msg });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => invalidateBoth(qc),
  });
}

/* ---------- Realtime: any qhp_details change refreshes both dashboards ---------- */
export function useQhpDetailsRealtime() {
  const qc = useQueryClient();
  React.useEffect(() => {
    const channel = supabase
      .channel('qhp-details-physio-hod')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'qhp_details' }, () => invalidateBoth(qc))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc]);
}

/* ---------- Physio HOD queue: every report ever pushed ---------- */
const nm = (p: any) => `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || 'Unknown';

export type RehabQueueRow = {
  id: string; clientId: string | null; clientName: string; creatorName: string;
  createdAt: string; pdfPath: string | null; pdfFilename: string | null;
  push: PhysioHodPushEntry[]; notes: PhysioHodNote[];
  status: 'pending' | 'seen';
  pushedByName: string; pushedAt: string | null;
};

export function useRehabRecommendationQueue(enabled = true) {
  return useQuery({
    queryKey: REHAB_QK,
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000, // realtime is primary; this is the safety net
    queryFn: async (): Promise<RehabQueueRow[]> => {
      const { data, error } = await supabase
        .from('qhp_details')
        .select(`
          id, client_id, coach_assessment_id, created_at, pdf_storage_path, pdf_filename,
          physio_hod_push, physio_hod_notes,
          clients:client_id ( first_name, last_name ),
          creator:report_created_by ( first_name, last_name )
        `)
        .not('physio_hod_push', 'eq', '[]')
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map((r) => {
        const push = Array.isArray(r.physio_hod_push) ? (r.physio_hod_push as PhysioHodPushEntry[]) : [];
        const last = latestPush(push);
        return {
          id: r.id, clientId: r.client_id ?? null, clientName: nm(r.clients), creatorName: nm(r.creator),
          createdAt: r.created_at, pdfPath: r.pdf_storage_path ?? null, pdfFilename: r.pdf_filename ?? null,
          push, notes: Array.isArray(r.physio_hod_notes) ? (r.physio_hod_notes as PhysioHodNote[]) : [],
          status: last?.status === 'seen' ? 'seen' : 'pending',
          pushedByName: last?.pushed_by_name ?? 'Unknown',
          pushedAt: last?.pushed_at ?? null,
        };
      });
    },
  });
}
