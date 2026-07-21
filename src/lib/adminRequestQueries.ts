import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';

/* ============ Admin — Requests page (referrals + upgrade/renewal/cross-sell approvals) ============
   Ports of web useReferrals.ts, useSubscriptionUpgradeRequests.ts, useAdminRenewalRequests.ts,
   useAdminCrossSellRequests.ts. Every approval also credits the requester via incentive_events
   (insert errors are console-logged, not thrown — web parity). */

type NameRow = { first_name: string | null; last_name: string | null };
export const personName = (p: NameRow | null | undefined) => `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || '—';

const insertIncentive = async (table: string, requestId: string, eventType: string, clientId: string | null) => {
  const { data: request } = await supabase.from(table).select('requested_by').eq('id', requestId).single();
  if ((request as any)?.requested_by) {
    const { error } = await supabase.from('incentive_events').insert({
      user_id: (request as any).requested_by, event_type: eventType, client_id: clientId,
      reference_id: requestId, reference_table: table,
    });
    if (error) console.warn('Failed to create incentive event:', error.message);
  }
};

/* ---------------- Referrals (web useAdminReferrals / useUpdateReferralStatus) ---------------- */
export type Referral = {
  id: string; referred_client_name: string; referred_client_phone: string | null; referred_client_email: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'converted'; created_at: string; notes: string | null; rejection_reason: string | null;
  referrer: (NameRow & { role: string | null }) | null;
};
export function useAdminReferrals() {
  return useQuery({
    queryKey: ['admin-referrals'],
    staleTime: 30_000,
    queryFn: async (): Promise<Referral[]> => {
      const { data, error } = await supabase.from('referrals')
        .select('*, referrer:profiles!referrer_id(first_name, last_name, role)')
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as any[] as Referral[];
    },
  });
}
export function useUpdateReferralStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { referralId: string; status: 'approved' | 'rejected'; rejectionReason?: string; profileId: string | null }) => {
      if (!input.profileId) throw new Error('Not authenticated');
      const patch: Record<string, unknown> = { status: input.status, approved_by: input.profileId, approved_at: new Date().toISOString() };
      if (input.status === 'rejected' && input.rejectionReason) patch.rejection_reason = input.rejectionReason;
      const { error } = await supabase.from('referrals').update(patch).eq('id', input.referralId);
      if (error) throw new Error(error.message);
      if (input.status === 'approved') {
        const { data: referral } = await supabase.from('referrals').select('referrer_id, referred_client_id').eq('id', input.referralId).single();
        if (referral) {
          const { error: iErr } = await supabase.from('incentive_events').insert({
            user_id: (referral as any).referrer_id, client_id: (referral as any).referred_client_id,
            event_type: 'referral', reference_id: input.referralId, reference_table: 'referrals',
          });
          if (iErr) console.warn('Failed to create incentive event:', iErr.message);
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-referrals'] });
      qc.invalidateQueries({ queryKey: ['referrals'] });
      qc.invalidateQueries({ queryKey: ['incentive-metrics'] });
    },
  });
}

/* ---------------- Subscription upgrades (table client_subscription_history) ---------------- */
export type UpgradeRequest = {
  id: string; client_id: string; previous_subscription_type: string | null; new_subscription_type: string;
  change_reason: string | null; status: string; admin_notes: string | null; reviewed_at: string | null; created_at: string;
  client: NameRow | null; requester: NameRow | null;
};
export function useAdminUpgradeRequests() {
  return useQuery({
    queryKey: ['admin-subscription-upgrade-requests'],
    staleTime: 30_000,
    queryFn: async (): Promise<UpgradeRequest[]> => {
      const { data, error } = await supabase.from('client_subscription_history')
        .select('*, client:clients!client_id (first_name, last_name), requester:profiles!requested_by (first_name, last_name)')
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as any[] as UpgradeRequest[];
    },
  });
}
/* Approve flips the client's live subscription_type (web parity). */
export function useUpdateUpgradeStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { requestId: string; status: 'approved' | 'rejected'; adminNotes?: string; clientId: string; newSubscriptionType: string; profileId: string | null }) => {
      if (!input.profileId) throw new Error('Not authenticated');
      const { error } = await supabase.from('client_subscription_history')
        .update({ status: input.status, admin_notes: input.adminNotes || null, changed_by: input.profileId, reviewed_at: new Date().toISOString() })
        .eq('id', input.requestId);
      if (error) throw new Error(error.message);
      if (input.status === 'approved') {
        const { error: cErr } = await supabase.from('clients').update({ subscription_type: input.newSubscriptionType }).eq('id', input.clientId);
        if (cErr) throw new Error(cErr.message);
        await insertIncentive('client_subscription_history', input.requestId, 'subscription_upgrade', input.clientId);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-subscription-upgrade-requests'] });
      qc.invalidateQueries({ queryKey: ['incentive-leaderboard'] });
    },
  });
}

/* ---------------- Client renewal requests (table client_renewals) ---------------- */
export type RenewalRequest = {
  id: string; client_id: string | null; request_status: string | null;
  previous_package: string | null; new_package: string | null;
  package_amount: number | null; package_duration: number | null; package_sessions: number | null;
  cycle_type: string | null; admin_notes: string | null; approved_at: string | null; created_at: string | null;
  client: NameRow | null; requester: NameRow | null;
};
export function useAdminRenewalRequests() {
  return useQuery({
    queryKey: ['admin-renewal-requests'],
    staleTime: 30_000,
    queryFn: async (): Promise<RenewalRequest[]> => {
      const { data, error } = await supabase.from('client_renewals')
        .select('*, client:clients!client_id (first_name, last_name), requester:profiles!requested_by (first_name, last_name)')
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as any[] as RenewalRequest[];
    },
  });
}
/* Approve also stamps renewed_at = now (starts the new package clock). */
export function useUpdateRenewalRequestStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { requestId: string; status: 'approved' | 'rejected'; adminNotes?: string; clientId: string | null; profileId: string | null }) => {
      if (!input.profileId) throw new Error('Not authenticated');
      const patch: Record<string, any> = {
        request_status: input.status, admin_notes: input.adminNotes || null,
        approved_by: input.profileId, approved_at: new Date().toISOString(),
      };
      if (input.status === 'approved') patch.renewed_at = new Date().toISOString();
      const { error } = await supabase.from('client_renewals').update(patch).eq('id', input.requestId);
      if (error) throw new Error(error.message);
      if (input.status === 'approved') await insertIncentive('client_renewals', input.requestId, 'renewal', input.clientId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-renewal-requests'] });
      qc.invalidateQueries({ queryKey: ['incentive-leaderboard'] });
      qc.invalidateQueries({ queryKey: ['admin-clients-basic-info'] });
      qc.invalidateQueries({ queryKey: ['admin-renewal-opportunities'] });
    },
  });
}

/* ---------------- Cross-sell package requests (table client_packages) ---------------- */
export type CrossSellRequest = {
  id: string; client_id: string; request_status: string | null; service_name: string | null;
  sessions_total: number; start_date: string; expiry_date: string;
  admin_notes: string | null; approved_at: string | null; created_at: string;
  client: NameRow | null; requester: NameRow | null;
};
export function useAdminCrossSellRequests() {
  return useQuery({
    queryKey: ['admin-cross-sell-requests'],
    staleTime: 30_000,
    queryFn: async (): Promise<CrossSellRequest[]> => {
      const { data, error } = await supabase.from('client_packages')
        .select('*, client:clients!client_id (first_name, last_name), requester:profiles!requested_by (first_name, last_name)')
        .not('request_status', 'is', null)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as any[] as CrossSellRequest[];
    },
  });
}
/* Approve also activates the package (status='active'). */
export function useUpdateCrossSellStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { requestId: string; status: 'approved' | 'rejected'; adminNotes?: string; clientId: string; profileId: string | null }) => {
      if (!input.profileId) throw new Error('Not authenticated');
      const patch: Record<string, any> = {
        request_status: input.status, admin_notes: input.adminNotes || null,
        approved_by: input.profileId, approved_at: new Date().toISOString(),
      };
      if (input.status === 'approved') patch.status = 'active';
      const { error } = await supabase.from('client_packages').update(patch).eq('id', input.requestId);
      if (error) throw new Error(error.message);
      if (input.status === 'approved') await insertIncentive('client_packages', input.requestId, 'cross_sell', input.clientId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-cross-sell-requests'] });
      qc.invalidateQueries({ queryKey: ['incentive-leaderboard'] });
    },
  });
}

/* ================= New Leads / Ref Leads / Renewal Pay / Invoice Raised / Paid Cancel ================= */

const QHP_BOOKED_CUTOFF_MS = new Date('2026-05-30T18:30:00.000Z').getTime(); // 2026-05-31 00:00 IST
export type AdminNewLead = { id: string; name: string; contact_no: string | null; stage: string; source: string | null; lead_date: string | null; client_id: string | null; invoice_details: any };
/* Full rows behind "New Leads — Awaiting Client Creation" (same filter as the dashboard alert). */
export function useAdminNewLeadRows() {
  return useQuery({
    queryKey: ['admin-new-lead-rows'],
    refetchInterval: 30_000,
    staleTime: 0,
    queryFn: async (): Promise<AdminNewLead[]> => {
      const { data, error } = await supabase.from('leads')
        .select('id, name, contact_no, stage, stage_history, updated_at, invoice_details, client_id, source, lead_date')
        .in('stage', ['QHP Booked', 'Raise invoice']).is('client_id', null)
        .order('updated_at', { ascending: false });
      if (error) throw new Error(error.message);
      const bookedAt = (l: any): number | null => {
        const es = (Array.isArray(l.stage_history) ? l.stage_history : []).filter((h: any) => h?.stage === 'QHP Booked' && h?.at);
        if (es.length) return es.reduce((m: number, h: any) => Math.max(m, new Date(h.at).getTime()), 0);
        return l.updated_at ? new Date(l.updated_at).getTime() : null;
      };
      return ((data ?? []) as any[]).filter((l) => l.stage === 'Raise invoice' || (bookedAt(l) !== null && (bookedAt(l) as number) >= QHP_BOOKED_CUTOFF_MS));
    },
  });
}
/* "Add as Client" (web ClientForm + useMarkLeadConverted, minimal-field port): the new client
   REUSES the lead's uuid (forcedClientId), then the lead is linked (stage untouched) and the
   QHP-Booked notify edge fn fires best-effort. */
export function useConvertLeadToClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { lead: AdminNewLead; firstName: string; lastName: string; email: string; phone: string; goal: string; profileId: string | null }) => {
      if (!input.firstName.trim() || !input.email.trim()) throw new Error('First name and email are required.');
      const { data: newClient, error } = await supabase.from('clients').insert({
        id: input.lead.id,
        first_name: input.firstName.trim(), last_name: input.lastName.trim() || null,
        email: input.email.trim(), phone: input.phone.trim() || null, goal: input.goal.trim() || null,
        status: 'active', is_hybrid: false, is_odds_converted: false, client_type: 'B2B',
      } as any).select().single();
      if (error) throw new Error(error.message);
      const { error: lErr } = await supabase.from('leads')
        .update({ client_id: (newClient as any).id, converted_at: new Date().toISOString(), converted_by: input.profileId })
        .eq('id', input.lead.id);
      if (lErr) throw new Error(lErr.message);
      if (input.lead.stage === 'QHP Booked') {
        supabase.functions.invoke('notify-new-client-card', { body: { client_id: (newClient as any).id } })
          .catch((e) => console.warn('notify-new-client-card failed', e));
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-new-lead-rows'] });
      qc.invalidateQueries({ queryKey: ['admin-new-leads'] });
      qc.invalidateQueries({ queryKey: ['admin-invoice-raised'] });
      qc.invalidateQueries({ queryKey: ['leads'] });
    },
  });
}

/* ---------------- Referred leads (table referred_leads) ---------------- */
export const REF_LEAD_STATUSES = ['new', 'contacted', 'qualified', 'qhp_scheduled', 'converted', 'rejected'] as const;
export type ReferredLead = { id: string; name: string | null; phone_no: string | null; coupon: string | null; status: string; created_at: string };
export function useReferredLeads() {
  return useQuery({
    queryKey: ['referred-leads'],
    staleTime: 30_000,
    queryFn: async (): Promise<ReferredLead[]> => {
      const { data, error } = await supabase.from('referred_leads').select('*').order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      // Web parity: null/''/'pending' normalize to 'new'.
      return ((data ?? []) as any[]).map((l) => ({ ...l, status: !l.status || l.status === 'pending' ? 'new' : l.status }));
    },
  });
}
export function useUpdateReferredLeadStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; status: string }) => {
      const { error } = await supabase.from('referred_leads').update({ status: input.status }).eq('id', input.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['referred-leads'] }),
  });
}
/* Ref-lead "Add Client": plain client insert (no forced id), then lead status → converted. */
export function useAddReferredClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { leadId: string; firstName: string; lastName: string; email: string; phone: string; goal: string }) => {
      if (!input.firstName.trim() || !input.email.trim()) throw new Error('First name and email are required.');
      const { error } = await supabase.from('clients').insert({
        first_name: input.firstName.trim(), last_name: input.lastName.trim() || null,
        email: input.email.trim(), phone: input.phone.trim() || null, goal: input.goal.trim() || null,
        status: 'active', is_hybrid: false, is_odds_converted: false, client_type: 'B2B',
      } as any);
      if (error) throw new Error(error.message);
      const { error: sErr } = await supabase.from('referred_leads').update({ status: 'converted' }).eq('id', input.leadId);
      if (sErr) throw new Error(sErr.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['referred-leads'] }),
  });
}

/* ---------------- Renewal payment requests (table renewal_payment_requests) ---------------- */
export type RenewalPayRequest = {
  id: string; client_id: string | null; admin_decision: string | null;
  payment_status: string | null; payment_method: string | null;
  new_subscription_type: string | null; new_sessions_per_cycle: number | null; new_cycle_type: string | null; new_package_amount: number | null;
  package_duration: number | null; cash_reference: string | null; paid_at: string | null; created_at: string | null; request_notes: string | null;
  client: NameRow | null; requester: NameRow | null;
};
export function useRenewalPayRequests() {
  return useQuery({
    queryKey: ['admin-renewal-pay-requests'],
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async (): Promise<RenewalPayRequest[]> => {
      const { data, error } = await supabase.from('renewal_payment_requests')
        .select('*, client:clients!client_id (first_name, last_name), requester:profiles!requested_by (first_name, last_name)')
        .or('request_notes.is.null,request_notes.not.ilike.%"kind":"additional_package%')
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as any[] as RenewalPayRequest[];
    },
  });
}
export function useDecideRenewalPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { requestId: string; decision: 'approved' | 'rejected'; adminNotes?: string; profileId: string | null }) => {
      if (!input.profileId) throw new Error('Not authenticated');
      const { error } = await supabase.from('renewal_payment_requests')
        .update({ admin_decision: input.decision, admin_id: input.profileId, admin_notes: input.adminNotes ?? null })
        .eq('id', input.requestId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-renewal-pay-requests'] }),
  });
}
/* Mark cash/bank-transfer received — backend trigger applies the package update. */
export function useMarkRenewalCashPaid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { requestId: string; cashReference: string | null }) => {
      const { error } = await supabase.from('renewal_payment_requests')
        .update({ payment_status: 'paid', paid_at: new Date().toISOString(), cash_reference: input.cashReference })
        .eq('id', input.requestId)
        .in('payment_method', ['cash', 'bank_transfer']);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-renewal-pay-requests'] }),
  });
}

/* ---------------- Invoice raised — generate the payment ---------------- */
export type InvoiceRaisedLead = { id: string; name: string; contact_no: string | null; client_id: string | null; invoice_details: any; updated_at: string | null };
export function useInvoiceRaisedRows() {
  return useQuery({
    queryKey: ['admin-invoice-raised-rows'],
    refetchInterval: 30_000,
    queryFn: async (): Promise<InvoiceRaisedLead[]> => {
      const { data, error } = await supabase.from('leads')
        .select('id, name, contact_no, client_id, invoice_details, updated_at')
        .eq('stage', 'Raise invoice').not('invoice_details', 'is', null).not('client_id', 'is', null)
        .order('updated_at', { ascending: false });
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as any[];
      if (!rows.length) return [];
      const clientIds = [...new Set(rows.map((l) => l.client_id).filter(Boolean))];
      const busy = new Set<string>();
      if (clientIds.length) {
        const { data: reqs } = await supabase.from('renewal_payment_requests')
          .select('client_id, payment_status').in('client_id', clientIds).ilike('request_notes', '%"kind":"lead_invoice"%');
        (reqs ?? []).forEach((r: any) => { if (['awaiting_approval', 'awaiting_payment', 'failed', 'paid'].includes(r.payment_status)) busy.add(r.client_id); });
      }
      return rows.filter((l) => !l.client_id || !busy.has(l.client_id));
    },
  });
}
export type LeadInvoiceRequest = {
  id: string; client_id: string | null; leadName: string | null; new_subscription_type: string | null;
  new_package_amount: number | null; session_package: number | null; payment_method: string | null;
  payment_status: string; paid_at: string | null; created_at: string | null; cash_reference: string | null; opsNotes: string | null;
};
export function useLeadInvoiceRequests() {
  return useQuery({
    queryKey: ['lead-invoice-requests'],
    refetchInterval: 30_000,
    queryFn: async (): Promise<LeadInvoiceRequest[]> => {
      const { data, error } = await supabase.from('renewal_payment_requests')
        .select('id, client_id, new_subscription_type, new_sessions_per_cycle, new_package_amount, new_cycle_type, package_duration, session_package, payment_method, payment_status, paid_at, created_at, cash_reference, request_notes')
        .ilike('request_notes', '%"kind":"lead_invoice"%')
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as any[];
      const leadIds = rows.map((r) => { try { return JSON.parse(r.request_notes)?.lead_id ?? null; } catch { return null; } });
      const uniq = [...new Set(leadIds.filter(Boolean))];
      const nameMap = new Map<string, string>();
      if (uniq.length) {
        const { data: leads } = await supabase.from('leads').select('id, name').in('id', uniq);
        (leads ?? []).forEach((l: any) => nameMap.set(l.id, l.name));
      }
      return rows.map((r, i) => {
        let opsNotes: string | null = null;
        try { opsNotes = JSON.parse(r.request_notes)?.ops_notes ?? null; } catch {}
        return { ...r, leadName: leadIds[i] ? nameMap.get(leadIds[i]) ?? null : null, opsNotes };
      });
    },
  });
}
const todayIstYmd = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
/* Generate payment (web GenerateInvoicePaymentDialog): inserts an admin-approved
   awaiting_payment request; razorpay additionally invokes create-lead-razorpay-link
   (failure flips the row to 'failed' so it surfaces in Processing with Retry). */
export function useGenerateLeadPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { lead: InvoiceRaisedLead; method: 'razorpay' | 'cash' | 'bank_transfer'; profileId: string | null }): Promise<{ url: string | null }> => {
      if (!input.profileId) throw new Error('Not authenticated');
      const inv = input.lead.invoice_details ?? {};
      const sessionsNum = Number(inv.sessions_in_package) || 0;
      const amountNum = Number(inv.amount) || 0;
      if (!(sessionsNum > 0) || !(amountNum > 0)) throw new Error('Invoice details are incomplete.');
      const invMembers = Array.isArray(inv.generation_members) ? inv.generation_members : [];
      const notes = JSON.stringify({
        kind: 'lead_invoice', lead_id: input.lead.id, ops_notes: inv.notes ?? null,
        complimentary_sessions: inv.complimentary_sessions != null ? Number(inv.complimentary_sessions) : null,
        generation_admin_id: inv.generation_admin_id ?? null, generation_admin_name: inv.generation_admin_name ?? null,
        generation_member_id: invMembers[0]?.id ?? null, generation_member_name: invMembers[0]?.name ?? null,
        generation_members: invMembers,
      });
      const subscriptionType = inv.subscription_type ?? null;
      const { data: inserted, error } = await supabase.from('renewal_payment_requests').insert({
        client_id: input.lead.client_id,
        new_subscription_type: subscriptionType, new_sessions_per_cycle: sessionsNum,
        new_package_amount: amountNum, new_cycle_type: String(inv.cycle ?? 'Monthly').toLowerCase(),
        package_duration: parseInt(String(inv.duration ?? '')) || null, session_package: sessionsNum,
        cycle_start_date: todayIstYmd(), payment_method: input.method, payment_status: 'awaiting_payment',
        admin_decision: 'approved', admin_id: input.profileId, requested_by: input.profileId, request_notes: notes,
      } as any).select('id').single();
      if (error) throw new Error(error.message);
      if (subscriptionType === 'Odds generation' && input.lead.client_id && invMembers.length) {
        const { data: cur } = await supabase.from('clients').select('generation_members').eq('id', input.lead.client_id).single();
        const merged = [...new Set([...(Array.isArray((cur as any)?.generation_members) ? (cur as any).generation_members : []), ...invMembers.map((m: any) => m.id).filter(Boolean)])];
        await supabase.from('clients').update({ generation_admin: true, generation_members: merged }).eq('id', input.lead.client_id);
      }
      if (input.method === 'razorpay') {
        const { data: res, error: fnErr } = await supabase.functions.invoke('create-lead-razorpay-link', { body: { request_id: (inserted as any).id } });
        const errMsg = fnErr?.message || (res as any)?.error;
        if (errMsg) {
          await supabase.from('renewal_payment_requests').update({ payment_status: 'failed' }).eq('id', (inserted as any).id);
          throw new Error(errMsg);
        }
        return { url: (res as any)?.url ?? null };
      }
      return { url: null };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-invoice-raised-rows'] });
      qc.invalidateQueries({ queryKey: ['admin-invoice-raised'] });
      qc.invalidateQueries({ queryKey: ['lead-invoice-requests'] });
    },
  });
}
export function useRetryRazorpayLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (requestId: string): Promise<{ url: string | null }> => {
      const { data: res, error } = await supabase.functions.invoke('create-lead-razorpay-link', { body: { request_id: requestId } });
      const errMsg = error?.message || (res as any)?.error;
      if (errMsg) throw new Error(errMsg);
      return { url: (res as any)?.url ?? null };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lead-invoice-requests'] }),
  });
}
export function useMarkLeadInvoicePaid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (requestId: string) => {
      const { error } = await supabase.from('renewal_payment_requests')
        .update({ payment_status: 'paid', paid_at: new Date().toISOString(), cash_reference: 'Marked received by admin' })
        .eq('id', requestId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lead-invoice-requests'] }),
  });
}

/* ---------------- Paid cancellation requests (table session_schedule) ---------------- */
export type PaidCancellation = {
  id: string; client_id: string | null; trainer_id: string | null; scheduled_datetime: string | null;
  session_type: string | null; modality: string | null; cancellation_remark: string | null;
  cancellation_attachment_url: string | null; admin_approval: string | null;
  client_name: string; trainer_name: string;
};
export function usePaidCancellations(filter: 'pending' | 'all') {
  return useQuery({
    queryKey: ['paid-cancellation-requests', filter],
    staleTime: 30_000,
    queryFn: async (): Promise<PaidCancellation[]> => {
      let q = supabase.from('session_schedule').select('*').eq('paid_cancellation', true).order('updated_at', { ascending: false });
      if (filter === 'pending') q = q.eq('admin_approval', 'pending');
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as any[];
      const clientIds = [...new Set(rows.map((r) => r.client_id).filter(Boolean))];
      const trainerIds = [...new Set(rows.map((r) => r.trainer_id).filter(Boolean))];
      const [{ data: cls }, { data: trs }] = await Promise.all([
        clientIds.length ? supabase.from('clients').select('id, first_name, last_name').in('id', clientIds) : Promise.resolve({ data: [] } as any),
        trainerIds.length ? supabase.from('profiles').select('id, first_name, last_name').in('id', trainerIds) : Promise.resolve({ data: [] } as any),
      ]);
      const cMap = new Map((cls ?? []).map((c: any) => [c.id, personName(c)]));
      const tMap = new Map((trs ?? []).map((t: any) => [t.id, personName(t)]));
      return rows.map((r) => ({ ...r, client_name: cMap.get(r.client_id) ?? 'Unknown Client', trainer_name: tMap.get(r.trainer_id) ?? 'Unknown Trainer' }));
    },
  });
}
/* Approve = INSERT a cancelled paid training_sessions record, then flag the schedule row. */
export function useApprovePaidCancellation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (request: PaidCancellation) => {
      const { error: insertError } = await supabase.from('training_sessions').insert({
        client_id: request.client_id, trainer_id: request.trainer_id, scheduled_at: request.scheduled_datetime,
        session_type: request.session_type || request.modality || 'training', location: request.modality || 'N/A',
        status: 'cancelled', cancelled: true, paid_cancellation: true,
        notes: request.cancellation_remark, attachment_url: request.cancellation_attachment_url,
        schedule_session_id: request.id,
      } as any);
      if (insertError) throw new Error(insertError.message);
      const { error } = await supabase.from('session_schedule').update({ admin_approval: 'approved' }).eq('id', request.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['paid-cancellation-requests'] }),
  });
}
export function useRejectPaidCancellation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('session_schedule').update({ admin_approval: 'rejected' }).eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['paid-cancellation-requests'] }),
  });
}
