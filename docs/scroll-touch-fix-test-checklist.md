# Scroll & Touch Fix Pass — Manual Test Checklist (2 Sep 2026)

**Setup:** Expo Go → `exp://192.168.0.88:8081` (reload if already open). Items marked **[Android]** are keyboard fixes that only matter on Android (edge-to-edge): test them on the Android phone. Everything else: test on both if you can.
**How to read:** *Where* = how to reach it · *Do* = the exact action · *Pass* = what you must see. Tick each row.

---

## A. Global (any login)

| # | Where | Do | Pass |
|---|---|---|---|
| A1 | Any screen → hamburger menu (drawer) | Drag up/down on the nav list (log in as Admin — longest list) | List scrolls smoothly on the first drag; last items (Odds Academy etc.) reachable; tapping the dark area outside closes the drawer |
| A2 | Any primary orange button (e.g. Log Session, Save, Submit) | Press and hold | Button visibly dims while pressed, returns on release |
| A3 | Any tappable card (dashboard cards) | Press and hold | Card dims slightly while pressed |
| A4 | Any horizontal chip row that sits under a text input (e.g. Template Builder modality chips) | Tap into the input so the keyboard is up, then tap a chip **once** | Chip selects on the first tap (keyboard may stay open) |

## B. Trainer login

| # | Where | Do | Pass |
|---|---|---|---|
| B1 | Workout Log → scroll to the very bottom | Look at Session Remarks / any red "Sync failed" card | Fully visible above the Cancel / Submit bar, nothing hidden under it |
| B2 | **[Android]** Workout Log → tap a load/reps input | Keyboard opens, scroll to the bottom | Only a normal gap under the last card (no huge empty void) |
| B3 | Workout Log → exercise card | Touch the drag grip at the front of the row **without moving**, release | Nothing happens — no buzz, no lift |
| B4 | Workout Log → exercise card | Touch the grip and move ~5px+ | Buzz + row lifts; drag reorders as before; release snaps in place |
| B5 | Workout Log → set row | Tap the small ✕ that removes a set | Removes on first tap (target is taller now — no keyboard pop from the LOAD field beside it) |
| B6 | Workout Log → exercise header ✕ (remove exercise) | Tap it | Removes on first tap |
| B7 | Workout Log → couple session (two clients) → "TAP TO SWITCH" tab | Tap the text "TAP TO SWITCH" | Switches client; the partner is **not** removed. Then tap the small red ✕ next to it → partner removed |
| B8 | Create Plan → exercise row | Repeat B3/B4 with the grip | Same behaviour as Workout Log |
| B9 | Create Plan → remove-set ✕ | Tap | Removes on first tap |
| B10 | Create Plan → scroll to bottom | Check last card | Not hidden under the Cancel / Create Plan bar |
| B11 | **[Android]** Create Plan → Add Exercises → tap the search box, type, tick 2–3 exercises | Look for the "Add N Exercises" button | Button is visible **above the keyboard**; tapping it adds them (previously hidden under the keyboard) |
| B12 | Create Plan → Add Exercises list | Drag the list | Scrolls smoothly on the first drag (no "sticky" first few pixels) |
| B13 | Sessions → Reschedule sheet (or Request Roster sheet) | Type in the reason box (keyboard up), then tap a **date chip** once | Date selects on the first tap |
| B14 | QHP Manager → Schedule QHP sheet | Type in the client search, then tap a client row once | Client selects on the first tap (was: first tap only closed the keyboard). Same for the assessor dropdown |
| B15 | QHP Manager → calendar month arrows (‹ ›) | Tap near the edge of the arrow | Month changes reliably (bigger hit area) |
| B16 | QHP Manager → a QHP row | Tap the **right end** of the row near the status badge | Row opens the detail (no "Delete QHP?" alert). Then tap the ✕ itself → Delete alert appears |
| B17 | Dashboard → QHP in-progress sheet ✕ | Tap slightly off the ✕ | Closes (bigger hit area) |
| B18 | Client → medical/uploaded report → preview | Open a PDF/image preview on a small phone | Header with ↗ and ✕ stays visible (preview shrinks to fit) |
| B19 | Distance sheet (from roster row) | Open it | Fits the screen; title and ✕ visible |
| B20 | Request Roster sheet → client list | Open the list | Shows ~7 rows at once (was ~4) |
| B21 | Blank-exercise confirm dialog before submit | Open with 8+ exercises | Taller list, more rows visible |
| B22 | Workout Log → Add Exercise → tap the same exercise **twice** | — | 1st tap: green "Added" chip. 2nd tap: phone buzzes (warning), the row shakes red with "Not added · already in workout", and the exercise is **not** duplicated (the workout still has it once) |
| B23 | Workout Templates → Template Builder → add the same exercise twice to one section | — | 2nd tap: buzz + red shake + "NOT ADDED · ALREADY IN"; section keeps a single copy |
| B24 | Workout Log for a **non-couple** client | Look at the client tab row | **No "Add Client" button** at all; no partner prompt |
| B25 | Workout Log for a couple client whose partner is **also assigned to you** (e.g. Annie Kanwar / Raja Kanwar, Sapna / Yogesh Aggarwal) | Open the log | Prompt "X trains with Y — Just X / Yes, log both". Choose **Just X** → "Add Client" button is visible; tap it → sheet shows **only the partner** (no search, no other clients); tap the partner → pair starts |
| B26 | Same couple client, but log in as a trainer who is assigned to only ONE of the pair | Open the log | No prompt and no "Add Client" button (partner not in your book) |
| B27 | Couple pair started → save client A → form switches to B | Tap the red **SKIP** pill on B's tab | Leaves the form; A's session is saved; B is not logged; reopening A later shows no leftover pair |

## C. Manager / HOD login — My Crew

| # | Where | Do | Pass |
|---|---|---|---|
| C1 | Team day plan card → member row → RESCHEDULE | Type the reason (required), keyboard still up, tap a **time** chip **once** | Reschedules to exactly that time on the first tap (was: first tap swallowed, second tap could hit a neighbour) |
| C2 | Client protocol chip (blue) on a plan row → tap | Open a client with a long protocol (6+ entries) | Popup fits the screen; entries scroll; ✕ visible |
| C3 | Add Session (manager "+ADD") | Open the client list | Client list shows ~7 rows; time grid shows ~6 rows (both taller) |
| C4 | Plan row chips: protocol chip, "+ ADD", reschedule pill, "ADD REMARK" (HOD) | Tap slightly off-centre | All respond (bigger hit areas) |
| C5 | HOD → doctor section → Add Session for a therapist | — | Unchanged behaviour (regression check): modality shows Therapy only |

## D. Doctor / HOD login

| # | Where | Do | Pass |
|---|---|---|---|
| D1 | Dashboard → Run Rate card → sheet | Drag the list | Scrolls on first drag; tap the dark backdrop → closes |
| D2 | Dashboard → Acknowledgements card → sheet | Same | Same |
| D3 | Dashboard → Today count → breakdown popup | Same | Same |
| D4 | Roster → client filter picker; time wheel picker; per-day doctor/modality dropdown | Drag / flick the wheels | Short flicks move the hour/minute wheels; lists scroll immediately |
| D5 | Client detail → Create Protocol → phase → **Add Exercise** | Tap it | Rehab exercise picker opens and is fully tappable (was blank/dead on Android) — pick exercises → they appear in the phase |
| D6 | **[Android]** Sessions → Log Session → Rehab → without plan → Add exercise picker | Type in the search | Result rows and the "+ Custom exercise" line stay above the keyboard |
| D7 | Sessions → session card → "Session Exercises" | Tap the text | Expands on first tap (bigger target); sheet ✕ buttons easier to hit |
| D8 | Client detail → "View Exercises" / "View Details" expanders | Tap | Expand on first tap |
| D9 | Client detail → Remarks → **Edit** / **Delete** text links, page arrows ‹ › | Tap | Respond reliably (padded targets) |
| D10 | Client detail → Rehab recommendation (physio HOD) sheet **[Android]** | Tap "Add a note…" at the bottom, and the thread composer | Input and its send button lift above the keyboard |
| D11 | Rehab recommendation sheet → PDF area | Drag over the PDF | Sheet scrolls when the PDF is at its edge (no permanent dead zone) |
| D12 | Log Session → client list | Open | ~7 rows visible |

## E. Therapist login

| # | Where | Do | Pass |
|---|---|---|---|
| E1 | **[Android]** Therapy Desk → Log Session → tap the note box | Keyboard opens | Note box and **Save Session** visible above the keyboard |
| E2 | Log Session → client dropdown | Open | Taller list (~7 rows) |
| E3 | Log Session (iOS) | Same as E1 | Unchanged (still lifts) — regression check |

## F. CRM login

| # | Where | Do | Pass |
|---|---|---|---|
| F1 | **[Android]** Approvals → Approve → Schedule Session sheet → tap NOTES | Keyboard opens | Notes field and the green **Schedule Session** button visible above the keyboard |
| F2 | **[Android]** Odds AI (chat) → tap the input | Keyboard opens | Input bar + send button sit above the keyboard (was covered) |
| F3 | Roster → trainer/client filter pill → small ✕ | Tap the ✕ | Clears the filter (does **not** open the picker). Tap elsewhere on the pill → picker opens |
| F4 | Roster → calendar/agenda toggle icon | Tap | Toggles reliably |
| F5 | Sales → CTA card → ops-notes toggle pill | Tap | Opens on first tap |
| F6 | Client detail → any form sheet ✕ (bare icon) | Tap slightly off | Closes |
| F7 | Client Threads → message bubble | **Long-press** a bubble | Reply quote appears (swipe-to-reply still works too) |
| F8 | Client Threads list → "Back" row at top | Tap the text | Goes back reliably |

## G. QHP (assessor / researcher)

| # | Where | Do | Pass |
|---|---|---|---|
| G1 | **[Android]** QHP assessment form → step with many inputs (Assessment Tests) → tap a field in the **lower half** | Keyboard opens | Field scrolls into view above the keyboard; **Previous / Next** footer stays visible |
| G2 | **[Android]** Form → Recommendations step → multiline boxes | Type in the last box | Same — box + footer visible |
| G3 | Lifestyle step → Current Activities → remove ✕ | Tap the small red ✕ | Removes on first tap |
| G4 | QHP Review → report sheet → drag over the PDF | Drag | Sheet scrolls at the PDF edge; "Sign as Senior Researcher" reachable |
| G5 | **[Android]** Held report → Resubmit dialog → tap the note | Keyboard opens | Dialog re-centres above the keyboard; **Resubmit** button visible |
| G6 | QHP detail / resubmit dialog ✕ | Tap slightly off | Closes |
| G7 | B2C reports → blood report row → "PDF" chip | Tap the chip | Opens the PDF (does **not** just expand/collapse the row) |
| G8 | Report detail → postural photo viewer (Android) | Open | No "PINCH TO ZOOM" pill (iOS still shows it and zooms) |

## H. Admin login (all **[Android]** rows: keyboard up must leave the button visible)

| # | Where | Do | Pass |
|---|---|---|---|
| H1 | Requests → any → **Reject** → type reason | Keyboard up | Reason box + **Confirm Rejection** visible; body scrolls if needed |
| H2 | Requests → New Leads → convert → client form → tap Phone / Goal | Keyboard up | Fields + **Create client** visible; form scrolls |
| H3 | Requests → Renewal pay → **Mark payment received** → tap UTR | Keyboard up | UTR + Cancel / Mark Paid visible |
| H4 | Requests → Invoice raised sheet input | Keyboard up | Same |
| H5 | Churn → approve/reject/reactivate → notes | Keyboard up | Notes + confirm button visible |
| H6 | Users → Edit user → tap **password** | Keyboard up | Password + **Save changes** visible |
| H7 | Tools → Trainer Fees → add/edit → amount, trainer/client picker search | Keyboard up | Typing field visible |
| H8 | Tools → Manage Teams → Edit team → name / member search | Keyboard up | Same |
| H9 | Certifications → add/edit → course name, scores | Keyboard up | Same |
| H10 | Incidents → trainer with few incidents → type an incident | Keyboard up | Composer + send visible |
| H11 | Client detail → Add session / Assign / Additional package / Pause → last multiline field | Keyboard up | Field + save button visible |
| H12 | Client detail → session row icons (complimentary / edit / delete), staff remove, generation toggle | Tap slightly off the icon | Respond (hit area doubled); no wrong-icon mis-fires at normal thumb size |
| H13 | Tools / Users / Certifications → picker dropdowns | Open | Lists show ~7 rows (was 4–5) |
| H14 | Users → person picker with a selection → ✕ | Tap ✕ | Clears selection (dropdown does **not** open) |

## I. Ops / Marketing / Academy / Coach

| # | Where | Do | Pass |
|---|---|---|---|
| I1 | **[Android]** Ops → Targets → note sheet → type a note → tap **Add note** once | — | Adds on the first tap, button visible above keyboard |
| I2 | **[Android]** Marketing → influencer → Target / Add content / Instagram URL / ticket **Reply** sheets | Type | Input + Save/Send visible; long content scrolls |
| I3 | Marketing → influencer tab strip (Content / Performance / …) | Swipe the tabs **left→right** | Tabs scroll; screen does **not** navigate back |
| I4 | Marketing → history table | Pan the table right, then back left | Same — no back navigation |
| I5 | Marketing → "By Stage" → CLEAR link | Tap | Clears reliably |
| I6 | Academy → Calendar → class → teacher sheet | Many teachers | Chips scroll; **Update batch teachers** always visible. Tap the crown on a selected teacher → becomes primary and stays selected |
| I7 | Coach → trainer picker; Coach client sections → month picker; Plans analyst picker | Drag lists | Scroll on first drag; backdrop tap closes |

## J. Emergency Leave / Acknowledge sheets (trainer)

| # | Where | Do | Pass |
|---|---|---|---|
| J1 | **[Android]** Emergency Leave → tap REASON, type | Keyboard up | Sheet scrolls; **Submit Leave Request** reachable |
| J2 | Acknowledge sessions sheet | Open | Unchanged (regression check): list scrolls, buttons work |

---

**If anything fails:** note the row number + phone (Android/iPhone) and tell me — every change is isolated per screen, so a single row can be reverted or adjusted without touching the rest.
