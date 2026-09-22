# Therapy Session Logging — iOS Implementation Prompt (End to End)

Build the complete **Therapy session logging** feature in the iOS app against the live Supabase backend (project `agtjszjedaenclbzgjvi`). This document is the full source of truth, and it reflects the backend AS DEPLOYED AND VERIFIED TODAY — it supersedes any older therapy spec you have (the v2 Android spec included). Android has shipped this exact feature; match it.

**Backend work is DONE.** Everything below about the database and edge functions is already live. iOS writes no migrations, creates no functions — it only calls what exists.

---

## 1. Core concepts

### 1.1 Data model
A therapy session is a `training_sessions` row with `session_type = 'therapy'`. The sub-modality is stored in `session_name` as the **display label**:

| Enum value (used in code/RPC) | Label saved in `session_name` |
|-------------------------------|-------------------------------|
| `massage_therapy`             | `Massage Therapy`             |
| `lymphatic_drainage`          | `Lymphatic Drainage`          |

Hard-code the canonical list:
```swift
let therapyModalities: [(value: String, label: String)] = [
  ("massage_therapy", "Massage Therapy"),
  ("lymphatic_drainage", "Lymphatic Drainage"),
]
```

**Frozen-labels rule (standing decision):** `session_name` is frozen display text. If a label is ever renamed in code, old rows keep their old text. Never backfill, never "correct" old rows.

### 1.2 Notes column — IMPORTANT, changed from older specs
`training_sessions.therapist_notes` **no longer exists — the column was dropped.** The session note lives in **`notes`**. Any select/insert/type that references `therapist_notes` will error. Old sessions' notes were backfilled into `notes`, so history reads work uniformly.

### 1.3 Roster semantics (constraint-critical)
- `session_schedule.status` accepts ONLY `scheduled` / `confirmed` / `cancelled` (CHECK constraint `session_schedule_status_check`). **Never write `status = 'completed'` to `session_schedule` anywhere.**
- The roster's "this was logged" signal is **`workout_session_id IS NOT NULL`** — that column on a roster row holds the linked `training_sessions.id` (as text). All roster/crew UI must derive "completed" from that link, never from status.
- Deleting a therapy session therefore means deleting BOTH rows (see §8).

---

## 2. Who can log therapy

1. **Therapist** (`profiles.role = 'therapist'`) → sees BOTH sub-modalities, always.
2. **Doctor** (`profiles.role = 'doctor'`) → sees therapy ONLY if their `profiles.role_specialization` (a free-form `text[]`) contains `massage_therapy` and/or `lymphatic_drainage`, and only the matching sub-modalities. Exactly one tag → auto-select it (no picker).
3. Gating is a **strict whitelist of exactly those two tags**. `physio_hod`, `hod`, or ANY other/future tag in that column must never unlock therapy logging. Unknown tags are inert, never a crash.

```swift
func allowedTherapyModalities(role: String, roleSpecialization: [String]?) -> [(value: String, label: String)] {
  if role == "therapist" { return therapyModalities }
  let tags = roleSpecialization ?? []
  return therapyModalities.filter { tags.contains($0.value) }
}
```

Live test account for the doctor path: **Jyoti Sharma** (doctor, single tag `lymphatic_drainage`) — her dialog must show the Therapy card with Lymphatic Drainage pre-selected.

---

## 3. Therapist flow

### 3.1 UI (therapist dashboard → Log Session sheet) — match Android
Fields, in order:
1. **Client** — dropdown of assigned clients (`trainer_clients` where `trainer_id = me`, `actively_training = true`); preselected and locked when opened from a client detail or a roster row.
2. **Therapy Type** (REQUIRED) — two selectable cards: "Massage Therapy" and "Lymphatic Drainage". No auto-select for therapists. The section label shows a required/red state until picked.
3. **Duration (minutes)** — stepper, default 60, min 5, step 5.
4. **Session Note** (REQUIRED, non-empty after trim).

No date/time picker — the session is stamped `now()` server-side. Save disabled until client + type + note + duration valid. Validation order for error display: therapy type → note → duration.

### 3.2 Write path — the RPC, nothing else
Call exactly one thing; never perform raw `training_sessions` / `session_schedule` writes in the therapist flow:

```
POST /rest/v1/rpc/therapist_log_session
{
  "p_client":       "<client uuid>",
  "p_duration":     60,
  "p_note":         "free text",
  "p_therapy_type": "massage_therapy"   // or "lymphatic_drainage"
}
```

Live signature (verified): `therapist_log_session(p_client uuid, p_duration integer, p_note text, p_therapy_type text DEFAULT NULL)`. Exactly ONE function exists — do not ask backend for overloads or signature changes; the DEFAULT protects older clients and must stay.

Server-side guards — each raises, surface the message verbatim as the error toast/alert:
- `not authenticated`
- `only therapists can log therapy sessions`
- `session note is required`
- `duration must be greater than 0`
- `client is not assigned to you`
- `invalid therapy type: <x>`

Response (jsonb):
```json
{
  "session_id": "<training_sessions.id>",
  "schedule_id": "<session_schedule.id or null>",
  "linked_scheduled": true,
  "roster_result": "adopted | existing_logged | created | failed",
  "roster_error": null
}
```

What the RPC does (context, not for you to reimplement): inserts the `training_sessions` row (`status 'completed'`, `attendance_marked true`, `location 'Therapy'`, `session_name` = label, **note into `notes`**, `scheduled_at = now()`), then adopt/link/create on today's IST roster (`status 'scheduled'` when creating, link via `workout_session_id`), back-links `schedule_session_id`, and on roster failure writes the `ops_alerts` row itself.

**`roster_error != null` still means the session SAVED** — show the normal success state, do not retry, do not write your own ops alert (the server already did).

### 3.3 After success
- Refresh: the client's therapy history, today's roster, and any crew/day-plan surfaces (the linked roster row is what flips those to LOGGED).
- **Fire the AI analysis** (§6) with the returned `session_id`.

---

## 4. Doctor flow

In the doctor Log Session dialog (the one with Rehab / Recovery categories):

- Render a third **Therapy** category card ONLY when `allowedTherapyModalities` is non-empty (§2).
- The Log Session entry point must also be visible for a therapy-tagged doctor who is not a physio (Jyoti's case).
- Selecting Therapy clears all rehab/recovery state (protocol, phase, checked exercises, recovery modalities); selecting Rehab/Recovery clears therapy state.
- One allowed sub-modality → pre-selected. Two → selection grid, submit blocked until one is chosen.
- Optional free-text notes field.
- Cancelled toggle supported.

Direct insert (no doctor RPC exists) into `training_sessions`:
```json
{
  "client_id": "<uuid>",
  "trainer_id": "<doctor id>",
  "scheduled_at": "<now ISO-8601>",
  "duration_minutes": 60,
  "status": "completed",                          // or "cancelled"
  "session_type": "therapy",
  "session_name": "Massage Therapy | Lymphatic Drainage",
  "notes": "Category: Therapy\nType: <Label>\n\nNotes: <free text>",   // Notes line omitted when empty
  "attendance_marked": true,                       // false when cancelled
  "cancelled": false,
  "location": ""
}
```
Then the self-link: `UPDATE training_sessions SET workout_session_id = id WHERE id = <new id>`. If the self-link fails, the save still succeeds for the user, but insert an `ops_alerts` row (never throwing):
```json
{
  "source": "schedule_link",
  "severity": "error",
  "title": "Therapy session could not be linked to its roster slot",
  "message": "<error message>",
  "context": { "stage": "self_link", "workout_session_id": null, "schedule_session_id": null,
               "client_id": "<uuid>", "trainer_id": "<uuid>", "at": "<ISO-8601>" }
}
```
(The `ops_alerts` INSERT policy requires `source = 'schedule_link'` — keep that exact value.)

No `physio_session_exercises` rows for therapy. After a successful **non-cancelled** save, fire the AI analysis (§6).

---

## 5. Display rules

- Session lists (therapist history, doctor day list, client session views): therapy rows show the `session_name` label as the badge, duration, and the note **from `notes`**. Legacy rows may have `session_name` null → show a plain "Therapy" badge, no label.
- The doctor dashboard session-type whitelist must include `"therapy"` so those sessions count in totals.
- Roster/crew views: logged = `workout_session_id IS NOT NULL`. Never filter `session_schedule` on `status = 'completed'` (no such rows exist).

---

## 6. AI analysis → `training_sessions.rehab_ai_analysis`

Therapy sessions get an AI analysis saved into `rehab_ai_analysis` (NOT the `workout_analysis` path from older specs). The edge function is deployed and already handles therapy:

```swift
// fire-and-forget after a successful non-cancelled save; never block or fail the save on this
supabase.functions.invoke("generate-rehab-ai-analysis", body: ["sessionId": sessionId])
```

- Therapist path: invoke with the RPC's returned `session_id` (even when `roster_error` was non-null).
- Doctor path: invoke with the inserted id, only when not cancelled.
- The function reads the session's `notes` (+ `session_name` for the label), generates a client-facing analysis (Focus Area / Treatment Given / Why This Matters / Expected Impact), and updates `rehab_ai_analysis` itself. Result appears within ~10–20s; nothing to poll — just don't block on it.

---

## 7. Package counting (scope note)

Full cycle/package counting exists on web (`THERAPY_INCLUDED_TIERS` = Odds Plus / Lux / Prive / Apex count therapy in the main cycle; other tiers need an additional package with `service_name = 'Therapy'`). On mobile this is currently **deferred** — do NOT build therapy tabs or cycle diversion unless separately asked. Nothing in §3–§6 depends on it.

## 8. Deleting a test session (ops knowledge)

A therapy save produces TWO rows; deleting only the training row leaves a dangling roster row that still renders as completed. Always:
```sql
delete from session_schedule where workout_session_id = '<training_session_id>';
delete from training_sessions where id = '<training_session_id>';
```

---

## 9. Acceptance checklist

1. Therapist logging calls `therapist_log_session` with all 4 params — no direct table writes anywhere in the therapist flow.
2. Every RPC guard message shows to the user verbatim (wrong role, unassigned client, empty note, zero duration, bad therapy type).
3. Logging twice for the same client on the same IST day yields ONE roster row (`adopted` / `existing_logged`), never two.
4. No code path sends `status = 'completed'` to `session_schedule`.
5. Zero references to `therapist_notes` — every note read/write uses `notes`.
6. Doctor without therapy tags: no Therapy card, and `physio_hod` alone never unlocks it. Jyoti (one tag): card visible, Lymphatic Drainage pre-selected. Two tags: grid, submit blocked until chosen.
7. Doctor insert matches §4 exactly, including structured notes, self-link, and the `ops_alerts` shape on self-link failure.
8. After a therapist or non-cancelled doctor save: `notes` holds the note, `session_name` the label, and `rehab_ai_analysis` fills within ~20s.
9. Cancelled sessions never trigger the AI call.
10. Therapy rows appear in doctor dashboard totals, and roster/crew cards flip to LOGGED via the `workout_session_id` link on the session's own day.
