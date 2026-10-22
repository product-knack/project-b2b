/* Plan-less session limit, the pure rules (22 Oct 2026). Owner: "except the Essentials subscription type, if a
   client does not have an approved plan for that modality, only 3 sessions may be logged; after that it must not
   allow it". Since hub-track migration 20261022120000 the server holds the rule (workout_plan_gate_eval) and
   refuses the 4th session with PLAN_LIMIT on every path, the offline queue included; the app reads the same
   answer through get_workout_plan_gate to show the counter and to stop the form early. Essentials clients are not
   enforced on the server (owner: leave them as they are); the app keeps blocking them on the device, as before,
   with the server's numbers. No native imports here. */

export const PLAN_LIMIT_PREFIX = 'PLAN_LIMIT';
export const PLANLESS_LIMIT = 3;
export const PLAN_LIMIT_FALLBACK = 'Plan limit reached: 3 sessions are logged without an approved plan. Get the plan approved, then Retry.';

export type PlanGateAnswer = {
  /** A modality that has workout plans (Strength, Yoga, Pilates, Boxing, Aerobics, Aqua Aerobics). */
  gated: boolean;
  essentials: boolean;
  /** The server refuses the 4th session (gated and not Essentials). */
  enforced: boolean;
  hasValidPlan: boolean;
  planKind: 'exercise' | 'document' | 'none';
  lastApprovedAt: string | null;
  planExpiresAt: string | null;
  planExpired: boolean;
  loggedCount: number;
  limit: number;
  remaining: number;
  blocked: boolean;
};

const bool = (v: unknown) => v === true;
const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown) => (typeof v === 'string' && v ? v : null);

/** Tolerant reader of get_workout_plan_gate's json. Null when the answer is unreadable. */
export const parsePlanGate = (data: unknown): PlanGateAnswer | null => {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (typeof d.gated !== 'boolean' || typeof d.logged_count !== 'number') return null;
  const limit = num(d.limit, PLANLESS_LIMIT);
  const loggedCount = num(d.logged_count);
  const kind = d.plan_kind === 'exercise' || d.plan_kind === 'document' ? d.plan_kind : 'none';
  return {
    gated: bool(d.gated),
    essentials: bool(d.essentials),
    enforced: bool(d.enforced),
    hasValidPlan: bool(d.has_valid_plan),
    planKind: kind,
    lastApprovedAt: str(d.last_approved_at),
    planExpiresAt: str(d.plan_expires_at),
    planExpired: bool(d.plan_expired),
    loggedCount,
    limit,
    remaining: Math.max(0, num(d.remaining, limit - loggedCount)),
    blocked: bool(d.blocked),
  };
};

/** The server function is not installed yet (before the migration runs): use the device's own count. */
export const isPlanGateMissing = (message: unknown): boolean =>
  /PGRST202|could not find the function|get_workout_plan_gate.*(does not exist|not found)/i.test(String(message ?? ''));

/** True for the server's refusal of the 4th plan-less session. */
export const isPlanLimitError = (e: unknown): boolean => String((e as any)?.message ?? e ?? '').includes(PLAN_LIMIT_PREFIX);

/** The server's sentence without its code ("Jasmeet has no approved Strength plan and 5 Strength sessions ..."). */
export const planLimitText = (e: unknown): string => {
  const msg = String((e as any)?.message ?? e ?? '');
  const i = msg.indexOf(PLAN_LIMIT_PREFIX);
  if (i < 0) return PLAN_LIMIT_FALLBACK;
  const rest = msg.slice(i + PLAN_LIMIT_PREFIX.length).replace(/^\s*:\s*/, '').trim();
  return rest || PLAN_LIMIT_FALLBACK;
};

/** "22 Oct 2026" in IST for the expired-plan line. */
export const planDayLabel = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const d = new Date(t + 330 * 60_000);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

/** The red card's sentence when the form is blocked. */
export const planBlockedText = (o: { clientName: string; modality: string; loggedCount: number; planExpired: boolean; planExpiresAt: string | null }): string => {
  const day = planDayLabel(o.planExpiresAt);
  return o.planExpired && day
    ? `${o.clientName}'s ${o.modality} plan expired on ${day} and ${o.loggedCount} ${o.modality} sessions are logged with you. A new approved ${o.modality} plan is required to log more.`
    : `You've logged ${o.loggedCount} ${o.modality} sessions for ${o.clientName} without an approved training plan. An approved ${o.modality} plan is required to log more.`;
};
