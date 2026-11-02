# iOS handoff: Create Plan asks "Generate with Odds AI" or "Build it manually" (Android since 21 Oct 2026)

On Android a new plan no longer opens straight on the form. Create Plan first asks how to build it: **Generate with
Odds AI** or **Build it manually**, for every client the trainer may plan for (until 21 Oct the Odds AI assistant
showed only for Essentials clients). Odds AI drafts Strength Training plans only, for now. A plan whose builder was
filled from an AI draft is saved with `source = 'ai'` and `ai_prompt` (the split and the trainer's note) on its
`workout_plan_exercises` rows, and the server's plan registry `public.workout_plan` copies both at approval as
`creator` and `ai_prompt`. Edit Plan is unchanged and never asks.

- Android commit a2e9778 (21 Oct 2026): `src/lib/aiPlanDraft.ts`, `src/components/AiPlanAssistant.tsx`,
  `src/lib/clientQueries.ts`, `src/screens/createPlan.tsx`, `tests/rules/ai_plan_rules_test.js`. The code below is
  the current Android HEAD (2 Nov 2026), so it already includes the later 27 Oct `planPrefillModality` change.
- Builds on `ios-8-to-16oct-handoff.md` section **C3** (16 Oct 2026: the assistant panel, `aiPlanQueries.ts`, the
  preview and draft calls, the home alert, NOT IN DB exercises, `aiPlanDraft.ts` first version). This file covers
  only what a2e9778 added. Port C3 first if iOS does not have it.
- Server: all live, nothing to run. Edge function `ai-plan-draft` redeployed 21 Oct 2026 without the Essentials-only
  refusal; hub-track migrations `20261021150000_workout_plan_registry.sql` and
  `20261021170000_edit_workout_plan_keeps_source.sql` run live 21 Oct 2026.
- Feature doc: `b2b/docs/features/android/trainer/ai-plan-assistant.md`. Backend note:
  `odds-app/docs/workout-plan-source-handoff.md`.

Why now: since the 21 Oct redeploy the preview answers `eligible: true` for every client the caller may plan for. An
iOS build made from C3 (`aiEligible = eligible === true` plus the effect that preselects Strength Training) therefore
already shows the assistant to every such client, with the old "Essentials client ·" subtitle, and saves every AI
plan as `source = 'human'` (the column default), so the registry cannot tell AI plans from hand-built ones.

## 1. What the user sees (Android)

### 1.1 The build mode screen (new plans only)
Shown whenever Create Plan opens for a new plan (Plan tab, the home alert's "Create with AI", My Crew's Create plan
button). Never in Edit Plan.
- Back link "Back". It leaves at once, with no unsaved-changes prompt (nothing typed yet).
- File icon chip, title "Create Plan", subtitle "How do you want to build Preeti's plan?" (the client's first name;
  "the client" when the name is empty).
- Violet card: sparkle tile, **Generate with Odds AI**, "Drafts a Strength Training plan from the QHP, medical and
  blood reports. You edit everything before it goes for review.", chevron. When it cannot be chosen it is dimmed
  (opacity 0.6, fainter border, not tappable) and a gold line under it gives the reason:
  - "Pick the client first"
  - "Needs a connection" (offline)
  - "Strength Training plans only for now" (the form already holds another modality, e.g. Yoga prefilled by My
    Crew's Create plan button)
  - "Not available for this client" (the preview says the caller may not plan for this client)
  While the preview is still loading the card is live and has no reason line.
- Orange card: dumbbell tile, **Build it manually**, "The plan builder as it is today: modality, sections, exercises
  and sets.", chevron. Always live.
- Footer, small, centred: "Either way the plan goes to the CRM for review before it reaches the client."
- Choosing Odds AI preselects Strength Training when no modality is picked yet.

### 1.2 The form header line (new plans only)
Under "Goes to the CRM for review before it reaches the client":
- AI mode: violet "Odds AI plan" ("Odds AI plan, drafted" once a draft was applied), then the underlined grey link
  "Switch to manual".
- Manual mode: orange "Manual plan", then the link "Try Odds AI". When Odds AI cannot be chosen the link reads
  "Odds AI: " plus the reason (e.g. "Odds AI: Strength Training plans only for now") and does nothing.
- Switching never clears the form.

### 1.3 The AI mode panel (above Plan details)
- Preview loading: violet box with a spinner, "Checking what Odds AI can read for Preeti…".
- Preview allowed: the Odds AI plan assistant from C3. One copy change: its subtitle is "Essentials client · Drafts
  Preeti's Strength Training plan from the QHP, medical and blood reports" for an Essentials client and "Drafts
  Preeti's Strength Training plan from the QHP, medical and blood reports" for everyone else.
- Preview not allowed: gold box "Odds AI is not available for this client (you can only plan for your own or your
  booked clients). Build the plan manually below."
- Preview failed: gold box "Odds AI could not be reached. Build the plan manually below, or try again when the
  connection is back."
- Manual mode shows none of these.

### 1.4 What gets saved
- An applied draft makes it an AI plan: `source = 'ai'`, `ai_prompt` = "Push / Pull / Legs · no machines at home,
  wants to focus on posture" (the split label alone when the note was empty). Changing, adding or deleting
  exercises afterwards, or switching the header to manual, keeps it an AI plan with the same prompt.
- AI mode opened but no draft applied, or built manually: `source` stays the default `'human'`, `ai_prompt` null.
- Edit Plan (Save & Resubmit) keeps whatever the plan had; the server does that (2.3).

## 2. Data / server contract

### 2.1 Edge function `ai-plan-draft` (hub-track `supabase/functions/ai-plan-draft/index.ts`, redeployed 21 Oct 2026)
Request and response shapes are unchanged from C3. What changed:
- Who may use it: `profiles.role` admin, super_admin or coach; a trainer linked to the client in `trainer_clients`;
  or a trainer with a not-cancelled `session_schedule` row with the client from today (IST) on. Any client,
  Essentials or not.
- Preview `{ client_id, preview: true }`: `eligible` now equals `allowed`; `essentials` is information only (the app
  uses it for the subtitle). The app reads `allowed`.
- Draft: the only access refusal left is 403 "You can only plan for your own or your booked clients."; the
  Essentials refusal ("The AI plan assistant is for Essentials by Odds clients.") is gone.
- Sessions a week (the app still sends none): the client's weekly slot count, else the package
  (`sessions_per_cycle` over the cycle's weeks), else 3, clamped 2 to 6.
- The draft is always a Strength Training plan (exercise pool Strength + Cardio). "Strength Training only" is
  enforced by the app (`aiChoice`).

### 2.2 The marker on the plan rows (`20261021150000_workout_plan_registry.sql`, live 21 Oct 2026)
```sql
ALTER TABLE public.workout_plan_exercises
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'human';
ALTER TABLE public.workout_plan_exercises
  DROP CONSTRAINT IF EXISTS workout_plan_exercises_source_check;
ALTER TABLE public.workout_plan_exercises
  ADD CONSTRAINT workout_plan_exercises_source_check CHECK (source IN ('human', 'ai'));
-- The trainer's prompt to the Odds AI assistant (split + note), set by the app with source = 'ai'.
ALTER TABLE public.workout_plan_exercises
  ADD COLUMN IF NOT EXISTS ai_prompt text;
```
- The app writes both columns on every row the Create Plan insert writes (same values on all rows of the plan), and
  only for AI plans; hand-built plans omit both and get the defaults.
- The app never reads or writes `public.workout_plan`. A statement-level trigger on `workout_plan_exercises` (insert
  and update, `workout_plan_register`) upserts one registry row per plan when its rows are `approved`:
  `creator = COALESCE(source, 'human')`, `ai_prompt = NULLIF(btrim(ai_prompt), '')`, the description, the client's
  subscription type, `validity_days` 42 and `expires_at = approved_at + 42 days`. A daily cron (00:05 IST) flips it
  to `inactive` after expiry. Readable by staff roles, the plan's trainer, the approver and trainers assigned to the
  client.
- No new policy for the app: the two columns ride on the existing insert policies of `workout_plan_exercises`.

### 2.3 Edit Plan keeps the marker (`20261021170000_edit_workout_plan_keeps_source.sql`, live 21 Oct 2026)
`edit_workout_plan(_plan_id uuid, _plan_name text, _plan_description text, _duration_weeks integer, _exercises jsonb)`
(same name, arguments and checks as before) now reads the caller's `source` and `ai_prompt` before it deletes and
re-inserts the caller's rows, and writes them back:
```sql
  SELECT client_id, modality, status, approved_at, source, ai_prompt
    INTO v_client, v_modality, v_status, v_approved_at, v_source, v_ai_prompt
    FROM workout_plan_exercises
   WHERE plan_id = _plan_id AND trainer_id = uid
   ORDER BY (source = 'ai') DESC, order_index
   LIMIT 1;
```
and the re-inserted rows end with `COALESCE(v_source, 'human'), v_ai_prompt` for the `source, ai_prompt` columns.
So nothing changes in the iOS Edit Plan path: do not add `source` or `ai_prompt` to the edit payload.

### 2.4 Caches, offline, analytics
- `['ai-plan-preview', clientId]` as in C3 (5 min stale, not persisted, fetched only online and not in edit mode).
  The hook is called above the build mode screen, so the answer usually arrives before the trainer taps.
- Offline: the outbox item `create-plan` stores the whole `WorkoutPlanCreateInput` and its drain calls
  `submitWorkoutPlan(p)`, so `source` and `aiPrompt` replay with no extra code. A draft needs a connection; a draft
  applied online and submitted offline is still saved as an AI plan.
- New Amplitude event `Plan Build Mode Chosen` `{ client_id, mode }` (`mode` is `'ai'` or `'manual'`).

## 3. Code to port
Order: 3.1 to 3.5, then the checks in 3.7.

### 3.1 `src/lib/aiPlanDraft.ts` (pure: copy byte for byte, whole file, 189 lines)
New since C3: the block "Build mode and the registry marker" (types `PlanSource`, `PlanBuildMode`, `AiChoice`;
`aiPromptLine`, `aiChoice`, `planSource`). The rest is the 16 Oct file. Its only import is type-only.
```ts
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
```

### 3.2 `tests/rules/ai_plan_rules_test.js` (whole file, 89 lines, 43 checks: the 31 of C3 plus 12)
Line 87 of the Android file has the literal em dash character (U+2014) between the quotes of `s.includes('...')`.
This document carries no dash characters, so that line is written below with the escape `'\u2014'`. Both are the
same one-character JavaScript string and the check behaves identically; type the character instead if you want the
two files identical byte for byte.
```js
// Rule test for the Odds staff app. ROOT = the repo root; point it at the iOS repo and run: node tests/rules/ai_plan_rules_test.js
const ROOT = require("path").resolve(__dirname, "../..");
// node test of src/lib/aiPlanDraft.ts: splits, draft -> builder state, source line, alert copy.
const ts = require(ROOT + '/node_modules/typescript');
const fs = require('fs');
const src = fs.readFileSync(ROOT + '/src/lib/aiPlanDraft.ts', 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const m = { exports: {} };
new Function('module', 'exports', 'require', js)(m, m.exports, (n) => { throw new Error('unexpected require ' + n); });
const A = m.exports;
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };

eq('three splits in the owner order', A.SPLITS.map((s) => s.key), ['ppl', 'upper_lower', 'bro']);
eq('ppl sections', A.splitOf('ppl').sections, ['Push', 'Pull', 'Legs']);
eq('upper/lower label and sections', [A.splitOf('upper_lower').label, A.splitOf('upper_lower').sections], ['Full Body (Upper / Lower)', ['Upper Body', 'Lower Body']]);
eq('bro sections', A.splitOf('bro').sections, ['Chest', 'Back', 'Shoulders', 'Arms', 'Legs']);
eq('unknown split', A.splitOf('x'), null);

const draft = {
  plan_name: 'Preeti · Push / Pull / Legs · Oct 2026', description: 'Low-impact plan.', split: 'ppl', split_label: 'Push / Pull / Legs', sessions_per_week: 2,
  sections: [
    { name: 'Push', exercises: [
      { name: 'Arm Circles', measurement: 'reps', sets: [{ reps: 12, duration: null, rest: 45, tempo: null, rir: 0, note: 'Easy' }, { reps: 12, duration: null, rest: 45, tempo: null, rir: 0, note: null }] },
      { name: 'Chest Press Machine', measurement: 'reps', sets: [{ reps: 12, duration: null, rest: 60, tempo: '3-1-1-0', rir: 3, note: null }] },
    ] },
    { name: 'Pull', exercises: [] },
    { name: 'Conditioning', exercises: [{ name: 'Elliptical Training', measurement: 'duration', sets: [{ reps: 99, duration: '5 min', rest: 60, tempo: null, rir: 2, note: null }] }] },
  ],
  rationale: ['QHP 16 Jul: knee pain'], avoided: ['Barbell Squats'],
};
const bp = A.draftToBodyParts(draft);
eq('sections kept in order, empty ones too', bp.map((b) => [b.body_part, b.exercises.length]), [['Push', 2], ['Pull', 0], ['Conditioning', 1]]);
eq('reps set as form strings, load empty', bp[0].exercises[1].sets[0], { load: '', reps: '12', duration: '', rest: '60', tempo: '3-1-1-0', rm: '', rir: '3', ss: '', notes: '' });
eq('note goes to notes', bp[0].exercises[0].sets[0].notes, 'Easy');
eq('duration exercise: duration kept, reps and rir blank', bp[2].exercises[0].sets[0], { load: '', reps: '', duration: '5 min', rest: '60', tempo: '', rm: '', rir: '', ss: '', notes: '' });
eq('measurement carried', bp[2].exercises[0].measurement, 'duration');
eq('exercise with no sets gets one empty set', A.draftToBodyParts({ ...draft, sections: [{ name: 'Legs', exercises: [{ name: 'Leg Curl', measurement: 'reps', sets: [] }] }] })[0].exercises[0].sets.length, 1);
eq('empty draft keeps one blank section', A.draftToBodyParts({ ...draft, sections: [] }), [{ body_part: '', exercises: [] }]);
eq('exercise count', A.draftExerciseCount(draft), 3);

eq('source line full', A.sourcesLine({ qhp_date: '2026-07-16', blood_date: '2026-06-29', blood_flags: 34, medical_items: 2, health_context: true }), 'QHP of 16 Jul · blood report of 29 Jun (34 out of range) · 2 medical records · health context');
eq('source line no QHP', A.sourcesLine({ qhp_date: null, blood_date: null, blood_flags: 0, medical_items: 0, health_context: false }), 'no QHP on file');
eq('shouldFill empty', A.shouldFill('  ', null), true);
eq('shouldFill own text', A.shouldFill('My plan', 'AI name'), false);
eq('shouldFill previous AI text', A.shouldFill('AI name', 'AI name'), true);

const NOW = Date.parse('2026-10-16T09:00:00Z'); // 2:30 PM IST, 16 Oct
eq('when today', A.whenLabel('2026-10-16T11:30:00Z', NOW), 'today 5:00 PM');
eq('when tomorrow', A.whenLabel('2026-10-17T11:30:00Z', NOW), 'tomorrow 5:00 PM');
eq('when later', A.whenLabel('2026-10-18T11:00:00Z', NOW), 'Sun 18 Oct, 4:30 PM');
const gap = { client_id: 'c', client_name: 'Preeti Ch.', next_session_at: '2026-10-17T11:30:00Z', next_modality: 'Strength', sessions_upcoming: 1, plan_state: 'none', review_plan_id: null, review_plan_name: null, review_since: null, review_by_me: null, last_approved_at: null };
eq('alert none', A.gapCopy(gap, NOW), { title: "Make Preeti's workout plan", line: 'Essentials Strength tomorrow 5:00 PM · no valid plan · Odds AI can draft it', action: 'Create with AI', tone: 'red' });
eq('alert expired plan', A.gapCopy({ ...gap, last_approved_at: '2026-08-20T06:00:00Z' }, NOW).line, 'Essentials Strength tomorrow 5:00 PM · last plan expired 1 Oct · Odds AI can draft it');
eq('alert in review by me', A.gapCopy({ ...gap, plan_state: 'in_review', review_plan_name: 'Preeti · PPL', review_by_me: true }, NOW), { title: "Preeti's plan is waiting for approval", line: 'Preeti · PPL · Essentials Strength tomorrow 5:00 PM', action: null, tone: 'amber' });
eq('alert in review by another trainer', A.gapCopy({ ...gap, plan_state: 'in_review', review_plan_name: 'X', review_by_me: false }, NOW).line, 'X · sent by another trainer · Essentials Strength tomorrow 5:00 PM');
eq('alert needs changes', A.gapCopy({ ...gap, plan_state: 'needs_revision', review_plan_name: 'X' }, NOW), { title: "Preeti's plan needs changes", line: 'The coach sent X back · Essentials Strength tomorrow 5:00 PM', action: 'Open the plan', tone: 'red' });


/* NOT IN DB exercises (16 Oct 2026) */
const draft2 = { ...draft, sections: [
  { name: 'Push', exercises: [
    { name: 'Pallof Press', measurement: 'reps', group: 'Core', in_db: false, equipment: 'Cable', modality: 'Strength', sets: [{ reps: 12, duration: null, rest: 60, tempo: null, rir: 2, note: null }] },
    { name: 'Chest Press Machine', measurement: 'reps', group: 'Chest', in_db: true, sets: [{ reps: 10, duration: null, rest: 90, tempo: null, rir: 2, note: null }] },
  ] },
  { name: 'Conditioning', exercises: [{ name: 'Sled Push', measurement: 'duration', group: 'Full Body', in_db: false, equipment: 'Sled', sets: [{ reps: null, duration: '30 sec', rest: 60, tempo: null, rir: null, note: null }] }] },
] };
const bp2 = A.draftToBodyParts(draft2);
eq('new exercise carries notInDb', bp2[0].exercises[0].notInDb, { muscle_group: 'Core', equipment: 'Cable', modality: 'Strength' });
eq('library exercise has no notInDb key', 'notInDb' in bp2[0].exercises[1], false);
eq('conditioning new exercise defaults to Cardio', bp2[1].exercises[0].notInDb.modality, 'Cardio');
eq('draftNewExercises', A.draftNewExercises(draft2), ['Pallof Press', 'Sled Push']);
eq('draftNewExercises none', A.draftNewExercises(draft), []);

// Build mode and the registry marker (21 Oct 2026)
eq('ai prompt line: split and note, whitespace squeezed', A.aiPromptLine('Push / Pull / Legs', '  no machines at home,  wants to focus on posture '), 'Push / Pull / Legs · no machines at home, wants to focus on posture');
eq('ai prompt line: split only', A.aiPromptLine('Bro split', ''), 'Bro split');
eq('ai prompt line: null note', A.aiPromptLine('Full Body (Upper / Lower)', null), 'Full Body (Upper / Lower)');
eq('ai choice: needs a client', A.aiChoice({ online: true, clientId: null, modality: null, allowed: null }), { enabled: false, reason: 'Pick the client first' });
eq('ai choice: offline', A.aiChoice({ online: false, clientId: 'c', modality: null, allowed: true }), { enabled: false, reason: 'Needs a connection' });
eq('ai choice: yoga stays manual', A.aiChoice({ online: true, clientId: 'c', modality: 'Yoga', allowed: true }), { enabled: false, reason: 'Strength Training plans only for now' });
eq('ai choice: refused by the server', A.aiChoice({ online: true, clientId: 'c', modality: null, allowed: false }), { enabled: false, reason: 'Not available for this client' });
eq('ai choice: open while the preview loads', A.aiChoice({ online: true, clientId: 'c', modality: null, allowed: null }), { enabled: true, reason: null });
eq('ai choice: ok', A.aiChoice({ online: true, clientId: 'c', modality: 'Strength Training', allowed: true }), { enabled: true, reason: null });
eq('source: a draft applied then edited is still ai', A.planSource(true), 'ai');
eq('source: hand built', A.planSource(false), 'human');
eq('no dashes in the choice copy', ['Pick the client first', 'Needs a connection', 'Strength Training plans only for now', 'Not available for this client'].some((s) => s.includes('\u2014')), false);
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
```

### 3.3 `src/components/AiPlanAssistant.tsx`, `AiPlanAssistant`
Four edits; everything else in the panel stays as C3 built it.

Import, before:
```ts
import { SPLITS, sourcesLine, draftExerciseCount, draftNewExercises, type AiPlanPreview, type AiPlanResult, type SplitKey } from '../lib/aiPlanDraft';
```
After:
```ts
import { SPLITS, splitOf, aiPromptLine, sourcesLine, draftExerciseCount, draftNewExercises, type AiPlanPreview, type AiPlanResult, type SplitKey } from '../lib/aiPlanDraft';
```

The `onApply` prop, before:
```ts
  /** Drop the draft into the builder (the parent asks before replacing exercises already in the form). */
  onApply: (r: AiPlanResult) => void;
```
After:
```ts
  /** Drop the draft into the builder (the parent asks before replacing exercises already in the form).
      `prompt` is the registry's ai_prompt for this draft: the split label and the note as one line. */
  onApply: (r: AiPlanResult, prompt: string) => void;
```

`generate`, after (only the `onApply(...)` line changed; it was `onApply(r);`):
```ts
  const generate = async () => {
    if (!split || draftM.isPending) return;
    trackEvent('AI Plan Generate Tapped', { client_id: clientId, split, has_note: !!note.trim() });
    try {
      // Sessions a week: the server takes the client's weekly slot count (owner, 16 Oct 2026: no picker).
      const r = await draftM.mutateAsync({ clientId, split, note });
      setResult(r);
      trackEvent('AI Plan Generated', { client_id: clientId, split, model: r.model, exercises: draftExerciseCount(r.draft), not_in_db: draftNewExercises(r.draft).length, dropped: r.dropped.length });
      onApply(r, aiPromptLine(r.draft.split_label || splitOf(split)?.label || split, note));
    } catch (e: any) {
      trackEvent('AI Plan Generate Failed', { client_id: clientId, split, error: String(e?.message ?? e).slice(0, 120) });
    }
  };
```
`note` is the panel's raw note state; `aiPromptLine` trims it and squeezes the spaces. The split label is the
server's `draft.split_label`, else the local label, else the key.

The subtitle under "Odds AI plan assistant", before:
```tsx
          <Body style={{ fontSize: 11, color: C.muted2, marginTop: 2, lineHeight: 15 }}>Essentials client · drafts {clientName.split(' ')[0]}'s plan from the QHP, medical and blood reports</Body>
```
After:
```tsx
          <Body style={{ fontSize: 11, color: C.muted2, marginTop: 2, lineHeight: 15 }}>{preview.essentials ? 'Essentials client · ' : ''}Drafts {clientName.split(' ')[0]}'s Strength Training plan from the QHP, medical and blood reports</Body>
```

### 3.4 `src/lib/clientQueries.ts`
`WorkoutPlanCreateInput` gains `source` and `aiPrompt` (after `planId`):
```ts
export type WorkoutPlanCreateInput = {
  trainerId: string;
  clientId: string;
  planName: string;
  planDescription: string;
  durationWeeks: number;
  modality: string; // 'Strength Training' | 'Boxing' | 'Yoga' (stored verbatim, like the web form)
  bodyParts: PlanBodyPartInput[];
  yoga: PlanYogaInput[];
  boxing: { selected: PlanBoxingSelection[]; custom: PlanBoxingCustom[]; padwork: boolean };
  /** Offline sync: pre-generated plan id so retries can never duplicate the plan. */
  planId?: string;
  /** Registry marker (21 Oct 2026): 'ai' when the builder was filled from an Odds AI draft (even if edited
      afterwards), with the split label and note as `aiPrompt`; absent / 'human' for hand-built plans. */
  source?: 'human' | 'ai';
  aiPrompt?: string | null;
};
```
`submitWorkoutPlan`: the destructuring takes the two fields and `meta` (spread into every inserted row) carries them
for AI plans only. Before, the destructuring ended `... yoga, boxing } = input;` and `meta` ended at `modality,`.
After (top of the function down to the end of `meta`; the rest of the function is unchanged):
```ts
export async function submitWorkoutPlan(input: WorkoutPlanCreateInput) {
      const { trainerId, clientId, planName, planDescription, durationWeeks, modality, bodyParts, yoga, boxing, source, aiPrompt } = input;
      if (!clientId) throw new Error('Select a client first');
      if (!planName.trim()) throw new Error('Enter a plan name');
      if (!modality) throw new Error('Select a modality');

      const planId = input.planId ?? uuidv4();

      // Idempotency guard: a retried sync after a lost response must not re-insert.
      const { data: existingPlan, error: exErr } = await supabase
        .from('workout_plan_exercises')
        .select('id')
        .eq('plan_id', planId)
        .limit(1);
      if (exErr) throw new Error(exErr.message);
      if ((existingPlan?.length ?? 0) > 0) return { planId, count: 0 };
      const meta = {
        plan_id: planId,
        client_id: clientId,
        trainer_id: trainerId,
        plan_name: planName.trim(),
        plan_description: planDescription.trim() || null,
        plan_duration_weeks: durationWeeks,
        modality,
        // workout_plan_exercises.source / ai_prompt (hub-track migration 20261021150000): the registry
        // copies them into public.workout_plan at approval. Hand-built plans keep the column defaults.
        ...(source === 'ai' ? { source: 'ai', ai_prompt: (aiPrompt ?? '').trim() || null } : {}),
      };
```

### 3.5 `src/screens/createPlan.tsx`, `CreatePlan`

3.5.1 Imports, after (`ActivityIndicator` added to the react-native line; `aiChoice`, `planSource`, `PlanBuildMode`
added to the aiPlanDraft line):
```ts
import { View, Text, Pressable, ScrollView, Modal, TextInput, Keyboard, Platform, Alert, Animated, ActivityIndicator } from 'react-native';
```
```ts
import { draftToBodyParts, shouldFill, draftExerciseCount, aiChoice, planSource, type AiPlanResult, type PlanBuildMode } from '../lib/aiPlanDraft';
```

3.5.2 The AI state block. Before (C3), right after the modality-switch comment:
```ts
  /* ---- Odds AI plan assistant (16 Oct 2026): Essentials clients only, new plans only ----
     The server decides eligibility (Essentials client + a caller who may plan for them). The draft
     fills the Strength Training builder; the name and description only when the trainer has not
     typed their own (or still holds the previous AI text). */
  const aiPreviewQ = useAiPlanPreview(selectedClientId, !isEdit && isOnline);
  const aiEligible = !isEdit && aiPreviewQ.data?.eligible === true;
  const lastAi = React.useRef<{ name: string; desc: string } | null>(null);
  React.useEffect(() => {
    // An Essentials client's plan is a Strength Training plan (it covers the Strength and Cardio days).
    if (aiEligible && !modality) setModality('Strength Training');
  }, [aiEligible]); // eslint-disable-line react-hooks/exhaustive-deps
  const applyAiDraft = (r: AiPlanResult) => {
    const doApply = () => {
      setOpenSet(null);
      setPickerFor(null); setSelPick({}); setExSearch('');
      setModality('Strength Training');
      setBodyParts(draftToBodyParts(r.draft));
      if (shouldFill(planName, lastAi.current?.name ?? null)) setPlanName(r.draft.plan_name);
      if (shouldFill(desc, lastAi.current?.desc ?? null)) setDesc(r.draft.description);
      lastAi.current = { name: r.draft.plan_name, desc: r.draft.description };
      trackEvent('AI Plan Draft Applied', { client_id: selectedClientId, split: r.draft.split, exercises: draftExerciseCount(r.draft) });
    };
```
After (replaces it whole: no `aiEligible`, no effect; `mode`, `aiPick`, `chooseMode`, `aiApplied`, and the prompt
kept in `lastAi`). The `Alert` part of `applyAiDraft` is unchanged from C3 and shown for placement:
```ts
  /* ---- Odds AI plan assistant (16 Oct 2026; every client since 21 Oct 2026), new plans only ----
     The server decides who may plan for the client. The draft fills the Strength Training builder; the
     name and description only when the trainer has not typed their own (or still holds the previous AI
     text). Build mode (21 Oct 2026, owner): a new plan starts with a choice, Generate with Odds AI or
     Build it manually; Edit Plan never asks. The rows carry source 'ai' and the prompt once a draft was
     applied, even if edited afterwards (the registry copies them at approval). */
  const aiPreviewQ = useAiPlanPreview(selectedClientId, !isEdit && isOnline);
  const aiAllowed = !isEdit && aiPreviewQ.data?.allowed === true;
  const [mode, setMode] = React.useState<PlanBuildMode | null>(isEdit ? 'manual' : null);
  const aiPick = aiChoice({ online: isOnline, clientId: selectedClientId, modality, allowed: isEdit ? false : aiPreviewQ.data ? aiPreviewQ.data.allowed : null });
  const chooseMode = (m: PlanBuildMode) => {
    setMode(m);
    // An AI draft is a Strength Training plan (it covers the Strength and Cardio days).
    if (m === 'ai' && !modality) setModality('Strength Training');
    trackEvent('Plan Build Mode Chosen', { client_id: selectedClientId, mode: m });
  };
  const lastAi = React.useRef<{ name: string; desc: string; prompt: string } | null>(null);
  const [aiApplied, setAiApplied] = React.useState(false);
  const applyAiDraft = (r: AiPlanResult, prompt: string) => {
    const doApply = () => {
      setOpenSet(null);
      setPickerFor(null); setSelPick({}); setExSearch('');
      setModality('Strength Training');
      setBodyParts(draftToBodyParts(r.draft));
      if (shouldFill(planName, lastAi.current?.name ?? null)) setPlanName(r.draft.plan_name);
      if (shouldFill(desc, lastAi.current?.desc ?? null)) setDesc(r.draft.description);
      lastAi.current = { name: r.draft.plan_name, desc: r.draft.description, prompt };
      setAiApplied(true);
      trackEvent('AI Plan Draft Applied', { client_id: selectedClientId, split: r.draft.split, exercises: draftExerciseCount(r.draft) });
    };
    if (hasContent) {
      Alert.alert(
        'Replace the exercises?',
        `The Odds AI draft replaces the ${contentCount} ${modality === 'Boxing' || modality === 'Yoga' ? 'activities' : 'exercises'} already in this form.`,
        [
          { text: 'Keep mine', style: 'cancel' },
          { text: 'Replace with the draft', style: 'destructive', onPress: doApply },
        ],
      );
      return;
    }
    doApply();
  };
```

3.5.3 The create payload in `submit` (the new-plan branch, not the `if (editing)` branch): two lines after
`planId: uuidv4(),`:
```ts
      planId: uuidv4(),
      // Registry marker: an applied Odds AI draft makes this an AI plan, whatever was edited after.
      source: planSource(!!lastAi.current),
      aiPrompt: lastAi.current?.prompt ?? null,
    };
```
`planSource(!!lastAi.current)`: the ref is set only by an applied draft, so a panel opened without applying stays
`'human'`.

3.5.4 The build mode screen: a second early return, placed after the "No client selected" return and the `advKey`
line, i.e. below every hook of `CreatePlan` (an early return above a hook breaks the hook order):
```tsx
  const advKey = (bpi: number, exi: number, si: number) => `${bpi}-${exi}-${si}`;

  // Build mode choice (21 Oct 2026): a new plan starts here; the form shows once the trainer picks.
  if (!isEdit && mode === null) {
    const first = clientName.split(' ')[0] || 'the client';
    return (
      <View style={{ flex: 1 }}>
        <Page gap={14} pt={6} pb={40 + insets.bottom}>
          <BackLink label="Back" onPress={goBack} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 13 }}>
            <IconChip icon="file" color={C.orange} />
            <View style={{ flex: 1 }}>
              <Serif style={{ fontSize: 24 }}>Create Plan</Serif>
              <Body style={{ fontSize: 12.5, color: C.muted, marginTop: 1 }}>How do you want to build {first}'s plan?</Body>
            </View>
          </View>
          <Pressable onPress={() => chooseMode('ai')} disabled={!aiPick.enabled} hitSlop={6} accessibilityRole="button" accessibilityState={{ disabled: !aiPick.enabled }}
            style={{ padding: 16, borderRadius: 20, backgroundColor: 'rgba(76,52,140,0.32)', borderWidth: 1, borderColor: hexA('#A78BFA', aiPick.enabled ? 0.55 : 0.25), opacity: aiPick.enabled ? 1 : 0.6, gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: hexA('#A78BFA', 0.16), borderWidth: 1, borderColor: hexA('#A78BFA', 0.45), alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="sparkle" size={19} color="#A78BFA" strokeWidth={2} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 16, color: '#fff' }}>Generate with Odds AI</Text>
                <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 2, lineHeight: 16 }}>Drafts a Strength Training plan from the QHP, medical and blood reports. You edit everything before it goes for review.</Body>
              </View>
              <Icon name="chevRight" size={16} color="#A78BFA" strokeWidth={2.4} />
            </View>
            {aiPick.reason ? <Body style={{ fontSize: 11, color: C.gold }}>{aiPick.reason}</Body> : null}
          </Pressable>
          <Pressable onPress={() => chooseMode('manual')} hitSlop={6} accessibilityRole="button"
            style={{ padding: 16, borderRadius: 20, backgroundColor: 'rgba(50,30,19,0.45)', borderWidth: 1, borderColor: hexA(C.orange, 0.4), gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: hexA(C.orange, 0.14), borderWidth: 1, borderColor: hexA(C.orange, 0.4), alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="dumbbell" size={19} color={C.orange} strokeWidth={2} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 16, color: '#fff' }}>Build it manually</Text>
                <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 2, lineHeight: 16 }}>The plan builder as it is today: modality, sections, exercises and sets.</Body>
              </View>
              <Icon name="chevRight" size={16} color={C.orange} strokeWidth={2.4} />
            </View>
          </Pressable>
          <Body style={{ fontSize: 10.5, color: C.muted3, textAlign: 'center' }}>Either way the plan goes to the CRM for review before it reaches the client.</Body>
        </Page>
      </View>
    );
  }
```
It uses `goBack` (not `guardedBack`) and a plain `Page` (no `kbAware`, nothing to type here).

3.5.5 The form header: the `{!isEdit ? (...) : null}` line under the subtitle is new; the rest is unchanged:
```tsx
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 13 }}>
          <IconChip icon="file" color={C.orange} />
          <View style={{ flex: 1 }}>
            <Serif style={{ fontSize: 24 }}>{isEdit ? 'Edit Plan' : 'Create Plan'}</Serif>
            <Body style={{ fontSize: 12.5, color: C.muted, marginTop: 1 }}>
              {isEdit ? 'Saving resubmits the plan to the CRM for review' : 'Goes to the CRM for review before it reaches the client'}
            </Body>
            {!isEdit ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                <Body style={{ fontSize: 11.5, color: mode === 'ai' ? '#A78BFA' : C.orange }}>{mode === 'ai' ? (aiApplied ? 'Odds AI plan, drafted' : 'Odds AI plan') : 'Manual plan'}</Body>
                <Pressable onPress={() => (mode === 'ai' ? setMode('manual') : aiPick.enabled && chooseMode('ai'))} hitSlop={10} accessibilityRole="button" disabled={mode !== 'ai' && !aiPick.enabled}>
                  <Body style={{ fontSize: 11.5, color: C.muted, textDecorationLine: 'underline' }}>{mode === 'ai' ? 'Switch to manual' : aiPick.enabled ? 'Try Odds AI' : `Odds AI: ${aiPick.reason ?? 'not available'}`}</Body>
                </Pressable>
              </View>
            ) : null}
          </View>
        </View>
```

3.5.6 The panel above Plan details. Before (C3):
```tsx
        {/* Odds AI plan assistant: Essentials clients, new plans (16 Oct 2026) */}
        {aiEligible && aiPreviewQ.data && selectedClientId ? (
          <AiPlanAssistant clientId={selectedClientId} clientName={clientName} preview={aiPreviewQ.data} onApply={applyAiDraft} />
        ) : null}
```
After:
```tsx
        {/* Odds AI plan assistant: new plans, the AI build mode (16 Oct 2026; every client since 21 Oct 2026) */}
        {mode === 'ai' && !isEdit && selectedClientId ? (
          aiAllowed && aiPreviewQ.data ? (
            <AiPlanAssistant clientId={selectedClientId} clientName={clientName} preview={aiPreviewQ.data} onApply={applyAiDraft} />
          ) : aiPreviewQ.data && !aiPreviewQ.data.allowed ? (
            <View style={{ padding: 12, borderRadius: 14, backgroundColor: hexA(C.gold, 0.08), borderWidth: 1, borderColor: hexA(C.gold, 0.35) }}>
              <Body style={{ fontSize: 12, color: C.gold, lineHeight: 16 }}>Odds AI is not available for this client (you can only plan for your own or your booked clients). Build the plan manually below.</Body>
            </View>
          ) : aiPreviewQ.isError ? (
            <View style={{ padding: 12, borderRadius: 14, backgroundColor: hexA(C.gold, 0.08), borderWidth: 1, borderColor: hexA(C.gold, 0.35) }}>
              <Body style={{ fontSize: 12, color: C.gold, lineHeight: 16 }}>Odds AI could not be reached. Build the plan manually below, or try again when the connection is back.</Body>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 14, backgroundColor: 'rgba(76,52,140,0.25)', borderWidth: 1, borderColor: hexA('#A78BFA', 0.3) }}>
              <ActivityIndicator size="small" color="#A78BFA" />
              <Body style={{ fontSize: 12, color: C.muted2 }}>Checking what Odds AI can read for {clientName.split(' ')[0]}…</Body>
            </View>
          )
        ) : null}
```

### 3.6 Not to port
- `app.json` (Android version 5.1 (36)).
- Nothing in `aiPlanQueries.ts`, `offline.ts` or `essentialsPlanAlert.tsx` changed; the home alert's "Create with
  AI" now lands on the build mode screen through the same `go('create-plan')`.

### 3.7 Checks
- `npx tsc --noEmit` exit 0.
- `node tests/rules/ai_plan_rules_test.js` prints ALL PASS (43).
- `node tests/rules/not_in_db_items_test.js` prints ALL PASS (2). It is unchanged but loads `clientQueries.ts`, so
  run it after 3.4.

## 4. Check on the iPhone
Use a trainer test account and a client that trainer is linked to; online unless a step says otherwise. Steps 4 and
5 make one real AI call (20 to 40 s; it writes nothing) and submit a real plan for review.
1. Client > Plan tab > Create Plan. Expected: the build mode screen with the texts of 1.1; both cards live (after a
   moment, a client you are neither linked to nor booked with shows "Not available for this client" on the AI card).
2. Tap Back. Expected: back on the client page, no discard prompt.
3. Create Plan > Build it manually. Expected: the normal form with no modality picked, header "Manual plan" with
   "Try Odds AI", no violet panel. Pick Yoga: the link reads "Odds AI: Strength Training plans only for now" and does
   nothing. Pick Strength Training, type a plan name, tap Try Odds AI: header "Odds AI plan" with "Switch to manual",
   the panel appears above Plan details, the name you typed is still there.
4. Leave the form (discard), then Create Plan > Generate with Odds AI. Expected: Strength Training already picked;
   "Checking what Odds AI can read for (first name)…" briefly, then the assistant. For a non-Essentials client the subtitle starts with
   "Drafts", for an Essentials client with "Essentials client ·". Pick Push / Pull / Legs, note "no machines at home,
   wants to focus on posture", Generate. Expected: the draft in the builder and the header "Odds AI plan, drafted".
5. Change one set, delete one exercise, tap Switch to manual (header "Manual plan"), Submit. In SQL:
   `select distinct source, ai_prompt from workout_plan_exercises where plan_id = (select plan_id from
   workout_plan_exercises where client_id = '<client id>' order by created_at desc limit 1);` returns one row:
   `ai`, `Push / Pull / Legs · no machines at home, wants to focus on posture`.
6. Submit a plan built manually (step 3 path). The same query returns `human` and null.
7. Approve the AI plan (CRM or coach). `select creator, ai_prompt, status, expires_at from workout_plan where plan_id
   = '<plan id>';` returns `ai`, the same prompt, `active`, approval time plus 42 days.
8. Plan tab > Edit on the AI plan. Expected: straight to the form titled "Edit Plan"; no build mode screen, no header
   line, no panel. Save and resubmit; the query of step 5 still returns `ai` and the same prompt.
9. Airplane mode, Create Plan. Expected: the AI card dimmed with "Needs a connection"; Build it manually works and the
   plan queues as before. Then online: apply a draft, switch to airplane mode, Submit (queued); back online, after the
   sync the rows read `ai`.
10. If the My Crew expired-plan gate is ported (`ios-plan-cover-handoff.md`): its Create plan button for a Yoga row
    opens the build mode screen with "Strength Training plans only for now" on the AI card, and Build it manually
    opens with Yoga picked.
11. Home alert "Create with AI" (an Essentials client with no valid plan, C3): lands on the build mode screen, not
    directly in the AI mode.

Not confirmed: a device run of the build mode on Android (the feature doc still says "device test pending" for the
5.1 (36) test APK).
Not confirmed: whether a trainer who is booked with a non-Essentials client but not linked to them in
`trainer_clients` can save the drafted plan; the function lets them draft, but the repo only holds the booked-trainer
insert policy for Essentials clients (the other trainer insert policies are not in the migrations).
