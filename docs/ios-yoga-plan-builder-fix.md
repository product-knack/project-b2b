# iOS handoff — Create Plan: rebuild the Yoga builder (picker + duration/notes sets, web parity)

Paste this whole doc to the iOS app's coding assistant. Shipped and live-verified on
Android; the iOS plan form almost certainly still has the old Yoga UI.

## 1. Symptom
Trainer → Create Plan → select **Yoga**: there is no exercise list to select from. The old
form is a free-text activity list (type each name by hand, Constant/Custom chips). The web
has moved on: Yoga plans are now built like Strength — a **full exercise picker** followed
by **per-exercise duration + notes sets**.

## 2. What the web does now (target behavior)
1. **"Select Yoga Exercises" picker**: search, alphabetical list of the yoga catalog with
   muscle-group chip, "duration" chip, equipment line; multi-select with checkmarks;
   "Add Custom Exercise"; "Add N Exercises" CTA.
2. **"Yoga Activities" builder**: each selected exercise is a card with SETS — each set has
   **DURATION** ("30 mins") and **NOTES** ("Add notes") — plus ADD SET and delete.
3. One fixed section: everything lives under body_part **"Yoga Activities"** (no
   user-named workout sections for yoga).

## 3. Data contracts (both verified live against production)
### Catalog (read)
`exercises_db` where `modality = 'Yoga'` → **109 rows**; columns
`exercise, muscle_group, equipment, measurement_type`. **106 of 109 have
`measurement_type = 'duration'`** — the picker must carry that through so picks default to
duration sets (the 3 reps-type entries get reps sets).

### Plan rows (write) — the NEW shape, one row per SET in `workout_plan_exercises`
```json
{
  "body_part": "Yoga Activities",
  "exercise_name": "Cat and cow",
  "set_number": "1",
  "duration": "30",              // minutes, as entered (string)
  "measurement_type": "duration",
  "exercise_notes": "…or null",
  "activity_type": null,          // ← null in the new shape (old shape used 'Constant')
  "reps_target": null, "load_target": null,
  "order_index": 0                // increments across all rows
}
```
plus the usual meta (plan_id, client_id, trainer_id, plan_name, plan_description,
plan_duration_weeks, modality='Yoga'; status defaults to 'pending_review').
Verified as a signed-in trainer: insert, readback, delete all pass RLS with exactly this
shape, and it is byte-identical to what the web writes today.

### The LEGACY shape (recognize on read, never write)
Old yoga plans: one row per activity, `set_number='1'`, `measurement_type='reps'`,
`activity_type='Constant'|'Custom'`, no duration/notes. Both shapes exist in the DB.

## 4. Implementation guidance (mirror the Android approach)
The cleanest route is NOT a new builder — reuse the existing strength-style machinery:
- Treat Yoga as a strength-style modality whose exercise pool is `['Yoga']` from
  `exercises_db` (Android: added `Yoga: ['Yoga']` to the plan pool map).
- Auto-seed a single section named **"Yoga Activities"**; hide the section-name input and
  the "Add Workout Section" button for Yoga.
- The picker already carries per-exercise `measurement_type` → duration exercises render
  duration+notes set rows via the existing set editor; no new set UI needed.
- The strength submit path already writes measurement_type/duration/notes per set — Yoga
  simply flows through it with the fixed body_part.

### Compatibility rules (all three matter)
1. **Editing an old-shape plan**: prefill it through the strength prefill (group rows by
   body_part) — legacy rows appear as the "Yoga Activities" section with reps-type,
   single-set entries; re-saving writes the new shape. Do not write `activity_type` for
   new rows.
2. **If iOS has an offline outbox for plan creation**: old queued payloads may still carry
   the legacy `yoga: [{name, type}]` array. Keep the legacy row-mapping ONLY as a fallback
   when that array has content; the new UI always submits via the strength path.
3. **Do not break the workout-log yoga checklist** (the approved-plan auto-populate added
   earlier): it reads `exercise_name` from plan rows — both shapes provide it, nothing to
   change, just don't rename the column usage.

## 5. Remove the old UI entirely
Delete the free-text Yoga activity list (and any interim catalog-chip variant if one was
added). Yoga renders the strength-style builder; validation strings like "Add at least one
activity" become the picker-flavored "Select at least one activity".

## 6. Verify
1. Create Plan → Yoga → picker shows the 109-entry catalog with search; selected poses
   default to duration sets; enter minutes + notes; submit.
2. DB rows match §3's NEW shape exactly (`activity_type` null, `measurement_type`
   'duration', per-set duration/notes, body_part 'Yoga Activities').
3. Edit an OLD yoga plan → it opens populated; re-save converts to the new shape.
4. The approved yoga plan still appears in the workout-log form's yoga checklist.
5. Strength/Pilates/Aerobics/Boxing builders unchanged.
