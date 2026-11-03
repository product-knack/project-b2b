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
  /** Progress (3 Nov 2026): the best percent of this listen; absent on a legacy play (counts as heard). */
  percent?: number | null;
  heard?: boolean | null;
  heard_at?: string | null;
  carried?: boolean | null;
  briefing_date?: string | null;
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

/* ---------- Listen progress (3 Nov 2026) ----------
   Owner: "show everyone in percent how much they listened, and an alert to listen to 100 percent so the session
   log needs no second listen; 95 percent and above counts as 100". A trail entry now carries percent / heard; an
   entry WITHOUT a percent key is a play from before this rule and counts as heard. */
export const HEARD_PERCENT = 95;
export const entryPercent = (e: ListenEntry | null | undefined): number =>
  !e ? 0 : e.percent == null ? 100 : Math.max(0, Math.min(100, Math.round(Number(e.percent) || 0)));
export const entryHeard = (e: ListenEntry | null | undefined): boolean => !!e && (e.percent == null ? true : entryPercent(e) >= HEARD_PERCENT);
/** The moment an entry counts as heard: heard_at when the server stamped it, else its at. */
export const entryHeardAt = (e: ListenEntry): string => e.heard_at ?? e.at;

/** The signed-in user's newest listen of that kind (the trail is oldest first). */
export const myLastListen = (history: ListenEntry[], which: Which, uid: string | null | undefined): ListenEntry | null => {
  if (!uid) return null;
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (h.which === which && h.by === uid) return h;
  }
  return null;
};
/** The signed-in user's newest HEARD listen of that kind (percent at or above the threshold, or a legacy play). */
export const myLastHeard = (history: ListenEntry[], which: Which, uid: string | null | undefined): ListenEntry | null => {
  if (!uid) return null;
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (h.which === which && h.by === uid && entryHeard(h)) return h;
  }
  return null;
};
/** The signed-in user's best percent for the CURRENT build of that kind (0 when nothing since the build). */
export const myProgress = (row: ClientHealthSummaryRow | null | undefined, which: Which, uid: string | null | undefined): number => {
  const g = generatedAtOf(row, which);
  if (!uid || !g) return 0;
  const built = new Date(g).getTime();
  let best = 0;
  for (const h of historyOf(row)) {
    if (h.which !== which || h.by !== uid) continue;
    if (new Date(h.at).getTime() < built && !(h.carried && entryHeard(h))) continue;
    best = Math.max(best, entryPercent(h));
  }
  return best;
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

/** Since 3 Nov 2026 only a HEARD listen (95 percent or more, or a legacy play) can make a summary done; `local`
    is the phone's own record for the current build (an offline listen not yet synced), merged in by the caller. */
export const gateStateFor = (row: ClientHealthSummaryRow | null | undefined, which: Which, uid: string | null | undefined, nowMs: number = Date.now(), local?: LocalListen | null): GateState => {
  const g = generatedAtOf(row, which);
  if (!hasScript(row, which) || !g) return 'none';
  const built = new Date(g).getTime();
  const mine = myLastHeard(historyOf(row), which, uid);
  const ok = (atIso: string): boolean => {
    const heardAt = new Date(atIso).getTime();
    if (!isFinite(heardAt) || heardAt < built) return false;
    if (which === 'weekly' && istDayOf(atIso) !== istDayOf(nowMs)) return false;
    return true;
  };
  if (mine && ok(entryHeardAt(mine))) return 'done';
  const v = summaryOf(row, which)?.version ?? null;
  if (local && local.which === which && local.heard && local.heardAt && (local.version == null || v == null || local.version === v) && local.generatedAt === g && ok(local.heardAt)) return 'done';
  return 'due';
};

export type ListenGate = { weekly: GateState; context: GateState };
/** The phone's own record of one listen (listenLocal.ts): what this phone heard of a build, synced or not. */
export type LocalListen = {
  clientId: string;
  which: Which;
  version: number | null;
  /** The build this record is for (generated_at); another build means a new summary, the record no longer counts. */
  generatedAt: string | null;
  briefingDate: string | null;
  percent: number;
  heard: boolean;
  heardAt: string | null;
  at: string;
  synced: boolean;
};
export type LocalListens = Partial<Record<Which, LocalListen | null>>;
export const listenGate = (row: ClientHealthSummaryRow | null | undefined, uid: string | null | undefined, nowMs: number = Date.now(), local?: LocalListens | null): ListenGate => ({
  weekly: gateStateFor(row, 'weekly', uid, nowMs, local?.weekly ?? null),
  context: gateStateFor(row, 'context', uid, nowMs, local?.context ?? null),
});

/** The percent to show for one row: the server's best for the current build merged with the phone's record. */
export const mergedProgress = (row: ClientHealthSummaryRow | null | undefined, which: Which, uid: string | null | undefined, local?: LocalListen | null): number => {
  const server = myProgress(row, which, uid);
  const g = generatedAtOf(row, which);
  const mine = local && local.which === which && local.generatedAt === g ? local.percent : 0;
  return Math.max(server, mine);
};
/** The lines under a Play row's progress bar (owner's words, 3 Nov 2026). */
export const LISTEN_100_ALERT = 'Listen to 100 percent now, so you do not have to listen again when you log the session.';
export const LISTEN_100_OK = 'Heard 100 percent, you can log.';
export const progressLine = (percent: number): string => (percent >= HEARD_PERCENT ? LISTEN_100_OK : `You: ${Math.max(0, Math.min(100, Math.round(percent)))} percent heard`);
export const LISTEN_OFFLINE_SAVED = 'Saved on this phone · syncs when online';
export const LISTEN_NO_SCRIPT_OFFLINE = (first: string) => `Connect once to load ${first}'s summaries.`;
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
/** The short form for crowded rows (Tomorrow's Plan, 30 Oct 2026); the chip's accessibility label keeps the full sense. */
export const LISTEN_CHIP_DUE_SHORT = 'NOT HEARD';
export const listenNowLine = (clientFirstName: string | null | undefined, when: 'tomorrow' | 'today' = 'tomorrow'): string =>
  `You have not heard ${(clientFirstName ?? '').trim().split(/\s+/)[0] || 'this client'}'s summaries. You cannot log ${when}'s session without this. Listen now.`;

/** One row of get_my_listen_status (a batched read for My Crew): the same gate, computed from flat fields.
    Since 3 Nov 2026 the heard columns decide; the old my_last_*_at columns stay for older builds. */
export type ListenStatusRow = {
  client_id: string;
  has_weekly: boolean;
  has_context: boolean;
  weekly_generated_at: string | null;
  context_generated_at: string | null;
  my_last_weekly_at: string | null;
  my_last_context_at: string | null;
  weekly_version?: number | null;
  context_version?: number | null;
  my_weekly_percent?: number | null;
  my_context_percent?: number | null;
  my_weekly_heard?: boolean | null;
  my_context_heard?: boolean | null;
  my_weekly_heard_at?: string | null;
  my_context_heard_at?: string | null;
};
/** True when the listen chip has something to say (a summary exists for at least one kind). */
export const listenChipShown = (s: ListenStatusRow | null | undefined, nowMs: number = Date.now()): boolean => {
  const g = gateFromStatus(s, nowMs);
  return !(g.weekly === 'none' && g.context === 'none');
};
export const gateFromStatus = (s: ListenStatusRow | null | undefined, nowMs: number = Date.now(), local?: LocalListens | null): ListenGate => {
  const one = (which: Which): GateState => {
    if (!s) return 'none';
    const has = which === 'weekly' ? s.has_weekly : s.has_context;
    const g = which === 'weekly' ? s.weekly_generated_at : s.context_generated_at;
    if (!has || !g) return 'none';
    const built = new Date(g).getTime();
    const ok = (atIso: string): boolean => {
      const t = new Date(atIso).getTime();
      if (!isFinite(t) || t < built) return false;
      if (which === 'weekly' && istDayOf(atIso) !== istDayOf(nowMs)) return false;
      return true;
    };
    // The server before this rule had no heard columns: fall back to the last play, as before.
    const heardKnown = which === 'weekly' ? s.my_weekly_heard : s.my_context_heard;
    const heardAt = which === 'weekly' ? (s.my_weekly_heard_at ?? null) : (s.my_context_heard_at ?? null);
    const mine = heardKnown == null ? (which === 'weekly' ? s.my_last_weekly_at : s.my_last_context_at) : heardKnown ? (heardAt ?? (which === 'weekly' ? s.my_last_weekly_at : s.my_last_context_at)) : null;
    if (mine && ok(mine)) return 'done';
    const l = local?.[which];
    if (l && l.heard && l.heardAt && l.generatedAt === g && ok(l.heardAt)) return 'done';
    return 'due';
  };
  return { weekly: one('weekly'), context: one('context') };
};
/** My Crew chip text and tone from the status and the phone's record: HEARD 100 / 60 PERCENT · FINISH / NOT HEARD. */
export const statusPercent = (s: ListenStatusRow | null | undefined, which: Which, local?: LocalListens | null): number => {
  const server = which === 'weekly' ? Number(s?.my_weekly_percent ?? 0) : Number(s?.my_context_percent ?? 0);
  const g = which === 'weekly' ? s?.weekly_generated_at : s?.context_generated_at;
  const l = local?.[which];
  const mine = l && g && l.generatedAt === g ? l.percent : 0;
  return Math.max(server || 0, mine);
};
export const listenChipText = (gate: ListenGate, percents: Record<Which, number>, compact = false): { text: string; tone: 'red' | 'amber' | 'green' } => {
  const due = gateDue(gate);
  if (!due) return { text: 'HEARD 100', tone: 'green' };
  const dueKinds = (['weekly', 'context'] as Which[]).filter((w) => gate[w] === 'due');
  const least = Math.min(...dueKinds.map((w) => percents[w] ?? 0));
  if (least > 0) return { text: `${Math.round(least)} PERCENT · FINISH`, tone: 'amber' };
  return { text: compact ? LISTEN_CHIP_DUE_SHORT : LISTEN_CHIP_DUE, tone: 'red' };
};
/** One line of the My Crew "Who listened" block, from get_crew_listen_progress rows (best per person per kind). */
export type CrewListenRow = { client_id: string; which: Which; by: string; by_name: string | null; role: string | null; percent: number; heard: boolean; at: string | null; version: number | null };
export type CrewListenLine = { by: string; name: string; weekly: number | null; context: number | null; weeklyHeard: boolean; contextHeard: boolean };
export const crewListenLines = (rows: CrewListenRow[], clientId: string, members: { id: string; name: string }[]): { crew: CrewListenLine[]; others: CrewListenLine[] } => {
  const byId = new Map<string, CrewListenLine>();
  const line = (id: string, name: string): CrewListenLine => byId.get(id) ?? (byId.set(id, { by: id, name, weekly: null, context: null, weeklyHeard: false, contextHeard: false }), byId.get(id)!);
  for (const m of members) line(m.id, m.name);
  for (const r of rows) {
    if (r.client_id !== clientId) continue;
    const l = line(r.by, r.by_name ?? 'Unknown');
    if (r.which === 'weekly') { l.weekly = Math.max(l.weekly ?? 0, r.percent); l.weeklyHeard = l.weeklyHeard || r.heard; }
    else { l.context = Math.max(l.context ?? 0, r.percent); l.contextHeard = l.contextHeard || r.heard; }
  }
  const memberIds = new Set(members.map((m) => m.id));
  const all = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { crew: all.filter((l) => memberIds.has(l.by)), others: all.filter((l) => !memberIds.has(l.by)) };
};
export const crewLineText = (l: CrewListenLine): string => {
  const one = (p: number | null, heard: boolean) => (p == null ? '0 percent' : heard ? '100 percent' : `${Math.round(p)} percent`);
  return `This week ${one(l.weekly, l.weeklyHeard)} · Health context ${one(l.context, l.contextHeard)}`;
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
