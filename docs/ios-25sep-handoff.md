# iOS handoff: everything the Android app gained on 25 Sep 2026 (+ two 24 Sep items)

Paste this whole document to the iOS app's coding assistant. Sections 1 to 6 are the 25 Sep 2026 work; A and B are two
24 Sep features that were never in an earlier handoff. Reference implementation: the Android Expo app `odds-app`
(file and function names given per section). Everything on the server is already LIVE on the shared Supabase project
`agtjszjedaenclbzgjvi`.

## How to work through this document
1. Build one section at a time, in order, and report after each: what iOS already had, what you changed, what you
   verified. Type-check before starting the next section.
2. Do NOT create, alter or run any SQL, policy, bucket, cron or edge function. Every table, column and RPC below is
   live (probed on 25 Sep 2026). If a probe says otherwise, stop that section and tell the user.
3. Probe read-only before building (a GET / RPC call as a signed-in test user). Never write test rows into production.
4. Standing rules: the signed-in user's id is `session.user.id`; every network call goes through the app's
   `withTimeout`; dates shown or keyed in IST; no em dashes in user-facing copy; sheets use a sibling backdrop,
   never a Modal mounted as a sibling of another open Modal (mount it inside the parent's tree), hitSlop >= 10 on
   icon buttons, keyboard-aware padding on any sheet with a TextInput; screens that show health data are
   replay-shielded.
5. Test accounts: trainer Sagar `sagaroddsfitness@gmail.com` / `Sagar07` (also manager of crew "Sagar"); admin
   `oddsfitnessapp@gmail.com` / `Oddsfitness@11`.

---

## 1. QHP Ops booking note reaches the assigned assessor

**Why.** When Ops books a QHP on a lead they can write a note (`leads.qhp_pref_notes`). The QHP Manager already saw it
on the Task Pending card ("NOTES FROM OPS"), but the assessor the manager assigned never did in the app.

**Backend (live, since 23 Sep).** `coach_assessment.qhp_pref_notes text NULL`, a read-only carry-over of the Ops note,
separate from `coach_assessment.notes` (which the manager owns). The web and a backfill already fill it.

**1a. Write it when a manager schedules from Task Pending.** The Schedule QHP sheet opened from a Task Pending card is
prefilled from the lead's preferences (date, time, location, and the Ops note into the editable Notes box; keep that).
In the insert into `coach_assessment` add:
`qhp_pref_notes: <the Ops note exactly as Ops wrote it (the prefill value, trimmed), or null when empty>`,
never the Notes box text. Other schedule paths (Schedule New with no prefill, approving a CRM `qhp_schedule`
request) write null, same as the web. Android: `useScheduleQhp` in `src/lib/qhpQueries.ts` (`opsNotes` input),
`ScheduleQhpSheet` in `src/screens/trainer.tsx` passes `opsNotes: prefill?.notes ?? null`.

**1b. Show it to the assessor.** The assessor's own list already selects `coach_assessment` with `*`, so the column
arrives. Map it (`ops_notes = row.qhp_pref_notes`) and render a notes box on:
- the **Upcoming** QHP card, under the when / where / phone block;
- the **My QHPs** (completed) card, under the date line;
- the **assessment detail** screen: a "NOTES FROM OPS" card (gold label) above the existing "NOTES" card.

Notes box (Android `QhpNotesBox`): gold-tinted box (`gold` 7% fill, 28% border, radius 11) with a file icon;
"NOTES FROM OPS" (Mono 8.5, gold) + the Ops note; below it "NOTES" (muted label) + `coach_assessment.notes`, shown
only when that text differs from the Ops note after trimming (the manager's Notes box is prefilled with the Ops note,
so it is often a repeat). No box when both are empty.

**Verify.** As an assessor with a QHP scheduled from Task Pending after this change: Upcoming shows NOTES FROM OPS.
Live on 25 Sep: 20+ `coach_assessment` rows carry `qhp_pref_notes`.

---

## 2. Trainer client Reports: doctor consultation AI summary

**Why.** Trainers could not see a client's doctor-consultation AI summary: `doctor_consultation_details` RLS admits
only the doctor, CRM, admin and the client.

**Backend (live, SQL run 25 Sep).**
`get_client_consult_ai_summaries(p_client_id uuid) RETURNS TABLE (id uuid, consultation_date date, start_time time,
end_time time, status text, doctor_name text, ai_notes jsonb)`, SECURITY DEFINER. Returns only non-cancelled
consultations with a non-empty `ai_notes`, newest first, and only when the caller actively trains the client
(`trainer_clients.actively_training`) or is admin / super_admin; anyone else gets `[]`; anon is denied.
Live check: Sagar gets 2 rows for his client Vashist Dev (Dr. Wasir, 21 and 18 Sep).

`ai_notes` shape: `{ short_summary?, summary_points?: string[], clinical_impression?, red_flags?: string[],
tests_suggested?: string[], recommendations?: string[], medications?: [{ name, reason?, dosage_note? }], generated_at? }`.
Keep only rows where at least one of these has content.

**UI (Android: `src/screens/trainer.tsx` Reports tab, `src/screens/reportDetail.tsx` `ConsultAiSheet`,
`src/lib/clientQueries.ts` `useClientConsultAi`).**
- Reports tab gets a 4th sub-chip **Doctor** (after QHP, Blood, Medical; green; live count). Query key
  `['client-consult-ai', clientId]`, staleTime 120 s.
- States: "Loading consultations…"; error "Couldn't load doctor consultations." + Try again; empty (dashed box)
  "No doctor consultation summaries yet. They appear here once the doctor's call has its AI summary."
- One card per consultation: sparkle icon, "Consultation with {doctor}" (or "Doctor consultation"),
  `DD MMM YYYY · HH:MM`, VIEW chevron, the short summary (3 lines), badges "AI summary" and "{n} red flag(s)".
- Tap opens a sheet (green accent): title "Consultation with {doctor}", subtitle "{Thu, 24 Sep 2026} · {4:00 PM to
  5:00 PM}"; an AI SUMMARY box (short summary); cards Summary (bullets), Clinical impression, Red flags · N (red),
  Medications discussed (name + dosage chip + reason), Recommendations, Tests suggested; empty sections skipped;
  footer "AI summary of the doctor's call, written {IST stamp}. Read only; the prescription stays with the doctor and
  the CRM." The client detail route is already replay-shielded.

---

## 3. Workout templates save without values

**User rule:** "allow to save without entering values as this is template only".
- Needed to save: a template name and at least one named exercise. Reps, load and duration are optional.
- Every named exercise and every set row is saved; an empty reps / load / duration is stored as NULL
  (`workout_templates.reps_assigned`, `load_assigned`, `duration_seconds` are nullable; the web already saved this
  way: Sagar's 4 web-made templates, 55 rows, all NULL). An exercise with no set row still gets one row.
- Applies to both the template builder and "Save as template" from Add Workout (which now keeps exercises left empty).
- Empty-save error: "Nothing to save. Add at least one exercise first." (no em dash).
- Loading a template: NULL becomes an empty field. A duration exercise saved with no durations loads back as reps
  (no stored measurement); accepted.
- Android: `useSaveWorkoutTemplate` in `src/lib/clientQueries.ts`; builder `TemplateBuilderSheet` (`hasContent` =
  any section has a named exercise).

---

## 4. Trends: full meal description

On client detail > Trends > the day summary > DAILY MEALS, the meal name was cut at 2 lines with "…". Show the whole
text (no line limit, line height 18) and pin the IST time to the first line (align the row to the top). A meal carries
only `meal_name` as text (`nutrition_tracker.meals_analysis`); the rest are numbers.

---

## 5. Cycle phase label for women clients under 50

**What.** A small animated label on a qualifying client wherever a trainer or crew manager sees her: My Crew rows,
Today's Roster cards (logged and not yet logged), the workout health check-in popup, and the client detail header.
Tap opens a popup with the next period, how she felt the last 3 days, and how to train her today.
User decisions: access only through the RPC below (table RLS unchanged); no client-app notice; shown to the client's
active trainer, her trainer's crew manager, the physio HOD (doctor / therapist clients) and admins.

### 5a. Backend (live, SQL run 25 Sep)
`get_clients_cycle_status(p_client_ids uuid[]) RETURNS TABLE (client_id uuid, today date, periods jsonb, feel jsonb)`,
SECURITY DEFINER. One call per screen with all visible client ids (`clients.id`).
- A row comes back only for an **eligible** client the caller may see. Eligible = female (`profiles.gender` starts
  with "f"; if blank, the first `gender`/`sex` key in her newest `coach_assessment` JSON), DOB known (`profiles`, else
  `clients`), under 50 today (IST), at least one `period_logs` row. Everyone else: no row, so no label.
- `today`: IST date (use it, not the phone clock). `periods`: newest 13 `{start_date, end_date}` (end null = ongoing
  or not logged), starts not in the future. `feel`: `symptom_logs` of today-2..today `{date, energy_level 1-5,
  symptoms: string[] ids like cramps, fatigue, back_pain, headache, bloating}`, newest first.
- A missing function returns PGRST202: treat it as "no labels", never an error on the screen.
- Live on 25 Sep: 17 eligible women have period logs (1 on her period: Shruti Chopra, day 1; 4 luteal; 4 late;
  8 not tracking). Sagar gets 1 of his own clients, 11 as crew manager, 0 outside his crew; anon is denied.
- Cache: key `['client-cycle-status', sortedIdsJoined]`, staleTime 10 min, and **never persist it to disk**.

### 5b. The calculation (port exactly; the phase is computed in the app, nothing is stored)
The full reference file is at the end of this document (`src/lib/cycleStatus.ts`, pure TypeScript, no React).
Summary:
1. Cycle lengths = days between consecutive start dates, kept only when 1..59.
2. L = weighted average of those, newest heaviest (weights n..1), rounded; 28 when none.
3. P = plain average of (end - start + 1) for periods of 1..14 days, rounded; 5 when none.
4. Cycle day = today - last start + 1.
5. Paused if cycle day > 60 (no phase, no prediction); late if cycle day - L > 7 ("late by cycle day - L days", no
   phase, coach as late luteal); else tracking.
6. Ovulation day ov = L - 14; window max(ov - 1, P + 1) .. ov + 2. Menstrual 1..P, follicular up to the window,
   ovulation in the window, luteal after it; days L+1..L+7 stay luteal with "period due". (28 / 5 gives 1-5, 6-12,
   13-16, 17-28.)
7. Latest period without an end date: menstrual up to day min(10, max(7, P + 2)), then step 6 plus an "end date not
   logged" flag. With an end date: menstrual through that day; a step-6 menstrual after it reads follicular.
8. Next period = last start + L, +/- population standard deviation of the counted cycles (at least 1; 3 when fewer
   than 2 cycles). Confidence high <= 3, medium <= 5, else low; fewer than 3 cycles = always low, shown as
   "Around {date} (estimate)". Only while tracking.
Android tests (all passing): the 28/5 table, period due at day 30, late at 36 (by 8), paused at 61, no end date
days 6-8, end date day 3 and 7, single log (L 28, P 5, ±3, low estimate), a dropped 70-day gap, confidence bands.

### 5c. Label (chip)
- Text: `PERIOD · D2` (pink `#F06A9B`), `FOLLICULAR PHASE · D8` (green), `OVULATION PHASE · D14` (gold),
  `LUTEAL PHASE · D22` (purple), `LATE · 9D` (red), `CYCLE · NOT TRACKING` (muted).
- Style: pill, Mono 8, letter-spacing 0.5, colour fill 12%, border 50%, a 6 px colour dot before the text,
  hitSlop 10, overflow hidden.
- **Animation** (user request, so it is spotted at a glance): a 1.8 s loop (0.9 s in, 0.9 s out, ease in-out): a
  colour glow behind the chip (opacity 0 to 0.22) and a ripple from the dot (a same-colour 8 px circle scaling 1 to
  2.2 while fading 0.55 to 0). Native-driver opacity / scale only. No animation for "not tracking", and none at all
  when the phone's Reduce Motion is on.
- Wrap the chip (and the popup body) in the replay mask: the dashboard is not a shielded screen.

### 5d. Status line
"On her period, day 2" · "Follicular phase, day 8" · "Ovulation phase, day 14" · "Luteal phase, day 22" ·
"Luteal phase, day 30, period due" · "Period late, 9 days" · "Not tracking recently".

### 5e. Popup (centred modal, sibling backdrop)
Header: name + "CYCLE · {chip text}", close (hitSlop 10). Body:
- status line box (phase colour) with "Next period: Tue, 7 Oct ± 2 days · high confidence" or
  "Next period: Around Sun, 18 Oct (estimate)" (tracking only); gold note "Her last period's end date isn't logged,
  so today's phase is an estimate." when flagged; "AVG CYCLE n DAYS · AVG PERIOD n DAYS · n CYCLES COUNTED".
- "HOW SHE FEELS · LAST 3 DAYS": per logged day "Today" / "Yesterday" / "Tue, 23 Sep", "Energy n/5" (red <= 2,
  gold 3, green 4-5), symptom chips (Cramps, Fatigue, Back pain, Headache, Bloating first; other ids title-cased);
  or "Nothing logged in the last 3 days."
- "TRAINING TODAY": the bullets for the phase (text in the reference file, `CYCLE_GUIDANCE`; late uses the late list,
  not tracking its own line).
- Footer: "How she feels and recovers today wins over the phase; the phase is only an estimate from her logged dates.
  Adjust training quietly and do not bring up her period unless she does."

### 5f. Where it shows
1. **My Crew**: every client row in the plan cards (today's live card with logged and pending ticks, tomorrow's plan)
   and in the manager's plan compose sheet, next to the PROTOCOL chip. One fetch per card for all its client ids; the
   popup inside the compose sheet's modal tree.
2. **Today's Roster** (trainer dashboard, Today view only, including carry-over rows): the chip right after the state
   chip, on logged and not-yet-logged cards alike. One fetch for all roster client ids; one popup for the dashboard.
3. **Workout health check-in popup** ("Log Health Data", the sleep / nutrition / steps sheet): a tappable row under the
   header: chip + status line + chevron, phase-colour tinted (7% fill, 30% border, radius 14). Tap opens the popup,
   mounted inside that sheet's modal.
4. **Client detail**: the same kind of row at the bottom of the header card (after "Since…", location, CRM), with a
   second line "Next period: …" when tracking. Popup at page level.
Android files: `src/lib/cycleStatus.ts`, `src/lib/cycleQueries.ts`, `src/components/cycleLabel.tsx`,
`src/components/ReplayShield.tsx` (`ReplayMask`), `src/screens/managerChat.tsx`, `src/screens/trainer.tsx`.

---

## 6. CRM: mandatory Next Call Agenda

**Backend (live since 24 Sep).** `crm_communications.next_call_agenda text NULL`. No constraint on purpose.

**Form (CRM > client > Comms > Log Communication).** Add, after the voice memo block and before FOLLOW-UP (web order:
remarks, agenda, follow-up): label "NEXT CALL AGENDA" with a red "*", multi-line input (min height 70, top-aligned),
placeholder "What to cover on the next call...". While empty, a muted hint: "Required. Write what the next call should
cover before saving." Save stays disabled until remarks AND the agenda are non-empty after trimming (plus existing
rules). The save throws "Next call agenda is required" on a blank agenda and inserts `next_call_agenda:
agenda.trim()` (never null or empty from the form). Reset it with the form.

**Automatic rows are unchanged.** The app's own automatic communication rows (pause journey entry, "Status changed
to …") keep writing no agenda. Older rows stay null.

**Display.** Add `next_call_agenda` to every select that feeds a communication list, and under each log's remarks
(after the voice memo player) render, only when it has text: a box (radius 10, faint fill, hairline border) with the
caption "NEXT CALL AGENDA" (Mono 8.5, muted) and the text (line breaks kept). Places: the client Comms tab history,
the Communications page (latest-per-client and full-log), and each pending follow-up card (the Mark Done card, so the
CRM sees what to cover when making that call). Nothing extra for rows without an agenda.
Android: `useLogCommunication`, `useClientComms`, `useCrmCommsBook` (`src/lib/crmClientQueries.ts`),
`useCrmPendingComms` (`src/lib/crmTabQueries.ts`), `CommAgendaBlock` (`src/components/commAgenda.tsx`).

---

## A. (24 Sep) Therapist dashboard: Emergency Leave
On the therapist home ("Therapy Desk"), under the My Crew card, add a red-tinted row: alert icon, "Emergency Leave",
sub "Request time off. The CRM team gets notified.", chevron. It opens the app's existing Emergency Leave sheet (the
one trainers and doctors use): START / END date + time (default today 09:00 to 18:00), REASON * (3+ chars), "Submit
Leave Request"; success "Leave request submitted" / "The CRM team has been notified." It inserts one `leave_request`
row `{ trainer_id: <therapist id>, start_date, start_time, end_date, end_time, reason }` (RLS already allows any
user's own row) and calls `notify-leave-request` fire and forget. No backend change.

## B. (24 Sep) Trainer Payouts: QHP Payouts card
On the trainer Payouts screen, between the hero and the payment history (hidden when empty), a blue card "QHP
Payouts", "N payments for QHP assessments", total "₹X" + "TOTAL QHP". Rows newest first (4, then "SHOW ALL N" /
"SHOW FEWER"): label (client name for a formal record, the admin's text for an extras line, 2 lines max), "PAID 09 SEP
2026 · QHP" / "· QHP SUPPORT" / "· IN PAYOUT EXTRAS", amount. In the batch breakdown, QHP extra lines are blue.
Rule (`qhpPayoutsOf` in `src/lib/payoutQueries.ts`): every `trainer_payout_records` row whose `payout_type` starts with
`qhp` (amount = `cycle_payout_amount + qhp_fee`, label = client name or "QHP Assessment"), plus every batch
`extra_earnings` line whose name contains the word "qhp" (`/\bqhp\b/i`), amount as written. Most QHP pay is typed as
extra lines (only 2 formal `qhp` records exist). Verify with Sagar: 4 payments, ₹4,994.

---

## Reference: `src/lib/cycleStatus.ts` (Android, verbatim)

```ts
/* ============ Menstrual cycle status (trainer label, 25 Sep 2026) ============
   Pure port of the client app's rule (the spec the user pasted, section 3).
   Input: the client's period logs (start / end, any order) and today's IST
   calendar date, both 'YYYY-MM-DD'. No stored phase exists anywhere; it is
   worked out from the logs every time. Data comes from the definer RPC
   get_clients_cycle_status (see cycleQueries.ts). No React in this file so it
   can be tested with plain node.

   Steps:
   1. Cycle lengths = days between consecutive start dates, kept only when
      1..59 (a gap of 60+ means she missed logging).
   2. L = weighted average of those, newest cycle heaviest (weights n..1),
      rounded; 28 when none is counted.
   3. P = plain average of (end - start + 1) for periods of 1..14 days,
      rounded; 5 when none.
   4. Cycle day = today - last start + 1 (her last period's first day = day 1).
   5. State: paused when cycle day > 60; late when cycle day - L > 7 (late by
      cycle day - L); else tracking.
   6. Phase: ovulation day = L - 14, window max(ov - 1, P + 1) .. ov + 2;
      menstrual 1..P, follicular up to the window, ovulation the window,
      luteal after it (days past L, not yet late, stay luteal: period due).
   7. Latest period correction: no end date = menstrual up to day
      min(10, max(7, P + 2)), then step 6 with an "end date not logged" flag;
      end date logged = menstrual through that day, and a step-6 "menstrual"
      after it reads follicular.
   8. Next period = last start + L, +/- one standard deviation of the counted
      cycles (at least 1 day; 3 when fewer than 2 cycles). Confidence high
      when sd <= 3, medium <= 5, low above; fewer than 3 cycles = always low,
      shown as an estimate ("around"). Only while tracking.
   The client app counts from midnight UTC, so before 05:30 IST it can show
   one day less than this calendar count. */

export type PeriodLog = { start_date: string; end_date: string | null };
export type FeelLog = { date: string; energy_level: number | null; symptoms: string[] | null };
export type CyclePhase = 'menstrual' | 'follicular' | 'ovulation' | 'luteal';
export type CycleState = 'tracking' | 'late' | 'paused';
export type CycleConfidence = 'high' | 'medium' | 'low';

export type CycleStatus = {
  state: CycleState;
  /** null when late or paused */
  phase: CyclePhase | null;
  cycleDay: number;
  /** late only: cycle day - L */
  lateBy: number | null;
  /** tracking and past day L (up to 7 days): still luteal, period due */
  periodDue: boolean;
  /** latest period has no end date and she is past the assumed bleed days */
  endDateMissing: boolean;
  avgCycle: number;
  avgPeriod: number;
  countedCycles: number;
  lastStart: string;
  /** tracking only */
  nextPeriod: { date: string; plusMinus: number; confidence: CycleConfidence; estimate: boolean } | null;
};

const YMD = /^(\d{4})-(\d{2})-(\d{2})/;
/** Days since the epoch for a plain calendar date (no timezone shifting). */
export const dayNum = (ymd: string): number => {
  const m = YMD.exec(ymd || '');
  if (!m) return NaN;
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000);
};
export const ymdOf = (n: number): string => new Date(n * 86_400_000).toISOString().slice(0, 10);

export function computeCycleStatus(periods: PeriodLog[], today: string): CycleStatus | null {
  const t = dayNum(today);
  if (!Number.isFinite(t)) return null;
  // Valid, not in the future, one row per start date, newest first.
  const seen = new Set<number>();
  const rows = (periods ?? [])
    .map((p) => ({ s: dayNum(p?.start_date), e: p?.end_date ? dayNum(p.end_date) : NaN }))
    .filter((p) => Number.isFinite(p.s) && p.s <= t)
    .sort((a, b) => b.s - a.s)
    .filter((p) => (seen.has(p.s) ? false : (seen.add(p.s), true)));
  if (!rows.length) return null;

  // 1-2. Counted cycle lengths (newest first) and the weighted average L.
  const gaps: number[] = [];
  for (let i = 0; i < rows.length - 1; i++) {
    const g = rows[i].s - rows[i + 1].s;
    if (g >= 1 && g <= 59) gaps.push(g);
  }
  let L = 28;
  if (gaps.length) {
    const n = gaps.length;
    let num = 0, den = 0;
    gaps.forEach((g, i) => { const w = n - i; num += g * w; den += w; });
    L = Math.round(num / den);
  }

  // 3. Average period length P.
  const lens = rows
    .filter((p) => Number.isFinite(p.e))
    .map((p) => p.e - p.s + 1)
    .filter((d) => d >= 1 && d <= 14);
  const P = lens.length ? Math.round(lens.reduce((a, b) => a + b, 0) / lens.length) : 5;

  // 4. Cycle day.
  const last = rows[0];
  const cycleDay = t - last.s + 1;

  const base = { cycleDay, avgCycle: L, avgPeriod: P, countedCycles: gaps.length, lastStart: ymdOf(last.s) };

  // 5. State.
  if (cycleDay > 60) {
    return { ...base, state: 'paused', phase: null, lateBy: null, periodDue: false, endDateMissing: false, nextPeriod: null };
  }
  if (cycleDay - L > 7) {
    return { ...base, state: 'late', phase: null, lateBy: cycleDay - L, periodDue: false, endDateMissing: false, nextPeriod: null };
  }

  // 6. Phase from the averages.
  const ov = L - 14;
  const winStart = Math.max(ov - 1, P + 1);
  const winEnd = ov + 2;
  let phase: CyclePhase =
    cycleDay <= P ? 'menstrual'
      : cycleDay < winStart ? 'follicular'
        : cycleDay <= winEnd ? 'ovulation'
          : 'luteal';

  // 7. What she logged about her latest period wins.
  let endDateMissing = false;
  const endDay = Number.isFinite(last.e) ? last.e - last.s + 1 : NaN;
  if (!Number.isFinite(endDay) || endDay < 1) {
    const cap = Math.min(10, Math.max(7, P + 2));
    if (cycleDay <= cap) phase = 'menstrual';
    else endDateMissing = true;
  } else if (cycleDay <= endDay) {
    phase = 'menstrual';
  } else if (phase === 'menstrual') {
    phase = 'follicular';
  }

  // 8. Next period.
  let sd = 3;
  if (gaps.length >= 2) {
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    sd = Math.sqrt(gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length);
  }
  const plusMinus = Math.max(1, Math.round(sd));
  const estimate = gaps.length < 3;
  const confidence: CycleConfidence = estimate ? 'low' : sd <= 3 ? 'high' : sd <= 5 ? 'medium' : 'low';

  return {
    ...base,
    state: 'tracking',
    phase,
    lateBy: null,
    periodDue: phase === 'luteal' && cycleDay > L,
    endDateMissing,
    nextPeriod: { date: ymdOf(last.s + L), plusMinus, confidence, estimate },
  };
}

/* ---------- labels ---------- */
// "Luteal" alone reads as jargon on a card, so the phases carry the word "phase"
// (user request 25 Sep 2026); the period itself stays plain.
export const PHASE_LABEL: Record<CyclePhase, string> = {
  menstrual: 'On her period',
  follicular: 'Follicular phase',
  ovulation: 'Ovulation phase',
  luteal: 'Luteal phase',
};

/** Card status line: "Luteal phase, day 22", "On her period, day 2", "Period late, 9 days", "Not tracking recently". */
export function cycleStatusLine(s: CycleStatus): string {
  if (s.state === 'paused') return 'Not tracking recently';
  if (s.state === 'late') return `Period late, ${s.lateBy} day${s.lateBy === 1 ? '' : 's'}`;
  const base = `${PHASE_LABEL[s.phase as CyclePhase]}, day ${s.cycleDay}`;
  return s.periodDue ? `${base}, period due` : base;
}

/** Short chip text: "PERIOD · D2", "LUTEAL PHASE · D22", "LATE · 9D", "CYCLE · NOT TRACKING". */
export function cycleChipText(s: CycleStatus): string {
  if (s.state === 'paused') return 'CYCLE · NOT TRACKING';
  if (s.state === 'late') return `LATE · ${s.lateBy}D`;
  const p = s.phase === 'menstrual' ? 'PERIOD' : `${(s.phase as string).toUpperCase()} PHASE`;
  return `${p} · D${s.cycleDay}`;
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Tue, 7 Oct" for a plain date. */
export function fmtCycleDate(ymd: string): string {
  const n = dayNum(ymd);
  if (!Number.isFinite(n)) return ymd;
  const d = new Date(n * 86_400_000);
  return `${DOW[d.getUTCDay()]}, ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
}

/** "Tue, 7 Oct ± 2 days · high confidence" or "Around Tue, 7 Oct (estimate)". */
export function nextPeriodLine(s: CycleStatus): string | null {
  const np = s.nextPeriod;
  if (!np) return null;
  if (np.estimate) return `Around ${fmtCycleDate(np.date)} (estimate)`;
  return `${fmtCycleDate(np.date)} ± ${np.plusMinus} day${np.plusMinus === 1 ? '' : 's'} · ${np.confidence} confidence`;
}

/* ---------- "How I feel" (last 3 days) ---------- */
const KEY_SYMPTOMS: Record<string, string> = {
  cramps: 'Cramps', fatigue: 'Fatigue', back_pain: 'Back pain', headache: 'Headache', bloating: 'Bloating',
};
export const symptomLabel = (id: string): string => {
  const k = String(id || '').trim().toLowerCase();
  if (KEY_SYMPTOMS[k]) return KEY_SYMPTOMS[k];
  const s = k.replace(/[_-]+/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : '';
};
export type FeelDay = { date: string; energy: number | null; symptoms: string[] };
/** One entry per logged day, newest first; key symptoms (cramps, fatigue, back pain, headache, bloating) listed first. */
export function summariseFeel(feel: FeelLog[], today: string): FeelDay[] {
  const t = dayNum(today);
  const order = Object.keys(KEY_SYMPTOMS);
  return (feel ?? [])
    .filter((f) => { const n = dayNum(f?.date); return Number.isFinite(n) && n <= t && n >= t - 2; })
    .sort((a, b) => dayNum(b.date) - dayNum(a.date))
    .map((f) => {
      const ids = [...new Set((Array.isArray(f.symptoms) ? f.symptoms : []).map((x) => String(x).trim().toLowerCase()).filter(Boolean))];
      ids.sort((a, b) => {
        const ia = order.indexOf(a), ib = order.indexOf(b);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      });
      const e = Number(f.energy_level);
      return { date: f.date.slice(0, 10), energy: Number.isFinite(e) && e >= 1 && e <= 5 ? e : null, symptoms: ids.map(symptomLabel).filter(Boolean) };
    });
}
/** "Today" / "Yesterday" / "Tue, 23 Sep". */
export function feelDayLabel(ymd: string, today: string): string {
  const diff = dayNum(today) - dayNum(ymd);
  return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : fmtCycleDate(ymd);
}

/* ---------- training guidance (the client app's own advice) ---------- */
export const CYCLE_GUIDANCE: Record<CyclePhase | 'late' | 'paused', string[]> = {
  menstrual: [
    'Strength is mostly kept; days 1 and 2 are usually the hardest.',
    'Offer lighter options: mobility, technique, moderate strength or a walk. Gentle movement can ease cramps.',
    'Never force intensity. A heavy flow can mean more fatigue.',
  ],
  follicular: [
    'Energy and recovery are rising.',
    'Best window for progressive overload, higher intensity, new skills and PR attempts.',
  ],
  ovulation: [
    'Often her peak strength and power: max efforts and HIIT are fine.',
    'Warm up well and keep landing and change-of-direction technique tight.',
  ],
  luteal: [
    'Effort feels harder, and sleep and recovery often dip, especially in the last 5 to 7 days.',
    'Go for moderate intensity; favour technique and volume over max loads.',
    'Use longer warm-ups and keep her hydrated. Do not chase PRs late in this phase.',
  ],
  late: [
    'Coach as late luteal: moderate intensity, technique and volume over max loads, longer warm-ups, hydration.',
    'Do not speculate about why.',
  ],
  paused: [
    'She has not logged a period recently, so there is no phase. Plan from how she feels on the day.',
  ],
};
export const CYCLE_ALWAYS =
  'How she feels and recovers today wins over the phase; the phase is only an estimate from her logged dates. Adjust training quietly and do not bring up her period unless she does.';

export function cycleGuidance(s: CycleStatus): string[] {
  if (s.state === 'paused') return CYCLE_GUIDANCE.paused;
  if (s.state === 'late') return CYCLE_GUIDANCE.late;
  return CYCLE_GUIDANCE[s.phase as CyclePhase];
}
```
