# Prompt: add the accuracy column to the native Quiz Leaderboard, 23 Sep 2026

Paste everything below this line into the session that built the Daily Quiz in `C:\Users\ADMIN\Desktop\b2b\odds-app` (or a fresh one there).

---

Add the **accuracy** column to the trainer Quiz Leaderboard in this Expo app (odds-app, Expo SDK 57, React Native 0.86, react-query 5, Supabase JS 2), matching the hub-track web change of 23 Sep 2026. The Daily Quiz itself is already built here (`src/components/dailyQuizModal.tsx`, `src/components/quizCards.tsx`, `src/lib/trainerQuiz.ts`, `src/lib/trainerQuizQueries.ts`, mounted in `Dashboard()` in `src/screens/trainer.tsx`): do not rebuild it, only apply this delta. The backend is live on the shared Supabase project `agtjszjedaenclbzgjvi` (hub-track migration `20260923120000_daily_quiz_accuracy.sql`, run in production on 23 Sep 2026): do not create or change tables, policies or RPCs. Read `docs/features/README.md` first. The web source of truth is `C:\Users\ADMIN\Desktop\oddsfitness-hub-track\src\components\trainer\QuizLeaderboardCard.tsx` (the `Row` and the `accuracyTone` helper) and `src\lib\trainerQuiz.ts` (`QuizLeaderboardRow`). Where this prompt and the code disagree, the code and the live database win.

## 1. The rule (already enforced by the database)

- Each day's row in `daily_quiz_score` stores `details.accuracy` = `round(100 * correct / (correct + wrong))` for that day, written by `quiz_submit_answer` every time a question is resolved. A day with 4 questions and 2 right stores 50. The key is absent until the first question of the day is resolved.
- `get_quiz_leaderboard(p_month)` now returns two more columns at the end of each row: `month_accuracy` (integer 0..100, `null` until the trainer finishes a question in that month) = the **mean of the trainer's daily scores over the month's played days**, and `month_days` = how many days were averaged. A 50 day followed by a 60 day gives 55. It is the mean of days, not the ratio of monthly totals, and this is a decision taken with the user: do not "correct" it to `month_correct / month_questions`.
- Ranking is unchanged: month points, then longest streak, then total correct.
- **The leaderboard counts from 25 Sep 2026** (hub-track migration `20260923150000_daily_quiz_leaderboard_start.sql`, live): `get_quiz_leaderboard` ignores rows dated before it in every column, `quiz_my_state()` counts `longest_streak` and the `total_*` fields from it, and the first row on or after it starts the streak at 0 (the 3-hour clock carries). Days before it were tests and stay in the table. The app mirrors the date as a constant `QUIZ_LEADERBOARD_START = '2026-09-25'` in `src/lib/trainerQuiz.ts` (same name as the web) and: (a) appends " (counted from 25 Sep)" to the card sub-line when the viewed month straddles the date (September 2026), (b) shows the empty state as "Nothing to show for this month / The leaderboard counts from 25 September 2026." when the whole viewed month is before the date (August 2026 under Last month). Use `date-fns` or plain Date maths; the check is: month start before the date and month end not before it = straddles; month end before the date = before launch.

## 2. Backend contract (live, consume as is)

- `get_quiz_leaderboard(p_month date)` → `{ rank, trainer_id, trainer_name, month_points, month_correct, month_wrong, month_attempts, month_questions, current_streak, longest_streak, total_correct, total_questions, month_accuracy, month_days }`.
- Nothing else changed: `quiz_my_state`, `quiz_next_question` and `quiz_submit_answer` keep their shapes. The reply's `state` object did not gain a field.
- The function was dropped and recreated, so its grants were reset and re-applied: signed-in users can call it, the anon key gets `42501 permission denied` (that is correct, not a fault).
- `quiz_day_accuracy(jsonb)` also exists (a pure calculator the leaderboard uses); the app never needs it.

Probe before building, signed in as the trainer test account: `POST /rest/v1/rpc/get_quiz_leaderboard` with `{}` must return 200 and every row must carry `month_accuracy` and `month_days` keys (a row with no played day has `month_accuracy: null`). If the keys are missing, the migration has not been run: stop and tell the user.

## 3. App changes

1. `src/lib/trainerQuiz.ts`, interface `QuizLeaderboardRow` (line 82): add `month_accuracy: number | null;` and `month_days: number;` after `total_questions`, with one-line doc comments (mean of the month's daily "right %" scores, null until a day is played; days averaged).
2. `src/components/quizCards.tsx`, `LeaderRow` (line 49): insert an **accuracy chip** between the flame chip and the points block. Layout: a small rounded box (`borderRadius` 10, `paddingHorizontal` 7, `paddingVertical` 3, `minWidth` 52, `alignItems: 'center'`) with the percentage on top (`Serif`, size 14, `String(r.month_accuracy) + '%'`, or `n/a` when null) and a tiny `Mono` label `ACCURACY` (size 8, letterSpacing 0.5) under it. Tone by value: 75 and above green (`hexA(C.green, 0.16)` background, green text), 50 to 74 amber (`hexA(C.gold, 0.16)`, gold text), below 50 rose (`hexA(C.red, 0.14)`, red text), null grey (`rgba(255,255,255,0.05)`, `C.muted2` text). Use the theme's actual token names from `src/theme.ts` (check what the green / red tokens are called there; `C.orange`, `C.gold`, `C.muted2`, `C.muted3` exist). On long-press of the chip show a small toast or `Alert` "Mean of N daily scores (right questions as % of the day's questions)" using `r.month_days`; skip this if the app has no toast helper, a tooltip is nice-to-have, not required.
3. Same file, `QuizLeaderboardCard` header (line 91): extend the sub-line to `… · 3, 2 or 1 points by the guess that got it right · accuracy = mean of daily right %` and let it wrap to three lines (`numberOfLines={3}`).
4. Give the points block a fixed `minWidth` (about 44) so the chips line up down the list.
5. No new queries, keys, routes or `SENSITIVE_ROUTES` entries. Nothing in `PERSIST_PREFIXES`.
6. No em dashes anywhere in copy.

## 4. Verification before you report done

- `npx tsc --noEmit` clean and a Metro Android export.
- The probe in section 2 passes as the trainer test account.
- Device test as the trainer test account: the leaderboard shows a chip on every row, `n/a` for trainers with no played day this month, the right tone by value, the sub-line wraps cleanly at phone width, the rows stay aligned with and without the flame chip. Compare the trainer's own chip with the web card for the same account and month: the numbers must match.
- Docs are mandatory: add a dated change-log line and update the leaderboard section in `docs/features/android/trainer/daily-quiz.md` (create it from `docs/features/_template.md` and add the index line in `docs/features/README.md` if the Daily Quiz build did not create it yet), and add an android note to the "Daily quiz" bullet's leaderboard sentence in `C:\Users\ADMIN\Desktop\b2b\docs\features\web\trainer\trainer-dashboard.md` (copy that file to hub-track `docs/features/web/trainer/trainer-dashboard.md` too).
- Do not push; stop when tsc and the export pass and the docs are written, and report what was live-verified versus only built.
