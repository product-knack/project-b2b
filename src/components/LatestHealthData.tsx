/* Latest health data with its date (22 Oct 2026, Android only).
   - LatestHealthDataBlock: under the two Play rows of the Today's Roster summary strip (only when the strip is open).
   - LatestRecoveryLine: the WHOOP recovery line at the top of the Log Health Data popup.
   Rules (sources, tie breaks, date labels, the "old" marker) in src/lib/latestDaily.ts. Read only.
   Health data: callers render these inside a ReplayMask. */
import React from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { C, F, hexA } from '../theme';
import { Icon, type IconName } from '../icons';
import { Mono, Body } from './primitives';
import { useClientLatestDaily } from '../lib/clientQueries';
import { istDayOf } from '../lib/clientHealthSummary';
import { latestLines, datedLabel, isStale, recoveryZone, valueText, type LatestKey, type RecoveryZone } from '../lib/latestDaily';

const HYDRATION = '#38BDF8';
const DROP = 'M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z';
const ZONE: Record<RecoveryZone, string> = { green: C.green, yellow: C.gold, red: C.red };
const ITEM: Record<LatestKey, { icon: IconName; path?: string; color: string }> = {
  recovery: { icon: 'heart', color: C.red },
  sleep: { icon: 'moon', color: C.gold },
  nutrition: { icon: 'leaf', color: C.green },
  steps: { icon: 'activity', color: C.blue },
  hydration: { icon: 'activity', path: DROP, color: HYDRATION },
};

export function LatestHealthDataBlock({ clientId, enabled }: { clientId: string; enabled: boolean }) {
  const q = useClientLatestDaily(clientId, enabled);
  const today = istDayOf(Date.now());
  return (
    <View style={{ padding: 11, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', gap: 9 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Mono style={{ flex: 1, fontSize: 8.5, letterSpacing: 0.8, color: C.muted3 }}>LATEST DATA</Mono>
        {q.isFetching && q.data ? <ActivityIndicator size="small" color={C.muted3} /> : null}
      </View>
      {q.data ? (
        latestLines(q.data, today).map((line) => {
          const it = ITEM[line.key];
          const valueColor = line.zone ? ZONE[line.zone] : line.has ? '#fff' : C.muted3;
          return (
            <View key={line.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}
              accessible accessibilityLabel={`${line.label}: ${line.text}${line.date ? `, ${line.date}` : ''}`}>
              <View style={{ width: 24, height: 24, borderRadius: 8, backgroundColor: hexA(it.color, 0.13), alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={it.icon} path={it.path} size={12} color={it.color} strokeWidth={2.1} />
              </View>
              <Body style={{ flex: 1, fontSize: 12, color: C.muted }} numberOfLines={1}>{line.label}</Body>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ fontFamily: line.has ? F.bodySemi : F.body, fontSize: line.has ? 13 : 11.5, color: valueColor }}>{line.text}</Text>
                {line.date ? (
                  <Mono style={{ fontSize: 8.5, letterSpacing: 0.3, color: line.stale ? C.gold : C.muted2, marginTop: 1 }}>{line.date.toUpperCase()}</Mono>
                ) : null}
              </View>
            </View>
          );
        })
      ) : q.isError ? (
        <Pressable onPress={() => q.refetch()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Retry loading the latest health data">
          <Body style={{ fontSize: 11.5, color: C.red }}>Could not load the latest data. Tap to retry.</Body>
        </Pressable>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <ActivityIndicator size="small" color={C.muted3} />
          <Body style={{ fontSize: 11.5, color: C.muted2 }}>Loading the latest data…</Body>
        </View>
      )}
      {q.data ? (
        <Body style={{ fontSize: 10, color: C.muted3, lineHeight: 14 }}>The newest entry of each, with the day it is saved on. A gold date is more than 2 days old.</Body>
      ) : null}
    </View>
  );
}

/** One line for the Log Health Data popup: "WHOOP recovery 48%" with its date, or "No WHOOP data". */
export function LatestRecoveryLine({ clientId, enabled }: { clientId: string; enabled: boolean }) {
  const q = useClientLatestDaily(clientId, enabled);
  const today = istDayOf(Date.now());
  const rec = q.data?.recovery ?? null;
  const col = rec ? ZONE[recoveryZone(rec.value)] : C.muted2;
  const text = q.data ? (rec ? valueText('recovery', rec.value) : 'No WHOOP data') : q.isError ? 'Could not load' : 'Loading…';
  const date = rec ? datedLabel(rec.date, today) : '';
  const stale = rec ? isStale(rec.date, today) : false;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 14, backgroundColor: hexA(col, 0.07), borderWidth: 1, borderColor: hexA(col, 0.25) }}
      accessible accessibilityLabel={`WHOOP recovery: ${text}${date ? `, ${date}` : ''}`}>
      <View style={{ width: 28, height: 28, borderRadius: 9, backgroundColor: hexA(col, 0.14), alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="heart" size={14} color={col} strokeWidth={2.1} />
      </View>
      <View style={{ flex: 1 }}>
        <Body style={{ fontSize: 12, color: C.muted }}>WHOOP recovery</Body>
        {date ? <Mono style={{ fontSize: 9, letterSpacing: 0.3, color: stale ? C.gold : C.muted2, marginTop: 2 }}>{`LATEST ${date.toUpperCase()}`}</Mono> : null}
      </View>
      {q.isLoading ? <ActivityIndicator size="small" color={C.muted3} /> : (
        <Text style={{ fontFamily: rec ? F.bodyBold : F.body, fontSize: rec ? 18 : 12, color: rec ? col : C.muted3 }}>{text}</Text>
      )}
    </View>
  );
}
