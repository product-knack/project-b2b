/* Essentials Auction: the bid (10 Oct 2026). Pressing Answer and bid opens the
   client's five questions (3 from the week's training summary, 2 from the health
   context), one at a time, each answered once with no way back, then one submit.
   The server scores the answers and keeps the bid with its time; the session is
   decided at the window's close. The answer indexes never reach the app.
   Port of the web AuctionQuizDialog in the auction's ticket style (one Modal,
   sibling backdrop, springs in, hitSlop 10 everywhere). */
import React from 'react';
import { View, Text, Pressable, Animated, Modal, ScrollView, ActivityIndicator, Alert, Image } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono } from './primitives';
import { MiniAvatar } from '../screens/common';
import { useAuctionQuiz, useSubmitEssentialsBid } from '../lib/essentialsAuctionQueries';
import { AuctionLot, BidResult, formatLotDate, formatTime12, pointsText } from '../lib/essentialsAuction';

const INDIGO: [string, string] = ['#232058', '#3E2B7E'];
const GOLD_GRAD: [string, string] = ['#F2C14E', '#D98B1C'];
const BG = '#100D16';
const ROSE = '#F06A8A';
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

const initials = (name: string) => name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';

function GoldButton({ label, busy, disabled, onPress, icon = 'gavel' }: { label: string; busy?: boolean; disabled?: boolean; onPress: () => void; icon?: 'gavel' | 'checks' }) {
  const off = !!disabled || !!busy;
  return (
    <Pressable onPress={off ? undefined : onPress} disabled={off} hitSlop={10} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: off }}
      style={({ pressed }) => ({ borderRadius: 14, overflow: 'hidden', opacity: pressed ? 0.85 : off && !busy ? 0.5 : 1, borderWidth: 1, borderColor: hexA(C.gold, 0.7) })}>
      <LinearGradient colors={GOLD_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 13 }}>
        {busy ? <ActivityIndicator color="#1A1200" /> : <Icon name={icon} size={16} color="#1A1200" strokeWidth={2.3} />}
        <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: '#1A1200' }}>{label}</Text>
      </LinearGradient>
    </Pressable>
  );
}

/* The "black" button of the web dialog: ink on a dark field, white text. */
function DarkButton({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={disabled ? undefined : onPress} disabled={disabled} hitSlop={10} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 13, borderRadius: 14, backgroundColor: pressed ? '#1C1826' : '#06040A', borderWidth: 1, borderColor: disabled ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.22)', opacity: disabled ? 0.45 : 1 })}>
      <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: '#fff' }}>{label}</Text>
      <Icon name="chevRight" size={15} color="#fff" strokeWidth={2.4} />
    </Pressable>
  );
}

function Note({ text, tone = 'muted' }: { text: string; tone?: 'muted' | 'red' }) {
  const col = tone === 'red' ? C.red : C.ink3;
  return (
    <View style={{ padding: 13, borderRadius: 14, backgroundColor: tone === 'red' ? hexA(C.red, 0.1) : 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: tone === 'red' ? hexA(C.red, 0.45) : 'rgba(255,255,255,0.1)' }}>
      <Body style={{ fontSize: 13, color: col, lineHeight: 19 }}>{text}</Body>
    </View>
  );
}

/* After the submit: the score, one tick per question, what happens next. A perfect score on an
   open round (15 Oct 2026) is booked on the spot: the sheet says so and the card turns YOURS. */
function BidDone({ result, closesAt, onClose }: { result: BidResult; closesAt: string; onClose: () => void }) {
  const won = result.instant_win;
  const col = won ? C.green : C.gold;
  const when = `${formatLotDate(result.training_date)} at ${formatTime12(result.slot_time)}`;
  const next = won
    ? `Booked for you at once: ${result.client_name} on ${when}. It is on your roster, and this session is closed to other bids.`
    : result.instant_blocked
      ? `A perfect score, but the session could not be booked at once (${result.instant_blocked}). It is decided at ${closesAt} as usual; you will see the result on your dashboard.`
      : `${result.bids_count} bid${result.bids_count === 1 ? '' : 's'} so far. The session is decided at ${closesAt}: highest points wins, equal points the earlier bid. You will see the result on your dashboard.`;
  return (
    <View style={{ gap: 12 }}>
      <View style={{ alignItems: 'center', gap: 4, padding: 16, borderRadius: 18, backgroundColor: hexA(col, 0.08), borderWidth: 1, borderColor: hexA(col, 0.45) }}>
        <View style={{ width: 46, height: 46, borderRadius: 15, backgroundColor: hexA(col, 0.16), borderWidth: 1, borderColor: hexA(col, 0.45), alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="trophy" size={22} color={col} strokeWidth={2.2} />
        </View>
        <Serif style={{ fontSize: 34, lineHeight: 38, marginTop: 4 }}>{pointsText(result.points, result.question_count)}</Serif>
        <Mono style={{ fontSize: 8.5, letterSpacing: 1.4, color: col }}>{won ? 'PERFECT SCORE · THE SESSION IS YOURS' : 'CORRECT · YOUR BID IS IN'}</Mono>
      </View>
      {result.question_count > 0 ? (
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
          {result.correct.map((ok, i) => (
            <View key={i} accessibilityLabel={`Question ${i + 1}: ${ok ? 'correct' : 'wrong'}`} style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: hexA(ok ? C.green : ROSE, 0.16), borderWidth: 1, borderColor: hexA(ok ? C.green : ROSE, 0.55) }}>
              <Icon name={ok ? 'checks' : 'close'} size={13} color={ok ? C.green : ROSE} strokeWidth={2.6} />
            </View>
          ))}
        </View>
      ) : null}
      <Body style={{ fontSize: 12.5, color: won ? C.ink : C.muted2, textAlign: 'center', lineHeight: 18 }}>{next}</Body>
      <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" style={({ pressed }) => ({ alignItems: 'center', paddingVertical: 12, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', backgroundColor: pressed ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.04)' })}>
        <Text style={{ fontFamily: F.bodySemi, fontSize: 13.5, color: '#fff' }}>Done</Text>
      </Pressable>
    </View>
  );
}

export function AuctionQuizSheet({ lot, physio, photo, closesAt, etaWarning, onClose, onSubmitted }: {
  lot: AuctionLot | null;
  physio: boolean;
  photo?: string | null;
  closesAt: string;
  /** One red line from the ETA check ("10:30 AM with Karan Mehta: about 1 hr by road, you would have 30 min."); null when travel is fine. */
  etaWarning?: string | null;
  onClose: () => void;
  onSubmitted?: (r: BidResult) => void;
}) {
  const visible = !!lot;
  const quizQ = useAuctionQuiz(lot?.client_id ?? null, lot?.auction_date ?? '');
  const submitM = useSubmitEssentialsBid();
  const [answers, setAnswers] = React.useState<number[]>([]);
  const [picked, setPicked] = React.useState<number | null>(null);
  const [result, setResult] = React.useState<BidResult | null>(null);
  const [photoFailed, setPhotoFailed] = React.useState(false);
  const pop = React.useRef(new Animated.Value(0)).current;
  // Fresh state for every session.
  React.useEffect(() => { setAnswers([]); setPicked(null); setResult(null); setPhotoFailed(false); submitM.reset(); }, [lot?.client_id, lot?.slot_time]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (!visible) { pop.setValue(0); return; }
    Animated.spring(pop, { toValue: 1, friction: 7, tension: 110, useNativeDriver: true }).start();
  }, [visible, pop]);

  const quiz = quizQ.data ?? null;
  const questions = quiz?.questions ?? [];
  const total = questions.length;
  const idx = answers.length;
  const current = questions[idx];
  const done = total > 0 && idx >= total;
  const blocked = quiz?.blocked ?? null;
  const noQuestions = !!quiz && !blocked && !quiz.already_bid && quiz.question_count === 0;
  const midway = idx > 0 && !done && !result;

  const attemptClose = () => {
    if (submitM.isPending) return;
    if (midway) {
      Alert.alert('Leave the questions?', 'Leave now and your answers so far are lost.', [
        { text: 'Stay', style: 'cancel' },
        { text: 'Leave', style: 'destructive', onPress: onClose },
      ]);
      return;
    }
    onClose();
  };

  const lockIn = () => {
    if (picked == null) return;
    Haptics.selectionAsync().catch(() => {});
    setAnswers((a) => [...a, picked]);
    setPicked(null);
  };

  const canSend = !!lot && !!quiz && !blocked && !quiz.already_bid && (quiz.question_count === 0 || done) && !submitM.isPending;
  const send = async () => {
    if (!lot || !canSend) return;
    try {
      const r = await submitM.mutateAsync({ clientId: lot.client_id, answers: quiz!.question_count === 0 ? [] : answers });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setResult(r);
      onSubmitted?.(r);
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      /* the sentence shows under the button */
    }
  };

  const noun = physio ? 'rehab session' : 'training';
  const title = lot ? `${lot.client_name} · ${lot.modality || 'Training'} · ${formatLotDate(lot.auction_date)} at ${formatTime12(lot.slot_time)}` : '';
  const sendError = submitM.isError ? (submitM.error as Error).message : null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={attemptClose}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 18 }}>
        <Pressable onPress={attemptClose} accessibilityLabel="Close" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.74)' }} />
        {lot ? (
          <Animated.View style={{ width: '100%', maxWidth: 440, maxHeight: '92%', borderRadius: 26, overflow: 'hidden', backgroundColor: BG, borderWidth: 1, borderColor: hexA(C.gold, 0.4), opacity: pop, transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }] }}>
            <ScrollView bounces={false} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {/* Header band */}
              <LinearGradient colors={INDIGO} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: 18, paddingBottom: 16 }}>
                <View pointerEvents="none" style={{ position: 'absolute', right: -36, top: -36, width: 140, height: 140, borderRadius: 70, backgroundColor: hexA(C.gold, 0.12) }} />
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <LinearGradient colors={GOLD_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="gavel" size={22} color="#1A1200" strokeWidth={2.2} />
                  </LinearGradient>
                  <View style={{ flex: 1 }}>
                    <Mono style={{ fontSize: 8.5, letterSpacing: 1.6, color: C.gold }}>ANSWER AND BID</Mono>
                    <Serif numberOfLines={2} style={{ fontSize: 17, lineHeight: 21, marginTop: 2 }}>{title}</Serif>
                  </View>
                  <Pressable onPress={attemptClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close" style={{ width: 32, height: 32, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="close" size={15} color={C.ink3} strokeWidth={2.3} />
                  </Pressable>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 12 }}>
                  {photo && !photoFailed ? (
                    <Image source={{ uri: photo }} onError={() => setPhotoFailed(true)} style={{ width: 34, height: 34, borderRadius: 11, borderWidth: 1, borderColor: hexA(C.gold, 0.6) }} resizeMode="cover" />
                  ) : <MiniAvatar initial={initials(lot.client_name)} colors={['#7C8FE8', '#9A7BEA']} size={34} />}
                  <Body style={{ flex: 1, fontSize: 11.5, color: C.ink3, lineHeight: 15 }}>
                    One attempt on this {noun}: five questions about {lot.client_name.split(' ')[0]}, 1 point each. Answer all five correctly before anyone else and the {noun} is yours at once. Otherwise highest points wins at {closesAt}; equal points, the earlier bid.
                  </Body>
                </View>
              </LinearGradient>

              <View style={{ padding: 16, gap: 12 }}>
                {etaWarning && !result ? (
                  <View style={{ gap: 4, padding: 11, borderRadius: 14, backgroundColor: hexA(C.red, 0.1), borderWidth: 1, borderColor: hexA(C.red, 0.5) }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Icon name="alert" size={13} color={C.red} strokeWidth={2.4} />
                      <Mono style={{ fontSize: 8.5, letterSpacing: 1.2, color: C.red }}>TIGHT TRAVEL IF YOU WIN</Mono>
                    </View>
                    <Body style={{ fontSize: 12, color: '#fff', lineHeight: 17 }}>{etaWarning}</Body>
                  </View>
                ) : null}

                {quizQ.isPending ? (
                  <View style={{ gap: 10 }}>
                    {[0.75, 1, 1, 1].map((w, i) => <View key={i} style={{ height: i === 0 ? 18 : 46, width: `${w * 100}%`, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.06)' }} />)}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
                      <ActivityIndicator size="small" color={C.gold} />
                      <Body style={{ fontSize: 11.5, color: C.muted3 }}>Fetching the questions…</Body>
                    </View>
                  </View>
                ) : quizQ.isError ? (
                  <Note text={(quizQ.error as Error).message} tone="red" />
                ) : result ? (
                  <BidDone result={result} closesAt={closesAt} onClose={onClose} />
                ) : blocked ? (
                  <Note text={blocked} />
                ) : quiz?.already_bid ? (
                  <Note text={`You already answered for this session: ${pointsText(quiz.my_bid?.points ?? 0, quiz.question_count)} correct. The result comes at ${closesAt}.`} />
                ) : noQuestions ? (
                  <View style={{ gap: 10 }}>
                    <Note text={`No questions are on file for ${lot.client_name} yet, so this session goes to the earliest bid. Place yours now.`} />
                    <GoldButton label={submitM.isPending ? 'Placing your bid…' : 'Place my bid'} busy={submitM.isPending} onPress={send} />
                    {sendError ? <Body style={{ fontSize: 12, color: C.red, lineHeight: 17 }}>{sendError}</Body> : null}
                  </View>
                ) : done ? (
                  <View style={{ gap: 10 }}>
                    <Note text={`All ${total} answered. Submit to place your bid; it cannot be changed afterwards.`} />
                    <GoldButton label={submitM.isPending ? 'Placing your bid…' : 'Submit my answers'} busy={submitM.isPending} onPress={send} />
                    {sendError ? <Body style={{ fontSize: 12, color: C.red, lineHeight: 17 }}>{sendError}</Body> : null}
                  </View>
                ) : current ? (
                  <View style={{ gap: 12 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Mono style={{ flex: 1, fontSize: 8.5, letterSpacing: 1.2, color: C.gold }}>
                        QUESTION {idx + 1} OF {total} · {current.source === 'weekly' ? "THIS WEEK'S TRAINING" : 'HEALTH CONTEXT'}
                      </Mono>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <Icon name="lock" size={10} color={C.muted3} strokeWidth={2.3} />
                        <Mono style={{ fontSize: 7.5, letterSpacing: 0.8, color: C.muted3 }}>ONE ATTEMPT EACH</Mono>
                      </View>
                    </View>
                    <View style={{ height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                      <View style={{ width: `${(idx / total) * 100}%`, height: 4, backgroundColor: C.gold }} />
                    </View>
                    <Body style={{ fontSize: 15.5, fontFamily: F.bodySemi, color: '#fff', lineHeight: 22 }}>{current.question}</Body>
                    <View style={{ gap: 7 }} accessibilityRole="radiogroup">
                      {current.options.map((opt, i) => {
                        const on = picked === i;
                        return (
                          <Pressable key={i} onPress={() => setPicked(i)} hitSlop={4} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={`${LETTERS[i] ?? i + 1}: ${opt}`}
                            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 11, paddingHorizontal: 12, borderRadius: 14, backgroundColor: on ? hexA(C.gold, 0.12) : pressed ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: on ? hexA(C.gold, 0.7) : 'rgba(255,255,255,0.1)' })}>
                            <View style={{ width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? C.gold : 'transparent', borderWidth: 1, borderColor: on ? C.gold : 'rgba(255,255,255,0.25)' }}>
                              <Text style={{ fontFamily: F.bodyBold, fontSize: 11.5, color: on ? '#1A1200' : C.ink3 }}>{LETTERS[i] ?? String(i + 1)}</Text>
                            </View>
                            <Body style={{ flex: 1, fontSize: 13.5, color: on ? '#fff' : C.ink3, lineHeight: 19 }}>{opt}</Body>
                          </Pressable>
                        );
                      })}
                    </View>
                    <DarkButton label={idx + 1 === total ? 'Lock the last answer' : 'Lock answer and continue'} disabled={picked == null} onPress={lockIn} />
                    <Body style={{ fontSize: 10.5, color: C.muted3, textAlign: 'center', lineHeight: 15 }}>A locked answer cannot be changed. A perfect score wins on the spot; otherwise highest points wins at the close, equal points the earlier bid.</Body>
                  </View>
                ) : (
                  <Note text="No questions came back for this session. Pull to refresh the auction and try again." />
                )}
              </View>
            </ScrollView>
          </Animated.View>
        ) : null}
      </View>
    </Modal>
  );
}
