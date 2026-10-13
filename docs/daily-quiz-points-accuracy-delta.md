# Prompt: quiz accuracy is points-based, 26 Sep 2026

Paste everything below this line into the session that built the Daily Quiz in `C:\Users\ADMIN\Desktop\b2b\odds-app` (or a fresh one there).

---

The Daily Quiz accuracy rule changed on the backend today (user decision, hub-track migration `20260926100000_quiz_points_accuracy.sql`, run on the shared Supabase project `agtjszjedaenclbzgjvi`). This is a copy and docs update only: do not change tables, RPCs or query code.

## 1. The new rule

- A day's accuracy = points earned ÷ the maximum possible, where the maximum is 3 per resolved question. Points were already 3 / 2 / 1 by the guess that got the question right and 0 for a miss, so per question: **first guess 100%, second 67%, third 33%, missed 0%**.
- Example: 4 questions answered on the 1st, 2nd, 1st and 3rd guess = (3 + 2 + 3 + 1) ÷ 12 = 75%.
- The month figure keeps its shape: the mean of the played days' scores. `get_quiz_leaderboard(p_month)` still returns `month_accuracy` (integer 0..100, null until a day is played) and `month_days`; only the values change.
- Why: under the old rule (right ÷ resolved) a question only counted as wrong after three wrong guesses out of four options, so almost every trainer scored 88 to 100%.

## 2. What changes in this app

- **Numbers: nothing to do.** The QUIZ column in the Trainer Leaderboard, the "QUIZ N" podium line and `MyQuizScoreCard` all read `month_accuracy`, which now carries the new value. `useQuizScoresByTrainer` in `src/lib/trainerQuizQueries.ts` keeps weighting monthly means by `month_days`; that is still correct.
- **Copy and comments** that describe the old rule, update the wording (no logic change):
  - `src/components/quizCards.tsx` lines 37 to 39 (the `accuracyTone` comment: "accuracy is the mean of the trainer's daily right % scores") → "accuracy is the mean of the trainer's daily scores, a day = points ÷ maximum (3 per question): first guess 100%, second 67%, third 33%".
  - `src/lib/trainerQuiz.ts` line 99 (the `month_accuracy` comment "each day = right / resolved * 100") → "each day = points / (3 x resolved) * 100".
  - User-facing text: checked on 26 Sep 2026, none states the old rule. The long-press detail in `QuizColumnCell` says "Accuracy N%: the mean of N daily scores", which stays true. Optional: append "(a day = points ÷ maximum: first guess 100%, second 67%, third 33%)" to that sentence so trainers can see how the figure is built.
- **Docs**: `docs/features/android/trainer/daily-quiz.md` already has a 2026-09-26 change-log line from the web session describing the backend change; update its rule sections (section 1 and the backend contract) to the new formula and add your own change-log line for the copy change. Update the iOS handoff `docs/ios-daily-quiz-handoff.md` wherever it states the accuracy rule, so the iOS app does not ship the old wording.

## 3. Verify

Signed in as the trainer test account, `POST /rest/v1/rpc/get_quiz_leaderboard` with `{}`: a trainer who needed more than one guess on any question now shows `month_accuracy` below 100, and a trainer who got every question on the first guess shows 100. The web Quiz Analyzer (`/academy/quiz-analyzer`) shows the same numbers for the same month.
