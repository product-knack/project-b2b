/* QHP Manager page: the pure rules (20 Nov 2026). No React Native, no network: tested by
   tests/rules/qhp_manager_rules_test.js.

   Why this file exists. The page used to be fed by ONE query (useQhpManager) that loaded everything for every tab
   (Task Pending, every booking, the ids with data, every active client, 45 days of training sessions, the
   reschedule and scheduling requests) and repeated all of it every 30 seconds; nothing showed until all of it had
   arrived. The web page had the same complaint from the owner ("QHP manager page takes a lot of time to open") and
   was split on 20 Nov 2026 (hub-track src/lib/qhpManagerRows.ts). Here the data is split the same way and these
   rules put the pieces together:
     Task Pending   its own small request, refreshed every 30 seconds
     the inbox      reschedule requests, scheduling requests, the two tab counts, refreshed every 30 seconds
     all bookings   only when the Manager or QHP Review tab is open, not repeated on a timer
     recent clients (active clients with a session in the last 45 days) only when the Manager tab is open

   Two rules that changed with it, both to match the web:
     - a booking "has data" when one of the three assessment blobs is filled: not empty, not {}, not a json null
       (QHP_HAS_DATA_FILTER, the web's text). Before, the app counted {} and a json null as data.
     - a cancelled booking does not count: on Task Pending the client goes back to Not Scheduled. */

/** PostgREST `or` filter, the same text as the web (hub-track src/lib/qhpManagerRows.ts QHP_HAS_DATA_FILTER). */
const BLOBS = ['new_client_assessment_data', 'existing_client_assessment_data', 'qhp_data'] as const;
export const QHP_HAS_DATA_FILTER = BLOBS.map((c) => `and(${c}.not.is.null,${c}.neq.{},${c}.neq.null)`).join(',');

/** Task Pending looks at client cards created from this day (as on the web). */
export const QHP_CLIENT_CUTOFF = '2026-03-04T00:00:00+00:00';
/** QHP Review lists QHPs completed from this day (as on the web). */
export const QHP_REVIEW_CUTOFF = '2026-05-01T00:00:00+05:30';
/** The short columns of a booking: no assessment blob is in here. */
export const QHP_BOOKING_COLUMNS =
  'id, client_id, client_name, coach_id, assessment_date, assessment_time, assessment_scheduled, completed, cancelled, qhp_manager, sla_deadline_at, reschedule_status, reschedule_data, assessment_file_url';

export type QhpAssessment = {
  id: string; clientId: string | null; clientName: string; assessorName: string;
  scheduledAt: string | null; completed: boolean; overdue: boolean;
  completedAt: string | null;                       // conducted timestamp
  status: 'completed' | 'pending' | 'overdue';      // web calculateQHPStatus (documentation status)
  validityOverdue: boolean;                         // web isValidityOverdue (45d cycle, active client, latest completed)
  managerReview: 'approved' | 'not_approved' | null; stage: 'not_scheduled' | 'scheduled' | 'completed';
};
export type QhpReschedule = { id: string; clientName: string; assessorName: string; currentAt: string | null; proposedAt: string | null; requestedAt: string | null; remark: string | null };

const DAY_MS = 86_400_000;
const setOf = (ids: Iterable<string> | null | undefined): Set<string> => (ids instanceof Set ? ids : new Set(ids ?? []));
const atOf = (r: any): string | null => (r?.assessment_date ? `${String(r.assessment_date).slice(0, 10)}T${r.assessment_time ? String(r.assessment_time) : '00:00:00'}` : null);

/* ---------------- Task Pending ---------------- */

export type TaskBooking = { id: string; date: string | null; time: string | null };

/** Which booking a pending client has, and which clients are already done. A cancelled booking is left out
    entirely (it is neither a booking nor "done"), exactly as the web's Task Pending tab does. When a client has
    more than one live booking the last one wins, as before. */
export function taskPendingBookings(
  bookings: Array<{ id: string; client_id: string | null; assessment_date?: string | null; assessment_time?: string | null; cancelled?: unknown }>,
  idsWithData: Iterable<string> | null | undefined,
): { bookingOf: Record<string, TaskBooking>; doneClientIds: string[] } {
  const withData = setOf(idsWithData);
  const bookingOf: Record<string, TaskBooking> = {};
  const done: Record<string, true> = {};
  for (const b of bookings ?? []) {
    if (!b?.client_id || b.cancelled) continue;
    bookingOf[b.client_id] = { id: b.id, date: b.assessment_date ?? null, time: b.assessment_time ?? null };
    if (withData.has(b.id)) done[b.client_id] = true;
  }
  return { bookingOf, doneClientIds: Object.keys(done) };
}

/** The three lists of Task Pending from the pending clients: a client with a live booking is Scheduled; without
    one, On Hold when the QHP is on hold, else Not Scheduled. */
export function bucketTaskPending<T extends { clientId: string; hasQHP: boolean }>(pending: T[], holdClientIds: Iterable<string> | null | undefined) {
  const onHold = setOf(holdClientIds);
  return {
    taskScheduled: pending.filter((c) => c.hasQHP),
    taskOnHold: pending.filter((c) => !c.hasQHP && onHold.has(c.clientId)),
    taskNotScheduled: pending.filter((c) => !c.hasQHP && !onHold.has(c.clientId)),
  };
}

/* ---------------- all bookings ---------------- */

/** A booking has data when its id is among the ids with data, or a report file is attached (web
    isAssessmentCompleted). */
export const bookingHasData = (row: { id: string; assessment_file_url?: string | null }, withData: Set<string>): boolean =>
  !!row?.assessment_file_url || withData.has(row.id);

/** The rows of the Manager list, the calendar and QHP Review. `validityOverdue` is left false here: it needs the
    recent-clients list, which loads on its own (markValidityOverdue). */
export function toQhpAssessments(rows: any[], idsWithData: Iterable<string> | null | undefined, assessorNames: Record<string, string>, nowMs: number = Date.now()): QhpAssessment[] {
  const withData = setOf(idsWithData);
  return (rows ?? []).map((r: any) => {
    const hasData = bookingHasData(r, withData);
    const completedAt: string | null = r.completed ?? null;
    // web calculateQHPStatus: data = completed; no data and not conducted = pending; conducted more than 45 days
    // ago without data = overdue; else pending.
    const status: QhpAssessment['status'] = hasData
      ? 'completed'
      : !completedAt
        ? 'pending'
        : (nowMs - new Date(completedAt).getTime()) / DAY_MS > 45 ? 'overdue' : 'pending';
    const slaOverdue = !completedAt && !!r.sla_deadline_at && new Date(r.sla_deadline_at).getTime() < nowMs;
    return {
      id: r.id, clientId: r.client_id ?? null, clientName: r.client_name || '—',
      assessorName: r.coach_id ? assessorNames[r.coach_id] ?? 'Unassigned' : 'Unassigned',
      scheduledAt: atOf(r), completed: hasData, overdue: slaOverdue,
      completedAt, status, validityOverdue: false,
      managerReview: r.qhp_manager === 'approved' ? 'approved' : r.qhp_manager === 'not_approved' ? 'not_approved' : null,
      stage: hasData ? 'completed' : r.assessment_scheduled === true ? 'scheduled' : 'not_scheduled',
    };
  });
}

/** web isValidityOverdue: for each ACTIVE client with a session in the last 45 days, the latest QHP that has data
    and was conducted is overdue when it was conducted more than 45 days ago. `recentClientIds` null = that list
    has not arrived yet: nothing is marked. */
export function markValidityOverdue(assessments: QhpAssessment[], recentClientIds: Iterable<string> | null | undefined, nowMs: number = Date.now()): QhpAssessment[] {
  if (recentClientIds == null) return assessments;
  const recent = setOf(recentClientIds);
  const latestDone: Record<string, QhpAssessment> = {};
  for (const a of assessments) {
    if (!a.clientId || !a.completed || !a.completedAt) continue;
    const prev = latestDone[a.clientId];
    if (!prev || new Date(a.completedAt).getTime() > new Date(prev.completedAt as string).getTime()) latestDone[a.clientId] = a;
  }
  return assessments.map((a) => {
    const over = !!a.clientId && latestDone[a.clientId]?.id === a.id && recent.has(a.clientId)
      && (nowMs - new Date(a.completedAt as string).getTime()) / DAY_MS > 45;
    return over === a.validityOverdue ? a : { ...a, validityOverdue: over };
  });
}

/** QHP Review: QHPs conducted from QHP_REVIEW_CUTOFF, newest first; pending = not yet approved or refused. */
export function qhpReviewLists(assessments: QhpAssessment[]) {
  const cutoff = new Date(QHP_REVIEW_CUTOFF).getTime();
  const all = assessments
    .filter((a) => a.completedAt && new Date(a.completedAt).getTime() >= cutoff)
    .sort((a, b) => new Date(b.completedAt as string).getTime() - new Date(a.completedAt as string).getTime());
  return {
    pending: all.filter((a) => a.managerReview === null),
    all,
    approvedCount: all.filter((a) => a.managerReview === 'approved').length,
    notApprovedCount: all.filter((a) => a.managerReview === 'not_approved').length,
  };
}

/** The pending reschedule requests among booking rows. */
export function qhpReschedulesOf(rows: any[], assessorNames: Record<string, string>): QhpReschedule[] {
  return (rows ?? []).filter((r) => r?.reschedule_status === 'pending').map((r) => {
    const rd = r.reschedule_data || {};
    return {
      id: r.id, clientName: r.client_name || '—', assessorName: r.coach_id ? assessorNames[r.coach_id] ?? '—' : '—',
      currentAt: atOf(r), proposedAt: rd.proposed_date ? `${String(rd.proposed_date).slice(0, 10)}T${rd.proposed_time || '00:00:00'}` : null,
      requestedAt: rd.requested_at ?? null, remark: rd.remark ?? null,
    };
  });
}

/** The numbers on the Manager tab's tiles, from the list on screen. */
export const qhpBookingCounts = (assessments: QhpAssessment[]) => ({
  assessScheduled: assessments.filter((a) => a.stage === 'scheduled').length,
  completed: assessments.filter((a) => a.status === 'completed').length,
  overdue: assessments.filter((a) => a.validityOverdue).length,
  total: assessments.length,
});

/** Splits ids into requests of at most `size` (a long list of ids does not fit in one request address). */
export const idChunks = <T,>(ids: T[], size = 100): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
};

/* ---------------- the alert card ---------------- */

/** "20-Nov-2026 6:10 PM" in India time (the web's dd-MMM-yyyy h:mm a). */
export const qhpCardCreatedLabel = (iso: string | null | undefined): string => {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return '';
  const d = new Date(t + 330 * 60_000);
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const h = d.getUTCHours();
  return `${String(d.getUTCDate()).padStart(2, '0')}-${MON[d.getUTCMonth()]}-${d.getUTCFullYear()} ${h % 12 === 0 ? 12 : h % 12}:${String(d.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
export const QHP_NOT_SCHEDULED_SUB = 'The client card is ready. Schedule the QHP and assign an assessor.';
export const qhpNotScheduledMore = (hidden: number): string => `+${hidden} more in Task Pending`;
