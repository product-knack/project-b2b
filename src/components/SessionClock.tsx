/* The visible session timer (22 Oct 2026, owner: "show the timer clock when we log a session; the trainer should
   see the timer we save in duration"). One row in the Add Workout form's sticky Submit bar:
   - running: a live clock since the stored start (health check-in Save, or the form entry), the start time and the
     minutes a submit now would save (the same rule as training_sessions.duration_minutes);
   - final: once the log is captured, the saved minutes with the start and end times (a queued log being edited
     shows the minutes stored in it).
   The clock ticks inside this component only, so the form itself never re-renders every second. Rules and
   formatting in src/lib/sessionTiming.ts. */
import React from 'react';
import { View, Text, AppState } from 'react-native';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Mono } from './primitives';
import { elapsedClock, minutesIfSubmitted, clockOf, minutesText } from '../lib/sessionTiming';

const TEAL = '#2DD4BF';

export function SessionClock({ startedAt, final }: {
  /** the running start (ISO); null when the timer has not started */
  startedAt: string | null;
  /** set once the log captured its timing (or a queued log carries one): the clock stops on these numbers */
  final: { started_at: string; ended_at: string; duration_minutes: number } | null;
}) {
  const [now, setNow] = React.useState(() => Date.now());
  const running = !!startedAt && !final;
  React.useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    // Back from the background: catch up at once instead of on the next tick.
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') setNow(Date.now()); });
    return () => { clearInterval(id); sub.remove(); };
  }, [running]);

  if (final) {
    const range = [clockOf(final.started_at), clockOf(final.ended_at)].filter(Boolean).join(' to ');
    return (
      <View accessible accessibilityLabel={`Session time ${minutesText(final.duration_minutes)}, saved as the duration`}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 10, paddingVertical: 8, paddingHorizontal: 11, borderRadius: 12, backgroundColor: hexA(C.green, 0.08), borderWidth: 1, borderColor: hexA(C.green, 0.3) }}>
        <Icon name="clock" size={14} color={C.green} strokeWidth={2.2} />
        <View style={{ flex: 1 }}>
          <Mono style={{ fontSize: 8.5, letterSpacing: 0.8, color: C.green }}>SESSION TIME · SAVED AS DURATION</Mono>
          {range ? <Mono style={{ fontSize: 8.5, color: C.muted2, marginTop: 2 }}>{range.toUpperCase()}</Mono> : null}
        </View>
        <Text style={{ fontFamily: F.bodyBold, fontSize: 17, color: C.green }}>{minutesText(final.duration_minutes)}</Text>
      </View>
    );
  }
  if (!startedAt) return null;
  const clock = elapsedClock(startedAt, now);
  const saves = minutesIfSubmitted(startedAt, now);
  const from = clockOf(startedAt);
  return (
    <View accessible accessibilityLabel={`Session timer ${clock}, started ${from}. Submitting now saves ${minutesText(saves)} as the duration.`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 10, paddingVertical: 8, paddingHorizontal: 11, borderRadius: 12, backgroundColor: hexA(TEAL, 0.07), borderWidth: 1, borderColor: hexA(TEAL, 0.28) }}>
      <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: now % 2000 < 1000 ? TEAL : hexA(TEAL, 0.35) }} />
      <View style={{ flex: 1 }}>
        <Mono style={{ fontSize: 8.5, letterSpacing: 0.8, color: TEAL }}>SESSION TIMER</Mono>
        <Mono style={{ fontSize: 8.5, color: C.muted2, marginTop: 2 }} numberOfLines={1}>{`FROM ${from.toUpperCase()} · SAVES ${minutesText(saves).toUpperCase()}`}</Mono>
      </View>
      <Text style={{ fontFamily: F.bodyBold, fontSize: 19, color: '#fff', fontVariant: ['tabular-nums'] }}>{clock}</Text>
    </View>
  );
}
