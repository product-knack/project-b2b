/* Queued workout logs by roster slot (15 Oct 2026). Import-free so the roster, the
   outbox and the offline test share one rule.
   Live cause of duplicate sessions (14 and 15 Oct 2026): a slot logged while offline stayed
   "Log Workout" on the roster card (its logged state came only from the server), the
   trainer logged it again, and both copies synced with different ids. The card now reads
   this map first. */

export type QueueStatus = 'pending' | 'syncing' | 'failed';
export type QueueItemLike = { id: string; kind: string; status: QueueStatus; error?: string; userId?: string; payload?: any };
export type QueuedWorkout = { id: string; status: QueueStatus; error?: string; clientId: string | null; sessionId: string | null };

/** One entry per roster slot that has a workout log waiting on this device (pending, syncing
    or failed), for the signed-in user. The oldest item wins when two name the same slot. */
export function workoutQueueBySlot(list: QueueItemLike[], uid: string | null): Map<string, QueuedWorkout> {
  const m = new Map<string, QueuedWorkout>();
  for (const i of list) {
    if (i.kind !== 'workout-log') continue;
    if (i.userId && uid && i.userId !== uid) continue;
    const slot = i.payload?.scheduleSessionId;
    if (typeof slot !== 'string' || !slot) continue;
    if (!m.has(slot)) m.set(slot, { id: i.id, status: i.status, error: i.error, clientId: i.payload?.clientId ?? null, sessionId: i.payload?.sessionId ?? null });
  }
  return m;
}

/** The roster card's line for a queued slot. */
export const queuedLine = (q: QueuedWorkout, online: boolean): { text: string; tone: 'gold' | 'blue' | 'red' } => {
  if (q.status === 'syncing') return { text: 'Syncing this log…', tone: 'blue' };
  if (q.status === 'failed') return { text: 'Sync failed · review it on Home', tone: 'red' };
  return { text: online ? 'Saved on this device · syncing soon' : 'Saved on this device · waiting for network', tone: 'gold' };
};
