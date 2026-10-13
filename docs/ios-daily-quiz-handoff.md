# iOS handoff 1 of N: Trainer Daily Quiz, end to end (23 Sep 2026)

Paste this whole doc to the iOS app's coding assistant. It builds the trainer Daily Quiz exactly as it
shipped on Android (odds-app) and on the web (hub-track) on 23 Sep 2026: a mandatory quiz popup on the
trainer dashboard, a My Quiz Score card, and a QUIZ column (points + accuracy) inside the
existing Trainer Leaderboard. There is NO separate quiz leaderboard (the user removed it on 23 Sep 2026).
Scores count from 25 Sep 2026.

**Update 24 Sep 2026: do NOT build the Quiz Streak tile** (section 4.2). The user removed it from the Android
dashboard ("no need to show quiz streak"); if iOS already has it, delete it. The streak still shows in the popup
header and in the My Quiz Score card's STREAK cell.

---

## 0. Ground rules

1. **The backend is LIVE and SHARED** (Supabase project `agtjszjedaenclbzgjvi`). Do NOT create, alter or
   run any SQL: no tables, columns, policies, RPCs or edge functions. The app only calls four RPCs.
2. **Grading happens in the database.** The app never sees the answer key and never writes a score row.
3. **Reference implementation** (source of truth when in doubt), in the Android React Native repo
   `odds-app`: `src/lib/trainerQuiz.ts` (types + pure helpers), `src/lib/trainerQuizQueries.ts`
   (react-query hooks), `src/components/dailyQuizModal.tsx` (the popup), `src/components/quizCards.tsx`
   (tile, score card, leaderboard), the mount in `Dashboard()` in `src/screens/trainer.tsx`, and the
   `NEVER_PERSIST` set in `App.tsx`. The web twin is hub-track `src/components/trainer/DailyQuizPopup.tsx`.
4. Use the signed-in user's id (`session.user.id`). Never substitute a dev / test trainer id: RLS and the
   RPCs key everything on `auth.uid()`.
5. No em dashes in any user-facing copy. Tap targets get hitSlop 10 or more.
6. Wrap every RPC in the app's `withTimeout` (6 s for the state, 8 s for the others).

---

## 1. What the trainer experiences (replicate exactly)

1. The trainer opens the dashboard. The app calls `quiz_my_state()`. The popup is **due** when the state
   is missing, or a question is in progress (`current_question_id` set), or `next_quiz_eligible_at` is
   null or in the past. This check re-runs **every minute** while the dashboard stays open, so the next
   question appears 3 hours after the previous one without a reload.
2. The popup opens over the dashboard. **It cannot be dismissed**: no close button, no backdrop tap, the
   hardware / gesture back does nothing. "Continue to Dashboard" is the only way out, and it is always
   offered when the backend cannot serve a question, so a trainer is never trapped.
3. Question screen: orange gradient header "Daily Quiz" / "Test your knowledge", an "Attempt N of 3" pill,
   a 🔥 badge with the current streak, and (when the streak is above 0) a bar "Current Streak ... Best: N".
   Then the question and four option rows A to D. **Submit Answer** enables once an option is picked; after
   a miss it reads "Submit Answer (2 left)"; while the RPC runs it shows a spinner and "Checking".
4. Wrong guess with attempts left: an amber banner "Not quite. 2 attempts left." with the sub-line
   "The answer stays hidden. Pick another option."; the tried option turns red with a cross and is
   disabled; the selection clears; the pill counts up. Nothing reveals the answer.
5. Sending an option already tried: banner "You already tried that option." (the server does not count it).
6. Question over (a correct guess, or the third miss):
   - Correct: green banner "Correct, first try!" or "Correct on attempt N", a chip "+3 points" / "+2 points" /
     "+1 point", a chip "🔥 N streak" when the new streak is above 1, the picked option green with a check.
     The header streak badge pulses once (scale 1 to 1.12 over 220 ms, hold 1.6 s, back over 300 ms).
   - Missed: red banner "Out of attempts", then "Answer: C. <option text>" (the ONLY time the answer is
     shown), the correct option green, the trainer's wrong picks red.
   - Both: a clock line "Next question in 3 hours"; the footer button becomes **Continue to Dashboard**.
7. Footer stats under the button, always: "Best: N" and "Today: N right · N wrong · N guesses"
   ("guess" when 1).
8. Other popup states, each with **Continue to Dashboard**:
   - loading: "Loading your quiz..."
   - server says not due yet: "Your next question is due in 2 h 16 min." (formats: "45 min", "2 h", "2 h 16 min")
   - no question in the bank: "No quiz questions available."
   - error: the mapped message (section 3.2) plus an outline **Try again** button above Continue.
9. Reopening the app mid-question brings the same question back with the guesses already used, the tried
   options greyed, and the banner "Welcome back. 2 attempts left on this question."
10. Dashboard, trainers only: **Quiz Streak** tile and **My Quiz Score** card; the Trainer Leaderboard gains a
    **QUIZ** column and a "QUIZ N" line on its dashboard podium (section 4). No separate quiz leaderboard.

---

## 2. Backend contract (live, consume as is)

### Tables (read nothing directly; listed so you understand the data)
- `daily_quiz_score`: one row per trainer per **IST** day, UNIQUE `(trainer_id, quiz_date)`; columns
  `id, trainer_id, quiz_date, details jsonb, created_at, updated_at`. Everything about the day is in
  `details`: `{ correct, wrong (questions resolved that day), attempts (guesses that day), points, streak,
  accuracy (round(100 * correct / (correct + wrong)), absent until a question is resolved), questions:
  [{ id, result: "correct" | "wrong", attempts: 1..3, points: 0..3, at }], current_question_id,
  current_attempts, current_wrong_options: string[], last_question_at, next_quiz_eligible_at }`.
  RLS: trainers read their own rows, admins all rows, **nobody writes except the RPCs**.
- `mcq_questions_for_trainers`: the question bank. `correct_option` is NOT readable by signed-in users.
- `trainer_certificates`: a row named `CSPS` gives the CSPS category, else ACE; questions tagged `ALL`
  go to everyone.
- The old `trainer_quiz_scores` table is dead. Never read or write it.

### The four RPCs (all SECURITY DEFINER, `authenticated` only)
1. `quiz_my_state()` with `{}` →
   ```json
   { "current_streak": 0, "longest_streak": 0, "total_correct": 0, "total_questions": 0, "total_attempts": 0,
     "next_quiz_eligible_at": null, "last_question_at": null, "current_question_id": null,
     "today": { "correct": 0, "wrong": 0, "attempts": 0, "points": 0 } }
   ```
   `longest_streak` and the `total_*` fields count from 25 Sep 2026 only.
2. `quiz_next_question()` with `{}` → one of:
   - `{ "eligible": true, "resumed": bool, "question": { "id", "question", "option_a", "option_b", "option_c",
     "option_d", "category" }, "attempts_used": n, "attempts_left": n, "wrong_options": ["b"], "state": {...} }`
   - `{ "eligible": true, "question": null, "state": {...} }` (bank empty for the category)
   - `{ "eligible": false, "next_quiz_eligible_at": "ISO", "state": {...} }` (3-hour clock still running)

   **It has a side effect** (creates today's row, marks the question in progress). Call it ONLY when the
   popup is about to show, never from a list, a prefetch or a cache warmer, and ask again every time the
   popup opens.
3. `quiz_submit_answer({ p_question_id: uuid, p_option: 'a' | 'b' | 'c' | 'd' })` →
   `{ repeat, correct, resolved, attempts_used, attempts_left, wrong_options, points_awarded, correct_option,
   correct_text, state }`. `repeat: true` = the same wrong option again, not counted. `correct_option` /
   `correct_text` are non-null ONLY when `resolved` and not `correct`. Server errors: "Pick one of the four
   options", "No question in progress; ask for a new one", "That question is gone; ask for a new one".
4. `get_quiz_leaderboard({ p_month: 'YYYY-MM-01' })` (any date in the month; `null` = this IST month) →
   rows ordered by rank:
   `{ rank, trainer_id, trainer_name, month_points, month_correct, month_wrong, month_attempts,
   month_questions, current_streak, longest_streak, total_correct, total_questions, month_accuracy,
   month_days }`. Rank = month points, then longest streak, then total correct. Trainers
   (`profiles.role = 'trainer'`) only. `month_accuracy` is an integer 0..100 or `null` until the trainer
   finishes a question that month; it is the **mean of the trainer's daily scores** over the days played
   (4 questions and 2 right = a 50 day; a 50 day then a 60 day = 55; the mean of days, not the ratio of
   totals). `month_days` = days averaged.

`state` inside replies 2 and 3 is the same object as reply 1.

### Scoring starts 25 Sep 2026
The database ignores every row dated before **2026-09-25** in the leaderboard (all columns, month range
clamped, lifetime columns too) and in `longest_streak` / `total_*` of the state. Launch day starts with
streak 0. The popup still works before that date; those answers are practice. The app mirrors the date as
a constant only to label it (section 3.1).

### Rules the server enforces (mirror for display only)
Three guesses per question; points 3 / 2 / 1 by the guess that got it right, 0 for a miss; a correct guess
extends the streak, a resolved miss resets it to 0, a missed day does not; both outcomes set the next
question 3 hours later; a question started before midnight IST is written to the new day; no repeat
within 30 days unless the bank is exhausted.

---

## 3. Client logic

### 3.1 Pure helpers (port verbatim into `src/lib/trainerQuiz.ts`)
```ts
export const QUIZ_MAX_ATTEMPTS = 3;
export const QUIZ_COOLDOWN_HOURS = 3;
export const QUIZ_ON_FIRE_STREAK = 3;
/** First day the leaderboard counts (IST). Mirrors quiz_leaderboard_start() in SQL; change together. */
export const QUIZ_LEADERBOARD_START = '2026-09-25';
export type QuizOption = 'a' | 'b' | 'c' | 'd';
export const QUIZ_OPTIONS: QuizOption[] = ['a', 'b', 'c', 'd'];
export const EMPTY_DAY = { correct: 0, wrong: 0, attempts: 0, points: 0 };

export const isQuizDue = (state: QuizState | null | undefined, nowMs = Date.now()) => {
  if (!state) return true;
  if (state.current_question_id) return true;
  if (!state.next_quiz_eligible_at) return true;
  const at = new Date(state.next_quiz_eligible_at).getTime();
  return !Number.isFinite(at) || at <= nowMs;
};
export const timeUntil = (iso?: string | null, nowMs = Date.now()) => {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - nowMs;
  if (!Number.isFinite(diff) || diff <= 0) return null;
  return { hours: Math.floor(diff / 3_600_000), minutes: Math.floor((diff % 3_600_000) / 60_000), totalMs: diff };
};
export const timeUntilText = (t: { hours: number; minutes: number } | null) =>
  !t ? 'now' : t.hours <= 0 ? `${Math.max(1, t.minutes)} min` : t.minutes > 0 ? `${t.hours} h ${t.minutes} min` : `${t.hours} h`;
export const optionText = (q, o) => (!q || !o ? '' : ({ a: q.option_a, b: q.option_b, c: q.option_c, d: q.option_d } as any)[o] ?? '');
export const describeQuizError = (e: unknown) => {
  const msg = (e as any)?.message ?? String(e ?? '');
  if (/PGRST202|could not find the function/i.test(msg)) return 'The quiz backend is not live yet. Ask the tech team to run the quiz migration.';
  if (/permission denied/i.test(msg)) return 'You are not allowed to take the quiz with this account.';
  if (/No question in progress|question is gone/i.test(msg)) return 'That question expired. Loading a new one.';
  if (/timed out|timeout/i.test(msg)) return 'The network is slow. Try again.';
  return msg || 'Something went wrong';
};
```
Plus the TypeScript types for the four replies exactly as in section 2 (`QuizState`, `QuizQuestion`,
`QuizNext`, `QuizAnswer`, `QuizLeaderboardRow` with `month_accuracy: number | null; month_days: number`).

### 3.2 Queries (`src/lib/trainerQuizQueries.ts`)
| Key | RPC | Options |
|---|---|---|
| `['trainer-quiz-score', uid]` | `quiz_my_state` | staleTime 0, refetchOnMount 'always', retry 1; a failed fetch **resolves to `null`** (not an error) so the popup still opens with its error state |
| `['trainer-quiz-question', uid]` | `quiz_next_question` | enabled only inside the popup; staleTime Infinity, **gcTime 0**, no refetch on focus / reconnect / mount, retry 1 |
| `['trainer-quiz-score-nav', uid]` | `quiz_my_state` | for the tile; staleTime 30 s, gcTime 5 min, refetchOnMount 'always'; on failure return the last good value kept in a module `Map` per uid, cleared on sign-out (the app's `registerTeardown`) |
| `['quiz-leaderboard', 'YYYY-MM-01']` | `get_quiz_leaderboard({ p_month })` | staleTime 60 s, refetchOnMount 'always', retry 1; month key = local calendar month `YYYY-MM-01`. One cache entry per month, shared by My Quiz Score and the QUIZ column |

- `useQuizScoresByTrainer(monthKeys[], enabled)` (the QUIZ column): `useQueries` over the month keys with the SAME
  key and fetcher as above; returns a plain object (never a Map) `trainerId → { points, correct, wrong, days, accuracy }`.
  One month: straight from that month's row. Several months (the "3 Months" tab): points / correct / wrong add up,
  `days` adds up, `accuracy = round(Σ(month_accuracy × month_days) / Σ month_days)` over months with a non-null
  accuracy, else null.

- `useTrainerQuiz({ uid, withQuestion?, enabled? })` returns `state`, `isStateLoading`,
  `shouldShowQuiz = enabled && !statePending && isQuizDue(state, nowMs)` with a `setInterval` minute tick
  updating `nowMs`, the question query, `submitAnswer` (mutation), `isSubmitting`, `refetchQuestion`, and
  `forgetQuestion()` = `removeQueries(['trainer-quiz-question', uid])`.
- Submit `onSuccess`: `setQueryData(['trainer-quiz-score', uid], answer.state)`, then invalidate
  `['trainer-quiz-score', uid]`, `['trainer-quiz-score-nav', uid]` and `['quiz-leaderboard']`.
- **Persistence**: if the iOS app persists the react-query cache (allow-list by key prefix), the three
  `trainer-quiz-*` keys must be EXCLUDED even if a `'trainer-'` prefix is allowed (Android adds them to a
  `NEVER_PERSIST` set checked before the prefix list). A stale "due" restored from disk must never open the
  mandatory popup before the server answers. `quiz-leaderboard` needs no persistence either.

### 3.3 Popup container state machine
- Local state: `selected` ('' or a letter), `attemptsUsed`, `wrongOptions[]`, `notice` (string | null),
  `result` (`{ correct, attemptsUsed, pointsAwarded, correctOption, correctText, newStreak }` | null).
- When a question id arrives: seed `attemptsUsed = next.attempts_used ?? 0`,
  `wrongOptions = next.wrong_options ?? []`, clear selection and result, and
  `notice = "Welcome back. N attempts left on this question."` when `next.resumed && attempts_used > 0`.
- Submit:
  - `repeat` → notice "You already tried that option.", clear selection.
  - not `resolved` → update attempts and wrong options, clear selection, notice
    "Not quite. N attempts left." ("attempt" when 1).
  - `resolved` → clear notice, set `result` with `newStreak = answer.state.current_streak`.
  - thrown error → native alert "Couldn't check that answer" + the mapped message; if the mapped message
    contains "expired", refetch the question.
- Continue: `forgetQuestion()`, invalidate the quiz keys, close.
- View props: loading = question query pending; loadError = mapped question error; notDueUntil =
  `next.next_quiz_eligible_at` when `eligible` is false; streak / best / today from `next.state`, falling
  back to the dashboard's state. Best shown = `max(longest_streak, streakShown)` where
  `streakShown = result ? result.newStreak : currentStreak`.

### 3.4 Dashboard mount (trainer home)
- Gate everything on the DB role being exactly `'trainer'` (not coach, not admin viewing a trainer).
- `const quiz = useTrainerQuiz({ uid, enabled: isTrainer })`.
- `quizOpen` state plus a `quizDoneRef`. Effect: when `isTrainer && !tourOpen && !quiz.isStateLoading &&
  quiz.shouldShowQuiz && !quizDoneRef.current` → open. When `shouldShowQuiz` turns false, reset
  `quizDoneRef` to false. `onComplete` sets `quizDoneRef = true` and closes (this stops an error / not-due /
  empty-bank popup from reopening in a loop until the server stops calling the quiz due).
- Never open while the feature tour / onboarding overlay is visible, or before any location / permission
  gate that precedes the dashboard has resolved.
- Mount the popup component only while open (it must not run `quiz_next_question` otherwise). Render it as
  ONE top-level `Modal` (transparent, fade, `statusBarTranslucent`, `onRequestClose={() => {}}`), never
  nested inside another modal.

---

## 4. Screens and exact copy

Colors (Android theme; map to your tokens): orange `#F47A2A`, orange gradient `#FB8B3A` to `#EE5E16`,
green `#57C98A`, red `#E76A52`, gold / amber `#E0A53C`, text `#EDE8E2`, muted `#9A938C`, muted2
`#8A847E`, muted3 `#7C766F`, popup sheet `#171210` with footer `#1B1512`, card gradient
`rgba(64,38,22,0.45)` to `rgba(20,16,15,0.5)`. Fonts: Serif for titles and numbers, Body, Mono for tiny caps.

### 4.1 Popup (`DailyQuizModal`)
- Backdrop `rgba(0,0,0,0.8)`, centered sheet, width 100% up to 460 (400 for the compact states), max
  height 90%, radius 24, border orange at 28% alpha.
- Header (orange gradient, padding 18 x 16, two faint white circles decoration): 40x40 rounded icon box
  (sparkle), "Daily Quiz" (Serif 19, white) over "Test your knowledge" (12, white 82%); right side the
  "Attempt N of 3" pill (hidden once resolved; N = min(attemptsUsed + 1, 3)) and the 🔥 N badge. When the
  streak shown is above 0: labels "Current Streak" / "Best: N" (11, white 75%) over an 8 px bar, fill
  `#FFB74D` to `#FFE082`, width = min(streak / max(longest, 10), 1).
- Amber notice banner (only while unresolved and a notice exists): cross icon in a 34 px circle, notice
  (13.5 semibold `#FFD08A`), sub-line "The answer stays hidden. Pick another option." (11.5).
- Result banner (green or red at 12% background, 32% bottom border): title, points chip, streak chip,
  "Answer: X. text" on a miss, clock icon + "Next question in 3 hours".
- Scrollable body: question (15.5, white, line height 23), then option rows: 32 px letter box radius 10,
  option text 13.5, check / cross on the right. Styles: correct (revealed or picked-correct) green border
  and 14% green fill; tried-wrong or picked-wrong red border 60% and 10% red fill at 60% opacity; selected
  orange border and 12% orange fill; resolved and not correct-highlighted rows at 55% opacity. Tried
  options and every row after resolution are disabled.
- Footer: the primary button (50 px, radius 14, orange gradient, sparkle icon on Submit, chevron on
  Continue), then the stats line with award and target icons.
- Compact states: 64 px circle icon (sparkle for loading; alert in amber for errors; clock for not due;
  target for empty), message centered, buttons full width.

### 4.2 Quiz Streak tile (first of the dashboard tiles)
Warm card, 3 px orange-to-gold gradient top rule, a 44 px orange-to-gold circle with 🔥, "Quiz Streak"
(12 semibold muted), the streak (Serif 28) + "in a row", then "🔥 On Fire!" (orange) when the streak is 3
or more, else "Today N right · N wrong" (Mono 10.5 muted3). Placeholder while loading.

### 4.3 My Quiz Score card (directly under the Quiz Streak tile)
The trainer's own row of THIS month's `get_quiz_leaderboard`, from the `['quiz-leaderboard', month]` query
(the same entry the Trainer Leaderboard's quiz line reads, so they never disagree).
- Header: target icon chip (orange), "My Quiz Score" (Serif 18), sub-line
  "September 2026 · counted from 25 Sep · N trainers on the board" (the middle part only while the month
  contains the launch date and starts before it; "N trainers" = rows returned, "trainer" when 1, omitted
  when 0). Right side: "#N" (Serif 26; gold / silver `#B8BCC4` / bronze `#C08A52` for ranks 1 to 3, else
  white) over "RANK", only when the trainer has a row.
- Body by state:
  - loading: spinner.
  - error: "Your score is not available right now."
  - today is before 25 Sep 2026: gold box "Scoring starts 25 September 2026." + "Questions answered before
    then are practice and are not counted."
  - no own row: "You are not on the board yet." + "Your first finished question puts you on it. Points
    and accuracy count from 25 September 2026."
  - own row: three equal cells (radius 12, faint fill): POINTS = `month_points` with hint
    "3 / 2 / 1 per right answer"; ACCURACY = `month_accuracy%` or "n/a", colored by the accuracy tone
    (4.4), hint "N days played" ("day" when 1); STREAK = `current_streak`, orange with hint "🔥 On Fire!" from
    3, else hint "best {longest_streak}". Under them (Mono 10): "N right · N wrong · N guesses this month".

### 4.4 The quiz inside the Trainer Leaderboard (NO separate quiz leaderboard)
The user removed the separate Quiz Leaderboard card on 23 Sep 2026: "no need to make another leaderboard for
quiz, show in trainer dashboard in a new column". If iOS already built a separate quiz leaderboard card, delete it.
Ranking of the Trainer Leaderboard does NOT change (sessions + QHPs, referrals, as before).
- **Full standings screen** (route `trainer-leaderboard`, the rows with REF and SESS): add a third column **QUIZ**
  after SESS (`QuizColumnCell`, minWidth 40, centered):
  - "QUIZ" caps label (Mono 8.5, letterSpacing 1, faint `#6E6862`) like REF and SESS;
  - the trainer's quiz points for the selected period (bold 14, orange `#F47A2A`), or "-" in muted3 when the trainer
    has no quiz row for that period;
  - under it the accuracy "80%" (Mono 8.5) in the tone colour: 75 and above green, 50 to 74 gold, below 50 red;
    nothing when accuracy is null;
  - long-press (300 ms, hitSlop 10) opens an alert titled "Daily quiz":
    "12 points in this month (3, 2 or 1 per question by the guess that got it right). 4 right, 1 wrong. Accuracy
    80%: the mean of 3 daily scores. Counted from 25 September 2026." ("point" / "score" when 1; the accuracy
    sentence is left out when null), or "No quiz answers in <period>. Quiz points count from 25 September 2026.";
    <period> = "this month", the tab's month label ("Aug", "Jul"), or "the last 3 months".
  - Under the "FULL STANDINGS" heading add a caps note (Mono 8.5, muted3):
    "QUIZ = DAILY QUIZ POINTS AND ACCURACY · COUNTED FROM 25 SEP 2026 · HOLD FOR DETAILS".
  - Period tabs map to quiz months: This Month = month 0; the two month tabs = month 1 / month 2; "3 Months" =
    months 0, 1 and 2 combined through `useQuizScoresByTrainer` (section 3.2). Month key = the tab's IST month
    start `YYYY-MM-01`. Rows join by `trainer_id` (keep the trainer id on each leaderboard row).
- **Dashboard Trainer Leaderboard card** (the podium preview, trainer role only): under each podium trainer's
  sessions figure and its "SESS" unit, a tiny orange caps line "QUIZ 12" (Mono 7.5, letterSpacing 0.6) when that
  trainer has a quiz row this month; nothing otherwise. The doctor dashboard's copy of this card shows no quiz line.

### 4.5 Dashboard order (trainer home)
... Client Threads card, QHP Refresh Pending card, **Quiz Streak tile**, **My Quiz Score card**, then the
existing stat tiles ... later the LEADERBOARDS section: Managers Leaderboard (managers only), Trainer
Leaderboard (with the "QUIZ N" podium line). The popup is mounted once at the end of the screen.
Nothing new in navigation; no new routes; nothing to add to the replay-shield sensitive routes.

---

## 5. Probe before building (sign in with a trainer login; ask the user for one)
- `POST /rest/v1/rpc/quiz_my_state` `{}` → 200 with the state object. (PGRST202 = backend missing: stop.)
- `POST /rest/v1/rpc/get_quiz_leaderboard` `{}` → 200, a JSON array; every row has `month_accuracy` and
  `month_days` keys. (Before 25 Sep 2026 the array is empty: that is correct.)
- `GET /rest/v1/mcq_questions_for_trainers?select=correct_option&limit=1` → permission error (42501);
  `select=id,question&limit=1` → 200.
- With the anon key: the four RPCs answer `28000 Not authenticated` or `42501 permission denied`. Both
  are correct.
- Never probe `quiz_next_question` from a script against a real trainer: it creates rows.

## 6. Acceptance test (device, trainer login)
1. First dashboard open shows the quiz. Back gesture and backdrop tap do nothing.
2. Two wrong guesses: the banner counts down, tried options grey out and cannot be picked. In SQL,
   `select quiz_date, details from daily_quiz_score where trainer_id = '<uid>' order by quiz_date desc limit 1`
   shows `current_question_id` and two `current_wrong_options`.
3. Kill and reopen the app: the same question returns with "Welcome back. 1 attempts left..." and two
   greyed options.
4. Correct third guess: "+1 point", streak 1; `details` shows `correct 1, attempts 3, points 1, streak 1`,
   one `questions` entry, `accuracy 100`, `next_quiz_eligible_at` about 3 hours ahead. Continue closes it;
   reopening the dashboard does not show it.
5. Ask the user to run in SQL: `update daily_quiz_score set details = details || jsonb_build_object('next_quiz_eligible_at', now() - interval '1 minute') where trainer_id = '<uid>' and quiz_date = (now() at time zone 'Asia/Kolkata')::date;`
   Within a minute (or on reopen) a new question appears. Miss three times: "Out of attempts", the answer
   is shown, streak 0.
6. The Trainer Leaderboard full standings show a QUIZ column on every period tab ("-" for trainers without quiz
   answers, long-press explains), the dashboard podium shows "QUIZ N" under trainers with points, and there is no
   separate quiz leaderboard card anywhere.
7. Streak tile, My Quiz Score and the QUIZ column show the same numbers as the Android app for
   the same trainer and month; before 25 Sep the score card says "Scoring starts 25 September 2026.".
7. A non-trainer account (coach, admin) sees no tile, no cards and no popup.

## 7. Decisions already taken (never change on one platform alone)
- The answer is revealed only after the third miss.
- Points 3 / 2 / 1 / 0; rank by month points, then longest streak, then total correct.
- Any correct guess within three extends the streak; a missed question resets it; a missed day does not.
- Accuracy = mean of daily right %, not total right / total questions.
- Days are IST; scores count from 25 Sep 2026; questions tagged `ALL` go to everyone.

## 8. If the iOS app is not React Native
Same contract through the Supabase Swift SDK: `client.rpc("quiz_my_state")`, `client.rpc("quiz_next_question")`,
`client.rpc("quiz_submit_answer", params: ["p_question_id": id, "p_option": "b"])`,
`client.rpc("get_quiz_leaderboard", params: ["p_month": "2026-09-01"])`, decoded into structs matching
section 2. The popup is a `.fullScreenCover` with `interactiveDismissDisabled(true)` and no close control;
the minute tick is a `Timer.publish(every: 60)`; never cache the question, and never persist the state.
