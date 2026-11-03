# Listen progress in percent, and "heard" only at 100 percent: end-to-end plan (3 Nov 2026, offline added the same day)

Status: PLAN ONLY, nothing built. Owner's ask (3 Nov 2026): "on My Crew, on the summaries (weekly and the long one),
show everyone in percent how much they listened, and show an alert that they need to listen 100 percent, so that
when they log the session they do not need to listen again."

## 1. What exists today (found, nothing changed)
- Two spoken summaries per client per training day (`client_health_summary` row: This week's training, Health
  context), played from the client page card, the Today's Roster strip, the Essentials cards, the Log Health Data
  popup, My Crew's Listen now sheet and the Add Workout listen gate.
- The trail: `log_summary_listen(client, which)` appends `{at, by, by_name, role, which, version, briefing_date}` to
  `listen_history` **when Play is pressed**, before any sound. Nothing records how far the person listened.
- The rule everywhere: weekly heard once per day, context heard once per update; computed on the app from the trail
  (`gateStateFor` / `gateFromStatus` in `clientHealthSummary.ts`, web `isNew`) and batched for My Crew by
  `get_my_listen_status(uuid[])` (has / generated_at / my_last_at per client, the caller only).
- My Crew's Tomorrow's Plan shows one chip per client, for the signed-in person only: NOT HEARD or HEARD.
- The open gap (feature doc, section 8): a Play stopped at once still writes the trail, so a later Add Workout finds
  the summary "heard" and skips the gate. Only the in-form gate waits for the end of the audio, and only for that one
  form. This plan closes that gap: heard means 100 percent.

## 2. The rule (owner, 3 Nov 2026)
1. A summary counts as **heard only when it was played to the end (100 percent)** for its current version. A
   listen that stopped at 60 percent shows as 60 percent and still blocks the session log.
2. Progress is **per person, per summary, per version**: the best percent so far; a new version (the nightly weekly,
   a context rebuilt by a new report) starts again at 0 for everyone. Replaying a 100 percent summary keeps 100.
3. Everyone's progress is visible on My Crew: for each client's two summaries, every crew member's percent.
4. An alert on every listen surface while a person is under 100 percent: **"Listen to 100 percent now, so you do
   not have to listen again when you log the session."** (red; green "Heard 100 percent, you can log" when done).
5. Entries written before this ships carry no percent; they count as heard (legacy), so nobody is blocked for
   yesterday's plays. From the cutover every play records progress.
6. **No network behaves exactly like network (owner, 3 Nov 2026).** A listen made offline is recorded on the phone
   at once (percent, heard, the time it was heard) and reaches the server when the phone is back online, with the
   real heard time. The bar, the lines, the chips and the Add Workout gate read the phone's record merged with the
   server's, so a trainer who heard both summaries to 100 percent offline at 9 AM logs the 6 PM session without
   listening again, online or not. Today the gate skips itself offline (the trail could not be written); that
   exception goes away.

## 3. Backend (hub-track migration `20261103100000_summary_listen_progress.sql`, the owner runs it)
- Trail entry gains `percent` (0 to 100, integer), `heard` (percent = 100), `updated_at`, `device` ('android' |
  'ios' | 'web'). `log_summary_listen` (Play) keeps appending a fresh entry with `percent 0`.
- New `log_summary_listen_progress(p_client_id, p_which, p_percent int, p_version int, p_at timestamptz default
  now(), p_briefing_date date default null)`: finds the caller's newest entry for that summary and version on the row
  it names (default: the row in effect; an offline listen synced the next day names the day it was heard on, so it
  lands on the right row), or appends one with `at = p_at`, sets `percent = greatest(old, new)`, `heard = percent >=
  100`, `heard_at = p_at when it reaches 100`, `updated_at = now()`. Idempotent; a lower percent never lowers it; an
  unknown version (the row rebuilt meanwhile) answers `{stale: true}` and writes nothing. `p_at` is accepted only
  within the last 7 days and never in the future (an offline sync, not a backdate). Same locks as the trail.
- `log_summary_listen` (the Play entry) also takes `p_at` and `p_briefing_date` for the same reason.
- `get_my_listen_status(uuid[])` gains `my_weekly_percent`, `my_context_percent` (best percent for the CURRENT
  version; 100 for a legacy entry on that version) and `my_weekly_heard`, `my_context_heard`.
- New `get_crew_listen_progress(p_client_ids uuid[])` for My Crew: per client, per listener (`by`, `by_name`, `role`)
  the best percent for each summary's current version, plus `heard` and `updated_at`. Reads through
  `get_client_health_summary`, so `can_listen_client_summary` still decides who sees which client; the manager and
  every crew member may already listen to the crew's clients (managers are in the policy since 9 Oct).
- `get_client_health_summary` unchanged: `listen_history` already travels to the apps; the new keys ride along. The
  carried earlier-day context listen (24 Oct) carries its percent too, so a context heard to 100 last week stays
  heard until the next update.
- Legacy rule in SQL and in the apps: an entry without a `percent` key = heard.
- Probe (rolled back, as Sagar on Vashist): Play writes 0; progress 40 then 25 keeps 40; 100 sets heard and the
  status answers heard; a new version resets to 0; a legacy entry reads heard; crew progress lists two listeners.

## 4. Where the percent comes from (Android, `src/lib/summaryVoice.ts`)
- Sarvam recording: the player status carries `currentTime` and `duration` per part; the controller reports
  `onProgress(fraction)` = (parts finished + currentTime / duration of the current part) / parts (parts are near
  equal; exact enough for a percent). `onDone` (last part finished, the signal the gate already uses) = 100.
- Device-voice fallback: sentence chunks, progress = chunks spoken / chunks.
- Writes: at 25, 50, 75 and 100 percent, and the final percent on Stop, Pause or unmount (one call, debounced).
  Online or offline, every write goes to the **phone's listen record first** (`listenLocal.ts`, persisted:
  `{client, which, version, briefing_date, percent, heard_at, at}` per person, the best percent per version), and
  from there to the server. Online: sent at once. Offline: queued in the existing outbox (`src/lib/offline.ts`, new
  kinds `summary-listen` for the Play entry and `summary-listen-progress` for the percent, with the heard time and
  the briefing day in the payload) and drained with the workout logs when the network returns; the drain calls the
  RPCs with `p_at` so the server records when it was really heard, and a `stale` answer is dropped (the summary
  changed; the phone's record for that version is cleared too). One queued progress item per client, summary and
  version (the queue keeps the highest percent), so a 10-minute offline listen is one outbox row, not forty.
- What is read everywhere (bar, lines, chips, gate): the **merge** of the server status and the phone's record for
  the same version, best percent wins (`mergedProgress` in the pure rules). The server never knows about an offline
  100 percent until the sync; the phone does, and that is what the gate on this phone reads. Another phone (the
  manager's) sees it after the sync.
- Playing offline: the Sarvam recording needs the network, so the device voice reads the script (today's fallback).
  The script is on the phone when the client's summary row was read while online: the Today's Roster cards and the
  client page persist those rows (`client-` cache prefix), and My Crew's Tomorrow's Plan will **prefetch the rows of
  tomorrow's clients** when it is opened online, so the next day's offline listens have their text. A client whose
  summary was never loaded on this phone shows "Connect once to load NAME's summaries", and only for that client the
  gate stays as today (it cannot ask for what the phone does not have).
- The pure rules (`clientHealthSummary.ts`): `listenPercent(entry)`, `isHeard(entry)` (legacy = heard),
  `myProgress(history, which, uid, version)`, `gateStateFor` / `gateFromStatus` count heard entries only,
  `progressLine(percent)` ("You: 60 percent heard" / "Heard 100 percent, you can log"), `LISTEN_100_ALERT`,
  `crewProgressRows(history, version)` for the My Crew block. Node tests for all of it.

## 5. What the user sees
- **Every Play row** (card, roster strip, Essentials card, Log Health Data popup, gate sheet, Listen now sheet): a
  thin progress bar under the row with "You: 60 percent heard", and while under 100 the red alert line of rule 4;
  at 100 the green line. The bar moves while the audio plays.
- **My Crew, Tomorrow's Plan**: the per-client chip reads "HEARD 100" (green), "60 PERCENT · FINISH" (amber) or
  "NOT HEARD" (red). Tapping it opens the Listen now sheet, which gains a **Who listened** block: one line per crew
  member and each summary, "Sagar · This week 100 percent · Health context 40 percent", the manager included,
  members who never played at 0. The block is also on My Crew's client rows when the plan is not open (same RPC,
  one call per crew).
- **Add Workout gate**: unchanged words; its "heard" already waits for the end of the audio. Now the trail agrees
  with it, so a summary heard to 100 percent on the roster strip at 9 AM clears the gate at the 6 PM log, and a
  Play stopped at 20 percent does not. **Offline the gate now shows and works the same** (it reads the phone's
  record; the device voice plays the cached script); the queued workout log and the queued listen sync together.
- **Offline marker**: a listen not yet synced shows a small "Saved on this phone · syncs when online" line under the
  bar (same wording family as the queued workout logs); it disappears after the drain.
- **Web card** (`ClientHealthSummaryCard.tsx`, parity rule): the same progress write from the `<audio>` element's
  `timeupdate` / `ended` (25, 50, 75, 100, final on pause), the bar and the two lines; the Who listened sheet shows
  the percent next to each name.

## 6. Edge cases
- Two phones or web and app at once: the server keeps the best percent; order of writes does not matter.
- The summary is rebuilt mid-play (nightly at 1 AM, or a context update): the progress call answers `stale`, the
  row shows "This summary changed, listen again" and the percent resets with the new version.
- Replay after 100: the Play still appends a trail entry (who listened when) with percent 100 copied from the
  heard state, so the history stays honest and the gate stays clear.
- A short summary (under 10 seconds) still needs 100 percent; the bar just fills fast.
- Seeking: the recording has no seek control, so a skip-ahead cannot fake 100; the device-voice fallback counts
  spoken chunks only.
- The trail is capped at 500 entries per row (existing); progress updates edit the entry in place, so the cap is
  not consumed by milestones.
- Offline, then the summary was rebuilt before the sync (a weekly heard offline on Monday night, the nightly build
  at 1 AM, the sync on Tuesday morning): the queued item names Monday's row and version, so it lands on Monday's
  row as a real listen (history stays true), while Tuesday's weekly is a new version and is due again, exactly as
  it would be online (the weekly is due every day by rule). A context heard offline keeps counting after the sync
  until the next real context update, through the carried listen.
- Offline on two days in a row with no sync: both days' listens queue in order and drain in order.
- Clock drift: `p_at` is taken from the phone; the server caps it to now() and refuses anything older than 7 days.
- A listener signs out before the sync: the outbox is per session (existing teardown rule); the unsynced listen is
  lost with the queued logs, as today for every outbox kind. The marker line says so while it waits.

## 7. Build order and checks
1. Migration (PGlite-tested with the real function texts; the probe of section 3) and the two RPC changes.
2. Android: controller progress + the write, the phone's listen record and the two outbox kinds (drain, dedupe,
   stale handling), `mergedProgress`, pure rules + tests, the bar and lines on `SummaryRow`, the offline marker, the
   chip and the Who listened block on My Crew (`managerChat.tsx`, `ListenNowSheet`), Tomorrow's Plan prefetch, the
   gate counting heard only and no longer skipping itself offline; tsc, rule tests, bundle; APK on request.
3. Web: card progress write + bar + lines, Who listened percents; tsc; push.
4. Feature docs (android + web client-health-summary, my-crew-add-session), iOS handoff generated from the files.
5. Live check as Sagar: play Vashist's weekly to the end on the roster strip, Tomorrow's Plan shows HEARD 100, the
   Add Workout gate stays closed; stop a context at 30 percent, the chip reads 30 PERCENT · FINISH and the gate
   opens for it.
6. Offline check: airplane mode, open Vashist on Today's Roster, Play both (device voice), bar reaches 100 with the
   "Saved on this phone" line, Add Workout opens without the gate, log the session (queued); network back: the
   outbox drains listen then log, the trail on the server shows the 9 AM heard time, the manager's My Crew shows
   Sagar 100 percent, no "Saved on this phone" line remains.

## 8. Not in this plan (say if wanted)
- A reminder push (for example 6 PM: "2 of tomorrow's clients are not heard to 100 percent") and the manager's
  push when a member is under 100 percent before a session.
- Counting the listens of CRM, doctors and therapists in the crew block (they appear in the trail already; the block
  lists crew members, others under "Others").
