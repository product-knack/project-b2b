/* Client medications, two sources, one dated list (5 Oct 2026, therapist client detail):
     1. QHP assessments: coach_assessment.{new_client_assessment_data | qhp_data |
        existing_client_assessment_data}."Standardized Assessment".medicalHistory
        .currentMedicines[] {name, dose} (or .currentMedications[] strings) and
        .lifestyleActivity.currentSupplements[] + currentSupplementsOther, dated by
        assessment_date. Older QHP shapes are scanned for the same keys at any depth.
     2. Doctor consultations: get_client_consult_medications rows: prescription
        medicines (name, strength, dose, frequency, timing, duration, SOS, instruction)
        and the AI summary's medications (name, reason, dosage note).
   Pure module (no app imports) so node can test it. */

export type MedicationItem = { name: string; detail: string | null; note: string | null; sos?: boolean };
export type MedicationCard = {
  id: string;
  source: 'qhp' | 'consult';
  /** YYYY-MM-DD */
  date: string;
  title: string;
  subtitle: string | null;
  items: MedicationItem[];
  supplements: string[];
  /** 'draft' | 'approved' | ... for a prescription; null otherwise */
  status: string | null;
};

const clean = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim();
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Every object at any depth that carries one of the keys. */
function findObjects(root: unknown, keys: string[], out: Record<string, unknown>[] = [], depth = 0): Record<string, unknown>[] {
  if (depth > 8 || !root || typeof root !== 'object') return out;
  if (Array.isArray(root)) { root.forEach((v) => findObjects(v, keys, out, depth + 1)); return out; }
  const o = root as Record<string, unknown>;
  if (keys.some((k) => k in o)) out.push(o);
  Object.values(o).forEach((v) => findObjects(v, keys, out, depth + 1));
  return out;
}

/** Medicines of one QHP JSON blob: structured currentMedicines first, else the plain strings. */
export function qhpMedicines(blob: unknown): MedicationItem[] {
  const items: MedicationItem[] = [];
  const seen = new Set<string>();
  const push = (name: string, detail: string | null) => {
    const key = name.toLowerCase();
    if (!name || seen.has(key)) return;
    seen.add(key);
    items.push({ name, detail: detail || null, note: null });
  };
  for (const o of findObjects(blob, ['currentMedicines', 'currentMedications'])) {
    const structured = Array.isArray(o.currentMedicines) ? (o.currentMedicines as unknown[]) : [];
    structured.forEach((m) => {
      if (isObj(m)) push(clean(m.name), clean(m.dose) || null);
      else if (typeof m === 'string') push(clean(m), null);
    });
    if (!structured.length && Array.isArray(o.currentMedications)) {
      (o.currentMedications as unknown[]).forEach((m) => { if (typeof m === 'string') push(clean(m), null); });
    }
    const other = clean(o.currentMedicationsOther);
    if (other) push(other, null);
  }
  return items.filter((i) => i.name && !/^(none|no|nil|n\/a|-)$/i.test(i.name));
}

/** Supplements of one QHP JSON blob (lifestyleActivity.currentSupplements + the "Other" text). */
export function qhpSupplements(blob: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (s: string) => { const v = clean(s); const k = v.toLowerCase(); if (v && !seen.has(k) && k !== 'other' && k !== 'none') { seen.add(k); out.push(v); } };
  for (const o of findObjects(blob, ['currentSupplements'])) {
    if (Array.isArray(o.currentSupplements)) (o.currentSupplements as unknown[]).forEach((s) => { if (typeof s === 'string') s.split(',').forEach(push); });
    const other = clean(o.currentSupplementsOther);
    if (other) push(other);
  }
  return out;
}

export type QhpRow = { id: string; assessment_date: string | null; created_at?: string | null; qhp_data?: unknown; new_client_assessment_data?: unknown; existing_client_assessment_data?: unknown };

/** One card per QHP assessment that recorded a medicine or a supplement. */
export function qhpMedicationCards(rows: QhpRow[]): MedicationCard[] {
  return rows.flatMap((r) => {
    const blobs = [r.new_client_assessment_data, r.qhp_data, r.existing_client_assessment_data].filter(Boolean);
    const items: MedicationItem[] = [];
    const supplements: string[] = [];
    const seen = new Set<string>();
    blobs.forEach((b) => {
      qhpMedicines(b).forEach((i) => { const k = i.name.toLowerCase(); if (!seen.has(k)) { seen.add(k); items.push(i); } });
      qhpSupplements(b).forEach((s) => { const k = `s:${s.toLowerCase()}`; if (!seen.has(k)) { seen.add(k); supplements.push(s); } });
    });
    if (!items.length && !supplements.length) return [];
    const date = (r.assessment_date || (r.created_at ?? '')).slice(0, 10);
    return [{ id: `qhp-${r.id}`, source: 'qhp' as const, date, title: 'QHP assessment', subtitle: null, items, supplements, status: null }];
  });
}

export type ConsultMedRow = {
  id: string; consultation_date: string | null; start_time: string | null; status: string | null; doctor_name: string | null;
  prescription_status: string | null; prescription_date: string | null; medicines: unknown; ai_medications: unknown; ai_medication_points: unknown;
};

const FREQ: Record<string, string> = { OD: 'once a day', BD: 'twice a day', TDS: 'three times a day', QID: 'four times a day', HS: 'at bedtime', SOS: 'when needed' };

/** "120mg · 1 tab twice a day · After food · 5 days" from a prescription medicine line. */
export function rxDetail(m: Record<string, unknown>): string {
  const parts: string[] = [];
  const strength = clean(m.strength); if (strength) parts.push(strength);
  const dose = clean(m.dose_amount); const freq = clean(m.frequency);
  if (dose || freq) parts.push([dose ? `${dose} dose` : '', freq ? (FREQ[freq.toUpperCase()] ?? freq) : ''].filter(Boolean).join(' '));
  const timing = clean(m.timing); if (timing) parts.push(timing);
  const dv = m.duration_value, du = clean(m.duration_unit);
  if (dv != null && dv !== '' && Number(dv) > 0) parts.push(`${dv} ${du || 'days'}`);
  return parts.join(' · ');
}

/** One card per consultation: the prescription's medicines first, then the AI "medications discussed". */
export function consultMedicationCards(rows: ConsultMedRow[]): MedicationCard[] {
  return rows.flatMap((r) => {
    const items: MedicationItem[] = [];
    const seen = new Set<string>();
    const meds = Array.isArray(r.medicines) ? (r.medicines as unknown[]) : [];
    meds.forEach((m) => {
      if (!isObj(m)) return;
      const name = clean(m.name); if (!name) return;
      seen.add(name.toLowerCase());
      items.push({ name, detail: rxDetail(m) || null, note: clean(m.instruction) || null, sos: m.is_sos === true });
    });
    const ai = Array.isArray(r.ai_medications) ? (r.ai_medications as unknown[]) : [];
    ai.forEach((m) => {
      if (!isObj(m)) return;
      const name = clean(m.name); if (!name || seen.has(name.toLowerCase())) return;
      seen.add(name.toLowerCase());
      const dosage = clean(m.dosage_note);
      items.push({ name, detail: dosage && !/per doctor/i.test(dosage) ? dosage : null, note: clean(m.reason) || null });
    });
    if (!items.length) {
      const points = Array.isArray(r.ai_medication_points) ? (r.ai_medication_points as unknown[]) : [];
      points.forEach((p) => { const t = clean(p); if (t) items.push({ name: t, detail: null, note: null }); });
    }
    if (!items.length) return [];
    const date = (r.consultation_date || (r.prescription_date ?? '')).slice(0, 10);
    const hasRx = meds.length > 0;
    return [{
      id: `consult-${r.id}`,
      source: 'consult' as const,
      date,
      title: hasRx ? 'Doctor prescription' : 'Doctor consultation',
      subtitle: r.doctor_name ? `Dr ${r.doctor_name.replace(/^dr\.?\s*/i, '')}` : null,
      items,
      supplements: [],
      status: hasRx ? (r.prescription_status || null) : null,
    }];
  });
}

/** Newest first; QHP and consultation cards interleaved by date. */
export const sortMedicationCards = (cards: MedicationCard[]): MedicationCard[] =>
  [...cards].sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.source.localeCompare(b.source));

/** "5 Mar 2026" from YYYY-MM-DD. */
export const medDate = (ymd: string): string => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd || 'Undated';
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
};
