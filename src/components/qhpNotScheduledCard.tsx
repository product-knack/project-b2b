/* "N QHPs are not scheduled yet": the alert card of whoever holds the QHP manager switch (20 Nov 2026).
   Owner: "when it has any QHP which is not scheduled yet, from today 7 am, show its notification alert."
   The app copy of the web card (hub-track src/components/notifications/QHPNotScheduledAlert.tsx): the same rule
   (lib/qhpNotScheduled.ts, the web file byte for byte), the same four requests (useQhpNotScheduledAlert), the
   same words. The client waiting longest first, five rows at most, each with the SLA chip (3 working hours from
   the client card's creation, 07:00 to 22:00 India time) and how long it has waited. Both buttons open QHP
   Manager on Task Pending. Draws nothing, and asks the server nothing, for an account without the switch.
   Mounted on the academy home and on the trainer dashboard, so every QHP manager sees the same card. */
import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Body, Mono } from './primitives';
import { useStore } from '../store';
import { useMyCapabilities } from '../lib/capabilities';
import { useQhpNotScheduledAlert, computeQhpSlaDeadline, formatSlaRemaining } from '../lib/qhpManagerQueries';
import { qhpNotScheduledTitle, waitingLabel } from '../lib/qhpNotScheduled';
import { qhpCardCreatedLabel, qhpNotScheduledMore, QHP_NOT_SCHEDULED_SUB } from '../lib/qhpManagerRules';

const SLA_COLOR = { red: C.red, amber: C.gold, green: C.green } as const;

export function QhpNotScheduledCard() {
  const caps = useMyCapabilities();
  const isMgr = caps.data.isQhpManager === true;
  const q = useQhpNotScheduledAlert(isMgr);
  const { set, go } = useStore();
  // The waiting time and the time left move on their own, without asking the server again.
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const waiting = q.data ?? [];
  // Gated on the switch as well as on the data: cached rows must never show the card to another account.
  if (!isMgr || waiting.length === 0) return null;

  const openTaskPending = () => { set({ qhpManagerFocusTab: 'task' }); go('qhp-manager'); };
  const top = waiting.slice(0, 5);
  const now = new Date();
  const ACC = C.blue;

  return (
    <View style={{ borderRadius: 16, overflow: 'hidden', borderWidth: 1.5, borderColor: hexA(ACC, 0.55) }}>
      <LinearGradient colors={[hexA(ACC, 0.16), 'rgba(18,16,22,0.6)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: 13, paddingLeft: 17, gap: 11 }}>
        <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, backgroundColor: ACC }} />

        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 11 }}>
          <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: hexA(ACC, 0.2), borderWidth: 1, borderColor: hexA(ACC, 0.5), alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="calPlus" size={17} color={ACC} strokeWidth={2.1} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 7 }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 14.5, color: '#fff' }}>{qhpNotScheduledTitle(waiting.length)}</Text>
              <View style={{ paddingVertical: 2, paddingHorizontal: 7, borderRadius: 999, backgroundColor: hexA(ACC, 0.22), borderWidth: 1, borderColor: hexA(ACC, 0.5) }}>
                <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: ACC }}>QHP MANAGER</Mono>
              </View>
            </View>
            <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 3 }}>{QHP_NOT_SCHEDULED_SUB}</Body>
          </View>
        </View>

        <View style={{ borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: hexA(ACC, 0.22), backgroundColor: 'rgba(0,0,0,0.25)' }}>
          {top.map((c, i) => {
            const sla = formatSlaRemaining(computeQhpSlaDeadline(c.created_at));
            const col = SLA_COLOR[sla.level];
            const name = `${c.first_name ?? ''} ${c.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || 'Client';
            return (
              <Pressable key={c.id} onPress={openTaskPending} accessibilityRole="button" accessibilityLabel={`Open Task Pending for ${name}`}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, paddingHorizontal: 11, borderTopWidth: i ? 1 : 0, borderTopColor: hexA(ACC, 0.14), opacity: pressed ? 0.8 : 1 })}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 7 }}>
                    <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: F.bodySemi, fontSize: 13.5, color: '#fff' }}>{name}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 2, paddingHorizontal: 7, borderRadius: 999, borderWidth: 1, borderColor: hexA(col, 0.55), backgroundColor: hexA(col, 0.12) }}>
                      <Icon name="clock" size={10} color={col} strokeWidth={2.3} />
                      <Text style={{ fontFamily: F.bodyBold, fontSize: 10, color: col }}>SLA: {sla.text}</Text>
                    </View>
                  </View>
                  <Body numberOfLines={2} style={{ fontSize: 10.5, color: C.muted2, marginTop: 2 }}>
                    Client card created {qhpCardCreatedLabel(c.created_at)} · waiting {waitingLabel(c.created_at, now)}
                  </Body>
                </View>
                <View style={{ paddingVertical: 6, paddingHorizontal: 11, borderRadius: 9, backgroundColor: hexA(ACC, 0.18), borderWidth: 1, borderColor: hexA(ACC, 0.45) }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: ACC }}>Open</Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <Body style={{ flex: 1, fontSize: 11, color: C.muted2 }}>{waiting.length > top.length ? qhpNotScheduledMore(waiting.length - top.length) : ''}</Body>
          <Pressable onPress={openTaskPending} hitSlop={10} accessibilityRole="button"
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10, backgroundColor: ACC, opacity: pressed ? 0.85 : 1 })}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: '#0C0A12' }}>Schedule now</Text>
            <Icon name="arrowRight" size={13} color="#0C0A12" strokeWidth={2.5} />
          </Pressable>
        </View>
      </LinearGradient>
    </View>
  );
}
