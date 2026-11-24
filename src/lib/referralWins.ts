/**
 * "Your client's referral has joined Odds" (24 Nov 2026): the celebration on the CRM's dashboard, and the
 * record of whether the client was congratulated.
 *
 * The server (get_my_client_referral_wins) lists the referrals given by the signed-in CRM's own clients that
 * have joined (the lead converted and its payment was received) and that nobody has marked yet. "Done,
 * congratulated" is saved in the database (mark_referral_congratulated: who and when), because the client
 * earns one free week of training for the referral and the business wants to know they were told. Admins, Ops
 * and the CRM leads read the whole list (get_client_referral_congrats).
 *
 * This file reads those lists safely and writes the words. Pure functions only.
 */
import { referralDay, istDay } from "./staffReferral";

export interface ReferralWin {
  /** One per client per person who joined: "<lead id>:<client id>". */
  key: string;
  leadId: string;
  clientId: string;
  clientName: string;
  joinedName: string;
  /** YYYY-MM-DD, the day the payment was received. */
  joinedOn: string;
  relation: string | null;
  /** "Raj Thakur (Trainer)": the team member who submitted the referral. */
  submittedBy: string | null;
}

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Makes a safe list out of whatever the server sent. */
export function readReferralWins(raw: unknown): ReferralWin[] {
  if (!Array.isArray(raw)) return [];
  const out: ReferralWin[] = [];
  const seen = new Set<string>();
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const r = x as Record<string, unknown>;
    const lead = text(r.lead_id), client = text(r.client_id), joined = text(r.joined_name);
    if (!lead || !client || !joined) continue;
    const key = `${lead}:${client}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      key,
      leadId: lead,
      clientId: client,
      clientName: text(r.client_name) ?? "Your client",
      joinedName: joined,
      joinedOn: text(r.joined_on) ?? "",
      relation: text(r.relation),
      submittedBy: text(r.submitted_by),
    });
  }
  return out;
}

/** "Asha Verma's referral has joined Odds!" */
export function winHeadline(w: ReferralWin): string {
  return `${w.clientName}'s referral has joined Odds!`;
}

/** "Kabir Shah (Friend) became a member on 2 Dec 2026." */
export function winLine(w: ReferralWin): string {
  const who = w.relation ? `${w.joinedName} (${w.relation})` : w.joinedName;
  const day = referralDay(w.joinedOn);
  return `${who} became a member${day ? ` on ${day}` : ""}.`;
}

/** What the CRM is asked to do: congratulate the client and tell them about the reward. */
export function winAsk(w: ReferralWin): string {
  return `Congratulate ${w.clientName} and tell them about their free week of training (sessions as per their current package).`;
}

export const WIN_MARK_ERROR = "This could not be saved. Check your connection and try again.";

// ---------------------------------------------------------------- the list for admins, Ops and the CRM leads

export interface CongratsRow {
  key: string;
  clientId: string;
  clientName: string;
  /** The client's CRM, "" when the client has none. */
  crmName: string;
  joinedName: string;
  joinedOn: string;
  congratulated: boolean;
  /** Who marked it and the day ("24 Nov 2026"), when congratulated. */
  congratulatedBy: string | null;
  congratulatedDay: string;
}

export function readCongratsReport(raw: unknown): CongratsRow[] {
  if (!Array.isArray(raw)) return [];
  const out: CongratsRow[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const r = x as Record<string, unknown>;
    const lead = text(r.lead_id), client = text(r.client_id), joined = text(r.joined_name);
    if (!lead || !client || !joined) continue;
    const done = r.congratulated === true;
    out.push({
      key: `${lead}:${client}`,
      clientId: client,
      clientName: text(r.client_name) ?? "A client",
      crmName: text(r.crm_name) ?? "",
      joinedName: joined,
      joinedOn: text(r.joined_on) ?? "",
      congratulated: done,
      congratulatedBy: done ? text(r.congratulated_by) : null,
      congratulatedDay: done ? referralDay(istDay(text(r.congratulated_at))) : "",
    });
  }
  return out;
}

/** "2 of 5 clients congratulated". */
export function congratsSummary(rows: CongratsRow[]): { done: number; waiting: number; line: string } {
  const done = rows.filter((r) => r.congratulated).length;
  const waiting = rows.length - done;
  const line = rows.length === 0 ? "No client referral has joined yet." : `${done} of ${rows.length} ${rows.length === 1 ? "client" : "clients"} congratulated`;
  return { done, waiting, line };
}

/** Admins, Ops and the CRM leads (tags team_lead / crm_head) read the whole list; the server checks the same. */
export function canSeeCongratsReport(profile: { role?: string | null; role_specialization?: string[] | null } | null | undefined): boolean {
  const role = String(profile?.role ?? "").toLowerCase();
  if (role === "admin" || role === "super_admin" || role === "ops") return true;
  const tags = Array.isArray(profile?.role_specialization) ? profile!.role_specialization! : [];
  return role === "crm" && tags.some((t) => t === "team_lead" || t === "crm_head");
}
