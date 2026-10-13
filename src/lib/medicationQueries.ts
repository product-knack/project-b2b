/* Client medications for the therapist's client detail (5 Oct 2026): QHP
   assessments read directly (coach_assessment is readable by staff) + the doctor
   consultations through the definer RPC get_client_consult_medications (hub-track
   migration 20261005100000; active trainer_clients row or admin). Until that SQL
   is run the RPC is missing (PGRST202): the QHP half still shows and the tab says
   the consultation half is not enabled yet. */
import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';
import { withTimeout, NET_MS } from './withTimeout';
import { ConsultMedRow, MedicationCard, QhpRow, consultMedicationCards, qhpMedicationCards, sortMedicationCards } from './medications';

export type ClientMedications = {
  cards: MedicationCard[];
  qhpCount: number;
  consultCount: number;
  /** false while the consultation RPC is missing on the server */
  consultEnabled: boolean;
};

export function useClientMedications(clientId: string | null) {
  return useQuery({
    queryKey: ['client-medications', clientId],
    enabled: !!clientId,
    staleTime: 120_000,
    queryFn: async (): Promise<ClientMedications> => {
      const [qhpR, consultR] = await Promise.all([
        withTimeout(Promise.resolve(
          supabase.from('coach_assessment')
            .select('id, assessment_date, created_at, qhp_data, new_client_assessment_data, existing_client_assessment_data')
            .eq('client_id', clientId!)
            .order('assessment_date', { ascending: false })
            .limit(24),
        ) as Promise<{ data: QhpRow[] | null; error: any }>, NET_MS, 'QHP medications'),
        withTimeout(Promise.resolve(supabase.rpc('get_client_consult_medications', { p_client_id: clientId })) as Promise<{ data: ConsultMedRow[] | null; error: any }>, NET_MS, 'Consultation medications'),
      ]);
      if (qhpR.error) throw new Error(qhpR.error.message);
      let consultEnabled = true;
      let consultRows: ConsultMedRow[] = [];
      if (consultR.error) {
        if ((consultR.error as any).code === 'PGRST202') consultEnabled = false;
        else throw new Error(consultR.error.message);
      } else consultRows = consultR.data ?? [];
      const qhp = qhpMedicationCards(qhpR.data ?? []);
      const consult = consultMedicationCards(consultRows);
      return { cards: sortMedicationCards([...qhp, ...consult]), qhpCount: qhp.length, consultCount: consult.length, consultEnabled };
    },
  });
}
