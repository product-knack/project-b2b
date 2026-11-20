/* WhatsApp inbox (Ops) in the app, 19 Nov 2026 (owner: "in ops dashboard add the WhatsApp page like Preeti Ch sees
   on the web, end to end, clean and the same UI as WhatsApp"). Pure rules only: no React Native, no network.
   Ported from hub-track src/lib/whatsapp.ts + src/lib/whatsappTemplates.ts (17 to 19 Nov 2026) with the same names,
   so a rule changes in both places together. The only difference: dates are worked out in IST here (the app has no
   date-fns; the web uses the browser's clock, which is IST for the team).
   Data: view whatsapp_chats (one row per contact) and table whatsapp_messages (one row per message, reactions are
   rows of type 'reaction'); sends go through the edge function whatsapp-send (actions check / send / templates /
   send_template). The database rule is_whatsapp_staff() allows ops, admin, super_admin.
   Tests: tests/rules/whatsapp_test.js. Feature doc: docs/features/android/ops/whatsapp-inbox.md */

export type WaDirection = 'in' | 'out';
export type WaSource = 'customer' | 'phone_app' | 'dashboard' | 'api';
export type WaStatus = 'received' | 'pending' | 'sent' | 'delivered' | 'read' | 'played' | 'failed';

/** One row of the view whatsapp_chats. */
export interface WaChat {
  phone_number_id: string;
  contact_wa_id: string;
  contact_name: string | null;
  contact_last10: string | null;
  last_message_id: string | null;
  last_message_at: string | null;
  last_message_direction: WaDirection | null;
  last_message_source: WaSource | null;
  last_message_type: string | null;
  last_message_status: WaStatus | null;
  last_message_preview: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  first_message_at: string | null;
  message_count: number;
  unread_count: number;
}

/** One row of whatsapp_messages (the columns the page reads). */
export interface WaMessage {
  id: string;
  wamid: string | null;
  phone_number_id: string;
  contact_wa_id: string;
  contact_name: string | null;
  direction: WaDirection;
  source: WaSource;
  type: string;
  body: string | null;
  reply_to_wamid: string | null;
  reaction_emoji: string | null;
  reaction_target_wamid: string | null;
  media_id: string | null;
  media_mime: string | null;
  media_voice: boolean | null;
  media_state: 'none' | 'pending' | 'stored' | 'failed';
  media_path: string | null;
  payload: Record<string, any> | null;
  wa_timestamp: string;
  status: WaStatus;
  status_at: string | null;
  error_text: string | null;
  seen_at: string | null;
  /** The dashboard's own id of a message sent from the page (empty for every other message). */
  client_ref?: string | null;
}

export const WA_MESSAGE_COLUMNS =
  'id, wamid, phone_number_id, contact_wa_id, contact_name, direction, source, type, body, reply_to_wamid, ' +
  'reaction_emoji, reaction_target_wamid, media_id, media_mime, media_voice, media_state, media_path, payload, ' +
  'wa_timestamp, status, status_at, error_text, seen_at, client_ref';

/** Who may open the page. The database rule (is_whatsapp_staff) says the same. */
export const WHATSAPP_ROLES = ['ops', 'admin', 'super_admin'] as const;
export const canSeeWhatsApp = (role: string | null | undefined): boolean =>
  (WHATSAPP_ROLES as readonly string[]).includes(String(role ?? ''));

/* Numbers per person (20 Nov 2026). More than one WhatsApp number of ours is connected now, and each belongs to its
   own people: a team number (the clinic) to ops, admin and super admin, a personal business number (a CRM) to that
   person only. The database function whatsapp_my_numbers() lists the numbers of the signed-in person. */
/** One of our numbers the signed-in person may read and send from. */
export interface WaNumber {
  phone_number_id: string;
  label: string;
  /** A team number (ops, admin, super admin) or one person's own. */
  team: boolean;
  /** The number as people know it, digits with the country code; empty until its first event arrived. */
  display_number: string | null;
}
/** May this person open WhatsApp? `numbers` null = the database does not list numbers yet: the old role rule. */
export const canSeeWhatsAppWith = (role: string | null | undefined, numbers: WaNumber[] | null | undefined): boolean =>
  numbers == null ? canSeeWhatsApp(role) : numbers.length > 0;

export const chatKey = (c: Pick<WaChat, 'phone_number_id' | 'contact_wa_id'>): string =>
  `${c.phone_number_id}:${c.contact_wa_id}`;

/** "919466855655" -> "+91 94668 55655". Other numbers: "+" and the digits. */
export const formatWaNumber = (waId: string | null | undefined): string => {
  const d = String(waId ?? '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 12 && d.startsWith('91')) return `+91 ${d.slice(2, 7)} ${d.slice(7)}`;
  return `+${d}`;
};

const cleanName = (name: string | null | undefined): string => String(name ?? '').trim();

/** "Pallavi Mishra · +91 99900 01111": whose chats these are, for the line under the page title. */
export const numberLine = (n: Pick<WaNumber, 'label' | 'display_number'> | null | undefined): string => {
  if (!n) return '';
  const shown = n.display_number ? formatWaNumber(n.display_number) : '';
  return [String(n.label ?? '').trim(), shown].filter(Boolean).join(' · ');
};
/** The number a new chat is sent from: the first of mine (a team number first), else the one the chats are on. */
export const sendingNumberId = (numbers: WaNumber[] | null | undefined, fallback: string | null | undefined): string | null =>
  numbers && numbers.length ? numbers[0].phone_number_id : fallback ?? null;

/** The name WhatsApp gave us, or the number when no name has arrived yet. */
export const chatTitle = (c: Pick<WaChat, 'contact_name' | 'contact_wa_id'>): string =>
  cleanName(c.contact_name) || formatWaNumber(c.contact_wa_id);

/** Two letters for the round badge; empty when the chat has no name (the page shows a person icon). Words that
    start with a punctuation mark or an emoji-free symbol are skipped ("~ Asha" -> "A"). */
export const chatInitials = (c: Pick<WaChat, 'contact_name'>): string => {
  const words = cleanName(c.contact_name).split(/\s+/).filter((w) => w && !/^[~!@#$%^&*()_+=\-.,:;'"`|\\/?<>[\]{}]/.test(w));
  return words
    .slice(0, 2)
    .map((w) => Array.from(w)[0])
    .join('')
    .toUpperCase();
};

/** Search box: part of the name, or digits of the number (spaces and + ignored). */
export const chatMatches = (c: Pick<WaChat, 'contact_name' | 'contact_wa_id'>, query: string): boolean => {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (cleanName(c.contact_name).toLowerCase().includes(q)) return true;
  const digits = q.replace(/\D/g, '');
  return digits.length >= 3 && String(c.contact_wa_id).includes(digits);
};

export const totalUnread = (chats: Pick<WaChat, 'unread_count'>[] | null | undefined): number =>
  (chats ?? []).reduce((sum, c) => sum + (Number(c.unread_count) || 0), 0);

/* ------------------------------- dates, in IST ------------------------------- */
const IST_MS = 330 * 60_000;
const DAY_MS = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const msOf = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};
/** The IST calendar day number of a moment (days since 1970-01-01 IST). */
const istDayNo = (ms: number): number => Math.floor((ms + IST_MS) / DAY_MS);
const istDate = (ms: number): Date => new Date(ms + IST_MS); // read with getUTC*

/** "6:35 PM" in IST. */
export const bubbleTime = (iso: string | null | undefined): string => {
  const t = msOf(iso);
  if (t === null) return '';
  const d = istDate(t);
  const h = d.getUTCHours();
  return `${h % 12 === 0 ? 12 : h % 12}:${String(d.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

/** Time on a chat row: today "6:35 PM", yesterday "Yesterday", this week "Mon", older "12/11/26". */
export const listTime = (iso: string | null | undefined, now: Date = new Date()): string => {
  const t = msOf(iso);
  if (t === null) return '';
  const diff = istDayNo(now.getTime()) - istDayNo(t);
  if (diff <= 0) return bubbleTime(iso);
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return WEEKDAYS[istDate(t).getUTCDay()];
  const d = istDate(t);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCFullYear()).slice(2)}`;
};

/** Divider between days in a thread: "Today", "Yesterday", "17 Nov 2026". */
export const dayLabel = (iso: string | null | undefined, now: Date = new Date()): string => {
  const t = msOf(iso);
  if (t === null) return '';
  const diff = istDayNo(now.getTime()) - istDayNo(t);
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  const d = istDate(t);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

/* ------------------------------- messages ------------------------------- */
export type WaMediaKind = 'voice' | 'audio' | 'photo' | 'video' | 'document' | 'sticker' | 'location' | 'contact' | 'unsupported';

/** Kinds WhatsApp itself refuses to hand to any outside program (it reports "Message type unknown"). */
export const WA_NOT_SHARED_DETAIL = 'WhatsApp does not share this kind of message (for example a poll or a view-once photo). Open it on the phone.';
const NOT_SHARED_NAMES: Record<string, string> = { album: 'Photo album', poll: 'Poll', view_once: 'View-once photo', event: 'Event', sticker_pack: 'Sticker pack' };
/** The words for a message WhatsApp does not share, from the kind it names (payload.unsupported.type). */
export const notSharedOf = (payload: Record<string, any> | null | undefined): { label: string; detail: string } => {
  const kind = String(payload?.unsupported?.type ?? payload?.unsupported?.raw_type ?? '').trim().toLowerCase();
  const name = NOT_SHARED_NAMES[kind];
  return name
    ? { label: name, detail: `WhatsApp does not share this kind of message (${name.toLowerCase()}). Open it on the phone.` }
    : { label: 'Message not shared by WhatsApp', detail: WA_NOT_SHARED_DETAIL };
};

/** What a message that is not plain text is, and the words shown for it. Media files are not shown yet. */
export const mediaOf = (m: Pick<WaMessage, 'type' | 'media_voice' | 'payload'>): { kind: WaMediaKind; label: string; detail?: string } | null => {
  switch (m.type) {
    case 'text':
    case 'reaction':
      return null;
    case 'audio':
      return m.media_voice ? { kind: 'voice', label: 'Voice message' } : { kind: 'audio', label: 'Audio' };
    case 'image':
      return { kind: 'photo', label: 'Photo' };
    case 'video':
      return { kind: 'video', label: 'Video' };
    case 'document': {
      const name = cleanName(m.payload?.document?.filename);
      return { kind: 'document', label: name || 'Document' };
    }
    case 'sticker':
      return { kind: 'sticker', label: 'Sticker' };
    case 'location':
      return { kind: 'location', label: 'Location' };
    case 'contacts':
      return { kind: 'contact', label: 'Contact card' };
    case 'template':
      // a template of ours: its words are in the body, shown like a text
      return null;
    default:
      return { kind: 'unsupported', ...notSharedOf(m.payload) };
  }
};

/** A message whose words were changed after it was sent (the parser keeps the history in payload.edits). */
export const isEdited = (m: Pick<WaMessage, 'payload'>): boolean => !!m.payload?.edited_at;

/** Short text for a quoted message or a list row. */
export const messagePreview = (m: Pick<WaMessage, 'type' | 'body' | 'media_voice' | 'payload'>): string => {
  const text = cleanName(m.body);
  if (text) return text;
  return mediaOf(m)?.label ?? '';
};

/** Where one of our own messages was sent from (and by whom, for the dashboard). Empty for a customer's message. */
export const sentFromLabel = (m: Pick<WaMessage, 'direction' | 'source'> & { payload?: Record<string, any> | null }): string => {
  if (m.direction !== 'out') return '';
  if (m.source === 'phone_app') return 'From the phone';
  const template = !!m.payload?.template?.name || m.payload?.request?.type === 'template' ? ' · Template' : '';
  if (m.source === 'dashboard') {
    const first = cleanName(m.payload?.sent_by_name).split(' ')[0];
    return (first ? `From the dashboard · ${first}` : 'From the dashboard') + template;
  }
  return 'Sent through Chakra' + template;
};

export type WaTick = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

/** The tick on one of our own messages. Nothing for a customer's message. */
export const tickOf = (m: Pick<WaMessage, 'direction' | 'status'>): WaTick | null => {
  if (m.direction !== 'out') return null;
  if (m.status === 'pending') return 'pending';
  if (m.status === 'failed') return 'failed';
  if (m.status === 'delivered') return 'delivered';
  if (m.status === 'read' || m.status === 'played') return 'read';
  return 'sent';
};

/** The tick in front of a chat row's preview when the last message is ours. */
export const lastTickOf = (c: Pick<WaChat, 'last_message_direction' | 'last_message_status'>): WaTick | null =>
  c.last_message_direction === 'out' ? tickOf({ direction: 'out', status: (c.last_message_status ?? 'sent') as WaStatus }) : null;

export interface WaReactionShown {
  emoji: string;
  direction: WaDirection;
}

/** Reactions to show, by the wamid of the message they belong to: the latest per message and per side; an empty
    emoji means the reaction was taken away. Plain object (not a Map) so it is safe anywhere. */
export const reactionsByTarget = (reactions: WaMessage[]): Record<string, WaReactionShown[]> => {
  const latest: Record<string, WaMessage> = {};
  for (const r of reactions) {
    if (r.type !== 'reaction' || !r.reaction_target_wamid) continue;
    const key = `${r.reaction_target_wamid}|${r.direction}`;
    const seen = latest[key];
    if (!seen || r.wa_timestamp > seen.wa_timestamp) latest[key] = r;
  }
  const out: Record<string, WaReactionShown[]> = {};
  for (const r of Object.values(latest)) {
    const emoji = cleanName(r.reaction_emoji);
    if (!emoji) continue;
    const target = r.reaction_target_wamid as string;
    const list = out[target] ?? [];
    list.push({ emoji, direction: r.direction });
    list.sort((a, b) => (a.direction === b.direction ? 0 : a.direction === 'in' ? -1 : 1));
    out[target] = list;
  }
  return out;
};

/** The first unread message of a thread, as the chat list counts unread: from the person, not opened by the team
    (seen_at empty), newer than our latest reply. `messages` are bubbles only, oldest first. */
export const firstUnread = (messages: WaMessage[]): { id: string; count: number } | null => {
  let lastOut = '';
  for (const m of messages) if (m.direction === 'out' && m.wa_timestamp > lastOut) lastOut = m.wa_timestamp;
  const unread = messages.filter((m) => m.direction === 'in' && !m.seen_at && m.wa_timestamp > lastOut);
  return unread.length ? { id: unread[0].id, count: unread.length } : null;
};

export type WaThreadItem =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'unread'; key: string; count: number }
  | { kind: 'message'; key: string; message: WaMessage; reactions: WaReactionShown[]; quoted: WaMessage | null; quotedMissing: boolean };

/** What the thread renders, top to bottom: day dividers, the "N unread messages" line, and the bubbles with their
    reactions and the message they quote. Reaction rows never become bubbles. */
export const buildThread = (input: {
  messages: WaMessage[];
  reactions: WaMessage[];
  quoted?: WaMessage[];
  unread?: { id: string; count: number } | null;
  now?: Date;
}): WaThreadItem[] => {
  const now = input.now ?? new Date();
  const bubbles = input.messages
    .filter((m) => m.type !== 'reaction')
    .slice()
    .sort((a, b) => (a.wa_timestamp < b.wa_timestamp ? -1 : a.wa_timestamp > b.wa_timestamp ? 1 : a.id < b.id ? -1 : 1));
  const byWamid: Record<string, WaMessage> = {};
  for (const m of [...(input.quoted ?? []), ...bubbles]) if (m.wamid) byWamid[m.wamid] = m;
  const reactions = reactionsByTarget(input.reactions);

  const items: WaThreadItem[] = [];
  let day = '';
  for (const m of bubbles) {
    const label = dayLabel(m.wa_timestamp, now);
    if (label && label !== day) {
      day = label;
      items.push({ kind: 'day', key: `day-${label}`, label });
    }
    if (input.unread && input.unread.id === m.id) {
      items.push({ kind: 'unread', key: 'unread', count: input.unread.count });
    }
    const quoted = m.reply_to_wamid ? byWamid[m.reply_to_wamid] ?? null : null;
    items.push({
      kind: 'message',
      key: m.id,
      message: m,
      reactions: m.wamid ? reactions[m.wamid] ?? [] : [],
      quoted,
      quotedMissing: !!m.reply_to_wamid && !quoted,
    });
  }
  return items;
};

/** wamids of quoted messages that are not among the loaded ones (to be fetched). */
export const missingQuoted = (messages: WaMessage[]): string[] => {
  const have: Record<string, true> = {};
  for (const m of messages) if (m.wamid) have[m.wamid] = true;
  const out: string[] = [];
  for (const m of messages) {
    const w = m.reply_to_wamid;
    if (w && !have[w] && !out.includes(w)) out.push(w);
  }
  return out;
};

/* ------------------------------- replies (18 Nov 2026) -------------------------------
   The server function "whatsapp-send" is the judge of every rule below; the page repeats them so that the box is
   blocked before anything is typed. */

/** WhatsApp's own limit for a text message. */
export const WA_TEXT_MAX = 4096;
export const WA_REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;
export const WA_WINDOW_CLOSED = 'This person has not written in the last 24 hours. Reply from the phone.';
export const WA_SEND_TESTING = 'Sending is being tested. Reply from the phone.';
export const WA_SEND_OFF = 'Sending from the dashboard is switched off. Reply from the phone.';
export const WA_SEND_UNKNOWN = 'Sending is not available right now. Reply from the phone.';
export const WA_SEND_FAILED = 'The message could not be sent. Check your connection and try again.';

/** WhatsApp lets a business write freely for 24 hours after the person's last message. */
export const replyWindow = (lastInboundAt: string | null | undefined, now: Date = new Date()): { open: boolean; msLeft: number } => {
  const t = msOf(lastInboundAt);
  if (t === null) return { open: false, msLeft: 0 };
  const msLeft = t + WA_REPLY_WINDOW_MS - now.getTime();
  return { open: msLeft > 0, msLeft: Math.max(0, msLeft) };
};

/** "23 h 10 min", "42 min", "less than a minute". */
export const windowLeftText = (msLeft: number): string => {
  const mins = Math.floor(msLeft / 60000);
  if (mins < 1) return 'less than a minute';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? (m > 0 ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
};

/** What the server says about sending to one chat (action "check" of whatsapp-send). */
export interface WaSendCheck {
  mode: 'off' | 'test' | 'on';
  allowed: boolean;
  message: string | null;
}

/** What is wrong with the typed text, or null when it can be sent. */
export const composerProblem = (text: string): string | null => {
  const t = text.trim();
  if (!t) return 'Type a message first.';
  if (Array.from(t).length > WA_TEXT_MAX) return `The message is too long. WhatsApp allows ${WA_TEXT_MAX} characters.`;
  return null;
};

/** A reply the page has started to send and the table does not show yet (or the server refused before storing it). */
export interface WaLocalSend {
  clientRef: string;
  phoneNumberId: string;
  contactWaId: string;
  text: string;
  at: string;
  state: 'sending' | 'failed';
  error?: string | null;
  /** Set when the message is an approved template: what to send again on Try again. */
  template?: { name: string; language: string; values: { header: Record<string, string>; body: Record<string, string> } } | null;
}

/** Local sends as bubbles, leaving out the ones the table already holds (same client_ref). */
export const localSendBubbles = (
  sends: WaLocalSend[],
  messages: Pick<WaMessage, 'client_ref'>[],
  chat: Pick<WaChat, 'phone_number_id' | 'contact_wa_id'> | null,
): WaMessage[] => {
  if (!chat) return [];
  const stored: Record<string, true> = {};
  for (const m of messages) if (m.client_ref) stored[m.client_ref] = true;
  return sends
    .filter((s) => s.phoneNumberId === chat.phone_number_id && s.contactWaId === chat.contact_wa_id && !stored[s.clientRef])
    .map((s) => ({
      id: `local-${s.clientRef}`,
      wamid: null,
      phone_number_id: s.phoneNumberId,
      contact_wa_id: s.contactWaId,
      contact_name: null,
      direction: 'out' as const,
      source: 'dashboard' as const,
      type: 'text',
      body: s.text,
      reply_to_wamid: null,
      reaction_emoji: null,
      reaction_target_wamid: null,
      media_id: null,
      media_mime: null,
      media_voice: null,
      media_state: 'none' as const,
      media_path: null,
      payload: s.template ? { local: true, template: { name: s.template.name, language: s.template.language, values: s.template.values } } : { local: true },
      wa_timestamp: s.at,
      status: s.state === 'failed' ? ('failed' as const) : ('pending' as const),
      status_at: null,
      error_text: s.state === 'failed' ? s.error ?? null : null,
      seen_at: null,
      client_ref: s.clientRef,
    }));
};

/** A message of ours that was never accepted by WhatsApp and can be sent again with the same id. */
export const canRetrySend = (m: Pick<WaMessage, 'direction' | 'source' | 'status' | 'wamid' | 'client_ref' | 'body'>): boolean =>
  m.direction === 'out' && m.source === 'dashboard' && m.status === 'failed' && !m.wamid && !!m.client_ref && !!(m.body ?? '').trim();

/** A message of ours that never left: "Not sent"; one WhatsApp accepted and then could not deliver: "Not delivered". */
export const failedLabel = (m: Pick<WaMessage, 'wamid' | 'error_text'>): string =>
  `${m.wamid ? 'Not delivered' : 'Not sent'}${m.error_text ? `: ${m.error_text}` : ''}`;

/** A new id for a reply, made on the phone, so that a retry of the same reply is never sent twice (uuid v4 form). */
export const newClientRef = (rand: () => number = Math.random): string =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (rand() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

/* ------------------------------- templates (19 Nov 2026) ------------------------------- */

/** One approved template, as the server function lists it. */
export interface WaTemplate {
  name: string;
  language: string;
  category: string;
  header: { format: string; text: string | null } | null;
  body: string;
  footer: string | null;
  buttons: { type: string; text: string }[];
  /** The blanks, by name: "1", "2" or a word. */
  variables: { header: string[]; body: string[] };
  named: boolean;
  sendable: boolean;
  /** Why it cannot be sent from the dashboard yet. */
  reason: string | null;
}

export type WaTemplateValues = { header: Record<string, string>; body: Record<string, string> };
export const emptyTemplateValues = (): WaTemplateValues => ({ header: {}, body: {} });

export const templateKey = (t: Pick<WaTemplate, 'name' | 'language'>): string => `${t.name}:${t.language}`;

/** "MARKETING" -> "Marketing". */
export const templateCategoryLabel = (category: string | null | undefined): string => {
  const c = String(category ?? '').trim().toLowerCase();
  return c ? c.charAt(0).toUpperCase() + c.slice(1) : 'Template';
};

/** The label of a blank's input: "Blank 1", or the blank's own word ("first name"). */
export const blankLabel = (name: string): string => (/^\d+$/.test(name) ? `Blank ${name}` : name.replace(/_/g, ' '));

/** A typed value as WhatsApp accepts it: one line, single spaces. */
export const cleanTemplateValue = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 1000);

/** The words with the blanks filled in. A blank still empty stays visible as it is written ("{{1}}"). */
export const fillTemplateText = (text: string | null | undefined, values: Record<string, string>): string =>
  String(text ?? '').replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (whole, k) => cleanTemplateValue(values?.[k]) || whole);

/** What the person will receive: header, body, footer and the button labels. */
export const templatePreview = (t: WaTemplate, values: WaTemplateValues): { header: string; body: string; footer: string; buttons: string[] } => ({
  header: t.header?.text ? fillTemplateText(t.header.text, values.header) : '',
  body: fillTemplateText(t.body, values.body),
  footer: t.footer ?? '',
  buttons: t.buttons.map((b) => b.text).filter(Boolean),
});

/** The words stored on our own bubble (the same rule as the server: header line, then the body). */
export const templateSentText = (t: WaTemplate, values: WaTemplateValues): string => {
  const p = templatePreview(t, values);
  return [p.header, p.body].filter((s) => s.trim()).join('\n');
};

export const WA_TEMPLATE_BLANKS = 'Fill in every blank of the template.';

/** Why this template cannot be sent as it stands, or null when it can. */
export const templateProblem = (t: WaTemplate | null, values: WaTemplateValues): string | null => {
  if (!t) return 'Pick a template.';
  if (!t.sendable) return t.reason ?? 'This template cannot be sent from here yet.';
  for (const part of ['header', 'body'] as const) {
    for (const n of t.variables[part]) if (!cleanTemplateValue(values[part]?.[n])) return WA_TEMPLATE_BLANKS;
  }
  return null;
};

/** Does the typed search match this template? */
export const templateMatches = (t: WaTemplate, query: string): boolean => {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return t.name.toLowerCase().replace(/_/g, ' ').includes(q.replace(/_/g, ' ')) || t.body.toLowerCase().includes(q);
};

/** The template a bubble of ours was sent with, when it was one. */
export const templateNameOf = (m: { payload?: Record<string, any> | null }): string | null => {
  const p = m.payload ?? {};
  const name = p.template?.name ?? (p.request?.type === 'template' ? p.request?.template?.name : null);
  return typeof name === 'string' && name.trim() ? name.trim() : null;
};
/** Its language (needed to send the same template again). */
export const templateLanguageOf = (m: { payload?: Record<string, any> | null }): string | null => {
  const p = m.payload ?? {};
  const lang = p.template?.language ?? p.request?.template?.language?.code ?? null;
  return typeof lang === 'string' && lang.trim() ? lang.trim() : null;
};

/* The reply bar: what can be sent to this chat right now */
export const WA_TEMPLATE_ONLY = 'This person has not written in the last 24 hours. Only an approved template can be sent.';
export const WA_TEMPLATE_ONLY_NEW = 'This person has not written to us yet. Only an approved template can be sent.';

export type WaComposerMode =
  | { kind: 'checking' }
  /** The test lock, or the server said no: nothing can be sent. */
  | { kind: 'locked'; message: string }
  /** Outside WhatsApp's 24 hours: a template only. */
  | { kind: 'template_only'; message: string }
  /** Inside the 24 hours: free text (and a template, if wanted). */
  | { kind: 'open' };

export const composerMode = (
  chat: Pick<WaChat, 'last_inbound_at'> | null,
  check: WaSendCheck | null | undefined,
  now: Date = new Date(),
): WaComposerMode => {
  if (!chat) return { kind: 'locked', message: WA_SEND_UNKNOWN };
  if (!check) return { kind: 'checking' };
  if (!check.allowed) return { kind: 'locked', message: check.message || (check.mode === 'test' ? WA_SEND_TESTING : WA_SEND_OFF) };
  if (!replyWindow(chat.last_inbound_at, now).open) {
    return { kind: 'template_only', message: chat.last_inbound_at ? WA_TEMPLATE_ONLY : WA_TEMPLATE_ONLY_NEW };
  }
  return { kind: 'open' };
};

/* A chat with a new number */
export const WA_NEW_CHAT_HINT = 'Type the number with its country code. A 10-digit number is taken as an Indian number (+91).';
export const WA_BAD_NUMBER = 'Enter the full number with the country code.';

/** "99999 99988" -> 919999999988; "+1 (332) 345-8424" -> 13323458424. */
export const parseNewChatNumber = (input: string): { ok: true; waId: string } | { ok: false; error: string } => {
  let d = String(input ?? '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 10) d = `91${d}`;
  if (d.length < 11 || d.length > 15) return { ok: false, error: WA_BAD_NUMBER };
  return { ok: true, waId: d };
};

/** "<our number id>:<their number>", or null when it is not one. */
export const parseChatKey = (key: string | null | undefined): { phoneNumberId: string; contactWaId: string } | null => {
  const m = /^(\d{6,20}):(\d{8,15})$/.exec(String(key ?? ''));
  return m ? { phoneNumberId: m[1], contactWaId: m[2] } : null;
};

/** A chat that has no message yet (a new number): shown open, with nothing in it. */
export const placeholderChat = (phoneNumberId: string, contactWaId: string): WaChat => ({
  phone_number_id: phoneNumberId,
  contact_wa_id: contactWaId,
  contact_name: null,
  contact_last10: contactWaId.slice(-10),
  last_message_id: null,
  last_message_at: null,
  last_message_direction: null,
  last_message_source: null,
  last_message_type: null,
  last_message_status: null,
  last_message_preview: null,
  last_inbound_at: null,
  last_outbound_at: null,
  first_message_at: null,
  message_count: 0,
  unread_count: 0,
});

/** The chat to show for a key: the listed one, else an empty one for a new number (only once the list loaded, so
    an existing chat never flashes as an empty new one). */
export const chatForKey = (chats: WaChat[], key: string | null | undefined, listLoaded: boolean): WaChat | null => {
  if (!key) return null;
  const found = chats.find((c) => `${c.phone_number_id}:${c.contact_wa_id}` === key);
  if (found) return found;
  const parsed = parseChatKey(key);
  return parsed && listLoaded ? placeholderChat(parsed.phoneNumberId, parsed.contactWaId) : null;
};
