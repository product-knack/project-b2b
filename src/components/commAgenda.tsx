import React from 'react';
import { View } from 'react-native';
import { C } from '../theme';
import { Body, Mono } from './primitives';

/* "Next call agenda" on a logged CRM communication (crm_communications.next_call_agenda,
   required on the Log Communication form since 25 Sep 2026, web parity with
   CRMCommunicationsList). Renders nothing for old or automatic rows without one. */
export function CommAgendaBlock({ agenda, style }: { agenda: string | null | undefined; style?: any }) {
  const text = (agenda ?? '').trim();
  if (!text) return null;
  return (
    <View style={[{ paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)', gap: 3 }, style]}>
      <Mono style={{ fontSize: 8.5, letterSpacing: 0.8, color: C.muted2 }}>NEXT CALL AGENDA</Mono>
      <Body style={{ fontSize: 12.5, lineHeight: 18, color: C.ink2 }}>{text}</Body>
    </View>
  );
}
