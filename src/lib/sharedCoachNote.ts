/* Shared coach note: the copy of the session voice notes (26 Oct 2026).
   Owner: "retitle it so a trainer sees and understands very easily that we record anything like injury,
   pain etc. to share with other coaches, bold and highlighted; retitle the listening side too".
   Name chosen by the owner: "shared note from coach". Highlight: amber on the record card, red for pain.
   Pure: every screen (Add Workout, the doctor's Log Session, the therapist's Add Session, Today's Roster,
   the client's Sessions, the check-in popup, My Crew) reads its words from here so they never drift. */

export const SHARED_NOTE = 'Shared coach note';
export const SHARED_NOTES = 'Shared coach notes';

/** The chip on a logged session: "Shared coach note" when none yet, else "2 shared coach notes". */
export const sharedNoteChip = (count: number): string => (count <= 0 ? SHARED_NOTE : `${count} shared coach note${count === 1 ? '' : 's'}`);

/* ---------- recording ---------- */
export const RECORD_KICKER = 'SHARED NOTE FOR OTHER COACHES';
export const RECORD_TITLE = 'Record anything the next coach must know';
export const recordLine = (clientFirstName: string | null | undefined): string =>
  `Injury, pain, discomfort, a movement to avoid, what worked. Every coach who trains ${(clientFirstName ?? '').trim() || 'this client'} hears this before the session.`;
export const PAIN_TITLE = 'Any injury, pain or discomfort today?';
export const PAIN_LINE = 'Choose, then say it in the note so every coach knows.';
export const PAIN_TAG_ON = 'INJURY / PAIN';
export const PAIN_TAG_OFF = 'NO PAIN';
export const RECORD_FIRST = 'Record shared note';
export const RECORD_MORE = 'Record another note';
export const RECORD_WAIT = 'Answer Yes or No first';
export const recordHint = (where: 'roster' | 'sessions'): string =>
  `Up to 5 notes, 5 minutes each. Shared with every coach of this client; you can add more from ${where === 'roster' ? "Today's Roster" : 'the Sessions list'}.`;

/* ---------- listening ---------- */
export const PLAYER_KICKER = 'SHARED COACH NOTES';
export const PAIN_PLAYER_LINE = 'Injury, pain or discomfort was reported. Listen before you train.';
export const LISTEN_BUTTON = 'Listen';
export const listenButton = (count: number): string => (count > 1 ? `${LISTEN_BUTTON} · ${count}` : LISTEN_BUTTON);
export const SHEET_TITLE = SHARED_NOTES;
export const SHEET_ADD = 'ADD TO THE SHARED NOTES';
export const SHEET_EMPTY = 'No shared coach note on this session yet.';
export const CHECKIN_TITLE = 'Shared notes from the coach';
export const checkinLine = (clientFirstName: string | null | undefined): string =>
  `Listen before you start ${(clientFirstName ?? '').trim() || 'the'} session.`.replace('start the session', 'start the session');
export const CREW_CHIP = 'SHARED NOTE';
