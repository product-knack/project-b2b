/* Shape of training_sessions.voice_notes (30 Sep 2026). Kept import-free so the
   query modules that read the column (trainerQueries, clientQueries) can share it
   without pulling in the upload / outbox code. */
export type SessionVoiceNote = {
  id: string;
  path: string;
  duration_sec: number;
  recorded_at: string;
  recorded_by: string | null;
  recorded_by_name: string | null;
  source: 'workout_form' | 'roster';
  /** The composer's checkbox "The client has pain or discomfort" (14 Oct 2026); older notes read false. */
  pain_discomfort: boolean;
};

/** True when any note of the session was recorded with the pain / discomfort box ticked. */
export const hasPainNote = (notes: SessionVoiceNote[] | null | undefined): boolean =>
  Array.isArray(notes) && notes.some((n) => n.pain_discomfort === true);

/** training_sessions.voice_notes, tolerant of null / a JSON string / junk elements. */
export function parseVoiceNotes(v: unknown): SessionVoiceNote[] {
  let arr: any = v;
  if (typeof arr === 'string') { try { arr = JSON.parse(arr); } catch { return []; } }
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((n) => n && typeof n === 'object' && typeof n.path === 'string' && n.path)
    .map((n) => ({
      id: String(n.id ?? n.path),
      path: String(n.path),
      duration_sec: Math.max(1, Math.round(Number(n.duration_sec) || 1)),
      recorded_at: String(n.recorded_at ?? ''),
      recorded_by: n.recorded_by ?? null,
      recorded_by_name: n.recorded_by_name ?? null,
      source: n.source === 'workout_form' ? 'workout_form' : 'roster',
      pain_discomfort: n.pain_discomfort === true,
    }));
}

/** True when `ymd` (an IST day) is today or at most `days` days ago. `today` is injectable for tests. */
export const voiceDayWithin = (ymd: string, days: number, today: string = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const diff = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${ymd}T00:00:00Z`)) / 864e5);
  return diff >= 0 && diff <= days;
};
