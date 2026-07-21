import React from 'react';
import { View, Text, Pressable, ActivityIndicator, Linking } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono, Card } from '../components/primitives';
import { Page, BackLink, Badge, MiniAvatar, AnimChip, HScroll } from './common';
import { useStore } from '../store';
import { useAuth } from '../auth';
import { useBirthdaysToday, useSetClientDob, BirthdayClient } from '../lib/crmQueries';
import { SheetShell } from './reportDetail';
import { Alert } from 'react-native';

/* ============ CRM: Birthdays — everyone's upcoming birthdays in one place.
   Today (celebrate now) → This Week → Later This Month. ============ */

const initials = (n: string) => n.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
const AVS: [string, string][] = [['#F0883E', '#C05621'], ['#4FD1C5', '#2C7A7B'], ['#B794F4', '#6B46C1'], ['#F687B3', '#B83280'], ['#68D391', '#276749'], ['#63B3ED', '#2B6CB0']];
const fmtDay = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: '2-digit', month: 'short' });

function BirthdayRow({ b, i, accent, onPress }: { b: BirthdayClient; i: number; accent: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 11, paddingHorizontal: 13, borderTopWidth: i ? 1 : 0, borderTopColor: 'rgba(255,255,255,0.05)' }}>
      <MiniAvatar initial={initials(b.name)} colors={AVS[i % AVS.length]} size={38} />
      <View style={{ flex: 1 }}>
        <Body numberOfLines={1} style={{ fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }}>{b.name}</Body>
        <Mono style={{ fontSize: 8, color: C.muted3, marginTop: 2 }}>TURNING {b.ageTurning} · {fmtDay(b.date).toUpperCase()}</Mono>
      </View>
      <Badge
        text={b.daysUntil === 0 ? 'Today 🎂' : b.daysUntil === 1 ? 'Tomorrow' : `In ${b.daysUntil} days`}
        color={accent}
      />
      <Icon name="chevRight" size={14} color={C.muted3} strokeWidth={2.2} />
    </Pressable>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function CrmBirthdays() {
  const { go, set, back, canGoBack } = useStore();
  const { session } = useAuth();
  const crmId = session?.user?.id ?? null;
  const bQ = useBirthdaysToday(crmId);
  const d = bQ.data;
  const [view, setView] = React.useState<number | 'upcoming' | 'nodob'>('upcoming');
  const [dobFor, setDobFor] = React.useState<{ id: string; name: string } | null>(null);

  const openClient = (b: BirthdayClient) => { set({ selectedClientId: b.id, selectedClientName: b.name }); go('crm-client'); };
  const byMonth = (m: number) => (d?.all ?? []).filter((b) => b.bMonth === m).sort((a, b) => a.bDay - b.bDay || a.name.localeCompare(b.name));
  const thisMonth = new Date().getMonth();

  const Section = ({ title, accent, rows, empty }: { title: string; accent: string; rows: BirthdayClient[]; empty: string }) => (
    <Card colors={['rgba(46,28,18,0.4)', 'rgba(16,12,11,0.55)']} border={hexA(accent, 0.14)} radius={17} style={{ overflow: 'hidden' }}>
      <LinearGradient colors={[hexA(accent, 0.55), 'rgba(255,255,255,0.02)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 2.5 }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 13, paddingTop: 12, paddingBottom: rows.length ? 4 : 0 }}>
        <Body style={{ flex: 1, fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{title}</Body>
        <Mono style={{ fontSize: 9, color: accent }}>{rows.length || ''}</Mono>
      </View>
      {rows.length === 0
        ? <Body style={{ fontSize: 11.5, color: C.muted3, paddingHorizontal: 13, paddingVertical: 12 }}>{empty}</Body>
        : rows.map((b, i) => <BirthdayRow key={b.id} b={b} i={i} accent={accent} onPress={() => openClient(b)} />)}
    </Card>
  );

  return (
    <Page gap={13} pt={6}>
      <BackLink label="Dashboard" onPress={() => (canGoBack ? back() : go('crm-dashboard'))} />
      <View>
        <Serif style={{ fontSize: 24 }}>Birthdays 🎂</Serif>
        <Body style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>Upcoming client birthdays — a call goes a long way</Body>
      </View>

      {/* Month picker — Upcoming first, then Jan–Dec with counts */}
      <HScroll gap={6}>
        <AnimChip active={view === 'upcoming'} onPress={() => setView('upcoming')} style={{ paddingVertical: 9, paddingHorizontal: 14, borderRadius: 12, backgroundColor: view === 'upcoming' ? hexA(C.gold, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: view === 'upcoming' ? hexA(C.gold, 0.5) : 'rgba(255,255,255,0.09)' }}>
          <Text style={{ fontFamily: view === 'upcoming' ? F.bodyBold : F.bodySemi, fontSize: 12, color: view === 'upcoming' ? C.gold : C.muted }}>Upcoming</Text>
        </AnimChip>
        {MONTHS.map((label, m) => {
          const active = view === m;
          const n = byMonth(m).length;
          return (
            <AnimChip key={label} active={active} onPress={() => setView(m)} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 9, paddingHorizontal: 12, borderRadius: 12, backgroundColor: active ? hexA(C.orange, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.orange, 0.5) : m === thisMonth ? hexA(C.orange, 0.25) : 'rgba(255,255,255,0.09)' }}>
              <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 12, color: active ? C.orange : m === thisMonth ? C.ink3 : C.muted }}>{label}</Text>
              {!bQ.isLoading && n ? <Text style={{ fontFamily: F.mono, fontSize: 9, color: active ? C.orange : C.muted3 }}>{n}</Text> : null}
            </AnimChip>
          );
        })}
        <AnimChip active={view === 'nodob'} onPress={() => setView('nodob')} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 9, paddingHorizontal: 12, borderRadius: 12, backgroundColor: view === 'nodob' ? hexA(C.red, 0.15) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: view === 'nodob' ? hexA(C.red, 0.5) : 'rgba(255,255,255,0.09)' }}>
          <Text style={{ fontFamily: view === 'nodob' ? F.bodyBold : F.bodySemi, fontSize: 12, color: view === 'nodob' ? C.red : C.muted }}>No DOB</Text>
          {!bQ.isLoading && d?.missingDob ? <Text style={{ fontFamily: F.mono, fontSize: 9, color: view === 'nodob' ? C.red : C.muted3 }}>{d.missingDob}</Text> : null}
        </AnimChip>
      </HScroll>

      {bQ.isLoading ? (
        <View style={{ alignItems: 'center', gap: 8, paddingVertical: 30 }}>
          <ActivityIndicator color={C.orange} />
          <Body style={{ fontSize: 12.5, color: C.muted3 }}>Checking the calendar…</Body>
        </View>
      ) : view === 'upcoming' ? (
        <>
          <Section title="Today" accent={C.gold} rows={d?.today ?? []} empty="No birthdays today." />
          <Section title="This Week" accent={C.orange} rows={d?.week ?? []} empty="None in the next 7 days." />
          <Section title="Later This Month" accent={C.blue} rows={d?.month ?? []} empty="None in the next 31 days." />
        </>
      ) : view === 'nodob' ? (
        <Card colors={['rgba(46,28,18,0.4)', 'rgba(16,12,11,0.55)']} border={hexA(C.red, 0.16)} radius={17} style={{ overflow: 'hidden' }}>
          <LinearGradient colors={[hexA(C.red, 0.5), 'rgba(255,255,255,0.02)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 2.5 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 13, paddingTop: 12 }}>
            <Body style={{ flex: 1, fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>Missing Date of Birth</Body>
            <Mono style={{ fontSize: 9, color: C.red }}>{d?.missingDob ?? 0}</Mono>
          </View>
          <Body style={{ fontSize: 11, color: C.muted2, paddingHorizontal: 13, paddingTop: 3, paddingBottom: 4 }}>
            These clients won't get birthday reminders — collect their DOB on the next call.
          </Body>
          {(d?.missingDobClients ?? []).length === 0
            ? <Body style={{ fontSize: 11.5, color: C.green, paddingHorizontal: 13, paddingVertical: 12 }}>Every client has a date of birth on file — perfect.</Body>
            : (d?.missingDobClients ?? []).map((c, i) => (
              <Pressable key={c.id} onPress={() => setDobFor(c)} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 11, paddingHorizontal: 13, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)' }}>
                <MiniAvatar initial={initials(c.name)} colors={AVS[i % AVS.length]} size={34} />
                <Body numberOfLines={1} style={{ flex: 1, fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{c.name}</Body>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: 11, borderRadius: 999, backgroundColor: hexA(C.green, 0.12), borderWidth: 1, borderColor: hexA(C.green, 0.4) }}>
                  <Icon name="plus" size={10} color={C.green} strokeWidth={2.6} />
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 10.5, color: C.green }}>Add DOB</Text>
                </View>
              </Pressable>
            ))}
        </Card>
      ) : (
        <Section
          title={`${MONTHS[view]} Birthdays`}
          accent={view === thisMonth ? C.gold : C.orange}
          rows={byMonth(view)}
          empty={`No client birthdays in ${MONTHS[view]}.`}
        />
      )}
      {!bQ.isLoading && view !== 'nodob' && d?.missingDob ? (
        <Pressable onPress={() => setView('nodob')} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 11, borderRadius: 13, backgroundColor: hexA(C.red, 0.05), borderWidth: 1, borderColor: hexA(C.red, 0.22) }}>
          <Icon name="alert" size={13} color={C.red} strokeWidth={2.1} />
          <Body style={{ flex: 1, fontSize: 11, color: C.muted2 }}>{d.missingDob} client{d.missingDob > 1 ? 's have' : ' has'} no date of birth — tap to see who.</Body>
          <Icon name="chevRight" size={12} color={C.red} strokeWidth={2.3} />
        </Pressable>
      ) : null}

      <AddDobSheet target={dobFor} onClose={() => setDobFor(null)} />
    </Page>
  );
}

/* ---------- Add DOB sheet: day / month / year dials → clients.date_of_birth ---------- */
function AddDobSheet({ target, onClose }: { target: { id: string; name: string } | null; onClose: () => void }) {
  const saveM = useSetClientDob();
  const [day, setDay] = React.useState(15);
  const [month, setMonth] = React.useState(0);
  const [year, setYear] = React.useState(1990);
  React.useEffect(() => { if (target) { setDay(15); setMonth(0); setYear(1990); } }, [target?.id]);

  const nowYear = new Date().getFullYear();
  const years = Array.from({ length: nowYear - 10 - 1940 + 1 }, (_, i) => nowYear - 10 - i); // (nowYear-10) … 1940
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const dayClamped = Math.min(day, daysInMonth);
  const dob = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayClamped).padStart(2, '0')}`;
  const preview = new Date(dob + 'T00:00:00').toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'long', year: 'numeric' });
  const age = Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 864e5));

  const DialRow = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <View style={{ gap: 6 }}>
      <Mono style={{ fontSize: 8, letterSpacing: 0.8, color: C.muted3 }}>{label}</Mono>
      {children}
    </View>
  );
  const chip = (active: boolean, onPress: () => void, text: string, key: React.Key) => (
    <Pressable key={key} onPress={onPress} style={{ alignItems: 'center', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 11, backgroundColor: active ? hexA(C.gold, 0.18) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.gold, 0.55) : 'rgba(255,255,255,0.09)' }}>
      <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 12.5, color: active ? C.gold : C.muted }}>{text}</Text>
    </Pressable>
  );

  const save = async () => {
    if (!target) return;
    try {
      await saveM.mutateAsync({ clientId: target.id, dob });
      onClose();
      Alert.alert('Birthday saved 🎂', `${target.name} — ${preview}. They'll now appear in birthday reminders.`);
    } catch (e: any) { Alert.alert("Couldn't save", e?.message ?? 'Try again.'); }
  };

  return (
    <SheetShell visible={!!target} onClose={onClose} accent={C.gold} icon="gift" title="Add Date of Birth" subtitle={target?.name.toUpperCase()}>
      <DialRow label="DAY">
        <HScroll gap={6}>
          {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((dn) => chip(dayClamped === dn, () => setDay(dn), String(dn), dn))}
        </HScroll>
      </DialRow>
      <DialRow label="MONTH">
        <HScroll gap={6}>
          {MONTHS.map((m, i) => chip(month === i, () => setMonth(i), m, m))}
        </HScroll>
      </DialRow>
      <DialRow label="YEAR">
        <HScroll gap={6}>
          {years.map((y) => chip(year === y, () => setYear(y), String(y), y))}
        </HScroll>
      </DialRow>
      <View style={{ alignSelf: 'center', paddingVertical: 7, paddingHorizontal: 16, borderRadius: 999, backgroundColor: hexA(C.gold, 0.1), borderWidth: 1, borderColor: hexA(C.gold, 0.35) }}>
        <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: C.gold }}>{preview} · turns {age + 1} next</Text>
      </View>
      <Pressable onPress={save} disabled={saveM.isPending} style={{ opacity: saveM.isPending ? 0.5 : 1 }}>
        <LinearGradient colors={[hexA(C.gold, 0.95), hexA(C.orange, 0.95)]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ alignItems: 'center', paddingVertical: 12, borderRadius: 12 }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: '#fff' }}>{saveM.isPending ? 'Saving…' : 'Save Birthday'}</Text>
        </LinearGradient>
      </Pressable>
    </SheetShell>
  );
}
