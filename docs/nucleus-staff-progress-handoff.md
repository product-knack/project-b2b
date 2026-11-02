# Handoff: Odds Nucleus saves staff reading progress (2 Nov 2026)

From the web session. **Server side is ready once migration `20261102100000_library_staff_progress.sql` runs** (hub-track, the owner runs it in the SQL editor). Web feature file: `docs/features/web/shared/education-content.md`. Android feature file to update: `docs/features/android/shared/odds-nucleus.md`.

## Why
- Owner, 2 Nov 2026: the Education Content engagement page must show trainers, doctors and other staff too, not only members.
- Until now Nucleus wrote nothing to the database (decision of 16 Oct 2026), so there was nothing to show.
- From this release, Nucleus records staff progress in the **same table the member app uses**, `longevity_resource_progress`. Staff rows carry `profile_id` (the signed-in staff member) with `client_id` NULL.

## The one call
Use `supabase.rpc('record_library_staff_progress', {...})`. Always pass **named** parameters. Keep the local saved / recent / position store exactly as it is: this call is in addition to it, not a replacement.

| Param | Type | Meaning |
|---|---|---|
| `p_resource_id` | uuid | the piece id |
| `p_medium` | text | `read` (article text), `audio` (article audio), `video` |
| `p_position` | int, nullable | current position in seconds (audio / video); for `read`, pass null |
| `p_duration` | int, nullable | length in seconds (audio / video); for `read`, pass null |
| `p_seconds_delta` | int | seconds actually spent **since the previous call** for this piece and medium (the server adds them up; capped at 3600 per call) |
| `p_progress` | numeric 0..1 | how far: audio / video = position / length; read = deepest scroll ratio reached |
| `p_opened` | boolean | `true` on the **first** call after the piece (or that medium) is opened, so `times` counts opens; `false` otherwise |

The answer is `{times, progress, seconds_spent, position_seconds, completed_at}`. You can ignore it.

**Server rules:**
- The server keeps the furthest progress and the longest duration.
- `completed_at` is set the first time progress reaches **0.9**. The web calls this "Finished".
- Unpublished pieces are refused.
- Members (client logins) are refused.

## When to call
1. **On open** of an article, its audio, or a video: `p_opened: true`, `p_seconds_delta: 0`, `p_progress` = where they start (0, or the saved position ratio).
2. **Every 15 seconds** while the piece is on screen **and** the person is reading (screen focused) or the player is playing: `p_opened: false` and `p_seconds_delta` = seconds since the last call.
3. **On leave** (back, piece change, app to background via AppState): the same as 2, with the remaining seconds. Pause audio and video first, as today.

Seconds only count while the piece is in the foreground; never count while the app is in the background.

## Errors and offline
- **A failed call must never block reading or playback.** Swallow the error and log it.
- **Offline:** put the call in the existing outbox as kind `library-progress` with the same params. Use `p_seconds_delta` as a delta, so queued calls add up correctly. Drain the outbox when online, in order.
- **Refusals that must NOT retry** (drop them from the queue):
  - `LIBRARY_NOT_PUBLISHED` (the piece was unpublished);
  - `LIBRARY_STAFF_ONLY` (a member login);
  - `LIBRARY_BAD_MEDIUM`;
  - `LIBRARY_SIGN_IN`.
- Wrap the call in the usual `withTimeout(NET_MS)`. Any user-facing text goes through `friendlyError`, but nothing here should be user-facing.

## Not changing
- Saved, recent and position stay on the phone, as today.
- No reads of `longevity_resource_progress` are needed in the app. If you ever want to show "you finished this" from the server, a staff member can SELECT their own rows (`profile_id = auth.uid()`; RLS allows only their own).

## Test
1. Sign in as a trainer, open a published article, scroll halfway, wait 20 seconds, then go back.
2. On the web, as an academy admin, open Education Content → Engagement → **Staff**. The piece shows 1 staff person. The audience dialog lists the trainer with a "Trainer" badge, the Read medium, about 50%, and about 20 seconds.
3. Read to the end. The row shows **Finished** with today's date.
4. Airplane mode, read for 30 seconds, go back online. The time adds up after the outbox drains.
