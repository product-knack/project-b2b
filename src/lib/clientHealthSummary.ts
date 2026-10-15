/* "Listen before the session" (9 Oct 2026): pure rules for the spoken client
   summaries and the listen gate. Backend shared with the web (hub-track
   migrations 20261009100000 / 110000 / 120000): one client_health_summary row
   per client, rebuilt by edge functions; the device speaks the script, nothing
   is stored as audio. Shapes follow docs/client-health-summary-handoff.md. */

export type Which = 'weekly' | 'context';

export type ListenEntry = {
  at: string;
  by: string;
  by_name?: string | null;
  role?: string | null;
  which: Which;
  version?: number | null;
};

export type WeeklySummary = {
  generated_at?: string | null;
  window_from?: string | null;
  window_to?: string | null;
  script: string;
  highlights?: string[] | null;
  version?: number | null;
  fallback?: boolean | null;
  fallback_reason?: string | null;
  facts?: Record<string, unknown> | null;
};

export type ContextFinding = {
  key?: string | null;
  label?: string | null;
  text?: string | null;
  value?: unknown;
  previous?: unknown;
  unit?: string | null;
  date?: string | null;
};

export type ContextSummary = {
  generated_at?: string | null;
  script: string;
  sources?: { type: string; id?: string | null; date?: string | null; label?: string | null }[] | null;
  improved?: ContextFinding[] | null;
  worsened?: ContextFinding[] | null;
  watch?: ContextFinding[] | null;
  medical_events?: { text?: string | null; date?: string | null; days_ago?: number | null; ongoing?: boolean | null }[] | null;
  exclusions_confirmed?: boolean | null;
  version?: number | null;
  fallback?: boolean | null;
  fallback_reason?: string | null;
};

export type ClientHealthSummaryRow = {
  client_id: string;
  weekly_summary: WeeklySummary | null;
  /** since 10 Oct 2026 the row is one per training day; these two mirror the summaries' own generated_at */
  weekly_generated_at: string | null;
  context_summary: ContextSummary | null;
  context_generated_at: string | null;
  context_dirty: boolean | null;
  listen_history: ListenEntry[] | null;
  /** the training day this row is for (YYYY-MM-DD IST); the row in effect for the date asked */
  briefing_date?: string | null;
  status?: 'building' | 'ready' | null;
  built_at?: string | null;
};

export const TITLES: Record<Which, string> = { weekly: "This week's training", context: 'Health context' };

/** About 2.4 spoken words a second (the web card's estimate). */
export const WORDS_PER_SECOND = 2.4;
export const scriptWords = (script: string | null | undefined): number =>
  (script ?? '').trim().split(/\s+/).filter(Boolean).length;
export const durationText = (script: string | null | undefined): string => {
  const secs = Math.round(scriptWords(script) / WORDS_PER_SECOND);
  return secs < 60 ? `${secs} sec` : `${Math.floor(secs / 60)} min ${secs % 60} sec`;
};

const stampFmt = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
/** "9 Oct, 2:15 pm" in IST; the raw string when unparsable. */
export const fmtStamp = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return iso;
  return stampFmt.format(new Date(t)).replace(/\s?(am|pm)$/i, (m) => m.toLowerCase());
};

const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
/** 'YYYY-MM-DD' of an instant in IST. */
export const istDayOf = (isoOrMs: string | number): string => dayFmt.format(new Date(isoOrMs));

export const historyOf = (row: ClientHealthSummaryRow | null | undefined): ListenEntry[] =>
  Array.isArray(row?.listen_history) ? (row!.listen_history as ListenEntry[]).filter((h) => h && typeof h.at === 'string') : [];

export const summaryOf = (row: ClientHealthSummaryRow | null | undefined, which: Which): WeeklySummary | ContextSummary | null =>
  which === 'weekly' ? row?.weekly_summary ?? null : row?.context_summary ?? null;

export const generatedAtOf = (row: ClientHealthSummaryRow | null | undefined, which: Which): string | null =>
  which === 'weekly'
    ? row?.weekly_generated_at ?? row?.weekly_summary?.generated_at ?? null
    : row?.context_generated_at ?? row?.context_summary?.generated_at ?? null;

export const hasScript = (row: ClientHealthSummaryRow | null | undefined, which: Which): boolean =>
  !!summaryOf(row, which)?.script?.trim();

/** The signed-in user's newest listen of that kind (the trail is oldest first). */
export const myLastListen = (history: ListenEntry[], which: Which, uid: string | null | undefined): ListenEntry | null => {
  if (!uid) return null;
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (h.which === which && h.by === uid) return h;
  }
  return null;
};

/** Anyone's newest listen of that kind. */
export const lastListen = (history: ListenEntry[], which: Which): ListenEntry | null => {
  for (let i = history.length - 1; i >= 0; i--) if (history[i].which === which) return history[i];
  return null;
};

/** "New since you listened": built after the signed-in user's last listen, or never listened. */
export const isNewSince = (row: ClientHealthSummaryRow | null | undefined, which: Which, uid: string | null | undefined): boolean => {
  const g = generatedAtOf(row, which);
  if (!hasScript(row, which) || !g) return false;
  const mine = myLastListen(historyOf(row), which, uid);
  return !mine || new Date(mine.at).getTime() < new Date(g).getTime();
};

/* ---------- Listen gate (user, 9 Oct 2026) ----------
   A session logged from Today's Roster first needs the summaries heard:
   - This week's training ("daily wala daily"): heard on the same IST day as
     today AND after its latest build (it is rebuilt every night).
   - Health context ("weekly wala jab bhi new report se update ho"): heard after
     its latest build, whenever a new report rebuilt it.
   A summary that does not exist cannot be required ('none'). */
export type GateState = 'none' | 'done' | 'due';

export const gateStateFor = (row: ClientHealthSummaryRow | null | undefined, which: Which, uid: string | null | undefined, nowMs: number = Date.now()): GateState => {
  const g = generatedAtOf(row, which);
  if (!hasScript(row, which) || !g) return 'none';
  const mine = myLastListen(historyOf(row), which, uid);
  if (!mine) return 'due';
  const heardAt = new Date(mine.at).getTime();
  if (!isFinite(heardAt) || heardAt < new Date(g).getTime()) return 'due';
  if (which === 'weekly' && istDayOf(mine.at) !== istDayOf(nowMs)) return 'due';
  return 'done';
};

export type ListenGate = { weekly: GateState; context: GateState };
export const listenGate = (row: ClientHealthSummaryRow | null | undefined, uid: string | null | undefined, nowMs: number = Date.now()): ListenGate => ({
  weekly: gateStateFor(row, 'weekly', uid, nowMs),
  context: gateStateFor(row, 'context', uid, nowMs),
});
export const gateDue = (g: ListenGate): boolean => g.weekly === 'due' || g.context === 'due';

/* ---------- Speech chunking ----------
   Android TTS refuses one utterance longer than Speech.maxSpeechInputLength
   (about 4000 characters). Split a long script at sentence ends and queue the
   pieces; a single over-long sentence is cut at the limit. */
export const splitForSpeech = (script: string, max: number): string[] => {
  const text = (script ?? '').trim();
  if (!text) return [];
  if (!(max > 0) || text.length <= max) return [text];
  const sentences = text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [text];
  const out: string[] = [];
  let cur = '';
  for (const s of sentences) {
    if ((cur + s).length > max && cur.trim()) { out.push(cur.trim()); cur = s; } else cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.flatMap((p) => (p.length <= max ? [p] : p.match(new RegExp(`[\\s\\S]{1,${max}}`, 'g')) ?? [p]));
};
