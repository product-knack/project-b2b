# iOS handoff: session voice notes renamed "Shared coach note" (26 Oct 2026)

For the iOS Expo repo. Copy and styling only: no server change, no new RPC, the `voice_notes` json and the pain
flag are unchanged. Android commit of 26 Oct 2026 in odds-app. Feature doc:
`b2b/docs/features/android/trainer/session-voice-notes.md` section 3. Copy rule: no dashes in user-facing text.

## Why
The owner: "retitle it so a trainer sees and understands very easily that we record anything like injury, pain
etc. to share with other coaches, bold and highlighted; retitle the field where trainers listen too". Name chosen:
"shared note from coach"; highlight: amber for the record card, red for pain.

## 1. Copy file (copy byte for byte): `src/lib/sharedCoachNote.ts`
Pure constants and helpers: `SHARED_NOTE`, `SHARED_NOTES`, `sharedNoteChip(count)`, `RECORD_KICKER`,
`RECORD_TITLE`, `recordLine(firstName)`, `PAIN_TITLE`, `PAIN_LINE`, `PAIN_TAG_ON` / `PAIN_TAG_OFF`,
`RECORD_FIRST` / `RECORD_MORE` / `RECORD_WAIT`, `recordHint('roster' | 'sessions')`, `PLAYER_KICKER`,
`PAIN_PLAYER_LINE`, `listenButton(count)`, `SHEET_TITLE`, `SHEET_ADD`, `SHEET_EMPTY`, `CHECKIN_TITLE`,
`checkinLine(possessiveFirstName)`, `CREW_CHIP`. Test: `tests/rules/shared_coach_note_test.js` (9 checks).

## 2. `src/components/SessionVoice.tsx`
- `import * as SN from '../lib/sharedCoachNote'`; `PAIN_TITLE = SN.PAIN_TITLE`, `PAIN_CHECKBOX = SN.PAIN_LINE`.
- `PainTag` texts: `SN.PAIN_TAG_ON` / `SN.PAIN_TAG_OFF`.
- `VoiceNotesComposer` gains `clientName?: string | null`. Its pain box becomes the amber record card
  (background `hexA(gold, 0.08)`, border 1.5 at 0.55; red once Yes, green once No): bold `SN.RECORD_TITLE`
  (15 / 20), `SN.recordLine(first name of clientName)` (12, ink3), a hairline, bold `PAIN_TITLE` + gold
  "Required" (13), `PAIN_CHECKBOX` (11.5), then the Yes / No pills as before. Record button labels
  `SN.RECORD_WAIT` / `SN.RECORD_MORE` / `SN.RECORD_FIRST`; the cap line says "shared coach notes".
- `SessionVoicePlaylistPlayer`: header `SN.PLAYER_KICKER · n · time`; when `hasPainNote(notes)` a bold line
  `SN.PAIN_PLAYER_LINE` in `#FF9B8F` above the player; the error line says "shared notes".
- `SessionVoiceSheet`: title `SN.SHEET_TITLE`, empty `SN.SHEET_EMPTY`, the add kicker `SN.SHEET_ADD` in gold,
  the composer gets `clientName={info?.clientName}` and the hint "Added to this session's shared notes; every
  coach of this client hears it with the others."
- `LatestVoiceChip`: `SN.CREW_CHIP` instead of NOTES (PAIN unchanged).
- `LatestVoiceInline` gains `clientName`; when `recent` the card is amber (bg 0.08, border 1.5 at 0.55, gold
  icon), title bold `SN.CHECKIN_TITLE` (15), line `SN.checkinLine("<first name>'s")`.

## 3. Screens
- Add Workout (`trainer.tsx`): the section label `SN.RECORD_KICKER` in gold, the line "Required: one note before
  you submit. Heard by every coach of this client." (while editing a queued log: "Heard by every coach of this
  client"), the composer gets `clientName={clientName}` and `hint={SN.recordHint('roster')}`; the check-in
  popup's `LatestVoiceInline` gets `clientName={clientName}`.
- Today's Roster logged chip: `SN.sharedNoteChip(row.voice_notes.length)`; the Sessions tab button
  `SN.listenButton(n)`; accessibility labels say "shared coach notes".
- Doctor Log Session sheet (`doctorSessions.tsx`): label `SN.RECORD_KICKER (OPTIONAL)` in gold, line "Heard by
  every coach and physio of this client", `hint={SN.recordHint('sessions')}`; the day-list chip
  `SN.sharedNoteChip(n)`.
- Therapist Add Session sheet (`therapist.tsx`): label `SN.RECORD_KICKER · OPTIONAL` in gold,
  `hint={SN.recordHint('sessions')}`; the Sessions list button `SN.listenButton(n)`.

## 4. Verify on a device
- Add Workout: the amber card reads "Record anything the next coach must know" in bold with the client's first
  name in the line; Yes turns it red, No green; the button says "Record shared note".
- A logged roster card: "Shared coach note" chip, "2 shared coach notes · Pain" once flagged notes exist.
- Client Sessions: "Listen · 2"; the player header "SHARED COACH NOTES · 2 · 1:40" and the red line when pain.
- The check-in popup before a session with recent notes: amber block "Shared notes from the coach".
- `node tests/rules/shared_coach_note_test.js`.
