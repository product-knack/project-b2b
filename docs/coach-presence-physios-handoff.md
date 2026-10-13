# Coach Presence Check: add physios (web done 2026-09-26, Android port pending)

Written by the web session for the Android session. Nothing in odds-app was changed.

## What the user asked
"In this also show the physios (doctors)." The Coach Presence Check that opens on QHP Start Now lists only trainers as the supporting coach. Physios must be pickable too.

## What the web now does (`src/components/coach/SupportingTrainerModal.tsx` in hub-track)
- Query: `profiles` `select id, first_name, last_name, role, doctor_specialization_tag, specializations, role_specialization`, `.in('role', ['trainer', 'doctor'])`, `.neq('id', me)`, `.order('first_name')`.
- Drop the consultant doctor (not a physio, never at a QHP). Same rule as the web's `useConsultantDoctors`: a doctor is a consultant when `doctor_specialization_tag` is `'consultant'` (any case), or `role_specialization` contains `'consultant'`, or `specializations` text contains `consultant`. Trainers are never dropped.
- Show two groups, "Trainers" then "Physios", each A to Z. Label "Select the supporting coach or physio", placeholder "Select a trainer or physio...".
- Save is unchanged: `coach_assessment.supporting_trainer_id = <picked id>`. The column is a plain FK to `profiles` with no role check, so no SQL is needed.

## Android change
`src/screens/qhpAssessmentForm.tsx`, `CoachPresenceModal`, line ~312:

```ts
const { data, error } = await supabase.from('profiles')
  .select('id, first_name, last_name, role, doctor_specialization_tag, specializations, role_specialization')
  .in('role', ['trainer', 'doctor'])
  .neq('id', meId)
  .order('first_name');
```

Then filter out consultant doctors as above, and render the two groups with section labels. Copy has no em dashes.

## Safety notes
- Trainers can already read doctor profiles under RLS (the web QHP scheduler lists both roles from a trainer login).
- Plutus reads `supporting_trainer_id` only on a trainer's detail page, so a physio as the supporting person changes no payout.
