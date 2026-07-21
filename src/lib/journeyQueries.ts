import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';

/* ============ CRM Client Journey — mirrors the web useClientJourney:
   17 boolean steps on clients.client_onboard_journey, grouped in 5 categories;
   toggling a step merges into the JSON and updates the row. ============ */

export const JOURNEY_CATEGORIES: { id: string; title: string; steps: { key: string; label: string }[] }[] = [
  {
    id: 'contact_qhp', title: 'Contact Details & QHP Report',
    steps: [
      { key: 'contact_details_collected', label: 'Collect complete client contact details' },
      { key: 'qhp_report_reviewed', label: 'Review QHP (Quantified Health & Performance) report' },
    ],
  },
  {
    id: 'welcome_call', title: 'Welcome Call',
    steps: [
      { key: 'welcome_call_made', label: 'A welcome call should be made on the first day' },
      { key: 'onboarding_timeline_informed', label: 'Inform clients that onboarding takes 3–4 days after enrollment' },
      { key: 'qhp_discussed', label: 'Discuss the QHP report and fitness recommendations' },
      { key: 'policies_shared', label: 'Share Odds Policies with the client' },
      { key: 'email_collected', label: 'Collect email address for onboarding to the app' },
      { key: 'training_preferences_asked', label: 'Ask for preferred training days and time slots' },
      { key: 'app_onboarded', label: 'Make sure the client is onboarded in the app' },
      { key: 'blood_markers_collected', label: 'Collect or check Blood Markers' },
    ],
  },
  {
    id: 'trainer_services', title: 'Align Trainer & Services',
    steps: [
      { key: 'trainer_assigned', label: 'Assign a trainer based on package and preferences' },
      { key: 'trainer_reviewed_qhp', label: "Ensure the trainer reviews the client's QHP report" },
      { key: 'trainer_prepared_programming', label: 'Confirm trainer prepares customized programming before first session' },
    ],
  },
  {
    id: 'schedule', title: 'Share Schedule with Client',
    steps: [
      { key: 'schedule_shared', label: 'Finalize and share the complete training schedule' },
      { key: 'schedule_explained', label: 'Explain training days, timings, and expectations' },
    ],
  },
  {
    id: 'feedback', title: 'Collect Feedback',
    steps: [
      { key: 'feedback_collected', label: 'Collect client feedback within one week of starting' },
      { key: 'feedback_quality_ensured', label: 'Ensure feedback covers trainer experience, schedule and service quality' },
    ],
  },
];

export const ALL_STEP_KEYS = JOURNEY_CATEGORIES.flatMap((c) => c.steps.map((s) => s.key));

export type Journey = Record<string, boolean> | null;
export const journeyProgress = (j: Journey): number => {
  if (!j) return 0;
  const done = ALL_STEP_KEYS.filter((k) => j[k] === true).length;
  return Math.round((done / ALL_STEP_KEYS.length) * 100);
};
export const journeyDone = (j: Journey): number => (j ? ALL_STEP_KEYS.filter((k) => j[k] === true).length : 0);
export const journeyComplete = (j: Journey): boolean => !!j && ALL_STEP_KEYS.every((k) => j[k] === true);

export type JourneyClient = {
  id: string; name: string; email: string | null; phone: string | null;
  subscription: string | null; createdAt: string; journey: Journey;
};

const fullName = (p: any) => `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || 'Client';

export function useJourneyClients(crmId: string | null) {
  return useQuery({
    queryKey: ['crm-journey-clients', crmId],
    enabled: !!crmId,
    staleTime: 30_000,
    queryFn: async (): Promise<JourneyClient[]> => {
      const { data: assignments, error: aErr } = await supabase
        .from('trainer_clients').select('client_id').eq('trainer_id', crmId).eq('actively_training', true);
      if (aErr) throw new Error(aErr.message);
      const ids = [...new Set((assignments ?? []).map((r: any) => r.client_id))];
      if (!ids.length) return [];
      const { data, error } = await supabase
        .from('clients')
        .select('id, first_name, last_name, email, phone, subscription_type, status, client_onboard_journey, created_at')
        .in('id', ids).eq('status', 'active').order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map((c) => ({
        id: c.id, name: fullName(c), email: c.email ?? null, phone: c.phone ?? null,
        subscription: c.subscription_type ?? null, createdAt: c.created_at,
        journey: (c.client_onboard_journey as Journey) ?? null,
      }));
    },
  });
}

export function useToggleJourneyStep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { crmId: string; clientId: string; stepKey: string; value: boolean }) => {
      // Read-merge-write, like the web (never drop other steps).
      const { data: cur, error: rErr } = await supabase
        .from('clients').select('client_onboard_journey').eq('id', input.clientId).single();
      if (rErr) throw new Error(rErr.message);
      const updated = { ...((cur?.client_onboard_journey as Record<string, boolean>) ?? {}), [input.stepKey]: input.value };
      const { error } = await supabase.from('clients').update({ client_onboard_journey: updated }).eq('id', input.clientId);
      if (error) throw new Error(error.message);
      return updated;
    },
    // Optimistic flip in the cached list.
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: ['crm-journey-clients', input.crmId] });
      const prev = qc.getQueryData<JourneyClient[]>(['crm-journey-clients', input.crmId]);
      if (prev) {
        qc.setQueryData(['crm-journey-clients', input.crmId], prev.map((c) =>
          c.id === input.clientId ? { ...c, journey: { ...(c.journey ?? {}), [input.stepKey]: input.value } } : c));
      }
      return { prev };
    },
    onError: (_e, input, ctx) => { if (ctx?.prev) qc.setQueryData(['crm-journey-clients', input.crmId], ctx.prev); },
    onSettled: (_r, _e, input) => {
      qc.invalidateQueries({ queryKey: ['crm-journey-clients', input.crmId] });
      qc.invalidateQueries({ queryKey: ['crm-client-detail', input.clientId] });
    },
  });
}
