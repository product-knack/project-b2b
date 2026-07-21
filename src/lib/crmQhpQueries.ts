import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { C } from '../theme';

/* ============ CRM QHP tracker — mirrors the web useClientQHP:
   latest coach_assessment per client in the CRM's book, refresh due 38 days
   after completion, plus the qhp_details review journey (senior → HOD signs,
   on-hold, explained-to-client) and the mark_qhp_explained RPC. ============ */

export type QhpStage = 'not_generated' | 'pending_senior' | 'pending_hod' | 'on_hold' | 'fully_signed';
export const STAGE_META: Record<QhpStage, { label: string; color: string }> = {
  not_generated: { label: 'No Report', color: C.muted2 },
  pending_senior: { label: 'Pending Senior', color: C.gold },
  pending_hod: { label: 'Pending HOD', color: C.blue },
  on_hold: { label: 'On Hold', color: C.red },
  fully_signed: { label: 'Fully Signed', color: C.green },
};

export type CrmQhpRow = {
  assessmentId: string; clientId: string; clientName: string;
  assessmentDate: string | null; assignedAt: string | null; completedAt: string | null;
  reportCreatedAt: string | null;
  nextDue: string; daysToDue: number; onTime: boolean;
  mechanicalScore: number | null; assessorName: string | null;
  stage: QhpStage;
  seniorName: string | null; seniorSignedAt: string | null;
  hodName: string | null; hodSignedAt: string | null;
  heldByName: string | null;
  explainedAt: string | null; explainedByName: string | null;
};

const fullName = (p: any) => (p ? `${p.first_name ?? ''} ${p.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || null : null);

export function useCrmQhp(crmId: string | null) {
  return useQuery({
    queryKey: ['crm-qhp-tracker', crmId],
    enabled: !!crmId,
    staleTime: 60_000,
    queryFn: async (): Promise<CrmQhpRow[]> => {
      const { data: book, error: bErr } = await supabase
        .from('trainer_clients').select('client_id').eq('trainer_id', crmId).eq('actively_training', true);
      if (bErr) throw new Error(bErr.message);
      const ids = [...new Set((book ?? []).map((r: any) => r.client_id))];
      if (!ids.length) return [];

      const { data: assessments, error } = await supabase
        .from('coach_assessment')
        .select('id, client_id, client_name, assessment_date, mechanical_score, completed, created_at, assessor:profiles!coach_assessment_coach_id_fkey(first_name, last_name), clients:client_id(first_name, last_name)')
        .in('client_id', ids)
        .not('client_id', 'is', null)
        .order('assessment_date', { ascending: false });
      if (error) throw new Error(error.message);

      // Latest assessment per client (rows come newest-first).
      const latest = new Map<string, any>();
      ((assessments ?? []) as any[]).forEach((a) => { if (!latest.has(a.client_id)) latest.set(a.client_id, a); });
      const list = [...latest.values()];
      if (!list.length) return [];

      // Latest qhp_details per assessment (review journey).
      const { data: details } = await supabase
        .from('qhp_details')
        .select('id, coach_assessment_id, created_at, review_status, signed_by_senior_researcher, senior_signed_at, signed_by_hod, hod_signed_at, held_by, qhp_explained_to_client_at, qhp_explained_by, senior:signed_by_senior_researcher(first_name, last_name), hod:signed_by_hod(first_name, last_name)')
        .in('coach_assessment_id', list.map((a) => a.id))
        .order('created_at', { ascending: false });

      // held_by / explained_by have no FK — separate profile lookup.
      const lookupIds = [...new Set(((details ?? []) as any[]).flatMap((d) => [d.held_by, d.qhp_explained_by]).filter(Boolean))] as string[];
      const names = new Map<string, string | null>();
      if (lookupIds.length) {
        const { data: profs } = await supabase.from('profiles').select('id, first_name, last_name').in('id', lookupIds);
        (profs ?? []).forEach((p: any) => names.set(p.id, fullName(p)));
      }
      const reviewBy = new Map<string, any>();
      ((details ?? []) as any[]).forEach((d) => { if (!reviewBy.has(d.coach_assessment_id)) reviewBy.set(d.coach_assessment_id, d); });

      const today = new Date(); today.setHours(0, 0, 0, 0);
      return list.map((a) => {
        // Web rule: refresh due 38 days after completion (or assessment date).
        const base = a.completed ? new Date(a.completed) : new Date(a.assessment_date);
        const due = new Date(base.getTime() + 38 * 864e5);
        const daysToDue = Math.round((due.getTime() - today.getTime()) / 864e5);
        const d = reviewBy.get(a.id);
        let stage: QhpStage = 'not_generated';
        if (d) {
          if (d.review_status === 'on_hold') stage = 'on_hold';
          else if (d.signed_by_hod) stage = 'fully_signed';
          else if (d.signed_by_senior_researcher) stage = 'pending_hod';
          else stage = 'pending_senior';
        }
        return {
          assessmentId: a.id,
          clientId: a.client_id,
          clientName: fullName(a.clients) ?? a.client_name ?? 'Client',
          assessmentDate: a.assessment_date ?? null,
          assignedAt: a.created_at ?? null,
          completedAt: a.completed ?? null,
          reportCreatedAt: d?.created_at ?? null,
          nextDue: due.toISOString(),
          daysToDue,
          onTime: daysToDue > 0,
          mechanicalScore: a.mechanical_score ?? null,
          assessorName: fullName(a.assessor),
          stage,
          seniorName: d ? fullName(d.senior) : null,
          seniorSignedAt: d?.senior_signed_at ?? null,
          hodName: d ? fullName(d.hod) : null,
          hodSignedAt: d?.hod_signed_at ?? null,
          heldByName: d?.held_by ? names.get(d.held_by) ?? null : null,
          explainedAt: d?.qhp_explained_to_client_at ?? null,
          explainedByName: d?.qhp_explained_by ? names.get(d.qhp_explained_by) ?? null : null,
        };
      }).sort((x, y) => x.daysToDue - y.daysToDue); // most overdue first
    },
  });
}

/* ---------- Schedule New QHP (web ScheduleQHPDialog → qhp_schedule insert) ---------- */
export function useScheduleQhp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { clientId: string; scheduledBy: string; date: string; time: string; address: string; notes: string }) => {
      const { error } = await supabase.from('qhp_schedule').insert({
        client_id: input.clientId,
        scheduled_by: input.scheduledBy,
        date: input.date,
        time: input.time,
        address: input.address.trim() || null,
        notes: input.notes.trim() || null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['crm-qhp-tracker'] }),
  });
}

export function useMarkQhpExplained() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (assessmentId: string) => {
      const { error } = await supabase.rpc('mark_qhp_explained', { _assessment_id: assessmentId });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['crm-qhp-tracker'] }),
  });
}
