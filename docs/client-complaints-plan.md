# Client complaints page for managers and the physio HOD: end-to-end plan (3 Nov 2026)

Status: BUILT 3 Nov 2026 (migration 20261104100000 LIVE the same day, 18 of 18; Android built, tsc + 46 rule checks + bundle clean; feature file docs/features/android/trainer/client-complaints.md; iOS handoff card 15). Web page not built. Revised again the same day (owner): the LIVE competition only, ongoing teams with no fallback batch and only complaints dated inside the competition (migration 20261104110000, LIVE 3 Nov 2026, 6 of 6). Originally: Owner (3 Nov 2026): "add to all managers' dashboards a Client complaints page
that shows only the complaints about trainers in that manager's team; the physio manager Anjana Rawat sees, on the
same page, every manager's team's complaints with a filter by manager name." Revised the same day: an INDIVIDUAL
page "Client complaints" (its own screen and drawer item), not a tab inside Managers Overview.

Source: the B2C (client app) handoff of 3 Nov 2026. Two client-side features already write into our Supabase project
and nothing on the staff side reads them yet:
1. **Inaccurate training logs** (since 21 Oct 2026): `training_sessions.log_review` jsonb, one per training,
   `{verdict: 'accurate' | 'inaccurate', at, issues: ['exercises' | 'reps' | 'loads' | 'duration'], note}`;
   `issues` and `note` only on an inaccurate one. The expert is `training_sessions.trainer_id`, the client
   `training_sessions.client_id`. Index `training_sessions_inaccurate_logs (trainer_id) WHERE verdict = 'inaccurate'`.
2. **Specialist reports** (since 14 Oct 2026; "an expert asked me to train, treat or pay outside Odds"): table
   `public.specialist_reports (id, client_id, trainer_id null when unmatched, trainer_name, schedule_session_id,
   note, source session_code | home | profile | page, status default 'new', reported_by, created_at)`. The app
   promises the client "Only Odds management reads your report. We never tell the expert." and "Once our management
   team confirms it, your next month is free." RLS: clients insert only; nobody selects today.

Live on 3 Nov 2026 (read-only probe): 139 reviewed trainings, 3 inaccurate (Jyoti Sharma, doctor, rehab sessions:
"No exercises mentioned", issue exercises; aarti Gupta, trainer, Strength "Full body": "I did only 2 sets of each
exercise except goblet squats", issue reps); both experts are in ongoing teams. `specialist_reports` is empty. Any
trainer can already read every `training_sessions` row (the existing broad SELECT policy), so the log review is not
a secret from the expert; the specialist report must stay one.

## 1. Who sees what (the rule)
- **A manager** (`profiles.managers`, the Managers Overview gate) sees the complaints about the members of the
  team(s) they manage or belong to, resolved the way the app already resolves "my team" (ongoing `manager_score`
  rows, else the latest batch). Members include doctors and therapists on the team.
- **The physio HOD** (`is_physio_hod(uid)`: `role_specialization` contains `physio_hod`; today that is the account
  Anjana Odds, `Anjanarawat@oddsfitness.com`, id `30df5c2b…`, not the other two Anjana profiles) sees every
  team's complaints with a **Manager** filter (All managers, one chip per manager with a current team, "No team"
  for experts in no current team and for reports whose expert could not be matched). Admin and super admin get the
  same all-teams view.
- **The expert never sees a report about themselves**: a manager who is the reported expert does not get that row;
  the HOD and admins do. Inaccurate logs are not hidden from the expert (they can read the row today anyway, and the
  expert needs to correct the log), but this page is for managers, not experts.
- Rows are never deleted or edited in the client's four keys. "Handled" is staff state kept next to them.

## 2. What the page shows
**One individual page, "Client complaints"** (owner, 3 Nov 2026: not a tab inside Managers Overview), screen
`client-complaints`, a drawer item **Client complaints** in every manager's nav (trainer, doctor, therapist and coach
navs, shown when `isManager`), in the doctor nav for the physio HOD (`isPhysioHod`) and in the admin nav. Title
"Client complaints", sub "Inaccurate logs and reports about your team" (managers) / "... about every team" (HOD,
admins). The drawer item carries a red dot while anything is open. Managers Overview is untouched (no new tab); its
header gets one small link "Client complaints · N open" that opens the page, nothing more.
- A manager with one team sees it at once; a manager on several teams gets a team chip row on top (the same chips
  Managers Overview uses) and "All my teams" as the default.
- The HOD and admins get the **Manager** filter row instead (All managers, one chip per manager with a current team,
  "No team").

Inside the page (`ClientComplaintsPanel`, the same component for every viewer):
- Segments **Inaccurate logs (N)** and **Reports (N)**; status chips **Open** (default) / **Handled** / **All**.
- **Inaccurate log card**: client name; expert name with role chip (TRAINER / DOCTOR / THERAPIST) and, in the
  all-teams view, "Team <manager>"; session line "29 Oct, 2:00 PM · Rehabilitation · Rehab Session"; issue chips
  EXERCISES / REPS / LOADS / DURATION (red); the client's note in quotes; "Flagged 2 Nov, 11:47 AM"; **As logged**
  (expands): the exercises as entered, one line each "Goblet Squat · 3 sets · 12, 12, 10 reps · 20 kg" from
  `workout_exercises` (by `training_sessions.workout_session_id = workout_exercises.session_id`; rehab or
  doctor sessions with no exercise rows show the session `notes` text, else "Nothing was logged for this session");
  button **Mark handled** → sheet: note (optional, 500 chars), toggle "The log was corrected", Save. A handled card
  is dimmed with "Handled by Priyanshu, 3 Nov · log corrected · <note>".
- **Report card** (reports segment, with a lock line "Never shown to the expert"): client name; expert name
  (role chip, or UNMATCHED when the client typed a name we could not match, then the typed name); source chip
  (SESSION CODE / HOME / PROFILE / PAGE); the linked session when there is one ("Session code line of 28 Oct,
  6:00 PM"); the client's note; "Reported 1 Nov, 9:12 PM"; status chip NEW / IN REVIEW / CONFIRMED, MONTH FREE /
  DISMISSED; buttons **Start review**, **Confirm (month free)**, **Dismiss**, each with an optional note; a handled
  card shows "Confirmed by Anjana, 3 Nov · <note>". Confirming writes only our status; crediting the free month is
  a billing action outside this page (say if you want a hook into the package ledger).
- Empty states: "No complaints about your team. Nothing flagged since 21 Oct 2026." / "No reports."
- Pull to refresh; the list is cached under a `manager-` key so it opens offline read-only; actions need a connection.

## 3. Backend (hub-track migration `20261104100000_client_complaints.sql`, the owner runs it)
All SECURITY DEFINER, revoked from PUBLIC / anon, granted to authenticated, refusals `COMPLAINT_CODE: sentence`.
- **Scope helper** `complaint_scope(p_viewer uuid, p_manager uuid DEFAULT NULL) RETURNS TABLE(expert_id uuid,
  manager_id uuid)`: admin / super_admin / physio HOD → every member of every current team (ongoing `manager_score`
  rows, else the latest `team_start` batch; the manager too) plus, when `p_manager` is set, only that manager's
  team; a manager → the members of the current teams they manage or belong to; anyone else → no rows
  (`COMPLAINT_FORBIDDEN: Only managers can see client complaints.`). Experts in no current team appear only for the
  all-teams viewers with `manager_id NULL` ("No team").
- `get_inaccurate_logs(p_status text DEFAULT 'open', p_manager uuid DEFAULT NULL, p_limit int DEFAULT 200)`
  RETURNS jsonb: rows where `log_review->>'verdict' = 'inaccurate'` and `trainer_id` in scope, newest
  `log_review->>'at'` first, `open` = no `staff_reviewed_at`; each row `{session_id, scheduled_at, session_type,
  session_name, expert {id, name, role}, team_manager {id, name} | null, client {id, name}, issues[], note, at,
  staff {reviewed_at, reviewed_by, reviewed_by_name, note, log_fixed} | null, logged: [{exercise, sets, reps[],
  loads[], duration_seconds, notes}] (from workout_exercises grouped by exercise, set order), session_notes}`.
- `get_specialist_reports(p_status text DEFAULT 'open', p_manager uuid DEFAULT NULL, p_limit int DEFAULT 200)`
  RETURNS jsonb: rows in scope (unmatched `trainer_id NULL` only for all-teams viewers), never a row whose
  `trainer_id` = the caller, newest first; `open` = status in (new, in_review); each row `{id, created_at, source,
  client {id, name}, expert {id, name, role} | null, trainer_name, team_manager | null, session {id, at, modality}
  | null, note, status, staff {handled_at, handled_by, handled_by_name, note}}`.
- `count_client_complaints()` RETURNS jsonb `{logs_open, reports_open}` for the tab badge and the drawer dot.
- `mark_log_review_handled(p_session uuid, p_note text, p_log_fixed boolean)`: merges
  `{staff_reviewed_at: now(), staff_reviewed_by: uid, staff_note, log_fixed}` into `log_review` with `||` (the
  client's four keys untouched; the B2C check constraint allows extra keys), only when the expert is in the caller's
  scope; a second call updates the staff keys. `unmark_log_review_handled(p_session)` removes the four staff keys.
- `set_specialist_report_status(p_id uuid, p_status text, p_note text)`: `status` in (new, in_review, confirmed,
  dismissed); writes `handled_by`, `handled_at`, `staff_note` (three new columns added by this migration with
  `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`; the B2C file created the table and granted staff nothing, so RLS stays
  closed and every staff read or write goes through these functions); refuses when the caller is the reported
  expert (`COMPLAINT_FORBIDDEN`).
- **Pushes** (staff_push_log, the existing sender `notify-essentials-unsold` reached through a thin
  `complaints_push(user_ids, title, body, data)` copy of `essentials_unsold_push`): trigger on
  `training_sessions` AFTER INSERT OR UPDATE OF log_review, when the verdict becomes `inaccurate` → the expert's
  current team manager(s) and, for a doctor or therapist, the physio HOD: title "Client flagged a log", body
  "Riya says Jyoti's rehab session of 29 Oct was not logged accurately (exercises). Tap to review.", data
  `{type: client_complaint, route: client-complaints, kind: log, session_id}`. Trigger on `specialist_reports`
  AFTER INSERT → the team manager(s) and the HOD, never the expert: title "New client report", body "A client
  reported Jyoti Sharma. Only management can read it." Admins are not pushed (they see the page). Pushes dedupe per
  row (`staff_push_log` unique on source + row id).
- Probe (rolled back, 12 checks): a manager sees their member's flag and not another team's; the HOD sees both and
  the manager filter narrows; a trainer gets `COMPLAINT_FORBIDDEN`; a report about the viewer is hidden from the
  manager and visible to the HOD; mark handled keeps the four client keys byte for byte; set status refuses a bad
  value; the pushes land in `staff_push_log` once; `count_client_complaints` matches the lists.

## 4. Android (odds-app)
- Rules `src/lib/clientComplaints.ts` (pure, copied to iOS): `ISSUE_LABEL`, `SOURCE_LABEL`, `STATUS_LABEL`,
  `issueChips`, `loggedLine` ("Goblet Squat · 3 sets · 12, 12, 10 reps · 20 kg"), `sessionLine`, `handledLine`,
  `reportStatusChip`, `isOpenLog`, `isOpenReport`, `filterByManager`, `countsOf`; test
  `tests/rules/client_complaints_test.js`.
- Data `src/lib/clientComplaintsQueries.ts`: `useInaccurateLogs(status, managerId, enabled)`,
  `useSpecialistReports(...)`, `useComplaintCounts()`, `useMarkLogHandled`, `useSetReportStatus`, every call through
  `withTimeout`; keys `['manager-client-complaints', kind, status, managerId]` (persisted), `['manager-complaint-counts']`;
  `invalidateDebounced` on a realtime subscription to `specialist_reports` INSERT and `training_sessions` UPDATE
  filtered by the team? (postgres_changes needs RLS to pass: training_sessions passes, specialist_reports does not;
  reports refresh on focus and after a push instead). PGRST202 (migration not run) → empty lists and no tab badge.
- UI: new screen `src/screens/clientComplaints.tsx` (the page: title, the team chips for a manager on several
  teams or the manager filter row for the HOD / admins, then `ClientComplaintsPanel`); `src/components/
  ClientComplaintsPanel.tsx` (segments, status chips, the two card kinds, the Mark handled sheet and the report
  action sheet; sheet rules: `useKeyboardHeight`, sibling backdrop, `keyboardShouldPersistTaps`, `hitSlop` 10, one
  Modal at a time); route `client-complaints` in `Router.tsx` (+ `SENSITIVE_ROUTES`: the notes are the client's
  words about their health and training); drawer item `{ label: 'Client complaints', icon: 'alert', route:
  'client-complaints' }` in `data.ts` for the trainer, doctor, therapist, coach and admin navs, gated in
  `chrome.tsx` like "Managers Overview" (`isManager`) or the HOD gate ("doctor-pending-approvals") or admin; the
  drawer dot from `useComplaintCounts`; `Managers()` in `trainer.tsx` gets only the small header link
  "Client complaints · N open" → `go('client-complaints')`.
- Push: `PushTokenManager` route `client-complaints` opens the page for everyone.
- Errors through `friendlyError`; `codedSentence` learns the `COMPLAINT_` prefix.
- Analytics: `Client Complaints Opened`, `Log Complaint Handled`, `Specialist Report Status Set`.

## 5. Web (hub-track), same RPCs
- One page `/trainer/client-complaints` (sidebar item "Client complaints" for `profiles.managers`, the HOD tag and
  admins; in-page guard), the same team chips / manager filter, cards and actions; Managers Overview gets the same
  small header link. No new tab anywhere.
- Recommended order: Android first (the managers use the app), web the same day after the app is verified; say if
  you want the web page in the first build or left out.

## 6. Edge cases
- An expert in two current teams: both managers see the flag; marking handled by one shows for both.
- The reported expert is a manager: the report is hidden from them, visible to the HOD and admins; the push for it
  skips them.
- A report with no matched expert: HOD / admin only, under "No team", labelled UNMATCHED with the typed name.
- Acknowledgements from before 21 Oct 2026 (`log_review` null, `session_acknowledged_at` set): never listed.
- The expert corrects the log: the app does not ask the client again (B2C rule); "The log was corrected" on our
  side is the manager's record. Say if you want a re-review request sent to the client (an app change on their side).
- A late-arriving review (outbox): the push and the list use `log_review->>'at'`, the client's time, not the arrival.
- Pre-21 Oct sessions reviewed later still count (the review date is what matters).
- Privacy: the specialist report is readable only through the two RPCs by managers of that team, the HOD and admins;
  the expert gets nothing, not even the count.

## 7. Build order and checks
1. Migration (PGlite probe with stub `training_sessions`, `specialist_reports`, `manager_score`, `profiles`,
   `clients`, `workout_exercises`, `staff_push_log`) + hand-over for the owner to run.
2. Android: rules + tests, queries, the page and its panel, drawer items and gates, route, the Managers Overview
   header link, push route; tsc, rule tests, bundle; APK on request.
3. Docs: new `docs/features/android/trainer/client-complaints.md` (+ README line), a change-log line in
   `managers-leaderboard.md` and `doctor-workspace` notes for the HOD entry; web file when built.
4. Live check as a manager (Priyanshu's team holds aarti Gupta's flag) and as Anjana Odds (both flags, the manager
   filter); mark one handled and unmark it; a probe insert into `specialist_reports` as a test client is NOT done on
   production (the table has real client promises attached); the report path is verified in PGlite and with the
   first real report.
5. iOS handoff: rules file byte for byte, the RPC contract, the panel's UI map and texts (card 15 on the copier).
