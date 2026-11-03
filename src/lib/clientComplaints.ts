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
export const EMPTY_LOGS_TEAM = 'No flagged logs about your team. Nothing flagged since 21 Oct 2026.';
export const EMPTY_LOGS_ALL = 'No flagged logs. Nothing flagged since 21 Oct 2026.';
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
