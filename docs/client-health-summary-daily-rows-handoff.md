# Client health summary: one row per training day (Android handoff, 2026-10-10)

`client_health_summary` is now one row per client per training day (`briefing_date`, IST), primary key `(client_id, briefing_date)`. Migration `20261010160000_client_health_summary_daily_rows.sql` on the shared project. **The Android Listen card must stop selecting the table directly** (its `maybeSingle()` by `client_id` returns several rows now and errors). Read through the RPC instead. Nothing on the server is for Android to run.

## Replace the table read
- Old: `from("client_health_summary").select(...).eq("client_id", id).maybeSingle()`.
- New: `rpc("get_client_health_summary", { p_client_id: id, p_date: null })` returns 0 or 1 row with `client_id, briefing_date, status ('building'|'ready'), built_at, weekly_summary, context_summary, listen_history, has_quiz, auction_result, context_dirty`. `weekly_summary` and `context_summary` have the same JSON as before (`script`, `version`, `generated_at`, `highlights`, `improved / worsened / watch`, `fallback`, ...). The row returned is the one in effect for the day asked (default today): the latest row with `briefing_date <= date`. Use `weekly_summary.generated_at` / `context_summary.generated_at` where the old `weekly_generated_at` / `context_generated_at` columns were used.
- Previous days: `rpc("get_client_health_summary_history", { p_client_id: id, p_limit: 14 })` returns rows `briefing_date, status, built_at, has_weekly, has_context, weekly_fallback, context_fallback, has_quiz, auction_result, auction_winner, listens`, newest first. To show an older day call `get_client_health_summary` with `p_date: '<that date>'`.
- The listen trail: `rpc("log_summary_listen", { p_client_id, p_which })` is unchanged; it appends to the row in effect today and returns the entry (now with `briefing_date` too).
- The voice: `functions.invoke("speak-client-summary", { body: { client_id, which, briefing_date } })`; `briefing_date` is optional (default: the row in effect today); the reply gained `briefing_date`. Everything else as in `client-health-summary-handoff.md`.
- "New since you listened" is unchanged: compare the summary's `generated_at` with the signed-in user's last entry of that kind in `listen_history`.

## Screen
Mirror the web card (`src/components/trainer/ClientHealthSummaryCard.tsx`): a chip next to the title reads `Today · Fri 10 Oct` (grey) or `Thu 9 Oct · earlier day` (amber) with a **Back to today** button; a **Previous days** button opens a list of the history rows, each row showing the date, small chips `week`, `context`, `quiz`, `won by <name>`, `N listens`, and `building` when not ready; tapping a day loads it into the card and stops any playback. The mandatory listen gate in Add Workout keeps reading today's row only.

## Auction
No change for the app: `get_essentials_auction`, `get_essentials_auction_quiz`, `submit_essentials_bid`, `get_my_auction_results` keep their signatures and shapes; they now read the row of the training day. See `essentials-auction-bids-handoff.md` and `essentials-auction-bids-prompt.md`.

## Timing (IST)
1:00 AM: tomorrow's row is built for every active client (weekly covering the 7 days ending yesterday, fresh context, the quiz for Essentials clients). Context rebuilds on new reports update the rows from today on. 4:00 PM: the auction decides tomorrow's rows. Rows older than 180 days are deleted on Sunday 3:00 AM.

## Docs rule
Update `docs/features/android/trainer/client-health-summary.md` sections 2, 4, 5 and the change log.
