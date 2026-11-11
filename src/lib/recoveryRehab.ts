/**
 * Recovery and rehab status on the QHP (11 Nov 2026, owner / Raj): per-area entries inside the Pain/Discomfort
 * section of the Medical History step. Everything lives in the SAME assessment JSON, no table and no column:
 *
 *   "Standardized Assessment".medicalHistory.recoveryRehab      RecoveryRehabEntry[]   the structured entries
 *   "Standardized Assessment".medicalHistory.painDiscomfortNotes string                 the assessor's free text
 *   "Standardized Assessment".medicalHistory.painDiscomfortAreas string                 what every older reader uses
 *
 * painDiscomfortAreas stays the one text about fifteen screens and two score functions read. It is now written by
 * `painTextProjection`: with no structured entry it is the free text exactly as before; with entries it is the
 * names of the areas that are not resolved, comma separated, then the free text. The senior score counts pain
 * sites by splitting that text on commas, so the projection lists one name per area and nothing else.
 *
 * Progress across QHPs: an entry keeps its `id` when it is carried into the next QHP, and carries a `previous`
 * snapshot (pain, status, day) of how it stood at the QHP it came from. So the change is exact per area and is
 * read from the QHP itself. Pure module (no React, no Supabase), tested offline.
 */

export type RehabSide = "" | "left" | "right" | "both";
export type RehabType = "" | "acute_injury" | "post_surgery" | "chronic_condition";
export type RehabStatus = "" | "active" | "improving" | "resolved";
export type RehabReferral = "" | "none" | "physio" | "doctor" | "therapy" | "other";

export type RehabSnapshot = {
  intensity: number | null;
  status: RehabStatus;
  /** 'yyyy-MM-dd' of the QHP the snapshot comes from. */
  day: string | null;
  assessmentId: string | null;
};

export type RecoveryRehabEntry = {
  /** Stable across QHPs: the same problem keeps its id when it is carried forward. */
  id: string;
  /** A name from REHAB_AREAS, or the assessor's own words when it is not on the list. */
  area: string;
  side: RehabSide;
  /** Pain right now, 0 (none) to 10 (worst). */
  intensity: number | null;
  type: RehabType;
  status: RehabStatus;
  /** Recovery / rehab recommendation, in the assessor's words. */
  recommendation: string;
  referral: RehabReferral;
  referralNote: string;
  /** How the same entry stood at the QHP it was carried from; null for a new entry. */
  previous: RehabSnapshot | null;
};

export const REHAB_AREAS = ["Neck", "Shoulder", "Upper back", "Spine", "Lower back", "Elbow", "Wrist or hand", "Hip", "Knee", "Ankle or foot"] as const;
export const REHAB_AREA_OTHER = "Other";

export const REHAB_SIDE_LABEL: Record<Exclude<RehabSide, "">, string> = { left: "Left", right: "Right", both: "Both sides" };
export const REHAB_TYPE_LABEL: Record<Exclude<RehabType, "">, string> = { acute_injury: "Acute injury", post_surgery: "Post-surgery", chronic_condition: "Chronic condition" };
export const REHAB_STATUS_LABEL: Record<Exclude<RehabStatus, "">, string> = { active: "Active", improving: "Improving", resolved: "Resolved" };
export const REHAB_REFERRAL_LABEL: Record<Exclude<RehabReferral, "">, string> = { none: "No referral", physio: "Physiotherapist", doctor: "Doctor", therapy: "Therapy", other: "Other" };

export const REHAB_TEXT_MAX = 400;
export const REHAB_MAX_ENTRIES = 12;

const SIDES = new Set(["left", "right", "both"]);
const TYPES = new Set(["acute_injury", "post_surgery", "chronic_condition"]);
const STATUSES = new Set(["active", "improving", "resolved"]);
const REFERRALS = new Set(["none", "physio", "doctor", "therapy", "other"]);

export const newRehabId = (): string => `rr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export const emptyRehabEntry = (): RecoveryRehabEntry => ({
  id: newRehabId(), area: "", side: "", intensity: null, type: "", status: "active", recommendation: "", referral: "", referralNote: "", previous: null,
});

const text = (v: unknown, max = REHAB_TEXT_MAX): string => (typeof v === "string" ? v : v == null ? "" : String(v)).trim().slice(0, max);

/** 0 to 10, whole number; anything else is "not given". */
export const cleanIntensity = (v: unknown): number | null => {
  if (v === "" || v == null) return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  if (!Number.isFinite(n)) return null;
  return Math.min(10, Math.max(0, Math.round(n)));
};

const snapshotFrom = (v: unknown): RehabSnapshot | null => {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const status = STATUSES.has(String(o.status)) ? (o.status as RehabStatus) : "";
  const intensity = cleanIntensity(o.intensity);
  if (intensity == null && !status) return null;
  const day = typeof o.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.day) ? o.day : null;
  return { intensity, status, day, assessmentId: typeof o.assessmentId === "string" && o.assessmentId ? o.assessmentId : null };
};

/** Reads the JSON value back into entries; anything unreadable is dropped, never thrown. */
export function recoveryRehabFromJson(v: unknown): RecoveryRehabEntry[] {
  if (!Array.isArray(v)) return [];
  const out: RecoveryRehabEntry[] = [];
  const seen = new Set<string>();
  for (const raw of v) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    let id = text(o.id, 60) || newRehabId();
    while (seen.has(id)) id = newRehabId();
    seen.add(id);
    out.push({
      id,
      area: text(o.area, 80),
      side: SIDES.has(String(o.side)) ? (o.side as RehabSide) : "",
      intensity: cleanIntensity(o.intensity),
      type: TYPES.has(String(o.type)) ? (o.type as RehabType) : "",
      status: STATUSES.has(String(o.status)) ? (o.status as RehabStatus) : "",
      recommendation: text(o.recommendation),
      referral: REFERRALS.has(String(o.referral)) ? (o.referral as RehabReferral) : "",
      referralNote: text(o.referralNote, 200),
      previous: snapshotFrom(o.previous),
    });
    if (out.length >= REHAB_MAX_ENTRIES) break;
  }
  return out;
}

/** An entry counts once it names an area. */
export const isFilledRehabEntry = (e: RecoveryRehabEntry): boolean => e.area.trim() !== "";

/** The value saved in the JSON: filled entries only, trimmed; an empty list is saved as []. */
export function recoveryRehabJson(entries: ReadonlyArray<RecoveryRehabEntry>): RecoveryRehabEntry[] {
  return recoveryRehabFromJson(entries.filter(isFilledRehabEntry));
}

/** "Right knee", "Lower back (both sides)", "Left shoulder". */
export function rehabAreaLabel(e: Pick<RecoveryRehabEntry, "area" | "side">): string {
  const area = e.area.trim();
  if (!area) return "";
  if (e.side === "left" || e.side === "right") return `${REHAB_SIDE_LABEL[e.side]} ${area.charAt(0).toLowerCase()}${area.slice(1)}`;
  if (e.side === "both") return `${area} (both sides)`;
  return area;
}

/** Entries that are still a current problem (not resolved). */
export const openRehabEntries = (entries: ReadonlyArray<RecoveryRehabEntry>): RecoveryRehabEntry[] =>
  entries.filter((e) => isFilledRehabEntry(e) && e.status !== "resolved");

/**
 * The text saved as painDiscomfortAreas. No structured entry: the free text, exactly as before this feature.
 * With entries: one name per open area, comma separated (the senior score counts sites on commas), then the notes.
 * Commas inside an area name are removed so one area is always one site.
 */
export function painTextProjection(notes: string, entries: ReadonlyArray<RecoveryRehabEntry>): string {
  const free = (notes ?? "").trim();
  const names = openRehabEntries(entries).map((e) => rehabAreaLabel(e).replace(/[,;/]/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean);
  if (names.length === 0) return free;
  return free ? `${names.join(", ")}. ${free}` : names.join(", ");
}

/**
 * The free text to put back in the notes box. A QHP saved with this feature has painDiscomfortNotes (even when
 * empty); an older QHP has only painDiscomfortAreas, which was the free text.
 */
export function painNotesFromMedical(medical: Record<string, unknown> | null | undefined): string {
  const m = medical ?? {};
  if (typeof m.painDiscomfortNotes === "string") return m.painDiscomfortNotes;
  return typeof m.painDiscomfortAreas === "string" ? m.painDiscomfortAreas : "";
}

/**
 * Entries to start the NEXT QHP with: the ones not resolved, each keeping its id and carrying a snapshot of how it
 * stood at the QHP it comes from. Everything else, the recommendation included, comes along as a starting point
 * for the assessor to update.
 */
export function carryRehabForward(entries: ReadonlyArray<RecoveryRehabEntry>, from: { assessmentId: string | null; day: string | null }): RecoveryRehabEntry[] {
  return openRehabEntries(entries).map((e) => ({
    ...e,
    previous: { intensity: e.intensity, status: e.status, day: from.day, assessmentId: from.assessmentId },
  }));
}

export type RehabTrend = "new" | "better" | "worse" | "same" | "resolved";

export interface RehabProgress {
  trend: RehabTrend;
  /** "6 to 3", "still 6", or "" when either side has no number. */
  painChange: string;
  /** "Active to improving" or "" when unchanged or unknown. */
  statusChange: string;
  /** One plain line, e.g. "Better since 13 Sep: pain 6 to 3, active to improving." */
  line: string;
}

const STATUS_RANK: Record<string, number> = { active: 0, improving: 1, resolved: 2 };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayLabel = (ymd: string | null): string => {
  if (!ymd) return "";
  const [, m, d] = ymd.split("-").map(Number);
  return `${d} ${MONTHS[m - 1] ?? ""}`.trim();
};

/** How an entry changed since the QHP it was carried from. */
export function rehabProgress(e: RecoveryRehabEntry): RehabProgress {
  const p = e.previous;
  if (!p) return { trend: "new", painChange: "", statusChange: "", line: "New at this QHP." };
  const a = p.intensity;
  const b = e.intensity;
  const painChange = a != null && b != null ? (a === b ? `still ${a}` : `${a} to ${b}`) : "";
  const statusChange = p.status && e.status && p.status !== e.status ? `${REHAB_STATUS_LABEL[p.status as Exclude<RehabStatus, "">].toLowerCase()} to ${REHAB_STATUS_LABEL[e.status as Exclude<RehabStatus, "">].toLowerCase()}` : "";
  const painDelta = a != null && b != null ? b - a : 0;
  const statusDelta = p.status && e.status ? (STATUS_RANK[e.status] ?? 0) - (STATUS_RANK[p.status] ?? 0) : 0;
  let trend: RehabTrend;
  if (e.status === "resolved") trend = "resolved";
  else if (painDelta < 0 || (painDelta === 0 && statusDelta > 0)) trend = "better";
  else if (painDelta > 0 || (painDelta === 0 && statusDelta < 0)) trend = "worse";
  else trend = "same";
  const word = trend === "resolved" ? "Resolved" : trend === "better" ? "Better" : trend === "worse" ? "Worse" : "No change";
  const since = p.day ? ` since ${dayLabel(p.day)}` : " since the last QHP";
  const parts = [painChange ? `pain ${painChange}` : "", statusChange].filter(Boolean);
  return { trend, painChange, statusChange, line: `${word}${since}${parts.length ? `: ${parts.join(", ")}` : ""}.` };
}

/** "Pain 6/10", "No pain now" or "" when no number was given. */
export const rehabPainText = (intensity: number | null): string => (intensity == null ? "" : intensity === 0 ? "No pain now" : `Pain ${intensity}/10`);

/** "Physiotherapist: Dr Mehta, Tuesday" / "No referral" / "". */
export function rehabReferralText(e: Pick<RecoveryRehabEntry, "referral" | "referralNote">): string {
  if (!e.referral) return e.referralNote.trim();
  const label = REHAB_REFERRAL_LABEL[e.referral];
  if (e.referral === "none") return label;
  const note = e.referralNote.trim();
  if (e.referral === "other") return note || "Other";
  return note ? `${label}: ${note}` : label;
}

/** One line per entry for plain-text readers (doctor summary, trainer card, push). */
export function rehabSummaryLine(e: RecoveryRehabEntry): string {
  const bits = [
    rehabPainText(e.intensity).toLowerCase(),
    e.type ? REHAB_TYPE_LABEL[e.type].toLowerCase() : "",
    e.status ? REHAB_STATUS_LABEL[e.status].toLowerCase() : "",
  ].filter(Boolean);
  const head = `${rehabAreaLabel(e)}${bits.length ? `: ${bits.join(", ")}` : ""}`;
  const rec = e.recommendation.trim();
  const ref = e.referral && e.referral !== "none" ? rehabReferralText(e) : "";
  return [head, rec ? `Recommendation: ${rec}` : "", ref ? `Referral: ${ref}` : ""].filter(Boolean).join(". ").replace(/\.\./g, ".");
}

// ------------------------------------------------------------ reading a saved QHP --

/** The assessment envelope root of a coach_assessment row or of its data column value. */
function envelopeRoots(rowOrData: unknown): Record<string, unknown>[] {
  if (!rowOrData || typeof rowOrData !== "object") return [];
  const o = rowOrData as Record<string, unknown>;
  const datas = "new_client_assessment_data" in o || "qhp_data" in o || "existing_client_assessment_data" in o
    ? [o.qhp_data, o.new_client_assessment_data, o.existing_client_assessment_data]
    : [o];
  const roots: Record<string, unknown>[] = [];
  for (const d of datas) {
    if (!d || typeof d !== "object") continue;
    const dd = d as Record<string, unknown>;
    for (const key of ["Standardized Assessment", "Existing Client Re-Assessment"]) {
      const r = dd[key];
      if (r && typeof r === "object") roots.push(r as Record<string, unknown>);
    }
    if (dd.medicalHistory || dd.trainerRecommendations) roots.push(dd);
  }
  return roots;
}

/** The recovery and rehab entries saved on a QHP (row or data), [] when it has none. */
export function extractRecoveryRehab(rowOrData: unknown): RecoveryRehabEntry[] {
  for (const r of envelopeRoots(rowOrData)) {
    const mh = r.medicalHistory as Record<string, unknown> | undefined;
    const list = recoveryRehabFromJson(mh?.recoveryRehab);
    if (list.length) return list;
  }
  return [];
}

/** The "Recommendations for trainers" lines saved on a QHP, [] when none (or "No recommendation"). */
export function extractTrainerRecommendations(rowOrData: unknown): string[] {
  for (const r of envelopeRoots(rowOrData)) {
    const v = r.trainerRecommendations;
    if (Array.isArray(v)) {
      const lines = v.map((x) => (x == null ? "" : String(x)).trim()).filter(Boolean);
      if (lines.length) return lines;
    }
  }
  return [];
}

export interface QhpGuidance {
  recommendations: string[];
  /** Entries a trainer must programme around: everything not resolved. */
  rehab: RecoveryRehabEntry[];
  /** Entries resolved at this QHP (good news, shown small). */
  resolved: RecoveryRehabEntry[];
  /** True when there is anything to read. */
  hasContent: boolean;
}

/** What a client's trainers should read from one QHP. */
export function qhpGuidanceOf(rowOrData: unknown): QhpGuidance {
  const all = extractRecoveryRehab(rowOrData);
  const rehab = openRehabEntries(all);
  const resolved = all.filter((e) => isFilledRehabEntry(e) && e.status === "resolved");
  const recommendations = extractTrainerRecommendations(rowOrData);
  return { recommendations, rehab, resolved, hasContent: recommendations.length > 0 || rehab.length > 0 };
}

/** One line for a push: "3 recommendations and 2 recovery notes to read". Empty when there is nothing. */
export function qhpGuidanceCountLine(g: Pick<QhpGuidance, "recommendations" | "rehab">): string {
  const r = g.recommendations.length;
  const n = g.rehab.length;
  const parts = [r ? `${r} recommendation${r === 1 ? "" : "s"}` : "", n ? `${n} recovery note${n === 1 ? "" : "s"}` : ""].filter(Boolean);
  return parts.length ? `${parts.join(" and ")} to read` : "";
}
