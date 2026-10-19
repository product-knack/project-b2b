# Trainer app audit, 19 Oct 2026

Scope: the trainer side of the staff app (odds-app, the code in the 5.0 (37) test build), plus the live database it talks to. Nothing was changed while auditing.

How it was checked:
- **Live server, read-only, as the trainer test account:** 518 distinct database queries, 96 distinct server-function calls and 25 edge functions taken from the app's code.
- **Code review:** three reviewers read the trainer screens line by line: roster and workout logging; clients, plans, auction and the smaller pages; QHP, managers, messaging and the drawer.
- **Confirmation:** every item marked "confirmed" was re-read in the code by Claude. Nothing was reproduced on a phone.

Severity: **Broken** means a trainer cannot finish something, loses data or sees wrong data. **Bug** means it is wrong in some real cases. **UI** covers layout and usability. **Rule** marks a break of a standing project rule.

---

## Broken (fix first)

Phase 1 (19 Oct 2026): items 1, 2 and 6 fixed in the code (commit cc06f56), covered by `outbox_voice_pending_test.js` (14 checks) and tsc. Phase 2 (19 Oct 2026): items 3, 4 and 5 fixed (`plan_load_test.js`, 14 checks). Device test and a new build pending for both.

1. **Opening the app with no signal signs the trainer out and deletes their unsent workouts.** Confirmed. `src/auth.tsx:28` ignores the error from the role lookup, so a network failure reads as "not staff" and line 70 signs out. Sign-out runs the teardown, which empties the offline queue (`src/lib/offline.ts:64`). The same failure at sign-in shows "This app is for Odds staff". **Fixed 19 Oct 2026 in the code (phase 1; not in a signed build yet).**
2. **The Trends tab crashes the client page; the doctor's Progression tab crashes too.** Confirmed. This came from Claude's 16 Oct change. `src/screens/trainer.tsx:4499-4510` and `4805-4807`: the loading / error / content conditions were moved inside a fragment without braces, so they render as raw text and React Native stops the screen with "This screen hit a snag". It is in test APK 5.0 (37) only. **Fixed 19 Oct 2026 in the code (phase 1; not in a signed build yet).**
3. **Create Plan fails when the load is typed as text** ("BW", "20kg", "12,5"), although the box's hint says "kg / BW". Confirmed. `src/lib/clientQueries.ts:1853` sends text to `load_target`, which is a numeric column. Editing a plan instead turns the same text into empty silently (`clientQueries.ts:2516`). **Fixed 19 Oct 2026 in the code (phase 2; not in a signed build yet).**
4. **"Listen before you log" cuts the voice after about a second and never makes the trainer hear to the end.** Confirmed. `src/components/clientHealthSummaryCard.tsx:385` records the listen when Play is tapped. The refresh marks the item heard, so the sheet hides (`trainer.tsx:8084`) and stops the voice (`clientHealthSummaryCard.tsx:376`). **Fixed 19 Oct 2026 in the code (phase 2; not in a signed build yet).**
5. **Trial Workout opens the last client and roster slot instead of a fresh form.** Confirmed. `trainer.tsx:2371` only changes the page. The form reuses the old client and slot, so submitting can be refused as "Already logged", or overwrite a log still waiting in the queue (`trainer.tsx:7318`). **Fixed 19 Oct 2026 in the code (phase 2; not in a signed build yet).**
6. **One voice note can freeze the whole offline queue.** Confirmed. If its workout never reaches the server (refused as a duplicate and discarded), the note's error contains "timeout" (`src/lib/sessionVoiceQueries.ts:113`). The queue treats that as a network blip and stops there on every pass (`offline.ts:210-213`, `309-316`), so every later workout, message and location stays stuck. **Fixed 19 Oct 2026 in the code (phase 1; not in a signed build yet).**
7. **Leaderboards show made-up people.** Confirmed. The Trainer Leaderboard (home preview `trainer.tsx:1840-1842` and `1908`, full page `2849-2851`) and the Managers Dashboard (`trainer.tsx:12462`, with a "Live" pill) fall back to the demo data in `src/data.ts` (Karan Singh Rawat 86, Sagar Sharma 804...). This happens while loading, offline, on error, and for a month with no data.
8. **Pressing back during a QHP ride loses the ride.** Confirmed. `src/screens/qhpNavigation.tsx` sets no back handler, so Android back leaves without the Exit step. The ride is not saved and the office keeps seeing it as live.
9. **Drawer items QHP Overview, Trainers Tracker and Trainer Roster all open Managers Overview.** Confirmed (`src/data.ts:324-328`, all route 'managers'). All four rows light up together. QHP Overview opens on whatever tab was used last. A trainer who sees these items through their own permission but runs no team gets "This page is only available to managers".
10. **Profile certificates are fake.** Confirmed. Every trainer sees the same three "Verified" certificates (ACE, NSCA, ISSA), and Upload only adds a dummy row that disappears on reload (`trainer.tsx:12277-12283`).
11. **"Raise Ticket" on the client page does nothing.** Confirmed. It is a plain view with no tap handler (`trainer.tsx:5221-5224`).
12. **The chat reschedule suggestion can never appear.** Confirmed live. The table, the accept function and the edge function `analyze-chat-reschedule` were never set up on the server. `supabase/chat_reschedule_migration.sql` was never run, and the function returns 404. Messenger still polls the missing table every minute for each open chat (`src/lib/chatQueries.ts:604`).
13. **The forced-update switch is off.** Confirmed live. Table `app_version_requirements` does not exist (`supabase/app_version_migration.sql` was never run). `src/components/UpdateGate.tsx` fails open, so only the Play Store version check can force an update.

## Bugs

14. **Double logging on a slow network.** "Confirm & Save" shows no spinner while the duplicate check runs, with no lock (`trainer.tsx:7298-7307`). After "Sync failed", Submit stays live and a second tap queues a second copy (`7378-7398`). Create Plan offline can be queued twice the same way (`createPlan.tsx:368-377`).
15. **Editing a "Syncing…" item in Waiting to Sync reports success, but the server keeps the old log** (`trainer.tsx:2606-2620`, `offline.ts:174-181`).
16. **Editing a log queued offline asks for the health check-in again and drops the values entered offline** (`trainer.tsx:6597`, `7223-7234`, `7325-7327`).
17. **Saving health data can hang on "Saving…" forever.** There is no timeout, so the offline fallback never starts (`clientQueries.ts:169-208`).
18. **Medicine check-in errors fail the whole workout sync.** Any error other than "function missing" marks the log "Sync failed" (`offline.ts:231-235`, `clientQueries.ts:121-132`).
19. **The session timer starts when a trainer only opens Log Workout and backs out**, so a real log later that day records hours (`trainer.tsx:6622-6628`, `src/lib/sessionTiming.ts:101-124`).
20. **The voice note sheet with 2+ takes:** when a later take fails, every retry fails on the first take, which already saved and was deleted (`src/components/SessionVoice.tsx:240-249`).
21. **A voice note recorded as the last step is lost if the app is killed.** The draft save ignores voice takes (`trainer.tsx:7158-7170`).
22. **Dates on the UTC day instead of IST** (wrong between midnight and 5:30 AM IST):
    - `workout_exercises.session_date` on every log (`trainer.tsx:7355`, `clientQueries.ts:427`)
    - the QHP date (`qhpAssessmentForm.tsx:73`, `725`)
    - the competition end (`trainerQueries.ts:1116`, `1503`)
    - the payout session list (`payouts.tsx:84`)
    - Add Own Session day labels and the QHP breakdown use the phone's time zone (`trainer.tsx:633-638`, `2547`)
23. **Lists that silently stop at 1,000 rows:**
    - the Plan tab drops the newest plans of long-running clients and judges "most recent plan" wrongly (`clientQueries.ts:1598-1603`)
    - Workout Analyst history (`analystQueries.ts:92-97`)
    - My Clients 30-day counts, which raise false "Low activity" (`clientQueries.ts:1008-1014`)
    - payout totals (`payoutQueries.ts:83-87`)
    - Managers Roster tab totals (`trainerQueries.ts:1304`)
    - QHP Manager "No Report" / "Data Missing" / "Report PDFs" (`qhpReportQueries.ts:67-74`, `109-117`, `169`)
24. **Lists cut short with no "more" option:**
    - My QHPs shows 40 while its tab counts all (`trainer.tsx:9521`)
    - QHP Manager lists stop at 80, 60 and 120
    - "All Sessions (N)" stops at 60 (`clientQueries.ts:1485-1487`)
    - My Crew shows only the newest 200 messages (`managerChatQueries.ts:197`)
25. **Edit health data does not change sleep for WHOOP or Apple Health clients.** Trends shows the device value first (`clientQueries.ts:2260`, `trainer.tsx:4638`).
26. **The AI plan says "Draft added" after the trainer chose "Keep mine"** (`AiPlanAssistant.tsx:52-55`, `createPlan.tsx:262-271`).
27. **Weekly goals saved or deleted do not refresh Trends or the Zone 2 card** for up to a minute (`clientQueries.ts:1989`, `2000`).
28. **My Crew double taps.** Double-tapping a time chip or Approve reschedules twice and posts two messages (`managerChat.tsx:2733` and nearby). If the chat message fails after the roster changed, there is no alert (`2011`, `2078`, `2089`).
29. **Failures with no message:**
    - QHP Manager Hold, Approve or Reject reschedule, Review and Delete QHP (`trainer.tsx:10560`, `10816`, `10979`, `11475`)
    - "Start the team thread" (`clientThreads.tsx:85`)
    - deleting a workout template (`trainer.tsx:2704`)
30. **Errors shown as empty lists:**
    - QHP Manager Task Pending says "Nothing waiting" (`qhpManagerQueries.ts:111-113`, `192`)
    - QHP Manager spins forever
    - Messenger says "No active clients"
    - a client thread says "No messages yet"
    - Tech Desk says "ticket no longer available"
    - templates, plans and session exercises say "No … yet"
31. **QHP "Start Now" can spin on "Preparing assessment…" forever.** When the prior-QHP check fails, an existing client gets the new-client form (`trainer.tsx:9230-9233`, `qhpAssessmentForm.tsx:320`).
32. **Tapping a chat notification can stay on "Opening chat…" forever** (`messenger.tsx:1630-1652`).
33. **Workout Analyst levels ignore the back button.** Back leaves the whole page (`workoutAnalyst.tsx:215-238`).

## UI

34. **Workout form health chips truncate at 360 dp:** "7.5h sl…", "8/10 d…" (`trainer.tsx:7560-7575`).
35. **Quick Action labels "Acknowledge Sessions" and "Emergency Leave" are cut at 360 dp** (`trainer.tsx:2232-2275`).
36. **"Quick check-in first" shows an empty list when only water is missing** (`trainer.tsx:7744`, `7750-7755`).
37. **Exercise search results are hidden behind the keyboard bar on small phones** (`trainer.tsx:8337`, `8503`).
38. **Bottom sheets sit under the Android navigation bar:** Sessions this month, QHP breakdown, Waiting to Sync (`trainer.tsx:2037`, `2504`, `2564`).
39. **Pending / Needs revision plan cards squeeze the plan name to a sliver** (`trainer.tsx:4905-4931`).
40. **The Goals tab lists every past week, oldest first** (`clientQueries.ts:1938-1942`).
41. **Session Load bar labels overlap with 14+ sessions** (`trainer.tsx:3359-3381`).

## Rule breaks

42. **Network calls without `withTimeout`**, so spinners never end on a stalled connection:
    - roster queries, health reads, cancel and missed-remark writes
    - My Crew RPCs, the QHP form submit, the role lookup
    - Create Plan, goals, analyst and payouts (`clientQueries.ts` wraps 7 of 57 calls)
43. **Em dashes in user-facing text:** about 45 in the roster and workout slice, 122 matches in `trainer.tsx` overall. They are also in `withTimeout.ts` timeout messages, `qhpAlerts.tsx`, `managerChat.tsx`, `messenger.tsx`, `createPlan.tsx` and `payouts.tsx`.
44. **Touch targets below hitSlop 10:** sign-in eye, sheet close buttons, voice chip, QHP pin capture, Goals close X, calendar arrows, plan quick Edit, Trends day squares.
45. **Backdrop wraps the content instead of a sibling backdrop:** `KbCenter` (`trainer.tsx:253`) and its QHP dialogs, the New Template and Workout Templates sheets, the client-info popup, and the "Discard this plan?" dialog.
46. **Two sibling Modals switch in the same tick:** cancel picker to remark, Templates to Builder. The daily quiz and the Session Handoff popup can open over an already open sheet.
47. **Realtime refetches on every message instead of `invalidateDebounced`** (`messenger.tsx:380-381`, `clientThreadQueries.ts:211-213`).
48. **Permission gates show "only for managers" while the check is still loading or offline** instead of `AccessPending` (`trainer.tsx:9072`, `11948`, `12469`).

## Live checks that passed

- 516 of 518 distinct queries work. The 2 failures are items 12 and 13.
- 92 of 96 server-function calls resolve. The 3 admin "missing" ones are false alarms, and the real miss is item 12.
- All 25 edge functions the app names are deployed.

## Not covered

- Nothing was run on a phone. Layout widths are worked out from the styles.
- iOS sheet timing was not checked.
- Server function bodies were only read where a finding needed it.
- Parts of `managerChat.tsx` (plan cards and HOD feeds) and the QHP form step screens were skimmed.
