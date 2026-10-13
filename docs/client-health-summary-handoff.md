# Handoff: "Listen before the session" card (client health summary) for the Android app

Written 2026-10-09 by the web session for the odds-app session. The backend is shared and already live; the Android app only needs the card and the device voice. Web reference: `C:\Users\ADMIN\Desktop\b2b\docs\features\web\trainer\client-health-summary.md` (the full feature file) and `C:\Users\ADMIN\Desktop\oddsfitness-hub-track\src\components\trainer\ClientHealthSummaryCard.tsx` (the web card to mirror).

## What it is
Two play buttons on a client's detail page that read a short overview aloud before a session:
- **This week's training**: the last 7 days of sessions, nutrition and sleep, rebuilt every night at 11:59 PM IST.
- **Health context**: the client's recorded condition, the blood report compared with the one before (in words, no values), the QHP compared with the previous one (mobility, strength, cardio and balance, body, lifestyle), the doctor's follow-up, recent medical records; rebuilt within a minute of any new blood report, QHP, medical record or analysed health report. Ends with "For anything clinical, please check the doctor consultation notes."

Every play is recorded with who listened and when. The device speaks the text; no audio file exists anywhere (owner decision). English only.

## Who may see it (RLS, already live)
`can_listen_client_summary(client_id)`: admin, a trainer of the client (`is_trainer_for_client` or `trainer_has_client_access`), any doctor or therapist, CRM and managers. The app's trainer, doctor, therapist and CRM client pages can all mount it; the row read is filtered by that function, so an unauthorised user simply gets no row.

## Data (read with the normal signed-in client)
Table `client_health_summary`, one row per client:
```
select client_id, weekly_summary, weekly_generated_at, context_summary, context_generated_at, context_dirty, listen_history
from client_health_summary where client_id = :clientId   -- maybeSingle
```
- `weekly_summary` jsonb: `{generated_at, window_from, window_to, script, highlights[] (up to 3 short strings), version, fallback, fallback_reason, facts{...}}`. Speak `script`. Show `highlights` as chips.
- `context_summary` jsonb: `{generated_at, script, sources[{type: blood|qhp|medical|report, id, date, label}], improved[], worsened[], watch[] (each {key, label, text, value, previous, unit, date}), medical_events[{text, date, days_ago, ongoing}], profile{age, gender, chronic_conditions[], pain_areas, injuries[], surgical_history, medications[], blood_pressure{text, status}, resting_heart_rate, qhp_date} | null, qhp{items[], mechanical} | null, consultation{date, doctor_name, medicines_count, tests_advised[], follow_up_text, referral_speciality, next_follow_up_date, total} | null, bloods_considered, bloods_in_range[], exclusions_confirmed, version, fallback, fallback_reason}`. Speak `script`. Show "N improved / N worsened / N to watch" chips from the three arrays' lengths. While `exclusions_confirmed` is false show the note "Only the standard blood panel is spoken until the clinical team confirms the full list."
- `listen_history` jsonb array, oldest first: `[{at, by (profile id), by_name, role, which: weekly|context, version}]`.
- No row yet: show "Built nightly at 11:59 PM; nothing yet for this client" / "Built when a QHP, blood or medical report arrives; nothing yet" with the buttons disabled.

## The one write: the listen trail
Before speaking, call the RPC (the row must exist, the caller must pass the RLS rule):
```
supabase.rpc("log_summary_listen", { p_client_id: clientId, p_which: "weekly" | "context" })
```
It returns the appended entry `{at, by, by_name, role, which, version}`. Then re-read the row. Errors are plain messages ("No summary on file for this client yet", "Not allowed to listen to this client's summary").

## Card behaviour to mirror (web `ClientHealthSummaryCard.tsx`)
- Title "Listen before the session", subtitle "Short spoken overviews, read by this device. Numbers come from the records; anything clinical is for the doctor consultation."
- Two rows: round Play button (press again = pause, again = resume; a Stop button while speaking), title, badge **New since you listened** when the summary's `generated_at` is later than the signed-in user's last entry of that `which` in `listen_history` (or they never listened), the build time and an estimated duration (words ÷ 2.4 per second), a Transcript toggle showing `script`, and "Last listened by NAME · time" from the newest entry of that kind. A history button in the header opens the whole trail, newest first (30 entries).
- Speech, **updated 2026-10-09 evening (Sarvam voice)**: the web card no longer speaks on the device first. Call the edge function with the signed-in client: `supabase.functions.invoke("speak-client-summary", { body: { client_id, which } })` → `{ urls: string[], parts, version, cached }`. `urls` are one-hour signed MP3 links, the parts of one recording; play them back to back (`expo-audio` on SDK 57: one `createAudioPlayer`, replace the source when `playbackStatusUpdate.didJustFinish`, pause / resume / stop on the same player; `expo-av` is gone). The first play of a new summary version takes a few seconds (the server renders through Sarvam, then caches); show a spinner and "Preparing the voice…" on the button. On ANY error from the function or the player, fall back to the old `expo-speech` path with a small "device voice" label and a toast "Cloud voice unavailable, using this device's voice". Log the listen through the RPC before calling the function, as before. Subtitle becomes "Short spoken overviews in an Indian English voice. Numbers come from the records; anything clinical is for the doctor consultation." The server side (function, bucket `client-health-summary-audio`, secret `sarvam_key`) is the web session's; nothing for Android to run.
- Query key suggestion: `["client-health-summary", clientId]`, staleTime 60 s, invalidate after the RPC. No realtime needed.
- Scroll/sheet rules from the standing memory apply if the card opens a sheet (hitSlop ≥ 10, no sibling modals, etc.).

## Backend state (nothing for Android to run)
- Migrations live: `20261009100000` (table, RLS, RPC, triggers, crons), `20261009110000` (one-client helper), `20261009120000` (event-driven builds, hourly sweep).
- Edge functions `build-client-weekly-summary` and `build-client-context-summary` deployed through Lovable. The web session still owes one push plus a Lovable redeploy for the newest wording (recency weighting); the JSON shape above is already final.
- Exclusion list `client_health_summary_config` is unconfirmed: only the standard panel of blood markers is spoken until the clinical team confirms it.

## Test clients with both summaries on file
- Vashist Dev `0eecb1ab-6894-4b0d-8779-51920bfbd6b6`
- Asad `afcd7d62-66e6-43f0-be26-f2313011e88f`
Any other client: run in the SQL editor `select public.run_client_health_summaries('weekly', '<id>'); select public.run_client_health_summaries('context', '<id>');` and wait 20 seconds.

## Docs rule
New Android feature: copy `docs/features/_template.md` to `docs/features/android/trainer/client-health-summary.md`, fill every section, add the README index line, and set this web file's "Sibling file" line to it.
