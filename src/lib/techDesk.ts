import { registerTeardown } from './sessionTeardown';

/* ============ Tech Desk — shared vocabulary, types and derivations ============
   The backend (tables, enums, triggers, RPCs, storage, realtime) is LIVE and
   shared with the web client (hub-track). Both clients read each other's rows,
   so every string here must stay byte-identical to the web's src/lib/techDesk.ts:
   enum values, message payload shapes and the derived labels users read.
   Nothing in this file talks to the network — see techDeskQueries.ts. */

export type TechType = 'bug' | 'feature' | 'research' | 'other';
export type TechPriority = 'low' | 'medium' | 'high' | 'urgent';
export type TechStatus = 'open' | 'in_progress' | 'waiting_on_reporter' | 'testing' | 'resolved' | 'closed';
export type TechResolution = 'fixed' | 'wont_fix' | 'not_a_bug';
export type TechPlatform = 'web' | 'ios' | 'android' | 'none';

export type TechPerson = { id: string; first_name: string | null; last_name: string | null; role: string | null; avatar_url: string | null };

/** Lifecycle stamps. Written by DB triggers / RPCs only — never patch this from a client. */
export type TechTimeline = {
  updated_at?: string; resolved_at?: string; closed_at?: string;
  reporter_seen_at?: string; tech_seen_at?: string;
};

/* The reporter's answer to a resolution. Written ONLY by the
   tech_ticket_acknowledge RPC (reporters cannot UPDATE tech_tickets at all),
   so nothing here is ever patched from a client. */
export type TechAckVerdict = 'confirmed' | 'reopened';
export type TechAckEntry = {
  by: string;
  by_name?: string | null;
  at: string;
  verdict: TechAckVerdict;
  note?: string | null;
  /** timeline.resolved_at of the resolution this answers. */
  resolved_at?: string | null;
};
/** Latest acknowledgement, with the earlier rounds underneath (oldest first, last 20). */
export type TechAck = TechAckEntry & { history?: TechAckEntry[] };

/* Staff bookkeeping. Written ONLY by tech_ticket_set_time_taken (the server stamps
   by/by_name/at). Staff-only in the UI: reporters can read it through RLS but nothing
   renders it for them, and it is deliberately NOT logged to the thread, because a
   system row for effort would trip the reporter's unread dot and alert banner. */
export type TechTimeTaken = { minutes: number; by: string; by_name?: string | null; at: string };
/** Why a ticket was closed. Written ONLY by tech_ticket_close_with_reason. Permanent:
    it stays on the row if the ticket is later reopened. */
export type TechClosure = {
  reason: string; by: string; by_name?: string | null;
  by_role: 'reporter' | 'staff'; at: string;
};

export type TechTicket = {
  id: string;
  serial_no: number;
  type: TechType;
  priority: TechPriority;
  status: TechStatus;
  resolution: TechResolution | null;
  title: string;
  description: string;
  platforms: TechPlatform[];
  route: string | null;
  created_by: string;
  assigned_to: string | null;
  created_at: string;
  timeline: TechTimeline | null;
  acknowledgement: TechAck | null;
  /** Staff-written type name. When set it IS the displayed type and `type` is 'other'. */
  type_label?: string | null;
  time_taken?: TechTimeTaken | null;
  closure?: TechClosure | null;
  creator?: TechPerson | null;
  assignee?: TechPerson | null;
};

/* 'audio' is a NATIVE-FIRST addition for voice memos. The web client's union is
   still image|video|pdf, so until it learns 'audio' a voice memo sent from the app
   renders as an unknown attachment there (and the storage bucket must allow
   audio/* — see docs/tech-desk-voice-memo.sql). */
export type TechFile = { path: string; name: string; mime: string; size: number; kind: 'image' | 'video' | 'pdf' | 'audio' };
export type TechMessagePayload =
  | { type: 'text'; text: string }
  | { type: 'file'; file: TechFile; text?: string }
  | { type: 'system'; event: 'created' | 'status' | 'priority' | 'assignee' | 'type'; from: string | null; to: string | null };

export type TechMessage = {
  id: string;
  ticket_id: string;
  sender_id: string | null;
  message: TechMessagePayload;
  created_at: string;
  sender?: TechPerson | null;
};

/* ---------- labels (shared with web, verbatim) ----------
   The web keeps these in one TYPE_META record; native has always used separate maps
   and the VALUES are what has to match, not the container. */
export const TYPE_LABEL: Record<TechType, string> = { bug: 'Bug', feature: 'Feature', research: 'Research', other: 'Other' };
/** Longer label for the console's ticket header. */
export const TYPE_LABEL_LONG: Record<TechType, string> = { bug: 'Bug', feature: 'Feature request', research: 'Research', other: 'Other (to be filed)' };
/** One icon per type — kept here so a new type never means hunting nested ternaries. */
export const TYPE_ICON: Record<TechType, 'alert' | 'sparkle' | 'search' | 'help'> = { bug: 'alert', feature: 'sparkle', research: 'search', other: 'help' };
/** The description prompt changes with the type (the web asks the same questions). */
export const TYPE_PROMPT: Record<TechType, string> = {
  bug: 'What happened, and what did you expect?',
  feature: 'What should it do?',
  research: 'What should we look into, and what decision does it inform?',
  other: 'What do you need?',
};
export const ALL_TYPES: TechType[] = ['bug', 'feature', 'research', 'other'];
export const ALL_PLATFORMS: TechPlatform[] = ['web', 'ios', 'android', 'none'];
export const TYPE_LABEL_MAX = 40;
/** Quick picks on the staff time control, in minutes. */
export const TIME_PRESETS = [15, 30, 60, 120, 240, 480];

/* ---------- the displayed type ----------
   Staff can write a type by hand (`type_label`); the enum is 'other' underneath.
   When a label is set it IS the type everywhere: rows, detail, thread, filters.
   Never show "Other" next to a written label, or the ticket reads as unfiled. */
export const typeLabelOf = (t: Pick<TechTicket, 'type' | 'type_label'>) =>
  t.type_label?.trim() || TYPE_LABEL[t.type] || t.type;
export const typeLongOf = (t: Pick<TechTicket, 'type' | 'type_label'>) =>
  t.type_label?.trim() || TYPE_LABEL_LONG[t.type] || t.type;
/** 'Other' with nothing written on it: Tech is expected to re-file it. */
export const isUnfiled = (t: Pick<TechTicket, 'type' | 'type_label'>) => t.type === 'other' && !t.type_label?.trim();
/** Distinct written labels, most used first then alphabetical — the picker's reuse chips.
    This is what keeps spellings converging without a taxonomy screen. */
export function customTypeLabels(tickets: Pick<TechTicket, 'type_label'>[]): string[] {
  const n = new Map<string, number>();
  for (const t of tickets) {
    const l = t.type_label?.trim();
    if (l) n.set(l, (n.get(l) ?? 0) + 1);
  }
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([l]) => l);
}

/** 'none' is exclusive: picking it clears the rest, picking anything else drops it. */
export const togglePlatformIn = (cur: TechPlatform[], p: TechPlatform): TechPlatform[] => {
  if (p === 'none') return cur.includes('none') ? [] : ['none'];
  const base = cur.filter((x) => x !== 'none');
  return base.includes(p) ? base.filter((x) => x !== p) : [...base, p];
};

/** 150 -> "2h 30m", 45 -> "45m", 120 -> "2h". */
export const fmtMinutes = (min: number) => {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h === 0 ? `${r}m` : r === 0 ? `${h}h` : `${h}h ${r}m`;
};
export const splitMinutes = (min: number) => ({ hours: Math.floor(Math.max(0, min) / 60), minutes: Math.max(0, Math.round(min)) % 60 });
export const PRIORITY_LABEL: Record<TechPriority, string> = { low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' };
export const STATUS_LABEL: Record<TechStatus, string> = {
  open: 'Open', in_progress: 'In Progress', waiting_on_reporter: 'Waiting on Reporter',
  testing: 'Testing', resolved: 'Resolved', closed: 'Closed',
};
export const RESOLUTION_LABEL: Record<TechResolution, string> = { fixed: 'Fixed', wont_fix: "Won't fix", not_a_bug: 'Not a bug' };
export const PLATFORM_LABEL: Record<TechPlatform, string> = { web: 'Web', ios: 'iOS', android: 'Android', none: 'None' };
/** How a platform reads on a ticket, where "None" alone would be ambiguous. */
export const PLATFORM_ON_TICKET: Record<TechPlatform, string> = { web: 'Web', ios: 'iOS', android: 'Android', none: 'No platform' };

/** Tickets that count as "active"/in queue. */
export const OPEN_STATUSES: TechStatus[] = ['open', 'in_progress', 'waiting_on_reporter', 'testing'];
export const isOpenStatus = (s: TechStatus) => OPEN_STATUSES.includes(s);

/* ---------- acknowledgement (§ the resolved -> closed gate) ----------
   Resolved is Tech's claim, not the end. The person who raised the ticket has to
   answer it: confirming closes the ticket, rejecting sends it back to In Progress.
   Both answers are applied by the RPC in the same statement that writes the
   acknowledgement, so a ticket left sitting in `resolved` is, by definition, one
   nobody has answered yet — status alone is the whole gate, no stamp maths. */
export const ACK_VERDICT_LABEL: Record<TechAckVerdict, string> = { confirmed: 'Confirmed fixed', reopened: 'Sent back' };
export const awaitingAck = (t: TechTicket) => t.status === 'resolved';
export const awaitingMyAck = (t: TechTicket, meId: string) => t.status === 'resolved' && t.created_by === meId;
/** "Nirdosh Sharma confirmed the fix · 05-Sep-2026 4:32 pm" — for the closed banner and the console. */
export function ackLine(a: TechAck | null | undefined): string | null {
  if (!a) return null;
  const who = a.by_name?.trim() || 'The reporter';
  const what = a.verdict === 'confirmed' ? 'confirmed the fix' : 'sent this back';
  return `${who} ${what} · ${fullStamp(a.at)}`;
}

/* ---------- what the Tech side has not looked at yet ----------
   tech_seen_at is ONE stamp for the whole Tech team, so the first person to open
   a ticket clears it for everyone. That is right for a shared queue: the job is
   "has anyone picked this up", not "have I personally read it". */
/** Raised, still live, and nobody on the Tech side has opened it. */
export const isNewForStaff = (t: TechTicket) => !t.timeline?.tech_seen_at && isOpenStatus(t.status);
/** The reporter answered a resolution since Tech last looked. Returns the answer, so
    the caller gets the verdict and note without re-reading the column. */
export const freshAck = (t: TechTicket): TechAck | null =>
  t.acknowledgement && stampMs(t.acknowledgement.at) > stampMs(t.timeline?.tech_seen_at) ? t.acknowledgement : null;

/** The reporter-facing journey. waiting_on_reporter renders as a note under In Progress. */
export const STAGE_ORDER: TechStatus[] = ['open', 'in_progress', 'testing', 'resolved'];
export const STAGE_LABEL: Record<string, string> = { open: 'Raised', in_progress: 'In Progress', testing: 'Testing', resolved: 'Resolved' };

/* ---------- console palette (dark, one accent — cyan) ---------- */
export const TECH = {
  ground: '#070B12',
  panel: '#0C121C',
  panel2: '#111926',
  line: 'rgba(120,190,255,0.12)',
  cyan: '#5CE1E6',
  cyanDim: '#2C7F8C',
  ink: '#E6EDF6',
  ink2: '#B7C4D4',
  muted: '#7E8CA0',
  faint: '#5A6779',
} as const;

/* Muted status colours; red is reserved for urgent + overdue signals.
   `open` is the app's warm accent on member screens and the console's cyan on the
   console — everywhere else the two palettes agree, so one map plus the override
   below keeps web parity without dropping a cold cyan chip into the warm theme. */
export const STATUS_COLOR: Record<TechStatus, string> = {
  open: '#F47A2A', in_progress: '#7C8FE8', waiting_on_reporter: '#E0A53C',
  testing: '#9A7BEA', resolved: '#57C98A', closed: '#7E8CA0',
};
/** Status colour for a surface: `dark` = the tech console. */
export const statusColor = (s: TechStatus, dark?: boolean) => (dark && s === 'open' ? TECH.cyan : STATUS_COLOR[s]);
export const PRIORITY_COLOR: Record<TechPriority, string> = { low: '#7E8CA0', medium: '#7C8FE8', high: '#E0A53C', urgent: '#E76A52' };
export const PRIORITY_WEIGHT: Record<TechPriority, number> = { urgent: 3, high: 2, medium: 1, low: 0 };

/* ---------- small helpers ---------- */
/** Display only — never stored. T001 … T999, T1000. */
export const ticketNo = (serial: number) => `T${String(serial).padStart(3, '0')}`;
/** "T042" | "t42" | "42" -> 42 ; anything else -> null */
export function parseTicketNo(q: string): number | null {
  const m = /^t?\s*0*(\d+)$/i.exec(q.trim());
  return m ? Number(m[1]) : null;
}
export const personName = (p?: TechPerson | null) =>
  p ? `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || 'Unknown' : 'Unknown';
export const initialsOf = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';

export function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return '';
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' });
}
/** "03-Sep-2026 4:55 pm" — the app's IST display convention. */
export function fullStamp(iso: string): string {
  const d = new Date(iso);
  if (!isFinite(d.getTime())) return '';
  const date = d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');
  const time = d.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true });
  return `${date} ${time}`;
}
export const stampMs = (iso?: string | null) => (iso ? new Date(iso).getTime() || 0 : 0);

export const fileKindOf = (mime: string): TechFile['kind'] =>
  mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : 'pdf';
/** mm:ss for voice-memo timers and progress. */
export const clockOf = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
export function fmtBytes(n: number): string {
  if (!n) return '';
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

/* ---------- sorting (console + member list share it) ---------- */
export function sortTickets(rows: TechTicket[]): TechTicket[] {
  return [...rows].sort((a, b) => {
    const aOpen = isOpenStatus(a.status) ? 1 : 0;
    const bOpen = isOpenStatus(b.status) ? 1 : 0;
    if (aOpen !== bOpen) return bOpen - aOpen;                       // active first
    const w = PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority];
    if (w) return w;                                                  // urgent first
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

/* ---------- stage timeline (reporter + console stage strip) ---------- */
export function stageIndexOf(status: TechStatus): number {
  if (status === 'closed') return 3;
  if (status === 'waiting_on_reporter') return 1;                     // shown as In Progress + a waiting note
  const i = STAGE_ORDER.indexOf(status);
  return i < 0 ? 0 : i;
}
/** Latest `system/status` message per status, plus the trigger stamps, = when each stage was reached. */
export function reachedAtMap(ticket: TechTicket, messages: TechMessage[]): Map<string, string> {
  const reached = new Map<string, string>();
  reached.set('open', ticket.created_at);
  for (const m of messages) {
    const p = m.message;
    if (p && p.type === 'system' && p.event === 'status' && p.to) reached.set(p.to, m.created_at);
  }
  if (ticket.timeline?.resolved_at) reached.set('resolved', ticket.timeline.resolved_at);
  if (ticket.timeline?.closed_at) reached.set('closed', ticket.timeline.closed_at);
  return reached;
}

/* ---------- message rendering ---------- */
/** The centred grey line shown for a system row in the thread. */
export function systemLineText(p: Extract<TechMessagePayload, { type: 'system' }>, actor: string, staffName: (id: string) => string | null): string {
  if (p.event === 'created') return `${actor} raised this ticket`;
  if (p.event === 'status') return `${actor} moved to ${STATUS_LABEL[p.to as TechStatus] ?? p.to}`;
  if (p.event === 'priority') return `${actor} set priority to ${PRIORITY_LABEL[p.to as TechPriority] ?? p.to}`;
  // The trigger sends the WRITTEN label when there is one, else the enum text, so the
  // lookup has to fall through untouched rather than blanking an unknown string.
  if (p.event === 'type') return `${actor} filed this as ${TYPE_LABEL[p.to as TechType] ?? p.to}`;
  return p.to ? `${actor} assigned to ${staffName(p.to) ?? 'a teammate'}` : `${actor} removed the assignee`;
}
/** One line of "what changed" for the reporter's dashboard banner. */
export function describeTechEvent(p: TechMessagePayload): { kind: 'status' | 'priority' | 'assignee' | 'type' | 'file' | 'reply'; text: string } {
  if (p.type === 'system') {
    if (p.event === 'status') return { kind: 'status', text: `moved to ${STATUS_LABEL[p.to as TechStatus] ?? p.to}` };
    if (p.event === 'priority') return { kind: 'priority', text: `set priority to ${PRIORITY_LABEL[p.to as TechPriority] ?? p.to}` };
    if (p.event === 'type') return { kind: 'type', text: `filed it as ${TYPE_LABEL[p.to as TechType] ?? p.to}` };
    return { kind: 'assignee', text: p.to ? 'picked it up' : 'unassigned it' };
  }
  if (p.type === 'file') return { kind: 'file', text: p.text ? `replied: "${p.text.slice(0, 80)}"` : 'sent a file' };
  const t = p.text ?? '';
  return { kind: 'reply', text: `replied: "${t.slice(0, 80)}${t.length > 80 ? '…' : ''}"` };
}

/* ---------- route capture ----------
   The web stores the last non-Tech-Desk URL on a ticket. Native equivalent: the
   last non-tech-desk route name of the store-router, written as app://<route>
   so Tech can tell app reports from web ones at a glance. Module memory, wiped
   on sign-out like every other per-user cache (house rule). */
let lastRoute: string | null = null;
export const TECH_ROUTES = new Set(['tech-desk', 'tech-desk-ticket', 'tech-desk-inbox', 'tech-desk-inbox-ticket', 'signin']);
export function rememberTechRoute(route: string) {
  if (!TECH_ROUTES.has(route)) lastRoute = route;
}
export const currentTechRoute = () => (lastRoute ? `app://${lastRoute}` : null);
registerTeardown(async () => { lastRoute = null; });
