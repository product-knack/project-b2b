import React from 'react';
import * as SQLite from 'expo-sqlite';
import { supabase } from './supabase';
import { flattenMetrics } from './qhpPdf';
import { registerTeardown } from './sessionTeardown';

/* ============================================================================
   Odds AI — on-device client-data cache (SQLite) + Gemini chat plumbing.

   Every client assigned to the signed-in CRM gets ONE compact JSON payload row
   in odds_ai.db (profile, team, package usage, sessions, QHP history + latest
   metrics, blood/health reports, medical history, findings, comms, pauses).
   The cache refreshes automatically in the background whenever it is older
   than SYNC_STALE_MS (dashboard mount + AI screen mount) and on demand.

   Questions are answered by the odds-ai-chat edge function (Gemini — the API
   key lives server-side only). The app assembles the context from SQLite:
   a one-line roster summary for every client + FULL payloads for the clients
   whose names appear in the question.
   ========================================================================== */

const SYNC_STALE_MS = 30 * 60 * 1000; // auto-refresh when older than 30 min
const nonEmpty = (v: any) => !!v && typeof v === 'object' && Object.keys(v).length > 0;
const fullName = (p: any) => `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.replace(/\s+/g, ' ').trim();

/* ---------- DB ---------- */
let dbP: Promise<SQLite.SQLiteDatabase> | null = null;
function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbP) {
    dbP = (async () => {
      const db = await SQLite.openDatabaseAsync('odds_ai.db');
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS ai_clients (
          client_id TEXT PRIMARY KEY,
          crm_id TEXT NOT NULL,
          name TEXT NOT NULL,
          payload TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ai_clients_crm ON ai_clients(crm_id);
        CREATE TABLE IF NOT EXISTS ai_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      `);
      return db;
    })();
  }
  return dbP;
}

/* ---------- sync status (tiny external store so screens re-render on sync) ---------- */
export type AiCacheStatus = { syncing: boolean; lastSyncAt: string | null; clientCount: number; error: string | null };
let status: AiCacheStatus = { syncing: false, lastSyncAt: null, clientCount: 0, error: null };
const listeners = new Set<() => void>();
const setStatus = (patch: Partial<AiCacheStatus>) => {
  status = { ...status, ...patch };
  listeners.forEach((l) => l());
};
/* Sign-out: wipe every cached client payload (medical history, metrics, contact
   details) and the shared status so the next user never sees the previous one's. */
export async function clearAiCache() {
  try { const db = await getDb(); await db.runAsync('DELETE FROM ai_clients'); } catch { /* best-effort */ }
  setStatus({ syncing: false, lastSyncAt: null, clientCount: 0, error: null });
}
registerTeardown(clearAiCache);

export function useAiCacheStatus(crmId: string | null): AiCacheStatus {
  const [snap, setSnap] = React.useState(status);
  React.useEffect(() => {
    const l = () => setSnap({ ...status });
    listeners.add(l);
    // Hydrate lastSync/count from disk so the header is right before any sync runs.
    (async () => {
      if (!crmId) return;
      const db = await getDb();
      const meta = await db.getFirstAsync<{ value: string }>('SELECT value FROM ai_meta WHERE key = ?', [`last_sync:${crmId}`]);
      const cnt = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM ai_clients WHERE crm_id = ?', [crmId]);
      setStatus({ lastSyncAt: meta?.value ?? null, clientCount: cnt?.n ?? 0 });
    })().catch(() => {});
    return () => { listeners.delete(l); };
  }, [crmId]);
  return snap;
}

/* ---------- paged fetch helper (PostgREST caps at 1000 rows/request) ---------- */
async function pageAll(build: (from: number, to: number) => any, maxPages = 30): Promise<any[]> {
  const out: any[] = [];
  for (let p = 0; p < maxPages; p++) {
    const { data, error } = await build(p * 1000, p * 1000 + 999);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as any[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}
const chunk = <T,>(a: T[], n = 150): T[][] => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

/* Latest-QHP metrics: flattened key/values, big free-text dropped, entry-capped. */
function compactMetrics(data: any): Record<string, any> {
  const flat = flattenMetrics(data);
  const out: Record<string, any> = {};
  let n = 0;
  for (const [k, v] of Object.entries(flat)) {
    if (typeof v === 'string' && v.length > 200) continue; // narrative text, not a metric
    out[k] = v;
    if (++n >= 350) break;
  }
  return out;
}

/* ---------- the sync ---------- */
let syncing: Promise<void> | null = null; // single-flight

export async function syncAiCache(crmId: string): Promise<void> {
  if (syncing) return syncing;
  syncing = doSync(crmId).finally(() => { syncing = null; });
  return syncing;
}

export async function ensureAiCacheFresh(crmId: string, force = false): Promise<void> {
  if (!force) {
    const db = await getDb();
    const meta = await db.getFirstAsync<{ value: string }>('SELECT value FROM ai_meta WHERE key = ?', [`last_sync:${crmId}`]);
    if (meta?.value && Date.now() - new Date(meta.value).getTime() < SYNC_STALE_MS) return;
  }
  return syncAiCache(crmId);
}

async function doSync(crmId: string): Promise<void> {
  setStatus({ syncing: true, error: null });
  try {
    // 1. My book: actively-training assignments → non-inactive clients.
    const { data: tc, error: tcErr } = await supabase
      .from('trainer_clients')
      .select('client_id, clients:client_id(id, first_name, last_name, phone, email, status, subscription_type, created_at, session_package)')
      .eq('trainer_id', crmId).eq('actively_training', true);
    if (tcErr) throw new Error(tcErr.message);
    const clients = (tc ?? [])
      .map((r: any) => r.clients)
      .filter((c: any) => c && !['inactive', 'discontinued'].includes((c.status ?? '').toLowerCase()));
    const ids: string[] = clients.map((c: any) => c.id);
    if (!ids.length) {
      const db = await getDb();
      await db.runAsync('DELETE FROM ai_clients WHERE crm_id = ?', [crmId]);
      await db.runAsync('INSERT OR REPLACE INTO ai_meta (key, value) VALUES (?, ?)', [`last_sync:${crmId}`, new Date().toISOString()]);
      setStatus({ syncing: false, lastSyncAt: new Date().toISOString(), clientCount: 0 });
      return;
    }

    const now = new Date();
    const d90 = new Date(now.getTime() - 90 * 864e5).toISOString();
    const d7fwd = new Date(now.getTime() + 7 * 864e5).toISOString();

    // 2. Domain fetches (chunked by client ids; paged where a chunk can pass 1000 rows).
    const team = new Map<string, { name: string; role: string }[]>();
    const sess = new Map<string, any[]>();
    const upcoming = new Map<string, any[]>();
    const qhpHist = new Map<string, any[]>();
    const reports = new Map<string, any[]>();
    const medical = new Map<string, any[]>();
    const findings = new Map<string, any[]>();
    const comms = new Map<string, any[]>();
    const pauses = new Map<string, any[]>();
    const renewalOf = new Map<string, { pkg: number; from: string }>();
    const consumedRows = new Map<string, string[]>(); // client -> scheduled_at of consumed sessions
    const push = (m: Map<string, any[]>, k: string, v: any) => { const a = m.get(k) ?? []; a.push(v); m.set(k, a); };

    for (const part of chunk(ids)) {
      const [tcAll, sessR, upR, qhpR, repR, medR, finR, comR, pauR, renR, consR] = await Promise.all([
        supabase.from('trainer_clients').select('client_id, profiles:trainer_id(first_name, last_name, role)').in('client_id', part).eq('actively_training', true),
        pageAll((f, t) => supabase.from('training_sessions').select('client_id, scheduled_at, session_type, session_name, status, rpe').in('client_id', part).gte('scheduled_at', d90).order('scheduled_at', { ascending: false }).range(f, t)),
        supabase.from('session_schedule').select('client_id, scheduled_datetime, modality, status, profiles:trainer_id(first_name, last_name)').in('client_id', part).gte('scheduled_datetime', now.toISOString()).lte('scheduled_datetime', d7fwd).neq('status', 'cancelled'),
        supabase.from('coach_assessment').select('id, client_id, assessment_date, completed, mechanical_score, assessment_scheduled, coach_id').in('client_id', part).order('assessment_date', { ascending: true }),
        supabase.from('health_reports').select('client_id, report_name, report_type, test_date, upload_date, metabolic_score, longevity_score').in('client_id', part).eq('is_active', true).order('upload_date', { ascending: false }),
        supabase.from('client_medical_history').select('client_id, event_date, title, category, severity, is_ongoing, diagnosis, description').in('client_id', part).order('event_date', { ascending: false }),
        supabase.from('client_findings').select('client_id, title, description, created_at').in('client_id', part).order('created_at', { ascending: false }),
        supabase.from('crm_communications').select('client_id, call_date, call_status, call_medium, category, remarks, next_follow_up_date').in('client_id', part).order('call_date', { ascending: false }),
        supabase.from('client_pause_history').select('client_id, pause_start, pause_end, is_active').in('client_id', part),
        supabase.from('client_renewals').select('client_id, package_sessions, renewed_at').in('client_id', part).eq('request_status', 'approved').order('renewed_at', { ascending: false }),
        pageAll((f, t) => supabase.from('training_sessions').select('client_id, scheduled_at').in('client_id', part).or('status.eq.completed,status.eq.cancelled,cancelled.eq.true').order('scheduled_at', { ascending: false }).range(f, t), 15),
      ]);
      (tcAll.data ?? []).forEach((r: any) => { if (r.profiles) push(team as any, r.client_id, { name: fullName(r.profiles) || 'Staff', role: r.profiles.role ?? 'staff' }); });
      sessR.forEach((r: any) => push(sess, r.client_id, r));
      (upR.data ?? []).forEach((r: any) => push(upcoming, r.client_id, r));
      (qhpR.data ?? []).forEach((r: any) => push(qhpHist, r.client_id, r));
      (repR.data ?? []).forEach((r: any) => push(reports, r.client_id, r));
      (medR.data ?? []).forEach((r: any) => push(medical, r.client_id, r));
      (finR.data ?? []).forEach((r: any) => push(findings, r.client_id, r));
      (comR.data ?? []).forEach((r: any) => push(comms, r.client_id, r));
      (pauR.data ?? []).forEach((r: any) => push(pauses, r.client_id, r));
      (renR.data ?? []).forEach((r: any) => { if (!renewalOf.has(r.client_id)) renewalOf.set(r.client_id, { pkg: Number(r.package_sessions) || 0, from: r.renewed_at }); });
      consR.forEach((r: any) => push(consumedRows as any, r.client_id, r.scheduled_at));
    }

    // 3. Latest completed QHP per client → fetch its heavy jsonb and flatten (only those ids).
    const latestQhpId = new Map<string, string>(); // client -> assessment id
    qhpHist.forEach((rows, cid) => {
      const done = rows.filter((r) => r.completed != null);
      if (done.length) latestQhpId.set(cid, done[done.length - 1].id);
    });
    const metricsByAssessment = new Map<string, Record<string, any>>();
    for (const part of chunk([...latestQhpId.values()], 25)) {
      const { data } = await supabase
        .from('coach_assessment')
        .select('id, qhp_data, new_client_assessment_data, existing_client_assessment_data')
        .in('id', part);
      (data ?? []).forEach((r: any) => {
        const src = nonEmpty(r.qhp_data) ? r.qhp_data : nonEmpty(r.new_client_assessment_data) ? r.new_client_assessment_data : nonEmpty(r.existing_client_assessment_data) ? r.existing_client_assessment_data : null;
        if (src) metricsByAssessment.set(r.id, compactMetrics(src));
      });
    }

    // 4. Assemble one payload per client and write the whole book in a transaction.
    const nowIso = new Date().toISOString();
    const rowsOut = clients.map((c: any) => {
      const cid = c.id;
      const hist = qhpHist.get(cid) ?? [];
      const ren = renewalOf.get(cid);
      const pkg = ren?.pkg || Number(c.session_package) || 0;
      const from = ren?.from || c.created_at || '1970-01-01';
      const consumed = (consumedRows.get(cid) ?? []).filter((d) => d >= from).length;
      const s90 = sess.get(cid) ?? [];
      const completed90 = s90.filter((s) => s.status === 'completed');
      const latestId = latestQhpId.get(cid);
      const payload = {
        profile: {
          name: fullName(c) || 'Client', phone: c.phone ?? null, email: c.email ?? null,
          status: c.status ?? null, subscription: c.subscription_type ?? null, joinedOn: c.created_at ?? null,
        },
        team: team.get(cid) ?? [],
        package: pkg ? { size: pkg, consumed, sessionsLeft: pkg - consumed, countedSince: from } : null,
        pause: {
          onPauseNow: (pauses.get(cid) ?? []).some((p) => p.is_active && (p.pause_start == null || p.pause_start <= nowIso) && (p.pause_end == null || p.pause_end >= nowIso.slice(0, 10))),
          history: (pauses.get(cid) ?? []).map((p) => ({ from: p.pause_start, to: p.pause_end, active: p.is_active })),
        },
        sessions: {
          last90Days: s90.slice(0, 60).map((s) => ({ at: s.scheduled_at, type: s.session_type, name: s.session_name ?? null, status: s.status, rpe: s.rpe ?? null })),
          completedCount90d: completed90.length,
          lastWorkout: completed90[0]?.scheduled_at ?? null,
          upcoming7Days: (upcoming.get(cid) ?? []).map((u) => ({ at: u.scheduled_datetime, modality: u.modality ?? null, trainer: fullName(u.profiles) || null })),
        },
        qhp: {
          history: hist.map((h, i) => ({
            date: h.assessment_date, label: i === 0 ? 'QHP Baseline' : `QHP Refresh ${i}`,
            completedAt: h.completed ?? null, mechanicalScore: h.mechanical_score ?? null,
          })),
          latestCompletedMetrics: latestId ? metricsByAssessment.get(latestId) ?? null : null,
        },
        healthReports: (reports.get(cid) ?? []).slice(0, 15).map((r) => ({
          name: r.report_name ?? null, type: r.report_type ?? null, testDate: r.test_date ?? r.upload_date ?? null,
          metabolicScore: r.metabolic_score ?? null, longevityScore: r.longevity_score ?? null,
        })),
        medicalHistory: (medical.get(cid) ?? []).slice(0, 25).map((m) => ({
          date: m.event_date, title: m.title, category: m.category, severity: m.severity,
          ongoing: m.is_ongoing === true, diagnosis: m.diagnosis ?? null,
          note: typeof m.description === 'string' ? m.description.slice(0, 300) : null,
        })),
        findings: (findings.get(cid) ?? []).slice(0, 10).map((f) => ({
          date: f.created_at, title: f.title, summary: typeof f.description === 'string' ? f.description.slice(0, 300) : null,
        })),
        communications: (comms.get(cid) ?? []).slice(0, 12).map((k) => ({
          date: k.call_date, status: k.call_status ?? null, medium: k.call_medium ?? null,
          category: k.category ?? null, nextFollowUp: k.next_follow_up_date ?? null,
          remarks: typeof k.remarks === 'string' ? k.remarks.slice(0, 300) : null,
        })),
      };
      return { cid, name: payload.profile.name, json: JSON.stringify(payload) };
    });

    const db = await getDb();
    await db.withTransactionAsync(async () => {
      await db.runAsync('DELETE FROM ai_clients WHERE crm_id = ?', [crmId]); // drop unassigned
      for (const r of rowsOut) {
        await db.runAsync(
          'INSERT OR REPLACE INTO ai_clients (client_id, crm_id, name, payload, updated_at) VALUES (?, ?, ?, ?, ?)',
          [r.cid, crmId, r.name, r.json, nowIso],
        );
      }
      await db.runAsync('INSERT OR REPLACE INTO ai_meta (key, value) VALUES (?, ?)', [`last_sync:${crmId}`, nowIso]);
    });
    setStatus({ syncing: false, lastSyncAt: nowIso, clientCount: rowsOut.length, error: null });
  } catch (e: any) {
    setStatus({ syncing: false, error: String(e?.message ?? e) });
    throw e;
  }
}

/* ---------- context assembly for a question ---------- */
const CONTEXT_CHAR_CAP = 180_000;

export async function buildAiContext(crmId: string, question: string): Promise<{ context: string; clientCount: number }> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ client_id: string; name: string; payload: string }>(
    'SELECT client_id, name, payload FROM ai_clients WHERE crm_id = ? ORDER BY name', [crmId],
  );
  const q = question.toLowerCase();
  // Name match: full name, or any name word (3+ chars) present in the question.
  const scored = rows.map((r) => {
    const name = r.name.toLowerCase();
    let score = 0;
    if (name && q.includes(name)) score = name.length + 100;
    else for (const w of name.split(/\s+/)) if (w.length >= 3 && new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(q)) score = Math.max(score, w.length);
    return { r, score };
  });
  const matched = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, 3);

  // Roster summary: one line per client so aggregate questions always work.
  const rosterLines = rows.map((r) => {
    try {
      const p = JSON.parse(r.payload);
      const qhpLast = p.qhp?.history?.filter((h: any) => h.completedAt)?.slice(-1)?.[0];
      return `${r.name} | status:${p.profile?.status ?? '?'} | plan:${p.profile?.subscription ?? '?'} | sessionsLeft:${p.package?.sessionsLeft ?? 'n/a'} | lastWorkout:${(p.sessions?.lastWorkout ?? 'none').slice(0, 10)} | lastQHP:${qhpLast ? `${qhpLast.label} ${String(qhpLast.date).slice(0, 10)}` : 'none'} | paused:${p.pause?.onPauseNow ? 'yes' : 'no'}`;
    } catch { return r.name; }
  });

  let context = `MY CLIENTS (${rows.length} assigned to this CRM) — one line each:\n${rosterLines.join('\n')}`;
  for (const m of matched) {
    const block = `\n\nFULL DATA — ${m.r.name}:\n${m.r.payload}`;
    if (context.length + block.length > CONTEXT_CHAR_CAP) break;
    context += block;
  }
  return { context, clientCount: rows.length };
}

/* ---------- ask (edge function → Gemini) ---------- */
export type AiTurn = { role: 'user' | 'model'; text: string };

export async function askOddsAi(crmId: string, question: string, history: AiTurn[]): Promise<string> {
  const { context } = await buildAiContext(crmId, question);
  const invoke = supabase.functions
    .invoke('odds-ai-chat', { body: { question, context, history: history.slice(-10) } })
    .catch((e: any) => ({ data: null, error: { message: e?.message || 'Network error' } }));
  const timeout = new Promise<{ data: null; error: { message: string } }>((res) =>
    setTimeout(() => res({ data: null, error: { message: 'Timed out after 60s' } }), 60_000));
  const { data, error } = (await Promise.race([invoke, timeout])) as { data: any; error: any };
  if (error) throw new Error(error.message || 'AI request failed');
  if (data?.error) throw new Error(String(data.error));
  const answer = String(data?.answer ?? '').trim();
  if (!answer) throw new Error('The AI returned an empty answer. Try again.');
  return answer;
}
