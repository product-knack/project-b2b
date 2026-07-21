import React from 'react';
import { View, Text, Pressable, TextInput } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono, Card, Avatar } from '../components/primitives';
import { Page, Badge } from './common';
import { useAnalystTrainers, useAnalystTrainerClients, useAnalystClientWorkouts, AnalystTrainer, AnalystClient, AnalystSession, AnalystExercise } from '../lib/analystQueries';

/* ============ WORKOUT ANALYST ============
   Live port of the web WorkoutAnalyst page in the new design language:
   all trainers → a trainer's active clients → a client's logged workout
   history → full session breakdown (supersets boxed, sets tabled). */

const AVS: [string, string][] = [['#9A7BEA', '#6E5BD0'], ['#7C8FE8', '#5B6FD0'], ['#57C98A', '#3A9E6E'], ['#E0A53C', '#B57F1E'], ['#E75A9B', '#B03A6E'], ['#FB8B3A', '#EE5E16'], ['#4FB8C9', '#2E8A9E'], ['#C08A52', '#8F6237']];
const avFor = (name: string) => AVS[(name?.length || 0) % AVS.length];
const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || 'T';
const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

function SectionRow({ text, accent = C.mono2 }: { text: string; accent?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
      <Mono style={{ fontSize: 10, letterSpacing: 1.6, color: accent }}>{text}</Mono>
      <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.06)' }} />
    </View>
  );
}

function CenterNote({ text, tone = C.muted3 }: { text: string; tone?: string }) {
  return (
    <View style={{ alignItems: 'center', gap: 10, paddingVertical: 26, borderRadius: 18, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.08)', backgroundColor: 'rgba(255,255,255,0.015)' }}>
      <Body style={{ fontSize: 12.5, color: tone, textAlign: 'center', paddingHorizontal: 24 }}>{text}</Body>
    </View>
  );
}

function BackRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Icon name="arrowLeft" size={15} color={C.ink2} strokeWidth={2.2} />
      <Body style={{ fontSize: 13.5, fontFamily: F.bodySemi }}>{label}</Body>
    </Pressable>
  );
}

/* Hero header used on drill-down levels: gradient-ring avatar + title + sub chips. */
function HeroHeader({ name, sub, accent }: { name: string; sub: string; accent: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 13 }}>
      <LinearGradient colors={avFor(name)} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: 2.5, borderRadius: 30 }}>
        <View style={{ padding: 2, borderRadius: 27, backgroundColor: C.bg }}>
          <Avatar initial={initialsOf(name)} size={46} colors={avFor(name)} fontSize={16} />
        </View>
      </LinearGradient>
      <View style={{ flex: 1 }}>
        <Serif style={{ fontSize: 22 }} numberOfLines={1}>{name}</Serif>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}>
          <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: accent }} />
          <Body style={{ fontSize: 12, color: C.muted }}>{sub}</Body>
        </View>
      </View>
    </View>
  );
}

const ChevBtn = () => (
  <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}>
    <Icon name="chevRight" size={13} color={C.muted2} strokeWidth={2.3} />
  </View>
);

/* One exercise card: header, modern sets table, notes. */
function ExerciseCard({ name, sets, boxed }: { name: string; sets: AnalystExercise[]; boxed?: boolean }) {
  const first = sets[0];
  const hasDuration = sets.some((s) => s.duration_seconds);
  const hasNotes = sets.some((s) => s.exercise_notes || s.remark);
  const sub = [first.body_part, first.equipment].filter(Boolean).join(' · ');
  const accent = boxed ? C.purple : C.orange;
  const colHead = { fontFamily: F.mono, fontSize: 8.5, color: C.faint, letterSpacing: 0.8 } as const;
  return (
    <View style={{ borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: boxed ? hexA(C.purple, 0.18) : 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
      <View style={{ padding: 13, gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ width: 32, height: 32, borderRadius: 11, backgroundColor: hexA(accent, 0.12), borderWidth: 1, borderColor: hexA(accent, 0.28), alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="dumbbell" size={14} color={accent} strokeWidth={1.9} />
          </View>
          <View style={{ flex: 1 }}>
            <Body style={{ fontSize: 14.5, fontFamily: F.bodySemi, color: '#fff' }} numberOfLines={1}>{name}</Body>
            {sub ? <Body style={{ fontSize: 10.5, color: C.muted3, marginTop: 1 }} numberOfLines={1}>{sub}</Body> : null}
          </View>
          <View style={{ paddingVertical: 3, paddingHorizontal: 9, borderRadius: 999, backgroundColor: hexA(accent, 0.1), borderWidth: 1, borderColor: hexA(accent, 0.26) }}>
            <Text style={{ fontFamily: F.mono, fontSize: 9.5, color: accent }}>{sets.length} SET{sets.length === 1 ? '' : 'S'}</Text>
          </View>
        </View>

        {/* Sets table */}
        <View style={{ borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.025)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)', paddingHorizontal: 11, paddingVertical: 4 }}>
          <View style={{ flexDirection: 'row', gap: 8, paddingVertical: 6 }}>
            <Text style={[colHead, { width: 32 }]}>SET</Text>
            <Text style={[colHead, { flex: 1 }]}>REPS</Text>
            <Text style={[colHead, { flex: 1 }]}>LOAD</Text>
            {hasDuration ? <Text style={[colHead, { flex: 1 }]}>TIME</Text> : null}
          </View>
          {sets.map((s, i) => (
            <View key={s.id} style={{ flexDirection: 'row', gap: 8, paddingVertical: 7, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)' }}>
              <View style={{ width: 32 }}>
                <View style={{ width: 20, height: 20, borderRadius: 7, backgroundColor: hexA(accent, 0.1), alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontFamily: F.mono, fontSize: 10.5, color: accent }}>{s.set_number ?? i + 1}</Text>
                </View>
              </View>
              <Text style={{ flex: 1, fontFamily: F.bodySemi, fontSize: 12.5, color: C.ink }}>{s.reps_performed ?? '—'}</Text>
              <Text style={{ flex: 1, fontFamily: F.bodySemi, fontSize: 12.5, color: C.ink }}>{s.load_performed ?? '—'}</Text>
              {hasDuration ? <Text style={{ flex: 1, fontFamily: F.bodySemi, fontSize: 12.5, color: C.ink }}>{s.duration_seconds ? `${s.duration_seconds}s` : '—'}</Text> : null}
            </View>
          ))}
        </View>

        {/* Notes / remarks */}
        {hasNotes ? (
          <View style={{ gap: 6 }}>
            {sets.map((s, i) =>
              s.exercise_notes || s.remark ? (
                <View key={`n-${s.id}`} style={{ flexDirection: 'row', gap: 8, paddingVertical: 7, paddingHorizontal: 10, borderRadius: 10, backgroundColor: hexA(C.gold, 0.05), borderWidth: 1, borderColor: hexA(C.gold, 0.16) }}>
                  <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: C.gold, marginTop: 5 }} />
                  <View style={{ flex: 1 }}>
                    {sets.length > 1 ? <Mono style={{ fontSize: 8, letterSpacing: 0.8, color: C.muted3, marginBottom: 2 }}>SET {s.set_number ?? i + 1}</Mono> : null}
                    {s.exercise_notes ? <Body style={{ fontSize: 12, color: C.ink3 }}>{s.exercise_notes}</Body> : null}
                    {s.remark ? <Body style={{ fontSize: 12, color: C.ink3 }}><Text style={{ color: C.muted3 }}>Remark: </Text>{s.remark}</Body> : null}
                  </View>
                </View>
              ) : null
            )}
          </View>
        ) : null}
      </View>
    </View>
  );
}

/* Session detail: hero, supersets boxed, regular exercises. */
function SessionDetail({ session }: { session: AnalystSession }) {
  const supersets = new Map<string, AnalystExercise[]>();
  const regular: AnalystExercise[] = [];
  session.exercises.forEach((e) => {
    if (e.super_set_group) {
      if (!supersets.has(e.super_set_group)) supersets.set(e.super_set_group, []);
      supersets.get(e.super_set_group)!.push(e);
    } else regular.push(e);
  });
  const byName = (list: AnalystExercise[]) => {
    const m = new Map<string, AnalystExercise[]>();
    list.forEach((e) => {
      if (!m.has(e.exercise_name)) m.set(e.exercise_name, []);
      m.get(e.exercise_name)!.push(e);
    });
    m.forEach((g) => g.sort((a, b) => (a.set_number ?? 0) - (b.set_number ?? 0)));
    return m;
  };
  const regularByName = byName(regular);
  const totalExercises = regularByName.size + supersets.size;
  const totalSets = session.exercises.length;

  return (
    <>
      {/* Session hero */}
      <Card colors={['rgba(50,30,19,0.45)', 'rgba(18,14,14,0.5)']} radius={20} style={{ overflow: 'hidden' }}>
        <LinearGradient colors={[hexA(C.orange, 0.55), 'rgba(255,255,255,0.02)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 3 }} />
        <View style={{ padding: 16, gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: hexA(C.orange, 0.13), borderWidth: 1, borderColor: hexA(C.orange, 0.32), alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="dumbbell" size={19} color={C.orange} strokeWidth={1.9} />
            </View>
            <View style={{ flex: 1 }}>
              <Serif style={{ fontSize: 21 }} numberOfLines={2}>{session.sessionName}</Serif>
              <Body style={{ fontSize: 11.5, color: C.muted, marginTop: 2 }}>{fmtDay(session.sessionDate)}</Body>
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {([
              [`${totalExercises}`, 'EXERCISES', C.orange],
              [`${totalSets}`, 'SET ROWS', C.gold],
              [session.trainerName.split(' ')[0], 'TRAINER', C.blue],
            ] as const).map(([v, l, col]) => (
              <View key={l} style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 12, backgroundColor: hexA(col, 0.07), borderWidth: 1, borderColor: hexA(col, 0.2) }}>
                <Text numberOfLines={1} style={{ fontFamily: F.bodyBold, fontSize: 14, color: col }}>{v}</Text>
                <Mono style={{ fontSize: 7, letterSpacing: 1, color: C.muted3, marginTop: 2 }}>{l}</Mono>
              </View>
            ))}
          </View>
        </View>
      </Card>

      {supersets.size ? <SectionRow text={`SUPERSETS · ${supersets.size}`} accent={hexA(C.purple, 0.9)} /> : null}
      {Array.from(supersets.entries()).map(([group, list]) => (
        <View key={group} style={{ borderRadius: 17, borderWidth: 1.5, borderColor: hexA(C.purple, 0.35), backgroundColor: hexA(C.purple, 0.05), padding: 11, gap: 9 }}>
          <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4, paddingHorizontal: 11, borderRadius: 999, backgroundColor: hexA(C.purple, 0.16), borderWidth: 1, borderColor: hexA(C.purple, 0.4) }}>
            <Icon name="layers" size={11} color={C.purple} strokeWidth={2.2} />
            <Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: C.purple }}>Super Set {group}</Text>
          </View>
          {Array.from(byName(list).entries()).map(([nm, sets]) => (
            <ExerciseCard key={nm} name={nm} sets={sets} boxed />
          ))}
        </View>
      ))}

      {regularByName.size ? <SectionRow text={`EXERCISES · ${regularByName.size}`} /> : null}
      {Array.from(regularByName.entries()).map(([nm, sets]) => (
        <ExerciseCard key={nm} name={nm} sets={sets} />
      ))}
    </>
  );
}

export function WorkoutAnalyst() {
  const [search, setSearch] = React.useState('');
  const [trainer, setTrainer] = React.useState<AnalystTrainer | null>(null);
  const [client, setClient] = React.useState<AnalystClient | null>(null);
  const [sessionId, setSessionId] = React.useState<string | null>(null);

  const trainersQ = useAnalystTrainers();
  const clientsQ = useAnalystTrainerClients(trainer?.id ?? null);
  const workoutsQ = useAnalystClientWorkouts(client?.id ?? null);

  const q = search.trim().toLowerCase();
  const trainers = (trainersQ.data ?? []).filter((t) => !q || t.name.toLowerCase().includes(q) || (t.email ?? '').toLowerCase().includes(q));
  const sessions = workoutsQ.data ?? [];
  const session = sessionId ? sessions.find((s) => s.sessionId === sessionId) ?? null : null;

  /* ---- Level 4: session detail ---- */
  if (trainer && client && session) {
    return (
      <Page gap={14} pt={6}>
        <BackRow label={`${client.name.split(' ')[0]}'s workouts`} onPress={() => setSessionId(null)} />
        <SessionDetail session={session} />
      </Page>
    );
  }

  /* ---- Level 3: client's workout sessions ---- */
  if (trainer && client) {
    return (
      <Page gap={14} pt={6}>
        <BackRow label={`Clients of ${trainer.name.split(' ')[0]}`} onPress={() => { setClient(null); setSessionId(null); }} />
        <HeroHeader
          name={client.name}
          sub={workoutsQ.isLoading ? 'Loading workouts…' : `${sessions.length} workout session${sessions.length === 1 ? '' : 's'} logged`}
          accent={C.orange}
        />
        {workoutsQ.isLoading ? (
          <CenterNote text="Loading workout history…" />
        ) : workoutsQ.isError ? (
          <CenterNote text={`Couldn't load workouts (${(workoutsQ.error as Error).message}).`} tone={C.red} />
        ) : sessions.length === 0 ? (
          <CenterNote text="No workouts logged for this client yet." />
        ) : (
          <>
            <SectionRow text={`WORKOUT HISTORY · ${sessions.length}`} />
            {sessions.map((s) => (
              <Card key={s.sessionId} onPress={() => setSessionId(s.sessionId)} colors={['rgba(46,28,18,0.42)', 'rgba(18,14,14,0.5)']} radius={17} style={{ overflow: 'hidden' }}>
                <LinearGradient colors={[hexA(C.orange, 0.45), 'rgba(255,255,255,0.02)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 3 }} />
                <View style={{ padding: 13, gap: 9 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
                    <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: hexA(C.orange, 0.12), borderWidth: 1, borderColor: hexA(C.orange, 0.28), alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name="dumbbell" size={16} color={C.orange} strokeWidth={1.9} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Body style={{ fontSize: 14.5, fontFamily: F.bodySemi, color: '#fff' }} numberOfLines={1}>{s.sessionName}</Body>
                      <Body style={{ fontSize: 11, color: C.muted2, marginTop: 1 }}>{fmtDay(s.sessionDate)}</Body>
                    </View>
                    <ChevBtn />
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <View style={{ paddingVertical: 3, paddingHorizontal: 9, borderRadius: 999, backgroundColor: hexA(C.gold, 0.1), borderWidth: 1, borderColor: hexA(C.gold, 0.25) }}>
                      <Text style={{ fontFamily: F.mono, fontSize: 9, color: C.gold }}>{s.exercises.length} ROWS</Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 3, paddingHorizontal: 9, borderRadius: 999, backgroundColor: hexA(C.blue, 0.08), borderWidth: 1, borderColor: hexA(C.blue, 0.22) }}>
                      <Icon name="user" size={10} color={C.blue} strokeWidth={2.2} />
                      <Text numberOfLines={1} style={{ fontFamily: F.bodySemi, fontSize: 10, color: '#A9BCFF' }}>{s.trainerName}</Text>
                    </View>
                  </View>
                </View>
              </Card>
            ))}
          </>
        )}
      </Page>
    );
  }

  /* ---- Level 2: trainer's clients ---- */
  if (trainer) {
    const clients = clientsQ.data ?? [];
    return (
      <Page gap={14} pt={6}>
        <BackRow label="All trainers" onPress={() => { setTrainer(null); setClient(null); setSessionId(null); }} />
        <HeroHeader
          name={trainer.name}
          sub={clientsQ.isLoading ? 'Loading clients…' : `${clients.length} active client${clients.length === 1 ? '' : 's'}`}
          accent={C.green}
        />
        {clientsQ.isLoading ? (
          <CenterNote text="Loading clients…" />
        ) : clientsQ.isError ? (
          <CenterNote text={`Couldn't load clients (${(clientsQ.error as Error).message}).`} tone={C.red} />
        ) : clients.length === 0 ? (
          <CenterNote text="No clients assigned to this trainer." />
        ) : (
          <>
            <SectionRow text={`ACTIVE CLIENTS · ${clients.length}`} />
            <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} radius={18} style={{ paddingHorizontal: 14, paddingVertical: 4 }}>
              {clients.map((c, i) => (
                <Pressable key={c.id} onPress={() => setClient(c)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: 'rgba(255,255,255,0.05)' }}>
                  <Avatar initial={initialsOf(c.name)} size={38} colors={avFor(c.name)} fontSize={13} />
                  <Body style={{ flex: 1, fontSize: 14.5, fontFamily: F.bodySemi, color: '#fff' }} numberOfLines={1}>{c.name}</Body>
                  {c.status ? <Badge text={c.status.charAt(0).toUpperCase() + c.status.slice(1)} color={c.status === 'active' ? C.green : C.muted} /> : null}
                  <ChevBtn />
                </Pressable>
              ))}
            </Card>
          </>
        )}
      </Page>
    );
  }

  /* ---- Level 1: all trainers ---- */
  return (
    <Page gap={14} pt={6}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 13 }}>
        <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: hexA(C.orange, 0.13), borderWidth: 1, borderColor: hexA(C.orange, 0.3), alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="activity" size={20} color={C.orange} strokeWidth={2} />
        </View>
        <View style={{ flex: 1 }}>
          <Serif style={{ fontSize: 25 }}>Workout Analyst</Serif>
          <Body style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>Track workout patterns across every trainer</Body>
        </View>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
        <Icon name="search" size={16} color={C.muted3} strokeWidth={2} />
        <TextInput value={search} onChangeText={setSearch} placeholder="Search trainers by name or email…" placeholderTextColor={C.muted3} autoCorrect={false} style={{ flex: 1, fontFamily: F.body, fontSize: 14.5, color: '#fff', padding: 0 }} />
        {search ? (
          <Pressable onPress={() => setSearch('')} hitSlop={8}><Icon name="close" size={13} color={C.muted3} strokeWidth={2.2} /></Pressable>
        ) : null}
      </View>

      {trainersQ.isLoading ? (
        <CenterNote text="Loading trainers…" />
      ) : trainersQ.isError ? (
        <CenterNote text={`Couldn't load trainers (${(trainersQ.error as Error).message}).`} tone={C.red} />
      ) : trainers.length === 0 ? (
        <CenterNote text={q ? 'No trainers match your search.' : 'No trainers available.'} />
      ) : (
        <>
          <SectionRow text={`ALL TRAINERS · ${trainers.length}`} />
          {trainers.map((t) => (
            <Card key={t.id} onPress={() => setTrainer(t)} colors={['rgba(46,28,18,0.42)', 'rgba(18,14,14,0.5)']} radius={17} style={{ overflow: 'hidden' }}>
              <LinearGradient colors={[hexA(avFor(t.name)[0], 0.5), 'rgba(255,255,255,0.02)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 3 }} />
              <View style={{ padding: 13, gap: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View style={{ padding: 2, borderRadius: 999, borderWidth: 1.5, borderColor: hexA(avFor(t.name)[0], 0.45) }}>
                    <Avatar initial={initialsOf(t.name)} size={42} colors={avFor(t.name)} fontSize={14} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Body style={{ fontSize: 15.5, fontFamily: F.bodySemi, color: '#fff' }} numberOfLines={1}>{t.name}</Body>
                    <View style={{ alignSelf: 'flex-start', marginTop: 3, paddingVertical: 2, paddingHorizontal: 8, borderRadius: 999, borderWidth: 1, borderColor: hexA(C.orange, 0.3), backgroundColor: hexA(C.orange, 0.08) }}>
                      <Text style={{ fontFamily: F.bodySemi, fontSize: 9.5, color: '#F0A875' }}>Trainer</Text>
                    </View>
                  </View>
                  <ChevBtn />
                </View>
                {t.email || t.phone ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
                    {t.email ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }}>
                        <Icon name="file" size={10} color={C.muted3} strokeWidth={1.9} />
                        <Body style={{ fontSize: 10.5, color: C.muted2 }} numberOfLines={1}>{t.email}</Body>
                      </View>
                    ) : null}
                    {t.phone ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }}>
                        <Icon name="phone" size={10} color={C.muted3} strokeWidth={1.9} />
                        <Body style={{ fontSize: 10.5, color: C.muted2 }}>{t.phone}</Body>
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </View>
            </Card>
          ))}
        </>
      )}
    </Page>
  );
}
