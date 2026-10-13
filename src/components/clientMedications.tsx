/* Medications tab (therapist client detail, 5 Oct 2026): every medicine the
   client's QHP assessments and doctor consultations recorded, one dated card per
   source row, newest first. Read-only. */
import React from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono } from './primitives';
import { ReplayMask } from './ReplayShield';
import { MedicationCard, medDate } from '../lib/medications';
import { useClientMedications } from '../lib/medicationQueries';

const QHP = '#2FB7A3';
const DOC = C.purple;

function Pill({ text, color }: { text: string; color: string }) {
  return (
    <View style={{ paddingVertical: 2.5, paddingHorizontal: 8, borderRadius: 999, backgroundColor: hexA(color, 0.14), borderWidth: 1, borderColor: hexA(color, 0.45) }}>
      <Mono style={{ fontSize: 7.5, letterSpacing: 1, color }}>{text}</Mono>
    </View>
  );
}

function MedCard({ card }: { card: MedicationCard }) {
  const col = card.source === 'qhp' ? QHP : DOC;
  return (
    <View style={{ borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.24)', borderWidth: 1, borderColor: hexA(col, 0.3), overflow: 'hidden' }}>
      <View style={{ height: 3, backgroundColor: hexA(col, 0.55) }} />
      <View style={{ padding: 13, gap: 9 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Icon name={card.source === 'qhp' ? 'heart' : 'clipboard'} size={13} color={col} strokeWidth={2.2} />
          <Body style={{ flex: 1, fontSize: 13, fontFamily: F.bodySemi, color: '#fff' }} numberOfLines={1}>{card.title}{card.subtitle ? ` · ${card.subtitle}` : ''}</Body>
          <Pill text={card.source === 'qhp' ? 'QHP' : 'DOCTOR'} color={col} />
          {card.status && card.status !== 'approved' ? <Pill text={card.status.toUpperCase()} color={C.gold} /> : null}
        </View>
        <Mono style={{ fontSize: 8.5, letterSpacing: 1, color: C.muted2 }}>{medDate(card.date).toUpperCase()}</Mono>
        {card.items.length ? (
          <View style={{ gap: 6 }}>
            {card.items.map((it, i) => (
              <View key={`${it.name}-${i}`} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 9, paddingTop: i ? 6 : 0, borderTopWidth: i ? 1 : 0, borderTopColor: 'rgba(255,255,255,0.06)' }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: hexA(col, 0.8), marginTop: 6 }} />
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <Body style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{it.name}</Body>
                    {it.sos ? <Pill text="SOS" color={C.red} /> : null}
                  </View>
                  {it.detail ? <Body style={{ fontSize: 11.5, color: C.ink3, marginTop: 1 }}>{it.detail}</Body> : null}
                  {it.note ? <Body style={{ fontSize: 11, color: C.muted2, marginTop: 1, lineHeight: 15 }}>{it.note}</Body> : null}
                </View>
              </View>
            ))}
          </View>
        ) : null}
        {card.supplements.length ? (
          <View style={{ gap: 5 }}>
            <Mono style={{ fontSize: 7.5, letterSpacing: 1, color: C.muted3 }}>SUPPLEMENTS</Mono>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
              {card.supplements.map((s) => (
                <View key={s} style={{ paddingVertical: 3, paddingHorizontal: 8, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}>
                  <Text style={{ fontFamily: F.bodySemi, fontSize: 10.5, color: C.ink3 }}>{s}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </View>
    </View>
  );
}

export function ClientMedicationsTab({ clientId, accent = DOC }: { clientId: string | null; accent?: string }) {
  const q = useClientMedications(clientId);
  const d = q.data;
  return (
    <ReplayMask style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name="clipboard" size={13} color={accent} strokeWidth={2.1} />
        <Mono style={{ flex: 1, fontSize: 9, letterSpacing: 1, color: C.mono2 }}>MEDICATIONS</Mono>
        {d ? <Mono style={{ fontSize: 9, color: C.muted3 }}>{d.qhpCount} QHP · {d.consultCount} DOCTOR</Mono> : null}
      </View>
      <Body style={{ fontSize: 11.5, color: C.muted2, lineHeight: 16 }}>
        What the client reported in each QHP assessment and what the doctor prescribed or discussed in each consultation, newest first. Read-only.
      </Body>
      {d && !d.consultEnabled ? (
        <View style={{ padding: 10, borderRadius: 12, backgroundColor: hexA(C.gold, 0.08), borderWidth: 1, borderColor: hexA(C.gold, 0.3) }}>
          <Body style={{ fontSize: 11.5, color: C.gold }}>Doctor consultations are not connected on the server yet; only the QHP medications show. Ask the tech team to finish the setup.</Body>
        </View>
      ) : null}
      {q.isPending ? (
        <ActivityIndicator color={accent} style={{ paddingVertical: 20 }} />
      ) : q.isError ? (
        <View style={{ padding: 12, borderRadius: 13, backgroundColor: hexA(C.red, 0.08), borderWidth: 1, borderColor: hexA(C.red, 0.35), gap: 8 }}>
          <Body style={{ fontSize: 12.5, color: '#fff' }}>Could not load the medications. {(q.error as Error).message}</Body>
          <Pressable onPress={() => q.refetch()} hitSlop={10} accessibilityRole="button" style={{ alignSelf: 'flex-start', paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, backgroundColor: hexA(C.red, 0.16), borderWidth: 1, borderColor: hexA(C.red, 0.4) }}>
            <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: C.red }}>Try again</Text>
          </Pressable>
        </View>
      ) : !d || d.cards.length === 0 ? (
        <View style={{ alignItems: 'center', gap: 8, paddingVertical: 24 }}>
          <View style={{ width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: hexA(accent, 0.1), borderWidth: 1, borderColor: hexA(accent, 0.3) }}>
            <Icon name="clipboard" size={20} color={accent} strokeWidth={2} />
          </View>
          <Serif style={{ fontSize: 17 }}>No medications on file</Serif>
          <Body style={{ fontSize: 12, color: C.muted2, textAlign: 'center', lineHeight: 17 }}>No QHP assessment or doctor consultation of this client has recorded a medicine yet.</Body>
        </View>
      ) : (
        d.cards.map((card) => <MedCard key={card.id} card={card} />)
      )}
    </ReplayMask>
  );
}
