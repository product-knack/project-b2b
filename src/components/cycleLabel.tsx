import React from 'react';
import { View, Text, Pressable, ScrollView, Modal, Animated, Easing, AccessibilityInfo } from 'react-native';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Body, Mono } from './primitives';
import { ReplayMask } from './ReplayShield';
import type { ClientCycle } from '../lib/cycleQueries';
import { CycleStatus, cycleChipText, cycleStatusLine, nextPeriodLine, feelDayLabel, cycleGuidance, CYCLE_ALWAYS } from '../lib/cycleStatus';

/* ============ Cycle phase label (25 Sep 2026) ============
   Chip on a client row (My Crew plan cards + compose sheet, trainer Today's
   Roster) and the popup it opens. Data: useClientCycleStatus (cycleQueries.ts).
   Both are wrapped in ReplayMask so the label never reaches session replay,
   including on the unshielded trainer dashboard. */

const PINK = '#F06A9B';
export function cycleColor(s: CycleStatus): string {
  if (s.state === 'paused') return C.muted2;
  if (s.state === 'late') return C.red;
  return s.phase === 'menstrual' ? PINK : s.phase === 'follicular' ? C.green : s.phase === 'ovulation' ? C.gold : C.purple;
}

/* Animated so it is spotted at a glance (user request 25 Sep 2026): the chip
   breathes (a soft glow behind it) and its dot sends out a ripple, on a 1.8 s
   loop. Native-driver opacity / scale only, so many chips on one list stay
   cheap. "Not tracking" stays still, and so does everything when the phone's
   Reduce motion setting is on. */
export function CycleChip({ cycle, onPress }: { cycle: ClientCycle; onPress: () => void }) {
  const col = cycleColor(cycle.status);
  const animate = cycle.status.state !== 'paused';
  const pulse = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    if (!animate) return;
    let loop: Animated.CompositeAnimation | null = null;
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduce) => {
        if (cancelled || reduce) return;
        loop = Animated.loop(Animated.sequence([
          Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ]));
        loop.start();
      })
      .catch(() => {});
    return () => { cancelled = true; loop?.stop(); };
  }, [animate]);
  return (
    <ReplayMask>
      <Pressable
        hitSlop={10}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`Cycle: ${cycleStatusLine(cycle.status)}`}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 999, backgroundColor: hexA(col, 0.12), borderWidth: 1, borderColor: hexA(col, 0.5), overflow: 'hidden' }}
      >
        {/* breathing glow */}
        {animate ? (
          <Animated.View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: col, opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0, 0.22] }) }} />
        ) : null}
        {/* dot + ripple */}
        <View style={{ width: 8, height: 8, alignItems: 'center', justifyContent: 'center' }}>
          {animate ? (
            <Animated.View pointerEvents="none" style={{ position: 'absolute', width: 8, height: 8, borderRadius: 4, backgroundColor: col, opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }), transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.2] }) }] }} />
          ) : null}
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: col }} />
        </View>
        <Mono style={{ fontSize: 8, letterSpacing: 0.5, color: col }}>{cycleChipText(cycle.status)}</Mono>
      </Pressable>
    </ReplayMask>
  );
}

export type CyclePopupInfo = { name: string; cycle: ClientCycle } | null;

export function CyclePopup({ info, onClose }: { info: CyclePopupInfo; onClose: () => void }) {
  const s = info?.cycle.status;
  const col = s ? cycleColor(s) : PINK;
  const next = s ? nextPeriodLine(s) : null;
  const feel = info?.cycle.feel ?? [];
  return (
    <Modal visible={!!info} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'center', padding: 22 }}>
        <Pressable onPress={onClose} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.72)' }} />
        {info && s ? (
          <ReplayMask style={{ maxHeight: '86%' }}>
            <View style={{ borderRadius: 18, backgroundColor: '#12100E', borderWidth: 1, borderColor: hexA(col, 0.4), padding: 15, gap: 12, flexShrink: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: hexA(col, 0.14), borderWidth: 1, borderColor: hexA(col, 0.4), alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="heart" size={15} color={col} strokeWidth={2} />
                </View>
                <View style={{ flex: 1 }}>
                  <Body style={{ fontSize: 15, fontFamily: F.bodySemi, color: '#fff' }} numberOfLines={1}>{info.name}</Body>
                  <Mono style={{ fontSize: 8.5, letterSpacing: 0.8, color: col, marginTop: 2 }}>CYCLE · {cycleChipText(s)}</Mono>
                </View>
                <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close" style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="close" size={13} color={C.muted} strokeWidth={2.3} />
                </Pressable>
              </View>

              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
                {/* Status + next period */}
                <View style={{ padding: 12, borderRadius: 13, backgroundColor: hexA(col, 0.08), borderWidth: 1, borderColor: hexA(col, 0.25), gap: 6 }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 16, color: '#fff' }}>{cycleStatusLine(s)}</Text>
                  {next ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Icon name="calendar" size={12} color={C.muted2} strokeWidth={2} />
                      <Body style={{ flex: 1, fontSize: 12, color: C.ink3 }}>Next period: {next}</Body>
                    </View>
                  ) : null}
                  {s.endDateMissing ? (
                    <Body style={{ fontSize: 11.5, color: C.gold, lineHeight: 16 }}>Her last period's end date isn't logged, so today's phase is an estimate.</Body>
                  ) : null}
                  <Mono style={{ fontSize: 8, letterSpacing: 0.5, color: C.muted3 }}>
                    AVG CYCLE {s.avgCycle} DAYS · AVG PERIOD {s.avgPeriod} DAYS · {s.countedCycles} CYCLE{s.countedCycles === 1 ? '' : 'S'} COUNTED
                  </Mono>
                </View>

                {/* How she feels, last 3 days */}
                <View style={{ gap: 7 }}>
                  <Mono style={{ fontSize: 8.5, letterSpacing: 0.8, color: C.muted3 }}>HOW SHE FEELS · LAST 3 DAYS</Mono>
                  {feel.length === 0 ? (
                    <Body style={{ fontSize: 12, color: C.muted2 }}>Nothing logged in the last 3 days.</Body>
                  ) : feel.map((f) => (
                    <View key={f.date} style={{ padding: 10, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', gap: 6 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Body style={{ flex: 1, fontSize: 12.5, fontFamily: F.bodySemi, color: '#fff' }}>{feelDayLabel(f.date, info.cycle.today)}</Body>
                        {f.energy != null ? (
                          <Text style={{ fontFamily: F.bodySemi, fontSize: 11.5, color: f.energy <= 2 ? C.red : f.energy === 3 ? C.gold : C.green }}>Energy {f.energy}/5</Text>
                        ) : null}
                      </View>
                      {f.symptoms.length ? (
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
                          {f.symptoms.map((sym) => (
                            <View key={sym} style={{ paddingVertical: 2.5, paddingHorizontal: 8, borderRadius: 999, backgroundColor: hexA(PINK, 0.1), borderWidth: 1, borderColor: hexA(PINK, 0.3) }}>
                              <Text style={{ fontFamily: F.bodySemi, fontSize: 10, color: PINK }}>{sym}</Text>
                            </View>
                          ))}
                        </View>
                      ) : null}
                    </View>
                  ))}
                </View>

                {/* Training today */}
                <View style={{ gap: 7 }}>
                  <Mono style={{ fontSize: 8.5, letterSpacing: 0.8, color: C.muted3 }}>TRAINING TODAY</Mono>
                  {cycleGuidance(s).map((g, i) => (
                    <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                      <View style={{ marginTop: 7, width: 5, height: 5, borderRadius: 3, backgroundColor: col }} />
                      <Body style={{ flex: 1, fontSize: 12.5, lineHeight: 18, color: C.ink2 }}>{g}</Body>
                    </View>
                  ))}
                </View>

                <View style={{ padding: 10, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }}>
                  <Body style={{ fontSize: 11.5, lineHeight: 17, color: C.muted2 }}>{CYCLE_ALWAYS}</Body>
                </View>
              </ScrollView>
            </View>
          </ReplayMask>
        ) : null}
      </View>
    </Modal>
  );
}
