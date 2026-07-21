import * as Print from 'expo-print';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from './supabase';

/* ============ Native "Generate QHP PDF" pipeline ============
   Mirrors the web QHPPDFGenerator happy path end-to-end:
   1. generate-qhp-report edge fn × batches 1–5 → merged `narratives`
   2. HTML report → PDF (expo-print)
   3. qhp_details upsert (web useSavePreapprovedQHP contract: update the row for
      this assessment if one exists, else insert; approved=false → enters the
      Junior→Senior→HOD review flow)
   4. upload PDF to PUBLIC bucket qhp-images at reports/{clientId}/{detailId}.pdf,
      patch pdf_storage_path + pdf_filename on the row.
   Gated by profiles.qhp_report_creator (capabilities.qhpReportCreator). */

const BATCHES = ['batch_1', 'batch_2', 'batch_3', 'batch_4', 'batch_5'];
export const BATCH_LABELS = ['Executive Summary & Key Insights', 'Medical/Lifestyle & Body', 'Mobility, Functional & Postural', 'HeartMath & Clinical Interpretation', 'Intervention, Modalities & Roadmap'];

/* Assessment source priority — web getAssessmentData: raw capture data beats the
   finalized qhp_data shape (better metric extraction). */
export function getAssessmentSource(a: any): { data: any; source: string } | null {
  const ok = (v: any) => v && typeof v === 'object' && Object.keys(v).length > 0;
  if (ok(a?.new_client_assessment_data)) return { data: a.new_client_assessment_data, source: 'new client assessment data' };
  if (ok(a?.existing_client_assessment_data)) return { data: a.existing_client_assessment_data, source: 'existing client assessment data' };
  if (ok(a?.qhp_data)) return { data: a.qhp_data, source: 'qhp data' };
  return null;
}

/* Deep key search (web deepGet) — used to pull client-info fields for the PDF header. */
export function deepGet(obj: any, ...keys: string[]): string {
  if (!obj || typeof obj !== 'object') return '';
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null && obj[key] !== '') return String(obj[key]);
    for (const v of Object.values(obj)) {
      if (v && typeof v === 'object') {
        const found = deepGet(v as any, key);
        if (found) return found;
      }
    }
  }
  return '';
}

async function fnMessage(error: any, fallback: string): Promise<string> {
  try {
    if (error?.context?.text) {
      const t = await error.context.text();
      const j = JSON.parse(t);
      if (j?.error) return String(j.error);
    }
  } catch {}
  return error?.message || fallback;
}

/* Flatten the assessment jsonb into { "Section > Field": value } primitives — the
   edge fn renders this as its FLAT METRICS text block. */
export function flattenMetrics(data: any, prefix = '', out: Record<string, any> = {}): Record<string, any> {
  if (data == null) return out;
  if (typeof data !== 'object') { if (prefix) out[prefix] = data; return out; }
  if (Array.isArray(data)) {
    data.forEach((v, i) => flattenMetrics(v, `${prefix}[${i}]`, out));
    return out;
  }
  for (const [k, v] of Object.entries(data)) {
    const key = prefix ? `${prefix} > ${k}` : k;
    if (v == null || v === '') continue;
    if (typeof v === 'object') flattenMetrics(v, key, out);
    else out[key] = v;
  }
  return out;
}

export type QhpGenProgress = { label: string; pct: number };

/* 5 sequential batches (web contract), with per-batch timeout (batch_5 is the
   biggest and can take 40s+) and one retry per batch. Comparison mode sends
   previous/baseline data + metrics exactly like the web generator. */
export async function generateNarratives(
  input: {
    assessmentData: any; clientName: string; assessmentDate: string | null;
    previous?: { data: any; date: string | null } | null;
    baseline?: { data: any; date: string | null } | null;
  },
  onProgress: (p: QhpGenProgress) => void,
): Promise<Record<string, any>> {
  const isComparison = !!input.previous;
  const baseBody: any = {
    assessmentData: input.assessmentData,
    metrics: flattenMetrics(input.assessmentData),
    clientName: input.clientName,
    assessmentDate: input.assessmentDate,
    isComparison,
  };
  if (isComparison && input.previous) {
    baseBody.previousAssessmentData = input.previous.data;
    baseBody.previousAssessmentDate = input.previous.date;
    baseBody.previousMetrics = flattenMetrics(input.previous.data);
    if (input.baseline) {
      baseBody.baselineAssessmentData = input.baseline.data;
      baseBody.baselineAssessmentDate = input.baseline.date;
      baseBody.baselineMetrics = flattenMetrics(input.baseline.data);
    }
  }

  const invokeWithTimeout = async (body: any, batchId: string) => {
    const t = batchId === 'batch_5' ? 120_000 : 75_000;
    const invokeP = supabase.functions.invoke('generate-qhp-report', { body }).catch((err: any) => ({ data: null, error: { message: err?.message || 'Network error' } }));
    const timeoutP = new Promise<{ data: null; error: { message: string } }>((resolve) => setTimeout(() => resolve({ data: null, error: { message: `Timed out after ${t / 1000}s` } }), t));
    return (await Promise.race([invokeP, timeoutP])) as { data: any; error: any };
  };

  const merged: Record<string, any> = {};
  for (let i = 0; i < BATCHES.length; i++) {
    const base = (i / BATCHES.length) * 100;
    onProgress({ label: `Generating ${BATCH_LABELS[i]} (${i + 1}/${BATCHES.length})…`, pct: Math.round(base) });
    const body = { ...baseBody, section_batch: BATCHES[i] };
    let lastErr: string | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const { data, error } = await invokeWithTimeout(body, BATCHES[i]);
      if (error) { lastErr = error.message ? String(error.message) : await fnMessage(error, `Batch ${i + 1} failed`); continue; }
      if ((data as any)?.error) { lastErr = String((data as any).error); continue; }
      Object.assign(merged, (data as any)?.narratives ?? {});
      lastErr = null;
      break;
    }
    if (lastErr) throw new Error(`${lastErr} (${BATCH_LABELS[i]}, section ${i + 1}/5)`);
    onProgress({ label: `Generating ${BATCH_LABELS[Math.min(i + 1, 4)]} (${Math.min(i + 2, 5)}/5)…`, pct: Math.round(((i + 1) / BATCHES.length) * 100) });
  }
  return merged;
}

/* ---------------- HTML report ---------------- */
const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const title = (k: string) => k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const bulletsHtml = (arr: any[]) => `<ul>${arr.map((b) => `<li>${esc(typeof b === 'object' ? Object.values(b).filter(Boolean).join(' — ') : b)}</li>`).join('')}</ul>`;
function tableHtml(rows: any[], columns?: string[]): string {
  if (!rows.length) return '';
  const keys = columns ?? Object.keys(rows[0]).filter((k) => k !== 'cells');
  const useCells = rows[0] && Array.isArray(rows[0].cells);
  const header = useCells ? '' : `<tr>${keys.map((k) => `<th>${esc(title(k))}</th>`).join('')}</tr>`;
  const body = rows.map((r) => {
    const cells = useCells ? r.cells : keys.map((k) => r[k]);
    return `<tr>${(cells as any[]).map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`;
  }).join('');
  return `<table>${header}${body}</table>`;
}
function sectionHtml(key: string, value: any): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim() ? `<h2>${esc(title(key))}</h2><p>${esc(value)}</p>` : '';
  if (Array.isArray(value)) {
    if (!value.length) return '';
    const isRowObjects = typeof value[0] === 'object' && value[0] !== null;
    return `<h2>${esc(title(key))}</h2>${isRowObjects && !Array.isArray((value[0] as any).cells) && Object.keys(value[0]).length > 1 ? tableHtml(value) : bulletsHtml(value)}`;
  }
  if (typeof value === 'object') {
    const inner = Object.entries(value).map(([k, v]) => sectionHtml(k, v)).join('');
    return inner ? `<h2>${esc(title(key))}</h2>${inner.replace(/<h2>/g, '<h3>').replace(/<\/h2>/g, '</h3>')}` : '';
  }
  return `<h2>${esc(title(key))}</h2><p>${esc(value)}</p>`;
}
/* Preferred ordering for known narrative keys; everything else renders after, generically. */
const KEY_ORDER = [
  'executive_summary_direction', 'executive_summary_improved', 'executive_summary_bullets',
  'executive_summary_paragraph', 'primary_limiting_factor',
  'key_strengths', 'key_gaps', 'medical_lifestyle_rows',
];
const GREEN_KEYS = new Set(['key_strengths', 'executive_summary_improved']);
const RED_KEYS = new Set(['key_gaps']);
export type QhpPdfMeta = {
  clientName: string; reportLabel: string; dateLabel: string; score: number | null;
  info: { label: string; value: string }[]; isComparison: boolean; comparedToLabel?: string | null;
};
export function buildQhpHtml(meta: QhpPdfMeta, narratives: Record<string, any>): string {
  const ordered: [string, any][] = [];
  KEY_ORDER.forEach((k) => { if (k in narratives) ordered.push([k, narratives[k]]); });
  Object.entries(narratives).forEach(([k, v]) => { if (!KEY_ORDER.includes(k) && !k.startsWith('_')) ordered.push([k, v]); });
  let n = 1;
  const body = ordered.map(([k, v]) => {
    const html = sectionHtml(k, v);
    if (!html) return '';
    n += 1;
    const cls = GREEN_KEYS.has(k) ? ' class="good"' : RED_KEYS.has(k) ? ' class="bad"' : '';
    return `<div${cls}>${html.replace('<h2>', `<h2>${n}) `)}</div>`;
  }).join('');
  const infoCells = meta.info.filter((i) => i.value).map((i) => `<div class="cell"><div class="lbl">${esc(i.label)}</div><div class="val">${esc(i.value)}</div></div>`).join('');
  return `
  <style>
    body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #1a2340; margin: 0; font-size: 12px; line-height: 1.55; }
    .banner { background: #1d2a63; color: #fff; padding: 26px 34px 20px; }
    .brand { font-size: 22px; font-weight: 800; letter-spacing: 0.5px; }
    .brand span { color: #F47A2A; }
    .wrap { padding: 10px 34px 30px; }
    .title { text-align: center; font-size: 21px; font-weight: 800; color: #1d2a63; margin: 20px 0 4px; }
    .title-rule { width: 220px; height: 3px; background: #1d2a63; margin: 0 auto 6px; }
    .cmp { text-align: center; color: #5b657f; font-size: 11px; margin-bottom: 10px; }
    h2 { font-size: 14.5px; color: #0e7490; border-bottom: 2px solid #0e7490; padding-bottom: 4px; margin: 22px 0 10px; }
    h3 { font-size: 12.5px; color: #1a2340; margin: 12px 0 6px; }
    p { margin: 5px 0; }
    ul { margin: 4px 0 8px 18px; padding: 0; }
    li { margin: 3px 0; }
    table { width: 100%; border-collapse: collapse; margin: 6px 0 12px; font-size: 11px; }
    th { background: #1d2a63; color: #fff; text-align: left; font-weight: 700; }
    th, td { border: 1px solid #d8dcea; padding: 6px 9px; vertical-align: top; }
    tr:nth-child(even) td { background: #f4f6fb; }
    .good td { background: #e7f6ec !important; }
    .good tr:nth-child(even) td { background: #d9efe1 !important; }
    .bad td { background: #fdeeee !important; }
    .bad tr:nth-child(even) td { background: #fae0e0 !important; }
    .grid { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0 4px; }
    .cell { width: 46%; flex-grow: 1; border: 1px solid #d8dcea; border-radius: 6px; padding: 7px 10px; background: #f7f8fc; }
    .lbl { font-size: 9px; text-transform: uppercase; letter-spacing: 0.6px; color: #5b657f; font-weight: 700; }
    .val { font-size: 12px; font-weight: 700; color: #1a2340; margin-top: 2px; }
    .foot { margin-top: 26px; padding-top: 10px; border-top: 1px solid #d8dcea; color: #7d859c; font-size: 10px; }
  </style>
  <div class="banner"><div class="brand">Odds<span>⚡</span></div></div>
  <div class="wrap">
    <div class="title">${esc(meta.reportLabel)}</div>
    <div class="title-rule"></div>
    ${meta.isComparison && meta.comparedToLabel ? `<div class="cmp">Comparison report — current vs ${esc(meta.comparedToLabel)}</div>` : ''}
    <h2>1) Client Information</h2>
    <div class="grid">${infoCells}</div>
    ${body}
    <div class="foot">Generated ${esc(meta.dateLabel)} via the Odds staff app · Pending Senior Researcher &amp; HOD review</div>
  </div>`;
}

/* ---------------- qhp_details upsert (web useSavePreapprovedQHP contract) ---------------- */
export async function saveQhpDetails(input: { clientId: string; coachAssessmentId: string; preapproved: any }): Promise<string> {
  const payload: any = { preapproved_qhp: input.preapproved, qhp_json: input.preapproved, approved: false, coach_assessment_id: input.coachAssessmentId };
  const { data: existing } = await supabase.from('qhp_details').select('id').eq('client_id', input.clientId).eq('coach_assessment_id', input.coachAssessmentId).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (existing?.id) {
    const { data, error } = await supabase.from('qhp_details').update(payload).eq('id', existing.id).select('id').single();
    if (error) throw new Error(error.message);
    return data.id;
  }
  const { data, error } = await supabase.from('qhp_details').insert({ client_id: input.clientId, ...payload }).select('id').single();
  if (error) throw new Error(error.message);
  return data.id;
}

/* ---------------- PDF upload ---------------- */
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const len = Math.floor((clean.length * 3) / 4);
  const out = new Uint8Array(len);
  let o = 0;
  for (let i = 0; i + 3 < clean.length || (i < clean.length && o < len); i += 4) {
    const n = (B64.indexOf(clean[i]) << 18) | (B64.indexOf(clean[i + 1]) << 12) | ((B64.indexOf(clean[i + 2]) & 63) << 6) | (B64.indexOf(clean[i + 3]) & 63);
    if (o < len) out[o++] = (n >> 16) & 255;
    if (o < len && clean[i + 2] !== undefined) out[o++] = (n >> 8) & 255;
    if (o < len && clean[i + 3] !== undefined) out[o++] = n & 255;
  }
  return out;
}

export async function renderAndUploadPdf(input: { detailId: string; clientId: string; clientName: string; html: string }): Promise<string> {
  const { uri } = await Print.printToFileAsync({ html: input.html, base64: false });
  const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  const bytes = base64ToBytes(b64);
  const storagePath = `reports/${input.clientId}/${input.detailId}.pdf`;
  const fileName = `${input.clientName.replace(/[^a-z0-9-_ ]/gi, '').trim() || 'client'} - QHP Report.pdf`;
  const { error: upErr } = await supabase.storage.from('qhp-images').upload(storagePath, bytes.buffer as ArrayBuffer, { upsert: true, contentType: 'application/pdf' });
  if (upErr) throw new Error(upErr.message);
  const { error: patchErr } = await supabase.from('qhp_details').update({ pdf_storage_path: storagePath, pdf_filename: fileName }).eq('id', input.detailId);
  if (patchErr) throw new Error(patchErr.message);
  return supabase.storage.from('qhp-images').getPublicUrl(storagePath).data.publicUrl;
}
