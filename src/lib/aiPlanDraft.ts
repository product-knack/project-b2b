/* Odds AI plan assistant (16 Oct 2026, owner: an Essentials client won in the auction with no valid
   plan gets a home alert; Create Plan offers three splits and "Generate workout plan", built from the
   client's latest QHP, medical and blood reports and from OUR exercises, editable in the same form).
   Pure rules: the edge function's draft to the Create Plan builder state, the source line, the alert
   copy. No React, no network: tested in node. The server (hub-track ai-plan-draft) already checks every
   exercise against exercises_db; this file only shapes what it returns. */
import type { PlanBodyPartInput, PlanSetInput } from './clientQueries';

export type SplitKey = 'ppl' | 'upper_lower' | 'bro';
export type SplitOption = { key: SplitKey; label: string; sections: string[]; blurb: string };

/** The three splits, in the owner's order. Sections match the server's names. */
export const SPLITS: SplitOption[] = [
  { key: 'ppl', label: 'Push / Pull / Legs', sections: ['Push', 'Pull', 'Legs'], blurb: 'Chest, shoulders and triceps; back and biceps; legs and core' },
  { key: 'upper_lower', label: 'Full Body (Upper / Lower)', sections: ['Upper Body', 'Lower Body'], blurb: 'Two sessions that cover the whole body between them' },
  { key: 'bro', label: 'Bro split', sections: ['Chest', 'Back', 'Shoulders', 'Arms', 'Legs'], blurb: 'One muscle group a session' },
];
export const splitOf = (k: string | null | undefined): SplitOption | null => SPLITS.find((s) => s.key === k) ?? null;

/* ---------- the server's answer ---------- */
export type DraftSet = { reps: number | null; duration: string | null; rest: number | null; tempo: string | null; rir: number | null; note: string | null };
/** in_db false = an exercise the AI found more effective that is not in exercises_db yet (16 Oct 2026):
    NOT IN DB in the form, added to the library when the plan is submitted. */
export type DraftExercise = { name: string; measurement: 'reps' | 'duration'; group?: string | null; in_db?: boolean; equipment?: string | null; modality?: string | null; sets: DraftSet[] };
export type DraftSection = { name: string; exercises: DraftExercise[] };
export type AiPlanDraft = {
  plan_name: string;
  description: string;
  split: SplitKey;
  split_label: string;
  sessions_per_week: number;
  sections: DraftSection[];
  rationale: string[];
  avoided: string[];
};
export type AiPlanSources = {
  qhp_date: string | null;
  blood_date: string | null;
  blood_flags: number;
  medical_items: number;
  health_context: boolean;
  sessions_last_30_days: number;
  weekly_slots: { day: string | null; time: string | null; modality: string | null }[];
  suggested_sessions_per_week: number;
};
export type AiPlanPreview = { eligible: boolean; allowed: boolean; essentials: boolean; client_name: string; sources: AiPlanSources; model: string };
export type AiPlanResult = { draft: AiPlanDraft; dropped: string[]; sources: AiPlanSources; model: string; generated_at: string };

const str = (v: unknown) => (v == null ? '' : String(v));

/** One draft set as the form's strings (load stays empty: the trainer sets kilograms in the session). */
export const draftSetToInput = (s: DraftSet, measurement: 'reps' | 'duration'): PlanSetInput => ({
  load: '',
  reps: measurement === 'reps' ? str(s.reps) : '',
  duration: measurement === 'duration' ? str(s.duration) : '',
  rest: str(s.rest),
  tempo: str(s.tempo),
  rm: '',
  rir: measurement === 'reps' ? str(s.rir) : '',
  ss: '',
  notes: str(s.note),
});

/** The draft as the builder's sections; empty sections are kept so the trainer sees the split's shape. */
export const draftToBodyParts = (d: AiPlanDraft): PlanBodyPartInput[] => {
  const out = (d.sections ?? []).map((sec) => ({
    body_part: sec.name,
    exercises: (sec.exercises ?? []).filter((e) => e && e.name).map((e) => {
      const measurement: 'reps' | 'duration' = e.measurement === 'duration' ? 'duration' : 'reps';
      const sets = (e.sets?.length ? e.sets : [{ reps: null, duration: null, rest: null, tempo: null, rir: null, note: null }]).map((s) => draftSetToInput(s, measurement));
      const notInDb = e.in_db === false
        ? { muscle_group: e.group ?? null, equipment: e.equipment ?? null, modality: e.modality || (/conditioning/i.test(sec.name) ? 'Cardio' : 'Strength') }
        : null;
      return notInDb ? { name: e.name, measurement, sets, notInDb } : { name: e.name, measurement, sets };
    }),
  }));
  return out.length ? out : [{ body_part: '', exercises: [] }];
};

export const draftExerciseCount = (d: AiPlanDraft | null | undefined) => (d?.sections ?? []).reduce((n, s) => n + (s.exercises?.length ?? 0), 0);
/** The exercises of a draft that are not in the library yet. */
export const draftNewExercises = (d: AiPlanDraft | null | undefined): string[] =>
  (d?.sections ?? []).flatMap((s) => (s.exercises ?? []).filter((e) => e.in_db === false).map((e) => e.name));

/* ---------- copy ---------- */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "16 Jul" from 'YYYY-MM-DD'. */
export const dayMonth = (ymd: string | null | undefined) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd ?? '');
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` : '';
};

/** "QHP of 16 Jul · blood report of 29 Jun (34 out of range) · health context" (what the AI will read). */
export const sourcesLine = (s: AiPlanSources | null | undefined): string => {
  if (!s) return '';
  const parts: string[] = [];
  parts.push(s.qhp_date ? `QHP of ${dayMonth(s.qhp_date)}` : 'no QHP on file');
  if (s.blood_date) parts.push(`blood report of ${dayMonth(s.blood_date)}${s.blood_flags ? ` (${s.blood_flags} out of range)` : ''}`);
  if (s.medical_items) parts.push(`${s.medical_items} medical record${s.medical_items === 1 ? '' : 's'}`);
  if (s.health_context) parts.push('health context');
  return parts.join(' · ');
};

/** The plan name and description the draft fills only when the trainer has not typed their own. */
export const shouldFill = (current: string, lastAiValue: string | null) => !current.trim() || (lastAiValue != null && current === lastAiValue);

/* ---- Build mode and the registry marker (21 Oct 2026, owner: "when a trainer creates a new plan,
   ask AI or manual; manual is the flow we have, AI offers the prompt we have in the assistant, and the
   registry stores it accordingly"). Decisions: every client the trainer may plan for, Strength Training
   only for now. The registry (public.workout_plan, hub-track) copies workout_plan_exercises.source and
   ai_prompt at approval; the app only writes them on the rows. ---- */
export type PlanSource = 'human' | 'ai';
export type PlanBuildMode = 'ai' | 'manual';
export type AiChoice = { enabled: boolean; reason: string | null };

/** The registry's ai_prompt: the split label and the trainer's note as one line. */
export const aiPromptLine = (splitLabel: string, note: string | null | undefined): string => {
  const n = (note ?? '').trim().replace(/\s+/g, ' ');
  return n ? `${splitLabel} · ${n}` : splitLabel;
};

/** Whether the "Generate with Odds AI" card can be chosen, and the reason shown when it cannot.
    `allowed` is the server's preview answer (null while it loads: the card stays open, the panel waits). */
export const aiChoice = (o: { online: boolean; clientId: string | null | undefined; modality: string | null | undefined; allowed: boolean | null | undefined }): AiChoice => {
  if (!o.clientId) return { enabled: false, reason: 'Pick the client first' };
  if (!o.online) return { enabled: false, reason: 'Needs a connection' };
  if (o.modality && o.modality !== 'Strength Training') return { enabled: false, reason: 'Strength Training plans only for now' };
  if (o.allowed === false) return { enabled: false, reason: 'Not available for this client' };
  return { enabled: true, reason: null };
};

/** The rows' source: 'ai' once a draft was applied to the builder, even when the trainer changed, added
    or deleted exercises afterwards (the draft was the base); 'human' otherwise, also when the panel was
    opened but no draft applied. */
export const planSource = (draftApplied: boolean): PlanSource => (draftApplied ? 'ai' : 'human');

/* ---------- the home alert ---------- */
export type PlanGapState = 'none' | 'in_review' | 'needs_revision';
export type EssentialsPlanGap = {
  client_id: string;
  client_name: string;
  next_session_at: string;
  next_modality: string | null;
  sessions_upcoming: number;
  plan_state: PlanGapState;
  review_plan_id: string | null;
  review_plan_name: string | null;
  review_since: string | null;
  review_by_me: boolean | null;
  last_approved_at: string | null;
};

const IST_MS = 330 * 60_000;
const istParts = (iso: string) => {
  const d = new Date(new Date(iso).getTime() + IST_MS);
  const h = d.getUTCHours(), m = d.getUTCMinutes();
  return { ymd: d.toISOString().slice(0, 10), time: `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}` };
};
/** "today 5:00 PM", "tomorrow 5:00 PM" or "Sat 18 Oct, 4:30 PM" (IST). */
export const whenLabel = (iso: string, now: number = Date.now()): string => {
  const p = istParts(iso);
  const today = new Date(now + IST_MS).toISOString().slice(0, 10);
  const tomorrow = new Date(now + IST_MS + 864e5).toISOString().slice(0, 10);
  if (p.ymd === today) return `today ${p.time}`;
  if (p.ymd === tomorrow) return `tomorrow ${p.time}`;
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${p.ymd}T00:00:00Z`).getUTCDay()];
  return `${dow} ${dayMonth(p.ymd)}, ${p.time}`;
};

const firstName = (n: string) => (n || 'Client').trim().split(/\s+/)[0];

/** Title, line and button of one alert row. */
export const gapCopy = (g: EssentialsPlanGap, now: number = Date.now()): { title: string; line: string; action: string | null; tone: 'red' | 'amber' } => {
  const who = firstName(g.client_name);
  const when = `${g.next_modality || 'Session'} ${whenLabel(g.next_session_at, now)}`;
  if (g.plan_state === 'in_review') {
    return {
      title: `${who}'s plan is waiting for approval`,
      line: `${g.review_plan_name ?? 'Plan'}${g.review_by_me === false ? ' · sent by another trainer' : ''} · Essentials ${when}`,
      action: null,
      tone: 'amber',
    };
  }
  if (g.plan_state === 'needs_revision') {
    return { title: `${who}'s plan needs changes`, line: `The coach sent ${g.review_plan_name ?? 'the plan'} back · Essentials ${when}`, action: 'Open the plan', tone: 'red' };
  }
  const expired = g.last_approved_at ? ` · last plan expired ${dayMonth(new Date(new Date(g.last_approved_at).getTime() + 42 * 864e5 + IST_MS).toISOString().slice(0, 10))}` : ' · no valid plan';
  return { title: `Make ${who}'s workout plan`, line: `Essentials ${when}${expired} · Odds AI can draft it`, action: 'Create with AI', tone: 'red' };
};
