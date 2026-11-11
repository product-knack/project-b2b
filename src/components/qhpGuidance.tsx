import React from 'react';
import { View, Text, Pressable, Modal, ScrollView, ActivityIndicator } from 'react-native';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono, Card } from './primitives';
import { SessionHandoffPopup } from './sessionHandoff';
import { useClientQhpGuidance, useAckQhpGuidance, qhpDayLabel, type ClientQhpGuidance } from '../lib/qhpGuidanceQueries';
import {
  REHAB_STATUS_LABEL, REHAB_TYPE_LABEL, rehabAreaLabel, rehabPainText, rehabProgress, rehabReferralText,
  type RecoveryRehabEntry, type RehabTrend,
} from '../lib/recoveryRehab';

/* ============================================================================
   The trainer's side of the QHP's "Recommendations for trainers" and recovery
   and rehab entries (11 Nov 2026). Same content and rules as the web
   (hub-track src/components/trainer/QhpGuidance.tsx):
   - QhpGuidanceCard: on the trainer's Client Detail page, always readable.
   - QhpGuidancePopup: opens once per trainer per QHP; "I have read this" saves
     the acknowledgement. Nothing to read, already read, offline or a failed
     lookup: it steps aside without showing.
   - ClientEntryPopups: the notes popup first, then the Session Handoff popup.
     One after the other, never two modals open together.
   ========================================================================== */

const TREND_TINT: Record<RehabTrend, string> = { better: C.green, resolved: C.green, worse: C.red, same: C.muted2, new: C.blue };

function RehabLine({ e }: { e: RecoveryRehabEntry }) {
  const progress = rehabProgress(e);
  const facts = [rehabPainText(e.intensity), e.type ? REHAB_TYPE_LABEL[e.type] : '', e.status ? REHAB_STATUS_LABEL[e.status] : ''].filter(Boolean).join(' · ');
  const referral = e.referral && e.referral !== 'none' ? rehabReferralText(e) : '';
  const rec = e.recommendation.trim();
  return (
    <View style={{ borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.28)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', padding: 12, gap: 5 }}>
      <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: '#fff' }}>{rehabAreaLabel(e)}</Text>
      {facts ? <Body style={{ fontSize: 11.5, color: C.muted }}>{facts}</Body> : null}
      {rec ? <Body style={{ fontSize: 12.5, color: C.ink, lineHeight: 19 }}>{rec}</Body> : null}
      {referral ? <Body style={{ fontSize: 11.5, color: C.muted }}>Referred to: {referral}</Body> : null}
      <Body style={{ fontSize: 11.5, color: TREND_TINT[progress.trend] }}>{progress.line}</Body>
    </View>
  );
}

export function QhpGuidanceBody({ guidance }: { guidance: ClientQhpGuidance }) {
  return (
    <View style={{ gap: 13 }}>
      {guidance.rehab.length > 0 ? (
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
            <Icon name="heart" size={14} color={C.red} strokeWidth={2} />
            <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: '#fff' }}>Recovery and rehab</Text>
          </View>
          {guidance.rehab.map((e) => <RehabLine key={e.id} e={e} />)}
        </View>
      ) : null}
      {guidance.recommendations.length > 0 ? (
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
            <Icon name="clipboard" size={14} color={C.orange} strokeWidth={2} />
            <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: '#fff' }}>Recommendations for trainers</Text>
          </View>
          {guidance.recommendations.map((r, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
              <Mono style={{ fontSize: 11.5, color: C.orange, width: 18, marginTop: 2 }}>{i + 1}.</Mono>
              <Body style={{ flex: 1, fontSize: 12.5, color: C.ink, lineHeight: 19 }}>{r}</Body>
            </View>
          ))}
        </View>
      ) : null}
      {guidance.resolved.length > 0 ? (
        <Body style={{ fontSize: 11.5, color: C.muted }}>Resolved at this QHP: {guidance.resolved.map((e) => rehabAreaLabel(e)).join(', ')}.</Body>
      ) : null}
    </View>
  );
}

const sourceLine = (g: ClientQhpGuidance) => `From the QHP${g.day ? ` of ${qhpDayLabel(g.day)}` : ''}${g.assessorName ? `, by ${g.assessorName}` : ''}.`;

function ReadButton({ busy, onPress }: { busy: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      hitSlop={10}
      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 13, borderRadius: 14, backgroundColor: hexA(C.orange, 0.16), borderWidth: 1, borderColor: hexA(C.orange, 0.5), opacity: busy ? 0.7 : 1 }}
    >
      {busy ? <ActivityIndicator size="small" color={C.orange} /> : null}
      <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: C.orange }}>{busy ? 'Saving' : 'I have read this'}</Text>
    </Pressable>
  );
}

/** Client Detail page. Renders nothing when the latest QHP has nothing for trainers. */
export function QhpGuidanceCard({ clientId }: { clientId: string | null }) {
  const { data: g } = useClientQhpGuidance(clientId);
  const ack = useAckQhpGuidance(clientId);
  const [failed, setFailed] = React.useState(false);
  if (!g) return null;
  return (
    <Card style={{ padding: 16, gap: 12 }} border={hexA(C.orange, 0.28)}>
      <View style={{ gap: 4 }}>
        <Serif style={{ fontSize: 17 }}>Recovery notes and recommendations</Serif>
        <Body style={{ fontSize: 11.5, color: C.muted, lineHeight: 17 }}>{sourceLine(g)} Plan this client's sessions around these points.</Body>
      </View>
      <QhpGuidanceBody guidance={g} />
      {g.acknowledgedAt ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon name="checks" size={13} color={C.green} strokeWidth={2.2} />
          <Body style={{ fontSize: 11.5, color: C.green }}>You marked this as read.</Body>
        </View>
      ) : (
        <>
          <ReadButton
            busy={ack.isPending}
            onPress={() => { setFailed(false); ack.mutate(g.assessmentId, { onError: () => setFailed(true) }); }}
          />
          {failed ? <Body style={{ fontSize: 11.5, color: C.red }}>Could not save. Check your connection and try again.</Body> : null}
        </>
      )}
    </Card>
  );
}

/** Opens once per trainer per QHP. Calls onDone exactly once: at once when there is nothing unread, else after
    "I have read this". A lookup still running after `maxWaitMs` (slow network) steps aside too, so nothing the
    trainer tapped is held up; the notes then show the next time. */
export function QhpGuidancePopup({ clientId, onDone, maxWaitMs = 4000 }: { clientId: string | null; onDone: () => void; maxWaitMs?: number }) {
  const { data: g, isLoading, isError } = useClientQhpGuidance(clientId);
  const ack = useAckQhpGuidance(clientId);
  const [done, setDone] = React.useState(false);
  const finished = React.useRef(false);
  const unread = !!g && !g.acknowledgedAt;

  const finish = React.useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    setDone(true);
    onDone();
  }, [onDone]);

  React.useEffect(() => {
    if (done || isLoading) return;
    if (isError || !unread) finish();
  }, [done, isLoading, isError, unread, finish]);

  // Bounded wait while the lookup is still loading.
  React.useEffect(() => {
    if (done || !isLoading) return;
    const t = setTimeout(finish, maxWaitMs);
    return () => clearTimeout(t);
  }, [done, isLoading, maxWaitMs, finish]);

  if (done || isLoading || !g || !unread) return null;

  const confirm = () => {
    if (ack.isPending) return;
    // Closes even when the save fails: the trainer has read it, and it is shown again next time.
    ack.mutate(g.assessmentId, { onSettled: finish });
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => {}}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <View style={{ width: '100%', maxWidth: 400, maxHeight: '86%', backgroundColor: '#12100E', borderWidth: 1, borderColor: hexA(C.orange, 0.26), borderRadius: 22, overflow: 'hidden' }}>
          <View style={{ height: 3, backgroundColor: hexA(C.orange, 0.6) }} />
          <ScrollView contentContainerStyle={{ padding: 18, gap: 14 }} showsVerticalScrollIndicator={false}>
            <View style={{ gap: 6 }}>
              <View style={{ alignSelf: 'flex-start', paddingVertical: 3, paddingHorizontal: 10, borderRadius: 999, backgroundColor: hexA(C.orange, 0.1), borderWidth: 1, borderColor: hexA(C.orange, 0.35) }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 9.5, letterSpacing: 0.7, color: C.orange }}>FROM THE QHP</Text>
              </View>
              <Serif style={{ fontSize: 20 }}>Recovery notes and recommendations</Serif>
              <Body style={{ fontSize: 12, color: C.muted, lineHeight: 18 }}>{sourceLine(g)} Read these before the session.</Body>
            </View>
            <QhpGuidanceBody guidance={g} />
            <ReadButton busy={ack.isPending} onPress={confirm} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/** Trainer Client Detail: the QHP notes popup first, then the Session Handoff popup. Mount with key={clientId}. */
export function ClientEntryPopups({ clientId }: { clientId: string | null }) {
  const [notesDone, setNotesDone] = React.useState(false);
  const onDone = React.useCallback(() => setNotesDone(true), []);
  if (!notesDone) return <QhpGuidancePopup clientId={clientId} onDone={onDone} />;
  return <SessionHandoffPopup clientId={clientId} />;
}
