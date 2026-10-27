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
   A summary that does not exist cannot be required ('none').
   24 Oct 2026: the server keeps the context's generated_at until a real update and
   get_client_health_summary carries each person's newest earlier-day context listen
   (carried: true), so the context is heard once per update, not once per day. */
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

/* ---------- The rule, written once (27 Oct 2026) ----------
   Owner: "add the rule everywhere so the trainer knows why it matters and cannot log without it". Every
   surface with the two Play rows (Today's Roster strip, the Log Health Data popup, the client page, the gate
   sheet, My Crew) shows the same header and the same line under each row. */
export const LISTEN_WHY = 'Each summary must be heard once after it changes, or Submit stays off.';
export const LISTEN_HEADER_DUE = 'NOT HEARD · LISTEN NOW';
export const LISTEN_HEADER_OK = 'CLIENT SUMMARIES';
export const listenHeaderText = (g: ListenGate): string => (gateDue(g) ? LISTEN_HEADER_DUE : LISTEN_HEADER_OK);

/** The line under a Play row. Null when that summary does not exist. */
export const listenRuleLine = (which: Which, state: GateState, clientFirstName?: string | null): string | null => {
  const name = (clientFirstName ?? '').trim().split(/\s+/)[0] || 'this client';
  if (state === 'none') return null;
  if (state === 'done') return 'Heard after the latest update. You can log.';
  return which === 'context'
    ? `Listen to this at least once. It changed since you last heard it. You cannot log a workout for ${name} until you do.`
    : `Listen to this at least once today. You cannot log ${name}'s workout until you do.`;
};

/** My Crew: the chip on a client row and the sentence in the Listen now sheet. */
export const LISTEN_CHIP_DUE = 'NOT HEARD · LISTEN NOW';
export const LISTEN_CHIP_OK = 'HEARD';
export const listenNowLine = (clientFirstName: string | null | undefined, when: 'tomorrow' | 'today' = 'tomorrow'): string =>
  `You have not heard ${(clientFirstName ?? '').trim().split(/\s+/)[0] || 'this client'}'s summaries. You cannot log ${when}'s session without this. Listen now.`;

/** One row of get_my_listen_status (a batched read for My Crew): the same gate, computed from flat fields. */
export type ListenStatusRow = {
  client_id: string;
  has_weekly: boolean;
  has_context: boolean;
  weekly_generated_at: string | null;
  context_generated_at: string | null;
  my_last_weekly_at: string | null;
  my_last_context_at: string | null;
};
export const gateFromStatus = (s: ListenStatusRow | null | undefined, nowMs: number = Date.now()): ListenGate => {
  const one = (which: Which): GateState => {
    if (!s) return 'none';
    const has = which === 'weekly' ? s.has_weekly : s.has_context;
    const g = which === 'weekly' ? s.weekly_generated_at : s.context_generated_at;
    const mine = which === 'weekly' ? s.my_last_weekly_at : s.my_last_context_at;
    if (!has || !g) return 'none';
    if (!mine) return 'due';
    const heardAt = new Date(mine).getTime();
    if (!isFinite(heardAt) || heardAt < new Date(g).getTime()) return 'due';
    if (which === 'weekly' && istDayOf(mine) !== istDayOf(nowMs)) return 'due';
    return 'done';
  };
  return { weekly: one('weekly'), context: one('context') };
};

/* ---------- The Add Workout listen sheet (22 Oct 2026) ----------
   Owner: "after both listens the trainer must tap Proceed to workout". Play records the listen on the server at
   once, so the refreshed row reads "done" seconds into the audio. Before this fix the second Play therefore made
   the form decide nothing was due, close the sheet (which stopped the voice) and open the workout form, and the
   button counted an item as heard the moment Play was tapped. Two rules close it:
   1. listenSheetUp: once the sheet has been needed it stays up until the trainer taps Proceed (armed), whatever
      the row says after a refresh.
   2. listenStillNeeded / listenAllHeard: what is due is judged from the row AS IT WAS WHEN THE SHEET OPENED
      (atOpen), and an item counts only when its audio played to the end on this phone (or its transcript stood in
      because nothing could speak). */
export type HeardMap = Record<Which, boolean>;
export const LISTEN_PROCEED = 'Proceed to workout';
export const LISTEN_WAIT = 'Listen first';

export const listenSheetUp = (o: { done: boolean; armed: boolean; eligible: boolean; due: boolean }): boolean =>
  !o.done && (o.armed || (o.eligible && o.due));

export const listenStillNeeded = (atOpen: ListenGate, heard: HeardMap, which: Which): boolean =>
  atOpen[which] === 'due' && !heard[which];

export const listenAllHeard = (atOpen: ListenGate, heard: HeardMap): boolean =>
  !listenStillNeeded(atOpen, heard, 'weekly') && !listenStillNeeded(atOpen, heard, 'context');

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
