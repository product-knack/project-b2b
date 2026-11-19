/* CRM Session Logs (19 Nov 2026). Owner, with a screenshot of the web page: "add a page named Session Logs, inside
   show this session cancel code". The app copy of the web Session Logs "Today's Sessions" (hub-track
   src/pages/crm/DailyTask.tsx): pick a day, four status counts (a tap filters), the day's progress, search, and one
   row per session with time, logged / cancelled time, client, modality and trainer, the paid cancellation code of a
   Session-code member (hidden until tapped, hides again after a minute) and the status. Live: any change to
   session_schedule or training_sessions refreshes the day. Rules: lib/crmSessionLogs.ts. Doc:
   docs/features/android/crm/paid-cancel-codes.md */
import React from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator, RefreshControl, ScrollView } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useQueryClient } from '@tanstack/react-query';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { useAuth } from '../auth';
import { supabase } from '../lib/supabase';
import { invalidateDebounced } from '../lib/invalidateDebounced';
import { friendlyError } from '../lib/friendlyError';
import { useCrmDailySessions } from '../lib/crmQueries';
import {
  dateKeyLabel, donePercent, emptyDayLine, filterSessionLogs, initialsOf, istDateKey, istTime, loggedLine, nextFilter, NO_MATCH_LINE,
  PAID_CANCEL_HINT, SESSION_LOGS_SUB, SESSION_LOGS_TITLE, sessionLogCounts, shiftDateKey, showsPaidCancelCode, usedCodeLine,
  type SessionLogFilter, type SessionLogRow, type SessionLogStatus,
} from '../lib/crmSessionLogs';

const HIDE_AFTER_MS = 60_000;

const STATUS_META: Record<SessionLogStatus, { label: string; color: string; icon: any }> = {
  completed: { label: 'COMPLETED', color: C.green, icon: 'checks' },
  cancelled: { label: 'CANCELLED', color: C.red, icon: 'close' },
  scheduled: { label: 'SCHEDULED', color: C.gold, icon: 'clock' },
};

export function CrmSessionLogs() {
  const { session } = useAuth();
  const crmId = session?.user?.id ?? null;
  const qc = useQueryClient();
  const todayKey = istDateKey(Date.now());
  const [dateKey, setDateKey] = React.useState(todayKey);
  const [filter, setFilter] = React.useState<SessionLogFilter>('all');
  const [search, setSearch] = React.useState('');
  const q = useCrmDailySessions(crmId, dateKey);

  // Live updates: a roster or workout-log change refreshes the day (coalesced).
  React.useEffect(() => {
    if (!crmId) return;
    const refresh = () => invalidateDebounced(qc, ['crm-daily-sessions'], 800);
    const channel = supabase
      .channel(`crm-session-logs-${crmId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'session_schedule' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'training_sessions' }, refresh)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [crmId, qc]);

  const rows = q.data ?? [];
  const counts = sessionLogCounts(rows);
  const visible = filterSessionLogs(rows, filter, search);
  const pct = donePercent(counts.completed, counts.total);

  const cards: { key: SessionLogFilter; label: string; value: number; color: string; icon: any }[] = [
    { key: 'all', label: 'TOTAL', value: counts.total, color: C.blue, icon: 'calendar' },
    { key: 'completed', label: 'COMPLETED', value: counts.completed, color: C.green, icon: 'checks' },
    { key: 'cancelled', label: 'CANCELLED', value: counts.cancelled, color: C.red, icon: 'close' },
    { key: 'scheduled', label: 'SCHEDULED', value: counts.scheduled, color: C.gold, icon: 'clock' },
  ];

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: 16, paddingBottom: 140, gap: 14 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => { q.refetch(); }} tintColor={C.orange} colors={[C.orange]} />}
    >
      {/* title */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
        <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: hexA(C.orange, 0.14), borderWidth: 1, borderColor: hexA(C.orange, 0.35), alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="calendar" size={18} color={C.orange} strokeWidth={2} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 20, color: '#fff' }}>{SESSION_LOGS_TITLE}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 1 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.green }} />
            <Text style={{ fontFamily: F.body, fontSize: 11.5, color: C.muted2 }}>{SESSION_LOGS_SUB}</Text>
          </View>
        </View>
      </View>

      {/* day picker */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.04)', height: 40 }}>
          <Pressable onPress={() => setDateKey((d) => shiftDateKey(d, -1))} hitSlop={10} accessibilityLabel="Previous day" style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="chevLeft" size={17} color={C.ink2} strokeWidth={2.2} />
          </Pressable>
          <Text style={{ flex: 1, textAlign: 'center', fontFamily: F.bodySemi, fontSize: 13.5, color: '#fff' }}>{dateKeyLabel(dateKey)}</Text>
          <Pressable onPress={() => setDateKey((d) => shiftDateKey(d, 1))} hitSlop={10} accessibilityLabel="Next day" style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="chevRight" size={17} color={C.ink2} strokeWidth={2.2} />
          </Pressable>
        </View>
        {dateKey !== todayKey ? (
          <Pressable onPress={() => setDateKey(todayKey)} hitSlop={10} style={{ height: 40, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: hexA(C.orange, 0.4), backgroundColor: hexA(C.orange, 0.12), alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: C.orange }}>Today</Text>
          </Pressable>
        ) : null}
      </View>

      {/* search */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.04)', paddingHorizontal: 14, height: 40 }}>
        <Icon name="search" size={15} color={C.muted3} strokeWidth={2} />
        <TextInput value={search} onChangeText={setSearch} placeholder="Search client, trainer..." placeholderTextColor={C.muted3} autoCorrect={false}
          style={{ flex: 1, fontFamily: F.body, fontSize: 14, color: '#fff', padding: 0 }} />
        {search ? <Pressable onPress={() => setSearch('')} hitSlop={10} accessibilityLabel="Clear search"><Icon name="close" size={14} color={C.muted3} strokeWidth={2.2} /></Pressable> : null}
      </View>

      {/* status counts: a tap filters */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {cards.map((c) => {
          const active = filter === c.key;
          return (
            <Pressable key={c.key} onPress={() => setFilter((f) => nextFilter(f, c.key))} accessibilityRole="button" accessibilityState={{ selected: active }}
              style={({ pressed }) => ({ width: '47.5%', flexGrow: 1, borderRadius: 15, padding: 12, backgroundColor: active ? hexA(c.color, 0.12) : 'rgba(24,17,14,0.55)', borderWidth: 1, borderColor: active ? hexA(c.color, 0.6) : 'rgba(255,255,255,0.08)', opacity: pressed ? 0.85 : 1 })}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View>
                  <Text style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: 0.8, color: C.muted3 }}>{c.label}</Text>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 22, color: '#fff', marginTop: 2 }}>{q.isPending ? '-' : c.value}</Text>
                </View>
                <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: hexA(c.color, 0.14), alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={c.icon} size={15} color={c.color} strokeWidth={2.2} />
                </View>
              </View>
            </Pressable>
          );
        })}
      </View>

      {/* progress of the day */}
      {counts.total > 0 ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 13, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', backgroundColor: 'rgba(24,17,14,0.55)', paddingHorizontal: 13, paddingVertical: 10 }}>
          <Text style={{ fontFamily: F.bodySemi, fontSize: 11.5, color: C.muted2 }}>{counts.completed} of {counts.total} done</Text>
          <View style={{ flex: 1, height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
            <View style={{ width: `${pct}%`, height: '100%', borderRadius: 4, backgroundColor: C.green }} />
          </View>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 11.5, color: C.green }}>{pct}%</Text>
        </View>
      ) : null}

      {/* the sessions */}
      {q.isError ? (
        <View style={{ alignItems: 'center', gap: 8, paddingVertical: 24 }}>
          <Text style={{ fontFamily: F.body, fontSize: 13, color: C.muted2, textAlign: 'center' }}>{friendlyError(q.error, 'The sessions could not be loaded. Check your connection and try again.')}</Text>
          <Pressable onPress={() => q.refetch()} hitSlop={10}><Text style={{ fontFamily: F.bodySemi, color: C.orange }}>Try again</Text></Pressable>
        </View>
      ) : q.isPending ? (
        <View style={{ paddingVertical: 30 }}><ActivityIndicator color={C.orange} /></View>
      ) : visible.length === 0 ? (
        <View style={{ alignItems: 'center', gap: 10, paddingVertical: 30, borderRadius: 16, borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.12)' }}>
          <Icon name="calendar" size={20} color={C.muted3} strokeWidth={2} />
          <Text style={{ fontFamily: F.body, fontSize: 13, color: C.muted2, textAlign: 'center', paddingHorizontal: 20 }}>{rows.length === 0 ? emptyDayLine(dateKey) : NO_MATCH_LINE}</Text>
        </View>
      ) : (
        <View style={{ borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', backgroundColor: 'rgba(24,17,14,0.55)' }}>
          {visible.map((r, i) => <SessionRow key={r.id} r={r} first={i === 0} />)}
        </View>
      )}
    </ScrollView>
  );
}

function SessionRow({ r, first }: { r: SessionLogRow; first: boolean }) {
  const meta = STATUS_META[r.status];
  const logged = loggedLine(r);
  return (
    <View style={{ flexDirection: 'row', borderTopWidth: first ? 0 : 1, borderTopColor: 'rgba(255,255,255,0.06)', backgroundColor: r.status === 'completed' ? hexA(C.green, 0.03) : r.status === 'cancelled' ? hexA(C.red, 0.03) : 'transparent' }}>
      <View style={{ width: 4, backgroundColor: hexA(meta.color, r.status === 'scheduled' ? 0.6 : 0.8) }} />
      <View style={{ flex: 1, paddingVertical: 12, paddingLeft: 12, paddingRight: 12, gap: 9 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ width: 72 }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: '#fff' }}>{istTime(r.scheduledAt)}</Text>
            {logged ? <Text style={{ fontFamily: F.bodySemi, fontSize: 10.5, color: r.status === 'cancelled' ? C.red : C.green, marginTop: 2 }}>{logged}</Text> : null}
          </View>
          <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: hexA(C.blue, 0.14), borderWidth: 1, borderColor: hexA(C.blue, 0.3), alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: '#B9C4F5' }}>{initialsOf(r.clientName)}</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontFamily: F.bodySemi, fontSize: 14.5, color: '#fff' }}>{r.clientName}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
              <Icon name="dumbbell" size={11} color={C.muted3} strokeWidth={2} />
              <Text numberOfLines={1} style={{ flex: 1, fontFamily: F.body, fontSize: 11.5, color: C.muted2 }}>{r.modality} · {r.trainerName}</Text>
            </View>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 8 }}>
          {showsPaidCancelCode(r) ? <PaidCancelCodePill code={r.paidCancelCode as string} verifiedAt={r.paidCancelVerifiedAt} /> : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: hexA(meta.color, 0.45), backgroundColor: hexA(meta.color, 0.12) }}>
            <Icon name={meta.icon} size={11} color={meta.color} strokeWidth={2.4} />
            <Text style={{ fontFamily: F.bodyBold, fontSize: 10, letterSpacing: 0.6, color: meta.color }}>{meta.label}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

/** The paid cancellation code, hidden until tapped (hides again after a minute); green with VERIFIED once the trainer
    used it. The same badge as the web Session Logs. */
function PaidCancelCodePill({ code, verifiedAt }: { code: string; verifiedAt: string | null }) {
  const [shown, setShown] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const color = verifiedAt ? C.green : C.gold;
  const toggle = () => {
    if (timer.current) clearTimeout(timer.current);
    if (shown) { setShown(false); return; }
    Haptics.selectionAsync().catch(() => {});
    setShown(true);
    timer.current = setTimeout(() => setShown(false), HIDE_AFTER_MS);
  };
  return (
    <Pressable onPress={toggle} hitSlop={10} accessibilityRole="button"
      accessibilityLabel={verifiedAt ? usedCodeLine(verifiedAt) : shown ? 'Hide the paid cancellation code' : PAID_CANCEL_HINT}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 5, paddingHorizontal: 11, borderRadius: 999, borderWidth: 1, borderColor: hexA(color, 0.5), backgroundColor: hexA(color, shown ? 0.2 : 0.1), opacity: pressed ? 0.85 : 1 })}>
      <Icon name="rupee" size={11} color={color} strokeWidth={2.4} />
      <Text selectable={shown} style={{ fontFamily: F.mono, fontSize: shown ? 12 : 9.5, letterSpacing: shown ? 2 : 0.8, color }}>
        {shown ? `PAID CANCEL ${code}` : 'PAID CANCEL CODE'}{verifiedAt ? ' · VERIFIED' : ''}
      </Text>
    </Pressable>
  );
}
