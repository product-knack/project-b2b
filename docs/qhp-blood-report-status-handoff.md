# Handoff: QHP "Blood Report status?" (web shipped 2026-09-29, Android pending)

Owner of this note: the web session. The Android session owns the native QHP form.

## What web did
- Every goal's last step in the web Standardized Assessment (and the doctor-side Existing Client Re-Assessment) now ends with a mandatory select **"Blood Report status?"** with three options:
  - `attached` = "Attached already"
  - `available_24h` = "Available in 24 hr"
  - `none` = "No blood reports"
- Saved at the **root of the envelope**, next to `selectedGoal`:
  `{"Standardized Assessment": { ..., "selectedGoal": "Performance", "bloodReportStatus": "attached", ... }}`
  (same key at the root of `"Existing Client Re-Assessment"`).
- Complete Assessment with it blank opens a **popup** (not a toast): "Blood report status is missing" with one button that scrolls to the field. Nothing is uploaded or written until it is set.
- Editing a completed QHP hydrates the value back; the prior-QHP prefill never copies it (it belongs to the QHP being taken). Rows saved before 2026-09-29 have no key.
- **Not asked when a blood report is already on file**: web calls the definer RPC `get_qhp_blood_report_presence(p_client_ids uuid[])` (returns `client_id, report_count, latest_test_date` for active blood reports in `health_reports`; callable by profiles with a QHP flag). When `report_count > 0` the form shows a green note instead of the select, skips the popup and writes `bloodReportStatus: "attached"` by itself. Unknown (loading, error) counts as "no report", so the question is asked.
- Nothing reads the value yet (no PDF or detail view); it is for the report team.

## What Android should do (native `src/screens/qhpAssessmentForm.tsx`)
1. Add `bloodReportStatus: ''` to the form state and write `bloodReportStatus: fd.bloodReportStatus` into the envelope root next to `selectedGoal` (the block that builds `"Standardized Assessment"`, around the `selectedGoal: fd.selectedGoal` line).
2. Render a select / sheet with the three options as the **last section of the last step for every goal** (the four classic goals and Postpartum / Prenatal / Senior Citizen / Odds Kids alike). Labels exactly as above; no em dashes.
3. Block Complete while blank with a modal, not a toast, and scroll to the field on dismiss.
4. Hydrate the value when reopening a saved assessment; keep it out of any prior-QHP prefill.
5. Follow the scroll/touch rules for new sheets (useKeyboardHeight padding, sibling backdrop, keyboardShouldPersistTaps).

Web source of truth: `oddsfitness-hub-track/src/components/coach/standardized-assessment/bloodReportStatus.ts` and `BloodReportStatusCard.tsx`; feature doc `b2b/docs/features/web/trainer/trainer-dashboard.md` section 9, "The assessment write".
