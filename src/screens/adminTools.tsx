import React from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator, Modal, ScrollView, Alert } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { C, F, hexA, ORANGE_GRAD } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono, Card } from '../components/primitives';
import { Page, TitleBlock, Badge, BackLink } from './common';
import { useStore } from '../store';
import { supabase } from '../lib/supabase';

/* ============ ADMIN — Tools hub + Trainer Fee Management (web /admin/tools/trainer-fees) ============ */

const nameOf = (p: any) => `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || '—';
const inpSt = { borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 11, paddingVertical: 10, color: '#fff', fontFamily: F.body, fontSize: 13 } as const;
export const PAYOUT_METHODS = ['monthly', 'fortnightly', 'advance'] as const;

type Fee = { id: string; trainer_id: string; client_id: string; fee_amount: number; payout_method: string; trainer_name: string; client_name: string };
function useTrainerFees() {
  return useQuery({
    queryKey: ['trainer-fees'],
    staleTime: 30_000,
    queryFn: async (): Promise<Fee[]> => {
      const { data, error } = await supabase.from('trainer_fees')
        .select('id, trainer_id, client_id, fee_amount, payout_method, profiles!trainer_fees_trainer_id_fkey(first_name,last_name), clients!trainer_fees_client_id_fkey(first_name,last_name)');
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map((r) => ({ ...r, trainer_name: nameOf(r.profiles), client_name: nameOf(r.clients) }));
    },
  });
}
function useFeeTrainers() {
  return useQuery({
    queryKey: ['fee-trainers'],
    staleTime: 300_000,
    queryFn: async () => {
      // Over-broad by web design: doctors/coaches/CRMs can carry fees too.
      const { data, error } = await supabase.from('profiles').select('id, first_name, last_name, role').in('role', ['trainer', 'doctor', 'coach', 'crm']).order('first_name');
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map((p) => ({ id: p.id, name: nameOf(p), sub: p.role }));
    },
  });
}
function useFeeClients() {
  return useQuery({
    queryKey: ['clients-for-fees'],
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('id, first_name, last_name, status').order('first_name');
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map((c) => ({ id: c.id, name: nameOf(c), sub: c.status && c.status !== 'active' ? c.status : null }));
    },
  });
}
function useSaveFee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id?: string; trainerId: string; clientId: string; amount: number; method: string }) => {
      if (!input.trainerId || !input.clientId) throw new Error('Pick a trainer and a client.');
      if (!(input.amount > 0)) throw new Error('Enter a fee amount above 0.');
      // Edit only touches fee_amount/payout_method (web parity — pair is immutable).
      const { error } = input.id
        ? await supabase.from('trainer_fees').update({ fee_amount: input.amount, payout_method: input.method }).eq('id', input.id)
        : await supabase.from('trainer_fees').insert({ trainer_id: input.trainerId, client_id: input.clientId, fee_amount: input.amount, payout_method: input.method } as any);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trainer-fees'] }),
  });
}
function useDeleteFee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('trainer_fees').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trainer-fees'] }),
  });
}

/* Searchable person dropdown (shared by trainer/client pickers). */
function PickerField({ label, placeholder, options, value, onChange, disabled }: {
  label: string; placeholder: string; options: { id: string; name: string; sub?: string | null }[];
  value: string | null; onChange: (id: string) => void; disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const selected = options.find((o) => o.id === value) ?? null;
  const term = search.trim().toLowerCase();
  const list = options.filter((o) => !term || o.name.toLowerCase().includes(term)).slice(0, 60);
  return (
    <View style={{ gap: 5 }}>
      <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.mono2 }}>{label}</Mono>
      <Pressable disabled={disabled} onPress={() => { setOpen((v) => !v); setSearch(''); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 11, paddingHorizontal: 12, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: open ? hexA(C.orange, 0.45) : 'rgba(255,255,255,0.1)', opacity: disabled ? 0.55 : 1 }}>
        <Text numberOfLines={1} style={{ flex: 1, fontFamily: selected ? F.bodySemi : F.body, fontSize: 12.5, color: selected ? '#fff' : C.muted3 }}>{selected?.name ?? placeholder}</Text>
        {disabled ? <Mono style={{ fontSize: 7, color: C.muted3 }}>LOCKED</Mono> : <Icon name={open ? 'chevUp' : 'chevDown'} size={12} color={C.muted2} strokeWidth={2.3} />}
      </Pressable>
      {open && !disabled ? (
        <View style={{ borderRadius: 11, backgroundColor: 'rgba(20,16,14,0.98)', borderWidth: 1, borderColor: hexA(C.orange, 0.35), overflow: 'hidden' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 11, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' }}>
            <Icon name="search" size={12} color={C.muted3} strokeWidth={2} />
            <TextInput value={search} onChangeText={setSearch} placeholder="Search…" placeholderTextColor={C.muted3} style={{ flex: 1, fontFamily: F.body, fontSize: 12, color: '#fff', padding: 0 }} />
          </View>
          <ScrollView style={{ maxHeight: 200 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
            {list.map((o, i) => (
              <Pressable key={o.id} onPress={() => { onChange(o.id); setOpen(false); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 10, paddingHorizontal: 12, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: 'rgba(255,255,255,0.05)', backgroundColor: value === o.id ? hexA(C.orange, 0.09) : 'transparent' }}>
                <Text numberOfLines={1} style={{ flex: 1, fontFamily: value === o.id ? F.bodyBold : F.bodySemi, fontSize: 12, color: value === o.id ? C.orange : '#fff' }}>{o.name}</Text>
                {o.sub ? <Badge text={o.sub} color={o.sub === 'trainer' ? C.orange : C.blue} /> : null}
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

function FeeFormSheet({ existing, onClose }: { existing: Fee | null; onClose: () => void }) {
  const save = useSaveFee();
  const trainersQ = useFeeTrainers();
  const clientsQ = useFeeClients();
  const [trainerId, setTrainerId] = React.useState<string | null>(existing?.trainer_id ?? null);
  const [clientId, setClientId] = React.useState<string | null>(existing?.client_id ?? null);
  const [amount, setAmount] = React.useState(existing ? String(existing.fee_amount) : '');
  const [method, setMethod] = React.useState(existing?.payout_method ?? 'monthly');
  const [err, setErr] = React.useState<string | null>(null);
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.62)', justifyContent: 'flex-end' }}>
        <View style={{ maxHeight: '92%', backgroundColor: '#0E0A09', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.14)', paddingHorizontal: 18, paddingTop: 14, paddingBottom: 24 }}>
          <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 12 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 10 }}>
            <Serif style={{ flex: 1, fontSize: 18 }}>{existing ? 'Edit Fee' : 'Add New Fee'}</Serif>
            <Pressable onPress={onClose} hitSlop={8} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="close" size={13} color="#B8B2AC" strokeWidth={2.3} />
            </Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 10, paddingBottom: 8 }}>
            <PickerField label="TRAINER" placeholder="Select trainer" options={trainersQ.data ?? []} value={trainerId} onChange={setTrainerId} disabled={!!existing} />
            <PickerField label="CLIENT" placeholder="Select client" options={clientsQ.data ?? []} value={clientId} onChange={setClientId} disabled={!!existing} />
            {existing ? <Body style={{ fontSize: 9.5, color: C.muted3 }}>Trainer and client can't be changed — delete and re-add to move a fee (web rule).</Body> : null}
            <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.mono2 }}>FEE AMOUNT (₹ PER SESSION)</Mono>
            <TextInput value={amount} onChangeText={setAmount} keyboardType="numeric" placeholder="e.g. 800" placeholderTextColor={C.muted3} style={inpSt} />
            <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.mono2 }}>PAYOUT METHOD</Mono>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {PAYOUT_METHODS.map((m) => (
                <Pressable key={m} onPress={() => setMethod(m)} style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10, backgroundColor: method === m ? hexA(C.gold, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: method === m ? hexA(C.gold, 0.5) : 'rgba(255,255,255,0.09)' }}>
                  <Text style={{ fontFamily: method === m ? F.bodyBold : F.bodySemi, fontSize: 10.5, color: method === m ? C.gold : C.muted }}>{m}</Text>
                </Pressable>
              ))}
            </View>
            {err ? <Body style={{ fontSize: 10.5, color: C.red }}>{err}</Body> : null}
            <Pressable disabled={save.isPending} onPress={() => {
              setErr(null);
              save.mutate({ id: existing?.id, trainerId: trainerId ?? '', clientId: clientId ?? '', amount: parseFloat(amount), method },
                { onSuccess: onClose, onError: (e: any) => setErr(e?.message ?? 'Failed') });
            }} style={{ overflow: 'hidden', borderRadius: 12 }}>
              <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ alignItems: 'center', paddingVertical: 13 }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: '#fff' }}>{save.isPending ? 'Saving…' : existing ? 'Save Changes' : 'Add Fee'}</Text>
              </LinearGradient>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export function AdminTrainerFees() {
  const q = useTrainerFees();
  const del = useDeleteFee();
  const [filter, setFilter] = React.useState<string>('all');
  const [search, setSearch] = React.useState('');
  const [sheet, setSheet] = React.useState<{ fee: Fee | null } | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const confirmDelete = (r: Fee) => {
    setErr(null);
    Alert.alert(
      'Delete this fee?',
      `${r.trainer_name} → ${r.client_name} · ₹${Number(r.fee_amount).toFixed(2)} per session.\n\nPayout calculations update everywhere immediately. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => del.mutate(r.id, { onError: (e: any) => setErr(e?.message ?? 'Failed to delete fee') }) },
      ]
    );
  };
  const rows = q.data ?? [];
  const trainersInFees = [...new Map(rows.map((r) => [r.trainer_id, r.trainer_name])).entries()];
  const term = search.trim().toLowerCase();
  const filtered = rows
    .filter((r) => filter === 'all' || r.trainer_id === filter)
    .filter((r) => !term || (r.trainer_name ?? '').toLowerCase().includes(term) || (r.client_name ?? '').toLowerCase().includes(term));
  return (
    <Page gap={13}>
      <BackLink label="Tools" />
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <View style={{ flex: 1 }}><TitleBlock title="Trainer Fee Management" sub="Per-session fees powering payout calculations" /></View>
        <Pressable onPress={() => setSheet({ fee: null })} style={{ overflow: 'hidden', borderRadius: 12 }}>
          <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 13 }}>
            <Icon name="plus" size={13} color="#fff" strokeWidth={2.6} />
            <Text style={{ fontFamily: F.bodyBold, fontSize: 11.5, color: '#fff' }}>Add Fee</Text>
          </LinearGradient>
        </Pressable>
      </View>
      {/* Search by trainer or client name */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 13, paddingVertical: 11, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)' }}>
        <Icon name="search" size={15} color={C.muted3} strokeWidth={2} />
        <TextInput value={search} onChangeText={setSearch} placeholder="Search trainer or client…" placeholderTextColor={C.muted3} autoCorrect={false} style={{ flex: 1, fontFamily: F.body, fontSize: 14, color: '#fff', padding: 0 }} />
        {search ? <Pressable onPress={() => setSearch('')} hitSlop={8}><Icon name="close" size={13} color={C.muted3} strokeWidth={2.3} /></Pressable> : null}
      </View>
      {/* Trainer filter — only trainers that have fee rows (web parity) */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {[['all', 'All Trainers'] as [string, string], ...trainersInFees].map(([id, label]) => {
          const active = filter === id;
          return (
            <Pressable key={id} onPress={() => setFilter(id)} style={{ paddingVertical: 7, paddingHorizontal: 11, borderRadius: 999, backgroundColor: active ? hexA(C.orange, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.orange, 0.5) : 'rgba(255,255,255,0.09)' }}>
              <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 10.5, color: active ? C.orange : C.muted }}>{label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {err ? <Body style={{ fontSize: 10.5, color: C.red, textAlign: 'center' }}>{err}</Body> : null}
      {q.isError ? <Body style={{ fontSize: 11, color: C.red, textAlign: 'center' }}>{(q.error as Error).message}</Body> : null}
      {q.isPending ? <View style={{ paddingVertical: 28, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View>
      : filtered.length === 0 ? <Body style={{ fontSize: 11.5, color: C.muted3, textAlign: 'center', paddingVertical: 20 }}>{term || filter !== 'all' ? 'No fees match your search.' : 'No trainer fees set up yet.'}</Body>
      : filtered.map((r) => (
        <Card key={r.id} colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.1)" radius={14} style={{ padding: 11, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <Body numberOfLines={1} style={{ flexShrink: 1, fontSize: 12.5, fontFamily: F.bodySemi, color: '#fff' }}>{r.trainer_name}</Body>
              <Icon name="arrowRight" size={10} color={C.muted3} strokeWidth={2.3} />
              <Body numberOfLines={1} style={{ flexShrink: 1, fontSize: 12.5, color: C.ink2 }}>{r.client_name}</Body>
            </View>
            <View style={{ flexDirection: 'row', marginTop: 4 }}><Badge text={r.payout_method} color={C.gold} /></View>
          </View>
          <Serif style={{ fontSize: 16, color: C.green }}>₹{Number(r.fee_amount).toFixed(2)}</Serif>
          <Pressable onPress={() => setSheet({ fee: r })} hitSlop={5} style={{ width: 28, height: 28, borderRadius: 9, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="clipboard" size={12} color={C.muted} strokeWidth={2} />
          </Pressable>
          <Pressable disabled={del.isPending} onPress={() => confirmDelete(r)} hitSlop={5} style={{ width: 28, height: 28, borderRadius: 9, backgroundColor: hexA(C.red, 0.08), borderWidth: 1, borderColor: hexA(C.red, 0.4), alignItems: 'center', justifyContent: 'center' }}>
            {del.isPending && del.variables === r.id ? <ActivityIndicator size="small" color={C.red} /> : <Icon name="close" size={11} color={C.red} strokeWidth={2.5} />}
          </Pressable>
        </Card>
      ))}
      {sheet ? <FeeFormSheet existing={sheet.fee} onClose={() => setSheet(null)} /> : null}
    </Page>
  );
}

/* ================= Manage Managers & Team (web /admin/tools/manage-teams) =================
   Table manager_score: {manager_id, team_name, team_json = member profile ids[], team_start,
   team_end (null = ongoing), total_sessions, winner} — the last two are written by the
   leaderboard pipeline, never here. A profile may appear in exactly one slot per batch. */
type ManagerTeam = { id: string; manager_id: string; team_name: string | null; team_json: string[] | null; team_start: string | null; team_end: string | null; total_sessions: number | null; winner: number | null; created_at: string };
function useManagerTeams() {
  return useQuery({
    queryKey: ['manager-score-teams'],
    staleTime: 30_000,
    queryFn: async (): Promise<ManagerTeam[]> => {
      const { data, error } = await supabase.from('manager_score').select('*').order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map((t) => ({ ...t, team_json: Array.isArray(t.team_json) ? t.team_json : [] }));
    },
  });
}
function useCreateTeams() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (rows: { manager_id: string; team_name: string; team_json: string[]; team_start: string; team_end: string | null }[]) => {
      const { error } = await supabase.from('manager_score').insert(rows as any);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['manager-score-teams'] }); qc.invalidateQueries({ queryKey: ['manager-leaderboard'] }); },
  });
}
function useUpdateTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; teamName: string; managerId: string; members: string[] }) => {
      if (!input.teamName.trim() || !input.managerId || !input.members.length) throw new Error('Team name, manager and at least one member are required.');
      const { error } = await supabase.from('manager_score').update({ team_name: input.teamName.trim(), manager_id: input.managerId, team_json: input.members }).eq('id', input.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['manager-score-teams'] }); qc.invalidateQueries({ queryKey: ['manager-leaderboard'] }); },
  });
}

/* Searchable multi-select with chips (team members). */
function MultiPicker({ label, options, values, onToggle }: { label: string; options: { id: string; name: string; sub?: string | null }[]; values: string[]; onToggle: (id: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const term = search.trim().toLowerCase();
  const list = options.filter((o) => !term || o.name.toLowerCase().includes(term)).slice(0, 50);
  const byId = new Map(options.map((o) => [o.id, o]));
  return (
    <View style={{ gap: 6 }}>
      <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.mono2 }}>{label}</Mono>
      {values.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
          {values.map((id) => (
            <Pressable key={id} onPress={() => onToggle(id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 9, borderRadius: 999, backgroundColor: hexA(C.blue, 0.14), borderWidth: 1, borderColor: hexA(C.blue, 0.4) }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 9.5, color: C.blue }}>{byId.get(id)?.name ?? '—'}</Text>
              <Icon name="close" size={8} color={C.blue} strokeWidth={2.6} />
            </Pressable>
          ))}
        </View>
      ) : null}
      <Pressable onPress={() => { setOpen((v) => !v); setSearch(''); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: open ? hexA(C.blue, 0.45) : 'rgba(255,255,255,0.1)' }}>
        <Text style={{ flex: 1, fontFamily: F.body, fontSize: 12, color: C.muted3 }}>{values.length ? `${values.length} member${values.length === 1 ? '' : 's'} — tap to add more` : 'Add members'}</Text>
        <Icon name={open ? 'chevUp' : 'chevDown'} size={12} color={C.muted2} strokeWidth={2.3} />
      </Pressable>
      {open ? (
        <View style={{ borderRadius: 11, backgroundColor: 'rgba(20,16,14,0.98)', borderWidth: 1, borderColor: hexA(C.blue, 0.35), overflow: 'hidden' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 11, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' }}>
            <Icon name="search" size={12} color={C.muted3} strokeWidth={2} />
            <TextInput value={search} onChangeText={setSearch} placeholder="Search…" placeholderTextColor={C.muted3} style={{ flex: 1, fontFamily: F.body, fontSize: 12, color: '#fff', padding: 0 }} />
          </View>
          <ScrollView style={{ maxHeight: 190 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
            {list.map((o, i) => {
              const checked = values.includes(o.id);
              return (
                <Pressable key={o.id} onPress={() => onToggle(o.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 9, paddingHorizontal: 12, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: 'rgba(255,255,255,0.05)' }}>
                  <View style={{ width: 17, height: 17, borderRadius: 5, backgroundColor: checked ? hexA(C.blue, 0.3) : 'rgba(255,255,255,0.05)', borderWidth: 1.5, borderColor: checked ? C.blue : 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' }}>
                    {checked ? <Icon name="checks" size={10} color={C.blue} strokeWidth={2.8} /> : null}
                  </View>
                  <Text numberOfLines={1} style={{ flex: 1, fontFamily: F.bodySemi, fontSize: 11.5, color: checked ? '#fff' : C.ink2 }}>{o.name}</Text>
                  {o.sub ? <Badge text={o.sub} color={o.sub === 'trainer' ? C.orange : C.blue} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

type TeamEntry = { managerId: string | null; teamName: string; members: string[] };
export function AdminManageTeams() {
  const teamsQ = useManagerTeams();
  const poolQ = useFeeTrainers(); // same broad pool as the web (trainer/doctor/coach/crm)
  const createTeams = useCreateTeams();
  const updateTeam = useUpdateTeam();
  const [count, setCount] = React.useState(1);
  const [entries, setEntries] = React.useState<TeamEntry[]>([{ managerId: null, teamName: '', members: [] }]);
  const [start, setStart] = React.useState('');
  const [end, setEnd] = React.useState('');
  const [err, setErr] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<ManagerTeam | null>(null);
  const [editName, setEditName] = React.useState('');
  const [editManager, setEditManager] = React.useState<string | null>(null);
  const [editMembers, setEditMembers] = React.useState<string[]>([]);

  const pool = poolQ.data ?? [];
  const nameOfId = (id: string) => pool.find((p) => p.id === id)?.name ?? '—';
  const teams = teamsQ.data ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const hasOngoing = teams.some((t) => !t.team_end || t.team_end >= today);

  const setCountClamped = (n: number) => {
    const c = Math.max(1, Math.min(10, n));
    setCount(c);
    setEntries((prev) => {
      const next = [...prev];
      while (next.length < c) next.push({ managerId: null, teamName: '', members: [] });
      return next.slice(0, c);
    });
  };
  const usedElsewhere = (i: number) => {
    const used = new Set<string>();
    entries.forEach((e, j) => { if (j !== i) { if (e.managerId) used.add(e.managerId); e.members.forEach((m) => used.add(m)); } });
    return used;
  };
  const availFor = (i: number, excludeManager = false) => {
    const used = usedElsewhere(i);
    return pool.filter((p) => !used.has(p.id) && (!excludeManager || p.id !== entries[i].managerId));
  };
  const patchEntry = (i: number, patch: Partial<TeamEntry>) => setEntries((prev) => prev.map((e, j) => (j === i ? { ...e, ...patch } : e)));

  const createAll = () => {
    setErr(null);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) { setErr('Team start date is required (YYYY-MM-DD).'); return; }
    if (end && !/^\d{4}-\d{2}-\d{2}$/.test(end)) { setErr('Team end must be YYYY-MM-DD or blank for ongoing.'); return; }
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (!e.managerId || !e.teamName.trim() || e.members.length === 0) { setErr(`Team ${i + 1}: manager, team name and at least one member are required.`); return; }
    }
    createTeams.mutate(entries.map((e) => ({ manager_id: e.managerId!, team_name: e.teamName.trim(), team_json: e.members, team_start: start, team_end: end || null })), {
      onSuccess: () => { setEntries([{ managerId: null, teamName: '', members: [] }]); setCount(1); setStart(''); setEnd(''); },
      onError: (e: any) => setErr(e?.message ?? 'Failed'),
    });
  };

  // History grouped by period, newest first.
  const periods = [...new Map(teams.map((t) => [`${t.team_start}|${t.team_end ?? ''}`, { start: t.team_start, end: t.team_end }])).entries()]
    .sort((a, b) => String(b[1].start).localeCompare(String(a[1].start)));
  const fmtD = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : 'Present');

  // Edit availability: same-period teams only (web rule).
  const editAvail = (excludeManager = false) => {
    if (!editing) return pool;
    const samePeriod = teams.filter((t) => t.id !== editing.id && t.team_start === editing.team_start && (t.team_end ?? '') === (editing.team_end ?? ''));
    const used = new Set<string>();
    samePeriod.forEach((t) => { used.add(t.manager_id); (t.team_json ?? []).forEach((m) => used.add(m)); });
    return pool.filter((p) => !used.has(p.id) && (!excludeManager || p.id !== editManager));
  };

  return (
    <Page gap={13}>
      <BackLink label="Tools" />
      <TitleBlock title="Manage Managers & Team" sub="Create manager-led teams for the leaderboard period" />
      {hasOngoing ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, padding: 11, borderRadius: 13, backgroundColor: hexA(C.gold, 0.08), borderWidth: 1, borderColor: hexA(C.gold, 0.35) }}>
          <Icon name="alert" size={13} color={C.gold} strokeWidth={2.2} />
          <Body style={{ flex: 1, fontSize: 11, color: '#F2C066' }}>An ongoing period exists — creation is locked until it ends. Existing teams stay editable.</Body>
        </View>
      ) : null}

      {/* Period & count */}
      <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.12)" radius={15} style={{ padding: 13, gap: 10 }}>
        <Mono style={{ fontSize: 9.5, letterSpacing: 1.2, color: C.mono }}>PERIOD & TEAMS</Mono>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Mono style={{ fontSize: 8.5, letterSpacing: 0.6, color: C.mono2 }}>TEAMS</Mono>
          {(([['-', -1], ['+', 1]]) as [string, number][]).map(([lab, d]) => (
            <Pressable key={lab} onPress={() => setCountClamped(count + d)} style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: C.orange }}>{lab}</Text>
            </Pressable>
          )).reduce((acc, el, i) => (i === 1 ? [acc[0], <Serif key="n" style={{ fontSize: 18, minWidth: 24, textAlign: 'center' }}>{String(count)}</Serif>, el] : [...acc, el]), [] as React.ReactNode[])}
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput value={start} onChangeText={setStart} placeholder="Start YYYY-MM-DD *" placeholderTextColor={C.muted3} style={[inpSt, { flex: 1 }]} />
          <TextInput value={end} onChangeText={setEnd} placeholder="End (blank = ongoing)" placeholderTextColor={C.muted3} style={[inpSt, { flex: 1 }]} />
        </View>
      </Card>

      {/* Team forms */}
      {entries.map((e, i) => (
        <Card key={i} colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border={hexA(C.blue, 0.16)} radius={15} style={{ padding: 13, gap: 10 }}>
          <Mono style={{ fontSize: 9.5, letterSpacing: 1.2, color: C.mono }}>TEAM {i + 1}</Mono>
          <PickerField label="MANAGER" placeholder="Select manager" options={availFor(i).filter((p) => !e.members.includes(p.id))} value={e.managerId} onChange={(id) => patchEntry(i, { managerId: id })} />
          <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.mono2 }}>TEAM NAME</Mono>
          <TextInput value={e.teamName} onChangeText={(v) => patchEntry(i, { teamName: v })} placeholder="Team name" placeholderTextColor={C.muted3} style={inpSt} />
          <MultiPicker label={`MEMBERS · ${e.members.length}`} options={availFor(i, true)} values={e.members}
            onToggle={(id) => patchEntry(i, { members: e.members.includes(id) ? e.members.filter((m) => m !== id) : [...e.members, id] })} />
        </Card>
      ))}
      {err ? <Body style={{ fontSize: 10.5, color: C.red, textAlign: 'center' }}>{err}</Body> : null}
      <Pressable disabled={createTeams.isPending || hasOngoing} onPress={createAll} style={{ overflow: 'hidden', borderRadius: 12, opacity: hasOngoing ? 0.5 : 1 }}>
        <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ alignItems: 'center', paddingVertical: 13 }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: '#fff' }}>{createTeams.isPending ? 'Creating…' : `Create ${count} team${count === 1 ? '' : 's'}`}</Text>
        </LinearGradient>
      </Pressable>

      {/* History */}
      <Mono style={{ fontSize: 9.5, letterSpacing: 1.2, color: C.mono }}>CREATED TEAMS</Mono>
      {teamsQ.isPending ? <View style={{ paddingVertical: 24, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View>
      : teamsQ.isError ? <Body style={{ fontSize: 11, color: C.red, textAlign: 'center' }}>{(teamsQ.error as Error).message}</Body>
      : periods.length === 0 ? <Body style={{ fontSize: 11.5, color: C.muted3, textAlign: 'center', paddingVertical: 16 }}>No teams created yet.</Body>
      : periods.map(([key, p]) => {
        const inPeriod = teams.filter((t) => `${t.team_start}|${t.team_end ?? ''}` === key);
        const ongoing = !p.end || p.end >= today;
        return (
          <Card key={key} colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border={hexA(ongoing ? C.green : '#94A3B8', ongoing ? 0.25 : 0.12)} radius={15} style={{ padding: 12, gap: 9 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
              <Body style={{ flexShrink: 1, fontSize: 12, fontFamily: F.bodySemi, color: '#fff' }}>{fmtD(p.start)} → {fmtD(p.end)}</Body>
              <Badge text={`${inPeriod.length} team${inPeriod.length === 1 ? '' : 's'}`} color={C.blue} />
              <Badge text={ongoing ? 'Ongoing' : 'Completed'} color={ongoing ? C.green : '#94A3B8'} />
            </View>
            {inPeriod.map((t) => (
              <View key={t.id} style={{ padding: 10, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.22)', gap: 6 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                  <Body numberOfLines={1} style={{ flex: 1, fontSize: 12.5, fontFamily: F.bodySemi, color: '#fff' }}>{t.team_name ?? '—'}</Body>
                  {(t.total_sessions ?? 0) > 0 ? <Badge text={`${t.total_sessions} sessions`} color={C.gold} /> : null}
                  {t.winner ? <Badge text={`Rank #${t.winner}`} color={C.green} /> : null}
                  <Pressable onPress={() => { setEditing(t); setEditName(t.team_name ?? ''); setEditManager(t.manager_id); setEditMembers(t.team_json ?? []); }} hitSlop={5} style={{ width: 26, height: 26, borderRadius: 9, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="clipboard" size={11} color={C.muted} strokeWidth={2} />
                  </Pressable>
                </View>
                <Body style={{ fontSize: 10.5, color: C.muted2 }}>Manager: <Text style={{ color: C.ink2, fontFamily: F.bodySemi }}>{nameOfId(t.manager_id)}</Text></Body>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                  {(t.team_json ?? []).map((m) => <Badge key={m} text={nameOfId(m)} color={C.blue} />)}
                </View>
              </View>
            ))}
          </Card>
        );
      })}

      {editing ? (
        <Modal visible transparent animationType="slide" onRequestClose={() => setEditing(null)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.62)', justifyContent: 'flex-end' }}>
            <View style={{ maxHeight: '90%', backgroundColor: '#0E0A09', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.14)', paddingHorizontal: 18, paddingTop: 14, paddingBottom: 24 }}>
              <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 12 }} />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 10 }}>
                <Serif style={{ flex: 1, fontSize: 18 }}>Edit Team</Serif>
                <Pressable onPress={() => setEditing(null)} hitSlop={8} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="close" size={13} color="#B8B2AC" strokeWidth={2.3} />
                </Pressable>
              </View>
              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 10, paddingBottom: 8 }}>
                <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.mono2 }}>TEAM NAME</Mono>
                <TextInput value={editName} onChangeText={setEditName} placeholder="Team name" placeholderTextColor={C.muted3} style={inpSt} />
                <PickerField label="MANAGER" placeholder="Select manager" options={editAvail().filter((p) => !editMembers.includes(p.id))} value={editManager} onChange={setEditManager} />
                <MultiPicker label={`MEMBERS · ${editMembers.length}`} options={editAvail(true)} values={editMembers}
                  onToggle={(id) => setEditMembers((prev) => (prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]))} />
                <Body style={{ fontSize: 9.5, color: C.muted3 }}>Period dates, sessions and rank are managed by the leaderboard pipeline and can't be edited here.</Body>
                {err ? <Body style={{ fontSize: 10.5, color: C.red }}>{err}</Body> : null}
                <Pressable disabled={updateTeam.isPending} onPress={() => {
                  setErr(null);
                  updateTeam.mutate({ id: editing.id, teamName: editName, managerId: editManager ?? '', members: editMembers },
                    { onSuccess: () => setEditing(null), onError: (e: any) => setErr(e?.message ?? 'Failed') });
                }} style={{ overflow: 'hidden', borderRadius: 12 }}>
                  <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ alignItems: 'center', paddingVertical: 13 }}>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: '#fff' }}>{updateTeam.isPending ? 'Saving…' : 'Save Changes'}</Text>
                  </LinearGradient>
                </Pressable>
              </ScrollView>
            </View>
          </View>
        </Modal>
      ) : null}
    </Page>
  );
}

/* ---------------- Tools hub ---------------- */
function ToolCard({ icon, color, title, sub, route }: { icon: any; color: string; title: string; sub: string; route: string }) {
  const { go } = useStore();
  return (
    <Card onPress={() => go(route)} colors={['rgba(46,28,18,0.42)', 'rgba(18,14,14,0.5)']} border={hexA(color, 0.2)} radius={17} style={{ overflow: 'hidden' }}>
      <LinearGradient colors={[hexA(color, 0.5), 'rgba(255,255,255,0.02)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 3 }} />
      <View style={{ padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: hexA(color, 0.13), borderWidth: 1, borderColor: hexA(color, 0.32), alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={19} color={color} strokeWidth={2} />
        </View>
        <View style={{ flex: 1 }}>
          <Body style={{ fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }}>{title}</Body>
          <Body style={{ fontSize: 10.5, color: C.muted3, marginTop: 2 }}>{sub}</Body>
        </View>
        <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="chevRight" size={13} color={C.muted2} strokeWidth={2.3} />
        </View>
      </View>
    </Card>
  );
}

export function AdminTools() {
  const { go } = useStore();
  return (
    <Page gap={13}>
      <TitleBlock title="Tools" sub="Admin utilities & configuration" />
      <ToolCard icon="chart" color={C.gold} title="Revenue Tracker" sub="Password-protected per-client revenue, LTV & missing amounts" route="admin-revenue-tracker" />
      <ToolCard icon="rupee" color={C.blue} title="Revenue Summary" sub="Monthly ledger — new clients, renewals, add-ons, misc & pending" route="admin-revenue-summary" />
      <ToolCard icon="alert" color={C.red} title="Churn Requests" sub="Review discontinuation requests & reactivate clients" route="admin-churn" />
      <Card onPress={() => go('admin-trainer-fees')} colors={['rgba(46,28,18,0.42)', 'rgba(18,14,14,0.5)']} border={hexA(C.green, 0.2)} radius={17} style={{ overflow: 'hidden' }}>
        <LinearGradient colors={[hexA(C.green, 0.5), 'rgba(255,255,255,0.02)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 3 }} />
        <View style={{ padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: hexA(C.green, 0.13), borderWidth: 1, borderColor: hexA(C.green, 0.32), alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="rupee" size={19} color={C.green} strokeWidth={2} />
          </View>
          <View style={{ flex: 1 }}>
            <Body style={{ fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }}>Trainer Fee Management</Body>
            <Body style={{ fontSize: 10.5, color: C.muted3, marginTop: 2 }}>Per-session fees by trainer & client — drives payout calculators</Body>
          </View>
          <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="chevRight" size={13} color={C.muted2} strokeWidth={2.3} />
          </View>
        </View>
      </Card>
      <Card onPress={() => go('admin-manage-teams')} colors={['rgba(46,28,18,0.42)', 'rgba(18,14,14,0.5)']} border={hexA(C.purple, 0.2)} radius={17} style={{ overflow: 'hidden' }}>
        <LinearGradient colors={[hexA(C.purple, 0.5), 'rgba(255,255,255,0.02)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 3 }} />
        <View style={{ padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: hexA(C.purple, 0.13), borderWidth: 1, borderColor: hexA(C.purple, 0.32), alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="crown" size={19} color={C.purple} strokeWidth={2} />
          </View>
          <View style={{ flex: 1 }}>
            <Body style={{ fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }}>Manage Managers & Team</Body>
            <Body style={{ fontSize: 10.5, color: C.muted3, marginTop: 2 }}>Create leaderboard periods with manager-led teams</Body>
          </View>
          <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="chevRight" size={13} color={C.muted2} strokeWidth={2.3} />
          </View>
        </View>
      </Card>
    </Page>
  );
}
