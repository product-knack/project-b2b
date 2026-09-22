import { supabase } from './supabase';
import { withTimeout, uploadWithTimeout, NET_MS } from './withTimeout';
import { uuidv4 } from './clientQueries';

/* ============ Staff reimbursement requests (doctors) ============
   Port of hub-track src/lib/reimbursements.ts. One row per request in
   public.reimbursements, screenshots in the private "reimbursements" bucket at
   <requester_id>/<uuid>-<safe name>. Backend (all live, 21 Sep 2026):
   migrations 20260921090000 (table, guard trigger, RLS, RPC, bucket),
   20260921100000 (paid_by), 20260921110000 (screenshots array),
   20260921120000 (locations dropped), 20260921130000 (review by the HOD).

   OWNER RULE FOR DECISIONS: approve stamps approved_by and leaves status at
   'pending'; reject stamps approved_by AND sets status = 'rejected'. The human
   state is therefore derived (effectiveStatus below); never filter "approved"
   by the status column. A request is decided once. */

export const REIMBURSEMENT_BUCKET = 'reimbursements';
export const REIMBURSEMENT_MAX_BYTES = 10 * 1024 * 1024;
/** Matches the CHECK on reimbursements.screenshots (1 to 10 entries). */
export const REIMBURSEMENT_MAX_FILES = 10;
export const SIGNED_URL_SECONDS = 300;

export type ReimbursementType = 'cab';
export const REIMBURSEMENT_TYPES: { value: ReimbursementType; label: string }[] = [{ value: 'cab', label: 'Cab' }];

export type ReimbursementStatus = 'pending' | 'approved' | 'rejected';

export interface ReimbursementReview {
  id: string;
  name: string | null;
  role: string | null;
  at: string;
  decision: 'approved' | 'rejected';
  note: string | null;
}

/** reimbursements.expense_details (jsonb). Amount and note are optional. No locations. */
export interface ExpenseDetails {
  type: ReimbursementType;
  expense_date: string; // yyyy-MM-dd
  amount?: number | null;
  note?: string | null;
}

/** One entry of reimbursements.screenshots (jsonb array). */
export interface ScreenshotRef {
  path: string; // <requester_id>/<uuid>-<name> in the bucket
  name: string;
  size: number | null;
  type: string | null;
}

/** reimbursements.paid_by (jsonb): stamped by the payout system once an approved request is paid. */
export interface ReimbursementPaid {
  id: string;
  name: string | null;
  at: string;
  amount: number | null;
  payout_batch_id?: string | null;
  source?: 'plutus' | 'manual' | string;
  note?: string | null;
}

export interface ReimbursementRow {
  id: string;
  requester_id: string;
  expense_details: ExpenseDetails;
  screenshots: ScreenshotRef[];
  status: ReimbursementStatus;
  approved_by: ReimbursementReview | null;
  paid_by: ReimbursementPaid | null;
  created_at: string;
  updated_at: string;
}

/** A row as the reviewer screen sees it (with the requester's name). */
export interface ReimbursementWithRequester extends ReimbursementRow {
  requester_name: string;
}

export const STATUS_LABEL: Record<ReimbursementStatus, string> = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected' };

/**
 * What the row means to a human. Owner rule: approving stamps approved_by and
 * leaves status as 'pending'; rejecting stamps it AND sets status = 'rejected'.
 * So "approved" is read from the stamp, not from the status column.
 */
export function effectiveStatus(r: Pick<ReimbursementRow, 'status' | 'approved_by'>): ReimbursementStatus {
  if (r.status === 'rejected' || r.approved_by?.decision === 'rejected') return 'rejected';
  if (r.approved_by?.decision === 'approved') return 'approved';
  return 'pending';
}

/** Same sanitiser as the web: [A-Za-z0-9._-] only, last 80 characters. */
export const safeName = (name: string) => name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80) || 'screenshot';

/** A file the picker handed us (image picker or document picker). */
export type PickedScreenshot = { uri: string; name: string; mime: string; size: number | null };

/** Accepts images and PDFs up to the size limit; returns a reason when a file is refused. */
export function screenshotFileProblem(f: PickedScreenshot): string | null {
  if (!f.mime.startsWith('image/') && f.mime !== 'application/pdf') return `${f.name}: only images or PDFs.`;
  if (f.size != null && f.size > REIMBURSEMENT_MAX_BYTES) return `${f.name}: larger than 10 MB.`;
  return null;
}

/* ---------- formatting (IST like the rest of the app; expense_date is date-only) ---------- */
export const fmtExpenseDate = (ymd: string | null | undefined) => {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}/.test(ymd)) return '—';
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
};
export const fmtStamp = (iso: string | null | undefined) => {
  if (!iso) return '';
  return new Date(iso)
    .toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
    .replace(/\s?(am|pm)$/i, (m) => ` ${m.trim().toUpperCase()}`);
};
export const fmtRupees = (n: number | null | undefined) => (n == null ? null : `₹${Number(n).toLocaleString('en-IN')}`);
/** Today's IST calendar day (yyyy-MM-dd). */
export const todayIst = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/* ---------- storage ---------- */
const removeQuietly = async (paths: string[]) => {
  if (paths.length === 0) return;
  try { await withTimeout(supabase.storage.from(REIMBURSEMENT_BUCKET).remove(paths), NET_MS, 'Rollback'); } catch { /* best effort */ }
};

/** Short-lived link to a screenshot in the private bucket (owner or reviewer). Resolve at tap time, never store. */
export async function screenshotUrl(path: string, expiresInSeconds = SIGNED_URL_SECONDS): Promise<string> {
  const { data, error } = await withTimeout(supabase.storage.from(REIMBURSEMENT_BUCKET).createSignedUrl(path, expiresInSeconds), NET_MS, 'Screenshot');
  if (error) throw error;
  return data.signedUrl;
}

/* ---------- submit ---------- */
export interface SubmitReimbursementInput {
  requesterId: string;
  type: ReimbursementType;
  expenseDate: string; // yyyy-MM-dd
  amount: number | null;
  note: string | null;
  files: PickedScreenshot[];
}

const normaliseRow = (r: any): ReimbursementRow => ({ ...(r as ReimbursementRow), screenshots: Array.isArray(r?.screenshots) ? r.screenshots : [] });

/**
 * Upload every screenshot one after another, then insert the row with the
 * array of references. Any failure removes the objects uploaded so far.
 */
export async function submitReimbursement(input: SubmitReimbursementInput): Promise<ReimbursementRow> {
  if (input.files.length === 0) throw new Error('Attach at least one payment screenshot.');
  if (input.files.length > REIMBURSEMENT_MAX_FILES) throw new Error(`At most ${REIMBURSEMENT_MAX_FILES} screenshots per request.`);

  const uploaded: ScreenshotRef[] = [];
  for (const file of input.files) {
    // The upload policy checks that the first folder equals auth.uid().
    const path = `${input.requesterId}/${uuidv4()}-${safeName(file.name)}`;
    // fetch → arrayBuffer is the RN-safe route for file:// and content:// picker uris.
    const body = await (await fetch(file.uri)).arrayBuffer();
    if (body.byteLength > REIMBURSEMENT_MAX_BYTES) { await removeQuietly(uploaded.map((s) => s.path)); throw new Error(`${file.name}: larger than 10 MB.`); }
    const { error: upErr } = await uploadWithTimeout(REIMBURSEMENT_BUCKET, path, body, { contentType: file.mime || undefined, upsert: false });
    if (upErr) { await removeQuietly(uploaded.map((s) => s.path)); throw upErr; }
    uploaded.push({ path, name: file.name, size: file.size ?? body.byteLength, type: file.mime || null });
  }

  const expense_details: ExpenseDetails = { type: input.type, expense_date: input.expenseDate, amount: input.amount, note: input.note?.trim() || null };
  const { data, error } = await withTimeout<any>(
    Promise.resolve(supabase.from('reimbursements').insert({ requester_id: input.requesterId, expense_details, screenshots: uploaded }).select('*').single()) as Promise<any>,
    NET_MS, 'Submit');
  if (error) { await removeQuietly(uploaded.map((s) => s.path)); throw error; }
  return normaliseRow(data);
}

/* ---------- reads ---------- */
export async function fetchMyReimbursements(requesterId: string): Promise<ReimbursementRow[]> {
  const { data, error } = await withTimeout<any>(
    Promise.resolve(supabase.from('reimbursements').select('*').eq('requester_id', requesterId).order('created_at', { ascending: false }).limit(100)) as Promise<any>,
    NET_MS, 'Reimbursements');
  if (error) throw error;
  return ((data ?? []) as any[]).map(normaliseRow);
}

/** Every request (reviewer RLS), newest first, with the requester's name joined from profiles. */
export async function fetchAllReimbursements(): Promise<ReimbursementWithRequester[]> {
  const { data, error } = await withTimeout<any>(
    Promise.resolve(supabase.from('reimbursements').select('*, requester:profiles!reimbursements_requester_id_fkey(first_name, last_name)').order('created_at', { ascending: false }).limit(500)) as Promise<any>,
    NET_MS, 'Reimbursements');
  if (error) throw error;
  return ((data ?? []) as any[]).map((r) => ({
    ...normaliseRow(r),
    requester_name: [r.requester?.first_name, r.requester?.last_name].filter(Boolean).join(' ').trim() || 'Unknown',
  }));
}

/* ---------- decide (RPC only; surfaces the server's own messages verbatim) ---------- */
export async function reviewReimbursement(id: string, decision: 'approved' | 'rejected', note?: string | null): Promise<ReimbursementReview> {
  const { data, error } = await withTimeout<any>(
    Promise.resolve(supabase.rpc('review_reimbursement', { p_id: id, p_decision: decision, p_note: note?.trim() || null })) as Promise<any>,
    NET_MS, 'Review');
  if (error) throw error;
  return data as ReimbursementReview;
}

/** Plain-English reason for a failed call, naming the migration when the backend is missing (web parity). */
export function describeReimbursementError(error: unknown): string {
  const e = error as { code?: string; message?: string; statusCode?: string | number } | null;
  const code = String(e?.code ?? e?.statusCode ?? '');
  const msg = e?.message ?? '';
  if (code === '42P01' || /relation .*reimbursements.* does not exist/i.test(msg)) {
    return 'The reimbursements table is not set up yet. Run migration 20260921090000_reimbursements.sql in the SQL editor.';
  }
  if (/column .*screenshots.* does not exist|screenshot_path/i.test(msg) || code === 'PGRST204') {
    return 'The reimbursements table still has the single-screenshot column. Run migration 20260921110000_reimbursements_screenshots.sql in the SQL editor.';
  }
  if (/bucket not found/i.test(msg) || code === '404') {
    return 'The reimbursements storage bucket is not set up yet. Run migration 20260921090000_reimbursements.sql in the SQL editor.';
  }
  if (code === '42501' || /row-level security|not authorized|Unauthorized/i.test(msg)) {
    return 'You are not allowed to do this. Sign in again and retry.';
  }
  if (/payload too large|exceeded the maximum allowed size/i.test(msg)) {
    return 'A screenshot is larger than 10 MB.';
  }
  if (e && (e as any).name === 'TimeoutError') return 'The network is slow right now. Check your connection and try again.';
  return msg || 'Something went wrong. Please try again.';
}
