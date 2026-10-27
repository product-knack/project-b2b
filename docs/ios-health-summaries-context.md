# The short and the long summary, end to end (27 Oct 2026)

One document for the iOS repo and for anyone touching the feature. "Short summary" = **This week's training**
(the weekly block). "Long summary" = **Health context** (the context block). Both live on one table, are built by
one edge function, are spoken by one voice function, and are gated by one rule. Android and web are done; this is
the whole system as it stands on 27 Oct 2026. Sources of truth: `b2b/docs/features/web/trainer/client-health-summary.md`
(backend) and `b2b/docs/features/android/trainer/client-health-summary.md` (app). Earlier iOS handoffs in this
folder: `client-health-summary-handoff.md` (9 Oct), `client-health-summary-daily-rows-handoff.md` (10 Oct),
`ios-listen-gate-fix-handoff.md` (22 Oct), `ios-listen-rule-handoff.md` (27 Oct). This file supersedes none of
their code; it ties them together.

---

## 1. What the two summaries are

| | Short: This week's training | Long: Health context |
|---|---|---|
| What it says | The last 7 IST days ending yesterday: sessions (completed, cancelled, missed, by type, trainers, average RPE), nutrition average, sleep average with its source, water average, steps average, WHOOP recovery average and latest reading | The member's current condition: age and sex, recorded chronic conditions, injuries, surgery, pain areas, medicines by name, blood pressure, resting heart rate; blood markers compared with the previous report in words (improved / worse / still outside range); the QHP compared with the previous one in words (mobility, strength, cardio and balance, body, lifestyle; VO2 max and grip with value and age category); biological age direction; the latest doctor consultation (medicines, tests, follow-up, referral); recent medical records (no infections, no diagnosis fields); a lifestyle line from the latest QHP; closing line "For anything clinical, please check the doctor consultation notes." |
| Length | 60 to 100 words, about 30 seconds | 60 to 340 words, up to about 2.5 minutes |
| When it changes | Every night (built at 1:00 AM IST for the next training day) | Only when a real update arrives (new blood report, QHP, medical record, analysed health report, completed consultation or amended prescription, new biological age, completed assessment), or when the carried copy is 30 days old. The nightly build copies it forward unchanged (same `version` and `generated_at`) otherwise (24 Oct 2026) |
| Listen rule | Heard **every day** (today, after the nightly build) | Heard **once per update** (once after each rebuild; an earlier day's listen carries) |
| Who may listen | `can_listen_client_summary(client_id)`: admin, a trainer of the client, any doctor or therapist, CRM and managers, and any trainer or coach when the client is on Essentials | same |
| Voice | Sarvam `bulbul:v3`, speaker `priya`, en-IN, rendered once per summary version into a private bucket; the device voice is the fallback | same |

Standing script rules: numbers come from code, never the model (the model writes prose over fact lines); no
diagnosis words that are not already on file; no "ongoing"; the person is "the member", never "the client"; blood
values are never spoken, only direction; blood markers are judged against their own report's reference range;
until the clinical team confirms the exclusion list only the standard panel is spoken; infections are never spoken;
no sleep or steps in the long one (the short one carries them); no day counts or "missing data" lines.

## 2. The table

`client_health_summary`, **one row per client per training day** (PK `(client_id, briefing_date)`, 180 days kept):
- `briefing_date` (the session day, IST), `status` (`building` → `ready`), `built_at`
- `weekly_summary` jsonb: `{generated_at, window_from, window_to, facts {...}, script, highlights[], model, version, fallback, fallback_reason}`
- `context_summary` jsonb: `{generated_at, sources[], improved[], worsened[], watch[], medical_events[], profile, lifestyle, consultation, exclusions_confirmed, script, model, version, fallback, fallback_reason, rejected_draft?}`
- `quiz` and `auction` jsonb (Essentials only; the auction uses the training-day row)
- `listen_history` jsonb: `[{at, by, by_name, role, which: 'weekly' | 'context', version, briefing_date}]`, oldest first, capped 500
- `audio` jsonb: the Sarvam cache record per kind `{version, recipe, parts, chars, model, speaker, rendered_at}`
- `context_dirty`, `context_dirty_reason`, `context_dirty_at`, `context_build_requested_at`: the update machinery
- RLS: select through `can_listen_client_summary`; no app writes except the listen RPC. Config row
  `client_health_summary_config` (exclusion list, `exclusions_confirmed`), written only in the SQL editor.

The row in effect for listening = the latest row with `briefing_date <= today`.

## 3. How the rows get built (server, nothing for the app)

- Cron `client-health-briefing-build` at `30 19 * * *` UTC (1:00 AM IST): `run_client_health_summaries('all')` posts to
  the edge function `build-client-briefing` with the Vault key; for every active client without a `ready` row for
  tomorrow it builds the weekly block fresh, **copies the latest context forward** (rebuilds only when there is none,
  the last one was a fallback, a row from today on is `context_dirty`, or the copy is 30 days old,
  `CONTEXT_REFRESH_DAYS`), and the Essentials quiz. 20 clients per call, 4 in parallel, chained.
- Updates: triggers on `blood_report_markers` (insert), `qhp_details` (insert / update of the QHP json), `client_medical_history`
  (insert), `health_reports` (ai_analysis changed), `doctor_consultation_details` (completed, prescription amended),
  `biological_age_history` (insert), `coach_assessment` (completed) call `mark_client_health_context_dirty(client, reason)`,
  which marks today's row (and tomorrow's) dirty and posts a one-client context build at once (60 s debounce). The
  hourly sweep `client-health-context-summary` (`7 * * * *`) rebuilds anything still dirty. The result is stored on
  every row from today on (`chs_finish_context_build`), so the context `version` and `generated_at` move only then.
- Model: `gemini-2.5-flash`, low reasoning, JSON; one retry with the reason when the script breaks a rule, then the
  deterministic fallback script (`fallback: true`).
- Manual rebuild of one client for today: `select public.run_client_health_summaries('all', '<client id>', current_date);`

## 4. The RPCs the app uses

| Call | Shape | Notes |
|---|---|---|
| `get_client_health_summary(p_client_id uuid, p_date date default today)` | one row `{client_id, briefing_date, status, built_at, weekly_summary, context_summary, listen_history, has_quiz, auction_result, context_dirty}` | the row in effect for the date; empty when the caller may not listen (the app cannot tell "no row" from "not allowed"). Since 24 Oct 2026 `listen_history` is **prepended** with each person's newest context listen from the 45 days before the row, marked `carried: true`, when they have none on the row. Never for the weekly |
| `get_client_health_summary_history(p_client_id, p_limit default 14)` | rows `{briefing_date, status, built_at, has_weekly, has_context, weekly_fallback, context_fallback, has_quiz, auction_result, auction_winner, listens}` | previous days |
| `log_summary_listen(p_client_id uuid, p_which 'weekly' \| 'context')` | the new trail entry | SECURITY DEFINER; the caller must pass the gate and a row must exist; appends to the row in effect today. **Called before speaking**, the trail is the record whatever the voice does next. The only app write |
| `get_my_listen_status(p_client_ids uuid[])` | rows `{client_id, has_weekly, has_context, weekly_generated_at, context_generated_at, my_last_weekly_at, my_last_context_at}` | 27 Oct 2026, one batched read for My Crew's Tomorrow's Plan chips: the row in effect today per client plus the caller's newest listen of each kind (the context one carried from earlier days); the app turns it into the gate states with `gateFromStatus` (section 6) |
| Edge `speak-client-summary` `{client_id, which, briefing_date?}` with the user's access token | `{urls[] (signed 1 h), parts, version, briefing_date, cached, speaker, model}` or `{error}` 401 / 400 / 404 / 500 | reads the row with the caller's token (RLS decides), renders the script once per `version` + RECIPE through Sarvam into `client-health-summary-audio/{client_id}/{briefing_date}/{which}-v{version}r{RECIPE}-{i}.mp3`, parts of at most 2300 characters on sentence boundaries, numbers rewritten to words for the voice only |

## 5. Where it shows (app)

- **Client page card** "Listen before the session" (trainer, CRM, doctor, therapist client pages): the rule line
  `LISTEN_WHY` ("Each summary must be heard once after it changes, or Submit stays off."), two rows (Play / Pause /
  Stop, title, "New since you listened" chip, PLAIN VERSION when `fallback`, build time + spoken duration = words ÷ 2.4 s,
  highlight chips, "N improved / N worsened / N to watch", the amber exclusion note, Transcript toggle, "Last listened by
  NAME · time"), the rule line under each row in red (due) or green (heard), the history pill → "Who listened" sheet.
- **Today's Roster strip** (`ClientSummaryStrip`, every non-cancelled card): folded header "Client summaries" with
  the durations, or red "Not heard · listen now" while anything is due; open: the two rows with their rule lines and,
  on the roster only, the LATEST DATA box (WHOOP recovery, sleep, nutrition, steps, hydration, each with its date).
- **Essentials auction cards**: the same strip for the training day (`date = auction_date`), no latest-data box.
- **Log Health Data popup** (the trainer's check-in before a workout log): a "BEFORE YOU LOG" section with the strip
  open above the shared coach notes.
- **My Crew, Tomorrow's Plan**: a chip per client row, red "NOT HEARD · LISTEN NOW" or green "HEARD" (`ListenStatusChip`
  over `get_my_listen_status`), opening `ListenNowSheet` ("You have not heard NAME's summaries. You cannot log tomorrow's
  session without this. Listen now." + the strip open); closing it refetches the chips.
- **The gate sheet** "Listen before you log" in Add Workout, when the form was opened from Today's Roster, online, not
  a queued-log edit: rows 01 and 02 with a status chip (Due today / Heard today / Heard just now / New report · built …
  / Up to date / Nothing to hear yet), no backdrop tap, no back button, one button **Proceed to workout** that reads
  "Listen first" and stays disabled until every red item was heard **to the end** on this phone; then the health
  check-in opens.

Every Play, anywhere, writes the trail first, so a listen on the roster strip or the client page clears the gate for
that client. Known gap (web and app, 22 Oct 2026): a Play stopped at once still counts in the trail; only the in-form
gate insists on "to the end".

## 6. The rule, in code (`src/lib/clientHealthSummary.ts`, pure, copy byte for byte)

`gateStateFor(kind, summary, myListens, nowMs)`:
- `none` when there is no script or no `generated_at`;
- `due` when I never listened to this kind, or my last listen of it is **before** `generated_at`;
- **weekly only**: also `due` when my last listen is not on today's IST day (daily rule, even if the nightly build failed);
- otherwise `done`.
Because the long one is carried forward unchanged and `get_client_health_summary` carries my earlier context listen
(`carried: true`), the same rule reads `done` for the long one until a real update rebuilds it. Only a listen entry
of the same kind by me counts; the weekly never uses a carried entry.

Helpers: `listenGate(row, myId)` → `{weekly, context}` states; `gateDue` (either due); `isNewSince`; `listenRuleLine
(which, state, firstName)` → the copy under each row ("Listen to this at least once today. You cannot log NAME's workout
until you do." / "Listen to this at least once. It changed since you last heard it. …" / "Heard after the latest update.
You can log."); `listenHeaderText`, `listenNowLine`, `gateFromStatus(statusRow, nowMs)` for the batched RPC;
`listenSheetUp({done, armed, eligible, due})`, `listenStillNeeded`, `listenAllHeard` keep the gate sheet up until
Proceed (the sheet judges from the gate **as it was when it opened** plus what this phone heard to the end; a refresh
mid-audio cannot close it). Tests: `tests/rules/health_summary_rules_test.js` (54 checks).

## 7. The voice, in code (`src/lib/summaryVoice.ts`, `createSummaryVoice` + `useSummaryVoice`)

Play → `log_summary_listen` → `speak-client-summary` (45 s timeout) → the signed MP3 parts play back to back on ONE
`expo-audio` player (`createAudioPlayer`, `replace` + `play` on `didJustFinish`, a finish counted only after that part
reported `playing`), `setAudioModeAsync({ playsInSilentMode: true })` first; a part that never reports `playing` within
15 s is a failure. **Fallback** on any failure (function error, timeout, offline, empty urls, player error, stall):
`expo-speech` `en-IN` reads the script in chunks (`splitForSpeech`) with the notice "Cloud voice unavailable (reason);
using this device's voice." and a DEVICE VOICE tag; only when that fails too does the row report an error, the
transcript opens, and inside the gate the item counts as heard. Pause / Resume on the recording on both platforms;
the device voice has no pause on Android. **One sound at a time app-wide** (`src/lib/audioFocus.ts`): any player that
starts claims the focus and the previous one stops or pauses. Stops on unmount, when the strip folds and when the gate
closes. iOS: a device in silent mode plays nothing; the transcript is the fallback. Tests: `tests/rules/summary_voice_test.js`
(53 checks).

## 8. Data layer (`src/lib/clientHealthSummaryQueries.ts`)

- `useClientHealthSummary(clientId, date?)`: rpc `get_client_health_summary`, key `['client-health-summary', clientId,
  date ?? 'today']`, 60 s stale, persisted under the `client-` prefix; `PGRST202` / `42501` / `42P01` read as no row.
- `useLogSummaryListen()`: rpc `log_summary_listen`; on settle invalidates the client's summary keys.
- `useMyListenStatuses(clientIds, enabled)`: rpc `get_my_listen_status`, key `['listen-status', ids]`; the Listen now
  sheet's close refetches it (the listen mutation does not touch this key).
- `useClientLatestDaily(clientId)` (`clientQueries.ts`): the seven newest-entry reads for the LATEST DATA box.

## 9. Verify

```sql
select client_id, briefing_date, status,
       context_summary->>'version' ctx_v, context_summary->>'generated_at' ctx_at,
       weekly_summary->>'generated_at' wk_at, jsonb_array_length(listen_history) listens
from client_health_summary where client_id = '0eecb1ab-6894-4b0d-8779-51920bfbd6b6' order by briefing_date desc limit 5;
```
Expect: `wk_at` changes every day, `ctx_v` / `ctx_at` stay the same across days until an update. Then as Sagar:
`select * from get_client_health_summary('0eecb1ab-…')` shows a `carried: true` context entry first when he heard it
on an earlier day. On the phone: Today's Roster → Vashist → Add workout: the sheet shows the short one "Due today" and
the long one "Up to date" (or "New report" after a real update); hear the red one to the end → Proceed to workout.
