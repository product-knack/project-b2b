import React from 'react';
import { View, Text, Pressable, TextInput, Modal, Animated } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono } from '../components/primitives';
import { useAuth } from '../auth';
import { useStore } from '../store';
import { useMyCapabilities } from '../lib/capabilities';
import { useQhpReviewQueue, useHeldOwnReports, useResubmitReport, type HeldOwnRow } from '../lib/qhpReviewQueries';

/* ============ Dashboard alerts for the QHP review flow ============
   1. QhpReviewAlert  — reviewers (junior_researcher / hod): reports awaiting MY
      sign-off, with the top clients listed. Tap → QHP Report Review.
   2. HeldReportsAlert — report creators: my reports a reviewer put on hold, with
      the reviewer's note and a Resubmit action (rpc qhp_resubmit_report). */

function usePulse() {
  const pulse = React.useRef(new Animated.Value(0)).current;
  const enter = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    Animated.timing(enter, { toValue: 1, duration: 420, useNativeDriver: true }).start();
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 900, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse, enter]);
  return { pulse, enter };
}

/* ---------------- 1. Reviewer alert ---------------- */
export function QhpReviewAlert() {
  const caps = useMyCapabilities();
  const { go } = useStore();
  const canSenior = caps.data.juniorResearcher;
  const canHod = caps.data.isHod;
  const q = useQhpReviewQueue(canSenior || canHod);
  const { pulse, enter } = usePulse();
  if (!canSenior && !canHod) return null;

  const rows = q.data ?? [];
  const mine = rows.filter((r) => {
    if (r.held) return false;
    if (canSenior && !r.seniorSigned) return true;
    if (canHod && r.seniorSigned && !r.hodSigned) return true;
    return false;
  });
  if (!mine.length) return null;

  const glow = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.15, 0.8] });
  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] });
  const ringFade = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] });
  const roleLabel = canSenior && !canHod ? 'Senior Researcher' : canHod && !canSenior ? 'HOD' : 'Reviewer';
  const top = mine.slice(0, 3);

  return (
    <Animated.View style={{ opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [-10, 0] }) }] }}>
      <Pressable onPress={() => go('qhp-review')} style={{ borderRadius: 16, overflow: 'hidden' }}>
        <LinearGradient colors={['rgba(88,52,18,0.75)', 'rgba(34,20,12,0.85)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: 13, borderRadius: 16, borderWidth: 1, borderColor: hexA(C.gold, 0.45), gap: 10 }}>
          <Animated.View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: hexA(C.gold, 0.09), opacity: glow }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
              <Animated.View style={{ position: 'absolute', width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, borderColor: C.gold, opacity: ringFade, transform: [{ scale: ringScale }] }} />
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: hexA(C.gold, 0.16), borderWidth: 1, borderColor: hexA(C.gold, 0.5), alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="clipboard" size={16} color={C.gold} strokeWidth={2.1} />
              </View>
            </View>
            <View style={{ flex: 1 }}>
              <Body style={{ fontSize: 13, fontFamily: F.bodyBold, color: '#fff' }}>{mine.length} QHP report{mine.length === 1 ? '' : 's'} pending your sign-off</Body>
              <Body style={{ fontSize: 10.5, color: hexA('#F2C066', 0.9), marginTop: 1 }}>Clients are waiting — review and sign as {roleLabel}</Body>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, backgroundColor: hexA(C.gold, 0.16), borderWidth: 1, borderColor: hexA(C.gold, 0.45) }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: C.gold }}>Review & Sign</Text>
              <Icon name="chevRight" size={12} color={C.gold} strokeWidth={2.5} />
            </View>
          </View>
          <View style={{ borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: hexA(C.gold, 0.2) }}>
            {top.map((r, i) => (
              <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 11, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: 'rgba(255,255,255,0.05)' }}>
                <Icon name="file" size={12} color={C.gold} strokeWidth={2} />
                <Body numberOfLines={1} style={{ flex: 1, fontSize: 11.5, fontFamily: F.bodySemi, color: '#fff' }}>{r.clientName}</Body>
                <Mono style={{ fontSize: 8, color: C.muted3 }}>BY {r.creatorName.toUpperCase()}</Mono>
              </View>
            ))}
          </View>
          {mine.length > top.length ? <Mono style={{ fontSize: 8.5, color: hexA('#F2C066', 0.8), textAlign: 'right' }}>+{mine.length - top.length} MORE IN THE REVIEW QUEUE</Mono> : null}
        </LinearGradient>
      </Pressable>
    </Animated.View>
  );
}

/* ---------------- 2. Creator on-hold alert ---------------- */
export function ResubmitSheet({ row, onClose }: { row: HeldOwnRow; onClose: () => void }) {
  const m = useResubmitReport();
  const [msg, setMsg] = React.useState('');
  const [err, setErr] = React.useState<string | null>(null);
  const lastHold = [...row.notes].reverse().find((n) => n.type === 'hold' || n.type === 'hod_hold');
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 24 }}>
        <View style={{ backgroundColor: '#0E0A09', borderRadius: 22, borderWidth: 1, borderColor: 'rgba(255,150,90,0.18)', padding: 18, gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
            <Serif style={{ flex: 1, fontSize: 17 }}>Resubmit — {row.clientName}</Serif>
            <Pressable onPress={onClose} hitSlop={8}><Icon name="close" size={14} color={C.muted2} strokeWidth={2.3} /></Pressable>
          </View>
          {lastHold ? (
            <View style={{ padding: 10, borderRadius: 11, backgroundColor: hexA(C.gold, 0.07), borderLeftWidth: 3, borderLeftColor: C.gold, gap: 3 }}>
              <Mono style={{ fontSize: 8, letterSpacing: 0.6, color: C.gold }}>REVIEWER'S NOTE</Mono>
              <Body style={{ fontSize: 11.5, color: C.ink2, lineHeight: 16 }}>{lastHold.message}</Body>
            </View>
          ) : null}
          <Body style={{ fontSize: 10.5, color: C.muted2, lineHeight: 15 }}>Fix the report first (open the QHP and regenerate the PDF — it overwrites this same report), then describe what you changed.</Body>
          <TextInput value={msg} onChangeText={(v) => setMsg(v.slice(0, 500))} placeholder="What did you change?" placeholderTextColor={C.muted3} multiline style={{ minHeight: 70, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', padding: 11, color: '#fff', fontFamily: F.body, fontSize: 13, textAlignVertical: 'top' }} />
          {err ? <Body style={{ fontSize: 11, color: C.red }}>{err}</Body> : null}
          <Pressable
            onPress={() => { setErr(null); m.mutate({ id: row.id, message: msg.trim() }, { onSuccess: onClose, onError: (e: any) => setErr(e?.message ?? 'Failed to resubmit.') }); }}
            disabled={m.isPending || !msg.trim()}
            style={{ alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: hexA(C.green, !msg.trim() ? 0.06 : 0.15), borderWidth: 1, borderColor: hexA(C.green, !msg.trim() ? 0.2 : 0.5) }}
          >
            <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: !msg.trim() ? C.muted3 : C.green }}>{m.isPending ? 'Resubmitting…' : 'Resubmit to Senior Researcher'}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

export function HeldReportsAlert() {
  const { session } = useAuth();
  const caps = useMyCapabilities();
  const q = useHeldOwnReports(session?.user?.id ?? null, caps.data.qhpReportCreator);
  const { pulse, enter } = usePulse();
  const [resubmitFor, setResubmitFor] = React.useState<HeldOwnRow | null>(null);
  if (!caps.data.qhpReportCreator) return null;
  const rows = q.data ?? [];
  if (!rows.length) return null;

  const glow = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.12, 0.7] });
  const dotScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.5] });

  return (
    <Animated.View style={{ opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [-10, 0] }) }] }}>
      <LinearGradient colors={['rgba(84,26,20,0.8)', 'rgba(32,14,12,0.9)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: 13, borderRadius: 16, borderWidth: 1, borderColor: hexA(C.red, 0.45), gap: 10 }}>
        <Animated.View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: hexA(C.red, 0.08), opacity: glow, borderRadius: 16 }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: hexA(C.red, 0.16), borderWidth: 1, borderColor: hexA(C.red, 0.5), alignItems: 'center', justifyContent: 'center' }}>
            <Animated.View style={{ position: 'absolute', top: 5, right: 5, width: 7, height: 7, borderRadius: 4, backgroundColor: C.red, transform: [{ scale: dotScale }] }} />
            <Icon name="alert" size={16} color={C.red} strokeWidth={2.2} />
          </View>
          <View style={{ flex: 1 }}>
            <Body style={{ fontSize: 13, fontFamily: F.bodyBold, color: '#fff' }}>{rows.length} QHP report{rows.length === 1 ? '' : 's'} on hold — your action needed</Body>
            <Body style={{ fontSize: 10.5, color: hexA('#F5A9A0', 0.9), marginTop: 1 }}>A reviewer sent it back. Fix the report, then resubmit.</Body>
          </View>
        </View>
        <View style={{ borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: hexA(C.red, 0.2) }}>
          {rows.slice(0, 4).map((r, i) => {
            const lastHold = [...r.notes].reverse().find((n) => n.type === 'hold' || n.type === 'hod_hold');
            return (
              <View key={r.id} style={{ gap: 5, paddingVertical: 9, paddingHorizontal: 11, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: 'rgba(255,255,255,0.05)' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Body numberOfLines={1} style={{ flex: 1, fontSize: 12, fontFamily: F.bodySemi, color: '#fff' }}>{r.clientName}</Body>
                  <Pressable onPress={() => setResubmitFor(r)} style={{ paddingVertical: 5, paddingHorizontal: 11, borderRadius: 9, backgroundColor: hexA(C.red, 0.14), borderWidth: 1, borderColor: hexA(C.red, 0.45) }}>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 10.5, color: '#F5A9A0' }}>Review & Resubmit</Text>
                  </Pressable>
                </View>
                {lastHold ? <Body numberOfLines={2} style={{ fontSize: 10.5, color: C.muted2, lineHeight: 14 }}>"{lastHold.message}"</Body> : null}
                {r.heldAt ? <Mono style={{ fontSize: 7.5, color: C.muted3 }}>HELD {new Date(r.heldAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase()}</Mono> : null}
              </View>
            );
          })}
        </View>
        {rows.length > 4 ? <Mono style={{ fontSize: 8.5, color: hexA('#F5A9A0', 0.8), textAlign: 'right' }}>+{rows.length - 4} MORE ON HOLD</Mono> : null}
      </LinearGradient>
      {resubmitFor ? <ResubmitSheet row={resubmitFor} onClose={() => setResubmitFor(null)} /> : null}
    </Animated.View>
  );
}
