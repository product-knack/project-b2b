import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { supabase } from './supabase';
import { uuidv4 } from './clientQueries';

/* ============ Ops — Leads pipeline (web src/hooks/useLeads.ts port) ============
   All contracts extracted verbatim from the web app: LEAD_SELECT, stage list,
   filter building, stats formulas, follow-up/remark jsonb shapes, permissions.
   Verified live: leads readable (957 rows), get_cold_lead_ids works (378 ids). */

export const LEAD_SELECT = 'id,name,contact_no,source,lead_date,stage,stage_history,description,created_by,created_by_role,created_at,updated_at,client_id,converted_at,converted_by,remark,remarks,qhp_pref_date,qhp_pref_time_from,qhp_pref_time_to,qhp_pref_location,qhp_pref_notes,next_follow_up_at,next_follow_up_note,follow_ups,influencer,ads_creative,referral_name,qhp_booked_by,qhp_booked_by_role,invoice_details,category,qualified_lead_criteria,applicant_lead,is_spam,spam_history,qhp_details,categories,potential,assigned_to,lead_type,call_attempts,is_dump,dump_history,clinical_grade,partner_lead_id';

// Web parity (2026-08): "Potential" and "Trail" stages removed (Potential became
// a JSONB star flag); "Reschedule QHP", "QHP Completed", "Decision Awaiting",
// "Trial" added. "Website" source removed.
export const LEAD_STAGES = ['New', 'Not Picked', 'Follow Up', 'QHP Booked', 'Reschedule QHP', 'QHP Completed', 'Decision Awaiting', 'Trial', 'Raise invoice', 'Converted', 'Refunded', 'Lost'] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];
export const LEAD_SOURCES = ['Direct', 'Instagram', 'Referral', 'Influencer', 'Google Form', 'Website Form Instagram', 'WhatsApp'] as const;
export const CANDIDATE_TYPES = ['Trainer', 'Marketing', 'Sales', 'Physiotherapist'] as const;
export const SUBSCRIPTION_TYPES = ['Staff', 'Opportunity', 'Trial', 'Odds basic', 'Odds plus', 'Odds pro', 'Odds lux', 'Odds Prive', 'Odds APEX', 'Odds generation', 'Virtual Training', 'Influencer'] as const;
export const LEAD_CATEGORIES = [
  { value: 'not_defined', label: 'Not selected' },
  { value: 'price_sensitive', label: 'Price Sensitive' },
  { value: 'poor_not_audience', label: 'Poor / Not Our Audience' },
  { value: 'existing_trainer_plan', label: 'Existing Trainer / Plan (Was Curious)' },
  { value: 'not_location_fit', label: 'Not Location Fit' },
  { value: 'wants_to_start_later', label: 'Wants to Start Later (Timeline)' },
] as const;
export const RESCHEDULE_REASONS = ['Client missed the QHP', 'Client unavailable - requested new slot', 'Assessor unavailable', 'Assessment incomplete', 'Other'] as const;

export type Lead = Record<string, any> & { id: string; name: string; stage: string };
export type FollowUpEntry = { id: string; scheduled_at: string; note: string | null; status: 'pending' | 'done' | 'superseded'; created_at: string; created_by?: string | null; created_by_name?: string | null; completed_at?: string; completed_by?: string | null; completed_by_name?: string | null; completion_note?: string | null };
export type RemarkEntry = { id?: string; text: string; date: string; author_id?: string | null; author_name?: string | null };
export type PotentialMark = { marked: boolean; by: string | null; by_name: string | null; at: string };
export type CallAttemptEntry = { at: string; day: string; by: string | null; by_name: string | null };
export type DumpHistoryEntry = { at: string; reason: string; by?: string | null; by_name?: string | null; attempts_count?: number };

/* "Reschedule QHP" is only a valid transition when the lead already has a booked
   QHP (web src/components/ops/leads/leadStageUtils.ts, verbatim logic). */
export function canRescheduleQHP(lead: any): boolean {
  if (!lead) return false;
  if (lead.stage === 'QHP Booked' || lead.stage === 'Reschedule QHP') return true;
  if (lead.qhp_pref_date) return true;
  return (Array.isArray(lead.stage_history) ? lead.stage_history : []).some((h: any) => h?.stage === 'QHP Booked' || h?.stage === 'Reschedule QHP');
}

/* IST wall-clock → UTC Date (web istToUtc: fixed +5:30, browser-TZ independent). */
export const istToUtc = (dateStr: string, timeStr: string): Date => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [h, mi] = timeStr.split(':').map(Number);
  return new Date(Date.UTC(y, m - 1, d, h || 0, mi || 0, 0, 0) - 330 * 60 * 1000);
};
export const randomId = () => {
  try { return (globalThis as any).crypto?.randomUUID?.() ?? `fu_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; }
  catch { return `fu_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; }
};

/* ---------------- permissions (web src/lib/leadPermissions.ts) ---------------- */
export const MARKETING_ADMIN_ID = 'a8a98a93-c3e6-4cf5-bd8c-5cf15957dc5d';
type ProfileLite = { id?: string | null; role?: string | null; compliance_analyst?: boolean | null } | null;
export function canEditLead(profile: ProfileLite, lead: any): boolean {
  if (!profile || !lead) return false;
  if (profile.role === 'admin') return true;
  if (profile.compliance_analyst === true) return true;
  if ((lead.created_by_role ?? '') === 'marketing') return profile.id === MARKETING_ADMIN_ID || profile.role === 'ops';
  return profile.role === 'ops';
}
export function canMarkLeadSpam(profile: ProfileLite): boolean {
  if (!profile) return false;
  return profile.role === 'admin' || profile.role === 'ops' || profile.compliance_analyst === true || profile.id === MARKETING_ADMIN_ID;
}
export function useMyOpsProfile() {
  return useQuery({
    queryKey: ['ops-my-profile'],
    staleTime: 600_000,
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
      const { data } = await supabase.from('profiles').select('id, first_name, last_name, role, compliance_analyst, managers').eq('id', u.user.id).maybeSingle();
      return data as any;
    },
  });
}
export const profileName = (p: any) => `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || null;

/* ---------------- list query (web useLeadsQuery — exact filter building) ---------------- */
export type LeadFilters = {
  search?: string; stages?: string[]; sources?: string[]; categories?: string[];
  dateFrom?: string; dateTo?: string; onlyIds?: string[] | null;
  applicantLeadsOnly?: boolean; spamOnly?: boolean; dumpOnly?: boolean; potentialOnly?: boolean;
  sortBy?: 'name' | 'lead_date' | 'stage' | 'created_at' | 'updated_at'; sortDir?: 'asc' | 'desc';
  page?: number; pageSize?: number;
};
export function useLeadsList(filters: LeadFilters) {
  return useQuery({
    queryKey: ['leads', filters],
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    queryFn: async (): Promise<{ rows: Lead[]; total: number }> => {
      if (filters.onlyIds && filters.onlyIds.length === 0) return { rows: [], total: 0 };
      const sortBy = filters.sortBy ?? 'created_at';
      const ascending = filters.sortDir === 'asc';
      const build = (withCount: boolean) => {
        let q: any = withCount ? supabase.from('leads').select(LEAD_SELECT, { count: 'exact' }) : supabase.from('leads').select(LEAD_SELECT);
        const s = (filters.search ?? '').trim().replace(/%/g, '');
        if (s) q = q.or(`name.ilike.%${s}%,contact_no.ilike.%${s}%`);
        if (filters.stages?.length) q = q.in('stage', filters.stages);
        if (filters.sources?.length) q = q.in('source', filters.sources);
        if (filters.categories?.length) q = q.in('category', filters.categories);
        if (filters.dateFrom) q = q.gte('lead_date', filters.dateFrom);
        if (filters.dateTo) q = q.lte('lead_date', filters.dateTo);
        q = filters.applicantLeadsOnly ? q.not('applicant_lead', 'is', null) : q.is('applicant_lead', null);
        if (filters.spamOnly) q = q.eq('is_spam', true);
        else q = q.eq('is_spam', false);
        // Web parity (2026-08): dump leads are hidden from every default list.
        if (filters.dumpOnly) q = q.eq('is_dump', true);
        else q = q.eq('is_dump', false);
        if (filters.potentialOnly) q = q.eq('potential->>marked', 'true');
        return q.order(sortBy, { ascending });
      };
      const page = filters.page ?? 1;
      const pageSize = filters.pageSize ?? 25;
      const from = (page - 1) * pageSize;
      // Chunked path (web parity): the cold filter passes ~380 uuids; a single
      // id=in.(...) GET blows the ~8KB URL limit and the list renders empty.
      // Fan out in batches of 100, then sort + paginate in memory.
      if (filters.onlyIds) {
        const CHUNK = 100;
        const chunks: string[][] = [];
        for (let i = 0; i < filters.onlyIds.length; i += CHUNK) chunks.push(filters.onlyIds.slice(i, i + CHUNK));
        const results = await Promise.all(chunks.map(async (ids) => {
          const { data, error } = await build(false).in('id', ids);
          if (error) throw new Error(error.message);
          return (data ?? []) as Lead[];
        }));
        const merged = results.flat().sort((a: any, b: any) => {
          const av = a?.[sortBy]; const bv = b?.[sortBy];
          if (av == null && bv == null) return 0;
          if (av == null) return ascending ? -1 : 1;
          if (bv == null) return ascending ? 1 : -1;
          if (av < bv) return ascending ? -1 : 1;
          if (av > bv) return ascending ? 1 : -1;
          return 0;
        });
        return { rows: merged.slice(from, from + pageSize), total: merged.length };
      }
      const { data, error, count } = await build(true).range(from, from + pageSize - 1);
      if (error) throw new Error(error.message);
      return { rows: (data ?? []) as Lead[], total: count ?? 0 };
    },
  });
}

/* ---------------- stats (web useLeadStats — exact formulas) ---------------- */
export type LeadStats = { total: number; newThisWeek: number; thisMonth: number; converted: number; conversionRate: number; activePipeline: number; potential: number };
const istYm = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).format(d).slice(0, 7);
export function useLeadStats() {
  return useQuery({
    queryKey: ['leads-stats'],
    staleTime: 60_000,
    queryFn: async (): Promise<LeadStats> => {
      const { data, error } = await supabase.from('leads').select('stage,created_at,lead_date,lead_type,potential').is('applicant_lead', null).eq('is_spam', false).limit(10000);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as any[];
      const weekAgo = Date.now() - 7 * 864e5;
      const curYm = istYm(new Date());
      const total = rows.length;
      // Web parity (2026-08): conversions and the rate EXCLUDE influencer
      // leads; Total and New-this-week still count everything.
      const nonInfluencer = rows.filter((r) => r.lead_type !== 'influencer');
      const converted = nonInfluencer.filter((r) => r.stage === 'Converted').length;
      return {
        total,
        newThisWeek: rows.filter((r) => new Date(r.created_at).getTime() >= weekAgo).length,
        thisMonth: rows.filter((r) => (r.lead_date ? r.lead_date.slice(0, 7) : istYm(new Date(r.created_at))) === curYm).length,
        converted,
        conversionRate: nonInfluencer.length > 0 ? Math.round((converted / nonInfluencer.length) * 100) : 0,
        // Web parity: "Potential" is no longer a stage (it became a JSONB flag);
        // the pipeline is New + QHP Booked + QHP Completed.
        activePipeline: rows.filter((r) => r.stage === 'New' || r.stage === 'QHP Booked' || r.stage === 'QHP Completed').length,
        potential: rows.filter((r) => !!r.potential?.marked).length,
      };
    },
  });
}
export function useColdLeads() {
  return useQuery({
    queryKey: ['leads-cold-count'],
    staleTime: 60_000,
    queryFn: async (): Promise<{ count: number; ids: string[] }> => {
      // Web parity (2026-08): cold threshold raised from 5 to 10 days.
      const { data, error } = await supabase.rpc('get_cold_lead_ids', { _days: 10 });
      if (error) throw new Error(error.message);
      const ids = ((data ?? []) as any[]).map((r) => (typeof r === 'string' ? r : r.id)).filter(Boolean);
      return { count: ids.length, ids };
    },
  });
}
/* Dump leads = cold leads with 2+ post-cold attempts, auto-moved by a DB trigger. */
export function useDumpLeadsCount() {
  return useQuery({
    queryKey: ['leads-dump-count'],
    staleTime: 60_000,
    queryFn: async (): Promise<{ count: number }> => {
      const { count, error } = await supabase.from('leads').select('id', { count: 'exact', head: true }).eq('is_dump', true).is('applicant_lead', null).eq('is_spam', false);
      if (error) throw new Error(error.message);
      return { count: count ?? 0 };
    },
  });
}
/* Month-wise lead serials computed client-side (web src/lib/leadSerial.ts).
   Group = YYYY-MM of lead_date; order (lead_date, created_at, id) asc; number
   from 1; numbering restarts every month. */
export function computeLeadMonthlySerials(rows: { id: string; lead_date: string | null; created_at: string | null }[]): Map<string, number> {
  const byMonth = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!r.lead_date) continue;
    const key = r.lead_date.slice(0, 7);
    const arr = byMonth.get(key) ?? [];
    arr.push(r);
    byMonth.set(key, arr);
  }
  const out = new Map<string, number>();
  for (const [, arr] of byMonth) {
    arr.sort((a, b) => {
      if (a.lead_date! < b.lead_date!) return -1;
      if (a.lead_date! > b.lead_date!) return 1;
      const ac = a.created_at ?? ''; const bc = b.created_at ?? '';
      if (ac < bc) return -1;
      if (ac > bc) return 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    arr.forEach((row, idx) => out.set(row.id, idx + 1));
  }
  return out;
}
export function useLeadMonthlySerials() {
  return useQuery({
    queryKey: ['leads-monthly-serials'],
    staleTime: 30_000,
    queryFn: async () => {
      const all: { id: string; lead_date: string | null; created_at: string | null }[] = [];
      const pageSize = 1000;
      let from = 0;
      // Paginate past PostgREST's 1000-row cap.
      for (;;) {
        const { data, error } = await supabase.from('leads').select('id,lead_date,created_at').is('applicant_lead', null).eq('is_spam', false).order('lead_date', { ascending: true }).range(from, from + pageSize - 1);
        if (error) throw new Error(error.message);
        const rows = (data ?? []) as any[];
        all.push(...rows);
        if (rows.length < pageSize) break;
        from += pageSize;
      }
      return computeLeadMonthlySerials(all);
    },
  });
}
/* Resolve partner (couple) lead names for the row badges — one batched query. */
export function usePartnerNames(ids: string[]) {
  const key = [...ids].sort().join(',');
  return useQuery({
    queryKey: ['lead-partner-names', key],
    enabled: ids.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<Record<string, string>> => {
      const { data, error } = await supabase.from('leads').select('id,name').in('id', ids);
      if (error) throw new Error(error.message);
      const out: Record<string, string> = {};
      for (const r of (data ?? []) as any[]) out[r.id] = r.name;
      return out;
    },
  });
}
/* Couple pairing: search other leads to link as a training partner. */
export function useLeadPartnerSearch(term: string, excludeId: string) {
  const t = term.trim().replace(/[%,]/g, '');
  return useQuery({
    queryKey: ['lead-partner-search', t, excludeId],
    enabled: t.length > 0,
    staleTime: 15_000,
    queryFn: async (): Promise<{ id: string; name: string; contact_no: string | null; partner_lead_id: string | null; stage: string | null }[]> => {
      const { data, error } = await supabase.from('leads')
        .select('id,name,contact_no,partner_lead_id,stage,created_at')
        .or(`name.ilike.%${t}%,contact_no.ilike.%${t}%`)
        .neq('id', excludeId)
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) throw new Error(error.message);
      return (data ?? []) as any[];
    },
  });
}

/* ---------------- assigned-to (P6) ---------------- */
// Hardcoded whitelist (web AssignedToPicker ASSIGNABLE_IDS): only these three
// team members can be assigned to a lead.
export const LEAD_ASSIGNEES = [
  { id: '386dc683-d537-492b-b589-769f57e6c824', name: 'Sunaina Sethia' },
  { id: '23e681f9-664f-4630-90cd-73d21ee1dcc4', name: 'Preeti Choudhury' },
  { id: 'a8a98a93-c3e6-4cf5-bd8c-5cf15957dc5d', name: 'Divya' },
] as const;
export const assigneeFirstName = (id: string | null | undefined): string | null => {
  const hit = LEAD_ASSIGNEES.find((a) => a.id === id);
  return hit ? hit.name.split(' ')[0] : null;
};

/* ---------------- mutations ---------------- */
const invalidateLeads = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: ['leads'] });
  qc.invalidateQueries({ queryKey: ['leads-stats'] });
  qc.invalidateQueries({ queryKey: ['leads-cold-count'] });
  qc.invalidateQueries({ queryKey: ['leads-dump-count'] });
  qc.invalidateQueries({ queryKey: ['leads-monthly-serials'] });
  qc.invalidateQueries({ queryKey: ['ops-followup-reminders'] });
};
export function useCreateLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; contact_no: string; source: string; lead_date: string; stage: string; description?: string | null; influencer?: string | null; ads_creative?: string | null; referral_name?: string | null; lead_type?: string | null; profile: any }) => {
      const p = input.profile;
      const payload = {
        name: input.name.trim(), contact_no: input.contact_no, source: input.source, lead_date: input.lead_date, stage: input.stage,
        description: input.description ?? null,
        influencer: input.source === 'Influencer' ? input.influencer ?? null : null,
        ads_creative: input.source === 'Instagram' ? input.ads_creative ?? null : null,
        referral_name: input.source === 'Referral' ? (input.referral_name ?? '').trim() || null : null,
        lead_type: input.lead_type ?? null,
        created_by: p?.id, created_by_role: p?.compliance_analyst === true ? 'compliance' : p?.role ?? null,
      };
      const { data, error } = await supabase.from('leads').insert(payload).select(LEAD_SELECT).single();
      if (error) throw new Error(error.message);
      return data as Lead;
    },
    onSuccess: () => invalidateLeads(qc),
  });
}
export function useUpdateLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; patch: Record<string, any> }) => {
      const { data, error } = await supabase.from('leads').update(input.patch).eq('id', input.id).select(LEAD_SELECT).single();
      if (error) throw new Error(error.message);
      return data as Lead;
    },
    onSuccess: () => invalidateLeads(qc),
  });
}
/* Potential star flag (web useToggleLeadPotential): marked → null, unmarked →
   {marked, by, by_name, at}. */
export function useToggleLeadPotential() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { lead: Lead; profile: any }) => {
      const currentlyMarked = !!input.lead.potential?.marked;
      const next = currentlyMarked ? null : { marked: true, by: input.profile?.id ?? null, by_name: profileName(input.profile), at: new Date().toISOString() };
      const { data, error } = await supabase.from('leads').update({ potential: next }).eq('id', input.lead.id).select(LEAD_SELECT).single();
      if (error) throw new Error(error.message);
      return data as Lead;
    },
    onSuccess: () => invalidateLeads(qc),
  });
}
/* Call attempt (web useMarkLeadAttempt): append {at, day, by, by_name} via a
   plain update, then RE-READ the row — the leads_auto_dump_on_attempts DB
   trigger may have flipped is_dump (2 attempts on a cold lead). Never set
   is_dump here ourselves. */
export function useMarkLeadAttempt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { lead: Lead; profile: any }) => {
      const now = new Date();
      const entry: CallAttemptEntry = {
        at: now.toISOString(),
        day: new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', weekday: 'long' }).format(now),
        by: input.profile?.id ?? null,
        by_name: profileName(input.profile),
      };
      const attempts: CallAttemptEntry[] = Array.isArray(input.lead.call_attempts) ? input.lead.call_attempts : [];
      const { error } = await supabase.from('leads').update({ call_attempts: [...attempts, entry] }).eq('id', input.lead.id);
      if (error) throw new Error(error.message);
      const { data, error: rErr } = await supabase.from('leads').select(LEAD_SELECT).eq('id', input.lead.id).single();
      if (rErr) throw new Error(rErr.message);
      return data as Lead;
    },
    onSuccess: () => invalidateLeads(qc),
  });
}
/* Restore a dump lead back to the Cold list (web useRestoreLeadFromDump). */
export function useRestoreLeadFromDump() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { leadId: string; profile: any }) => {
      const { data: row, error: rErr } = await supabase.from('leads').select('dump_history').eq('id', input.leadId).single();
      if (rErr) throw new Error(rErr.message);
      const history: DumpHistoryEntry[] = Array.isArray((row as any)?.dump_history) ? (row as any).dump_history : [];
      const entry: DumpHistoryEntry = { at: new Date().toISOString(), reason: 'manual_restore', by: input.profile?.id ?? null, by_name: profileName(input.profile) };
      const { error } = await supabase.from('leads').update({ is_dump: false, dump_history: [...history, entry] }).eq('id', input.leadId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => invalidateLeads(qc),
  });
}
/* Assigned-to (web useAssignLead): RPC guards the whitelist server-side. */
export function useAssignLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { leadId: string; assignee: string | null }) => {
      const { error } = await supabase.rpc('assign_lead', { _lead_id: input.leadId, _assignee: input.assignee });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => invalidateLeads(qc),
  });
}
/* Couple pairing (web useSetLeadPartner): link both leads, then try to apply
   clients.training_partner_id right away. Returns the sync status:
   'linked' | 'already_linked' | 'pending_partner' | null. */
export function useSetLeadPartner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { leadId: string; partnerLeadId: string }): Promise<string | null> => {
      const { error } = await supabase.rpc('set_lead_partner', { _lead_id: input.leadId, _partner_lead_id: input.partnerLeadId });
      if (error) throw new Error(error.message);
      try {
        const { data } = await supabase.rpc('sync_lead_partner_to_clients', { _lead_id: input.leadId });
        return (data as string) ?? null;
      } catch { return null; }
    },
    onSuccess: () => invalidateLeads(qc),
  });
}
export function useClearLeadPartner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { leadId: string }) => {
      // Remove the shared training_partner_id first (needs the pairing intact).
      try { await supabase.rpc('unlink_lead_partner_from_clients', { _lead_id: input.leadId }); } catch { /* best-effort */ }
      const { error } = await supabase.rpc('clear_lead_partner', { _lead_id: input.leadId });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => invalidateLeads(qc),
  });
}
/* Schedule follow-up (web useScheduleFollowUp): supersede pending entries, append new, flip stage. */
export function useScheduleFollowUp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { lead: Lead; dateStr: string; timeStr: string; note: string; profile: any }) => {
      const nowIso = new Date().toISOString();
      const authorName = profileName(input.profile);
      const scheduledAt = istToUtc(input.dateStr, input.timeStr).toISOString();
      const existing: FollowUpEntry[] = Array.isArray(input.lead.follow_ups) ? input.lead.follow_ups : [];
      const superseded = existing.map((e) => (e.status === 'pending' ? { ...e, status: 'superseded' as const, completed_at: nowIso, completed_by: input.profile?.id ?? null, completed_by_name: authorName, completion_note: 'Replaced by new follow-up' } : e));
      const entry: FollowUpEntry = { id: randomId(), scheduled_at: scheduledAt, note: input.note || null, status: 'pending', created_at: nowIso, created_by: input.profile?.id ?? null, created_by_name: authorName };
      const { data, error } = await supabase.from('leads')
        .update({ stage: 'Follow Up', next_follow_up_at: scheduledAt, next_follow_up_note: input.note || null, follow_ups: [...superseded, entry] })
        .eq('id', input.lead.id).select(LEAD_SELECT).single();
      if (error) throw new Error(error.message);
      return data as Lead;
    },
    onSuccess: () => invalidateLeads(qc),
  });
}
/* Complete a pending follow-up (web useCompleteFollowUp) — clears next_follow_up_* and logs a remark.
   Web parity: read-then-write. follow_ups/remarks are re-read fresh inside the mutation so a stale
   caller (e.g. the reminder panel, whose rows don't even carry remarks) can never clobber them. */
export function useCompleteFollowUp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { leadId: string; entryId?: string; manualRemark?: string; profile: any }) => {
      const { data: cur, error: readErr } = await supabase.from('leads').select('follow_ups,remarks').eq('id', input.leadId).single();
      if (readErr) throw new Error(readErr.message);
      const nowIso = new Date().toISOString();
      const authorName = profileName(input.profile);
      const existing: FollowUpEntry[] = Array.isArray((cur as any)?.follow_ups) ? (cur as any).follow_ups : [];
      const target = input.entryId ? existing.find((e) => e.id === input.entryId) : [...existing].reverse().find((e) => e.status === 'pending');
      const manual = (input.manualRemark ?? '').trim();
      // Label matches web's date-fns format 'dd-MMM-yyyy h:mm a' (IST) exactly — this text is
      // PERSISTED into remarks/remark, so native and web rows must be byte-identical. Falls back
      // to now (web parity) so a missing entry never produces "Follow-up done on ".
      const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(new Date(target?.scheduled_at ?? nowIso));
      const pt = (t: string) => parts.find((x) => x.type === t)?.value ?? '';
      const label = `${pt('day')}-${pt('month')}-${pt('year')} ${pt('hour')}:${pt('minute')} ${pt('dayPeriod').toUpperCase()}`;
      // Web parity: only a still-pending entry is flipped — never re-stamp completed/superseded audit fields.
      const followUps = existing.map((e) => (target && e.id === target.id && e.status === 'pending' ? { ...e, status: 'done' as const, completed_at: nowIso, completed_by: input.profile?.id ?? null, completed_by_name: authorName, completion_note: manual || null } : e));
      const remarkText = manual ? `Follow-up done on ${label} — ${manual}` : `Follow-up done on ${label}`;
      const remarks: RemarkEntry[] = [...(Array.isArray((cur as any)?.remarks) ? (cur as any).remarks : []), { id: uuidv4(), text: remarkText, date: nowIso, author_id: input.profile?.id ?? null, author_name: authorName }];
      const { data, error } = await supabase.from('leads')
        .update({ next_follow_up_at: null, next_follow_up_note: null, follow_ups: followUps, remarks, remark: remarkText })
        .eq('id', input.leadId).select(LEAD_SELECT).single();
      if (error) throw new Error(error.message);
      return data as Lead;
    },
    onSuccess: () => invalidateLeads(qc),
  });
}
export function useToggleLeadSpam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc('toggle_lead_spam', { _lead_id: id });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => invalidateLeads(qc),
  });
}
export function useMarkLeadAsApplicant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; candidateType: string }) => {
      const { error } = await supabase.from('leads').update({ applicant_lead: { date: new Date().toISOString(), candidate_type: input.candidateType } }).eq('id', input.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => invalidateLeads(qc),
  });
}
/* Add a remark (web MarkLost/remark pattern: append to remarks[] + mirror latest into remark). */
export function useAddLeadRemark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { lead: Lead; text: string; profile: any; extraPatch?: Record<string, any> }) => {
      const trimmed = input.text.trim();
      if (trimmed.length < 3) throw new Error('Remark must be at least 3 characters.');
      // Web parity (2026-08): every new remark entry carries a stable uuid.
      const entry: RemarkEntry = { id: uuidv4(), text: trimmed, date: new Date().toISOString(), author_id: input.profile?.id ?? null, author_name: profileName(input.profile) ?? 'You' };
      const remarks = [...(Array.isArray(input.lead.remarks) ? input.lead.remarks : []), entry];
      const { data, error } = await supabase.from('leads').update({ remarks, remark: trimmed, ...(input.extraPatch ?? {}) }).eq('id', input.lead.id).select(LEAD_SELECT).single();
      if (error) throw new Error(error.message);
      return data as Lead;
    },
    onSuccess: () => invalidateLeads(qc),
  });
}
/* Converted (with linked client): write package to clients FIRST, then flip the lead.
   Web parity (2026-08): once client_id is linked, carry any lead-level couple
   marking over to clients.training_partner_id (best-effort). Returns the sync
   status ('linked' | 'already_linked' | 'pending_partner' | null). */
export function useConvertWithPackage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { lead: Lead; clientPatch: { session_package: string; package_amount: number; sessions_per_cycle: number; package_duration: string; cycle_type: string }; convertedAt: string; profile: any }): Promise<string | null> => {
      const { error: cErr } = await supabase.from('clients').update(input.clientPatch).eq('id', input.lead.client_id);
      if (cErr) throw new Error(cErr.message);
      const { error } = await supabase.from('leads').update({ stage: 'Converted', converted_at: input.convertedAt, converted_by: input.lead.converted_by ?? input.profile?.id ?? null }).eq('id', input.lead.id);
      if (error) throw new Error(error.message);
      if (input.lead.partner_lead_id) {
        try {
          const { data } = await supabase.rpc('sync_lead_partner_to_clients', { _lead_id: input.lead.id });
          return (data as string) ?? null;
        } catch { return null; }
      }
      return null;
    },
    onSuccess: () => invalidateLeads(qc),
  });
}
export function useDeleteLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('leads').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => invalidateLeads(qc),
  });
}

/* ---------------- lead_options (influencer / ads_creative lists) ---------------- */
export function useLeadOptions(type: 'influencer' | 'ads_creative') {
  return useQuery({
    queryKey: ['lead-options', type],
    staleTime: 60_000,
    queryFn: async (): Promise<{ id: string; name: string }[]> => {
      const { data, error } = await supabase.from('lead_options').select('id,name').eq('type', type).order('name', { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as any[];
    },
  });
}
export function useAddLeadOption() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { type: 'influencer' | 'ads_creative'; name: string; profileId: string | null }) => {
      const name = input.name.trim();
      if (!name) throw new Error('Name is required.');
      const { data, error } = await supabase.from('lead_options').insert({ type: input.type, name, created_by: input.profileId }).select('id,name').single();
      if (error) throw new Error(error.code === '23505' ? 'That name is already in the list.' : error.message);
      return data;
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['lead-options', v.type] }),
  });
}
export function useDeleteLeadOption() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; type: 'influencer' | 'ads_creative' }) => {
      const { error } = await supabase.from('lead_options').delete().eq('id', input.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['lead-options', v.type] }),
  });
}

/* ---------------- follow-up reminders (dashboard banner) ---------------- */
export type FollowUpReminder = { id: string; name: string; contact_no: string | null; stage: string; next_follow_up_at: string; next_follow_up_note: string | null; overdue: boolean; follow_ups: FollowUpEntry[] };
export function useOpsFollowUpReminders(enabled: boolean) {
  return useQuery({
    queryKey: ['ops-followup-reminders'],
    enabled,
    staleTime: 60_000,
    refetchInterval: 60_000,
    queryFn: async (): Promise<FollowUpReminder[]> => {
      const horizon = new Date(Date.now() + 24 * 3600e3).toISOString();
      const { data, error } = await supabase.from('leads')
        .select('id,name,contact_no,stage,next_follow_up_at,next_follow_up_note,follow_ups')
        .not('next_follow_up_at', 'is', null).lte('next_follow_up_at', horizon)
        .neq('stage', 'Converted').neq('stage', 'Lost')
        .order('next_follow_up_at', { ascending: true });
      if (error) throw new Error(error.message);
      const now = Date.now();
      return ((data ?? []) as any[]).map((r) => ({ ...r, overdue: new Date(r.next_follow_up_at).getTime() < now, follow_ups: Array.isArray(r.follow_ups) ? r.follow_ups : [] }));
    },
  });
}
