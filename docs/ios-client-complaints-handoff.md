# iOS handoff: Client complaints page for managers, the physio HOD and admins (3 Nov 2026)

Build iOS from this file alone. Section 1 is the feature file (rules, exact texts, the server contract), section 2 the
code generated from the finished Android files, section 3 the migration for reference (shared server, nothing to build
on iOS). Copy rule: no dashes in user-facing text (literal dashes inside copied code are written as \u2014 / \u2013
text; restore them when pasting).

## 0. In one paragraph
Two client-app features already write into the shared Supabase project: the client's review of the expert's log
(`training_sessions.log_review`: accurate or inaccurate with issues and a note) and a report of an expert who asked the
client to go outside Odds (`specialist_reports`, never shown to the expert). The staff app gets ONE individual page,
"Client complaints" (drawer item in every nav, shown to managers, the physio HOD and admins), with two segments
(Inaccurate logs, Reports), Open / Handled / All, cards with the log as entered, Mark handled (note + "log corrected"),
and the report status (in review / confirmed, month free / dismissed). A manager sees their current teams' experts;
the HOD and admins see every team with a manager filter; a report about the viewer is never returned. The server
(migration 20261104100000) scopes everything and pushes the team manager and the HOD when a flag or a report lands.

## 1. Feature file (rules, texts, server contract)

# Client complaints (android; the server contract is here too)

Status: built 3 Nov 2026 (tsc clean, rule test 46 checks, Android bundle clean); migration 20261104100000 PGlite-tested 21 of 21 and LIVE 3 Nov 2026 (18 of 18); not in a signed build yet · Last verified: 2026-11-03 (rule tests, PGlite, live read-only RPC check as a manager and the admin) · Sibling file: none yet (web page planned, same RPCs; see section 10)

## 1. Purpose and access
- The client app (B2C) lets a client review the expert's log after every training ("Accurately logged" / "Something's off" with issues and a note, since 21 Oct 2026) and report an expert who asked them to train, treat or pay outside Odds (since 14 Oct 2026, "Only Odds management reads your report. We never tell the expert."). This page is where managers read and handle both.
- Who sees it: the drawer item **Client complaints** (every nav) is shown by `chrome.tsx` when `caps.data.isManager || caps.data.isPhysioHod || dbRole in (admin, super_admin)` (plus the head-doctor id, as the other HOD surfaces). The server rule is `complaint_viewer_kind(uid)`: `all` for admin / super_admin / a `role_specialization` containing `physio_hod` (today Anjana Odds, `Anjanarawat@oddsfitness.com`, id `30df5c2b…`), `manager` for `profiles.managers`, nothing for anyone else (`COMPLAINT_FORBIDDEN`).
- A manager sees the complaints about the members of their LIVE competition teams (ongoing `manager_score` rows only; the manager included), dated inside that competition. The HOD and admins see every team with a manager filter. **A report about the viewer is never returned to them**, even to a manager who is the reported expert.
- Test accounts: Sagar (a manager with a team) for the team view; the admin account for the all-teams view. No HOD password.

## 2. Entry points
- Route `client-complaints` (`Router.tsx`, in `SENSITIVE_ROUTES`: the notes are the client's words about their training), screen `src/screens/clientComplaints.tsx` (`ClientComplaints`), drawer item `{ label: 'Client complaints', icon: 'alert', route: 'client-complaints' }` after Wallet in every nav of `src/data.ts`.
- Managers Overview (`Managers()` in `trainer.tsx`) shows one link "Client complaints · N open" under its header that opens the page; no tab was added (owner, 3 Nov 2026: an individual page).
- Push: data `{type: client_complaint, route: client-complaints, kind: log | report}` opens the page (`PushTokenManager`).
- Files: `src/components/ClientComplaintsPanel.tsx` (segments, status chips, the two cards, the Mark handled sheet, the report status sheet), `src/lib/clientComplaintsQueries.ts` (the three reads and three writes), `src/lib/clientComplaints.ts` (pure rules; test `tests/rules/client_complaints_test.js`), `src/lib/approvalRequests.ts` (`codedSentence` reads `COMPLAINT_` codes), hub-track migration `20261104100000_client_complaints.sql`.

## 3. UI map
- Title "Client complaints", sub "Inaccurate logs and reports about your team in the live competition" / "... about every team in the live competition". A grey note: "Clients review every log after a training and can report an expert who asked them to go outside Odds. Reports are never shown to the expert."
- All-teams viewers: a chip row **All managers**, one chip per manager seen in the rows (first name), **No team** (experts in no current team, reports the client could not match). A manager on several teams: **All my teams** + one chip per team (filters on the phone by the team's member ids).
- Pills **Inaccurate logs** (open count) / **Reports** (open count); status pills **Open** / **Handled** / **All**.
- Log card: client name; "about <expert>" + role chip (TRAINER / DOCTOR / THERAPIST / COACH); all-teams: "· Team <manager>" or "· No team"; chip OPEN (red) / HANDLED (green); "29 Oct, 2:00 PM · Rehabilitation · Rehab Session"; issue chips EXERCISES / REPS / LOADS / DURATION; the client's note in quotes; "Flagged 2 Nov, 11:47 AM"; **As logged by <first name>** expands to one line per exercise ("Goblet Squat · 3 sets · 12, 12, 10 reps · 20 kg"; duration based "Plank · 2 sets · 40 sec"; loads per set when they differ), else the session notes (rehab logs), else "Nothing was logged for this session."; **Mark handled** → sheet "Mark handled / <client> about <expert>": toggle "The log was corrected", note (500), Save; handled: "Handled by Priyanshu, 3 Nov · log corrected · <note>" with **Reopen** (confirm alert).
- Report card (violet): client name; "reported <expert>" + role chip, or the typed name with UNMATCHED; team line for all-teams; status chip NEW (red) / IN REVIEW (amber) / CONFIRMED, MONTH FREE (green) / DISMISSED (grey); source chip SESSION CODE / HOME / PROFILE / PAGE and "Session code line of 28 Oct, 6:00 PM · Strength" when linked; the note in quotes or "No note from the client."; "Reported 1 Nov, 9:12 PM"; lock line "Never shown to the expert. Only management reads this."; the handled line; button **Review** / **Decide** / **Change status** → sheet "Report status" with radio Start review / Confirm (month free) ("The free month is credited by billing, not here.") / Dismiss, a note, Save, "Reopen as new".
- Empty: "No flagged logs about your team in the live competition." / "No flagged logs in the live competition." (all teams) / "No handled flags yet." / "No reports." / "No handled reports yet." Offline: the cached lists, the sheets refuse with "No connection ...".

## 4. Data model
- Reads only through the RPCs (no table reads from the app). `training_sessions.log_review` jsonb `{verdict, at, issues[], note}` + the staff keys this page adds `{staff_reviewed_at, staff_reviewed_by, staff_note, log_fixed}` (the client's four keys are never changed; the B2C check constraint allows extra keys). `specialist_reports` + three columns added by the migration: `handled_by uuid, handled_at timestamptz, staff_note text`; `status` text `new | in_review | confirmed | dismissed` (validated in the RPC, no new constraint on the B2C table).
- Legacy acknowledgements (`log_review` null, `session_acknowledged_at` set, before 21 Oct 2026) never appear.

## 5. Backend contract
Every function SECURITY DEFINER; refusals `COMPLAINT_SIGN_IN` / `COMPLAINT_FORBIDDEN` / `COMPLAINT_NOT_FOUND` / `COMPLAINT_BAD_STATUS` as `CODE: sentence`.
| function | who | does |
|---|---|---|
| `complaint_viewer_kind(user)` | internal | `all` / `manager` / NULL |
| `complaint_current_teams()` | internal | (team_id, team_name, manager_id, member_id, is_manager, team_start, team_end) for the ONGOING teams only (since 20261104110000) |
| `complaint_in_window(at, start, end)` | internal | the complaint's moment falls inside the team's competition (IST days); no dates = no window |
| `complaint_scope(viewer, manager)` | internal | the (expert_id, manager_id) pairs the viewer may see; `manager` = narrow an all-teams viewer; the zero uuid = experts in no current team |
| `get_inaccurate_logs(p_status open\|handled\|all, p_manager, p_limit)` jsonb | authenticated | rows `{session_id, scheduled_at, session_type, session_name, expert{id,name,role}, team_manager{id,name}\|null, client{id,name}, issues[], note, at, staff{reviewed_at, reviewed_by, reviewed_by_name, note, log_fixed}\|null, logged[{exercise, sets, reps[], loads[], duration_seconds, notes}], session_notes}` newest `at` first; `logged` = `workout_exercises` where `session_id = training_sessions.workout_session_id`, grouped by exercise (rows of one save share `created_at`, so alphabetical within a save) |
| `get_specialist_reports(p_status, p_manager, p_limit)` jsonb | authenticated | rows `{id, created_at, source, client, expert\|null, trainer_name, team_manager\|null, session{id, at, modality}\|null, note, status, staff{handled_at, handled_by, handled_by_name, note}\|null}`; never `trainer_id = auth.uid()`; unmatched only for `all` viewers under all / no team |
| `count_client_complaints()` jsonb | authenticated | `{viewer, logs_open, reports_open}` |
| `mark_log_review_handled(p_session, p_note, p_log_fixed)` / `unmark_log_review_handled(p_session)` | authenticated, in scope | merges / removes the four staff keys |
| `set_specialist_report_status(p_id, p_status, p_note)` | authenticated, in scope, never the reported expert | status + `handled_by/at/staff_note` (`new` clears them); an unmatched report only by `all` viewers |
| `complaint_push_targets(expert)` | internal | the expert's current team manager(s) + the physio HOD for a doctor / therapist (or when the expert is unmatched), never the expert |
| `complaints_push(user_ids, title, body, data)` | internal | pg_net to `notify-essentials-unsold` (the generic staff push sender, writes `staff_push_log`); `SET complaints.silent = 'on'` skips it (the probe) |
| trigger `trg_log_review_flagged` (AFTER INSERT OR UPDATE OF log_review ON training_sessions, row) | | when the verdict becomes `inaccurate`: "Client flagged a log / Anjana says aarti's session of 28 Oct was not logged accurately (reps). Tap to review." data `{type client_complaint, route client-complaints, kind log, session_id}`; staff edits keep the verdict, so no second push; the body is wrapped: the client's write never fails |
| trigger `trg_specialist_report_new` (AFTER INSERT ON specialist_reports, row) | | "New client report / A client reported Jyoti Sharma. Only management can read it. Tap to review." `{kind report, report_id}` |
- RLS: nothing new. Staff still cannot read `specialist_reports` directly; trainers can still read every `training_sessions` row (the existing broad SELECT).

## 6. Business rules
- Open log = no `staff_reviewed_at`; open report = status new or in_review. Handled = the rest.
- **Live competition only (owner, 3 Nov 2026, later)**: `complaint_current_teams()` returns the ONGOING `manager_score` rows only (`team_start <= today <= team_end`, IST), no fallback to the last finished batch: a manager whose team is over sees nothing. Every list and count keeps only the complaints dated inside the live competition of the expert's team (`complaint_in_window(at, team_start, team_end)`: the client's `log_review.at` for a flag, `created_at` for a report, IST days); the flag push follows the same window. Experts in no live team ("No team", all-teams viewers only) and unmatched reports keep no window. Migration `20261104110000_client_complaints_live_only.sql`.
- An expert in two live teams shows for both managers; marking by one shows for both.
- The team chip on the phone filters by member ids of that team; the manager chips of an all-teams viewer re-query the server with `p_manager` (chips are built from the unfiltered lists so none disappears).
- Dates in IST ("29 Oct, 2:00 PM"). The push and the lists use `log_review.at` (the client's time), not the arrival time (offline outbox).
- Confirming a report records our status only; the free month is a billing step outside this page.

## 7. Cache and realtime
- `['manager-client-complaints', 'logs' | 'reports', uid, status, managerId]` (persisted by the `manager-` prefix, staleTime 60 s, refetch on mount), `['manager-complaint-counts', uid]`; the three writes invalidate both. No realtime (`specialist_reports` cannot pass RLS for a subscription; the pushes and pull to refresh cover it). PGRST202 (migration not run) = empty lists, zero counts, no error.

## 8. Gotchas
- `row` is a reserved word in Postgres: the list functions alias the built json as `j` (the first draft used `row` and failed to parse).
- `workout_exercises` has `reps_performed` / `load_performed` / `duration_seconds` (not `reps` / `load`); rehab and doctor sessions have no exercise rows, the session `notes` is the log.
- `training_sessions.client_id` is `clients.id` (the client also has a `profiles` row with the same id for the B2C app); names come from `clients`.
- One Modal at a time in the panel: the report sheet renders only while the log sheet is closed.

## 9. Verify recipe
- `node tests/rules/client_complaints_test.js` → ALL PASS (46). `npx tsc --noEmit` → exit 0.
- Migration in the SQL editor: 15 probe rows + 3 helpers, every result = expected (the probe flags a real member's unreviewed training inside a rolled-back block with the pushes silenced).
- Phone: as Sagar (manager) the drawer shows Client complaints; the page lists the flags about his team only; Mark handled → the card greys with the line; Reopen → back to Open. As the admin: every team, the manager chips, "No team". A trainer who is no manager has no drawer item and the route answers "Manager access required".

## 10. Change log
- 2026-11-03 (later): live competition only (owner): ongoing teams, no fallback batch, complaints dated inside the competition, the push too; migration `20261104110000` (PGlite, the owner runs it); page sub and empty lines say "in the live competition".
- 2026-11-03 (live): Live 3 Nov 2026: migration 20261104100000 ran (18 of 18 probe rows). Read-only RPC check through the same calls the screen makes: Sagar (a manager) gets counts {manager, 0 flags, 1 report} and the one report about a member of his team; the admin gets all 3 flags (two about Jyoti Sharma, rehab, no exercise rows so the session notes travel as the log; one about aarti Gupta, 6 logged exercises) and the 1 report, all under team Aastha; the manager filter returns the same 3, "No team" 0; no trainer-visible leak (the reports table stays closed).
- 2026-11-03: built (owner's plan `odds-app/docs/client-complaints-plan.md`; revised the same day to an individual page). Migration `20261104100000` PGlite 21 of 21, handed to the owner; rules + 46 checks; queries; panel; screen; drawer in every nav; Managers Overview link; push route; `COMPLAINT_` codes. Web page not built yet (same RPCs; `/trainer/client-complaints` planned). iOS handoff `odds-app/docs/ios-client-complaints-handoff.md` (card 15).

## 2. Code (generated from the Android tree)

### 2.1 New files in full

#### `src/lib/clientComplaints.ts`
Pure rules: parsing, labels, every card line, filters, counts. Copy byte for byte.

```ts
/* Client complaints (3 Nov 2026): the client app's two reviews of an expert, read by managers, the physio HOD and
   admins. Pure rules: parsing the server rows, the labels, every line of the two cards, the filters and counts.
   No React, no network; tested in node (tests/rules/client_complaints_test.js) and copied byte for byte to iOS.
   Server: hub-track migration 20261104100000 (get_inaccurate_logs, get_specialist_reports, count_client_complaints,
   mark_log_review_handled, unmark_log_review_handled, set_specialist_report_status). Plan: docs/client-complaints-plan.md. */

export type ComplaintStatusFilter = 'open' | 'handled' | 'all';
export type ComplaintKind = 'logs' | 'reports';
export type ViewerKind = 'all' | 'manager' | null;
export type Person = { id: string; name: string; role?: string | null };
export type LogIssue = 'exercises' | 'reps' | 'loads' | 'duration';
export type LoggedExercise = { exercise: string; sets: number; reps: (number | null)[]; loads: (string | null)[]; duration_seconds: number | null; notes: string | null };
export type InaccurateLog = {
  session_id: string;
  scheduled_at: string | null;
  session_type: string | null;
  session_name: string | null;
  expert: Person;
  team_manager: Person | null;
  client: Person;
  issues: LogIssue[];
  note: string | null;
  at: string | null;
  staff: { reviewed_at: string | null; reviewed_by: string | null; reviewed_by_name: string | null; note: string | null; log_fixed: boolean } | null;
  logged: LoggedExercise[];
  session_notes: string | null;
};
export type ReportStatus = 'new' | 'in_review' | 'confirmed' | 'dismissed';
export type ReportSource = 'session_code' | 'home' | 'profile' | 'page';
export type SpecialistReport = {
  id: string;
  created_at: string;
  source: ReportSource | string;
  client: Person;
  expert: Person | null;
  trainer_name: string;
  team_manager: Person | null;
  session: { id: string; at: string | null; modality: string | null } | null;
  note: string | null;
  status: ReportStatus;
  staff: { handled_at: string | null; handled_by: string | null; handled_by_name: string | null; note: string | null } | null;
};
export type ComplaintCounts = { viewer: ViewerKind; logs_open: number; reports_open: number };
/** The "no team" chip of the manager filter (all-teams viewers): the server's zero uuid. */
export const NO_TEAM_ID = '00000000-0000-0000-0000-000000000000';

const str = (v: unknown): string | null => (v == null ? null : String(v));
const num = (v: unknown, d = 0): number => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const person = (p: any, fallback = 'Unknown'): Person => ({ id: String(p?.id ?? ''), name: String(p?.name ?? '').trim() || fallback, role: str(p?.role) });

/* ---------- parsing ---------- */
export const parseInaccurateLog = (r: any): InaccurateLog | null => {
  if (!r || typeof r !== 'object' || !r.session_id) return null;
  const issues = (Array.isArray(r.issues) ? r.issues : []).map(String).filter((i: string): i is LogIssue => i === 'exercises' || i === 'reps' || i === 'loads' || i === 'duration');
  const st = r.staff && typeof r.staff === 'object' ? r.staff : null;
  return {
    session_id: String(r.session_id), scheduled_at: str(r.scheduled_at), session_type: str(r.session_type), session_name: str(r.session_name),
    expert: person(r.expert, 'Expert'), team_manager: r.team_manager && r.team_manager.id ? person(r.team_manager, 'Manager') : null, client: person(r.client, 'Client'),
    issues, note: str(r.note), at: str(r.at),
    staff: st ? { reviewed_at: str(st.reviewed_at), reviewed_by: str(st.reviewed_by), reviewed_by_name: str(st.reviewed_by_name), note: str(st.note), log_fixed: st.log_fixed === true } : null,
    logged: (Array.isArray(r.logged) ? r.logged : []).filter((e: any) => e && e.exercise).map((e: any) => ({
      exercise: String(e.exercise), sets: num(e.sets), reps: (Array.isArray(e.reps) ? e.reps : []).map((x: unknown) => (x == null ? null : num(x))),
      loads: (Array.isArray(e.loads) ? e.loads : []).map((x: unknown) => (x == null ? null : String(x))), duration_seconds: e.duration_seconds == null ? null : num(e.duration_seconds), notes: str(e.notes),
    })),
    session_notes: str(r.session_notes),
  };
};
export const parseSpecialistReport = (r: any): SpecialistReport | null => {
  if (!r || typeof r !== 'object' || !r.id) return null;
  const st = r.staff && typeof r.staff === 'object' ? r.staff : null;
  const status = r.status === 'in_review' || r.status === 'confirmed' || r.status === 'dismissed' ? r.status : 'new';
  return {
    id: String(r.id), created_at: String(r.created_at ?? ''), source: String(r.source ?? 'page'),
    client: person(r.client, 'Client'), expert: r.expert && r.expert.id ? person(r.expert, 'Expert') : null, trainer_name: String(r.trainer_name ?? '').trim(),
    team_manager: r.team_manager && r.team_manager.id ? person(r.team_manager, 'Manager') : null,
    session: r.session && r.session.id ? { id: String(r.session.id), at: str(r.session.at), modality: str(r.session.modality) } : null,
    note: str(r.note), status,
    staff: st ? { handled_at: str(st.handled_at), handled_by: str(st.handled_by), handled_by_name: str(st.handled_by_name), note: str(st.note) } : null,
  };
};
export const parseComplaintCounts = (d: any): ComplaintCounts => ({
  viewer: d?.viewer === 'all' || d?.viewer === 'manager' ? d.viewer : null,
  logs_open: num(d?.logs_open), reports_open: num(d?.reports_open),
});

/* ---------- labels ---------- */
export const ISSUE_LABEL: Record<LogIssue, string> = { exercises: 'EXERCISES', reps: 'REPS', loads: 'LOADS', duration: 'DURATION' };
export const SOURCE_LABEL: Record<string, string> = { session_code: 'SESSION CODE', home: 'HOME', profile: 'PROFILE', page: 'PAGE' };
export const sourceLabel = (s: string | null | undefined): string => SOURCE_LABEL[String(s ?? '')] ?? 'APP';
export const STATUS_LABEL: Record<ReportStatus, string> = { new: 'NEW', in_review: 'IN REVIEW', confirmed: 'CONFIRMED, MONTH FREE', dismissed: 'DISMISSED' };
export type Tone = 'green' | 'amber' | 'red' | 'grey' | 'blue';
export const reportStatusChip = (s: ReportStatus): { text: string; tone: Tone } =>
  s === 'confirmed' ? { text: STATUS_LABEL.confirmed, tone: 'green' } : s === 'dismissed' ? { text: STATUS_LABEL.dismissed, tone: 'grey' } : s === 'in_review' ? { text: STATUS_LABEL.in_review, tone: 'amber' } : { text: STATUS_LABEL.new, tone: 'red' };
export const roleChip = (role: string | null | undefined): string => {
  switch (String(role ?? '').toLowerCase()) {
    case 'trainer': return 'TRAINER';
    case 'doctor': return 'DOCTOR';
    case 'therapist': return 'THERAPIST';
    case 'coach': return 'COACH';
    case '': return 'EXPERT';
    default: return String(role).toUpperCase();
  }
};
export const firstName = (name: string | null | undefined): string => String(name ?? '').trim().split(/\s+/)[0] || 'Client';

/* ---------- dates (IST) ---------- */
const IST = 'Asia/Kolkata';
/** "29 Oct, 2:00 PM" */
export const fmtWhen = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = d.toLocaleDateString('en-IN', { timeZone: IST, day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('en-IN', { timeZone: IST, hour: 'numeric', minute: '2-digit', hour12: true }).replace(/ /g, ' ').replace(/\s*(am|pm)$/i, (m) => ' ' + m.trim().toUpperCase());
  return `${day}, ${time}`;
};
/** "29 Oct" */
export const fmtDay = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { timeZone: IST, day: 'numeric', month: 'short' });
};

/* ---------- card lines ---------- */
const modalityLabel = (t: string | null | undefined): string => {
  const k = String(t ?? '').trim();
  if (!k) return '';
  const MAP: Record<string, string> = { strength: 'Strength', rehabilitation: 'Rehabilitation', recovery: 'Recovery', physiotherapy: 'Physiotherapy', therapy: 'Therapy', yoga: 'Yoga', boxing: 'Boxing', pilates: 'Pilates', aerobics: 'Aerobics', 'aqua aerobics': 'Aqua Aerobics' };
  return MAP[k.toLowerCase()] ?? k.replace(/\b\w/g, (c) => c.toUpperCase());
};
/** "29 Oct, 2:00 PM · Rehabilitation · Rehab Session" */
export const sessionLine = (l: Pick<InaccurateLog, 'scheduled_at' | 'session_type' | 'session_name'>): string =>
  [fmtWhen(l.scheduled_at), modalityLabel(l.session_type), (l.session_name ?? '').trim()].filter(Boolean).join(' · ');
export const issueChips = (issues: LogIssue[]): string[] => issues.map((i) => ISSUE_LABEL[i]);
/** "Flagged 2 Nov, 11:47 AM" */
export const flaggedLine = (at: string | null): string => (at ? `Flagged ${fmtWhen(at)}` : 'Flagged');
const num0 = (n: number | null) => (n == null ? '-' : String(n));
/** "Goblet Squat · 3 sets · 12, 12, 10 reps · 20 kg" (one load when all sets share it, else per set); duration based: "Plank · 2 sets · 40 sec" */
export const loggedLine = (e: LoggedExercise): string => {
  const parts = [e.exercise, `${e.sets} set${e.sets === 1 ? '' : 's'}`];
  const reps = e.reps.filter((r) => r != null) as number[];
  if (reps.length) parts.push(`${e.reps.map(num0).join(', ')} rep${reps.length === 1 && reps[0] === 1 ? '' : 's'}`);
  else if (e.duration_seconds != null) parts.push(e.duration_seconds % 60 === 0 && e.duration_seconds >= 60 ? `${e.duration_seconds / 60} min` : `${e.duration_seconds} sec`);
  const loads = e.loads.filter((l) => l != null && String(l).trim() !== '' && String(l) !== '0') as string[];
  if (loads.length) {
    const uniq = [...new Set(loads)];
    parts.push(uniq.length === 1 ? `${uniq[0]} kg` : `${loads.join(', ')} kg`);
  }
  return parts.join(' · ');
};
/** The "As logged" block: the exercise lines, else the session notes, else the empty sentence. */
export const loggedBlock = (l: Pick<InaccurateLog, 'logged' | 'session_notes'>): { lines: string[]; notes: string | null; empty: string | null } => {
  if (l.logged.length) return { lines: l.logged.map(loggedLine), notes: null, empty: null };
  if (l.session_notes) return { lines: [], notes: l.session_notes, empty: null };
  return { lines: [], notes: null, empty: 'Nothing was logged for this session.' };
};
/** "Handled by Priyanshu, 3 Nov · log corrected · <note>" */
export const handledLine = (s: InaccurateLog['staff']): string | null => {
  if (!s) return null;
  const parts = [`Handled by ${firstName(s.reviewed_by_name) === 'Client' ? 'staff' : firstName(s.reviewed_by_name)}${s.reviewed_at ? `, ${fmtDay(s.reviewed_at)}` : ''}`];
  if (s.log_fixed) parts.push('log corrected');
  if (s.note) parts.push(s.note);
  return parts.join(' · ');
};
/** "Confirmed by Anjana, 3 Nov · <note>" / "Dismissed by ..." / "In review by ..." */
export const reportHandledLine = (r: Pick<SpecialistReport, 'status' | 'staff'>): string | null => {
  if (!r.staff || r.status === 'new') return null;
  const verb = r.status === 'confirmed' ? 'Confirmed' : r.status === 'dismissed' ? 'Dismissed' : 'In review';
  const who = firstName(r.staff.handled_by_name) === 'Client' ? 'staff' : firstName(r.staff.handled_by_name);
  const parts = [`${verb} by ${who}${r.staff.handled_at ? `, ${fmtDay(r.staff.handled_at)}` : ''}`];
  if (r.staff.note) parts.push(r.staff.note);
  return parts.join(' · ');
};
/** The expert line of a report: "Jyoti Sharma" with the role, or the typed name marked unmatched. */
export const reportExpert = (r: Pick<SpecialistReport, 'expert' | 'trainer_name'>): { name: string; chip: string; unmatched: boolean } =>
  r.expert ? { name: r.expert.name, chip: roleChip(r.expert.role), unmatched: false } : { name: r.trainer_name || 'Unknown expert', chip: 'UNMATCHED', unmatched: true };
/** "Session code line of 28 Oct, 6:00 PM · Strength" */
export const reportSessionLine = (r: Pick<SpecialistReport, 'session' | 'source'>): string | null => {
  if (!r.session) return null;
  const lead = r.source === 'session_code' ? 'Session code line of' : 'Session of';
  return [`${lead} ${fmtWhen(r.session.at)}`.trim(), modalityLabel(r.session.modality)].filter(Boolean).join(' · ');
};
export const REPORT_PRIVACY_LINE = 'Never shown to the expert. Only management reads this.';
export const EMPTY_LOGS_TEAM = 'No flagged logs about your team in the live competition.';
export const EMPTY_LOGS_ALL = 'No flagged logs in the live competition.';
export const EMPTY_REPORTS = 'No reports.';
export const emptyLine = (kind: ComplaintKind, allTeams: boolean, status: ComplaintStatusFilter): string => {
  if (kind === 'reports') return status === 'handled' ? 'No handled reports yet.' : EMPTY_REPORTS;
  if (status === 'handled') return 'No handled flags yet.';
  return allTeams ? EMPTY_LOGS_ALL : EMPTY_LOGS_TEAM;
};

/* ---------- filters and counts ---------- */
export const isOpenLog = (l: Pick<InaccurateLog, 'staff'>): boolean => !l.staff;
export const isOpenReport = (r: Pick<SpecialistReport, 'status'>): boolean => r.status === 'new' || r.status === 'in_review';
/** Keep the rows whose expert is in the given team (a manager on several teams picks one); null = every team. */
export const filterByTeam = <T extends { expert: Person | null }>(rows: T[], memberIds: string[] | null): T[] =>
  memberIds == null ? rows : rows.filter((r) => !!r.expert && memberIds.includes(r.expert.id));
/** The manager filter chips for an all-teams viewer: All managers, one per manager seen in the rows, No team last. */
export const managerChips = (rows: { team_manager: Person | null }[]): { id: string | null; label: string }[] => {
  const seen = new Map<string, string>();
  let noTeam = false;
  for (const r of rows) { if (r.team_manager) seen.set(r.team_manager.id, r.team_manager.name); else noTeam = true; }
  const out: { id: string | null; label: string }[] = [{ id: null, label: 'All managers' }];
  [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1])).forEach(([id, name]) => out.push({ id, label: firstName(name) }));
  if (noTeam) out.push({ id: NO_TEAM_ID, label: 'No team' });
  return out;
};
export const countsOf = (logs: InaccurateLog[], reports: SpecialistReport[]): { logsOpen: number; reportsOpen: number; total: number } => {
  const logsOpen = logs.filter(isOpenLog).length, reportsOpen = reports.filter(isOpenReport).length;
  return { logsOpen, reportsOpen, total: logsOpen + reportsOpen };
};
/** "3 open" for the Managers Overview link and the drawer dot. */
export const openLine = (c: ComplaintCounts | null | undefined): string => { const n = (c?.logs_open ?? 0) + (c?.reports_open ?? 0); return `${n} open`; };

/** The sentence after "COMPLAINT_CODE:" of a server refusal, else null. */
export const codedComplaintSentence = (e: unknown): string | null => {
  const msg = String((e as { message?: unknown } | null)?.message ?? '').trim();
  const m = msg.match(/^COMPLAINT_[A-Z_]+:\s*(.+)$/s);
  return m && m[1].trim() ? m[1].trim() : null;
};
```

#### `tests/rules/client_complaints_test.js`
Rule test (46 checks). Copy as is; run it first.

```js
// Rule test for the Odds staff app. ROOT = the repo root; point it at the iOS repo and run: node tests/rules/client_complaints_test.js
const ROOT = require("path").resolve(__dirname, "../..");
// Client complaints (3 Nov 2026): parsing, labels, card lines, filters, counts.
const ts = require(ROOT + '/node_modules/typescript');
const fs = require('fs');
const src = fs.readFileSync(ROOT + '/src/lib/clientComplaints.ts', 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const m = { exports: {} }; new Function('module', 'exports', 'require', js)(m, m.exports, require);
const X = m.exports;
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };

const raw = { session_id: 's1', scheduled_at: '2026-10-28T09:23:37.285Z', session_type: 'Strength', session_name: 'Full body',
  expert: { id: 'e1', name: 'aarti Gupta', role: 'trainer' }, team_manager: { id: 'm1', name: 'Priyanshu Arya' }, client: { id: 'c1', name: 'Anjana Rawat' },
  issues: ['reps', 'bogus'], note: 'I did only 2 sets of each exercise except goblet squats', at: '2026-10-28T13:23:12.169Z', staff: null,
  logged: [{ exercise: 'Goblet Squat', sets: 3, reps: [12, 12, 10], loads: ['20', '20', '20'], duration_seconds: null, notes: null }, { exercise: 'Plank', sets: 2, reps: [null, null], loads: [null, null], duration_seconds: 40, notes: 'hold' }],
  session_notes: null };
const log = X.parseInaccurateLog(raw);
// 1. parsing
eq('log: unknown issues dropped', log.issues, ['reps']);
eq('log: people', [log.expert.name, log.team_manager.name, log.client.name], ['aarti Gupta', 'Priyanshu Arya', 'Anjana Rawat']);
eq('log: bad row', X.parseInaccurateLog({ nope: 1 }), null);
eq('log: missing manager', X.parseInaccurateLog({ ...raw, team_manager: null }).team_manager, null);
const handled = X.parseInaccurateLog({ ...raw, staff: { reviewed_at: '2026-11-03T06:00:00Z', reviewed_by: 'm1', reviewed_by_name: 'Priyanshu Arya', note: 'Spoke to aarti', log_fixed: true } });
eq('log: staff parsed', [handled.staff.log_fixed, handled.staff.reviewed_by_name], [true, 'Priyanshu Arya']);
const rep = X.parseSpecialistReport({ id: 'r1', created_at: '2026-11-01T15:42:00Z', source: 'session_code', client: { id: 'c1', name: 'Riya S' }, expert: { id: 'e2', name: 'Jyoti Sharma', role: 'doctor' }, trainer_name: 'Jyoti Sharma', team_manager: null, session: { id: 'ss', at: '2026-10-28T12:30:00Z', modality: 'Strength' }, note: 'asked me to pay outside', status: 'new', staff: null });
eq('report: parsed', [rep.status, rep.expert.role, rep.session.modality], ['new', 'doctor', 'Strength']);
eq('report: unknown status is new', X.parseSpecialistReport({ id: 'r2', status: 'weird' }).status, 'new');
eq('counts parse', X.parseComplaintCounts({ viewer: 'manager', logs_open: '2', reports_open: 1 }), { viewer: 'manager', logs_open: 2, reports_open: 1 });
eq('counts parse: nobody', X.parseComplaintCounts(null), { viewer: null, logs_open: 0, reports_open: 0 });

// 2. lines
eq('session line', X.sessionLine(log), '28 Oct, 2:53 PM · Strength · Full body');
eq('session line: rehab', X.sessionLine({ scheduled_at: '2026-10-29T08:30:10Z', session_type: 'rehabilitation', session_name: 'Rehab Session' }), '29 Oct, 2:00 PM · Rehabilitation · Rehab Session');
eq('issue chips', X.issueChips(['exercises', 'reps', 'loads', 'duration']), ['EXERCISES', 'REPS', 'LOADS', 'DURATION']);
eq('flagged line', X.flaggedLine('2026-11-02T06:17:52.306Z'), 'Flagged 2 Nov, 11:47 AM');
eq('logged line: reps and one load', X.loggedLine(log.logged[0]), 'Goblet Squat · 3 sets · 12, 12, 10 reps · 20 kg');
eq('logged line: duration', X.loggedLine(log.logged[1]), 'Plank · 2 sets · 40 sec');
eq('logged line: loads per set', X.loggedLine({ exercise: 'Bench Press', sets: 2, reps: [10, 8], loads: ['40', '45'], duration_seconds: null, notes: null }), 'Bench Press · 2 sets · 10, 8 reps · 40, 45 kg');
eq('logged line: no load, missing rep', X.loggedLine({ exercise: 'Push Up', sets: 2, reps: [15, null], loads: ['0', null], duration_seconds: null, notes: null }), 'Push Up · 2 sets · 15, - reps');
eq('logged line: minutes', X.loggedLine({ exercise: 'Bike', sets: 1, reps: [], loads: [], duration_seconds: 600, notes: null }), 'Bike · 1 set · 10 min');
eq('logged block: lines', X.loggedBlock(log).lines.length, 2);
eq('logged block: notes', X.loggedBlock({ logged: [], session_notes: 'Category: Rehab' }), { lines: [], notes: 'Category: Rehab', empty: null });
eq('logged block: empty', X.loggedBlock({ logged: [], session_notes: null }).empty, 'Nothing was logged for this session.');
eq('handled line', X.handledLine(handled.staff), 'Handled by Priyanshu, 3 Nov · log corrected · Spoke to aarti');
eq('handled line: open', X.handledLine(null), null);
eq('handled line: no note, not fixed', X.handledLine({ reviewed_at: '2026-11-03T06:00:00Z', reviewed_by: 'm1', reviewed_by_name: 'Priyanshu Arya', note: null, log_fixed: false }), 'Handled by Priyanshu, 3 Nov');
eq('report status chips', [X.reportStatusChip('new'), X.reportStatusChip('in_review'), X.reportStatusChip('confirmed'), X.reportStatusChip('dismissed')],
  [{ text: 'NEW', tone: 'red' }, { text: 'IN REVIEW', tone: 'amber' }, { text: 'CONFIRMED, MONTH FREE', tone: 'green' }, { text: 'DISMISSED', tone: 'grey' }]);
eq('report expert', X.reportExpert(rep), { name: 'Jyoti Sharma', chip: 'DOCTOR', unmatched: false });
eq('report expert: unmatched', X.reportExpert({ expert: null, trainer_name: 'Some Guy' }), { name: 'Some Guy', chip: 'UNMATCHED', unmatched: true });
eq('report session line: code', X.reportSessionLine(rep), 'Session code line of 28 Oct, 6:00 PM · Strength');
eq('report session line: none', X.reportSessionLine({ session: null, source: 'home' }), null);
eq('report handled line', X.reportHandledLine({ status: 'confirmed', staff: { handled_at: '2026-11-03T06:00:00Z', handled_by: 'h', handled_by_name: 'Anjana Odds', note: 'Verified' } }), 'Confirmed by Anjana, 3 Nov · Verified');
eq('report handled line: new', X.reportHandledLine({ status: 'new', staff: null }), null);
eq('source labels', [X.sourceLabel('session_code'), X.sourceLabel('home'), X.sourceLabel('profile'), X.sourceLabel('page'), X.sourceLabel('x')], ['SESSION CODE', 'HOME', 'PROFILE', 'PAGE', 'APP']);
eq('role chips', [X.roleChip('trainer'), X.roleChip('doctor'), X.roleChip('therapist'), X.roleChip(null)], ['TRAINER', 'DOCTOR', 'THERAPIST', 'EXPERT']);
eq('empty lines', [X.emptyLine('logs', false, 'open'), X.emptyLine('logs', true, 'open'), X.emptyLine('logs', false, 'handled'), X.emptyLine('reports', true, 'open')],
  ['No flagged logs about your team in the live competition.', 'No flagged logs in the live competition.', 'No handled flags yet.', 'No reports.']);

// 3. filters and counts
const logs = [log, handled, X.parseInaccurateLog({ ...raw, session_id: 's3', expert: { id: 'e3', name: 'Other', role: 'doctor' }, team_manager: { id: 'm2', name: 'Zed Manager' } })];
const reps = [rep, X.parseSpecialistReport({ id: 'r3', status: 'dismissed', client: { id: 'c', name: 'C' }, expert: null, trainer_name: 'Typed', team_manager: null, staff: { handled_at: null, handled_by: null, handled_by_name: null, note: null } })];
eq('open log / report', [X.isOpenLog(log), X.isOpenLog(handled), X.isOpenReport(rep), X.isOpenReport(reps[1])], [true, false, true, false]);
eq('filter by team', X.filterByTeam(logs, ['e1']).map((l) => l.session_id), ['s1', 's1']);
eq('filter by team: null = all', X.filterByTeam(logs, null).length, 3);
eq('filter by team: no expert', X.filterByTeam(reps, ['e2']).map((r) => r.id), ['r1']);
eq('manager chips', X.managerChips([...logs, ...reps]), [{ id: null, label: 'All managers' }, { id: 'm1', label: 'Priyanshu' }, { id: 'm2', label: 'Zed' }, { id: X.NO_TEAM_ID, label: 'No team' }]);
eq('manager chips: none', X.managerChips([]), [{ id: null, label: 'All managers' }]);
eq('counts', X.countsOf(logs, reps), { logsOpen: 2, reportsOpen: 1, total: 3 });
eq('open line', [X.openLine({ viewer: 'manager', logs_open: 2, reports_open: 1 }), X.openLine(null)], ['3 open', '0 open']);
eq('coded sentence', X.codedComplaintSentence(new Error('COMPLAINT_FORBIDDEN: Only managers can see client complaints.')), 'Only managers can see client complaints.');
eq('coded sentence: other', X.codedComplaintSentence(new Error('Network request failed')), null);

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
```

#### `src/lib/clientComplaintsQueries.ts`
Data: the three reads and three writes (definer RPCs), cache keys, PGRST202 = empty.

```ts
/* Client complaints data (3 Nov 2026): the two lists, the counts and the three writes, all definer RPCs of
   hub-track migration 20261104100000. The server decides the scope (a manager's teams, or every team for the
   physio HOD and admins); the app only filters the rows it got by team or manager chip. Lists are cached under a
   `manager-` key so the page opens offline read-only; the writes need a connection. PGRST202 (migration not run)
   reads as empty lists and zero counts. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { withTimeout, NET_MS } from './withTimeout';
import { useAuth } from '../auth';
import {
  parseInaccurateLog, parseSpecialistReport, parseComplaintCounts,
  type InaccurateLog, type SpecialistReport, type ComplaintCounts, type ComplaintStatusFilter, type ReportStatus,
} from './clientComplaints';

export const COMPLAINTS_KEY = 'manager-client-complaints';
export const COMPLAINT_COUNTS_KEY = ['manager-complaint-counts'] as const;

const missing = (error: any) => error?.code === 'PGRST202' || /could not find the function/i.test(String(error?.message ?? ''));
async function rpc<T>(name: string, args: Record<string, unknown>, label: string): Promise<T> {
  const { data, error } = await withTimeout(Promise.resolve((supabase.rpc as any)(name, args)) as Promise<{ data: any; error: any }>, NET_MS, label);
  if (error) throw Object.assign(new Error(error.message ?? label), { code: error.code });
  return data as T;
}

export function useInaccurateLogs(status: ComplaintStatusFilter, managerId: string | null, enabled = true) {
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;
  return useQuery({
    queryKey: [COMPLAINTS_KEY, 'logs', uid, status, managerId],
    enabled: !!uid && enabled,
    staleTime: 60_000,
    refetchOnMount: true,
    queryFn: async (): Promise<InaccurateLog[]> => {
      try {
        const d = await rpc<any[]>('get_inaccurate_logs', { p_status: status, p_manager: managerId, p_limit: 200 }, 'Client complaints');
        return (Array.isArray(d) ? d : []).map(parseInaccurateLog).filter(Boolean) as InaccurateLog[];
      } catch (e: any) { if (missing(e)) return []; throw e; }
    },
  });
}

export function useSpecialistReports(status: ComplaintStatusFilter, managerId: string | null, enabled = true) {
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;
  return useQuery({
    queryKey: [COMPLAINTS_KEY, 'reports', uid, status, managerId],
    enabled: !!uid && enabled,
    staleTime: 60_000,
    refetchOnMount: true,
    queryFn: async (): Promise<SpecialistReport[]> => {
      try {
        const d = await rpc<any[]>('get_specialist_reports', { p_status: status, p_manager: managerId, p_limit: 200 }, 'Client complaints');
        return (Array.isArray(d) ? d : []).map(parseSpecialistReport).filter(Boolean) as SpecialistReport[];
      } catch (e: any) { if (missing(e)) return []; throw e; }
    },
  });
}

/** {viewer, logs_open, reports_open}: the drawer dot, the Managers Overview link and the page header. */
export function useComplaintCounts(enabled = true) {
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;
  return useQuery({
    queryKey: [...COMPLAINT_COUNTS_KEY, uid],
    enabled: !!uid && enabled,
    staleTime: 60_000,
    refetchOnMount: true,
    retry: 1,
    queryFn: async (): Promise<ComplaintCounts> => {
      try { return parseComplaintCounts(await rpc<any>('count_client_complaints', {}, 'Client complaints')); }
      catch (e: any) { if (missing(e)) return { viewer: null, logs_open: 0, reports_open: 0 }; throw e; }
    },
  });
}

const useInvalidateComplaints = () => {
  const qc = useQueryClient();
  return () => { qc.invalidateQueries({ queryKey: [COMPLAINTS_KEY] }); qc.invalidateQueries({ queryKey: [...COMPLAINT_COUNTS_KEY] }); };
};

export function useMarkLogHandled() {
  const inv = useInvalidateComplaints();
  return useMutation({
    mutationFn: async (r: { sessionId: string; note: string; logFixed: boolean }) =>
      rpc<any>('mark_log_review_handled', { p_session: r.sessionId, p_note: r.note.trim() || null, p_log_fixed: r.logFixed }, 'Mark handled'),
    onSettled: inv,
  });
}
export function useUnmarkLogHandled() {
  const inv = useInvalidateComplaints();
  return useMutation({
    mutationFn: async (r: { sessionId: string }) => rpc<any>('unmark_log_review_handled', { p_session: r.sessionId }, 'Reopen'),
    onSettled: inv,
  });
}
export function useSetReportStatus() {
  const inv = useInvalidateComplaints();
  return useMutation({
    mutationFn: async (r: { id: string; status: ReportStatus; note: string }) =>
      rpc<any>('set_specialist_report_status', { p_id: r.id, p_status: r.status, p_note: r.note.trim() || null }, 'Report status'),
    onSettled: inv,
  });
}
```

#### `src/components/ClientComplaintsPanel.tsx`
The panel: pills, the two cards, the Mark handled sheet, the report status sheet.

```tsx
/* Client complaints panel (3 Nov 2026): the two segments (Inaccurate logs, Reports), the status chips, the cards,
   the Mark handled sheet and the report action sheet. One component for every viewer; the screen around it decides
   the scope chips (a manager's teams, or the manager filter for the physio HOD and admins). Sheet rules: one Modal at
   a time, sibling backdrop, useKeyboardHeight, keyboardShouldPersistTaps, hitSlop 10. */
import React from 'react';
import { View, Text, Pressable, TextInput, Modal, ScrollView, ActivityIndicator, Alert, Keyboard, Switch } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono } from './primitives';
import { useKeyboardHeight } from '../lib/useKeyboardHeight';
import { useIsOnline } from '../lib/offline';
import { friendlyError } from '../lib/friendlyError';
import { trackEvent } from '../lib/amplitude';
import {
  type InaccurateLog, type SpecialistReport, type ComplaintKind, type ComplaintStatusFilter, type ReportStatus, type Tone,
  sessionLine, issueChips, flaggedLine, loggedBlock, handledLine, reportStatusChip, roleChip, reportExpert, reportSessionLine,
  reportHandledLine, sourceLabel, fmtWhen, emptyLine, codedComplaintSentence, REPORT_PRIVACY_LINE,
} from '../lib/clientComplaints';
import { useMarkLogHandled, useUnmarkLogHandled, useSetReportStatus } from '../lib/clientComplaintsQueries';

const toneColor = (t: Tone) => (t === 'green' ? C.green : t === 'amber' ? C.gold : t === 'red' ? C.red : t === 'blue' ? C.blue : C.muted);
const errText = (e: unknown, fallback: string) => codedComplaintSentence(e) ?? friendlyError(e, fallback);

function Chip({ text, tone = 'grey' }: { text: string; tone?: Tone }) {
  const col = toneColor(tone);
  return (
    <View style={{ paddingVertical: 2.5, paddingHorizontal: 8, borderRadius: 999, backgroundColor: hexA(col, 0.14), borderWidth: 1, borderColor: hexA(col, 0.45) }}>
      <Text style={{ fontFamily: F.bodyBold, fontSize: 9.5, color: col, letterSpacing: 0.6 }}>{text}</Text>
    </View>
  );
}
function Pill({ text, active, count, onPress }: { text: string; active: boolean; count?: number | null; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} accessibilityRole="button" accessibilityState={{ selected: active }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 13, borderRadius: 999, backgroundColor: active ? hexA(C.orange, 0.13) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.orange, 0.3) : 'rgba(255,255,255,0.07)' }}>
      <Text style={{ fontFamily: active ? F.bodySemi : F.body, fontSize: 12.5, color: active ? C.orange : C.muted }}>{text}</Text>
      {count ? <Text style={{ fontFamily: F.mono, fontSize: 11, color: active ? C.orange : C.muted2 }}>{count}</Text> : null}
    </Pressable>
  );
}

/* ---------- the Mark handled sheet ---------- */
function HandleLogSheet({ target, onClose }: { target: InaccurateLog | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const kbH = useKeyboardHeight();
  const online = useIsOnline();
  const m = useMarkLogHandled();
  const [note, setNote] = React.useState('');
  const [fixed, setFixed] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  React.useEffect(() => { if (target) { setNote(''); setFixed(false); setErr(null); } else Keyboard.dismiss(); }, [target]);
  const save = async () => {
    if (!target || m.isPending) return;
    try {
      await m.mutateAsync({ sessionId: target.session_id, note, logFixed: fixed });
      trackEvent('Log Complaint Handled', { session_id: target.session_id, log_fixed: fixed, has_note: !!note.trim() });
      onClose();
    } catch (e) { setErr(errText(e, 'Could not save. Try again.')); }
  };
  return (
    <Modal visible={!!target} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.64)' }} />
        <View accessibilityViewIsModal style={{ backgroundColor: C.sheetBg, borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.16)', paddingHorizontal: 18, paddingTop: 14, paddingBottom: 14 + insets.bottom + kbH, gap: 12 }}>
          <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center' }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
            <View style={{ flex: 1 }}>
              <Serif style={{ fontSize: 19 }}>Mark handled</Serif>
              <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 2 }}>{target ? `${target.client.name} about ${target.expert.name}` : ''}</Body>
            </View>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close" style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)' }}>
              <Icon name="close" size={14} color={C.muted} strokeWidth={2.2} />
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 12 }}>
            <Pressable onPress={() => setFixed((f) => !f)} hitSlop={6} accessibilityRole="switch" accessibilityState={{ checked: fixed }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: '#fff' }}>The log was corrected</Text>
                <Body style={{ fontSize: 11, color: C.muted2, marginTop: 2 }}>The expert fixed the session log after this flag.</Body>
              </View>
              <Switch value={fixed} onValueChange={setFixed} trackColor={{ true: hexA(C.green, 0.6), false: 'rgba(255,255,255,0.15)' }} thumbColor={fixed ? C.green : '#ccc'} />
            </Pressable>
            <View style={{ gap: 6 }}>
              <Mono style={{ fontSize: 9.5, letterSpacing: 1.3, color: C.muted2 }}>NOTE (OPTIONAL)</Mono>
              <TextInput value={note} onChangeText={(t) => setNote(t.slice(0, 500))} placeholder="What was done, e.g. spoke to the expert, sets corrected" placeholderTextColor={C.muted3} multiline
                style={{ minHeight: 64, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.03)', color: '#fff', fontFamily: F.body, fontSize: 13, textAlignVertical: 'top' }} />
            </View>
            {err ? <Body style={{ fontSize: 11.5, color: C.red }}>{err}</Body> : null}
            {!online ? <Body style={{ fontSize: 11.5, color: C.gold }}>No connection. Marking needs the network.</Body> : null}
            <Pressable onPress={save} disabled={!online || m.isPending} accessibilityRole="button" style={{ paddingVertical: 14, borderRadius: 13, alignItems: 'center', backgroundColor: online ? C.orange : 'rgba(255,255,255,0.1)', opacity: m.isPending ? 0.6 : 1 }}>
              {m.isPending ? <ActivityIndicator color="#fff" /> : <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: '#fff' }}>Save</Text>}
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/* ---------- the report action sheet ---------- */
const ACTIONS: { status: ReportStatus; label: string; blurb: string; tone: Tone }[] = [
  { status: 'in_review', label: 'Start review', blurb: 'Management is looking into it.', tone: 'amber' },
  { status: 'confirmed', label: 'Confirm (month free)', blurb: 'The report stands. The free month is credited by billing, not here.', tone: 'green' },
  { status: 'dismissed', label: 'Dismiss', blurb: 'Nothing to act on.', tone: 'grey' },
];
function ReportActionSheet({ target, onClose }: { target: SpecialistReport | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const kbH = useKeyboardHeight();
  const online = useIsOnline();
  const m = useSetReportStatus();
  const [note, setNote] = React.useState('');
  const [pick, setPick] = React.useState<ReportStatus | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  React.useEffect(() => { if (target) { setNote(target.staff?.note ?? ''); setPick(target.status === 'new' ? null : target.status); setErr(null); } else Keyboard.dismiss(); }, [target]);
  const save = async () => {
    if (!target || !pick || m.isPending) return;
    try {
      await m.mutateAsync({ id: target.id, status: pick, note });
      trackEvent('Specialist Report Status Set', { report_id: target.id, status: pick, has_note: !!note.trim() });
      onClose();
    } catch (e) { setErr(errText(e, 'Could not save. Try again.')); }
  };
  const reopen = async () => {
    if (!target || m.isPending) return;
    try { await m.mutateAsync({ id: target.id, status: 'new', note: '' }); onClose(); } catch (e) { setErr(errText(e, 'Could not reopen. Try again.')); }
  };
  return (
    <Modal visible={!!target} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.64)' }} />
        <View accessibilityViewIsModal style={{ backgroundColor: C.sheetBg, borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.16)', paddingHorizontal: 18, paddingTop: 14, paddingBottom: 14 + insets.bottom + kbH, gap: 12 }}>
          <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center' }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
            <View style={{ flex: 1 }}>
              <Serif style={{ fontSize: 19 }}>Report status</Serif>
              <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 2 }}>{target ? `${target.client.name} about ${reportExpert(target).name}` : ''}</Body>
            </View>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close" style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)' }}>
              <Icon name="close" size={14} color={C.muted} strokeWidth={2.2} />
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 10 }}>
            {ACTIONS.map((a) => {
              const on = pick === a.status;
              const col = toneColor(a.tone);
              return (
                <Pressable key={a.status} onPress={() => setPick(a.status)} hitSlop={4} accessibilityRole="radio" accessibilityState={{ selected: on }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: 12, borderRadius: 13, backgroundColor: on ? hexA(col, 0.14) : 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: on ? hexA(col, 0.6) : 'rgba(255,255,255,0.08)' }}>
                  <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: on ? col : C.muted3, alignItems: 'center', justifyContent: 'center' }}>
                    {on ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: col }} /> : null}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: on ? '#fff' : C.ink }}>{a.label}</Text>
                    <Body style={{ fontSize: 10.5, color: C.muted2, marginTop: 1 }}>{a.blurb}</Body>
                  </View>
                </Pressable>
              );
            })}
            <View style={{ gap: 6 }}>
              <Mono style={{ fontSize: 9.5, letterSpacing: 1.3, color: C.muted2 }}>NOTE (OPTIONAL)</Mono>
              <TextInput value={note} onChangeText={(t) => setNote(t.slice(0, 500))} placeholder="For the management record only" placeholderTextColor={C.muted3} multiline
                style={{ minHeight: 56, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.03)', color: '#fff', fontFamily: F.body, fontSize: 13, textAlignVertical: 'top' }} />
            </View>
            {err ? <Body style={{ fontSize: 11.5, color: C.red }}>{err}</Body> : null}
            {!online ? <Body style={{ fontSize: 11.5, color: C.gold }}>No connection. Changing the status needs the network.</Body> : null}
            <Pressable onPress={save} disabled={!online || !pick || m.isPending} accessibilityRole="button" style={{ paddingVertical: 14, borderRadius: 13, alignItems: 'center', backgroundColor: online && pick ? C.orange : 'rgba(255,255,255,0.1)', opacity: m.isPending ? 0.6 : 1 }}>
              {m.isPending ? <ActivityIndicator color="#fff" /> : <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: '#fff' }}>Save</Text>}
            </Pressable>
            {target && target.status !== 'new' ? (
              <Pressable onPress={reopen} disabled={!online || m.isPending} hitSlop={8} accessibilityRole="button" style={{ alignSelf: 'center', paddingVertical: 6 }}>
                <Body style={{ fontSize: 12, color: C.muted, textDecorationLine: 'underline' }}>Reopen as new</Body>
              </Pressable>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/* ---------- cards ---------- */
function LogCard({ l, allTeams, onHandle, onReopen }: { l: InaccurateLog; allTeams: boolean; onHandle: () => void; onReopen: () => void }) {
  const [open, setOpen] = React.useState(false);
  const handled = !!l.staff;
  const block = loggedBlock(l);
  return (
    <View style={{ padding: 14, borderRadius: 18, gap: 9, backgroundColor: handled ? 'rgba(255,255,255,0.02)' : 'rgba(50,30,19,0.42)', borderWidth: 1, borderColor: handled ? 'rgba(255,255,255,0.06)' : hexA(C.red, 0.3), opacity: handled ? 0.8 : 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: '#fff' }}>{l.client.name}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 3 }}>
            <Body style={{ fontSize: 12, color: C.ink3 }}>about {l.expert.name}</Body>
            <Chip text={roleChip(l.expert.role)} tone="blue" />
            {allTeams && l.team_manager ? <Body style={{ fontSize: 11, color: C.muted2 }}>· Team {l.team_manager.name.split(' ')[0]}</Body> : allTeams ? <Body style={{ fontSize: 11, color: C.muted2 }}>· No team</Body> : null}
          </View>
        </View>
        <Chip text={handled ? 'HANDLED' : 'OPEN'} tone={handled ? 'green' : 'red'} />
      </View>
      <Body style={{ fontSize: 12, color: C.muted }}>{sessionLine(l)}</Body>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {issueChips(l.issues).map((c) => <Chip key={c} text={c} tone="red" />)}
      </View>
      {l.note ? <Body style={{ fontSize: 13, color: C.ink, lineHeight: 18 }}>"{l.note}"</Body> : null}
      <Body style={{ fontSize: 10.5, color: C.muted3 }}>{flaggedLine(l.at)}</Body>
      <Pressable onPress={() => setOpen((o) => !o)} hitSlop={8} accessibilityRole="button" accessibilityState={{ expanded: open }} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Icon name={open ? 'chevUp' : 'chevDown'} size={13} color={C.gold} strokeWidth={2.4} />
        <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: C.gold }}>As logged by {l.expert.name.split(' ')[0]}</Text>
      </Pressable>
      {open ? (
        <View style={{ gap: 4, padding: 10, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.25)' }}>
          {block.lines.map((t, i) => <Body key={i} style={{ fontSize: 12, color: C.ink2, lineHeight: 17 }}>· {t}</Body>)}
          {block.notes ? <Body style={{ fontSize: 12, color: C.ink2, lineHeight: 17 }}>{block.notes}</Body> : null}
          {block.empty ? <Body style={{ fontSize: 12, color: C.muted2 }}>{block.empty}</Body> : null}
        </View>
      ) : null}
      {handled ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Body style={{ flex: 1, fontSize: 11.5, color: C.green }}>{handledLine(l.staff)}</Body>
          <Pressable onPress={onReopen} hitSlop={8} accessibilityRole="button"><Body style={{ fontSize: 11.5, color: C.muted, textDecorationLine: 'underline' }}>Reopen</Body></Pressable>
        </View>
      ) : (
        <Pressable onPress={onHandle} hitSlop={6} accessibilityRole="button" style={{ alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10, backgroundColor: hexA(C.orange, 0.16), borderWidth: 1, borderColor: hexA(C.orange, 0.5) }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: C.orange }}>Mark handled</Text>
        </Pressable>
      )}
    </View>
  );
}

function ReportCard({ r, allTeams, onAct }: { r: SpecialistReport; allTeams: boolean; onAct: () => void }) {
  const chip = reportStatusChip(r.status);
  const ex = reportExpert(r);
  const sl = reportSessionLine(r);
  const hl = reportHandledLine(r);
  const closed = r.status === 'confirmed' || r.status === 'dismissed';
  return (
    <View style={{ padding: 14, borderRadius: 18, gap: 9, backgroundColor: closed ? 'rgba(255,255,255,0.02)' : 'rgba(76,52,140,0.22)', borderWidth: 1, borderColor: closed ? 'rgba(255,255,255,0.06)' : hexA('#A78BFA', 0.4), opacity: closed ? 0.85 : 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: '#fff' }}>{r.client.name}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 3 }}>
            <Body style={{ fontSize: 12, color: C.ink3 }}>reported {ex.name}</Body>
            <Chip text={ex.chip} tone={ex.unmatched ? 'amber' : 'blue'} />
            {allTeams ? <Body style={{ fontSize: 11, color: C.muted2 }}>· {r.team_manager ? `Team ${r.team_manager.name.split(' ')[0]}` : 'No team'}</Body> : null}
          </View>
        </View>
        <Chip text={chip.text} tone={chip.tone} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
        <Chip text={sourceLabel(r.source)} />
        {sl ? <Body style={{ fontSize: 11.5, color: C.muted }}>{sl}</Body> : null}
      </View>
      {r.note ? <Body style={{ fontSize: 13, color: C.ink, lineHeight: 18 }}>"{r.note}"</Body> : <Body style={{ fontSize: 12, color: C.muted2 }}>No note from the client.</Body>}
      <Body style={{ fontSize: 10.5, color: C.muted3 }}>Reported {fmtWhen(r.created_at)}</Body>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Icon name="lock" size={11} color={C.muted3} strokeWidth={2} />
        <Body style={{ flex: 1, fontSize: 10.5, color: C.muted3 }}>{REPORT_PRIVACY_LINE}</Body>
      </View>
      {hl ? <Body style={{ fontSize: 11.5, color: r.status === 'confirmed' ? C.green : C.muted }}>{hl}</Body> : null}
      <Pressable onPress={onAct} hitSlop={6} accessibilityRole="button" style={{ alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10, backgroundColor: hexA('#A78BFA', 0.16), borderWidth: 1, borderColor: hexA('#A78BFA', 0.5) }}>
        <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: '#A78BFA' }}>{closed ? 'Change status' : r.status === 'in_review' ? 'Decide' : 'Review'}</Text>
      </Pressable>
    </View>
  );
}

/* ---------- the panel ---------- */
export function ClientComplaintsPanel({ logs, reports, logsQ, reportsQ, allTeams, kind, onKind, status, onStatus, counts }: {
  logs: InaccurateLog[]; reports: SpecialistReport[];
  logsQ: { isPending: boolean; isError: boolean; error: unknown; refetch: () => void };
  reportsQ: { isPending: boolean; isError: boolean; error: unknown; refetch: () => void };
  allTeams: boolean;
  kind: ComplaintKind; onKind: (k: ComplaintKind) => void;
  status: ComplaintStatusFilter; onStatus: (s: ComplaintStatusFilter) => void;
  counts: { logsOpen: number; reportsOpen: number };
}) {
  const [handle, setHandle] = React.useState<InaccurateLog | null>(null);
  const [act, setAct] = React.useState<SpecialistReport | null>(null);
  const unmark = useUnmarkLogHandled();
  const online = useIsOnline();
  const q = kind === 'logs' ? logsQ : reportsQ;
  const list = kind === 'logs' ? logs : reports;
  const reopen = (l: InaccurateLog) => {
    if (!online) { Alert.alert('No connection', 'Reopening needs the network.'); return; }
    Alert.alert('Reopen this flag?', 'It goes back to Open for the team.', [
      { text: 'Keep handled', style: 'cancel' },
      { text: 'Reopen', onPress: async () => { try { await unmark.mutateAsync({ sessionId: l.session_id }); } catch (e) { Alert.alert('Could not reopen', errText(e, 'Try again.')); } } },
    ]);
  };
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Pill text="Inaccurate logs" active={kind === 'logs'} count={counts.logsOpen || null} onPress={() => onKind('logs')} />
        <Pill text="Reports" active={kind === 'reports'} count={counts.reportsOpen || null} onPress={() => onKind('reports')} />
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {(['open', 'handled', 'all'] as ComplaintStatusFilter[]).map((s) => <Pill key={s} text={s === 'open' ? 'Open' : s === 'handled' ? 'Handled' : 'All'} active={status === s} onPress={() => onStatus(s)} />)}
      </View>
      {q.isPending ? (
        <View style={{ alignItems: 'center', paddingVertical: 30 }}><ActivityIndicator color={C.orange} /></View>
      ) : q.isError ? (
        <View style={{ padding: 12, borderRadius: 12, backgroundColor: hexA(C.red, 0.08), borderWidth: 1, borderColor: hexA(C.red, 0.28), gap: 8 }}>
          <Body style={{ fontSize: 12, color: '#E0A090' }}>{errText(q.error, 'Could not load client complaints. Pull to refresh.')}</Body>
          <Pressable onPress={() => q.refetch()} hitSlop={8} accessibilityRole="button"><Body style={{ fontSize: 12, color: C.orange, textDecorationLine: 'underline' }}>Try again</Body></Pressable>
        </View>
      ) : list.length === 0 ? (
        <View style={{ alignItems: 'center', gap: 8, paddingVertical: 34 }}>
          <Icon name="checks" size={24} color={C.muted3} strokeWidth={1.8} />
          <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingHorizontal: 24 }}>{emptyLine(kind, allTeams, status)}</Body>
        </View>
      ) : kind === 'logs' ? (
        logs.map((l) => <LogCard key={l.session_id} l={l} allTeams={allTeams} onHandle={() => setHandle(l)} onReopen={() => reopen(l)} />)
      ) : (
        reports.map((r) => <ReportCard key={r.id} r={r} allTeams={allTeams} onAct={() => setAct(r)} />)
      )}
      {/* one Modal at a time: the report sheet renders only while the log sheet is closed */}
      <HandleLogSheet target={handle} onClose={() => setHandle(null)} />
      {!handle ? <ReportActionSheet target={act} onClose={() => setAct(null)} /> : null}
    </View>
  );
}
```

#### `src/screens/clientComplaints.tsx`
The page: gate, team chips (a manager on several teams) or the manager filter row (HOD / admins), the panel.

```tsx
/* Client complaints (3 Nov 2026): the individual page for managers, the physio HOD and admins. The server scopes the
   rows (a manager's current teams; every team for the HOD and admins); this screen adds the team chips for a manager
   on several teams, or the manager filter row for the all-teams viewers, and hands the rows to the panel.
   Plan: docs/client-complaints-plan.md. */
import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Body } from '../components/primitives';
import { Page, TitleBlock, HScroll } from './common';
import { useAuth } from '../auth';
import { useMyCapabilities } from '../lib/capabilities';
import { useManagerTeam } from '../lib/trainerQueries';
import { useTrainerId } from './trainer';
import { trackEvent } from '../lib/amplitude';
import { ClientComplaintsPanel } from '../components/ClientComplaintsPanel';
import { useInaccurateLogs, useSpecialistReports, useComplaintCounts } from '../lib/clientComplaintsQueries';
import { filterByTeam, managerChips, countsOf, type ComplaintKind, type ComplaintStatusFilter } from '../lib/clientComplaints';

export function ClientComplaints() {
  const { dbRole } = useAuth();
  const caps = useMyCapabilities();
  const uid = useTrainerId();
  const isAdmin = dbRole === 'admin' || dbRole === 'super_admin';
  const allTeams = isAdmin || caps.data.isPhysioHod;
  const allowed = allTeams || caps.data.isManager;
  const [kind, setKind] = React.useState<ComplaintKind>('logs');
  const [status, setStatus] = React.useState<ComplaintStatusFilter>('open');
  const [managerId, setManagerId] = React.useState<string | null>(null); // all-teams viewers: the manager chip
  const [teamId, setTeamId] = React.useState<string | null>(null);       // a manager on several teams: the team chip
  const teamsQ = useManagerTeam(allowed && !allTeams ? uid : '');
  const teams = teamsQ.data?.teams ?? [];
  const logsQ = useInaccurateLogs(status, allTeams ? managerId : null, allowed);
  const reportsQ = useSpecialistReports(status, allTeams ? managerId : null, allowed);
  const countsQ = useComplaintCounts(allowed);
  React.useEffect(() => { if (allowed) trackEvent('Client Complaints Opened', { all_teams: allTeams }); }, [allowed, allTeams]);

  const memberIds = teamId ? (teams.find((t) => t.id === teamId)?.members.map((m) => m.id) ?? null) : null;
  const logs = filterByTeam(logsQ.data ?? [], memberIds);
  const reports = filterByTeam(reportsQ.data ?? [], memberIds);
  // Chips are built from the "all" lists so a filter never hides the other chips; counts for the pills come from the server.
  const chips = allTeams ? managerChips([...(logsQ.data ?? []), ...(reportsQ.data ?? [])]) : [];
  const counts = { logsOpen: countsQ.data?.logs_open ?? countsOf(logs, reports).logsOpen, reportsOpen: countsQ.data?.reports_open ?? countsOf(logs, reports).reportsOpen };

  if (!caps.isLoading && !allowed) {
    return (
      <Page gap={16} pt={6}>
        <TitleBlock title="Client complaints" sub="Manager access required" />
        <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 30 }}>This page is only available to managers, the physio HOD and admins.</Body>
      </Page>
    );
  }
  return (
    <Page gap={14} pt={6}>
      <TitleBlock title="Client complaints" sub={allTeams ? 'Inaccurate logs and reports about every team in the live competition' : 'Inaccurate logs and reports about your team in the live competition'} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' }}>
        <Icon name="alert" size={15} color={C.gold} strokeWidth={2.1} />
        <Body style={{ flex: 1, fontSize: 11.5, color: C.ink3, lineHeight: 16 }}>Clients review every log after a training and can report an expert who asked them to go outside Odds. Reports are never shown to the expert.</Body>
      </View>
      {allTeams && chips.length > 1 ? (
        <HScroll>
          {chips.map((c) => {
            const active = managerId === c.id;
            return (
              <Pressable key={c.id ?? 'all'} onPress={() => setManagerId(c.id)} hitSlop={6} accessibilityRole="button" accessibilityState={{ selected: active }}
                style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: active ? hexA(C.orange, 0.14) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.orange, 0.35) : 'rgba(255,255,255,0.07)' }}>
                <Text style={{ fontFamily: active ? F.bodyBold : F.body, fontSize: 12.5, color: active ? C.orange : C.muted }}>{c.label}</Text>
              </Pressable>
            );
          })}
        </HScroll>
      ) : null}
      {!allTeams && teams.length > 1 ? (
        <HScroll>
          {[{ id: null as string | null, teamName: 'All my teams' }, ...teams.map((t) => ({ id: t.id as string | null, teamName: t.teamName }))].map((t) => {
            const active = teamId === t.id;
            return (
              <Pressable key={t.id ?? 'all'} onPress={() => setTeamId(t.id)} hitSlop={6} accessibilityRole="button" accessibilityState={{ selected: active }}
                style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: active ? hexA(C.orange, 0.14) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.orange, 0.35) : 'rgba(255,255,255,0.07)' }}>
                <Text style={{ fontFamily: active ? F.bodyBold : F.body, fontSize: 12.5, color: active ? C.orange : C.muted }}>{t.teamName}</Text>
              </Pressable>
            );
          })}
        </HScroll>
      ) : null}
      <ClientComplaintsPanel logs={logs} reports={reports} logsQ={logsQ} reportsQ={reportsQ} allTeams={allTeams} kind={kind} onKind={setKind} status={status} onStatus={setStatus} counts={counts} />
    </Page>
  );
}
```

### 2.2 Edited files: `git diff -U4` against 39d5c16 (the tree before this feature)

Route + SENSITIVE_ROUTES, the drawer item after Wallet in every nav, the drawer gate, the push route, the `COMPLAINT_` code prefix, the Managers Overview header link.

```diff

```

## 3. Server for reference (nothing to build on iOS)

#### `supabase/migrations/20261104100000_client_complaints.sql`

```sql
-- ============================================================================
-- Client complaints for managers and the physio HOD (3 Nov 2026)
-- Owner: "a Client complaints page on every manager's dashboard showing only the complaints about the experts in that
-- manager's team; the physio manager (Anjana) sees every team's complaints with a filter by manager name." Revised the
-- same day: an individual page, not a tab. Plan: odds-app/docs/client-complaints-plan.md.
--
-- Two client-app features (B2C handoff of 3 Nov 2026) already write here and nothing on the staff side read them:
--   1. training_sessions.log_review jsonb {verdict accurate|inaccurate, at, issues[], note}: the client's review of the
--      expert's log (since 21 Oct 2026). The expert = trainer_id. Any trainer can read the row already.
--   2. public.specialist_reports: a client reports an expert who asked them to go outside Odds (since 14 Oct 2026).
--      The app promises "Only Odds management reads your report. We never tell the expert." RLS: clients insert only.
--
-- This file: a) three staff columns on specialist_reports (handled_by, handled_at, staff_note); b) the scope rule
-- (complaint_viewer_kind / complaint_current_teams); c) the reads get_inaccurate_logs, get_specialist_reports,
-- count_client_complaints; d) the writes mark_log_review_handled / unmark_log_review_handled (staff keys merged into
-- the same json, the client's four keys never touched) and set_specialist_report_status; e) pushes to the team
-- manager(s) and the physio HOD when a flag or a report lands (never to the expert), through the existing staff push
-- sender; f) a rolled-back probe (14 checks). The client's writes can never fail because of the triggers (every
-- trigger body is wrapped). Refusals: COMPLAINT_CODE: sentence.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Staff columns on the reports (the B2C file created the table and granted staff nothing; RLS stays closed, every
--    staff read and write goes through the functions below)
-- ---------------------------------------------------------------------------
ALTER TABLE public.specialist_reports
  ADD COLUMN IF NOT EXISTS handled_by uuid,
  ADD COLUMN IF NOT EXISTS handled_at timestamptz,
  ADD COLUMN IF NOT EXISTS staff_note text;
CREATE INDEX IF NOT EXISTS specialist_reports_trainer_idx ON public.specialist_reports (trainer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS specialist_reports_status_idx ON public.specialist_reports (status, created_at DESC);

-- ---------------------------------------------------------------------------
-- 2. Who may see what
-- ---------------------------------------------------------------------------
/** "all" for admin / super_admin / the physio HOD (every team, a manager filter), "manager" for profiles.managers,
    NULL for everyone else. */
CREATE OR REPLACE FUNCTION public.complaint_viewer_kind(p_user uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN p.role::text IN ('admin', 'super_admin') THEN 'all'
    WHEN p.role_specialization::text ILIKE '%physio_hod%' THEN 'all'
    WHEN p.managers THEN 'manager'
    ELSE NULL END
  FROM public.profiles p WHERE p.id = p_user
$$;
REVOKE ALL ON FUNCTION public.complaint_viewer_kind(uuid) FROM PUBLIC, anon, authenticated;

/** The current competition teams the way the apps resolve "my team": ongoing manager_score rows (team_end null or
    today or later, team_start today or earlier), else the latest team_start batch. One row per person per team, the
    manager included (is_manager true). */
CREATE OR REPLACE FUNCTION public.complaint_current_teams()
RETURNS TABLE(team_id uuid, team_name text, manager_id uuid, member_id uuid, is_manager boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH today AS (SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS d),
  ongoing AS (
    SELECT ms.* FROM public.manager_score ms, today
     WHERE ms.team_start <= today.d AND (ms.team_end IS NULL OR ms.team_end >= today.d)
  ),
  chosen AS (
    SELECT * FROM ongoing
    UNION ALL
    SELECT ms.* FROM public.manager_score ms
     WHERE NOT EXISTS (SELECT 1 FROM ongoing)
       AND ms.team_start = (SELECT max(team_start) FROM public.manager_score)
  )
  SELECT c.id, c.team_name, c.manager_id, c.manager_id, true FROM chosen c WHERE c.manager_id IS NOT NULL
  UNION
  SELECT c.id, c.team_name, c.manager_id, (m.value #>> '{}')::uuid, false
    FROM chosen c, jsonb_array_elements(CASE WHEN jsonb_typeof(c.team_json) = 'array' THEN c.team_json ELSE '[]'::jsonb END) m
   WHERE (m.value #>> '{}') ~* '^[0-9a-f-]{36}$'
$$;
REVOKE ALL ON FUNCTION public.complaint_current_teams() FROM PUBLIC, anon, authenticated;

/** The experts a viewer may see complaints about, with the team manager each one sits under (NULL = no current
    team; only "all" viewers get those). p_manager narrows an "all" viewer to one manager's team; the zero uuid means
    "no team". A manager always gets the members (and managers) of the current teams they manage or belong to. */
CREATE OR REPLACE FUNCTION public.complaint_scope(p_viewer uuid, p_manager uuid DEFAULT NULL)
RETURNS TABLE(expert_id uuid, manager_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_kind text := public.complaint_viewer_kind(p_viewer);
BEGIN
  IF v_kind IS NULL THEN RETURN; END IF;
  IF v_kind = 'manager' THEN
    RETURN QUERY
      SELECT DISTINCT t.member_id, t.manager_id FROM public.complaint_current_teams() t
       WHERE t.team_id IN (SELECT t2.team_id FROM public.complaint_current_teams() t2 WHERE t2.member_id = p_viewer);
    RETURN;
  END IF;
  -- "all": every member of every current team (narrowed to one manager when asked), plus every staff profile that
  -- sits in no current team (manager NULL) when nothing or "no team" is asked.
  RETURN QUERY
    SELECT DISTINCT t.member_id, t.manager_id FROM public.complaint_current_teams() t
     WHERE p_manager IS NULL OR t.manager_id = p_manager
    UNION
    SELECT p.id, NULL::uuid FROM public.profiles p
     WHERE (p_manager IS NULL OR p_manager = '00000000-0000-0000-0000-000000000000'::uuid)
       AND p.role::text IN ('trainer', 'doctor', 'therapist', 'coach')
       AND NOT EXISTS (SELECT 1 FROM public.complaint_current_teams() t WHERE t.member_id = p.id);
END;
$$;
REVOKE ALL ON FUNCTION public.complaint_scope(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.complaint_name(p_first text, p_last text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(NULLIF(btrim(COALESCE(p_first, '') || ' ' || COALESCE(p_last, '')), ''), 'Unknown')
$$;

-- ---------------------------------------------------------------------------
-- 3. The reads
-- ---------------------------------------------------------------------------
/** The flagged logs the caller may see. p_status: open (not yet handled by staff), handled, all. */
CREATE OR REPLACE FUNCTION public.get_inaccurate_logs(p_status text DEFAULT 'open', p_manager uuid DEFAULT NULL, p_limit integer DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_kind text := public.complaint_viewer_kind(v_uid);
  v_rows jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'COMPLAINT_SIGN_IN: Sign in to see client complaints.' USING ERRCODE = '42501'; END IF;
  IF v_kind IS NULL THEN RAISE EXCEPTION 'COMPLAINT_FORBIDDEN: Only managers can see client complaints.' USING ERRCODE = '42501'; END IF;
  SELECT COALESCE(jsonb_agg(j ORDER BY (j->>'at') DESC NULLS LAST), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'session_id', ts.id,
      'scheduled_at', ts.scheduled_at,
      'session_type', ts.session_type,
      'session_name', ts.session_name,
      'expert', jsonb_build_object('id', e.id, 'name', public.complaint_name(e.first_name, e.last_name), 'role', e.role::text),
      'team_manager', CASE WHEN s.manager_id IS NULL THEN NULL ELSE jsonb_build_object('id', m.id, 'name', public.complaint_name(m.first_name, m.last_name)) END,
      'client', jsonb_build_object('id', ts.client_id, 'name', COALESCE(public.complaint_name(c.first_name, c.last_name), 'Client')),
      'issues', COALESCE(ts.log_review->'issues', '[]'::jsonb),
      'note', ts.log_review->>'note',
      'at', ts.log_review->>'at',
      'staff', CASE WHEN ts.log_review ? 'staff_reviewed_at' THEN jsonb_build_object(
                 'reviewed_at', ts.log_review->>'staff_reviewed_at', 'reviewed_by', ts.log_review->>'staff_reviewed_by',
                 'reviewed_by_name', (SELECT public.complaint_name(h.first_name, h.last_name) FROM public.profiles h WHERE h.id::text = ts.log_review->>'staff_reviewed_by'),
                 'note', ts.log_review->>'staff_note', 'log_fixed', COALESCE((ts.log_review->>'log_fixed')::boolean, false))
               ELSE NULL END,
      'logged', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('exercise', x.exercise_name, 'sets', x.sets, 'reps', x.reps, 'loads', x.loads,
                                            'duration_seconds', x.duration_seconds, 'notes', x.notes) ORDER BY x.first_set, x.exercise_name) -- rows of one save share created_at: alphabetical within a save
          FROM (SELECT w.exercise_name, count(*) AS sets,
                       jsonb_agg(w.reps_performed ORDER BY w.set_number) AS reps,
                       jsonb_agg(w.load_performed ORDER BY w.set_number) AS loads,
                       max(w.duration_seconds) AS duration_seconds,
                       max(w.exercise_notes) AS notes,
                       min(w.created_at) AS first_set
                  FROM public.workout_exercises w
                 WHERE ts.workout_session_id IS NOT NULL AND w.session_id = ts.workout_session_id
                 GROUP BY w.exercise_name) x), '[]'::jsonb),
      'session_notes', NULLIF(btrim(COALESCE(ts.notes, '')), '')
    ) AS j
    FROM public.training_sessions ts
    JOIN (SELECT DISTINCT ON (sc.expert_id) sc.expert_id, sc.manager_id FROM public.complaint_scope(v_uid, p_manager) sc ORDER BY sc.expert_id, sc.manager_id NULLS LAST) s ON s.expert_id = ts.trainer_id
    LEFT JOIN public.profiles e ON e.id = ts.trainer_id
    LEFT JOIN public.profiles m ON m.id = s.manager_id
    LEFT JOIN public.clients c ON c.id = ts.client_id
    WHERE ts.log_review->>'verdict' = 'inaccurate'
      AND (COALESCE(p_status, 'open') = 'all'
           OR (p_status = 'handled' AND ts.log_review ? 'staff_reviewed_at')
           OR (COALESCE(p_status, 'open') = 'open' AND NOT (ts.log_review ? 'staff_reviewed_at')))
    ORDER BY (ts.log_review->>'at') DESC NULLS LAST
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 200), 500))
  ) q;
  RETURN v_rows;
END;
$$;
REVOKE ALL ON FUNCTION public.get_inaccurate_logs(text, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_inaccurate_logs(text, uuid, integer) TO authenticated, service_role;

/** The reports the caller may see. Never a report about the caller. p_status: open (new, in_review), handled
    (confirmed, dismissed), all. Unmatched experts (trainer_id null) only for "all" viewers under "no team". */
CREATE OR REPLACE FUNCTION public.get_specialist_reports(p_status text DEFAULT 'open', p_manager uuid DEFAULT NULL, p_limit integer DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_kind text := public.complaint_viewer_kind(v_uid);
  v_rows jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'COMPLAINT_SIGN_IN: Sign in to see client complaints.' USING ERRCODE = '42501'; END IF;
  IF v_kind IS NULL THEN RAISE EXCEPTION 'COMPLAINT_FORBIDDEN: Only managers can see client complaints.' USING ERRCODE = '42501'; END IF;
  SELECT COALESCE(jsonb_agg(j ORDER BY (j->>'created_at') DESC), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'id', r.id,
      'created_at', r.created_at,
      'source', r.source,
      'client', jsonb_build_object('id', r.client_id, 'name', COALESCE(public.complaint_name(c.first_name, c.last_name), 'Client')),
      'expert', CASE WHEN e.id IS NULL THEN NULL ELSE jsonb_build_object('id', e.id, 'name', public.complaint_name(e.first_name, e.last_name), 'role', e.role::text) END,
      'trainer_name', r.trainer_name,
      'team_manager', CASE WHEN s.manager_id IS NULL THEN NULL ELSE jsonb_build_object('id', m.id, 'name', public.complaint_name(m.first_name, m.last_name)) END,
      'session', CASE WHEN ss.id IS NULL THEN NULL ELSE jsonb_build_object('id', ss.id, 'at', ss.scheduled_datetime, 'modality', ss.modality) END,
      'note', r.note,
      'status', COALESCE(r.status, 'new'),
      'staff', CASE WHEN r.handled_at IS NULL THEN NULL ELSE jsonb_build_object(
                 'handled_at', r.handled_at, 'handled_by', r.handled_by,
                 'handled_by_name', (SELECT public.complaint_name(h.first_name, h.last_name) FROM public.profiles h WHERE h.id = r.handled_by),
                 'note', r.staff_note) END
    ) AS j
    FROM public.specialist_reports r
    LEFT JOIN (SELECT DISTINCT ON (sc.expert_id) sc.expert_id, sc.manager_id FROM public.complaint_scope(v_uid, p_manager) sc ORDER BY sc.expert_id, sc.manager_id NULLS LAST) s ON s.expert_id = r.trainer_id
    LEFT JOIN public.profiles e ON e.id = r.trainer_id
    LEFT JOIN public.profiles m ON m.id = s.manager_id
    LEFT JOIN public.clients c ON c.id = r.client_id
    LEFT JOIN public.session_schedule ss ON ss.id = r.schedule_session_id
    WHERE (r.trainer_id IS NULL OR r.trainer_id <> v_uid)
      AND ( (r.trainer_id IS NOT NULL AND s.expert_id IS NOT NULL)
            OR (r.trainer_id IS NULL AND v_kind = 'all' AND (p_manager IS NULL OR p_manager = '00000000-0000-0000-0000-000000000000'::uuid)) )
      AND (COALESCE(p_status, 'open') = 'all'
           OR (p_status = 'handled' AND COALESCE(r.status, 'new') IN ('confirmed', 'dismissed'))
           OR (COALESCE(p_status, 'open') = 'open' AND COALESCE(r.status, 'new') IN ('new', 'in_review')))
    ORDER BY r.created_at DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 200), 500))
  ) q;
  RETURN v_rows;
END;
$$;
REVOKE ALL ON FUNCTION public.get_specialist_reports(text, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_specialist_reports(text, uuid, integer) TO authenticated, service_role;

/** {viewer: all|manager|null, logs_open, reports_open} for the drawer dot and the page header. */
CREATE OR REPLACE FUNCTION public.count_client_complaints()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_kind text := public.complaint_viewer_kind(v_uid);
  v_logs integer := 0;
  v_reports integer := 0;
BEGIN
  IF v_uid IS NULL OR v_kind IS NULL THEN RETURN jsonb_build_object('viewer', v_kind, 'logs_open', 0, 'reports_open', 0); END IF;
  SELECT count(*) INTO v_logs FROM public.training_sessions ts
   WHERE ts.log_review->>'verdict' = 'inaccurate' AND NOT (ts.log_review ? 'staff_reviewed_at')
     AND ts.trainer_id IN (SELECT sc.expert_id FROM public.complaint_scope(v_uid, NULL) sc);
  SELECT count(*) INTO v_reports FROM public.specialist_reports r
   WHERE COALESCE(r.status, 'new') IN ('new', 'in_review') AND (r.trainer_id IS NULL OR r.trainer_id <> v_uid)
     AND ((r.trainer_id IS NOT NULL AND r.trainer_id IN (SELECT sc.expert_id FROM public.complaint_scope(v_uid, NULL) sc))
          OR (r.trainer_id IS NULL AND v_kind = 'all'));
  RETURN jsonb_build_object('viewer', v_kind, 'logs_open', v_logs, 'reports_open', v_reports);
END;
$$;
REVOKE ALL ON FUNCTION public.count_client_complaints() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.count_client_complaints() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. The writes
-- ---------------------------------------------------------------------------
/** Staff state merged into the same json: staff_reviewed_at, staff_reviewed_by, staff_note, log_fixed. The client's
    verdict, at, issues and note are never touched (the B2C check constraint allows extra keys). A second call
    updates the staff keys. */
CREATE OR REPLACE FUNCTION public.mark_log_review_handled(p_session uuid, p_note text DEFAULT NULL, p_log_fixed boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_kind text := public.complaint_viewer_kind(v_uid);
  v_row public.training_sessions;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'COMPLAINT_SIGN_IN: Sign in to see client complaints.' USING ERRCODE = '42501'; END IF;
  IF v_kind IS NULL THEN RAISE EXCEPTION 'COMPLAINT_FORBIDDEN: Only managers can handle client complaints.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_row FROM public.training_sessions ts WHERE ts.id = p_session FOR UPDATE;
  IF v_row.id IS NULL OR v_row.log_review->>'verdict' IS DISTINCT FROM 'inaccurate' THEN
    RAISE EXCEPTION 'COMPLAINT_NOT_FOUND: That flagged log is not there any more.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.complaint_scope(v_uid, NULL) sc WHERE sc.expert_id = v_row.trainer_id) THEN
    RAISE EXCEPTION 'COMPLAINT_FORBIDDEN: That expert is not in your team.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.training_sessions ts
     SET log_review = ts.log_review || jsonb_build_object('staff_reviewed_at', now(), 'staff_reviewed_by', v_uid,
                                                           'staff_note', NULLIF(btrim(COALESCE(p_note, '')), ''), 'log_fixed', COALESCE(p_log_fixed, false))
   WHERE ts.id = p_session
   RETURNING * INTO v_row;
  RETURN jsonb_build_object('ok', true, 'session_id', v_row.id, 'log_review', v_row.log_review);
END;
$$;
REVOKE ALL ON FUNCTION public.mark_log_review_handled(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_log_review_handled(uuid, text, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.unmark_log_review_handled(p_session uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_kind text := public.complaint_viewer_kind(v_uid);
  v_row public.training_sessions;
BEGIN
  IF v_uid IS NULL OR v_kind IS NULL THEN RAISE EXCEPTION 'COMPLAINT_FORBIDDEN: Only managers can handle client complaints.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_row FROM public.training_sessions ts WHERE ts.id = p_session FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'COMPLAINT_NOT_FOUND: That flagged log is not there any more.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.complaint_scope(v_uid, NULL) sc WHERE sc.expert_id = v_row.trainer_id) THEN
    RAISE EXCEPTION 'COMPLAINT_FORBIDDEN: That expert is not in your team.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.training_sessions ts
     SET log_review = ts.log_review - 'staff_reviewed_at' - 'staff_reviewed_by' - 'staff_note' - 'log_fixed'
   WHERE ts.id = p_session
   RETURNING * INTO v_row;
  RETURN jsonb_build_object('ok', true, 'session_id', v_row.id, 'log_review', v_row.log_review);
END;
$$;
REVOKE ALL ON FUNCTION public.unmark_log_review_handled(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unmark_log_review_handled(uuid) TO authenticated, service_role;

/** new | in_review | confirmed | dismissed. Confirming records our decision only; the free month is a billing step
    outside this function. The reported expert can never set it. */
CREATE OR REPLACE FUNCTION public.set_specialist_report_status(p_id uuid, p_status text, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_kind text := public.complaint_viewer_kind(v_uid);
  v_row public.specialist_reports;
BEGIN
  IF v_uid IS NULL OR v_kind IS NULL THEN RAISE EXCEPTION 'COMPLAINT_FORBIDDEN: Only managers can handle client complaints.' USING ERRCODE = '42501'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('new', 'in_review', 'confirmed', 'dismissed') THEN
    RAISE EXCEPTION 'COMPLAINT_BAD_STATUS: Pick new, in review, confirmed or dismissed.';
  END IF;
  SELECT * INTO v_row FROM public.specialist_reports r WHERE r.id = p_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'COMPLAINT_NOT_FOUND: That report is not there any more.'; END IF;
  IF v_row.trainer_id = v_uid THEN RAISE EXCEPTION 'COMPLAINT_FORBIDDEN: This report is not for you to see.' USING ERRCODE = '42501'; END IF;
  IF v_row.trainer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.complaint_scope(v_uid, NULL) sc WHERE sc.expert_id = v_row.trainer_id) THEN
    RAISE EXCEPTION 'COMPLAINT_FORBIDDEN: That expert is not in your team.' USING ERRCODE = '42501';
  END IF;
  IF v_row.trainer_id IS NULL AND v_kind <> 'all' THEN
    RAISE EXCEPTION 'COMPLAINT_FORBIDDEN: Reports about an unmatched expert are handled by the HOD or an admin.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.specialist_reports r
     SET status = p_status,
         handled_by = CASE WHEN p_status = 'new' THEN NULL ELSE v_uid END,
         handled_at = CASE WHEN p_status = 'new' THEN NULL ELSE now() END,
         staff_note = CASE WHEN p_status = 'new' THEN NULL ELSE NULLIF(btrim(COALESCE(p_note, '')), '') END
   WHERE r.id = p_id
   RETURNING * INTO v_row;
  RETURN jsonb_build_object('ok', true, 'id', v_row.id, 'status', v_row.status, 'handled_at', v_row.handled_at, 'handled_by', v_row.handled_by, 'staff_note', v_row.staff_note);
END;
$$;
REVOKE ALL ON FUNCTION public.set_specialist_report_status(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_specialist_report_status(uuid, text, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Pushes: the team manager(s) and, for a doctor or therapist, the physio HOD; never the expert
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complaint_push_targets(p_expert uuid)
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(array_agg(DISTINCT u), '{}'::uuid[]) FROM (
    SELECT t.manager_id AS u FROM public.complaint_current_teams() t WHERE t.member_id = p_expert AND t.manager_id IS NOT NULL
    UNION
    SELECT p.id FROM public.profiles p
     WHERE p.role_specialization::text ILIKE '%physio_hod%' AND p.status = 'active'
       AND EXISTS (SELECT 1 FROM public.profiles e WHERE e.id = p_expert AND e.role::text IN ('doctor', 'therapist'))
    UNION
    SELECT p.id FROM public.profiles p
     WHERE p.role_specialization::text ILIKE '%physio_hod%' AND p.status = 'active' AND p_expert IS NULL
  ) x WHERE x.u IS NOT NULL AND x.u <> COALESCE(p_expert, '00000000-0000-0000-0000-000000000000'::uuid)
$$;
REVOKE ALL ON FUNCTION public.complaint_push_targets(uuid) FROM PUBLIC, anon, authenticated;

/** pg_net to the staff push sender (notify-essentials-unsold takes {user_ids, title, body, data} and writes
    staff_push_log), like essentials_unsold_push. Silenced by SET complaints.silent = 'on' (the probe). */
CREATE OR REPLACE FUNCTION public.complaints_push(p_user_ids uuid[], p_title text, p_body text, p_data jsonb)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_key text;
BEGIN
  IF p_user_ids IS NULL OR array_length(p_user_ids, 1) IS NULL THEN RETURN false; END IF;
  IF current_setting('complaints.silent', true) = 'on' THEN RETURN false; END IF;
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'consult_autogen_key' LIMIT 1;
  IF v_key IS NULL OR v_key = '' THEN
    SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'edge_function_secret_key' LIMIT 1;
  END IF;
  IF v_key IS NULL OR v_key = '' THEN RETURN false; END IF;
  PERFORM net.http_post(
    url := 'https://agtjszjedaenclbzgjvi.supabase.co/functions/v1/notify-essentials-unsold',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key, 'apikey', v_key),
    body := jsonb_build_object('user_ids', to_jsonb(p_user_ids), 'title', p_title, 'body', p_body, 'data', COALESCE(p_data, '{}'::jsonb)),
    timeout_milliseconds := 15000
  );
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.complaints_push(uuid[], text, text, jsonb) FROM PUBLIC, anon, authenticated;

/** A review turning inaccurate (insert, or an update from anything else): one push. Staff edits keep the verdict,
    so they never push again. Wrapped: the client's write never fails because of this. */
CREATE OR REPLACE FUNCTION public.trg_fn_log_review_flagged()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_targets uuid[];
  v_client text;
  v_expert text;
  v_when text;
  v_issues text;
BEGIN
  BEGIN
    IF NEW.log_review->>'verdict' IS DISTINCT FROM 'inaccurate' THEN RETURN NULL; END IF;
    IF TG_OP = 'UPDATE' AND OLD.log_review->>'verdict' = 'inaccurate' THEN RETURN NULL; END IF;
    v_targets := public.complaint_push_targets(NEW.trainer_id);
    IF array_length(v_targets, 1) IS NULL THEN RETURN NULL; END IF;
    SELECT split_part(public.complaint_name(c.first_name, c.last_name), ' ', 1) INTO v_client FROM public.clients c WHERE c.id = NEW.client_id;
    SELECT split_part(public.complaint_name(p.first_name, p.last_name), ' ', 1) INTO v_expert FROM public.profiles p WHERE p.id = NEW.trainer_id;
    v_when := to_char(COALESCE(NEW.scheduled_at, NEW.created_at) AT TIME ZONE 'Asia/Kolkata', 'FMDD Mon');
    SELECT string_agg(i, ', ') INTO v_issues FROM jsonb_array_elements_text(COALESCE(NEW.log_review->'issues', '[]'::jsonb)) i;
    PERFORM public.complaints_push(v_targets, 'Client flagged a log',
      COALESCE(v_client, 'A client') || ' says ' || COALESCE(v_expert, 'the expert') || '''s session of ' || v_when ||
        ' was not logged accurately' || CASE WHEN v_issues IS NULL OR v_issues = '' THEN '' ELSE ' (' || v_issues || ')' END || '. Tap to review.',
      jsonb_build_object('type', 'client_complaint', 'route', 'client-complaints', 'kind', 'log', 'session_id', NEW.id));
  EXCEPTION WHEN others THEN
    RAISE WARNING 'trg_fn_log_review_flagged: % (session %)', SQLERRM, NEW.id;
  END;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.trg_fn_log_review_flagged() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_log_review_flagged ON public.training_sessions;
CREATE TRIGGER trg_log_review_flagged
  AFTER INSERT OR UPDATE OF log_review ON public.training_sessions
  FOR EACH ROW EXECUTE FUNCTION public.trg_fn_log_review_flagged();

CREATE OR REPLACE FUNCTION public.trg_fn_specialist_report_new()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_targets uuid[];
BEGIN
  BEGIN
    v_targets := public.complaint_push_targets(NEW.trainer_id);
    IF array_length(v_targets, 1) IS NULL THEN RETURN NULL; END IF;
    PERFORM public.complaints_push(v_targets, 'New client report',
      'A client reported ' || COALESCE(NULLIF(btrim(NEW.trainer_name), ''), 'an expert') || '. Only management can read it. Tap to review.',
      jsonb_build_object('type', 'client_complaint', 'route', 'client-complaints', 'kind', 'report', 'report_id', NEW.id));
  EXCEPTION WHEN others THEN
    RAISE WARNING 'trg_fn_specialist_report_new: % (report %)', SQLERRM, NEW.id;
  END;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.trg_fn_specialist_report_new() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_specialist_report_new ON public.specialist_reports;
CREATE TRIGGER trg_specialist_report_new
  AFTER INSERT ON public.specialist_reports
  FOR EACH ROW EXECUTE FUNCTION public.trg_fn_specialist_report_new();

COMMIT;

-- ---------------------------------------------------------------------------
-- Probe: a real current team, its manager, one member, a client; the HOD; a trainer who is no manager. Inside a
-- block that is always rolled back; pushes silenced. 14 checks.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE IF NOT EXISTS complaints_probe (step int, check_name text, expected text, result text);
TRUNCATE complaints_probe;

DO $probe$
DECLARE
  v_mgr uuid; v_member uuid; v_other_mgr uuid; v_hod uuid; v_plain uuid; v_client uuid; v_session uuid; v_doctor uuid;
  v_report uuid := gen_random_uuid(); v_report_mgr uuid := gen_random_uuid();
  v_before jsonb; v_after jsonb; x jsonb; v_res text; v_n int;
  v_names text[] := '{}'; v_expected text[] := '{}'; v_results text[] := '{}';
  as_user CONSTANT text := 'request.jwt.claim.sub';
BEGIN
  PERFORM set_config('complaints.silent', 'on', true);
  -- a current team with at least one member who has a training session
  SELECT t.manager_id, t.member_id INTO v_mgr, v_member FROM public.complaint_current_teams() t
   WHERE NOT t.is_manager AND t.manager_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.training_sessions ts WHERE ts.trainer_id = t.member_id AND ts.client_id IS NOT NULL)
   ORDER BY t.team_id LIMIT 1;
  SELECT t.manager_id INTO v_other_mgr FROM public.complaint_current_teams() t WHERE t.manager_id IS NOT NULL AND t.manager_id <> v_mgr AND NOT EXISTS (SELECT 1 FROM public.complaint_current_teams() t2 WHERE t2.member_id = v_member AND t2.manager_id = t.manager_id) LIMIT 1;
  SELECT p.id INTO v_hod FROM public.profiles p WHERE p.role_specialization::text ILIKE '%physio_hod%' AND p.status = 'active' LIMIT 1;
  SELECT p.id INTO v_plain FROM public.profiles p WHERE p.role::text = 'trainer' AND NOT p.managers AND COALESCE(p.role_specialization::text, '') NOT ILIKE '%physio_hod%' AND p.id <> v_member AND p.status = 'active' LIMIT 1;
  SELECT p.id INTO v_doctor FROM public.profiles p WHERE p.role::text = 'doctor' AND p.id <> v_hod LIMIT 1;
  SELECT ts.id, ts.client_id INTO v_session, v_client FROM public.training_sessions ts WHERE ts.trainer_id = v_member AND ts.client_id IS NOT NULL AND ts.log_review IS NULL ORDER BY ts.created_at DESC LIMIT 1;
  BEGIN
    IF v_mgr IS NULL OR v_session IS NULL THEN RAISE EXCEPTION 'no current team with a member who has an unreviewed training'; END IF;
    -- 1. viewer kinds
    v_names := array_append(v_names, 'viewer kinds: manager, HOD, plain trainer'); v_expected := array_append(v_expected, 'manager | all | none');
    v_results := array_append(v_results, COALESCE(public.complaint_viewer_kind(v_mgr), 'none') || ' | ' || COALESCE(public.complaint_viewer_kind(v_hod), 'none') || ' | ' || COALESCE(public.complaint_viewer_kind(v_plain), 'none'));
    -- 2. the client flags a log (the client app's write): the manager's list has it
    UPDATE public.training_sessions SET log_review = jsonb_build_object('verdict', 'inaccurate', 'at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'issues', jsonb_build_array('reps'), 'note', 'Probe: I did two sets, not three'), session_acknowledged_at = COALESCE(session_acknowledged_at, now()), attendance_marked = true WHERE id = v_session;
    v_before := (SELECT log_review FROM public.training_sessions WHERE id = v_session);
    PERFORM set_config(as_user, v_mgr::text, true);
    x := public.get_inaccurate_logs('open', NULL, 200);
    v_names := array_append(v_names, 'the team manager sees the flag with issues, note and the expert'); v_expected := array_append(v_expected, 'found, issues ["reps"], expert ' || v_member::text);
    v_results := array_append(v_results, CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(x) r WHERE r->>'session_id' = v_session::text) THEN 'found, issues ' || (SELECT (r->'issues')::text FROM jsonb_array_elements(x) r WHERE r->>'session_id' = v_session::text) || ', expert ' || (SELECT r->'expert'->>'id' FROM jsonb_array_elements(x) r WHERE r->>'session_id' = v_session::text) ELSE 'not found' END);
    -- 3. another team's manager does not
    IF v_other_mgr IS NOT NULL THEN
      PERFORM set_config(as_user, v_other_mgr::text, true);
      x := public.get_inaccurate_logs('open', NULL, 200);
      v_names := array_append(v_names, 'another team''s manager does not see it'); v_expected := array_append(v_expected, 'hidden');
      v_results := array_append(v_results, CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(x) r WHERE r->>'session_id' = v_session::text) THEN 'visible' ELSE 'hidden' END);
    END IF;
    -- 4. the HOD sees it, the manager filter narrows
    PERFORM set_config(as_user, v_hod::text, true);
    v_names := array_append(v_names, 'the HOD sees it: all, this manager, another manager'); v_expected := array_append(v_expected, 'yes, yes, no');
    v_results := array_append(v_results,
      CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(public.get_inaccurate_logs('open', NULL, 200)) r WHERE r->>'session_id' = v_session::text) THEN 'yes' ELSE 'no' END || ', ' ||
      CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(public.get_inaccurate_logs('open', v_mgr, 200)) r WHERE r->>'session_id' = v_session::text) THEN 'yes' ELSE 'no' END || ', ' ||
      CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(public.get_inaccurate_logs('open', COALESCE(v_other_mgr, '00000000-0000-0000-0000-000000000000'::uuid), 200)) r WHERE r->>'session_id' = v_session::text) THEN 'yes' ELSE 'no' END);
    -- 5. a plain trainer is refused
    PERFORM set_config(as_user, v_plain::text, true);
    BEGIN x := public.get_inaccurate_logs('open', NULL, 200); v_res := 'allowed'; EXCEPTION WHEN others THEN v_res := split_part(SQLERRM, ':', 1); END;
    v_names := array_append(v_names, 'a trainer who is no manager is refused'); v_expected := array_append(v_expected, 'COMPLAINT_FORBIDDEN');
    v_results := array_append(v_results, v_res);
    -- 6. mark handled by the manager: the client's four keys untouched, staff keys present, open list empty of it
    PERFORM set_config(as_user, v_mgr::text, true);
    x := public.mark_log_review_handled(v_session, 'Spoke to the expert, log corrected', true);
    v_after := (SELECT log_review FROM public.training_sessions WHERE id = v_session);
    v_names := array_append(v_names, 'mark handled keeps the client''s keys and adds the staff keys'); v_expected := array_append(v_expected, 'client keys same, staff true, open hidden, handled shown');
    v_results := array_append(v_results,
      CASE WHEN (v_after - 'staff_reviewed_at' - 'staff_reviewed_by' - 'staff_note' - 'log_fixed') = v_before THEN 'client keys same' ELSE 'client keys CHANGED' END || ', staff ' ||
      CASE WHEN v_after ? 'staff_reviewed_at' AND v_after->>'staff_reviewed_by' = v_mgr::text AND (v_after->>'log_fixed')::boolean THEN 'true' ELSE 'false' END || ', open ' ||
      CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(public.get_inaccurate_logs('open', NULL, 200)) r WHERE r->>'session_id' = v_session::text) THEN 'shown' ELSE 'hidden' END || ', handled ' ||
      CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(public.get_inaccurate_logs('handled', NULL, 200)) r WHERE r->>'session_id' = v_session::text AND (r->'staff'->>'log_fixed')::boolean) THEN 'shown' ELSE 'hidden' END);
    -- 7. unmark
    x := public.unmark_log_review_handled(v_session);
    v_names := array_append(v_names, 'unmark restores the client''s json exactly'); v_expected := array_append(v_expected, 'same');
    v_results := array_append(v_results, CASE WHEN (SELECT log_review FROM public.training_sessions WHERE id = v_session) = v_before THEN 'same' ELSE 'different' END);
    -- 8. a report about the member (the client app's insert): manager sees it, the HOD too; a report about the manager is hidden from them
    INSERT INTO public.specialist_reports (id, client_id, trainer_id, trainer_name, note, source, status, reported_by)
    VALUES (v_report, v_client, v_member, 'Probe Expert', 'Probe: asked me to pay outside', 'home', 'new', v_client);
    INSERT INTO public.specialist_reports (id, client_id, trainer_id, trainer_name, note, source, status, reported_by)
    VALUES (v_report_mgr, v_client, v_mgr, 'Probe Manager', 'Probe: about the manager', 'profile', 'new', v_client);
    PERFORM set_config(as_user, v_mgr::text, true);
    x := public.get_specialist_reports('open', NULL, 200);
    v_names := array_append(v_names, 'the manager sees the report about the member, not the one about themselves'); v_expected := array_append(v_expected, 'member yes, self no');
    v_results := array_append(v_results, 'member ' || CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(x) r WHERE r->>'id' = v_report::text) THEN 'yes' ELSE 'no' END || ', self ' || CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(x) r WHERE r->>'id' = v_report_mgr::text) THEN 'yes' ELSE 'no' END);
    PERFORM set_config(as_user, v_hod::text, true);
    x := public.get_specialist_reports('open', NULL, 200);
    v_names := array_append(v_names, 'the HOD sees both reports'); v_expected := array_append(v_expected, 'member yes, manager yes');
    v_results := array_append(v_results, 'member ' || CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(x) r WHERE r->>'id' = v_report::text) THEN 'yes' ELSE 'no' END || ', manager ' || CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(x) r WHERE r->>'id' = v_report_mgr::text) THEN 'yes' ELSE 'no' END);
    -- 9. the plain trainer gets nothing of the reports table through the RPC either
    PERFORM set_config(as_user, v_plain::text, true);
    BEGIN x := public.get_specialist_reports('open', NULL, 200); v_res := 'allowed'; EXCEPTION WHEN others THEN v_res := split_part(SQLERRM, ':', 1); END;
    v_names := array_append(v_names, 'reports: a trainer who is no manager is refused'); v_expected := array_append(v_expected, 'COMPLAINT_FORBIDDEN');
    v_results := array_append(v_results, v_res);
    -- 10. the manager confirms, a bad status is refused, the reported manager cannot touch their own
    PERFORM set_config(as_user, v_mgr::text, true);
    x := public.set_specialist_report_status(v_report, 'confirmed', 'Confirmed on the call');
    BEGIN x := public.set_specialist_report_status(v_report, 'approved', NULL); v_res := 'allowed'; EXCEPTION WHEN others THEN v_res := split_part(SQLERRM, ':', 1); END;
    v_names := array_append(v_names, 'confirm writes status + handled_by; a bad status is refused'); v_expected := array_append(v_expected, 'confirmed by manager, COMPLAINT_BAD_STATUS');
    v_results := array_append(v_results, (SELECT r.status || CASE WHEN r.handled_by = v_mgr THEN ' by manager' ELSE ' by ?' END FROM public.specialist_reports r WHERE r.id = v_report) || ', ' || v_res);
    BEGIN x := public.set_specialist_report_status(v_report_mgr, 'dismissed', NULL); v_res := 'allowed'; EXCEPTION WHEN others THEN v_res := split_part(SQLERRM, ':', 1); END;
    v_names := array_append(v_names, 'the reported manager cannot handle the report about themselves'); v_expected := array_append(v_expected, 'COMPLAINT_FORBIDDEN');
    v_results := array_append(v_results, v_res);
    -- 11. counts for the manager: one open report left (the one about the member is confirmed), flags open 0 after unmark? the flag is open again (unmarked)
    x := public.count_client_complaints();
    v_names := array_append(v_names, 'count for the manager: the unmarked flag open, the confirmed report closed, own report hidden'); v_expected := array_append(v_expected, 'logs >= 1, reports 0 of the probe');
    v_results := array_append(v_results, 'logs ' || CASE WHEN (x->>'logs_open')::int >= 1 THEN '>= 1' ELSE (x->>'logs_open') END || ', reports ' ||
      CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(public.get_specialist_reports('open', NULL, 200)) r WHERE r->>'id' IN (v_report::text, v_report_mgr::text)) THEN 'probe rows still open' ELSE '0 of the probe' END);
    -- 12. push targets: the member's manager, never the member; a doctor's include the HOD
    v_names := array_append(v_names, 'push targets: the manager for the member, the HOD for a doctor, never the expert'); v_expected := array_append(v_expected, 'manager yes, member no, hod yes');
    v_results := array_append(v_results, 'manager ' || CASE WHEN v_mgr = ANY(public.complaint_push_targets(v_member)) THEN 'yes' ELSE 'no' END || ', member ' || CASE WHEN v_member = ANY(public.complaint_push_targets(v_member)) THEN 'yes' ELSE 'no' END || ', hod ' || CASE WHEN v_doctor IS NULL OR v_hod = ANY(public.complaint_push_targets(v_doctor)) THEN 'yes' ELSE 'no' END);
    -- 13. the logged exercises travel with the flag (0 or more, never an error)
    PERFORM set_config(as_user, v_hod::text, true);
    SELECT jsonb_typeof(r->'logged') INTO v_res FROM jsonb_array_elements(public.get_inaccurate_logs('open', NULL, 200)) r WHERE r->>'session_id' = v_session::text;
    v_names := array_append(v_names, 'the log as entered is an array on the row'); v_expected := array_append(v_expected, 'array');
    v_results := array_append(v_results, COALESCE(v_res, 'missing'));
    RAISE EXCEPTION 'PROBE_DONE';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'PROBE_DONE' THEN
      v_names := array_append(v_names, 'probe stopped'); v_expected := array_append(v_expected, 'ran'); v_results := array_append(v_results, 'could not run: ' || SQLERRM);
    END IF;
  END;
  PERFORM set_config(as_user, '', true);
  INSERT INTO complaints_probe (step, check_name, expected, result)
  SELECT n, v_names[n], v_expected[n], v_results[n] FROM generate_subscripts(v_names, 1) AS n;
END
$probe$;

INSERT INTO complaints_probe (step, check_name, expected, result)
SELECT 20, 'triggers in place', 'trg_log_review_flagged, trg_specialist_report_new', (SELECT string_agg(tgname, ', ' ORDER BY tgname) FROM pg_trigger WHERE tgname IN ('trg_log_review_flagged', 'trg_specialist_report_new'))
UNION ALL
SELECT 21, 'probe rows left behind', '0', (SELECT count(*)::text FROM public.specialist_reports WHERE note LIKE 'Probe:%')
UNION ALL
SELECT 22, 'probe flags left behind', '0', (SELECT count(*)::text FROM public.training_sessions WHERE log_review->>'note' LIKE 'Probe:%');

SELECT step, check_name, expected, result FROM complaints_probe ORDER BY step;
```

#### `supabase/migrations/20261104110000_client_complaints_live_only.sql` (owner, later the same day: the LIVE competition only)

```sql
-- ============================================================================
-- Client complaints: the LIVE competition only (3 Nov 2026, owner: "show only the current competition team and its
-- complaints only, means the live one")
-- 1. complaint_current_teams(): ongoing manager_score rows only (team_start <= today <= team_end, IST). No fallback
--    to the last finished batch any more: no live competition = no team = nothing to see for a manager.
-- 2. complaint_scope() carries the team's dates; get_inaccurate_logs / get_specialist_reports / count_client_complaints
--    keep only the complaints dated inside the live competition of the expert's team (the client's `at` for a flag,
--    created_at for a report; IST days). Experts in no live team ("No team", all-teams viewers only) keep no window.
-- Replaces the functions of 20261104100000 with the same signatures (the two dropped ones grew a column).
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.complaint_scope(uuid, uuid);
DROP FUNCTION IF EXISTS public.complaint_current_teams();

CREATE OR REPLACE FUNCTION public.complaint_current_teams()
RETURNS TABLE(team_id uuid, team_name text, manager_id uuid, member_id uuid, is_manager boolean, team_start date, team_end date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH today AS (SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS d),
  live AS (
    SELECT ms.* FROM public.manager_score ms, today
     WHERE ms.team_start <= today.d AND (ms.team_end IS NULL OR ms.team_end >= today.d)
  )
  SELECT c.id, c.team_name, c.manager_id, c.manager_id, true, c.team_start, c.team_end FROM live c WHERE c.manager_id IS NOT NULL
  UNION
  SELECT c.id, c.team_name, c.manager_id, (m.value #>> '{}')::uuid, false, c.team_start, c.team_end
    FROM live c, jsonb_array_elements(CASE WHEN jsonb_typeof(c.team_json) = 'array' THEN c.team_json ELSE '[]'::jsonb END) m
   WHERE (m.value #>> '{}') ~* '^[0-9a-f-]{36}$'
$$;
REVOKE ALL ON FUNCTION public.complaint_current_teams() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.complaint_scope(p_viewer uuid, p_manager uuid DEFAULT NULL)
RETURNS TABLE(expert_id uuid, manager_id uuid, team_start date, team_end date)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_kind text := public.complaint_viewer_kind(p_viewer);
BEGIN
  IF v_kind IS NULL THEN RETURN; END IF;
  IF v_kind = 'manager' THEN
    RETURN QUERY
      SELECT DISTINCT t.member_id, t.manager_id, t.team_start, t.team_end FROM public.complaint_current_teams() t
       WHERE t.team_id IN (SELECT t2.team_id FROM public.complaint_current_teams() t2 WHERE t2.member_id = p_viewer);
    RETURN;
  END IF;
  RETURN QUERY
    SELECT DISTINCT t.member_id, t.manager_id, t.team_start, t.team_end FROM public.complaint_current_teams() t
     WHERE p_manager IS NULL OR t.manager_id = p_manager
    UNION
    SELECT p.id, NULL::uuid, NULL::date, NULL::date FROM public.profiles p
     WHERE (p_manager IS NULL OR p_manager = '00000000-0000-0000-0000-000000000000'::uuid)
       AND p.role::text IN ('trainer', 'doctor', 'therapist', 'coach')
       AND NOT EXISTS (SELECT 1 FROM public.complaint_current_teams() t WHERE t.member_id = p.id);
END;
$$;
REVOKE ALL ON FUNCTION public.complaint_scope(uuid, uuid) FROM PUBLIC, anon, authenticated;

/** Is a moment inside the team's competition window (IST days)? No team dates = no window. */
CREATE OR REPLACE FUNCTION public.complaint_in_window(p_at timestamptz, p_start date, p_end date)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p_at IS NOT NULL
     AND (p_start IS NULL OR (p_at AT TIME ZONE 'Asia/Kolkata')::date >= p_start)
     AND (p_end IS NULL OR (p_at AT TIME ZONE 'Asia/Kolkata')::date <= p_end)
$$;

CREATE OR REPLACE FUNCTION public.get_inaccurate_logs(p_status text DEFAULT 'open', p_manager uuid DEFAULT NULL, p_limit integer DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_kind text := public.complaint_viewer_kind(v_uid);
  v_rows jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'COMPLAINT_SIGN_IN: Sign in to see client complaints.' USING ERRCODE = '42501'; END IF;
  IF v_kind IS NULL THEN RAISE EXCEPTION 'COMPLAINT_FORBIDDEN: Only managers can see client complaints.' USING ERRCODE = '42501'; END IF;
  SELECT COALESCE(jsonb_agg(j ORDER BY (j->>'at') DESC NULLS LAST), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'session_id', ts.id,
      'scheduled_at', ts.scheduled_at,
      'session_type', ts.session_type,
      'session_name', ts.session_name,
      'expert', jsonb_build_object('id', e.id, 'name', public.complaint_name(e.first_name, e.last_name), 'role', e.role::text),
      'team_manager', CASE WHEN s.manager_id IS NULL THEN NULL ELSE jsonb_build_object('id', m.id, 'name', public.complaint_name(m.first_name, m.last_name)) END,
      'client', jsonb_build_object('id', ts.client_id, 'name', COALESCE(public.complaint_name(c.first_name, c.last_name), 'Client')),
      'issues', COALESCE(ts.log_review->'issues', '[]'::jsonb),
      'note', ts.log_review->>'note',
      'at', ts.log_review->>'at',
      'staff', CASE WHEN ts.log_review ? 'staff_reviewed_at' THEN jsonb_build_object(
                 'reviewed_at', ts.log_review->>'staff_reviewed_at', 'reviewed_by', ts.log_review->>'staff_reviewed_by',
                 'reviewed_by_name', (SELECT public.complaint_name(h.first_name, h.last_name) FROM public.profiles h WHERE h.id::text = ts.log_review->>'staff_reviewed_by'),
                 'note', ts.log_review->>'staff_note', 'log_fixed', COALESCE((ts.log_review->>'log_fixed')::boolean, false))
               ELSE NULL END,
      'logged', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('exercise', x.exercise_name, 'sets', x.sets, 'reps', x.reps, 'loads', x.loads,
                                            'duration_seconds', x.duration_seconds, 'notes', x.notes) ORDER BY x.first_set, x.exercise_name)
          FROM (SELECT w.exercise_name, count(*) AS sets,
                       jsonb_agg(w.reps_performed ORDER BY w.set_number) AS reps,
                       jsonb_agg(w.load_performed ORDER BY w.set_number) AS loads,
                       max(w.duration_seconds) AS duration_seconds,
                       max(w.exercise_notes) AS notes,
                       min(w.created_at) AS first_set
                  FROM public.workout_exercises w
                 WHERE ts.workout_session_id IS NOT NULL AND w.session_id = ts.workout_session_id
                 GROUP BY w.exercise_name) x), '[]'::jsonb),
      'session_notes', NULLIF(btrim(COALESCE(ts.notes, '')), '')
    ) AS j
    FROM public.training_sessions ts
    JOIN (SELECT DISTINCT ON (sc.expert_id) sc.expert_id, sc.manager_id, sc.team_start, sc.team_end FROM public.complaint_scope(v_uid, p_manager) sc ORDER BY sc.expert_id, sc.manager_id NULLS LAST) s ON s.expert_id = ts.trainer_id
    LEFT JOIN public.profiles e ON e.id = ts.trainer_id
    LEFT JOIN public.profiles m ON m.id = s.manager_id
    LEFT JOIN public.clients c ON c.id = ts.client_id
    WHERE ts.log_review->>'verdict' = 'inaccurate'
      AND public.complaint_in_window(COALESCE(NULLIF(ts.log_review->>'at', '')::timestamptz, ts.session_acknowledged_at, ts.created_at), s.team_start, s.team_end)
      AND (COALESCE(p_status, 'open') = 'all'
           OR (p_status = 'handled' AND ts.log_review ? 'staff_reviewed_at')
           OR (COALESCE(p_status, 'open') = 'open' AND NOT (ts.log_review ? 'staff_reviewed_at')))
    ORDER BY (ts.log_review->>'at') DESC NULLS LAST
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 200), 500))
  ) q;
  RETURN v_rows;
END;
$$;
REVOKE ALL ON FUNCTION public.get_inaccurate_logs(text, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_inaccurate_logs(text, uuid, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_specialist_reports(p_status text DEFAULT 'open', p_manager uuid DEFAULT NULL, p_limit integer DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_kind text := public.complaint_viewer_kind(v_uid);
  v_rows jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'COMPLAINT_SIGN_IN: Sign in to see client complaints.' USING ERRCODE = '42501'; END IF;
  IF v_kind IS NULL THEN RAISE EXCEPTION 'COMPLAINT_FORBIDDEN: Only managers can see client complaints.' USING ERRCODE = '42501'; END IF;
  SELECT COALESCE(jsonb_agg(j ORDER BY (j->>'created_at') DESC), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'id', r.id,
      'created_at', r.created_at,
      'source', r.source,
      'client', jsonb_build_object('id', r.client_id, 'name', COALESCE(public.complaint_name(c.first_name, c.last_name), 'Client')),
      'expert', CASE WHEN e.id IS NULL THEN NULL ELSE jsonb_build_object('id', e.id, 'name', public.complaint_name(e.first_name, e.last_name), 'role', e.role::text) END,
      'trainer_name', r.trainer_name,
      'team_manager', CASE WHEN s.manager_id IS NULL THEN NULL ELSE jsonb_build_object('id', m.id, 'name', public.complaint_name(m.first_name, m.last_name)) END,
      'session', CASE WHEN ss.id IS NULL THEN NULL ELSE jsonb_build_object('id', ss.id, 'at', ss.scheduled_datetime, 'modality', ss.modality) END,
      'note', r.note,
      'status', COALESCE(r.status, 'new'),
      'staff', CASE WHEN r.handled_at IS NULL THEN NULL ELSE jsonb_build_object(
                 'handled_at', r.handled_at, 'handled_by', r.handled_by,
                 'handled_by_name', (SELECT public.complaint_name(h.first_name, h.last_name) FROM public.profiles h WHERE h.id = r.handled_by),
                 'note', r.staff_note) END
    ) AS j
    FROM public.specialist_reports r
    LEFT JOIN (SELECT DISTINCT ON (sc.expert_id) sc.expert_id, sc.manager_id, sc.team_start, sc.team_end FROM public.complaint_scope(v_uid, p_manager) sc ORDER BY sc.expert_id, sc.manager_id NULLS LAST) s ON s.expert_id = r.trainer_id
    LEFT JOIN public.profiles e ON e.id = r.trainer_id
    LEFT JOIN public.profiles m ON m.id = s.manager_id
    LEFT JOIN public.clients c ON c.id = r.client_id
    LEFT JOIN public.session_schedule ss ON ss.id = r.schedule_session_id
    WHERE (r.trainer_id IS NULL OR r.trainer_id <> v_uid)
      AND ( (r.trainer_id IS NOT NULL AND s.expert_id IS NOT NULL AND public.complaint_in_window(r.created_at, s.team_start, s.team_end))
            OR (r.trainer_id IS NULL AND v_kind = 'all' AND (p_manager IS NULL OR p_manager = '00000000-0000-0000-0000-000000000000'::uuid)) )
      AND (COALESCE(p_status, 'open') = 'all'
           OR (p_status = 'handled' AND COALESCE(r.status, 'new') IN ('confirmed', 'dismissed'))
           OR (COALESCE(p_status, 'open') = 'open' AND COALESCE(r.status, 'new') IN ('new', 'in_review')))
    ORDER BY r.created_at DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 200), 500))
  ) q;
  RETURN v_rows;
END;
$$;
REVOKE ALL ON FUNCTION public.get_specialist_reports(text, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_specialist_reports(text, uuid, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.count_client_complaints()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_kind text := public.complaint_viewer_kind(v_uid);
  v_logs integer := 0;
  v_reports integer := 0;
BEGIN
  IF v_uid IS NULL OR v_kind IS NULL THEN RETURN jsonb_build_object('viewer', v_kind, 'logs_open', 0, 'reports_open', 0); END IF;
  SELECT count(*) INTO v_logs FROM public.training_sessions ts
   JOIN (SELECT DISTINCT ON (sc.expert_id) sc.expert_id, sc.team_start, sc.team_end FROM public.complaint_scope(v_uid, NULL) sc ORDER BY sc.expert_id, sc.manager_id NULLS LAST) s ON s.expert_id = ts.trainer_id
   WHERE ts.log_review->>'verdict' = 'inaccurate' AND NOT (ts.log_review ? 'staff_reviewed_at')
     AND public.complaint_in_window(COALESCE(NULLIF(ts.log_review->>'at', '')::timestamptz, ts.session_acknowledged_at, ts.created_at), s.team_start, s.team_end);
  SELECT count(*) INTO v_reports FROM public.specialist_reports r
   LEFT JOIN (SELECT DISTINCT ON (sc.expert_id) sc.expert_id, sc.team_start, sc.team_end FROM public.complaint_scope(v_uid, NULL) sc ORDER BY sc.expert_id, sc.manager_id NULLS LAST) s ON s.expert_id = r.trainer_id
   WHERE COALESCE(r.status, 'new') IN ('new', 'in_review') AND (r.trainer_id IS NULL OR r.trainer_id <> v_uid)
     AND ((r.trainer_id IS NOT NULL AND s.expert_id IS NOT NULL AND public.complaint_in_window(r.created_at, s.team_start, s.team_end))
          OR (r.trainer_id IS NULL AND v_kind = 'all'));
  RETURN jsonb_build_object('viewer', v_kind, 'logs_open', v_logs, 'reports_open', v_reports);
END;
$$;
REVOKE ALL ON FUNCTION public.count_client_complaints() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.count_client_complaints() TO authenticated, service_role;

/** The flag push follows the same window: a flag dated outside the expert's live competition would never show on the
    page, so nobody is pushed for it. An expert in no live team keeps the old targets (the HOD for a doctor / therapist). */
CREATE OR REPLACE FUNCTION public.trg_fn_log_review_flagged()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_targets uuid[];
  v_client text;
  v_expert text;
  v_when text;
  v_issues text;
  v_at timestamptz;
BEGIN
  BEGIN
    IF NEW.log_review->>'verdict' IS DISTINCT FROM 'inaccurate' THEN RETURN NULL; END IF;
    IF TG_OP = 'UPDATE' AND OLD.log_review->>'verdict' = 'inaccurate' THEN RETURN NULL; END IF;
    v_at := COALESCE(NULLIF(NEW.log_review->>'at', '')::timestamptz, NEW.session_acknowledged_at, now());
    IF EXISTS (SELECT 1 FROM public.complaint_current_teams() t WHERE t.member_id = NEW.trainer_id)
       AND NOT EXISTS (SELECT 1 FROM public.complaint_current_teams() t WHERE t.member_id = NEW.trainer_id AND public.complaint_in_window(v_at, t.team_start, t.team_end)) THEN
      RETURN NULL;
    END IF;
    v_targets := public.complaint_push_targets(NEW.trainer_id);
    IF array_length(v_targets, 1) IS NULL THEN RETURN NULL; END IF;
    SELECT split_part(public.complaint_name(c.first_name, c.last_name), ' ', 1) INTO v_client FROM public.clients c WHERE c.id = NEW.client_id;
    SELECT split_part(public.complaint_name(p.first_name, p.last_name), ' ', 1) INTO v_expert FROM public.profiles p WHERE p.id = NEW.trainer_id;
    v_when := to_char(COALESCE(NEW.scheduled_at, NEW.created_at) AT TIME ZONE 'Asia/Kolkata', 'FMDD Mon');
    SELECT string_agg(i, ', ') INTO v_issues FROM jsonb_array_elements_text(COALESCE(NEW.log_review->'issues', '[]'::jsonb)) i;
    PERFORM public.complaints_push(v_targets, 'Client flagged a log',
      COALESCE(v_client, 'A client') || ' says ' || COALESCE(v_expert, 'the expert') || '''s session of ' || v_when ||
        ' was not logged accurately' || CASE WHEN v_issues IS NULL OR v_issues = '' THEN '' ELSE ' (' || v_issues || ')' END || '. Tap to review.',
      jsonb_build_object('type', 'client_complaint', 'route', 'client-complaints', 'kind', 'log', 'session_id', NEW.id));
  EXCEPTION WHEN others THEN
    RAISE WARNING 'trg_fn_log_review_flagged: % (session %)', SQLERRM, NEW.id;
  END;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.trg_fn_log_review_flagged() FROM PUBLIC, anon, authenticated;

COMMIT;

-- ---------------------------------------------------------------------------
-- Probe (rolled back, pushes silenced): 6 checks.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE IF NOT EXISTS complaints_live_probe (step int, check_name text, expected text, result text);
TRUNCATE complaints_live_probe;

DO $probe$
DECLARE
  v_mgr uuid; v_member uuid; v_hod uuid; v_session uuid; v_start date; v_old uuid;
  x jsonb; v_res text;
  v_names text[] := '{}'; v_expected text[] := '{}'; v_results text[] := '{}';
  as_user CONSTANT text := 'request.jwt.claim.sub';
BEGIN
  PERFORM set_config('complaints.silent', 'on', true);
  SELECT t.manager_id, t.member_id, t.team_start INTO v_mgr, v_member, v_start FROM public.complaint_current_teams() t
   WHERE NOT t.is_manager AND t.manager_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.training_sessions ts WHERE ts.trainer_id = t.member_id AND ts.client_id IS NOT NULL AND ts.log_review IS NULL)
   ORDER BY t.team_id LIMIT 1;
  SELECT p.id INTO v_hod FROM public.profiles p WHERE p.role_specialization::text ILIKE '%physio_hod%' AND p.status = 'active' LIMIT 1;
  -- a manager of a team that is over (not live) and of no live team
  SELECT ms.manager_id INTO v_old FROM public.manager_score ms
   WHERE ms.team_end IS NOT NULL AND ms.team_end < (now() AT TIME ZONE 'Asia/Kolkata')::date
     AND NOT EXISTS (SELECT 1 FROM public.complaint_current_teams() t WHERE t.member_id = ms.manager_id) LIMIT 1;
  SELECT ts.id INTO v_session FROM public.training_sessions ts WHERE ts.trainer_id = v_member AND ts.client_id IS NOT NULL AND ts.log_review IS NULL ORDER BY ts.created_at DESC LIMIT 1;
  BEGIN
    IF v_mgr IS NULL OR v_session IS NULL THEN RAISE EXCEPTION 'no live team with a member who has an unreviewed training'; END IF;
    -- 1. only live teams: every team in scope is ongoing today
    v_names := array_append(v_names, 'complaint_current_teams: live teams only'); v_expected := array_append(v_expected, 'all live');
    v_results := array_append(v_results, CASE WHEN EXISTS (SELECT 1 FROM public.complaint_current_teams() t WHERE t.team_start > (now() AT TIME ZONE 'Asia/Kolkata')::date OR (t.team_end IS NOT NULL AND t.team_end < (now() AT TIME ZONE 'Asia/Kolkata')::date)) THEN 'a finished or future team leaked' ELSE 'all live' END);
    -- 2. a manager of a finished team only sees nothing (manager kind, empty scope)
    IF v_old IS NOT NULL THEN
      PERFORM set_config(as_user, v_old::text, true);
      v_names := array_append(v_names, 'a manager whose only team is over sees nothing'); v_expected := array_append(v_expected, 'logs 0, reports 0');
      v_results := array_append(v_results, 'logs ' || jsonb_array_length(public.get_inaccurate_logs('all', NULL, 50)) || ', reports ' || jsonb_array_length(public.get_specialist_reports('all', NULL, 50)));
    END IF;
    -- 3. a flag dated before the live competition started is hidden from the manager and the HOD
    UPDATE public.training_sessions SET log_review = jsonb_build_object('verdict', 'inaccurate', 'at', to_char((v_start - 1)::timestamp AT TIME ZONE 'Asia/Kolkata' AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'issues', jsonb_build_array('loads'), 'note', 'Probe: before the competition') WHERE id = v_session;
    PERFORM set_config(as_user, v_mgr::text, true);
    v_res := CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(public.get_inaccurate_logs('all', NULL, 200)) r WHERE r->>'session_id' = v_session::text) THEN 'manager sees' ELSE 'manager hidden' END;
    PERFORM set_config(as_user, v_hod::text, true);
    v_res := v_res || ', ' || CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(public.get_inaccurate_logs('all', NULL, 200)) r WHERE r->>'session_id' = v_session::text) THEN 'HOD sees' ELSE 'HOD hidden' END;
    v_names := array_append(v_names, 'a flag dated before the live competition is hidden'); v_expected := array_append(v_expected, 'manager hidden, HOD hidden');
    v_results := array_append(v_results, v_res);
    -- 4. the same flag dated now shows, and counts
    UPDATE public.training_sessions SET log_review = log_review || jsonb_build_object('at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) WHERE id = v_session;
    PERFORM set_config(as_user, v_mgr::text, true);
    x := public.count_client_complaints();
    v_names := array_append(v_names, 'the same flag dated today shows for the manager and counts'); v_expected := array_append(v_expected, 'shown, counted');
    v_results := array_append(v_results, CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(public.get_inaccurate_logs('open', NULL, 200)) r WHERE r->>'session_id' = v_session::text) THEN 'shown' ELSE 'hidden' END || ', ' || CASE WHEN (x->>'logs_open')::int >= 1 THEN 'counted' ELSE 'not counted' END);
    RAISE EXCEPTION 'PROBE_DONE';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'PROBE_DONE' THEN
      v_names := array_append(v_names, 'probe stopped'); v_expected := array_append(v_expected, 'ran'); v_results := array_append(v_results, 'could not run: ' || SQLERRM);
    END IF;
  END;
  PERFORM set_config(as_user, '', true);
  INSERT INTO complaints_live_probe (step, check_name, expected, result)
  SELECT n, v_names[n], v_expected[n], v_results[n] FROM generate_subscripts(v_names, 1) AS n;
END
$probe$;

INSERT INTO complaints_live_probe (step, check_name, expected, result)
SELECT 20, 'window helper', 'true, false, false, true', public.complaint_in_window('2026-11-03 10:00+05:30', '2026-08-01', '2027-01-31')::text || ', ' || public.complaint_in_window('2026-07-31 23:00+05:30', '2026-08-01', '2027-01-31')::text || ', ' || public.complaint_in_window('2027-02-01 00:30+05:30', '2026-08-01', '2027-01-31')::text || ', ' || public.complaint_in_window('2020-01-01', NULL, NULL)::text
UNION ALL
SELECT 21, 'probe flags left behind', '0', (SELECT count(*)::text FROM public.training_sessions WHERE log_review->>'note' LIKE 'Probe:%');

SELECT step, check_name, expected, result FROM complaints_live_probe ORDER BY step;
```

## 4. Check on the iPhone
1. `node tests/rules/client_complaints_test.js`: ALL PASS (46).
2. As Sagar (a manager): the drawer shows Client complaints; the page lists the flags about his team only (status Open);
   open a card, "As logged" shows the exercises; Mark handled with a note and the toggle: the card turns HANDLED with
   "Handled by Sagar, <date> · log corrected · <note>"; Reopen: back to OPEN. Reports: the ones about his team's experts,
   never one about himself.
3. As the admin: the manager chips (All managers, one per manager, No team); every team's flags; a report by an unmatched
   name under No team; the report sheet: Start review / Confirm (month free) / Dismiss, Reopen as new.
4. A trainer who is no manager: no drawer item; the route (from a push) says "Manager access required".
5. A push "Client flagged a log" opens the page.
Server: migration 20261104100000 PGlite-tested 21 of 21 and handed to the owner on 3 Nov 2026 (the status line of the
feature file says when it ran).
