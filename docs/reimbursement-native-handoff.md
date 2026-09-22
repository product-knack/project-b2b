# Prompt: port Reimbursements to the native app (doctor + doctors' manager), 21 Sep 2026

Paste everything below this line into a fresh session opened in `C:\Users\ADMIN\Desktop\b2b\odds-app`.

---

Build the Reimbursement feature in this Expo app (odds-app, Expo SDK 57, React Native, react-query, Supabase) so it matches the hub-track web version end to end: a doctor raises a reimbursement request with payment screenshots and follows its status; the doctors' manager (physio HOD) reviews every request with Approve / Reject. The backend already exists on the shared Supabase project `agtjszjedaenclbzgjvi` and must be consumed as is: do not create tables, columns, policies or RPCs, and do not change the JSON shapes. Read `docs/features/README.md` first, then the web feature file `C:\Users\ADMIN\Desktop\b2b\docs\features\web\doctor\reimbursement.md` and the handoff `C:\Users\ADMIN\Desktop\b2b\docs\handoffs\reimbursement-end-to-end.md`; those two are the source of truth for the backend contract. Where this prompt and those files disagree, the live database wins: probe it before writing screens.

## 1. Backend contract (live, read-only for you)

Table `public.reimbursements`:
- `id uuid`, `requester_id uuid` (FK profiles; RLS forces it to equal `auth.uid()` on insert), `expense_details jsonb not null`, `screenshots jsonb not null`, `status text` (`pending` default, `rejected`; the value `approved` exists in the CHECK but is not used by the current rule), `approved_by jsonb null`, `paid_by jsonb null`, `created_at`, `updated_at`.
- `expense_details` = `{ "type": "cab", "expense_date": "YYYY-MM-DD", "amount": number | null, "note": string | null }`. `type` must be `cab` (only type today). `expense_date` must parse as a date. `amount` optional, >= 0. There are NO from / to locations (they were removed; do not send them, the CHECK rejects nothing extra but the web does not write them).
- `screenshots` = array of 1 to 10 `{ "path": "<requester_id>/<uuid>-<name>", "name": string, "size": number | null, "type": string | null }`. A CHECK (helper `reimbursement_screenshots_ok`) enforces array, 1 to 10 entries, each an object with a non-blank `path`.
- `approved_by` = `{ "id": uuid, "name": string, "role": string, "at": iso, "decision": "approved" | "rejected", "note": string | null }`, written only by the RPC.
- `paid_by` = `{ "id", "name", "at", "amount", "payout_batch_id", "source", "note" }`, written later by the payout system (Plutus). Read-only for you; show it if present.
- Guard trigger: an insert must be `pending` with `approved_by` null; any update that changes `status` or `approved_by` outside the RPC is rejected.

Owner rule for decisions (this is the part people get wrong):
- Approve = the RPC stamps `approved_by` with `decision: "approved"` and DOES NOT change `status` (stays `pending`).
- Reject = the RPC stamps `approved_by` with `decision: "rejected"` AND sets `status = 'rejected'`.
- A request is decided once: the RPC refuses when `approved_by` is already set or status is `rejected`.
- Therefore the human state is derived: `rejected` if status is rejected or the stamp says rejected; `approved` if the stamp says approved; else `pending`. Port the web helper exactly: see `effectiveStatus()` in hub-track `src/lib/reimbursements.ts`. Never filter "approved" by the status column.

RPC `review_reimbursement(p_id uuid, p_decision text, p_note text default null) returns jsonb` (the stamp). Caller must pass `is_reimbursement_reviewer(auth.uid())`: role `admin` / `super_admin`, or the head-doctor id `30df5c2b-0f40-4736-9f41-7cbc830a191a`, or `'physio_hod' = ANY(profiles.role_specialization)`. Errors to surface verbatim: "Only an admin or the doctors manager can review reimbursements", "Decision must be approved or rejected", "Reimbursement not found", "This reimbursement is already approved" / "... already rejected".

RLS: requester can insert own and select own; `is_reimbursement_reviewer` can select every row; admin / super_admin can do everything (but the guard still blocks status edits). No update or delete for the requester: a raised request cannot be edited or withdrawn.

Storage: private bucket `reimbursements`, 10 MB per file, `image/*` and `application/pdf`. Object path MUST be `<requester_id>/<uuid>-<sanitised name>` (the upload policy checks that the first folder equals `auth.uid()`). Read = signed URL (`createSignedUrl(path, 300)`), allowed for the owner folder and for reviewers. Delete own folder is allowed (used only for rollback after a failed insert).

PostgREST join for the reviewer list: `select=*, requester:profiles!reimbursements_requester_id_fkey(first_name,last_name)`.

Migrations that define all this (hub-track `supabase/migrations/`): `20260921090000_reimbursements.sql`, `20260921100000_reimbursements_paid_by.sql`, `20260921110000_reimbursements_screenshots.sql`, `20260921120000_reimbursements_drop_locations.sql`, `20260921130000_reimbursements_review_by_hod.sql`. Before building, confirm the live state with the publishable key: `GET /rest/v1/reimbursements?select=expense_details,screenshots,status,approved_by,paid_by&limit=1` must be 200; `POST /rest/v1/rpc/is_reimbursement_reviewer {"p_uid":"30df5c2b-0f40-4736-9f41-7cbc830a191a"}` must return true (404 means the review migration has not been run yet: stop and tell the user to run it). If `expense_details` rows still show `from_location`, the drop-locations migration has not been run: tell the user, but still build without those fields.

## 2. Native screens to build

Doctor side (every doctor, physio and consultant alike):
- A "Reimbursement" entry on the doctor dashboard (`doctor-dashboard` in `src/Router.tsx`) next to the existing emergency-leave action, opening a full-screen route `doctor-reimbursements` (add it to the route map, to `doctorNav` in `src/data.ts`, and to `SENSITIVE_ROUTES` in `src/Router.tsx` since it shows payment screenshots).
- Two tabs, exactly like the web popup: **New request** and **My requests**.
- New request form: Type (select, only Cab), Date (default today, not in the future), Amount paid (optional, ₹, non-negative), Note (optional, multiline), Screenshots (1 to 10; expo-image-picker with `allowsMultipleSelection`, plus expo-document-picker for PDFs; validate `image/*` or `application/pdf` and <= 10 MB per file; thumbnail grid with per-file remove; "n of 10" counter; skip duplicates). Submit is enabled only with a date and at least one file. On submit: upload each file to `reimbursements` at `<uid>/<uuidv4()>-<safeName>` one after another (reuse the `fetch(uri).arrayBuffer()` + `uploadWithTimeout` pattern from `src/lib/techDeskQueries.ts` `uploadTechFile`), then insert `{ requester_id: uid, expense_details: { type, expense_date, amount, note }, screenshots: [{path,name,size,type}] }` with `.select('*').single()`. If any upload or the insert fails, remove every object uploaded so far, then show the error. On success: toast "Reimbursement request sent. It is pending review.", reset, switch to My requests, invalidate `['my-reimbursements', uid]`.
- My requests: filter chips All / Pending / Approved / Rejected with counts (by the derived state), rows newest first showing type, expense date, amount, note, status chip, "Raised <IST stamp>", the decision stamp ("Approved 21 Sep 2026, 4:10 PM by <name> · <note>" or "Rejected ..."), the paid stamp when `paid_by` is set, and one "Screenshot N" chip per file that resolves a signed URL on tap and opens it (image viewer or the system browser for PDFs; resolve at tap time, never store signed URLs). Empty state links back to the form. Query: own rows only (`requester_id = uid`, order created_at desc, limit 100), key `['my-reimbursements', uid]`.

Doctors' manager side (physio HOD only; gate with the existing `caps.data.isPhysioHod` used for `doctor-rehab-recommendation` in `src/components/chrome.tsx`, which mirrors the head-doctor id / `physio_hod` tag; admin app users may also open it if the app exposes doctor routes to them, otherwise HOD only):
- Route `doctor-reimbursement-review`, nav item "Reimbursements" in the HOD group next to Rehab Recommendation, added to `SENSITIVE_ROUTES`.
- Tabs Pending / Approved / Rejected / All with counts (derived state), a search box (doctor name, note, amount), one card per request: requester name (from the profiles join), type, expense date, amount (or "no amount given"), note, screenshot chips (signed URL on tap), raised / decided / paid stamps. Pending cards show **Reject** (destructive) and **Approve**. Each opens a confirm sheet with the request summary and an optional note (label the note "tell the doctor why" on reject), then calls `supabase.rpc('review_reimbursement', { p_id, p_decision, p_note })`. On success toast "Approved the request from <name>" / "Rejected ...", invalidate `['reimbursements-review']` and `['my-reimbursements']`. Query: all rows with the profiles join, order created_at desc, limit 500, key `['reimbursements-review']`.
- Copy the approve confirm text from the web: approving "saves your name and the time on the request; it stays open until it is paid out"; rejecting "closes the request as rejected and the doctor sees your note".

## 3. Native rules that apply (from memory and existing code; do not skip)
- Wrap every Supabase call in `withTimeout` (`src/lib/withTimeout.ts`); realtime is not needed here (no subscription); use `invalidateDebounced` only if you add one.
- Sheets: `useKeyboardHeight` padding, sibling backdrop, `keyboardShouldPersistTaps`, hitSlop >= 10 on small taps, never nest modals; `Page` already adds keyboard height.
- Query keys for these screens are per-user and cheap: do NOT add them to `PERSIST_PREFIXES`; register per-user teardown if you cache anything outside react-query.
- Photo permissions: use expo-image-picker (Android photo picker), never request `READ_MEDIA_IMAGES` (Play rejected build 4.7 (28) for it; see the `play-photo-permission-policy` memory).
- No em dashes in any user-facing copy.
- Timestamps in IST (`Asia/Kolkata`) like the rest of the app; `expense_date` is date-only, format it without a timezone shift.
- The web lib `hub-track/src/lib/reimbursements.ts` is the reference for types, `effectiveStatus`, the sanitised file name (`[^A-Za-z0-9._-]` -> `_`, last 80 chars), and the error mapping (`42P01` table missing, "Bucket not found", RLS `42501`, "payload too large"). Port it as `src/lib/reimbursements.ts` + `src/lib/reimbursementQueries.ts`.

## 4. Verification before you report done
- `npx tsc --noEmit` clean and a Metro Android export.
- Live probes (publishable key) as in section 1, and a real submit as the doctor test login from memory (`Anjanarawat@oddsfitness.com`, uid = the head-doctor id, so the same login can also open the review screen and decide its own request; note that in the doc). After a decision, confirm in SQL: `select id, status, approved_by from reimbursements where id = '<id>'` shows status still `pending` for an approve and `rejected` for a reject.
- Docs are mandatory: create `docs/features/android/doctor/reimbursement.md` from `docs/features/_template.md` (all 10 sections), add the index line in `docs/features/README.md` under the Doctor section next to the web line, and note the sibling in the web file's status line (`C:\Users\ADMIN\Desktop\b2b\docs\features\web\doctor\reimbursement.md`, copy also to hub-track `docs/features/web/doctor/reimbursement.md`). Add a dated change-log line in both.
- Do not push; stop when tsc and the export pass and the doc is written, and report what was live-verified versus only built.
