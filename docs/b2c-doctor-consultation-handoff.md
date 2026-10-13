# B2C handoff: Doctor Consultations in the client app (Odds Longevity), end to end (7 Oct 2026)

Paste this whole document to the client app's coding assistant (the iOS app shown to clients as "Odds Longevity",
with its FastAPI backend on Railway, on the same Supabase project `agtjszjedaenclbzgjvi`). It builds the client's
side of the Doctor Consultation feature that the CRM runs on the web and in the Android staff app: the client sees
their consultant calls, joins the video room with their own code, reads the approved prescription afterwards, sees
the next follow-up the CRM planned, and gets the booking / reschedule pushes. Everything on the server is already
LIVE; the client app only reads and joins. Nothing here changes a staff app.

## How to work through this document
1. Build in the order of the sections; after each report what the app already had, what you changed, what you
   verified. Type-check before moving on.
2. Do NOT create, alter or run any SQL, policy, trigger or function. The client never writes to these tables.
3. Probe read-only first (section 4). Never create test bookings: a booking creates a real video room and a push.
4. Copy rules for clients: plain words, commas instead of dashes, "consultation" for the call, "Dr <name>" for the
   doctor, India time on every date and clock, no code words (never show a status like `scheduled` raw).
5. Privacy rule (the most important line of this document): the client's row holds columns the client must never
   see. **Show only** what section 2 lists. Never render `transcript`, `ai_notes`, `meeting_summary`,
   `edit_history`, `hms_doctor_code`, `meet_url`, `booked_by`, or a prescription whose `prescription_approval.approved`
   is not `true`. The CRM's remarks and AI summary live in another table the client cannot read at all.

---

## 0. What it is

A CRM books a client into a consultant doctor's slot (date, start and end time, a note), a 100ms video room is
created for it with one join code per role, and the client is pushed "Consultation scheduled". The client joins
with **their own** room code at the time. The doctor writes a prescription in the call; the CRM reviews it after the
call and **approves** it, which locks it and makes it visible to the client. When the CRM leaves the call they record
the **next follow-up** (a date or "not decided yet"). A call can be **rescheduled** by the CRM (the client is pushed
again) or **cancelled**. Staff reference: hub-track `docs/features/web/crm/doctor-consultation.md`, Android
`docs/features/android/crm/doctor-consultation.md`, record types in Android `src/lib/consultantQueries.ts`.

---

## 1. Backend contract (all LIVE, read only for the client)

### 1.1 Table `doctor_consultation_details` (one row per booking)
RLS policy "Clients can view their own consultation slots": `SELECT` for the signed-in user when
`clients.profile_id = auth.uid()` for the row's `client_id`. No INSERT / UPDATE / DELETE for clients. The policy is
row-level, so every column of the row comes back; the app filters (rule 5).

Columns to read and show:
- `id` uuid, `client_id` uuid, `doctor_id` uuid (profiles id; the doctor's name is in the push and can be read from
  `profiles` if the app's profiles policy allows it, otherwise through the FastAPI backend, see 1.4)
- `consultation_date` date (`YYYY-MM-DD`, India calendar), `start_time`, `end_time` time (`HH:MM:SS`, India time)
- `description` text or null (the CRM's note, e.g. "Hormonal imbalance.")
- `status` text: `scheduled` | `completed` | `cancelled`
- `hms_client_code` text or null: the client's own join code (null until the room is provisioned; staff can
  "Generate link" later, so re-read before the call)
- `hms_room_id` text or null (informational)
- `prescription` jsonb or null (shape 1.2; show only when approved)
- `prescription_approval` jsonb or null: `{ approved: true, approved_at, approved_by, approved_by_name, approved_by_role, version, note }`
- `next_follow_up` jsonb or null: `{ status: 'date' | 'not_decided', date: 'YYYY-MM-DD' | null, note: text | null, by, by_name, by_role, at, history: [...] }`
- `referral` jsonb or null: `{ speciality, reason, referred_by, referred_by_name, referred_by_role, referred_at, updated_at }`
- `reschedule_history` jsonb array (newest last): `[{ at, by, by_name, by_role, from: {date, start, end}, to: {date, start, end}, reason }]`
- `created_at`

Columns to read but never show: `transcript`, `ai_notes`, `meeting_summary`, `edit_history`, `hms_doctor_code`,
`meet_url` (the doctor's link), `booked_by`. Select only the columns you show (name them in the select).

### 1.2 Prescription JSON (`prescription`, written by the doctor's RPCs, frozen after approval)
```json
{
  "schema_version": 1, "status": "finalized", "version": 2,
  "date": "2026-10-04T02:22:37.317Z", "finalized_at": "...", "updated_at": "...",
  "doctor": { "id": "<uuid>", "name": "Jasjeet Wasir" },
  "patient": { "name": "Vashist Dev", "dob": "1997-10-12", "age": 28 },
  "medicines": [{ "line_id": "m1", "medicine_id": "<uuid|null>", "name": "Allegra 120", "strength": "120mg",
                  "dose_amount": "1", "frequency": "BD", "timing": "After food",
                  "duration_value": 5, "duration_unit": "days", "is_sos": false, "instruction": "", "sort_order": 1 }],
  "lab_tests": [{ "line_id": "l1", "name": "Complete Blood Count (CBC)", "test_id": "<uuid|null>", "sort_order": 1 }],
  "advice": [{ "line_id": "a1", "text": "Walk 30 minutes daily", "sort_order": 1 }],
  "follow_up": { "after_value": 14, "after_unit": "days", "note": "" },
  "special_instruction": "text or null"
}
```
- Visible to the client only when `prescription_approval.approved === true`. Before that, show nothing about a
  prescription (not even "pending").
- Frequency codes to words: `OD` once daily, `BD` twice daily, `TDS` three times daily, `QID` four times daily,
  `HS` at bedtime, `SOS` when needed (also `is_sos: true`). Duration: "for 5 days" / "for 2 weeks" from
  `duration_value` + `duration_unit`; omit when null. A medicine line reads, for example:
  "Allegra 120 · 120mg · 1 dose twice daily · After food · for 5 days" and its `instruction` under it when present.
- Order lines by `sort_order`. `lab_tests` = "Tests advised", `advice` = "Recommendations",
  `special_instruction` = "Special instruction", `follow_up` = "Follow up after 14 days" (+ note), `referral`
  (own column) = "Referred to <speciality>: <reason>".

### 1.3 Pushes (Expo, already sent by the server)
Edge function `notify-consultation-booked` sends to every `device_tokens` row of the client whose token starts
with `ExponentPushToken` (so the client app must keep registering its Expo push token in `device_tokens`
with `client_id`, as it does today):
- Booking: title "Consultation scheduled", body "Your call with Dr <name> is booked for <date> at <time>."
- Reschedule: title "Consultation rescheduled", body "Your call with Dr <name> has moved to <date> at <time>."
- `data`: `{ type: "doctor_consultation", rescheduled: boolean, slot_id, doctor_id, consultation_date, start_time, end_time }`
  → deep-link to the consultation screen for `slot_id`. Nothing is sent on cancellation or completion (the
  app learns those from the row).

### 1.4 Reading through the FastAPI backend (recommended)
The backend already holds the service role key. Safest is one route, e.g. `GET /consultations/mine`, that selects
the allowed columns for the signed-in client's `clients.id`, joins the doctor's name from `profiles`
(`first_name`, `last_name`), strips an unapproved `prescription` to null, and returns the list sorted upcoming
first. The direct-Supabase read with the client's JWT also works (the policy above) if the app prefers it; then
filter the columns in the app and read the doctor's name from the push data or a backend route.

### 1.5 Realtime (optional)
`doctor_consultation_details` is in the `supabase_realtime` publication. A channel on the table filtered by
`client_id=eq.<id>` (event `*`) refreshes the list when the CRM books, moves, cancels, approves or records the
follow-up. A 60 s poll while the screen is open is an acceptable fallback.

### 1.6 The video room
- Client join URL: `https://<HMS_SUBDOMAIN>.app.100ms.live/meeting/<hms_client_code>` where `HMS_SUBDOMAIN` is
  the clinic's 100ms subdomain (the live rooms use `oddsfitness-videoconf-1146`; read it from the backend's env /
  config, do not hard-code it in the app binary). Never open `meet_url`: that is the doctor's code.
- The room is a 100ms "prebuilt" page: open it in an in-app WebView with camera + microphone permission granted
  (`mediaPlaybackRequiresUserAction=false`, inline media playback, allow fullscreen, origin whitelist for the
  100ms domain), or in the system browser as a fallback. The client needs no 100ms SDK.
- Show **Join** from 10 minutes before `start_time` until `end_time` (India time), only while `status =
  'scheduled'` and `hms_client_code` is present; otherwise a quiet line ("Your link is ready on the day" /
  "The link is being prepared").

---

## 2. What the client sees (screens)

### 2.1 Consultations list (entry: a card on the client's home when there is an upcoming call, and a page in the
health / care section)
- Upcoming first (status `scheduled` and end time not yet passed, soonest first), then past calls newest first.
  Cancelled calls are hidden by default (show under "Cancelled" only if the design wants history).
- A call card: "Dr Jasjeet Wasir", "Mon, 6 Oct 2026 · 8:00 PM to 9:00 PM", the description if any, a state pill:
  **Upcoming** (scheduled, ahead), **Today** (same India day, ahead), **Live** (between start and end),
  **Done** (`completed`, or `scheduled` with the end time passed), **Cancelled**. "Moved from Sun, 5 Oct 6:30 PM"
  when `reschedule_history` has an entry (latest entry's `from`).
- Badges on done calls: **Prescription** when `prescription_approval.approved === true`; **Follow-up: 20 Oct 2026**
  or **Follow-up: to be decided** when `next_follow_up` has an answer.

### 2.2 Consultation detail
- Header: doctor, date, time range, state pill, description.
- **Join** button (rule 1.6), plus "Allow camera and microphone when asked" under it the first time.
- **Prescription** section, only when approved: "Approved on 5 Oct 2026" (from `approved_at`, India time), the
  doctor's name and the prescription date, Medicines (each line as in 1.2 with the instruction), Tests advised,
  Recommendations, Special instruction, Follow up after N days (+ note), Referred to <speciality> (+ reason).
  A "Share" / "Save as PDF" is optional and app-side only (the staff PDF is not exposed).
- **Next follow-up**: "Your care team plans the next consultation on Mon, 20 Oct 2026" (+ the note) or "Your care
  team will decide the next consultation date after your reports" when `status = 'not_decided'`. Nothing when
  `next_follow_up` is null.
- **Moved** block when `reschedule_history` is non-empty: "This call was moved from … to … on …" with the reason
  when present.
- Nothing about transcripts, AI notes, meeting notes, approval notes, edit history or the CRM.

### 2.3 Push handling
- On a `doctor_consultation` push: refresh the list; tapping opens the detail for `slot_id`.
- Rescheduled pushes replace any local reminder the app set for the old time; if the app schedules local
  reminders, use `consultation_date` + `start_time` in Asia/Kolkata and set one at 1 hour before and one at
  10 minutes before.

---

## 3. Rules and edge cases
- Times are India time strings on the row; render with `Asia/Kolkata` whatever the device zone.
- "Done" for a scheduled call whose end time has passed (the doctor sometimes never presses Complete), the same
  rule the staff apps use.
- A call can gain its join code after booking (room provisioning can fail and be retried by staff): re-read the
  row when the detail opens and every minute while Join is expected.
- A prescription can be amended before approval (new `version`); only the approved version is ever shown, and
  once approved it no longer changes.
- The client's own device tokens drive the pushes: keep `device_tokens` fresh on login and on token rotation.
- Cancelled: keep the row readable (history) but never offer Join.

---

## 4. Verify
- Read-only as a client account: `GET /rest/v1/doctor_consultation_details?select=id,consultation_date,start_time,end_time,status,hms_client_code,prescription_approval,next_follow_up,referral,reschedule_history&order=consultation_date.desc`
  with the client's JWT returns only that client's rows; another client's id in a filter returns `[]`; anon gets
  401. Live example on 7 Oct 2026: client Vashist Dev (`clients.id 0eecb1ab-6894-4b0d-8779-51920bfbd6b6`) has a 4 Oct call with Dr Jasjeet Wasir and a **draft** prescription,
  so the app must show no prescription for it until the CRM approves.
- Join: open `https://<subdomain>.app.100ms.live/meeting/<hms_client_code>` of a scheduled call in the WebView;
  the room asks for a name and joins as the client role.
- Push: ask the CRM to reschedule a test call; the device receives "Consultation rescheduled" with
  `data.type = "doctor_consultation"` and the detail opens on tap.

## 5. Do not
- No writes to `doctor_consultation_details` or any staff table from the client app.
- Never show unapproved prescriptions, transcripts, AI notes, meeting notes, the doctor's room code or staff names
  beyond the doctor's.
- Do not hard-code the 100ms subdomain in the binary; read it from the backend.
