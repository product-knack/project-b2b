import React from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C, F, hexA, ORANGE_GRAD } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono, ProgressBar } from '../components/primitives';
import { Page, Badge, MiniAvatar, AnimChip, HScroll } from './common';
import { useStore } from '../store';
import { useAuth } from '../auth';
import { useInactiveClients, useSessionsBreakdown, INACTIVE_PERIODS, BREAKDOWN_PERIODS } from '../lib/consumeQueries';
import { useUpcomingRoster } from '../lib/crmClientDetailQueries';
import { SheetShell } from './reportDetail';

/* ============ CRM: Session Consumption — mirrors the web page:
   Inactive Clients (no completed session in N days) + Sessions Breakdown by role. ============ */

const initials = (n: string) => n.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
const AVS: [string, string][] = [['#F0883E', '#C05621'], ['#4FD1C5', '#2C7A7B'], ['#B794F4', '#6B46C1'], ['#F687B3', '#B83280'], ['#68D391', '#276749'], ['#63B3ED', '#2B6CB0']];
const istDT = (iso: string | null) => (iso ? `${new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' })} · ${new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase()}` : '—');
const pretty = (t: string | null) => (t || '—').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const ROLE_COLORS: Record<string, string> = {
  Trainers: C.orange, Doctors: C.red, Coaches: C.blue, Physiotherapists: C.purple, CRM: C.gold, Administrators: C.muted2, Others: C.muted2,
};

export function CrmConsume() {
  const { go, set } = useStore();
  const { session } = useAuth();
  const crmId = session?.user?.id ?? null;
  const [tab, setTab] = React.useState<'inactive' | 'breakdown'>('inactive');
  const [inactiveDays, setInactiveDays] = React.useState<number>(3);
  const [breakdownDays, setBreakdownDays] = React.useState<number>(30);
  const [rosterFor, setRosterFor] = React.useState<{ id: string; name: string } | null>(null);
  const [expanded, setExpanded] = React.useState<string | null>(null);

  const inactiveQ = useInactiveClients(tab === 'inactive' ? crmId : null, inactiveDays);
  const breakdownQ = useSessionsBreakdown(tab === 'breakdown' ? crmId : null, breakdownDays);

  const openClient = (id: string, name: string) => { set({ selectedClientId: id, selectedClientName: name }); go('crm-client'); };

  return (
    <Page gap={13} pt={6}>
      <View>
        <Serif style={{ fontSize: 24 }}>Session Consumption</Serif>
        <Body style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>Track client activity and session breakdowns</Body>
      </View>

      {/* Tabs */}
      <View style={{ flexDirection: 'row', gap: 6, padding: 4, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.28)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' }}>
        {([['inactive', 'Inactive Clients', 'alert'], ['breakdown', 'Sessions Breakdown', 'users']] as const).map(([id, label, icon]) => {
          const active = tab === id;
          return (
            <AnimChip key={id} grow active={active} onPress={() => setTab(id)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 10, overflow: 'hidden', backgroundColor: active ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
              {active ? <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} /> : null}
              <Icon name={icon as any} size={13} color={active ? '#fff' : C.muted2} strokeWidth={2.2} />
              <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 12, color: active ? '#fff' : C.muted }}>{label}</Text>
            </AnimChip>
          );
        })}
      </View>

      {tab === 'inactive' ? (
        <>
          {/* Period chips */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.muted3 }}>NO SESSION IN</Mono>
            {inactiveQ.data ? <Badge text={`${inactiveQ.data.length} inactive`} color={inactiveQ.data.length ? C.red : C.green} /> : null}
          </View>
          <HScroll gap={6}>
            {INACTIVE_PERIODS.map((d) => {
              const active = inactiveDays === d;
              return (
                <AnimChip key={d} active={active} onPress={() => setInactiveDays(d)} style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: active ? hexA(C.red, 0.14) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.red, 0.5) : 'rgba(255,255,255,0.09)' }}>
                  <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 11.5, color: active ? C.red : C.muted }}>{d} days</Text>
                </AnimChip>
              );
            })}
          </HScroll>

          {inactiveQ.isLoading ? (
            <View style={{ alignItems: 'center', gap: 8, paddingVertical: 30 }}>
              <ActivityIndicator color={C.orange} />
              <Body style={{ fontSize: 12.5, color: C.muted3 }}>Checking activity…</Body>
            </View>
          ) : (inactiveQ.data ?? []).length === 0 ? (
            <View style={{ alignItems: 'center', gap: 9, paddingVertical: 28 }}>
              <Icon name="checks" size={26} color={C.green} strokeWidth={2} />
              <Body style={{ fontSize: 12.5, color: C.green, fontFamily: F.bodySemi }}>Everyone trained in the last {inactiveDays} days.</Body>
            </View>
          ) : (
            <View style={{ borderRadius: 17, backgroundColor: 'rgba(24,17,14,0.55)', borderWidth: 1, borderColor: hexA(C.red, 0.18), overflow: 'hidden' }}>
              <LinearGradient colors={[hexA(C.red, 0.5), 'rgba(255,255,255,0.02)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 2.5 }} />
              {(inactiveQ.data ?? []).map((c, i) => (
                <View key={c.id} style={{ paddingVertical: 12, paddingHorizontal: 13, gap: 9, borderTopWidth: i ? 1 : 0, borderTopColor: 'rgba(255,255,255,0.05)' }}>
                  <Pressable onPress={() => openClient(c.id, c.name)} style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
                    <MiniAvatar initial={initials(c.name)} colors={AVS[i % AVS.length]} size={38} />
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                        <Body numberOfLines={1} style={{ fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }}>{c.name}</Body>
                        <Badge text={c.daysInactive != null ? `${c.daysInactive} days inactive` : 'Never trained'} color={C.red} />
                      </View>
                      <Mono style={{ fontSize: 8, color: C.muted3, marginTop: 3 }}>
                        {c.totalSessions ? `${c.completed}/${c.totalSessions} USED` : `${c.completed} DONE`}
                        {c.sessionsPerCycle ? ` · ${c.remainingInCycle} LEFT IN CYCLE` : ''}
                        {c.subscription ? ` · ${c.subscription.toUpperCase()}` : ''}
                      </Mono>
                    </View>
                    <Pressable onPress={() => setRosterFor({ id: c.id, name: c.name })} hitSlop={6} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: 11, borderRadius: 999, backgroundColor: hexA(C.gold, 0.12), borderWidth: 1, borderColor: hexA(C.gold, 0.4) }}>
                      <Icon name="calendar" size={11} color={C.gold} strokeWidth={2.3} />
                      <Text style={{ fontFamily: F.bodyBold, fontSize: 10.5, color: C.gold }}>Roster</Text>
                    </Pressable>
                  </Pressable>
                  {/* Last workout details — like the web card */}
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 7, paddingHorizontal: 10, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.24)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' }}>
                      <Icon name="calendar" size={11} color={C.muted3} strokeWidth={2} />
                      <View style={{ flex: 1 }}>
                        <Mono style={{ fontSize: 6.5, letterSpacing: 0.6, color: C.muted3 }}>LAST WORKOUT</Mono>
                        <Body numberOfLines={1} style={{ fontSize: 11.5, color: c.lastWorkout ? '#fff' : C.muted3, marginTop: 1 }}>
                          {c.lastWorkout ? new Date(c.lastWorkout).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : 'Never'}
                        </Body>
                      </View>
                    </View>
                    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 7, paddingHorizontal: 10, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.24)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' }}>
                      <Icon name="user" size={11} color={C.muted3} strokeWidth={2} />
                      <View style={{ flex: 1 }}>
                        <Mono style={{ fontSize: 6.5, letterSpacing: 0.6, color: C.muted3 }}>LAST TRAINER</Mono>
                        <Body numberOfLines={1} style={{ fontSize: 11.5, color: c.lastTrainer ? '#fff' : C.muted3, marginTop: 1 }}>{c.lastTrainer ?? '—'}</Body>
                      </View>
                    </View>
                  </View>
                  {c.totalSessions ? <ProgressBar pct={Math.min(100, Math.round((c.completed / c.totalSessions) * 100))} height={5} fill={C.red} /> : null}
                </View>
              ))}
            </View>
          )}
        </>
      ) : (
        <>
          {/* Breakdown period chips */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.muted3 }}>SESSIONS IN THE LAST</Mono>
            {breakdownQ.data ? <Badge text={`${breakdownQ.data.reduce((a, b) => a + b.totalSessions, 0)} sessions`} color={C.blue} /> : null}
          </View>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {BREAKDOWN_PERIODS.map((d) => {
              const active = breakdownDays === d;
              return (
                <AnimChip key={d} grow active={active} onPress={() => setBreakdownDays(d)} style={{ alignItems: 'center', paddingVertical: 9, borderRadius: 11, backgroundColor: active ? hexA(C.blue, 0.15) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.blue, 0.5) : 'rgba(255,255,255,0.09)' }}>
                  <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 11.5, color: active ? C.blue : C.muted }}>{d} days</Text>
                </AnimChip>
              );
            })}
          </View>

          {breakdownQ.isLoading ? (
            <View style={{ alignItems: 'center', gap: 8, paddingVertical: 30 }}>
              <ActivityIndicator color={C.orange} />
              <Body style={{ fontSize: 12.5, color: C.muted3 }}>Crunching sessions…</Body>
            </View>
          ) : (breakdownQ.data ?? []).filter((c) => c.totalSessions > 0).length === 0 ? (
            <Body style={{ color: C.muted2, textAlign: 'center', paddingVertical: 26 }}>No sessions in this period.</Body>
          ) : (
            (breakdownQ.data ?? []).filter((c) => c.totalSessions > 0).slice(0, 40).map((c, i) => {
              const open = expanded === c.clientId;
              const max = Math.max(1, ...c.roles.map((r) => r.totalSessions));
              return (
                <View key={c.clientId} style={{ borderRadius: 16, backgroundColor: 'rgba(24,17,14,0.55)', borderWidth: 1, borderColor: 'rgba(255,150,90,0.12)', overflow: 'hidden' }}>
                  <Pressable onPress={() => setExpanded(open ? null : c.clientId)} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: 13 }}>
                    <MiniAvatar initial={initials(c.clientName)} colors={AVS[i % AVS.length]} size={36} />
                    <View style={{ flex: 1 }}>
                      <Body numberOfLines={1} style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{c.clientName}</Body>
                      <View style={{ flexDirection: 'row', gap: 5, marginTop: 4, flexWrap: 'wrap' }}>
                        {c.roles.map((r) => (
                          <View key={r.role} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 2, paddingHorizontal: 8, borderRadius: 999, backgroundColor: hexA(ROLE_COLORS[r.role] ?? C.muted2, 0.1), borderWidth: 1, borderColor: hexA(ROLE_COLORS[r.role] ?? C.muted2, 0.3) }}>
                            <Text style={{ fontFamily: F.bodySemi, fontSize: 9, color: ROLE_COLORS[r.role] ?? C.muted2 }}>{r.role} {r.totalSessions}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 16, color: C.blue }}>{c.totalSessions}</Text>
                    <Icon name={open ? 'chevUp' : 'chevDown'} size={13} color={C.muted2} strokeWidth={2.2} />
                  </Pressable>
                  {open ? (
                    <View style={{ paddingHorizontal: 13, paddingBottom: 12, gap: 8 }}>
                      {c.roles.map((r) => (
                        <View key={r.role} style={{ gap: 6 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: ROLE_COLORS[r.role] ?? C.muted2 }} />
                            <Body style={{ flex: 1, fontSize: 11.5, fontFamily: F.bodySemi, color: C.ink3 }}>{r.role}</Body>
                            <Mono style={{ fontSize: 8.5, color: C.muted3 }}>{r.totalSessions}</Mono>
                          </View>
                          <View style={{ height: 4, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.05)', overflow: 'hidden' }}>
                            <View style={{ width: `${Math.round((r.totalSessions / max) * 100)}%`, height: 4, backgroundColor: hexA(ROLE_COLORS[r.role] ?? C.muted2, 0.75) }} />
                          </View>
                          {r.professionals.map((p) => (
                            <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: 14 }}>
                              <Body style={{ flex: 1, fontSize: 11, color: C.muted2 }}>{p.name}</Body>
                              <Mono style={{ fontSize: 8.5, color: C.muted3 }}>{p.sessionCount} SESSION{p.sessionCount > 1 ? 'S' : ''}</Mono>
                            </View>
                          ))}
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              );
            })
          )}
        </>
      )}

      {/* Upcoming roster sheet */}
      <ConsumeRosterSheet target={rosterFor} onClose={() => setRosterFor(null)} />
    </Page>
  );
}

function ConsumeRosterSheet({ target, onClose }: { target: { id: string; name: string } | null; onClose: () => void }) {
  const rosterQ = useUpcomingRoster(target?.id ?? null);
  return (
    <SheetShell visible={!!target} onClose={onClose} accent={C.gold} icon="calendar" title="Upcoming Roster" subtitle={target?.name.toUpperCase()}>
      {rosterQ.isLoading ? <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 16 }}>Loading…</Body>
        : (rosterQ.data ?? []).length === 0 ? (
          <View style={{ alignItems: 'center', gap: 8, paddingVertical: 18 }}>
            <Icon name="alert" size={22} color={C.red} strokeWidth={2} />
            <Body style={{ fontSize: 12.5, color: C.red, fontFamily: F.bodySemi }}>Nothing scheduled — that's why they're inactive.</Body>
          </View>
        ) : (rosterQ.data ?? []).map((s: any) => (
          <View key={s.id} style={{ padding: 12, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: hexA(C.gold, 0.2), borderLeftWidth: 3, borderLeftColor: C.gold, gap: 5 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Body style={{ flex: 1, fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{pretty(s.modality || s.session_type)}</Body>
              <Badge text={pretty(s.status)} color={C.gold} />
            </View>
            <Body style={{ fontSize: 12, color: C.muted2 }}>{istDT(s.scheduled_datetime)} · {s.trainerName}</Body>
          </View>
        ))}
    </SheetShell>
  );
}
