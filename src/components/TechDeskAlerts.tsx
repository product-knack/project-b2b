import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Body, Mono } from './primitives';
import { useStore } from '../store';
import { STATUS_COLOR, STATUS_LABEL, ticketNo, timeAgo } from '../lib/techDesk';
import { useTechAlerts } from '../lib/techDeskQueries';
import { Pulse } from '../screens/techDesk';

/* ============ Reporter alert banner ============
   A slim strip above the screen host: when Tech Desk moves, replies to or
   re-prioritises one of YOUR tickets, you see it on whatever dashboard you are
   on. Opening the ticket stamps reporter_seen_at (the RPC), which is what really
   clears it — the dismiss below only hides it for this session.
   Never shown on the Tech Desk screens themselves (you are already looking). */

const HIDE_ON = new Set(['tech-desk', 'tech-desk-ticket', 'tech-desk-inbox', 'tech-desk-inbox-ticket', 'signin']);

export function TechDeskAlertBanner() {
  const { route, go, set } = useStore();
  const alertsQ = useTechAlerts();
  const [dismissed, setDismissed] = React.useState<string | null>(null);

  const alerts = alertsQ.data ?? [];
  // Signature = the exact set of updates being shown, so a NEW update re-opens
  // the banner even after a dismiss.
  const signature = alerts.map((a) => `${a.ticketId}:${a.at}`).join('|');

  if (HIDE_ON.has(route) || !alerts.length || dismissed === signature) return null;
  const top = alerts[0];
  const more = alerts.length - 1;
  const col = STATUS_COLOR[top.status] ?? C.orange;

  return (
    <View style={{ paddingHorizontal: 14, paddingBottom: 8 }}>
      <Pressable
        onPress={() => { set({ selectedTicketId: top.ticketId }); go('tech-desk-ticket'); }}
        accessibilityRole="button"
        accessibilityLabel={`${ticketNo(top.serialNo)} ${top.title}. ${top.actor} ${top.text}. Open ticket.`}
        style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1, flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 9, paddingHorizontal: 11, borderRadius: 12, backgroundColor: hexA(col, 0.09), borderWidth: 1, borderColor: hexA(col, 0.32) })}
      >
        <Pulse color={col} size={6} />
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Mono style={{ fontSize: 9, color: col }}>{ticketNo(top.serialNo)}</Mono>
            <Text numberOfLines={1} style={{ flex: 1, fontFamily: F.bodySemi, fontSize: 12, color: '#fff' }}>{top.title}</Text>
            {/* A resolution waiting on this reporter is an errand, so the chip names
                the action rather than repeating the status. */}
            <Mono style={{ fontSize: 8, color: col }}>{top.needsAck ? 'CONFIRM FIX' : STATUS_LABEL[top.status].toUpperCase()}</Mono>
          </View>
          <Mono style={{ fontSize: 8.5, color: C.muted2 }} numberOfLines={1}>
            {top.actor} {top.text} · {timeAgo(new Date(top.at).toISOString())}{more > 0 ? ` · +${more} more update${more === 1 ? '' : 's'}` : ''}
          </Mono>
        </View>
        <Pressable onPress={() => setDismissed(signature)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Dismiss update">
          <Icon name="close" size={13} color={C.muted2} strokeWidth={2.2} />
        </Pressable>
      </Pressable>
    </View>
  );
}
