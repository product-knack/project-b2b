# TECH DESK: FIVE ADDITIONS FROM WEB, 7 Sep 2026. Port to odds-app end to end.

Built and verified on web (hub-track) on 7 Sep 2026. The backend is shared, so most of the server side is already live; this document says exactly what is live, what to probe, and what the native app must do so both clients read each other's rows identically.

Read first, before touching code:
- `docs/features/android/tech/tech-desk.md` (this app) and `docs/features/web/tech/tech-desk.md` (sections 3, 4, 5, 6, 8 and the 2026-09-07 change-log lines). Update the android file in the same turn you change code, with a dated change-log line.
- The five native files: `src/lib/techDesk.ts`, `src/lib/techDeskQueries.ts`, `src/screens/techDesk.tsx`, `src/screens/techDeskInbox.tsx`, `src/components/TechDeskAlerts.tsx`.
- House rules still apply: no em dashes in anything a user reads; every network call through `withTimeout`; sheets with inputs use the keyboard-lift pattern and dismiss the keyboard before unmount; realtime through `invalidateDebounced`; do not touch `OPEN_STATUSES`; never write `acknowledgement`, `time_taken` or `closure` from a client; keep every enum string, payload shape and label byte-identical to web `src/lib/techDesk.ts`.

## 0. The five things, in one breath

1. Ticket type `other` (reporter's escape hatch) plus `research` if the raise sheet still lacks it.
2. Platform `none` (exclusive: picking it clears the others, picking another drops it).
3. Staff can re-file a ticket's type from the detail, and a new system event `type` lands in the thread ("<actor> filed this as <label>").
4. Staff can write a type by hand: new column `type_label`. When set it IS the displayed type everywhere; enum `type` is `other` underneath.
5. Staff log time taken (`time_taken` jsonb via RPC, any status, nudged once done), and reporters must give a reason to close (`closure` jsonb via RPC, permanent, shown to Tech).

## 1. Server side: what is live, what to probe, what to run

State on 7 Sep 2026 11:40 IST (probed through PostgREST with the publishable key; `22P02` = enum value missing, `PGRST202` = function missing, `28000` = function exists):

| Piece | Live? |
|---|---|
| `tech_ticket_type` value `other`, `tech_platform` value `none` (Script 1) | yes |
| trigger `trg_tech_ticket_type_change` (Script 2, superseded by Script 5) | not at last check |
| `tech_tickets.time_taken` + RPC `tech_ticket_set_time_taken` (Script 3) | yes |
| `tech_tickets.closure` + RPC `tech_ticket_close_with_reason` (Script 4) | unknown, handed to the user after the probe |
| `tech_tickets.type_label` + replaced type-change trigger (Script 5) | unknown, handed to the user after the probe |

Probe before assuming (anon key is fine, RLS returns `[]` on success):

```
GET /rest/v1/tech_tickets?select=id&platforms=cs.{none}&limit=1      -> 200 [] means 'none' exists
GET /rest/v1/tech_tickets?select=id&type=eq.other&limit=1            -> 200 [] means 'other' exists
GET /rest/v1/tech_tickets?select=time_taken,closure,type_label&limit=1 -> 200 [] means all three columns exist (a 400 names the missing one)
POST /rest/v1/rpc/tech_ticket_set_time_taken   {"_id":"00000000-0000-0000-0000-000000000000","_minutes":1}   -> 403 28000 = exists
POST /rest/v1/rpc/tech_ticket_close_with_reason {"_id":"00000000-0000-0000-0000-000000000000","_reason":"x"} -> 403 28000 = exists
POST /rest/v1/rpc/tech_ticket_log_type_change  {}                                                          -> 404 PGRST202 = trigger fn missing
```

If anything is missing, the scripts below are the source of truth (also saved in hub-track `supabase/migrations/20260907*.sql`). Run them in the Supabase SQL editor in this order. Script 1 must run ALONE (new enum values cannot be referenced in the transaction that adds them). Scripts 3, 4, 5 are idempotent. Script 5 replaces Script 2, so skip Script 2 if you run 5.

Script 1 (alone):
```sql
ALTER TYPE public.tech_ticket_type ADD VALUE IF NOT EXISTS 'other';
ALTER TYPE public.tech_platform    ADD VALUE IF NOT EXISTS 'none';
```

Script 3 (time taken):
```sql
ALTER TABLE public.tech_tickets ADD COLUMN IF NOT EXISTS time_taken jsonb;

CREATE OR REPLACE FUNCTION public.tech_ticket_set_time_taken(_id uuid, _minutes integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me    uuid := auth.uid();
  _name  text;
  _entry jsonb;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000'; END IF;
  IF NOT public.is_tech_desk_staff() THEN RAISE EXCEPTION 'Only Tech Desk staff can log time' USING ERRCODE = '42501'; END IF;
  IF _minutes IS NOT NULL AND (_minutes < 0 OR _minutes > 100000) THEN
    RAISE EXCEPTION 'Time must be between 0 and 100000 minutes' USING ERRCODE = 'P0001';
  END IF;
  IF _minutes IS NULL THEN
    _entry := NULL;
  ELSE
    SELECT nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), '')
      INTO _name FROM public.profiles WHERE id = _me;
    _entry := jsonb_build_object('minutes', _minutes, 'by', _me, 'by_name', _name, 'at', to_jsonb(now()));
  END IF;
  UPDATE public.tech_tickets SET time_taken = _entry WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ticket not found' USING ERRCODE = 'P0002'; END IF;
  RETURN _entry;
END $$;
GRANT EXECUTE ON FUNCTION public.tech_ticket_set_time_taken(uuid, integer) TO authenticated;
```

Script 4 (close with reason):
```sql
ALTER TABLE public.tech_tickets ADD COLUMN IF NOT EXISTS closure jsonb;

CREATE OR REPLACE FUNCTION public.tech_ticket_close_with_reason(_id uuid, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me      uuid := auth.uid();
  _clean   text := nullif(btrim(coalesce(_reason, '')), '');
  _creator uuid;
  _status  text;
  _staff   boolean;
  _name    text;
  _entry   jsonb;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000'; END IF;
  IF _clean IS NULL THEN RAISE EXCEPTION 'Add a reason before closing' USING ERRCODE = 'P0001'; END IF;
  IF length(_clean) > 1000 THEN RAISE EXCEPTION 'Reason is too long (max 1000 characters)' USING ERRCODE = 'P0001'; END IF;
  SELECT created_by, status::text INTO _creator, _status FROM public.tech_tickets WHERE id = _id;
  IF _creator IS NULL THEN RAISE EXCEPTION 'Ticket not found' USING ERRCODE = 'P0002'; END IF;
  _staff := public.is_tech_desk_staff();
  IF _creator <> _me AND NOT _staff THEN
    RAISE EXCEPTION 'Only the reporter or Tech Desk can close this ticket' USING ERRCODE = '42501';
  END IF;
  IF _status = 'closed' THEN RAISE EXCEPTION 'This ticket is already closed' USING ERRCODE = 'P0001'; END IF;
  SELECT nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), '')
    INTO _name FROM public.profiles WHERE id = _me;
  _entry := jsonb_build_object(
    'reason', _clean, 'by', _me, 'by_name', _name,
    'by_role', CASE WHEN _creator = _me THEN 'reporter' ELSE 'staff' END,
    'at', to_jsonb(now()));
  INSERT INTO public.tech_ticket_messages (ticket_id, sender_id, message)
  VALUES (_id, _me, jsonb_build_object('type', 'text', 'text', 'Closed this ticket. Reason: ' || _clean));
  UPDATE public.tech_tickets SET status = 'closed', closure = _entry WHERE id = _id;
  RETURN _entry;
END $$;
GRANT EXECUTE ON FUNCTION public.tech_ticket_close_with_reason(uuid, text) TO authenticated;
```

Script 5 (written type + the type-change logger):
```sql
ALTER TABLE public.tech_tickets ADD COLUMN IF NOT EXISTS type_label text;
ALTER TABLE public.tech_tickets DROP CONSTRAINT IF EXISTS tech_tickets_type_label_len;
ALTER TABLE public.tech_tickets ADD CONSTRAINT tech_tickets_type_label_len
  CHECK (type_label IS NULL OR length(btrim(type_label)) BETWEEN 1 AND 40);

CREATE OR REPLACE FUNCTION public.tech_ticket_log_type_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _from text := coalesce(nullif(btrim(OLD.type_label), ''), OLD.type::text);
  _to   text := coalesce(nullif(btrim(NEW.type_label), ''), NEW.type::text);
BEGIN
  IF _from IS DISTINCT FROM _to THEN
    INSERT INTO public.tech_ticket_messages (ticket_id, sender_id, message)
    VALUES (NEW.id, auth.uid(), jsonb_build_object('type','system','event','type','from',_from,'to',_to));
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_tech_ticket_type_change ON public.tech_tickets;
CREATE TRIGGER trg_tech_ticket_type_change
  AFTER UPDATE OF type, type_label ON public.tech_tickets
  FOR EACH ROW EXECUTE FUNCTION public.tech_ticket_log_type_change();
```

Nothing else changed server-side. RLS is unchanged: staff UPDATE already covers `type` and `type_label`; `time_taken` and `closure` are RPC-only; reporters can SELECT all three new columns. `tech_ticket_close(_id)` still exists for staff one-click close; web reporters no longer call it.

## 2. Contract (byte-identical on both clients)

Enums:
- `tech_ticket_type`: `bug | feature | research | other`
- `tech_platform`: `web | ios | android | none`

Columns on `tech_tickets` (all NULL by default):
- `type_label text` (1..40 trimmed). Staff-written type name.
- `time_taken jsonb` = `{ minutes: int, by: uuid, by_name: text|null, at: timestamptz }`
- `closure jsonb` = `{ reason: text, by: uuid, by_name: text|null, by_role: 'reporter'|'staff', at: timestamptz }`

System message events: `created | status | priority | assignee | type`. For `type`, `from`/`to` are the written label when set, else the enum text. Render `to` as `TYPE_META[to]?.label ?? to`, so a written label falls through untouched.

RPCs (SECURITY DEFINER, granted to `authenticated`):
- `tech_ticket_set_time_taken(_id uuid, _minutes int) -> jsonb`. NULL minutes clears. Errors: 28000 not signed in, 42501 not staff, P0001 outside 0..100000, P0002 not found. Map PGRST202 to "Time logging is not enabled yet. Run the Tech Desk time-taken script."
- `tech_ticket_close_with_reason(_id uuid, _reason text) -> jsonb`. Errors: 28000, P0001 empty reason / over 1000 chars / already closed, P0002 not found, 42501 neither reporter nor staff. Inserts the text message "Closed this ticket. Reason: <reason>" from the closer, then sets `status='closed'` and `closure`. Map PGRST202 to "Closing with a reason is not enabled yet. Run the Tech Desk close-reason script."

Labels (verbatim):
- `TYPE_META`: bug "Bug"/"Bug", feature "Feature"/"Feature request", research "Research"/"Research", other "Other"/"Other (to be filed)". `ALL_TYPES = ['bug','feature','research','other']`.
- `PLATFORM_META.none = { label: 'None' }`; `ALL_PLATFORMS = ['web','ios','android','none']`. In chips render `none` as "No platform" with a dashed border.
- `TYPE_LABEL_MAX = 40`. `TIME_PRESETS = [15, 30, 60, 120, 240, 480]`.

Helpers (port exactly):
```ts
export const typeLabelOf = (t) => t.type_label?.trim() || TYPE_META[t.type]?.label || t.type;
export const typeLongOf  = (t) => t.type_label?.trim() || TYPE_META[t.type]?.long  || t.type;
export const isUnfiled   = (t) => t.type === 'other' && !t.type_label?.trim();
export const customTypeLabels = (tickets) => /* distinct trimmed type_label, most used first, then alphabetical */;
export const togglePlatformIn = (cur, p) => {
  if (p === 'none') return cur.includes('none') ? [] : ['none'];
  const base = cur.filter(x => x !== 'none');
  return base.includes(p) ? base.filter(x => x !== p) : [...base, p];
};
export const fmtMinutes = (min) => { const m = Math.max(0, Math.round(min)); const h = Math.floor(m/60); const r = m%60; return h === 0 ? `${r}m` : r === 0 ? `${h}h` : `${h}h ${r}m`; };
```

Patch rule: a type change is ONE update carrying both keys. Fixed kind: `{ type: 'bug', type_label: null }`. Written: `{ type: 'other', type_label: 'Hardware' }`. Never send one without the other.

## 3. Client rules

- The displayed type is `typeLabelOf(t)` everywhere: rows, detail meta, thread lines, alert text, filters. A written type also swaps the glyph to a tag icon (sky) and adds a small sky chip with the name next to the title on rows. It must never look "unfiled".
- "Other" with no label = unfiled: amber border on the console's Type control and an amber NEEDS FILING chip. Both disappear the moment anything is set.
- `none` is exclusive in the raise sheet. "Pick at least one" still applies and None satisfies it.
- Time taken is staff only. Reporters never see it anywhere. No thread message is written for it (it would trip the reporter's unread dot). Staff can set it at any status; once the ticket is resolved or closed with nothing logged, the control turns amber and reads "Add time taken". Never blocks a status move.
- Closing as a reporter requires a reason. Empty submit: red border, helper "ADD A REASON TO CLOSE", sheet stays open. 1000-char cap. Staff one-click close is unchanged and needs no reason.
- The closure record is permanent and shown to BOTH sides under the description. If the ticket is later reopened the record stays and says "(reopened since)".
- The reporter's reason arrives in the thread as a text message from the reporter, so on the console it already counts as reporter activity (unread badge, NEW REPLY alert). No new alert kind is needed.
- The type-change system row is written by the trigger. The client only patches the ticket.
- Realtime: the existing `tech_tickets` UPDATE subscription already invalidates the lists; the reporter banner/toast should also fire when `type` or `type_label` changed: "T0NN filed as <typeLabelOf(new)>".

## 4. Screen by screen

### `src/lib/techDesk.ts`
- `TechTicketType` add `'other'`; `TechPlatform` add `'none'`; `TechSystemEvent` add `'type'`.
- New types `TechTimeTaken`, `TechClosure`; on `TechTicket` add `type_label?: string | null`, `time_taken?: TechTimeTaken | null`, `closure?: TechClosure | null`.
- `TYPE_META`, `ALL_TYPES`, `PLATFORM_META`, `ALL_PLATFORMS`, `TYPE_LABEL_MAX`, `TIME_PRESETS`, `typeLabelOf`, `typeLongOf`, `isUnfiled`, `customTypeLabels`, `togglePlatformIn`, `fmtMinutes`, `splitMinutes`.
- `systemLineText`: case `'type'` -> `${actor} filed this as ${TYPE_META[p.to]?.label ?? p.to}`.
- `describeTechEvent`: event `'type'` -> `{ kind: 'type', text: 'filed it as <label>' }`.

### `src/lib/techDeskQueries.ts`
- `TechTicketPatch` add `type?: TechTicketType; type_label?: string | null`.
- New `useSetTimeTaken()` -> rpc `tech_ticket_set_time_taken { _id, _minutes }`, toast "Logged 2h 30m" / "Time cleared", invalidate tickets. PGRST202 mapping above.
- New `useCloseTicketWithReason()` -> rpc `tech_ticket_close_with_reason { _id, _reason: reason.trim() }`, toast "Ticket closed", invalidate tickets, messages(id), activity, badge, alerts. PGRST202 mapping above.
- New `useCustomTypeLabels()` reading whatever ticket lists are already in the query cache (`['tech-tickets', ...]`) and returning `customTypeLabels(all)`. No new network call.
- `withTimeout` on all of them.

### `src/screens/techDesk.tsx` (member)
- RaiseTicketSheet: Type toggle becomes Bug / Feature / Research / Other (four options, give the row its own line). Picking Other shows a line: "Not sure where it fits? That is fine. Tech reads it and files it under the right type, and you see the change here." Description label per type: bug "What happened, and what did you expect?", feature "What should it do?", research "What should we look into?", other "What do you need?". Placeholder for other: "Say what you need and who it is for. Access, a device, an account, a question, anything Tech can help with."
- Platforms: add a dashed "None" toggle using `togglePlatformIn`. Empty-state hint: "Pick at least one, or None".
- TicketRow: type glyph via label (tag when written) plus the sky label chip next to the title. Platform text renders `none` as "No platform".
- TechDeskTicket detail: TicketMeta type via `typeLongOf`. Replace the Close confirm alert with a `CloseReasonSheet`: title "Close T0NN?", body "Tech Desk stops working on it. Say why, so Tech knows what happened. The reason stays on this ticket.", label "Reason *", placeholder "Sorted itself out, no longer needed, raised by mistake, found a workaround...", helper "Required. Tech sees it in the thread and on the ticket.", counter "n/1000", buttons "Keep open" and "Close ticket". Empty submit: red border, placeholder swaps to "Tell Tech why you are closing this", helper swaps to "ADD A REASON TO CLOSE", nothing sent. Synchronous `sentRef` guard like the AcknowledgeCard. Keyboard-lift pattern. The button stays hidden while the AcknowledgeCard is up (unchanged rule).
- `ClosureRecord` under the description whenever `closure` is set: eyebrow "CLOSED BY REPORTER" or "CLOSED BY TECH DESK" (+ " (reopened since)" when status is no longer closed), line "<by_name or The reporter/Tech Desk> · <fullStamp(at)>", quoted reason. Lock icon, muted card.

### `src/screens/techDeskInbox.tsx` (console)
- Pickers: Type filter options All / Bug / Feature / Research / "Other (unfiled)" / one entry per `customTypeLabels(tickets)` (value `label:<text>`). Filter rule: `label:` entries match `type_label` exactly; `other` matches only unfiled; fixed kinds match `type`. Platform filter gains None.
- ConsoleRow: tag glyph + sky label chip for a written type; meta line adds `⏱ 2h 30m` (cyan) when `time_taken` is set; closed rows with `closure.by_role === 'reporter'` get an outline chip "CLOSED BY REPORTER"; platforms text renders `none` as "NONE".
- TechDeskInboxTicket: replace the Type control with a `TypePicker` sheet: header "Type", the four fixed kinds as a 2x2 grid (glyph + label, check on the current one), divider, "Or write your own" input (40 max, Enter or Set, counter "n/40", line "Now: <label>" when set else "Shows everywhere as the ticket's type."), and reuse chips from `useCustomTypeLabels()` filtered by what is typed, max 8. Picking a fixed kind sends `{type, type_label: null}`; Set sends `{type:'other', type_label}`. Amber border + NEEDS FILING chip while `isUnfiled`.
- `TimeTakenPill` after Resolution: label "Time" + value ("Time 2h 30m"), amber "Add time taken" when resolved/closed and nothing logged. Sheet: eyebrow "TIME TAKEN", line "How long this took, by your count. You can change it any time.", quick picks 15m 30m 1h 2h 4h 8h (tap = save), Hours + Minutes inputs + Save (enabled when total in 1..100000), footer "<fmt> by <by_name or staff> · <fullStamp>" or "Nothing logged yet.", Clear when set (sends NULL).
- `ClosureRecord` in the console detail too (same component), and staff "Close" one-click stays as is.
- ConsoleAlerts: no new kind. The reporter's reason is a reporter text message and already shows as NEW REPLY.

### `src/components/TechDeskAlerts.tsx`
- Handle `describeTechEvent` kind `'type'` in the banner text.
- Realtime UPDATE on my own ticket: when `type` or `type_label` changed and I am not on a tech-desk route, toast/banner "T0NN filed as <typeLabelOf(new)>" with Open.

### Router / nav / roles
- Nothing new. The four routes stay in `SENSITIVE_ROUTES`.

## 5. Copy, verbatim (no em dashes)

- "Not sure where it fits? That is fine. Tech reads it and files it under the right type, and you see the change here."
- "Pick at least one, or None"
- "Or write your own" / "Hardware, Access, Data fix..." / "Shows everywhere as the ticket's type." / "Needs filing"
- "Time taken" / "How long this took, by your count. You can change it any time." / "Add time taken" / "Nothing logged yet." / "Logged 2h 30m" / "Time cleared"
- "Close T0NN?" / "Tech Desk stops working on it. Say why, so Tech knows what happened. The reason stays on this ticket." / "Required. Tech sees it in the thread and on the ticket." / "Tell Tech why you are closing this" / "Add a reason to close" / "Keep open" / "Close ticket"
- "Closed by reporter" / "Closed by Tech Desk" / "(reopened since)" / "Closed this ticket. Reason: " (server side, do not change)
- "<actor> filed this as <label>" (thread) / "filed it as <label>" (alert) / "T0NN filed as <label>" (toast)

## 6. Acceptance test (do all, on device or emulator)

1. Raise as CRM with Type Other, Platform None, one screenshot. Insert succeeds (if it fails with 22P02, Script 1 is missing). Row shows "No platform" and the "?" glyph.
2. As tech on the console: the row is in Type filter "Other (unfiled)". Open it: NEEDS FILING is showing. Write "Hardware", Set. Pill reads "Type Hardware" with a tag, NEEDS FILING gone, the row gets a sky "Hardware" chip, the Type filter now lists "Hardware", the thread has "<tech> filed this as Hardware". CRM device: row chip, detail meta and a toast update without reload.
3. Pick Bug from the grid: label clears, glyph is the bug, thread has "filed this as Bug".
4. Time: tap Time, tap 2h. Pill "Time 2h", row chip "⏱ 2h", `time_taken.minutes = 120` with by/by_name/at. Resolve a ticket with nothing logged: pill amber "Add time taken". Clear: column NULL. CRM sees no time anywhere.
5. Close as CRM on an open ticket: submit empty, red border, sheet stays. Type a reason, Close: status closed, thread ends with "Closed this ticket. Reason: ..." then "moved to Closed", CLOSED BY REPORTER record under the description on both sides, console row carries CLOSED BY REPORTER, staff badge counts the new reply. Reopen as tech: the record stays with "(reopened since)".
6. A tech account calling `tech_ticket_set_time_taken` works; a CRM account gets 42501. A CRM calling `tech_ticket_close_with_reason` on someone else's ticket gets 42501.
7. Web `/tech` and the native console show identical labels, chips and thread lines for the same ticket.

SQL checks:
```sql
select serial_no, type, type_label, platforms, time_taken, closure from tech_tickets order by serial_no desc limit 5;
select message->>'event', message->>'from', message->>'to', created_at from tech_ticket_messages where ticket_id = '<id>' and message->>'type' = 'system' order by created_at;
select assigned_to, sum((time_taken->>'minutes')::int) as minutes from tech_tickets where time_taken is not null group by 1;
```

## 7. Finish

- `npx tsc --noEmit` clean, Android bundle clean.
- Update `docs/features/android/tech/tech-desk.md`: sections 3, 4, 5, 6, 8 (remove the 2026-09-07 "NATIVE PORT PENDING" lines) and add a dated change-log line. Bump "Last verified" if you probed live.
- Commit the native change on its own.
