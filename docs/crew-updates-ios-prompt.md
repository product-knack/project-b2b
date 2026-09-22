# iOS update prompt — My Crew fixes of 24 Aug 2026 (mirror from Android)

Paste this whole file to the iOS Claude. The backend (Supabase `agtjszjedaenclbzgjvi`) is SHARED and all SQL below is ALREADY LIVE — build client-side changes only, do not run or create any SQL. These changes are live on Android; both apps read each other's data, so contracts must match exactly.

---

## 1. Day-plan card: logged/missed state was wrong two ways — replicate both fixes

### 1a. Done-state must be TRAINER-SCOPED (bug: another trainer's log ticked a doctor's session)
A client can have a trainer session AND a doctor (physio) session the same day. The old rule ("any completed session for this client today = done") marked the doctor's crew session as logged when a different trainer logged their own workout. New rule, per entry, most precise signal wins:

1. **Linked roster row logged** — the entry's `schedule_id` row has `workout_session_id` set (or status `completed`) → DONE. Immune to everything else that day.
2. Else **section-owner outcome** — a completed, non-cancelled `training_sessions` row for that client on the plan's IST date **whose `trainer_id` equals the section owner** (the member whose plan row it is) → DONE, and its earliest time that day feeds the green logged-time pill.
3. Another member's log NEVER ticks this member's row.

Apply the same rule to: row tick/cross, green logged-time pill, LOGGED/MISSED stat tiles, per-section progress, and any "awaiting remark" counts. Keep an outcome map keyed `"{trainerId}:{clientId}"` (was client-only). Version/purge any persisted caches of the old client-keyed shape.

### 1b. Card reads must use two NEW definer RPCs (bug: RLS hid teammates' data entirely)
Direct selects on `session_schedule` / `training_sessions` are RLS-scoped to the caller's own clients — a manager viewing another member's section silently got ZERO rows, so everything showed pending/missed even when logged (live case: Sameer Gupta @ Faizan). Replace the card's two reads with these live RPCs (guarded to team participants + physio HOD; error for others — surface errors, don't render silently-wrong data):

- `supabase.rpc('crew_sched_rows', { p_ids: [schedule uuids] })` → jsonb object keyed by schedule id:
  `{ "<id>": { "scheduled_datetime": ISO, "modality": string|null, "status": string|null, "logged": bool, "missed_remarks": [ { at, by, by_name, by_role, category, remark } ] | null } }`
  Use it for: live row time (IST HH:mm), modality, cancelled status, the `logged` flag of rule 1a-1, and the LAST `missed_remarks` entry for display.
- `supabase.rpc('crew_plan_outcome', { p_date: 'YYYY-MM-DD', p_clients: [client uuids] })` → jsonb array:
  `[ { "client_id": uuid, "trainer_id": uuid, "at": ISO } ]` (completed, non-cancelled only, IST-day window).
  Build the `"{trainerId}:{clientId}"` → earliest IST 'HH:mm' map from it (rule 1a-2 + logged pill).

Same fetch cadence as before (poll ~60-120s while the card's date is today).

## 2. Sharing a crew plan now REPLACES the member's pre-existing session (backend change — adjust expectations only)
`plan_sync_roster` (unchanged signature) now DELETES any pre-existing non-crew session the CALLER had with that client on that IST day before creating the plan row (never touches: logged/completed rows, cancelled rows, OTHER members' sessions with that client). Consequences for iOS:
- Per-entry results gained `replaced_prev` (int) — tolerate the extra key; optionally show nothing.
- `conflict` now only means another MEMBER has a session at that exact datetime — old "client already booked with me" conflicts no longer happen. Don't special-case them.

## 3. Weekly Protocol v2 — new schema for the PROTOCOL chip/popup
`clients.weekly_protocol` (jsonb, sometimes a JSON string — parse both) changed:

```json
{ "entries": [
    { "days": ["Thu","Sun"], "modality": "Strength", "frequency": "weekly",
      "trainer_id": "...", "trainer_name": "...", "sessions_per_week": 2 },
    { "days": [], "modality": "Recovery", "frequency": "monthly",
      "trainer_id": "...", "trainer_name": "...", "monthly_session_count": 4 }
  ],
  "total_per_week": 7, "total_per_month": 4, "updated_at": "...", "updated_by": "..." }
```

Rules to implement:
- Entry count = `frequency == 'monthly' ? (monthly_session_count ?? sessions_per_week) : sessions_per_week` (a transitional shape stored monthly counts in `sessions_per_week` — support both). Filter out entries whose count is 0 — note monthly entries have NO `sessions_per_week`, so the old `sessions_per_week > 0` filter silently DROPPED them (that was a live bug).
- Missing `frequency` = legacy = `weekly`.
- Modalities are now `Strength, Yoga, Boxing, Pilates, Aerobics, Aqua Aerobics, Rehab, Recovery`; the legacy stored value `"Rehab / Recovery"` DISPLAYS as `Rehab` (everywhere, including team-flags cards).
- Popup entry line: `<modality> · <n>x/week` or `<n>x/month`, with a small WEEKLY/MONTHLY badge (monthly = purple accent). Monthly entries show "Any day of the month" instead of day chips (days don't apply). Weekly shows days or "Any day".
- Popup header totals are SEPARATE pools: `WEEKLY PROTOCOL · 7/WEEK + 4/MONTH` (omit a zero/absent side; older rows can have fractional total_per_week — print exactly, e.g. 7.75).
- Team Flags backend now flags WEEKLY entries only (2-14/week); monthly entries never flag — no iOS logic needed, cards just arrive that way.

## 4. Optional, if the iOS app has the client messenger ("My Longevity Team")
Message editing shipped: long-press an OWN text bubble → Edit; call `supabase.rpc('edit_chat_message', { p_message: <message id as string>, p_body: <new text> })` (sender-only, text-only, server appends the previous version to `messages.edited_message` jsonb array `[{message, edited_at, edited_by}]`). Show an "edited" tag on bubbles with non-empty `edited_message`, an edit-history list in the message-info sheet, and listen for UPDATE realtime events on `messages` to refresh edited bubbles live. Backwards compatible — messages without the column render as before.

## Definition of done
1. Manager opens the crew card and sees a teammate's logged session as LOGGED with the green time pill (test: any linked entry whose owner logged it).
2. A trainer's workout never marks a doctor's same-day session for the same client as logged.
3. PROTOCOL popup renders monthly entries (`4x/month`, MONTHLY badge, no days) and dual totals; legacy `Rehab / Recovery` shows as `Rehab`.
4. No direct `session_schedule`/`training_sessions` selects remain in the crew card path — RPCs only.
5. Cross-check against an Android device on the same team: both cards show identical logged/missed states.
