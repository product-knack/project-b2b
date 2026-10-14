/* Trainer medicine check-in (14 Oct 2026): pure rules and shapes. Every 10 days the
   workout health check-in asks which medicines the client is taking: the latest
   prescription's and the latest QHP's medicines, plus whatever was ticked last time,
   with free-text additions. The server (hub-track migration 20261014170000) decides
   "due" and the candidate list (get_client_medicine_checkin); the app ticks, adds,
   and records through record_client_medicine_checkin with the workout's session id.
   Import-free so the query modules and the offline drain can share it. */

export const MEDICINE_INTERVAL_DAYS = 10;
export const MEDICINE_MAX_ITEMS = 30;
export const MEDICINE_NAME_MAX = 120;

export type MedicineSource = 'doctor' | 'qhp' | 'trainer';

export type MedicineOrigin = {
  kind?: 'consultation' | 'qhp' | 'trainer' | string | null;
  id?: string | null;
  date?: string | null;
  line_id?: string | null;
  doctor?: string | null;
};

export type MedicineCandidate = {
  name: string;
  strength: string | null;
  dose_text: string | null;
  source: MedicineSource;
  source_date: string | null;
  origin: MedicineOrigin | null;
  /** ticked at the last check-in */
  selected: boolean;
};

export type MedicineCheckinInfo = {
  due: boolean;
  last_checkin_at: string | null;
  interval_days: number;
  prescription: { id: string; date: string | null; doctor: string | null } | null;
  qhp: { id: string; date: string | null } | null;
  candidates: MedicineCandidate[];
};

/** One item sent to record_client_medicine_checkin. */
export type MedicineItem = { name: string; strength: string | null; source: MedicineSource; origin: MedicineOrigin | null };

/** What the health check-in hands to the workout submit (rides in the outbox payload). */
export type MedicineCheckinPayload = { checkinId: string; items: MedicineItem[] };

const normName = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
/** The key the ticked map uses (case-insensitive, single-spaced). */
export const nameKey = normName;

/** Form placeholders that are not medicines ("Other" is the QHP form's checkbox option; the
    server splitter drops them too since migration 20261014180000; this is the safety net). */
const PLACEHOLDER = /^(none|nil|no|na|n\/a|-|nothing|other|others|other medicines?|other medications?|no medications?|no medicines?|not applicable|none of the above)\.?$/i;
export const isPlaceholderName = (name: string): boolean => PLACEHOLDER.test(normName(name));

/** The RPC's json, tolerant of nulls and junk. Null when the shape is not usable. */
export function parseCheckinInfo(v: unknown): MedicineCheckinInfo | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as any;
  const candidates: MedicineCandidate[] = Array.isArray(o.candidates)
    ? o.candidates
        .filter((c: any) => c && typeof c.name === 'string' && c.name.trim() && !isPlaceholderName(c.name))
        .map((c: any) => ({
          name: String(c.name).replace(/\s+/g, ' ').trim().slice(0, MEDICINE_NAME_MAX),
          strength: typeof c.strength === 'string' && c.strength.trim() ? c.strength.trim() : null,
          dose_text: typeof c.dose_text === 'string' && c.dose_text.trim() ? c.dose_text.trim() : null,
          source: c.source === 'doctor' || c.source === 'qhp' ? c.source : 'trainer',
          source_date: typeof c.source_date === 'string' ? c.source_date : null,
          origin: c.origin && typeof c.origin === 'object' ? c.origin : null,
          selected: c.selected === true,
        }))
    : [];
  return {
    due: o.due === true,
    last_checkin_at: typeof o.last_checkin_at === 'string' ? o.last_checkin_at : null,
    interval_days: Number(o.interval_days) > 0 ? Number(o.interval_days) : MEDICINE_INTERVAL_DAYS,
    prescription: o.prescription && typeof o.prescription === 'object' && o.prescription.id ? { id: String(o.prescription.id), date: o.prescription.date ?? null, doctor: o.prescription.doctor ?? null } : null,
    qhp: o.qhp && typeof o.qhp === 'object' && o.qhp.id ? { id: String(o.qhp.id), date: o.qhp.date ?? null } : null,
    candidates,
  };
}

/** The pre-ticked set when the card opens: the names ticked at the last check-in. */
export const initialTicked = (candidates: MedicineCandidate[]): Record<string, boolean> =>
  Object.fromEntries(candidates.map((c) => [normName(c.name), c.selected]));

/** Build the RPC items: ticked candidates in their order, then the added names, deduplicated
    by name (case-insensitive), capped at MEDICINE_MAX_ITEMS. An empty list means "none". */
export function buildCheckinItems(candidates: MedicineCandidate[], ticked: Record<string, boolean>, added: string[]): MedicineItem[] {
  const out: MedicineItem[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    const k = normName(c.name);
    if (!ticked[k] || seen.has(k)) continue;
    seen.add(k);
    out.push({ name: c.name, strength: c.strength, source: c.source, origin: c.origin });
  }
  for (const raw of added) {
    const name = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, MEDICINE_NAME_MAX);
    const k = normName(name);
    if (!name || seen.has(k) || isPlaceholderName(name)) continue;
    seen.add(k);
    out.push({ name, strength: null, source: 'trainer', origin: { kind: 'trainer' } });
  }
  return out.slice(0, MEDICINE_MAX_ITEMS);
}

/** True when a typed name duplicates a candidate or an already added name. */
export const isDuplicateName = (name: string, candidates: MedicineCandidate[], added: string[]): boolean => {
  const k = normName(name);
  return !!k && (candidates.some((c) => normName(c.name) === k) || added.some((a) => normName(a) === k));
};

/** "4 Oct" in IST, null when unparsable. */
const shortDate = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return null;
  return new Date(t).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' });
};

/** The chip on a candidate row: "DOCTOR · 7 OCT", "QHP · 6 OCT", "TICKED · 4 OCT" (a name
    carried from the last check-in), "ADDED" for a name typed now. */
export const sourceLabel = (c: Pick<MedicineCandidate, 'source' | 'source_date'>): string => {
  const d = shortDate(c.source_date);
  const head = c.source === 'doctor' ? 'DOCTOR' : c.source === 'qhp' ? 'QHP' : 'TICKED';
  return d ? `${head} · ${d.toUpperCase()}` : head;
};

/** "Last check-in 4 Oct" / "First check-in" for the card's sub line. */
export const lastCheckinLine = (info: MedicineCheckinInfo | null | undefined): string => {
  const d = shortDate(info?.last_checkin_at);
  return d ? `Last check-in ${d}` : 'First check-in';
};
