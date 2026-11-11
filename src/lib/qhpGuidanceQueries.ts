/* What a client's trainers should read from the latest QHP (11 Nov 2026): the assessor's "Recommendations for
   trainers" and the open recovery and rehab entries. Rules: recoveryRehab.ts (a byte for byte copy of the web
   file). Same contract as the web hook useClientQhpGuidance:
   - Read: the client's newest QHP that has data, straight from coach_assessment.
   - "I have read this": one row in the existing event_acknowledgement table (title 'QHP Notes', reference_id =
     the QHP's id). A trainer is asked once per QHP; a new QHP asks again. No new table or column.
   A failed lookup is never a verdict: the popup simply does not show. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { withTimeout, NET_MS } from './withTimeout';
import { useAuth } from '../auth';
import { qhpGuidanceOf, type QhpGuidance } from './recoveryRehab';

export const QHP_GUIDANCE_ACK_TITLE = 'QHP Notes';
export const QHP_GUIDANCE_KEY = 'client-qhp-guidance';

export type ClientQhpGuidance = QhpGuidance & {
  assessmentId: string;
  /** The QHP's day, 'yyyy-MM-dd'. */
  day: string | null;
  assessorName: string | null;
  /** When this user tapped "I have read this" for this QHP; null when not yet. */
  acknowledgedAt: string | null;
};

const istDay = (iso: string): string | null => {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
};
/** The QHP's day: the IST day of `completed` when set, else `assessment_date` (web qhpDayOf). */
export function qhpDayOfRow(row: { completed?: string | null; assessment_date?: string | null }): string | null {
  if (row.completed) {
    const d = istDay(row.completed);
    if (d) return d;
  }
  const d = String(row.assessment_date ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** '2026-11-09' reads as "9 Nov 2026". */
export const qhpDayLabel = (ymd: string | null): string => {
  if (!ymd) return '';
  const [y, m, d] = ymd.split('-').map(Number);
  return `${d} ${MONTHS[m - 1] ?? ''} ${y}`.trim();
};

async function fetchClientQhpGuidance(clientId: string, uid: string): Promise<ClientQhpGuidance | null> {
  const { data: rows, error } = await withTimeout(
    Promise.resolve(
      supabase
        .from('coach_assessment')
        .select('id, assessment_date, completed, coach_id, new_client_assessment_data, existing_client_assessment_data, qhp_data')
        .eq('client_id', clientId)
        .or('new_client_assessment_data.not.is.null,existing_client_assessment_data.not.is.null,qhp_data.not.is.null')
        .order('assessment_date', { ascending: false, nullsFirst: false })
        .limit(1),
    ) as Promise<{ data: any[] | null; error: any }>,
    NET_MS,
    'QHP notes',
  );
  if (error) throw new Error(error.message);
  const row = (rows ?? [])[0];
  if (!row) return null;
  const guidance = qhpGuidanceOf(row);
  if (!guidance.hasContent) return null;

  const [ack, assessor] = await withTimeout(
    Promise.all([
      supabase
        .from('event_acknowledgement')
        .select('acknowledged_at')
        .eq('user_id', uid)
        .eq('title', QHP_GUIDANCE_ACK_TITLE)
        .eq('reference_id', row.id)
        .order('acknowledged_at', { ascending: false })
        .limit(1),
      row.coach_id ? supabase.from('profiles').select('first_name, last_name').eq('id', row.coach_id).maybeSingle() : Promise.resolve({ data: null, error: null } as any),
    ]),
    NET_MS,
    'QHP notes',
  );
  if (ack.error) throw new Error(ack.error.message);
  const a = (assessor as any)?.data;
  return {
    ...guidance,
    assessmentId: String(row.id),
    day: qhpDayOfRow(row),
    assessorName: a ? [a.first_name, a.last_name].filter(Boolean).join(' ').trim() || null : null,
    acknowledgedAt: ((ack.data ?? [])[0] as any)?.acknowledged_at ?? null,
  };
}

/** Null data = nothing to read on the latest QHP (or no QHP). */
export function useClientQhpGuidance(clientId: string | null, enabled = true) {
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;
  return useQuery({
    queryKey: [QHP_GUIDANCE_KEY, clientId, uid],
    enabled: enabled && !!clientId && !!uid,
    staleTime: 2 * 60 * 1000,
    queryFn: () => fetchClientQhpGuidance(clientId!, uid!),
  });
}

export function useAckQhpGuidance(clientId: string | null) {
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (assessmentId: string) => {
      if (!uid) throw new Error('Sign in again to continue.');
      const { error } = await withTimeout(
        Promise.resolve(supabase.from('event_acknowledgement').insert({ user_id: uid, title: QHP_GUIDANCE_ACK_TITLE, reference_id: assessmentId })) as Promise<{ error: any }>,
        NET_MS,
        'Saving',
      );
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: [QHP_GUIDANCE_KEY, clientId, uid] }); },
  });
}
