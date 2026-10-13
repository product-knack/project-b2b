// Trainer Daily Quiz: types and pure helpers shared by the popup, the streak
// tile and the leaderboard. Ported as is from hub-track src/lib/trainerQuiz.ts
// (23 Sep 2026); keep the two files identical.
//
// Contract (migration 20260923090000_daily_quiz_score.sql): grading happens
// in the database; the app never reads or writes a score row directly.
//   quiz_my_state()                             -> QuizState
//   quiz_next_question()                        -> QuizNext
//   quiz_submit_answer(p_question_id, p_option) -> QuizAnswer
//   get_quiz_leaderboard(p_month)               -> QuizLeaderboardRow[]
// Table daily_quiz_score: one row per trainer per IST day, the whole day in
// one jsonb column `details` (correct, wrong, attempts = guesses, points,
// questions[], streak, the question in progress and the 3-hour clock on the
// newest row). The client never sees correct_option until a question is over
// and missed.

export const QUIZ_MAX_ATTEMPTS = 3;
export const QUIZ_COOLDOWN_HOURS = 3;
export const QUIZ_ON_FIRE_STREAK = 3;
/** First day the leaderboard counts (IST). Mirrors quiz_leaderboard_start() in SQL
 *  (hub-track migration 20260923150000) and the web constant of the same name;
 *  earlier days were tests and are ignored there. Change all three together. */
export const QUIZ_LEADERBOARD_START = '2026-09-25';

export type QuizOption = 'a' | 'b' | 'c' | 'd';
export const QUIZ_OPTIONS: QuizOption[] = ['a', 'b', 'c', 'd'];

export interface QuizDay {
  correct: number;
  wrong: number;
  attempts: number;
  points: number;
}

/** quiz_my_state() reply, also carried as `state` by the other two RPCs. */
export interface QuizState {
  current_streak: number;
  longest_streak: number;
  total_correct: number;
  /** Questions resolved, all time. */
  total_questions: number;
  /** Guesses, all time. */
  total_attempts: number;
  next_quiz_eligible_at: string | null;
  last_question_at: string | null;
  current_question_id: string | null;
  today: QuizDay;
}

export interface QuizQuestion {
  id: string;
  question: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  category: string;
}

/** quiz_next_question() reply. */
export interface QuizNext {
  eligible: boolean;
  resumed?: boolean;
  question?: QuizQuestion | null;
  attempts_used?: number;
  attempts_left?: number;
  wrong_options?: string[];
  next_quiz_eligible_at?: string | null;
  state: QuizState;
}

/** quiz_submit_answer() reply. */
export interface QuizAnswer {
  repeat: boolean;
  correct: boolean;
  resolved: boolean;
  attempts_used: number;
  attempts_left: number;
  wrong_options: string[];
  points_awarded: number;
  correct_option: QuizOption | null;
  correct_text: string | null;
  state: QuizState;
}

export interface QuizLeaderboardRow {
  rank: number;
  trainer_id: string;
  trainer_name: string | null;
  month_points: number;
  month_correct: number;
  month_wrong: number;
  month_attempts: number;
  month_questions: number;
  current_streak: number;
  longest_streak: number;
  total_correct: number;
  total_questions: number;
  /** Mean of the month's daily "right %" scores (each day = right / resolved * 100), null until a day is played. */
  month_accuracy: number | null;
  /** Days in the month with at least one resolved question. */
  month_days: number;
}

export const EMPTY_DAY: QuizDay = { correct: 0, wrong: 0, attempts: 0, points: 0 };

/** "YYYY-MM-DD" in IST, the day the database keys rows by. */
export const istDateKey = (d: Date = new Date()): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

/** The popup is due when there is no state yet, a question is in progress,
 *  or the 3-hour clock from the previous question has run out. */
export const isQuizDue = (state: QuizState | null | undefined, nowMs: number = Date.now()): boolean => {
  if (!state) return true;
  if (state.current_question_id) return true;
  if (!state.next_quiz_eligible_at) return true;
  const at = new Date(state.next_quiz_eligible_at).getTime();
  return !Number.isFinite(at) || at <= nowMs;
};

/** Hours and minutes until an ISO time, or null once it has passed. */
export const timeUntil = (iso: string | null | undefined, nowMs: number = Date.now()): { hours: number; minutes: number; totalMs: number } | null => {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - nowMs;
  if (!Number.isFinite(diff) || diff <= 0) return null;
  return { hours: Math.floor(diff / 3_600_000), minutes: Math.floor((diff % 3_600_000) / 60_000), totalMs: diff };
};

export const timeUntilText = (t: { hours: number; minutes: number } | null): string => {
  if (!t) return 'now';
  if (t.hours <= 0) return `${Math.max(1, t.minutes)} min`;
  return t.minutes > 0 ? `${t.hours} h ${t.minutes} min` : `${t.hours} h`;
};

export const optionText = (q: QuizQuestion | null | undefined, o: string | null | undefined): string => {
  if (!q || !o) return '';
  switch (o) {
    case 'a':
      return q.option_a;
    case 'b':
      return q.option_b;
    case 'c':
      return q.option_c;
    case 'd':
      return q.option_d;
    default:
      return '';
  }
};

/** 3 points for a first-guess correct answer, 2 for the second, 1 for the third. */
export const pointsForAttempt = (attempt: number): number => Math.max(0, 4 - attempt);

/** Server messages mapped to what the trainer should read. */
export const describeQuizError = (e: unknown): string => {
  const msg = (e as any)?.message ?? String(e ?? '');
  if (/PGRST202|could not find the function/i.test(msg)) return 'The quiz backend is not live yet. Ask the tech team to run the quiz migration.';
  if (/permission denied/i.test(msg)) return 'You are not allowed to take the quiz with this account.';
  if (/No question in progress|question is gone/i.test(msg)) return 'That question expired. Loading a new one.';
  if (/timed out|timeout/i.test(msg)) return 'The network is slow. Try again.';
  return msg || 'Something went wrong';
};
