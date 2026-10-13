# iOS handoff: Session voice notes for trainers, doctors and therapists (7 Oct 2026)

Paste this whole doc to the iOS app's coding assistant. Staff who log a session leave spoken notes on it,
up to 5 notes of 5 minutes each, and any staff member who can open the client plays them back to back as one
audio. Shipped on Android (odds-app) for trainers on 30 Sep 2026 and extended to doctors and therapists on
7 Oct 2026. The iOS app has none of it yet, so this doc covers the whole feature, trainer base included.
Audio only, no transcription.

---

## 0. Ground rules

1. **The backend is LIVE and SHARED** (Supabase project `agtjszjedaenclbzgjvi`). Column, bucket, policies and the
   RPC exist and are used by Android in production. Do NOT create, alter or run any SQL, bucket or policy.
2. The only write path is the RPC `append_session_voice_note`. Never insert, update or delete
   `training_sessions.voice_notes` directly; a direct write is refused by nothing but would corrupt the list and
   break Android's parsing. Never delete a saved note. Never edit one.
3. One upload = one object in the private bucket `session-voice-notes`, then one RPC call. If the RPC refuses
   the note, remove the object you just uploaded (the policy lets the uploader delete its own object) and
   surface the error. Never leave orphan audio in the bucket.
4. The session row must exist before its notes. A trainer's workout log creates the `training_sessions` row
   through a trigger, so a note that arrives first gets `Session not found yet`: treat that as transient and
   retry, never as a failure.
5. Keep the copy. Same words as Android, no em dashes anywhere in user-facing text.
6. Record in the foreground only. Locking the phone ends the take; keep what was recorded so far.

## 1. Who records, who listens

| Role | Records on | Listens on |
|---|---|---|
| Trainer | Add Workout form (while logging), Today's Roster logged card (later) | Client detail > Sessions (Play per session), My Crew > Tomorrow's Plan (latest day), Add Workout health check-in popup (last session, max 5 days old) |
| Doctor (physio) | Log Session sheet (rehab, recovery, therapy; not a cancelled or cognitive-only save), Sessions day list card (later) | Sessions day list sheet, Client detail > Rehab Sessions (Play per session) |
| Therapist | Add Session sheet | Client detail > Therapy Sessions (Play per session) |
| Coach, CRM, admin, super admin, ops | Admin records anywhere; the others do not record | Anywhere a client's sessions are shown, if the screen exists on iOS |

Server rule for recording (inside the RPC): the caller must be the session's own trainer (`training_sessions.trainer_id`,
which is the doctor or therapist who logged it), or hold an active `trainer_clients` row for the client
(`actively_training = true`), or be `admin` / `super_admin`. Anyone else gets `42501`.

Server rule for listening (bucket SELECT policy): `profiles.role` in trainer, coach, doctor, therapist, crm,
admin, super_admin, ops.

## 2. Backend contract (live)

### 2.1 Column
`training_sessions.voice_notes jsonb NOT NULL DEFAULT '[]'`, an array, append-only, max 5 entries:

```json
[{ "id": "uuid", "path": "<client_id>/<session key>/<user_id>-<epoch>.m4a",
   "duration_sec": 42, "recorded_at": "2026-10-07T09:12:00Z",
   "recorded_by": "uuid", "recorded_by_name": "Sagar Sharma", "source": "workout_form" }]
```
`source` is `workout_form` (recorded while logging) or `roster` (added later). Read it tolerantly: drop
elements without a string `path`, coerce `duration_sec` to a positive integer, treat any other `source` as `roster`.

### 2.2 Bucket
`session-voice-notes`, private, 25 MB limit, `audio/*` only. Object path you choose:
`<client_id>/<session key>/<user_id>-<Date.now()>.m4a`, content type `audio/m4a`, no upsert.
Reject uploads under 4 KB (an empty take) and over 25 MB before sending.

Policies: INSERT and SELECT for the staff roles above; DELETE only when `owner = auth.uid()`; no UPDATE.

### 2.3 The RPC
```
append_session_voice_note(p_workout_session_id text, p_path text, p_duration_sec integer, p_source text default 'roster') returns jsonb
```
- `p_workout_session_id` is the **session key**: for a trainer's workout log it is the workout's
  `workout_session_id`; for a doctor's physio log and a therapist's therapy log it is the `training_sessions.id`
  itself (since 7 Oct 2026 the RPC matches `workout_session_id` first, then `id::text`).
- Returns the full array after the append (parse it the same way as the column).
- Errors: `28000` not signed in; `P0001 'Missing file path'`; `P0001 'Session not found yet'` (retry later);
  `42501 'You cannot add a voice note to this session'`; `P0001 'This session already has 5 voice notes'`.
- Call it with these exact parameter names. A `PGRST202` reply means the function is not deployed on the
  project you are pointing at; show "Voice notes are not enabled yet. Ask the tech team to finish the setup."

### 2.4 Playback URLs
`storage.from('session-voice-notes').createSignedUrls(paths, 3600)` for all notes of a session in one call.
Cache per path list for 50 minutes in memory only; never persist signed URLs.

### 2.5 Where each role's session rows come from
- Trainer, client Sessions list and Today's Roster: `training_sessions` rows for the client; the roster's
  logged card reads the row linked by `session_schedule.workout_session_id`. Select `voice_notes` with the row.
- Doctor day list: `training_sessions` where `trainer_id = me` and `session_type` in the doctor types,
  select `id, workout_session_id, voice_notes, client_id, cancelled, ...`. Session key = `workout_session_id || id`.
- Doctor client detail, Rehab Sessions: `training_sessions` for the client with the rehab session types,
  select `voice_notes`.
- Therapist client detail: `training_sessions` for the client with `session_type = 'therapy'`, select `voice_notes`.
- Trainer My Crew latest-day notes: `training_sessions` for the client ids, `voice_notes <> '[]'`,
  `status <> 'cancelled'`, newest first, keep only the most recent IST day per client.

### 2.6 Session creation per role (what gives you the key)
- Trainer: the workout insert; the key is the `workout_session_id` the app generated for that log.
- Doctor: `submitPhysioSession` inserts `training_sessions` and then sets `workout_session_id = <its id>`; use
  the returned id as the key (both match).
- Therapist: RPC `therapist_log_session(p_client, p_duration, p_note, p_therapy_type)` returns
  `{ session_id, schedule_id, roster_error }`; the key is `session_id`.

## 3. What the user sees (mirror Android exactly)

### 3.1 Recorder (in every logging form, and in the later-add sheet)
- Label `VOICE NOTES` with a one-line hint under it ("Speak your notes about this session (optional)").
- A tap button "RECORD VOICE NOTE". While recording: red dot, `m:ss / 5:00`, a STOP button. Auto-stop at 5:00
  and keep the take. A take under 800 ms is dropped with "Too short".
- Each kept take becomes a row: local player (play/pause, bar, time), "NOTE n · NOT SAVED YET", a trash button.
- Badge "N recorded" next to the label once there is a take.
- Hint line: "Up to 5 notes, 5 minutes each. Saved with the session; you can add more from Today's Roster."
  (doctor: "... from the Sessions list."; therapist: "... and played on the client's session list.").
- At the cap (saved + pending = 5): hide the record button, show "This session has the maximum of 5 voice notes."
- The Save / Log button is disabled while a recording is running.
- Trainer only: takes survive in the form draft (copy the file to the app's documents directory first, keep
  the file URI in the draft) and are restored with it.

### 3.2 Saving
- Trainer workout log (offline-capable): queue the log first, then one queue item per note, in order. If the
  log is rejected by the server, remove the note items and keep the takes in the form. If the log is accepted
  or queued, the notes sync behind it. A note that gets `Session not found yet` stays queued and retries.
- Doctor and therapist (online saves): call the save, then for each take upload and append with the returned
  id as the key. A refused note never undoes the session: show
  "Session logged. Voice note not saved: <error>" (doctor sheet, inline) or an alert titled
  "Session saved, voice note not saved" (therapist sheet). If the save itself fails, discard nothing; the
  takes stay in the form.
- After any successful append, refresh the lists that show that session's notes.

### 3.3 Later-add sheet (trainer roster card, doctor day list card)
- Entry: a purple chip on the logged, non-cancelled card: "Voice note" when none, "N voice notes" otherwise.
- Sheet title "Voice notes", subtitle "{client} · today's session". Body: the saved notes as the single
  player (or "No voice notes saved on this session yet."), then `ADD A NOTE` with the recorder, then
  "Save note" / "Save N notes". Offline (trainer): "Saved on this device" / "N voice notes will upload when you are back online."
- Closing the sheet discards unsaved takes.

### 3.4 Single player (every listening surface)
- Header "VOICE NOTES · 3 · 4:05" (count, total length).
- One play/pause button, one progress bar over the **total** of all notes, text "0:42 / 4:05 · NOTE 2 OF 3",
  "· LOADING" while buffering. Notes play back to back with no gap and no tap between them; at the end rewind to note 1.
- Footer line: "1. Sagar Sharma · 30 Sep   2. Dr Anjana · 1 Oct" (recorder name and IST date per note).
- "Preparing the notes…" until every signed URL is in; "Couldn't load the voice notes. Pull to refresh and try again." on error.
- Entry button on a session row: purple "Play" or "Play · N"; tapping toggles the player under the row.
  One open player per list.

### 3.5 Trainer extras (port if the screens exist on iOS)
- My Crew > Tomorrow's Plan: a purple "NOTES · 30 SEP" chip next to PROTOCOL for a client whose latest session
  day carries notes; tap opens a popup with one player per session of that day (date, time, session name, "by {recorder}").
- Add Workout health check-in popup: a "Last session voice notes" block at the end, one player per session of
  the latest day, only when that day is at most 5 days old (IST); otherwise
  "There is no audio present in any of the last 5 days' sessions."

## 4. Implementation notes

- Record with the platform recorder at high quality AAC in an `.m4a` container (Android uses expo-audio
  HIGH_QUALITY). Ask for microphone permission on the first record tap.
- Copy a kept take out of the temp directory into app documents (`session-voice/<uuid>.m4a`) immediately; delete
  it after a successful append or when the user removes the take.
- Playlist: build it from the signed URLs in note order; show one bar over the summed `duration_sec` and
  advance on item end. Android uses expo-audio's playlist; on iOS, AVQueuePlayer or a sequential AVPlayer works.
- Shield the recorder and player from session replay the same way the app shields other sensitive views.
- Invalidate after a save: client sessions, trainer roster, doctor day sessions, rehab sessions, therapy sessions.

## 5. Probe (read-only, any staff login)

```
POST /rest/v1/rpc/append_session_voice_note
{"p_workout_session_id":"no-such-session","p_path":"x/y.m4a","p_duration_sec":5,"p_source":"roster"}
```
Expect 400 with `Session not found yet`. With the anon key expect 401. A `PGRST202` means the wrong project.

```sql
select id, trainer_id, session_type, workout_session_id, jsonb_array_length(voice_notes) as notes
from training_sessions where voice_notes <> '[]'::jsonb order by updated_at desc limit 10;
```

## 6. Acceptance test (real devices)

1. Trainer: log a workout with 2 notes, both upload after the save; the roster card reads "2 voice notes";
   add a 3rd from the sheet; client detail > Sessions shows "Play · 3"; one bar, three notes back to back,
   "NOTE 3 OF 3" at the end; a 6th note is refused with the cap message.
2. Trainer offline: log a workout with a note in airplane mode; both sit in Waiting to Sync; back online
   the log lands first, then the note; the card reads "1 voice note".
3. Doctor: Log Session (rehab) with 1 note; the day list card shows "1 voice note"; open the chip, add a
   second; client detail > Rehab Sessions shows "Play · 2". A cancelled log shows no recorder.
4. Therapist: Add Session with 1 note; client detail > Therapy Sessions shows "Play".
5. Cross-role listening: the client's CRM and coach see "Play · N" on the same session and hear all notes;
   a trainer not assigned to the client cannot add one (42501), but can listen if the screen shows the client.

## 7. Reference code (Android, read for exact behaviour)

`src/components/SessionVoice.tsx` (composer, playlist player, later-add sheet, latest-day chip and popup),
`src/components/VoiceNote.tsx` (recorder hook: 800 ms minimum, max length auto-stop, tap button, local player),
`src/lib/sessionVoiceQueries.ts` (durable copies, upload, RPC, outbox payload and drain step, signed URLs,
latest-day query), `src/lib/sessionVoiceTypes.ts` (parser, IST day helper), wiring in `src/screens/trainer.tsx`
(Add Workout and roster), `src/screens/doctorSessions.tsx` (Log Session sheet and day list),
`src/screens/doctorClientDetail.tsx` (Rehab Sessions card), `src/screens/therapist.tsx` (Add Session sheet
and Therapy Sessions list), `src/screens/managerChat.tsx` (Tomorrow's Plan). Feature doc:
`docs/features/android/trainer/session-voice-notes.md` in the b2b workspace. Backend SQL:
hub-track `supabase/migrations/20260930100000_session_voice_notes.sql` and `20261007160000_session_voice_notes_doctor.sql`.
