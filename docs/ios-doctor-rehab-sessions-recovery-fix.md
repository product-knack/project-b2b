# iOS handoff: Doctor client detail > Rehab Sessions must include recovery (and therapy) logs (7 Oct 2026)

Paste this whole doc to the iOS app's coding assistant. On the doctor's client detail page, the **Rehab Sessions**
section lists the client's physio sessions logged by doctors. A **Recovery** log (Log Physio Session > Recovery:
red light, pneumatic compression, cognitive entrainment and the other modalities) never appeared in it, on the
web or on Android, because the section filtered on a hard-coded list of session types that left `recovery` out.
Fixed on web and Android on 7 Oct 2026. If the iOS client detail was ported from Android it carries the same list
and the same bug. No backend change; the rows were always in the database.

---

## 0. Ground rules

1. Backend is live and shared (Supabase project `agtjszjedaenclbzgjvi`). Do not run any SQL. This is a read filter fix.
2. Do not widen the section to every doctor session type. The 21-type `DOCTOR_SESSION_TYPES` list defines
   "a doctor session" for counts and the day list; the Rehab Sessions section deliberately uses the narrower list
   below. The two numbers on the same page (Physio Sessions count vs Rehab Sessions count) legitimately disagree.
3. Keep rendering rules per group type (section 3). A recovery group has no sets; it has modality fields.

## 1. What a recovery log writes

Log Physio Session has three categories. Each writes one `training_sessions` row and, for rehab and recovery,
`physio_session_exercises` rows keyed by `session_id`:

| Category | `training_sessions.session_type` | `session_name` | `physio_session_exercises` rows |
|---|---|---|---|
| Rehab | `rehabilitation` | `Rehab Session` | one row per set: `exercise_name, exercise_order, set_number, reps, weight_kg, duration, phase`, `session_type = 'rehab'` |
| Recovery | `recovery` | `Recovery Session` | one row per modality: `exercise_name` = modality label, `modality_type` (key), `area_focused`, `modality_duration`, `modality_frequency` (holds the temperature for red light), `modality_pressure`, `modality_notes`, `training_type`, `session_type = 'recovery'` |
| Therapy | `therapy` | the sub-modality label (e.g. `Massage Therapy`) | none |

Also on the row: `trainer_id` (the doctor), `client_id`, `scheduled_at`, `status` (`completed`, or `cancelled`
when the "Mark as Cancelled" box was ticked), `attendance_marked`, `notes` (structured text built from the form),
`notes_ai_analysis`, `rehab_ai_analysis` (written later by the `generate-rehab-ai-analysis` edge function),
`workout_session_id` (set to the row's own id right after insert), `voice_notes` (see the voice notes handoff).

## 2. The section's query (what to match exactly)

```
training_sessions
  select id, session_type, scheduled_at, notes, notes_ai_analysis, rehab_ai_analysis, trainer_id, status,
         workout_session_id, voice_notes, profiles!trainer_id(first_name, last_name)
  where client_id = <client>
    and session_type in (REHAB_SESSION_TYPES)
  order by scheduled_at desc
```
then one query for the exercise rows of those sessions:
```
physio_session_exercises
  select id, session_id, exercise_name, exercise_order, set_number, reps, weight_kg, duration, session_type, phase,
         area_focused, modality_duration, modality_frequency, modality_notes, modality_pressure, modality_type, training_type
  where session_id in (<ids>)
  order by exercise_order asc, set_number asc
```

**REHAB_SESSION_TYPES, the fixed list (11 on web, 12 on Android):**
```
therapy, recovery, physiotherapy, rehabilitation, massage_therapy, red_light_therapy,
cold_bath_therapy, pneumatic_therapy, cupping_therapy, dry_needling, cryotherapy
```
Android includes `therapy` as well (it was missing there too, so a doctor's own therapy logs were hidden); the web
list already had it. Before the fix both lists had ten entries without `recovery`.

Query key `['rehab-sessions', clientId]`, 60 s stale. Invalidate it after a physio session save and after the
rehab AI analysis returns (both already do on Android: `useSubmitPhysioSession.onSuccess`, `useRehabAIAnalysis`).

## 3. Rendering per card (mirror Android `RehabSessionCard`)

- Header: a badge with the session type (`formatDoctorSessionType`: `rehabilitation` -> "Rehabilitation",
  `recovery` -> "Recovery", `therapy` -> "Therapy", snake case to Title Case otherwise), red when cancelled,
  blue otherwise; the date and time on the right.
- "by {doctor name}" from the `profiles` join (fallback "Unknown").
- Chips when present: **Notes** (opens the structured notes text), **Notes AI** (purple, `notes_ai_analysis`),
  **Rehab AI** (gold, `rehab_ai_analysis`), **Play · N** (purple, voice notes; see the voice notes handoff).
- "View Details (N)" toggles the exercise groups. Group the exercise rows by `exercise_order + exercise_name`:
  - a group whose first row has `modality_type` is a **recovery modality**: show the modality name, then
    Area (`area_focused`), Duration (`modality_duration`), Temperature (`modality_frequency`), Pressure
    (`modality_pressure`), Training (`training_type`), Notes (`modality_notes`), each only when present;
  - otherwise it is a **rehab exercise**: one line per set, "Set n: 12 reps • 20kg • 45s" (skip missing parts, "—" when all missing), with the phase badge (gold) on the group header when `phase` is set.
- A therapy session has no groups, so no View Details.
- Cancelled sessions stay in the list with the red badge.

## 4. Where else the same list lives (check iOS for copies)

- CRM client detail session categoriser (Android `crmClientQueries.ts`): a session whose type is in the rehab
  list is category `rehab`; `personal_training` / `workout` is `workout`; anything else is `other`. `recovery`
  was missing there too and showed as "other"; fixed the same day. `therapy` still categorises as `other` there
  by design (not changed).
- Client Sessions list skip-set (Android `clientQueries.ts`): already had `recovery`; used to keep doctor logs out
  of the trainer's workout list.
- QHP manager "rehab only" detection (Android `qhpManagerQueries.ts`): already had `recovery`.

## 5. Verify

```sql
select session_type, count(*) from training_sessions
where client_id = '<client id>' and trainer_id in (select id from profiles where role = 'doctor')
group by 1 order by 2 desc;
```
A client with a `recovery` row here must show that row in Rehab Sessions after the fix, with the modality
details under View Details. Device: as a physiotherapist, Log Physio Session > Recovery for a client with one
modality (red light, 10 min, 40 degrees) -> open the client -> Rehab Sessions lists a "Recovery" card today ->
View Details shows the modality with Duration and Temperature.

## 6. Reference

Android: `src/lib/doctorQueries.ts` (`REHAB_SESSION_TYPES`, `useRehabSessions`, `submitPhysioSession`),
`src/screens/doctorClientDetail.tsx` (`RehabSessionCard`). Web: `src/components/doctor/RehabSessionsSection.tsx`,
`src/components/physiotherapy/PhysioSessionDialog.tsx` (`getSessionType`). Feature doc:
`docs/features/web/doctor/doctor-dashboard.md` (section 13 change log, 2026-10-07).
