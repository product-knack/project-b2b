# PROMPT: port the Essentials Auction "bids by questions" change to the Android app (odds-app)

Build the same change the web app shipped on 10 Oct 2026 (hub-track commit 2e1067903), in this Expo / React Native app, end to end. The backend is already live on the shared Supabase project (migration `20261010120000_essentials_auction_bids.sql`, run on 10 Oct 2026); do not write SQL. Read these first: `docs/features/android/trainer/essentials-auction.md` (the current Android auction), `docs/essentials-auction-bids-handoff.md` (the handoff), and the web files for reference: `C:\Users\ADMIN\Desktop\oddsfitness-hub-track\src\lib\essentialsAuction.ts`, `src\hooks\useEssentialsAuction.ts`, `src\components\trainer\AuctionQuizDialog.tsx`, `src\components\trainer\AuctionResultsBanner.tsx`, `src\pages\trainer\EssentialsAuction.tsx`.

## What changes, in one paragraph
The auction is no longer first come, first served. Pressing a session now opens the client's five questions (3 from the week's training summary, 2 from the health context), one at a time, each answered once with no way back. On submit the server scores the answers (1 point per right answer) and stores the bid with the trainer id, points and timestamp. At 4:00 PM IST a database cron decides every session: highest points wins; equal points, the earlier bid; still equal, the client's usual trainer. The winner's `session_schedule` row, care-team note and My Crew entry are written by the server. Every trainer who bid sees a won / lost card for 4 hours. A trainer may bid on several sessions a day. Losers see the winner's name and points. The old instant grab is retired: `grab_essentials_session` now always raises "Sessions are now won by answering the client's questions in the auction. Update the app and press Answer and bid." The window stays 1:00 PM to 4:00 PM IST (`essentials_auction_config()`), the 30-minute head start for the usual trainer stays, the "never the same trainer two days in a row" rule stays, rehab sessions stay with physios.

## Backend contract (all live, all `authenticated`, role checks inside; call them exactly like this)

1. `get_essentials_auction(p_date date default null)` returns rows. Every old column is unchanged (`auction_date, client_id, client_name, modality, slot_time 'HH:MM', scheduled_for, status 'open'|'reserved'|'grabbed', trainer_id, trainer_name, grabbed_at, session_id, preferred_trainer_id, preferred_trainer_name, reserved_until`) and these are new:
   - `bids_count int` (bids so far on this session for tomorrow)
   - `question_count int` (0 when the client has no questionnaire on file; then every bid scores 0 and the earliest bid wins)
   - `my_points int | null`, `my_submitted_at timestamptz | null` (the caller's bid, null if none)
   - `winner_trainer_id uuid | null`, `winner_name text | null`, `winner_points int | null`
   - `round_result text | null`: `won` | `booked_elsewhere` | `no_bids` | `no_winner`
   - `evaluated_at timestamptz | null`
   `status` is still `grabbed` once a `session_schedule` row exists that day (after 4 PM that is the winner's), `reserved` during the usual trainer's head start, else `open`. Keep passing no date (the server takes tomorrow in India time).

2. `get_essentials_auction_quiz(p_client_id uuid, p_date date default null)` returns one jsonb:
   ```json
   {
     "client_id": "uuid", "training_date": "2026-10-11",
     "blocked": null,
     "questionnaire_version": 3, "question_count": 5,
     "questions": [ { "n": 1, "source": "weekly", "question": "...", "options": ["...", "...", "...", "..."] } ],
     "already_bid": false,
     "my_bid": null,
     "bids_count": 2
   }
   ```
   `blocked` is a plain sentence when the caller may not bid right now (window closed, reserved for the usual trainer until 1:30 PM, already booked, has the client today, wrong role); show it instead of the questions. `my_bid` when set is `{"points": 4, "submitted_at": "...", "correct": [true, true, false, true, true]}`. `source` is `weekly` or `context`. The answer indexes never come to the app.

3. `submit_essentials_bid(p_client_id uuid, p_answers int[], p_date date default null)` returns one jsonb: `{client_id, client_name, training_date, slot_time 'HH:MM', modality, points, question_count, correct: bool[], submitted_at, bids_count}`. `p_answers` is an array of 0-based option indexes, one per question in order; its length must equal `question_count` (send `[]` when `question_count` is 0). Pass `p_client_id` and `p_answers` only. Refusals are plain sentences to show as they are: the old grab's sentences (window, reserved, not Essentials, away, no session that weekday, rehab / training role, "You have Aarav today. Tomorrow's session goes to another trainer.", "This session is already booked.") plus "You have already answered for this session. One attempt only." and "This auction has been decided." and "Answer all 5 questions."

4. `get_my_auction_results(p_hours int default 4)` returns rows: `round_key text, client_id, client_name, training_date date, slot_time 'HH:MM', modality, won bool, result text, my_points int, question_count int, my_submitted_at, winner_trainer_id, winner_name, winner_points int | null, bids_count int, session_id, evaluated_at`. Only the caller's rounds decided within the last N hours; the server stops listing a round after the hours pass, so the app needs no expiry logic. Pass `p_hours: 4`.

5. `grab_essentials_session` must no longer be called anywhere in the app. Remove its use; if a code path still has it, the server answers with the sentence above.

## Rules to port into `src/lib/essentialsAuction.ts` (pure, node-tested like the current file)
- `rankBids(bids, preferredTrainerId)`: sort by `points` desc, then `submitted_at` asc, then the usual trainer first. (Mirror of the server; used for texts and tests only, the server decides.)
- `pointsText(points, total)`: `"4 of 5"`, `"0 of 5"`, and `"no questions"` when total is 0.
- `resultHeadline(r)`: won: `You won Aarav Mehra, Strength on Fri 2 Oct at 7:00 AM`; lost with `result = 'won'`: `Karan Mehta won Aarav Mehra's Strength on Fri 2 Oct at 7:00 AM`; `booked_elsewhere`: `Aarav Mehra's Strength on Fri 2 Oct at 7:00 AM was booked outside the auction`; `no_winner`: `No one could be booked for Aarav Mehra's Strength on Fri 2 Oct at 7:00 AM`.
- `resultDetail(r)`: won: `5 of 5 correct · 3 bids · the session is on your roster`; lost on points: `5 of 5 against your 4 of 5`; lost on time (equal points): `4 of 5 each · they answered earlier`; other results: `Your bid: 4 of 5 correct`.
- The button rule (`canGrab`, keep the name): grabbed by me: `Yours`; grabbed and `round_result = 'won'`: `Won by <winner_name>`; grabbed otherwise: `Booked by <trainer_name>`; `my_points != null`: `You answered · 4 of 5 · result at 4:00 PM`; window before / after: `Opens at 1:00 PM` / `Closed at 4:00 PM`; reserved for another trainer: `Reserved for Riya Sen until 1:30 PM`; else ok.
- Extend the `AuctionLot` type with the nine new fields and add the `AuctionQuiz`, `BidResult`, `AuctionResult` types exactly as the web file defines them.

## Queries to add in `src/lib/essentialsAuctionQueries.ts`
- Map the nine new lot fields in the lots query (numbers through `Number()`, null-safe).
- `useAuctionQuiz(clientId, date)`: `get_essentials_auction_quiz`, staleTime 0, enabled when a client is chosen.
- `useSubmitEssentialsBid()`: `submit_essentials_bid`; on settle invalidate the lots and the quiz. Haptic on success.
- `useMyAuctionResults(hours = 4)`: `get_my_auction_results`; staleTime 60 s, refetch every 5 minutes, on foreground (`AppState`) and on focus. A `PGRST202` / "could not find the function" error returns `[]` quietly.
- Wrap every call with the standing `withTimeout` rule; register per-user caches for teardown as the app's other hooks do.

## Screens (match the web, in this app's own visual language: indigo and gold, the ticket style, springs, Reduce Motion respected)

1. **Session card** (`src/screens/essentialsAuction.tsx`, `LotCard`): the button reads **Answer and bid** (gavel). Under the client line add a small row: `N bids · 5 questions` or `no questions yet, earliest bid wins`. After the trainer bid: an indigo YOU BID pill in place of OPEN and, in place of the button, `Your bid: 4 of 5 correct` with the bid time (IST) on the right. After the decision: the stamp reads WON (rose) or YOURS (gold) and the line reads `Won by Karan Mehta · 5 of 5 · you 4 of 5` (`Won by you` for the winner); a session booked outside the auction reads `Booked by <name>` with the stamp BOOKED. Hero counters become Open / Bids / Yours (Yours = sessions I bid on or won). The LIVE pill reads `LIVE · decided in 1h 55m`; the closed pill reads `Decided at 4:00 PM · reopens 1:00 PM`. Hero eyebrow and copy: replace the first-come wording everywhere; eyebrow `BEST ANSWERS WIN`, subtitle `Tomorrow's Essentials by Odds trainings. Answer the client's five questions to bid; the best score wins at 4:00 PM.` Intro lines by phase: open: `Each session is one training. Answer the client's five questions once; 1 point per right answer. Highest score takes the session at the close, equal scores go to the earlier bid, and the winner's roster and the care team are updated automatically.`; before: `Preview of tomorrow's sessions. Bidding opens at 1:00 PM IST.`; after: `Bidding closed at 4:00 PM IST and the sessions are decided. Sessions nobody won go to the care team to fill.`

2. **Quiz sheet** (new `src/components/auctionQuizSheet.tsx`, replaces `ConfirmSheet` for bidding; keep the ticket header style): header band with the gold gavel tile, eyebrow `ANSWER AND BID`, title `<Client> · <Modality> · Fri 2 Oct at 7:00 AM`. Body states:
   - loading: skeletons;
   - `blocked`: the sentence in a muted card, no questions;
   - `already_bid`: `You already answered for this session: 4 of 5 correct. The result comes at 4:00 PM.`;
   - `question_count = 0`: `No questions are on file for <Client> yet, so this session goes to the earliest bid. Place yours now.` + gold button **Place my bid** (submits `[]`);
   - a question: `Question 2 of 5 · this week's training` (or `· health context`), `one attempt each` with a lock icon, a thin gold progress bar (answered ÷ total), the question in bold, four option rows lettered A to D (tap selects; selected row gold with a filled letter tile), the black button **Lock answer and continue** (disabled until a pick; on the last question **Lock the last answer**), under it `A locked answer cannot be changed. Highest points wins; equal points, the earlier bid.` There is no back and no way to change a locked answer. Closing the sheet mid-way discards nothing on the server (nothing is sent until submit) but warn once: `Leave now and your answers so far are lost.`;
   - all answered: `All 5 answered. Submit to place your bid; it cannot be changed afterwards.` + gold **Submit my answers**; while sending `Placing your bid…`; a refusal shows the server's sentence in red under the button;
   - result: trophy, `4 of 5` large, `correct · your bid is in`, five round ticks (green check / rose cross per question), `N bids so far. The session is decided at 4:00 PM: highest points wins, equal points the earlier bid. You will see the result on your dashboard.`, **Done**. Haptic success. The lots re-read on close.
   Follow the standing sheet rules: `useKeyboardHeight` padding, sibling backdrop, `keyboardShouldPersistTaps`, hitSlop at least 10, never sibling modals, `Page` already adds the keyboard height.

3. **Won / lost cards** (new `src/components/auctionResultsCards.tsx`): on the trainer home (`Dashboard` in `src/screens/trainer.tsx`, above the Essentials auction home card), on the physio's Doctor Dashboard in the same place, and at the top of the auction screen. One card per result row: won: green edge, trophy tile, `You won the auction`, the headline, the detail, chips `Your score 5 of 5` and `Open the auction`; lost: rose edge, gavel tile, `Auction lost`, the headline (with the winner's name), the detail, chips `Your score 4 of 5`, `<Winner> 5 of 5`, `Open the auction`. A close (x) hides the card on this device: keep the dismissed `round_key` list in AsyncStorage (`essentials-auction-dismissed`), prune keys the server no longer returns. The server lists a round for 4 hours after the decision, so nothing else expires it. Entrance spring, off under Reduce Motion.

4. **Home card** (`src/components/essentialsAuctionCard.tsx`): keep it; change the line to `3 sessions open for tomorrow · 1 you bid on · decided in 1h 12m`, and the footer sentence to `Answer the client's five questions to bid. Best score wins at 4:00 PM.`

5. **My Crew** (`addsByDate` in `src/screens/managerChat.tsx`): the server's crew entry body now reads `<Trainer> won <Client> at 7:00 AM · Strength in the Essentials Auction (2 Oct)` and the payload `source` is still `essentials_auction`; the existing merge rule needs no change, only check the stream bubble copy still reads well (`WON IN THE ESSENTIALS AUCTION` is fine).

## Copy rules
"training" and "session", never "lot" in copy; "Essentials by Odds"; commas; no dashes of any kind in user-facing text; times as `7:00 AM`; dates as `Fri 2 Oct`.

## Test data and how to verify
- Window: 1:00 PM to 4:00 PM IST. Trainer test account: Sagar (`sagaroddsfitness@gmail.com`). Lots exist only for Essentials clients who saved tomorrow's slot in the client app (`clients.weekly_protocol.slots`); admins can set one with `essentials_client_set_week`.
- Questions exist for clients with `client_health_summary.auction_questionnaire` built (nightly 1 AM). To see which: `select client_id from client_health_summary where auction_questionnaire->>'fallback' = 'false';` in the SQL editor.
- To decide early without waiting for 4 PM an admin runs `select public.essentials_auction_evaluate();` in the SQL editor; then the won / lost cards appear within 5 minutes (or on foreground).
- Node-test the pure rules (rankBids, pointsText, headline / detail texts, the button rule) the way `src/lib/essentialsAuction.ts` is tested today. Build the dev bundle, walk through: open window, Answer and bid on one session, five questions, submit, result; the card shows You bid; a second press shows the already-answered sentence; after the evaluate call the card shows Won by / Yours and the dashboard shows the cards; dismiss hides one.

## Docs rule (mandatory)
Update `docs/features/android/trainer/essentials-auction.md` sections 1, 3, 4, 5, 6 and add a dated change-log line; keep the web file's "Sibling file" line valid. No em dashes anywhere in the docs.

## Addendum, 10 Oct 2026 evening: result pending and the winner times (migration `20261010140000`, live)

- `get_essentials_auction` and `get_my_auction_results` both gained `winner_submitted_at timestamptz | null` (when the winning bid was placed). Map it.

- After a bid the session card reads `Your score: 4 of 5 correct` with the bid time on the right and an indigo pill `Result pending · decided at 4:00 PM`; the quiz result sheet shows the same pill plus `Submitted at 1:12 PM`.

- A decided session adds a line `Decided at 4:00 PM · winning bid 1:12 PM` under `Won by ...`; the won / lost cards add `Decided at 4:00 PM · winning bid 1:12 PM · your bid 1:40 PM` (omit the winning-bid part when the result is not `won`). All times IST, `h:mm AM`.
