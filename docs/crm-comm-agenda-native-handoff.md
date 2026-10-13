# Prompt: Next Call Agenda on the CRM Log Communication form, 25 Sep 2026

Paste everything below this line into a session in `C:\Users\ADMIN\Desktop\b2b\odds-app` (the one that built the CRM screens, or a fresh one there).

---

Add a mandatory **Next Call Agenda** field to the CRM Log Communication form in this Expo app (odds-app, Expo SDK 57, React Native 0.86, react-query 5, Supabase JS 2), matching the hub-track web change of 25 Sep 2026, and show the agenda on every communication log the app displays. The backend is already live on the shared Supabase project `agtjszjedaenclbzgjvi`: do not create or change tables, policies or RPCs. Read `docs/features/README.md` first. The web source of truth is `C:\Users\ADMIN\Desktop\oddsfitness-hub-track\src\components\crm\CRMCommunicationForm.tsx` (the form) and `src\components\crm\CRMCommunicationsList.tsx` (how a log shows the agenda). Where this prompt and the code disagree, the code and the live database win.

## 1. The rule (user decision, 25 Sep 2026)

- Every communication a CRM logs by hand must say **what the next call should cover**. The field is called **Next Call Agenda**, it is free text, and it is required: no save without it.
- "By hand" means the Log Communication form. The app's automatic communication rows (the pause journey entry in `src/lib/crmClientDetailQueries.ts` `pauseCommLog`, and the "Status changed to ..." entry in `src/lib/crmClientQueries.ts` around line 595) are **not** changed: they keep writing no agenda, exactly as the web's automatic writers do.
- The rule is enforced in the app only, like on the web. There is no database constraint, on purpose: older rows and automatic rows have a null agenda and must stay valid.
- The team lead dashboard on the web reads this field for every CRM (a "Next call agenda" box on each log, an agenda count per client), which is why it must always be filled from now on.

## 2. Backend contract (live, consume as is)

- Table `crm_communications` has the column `next_call_agenda text NULL` (hub-track migration `20260924055152`, live since 24 Sep 2026). No other column changed.
- Writes: the same plain insert the app already does in `useLogCommunication()` (`src/lib/crmClientQueries.ts`, line 471 onward), with one more key:
  `next_call_agenda: input.agenda.trim()` (a non-empty string; never send null from the form).
- Reads: add `next_call_agenda` to every select that feeds a communication list the CRM sees (`useClientComms` in `src/lib/crmClientQueries.ts`, and any other `from('crm_communications').select(...)` that lists logs for display; the `aiCache.ts` select is for the AI cache and does not need it).
- RLS is unchanged: a CRM inserts and reads rows for their assigned clients as before. Nothing to grant.

Probe before building, signed in as the CRM test account: `GET /rest/v1/crm_communications?select=id,next_call_agenda&limit=1` must return 200 with the key present (null on old rows is fine). If the column is missing, stop and tell the user.

## 3. App changes

### 3a. The form (`src/screens/crmClientDetail.tsx`, the Log Communication sheet opened from the "Log Communication" button, near line 889; mutation `useLogCommunication()` in `src/lib/crmClientQueries.ts`)

- Add a multi-line text input **under Remarks and above the follow-up date**, matching the web order: label "Next Call Agenda" with a red asterisk, placeholder "What to cover on the next call...", about 3 lines tall, `textAlignVertical: 'top'`, the same font, border and padding as the Remarks input.
- While it is empty show a small muted hint under it: "Required. Write what the next call should cover before saving."
- The Save button is disabled until **remarks, category and the agenda** are all non-empty after trimming (the web disables Save on the same three). Keep the existing rules for the other fields as they are.
- The mutation input gains `agenda: string`; the mutation throws `Error('Next call agenda is required')` when `agenda.trim()` is empty (the web has the same guard in its submit handler), and inserts `next_call_agenda: input.agenda.trim()`.
- Reset the field with the rest of the form after a successful save. Add it to the sheet's keyboard handling like the Remarks input (the sheet rules in `docs/features/README.md` still apply: `useKeyboardHeight` padding, `keyboardShouldPersistTaps`).
- Do not add it to the QHP Explained or any other quick action unless that action opens this same form; the web's QHP Explained button opens the same form, so if the app has an equivalent that reuses the sheet, the field comes with it.

### 3b. Showing the agenda on a log

- Wherever the app renders a communication log for a CRM (the client detail "Recent communications" list, the comms tab, the Mark as Done card), add under the remarks a boxed block, only when `next_call_agenda` is non-empty after trimming:
  - a muted uppercase caption "Next call agenda" (11 px, letter-spaced, `C.muted2` or the list's caption colour),
  - the text below it at body size, multi-line preserved,
  - the box: rounded 10, the card's muted background, a hairline border (the web uses `border-border/60 bg-muted/40 px-3 py-2`).
- Logs without an agenda (old rows, automatic rows) show nothing extra: no "none", no placeholder.

### 3c. Types and keys

- Add `next_call_agenda: string | null` to the app's communication row type(s) next to `next_follow_up_date`.
- No new query keys; invalidate the same keys the log mutation already invalidates.

## 4. Do not

- Do not make the database column NOT NULL, and do not add a CHECK: automatic rows and older rows are null by design.
- Do not send an empty string or null from the form; the guard runs before the insert.
- Do not touch the voice memo, the follow-up reminder or the category list.
- Do not add a separate "agenda" screen or list; it is one field on the form and one block on each log.

## 5. Verify (device or emulator, CRM test account)

1. Open a client, tap Log Communication: the new field sits under Remarks with the asterisk and the hint, and Save is disabled.
2. Fill category and remarks only: Save still disabled, hint still there.
3. Type an agenda: the hint disappears and Save enables. Save.
4. The new log shows the boxed "Next call agenda" block under its remarks; an older log without one shows no block.
5. In the SQL editor: `select next_call_agenda from crm_communications order by created_at desc limit 1;` returns the text you typed, trimmed.
6. Update `docs/features/android/crm/...` (the CRM client detail or communications feature file, whichever documents the form) with a dated change-log line and the new field, and mention it in `docs/features/README.md` if that index lists form fields.
