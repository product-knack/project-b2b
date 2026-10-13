# iOS handoff 2 of N: My Crew, manager Add Session with Force create (23 Sep 2026)

Paste this whole doc to the iOS app's coding assistant. In My Crew (the Team Messenger), a team manager
adds a session into a team member's day. Until 23 Sep 2026 a client clash ended in a dead-end alert
"Not added. {Client} already has a session at that exact time." Now the app shows a **warning with a
Force create button**; Force create cancels the other trainer's booking (with a remark) and creates the
session. Shipped on Android (odds-app); the backend change is live and was tested end to end in production.

---

## 0. Ground rules and how to start

1. **The backend is LIVE and SHARED** (Supabase project `agtjszjedaenclbzgjvi`). Do NOT create, alter or run
   any SQL. The RPC already has the new `p_force` argument (file `odds-app/supabase/crew_add_session_force.sql`,
   run in production on 23 Sep 2026; exactly one overload exists:
   `plan_manager_add_session(p_score uuid, p_trainer uuid, p_client uuid, p_date date, p_time text, p_modality text, p_force boolean default false)`).
2. **Reference implementation** in the Android React Native repo `odds-app`: `src/screens/managerChat.tsx`
   (`AddSessionModal`, the `AddClash` type, `saveAdd`, state `addFor` / `addClash` / `addBusy`, the modal
   mount near the end of the screen) and `src/lib/managerChatQueries.ts` (`useMemberClients`, the send
   mutation, the `plan_add` payload type).
3. **First, check what iOS already has.** Search the iOS My Crew screen for `plan_manager_add_session`.
   - If it exists (the Add Session modal was built from the earlier iOS prompt), apply **section 4 only**
     (the Force create delta) and run the section 6 tests.
   - If it does not exist, build **sections 2 to 5** in order.
4. No em dashes in user-facing copy. hitSlop 10 or more on the new buttons. Never open a second `Modal`
   on top of the Add Session modal: the warning is an overlay INSIDE it.

---

## 1. What the manager experiences

1. On the merged TEAM DAY PLAN card for today or tomorrow, a trainer member's section shows a gold
   "+ ADD" pill (manager only; the physio HOD gets it on doctor / therapist sections).
2. The Add session modal: pick the client, the modality and the time, tap **Add session**.
3. No clash: the modal closes, a success haptic, and a chat bubble "Manager added Riya Mehta at 7:00 AM ·
   Strength to Aman's plan (Today)". The member sees it on their day plan and their Today's Roster.
4. **Clash** (the client already has another trainer's session at that exact time): the modal stays open
   and a warning covers the form:
   - title **"Already booked at that time"**, under it the caps line "ROSTER CLASH · 7:00 AM · TODAY";
   - "Riya Mehta already has a Physiotherapy session at 7:00 AM with Anjana Odds." (plus " (from a crew
     plan)" when the other booking came from a crew plan; "a session" when it has no modality);
   - a red box "FORCE CREATE WILL" / "Cancel that booking with a remark and schedule Riya Mehta with Aman at
     7:00 AM (Strength) instead. Both trainers see the change on their rosters.";
   - two buttons: **Go back** (the warning closes, the form keeps the picks) and **Force create** (red).
5. Force create: the other booking is cancelled with a remark, the new session is created, the modal
   closes, and the bubble reads "Manager added Riya Mehta at 7:00 AM · Strength to Aman's plan (Today) ·
   replaced Anjana Odds's booking at that time".
6. If the other trainer already LOGGED that session, Force create is refused: alert "Can't force this one" /
   "Anjana Odds has already logged Riya Mehta's session at 7:00 AM. A logged session is never cancelled.
   Pick another time." The warning closes; the form stays.

---

## 2. Entry points and gating (skip if already built)

- The add affordance appears ONLY for the **team manager** (`team.isManager`) on TRAINER member sections, and
  for the **physio HOD** on doctor / therapist sections (`role in ('doctor', 'therapist')`); the manager is
  view-only on doctor / therapist sections.
- Only on cards dated **today or tomorrow** (IST, from a server-anchored clock), never on past cards.
- Open the modal with `{ date, trainerId (member), trainerName, scoreId (manager_score.id), scheduledIds }`
  where `scheduledIds` = the client ids already in that member's day: the member's own plan entries for that
  date plus earlier manager / HOD `plan_add` entries for that (date, member).

## 3. The Add session modal (skip if already built)

- Title "Add session", sub-line "{MemberFirst}'s plan · Today. Pick the client, modality and time."
- **Client list**: `trainer_clients` where `trainer_id = member` and `actively_training = true`, joined to
  `clients (id, first_name, last_name, status)`; drop clients whose status is inactive or discontinued
  (case-insensitive); sort by name. A client in `scheduledIds` is locked: dimmed, a padlock, caption
  "ALREADY SCHEDULED · RESCHEDULE TO EDIT"; tapping it alerts "Already scheduled" / "{Client} already has a
  session with {MemberFirst} that day. Use RESCHEDULE on the plan card to change it."
- **Modality chips** follow the member's role: therapist → only "Therapy", preselected; everyone else → the
  union `Strength, Aerobics, Aqua Aerobics, Boxing, Yoga, Pilates, Other, Rehabilitation, Recovery, Physiotherapy`.
- **Time grid**: 05:00 to 22:30 every 30 minutes (36 slots), shown as "5:00 AM" ... "10:30 PM".
- Buttons: Cancel, and **Add session** (enabled when client, modality and time are picked; "Adding…" while busy).

## 4. The write path, including Force create (THE DELTA)

### 4.1 State in the screen
```ts
type AddClash = {
  clientId: string; clientName: string; time: string; modality: string;
  conflict: { schedule_id?: string | null; trainer_id?: string | null; trainer_name?: string | null;
              modality?: string | null; status?: string | null; logged?: boolean; source?: 'crew' | 'roster' } | null;
};
const [addFor, setAddFor] = useState<{ date; trainerId; trainerName; scheduledIds; scoreId } | null>(null);
const [addClash, setAddClash] = useState<AddClash | null>(null); // drives the warning overlay
const [addBusy, setAddBusy] = useState(false);                   // covers the RPC (the send mutation covers the message)
```
Pass to the modal: `busy = sendPending || addBusy`, `clash = addClash`, `onSave(c, name, t, m) => saveAdd(c, name, t, m, false)`,
`onForce = () => saveAdd(addClash.clientId, addClash.clientName, addClash.time, addClash.modality, true)`,
`onDismissClash = () => setAddClash(null)`, and `onClose` clears BOTH `addFor` and `addClash`.

### 4.2 Step 1, the RPC
```ts
const { data, error } = await supabase.rpc('plan_manager_add_session', {
  p_score: addFor.scoreId, p_trainer: addFor.trainerId, p_client: clientId,
  p_date: addFor.date,          // 'YYYY-MM-DD' IST
  p_time: time,                 // 'HH:mm' IST from the grid
  p_modality: modality,
  ...(force ? { p_force: true } : {}),   // send p_force ONLY on the force path
});
```
Guard at the top: return if `sendPending || addBusy`; set `addBusy` true and clear it in `finally`.

Replies (all live-verified on 23 Sep 2026):
| Reply | App does |
|---|---|
| `error` | alert "Add failed" + `error.message`, stop |
| `{ result: 'exists' }` | alert "Already scheduled" / "{Client} already has a session with this member that day. Use RESCHEDULE on the plan card to change it.", stop |
| `{ result: 'conflict', conflict: {...} }` (no `force_blocked`) | `setAddClash({ clientId, clientName, time, modality, conflict })`, stop (the overlay shows) |
| `{ result: 'conflict', force_blocked: 'logged', conflict: {...} }` | `setAddClash(null)`, alert "Can't force this one" / "{conflict.trainer_name ?? 'Another trainer'} has already logged {Client}'s session at {h:mm AM}. A logged session is never cancelled. Pick another time.", stop |
| `{ result: 'created' \| 'adopted', schedule_id, forced?, cancelled? }` | continue to step 2 with `scheduleId = schedule_id` and `replaced = forced ? cancelled : null`; `setAddClash(null)` |

Real replies from the production test (test client, trainer Anjana holding 06:00):
```json
// without force
{ "result": "conflict", "schedule_id": null, "replaced_prev": 0,
  "conflict": { "schedule_id": "f5644823-...", "trainer_id": "30df5c2b-...", "trainer_name": "Anjana Odds",
                "modality": "Physiotherapy", "status": "scheduled", "logged": false, "source": "roster" } }
// with p_force: true
{ "result": "created", "schedule_id": "d88c0ec9-...", "replaced_prev": 0, "forced": true,
  "cancelled": { ...same object as conflict... } }
```
After force, the other trainer's row reads `status 'cancelled'`, `canceled_by 'Trainer'`,
`cancellation_remark 'Replaced by the team manager: crew session with Sagar Sharma at the same time (force add)'`.
The server never cancels a logged row (`workout_session_id` set).

After success invalidate the crew card roster read (`['mgr-plan-sched']` on Android), the trainer and
doctor roster queries, and on a forced add also the CRM month roster query (the cancelled booking can sit there).

### 4.3 Step 2, the `plan_add` message (same send path and retry as text messages)
```json
{ "team_id": "<scoreId>", "kind": "plan_add",
  "payload": { "date": "YYYY-MM-DD", "client_id": "<uuid>", "name": "<client full name>",
               "trainer_id": "<member uuid>", "time": "HH:mm", "modality": "Strength", "schedule_id": "<uuid>",
               "forced": true, "replaced_schedule_id": "<uuid>", "replaced_trainer_id": "<uuid>",
               "replaced_trainer_name": "Anjana Odds" },
  "body": "Manager added {Client} at {h:mm AM}{ · Modality} to {MemberFirst}'s plan ({Today|Tomorrow}){ · replaced {Trainer}'s booking at that time}" }
```
The four `forced` / `replaced_*` keys and the body suffix appear ONLY on a forced add (use
`replaced.trainer_name ?? 'another trainer'`). Then close the modal (`setAddFor(null)`) and fire the success
haptic. If the message fails after the RPC succeeded, the roster row still exists; surface the send failure
like any failed message.

### 4.4 The warning overlay (inside the Add session modal's card)
Absolute-fill over the modal card, radius 18, background `rgba(18,16,14,0.97)`, padding 18, content centered, gap 12:
- Row: a 36 px circle (gold 14% fill, gold 40% border) with a warning-triangle icon in gold, next to the
  title "Already booked at that time" (Serif 18) over "ROSTER CLASH · 7:00 AM · TODAY" (Mono 8.5, gold,
  letterSpacing 0.6, upper case; time from the picked slot, day label from the card date).
- Body (13, ink, line height 19): "{Client} already has {conflict.modality ? `a ${modality} session` : 'a session'}
  at {h:mm AM} with {conflict.trainer_name ?? 'another trainer'}{source === 'crew' ? ' (from a crew plan)' : ''}."
- Red box (padding 10, radius 12, red 7% fill, red 28% border): "FORCE CREATE WILL" (Mono 8.5, red) over
  "Cancel that booking with a remark and schedule {Client} with {MemberFirst} at {h:mm AM}{modality ? ` (${modality})` : ''}
  instead. Both trainers see the change on their rosters." (12, ink, line height 17).
- Two equal buttons (padding 12, radius 13): **Go back** (white 6% fill, white 10% border, semibold ink) and
  **Force create** (red 16% fill, red 55% border, bold red text; "Creating…" while busy). Both disabled while
  busy; both hitSlop 10.
Colors: gold `#E0A53C`, red `#E76A52`, ink `#EDE8E2`.

## 5. Rendering (skip if already built)
- `plan_add` messages merge into the member's section of the day card, latest per `(date, trainer_id, client_id)`;
  accept senders who are the team manager OR the physio HOD. Adds alone create a section. The member's own
  plan entry wins over an add for the same client.
- Entries with a `schedule_id` show live time / modality / status via the definer RPC
  `crew_sched_rows(p_ids uuid[])`; the payload is only a fallback.
- The bubble shows the body text. Plain members see only bubbles they sent or that target them
  (`payload.trainer_id == me`); the manager and the HOD see all.
- Pushes are server-side (trigger on `manager_team_messages` INSERT, route `manager-chat`). Nothing to build.
- The new `forced` / `replaced_*` payload keys are informational; no extra rendering is required.

## 6. Acceptance test (manager login, e.g. Sagar Sharma's; ask the user for it)
1. A plain add with no clash behaves exactly as before: one `plan_add`, the entry on the card and on the
   member's Today's Roster.
2. Pick a client who already has another trainer's session at 7:00 AM that day, pick 7:00 AM, Add session:
   the warning names that trainer and modality; nothing is written yet.
3. Go back: the form is back with client, modality and time still picked.
4. Add session again, then Force create: the modal closes; the bubble ends with "· replaced {Trainer}'s
   booking at that time"; in SQL the other row is `cancelled` with the remark and the new row has notes
   "Created from Team Messenger day plan (added by manager)".
5. The other trainer's roster shows their session cancelled; the member's roster shows the new one.
6. A clash the other trainer already logged: Force create shows "Can't force this one" and writes nothing.
7. A plain team member never sees "+ ADD" on trainer sections; the manager never sees it on doctor /
   therapist sections.

## 7. If the iOS app is not React Native
Same call through the Supabase Swift SDK:
`client.rpc("plan_manager_add_session", params: ["p_score": s, "p_trainer": t, "p_client": c, "p_date": d, "p_time": "07:00", "p_modality": "Strength"] + (force ? ["p_force": true] : [:]))`.
Present the warning as a ZStack overlay inside the existing sheet, not as a second `.sheet` or `.alert`.
