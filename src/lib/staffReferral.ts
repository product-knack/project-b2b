/**
 * Staff referrals that go straight to the Leads page (21 Nov 2026).
 *
 * A member adds a referral, the server (submit_staff_referral) makes a lead or adds the referral to an existing
 * lead, the member follows it in "My referrals" (get_my_referrals), and Ops decides the credit when more than
 * one person has a claim (get_referral_credit_queue / decide_referral_credit).
 *
 * One standard for every department (24 Nov 2026): the name, the phone number, the client whose referral it
 * is and the relation to that client are all required ON THE SCREENS (the database refuses nothing new, so an
 * app version that does not ask for them keeps working); the member follows four steps (Lead submitted, QHP
 * booked, QHP done, Converted on the payment day); a number submitted more than once is one lead, marked
 * Duplicate, with every submission's details kept for the leads team.
 *
 * Pure functions only. The same file byte for byte on the web (src/lib/staffReferral.ts) and in the app
 * (odds-app/src/lib/staffReferral.ts).
 */

/**
 * THE RELEASE SWITCH. While false the old screens work exactly as before (admin approval), and nothing of the
 * new flow is shown. The owner holds the release until the incentive rule is confirmed with the policy owner.
 */
export const STAFF_REFERRAL_FLOW_ON = false;

export type ReferralStatusKey =
  | "in_progress" | "qhp_booked" | "qhp_done" | "payment_awaited" | "credit_deciding" | "converted"
  | "credited_other" | "no_credit" | "not_converted" | "waiting_admin" | "approved" | "rejected";

export type ReferralTone = "progress" | "good" | "wait" | "muted";

const STATUS: Record<ReferralStatusKey, { label: string; tone: ReferralTone }> = {
  in_progress: { label: "In progress", tone: "wait" },
  qhp_booked: { label: "QHP booked", tone: "progress" },
  qhp_done: { label: "QHP done", tone: "progress" },
  payment_awaited: { label: "Enrolled, payment awaited", tone: "progress" },
  credit_deciding: { label: "Converted, credit being decided", tone: "progress" },
  converted: { label: "Converted", tone: "good" },
  credited_other: { label: "Converted, credited to another member", tone: "muted" },
  no_credit: { label: "Converted, no referral credit", tone: "muted" },
  not_converted: { label: "Not converted", tone: "muted" },
  waiting_admin: { label: "Waiting for admin", tone: "wait" },
  approved: { label: "Approved", tone: "good" },
  rejected: { label: "Rejected", tone: "muted" },
};

/** The words and the colour family for a status the server sent. An unknown one reads as "In progress". */
export function referralStatus(key: string | null | undefined): { key: ReferralStatusKey; label: string; tone: ReferralTone } {
  const k = (key && key in STATUS ? key : "in_progress") as ReferralStatusKey;
  return { key: k, ...STATUS[k] };
}

export interface MyReferral {
  id: string;
  referred_name: string;
  referred_phone: string | null;
  created_at: string;
  through_client: string | null;
  status_key: string;
  converted_on: string | null;
  note: string | null;
  on_existing_lead: boolean;
  /** The relation of the referred person to the client (24 Nov 2026). */
  relation?: string | null;
  /** The lead's stage as the leads team has it. */
  lead_stage?: string | null;
  /** YYYY-MM-DD: the day the QHP was booked, the day it was done, the day the payment was received. */
  qhp_booked_on?: string | null;
  qhp_done_on?: string | null;
  paid_on?: string | null;
  /** How many OTHER members referred the same person. */
  others?: number | null;
}

/** The three numbers above the list. */
export function referralCounts(rows: Array<Pick<MyReferral, "status_key">> | null | undefined): { total: number; converted: number; inProgress: number; notConverted: number } {
  const list = rows ?? [];
  let converted = 0, notConverted = 0;
  for (const r of list) {
    const s = referralStatus(r.status_key);
    if (s.key === "converted" || s.key === "approved") converted++;
    else if (s.tone === "muted") notConverted++;
  }
  return { total: list.length, converted, inProgress: list.length - converted - notConverted, notConverted };
}

// ---------------------------------------------------------------- the form

export const digitsOf = (value: string | null | undefined): string => (value ?? "").replace(/[^0-9]/g, "");

/** How the referred person is related to the client whose referral it is. "Other" asks for a few words. */
export const REFERRAL_RELATIONS = ["Spouse / Partner", "Parent", "Child", "Sibling", "Relative", "Friend", "Colleague", "Neighbour", "Other"] as const;
export const RELATION_OTHER = "Other";

/** The relation as it is saved: the chosen one, or "Other: <the words typed>". "" while it is not complete. */
export function relationText(choice: string | null | undefined, other?: string | null): string {
  const c = (choice ?? "").trim();
  if (!c) return "";
  if (c !== RELATION_OTHER) return c;
  const typed = (other ?? "").replace(/\s+/g, " ").trim();
  return typed.length >= 2 ? `Other: ${typed}`.slice(0, 80) : "";
}

export interface ReferralForm {
  name: string;
  phone: string;
  note?: string;
  /** The client whose referral this is. */
  clientId?: string | null;
  /** One of REFERRAL_RELATIONS, and the words typed when it is "Other". */
  relation?: string | null;
  relationOther?: string | null;
}

export type ReferralFormField = "name" | "phone" | "client" | "relation";

/**
 * Trainers and CRMs give the referral of one of their OWN clients only (owner, 24 Nov 2026): the list on the
 * screen offers them no other client. Other departments have no clients of their own and pick any client by name.
 */
export function referralOwnClientsOnly(role: string | null | undefined): boolean {
  const r = String(role ?? "").toLowerCase();
  return r === "trainer" || r === "crm";
}

/**
 * The member's own clients as choices, from rows of trainer_clients joined to clients (used when the list
 * function is not on the database yet). No repeats, by name, narrowed by the typed letters.
 */
export function ownClientChoices(rows: unknown, typed?: string | null): Array<{ id: string; name: string; mine: boolean }> {
  if (!Array.isArray(rows)) return [];
  const term = (typed ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  const seen = new Map<string, { id: string; name: string; mine: boolean }>();
  for (const row of rows) {
    const joined = row && typeof row === "object" ? (row as Record<string, unknown>).clients : null;
    const c = (Array.isArray(joined) ? joined[0] : joined) as Record<string, unknown> | null | undefined;
    if (!c || typeof c.id !== "string" || seen.has(c.id)) continue;
    const name = `${String(c.first_name ?? "").trim()} ${String(c.last_name ?? "").trim()}`.trim() || "No name";
    if (term && !name.toLowerCase().includes(term)) continue;
    seen.set(c.id, { id: c.id, name, mine: true });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The words around the client box, by who is filling the form. */
export function referralClientWords(ownOnly: boolean): { search: string; hint: string; emptyTyped: string; emptyIdle: string } {
  return ownOnly
    ? { search: "Search your clients", hint: "Only your own clients can be chosen.", emptyTyped: "None of your clients has that name.", emptyIdle: "You have no clients assigned yet, so a referral cannot be added from here." }
    : { search: "Search a client by name", hint: "Your clients are listed. Type a name to search every client.", emptyTyped: "No client found with that name.", emptyIdle: "Type at least two letters of the client's name to search." };
}

/** The first thing missing on the form: which field, and the sentence to show. Null when it can be sent. */
export function referralFormIssue(form: ReferralForm): { field: ReferralFormField; message: string } | null {
  const name = (form.name ?? "").replace(/\s+/g, " ").trim();
  if (name.length < 2) return { field: "name", message: "Enter the person's name." };
  const digits = digitsOf(form.phone);
  if (!digits) return { field: "phone", message: "Enter the person's phone number." };
  if (digits.length < 8 || digits.length > 15) return { field: "phone", message: "Enter a valid phone number." };
  if (!form.clientId) return { field: "client", message: "Choose the client whose referral this is." };
  if (!(form.relation ?? "").trim()) return { field: "relation", message: "Choose how this person is related to the client." };
  if (!relationText(form.relation, form.relationOther)) return { field: "relation", message: "Write how this person is related to the client." };
  return null;
}

/** What is missing on the form, in plain words, or null when it can be sent. */
export function referralFormProblem(form: ReferralForm): string | null {
  return referralFormIssue(form)?.message ?? null;
}

const REFUSED: Record<string, string> = {
  not_signed_in: "Sign in again and retry.",
  not_staff: "Only team members can add a referral here.",
  name: "Enter the person's name.",
  phone: "Enter a valid phone number.",
  client: "Choose the client whose referral this is.",
  client_not_yours: "Choose one of your own clients.",
  relation: "Choose how this person is related to the client.",
  member: "This person is already a member, so a referral cannot be added.",
  limit: "You have added many referrals today. Try again tomorrow.",
  not_saved: "The referral could not be saved. Try again.",
};

const SAVED: Record<string, string> = {
  new_lead: "Referral sent to the leads team.",
  added_to_lead: "This number is already with the leads team. Your referral was added to it and marked as a duplicate.",
  already_yours: "You have already referred this person.",
};

export const REFERRAL_SAVE_ERROR = "The referral could not be saved. Check your connection and try again.";

/** Reads the server's answer to a save: ok with the sentence to show, or not ok with the reason in words. */
export function referralSaveResult(answer: unknown): { ok: boolean; message: string; reopened: boolean; kind: string } {
  const a = (answer && typeof answer === "object" ? answer : {}) as Record<string, unknown>;
  if (a.ok === true) {
    const kind = typeof a.case === "string" ? a.case : "new_lead";
    const reopened = a.reopened === true;
    const message = (SAVED[kind] ?? SAVED.new_lead) + (reopened ? " The lead was Lost and is open again." : "");
    return { ok: true, message, reopened, kind };
  }
  const reason = typeof a.reason === "string" ? a.reason : "not_saved";
  return { ok: false, message: REFUSED[reason] ?? REFUSED.not_saved, reopened: false, kind: reason };
}

/** A database sentence ("CODE: sentence") or a plain fallback; never a raw error. */
export function referralErrorText(e: unknown, fallback: string = REFERRAL_SAVE_ERROR): string {
  const raw = String((e as { message?: unknown } | null)?.message ?? "");
  const m = /^REFERRAL_[A-Z_]+:\s*(.+)$/.exec(raw.trim());
  return m ? m[1].trim() : fallback;
}

// ---------------------------------------------------------------- the member's tracker

/** The day in India (YYYY-MM-DD) of a moment given as an ISO text; "" when it cannot be read. */
export function istDay(iso: string | null | undefined): string {
  const ms = Date.parse(String(iso ?? ""));
  if (!Number.isFinite(ms)) return "";
  return new Date(ms + 330 * 60 * 1000).toISOString().slice(0, 10);
}

export type TrackerStepKey = "submitted" | "qhp_booked" | "qhp_done" | "converted";
/** done = passed, now = where the referral stands, todo = not reached. */
export type TrackerStepState = "done" | "now" | "todo";
export interface TrackerStep { key: TrackerStepKey; label: string; state: TrackerStepState; /** "21 Nov 2026" or "". */ day: string }
export interface ReferralTracker {
  steps: TrackerStep[];
  /** How many of the four steps are reached (1 to 4). */
  reached: number;
  /** The referral ended without converting. */
  closed: boolean;
  /** One line under the steps; "" when the steps say it all. */
  note: string;
}

const TRACKER_LABELS: Array<[TrackerStepKey, string]> = [
  ["submitted", "Lead submitted"], ["qhp_booked", "QHP booked"], ["qhp_done", "QHP done"], ["converted", "Converted"],
];

/**
 * The four steps a member follows for one referral. The conversion day is the day the payment was received.
 * A referral that ended without converting keeps the steps it had reached.
 */
export function referralTracker(r: MyReferral): ReferralTracker {
  const s = referralStatus(r.status_key).key;
  const convertedFamily = s === "converted" || s === "credit_deciding" || s === "credited_other" || s === "no_credit" || s === "approved";
  const closed = s === "not_converted" || s === "rejected";
  let reached = 1;
  if (convertedFamily) reached = 4;
  else if (s === "qhp_done" || s === "payment_awaited") reached = 3;
  else if (s === "qhp_booked") reached = 2;
  else if (closed) reached = r.qhp_done_on ? 3 : r.qhp_booked_on ? 2 : 1;
  const days = [
    referralDay(istDay(r.created_at)),
    referralDay(r.qhp_booked_on),
    referralDay(r.qhp_done_on),
    convertedFamily ? referralDay(r.paid_on) || referralDay(r.converted_on) : "",
  ];
  const steps = TRACKER_LABELS.map(([key, label], i): TrackerStep => ({
    key, label,
    state: i < reached - 1 ? "done" : i === reached - 1 ? (closed ? "done" : "now") : "todo",
    day: i < reached ? days[i] : "",
  }));
  let note = "";
  if (s === "not_converted") note = "Not converted. The leads team closed this lead.";
  else if (s === "rejected") note = "This referral was not accepted.";
  else if (s === "payment_awaited") note = "Enrolled. Waiting for the payment.";
  else if (s === "credit_deciding") note = "Converted. The referral credit is being decided.";
  else if (s === "credited_other") note = "Converted. The referral credit went to another member.";
  else if (s === "no_credit") note = "Converted. No referral credit was given.";
  else if (s === "waiting_admin") note = "Waiting for the admin.";
  else if (s === "in_progress" && r.lead_stage && r.lead_stage !== "New") note = `With the leads team: ${r.lead_stage}.`;
  else if (s === "in_progress") note = "With the leads team.";
  return { steps, reached, closed, note };
}

/** A referral of a person someone else also referred, or who was already a lead: the words for the tag, or "". */
export function referralDuplicateLine(r: Pick<MyReferral, "others" | "on_existing_lead">): string {
  const others = Number(r.others ?? 0);
  if (others === 1) return "Also referred by 1 other member";
  if (others > 1) return `Also referred by ${others} other members`;
  return r.on_existing_lead ? "Already a lead when you referred" : "";
}

// ---------------------------------------------------------------- the Leads page tag

/** One member's submission of a lead, as the leads team reads it. */
export interface LeadReferralEntry {
  /** "Raj Thakur (Trainer)". */
  member: string;
  /** The day it was submitted, "24 Nov 2026" ("" when not known). */
  day: string;
  /** The client whose referral it is, the relation to that client, the member's note, the name as submitted. */
  client: string | null;
  relation: string | null;
  note: string | null;
  referredName: string | null;
  /** Submitted when the number was already a lead. */
  duplicate: boolean;
}

export interface LeadReferralInfo {
  /** How many times team members referred this lead. */
  times: number;
  /** The members, first to last, without repeats: "Raj Thakur (Trainer)". */
  members: string[];
  /** The day of the latest referral on a lead that already existed (YYYY-MM-DD), or null. */
  lastReferredOn: string | null;
  /** Every submission, first to last. */
  entries: LeadReferralEntry[];
  /** More than one submission, or a submission of a number that was already a lead. */
  duplicate: boolean;
}

const roleLabel = (role: unknown): string => {
  const r = String(role ?? "").toLowerCase();
  if (!r) return "Team";
  if (r === "crm") return "CRM";
  if (r === "ops") return "Ops";
  if (r === "super_admin") return "Super admin";
  return r.replace(/_/g, " ").replace(/\b[a-z]/g, (c) => c.toUpperCase());
};

/** Reads the staff referral entries out of a lead's remarks. */
export function leadReferralInfo(remarks: unknown): LeadReferralInfo {
  const out: LeadReferralInfo = { times: 0, members: [], lastReferredOn: null, entries: [], duplicate: false };
  if (!Array.isArray(remarks)) return out;
  const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
  for (const e of remarks) {
    if (!e || typeof e !== "object" || (e as Record<string, unknown>).kind !== "staff_referral") continue;
    const entry = e as Record<string, unknown>;
    out.times++;
    const who = `${String(entry.author_name ?? "A team member")} (${roleLabel(entry.referrer_role)})`;
    if (!out.members.includes(who)) out.members.push(who);
    const day = typeof entry.last_referred_on === "string" ? entry.last_referred_on : null;
    if (day && (!out.lastReferredOn || day > out.lastReferredOn)) out.lastReferredOn = day;
    const duplicate = entry.duplicate === true || !!day;
    out.entries.push({
      member: who,
      day: referralDay(istDay(text(entry.date))),
      client: text(entry.through_client),
      relation: text(entry.relation),
      note: text(entry.note),
      referredName: text(entry.referred_name),
      duplicate,
    });
    if (duplicate) out.duplicate = true;
  }
  if (out.times > 1) out.duplicate = true;
  return out;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-21" -> "21 Nov 2026"; "" when it is not a day. */
export function referralDay(ymd: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd ?? ""));
  if (!m) return "";
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month} ${m[1]}` : "";
}

/** The tag on a lead: "" when no member referred it; "Duplicate referral" when the number came in more than once. */
export function leadReferredTag(info: LeadReferralInfo): string {
  if (info.times <= 0) return "";
  if (info.duplicate) return info.times > 1 ? `Duplicate referral (${info.times})` : "Duplicate referral";
  return "Referred";
}

// ---------------------------------------------------------------- the Ops alert

export interface CreditClaim {
  referral_id: string;
  member_id: string;
  member_name: string;
  member_role: string;
  referred_on: string;
  created_the_lead: boolean;
  through_client: string | null;
}

export interface CreditQueueItem {
  lead_id: string;
  lead_name: string;
  converted_at: string | null;
  payment_received: boolean;
  first_added_on: string | null;
  source: string | null;
  claims: CreditClaim[];
}

/** Makes a safe list out of whatever the server sent. */
export function readCreditQueue(raw: unknown): CreditQueueItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x) => x && typeof x === "object" && typeof (x as Record<string, unknown>).lead_id === "string")
    .map((x) => {
      const i = x as Record<string, unknown>;
      return {
        lead_id: String(i.lead_id),
        lead_name: String(i.lead_name ?? "A lead"),
        converted_at: typeof i.converted_at === "string" ? i.converted_at : null,
        payment_received: i.payment_received === true,
        first_added_on: typeof i.first_added_on === "string" ? i.first_added_on : null,
        source: typeof i.source === "string" ? i.source : null,
        claims: Array.isArray(i.claims) ? (i.claims as CreditClaim[]).filter((c) => c && typeof c.referral_id === "string") : [],
      };
    })
    .filter((i) => i.claims.length > 0);
}

/** The line under a lead in the Ops alert. */
export function creditQueueLine(item: CreditQueueItem): string {
  const n = item.claims.length;
  const who = n === 1 ? "One member referred this person." : `${n} members referred this person.`;
  const first = item.first_added_on ? ` First added on ${referralDay(item.first_added_on)}${item.source ? `, source ${item.source}` : ""}.` : "";
  const paid = item.payment_received ? "" : " No payment is on record for this lead yet.";
  return who + first + paid;
}

/** One choice in the Ops alert: "Raj Thakur (Trainer), 3 Oct 2026, through client Asha Verma". */
export function creditClaimLabel(c: CreditClaim): string {
  return `${c.member_name} (${c.member_role}), ${referralDay(c.referred_on)}${c.through_client ? `, through client ${c.through_client}` : ""}`;
}
