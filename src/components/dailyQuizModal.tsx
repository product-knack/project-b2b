import React from 'react';
import { View, Text, Pressable, Modal, ScrollView, ActivityIndicator, Animated, Easing, Alert } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useQueryClient } from '@tanstack/react-query';
import { C, F, hexA, ORANGE_GRAD } from '../theme';
import { Icon, IconName } from '../icons';
import { Serif, Body, Mono } from './primitives';
import { useTrainerQuiz, invalidateQuizKeys } from '../lib/trainerQuizQueries';
import {
  QUIZ_MAX_ATTEMPTS, QUIZ_COOLDOWN_HOURS, QUIZ_OPTIONS, optionText, timeUntil, timeUntilText, describeQuizError,
  QuizDay, QuizOption, QuizQuestion, EMPTY_DAY,
} from '../lib/trainerQuiz';

/* ============ Daily Quiz popup (port of web DailyQuizPopup.tsx, 23 Sep 2026) ============
   Three guesses per question, the answer stays hidden until the question is
   over, a question every 3 hours. Mandatory: no close button, no backdrop tap,
   the Android back button does nothing; Continue is the only way out, and it
   is always offered when the backend cannot serve a question. DailyQuizView is
   props-only; DailyQuizModal wires it to useTrainerQuiz. */

export interface QuizResultView {
  correct: boolean;
  attemptsUsed: number;
  pointsAwarded: number;
  correctOption: QuizOption | null;
  correctText: string | null;
  newStreak: number;
}

export interface DailyQuizViewProps {
  loading: boolean;
  /** Set when the question could not be loaded; Continue stays available. */
  loadError: string | null;
  /** Set when the server says the next question is not due yet. */
  notDueUntil: string | null;
  question: QuizQuestion | null;
  currentStreak: number;
  longestStreak: number;
  today: QuizDay;
  attemptsUsed: number;
  wrongOptions: string[];
  selected: QuizOption | '';
  notice: string | null;
  result: QuizResultView | null;
  submitting: boolean;
  onSelect: (o: QuizOption) => void;
  onSubmit: () => void;
  onContinue: () => void;
  onRetryLoad?: () => void;
}

const SHEET_BG = '#171210';
const GREEN = C.green;
const RED = C.red;
const AMBER = C.gold;

function Frame({ children, compact }: { children: React.ReactNode; compact?: boolean }) {
  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={() => { /* mandatory: the back button does nothing */ }}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', alignItems: 'center', justifyContent: 'center', padding: 14 }}>
        <View accessibilityViewIsModal style={{ width: '100%', maxWidth: compact ? 400 : 460, maxHeight: '90%', backgroundColor: SHEET_BG, borderRadius: 24, borderWidth: 1, borderColor: hexA(C.orange, 0.28), overflow: 'hidden' }}>
          {children}
        </View>
      </View>
    </Modal>
  );
}

function PrimaryButton({ label, onPress, disabled, busy, icon, trailing }: { label: string; onPress: () => void; disabled?: boolean; busy?: boolean; icon?: IconName; trailing?: IconName }) {
  return (
    <Pressable onPress={onPress} disabled={disabled || busy} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => ({ opacity: disabled ? 0.45 : pressed ? 0.8 : 1 })}>
      <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ height: 50, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        {busy ? <ActivityIndicator size="small" color="#fff" /> : icon ? <Icon name={icon} size={17} color="#fff" strokeWidth={2.4} /> : null}
        <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: '#fff' }}>{busy ? 'Checking' : label}</Text>
        {!busy && trailing ? <Icon name={trailing} size={17} color="#fff" strokeWidth={2.4} /> : null}
      </LinearGradient>
    </Pressable>
  );
}

function OutlineButton({ label, onPress, icon }: { label: string; onPress: () => void; icon?: IconName }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => ({ height: 46, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', backgroundColor: pressed ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.04)', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 })}>
      {icon ? <Icon name={icon} size={15} color={C.ink2} strokeWidth={2.2} /> : null}
      <Text style={{ fontFamily: F.bodySemi, fontSize: 14, color: C.ink2 }}>{label}</Text>
    </Pressable>
  );
}

export function DailyQuizView({ loading, loadError, notDueUntil, question, currentStreak, longestStreak, today, attemptsUsed, wrongOptions, selected, notice, result, submitting, onSelect, onSubmit, onContinue, onRetryLoad }: DailyQuizViewProps) {
  const pulse = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    if (result?.correct && result.newStreak > 0) {
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.delay(1600),
        Animated.timing(pulse, { toValue: 0, duration: 300, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]).start();
    }
  }, [result]);
  const resolved = !!result;
  const attemptsLeft = Math.max(0, QUIZ_MAX_ATTEMPTS - attemptsUsed);
  const streakShown = result ? result.newStreak : currentStreak;
  const best = Math.max(longestStreak, streakShown);

  if (loading) {
    return (
      <Frame compact>
        <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 56, paddingHorizontal: 24, gap: 14 }}>
          <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: hexA(C.orange, 0.14), alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="sparkle" size={30} color={C.orange} strokeWidth={2} />
          </View>
          <Body style={{ fontSize: 14, color: C.muted }}>Loading your quiz...</Body>
        </View>
      </Frame>
    );
  }

  if (loadError || notDueUntil || !question) {
    const until = timeUntil(notDueUntil);
    const icon: IconName = loadError ? 'alert' : notDueUntil ? 'clock' : 'target';
    const iconColor = loadError ? AMBER : C.muted2;
    return (
      <Frame compact>
        <View style={{ padding: 24, alignItems: 'center', gap: 14 }}>
          <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: hexA(iconColor, 0.14), alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={icon} size={30} color={iconColor} strokeWidth={2} />
          </View>
          <Body style={{ fontSize: 14, color: C.ink3, textAlign: 'center', lineHeight: 21 }}>
            {loadError ? loadError : notDueUntil ? `Your next question is due in ${timeUntilText(until)}.` : 'No quiz questions available.'}
          </Body>
          <View style={{ width: '100%', gap: 10, marginTop: 4 }}>
            {loadError && onRetryLoad ? <OutlineButton label="Try again" icon="swap" onPress={onRetryLoad} /> : null}
            <PrimaryButton label="Continue to Dashboard" onPress={onContinue} trailing="chevRight" />
          </View>
        </View>
      </Frame>
    );
  }

  const badgeScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });
  return (
    <Frame>
      {/* Header */}
      <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ paddingHorizontal: 18, paddingVertical: 16 }}>
        <View pointerEvents="none" style={{ position: 'absolute', top: -40, left: -30, width: 120, height: 120, borderRadius: 60, backgroundColor: 'rgba(255,255,255,0.1)' }} />
        <View pointerEvents="none" style={{ position: 'absolute', bottom: -60, right: -40, width: 150, height: 150, borderRadius: 75, backgroundColor: 'rgba(255,255,255,0.1)' }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="sparkle" size={20} color="#fff" strokeWidth={2.2} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Serif style={{ fontSize: 19, color: '#fff' }}>Daily Quiz</Serif>
            <Body style={{ fontSize: 12, color: 'rgba(255,255,255,0.82)' }}>Test your knowledge</Body>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {!resolved ? (
              <View style={{ paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.16)' }}>
                <Mono style={{ fontSize: 10, color: '#fff' }}>Attempt {Math.min(attemptsUsed + 1, QUIZ_MAX_ATTEMPTS)} of {QUIZ_MAX_ATTEMPTS}</Mono>
              </View>
            ) : null}
            <Animated.View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.22)', transform: [{ scale: badgeScale }] }}>
              <Text style={{ fontSize: 13 }}>🔥</Text>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: '#fff' }}>{streakShown}</Text>
            </Animated.View>
          </View>
        </View>
        {streakShown > 0 ? (
          <View style={{ marginTop: 14, gap: 6 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Body style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)' }}>Current Streak</Body>
              <Body style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)' }}>Best: {best}</Body>
            </View>
            <View style={{ height: 8, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.22)', overflow: 'hidden' }}>
              <LinearGradient colors={['#FFB74D', '#FFE082']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ width: `${Math.min((streakShown / Math.max(longestStreak, 10)) * 100, 100)}%`, height: '100%', borderRadius: 999 }} />
            </View>
          </View>
        ) : null}
      </LinearGradient>

      {/* Wrong guess, question still open */}
      {!resolved && notice ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 11, backgroundColor: hexA(AMBER, 0.12), borderBottomWidth: 1, borderBottomColor: hexA(AMBER, 0.3) }}>
          <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: hexA(AMBER, 0.18), alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="close" size={16} color={AMBER} strokeWidth={2.6} />
          </View>
          <View style={{ flex: 1 }}>
            <Body style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#FFD08A' }}>{notice}</Body>
            <Body style={{ fontSize: 11.5, color: hexA('#FFD08A', 0.8) }}>The answer stays hidden. Pick another option.</Body>
          </View>
        </View>
      ) : null}

      {/* Question over */}
      {result ? (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 16, paddingVertical: 13, backgroundColor: hexA(result.correct ? GREEN : RED, 0.12), borderBottomWidth: 1, borderBottomColor: hexA(result.correct ? GREEN : RED, 0.32) }}>
          <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: hexA(result.correct ? GREEN : RED, 0.18), alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={result.correct ? 'checks' : 'close'} size={16} color={result.correct ? GREEN : RED} strokeWidth={2.6} />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <Body style={{ fontSize: 14.5, fontFamily: F.bodyBold, color: result.correct ? GREEN : RED }}>
                {result.correct ? (result.attemptsUsed === 1 ? 'Correct, first try!' : `Correct on attempt ${result.attemptsUsed}`) : 'Out of attempts'}
              </Body>
              {result.correct ? (
                <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: hexA(GREEN, 0.18) }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: GREEN }}>+{result.pointsAwarded} {result.pointsAwarded === 1 ? 'point' : 'points'}</Text>
                </View>
              ) : null}
              {result.correct && result.newStreak > 1 ? (
                <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: hexA(C.orange, 0.18) }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: '#F0A875' }}>🔥 {result.newStreak} streak</Text>
                </View>
              ) : null}
            </View>
            {!result.correct && result.correctOption ? (
              <Body style={{ fontSize: 13, color: C.ink3 }}>Answer: <Text style={{ fontFamily: F.bodySemi, color: '#fff' }}>{result.correctOption.toUpperCase()}. {result.correctText}</Text></Body>
            ) : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Icon name="clock" size={11} color={C.muted2} strokeWidth={2.2} />
              <Body style={{ fontSize: 11.5, color: C.muted2 }}>Next question in {QUIZ_COOLDOWN_HOURS} hours</Body>
            </View>
          </View>
        </View>
      ) : null}

      {/* Question and options */}
      <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ padding: 18, gap: 10 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Body style={{ fontSize: 15.5, color: '#fff', lineHeight: 23, marginBottom: 8 }}>{question.question}</Body>
        {QUIZ_OPTIONS.map((option) => {
          const isWrongEarlier = wrongOptions.includes(option);
          const isSelected = option === selected;
          const isRevealedCorrect = resolved && result?.correctOption === option;
          const isFinalCorrect = resolved && !!result?.correct && isSelected;
          const isFinalWrong = resolved && !result?.correct && isSelected;
          const disabled = resolved || isWrongEarlier;
          const good = isRevealedCorrect || isFinalCorrect;
          const bad = isFinalWrong || isWrongEarlier;
          const border = good ? GREEN : bad ? hexA(RED, 0.6) : isSelected ? C.orange : 'rgba(255,255,255,0.1)';
          const bg = good ? hexA(GREEN, 0.14) : bad ? hexA(RED, 0.1) : isSelected ? hexA(C.orange, 0.12) : 'rgba(255,255,255,0.03)';
          const letterBg = good ? GREEN : bad ? RED : isSelected ? C.orange : 'rgba(255,255,255,0.08)';
          const letterFg = good || bad || isSelected ? '#fff' : C.muted;
          return (
            <Pressable
              key={option}
              disabled={disabled}
              onPress={() => onSelect(option)}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected, disabled }}
              accessibilityLabel={`Option ${option.toUpperCase()}: ${optionText(question, option)}`}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13, borderRadius: 14, borderWidth: 1.5, borderColor: border, backgroundColor: bg, opacity: bad ? 0.6 : resolved && !good ? 0.55 : pressed ? 0.85 : 1 })}
            >
              <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: letterBg, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: letterFg }}>{option.toUpperCase()}</Text>
              </View>
              <Body style={{ flex: 1, fontSize: 13.5, lineHeight: 19, color: '#fff' }}>{optionText(question, option)}</Body>
              {good ? <Icon name="checks" size={18} color={GREEN} strokeWidth={2.4} /> : bad ? <Icon name="close" size={18} color={RED} strokeWidth={2.4} /> : null}
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Footer */}
      <View style={{ paddingHorizontal: 18, paddingTop: 12, paddingBottom: 14, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.07)', backgroundColor: '#1B1512', gap: 10 }}>
        {!resolved ? (
          <PrimaryButton label={attemptsUsed > 0 ? `Submit Answer (${attemptsLeft} left)` : 'Submit Answer'} icon="sparkle" onPress={onSubmit} disabled={!selected} busy={submitting} />
        ) : (
          <PrimaryButton label="Continue to Dashboard" onPress={onContinue} trailing="chevRight" />
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16, flexWrap: 'wrap' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Icon name="award" size={12} color={C.muted2} strokeWidth={2} />
            <Body style={{ fontSize: 11.5, color: C.muted2 }}>Best: {best}</Body>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Icon name="target" size={12} color={C.muted2} strokeWidth={2} />
            <Body style={{ fontSize: 11.5, color: C.muted2 }}>Today: {today.correct} right · {today.wrong} wrong · {today.attempts} {today.attempts === 1 ? 'guess' : 'guesses'}</Body>
          </View>
        </View>
      </View>
    </Frame>
  );
}

/** The wired popup. Mounted only while `visible`; the question RPC runs when it mounts. */
export function DailyQuizModal({ visible, uid, onComplete }: { visible: boolean; uid: string | null; onComplete: () => void }) {
  if (!visible || !uid) return null;
  return <DailyQuizContainer uid={uid} onComplete={onComplete} />;
}

function DailyQuizContainer({ uid, onComplete }: { uid: string; onComplete: () => void }) {
  const qc = useQueryClient();
  const quiz = useTrainerQuiz({ uid, withQuestion: true });
  const next = quiz.next;
  const question = next?.question ?? null;

  const [selected, setSelected] = React.useState<QuizOption | ''>('');
  const [attemptsUsed, setAttemptsUsed] = React.useState(0);
  const [wrongOptions, setWrongOptions] = React.useState<string[]>([]);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<QuizResultView | null>(null);

  // A resumed question brings its guesses so far.
  React.useEffect(() => {
    if (!next?.question) return;
    setAttemptsUsed(next.attempts_used ?? 0);
    setWrongOptions(next.wrong_options ?? []);
    setSelected('');
    setNotice(next.resumed && (next.attempts_used ?? 0) > 0 ? `Welcome back. ${next.attempts_left ?? 0} attempts left on this question.` : null);
    setResult(null);
  }, [next?.question?.id]);

  const handleSubmit = async () => {
    if (!question || !selected || quiz.isSubmitting) return;
    try {
      const answer = await quiz.submitAnswer({ questionId: question.id, option: selected });
      if (answer.repeat) {
        setNotice('You already tried that option.');
        setSelected('');
        return;
      }
      if (!answer.resolved) {
        setAttemptsUsed(answer.attempts_used);
        setWrongOptions(answer.wrong_options);
        setSelected('');
        setNotice(`Not quite. ${answer.attempts_left} ${answer.attempts_left === 1 ? 'attempt' : 'attempts'} left.`);
        return;
      }
      setNotice(null);
      setAttemptsUsed(answer.attempts_used);
      setWrongOptions(answer.wrong_options);
      setResult({
        correct: answer.correct,
        attemptsUsed: answer.attempts_used,
        pointsAwarded: answer.points_awarded,
        correctOption: answer.correct_option,
        correctText: answer.correct_text,
        newStreak: answer.state.current_streak,
      });
    } catch (e) {
      const msg = describeQuizError(e);
      Alert.alert("Couldn't check that answer", msg);
      if (/expired/i.test(msg)) quiz.refetchQuestion();
    }
  };

  const finish = () => {
    quiz.forgetQuestion();
    invalidateQuizKeys(qc, uid);
    onComplete();
  };

  const state = next?.state;
  return (
    <DailyQuizView
      loading={quiz.isQuestionLoading}
      loadError={quiz.questionError ? describeQuizError(quiz.questionError) : null}
      notDueUntil={next && !next.eligible ? next.next_quiz_eligible_at ?? null : null}
      question={question}
      currentStreak={state?.current_streak ?? quiz.state?.current_streak ?? 0}
      longestStreak={state?.longest_streak ?? quiz.state?.longest_streak ?? 0}
      today={state?.today ?? EMPTY_DAY}
      attemptsUsed={attemptsUsed}
      wrongOptions={wrongOptions}
      selected={selected}
      notice={notice}
      result={result}
      submitting={quiz.isSubmitting}
      onSelect={setSelected}
      onSubmit={handleSubmit}
      onContinue={finish}
      onRetryLoad={() => quiz.refetchQuestion()}
    />
  );
}
