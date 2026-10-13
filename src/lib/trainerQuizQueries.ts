import React from 'react';
import { useMutation, useQuery, useQueries, useQueryClient, QueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { withTimeout } from './withTimeout';
import { registerTeardown } from './sessionTeardown';
import { EMPTY_DAY, isQuizDue, timeUntil, QuizAnswer, QuizNext, QuizOption, QuizState, QuizLeaderboardRow } from './trainerQuiz';

/* ============ Trainer Daily Quiz: react-query wrappers ============
   Port of hub-track hooks/useTrainerQuiz.ts, useTrainerQuizScore.ts and
   useQuizLeaderboard.ts (23 Sep 2026). The database grades every guess
   (quiz_submit_answer), hands out the question without its answer
   (quiz_next_question) and keeps one daily_quiz_score row per trainer per IST
   day; these hooks read the state (quiz_my_state), decide when the popup is
   due and carry the two calls. The caller passes the signed-in uid
   (session.user.id, never DEV_TRAINER_ID: RLS ties the row to auth.uid()).

   Keys are per user and cheap. They are NOT persisted: App.tsx lists the
   three trainer-quiz keys in NEVER_PERSIST because the 'trainer-' prefix
   would otherwise catch them, and a stale "due" from disk must not open the
   popup before the server has answered. */

export const QUIZ_SCORE_KEY = 'trainer-quiz-score';
export const QUIZ_QUESTION_KEY = 'trainer-quiz-question';
export const QUIZ_SCORE_NAV_KEY = 'trainer-quiz-score-nav';
export const QUIZ_LEADERBOARD_KEY = 'quiz-leaderboard';

export const invalidateQuizKeys = (qc: QueryClient, uid?: string | null) => {
  qc.invalidateQueries({ queryKey: [QUIZ_SCORE_KEY, uid] });
  qc.invalidateQueries({ queryKey: [QUIZ_SCORE_NAV_KEY, uid] });
  qc.invalidateQueries({ queryKey: [QUIZ_LEADERBOARD_KEY] });
};

const rpc = (fn: string, args?: Record<string, unknown>) => Promise.resolve(supabase.rpc(fn, args as any)) as Promise<{ data: any; error: any }>;

/** quiz_my_state() for the signed-in trainer. */
export const fetchQuizState = async (): Promise<QuizState> => {
  const { data, error } = await withTimeout(rpc('quiz_my_state', {}), 6000, 'Quiz state');
  if (error) throw error;
  return data as QuizState;
};

export function useTrainerQuiz(opts: { uid: string | null; withQuestion?: boolean; enabled?: boolean }) {
  const qc = useQueryClient();
  const uid = opts.uid;
  const enabled = !!uid && (opts.enabled ?? true);

  // The trainer's state: the 3-hour clock, the question in progress, the streaks.
  const stateQuery = useQuery({
    queryKey: [QUIZ_SCORE_KEY, uid],
    enabled,
    staleTime: 0,
    refetchOnMount: 'always',
    retry: 1,
    queryFn: async (): Promise<QuizState | null> => {
      try {
        return await fetchQuizState();
      } catch (e) {
        // A missing backend (PGRST202) or a slow network must not trap the
        // trainer: no state means "due", and the popup shows the error with Continue.
        console.warn('[TrainerQuiz] state fetch failed:', (e as any)?.message ?? e);
        return null;
      }
    },
  });

  // A minute tick so "due" flips over while the dashboard stays open.
  const [nowMs, setNowMs] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const shouldShowQuiz = enabled && !stateQuery.isPending && isQuizDue(stateQuery.data, nowMs);

  // The question to show. An RPC with a side effect (it marks the question as
  // in progress), so it runs only for the popup and never from the cache:
  // gcTime 0 means the next popup asks the server again.
  const questionQuery = useQuery({
    queryKey: [QUIZ_QUESTION_KEY, uid],
    enabled: enabled && !!opts.withQuestion,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    retry: 1,
    queryFn: async (): Promise<QuizNext> => {
      const { data, error } = await withTimeout(rpc('quiz_next_question', {}), 8000, 'Quiz question');
      if (error) throw error;
      return data as QuizNext;
    },
  });

  const submitMutation = useMutation({
    mutationFn: async (input: { questionId: string; option: QuizOption }): Promise<QuizAnswer> => {
      const { data, error } = await withTimeout(rpc('quiz_submit_answer', { p_question_id: input.questionId, p_option: input.option }), 8000, 'Submit answer');
      if (error) throw error;
      return data as QuizAnswer;
    },
    onSuccess: (answer) => {
      // The reply carries the fresh state; keep the cache in step, then refresh everything that reads it.
      qc.setQueryData([QUIZ_SCORE_KEY, uid], answer.state);
      invalidateQuizKeys(qc, uid);
    },
  });

  return {
    uid,
    state: stateQuery.data ?? null,
    isStateLoading: enabled && stateQuery.isPending,
    shouldShowQuiz,
    next: questionQuery.data ?? null,
    isQuestionLoading: !!opts.withQuestion && enabled && questionQuery.isPending,
    questionError: questionQuery.error,
    refetchQuestion: () => { questionQuery.refetch(); },
    submitAnswer: submitMutation.mutateAsync,
    isSubmitting: submitMutation.isPending,
    getTimeUntilNextQuiz: () => timeUntil(stateQuery.data?.next_quiz_eligible_at, nowMs),
    /** Call when the popup closes so the next one asks the server afresh. */
    forgetQuestion: () => qc.removeQueries({ queryKey: [QUIZ_QUESTION_KEY, uid] }),
  };
}

/* ---------- Quiz Streak tile: the same RPC, its last good value kept per user ---------- */
const lastGoodState = new Map<string, QuizState>();
registerTeardown(async () => { lastGoodState.clear(); });

export function useTrainerQuizScore(uid: string | null, enabled = true) {
  const q = useQuery({
    queryKey: [QUIZ_SCORE_NAV_KEY, uid],
    enabled: !!uid && enabled,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnMount: 'always',
    queryFn: async (): Promise<QuizState | null> => {
      if (!uid) return null;
      try {
        const state = await fetchQuizState();
        lastGoodState.set(uid, state);
        return state;
      } catch (e) {
        console.warn('[TrainerQuizScore] falling back to the last good value', (e as any)?.message ?? e);
        return lastGoodState.get(uid) ?? null;
      }
    },
  });
  const s = q.data;
  return {
    currentStreak: s?.current_streak || 0,
    longestStreak: s?.longest_streak || 0,
    totalCorrect: s?.total_correct || 0,
    totalQuestions: s?.total_questions || 0,
    totalAttempts: s?.total_attempts || 0,
    today: s?.today ?? EMPTY_DAY,
    nextQuizEligibleAt: s?.next_quiz_eligible_at ?? null,
    isLoading: !!uid && enabled && q.isPending,
  };
}

/* ---------- Quiz Leaderboard: one month, ranked by the server ---------- */
/** "YYYY-MM-01" of the month the given date falls in (local calendar, like the web). */
export const quizMonthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;

const fetchQuizLeaderboard = async (monthKey: string): Promise<QuizLeaderboardRow[]> => {
  const { data, error } = await withTimeout(rpc('get_quiz_leaderboard', { p_month: monthKey }), 8000, 'Quiz leaderboard');
  if (error) throw error;
  return (data ?? []) as QuizLeaderboardRow[];
};

export function useQuizLeaderboard(month: Date, enabled = true) {
  const monthKey = quizMonthKey(month);
  return useQuery({
    queryKey: [QUIZ_LEADERBOARD_KEY, monthKey],
    enabled,
    staleTime: 60_000,
    refetchOnMount: 'always',
    retry: 1,
    queryFn: () => fetchQuizLeaderboard(monthKey),
  });
}

/* ---------- Quiz column of the Trainer Leaderboard (23 Sep 2026) ----------
   The quiz has no leaderboard of its own any more: each Trainer Leaderboard row
   carries the trainer's quiz points and accuracy for the same period. One or more
   months ('YYYY-MM-01'), each fetched under the SAME key as useQuizLeaderboard, so
   the dashboard's My Quiz Score card and this column share one request per month.
   Several months (the "3 Months" tab): points and counts add up; accuracy is the
   mean of daily scores, so the monthly means are weighted by days played. */
export type QuizTrainerScore = { points: number; correct: number; wrong: number; days: number; accuracy: number | null };

export function useQuizScoresByTrainer(monthKeys: string[], enabled = true) {
  const results = useQueries({
    queries: monthKeys.map((monthKey) => ({
      queryKey: [QUIZ_LEADERBOARD_KEY, monthKey],
      enabled,
      staleTime: 60_000,
      retry: 1,
      queryFn: () => fetchQuizLeaderboard(monthKey),
    })),
  });
  const isPending = enabled && results.some((r) => r.isPending);
  const isError = results.some((r) => r.isError);
  const stamp = results.map((r) => r.dataUpdatedAt).join(',');
  const data = React.useMemo(() => {
    if (!enabled || results.some((r) => !r.data)) return undefined;
    const acc: Record<string, { points: number; correct: number; wrong: number; days: number; accSum: number }> = {};
    for (const r of results) {
      for (const row of r.data ?? []) {
        const a = (acc[row.trainer_id] ??= { points: 0, correct: 0, wrong: 0, days: 0, accSum: 0 });
        a.points += row.month_points || 0;
        a.correct += row.month_correct || 0;
        a.wrong += row.month_wrong || 0;
        if (row.month_accuracy != null && row.month_days > 0) { a.days += row.month_days; a.accSum += row.month_accuracy * row.month_days; }
      }
    }
    const out: Record<string, QuizTrainerScore> = {}; // plain object, never a Map (persisted-cache rule)
    for (const [id, a] of Object.entries(acc)) {
      out[id] = { points: a.points, correct: a.correct, wrong: a.wrong, days: a.days, accuracy: a.days > 0 ? Math.round(a.accSum / a.days) : null };
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, stamp]);
  return { data, isPending, isError };
}
