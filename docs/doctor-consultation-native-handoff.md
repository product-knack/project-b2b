# Prompt: port the Doctor Consultation dashboard to the native app, 22 Sep 2026

Paste everything below this line into a fresh session opened in `C:\Users\ADMIN\Desktop\b2b\odds-app`.

---

Build the consultant doctor's surface in this Expo app (odds-app, Expo SDK 57, React Native 0.86, react-query 5, Supabase JS 2, `react-native-webview`, `expo-print`) so it matches the hub-track web version end to end: the **Consultant Dashboard**, the **All Calls** page, the per-call **record popup** (Prescription with after-call editing, Meeting Summary, AI Notes, Download PDF), **View Reports**, **Complete**, and **Join** for the video call. The backend already exists on the shared Supabase project `agtjszjedaenclbzgjvi` and must be consumed as is: do not create tables, columns, policies, RPCs or edge functions, and do not change any JSON shape. The UI must look like the web version (its own light, indigo-on-lavender look, not the app's dark theme), section for section.

Read first, in this order: `docs/features/README.md`, then the web feature files `C:\Users\ADMIN\Desktop\b2b\docs\features\web\doctor\doctor-dashboard.md` (sections 0, 9 and 10), `C:\Users\ADMIN\Desktop\b2b\docs\features\web\crm\doctor-consultation.md` (sections 3 to 8 and the Prescription PDF part), `C:\Users\ADMIN\Desktop\b2b\docs\features\web\doctor\consultation-room.md` (sections 2 and 7 only), and the native notes `docs/memory/doctor-workspace.md` plus `docs/reimbursement-native-handoff.md` for the conventions of this repo. The web source of truth for every query and shape is `C:\Users\ADMIN\Desktop\oddsfitness-hub-track\src\hooks\useConsultationSlots.ts`, `src\pages\doctor\ConsultantDashboard.tsx`, `src\pages\doctor\ConsultantCalls.tsx`, `src\components\doctor\ConsultationRecordViews.tsx`, `src\components\doctor\PrescriptionPanel.tsx`, `src\components\doctor\ConsultantCalendarDialog.tsx` and `src\components\doctor\prescriptionPdf.ts`. Where this prompt and the code disagree, the code and the live database win: probe before writing screens.

## 1. Scope and what stays on the web

In scope, all of it:
1. A consultant fork on the doctor workspace: a consultant doctor lands on the Consultant Dashboard instead of the physio dashboard, with a nav that matches the web (Consultant Dashboard, All Calls, Reimbursement, Client Threads, Referrals, Tech Desk; no Sessions, My Clients or Messenger for consultants).
2. Consultant Dashboard (web `/doctor/consultant-dashboard`).
3. All Calls (web `/doctor/consultant-calls`).
4. The call record popup with three tabs, Download PDF, Edit prescription in amend mode with the edit history, and the Approved lock.
5. View Reports: the client's records timeline (blood reports, QHP assessments, medical history) with attachment preview.
6. Complete (status to completed) and Join (open the call).
7. The month calendar popup.

Not in scope, say so in the doc rather than half-building it:
- The Consultation Room itself. Recording and transcription run in the doctor's **browser** (MediaRecorder per participant microphone, Gemini transcription). A native join does not transcribe. Phase 1 Join opens the 100ms prebuilt link (`meet_url`) in an in-app WebView with camera and microphone granted; AI notes and the meeting summary are produced by the CRM's web room from the transcript. If the user later wants a native room, that is `@100mslive/react-native-hms` with `hms_doctor_code`, a separate task.
- Booking a slot (CRM only), the CRM's approval of a prescription, the next follow-up popup (CRM only). The doctor only reads those.
- Writing a prescription **during** a call (the web room's live editor with draft autosave). The native app edits only after the call through `amend_prescription`, which also serves "Write prescription" on a call that has none.

## 2. Who is a consultant, and the test account problem

Web rule (`isConsultantDoctor` in `ConsultantDashboard.tsx`): `profiles.role = 'doctor'` **and** (`doctor_specialization_tag` equals `consultant` case-insensitively, **or** `role_specialization[]` contains `consultant`, **or** the free text `specializations` contains "consultant"). Admin and super_admin may open the pages too. `/doctor` on the web redirects a consultant to the dashboard; everyone else sees the physio dashboard.

Native: extend `useDoctorIdentity` in `src/lib/doctorQueries.ts` (it already selects `doctor_specialization_tag, role_specialization`; add `specializations, first_name, last_name, email` to the select) with `isConsultant` computed by the rule above, plus `fullName` and `email` for the profile card. Gate the two new routes on `isConsultant || dbRole in (admin, super_admin)`; render `AccessPending` while the identity query is pending or paused (never a blank screen, see `src/screens/common.tsx`). `DoctorDashboard` in `src/screens/doctor.tsx` must fork: when `isConsultant`, render the Consultant Dashboard instead. Do not hardcode any doctor id for this.

Test account: the doctor login in memory (`Anjanarawat@oddsfitness.com`, uid = the head-doctor id) is a **physiotherapist**, so `isConsultant` is false for her and the fork will not show. Before the device test, ask the user for a consultant login (the production consultant is Dr. Wasir; the live assigned strings look like "Dr. Wasir", "Wasir", "Jasjeet Wasir"), or ask them to add `consultant` to Anjana's `role_specialization` for the test and remove it afterwards. Do not change any profile yourself.

## 3. Backend contract (live, read-only unless stated)

### 3.1 `public.doctor_consultation_details`, one row per booked consultant slot
Columns: `id uuid, client_id uuid (FK clients), doctor_id uuid (FK profiles), booked_by uuid (FK profiles), consultation_date date, start_time time, end_time time (end > start), description text, meet_url text, status text (scheduled | completed | cancelled), hms_room_id text, hms_doctor_code text, hms_client_code text, transcript jsonb [] (default), ai_notes jsonb, meeting_summary jsonb, prescription jsonb, prescription_approval jsonb, edit_history jsonb [] (default), next_follow_up jsonb, ai_autogen_at timestamptz, created_at, updated_at`.

RLS: SELECT for `doctor_id = auth.uid()` or role crm / admin / super_admin (and a client reading their own). UPDATE for `booked_by = me` or `doctor_id = me` or admin. The doctor therefore reads every own row and may update `status` directly. **Columns the app must never write directly** (guard triggers reject any client write): `prescription` (only through the RPCs), `next_follow_up` (RPC only), `edit_history` (RPC-maintained). `prescription_approval` is written only by `approve_prescription` (CRM). `ai_notes` and `meeting_summary` are written by edge functions with the service role; the doctor app only reads them. `transcript` is never read for a list (it is the biggest column); the native app does not need it at all.

Triggers you will feel: `check_consultation_slot_overlap` (booking only); `trg_consultation_completed_ai` on `status` becoming `completed` calls `consultation_autogenerate_ai` which posts to the two AI edge functions through pg_net when the transcript has lines (best-effort, wrapped in an exception block since migration `20260921160000`, so Complete never fails because of it; if that migration has not been run yet, Complete can fail with `malformed array literal: "ai_notes"`, in which case tell the user to run `20260921160000_consult_autogen_fix.sql`).

The select string, verbatim (`SLOT_SELECT` in `useConsultationSlots.ts`); keep the embed hints, the FK names matter:
```
id, client_id, doctor_id, booked_by, consultation_date, start_time, end_time, description, meet_url, status, created_at, next_follow_up, prescription, prescription_approval, doctor:profiles!doctor_consultation_details_doctor_id_fkey(first_name, last_name), client:clients!doctor_consultation_details_client_id_fkey(first_name, last_name)
```
Dashboard query: that select, `.eq('doctor_id', uid)`, ordered `consultation_date asc, start_time asc`, key `['doctor-consultation-slots', uid]`, staleTime 30 s, `refetchInterval` 60 s (the table may not be in the realtime publication; the web runs on this poll too). All Calls query: the same select plus `, ai_notes, meeting_summary, edit_history`, ordered `consultation_date desc, start_time desc`, key `['doctor-consultation-slots', uid, 'with-rx']` (same prefix on purpose so one invalidation reaches both).

Elapsed rule (`isSlotElapsed`): `status === 'scheduled'` and `new Date(consultation_date + 'T' + end_time)` is before now (device local time, like the web). Statuses shown: Scheduled (upcoming), Elapsed (scheduled and ended, not completed), Completed, Cancelled.

Complete: `update doctor_consultation_details set status = 'completed' where id = <slot>` (RLS: doctor_id = me). Invalidate `['doctor-consultation-slots']` (prefix). No cancel on the doctor side.

Join, then leaving: after the doctor closes the call, call RPC `consultation_call_ended(p_slot_id uuid) returns jsonb` (allowed for the consulting doctor, the booker, or crm / admin / super_admin). It asks the backend to generate whatever is still empty (`{posted: [...], reason}`); ignore its result beyond a toast. Idempotent within 10 minutes (`ai_autogen_at`).

### 3.2 `public.medical_diagnosis`, the older request flow, still counted on the dashboard
Columns used: `id, client_id, problem_statement, status (pending | scheduled | completed | cancelled), scheduled_at timestamptz, completed_at, assigned_doctor text, created_at`. The web selects every row with `assigned_doctor not null` ordered by `scheduled_at asc` (no doctor filter, no limit, capped at 1,000 by PostgREST) and matches in JS: strip `Dr.` / `dr` from both sides and lower-case; the row is the doctor's when `assigned_doctor` contains the full profile name or the surname (last word, 3 or more letters). Port exactly (`useConsultantConsultations`, key `['consultant-dashboard', doctorName]`, staleTime 60 s), then fetch the client names for the matched rows from `clients (id, first_name, last_name)` in batches of 100 ids. Nothing writes this table from the doctor surface.

### 3.3 Prescription: shapes and RPCs
`prescription` (RxData): `{ schema_version, status: 'draft' | 'finalized', version, date, finalized_at, finalized_by, updated_at, doctor {id, name}, patient {name, dob, age}, medicines: RxMedicineLine[], lab_tests: [{line_id, name, test_id, sort_order}], advice: [{line_id, text, sort_order}], follow_up {after_value, after_unit, note}, history: [{version, finalized_at, snapshot}], last_edited_by, last_edited_at }`.
`RxMedicineLine`: `{ line_id, medicine_id (uuid | null), name, strength (string | null), dose_amount (string, default "1"), frequency (OD | BD | TDS | QID | HS | SOS), timing (After food | Before food | With food | Empty stomach | Early morning | Before bed | Any time), duration_value (number | null), duration_unit (days | weeks | months), is_sos, instruction, sort_order }`. New line ids are `m<order>-<5 random chars>`; the defaults are dose "1", BD, After food, 5 days.
`prescription_approval` (RxApproval): `{ approved, approved_at, approved_by, approved_by_name, approved_by_role, version, note }`; `approved === true` locks the prescription: show an "Approved · d MMM yyyy" badge instead of Edit, and expect every RPC to refuse with "approved and locked".
`edit_history` entries: `{ id, at, editor_id, editor_name, editor_role, action: 'finalize' | 'amend' | 'approve', from_version, to_version, note, medicines_before[], medicines_after[], tests_before[], tests_after[] }`, newest last in the array; the web lists them newest first with what happened, the IST time, who and their role, medicines and tests added or removed (diff the before / after name arrays), and the note.

RPC `amend_prescription(p_slot_id uuid, p_payload jsonb, p_note text default null) returns jsonb` = `{prescription, edit_history}`. Caller must be the slot's `doctor_id` or a crm / admin / super_admin profile. Rules the server enforces (mirror them client-side so the user sees them before the round trip): at least one medicine, every medicine line has a name, every non-null `medicine_id` must exist in the active catalog; a finalized prescription is snapshotted into `history[]` and `version` increments; a draft or a missing prescription becomes v1; `finalized_by` stays the first finalizer, `last_edited_by` / `last_edited_at` record the editor. The payload is the full RxData you want stored (medicines, lab_tests, advice, follow_up, patient, doctor); build it from the current prescription, or from scratch for "Write prescription", with `status: 'finalized'`. Surface the server message verbatim on failure.

Catalog for the editor: table `medicines` (`select *`, `.eq('is_active', true)`), `item_type` is `medicine` or `blood_test`; medicines feed the medicine picker (name + strength), blood tests feed the tests picker. Key `['medicines-catalog']`, staleTime 5 min. Free-typed names are allowed with `medicine_id = null`.

### 3.4 AI notes and meeting summary (read only)
`ai_notes`: `{ short_summary, summary_points[], issue_points[], impression_points[], history_points[], lifestyle_points[], medication_points[], trigger_points[], clinical_impression, red_flags[], tests_suggested[], recommendations[], medications: [{name, reason, dosage_note, in_catalog}], generated_at }`. The web's AI Notes tab renders: short summary, summary points, clinical impression, red flags (rose), recommendations, suggested tests; empty state "generated from the room once the call has a transcript".
`meeting_summary`: `{ key_takeaways: [{title, text}], sections: [{heading, overview, timestamp, points: [{text, subpoints[]}]}], action_items: [{person, items: [{text, timestamp}]}], generated_at, transcript_chunks }`. The Meeting Summary tab renders key takeaways, the sections with points and subpoints, action items per person, and the IST generated stamp.
Both exist only after the call; buttons for them are muted when the column is null and the row is not completed.

### 3.5 Next follow-up (read only for the doctor)
`next_follow_up`: `{ status: 'date' | 'not_decided', date: 'YYYY-MM-DD' | null, note, by, by_name, by_role, at, history[] }`. The Prescription tab shows one line "CRM follow-up plan: 15 Sep 2026 · note" or "Not decided yet" when present. Tolerate malformed values by treating them as not recorded (port `parseNextFollowUp` from `src/lib/consultationFollowUp.ts`).

### 3.6 Edge functions the doctor app calls
- `provision-consultation-room` POST `{slotId}` → `{meet_url, already?}` or `{error}`: retries the 100ms room for a booking whose link is missing (Generate Link). Needs the live user JWT: use the `invokeFn` pattern in `src/lib/doctorQueries.ts` (attach `getSession().access_token`, retry once on Unauthorized), wrapped in `invokeWithTimeout`.
- Nothing else. `consult-ai-notes` and `consult-meeting-summary` belong to the CRM's room; do not wire Generate buttons on the doctor side (the web removed them from the doctor on 2026-09-18).

### 3.7 View Reports data (the same three sources the web's `RecordsJourney` reads, newest first)
- `coach_assessment`: `select id, client_name, assessment_date, created_at, completed, mechanical_score, notes, qhp_data, new_client_assessment_data, existing_client_assessment_data` where `client_id = <client>` and `completed is not null`, ordered `assessment_date desc`. The QHP basic info lives at `(new|existing)_client_assessment_data['Standardized Assessment'].clientProfile.basicInfo` with keys `clientAge, clientGender, clientHeight, clientWeight` (never `age` / `gender`).
- `health_reports`: active rows for the client (`is_active`), `test_date desc`; `extracted_data.tests[].markers[] {name, value, unit, reference_range, status}`, `ai_analysis.analysis.scores {metabolic, longevity}`.
- `client_medical_history`: rows for the client, `event_date desc`; `attachments[] {file_name, file_path, file_url, file_type, uploaded_at}` in bucket `medical-history-files` (signed URL at tap time, port `resolveAttachmentUrl` from `ConsultationRoom.tsx`).
Reuse what `src/screens/doctorClientDetail.tsx` already renders for medical history, findings and reports rather than porting `RecordsJourney` line by line; the requirement is a timeline of the three sources with a detail view and a preview for attachments, and a QHP entry that opens the assessment summary.

### 3.8 Probes before building (publishable key from `src/lib/supabase.ts`, base `https://agtjszjedaenclbzgjvi.supabase.co`)
- `GET /rest/v1/doctor_consultation_details?select=id,prescription_approval,edit_history,ai_autogen_at&limit=1` must be 200 (an empty array is fine: RLS). A 400 naming a column means a migration is missing; stop and tell the user which.
- `POST /rest/v1/rpc/amend_prescription` with `{}` must not be PGRST202 (a 400 about arguments or a permission error is fine; 404 / PGRST202 means the RPC is missing).
- `POST /rest/v1/rpc/consultation_call_ended` with `{}` likewise.
- `GET /rest/v1/medicines?select=id,name,item_type&limit=1` 200.

## 4. Counting rules (port exactly; both surfaces must agree)
Active set = non-cancelled slots plus non-cancelled `medical_diagnosis` rows. Partition:
- **Upcoming**: slot `scheduled` and not elapsed; diagnosis `scheduled` whose `scheduled_at` is null or in the future.
- **Elapsed**: slot scheduled and elapsed; diagnosis scheduled with `scheduled_at` in the past.
- **Completed**: slot `completed`; diagnosis `completed`.
- **Pending requests**: diagnosis `pending`.
Dashboard figures: Scheduled card = upcoming count, with the sub-line "upcoming · N elapsed, not completed" when any elapsed, else "upcoming consultations". Consultations Done = completed this month (diagnosis by `completed_at ?? scheduled_at`, slot by `consultation_date`). Bell dot = pending requests + elapsed. Today: total = diagnosis rows with `scheduled_at` today + slots dated today; done = the completed ones of those; busyness donut = done ÷ total × 100 (0 when no total). My Plans Done bars over `total = active set size or 1`: Consultations completed, Scheduled (upcoming), Elapsed not completed (only when > 0), Pending requests (only when > 0); they add up to 100. All Calls tiles on the filtered set: Calls (non-cancelled), Scheduled ("still to happen · N elapsed"), Completed, With prescription (finalized Rx); cancelled rows stay in the list dimmed and are counted apart.

## 5. Screens, matching the web

Look and feel (the web's own shell, not the app's dark theme): canvas gradient `#f6f7fc → #f2f3fa → #eceef8` with soft indigo / violet glows; white cards `borderRadius 24` with a soft indigo shadow (`rgba(80,90,200,0.3)` at low opacity); the brand indigo `#5b6cf5` and its gradient `#5b6cf5 → #8a97ff`; text slate 800 / 500 / 400; status colours indigo (upcoming), amber (elapsed), emerald (completed), slate (cancelled), rose for red flags. Type: the app's Geogrotesque family. Phone layout as the web has since 2026-09-21: a fixed bottom pill (indigo gradient) with three round icons, Dashboard, All calls, Sign out, and content padded to clear it.

### 5.1 Consultant Dashboard (route `doctor-consultant-dashboard`)
Top bar: logo pill (indigo gradient), search box ("Search consultations", filters the day's list by client name or description), bell with a dot when the bell count > 0, live clock. Then:
- Greeting banner: indigo gradient, date chip "MMM d, yyyy · h:mm a", "Good Day, <doctor name>!", "Have a nice <weekday>!", a large faint stethoscope on the right. Under it, right-aligned, the existing Reimbursement entry (`go('doctor-reimbursements')`).
- Two stat cards: Scheduled (calendar icon on indigo) and Consultations Done (check on emerald), figures from section 4.
- My Scheduled Events (chip "Today"): the busyness donut (pink → violet → indigo sweep, "N% Busyness") beside "Consultations today" and "Completed today".
- My Plans Done (chip "Overall"): the bars from section 4, gradients indigo, pink, amber, slate.
- Right rail (stacked under on phones): My Profile card (gradient header, initials avatar, name, specialization or "Consultant", email, phone if any) and My Calendar card: the gradient header is a button that opens the month popup and shows the month name; a Sunday-first seven-day strip for the selected week (active day filled indigo, today's number indigo); below, the selected day's list: slot cards with a coloured left accent (indigo / amber / emerald), "h:mm a to h:mm a", Elapsed or Done pill, client name, description, and the buttons **Join Meet** (only when `meet_url` and scheduled), **Complete** (scheduled only), **View Reports**; then diagnosis rows (time, status dot, client, problem statement, no buttons). Empty state "No consultations this day." or "No consultations match your search."
- Month popup (`ConsultantCalendarDialog`): month grid, previous / next / Today, a count pill under every date that has consultations (indigo when any upcoming, emerald when all done, amber when one elapsed), a summary line "12 consultations · 8 done · 3 upcoming · 1 elapsed", and the chosen day's list with the same cards and buttons; picking a day also moves the dashboard's week strip.

### 5.2 All Calls (route `doctor-consultant-calls`)
Top bar (logo back to the dashboard, patient search, clock). Page head: eyebrow, title "All Calls", the doctor's name. Date filter as a segmented control: All time (default), Today, This week (Monday start), This month, Custom from / to; `consultation_date` compared as `yyyy-MM-dd` strings. Four KPI tiles (section 4). A Patients card: horizontally scrollable patient cards led by "All patients", each with initials, name, calls and finalized-Rx counts, "Last d MMM" (most recent call already held) or "Not seen yet", a sky "Next d MMM" chip for the earliest upcoming booking or an amber "N elapsed" chip; sorted latest activity first; tapping one filters the list ("Clear · name" chip resets). Then Calls newest first grouped by month, 10 a page with Page n of N and Previous / Next (filters reset to page 1), each row: coloured status bar, date block (dd / MMM), patient, status chip, Rx badge (Finalized vN / Draft / none), weekday and time range, description, and the buttons **Prescription** (reads "Empty prescription" when the call has no Rx content), **Meeting Summary** and **AI Notes** (shown only when `status === 'completed'`, muted when that column is null), **Reports**, **Complete** (scheduled only) and **Join** (the one filled button, when `meet_url` and scheduled).

### 5.3 Record popup (a full-screen sheet on phones)
Header: client name, status chip, Rx badge, **Download PDF** when a prescription exists; sub-line "EEE, d MMM yyyy · h:mm a to h:mm a · description". Tab strip Prescription / Meeting Summary / AI Notes as pills (scrolls sideways). Prescription tab: top-right **Edit prescription** ("Write prescription" when none) or the Approved badge; the read-only view: "Finalized vN · IST stamp" or "Draft · not finalized", "N earlier versions kept", the doctor, the patient line (name, DOB, age), medicine cards (name, strength, dose, frequency spelled out, timing, duration, instruction), tests as chips, advice bullets, "Follow up after N unit"; then the Edit history list; then the "CRM follow-up plan" line. The amend editor: medicine lines (catalog search or free text, strength, dose, frequency, timing, duration value + unit, SOS toggle, instruction, remove), tests (catalog or free text), advice lines, follow-up (value + unit), optional "Reason for the change", Cancel and "Save changes as vN+1" (or "Save as v1"), client-side validation from section 3.3, then `amend_prescription`; on success replace the row's `prescription` and `edit_history` in the list and the open sheet, toast "Prescription saved as vN". No autosave.

### 5.4 Download PDF
Build the clinic's dark sheet as HTML and print it with `expo-print` (`printToFileAsync({ html })`), then share with `expo-sharing` (add the dependency; it is not installed) or open it. Content mapping from the web `prescriptionPdf.ts`: NAME "Mr." / "Ms." + client name by the sex on file (the latest QHP's `basicInfo.clientGender`; no prefix when unknown); DATE `finalized_at` or `date` as dd-MMMM-yyyy; AGE and SEX from the prescription's frozen patient block; Medication Schedule rows (S.No, medicine + strength, SCHEDULE = DAILY for OD / BD / TDS / QID, NIGHTLY for HS, AS NEEDED for SOS, INSTRUCTIONS = the doctor's note or one sentence from dose, frequency, timing and duration such as "Two times a day after food for 4 weeks"); Additional Instructions = advice lines, then tests advised, then "Follow up after N unit"; the doctor signs as "DR. NAME" in capitals from the profile. Colours and layout as documented in the CRM file's PDF section (black page, blue frame, navy header band, orange bar, letter-spaced labels); content fidelity is mandatory, pixel parity is best effort. File name `Prescription_<client>_<yyyy-MM-dd>.pdf`.

### 5.5 Join (route `doctor-consultation-join`, phase 1)
Open `meet_url` in a full-screen `react-native-webview` with `mediaPlaybackRequiresUserAction={false}`, `allowsInlineMediaPlayback`, `javaScriptEnabled`, and an Android `onPermissionRequest` that grants camera and microphone (request `CAMERA` and `RECORD_AUDIO` with `expo-camera` / `expo-av`-free APIs: use `PermissionsAndroid` directly; never add `READ_MEDIA_IMAGES`). A Leave button in the app chrome closes the WebView, then calls `consultation_call_ended` and invalidates the slot keys; a toast names what is being generated. Add `android.permission.CAMERA` and `RECORD_AUDIO` to `app.json` if missing. State in the doc that transcription happens only when the doctor joins from the web.

## 6. Native data layer and rules
- New `src/lib/consultantQueries.ts`: `ConsultationSlot` type, `SLOT_SELECT`, `useDoctorConsultationSlots(uid)`, `useDoctorCalls(uid)`, `useConsultantConsultations(doctorName)`, `useUpdateSlotStatus()`, `useProvisionRoom()`, `useAmendPrescription()`, `useCallEnded()`, `useMedicinesCatalog()`, `isSlotElapsed`, `slotPersonName`, `rxState` (none | draft | finalized), `parseNextFollowUp`. Every call through `withTimeout` / `invokeWithTimeout` (`src/lib/withTimeout.ts`); mutations invalidate with the same key prefixes the web uses; use `invalidateDebounced` for the 60 s poll refresh if you add any listener.
- Query keys are per-user and cheap: do NOT add them to `PERSIST_PREFIXES`; nothing cached outside react-query.
- Sheets: `useKeyboardHeight` padding, sibling backdrop, `keyboardShouldPersistTaps`, hitSlop 10 or more, never nested modals; `Page` already adds keyboard height.
- Routes: add `doctor-consultant-dashboard`, `doctor-consultant-calls`, `doctor-consultation-join` to `src/Router.tsx` and all three to `SENSITIVE_ROUTES` (medical data and a live call). Nav: a consultant group in `src/data.ts` (`consultantNav`) selected in `chrome.tsx` when `isConsultant`; keep `doctorNav` for the others.
- Timestamps in IST (`Asia/Kolkata`) for stamps; `consultation_date` is a plain date and `start_time` / `end_time` plain times, format them from their parts; elapsed uses the device clock like the web.
- No em dashes in any user-facing copy. No client phone numbers on this surface.
- Port the exact web copy for buttons and empty states listed above.

## 7. Verification before you report done
- `npx tsc --noEmit` clean and a Metro Android export.
- The four probes in 3.8 pass.
- Device test as a consultant login (section 2): the dashboard figures match the web for the same doctor, a Complete flips `status` in SQL (`select id, status from doctor_consultation_details where id = '<slot>'`), an amend appends to `edit_history` and bumps `prescription->>'version'`, an approved prescription refuses the edit with "approved and locked", Join opens the 100ms page with camera and mic, Leave calls the RPC (`select ai_autogen_at from doctor_consultation_details where id = '<slot>'` moves), the PDF opens with the right name, date, medicines and instructions.
- Docs are mandatory: create `docs/features/android/doctor/consultant-dashboard.md` from `docs/features/_template.md` (all 10 sections, including what stays on the web), add the index line in `docs/features/README.md` under the Doctor section beside the web line, and note the sibling in the status line of `C:\Users\ADMIN\Desktop\b2b\docs\features\web\doctor\doctor-dashboard.md` (copy that file to hub-track `docs/features/web/doctor/doctor-dashboard.md` too). Dated change-log lines in both.
- Do not push; stop when tsc and the export pass and the doc is written, and report what was live-verified versus only built.

## 8. Web gotchas to carry over (so nobody "fixes" them differently on one platform)
- The diagnosis list matches by the doctor's display name, not id; a renamed profile changes the list.
- `meeting_summary` has no migration in the repo; it exists live.
- The slots realtime channel may be dead (table not in the publication); polling is the real refresh.
- Elapsed is device-local, so a doctor abroad sees different Elapsed states than IST.
- Complete writes `status` only; the CRM's next follow-up and the AI generation are independent of it.
- `ai_notes` and `meeting_summary` have no history; a regeneration overwrites. The doctor app never regenerates.
- The room itself trusts the route, not the viewer; the native Join only opens the prebuilt link, so it never grants the host code.
