/* Paid cancellation codes card on the CRM dashboard (19 Nov 2026, owner: "build this in crm dashboard").
   Same data and rule as the web Daily Task badge: the CRM gives the trainer the code of a Session-code member's
   session when a paid cancellation is agreed; the trainer types it in PaidCancelCodeStep. Codes stay hidden until
   tapped and hide again after a minute. The card is not drawn when neither today nor tomorrow has a code. */
import React from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Body, Mono } from './primitives';
import { useCrmPaidCancelCodes } from '../lib/crmQueries';
import { friendlyError } from '../lib/friendlyError';
import {
  istDateKey, istTime, PaidCancelCodeRow, PAID_CANCEL_CARD_TITLE, PAID_CANCEL_CARD_NOTE, paidCancelEmptyLine, paidCancelVerifiedLine,
} from '../lib/paidCancelCodes';

const HIDE_AFTER_MS = 60_000;

export function CrmPaidCancelCodesCard({ crmId }: { crmId: string | null }) {
  const now = Date.now();
  const todayKey = istDateKey(now);
  const tomorrowKey = istDateKey(now, 1);
  const todayQ = useCrmPaidCancelCodes(crmId, todayKey);
  const tomorrowQ = useCrmPaidCancelCodes(crmId, tomorrowKey);
  const [day, setDay] = React.useState<'today' | 'tomorrow'>('today');
  const [shown, setShown] = React.useState<string[]>([]);
  const timers = React.useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  React.useEffect(() => () => { Object.values(timers.current).forEach(clearTimeout); }, []);

  const reveal = (id: string) => {
    if (timers.current[id]) clearTimeout(timers.current[id]);
    if (shown.includes(id)) {
      setShown((s) => s.filter((x) => x !== id));
      return;
    }
    Haptics.selectionAsync().catch(() => {});
    setShown((s) => [...s, id]);
    timers.current[id] = setTimeout(() => setShown((s) => s.filter((x) => x !== id)), HIDE_AFTER_MS);
  };

  if (!crmId) return null;
  const todayRows = todayQ.data ?? [];
  const tomorrowRows = tomorrowQ.data ?? [];
  const bothLoaded = todayQ.isSuccess && tomorrowQ.isSuccess;
  // Nothing to show: no code on either day, or the first load has not answered yet (no empty frame on open).
  if (bothLoaded && !todayRows.length && !tomorrowRows.length) return null;
  if (!bothLoaded && !todayQ.isError && !tomorrowQ.isError) return null;

  const q = day === 'today' ? todayQ : tomorrowQ;
  const rows = day === 'today' ? todayRows : tomorrowRows;
  const open = (list: PaidCancelCodeRow[]) => list.filter((r) => !r.verifiedAt).length;
  const ACC = C.gold;

  return (
    <View style={{ borderRadius: 17, overflow: 'hidden', backgroundColor: 'rgba(24,17,14,0.55)', borderWidth: 1, borderColor: hexA(ACC, 0.28) }}>
      <LinearGradient colors={[hexA(ACC, 0.5), 'rgba(255,255,255,0.02)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 3 }} />
      <View style={{ padding: 14, gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: hexA(ACC, 0.14), borderWidth: 1, borderColor: hexA(ACC, 0.35), alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="rupee" size={18} color={ACC} strokeWidth={2} />
          </View>
          <View style={{ flex: 1 }}>
            <Body style={{ fontSize: 14.5, fontFamily: F.bodySemi, color: '#fff' }}>{PAID_CANCEL_CARD_TITLE}</Body>
            <Body style={{ fontSize: 11, color: C.muted2, marginTop: 1 }}>{PAID_CANCEL_CARD_NOTE}</Body>
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: 8 }}>
          {(['today', 'tomorrow'] as const).map((d) => {
            const active = d === day;
            const n = open(d === 'today' ? todayRows : tomorrowRows);
            return (
              <Pressable
                key={d}
                onPress={() => setDay(d)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: active ? hexA(ACC, 0.6) : 'rgba(255,255,255,0.1)', backgroundColor: active ? hexA(ACC, 0.14) : 'transparent' }}
              >
                <Mono style={{ fontSize: 9.5, letterSpacing: 0.8, color: active ? ACC : C.muted2 }}>{`${d.toUpperCase()}${n ? ` · ${n}` : ''}`}</Mono>
              </Pressable>
            );
          })}
        </View>

        {q.isError ? (
          <View style={{ gap: 8 }}>
            <Body style={{ fontSize: 12, color: C.muted2 }}>{friendlyError(q.error, 'The paid cancellation codes could not load.')}</Body>
            <Pressable onPress={() => q.refetch()} hitSlop={10} accessibilityRole="button" style={{ alignSelf: 'flex-start' }}>
              <Mono style={{ fontSize: 10, letterSpacing: 0.8, color: ACC }}>{q.isFetching ? 'LOADING…' : 'TRY AGAIN'}</Mono>
            </Pressable>
          </View>
        ) : q.isPending ? (
          <ActivityIndicator color={ACC} />
        ) : !rows.length ? (
          <Body style={{ fontSize: 12, color: C.muted2 }}>{paidCancelEmptyLine(day)}</Body>
        ) : (
          <View>
            {rows.map((r, i) => {
              const isShown = shown.includes(r.id);
              return (
                <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: 'rgba(255,255,255,0.06)' }}>
                  <View style={{ width: 62 }}>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 11.5, color: '#fff' }}>{istTime(r.scheduledAt)}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Body numberOfLines={1} style={{ fontSize: 13, fontFamily: F.bodySemi, color: '#fff' }}>{r.clientName}</Body>
                    <Body numberOfLines={1} style={{ fontSize: 10.5, color: C.muted2, marginTop: 1 }}>
                      {r.verifiedAt ? paidCancelVerifiedLine(r.verifiedAt) : `${r.trainerName} · ${r.modality}`}
                    </Body>
                  </View>
                  {r.verifiedAt ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 5, paddingHorizontal: 9, borderRadius: 999, borderWidth: 1, borderColor: hexA(C.green, 0.45), backgroundColor: hexA(C.green, 0.12) }}>
                      <Icon name="checks" size={11} color={C.green} strokeWidth={2.4} />
                      <Mono style={{ fontSize: 9, letterSpacing: 0.8, color: C.green }}>USED</Mono>
                    </View>
                  ) : (
                    <Pressable
                      onPress={() => reveal(r.id)}
                      hitSlop={10}
                      accessibilityRole="button"
                      accessibilityLabel={isShown ? `Hide the code for ${r.clientName}` : `Show the paid cancellation code for ${r.clientName}`}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 5, minWidth: 92, justifyContent: 'center', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: hexA(ACC, 0.5), backgroundColor: hexA(ACC, isShown ? 0.2 : 0.1) }}
                    >
                      {isShown ? (
                        <Text selectable style={{ fontFamily: F.bodyBold, fontSize: 15, letterSpacing: 3, color: ACC }}>{r.code}</Text>
                      ) : (
                        <>
                          <Icon name="eye" size={12} color={ACC} strokeWidth={2.2} />
                          <Mono style={{ fontSize: 9, letterSpacing: 0.8, color: ACC }}>SHOW CODE</Mono>
                        </>
                      )}
                    </Pressable>
                  )}
                </View>
              );
            })}
          </View>
        )}
      </View>
    </View>
  );
}
