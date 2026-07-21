import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';

/* ============ CRM Tools · Blood Reports — mirrors the web
   useClientsBloodReportStatus: every active client in the book with their
   blood reports (health_reports, is_active) or flagged as missing. ============ */

const fullName = (p: any) => `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || 'Client';

// Web rule: exclude purely non-blood report types (imaging etc.).
const isBloodReport = (type: string | null) => {
  const t = (type ?? '').toLowerCase();
  if (!t) return true;
  const nonBlood = /mri|cect|dexa|ultrasound|imaging|x-?ray|\bct\b|ct |scan|angiograph|coronary|spine|neck|echo/.test(t);
  const bloodish = /blood|metabolic|panel|hormone|vitamin|cardiac|thyroid|lipid|hematology/.test(t);
  return !nonBlood || bloodish;
};

export type BloodClientRow = {
  clientId: string; clientName: string;
  count: number; lastTest: string | null;
  reports: any[]; // full health_reports rows — BloodReportSheet renders them
};

export function useBloodReportStatus(crmId: string | null) {
  return useQuery({
    queryKey: ['crm-blood-status', crmId],
    enabled: !!crmId,
    staleTime: 120_000,
    queryFn: async (): Promise<BloodClientRow[]> => {
      const { data: book, error: bErr } = await supabase
        .from('trainer_clients').select('client_id').eq('trainer_id', crmId).eq('actively_training', true);
      if (bErr) throw new Error(bErr.message);
      const ids = [...new Set((book ?? []).map((r: any) => r.client_id))];
      if (!ids.length) return [];

      const [clientsR, reportsR] = await Promise.all([
        supabase.from('clients').select('id, first_name, last_name, status').in('id', ids).eq('status', 'active').order('first_name'),
        supabase.from('health_reports')
          .select('id, client_id, report_name, report_type, test_date, upload_date, file_url, notes, biomarkers, extracted_data, measurements, ai_analysis, metabolic_score, longevity_score')
          .in('client_id', ids).eq('is_active', true)
          .order('test_date', { ascending: false }),
      ]);
      if (clientsR.error) throw new Error(clientsR.error.message);

      const byClient = new Map<string, any[]>();
      ((reportsR.data ?? []) as any[]).forEach((r) => {
        if (!isBloodReport(r.report_type)) return;
        byClient.set(r.client_id, [...(byClient.get(r.client_id) ?? []), r]);
      });

      return ((clientsR.data ?? []) as any[]).map((c) => {
        const reports = byClient.get(c.id) ?? [];
        const lastTest = reports.reduce<string | null>((m, r) => {
          const td = r.test_date || r.upload_date;
          return td && (!m || td > m) ? td : m;
        }, null);
        return { clientId: c.id, clientName: fullName(c), count: reports.length, lastTest, reports };
      }).sort((a, b) => (a.count === 0 ? -1 : 1) - (b.count === 0 ? -1 : 1) || a.clientName.localeCompare(b.clientName));
    },
  });
}
