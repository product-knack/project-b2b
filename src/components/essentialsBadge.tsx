/* The "ESSENTIALS" client badge (30 Sep 2026): a highlighted pill so a trainer or
   CRM spots a 30-day-pass client at a glance on client cards and roster rows.
   Gold gradient while the pass runs; the colour and a suffix change when the pass
   is about to end, is paused for a vacation, has ended, or has not started yet. */
import React from 'react';
import { View, Text } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { EssentialsStatus, essentialsDate } from '../lib/essentials';

export const essentialsColor = (s: EssentialsStatus) =>
  s.state === 'expired' ? C.red : s.state === 'vacation' ? C.purple : s.state === 'expiring' ? C.orange : s.state === 'upcoming' ? C.blue : C.gold;

const suffix = (s: EssentialsStatus, compact: boolean) => {
  switch (s.state) {
    case 'expired': return 'ENDED';
    case 'vacation': return 'VACATION';
    case 'upcoming': return compact ? 'SOON' : `FROM ${essentialsDate(s.startDate).toUpperCase()}`;
    case 'expiring': return s.daysLeft === 0 ? 'LAST DAY' : `${s.daysLeft}D LEFT`;
    case 'active': return compact ? '' : `TILL ${essentialsDate(s.validTill).toUpperCase()}`;
    default: return '';
  }
};

export function EssentialsBadge({ status, compact = false }: { status: EssentialsStatus | null | undefined; compact?: boolean }) {
  if (!status) return null;
  const col = essentialsColor(status);
  const tail = suffix(status, compact);
  const running = status.state === 'active' || status.state === 'expiring';
  return (
    <View accessibilityLabel={`Essentials client${tail ? `, ${tail.toLowerCase()}` : ''}`} style={{ borderRadius: 999, overflow: 'hidden', borderWidth: 1, borderColor: hexA(col, running ? 0.7 : 0.45) }}>
      <LinearGradient
        colors={running ? [hexA(col, 0.42), hexA(col, 0.16)] : [hexA(col, 0.2), hexA(col, 0.1)]}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: compact ? 2.5 : 3, paddingHorizontal: compact ? 7 : 9 }}
      >
        <Icon name="award" size={compact ? 9 : 10} color={running ? '#FFE3A3' : col} strokeWidth={2.4} />
        <Text style={{ fontFamily: F.mono, fontSize: compact ? 8 : 8.5, letterSpacing: 1, color: running ? '#FFE3A3' : col }}>
          ESSENTIALS{tail ? ` · ${tail}` : ''}
        </Text>
      </LinearGradient>
    </View>
  );
}
