---
name: doctor-workspace
description: "Native doctor/HOD dashboard — verified contracts, hardcoded IDs, assessment-JSON gotcha, RLS blind spots, untested write paths"
metadata: 
  node_type: memory
  type: project
  originSessionId: 5527b21c-0de8-4869-8f72-0c35b4727fce
---

Native doctor workspace (built 2026-07-18) lives in `odds-app/src/lib/doctorQueries.ts` + `screens/doctor.tsx` (dashboard, clients, all-clients, approvals, roster + bulk-create/delete-future sheets), `screens/doctorSessions.tsx` (day sessions + PhysioSessionSheet), `screens/doctorClientDetail.tsx` (header, protocols create/list, rehab sessions, counselling, medical history, findings, remarks). Route `doctor-client-detail` via `set({selectedClientId}) + go(...)`.

Verified-live facts that documents/agents got wrong or glossed:
- `coach_assessment` basicInfo lives at `(new||existing)_client_assessment_data['Standardized Assessment'].clientProfile.basicInfo` with keys **clientAge/clientGender/clientHeight/clientWeight** (NOT age/gender/height/weight); web maps them in useClientDetail.ts:246-249 with `|| null` (empty string → null).
- RLT temperature is stored in `physio_session_exercises.modality_frequency` (recovery rows); `modality_duration` = rlt_duration for RLT else pc_duration.
- Protocol create: NO client-side `status` (DB default pending); one row per SET, `exercise_order` increments per exercise (not per set) and is GLOBAL across phases; `sets` = set-count copied onto every row.
- `physiotherapy_counselling` and `client_findings` are **doctor-scoped RLS**: 0 rows as admin, but 1 / 322 rows as the Head Doctor — confirmed live. Doctor test login (SignIn prefill): **Anjanarawat@oddsfitness.com / Anjana@odds10** = Anjana Odds, role doctor, tag physiotherapist, uid = HEAD_DOCTOR_ID (30df5c2b-…) → she sees both physio AND HOD surfaces. Verified as her (read-only, 2026-07-18): physio-senior-dashboard edge fn ok (monthly 178, leaderboard 6 doctors), 482 active clients, 24 neural checks, 4 protocols, 35 own roster rows, 75 medical-history rows, 266 health reports. Dr. Divya is role='trainer', not doctor.
- Head-doctor gates are hardcoded UUIDs (HEAD_DOCTOR_ID, ALLOWED_DOCTOR_IDS, FULL_ACCESS_PHYSIO_IDS in doctorQueries.ts) — web contract, do not parameterize. Edge fn `physio-senior-dashboard` itself 403s non-HEAD.
- Bulk roster create uses local `getDay()` day_of_week + exact-timestamp conflict checks (doctor then client), inserts `{trainer_id, client_id, scheduled_datetime, modality, status:'scheduled'}` into session_schedule; delete-future is a guarded hard delete (client + >=today + neq cancelled + optional trainer).
- Add Medical Entry is a TWO-mode dialog (web MedicalHistoryFormDialog): Manual (uploads to `medical-history-files` at `${clientId}/${Date.now()}_${name}`, attachments jsonb) and AI Upload (per file: `client-documents` at `${clientId}/findings/${ts}-${safeName}` + placeholder client_findings row `description:'AI processing (batch)...'`, then ONE `process-finding-batch` invoke `{files,clientId,doctorId,documentType:'lab_report'|'other'}` → 202 background; refetch findings/health-reports/medical-history at 0/+30s/+75s; a missing ack is a SOFT warning, not failure). lab_report lands in health_reports, other in client_medical_history.

**Why:** the user mandates byte-compatible backend contracts; these are the spots where a "reasonable" implementation diverges silently.
**How to apply:** before changing any doctor query, diff against web repo hooks (usePhysioProtocols, useClientDetail, PhysioSessionDialog). Write paths (physio session submit, protocol create/approve/reject, roster mutations, counselling add/AI, medical-history add, remarks, assign-doctors, finding share toggle) were NEVER test-fired against production — need a real doctor login on device. See [[coach-workspace]], [[workout-log-contract]].
