import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Directory, File, Paths } from 'expo-file-system';
import { supabase } from './supabase';
import { withTimeout, uploadWithTimeout, NET_MS } from './withTimeout';
import { uuidv4 } from './clientQueries';
import { enqueueOutbox, submitItem, SubmitItemResult } from './offline';

/* ============ Workout session voice notes (30 Sep 2026) ============
   A trainer records spoken notes about a logged session: in the workout log form
   (under RPE) and later from the logged card on Today's Roster. Notes live as a
   JSON list on training_sessions.voice_notes (hub-track migration 20260930100000)
   and play back to back as ONE audio on the client's Sessions list.

   Contract:
   - bucket `session-voice-notes` (private, 25 MB, audio only); path
     <client_id>/<workout_session_id>/<user_id>-<epoch>.m4a; staff roles may
     upload / read, the uploader may delete its own object, nothing is updated.
   - the row is written ONLY by RPC append_session_voice_note(workout_session_id,
     path, duration_sec, source): locks the training_sessions row found by
     workout_session_id, checks the caller (the session's trainer, an active
     trainer of the client, or admin), caps at 5, appends
     { id, path, duration_sec, recorded_at, recorded_by, recorded_by_name, source }.
   - every save goes through the offline outbox (kind 'session-voice-note'), so a
     note recorded without signal uploads when the connection is back, after the
     workout it belongs to (items drain in order). The recorder's file is copied
     to the app's document directory first, so a queued note survives a restart. */

export const SESSION_VOICE_BUCKET = 'session-voice-notes';
export const SESSION_VOICE_MAX_NOTES = 5;
export const SESSION_VOICE_MAX_MS = 5 * 60_000;
const MIN_BYTES = 4 * 1024;
const MAX_BYTES = 25 * 1024 * 1024;

export type { SessionVoiceNote } from './sessionVoiceTypes';
export { parseVoiceNotes, hasPainNote } from './sessionVoiceTypes';
import { parseVoiceNotes } from './sessionVoiceTypes';
import type { SessionVoiceNote } from './sessionVoiceTypes';

/** A take waiting to be saved: a durable local copy plus its length and the pain / discomfort
    answer (14 Oct 2026). JSON-safe (drafts, outbox); an old draft without the flag reads false. */
export type PendingVoiceTake = { uri: string; durationMs: number; recordedAt: string; painDiscomfort?: boolean };

/* ---------- durable local copies ----------
   expo-audio records into the cache directory, which the OS may clear. A take
   is copied into <documents>/session-voice/<uuid>.m4a as soon as it is kept, so
   the draft and the outbox always point at a file that is still there. */
function voiceDir(): Directory {
  const dir = new Directory(Paths.document, 'session-voice');
  try { if (!dir.exists) dir.create({ intermediates: true }); } catch { /* exists, or created concurrently */ }
  return dir;
}
export async function persistTake(uri: string, durationMs: number, painDiscomfort: boolean = false): Promise<PendingVoiceTake> {
  const src = new File(uri);
  const dst = new File(voiceDir(), `${uuidv4()}.m4a`);
  await src.copy(dst);
  try { src.delete(); } catch { /* cache file; the OS clears it anyway */ }
  return { uri: dst.uri, durationMs, recordedAt: new Date().toISOString(), painDiscomfort };
}
export function discardTake(uri: string) {
  try { const f = new File(uri); if (f.exists) f.delete(); } catch { /* already gone */ }
}

/* ---------- server ---------- */
export async function uploadSessionVoiceNote(input: { clientId: string; workoutSessionId: string; userId: string; uri: string }): Promise<string> {
  const path = `${input.clientId}/${input.workoutSessionId}/${input.userId}-${Date.now()}.m4a`;
  const body = await (await fetch(input.uri)).arrayBuffer();
  if (body.byteLength < MIN_BYTES) throw new Error('The recording is empty. Record it again.');
  if (body.byteLength > MAX_BYTES) throw new Error('The recording is over 25 MB.');
  const { error } = await uploadWithTimeout(SESSION_VOICE_BUCKET, path, body, { contentType: 'audio/m4a', upsert: false });
  if (error) throw new Error(error.message);
  return path;
}

export async function appendSessionVoiceNote(input: { workoutSessionId: string; path: string; durationMs: number; source: 'workout_form' | 'roster'; painDiscomfort?: boolean }): Promise<SessionVoiceNote[]> {
  const { data, error } = await withTimeout(
    Promise.resolve(supabase.rpc('append_session_voice_note', {
      p_workout_session_id: input.workoutSessionId,
      p_path: input.path,
      p_duration_sec: Math.max(1, Math.round(input.durationMs / 1000)),
      p_source: input.source,
      p_pain_discomfort: input.painDiscomfort === true, // migration 20261014160000; defaulted on the server
    })),
    NET_MS,
    'Save voice note',
  );
  if (error) {
    if ((error as any).code === 'PGRST202') throw new Error('Voice notes are not enabled yet. Ask the tech team to finish the setup.');
    throw new Error(error.message);
  }
  return parseVoiceNotes(data);
}

/** Outbox payload for one note. */
export type SessionVoiceOutboxPayload = {
  workoutSessionId: string; clientId: string; userId: string;
  uri: string; durationMs: number; source: 'workout_form' | 'roster';
  /** the composer's pain / discomfort answer for this take (14 Oct 2026) */
  painDiscomfort?: boolean;
};

/** The drain step: upload the durable file, append the row, drop the local copy.
    "Session not found yet" is the workout's trigger racing (or a deduped log):
    thrown with a marker the outbox treats as transient, so the note retries. */
export async function submitSessionVoiceNote(p: SessionVoiceOutboxPayload): Promise<void> {
  const local = new File(p.uri);
  if (!local.exists) throw new Error('The recording file is missing on this device.');
  const path = await uploadSessionVoiceNote({ clientId: p.clientId, workoutSessionId: p.workoutSessionId, userId: p.userId, uri: p.uri });
  try {
    await appendSessionVoiceNote({ workoutSessionId: p.workoutSessionId, path, durationMs: p.durationMs, source: p.source, painDiscomfort: p.painDiscomfort === true });
  } catch (e: any) {
    // The row did not take it: remove the object again (own upload, allowed).
    try { await supabase.storage.from(SESSION_VOICE_BUCKET).remove([path]); } catch { /* best effort */ }
    if (/Session not found yet/i.test(String(e?.message ?? ''))) throw new Error('Session not found yet (timeout, retrying)');
    throw e;
  }
  discardTake(p.uri);
}

/** Queue one note for a session and try to sync it right away (offline-safe). */
export async function queueSessionVoiceNote(p: SessionVoiceOutboxPayload, label: string): Promise<SubmitItemResult> {
  const item = await enqueueOutbox('session-voice-note', label, p, { autoDrain: false });
  return submitItem(item.id);
}

/* ---------- playback: one signed URL per note, in order ---------- */
export function useSignedSessionVoiceUrls(paths: string[]) {
  const key = paths.join(',');
  return useQuery({
    queryKey: ['session-voice-url', key], // not persisted (no persisted prefix): signed URLs expire
    enabled: paths.length > 0,
    staleTime: 50 * 60_000,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await withTimeout(
        Promise.resolve(supabase.storage.from(SESSION_VOICE_BUCKET).createSignedUrls(paths, 3600)),
        NET_MS,
        'Voice notes',
      );
      if (error) throw new Error(error.message);
      const byPath = new Map<string, string>();
      (data ?? []).forEach((d: any) => { if (d?.path && d?.signedUrl) byPath.set(d.path, d.signedUrl); });
      return paths.map((p) => byPath.get(p) ?? '');
    },
  });
}

/** Refresh every list that shows a session's notes. */
export function useInvalidateSessionVoice() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['client-sessions'] });
    qc.invalidateQueries({ queryKey: ['trainer-roster'] });
    // Doctor and therapist surfaces (7 Oct 2026): the doctor's day list, the
    // client's rehab sessions and the therapist's session list.
    qc.invalidateQueries({ queryKey: ['doctor-sessions'] });
    qc.invalidateQueries({ queryKey: ['rehab-sessions'] });
    qc.invalidateQueries({ queryKey: ['therapy-sessions'] });
  };
}

/* ---------- latest voice notes per client (My Crew, Tomorrow's Plan) ----------
   For each client: every session on her most recent session day (IST) that carries
   voice notes, so the trainer planning tomorrow can hear what was said after the
   last workout (3 sessions that day = 3 players). RLS: a trainer reads
   training_sessions of the clients assigned to them, whoever logged them. */
export type ClientLatestVoice = {
  day: string; // YYYY-MM-DD IST
  sessions: { id: string; scheduled_at: string; session_name: string | null; session_type: string | null; notes: SessionVoiceNote[] }[];
};
const istDay = (iso: string) => new Date(new Date(iso).getTime() + 330 * 60_000).toISOString().slice(0, 10);
export function useClientsLatestVoiceNotes(clientIds: string[], enabled = true) {
  const ids = [...new Set(clientIds.filter(Boolean))].sort();
  return useQuery({
    queryKey: ['client-latest-voice', ids.join(',')],
    enabled: enabled && ids.length > 0,
    staleTime: 300_000,
    queryFn: async (): Promise<Record<string, ClientLatestVoice>> => {
      const out: Record<string, ClientLatestVoice> = {};
      for (let i = 0; i < ids.length; i += 100) {
        const { data, error } = await withTimeout(
          Promise.resolve(supabase.from('training_sessions')
            .select('id, client_id, scheduled_at, session_name, session_type, voice_notes')
            .in('client_id', ids.slice(i, i + 100))
            .neq('voice_notes', '[]')
            .neq('status', 'cancelled')
            .order('scheduled_at', { ascending: false })
            .limit(400)),
          NET_MS,
          'Voice notes',
        );
        if (error) {
          if ((error as any).code === '42703') return {}; // column not live yet
          throw new Error(error.message);
        }
        ((data ?? []) as any[]).forEach((r) => {
          const notes = parseVoiceNotes(r.voice_notes);
          if (!notes.length || !r.client_id || !r.scheduled_at) return;
          const day = istDay(r.scheduled_at);
          const cur = out[r.client_id];
          if (!cur) { out[r.client_id] = { day, sessions: [] }; }
          else if (cur.day !== day) return; // rows come newest first: only the latest day is kept
          out[r.client_id].sessions.push({ id: r.id, scheduled_at: r.scheduled_at, session_name: r.session_name ?? null, session_type: r.session_type ?? null, notes });
        });
      }
      Object.values(out).forEach((v) => v.sessions.sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()));
      return out;
    },
  });
}
