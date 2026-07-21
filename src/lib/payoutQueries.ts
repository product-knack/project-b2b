import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';
import { C } from '../theme';

/* ============ Trainer Payouts — mirrors the web useTrainerPayoutHistory ============
   Table: trainer_payout_records (amounts are PRECOMPUTED — never recalculated here).
   Record amount = cycle_payout_amount + qhp_fee. Batches = rows grouped by
   payout_batch_id; extras/deductions are batch-level (first record carrying them).
   net = gross + extras − deductions. */

export type PayoutAdj = { name: string; amount: number };
export type PayoutRecord = {
  id: string;
  payout_batch_id: string;
  payout_type: string;
  client_id: string | null;
  assessment_id: string | null;
  clientName: string | null;
  amount: number;               // cycle_payout_amount + qhp_fee
  fee_per_session: number;
  completed_sessions: number;
  sessions_in_cycle: number;
  cycle_number: number;
  packageNumber: number;
  cycleNumber: number;
  payout_period_start: string | null;
  payout_period_end: string | null;
  paid_at: string | null;
  remarks: string | null;
  incentive_remark: string | null;
  paid_session_ids: string[];
  paid_cancelled_session_ids: string[];
  reimbursement: { title: string; amount: number } | null;
};
export type PayoutBatch = {
  batchId: string;
  paidAt: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  records: PayoutRecord[];
  types: string[];
  gross: number;
  extras: PayoutAdj[];
  deductions: PayoutAdj[];
  totalExtras: number;
  totalDeductions: number;
  net: number;
  sessionCount: number;
};

/* cycle_number encodes package + cycle: 401 → package 4, cycle 1 (mirrors web decodeCycleNumber). */
export const decodeCycleNumber = (n: number) => ({ packageNumber: Math.floor((n || 0) / 100), cycleNumber: (n || 0) % 100 });

export const payoutTypeMeta = (type: string): { label: string; color: string } => {
  if (type?.startsWith('incentive')) {
    const map: Record<string, string> = {
      incentive_reel_collaboration: 'Reel Collab',
      incentive_reel_no_collab: 'Reel',
      incentive_stories_tagging: 'Story Tag',
      incentive_upselling: 'Upselling',
      incentive_direct_referral: 'Referral',
    };
    return { label: map[type] ?? 'Incentive', color: C.gold };
  }
  const map: Record<string, { label: string; color: string }> = {
    training: { label: 'Training', color: C.green },
    advance: { label: 'Advance', color: C.gold },
    qhp: { label: 'QHP', color: C.blue },
    qhp_supporting: { label: 'QHP Support', color: C.blue },
    reimbursement: { label: 'Reimbursement', color: C.purple },
  };
  return map[type] ?? { label: type ? type.replace(/_/g, ' ') : 'Payout', color: C.muted2 };
};

const recordAmount = (r: any) => Number(r.cycle_payout_amount || 0) + Number(r.qhp_fee || 0);

export function usePayoutHistory(trainerId: string | null) {
  return useQuery({
    queryKey: ['trainer-payout-history', trainerId],
    enabled: !!trainerId,
    staleTime: 300_000,
    queryFn: async (): Promise<PayoutBatch[]> => {
      const { data, error } = await supabase
        .from('trainer_payout_records')
        .select('*')
        .eq('trainer_id', trainerId)
        .order('paid_at', { ascending: false });
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as any[];
      if (!rows.length) return [];

      // Names: clients for training-type rows; coach_assessment client_name for QHP rows.
      const clientIds = [...new Set(rows.filter((r) => r.client_id && !String(r.payout_type || '').startsWith('qhp')).map((r) => r.client_id))];
      const assessIds = [...new Set(rows.filter((r) => r.assessment_id).map((r) => r.assessment_id))];
      const nameByClient = new Map<string, string>();
      const nameByAssess = new Map<string, string>();
      if (clientIds.length) {
        const { data: cs } = await supabase.from('clients').select('id, first_name, last_name').in('id', clientIds);
        (cs ?? []).forEach((c: any) => nameByClient.set(c.id, `${c.first_name ?? ''} ${c.last_name ?? ''}`.replace(/\s+/g, ' ').trim()));
      }
      if (assessIds.length) {
        const { data: as } = await supabase.from('coach_assessment').select('id, client_name').in('id', assessIds);
        (as ?? []).forEach((a: any) => nameByAssess.set(a.id, a.client_name ?? ''));
      }

      // Group into batches (rows are paid_at desc, so batch order follows).
      const batchMap = new Map<string, any[]>();
      const order: string[] = [];
      rows.forEach((r) => {
        const b = r.payout_batch_id;
        if (!batchMap.has(b)) { batchMap.set(b, []); order.push(b); }
        batchMap.get(b)!.push(r);
      });

      return order.map((batchId) => {
        const recs = batchMap.get(batchId)!;
        // Batch-level adjustments: first record carrying a non-empty array (mirrors web).
        const extras: PayoutAdj[] = (recs.find((r) => Array.isArray(r.extra_earnings) && r.extra_earnings.length)?.extra_earnings ?? []) as PayoutAdj[];
        const deductions: PayoutAdj[] = (recs.find((r) => Array.isArray(r.deductions) && r.deductions.length)?.deductions ?? []) as PayoutAdj[];
        const gross = recs.reduce((s, r) => s + recordAmount(r), 0);
        const totalExtras = extras.reduce((s, e) => s + Number(e.amount || 0), 0);
        const totalDeductions = deductions.reduce((s, d) => s + Number(d.amount || 0), 0);
        const records: PayoutRecord[] = recs.map((r) => {
          const { packageNumber, cycleNumber } = decodeCycleNumber(r.cycle_number);
          const isQhp = String(r.payout_type || '').startsWith('qhp');
          return {
            id: r.id,
            payout_batch_id: r.payout_batch_id,
            payout_type: r.payout_type ?? 'training',
            client_id: r.client_id ?? null,
            assessment_id: r.assessment_id ?? null,
            clientName: isQhp
              ? (r.assessment_id ? nameByAssess.get(r.assessment_id) || null : null)
              : (r.client_id ? nameByClient.get(r.client_id) || null : null),
            amount: recordAmount(r),
            fee_per_session: Number(r.fee_per_session || 0),
            completed_sessions: Number(r.completed_sessions || 0),
            sessions_in_cycle: Number(r.sessions_in_cycle || 0),
            cycle_number: r.cycle_number ?? 0,
            packageNumber,
            cycleNumber,
            payout_period_start: r.payout_period_start ?? null,
            payout_period_end: r.payout_period_end ?? null,
            paid_at: r.paid_at ?? null,
            remarks: r.remarks ?? null,
            incentive_remark: r.incentive_remark ?? null,
            paid_session_ids: r.paid_session_ids ?? [],
            paid_cancelled_session_ids: r.paid_cancelled_session_ids ?? [],
            reimbursement: r.reimbursement ?? null,
          };
        });
        return {
          batchId,
          paidAt: recs[0].paid_at ?? null,
          periodStart: recs[0].payout_period_start ?? null,
          periodEnd: recs[0].payout_period_end ?? null,
          records,
          types: [...new Set(records.map((r) => r.payout_type))],
          gross,
          extras,
          deductions,
          totalExtras,
          totalDeductions,
          net: gross + totalExtras - totalDeductions,
          sessionCount: records.reduce((s, r) => s + r.completed_sessions, 0),
        };
      });
    },
  });
}

/* Lazy per-record session breakdown — fetched when a record row is expanded. */
export type PayoutSession = { id: string; scheduled_at: string | null; session_type: string | null; cancelled: boolean };
export function usePayoutSessionDetails(record: PayoutRecord | null) {
  const ids = record?.paid_session_ids ?? [];
  const cancelledIds = record?.paid_cancelled_session_ids ?? [];
  return useQuery({
    queryKey: ['payout-sessions', record?.id],
    enabled: !!record && (ids.length > 0 || cancelledIds.length > 0),
    staleTime: 600_000,
    queryFn: async (): Promise<PayoutSession[]> => {
      const fetchSet = async (list: string[], cancelled: boolean): Promise<PayoutSession[]> => {
        if (!list.length) return [];
        const { data, error } = await supabase
          .from('training_sessions')
          .select('id, scheduled_at, session_type')
          .in('id', list)
          .order('scheduled_at', { ascending: true });
        if (error) throw new Error(error.message);
        return (data ?? []).map((s: any) => ({ id: s.id, scheduled_at: s.scheduled_at ?? null, session_type: s.session_type ?? null, cancelled }));
      };
      const [done, cans] = await Promise.all([fetchSet(ids, false), fetchSet(cancelledIds, true)]);
      return [...done, ...cans].sort((a, b) => (a.scheduled_at ?? '').localeCompare(b.scheduled_at ?? ''));
    },
  });
}

export const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
