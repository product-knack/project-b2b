import React from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator, Alert } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C, F, hexA, ORANGE_GRAD } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono } from '../components/primitives';
import { Page, Badge, MiniAvatar, AnimChip, HScroll, TimeDial } from './common';
import { useStore } from '../store';
import { useAuth } from '../auth';
import { useCrmQhp, useMarkQhpExplained, useScheduleQhp, STAGE_META, CrmQhpRow } from '../lib/crmQhpQueries';
import { useCrmClientList } from '../lib/crmClientQueries';
import { SheetShell } from './reportDetail';

/* ============ CRM: QHP Tracker — mirrors the web QHPList: refresh cycle
   (38 days), report review journey (Senior → HOD), explained-to-client. ============ */

const initials = (n: string) => n.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
const AVS: [string, string][] = [['#F0883E', '#C05621'], ['#4FD1C5', '#2C7A7B'], ['#B794F4', '#6B46C1'], ['#F687B3', '#B83280'], ['#68D391', '#276749'], ['#63B3ED', '#2B6CB0']];
const istD = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' }) : '—');

type Filter = 'all' | 'due' | 'ontime' | 'explain';

export function CrmQhp() {
  const { go, set } = useStore();
  const { session } = useAuth();
  const crmId = session?.user?.id ?? null;
  const qhpQ = useCrmQhp(crmId);
  const explainM = useMarkQhpExplained();
  const [filter, setFilter] = React.useState<Filter>('all');
  const [query, setQuery] = React.useState('');
  const [scheduleOpen, setScheduleOpen] = React.useState(false);

  const rows = qhpQ.data ?? [];
  const needsExplain = (r: CrmQhpRow) => r.stage === 'fully_signed' && !r.explainedAt;
  const counts = {
    due: rows.filter((r) => !r.onTime).length,
    ontime: rows.filter((r) => r.onTime).length,
    explain: rows.filter(needsExplain).length,
  };
  const q = query.trim().toLowerCase();
  const list = rows
    .filter((r) => (filter === 'due' ? !r.onTime : filter === 'ontime' ? r.onTime : filter === 'explain' ? needsExplain(r) : true))
    .filter((r) => !q || r.clientName.toLowerCase().includes(q));

  const openClient = (r: CrmQhpRow) => { set({ selectedClientId: r.clientId, selectedClientName: r.clientName }); go('crm-client'); };
  const markExplained = (r: CrmQhpRow) => {
    Alert.alert('Mark as explained?', `Confirm you walked ${r.clientName} through their QHP report.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Yes, explained', onPress: () => explainM.mutate(r.assessmentId, { onError: (e: any) => Alert.alert("Couldn't mark", e?.message) }) },
    ]);
  };

  return (
    <Page gap={13} pt={6}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Serif style={{ fontSize: 24 }}>QHP Management</Serif>
          <Body style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>Quarterly Health Profile assessments</Body>
        </View>
        <Pressable onPress={() => setScheduleOpen(true)}>
          <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 13, borderRadius: 12 }}>
            <Icon name="calPlus" size={13} color="#fff" strokeWidth={2.4} />
            <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: '#fff' }}>Schedule QHP</Text>
          </LinearGradient>
        </Pressable>
      </View>

      {/* Stat strip */}
      <View style={{ flexDirection: 'row', borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.28)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
        {([['REFRESH DUE', counts.due, C.red], ['ON TIME', counts.ontime, C.green], ['TO EXPLAIN', counts.explain, C.gold]] as [string, number, string][]).map(([lab, val, col], i) => (
          <View key={lab} style={{ flex: 1, alignItems: 'center', paddingVertical: 10, gap: 2, borderLeftWidth: i ? 1 : 0, borderLeftColor: 'rgba(255,255,255,0.06)' }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 16, color: col }}>{qhpQ.isLoading ? '…' : val}</Text>
            <Mono style={{ fontSize: 6.5, letterSpacing: 0.6, color: C.muted3 }}>{lab}</Mono>
          </View>
        ))}
      </View>

      {/* Filter + search */}
      <HScroll gap={6}>
        {([['all', 'All', C.orange, rows.length], ['due', 'Refresh Due', C.red, counts.due], ['ontime', 'On Time', C.green, counts.ontime], ['explain', 'To Explain', C.gold, counts.explain]] as [Filter, string, string, number][]).map(([id, label, col, n]) => {
          const active = filter === id;
          return (
            <AnimChip key={id} active={active} onPress={() => setFilter(id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 9, paddingHorizontal: 13, borderRadius: 12, backgroundColor: active ? hexA(col, 0.15) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(col, 0.5) : 'rgba(255,255,255,0.09)' }}>
              <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 11.5, color: active ? col : C.muted }}>{label}</Text>
              {!qhpQ.isLoading ? <Text style={{ fontFamily: F.mono, fontSize: 9, color: active ? col : C.muted3 }}>{n}</Text> : null}
            </AnimChip>
          );
        })}
      </HScroll>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 10, paddingHorizontal: 13, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
        <Icon name="search" size={15} color={C.muted3} strokeWidth={2} />
        <TextInput value={query} onChangeText={setQuery} placeholder="Search clients…" placeholderTextColor={C.muted3} autoCorrect={false} style={{ flex: 1, fontFamily: F.body, fontSize: 14, color: '#fff', padding: 0 }} />
      </View>

      {qhpQ.isLoading ? (
        <View style={{ alignItems: 'center', gap: 8, paddingVertical: 30 }}>
          <ActivityIndicator color={C.orange} />
          <Body style={{ fontSize: 12.5, color: C.muted3 }}>Loading QHP cycles…</Body>
        </View>
      ) : list.length === 0 ? (
        <View style={{ alignItems: 'center', gap: 9, paddingVertical: 28 }}>
          <Icon name="heart" size={26} color={C.muted3} strokeWidth={1.8} />
          <Body style={{ fontSize: 12.5, color: C.muted2 }}>No clients match.</Body>
        </View>
      ) : (
        list.slice(0, 50).map((r, i) => {
          const sm = STAGE_META[r.stage];
          const dueCol = !r.onTime ? C.red : r.daysToDue <= 7 ? C.gold : C.green;
          return (
            <View key={r.assessmentId} style={{ borderRadius: 17, backgroundColor: 'rgba(24,17,14,0.55)', borderWidth: 1, borderColor: !r.onTime ? hexA(C.red, 0.28) : 'rgba(255,150,90,0.12)', overflow: 'hidden' }}>
              <View style={{ height: 2.5, backgroundColor: hexA(dueCol, 0.55) }} />
              <View style={{ padding: 13, gap: 10 }}>
                {/* Client header + explicit View button (the card itself no longer navigates) */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
                  <MiniAvatar initial={initials(r.clientName)} colors={AVS[i % AVS.length]} size={40} />
                  <View style={{ flex: 1 }}>
                    <Body numberOfLines={1} style={{ fontSize: 14.5, fontFamily: F.bodySemi, color: '#fff' }}>{r.clientName}</Body>
                    <Mono style={{ fontSize: 7.5, color: C.muted3, marginTop: 2 }} numberOfLines={1}>
                      LAST QHP {istD(r.assessmentDate).toUpperCase()}{r.assessorName ? ` · ${r.assessorName.toUpperCase()}` : ''}
                    </Mono>
                  </View>
                  {r.mechanicalScore != null ? (
                    <View style={{ alignItems: 'center', paddingVertical: 5, paddingHorizontal: 10, borderRadius: 11, backgroundColor: hexA(C.blue, 0.1), borderWidth: 1, borderColor: hexA(C.blue, 0.32) }}>
                      <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: C.blue }}>{r.mechanicalScore}</Text>
                      <Mono style={{ fontSize: 6, color: C.muted3 }}>SCORE</Mono>
                    </View>
                  ) : null}
                  <Pressable onPress={() => openClient(r)} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 11, backgroundColor: hexA(C.orange, 0.12), borderWidth: 1, borderColor: hexA(C.orange, 0.4) }}>
                    <Icon name="eye" size={12} color={C.orange} strokeWidth={2.2} />
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: C.orange }}>View</Text>
                  </Pressable>
                </View>
                {/* Due + stage badges */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <Badge
                    text={!r.onTime ? `Refresh overdue ${Math.abs(r.daysToDue)}d` : `Next due ${istD(r.nextDue)} · ${r.daysToDue}d`}
                    color={dueCol}
                  />
                  <Badge text={sm.label} color={sm.color} />
                  {r.stage === 'on_hold' && r.heldByName ? <Badge text={`Held by ${r.heldByName}`} color={C.red} /> : null}
                </View>
                {/* Full journey — vertical stepper, always fully visible */}
                <View style={{ padding: 11, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.24)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' }}>
                  {([
                    { label: 'Assigned to assessor', done: !!r.assignedAt, who: r.assessorName, at: r.assignedAt, pendingText: 'Not assigned' },
                    { label: 'Assessor completed QHP', done: !!r.completedAt, who: r.assessorName, at: r.completedAt, pendingText: 'In progress' },
                    { label: 'Report generated', done: !!r.reportCreatedAt, who: null, at: r.reportCreatedAt, pendingText: 'Not generated yet' },
                    { label: 'Senior Researcher sign-off', done: !!r.seniorSignedAt, who: r.seniorName, at: r.seniorSignedAt, pendingText: r.stage === 'on_hold' ? 'On hold' : 'Pending sign-off' },
                    { label: 'HOD sign-off', done: !!r.hodSignedAt, who: r.hodName, at: r.hodSignedAt, pendingText: r.seniorSignedAt ? 'Pending sign-off' : 'Waiting on Senior' },
                  ] as { label: string; done: boolean; who: string | null; at: string | null; pendingText: string }[]).map((st, si, arr) => {
                    const isCurrent = !st.done && (si === 0 || arr[si - 1].done);
                    const col = st.done ? C.green : st.pendingText === 'On hold' ? C.red : isCurrent ? C.gold : C.muted3;
                    return (
                      <View key={si} style={{ flexDirection: 'row', gap: 10 }}>
                        {/* Rail: circle + connector */}
                        <View style={{ alignItems: 'center', width: 18 }}>
                          <View style={{ width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: st.done ? hexA(C.green, 0.2) : isCurrent ? hexA(col, 0.15) : 'transparent', borderWidth: 1.5, borderColor: st.done ? C.green : hexA(col, 0.7) }}>
                            {st.done ? <Icon name="checks" size={9} color={C.green} strokeWidth={3} /> : isCurrent ? <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: col }} /> : null}
                          </View>
                          {si < arr.length - 1 ? <View style={{ flex: 1, width: 1.5, minHeight: 14, backgroundColor: st.done ? hexA(C.green, 0.45) : 'rgba(255,255,255,0.1)' }} /> : null}
                        </View>
                        {/* Step text */}
                        <View style={{ flex: 1, paddingBottom: si < arr.length - 1 ? 10 : 0 }}>
                          <Body style={{ fontSize: 12, fontFamily: st.done || isCurrent ? F.bodySemi : F.body, color: st.done ? '#fff' : isCurrent ? col : C.muted3 }}>{st.label}</Body>
                          <Mono style={{ fontSize: 8, color: st.done ? C.muted2 : C.muted3, marginTop: 1 }} numberOfLines={1}>
                            {st.done ? `${st.who ? st.who.toUpperCase() + ' · ' : ''}${istD(st.at).toUpperCase()}` : st.pendingText.toUpperCase()}
                          </Mono>
                        </View>
                      </View>
                    );
                  })}
                </View>
                {/* Explained to client */}
                {r.explainedAt ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, padding: 9, borderRadius: 11, backgroundColor: hexA(C.green, 0.06), borderWidth: 1, borderColor: hexA(C.green, 0.25) }}>
                    <Icon name="checks" size={12} color={C.green} strokeWidth={2.5} />
                    <Body style={{ flex: 1, fontSize: 11, color: C.ink3 }}>Explained to client{r.explainedByName ? ` by ${r.explainedByName}` : ''} · {istD(r.explainedAt)}</Body>
                  </View>
                ) : needsExplain(r) ? (
                  <Pressable onPress={() => markExplained(r)} disabled={explainM.isPending} style={{ opacity: explainM.isPending ? 0.6 : 1 }}>
                    <LinearGradient colors={[hexA(C.gold, 0.9), hexA(C.orange, 0.9)]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 10, borderRadius: 11 }}>
                      <Icon name="bubble" size={13} color="#fff" strokeWidth={2.3} />
                      <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: '#fff' }}>Mark Explained to Client</Text>
                    </LinearGradient>
                  </Pressable>
                ) : null}
              </View>
            </View>
          );
        })
      )}
      {list.length > 50 ? <Body style={{ fontSize: 11, color: C.muted3, textAlign: 'center' }}>+{list.length - 50} more — refine the search</Body> : null}

      <ScheduleQhpSheet visible={scheduleOpen} onClose={() => setScheduleOpen(false)} crmId={crmId} />
    </Page>
  );
}

/* ---------- Schedule New QHP (web ScheduleQHPDialog → qhp_schedule) ---------- */
function ScheduleQhpSheet({ visible, onClose, crmId }: { visible: boolean; onClose: () => void; crmId: string | null }) {
  const clientsQ = useCrmClientList(visible ? crmId : null, 'active');
  const scheduleM = useScheduleQhp();
  const [client, setClient] = React.useState<{ id: string; name: string } | null>(null);
  const [q, setQ] = React.useState('');
  const [dayOffset, setDayOffset] = React.useState(1);
  const [time, setTime] = React.useState('10:00');
  const [address, setAddress] = React.useState('');
  const [notes, setNotes] = React.useState('');

  React.useEffect(() => {
    if (visible) { setClient(null); setQ(''); setDayOffset(1); setTime('10:00'); setAddress(''); setNotes(''); }
  }, [visible]);

  const query = q.trim().toLowerCase();
  const clients = (clientsQ.data ?? []).filter((c) => !query || c.name.toLowerCase().includes(query));
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(Date.now() + (i + 1) * 864e5);
    return { offset: i + 1, label: d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short' }), date: d.getDate(), iso: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` };
  });

  const submit = async () => {
    if (!crmId || !client) return;
    const day = days.find((d) => d.offset === dayOffset)!;
    try {
      await scheduleM.mutateAsync({ clientId: client.id, scheduledBy: crmId, date: day.iso, time, address, notes });
      onClose();
      Alert.alert('QHP scheduled', `${client.name} · ${day.iso} at ${time}`);
    } catch (e: any) { Alert.alert("Couldn't schedule", e?.message ?? 'Try again.'); }
  };

  return (
    <SheetShell visible={visible} onClose={onClose} accent={C.orange} icon="calPlus" title="Schedule New QHP" subtitle={client ? client.name.toUpperCase() : 'PICK A CLIENT'}>
      {!client ? (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 10, paddingHorizontal: 13, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
            <Icon name="search" size={14} color={C.muted3} strokeWidth={2} />
            <TextInput value={q} onChangeText={setQ} placeholder="Search your clients…" placeholderTextColor={C.muted3} autoCorrect={false} style={{ flex: 1, fontFamily: F.body, fontSize: 13.5, color: '#fff', padding: 0 }} />
          </View>
          {clients.slice(0, 40).map((c, i) => (
            <Pressable key={c.id} onPress={() => setClient(c)} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: 11, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }}>
              <MiniAvatar initial={initials(c.name)} colors={AVS[i % AVS.length]} size={34} />
              <Body numberOfLines={1} style={{ flex: 1, fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{c.name}</Body>
              <Icon name="chevRight" size={13} color={C.muted3} strokeWidth={2.2} />
            </Pressable>
          ))}
        </>
      ) : (
        <>
          <Pressable onPress={() => setClient(null)} style={{ alignSelf: 'flex-start', paddingVertical: 5, paddingHorizontal: 11, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}>
            <Text style={{ fontFamily: F.bodySemi, fontSize: 10.5, color: C.muted }}>Change client</Text>
          </Pressable>
          <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.muted3 }}>DATE</Mono>
          <HScroll gap={7}>
            {days.map((d) => {
              const active = dayOffset === d.offset;
              return (
                <AnimChip key={d.offset} active={active} onPress={() => setDayOffset(d.offset)} style={{ alignItems: 'center', paddingVertical: 9, paddingHorizontal: 13, borderRadius: 12, gap: 2, backgroundColor: active ? hexA(C.orange, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.orange, 0.5) : 'rgba(255,255,255,0.09)' }}>
                  <Mono style={{ fontSize: 7.5, color: active ? C.orange : C.muted3 }}>{d.label.toUpperCase()}</Mono>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: active ? C.orange : C.muted }}>{d.date}</Text>
                </AnimChip>
              );
            })}
          </HScroll>
          <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.muted3 }}>TIME</Mono>
          <TimeDial time={time} onChange={setTime} accent={C.orange} />
          <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.muted3 }}>ADDRESS</Mono>
          <TextInput value={address} onChangeText={setAddress} placeholder="Where does the assessment happen?" placeholderTextColor={C.muted3} style={{ paddingVertical: 9, paddingHorizontal: 11, borderRadius: 11, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', backgroundColor: 'rgba(0,0,0,0.25)', color: '#fff', fontFamily: F.body, fontSize: 13.5 }} />
          <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.muted3 }}>NOTES</Mono>
          <TextInput value={notes} onChangeText={setNotes} placeholder="Anything the assessor should know (optional)" placeholderTextColor={C.muted3} multiline style={{ minHeight: 56, textAlignVertical: 'top', paddingVertical: 9, paddingHorizontal: 11, borderRadius: 11, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', backgroundColor: 'rgba(0,0,0,0.25)', color: '#fff', fontFamily: F.body, fontSize: 13.5 }} />
          <Pressable onPress={submit} disabled={scheduleM.isPending} style={{ opacity: scheduleM.isPending ? 0.5 : 1 }}>
            <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ alignItems: 'center', paddingVertical: 12, borderRadius: 12 }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: '#fff' }}>{scheduleM.isPending ? 'Scheduling…' : 'Schedule QHP'}</Text>
            </LinearGradient>
          </Pressable>
        </>
      )}
    </SheetShell>
  );
}
