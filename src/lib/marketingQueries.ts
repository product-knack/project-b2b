import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

/* ============ Marketing workspace — influencer campaign data ============
   Port of the web useInfluencers aggregator + useInfluencerCampaignLogs.
   Source of truth: clients (subscription_type='Influencer') + one
   influencer_campaign_logs row per (client, YYYY-MM) holding counts, targets,
   content_details / tickets / screenshots JSONB. IST month boundaries. */

export const MARKETING_ADMIN_ID = 'a8a98a93-c3e6-4cf5-bd8c-5cf15957dc5d';

const istYm = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).format(d);
export const currentIstMonth = () => istYm(new Date());

export type ContentStatus = 'exceeded' | 'on-track' | 'behind' | 'missed';
export const computeContentStatus = (delivered: number, expected: number): ContentStatus => {
  if (!expected) return delivered > 0 ? 'exceeded' : 'missed';
  const pct = delivered / expected;
  if (pct >= 1.1) return 'exceeded';
  if (pct >= 0.8) return 'on-track';
  if (pct >= 0.5) return 'behind';
  return 'missed';
};

export type MonthBucket = {
  month: string; stories: number; reels: number; expectedStories: number; expectedReels: number; status: ContentStatus;
};
export type InfluencerClient = {
  id: string;
  name: string;
  status: string | null;
  createdAt: string | null;
  sessionsUsed: number;
  sessionsTotal: number;
  sessionsInCycle: number;
  cycleTotal: number;
  sessionsThisMonth: number;
  stories: number;
  reels: number;
  expectedStories: number;
  expectedReels: number;
  monthStories: number;      // current IST month
  monthReels: number;
  monthExpStories: number;
  monthExpReels: number;
  score: number;             // 0–10
  monthly: MonthBucket[];    // ascending by month
  crmName: string | null;
  instagramUrl: string | null;
};

export function useInfluencers() {
  return useQuery({
    queryKey: ['influencer-clients'],
    staleTime: 120_000,
    queryFn: async (): Promise<InfluencerClient[]> => {
      const { data: clients, error } = await supabase
        .from('clients')
        .select('id, first_name, last_name, status, created_at, session_package, sessions_per_cycle')
        .eq('subscription_type', 'Influencer');
      if (error) throw new Error(error.message);
      const list = (clients ?? []) as any[];
      if (!list.length) return [];
      const ids = list.map((c) => c.id);

      const [logsR, renewR, sessR, commR] = await Promise.all([
        supabase.from('influencer_campaign_logs').select('client_id, month, stories_count, reels_count, expected_stories, expected_reels, instagram_url').in('client_id', ids),
        supabase.from('client_renewals').select('client_id, renewed_at, package_sessions, cycle_sessions').in('client_id', ids).order('renewed_at', { ascending: false }),
        supabase.from('training_sessions').select('client_id, created_at, scheduled_at, status').in('client_id', ids).neq('status', 'parked'),
        supabase.from('crm_communications').select('client_id, crm_id, call_date').in('client_id', ids).order('call_date', { ascending: false }).limit(500),
      ]);

      // Latest renewal per client
      const latestRenewal = new Map<string, any>();
      (renewR.data ?? []).forEach((r: any) => { if (!latestRenewal.has(r.client_id)) latestRenewal.set(r.client_id, r); });

      // Latest CRM per client → resolve names in one profiles query
      const latestCrmId = new Map<string, string>();
      (commR.data ?? []).forEach((r: any) => { if (r.crm_id && !latestCrmId.has(r.client_id)) latestCrmId.set(r.client_id, r.crm_id); });
      const crmIds = [...new Set([...latestCrmId.values()])];
      const crmNameById = new Map<string, string>();
      if (crmIds.length) {
        const { data: profs } = await supabase.from('profiles').select('id, first_name, last_name').in('id', crmIds);
        (profs ?? []).forEach((p: any) => crmNameById.set(p.id, `${p.first_name ?? ''} ${p.last_name ?? ''}`.replace(/\s+/g, ' ').trim()));
      }

      const thisMonth = currentIstMonth();
      const sessionsByClient = new Map<string, any[]>();
      (sessR.data ?? []).forEach((s: any) => {
        const arr = sessionsByClient.get(s.client_id) ?? [];
        arr.push(s);
        sessionsByClient.set(s.client_id, arr);
      });
      const logsByClient = new Map<string, any[]>();
      (logsR.data ?? []).forEach((l: any) => {
        const arr = logsByClient.get(l.client_id) ?? [];
        arr.push(l);
        logsByClient.set(l.client_id, arr);
      });

      return list.map((c) => {
        const renewal = latestRenewal.get(c.id);
        const packageStart = renewal?.renewed_at || c.created_at;
        const all = sessionsByClient.get(c.id) ?? [];
        const inPackage = packageStart ? all.filter((s) => (s.created_at ?? s.scheduled_at) >= packageStart) : all;
        const sessionsTotal = renewal?.package_sessions || (c.session_package ? parseInt(c.session_package, 10) || 0 : 0);
        const perCycle = renewal?.cycle_sessions || c.sessions_per_cycle || 0;
        const sessionsUsed = inPackage.length;
        const sessionsInCycle = perCycle ? sessionsUsed % perCycle : sessionsUsed;
        const sessionsThisMonth = all.filter((s) => {
          const at = s.scheduled_at ?? s.created_at;
          return at && istYm(new Date(at)) === thisMonth;
        }).length;

        const logs = (logsByClient.get(c.id) ?? []).sort((a, b) => String(a.month).localeCompare(String(b.month)));
        const sum = (k: string) => logs.reduce((n, l) => n + (l[k] ?? 0), 0);
        const stories = sum('stories_count'), reels = sum('reels_count');
        const expectedStories = sum('expected_stories'), expectedReels = sum('expected_reels');
        const monthLog = logs.find((l) => l.month === thisMonth);
        const monthly: MonthBucket[] = logs.map((l) => ({
          month: l.month,
          stories: l.stories_count ?? 0, reels: l.reels_count ?? 0,
          expectedStories: l.expected_stories ?? 0, expectedReels: l.expected_reels ?? 0,
          status: computeContentStatus((l.stories_count ?? 0) + (l.reels_count ?? 0), (l.expected_stories ?? 0) + (l.expected_reels ?? 0)),
        }));
        const delivered = stories + reels, expected = expectedStories + expectedReels;
        const score = expected ? Math.min(10, (delivered / expected) * 10) : 0;
        const instagramUrl = logs.map((l) => l.instagram_url).filter(Boolean).pop() ?? null;

        return {
          id: c.id,
          name: `${c.first_name ?? ''} ${c.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || 'Influencer',
          status: c.status ?? null,
          createdAt: c.created_at ?? null,
          sessionsUsed, sessionsTotal, sessionsInCycle, cycleTotal: perCycle || sessionsTotal, sessionsThisMonth,
          stories, reels, expectedStories, expectedReels,
          monthStories: monthLog?.stories_count ?? 0, monthReels: monthLog?.reels_count ?? 0,
          monthExpStories: monthLog?.expected_stories ?? 0, monthExpReels: monthLog?.expected_reels ?? 0,
          score: +score.toFixed(1),
          monthly,
          crmName: crmNameById.get(latestCrmId.get(c.id) ?? '') ?? null,
          instagramUrl,
        };
      }).sort((a, b) => b.score - a.score);
    },
  });
}

export function useInfluencer(clientId: string | null) {
  const q = useInfluencers();
  return { ...q, data: (q.data ?? []).find((c) => c.id === clientId) ?? null };
}

/* ---------- Campaign logs: per-month rows + mutations ---------- */
export type ContentEntry = { type: 'story' | 'reel'; url?: string | null; category?: string | null; added_at: string; screenshots?: string[] };
export type Ticket = {
  id: string; parent_id?: string; sender: 'marketing' | 'crm'; message: string;
  status?: 'open' | 'closed'; created_at: string; closed_by?: string | null; closed_at?: string | null;
};
export type CampaignLog = {
  id: string; client_id: string; month: string;
  stories_count: number; reels_count: number; expected_stories: number; expected_reels: number;
  status: string | null; content_details: ContentEntry[]; tickets: Ticket[];
  instagram_url: string | null; screenshots: string[]; notes: string | null;
};

export function useInfluencerCampaignLogs(clientId: string | null) {
  return useQuery({
    queryKey: ['influencer-campaign-logs', clientId],
    enabled: !!clientId,
    staleTime: 30_000,
    queryFn: async (): Promise<CampaignLog[]> => {
      const { data, error } = await supabase
        .from('influencer_campaign_logs').select('*')
        .eq('client_id', clientId).order('month', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []).map((l: any) => ({
        ...l,
        content_details: Array.isArray(l.content_details) ? l.content_details : [],
        tickets: Array.isArray(l.tickets) ? l.tickets : [],
        screenshots: Array.isArray(l.screenshots) ? l.screenshots : [],
      }));
    },
  });
}

const computeRowStatus = (l: { stories_count: number; reels_count: number; expected_stories: number; expected_reels: number }) => {
  const d = l.stories_count + l.reels_count, e = l.expected_stories + l.expected_reels;
  if (e > 0 && d >= e) return 'completed';
  if (d > 0) return 'partial';
  return 'pending';
};

/* Get-or-create the month row, then apply a JS merge (web-parity read-modify-write). */
async function upsertMonthLog(clientId: string, month: string, patch: (cur: any) => Record<string, any>) {
  const { data: cur, error: rErr } = await supabase
    .from('influencer_campaign_logs').select('*')
    .eq('client_id', clientId).eq('month', month).maybeSingle();
  if (rErr) throw new Error(rErr.message);
  if (cur) {
    const updates = { ...patch(cur), updated_at: new Date().toISOString() };
    const { error } = await supabase.from('influencer_campaign_logs').update(updates).eq('id', cur.id);
    if (error) throw new Error(error.message);
  } else {
    const base = {
      client_id: clientId, month, stories_count: 0, reels_count: 0,
      expected_stories: 0, expected_reels: 0, status: 'pending',
      content_details: [], tickets: [], screenshots: [],
    };
    const row = { ...base, ...patch(base) };
    const { error } = await supabase.from('influencer_campaign_logs').insert(row);
    if (error) throw new Error(error.message);
  }
}

export function useCampaignLogMutations(clientId: string | null) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['influencer-campaign-logs', clientId] });
    qc.invalidateQueries({ queryKey: ['influencer-clients'] });
  };
  const setTarget = useMutation({
    mutationFn: async ({ month, expectedStories, expectedReels }: { month: string; expectedStories: number; expectedReels: number }) => {
      if (!clientId) throw new Error('No client');
      await upsertMonthLog(clientId, month, (cur) => {
        const next = { ...cur, expected_stories: expectedStories, expected_reels: expectedReels };
        return { expected_stories: expectedStories, expected_reels: expectedReels, status: computeRowStatus(next) };
      });
    },
    onSuccess: invalidate,
  });
  const addContent = useMutation({
    mutationFn: async ({ month, entries }: { month: string; entries: { type: 'story' | 'reel'; url?: string; category?: string }[] }) => {
      if (!clientId) throw new Error('No client');
      const now = new Date().toISOString();
      await upsertMonthLog(clientId, month, (cur) => {
        const adds = entries.map((e) => ({ ...e, added_at: now }));
        const stories = (cur.stories_count ?? 0) + entries.filter((e) => e.type === 'story').length;
        const reels = (cur.reels_count ?? 0) + entries.filter((e) => e.type === 'reel').length;
        const next = { ...cur, stories_count: stories, reels_count: reels };
        return {
          stories_count: stories, reels_count: reels,
          content_details: [ ...(Array.isArray(cur.content_details) ? cur.content_details : []), ...adds ],
          status: computeRowStatus(next),
        };
      });
    },
    onSuccess: invalidate,
  });
  const addTicket = useMutation({
    mutationFn: async ({ month, message, sender, parentId }: { month: string; message: string; sender: 'marketing' | 'crm'; parentId?: string }) => {
      if (!clientId) throw new Error('No client');
      const t: Ticket = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ...(parentId ? { parent_id: parentId } : { status: 'open' as const }),
        sender, message, created_at: new Date().toISOString(),
      };
      await upsertMonthLog(clientId, month, (cur) => ({ tickets: [ ...(Array.isArray(cur.tickets) ? cur.tickets : []), t ] }));
    },
    onSuccess: invalidate,
  });
  const closeTicket = useMutation({
    mutationFn: async ({ month, ticketId, closedBy }: { month: string; ticketId: string; closedBy: string }) => {
      if (!clientId) throw new Error('No client');
      await upsertMonthLog(clientId, month, (cur) => ({
        tickets: (Array.isArray(cur.tickets) ? cur.tickets : []).map((t: Ticket) =>
          t.id === ticketId ? { ...t, status: 'closed', closed_by: closedBy, closed_at: new Date().toISOString() } : t),
      }));
    },
    onSuccess: invalidate,
  });
  const setInstagram = useMutation({
    mutationFn: async ({ url }: { url: string }) => {
      if (!clientId) throw new Error('No client');
      await upsertMonthLog(clientId, currentIstMonth(), () => ({ instagram_url: url.trim() || null }));
    },
    onSuccess: invalidate,
  });
  return { setTarget, addContent, addTicket, closeTicket, setInstagram };
}

/* ---------- Unread open tickets from the OTHER side (client-side lastSeen) ---------- */
export function useInfluencerOpenTickets(clientId: string | null, viewer: 'marketing' | 'crm') {
  const logsQ = useInfluencerCampaignLogs(clientId);
  const key = `influencer-tickets-seen:${clientId}:${viewer}`;
  const q = useQuery({
    queryKey: ['influencer-tickets-seen', clientId, viewer],
    enabled: !!clientId,
    queryFn: async () => (await AsyncStorage.getItem(key)) ?? '1970-01-01T00:00:00Z',
  });
  const lastSeen = q.data ?? '1970-01-01T00:00:00Z';
  const unread = (logsQ.data ?? []).flatMap((l) => l.tickets)
    .filter((t) => !t.parent_id && t.sender !== viewer && t.status === 'open' && t.created_at > lastSeen).length;
  const qc = useQueryClient();
  const markSeen = async () => {
    await AsyncStorage.setItem(key, new Date().toISOString()).catch(() => {});
    qc.invalidateQueries({ queryKey: ['influencer-tickets-seen', clientId, viewer] });
  };
  return { unread, markSeen };
}


/* ---------- Blood reports (web BloodReportsSection port) ----------
   Two sources, mirroring the web marketing "Health Report" tab:
   1. blood_report_markers — per-marker rows with category/status/ref-range/trend.
   2. RPC get_health_reports_for_marketing — health_reports rows RLS-visible to
      marketing accounts; extracted_data.tests[].markers[] is the payload.
      Falls back to a direct health_reports read for roles that can see it. */
export type BloodMarkerRow = {
  id: string; category_name: string | null; marker_name: string; value: number;
  unit: string | null; status: string; reference_min: number | null; reference_max: number | null;
  test_date: string; trend: string | null; previous_value: number | null;
};
export type ExtractedReport = { id: string; report_name: string; upload_date: string; tests: any[] };

export function useMarketingBloodReports(clientId: string | null) {
  return useQuery({
    queryKey: ['marketing-blood-reports', clientId],
    enabled: !!clientId,
    staleTime: 120_000,
    queryFn: async () => {
      const [markersR, rpcR] = await Promise.all([
        supabase
          .from('blood_report_markers')
          .select('id, category_name, marker_name, value, unit, status, reference_min, reference_max, test_date, trend, previous_value')
          .eq('client_id', clientId)
          .order('test_date', { ascending: false }),
        supabase.rpc('get_health_reports_for_marketing', { p_client_id: clientId }),
      ]);
      if (markersR.error) throw new Error(markersR.error.message);
      let reportRows: any[] = rpcR.error ? [] : (rpcR.data ?? []);
      // The RPC only yields rows for marketing accounts; other roles read directly.
      if (!reportRows.length) {
        const direct = await supabase
          .from('health_reports')
          .select('id, report_name, upload_date, extracted_data')
          .eq('client_id', clientId).eq('is_active', true)
          .order('upload_date', { ascending: false });
        if (!direct.error) reportRows = direct.data ?? [];
      }
      const reports: ExtractedReport[] = reportRows.map((r: any) => ({
        id: r.id, report_name: r.report_name, upload_date: r.upload_date,
        tests: (r.extracted_data as any)?.tests ?? [],
      }));
      return { markers: (markersR.data ?? []) as BloodMarkerRow[], reports };
    },
  });
}

/* Web getMarkerStatus — derive a status for extracted-report markers whose value
   may be text ("High") or numeric-with-range. */
export function markerStatusOf(marker: any): 'high' | 'low' | 'normal' {
  const value = String(marker?.value ?? '').toLowerCase();
  const range = String(marker?.reference_range ?? '');
  if (value.includes('high') || value.includes('elevated')) return 'high';
  if (value.includes('low') || value.includes('decreased')) return 'low';
  if (value.includes('normal') || value.includes('within range')) return 'normal';
  if (!range.trim()) return 'normal';
  const num = parseFloat(value.replace(/[^\d.-]/g, ''));
  if (!isNaN(num)) {
    const m = range.match(/(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?)/);
    if (m) {
      if (num < parseFloat(m[1])) return 'low';
      if (num > parseFloat(m[2])) return 'high';
    }
  }
  return 'normal';
}


/* ---------- Leads Analytics (web compliance/LeadsAnalytics port) ----------
   Matches the web query exactly (NO is_spam / applicant_lead filters) so the
   "N leads in range" count lines up with the web page. */
type LeadAnalyticsRow = { lead_date: string; source: string | null; stage: string | null; ads_creative: string | null; converted_at: string | null };

async function fetchAllLeads(builder: () => any): Promise<LeadAnalyticsRow[]> {
  const pageSize = 1000;
  let from = 0;
  const out: LeadAnalyticsRow[] = [];
  // Loop pages until a short page (PostgREST caps at 1000 rows per request).
  for (;;) {
    const { data, error } = await builder().range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const chunk = (data ?? []) as LeadAnalyticsRow[];
    out.push(...chunk);
    if (chunk.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

export function useLeadsAnalytics(start: string, end: string) {
  return useQuery({
    queryKey: ['marketing-leads-analytics', start, end],
    staleTime: 120_000,
    queryFn: async () => {
      // endNext = day after `end` (exclusive upper bound for converted_at timestamps)
      const endNext = new Date(`${end}T00:00:00`);
      endNext.setDate(endNext.getDate() + 1);
      const endNextStr = endNext.toISOString().slice(0, 19);
      const [rows, convertedRows] = await Promise.all([
        fetchAllLeads(() =>
          supabase.from('leads').select('lead_date,source,stage,ads_creative,converted_at')
            .gte('lead_date', start).lte('lead_date', end)),
        fetchAllLeads(() =>
          supabase.from('leads').select('lead_date,source,stage,ads_creative,converted_at')
            .eq('stage', 'Converted').gte('converted_at', `${start}T00:00:00`).lt('converted_at', endNextStr)),
      ]);
      return { rows, convertedRows };
    },
  });
}
