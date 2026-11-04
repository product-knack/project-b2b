# Odds Nucleus: staff reading progress reaches the server: end-to-end plan (4 Nov 2026)

Status: BUILT 4 Nov 2026 (app side; owner: no new APK for now). tsc, 12 rule checks, Metro bundle clean. Originally: Owner (4 Nov 2026): "I want to see who read that article"; the web Education Content
Engagement page already shows staff rows, but the app never writes one.

## 1. What exists today
- Server (LIVE since 2 Nov 2026, hub-track migration `20261102100000_library_staff_progress.sql`): the member app's
  table `longevity_resource_progress` accepts staff rows (`profile_id` = the staff member, `client_id` NULL) through
  ONE definer RPC `record_library_staff_progress(p_resource_id, p_medium, p_position, p_duration, p_seconds_delta,
  p_progress, p_opened)`. The server keeps the furthest progress and the longest duration, adds `p_seconds_delta`
  (capped at 3600 a call), counts opens when `p_opened`, and sets `completed_at` the first time progress reaches
  0.9 ("Finished" on the web). Refusals: `LIBRARY_SIGN_IN`, `LIBRARY_STAFF_ONLY` (a member login),
  `LIBRARY_BAD_MEDIUM`, `LIBRARY_NOT_PUBLISHED`.
- Web (LIVE): Education Content → Engagement → Staff chip; the audience dialog lists each staff reader with a role
  badge, the medium, the percent and the seconds; Finished with the date.
- App (version 5.3 (44) of 3 Nov): Nucleus keeps saved pieces, the recent list and the resume position ON THE PHONE
  only (`nucleusQueries.ts`, AsyncStorage) and writes nothing. The piece screen (`nucleus.tsx` `PieceView`) already
  measures everything the server wants: the furthest scroll fraction of an article (`furthest`), the audio position
  and duration (`ListenBar`, position every 10 s, paused in the background through `AppState`), the direct-file
  video position (`FileVideo`, every 10 s). YouTube / Vimeo embeds in a WebView expose no position.
- Handoff from the web session: `docs/nucleus-staff-progress-handoff.md` (the one call, when to call, errors, offline).

## 2. The rule (what gets recorded)
1. **Open** of a piece = one record with `p_opened true` (so the web's "times" counts opens) and the starting
   progress (0, or the stored resume fraction). Audio and video count as their own medium (`audio` / `video`);
   the article text is `read`.
2. **Reading time** = seconds the piece is on screen in the foreground, sent every 15 s and on leave as a delta
   (`p_seconds_delta`), never while the app is in the background and never while the screen is not on the piece.
3. **Progress**: `read` = the furthest scroll fraction reached (0 to 1); `audio` / `video` = position / length.
   The server keeps the furthest, so a re-read that scrolls less never lowers it.
4. **Finished** = progress 0.9 or more, set by the server once. The app changes nothing for it.
5. **Offline**: the record goes into the existing outbox (new kind `library-progress`) and drains with the rest, in
   order; deltas add up on the server. A refusal (`LIBRARY_*`) drops the item (nothing to retry).
6. **Never in the way**: a failed or slow call never blocks reading or playback (no spinner, no alert; logged only).
7. **Nothing else changes**: saved, recent and resume stay on the phone exactly as today; the app never reads the
   progress table (the web does the reporting).
8. Embedded YouTube / Vimeo videos: the open is recorded (`video`, progress 0) and the seconds on screen; no position
   or finish (the embed gives none). A direct video file records position and finish like audio.

## 3. Android (odds-app), the whole change in one file plus the outbox kind
- `src/lib/nucleusProgress.ts` (NEW, pure + one network call):
  - `buildProgressCall(o)` (pure): the named parameters for the RPC from `{pieceId, medium, position, duration,
    secondsDelta, progress, opened}` (clamps 0..1, rounds seconds, null position / duration for `read`);
    `isPermanentLibraryRefusal(message)`: the four `LIBRARY_*` codes; `ticks(seconds)` helpers for the 15 s cadence.
  - `recordStaffProgress(call)`: `supabase.rpc('record_library_staff_progress', call)` through `withTimeout(NET_MS)`;
    offline or a network error → `enqueueOutbox('library-progress', '<piece title> · reading', call, {autoDrain:
    false})`; a permanent refusal → dropped with `console.warn`; never throws to the caller.
  - `useReadingSession(pieceId, medium, enabled)`: a small hook that owns the clock: starts on open (sends the open
    record), runs a 15 s interval that sends the delta with the latest progress / position, pauses on `AppState`
    not active, resumes on active, flushes the remaining seconds on unmount and on `pieceId` change (Prev / Next
    re-keys the view). It takes a `getProgress()` ref so the screen feeds the furthest scroll fraction or the
    player's position / duration without re-rendering.
- `src/screens/nucleus.tsx`: `PieceView` calls `useReadingSession(piece.id, 'read', piece.kind === 'article')` and
  feeds `furthest.current`; `ListenBar` calls it with `'audio'` while a player exists, feeding `pos` and `dur`;
  `FileVideo` with `'video'` feeding `player.currentTime` and `player.duration`; the embed path (`VideoBlock` with
  `started`) calls it with `'video'` and progress 0. Playback pauses in the background as today; the session clock
  pauses with it.
- `src/lib/offline.ts`: kind `'library-progress'` in the union; the drain calls `recordStaffProgress` again for the
  queued call (lazy require); a `LIBRARY_*` answer drops the item, a network error keeps it for the next drain.
- `tests/rules/nucleus_progress_test.js`: `buildProgressCall` clamps and nulls, the permanent-refusal list, the
  delta maths of the clock (a 40 s read = 15 + 15 + 10 on leave; background time excluded).
- Doc header of `nucleusQueries.ts` and `docs/features/android/shared/odds-nucleus.md` section 4 ("Written: one RPC
  call ...") + change log; README line.
- Nothing in `SENSITIVE_ROUTES` changes (published content). No new drawer item, no copy change on screen.

## 4. Server
- No SQL. The RPC and the table change are live. (A quick read-only check before building: call the RPC as the Sagar
  test account on a published piece with `p_seconds_delta 0, p_opened false` is a write of a row, so NOT done on
  production; verify with the real first read after the build instead.)

## 5. Release
- tsc, rule tests, Metro bundle, commit, push; then **APK + AAB 5.4 (45)** (the owner asked for the build with this).
- Version bump in `app.json` and `android/app/build.gradle`.

## 6. Verify (the handoff's test, on a phone with the new build)
1. Sign in as a trainer, open a published article, scroll halfway, wait 20 seconds, go back.
2. Web: Education Content → Engagement → Staff: the piece shows 1 staff person; the dialog lists the trainer with a
   Trainer badge, Read, about 50 percent, about 20 seconds.
3. Read to the end: Finished with today's date.
4. Airplane mode, read 30 seconds, back online: the seconds add up after the outbox drains.
5. SQL check: `select count(*) filter (where profile_id is not null) from public.longevity_resource_progress;` > 0.

## 7. Edge cases
- Prev / Next inside a course: the old piece flushes, the new one records an open.
- The same piece opened twice in a day: times 2, seconds add, progress the furthest.
- A member login (client) using the staff app: the server refuses `LIBRARY_STAFF_ONLY`, the app drops it silently.
- An unpublished piece still cached on the phone: `LIBRARY_NOT_PUBLISHED`, dropped.
- Sign-out mid-read: the flush runs with the dying session; a `LIBRARY_SIGN_IN` refusal is dropped; the outbox is
  per user, nothing crosses accounts.
- iOS: the same three files; handoff card 16 after the build.
