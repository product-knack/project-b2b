/* Expired-plan gate on My Crew roster making, the pure rules (27 Oct 2026). Owner: "if a plan is expired
   tomorrow or already, and a trainer from my crew tries to make tomorrow's roster, show that its plan is
   expired; first make a plan and approve it, then allow it, with a Create plan button".
   The server holds the rule (hub-track migration 20261028100000: workout_plan_cover_eval, get_plan_cover, and
   the plan_expired answer of plan_sync_roster / plan_manager_add_session). This file reads that answer and
   writes the copy. No native imports: the iOS repo copies it byte for byte. */

export type PlanCoverState = 'valid' | 'expired' | 'none';
export type PlanReviewState = 'in_review' | 'needs_revision' | null;

export type PlanCoverRow = {
  clientId: string;
  modalityKey: string;
  modalityLabel: string;
  state: PlanCoverState;
  enforced: boolean;
  blocked: boolean;
  expiresAt: string | null;
  lastApprovedAt: string | null;
  reviewState: PlanReviewState;
  reviewPlanId: string | null;
};

/** clientId -> modalityKey -> row */
export type PlanCoverMap = Record<string, Record<string, PlanCoverRow>>;

/** The same normalisation as the SQL session_modality_key: lowercase, drop "training", keep a to z. */
export const modalityKey = (label: string | null | undefined): string =>
  String(label ?? '').toLowerCase().split('training').join('').replace(/[^a-z]/g, '');

const str = (v: unknown) => (typeof v === 'string' && v ? v : null);

/** Tolerant reader of get_plan_cover rows. Unreadable rows are skipped. */
export const parsePlanCover = (rows: unknown): PlanCoverMap => {
  const out: PlanCoverMap = {};
  if (!Array.isArray(rows)) return out;
  for (const r of rows as any[]) {
    const cid = str(r?.client_id);
    const key = str(r?.modality_key);
    if (!cid || !key) continue;
    const state: PlanCoverState = r.state === 'valid' || r.state === 'expired' ? r.state : 'none';
    const review: PlanReviewState = r.review_state === 'in_review' || r.review_state === 'needs_revision' ? r.review_state : null;
    (out[cid] ??= {})[key] = {
      clientId: cid,
      modalityKey: key,
      modalityLabel: str(r.modality_label) ?? key,
      state,
      enforced: r.enforced === true,
      blocked: r.blocked === true,
      expiresAt: str(r.expires_at),
      lastApprovedAt: str(r.last_approved_at),
      reviewState: review,
      reviewPlanId: str(r.review_plan_id),
    };
  }
  return out;
};

export type PlanCoverVerdict = {
  blocked: boolean;
  row: PlanCoverRow | null;
};

/** The verdict for one row of the sheet: the client's cover for the picked modality. No modality or an
    unknown modality (never planned, or one without plans) is never blocked. */
export const coverFor = (map: PlanCoverMap | null | undefined, clientId: string, modality: string | null | undefined): PlanCoverVerdict => {
  if (!map || !modality) return { blocked: false, row: null };
  const row = map[clientId]?.[modalityKey(modality)] ?? null;
  return { blocked: !!row && row.blocked, row };
};

/** The server function is not installed yet (before the migration runs): block nothing on the device. */
export const isPlanCoverMissing = (message: unknown): boolean =>
  /PGRST202|could not find the function|get_plan_cover.*(does not exist|not found)/i.test(String(message ?? ''));

/** "22 Oct 2026" in IST. */
export const coverDayLabel = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const d = new Date(t + 330 * 60_000);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

/** Is the expiry already behind us (IST now)? Else it expires later on or before the session day. */
const expiredAlready = (expiresAt: string | null, nowMs: number): boolean => {
  if (!expiresAt) return true;
  const t = new Date(expiresAt).getTime();
  return !Number.isFinite(t) || t <= nowMs;
};

export const COVER_KICKER = 'PLAN EXPIRED';
export const COVER_KICKER_REVIEW = 'PLAN WAITING FOR APPROVAL';
export const COVER_KICKER_REVISION = 'PLAN NEEDS CHANGES';
export const COVER_CTA = 'Create plan';
export const COVER_CTA_REVISION = 'Open Plan tab';

/** The red line under a blocked row. */
export const coverBlockedLine = (o: { clientFirst: string; modalityLabel: string; expiresAt: string | null; nowMs?: number }): string => {
  const day = coverDayLabel(o.expiresAt);
  const now = o.nowMs ?? Date.now();
  const when = !day ? 'has expired' : expiredAlready(o.expiresAt, now) ? `expired on ${day}` : `expires on ${day}, before this session`;
  return `${o.clientFirst}'s ${o.modalityLabel} plan ${when}. Make a new plan and get it approved before you add this session.`;
};

/** The amber or red line when a new plan is already with the reviewer. */
export const coverReviewLine = (modalityLabel: string, reviewState: PlanReviewState): string | null => {
  if (reviewState === 'in_review') return `A new ${modalityLabel} plan is waiting for approval. The session can be added once it is approved.`;
  if (reviewState === 'needs_revision') return `The new ${modalityLabel} plan was sent back and needs changes. Fix it in the client's Plan tab, then it goes for approval again.`;
  return null;
};

/** The kicker over the box, by review state. */
export const coverKicker = (reviewState: PlanReviewState): string =>
  reviewState === 'in_review' ? COVER_KICKER_REVIEW : reviewState === 'needs_revision' ? COVER_KICKER_REVISION : COVER_KICKER;

/** The button under the box: Create plan (nothing in review), Open Plan tab (sent back), none (in review). */
export const coverAction = (reviewState: PlanReviewState): 'create' | 'revise' | null =>
  reviewState === 'in_review' ? null : reviewState === 'needs_revision' ? 'revise' : 'create';

/** The popup when Send is pressed with blocked rows. */
export const coverSendBlockedText = (firstNames: string[]): string =>
  `${firstNames.join(', ')}: the plan has expired for that day. Make a new plan and get it approved first, or pick a modality that has a valid plan.`;

/** A server answer for one entry that the gate refused. */
export const isPlanExpiredResult = (r: unknown): boolean => (r as any)?.result === 'plan_expired';

/** The sentence when the server refused an entry the device did not know about. */
export const coverServerRefusedText = (o: { clientFirst: string; modality: string | null; expiresAt: string | null }): string => {
  const day = coverDayLabel(o.expiresAt);
  return `${o.clientFirst}'s ${o.modality || 'training'} plan ${day ? `expires on ${day}` : 'has expired'}. The session was not added to the roster. Make a new plan and get it approved, then retry.`;
};

/**
 * True for the server's refusal sentence (30 Oct 2026, hub-track 20261030190000): plan_manager_add_session raises
 * "Sadhvi's Strength plan ran out on 30 Oct 2026. The session was not added to the roster. Make a new plan and get
 * it approved first." instead of answering plan_expired, so the Add alert can be titled "Plan expired". The server
 * says "ran out" / "runs out" because builds before this fix took "expired" for a system error code.
 */
export const isPlanCoverRefusal = (message: string | null | undefined): boolean =>
  /\bplan (ran out|runs out|has run out|expired|expires|has expired)\b[\s\S]*not added to the roster/i.test(String(message ?? ''));

/** The day card tag for an entry the server refused. */
export const COVER_CARD_TAG = 'PLAN EXPIRED · NOT BOOKED';

/** The Create Plan screen's modality for a roster modality label ('Strength' -> 'Strength Training'). */
export const planModalityFor = (modalityLabel: string | null | undefined): string | null => {
  const k = modalityKey(modalityLabel);
  const MAP: Record<string, string> = { strength: 'Strength Training', boxing: 'Boxing', yoga: 'Yoga', pilates: 'Pilates', aerobics: 'Aerobics', aquaaerobics: 'Aqua Aerobics' };
  return MAP[k] ?? null;
};
