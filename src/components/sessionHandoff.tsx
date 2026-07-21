import React from 'react';
import { View, Text, Pressable, Modal, ScrollView, ActivityIndicator } from 'react-native';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono } from './primitives';
import { usePreviousTrainerSession, useAckSessionSummary } from '../lib/clientQueries';

/* ============================================================================
   Session Handoff Summary popup — ported from the web PreviousTrainerSession.
   Auto-opens on the trainer's Client Detail page when the hook says there is a
   handoff to review (trainer change and/or doctor session). HARD modal: no
   outside-tap or back-button dismiss — the trainer must tick the checkbox and
   press "OK, Got It", which inserts the event_acknowledgement row that keeps
   the popup closed for the rest of the IST day.
   ========================================================================== */

const CHECK_PATH = 'M20 6 9 17l-5-5';

const titleCase = (t: string) => t.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
const fmtDate = (v: string | null | undefined, fallback = '—') => {
  if (!v) return fallback;
  const d = new Date(v);
  if (isNaN(d.getTime())) return fallback;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

export function SessionHandoffPopup({ clientId }: { clientId: string | null }) {
  const { data, isLoading } = usePreviousTrainerSession(clientId);
  const ack = useAckSessionSummary();
  const [open, setOpen] = React.useState(false);
  const [checked, setChecked] = React.useState(false);

  React.useEffect(() => {
    if (!isLoading && data?.showPreviousSession && data.previousSession) setOpen(true);
  }, [isLoading, data]);
  React.useEffect(() => { setChecked(false); }, [clientId]);

  if (isLoading || !data?.showPreviousSession || !data.previousSession) return null;
  const ps = data.previousSession;
  const doc = ps.lastDoctorSession;

  const submit = () => {
    if (!checked || ack.isPending || !clientId) return;
    // Close even if the insert fails (web parity) — the ack is best-effort.
    ack.mutate({ clientId }, { onSettled: () => setOpen(false) });
  };

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => {}}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <View style={{ width: '100%', maxWidth: 400, maxHeight: '86%', backgroundColor: '#12100E', borderWidth: 1, borderColor: hexA(C.gold, 0.24), borderRadius: 22, overflow: 'hidden' }}>
          <View style={{ height: 3, backgroundColor: hexA(C.gold, 0.55) }} />
          <ScrollView contentContainerStyle={{ padding: 18, gap: 13 }} showsVerticalScrollIndicator={false}>
            {/* Header */}
            <View style={{ gap: 8 }}>
              <View style={{ alignSelf: 'flex-start', paddingVertical: 3, paddingHorizontal: 10, borderRadius: 999, backgroundColor: hexA(C.gold, 0.1), borderWidth: 1, borderColor: hexA(C.gold, 0.35) }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 9.5, letterSpacing: 0.7, color: C.gold }}>PREVIOUS TRAINER'S SESSION</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Icon name="sparkle" size={17} color={C.gold} strokeWidth={1.9} />
                <Serif style={{ fontSize: 20, flex: 1 }}>Session Handoff Summary</Serif>
              </View>
              {ps.trainerName ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    <Icon name="calendar" size={12} color={C.muted3} strokeWidth={1.9} />
                    <Mono style={{ fontSize: 10, color: C.muted2 }}>{fmtDate(ps.sessionDate, 'Unknown date')}</Mono>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    <Icon name="user" size={12} color={C.muted3} strokeWidth={1.9} />
                    <Mono style={{ fontSize: 10, color: C.muted2 }}>{ps.trainerName}</Mono>
                  </View>
                </View>
              ) : null}
            </View>

            {/* Doctor / physio block */}
            <View style={{ gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Icon name="activity" size={15} color={C.purple} strokeWidth={2} />
                <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: '#fff', flex: 1 }}>Last Doctor/Physio Session</Text>
                {doc?.sessionDate ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 3, paddingHorizontal: 9, borderRadius: 999, backgroundColor: hexA(C.purple, 0.13), borderWidth: 1, borderColor: hexA(C.purple, 0.35) }}>
                    <Icon name="calendar" size={10} color={C.purple} strokeWidth={2} />
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 10, color: C.purple }}>{fmtDate(doc.sessionDate)}</Text>
                  </View>
                ) : null}
              </View>
              {doc ? (
                <View style={{ borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.28)', borderWidth: 1, borderColor: hexA(C.purple, 0.2), padding: 13, gap: 7 }}>
                  {doc.doctorName ? (
                    <Body style={{ fontSize: 12.5, color: C.ink3 }}>
                      <Text style={{ fontFamily: F.bodySemi, color: '#fff' }}>Doctor:</Text> {doc.doctorName}
                    </Body>
                  ) : null}
                  {doc.sessionTypes?.length ? (
                    <Body style={{ fontSize: 12.5, color: C.ink3, lineHeight: 18 }}>
                      <Text style={{ fontFamily: F.bodySemi, color: '#fff' }}>Treatment:</Text> {doc.sessionTypes.map(titleCase).join(', ')}
                    </Body>
                  ) : null}
                  {ps.doctorSummary ? (
                    <Body style={{ fontSize: 12.5, color: C.ink3, lineHeight: 19, paddingTop: 7, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.07)' }}>{ps.doctorSummary}</Body>
                  ) : doc.notes ? (
                    <Body style={{ fontSize: 12.5, color: C.ink3, lineHeight: 19, paddingTop: 7, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.07)' }}>
                      <Text style={{ fontFamily: F.bodySemi, color: '#fff' }}>Notes:</Text> {doc.notes}
                    </Body>
                  ) : null}
                </View>
              ) : (
                <View style={{ borderRadius: 14, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.12)', padding: 14 }}>
                  <Body style={{ fontSize: 12.5, color: C.muted3, fontStyle: 'italic' }}>No physio / rehab / recovery session yet.</Body>
                </View>
              )}
            </View>

            {/* Trainer handoff AI summary */}
            {ps.aiSummary ? (
              <View style={{ gap: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Icon name="sparkle" size={15} color={C.gold} strokeWidth={2} />
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: '#fff' }}>Previous Trainer Handoff</Text>
                </View>
                <View style={{ borderRadius: 14, backgroundColor: hexA(C.gold, 0.05), borderWidth: 1, borderColor: hexA(C.gold, 0.2), padding: 13 }}>
                  <Body style={{ fontSize: 12.5, color: C.ink3, lineHeight: 19 }}>{ps.aiSummary}</Body>
                </View>
              </View>
            ) : null}

            {/* Mandatory acknowledgement */}
            <Pressable
              onPress={() => setChecked((v) => !v)}
              style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: checked ? hexA(C.green, 0.4) : 'rgba(255,255,255,0.1)' }}
            >
              <View style={{ width: 21, height: 21, borderRadius: 6, marginTop: 1, backgroundColor: checked ? C.green : 'transparent', borderWidth: 1.5, borderColor: checked ? C.green : 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center' }}>
                {checked ? <Icon path={CHECK_PATH} size={13} color="#0B0908" strokeWidth={3} /> : null}
              </View>
              <Body style={{ flex: 1, fontSize: 12.5, color: checked ? '#fff' : C.ink3, lineHeight: 18 }}>
                I acknowledge that I have reviewed this session summary.
              </Body>
            </Pressable>

            <Pressable
              onPress={submit}
              disabled={!checked || ack.isPending}
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 13, borderRadius: 14, backgroundColor: checked ? hexA(C.gold, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: checked ? hexA(C.gold, 0.45) : 'rgba(255,255,255,0.08)', opacity: ack.isPending ? 0.7 : 1 }}
            >
              {ack.isPending ? <ActivityIndicator size="small" color={C.gold} /> : null}
              <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: checked ? C.gold : C.muted3 }}>
                {ack.isPending ? 'Saving…' : 'OK, Got It'}
              </Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
