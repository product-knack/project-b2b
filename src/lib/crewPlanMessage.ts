/* My Crew "Add session": the chat message that puts the session on the plan card (21 Nov 2026). Pure rules only (no
   native imports), tested by tests/rules/crew_plan_message_test.js. The network part is crewPlanMessageSubmit.ts.

   Why. "Add session" does two things in order: the roster row (plan_manager_add_session), then a "Manager added ..."
   message in the team chat. My Crew draws each member's day from those chat messages, not from the roster. On
   21 Nov 2026 a manager's add for Asad Hussain saved the roster row at 12:22 PM and the chat message then failed.
   The app said nothing and left the sheet open; a second tap got "Already scheduled"; the session was on Today's
   Roster and was logged, but never on My Crew.
   Now a chat message that cannot be sent is kept on the phone in the offline outbox (kind 'crew-plan-message') and
   sent by itself when the connection is back; the sheet closes and says so in plain words. */

export type CrewPlanAddPayload = {
  date: string; client_id: string; name: string; trainer_id: string; time: string; modality: string | null; schedule_id: string | null;
  forced?: boolean; replaced_schedule_id?: string | null; replaced_trainer_id?: string | null; replaced_trainer_name?: string | null;
};
/** What the outbox keeps for one unsent message. */
export type CrewPlanMessageItem = { teamId: string; senderId: string; kind: 'plan_add'; payload: CrewPlanAddPayload; body: string };

const fmt12 = (t: string): string => {
  const [h, m] = String(t).split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return String(t);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

/** The line shown under Waiting to Sync for an unsent message. */
export const crewPlanMessageLabel = (payload: Pick<CrewPlanAddPayload, 'name' | 'time'>): string =>
  `My Crew: ${String(payload.name ?? '').trim() || 'Client'} at ${fmt12(payload.time)}`;

/** The outbox item for a message that could not be sent, or null when there is nothing safe to queue (no team, no
    sender, no roster row: without the roster row's id a later send could not be told apart from a second one). */
export const crewPlanMessageItem = (teamId: string | null | undefined, senderId: string | null | undefined, payload: CrewPlanAddPayload, body: string): CrewPlanMessageItem | null => {
  if (!teamId || !senderId || !payload?.schedule_id || !String(body ?? '').trim()) return null;
  return { teamId, senderId, kind: 'plan_add', payload, body: String(body).trim() };
};

export const CREW_ADD_SAVED_TITLE = 'Session added';
/** Said when the roster row is saved and the chat message is waiting on the phone. */
export const crewAddQueuedText = (clientName: string): string =>
  `${clientName}'s session is on the roster. The team chat message could not be sent right now. It will be sent by itself when the connection is back, and My Crew will show the session then.`;
/** Said when the message could not even be kept on the phone. */
export const crewAddNotQueuedText = (clientName: string): string =>
  `${clientName}'s session is on the roster, but the team chat message could not be sent, so My Crew does not show it yet. Tell the tech team.`;
