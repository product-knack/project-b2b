import React from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator } from 'react-native';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Body, Mono } from './primitives';
import { PhysioHodNote, PhysioHodPushEntry, pushStatus, useAddPhysioThreadNote, PHYSIO_NOTE_MAX } from '../lib/physioHodQueries';

/* Shared UI for the Push-to-Physio-HOD feature: the status pill and the
   two-color notes thread (academy side purple, physio side blue). */

export const PHYSIO_ACC = '#5BB8D4';

export function PhysioHodStatusBadge({ push, compact }: { push: PhysioHodPushEntry[] | any; compact?: boolean }) {
  const st = pushStatus(push);
  if (st === 'none') return null;
  const col = st === 'seen' ? C.green : C.gold;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: compact ? 2.5 : 4, paddingHorizontal: compact ? 7 : 10, borderRadius: 999, backgroundColor: hexA(col, 0.13), borderWidth: 1, borderColor: hexA(col, 0.4) }}>
      <Icon path="M4.5 12.5l3 3 8-8" size={compact ? 8 : 10} color={col} strokeWidth={2.6} />
      <Text style={{ fontFamily: F.bodyBold, fontSize: compact ? 8.5 : 10, color: col }}>
        {st === 'seen' ? 'Physio: Seen' : 'Physio: Pending'}
      </Text>
    </View>
  );
}

const fmtAt = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' })} ${d.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true })}`;
};

export function PhysioHodNotesThread({ qhpDetailsId, notes }: { qhpDetailsId: string; notes: PhysioHodNote[] }) {
  const addM = useAddPhysioThreadNote();
  const [draft, setDraft] = React.useState('');
  const send = () => {
    const msg = draft.trim();
    if (!msg || addM.isPending) return;
    addM.mutate({ id: qhpDetailsId, message: msg }, { onSuccess: () => setDraft('') });
  };
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <Icon name="chat" size={12} color={PHYSIO_ACC} strokeWidth={2.1} />
        <Mono style={{ flex: 1, fontSize: 9, letterSpacing: 1, color: C.mono2 }}>PHYSIO THREAD · {notes.length} NOTE{notes.length === 1 ? '' : 'S'}</Mono>
      </View>
      {notes.length === 0 ? (
        <Body style={{ fontSize: 11, color: C.muted3 }}>No notes yet. Anything written here is visible to both HODs.</Body>
      ) : notes.map((n) => {
        const physio = n.author_side === 'physio_hod';
        const col = physio ? PHYSIO_ACC : C.purple;
        return (
          <View key={n.id} style={{ padding: 10, borderRadius: 12, backgroundColor: hexA(col, 0.06), borderWidth: 1, borderColor: hexA(col, 0.22), borderLeftWidth: 3, borderLeftColor: col, gap: 3 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={{ flex: 1, fontFamily: F.bodyBold, fontSize: 10.5, color: col }}>
                {n.author_name} · {physio ? 'Physio HOD' : 'Academy HOD'}
              </Text>
              <Mono style={{ fontSize: 7.5, color: C.muted3 }}>{fmtAt(n.at)}</Mono>
            </View>
            <Body style={{ fontSize: 12, color: C.ink, lineHeight: 17 }}>{n.message}</Body>
          </View>
        );
      })}
      {/* Composer */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
        <TextInput
          value={draft} onChangeText={(t) => setDraft(t.slice(0, PHYSIO_NOTE_MAX))}
          placeholder="Add a note for the other HOD…" placeholderTextColor={C.muted3} multiline
          style={{ flex: 1, minHeight: 40, maxHeight: 100, paddingVertical: 9, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: draft.trim() ? hexA(PHYSIO_ACC, 0.4) : 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.04)', color: '#fff', fontFamily: F.body, fontSize: 12.5 }}
        />
        <Pressable onPress={send} disabled={!draft.trim() || addM.isPending} style={{ width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: draft.trim() ? hexA(PHYSIO_ACC, 0.18) : 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: draft.trim() ? hexA(PHYSIO_ACC, 0.5) : 'rgba(255,255,255,0.1)' }}>
          {addM.isPending ? <ActivityIndicator size="small" color={PHYSIO_ACC} /> : <Icon path="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" size={14} color={draft.trim() ? PHYSIO_ACC : C.muted3} strokeWidth={2.1} />}
        </Pressable>
      </View>
      {addM.isError ? <Body style={{ fontSize: 10.5, color: C.red }}>{(addM.error as Error).message}</Body> : null}
    </View>
  );
}
