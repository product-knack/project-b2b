import React from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator, Alert } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C, F, hexA, ORANGE_GRAD } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono } from '../components/primitives';
import { Page, Badge, MiniAvatar, AnimChip, HScroll, TimeDial } from './common';
import { useServiceBookings, useUpdateServiceBooking, ServiceBooking } from '../lib/serviceQueries';
import { SheetShell } from './reportDetail';

/* ============ CRM: Service Requests — mirrors the web CRMServiceRequests:
   approve / reject / reschedule client service bookings. ============ */

const initials = (n: string) => n.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
const AVS: [string, string][] = [['#F0883E', '#C05621'], ['#4FD1C5', '#2C7A7B'], ['#B794F4', '#6B46C1'], ['#F687B3', '#B83280'], ['#68D391', '#276749'], ['#63B3ED', '#2B6CB0']];
const pretty = (t: string | null) => (t || '—').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const fmtDate = (d: string | null) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: '2-digit', month: 'short' }) : '—');
const fmtTime = (t: string | null) => {
  if (!t) return '—';
  const [h, m] = t.split(':').map(Number);
  const am = h < 12;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${am ? 'AM' : 'PM'}`;
};

const STATUS_META: Record<string, { label: string; color: string }> = {
  pending: { label: 'Pending', color: C.gold },
  confirmed: { label: 'Confirmed', color: C.green },
  completed: { label: 'Completed', color: C.blue },
  cancelled: { label: 'Cancelled', color: C.muted2 },
};

export function CrmService() {
  const bookingsQ = useServiceBookings();
  const updateM = useUpdateServiceBooking();
  const [tab, setTab] = React.useState<string>('pending');
  const [query, setQuery] = React.useState('');
  const [reschedule, setReschedule] = React.useState<ServiceBooking | null>(null);

  const all = bookingsQ.data ?? [];
  const count = (s: string) => all.filter((b) => b.status === s).length;
  const q = query.trim().toLowerCase();
  const list = all
    .filter((b) => b.status === tab)
    .filter((b) => !q || b.clientName.toLowerCase().includes(q) || b.serviceName.toLowerCase().includes(q));

  const act = (b: ServiceBooking, status: 'confirmed' | 'cancelled') => {
    const verb = status === 'confirmed' ? 'Approve' : 'Reject';
    Alert.alert(`${verb} this request?`, `${b.clientName} — ${b.serviceName}\n${fmtDate(b.preferredDate)} · ${fmtTime(b.preferredTime)}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: verb, style: status === 'cancelled' ? 'destructive' : 'default', onPress: () => updateM.mutate({ id: b.id, status }, { onError: (e: any) => Alert.alert("Couldn't update", e?.message) }) },
    ]);
  };

  return (
    <Page gap={13} pt={6}>
      <View>
        <Serif style={{ fontSize: 24 }}>Service Requests</Serif>
        <Body style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>Approve, reschedule or reject client bookings</Body>
      </View>

      {/* Status tabs */}
      <HScroll gap={7}>
        {(['pending', 'confirmed', 'completed', 'cancelled'] as const).map((id) => {
          const meta = STATUS_META[id];
          const active = tab === id;
          const n = count(id);
          return (
            <AnimChip key={id} active={active} onPress={() => setTab(id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 9, paddingHorizontal: 14, borderRadius: 12, backgroundColor: active ? hexA(meta.color, 0.15) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(meta.color, 0.5) : 'rgba(255,255,255,0.08)' }}>
              <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 12, color: active ? meta.color : C.muted }}>{meta.label}</Text>
              {bookingsQ.data ? <Text style={{ fontFamily: F.mono, fontSize: 9.5, color: active ? meta.color : C.muted3 }}>{n}</Text> : null}
            </AnimChip>
          );
        })}
      </HScroll>

      {/* Search */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 10, paddingHorizontal: 13, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
        <Icon name="search" size={15} color={C.muted3} strokeWidth={2} />
        <TextInput value={query} onChangeText={setQuery} placeholder="Search by client or service…" placeholderTextColor={C.muted3} autoCorrect={false} style={{ flex: 1, fontFamily: F.body, fontSize: 14, color: '#fff', padding: 0 }} />
      </View>

      {bookingsQ.isLoading ? (
        <View style={{ alignItems: 'center', gap: 8, paddingVertical: 30 }}>
          <ActivityIndicator color={C.orange} />
          <Body style={{ fontSize: 12.5, color: C.muted3 }}>Loading requests…</Body>
        </View>
      ) : list.length === 0 ? (
        <View style={{ alignItems: 'center', gap: 9, paddingVertical: 28 }}>
          <Icon name={tab === 'pending' ? 'checks' : 'inbox'} size={26} color={tab === 'pending' ? C.green : C.muted3} strokeWidth={2} />
          <Body style={{ fontSize: 12.5, color: tab === 'pending' ? C.green : C.muted2, fontFamily: tab === 'pending' ? F.bodySemi : F.body }}>
            {tab === 'pending' ? 'No pending requests — all caught up.' : `No ${tab} requests.`}
          </Body>
        </View>
      ) : (
        list.slice(0, 40).map((b, i) => {
          const meta = STATUS_META[b.status] ?? STATUS_META.pending;
          return (
            <View key={b.id} style={{ borderRadius: 16, backgroundColor: 'rgba(24,17,14,0.55)', borderWidth: 1, borderColor: hexA(meta.color, 0.2), overflow: 'hidden' }}>
              <View style={{ height: 2.5, backgroundColor: hexA(meta.color, 0.5) }} />
              <View style={{ padding: 13, gap: 10 }}>
                {/* Service line */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Body style={{ flex: 1, fontSize: 14.5, fontFamily: F.bodySemi, color: '#fff' }} numberOfLines={1}>{b.serviceName}</Body>
                  {b.category ? <Badge text={pretty(b.category)} color={C.purple} /> : null}
                  <Badge text={meta.label} color={meta.color} />
                </View>
                {/* Client line */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                  <MiniAvatar initial={initials(b.clientName)} colors={AVS[i % AVS.length]} size={30} />
                  <View style={{ flex: 1 }}>
                    <Body numberOfLines={1} style={{ fontSize: 12.5, color: C.ink3 }}>{b.clientName}</Body>
                    {b.bookingType ? <Mono style={{ fontSize: 7.5, color: C.muted3, marginTop: 1 }}>{pretty(b.bookingType).toUpperCase()}</Mono> : null}
                  </View>
                </View>
                {/* Requested slot */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 11, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.26)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' }}>
                  <Icon name="calendar" size={13} color={meta.color} strokeWidth={2.2} />
                  <Body style={{ flex: 1, fontSize: 12.5, color: '#fff', fontFamily: F.bodySemi }}>{fmtDate(b.preferredDate)} · {fmtTime(b.preferredTime)}</Body>
                  {b.durationMin ? <Mono style={{ fontSize: 8.5, color: C.muted3 }}>{b.durationMin} MIN</Mono> : null}
                </View>
                {b.notes ? <Body style={{ fontSize: 11.5, color: C.muted2 }} numberOfLines={2}>{b.notes}</Body> : null}
                {/* Actions */}
                {b.status === 'pending' ? (
                  <View style={{ flexDirection: 'row', gap: 7 }}>
                    <Pressable onPress={() => act(b, 'confirmed')} style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10, backgroundColor: hexA(C.green, 0.13), borderWidth: 1, borderColor: hexA(C.green, 0.4) }}>
                      <Text style={{ fontFamily: F.bodyBold, fontSize: 11.5, color: C.green }}>Approve</Text>
                    </Pressable>
                    <Pressable onPress={() => setReschedule(b)} style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10, backgroundColor: hexA(C.gold, 0.1), borderWidth: 1, borderColor: hexA(C.gold, 0.35) }}>
                      <Text style={{ fontFamily: F.bodyBold, fontSize: 11.5, color: C.gold }}>Reschedule</Text>
                    </Pressable>
                    <Pressable onPress={() => act(b, 'cancelled')} style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10, backgroundColor: hexA(C.red, 0.09), borderWidth: 1, borderColor: hexA(C.red, 0.3) }}>
                      <Text style={{ fontFamily: F.bodyBold, fontSize: 11.5, color: C.red }}>Reject</Text>
                    </Pressable>
                  </View>
                ) : b.status === 'confirmed' ? (
                  <View style={{ flexDirection: 'row', gap: 7 }}>
                    <Pressable onPress={() => updateM.mutate({ id: b.id, status: 'completed' }, { onError: (e: any) => Alert.alert("Couldn't update", e?.message) })} style={{ flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 10, backgroundColor: hexA(C.blue, 0.1), borderWidth: 1, borderColor: hexA(C.blue, 0.35) }}>
                      <Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: C.blue }}>Mark Completed</Text>
                    </Pressable>
                    <Pressable onPress={() => setReschedule(b)} style={{ flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 10, backgroundColor: hexA(C.gold, 0.1), borderWidth: 1, borderColor: hexA(C.gold, 0.35) }}>
                      <Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: C.gold }}>Reschedule</Text>
                    </Pressable>
                  </View>
                ) : null}
                <Mono style={{ fontSize: 7.5, color: C.muted3 }}>REQUESTED {new Date(b.createdAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' }).toUpperCase()}</Mono>
              </View>
            </View>
          );
        })
      )}
      {list.length > 40 ? <Body style={{ fontSize: 11, color: C.muted3, textAlign: 'center' }}>+{list.length - 40} more — refine the search</Body> : null}

      <RescheduleSheet booking={reschedule} onClose={() => setReschedule(null)} />
    </Page>
  );
}

/* ---------- Reschedule sheet: pick a day + time slot ---------- */
function RescheduleSheet({ booking, onClose }: { booking: ServiceBooking | null; onClose: () => void }) {
  const updateM = useUpdateServiceBooking();
  const [dayOffset, setDayOffset] = React.useState(1);
  const [time, setTime] = React.useState('10:00');

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.now() + (i + 1) * 864e5);
    return {
      offset: i + 1,
      label: d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short' }),
      date: d.getDate(),
      iso: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    };
  });

  const submit = async () => {
    if (!booking) return;
    const day = days.find((d) => d.offset === dayOffset)!;
    try {
      await updateM.mutateAsync({ id: booking.id, status: 'confirmed', newDate: day.iso, newTime: `${time}:00` });
      onClose();
    } catch (e: any) { Alert.alert("Couldn't reschedule", e?.message ?? 'Try again.'); }
  };

  return (
    <SheetShell visible={!!booking} onClose={onClose} accent={C.gold} icon="calendar" title="Reschedule & Confirm" subtitle={booking ? `${booking.clientName.toUpperCase()} · ${booking.serviceName.toUpperCase()}` : undefined}>
      <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.muted3 }}>PICK A DAY</Mono>
      <HScroll gap={7}>
        {days.map((d) => {
          const active = dayOffset === d.offset;
          return (
            <AnimChip key={d.offset} active={active} onPress={() => setDayOffset(d.offset)} style={{ alignItems: 'center', paddingVertical: 9, paddingHorizontal: 14, borderRadius: 12, backgroundColor: active ? hexA(C.gold, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.gold, 0.5) : 'rgba(255,255,255,0.09)', gap: 2 }}>
              <Mono style={{ fontSize: 7.5, color: active ? C.gold : C.muted3 }}>{d.label.toUpperCase()}</Mono>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: active ? C.gold : C.muted }}>{d.date}</Text>
            </AnimChip>
          );
        })}
      </HScroll>
      <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.muted3 }}>PICK A TIME — HOUR & MINUTES</Mono>
      <TimeDial time={time} onChange={setTime} accent={C.gold} />
      <Body style={{ fontSize: 11, color: C.muted3 }}>Rescheduling confirms the booking with the new slot.</Body>
      <Pressable onPress={submit} disabled={updateM.isPending} style={{ opacity: updateM.isPending ? 0.5 : 1 }}>
        <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ alignItems: 'center', paddingVertical: 12, borderRadius: 12 }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: '#fff' }}>{updateM.isPending ? 'Saving…' : 'Confirm New Slot'}</Text>
        </LinearGradient>
      </Pressable>
    </SheetShell>
  );
}
