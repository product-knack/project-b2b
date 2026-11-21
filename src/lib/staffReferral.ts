/**
 * Staff referrals that go straight to the Leads page (21 Nov 2026).
 *
 * A member adds a referral, the server (submit_staff_referral) makes a lead or adds the referral to an existing
 * lead, the member follows it in "My referrals" (get_my_referrals), and Ops decides the credit when more than
 * one person has a claim (get_referral_credit_queue / decide_referral_credit).
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

export interface ReferralForm {
  name: string;
  phone: string;
  note?: string;
}

/** What is missing on the form, in plain words, or null when it can be sent. */
export function referralFormProblem(form: ReferralForm): string | null {
  const name = (form.name ?? "").replace(/\s+/g, " ").trim();
  if (name.length < 2) return "Enter the person's name.";
  const digits = digitsOf(form.phone);
  if (!digits) return "Enter the person's phone number.";
  if (digits.length < 8 || digits.length > 15) return "Enter a valid phone number.";
  return null;
}

const REFUSED: Record<string, string> = {
  not_signed_in: "Sign in again and retry.",
  not_staff: "Only team members can add a referral here.",
  name: "Enter the person's name.",
  phone: "Enter a valid phone number.",
  member: "This person is already a member, so a referral cannot be added.",
  limit: "You have added many referrals today. Try again tomorrow.",
  not_saved: "The referral could not be saved. Try again.",
};

const SAVED: Record<string, string> = {
  new_lead: "Referral sent to the leads team.",
  added_to_lead: "This person is already a lead. Your referral was added to it.",
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

// ---------------------------------------------------------------- the Leads page tag

export interface LeadReferralInfo {
  /** How many times team members referred this lead. */
  times: number;
  /** The members, first to last, without repeats: "Raj Thakur (Trainer)". */
  members: string[];
  /** The day of the latest referral on a lead that already existed (YYYY-MM-DD), or null. */
  lastReferredOn: string | null;
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
  const out: LeadReferralInfo = { times: 0, members: [], lastReferredOn: null };
  if (!Array.isArray(remarks)) return out;
  for (const e of remarks) {
    if (!e || typeof e !== "object" || (e as Record<string, unknown>).kind !== "staff_referral") continue;
    const entry = e as Record<string, unknown>;
    out.times++;
    const who = `${String(entry.author_name ?? "A team member")} (${roleLabel(entry.referrer_role)})`;
    if (!out.members.includes(who)) out.members.push(who);
    const day = typeof entry.last_referred_on === "string" ? entry.last_referred_on : null;
    if (day && (!out.lastReferredOn || day > out.lastReferredOn)) out.lastReferredOn = day;
  }
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

/** The tag on a lead: "" when no member referred it. */
export function leadReferredTag(info: LeadReferralInfo): string {
  if (info.times <= 0) return "";
  if (info.lastReferredOn) return `Referred again ${referralDay(info.lastReferredOn)}`;
  return info.times === 1 ? "Referred" : `Referred ${info.times} times`;
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
