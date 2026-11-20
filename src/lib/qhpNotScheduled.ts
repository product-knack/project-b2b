/**
 * QHPs that are not scheduled yet, for the QHP manager's dashboard alert (20 Nov 2026).
 *
 * The rule is the one behind QHP Manager > Task Pending > Not Scheduled: the client card exists, the lead is
 * in "QHP Booked", there is no QHP booking for the client (a cancelled booking does not count), and the QHP
 * is not on hold. On top of that the alert only counts client cards created from a start time, so the old
 * backlog does not land on a new manager's dashboard.
 *
 * Pure functions only: the screen passes the rows in.
 */

/** The alert counts client cards created from this moment (owner, 20 Nov 2026: "from today 7 am"). */
export const QHP_NOT_SCHEDULED_ALERT_FROM = "2026-11-20T07:00:00+05:30";

export interface PendingQhpClient {
  id: string;
  first_name: string | null;
  last_name: string | null;
  created_at: string;
}

export interface PendingQhpBooking {
  client_id: string | null;
  cancelled?: unknown;
}

/**
 * The clients whose QHP is still to be scheduled, the one waiting longest first.
 * `bookings` are the clients' coach_assessment rows, `holdClientIds` the clients whose QHP is on hold.
 */
export function qhpNotScheduledSince(
  clients: PendingQhpClient[],
  bookings: PendingQhpBooking[],
  holdClientIds: Array<string | null | undefined>,
  since: string = QHP_NOT_SCHEDULED_ALERT_FROM,
): PendingQhpClient[] {
  const sinceMs = Date.parse(since);
  const booked = new Set<string>();
  for (const b of bookings ?? []) {
    // A cancelled QHP no longer counts as scheduled, exactly as on the Task Pending tab.
    if (!b?.client_id || b.cancelled) continue;
    booked.add(b.client_id);
  }
  const onHold = new Set((holdClientIds ?? []).filter(Boolean) as string[]);
  const seen = new Set<string>();
  return (clients ?? [])
    .filter((c) => {
      if (!c?.id || seen.has(c.id)) return false;
      seen.add(c.id);
      const created = Date.parse(c.created_at);
      if (Number.isNaN(created) || (!Number.isNaN(sinceMs) && created < sinceMs)) return false;
      return !booked.has(c.id) && !onHold.has(c.id);
    })
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
}

/** "1 QHP is not scheduled yet" / "3 QHPs are not scheduled yet". */
export const qhpNotScheduledTitle = (count: number): string =>
  count === 1 ? "1 QHP is not scheduled yet" : `${count} QHPs are not scheduled yet`;

/** How long a client card has been waiting: "12m", "3h 5m", "2d 4h". */
export function waitingLabel(createdAt: string, now: Date = new Date()): string {
  const mins = Math.max(0, Math.floor((now.getTime() - Date.parse(createdAt)) / 60000));
  if (Number.isNaN(mins)) return "";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
