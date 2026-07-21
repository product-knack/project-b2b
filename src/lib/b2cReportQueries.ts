import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';

/* ============ B2C Reports (web /academy/b2c-qhp-reports) ============
   Web-gated to EXACTLY one profile (Rajat Sharma) — same here.
   QHP tab:   qhp_details grouped per client → clients WHERE client_type='B2C'
              → per-client reports (Baseline/Refresh chronology) → qhp_json detail.
   Blood tab: health_reports (is_active) grouped per B2C client → per-client files. */

export const B2C_REPORTS_UID = '196ec824-a093-4944-ae3d-3c4919ebf0df';

const nm = (p: any) => `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || 'Unnamed';

export type B2cClient = { id: string; name: string; initial: string; subscription: string | null; reportCount: number; latestAt: string | null };

async function b2cClientsFor(rows: { client_id: string; at: string | null }[]): Promise<B2cClient[]> {
  const map = new Map<string, { count: number; latest: string | null }>();
  rows.forEach((d) => {
    if (!d.client_id) return;
    const cur = map.get(d.client_id) ?? { count: 0, latest: null };
    cur.count += 1;
    if (!cur.latest || (d.at && d.at > cur.latest)) cur.latest = d.at ?? cur.latest;
    map.set(d.client_id, cur);
  });
  const ids = [...map.keys()];
  if (!ids.length) return [];
  const out: B2cClient[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data: clients, error } = await supabase
      .from('clients')
      .select('id, first_name, last_name, subscription_type, client_type')
      .in('id', ids.slice(i, i + 100))
      .eq('client_type', 'B2C');
    if (error) throw new Error(error.message);
    (clients ?? []).forEach((c: any) => {
      const agg = map.get(c.id)!;
      const name = nm(c);
      out.push({ id: c.id, name, initial: (name[0] ?? '?').toUpperCase(), subscription: c.subscription_type ?? null, reportCount: agg.count, latestAt: agg.latest });
    });
  }
  return out.sort((a, b) => (b.latestAt ?? '').localeCompare(a.latestAt ?? ''));
}

export function useB2cQhpClients(enabled: boolean) {
  return useQuery({
    queryKey: ['b2c-qhp-clients'],
    enabled,
    staleTime: 120_000,
    queryFn: async (): Promise<B2cClient[]> => {
      const { data, error } = await supabase.from('qhp_details').select('client_id, created_at').order('created_at', { ascending: false }).limit(10000);
      if (error) throw new Error(error.message);
      return b2cClientsFor(((data ?? []) as any[]).map((d) => ({ client_id: d.client_id, at: d.created_at })));
    },
  });
}

export type B2cQhpReport = { id: string; createdAt: string | null; approved: boolean; pdfUrl: string | null; qhpJson: any };
export function useB2cClientQhpReports(clientId: string | null) {
  return useQuery({
    queryKey: ['b2c-qhp-reports', clientId],
    enabled: !!clientId,
    staleTime: 120_000,
    queryFn: async (): Promise<B2cQhpReport[]> => {
      const { data, error } = await supabase
        .from('qhp_details')
        .select('id, client_id, created_at, approved, pdf_storage_path, pdf_filename, qhp_json')
        .eq('client_id', clientId!)
        .order('created_at', { ascending: true });
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map((r) => ({
        id: r.id, createdAt: r.created_at ?? null, approved: r.approved === true,
        pdfUrl: r.pdf_storage_path ? supabase.storage.from('qhp-images').getPublicUrl(r.pdf_storage_path).data.publicUrl : null,
        qhpJson: r.qhp_json ?? null,
      }));
    },
  });
}

export function useB2cBloodClients(enabled: boolean) {
  return useQuery({
    queryKey: ['b2c-blood-clients'],
    enabled,
    staleTime: 120_000,
    queryFn: async (): Promise<B2cClient[]> => {
      const { data, error } = await supabase.from('health_reports').select('client_id, upload_date, created_at').eq('is_active', true).order('created_at', { ascending: false }).limit(10000);
      if (error) throw new Error(error.message);
      return b2cClientsFor(((data ?? []) as any[]).map((d) => ({ client_id: d.client_id, at: d.upload_date ?? d.created_at })));
    },
  });
}

export type B2cBloodReport = { id: string; name: string; type: string | null; uploadedAt: string | null; fileUrl: string | null; extracted: any };
export function useB2cClientBloodReports(clientId: string | null) {
  return useQuery({
    queryKey: ['b2c-blood-reports', clientId],
    enabled: !!clientId,
    staleTime: 120_000,
    queryFn: async (): Promise<B2cBloodReport[]> => {
      const { data, error } = await supabase
        .from('health_reports')
        .select('id, report_name, report_type, upload_date, created_at, file_url, extracted_data')
        .eq('client_id', clientId!)
        .eq('is_active', true)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map((r) => ({
        id: r.id, name: r.report_name || r.report_type || 'Health Report', type: r.report_type ?? null,
        uploadedAt: r.upload_date ?? r.created_at ?? null, fileUrl: r.file_url ?? null, extracted: r.extracted_data ?? null,
      }));
    },
  });
}
