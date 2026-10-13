# iOS handoff 5 of N: QHP Refresh Pending card on the trainer dashboard (15 Sep 2026)

Paste this whole doc to the iOS app's coding assistant. A new trainer dashboard card lists the trainer's
clients whose **last QHP was completed 40 or more days ago**. Tapping a client opens a sheet to propose a
refresh slot (date, time, note); Send posts the proposal into the client's internal **Client Thread** with the
client's CRM @-tagged. A client already proposed shows green and taps straight into its thread. Built on
Android (odds-app) on 15 Sep 2026; there is no web equivalent.

---

## 0. Ground rules

1. **No new backend.** The backend is LIVE and SHARED (Supabase project `agtjszjedaenclbzgjvi`). Do NOT create,
   alter or run any SQL. Everything uses existing tables, the existing `open_client_thread` RPC and the
   existing Client Threads insert (whose trigger already sends the push).
2. **Reference implementation** in the Android React Native repo `odds-app`:
   `src/lib/qhpRefreshQueries.ts` (`useQhpRefreshPending`, `buildQhpRefreshMessage`, `fmtProposedSlot`,
   `parseProposalSlot`, `daysBetween`, `QHP_REFRESH_DAYS`, `QHP_PROPOSAL_MARK`),
   `src/components/qhpRefreshPending.tsx` (`QhpRefreshPendingCard`, `QhpRefreshRequestSheet`),
   `src/lib/clientThreadQueries.ts` (`pendingThreadClientRef`, `useOpenClientThread`,
   `useSendClientThreadMessage`), `src/screens/clientThreads.tsx` (consumes the deep-link slot), and the mount
   in `src/screens/trainer.tsx`.
3. iOS must already have **Client Threads** (route `client-threads`). This feature posts into it and deep-links
   to it.
4. The sheet follows the app's sheet rules: backdrop as a SIBLING (not a parent Pressable), keyboard-height
   bottom padding, `keyboardShouldPersistTaps="handled"` on every ScrollView, hitSlop 10+. No em dashes in copy.

---

## 1. What the trainer sees

### 1.1 The card (trainer home, directly below the Client Threads card)
- Warm card, 3 px gold top rule, a 42 px rounded gold icon box with a clipboard icon, title
  **"QHP Refresh Pending"**, and a hint line:
  - loading: "Checking your clients…"
  - zero: "Every client had a QHP within the last 40 days." (the card stays, no rows)
  - otherwise: "Last QHP 40+ days ago. Tap a client to propose a slot to their CRM." or, when some are
    proposed, "Last QHP 40+ days ago. 2 proposed, waiting for the CRM."
- Right side: a count pill (solid gold with dark text when > 0, faint when 0; spinner while loading).
- Error: "Couldn't load (<message>)." in red.
- **Rows** (first 5, then "SHOW ALL N" / "SHOW FEWER" in gold caps): avatar with initials, client name, a caps
  line "65 DAYS · LAST QHP 12 JUL", and a purple chip "CRM · RITU" (CRM's first name) or "NO CRM". A 3 px left
  bar and tint: **red** at 60+ days, **gold** at 40 to 59, **green** when already proposed. A proposed row
  (85% opacity) adds a green check line "PROPOSED WED, 18 SEPT 2026, 10:00 AM · TAP TO OPEN THREAD".
- Tap an actionable row → the sheet. Tap a proposed row → straight into that client's thread (no sheet,
  so no second proposal from the app).

### 1.2 The sheet "Propose a QHP slot"
- Grab handle, title "Propose a QHP slot", sub-line "Rahul Verma · last QHP 12 Jul · 65 days ago", close (x).
- An @ line: "Posts to Rahul Verma's thread and tags Ritu Sharma (CRM)." or, without a CRM, "No CRM is assigned
  to Rahul Verma yet. The thread's standing members are notified instead."
- **QHP DATE · SWIPE FOR MORE**: horizontal strip of the next 14 IST days (62 px chips: "TODAY" / "TMRW" /
  weekday caps, day number, month caps). Defaults to **tomorrow**.
- **HOUR · SWIPE FOR MORE**: 16 chips, 6 AM to 9 PM (number + AM/PM). Defaults to **9 AM**, scrolled into view on
  open.
- **MINUTES**: four equal chips ":00 :15 :30 :45". Default ":00". Under them, centered, the resolved slot
  "Wed, 18 Sept 2026, 9:00 am".
- **NOTE FOR THE CRM**: multiline, placeholder "Anything the CRM should know: client availability, location,
  what changed…".
- **MESSAGE PREVIEW** box (purple tint): the exact message that will be posted.
- Button **Send to client thread** (orange gradient, send icon; "Sending…" with a spinner while busy). While busy
  the backdrop, close and back do nothing.
- On success: success haptic, the sheet closes, the row flips to PROPOSED at once, and an alert
  "Sent to the client thread" / "Ritu Sharma is tagged with your proposed slot for Rahul Verma. The client now
  shows as proposed until the CRM schedules the QHP." (without a CRM: "The thread team is notified with …")
  with buttons **Open thread** (deep-links to the thread) and **Done**.
- On error: alert "Couldn't send" + the message.

---

## 2. Data rules (port exactly)

### 2.1 Constants and helpers
```ts
export const QHP_REFRESH_DAYS = 40;
export const QHP_PROPOSAL_MARK = 'QHP refresh due for';   // every proposal carries this phrase; never change it
const nonEmpty = (v) => !!v && typeof v === 'object' && Object.keys(v).length > 0;
const hasQhpData = (a) => !!a.assessment_file_url || nonEmpty(a.qhp_data) || nonEmpty(a.new_client_assessment_data) || nonEmpty(a.existing_client_assessment_data);
export const daysBetween = (fromYmd, toYmd) => Math.floor((Date.parse(`${toYmd}T00:00:00Z`) - Date.parse(`${fromYmd}T00:00:00Z`)) / 864e5);
export const parseProposalSlot = (body) => { const m = /Proposed slot:\s*(.+)/.exec(body ?? ''); return m ? m[1].trim() : null; };
// istDate(d = new Date()) = the IST 'YYYY-MM-DD' of d (Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' })).
```

### 2.2 The query `['trainer-qhp-refresh-pending', trainerId]` (staleTime 5 min; plain array, safe to persist)
`trainerId` = the dashboard's trainer (the signed-in trainer).
1. **My clients**: `trainer_clients.select('client_id, clients:client_id(id, first_name, last_name, status)')
   .eq('trainer_id', trainerId).eq('actively_training', true)`; drop clients whose status is `inactive` or
   `discontinued` (case-insensitive). None → `[]`.
2. **Their QHPs** (any assessor; chunk ids by 200): `coach_assessment.select('client_id, assessment_date, completed,
   assessment_scheduled, assessment_file_url, qhp_data, new_client_assessment_data, existing_client_assessment_data')
   .in('client_id', chunk)`. For each row:
   - completed (`hasQhpData`) → its date = `completed ? istDate(new Date(completed)) : assessment_date`; keep the
     latest per client (`latestDone`). The clock runs from when the assessor FINISHED it (user decision).
   - not completed, `assessment_scheduled === true` and `assessment_date >= today (IST)` → the client already has
     a refresh on the calendar (`upcoming`).
3. **Due** = clients with a `latestDone` date, not in `upcoming`, and `daysBetween(latestDone, today) >= 40`.
   Clients with no QHP at all are NOT listed. None → `[]`.
4. **CRM** per due client (chunk by 200): `trainer_clients.select('client_id, profiles:trainer_id(id, first_name,
   last_name, role)').in('client_id', due).eq('actively_training', true)`; the first row whose profile role is
   `crm` is the CRM (name = first + last).
5. **Proposals already made** (any teammate): `client_threads.select('id, client_id').in('client_id', due)`, then
   `client_thread_messages.select('thread_id, sender_id, body, created_at').in('thread_id', threadIds)
   .ilike('body', '%QHP refresh due for%').order('created_at', { ascending: false }).limit(500)`. Newest first, the
   first hit per client counts, but only if `istDate(created_at) >= latestDone` (a proposal older than the
   latest QHP does not block). Proposal = `{ at: created_at, slot: parseProposalSlot(body), mine: sender_id === trainerId }`.
6. Rows `{ clientId, clientName, lastQhpDate, daysSince, crmId, crmName, proposal }`, sorted: not proposed first,
   then proposed; within each, most days first; then name.

### 2.3 The message (exact format)
```ts
export function fmtProposedSlot({ date, time }) {   // date 'YYYY-MM-DD', time 'HH:mm', both IST
  return new Date(`${date}T${time}:00+05:30`).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short',
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
}
export function buildQhpRefreshMessage(row, slot, note) {
  const last = new Date(`${row.lastQhpDate}T00:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
  const lines = [
    `${row.crmName ? `@${row.crmName} ` : ''}QHP refresh due for ${row.clientName}. Last QHP on ${last} (${row.daysSince} days ago).`,
    `Proposed slot: ${fmtProposedSlot(slot)}`,
  ];
  if (note.trim()) lines.push(`Note: ${note.trim()}`);
  return lines.join('\n');
}
```
Example:
```
@Ritu Sharma QHP refresh due for Rahul Verma. Last QHP on 12 Jul 2026 (65 days ago).
Proposed slot: Wed, 18 Sept 2026, 10:00 am
Note: Client prefers mornings
```
`@Full Name` is the Client Threads mention format (the thread highlights it). The phrase "QHP refresh due for"
and the "Proposed slot:" line are what step 5 reads back; keep them byte-identical.

### 2.4 Send (two existing calls, in order)
```ts
const threadId = (await supabase.rpc('open_client_thread', { p_client_id: row.clientId })).data;  // returns the thread id
await supabase.from('client_thread_messages').insert({ thread_id: threadId, sender_id: <signed-in uid>, body: message });
```
Use the app's existing Client Threads send hook (it does the insert, the optimistic bubble and the
invalidations of `client-thread-messages` / `client-thread-list`). The existing insert trigger pushes to every
assigned staff member of the client plus the standing members (Ops Head + designated admin), minus the sender,
so the CRM is pushed even if the @-mention does not resolve.
After success: patch the row in the cache to `proposal: { at: now, slot: fmtProposedSlot(slot), mine: true }`,
then invalidate `['trainer-qhp-refresh-pending', trainerId]` so the refetch confirms it from the thread.

### 2.5 Deep link into the thread
A module-level slot `pendingThreadClientRef = { current: null as string | null }` in the Client Threads query
file. To open a client's thread: set `pendingThreadClientRef.current = clientId` then navigate to
`client-threads`. The Client Threads screen, in an effect on its list data: if the slot is set and the list
contains that client, clear the slot and open that thread. If the client is not in the list yet, leave the slot
for the next load.

---

## 3. Look (Android tokens; map to yours)
gold `#E0A53C`, red `#E76A52`, green `#57C98A`, purple `#9A7BEA`, sheet `#0E0A09` (top radius 26, max height 90%),
card gradient `rgba(46,36,18,0.45)` to `rgba(18,14,14,0.55)` with a gold 20% border, radius 17. Chips 62 px
wide, 8 px gap; selected = gold 14% fill / 45% border / gold text. Avatar palettes rotate
`#9A7BEA→#6E5BD0`, `#57C98A→#3A9E6E`, `#FB8B3A→#EE5E16`, `#7C8FE8→#5B6FD0`, `#F2C066→#D89A2B`.

## 4. Probe (read-only, trainer login; ask the user for one)
- The three selects in 2.2 steps 1, 2 and 5 return 200 for the trainer.
- `rpc('open_client_thread', { p_client_id })` exists (it is already used by Client Threads). Do not post a test
  message into a real client's thread; the first real proposal is the test.
- SQL cross-check for one trainer (ask the user to run it):
```sql
with mine as (
  select tc.client_id from trainer_clients tc join clients c on c.id = tc.client_id
  where tc.trainer_id = '<trainer uuid>' and tc.actively_training and coalesce(c.status,'') not in ('inactive','discontinued')
), done as (
  select client_id, max(coalesce((completed at time zone 'Asia/Kolkata')::date, assessment_date)) last_qhp from coach_assessment
  where client_id in (select client_id from mine)
    and (assessment_file_url is not null or qhp_data <> '{}'::jsonb or new_client_assessment_data <> '{}'::jsonb or existing_client_assessment_data <> '{}'::jsonb)
  group by client_id
)
select d.client_id, d.last_qhp, (now() at time zone 'Asia/Kolkata')::date - d.last_qhp as days
from done d where (now() at time zone 'Asia/Kolkata')::date - d.last_qhp >= 40 order by days desc;
```
(The app additionally drops clients with a scheduled future QHP.)

## 5. Acceptance test
1. The card shows under Client Threads with the same count as the Android app for the same trainer.
2. Rows: red at 60+ days, gold otherwise; CRM chip or "NO CRM"; five rows then SHOW ALL.
3. Tap a row: the sheet opens with tomorrow, 9 AM, :00 selected and the hour strip scrolled to 9 AM; the preview
   matches section 2.3 exactly.
4. Send: the alert appears; the row turns green "PROPOSED … · TAP TO OPEN THREAD" and sorts below the actionable
   rows; Open thread lands in that client's thread with the proposal as the last bubble and the CRM name
   highlighted; the CRM's phone gets the client-thread push.
5. Tap the proposed row: it opens the thread directly (no sheet).
6. When the CRM schedules the refresh QHP (a scheduled `coach_assessment` dated today or later), the client
   disappears from the card on the next refresh.
7. The keyboard never covers the note; the backdrop tap closes the sheet except while sending.

## 6. If the iOS app is not React Native
Same queries through the Supabase Swift SDK (`from("coach_assessment").select(...).in("client_id", values: chunk)`,
`.ilike("body", pattern: "%QHP refresh due for%")`, `rpc("open_client_thread", params: ["p_client_id": id])`).
The strips are horizontal `ScrollView`s with `ScrollViewReader.scrollTo(9)` on appear; the deep-link slot is a
shared `@Published var pendingThreadClientId` observed by the Client Threads list.
