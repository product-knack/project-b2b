import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';

/* ============ Ops — Sales Tracker data layer (web /ops/sales-tracker port) ============
   Faithful port of the web app's src/lib/opsSalesTracker.ts (pure derivation
   module) + src/hooks/useOpsDailySales.ts (queries/mutations).
   Differences from web, by design:
   - date-fns month labels replaced by monthLabelOf() (Intl; date-fns is not
     installed in this app).
   - fetchAllRows / fetchRowsByIdBatches are local (pages of 1000 via .range(),
     .in() id batches of 100) — mirror of the web's supabasePagination utils.
   - No toasts: mutations succeed silently (cache invalidation only) and throw
     Error(message) on failure; the screen surfaces failures with Alert. */

// ---------------------------------------------------------------------------
// Sales Tracker — DERIVED data model (read-only).
// Daily sales rows are no longer manually entered; they are derived from
// converted leads, client renewals and additional packages/service renewals.
// ---------------------------------------------------------------------------

// The tracker only considers business from this date onward.
export const SALES_TRACKER_START = '2026-04-01';

export type SaleType = 'new' | 'renewal' | 'addon';

export const SALE_TYPE_LABELS: Record<SaleType, string> = {
  new: 'New',
  renewal: 'Renewal',
  addon: 'Add-on',
};

export interface DerivedSaleRow {
  id: string; // `${type}-${sourceRowId}`
  type: SaleType;
  date: string | null; // ISO date of the paying event; null when unknown
  customerName: string;
  assignedTo: string | null; // uuid of salesperson/creator
  qhpBookedAt: string | null; // date of FIRST QHP booking; null = never booked (or n/a on renewal/addon rows)
  qhpCompletedAt: string | null; // date the assessment was completed; null = not completed (or n/a)
  converted: boolean | null; // true on "new" rows, null otherwise
  program: string | null;
  duration: string | null; // e.g. "3 months" or "3"
  gross: number;
  net: number;
  paymentMode: string | null; // display label: "Razorpay" | "Cash" | "Bank Transfer"
  status: string | null; // client account status: "Active" | "Inactive" | "Discontinued"; null when no linked client
  clientId: string | null;
  leadId: string | null;
}

// A new client's first package payment (from the clients table) or a collected
// QHP assessment fee — the only two revenue sources the monthly tab counts.
export interface MonthlyPaymentEvent {
  date: string; // ISO date
  amount: number;
  subscriptionType: string | null; // null for QHP fees
  paymentMode: string | null;
  source: 'client' | 'qhp';
}

// Row of the public.targets table: a conversion-count target valid for every
// month overlapping [start_date, end_date].
export interface SalesTargetRow {
  id: string;
  department: string | null;
  target: number;
  start_date: string;
  end_date: string;
  profile_id: string | null;
}

export interface ProgramBreakdown {
  program: string;
  count: number; // how many were sold that month
  revenue: number;
}

export interface MonthlySummary {
  monthKey: string;
  monthLabel: string;
  totalConversions: number; // converted leads that month
  conversionsWithoutPayment: number; // converted leads that month with no recorded payment (₹0)
  target: number | null; // conversion target covering this month (targets table)
  achievementPct: number | null; // totalConversions / target * 100
  grossRevenue: number; // new-client first payments + collected QHP fees
  totalDiscounts: number;
  netRevenue: number;
  highestSellingProgram: string | null; // "Subscription (count)"
  momGrowthPct: number | null;
  prevMonthNet: number | null; // previous month's net revenue (basis of MoM %)
  prevMonthLabel: string | null; // e.g. "Jul 2026"; null when no previous month in data
  topPaymentMode: string | null;
  programBreakdown: ProgramBreakdown[];
}

// ---------------------------------------------------------------------------
// Raw source-row shapes (match the columns selected below)
// ---------------------------------------------------------------------------

export interface LeadStageHistoryEntry {
  stage?: string | null;
  at?: string | null;
  by?: string | null;
}

export interface RawConvertedLead {
  id: string;
  name: string | null;
  assigned_to: string | null;
  converted_at: string | null;
  converted_by: string | null;
  client_id: string | null;
  stage: string | null;
  stage_history: LeadStageHistoryEntry[] | null;
  invoice_details: any;
  lead_type: string | null;
  is_spam: boolean | null;
  is_dump: boolean | null;
}

export interface RawClientLite {
  id: string;
  first_name: string | null;
  last_name: string | null;
  status: string | null;
  subscription_type: string | null;
  package_amount: number | null;
  package_duration: string | null;
}

export interface RawPaymentRequestLite {
  id: string;
  client_id: string | null;
  payment_method: string | null;
  payment_status: string | null;
  new_package_amount: number | null;
  paid_at: string | null;
  created_renewal_id: string | null;
  request_notes: string | null;
}

export interface DerivedRowsInput {
  leads: RawConvertedLead[];
  clientsById: Map<string, RawClientLite>;
  completedAtByClientId: Map<string, string>; // client_id -> coach_assessment.completed timestamp
  leadInvoiceRequestsByLeadId: Map<string, RawPaymentRequestLite>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  razorpay: 'Razorpay',
  cash: 'Cash',
  bank_transfer: 'Bank Transfer',
};

export const paymentModeLabel = (method: string | null | undefined): string | null => {
  if (!method) return null;
  return PAYMENT_METHOD_LABELS[method] ?? capitalize(method);
};

// Calendar day in IST (the business timezone). Date-only strings pass through
// unchanged; timestamps are converted so late-night events land on the right
// local day (mirrors the web useLeadStats' Asia/Kolkata handling).
const IST_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export const istDatePart = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return IST_DATE.format(d);
};

const datePart = istDatePart;

function capitalize(s: string): string {
  return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// "Apr 2026" from a "2026-04" month key — replaces the web's
// date-fns format(parseISO(`${key}-01`), 'MMM yyyy').
export const monthLabelOf = (monthKey: string): string => {
  const [y, m] = monthKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', {
    timeZone: 'UTC',
    month: 'short',
    year: 'numeric',
  });
};

// ₹ with Indian digit grouping, no decimals (web tables use
// toLocaleString('en-IN', { maximumFractionDigits: 0 })).
export const inr = (n: number | null | undefined): string =>
  n == null ? '-' : `₹${Math.round(Number(n)).toLocaleString('en-IN')}`;

const clientFullName = (c: RawClientLite | undefined): string | null => {
  if (!c) return null;
  const name = [c.first_name, c.last_name].filter(Boolean).join(' ').trim();
  return name || null;
};

const QHP_BOOKED_STAGES = new Set(['QHP Booked', 'Reschedule QHP', 'QHP Completed']);

const QHP_COMPLETED_STAGES = new Set(['QHP Completed']);

const earliestStageAt = (
  history: LeadStageHistoryEntry[] | null | undefined,
  stages: Set<string>
): string | null => {
  if (!Array.isArray(history)) return null;
  let min: string | null = null;
  for (const e of history) {
    if (typeof e?.stage === 'string' && stages.has(e.stage) && typeof e?.at === 'string' && e.at) {
      if (min === null || e.at < min) min = e.at;
    }
  }
  return min;
};

export const formatDurationMonths = (v: string | number | null | undefined): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    return `${n} ${n === 1 ? 'month' : 'months'}`;
  }
  return s;
};

const clientStatusLabel = (c: RawClientLite | undefined): string | null =>
  c?.status ? capitalize(c.status) : null;

// ---------------------------------------------------------------------------
// Row derivation (pure — ported verbatim from the web module)
// ---------------------------------------------------------------------------

export function buildDerivedRows(input: DerivedRowsInput): DerivedSaleRow[] {
  const rows: DerivedSaleRow[] = [];

  // --- NEW sales: one row per converted lead ---
  for (const lead of input.leads) {
    const client = lead.client_id ? input.clientsById.get(lead.client_id) : undefined;
    const inv = lead.invoice_details ?? null;
    const request = input.leadInvoiceRequestsByLeadId.get(lead.id) ?? null;

    const customerName = (lead.name && lead.name.trim()) || clientFullName(client) || 'Unknown';

    const qhpBookedAt = datePart(earliestStageAt(lead.stage_history, QHP_BOOKED_STAGES));
    const qhpCompletedAt = datePart(
      (lead.client_id != null ? input.completedAtByClientId.get(lead.client_id) : null) ??
        earliestStageAt(lead.stage_history, QHP_COMPLETED_STAGES)
    );

    const gross = Number(inv?.amount) || Number(client?.package_amount) || 0;

    const paidRequestAmount =
      request && request.payment_status === 'paid' ? Number(request.new_package_amount) : NaN;
    const netCandidate =
      !Number.isNaN(paidRequestAmount) && paidRequestAmount
        ? paidRequestAmount
        : Number(client?.package_amount) || gross;
    const net = netCandidate > 0 ? netCandidate : gross;

    rows.push({
      id: `new-${lead.id}`,
      type: 'new',
      date: datePart(lead.converted_at),
      customerName,
      assignedTo: lead.assigned_to ?? lead.converted_by ?? null,
      qhpBookedAt,
      qhpCompletedAt,
      converted: true,
      program: inv?.subscription_type ?? client?.subscription_type ?? null,
      duration: formatDurationMonths(client?.package_duration ?? inv?.duration),
      gross,
      net,
      paymentMode: paymentModeLabel(request?.payment_method),
      status: clientStatusLabel(client),
      clientId: lead.client_id ?? null,
      leadId: lead.id,
    });
  }

  // Sort: date DESC, nulls last.
  return rows.sort((a, b) => {
    if (a.date === null && b.date === null) return 0;
    if (a.date === null) return 1;
    if (b.date === null) return -1;
    return b.date.localeCompare(a.date);
  });
}

// ---------------------------------------------------------------------------
// Monthly summaries (pure — ported verbatim from the web module)
// ---------------------------------------------------------------------------

const prevMonthKey = (monthKey: string): string => {
  const [y, m] = monthKey.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
};

// The target whose [start_date, end_date] covers the given month; latest
// start_date wins when several overlap.
const targetForMonth = (monthKey: string, targets: SalesTargetRow[]): number | null => {
  const monthStart = `${monthKey}-01`;
  const monthEnd = `${monthKey}-31`;
  const covering = targets
    .filter((t) => t.start_date <= monthEnd && t.end_date >= monthStart)
    .sort((a, b) => b.start_date.localeCompare(a.start_date));
  return covering.length > 0 ? Number(covering[0].target) : null;
};

export function computeMonthlySummaries(
  conversionRows: DerivedSaleRow[], // daily rows; only type==="new" counts as a conversion
  payments: MonthlyPaymentEvent[], // new-client first payments + collected QHP fees
  targets: SalesTargetRow[] = [] // conversion targets (public.targets)
): MonthlySummary[] {
  const monthKeys = new Set<string>();
  const conversionsByMonth = new Map<string, number>();
  const unpaidConversionsByMonth = new Map<string, number>();
  for (const row of conversionRows) {
    if (!row.date || row.date < SALES_TRACKER_START || row.type !== 'new') continue;
    const key = row.date.slice(0, 7);
    monthKeys.add(key);
    conversionsByMonth.set(key, (conversionsByMonth.get(key) ?? 0) + 1);
    if (!(row.gross > 0))
      unpaidConversionsByMonth.set(key, (unpaidConversionsByMonth.get(key) ?? 0) + 1);
  }

  const paymentsByMonth = new Map<string, MonthlyPaymentEvent[]>();
  for (const p of payments) {
    if (!p.date || p.date < SALES_TRACKER_START || !(p.amount > 0)) continue;
    const key = p.date.slice(0, 7);
    monthKeys.add(key);
    const bucket = paymentsByMonth.get(key);
    if (bucket) bucket.push(p);
    else paymentsByMonth.set(key, [p]);
  }

  const netByMonth = new Map<string, number>();
  for (const key of monthKeys) {
    const monthPayments = paymentsByMonth.get(key) ?? [];
    netByMonth.set(
      key,
      monthPayments.reduce((s, p) => s + p.amount, 0)
    );
  }

  const summaries: MonthlySummary[] = [];
  for (const monthKey of monthKeys) {
    const monthPayments = paymentsByMonth.get(monthKey) ?? [];
    const grossRevenue = netByMonth.get(monthKey) ?? 0;
    // No discount source exists in the DB, so net == gross for now.
    const netRevenue = grossRevenue;

    const byProgram = new Map<string, ProgramBreakdown>();
    for (const p of monthPayments) {
      if (p.source !== 'client' || !p.subscriptionType) continue;
      const entry =
        byProgram.get(p.subscriptionType) ?? { program: p.subscriptionType, count: 0, revenue: 0 };
      entry.count += 1;
      entry.revenue += p.amount;
      byProgram.set(p.subscriptionType, entry);
    }
    const programBreakdown = Array.from(byProgram.values()).sort(
      (a, b) => b.count - a.count || b.revenue - a.revenue
    );
    const top = programBreakdown[0];
    const highestSellingProgram = top ? `${top.program} (${top.count})` : null;

    const byPaymentMode = new Map<string, number>();
    for (const p of monthPayments) {
      if (!p.paymentMode) continue;
      byPaymentMode.set(p.paymentMode, (byPaymentMode.get(p.paymentMode) ?? 0) + p.amount);
    }
    let topPaymentMode: string | null = null;
    let topPaymentAmount = -Infinity;
    for (const [mode, amount] of byPaymentMode) {
      if (amount > topPaymentAmount) {
        topPaymentAmount = amount;
        topPaymentMode = mode;
      }
    }

    const prevKey = prevMonthKey(monthKey);
    const prevNet = netByMonth.has(prevKey) ? netByMonth.get(prevKey)! : null;
    const momGrowthPct =
      prevNet !== null && prevNet !== 0 ? ((netRevenue - prevNet) / prevNet) * 100 : null;
    const prevMonthLabel = prevNet !== null ? monthLabelOf(prevKey) : null;

    const target = targetForMonth(monthKey, targets);
    const monthConversions = conversionsByMonth.get(monthKey) ?? 0;
    const achievementPct =
      target !== null && target > 0 ? (monthConversions / target) * 100 : null;

    summaries.push({
      monthKey,
      monthLabel: monthLabelOf(monthKey),
      totalConversions: conversionsByMonth.get(monthKey) ?? 0,
      conversionsWithoutPayment: unpaidConversionsByMonth.get(monthKey) ?? 0,
      target,
      achievementPct,
      grossRevenue,
      totalDiscounts: grossRevenue - netRevenue,
      netRevenue,
      highestSellingProgram,
      momGrowthPct,
      prevMonthNet: prevNet,
      prevMonthLabel,
      topPaymentMode,
      programBreakdown,
    });
  }

  return summaries.sort((a, b) => b.monthKey.localeCompare(a.monthKey));
}

// ---------------------------------------------------------------------------
// Pagination helpers (local port of the web's supabasePagination utils)
// ---------------------------------------------------------------------------

const PAGE_SIZE = 1000;
const IN_FILTER_BATCH_SIZE = 100;

// Fetches all rows from a Supabase query, bypassing the 1000-row cap. Pass a
// function that builds a FRESH query (without .range()) on every call.
async function fetchAllRows<T = any>(buildQuery: () => any): Promise<T[]> {
  let allData: T[] = [];
  let from = 0;
  let hasMore = true;
  while (hasMore) {
    const { data, error } = await buildQuery().range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    allData = allData.concat(data ?? []);
    hasMore = (data?.length ?? 0) === PAGE_SIZE;
    from += PAGE_SIZE;
  }
  return allData;
}

function chunkArray<T>(items: T[], size = IN_FILTER_BATCH_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

async function fetchRowsByIdBatches<T = any>(
  ids: string[],
  buildQuery: (idBatch: string[]) => any,
  batchSize = IN_FILTER_BATCH_SIZE
): Promise<T[]> {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  const rows: T[] = [];
  for (const idBatch of chunkArray(uniqueIds, batchSize)) {
    rows.push(...(await fetchAllRows<T>(() => buildQuery(idBatch))));
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Derived daily sales (read-only): assembled from converted leads, lead-invoice
// payment requests, client first payments and QHP fees. No manual CRUD.
// ---------------------------------------------------------------------------

export interface DerivedSalesData {
  rows: DerivedSaleRow[];
  payments: MonthlyPaymentEvent[]; // monthly revenue events: client first payments + collected QHP fees
}

const REQUEST_SELECT =
  'id, client_id, payment_method, payment_status, new_package_amount, paid_at, created_renewal_id, request_notes';

function parseNotes(s: string | null): any {
  if (!s) return {};
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

export const useDerivedDailySales = () =>
  useQuery({
    queryKey: ['ops-derived-sales'],
    staleTime: 60_000,
    queryFn: async (): Promise<DerivedSalesData> => {
      const [leadsRaw, leadInvoiceRequestsRaw, firstPaymentClients, qhpLeadsRaw] =
        await Promise.all([
          fetchAllRows<RawConvertedLead>(() =>
            supabase
              .from('leads')
              .select(
                'id, name, assigned_to, converted_at, converted_by, client_id, stage, stage_history, invoice_details, lead_type, is_spam, is_dump'
              )
              .not('converted_at', 'is', null)
              // Match the web Leads page "Converted Date" filter semantics
              // (useLeadsQuery): a conversion only counts while the lead is
              // still in a converted-ish stage.
              .in('stage', ['Converted', 'Raise invoice'])
              .is('applicant_lead', null)
          ),
          // Lead-invoice payment requests (tagged in request_notes JSON).
          fetchAllRows<RawPaymentRequestLite>(() =>
            supabase
              .from('renewal_payment_requests')
              .select(REQUEST_SELECT)
              .ilike('request_notes', '%"kind":"lead_invoice"%')
          ),
          // New clients' first package payment (clients table; includes Trial).
          fetchAllRows<{
            id: string;
            payment_date: string | null;
            package_amount: number | null;
            subscription_type: string | null;
          }>(() =>
            supabase
              .from('clients')
              .select('id, payment_date, package_amount, subscription_type')
              .not('payment_date', 'is', null)
          ),
          // Leads carrying a QHP fee record (paid assessments, converted or not).
          fetchAllRows<{
            id: string;
            qhp_details: any;
            lead_type: string | null;
            is_spam: boolean | null;
            is_dump: boolean | null;
          }>(() =>
            supabase
              .from('leads')
              .select('id, qhp_details, lead_type, is_spam, is_dump')
              .not('qhp_details', 'is', null)
          ),
        ]);

      // Mirror useLeadStats exclusions: no spam, no dump, no influencer leads.
      const leads = (leadsRaw ?? []).filter(
        (l) => !l.is_spam && !l.is_dump && l.lead_type !== 'influencer'
      );

      const leadInvoiceRequestsByLeadId = new Map<string, RawPaymentRequestLite>();
      for (const req of leadInvoiceRequestsRaw ?? []) {
        const leadId = parseNotes(req.request_notes)?.lead_id;
        if (leadId) leadInvoiceRequestsByLeadId.set(String(leadId), req);
      }

      const clientIds = Array.from(
        new Set(leads.map((l) => l.client_id).filter(Boolean) as string[])
      );

      const [clients, assessments] = await Promise.all([
        fetchRowsByIdBatches<RawClientLite>(clientIds, (batch) =>
          supabase
            .from('clients')
            .select(
              'id, first_name, last_name, status, subscription_type, package_amount, package_duration'
            )
            .in('id', batch)
        ),
        fetchRowsByIdBatches<{ client_id: string | null; completed: string | null }>(
          clientIds,
          (batch) =>
            supabase
              .from('coach_assessment')
              .select('client_id, completed')
              .in('client_id', batch)
              .not('completed', 'is', null),
          100
        ),
      ]);

      const clientsById = new Map<string, RawClientLite>();
      for (const c of clients) clientsById.set(c.id, c);

      // Keep the EARLIEST completion timestamp per client.
      const completedAtByClientId = new Map<string, string>();
      for (const a of assessments) {
        if (!a.client_id || !a.completed) continue;
        const prev = completedAtByClientId.get(a.client_id);
        if (!prev || a.completed < prev) completedAtByClientId.set(a.client_id, a.completed);
      }

      const input: DerivedRowsInput = {
        leads,
        clientsById,
        completedAtByClientId,
        leadInvoiceRequestsByLeadId,
      };

      // --- Monthly revenue events ---
      const paymentModeByClientId = new Map<string, string>();
      for (const req of leadInvoiceRequestsRaw ?? []) {
        const label = paymentModeLabel(req.payment_method);
        if (req.client_id && label) paymentModeByClientId.set(req.client_id, label);
      }

      const payments: MonthlyPaymentEvent[] = [];
      for (const c of firstPaymentClients ?? []) {
        const amount = Number(c.package_amount) || 0;
        const clientDate = istDatePart(c.payment_date);
        if (!clientDate || amount <= 0) continue;
        payments.push({
          date: clientDate,
          amount,
          subscriptionType: c.subscription_type ?? null,
          paymentMode: paymentModeByClientId.get(c.id) ?? null,
          source: 'client',
        });
      }
      for (const l of qhpLeadsRaw ?? []) {
        if (l.is_spam || l.is_dump || l.lead_type === 'influencer') continue;
        const d = l.qhp_details;
        if (!d || d.type !== 'paid' || !d.collected) continue;
        const amount = Number(d.amount) || 0;
        const date = istDatePart(d.collected_at ?? d.booked_at ?? null);
        if (amount <= 0 || !date) continue;
        payments.push({
          date,
          amount,
          subscriptionType: null,
          paymentMode: typeof d.mode === 'string' && d.mode ? d.mode : null,
          source: 'qhp',
        });
      }

      // The tracker starts at April 2026: drop older rows and rows whose
      // event date is unknown (they cannot be attributed to any month).
      const rows = buildDerivedRows(input).filter(
        (r) => r.date != null && r.date >= SALES_TRACKER_START
      );
      return {
        rows,
        payments: payments.filter((p) => p.date >= SALES_TRACKER_START),
      };
    },
  });

// ---------------------------------------------------------------------------
// Conversion targets (public.targets). A row's [start_date, end_date] range
// covers one or more months.
// ---------------------------------------------------------------------------

export const useSalesTargets = () =>
  useQuery({
    queryKey: ['ops-sales-targets-table'],
    staleTime: 60_000,
    queryFn: async (): Promise<SalesTargetRow[]> =>
      fetchAllRows<SalesTargetRow>(() =>
        supabase
          .from('targets')
          .select('id, department, target, start_date, end_date, profile_id')
          .order('start_date', { ascending: false })
      ),
  });

// Create or update the sales conversion target for one calendar month.
// One row per exact month range (start = 1st, end = last day); an existing
// row for that month is updated in place.
export const useUpsertMonthTarget = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { monthKey: string; target: number }) => {
      const start = `${args.monthKey}-01`;
      const [y, m] = args.monthKey.split('-').map(Number);
      const lastDay = new Date(y, m, 0).getDate();
      const end = `${args.monthKey}-${String(lastDay).padStart(2, '0')}`;
      const { data: userRes } = await supabase.auth.getUser();
      const tbl = supabase.from('targets');

      const { data: existing, error: selErr } = await tbl
        .select('id')
        .eq('department', 'sales')
        .eq('start_date', start)
        .eq('end_date', end)
        .limit(1);
      if (selErr) throw new Error(selErr.message);

      if (existing && existing.length > 0) {
        const { error } = await supabase
          .from('targets')
          .update({ target: args.target, profile_id: userRes.user?.id ?? null })
          .eq('id', (existing[0] as any).id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase.from('targets').insert({
          department: 'sales',
          target: args.target,
          start_date: start,
          end_date: end,
          profile_id: userRes.user?.id ?? null,
        });
        if (error) throw new Error(error.message);
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ops-sales-targets-table'] }),
  });
};

export const useUpdateTarget = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; target: number }) => {
      const { error } = await supabase
        .from('targets')
        .update({ target: args.target })
        .eq('id', args.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ops-sales-targets-table'] }),
  });
};

export const useDeleteTarget = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('targets').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ops-sales-targets-table'] }),
  });
};

// ---------------------------------------------------------------------------
// Profiles lookup (assigned-to name resolution)
// ---------------------------------------------------------------------------

export interface SalesProfileInfo {
  name: string;
  role: string | null;
}

export const useProfilesByIds = (ids: string[]) => {
  const sortedIds = Array.from(new Set(ids.filter(Boolean))).sort();
  return useQuery({
    queryKey: ['ops-sales-profiles', sortedIds.join(',')],
    enabled: sortedIds.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<Map<string, SalesProfileInfo>> => {
      const rows = await fetchRowsByIdBatches<{
        id: string;
        first_name: string | null;
        last_name: string | null;
        role: string | null;
      }>(sortedIds, (batch) =>
        supabase.from('profiles').select('id, first_name, last_name, role').in('id', batch)
      );
      const map = new Map<string, SalesProfileInfo>();
      for (const p of rows) {
        map.set(p.id, {
          name: [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || 'Unknown',
          role: p.role ?? null,
        });
      }
      return map;
    },
  });
};
