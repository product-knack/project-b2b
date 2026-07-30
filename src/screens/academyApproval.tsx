import React from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator, Alert, Keyboard, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C, F, hexA, ORANGE_GRAD } from '../theme';
import { Icon } from '../icons';
import { Body, Mono } from '../components/primitives';
import { Badge, AnimChip } from './common';
import { SheetShell } from './reportDetail';
import { ATT_STATUSES, AttStatus, prettyDate } from '../lib/academyQueries';
import {
  usePendingAttendanceCount, useAttendanceByApproval, useSetAttendanceApproval, useUpdateAttendanceRow,
  type ApprovalRow,
} from '../lib/academyAttendanceQueries';

/* ============================================================================
   Academy attendance approval — admin-side review of teacher-submitted
   attendance. Mounted inside the Academy Management Attendance tab.
   Teacher rows land as approval_status='pending'; only approved rows count
   in any metric, so this panel is the gate for every report.
   ========================================================================== */

const ACC = '#6EA8FE'; // academy accent (matches academy.tsx)
const PENCIL = 'M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z';
const CHECK = 'M4 12l5 5L20 6'; // single tick for the checkbox
const attColor = (s: string) => (s === 'present' ? C.green : s === 'late' ? C.gold : s === 'leave' ? C.blue : C.red);

/* Slim gold alert shown on admin surfaces while teacher submissions wait. */
export function PendingAttendanceBanner({ onPress }: { onPress?: () => void }) {
  const q = usePendingAttendanceCount();
  const n = q.data ?? 0;
  if (n === 0) return null;
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 13, borderRadius: 14, backgroundColor: hexA(C.gold, 0.08), borderWidth: 1, borderColor: hexA(C.gold, 0.32) }}>
      <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: hexA(C.gold, 0.14), alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="clock" size={15} color={C.gold} strokeWidth={2.1} />
      </View>
      <Body style={{ flex: 1, fontSize: 12.5, fontFamily: F.bodySemi, color: C.ink }}>
        {n} attendance submission{n === 1 ? '' : 's'} waiting for approval
      </Body>
      <Icon name="chevRight" size={13} color={C.gold} strokeWidth={2.2} />
    </Pressable>
  );
}

/* ---------------- Approval workbench ---------------- */
export function AttendanceApprovalPanel({ adminId }: { adminId: string }) {
  const [sub, setSub] = React.useState<'pending' | 'approved'>('pending');
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [editRow, setEditRow] = React.useState<ApprovalRow | null>(null);
  const q = useAttendanceByApproval(sub);
  const pendingCountQ = usePendingAttendanceCount();
  const decideM = useSetAttendanceApproval();

  const rows = q.data ?? [];
  // Grouped by batch + date, preserving the query's newest-first order.
  const groups = React.useMemo(() => {
    const m = new Map<string, ApprovalRow[]>();
    rows.forEach((r) => { const k = `${r.batchId}|${r.date}`; if (!m.has(k)) m.set(k, []); m.get(k)!.push(r); });
    return [...m.entries()].map(([key, list]) => ({ key, list }));
  }, [rows]);

  // Only ids still present in the current list count (rows vanish after a decision).
  const selectedIds = React.useMemo(() => rows.filter((r) => selected.has(r.id)).map((r) => r.id), [rows, selected]);
  const n = selectedIds.length;

  const switchTab = (t: 'pending' | 'approved') => { setSub(t); setSelected(new Set()); };
  const toggleRow = (id: string) =>
    setSelected((prev) => { const nx = new Set(prev); nx.has(id) ? nx.delete(id) : nx.add(id); return nx; });
  const toggleGroup = (list: ApprovalRow[]) =>
    setSelected((prev) => {
      const nx = new Set(prev);
      const all = list.every((r) => nx.has(r.id));
      list.forEach((r) => { all ? nx.delete(r.id) : nx.add(r.id); });
      return nx;
    });

  const decide = (to: 'approved' | 'rejected') => {
    if (!n || decideM.isPending) return;
    const verb = to === 'approved' ? 'Approve' : 'Reject';
    const noun = `${n} attendance record${n === 1 ? '' : 's'}`;
    Alert.alert(
      `${verb} ${n} record${n === 1 ? '' : 's'}?`,
      to === 'approved'
        ? `${noun} will be approved and start counting in reports.`
        : `${noun} will be rejected and will not count in any report.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: verb,
          style: to === 'rejected' ? 'destructive' : 'default',
          onPress: () => decideM.mutate({ ids: selectedIds, to, adminId }, {
            onSuccess: () => setSelected(new Set()),
            onError: (e: any) => Alert.alert('Failed', e?.message ?? 'Try again'),
          }),
        },
      ]
    );
  };

  const pendingCount = pendingCountQ.data ?? 0;

  return (
    <View style={{ gap: 11 }}>
      {/* Sub-tabs */}
      <View style={{ flexDirection: 'row', gap: 7 }}>
        {([['pending', 'Pending'], ['approved', 'Approved']] as const).map(([id, lab]) => {
          const on = sub === id;
          return (
            <AnimChip key={id} active={on} grow onPress={() => switchTab(id)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9, borderRadius: 999, backgroundColor: on ? hexA(ACC, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: on ? hexA(ACC, 0.5) : 'rgba(255,255,255,0.09)' }}>
              <Text style={{ fontFamily: on ? F.bodyBold : F.bodySemi, fontSize: 12, color: on ? ACC : C.muted }}>{lab}</Text>
              {id === 'pending' && pendingCount > 0 ? (
                <View style={{ paddingVertical: 1, paddingHorizontal: 6, borderRadius: 8, backgroundColor: hexA(C.gold, 0.16) }}>
                  <Text style={{ fontFamily: F.mono, fontSize: 10, color: C.gold }}>{pendingCount}</Text>
                </View>
              ) : null}
            </AnimChip>
          );
        })}
      </View>

      {/* Action bar — pinned under the sub-tabs while anything is selected. */}
      {sub === 'pending' && n > 0 ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 13, backgroundColor: hexA(ACC, 0.08), borderWidth: 1, borderColor: hexA(ACC, 0.32) }}>
          <Mono style={{ flex: 1, fontSize: 9, letterSpacing: 0.8, color: C.ink3 }}>{n} SELECTED</Mono>
          <Pressable disabled={decideM.isPending} onPress={() => decide('approved')} style={{ paddingVertical: 9, paddingHorizontal: 14, borderRadius: 11, backgroundColor: hexA(C.green, 0.14), borderWidth: 1, borderColor: hexA(C.green, 0.45), opacity: decideM.isPending ? 0.5 : 1 }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 11.5, color: C.green }}>{decideM.isPending ? 'Working…' : `Approve (${n})`}</Text>
          </Pressable>
          <Pressable disabled={decideM.isPending} onPress={() => decide('rejected')} style={{ paddingVertical: 9, paddingHorizontal: 14, borderRadius: 11, backgroundColor: hexA(C.red, 0.1), borderWidth: 1, borderColor: hexA(C.red, 0.4), opacity: decideM.isPending ? 0.5 : 1 }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 11.5, color: C.red }}>{`Reject (${n})`}</Text>
          </Pressable>
        </View>
      ) : null}

      {q.isPending ? (
        <ActivityIndicator color={ACC} style={{ paddingVertical: 26 }} />
      ) : groups.length === 0 ? (
        <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 26 }}>
          {sub === 'pending' ? 'No pending submissions' : 'Nothing approved yet'}
        </Body>
      ) : (
        groups.map(({ key, list }) => {
          const first = list[0];
          const allSel = sub === 'pending' && list.every((r) => selected.has(r.id));
          return (
            <View key={key} style={{ borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
              {/* Group header: batch + date + session */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, padding: 12 }}>
                <View style={{ flex: 1 }}>
                  <Body numberOfLines={1} style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{first.batchLabel}</Body>
                  <Mono style={{ fontSize: 8.5, color: C.muted3, marginTop: 2 }}>
                    {prettyDate(first.date)}{first.sessionTime ? ` · ${first.sessionTime}` : ''} · {list.length} STUDENT{list.length === 1 ? '' : 'S'}
                  </Mono>
                </View>
                {sub === 'pending' ? (
                  <Pressable onPress={() => toggleGroup(list)} hitSlop={6} style={{ paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999, backgroundColor: allSel ? hexA(ACC, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: allSel ? hexA(ACC, 0.5) : 'rgba(255,255,255,0.1)' }}>
                    <Text style={{ fontFamily: F.bodySemi, fontSize: 10, color: allSel ? ACC : C.muted }}>{allSel ? 'Clear' : 'Select all'}</Text>
                  </Pressable>
                ) : (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Icon name="checks" size={11} color={C.green} strokeWidth={2.3} />
                    <Mono style={{ fontSize: 8, letterSpacing: 0.6, color: C.green }}>APPROVED BY ADMIN</Mono>
                  </View>
                )}
              </View>

              {list.map((r) => {
                const on = selected.has(r.id);
                const inner = (
                  <>
                    {sub === 'pending' ? (
                      <View style={{ width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: on ? ACC : 'rgba(255,255,255,0.22)', backgroundColor: on ? hexA(ACC, 0.9) : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                        {on ? <Icon path={CHECK} size={11} color="#0c0808" strokeWidth={3} /> : null}
                      </View>
                    ) : null}
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                        <Body numberOfLines={1} style={{ flexShrink: 1, fontSize: 13, fontFamily: F.bodySemi, color: '#fff' }}>{r.studentName}</Body>
                        {r.rollNo ? <Mono style={{ fontSize: 8.5, color: C.muted3 }}>ROLL {r.rollNo}</Mono> : null}
                      </View>
                      {r.remarks ? <Body numberOfLines={2} style={{ fontSize: 10.5, color: C.muted2, marginTop: 2 }}>"{r.remarks}"</Body> : null}
                    </View>
                    <Badge text={r.status} color={attColor(r.status)} />
                    {sub === 'pending' ? (
                      <Pressable onPress={() => setEditRow(r)} hitSlop={6} style={{ width: 28, height: 28, borderRadius: 9, backgroundColor: hexA(ACC, 0.1), borderWidth: 1, borderColor: hexA(ACC, 0.32), alignItems: 'center', justifyContent: 'center' }}>
                        <Icon path={PENCIL} size={11} color={ACC} strokeWidth={2.1} />
                      </Pressable>
                    ) : null}
                  </>
                );
                const rowStyle = { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)', backgroundColor: on ? hexA(ACC, 0.07) : 'transparent' } as const;
                return sub === 'pending' ? (
                  <Pressable key={r.id} onPress={() => toggleRow(r.id)} style={rowStyle}>{inner}</Pressable>
                ) : (
                  <View key={r.id} style={rowStyle}>{inner}</View>
                );
              })}
            </View>
          );
        })
      )}

      {editRow ? <EditRowSheet row={editRow} onClose={() => setEditRow(null)} /> : null}
    </View>
  );
}

/* ---------------- Inline edit (pending rows only) ---------------- */
function EditRowSheet({ row, onClose }: { row: ApprovalRow; onClose: () => void }) {
  const updateM = useUpdateAttendanceRow();
  const [status, setStatus] = React.useState<AttStatus>(row.status);
  const [remarks, setRemarks] = React.useState(row.remarks ?? '');
  const [kb, setKb] = React.useState(0);
  React.useEffect(() => {
    const s = Keyboard.addListener('keyboardDidShow', (e) => setKb(e.endCoordinates.height));
    const h = Keyboard.addListener('keyboardDidHide', () => setKb(0));
    return () => { s.remove(); h.remove(); };
  }, []);
  const close = () => { Keyboard.dismiss(); onClose(); };

  const save = () => {
    if (updateM.isPending) return;
    Keyboard.dismiss();
    Alert.alert('Save changes?', `${row.studentName}: ${status} on ${prettyDate(row.date)}.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Save',
        onPress: () => updateM.mutate(
          { id: row.id, status, remarks: remarks.trim() ? remarks.trim() : null },
          {
            onSuccess: () => close(),
            onError: (e: any) => Alert.alert('Could not save', e?.message ?? 'Try again'),
          }
        ),
      },
    ]);
  };

  return (
    <SheetShell visible onClose={close} accent={ACC} icon="clipboard" title={row.studentName} subtitle={`${row.batchLabel} · ${prettyDate(row.date)}`}>
      <View style={{ gap: 6 }}>
        <Mono style={{ fontSize: 9, letterSpacing: 1, color: C.mono2 }}>STATUS</Mono>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {ATT_STATUSES.map((st) => {
            const on = status === st;
            const col = attColor(st);
            return (
              <AnimChip key={st} active={on} grow onPress={() => setStatus(st)} style={{ alignItems: 'center', paddingVertical: 10, borderRadius: 11, backgroundColor: on ? hexA(col, 0.18) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: on ? hexA(col, 0.5) : 'rgba(255,255,255,0.08)' }}>
                <Text style={{ fontFamily: on ? F.bodyBold : F.bodySemi, fontSize: 10.5, color: on ? col : C.muted2, textTransform: 'capitalize' }}>{st}</Text>
              </AnimChip>
            );
          })}
        </View>
      </View>

      <View style={{ gap: 6 }}>
        <Mono style={{ fontSize: 9, letterSpacing: 1, color: C.mono2 }}>REMARKS</Mono>
        <TextInput
          value={remarks}
          onChangeText={setRemarks}
          multiline
          placeholder="Optional note, e.g. informed leave"
          placeholderTextColor={C.muted3}
          style={{ minHeight: 76, textAlignVertical: 'top', paddingVertical: 11, paddingHorizontal: 13, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.04)', color: '#fff', fontFamily: F.body, fontSize: 14 }}
        />
      </View>

      <Pressable onPress={save} disabled={updateM.isPending} style={{ borderRadius: 13, overflow: 'hidden', opacity: updateM.isPending ? 0.5 : 1 }}>
        <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ alignItems: 'center', paddingVertical: 14 }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: '#fff' }}>{updateM.isPending ? 'Saving…' : 'Save changes'}</Text>
        </LinearGradient>
      </Pressable>
      <Body style={{ fontSize: 9.5, color: C.muted3 }}>The record stays pending after editing; approve it from the list.</Body>

      {/* Android: adjustResize is defeated by edge-to-edge, pad past the keyboard. */}
      {Platform.OS === 'android' && kb > 0 ? <View style={{ height: kb }} /> : null}
    </SheetShell>
  );
}
