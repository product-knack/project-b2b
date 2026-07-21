import React from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator, Modal, ScrollView } from 'react-native';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono, Card, Avatar } from '../components/primitives';
import { Page, TitleBlock, Badge } from './common';
import { useAuth } from '../auth';
import { useIncidentTrainers, useMyIncidentCounts, useTrainerIncidents, useAddIncident, type IncidentTrainer } from '../lib/adminIncidentQueries';

/* ============ ADMIN — Trainer Incidents (web TrainerIncidentsPanel port) ============ */

const AV_GRADS: [string, string][] = [['#FB8B3A', '#EE5E16'], ['#57C98A', '#2E9A63'], ['#7C8FE8', '#4A5AC8'], ['#9A7BEA', '#6E5BD0'], ['#E0A53C', '#C07C1E'], ['#4FD1C5', '#2C8A86'], ['#F687B3', '#C2568A'], ['#F0883E', '#C05621']];
const avColors = (seed: string): [string, string] => AV_GRADS[[...(seed || '?')].reduce((a, c) => a + c.charCodeAt(0), 0) % AV_GRADS.length];
const fmtAt = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
const nameOf = (t: IncidentTrainer) => `${t.first_name ?? ''} ${t.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || '—';

function IncidentSheet({ trainer, profileId, onClose }: { trainer: IncidentTrainer; profileId: string | null; onClose: () => void }) {
  const q = useTrainerIncidents(trainer.id);
  const add = useAddIncident();
  const [msg, setMsg] = React.useState('');
  const [err, setErr] = React.useState<string | null>(null);
  const rows = q.data ?? [];
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.62)', justifyContent: 'flex-end' }}>
        <View style={{ maxHeight: '90%', backgroundColor: '#0E0A09', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.14)', paddingHorizontal: 18, paddingTop: 14, paddingBottom: 22 }}>
          <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 12 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 10 }}>
            <View style={{ flex: 1 }}>
              <Serif numberOfLines={1} style={{ fontSize: 18 }}>{nameOf(trainer)}</Serif>
              <Body style={{ fontSize: 10.5, color: C.muted2, marginTop: 1 }}>Incident log · {rows.length} record{rows.length === 1 ? '' : 's'}</Body>
            </View>
            <Pressable onPress={onClose} hitSlop={8} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="close" size={13} color="#B8B2AC" strokeWidth={2.3} />
            </Pressable>
          </View>

          {/* composer */}
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end', marginBottom: 11 }}>
            <TextInput value={msg} onChangeText={(v) => setMsg(v.slice(0, 1000))} multiline placeholder="Log a new incident…" placeholderTextColor={C.muted3}
              style={{ flex: 1, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 11, paddingVertical: 10, color: '#fff', fontFamily: F.body, fontSize: 13, minHeight: 44, maxHeight: 100 }} />
            <Pressable disabled={add.isPending || msg.trim().length < 5} onPress={() => { setErr(null); add.mutate({ trainerId: trainer.id, message: msg, profileId }, { onSuccess: () => setMsg(''), onError: (e: any) => setErr(e?.message ?? 'Failed') }); }}
              style={{ paddingVertical: 11, paddingHorizontal: 13, borderRadius: 11, backgroundColor: hexA(C.orange, msg.trim().length < 5 ? 0.06 : 0.16), borderWidth: 1, borderColor: hexA(C.orange, msg.trim().length < 5 ? 0.2 : 0.5) }}>
              <Icon name="send" size={14} color={msg.trim().length < 5 ? C.muted3 : C.orange} strokeWidth={2.2} />
            </Pressable>
          </View>
          {err ? <Body style={{ fontSize: 10.5, color: C.red, marginBottom: 8 }}>{err}</Body> : null}

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 9, paddingBottom: 8 }}>
            {q.isPending ? <View style={{ paddingVertical: 24, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View>
            : q.isError ? <Body style={{ fontSize: 11, color: C.red, textAlign: 'center' }}>{(q.error as Error).message}</Body>
            : rows.length === 0 ? <Body style={{ fontSize: 11.5, color: C.muted3, textAlign: 'center', paddingVertical: 18 }}>No incidents logged for this trainer.</Body>
            : rows.map((r) => (
              <View key={r.id} style={{ padding: 11, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: hexA(C.red, 0.14), gap: 5 }}>
                <Body style={{ fontSize: 12, color: C.ink2, lineHeight: 17 }}>{r.message}</Body>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                  <Mono style={{ fontSize: 7.5, letterSpacing: 0.4, color: C.muted3 }}>{(r.authorName ?? 'UNKNOWN').toUpperCase()}</Mono>
                  <Badge text={r.author_role.toUpperCase()} color={r.author_role === 'admin' ? C.orange : C.blue} />
                  <Mono style={{ fontSize: 7.5, letterSpacing: 0.4, color: C.muted3 }}>{fmtAt(r.created_at).toUpperCase()}</Mono>
                </View>
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export function AdminIncidents() {
  const { session } = useAuth();
  const profileId = session?.user?.id ?? null;
  const trainersQ = useIncidentTrainers();
  const countsQ = useMyIncidentCounts(profileId);
  const [search, setSearch] = React.useState('');
  const [open, setOpen] = React.useState<IncidentTrainer | null>(null);
  const term = search.trim().toLowerCase();
  const list = (trainersQ.data ?? []).filter((t) => !term || nameOf(t).toLowerCase().includes(term));
  const shown = list.slice(0, 60);
  return (
    <Page gap={13}>
      <TitleBlock title="Incidents" sub="Trainer incident log — records visible to admins" />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 13, paddingVertical: 11, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)' }}>
        <Icon name="search" size={15} color={C.muted3} strokeWidth={2} />
        <TextInput value={search} onChangeText={setSearch} placeholder="Search trainers…" placeholderTextColor={C.muted3} autoCorrect={false} style={{ flex: 1, fontFamily: F.body, fontSize: 14, color: '#fff', padding: 0 }} />
        {search ? <Pressable onPress={() => setSearch('')} hitSlop={8}><Icon name="close" size={13} color={C.muted3} strokeWidth={2.3} /></Pressable> : null}
      </View>
      {trainersQ.isError ? <Body style={{ fontSize: 11.5, color: C.red, textAlign: 'center' }}>{(trainersQ.error as Error).message}</Body> : null}
      {trainersQ.isPending ? (
        <View style={{ paddingVertical: 30, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View>
      ) : shown.length === 0 ? (
        <Body style={{ fontSize: 12, color: C.muted3, textAlign: 'center', paddingVertical: 22 }}>No trainers match the search.</Body>
      ) : (
        <>
          {shown.map((t) => {
            const n = countsQ.data?.[t.id] ?? 0;
            const name = nameOf(t);
            return (
              <Card key={t.id} onPress={() => setOpen(t)} colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border={hexA(n > 0 ? C.red : '#94A3B8', n > 0 ? 0.3 : 0.12)} radius={14} style={{ padding: 11, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Avatar initial={(name[0] ?? '?').toUpperCase()} size={34} colors={avColors(name)} fontSize={13} />
                <View style={{ flex: 1 }}>
                  <Body numberOfLines={1} style={{ fontSize: 13, fontFamily: F.bodySemi, color: '#fff' }}>{name}</Body>
                  <View style={{ flexDirection: 'row', gap: 6, marginTop: 3 }}><Badge text="Trainer" color={C.gold} /></View>
                </View>
                {n > 0 ? (
                  <View style={{ minWidth: 22, alignItems: 'center', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 99, backgroundColor: hexA(C.red, 0.16), borderWidth: 1, borderColor: hexA(C.red, 0.4) }}>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 10.5, color: C.red }}>{n}</Text>
                  </View>
                ) : null}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 7, paddingHorizontal: 12, borderRadius: 10, backgroundColor: hexA(C.orange, 0.13), borderWidth: 1, borderColor: hexA(C.orange, 0.4) }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: C.orange }}>Open</Text>
                  <Icon name="chevRight" size={10} color={C.orange} strokeWidth={2.5} />
                </View>
              </Card>
            );
          })}
          {list.length > shown.length ? <Mono style={{ fontSize: 8.5, letterSpacing: 0.6, color: C.muted3, textAlign: 'center' }}>+{list.length - shown.length} MORE — REFINE THE SEARCH</Mono> : null}
        </>
      )}
      {open ? <IncidentSheet trainer={open} profileId={profileId} onClose={() => setOpen(null)} /> : null}
    </Page>
  );
}
