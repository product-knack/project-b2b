# iOS handoff 6 of N: Assessor QHP voice memo, write-once (15 Sep 2026)

Paste this whole doc to the iOS app's coding assistant. On every completed QHP card in the assessor's
**My QHPs** list there is a **Voice memo** button: the assessor records one spoken debrief ("Record all insights
regarding the QHP in detail"), listens back, then saves. Once saved it is **permanent**: the button becomes a
player for good and nothing can re-record, overwrite or delete it. Audio only, no transcription. Shipped on the
web (Lovable, 15 Sep 2026) and on Android (odds-app, 15 Sep 2026).

---

## 0. Ground rules

1. **The backend is LIVE and SHARED** (Supabase project `agtjszjedaenclbzgjvi`), owned by the web build. Do NOT
   create, alter or run any SQL, bucket or policy.
2. **Reference implementation** in the Android React Native repo `odds-app`: `src/components/QhpVoiceMemo.tsx`
   (`QhpVoiceMemoButton`, `QhpVoiceMemoPlayer`, `QhpVoiceMemoDialog`), `src/components/VoiceNote.tsx` (the shared
   recorder hook `useVoiceRecorder`, `VoiceTapButton`, `VoicePlayer`), `src/lib/qhpQueries.ts`
   (`attachQhpVoiceMemo`, `useAttachQhpVoiceMemo`, `useSignedQhpMemoUrl`, the memo fields on `QhpRow`), and the card
   wiring in the QHP screen's My QHPs tab in `src/screens/trainer.tsx` (`memoFor` state).
3. Recording uses **expo-audio** on Android (`useAudioRecorder(RecordingPresets.HIGH_QUALITY)`, AAC `.m4a`). If the
   iOS app is Expo, use the same; **iOS needs the microphone permission string**: add the expo-audio config plugin
   with `microphonePermission` (or `NSMicrophoneUsageDescription` in Info.plist), for example "Odds uses the
   microphone to record voice memos about assessments." and set the audio mode to allow recording before
   `prepareToRecordAsync()` (iOS refuses to record otherwise). Rebuild the dev client after adding the plugin.
4. No em dashes in user copy. The dialog is one `Modal`; never open a second modal on top of it.

---

## 1. What the assessor sees

### 1.1 On the card
- Where: QHP screen → **My QHPs** tab (the assessor's own QHPs, `coach_id = me`) → each **completed** card, below
  "View Health Briefing".
- No memo yet: a full-width button with a mic icon, **"Voice memo"** (cyan accent `#5CE1E6`, 10% fill, 38% border,
  radius 11).
- Memo saved: a compact player in the same slot (cyan 6% fill, 22% border): a round play / pause button, a thin
  progress bar, and "0:42 / 2:15 · MEMO · 15 SEP, 02:10 PM" (time from `voice_memo_recorded_at`, IST). If the file
  cannot be signed: "Voice memo unavailable (<message>)." The button never comes back.

### 1.2 The dialog "Voice memo"
Header: a mic tile, "Voice memo", sub-line "{client name} · {QHP label}" (for example "Rahul Verma · QHP Refresh 2"),
close (x). A prompt card (cyan tint): **"Record all insights regarding the QHP in detail."** and under it "Up to 5:00.
Saved once, the memo cannot be re-recorded or deleted, so listen back before you save."

Stages:
1. **Intro**: a full-width button "START RECORDING" (mic icon, cyan).
2. **Recording**: a red row: breathing red dot, "1:23 / 5:00", "RECORDING", and a **STOP** pill. It auto-stops at
   5:00 and keeps the take.
3. **Review**: a local player "LISTEN BACK" for the take; two buttons **Record again** (discards the take, back to
   intro) and **Save** (cyan; "Saving…" with a spinner); a tiny caps line "2:15 RECORDED · SAVE IS FINAL".
4. **Saving**: close and backdrop do nothing until it finishes.

Other rules:
- A take shorter than 800 ms is dropped with the alert "Too short" / "Hold on a moment longer before stopping."
- Mic denied: alert "Microphone needed" / "Allow microphone access to record a voice memo."
- Closing the dialog while recording stops and **discards** the take (nothing was uploaded).
- Save success: the dialog closes, alert "Voice memo saved" / "It is now attached to this QHP and cannot be
  changed." The card now shows the player.
- Save failure: alert "Couldn't save the memo" + the message ("The recording is empty. Record again.",
  "The recording is over 25 MB.", "A voice memo is already saved for this QHP.", or the server text). The take
  stays so the assessor can try again.

---

## 2. Backend contract (live)

### 2.1 Columns on `coach_assessment` (all nullable)
`voice_memo_path text`, `voice_memo_duration_sec int`, `voice_memo_recorded_at timestamptz`. Read them with the
My QHPs list query (Android uses `select('*')`).

### 2.2 Storage bucket `qhp-voice-memos`
Private, 25 MB cap. RLS: INSERT and SELECT for `profiles.role` in `coach, trainer, doctor, admin, super_admin, ops`;
**no UPDATE and no DELETE** policy (objects are immutable). Path:
`<assessment_id>/<auth_user_id>-<epoch_ms>.m4a`. The web records 16 kHz mono WAV into the same bucket; the player
must handle both (iOS AVPlayer does).

### 2.3 Write-once trigger
`enforce_qhp_voice_memo_once` (BEFORE UPDATE on `coach_assessment`) rejects any change to `voice_memo_path` once it
is set, for every role. The QHP 6-hour edit window trigger guards only the value columns, so a memo can be added
after the window closes.

### 2.4 Save (upload, then guarded attach)
```ts
const QHP_MEMO_BUCKET = 'qhp-voice-memos';
const QHP_MEMO_MAX_MS = 5 * 60_000;
const MIN_BYTES = 4 * 1024, MAX_BYTES = 25 * 1024 * 1024;

async function attachQhpVoiceMemo({ assessmentId, userId, uri, name, mime, durationMs }) {
  const ext = (name.split('.').pop() || 'm4a').toLowerCase();
  const path = `${assessmentId}/${userId}-${Date.now()}.${ext}`;
  const body = await (await fetch(uri)).arrayBuffer();
  if (body.byteLength < MIN_BYTES) throw new Error('The recording is empty. Record again.');
  if (body.byteLength > MAX_BYTES) throw new Error('The recording is over 25 MB.');
  const { error: upErr } = await supabase.storage.from(QHP_MEMO_BUCKET)
    .upload(path, body, { contentType: mime /* 'audio/m4a' */, upsert: false });      // through the app's upload timeout
  if (upErr) throw new Error(upErr.message);
  const { data, error } = await supabase.from('coach_assessment')
    .update({ voice_memo_path: path,
              voice_memo_duration_sec: Math.max(1, Math.round(durationMs / 1000)),
              voice_memo_recorded_at: new Date().toISOString() })
    .eq('id', assessmentId)
    .is('voice_memo_path', null)          // the guard: a second save updates 0 rows instead of raising
    .select('id');
  if (error || !data?.length) {
    try { await supabase.storage.from(QHP_MEMO_BUCKET).remove([path]); } catch {}   // best effort; no DELETE policy, so a no-op today
    if (error) throw new Error(error.message);
    throw new Error('A voice memo is already saved for this QHP.');
  }
  return path;
}
```
`userId` = the signed-in user's id (`session.user.id`). On success invalidate the My QHPs list query
(`['qhp-assessments']` on Android) so the card re-renders with the player.

### 2.5 Playback
```ts
supabase.storage.from('qhp-voice-memos').createSignedUrl(path, 3600)   // 1 hour, like the web
```
Query key `['qhp-memo-url', path]`, staleTime 50 minutes, do not persist (signed URLs expire).

---

## 3. Recorder and player details (Android `VoiceNote.tsx`, mirror them)
- `start()`: request the mic permission; `setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })`;
  `prepareToRecordAsync()`; `record()`; a 250 ms interval updates the clock and auto-finishes at 5:00; medium haptic.
- `finish(keep)`: stop; `setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true })` (on iOS this is what
  lets playback use the speaker at full volume); if `keep` and at least 800 ms, hand back
  `{ uri: recorder.uri, name: 'voice-<ms>.m4a', mime: 'audio/m4a', durationMs: elapsed }`; success haptic.
- Unmount while recording: stop and discard.
- Player: one player instance per row, created lazily on first tap (`createAudioPlayer({ uri })`), released on
  unmount; `playbackStatusUpdate` drives position / duration; on finish, pause and seek to 0. Show the saved
  `voice_memo_duration_sec` as the duration until the file reports its own.
- Clock format `m:ss`.

## 4. Probe (read-only; any staff login)
- `GET /rest/v1/coach_assessment?select=id,voice_memo_path,voice_memo_duration_sec,voice_memo_recorded_at&limit=1`
  → 200 (the columns exist).
- `storage.from('qhp-voice-memos').list('', { limit: 1 })` → 200.
- Do NOT upload or attach from a script: every attach is permanent. The first device save is the end-to-end test.

## 5. Acceptance test (a real device signed in as an assessor with completed QHPs)
1. My QHPs: each completed card shows "Voice memo".
2. Tap it: the dialog with the prompt; START RECORDING asks for the mic the first time.
3. Record 10 seconds, STOP: LISTEN BACK plays the take; Record again discards it.
4. Record again, Save: "Voice memo saved"; the card shows the player with the IST time; it plays.
5. Kill and reopen: still the player, never the button. The same QHP on the web and on Android shows the player too.
6. SQL: `select id, voice_memo_path, voice_memo_duration_sec, voice_memo_recorded_at from coach_assessment where voice_memo_path is not null order by voice_memo_recorded_at desc limit 5;`
7. A memo recorded on the web (WAV) plays on iOS.
8. Closing the dialog mid-recording leaves nothing in the bucket and the button stays.

## 6. If the iOS app is not React Native
`AVAudioRecorder` with `kAudioFormatMPEG4AAC` into an `.m4a` temp file, `AVAudioSession` category `.playAndRecord`
while recording and `.playback` after; upload `Data(contentsOf:)` with `supabase.storage.from("qhp-voice-memos").upload(path:, file:, options: FileOptions(contentType: "audio/m4a", upsert: false))`;
the guarded update is `.update(...).eq("id", value: id).is("voice_memo_path", value: nil).select("id")`;
play with `AVPlayer(url: signedURL)`.
