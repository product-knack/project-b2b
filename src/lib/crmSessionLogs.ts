/* CRM Session Logs in the app (19 Nov 2026, owner with a screenshot of the web page: "add a page named Session Logs,
   inside show this session cancel code"). The same page as the web Session Logs (hub-track src/pages/crm/DailyTask.tsx,
   "Today's Sessions" tab): one IST day of the signed-in CRM's clients' sessions from the definer function
   crm_daily_sessions(_date), the four status counts (a tap filters), the day's progress, and on each row of a
   Session-code member the paid cancellation code (hidden until tapped). Since migration 20261119200000 the function
   returns the code only to crm / crm_manager / ops / admin / super_admin.
   Pure rules only (no native imports), tested by tests/rules/crm_session_logs_test.js. */

export type SessionLogStatus = 'scheduled' | 'completed' | 'cancelled';
export type SessionLogFilter = 'all' | SessionLogStatus;

export interface SessionLogRow {
  id: string;
  scheduledAt: string;
  clientName: string;
  trainerName: string;
  modality: string;
  status: SessionLogStatus;
  /** Completed through a same-day workout log that was not linked to this roster row. */
  unlinked: boolean;
  /** When the workout was logged, or when the cancellation was recorded. */
  loggedAt: string | null;
  /** Session code switched on for the member (only then a paid cancellation needs the code). */
  otp: boolean;
  paidCancelCode: string | null;
  paidCancelVerifiedAt: string | null;
}

const statusOf = (v: unknown): SessionLogStatus => (v === 'completed' || v === 'cancelled' ? v : 'scheduled');
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Rows of crm_daily_sessions, in the page's shape, ordered by time (the function already orders them). */
export const parseSessionLogs = (data: unknown): SessionLogRow[] => {
  if (!Array.isArray(data)) return [];
  return (data as any[])
    .filter((r) => r && r.id)
    .map((r) => ({
      id: String(r.id),
      scheduledAt: String(r.scheduled_at ?? ''),
      clientName: text(r.client_name) || 'Client',
      trainerName: text(r.trainer_name) || 'Trainer',
      modality: text(r.modality) || 'Session',
      status: statusOf(r.row_status),
      unlinked: r.unlinked === true,
      loggedAt: text(r.logged_at) || null,
      otp: r.otp === true,
      paidCancelCode: text(r.paid_cancellation_code) || null,
      paidCancelVerifiedAt: text(r.paid_cancel_verified_at) || null,
    }))
    .sort((a, b) => (Date.parse(a.scheduledAt) || 0) - (Date.parse(b.scheduledAt) || 0));
};

export const sessionLogCounts = (rows: SessionLogRow[]) => ({
  total: rows.length,
  completed: rows.filter((r) => r.status === 'completed').length,
  cancelled: rows.filter((r) => r.status === 'cancelled').length,
  scheduled: rows.filter((r) => r.status === 'scheduled').length,
});

/** Percent of the day's sessions done (0 when there is none). */
export const donePercent = (completed: number, total: number): number => (total > 0 ? Math.round((completed / total) * 100) : 0);

/** Status filter and search (client, trainer or modality), as on the web. */
export const filterSessionLogs = (rows: SessionLogRow[], filter: SessionLogFilter, search: string): SessionLogRow[] => {
  const q = search.trim().toLowerCase();
  return rows.filter((r) => {
    if (filter !== 'all' && r.status !== filter) return false;
    if (q && !r.clientName.toLowerCase().includes(q) && !r.trainerName.toLowerCase().includes(q) && !r.modality.toLowerCase().includes(q)) return false;
    return true;
  });
};

/** Tapping the active card again goes back to All (the Total card is never "off"). */
export const nextFilter = (current: SessionLogFilter, tapped: SessionLogFilter): SessionLogFilter =>
  current === tapped && tapped !== 'all' ? 'all' : tapped;

/** The paid cancellation code is shown on a row only for a Session-code member whose code reached us. */
export const showsPaidCancelCode = (r: Pick<SessionLogRow, 'otp' | 'paidCancelCode'>): boolean => r.otp && !!r.paidCancelCode;

/** Two letters of the client's name. */
export const initialsOf = (name: string): string =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => Array.from(p)[0].toUpperCase()).join('') || '?';

/* ---------------- dates, in IST ---------------- */
const IST_MS = 330 * 60_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** YYYY-MM-DD of today in IST (offset in days). */
export const istDateKey = (nowMs: number, offsetDays = 0): string =>
  new Date(nowMs + IST_MS + offsetDays * 86_400_000).toISOString().slice(0, 10);

/** The day before / after a YYYY-MM-DD key. */
export const shiftDateKey = (key: string, delta: number): string => {
  const t = Date.parse(`${key}T00:00:00Z`);
  return Number.isFinite(t) ? new Date(t + delta * 86_400_000).toISOString().slice(0, 10) : key;
};

/** "Thu, 19 Nov 2026" for a YYYY-MM-DD key. */
export const dateKeyLabel = (key: string): string => {
  const d = new Date(`${key}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return key;
  return `${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

/** "4:30 PM" in IST. */
export const istTime = (iso: string | null | undefined): string => {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return '--';
  const d = new Date(t + IST_MS);
  const h = d.getUTCHours();
  return `${h % 12 === 0 ? 12 : h % 12}:${String(d.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

/* ---------------- copy ---------------- */
export const SESSION_LOGS_TITLE = 'Session Logs';
export const SESSION_LOGS_SUB = "Live status of your clients' sessions";
export const PAID_CANCEL_HINT = 'Paid cancellation code. Give it to the trainer only when the paid cancellation is agreed with the client.';
export const emptyDayLine = (key: string): string => `No sessions scheduled for ${dateKeyLabel(key)}.`;
export const NO_MATCH_LINE = 'No sessions match the current filter.';
export const loggedLine = (r: Pick<SessionLogRow, 'status' | 'loggedAt'>): string | null =>
  r.loggedAt && r.status !== 'scheduled' ? `${r.status === 'cancelled' ? 'Cancelled' : 'Logged'} ${istTime(r.loggedAt)}` : null;
export const usedCodeLine = (verifiedAt: string): string => `Code used by the trainer at ${istTime(verifiedAt)}`;
