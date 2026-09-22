# Tech Desk — native handoff (Android / iOS)

Feature handoff, 3 Sep 2026. Everything a fresh Claude session in this repo (`odds-app`, React Native / Expo) needs to build the Tech Desk ticketing feature end to end: the live backend contract, the exact PostgREST calls the web client makes, the derivation logic to port byte-for-byte, the screens, and the house rules of this codebase.

Web artifact version (same content, nicer to read): https://claude.ai/code/artifact/cd6c8417-cd0b-4d01-be88-f41d06aa10e5

---

## Read first

- **The backend is already live in production.** Tables, enums, triggers, RPCs, RLS, storage bucket and realtime publication all exist (shipped from the web repo on 3 Sep 2026). The native build needs **zero SQL**. Do not create migrations for this feature.
- **Supabase project:** the same one the app already talks to (`agtjszjedaenclbzgjvi`). Same auth, same `profiles` table.
- **Web reference implementation** (read if the web repo is available, otherwise this doc is enough): `src/lib/techDesk.ts`, `src/hooks/useTechDesk.ts`, `src/hooks/useTechDeskAlerts.ts`, `src/components/tech/*`, `src/pages/tech/*`, migrations `20260903110000_tech_role_enum.sql`, `20260903110100_tech_desk.sql`, `20260903120000_tech_ticket_default_assignee.sql` in `Vashist-rep/oddsfitness-hub-track` (local clone: `C:\Users\ADMIN\Desktop\oddsfitness-hub-track`).
- **Byte-compatibility rule:** the app and the web share one database. Ports must write exactly the same shapes (message payloads, patch fields) so both clients read each other's data. Copy the code blocks in §3–4 rather than re-deriving them.
- **The tech account:** profile id `0c3303a0-7da8-416c-b401-99eed1e2703e` (Nirdosh), role `tech`. Every new ticket is auto-assigned to it by a DB trigger.

---

## 1. Scope & roles

| Who | What they get |
|---|---|
| Every staff role except `super_admin` (admin, ops, crm, coach, trainer, doctor, therapist, academy, marketing) | A **Tech Desk** entry in their navigation: raise a ticket (bug or feature request), see their own tickets with live status, open one to a stage timeline + conversation thread, close their own ticket. |
| `tech` (new role) | Lands on the **Tech inbox**: every ticket from every dashboard, status tabs with counts, filters, search, detail with a stage strip (tap to move), priority / assignee / resolution, thread. This is their home screen; their nav has only Tech Desk. |
| `admin` | Reporter view *plus* an "All Tickets" tab that is the same inbox as tech. (Web also gives admin a Users → Tech tab to create tech accounts; optional in native.) |
| `super_admin` | Nothing. No nav entry, no screens. |

### Vocabulary (Postgres enums — use these exact strings)

| Enum | Values | Labels shown |
|---|---|---|
| `tech_ticket_type` | `bug` · `feature` | Bug · Feature |
| `tech_ticket_priority` | `low` · `medium` · `high` · `urgent` | Low (grey) · Medium (blue) · High (amber) · Urgent (red, pulsing) |
| `tech_ticket_status` | `open` · `in_progress` · `waiting_on_reporter` · `testing` · `resolved` · `closed` | Open · In Progress · Waiting on Reporter · Testing · Resolved · Closed |
| `tech_ticket_resolution` | `fixed` · `wont_fix` · `not_a_bug` | Fixed · Won't fix · Not a bug |
| `tech_platform` | `web` · `ios` · `android` | Web · iOS · Android |

- **Open statuses** (count as "active"): `open, in_progress, waiting_on_reporter, testing`.
- **Stage order** for the reporter's timeline: `open → in_progress → testing → resolved`; `waiting_on_reporter` is shown as a note under In Progress, `closed` as a terminal tag.
- **Ticket number:** display only, never stored: `ticketNo(serial_no) = "T" + String(serial_no).padStart(3, "0")` → T001 … T999, T1000.

---

## 2. Backend contract (live)

### 2.1 `public.tech_tickets` — 14 columns

| Column | Type | Who writes | Notes |
|---|---|---|---|
| `id` | uuid PK | default | |
| `serial_no` | int NOT NULL UNIQUE | **trigger** | Never send it. BEFORE INSERT trigger assigns MAX+1 under an advisory lock. |
| `type` | tech_ticket_type | reporter | required |
| `priority` | tech_ticket_priority | reporter / staff | default `medium` |
| `status` | tech_ticket_status | staff (RPC for reporters) | default `open` |
| `resolution` | tech_ticket_resolution NULL | staff | CHECK: only when status ∈ (resolved, closed). Trigger nulls it automatically when status leaves those. |
| `title` | varchar(120) | reporter | required, ≤120 chars |
| `description` | text | reporter | required |
| `platforms` | tech_platform[] | reporter | default `{}`; UI requires ≥1; GIN indexed |
| `route` | text NULL | reporter | Web stores the last non-Tech-Desk URL path. Native: store the last screen route name, e.g. `app://crm-clients` (see §6.5). |
| `created_by` | uuid → profiles | reporter | must equal `auth.uid()` (RLS) |
| `assigned_to` | uuid → profiles NULL | **trigger** / staff | Defaults to the tech account on insert; staff can change. |
| `created_at` | timestamptz | default | |
| `timeline` | jsonb NOT NULL default `{}` | **trigger / RPC** | Keys: `updated_at` (any real change), `resolved_at`, `closed_at`, `reporter_seen_at`, `tech_seen_at`. ISO strings like `2026-09-03T11:20:15.123Z`. Never write it directly. |

### 2.2 `public.tech_ticket_messages` — 5 columns

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `ticket_id` | uuid → tech_tickets (CASCADE) | |
| `sender_id` | uuid → profiles NULL | The writer. For system rows it is the *actor* (who changed the status); NULL only when done from SQL. Name/role via join, never stored. |
| `message` | jsonb | One of the three shapes below |
| `created_at` | timestamptz | |

```ts
// message payload — exactly these shapes (web type TechMessagePayload)
{ type: "text",   text: string }
{ type: "file",   file: { path, name, mime, size, kind: "image"|"video"|"pdf"|"audio" }, text?: string }
// "audio" = voice memo (the app records AAC .m4a; web records audio/mp4 when the browser can, else webm/opus)
{ type: "system", event: "created"|"status"|"priority"|"assignee", from: string|null, to: string|null }
// system rows are written ONLY by DB triggers. Clients may insert text/file only (RLS enforces it).
```

### 2.3 What the triggers guarantee (so the client never does it)

- **Serial:** `serial_no` assigned on insert; concurrency-safe.
- **Default assignee:** if `assigned_to` is null on insert → the tech account (fallback: first profile with role `tech`).
- **Timeline:** on UPDATE, `timeline.updated_at` is stamped when anything other than `timeline` changed; `resolved_at` / `closed_at` when status lands there; `resolution` is nulled if status leaves resolved/closed.
- **System events:** AFTER INSERT writes `{type:'system',event:'created',from:null,to:'open'}`; AFTER UPDATE writes one row per changed field among status / priority / assigned_to with `from`/`to` as strings (enum text or uuid text). `sender_id = auth.uid()` of the actor.
- **File cleanup:** deleting a file message deletes its storage object.

### 2.4 RPCs

| RPC | Args | Who | Does |
|---|---|---|---|
| `tech_ticket_close` | `{ _id: uuid }` | the reporter of that ticket, or staff | Sets status `closed`. No-op if already closed. Errors: "Ticket not found", "Only the reporter or Tech Desk can close this ticket". |
| `tech_ticket_mark_seen` | `{ _id: uuid }` | reporter or staff | Stamps `timeline.reporter_seen_at` for the reporter and/or `timeline.tech_seen_at` for staff (both if a staff member is also the reporter). Call it when a ticket is opened and whenever new messages arrive while it is open. This is what clears unread dots. |
| `is_tech_desk_staff` | none | anyone | boolean: caller's role ∈ (tech, admin). Prefer deciding from `profile.role` client-side; this exists for RLS. |

### 2.5 RLS matrix

| Table | SELECT | INSERT | UPDATE |
|---|---|---|---|
| `tech_tickets` | `created_by = auth.uid()` OR staff (tech/admin) | `created_by = auth.uid()` | staff only (reporters close via RPC) |
| `tech_ticket_messages` | participant = ticket's reporter OR staff | `sender_id = auth.uid()` AND `message.type ∈ (text, file)` AND participant | none |

Consequence for realtime: a reporter's subscription only ever receives rows of their own tickets; staff receive everything. `tech_tickets` has `REPLICA IDENTITY FULL`, so UPDATE events carry the full `old` row (you can diff `old.status` vs `new.status`).

### 2.6 Storage

- Private bucket `tech-ticket-files`, 25 MB per file, MIME `image/*`, `video/*`, `application/pdf`.
- **Object path must be** `<ticket_id>/<uuid>-<safeName>` — the storage policy authorises by the first 36 chars (the ticket id). `safeName = name.replace(/[^\w.\-()+ ]+/g, "_").slice(0, 80)`.
- Read with signed URLs: `storage.from("tech-ticket-files").createSignedUrl(path, 600)`.

### 2.7 Realtime

Both tables are in the `supabase_realtime` publication. The web subscribes to `postgres_changes` on `tech_tickets` (`*`) and `tech_ticket_messages` (`INSERT`) — see §5.

### 2.8 Roles

`profiles.role` is the Postgres enum `user_role`; `'tech'` was added. The app's Role union / `appRoleOf` / nav / post-login redirect must learn `tech` (same recipe used for `ops` and `therapist`). Staff = `role === "tech" || role === "admin"`. Tech Desk is available when `role && role !== "super_admin"`.

---

## 3. Client contracts — exact PostgREST calls

Copy these verbatim. The FK hints are the auto-generated constraint names and are required because `tech_tickets` has two FKs to `profiles`.

```ts
const TICKET_SELECT = `
  *,
  creator:profiles!tech_tickets_created_by_fkey ( id, first_name, last_name, role, avatar_url ),
  assignee:profiles!tech_tickets_assigned_to_fkey ( id, first_name, last_name, role, avatar_url )
`;
const MESSAGE_SELECT = `
  *,
  sender:profiles!tech_ticket_messages_sender_id_fkey ( id, first_name, last_name, role, avatar_url )
`;

// tickets — "mine" (reporter) or "all" (staff); RLS already scopes, the eq() is belt-and-braces
supabase.from("tech_tickets").select(TICKET_SELECT).order("created_at", { ascending: false }).limit(1000)
  [.eq("created_by", me)]                       // scope === "mine"

// one ticket (deep links)
supabase.from("tech_tickets").select(TICKET_SELECT).eq("id", id).maybeSingle()

// thread
supabase.from("tech_ticket_messages").select(MESSAGE_SELECT).eq("ticket_id", id)
  .order("created_at", { ascending: true }).limit(1000)

// activity (for unread dots) — chunk ids by 100, newest first
supabase.from("tech_ticket_messages").select("ticket_id, sender_id, created_at")
  .in("ticket_id", ids.slice(i, i + 100)).order("created_at", { ascending: false }).limit(1000)

// assignee options
supabase.from("profiles").select("id, first_name, last_name, role, avatar_url").in("role", ["tech"]).order("first_name")
```

### 3.1 Create a ticket (+ attachments)

```ts
const { data: ticket } = await supabase.from("tech_tickets").insert({
  type, priority, title: title.trim(), description: description.trim(),
  platforms,                // e.g. ["ios"] — send the array, Postgres casts to tech_platform[]
  route,                    // string | null
  created_by: me,           // must be auth.uid()
}).select(TICKET_SELECT).single();
// do NOT send serial_no, status, assigned_to, timeline — triggers/defaults own them

// each attachment = upload, then a file message on the new thread (sequential)
for (const f of files) {
  const meta = await uploadTechFile(ticket.id, f);      // §7
  await supabase.from("tech_ticket_messages").insert({ ticket_id: ticket.id, sender_id: me, message: { type: "file", file: meta } });
}
```

Validation (client-side, mirrors the web form): title 1–120 chars; description non-empty; platforms ≥ 1; up to 5 files, each ≤ 25 MB and image/video/pdf. Defaults: type `bug`, priority `medium`, platform preselected to the current OS (`ios`/`android`).

### 3.2 Send a reply

```ts
// text
insert({ ticket_id, sender_id: me, message: { type: "text", text: trimmed } })
// file (optional caption)
insert({ ticket_id, sender_id: me, message: trimmed ? { type: "file", file: meta, text: trimmed } : { type: "file", file: meta } })
// composer is disabled when ticket.status === "closed"
```

### 3.3 Staff updates (partial patch — send only changed keys)

```ts
supabase.from("tech_tickets").update(patch).eq("id", id)
// patch: { status?, priority?, assigned_to?: uuid | null, resolution?: enum | null }
// moving to "resolved" from the UI also sends resolution: ticket.resolution ?? "fixed"
// moving away from resolved/closed: the trigger clears resolution — don't send it
```

### 3.4 Reporter actions

```ts
supabase.rpc("tech_ticket_close", { _id })       // "Close ticket" (confirm first)
supabase.rpc("tech_ticket_mark_seen", { _id })   // on open + whenever messages.length changes while open; silent
```

### 3.5 Query keys & cache policy (web values; keep the shapes)

| Key | staleTime / refetch |
|---|---|
| `["tech-tickets", scope, me]` | 15 s / 60 s |
| `["tech-ticket-messages", ticketId]` | 5 s / 30 s |
| `["tech-ticket-activity", sortedIdsJoined]` | 10 s / 60 s |
| `["tech-desk-badge", me, isStaff]` | — / 60 s |
| `["tech-desk-alerts", me]` | 15 s / 60 s |
| `["tech-desk-staff"]` | 5 min |

**Do not add any of these keys to `PERSIST_PREFIXES`** (the persisted react-query allow-list). They are derived, per-user and cheap to refetch. None of them return a Map/Set.

---

## 4. Derivations — port these exactly

### 4.1 Unread dots

```ts
// activity per ticket, built from the activity query (§3)
interface TicketActivity { lastReporterAt: number; lastOtherAt: number }   // epoch ms
for (const m of rows) {
  const a = (out[m.ticket_id] ??= { lastReporterAt: 0, lastOtherAt: 0 });
  const ts = new Date(m.created_at).getTime();
  if (m.sender_id && m.sender_id === creatorOf(m.ticket_id)) a.lastReporterAt = Math.max(a.lastReporterAt, ts);
  else a.lastOtherAt = Math.max(a.lastOtherAt, ts);          // staff, or system rows with null sender
}
const stamp = (iso?) => iso ? (new Date(iso).getTime() || 0) : 0;
reporterHasUnread = (t, a) => !!a && a.lastOtherAt    > stamp(t.timeline?.reporter_seen_at);
staffHasUnread    = (t, a) => !!a && a.lastReporterAt > stamp(t.timeline?.tech_seen_at);
// note: the "created" system row has sender_id = reporter, so a brand-new ticket shows unread for staff
```

### 4.2 Nav badge

```ts
// staff → number badge = open tickets
supabase.from("tech_tickets").select("id", { count: "exact", head: true }).in("status", OPEN_STATUSES)
// reporter → pulsing dot = number of own non-closed tickets with a message from someone else newer than reporter_seen_at
mine  = from("tech_tickets").select("id, created_by, timeline").eq("created_by", me).neq("status", "closed")
msgs  = from("tech_ticket_messages").select("ticket_id, sender_id, created_at").in("ticket_id", ids).order(desc).limit(1000)
unread = mine.filter(t => msgs.some(m => m.ticket_id === t.id && m.sender_id !== t.created_by && Date(m.created_at) > stamp(t.timeline?.reporter_seen_at))).length
```

### 4.3 Dashboard alerts (reporter side)

For each own non-closed ticket, the *newest* message whose `sender_id !== created_by` and is newer than `reporter_seen_at` becomes one alert. Text:

```ts
describeTechEvent(payload):
  system status   → { kind: "status",   text: `moved to ${STATUS_LABEL[to]}` }
  system priority → { kind: "priority", text: `set priority to ${PRIORITY_LABEL[to]}` }
  system assignee → { kind: "assignee", text: to ? "picked it up" : "unassigned it" }
  file            → { kind: "file",     text: payload.text ? `replied: “${text.slice(0,80)}”` : "sent a file" }
  text            → { kind: "reply",    text: `replied: “${text.slice(0,80)}${text.length > 80 ? "…" : ""}”` }
// banner line: "{actorName} {text} · {timeAgo}" ; actor = sender name, or "Tech Desk" when sender is null
// sort alerts by `at` desc; show the first, "+N more updates"; Open → the ticket; dismiss remembers a signature of ids+timestamps for the session
```

### 4.4 System line rendering in the thread

```ts
created  → `${actor} raised this ticket`
status   → `${actor} moved to ${STATUS_LABEL[to]}`
priority → `${actor} set priority to ${PRIORITY_LABEL[to]}`
assignee → to ? `${actor} assigned to ${staffName(to) ?? "a teammate"}` : `${actor} removed the assignee`
// actor = personName(sender) or "System"; render centred, small, grey, with a dot coloured by the target status/priority
// bubbles: sender_id === ticket.created_by → LEFT (reporter), everything else → RIGHT (tech); role tag on every bubble
```

### 4.5 Reporter stage timeline

```ts
reachedAt = Map<status, iso>; reachedAt.set("open", ticket.created_at);
for m of messages: if (m.message.type === "system" && event === "status" && to) reachedAt.set(to, m.created_at);   // latest wins
if (timeline.resolved_at) reachedAt.set("resolved", …); if (timeline.closed_at) reachedAt.set("closed", …);
currentIdx = closed ? 3 : waiting ? 1 : STAGE_ORDER.indexOf(status)     // STAGE_ORDER = [open, in_progress, testing, resolved]
done(i)    = i < currentIdx || (i === currentIdx && (status === "resolved" || closed))
current(i) = i === currentIdx && !done(i)
// labels: "Raised", "In Progress", "Testing", "Resolved"; timestamps only for done/current; waiting → amber note "Tech Desk is waiting on your reply below."
```

### 4.6 Inbox sorting, filters, counts

```
sort: active (status ∈ OPEN_STATUSES) before done → priority weight desc (urgent 3, high 2, medium 1, low 0) → created_at desc
status tabs (console): active | open | in_progress | waiting_on_reporter | testing | resolved | closed | all — with counts
other filters: priority, type, platform (ticket.platforms.includes), reporter role (creator.role)
search: matches title (case-insensitive) or ticket number; parseTicketNo("T042" | "t42" | "42") → 42
stats: open = status==open; inProgress; urgent = priority==urgent && active; resolved
pinned selection: if the selected ticket drops out of the filtered list (e.g. you just moved it), keep it at the top of the list until another one is selected
```

### 4.7 Small helpers

```
timeAgo(iso): "just now" (<1m) · "5m ago" · "3h ago" · "2d ago" (<7d) · else "12 Aug"
fullStamp(iso): "dd-MMM-yyyy h:mm a" (IST display convention of the app)
personName(p): `${first_name} ${last_name}`.trim() || "Unknown" ; initials = first letters of first two words
fileKindOf(mime): image/* → "image", video/* → "video", else "pdf"
fmtBytes: ≥1 MB → "1.2 MB", else "340 KB"
```

---

## 5. Realtime wiring

```ts
// one channel per mounted Tech Desk screen (unique name per mount, remove on unmount)
supabase.channel(`tech-desk-live-${rand}`)
  .on("postgres_changes", { event: "*",      schema: "public", table: "tech_tickets" },         () => { invalidateDebounced(qc, ["tech-tickets"]); invalidateDebounced(qc, ["tech-desk-badge"]) })
  .on("postgres_changes", { event: "INSERT", schema: "public", table: "tech_ticket_messages" }, (p) => { invalidate(["tech-ticket-messages", p.new.ticket_id]); invalidate(["tech-ticket-activity"]); invalidate(["tech-desk-badge"]) })
  .subscribe();

// global alert listener (any screen, reporters only — skip for tech role):
//   tech_tickets UPDATE where new.created_by === me && new.status !== old.status  → toast "T001 moved to Testing" + Open action
//   tech_ticket_messages INSERT where sender_id !== me && message.type !== "system" → fetch the ticket by id (RLS proves it's mine) → toast "Tech Desk replied: “…” on T001"
//   both also invalidate ["tech-desk-alerts"] and ["tech-desk-badge"]; suppress toasts while the Tech Desk screen is open
```

Native: route every invalidation through `invalidateDebounced(qc, key)` and never fire a haptic per event (house rule). Realtime is a convenience; the 30–60 s refetch intervals are the reliability floor — the app must behave correctly with realtime disconnected.

---

## 6. Screens (native spec)

### 6.1 Navigation & role plumbing

- Add `'tech'` to the Role union in `store.tsx`, map it in `appRoleOf` (`auth.tsx`), add `techNav` in `data.ts` (single item: Tech Desk), drawer pick in `chrome.tsx`, routes in `Router.tsx`, and both post-login redirects (Router session gate AND `SignIn.doSignIn`) → tech lands on `tech-desk-inbox`. Same recipe as ops/therapist.
- Add a **Tech Desk** nav item to every other staff role's nav (not super_admin) → `tech-desk`. Badge: staff → count pill; reporters → small pulsing dot (§4.2).
- Routes: `tech-desk` (member), `tech-desk-ticket` (detail; `set({ selectedTicketId }) + go(...)` per the app's pattern), `tech-desk-raise` (or a sheet), `tech-desk-inbox` (tech/admin), `tech-desk-inbox-ticket`.
- Deep link / alert "Open": navigate to the detail route with the ticket id; on the member list, if the ticket isn't in the current bucket switch to All.

### 6.2 Member — My Tickets

- Header: "Tech Desk" + Live pill + greeting with first name ("Good afternoon, Deepak. Raise a bug or a feature request and watch it move.") + **Raise ticket** CTA. If any ticket has unread replies: "N tickets have new replies" chip.
- Tabs with counts: Active · Resolved · All (Active = OPEN_STATUSES).
- Row (two lines): `T001` mono + priority dot + title (bold when unread) + type glyph; second line: "Tech replied" chip when unread · platforms · age · "with Nirdosh" when assigned. Status chip at the right. Unread ping dot at the far left.
- Empty states: no tickets → "You haven't raised anything yet." + CTA; Active empty → "All clear, nothing waiting on Tech."
- On create: switch to Active, open the new ticket, highlight its row briefly. (Web fires confetti; optional haptic success on native.)

### 6.3 Member — Ticket detail

1. Title line: `T001` + title (large); meta line: Bug/Feature · reporter avatar+name+role · age.
2. Status chip · priority · resolution (if any) · "with <assignee>" · **Close ticket** (confirm dialog → `tech_ticket_close`) unless closed.
3. Platforms · route (mono).
4. Description, clamped to 3 lines with "Show more".
5. **Stage timeline** (§4.5): four nodes on one track, filled portion animates; done = check, current = pulsing ring (amber when waiting on reporter).
6. **Thread** (§4.4): reporter left, tech right, system lines inline, files as image thumb / video / PDF chip via signed URLs.
7. Sticky composer: attach (image/video/pdf) + text; Send button; disabled with "This ticket is closed. Raise a new one if it comes back." when closed.
8. Call `tech_ticket_mark_seen` on mount and whenever the message count changes.

### 6.4 Member — Raise ticket sheet

- Fields in order: Title (counter /120) · Type (Bug | Feature segmented) · Priority (Low | Medium | High | Urgent segmented with dots) · Platform chips (Web · iOS · Android, multi; preselect current OS) · Description (label changes: bug → "What happened, and what did you expect?", feature → "What should it do?") · Attachments (up to 5) · read-only "Page: <route>".
- Footer *outside* the scroll area: Cancel · Raise ticket (disabled until valid; helper text "Add a title, a description and at least one platform.").
- Success toast: "T042 raised".
- This is a bottom sheet with TextInputs → follow the sheet rules in §8 (keyboard padding, shrinkable body, sibling backdrop).

### 6.5 Route capture on native

Web stores the last non-Tech-Desk URL. Native equivalent: keep the last non-tech-desk *route name* from the store-router (e.g. `crm-clients`, `workout`) in module memory and write it as `route = "app://<routeName>"`. Tech reads it as text; the `app://` prefix tells them it came from the app.

### 6.6 Tech console (tech role; admin "All Tickets")

- Header: "Good afternoon, Nirdosh" + readouts (local time, in queue, urgent, raised today) + avatar "TECH · ON DUTY". Dark surface is fine on native (the web forces a dark console); keep the rest of the app's theme untouched.
- **Status tabs with counts** (Active · Open · In Progress · Waiting · Testing · Resolved · Closed · All) = the status filter. Secondary filters as compact pickers: Priority · Type · Platform · Role. Search by T-number or title.
- Rows: two-line (title; reporter avatar + name + role tag · platforms · age · "→ Nirdosh"), status chip right, unread dot when `staffHasUnread`.
- Detail header: title line → **stage strip** (Open → In Progress → Testing → Resolved as tappable pills; done ✓ tinted, current filled with a pulsing ring, tapping moves the ticket; moving to Resolved sends `resolution: existing ?? "fixed"`) → one line of pill pickers: Priority · Assignee (tech profiles + Unassigned) · Resolution (only when resolved/closed) → side actions right-aligned: *Ask reporter* (→ waiting_on_reporter) / *Resume* (→ in_progress), *Close* / *Reopen* (→ in_progress).
- Meta, description (clamped), thread + composer as in 6.3. Mark seen the same way.
- Keep the ticket pinned in the list after a status change (§4.6).

### 6.7 Reporter alerts on every dashboard

- A slim banner at the top of any screen (except Tech Desk screens) when §4.3 returns alerts: "🛟 T001 · title · [status chip] · Nirdosh moved to In Progress · 2m ago · +1 more update · Open · ✕". Dismiss persists for the session; it clears for real when the ticket is opened (mark_seen).
- Live toast (in-app, not push) from the realtime listener in §5. There is *no* server push for Tech Desk today; if push is wanted, add a DB trigger → edge function on the existing `notify-*` pattern as a separate task; do not block on it.

---

## 7. Uploads on React Native

```ts
import * as Crypto from "expo-crypto";            // crypto.randomUUID() is not available in Hermes

export async function uploadTechFile(ticketId: string, f: { uri: string; name: string; mime: string; size: number }) {
  if (f.size > 25 * 1024 * 1024) throw new Error(`${f.name} is over 25 MB`);
  const safeName = f.name.replace(/[^\w.\-()+ ]+/g, "_").slice(0, 80);
  const path = `${ticketId}/${Crypto.randomUUID()}-${safeName}`;
  const body = await (await fetch(f.uri)).arrayBuffer();    // works for file:// and content:// URIs from expo pickers
  const { error } = await uploadWithTimeout(               // house helper, 60 s
    supabase.storage.from("tech-ticket-files").upload(path, body, { contentType: f.mime, upsert: false }));
  if (error) throw error;
  return { path, name: f.name, mime: f.mime, size: f.size, kind: fileKindOf(f.mime) };
}
```

- Pickers: `expo-image-picker` (images/video, allow multiple) and `expo-document-picker` (PDF, `type: "application/pdf"`). Optionally compress images with `expo-image-manipulator` (web compresses to ≤1600px / ~1 MB); keep the original name and mime.
- Render: `createSignedUrl(path, 600)` → `<Image>` / video via whichever player this repo already uses (`expo-video` on current SDKs; `expo-av` is deprecated) / open PDF via `Linking.openURL` or the app's existing report preview.
- This repo's `AGENTS.md` says Expo has changed: check the exact SDK docs (https://docs.expo.dev/versions/v57.0.0/) for the picker, crypto and video APIs before writing code, and reuse whatever upload/picker helpers the app already has (e.g. the chat media / medical-history upload paths) rather than adding new packages.

---

## 8. Native house rules that apply here

1. **Timeouts.** Every network / RPC / upload in screens goes through `src/lib/withTimeout.ts` (`withTimeout`, `invokeWithTimeout`, `uploadWithTimeout`); wrap PostgREST builders in `Promise.resolve(...)`.
2. **Teardown.** Any per-user module cache (e.g. the last-route memory, dismissed-alert signature) registers a wipe with `registerTeardown` (`src/lib/sessionTeardown.ts`).
3. **Realtime.** `invalidateDebounced(qc, key)` only; no per-event haptics; unsubscribe on unmount.
4. **Gates.** Role-gated screens render `<AccessPending>` while identity/capabilities are pending or paused; deny only once known. Gate loading UI on `isPending`, not `isLoading` (offline-paused queries have `isLoading=false`, data undefined).
5. **Sheets.** Raise-ticket and composer sheets: pad by `useKeyboardHeight()` on Android, `maxHeight` + shrinkable ScrollView body, backdrop as a *sibling* Pressable, `keyboardShouldPersistTaps="handled"` on chip rows, icon buttons `hitSlop ≥ 10`, never mount a Modal as a sibling of an open Modal, and don't add keyboard height to `Page pb` (it already does).
6. **Back handling.** Screens with an internal sub-view (list ↔ detail on phones) set `backOverride.handler`.
7. **Persisted cache.** Do not add Tech Desk keys to `PERSIST_PREFIXES`; never store a Map/Set as query data.
8. **Privacy.** Ticket attachments are screenshots of the app; they can contain client health data. Add `tech-desk`, `tech-desk-ticket`, `tech-desk-inbox`, `tech-desk-inbox-ticket` to `SENSITIVE_ROUTES` in `Router.tsx` (replay shield) and tell the user you did. Screenshot lockdown is home-only already, so nothing to add there. Amplitude events: ids, screen names, roles only; never titles, descriptions or message text.
9. **Copy.** No em dashes in user-facing strings (use "·" or a comma). Reuse the label strings in §1 and §4 verbatim so web and app say the same thing.
10. **PostgREST cap.** 1000 rows per request; the activity query chunks ids by 100 for this reason. The inbox list is capped at 1000 tickets by design.

---

## 9. Suggested build order (one session)

1. `src/lib/techDesk.ts`: types, enums, labels, `ticketNo`, `timeAgo`, `OPEN_STATUSES`, `STAGE_ORDER`, helpers (port §1 + §4.7).
2. `src/lib/techDeskQueries.ts`: every query/mutation in §3, activity + unread in §4.1, badge §4.2, alerts §4.3, realtime hook §5, `uploadTechFile` §7.
3. Role plumbing for `tech` + nav entries + routes (§6.1). Verify: signing in as the tech account lands on the inbox.
4. Member screens: list → detail (timeline + thread + composer + close) → raise sheet (§6.2–6.5).
5. Tech console: inbox + detail with stage strip and pickers (§6.6). Admin gets the same screen behind an "All Tickets" tab.
6. Badge on nav items; global alert banner + realtime toasts (§6.7).
7. `SENSITIVE_ROUTES`, teardown registrations; Amplitude `Screen Viewed` is automatic via the store-router.
8. Typecheck, then the manual test plan below on a device with two accounts.

---

## 10. Manual test plan

Accounts: any CRM/trainer login as the reporter; **tech** = the Nirdosh account (role tech). Both against production data; tickets are real, so use obviously-test titles and close them after.

1. Reporter raises a ticket with a screenshot → toast "T00N raised", it appears under Active with status Open, the row shows "→ Nirdosh" (auto-assigned), the thread shows "<name> raised this ticket" and the image.
2. Tech's nav badge increments; the inbox shows the new row with an unread dot; opening it clears the dot (mark_seen).
3. Tech taps *In Progress* on the stage strip → reporter's row/timeline update live (no refresh), reporter gets the in-app toast, and the banner appears on their dashboard.
4. Tech replies with text; reporter sees the bubble on the right with a TECH tag, unread dot + "Tech replied" chip until opened.
5. Tech taps *Ask reporter* → reporter timeline shows the amber "waiting" note; *Resume* returns it.
6. Tech taps *Resolved* → resolution shows "Fixed"; change it to "Not a bug" via the picker; tap *Reopen* → resolution clears automatically (trigger).
7. Reporter taps *Close ticket* → confirm → status Closed, composer disabled on both sides, ticket leaves Active.
8. Offline: airplane mode → lists render from cache without spinners-forever, actions fail with a clear error, back online recovers.
9. Super admin login: no Tech Desk anywhere.

---

## Appendix A — Tech dashboard (console): complete spec in one place

This is the tech role's home screen (`tech-desk-inbox`) and admin's "All Tickets" tab. Everything below is what the web console does today; port the behaviour exactly, adapt the layout to phone/tablet.

### A.1 Data it needs

```ts
tickets  = useTechTickets("all")            // §3, TICKET_SELECT, newest first, limit 1000
activity = useTechTicketActivity(tickets)   // §4.1 (chunked by 100 ids)
staff    = useTechStaff()                   // profiles with role 'tech' (assignee picker)
realtime = useTechDeskRealtime()            // §5, one channel per mounted screen
```

### A.2 Header readouts (all client-side from `tickets`)

| Readout | Formula |
|---|---|
| Greeting | `hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"` + `, ${profile.first_name}` |
| System line | `SYSTEM ONLINE · TECH DESK · ${format(now, "EEE dd MMM").toUpperCase()}` (typed-out effect on web; static is fine on native) |
| Local time | live clock `HH:mm:ss`, ticking every second |
| In queue | `tickets.filter(t => OPEN_STATUSES.includes(t.status)).length` |
| Urgent | `tickets.filter(t => t.priority === "urgent" && OPEN_STATUSES.includes(t.status)).length` (red + pulse when > 0) |
| Raised today | `tickets.filter(t => new Date(t.created_at).toDateString() === new Date().toDateString()).length` |
| Identity chip | initials avatar with glow ring, full name, `TECH · ON DUTY` |
| Live pill | static "Live" with a pulsing dot; it means the realtime channel is mounted, not a measured connection state |

### A.3 Status tabs (= the status filter) and secondary filters

```ts
tabs = [active, open, in_progress, waiting_on_reporter ("Waiting"), testing, resolved, closed, all]
counts: c[status] += 1 per ticket; c.active = tickets in OPEN_STATUSES; c.all = tickets.length
default tab = "active"
secondary pickers (each has an "All" option): priority | type | platform (ticket.platforms.includes(p)) | role (creator.role, options derived from the tickets present)
search: q = text.trim().toLowerCase(); serial = parseTicketNo(q)   // /^t?\s*0*(\d+)$/i
  match = (serial != null && t.serial_no === serial) || t.title.toLowerCase().includes(q) || ticketNo(t.serial_no).toLowerCase().includes(q)
```

Queue header text: `QUEUE // ${filtered.length} TICKET(S)` + "listening" dot; when the selected ticket is pinned (see A.6) append `+ 1 pinned`.

### A.4 Row (two lines)

```
[T001 (cyan mono, unread ping dot to its left)] [priority dot] [title, bold if staffHasUnread] [bug/bulb glyph]
                                                [avatar] [reporter name] [ROLE tag] [WEB · ANDROID mono] · [age] · [→ assigneeFirstName]
                                                                                                    [status chip, right]
```
Sort per §4.6. Tapping a row selects it (split pane on tablet; navigate to `tech-desk-inbox-ticket` on phone, with `backOverride.handler` to return to the list).

### A.5 Ticket detail (staff mode)

1. **Title line**: `T001` (mono, primary colour) + title (large). Below: `Bug | Feature request` · reporter avatar + name + ROLE tag · age. Spinner while a mutation is pending.
2. **Stage strip** — the primary control:

```ts
STAGE_ORDER = ["open", "in_progress", "testing", "resolved"]
closed  = status === "closed"; waiting = status === "waiting_on_reporter"
currentIdx = closed ? 3 : waiting ? 1 : STAGE_ORDER.indexOf(status)
for i, stage:
  done    = i < currentIdx || (closed && i === currentIdx)
  current = !closed && i === currentIdx
  disabled = busy || (current && !waiting)          // tapping the current stage does nothing, unless we're "waiting" (tap In Progress = resume)
  onTap → move(stage)
move(s) = patch(s === "resolved" ? { status: s, resolution: ticket.resolution ?? "fixed" } : { status: s })
visuals: done = filled tint + check; current = filled primary + pulsing ring (amber tint + "· waiting on reporter" suffix when waiting); future = outline
closed → all four shown as done + a trailing "Closed" tag
connectors between pills are tinted up to currentIdx
```

3. **Properties line** (pill pickers): Priority (4 options with dots) · Assignee (`Unassigned` + every `tech` profile) · Resolution (only when status ∈ resolved/closed: `—`, Fixed, Won't fix, Not a bug). Each change = `patch({ field })`.
4. **Side actions** (right-aligned, visibility matrix):

| Current status | Buttons shown |
|---|---|
| open / in_progress / testing | Ask reporter (→ `waiting_on_reporter`) · Close (→ `closed`) |
| waiting_on_reporter | Resume (→ `in_progress`) · Close |
| resolved | Close |
| closed | Reopen (→ `in_progress`) |

5. **Meta line**: platform chips · `route` in mono · "Assigned to <name>".
6. **Description**: clamped to 3 lines with Show more / Show less (long = > 240 chars or > 3 lines).
7. **Thread** (§4.4) + **composer** (attach image/video/pdf, text, Send; disabled when closed with the "This ticket is closed…" line).
8. `tech_ticket_mark_seen(_id)` on open and whenever `messages.length` changes.

Patch semantics reminder: send only the changed keys; the DB trigger writes the system event rows, stamps the timeline, and clears `resolution` when the status leaves resolved/closed.

### A.6 Pinned selection

```ts
pinned   = !!selected && !filtered.some(t => t.id === selected.id)
listRows = pinned ? [selected, ...filtered] : filtered
```
So after you move a ticket out of the current tab it stays at the top of the list (and the header says `+ 1 pinned`) until you select another ticket. Never auto-deselect on a status change.

### A.7 Empty states

- No tickets at all: radar-sweep art + `SCANNING FOR TICKETS_` (mono, blinking cursor) + "When anyone on the team raises something, it lands here instantly."
- Filters exclude everything: "Nothing matches these filters." + "Try widening a filter."
- Nothing selected (tablet right pane): terminal block with three typed lines — `tech-desk --watch --all-dashboards` / `channel: realtime  status: connected` / `awaiting selection_` — and "Pick a ticket on the left. Status, priority and assignee live in its header."

### A.8 Theme and legibility

- Web forces this screen into a dark "console" palette regardless of app theme (deep navy ground, cyan primary, thin dark scrollbars). Native: a dark surface for this screen is the intent; keep every other screen on the app's normal theme.
- Type is one notch larger than the rest of the app on this screen (row titles ~17px, meta ~13px, chips 13px). Tap targets ≥ 44px on native regardless of the web sizes.

### A.9 Admin variant

Admin's Tech Desk = the member screen (§6.2–6.4) plus an **All Tickets** tab that mounts this same inbox with the same behaviour. Admin can raise tickets too, and is "staff" for RLS purposes (can update status/priority/assignee and see every ticket).

### A.10 Sidebar / nav badge for staff

Count of tickets in `OPEN_STATUSES` (§4.2), refetched every 60 s and invalidated by the realtime channel. Shown as a number pill on the Tech Desk nav item.
