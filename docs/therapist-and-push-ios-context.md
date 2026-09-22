# iOS context — Therapist role + My Crew push notifications (24-25 Aug 2026)

Paste this whole file to the iOS Claude. Two features: (1) the Therapist role
end to end, (2) My Crew push notifications. All backend is LIVE on the shared
Supabase — build client-side only. Apply after the earlier consolidated
crew/roster context doc.

=====================================================================
## PART 1 — Therapist role (doctor-like member of a crew team)

### Identity & plumbing
- `profiles.role = 'therapist'` (enum value exists; admin creates via
  User Management). Live test account: "Shiv Therapist", member of team Sagar,
  one assigned client (Vashist Dev).
- Add "Therapist" to the login role selector; after sign-in route to the
  therapist home. IMPORTANT: use ONE canonical role → home-route map for the
  post-login redirect (Android had a hardcoded ternary that silently dumped
  therapists on the trainer dashboard — check yours).
- Assignments are trainer-shaped: `trainer_clients` rows with
  `trainer_id = therapist profile id`, `actively_training = true`.
- Identity color: PURPLE; "THERAPY" purple outline chip everywhere.

### Screens
A. **Dashboard**: Assigned Clients count card (→ My Clients), the My Crew
   team card (therapist sits in a competition team like any member),
   Today's Roster (IST) from `session_schedule` (status colors: completed
   green, cancelled red, else blue; times h:mm a), Recent Clients (first 8).
B. **My Clients**: assigned list (name, subscription, package sessions) +
   top-right Add Session (client dropdown) + tap → Client Detail.
C. **Client Detail**: basics + Add Session + Therapy Sessions list
   (dd-MMM-yyyy h:mm a, duration, status, therapist name, note with preserved
   line breaks).
D. **Add Session sheet** — fields ONLY: fixed read-only modality `Therapy`;
   duration minutes (default 60, min 5, step 5); REQUIRED multiline note.
   NO date/time picker — always stamped now().

### Queries (corrections vs the web doc)
- Assigned clients:
  `trainer_clients?select=client:clients(*,client_packages(sessions_total,sessions_used))&trainer_id=eq.X&actively_training=eq.true`
- Today's roster: **the web doc's embed hint
  `clients!session_schedule_client_id_fkey(...)` DOES NOT EXIST** (verified
  live — PostgREST error). Use the column-based embed instead:
  `client:client_id(id,first_name,last_name)`.
- Therapy sessions of a client:
  `training_sessions?select=id,scheduled_at,duration_minutes,status,therapist_notes,notes,trainer:trainer_id(first_name,last_name)&client_id=eq.X&session_type=eq.therapy&order=scheduled_at.desc`

### Saving a session (two inserts, web parity)
1. `training_sessions` (mandatory): `{client_id, trainer_id, session_type:
   'therapy', scheduled_at: nowISO, duration_minutes, status: 'completed',
   attendance_marked: true, location: 'Therapy', therapist_notes: note}`.
2. `session_schedule` (best-effort — log failure, save still succeeds):
   `{client_id, trainer_id, modality: 'Therapy', session_type: 'therapy',
   scheduled_datetime: same nowISO, status: 'completed', notes: note}`.
Refresh the client's therapy list + today's roster after saving.

### Crew integration — therapists get the DOCTOR treatment
- Wherever the crew card builds its "HOD-managed member" set (was
  role == 'doctor'), use role in ('doctor','therapist'): manager is VIEW-ONLY
  on therapist sections; the physio HOD holds reschedule / request-approval /
  missed-remark / add-session authority; therapists appear in the HOD's
  All Physios feed; their reschedule requests route to the HOD.
- Compose-sheet modality options for a therapist: exactly `['Therapy']`.
- Modality normalizer: map 'therapy' → 'Therapy'.
- Backend already widened (therapist_role_migration.sql): the HOD RPCs and
  the manager-add HOD arm accept doctor OR therapist targets.

=====================================================================
## PART 2 — Small changes from the same window

- **QHP Manager "Set by" attribution**: on the Task Pending cards (Not
  Scheduled AND Scheduled), show who booked the QHP from ops — call
  `rpc('get_lead_qhp_booked_by', { _client_ids: [uuids] })` → returns
  `[{client_id, booked_by_name, booked_by_role}]` (leads.qhp_booked_by with
  creator fallback; definer RPC because QHP managers can't read leads). Render
  a small blue line: `Set by Divya (ops)`. Omit when null; never error if the
  RPC is missing.
- **Academy teacher time parsing** (if iOS has the academy screens): batch
  times are free text; colon-less values like "130 - 400" must normalize to
  1:30-4:00 before parsing (regex insert of ':' into standalone 3-4 digit
  tokens), and any parsed start outside 0-1439 minutes must FAIL OPEN (treat
  as unknown time → attendance markable all day today). Android shipped a bug
  where "130 - 400" parsed as hour 30 → a phantom "6:00 AM" label and a
  permanently locked Log Attendance button.

=====================================================================
## PART 3 — My Crew push notifications

### Backend (fully shared — build NOTHING server-side)
A DB trigger on `manager_team_messages` + three IST cron jobs call the
`notify-crew-event` edge function, which looks up `odds_device_tokens` and
sends FCM. Every push carries `data: { route: 'manager-chat', type: <below> }`.

Instant types: `crew_plan_time_edit` (your session rescheduled / request
approved), `crew_plan_add`, `crew_plan_reschedule_decision` (rejected),
`crew_request` (→ manager), `crew_request_hod` (→ HOD), `crew_session_update`
(→ manager), `crew_plan_shared` (→ manager), `crew_plan_shared_hod` (→ HOD),
`crew_flagged` (→ flagged member), `crew_flags_hod` (→ HOD), `crew_mention`
(@first-name in team chat). Digest types: `crew_morning` (6 AM member day
digest), `crew_plan_reminder` (8 PM member nudge), `crew_rollcall` (8 PM
manager summary), `crew_missed_sweep` (9 PM manager), `crew_missed_hod`
(9 PM HOD). Plus the existing `manager_team_flags` (7 PM manager). The sender
of an action is never notified of it.

### What iOS must build (two things only)
1. **Token registration**: obtain the FCM registration token (Firebase
   Messaging — the Firebase project must have the APNs auth key configured for
   iOS delivery; the backend sends via FCM v1 to whatever token is stored) and
   upsert it into `odds_device_tokens` `{user_id, token, platform: 'ios'}` on
   login and on token refresh; remove it on logout. Mirror however the app
   already registers for the existing flags/assistant pushes if that exists.
2. **Tap handling**: when a notification with `data.route == 'manager-chat'`
   is tapped (foreground banner, background, AND cold start), navigate to the
   My Crew chat screen. `data.type` can be ignored or used for analytics —
   every crew type lands on the same screen.

### Definition of done
1. Manager reschedules a member's session → member's iPhone gets the push;
   tapping opens My Crew (test cold start too).
2. `@FirstName` in the team chat pushes that member only, never the sender.
3. 8 PM roll-call: members missing tomorrow's plan get the nudge; the manager
   gets one summary listing who's missing.
4. Token row appears in `odds_device_tokens` with platform 'ios' after login
   and disappears on logout.
5. Cross-check with an Android device on the same team: both receive the same
   events.
