import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { supabase } from './supabase';

/* ============ Ops — Leads pipeline (web src/hooks/useLeads.ts port) ============
   All contracts extracted verbatim from the web app: LEAD_SELECT, stage list,
   filter building, stats formulas, follow-up/remark jsonb shapes, permissions.
   Verified live: leads readable (957 rows), get_cold_lead_ids works (378 ids). */

export const LEAD_SELECT = 'id,name,contact_no,source,lead_date,stage,stage_history,description,created_by,created_by_role,created_at,updated_at,client_id,converted_at,converted_by,remark,remarks,qhp_pref_date,qhp_pref_time_from,qhp_pref_time_to,qhp_pref_location,qhp_pref_notes,next_follow_up_at,next_follow_up_note,follow_ups,influencer,ads_creative,referral_name,qhp_booked_by,qhp_booked_by_role,invoice_details,category,qualified_lead_criteria,applicant_lead,is_spam,spam_history';

export const LEAD_STAGES = ['New', 'Potential', 'Not Picked', 'Follow Up', 'QHP Booked', 'Trail', 'Raise invoice', 'Converted', 'Refunded', 'Lost'] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];
export const LEAD_SOURCES = ['Direct', 'Instagram', 'Referral', 'Influencer', 'Google Form', 'Website Form Instagram', 'WhatsApp', 'Website'] as const;
export const CANDIDATE_TYPES = ['Trainer', 'Marketing', 'Sales', 'Physiotherapist'] as const;
export const SUBSCRIPTION_TYPES = ['Staff', 'Opportunity', 'Trial', 'Odds basic', 'Odds plus', 'Odds pro', 'Odds lux', 'Odds Prive', 'Odds APEX', 'Odds generation', 'Virtual Training', 'Influencer'] as const;

export type Lead = Record<string, any> & { id: string; name: string; stage: string };
export type FollowUpEntry = { id: string; scheduled_at: string; note: string | null; status: 'pending' | 'done' | 'superseded'; created_at: string; created_by?: string | null; created_by_name?: string | null; completed_at?: string; completed_by?: string | null; completed_by_name?: string | null; completion_note?: string | null };
export type RemarkEntry = { text: string; date: string; author_id?: string | null; author_name?: string | null };

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
  applicantLeadsOnly?: boolean; spamOnly?: boolean;
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
      let q: any = supabase.from('leads').select(LEAD_SELECT, { count: 'exact' });
      const s = (filters.search ?? '').trim().replace(/%/g, '');
      if (s) q = q.or(`name.ilike.%${s}%,contact_no.ilike.%${s}%`);
      if (filters.stages?.length) q = q.in('stage', filters.stages);
      if (filters.sources?.length) q = q.in('source', filters.sources);
      if (filters.categories?.length) q = q.in('category', filters.categories);
      if (filters.dateFrom) q = q.gte('lead_date', filters.dateFrom);
      if (filters.dateTo) q = q.lte('lead_date', filters.dateTo);
      if (filters.onlyIds) q = q.in('id', filters.onlyIds);
      q = filters.applicantLeadsOnly ? q.not('applicant_lead', 'is', null) : q.is('applicant_lead', null);
      if (filters.spamOnly) q = q.eq('is_spam', true);
      else q = q.eq('is_spam', false);
      const sortBy = filters.sortBy ?? 'created_at';
      q = q.order(sortBy, { ascending: filters.sortDir === 'asc' });
      const page = filters.page ?? 1;
      const pageSize = filters.pageSize ?? 25;
      const from = (page - 1) * pageSize;
      q = q.range(from, from + pageSize - 1);
      const { data, error, count } = await q;
      if (error) throw new Error(error.message);
      return { rows: (data ?? []) as Lead[], total: count ?? 0 };
    },
  });
}

/* ---------------- stats (web useLeadStats — exact formulas) ---------------- */
export type LeadStats = { total: number; newThisWeek: number; thisMonth: number; converted: number; conversionRate: number; activePipeline: number };
const istYm = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).format(d).slice(0, 7);
export function useLeadStats() {
  return useQuery({
    queryKey: ['leads-stats'],
    staleTime: 60_000,
    queryFn: async (): Promise<LeadStats> => {
      const { data, error } = await supabase.from('leads').select('stage,created_at,lead_date').is('applicant_lead', null).eq('is_spam', false).limit(10000);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as any[];
      const weekAgo = Date.now() - 7 * 864e5;
      const curYm = istYm(new Date());
      const total = rows.length;
      const converted = rows.filter((r) => r.stage === 'Converted').length;
      return {
        total,
        newThisWeek: rows.filter((r) => new Date(r.created_at).getTime() >= weekAgo).length,
        thisMonth: rows.filter((r) => (r.lead_date ? r.lead_date.slice(0, 7) : istYm(new Date(r.created_at))) === curYm).length,
        converted,
        conversionRate: total > 0 ? Math.round((converted / total) * 100) : 0,
        activePipeline: rows.filter((r) => r.stage === 'New' || r.stage === 'Potential' || r.stage === 'QHP Booked').length,
      };
    },
  });
}
export function useColdLeads() {
  return useQuery({
    queryKey: ['leads-cold-count'],
    staleTime: 60_000,
    queryFn: async (): Promise<{ count: number; ids: string[] }> => {
      const { data, error } = await supabase.rpc('get_cold_lead_ids', { _days: 5 });
      if (error) throw new Error(error.message);
      const ids = ((data ?? []) as any[]).map((r) => (typeof r === 'string' ? r : r.id)).filter(Boolean);
      return { count: ids.length, ids };
    },
  });
}

/* ---------------- mutations ---------------- */
const invalidateLeads = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: ['leads'] });
  qc.invalidateQueries({ queryKey: ['leads-stats'] });
  qc.invalidateQueries({ queryKey: ['leads-cold-count'] });
  qc.invalidateQueries({ queryKey: ['ops-followup-reminders'] });
};
export function useCreateLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; contact_no: string; source: string; lead_date: string; stage: string; description?: string | null; influencer?: string | null; ads_creative?: string | null; referral_name?: string | null; profile: any }) => {
      const p = input.profile;
      const payload = {
        name: input.name.trim(), contact_no: input.contact_no, source: input.source, lead_date: input.lead_date, stage: input.stage,
        description: input.description ?? null,
        influencer: input.source === 'Influencer' ? input.influencer ?? null : null,
        ads_creative: input.source === 'Instagram' ? input.ads_creative ?? null : null,
        referral_name: input.source === 'Referral' ? (input.referral_name ?? '').trim() || null : null,
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
      const remarks: RemarkEntry[] = [...(Array.isArray((cur as any)?.remarks) ? (cur as any).remarks : []), { text: remarkText, date: nowIso, author_id: input.profile?.id ?? null, author_name: authorName }];
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
      const entry: RemarkEntry = { text: trimmed, date: new Date().toISOString(), author_id: input.profile?.id ?? null, author_name: profileName(input.profile) ?? 'You' };
      const remarks = [...(Array.isArray(input.lead.remarks) ? input.lead.remarks : []), entry];
      const { data, error } = await supabase.from('leads').update({ remarks, remark: trimmed, ...(input.extraPatch ?? {}) }).eq('id', input.lead.id).select(LEAD_SELECT).single();
      if (error) throw new Error(error.message);
      return data as Lead;
    },
    onSuccess: () => invalidateLeads(qc),
  });
}
/* Converted (with linked client): write package to clients FIRST, then flip the lead. */
export function useConvertWithPackage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { lead: Lead; clientPatch: { session_package: string; package_amount: number; sessions_per_cycle: number; package_duration: string; cycle_type: string }; convertedAt: string; profile: any }) => {
      const { error: cErr } = await supabase.from('clients').update(input.clientPatch).eq('id', input.lead.client_id);
      if (cErr) throw new Error(cErr.message);
      const { error } = await supabase.from('leads').update({ stage: 'Converted', converted_at: input.convertedAt, converted_by: input.lead.converted_by ?? input.profile?.id ?? null }).eq('id', input.lead.id);
      if (error) throw new Error(error.message);
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
