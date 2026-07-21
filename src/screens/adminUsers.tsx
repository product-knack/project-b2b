import React from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator, Modal, ScrollView } from 'react-native';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono, Card, Avatar } from '../components/primitives';
import { Page, TitleBlock, Badge } from './common';
import {
  useUsersByRole, useCreateUser, useUpdateUser, useUpdateSpecialization, useDeleteUser,
  useAssignments, useAssignmentOptions, useAssignTrainerToCoach, useRemoveAssignment,
  USER_ROLES, DOCTOR_SPECIALIZATIONS, userName, type ManagedRole, type ManagedUser,
} from '../lib/adminUserQueries';

/* ============ ADMIN — User Management (web /admin/users; 9 tabs merged into a role dropdown) ============ */

const AV_GRADS: [string, string][] = [['#FB8B3A', '#EE5E16'], ['#57C98A', '#2E9A63'], ['#7C8FE8', '#4A5AC8'], ['#9A7BEA', '#6E5BD0'], ['#E0A53C', '#C07C1E'], ['#4FD1C5', '#2C8A86'], ['#F687B3', '#C2568A'], ['#F0883E', '#C05621']];
const avColors = (s: string): [string, string] => AV_GRADS[[...(s || '?')].reduce((a, c) => a + c.charCodeAt(0), 0) % AV_GRADS.length];
const fmtDay = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const inpSt = { borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 11, paddingVertical: 10, color: '#fff', fontFamily: F.body, fontSize: 13 } as const;
const roleLabel = (r: ManagedRole) => USER_ROLES.find(([id]) => id === r)?.[1] ?? r;
const singular: Record<ManagedRole, string> = { coach: 'Coach', trainer: 'Trainer', doctor: 'Doctor', crm: 'CRM', marketing: 'Marketing', academy: 'Academy', super_admin: 'Super Admin', ops: 'Ops' };

/* Dropdown-style role picker (replaces the web's 9-tab strip). */
function RolePicker({ role, onChange }: { role: ManagedRole; onChange: (r: ManagedRole) => void }) {
  const [open, setOpen] = React.useState(false);
  return (
    <View>
      <Pressable onPress={() => setOpen((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 11, paddingHorizontal: 13, borderRadius: open ? 0 : 13, borderTopLeftRadius: 13, borderTopRightRadius: 13, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: open ? hexA(C.orange, 0.45) : 'rgba(255,255,255,0.1)' }}>
        <Icon name="users" size={14} color={C.orange} strokeWidth={2} />
        <Text style={{ flex: 1, fontFamily: F.bodySemi, fontSize: 13.5, color: '#fff' }}>{roleLabel(role)}</Text>
        <Icon name={open ? 'chevUp' : 'chevDown'} size={13} color={C.muted2} strokeWidth={2.3} />
      </Pressable>
      {open ? (
        <View style={{ borderWidth: 1, borderTopWidth: 0, borderColor: hexA(C.orange, 0.45), borderBottomLeftRadius: 13, borderBottomRightRadius: 13, backgroundColor: 'rgba(20,16,14,0.98)', overflow: 'hidden' }}>
          {USER_ROLES.map(([id, label], i) => {
            const active = role === id;
            return (
              <Pressable key={id} onPress={() => { onChange(id); setOpen(false); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 11, paddingHorizontal: 13, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: 'rgba(255,255,255,0.06)', backgroundColor: active ? hexA(C.orange, 0.09) : 'transparent' }}>
                <Text style={{ flex: 1, fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 12.5, color: active ? C.orange : '#fff' }}>{label}</Text>
                {active ? <Icon name="checks" size={13} color={C.orange} strokeWidth={2.5} /> : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

/* Searchable dropdown for picking a person (web's "Select a coach or doctor" selects). */
function PersonPicker({ label, placeholder, options, value, onChange }: {
  label: string; placeholder: string; options: { id: string; name: string; role: string }[];
  value: string | null; onChange: (id: string | null) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const selected = options.find((o) => o.id === value) ?? null;
  const term = search.trim().toLowerCase();
  const list = options.filter((o) => !term || o.name.toLowerCase().includes(term));
  return (
    <View style={{ gap: 5 }}>
      <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.mono2 }}>{label}</Mono>
      <Pressable onPress={() => { setOpen((v) => !v); setSearch(''); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 11, paddingHorizontal: 12, borderRadius: open ? 0 : 11, borderTopLeftRadius: 11, borderTopRightRadius: 11, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: open ? hexA(C.blue, 0.45) : 'rgba(255,255,255,0.1)' }}>
        <Text numberOfLines={1} style={{ flex: 1, fontFamily: selected ? F.bodySemi : F.body, fontSize: 12.5, color: selected ? '#fff' : C.muted3 }}>
          {selected ? `${selected.name}${selected.role === 'doctor' ? ' · Doctor' : ''}` : placeholder}
        </Text>
        {selected ? (
          <Pressable onPress={() => { onChange(null); setOpen(false); }} hitSlop={8}><Icon name="close" size={11} color={C.muted3} strokeWidth={2.4} /></Pressable>
        ) : null}
        <Icon name={open ? 'chevUp' : 'chevDown'} size={12} color={C.muted2} strokeWidth={2.3} />
      </Pressable>
      {open ? (
        <View style={{ marginTop: -5, borderWidth: 1, borderTopWidth: 0, borderColor: hexA(C.blue, 0.45), borderBottomLeftRadius: 11, borderBottomRightRadius: 11, backgroundColor: 'rgba(20,16,14,0.98)', overflow: 'hidden' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 11, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' }}>
            <Icon name="search" size={12} color={C.muted3} strokeWidth={2} />
            <TextInput value={search} onChangeText={setSearch} placeholder="Search…" placeholderTextColor={C.muted3} autoCorrect={false} style={{ flex: 1, fontFamily: F.body, fontSize: 12, color: '#fff', padding: 0 }} />
          </View>
          <ScrollView style={{ maxHeight: 220 }} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
            {list.length === 0 ? <Body style={{ fontSize: 11, color: C.muted3, textAlign: 'center', paddingVertical: 14 }}>No matches.</Body> : list.map((o, i) => (
              <Pressable key={o.id} onPress={() => { onChange(o.id); setOpen(false); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 12, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: 'rgba(255,255,255,0.05)', backgroundColor: value === o.id ? hexA(C.blue, 0.09) : 'transparent' }}>
                <Text numberOfLines={1} style={{ flex: 1, fontFamily: value === o.id ? F.bodyBold : F.bodySemi, fontSize: 12, color: value === o.id ? C.blue : '#fff' }}>{o.name}</Text>
                {o.role === 'doctor' ? <Badge text="Doctor" color={C.blue} /> : null}
                {value === o.id ? <Icon name="checks" size={12} color={C.blue} strokeWidth={2.5} /> : null}
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

function EditUserSheet({ user, onClose }: { user: ManagedUser; onClose: () => void }) {
  const update = useUpdateUser();
  const [email, setEmail] = React.useState(user.email ?? '');
  const [password, setPassword] = React.useState('');
  const [err, setErr] = React.useState<string | null>(null);
  const emailChanged = email.trim().toLowerCase() !== (user.email ?? '').toLowerCase();
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.62)', justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: '#0E0A09', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.14)', paddingHorizontal: 18, paddingTop: 14, paddingBottom: 24, gap: 10 }}>
          <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center' }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
            <View style={{ flex: 1 }}>
              <Serif style={{ fontSize: 18 }}>Edit user</Serif>
              <Body numberOfLines={1} style={{ fontSize: 10.5, color: C.muted2, marginTop: 1 }}>{userName(user)}</Body>
            </View>
            <Pressable onPress={onClose} hitSlop={8} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="close" size={13} color="#B8B2AC" strokeWidth={2.3} />
            </Pressable>
          </View>
          <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="Email" placeholderTextColor={C.muted3} style={inpSt} />
          <TextInput value={password} onChangeText={setPassword} secureTextEntry placeholder="New password (leave blank to keep)" placeholderTextColor={C.muted3} style={inpSt} />
          {err ? <Body style={{ fontSize: 10.5, color: C.red }}>{err}</Body> : null}
          <Pressable disabled={update.isPending} onPress={() => {
            setErr(null);
            update.mutate({ userId: user.id, email: emailChanged ? email : undefined, password: password.trim() || undefined },
              { onSuccess: onClose, onError: (e: any) => setErr(e?.message ?? 'Failed') });
          }} style={{ alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: hexA(C.orange, update.isPending ? 0.06 : 0.16), borderWidth: 1, borderColor: hexA(C.orange, update.isPending ? 0.2 : 0.5) }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: update.isPending ? C.muted3 : C.orange }}>{update.isPending ? 'Saving…' : 'Save changes'}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

export function AdminUsers() {
  const [view, setView] = React.useState<'users' | 'create' | 'assignments'>('users');
  const [role, setRole] = React.useState<ManagedRole>('coach');
  const [createRole, setCreateRole] = React.useState<ManagedRole>('coach');
  const [email, setEmail] = React.useState('');
  const [first, setFirst] = React.useState('');
  const [last, setLast] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [spec, setSpec] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [editUser, setEditUser] = React.useState<ManagedUser | null>(null);
  const [delArm, setDelArm] = React.useState<string | null>(null);

  const usersQ = useUsersByRole(role);
  const create = useCreateUser();
  const del = useDeleteUser();
  const updateSpec = useUpdateSpecialization();

  const asgQ = useAssignments();
  const optQ = useAssignmentOptions();
  const assign = useAssignTrainerToCoach();
  const unassign = useRemoveAssignment();
  const [selCoach, setSelCoach] = React.useState<string | null>(null);
  const [selTrainer, setSelTrainer] = React.useState<string | null>(null);

  const fail = (e: any) => setErr(e?.message ?? 'Failed');

  return (
    <Page gap={13}>
      <TitleBlock title="User Management" sub="Manage coaches, trainers and their relationships" />
      <View style={{ flexDirection: 'row', gap: 7 }}>
        {(([['users', 'Users'], ['create', 'Create User'], ['assignments', 'Assignments']]) as ['users' | 'create' | 'assignments', string][]).map(([id, label]) => {
          const active = view === id;
          return (
            <Pressable key={id} onPress={() => setView(id)} style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: active ? hexA(C.orange, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.orange, 0.5) : 'rgba(255,255,255,0.09)' }}>
              <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 11.5, color: active ? C.orange : C.muted }}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
      {err ? <Body style={{ fontSize: 10.5, color: C.red, textAlign: 'center' }}>{err}</Body> : null}

      {view === 'users' ? (
        <>
          <RolePicker role={role} onChange={(r) => { setRole(r); setDelArm(null); }} />
          <Pressable onPress={() => { setCreateRole(role); setView('create'); }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 12, backgroundColor: hexA(C.green, 0.12), borderWidth: 1, borderColor: hexA(C.green, 0.4) }}>
            <Icon name="userPlus" size={13} color={C.green} strokeWidth={2.2} />
            <Text style={{ fontFamily: F.bodyBold, fontSize: 11.5, color: C.green }}>Create {singular[role]}</Text>
          </Pressable>

          {/* Users list */}
          <Mono style={{ fontSize: 9.5, letterSpacing: 1.2, color: C.mono }}>{roleLabel(role).toUpperCase()} · {usersQ.data?.length ?? '…'}</Mono>
          {usersQ.isError ? <Body style={{ fontSize: 11, color: C.red, textAlign: 'center' }}>{(usersQ.error as Error).message}</Body> : null}
          {usersQ.isPending ? <View style={{ paddingVertical: 26, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View>
          : (usersQ.data ?? []).length === 0 ? <Body style={{ fontSize: 11.5, color: C.muted3, textAlign: 'center', paddingVertical: 18 }}>No {roleLabel(role).toLowerCase()} yet.</Body>
          : (usersQ.data ?? []).map((u) => {
            const name = userName(u);
            return (
              <Card key={u.id} colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.1)" radius={14} style={{ padding: 11, gap: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                  <Avatar initial={(name[0] ?? '?').toUpperCase()} size={32} colors={avColors(name)} fontSize={12} />
                  <View style={{ flex: 1 }}>
                    <Body numberOfLines={1} style={{ fontSize: 12.5, fontFamily: F.bodySemi, color: '#fff' }}>{name}</Body>
                    <Body numberOfLines={1} style={{ fontSize: 10, color: C.muted3, marginTop: 1 }}>{u.email ?? '—'}</Body>
                  </View>
                  <Mono style={{ fontSize: 7.5, letterSpacing: 0.4, color: C.muted3 }}>{fmtDay(u.created_at).toUpperCase()}</Mono>
                  <Pressable onPress={() => setEditUser(u)} hitSlop={5} style={{ width: 28, height: 28, borderRadius: 9, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="clipboard" size={12} color={C.muted} strokeWidth={2} />
                  </Pressable>
                  <Pressable disabled={del.isPending} onPress={() => {
                    setErr(null);
                    if (delArm === u.id) del.mutate({ userId: u.id, role }, { onSuccess: () => setDelArm(null), onError: (e: any) => { setDelArm(null); fail(e); } });
                    else setDelArm(u.id);
                  }} hitSlop={5} style={{ width: 28, height: 28, borderRadius: 9, backgroundColor: hexA(C.red, delArm === u.id ? 0.28 : 0.08), borderWidth: 1, borderColor: hexA(C.red, 0.4), alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="close" size={11} color={C.red} strokeWidth={2.5} />
                  </Pressable>
                </View>
                {role === 'doctor' ? (
                  <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                    <Mono style={{ fontSize: 7.5, letterSpacing: 0.5, color: C.muted3 }}>SPECIALIZATION</Mono>
                    {DOCTOR_SPECIALIZATIONS.map((s) => {
                      const active = u.doctor_specialization_tag === s;
                      return (
                        <Pressable key={s} disabled={updateSpec.isPending || active} onPress={() => { setErr(null); updateSpec.mutate({ userId: u.id, tag: s }, { onError: fail }); }}
                          style={{ paddingVertical: 4, paddingHorizontal: 9, borderRadius: 999, backgroundColor: active ? hexA(C.blue, 0.18) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.blue, 0.55) : 'rgba(255,255,255,0.09)' }}>
                          <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 9.5, color: active ? C.blue : C.muted }}>{s}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}
              </Card>
            );
          })}
          {delArm ? <Body style={{ fontSize: 9.5, color: C.red }}>Tap ✕ again to permanently delete the user's profile.</Body> : null}
        </>
      ) : view === 'create' ? (
        <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.12)" radius={16} style={{ padding: 14, gap: 10 }}>
          <Serif style={{ fontSize: 17 }}>Create User</Serif>
          <Body style={{ fontSize: 10.5, color: C.muted2, marginTop: -4 }}>One form for every role — pick the role, fill the details.</Body>
          <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.mono2 }}>ROLE</Mono>
          <RolePicker role={createRole} onChange={(r) => { setCreateRole(r); if (r !== 'doctor') setSpec(null); }} />
          <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.mono2 }}>EMAIL</Mono>
          <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="email@example.com" placeholderTextColor={C.muted3} style={inpSt} />
          <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.mono2 }}>NAME</Mono>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TextInput value={first} onChangeText={setFirst} placeholder="First name" placeholderTextColor={C.muted3} style={[inpSt, { flex: 1 }]} />
            <TextInput value={last} onChangeText={setLast} placeholder="Last name" placeholderTextColor={C.muted3} style={[inpSt, { flex: 1 }]} />
          </View>
          <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.mono2 }}>PASSWORD</Mono>
          <TextInput value={password} onChangeText={setPassword} secureTextEntry placeholder="Min 6 characters" placeholderTextColor={C.muted3} style={inpSt} />
          {createRole === 'doctor' ? (
            <>
              <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.mono2 }}>SPECIALIZATION *</Mono>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {DOCTOR_SPECIALIZATIONS.map((s) => (
                  <Pressable key={s} onPress={() => setSpec(s)} style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10, backgroundColor: spec === s ? hexA(C.blue, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: spec === s ? hexA(C.blue, 0.5) : 'rgba(255,255,255,0.09)' }}>
                    <Text style={{ fontFamily: spec === s ? F.bodyBold : F.bodySemi, fontSize: 10.5, color: spec === s ? C.blue : C.muted }}>{s}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}
          {msg ? <Body style={{ fontSize: 10.5, color: C.green }}>{msg}</Body> : null}
          <Pressable disabled={create.isPending} onPress={() => {
            setErr(null); setMsg(null);
            create.mutate({ email, password, firstName: first, lastName: last, role: createRole, specialization: spec }, {
              onSuccess: (m) => { setMsg(String(m)); setEmail(''); setFirst(''); setLast(''); setPassword(''); setSpec(null); setRole(createRole); },
              onError: fail,
            });
          }} style={{ alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: hexA(C.green, create.isPending ? 0.06 : 0.16), borderWidth: 1, borderColor: hexA(C.green, create.isPending ? 0.2 : 0.5) }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: create.isPending ? C.muted3 : C.green }}>{create.isPending ? 'Creating…' : `Create ${singular[createRole]}`}</Text>
          </Pressable>
          <Body style={{ fontSize: 9, color: C.faint }}>If the email already exists, the account's role is updated instead of creating a duplicate.</Body>
        </Card>
      ) : (
        <>
          <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.12)" radius={15} style={{ padding: 13, gap: 10 }}>
            <View>
              <Serif style={{ fontSize: 16 }}>Coach–Trainer Assignments</Serif>
              <Body style={{ fontSize: 10.5, color: C.muted2, marginTop: 2 }}>Assign trainers to coaches for management</Body>
            </View>
            {optQ.isPending ? <ActivityIndicator color={C.orange} /> : (
              <>
                <PersonPicker label="COACH / DOCTOR" placeholder="Select a coach or doctor" options={optQ.data?.coaches ?? []} value={selCoach} onChange={setSelCoach} />
                <PersonPicker label="TRAINER / DOCTOR" placeholder="Select a trainer or doctor" options={optQ.data?.trainers ?? []} value={selTrainer} onChange={setSelTrainer} />
                <Pressable disabled={assign.isPending || !selCoach || !selTrainer} onPress={() => {
                  setErr(null);
                  assign.mutate({ coachId: selCoach!, trainerId: selTrainer! }, { onSuccess: () => { setSelCoach(null); setSelTrainer(null); }, onError: fail });
                }} style={{ alignItems: 'center', paddingVertical: 11, borderRadius: 12, backgroundColor: hexA(C.green, assign.isPending || !selCoach || !selTrainer ? 0.06 : 0.16), borderWidth: 1, borderColor: hexA(C.green, assign.isPending || !selCoach || !selTrainer ? 0.2 : 0.5) }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: assign.isPending || !selCoach || !selTrainer ? C.muted3 : C.green }}>{assign.isPending ? 'Assigning…' : 'Assign'}</Text>
                </Pressable>
              </>
            )}
          </Card>
          <Mono style={{ fontSize: 9.5, letterSpacing: 1.2, color: C.mono }}>ASSIGNMENTS · {asgQ.data?.length ?? '…'}</Mono>
          {asgQ.isPending ? <View style={{ paddingVertical: 26, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View>
          : asgQ.isError ? <Body style={{ fontSize: 11, color: C.red, textAlign: 'center' }}>{(asgQ.error as Error).message}</Body>
          : (asgQ.data ?? []).length === 0 ? <Body style={{ fontSize: 11.5, color: C.muted3, textAlign: 'center', paddingVertical: 18 }}>No assignments yet.</Body>
          : (asgQ.data ?? []).map((a) => (
            <Card key={a.id} colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.1)" radius={14} style={{ padding: 11, flexDirection: 'row', alignItems: 'center', gap: 9 }}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <Body style={{ fontSize: 12, fontFamily: F.bodySemi, color: '#fff' }}>{a.coachName}</Body>
                  <Icon name="arrowRight" size={11} color={C.muted3} strokeWidth={2.3} />
                  <Body style={{ fontSize: 12, fontFamily: F.bodySemi, color: C.ink2 }}>{a.trainerName}</Body>
                </View>
                <Mono style={{ fontSize: 7.5, letterSpacing: 0.4, color: C.muted3, marginTop: 2 }}>ASSIGNED {fmtDay(a.assigned_at).toUpperCase()}</Mono>
              </View>
              <Pressable disabled={unassign.isPending} onPress={() => { setErr(null); unassign.mutate(a.id, { onError: fail }); }} hitSlop={5} style={{ width: 28, height: 28, borderRadius: 9, backgroundColor: hexA(C.red, 0.08), borderWidth: 1, borderColor: hexA(C.red, 0.4), alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="close" size={11} color={C.red} strokeWidth={2.5} />
              </Pressable>
            </Card>
          ))}
        </>
      )}
      {editUser ? <EditUserSheet user={editUser} onClose={() => setEditUser(null)} /> : null}
    </Page>
  );
}
