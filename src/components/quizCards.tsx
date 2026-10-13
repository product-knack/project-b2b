import React from 'react';
import { View, Text, Pressable, ActivityIndicator, Alert } from 'react-native';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono, Card, IconChip } from './primitives';
import { useQuizLeaderboard, QuizTrainerScore } from '../lib/trainerQuizQueries';
import { QUIZ_ON_FIRE_STREAK, QUIZ_LEADERBOARD_START } from '../lib/trainerQuiz';

/* ============ My Quiz Score card + the QUIZ column (trainer dashboard) ============
   The trainer's own quiz line on the home screen, and the QUIZ column that the Trainer Leaderboard shows instead of a separate
   quiz leaderboard (user decision, 23 Sep 2026). All read the quiz RPCs only; the
   caller gates them to trainers. The database counts from QUIZ_LEADERBOARD_START
   (25 Sep 2026): earlier days were tests and are ignored by get_quiz_leaderboard. */

const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The launch date as a local Date (the constant is a plain YYYY-MM-DD). */
const launchDate = () => { const [y, m, d] = QUIZ_LEADERBOARD_START.split('-').map(Number); return new Date(y, m - 1, d); };
/** "25 Sep" or "25 September 2026". */
const launchLabel = (form: 'short' | 'long') => { const l = launchDate(); return form === 'short' ? `${l.getDate()} ${MONTHS_SHORT[l.getMonth()]}` : `${l.getDate()} ${MONTHS_LONG[l.getMonth()]} ${l.getFullYear()}`; };
/** How the viewed month sits against the launch date: wholly before it, straddling it, or after it. */
function launchRelation(month: Date): 'before' | 'straddles' | 'after' {
  const launch = launchDate();
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  if (last < launch) return 'before';
  if (first < launch) return 'straddles';
  return 'after';
}

/* The Quiz Streak tile was removed on 24 Sep 2026 at the user's request ("no need to show
   quiz streak"). The streak still shows inside My Quiz Score and the quiz popup. */

const MEDALS = [C.gold, '#B8BCC4', '#C08A52'];

/* Accuracy tone (23 Sep 2026, same thresholds as the web): accuracy is the mean of
   the trainer's daily "right %" scores over the days played (a 50 day then a 60 day
   = 55), computed by get_quiz_leaderboard; null until a question is finished. */
export const accuracyTone = (pct: number | null): { bg: string; fg: string } =>
  pct == null ? { bg: 'rgba(255,255,255,0.05)', fg: C.muted2 }
  : pct >= 75 ? { bg: hexA(C.green, 0.16), fg: C.green }
  : pct >= 50 ? { bg: hexA(C.gold, 0.16), fg: C.gold }
  : { bg: hexA(C.red, 0.14), fg: C.red };

/* ---------- QUIZ column of the Trainer Leaderboard ----------
   The quiz has no separate leaderboard (user decision, 23 Sep 2026): every Trainer
   Leaderboard row shows the trainer's quiz points for the same period, with the
   accuracy under it. "-" when the trainer has no quiz row for the period. Long-press
   explains the numbers. */
export function QuizColumnCell({ score, periodLabel }: { score: QuizTrainerScore | null | undefined; periodLabel: string }) {
  const tone = accuracyTone(score?.accuracy ?? null);
  const explain = () => Alert.alert(
    'Daily quiz',
    score
      ? `${score.points} ${score.points === 1 ? 'point' : 'points'} in ${periodLabel} (3, 2 or 1 per question by the guess that got it right). ${score.correct} right, ${score.wrong} wrong.${score.accuracy == null ? '' : ` Accuracy ${score.accuracy}%: the mean of ${score.days} daily ${score.days === 1 ? 'score' : 'scores'}.`} Counted from ${launchLabel('long')}.`
      : `No quiz answers in ${periodLabel}. Quiz points count from ${launchLabel('long')}.`,
  );
  return (
    <Pressable onLongPress={explain} delayLongPress={300} hitSlop={10} accessibilityRole="text"
      accessibilityLabel={score ? `Quiz ${score.points} points${score.accuracy == null ? '' : `, accuracy ${score.accuracy} percent`}` : 'Quiz, no answers'}
      style={{ alignItems: 'center', minWidth: 40 }}>
      <Mono style={{ fontSize: 8.5, letterSpacing: 1, color: C.faint }}>QUIZ</Mono>
      <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: score ? C.orange : C.muted3, marginTop: 1 }}>{score ? String(score.points) : '-'}</Text>
      {score && score.accuracy != null ? <Mono style={{ fontSize: 8.5, color: tone.fg }}>{score.accuracy}%</Mono> : null}
    </Pressable>
  );
}

/* ---------- My Quiz Score: the trainer's own line of this month's board, on the home screen ---------- */
function StatCell({ label, value, color, hint }: { label: string; value: string; color?: string; hint?: string }) {
  return (
    <View style={{ flex: 1, minWidth: 0, paddingVertical: 8, paddingHorizontal: 9, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', gap: 2 }}>
      <Mono style={{ fontSize: 8.5, letterSpacing: 0.5, color: C.muted3 }}>{label}</Mono>
      <Serif numberOfLines={1} style={{ fontSize: 20, lineHeight: 24, color: color ?? '#fff' }}>{value}</Serif>
      {hint ? <Body numberOfLines={1} style={{ fontSize: 10, color: C.muted2 }}>{hint}</Body> : null}
    </View>
  );
}

/** The signed-in trainer's own row of this month's quiz leaderboard (rank, points, accuracy,
    streak), counted from the launch date exactly like the board: same query key as the
    leaderboard card, so the two share one fetch and can never disagree. */
export function MyQuizScoreCard({ uid }: { uid: string | null }) {
  const now = new Date();
  const month = new Date(now.getFullYear(), now.getMonth(), 1);
  const q = useQuizLeaderboard(month, !!uid);
  const rows = q.data ?? [];
  const mine = rows.find((r) => r.trainer_id === uid) ?? null;
  const notYet = now < launchDate();
  const relation = launchRelation(month);
  const tone = accuracyTone(mine?.month_accuracy ?? null);
  const onFire = !!mine && mine.current_streak >= QUIZ_ON_FIRE_STREAK;
  return (
    <Card colors={['rgba(64,38,22,0.45)', 'rgba(20,16,15,0.5)']} style={{ padding: 14, gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <IconChip icon="target" color={C.orange} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Serif style={{ fontSize: 18 }}>My Quiz Score</Serif>
          <Body numberOfLines={2} style={{ fontSize: 11, color: C.muted }}>
            {MONTHS_LONG[month.getMonth()]} {month.getFullYear()}
            {relation === 'straddles' ? ` · counted from ${launchLabel('short')}` : ''}
            {rows.length ? ` · ${rows.length} ${rows.length === 1 ? 'trainer' : 'trainers'} on the board` : ''}
          </Body>
        </View>
        {mine ? (
          <View style={{ alignItems: 'flex-end' }}>
            <Serif style={{ fontSize: 26, lineHeight: 30, color: mine.rank <= 3 ? MEDALS[mine.rank - 1] : '#fff' }}>#{mine.rank}</Serif>
            <Mono style={{ fontSize: 9, color: C.muted3 }}>RANK</Mono>
          </View>
        ) : null}
      </View>
      {q.isPending ? (
        <ActivityIndicator color={C.orange} style={{ paddingVertical: 10 }} />
      ) : q.isError ? (
        <Body style={{ fontSize: 12.5, color: C.muted2, textAlign: 'center', paddingVertical: 8 }}>Your score is not available right now.</Body>
      ) : notYet ? (
        <View style={{ gap: 3, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 12, backgroundColor: hexA(C.gold, 0.1), borderWidth: 1, borderColor: hexA(C.gold, 0.3) }}>
          <Body style={{ fontSize: 12.5, fontFamily: F.bodySemi, color: '#fff' }}>Scoring starts {launchLabel('long')}.</Body>
          <Body style={{ fontSize: 11.5, color: C.muted2 }}>Questions answered before then are practice and are not counted.</Body>
        </View>
      ) : !mine ? (
        <View style={{ gap: 3, paddingVertical: 4 }}>
          <Body style={{ fontSize: 12.5, fontFamily: F.bodySemi, color: '#fff' }}>You are not on the board yet.</Body>
          <Body style={{ fontSize: 11.5, color: C.muted2 }}>Your first finished question puts you on it. Points and accuracy count from {launchLabel('long')}.</Body>
        </View>
      ) : (
        <>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <StatCell label="POINTS" value={String(mine.month_points)} hint="3 / 2 / 1 per right answer" />
            <StatCell label="ACCURACY" value={mine.month_accuracy == null ? 'n/a' : `${mine.month_accuracy}%`} color={mine.month_accuracy == null ? C.muted2 : tone.fg} hint={`${mine.month_days} ${mine.month_days === 1 ? 'day' : 'days'} played`} />
            <StatCell label="STREAK" value={String(mine.current_streak)} color={onFire ? C.orange : undefined} hint={onFire ? '🔥 On Fire!' : `best ${mine.longest_streak}`} />
          </View>
          <Mono style={{ fontSize: 10, color: C.muted3 }}>{mine.month_correct} right · {mine.month_wrong} wrong · {mine.month_attempts} {mine.month_attempts === 1 ? 'guess' : 'guesses'} this month</Mono>
        </>
      )}
    </Card>
  );
}
